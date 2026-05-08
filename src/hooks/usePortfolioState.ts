// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { UI_CONFIG } from '../config';
import { generateId, cleanNum } from '../utils';

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
    };
    setPortfolios(prev => [...prev, newP]);
    setActivePortfolioId(newId);
  };

  // ── 포트폴리오 삭제 ──
  const deletePortfolio = async (id) => {
    const isLast = portfolios.length <= 1;
    const confirmMsg = isLast
      ? '마지막 계좌입니다. 삭제하면 새 빈 계좌가 자동으로 생성됩니다. 삭제하시겠습니까?'
      : '이 포트폴리오 계좌를 삭제하시겠습니까?';
    if (!await confirm(confirmMsg)) return;
    const remaining = portfolios.filter(p => p.id !== id);
    if (remaining.length === 0) {
      const newId = generateId();
      const today = new Date().toISOString().split('T')[0];
      const blank = {
        id: newId, name: '새 계좌', startDate: today, portfolioStartDate: today,
        accountType: 'portfolio',
        portfolio: [{ id: generateId(), type: 'deposit', depositAmount: 0 }],
        principal: 0, history: [], depositHistory: [], depositHistory2: [],
        settings: { mode: 'rebalance', amount: 1000000 },
      };
      setPortfolios([blank]);
      setActivePortfolioId(blank.id);
      setShowIntegratedDashboard(false);
      return;
    }
    setPortfolios(remaining);
    if (activePortfolioId === id) setActivePortfolioId(remaining[0].id);
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
      const num = field === 'agreedRate' ? parseFloat(val) || 0 : cleanNum(val);
      const updated = { ...p, [field]: num };
      const wt = field === 'withdrawableTotal' ? num : (cleanNum(p.withdrawableTotal) || 0);
      const cw = field === 'currentWithdrawal' ? num : (cleanNum(p.currentWithdrawal) || 0);
      const wl = field === 'withdrawalLimit' ? num : (cleanNum(p.withdrawalLimit) || 0);
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
  const updateDividendHistory = (mergeMap) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== activePortfolioId) return p;
      const existing = p.dividendHistory || {};
      const updated = { ...existing };
      Object.entries(mergeMap).forEach(([code, monthData]) => {
        updated[code] = { ...(existing[code] || {}), ...monthData };
      });
      return { ...p, dividendHistory: updated, dividendHistoryUpdatedAt: Date.now() };
    }));
  };

  const updatePortfolioDividendHistory = (portfolioId, mergeMap) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.dividendHistory || {};
      const updated = { ...existing };
      Object.entries(mergeMap).forEach(([code, monthData]) => {
        updated[code] = { ...(existing[code] || {}), ...monthData };
      });
      return { ...p, dividendHistory: updated, dividendHistoryUpdatedAt: Date.now() };
    }));
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

  // ── 포트폴리오 항목 CRUD ──
  const handleUpdate = (id, field, value) =>
    setPortfolio(prev => prev.map(p =>
      p.id === id ? { ...p, [field]: ['category', 'name', 'code', 'assetClass', 'rowColor'].includes(field) ? value : cleanNum(value) } : p
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

  return {
    // 파생 상태 (읽기 전용)
    title,
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
    lookupRows, setLookupRows,
    adminAccessAllowed, setAdminAccessAllowed,
    // 파생 상태
    activePortfolioAccountType,
    // 함수
    buildPortfoliosState,
    addPortfolio,
    deletePortfolio,
    switchToPortfolio,
    addSimpleAccount,
    updateSimpleAccountField,
    addMatongAccount,
    updateMatongAccountField,
    updatePortfolioStartDate,
    updatePortfolioName,
    updatePortfolioColor,
    resetAllPortfolioColors,
    updateSettingsForType,
    updatePortfolioMemo,
    movePortfolio,
    handleUpdate,
    handleDeleteStock,
    handleAddStock,
    handleAddFund,
    updateDividendHistory,
    updatePortfolioDividendHistory,
    updatePortfolioActualDividend,
    updatePortfolioDividendTaxRate,
    updatePortfolioDividendSeparateTax,
    updatePortfolioDividendTaxAmount,
    updatePortfolioActualDividendUsd,
    updatePortfolioActualAfterTaxUsd,
    updatePortfolioActualAfterTaxKrw,
    addPortfolioExtraRow,
    updatePortfolioExtraRowCode,
    deletePortfolioExtraRow,
    updatePortfolioExtraRowMonth,
  };
}
