// @ts-nocheck
import { useMemo } from 'react';
import { cleanNum, getClosestValue, calcPortfolioEvalDetail, resolveHoldings, savingsEval, savingsInvest, buildCloseEvalSeries, computeDailyMetricsSeries, buildBookCostSeries } from '../utils';
import { getEffectiveDate, isKrCutoffAccount } from './useMarketCalendar';
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
  krEffectiveDateKey,
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
        return { id: p.id, name, startDate, currentEval: evalAmount, principal: prin, depositAmount: evalAmount, returnRate, cagr, cats: evalAmount > 0 ? { '예수금': evalAmount } : {}, isActive: false, accountType: 'simple', rowColor: p.rowColor || '', memo: p.memo || '', isTest: !!p.isTest, deletedAt: p.deletedAt || '' };
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
          isActive: false, accountType: 'matong', rowColor: p.rowColor || '', memo: p.memo || '', isTest: !!p.isTest, deletedAt: p.deletedAt || '',
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
        } else if (item.type === 'savings') {
          const evl = savingsEval(item) * summaryFxRate;
          totalEval += evl;
          cats['예적금'] = (cats['예적금'] || 0) + evl;
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
      return { id: p.id, name, startDate, currentEval: totalEval, principal: principalKRW, depositAmount: depositAmt, returnRate, cagr, cats, isActive, accountType: 'portfolio', rowColor: p.rowColor || '', memo: p.memo || '', isTest: !!p.isTest, deletedAt: p.deletedAt || '' };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios, activePortfolioId, portfolio, principal, avgExchangeRate, portfolioStartDate, title, marketIndicators.usdkrw]);

  const intTotals = useMemo(() => {
    let totalEval = 0, totalPrincipal = 0, totalDeposit = 0;
    const cats = {};
    portfolioSummaries.forEach(s => {
      if (s.isTest) return; // TEST 계좌는 합계·카테고리 비중에서 제외(표시만)
      if (s.deletedAt) return; // 삭제된 계좌는 라이브 합계·비중에서 완전 제외(과거 시계열은 별도 보존)
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

  // 시장 계좌별 (날짜 → 평가액) 시계열. '저장된 라이브 값'이 아니라 항상 '수량 × 종가'(확정 종가)를
  // 권위값으로 사용한다(buildCloseEvalSeries). 개별 계좌 차트(App.tsx finalChartData)와 동일 소스라
  // 통합 추이·팝업(histDetailRows)이 개별 계좌 추이와 정확히 일치한다 → 정확한 일별 자산 추적.
  //  - 해외계좌: USD(과거 종가) × 날짜별 환율로 재계산(기존 경로 유지 — buildCloseEvalSeries 대상 아님).
  //  - 그 외(주식·금·연금 등): buildCloseEvalSeries가 날짜별 '수량 × 종가'(정확 종가 완비 시) 또는
  //    직전 정확값 이월(carry-forward)을 반환. 오늘·첫 정확값 이전은 미설정 → 저장값 폴백.
  //  마지막에 저장된 라이브 evalAmount로 폴백하므로 초기 로딩·데이터 공백에도 안전.
  const marketSeries = useMemo(() => {
    const globalToday = effectiveDateKey || getEffectiveDate();
    const liveFx = marketIndicators.usdkrw || 1;
    return portfolios
      .filter(p => !p.isTest && p.accountType !== 'matong' && p.accountType !== 'simple')
      .map(p => {
        const isActive = p.id === activePortfolioId;
        const hist = isActive ? history : (p.history || []);
        const acctType = p.accountType || 'portfolio';
        const src = isActive ? { ...p, portfolio } : p;
        const mpo = p.manualPriceOverrides || {};
        const map = new Map();
        if (acctType === 'overseas') {
          hist.forEach(h => {
            if (!h || !h.date) return;
            const r = calcPortfolioEvalDetail(resolveHoldings(src, h.date).items, 'overseas', h.date, stockHistoryMap, indicatorHistoryMap || {}, liveFx, mpo);
            const v = r.hasAnyPrice ? r.total : (h.evalAmount > 0 ? h.evalAmount : 0);
            if (v > 0) map.set(h.date, v);
          });
        } else {
          const edk = isKrCutoffAccount(acctType) ? (krEffectiveDateKey || globalToday) : globalToday;
          const closeSeries = buildCloseEvalSeries(src, hist.map(h => h?.date), acctType, stockHistoryMap, indicatorHistoryMap || {}, edk);
          hist.forEach(h => {
            if (!h || !h.date) return;
            const cb = closeSeries.get(h.date);
            const v = cb != null ? cb : (h.evalAmount > 0 ? h.evalAmount : 0);
            if (v > 0) map.set(h.date, v);
          });
        }
        // 장부액(Σ 예수금+매입원가) 시계열 — 일간 지표 보류 판정이 '원장 흐름이 그날 평가액에
        // 반영됐는가'를 ΔV로 추측하지 않고 관측하도록 공급한다(개별 계좌 HistoryPanel과 동일 소스).
        // ⚠️ 해외계좌는 장부가 USD인데 흐름은 ₩ 환산이라 단위가 어긋나므로 제외(미제공 → 기존 폴백).
        const bookMap = acctType === 'overseas' ? null : buildBookCostSeries(src, [...map.keys()]);
        // ⚠️ 삭제 계좌(deletedAt)도 시계열을 유지한다(과거 총자산·계좌별 현황 팝업 보존).
        //   소비자(computedIntHistory carry-forward / histDetailRows)가 d < deletedAt로 캡한다.
        return { id: p.id, dates: [...map.keys()].sort(), map, bookMap, deletedAt: p.deletedAt || '' };
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios, activePortfolioId, portfolio, history, stockHistoryMap, indicatorHistoryMap, marketIndicators.usdkrw, effectiveDateKey, krEffectiveDateKey]);

  const computedIntHistory = useMemo(() => {
    const today = effectiveDateKey || getEffectiveDate();

    // 현금성 계좌(마통·직접입력)는 시장 시세 이력이 없다 — 값은 사용자가 편집할 때만 바뀐다.
    // 일별 자동 스냅샷(useHistoryBackfill)이 그날의 잔액을 p.history에 기록하므로, 시장 계좌처럼
    // 스냅샷 carry-forward로 과거 잔액을 그대로 복원한다(현재값을 과거 날짜에 소급하지 않음).
    // '오늘'만 현재값을 권위로 사용해 최신 편집(비움=0 포함)을 즉시 반영한다.
    // (스냅샷에 0도 포함 → 비운 계좌가 carry-forward로 0이 이어져 유령 잔액이 남지 않음)
    const cashSeries = portfolios
      .filter(p => !p.isTest && (p.accountType === 'matong' || p.accountType === 'simple'))
      .map(p => {
        const startDate = p.id === activePortfolioId ? portfolioStartDate : (p.portfolioStartDate || p.startDate || '');
        const currentEval = p.accountType === 'simple'
          ? (cleanNum(p.evalAmount) || 0)
          : Math.max(0, (cleanNum(p.withdrawableTotal) || 0) - ((cleanNum(p.currentWithdrawal) || 0) + (cleanNum(p.withdrawalLimit) || 0)));
        const map = new Map();
        (p.history || []).forEach(h => { if (h && h.date && typeof h.evalAmount === 'number' && h.evalAmount >= 0) map.set(h.date, h.evalAmount); });
        return { startDate, currentEval, dates: [...map.keys()].sort(), map, deletedAt: p.deletedAt || '' };
      });

    // 시장 계좌별 시계열(marketSeries — 항상 '수량 × 종가' 권위값)에서 기록이 있는 계좌만 사용.
    // (현금성 계좌는 스냅샷 미사용 → marketSeries에서 제외됨. 아래 cashSeries로 별도 처리.)
    const accountSeries = marketSeries.filter(a => a.dates.length > 0);

    // 전체 날짜 합집합 (+ 오늘)
    const dateSet = new Set();
    accountSeries.forEach(a => a.dates.forEach(d => dateSet.add(d)));
    cashSeries.forEach(c => c.dates.forEach(d => dateSet.add(d)));
    if (intTotals.totalEval > 0) dateSet.add(today);
    const sortedDates = [...dateSet].sort();

    // 각 날짜에 대해 계좌별 직전 거래일 값(carry-forward)을 합산.
    // 주말·공휴일 등 일부 계좌만 기록된 날짜에도 모든 계좌의 평가액이 빠짐없이 반영된다.
    // (각 계좌 첫 기록 이전 날짜에는 lastVal=0 → 기여하지 않음)
    // 삭제 계좌 경계: min(deletedAt, today). 삭제일부터 미기여하되, 새벽(effectiveDate<달력today) 삭제 시
    // 라이브 시점(today)의 평가(override=제외)와 원금·현금 carry-forward가 어긋나지 않도록 today에서도 정지.
    const cutoffOf = (deletedAt) => deletedAt ? (deletedAt < today ? deletedAt : today) : '';
    const dateToTotal = new Map();
    // 장부액도 평가액과 **완전히 같은 규칙**(carry-forward + 삭제 경계)으로 합산한다 — 규칙이 다르면
    // bookDelta가 흐름이 아닌 집계 차이를 반영해 보류 판정이 틀린다.
    // ⚠️ 한 계좌라도 그 날짜의 장부액이 미확보(추정 구성·해외)면 그날 합계는 통째로 무효(null)로 둔다.
    //    일부만 더한 합계는 흐름과 비교할 수 없기 때문. 무효면 소비자가 기존 ΔV 휴리스틱으로 폴백한다.
    const dateToBook = new Map();
    const bookInvalid = new Set();
    accountSeries.forEach(({ dates, map, bookMap, deletedAt }) => {
      const cutoff = cutoffOf(deletedAt);
      let i = 0, lastVal = 0, lastBook = null, sawAny = false;
      for (const d of sortedDates) {
        if (cutoff && d >= cutoff) break; // 삭제 계좌: 경계일부터 미기여(과거만 보존)
        while (i < dates.length && dates[i] <= d) {
          lastVal = map.get(dates[i]);
          if (bookMap) { const b = bookMap.get(dates[i]); if (b != null) { lastBook = b; sawAny = true; } }
          i++;
        }
        if (lastVal > 0) dateToTotal.set(d, (dateToTotal.get(d) || 0) + lastVal);
        // 평가액엔 기여하는데 장부액은 못 내는 계좌가 있으면 그 날짜 합계는 신뢰 불가
        if (lastVal > 0 && (!bookMap || !sawAny || lastBook == null)) bookInvalid.add(d);
        else if (lastBook != null) dateToBook.set(d, (dateToBook.get(d) || 0) + lastBook);
      }
    });

    // 현금성 계좌: 날짜별 잔액(스냅샷 carry-forward, 오늘은 현재값, 시작일 이전 0)을 합산.
    // 과거 그날의 기록값을 그대로 반영 → 현재값이 과거로 소급되지 않는다.
    const cashByDate = new Map();
    cashSeries.forEach(({ startDate, currentEval, dates, map, deletedAt }) => {
      const cutoff = cutoffOf(deletedAt);
      let i = 0, lastVal = 0;
      for (const d of sortedDates) {
        if (cutoff && d >= cutoff) break; // 삭제 계좌: 경계일부터 미기여(삭제 계좌는 today에 도달 안 함 → 라이브값 배제)
        while (i < dates.length && dates[i] <= d) { lastVal = map.get(dates[i]); i++; }
        let v = d === today ? currentEval : lastVal;
        if (startDate && d < startDate) v = 0;
        if (v > 0) cashByDate.set(d, (cashByDate.get(d) || 0) + v);
      }
    });
    cashByDate.forEach((v, d) => dateToTotal.set(d, (dateToTotal.get(d) || 0) + v));
    // 현금성 계좌는 평가액 = 잔액 = 장부액이다(시세 개념이 없음). 그 잔액 Δ가 곧 흐름(②)이므로
    // 장부 합계에도 같은 값을 더해야 bookDelta와 netFlow의 기준이 일치한다.
    cashByDate.forEach((v, d) => dateToBook.set(d, (dateToBook.get(d) || 0) + v));

    // 오늘 값은 실시간 합산 평가액으로 보정 (휴일에 가격 미로드로 폭락한 경우 직전값 유지).
    // ⚠️ 이상치 판정 기준(prevValue)은 오늘 라이브(intTotals=삭제 제외)와 '같은 집합'이어야 한다.
    //   dateToTotal(prevDate)는 삭제 계좌를 포함(prevDate<cutoff)하므로, 지배적 계좌(비중>90%)를 삭제하면
    //   'intTotals << prevValue'가 되어 정상 감소를 가격 미로드 이상치로 오판(today를 옛 총액으로 되돌려
    //   삭제 계좌가 오늘에 되살아남). → prevDate에서 삭제 계좌가 기여했던 몫을 빼 라이브 멤버십으로 맞춘다.
    let todayAnomaly = false;
    if (intTotals.totalEval > 0) {
      const prevDates = sortedDates.filter(d => d < today);
      const prevDate = prevDates.length > 0 ? prevDates[prevDates.length - 1] : '';
      let prevValue = prevDate ? (dateToTotal.get(prevDate) || 0) : 0;
      if (prevDate) {
        const valAt = (dates, map) => { let last = 0; for (const d of dates) { if (d <= prevDate) last = map.get(d); else break; } return last || 0; };
        accountSeries.forEach(({ dates, map, deletedAt }) => {
          if (deletedAt && prevDate < cutoffOf(deletedAt)) prevValue -= valAt(dates, map);
        });
        cashSeries.forEach(({ startDate, dates, map, deletedAt }) => {
          if (deletedAt && prevDate < cutoffOf(deletedAt) && !(startDate && prevDate < startDate)) prevValue -= valAt(dates, map);
        });
        if (prevValue < 0) prevValue = 0;
      }
      const isAnomaly = prevValue > 0 && intTotals.totalEval < prevValue * 0.1;
      todayAnomaly = isAnomaly;
      dateToTotal.set(today, isAnomaly ? prevValue : intTotals.totalEval);
    }

    // ── 일간 수익률용 순 외부현금흐름(IN/OUT) ────────────────────────────────────────
    // ⚠️ effectivePrincipal(:270~)의 일별 차분을 흐름으로 쓰면 안 된다. 그 값은 '원가 표시용'이라
    //    Math.max(0,...) 클램프·startDate 게이트·noPrincipal 미필터가 섞여 있어, 차분을 흐름으로
    //    삼으면 (a) 출금 1건이 몇 달 전 일간 수익률을 소급 변경하고 (b) 계좌 삭제일에 누적
    //    미실현손익이 통째로 하루 수익이 되어 부호까지 뒤집힌다. 반드시 아래 3원 소스를 쓸 것.
    //    ① 시장 계좌 입출금 원장 ② 현금성 계좌 잔액 변동 ③ 계좌 편입/이탈 경계
    const flowInMap = new Map();
    const flowOutMap = new Map();
    // 배지 표시용은 별도 집계 — ③ 계좌 편입/이탈은 사용자가 한 적 없는 자금 이동이라
    // '입금 ₩N' 배지로 찍히면 오해를 부른다. 수학에는 포함하되 배지에서는 제외한다.
    const ledgerNetMap = new Map();
    const addIn = (d, v) => { if (d && v > 0) flowInMap.set(d, (flowInMap.get(d) || 0) + v); };
    const addOut = (d, v) => { if (d && v > 0) flowOutMap.set(d, (flowOutMap.get(d) || 0) + v); };
    const addLedger = (d, v) => { if (d && v) ledgerNetMap.set(d, (ledgerNetMap.get(d) || 0) + v); };

    // ③ 계좌 편입/이탈 — 원장에 없는 흐름. '원금'이 아니라 평가액 전액이라야 ΔV와 정확히 상쇄된다.
    //    편입일(d0) 이하의 원장은 추적 시작 전 거래이므로 ①에서 제외한다(이중계상 방지).
    const firstSeenById = new Map();
    accountSeries.forEach(({ id, dates, map, deletedAt }) => {
      const cutoff = cutoffOf(deletedAt);
      const d0 = dates[0];
      if (!d0 || (cutoff && d0 >= cutoff)) return;
      firstSeenById.set(id, d0);
      addIn(d0, map.get(d0) || 0);
      if (!cutoff) return;
      let i = 0, lastVal = 0;
      for (const d of sortedDates) {
        if (d >= cutoff) { addOut(d, lastVal); break; }
        while (i < dates.length && dates[i] <= d) { lastVal = map.get(dates[i]); i++; }
      }
    });

    // ① 시장 계좌 입출금 원장 (현금성 계좌는 원장 편집 UI가 존재하지 않아 ②에서 처리)
    portfolios
      .filter(p => !p.isTest && p.accountType !== 'matong' && p.accountType !== 'simple')
      .forEach(p => {
        // 평가 시계열에 한 번도 등장하지 않는 계좌(기록 0건 / 첫 기록 전에 삭제)는 V에 기여하지
        // 않으므로 그 원장을 흐름으로 잡으면 ΔV가 없는 유령 손익이 된다 → 통째로 제외.
        if (!firstSeenById.has(p.id)) return;
        const isActive = p.id === activePortfolioId;
        const isOverseas = p.accountType === 'overseas';
        const cutoff = cutoffOf(p.deletedAt || '');
        const since = firstSeenById.get(p.id) || '';
        // 해외 흐름 환산은 V와 같은 소스(날짜별 환율)를 써야 한다 — 원장의 d.fxRate는 '행 생성
        // 시점' 환율로 박제되므로(DepositPanel), 소급 입력 시 V(날짜별 환율 재계산)와 어긋나
        // 입금일에 환율차만큼 가짜 손익이 남는다. 날짜별 값이 없을 때만 d.fxRate로 폴백.
        const rateOf = (d) => isOverseas
          ? (getClosestValue(indicatorHistoryMap?.usdkrw, d.date) || d.fxRate || marketIndicators.usdkrw || 1)
          : 1;
        const deps = isActive ? depositHistory : (p.depositHistory || []);
        const wds = isActive ? depositHistory2 : (p.depositHistory2 || []);
        // ⚠️ Math.abs 금지 — 음수 '정정 행'(DepositPanel이 빨간 글씨로 지원)은 유입의 반대다.
        //    abs를 씌우면 정정 쌍이 상쇄되지 않고 이중 계상되어 오차가 원장 금액의 2배가 된다.
        deps.forEach(d => {
          // noPrincipal(배당·이자)은 계좌 안에서 발생한 수익 → 외부 유입이 아니다
          if (!d || !d.date || d.noPrincipal) return;
          if (since && d.date <= since) return;
          if (cutoff && d.date >= cutoff) return;
          const v = (cleanNum(d.amount) || 0) * rateOf(d);
          if (v > 0) addIn(d.date, v); else if (v < 0) addOut(d.date, -v);
          addLedger(d.date, v);
        });
        wds.forEach(w => {
          // 출금은 noPrincipal이어도 현금이 실제로 빠져나간다 → 전액 반영(입금과 비대칭이 정상)
          if (!w || !w.date) return;
          if (since && w.date <= since) return;
          if (cutoff && w.date >= cutoff) return;
          const v = (cleanNum(w.amount) || 0) * rateOf(w);
          if (v > 0) addOut(w.date, v); else if (v < 0) addIn(w.date, -v);
          addLedger(w.date, -v);
        });
      });

    // ①-b 평가 시계열이 없는 시장 계좌(기록 0건인 신규 계좌)는 dateToTotal에는 없지만
    //     today 행이 intTotals.totalEval로 덮어써지므로(:247) 오늘 V에는 100% 포함된다.
    //     → 그 평가액 전액이 '오늘 수익'으로 찍히는 것을 막기 위해 today 편입 흐름으로 계상한다.
    portfolioSummaries.forEach(s => {
      if (s.isTest || s.deletedAt) return;
      if (s.accountType === 'matong' || s.accountType === 'simple') return;
      if (firstSeenById.has(s.id)) return;
      addIn(today, cleanNum(s.currentEval) || 0);
    });

    // ② 현금성 계좌(마통·직접입력) 잔액 변동 = 외부 흐름.
    //    ΔV와 같은 값이 흐름으로 잡혀 r=0 → CLAUDE.md '현금성 계좌 수익 0' 불변식 유지.
    let prevCash = 0;
    for (const d of sortedDates) {
      const v = cashByDate.get(d) || 0;
      const delta = v - prevCash;
      if (delta > 0) addIn(d, delta); else if (delta < 0) addOut(d, -delta);
      // 현금성 잔액 편집도 사용자가 한 실제 자금 이동이므로 배지에 표시한다
      addLedger(d, delta);
      prevCash = v;
    }

    // 기록이 없는 날(주말 등)에 찍힌 원장 흐름은 다음 기록일 행으로 이월 — 흐름 유실 방지
    const flowAtRow = new Map();
    {
      const allFlowDates = [...new Set([...flowInMap.keys(), ...flowOutMap.keys(), ...ledgerNetMap.keys(), ...sortedDates])].sort();
      let carryIn = 0, carryOut = 0, carryLedger = 0;
      for (const d of allFlowDates) {
        carryIn += flowInMap.get(d) || 0;
        carryOut += flowOutMap.get(d) || 0;
        carryLedger += ledgerNetMap.get(d) || 0;
        if (dateToTotal.has(d)) {
          flowAtRow.set(d, { in: carryIn, out: carryOut, ledger: carryLedger });
          carryIn = 0; carryOut = 0; carryLedger = 0;
        }
      }
    }

    // 시장 계좌만 원금 보정식 적용(현금성 계좌는 아래에서 날짜별 잔액 합산 → 수익 0 유지)
    const portfolioPrincipalData = portfolios
      .filter(p => !p.isTest && p.accountType !== 'matong' && p.accountType !== 'simple')
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
        return { startDate, currentPrincipalKRW, deps, wds, isOverseas, deletedAt: p.deletedAt || '' };
      });
    return [...dateToTotal.entries()]
      .map(([date, evalAmount]) => {
        let effectivePrincipal = portfolioPrincipalData.reduce((sum, { startDate, currentPrincipalKRW, deps, wds, isOverseas, deletedAt }) => {
          if (!startDate || startDate > date) return sum;
          const cutoff = cutoffOf(deletedAt);
          if (cutoff && date >= cutoff) return sum; // 삭제 계좌: 경계일부터 원금 미기여(평가와 동일 경계)
          const depRate = (d) => isOverseas ? (d.fxRate || 1) : 1;
          const futureDeposits = deps.filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0) * depRate(d), 0);
          const futureWithdrawals = wds.filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0) * depRate(d), 0);
          return sum + Math.max(0, currentPrincipalKRW - futureDeposits + futureWithdrawals);
        }, 0);
        // 현금성 계좌: 원금=평가(날짜별 잔액) → 평가와 동일 합산 → 수익 0 유지
        effectivePrincipal += cashByDate.get(date) || 0;
        const f = flowAtRow.get(date);
        return {
          id: date, date, evalAmount, effectivePrincipal,
          netFlowIn: f ? f.in : 0,
          netFlowOut: f ? f.out : 0,
          ledgerFlow: f ? f.ledger : 0,
          // 그날 총 장부액(Σ 예수금+매입원가). 한 계좌라도 미확보면 null → 소비자가 ΔV 폴백.
          // ⚠️ 오늘 행의 evalAmount는 라이브 합계로 덮어써지지만(:247) 장부액은 스냅샷 기준이다.
          //    예수금 편집은 그 날짜 스냅샷을 만들므로(snapshotCompositionKey에 depositAmount 포함)
          //    오늘 편집도 오늘 장부에 잡힌다.
          bookTotal: bookInvalid.has(date) ? null : (dateToBook.has(date) ? dateToBook.get(date) : null),
          // 오늘 라이브 평가액이 이상치로 판정돼 전일값으로 대체된 날은 ΔV가 0인데 흐름만 남아
          // 가짜 대손실이 난다 → 일간 지표를 보류(미산출)한다
          flowSuspect: date === today && todayAnomaly,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [portfolios, marketSeries, history, activePortfolioId, depositHistory, depositHistory2, intTotals.totalEval, portfolioStartDate, principal, avgExchangeRate, marketIndicators.usdkrw, effectiveDateKey, portfolio, stockHistoryMap, indicatorHistoryMap, portfolioSummaries]);

  // 계좌별 시계열(id → {dates, map})을 추이 팝업(histDetailRows)이 재사용 → 팝업 소계 = 차트 그날 값
  // (개별 계좌 추이와도 동일 소스). 저장된 라이브 값이 아니라 '수량 × 종가'로 일별 자산을 추적.
  const intAccountSeriesById = useMemo(() => {
    const obj = {};
    marketSeries.forEach(a => { obj[a.id] = a; });
    return obj;
  }, [marketSeries]);

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

  // 일간 지표는 순 외부현금흐름을 제거한 뒤 산출한다 — ₩49,118,578이 입금된 날 옛 식은 +9.10%를
  // 보였지만 실제 시장 수익은 ₩11,312,160(+1.59%)이다.
  //  · 일간 손익(₩) = ΔV − (IN − OUT)  ← 입출금 규모와 완전히 무관한 값. 표의 주인공.
  //  · 일간 수익률(%) = (V + OUT) / (V₋ + IN) − 1
  //    유입은 기초(BOD)·유출은 기말(EOD) 가중. 분모를 V₋로만 두면 소액 계좌에 대형 입금이 들어올 때
  //    +50% 같은 폭발이 나고(지금 고치는 버그의 재발), 유출까지 분모에 넣으면 전액 출금일에 분모가
  //    0이 되어 그날 실수익이 소실된다. 이 비대칭이 두 붕괴를 동시에 피한다.
  //    ⚠️ 관리자 포털(AdminPortal recomputePortfolioEval)이 구조적으로 같은 규약이라 자동 정합된다.
  const intMonthlyHistory = useMemo(() => {
    // ⚠️ 오름차순 1패스로 '보류된 행의 미소진 흐름 이월'을 반드시 수행할 것.
    //    flowAtRow는 '행 존재'만 보고 캐리를 리셋하는데, 주말·휴장 행은 buildCloseEvalSeries가
    //    직전 정확값을 이월하므로 그날 ΔV가 흐름을 흡수하지 못한다(fillNonTradingGaps·
    //    useHistoryBackfill 치유로 주말 행은 항상 존재). 이월하지 않으면 보류 행에서 IN이
    //    소각되고 다음 기록일 ΔV에 입금액이 그대로 남아 '입금액=수익' 버그가 하루 밀려 재발한다.
    const asc = [...computedIntHistory].sort((a, b) => a.date.localeCompare(b.date));
    const metrics = computeDailyMetricsSeries(asc.map((h, i) => {
      // 장부액 차분 — 보류 판정이 '흐름이 V에 반영됐는가'를 추측 대신 관측하게 한다(개별 계좌와 동일).
      // 양쪽 날짜 모두 확보됐을 때만 유효(한쪽이라도 null이면 기존 ΔV 휴리스틱 폴백).
      const prev = asc[i - 1];
      const bookDelta = (prev && prev.bookTotal != null && h.bookTotal != null)
        ? h.bookTotal - prev.bookTotal
        : null;
      return {
        date: h.date, evalAmount: h.evalAmount,
        flowIn: h.netFlowIn || 0, flowOut: h.netFlowOut || 0,
        ledger: h.ledgerFlow || 0, flowSuspect: h.flowSuspect, bookDelta,
      };
    }));
    return [...asc].reverse().map(h => {
      const ep = h.effectivePrincipal > 0 ? h.effectivePrincipal : intTotals.totalPrincipal;
      const monthlyChange = ep > 0 ? ((h.evalAmount - ep) / ep) * 100 : 0;
      const m = metrics.get(h.date) || { dodAbsChange: null, dodChange: 0, ledgerFlow: 0, held: true };
      return { ...h, monthlyChange, dodChange: m.dodChange, dodAbsChange: m.dodAbsChange, netFlow: m.ledgerFlow };
    });
  }, [computedIntHistory, intTotals.totalPrincipal]);

  const intDepositEvents = useMemo(() => {
    const byDate = new Map();
    portfolios.forEach(p => {
      if (p.isTest) return; // TEST 계좌는 추이 차트 입출금 마커에서 제외
      const cutoff = p.deletedAt || null; // 삭제 계좌는 삭제일 이전 마커만 유지(삭제일 이후 제외)
      const isActive = p.id === activePortfolioId;
      const deps = isActive ? depositHistory : (p.depositHistory || []);
      const wds = isActive ? depositHistory2 : (p.depositHistory2 || []);
      deps.forEach(d => {
        if (!d.date) return;
        if (cutoff && d.date >= cutoff) return;
        const prev = byDate.get(d.date) || { date: d.date, deposits: 0, withdrawals: 0 };
        prev.deposits += (d.amount || 0) * (d.fxRate || 1);
        byDate.set(d.date, prev);
      });
      wds.forEach(d => {
        if (!d.date) return;
        if (cutoff && d.date >= cutoff) return;
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
      if (p.isTest) return; // TEST 계좌는 통합 자산 카테고리·종목별 비중에서 제외
      if (p.deletedAt) return; // 삭제 계좌는 라이브 종목별 비중(오늘 보유)에서 제외
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
        } else if (item.type === 'savings') {
          const evl = savingsEval(item) * fxRate;
          if (evl <= 0) return;
          const cost = savingsInvest(item) * fxRate;
          const key = item.name || '예적금';
          if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category: '예적금', code: '' };
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
    intAccountSeriesById,
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
