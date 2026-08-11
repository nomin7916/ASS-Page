// @ts-nocheck
import { useMemo } from 'react';
import { cleanNum, savingsEval, savingsInvest, resolveTargetSlots, readTargetRatio } from '../utils';
import { CATEGORY_DISPLAY_ORDER } from '../constants';

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
  rebalExtraQty = {},
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
      else if (item.type === 'savings') {
        inv = savingsInvest(item) * fxRate;
        evl = savingsEval(item) * fxRate;
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
    const useDeposit = settings.useDepositAmount != null
      ? Math.min(Math.max(0, cleanNum(settings.useDepositAmount)), depositAmount)
      : depositAmount;
    const allocBase = cleanNum(settings.amount) + useDeposit;
    // 투자선택(settings.mode) = 'rebalance' | 'accumulate' | 'targetAmount'
    // ⚠️ 'targetAmount'만 수량을 금액에서 뽑는다. 자금 축(총평가금 기준·예수금 전액)은 리밸런싱과 동일.
    // ⚠️ 비-금액 모드의 분기는 `=== 'rebalance'` 그대로 둔다 — 마이그레이션 전 레거시 값
    //    ('deposit-only')이 기존처럼 적립식 식으로 떨어지게 하기 위함(폴백 극성 보존).
    const isAmountMode = settings.mode === 'targetAmount';
    const isLevelBase = settings.mode === 'rebalance' || isAmountMode;
    // ⚠️ 슬롯은 반드시 utils.resolveTargetSlots로 결정한다(적립식은 별도 슬롯).
    //    여기서 손으로 다시 고르면 화면 편집과 계산이 다른 슬롯을 읽어 값이 갈린다.
    // ⚠️ 읽기는 readTargetRatio(폴백 포함)로만 한다 — item[slotField]를 직접 읽으면 슬롯 축이
    //    바뀐 순간 살아 있는 목표가 0%(=리밸런싱 모드에선 전량 매도 지시)로 보인다.
    const targetSlots = resolveTargetSlots(settings);
    const { overrideField, mirrorField } = targetSlots;
    const mirrorState = settings[mirrorField] || 'off';
    // ── 목표금액 라이브 미러 ((%)의 금액판, settings.targetAmountMirror = 'off'|'seeded'|'on') ──
    // ⚠️ resolveTargetSlots처럼 모드별로 슬롯을 나누지 않는다 — 금액 슬롯은 item.targetAmount 하나뿐이고
    //    종목별 이탈도 item.targetAmountOverride 하나로 표현한다(비중처럼 고정/수시변경·적립식 분리 없음).
    // ⚠️ 'on'인 행은 저장값과 무관하게 목표금액 = 현재 평가금 → action이 항상 0(매매 없음)이다.
    //    라이브 재계산이라 시세 미로드 종목도 안전하다(0을 박제하는 건 시드·해제 write뿐 — RebalancingPanel).
    const amtMirrorState = settings.targetAmountMirror || 'off';
    let data = portfolio.filter(p => p.type === 'stock' || p.type === 'fund' || p.type === 'savings').map(item => {
      // 예적금(savings): 시세·수량이 없어 리밸런싱 매매 대상이 아님 — 고정 참고 행.
      // 평가금은 savingsEval(단리 누적)로 산출, 평가금 그대로 예상평가금에 이월(매매 0).
      // 단 목표비중은 펀드처럼 편집·합계(100%)에 포함(라이브 미러 시드 포함).
      if (item.type === 'savings') {
        const curEval = savingsEval(item);
        const invForReturn = savingsInvest(item);
        const returnRate = invForReturn > 0 ? ((curEval - invForReturn) / invForReturn) * 100 : 0;
        const isLiveMirror = mirrorState === 'on' && !item[overrideField];
        const liveRatio = totals.totalEval > 0 ? (curEval / totals.totalEval * 100) : 0;
        const effectiveTargetRatio = isLiveMirror ? liveRatio : readTargetRatio(item, targetSlots).value;
        const expEval = curEval;
        const expRatio = overallExp > 0 ? (expEval / overallExp * 100) : 0;
        // 목표금액 힌트는 '비중대로 매매했을 때 도달하는 평가금액'인데, 예적금은 매매 자체가 없어
        // 어떤 모드에서도 도달값이 현재 평가금(=expEval 이월)이다. 목표비중을 곱해 보여주면
        // 닿을 수 없는 금액이 Σ목표금액에 섞여 합계가 과대 표시된다.
        // 예적금은 목표금액 셀 자체가 읽기 전용이고 도달값이 항상 현재 평가금이라 (₩) 미러 대상이 아니다.
        return { ...item, curEval, action: 0, cost: 0, expEval, expRatio, effectiveTargetRatio, returnRate, isSavings: true, hasTargetAmount: false, isAmtLiveMirror: false, targetAmountHint: curEval, effectiveTargetAmount: curEval };
      }
      const qty = cleanNum(item.quantity);
      const price = cleanNum(item.currentPrice);
      const curEval = item.type === 'fund' && !(qty > 0 && price > 0)
        ? cleanNum(item.evalAmount)
        : price * qty;
      const invForReturn = item.type === 'fund'
        ? cleanNum(item.investAmount)
        : (activePortfolioAccountType === 'overseas' || activePortfolioAccountType === 'gold')
          ? cleanNum(item.purchasePrice) * qty
          : (cleanNum(item.investAmount) || cleanNum(item.purchasePrice) * qty);
      const returnRate = invForReturn > 0 ? ((curEval - invForReturn) / invForReturn) * 100 : 0;
      const isLiveMirror = mirrorState === 'on' && !item[overrideField];
      const liveRatio = totals.totalEval > 0 ? (curEval * rebalFxRate / totals.totalEval * 100) : 0;
      const effectiveTargetRatio = isLiveMirror
        ? liveRatio
        : readTargetRatio(item, targetSlots).value;
      const tRatio = effectiveTargetRatio / 100;
      // ── 목표금액(targetAmount) — 입력된 행은 비중이 아니라 금액이 수량을 만든다 ──
      // 수량 = ⌊(목표 평가금액 − 현재 평가금액) ÷ 종목가격⌋ → 양수 매수 / 음수 매도.
      // ⚠️ 미입력 판정에 cleanNum을 쓰지 말 것. cleanNum('')이 0이라 '0 = 미입력'으로 규정하면
      //    '목표 0원(전량 매도)'을 표현할 길이 사라진다 → 저장 원시값의 타입으로 판정한다.
      // ⚠️ 힌트(targetAmountHint)는 '비중대로 매매했을 때 **도달하는** 평가금액'으로 정의한다 —
      //    리밸런싱 모드는 목표 평가금(overallExp×비중), 적립식 모드는 현재 평가금 + 이번 배분액
      //    (curEval + allocBase×비중). 이래야 힌트를 그대로 입력해도 수량이 1주도 바뀌지 않는다
      //    (두 모드 모두 대수적 항등). 적립식에 레벨 식(overallExp×비중)만 쓰면 힌트를 옮겨 적는 순간
      //    수량이 전혀 달라져 사용자가 '금액을 넣으면 값이 튄다'고 느낀다.
      // ⚠️ `price > 0` 가드는 반드시 바깥에 유지 — 기준가 미로드 펀드에서 Infinity/NaN이 cost·expEval·
      //    rebalBalance·maxAdd를 거쳐 rebalExtraQty(계좌 전환에도 보존됨)까지 오염된다.
      // ⚠️ 타입까지 본다 — String(x).trim() !== '' 만으로는 손상된 Drive 값(true/객체/'abc')이
      //    전부 '입력됨'으로 통과하고 cleanNum이 그걸 0으로 만들어 **조용히 전량 매도**가 된다.
      const rawTargetAmount = item.targetAmount;
      const hasRawTargetAmount = typeof rawTargetAmount === 'number'
        ? Number.isFinite(rawTargetAmount)
        : (typeof rawTargetAmount === 'string' && /\d/.test(rawTargetAmount));
      // (₩) 라이브 미러 추종 행 — 저장값 대신 현재 평가금이 목표금액이 된다(→ action 0).
      // ⚠️ 해외계좌는 curEval이 native USD이고 targetAmount도 USD라 환산하지 않는다(원화 환산 금지).
      // ⚠️ isAmountMode를 반드시 함께 본다 — 금액 축은 '목표금액' 모드 전용이라, 리밸런싱·적립식에서
      //    미러가 켜진 채로 남아 있어도 그 열이 저장값을 그대로 보여야 한다. 안 그러면 그 모드에서
      //    hasTargetAmount가 전 행 true가 되어 달력 스냅샷(buildRebalTargetEntry)이 '사용자가 지정한
      //    목표금액'으로 현재 평가금을 박제하고, 나중에 그 기록을 복원하면 실제 지정값이 덮인다.
      const isAmtLiveMirror = isAmountMode && amtMirrorState === 'on' && !item.targetAmountOverride;
      // hasTargetAmount = '이 행의 수량이 비중이 아니라 금액에서 나오는가'. 미러 추종 행도 참이다
      // (셀 표시·tfoot '금액 지정 N종목'·복원 모달 '목표금액 우선' 배지가 이 의미로 읽는다).
      const hasTargetAmount = isAmtLiveMirror ? true : hasRawTargetAmount;
      const targetAmountHint = isLevelBase ? overallExp * tRatio : curEval + allocBase * tRatio;
      const effectiveTargetAmount = isAmtLiveMirror
        ? curEval
        : (hasRawTargetAmount ? cleanNum(rawTargetAmount) : targetAmountHint);
      // ⚠️ 금액 기준은 **투자선택이 '목표금액'일 때만** 적용된다(모드 게이팅). 리밸런싱·적립식에서는
      //    금액이 입력돼 있어도 무시하고 목표비중이 적용된다 — 사용자가 정한 규약이다.
      //    금액 미입력 행은 effectiveTargetAmount가 힌트(=비중대로 도달하는 평가금)라
      //    '목표금액' 모드에서도 리밸런싱과 **완전히 같은 수량**이 나온다(대수적 항등).
      let action = price > 0
        ? (isAmountMode
          ? Math.trunc((effectiveTargetAmount - curEval) / price)
          : (settings.mode === 'rebalance' ? Math.trunc(((overallExp * tRatio) - curEval) / price) : Math.trunc((allocBase * tRatio) / price)))
        : 0;
      const extraQty = rebalExtraQty[item.id] || 0;
      const expEval = (qty + action + extraQty) * price;
      const cost = action * price;
      const expRatio = overallExp > 0 ? (expEval / overallExp * 100) : 0;
      return { ...item, curEval, action, cost, expEval, expRatio, effectiveTargetRatio, returnRate, hasTargetAmount, isAmtLiveMirror, targetAmountHint, effectiveTargetAmount };
    });
    if (rebalanceSortConfig.key === 'code-global') {
      data.sort((a, b) => (a.code || '').localeCompare(b.code || '') * rebalanceSortConfig.direction);
    } else if (rebalanceSortConfig.key && rebalanceSortConfig.key !== 'category') {
      data.sort((a, b) => {
        const vA = a[rebalanceSortConfig.key], vB = b[rebalanceSortConfig.key];
        if (typeof vA === 'string') return vA.localeCompare(vB) * rebalanceSortConfig.direction;
        return (vA - vB) * rebalanceSortConfig.direction;
      });
    } else if (rebalanceSortConfig.key === 'category') {
      data.sort((a, b) => {
        const catA = (a.category) || '기타', catB = (b.category) || '기타';
        return catA.localeCompare(catB) * rebalanceSortConfig.direction;
      });
    }
    return data;
  }, [portfolio, totals.totalEval, settings, rebalanceSortConfig, activePortfolioAccountType, marketIndicators.usdkrw, rebalExtraQty]);

  const allPortfoliosForDividend = useMemo(() =>
    portfolios.map(p =>
      p.id === activePortfolioId ? { ...p, portfolio } : p
    ),
    [portfolios, activePortfolioId, portfolio]
  );

  const rebalCatDonutData = useMemo(() => {
    const catMap = {};
    rebalanceData.forEach(item => {
      const cat = (item.category) || '기타';
      if (!catMap[cat]) catMap[cat] = { value: 0, ratio: 0 };
      catMap[cat].value += item.expEval;
      catMap[cat].ratio += item.expRatio;
    });
    const depositAmount = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
    const totalCost = rebalanceData.reduce((s, item) => {
      const eqty = rebalExtraQty[item.id] || 0;
      return s + (item.cost || 0) + eqty * cleanNum(item.currentPrice);
    }, 0);
    const baseDeposit = depositAmount + cleanNum(settings.amount);
    const remainingDeposit = baseDeposit - totalCost;
    if (remainingDeposit > 0) {
      const nativeTotalEval = activePortfolioAccountType === 'overseas'
        ? totals.totalEval / (marketIndicators.usdkrw || 1)
        : totals.totalEval;
      const overallExp = nativeTotalEval + cleanNum(settings.amount);
      catMap['예수금'] = {
        value: remainingDeposit,
        ratio: overallExp > 0 ? (remainingDeposit / overallExp * 100) : 0,
      };
    }
    return Object.entries(catMap)
      .map(([name, { value, ratio }]) => ({ name, value, ratio }))
      .filter(x => x.value > 0)
      .sort((a, b) => {
        const ia = CATEGORY_DISPLAY_ORDER.indexOf(a.name), ib = CATEGORY_DISPLAY_ORDER.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.value - a.value;
      });
  }, [rebalanceData, portfolio, settings, activePortfolioAccountType, totals.totalEval, marketIndicators.usdkrw, rebalExtraQty]);

  const curCatDonutData = useMemo(() => {
    return Object.entries(totals.cats)
      .map(([name, val]) => ({ name, value: val.eval }))
      .filter(x => x.value > 0)
      .sort((a, b) => {
        const ia = CATEGORY_DISPLAY_ORDER.indexOf(a.name), ib = CATEGORY_DISPLAY_ORDER.indexOf(b.name);
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
      if (!h.noPrincipal) runSum += cleanNum(h.amount);
      return { ...h, cumulative: runSum, originalIndex: depositHistory.length - 1 - i };
    }).reverse();
  }, [depositHistory]);

  const depositWithSum2 = useMemo(() => {
    let runSum = 0;
    return [...depositHistory2].reverse().map((h, i) => {
      if (!h.noPrincipal) runSum += cleanNum(h.amount);
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
