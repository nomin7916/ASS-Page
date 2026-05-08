// @ts-nocheck
import { fetchIndexData, fetchStockInfo, fetchUsStockInfo, fetchUsStockHistory, fetchNaverStockHistory, fetchKISStockHistory, fetchFundInfo, fetchFundNavHistory, fetchNaverKospi } from '../api';
import { buildIndexStatus, cleanNum } from '../utils';

interface UseStockDataParams {
  portfolio: any[];
  setPortfolio: (fn: any) => void;
  portfolios: any[];
  setPortfolios: (fn: any) => void;
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
  portfoliosRef: React.MutableRefObject<any[]>;
  marketIndicatorsRef: React.MutableRefObject<any>;
  activePortfolioAccountTypeRef: React.MutableRefObject<string>;
  activePortfolioIdRef: React.MutableRefObject<string | null>;
  stockHistoryMapRef: React.MutableRefObject<Record<string, Record<string, number>>>;
  saveStateRef: React.MutableRefObject<any>;
  driveTokenRef: React.MutableRefObject<any>;
  saveAllToDrive: (state: any) => void;
  chartPeriod: string;
  appliedRange: { start: string; end: string };
  setIsLoading: (v: boolean) => void;
  notify: (text: string, type?: string) => void;
  setMarketIndices: (fn: any) => void;
  setIndexFetchStatus: (fn: any) => void;
}

const COMP_STOCK_EXTRA_COLORS = ['#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#64748b', '#e11d48'];

const isKoreanCode = (code: string) => /^\d{6}$/.test(code);

export function useStockData({
  portfolio, setPortfolio,
  portfolios, setPortfolios,
  activePortfolioAccountType,
  stockHistoryMap, setStockHistoryMap,
  stockFetchStatus, setStockFetchStatus,
  compStocks, setCompStocks,
  stockListingDates, setStockListingDates,
  autoFetchedCodes,
  portfolioRef,
  portfoliosRef,
  marketIndicatorsRef,
  activePortfolioAccountTypeRef,
  activePortfolioIdRef,
  stockHistoryMapRef,
  saveStateRef, driveTokenRef, saveAllToDrive,
  chartPeriod, appliedRange,
  setIsLoading, notify,
  setMarketIndices, setIndexFetchStatus,
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
      if (isOverseas && (!stockHistoryMapRef.current[code] || Object.keys(stockHistoryMapRef.current[code]).length <= 1)) {
        notify(`${code} 백테스트 이력 수집 중...`, 'info');
        fetchUsStockHistory(code).then(r => {
          if (r?.data && Object.keys(r.data).length > 1) {
            setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...r.data } }));
          } else {
            notify(`${code} 백테스트 이력 수집 실패`, 'warning');
          }
        });
      }
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
        notify(`${fundCode} 기준가 갱신 실패`, 'error');
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
      notify(`${code} 현재가 갱신 실패`, 'error');
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
    const d = isKoreanCode(code) ? await fetchStockInfo(code) : await fetchUsStockInfo(code);
    const resolvedName = d?.name || code;
    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], name: resolvedName }; return n; });
  };

  const handleToggleComp = async (index) => {
    const comp = compStocks[index];
    if (!comp.code) return;

    if (comp.active) { setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: false }; return n; }); return; }
    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: true }; return n; });
    const isOverseasComp = !isKoreanCode(comp.code);
    let hist = stockHistoryMap[comp.code];
    // 해외: 252건(약 1년) 미만이면 전체 재조회 / 국내: 3건 이상이면 증분 조회
    const hasRichHistory = hist && (isOverseasComp ? Object.keys(hist).length > 252 : Object.keys(hist).length > 3);
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

    const isOverseasFetch = !isKoreanCode(comp.code);
    let hist: Record<string, number> | null = null;

    if (isOverseasFetch) {
      // 캐시 최초 날짜가 startDate 이전이면 증분 수집, 아니면 startDate부터 기간별 전체 수집
      const firstCachedDate = existingSortedDates.length > 0 ? existingSortedDates[0] : null;
      const needsExtension = !firstCachedDate || firstCachedDate > startDate;
      const fromDate = needsExtension ? startDate : (lastCachedDate ?? undefined);
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

  // 단일 fetch에 타임아웃 적용 (ms 초과 시 null 반환)
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p, new Promise<null>(res => setTimeout(() => res(null), ms))]);

  // 전체 계좌 종목 가격을 병렬 조회하여 portfolios[] 전체(활성 계좌 포함) 업데이트
  const fetchAllPortfoliosPrices = async (today: string) => {
    const koreanCodes = new Set<string>();
    const overseasCodes = new Set<string>();
    const fundCodes = new Set<string>();

    portfoliosRef.current.forEach(p => {
      if (p.accountType === 'simple') return;
      const items = p.portfolio || [];
      const isOverseas = p.accountType === 'overseas';
      items.forEach(item => {
        if (item.type === 'stock' && item.code) {
          if (isOverseas) overseasCodes.add(item.code);
          else koreanCodes.add(item.code);
        } else if (item.type === 'fund' && item.code) {
          fundCodes.add(item.code);
        }
      });
    });

    const priceResults: Record<string, any> = {};
    const fundResults: Record<string, any> = {};
    const failedCodes: string[] = [];

    await Promise.all([
      ...[...koreanCodes].map(async (code) => {
        const d = await withTimeout(fetchStockInfo(code), 10000);
        if (d) {
          priceResults[code] = d;
          setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
        } else {
          failedCodes.push(code);
        }
      }),
      ...[...overseasCodes].map(async (code) => {
        const d = await withTimeout(fetchUsStockInfo(code), 10000);
        if (d) {
          priceResults[code] = d;
          setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
        } else {
          failedCodes.push(code);
        }
      }),
      ...[...fundCodes].map(async (code) => {
        const d = await withTimeout(fetchFundInfo(code), 10000);
        if (d) {
          fundResults[code] = d;
          setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
        } else {
          failedCodes.push(code);
        }
      }),
    ]);

    const hasAnyResult = Object.keys(priceResults).length > 0 || Object.keys(fundResults).length > 0;
    if (!hasAnyResult) return { priceResults, fundResults, failedCodes };

    // 전체 계좌 portfolios[] 가격 업데이트 (활성 계좌 포함 — 총자산현황 즉시 반영)
    setPortfolios(prev => prev.map(p => {
      if (p.accountType === 'simple') return p;
      const isActive = p.id === activePortfolioIdRef.current;
      const items = p.portfolio || [];
      const hasUpdate = items.some(item =>
        (item.type === 'stock' && item.code && priceResults[item.code]) ||
        (item.type === 'fund' && item.code && fundResults[item.code])
      );
      if (!hasUpdate) return p;

      const updatedItems = items.map(item => {
        if (item.type === 'stock' && item.code && priceResults[item.code]) {
          const d = priceResults[item.code];
          return { ...item, name: d.name, currentPrice: d.price, changeRate: d.changeRate };
        }
        if (item.type === 'fund' && item.code && fundResults[item.code]) {
          const d = fundResults[item.code];
          return { ...item, currentPrice: d.price, changeRate: d.changeRate };
        }
        return item;
      });

      // 활성 계좌: 히스토리 업데이트 없이 종목 가격만 반영 (히스토리는 메인 흐름에서 처리)
      if (isActive) return { ...p, portfolio: updatedItems };

      const usdkrw = marketIndicatorsRef.current?.usdkrw || 1;
      const fxRate = p.accountType === 'overseas' ? usdkrw : 1;
      let totalEval = 0;
      updatedItems.forEach(item => {
        if (item.type === 'deposit') totalEval += cleanNum(item.depositAmount) * fxRate;
        else if (item.type === 'fund') {
          const qty = cleanNum(item.quantity);
          const price = cleanNum(item.currentPrice);
          totalEval += qty > 0 && price > 0 ? qty * price * fxRate : cleanNum(item.evalAmount) * fxRate;
        } else {
          totalEval += cleanNum(item.currentPrice) * cleanNum(item.quantity) * fxRate;
        }
      });

      if (totalEval <= 0) return { ...p, portfolio: updatedItems };

      const history = p.history || [];
      const idx = history.findIndex(h => h.date === today);
      // 오늘 항목이 이미 있으면 가격만 업데이트, 히스토리는 수정하지 않음
      if (idx >= 0) return { ...p, portfolio: updatedItems };
      // 오늘 항목이 없을 때만 새로 추가
      const newHistory = [...history, { date: today, evalAmount: totalEval, principal: cleanNum(p.principal) || 0, isFixed: false }];
      return { ...p, portfolio: updatedItems, history: newHistory };
    }));

    return { priceResults, fundResults, failedCodes };
  };

  // 초기 로드 후 종목 현재가를 직접 조회하는 함수 (활성 계좌만 — 초기 로드 안전성 보장)
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

    // 해외계좌: 그래프용 과거 데이터 백그라운드 수집 (252건 미만이면 전체 재수집)
    if (isOverseas) {
      const codesNeedingHistory = stocks
        .map(s => s.code)
        .filter(code => {
          const existing = stockHistoryMapRef.current[code];
          return !existing || Object.keys(existing).length <= 252;
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

  const refreshPrices = async () => {
    setIsLoading(true);
    setIndexFetchStatus({
      kospi: { status: 'loading' },
      sp500: { status: 'loading' },
      nasdaq: { status: 'loading' }
    });

    const activeStockCodes = portfolioRef.current.filter(p => p.type === 'stock' && p.code).map(p => p.code);
    const loadingStatus = {};
    activeStockCodes.forEach(c => { loadingStatus[c] = 'loading'; });
    setStockFetchStatus(prev => ({ ...prev, ...loadingStatus }));

    try {
      const today = new Date().toISOString().split('T')[0];
      const isOverseasRefresh = activePortfolioAccountTypeRef.current === 'overseas';

      // 전체 계좌 종목 동시 조회 및 portfolios[] 업데이트 (활성 계좌 포함)
      const { priceResults, fundResults, failedCodes } = await fetchAllPortfoliosPrices(today);
      if (failedCodes.length > 0) notify(`조회 실패 (10초 초과): ${failedCodes.join(', ')}`, 'warning');

      // 활성 계좌 fetch status 업데이트
      activeStockCodes.forEach(code => {
        setStockFetchStatus(prev => ({ ...prev, [code]: priceResults[code] ? 'success' : 'fail' }));
      });

      // 전체 계좌 국내 주식 코드 수집 — 최근 이력 없으면 재수집 (useHistoryBackfill이 모든 계좌 빈 날짜 채우는 데 필요)
      const allKoreanCodes = new Set<string>();
      portfoliosRef.current.forEach(p => {
        if (p.accountType === 'simple' || p.accountType === 'overseas') return;
        (p.portfolio || []).forEach(item => { if (item.type === 'stock' && item.code) allKoreanCodes.add(item.code); });
      });
      const korCodesNeedingHistory = [...allKoreanCodes].filter(code => {
        const existing = stockHistoryMapRef.current[code];
        if (!existing || Object.keys(existing).length <= 3) return true;
        const latestDate = Object.keys(existing).sort().pop() || '';
        return (Date.now() - new Date(latestDate + 'T12:00:00').getTime()) / 86400000 > 1.5;
      });
      const usCodesNeedingHistory = isOverseasRefresh ? activeStockCodes.filter(code => {
        const existing = stockHistoryMapRef.current[code];
        return !existing || Object.keys(existing).length <= 252;
      }) : [];

      if (korCodesNeedingHistory.length > 0 || usCodesNeedingHistory.length > 0) {
        Promise.all([
          ...korCodesNeedingHistory.map(async (code) => {
            let hist: Record<string, number> | null = null;
            const rKIS = await fetchKISStockHistory(code);
            if (rKIS) hist = rKIS.data;
            if (!hist) { const rNaver = await fetchNaverStockHistory(code); if (rNaver) hist = rNaver.data; }
            if (!hist) { const r1 = await fetchIndexData(`${code}.KS`); if (r1) hist = r1.data; }
            if (!hist) { const r2 = await fetchIndexData(`${code}.KQ`); if (r2) hist = r2.data; }
            if (hist) setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...hist } }));
          }),
          ...usCodesNeedingHistory.map(async (code) => {
            const r = await fetchUsStockHistory(code);
            if (r?.data && Object.keys(r.data).length > 1)
              setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...r.data } }));
            else
              notify(`${code} 이력 수집 실패 (백테스트 불가)`, 'warning');
          }),
        ]).then(() => {
          setTimeout(() => {
            const snap = saveStateRef.current;
            if (snap && driveTokenRef.current) saveAllToDrive(snap);
          }, 600);
        });
      }

      // 펀드 기준가 이력 조회 → stockHistoryMap 저장 (useHistoryBackfill 소급 기록에 활용)
      const allFundCodes = new Set<string>();
      portfoliosRef.current.forEach(p => {
        if (p.accountType === 'simple') return;
        const items = p.id === activePortfolioIdRef.current ? portfolioRef.current : (p.portfolio || []);
        items.forEach(item => { if (item.type === 'fund' && item.code) allFundCodes.add(item.code); });
      });
      if (allFundCodes.size > 0) {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const histStartDate = oneYearAgo.toISOString().split('T')[0];
        Promise.all([...allFundCodes].map(async (code) => {
          const existing = stockHistoryMapRef.current[code];
          const existingKeys = existing ? Object.keys(existing) : [];
          if (existingKeys.length > 30 && existingKeys.includes(today)) return;
          const hist = await fetchFundNavHistory(code, histStartDate, today);
          if (hist && Object.keys(hist).length > 0) {
            setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...hist } }));
          }
        })).then(() => {
          setTimeout(() => {
            const snap = saveStateRef.current;
            if (snap && driveTokenRef.current) saveAllToDrive(snap);
          }, 800);
        });
      }

      const [kRes, sRes, nRes] = await Promise.allSettled([
        fetchIndexData('^KS11'),
        fetchIndexData('^GSPC'),
        fetchIndexData('^NDX')
      ]);

      let newK = (kRes.status === 'fulfilled' && kRes.value) ? kRes.value : null;
      let newS = (sRes.status === 'fulfilled' && sRes.value) ? sRes.value : null;
      let newN = (nRes.status === 'fulfilled' && nRes.value) ? nRes.value : null;

      const resolveFailure = (prevData) => {
        const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const hasPrev = prevData && Object.keys(prevData).length > 0;
        if (hasPrev) {
          const st = buildIndexStatus(prevData, '백업데이터');
          st.status = 'partial';
          return { data: prevData, status: st };
        }
        return { data: null, status: { status: 'fail', source: '접속 불가', latestDate: '-', latestValue: 0, count: 0, gapDays: null, updatedAt: now } };
      };

      if (!newK) {
        const naverPrice = await fetchNaverKospi();
        if (naverPrice) {
          newK = { data: { [today]: naverPrice }, source: '네이버(당일) + 백업데이터' };
        }
      }

      setMarketIndices(prev => {
        let kResult, sResult, nResult;

        if (newK) {
          const merged = { ...(prev.kospi || {}), ...newK.data };
          kResult = { data: merged, status: buildIndexStatus(merged, newK.source) };
        } else {
          kResult = resolveFailure(prev.kospi);
        }

        if (newS) {
          const merged = { ...(prev.sp500 || {}), ...newS.data };
          sResult = { data: merged, status: buildIndexStatus(merged, newS.source) };
        } else {
          sResult = resolveFailure(prev.sp500);
        }

        if (newN) {
          const merged = { ...(prev.nasdaq || {}), ...newN.data };
          nResult = { data: merged, status: buildIndexStatus(merged, newN.source) };
        } else {
          nResult = resolveFailure(prev.nasdaq);
        }

        setIndexFetchStatus({ kospi: kResult.status, sp500: sResult.status, nasdaq: nResult.status });

        return {
          kospi: kResult.data || prev.kospi,
          sp500: sResult.data || prev.sp500,
          nasdaq: nResult.data || prev.nasdaq
        };
      });

      notify('종목 가격 갱신 완료', 'success');
    } catch (err) {
      console.error('데이터 갱신 오류:', err);
      notify('가격 갱신 중 오류가 발생했습니다', 'error');
    } finally {
      setIsLoading(false);
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
    refreshPrices,
  };
}
