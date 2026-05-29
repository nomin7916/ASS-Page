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
    dailyTaxFp: rec.dailyTaxFp || {},
  };
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
