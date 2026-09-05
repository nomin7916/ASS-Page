#!/usr/bin/env node
// 가계부 **거래 레이어**(재설계 단계 A) 검증.
//
// 구성 ①  src/ledger.ts 를 **직접 import** 해 순수 함수를 테스트한다(미러 금지 — 미러는
//        "src에만 넣은 변경"과 "미러에만 넣은 변경"이 둘 다 통과하는 구멍을 만든다).
//        ⚠️ 그래서 ledger.ts의 상대 import에는 `.ts` 확장자가 붙어 있다 — 떼면 Node ESM이
//        해석하지 못해 파트①이 통째로 죽는다.
// 구성 ②  소스 텍스트 가드 — 배선은 산술로 표현할 수 없다. **선언이 아니라 사용부**를 단언한다.
//        실패 시 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.
//
// 기존 `verify-ledger.mjs`(매트릭스·대출·엑셀 ①~③·팔레트 배선)는 **그대로 둔다** — 이 스크립트는
// 거래 레이어와 그 위에 서는 기능만 맡는다(재설계 문서 §8).
//
// ⚠️ 이 스위트의 1급 계약은 **"거래를 한 건도 넣지 않은 장부는 종전과 1원도 다르지 않다"**이다.
//    기능마다 '동작 케이스 + 거래 0건 무영향 케이스'를 쌍으로 둔다(backtest 규약).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
const near = (label, a, b, tol) => ok(`${label} (${a} ≈ ${b} ±${tol})`, typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= tol);

// ⚠️ 금지 토큰 검사는 **주석을 걷어낸 뒤** 한다 — 이 저장소는 금지 사유를 바로 그 자리 주석에
//    적으므로, 원문으로 재면 그 인용문이 유령 사용으로 잡혀 가드가 영구히 실패한다.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 구간을 잘라 단언한다 — 같은 문장이 여러 곳에 있으면 파일 전역 정규식은 죽은 단언이 된다. */
const sliceBlock = (src, startNeedle, endNeedle) => {
  const i = src.indexOf(startNeedle);
  if (i < 0) return '';
  const j = src.indexOf(endNeedle, i + startNeedle.length);
  return src.slice(i, j < 0 ? src.length : j);
};

// 예외를 그 케이스의 실패로 바꾸는 래퍼(직접 호출하면 던지는 구현이 스크립트를 통째로 중단시킨다).
const S = (label, fn, check) => {
  try { const v = fn(); ok(label, check ? check(v) : true); return v; }
  catch (e) { fail++; console.log(`  ✗ ${label} — threw ${e && e.message}`); return undefined; }
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트① 거래 레이어 순수 함수 (src/ledger.ts 직접 import) ──');

let L = null;
try {
  L = await import(pathToFileURL(join(ROOT, 'src/ledger.ts')).href);
} catch (e) {
  // ⚠️ '런타임이 .ts를 못 읽는다'와 '모듈이 깨졌다'를 반드시 구분한다 — 뭉뚱그려 건너뛰면
  //    import 경로에서 `.ts`를 떼는 것만으로 파트①이 조용히 사라지고도 종료코드 0이 나온다.
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  else { fail++; console.log(`  ✗ 파트① 모듈을 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (L) {
  const {
    makeLedgerBook, makeLedgerItem, makeLedgerTx,
    txIndexOf, actualResolved, actualOf, manualShadowed, installmentCharges, isLiveTx,
    addTx, updateTx, softDeleteTx, restoreTx, purgeTx, migrateManualToTx, dropManual,
    filterTx, suggestItems, shiftLedgerDate, sortTxDesc, stripTxForSnapshot, normalizeTx,
    monthTotals, expectedTotal, expectedIncomeTotal, expectedByPay, expectedOf, expectsActual,
    compareMonths, mtdCompare, ledgerEventsByDate,
    normalizeLedgerBooks, ledgerFingerprint, ledgerBooksHaveContent,
    MAX_LEDGER_TX, MAX_LEDGER_TX_SPLITS,
  } = L;

  ok('#T0 거래 레이어 export가 전부 있다', [
    txIndexOf, actualResolved, installmentCharges, addTx, updateTx, softDeleteTx, restoreTx,
    purgeTx, migrateManualToTx, dropManual, filterTx, suggestItems, stripTxForSnapshot,
    mtdCompare, normalizeTx, makeLedgerTx, sortTxDesc, manualShadowed, shiftLedgerDate,
  ].every((f) => typeof f === 'function'));

  /* ── 픽스처 ────────────────────────────────────────────────────────────────
   * 분할·환급·할부·이체·휴지통·미분류를 **각각 최소 1건** 넣는다 — 경로를 실제로 밟지 않는
   * 픽스처는 죽은 단언을 만든다(이 저장소가 여러 번 겪은 실패 모드).
   * ────────────────────────────────────────────────────────────────────── */
  const IT = {
    v1: makeLedgerItem({ id: 'v1', group: 'variable', pay: 'card', name: '식비', plan: 300000 }),
    v2: makeLedgerItem({ id: 'v2', group: 'variable', pay: 'card', name: '교통', plan: 100000 }),
    f1: makeLedgerItem({ id: 'f1', group: 'fixed', pay: 'transfer', name: '월세', plan: 700000 }),
    inc: makeLedgerItem({ id: 'in', group: 'income', pay: 'transfer', name: '급여', plan: 3000000 }),
  };
  const TX = [
    makeLedgerTx({ id: 't1', date: '2026-09-05', amount: 4500, itemId: 'v1', pay: 'card', memo: '김밥천국', createdAt: 5 }),
    makeLedgerTx({ id: 't2', date: '2026-09-05', amount: 1450, itemId: 'v2', pay: 'card', memo: '지하철', payer: '나', createdAt: 4 }),
    makeLedgerTx({ id: 't3', date: '2026-09-04', amount: 180000, itemId: 'v1', pay: 'card', installmentMonths: 3, createdAt: 3 }),
    makeLedgerTx({ id: 't4', date: '2026-09-03', amount: 8000, itemId: '', pay: 'cash', memo: '편의점', createdAt: 2 }),
    makeLedgerTx({ id: 't5', date: '2026-09-02', amount: 20000, itemId: 'v1', pay: 'card', refund: true, createdAt: 1 }),
    makeLedgerTx({
      id: 't6', date: '2026-09-10', amount: 100000, pay: 'card', createdAt: 6,
      splits: [{ itemId: 'v1', amount: 60000, memo: '장보기' }, { itemId: 'v2', amount: 40000, memo: '주유' }],
    }),
    makeLedgerTx({ id: 't7', date: '2026-09-15', amount: 500000, kind: 'transfer', pay: 'transfer', accountId: 'bank', toAccountId: 'card', createdAt: 7 }),
    makeLedgerTx({ id: 't8', date: '2026-09-20', amount: 3000, itemId: 'v1', pay: 'card', deletedAt: '2026-09-21', createdAt: 8 }),
    makeLedgerTx({ id: 't9', date: '2026-09-01', amount: 3000000, itemId: 'in', kind: 'income', pay: 'transfer', createdAt: 9 }),
    // 전달(8월) — mtdCompare 비교용
    makeLedgerTx({ id: 'p1', date: '2026-08-01', amount: 50000, itemId: 'v1', pay: 'card', createdAt: 10 }),
    makeLedgerTx({ id: 'p2', date: '2026-08-03', amount: 30000, itemId: 'v2', pay: 'card', createdAt: 11 }),
    makeLedgerTx({ id: 'p3', date: '2026-08-20', amount: 100000, itemId: 'v1', pay: 'card', createdAt: 12 }),
  ];
  const BOOK = makeLedgerBook({
    id: 'b1', name: '가계부',
    items: [IT.v1, IT.v2, IT.f1, IT.inc],
    transactions: sortTxDesc(TX),
  });
  /** 거래 0건 대조군 — 같은 항목·같은 계획, 거래만 없다. */
  const BOOK0 = makeLedgerBook({ id: 'b1', name: '가계부', items: [IT.v1, IT.v2, IT.f1, IT.inc] });

  const ix = txIndexOf(BOOK);

  // ── §1 인덱스 ───────────────────────────────────────────────────────────
  console.log('\n  §1 거래 인덱스');
  eq('#T1 항목×월 합 — 분할·할부 첫 회차·환급이 모두 반영된다',
    ix.byItemYm.get('v1|2026-09'), { sum: 4500 + 60000 - 20000 + 60000, count: 4 });
  eq('#T1b 분할의 다른 몫은 그 항목으로 간다', ix.byItemYm.get('v2|2026-09'), { sum: 1450 + 40000, count: 2 });
  // ⚠️ 옵셔널 체이닝 — 회차 분배가 사라지는 변이에서 **TypeError로 스크립트가 죽으면**
  //    다른 단언의 결과를 알 수 없고 하네스가 그 변이를 '검출'로 오인한다(memory 규약).
  eq('#T2 할부는 다음 달들로 나뉜다(이번 달 할부금이 이달 지출)',
    [ix.byItemYm.get('v1|2026-10')?.sum ?? null, ix.byItemYm.get('v1|2026-11')?.sum ?? null], [60000, 60000]);
  near('#T2b 할부 회차의 합은 원금과 정확히 같다',
    installmentCharges(TX[2]).reduce((a, b) => a + b.amount, 0), 180000, 1e-9);
  eq('#T2c 첫 회차 월은 거래월이다', installmentCharges(TX[2])[0].ym, '2026-09');
  eq('#T2d 일시불은 회차가 1건이다', installmentCharges(TX[0]).map((c) => c.ym), ['2026-09']);

  eq('#T3 미분류는 별도 축에 쌓인다(결제수단 분해 포함)',
    ix.uncategorizedYm.get('2026-09'), { sum: 8000, count: 1, byPay: { cash: 8000 } });

  // ⚠️ **휴지통은 어떤 집계에도 없다** — 여기서 한 번 걸러 소비자가 다시 신경 쓰지 않게 한다.
  eq('#T4 휴지통 거래는 항목 합에 없다(t8 3,000이 빠졌다)',
    [ix.byItemYm.get('v1|2026-09')?.sum ?? null, ix.trashCount], [104500, 1]);
  ok('#T4b 휴지통 거래는 날짜 축에도 없다', !ix.byDate.has('2026-09-20'));
  // ⚠️ 휴지통 제외는 **방어선이 둘**이다(인덱스 진입부의 조기 continue + `isLiveTx`).
  //    하나만 지워도 다른 하나가 잡으므로, 계약이 살아 있는지는 `isLiveTx`를 직접 물어 확인한다.
  eq('#T4c isLiveTx가 휴지통을 직접 판정한다',
    [isLiveTx(TX.find((t) => t.id === 't8')), isLiveTx(TX.find((t) => t.id === 't1'))], [false, true]);

  // ⚠️ 이체는 지출도 수입도 아니다(카드대금·적금 이체의 이중 계상을 구조로 막는다).
  eq('#T5 이체는 월 지출/수입 어디에도 없다',
    ix.byYm.get('2026-09'), { expense: 4500 + 1450 + 60000 + 8000 - 20000 + 100000, income: 3000000, count: 7 });
  ok('#T5b 이체는 계좌 축에만 남는다(단계 C가 쓴다)',
    ix.byAccountYm.get('bank|2026-09').out === 500000 && ix.byAccountYm.get('card|2026-09').in === 500000);

  // ⚠️ 날짜 축은 **그날 결제한 전액**이다 — 회차 날짜는 존재하지 않으므로 지어내지 않는다.
  eq('#T6 날짜 축은 할부도 그날 전액', ix.byDate.get('2026-09-04'), { expense: 180000, income: 0, count: 1 });
  eq('#T6b 환급은 음수로 합산된다', ix.byDate.get('2026-09-02').expense, -20000);

  // 불변식: 월 지출 = Σ항목(지출) + 미분류
  const itemSum9 = ['v1', 'v2', 'f1'].reduce((a, id) => a + (ix.byItemYm.get(`${id}|2026-09`)?.sum || 0), 0);
  near('#T7 ⚠️ byYm.expense === Σ byItemYm(지출 항목) + 미분류',
    ix.byYm.get('2026-09')?.expense ?? null, itemSum9 + (ix.uncategorizedYm.get('2026-09')?.sum ?? 0), 1e-9);

  eq('#T8 첫 거래 월을 기억한다(entry 전환·미입력 판정)', ix.firstTxYm.get('v1'), '2026-08');
  eq('#T8b 누가별 축', ix.byPayerYm.get('나|2026-09') ?? null, { expense: 1450, count: 1 });

  ok('#T9 ⚠️ 같은 장부 참조는 캐시 히트(같은 객체를 돌려준다)', txIndexOf(BOOK) === ix);
  ok('#T9b 다른 참조는 새로 계산한다', txIndexOf({ ...BOOK }) !== ix);
  eq('#T9c 거래 0건이면 인덱스가 비어 있다',
    [txIndexOf(BOOK0).liveCount, txIndexOf(BOOK0).byItemYm.size], [0, 0]);

  // ── §2 실제 금액의 단일 소스 ─────────────────────────────────────────────
  console.log('\n  §2 actualResolved — 실제 금액의 단일 소스');
  eq('#T10 거래가 있으면 거래 합이 이긴다',
    actualResolved(IT.v1, '2026-09', ix), { value: 104500, source: 'tx', count: 4 });
  const manualItem = makeLedgerItem({ id: 'v1', group: 'variable', name: '식비', actual: { '2026-09': 111 } });
  eq('#T10b 수동 값은 거래에 가려진다(단일 소스)',
    actualResolved(manualItem, '2026-09', ix).source, 'tx');
  eq('#T10c 가려진 수동 값을 화면이 알 수 있다', manualShadowed(manualItem, '2026-09', ix), 111);
  eq('#T11 거래가 없으면 수동 값', actualResolved(manualItem, '2026-07', ix), { value: null, source: 'none', count: 0 });
  eq('#T11b 수동 값이 있는 달은 manual', actualResolved(makeLedgerItem({ id: 'z', actual: { '2026-05': 7 } }), '2026-05', ix),
    { value: 7, source: 'manual', count: 0 });
  // ⚠️ 하위호환의 축 — ix를 넘기지 않으면 종전(수동 값만)과 완전히 같다.
  eq('#T12 ⚠️ ix 미전달이면 actualOf와 같다',
    [actualResolved(manualItem, '2026-09').value, actualOf(manualItem, '2026-09')], [111, 111]);
  eq('#T12b 거래 0건 장부에서는 두 함수가 항상 같다',
    ['2026-08', '2026-09'].map((m) => actualResolved(IT.v1, m, txIndexOf(BOOK0)).value === actualOf(IT.v1, m)),
    [true, true]);

  // ── §3 집계 ─────────────────────────────────────────────────────────────
  console.log('\n  §3 월 집계 · 미분류 · 비교');
  const T9 = monthTotals(BOOK, '2026-09');
  near('#T13 실제 지출은 거래 합 + 미분류', T9.actualExpense, 153950, 1e-9);
  eq('#T13b 미분류가 총계에 포함돼 있다(별도 필드로도 노출)', [T9.uncategorized, T9.uncategorizedCount], [8000, 1]);
  near('#T13c 수입도 거래에서 온다', T9.actualIncome, 3000000, 1e-9);
  // ⚠️ 미분류는 변동비 그룹으로 계상한다 — 화면의 가상 행 위치와 같은 규약(Σ그룹 === 총계).
  near('#T13d 미분류는 변동비 그룹에 들어간다', T9.byGroup.variable?.actual ?? null, 104500 + 41450 + 8000, 1e-9);
  near('#T13e 미분류의 결제수단도 소계에 반영된다', T9.byPay.cash?.actual ?? null, 8000, 1e-9);
  eq('#T13f 거래가 없는 고정비는 여전히 미입력이다', T9.missingIds, ['f1']);

  const T90 = monthTotals(BOOK0, '2026-09');
  eq('#T14 ⚠️ 거래 0건이면 집계가 종전과 동일(전 필드 0/미입력)',
    [T90.actualExpense, T90.uncategorized, T90.missingExpense], [0, 0, 3]);

  eq('#T15 expectedTotal은 ix를 받아야 거래를 본다',
    Math.round(expectedTotal([IT.v1], '2026-09', ix).value), 104500);
  eq('#T15b ⚠️ ix를 빠뜨리면 계획으로 떨어진다(호출부 가드가 필요한 이유)',
    Math.round(expectedTotal([IT.v1], '2026-09').value), 300000);
  eq('#T15c expectedIncomeTotal도 같은 규약', Math.round(expectedIncomeTotal([IT.inc], '2026-09', ix).value), 3000000);
  eq('#T15d expectedByPay도 같은 규약', Math.round(expectedByPay([IT.v1], '2026-09', ix).card.value), 104500);
  eq('#T15e expectedOf도 같은 규약', Math.round(expectedOf(IT.v1, '2026-09', ix)), 104500);

  // ⚠️ 진행 중인 달을 '미입력'으로 세면 매달 1일마다 경고가 켜지고 끌 방법이 없다.
  const txItem = makeLedgerItem({ id: 'tx1', group: 'variable', name: '커피', entry: 'tx', plan: 50000 });
  ok('#T16 entry:tx 항목의 이번 달은 거래가 없어도 미입력이 아니다',
    expectsActual(txItem, '2026-09', { ix, todayYm: '2026-09' }) === false);
  ok('#T16b 지난 달은 종전대로 미입력 대상이다',
    expectsActual(txItem, '2026-08', { ix, todayYm: '2026-09' }) === true);
  ok('#T16c ⚠️ entry:monthly(레거시)는 이번 달도 종전대로 대상이다',
    expectsActual(IT.v1, '2026-09', { ix, todayYm: '2026-09' }) === true);
  ok('#T16d ⚠️ opts 미전달이면 완전히 종전 동작', expectsActual(txItem, '2026-09') === true);

  // ── §4 진행 중인 달의 같은 기간 비교 ─────────────────────────────────────
  console.log('\n  §4 mtdCompare');
  const M = mtdCompare(BOOK, '2026-09', '2026-09-05');
  eq('#T17 이달 1~5일 vs 전달 1~5일', [M.cur, M.prev, M.days, M.prevDays, M.comparable], [173950, 80000, 5, 5, true]);
  near('#T17b 증감률', M.rate, (173950 - 80000) / 80000, 1e-9);
  eq('#T18 ⚠️ 오늘이 그 달이 아니면 계산하지 않는다', mtdCompare(BOOK, '2026-08', '2026-09-05').reason, 'not-current');
  eq('#T18b 거래가 없으면 숫자를 내지 않는다(수동 월 합계는 날짜가 없다)',
    mtdCompare(BOOK0, '2026-09', '2026-09-05').reason, 'no-tx');
  eq('#T18c 전달에 거래가 없으면 no-prev', mtdCompare(BOOK, '2026-08', '2026-08-05').reason, 'no-prev');
  // ⚠️ 말일 캡 — 없는 날짜를 0으로 채우면 2월이 항상 '덜 썼다'로 나온다.
  const capBook = makeLedgerBook({
    id: 'c', items: [IT.v1],
    transactions: sortTxDesc([
      makeLedgerTx({ id: 'c1', date: '2026-02-28', amount: 10000, itemId: 'v1' }),
      makeLedgerTx({ id: 'c2', date: '2026-03-30', amount: 20000, itemId: 'v1' }),
    ]),
  });
  /**
   * ⚠️ 캡은 **관측 가능해야 한다**. 없는 날짜(2/29~2/31)는 조회해도 0이라 `prev` 금액만으로는
   *    캡을 없애도 값이 같다(죽은 단언이 된다) — 그래서 `prevDays`를 결과에 싣고 그것을 단언한다.
   *    이 값은 단계 B(예산 탭)의 '같은 기간 대비'가 두 창의 길이 차이를 밝히는 데 쓴다.
   */
  const cap = mtdCompare(capBook, '2026-03', '2026-03-31');
  eq('#T19 ⚠️ 전달 일수가 부족하면 말일로 캡한다(3/31 → 2/28)',
    [cap.prev, cap.cur, cap.days, cap.prevDays], [10000, 20000, 31, 28]);
  // 3월(31일)이 전달이면 4/30까지 캡이 걸리지 않는다.
  eq('#T19b 전달이 더 길면 캡이 없다', mtdCompare(capBook, '2026-04', '2026-04-30').prevDays, 30);

  // ⚠️ compareMonths(닫힌 달끼리)는 **규약이 그대로다** — 미입력 집합이 같아야만 숫자를 낸다.
  //    두 달 다 f1만 미입력이라 비교가 성립하고, 값은 거래 합에서 온다.
  eq('#T20 compareMonths는 종전 규약 그대로(미입력 집합이 같을 때만 비교)',
    [compareMonths(BOOK, '2026-09', '2026-08').comparable, compareMonths(BOOK, '2026-09', '2026-08').delta],
    [true, 153950 - 180000]);
  eq('#T20b 미입력 집합이 다르면 여전히 비교 불가',
    compareMonths(addTx(BOOK, makeLedgerTx({ id: 'ff', date: '2026-08-09', amount: 1, itemId: 'f1' })).book,
      '2026-09', '2026-08').reason, 'missing-mismatch');

  // ── §5 CRUD ─────────────────────────────────────────────────────────────
  console.log('\n  §5 CRUD · 충돌 · 휴지통');
  const addRes = addTx(BOOK0, makeLedgerTx({ id: 'n1', date: '2026-09-09', amount: 1000, itemId: 'v1' }));
  eq('#T21 addTx는 새 book을 돌려주고 원본을 건드리지 않는다',
    [addRes.error, addRes.book.transactions.length, BOOK0.transactions.length], ['', 1, 0]);
  eq('#T21b ⚠️ 첫 거래가 생긴 항목은 entry가 tx로 바뀐다',
    addRes.book.items.find((i) => i.id === 'v1').entry, 'tx');
  eq('#T21c 다른 항목의 entry는 그대로', addRes.book.items.find((i) => i.id === 'v2').entry, 'monthly');
  ok('#T22 정렬은 date desc로 유지된다',
    addTx(BOOK, makeLedgerTx({ id: 'n2', date: '2026-12-01', amount: 1, itemId: 'v1' })).book.transactions[0].id === 'n2');

  // ⚠️ 상한에서는 **거부**한다(오래된 것을 조용히 버리지 않는다 — 무엇을 버릴지는 사용자가 정한다).
  const fullBook = makeLedgerBook({
    id: 'f', items: [IT.v1],
    transactions: Array.from({ length: MAX_LEDGER_TX }, (_, i) =>
      makeLedgerTx({ id: `x${i}`, date: '2026-01-01', amount: 1, itemId: 'v1', createdAt: i })),
  });
  const overflow = addTx(fullBook, makeLedgerTx({ id: 'over', date: '2026-09-09', amount: 1, itemId: 'v1' }));
  eq('#T23 ⚠️ 상한에서 거부하고 장부를 바꾸지 않는다',
    [overflow.error, overflow.book === fullBook], ['limit', true]);

  // 수동값 ↔ 거래 충돌
  const conflictBook = makeLedgerBook({
    id: 'k', items: [makeLedgerItem({ id: 'v1', group: 'variable', name: '식비', actual: { '2026-09': 55000 } })],
  });
  const c1 = addTx(conflictBook, makeLedgerTx({ id: 'k1', date: '2026-09-03', amount: 4000, itemId: 'v1' }));
  eq('#T24 ⚠️ 수동 값이 있는 달의 첫 거래는 충돌을 보고한다(추가는 막지 않는다)',
    [c1.error, c1.conflict], ['', { itemId: 'v1', ym: '2026-09', manual: 55000 }]);
  eq('#T24b 두 번째 거래는 더 이상 묻지 않는다',
    addTx(c1.book, makeLedgerTx({ id: 'k2', date: '2026-09-04', amount: 1000, itemId: 'v1' })).conflict, null);
  eq('#T24c 충돌 상태에서도 거래가 이긴다',
    actualResolved(c1.book.items[0], '2026-09', txIndexOf(c1.book)).value, 4000);

  const mig = migrateManualToTx(c1.book, 'v1', '2026-09');
  eq('#T25 거래로 옮기기 — 수동 값이 그 달 1일 거래가 되고 합계가 유지된다',
    [actualResolved(mig.items[0], '2026-09', txIndexOf(mig)).value,
      Object.prototype.hasOwnProperty.call(mig.items[0].actual, '2026-09')], [59000, false]);
  eq('#T25b 옮긴 거래의 출처는 migrate', mig.transactions.find((t) => t.origin === 'migrate').date, '2026-09-01');
  const drop = dropManual(c1.book, 'v1', '2026-09');
  eq('#T25c 수동 값 삭제는 거래만 남긴다',
    [Object.prototype.hasOwnProperty.call(drop.items[0].actual, '2026-09'), drop.transactions.length], [false, 1]);

  // 소프트 삭제 · 복원 · 영구 삭제
  const del = softDeleteTx(BOOK, ['t1'], '2026-09-30');
  eq('#T26 ⚠️ 삭제는 소프트다(배열에 남고 집계에서만 빠진다)',
    [del.transactions.length, txIndexOf(del).byItemYm.get('v1|2026-09')?.sum ?? null], [12, 100000]);
  eq('#T26b 복원하면 되돌아온다', txIndexOf(restoreTx(del, ['t1'])).byItemYm.get('v1|2026-09')?.sum ?? null, 104500);
  eq('#T26c 영구 삭제는 배열에서 지운다', purgeTx(del, ['t1']).transactions.length, 11);
  eq('#T26d 날짜가 없으면 삭제하지 않는다(안전)', softDeleteTx(BOOK, ['t1'], '') === BOOK, true);

  const upd = updateTx(BOOK, 't1', { amount: 9999 });
  // ⚠️ 정렬은 휴지통 거래도 포함한 date desc다(목록 필터가 그 뒤에 거른다).
  eq('#T27 updateTx는 금액을 바꾸고 정렬을 유지한다',
    [upd.transactions.find((t) => t.id === 't1').amount, upd.transactions[0].date], [9999, '2026-09-20']);
  eq('#T27b 없는 id는 원본 참조 그대로(헛된 저장 트리거 방지)', updateTx(BOOK, 'nope', { amount: 1 }) === BOOK, true);

  // ── §6 필터 · 자동완성 ──────────────────────────────────────────────────
  console.log('\n  §6 filterTx · suggestItems');
  eq('#T28 기본은 휴지통 제외', filterTx(BOOK.transactions, {}).some((t) => t.id === 't8'), false);
  eq('#T28b trashOnly는 휴지통만', filterTx(BOOK.transactions, { trashOnly: true }).map((t) => t.id), ['t8']);
  eq('#T28c 달 필터', filterTx(BOOK.transactions, { ym: '2026-08' }).length, 3);
  eq('#T28d 항목 필터는 분할도 본다', filterTx(BOOK.transactions, { itemId: 'v2' }).map((t) => t.id).sort(), ['p2', 't2', 't6']);
  // ⚠️ 이체는 항목이 없는 것이 정상이라 '미분류만'에 섞이면 안 된다(t7이 빠져야 한다).
  eq('#T28e 미분류만 — 이체는 제외', filterTx(BOOK.transactions, { uncategorizedOnly: true }).map((t) => t.id), ['t4']);
  eq('#T28f 환급만', filterTx(BOOK.transactions, { refundOnly: true }).map((t) => t.id), ['t5']);
  eq('#T28g 메모 검색(분할 메모 포함)', filterTx(BOOK.transactions, { q: '주유' }).map((t) => t.id), ['t6']);
  eq('#T28h 결제수단 필터', filterTx(BOOK.transactions, { pay: 'cash' }).map((t) => t.id), ['t4']);
  eq('#T28i 입력 순서를 바꾸지 않는다',
    filterTx(BOOK.transactions, {}).map((t) => t.id),
    BOOK.transactions.filter((t) => !t.deletedAt).map((t) => t.id));

  const sug = suggestItems(BOOK, '식', '2026-09-30');
  eq('#T29 이름 부분일치가 앞에 온다', sug[0].itemId, 'v1');
  ok('#T29b 빈 질의는 최근 빈도순', suggestItems(BOOK, '', '2026-09-30')[0].itemId === 'v1');
  eq('#T29c 일치가 없으면 비어 있다', suggestItems(BOOK, 'zzzz', '2026-09-30').length, 0);
  eq('#T29d 거래가 없어도 항목 이름으로는 찾는다', suggestItems(BOOK0, '교통', '2026-09-30')[0].itemId, 'v2');

  eq('#T30 shiftLedgerDate는 UTC 기준(로컬 타임존이 결과를 흔들지 않는다)',
    [shiftLedgerDate('2026-03-01', -1), shiftLedgerDate('2026-12-31', 1)], ['2026-02-28', '2027-01-01']);

  // ── §7 정규화 ───────────────────────────────────────────────────────────
  console.log('\n  §7 정규화 · 멱등 · 지문');
  const legacy = [{ id: 'x', name: 'n', items: [], categories: [], months: {}, createdAt: 0, updatedAt: 0 }];
  ok('#T31 ⚠️ transactions가 없던 레거시 장부는 원본 참조 그대로(멱등 계약)',
    normalizeLedgerBooks(legacy) === legacy);
  const normOnce = normalizeLedgerBooks([JSON.parse(JSON.stringify(BOOK))]);
  ok('#T31b 두 번째 정규화는 같은 참조', normalizeLedgerBooks(normOnce) === normOnce);
  eq('#T31c 거래도 정규화를 통과한다', normOnce[0].transactions.length, 12);

  // ⚠️ Σsplits ≠ amount면 splits를 버리고 단일 항목으로 강등한다(조용한 합계 오류 방지).
  const badSplit = normalizeTx({
    id: 'bs', date: '2026-09-01', amount: 100,
    splits: [{ itemId: 'v1', amount: 60 }, { itemId: 'v2', amount: 30 }],
  });
  eq('#T32 ⚠️ 분할 합이 다르면 강등된다', badSplit.splits.length, 0);
  const goodSplit = normalizeTx({
    id: 'gs', date: '2026-09-01', amount: 100,
    splits: [{ itemId: 'v1', amount: 60 }, { itemId: 'v2', amount: 40 }],
  });
  eq('#T32b 합이 맞으면 유지된다', goodSplit.splits.length, 2);
  eq('#T32c 분할 상한을 넘기면 자른다',
    normalizeTx({ id: 's9', date: '2026-09-01', amount: 9, splits: Array.from({ length: 20 }, () => ({ itemId: 'v1', amount: 1 })) }).splits.length,
    0);   // 20줄 → 8줄로 잘리며 합이 어긋나 강등된다(조용히 8줄만 남기지 않는다)

  eq('#T33 ⚠️ 음수 금액은 환급으로 옮긴다(부호와 플래그가 둘 다 뜻을 갖지 않게)',
    (({ amount, refund }) => ({ amount, refund }))(normalizeTx({ id: 'm', date: '2026-09-01', amount: -500 })),
    { amount: 500, refund: true });
  eq('#T33b 날짜가 없으면 버린다', normalizeTx({ id: 'q', amount: 1 }), null);
  eq('#T33c 달력에 없는 날짜도 버린다', normalizeTx({ id: 'q', date: '2026-02-31', amount: 1 }), null);
  eq('#T33d 화이트리스트 밖 값은 기본값으로',
    (({ kind, origin, pay }) => ({ kind, origin, pay }))(normalizeTx({ id: 'w', date: '2026-09-01', amount: 1, kind: 'x', origin: 'y', pay: 'z' })),
    { kind: 'expense', origin: 'manual', pay: 'card' });
  eq('#T33e 할부는 2~60 정수만',
    [normalizeTx({ id: 'i1', date: '2026-09-01', amount: 1, installmentMonths: 1 }).installmentMonths,
      normalizeTx({ id: 'i2', date: '2026-09-01', amount: 1, installmentMonths: 999 }).installmentMonths],
    [null, 60]);
  // ⚠️ 정규화는 휴지통을 비우지 않는다 — 시간에 따라 결과가 달라지면 멱등이 깨진다.
  eq('#T34 ⚠️ 정규화가 휴지통을 비우지 않는다',
    normalizeLedgerBooks([BOOK])[0].transactions.filter((t) => t.deletedAt).length, 1);

  // 지문
  const fpBase = ledgerFingerprint([BOOK]);
  ok('#T35 거래 금액을 하나만 바꿔도 지문이 달라진다',
    ledgerFingerprint([updateTx(BOOK, 't1', { amount: 4501 })]) !== fpBase);
  ok('#T35b 메모만 바꿔도 달라진다(길이 해시 금지)',
    ledgerFingerprint([updateTx(BOOK, 't1', { memo: '김밥천국2' })]) !== fpBase);
  ok('#T35c 소프트 삭제도 지문에 남는다',
    ledgerFingerprint([softDeleteTx(BOOK, ['t1'], '2026-09-30')]) !== fpBase);
  ok('#T35d entry 전환도 지문에 남는다',
    ledgerFingerprint([addRes.book]) !== ledgerFingerprint([BOOK0]));
  ok('#T35e ⚠️ 같은 참조는 캐시 히트(같은 문자열)', ledgerFingerprint([BOOK]) === fpBase);
  const arr2 = [BOOK];
  ok('#T35f 새 참조는 다시 계산해도 같은 값', ledgerFingerprint(arr2) === fpBase);
  S('#T35g 순환 참조에도 던지지 않는다', () => {
    const c = { ...BOOK, transactions: [] };
    c.self = c;
    return ledgerFingerprint([c]);
  }, (v) => typeof v === 'string');

  ok('#T36 ⚠️ 거래만 있는 장부도 sticky 판정에서 "내용 있음"이다(백업 복원이 지우면 안 된다)',
    ledgerBooksHaveContent([makeLedgerBook({ id: 'z', transactions: [TX[0]] })]) === true);
  ok('#T36b 빈 장부는 여전히 "내용 없음"', ledgerBooksHaveContent([makeLedgerBook({ id: 'z' })]) === false);

  // ── §8 스냅샷 ───────────────────────────────────────────────────────────
  console.log('\n  §8 스냅샷 strip');
  const stripped = stripTxForSnapshot([BOOK, BOOK0]);
  eq('#T37 ⚠️ 스냅샷에는 거래를 넣지 않는다(512KB 예산 보호)',
    [stripped[0].transactions.length, stripped[0].items.length], [0, 4]);
  ok('#T37b 거래가 없던 장부는 원본 참조 그대로(헛된 새 객체 금지)', stripped[1] === BOOK0);
  ok('#T37c 원본은 그대로다', BOOK.transactions.length === 12);

  // ── §9 달력 ─────────────────────────────────────────────────────────────
  console.log('\n  §9 달력 이벤트');
  const ev = ledgerEventsByDate([BOOK], 2026);
  const day5 = (ev['2026-09-05'] || []).find((e) => e.kind === 'tx');
  eq('#T38 그 날 거래 합이 달력 이벤트로 나온다', [day5.txExpense, day5.txCount], [5950, 2]);
  ok('#T38b 휴지통은 달력에도 없다', !(ev['2026-09-20'] || []).some((e) => e.kind === 'tx'));
  ok('#T38c 이체는 달력 지출에 없다', !(ev['2026-09-15'] || []).some((e) => e.kind === 'tx'));
  eq('#T38d 거래 0건 장부는 tx 이벤트가 없다',
    Object.values(ledgerEventsByDate([BOOK0], 2026)).flat().filter((e) => e.kind === 'tx').length, 0);

  // ── §10 엑셀 — 거래 0건 무영향 + 시트 ④ ────────────────────────────────
  console.log('\n  §10 엑셀');
  let LE = null;
  try { LE = await import(pathToFileURL(join(ROOT, 'src/ledgerExcel.ts')).href); } catch { /* 런타임 미지원 */ }
  if (LE) {
    const IN0 = { book: BOOK0, year: 2026, month: 9, todayKST: '2026-09-30' };
    const IN1 = { book: BOOK, year: 2026, month: 9, todayKST: '2026-09-30' };
    const sh0 = LE.buildLedgerSheets(IN0);
    const sh1 = LE.buildLedgerSheets(IN1);
    eq('#T40 시트는 4장이다(④ 거래내역)', sh1.map((s) => s.name), ['월 매트릭스', '대출', '연간요약', '거래내역']);
    // ⚠️ 하위호환의 축 — 거래가 0건이면 ①~③이 **바이트 단위로** 종전과 같아야 한다.
    //    (BOOK0에는 거래가 없으므로 시트 ①~③은 거래 레이어 도입 전과 같은 코드 경로를 탄다.)
    ok('#T41 ⚠️ 거래 0건이면 ①~③이 수동 값만 반영한다',
      JSON.stringify(sh0.slice(0, 3)) === JSON.stringify(LE.buildLedgerSheets({ ...IN0 }).slice(0, 3)));
    const txRows = sh1[3].rows;
    const flat = JSON.stringify(txRows);
    ok('#T42 거래 시트에 분할이 몫마다 한 행으로 들어간다', /장보기/.test(flat) && /주유/.test(flat));
    ok('#T42b 휴지통 거래는 시트에 없다', txRows.every((r) => !JSON.stringify(r).includes('t8')));
    // ⚠️ 시트 합계는 이체를 빼야 한다 — 넣으면 카드대금 결제가 이중 계상된다.
    const totalRow = txRows[txRows.length - 1];
    const totalCell = totalRow[6];
    // 9월 273,950(할부는 결제일 전액) + 8월 180,000 = 453,950. 이체 500,000은 빠진다.
    near('#T43 ⚠️ 합계는 이체를 뺀 그 해 지출이다', totalCell && totalCell.v, 453950, 1e-6);
    ok('#T44 거래가 없으면 안내 행이 들어간다', JSON.stringify(sh0[3].rows).includes('거래가 없습니다'));
    // 미분류가 매트릭스 시트에 살아 있어야 한다(빠지면 화면에는 보이는데 파일엔 없다).
    ok('#T45 매트릭스 시트에 미분류 행이 있다', JSON.stringify(sh1[0].rows).includes('미분류'));
  } else {
    console.log('  ⓘ ledgerExcel.ts를 불러오지 못해 §10을 건너뜁니다.');
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트② 배선 가드 (선언이 아니라 사용부) ──');

const LG = read('src/ledger.ts');
const LP_RAW = read('src/components/LedgerPage.tsx');
const LP = stripComments(LP_RAW);
const QE = stripComments(read('src/components/LedgerQuickEntry.tsx'));
const TT = stripComments(read('src/components/LedgerTxTab.tsx'));
const LEX = stripComments(read('src/ledgerExcel.ts'));
const CAL = stripComments(read('src/components/CalendarModal.tsx'));

// ⚠️ 집계에 `ix`를 넘기지 않으면 거래가 조용히 무시돼 합계가 줄어든다 — 이 저장소가 가장
//    싫어하는 실패 모드(조용한 과소 계상)라 호출부를 하나하나 못 박는다.
ok('#TG1 매트릭스 항목 행이 actualResolved를 쓴다', /const a = actualResolved\(it, k, ix\)\.value;/.test(LP));
ok('#TG1b 월 셀도 actualResolved를 쓴다', /const res = actualResolved\(it, k, ix\);/.test(LP));
// ⚠️ `totalOf(items, k, ix)`는 **월 셀과 연 루프 두 곳**에 있다 — 파일 전역으로 재면 한쪽을
//    되돌려도 다른 쪽이 대신 통과시켜 죽은 단언이 된다(실측: 월 셀 되돌림이 통과했다).
ok('#TG1c 소계 월 셀이 ix를 넘긴다',
  /const e = totalOf\(items, k, ix\);[\s\S]{0,20}?return \{ m, e, ex: exOf\(k\), state: monthState\(e\) \};/.test(LP));
ok('#TG1c-2 소계 연 루프도 ix를 넘긴다',
  /const e = totalOf\(items, k, ix\);[\s\S]{0,20}?yearExpected \+= e\.value;/.test(LP));
ok('#TG1c-3 선택한 달 소계도 ix를 넘긴다', /const cur = totalOf\(items, ym, ix\);/.test(LP));
ok('#TG1d 도넛·차트가 ix를 넘긴다',
  /expectedByPay\(fixedItems, ym, ix\)/.test(LP) && /expectedOf\(it, ym, ix\)/.test(LP)
  && /expectedTotal\(book\?\.items, k, ix\)/.test(LP) && /expectedIncomeTotal\(book\?\.items, k, ix\)/.test(LP));
ok('#TG1e monthTotals가 오늘 달을 넘긴다(진행 중인 달을 미입력으로 세지 않게)',
  /monthTotals\(book, ym, todayYm\)/.test(LP));
ok('#TG1f 엑셀 매트릭스가 actualResolved를 쓴다', /actualResolved\(it, k, ctx\.ix\)\.value/.test(LEX));
// ⚠️ 옛 경로(수동 값만)로 되돌아가면 거래가 통째로 사라진다 — 되돌림을 잡는 음성 대조.
ok('#TG1g ⚠️ 매트릭스가 actualOf로 되돌아가지 않았다',
  !/const a = actualOf\(it, k\);/.test(LP) && !/const a = actualOf\(it, k\);/.test(LEX));

// 인덱스는 화면에서 **한 번만** 만든다(WeakMap 캐시가 있어도 memo가 계약이다).
ok('#TG2 화면이 txIndexOf를 memo로 만든다', /const ix = useMemo\(\(\) => txIndexOf\(book\), \[book\]\)/.test(LP));

// 쓰기 경로
ok('#TG3 빠른 입력이 addTx를 지난다', /const res = addTx\(cur, tx\);/.test(LP));
ok('#TG3b 빠른 입력 바가 그 핸들러에 배선돼 있다', /onAdd=\{handleAddTx\}/.test(LP));
ok('#TG3c ⚠️ 업데이터 안에서 addTx를 부르지 않는다(StrictMode 이중 호출)',
  !/patchBook\([^)]*\(b\) => addTx\(/.test(LP));
ok('#TG4 ⚠️ 삭제는 소프트 삭제다', /softDeleteTx\(b, ids, today\)/.test(LP));
ok('#TG4b 영구 삭제는 휴지통 경로에만 있다', /purgeTx\(b, ids\)/.test(LP) && /trashOnly: trash/.test(TT));
ok('#TG4c 거래 탭의 삭제 버튼이 소프트 삭제를 부른다', /onDeleteTx\?\.\(sel\)/.test(TT) && /onDeleteTx\?\.\(\[tx\.id\]\)/.test(TT));
ok('#TG4d ⚠️ 거래 탭이 배열을 직접 자르지 않는다(hard delete 금지)',
  !/transactions:.*filter/.test(TT) && !/splice\(/.test(TT));

// 매트릭스 셀 — 거래가 있으면 읽기 전용
ok('#TG5 ⚠️ 거래가 있는 칸은 편집 입력이 아니라 버튼이다(단일 소스)',
  /const byTx = res\.source === 'tx';/.test(LP) && /\) : byTx \? \(/.test(LP));
ok('#TG5b 그 칸을 누르면 거래 탭으로 간다', /onClick=\{\(\) => openTxFor\(it\.id\)\}/.test(LP));
ok('#TG5c 가려진 수동 값을 화면이 알린다(조용한 오적용 금지)', /manualShadowed\(it, k, ix\)/.test(LP));

// 미분류
ok('#TG6 미분류 가상 행이 렌더된다', /renderUncategorizedRow\(\)\}/.test(LP));
ok('#TG6b ⚠️ 미분류가 그룹 소계·총계에 더해진다',
  /extra: isVar \? uncTotalOf : null/.test(LP) && /extra: uncTotalOf/.test(LP));
ok('#TG6c 소계 셀이 extra를 값에 더한다', /const cellValue = e\.value \+ \(ex \? ex\.value : 0\);/.test(LP));

// 충돌 프롬프트 — 모달이 아니라 인라인(z-1090 + 별도 창에는 App이 없다)
ok('#TG7 수동값 충돌을 인라인으로 묻는다', /resolveTxConflict\('migrate'\)/.test(LP) && /resolveTxConflict\('drop'\)/.test(LP));
ok('#TG7b ⚠️ 신규 컴포넌트에 notify가 없다', !/notify\(/.test(QE) && !/notify\(/.test(TT));
ok('#TG7c ⚠️ 신규 컴포넌트에 window.confirm/alert이 없다',
  !/window\.confirm|window\.alert/.test(QE) && !/window\.confirm|window\.alert/.test(TT));

// 스냅샷
ok('#TG8 ⚠️ 스냅샷 저장이 거래를 벗긴다', /stripTxForSnapshot\(books\)/.test(LP) && /txStripped: true/.test(LP));
ok('#TG8b ⚠️ 복원이 현재 거래를 유지한다', /const keepTx = new Map\(/.test(LP));

// 달력 — 라이브 파생 + open 게이트
ok('#TG9 달력 칩이 그 날 거래 합을 1순위로 쓴다', /const tx = events\.find\(\(e\) => e && e\.kind === 'tx'\);/.test(CAL));
ok('#TG9b ⚠️ 달력이 open 게이트를 유지한다', /const ledgerByDate = useMemo\(\(\) => \{[\s\S]{0,200}?if \(!open\) return flat;/.test(CAL));
ok('#TG9c ⚠️ 거래를 calendarMemos에 복사하지 않는다',
  !/setMemos[\s\S]{0,80}?transactions/.test(CAL) && !/onUpdateMemos[\s\S]{0,80}?txExpense/.test(CAL));

// import 덩어리 — undefcheck 정규식이 `{...}` 안을 300자까지만 본다
for (const [name, src] of [['LedgerQuickEntry', QE], ['LedgerTxTab', TT]]) {
  const chunks = [...src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\.\/ledger'/g)].map((m) => m[1].length);
  ok(`#TG10 ${name}의 ../ledger import 덩어리가 300자 이하 (${chunks.join(',')})`,
    chunks.length > 0 && chunks.every((n) => n <= 300));
}

// 상수는 모듈 스코프(scopecheck — initTradeRest 프로덕션 장애 선례)
ok('#TG11 거래 탭의 표시 상수가 모듈 스코프에 있다', /^const WEEK = /m.test(TT) && /^const inputCls = /m.test(TT));

// 탭 배선
ok('#TG12 거래 탭이 탭 목록에 있다', /\['tx', '거래'\]/.test(LP));
ok('#TG12b 거래 탭이 렌더된다', /tab === 'tx' \? \([\s\S]{0,200}?<LedgerTxTab/.test(LP));
// ⚠️ 기본 탭은 **상위 books가 도착한 뒤** 한 번만 판정한다(첫 렌더의 book은 시드된 빈 장부다).
ok('#TG12c 기본 탭 판정이 books 도착 후 한 번만 돈다',
  /tabSeededRef\.current = true;/.test(LP) && /if \(!Array\.isArray\(books\) \|\| books\.length === 0\) return;/.test(LP));

// 엑셀 시트 ④
ok('#TG13 엑셀이 시트 4장을 만든다', /buildSummarySheet\(ctx\), buildTxSheet\(ctx\)\]/.test(LEX));
ok('#TG13b ⚠️ 거래 시트 합계가 이체를 뺀다', /if \(tx\.kind === 'expense'\) total \+= amount;/.test(LEX));
ok('#TG13c 거래 시트가 휴지통을 뺀다', /if \(!isLiveTx\(tx\)\) continue;/.test(LEX));

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:ledger-tx — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
