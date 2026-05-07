// @ts-nocheck
import { useRef, useEffect } from 'react';
import { calcPortfolioEvalForDate, isWeekend } from '../utils';

export const useHistoryBackfill = ({
  stockHistoryMap,
  indicatorHistoryMap,
  marketIndicators,
  portfolioSummaries,
  portfolios,
  setPortfolios,
  activePortfolioId,
  activePortfolioAccountType,
  portfolio,
  principal,
  history,
  setHistory,
  portfolioStartDate,
  notify,
}) => {
  const nonActiveHistRecordedRef = useRef({});
  const backfillDoneRef = useRef({});

  // 비활성 계좌 오늘 평가액 자동 기록
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    let needsUpdate = false;
    portfolioSummaries.forEach(s => {
      if (s.id === activePortfolioId || s.currentEval === 0) return;
      const key = `${s.id}_${today}`;
      if (nonActiveHistRecordedRef.current[key] !== s.currentEval) needsUpdate = true;
    });
    if (!needsUpdate) return;
    setPortfolios(prev => prev.map(p => {
      if (p.id === activePortfolioId) return p;
      const summary = portfolioSummaries.find(s => s.id === p.id);
      if (!summary || summary.currentEval === 0) return p;
      const key = `${p.id}_${today}`;
      if (nonActiveHistRecordedRef.current[key] === summary.currentEval) return p;
      nonActiveHistRecordedRef.current[key] = summary.currentEval;
      const hist = p.history || [];
      const idx = hist.findIndex(h => h.date === today);
      if (idx >= 0) {
        if (hist[idx].evalAmount === summary.currentEval) return p;
        // 직전 기록 대비 3배 이상 차이면 이상값으로 간주하고 건너뜀
        const prevRef = hist[idx].adjustedAmount || hist[idx].evalAmount;
        if (prevRef > 0 && (summary.currentEval > prevRef * 3 || summary.currentEval < prevRef / 3)) return p;
        const newHist = [...hist];
        newHist[idx] = { ...newHist[idx], evalAmount: summary.currentEval, adjustedAmount: summary.currentEval, actualEvalAmount: summary.currentEval, principal: summary.principal };
        return { ...p, history: newHist };
      }
      return { ...p, history: [...hist, { date: today, evalAmount: summary.currentEval, principal: summary.principal, isFixed: false }] };
    }));
  }, [portfolioSummaries, activePortfolioId]);

  // 자동 히스토리 백필: 날짜 gap 채우기 + 전날 종가 교정
  useEffect(() => {
    if (Object.keys(stockHistoryMap).length === 0) return;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();

    const hasHistData = Object.values(stockHistoryMap).some(m => Object.keys(m).some(d => d < today));
    const hasGoldHistData = Object.keys(indicatorHistoryMap.goldKr || {}).some(d => d < today);
    if (!hasHistData && !hasGoldHistData) return;

    const calcEval = (items, accountType, date) =>
      calcPortfolioEvalForDate(items, accountType, date, stockHistoryMap, indicatorHistoryMap, marketIndicators.usdkrw);

    const computeUpdates = (portfolioId, items, accountType, prin, hist, startDate) => {
      if (accountType === 'simple' || !items.length) return null;
      const isGold = accountType === 'gold';
      const sortedDates = hist.map(h => h.date).sort();
      const baseDate = startDate || sortedDates[0] || null;
      if (!baseDate) return null;

      const availDates = new Set();
      if (isGold) {
        Object.keys(indicatorHistoryMap.goldKr || {}).forEach(d => { if (d >= baseDate && d < today) availDates.add(d); });
      } else {
        items.forEach(item => {
          if ((item.type === 'stock' || item.type === 'fund') && item.code && stockHistoryMap[item.code]) {
            Object.keys(stockHistoryMap[item.code]).forEach(d => { if (d >= baseDate && d < today) availDates.add(d); });
          }
        });
      }

      const updates = [];
      const existingDates = new Set(hist.map(h => h.date));

      [...availDates].sort().forEach(date => {
        if (existingDates.has(date)) return;
        const key = `${portfolioId}_fill_${date}`;
        if (backfillDoneRef.current[key]) return;
        const evalAmt = calcEval(items, accountType, date);
        if (evalAmt > 0) { backfillDoneRef.current[key] = true; updates.push({ date, evalAmt }); }
      });

      // 기존 기록 사이의 주말/연휴 gap 채우기 (2~5일 gap = 주말 or 공휴일)
      const sortedHist = [...hist].sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 0; i < sortedHist.length - 1; i++) {
        const from = sortedHist[i];
        const to = sortedHist[i + 1];
        const gapMs = new Date(to.date + 'T12:00:00') - new Date(from.date + 'T12:00:00');
        const gapDays = Math.round(gapMs / 86400000);
        if (gapDays < 2 || gapDays > 5) continue;
        const d = new Date(from.date + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        while (d.toISOString().split('T')[0] < to.date) {
          const ds = d.toISOString().split('T')[0];
          if (!existingDates.has(ds) && !availDates.has(ds) && (isWeekend(ds) || gapDays <= 3)) {
            const key = `${portfolioId}_gap_${ds}`;
            if (!backfillDoneRef.current[key]) {
              backfillDoneRef.current[key] = true;
              updates.push({ date: ds, evalAmt: from.evalAmount });
              existingDates.add(ds);
            }
          }
          d.setDate(d.getDate() + 1);
        }
      }


      return updates.length > 0 ? { updates, prin } : null;
    };

    const applyUpdates = (hist, updates, prin) => {
      const newHist = [...hist];
      updates.forEach(({ date, evalAmt }) => {
        const idx = newHist.findIndex(h => h.date === date);
        if (idx >= 0) {
          if (!newHist[idx].isFixed) newHist[idx] = { ...newHist[idx], evalAmount: evalAmt, principal: prin };
        } else {
          newHist.push({ date, evalAmount: evalAmt, principal: prin, isFixed: false });
        }
      });
      return newHist;
    };

    const activeRes = computeUpdates(activePortfolioId, portfolio, activePortfolioAccountType, principal, history, portfolioStartDate);
    if (activeRes) setHistory(prev => applyUpdates(prev, activeRes.updates, activeRes.prin));

    let portfoliosChanged = false;
    const nextPortfolios = portfolios.map(p => {
      if (p.id === activePortfolioId) return p;
      const res = computeUpdates(p.id, p.portfolio || [], p.accountType, p.principal || 0, p.history || [], p.startDate || p.portfolioStartDate || '');
      if (!res) return p;
      portfoliosChanged = true;
      return { ...p, history: applyUpdates(p.history || [], res.updates, res.prin) };
    });
    if (portfoliosChanged) setPortfolios(nextPortfolios);
  }, [stockHistoryMap, indicatorHistoryMap]);

  // 수동 백필: 지정 날짜부터 어제까지 모든 계좌의 누락 평가액 채우기
  const handleManualBackfill = (fromDate) => {
    if (!fromDate) return;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();
    if (fromDate >= today) { notify('시작일은 오늘 이전이어야 합니다.', 'warning'); return; }

    const calcEval = (items, accountType, date) =>
      calcPortfolioEvalForDate(items, accountType, date, stockHistoryMap, indicatorHistoryMap, marketIndicators.usdkrw);

    const fillMissing = (items, accountType, prin, hist) => {
      if (accountType === 'simple' || !items.length) return null;
      const isGold = accountType === 'gold';
      const existingDates = new Set(hist.map(h => h.date));
      const availDates = new Set();
      if (isGold) {
        Object.keys(indicatorHistoryMap.goldKr || {}).forEach(d => { if (d >= fromDate && d <= yesterday) availDates.add(d); });
      } else {
        items.forEach(item => {
          if ((item.type === 'stock' || item.type === 'fund') && item.code && stockHistoryMap[item.code]) {
            Object.keys(stockHistoryMap[item.code]).forEach(d => { if (d >= fromDate && d <= yesterday) availDates.add(d); });
          }
        });
      }
      const newRecords = [];
      [...availDates].sort().forEach(date => {
        if (existingDates.has(date)) return;
        const evalAmt = calcEval(items, accountType, date);
        if (evalAmt > 0) newRecords.push({ date, evalAmount: evalAmt, principal: prin, isFixed: false });
      });
      return newRecords.length > 0 ? newRecords : null;
    };

    let totalAdded = 0;
    const activeRecords = fillMissing(portfolio, activePortfolioAccountType, principal, history);
    if (activeRecords) {
      totalAdded += activeRecords.length;
      setHistory(prev => [...prev, ...activeRecords]);
    }

    let portfoliosChanged = false;
    const nextPortfolios = portfolios.map(p => {
      if (p.id === activePortfolioId) return p;
      const records = fillMissing(p.portfolio || [], p.accountType, p.principal || 0, p.history || []);
      if (!records) return p;
      totalAdded += records.length;
      portfoliosChanged = true;
      return { ...p, history: [...(p.history || []), ...records] };
    });
    if (portfoliosChanged) setPortfolios(nextPortfolios);

    if (totalAdded > 0) notify(`${totalAdded}건의 누락 기록을 채웠습니다.`, 'success');
    else notify('채울 누락 기록이 없습니다.', 'info');
  };

  return { handleManualBackfill };
};
