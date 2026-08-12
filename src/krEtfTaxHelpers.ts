// @ts-nocheck
import { calculateKrEtfDividendTax } from './utils';

export const isKrCode = (code) => /^[A-Z0-9]{5,6}$/i.test(String(code || ''));

export function safeNum(v) {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
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
    .sort((a, b) => a.date.localeCompare(b.date));
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
    .sort((a, b) => a.date.localeCompare(b.date));
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
