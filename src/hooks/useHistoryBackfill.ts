// @ts-nocheck
import { useRef, useEffect } from 'react';
import { calcPortfolioEvalForDate, resolveHoldings } from '../utils';
import { getEffectiveDate, getEffectiveDateForAccount, getBackfillBoundaryForAccount, getBackfillBoundaryKR, getKrSettledTodayDate, isKrCutoffAccount } from './useMarketCalendar';

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
  krEffectiveDateKey,
}) => {
  const nonActiveHistRecordedRef = useRef({});
  const backfillDoneRef = useRef({});

  // 비활성 계좌 오늘 평가액 자동 기록
  //  - 시장 계좌: currentEval 0(가격 미로드)이면 기록 안 함, 같은 날 1건만 기록(불변).
  //  - 현금성(마통·simple): 시세 이력이 없어 값은 편집할 때만 바뀐다. 오늘 값이 바뀌면 오늘
  //    스냅샷을 갱신(비움=0 포함)해 carry-forward가 최신 잔액을 반영하고, 비운 계좌가 과거
  //    양수 스냅샷의 유령 잔액으로 남지 않게 한다. (단 한 번도 잔액이 없던 빈 계좌는 0 기록 생략)
  useEffect(() => {
    // ⚠️ portfolioSummaries의 accountType은 시장 계좌가 전부 'portfolio'로 고정(useIntegratedData)
    // → 실제 타입은 portfolios 배열에서 해석. 현금성은 글로벌 07:30, 시장 계좌는 시장별 기록일.
    // ⚠️ accountType 미설정 레거시 계좌는 'portfolio'로 정규화 — 사전체크와 아래 map이 다른 규칙을
    //    쓰면 ref 키 불일치로 needsUpdate 영구 true → 렌더/Drive 저장 무한 루프.
    const typeById = new Map(portfolios.map(p => [p.id, p.accountType || 'portfolio']));
    const recDateFor = (accountType) => {
      const isCash = accountType === 'matong' || accountType === 'simple';
      return isCash ? getEffectiveDate() : getEffectiveDateForAccount(accountType);
    };
    let needsUpdate = false;
    portfolioSummaries.forEach(s => {
      if (s.id === activePortfolioId) return;
      const accountType = typeById.get(s.id) || 'portfolio';
      const isCash = accountType === 'matong' || accountType === 'simple';
      const recDate = recDateFor(accountType);
      if (recDate === null) return; // KR 기록 창(09:00~21:00) 밖 — 기록 중단
      if (!isCash && s.currentEval === 0) return;
      const key = `${s.id}_${recDate}`;
      if (nonActiveHistRecordedRef.current[key] !== s.currentEval) needsUpdate = true;
    });
    if (!needsUpdate) return;
    setPortfolios(prev => prev.map(p => {
      if (p.id === activePortfolioId) return p;
      const summary = portfolioSummaries.find(s => s.id === p.id);
      if (!summary) return p;
      const accountType = typeById.get(p.id) || p.accountType || 'portfolio';
      const isCash = accountType === 'matong' || accountType === 'simple';
      const recDate = recDateFor(accountType);
      if (recDate === null) return p; // KR 기록 창(09:00~21:00) 밖 — 기록 중단
      if (!isCash && summary.currentEval === 0) return p;
      const key = `${p.id}_${recDate}`;
      if (nonActiveHistRecordedRef.current[key] === summary.currentEval) return p;
      const hist = p.history || [];
      const idx = hist.findIndex(h => h.date === recDate);
      if (isCash) {
        nonActiveHistRecordedRef.current[key] = summary.currentEval;
        // 한 번도 잔액이 없던 빈 현금계좌는 0 스냅샷을 만들지 않음 (노이즈 방지)
        if (summary.currentEval === 0 && idx < 0 && !hist.some(h => h.evalAmount > 0)) return p;
        if (idx >= 0) {
          if (Math.round(hist[idx].evalAmount ?? 0) === Math.round(summary.currentEval)) return p;
          const nh = hist.slice();
          nh[idx] = { ...nh[idx], evalAmount: summary.currentEval, principal: summary.principal, isFixed: false };
          return { ...p, history: nh };
        }
        return { ...p, history: [...hist, { date: recDate, evalAmount: summary.currentEval, principal: summary.principal, isFixed: false }] };
      }
      nonActiveHistRecordedRef.current[key] = summary.currentEval;
      if (idx >= 0) return p;
      return { ...p, history: [...hist, { date: recDate, evalAmount: summary.currentEval, principal: summary.principal, isFixed: false }] };
    }));
  }, [portfolioSummaries, activePortfolioId, effectiveDateKey, krEffectiveDateKey]);

  // 자동 히스토리 백필: 모든 누락 날짜 채우기
  useEffect(() => {
    if (Object.keys(stockHistoryMap).length === 0) return;
    // 사전체크는 가장 느슨한 상한(KR 상한 ≥ 글로벌 날짜) 사용 — 밤에 연 앱의 당일 백필도 진행
    const looseBoundary = getBackfillBoundaryKR();

    const hasHistData = Object.values(stockHistoryMap).some(m => Object.keys(m).some(d => d < looseBoundary));
    const hasGoldHistData = Object.keys(indicatorHistoryMap.goldKr || {}).some(d => d < looseBoundary);
    if (!hasHistData && !hasGoldHistData) return;

    const calcEval = (p, accountType, date) => {
      const resolved = resolveHoldings(p, date);
      return calcPortfolioEvalForDate(resolved.items, accountType, date, stockHistoryMap, indicatorHistoryMap, marketIndicators.usdkrw, p.manualPriceOverrides || {});
    };

    const computeUpdates = (p) => {
      const portfolioId = p.id;
      const items = p.portfolio || [];
      const accountType = p.accountType || 'portfolio';
      const prin = p.principal || 0;
      const hist = p.history || [];
      const startDate = p.portfolioStartDate || p.startDate || '';
      const snaps = p.holdingSnapshots || [];
      const hasHoldings = items.length > 0 || snaps.some(s => (s.items || []).length > 0);
      if (accountType === 'simple' || !hasHoldings) return null;
      const isGold = accountType === 'gold';
      // 계좌별 백필 상한: KR 계좌는 21:00 이후 당일까지(d < 내일), 그 외 글로벌 07:30 기준
      const boundary = getBackfillBoundaryForAccount(accountType);
      const sortedDates = hist.map(h => h.date).sort();
      const baseDate = startDate || sortedDates[0] || null;
      if (!baseDate) return null;

      // stockHistoryMap에 있는 과거 날짜 수집 (boundary 미만) — 현재 보유 + 과거 스냅샷 종목 합집합
      const availDates = new Set();
      if (isGold) {
        Object.keys(indicatorHistoryMap.goldKr || {}).forEach(d => { if (d >= baseDate && d < boundary) availDates.add(d); });
      } else {
        const codes = new Set();
        items.forEach(it => { if ((it.type === 'stock' || it.type === 'fund') && it.code) codes.add(it.code); });
        snaps.forEach(s => (s.items || []).forEach(it => { if ((it.type === 'stock' || it.type === 'fund') && it.code) codes.add(it.code); }));
        codes.forEach(code => {
          if (stockHistoryMap[code]) Object.keys(stockHistoryMap[code]).forEach(d => { if (d >= baseDate && d < boundary) availDates.add(d); });
        });
      }

      const updates = [];
      const existingMap = new Map(hist.map(h => [h.date, h]));

      // KR 당일 종가 보정 예외(21:00~24:00): 장중 값으로 동결된 당일 실시간 기록만 종가 재계산 허용.
      // 사용자 확정(adjustedAmount)은 계속 보호. 과거 날짜·타 계좌의 실시간 보호 불변식은 그대로.
      const liveOverrideDate = isKrCutoffAccount(accountType) ? getKrSettledTodayDate() : null;

      // 항목 유형 판별 헬퍼:
      // - 실시간 기록: isFixed: false + evalAmount > 0 → 절대 덮어쓰기 금지 (단 liveOverrideDate 예외)
      // - 사용자 확정/실시간 확정: isFixed: true + adjustedAmount 있음 → 덮어쓰기 금지
      // - 순수 백필: isFixed: true + adjustedAmount 없음 → 펀드 데이터 포함 재계산 허용
      // - 없는 날짜: 신규 추가
      [...availDates].sort().forEach(date => {
        const existing = existingMap.get(date);
        if (!existing?.isFixed && existing?.evalAmount > 0 && date !== liveOverrideDate) return; // 실시간 기록 보호
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
      // 범위: baseDate ~ boundary 사이 전체 날짜 순회
      const sortedAvail = [...availDates].sort();
      if (sortedAvail.length > 0) {
        const rangeStart = sortedAvail[0];
        const rangeEnd = boundary;
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

      return updates.length > 0 ? { updates, prin, liveOverrideDate } : null;
    };

    const applyUpdates = (hist, updates, prin, liveOverrideDate = null) => {
      if (!updates.length) return hist;
      const newHist = [...hist];
      let changed = false;
      updates.forEach(({ date, evalAmt, isFixed }) => {
        const idx = newHist.findIndex(h => h.date === date);
        if (idx >= 0) {
          const entry = newHist[idx];
          // 보호 조건: 실시간 기록(isFixed: false + evalAmount > 0, 단 liveOverrideDate 예외)
          //          또는 사용자 확정(isFixed: true + adjustedAmount 있음)
          const isProtected = (!entry.isFixed && (entry.evalAmount ?? 0) > 0 && date !== liveOverrideDate) ||
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
    if (activeRes) setHistory(prev => applyUpdates(prev, activeRes.updates, activeRes.prin, activeRes.liveOverrideDate));

    let portfoliosChanged = false;
    const nextPortfolios = portfolios.map(p => {
      if (p.id === activePortfolioId) return p;
      const res = computeUpdates(p);
      if (!res) return p;
      const updated = applyUpdates(p.history || [], res.updates, res.prin, res.liveOverrideDate);
      if (updated === (p.history || [])) return p;
      portfoliosChanged = true;
      return { ...p, history: updated };
    });
    if (portfoliosChanged) setPortfolios(nextPortfolios);
  }, [stockHistoryMap, indicatorHistoryMap, effectiveDateKey, krEffectiveDateKey]);

};

