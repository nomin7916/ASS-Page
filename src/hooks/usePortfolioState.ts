// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { UI_CONFIG } from '../config';
import { generateId, cleanNum } from '../utils';

interface UsePortfolioStateParams {
  marketIndicators: { goldKr?: number; goldKrChg?: number; [key: string]: any };
  showToast: (text: string, isError?: boolean) => void;
  setShowIntegratedDashboard: (v: boolean) => void;
}

export function usePortfolioState({
  marketIndicators,
  showToast,
  setShowIntegratedDashboard,
}: UsePortfolioStateParams) {
  // ── 포트폴리오 핵심 상태 ──
  const [title, setTitle] = useState("주식/ETF 포트폴리오");
  const [portfolio, setPortfolio] = useState([]);
  const [principal, setPrincipal] = useState(UI_CONFIG.DEFAULTS.PRINCIPAL);
  const [depositHistory, setDepositHistory] = useState([]);
  const [depositHistory2, setDepositHistory2] = useState([]);
  const [customLinks, setCustomLinks] = useState(UI_CONFIG.DEFAULT_LINKS);
  const [overseasLinks, setOverseasLinks] = useState(UI_CONFIG.OVERSEAS_DEFAULT_LINKS);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState({ mode: 'rebalance', amount: 1000000 });
  const [lookupRows, setLookupRows] = useState([]);
  const [adminAccessAllowed, setAdminAccessAllowed] = useState(false);
  const [portfolioStartDate, setPortfolioStartDate] = useState(() => {
    const today = new Date();
    today.setFullYear(today.getFullYear() - 1);
    return today.toISOString().split('T')[0];
  });
  const [depositSortConfig, setDepositSortConfig] = useState({ key: null, direction: 1 });
  const [depositSortConfig2, setDepositSortConfig2] = useState({ key: null, direction: 1 });

  // ── 통합 대시보드 ──
  const [portfolios, setPortfolios] = useState([]);
  const [activePortfolioId, setActivePortfolioId] = useState(null);
  const [intHistory, setIntHistory] = useState([]);

  // ── 활성 포트폴리오 계좌 타입 ──
  const activePortfolioAccountType = useMemo(() =>
    portfolios.find(p => p.id === activePortfolioId)?.accountType || 'portfolio',
    [portfolios, activePortfolioId]
  );

  // ── 현재 활성 포트폴리오 state를 portfolios 배열에 반영 ──
  const buildPortfoliosState = () =>
    portfolios.map(p =>
      p.id === activePortfolioId
        ? { ...p, name: title, portfolio, principal, history, depositHistory, depositHistory2, startDate: portfolioStartDate, portfolioStartDate, settings }
        : p
    );

  // ── 포트폴리오 추가 ──
  const addPortfolio = (accountType = 'portfolio') => {
    const updated = portfolios.map(p =>
      p.id === activePortfolioId
        ? { ...p, name: title, portfolio, principal, history, depositHistory, depositHistory2, startDate: portfolioStartDate, portfolioStartDate, settings }
        : p
    );
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
      principal: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: inheritedSettings,
    };
    setPortfolios([...updated, newP]);
    setActivePortfolioId(newId);
    setTitle(newP.name);
    setPortfolio(newP.portfolio);
    setPrincipal(0);
    setHistory([]);
    setDepositHistory([]);
    setDepositHistory2([]);
    setPortfolioStartDate(today);
    setSettings({ mode: 'rebalance', amount: 1000000 });
  };

  // ── 포트폴리오 삭제 ──
  const deletePortfolio = (id) => {
    const isLast = portfolios.length <= 1;
    const confirmMsg = isLast
      ? '마지막 계좌입니다. 삭제하면 새 빈 계좌가 자동으로 생성됩니다. 삭제하시겠습니까?'
      : '이 포트폴리오 계좌를 삭제하시겠습니까?';
    if (!window.confirm(confirmMsg)) return;
    const updated = portfolios.map(p =>
      p.id === activePortfolioId
        ? { ...p, name: title, portfolio, principal, history, depositHistory, depositHistory2, startDate: portfolioStartDate, portfolioStartDate, settings }
        : p
    );
    const remaining = updated.filter(p => p.id !== id);
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
      setTitle(blank.name);
      setPortfolio(blank.portfolio);
      setPrincipal(0);
      setHistory([]);
      setDepositHistory([]);
      setDepositHistory2([]);
      setPortfolioStartDate(today);
      setSettings(blank.settings);
      setShowIntegratedDashboard(false);
      return;
    }
    setPortfolios(remaining);
    if (activePortfolioId === id) {
      const first = remaining[0];
      setActivePortfolioId(first.id);
      setTitle(first.name);
      setPortfolio(first.portfolio || []);
      setPrincipal(first.principal || 0);
      setHistory(first.history || []);
      setDepositHistory(first.depositHistory || []);
      setDepositHistory2(first.depositHistory2 || []);
      setPortfolioStartDate(first.startDate || first.portfolioStartDate || '');
      setSettings(first.settings || { mode: 'rebalance', amount: 1000000 });
    }
  };

  // ── 포트폴리오 탭 전환 ──
  const switchToPortfolio = (id) => {
    const updated = portfolios.map(p =>
      p.id === activePortfolioId
        ? { ...p, name: title, portfolio, principal, history, depositHistory, depositHistory2, startDate: portfolioStartDate, portfolioStartDate, settings }
        : p
    );
    setPortfolios(updated);
    const target = updated.find(p => p.id === id);
    if (!target) return;
    setActivePortfolioId(id);
    setTitle(target.name);
    setPortfolio(target.portfolio || []);
    setPrincipal(target.principal || 0);
    setHistory(target.history || []);
    setDepositHistory(target.depositHistory || []);
    setDepositHistory2(target.depositHistory2 || []);
    setPortfolioStartDate(target.startDate || target.portfolioStartDate || '');
    setSettings(target.settings || { mode: 'rebalance', amount: 1000000 });
    setShowIntegratedDashboard(false);
  };

  // ── 직접입력 계좌 추가 ──
  const addSimpleAccount = () => {
    const updated = portfolios.map(p =>
      p.id === activePortfolioId
        ? { ...p, name: title, portfolio, principal, history, depositHistory, depositHistory2, startDate: portfolioStartDate, portfolioStartDate, settings }
        : p
    );
    const newId = generateId();
    const today = new Date().toISOString().split('T')[0];
    const newP = {
      id: newId, name: '새 계좌', startDate: today, portfolioStartDate: today,
      accountType: 'simple',
      evalAmount: 0,
      portfolio: [], principal: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: { mode: 'rebalance', amount: 1000000 },
    };
    setPortfolios([...updated, newP]);
  };

  // ── 직접입력 계좌 필드 수정 ──
  const updateSimpleAccountField = (id, field, val) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (field === 'evalAmount') {
        const num = cleanNum(val);
        return { ...p, evalAmount: num, ...(!p.principalManual ? { principal: num } : {}) };
      }
      if (field === 'principal') {
        return { ...p, principal: cleanNum(val), principalManual: true };
      }
      return { ...p, [field]: cleanNum(val) };
    }));
  };

  // ── 시작일 변경 ──
  const updatePortfolioStartDate = (id, date) => {
    if (id === activePortfolioId) setPortfolioStartDate(date);
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, startDate: date, portfolioStartDate: date } : p));
  };

  // ── 계좌명 변경 ──
  const updatePortfolioName = (id, name) => {
    if (id === activePortfolioId) setTitle(name);
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
    setSettings(newSettings);
    const activePortfolio = portfolios.find(p => p.id === activePortfolioId);
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

  // ── 분배금 이력 저장 (계좌별, Drive 백업 자동 포함) ──
  const updateDividendHistory = (mergeMap) => {
    // mergeMap: { [code]: { [YYYY-MM]: perShareAmount } }
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
      const codeData = { ...(existing[code] || {}), [yearMonth]: amount };
      return { ...p, actualDividend: { ...existing, [code]: codeData } };
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
      { id: generateId(), type: 'stock', category: "주식", assetClass: 'D', code: "", name: "", currentPrice: 0, changeRate: 0, purchasePrice: 0, quantity: 0, targetRatio: 0, isManual: true },
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
    // 상태 + 세터
    title, setTitle,
    portfolio, setPortfolio,
    principal, setPrincipal,
    depositHistory, setDepositHistory,
    depositHistory2, setDepositHistory2,
    history, setHistory,
    settings, setSettings,
    portfolios, setPortfolios,
    activePortfolioId, setActivePortfolioId,
    intHistory, setIntHistory,
    portfolioStartDate, setPortfolioStartDate,
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
  };
}
