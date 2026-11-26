// 지난 날짜 수량 변경 = 그날의 매매 기록 (자산검증 모달 · 2026-11-26 사용자 요청)
//
// 발단: 11/17에 매도·매수했는데 앱에는 기록하지 못했다. 오늘(11/26) 계좌 표에서 수량을 고치면 '오늘 바뀐 것'으로
//   남고, 자산검증에서 그날 수량만 고치면 그날의 투자금액을 사용자가 계산할 수 없었다(그리고 계좌 표엔 안 보였다).
// 규칙(사용자 확정): 그날 수량만 바꾸면 투자금액은 식으로 계산된다.
//   · 매수 = 투자금액 + 늘어난 수량 × 그날 단가(기본 = 그날 종가, 체결가로 고칠 수 있다)
//   · 매도 = 투자금액 × 남은 수량 ÷ 원래 수량(평균단가 그대로 — 판 수량만큼의 원가가 빠진다)
//   · 그날 이후의 모든 보유 기록과 계좌 표(오늘)에 같은 차이(수량·투자금액)를 더한다 = 그날에 매매 한 건을 끼워 넣는다.
//   · 예수금은 고르면만 바꾼다(매수 대금 빼기 · 매도 대금 더하기) — 예수금은 증권사 잔고를 따로 맞춰 두는 경우가 많다.
//   · '옮기기'(move): 계좌 표가 이미 새 수량이면 오늘 표에서 먼저 고친 것이다 → 그 변경을 그날로 옮긴다
//     (그날~표에서 고친 날 전까지만 수량을 바꾸고, 그 뒤 수량은 그대로, 투자금액이 손대지 않은 채면 함께 맞춘다).
//
// ⚠️ import 0 — scripts/verify-backdated-trade.mjs가 직접 import한다. utils의 resolveHoldings·snapshotItemsFromPortfolio
//    결과(그날 보유 항목)는 호출부가 baseItems로 넘긴다(모달의 withManualSnapshot과 같은 소스).
// ⚠️ 계좌 표와 '마지막 보유 기록'에 **같은 차이**를 더해야 한다 — 둘이 갈리면 App의 구성 변경 효과가 오늘 날짜로
//    새 기록을 하나 더 만들어 방금 넣은 변경을 오늘부터 되돌린다(verify:backdated-trade #A).

const num = (v: any): number => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : 0;
};
// 소수 오차 정리(0.1+0.2 꼴) — 수량·단가는 소수(해외 소수점 주식·펀드 좌수)일 수 있다.
const r15 = (n: number): number => (Number.isFinite(n) ? Number(n.toPrecision(15)) : 0);

export type TradeCostKind = 'invest' | 'usd' | 'pp';

// 종목을 날짜 사이에서 알아보는 열쇠(스냅샷 항목엔 id가 없다).
export const tradeKeyOf = (it: any): string =>
  `${(it && it.type) || 'stock'}|${it && it.code ? `c:${it.code}` : `n:${(it && it.name) || ''}`}`;

// 이 행의 원가를 담는 칸 — 계좌 표(usePortfolioData)와 같은 규칙.
//   국내·펀드 = investAmount · 금현물 = 매입단가 × 수량 · 해외 주식 = investAmountUsd(스냅샷엔 매입단가 × 수량).
export const tradeCostKind = (accountType: string, item: any): TradeCostKind => {
  if (item && item.type === 'fund') return 'invest';
  if (accountType === 'overseas') return 'usd';
  if (accountType === 'gold') return 'pp';
  return 'invest';
};

export const tradeCostOf = (item: any, kind: TradeCostKind): number => {
  if (!item) return 0;
  const q = num(item.quantity);
  if (kind === 'pp') return num(item.purchasePrice) * q;
  if (kind === 'usd') {
    const u = item.investAmountUsd;
    if (u !== null && u !== undefined && u !== '') return num(u);
    return r15(num(item.purchasePrice) * q);
  }
  const inv = num(item.investAmount);
  return inv > 0 ? inv : num(item.purchasePrice) * q;
};

// 매매로 계산할 수 있는 행인가 — 주식·ETF·금·펀드. 예수금·예적금·수동 현금 행(수량 1, 투자금액 = 평가액)은 아니다.
export const tradeEligible = (item: any, isCashRow?: boolean): boolean =>
  !!item && !isCashRow && item.type !== 'deposit' && item.type !== 'savings';

const roundAmt = (n: number, usd: boolean): number => (usd ? Math.round(n * 100) / 100 : Math.round(n));

// 항목에 원가를 쓴다(종류별 칸). isLive = 계좌 표 항목(해외는 investAmountUsd가 사용자 입력 칸).
const writeCost = (it: any, kind: TradeCostKind, cost: number, qty: number, isLive: boolean): any => {
  const next = { ...it, quantity: qty };
  const c = Math.max(0, qty > 0 ? cost : 0);
  if (kind === 'invest') {
    next.investAmount = c;
  } else if (kind === 'pp') {
    if (qty > 0) next.purchasePrice = r15(c / qty);
  } else {
    if (isLive || (it && it.investAmountUsd !== undefined)) next.investAmountUsd = c;
    if (qty > 0) next.purchasePrice = r15(c / qty);
  }
  return next;
};

const firstDepositIdx = (items: any[]): number => (items || []).findIndex(i => i && i.type === 'deposit');

export type TradeOp = { dq: number; dc: number; dcash: number };
export type TradeState = { at: string; date: string; snapIdx: number; items: any[]; itemIdx: number; op: TradeOp };

// 계획 — 미리보기와 적용이 **같은 계획**을 쓴다(미리보기 숫자 = 실제로 쓰이는 숫자).
// args: { accountType, date, baseItems, baseIndex, newQty, price, cashOn, mode: 'auto'|'add'|'move' }
export const planBackdatedTrade = (p: any, args: any): any => {
  const accountType = args.accountType || (p && p.accountType) || 'portfolio';
  const date = String(args.date || '');
  const baseItems = Array.isArray(args.baseItems) ? args.baseItems : [];
  const baseIndex = args.baseIndex;
  const baseItem = baseItems[baseIndex];
  if (!date || !baseItem) return { ok: false, reason: 'noitem' };
  if (!tradeEligible(baseItem)) return { ok: false, reason: 'ineligible' };
  const usd = accountType === 'overseas';
  const kind = tradeCostKind(accountType, baseItem);
  const key = tradeKeyOf(baseItem);
  const oldQty = num(baseItem.quantity);
  const newQty = r15(Math.max(0, num(args.newQty)));
  const dq = r15(newQty - oldQty);
  if (dq === 0) return { ok: false, reason: 'same' };
  const price = num(args.price);
  if (dq > 0 && !(price > 0)) return { ok: false, reason: 'noprice' };
  const oldCost = roundAmt(tradeCostOf(baseItem, kind), usd);
  const newCost = dq > 0
    ? roundAmt(oldCost + dq * price, usd)
    : (oldQty > 0 ? roundAmt(oldCost * newQty / oldQty, usd) : 0);
  const dc = r15(newCost - oldCost);
  const amount = price > 0 ? roundAmt(Math.abs(dq) * price, usd) : 0;
  const cashOn = !!args.cashOn && amount > 0;
  const dcash = cashOn ? (dq > 0 ? -amount : amount) : 0;
  // 매도 실현손익 = 판 금액 − 빠진 원가(가격이 있을 때만)
  const realized = dq < 0 && price > 0 ? roundAmt(amount - (oldCost - newCost), usd) : null;
  const baseDepIdx = firstDepositIdx(baseItems);
  const cashBefore = baseDepIdx >= 0 ? num(baseItems[baseDepIdx].depositAmount) : null;

  // 그날 뒤의 상태 사슬 = 그날보다 늦은 보유 기록(날짜순) + 계좌 표(오늘).
  const snaps = Array.isArray(p && p.holdingSnapshots) ? p.holdingSnapshots : [];
  const later = snaps
    .map((s: any, i: number) => ({ s, i }))
    .filter(({ s }: any) => s && Array.isArray(s.items) && String(s.date || '') > date)
    .sort((a: any, b: any) => String(a.s.date).localeCompare(String(b.s.date)));
  const chain = [
    ...later.map(({ s, i }: any) => ({ at: 'snap', date: String(s.date), snapIdx: i, items: s.items })),
    { at: 'live', date: '', snapIdx: -1, items: (p && p.portfolio) || [] },
  ].map((st: any) => ({ ...st, itemIdx: (st.items || []).findIndex((it: any) => tradeKeyOf(it) === key) }));

  // 옮기기 — 계좌 표가 이미 새 수량(오늘 표에서 먼저 고쳤다)이고, 그 수량이 처음 나타난 기록이 있을 때만.
  const liveSt = chain[chain.length - 1];
  const liveItem = liveSt.itemIdx >= 0 ? liveSt.items[liveSt.itemIdx] : null;
  let stopAt = -1;
  for (let k = 0; k < chain.length; k++) {
    const st = chain[k];
    if (st.itemIdx < 0) break;
    if (r15(num(st.items[st.itemIdx].quantity)) === newQty) { stopAt = k; break; }
  }
  // ⚠️ 투자금액 칸에 값이 있을 때만(옛 행은 매입단가 × 수량이라 표에서 수량을 고친 순간 원가가 이미 따라 바뀌었다 → 또 빼면 두 번).
  const moveAvailable = kind === 'invest' && num(baseItem.investAmount) > 0
    && !!liveItem && r15(num(liveItem.quantity)) === newQty && stopAt >= 0;
  const mode = args.mode === 'add' ? 'add' : args.mode === 'move' ? (moveAvailable ? 'move' : 'add') : (moveAvailable ? 'move' : 'add');

  // 상태마다 더할 차이를 정한다.
  let itemAlive = true;
  let prevItem = baseItem;       // 바로 앞 상태의 이 종목(손대기 전)
  let prevCash = cashBefore;     // 바로 앞 상태의 예수금(손대기 전)
  let shiftItem = true, shiftCost = true, shiftCash = true;
  const states: TradeState[] = chain.map((st: any, k: number) => {
    const it = st.itemIdx >= 0 ? st.items[st.itemIdx] : null;
    const di = firstDepositIdx(st.items);
    const cash = di >= 0 ? num(st.items[di].depositAmount) : null;
    if (!it) itemAlive = false;
    if (mode === 'move' && k === stopAt) {
      // 표에서 고친 그 기록부터: 수량은 이미 맞다. 투자금액·예수금은 그때 손대지 않았으면 함께 맞춘다.
      shiftItem = false;
      shiftCost = !!it && !!prevItem && num(it.investAmount) === num(prevItem.investAmount);
      shiftCash = cash !== null && prevCash !== null && cash === prevCash;
    }
    const op: TradeOp = {
      dq: itemAlive && shiftItem ? dq : 0,
      dc: itemAlive && (shiftItem || shiftCost) ? dc : 0,
      dcash: cashOn && di >= 0 && (shiftItem || shiftCash) ? dcash : 0,
    };
    if (it) prevItem = it;
    if (cash !== null) prevCash = cash;
    return { ...st, op };
  });

  const applyItem = (it: any, op: TradeOp, isLive: boolean): any => {
    if (!it || (op.dq === 0 && op.dc === 0)) return it;
    const q = r15(Math.max(0, num(it.quantity) + op.dq));
    const c = roundAmt(tradeCostOf(it, kind) + op.dc, usd);
    return writeCost(it, kind, c, q, isLive);
  };
  const liveOp = states[states.length - 1].op;
  const liveAfter = liveItem ? applyItem(liveItem, liveOp, true) : null;
  const liveDepIdx = firstDepositIdx(liveSt.items);
  const liveCashBefore = liveDepIdx >= 0 ? num(liveSt.items[liveDepIdx].depositAmount) : null;

  return {
    ok: true, accountType, date, key, kind, usd, baseIndex, mode, moveAvailable,
    side: dq > 0 ? 'buy' : 'sell',
    oldQty, newQty, dq, price, amount, oldCost, newCost, dc, realized,
    avgBefore: oldQty > 0 ? oldCost / oldQty : 0,
    avgAfter: newQty > 0 ? newCost / newQty : 0,
    cashOn, dcash, cashBefore, cashAfter: cashBefore !== null ? roundAmt(cashBefore + dcash, usd) : null,
    stopDate: mode === 'move' && stopAt >= 0 ? (chain[stopAt].at === 'live' ? 'live' : chain[stopAt].date) : '',
    states,
    live: {
      found: !!liveItem,
      qtyBefore: liveItem ? num(liveItem.quantity) : 0,
      qtyAfter: liveAfter ? num(liveAfter.quantity) : 0,
      costBefore: liveItem ? tradeCostOf(liveItem, kind) : 0,
      costAfter: liveAfter ? tradeCostOf(liveAfter, kind) : 0,
      cashBefore: liveCashBefore,
      cashAfter: liveCashBefore !== null ? roundAmt(liveCashBefore + liveOp.dcash, usd) : null,
    },
    laterDates: states.filter(s => s.at === 'snap' && (s.op.dq || s.op.dc || s.op.dcash)).map(s => s.date),
    applyItem,
  };
};

// 적용 — 그날 보유 기록(수동)을 만들고/고치고, 뒤 기록·계좌 표에 계획의 차이를 더한다.
// 반환은 바뀐 칸만 담은 새 계좌 객체(holdingSnapshots·portfolio·baselineDate·preBaselineVerified).
export const applyBackdatedTrade = (p: any, plan: any, baseItems: any[]): any => {
  if (!p || !plan || !plan.ok) return p;
  const usd = !!plan.usd;
  const addCash = (items: any[], dcash: number): any[] => {
    if (!dcash) return items;
    const di = firstDepositIdx(items);
    if (di < 0) return items;
    const out = items.slice();
    out[di] = { ...out[di], depositAmount: roundAmt(num(out[di].depositAmount) + dcash, usd) };
    return out;
  };
  // ① 그날
  let dayItems = (baseItems || []).slice();
  const bi = dayItems[plan.baseIndex];
  dayItems[plan.baseIndex] = writeCost(bi, plan.kind, plan.newCost, plan.newQty, false);
  dayItems = addCash(dayItems, plan.dcash);
  const snaps = Array.isArray(p.holdingSnapshots) ? p.holdingSnapshots.slice() : [];
  // ② 뒤 기록들
  for (const st of plan.states) {
    if (st.at !== 'snap') continue;
    const s = snaps[st.snapIdx];
    if (!s || !Array.isArray(s.items)) continue;
    let items = s.items;
    if (st.itemIdx >= 0 && (st.op.dq || st.op.dc)) {
      items = items.slice();
      items[st.itemIdx] = plan.applyItem(items[st.itemIdx], st.op, false);
    }
    items = addCash(items, st.op.dcash);
    if (items !== s.items) snaps[st.snapIdx] = { ...s, items };
  }
  const idx = snaps.findIndex((s: any) => s && s.date === plan.date);
  if (idx >= 0) snaps[idx] = { ...snaps[idx], kind: 'manual', items: dayItems };
  else snaps.push({ date: plan.date, kind: 'manual', items: dayItems });
  // ③ 계좌 표(오늘)
  const liveSt = plan.states[plan.states.length - 1];
  let live = Array.isArray(p.portfolio) ? p.portfolio : [];
  if (liveSt.itemIdx >= 0 && (liveSt.op.dq || liveSt.op.dc)) {
    live = live.slice();
    live[liveSt.itemIdx] = plan.applyItem(live[liveSt.itemIdx], liveSt.op, true);
  }
  live = addCash(live, liveSt.op.dcash);
  const next: any = { ...p, holdingSnapshots: snaps, portfolio: live };
  // 기준일 이전 날짜를 고치면 기준일을 그날로 당긴다(모달 withManualSnapshot과 같은 규칙).
  const bDate = p.baselineDate || '';
  if (bDate && plan.date < bDate) {
    next.baselineDate = plan.date;
    next.preBaselineVerified = false;
  }
  return next;
};
