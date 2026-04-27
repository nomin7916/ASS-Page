// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { UI_CONFIG } from '../config';
import { generateId } from '../utils';

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
  };
}
