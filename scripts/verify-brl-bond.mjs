#!/usr/bin/env node
// 브라질 채권 계산 순수 로직 검증 — src/brlBond.ts 의 참조 구현과 1:1 동기화할 것.
//
// 이 파일이 고정하는 것은 "예외 없이 조용히 틀린 값이 나오는" 결함들이다:
//   #1~#5   수량 정수 내림 + 잔여 (액면 1,000 BRL = 1좌 단위)
//   #6~#10  이자는 '액면' 기준 발생 · 수령은 BRL→USD→KRW 경로
//   #11~#16 경상수익률 = 액면이자 ÷ 매수단가 (할인 매입의 핵심 지표)
//   #17~#19 원화 기준 이자율 — 매수 환율과 이자 환율이 다를 때 갈라진다
//   #20~#27 YTM (상환차익 포함) · 대소관계 불변식 · 음수 수익률의 null 계약
//   #28~#34 null 계약 (0 나눗셈·결측 입력이 NaN/Infinity 로 새지 않을 것)
//   #35~#37 만기 손익

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = Object.is(got, want) || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want}`); }
};
const close = (name, got, want, tol = 1e-6) => {
  const ok = typeof got === 'number' && Math.abs(got - want) <= tol;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want} (±${tol})`); }
};
const ok = (name, cond, info = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? `\n      ${info}` : ''}`); }
};

// ───────── 참조 구현 (src/brlBond.ts 미러) ─────────
const BRL_COUPONS_PER_YEAR = 2;

const num = (v) => (Number.isFinite(v) ? v : null);
const pos = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const nonNeg = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
const mul = (a, b) => (a == null || b == null ? null : num(a * b));
const div = (a, b) => (a == null || b == null || b === 0 ? null : num(a / b));

const solveYtmPerPeriod = (price, face, couponPerPeriod, periods) => {
  const p = pos(price);
  const f = pos(face);
  const c = nonNeg(couponPerPeriod);
  const n = Math.round(Number(periods));
  if (p == null || f == null || c == null || !Number.isFinite(n) || n < 1) return null;

  const pv = (y) => {
    if (y <= 0) return c * n + f;
    const d = Math.pow(1 + y, -n);
    return (c * (1 - d)) / y + f * d;
  };

  if (pv(0) <= p) return pv(0) === p ? 0 : null;

  let lo = 0, hi = 1;
  for (let g = 0; pv(hi) > p; g++) {
    hi *= 2;
    if (g > 40 || !Number.isFinite(hi)) return null;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > p) lo = mid; else hi = mid;
  }
  return num((lo + hi) / 2);
};

const computeBrlBond = (input) => {
  const krw = pos(input?.krw);
  const price = pos(input?.price);
  const face = pos(input?.face);
  const rate = nonNeg(input?.couponRate);
  const years = pos(input?.years);
  const fxBuy = pos(input?.fxBuy);
  const fxUsdBrl = pos(input?.fxUsdBrl);
  const fxUsdKrw = pos(input?.fxUsdKrw);

  const investBrl = div(krw, fxBuy);
  const qty = investBrl == null || price == null ? null : Math.floor(investBrl / price);
  const faceTotal = mul(qty, face);
  const costBrl = mul(qty, price);
  const costKrw = mul(costBrl, fxBuy);
  const leftoverBrl = investBrl == null || costBrl == null ? null : num(investBrl - costBrl);
  const leftoverKrw = mul(leftoverBrl, fxBuy);

  const couponUnitAnnual = face == null || rate == null ? null : num((face * rate) / 100);
  const couponAnnualBrl = mul(qty, couponUnitAnnual);
  const couponHalfBrl = div(couponAnnualBrl, BRL_COUPONS_PER_YEAR);
  const couponAnnualUsd = div(couponAnnualBrl, fxUsdBrl);
  const couponAnnualKrw = mul(couponAnnualUsd, fxUsdKrw);
  const couponHalfUsd = div(couponHalfBrl, fxUsdBrl);
  const couponHalfKrw = mul(couponHalfUsd, fxUsdKrw);

  const currentYield = couponUnitAnnual == null || price == null ? null : num((couponUnitAnnual / price) * 100);
  const krwYield = couponAnnualKrw == null || costKrw == null || costKrw === 0
    ? null : num((couponAnnualKrw / costKrw) * 100);

  const periods = years == null ? null : Math.max(1, Math.round(years * BRL_COUPONS_PER_YEAR));
  const ytmSemi = periods == null ? null
    : solveYtmPerPeriod(price, face, div(couponUnitAnnual, BRL_COUPONS_PER_YEAR), periods);
  const ytmAnnual = ytmSemi == null ? null : num(ytmSemi * BRL_COUPONS_PER_YEAR * 100);
  const ytmEffective = ytmSemi == null ? null : num((Math.pow(1 + ytmSemi, BRL_COUPONS_PER_YEAR) - 1) * 100);

  const redeemGainBrl = qty == null || face == null || price == null ? null : num(qty * (face - price));
  const redeemGainPct = face == null || price == null ? null : num(((face - price) / price) * 100);
  const totalCouponBrl = couponAnnualBrl == null || years == null ? null : num(couponAnnualBrl * years);
  const totalGainBrl = redeemGainBrl == null || totalCouponBrl == null ? null : num(redeemGainBrl + totalCouponBrl);

  return {
    investBrl, qty, faceTotal, costBrl, costKrw, leftoverBrl, leftoverKrw,
    couponUnitAnnual, couponAnnualBrl, couponAnnualUsd, couponAnnualKrw,
    couponHalfBrl, couponHalfUsd, couponHalfKrw,
    currentYield, krwYield,
    ytmSemiPct: ytmSemi == null ? null : num(ytmSemi * 100), ytmAnnual, ytmEffective,
    redeemGainBrl, redeemGainPct, totalCouponBrl, totalGainBrl,
  };
};

// ───────── 기준 시나리오 (사용자 예시) ─────────
// 액면 1,000 BRL · 표면 10% · 시장금리로 할인돼 780 BRL 에 매수 · 잔존 10년 · 반기 지급
// 환율: 매수 원/헤알 286.90 · 이자 USD당 5.087 헤알 · 원/달러 1,459.42
const BASE = {
  krw: 1_000_000, price: 780, face: 1000, couponRate: 10, years: 10,
  fxBuy: 286.9, fxUsdBrl: 5.087, fxUsdKrw: 1459.42,
};
const r = computeBrlBond(BASE);

console.log('\n■ 수량 · 잔여 (정수 좌 내림)');
close('#1 투자금 → 헤알 환산', r.investBrl, 1_000_000 / 286.9, 1e-9);
eq('#2 매수 수량 = 내림(3485.53 ÷ 780)', r.qty, 4);
eq('#3 액면 총액', r.faceTotal, 4000);
eq('#4 투입 금액(BRL) = 수량 × 단가', r.costBrl, 3120);
close('#5 잔여 = 환산액 − 투입액', r.leftoverBrl, 1_000_000 / 286.9 - 3120, 1e-9);
close('#5b 투입 원화 = 투입 BRL × 매수환율', r.costKrw, 3120 * 286.9, 1e-6);
// ⚠️ 내림이므로 '투입 원화 + 잔여 원화 = 투자금' 항등식이 유지돼야 한다(잔여를 버리면 원금이 샌다)
close('#5c 투입 + 잔여 = 투자금', r.costKrw + r.leftoverKrw, 1_000_000, 1e-6);

console.log('\n■ 이자 — 액면 기준 발생 · BRL→USD→KRW 수령');
eq('#6 연 이자 = 액면총액 × 표면금리 (단가 무관)', r.couponAnnualBrl, 400);
eq('#7 6개월 이자 = 연 ÷ 2', r.couponHalfBrl, 200);
close('#8 6개월 이자(USD) = BRL ÷ USD당헤알', r.couponHalfUsd, 200 / 5.087, 1e-9);
close('#9 6개월 이자(원) = USD × 원/달러', r.couponHalfKrw, (200 / 5.087) * 1459.42, 1e-6);
close('#10 연 이자(원) = 6개월 × 2', r.couponAnnualKrw, r.couponHalfKrw * 2, 1e-6);

console.log('\n■ 경상수익률 (액면 10% → 매입가 기준 12.82%)');
close('#11 100 ÷ 780 = 12.8205%', r.currentYield, (100 / 780) * 100, 1e-9);
ok('#12 할인 매입이면 표면금리보다 높다', r.currentYield > 10);
{
  // 단가 기준 지표라 수량이 0 이어도 산출된다 (투자금이 1좌 값에 못 미치는 경우)
  const t = computeBrlBond({ ...BASE, krw: 100_000 });
  eq('#13 투자금 부족 → 수량 0', t.qty, 0);
  eq('#13b 수량 0 이면 이자도 0 (NaN 아님)', t.couponAnnualBrl, 0);
  close('#13c 그래도 경상수익률은 단가 기준으로 산출', t.currentYield, (100 / 780) * 100, 1e-9);
  eq('#13d 투입금액 0 → 원화 기준 이자율은 null (0 나눗셈 방어)', t.krwYield, null);
}
close('#14 액면가 매수 → 경상 = 표면금리', computeBrlBond({ ...BASE, price: 1000 }).currentYield, 10, 1e-9);
ok('#15 할증 매수 → 경상 < 표면', computeBrlBond({ ...BASE, price: 1200 }).currentYield < 10);
close('#16 액면·표면금리 변경도 반영 (500 액면 · 8%)',
  computeBrlBond({ ...BASE, face: 500, couponRate: 8, price: 400 }).currentYield, (40 / 400) * 100, 1e-9);

console.log('\n■ 원화 기준 이자율 (매수 환율 ≠ 이자 환율)');
{
  // 매수 환율이 라이브 교차환율(1459.42/5.087)과 같으면 경상수익률과 일치해야 한다
  const cross = 1459.42 / 5.087;
  const t = computeBrlBond({ ...BASE, fxBuy: cross });
  close('#17 매수·이자 환율이 같으면 경상수익률과 일치', t.krwYield, t.currentYield, 1e-9);
  const won = computeBrlBond({ ...BASE, fxBuy: cross * 1.1 });
  ok('#18 매수 후 헤알 약세 → 원화 기준 이자율 하락', won.krwYield < won.currentYield);
  const up = computeBrlBond({ ...BASE, fxBuy: cross * 0.9 });
  ok('#19 매수 후 헤알 강세 → 원화 기준 이자율 상승', up.krwYield > up.currentYield);
}

console.log('\n■ YTM (상환차익 포함)');
close('#20 780 할인 · 10년 → 반기 7.0914%', r.ytmSemiPct, 7.09139, 1e-4);
close('#21 연환산 = 반기 × 2', r.ytmAnnual, r.ytmSemiPct * 2, 1e-9);
close('#22 실효 = (1+반기)² − 1', r.ytmEffective, (Math.pow(1 + r.ytmSemiPct / 100, 2) - 1) * 100, 1e-9);
// 할인 매입의 대소관계 — 상환차익이 있으므로 YTM 이 경상수익률보다 커야 한다
ok('#23 할인: YTM > 경상 > 표면', r.ytmAnnual > r.currentYield && r.currentYield > 10,
  `ytm=${r.ytmAnnual} cur=${r.currentYield}`);
{
  const par = computeBrlBond({ ...BASE, price: 1000 });
  close('#24 액면가 매수 → YTM(연) = 표면금리', par.ytmAnnual, 10, 1e-6);
  const prem = computeBrlBond({ ...BASE, price: 1200 });
  ok('#25 할증: YTM < 경상 < 표면', prem.ytmAnnual < prem.currentYield && prem.currentYield < 10,
    `ytm=${prem.ytmAnnual} cur=${prem.currentYield}`);
  const zero = computeBrlBond({ ...BASE, couponRate: 0 });
  close('#26 무이표 → (액면/단가)^(1/N) − 1', zero.ytmSemiPct, (Math.pow(1000 / 780, 1 / 20) - 1) * 100, 1e-6);
  // 무이자 원리금 합(= 쿠폰×기간 + 액면)보다 비싸게 사면 수익률이 음수 → 표시할 값이 없다
  eq('#27 원리금 합보다 비싼 단가 → null (음수 수익률)',
    computeBrlBond({ ...BASE, price: 3000 }).ytmAnnual, null);
  eq('#27b 원리금 합과 정확히 같으면 0%',
    computeBrlBond({ ...BASE, price: 2000 }).ytmAnnual, 0);
  const half = computeBrlBond({ ...BASE, years: 7.5 });
  ok('#27c 잔존만기 소수 → 반기 기간수 반올림(15기)', half.ytmAnnual != null && half.ytmAnnual > 0);
}

console.log('\n■ null 계약 (예외 없이 미산출)');
{
  const empty = computeBrlBond({});
  eq('#28 전 입력 결측 → 수량 null', empty.qty, null);
  eq('#28b 이자 null', empty.couponAnnualBrl, null);
  eq('#28c 경상수익률 null', empty.currentYield, null);
  eq('#28d YTM null', empty.ytmAnnual, null);
  eq('#29 매수단가 0 → 수량 null (Infinity 아님)', computeBrlBond({ ...BASE, price: 0 }).qty, null);
  eq('#29b 매수단가 음수 → null', computeBrlBond({ ...BASE, price: -780 }).qty, null);
  eq('#30 매수 환율 0 → 환산액 null', computeBrlBond({ ...BASE, fxBuy: 0 }).investBrl, null);
  eq('#31 이자 환율 결측 → USD/KRW 이자만 null', computeBrlBond({ ...BASE, fxUsdBrl: null }).couponHalfUsd, null);
  eq('#31b 이자 환율 결측이어도 BRL 이자는 산출', computeBrlBond({ ...BASE, fxUsdBrl: null }).couponHalfBrl, 200);
  eq('#32 액면 결측 → 이자 null', computeBrlBond({ ...BASE, face: null }).couponAnnualBrl, null);
  eq('#33 잔존만기 없음 → YTM 계열만 null', computeBrlBond({ ...BASE, years: null }).ytmAnnual, null);
  eq('#33b 잔존만기 없어도 경상수익률·이자는 정상',
    computeBrlBond({ ...BASE, years: null }).couponHalfBrl, 200);
  eq('#34 NaN 입력 방어', computeBrlBond({ ...BASE, krw: NaN }).qty, null);
  eq('#34b 문자열/undefined 방어', computeBrlBond({ ...BASE, price: undefined }).currentYield, null);
}

console.log('\n■ 만기 손익');
eq('#35 상환차익 = 수량 × (액면 − 단가)', r.redeemGainBrl, 4 * 220);
close('#36 단가 대비 상환차익률', r.redeemGainPct, (220 / 780) * 100, 1e-9);
eq('#37 총 이자 = 연 이자 × 잔존만기', r.totalCouponBrl, 4000);
eq('#37b 만기 총 손익 = 이자 + 차익', r.totalGainBrl, 4880);

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:brl — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
