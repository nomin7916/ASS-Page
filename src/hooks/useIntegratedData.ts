// @ts-nocheck
import { useMemo } from 'react';
import { cleanNum } from '../utils';

export function useIntegratedData({
  portfolios,
  activePortfolioId,
  portfolio,
  principal,
  avgExchangeRate,
  portfolioStartDate,
  title,
  marketIndicators,
  history,
  intAppliedRange,
  intIsZeroBaseMode,
}) {
  const portfolioSummaries = useMemo(() => {
    return portfolios.map(p => {
      const isActive = p.id === activePortfolioId;
      const startDate = isActive ? portfolioStartDate : (p.portfolioStartDate || p.startDate || '');
      const name = isActive ? title : p.name;
      const days = startDate ? (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24) : 0;

      if (p.accountType === 'simple') {
        const evalAmount = cleanNum(p.evalAmount) || 0;
        const prin = cleanNum(p.principal) || 0;
        const returnRate = prin > 0 ? (evalAmount - prin) / prin * 100 : 0;
        const cagr = prin > 0 && evalAmount > 0 && days > 0
          ? days < 365 ? (evalAmount / prin - 1) * 100 : (Math.pow(evalAmount / prin, 365.25 / days) - 1) * 100
          : 0;
        return { id: p.id, name, startDate, currentEval: evalAmount, principal: prin, depositAmount: 0, returnRate, cagr, cats: {}, isActive: false, accountType: 'simple', rowColor: p.rowColor || '', memo: p.memo || '' };
      }

      const items = isActive ? portfolio : (p.portfolio || []);
      const prin = isActive ? principal : (p.principal || 0);
      const summaryFxRate = p.accountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
      const summaryAvgFx = p.accountType === 'overseas'
        ? ((isActive ? avgExchangeRate : (p.avgExchangeRate || 0)) || summaryFxRate)
        : 1;
      const principalKRW = prin * summaryAvgFx;
      let totalEval = 0, depositAmt = 0;
      const cats = {};
      items.forEach(item => {
        if (item.type === 'deposit') {
          const v = cleanNum(item.depositAmount) * summaryFxRate;
          totalEval += v; depositAmt += v;
          cats['예수금'] = (cats['예수금'] || 0) + v;
        } else if (item.type === 'fund') {
          const qty = cleanNum(item.quantity);
          const price = cleanNum(item.currentPrice);
          const evl = qty > 0 && price > 0 ? qty * price * summaryFxRate : cleanNum(item.evalAmount) * summaryFxRate;
          totalEval += evl;
          cats['FUND'] = (cats['FUND'] || 0) + evl;
        } else {
          const evl = cleanNum(item.currentPrice) * cleanNum(item.quantity) * summaryFxRate;
          totalEval += evl;
          const cat = item.category || '미지정';
          cats[cat] = (cats[cat] || 0) + evl;
        }
      });
      const returnRate = principalKRW > 0 ? (totalEval - principalKRW) / principalKRW * 100 : 0;
      const cagr = principalKRW > 0 && totalEval > 0 && days > 0
        ? days < 365
          ? (totalEval / principalKRW - 1) * 100
          : (Math.pow(totalEval / principalKRW, 365.25 / days) - 1) * 100
        : 0;
      return { id: p.id, name, startDate, currentEval: totalEval, principal: principalKRW, depositAmount: depositAmt, returnRate, cagr, cats, isActive, accountType: 'portfolio', rowColor: p.rowColor || '', memo: p.memo || '' };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios, activePortfolioId, portfolio, principal, avgExchangeRate, portfolioStartDate, title, marketIndicators.usdkrw]);

  const intTotals = useMemo(() => {
    let totalEval = 0, totalPrincipal = 0, totalDeposit = 0;
    const cats = {};
    portfolioSummaries.forEach(s => {
      totalEval += s.currentEval;
      totalPrincipal += s.principal;
      totalDeposit += s.depositAmount;
      Object.entries(s.cats).forEach(([cat, val]) => {
        cats[cat] = (cats[cat] || 0) + val;
      });
    });
    const returnRate = totalPrincipal > 0 ? (totalEval - totalPrincipal) / totalPrincipal * 100 : 0;
    return { totalEval, totalPrincipal, totalDeposit, cats, returnRate };
  }, [portfolioSummaries]);

  const computedIntHistory = useMemo(() => {
    const dateToTotal = new Map();
    const today = new Date().toISOString().split('T')[0];
    portfolios.forEach(p => {
      const hist = p.id === activePortfolioId ? history : (p.history || []);
      hist.forEach(h => {
        if (h.evalAmount > 0) dateToTotal.set(h.date, (dateToTotal.get(h.date) || 0) + h.evalAmount);
      });
    });
    if (intTotals.totalEval > 0) {
      const prevEntries = [...dateToTotal.entries()].filter(([d]) => d < today).sort((a, b) => b[0].localeCompare(a[0]));
      const prevValue = prevEntries.length > 0 ? prevEntries[0][1] : 0;
      const isAnomaly = prevValue > 0 && intTotals.totalEval < prevValue * 0.1;
      dateToTotal.set(today, isAnomaly ? prevValue : intTotals.totalEval);
    }
    return [...dateToTotal.entries()]
      .map(([date, evalAmount]) => {
        const effectivePrincipal = portfolioSummaries.reduce((sum, s) => {
          return sum + (s.startDate && s.startDate <= date ? s.principal : 0);
        }, 0);
        return { id: date, date, evalAmount, effectivePrincipal };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [portfolios, history, activePortfolioId, intTotals.totalEval, portfolioSummaries]);

  const intSortedHistory = useMemo(() =>
    [...computedIntHistory].sort((a, b) => new Date(a.date) - new Date(b.date)),
    [computedIntHistory]);

  const intUnifiedDates = useMemo(() =>
    Array.from(new Set(computedIntHistory.map(h => h.date))).sort(),
    [computedIntHistory]);

  const intFilteredDates = useMemo(() => {
    if (!intAppliedRange.start || !intAppliedRange.end) return intUnifiedDates;
    return intUnifiedDates.filter(d => d >= intAppliedRange.start && d <= intAppliedRange.end);
  }, [intUnifiedDates, intAppliedRange]);

  const intChartData = useMemo(() => {
    if (intSortedHistory.length === 0) return [];
    const all = intFilteredDates.length > 0
      ? intSortedHistory.filter(h => intFilteredDates.includes(h.date))
      : intSortedHistory;
    if (all.length === 0) return [];
    const filtered = intIsZeroBaseMode
      ? (() => { const valid = all.filter(h => h.effectivePrincipal > 0 && h.evalAmount >= h.effectivePrincipal * 0.7); return valid.length > 0 ? valid : all; })()
      : all;
    const baseEval = filtered[0].evalAmount;
    return filtered.map(h => ({
      date: h.date,
      evalAmount: h.evalAmount,
      costAmount: h.effectivePrincipal,
      returnRate: intIsZeroBaseMode
        ? (baseEval > 0 ? ((h.evalAmount / baseEval) - 1) * 100 : 0)
        : (h.effectivePrincipal > 0 ? ((h.evalAmount - h.effectivePrincipal) / h.effectivePrincipal * 100) : 0),
    }));
  }, [intSortedHistory, intFilteredDates, intIsZeroBaseMode]);

  const intMonthlyHistory = useMemo(() => {
    const sortedDesc = [...computedIntHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    return sortedDesc.map((h, i) => {
      const ep = h.effectivePrincipal > 0 ? h.effectivePrincipal : intTotals.totalPrincipal;
      const monthlyChange = ep > 0 ? ((h.evalAmount - ep) / ep) * 100 : 0;
      const prevRecord = sortedDesc[i + 1];
      const dodChange = (prevRecord && prevRecord.evalAmount > 0)
        ? ((h.evalAmount / prevRecord.evalAmount) - 1) * 100 : 0;
      return { ...h, monthlyChange, dodChange };
    });
  }, [computedIntHistory, intTotals.totalPrincipal]);

  const intCatDonutData = useMemo(() => {
    const ORDER = ['주식', '주식-a', '채권', '금', '배당주식', '리츠', '현금', '예수금', 'FUND'];
    return Object.entries(intTotals.cats)
      .map(([name, value]) => ({ name, value }))
      .filter(x => x.value > 0)
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.name);
        const ib = ORDER.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.value - a.value;
      });
  }, [intTotals.cats]);

  const intHoldingsDonutData = useMemo(() => {
    const holdingsMap = {};
    portfolios.forEach(p => {
      if (p.accountType === 'simple') return;
      const isActive = p.id === activePortfolioId;
      const items = isActive ? portfolio : (p.portfolio || []);
      const fxRate = p.accountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
      const isGold = p.accountType === 'gold';
      items.forEach(item => {
        if (item.type === 'deposit') {
          const v = cleanNum(item.depositAmount) * fxRate;
          if (v <= 0) return;
          const key = '예수금';
          if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category: '예수금', code: '' };
          holdingsMap[key].value += v;
          holdingsMap[key].cost += v;
        } else if (item.type === 'fund') {
          const qty = cleanNum(item.quantity);
          const price = cleanNum(item.currentPrice);
          const evl = qty > 0 && price > 0 ? qty * price * fxRate : cleanNum(item.evalAmount) * fxRate;
          if (evl <= 0) return;
          const cost = cleanNum(item.investAmount) * fxRate;
          const key = item.name || item.code || 'FUND';
          if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category: 'FUND', code: item.code || '' };
          holdingsMap[key].value += evl;
          holdingsMap[key].cost += cost;
        } else {
          const qty = cleanNum(item.quantity);
          const evl = cleanNum(item.currentPrice) * qty * fxRate;
          if (evl <= 0) return;
          const cost = (isGold || p.accountType === 'overseas') ? cleanNum(item.purchasePrice) * qty * fxRate : (cleanNum(item.investAmount) || cleanNum(item.purchasePrice) * qty);
          const key = isGold ? 'KRX 금현물' : (item.name || item.code || '기타');
          const category = isGold ? '금' : (item.category || '미지정');
          if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category, code: isGold ? '' : (item.code || '') };
          holdingsMap[key].value += evl;
          holdingsMap[key].cost += cost;
        }
      });
    });
    return Object.entries(holdingsMap)
      .map(([name, { value, cost, category, code }]) => ({ name, value, cost, category, code }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios, activePortfolioId, portfolio, marketIndicators.usdkrw]);

  return {
    portfolioSummaries,
    intTotals,
    computedIntHistory,
    intSortedHistory,
    intUnifiedDates,
    intFilteredDates,
    intChartData,
    intMonthlyHistory,
    intCatDonutData,
    intHoldingsDonutData,
  };
}
