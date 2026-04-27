// @ts-nocheck
import { fetchIndexData, fetchStockInfo, fetchUsStockInfo, fetchUsStockHistory, fetchNaverStockHistory, fetchKISStockHistory, fetchFundInfo } from '../api';

interface UseStockDataParams {
  portfolio: any[];
  setPortfolio: (fn: any) => void;
  activePortfolioAccountType: string;
  stockHistoryMap: Record<string, Record<string, number>>;
  setStockHistoryMap: (fn: any) => void;
  stockFetchStatus: Record<string, string>;
  setStockFetchStatus: (fn: any) => void;
  compStocks: any[];
  setCompStocks: (fn: any) => void;
  stockListingDates: Record<string, string>;
  setStockListingDates: (fn: any) => void;
  autoFetchedCodes: React.MutableRefObject<Set<string>>;
  portfolioRef: React.MutableRefObject<any[]>;
  activePortfolioAccountTypeRef: React.MutableRefObject<string>;
  stockHistoryMapRef: React.MutableRefObject<Record<string, Record<string, number>>>;
  saveStateRef: React.MutableRefObject<any>;
  driveTokenRef: React.MutableRefObject<any>;
  saveAllToDrive: (state: any) => void;
  chartPeriod: string;
  appliedRange: { start: string; end: string };
  setIsLoading: (v: boolean) => void;
  showToast: (text: string, isError?: boolean) => void;
}

const COMP_STOCK_EXTRA_COLORS = ['#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#64748b', '#e11d48'];

export function useStockData({
  portfolio, setPortfolio,
  activePortfolioAccountType,
  stockHistoryMap, setStockHistoryMap,
  stockFetchStatus, setStockFetchStatus,
  compStocks, setCompStocks,
  stockListingDates, setStockListingDates,
  autoFetchedCodes,
  portfolioRef,
  activePortfolioAccountTypeRef,
  stockHistoryMapRef,
  saveStateRef, driveTokenRef, saveAllToDrive,
  chartPeriod, appliedRange,
  setIsLoading, showToast,
}: UseStockDataParams) {

  const extractFundCode = (input: string): string => {
    const m = input.match(/funetf\.co\.kr\/product\/fund\/view\/([A-Za-z0-9]+)/);
    return m ? m[1] : input.trim();
  };

  const handleStockBlur = async (id, code) => {
    const item = portfolio.find(p => p.id === id);
    if (item?.type === 'fund') {
      if (!code || code.trim().length < 8) return;
      const fundCode = extractFundCode(code);
      if (fundCode !== code.trim()) {
        setPortfolio(prev => prev.map(p => p.id === id ? { ...p, code: fundCode } : p));
      }
      setStockFetchStatus(prev => ({ ...prev, [fundCode]: 'loading' }));
      const d = await fetchFundInfo(fundCode);
      if (d) {
        setPortfolio(prev => prev.map(p => p.id === id ? { ...p, name: d.name, currentPrice: d.price, changeRate: d.changeRate } : p));
        setStockFetchStatus(prev => ({ ...prev, [fundCode]: 'success' }));
      } else {
        setStockFetchStatus(prev => ({ ...prev, [fundCode]: 'fail' }));
      }
      return;
    }
    const isOverseas = activePortfolioAccountType === 'overseas';
    if (!code || (!isOverseas && code.length < 5)) return;
    setStockFetchStatus(prev => ({ ...prev, [code]: 'loading' }));
    const d = isOverseas ? await fetchUsStockInfo(code) : await fetchStockInfo(code);
    if (d) {
      setPortfolio(prev => prev.map(p => p.id === id ? { ...p, name: d.name, currentPrice: d.price, changeRate: d.changeRate } : p));
      setStockFetchStatus(prev => ({ ...prev, [code]: 'success' }));
      const today = new Date().toISOString().split('T')[0];
      setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
    } else {
      setStockFetchStatus(prev => ({ ...prev, [code]: 'fail' }));
    }
  };

  const handleSingleStockRefresh = async (id, code) => {
    const item = portfolio.find(p => p.id === id);
    if (item?.type === 'fund') {
      if (!code || code.trim().length < 8) return;
      const fundCode = extractFundCode(code);
      if (fundCode !== code.trim()) {
        setPortfolio(prev => prev.map(p => p.id === id ? { ...p, code: fundCode } : p));
      }
      setStockFetchStatus(prev => ({ ...prev, [fundCode]: 'loading' }));
      const d = await fetchFundInfo(fundCode);
      if (d) {
        setPortfolio(prev => prev.map(p => p.id === id ? { ...p, name: d.name, currentPrice: d.price, changeRate: d.changeRate } : p));
        setStockFetchStatus(prev => ({ ...prev, [fundCode]: 'success' }));
      } else {
        setStockFetchStatus(prev => ({ ...prev, [fundCode]: 'fail' }));
        showToast(`${fundCode} 기준가 갱신 실패`, true);
      }
      return;
    }
    const isOverseas = activePortfolioAccountType === 'overseas';
    if (!code || (!isOverseas && code.length < 5)) return;
    setStockFetchStatus(prev => ({ ...prev, [code]: 'loading' }));
    const d = isOverseas ? await fetchUsStockInfo(code) : await fetchStockInfo(code);
    if (d) {
      setPortfolio(prev => prev.map(p => p.id === id ? { ...p, name: d.name, currentPrice: d.price, changeRate: d.changeRate } : p));
      setStockFetchStatus(prev => ({ ...prev, [code]: 'success' }));
      const today = new Date().toISOString().split('T')[0];
      setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
    } else {
      setStockFetchStatus(prev => ({ ...prev, [code]: 'fail' }));
      showToast(`${code} 현재가 갱신 실패`, true);
    }
  };

  const handleAddCompStock = () => {
    const nextId = Math.max(...compStocks.map(s => s.id)) + 1;
    const colorIdx = compStocks.length % (COMP_STOCK_EXTRA_COLORS.length + 3);
    const allColors = ['#10b981', '#0ea5e9', '#ec4899', ...COMP_STOCK_EXTRA_COLORS];
    const color = allColors[colorIdx] || COMP_STOCK_EXTRA_COLORS[colorIdx % COMP_STOCK_EXTRA_COLORS.length];
    setCompStocks(prev => [...prev, { id: nextId, code: '', name: `비교종목${nextId}`, active: false, loading: false, color }]);
  };

  const handleRemoveCompStock = (index) => {
    setCompStocks(prev => prev.filter((_, i) => i !== index));
  };

  const handleCompStockBlur = async (index, code) => {
    if (!code) return;
    const isOverseasComp = activePortfolioAccountType === 'overseas';
    if (!isOverseasComp && code.length < 5) return;
    const d = isOverseasComp ? await fetchUsStockInfo(code) : await fetchStockInfo(code);
    if (d) setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], name: d.name }; return n; });
  };

  const handleToggleComp = async (index) => {
    const comp = compStocks[index];
    if (!comp.code) return;

    if (comp.active) { setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: false }; return n; }); return; }
    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: true }; return n; });
    const isOverseasComp = activePortfolioAccountType === 'overseas';
    let hist = stockHistoryMap[comp.code];
    // 단순 현재가 캐시(1~3건)는 무시하고 과거 데이터 재조회
    const hasRichHistory = hist && Object.keys(hist).length > 3;
    if (!hasRichHistory) {
      if (isOverseasComp) {
        // 해외주식: fetchUsStockHistory (Naver worldstock → Yahoo Finance)
        const rUS = await fetchUsStockHistory(comp.code);
        if (rUS) hist = rUS.data;
      } else {
        // 1순위: KIS OpenAPI (상장 이후 전체 데이터, 수정주가 기준)
        const rKIS = await fetchKISStockHistory(comp.code);
        if (rKIS) hist = rKIS.data;
        // 2순위: 네이버 fchart (KIS 실패 시 폴백)
        if (!hist) { const rNaver = await fetchNaverStockHistory(comp.code); if (rNaver) hist = rNaver.data; }
        // 3순위: Yahoo Finance (.KS / .KQ)
        if (!hist) { const r1 = await fetchIndexData(`${comp.code}.KS`); if (r1) hist = r1.data; }
        if (!hist) { const r2 = await fetchIndexData(`${comp.code}.KQ`); if (r2) hist = r2.data; }
      }
      if (hist) {
        setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist }));
        // 과거 데이터 수집 직후 Drive 즉시 백업 (페이지 재시작 시 재수집 방지)
        setTimeout(() => {
          const snap = saveStateRef.current;
          if (snap && driveTokenRef.current) saveAllToDrive(snap);
        }, 600);
      } else {
        const info = isOverseasComp ? await fetchUsStockInfo(comp.code) : await fetchStockInfo(comp.code);
        if (info) {
          const todayStr = new Date().toISOString().split('T')[0];
          hist = { [todayStr]: info.price };
          setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist }));
        } else {
          setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: false }; return n; });
          return;
        }
      }
    } else {
      // 증분 조회: 캐시 최신 날짜 이후 데이터만 조회해서 병합
      const sortedDates = Object.keys(hist).sort();
      const latestDate = sortedDates[sortedDates.length - 1];
      const today = new Date().toISOString().split('T')[0];
      if (latestDate && latestDate < today) {
        let newData: Record<string, number> | null = null;
        if (isOverseasComp) {
          const rUS = await fetchUsStockHistory(comp.code, latestDate);
          if (rUS) newData = rUS.data;
        } else {
          const fromYear = parseInt(latestDate.split('-')[0]);
          const daysDiff = Math.ceil((Date.now() - new Date(latestDate).getTime()) / 86400000);
          const naverCount = Math.ceil(daysDiff * 5 / 7) + 30;
          const rKIS = await fetchKISStockHistory(comp.code, fromYear);
          if (rKIS) newData = rKIS.data;
          if (!newData) { const rNaver = await fetchNaverStockHistory(comp.code, naverCount); if (rNaver) newData = rNaver.data; }
          if (!newData) { const r1 = await fetchIndexData(`${comp.code}.KS`, latestDate); if (r1) newData = r1.data; }
          if (!newData) { const r2 = await fetchIndexData(`${comp.code}.KQ`, latestDate); if (r2) newData = r2.data; }
        }
        if (newData) {
          hist = { ...hist, ...newData };
          setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist }));
          setTimeout(() => {
            const snap = saveStateRef.current;
            if (snap && driveTokenRef.current) saveAllToDrive(snap);
          }, 600);
        }
      }
    }
    // 캐시·API 모두 포함: 2건 이상이면 가장 이른 날짜를 상장일로 저장 (재조회 버튼 억제용)
    if (hist && Object.keys(hist).length > 1) {
      const earliest = Object.keys(hist).sort()[0];
      if (earliest) setStockListingDates(prev => ({ ...prev, [comp.code]: earliest }));
    }
    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: true, loading: false }; return n; });
  };

  // 조회기간 기반으로 비교 종목 데이터를 강제 재조회
  const handleFetchCompHistory = async (index) => {
    const comp = compStocks[index];
    if (!comp.code) return;

    // 조회기간 시작일 계산
    let startDate: string;
    if (appliedRange.start) {
      startDate = appliedRange.start;
    } else {
      const now = new Date();
      const periodDays: Record<string, number> = { '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365, '2y': 730, '3y': 1095, '4y': 1460, '5y': 1825, '10y': 3650 };
      const days = periodDays[chartPeriod] ?? 365;
      now.setDate(now.getDate() - days);
      startDate = now.toISOString().split('T')[0];
    }

    // 기존 캐시 유지: 마지막 날짜 이후만 조회 (캐시 없으면 전체 조회)
    const existingHist = stockHistoryMap[comp.code];
    const existingSortedDates = existingHist ? Object.keys(existingHist).sort() : [];
    const lastCachedDate = existingSortedDates.length > 3 ? existingSortedDates[existingSortedDates.length - 1] : null;

    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: true }; return n; });

    const isOverseasFetch = activePortfolioAccountType === 'overseas';
    let hist: Record<string, number> | null = null;

    if (isOverseasFetch) {
      // 해외주식: fetchUsStockHistory (Naver worldstock → Yahoo Finance)
      const fromDate = lastCachedDate ?? startDate;
      const rUS = await fetchUsStockHistory(comp.code, fromDate);
      if (rUS) hist = rUS.data;
    } else {
      const startYear = lastCachedDate ? parseInt(lastCachedDate.split('-')[0]) : 2000;
      const daysDiff = lastCachedDate ? Math.ceil((Date.now() - new Date(lastCachedDate).getTime()) / 86400000) : null;
      const naverCount = daysDiff ? Math.ceil(daysDiff * 5 / 7) + 30 : 2000;
      const yahooStartDate = lastCachedDate ?? startDate;
      // 1순위: KIS (캐시 있으면 마지막 연도부터, 없으면 2000년부터)
      const rKIS = await fetchKISStockHistory(comp.code, startYear);
      if (rKIS) hist = rKIS.data;
      // 2순위: 네이버 fchart (계산된 count로)
      if (!hist) { const rNaver = await fetchNaverStockHistory(comp.code, naverCount); if (rNaver) hist = rNaver.data; }
      // 3순위: Yahoo (.KS / .KQ, 마지막 캐시 날짜 또는 조회기간 지정)
      if (!hist) { const r1 = await fetchIndexData(`${comp.code}.KS`, yahooStartDate); if (r1) hist = r1.data; }
      if (!hist) { const r2 = await fetchIndexData(`${comp.code}.KQ`, yahooStartDate); if (r2) hist = r2.data; }
    }

    if (hist && Object.keys(hist).length > 1) {
      const mergedHist = existingHist ? { ...existingHist, ...hist } : hist;
      setStockHistoryMap(prev => ({ ...prev, [comp.code]: mergedHist }));
      setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: true, loading: false }; return n; });
      autoFetchedCodes.current.add(comp.code); // 전체 이력 조회 완료 표시
      const earliest = Object.keys(mergedHist).sort()[0];
      if (earliest) setStockListingDates(prev => ({ ...prev, [comp.code]: earliest }));
      // 과거 데이터 수집 직후 Drive 즉시 백업 (페이지 재시작 시 재수집 방지)
      setTimeout(() => {
        const snap = saveStateRef.current;
        if (snap && driveTokenRef.current) saveAllToDrive(snap);
      }, 600);
    } else {
      // 현재가 폴백 (API 실패 시) - 더 이상 재시도 방지
      autoFetchedCodes.current.add(comp.code);
      // 기존 이력이 있으면 단일 포인트로 덮어쓰지 않음 — 이력 손실 방지
      if (existingHist && Object.keys(existingHist).length > 1) {
        setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: true, loading: false }; return n; });
      } else {
        const info = isOverseasFetch ? await fetchUsStockInfo(comp.code) : await fetchStockInfo(comp.code);
        if (info) {
          const todayStr = new Date().toISOString().split('T')[0];
          const fallbackHist = { ...(existingHist || {}), [todayStr]: info.price };
          setStockHistoryMap(prev => ({ ...prev, [comp.code]: fallbackHist }));
          setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: true, loading: false }; return n; });
        } else {
          setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: false }; return n; });
        }
      }
    }
  };

  // 초기 로드 후 종목 현재가를 직접 조회하는 함수 (React 상태 클로저 무관)
  const autoRefreshStockPrices = async (loadedPortfolio, accountType = activePortfolioAccountType) => {
    const stocks = loadedPortfolio.filter(p => p.type === 'stock' && p.code);
    if (stocks.length === 0) return;
    const isOverseas = accountType === 'overseas';

    setIsLoading(true);
    const loadingStatus = {};
    stocks.forEach(p => { loadingStatus[p.code] = 'loading'; });
    setStockFetchStatus(prev => ({ ...prev, ...loadingStatus }));

    const today = new Date().toISOString().split('T')[0];
    const priceResults = {};

    await Promise.all(stocks.map(async (item) => {
      const d = isOverseas ? await fetchUsStockInfo(item.code) : await fetchStockInfo(item.code);
      if (d) {
        setStockFetchStatus(prev => ({ ...prev, [item.code]: 'success' }));
        setStockHistoryMap(prev => ({ ...prev, [item.code]: { ...(prev[item.code] || {}), [today]: d.price } }));
        priceResults[item.code] = d;
      } else {
        setStockFetchStatus(prev => ({ ...prev, [item.code]: 'fail' }));
      }
    }));

    // 함수형 업데이트로 안전하게 portfolio 갱신
    if (Object.keys(priceResults).length > 0) {
      setPortfolio(prev => prev.map(item => {
        if (item.type === 'stock' && item.code && priceResults[item.code]) {
          const d = priceResults[item.code];
          return { ...item, name: d.name, currentPrice: d.price, changeRate: d.changeRate };
        }
        return item;
      }));
    }
    setIsLoading(false);

    // 해외계좌: 그래프용 과거 데이터 백그라운드 수집 (충분한 이력 없는 종목만)
    if (isOverseas) {
      const codesNeedingHistory = stocks
        .map(s => s.code)
        .filter(code => {
          const existing = stockHistoryMap[code];
          return !existing || Object.keys(existing).length <= 3;
        });
      if (codesNeedingHistory.length > 0) {
        Promise.all(codesNeedingHistory.map(async (code) => {
          const r = await fetchUsStockHistory(code);
          if (r?.data && Object.keys(r.data).length > 1) {
            setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...r.data } }));
          }
        })).then(() => {
          setTimeout(() => {
            const snap = saveStateRef.current;
            if (snap && driveTokenRef.current) saveAllToDrive(snap);
          }, 800);
        });
      }
    }
  };

  return {
    handleStockBlur,
    handleSingleStockRefresh,
    handleAddCompStock,
    handleRemoveCompStock,
    handleCompStockBlur,
    handleToggleComp,
    handleFetchCompHistory,
    autoRefreshStockPrices,
  };
}
