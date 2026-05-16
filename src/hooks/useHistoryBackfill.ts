// @ts-nocheck
import { useRef, useEffect } from 'react';
import { calcPortfolioEvalForDate, isWeekend } from '../utils';
import { getEffectiveDate } from './useMarketCalendar';

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
  effectiveDateKey,
}) => {
  const nonActiveHistRecordedRef = useRef({});
  const backfillDoneRef = useRef({});

  // 비활성 계좌 오늘 평가액 자동 기록
  useEffect(() => {
    const today = getEffectiveDate();
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
      if (idx >= 0) return p;
      return { ...p, history: [...hist, { date: today, evalAmount: summary.currentEval, principal: summary.principal, isFixed: false }] };
    }));
  }, [portfolioSummaries, activePortfolioId, effectiveDateKey]);

  // 자동 히스토리 백필: 모든 누락 날짜 채우기
  useEffect(() => {
    if (Object.keys(stockHistoryMap).length === 0) return;
    const effectiveDate = getEffectiveDate();

    const hasHistData = Object.values(stockHistoryMap).some(m => Object.keys(m).some(d => d < effectiveDate));
    const hasGoldHistData = Object.keys(indicatorHistoryMap.goldKr || {}).some(d => d < effectiveDate);
    if (!hasHistData && !hasGoldHistData) return;

    const calcEval = (items, accountType, date) =>
      calcPortfolioEvalForDate(items, accountType, date, stockHistoryMap, indicatorHistoryMap, marketIndicators.usdkrw);

    const computeUpdates = (portfolioId, items, accountType, prin, hist, startDate) => {
      if (accountType === 'simple' || !items.length) return null;
      const isGold = accountType === 'gold';
      const sortedDates = hist.map(h => h.date).sort();
      const baseDate = startDate || sortedDates[0] || null;
      if (!baseDate) return null;

      // stockHistoryMap에 있는 과거 날짜 수집 (effectiveDate 미만)
      const availDates = new Set();
      if (isGold) {
        Object.keys(indicatorHistoryMap.goldKr || {}).forEach(d => { if (d >= baseDate && d < effectiveDate) availDates.add(d); });
      } else {
        items.forEach(item => {
          if ((item.type === 'stock' || item.type === 'fund') && item.code && stockHistoryMap[item.code]) {
            Object.keys(stockHistoryMap[item.code]).forEach(d => { if (d >= baseDate && d < effectiveDate) availDates.add(d); });
          }
        });
      }

      const updates = [];
      const existingMap = new Map(hist.map(h => [h.date, h]));

      // 항목 유형 판별 헬퍼:
      // - 실시간 기록: isFixed: false + evalAmount > 0 → 절대 덮어쓰기 금지
      // - 사용자 확정/실시간 확정: isFixed: true + adjustedAmount 있음 → 덮어쓰기 금지
      // - 순수 백필: isFixed: true + adjustedAmount 없음 → 펀드 데이터 포함 재계산 허용
      // - 없는 날짜: 신규 추가
      [...availDates].sort().forEach(date => {
        const existing = existingMap.get(date);
        if (!existing?.isFixed && existing?.evalAmount > 0) return; // 실시간 기록 보호
        if (existing?.isFixed && existing?.adjustedAmount !== undefined) return; // 확정 항목 보호

        const isPureBackfill = !!(existing?.isFixed && existing?.adjustedAmount === undefined);
        const key = `${portfolioId}_fill_${date}`;

        // 새 항목(없는 날짜): backfillDoneRef로 동일 세션 중복 방지
        // 순수 백필 항목: backfillDoneRef 무시 → 펀드 데이터 로드 후 재계산 허용
        if (!isPureBackfill && backfillDoneRef.current[key]) return;

        const evalAmt = calcEval(items, accountType, date);
        if (evalAmt > 0) {
          if (!isPureBackfill) backfillDoneRef.current[key] = true;
          updates.push({ date, evalAmt, isFixed: true });
        }
      });

      // 주말·공휴일 gap 채우기: 거래일 데이터가 없는 날짜를 직전 거래일 값으로 이월
      // 범위: baseDate ~ effectiveDate 사이 전체 날짜 순회
      const sortedAvail = [...availDates].sort();
      if (sortedAvail.length > 0) {
        const rangeStart = sortedAvail[0];
        const rangeEnd = effectiveDate;
        const d = new Date(rangeStart + 'T12:00:00');
        let lastVal = 0;

        // rangeStart의 값 초기화 — 새로 계산된 값 우선, 없으면 기존 값
        const startFilled = updates.find(u => u.date === rangeStart);
        const startExisting = existingMap.get(rangeStart);
        if (startFilled?.evalAmt > 0) lastVal = startFilled.evalAmt;
        else if (startExisting?.evalAmount > 0) lastVal = startExisting.evalAmount;

        d.setDate(d.getDate() + 1);
        while (true) {
          const ds = d.toISOString().split('T')[0];
          if (ds >= rangeEnd) break;
          if (!availDates.has(ds)) {
            // 거래일 데이터 없음 (주말/공휴일) → 직전 값 이월
            const existing = existingMap.get(ds);
            const isPureBackfillEntry = !!(existing?.isFixed && existing?.adjustedAmount === undefined);
            // 없는 날짜 또는 순수 백필 항목만 업데이트 (실시간/확정 항목 보호)
            const isProtectedEntry = existing && (
              (!existing.isFixed && existing.evalAmount > 0) ||
              (existing.isFixed && existing.adjustedAmount !== undefined)
            );
            if (!isProtectedEntry) {
              const key = `${portfolioId}_gap_${ds}`;
              if (!backfillDoneRef.current[key] && lastVal > 0) {
                if (!isPureBackfillEntry) backfillDoneRef.current[key] = true;
                updates.push({ date: ds, evalAmt: lastVal, isFixed: true });
              }
            }
          } else {
            // 거래일: lastVal 갱신 — 새로 계산된 값(펀드 포함) 우선
            const filled = updates.find(u => u.date === ds);
            const ex = existingMap.get(ds);
            const v = filled?.evalAmt || ex?.evalAmount || 0;
            if (v > 0) lastVal = v;
          }
          d.setDate(d.getDate() + 1);
        }
      }

      return updates.length > 0 ? { updates, prin } : null;
    };

    const applyUpdates = (hist, updates, prin) => {
      if (!updates.length) return hist;
      const newHist = [...hist];
      let changed = false;
      updates.forEach(({ date, evalAmt, isFixed }) => {
        const idx = newHist.findIndex(h => h.date === date);
        if (idx >= 0) {
          const entry = newHist[idx];
          // 보호 조건: 실시간 기록(isFixed: false + evalAmount > 0) 또는 사용자 확정(isFixed: true + adjustedAmount 있음)
          const isProtected = (!entry.isFixed && (entry.evalAmount ?? 0) > 0) ||
                              (entry.isFixed && entry.adjustedAmount !== undefined);
          if (!isProtected && Math.round(entry.evalAmount ?? 0) !== Math.round(evalAmt)) {
            newHist[idx] = { ...entry, evalAmount: evalAmt, principal: prin, isFixed };
            changed = true;
          }
        } else {
          newHist.push({ date, evalAmount: evalAmt, principal: prin, isFixed });
          changed = true;
        }
      });
      return changed ? newHist : hist;
    };

    const activeRes = computeUpdates(activePortfolioId, portfolio, activePortfolioAccountType, principal, history, portfolioStartDate);
    if (activeRes) setHistory(prev => applyUpdates(prev, activeRes.updates, activeRes.prin));

    let portfoliosChanged = false;
    const nextPortfolios = portfolios.map(p => {
      if (p.id === activePortfolioId) return p;
      const res = computeUpdates(p.id, p.portfolio || [], p.accountType, p.principal || 0, p.history || [], p.startDate || p.portfolioStartDate || '');
      if (!res) return p;
      const updated = applyUpdates(p.history || [], res.updates, res.prin);
      if (updated === (p.history || [])) return p;
      portfoliosChanged = true;
      return { ...p, history: updated };
    });
    if (portfoliosChanged) setPortfolios(nextPortfolios);
  }, [stockHistoryMap, indicatorHistoryMap, effectiveDateKey]);

  // 수동 백필: 지정 날짜부터 effectiveDate 미만까지 누락 평가액 채우기
  const handleManualBackfill = (fromDate) => {
    if (!fromDate) return;
    const effectiveDate = getEffectiveDate();
    if (fromDate >= effectiveDate) { notify('시작일은 오늘 이전이어야 합니다.', 'warning'); return; }

    const calcEval = (items, accountType, date) =>
      calcPortfolioEvalForDate(items, accountType, date, stockHistoryMap, indicatorHistoryMap, marketIndicators.usdkrw);

    const fillMissing = (items, accountType, prin, hist) => {
      if (accountType === 'simple' || !items.length) return null;
      const isGold = accountType === 'gold';
      const existingDates = new Set(hist.filter(h => h.isFixed).map(h => h.date));
      const availDates = new Set();
      if (isGold) {
        Object.keys(indicatorHistoryMap.goldKr || {}).forEach(d => { if (d >= fromDate && d < effectiveDate) availDates.add(d); });
      } else {
        items.forEach(item => {
          if ((item.type === 'stock' || item.type === 'fund') && item.code && stockHistoryMap[item.code]) {
            Object.keys(stockHistoryMap[item.code]).forEach(d => { if (d >= fromDate && d < effectiveDate) availDates.add(d); });
          }
        });
      }
      const newRecords = [];
      [...availDates].sort().forEach(date => {
        if (existingDates.has(date)) return;
        const evalAmt = calcEval(items, accountType, date);
        if (evalAmt > 0) newRecords.push({ date, evalAmount: evalAmt, principal: prin, isFixed: true });
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
