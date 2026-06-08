// @ts-nocheck
import { useMemo } from 'react';
import { cleanNum, getClosestValue, calcPortfolioEvalDetail, resolveHoldings } from '../utils';
import { getEffectiveDate } from './useMarketCalendar';
import { CATEGORY_DISPLAY_ORDER } from '../constants';

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
  depositHistory,
  depositHistory2,
  intAppliedRange,
  intIsZeroBaseMode,
  effectiveDateKey,
  compStocks,
  stockHistoryMap,
  indicatorHistoryMap,
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
        return { id: p.id, name, startDate, currentEval: evalAmount, principal: prin, depositAmount: evalAmount, returnRate, cagr, cats: evalAmount > 0 ? { '예수금': evalAmount } : {}, isActive: false, accountType: 'simple', rowColor: p.rowColor || '', memo: p.memo || '' };
      }

      if (p.accountType === 'matong') {
        const wt = cleanNum(p.withdrawableTotal) || 0;
        const cw = cleanNum(p.currentWithdrawal) || 0;
        const wl = cleanNum(p.withdrawalLimit) || 0;
        const ar = parseFloat(p.agreedRate) || 0;
        const prin = Math.max(0, wt - (cw + wl));
        return {
          id: p.id, name, startDate, currentEval: prin, principal: prin,
          depositAmount: prin, returnRate: 0, cagr: 0,
          cats: prin > 0 ? { '현금': prin } : {},
          isActive: false, accountType: 'matong', rowColor: p.rowColor || '', memo: p.memo || '',
          withdrawableTotal: wt, currentWithdrawal: cw, withdrawalLimit: wl, agreedRate: ar, agreedRateStr: String(p.agreedRate ?? ''),
        };
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
    const today = effectiveDateKey || getEffectiveDate();

    // 현금성 계좌(마통·직접입력)는 시장 시세 이력이 없다 — 값은 사용자가 편집할 때만 바뀐다.
    // 일별 자동 스냅샷(useHistoryBackfill)이 그날의 잔액을 p.history에 기록하므로, 시장 계좌처럼
    // 스냅샷 carry-forward로 과거 잔액을 그대로 복원한다(현재값을 과거 날짜에 소급하지 않음).
    // '오늘'만 현재값을 권위로 사용해 최신 편집(비움=0 포함)을 즉시 반영한다.
    // (스냅샷에 0도 포함 → 비운 계좌가 carry-forward로 0이 이어져 유령 잔액이 남지 않음)
    const cashSeries = portfolios
      .filter(p => p.accountType === 'matong' || p.accountType === 'simple')
      .map(p => {
        const startDate = p.id === activePortfolioId ? portfolioStartDate : (p.portfolioStartDate || p.startDate || '');
        const currentEval = p.accountType === 'simple'
          ? (cleanNum(p.evalAmount) || 0)
          : Math.max(0, (cleanNum(p.withdrawableTotal) || 0) - ((cleanNum(p.currentWithdrawal) || 0) + (cleanNum(p.withdrawalLimit) || 0)));
        const map = new Map();
        (p.history || []).forEach(h => { if (h && h.date && typeof h.evalAmount === 'number' && h.evalAmount >= 0) map.set(h.date, h.evalAmount); });
        return { startDate, currentEval, dates: [...map.keys()].sort(), map };
      });

    // 시장 계좌별 (날짜 → 평가액) 시계열 구성. (현금성 계좌는 스냅샷 미사용 → 제외)
    // 같은 날짜에 기록이 둘 이상이면 마지막 값으로 정리 → 합산 시 이중 계상 방지.
    // 해외계좌는 저장된 evalAmount(기록 시점 라이브 환율로 박제)를 신뢰하지 않고, 날짜별 환율로 재계산한다.
    //  evalAmount = USD(해당일 보유종목 × 과거 종가) × 환율(getClosestValue(usdkrw) 이월, 없으면 라이브).
    //  종가 미로드 등으로 재계산 불가하면 저장값으로 폴백(초기 로딩·데이터 공백 보호).
    const liveFx = marketIndicators.usdkrw || 1;
    const accountSeries = portfolios
      .filter(p => p.accountType !== 'matong' && p.accountType !== 'simple')
      .map(p => {
        const isActive = p.id === activePortfolioId;
        const hist = isActive ? history : (p.history || []);
        const map = new Map();
        if (p.accountType === 'overseas') {
          const src = isActive ? { ...p, portfolio } : p;
          const mpo = p.manualPriceOverrides || {};
          hist.forEach(h => {
            if (!h || !h.date) return;
            const r = calcPortfolioEvalDetail(resolveHoldings(src, h.date).items, 'overseas', h.date, stockHistoryMap, indicatorHistoryMap || {}, liveFx, mpo);
            const v = r.hasAnyPrice ? r.total : (h.evalAmount > 0 ? h.evalAmount : 0);
            if (v > 0) map.set(h.date, v);
          });
        } else {
          hist.forEach(h => {
            if (h && h.date && h.evalAmount > 0) map.set(h.date, h.evalAmount);
          });
        }
        return { dates: [...map.keys()].sort(), map };
      }).filter(a => a.dates.length > 0);

    // 전체 날짜 합집합 (+ 오늘)
    const dateSet = new Set();
    accountSeries.forEach(a => a.dates.forEach(d => dateSet.add(d)));
    cashSeries.forEach(c => c.dates.forEach(d => dateSet.add(d)));
    if (intTotals.totalEval > 0) dateSet.add(today);
    const sortedDates = [...dateSet].sort();

    // 각 날짜에 대해 계좌별 직전 거래일 값(carry-forward)을 합산.
    // 주말·공휴일 등 일부 계좌만 기록된 날짜에도 모든 계좌의 평가액이 빠짐없이 반영된다.
    // (각 계좌 첫 기록 이전 날짜에는 lastVal=0 → 기여하지 않음)
    const dateToTotal = new Map();
    accountSeries.forEach(({ dates, map }) => {
      let i = 0, lastVal = 0;
      for (const d of sortedDates) {
        while (i < dates.length && dates[i] <= d) { lastVal = map.get(dates[i]); i++; }
        if (lastVal > 0) dateToTotal.set(d, (dateToTotal.get(d) || 0) + lastVal);
      }
    });

    // 현금성 계좌: 날짜별 잔액(스냅샷 carry-forward, 오늘은 현재값, 시작일 이전 0)을 합산.
    // 과거 그날의 기록값을 그대로 반영 → 현재값이 과거로 소급되지 않는다.
    const cashByDate = new Map();
    cashSeries.forEach(({ startDate, currentEval, dates, map }) => {
      let i = 0, lastVal = 0;
      for (const d of sortedDates) {
        while (i < dates.length && dates[i] <= d) { lastVal = map.get(dates[i]); i++; }
        let v = d === today ? currentEval : lastVal;
        if (startDate && d < startDate) v = 0;
        if (v > 0) cashByDate.set(d, (cashByDate.get(d) || 0) + v);
      }
    });
    cashByDate.forEach((v, d) => dateToTotal.set(d, (dateToTotal.get(d) || 0) + v));

    // 오늘 값은 실시간 합산 평가액으로 보정 (휴일에 가격 미로드로 폭락한 경우 직전값 유지)
    if (intTotals.totalEval > 0) {
      const prevDates = sortedDates.filter(d => d < today);
      const prevValue = prevDates.length > 0 ? (dateToTotal.get(prevDates[prevDates.length - 1]) || 0) : 0;
      const isAnomaly = prevValue > 0 && intTotals.totalEval < prevValue * 0.1;
      dateToTotal.set(today, isAnomaly ? prevValue : intTotals.totalEval);
    }
    // 시장 계좌만 원금 보정식 적용(현금성 계좌는 아래에서 날짜별 잔액 합산 → 수익 0 유지)
    const portfolioPrincipalData = portfolios
      .filter(p => p.accountType !== 'matong' && p.accountType !== 'simple')
      .map(p => {
        const isActive = p.id === activePortfolioId;
        const isOverseas = p.accountType === 'overseas';
        const startDate = isActive ? portfolioStartDate : (p.portfolioStartDate || p.startDate || '');
        const currentPrincipal = isActive ? principal : (p.principal || 0);
        const fxRate = isOverseas
          ? ((isActive ? avgExchangeRate : p.avgExchangeRate) || marketIndicators.usdkrw || 1)
          : 1;
        const currentPrincipalKRW = currentPrincipal * fxRate;
        const deps = isActive ? depositHistory : (p.depositHistory || []);
        const wds = isActive ? depositHistory2 : (p.depositHistory2 || []);
        return { startDate, currentPrincipalKRW, deps, wds, isOverseas };
      });
    return [...dateToTotal.entries()]
      .map(([date, evalAmount]) => {
        let effectivePrincipal = portfolioPrincipalData.reduce((sum, { startDate, currentPrincipalKRW, deps, wds, isOverseas }) => {
          if (!startDate || startDate > date) return sum;
          const depRate = (d) => isOverseas ? (d.fxRate || 1) : 1;
          const futureDeposits = deps.filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0) * depRate(d), 0);
          const futureWithdrawals = wds.filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0) * depRate(d), 0);
          return sum + Math.max(0, currentPrincipalKRW - futureDeposits + futureWithdrawals);
        }, 0);
        // 현금성 계좌: 원금=평가(날짜별 잔액) → 평가와 동일 합산 → 수익 0 유지
        effectivePrincipal += cashByDate.get(date) || 0;
        return { id: date, date, evalAmount, effectivePrincipal };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [portfolios, history, activePortfolioId, depositHistory, depositHistory2, intTotals.totalEval, portfolioStartDate, principal, avgExchangeRate, marketIndicators.usdkrw, effectiveDateKey, portfolio, stockHistoryMap, indicatorHistoryMap]);

  const intSortedHistory = useMemo(() =>
    [...computedIntHistory].sort((a, b) => new Date(a.date) - new Date(b.date)),
    [computedIntHistory]);

  const intUnifiedDates = useMemo(() =>
    Array.from(new Set(computedIntHistory.map(h => h.date))).sort(),
    [computedIntHistory]);

  const intFilteredDates = useMemo(() => {
    if (!intAppliedRange.start && !intAppliedRange.end) return intUnifiedDates;
    return intUnifiedDates.filter(d =>
      (!intAppliedRange.start || d >= intAppliedRange.start) &&
      (!intAppliedRange.end   || d <= intAppliedRange.end)
    );
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

    const comps = compStocks || [];
    const compBases = comps.map(comp => {
      if (!comp?.active || !comp?.code) return null;
      const series = stockHistoryMap?.[comp.code];
      if (!series) return null;
      for (let i = 0; i < filtered.length; i++) {
        const v = getClosestValue(series, filtered[i].date);
        if (v != null && v > 0) return v;
      }
      return null;
    });

    return filtered.map(h => {
      const row = {
        date: h.date,
        evalAmount: h.evalAmount,
        costAmount: h.effectivePrincipal,
        returnRate: intIsZeroBaseMode
          ? (baseEval > 0 ? ((h.evalAmount / baseEval) - 1) * 100 : 0)
          : (h.effectivePrincipal > 0 ? ((h.evalAmount - h.effectivePrincipal) / h.effectivePrincipal * 100) : 0),
      };
      comps.forEach((comp, ci) => {
        const key = `comp${ci + 1}Rate`;
        const base = compBases[ci];
        if (!comp?.active || !comp?.code || base == null) {
          row[key] = null;
          return;
        }
        const v = getClosestValue(stockHistoryMap?.[comp.code], h.date);
        row[key] = (v != null && v > 0) ? ((v / base) - 1) * 100 : null;
      });
      return row;
    });
  }, [intSortedHistory, intFilteredDates, intIsZeroBaseMode, compStocks, stockHistoryMap]);

  const intMonthlyHistory = useMemo(() => {
    const sortedDesc = [...computedIntHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    return sortedDesc.map((h, i) => {
      const ep = h.effectivePrincipal > 0 ? h.effectivePrincipal : intTotals.totalPrincipal;
      const monthlyChange = ep > 0 ? ((h.evalAmount - ep) / ep) * 100 : 0;
      const prevRecord = sortedDesc[i + 1];
      const dodChange = (prevRecord && prevRecord.evalAmount > 0)
        ? ((h.evalAmount / prevRecord.evalAmount) - 1) * 100 : 0;
      const dodAbsChange = prevRecord != null ? h.evalAmount - prevRecord.evalAmount : null;
      return { ...h, monthlyChange, dodChange, dodAbsChange };
    });
  }, [computedIntHistory, intTotals.totalPrincipal]);

  const intDepositEvents = useMemo(() => {
    const byDate = new Map();
    portfolios.forEach(p => {
      const isActive = p.id === activePortfolioId;
      const deps = isActive ? depositHistory : (p.depositHistory || []);
      const wds = isActive ? depositHistory2 : (p.depositHistory2 || []);
      deps.forEach(d => {
        if (!d.date) return;
        const prev = byDate.get(d.date) || { date: d.date, deposits: 0, withdrawals: 0 };
        prev.deposits += (d.amount || 0) * (d.fxRate || 1);
        byDate.set(d.date, prev);
      });
      wds.forEach(d => {
        if (!d.date) return;
        const prev = byDate.get(d.date) || { date: d.date, deposits: 0, withdrawals: 0 };
        prev.withdrawals += (d.amount || 0) * (d.fxRate || 1);
        byDate.set(d.date, prev);
      });
    });
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [portfolios, depositHistory, depositHistory2, activePortfolioId]);

  const intCatDonutData = useMemo(() => {
    return Object.entries(intTotals.cats)
      .map(([name, value]) => ({ name, value }))
      .filter(x => x.value > 0)
      .sort((a, b) => {
        const ia = CATEGORY_DISPLAY_ORDER.indexOf(a.name);
        const ib = CATEGORY_DISPLAY_ORDER.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.value - a.value;
      });
  }, [intTotals.cats]);

  const intHoldingsDonutData = useMemo(() => {
    const holdingsMap = {};
    portfolios.forEach(p => {
      const isActive = p.id === activePortfolioId;
      if (p.accountType === 'simple') {
        const evalAmount = cleanNum(p.evalAmount);
        if (evalAmount <= 0) return;
        const accountName = isActive ? title : p.name;
        const key = accountName || '일반계좌';
        if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category: '예수금', code: '' };
        holdingsMap[key].value += evalAmount;
        holdingsMap[key].cost += cleanNum(p.principal) || evalAmount;
        return;
      }
      if (p.accountType === 'matong') {
        const wt = cleanNum(p.withdrawableTotal) || 0;
        const cw = cleanNum(p.currentWithdrawal) || 0;
        const wl = cleanNum(p.withdrawalLimit) || 0;
        const prin = Math.max(0, wt - (cw + wl));
        if (prin <= 0) return;
        const accountName = isActive ? title : p.name;
        const key = accountName || '마통계좌';
        if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category: '예수금', code: '' };
        holdingsMap[key].value += prin;
        holdingsMap[key].cost += prin;
        return;
      }
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
    intDepositEvents,
  };
}
