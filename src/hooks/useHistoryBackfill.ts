// @ts-nocheck
import { useRef, useEffect } from 'react';
import { calcPortfolioEvalForDate, resolveHoldings } from '../utils';
import { getEffectiveDate } from './useMarketCalendar';

export const useHistoryBackfill = ({
  stockHistoryMap,
  indicatorHistoryMap,
  marketIndicators,
  portfolioSummaries,
  portfolios,
  setPortfolios,
  activePortfolioId,
  setHistory,
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

    const calcEval = (p, accountType, date) => {
      const resolved = resolveHoldings(p, date);
      return calcPortfolioEvalForDate(resolved.items, accountType, date, stockHistoryMap, indicatorHistoryMap, marketIndicators.usdkrw, p.manualPriceOverrides || {});
    };

    const computeUpdates = (p) => {
      const portfolioId = p.id;
      const items = p.portfolio || [];
      const accountType = p.accountType;
      const prin = p.principal || 0;
      const hist = p.history || [];
      const startDate = p.portfolioStartDate || p.startDate || '';
      const snaps = p.holdingSnapshots || [];
      const hasHoldings = items.length > 0 || snaps.some(s => (s.items || []).length > 0);
      if (accountType === 'simple' || !hasHoldings) return null;
      const isGold = accountType === 'gold';
      const sortedDates = hist.map(h => h.date).sort();
      const baseDate = startDate || sortedDates[0] || null;
      if (!baseDate) return null;

      // stockHistoryMap에 있는 과거 날짜 수집 (effectiveDate 미만) — 현재 보유 + 과거 스냅샷 종목 합집합
      const availDates = new Set();
      if (isGold) {
        Object.keys(indicatorHistoryMap.goldKr || {}).forEach(d => { if (d >= baseDate && d < effectiveDate) availDates.add(d); });
      } else {
        const codes = new Set();
        items.forEach(it => { if ((it.type === 'stock' || it.type === 'fund') && it.code) codes.add(it.code); });
        snaps.forEach(s => (s.items || []).forEach(it => { if ((it.type === 'stock' || it.type === 'fund') && it.code) codes.add(it.code); }));
        codes.forEach(code => {
          if (stockHistoryMap[code]) Object.keys(stockHistoryMap[code]).forEach(d => { if (d >= baseDate && d < effectiveDate) availDates.add(d); });
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

        const evalAmt = calcEval(p, accountType, date);
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
            const next = { ...entry, evalAmount: evalAmt, isFixed };
            if (!entry.principalManual) next.principal = prin;
            newHist[idx] = next;
            changed = true;
          }
        } else {
          newHist.push({ date, evalAmount: evalAmt, principal: prin, isFixed });
          changed = true;
        }
      });
      return changed ? newHist : hist;
    };

    const activeP = portfolios.find(p => p.id === activePortfolioId);
    const activeRes = activeP ? computeUpdates(activeP) : null;
    if (activeRes) setHistory(prev => applyUpdates(prev, activeRes.updates, activeRes.prin));

    let portfoliosChanged = false;
    const nextPortfolios = portfolios.map(p => {
      if (p.id === activePortfolioId) return p;
      const res = computeUpdates(p);
      if (!res) return p;
      const updated = applyUpdates(p.history || [], res.updates, res.prin);
      if (updated === (p.history || [])) return p;
      portfoliosChanged = true;
      return { ...p, history: updated };
    });
    if (portfoliosChanged) setPortfolios(nextPortfolios);
  }, [stockHistoryMap, indicatorHistoryMap, effectiveDateKey]);

};

