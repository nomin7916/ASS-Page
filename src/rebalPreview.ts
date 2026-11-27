// 리밸런싱 표 — 수량(action)·예상평가금·예상비중 산식의 단일 소스 + 입력 중 미리보기(말풍선) 보조. (⚠️ import 0 — verify:rebal-preview 직접 import)
//
// ⚠️ 표(usePortfolioData)와 말풍선(RebalancingPanel)이 **같은 함수**를 부른다. 말풍선만 식을 따로 굴리면
//    Enter 뒤 표에 나오는 값과 미리 본 값이 어긋난다(사용자는 말풍선을 보고 금액을 정한다).

// 목표금액·목표비중 칸에서 타이핑을 멈추고 이만큼 지나면 말풍선을 띄운다(사용자 요청 2026-11-07: 0.3초).
export const REBAL_PREVIEW_DELAY_MS = 300;

// 자금 축 — overallExp(총평가금 + 이번 투자금, 비중의 분모) · allocBase(이번 투자금 + 쓸 예수금, 적립식 배분액).
// 해외계좌는 totalEval이 원화 프레임이라 fx로 나눠 달러로 되돌린다(국내는 fx=1).
export function rebalCapitalBase({ totalEval = 0, fx = 1, amount = 0, depositAmount = 0, useDepositAmount = null }) {
  const nativeTotalEval = fx > 1 ? totalEval / fx : totalEval;
  const overallExp = nativeTotalEval + amount;
  const useDeposit = useDepositAmount != null
    ? Math.min(Math.max(0, useDepositAmount), depositAmount)
    : depositAmount;
  return { overallExp, allocBase: amount + useDeposit };
}

// 매매 수량 — 목표금액 모드는 금액, 리밸런싱은 목표 평가금(overallExp×비중), 그 밖(적립식·레거시)은 배분액×비중.
// ⚠️ 비-금액 모드는 `=== 'rebalance'`로만 가른다 — 레거시 'deposit-only'가 적립식 식으로 떨어지게(폴백 극성 보존).
// ⚠️ price > 0 가드 필수 — 기준가 미로드 펀드에서 Infinity/NaN이 비용·잔액·추가 수량(Drive 저장)까지 번진다.
export function rebalActionQty({ mode, price, curEval, overallExp, allocBase, tRatio, targetAmount }) {
  if (!(price > 0)) return 0;
  if (mode === 'targetAmount') return Math.trunc((targetAmount - curEval) / price);
  if (mode === 'rebalance') return Math.trunc(((overallExp * tRatio) - curEval) / price);
  return Math.trunc((allocBase * tRatio) / price);
}

// 한 행의 결과. ratio는 % 값(12.5 = 12.5%), amount는 목표 평가금액(목표금액 모드에서만 쓰인다).
// flow = 종목 입장 금액 흐름(매수 +, 매도 −). 표의 '실 구매비용'은 계좌 현금 입장이라 부호가 반대다(−flow).
export function rebalRowOutcome({ mode, price, qty, curEval, overallExp, allocBase, extraQty = 0, ratio = 0, amount = 0 }) {
  const action = rebalActionQty({ mode, price, curEval, overallExp, allocBase, tRatio: ratio / 100, targetAmount: amount });
  const totalAction = action + extraQty;
  const expEval = (qty + action + extraQty) * price;
  const expRatio = overallExp > 0 ? (expEval / overallExp * 100) : 0;
  return { action, totalAction, cost: action * price, flow: totalAction * price, expEval, expRatio };
}

// utils.cleanNum 과 같은 규칙(import 0 이라 사본) — 빈 값 0 · 숫자는 그대로 · 글자는 숫자·점·빼기만 남겨 읽는다.
const toNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
  return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
};

// 자금 요약 — 표 아래 「매수·매도·잔액」. PC 리밸런싱 표와 휴대폰 화면이 **같은 함수**를 부른다(2026-11-27).
// rows = usePortfolioData.rebalanceData · extraQty = 이 계좌의 추가 수량 · 금액은 계좌 통화(해외 = 달러).
// 매매 수량 = action + 추가 · 잔액 = (예수금 + 적립금 + 매도) − 매수. 리밸런싱·목표금액은 예수금 전액, 적립식은 쓸 예수금만.
export function rebalCashSummary({ rows = [], extraQty = {}, depositAmount = 0, settings = {} }) {
  const mode = settings?.mode;
  const isLevelMode = mode === 'rebalance' || mode === 'targetAmount';
  const amount = toNum(settings?.amount);
  const useDeposit = settings?.useDepositAmount != null
    ? Math.min(Math.max(0, toNum(settings.useDepositAmount)), depositAmount)
    : depositAmount;
  let totalBuy = 0, totalSell = 0;
  (rows || []).forEach((d) => {
    const q = d.action + ((extraQty || {})[d.id] || 0);
    if (q > 0) totalBuy += q * toNum(d.currentPrice);
    else if (q < 0) totalSell += -q * toNum(d.currentPrice);
  });
  const depositForBuy = isLevelMode ? depositAmount : useDeposit;
  const totalAvailable = depositForBuy + amount + totalSell;
  return { totalBuy, totalSell, depositForBuy, amount, useDeposit, totalAvailable, balance: totalAvailable - totalBuy, isLevelMode };
}

// 입력 초안 → 숫자. 숫자가 하나도 없으면 null('비움' — 호출부가 커밋 규약대로 폴백을 정한다).
export function parseDraftNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!/\d/.test(s)) return null;
  const n = parseFloat(s.replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 말풍선 매매 방향 — 수량이 + 이면 '매수', − 이면 '매도', 0이면 없음. 칸 이름 '수량(매수)'·'매수금액'에 쓰고
// 금액·수량 값은 부호 없이 크기만 보인다(사용자 요청 2026-11-07: 짧게).
export const tradeSideLabel = (n) => (n > 0 ? '매수' : n < 0 ? '매도' : '');

// 적립식에서 1주를 사는 데 필요한 최소 목표비중(%) — 배분액 × 비중 ÷ 가격 ≥ 1 (사용자 요청 2026-11-08:
// 적립금 50만 원에 10만 4천 원짜리 종목은 10%로는 0주라, 1주가 되는 비중을 알려 달라).
// 비중 칸 자릿수(소수 둘째 자리)로 올림한 뒤 **실제 수량식으로 1주가 되는지** 확인한다(부동소수 경계).
// 가격·배분액이 없으면 null. 100%를 넘으면 그대로 돌려준다(배분액 전부로도 1주를 못 산다는 뜻).
export function minRatioForOneShare({ price, allocBase }) {
  if (!(price > 0) || !(allocBase > 0)) return null;
  let r = Math.ceil((price / allocBase) * 10000 - 1e-9) / 100;
  for (let i = 0; i < 3 && rebalActionQty({ mode: 'accumulate', price, curEval: 0, overallExp: 0, allocBase, tRatio: r / 100 }) < 1; i++) {
    r = Math.round((r + 0.01) * 100) / 100;
  }
  return r;
}
