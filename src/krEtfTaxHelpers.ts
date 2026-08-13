// @ts-nocheck
import { calculateKrEtfDividendTax } from './utils';

export const isKrCode = (code) => /^[A-Z0-9]{5,6}$/i.test(String(code || ''));

export function safeNum(v) {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// 같은 날짜 이벤트의 상대 순서 — **매수 우선**.
// ⚠️ localeCompare만 쓰면 같은 날짜에서 비교값이 0이라 Array.sort의 안정 정렬이 '배열 삽입 순서'를
//    그대로 채택한다. 사용자에게 행 재정렬 UI가 없으므로 결정 요인이 화면에 존재하지 않는데,
//    실현손익은 부호까지 갈린다(같은 날 매수 100@20,000 + 매도 50@12,000 → 기준 15,000이면 −150,000,
//    10,000이면 +100,000). 이동평균법 관례대로 그날 매수를 먼저 반영해 결정적으로 만든다.
// ⚠️ 러닝 평균을 만드는 **모든** 순회가 이 비교자를 공유해야 한다 — 계산기 행(buildSortedEventsWithAvg)과
//    월별 그리드(computeRunningAvgSnapshots)가 다른 순서를 쓰면 같은 달의 평균 과표가 두 값이 된다.
export function compareTaxEvents(a, b) {
  const byDate = String(a?.date || '').localeCompare(String(b?.date || ''));
  if (byDate !== 0) return byDate;
  return (safeNum(b?.change) > 0 ? 1 : 0) - (safeNum(a?.change) > 0 ? 1 : 0);
}

export function getKrEtfStocks(portfolio) {
  return (portfolio?.portfolio || []).filter(it => it.type === 'stock' && isKrCode(it.code));
}

export function getCodeTaxBase(portfolio, code) {
  const rec = portfolio?.taxBaseHistory?.[code] || {};
  return {
    events: rec.events || [],
    purchases: rec.purchases || [],
    sales: rec.sales || [],
    exTaxBase: rec.exTaxBase || {},
    avgTaxBase: rec.avgTaxBase || {},
  };
}

// 이벤트 목록에서 날짜순 정렬 후 누적 평균 매입단가 계산 (차트 수익률용)
// purchasePrice > 0 인 매수 이벤트만 가중평균 업데이트, 매도는 qty만 감소
// 반환: [{date, qty, avgPurchasePrice}]
export function computeRunningAvgPurchaseSnapshots(events) {
  const valid = (events || [])
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) && safeNum(e.change) !== 0)
    .sort(compareTaxEvents);
  let qty = 0;
  let avgPurchasePrice = 0;
  const result = [];
  for (const e of valid) {
    const change = safeNum(e.change);
    if (change > 0) {
      const purchasePrice = safeNum(e.purchasePrice);
      const newQty = qty + change;
      if (purchasePrice > 0) {
        avgPurchasePrice = newQty > 0
          ? (qty * avgPurchasePrice + change * purchasePrice) / newQty
          : purchasePrice;
      }
      qty = newQty;
    } else {
      qty = Math.max(0, qty + change);
    }
    result.push({ date: e.date, qty, avgPurchasePrice });
  }
  return result;
}

// 이벤트 목록에서 날짜 순으로 정렬 후 각 이벤트 후 누적 수량·평균 과표 계산
// change > 0: 매수, change < 0: 매도 (매도 시 평균 과표 유지)
export function computeRunningAvgSnapshots(events) {
  const valid = (events || [])
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) && safeNum(e.change) !== 0)
    .sort(compareTaxEvents);
  let qty = 0;
  let avg = 0;
  return valid.map(e => {
    const change = safeNum(e.change);
    if (change > 0) {
      const newQty = qty + change;
      avg = newQty > 0 ? (qty * avg + change * safeNum(e.taxBasePrice)) / newQty : 0;
      qty = newQty;
    } else {
      qty = Math.max(0, qty + change);
    }
    return { id: e.id, date: e.date, qty, avgPrice: avg };
  });
}

// 각 배당락 월(YYYY-MM)의 평균 과표 자동 계산 (세금 계산용)
// exDateMap: { 'YYYY-MM': 'YYYY-MM-DD' } (portfolio.dividendExDate[code])
export function computeMonthlyAvgFromEvents(events, exDateMap) {
  const snapshots = computeRunningAvgSnapshots(events);
  const result: Record<string, number> = {};
  for (const [ym, exDate] of Object.entries(exDateMap || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(exDate || ''))) continue;
    let best = null;
    for (const s of snapshots) {
      if (s.date <= exDate) best = s;
      else break;
    }
    if (best && best.avgPrice > 0) result[ym] = best.avgPrice;
  }
  return result;
}

// 연간 그리드 표시용 — 배당락일 없는 달도 포함, 각 달 말일 기준 평균 과표 계산
// monthYms: ['YYYY-01', ..., 'YYYY-12']
export function computeMonthlyAvgForGrid(events, monthYms) {
  const snapshots = computeRunningAvgSnapshots(events);
  const result: Record<string, number> = {};
  for (const ym of (monthYms || [])) {
    const [year, month] = ym.split('-').map(Number);
    const lastDay = new Date(year, month, 0).toISOString().slice(0, 10);
    let best = null;
    for (const s of snapshots) {
      if (s.date <= lastDay) best = s;
      else break;
    }
    if (best && best.avgPrice > 0) result[ym] = best.avgPrice;
  }
  return result;
}

// 연간 그리드 표시용 — 각 달 말일 기준 누적 보유 수량 계산
// 이벤트가 없으면 {} 반환 (호출부에서 currentQty로 폴백)
export function computeMonthlyQtyForGrid(events, monthYms) {
  const snapshots = computeRunningAvgSnapshots(events);
  if (snapshots.length === 0) return {};
  const result: Record<string, number> = {};
  for (const ym of (monthYms || [])) {
    const [year, month] = ym.split('-').map(Number);
    const lastDay = new Date(year, month, 0).toISOString().slice(0, 10);
    let best = null;
    for (const s of snapshots) {
      if (s.date <= lastDay) best = s;
      else break;
    }
    result[ym] = best != null ? best.qty : 0;
  }
  return result;
}

// ── 매도 행 과세 산출 (평균 과표 계산기) ──────────────────────────────────────
// 평균단가(=구매단가) 해석. ⚠️ 국내 주식 행의 포트폴리오 테이블 '구매단가'는 item.purchasePrice가
// 아니라 investAmount ÷ quantity 다(PortfolioTable 국내 분기). purchasePrice 필드는 해외 계좌와
// 붙여넣기 임포트에서만 기록되므로 국내 종목에서는 거의 항상 0 → 그대로 읽으면 단가 기준 과세가
// 통째로 '판정 불가'가 된다. 전량 매도·삭제된 종목(유령 행)은 둘 다 없으므로 계산기 매수 평균으로 폴백.
// 반올림하지 않는다 — 표 표시만 반올림이고 판정은 원본 정밀도로 한다.
// ⚠️ fallbackReliable=false면 events 폴백을 **쓰지 않는다**. 폴백값(계산기 매수 평균)은 매입단가가
//    비어 있는 매수 행을 통째로 제외한 '부분 평균'이라, 그대로 쓰면 실제보다 높거나 낮은 평균단가로
//    '비과세'를 확정해 버린다(조용한 오적용). 신뢰할 수 없으면 판정 불가로 흘려보내는 편이 낫다.
export function resolveAvgBuyPrice(stock, fallbackAvg, fallbackReliable = true) {
  const qty = safeNum(stock?.quantity);
  const inv = safeNum(stock?.investAmount);
  if (qty > 0 && inv > 0) return { value: inv / qty, source: 'portfolio' };
  const pp = safeNum(stock?.purchasePrice);
  if (pp > 0) return { value: pp, source: 'item' };
  const fb = safeNum(fallbackAvg);
  if (fb > 0) return fallbackReliable ? { value: fb, source: 'events' } : { value: 0, source: 'unreliable' };
  return { value: 0, source: 'none' };
}

// 매도 1건의 과세 3종(과표 기준 · 단가 기준 · 실제 과세)을 한 번에 산출한다.
//   과표 기준 = 과표기준가 − 평균 과표          (기존 '과세 금액' 열과 동일 규약)
//   단가 기준 = 매도단가   − 평균단가(구매단가)  (신규)
//   실제 과세 = 둘 다 > 0일 때만 과세, 금액은 1주당 min × 매도수량
// ⚠️ 0은 비과세다(`> 0`이 과세) — 기존 열의 `sellPerShareTax > 0` 규약과 갈리면 두 열이 모순된다.
// ⚠️ 한쪽만 준비돼도 그 값이 0 이하면 '비과세'를 확정한다(이미 확정된 사실을 '-'로 감추지 않는다).
//    반대로 '과세' 확정은 반드시 양쪽이 다 준비돼야 한다(조용한 오적용 금지).
// 세율 미적용 과세표준이다.
// ⚠️ 1주당 차이는 PER_SHARE_EPS로 0에 스냅한다 — 과표기준가는 소수 2자리가 실질 단위인데 가중평균
//    누적에서 IEEE754 잔차(1e-12 규모)가 남아, 수학적으로 0인 행이 `> 0`을 통과해 '과세 ₩0'으로
//    표시된다(표기는 0.00인데 판정은 과세라 사용자가 원인을 추적할 단서가 없다).
export const PER_SHARE_EPS = 1e-6;
const snapZero = (v) => (Math.abs(v) < PER_SHARE_EPS ? 0 : v);

export function computeSellTaxRow({ change, taxBasePrice, sellPrice, avgTaxBase, avgBuyPrice }) {
  const changeNum = safeNum(change);
  const isSell = changeNum < 0;
  const soldQty = isSell ? -changeNum : 0;
  const sell = safeNum(sellPrice);
  const exBase = safeNum(taxBasePrice);
  const avgTb = safeNum(avgTaxBase);
  const avgBuy = safeNum(avgBuyPrice);

  const sellAmount = isSell && sell > 0 ? soldQty * sell : null;

  const baseReady = isSell && exBase > 0 && avgTb > 0;
  const basePerShare = baseReady ? snapZero(exBase - avgTb) : 0;
  const baseAmount = basePerShare > 0 ? basePerShare * soldQty : 0;

  const priceReady = isSell && sell > 0 && avgBuy > 0;
  const pricePerShare = priceReady ? snapZero(sell - avgBuy) : 0;
  const priceAmount = pricePerShare > 0 ? pricePerShare * soldQty : 0;

  let taxable = null;      // true=과세 / false=비과세 / null=판정 불가(입력 부족)
  let exemptReason = null; // 'base' | 'price' | 'both'
  if (isSell) {
    const baseExempt = baseReady && basePerShare <= 0;
    const priceExempt = priceReady && pricePerShare <= 0;
    if (baseExempt || priceExempt) {
      taxable = false;
      exemptReason = baseExempt && priceExempt ? 'both' : baseExempt ? 'base' : 'price';
    } else if (baseReady && priceReady) {
      taxable = true;
    }
  }
  const actualPerShare = taxable ? Math.min(basePerShare, pricePerShare) : 0;
  const actualAmount = taxable ? actualPerShare * soldQty : 0;

  return {
    isSell, soldQty, sellAmount,
    baseReady, basePerShare, baseAmount,
    priceReady, pricePerShare, priceAmount,
    taxable, exemptReason, actualPerShare, actualAmount,
  };
}

// ── 매도 실현손익 (평균 과표 계산기) ────────────────────────────────────────
// "이 매도로 얼마를 벌었나" = 매도금액 − 매입원가 = (매도단가 − 기준단가) × 매도수량.
// 매수 행이 (현재가 × 수량 − 매입금액)으로 **미실현** 평가손익을 보여주는 것과 짝을 이루는 **실현**손익이다.
//
// ⚠️ 기준단가(basisPrice)는 '과세 금액(단가)'가 쓰는 avgBuy.value(= 포트폴리오의 **현재 시점**
//    구매단가)가 아니라 **매도 시점 러닝 평균 매입단가**여야 한다. 실현손익은 이미 확정된 과거
//    사실이라 나중 매수로 소급 변경되면 안 되기 때문이다. 그래서 별도 함수로 분리했다
//    (computeSellTaxRow는 과세 판정 전용 — 그쪽의 '현재 시점 값' 규약은 사용자 선택이라 유지).
//    되돌리면 재발하는 오류 2종:
//    ① 매도 후 추가매수(데이터 정상): 100주@8,000 매수 → 50주@9,000 매도 → 100주@12,000 매수.
//       참값 +50,000인데 현재 평균(10,666.67) 기준이면 −83,333으로 **부호가 뒤집힌다**.
//    ② 매도를 포트폴리오 표에 반영할 때 보유수량만 줄이고 투자금액을 그대로 두면 구매단가가
//       폭등해(예 8,000 → 21,621) 이익 매도가 −8,417,822 손실로 표시된다.
// ⚠️ 수익률 분모는 매도금액이 아니라 **매입원가** — 매수 행의 (손익 ÷ 매입금액)과 같은 규약이라야
//    한 표에 두 정의가 공존하지 않는다. 매도금액 분모는 전액 손실에서 −∞로 발산하기도 한다.
// ⚠️ null 계약 — 준비되지 않으면 0이 아니라 null이다. 0은 '정확히 본전'만 뜻한다.
//    (기준단가 0에 곱해 "매도금액 전액이 수익"이라고 단언하는 것이 최악의 오적용이다.)
// ⚠️ 1주당 차이는 computeSellTaxRow와 같은 PER_SHARE_EPS로 0에 스냅한다 — 스냅이 없으면
//    수학적으로 본전인 매도가 +6.3e-9 이익으로 잡혀 **이익 색(빨강)**으로 표시된다.
// ⚠️ 매도수량은 floor하지 않는다 — 같은 행의 '과세 금액(단가)'(0.5주 기준)와 값이 갈린다.
export function computeSellRealized({ change, sellPrice, basisPrice }) {
  const changeNum = safeNum(change);
  const isSell = changeNum < 0;
  const soldQty = isSell ? -changeNum : 0;
  const sell = safeNum(sellPrice);
  const basis = safeNum(basisPrice);

  const ready = isSell && sell > 0 && basis > 0;
  const amount = ready ? soldQty * sell : null;         // 매도금액
  const cost = ready ? basis * soldQty : null;          // 매입원가
  const perShare = ready ? snapZero(sell - basis) : null;
  const profit = ready ? perShare * soldQty : null;
  const rate = ready && cost > 0 ? (profit / cost) * 100 : null;

  return { isSell, soldQty, basis: ready ? basis : null, amount, cost, perShare, profit, rate };
}

// ── 매도 실현손익 기준단가 = '최저가 우선(LOFO)' 로트 매칭 ──────────────────
// 사용자 정의(2026-08): "최저점 매수가격과 매수수량으로 매도일에 대한 수익을 표시. 매수수량을
// 초과한 매도시에는 다음 최저 가격을 기준으로." → 매도수량을 **그 시점까지 남아 있는 매수분 중
// 가장 싼 로트부터** 차례로 소진시켜 원가를 구한다(lowest-cost-first-out).
// 예) 7/28 2,113주@7,778 + 7/29 761주@7,227 보유 상태에서 8/5 630주@8,260 매도
//     → 7,227 로트에서 630주 배정 → 기준단가 7,227 → +650,790(평균법 8,699.20 기준이면 −276,694).
//
// ⚠️ 이것은 **분석용 원가법**이다. 세법상 원가법(이동평균법)이 아니므로 과세 3열
//    (computeSellTaxRow)에는 절대 연결하지 말 것 — 그쪽은 종전대로 평균단가를 쓴다.
//    같은 행에서 실현손익 '이익' + 과세 '비과세'가 동시에 나오는 것이 정상이다.
// ⚠️ 로트 풀은 반드시 compareTaxEvents 순서로 **순차 소진**한다(같은 날짜는 매수 우선).
//    매도 시점 이후의 매수는 풀에 아직 없으므로, 나중 매수가 과거 실현손익을 소급 변경하지
//    못한다 — 러닝 평균 설계가 지키던 '확정된 과거 사실' 불변식을 그대로 유지한다.
// ⚠️ 같은 단가 로트는 **먼저 매수한 것부터**(seq) 배정한다. 원가 합은 같지만 배정 내역이
//    화면에 표시되므로 결정적이어야 한다(compareTaxEvents 타이브레이커와 같은 근거).
// ⚠️ 매입단가가 빈 매수 행은 로트를 만들지 못하므로 그 시점부터 풀 구성이 불완전해진다
//    → excludedSeen을 세워 이후 행을 trusted:false로 내리고 호출부가 폴백하게 한다
//    (resolveAvgBuyPrice의 fallbackReliable, buildSortedEventsWithAvg의 buyAvgTrusted와 같은 근거).
// ⚠️ 일자 없는 행은 **매수·매도 둘 다** 전 구간 신뢰 불가로 본다(`undatedTrade`, change !== 0).
//    매수만 검사하던 옛 가드는 **일자 없는 매도**를 놓쳐, 이미 팔린 최저가 로트가 풀에 그대로 남아
//    이후 매도의 기준단가를 낮추는데도 `trusted:true`로 확정했다(적대적 리뷰 실측: 100주@5,000 매수 →
//    무일자 100주 매도 → 100주@9,000 매수 → 100주 매도에서 참값 +50,000이 **+450,000**, 9배 과대.
//    게다가 셀 툴팁이 '2026-01-02 100주 × 5,000원'을 근거로 적극 단언한다).
//    무일자 행은 순서를 알 수 없어 어느 로트가 소진됐는지 정할 수 없다 — 폴백이 유일한 정답이다.
// ⚠️ 배정이 모자라면(매수 이력 부족) shortfallQty > 0으로 알리고 basis를 **단정하지 않는다** —
//    매칭된 몫의 원가를 전체 수량에 퍼뜨리면 없는 매수분을 0원 또는 싼값으로 단언하게 된다.
// ⚠️ 반환은 이벤트 **객체 식별자** 키 Map이다. 인덱스 조인은 호출부(buildSortedEventsWithAvg)가
//    날짜 없는 행을 뒤에 덧붙이는 순간 한 칸씩 밀린다(id는 중복·누락 가능).
export const LOT_QTY_EPS = 1e-9;

export function buildLofoLotSeries(events) {
  const valid = (events || [])
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')))
    .sort(compareTaxEvents);
  const undatedTrade = (events || []).some(e => safeNum(e.change) !== 0 && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')));
  const lots = [];
  let excludedSeen = undatedTrade;
  let seq = 0;
  const out = new Map();
  for (const evt of valid) {
    const change = safeNum(evt.change);
    if (change > 0) {
      const pp = safeNum(evt.purchasePrice);
      if (pp > 0) lots.push({ price: pp, qty: change, date: String(evt.date || ''), seq: seq++ });
      else excludedSeen = true;
      continue;
    }
    if (change === 0) continue;
    const order = lots
      .filter(l => l.qty > LOT_QTY_EPS)
      .sort((a, b) => (a.price - b.price) || (a.seq - b.seq));
    let rest = -change;
    const matched = [];
    for (const l of order) {
      if (rest <= LOT_QTY_EPS) break;
      const take = Math.min(l.qty, rest);
      l.qty -= take;
      rest -= take;
      matched.push({ date: l.date, price: l.price, qty: take });
    }
    const matchedQty = -change - rest;
    const cost = matched.reduce((s, m) => s + m.price * m.qty, 0);
    out.set(evt, {
      basis: matchedQty > LOT_QTY_EPS ? cost / matchedQty : 0,
      cost,
      lots: matched,
      matchedQty,
      shortfallQty: rest > LOT_QTY_EPS ? rest : 0,
      trusted: !excludedSeen,
    });
  }
  return out;
}

export function buildDividendEvents(portfolio, code) {
  if (!code) return [];
  const hist = portfolio?.dividendHistory?.[code] || {};
  const exMap = portfolio?.dividendExDate?.[code] || {};
  return Object.keys(hist)
    .map(ym => ({
      yearMonth: ym,
      exDate: exMap[ym] || `${ym}-01`,
      perShareGrossDividend: hist[ym] || 0,
    }))
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.exDate))
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
}

export function computeForEvent(portfolio, code, ev, taxRate) {
  const { purchases, sales, exTaxBase } = getCodeTaxBase(portfolio, code);
  const exPrice = safeNum(exTaxBase[ev.yearMonth]);
  if (!(exPrice > 0)) return null;
  const validPurchases = purchases
    .map(p => ({ ...p, shares: safeNum(p.shares), taxBasePrice: safeNum(p.taxBasePrice) }))
    .filter(p => p.shares > 0 && p.taxBasePrice > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
    .map(p => ({ id: p.id, date: p.date, shares: Math.floor(p.shares), taxBasePrice: p.taxBasePrice }));
  if (validPurchases.length === 0) return null;
  const validSales = sales
    .map(s => ({ ...s, shares: safeNum(s.shares) }))
    .filter(s => s.shares > 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.date))
    .map(s => ({ id: s.id, date: s.date, shares: Math.floor(s.shares) }));
  try {
    return calculateKrEtfDividendTax(
      validPurchases,
      { exDate: ev.exDate, exTaxBasePrice: exPrice, perShareGrossDividend: ev.perShareGrossDividend },
      { taxRate: taxRate / 100, sales: validSales },
    );
  } catch (e) {
    return { error: e.message };
  }
}

export function computeCodeMonthTax(portfolio, code, yearMonth, taxRate) {
  const exMap = portfolio?.dividendExDate?.[code] || {};
  const hist = portfolio?.dividendHistory?.[code] || {};
  const exDate = exMap[yearMonth];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(exDate || ''))) return null;
  const ev = {
    yearMonth,
    exDate,
    perShareGrossDividend: hist[yearMonth] || 0,
  };
  return computeForEvent(portfolio, code, ev, taxRate);
}
