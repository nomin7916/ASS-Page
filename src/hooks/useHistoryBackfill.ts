// @ts-nocheck
import { useRef, useEffect } from 'react';
import { calcPortfolioEvalForDate, generateId, isWeekend } from '../utils';

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
  showToast,
  setIntHistory,
}) => {
  const nonActiveHistRecordedRef = useRef({});
  const backfillDoneRef = useRef({});
  const intSyncDoneRef = useRef(false);

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
        const newHist = [...hist];
        newHist[idx] = { ...newHist[idx], evalAmount: summary.currentEval, principal: summary.principal };
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

      const yRec = hist.find(h => h.date === yesterday && !h.isFixed);
      if (yRec) {
        const key = `${portfolioId}_correct_${yesterday}`;
        if (!backfillDoneRef.current[key]) {
          backfillDoneRef.current[key] = true;
          const evalAmt = calcEval(items, accountType, yesterday);
          if (evalAmt > 0 && Math.abs(evalAmt - yRec.evalAmount) > 1) updates.push({ date: yesterday, evalAmt });
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

    // 새로 백필된 날짜를 intHistory에도 반영 (개별 계좌 합산)
    if (setIntHistory && (activeRes || portfoliosChanged)) {
      const newDates = new Set();
      if (activeRes) activeRes.updates.forEach(u => newDates.add(u.date));
      portfolios.forEach(p => {
        if (p.id === activePortfolioId) return;
        const nextP = nextPortfolios.find(np => np.id === p.id);
        if (!nextP || nextP === p) return;
        const origDates = new Set((p.history || []).map(h => h.date));
        (nextP.history || []).forEach(h => { if (!origDates.has(h.date)) newDates.add(h.date); });
      });
      if (newDates.size > 0) {
        const activeFullHist = activeRes ? applyUpdates(history, activeRes.updates, activeRes.prin) : history;
        const intRecords = [];
        [...newDates].sort().forEach(date => {
          let total = 0;
          const ar = activeFullHist.find(h => h.date === date);
          if (ar) total += ar.evalAmount;
          nextPortfolios.forEach(p => {
            if (p.id === activePortfolioId) return;
            const r = (p.history || []).find(h => h.date === date);
            if (r) total += r.evalAmount;
          });
          if (total > 0) intRecords.push({ id: generateId(), date, evalAmount: total });
        });
        if (intRecords.length > 0) {
          setIntHistory(prev => {
            const existingDates = new Set(prev.map(h => h.date));
            const additions = intRecords.filter(r => !existingDates.has(r.date));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
        }
      }
    }
  }, [stockHistoryMap, indicatorHistoryMap]);

  // 초기 1회: 개별 계좌 history에 있지만 intHistory에 누락된 날짜 보완
  useEffect(() => {
    if (intSyncDoneRef.current || !setIntHistory) return;
    const hasData = history.length > 0 || portfolios.some(p => (p.history || []).length > 0);
    if (!hasData) return;
    intSyncDoneRef.current = true;
    const dateToTotal = new Map();
    portfolios.forEach(p => {
      const hist = p.id === activePortfolioId ? history : (p.history || []);
      hist.forEach(h => {
        if (h.evalAmount > 0) dateToTotal.set(h.date, (dateToTotal.get(h.date) || 0) + h.evalAmount);
      });
    });
    setIntHistory(prev => {
      const existingDates = new Set(prev.map(h => h.date));
      const additions = [...dateToTotal.entries()]
        .filter(([date]) => !existingDates.has(date))
        .map(([date, total]) => ({ id: generateId(), date, evalAmount: total }));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, [portfolios, history]);

  // 수동 백필: 지정 날짜부터 어제까지 모든 계좌의 누락 평가액 채우기
  const handleManualBackfill = (fromDate) => {
    if (!fromDate) return;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();
    if (fromDate >= today) { showToast('시작일은 오늘 이전이어야 합니다.'); return; }

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

    // 백필된 날짜들을 intHistory에도 반영 (전체 계좌 합산)
    if (setIntHistory && totalAdded > 0) {
      const backfilledDates = new Set();
      if (activeRecords) activeRecords.forEach(r => backfilledDates.add(r.date));
      nextPortfolios.forEach(p => {
        if (p.id === activePortfolioId) return;
        const origP = portfolios.find(op => op.id === p.id);
        const origDates = new Set((origP?.history || []).map(h => h.date));
        (p.history || []).forEach(h => { if (!origDates.has(h.date)) backfilledDates.add(h.date); });
      });

      const newIntRecords = [];
      [...backfilledDates].sort().forEach(date => {
        let totalForDate = 0;
        const activeRec = activeRecords?.find(r => r.date === date);
        if (activeRec) {
          totalForDate += activeRec.evalAmount;
        } else {
          const existingRec = history.find(h => h.date === date);
          if (existingRec) totalForDate += existingRec.evalAmount;
        }
        nextPortfolios.forEach(p => {
          if (p.id === activePortfolioId) return;
          const rec = (p.history || []).find(h => h.date === date);
          if (rec) totalForDate += rec.evalAmount;
        });
        if (totalForDate > 0) newIntRecords.push({ id: generateId(), date, evalAmount: totalForDate });
      });

      if (newIntRecords.length > 0) {
        setIntHistory(prev => {
          const existingDates = new Set(prev.map(h => h.date));
          const additions = newIntRecords.filter(r => !existingDates.has(r.date));
          return additions.length > 0 ? [...prev, ...additions] : prev;
        });
      }
    }

    showToast(totalAdded > 0 ? `${totalAdded}건의 누락 기록을 채웠습니다.` : '채울 누락 기록이 없습니다.');
  };

  return { handleManualBackfill };
};
