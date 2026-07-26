// @ts-nocheck
// 브라질 채권(헤알화 표시 · 반기 쿠폰 · 달러 경유 수령) 계산 데이터 계층 — 순수 함수만.
//
// 핵심 개념: 표면금리는 '액면(1,000 BRL)' 기준이지만 할인 매입하면 '내 돈' 기준 수익률은 더 높다.
//   액면 1,000 · 표면 10% → 연 이자 100 BRL 고정.  780 BRL 에 샀다면 100/780 = 12.82%(경상수익률).
//   여기에 만기 상환차익(780→1,000)까지 넣은 것이 YTM(만기수익률, 시장금리에 대응).
//
// ⚠️ 환율은 fxRates.ts 의 라이브 맵(메모리 전용)에서 받아 인자로 넘긴다.
//    stockHistoryMap / indicatorHistoryMap 에 절대 병합 금지(fxRates.ts 불변식과 동일 사유).
// ⚠️ 결측·무효 입력은 예외가 아니라 null 을 반환한다 — 로딩 중 빈 환율 맵은 정상 경로다.
//    throw 로 바꾸면 렌더 중 TypeError 가 루트 ErrorBoundary 까지 올라가 계산기가 아니라
//    앱 화면 전체가 오류 페이지로 대체된다(convertFx 의 null 계약과 같은 이유).

export const BRL_BOND_FACE = 1000;      // 액면 (BRL) — 브라질 국채 표준 단위(1좌)
export const BRL_BOND_COUPON = 10;      // 표면금리 (연 %)
export const BRL_BOND_YEARS = 10;       // 잔존만기 (년)
export const BRL_COUPONS_PER_YEAR = 2;  // 6개월(반기) 지급

const num = (v) => (Number.isFinite(v) ? v : null);
const pos = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const nonNeg = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
const mul = (a, b) => (a == null || b == null ? null : num(a * b));
const div = (a, b) => (a == null || b == null || b === 0 ? null : num(a / b));

// ───────── YTM (기간당 수익률) ─────────
// 가격은 y 에 대해 단조감소하므로 이분법이면 충분하다(Newton 의 발산 위험 없음).
// 반환값은 '기간당'(반기) 수익률 — 연환산은 호출부에서.
export const solveYtmPerPeriod = (price, face, couponPerPeriod, periods) => {
  const p = pos(price);
  const f = pos(face);
  const c = nonNeg(couponPerPeriod);
  const n = Math.round(Number(periods));
  if (p == null || f == null || c == null || !Number.isFinite(n) || n < 1) return null;

  const pv = (y) => {
    if (y <= 0) return c * n + f;                       // y→0 극한(할인 없음)
    const d = Math.pow(1 + y, -n);
    return (c * (1 - d)) / y + f * d;
  };

  // 무이자 원리금 합보다 비싸게 샀다 → 수익률이 음수. 표시할 값이 없으므로 null.
  if (pv(0) <= p) return pv(0) === p ? 0 : null;

  let lo = 0, hi = 1;                                    // 기간당 0% ~ 100%
  for (let g = 0; pv(hi) > p; g++) {                     // 초고금리 대비 상한 확장
    hi *= 2;
    if (g > 40 || !Number.isFinite(hi)) return null;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > p) lo = mid; else hi = mid;
  }
  return num((lo + hi) / 2);
};

// ───────── 종합 계산 ─────────
// 입력(전부 숫자 | null):
//   krw        투자금 (원)
//   price      매수단가 (BRL, 액면 face 당)
//   face       액면 (BRL)
//   couponRate 표면금리 (연 %)
//   years      잔존만기 (년) — null 이면 YTM 계열 미산출
//   fxBuy      원/헤알 (매수 환산)
//   fxUsdBrl   USD 당 헤알 (이자 수령 — BRL→USD)
//   fxUsdKrw   원/달러   (이자 수령 — USD→KRW)
export const computeBrlBond = (input) => {
  const krw = pos(input?.krw);
  const price = pos(input?.price);
  const face = pos(input?.face);
  const rate = nonNeg(input?.couponRate);
  const years = pos(input?.years);
  const fxBuy = pos(input?.fxBuy);
  const fxUsdBrl = pos(input?.fxUsdBrl);
  const fxUsdKrw = pos(input?.fxUsdKrw);

  // 투자금 → 헤알 → 정수 좌(액면 1,000 단위) 내림 + 잔여
  const investBrl = div(krw, fxBuy);
  const qty = investBrl == null || price == null ? null : Math.floor(investBrl / price);
  const faceTotal = mul(qty, face);
  const costBrl = mul(qty, price);
  const costKrw = mul(costBrl, fxBuy);
  const leftoverBrl = investBrl == null || costBrl == null ? null : num(investBrl - costBrl);
  const leftoverKrw = mul(leftoverBrl, fxBuy);

  // 이자 — 액면 기준으로 발생하고(단가 무관), 수령은 BRL→USD→KRW
  const couponUnitAnnual = face == null || rate == null ? null : num((face * rate) / 100);
  const couponAnnualBrl = mul(qty, couponUnitAnnual);
  const couponHalfBrl = div(couponAnnualBrl, BRL_COUPONS_PER_YEAR);
  const couponAnnualUsd = div(couponAnnualBrl, fxUsdBrl);
  const couponAnnualKrw = mul(couponAnnualUsd, fxUsdKrw);
  const couponHalfUsd = div(couponHalfBrl, fxUsdBrl);
  const couponHalfKrw = mul(couponHalfUsd, fxUsdKrw);

  // 경상수익률 = 액면이자 ÷ 매수단가 — 수량과 무관한 '단가만의' 지표
  const currentYield = couponUnitAnnual == null || price == null ? null : num((couponUnitAnnual / price) * 100);
  // 원화 기준 = 매수 환율과 이자 수령(조회시점) 환율이 다르면 경상수익률과 갈라진다
  const krwYield = couponAnnualKrw == null || costKrw == null || costKrw === 0
    ? null : num((couponAnnualKrw / costKrw) * 100);

  // YTM — 상환차익까지 반영. 잔존만기 없으면 전부 null.
  const periods = years == null ? null : Math.max(1, Math.round(years * BRL_COUPONS_PER_YEAR));
  const ytmSemi = periods == null ? null
    : solveYtmPerPeriod(price, face, div(couponUnitAnnual, BRL_COUPONS_PER_YEAR), periods);
  const ytmAnnual = ytmSemi == null ? null : num(ytmSemi * BRL_COUPONS_PER_YEAR * 100);
  const ytmEffective = ytmSemi == null ? null : num((Math.pow(1 + ytmSemi, BRL_COUPONS_PER_YEAR) - 1) * 100);

  // 만기 손익
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
