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

// 입력 초안 → 숫자. 숫자가 하나도 없으면 null('비움' — 호출부가 커밋 규약대로 폴백을 정한다).
export function parseDraftNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!/\d/.test(s)) return null;
  const n = parseFloat(s.replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 말풍선 금액 부호(종목 입장) — 비중을 높이면(매수) +, 줄이면(매도) −. 0은 부호 없음.
export const flowSign = (n) => (n > 0 ? '+' : n < 0 ? '-' : '');

// 말풍선 칸 이름 꼬리 — 수량·실 구매비용이 + 이면 '매수', − 이면 '매도', 0이면 없음(사용자 요청 2026-11-07: '수량(매수)').
export const tradeSideLabel = (n) => (n > 0 ? '매수' : n < 0 ? '매도' : '');
