// 입출금 보정 일간 수익률(Modified Dietz) 단위 테스트.
// 실행: npm run verify:twr
// 차이 발생 시 종료코드 1.
//
// utils.ts는 TS이므로 esbuild/tsc 없이 직접 import 불가 →
// externalFlowInRange / dailyFlowAdjustedRate 와 통합 netFlow 규칙을 그대로 재정의(=참조 구현)해 검증.
// 본 파일과 src/utils.ts · src/hooks/useIntegratedData.ts 의 함수 본문은 항상 동기화 필요.
//
// 핵심 회귀 케이스: 계좌에 ₩49,118,578이 입금된 날 전일대비가 입금액을 통째로 수익으로 계상해
// 통합 +9.10% / 개별 계좌 +350.69%를 표시하던 버그. 실제 시장 수익은 ₩11,312,160(+1.59%)이다.

// ─── 참조 구현 (src/utils.ts 미러) ──────────────────────────────────────────
const cleanNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
  return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
};

const externalFlowInRange = (depositHistory, depositHistory2, fromExclusive, toInclusive, rateOf) => {
  const rate = typeof rateOf === 'function' ? rateOf : () => 1;
  let inFlow = 0, outFlow = 0;
  const inRange = (dt) => dt && dt > (fromExclusive || '') && dt <= (toInclusive || '');
  // ⚠️ Math.abs 금지 — 음수 '정정 행'이 유입으로 뒤집힌다(테스트 #17)
  for (const d of depositHistory || []) {
    if (!d || d.noPrincipal || !inRange(d.date || '')) continue;
    const v = cleanNum(d.amount) * rate(d);
    if (v > 0) inFlow += v; else if (v < 0) outFlow += -v;
  }
  for (const w of depositHistory2 || []) {
    if (!w || !inRange(w.date || '')) continue;
    const v = cleanNum(w.amount) * rate(w);
    if (v > 0) outFlow += v; else if (v < 0) inFlow += -v;
  }
  return { in: inFlow, out: outFlow, net: inFlow - outFlow };
};

const dailyFlowAdjustedRate = (prevEval, curEval, flowIn, flowOut) => {
  const base = (prevEval || 0) + (flowIn || 0);
  if (!(base > 0)) return 0;
  const r = (((curEval || 0) + (flowOut || 0)) / base - 1) * 100;
  return Number.isFinite(r) ? r : 0;
};

// 일간 손익(₩) — 두 분모 규약과 무관하게 동일한 값 (표의 주인공)
const dailyProfit = (prevEval, curEval, flowIn, flowOut) => curEval - prevEval - (flowIn - flowOut);

// 보류 판정 (src/utils.ts shouldHoldDailyMetrics 미러 — 통합·개별·CSV 공유)
// 'V가 그 흐름을 담고 있다고 볼 수 있는가' 하나로 판정한다.
const MATERIAL_FLOW_RATIO = 0.01;
const ABSORBED_RATIO = 0.5;
// bookDelta(장부액 변화)가 있으면 ΔV 대신 그것으로 흡수를 판정한다(추측 → 관측).
const shouldHold = (prevV, curV, netFlow, bookDelta) => {
  if (prevV == null || curV == null) return true;
  if (!(prevV > 0)) return true;
  const f = netFlow || 0;
  if (f === 0) return false;
  const dV = curV - prevV;
  if (dV === 0) return true;
  if (Math.abs(f) <= prevV * MATERIAL_FLOW_RATIO) return false;
  const absorbed = bookDelta != null ? bookDelta : dV;
  return f > 0 ? absorbed < f * ABSORBED_RATIO : absorbed > f * ABSORBED_RATIO;
};

// 보류된 행의 미소진 흐름 이월 (src/utils.ts computeDailyMetricsSeries 미러).
// rows: [{ date, evalAmount, flowIn, flowOut, ledger?, flowSuspect }] 오름차순
const CARRY_MAX_ROWS = 15;
const CARRY_MAX_ACTIVE_ROWS = 2;
const ACTIVE_DRIFT_RATIO = 0.05;
const computeDailyMetrics = (rows) => {
  const out = new Map();
  let carryIn = 0, carryOut = 0, carryLedger = 0, carryRows = 0, activeRows = 0;
  const list = Array.isArray(rows) ? rows : [];
  let prev = null;
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (!h || !h.date) continue;
    if (!prev) {
      out.set(h.date, { dodAbsChange: null, dodChange: 0, ledgerFlow: 0, held: true });
      prev = h;
      continue;
    }
    const prevV = prev.evalAmount;
    const dV = h.evalAmount - prevV;
    const ownIn = h.flowIn || 0, ownOut = h.flowOut || 0;
    const ownLedger = h.ledger != null ? h.ledger : (ownIn - ownOut);
    let fIn = ownIn + carryIn, fOut = ownOut + carryOut, ledger = ownLedger + carryLedger;
    const bookDelta = h.bookDelta != null ? h.bookDelta : null;
    let held = !!h.flowSuspect || shouldHold(prevV, h.evalAmount, fIn - fOut, bookDelta);
    // ACTIVE 폐기는 bookDelta가 없을 때(추측)만 — 관측이 있으면 미반영이 확정이라 폐기 시 가짜 손익
    if (held && (carryRows >= CARRY_MAX_ROWS || (bookDelta == null && activeRows >= CARRY_MAX_ACTIVE_ROWS))) {
      carryIn = 0; carryOut = 0; carryLedger = 0; carryRows = 0; activeRows = 0;
      fIn = ownIn; fOut = ownOut; ledger = ownLedger;
      held = !!h.flowSuspect || shouldHold(prevV, h.evalAmount, fIn - fOut, bookDelta);
    }
    const netFlow = fIn - fOut;
    out.set(h.date, {
      dodAbsChange: held ? null : dV - netFlow,
      dodChange: held ? 0 : dailyFlowAdjustedRate(prevV, h.evalAmount, fIn, fOut),
      ledgerFlow: held ? 0 : ledger,
      held,
    });
    if (held && !h.flowSuspect && netFlow !== 0) {
      carryIn = fIn; carryOut = fOut; carryLedger = ledger;
      carryRows += 1;
      if (Math.abs(dV) > Math.abs(netFlow) * ACTIVE_DRIFT_RATIO) activeRows += 1;
    } else {
      carryIn = 0; carryOut = 0; carryLedger = 0; carryRows = 0; activeRows = 0;
    }
    prev = h;
  }
  return out;
};

// 누적 TWR — src/utils.ts computeCumulativeTwrSeries 미러
const computeCumulativeTwr = (rows) => {
  const metrics = computeDailyMetrics(rows);
  const out = new Map();
  const list = Array.isArray(rows) ? rows : [];
  let factor = 1;
  for (const h of list) {
    if (!h || !h.date) continue;
    const m = metrics.get(h.date);
    const r = (m && !m.held) ? (m.dodChange || 0) : 0;
    const next = factor * (1 + r / 100);
    if (Number.isFinite(next) && next > 0) factor = next;
    out.set(h.date, (factor - 1) * 100);
  }
  return out;
};

// 구간 재베이스 — src/utils.ts rebaseTwr 미러
const rebaseTwr = (twr, baseTwr) => {
  if (twr == null) return null;
  const b = baseTwr == null ? 0 : baseTwr;
  const denom = 1 + b / 100;
  if (!(denom > 0)) return null;
  const r = ((1 + twr / 100) / denom - 1) * 100;
  return Number.isFinite(r) ? r : null;
};

// ─── 테스트 하네스 ──────────────────────────────────────────────────────────
let failed = 0;
const R2 = (n) => Math.round(n * 10000) / 10000;

const check = (label, actual, expected, tol = 0.0001) => {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) {
    failed++;
    console.error(`  ✗ ${label}\n      기대 ${expected}  실제 ${R2(actual)}`);
  } else {
    console.log(`  ✓ ${label}  (${R2(actual)})`);
  }
};

const section = (t) => console.log(`\n${t}`);

// ─── 1. 명세서 원본 검증 테스트 1~5 ─────────────────────────────────────────
section('명세서 검증 테스트 1~5');

// #1 입금만 있고 가격 변동 없는 날 → 0%
check('#1 입금만·가격 무변동', dailyFlowAdjustedRate(10_000_000, 15_000_000, 5_000_000, 0), 0);
check('#1 일간 손익 = 0', dailyProfit(10_000_000, 15_000_000, 5_000_000, 0), 0);

// #2 출금만 있는 날(가격 변동 없음) → 0%
check('#2 출금만·가격 무변동', dailyFlowAdjustedRate(10_000_000, 5_000_000, 0, 5_000_000), 0);
check('#2 일간 손익 = 0', dailyProfit(10_000_000, 5_000_000, 0, 5_000_000), 0);

// #3 입출금 없는 날 → 기존 계산값 (V1/V0 - 1) 과 항등
{
  const v0 = 664_410_208, v1 = 674_410_208;
  const legacy = ((v1 / v0) - 1) * 100;
  check('#3 흐름 0 → 기존 식과 항등', dailyFlowAdjustedRate(v0, v1, 0, 0), legacy);
}

// #4 전일 1,000만 + 당일 500만 입금 + 당일 평가금 1,520만 → +1.3333%
//    (명세서가 기재한 +1.33%. 이 값이 분모 규약 w=1을 확정한다.
//     분모를 전일 평가액으로만 두는 w=0 규약이면 +2.00%가 나오므로 실패한다.)
check('#4 입금 + 시장변동 (규약 확정 테스트)', dailyFlowAdjustedRate(10_000_000, 15_200_000, 5_000_000, 0), 1.333333);
check('#4 일간 손익 ₩200,000', dailyProfit(10_000_000, 15_200_000, 5_000_000, 0), 200_000);

// #5 소액 계좌 + 대형 이체 → 수직 스파이크 없음
//    (분모를 전일 평가액으로만 두면 +18.40%로 폭발한다)
{
  const r = dailyFlowAdjustedRate(5_000_000, 55_038_594, 49_118_578, 0);
  check('#5 소액계좌 대형입금 스파이크 없음', r, 1.7, 0.001);
  if (Math.abs(r) > 5) { failed++; console.error('  ✗ #5 수직 스파이크 발생'); }
}

// ─── 2. 감사에서 추가된 보정 테스트 ─────────────────────────────────────────
section('감사 보정 테스트 6~16');

// #6 현금성 잔액만 편집 → 0% (마통 8,290,000 → 9,290,000)
//    Δ현금성잔액을 흐름으로 잡지 않으면 +0.1505% 유령 수익이 난다.
check('#6 현금성 잔액 편집 (blocker 2)', dailyFlowAdjustedRate(664_410_208, 665_410_208, 1_000_000, 0), 0);

// #7 crypto 주말 — '주말 r=0' 조항을 넣으면 손익이 영구 소거된다
{
  const rSat = dailyFlowAdjustedRate(660_000_000, 664_800_000, 0, 0);
  const rSun = dailyFlowAdjustedRate(664_800_000, 660_912_000, 0, 0);
  check('#7 crypto 토요일 손익 보존', rSat, 0.727273);
  check('#7 crypto 일요일 손익 보존', rSun, -0.584838);
  const twr = ((1 + rSat / 100) * (1 + rSun / 100) - 1) * 100;
  check('#7 주말 누적 (0%면 실패)', twr, 0.138182);
}

// #8 계좌 삭제 — 경계 평가액을 유출로 계상해야 0%
//    (계상하지 않으면 −30.00%가 찍히고, effectivePrincipal 차분을 쓰면 부호가 뒤집힌다)
check('#8 계좌 삭제 (major 4)', dailyFlowAdjustedRate(100_000_000, 70_000_000, 0, 30_000_000), 0);

// #9 신규 계좌 편입 — 첫 등장 평가액을 유입으로 계상해야 0%
check('#9 신규 계좌 편입 (major 4)', dailyFlowAdjustedRate(664_410_208, 714_410_208, 50_000_000, 0), 0);

// #10 배당 입금(noPrincipal 태그) → 수익으로 인정되어야 한다
{
  const deps = [{ date: '2026-07-21', amount: 3_000_000, noPrincipal: true }];
  const f = externalFlowInRange(deps, [], '2026-07-20', '2026-07-21');
  check('#10 배당은 흐름에서 제외', f.net, 0);
  check('#10 배당 수익 인정 (0%면 실패)', dailyFlowAdjustedRate(664_410_208, 667_410_208, f.in, f.out), 0.451530);
}

// #10b 출금은 noPrincipal이어도 전액 반영 (비대칭 규칙)
{
  const wds = [{ date: '2026-07-21', amount: 3_000_000, noPrincipal: true }];
  const f = externalFlowInRange([], wds, '2026-07-20', '2026-07-21');
  check('#10b 배당금 인출은 전액 유출', f.out, 3_000_000);
  check('#10b 배당금 인출일 가짜 손실 없음', dailyFlowAdjustedRate(664_410_208, 661_410_208, f.in, f.out), 0);
}

// #11 해외계좌 입금 — fxRate 미적용 시 +2.0755% 유령 수익
{
  const deps = [{ date: '2026-07-21', amount: 10_000, fxRate: 1380 }];
  const rate = (d) => d.fxRate || 1;
  const f = externalFlowInRange(deps, [], '2026-07-20', '2026-07-21', rate);
  check('#11 해외 입금 KRW 환산', f.in, 13_800_000);
  check('#11 해외 입금일 수익 0', dailyFlowAdjustedRate(664_410_208, 678_210_208, f.in, f.out), 0);
  const raw = externalFlowInRange(deps, [], '2026-07-20', '2026-07-21');
  if (raw.in === f.in) { failed++; console.error('  ✗ #11 fxRate 미적용이 감지되지 않음'); }
  else console.log('  ✓ #11 fxRate 미적용 시 값이 달라짐을 확인 (회귀 감지 가능)');
}

// #12 기록 공백 이후 재개 — 흐름은 (직전 기록일, 당일] 반개구간으로 합산
{
  const deps = [{ date: '2026-07-18', amount: 1_000_000 }]; // 토요일(기록 없음) 입금
  const f = externalFlowInRange(deps, [], '2026-07-17', '2026-07-20');
  check('#12 주말 입금이 다음 기록일로 이월', f.in, 1_000_000);
  check('#12 공백 구간 수익률', dailyFlowAdjustedRate(100_000_000, 107_000_000, 1_000_000, 0), 5.940594);
  const f2 = externalFlowInRange(deps, [], '2026-07-18', '2026-07-20');
  check('#12 반개구간 하한은 배타적(이중계상 방지)', f2.in, 0);
}

// #13 전액 출금 — 분모가 0이 되지 않아야 그날 수익이 보존된다
check('#13 전액 출금 붕괴 없음', dailyFlowAdjustedRate(664_410_208, 0, 0, 664_410_208), 0);

// #14 보류 판정 — '흐름을 뺀 나머지가 하루 변동으로 그럴듯한가'
{
  const t = (label, args, expected) => {
    const got = shouldHold(...args);
    if (got !== expected) { failed++; console.error(`  ✗ #14 ${label} (기대 ${expected}, 실제 ${got})`); }
    else console.log(`  ✓ #14 ${label}`);
  };
  t('원장/평가 완전 비동기 → 보류', [664_410_208, 664_410_208, 49_118_578], true);
  // ⚠️ 옛 규칙 (a)(|ΔV| < |흐름|×5%)는 이 케이스를 놓쳐 −₩46,118,578 가짜 손실을 냈다
  t('흐름 미반영 + 시장 소폭 상승 → 보류', [664_410_208, 667_410_208, 49_118_578], true);
  // ⚠️ 옛 규칙 (b)(|ΔV−흐름| > 전일V×5%)는 전일V의 5% 미만 흐름을 놓쳐 원래 버그가 2일로 분할 재발했다
  t('전일V의 3% 입금이 주말 원장에만 → 보류', [664_410_208, 664_410_208, 20_000_000], true);
  t('정상 입금일 → 보류 안 함', [664_410_208, 724_840_946, 49_118_578], false);
  t('소액 흐름 → 판정 대상 아님', [664_410_208, 664_410_218, 1_000], false);
  // ⚠️ 옛 규칙 (b)는 이 crypto 케이스를 오탐해 실제 +10% 수익을 '-'로 숨기고
  //    다음 날 −₩200,000 가짜 손실 + 유령 입금 배지를 만들었다
  t('crypto +10%일의 정상 입금 → 보류 안 함', [10_000_000, 11_200_000, 200_000], false);
  // ⚠️ 설계상 감수하는 오탐: 흐름과 시장 하락이 비슷한 크기로 상쇄되면 구분이 불가능하다.
  //    (V가 흐름 방향으로 절반도 안 움직였으므로 '미반영'과 형태가 같다) → #14b가 자가 복구를 검증한다.
  t('입금 + 대형 하락이 상쇄 → 보류(의도된 오탐)', [100_000_000, 98_000_000, 5_000_000], true);
  // ⚠️ 부호 무시(Math.abs) 규칙이었을 때 놓치던 미탐 2종 — 흐름 전액이 손익으로 계상됐다
  t('미반영 입금 + 반대방향 시장 하락 → 보류', [664_410_208, 658_410_208, 10_000_000], true);
  t('미반영 출금 + 반대방향 시장 상승 → 보류', [664_410_208, 694_410_208, -49_118_578], true);
  // ⚠️ 소액 하한이 주말 행보다 먼저 평가됐을 때 놓치던 미탐 (전일V의 0.75% 입금)
  t('전일V 1% 미만 입금이 주말 원장에만 → 보류', [664_410_208, 664_410_208, 5_000_000], true);
}

// #14b 오탐 보류의 자가 복구 — 거래일 이월은 2행 안에 폐기되고 정상 산출로 돌아와야 한다.
//      (폐기가 없으면 이미 반영된 흐름이 계속 차감되어 부호가 뒤집힌 값이 몇 주간 표시된다)
{
  const m = computeDailyMetrics([
    { date: '2026-03-02', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-03-03', evalAmount: 98_000_000, flowIn: 5_000_000, flowOut: 0 }, // 오탐 보류
    { date: '2026-03-04', evalAmount: 98_980_000, flowIn: 0, flowOut: 0 },
    { date: '2026-03-05', evalAmount: 99_960_000, flowIn: 0, flowOut: 0 },
    { date: '2026-03-06', evalAmount: 100_960_000, flowIn: 0, flowOut: 0 },
  ]);
  if (m.get('2026-03-06').dodAbsChange !== 1_000_000) {
    failed++; console.error(`  ✗ #14b 이월 폐기 후 정상 복귀 실패 (${m.get('2026-03-06').dodAbsChange})`);
  } else console.log('  ✓ #14b 거래일 오탐 이월이 폐기되고 정상 산출로 복귀');
}

// #15 라이브 이상치(flowSuspect) → 보류 + 이월 안 함(항상 마지막 행)
{
  const m = computeDailyMetrics([
    { date: '2026-07-20', evalAmount: 664_410_208, flowIn: 0, flowOut: 0 },
    { date: '2026-07-21', evalAmount: 664_410_208, flowIn: 49_118_578, flowOut: 0, flowSuspect: true },
  ]);
  if (m.get('2026-07-21').dodAbsChange !== null) { failed++; console.error('  ✗ #15 flowSuspect 보류 미작동'); }
  else console.log('  ✓ #15 라이브 이상치일 보류');
}

// #16 사용자 실측 회귀 — 2026-07-21 통합
{
  const v0 = 664_410_208, v1 = 724_840_946, flow = 49_118_578;
  const legacy = ((v1 / v0) - 1) * 100;
  check('#16 (참고) 옛 식이 재현하던 값', legacy, 9.0954, 0.001);
  check('#16 보정 후 전일대비', dailyFlowAdjustedRate(v0, v1, flow, 0), 1.58538, 0.001);
  check('#16 보정 후 일간 손익', dailyProfit(v0, v1, flow, 0), 11_312_160);
}

// ─── 3. 구현 감사에서 확정된 회귀 케이스 17~20 ─────────────────────────────
section('구현 감사 회귀 테스트 17~20');

// #17 음수 정정 행 — Math.abs를 쓰면 부호가 뒤집혀 오차가 원장 금액의 2배가 된다
{
  const f1 = externalFlowInRange([{ date: '2026-07-21', amount: -5_000_000 }], [], '2026-07-20', '2026-07-21');
  check('#17 음수 정정 입금은 유출로', f1.net, -5_000_000);
  const f2 = externalFlowInRange([], [{ date: '2026-07-21', amount: -5_000_000 }], '2026-07-20', '2026-07-21');
  check('#17 음수 정정 출금은 유입으로', f2.net, 5_000_000);
  // 같은 날 정정 쌍은 상쇄되어야 한다 (abs면 netFlow 10M → 일간 손익 −₩9,500,000)
  const pair = [{ date: '2026-07-21', amount: 5_000_000 }, { date: '2026-07-21', amount: -5_000_000 }];
  const f3 = externalFlowInRange(pair, [], '2026-07-20', '2026-07-21');
  check('#17 정정 쌍 netFlow 0', f3.net, 0);
  check('#17 정정 쌍 일간 손익 보존', dailyProfit(100_000_000, 100_500_000, f3.in, f3.out), 500_000);
}

// #18 보류된 행이 흐름을 소각하지 않아야 한다 (가장 중요한 회귀 — 버그가 하루 밀려 재발)
//     토: 원장 입금 49.1M 기록, 평가는 금요일 값 carry-forward(ΔV≈0) → 보류 + 이월
//     월: 예수금이 평가에 반영(ΔV=+49.1M+시장수익) → 이월된 흐름으로 정상 보정
{
  const rows = [
    { date: '2026-07-17', evalAmount: 664_410_208, flowIn: 0, flowOut: 0 },
    { date: '2026-07-18', evalAmount: 664_410_208, flowIn: 49_118_578, flowOut: 0 },
    { date: '2026-07-20', evalAmount: 724_840_946, flowIn: 0, flowOut: 0 },
  ];
  const m = computeDailyMetrics(rows);
  const sat = m.get('2026-07-18');
  const mon = m.get('2026-07-20');
  if (sat.dodAbsChange !== null) { failed++; console.error('  ✗ #18 토요일이 보류되지 않음'); }
  else console.log('  ✓ #18 원장/평가 어긋난 토요일 보류');
  check('#18 월요일 일간 손익 (이월 없으면 49,118,578)', mon.dodAbsChange, 11_312_160);
  check('#18 월요일 전일대비 (이월 없으면 +9.10%)', mon.dodChange, 1.58538, 0.001);
}

// #19 긴 연휴에도 이월이 살아남아야 한다 — 2026 KR 설 연휴(주말 포함 5일)보다 길게 검사.
//     상한이 5였을 때 6번째 보류 행에서 흐름이 소각되어 +₩50,000,000 가짜 수익이 났다.
{
  const rows = [{ date: '2026-01-01', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 }];
  for (let i = 2; i <= 7; i++) {
    rows.push({ date: `2026-01-0${i}`, evalAmount: 100_000_000, flowIn: i === 2 ? 50_000_000 : 0, flowOut: 0 });
  }
  rows.push({ date: '2026-01-08', evalAmount: 153_000_000, flowIn: 0, flowOut: 0 });
  const m = computeDailyMetrics(rows);
  for (let i = 2; i <= 7; i++) {
    if (m.get(`2026-01-0${i}`).dodAbsChange !== null) { failed++; console.error(`  ✗ #19 01-0${i} 보류 실패`); }
  }
  console.log('  ✓ #19 연휴 6일 연속 보류 유지');
  check('#19 연휴 후 반영일 일간 손익 (소각되면 53,000,000)', m.get('2026-01-08').dodAbsChange, 3_000_000);
}

// #20 통합·개별·CSV가 같은 공용 함수(computeDailyMetricsSeries)를 쓰므로 같은 날짜를 동일 판정한다
{
  const prevV = 664_410_208, curV = 664_410_208, net = 49_118_578;
  if (!shouldHold(prevV, curV, net)) { failed++; console.error('  ✗ #20 공유 보류 규약 미작동'); }
  else console.log('  ✓ #20 통합·개별·CSV 공유 보류 규약');
  // 미보류였다면 개별 화면에 찍혔을 가짜 값 (회귀 감시용 기준)
  const ghost = dailyFlowAdjustedRate(prevV, curV, net, 0);
  if (Math.abs(ghost + 6.883) > 0.01) { failed++; console.error(`  ✗ #20 가짜값 기준 변동 (${R2(ghost)})`); }
  else console.log('  ✓ #20 미보류 시 가짜값 −6.88% 기준 유지');
}

// #21 개별 계좌(HistoryPanel)·CSV도 이월을 태워야 통합과 값이 일치한다.
//     공용 함수 미사용 시 월요일에 개별만 +9.0954%(옛 식)가 나와 두 화면이 정면 모순됐다.
{
  const rows = [
    { date: '2026-07-17', evalAmount: 664_410_208, flowIn: 0, flowOut: 0 },
    { date: '2026-07-18', evalAmount: 664_410_208, flowIn: 49_118_578, flowOut: 0 },
    { date: '2026-07-19', evalAmount: 664_410_208, flowIn: 0, flowOut: 0 },
    { date: '2026-07-20', evalAmount: 724_840_946, flowIn: 0, flowOut: 0 },
  ];
  const m = computeDailyMetrics(rows);
  check('#21 일요일 건너뛴 뒤에도 이월 유지', m.get('2026-07-20').dodAbsChange, 11_312_160);
  const naive = dailyFlowAdjustedRate(664_410_208, 724_840_946, 0, 0);
  if (Math.abs(naive - 9.0954) > 0.01) { failed++; console.error('  ✗ #21 옛 식 기준 변동'); }
  else console.log('  ✓ #21 이월 없으면 +9.10%였음을 확인 (회귀 감시)');
}

// #21b crypto·예적금 보유 시 주말에도 총자산이 미세하게 움직인다 — 그 드리프트가 ACTIVE 예산을
//      소모해 월요일에 이월이 폐기되면 원래 버그(+9.09%)가 그대로 재현된다.
{
  const m = computeDailyMetrics([
    { date: '2026-07-17', evalAmount: 664_410_208, flowIn: 0, flowOut: 0 },
    { date: '2026-07-18', evalAmount: 664_610_208, flowIn: 49_118_578, flowOut: 0 }, // crypto +200,000
    { date: '2026-07-19', evalAmount: 664_510_208, flowIn: 0, flowOut: 0 },          // crypto −100,000
    { date: '2026-07-20', evalAmount: 724_940_946, flowIn: 0, flowOut: 0 },
  ]);
  check('#21b 주말 드리프트가 있어도 이월 유지', m.get('2026-07-20').dodAbsChange, 11_312_160);
}

// #21c 이월 폐기가 '흐름을 흡수하는 그 행'에서 일어나면 안 된다.
//      거래일 오탐으로 ACTIVE 예산이 찬 상태에서 흐름이 반영되는 행이 오면,
//      그 행은 이월을 소비해 정상값을 내야 한다(폐기는 여전히 보류일 때만).
{
  const m = computeDailyMetrics([
    { date: '2026-05-11', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-05-12', evalAmount: 101_500_000, flowIn: 5_000_000, flowOut: 0 }, // 미반영 → 보류
    { date: '2026-05-13', evalAmount: 103_000_000, flowIn: 0, flowOut: 0 },         // 여전히 미반영 → 보류
    { date: '2026-05-14', evalAmount: 109_000_000, flowIn: 0, flowOut: 0 },         // 흐름 반영일
  ]);
  check('#21c 흡수 행에서 이월을 폐기하지 않음', m.get('2026-05-14').dodAbsChange, 1_000_000);
}

// ─── 4. 누적 TWR (개별 계좌 차트 '조회시작 0%' 라인) #22~#28 ────────────────
section('누적 TWR — 개별 계좌 차트 조회시작 0% 모드');

// #22 흐름이 전혀 없으면 누적 TWR = 평가액 비율과 항등.
{
  const t = computeCumulativeTwr([
    { date: '2026-03-02', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-03-03', evalAmount: 102_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-03-04', evalAmount:  99_000_000, flowIn: 0, flowOut: 0 },
  ]);
  check('#22 흐름 0 → 평가액 비율과 항등', t.get('2026-03-04'), -1);
}

// #23 ★핵심★ 대형 입금이 곡선을 왜곡하지 않는다.
//     구버전 라인(V(t)÷V(시작)−1)은 같은 데이터에서 +747%가 나왔다(실제 시장 수익은 −5% 남짓).
{
  const afterDep = 9_900_000 + 99_180_147; // 대형 입금 직후 평가액(시장 변동 0)
  const t = computeCumulativeTwr([
    { date: '2026-07-14', evalAmount: 10_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-07-15', evalAmount:  9_900_000, flowIn: 0, flowOut: 0 },            // −1.0%
    { date: '2026-07-16', evalAmount: afterDep,   flowIn: 99_180_147, flowOut: 0 },   // 대형 입금, 시장 0%
    { date: '2026-07-17', evalAmount: afterDep * 0.99, flowIn: 0, flowOut: 0 },       // −1.0%
  ]);
  const legacy = (((afterDep * 0.99) / 10_000_000) - 1) * 100; // 구버전 라인이 그리던 값
  check('#23 입금일 자체는 0% 기여', t.get('2026-07-16'), t.get('2026-07-15'));
  check('#23 누적 = 시장 변동분만 (−1% 두 번)', t.get('2026-07-17'), ((0.99 * 0.99) - 1) * 100);
  check('#23 구버전은 +700% 이상으로 부풀었다', legacy > 700 ? 1 : 0, 1);
  check('#23 TWR은 실제 시장 성과 범위 안', Math.abs(t.get('2026-07-17')) < 5 ? 1 : 0, 1);
}

// #24 전액 출금 후 남은 잔액도 곡선을 무너뜨리지 않는다(분모 규약: 유출은 기말 가중).
{
  const t = computeCumulativeTwr([
    { date: '2026-04-01', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-04-02', evalAmount:  50_500_000, flowIn: 0, flowOut: 50_000_000 }, // 출금 + 시장 +0.5%
  ]);
  check('#24 출금일 = 시장 변동분만', t.get('2026-04-02'), 0.5);
}

// #25 보류(held) 행은 배율 1.0 — 주말 carry-forward에서 곡선이 끊기거나 튀지 않는다.
//     그리고 흐름은 다음 행으로 이월되므로 월요일 값은 시장 변동분만 남는다.
{
  const t = computeCumulativeTwr([
    { date: '2026-07-17', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },          // 금
    { date: '2026-07-18', evalAmount: 100_000_000, flowIn: 50_000_000, flowOut: 0 }, // 토(원장만, ΔV=0) → 보류
    { date: '2026-07-19', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },          // 일 → 보류
    { date: '2026-07-20', evalAmount: 151_500_000, flowIn: 0, flowOut: 0 },          // 월: 입금 반영 + 1%
  ]);
  check('#25 토요일 배율 1.0 (직전값 유지)', t.get('2026-07-18'), 0);
  check('#25 일요일 배율 1.0 (직전값 유지)', t.get('2026-07-19'), 0);
  check('#25 월요일 = 시장 변동분만', t.get('2026-07-20'), 1);
}

// #26 재베이스 항등식 — 구간 수익률은 두 끝점 누적의 비이고, base는 약분된다.
{
  const t = computeCumulativeTwr([
    { date: '2026-02-02', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-02-03', evalAmount: 110_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-02-04', evalAmount: 121_000_000, flowIn: 0, flowOut: 0 },
  ]);
  const base = t.get('2026-02-03');
  check('#26 base 자신을 재베이스하면 0%', rebaseTwr(base, base), 0);
  check('#26 구간 수익률 = 끝점 비', rebaseTwr(t.get('2026-02-04'), base), 10);
  // 조회구간을 어디서 시작하든 구간값이 동일해야 한다(곡선 모양 불변).
  const full = rebaseTwr(t.get('2026-02-04'), t.get('2026-02-02'));
  check('#26 전체구간 = 개별 일간의 곱', full, ((1.1 * 1.1) - 1) * 100);
}

// #27 첫 행은 항상 0% (비교 대상이 없고, 그 흐름은 이미 V에 반영돼 있다).
{
  const t = computeCumulativeTwr([
    { date: '2026-01-05', evalAmount: 30_000_000, flowIn: 30_000_000, flowOut: 0 },
    { date: '2026-01-06', evalAmount: 30_300_000, flowIn: 0, flowOut: 0 },
  ]);
  check('#27 첫 행 0%', t.get('2026-01-05'), 0);
  check('#27 둘째 행에 가짜 손실 없음', t.get('2026-01-06'), 1);
}

// #28 평가액 0 + 출금 기록 없음(r = −100%)은 데이터 누락으로 보고 배율 1로 취급한다.
//     곱이 0이 되면 이후 전 구간이 −100%로 영구 고정돼 차트가 죽는다.
//     그 다음 행은 전일 평가액이 0이라 shouldHold가 한 번 더 보류시키고(정상), 그 이후 복귀한다.
{
  const t = computeCumulativeTwr([
    { date: '2026-06-01', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-06-02', evalAmount:           0, flowIn: 0, flowOut: 0 }, // 시세 전체 미로드
    { date: '2026-06-03', evalAmount: 101_000_000, flowIn: 0, flowOut: 0 }, // 전일 V=0 → 한 행 보류
    { date: '2026-06-04', evalAmount: 102_010_000, flowIn: 0, flowOut: 0 }, // +1% 정상 복귀
  ]);
  check('#28 전손 오판을 배율 1로 흡수', t.get('2026-06-02'), 0);
  check('#28 −100%로 영구 고정되지 않음', t.get('2026-06-03'), 0);
  check('#28 데이터 복구 후 곡선 재개', t.get('2026-06-04'), 1);
}

// #29 장부액(bookDelta) 관측 — '흐름이 그날 평가액에 반영됐는가'를 ΔV로 추측하면 두 가지가 깨진다.
//     (A) 정상 반영된 출금이 같은 날 시장 상승에 가려 '미반영'으로 오판 → '-'로 은폐 + 다음 날 이중 차감
//     (B) 출금 원장일과 예수금 수정일이 어긋난 구간에서 ACTIVE 폐기가 흐름을 소각 → 반영일에 가짜 대손실
//     장부액(Σ 예수금+매입원가)은 시세로 변하지 않으므로 두 경우를 정확히 갈라낸다.
{
  const t = (label, args, expected) => {
    const got = shouldHold(...args);
    if (got !== expected) { failed++; console.error(`  ✗ #29 ${label} (기대 ${expected}, 실제 ${got})`); }
    else console.log(`  ✓ #29 ${label}`);
  };
  // (A) 2% 인출 + 시장 +1.5% → ΔV(−50만)만 보면 보류(오탐), 장부(−200만)를 보면 반영됨이 확정
  t('반영된 출금 + 같은날 상승 → ΔV만 보면 오탐 보류', [100_000_000, 99_500_000, -2_000_000], true);
  t('반영된 출금 + 같은날 상승 → 장부 관측이면 보류 안 함', [100_000_000, 99_500_000, -2_000_000, -2_000_000], false);
  // 미반영은 장부 관측으로도 여전히 보류돼야 한다(장부가 안 움직였으므로)
  t('미반영 출금 → 장부도 0이라 보류 유지', [100_000_000, 100_500_000, -2_000_000, 0], true);
  t('미반영 입금 → 장부도 0이라 보류 유지', [100_000_000, 101_000_000, 20_000_000, 0], true);
  // 비거래일 규칙은 bookDelta가 있어도 예외 없음 — V가 직전값 이월이면 흐름은 V에 없다
  t('비거래일(ΔV=0)은 장부가 바뀌어도 보류', [100_000_000, 100_000_000, -2_000_000, -2_000_000], true);
}

// #29b (A)의 시계열 — 오탐 보류가 다음 날 이중 차감으로 부호를 뒤집던 회귀.
//      장부 관측이 있으면 D일에 정상 산출되고 D+1일은 자기 손익만 표시해야 한다.
{
  const m = computeDailyMetrics([
    { date: '2026-05-11', evalAmount: 100_000_000, flowIn: 0, flowOut: 0, bookDelta: 0 },
    // 시장 +1.5%(+150만) 후 200만 인출 → 장부 −200만(반영 확정)
    { date: '2026-05-12', evalAmount: 99_500_000, flowIn: 0, flowOut: 2_000_000, bookDelta: -2_000_000 },
    // 흐름 0, 시장 −2%
    { date: '2026-05-13', evalAmount: 97_510_000, flowIn: 0, flowOut: 0, bookDelta: 0 },
  ]);
  if (m.get('2026-05-12').dodAbsChange !== 1_500_000) {
    failed++; console.error(`  ✗ #29b 반영된 출금일이 은폐됨 (${m.get('2026-05-12').dodAbsChange})`);
  } else console.log('  ✓ #29b 반영된 출금일이 정상 산출(+₩1,500,000)');
  // ⚠️ 장부 관측 없이는 이 값이 +10,000(이익)으로 부호가 뒤집혔다
  if (m.get('2026-05-13').dodAbsChange !== -1_990_000) {
    failed++; console.error(`  ✗ #29b 다음 날 이중 차감으로 부호 반전 (${m.get('2026-05-13').dodAbsChange})`);
  } else console.log('  ✓ #29b 다음 날 이중 차감 없음(−₩1,990,000)');
}

// #29c (B) 출금 원장일과 예수금 수정일이 며칠 어긋나도 흐름이 소각되면 안 된다.
//      ACTIVE 폐기(2행)는 bookDelta가 없을 때만 적용되므로, 관측이 있으면 반영일까지 이월이 살아남는다.
{
  // ⚠️ 일변동이 흐름의 5%(=50만)를 넘어야 ACTIVE로 세므로, 폐기가 실제로 발동하도록 시장 등락을
  //    +1,100,000으로 잡았다. 이 값을 줄이면 옛 코드에서도 통과해 회귀를 못 잡는다.
  const m = computeDailyMetrics([
    { date: '2026-05-18', evalAmount: 100_000_000, flowIn: 0, flowOut: 0, bookDelta: 0 },
    // 출금 원장은 오늘이지만 예수금 미수정 → 장부 불변(미반영 확정). 시장만 등락.
    { date: '2026-05-19', evalAmount: 101_100_000, flowIn: 0, flowOut: 10_000_000, bookDelta: 0 },
    { date: '2026-05-20', evalAmount: 102_200_000, flowIn: 0, flowOut: 0, bookDelta: 0 }, // ACTIVE 1
    { date: '2026-05-21', evalAmount: 103_300_000, flowIn: 0, flowOut: 0, bookDelta: 0 }, // 옛 코드는 여기서 폐기
    // 사용자가 예수금을 고친 날 — 장부가 −1,000만 → 이월된 출금이 여기서 정산된다
    { date: '2026-05-22', evalAmount: 93_300_000, flowIn: 0, flowOut: 0, bookDelta: -10_000_000 },
  ]);
  for (const d of ['2026-05-19', '2026-05-20', '2026-05-21']) {
    if (m.get(d).dodAbsChange !== null) {
      failed++; console.error(`  ✗ #29c ${d} 미반영 구간이 보류되지 않음 (${m.get(d).dodAbsChange})`);
    }
  }
  // ⚠️ 폐기가 일어났다면 이 값이 −₩10,000,000 가짜 손실이 된다
  if (m.get('2026-05-22').dodAbsChange !== 0) {
    failed++; console.error(`  ✗ #29c 반영일에 가짜 손실 (${m.get('2026-05-22').dodAbsChange})`);
  } else console.log('  ✓ #29c 지연 반영 출금이 소각되지 않고 반영일에 정산(₩0)');
}

// #29d 장부 미제공(추정 구성·해외계좌)이면 기존 ΔV 휴리스틱과 **완전히 동일**해야 한다(하위호환).
{
  const rows = [
    { date: '2026-03-02', evalAmount: 100_000_000, flowIn: 0, flowOut: 0 },
    { date: '2026-03-03', evalAmount: 98_000_000, flowIn: 5_000_000, flowOut: 0 },
    { date: '2026-03-04', evalAmount: 98_980_000, flowIn: 0, flowOut: 0 },
    { date: '2026-03-05', evalAmount: 99_960_000, flowIn: 0, flowOut: 0 },
    { date: '2026-03-06', evalAmount: 100_960_000, flowIn: 0, flowOut: 0 },
  ];
  const a = computeDailyMetrics(rows);
  const b = computeDailyMetrics(rows.map(r => ({ ...r, bookDelta: null })));
  const same = rows.every(r => a.get(r.date).dodAbsChange === b.get(r.date).dodAbsChange);
  if (!same) { failed++; console.error('  ✗ #29d bookDelta:null이 기존 동작과 다름'); }
  else console.log('  ✓ #29d 장부 미제공 시 기존 ΔV 동작과 동일(#14b와 같은 결과)');
}

// ─── 결과 ───────────────────────────────────────────────────────────────────
console.log('');
if (failed > 0) {
  console.error(`❌ 실패 ${failed}건 — 입출금 보정 로직이 참조 구현과 어긋납니다.`);
  process.exit(1);
}
console.log('✅ 전체 통과 — 입출금 보정 일간 수익률이 명세대로 동작합니다.');
