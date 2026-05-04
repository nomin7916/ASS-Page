// @ts-nocheck
import { useMemo } from 'react';
import { cleanNum } from '../utils';

export function usePortfolioData({
  portfolio,
  activePortfolioAccountType,
  marketIndicators,
  principal,
  avgExchangeRate,
  portfolioStartDate,
  settings,
  depositHistory,
  depositHistory2,
  portfolios,
  activePortfolioId,
  history,
  historyLimit,
  rebalanceSortConfig,
  depositSortConfig,
  depositSortConfig2,
}) {
  const totals = useMemo(() => {
    const fxRate = activePortfolioAccountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
    let tInv = 0, tEvl = 0, tPrf = 0, cats = {}, stks = [];
    const calc = portfolio.map(item => {
      let inv = 0, evl = 0;
      if (item.type === 'deposit') { inv = evl = cleanNum(item.depositAmount) * fxRate; }
      else if (item.type === 'fund') {
        inv = cleanNum(item.investAmount) * fxRate;
        const qty = cleanNum(item.quantity);
        const price = cleanNum(item.currentPrice);
        evl = qty > 0 && price > 0 ? qty * price * fxRate : cleanNum(item.evalAmount) * fxRate;
      }
      else { const _qty = cleanNum(item.quantity); inv = (activePortfolioAccountType === 'overseas' || activePortfolioAccountType === 'gold') ? cleanNum(item.purchasePrice) * _qty * fxRate : (cleanNum(item.investAmount) || cleanNum(item.purchasePrice) * _qty); evl = cleanNum(item.currentPrice) * _qty * fxRate; }
      const prf = evl - inv; tInv += inv; tEvl += evl; tPrf += prf;
      const c = item.type === 'deposit' ? '예수금' : (item.category || '미지정');
      if (!cats[c]) cats[c] = { invest: 0, eval: 0, profit: 0 };
      cats[c].invest += inv; cats[c].eval += evl; cats[c].profit += prf;
      if (item.type === 'stock') stks.push({ name: item.name, eval: evl });
      return { ...item, investAmount: inv, evalAmount: evl, profit: prf };
    }).map(item => ({
      ...item,
      investRatio: tInv > 0 ? (item.investAmount / tInv) * 100 : 0,
      evalRatio: tEvl > 0 ? (item.evalAmount / tEvl) * 100 : 0,
      returnRate: item.investAmount > 0 ? (item.profit / item.investAmount) * 100 : 0
    }));
    return { calcPortfolio: calc, totalInvest: tInv, totalEval: tEvl, totalProfit: tPrf, cats, stks };
  }, [portfolio, activePortfolioAccountType, marketIndicators.usdkrw]);

  const cagr = useMemo(() => {
    const effectiveFx = activePortfolioAccountType === 'overseas'
      ? (avgExchangeRate || marketIndicators.usdkrw || 1)
      : 1;
    const principalKRW = activePortfolioAccountType === 'overseas'
      ? principal * effectiveFx
      : principal;
    if (!portfolioStartDate || principalKRW <= 0 || totals.totalEval <= 0) return 0;
    const days = (new Date() - new Date(portfolioStartDate)) / (1000 * 60 * 60 * 24);
    if (days <= 0) return 0;
    if (days < 365) return (totals.totalEval / principalKRW - 1) * 100;
    return (Math.pow(totals.totalEval / principalKRW, 1 / (days / 365.25)) - 1) * 100;
  }, [portfolioStartDate, principal, avgExchangeRate, totals.totalEval, activePortfolioAccountType, marketIndicators.usdkrw]);

  const sortedHistoryDesc = useMemo(() => [...history].sort((a, b) => new Date(b.date) - new Date(a.date)), [history]);

  const rebalanceData = useMemo(() => {
    const rebalFxRate = activePortfolioAccountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
    const depositAmount = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
    const nativeTotalEval = rebalFxRate > 1 ? totals.totalEval / rebalFxRate : totals.totalEval;
    const overallExp = nativeTotalEval + cleanNum(settings.amount);
    const accumulateBase = cleanNum(settings.amount) + depositAmount;
    let data = portfolio.filter(p => p.type === 'stock' || p.type === 'fund').map(item => {
      const tRatio = cleanNum(item.targetRatio) / 100;
      const qty = cleanNum(item.quantity);
      const price = cleanNum(item.currentPrice);
      const curEval = item.type === 'fund' && !(qty > 0 && price > 0)
        ? cleanNum(item.evalAmount)
        : price * qty;
      let action = price > 0 ? (settings.mode === 'rebalance' ? Math.trunc(((overallExp * tRatio) - curEval) / price) : Math.trunc((accumulateBase * tRatio) / price)) : 0;
      const expEval = (qty + action) * price;
      const cost = action * price;
      const expRatio = overallExp > 0 ? (expEval / overallExp * 100) : 0;
      return { ...item, curEval, action, cost, expEval, expRatio };
    });
    if (rebalanceSortConfig.key && rebalanceSortConfig.key !== 'category') {
      const catOrder = [];
      const grouped = {};
      data.forEach(item => {
        const cat = (item.category) || '기타';
        if (!grouped[cat]) { grouped[cat] = []; catOrder.push(cat); }
        grouped[cat].push(item);
      });
      Object.values(grouped).forEach(items => {
        items.sort((a, b) => {
          const vA = a[rebalanceSortConfig.key], vB = b[rebalanceSortConfig.key];
          if (typeof vA === 'string') return vA.localeCompare(vB) * rebalanceSortConfig.direction;
          return (vA - vB) * rebalanceSortConfig.direction;
        });
      });
      data = catOrder.flatMap(cat => grouped[cat]);
    } else if (rebalanceSortConfig.key === 'category') {
      data.sort((a, b) => {
        const catA = (a.category) || '기타', catB = (b.category) || '기타';
        return catA.localeCompare(catB) * rebalanceSortConfig.direction;
      });
    }
    return data;
  }, [portfolio, totals.totalEval, settings, rebalanceSortConfig, activePortfolioAccountType, marketIndicators.usdkrw]);

  const allPortfoliosForDividend = useMemo(() =>
    portfolios.map(p =>
      p.id === activePortfolioId ? { ...p, portfolio } : p
    ),
    [portfolios, activePortfolioId, portfolio]
  );

  const rebalCatDonutData = useMemo(() => {
    const ORDER = ['주식', '주식-a', '채권', '금', '배당주식', '리츠', '현금', '예수금', 'FUND'];
    const catMap = {};
    rebalanceData.forEach(item => {
      const cat = (item.category) || '기타';
      if (!catMap[cat]) catMap[cat] = { value: 0, ratio: 0 };
      catMap[cat].value += item.expEval;
      catMap[cat].ratio += item.expRatio;
    });
    return Object.entries(catMap)
      .map(([name, { value, ratio }]) => ({ name, value, ratio }))
      .filter(x => x.value > 0 && x.ratio >= 0.05)
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.value - a.value;
      });
  }, [rebalanceData]);

  const curCatDonutData = useMemo(() => {
    const ORDER = ['주식', '주식-a', '채권', '금', '배당주식', '리츠', '현금', '예수금', 'FUND'];
    return Object.entries(totals.cats)
      .map(([name, val]) => ({ name, value: val.eval }))
      .filter(x => x.value > 0)
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.value - a.value;
      });
  }, [totals.cats]);

  const displayHistSliced = useMemo(() => sortedHistoryDesc.slice(0, historyLimit), [sortedHistoryDesc, historyLimit]);

  const depositWithSum = useMemo(() => {
    let runSum = 0;
    return [...depositHistory].reverse().map((h, i) => {
      runSum += cleanNum(h.amount);
      return { ...h, cumulative: runSum, originalIndex: depositHistory.length - 1 - i };
    }).reverse();
  }, [depositHistory]);

  const depositWithSum2 = useMemo(() => {
    let runSum = 0;
    return [...depositHistory2].reverse().map((h, i) => {
      runSum += cleanNum(h.amount);
      return { ...h, cumulative: runSum, originalIndex: depositHistory2.length - 1 - i };
    }).reverse();
  }, [depositHistory2]);

  const depositWithSumSorted = useMemo(() => {
    if (!depositSortConfig.key) return depositWithSum;
    return [...depositWithSum].sort((a, b) => {
      if (depositSortConfig.key === 'date') { const da = a.date ? new Date(a.date).getTime() : 0; const db = b.date ? new Date(b.date).getTime() : 0; return (da - db) * depositSortConfig.direction; }
      if (depositSortConfig.key === 'amount') { return (cleanNum(a.amount) - cleanNum(b.amount)) * depositSortConfig.direction; }
      return 0;
    });
  }, [depositWithSum, depositSortConfig]);

  const depositWithSum2Sorted = useMemo(() => {
    if (!depositSortConfig2.key) return depositWithSum2;
    return [...depositWithSum2].sort((a, b) => {
      if (depositSortConfig2.key === 'date') { const da = a.date ? new Date(a.date).getTime() : 0; const db = b.date ? new Date(b.date).getTime() : 0; return (da - db) * depositSortConfig2.direction; }
      if (depositSortConfig2.key === 'amount') { return (cleanNum(a.amount) - cleanNum(b.amount)) * depositSortConfig2.direction; }
      return 0;
    });
  }, [depositWithSum2, depositSortConfig2]);

  return {
    totals,
    cagr,
    sortedHistoryDesc,
    rebalanceData,
    allPortfoliosForDividend,
    rebalCatDonutData,
    curCatDonutData,
    displayHistSliced,
    depositWithSum,
    depositWithSum2,
    depositWithSumSorted,
    depositWithSum2Sorted,
  };
}
