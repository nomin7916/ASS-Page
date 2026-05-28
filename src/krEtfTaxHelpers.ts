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
    purchases: rec.purchases || [],
    sales: rec.sales || [],
    exTaxBase: rec.exTaxBase || {},
    avgTaxBase: rec.avgTaxBase || {},
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
