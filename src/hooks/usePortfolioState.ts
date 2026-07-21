// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { UI_CONFIG } from '../config';
import { generateId, cleanNum } from '../utils';
import { getTodayKST } from './useMarketCalendar';

interface UsePortfolioStateParams {
  marketIndicators: { goldKr?: number; goldKrChg?: number; [key: string]: any };
  notify: (text: string, type?: string) => void;
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
  setShowIntegratedDashboard: (v: boolean) => void;
}

export function usePortfolioState({
  marketIndicators,
  notify,
  confirm,
  setShowIntegratedDashboard,
}: UsePortfolioStateParams) {
  // ── 포트폴리오 목록 (단일 소스) ──
  const [portfolios, setPortfolios] = useState([]);
  const [activePortfolioId, setActivePortfolioId] = useState(null);
  const [intHistory, setIntHistory] = useState([]);
  const [customLinks, setCustomLinks] = useState(UI_CONFIG.DEFAULT_LINKS);
  const [overseasLinks, setOverseasLinks] = useState(UI_CONFIG.OVERSEAS_DEFAULT_LINKS);
  // 분배금 현황 헤더 사이트 링크(사용자 정의 이니셜 1자 + URL). 항상 7슬롯.
  const [dividendLinks, setDividendLinks] = useState(
    () => Array.from({ length: 7 }, () => ({ initial: '', url: '' }))
  );
  const [adminAccessAllowed, setAdminAccessAllowed] = useState(false);
  const [depositSortConfig, setDepositSortConfig] = useState({ key: null, direction: 1 });
  const [depositSortConfig2, setDepositSortConfig2] = useState({ key: null, direction: 1 });

  // ── 활성 포트폴리오 (파생) ──
  const activePortfolio = useMemo(
    () => portfolios.find(p => p.id === activePortfolioId) ?? null,
    [portfolios, activePortfolioId]
  );

  // ── 활성 계좌 타입 (파생) ──
  const activePortfolioAccountType = activePortfolio?.accountType || 'portfolio';

  // ── 개별 필드 파생값 (하위 호환) ──
  const _defaultStartDate = useMemo(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split('T')[0];
  }, []);
  const title = activePortfolio?.name ?? '주식/ETF 포트폴리오';
  const portfolio = activePortfolio?.portfolio ?? [];
  const principal = activePortfolio?.principal ?? UI_CONFIG.DEFAULTS.PRINCIPAL;
  const avgExchangeRate = activePortfolio?.avgExchangeRate ?? 0;
  const depositHistory = activePortfolio?.depositHistory ?? [];
  const depositHistory2 = activePortfolio?.depositHistory2 ?? [];
  const history = activePortfolio?.history ?? [];
  const settings = activePortfolio?.settings ?? { mode: 'rebalance', amount: 1000000 };
  const portfolioStartDate = activePortfolio?.portfolioStartDate || activePortfolio?.startDate || _defaultStartDate;
  const lookupRows = activePortfolio?.lookupRows ?? [];
  const setLookupRows = (v) => patchActive(p => ({ lookupRows: typeof v === 'function' ? v(p.lookupRows ?? []) : v }));
  const hiddenColumnsPortfolio = activePortfolio?.hiddenColumnsPortfolio ?? [];
  const hiddenColumnsRebalancing = activePortfolio?.hiddenColumnsRebalancing ?? [];
  const toggleHiddenColumnPortfolio = (key) => patchActive(p => {
    const cur = p.hiddenColumnsPortfolio ?? [];
    return { hiddenColumnsPortfolio: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] };
  });
  const toggleHiddenColumnRebalancing = (key) => patchActive(p => {
    const cur = p.hiddenColumnsRebalancing ?? [];
    return { hiddenColumnsRebalancing: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] };
  });
  const markedRebalRows = activePortfolio?.markedRebalRows ?? {};
  const toggleMarkedRebalRow = (itemId) => patchActive(p => {
    const cur = p.markedRebalRows ?? {};
    const order = ['yellow', 'slate', 'rose', 'brown'];
    const next = { ...cur };
    const idx = order.indexOf(cur[itemId]);
    if (idx === -1) next[itemId] = order[0];
    else if (idx < order.length - 1) next[itemId] = order[idx + 1];
    else delete next[itemId];
    return { markedRebalRows: next };
  });
  const markedPortfolioRows = activePortfolio?.markedPortfolioRows ?? {};
  const toggleMarkedPortfolioRow = (itemId) => patchActive(p => {
    const cur = p.markedPortfolioRows ?? {};
    const order = ['yellow', 'slate', 'rose', 'brown'];
    const next = { ...cur };
    const idx = order.indexOf(cur[itemId]);
    if (idx === -1) next[itemId] = order[0];
    else if (idx < order.length - 1) next[itemId] = order[idx + 1];
    else delete next[itemId];
    return { markedPortfolioRows: next };
  });
  const resetAllMarkedRebalRows = () => patchActive(() => ({ markedRebalRows: {} }));
  const resetAllMarkedPortfolioRows = () => patchActive(() => ({ markedPortfolioRows: {} }));

  // ── 활성 포트폴리오만 갱신하는 헬퍼 ──
  const patchActive = (patch) =>
    setPortfolios(prev => prev.map(p => {
      if (p.id !== activePortfolioId) return p;
      const resolved = typeof patch === 'function' ? patch(p) : patch;
      return { ...p, ...resolved };
    }));

  // ── 하위 호환 세터 ──
  const setTitle = (v) => patchActive({ name: v });
  const setPrincipal = (v) => patchActive(p => ({ principal: typeof v === 'function' ? v(p.principal ?? 0) : v }));
  const setAvgExchangeRate = (v) => patchActive({ avgExchangeRate: v });
  const setPortfolio = (v) => patchActive(p => ({ portfolio: typeof v === 'function' ? v(p.portfolio ?? []) : v }));
  const setHistory = (v) => patchActive(p => ({ history: typeof v === 'function' ? v(p.history ?? []) : v }));
  const setDepositHistory = (v) => patchActive(p => ({ depositHistory: typeof v === 'function' ? v(p.depositHistory ?? []) : v }));
  const setDepositHistory2 = (v) => patchActive(p => ({ depositHistory2: typeof v === 'function' ? v(p.depositHistory2 ?? []) : v }));
  const setSettings = (v) => patchActive({ settings: v });
  const setPortfolioStartDate = (v) => patchActive({ portfolioStartDate: v, startDate: v });

  // ── buildPortfoliosState (portfolios가 단일 소스) ──
  const buildPortfoliosState = () => portfolios;

  // ── 포트폴리오 탭 전환 ──
  const switchToPortfolio = (id) => {
    const target = portfolios.find(p => p.id === id);
    if (!target || target.accountType === 'simple' || target.accountType === 'matong') return;
    setActivePortfolioId(id);
    setShowIntegratedDashboard(false);
  };

  // ── 포트폴리오 추가 ──
  const addPortfolio = (accountType = 'portfolio') => {
    const newId = generateId();
    const today = new Date().toISOString().split('T')[0];
    const ACCOUNT_TYPE_NAMES = {
      'portfolio': '일반 증권', 'isa': 'ISA', 'dc-irp': '퇴직연금',
      'gold': 'KRX 금현물', 'pension': '연금저축', 'dividend': '배당형', 'crypto': 'CRYPTO', 'overseas': '해외계좌',
    };
    const existingTypeAccount = portfolios.find(p => p.accountType === accountType);
    const inheritedSettings = existingTypeAccount?.settings || { mode: 'rebalance', amount: 1000000 };
    const newP = {
      id: newId, name: ACCOUNT_TYPE_NAMES[accountType] || '새 계좌', startDate: today, portfolioStartDate: today,
      accountType,
      portfolio: [{ id: generateId(), type: 'deposit', depositAmount: 0 }],
      principal: 0, avgExchangeRate: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: inheritedSettings,
      // 자산검증: 신규 계좌는 가입일을 기준일로 (가입 이전 추정 구간 없음)
      baselineDate: today, holdingSnapshots: [], manualPriceOverrides: {}, preBaselineVerified: false,
    };
    setPortfolios(prev => [...prev, newP]);
    setActivePortfolioId(newId);
  };

  // 빈 계좌 생성 헬퍼(마지막 계좌 삭제·영구삭제 시 앱이 비지 않도록)
  const makeBlankPortfolio = () => {
    const today = new Date().toISOString().split('T')[0];
    return {
      id: generateId(), name: '새 계좌', startDate: today, portfolioStartDate: today,
      accountType: 'portfolio',
      portfolio: [{ id: generateId(), type: 'deposit', depositAmount: 0 }],
      principal: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: { mode: 'rebalance', amount: 1000000 },
      baselineDate: today, holdingSnapshots: [], manualPriceOverrides: {}, preBaselineVerified: false,
    };
  };

  // ── 포트폴리오 삭제 (소프트 삭제) ──
  // 계좌를 배열에서 제거하지 않고 deletedAt(삭제일, KST) 태그만 단다. 삭제일 이전(d < deletedAt)
  // 날짜의 통합 총자산·계좌별 현황 기여는 그대로 보존되고(과거 총자산 불변), 삭제일부터 라이브/오늘
  // 뷰(통합 계좌 현황·평가액 추이·탭·비중)에서 제외된다. 데이터는 보존 → 언제든 복원 가능.
  const deletePortfolio = async (id) => {
    const target = portfolios.find(p => p.id === id);
    if (!target || target.deletedAt) return;
    const nonDeletedOthers = portfolios.filter(p => p.id !== id && !p.deletedAt);
    const isLast = nonDeletedOthers.length === 0;
    const confirmMsg = isLast
      ? '마지막 남은 계좌입니다. 삭제하면 과거 기록은 보존되고 새 빈 계좌가 생성됩니다. 삭제하시겠습니까?'
      : '이 계좌를 삭제하시겠습니까?\n\n과거 총자산·계좌별 현황 기록은 그대로 보존되고, 통합 계좌 현황·평가액 추이에서는 삭제일 이후로 제외됩니다. (표 하단 "삭제된 계좌"에서 복원 가능)';
    if (!await confirm(confirmMsg)) return;
    const deletedAt = getTodayKST();
    const marked = portfolios.map(p => p.id === id ? { ...p, deletedAt } : p);
    if (isLast) {
      const blank = makeBlankPortfolio();
      setPortfolios([...marked, blank]);
      setActivePortfolioId(blank.id);
      setShowIntegratedDashboard(false);
      return;
    }
    setPortfolios(marked);
    if (activePortfolioId === id) {
      const nextActive = nonDeletedOthers.find(p => p.accountType !== 'simple' && p.accountType !== 'matong');
      if (nextActive) {
        setActivePortfolioId(nextActive.id);
      } else {
        // ⚠️ 삭제된 계좌를 활성으로 남기면 App.tsx 활성 계좌 기록 효과(오늘/MA펀드)가 동결돼야 할
        //    계좌에 이력을 쓴다 → activePortfolioId를 비워 activePortfolio=null → totals=0 → 효과 no-op.
        setActivePortfolioId(null);
        setShowIntegratedDashboard(true);
      }
    }
  };

  // ── 삭제 계좌 복원 (deletedAt 제거) ──
  const restorePortfolio = (id) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== id || !p.deletedAt) return p;
      const { deletedAt, ...rest } = p;
      return rest;
    }));
  };

  // ── 삭제 계좌 영구 삭제 (하드 삭제 — 과거 기록까지 완전 제거, 되돌리기 불가) ──
  const purgePortfolio = async (id) => {
    const target = portfolios.find(p => p.id === id);
    if (!target) return;
    if (!await confirm('이 계좌를 영구 삭제하시겠습니까?\n\n과거 총자산·계좌별 현황 기록에서도 완전히 제거되어 되돌릴 수 없습니다.')) return;
    const remaining = portfolios.filter(p => p.id !== id);
    if (remaining.length === 0) {
      const blank = makeBlankPortfolio();
      setPortfolios([blank]);
      setActivePortfolioId(blank.id);
      setShowIntegratedDashboard(false);
      return;
    }
    setPortfolios(remaining);
    if (activePortfolioId === id) {
      const nextActive = remaining.find(p => p.accountType !== 'simple' && p.accountType !== 'matong' && !p.deletedAt);
      if (nextActive) {
        setActivePortfolioId(nextActive.id);
      } else {
        setActivePortfolioId(null);
        setShowIntegratedDashboard(true);
      }
    }
  };

  // ── 직접입력 계좌 추가 ──
  const addSimpleAccount = () => {
    const newId = generateId();
    const today = new Date().toISOString().split('T')[0];
    const newP = {
      id: newId, name: '새 계좌', startDate: today, portfolioStartDate: today,
      accountType: 'simple',
      evalAmount: 0,
      portfolio: [], principal: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: { mode: 'rebalance', amount: 1000000 },
    };
    setPortfolios(prev => [...prev, newP]);
  };

  // ── 마통 계좌 추가 ──
  const addMatongAccount = () => {
    const newId = generateId();
    const today = new Date().toISOString().split('T')[0];
    const newP = {
      id: newId, name: '마통계좌', startDate: today, portfolioStartDate: today,
      accountType: 'matong',
      withdrawableTotal: 0, currentWithdrawal: 0, withdrawalLimit: 0, agreedRate: 0,
      evalAmount: 0,
      portfolio: [], principal: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: { mode: 'rebalance', amount: 1000000 },
    };
    setPortfolios(prev => [...prev, newP]);
  };

  // ── 마통 계좌 필드 수정 ──
  const updateMatongAccountField = (id, field, val) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== id) return p;
      const stored = field === 'agreedRate' ? val : cleanNum(val);
      const updated = { ...p, [field]: stored };
      const wt = field === 'withdrawableTotal' ? cleanNum(val) : (cleanNum(p.withdrawableTotal) || 0);
      const cw = field === 'currentWithdrawal' ? cleanNum(val) : (cleanNum(p.currentWithdrawal) || 0);
      const wl = field === 'withdrawalLimit' ? cleanNum(val) : (cleanNum(p.withdrawalLimit) || 0);
      const newPrincipal = Math.max(0, wt - (cw + wl));
      return { ...updated, principal: newPrincipal, evalAmount: newPrincipal };
    }));
  };

  // ── 직접입력 계좌 필드 수정 ──
  const updateSimpleAccountField = (id, field, val) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (field === 'evalAmount') {
        const num = cleanNum(val);
        const prin = p.principalManual ? cleanNum(p.principal) : num;
        const today = new Date().toISOString().split('T')[0];
        const history = p.history || [];
        const idx = history.findIndex(h => h.date === today);
        const newHistory = idx >= 0
          ? history.map((h, i) => i === idx ? { ...h, evalAmount: num, principal: prin } : h)
          : [...history, { date: today, evalAmount: num, principal: prin, isFixed: false }];
        return { ...p, evalAmount: num, ...(!p.principalManual ? { principal: num } : {}), history: newHistory };
      }
      if (field === 'principal') {
        return { ...p, principal: cleanNum(val), principalManual: true };
      }
      return { ...p, [field]: cleanNum(val) };
    }));
  };

  // ── 시작일 변경 ──
  const updatePortfolioStartDate = (id, date) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, startDate: date, portfolioStartDate: date } : p));
  };

  // ── 계좌명 변경 ──
  const updatePortfolioName = (id, name) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  };

  // ── 계좌 색상 변경 ──
  const updatePortfolioColor = (id, rowColor) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, rowColor } : p));
  };

  // ── TEST 계좌 토글 ── 통합 대시보드 표시는 유지하되 합산·차트·카테고리 비중에서 제외
  const togglePortfolioTest = (id) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, isTest: !p.isTest } : p));
  };

  // ── 전체 색상 초기화 ──
  const resetAllPortfolioColors = () => {
    setPortfolios(prev => prev.map(p => ({ ...p, rowColor: '' })));
  };

  // ── 같은 accountType 계좌에 settings 동기화 ──
  const updateSettingsForType = (newSettings) => {
    if (!activePortfolio) return;
    setPortfolios(prev => prev.map(p =>
      p.accountType === activePortfolio.accountType ? { ...p, settings: newSettings } : p
    ));
  };

  // ── 메모 변경 ──
  const updatePortfolioMemo = (id, memo) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, memo } : p));
  };

  // ── 계좌 순서 이동 ──
  const movePortfolio = (id, direction) => {
    setPortfolios(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  // ── 분배금 이력 저장 ──
  const mergeDividendData = (p, mergeMap, exDateMap) => {
    const existing = p.dividendHistory || {};
    const updated = { ...existing };
    Object.entries(mergeMap).forEach(([code, monthData]) => {
      updated[code] = { ...(existing[code] || {}), ...monthData };
    });
    let exUpdated = p.dividendExDate || {};
    if (exDateMap && Object.keys(exDateMap).length) {
      const existingEx = p.dividendExDate || {};
      exUpdated = { ...existingEx };
      Object.entries(exDateMap).forEach(([code, exData]) => {
        exUpdated[code] = { ...(existingEx[code] || {}), ...exData };
      });
    }
    return { ...p, dividendHistory: updated, dividendExDate: exUpdated, dividendHistoryUpdatedAt: Date.now() };
  };

  const updateDividendHistory = (mergeMap, exDateMap) => {
    setPortfolios(prev => prev.map(p =>
      p.id !== activePortfolioId ? p : mergeDividendData(p, mergeMap, exDateMap)
    ));
  };

  const updatePortfolioDividendHistory = (portfolioId, mergeMap, exDateMap) => {
    setPortfolios(prev => prev.map(p =>
      p.id !== portfolioId ? p : mergeDividendData(p, mergeMap, exDateMap)
    ));
  };

  const updatePortfolioActualDividend = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualDividend || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount === null) delete codeData[yearMonth]; else codeData[yearMonth] = amount;
      return { ...p, actualDividend: { ...existing, [code]: codeData } };
    }));
  };

  const updatePortfolioActualDividendUsd = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualDividendUsd || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount === null) delete codeData[yearMonth]; else codeData[yearMonth] = amount;
      return { ...p, actualDividendUsd: { ...existing, [code]: codeData } };
    }));
  };

  // 월 입금 내역 수동 수량(표시·기록용 override) — 세후/과세 금액 재계산 안 함
  const updatePortfolioActualDividendQty = (portfolioId, code, yearMonth, qty) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualDividendQty || {};
      const codeData = { ...(existing[code] || {}) };
      if (qty === null || !(qty > 0)) delete codeData[yearMonth]; else codeData[yearMonth] = qty;
      return { ...p, actualDividendQty: { ...existing, [code]: codeData } };
    }));
  };

  const updatePortfolioDividendTaxRate = (portfolioId, rate) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      return { ...p, dividendTaxRate: rate };
    }));
  };

  const updatePortfolioDividendSeparateTax = (portfolioId, value) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      return { ...p, dividendSeparateTax: value };
    }));
  };

  const updatePortfolioDividendTaxAmount = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.dividendTaxAmounts || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount > 0) codeData[yearMonth] = amount;
      else delete codeData[yearMonth];
      return { ...p, dividendTaxAmounts: { ...existing, [code]: codeData } };
    }));
  };

  const updatePortfolioActualAfterTaxUsd = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualAfterTaxUsd || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount === null) delete codeData[yearMonth]; else codeData[yearMonth] = amount;
      return { ...p, actualAfterTaxUsd: { ...existing, [code]: codeData } };
    }));
  };

  const updatePortfolioActualAfterTaxKrw = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualAfterTaxKrw || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount === null) delete codeData[yearMonth]; else codeData[yearMonth] = amount;
      return { ...p, actualAfterTaxKrw: { ...existing, [code]: codeData } };
    }));
  };

  // ── 한국 ETF 과표기준가 이력 (분배금 과세 계산용) ──
  // 구조: portfolio.taxBaseHistory[code] = {
  //   purchases: [...], sales: [...],
  //   exTaxBase: { 'YYYY-MM': number }, avgTaxBase: { 'YYYY-MM': number },
  // }
  const _ensureTaxBase = (p, code) => {
    const existing = p.taxBaseHistory || {};
    const codeRec = existing[code] || {};
    return {
      ...existing,
      [code]: {
        events: codeRec.events || [],
        purchases: codeRec.purchases || [],
        sales: codeRec.sales || [],
        exTaxBase: codeRec.exTaxBase || {},
        avgTaxBase: codeRec.avgTaxBase || {},
      },
    };
  };

  const updateTaxBaseEvents = (portfolioId, code, events) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      tbh[code] = { ...tbh[code], events: Array.isArray(events) ? events : [] };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  const updateTaxBasePurchases = (portfolioId, code, purchases) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      tbh[code] = { ...tbh[code], purchases: Array.isArray(purchases) ? purchases : [] };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  const updateTaxBaseSales = (portfolioId, code, sales) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      tbh[code] = { ...tbh[code], sales: Array.isArray(sales) ? sales : [] };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  const updateTaxBaseExPrice = (portfolioId, code, yearMonth, price) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      const exTaxBase = { ...(tbh[code].exTaxBase || {}) };
      if (price == null || !(price > 0)) delete exTaxBase[yearMonth];
      else exTaxBase[yearMonth] = price;
      tbh[code] = { ...tbh[code], exTaxBase };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  const updateTaxBaseAvgPrice = (portfolioId, code, yearMonth, price) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      const avgTaxBase = { ...(tbh[code].avgTaxBase || {}) };
      if (price == null || !(price > 0)) delete avgTaxBase[yearMonth];
      else avgTaxBase[yearMonth] = price;
      tbh[code] = { ...tbh[code], avgTaxBase };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  // 과표 계산 매트릭스의 월(0~11) 컬럼 숨김 토글 — 계좌별 hiddenTaxMonths 배열에 저장.
  // 포트폴리오 테이블 열 숨기기(hiddenColumnsPortfolio)의 과표표 버전. 표시 편의용이므로
  // 연합계·월별 합계 계산에는 영향을 주지 않고 렌더만 숨긴다(KrEtfTaxMatrix 참조).
  const toggleHiddenTaxMonth = (portfolioId, monthIndex) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const cur = p.hiddenTaxMonths ?? [];
      const next = cur.includes(monthIndex) ? cur.filter(m => m !== monthIndex) : [...cur, monthIndex];
      return { ...p, hiddenTaxMonths: next };
    }));
  };

  // 분배금 표(월 예상 분배금·월 입금 내역)의 월(0~11) 컬럼 숨김 토글 — 계좌별·탭별 독립 배열.
  // hiddenTaxMonths(과표)와 같은 표시 편의용이라 월별 합계·연간합계·분배율 계산에는 영향을 주지
  // 않고(전 12개월로 계산 유지) 렌더만 숨긴다. 두 탭은 숨김 상태를 공유하지 않는다.
  const toggleHiddenDividendMonth = (portfolioId, tab, monthIndex) => {
    const field = tab === 'actual' ? 'hiddenDivMonthsActual' : 'hiddenDivMonthsExpected';
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const cur = p[field] ?? [];
      const next = cur.includes(monthIndex) ? cur.filter(m => m !== monthIndex) : [...cur, monthIndex];
      return { ...p, [field]: next };
    }));
  };

  // ── 수동 추가 배당금 행 ──
  const addPortfolioExtraRow = (portfolioId) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.extraDividendRows || [];
      return { ...p, extraDividendRows: [...existing, { id: generateId(), code: '', monthData: {} }] };
    }));
  };

  const updatePortfolioExtraRowCode = (portfolioId, rowId, code, name = undefined) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const rows = (p.extraDividendRows || []).map(r => {
        if (r.id !== rowId) return r;
        return name !== undefined ? { ...r, code, name } : { ...r, code };
      });
      return { ...p, extraDividendRows: rows };
    }));
  };

  const deletePortfolioExtraRow = (portfolioId, rowId) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      return { ...p, extraDividendRows: (p.extraDividendRows || []).filter(r => r.id !== rowId) };
    }));
  };

  const updatePortfolioExtraRowMonth = (portfolioId, rowId, yearMonth, afterTaxUsd, afterTaxKrw, taxKrw = 0) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const rows = (p.extraDividendRows || []).map(r => {
        if (r.id !== rowId) return r;
        const monthData = { ...r.monthData };
        if (afterTaxKrw > 0 || afterTaxUsd > 0) {
          const entry = { afterTaxUsd, afterTaxKrw };
          if (taxKrw > 0) entry.taxKrw = taxKrw;
          monthData[yearMonth] = entry;
        } else delete monthData[yearMonth];
        return { ...r, monthData };
      });
      return { ...p, extraDividendRows: rows };
    }));
  };

  // 포트폴리오에서 제거된 종목의 '삭제됨' 유령 행 × 버튼 — 그 코드의 수동 분배금 입력을 영구 삭제.
  // 종목 삭제(handleDeleteStock)는 종목 행만 지우고 코드별 분배금/과세 데이터는 계좌에 그대로 남겨
  // 유령 행으로 계속 노출된다. 이 핸들러만이 그 데이터를 실제로 제거한다.
  const deletePortfolioDividendData = (portfolioId, code) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const strip = (map) => {
        if (!map || !(code in map)) return map;
        const next = { ...map };
        delete next[code];
        return next;
      };
      return {
        ...p,
        actualDividend: strip(p.actualDividend),
        actualDividendUsd: strip(p.actualDividendUsd),
        actualDividendQty: strip(p.actualDividendQty),
        dividendTaxAmounts: strip(p.dividendTaxAmounts),
        actualAfterTaxUsd: strip(p.actualAfterTaxUsd),
        actualAfterTaxKrw: strip(p.actualAfterTaxKrw),
        dividendHistory: strip(p.dividendHistory),
        dividendExDate: strip(p.dividendExDate),
        // dividendTaxAmounts/actualDividendQty는 portfolioStructureKey 지문에 없으므로
        // 이 필드만 있던 코드 삭제도 Drive 저장되도록 타임스탬프를 갱신(지문 포함 필드).
        dividendHistoryUpdatedAt: Date.now(),
      };
    }));
  };

  // 과표 계산 '삭제됨' 유령 행 × 버튼 — 그 코드의 과표 이력(taxBaseHistory)을 영구 삭제.
  const deletePortfolioTaxData = (portfolioId, code) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId || !p.taxBaseHistory || !(code in p.taxBaseHistory)) return p;
      const next = { ...p.taxBaseHistory };
      delete next[code];
      return { ...p, taxBaseHistory: next };
    }));
  };

  // ── 포트폴리오 항목 CRUD ──
  const handleUpdate = (id, field, value) =>
    setPortfolio(prev => prev.map(p =>
      p.id === id ? { ...p, [field]: ['category', 'name', 'code', 'assetClass'].includes(field) ? value : cleanNum(value) } : p
    ));

  const handleDeleteStock = (id) => setPortfolio(prev => prev.filter(p => p.id !== id));

  const handleAddStock = () =>
    setPortfolio(prev => [
      { id: generateId(), type: 'stock', category: "주식", assetClass: 'D', code: "", name: "", currentPrice: 0, changeRate: 0, purchasePrice: 0, investAmount: 0, quantity: 0, targetRatio: 0, isManual: true },
      ...prev,
    ]);

  const handleAddFund = () =>
    setPortfolio(prev => {
      const lastFundIdx = prev.reduceRight((acc, p, i) => acc === -1 && p.type === 'fund' ? i : acc, -1);
      const depositIdx = prev.findIndex(p => p.type === 'deposit');
      const insertIdx = lastFundIdx >= 0 ? lastFundIdx + 1 : (depositIdx >= 0 ? depositIdx + 1 : prev.length);
      const newFund = { id: generateId(), type: 'fund', category: 'FUND', assetClass: 'S', code: '', name: '', currentPrice: 0, changeRate: 0, investAmount: 0, evalAmount: 0, targetRatio: 0, isManual: true };
      return [...prev.slice(0, insertIdx), newFund, ...prev.slice(insertIdx)];
    });

  // ── 예적금(savings) CRUD — 퇴직연금(dc-irp) 전용 ──
  const handleAddSavings = () =>
    setPortfolio(prev => {
      const lastSavingsIdx = prev.reduceRight((acc, p, i) => acc === -1 && p.type === 'savings' ? i : acc, -1);
      const lastFundIdx = prev.reduceRight((acc, p, i) => acc === -1 && p.type === 'fund' ? i : acc, -1);
      const depositIdx = prev.findIndex(p => p.type === 'deposit');
      const insertIdx = lastSavingsIdx >= 0 ? lastSavingsIdx + 1
        : lastFundIdx >= 0 ? lastFundIdx + 1
        : depositIdx >= 0 ? depositIdx + 1
        : prev.length;
      const newSavings = { id: generateId(), type: 'savings', category: '예적금', assetClass: 'S', name: '', annualRate: 0, startDate: '', endDate: '', investAmount: 0, evalAmount: 0, deposits: [], targetRatio: 0, isManual: true };
      return [...prev.slice(0, insertIdx), newSavings, ...prev.slice(insertIdx)];
    });

  const updateSavingsField = (id, field, value) =>
    setPortfolio(prev => prev.map(p => {
      if (p.id !== id) return p;
      // annualRate는 원시 문자열로 저장(소수점 '3.' 입력 보존) — 소비처(savingsEval/표시)에서 cleanNum.
      if (field === 'name' || field === 'startDate' || field === 'endDate' || field === 'assetClass' || field === 'annualRate')
        return { ...p, [field]: value };
      return { ...p, [field]: cleanNum(value) };
    }));

  const addSavingsDeposit = (id, date, amount) =>
    setPortfolio(prev => prev.map(p => {
      if (p.id !== id) return p;
      const amt = cleanNum(amount);
      if (amt <= 0) return p;
      const deposits = [...(p.deposits || []), { id: generateId(), date: date || '', amount: amt }];
      const investAmount = deposits.reduce((s, d) => s + cleanNum(d.amount), 0);
      return { ...p, deposits, investAmount };
    }));

  const removeSavingsDeposit = (id, depId) =>
    setPortfolio(prev => prev.map(p => {
      if (p.id !== id) return p;
      const deposits = (p.deposits || []).filter(d => d.id !== depId);
      const investAmount = deposits.reduce((s, d) => s + cleanNum(d.amount), 0);
      return { ...p, deposits, investAmount };
    }));

  // ── KRX 금현물 포트폴리오: 주식 항목이 없으면 자동 초기화 ──
  useEffect(() => {
    if (activePortfolioAccountType !== 'gold') return;
    setPortfolio(prev => {
      if (prev.some(p => p.type === 'stock')) return prev;
      return [
        { id: generateId(), type: 'stock', category: '금', code: '', name: 'KRX 금현물', currentPrice: 0, changeRate: 0, purchasePrice: 0, quantity: 0, targetRatio: 0, isManual: true },
        ...prev,
      ];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioAccountType, activePortfolioId]);

  // ── KRX 금현물 포트폴리오: goldKr 시세를 주식 항목의 currentPrice에 자동 동기화 ──
  useEffect(() => {
    if (activePortfolioAccountType !== 'gold') return;
    if (!marketIndicators.goldKr) return;
    setPortfolio(prev => prev.map(item =>
      item.type === 'stock'
        ? { ...item, currentPrice: marketIndicators.goldKr, changeRate: marketIndicators.goldKrChg ?? item.changeRate }
        : item
    ));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketIndicators.goldKr, activePortfolioAccountType]);

  const updateInvestmentNotes = (notes) => patchActive({ investmentNotes: notes });

  return {
    // 파생 상태 (읽기 전용)
    title,
    activePortfolio,
    patchActivePortfolio: patchActive,
    portfolio,
    principal,
    avgExchangeRate,
    depositHistory,
    depositHistory2,
    history,
    settings,
    portfolioStartDate,
    // 하위 호환 세터
    setTitle,
    setPrincipal,
    setAvgExchangeRate,
    setPortfolio,
    setHistory,
    setDepositHistory,
    setDepositHistory2,
    setSettings,
    setPortfolioStartDate,
    // 공유 상태 + 세터
    portfolios, setPortfolios,
    activePortfolioId, setActivePortfolioId,
    intHistory, setIntHistory,
    depositSortConfig, setDepositSortConfig,
    depositSortConfig2, setDepositSortConfig2,
    customLinks, setCustomLinks,
    overseasLinks, setOverseasLinks,
    dividendLinks, setDividendLinks,
    lookupRows, setLookupRows,
    hiddenColumnsPortfolio, hiddenColumnsRebalancing,
    toggleHiddenColumnPortfolio, toggleHiddenColumnRebalancing,
    markedRebalRows, toggleMarkedRebalRow, resetAllMarkedRebalRows,
    markedPortfolioRows, toggleMarkedPortfolioRow, resetAllMarkedPortfolioRows,
    adminAccessAllowed, setAdminAccessAllowed,
    // 파생 상태
    activePortfolioAccountType,
    // 함수
    buildPortfoliosState,
    addPortfolio,
    deletePortfolio,
    restorePortfolio,
    purgePortfolio,
    switchToPortfolio,
    addSimpleAccount,
    updateSimpleAccountField,
    addMatongAccount,
    updateMatongAccountField,
    updatePortfolioStartDate,
    updatePortfolioName,
    updatePortfolioColor,
    togglePortfolioTest,
    resetAllPortfolioColors,
    updateSettingsForType,
    updatePortfolioMemo,
    movePortfolio,
    handleUpdate,
    handleDeleteStock,
    handleAddStock,
    handleAddFund,
    handleAddSavings,
    updateSavingsField,
    addSavingsDeposit,
    removeSavingsDeposit,
    updateDividendHistory,
    updatePortfolioDividendHistory,
    updatePortfolioActualDividend,
    updatePortfolioDividendTaxRate,
    updatePortfolioDividendSeparateTax,
    updatePortfolioDividendTaxAmount,
    updatePortfolioActualDividendUsd,
    updatePortfolioActualDividendQty,
    updatePortfolioActualAfterTaxUsd,
    updatePortfolioActualAfterTaxKrw,
    addPortfolioExtraRow,
    updatePortfolioExtraRowCode,
    deletePortfolioExtraRow,
    updatePortfolioExtraRowMonth,
    deletePortfolioDividendData,
    deletePortfolioTaxData,
    updateTaxBaseEvents,
    updateTaxBasePurchases,
    updateTaxBaseSales,
    updateTaxBaseExPrice,
    updateTaxBaseAvgPrice,
    toggleHiddenTaxMonth,
    toggleHiddenDividendMonth,
    updateInvestmentNotes,
  };
}
