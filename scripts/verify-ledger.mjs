#!/usr/bin/env node
// 가계부(Ledger) 검증.
//
// 구성 ①  src/ledger.ts 를 **직접 import** 해 순수 함수를 테스트한다(미러 금지 — 미러는
//        src에만 넣은 변경/미러에만 넣은 변경이 둘 다 통과하는 구멍을 만든다.
//        실측 사고: verify-backtest의 rebalMode 3필드 누락).
//        ⚠️ 그래서 ledger.ts의 상대 import에는 `.ts` 확장자가 붙어 있다 — 떼면 Node ESM이
//        해석하지 못해 파트①이 통째로 죽는다(#G1b가 단언).
// 구성 ②  소스 텍스트 가드 — 배선은 산술로 표현할 수 없다. **선언이 아니라 사용부**를
//        단언한다. 실패 시 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면
//        정규식을 고칠 것.
//
// 파트①의 중심은 **사용자가 첨부한 실제 스프레드시트 픽스처**다. 대출 4건·고정비·연단위의
// 실측값으로 상환방법 판정, 무반올림 누산, 이중 계상 방지를 동시에 고정한다.
// ⚠️ 그 기대치(544,059 / 1,654,443 / 4,755,266 / 62,743,196 …)를 고치지 말 것 — 실측이다.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
const near = (label, a, b, tol) => ok(`${label} (${a} ≈ ${b} ±${tol})`, typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= tol);

// ⚠️ 금지 토큰 검사는 **주석을 걷어낸 뒤** 한다 — 이 저장소는 금지 사유를 바로 그 자리
//    주석에 적으므로, 원문으로 재면 그 인용문이 유령 사용으로 잡혀 가드가 영구히 실패한다.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// 예외를 그 케이스의 실패로 바꾸는 래퍼. 직접 호출하면 던지는 구현이 스크립트를 통째로
// 중단시켜 어느 계약이 깨졌는지 알 수 없다(verify:chart-sel 선례).
const S = (label, fn, check) => {
  try { const v = fn(); ok(label, check ? check(v) : true); return v; }
  catch (e) { fail++; console.log(`  ✗ ${label} — threw ${e && e.message}`); return undefined; }
};

/** 구간을 잘라 단언한다 — 같은 문장이 여러 곳에 있으면 파일 전역 정규식은 죽은 단언이 된다. */
const sliceBlock = (src, startNeedle, endNeedle) => {
  const i = src.indexOf(startNeedle);
  if (i < 0) return '';
  const j = src.indexOf(endNeedle, i + startNeedle.length);
  return src.slice(i, j < 0 ? src.length : j);
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트① 순수 함수 (src/ledger.ts 직접 import) ──');

let L = null;
try {
  L = await import(pathToFileURL(join(ROOT, 'src/ledger.ts')).href);
} catch (e) {
  // ⚠️ '런타임이 .ts를 못 읽는다'와 '모듈이 깨졌다'를 반드시 구분한다 — 뭉뚱그려 건너뛰면
  //    import 경로에서 `.ts` 확장자를 떼는 것만으로 파트①이 **조용히 사라지고도**
  //    종료코드 0이 나온다(게이트가 무음으로 반쪽이 된다).
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) {
    console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  } else {
    fail++;
    console.log(`  ✗ 파트① 모듈을 불러오지 못했습니다 — ${e && (e.code || e.message)}`);
  }
}

if (L) {
  const {
    loanSchedule, loanAnnualTotal, loanTermMonths, planOf, actualOf, varianceOf,
    commitActual, isItemActive, monthTotals, ledgerKpi, momDelta, yoyDelta, compareMonths,
    ledgerEventsByDate, normalizeLedgerBooks, ledgerBooksHaveContent, ledgerFingerprint,
    makeLedgerItem, makeLedgerLoan, makeLedgerBook,
    addMonthsYm, monthsBetweenYm, makeYm, isValidYm, finiteOr, roundWon,
  } = L;

  ok('#0 필요한 export가 전부 있다', [
    loanSchedule, loanAnnualTotal, planOf, actualOf, varianceOf, commitActual,
    monthTotals, ledgerKpi, momDelta, yoyDelta, ledgerEventsByDate,
    normalizeLedgerBooks, ledgerBooksHaveContent, ledgerFingerprint,
  ].every((f) => typeof f === 'function'));

  // ── §1 날짜 유틸 ─────────────────────────────────────────────────────────
  console.log('\n  §1 날짜 유틸');
  eq('#1 monthsBetweenYm 2026-08 → 2063-04 = 440', monthsBetweenYm('2026-08', '2063-04'), 440);
  eq('#2 monthsBetweenYm 무효 입력은 null', monthsBetweenYm('2026-13', '2027-01'), null);
  eq('#3 addMonthsYm 경계(연 넘김)', addMonthsYm('2026-12', 1), '2027-01');
  eq('#4 addMonthsYm 역방향', addMonthsYm('2026-01', -1), '2025-12');
  eq('#5 addMonthsYm 12개월 전(전년 동월)', addMonthsYm('2026-08', -12), '2025-08');
  ok('#6 isValidYm이 13월을 거부', !isValidYm('2026-13') && isValidYm('2026-12'));
  // ⚠️ cleanNum(utils)은 typeof number면 NaN·Infinity를 그대로 통과시킨다 — finiteOr가 그 방어선.
  eq('#7 finiteOr는 NaN을 통과시키지 않는다', finiteOr(NaN), null);
  eq('#7b finiteOr는 Infinity를 통과시키지 않는다', finiteOr(Infinity), null);
  eq('#7c finiteOr는 문자열 숫자를 통과시키지 않는다', finiteOr('1000'), null);

  // ── §2 대출: 사진 실측 픽스처 ─────────────────────────────────────────────
  console.log('\n  §2 대출 상환 — 첨부 스프레드시트 실측 재현');
  const BASE = '2026-08';
  const mkLoan = (o) => makeLedgerLoan({ principalAsOfYm: BASE, ...o });

  // 신용대출: P×r/12가 353,875와 **정확히** 일치 → 만기일시(이자만)
  const credit = mkLoan({ principal: 95000000, annualRate: 4.47, method: 'interestOnly', endDate: '2027-11-13' });
  near('#8 신용대출(이자만) 월 353,875', loanSchedule(credit, BASE).payment, 353875, 0.5);
  eq('#8b 이자만은 원금 상환분이 0', loanSchedule(credit, BASE).principalPart, 0);

  // APT1/APT2: 원리금균등, 만기 2063-04
  const apt1 = mkLoan({ principal: 131283083, annualRate: 3.70, method: 'amortizing', endDate: '2063-04-07' });
  const apt2 = mkLoan({ principal: 74631352, annualRate: 4.19, method: 'amortizing', endDate: '2063-04-07' });
  eq('#9 만기 2063-04 → 잔여 440개월', loanTermMonths(apt1), 440);
  near('#10 APT1 원리금균등 ≈ 544,059 (사진)', loanSchedule(apt1, BASE).payment, 544059, 1600);
  near('#11 APT2 원리금균등 ≈ 333,220 (사진)', loanSchedule(apt2, BASE).payment, 333220, 1000);

  // ⚠️ 이 기능의 최중요 계약 — 납입액이 **시간에 따라 드리프트하지 않는다**.
  //    principalAsOfYm 없이 "만기 − 오늘"로 n을 재면 APT1이 1년에 +8,757원(+1.3%) 상승한다.
  const p0 = loanSchedule(apt1, BASE).payment;
  const p6 = loanSchedule(apt1, addMonthsYm(BASE, 6)).payment;
  const p12 = loanSchedule(apt1, addMonthsYm(BASE, 12)).payment;
  ok('#12 ⚠️ 원리금균등은 만기까지 고정 — 6개월 뒤에도 같은 값', p0 === p6);
  ok('#12b ⚠️ 12개월 뒤에도 같은 값(드리프트 0)', p0 === p12);

  // 전세: 어떤 방식으로도 재현되지 않는다 → override가 권위
  const jeonse = mkLoan({ principal: 159550000, annualRate: 2.73, method: 'amortizing', endDate: '2028-06-30', paymentOverride: 423289 });
  eq('#13 ⚠️ 사용자 입력(override)이 계산을 덮어쓴다', loanSchedule(jeonse, BASE).payment, 423289);
  eq('#13b override의 출처가 표시된다', loanSchedule(jeonse, BASE).source, 'override');

  // ── §3 대출: null 계약 (NaN / Infinity / 음수) ────────────────────────────
  console.log('\n  §3 대출 null 계약 — NaN·Infinity·음수가 합계로 새지 않을 것');
  // ⚠️ 순진한 PMT는 여기서 각각 NaN / Infinity / −33,222,469를 낸다. 셋 다 typeof 'number'라
  //    타입으로는 안 걸리고 Σ를 지나 전 KPI를 오염시킨다. `payment > 0` 검사는 Infinity를
  //    통과시키므로 Number.isFinite만이 막는다.
  const zeroRate = mkLoan({ principal: 100000000, annualRate: 0, method: 'amortizing', termMonths: 120 });
  const zr = loanSchedule(zeroRate, BASE);
  ok('#14 ⚠️ 무이자(i=0)가 NaN이 아니다', zr !== null && Number.isFinite(zr.payment));
  near('#14b 무이자는 원금/기간', zr.payment, 100000000 / 120, 0.001);
  eq('#15 ⚠️ 잔여 0개월(n=0)은 Infinity가 아니라 null',
    loanSchedule(mkLoan({ principal: 1e8, annualRate: 4, method: 'amortizing', termMonths: 0 }), BASE), null);
  eq('#16 ⚠️ 만기 경과(n<0)는 음수가 아니라 null',
    loanSchedule(mkLoan({ principal: 1e8, annualRate: 4, method: 'amortizing', endDate: '2026-05-01' }), BASE), null);
  eq('#17 기준월(principalAsOfYm) 없으면 계산 포기 = null',
    loanSchedule(makeLedgerLoan({ principal: 1e8, annualRate: 4, method: 'amortizing', endDate: '2063-04-07' }), BASE), null);
  eq('#18 기준월 이전 달은 아직 시작 전 = null', loanSchedule(apt1, '2026-07'), null);
  eq('#19 잔액 0은 null (0원 납입이 아니다)',
    loanSchedule(mkLoan({ principal: 0, annualRate: 4, method: 'amortizing', termMonths: 120 }), BASE), null);
  eq('#20 만기 당월 이후는 null', loanSchedule(mkLoan({ principal: 1e8, annualRate: 4, method: 'amortizing', termMonths: 3 }), addMonthsYm(BASE, 3)), null);
  S('#21 손상 입력에 throw하지 않는다', () => loanSchedule(null, BASE), (v) => v === null);
  S('#21b 무효 ym에 throw하지 않는다', () => loanSchedule(apt1, '2026-13'), (v) => v === null);

  // ── §4 원금균등 — 매달 감소, 연 합계는 스케줄 합 ──────────────────────────
  console.log('\n  §4 원금균등 — 첫 회차 × 12로 과대 계상하지 않을 것');
  const ep = mkLoan({ principal: 120000000, annualRate: 6, method: 'equalPrincipal', termMonths: 120, principalAsOfYm: '2026-01' });
  const e0 = loanSchedule(ep, '2026-01').payment;
  const e1 = loanSchedule(ep, '2026-02').payment;
  const e11 = loanSchedule(ep, '2026-12').payment;
  near('#22 원금균등 1회차 = 원금/n + 잔액×i', e0, 120000000 / 120 + 120000000 * 0.005, 0.01);
  ok('#23 ⚠️ 회차가 갈수록 납입액이 줄어든다', e0 > e1 && e1 > e11);
  ok('#24 levelPayment=false로 표시된다', loanSchedule(ep, '2026-01').levelPayment === false);
  const epYear = loanAnnualTotal(ep, 2026);
  ok('#25 ⚠️ 연 합계가 1회차×12보다 작다(과대 계상 방지)', epYear.total < e0 * 12);
  near('#25b 연 합계 = 12회차 스케줄 합', epYear.total,
    Array.from({ length: 12 }, (_, k) => loanSchedule(ep, makeYm(2026, k + 1)).payment).reduce((a, b) => a + b, 0), 0.001);
  ok('#26 원리금균등의 levelPayment=true', loanSchedule(apt1, BASE).levelPayment === true);
  const creditYear = loanAnnualTotal(credit, 2026);
  ok('#26b 만기 경과 달은 missing으로 세어진다(합계에 0으로 섞이지 않음)', creditYear.missing >= 0);

  // 거치기간
  const grace = mkLoan({ principal: 1e8, annualRate: 6, method: 'amortizing', termMonths: 120, graceMonths: 12, principalAsOfYm: '2026-01' });
  near('#27 거치 중에는 이자만', loanSchedule(grace, '2026-06').payment, 1e8 * 0.005, 0.01);
  ok('#27b 거치 표시', loanSchedule(grace, '2026-06').inGrace === true);
  ok('#27c 거치 종료 후에는 원리금균등', loanSchedule(grace, '2027-02').payment > 1e8 * 0.005);

  // ── §5 항목 계획/실적 ────────────────────────────────────────────────────
  console.log('\n  §5 계획 · 실적 · 미입력 구분');
  const ms365 = makeLedgerItem({ group: 'fixed', pay: 'card', name: 'MS OFFICE 365', plan: 127000, planUnit: 'year' });
  // ⚠️ 무반올림 — 10,583으로 반올림하면 예상 年 지출이 4원 어긋난다(#40).
  near('#28 연 구독은 /12로 월 환산 (무반올림)', planOf(ms365, BASE), 127000 / 12, 1e-9);
  ok('#28b ⚠️ 반올림되지 않았다', planOf(ms365, BASE) !== 10583);

  const netflix = makeLedgerItem({ group: 'fixed', pay: 'card', name: 'NETFLIX', plan: 17000 });
  eq('#29 월 단위 계획은 그대로', planOf(netflix, BASE), 17000);

  const tax = makeLedgerItem({ group: 'annual', pay: 'cash', name: '재산세', plan: 300000, dueMonth: 9, dueDay: 16 });
  eq('#30 연단위는 납부월에만 계상', planOf(tax, '2026-09'), 300000);
  eq('#30b 연단위는 그 외 달엔 0(null 아님 — "계획 없음"의 확정)', planOf(tax, '2026-08'), 0);
  eq('#30c 납부월 미지정이면 null', planOf(makeLedgerItem({ group: 'annual', plan: 300000 }), '2026-09'), null);

  // ⚠️ 미입력(키 없음)과 0원(명시적 0)은 다른 뜻이다.
  const withActual = makeLedgerItem({ group: 'fixed', plan: 17000, actual: { '2026-08': 0 } });
  eq('#31 ⚠️ 명시적 0은 0으로 읽힌다', actualOf(withActual, '2026-08'), 0);
  eq('#31b ⚠️ 키가 없으면 null (미입력)', actualOf(withActual, '2026-09'), null);
  eq('#31c 미입력의 차이는 null', varianceOf(withActual, '2026-09'), null);
  eq('#31d 명시적 0의 차이는 −계획', varianceOf(withActual, '2026-08'), -17000);

  // commitActual — cleanNum을 쓰면 빈칸이 0이 되어 이 구분이 붕괴한다.
  eq('#32 ⚠️ 빈 문자열 커밋은 키를 지운다',
    Object.prototype.hasOwnProperty.call(commitActual({ '2026-08': 5 }, '2026-08', ''), '2026-08'), false);
  eq('#32b 0 입력은 키를 남긴다', commitActual({}, '2026-08', '0')['2026-08'], 0);
  eq('#32c 콤마를 허용한다', commitActual({}, '2026-08', '1,234,567')['2026-08'], 1234567);
  ok('#32d 잘못된 입력은 기존 값을 보존한다', commitActual({ '2026-08': 5 }, '2026-08', 'abc')['2026-08'] === 5);
  ok('#32e 값이 그대로면 같은 참조를 돌려준다(불필요 저장 방지)',
    (() => { const a = { '2026-08': 5 }; return commitActual(a, '2026-08', '5') === a; })());

  // activeFrom / activeTo
  const midYear = makeLedgerItem({ group: 'fixed', plan: 1000, activeFrom: '2026-07' });
  eq('#33 ⚠️ 편입 전 달은 계획이 null (존재하지 않던 달에 미입력으로 계상 금지)', planOf(midYear, '2026-06'), null);
  eq('#33b 편입 후에는 정상', planOf(midYear, '2026-07'), 1000);
  ok('#33c isItemActive가 종료일도 본다',
    isItemActive(makeLedgerItem({ activeTo: '2026-06' }), '2026-07') === false);

  // ── §6 KPI: 사진 전체 재현 ───────────────────────────────────────────────
  console.log('\n  §6 KPI — 첨부 스프레드시트 전체 재현');
  const cashItems = [
    ['실손보험', 80000], ['통신비', 30000], ['지역 가입 건강보험료', 500000],
  ].map(([n, v]) => makeLedgerItem({ group: 'fixed', pay: 'cash', name: n, plan: v }));
  const cardVals = [
    ['관리비 1', 450000], ['관리비 2', 250000], ['NETFLIX', 17000], ['마운자로', 560000],
    ['GOOGLE DRIVE', 29000], ['YOUTUBE 프리미엄', 14900], ['SK 세븐모바일', 52800],
    ['인터넷 브로드밴드', 24750], ['밀리의 서재 구독', 10000], ['어스얼라이언스', 9900],
    ['APPLE cloud구독', 1100], ['vFlat Scan 구독', 4900], ['와이스트릿', 150000],
    ['이스트소프트 구독', 990], ['네이버플러스구독', 4900], ['현대카드', 300000], ['삼성카드', 600000],
  ].map(([n, v]) => makeLedgerItem({ group: 'fixed', pay: 'card', name: n, plan: v }));
  const cardItems = [...cardVals, ms365];   // MS365는 연 구독(planUnit:'year')
  const annualItems = [
    ['자동차세', 80000, 6, 16], ['재산세', 300000, 9, 16], ['운전자보험', 1000000, 11, 20],
    ['해외 양도소득세', 3300000, 5, 31], ['이선엽강의', 1000000, 3, 10],
  ].map(([n, v, mo, dy]) => makeLedgerItem({ group: 'annual', pay: 'cash', name: n, plan: v, dueMonth: mo, dueDay: dy }));
  const loanItems = [
    ['APT 1', apt1], ['APT 2', apt2], ['전세', jeonse], ['신용대출', credit],
  ].map(([n, l]) => makeLedgerItem({ group: 'loan', pay: 'transfer', name: n, loan: l }));

  const book = makeLedgerBook({ id: 'b1', name: '가계부', items: [...loanItems, ...cashItems, ...cardItems, ...annualItems] });
  const k = ledgerKpi(book, BASE);

  eq('#34 대출금 합계 460,464,435', Math.round(k.loanPrincipal), 460464435);
  near('#35 대출 월 납입 합계 1,654,443 (사진)', k.loanMonthly, 1654443, 1700);
  near('#36 월 납입 이율 0.359%', k.loanMonthlyRate * 100, 0.359, 0.001);
  near('#37 년 납입 이율 4.312%', k.loanAnnualRate * 100, 4.312, 0.01);
  near('#38 연 납입액 19,853,316', k.loanAnnualPayment, 19853316, 20000);
  // 대출은 계산 근사(±1,600)가 있으므로 사진과 완전히 같은 월합을 만들려면 override를 쓴다.
  const bookExact = makeLedgerBook({
    id: 'b2', name: '가계부(실측)',
    items: [
      ...([['APT 1', 544059], ['APT 2', 333220], ['전세', 423289], ['신용대출', 353875]]
        .map(([n, pay]) => makeLedgerItem({
          group: 'loan', pay: 'transfer', name: n,
          loan: mkLoan({ principal: 1, annualRate: 0, method: 'interestOnly', endDate: '2063-04-07', paymentOverride: pay }),
        }))),
      ...cashItems, ...cardItems, ...annualItems,
    ],
  });
  const ke = ledgerKpi(bookExact, BASE);
  near('#39 ⚠️ 월 지출 합계 4,755,266.333 (무반올림)', ke.recurringMonthly, 4755266 + 1 / 3, 0.001);
  eq('#39b 표시용 반올림은 4,755,266', roundWon(ke.recurringMonthly), 4755266);
  eq('#40 년단위 합계 5,680,000', ke.annualLumpSum, 5680000);
  // ⚠️ 이 4원이 이 기능의 반올림 규약 전체를 고정한다. 항목별로 반올림하면 62,743,192가 나온다.
  eq('#41 ⚠️ 예상 年 지출 62,743,196 (중간 반올림 금지)', roundWon(ke.projectedAnnual), 62743196);
  eq('#41b 예상 月 지출 5,228,600', roundWon(ke.projectedMonthly), 5228600);
  ok('#41c ⚠️ 항목별 반올림이면 62,743,192가 되어 사진과 어긋난다', roundWon(ke.projectedAnnual) !== 62743192);

  // ⚠️ 이중 계상 방지 — annual을 월 합계에 넣으면 예상 年 지출에서 12배가 된다.
  ok('#42 ⚠️ 월 지출 합계에 연단위가 섞이지 않았다', ke.recurringMonthly < 5000000);
  eq('#42b 예상 年 = 월합×12 + 연단위', roundWon(ke.projectedAnnual), roundWon(ke.recurringMonthly * 12 + ke.annualLumpSum));

  // DSR
  const withIncome = makeLedgerBook({
    id: 'b3', items: [...bookExact.items, makeLedgerItem({ group: 'income', pay: 'transfer', name: '급여', plan: 71932304 / 12 })],
  });
  near('#43 DSR 27.6% (사진 H9)', ledgerKpi(withIncome, BASE).dsr * 100, 27.6, 0.1);
  eq('#43b ⚠️ 수입이 없으면 DSR은 0이 아니라 null', ke.dsr, null);
  eq('#43c ⚠️ 수입이 없으면 저축여력도 null', ke.savingCapacity, null);
  ok('#43d 수입이 있으면 저축여력 = 수입 − 예상 月 지출',
    Math.abs(ledgerKpi(withIncome, BASE).savingCapacity - (71932304 / 12 - ke.projectedMonthly)) < 0.01);

  // ⚠️ 수입이 지출 합계에 섞이지 않는다(kind/group 이중 축 제거의 근거)
  eq('#44 ⚠️ 수입 항목이 월 지출 합계를 바꾸지 않는다',
    roundWon(ledgerKpi(withIncome, BASE).recurringMonthly), roundWon(ke.recurringMonthly));

  // 계산 실패 대출은 조용히 0이 되지 않고 세어진다
  const brokenBook = makeLedgerBook({ items: [makeLedgerItem({ group: 'loan', name: '깨진대출', loan: makeLedgerLoan({ principal: 1e8, annualRate: 4 }) })] });
  eq('#45 ⚠️ 계산 불가 대출은 loanUnresolved로 노출된다', ledgerKpi(brokenBook, BASE).loanUnresolved, 1);
  eq('#45b 그 값이 0으로 합계에 섞이지 않는다', ledgerKpi(brokenBook, BASE).loanMonthly, 0);

  // ── §7 월 집계 ───────────────────────────────────────────────────────────
  console.log('\n  §7 월 집계 — 미입력은 0이 아니다');
  const partial = makeLedgerBook({
    items: [
      makeLedgerItem({ group: 'fixed', pay: 'cash', plan: 100000, actual: { '2026-08': 120000 } }),
      makeLedgerItem({ group: 'fixed', pay: 'card', plan: 200000 }),                 // 미입력
      // ⚠️ 수입의 결제수단을 'cash'로 둔다 — byPay가 수입을 섞으면 '현금합계'가 급여만큼
      //    부풀어 사진의 610,000과 어긋난다. #48c가 정확히 그 회귀를 잡는다.
      makeLedgerItem({ group: 'income', pay: 'cash', plan: 3000000, actual: { '2026-08': 3000000 } }),
    ],
  });
  const t = monthTotals(partial, '2026-08');
  eq('#46 실제 지출은 입력된 것만 합산', t.actualExpense, 120000);
  eq('#46b 계획 지출은 전부 합산', t.planExpense, 300000);
  eq('#47 ⚠️ 미입력 건수가 노출된다', t.missingExpense, 1);
  eq('#47b 수입은 지출과 분리', t.actualIncome, 3000000);
  eq('#48 결제수단별 소계 — 현금', t.byPay.cash.actual, 120000);
  eq('#48b 결제수단별 소계 — 카드(미입력이라 0)', t.byPay.card.actual, 0);
  eq('#48c ⚠️ byPay는 지출 전용 — 수입이 섞이지 않는다(현금 소계가 3,120,000이 아니다)',
    t.byPay.cash.actual, 120000);

  // ── §8 전월/전년 비교 — 입력 완료도가 다르면 숫자를 내지 않는다 ────────────
  console.log('\n  §8 비교 — 미입력이 다르면 숫자 금지');
  const mkMonth = (id, a7, a8) => makeLedgerItem({
    group: 'fixed', plan: 1000, id,
    actual: { ...(a7 !== null ? { '2026-07': a7 } : {}), ...(a8 !== null ? { '2026-08': a8 } : {}) },
  });
  const evenBook = makeLedgerBook({ items: [mkMonth('a', 1000, 1200), mkMonth('b', 2000, 1800)] });
  const md = momDelta(evenBook, '2026-08');
  ok('#49 완료도가 같으면 비교 성립', md.comparable === true);
  eq('#49b 증감액', md.delta, 0);
  // ⚠️ 진행 중인 달은 항상 미입력이 많다 — 그게 기본 상태다. 여기서 숫자를 내면 상시 거짓말.
  const unevenBook = makeLedgerBook({ items: [mkMonth('a', 1000, 1200), mkMonth('b', 2000, null)] });
  const mu = momDelta(unevenBook, '2026-08');
  ok('#50 ⚠️ 완료도가 다르면 comparable=false', mu.comparable === false);
  eq('#50b ⚠️ delta가 null (0.00%로 단언 금지)', mu.delta, null);
  eq('#50c ⚠️ rate도 null', mu.rate, null);
  eq('#50d 사유가 노출된다', mu.reason, 'missing-mismatch');
  ok('#50e 미입력 건수 자체는 양쪽 다 보인다', mu.prevMissing === 0 && mu.curMissing === 1);
  const noPrev = momDelta(makeLedgerBook({ items: [mkMonth('a', null, 1200)] }), '2026-08');
  ok('#51 전월 기록이 없으면 comparable=false', noPrev.comparable === false && noPrev.reason === 'no-prev');

  // ⚠️ 전년 대비는 같은 장부 안에서 성립해야 한다(LedgerBook.year를 두면 구조적으로 불가능).
  const yoyBook = makeLedgerBook({
    items: [makeLedgerItem({ group: 'fixed', plan: 1000, actual: { '2025-08': 1000, '2026-08': 1500 } })],
  });
  const yd = yoyDelta(yoyBook, '2026-08');
  ok('#52 ⚠️ 전년 동월 비교가 같은 장부에서 성립한다', yd.comparable === true);
  eq('#52b 전년 대비 증감액', yd.delta, 500);
  near('#52c 전년 대비 증감률 50%', yd.rate * 100, 50, 1e-9);
  eq('#53 분모가 0이면 rate는 null(delta는 유효)',
    compareMonths(makeLedgerBook({ items: [makeLedgerItem({ plan: 1, actual: { '2026-07': 0, '2026-08': 100 } })] }), '2026-08', '2026-07').rate, null);

  // ── §9 메모 달력 이벤트 ──────────────────────────────────────────────────
  console.log('\n  §9 메모 달력 이벤트 (라이브 파생)');
  const calBook = makeLedgerBook({
    id: 'cb', name: '우리집 가계부',
    items: [...annualItems, makeLedgerItem({ group: 'fixed', plan: 1000, actual: { '2026-07': 1000, '2026-08': 900 } })],
    months: { '2026-08': { touchedDate: '2026-08-25', memo: '8월 정리' } },
  });
  const ev = ledgerEventsByDate([calBook], 2026);
  ok('#54 정리 기록이 그 날짜에 걸린다', Array.isArray(ev['2026-08-25']) && ev['2026-08-25'][0].kind === 'touch');
  eq('#54b 그 달 총지출이 실린다', ev['2026-08-25'][0].actualExpense, 900);
  eq('#54c 전월 대비가 실린다', ev['2026-08-25'][0].momDelta, -100);
  ok('#55 연단위 지출이 납부 예정일에 걸린다',
    Array.isArray(ev['2026-09-16']) && ev['2026-09-16'].some((e) => e.kind === 'annual' && e.itemName === '재산세'));
  eq('#55b 항목 금액이 실린다', ev['2026-09-16'].find((e) => e.kind === 'annual').amount, 300000);
  // ⚠️ 두 이벤트의 수명이 다르다(같게 만들지 말 것): 연단위 지출(재산세·자동차세)은 **매년
  //    반복**되므로 다른 해에도 떠야 하고, '정리 기록'은 그 날 실제로 일어난 사건이라
  //    그 해에만 떠야 한다.
  const ev2030 = ledgerEventsByDate([calBook], 2030);
  ok('#56 연단위 지출은 매년 반복된다',
    Array.isArray(ev2030['2030-09-16']) && ev2030['2030-09-16'].some((e) => e.kind === 'annual'));
  ok('#56b ⚠️ 정리 기록은 그 해에만 뜬다(반복 금지)',
    Object.values(ev2030).flat().every((e) => e.kind !== 'touch'));
  ok('#56c 편입 기간 밖이면 연단위도 뜨지 않는다',
    Object.keys(ledgerEventsByDate([makeLedgerBook({
      items: [makeLedgerItem({ group: 'annual', plan: 1, dueMonth: 9, dueDay: 16, activeTo: '2027-12' })],
    })], 2030)).length === 0);
  S('#56d 손상 입력에 throw하지 않는다', () => ledgerEventsByDate(null, 2026), (v) => v && Object.keys(v).length === 0);
  S('#56e 손상된 touchedDate를 무시한다',
    () => ledgerEventsByDate([makeLedgerBook({ months: { '2026-08': { touchedDate: '2026-13-99', memo: '' } } })], 2026),
    (v) => Object.keys(v).length === 0);

  // ── §10 영속화 계약 ──────────────────────────────────────────────────────
  console.log('\n  §10 영속화 — 정규화 / sticky / 지문');
  S('#57 손상 입력을 빈 배열로', () => normalizeLedgerBooks(null), (v) => Array.isArray(v) && v.length === 0);
  // ⚠️ 멱등이 아니면 ① Drive 폴링마다 재저장 ② 로컬 사본 시드가 갈아엎어 2.5초 idle 승격 전
  //    편집이 사라진다.
  const once = normalizeLedgerBooks([JSON.parse(JSON.stringify(calBook))]);
  ok('#58 ⚠️ 두 번째 정규화는 같은 참조를 돌려준다(멱등)', normalizeLedgerBooks(once) === once);
  ok('#58b 정규화가 값을 보존한다', once[0].items.length === calBook.items.length && once[0].name === '우리집 가계부');
  ok('#59 무효 group은 기본값으로 떨어진다',
    normalizeLedgerBooks([{ items: [{ group: 'bogus', pay: 'nope' }] }])[0].items[0].group === 'fixed');
  ok('#59b 무효 ym 키는 버려진다',
    Object.keys(normalizeLedgerBooks([{ items: [{ actual: { '2026-13': 5, '2026-08': 7 } }] }])[0].items[0].actual).join() === '2026-08');
  ok('#59c 상한을 넘는 장부는 잘린다', normalizeLedgerBooks(Array.from({ length: 9 }, () => ({ items: [] }))).length === L.MAX_LEDGER_BOOKS);

  // ⚠️ 화면을 열기만 해도 빈 장부가 1권 생긴다 — length 기준이면 백업 복원이 영구히 막힌다.
  ok('#60 ⚠️ 빈 장부 1권은 "내용 없음"', ledgerBooksHaveContent([makeLedgerBook()]) === false);
  ok('#60b 항목에 이름만 있어도 "내용 있음"', ledgerBooksHaveContent([makeLedgerBook({ items: [makeLedgerItem({ name: 'x' })] })]) === true);
  ok('#60c 실적만 있어도 "내용 있음"', ledgerBooksHaveContent([makeLedgerBook({ items: [makeLedgerItem({ actual: { '2026-08': 1 } })] })]) === true);
  ok('#60d 월 메모만 있어도 "내용 있음"', ledgerBooksHaveContent([makeLedgerBook({ months: { '2026-08': { touchedDate: '2026-08-01', memo: '' } } })]) === true);
  ok('#60e 배열이 아니면 false', ledgerBooksHaveContent(null) === false);

  // ⚠️ 지문이 던지면 그 세션의 Drive 저장이 통째로 멈춘다.
  S('#61 ⚠️ 순환 참조에도 던지지 않는다', () => {
    const c = makeLedgerBook(); c.items.push(makeLedgerItem()); c.items[0].loan = c;
    return ledgerFingerprint([c]);
  }, (v) => typeof v === 'string');
  ok('#62 ⚠️ 본문만 고쳐도 지문이 바뀐다(길이 해시 절충 금지)',
    ledgerFingerprint([makeLedgerBook({ items: [makeLedgerItem({ memo: 'A' })] })]) !==
    ledgerFingerprint([makeLedgerBook({ items: [makeLedgerItem({ memo: 'B' })] })]));
  ok('#62b ⚠️ 실적 1건만 고쳐도 지문이 바뀐다',
    ledgerFingerprint([makeLedgerBook({ items: [makeLedgerItem({ id: 'x', actual: { '2026-08': 1 } })] })]) !==
    ledgerFingerprint([makeLedgerBook({ items: [makeLedgerItem({ id: 'x', actual: { '2026-08': 2 } })] })]));
  ok('#62c ⚠️ 대출 필드도 지문에 든다',
    ledgerFingerprint([makeLedgerBook({ items: [makeLedgerItem({ id: 'x', loan: makeLedgerLoan({ principal: 1 }) })] })]) !==
    ledgerFingerprint([makeLedgerBook({ items: [makeLedgerItem({ id: 'x', loan: makeLedgerLoan({ principal: 2 }) })] })]));
  ok('#63 updatedAt은 지문에서 제외(저장 churn 방지)',
    ledgerFingerprint([makeLedgerBook({ id: 'x', updatedAt: 1 })]) === ledgerFingerprint([makeLedgerBook({ id: 'x', updatedAt: 2 })]));
  ok('#63b 키 순서가 달라도 지문이 같다',
    ledgerFingerprint([makeLedgerBook({ id: 'x', items: [makeLedgerItem({ id: 'i', actual: { '2026-08': 1, '2026-07': 2 } })] })]) ===
    ledgerFingerprint([makeLedgerBook({ id: 'x', items: [makeLedgerItem({ id: 'i', actual: { '2026-07': 2, '2026-08': 1 } })] })]));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트② 소스 텍스트 가드(배선) ──');

const LG_RAW = read('src/ledger.ts');
const LG = stripComments(LG_RAW);
const APP_RAW = read('src/App.tsx');
const APP = stripComments(APP_RAW);
const SYNC = stripComments(read('src/hooks/useDriveSync.ts'));
const MAIN = stripComments(read('src/main.tsx'));
const GATE = stripComments(read('src/components/LoginGate.tsx'));
const ADMIN = stripComments(read('src/components/AdminPage.tsx'));
const UIB = stripComments(read('src/components/UserInfoBar.tsx'));
const AS = read('_downloads/AppsScript_계정관리_arui114501.js');
const PKG = JSON.parse(read('package.json'));

// ── 모듈 자체 계약 ──────────────────────────────────────────────────────────
ok('#G1 ledger.ts가 필요한 함수를 export한다',
  /export const loanSchedule/.test(LG) && /export const ledgerKpi/.test(LG) &&
  /export const normalizeLedgerBooks/.test(LG) && /export const ledgerFingerprint/.test(LG) &&
  /export const ledgerBooksHaveContent/.test(LG));
// ⚠️ 확장자를 떼면 Node ESM이 해석하지 못해 파트①이 통째로 죽는다(빌드는 통과하므로 무음).
ok('#G1b 상대 import에 .ts 확장자가 붙어 있다',
  /from '\.\/utils\.ts'/.test(LG_RAW) && !/from '\.\/utils'/.test(LG_RAW));
// ⚠️ Node 타입 스트리핑은 enum/namespace를 지원하지 않는다(erasableSyntaxOnly와 같은 계약).
ok('#G1c enum/namespace를 쓰지 않는다', !/^\s*(export\s+)?(enum|namespace)\s/m.test(LG));
// ⚠️ 이 파일의 타입이 이 데이터의 유일한 안전망이다(빌드는 esbuild, 타입체크 없음).
ok('#G1d @ts-nocheck를 붙이지 않았다', !/^\s*\/\/\s*@ts-nocheck\s*$/m.test(LG_RAW));
ok('#G1e ⚠️ 순수 모듈이다 — 저장·네트워크·React 없음',
  !/localStorage|sessionStorage|fetch\(|useState|useEffect|document\./.test(LG));
// ⚠️ stockHistoryMap은 보유 평가액 재계산의 권위 소스다 — 가계부가 건드리면 과거 평가액이 오염된다.
ok('#G1f ⚠️ stockHistoryMap을 건드리지 않는다', !/stockHistoryMap/.test(LG));
// ⚠️ cleanNum은 typeof number면 NaN·Infinity를 그대로 통과시킨다.
ok('#G1g ⚠️ cleanNum을 쓰지 않는다(NaN/Infinity 통과)', !/cleanNum/.test(LG));
// ⚠️ 유한성 게이트가 없으면 NaN·Infinity가 전 KPI로 번진다. `payment > 0`은 Infinity를 통과시킨다.
ok('#G1h ⚠️ loanSchedule에 Number.isFinite 게이트가 있다',
  /!Number\.isFinite\(payment\)\s*\|\|\s*payment\s*<\s*0/.test(LG));
ok('#G1i ⚠️ 집계도 Number.isFinite로 거른다', (LG.match(/Number\.isFinite/g) || []).length >= 6);
// ⚠️ 중간 반올림은 사진의 62,743,196을 62,743,192로 만든다.
ok('#G1j ⚠️ KPI 누산에 Math.round가 없다',
  !/Math\.round/.test(sliceBlock(LG, 'export const ledgerKpi', '\n};')));
// ⚠️ 'kind'와 'group' 이중 축을 되살리면 수입이 지출 합계에 섞인다.
ok('#G1k ⚠️ kind 이중 축을 되살리지 않았다', !/\bkind:\s*LedgerKind\b/.test(LG));
// ⚠️ LedgerBook.year를 두면 전년 대비가 구조적으로 불가능해진다.
ok('#G1l ⚠️ LedgerBook에 year 필드가 없다',
  !/^\s*year:\s*number;/m.test(sliceBlock(LG, 'export interface LedgerBook', '\n}')));
// ⚠️ 잔액의 기준월이 없으면 월 납입액이 매달 드리프트한다.
ok('#G1m ⚠️ principalAsOfYm이 모델과 계산에 모두 있다',
  /principalAsOfYm:\s*string;/.test(LG) && /loan\.principalAsOfYm/.test(LG));

// ── 영속화 7지점 ───────────────────────────────────────────────────────────
// ⚠️ 지문 누락 = portfolioUpdatedAt 미상승 = STATE 저장 통째 스킵. 이 저장소에서 6회 재발한
//    버그 클래스(historyVerifyKey · investmentNotesKey · holdingSnapshotsKey · calendarMemos ·
//    targetAmount · overseasLinks). 화면은 정상이라 조용한 세션에서만 재현된다.
ok('#G2 useState 선언', /const\s*\[\s*ledgerBooks\s*,\s*setLedgerBooks\s*\]\s*=\s*useState/.test(APP));
ok('#G2b ⚠️ portfolioStructureKey 지문에 든다', /ledgerFingerprint\(\s*ledgerBooks\s*\)/.test(APP));
ok('#G2c 저장 payload 리터럴에 실린다', /const state = \{[^\n]*\bledgerBooks\b[^\n]*\}/.test(APP));
// ⚠️ deps 정규식을 '배열의 마지막 항목'으로 고정하지 말 것 — 뒤에 새 필드가 붙으면 계약은
//    멀쩡한데 단언만 깨진다(verify-flow #32의 교훈). 존재+인접만 본다.
ok('#G2d 저장 effect deps에 있다', /backtestScenarios\s*,\s*ledgerBooks\s*[,\]]/.test(APP));
// ⚠️ payload(③)만 넣고 로드(⑤⑥)를 빠뜨리면 매 저장이 Drive를 빈 배열로 덮는 '영구 파괴'다.
ok('#G2e applyStateData가 정규화해 로드한다',
  /stateData\.ledgerBooks[\s\S]{0,140}?normalizeLedgerBooks/.test(APP));
// ⚠️ sticky 판정은 length가 아니라 공유 함수로 — 화면을 열기만 해도 빈 장부가 생긴다.
ok('#G2f applyBackupData가 sticky 규칙을 쓴다',
  /setLedgerBooks\(\s*prev\s*=>\s*ledgerBooksHaveContent\(prev\)/.test(APP));
// ⚠️ ⑥(in-memory)과 ⑦(Drive write)이 **같은 함수**를 공유해야 두 경로가 갈리지 않는다.
ok('#G2g _preserveStickyPersonalData가 같은 함수를 공유한다',
  /ledgerBooksHaveContent/.test(SYNC) && /ledgerBooks:\s*keepLedger/.test(SYNC));
// ⚠️ 수동 저장 4핸들러는 필드를 손나열하지 말 것 — saveAllToDrive는 STATE를 통째로 덮어쓰므로
//    payload에 없는 필드가 Drive에서 삭제된다(과거 '저장' 버튼이 메모 달력을 지운 사고).
ok('#G2h 수동 저장 4핸들러가 flush 결과를 명시 주입한다',
  (APP.match(/nextLedger\s*\?\s*\{\s*ledgerBooks:\s*nextLedger\s*\}/g) || []).length >= 4);
// ⚠️ 미승격 편집이 없으면 반드시 null — 항상 truthy면 alt-tab마다 4파일 write가 강제된다.
ok('#G2i 종료 커밋이 exitCommitRef 합성에 들어간다', /ledgerExitCommitRef\.current\?\.\(\)/.test(APP));
ok('#G2j ⚠️ 종료 커밋이 saveStateRef를 동기 갱신한다',
  /saveStateRef\.current = \{ \.\.\.saveStateRef\.current, ledgerBooks: next/.test(APP));
// ⚠️ 가계부는 포트폴리오와 개념적 의존이 0이다 — 계좌가 없는 사용자가 정상 경로다.
//    저장 effect의 `portfolios.length === 0` 조기 반환을 그대로 두면 그 사용자의 가계부는
//    새로고침마다 통째로 사라진다.
ok('#G2k ⚠️ 계좌 0개 사용자도 저장된다(조기 반환 예외)',
  /portfolios\.length === 0 && !ledgerBooksHaveContent\(ledgerBooks\)/.test(APP));

// ── 게이팅 (프론트 8곳 + Apps Script 6곳) ──────────────────────────────────
// ⚠️ 이 3곳이 "새 필드를 손나열하는" 유일한 지점이다. 하나만 빠뜨려도 그 로그인 경로에서만
//    기능이 사라지는 재현 불가 버그가 난다(@ts-nocheck + esbuild라 컴파일러가 못 잡는다).
ok('#G3 LoginGate 3곳(UserFeatures·EMPTY_FEATURES·pickFeatures)',
  (GATE.match(/ledgerEnabled/g) || []).length >= 3);
ok('#G3b App 초기 userFeatures 리터럴', /userFeatures[\s\S]{0,400}?ledgerEnabled:\s*false/.test(APP));
// ⚠️ effectiveUserFeatures(feature1/2/3 강제)에 얹지 말 것 — 관리자 본인이 영구 접근 불가가 된다.
ok('#G3c ledgerAccess = isAdminUser || userFeatures.ledgerEnabled',
  /const ledgerAccess = isAdminUser \|\| userFeatures\.ledgerEnabled/.test(APP));
ok('#G3d AdminPage 라벨 + 토글 정의', /ledgerEnabled/.test(ADMIN) && /featureLabels\[8\]/.test(ADMIN));
// ⚠️ prop 기본값 false = fail-closed (prop 미전달 시 아이콘 미렌더).
ok('#G3e UserInfoBar prop 기본값이 fail-closed', /canAccessLedger\s*=\s*false/.test(UIB));
ok('#G3f UserInfoBar 조건부 렌더(사용부)', /\{canAccessLedger && \([\s\S]{0,400}?onOpenLedger/.test(UIB));
// ⚠️ lucide 신규 아이콘 금지 — 0.577.0 고정 + package-lock.json 부재라 실재 여부를 확인할 수 없고,
//    없으면 undefined 컴포넌트 렌더로 상단바가 던지는데 UserInfoBar는 ErrorBoundary 격리 밖이다.
ok('#G3g 인라인 SVG 아이콘(lucide 신규 아이콘 아님)', /const LedgerIcon = \(/.test(UIB));
// Apps Script 6지점 — 인덱스 12 = M열
ok('#G4 AppsScript checkApproval/listUsers가 row[12]를 읽는다',
  (AS.match(/ledgerEnabled:\s*parseBool\(row\[12\]\)/g) || []).length >= 2);
ok('#G4b AppsScript colMap에 ledgerEnabled: 12', /ledgerEnabled:\s*12/.test(AS));
ok('#G4c AppsScript 라벨 범위가 E1:M1', /E1:M1/.test(AS) && !/getRange\('E1:L1'\)/.test(AS));
ok('#G4d AppsScript 검증 범위가 E2:M100', /E2:M100/.test(AS));
ok('#G4e AppsScript addUser가 13열을 쓴다',
  (sliceBlock(AS, 'function handleAddUser', '\n}').match(/'OFF'/g) || []).length >= 9);

// ── 별도 창 브릿지 ─────────────────────────────────────────────────────────
ok('#G5 main.tsx 부트 스위치', /LEDGER_WINDOW_BOOT/.test(MAIN) && /ledgerWindow/.test(MAIN));
// ⚠️ noopener 금지 — opener 브릿지가 이 기능의 전부다(impersonation 탭과 정반대 규칙).
const OPEN = sliceBlock(APP, 'const openLedgerWindow', '\n  };');
ok('#G5b ⚠️ window.open에 noopener를 붙이지 않았다',
  /window\.open\('\/\?ledgerWindow=1'/.test(OPEN) && !/noopener/.test(OPEN));
// ⚠️ 팝업 차단 시 인앱 폴백 — 최악의 경우가 '기존 동작'이 되게 한다.
ok('#G5c 팝업 차단 폴백이 있다', /setLedgerWinBlocked\(true\)/.test(OPEN));
// ⚠️ ping만 입양 게이트 앞에 오는 의도된 예외다. 쓰기는 입양된 창만.
ok('#G5d 입양 게이트(쓰기는 입양된 창만)',
  /e\.source !== ledgerWinRef\.current\) return;/.test(APP));
ok('#G5e origin 검사', /e\.origin !== window\.location\.origin\) return;/.test(APP));
// ⚠️ 창이 보낸 것을 그대로 채택하지 말 것.
ok('#G5f 수신 시 정규화한다', /setLedgerBooks\(normalizeLedgerBooks\(d\.books\)\)/.test(APP));

// ── 메모 달력 ──────────────────────────────────────────────────────────────
const CAL = stripComments(read('src/components/CalendarModal.tsx'));
const CALWIN = stripComments(read('src/components/CalendarWindow.tsx'));
// ⚠️ CalendarModal은 App 최상위 형제라 달력을 닫아도 계속 마운트돼 있다 — open 게이트가 없으면
//    닫은 뒤에도 시세 갱신마다 영구히 재계산한다.
ok('#G6 ledgerByDate에 open 게이트가 있다',
  /const ledgerByDate = useMemo\(\(\) => \{[\s\S]{0,200}?if \(!open\) return \w+;/.test(CAL));
ok('#G6b 칩 라벨/색이 등록됐다', /ledger:\s*'BUDGET'/.test(CAL) && /ledger:\s*'bg-/.test(CAL));
// ⚠️ PICK 체인의 마지막 else는 qty다 — 자기 분기가 없으면 오류 없이 '종목 수량 변경' 패드가 열린다.
ok('#G6c ⚠️ PICK 목록에 ledger 분기가 있다(qty로 흘러가지 않음)',
  /pad\.pickKind === 'ledger' \? \(ledgerByDate\[pad\.dayKey\] \|\| \[\]\)/.test(CAL));
ok('#G6d PICK 클릭 라우팅', /pad\.pickKind === 'ledger'\) openLedger\(/.test(CAL));
// ⚠️ 사용자 요구: 칸에 총지출·전월대비를 보여준다(패드로만 밀지 말 것).
ok('#G6e 칸 칩이 총지출/전월대비 요약을 담는다', /chipTitle/.test(CAL) && /ledgerChipText/.test(CAL));
// ⚠️ 별도 달력 창에서 window.open을 부르면 opener가 CalendarWindow가 되어 가계부 창이
//    영구 읽기 전용이 된다 — 반드시 App에 위임한다.
ok('#G6f ⚠️ 달력 창은 [가계부 열기]를 App에 위임한다', /calendar:openLedger/.test(CALWIN));
ok('#G6g App이 그 위임을 처리한다', /calendar:openLedger/.test(APP));
// ⚠️ CalendarWindow의 수신 화이트리스트는 **열거형**이다(App은 접두사 검사 — 비대칭).
//    빠뜨리면 응답이 조용히 폐기돼 '영원히 로딩'이 된다.
ok('#G6h CalendarWindow가 가계부 데이터를 받는다', /ledgerBooks/.test(CALWIN));

// ── 잡다 ───────────────────────────────────────────────────────────────────
// ⚠️ package-lock.json이 없어 Vercel이 매 배포마다 npm install을 재해석한다 — 정확히 그
//    원인으로 프로덕션 흰 화면이 났던 이력이 있다.
ok('#G7 외부 npm 의존성 0(4개 그대로)',
  Object.keys(PKG.dependencies || {}).sort().join(',') === 'lucide-react,react,react-dom,recharts');
ok('#G7b verify:ledger 스크립트 등록', (PKG.scripts || {})['verify:ledger'] === 'node scripts/verify-ledger.mjs');
// 신규 창 파일은 verify-flow #37(JSX 주석 조기 종료 가드) 배열에 등록해야 한다.
ok('#G7c 신규 창/페이지가 verify-flow JSX 가드 배열에 등록됐다',
  /LedgerWindow\.tsx/.test(read('scripts/verify-flow.mjs')));
// ⚠️ 색을 바꾸려면 validate_palette.js를 다시 돌릴 것(눈으로 판단 금지).
ok('#G8 팔레트가 모듈 상수로 공유된다(손복제 금지)',
  /export const LEDGER_GROUP_COLOR/.test(LG) && /export const LEDGER_DIVERGING/.test(LG));
// ⚠️ 이 앱의 손익 색(이익=빨강)을 지출에 쓰면 정반대로 읽힌다.
ok('#G8b ⚠️ 지출 증감에 손익 색(red/blue)을 쓰지 않는다',
  !/over:\s*'#f87171'|over:\s*'#ef4444'/.test(LG));

// 소비처 census — 새 소비처가 생기면 반개구간·부호·null 계약을 다시 확인하게 만든다.
const HOSTS = readdirSync(join(ROOT, 'src/components'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => [f, (stripComments(read(`src/components/${f}`)).match(/from '\.\.\/ledger'/g) || []).length])
  .filter(([, n]) => n > 0).map(([f]) => f).sort();
eq('#G9 ledger.ts 소비처 census(새 소비처는 null 계약을 다시 확인할 것)', HOSTS,
  ['CalendarModal.tsx', 'LedgerPage.tsx', 'LedgerWindow.tsx']);

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:ledger — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
