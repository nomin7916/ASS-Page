// 비활성 시장 계좌의 '오늘' 라이브 기록 갱신 규칙 — useHistoryBackfill 효과#1이 쓴다. (⚠️ import 0 — verify:live-today 직접 import)
// 배경(2026-11-26 사용자 확인 요청 "종목 가격이 잘 반영되는지"): 앱을 켜면 효과#1이 Drive에 저장돼 있던 시세
//   (portfolioSummaries)로 비활성 계좌의 오늘 줄을 먼저 적고, 새 시세가 와도 "같은 날 1건만(불변)"이라 그대로 남았다.
//   → ISA·연금저축·REITs 오늘 줄이 그저께 평가액, 다른 날은 장중 몇 시의 값으로 굳었다(당일 21:00 이후 앱을 열어야만 고쳐짐).
// 규칙: 확정 줄(isFixed — 백필·자동확정·사용자 확정)과 휴일 이상치 보정 줄(isAdjusted)은 건드리지 않는다.
//   라이브 줄만 새 평가액으로 맞춘다(활성 계좌의 오늘 줄이 totals를 따라가는 것과 같은 성격).
//   ⚠️ 원금(principal)은 건드리지 않는다 — 해외계좌는 활성 흐름이 달러 원금, 이 효과가 원화 원금(principalKRW)을 적어 와서
//   줄마다 단위가 다르다. 평가액만 고쳐 그 줄을 만든 쪽의 원금 단위를 지킨다.
export type LiveSummary = { currentEval: number };

/** hist[idx](오늘 기록)를 새 평가액으로 맞춘 새 배열. 바꿀 것이 없으면 null. */
export function refreshLiveTodayRow(hist: any[], idx: number, s: LiveSummary): any[] | null {
  const cur = hist?.[idx];
  if (!cur || cur.isFixed || cur.isAdjusted) return null;
  if (!(Number(s?.currentEval) > 0)) return null;
  if (Math.round(Number(cur.evalAmount) || 0) === Math.round(s.currentEval)) return null;
  const next: any = { ...cur, evalAmount: s.currentEval };
  if (cur.adjustedAmount !== undefined) next.adjustedAmount = s.currentEval;
  if (cur.actualEvalAmount !== undefined) next.actualEvalAmount = s.currentEval;
  const nh = hist.slice();
  nh[idx] = next;
  return nh;
}
