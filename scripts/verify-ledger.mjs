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

  // ── §11 예상(expected) 집계 — "계획만 입력해도 소계가 나온다" ──────────────
  console.log('\n  §11 예상 집계 — 계획 폴백');
  const {
    expectedOf, expectedTotal, expectedIncomeTotal, expectedByPay, expectedGrandTotal, monthState,
  } = L;
  ok('#64 필요한 export가 있다',
    [expectedOf, expectedTotal, expectedByPay, expectedGrandTotal, monthState].every((f) => typeof f === 'function'));

  const ex = (o) => makeLedgerItem({ group: 'fixed', ...o });
  eq('#65 실제가 없으면 계획으로 채운다', expectedOf(ex({ plan: 1000 }), '2026-08'), 1000);
  eq('#65b 실제가 있으면 실제', expectedOf(ex({ plan: 1000, actual: { '2026-08': 1200 } }), '2026-08'), 1200);
  // ⚠️ 이 한 줄이 '미입력 vs 0원' 구분의 마지막 방어선이다. `||`로 바꾸면 1000이 나온다.
  eq('#66 ⚠️ 명시적 0은 계획으로 되살아나지 않는다(`??`이지 `||`가 아니다)',
    expectedOf(ex({ plan: 1000, actual: { '2026-08': 0 } }), '2026-08'), 0);
  eq('#66b 실제도 계획도 없으면 0이 아니라 null', expectedOf(ex({}), '2026-08'), null);
  eq('#66c 비활성 달은 null', expectedOf(ex({ plan: 1000, activeFrom: '2026-09' }), '2026-08'), null);

  const expBook = makeLedgerBook({
    items: [
      ex({ id: 'a', pay: 'cash', plan: 100000, actual: { '2026-08': 120000 } }),
      ex({ id: 'b', pay: 'card', plan: 200000 }),                       // 미입력 → 계획으로 채움
      ex({ id: 'c', pay: 'card', plan: 50000, actual: { '2026-08': 0 } }), // 명시적 0
      makeLedgerItem({ id: 'i', group: 'income', pay: 'cash', plan: 3000000, actual: { '2026-08': 3000000 } }),
    ],
  });
  const et = expectedTotal(expBook.items, '2026-08');
  eq('#67 예상 합 = 실제 + 계획 폴백', et.value, 120000 + 200000 + 0);
  eq('#67b 실제 몫', et.fromActual, 120000);
  eq('#67c 계획으로 채운 몫', et.fromPlan, 200000);
  eq('#67d 계획으로 채운 건수', et.plannedCount, 1);
  eq('#67e 실제 입력 건수(명시적 0 포함)', et.actualCount, 2);
  // ⚠️ 이 게이트가 monthTotals 밖으로 옮겨진 #48c다 — 함수 안에 있어야 한다(호출부 위임 금지).
  eq('#68 ⚠️ 수입이 지출 예상 합에 섞이지 않는다', et.activeCount, 3);
  eq('#68b 수입은 별도 함수로만', expectedIncomeTotal(expBook.items, '2026-08').value, 3000000);
  const ebp = expectedByPay(expBook.items, '2026-08');
  eq('#68c ⚠️ expectedByPay도 수입을 제외한다(현금 소계에 급여가 없다)', ebp.cash.value, 120000);
  eq('#68d 카드 소계 = 계획 폴백 + 명시적 0', ebp.card.value, 200000);
  ok('#68e 항목이 있는 결제수단만 키를 만든다', !('transfer' in ebp) && Object.keys(ebp).sort().join() === 'card,cash');

  // ⚠️ 계획 열의 기준선 — 실적을 채워 넣어도 값이 변하면 안 된다(fromPlan을 쓰면 0으로 수렴).
  const planSumOf = (acts) => expectedTotal([
    ex({ id: 'p1', plan: 80000, actual: acts[0] ? { '2026-08': acts[0] } : {} }),
    ex({ id: 'p2', plan: 450000, actual: acts[1] ? { '2026-08': acts[1] } : {} }),
    ex({ id: 'p3', plan: 17000, actual: acts[2] ? { '2026-08': acts[2] } : {} }),
  ], '2026-08').planSum;
  ok('#69 ⚠️ planSum은 실적을 채워도 불변(fromPlan과 다르다)',
    planSumOf([0, 0, 0]) === 547000 && planSumOf([80000, 450000, 0]) === 547000 && planSumOf([80000, 450000, 17000]) === 547000);

  // ⚠️ 누출 금지 — 계획 폴백이 비교·시계열로 새면 전월 대비가 영구히 거짓말을 시작한다.
  const leakBook = makeLedgerBook({
    items: [ex({ id: 'x', plan: 1000, actual: { '2026-07': 1000, '2026-08': 1200 } }), ex({ id: 'y', plan: 2000, actual: { '2026-07': 2000 } })],
  });
  ok('#70 ⚠️ 계획 폴백이 momDelta로 새지 않는다(완료도 불일치 유지)', momDelta(leakBook, '2026-08').comparable === false);
  eq('#70b ⚠️ monthTotals.actualExpense는 입력분만', monthTotals(leakBook, '2026-08').actualExpense, 1200);
  eq('#70c 같은 달의 예상 합은 계획으로 채워진다', expectedTotal(leakBook.items, '2026-08').value, 1200 + 2000);

  // ── §12 월 상태 4종 ─────────────────────────────────────────────────────
  console.log('\n  §12 월 상태 — "항목 없음"과 "미입력"은 다르다');
  const midYearBook = makeLedgerBook({ items: [ex({ plan: 1000, activeFrom: '2026-08' })] });
  // ⚠️ 연중 시작이 이 기능의 기본 사용 경로다. 2분법이면 1~7월이 '미입력'으로 단언된다.
  eq('#71 ⚠️ 시작 전 달은 "항목 없음"(미입력 아님)', monthState(expectedTotal(midYearBook.items, '2026-03')), 'none');
  eq('#71b 실적이 하나도 없으면 empty', monthState(expectedTotal(midYearBook.items, '2026-08')), 'empty');
  eq('#71c 일부만 입력하면 partial',
    monthState(expectedTotal([ex({ id: 'a', plan: 1, actual: { '2026-08': 1 } }), ex({ id: 'b', plan: 1 })], '2026-08')), 'partial');
  eq('#71d 전부 입력하면 full',
    monthState(expectedTotal([ex({ id: 'a', plan: 1, actual: { '2026-08': 1 } })], '2026-08')), 'full');
  eq('#71e null/빈 입력도 none', monthState(null), 'none');

  // ── §13 항목 순서 이동 ──────────────────────────────────────────────────
  console.log('\n  §13 순서 이동 — 그룹 안에서만');
  const { moveItemInGroup, canMoveItemInGroup } = L;
  const mix = [
    makeLedgerItem({ id: 'f1', group: 'fixed' }),
    makeLedgerItem({ id: 'v1', group: 'variable' }),   // 다른 그룹이 사이에 끼어 있다
    makeLedgerItem({ id: 'f2', group: 'fixed' }),
  ];
  // ⚠️ 인접 인덱스와 그냥 교환하면 f2↔v1이 바뀌어 화면에서는 아무 일도 일어나지 않는다.
  eq('#72 ⚠️ 다른 그룹을 건너뛰고 같은 그룹끼리 교환',
    moveItemInGroup(mix, 'f2', -1).map((x) => x.id), ['f2', 'v1', 'f1']);
  eq('#72b 아래로도 같은 규칙', moveItemInGroup(mix, 'f1', 1).map((x) => x.id), ['f2', 'v1', 'f1']);
  ok('#73 ⚠️ 이동 불가면 원본 참조 그대로(헛된 저장 트리거 방지)',
    moveItemInGroup(mix, 'f1', -1) === mix && moveItemInGroup(mix, 'v1', 1) === mix && moveItemInGroup(mix, 'nope', 1) === mix);
  ok('#73b canMoveItemInGroup이 그 판정을 공유',
    canMoveItemInGroup(mix, 'f1', -1) === false && canMoveItemInGroup(mix, 'f1', 1) === true);
  ok('#73c 입력 배열을 변형하지 않는다', mix.map((x) => x.id).join() === 'f1,v1,f2');
  // ⚠️ 배열 재정렬이라 영속화 신규 지점이 0곳이다 — 지문이 순서를 잡아 준다.
  ok('#74 ⚠️ 순서만 바꿔도 지문이 바뀐다(order 필드 없이 저장이 트리거된다)',
    ledgerFingerprint([makeLedgerBook({ id: 'b', items: mix })]) !==
    ledgerFingerprint([makeLedgerBook({ id: 'b', items: moveItemInGroup(mix, 'f2', -1) })]));

  // ── §14 구분(카테고리) ──────────────────────────────────────────────────
  console.log('\n  §14 구분 프리셋');
  const { ledgerCategories } = L;
  const catBook = makeLedgerBook({
    categories: ['구독', '통신'],
    items: [ex({ category: '구독' }), ex({ category: '보험' }), ex({ category: '' })],
  });
  eq('#75 레지스트리 ∪ 실제 사용값(등록 순 → 미등록 사용값)',
    ledgerCategories(catBook), ['구독', '통신', '보험']);
  // ⚠️ trim해서 넣으면 옵션에 없는 값이 되어 select가 첫 옵션을 표시하고, 한 번 건드리면 덮인다.
  eq('#75b ⚠️ 항목의 값은 가공하지 않고 그대로 옵션이 된다(공백 포함)',
    ledgerCategories(makeLedgerBook({ categories: ['구독'], items: [ex({ category: ' 구독 ' })] })), ['구독', ' 구독 ']);
  eq('#75c 손상 입력에도 빈 배열', ledgerCategories(null), []);
  // 정규화
  const dirty = normalizeLedgerBooks([{ categories: ['  구독  ', '구독', '', 42, 'x'.repeat(99)], items: [] }]);
  eq('#76 정규화가 trim·중복 제거·길이 상한을 적용', dirty[0].categories, ['구독', 'x'.repeat(L.MAX_LEDGER_CATEGORY_LEN)]);
  ok('#76b 개수 상한',
    normalizeLedgerBooks([{ categories: Array.from({ length: 99 }, (_, i) => `c${i}`), items: [] }])[0].categories.length === L.MAX_LEDGER_CATEGORIES);
  // ⚠️ #76은 `id`가 없어 다른 이유로도 changed가 서므로 **변경 판정 누락을 잡지 못한다**
  //    (변이 테스트로 확인한 죽은 단언). categories 외에는 전부 정규형인 픽스처라야
  //    `sameStrList(categories, src.categories)` 검사가 유일한 트리거가 된다.
  eq('#76c ⚠️ categories만 손상돼도 정규화가 적용된다(changed 판정 누락 방지)',
    normalizeLedgerBooks([{ id: 'C', name: 'n', categories: ['  구독  ', '구독'], items: [], months: {}, createdAt: 0, updatedAt: 0 }])[0].categories,
    ['구독']);
  // ⚠️ 멱등 — 깨지면 Drive 폴링마다 재저장 + 로컬 사본이 갈아엎어져 편집이 사라진다.
  const catOnce = normalizeLedgerBooks([JSON.parse(JSON.stringify(catBook))]);
  ok('#77 ⚠️ categories가 있어도 두 번째 정규화는 같은 참조', normalizeLedgerBooks(catOnce) === catOnce);
  // ⚠️ 레거시(필드 없음)를 '변경됨'으로 보면 로드마다 새 배열이 나와 churn이 난다.
  const legacy = [{ id: 'L', name: 'n', items: [], months: {}, createdAt: 0, updatedAt: 0 }];
  ok('#77b ⚠️ categories가 없던 레거시는 원본 참조 그대로(undefined ≡ [])', normalizeLedgerBooks(legacy) === legacy);
  ok('#78 ⚠️ 구분만 추가해도 지문이 바뀐다(저장 스킵 방지)',
    ledgerFingerprint([makeLedgerBook({ id: 'x' })]) !== ledgerFingerprint([makeLedgerBook({ id: 'x', categories: ['구독'] })]));
  ok('#78b 구분만 등록한 장부도 "내용 있음"(복원이 되돌리면 안 된다)',
    ledgerBooksHaveContent([makeLedgerBook({ categories: ['구독'] })]) === true);
  ok('#78c ⚠️ 빈 장부는 여전히 "내용 없음"(백업 복원 경로 유지)',
    ledgerBooksHaveContent([makeLedgerBook()]) === false);

  // ── §15 헤더 세분화 — 축 정합 ───────────────────────────────────────────
  console.log('\n  §15 예상 月 지출의 결제수단 분해 — Σ가 총액과 같아야 한다');
  const { projectedByPay } = L;
  const axBook = makeLedgerBook({
    items: [
      makeLedgerItem({ group: 'fixed', pay: 'card', plan: 200000 }),
      makeLedgerItem({ group: 'fixed', pay: 'cash', plan: 100000 }),
      makeLedgerItem({ group: 'variable', pay: 'card', plan: 50000 }),
      // 연단위 — ⚠️ byPay는 납부월에 전액 넣지만 projectedMonthly는 ÷12 한다. 그 차이가 이 절의 이유다.
      makeLedgerItem({ group: 'annual', pay: 'cash', plan: 1200000, dueMonth: 3 }),
      makeLedgerItem({ group: 'income', pay: 'cash', plan: 5000000 }),
    ],
  });
  for (const mth of ['2026-01', '2026-03']) {
    const sum = Object.values(projectedByPay(axBook, mth)).reduce((a, b) => a + b, 0);
    near(`#79 ⚠️ Σ projectedByPay === projectedMonthly (${mth}, 납부월 포함/미포함 모두)`,
      sum, ledgerKpi(axBook, mth).projectedMonthly, 1e-9);
  }
  eq('#79b ⚠️ 수입은 분해에 섞이지 않는다', projectedByPay(axBook, '2026-01').cash, 1200000 / 12 + 100000);
  // ⚠️ byPay를 그대로 쓰면 부분합 ≠ 총액 — 그 오차가 실재함을 고정한다(되돌림 방지).
  {
    const bp = monthTotals(axBook, '2026-03').byPay;
    const bySum = Object.values(bp).reduce((a, b) => a + b.plan, 0);
    ok('#79c ⚠️ monthTotals.byPay로 대체하면 총액과 어긋난다(그래서 별도 함수다)',
      Math.abs(bySum - ledgerKpi(axBook, '2026-03').projectedMonthly) > 1);
  }

  // ── §16 팔레트 램프 ────────────────────────────────────────────────────
  console.log('\n  §16 램프 / 결제수단 색');
  const { ledgerRamp, ledgerPayColor, LEDGER_GROUP_COLOR: GC, LEDGER_PAY_ORDER: PO, LEDGER_DETAIL_OTHER: DO } = L;
  ok('#80 n<=1이면 기준색 그대로', ledgerRamp(GC.fixed, 'fixed', 1, 0) === GC.fixed && ledgerRamp(GC.fixed, 'fixed', 0, 0) === GC.fixed);
  ok('#80b 결정적(같은 인자 → 같은 값)', ledgerRamp(GC.loan, 'loan', 4, 2) === ledgerRamp(GC.loan, 'loan', 4, 2));
  ok('#80c 범위를 벗어난 i는 클램프',
    ledgerRamp(GC.loan, 'loan', 4, 99) === ledgerRamp(GC.loan, 'loan', 4, 3) && ledgerRamp(GC.loan, 'loan', 4, -5) === ledgerRamp(GC.loan, 'loan', 4, 0));
  ok('#80d 유효한 hex를 낸다', [2, 3, 4, 5].every((n) => Array.from({ length: n }, (_, i) => ledgerRamp(GC.annual, 'annual', n, i)).every((h) => /^#[0-9a-f]{6}$/.test(h))));
  ok('#81 결제수단 색이 전부 다르다', new Set(PO.map(ledgerPayColor)).size === PO.length);
  ok('#81b 미지 결제수단도 색을 낸다(렌더 중 undefined 금지)', /^#[0-9a-f]{6}$/.test(ledgerPayColor('bogus')));
  // ⚠️ 중립 midpoint를 카테고리 슬롯으로 쓰면 회색이 '계획선'·'변동 없음'·'기타'를 동시에 뜻한다.
  ok('#81c ⚠️ DETAIL_OTHER는 DIVERGING.flat이 아니다', DO !== L.LEDGER_DIVERGING.flat);
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

// ════════════════════════════════════════════════════════════════════════════
// §G10~ 6가지 수정(2026-08) 배선 가드
// ⚠️ 전부 **선언이 아니라 사용부**를 단언한다 — 상수/함수의 존재만 보면 셀을 통째로
//    삭제하거나 값을 바꿔치기해도 초록으로 통과하는 죽은 단언이 된다.
console.log('\n── §G10 계획 폴백 누출 금지 ──');
const LP_RAW = read('src/components/LedgerPage.tsx');
const LP = stripComments(LP_RAW);

// ⚠️ 계획으로 채운 값이 비교·시계열로 새면 전월 대비가 영구히 거짓말을 시작한다.
//    **구간을 잘라** 단언한다 — 파일 전역 정규식은 다른 곳의 정상 사용에 걸려 죽은 단언이 된다.
const noExpected = (label, block, why) =>
  ok(`${label} ${why}`, block.length > 0 && !/expected|Expected/.test(block));
noExpected('#G10 compareMonths', sliceBlock(LG, 'export const compareMonths', '\nexport const momDelta'),
  '본문에 expected가 없다(완료도 판정이 무너지면 −87.2% 거짓말이 부호만 바뀌어 재발)');
noExpected('#G10b ledgerEventsByDate', sliceBlock(LG, 'export const ledgerEventsByDate', '\n/* ====='),
  '본문에 expected가 없다(기록하지 않은 날에 달력 칩이 총지출을 찍는다)');
noExpected('#G10c monthTotals', sliceBlock(LG, 'export const monthTotals', 'export const expectedOf'),
  '본문에 expected가 없다(이 구조체를 5소비자가 받아 간다)');
noExpected('#G10d yearSeries.actual', sliceBlock(LP, 'const yearSeries = useMemo', 'const e = expectedTotal'),
  'plan/actual/momDelta 산출부에 expected가 없다');
// ⚠️ annualCompare는 설계안의 누출 금지 목록에서 빠져 있었다 — '계획만 입력한 해가 전년 대비
//    차트에서 통째로 사라진다'가 요청1과 같은 증상이라 여기에 expected를 꽂을 유인이 가장 크다.
noExpected('#G10e annualCompare', sliceBlock(LP, 'const annualCompare = useMemo', '), [book, yearsAvailable]);'),
  '본문에 expected가 없다(모든 해가 "항상 비교 가능한 거짓 숫자"가 된다)');

console.log('\n── §G11 소계 / 결제수단 행 ──');
const SUB = sliceBlock(LP, 'const renderSubtotalRow', 'const renderGroupSubtotal');
ok('#G11 소계 월 셀이 expectedTotal을 쓴다(계획 폴백)', /const e = expectedTotal\(items, k\)/.test(SUB));
// ⚠️ fromPlan을 쓰면 사용자가 실적을 채울수록 계획 열이 0으로 수렴한다(실측 547,000 → 17,000).
ok('#G11b ⚠️ 계획 열이 planSum이다(fromPlan 아님)',
  /fmtWon\(cur\.planSum, hideAmounts\)/.test(SUB) && !/fmtWon\(cur\.fromPlan/.test(SUB));
ok('#G11c 계획으로 채운 건수를 셀에 노출한다', /e\.plannedCount > 0/.test(SUB));
// ⚠️ '보이는 달 중 하나라도'로 재면 미래 달이 항상 계획-only라 배지가 상시 켜져 신호가 0이 된다.
ok('#G11d ⚠️ 배지는 선택한 달 하나로 판정한다', /cur\.plannedCount > 0/.test(SUB));
ok('#G11e "항목 없음"을 "미입력"과 구분한다', /state === 'none'/.test(SUB));
const GSUB = sliceBlock(LP, 'const renderGroupSubtotal', 'const renderGrandTotalRow');
// ⚠️ 현금/카드만 하드코딩하면 pay:'auto'인 항목이 어느 행에도 없이 사라진다.
ok('#G11f ⚠️ 결제수단 행이 LEDGER_PAY_ORDER 전체를 훑는다',
  /LEDGER_PAY_ORDER\.filter\(\(p\) => items\.some/.test(GSUB));
ok('#G11g 결제수단이 2종 이상일 때만 행을 만든다', /present\.length > 1/.test(GSUB));
ok('#G11h 1종이면 라벨에 표기한다(행 없이도 답이 화면에 있다)', /전액 \$\{LEDGER_PAY_LABEL\[present\[0\]\]\}/.test(GSUB));
// ⚠️ 헤더 KPI의 '월 지출 합계'는 연단위 **제외**라 이름이 겹친다. 라벨이 유일한 잠금이다.
ok('#G11i ⚠️ 총합계 행 라벨이 연단위 포함임을 밝힌다', /'월 지출 합계 \(연단위 납부월 포함\)'/.test(LP));
ok('#G11j 총합계 행이 tbody에 실제로 렌더된다', /renderGrandTotalRow\(\)\}/.test(LP));

console.log('\n── §G12 순서 이동 / 구분 ──');
ok('#G12 ▲▼가 항목 행에 렌더된다', /<MoveBtns[\s\S]{0,220}?canMoveItemInGroup\(book\.items, it\.id, -1\)/.test(LP));
ok('#G12b 이동이 id 기준 순수 함수를 쓴다', /moveItemInGroup\(b\.items, itemId, dir\)/.test(LP));
// ⚠️ data-col을 달면 onGridKeyDown의 ↑/↓ 열 이동에 버튼이 끼어든다.
ok('#G12c ⚠️ ▲▼에 data-col을 달지 않는다',
  !/data-col[^\n]{0,40}(?:up|down|move)/i.test(sliceBlock(LP, 'function MoveBtns', '\n/* ──')));
ok('#G12d 구분 select가 행에 렌더되고 합집합 목록을 쓴다',
  /categories\.map\(\(c\) => <option/.test(LP) && /const categories = useMemo\(\(\) => ledgerCategories\(book\)/.test(LP));
ok('#G12e 구분 관리 패널이 렌더된다', /<CategoryManager[\s\S]{0,300}?onAdd=\{addCategory\}/.test(LP));
// ⚠️ 레지스트리에서 지웠다고 항목의 category를 지우면 undo 없이 여러 행의 구분이 사라진다.
ok('#G12f ⚠️ 구분 삭제가 항목의 category를 건드리지 않는다',
  !/removeCategory[\s\S]{0,400}?items:[\s\S]{0,120}?category:/.test(LP));
ok('#G12g 입력 maxLength가 정규화와 같은 상수를 쓴다', /maxLength=\{MAX_LEDGER_CATEGORY_LEN\}/.test(LP));

console.log('\n── §G13 도넛 / 결제수단 막대 ──');
// ⚠️ 6곳 손복제를 되살리지 말 것 — 툴팁 글자색(#808080)은 contentStyle만 고쳐서는 안 바뀐다.
ok('#G13 툴팁 스타일이 상수 하나로 공유된다',
  /const TOOLTIP_STYLE = \{/.test(LP) && !/contentStyle=\{\{ background: '#0f1623'/.test(LP));
ok('#G13b ⚠️ itemStyle로 글자색을 덮는다(recharts Pie 기본 fill #808080 회피)',
  /itemStyle: \{ color: '#e5e7eb' \}/.test(LP));
ok('#G13c 모든 RTooltip이 그 상수를 쓴다',
  (LP.match(/<RTooltip \{\.\.\.TOOLTIP_STYLE\}/g) || []).length === (LP.match(/<RTooltip/g) || []).length);
const DON = sliceBlock(LP, 'const donut = useMemo', 'const detailDonut');
// ⚠️ byPay는 그룹 구분이 없어 대출·연단위가 섞인다(addItem이 연단위를 pay:'cash'로 만든다).
ok('#G13d ⚠️ 고정비 분리가 byPay가 아니라 고정비 항목만 순회한다',
  /expectedByPay\(fixedItems, ym\)/.test(DON) && !/totals\.byPay/.test(DON));
ok('#G13e 고정비 조각 색이 결제수단 색을 공유한다(현금이 두 색이 되면 안 된다)', /ledgerPayColor\(p\)/.test(DON));
// ⚠️ 메인/상세가 같은 후처리를 써야 두 도넛의 합이 갈리지 않는다(음수 plan이 도달 가능하다).
ok('#G13f ⚠️ 두 도넛이 같은 후처리(donutRows)를 지난다',
  (LP.match(/return donutRows\(rows\)/g) || []).length === 2 && /Math\.max\(0, Number\.isFinite\(r\.value\)/.test(LP));
ok('#G13g 상세 도넛이 Top-N + 기타로 접는다', /LEDGER_DETAIL_TOP_N/.test(LP) && /LEDGER_DETAIL_OTHER/.test(LP));
// ⚠️ 바깥 라벨은 슬롯이 4를 넘으면 라벨선이 충돌해 유일한 보조 부호가 무력화된다.
ok('#G13h ⚠️ 도넛이 옆 목록 + 안쪽 % 방식이다(labelLine 되돌림 금지)',
  /function DonutWithList/.test(LP) && /labelLine=\{false\}/.test(LP) && !/labelLine=\{\{ stroke/.test(LP));
// ⚠️ LP(주석 제거본)가 아니라 LP_RAW를 자른다 — 구간 경계가 `{/* */}` 주석이라
//    stripComments가 지우면 구간을 못 찾아 가드가 영구히 실패한다.
const BAR = sliceBlock(LP_RAW, '{/* ⑤ 결제수단별 지출 */}', '{/* ④ 수지 균형 */}');
// ⚠️ recharts는 stacked Bar에서 null을 0으로 강제한다 → '데이터 없음'을 행 제외로 표현한다.
ok('#G13i ⚠️ 막대가 payChartData(항목 없던 달 제외)를 쓴다', /data=\{payChartData\}/.test(BAR));
ok('#G13j 제외한 달 수를 화면에 밝힌다', /MONTHS\.length - payChartData\.length/.test(BAR));
ok('#G13k 스택이 결제수단 색을 공유한다', /fill=\{ledgerPayColor\(p\)\}/.test(BAR));
ok('#G13l 세그먼트 안 직접 라벨이 있다(색만으로 구분되지 않는다)', /\$\{p\.label\} \$\{Math\.round\(pct\)\}%/.test(BAR));
// ⚠️ 대출 기본 pay가 transfer라 "현금+카드=전체"가 성립하지 않는다 — 반드시 고지한다.
ok('#G13m ⚠️ 대출이 이체라는 사실을 고지한다', /대출은 기본이 '이체'/.test(LP_RAW));

console.log('\n── §G14 헤더 세분화 축 정합 ──');
// ⚠️ byPay는 연단위를 납부월에 전액 넣는데 카드 값은 ÷12 한다 — 부분합 ≠ 총액이 상시 발생한다.
ok('#G14 ⚠️ 헤더 칩이 projectedByPay를 쓴다(totals.byPay 아님)',
  /const projPay = useMemo\(\(\) => \{[\s\S]{0,200}?projectedByPay\(book, ym\)/.test(LP));
ok('#G14b 칩이 실제로 렌더된다', /projPay\.map\(\(p\) =>/.test(LP));
// ⚠️ 분석 탭 칩은 실적 우선이라 같은 '카드'라는 이름으로 다른 숫자가 나온다.
ok('#G14c ⚠️ 기준(계획)을 화면에 명시한다', /계획 기준/.test(LP_RAW));
ok('#G14d ⚠️ 분석 탭 칩도 기준 차이를 고지한다', /저쪽은 <b>계획 기준<\/b>/.test(LP_RAW));

console.log('\n── §G15 sticky 오프셋 / 팔레트 검증기 ──');
// ⚠️ 하드코딩 212는 62+150 전제 위에 있어, 항목 셀이 넓어지면 계획열이 × 버튼을 덮는다.
ok('#G15 ⚠️ sticky 오프셋이 파생 상수다', /const LEFT_PLAN = COL_PAY \+ COL_NAME/.test(LP));
ok('#G15b ⚠️ left-[212px] 하드코딩이 남아 있지 않다', !/left-\[212px\]|left-\[62px\]/.test(LP));
ok('#G15c 오프셋이 사용부에서 쓰인다',
  (LP.match(/left: LEFT_PLAN/g) || []).length >= 3 && (LP.match(/left: LEFT_NAME/g) || []).length >= 2);
// ⚠️ CLAUDE.md가 요구하던 validate_palette.js는 저장소에 없었다 — 복원본이 있어야 규약이 실행 가능하다.
ok('#G15d 팔레트 검증기가 저장소에 있다', /export const deltaE00/.test(read('scripts/validate_palette.mjs')));
ok('#G15e 검증기가 npm 스크립트로 등록됐다', (PKG.scripts || {})['verify:palette'] === 'node scripts/validate_palette.mjs');
// ⚠️ 검증기는 ledger.ts의 램프 사본을 들고 1:1 대조한다 — 그 대조를 지우면 드리프트가 무음이 된다.
ok('#G15f 검증기가 ledger.ts를 직접 import해 대조한다',
  /await import\('\.\.\/src\/ledger\.ts'\)/.test(read('scripts/validate_palette.mjs')));
// ⚠️ undefcheck의 import 정규식이 300자까지만 본다 — 합치면 이 파일에서 그 게이트가 무의미해진다.
ok('#G15g ⚠️ ledger import가 300자 미만 덩어리로 쪼개져 있다',
  (LP_RAW.match(/import \{[^}]*\} from '\.\.\/ledger';/g) || []).every((b) => b.length < 300));

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:ledger — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
