// @ts-nocheck
import { useEffect, useRef } from 'react';
import { fetchIndexData, fetchStockInfo, fetchUsStockInfo, fetchUsStockHistory, fetchNaverDomesticHistory, fetchNaverStockHistory, fetchKISStockHistory, fetchFundInfo, fetchFundNavHistory, fetchMiraeFundInfo, fetchMiraeFundNavHistory, fetchNaverKospi } from '../api';
import { buildIndexStatus, cleanNum, isWeekend } from '../utils';
import { getEffectiveDate, getMsUntilCutoff } from './useMarketCalendar';

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

  // 펀드 전체이력(상장일~) 광역 조회를 앱 로드당 코드별 1회로 제한 —
  // 가입일이 상장일보다 이르면 earliestStored가 영원히 미충족이라 매 새로고침
  // 재조회되는 것을 방지. 새로고침(페이지 리로드) 시 ref 초기화 → 1회 재검증.
  const fundWideFetchedRef = useRef<Set<string>>(new Set());
  // 세션당 1회 trend API 재조회 추적 — Drive 캐시가 오늘 날짜로 최신이어도
  // 수정주가→실제종가 전환 시 반드시 1회 trend API 재조회가 필요함
  const trendMigratedInSession = useRef<Set<string>>(new Set());

  const extractFundCode = (input: string): string => {
    const trimmed = input.trim();
    // 미래에셋 URL: childFundCd 우선, 없으면 fundCd
    if (/investments\.miraeasset\.com/i.test(trimmed)) {
      const child = trimmed.match(/[?&]childFundCd=([A-Za-z0-9]+)/i);
      if (child) return `MA:${child[1].toUpperCase()}`;
      const fund = trimmed.match(/[?&]fundCd=([A-Za-z0-9]+)/i);
      if (fund) return `MA:${fund[1].toUpperCase()}`;
    }
    // funetf URL
    const m = trimmed.match(/funetf\.co\.kr\/product\/fund\/view\/([A-Za-z0-9]+)/);
    if (m) return m[1].toUpperCase();
    // MA: 접두어 직접 입력
    if (/^MA:/i.test(trimmed)) return `MA:${trimmed.slice(3).toUpperCase()}`;
    // 5~7자 코드: 미래에셋 펀드코드 (funetf는 항상 8자 이상)
    if (/^[A-Za-z0-9]{5,7}$/.test(trimmed)) return `MA:${trimmed.toUpperCase()}`;
    // 8자 이상: funetf 코드
    return trimmed.toUpperCase();
  };

  const handleStockBlur = async (id, code) => {
    const item = portfolio.find(p => p.id === id);
    if (item?.type === 'fund') {
      if (!code) return;
      const fundCode = extractFundCode(code);
      const isMirae = fundCode.startsWith('MA:');
      const rawFundCode = isMirae ? fundCode.replace('MA:', '') : fundCode;
      if (isMirae ? rawFundCode.length < 5 : fundCode.length < 8) return;
      if (fundCode !== code.trim()) {
        setPortfolio(prev => prev.map(p => p.id === id ? { ...p, code: fundCode } : p));
      }
      setStockFetchStatus(prev => ({ ...prev, [fundCode]: 'loading' }));
      const d = isMirae ? await fetchMiraeFundInfo(fundCode) : await fetchFundInfo(fundCode);
      if (d) {
        const blurToday = new Date().toISOString().split('T')[0];
        const navD = isMirae ? (d as any).navDate : null;
        const histPrice = (isMirae && navD && navD < blurToday)
          ? (stockHistoryMapRef.current[fundCode]?.[blurToday] || 0) : 0;
        const price = histPrice || d.price;
        const changeAmt = histPrice ? +(histPrice - d.price).toFixed(2) : ((d as any).changeAmount ?? 0);
        const changeRt = (histPrice && d.price > 0) ? +((changeAmt / d.price) * 100).toFixed(2) : d.changeRate;
        setPortfolio(prev => prev.map(p => p.id === id ? {
          ...p,
          name: d.name || p.name,
          currentPrice: price,
          changeRate: changeRt,
          ...(isMirae ? {
            changeAmount: changeAmt,
            navDate: histPrice ? blurToday : navD,
            prevNavDate: histPrice ? navD : (d as any).prevNavDate,
            prevNavPrice: histPrice ? d.price : (d as any).prevNavPrice,
          } : {}),
        } : p));
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
      if (!code) return;
      const fundCode = extractFundCode(code);
      const isMirae = fundCode.startsWith('MA:');
      const rawFundCode = isMirae ? fundCode.replace('MA:', '') : fundCode;
      if (isMirae ? rawFundCode.length < 5 : fundCode.length < 8) return;
      if (fundCode !== code.trim()) {
        setPortfolio(prev => prev.map(p => p.id === id ? { ...p, code: fundCode } : p));
      }
      setStockFetchStatus(prev => ({ ...prev, [fundCode]: 'loading' }));
      const d = isMirae ? await fetchMiraeFundInfo(fundCode) : await fetchFundInfo(fundCode);
      if (d) {
        const refreshToday = new Date().toISOString().split('T')[0];
        const navD = isMirae ? (d as any).navDate : null;
        const histPrice = (isMirae && navD && navD < refreshToday)
          ? (stockHistoryMapRef.current[fundCode]?.[refreshToday] || 0) : 0;
        const price = histPrice || d.price;
        const changeAmt = histPrice ? +(histPrice - d.price).toFixed(2) : ((d as any).changeAmount ?? 0);
        const changeRt = (histPrice && d.price > 0) ? +((changeAmt / d.price) * 100).toFixed(2) : d.changeRate;
        setPortfolio(prev => prev.map(p => p.id === id ? {
          ...p,
          name: d.name || p.name,
          currentPrice: price,
          changeRate: changeRt,
          ...(isMirae ? {
            changeAmount: changeAmt,
            navDate: histPrice ? refreshToday : navD,
            prevNavDate: histPrice ? navD : (d as any).prevNavDate,
            prevNavPrice: histPrice ? d.price : (d as any).prevNavPrice,
          } : {}),
        } : p));
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
    // 포트폴리오에 같은 코드가 있으면 저장된 종목명 재사용 (API 호출 불필요)
    let resolvedName: string | null = null;
    for (const p of portfoliosRef.current) {
      const match = (p.portfolio || []).find((item: any) => item.code === code && item.name);
      if (match) { resolvedName = match.name; break; }
    }
    if (!resolvedName) {
      // 6자리 순수 숫자 또는 6자리 영숫자 혼합(한국 ETF 코드) → 한국 API
      const isKorean = /^[A-Z0-9]{6}$/i.test(code) && !/^[A-Z]+$/.test(code);
      const d = isKorean ? await fetchStockInfo(code) : await fetchUsStockInfo(code);
      resolvedName = d?.name || code;
    }
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
    // 국내 비교종목 미이전: 캐시 풍부해도 전체 재조회 강제 (수정주가 → 실제종가)
    const compNeedsMigration = !isOverseasComp && !trendMigratedInSession.current.has(comp.code);
    if (!hasRichHistory || compNeedsMigration) {
      if (isOverseasComp) {
        // 해외주식: fetchUsStockHistory (Naver worldstock → Yahoo Finance)
        const rUS = await fetchUsStockHistory(comp.code);
        if (rUS) hist = rUS.data;
      } else {
        // 1순위: Naver trend API (실제 종가, 수정주가 미반영)
        const rTrend = await fetchNaverDomesticHistory(comp.code);
        if (rTrend) { hist = rTrend.data; trendMigratedInSession.current.add(comp.code); }
        console.log(`[history] ${comp.code} 비교종목 trend API ${rTrend ? `성공 ${Object.keys(rTrend.data).length}건` : '실패 → fallback'}`);
        // trend가 sparse한 경우(예: KODEX 200TR ~300건) fchart로 과거 gap 보강 — trend 값이 우선
        if (hist) {
          const rSup = await fetchNaverStockHistory(comp.code);
          if (rSup) {
            const trendHist = hist;
            hist = { ...rSup.data, ...trendHist };
            const added = Object.keys(rSup.data).filter(d => trendHist[d] === undefined).length;
            if (added > 0) console.log(`[history] ${comp.code} 비교종목 fchart 보강: +${added}건`);
          }
        }
        // 2순위: KIS OpenAPI (trend 실패 시 폴백)
        if (!hist) { const rKIS = await fetchKISStockHistory(comp.code); if (rKIS) hist = rKIS.data; }
        // 3순위: 네이버 fchart
        if (!hist) { const rNaver = await fetchNaverStockHistory(comp.code); if (rNaver) hist = rNaver.data; }
        // 4순위: Yahoo Finance (.KS / .KQ)
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
          // 미이전 코드: latestDate 무시하고 전체 재조회 (수정주가 캐시 교체)
          const incNeedsMigration = !trendMigratedInSession.current.has(comp.code);
          const rTrend = await fetchNaverDomesticHistory(comp.code, incNeedsMigration ? undefined : latestDate);
          if (rTrend) { newData = rTrend.data; trendMigratedInSession.current.add(comp.code); }
          if (!newData) { const rKIS = await fetchKISStockHistory(comp.code, fromYear); if (rKIS) newData = rKIS.data; }
          if (!newData) { const rNaver = await fetchNaverStockHistory(comp.code, naverCount); if (rNaver) newData = rNaver.data; }
          if (!newData) { const r1 = await fetchIndexData(`${comp.code}.KS`, latestDate); if (r1) newData = r1.data; }
          if (!newData) { const r2 = await fetchIndexData(`${comp.code}.KQ`, latestDate); if (r2) newData = r2.data; }
        }
        if (newData) {
          // 미이전이면 REPLACE(수정주가 제거), 아니면 MERGE(증분)
          hist = trendMigratedInSession.current.has(comp.code) && !isOverseasComp
            ? newData
            : { ...hist, ...newData };
          // 국내 종목 sparse 캐시(< 1500) 보강: 과거 gap을 fchart 풀카운트로 채움 — trend 값 우선
          if (!isOverseasComp && Object.keys(hist).length < 1500) {
            const rSup = await fetchNaverStockHistory(comp.code);
            if (rSup) {
              const trendHist = hist;
              hist = { ...rSup.data, ...trendHist };
              const added = Object.keys(rSup.data).filter(d => trendHist[d] === undefined).length;
              if (added > 0) console.log(`[history] ${comp.code} 증분경로 fchart 보강: +${added}건`);
            }
          }
          setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist }));
          setTimeout(() => {
            const snap = saveStateRef.current;
            if (snap && driveTokenRef.current) saveAllToDrive(snap);
          }, 600);
        } else if (!isOverseasComp && Object.keys(hist).length < 1500) {
          // 증분 API 모두 실패해도, 캐시가 sparse면 fchart로 과거 gap만 보강 시도
          const rSup = await fetchNaverStockHistory(comp.code);
          if (rSup) {
            const existing = hist;
            hist = { ...rSup.data, ...existing };
            const added = Object.keys(rSup.data).filter(d => existing[d] === undefined).length;
            if (added > 0) {
              console.log(`[history] ${comp.code} 증분경로 fchart 보강(폴백): +${added}건`);
              setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist }));
              setTimeout(() => {
                const snap = saveStateRef.current;
                if (snap && driveTokenRef.current) saveAllToDrive(snap);
              }, 600);
            }
          }
        }
      } else if (!isOverseasComp && Object.keys(hist).length < 1500) {
        // 캐시 최신(latestDate==today)이지만 sparse한 경우: fchart 과거 gap 보강
        const rSup = await fetchNaverStockHistory(comp.code);
        if (rSup) {
          const existing = hist;
          hist = { ...rSup.data, ...existing };
          const added = Object.keys(rSup.data).filter(d => existing[d] === undefined).length;
          if (added > 0) {
            console.log(`[history] ${comp.code} 증분경로 fchart 보강(최신캐시): +${added}건`);
            setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist }));
            setTimeout(() => {
              const snap = saveStateRef.current;
              if (snap && driveTokenRef.current) saveAllToDrive(snap);
            }, 600);
          }
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
      const periodDays: Record<string, number> = { '1w': 7, '1m': 30, '2m': 60, '3m': 90, '6m': 180, '1y': 365, '2y': 730, '3y': 1095, '4y': 1460, '5y': 1825, '10y': 3650 };
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
      // 1순위: Naver trend API (실제 종가, 수정주가 미반영)
      const rTrend = await fetchNaverDomesticHistory(comp.code, lastCachedDate ?? undefined);
      if (rTrend) hist = rTrend.data;
      // trend가 sparse한 경우 fchart로 과거 gap 보강 — trend 값이 우선.
      // naverCount는 증분용(lastCachedDate 이후 일수)이라 작을 수 있어 풀카운트(2000) 사용.
      if (hist) {
        const rSup = await fetchNaverStockHistory(comp.code);
        if (rSup) {
          const trendHist = hist;
          hist = { ...rSup.data, ...trendHist };
          const added = Object.keys(rSup.data).filter(d => trendHist[d] === undefined).length;
          if (added > 0) console.log(`[history] ${comp.code} 조회기간 fchart 보강: +${added}건`);
        }
      }
      // 2순위: KIS (trend 실패 시 폴백)
      if (!hist) { const rKIS = await fetchKISStockHistory(comp.code, startYear); if (rKIS) hist = rKIS.data; }
      // 3순위: 네이버 fchart
      if (!hist) { const rNaver = await fetchNaverStockHistory(comp.code, naverCount); if (rNaver) hist = rNaver.data; }
      // 4순위: Yahoo (.KS / .KQ)
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

  // 비교종목 이력 강제 재조회 — 기존 캐시 완전 교체 (수정주가 제거용)
  const handleForceRefetchComp = async (index) => {
    const comp = compStocks[index];
    if (!comp.code) return;

    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: true }; return n; });

    // 캐시 무효화 (세션 마이그레이션 상태 포함)
    trendMigratedInSession.current.delete(comp.code);
    autoFetchedCodes.current.delete(comp.code);

    const isOverseasComp = !isKoreanCode(comp.code);
    let hist: Record<string, number> | null = null;

    if (isOverseasComp) {
      const rUS = await fetchUsStockHistory(comp.code);
      if (rUS) hist = rUS.data;
    } else {
      const rTrend = await fetchNaverDomesticHistory(comp.code);
      if (rTrend) { hist = rTrend.data; trendMigratedInSession.current.add(comp.code); }
      console.log(`[history] ${comp.code} 강제재조회 trend ${rTrend ? `성공 ${Object.keys(rTrend.data).length}건` : '실패 → fallback'}`);
      // trend가 sparse한 경우 fchart로 과거 gap 보강 — trend 값이 우선
      if (hist) {
        const rSup = await fetchNaverStockHistory(comp.code);
        if (rSup) {
          const trendHist = hist;
          hist = { ...rSup.data, ...trendHist };
          const added = Object.keys(rSup.data).filter(d => trendHist[d] === undefined).length;
          if (added > 0) console.log(`[history] ${comp.code} 강제재조회 fchart 보강: +${added}건`);
        }
      }
      if (!hist) { const rKIS = await fetchKISStockHistory(comp.code); if (rKIS) hist = rKIS.data; }
      if (!hist) { const rNaver = await fetchNaverStockHistory(comp.code); if (rNaver) hist = rNaver.data; }
      if (!hist) { const r1 = await fetchIndexData(`${comp.code}.KS`); if (r1) hist = r1.data; }
      if (!hist) { const r2 = await fetchIndexData(`${comp.code}.KQ`); if (r2) hist = r2.data; }
    }

    if (hist && Object.keys(hist).length > 1) {
      // 기존 캐시 완전 교체
      setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist }));
      const earliest = Object.keys(hist).sort()[0];
      setStockListingDates(prev => { const n = { ...prev }; if (earliest) n[comp.code] = earliest; else delete n[comp.code]; return n; });
      autoFetchedCodes.current.add(comp.code);
      setTimeout(() => {
        const snap = saveStateRef.current;
        if (snap && driveTokenRef.current) saveAllToDrive(snap);
      }, 600);
      setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: false, active: true }; return n; });
    } else {
      setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: false }; return n; });
    }
  };

  // 단일 fetch에 타임아웃 적용 (ms 초과 시 null 반환)
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p, new Promise<null>(res => setTimeout(() => res(null), ms))]);

  // 배열의 비동기 작업을 동시 limit개씩 처리 (rate limit 폭주 방지).
  // 결과는 입력 순서와 동일한 인덱스로 반환.
  const runWithConcurrency = async <T>(
    tasks: Array<() => Promise<T>>,
    limit: number,
  ): Promise<T[]> => {
    const results: T[] = new Array(tasks.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        results[i] = await tasks[i]();
      }
    });
    await Promise.all(workers);
    return results;
  };

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
        const isMirae = code.startsWith('MA:');
        const d = await withTimeout(isMirae ? fetchMiraeFundInfo(code) : fetchFundInfo(code), 10000);
        if (d) {
          // 라이브 기준가는 포트폴리오 currentPrice 갱신에만 사용.
          // stockHistoryMap에는 stamp 금지 — today가 비거래일(주말/휴일)이면
          // 미래 날짜 키가 생겨 과거 일자 검증이 깨진다. 펀드 이력은
          // fetchFundNavHistory의 실제 거래일 NAV만 저장하고, 비거래일은
          // getClosestValue 역탐색이 직전 거래일가를 자동 반영한다.
          const navD = isMirae ? (d as any).navDate : null;
          const histPrice = (isMirae && navD && navD < today)
            ? (stockHistoryMapRef.current[code]?.[today] || 0) : 0;
          if (histPrice) {
            const changeAmt = +(histPrice - d.price).toFixed(2);
            const changeRt = d.price > 0 ? +((changeAmt / d.price) * 100).toFixed(2) : 0;
            fundResults[code] = { ...d, price: histPrice, changeRate: changeRt, changeAmount: changeAmt, navDate: today, prevNavDate: navD, prevNavPrice: d.price };
          } else {
            fundResults[code] = d;
          }
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
          const extra = item.code.startsWith('MA:') ? {
            ...(d.changeAmount !== undefined ? { changeAmount: d.changeAmount } : {}),
            ...(d.navDate ? { navDate: d.navDate } : {}),
            ...(d.prevNavDate ? { prevNavDate: d.prevNavDate } : {}),
            ...(d.prevNavPrice !== undefined ? { prevNavPrice: d.prevNavPrice } : {}),
          } : {};
          return { ...item, currentPrice: d.price, changeRate: d.changeRate, ...extra };
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

      // 07:30 이후이고 MA: 펀드 종목이 있으면 → 전날 종가 날짜로 히스토리 기록 (overwrite)
      const now = new Date();
      const isAfter0730 = now.getHours() > 7 || (now.getHours() === 7 && now.getMinutes() >= 30);
      if (isAfter0730) {
        const maFunds = updatedItems.filter(i => i.type === 'fund' && i.code?.startsWith('MA:'));
        if (maFunds.length > 0) {
          const sample = maFunds[0];
          let targetDate = null;
          let targetEval = totalEval;

          if (sample.navDate && sample.navDate < today) {
            // 07:30에 rows[0] = 전날 종가 (오늘 기준가 미발표)
            targetDate = sample.navDate;
          } else if (sample.navDate === today && sample.prevNavDate && sample.prevNavDate < today) {
            // 오늘 기준가가 이미 발표된 경우: rows[1] = 전날 종가, prevNavPrice 사용
            targetDate = sample.prevNavDate;
            targetEval = 0;
            updatedItems.forEach(item => {
              if (item.type === 'deposit') {
                targetEval += cleanNum(item.depositAmount) * fxRate;
              } else if (item.type === 'fund') {
                const qty = cleanNum(item.quantity);
                const price = (item.code?.startsWith('MA:') && item.prevNavPrice != null)
                  ? item.prevNavPrice
                  : cleanNum(item.currentPrice);
                targetEval += qty > 0 && price > 0 ? qty * price * fxRate : cleanNum(item.evalAmount) * fxRate;
              } else {
                targetEval += cleanNum(item.currentPrice) * cleanNum(item.quantity) * fxRate;
              }
            });
          }

          if (targetDate && targetEval > 0) {
            const tIdx = history.findIndex(h => h.date === targetDate);
            if (tIdx >= 0) {
              if (Math.abs(history[tIdx].evalAmount - targetEval) < 1) return { ...p, portfolio: updatedItems };
              const updated = history.map((h, i) => {
                if (i !== tIdx) return h;
                const next = { ...h, evalAmount: targetEval };
                if (!h.principalManual) next.principal = cleanNum(p.principal) || 0;
                return next;
              });
              return { ...p, portfolio: updatedItems, history: updated };
            }
            return { ...p, portfolio: updatedItems, history: [...history, { date: targetDate, evalAmount: targetEval, principal: cleanNum(p.principal) || 0, isFixed: false }] };
          }
        }
      }

      // 기존 동작: 오늘 항목이 없을 때만 추가
      const idx = history.findIndex(h => h.date === today);
      if (idx >= 0) return { ...p, portfolio: updatedItems };
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

  // options.force=true: 모든 필터(세션 마이그레이션 플래그·캐시 신선도) 무시하고
  // 전 계좌 모든 종목의 과거 이력을 KIS/Naver/NAV API로 무조건 다시 조회.
  // 이벤트 핸들러로 전달돼도 안전(MouseEvent에 force 프로퍼티 없음).
  const refreshPrices = async (options?: { force?: boolean } | any) => {
    const force = options && typeof options === 'object' && options.force === true;
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
      const today = getEffectiveDate();
      const isOverseasRefresh = activePortfolioAccountTypeRef.current === 'overseas';

      // 전체 계좌 종목 동시 조회 및 portfolios[] 업데이트 (활성 계좌 포함)
      const { priceResults, fundResults, failedCodes } = await fetchAllPortfoliosPrices(today);
      if (failedCodes.length > 0) notify(`조회 실패 (10초 초과): ${failedCodes.join(', ')}`, 'warning');

      // 활성 계좌 fetch status 업데이트
      activeStockCodes.forEach(code => {
        setStockFetchStatus(prev => ({ ...prev, [code]: priceResults[code] ? 'success' : 'fail' }));
      });
      const activeFundCodes = portfolioRef.current.filter(p => p.type === 'fund' && p.code).map(p => p.code);
      activeFundCodes.forEach(code => {
        setStockFetchStatus(prev => ({ ...prev, [code]: fundResults[code] ? 'success' : 'fail' }));
      });

      // 전체 계좌 국내 주식 코드 수집 — 최근 이력 없으면 재수집 (useHistoryBackfill이 모든 계좌 빈 날짜 채우는 데 필요)
      // 현재 보유 + 과거 보유(holdingSnapshots) 합집합 — 매도 후 portfolio에서 사라진 종목도 자산검증용 종가가 필요.
      const allKoreanCodes = new Set<string>();
      portfoliosRef.current.forEach(p => {
        if (p.accountType === 'simple' || p.accountType === 'overseas') return;
        (p.portfolio || []).forEach(item => { if (item.type === 'stock' && item.code) allKoreanCodes.add(item.code); });
        (p.holdingSnapshots || []).forEach((s: any) => (s.items || []).forEach((it: any) => {
          if (it.type === 'stock' && it.code && /^\d{6}$/.test(it.code)) allKoreanCodes.add(it.code);
        }));
      });
      // 활성 비교종목(국내 6자리) 도 포함 — Drive 캐시의 수정주가를 실제종가로 교체
      compStocks.filter(s => s.active && s.code && /^\d{6}$/.test(s.code)).forEach(s => allKoreanCodes.add(s.code));
      const korCodesNeedingHistory = [...allKoreanCodes].filter(code => {
        // force: 모든 필터 우회, 무조건 KIS·Naver trend 재조회
        if (force) return true;
        // 세션 첫 갱신: trend API 미조회 코드는 캐시 신선도 무관 강제 재조회
        // (Drive에 수정주가가 캐시된 경우 실제종가로 교체)
        if (!trendMigratedInSession.current.has(code)) return true;
        const existing = stockHistoryMapRef.current[code];
        if (!existing || Object.keys(existing).length <= 3) return true;
        const latestDate = Object.keys(existing).sort().pop() || '';
        return (Date.now() - new Date(latestDate + 'T12:00:00').getTime()) / 86400000 > 0.5;
      });
      const usCodesNeedingHistory = isOverseasRefresh ? activeStockCodes.filter(code => {
        if (force) return true;
        const existing = stockHistoryMapRef.current[code];
        return !existing || Object.keys(existing).length <= 252;
      }) : [];

      if (force) {
        const fundCount = portfoliosRef.current.reduce((n, p) => {
          if (p.accountType === 'simple') return n;
          return n + (p.portfolio || []).filter((it: any) => it.type === 'fund' && it.code).length;
        }, 0);
        notify(`🔄 전체 강제 재수집 시작 — 국내 ${korCodesNeedingHistory.length} · 해외 ${usCodesNeedingHistory.length} · 펀드 ${fundCount}`, 'info');
      }

      if (korCodesNeedingHistory.length > 0 || usCodesNeedingHistory.length > 0) {
        const korFailed: string[] = [];
        const korTasks = korCodesNeedingHistory.map(code => async () => {
          let hist: Record<string, number> | null = null;
          let fromRealPrice = false;
          // 1순위: KIS 실제종가 (FID_ORG_ADJ_PRC=1, 수정주가 미반영)
          const rKIS = await fetchKISStockHistory(code);
          if (rKIS) {
            hist = rKIS.data;
            fromRealPrice = true;
            const dates = Object.keys(rKIS.data).sort();
            // 부분 응답(청크 일부만 성공) 가드: 100건 미만이면 마이그 플래그 보류 → 다음 갱신에서 재시도 허용.
            // KIS는 13청크 × ~50거래일 = 정상 시 600~6000건. 100건 미만 = rate limit으로 대부분 청크 실패한 상태.
            if (dates.length >= 100) trendMigratedInSession.current.add(code);
            console.log(`[history] ${code} KIS 성공: ${dates.length}건${dates.length < 100 ? ' (부분 응답 — 재시도 대기)' : ''}, 최초=${dates[0]}, 최근=${dates[dates.length-1]}`);
          } else {
            console.warn(`[history] ${code} KIS 실패 → Naver trend 폴백`);
          }
          // 2순위: Naver trend (실제종가, 수정주가 미반영)
          if (!hist) {
            const rTrend = await fetchNaverDomesticHistory(code);
            if (rTrend) {
              hist = rTrend.data;
              fromRealPrice = true;
              const dates = Object.keys(rTrend.data).sort();
              if (dates.length >= 100) trendMigratedInSession.current.add(code);
              console.log(`[history] ${code} Naver trend 폴백 성공: ${dates.length}건${dates.length < 100 ? ' (부분 응답 — 재시도 대기)' : ''}, 최초=${dates[0]}, 최근=${dates[dates.length-1]}`);
            } else {
              console.warn(`[history] ${code} Naver trend 실패 → fchart 폴백`);
            }
          }
          if (!hist) { const rNaver = await fetchNaverStockHistory(code); if (rNaver) { hist = rNaver.data; console.log(`[history] ${code} fchart 폴백 성공`); } }
          if (!hist) { const r1 = await fetchIndexData(`${code}.KS`); if (r1) hist = r1.data; }
          if (!hist) { const r2 = await fetchIndexData(`${code}.KQ`); if (r2) hist = r2.data; }
          // KIS/Naver trend sparse 응답 보강: 1500건 미만이면 fchart로 gap-fill.
          // trend는 자연한계 ~300건, KIS 부분 응답은 <100건 — 둘 다 풀히스토리 못 채우므로
          // 임계값을 fchart 한도(2000) 아래까지 상향. 실제종가(KIS/trend) 값은 보존하고
          // 응답에 없는 날짜만 fchart 수정종가로 채움 — 차트·자산검증 풀히스토리 보장.
          if (hist && fromRealPrice && Object.keys(hist).length < 1500) {
            const rSup = await fetchNaverStockHistory(code);
            if (rSup) {
              const supData = rSup.data;
              let added = 0;
              for (const [d, price] of Object.entries(supData)) {
                if (hist[d] === undefined) { hist[d] = price as number; added++; }
              }
              if (added > 0) console.log(`[history] ${code} fchart 보강 성공: +${added}건`);
            }
          }
          if (hist) {
            if (fromRealPrice) {
              // KIS/Naver trend는 실제종가. 응답에 포함된 날짜만 갱신하고
              // 응답에 없는 날짜는 기존 캐시 보존 — KIS 청크 부분 실패 시 데이터 손실 방지.
              setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...hist! } }));
            } else {
              // fchart/Yahoo는 수정종가 위험 — 기존 값은 절대 덮어쓰지 않고
              // 캐시에 없는 날짜(gap)만 채움.
              setStockHistoryMap(prev => {
                const existing = prev[code] || {};
                const filled = { ...existing };
                for (const [d, price] of Object.entries(hist!)) {
                  if (existing[d] === undefined) filled[d] = price;
                }
                return { ...prev, [code]: filled };
              });
            }
          } else {
            korFailed.push(code);
          }
        });

        // KIS는 앱키당 초당 20건 제한. 코드별 함수가 각각 13청크를 sequential로 호출하므로
        // 동시 4개 인스턴스 = 평균 4~8건/초 → rate limit 폭주를 사전 차단.
        // force=true 시 전 계좌 모든 종목이 대상이라 직렬화가 특히 중요.
        const KIS_CONCURRENCY = force ? 4 : 8;
        Promise.all([
          runWithConcurrency(korTasks, KIS_CONCURRENCY),
          ...usCodesNeedingHistory.map(async (code) => {
            const r = await fetchUsStockHistory(code);
            if (r?.data && Object.keys(r.data).length > 1)
              setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...r.data } }));
            else
              notify(`${code} 이력 수집 실패 (백테스트 불가)`, 'warning');
          }),
        ]).then(() => {
          if (force && korFailed.length > 0) {
            notify(`⚠️ 과거 종가 수집 실패 ${korFailed.length}건: ${korFailed.join(', ')} — 잠시 후 다시 시도하세요`, 'error');
          } else if (force) {
            notify(`✅ 과거 종가 수집 완료 — 국내 ${korCodesNeedingHistory.length} · 해외 ${usCodesNeedingHistory.length}`, 'success');
          }
          setTimeout(() => {
            const snap = saveStateRef.current;
            if (snap && driveTokenRef.current) saveAllToDrive(snap);
          }, 600);
        });
      }

      // 펀드 기준가 이력 조회 → stockHistoryMap 저장 (useHistoryBackfill 소급 기록에 활용)
      // 대상: 현재 보유 + holdingSnapshots 종목 합집합 (과거 일자 검증에 필요)
      // 시작일: 펀드를 참조하는 계좌들의 최소 가입일/baseline/스냅샷/이력 날짜.
      // funetf API가 상장일(데이터 최소일)로 자동 캡하므로 전체 이력을 1회에 수집 →
      // 차트 조회기간과 무관하게 모든 과거 일자 검증이 커버됨.
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];
      const fundStartByCode: Record<string, string> = {};
      const noteFundStart = (code: string, d?: string) => {
        if (!code) return;
        const cur = fundStartByCode[code];
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
          if (!cur || d < cur) fundStartByCode[code] = d;
        } else if (!(code in fundStartByCode)) {
          fundStartByCode[code] = '';
        }
      };
      portfoliosRef.current.forEach(p => {
        if (p.accountType === 'simple') return;
        const items = p.id === activePortfolioIdRef.current ? portfolioRef.current : (p.portfolio || []);
        const pStart = p.portfolioStartDate || p.startDate || p.baselineDate || '';
        const histFirst = (p.history || []).map(h => h.date).filter(Boolean).sort()[0] || '';
        const earliest = [pStart, histFirst].filter(Boolean).sort()[0] || '';
        items.forEach(item => { if (item.type === 'fund' && item.code) noteFundStart(item.code, earliest); });
        (p.holdingSnapshots || []).forEach(s => (s.items || []).forEach(it => {
          if (it.type === 'fund' && it.code) {
            const snapEarliest = [earliest, s.date].filter(Boolean).sort()[0] || '';
            noteFundStart(it.code, snapEarliest);
          }
        }));
      });
      const allFundCodes = Object.keys(fundStartByCode);
      if (allFundCodes.length > 0) {
        // today 기준 직전 거래일(주말 제외) — NAV는 비거래일에 없으므로
        // 이 날짜까지 채워졌으면 최신으로 간주. (공휴일은 재조회 1회 유발, 무해)
        const ltd = new Date(today + 'T12:00:00');
        while (isWeekend(ltd.toISOString().split('T')[0])) ltd.setDate(ltd.getDate() - 1);
        const lastTradingDay = ltd.toISOString().split('T')[0];

        Promise.all(allFundCodes.map(async (code) => {
          // 시작일 미상이면 1년 전. 상장일 이전을 요청해도 API가 자동 캡함.
          const histStartDate = fundStartByCode[code] || oneYearAgoStr;
          const existing = stockHistoryMapRef.current[code] || {};
          // 실제 NAV(거래일) 키만 신선도 판단에 사용 — 과거 잘못 찍힌 비거래일 키 제외
          const tradingKeys = Object.keys(existing).filter(d => !isWeekend(d)).sort();
          const latest = tradingKeys[tradingKeys.length - 1] || '';
          const earliestStored = tradingKeys[0] || '';
          // 시작 커버리지: histStartDate 이전 데이터를 이미 보유했거나,
          // 이번 세션에 광역(상장일~) 조회를 1회 수행함(가입일<상장일이면
          // earliestStored가 영영 미충족이라 세션 ref로 무한 재조회 차단).
          const startCovered = (!!earliestStored && earliestStored <= histStartDate)
            || fundWideFetchedRef.current.has(code);
          // 최신성 + 시작 커버리지 모두 충족해야 fresh. force=true면 무조건 재조회.
          const fresh = !force && (tradingKeys.length > 30 && latest >= lastTradingDay && startCovered);

          const hist = fresh ? null : (code.startsWith('MA:')
            ? await fetchMiraeFundNavHistory(code, histStartDate, today)
            : await fetchFundNavHistory(code, histStartDate, today));
          if (hist) fundWideFetchedRef.current.add(code);

          // 기존 맵에 남아있는 비거래일 키(과거 라이브 stamp 잔재) 정리 — 실제
          // NAV는 거래일에만 존재하므로 비거래일 키는 검증 불일치를 유발한다.
          const staleWeekendKeys = Object.keys(existing).filter(d => isWeekend(d));
          if (!hist && staleWeekendKeys.length === 0) return;

          setStockHistoryMap(prev => {
            const merged: Record<string, number> = { ...(prev[code] || {}) };
            staleWeekendKeys.forEach(d => { delete merged[d]; });
            if (hist) Object.assign(merged, hist);
            return { ...prev, [code]: merged };
          });

          // funetf 펀드: 이력 마지막 2 거래일로 changeRate 계산 (HTML 파싱 불신뢰 대체)
          if (!code.startsWith('MA:') && hist) {
            const tradingDates = Object.keys(hist).filter(d => !isWeekend(d)).sort();
            if (tradingDates.length >= 2) {
              const prevNav = hist[tradingDates[tradingDates.length - 2]];
              const currNav = hist[tradingDates[tradingDates.length - 1]];
              const computedRate = prevNav > 0 ? +((currNav - prevNav) / prevNav * 100).toFixed(2) : 0;
              const applyRate = (item: any) =>
                (item.type === 'fund' && item.code === code && item.changeRate !== computedRate)
                  ? { ...item, changeRate: computedRate }
                  : item;
              setPortfolios(prev => prev.map(p => {
                const items = p.portfolio || [];
                const updated = items.map(applyRate);
                return updated.some((it: any, i: number) => it !== items[i]) ? { ...p, portfolio: updated } : p;
              }));
              setPortfolio(prev => {
                const updated = prev.map(applyRate);
                return updated.some((it: any, i: number) => it !== prev[i]) ? updated : prev;
              });
            }
          }

          // MA 펀드이고 오늘 NAV를 새로 받았으면 portfolio currentPrice 보정
          // (fetchMiraeFundInfo가 외부 프록시 캐시로 인해 어제 기준가를 반환한 경우 수정)
          if (code.startsWith('MA:') && hist?.[today]) {
            const todayNav = hist[today];
            setPortfolios(prev => prev.map(p => {
              const items = p.portfolio || [];
              let changed = false;
              const updItems = items.map(item => {
                if (item.type !== 'fund' || item.code !== code || item.currentPrice === todayNav) return item;
                changed = true;
                const hasStaleNav = item.navDate && item.navDate < today;
                return {
                  ...item,
                  currentPrice: todayNav,
                  changeRate: (hasStaleNav && item.currentPrice > 0)
                    ? +((todayNav - item.currentPrice) / item.currentPrice * 100).toFixed(2)
                    : item.changeRate,
                  changeAmount: (hasStaleNav && item.currentPrice > 0)
                    ? +(todayNav - item.currentPrice).toFixed(2)
                    : item.changeAmount,
                  navDate: today,
                  ...(hasStaleNav ? { prevNavDate: item.navDate, prevNavPrice: item.currentPrice } : {}),
                };
              });
              if (!changed) return p;
              return { ...p, portfolio: updItems };
            }));
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

  // 07:30 AM KST 경계 자동 전환: 앱이 07:30 이전에 시작된 경우 타이머 설정
  // 타이머 발동 시 refreshPrices() 재실행 → effectiveDate가 오늘로 전환됨
  const refreshPricesRef = useRef(refreshPrices);
  refreshPricesRef.current = refreshPrices;
  useEffect(() => {
    const ms = getMsUntilCutoff();
    if (ms === null) return;
    const timer = setTimeout(() => { refreshPricesRef.current(); }, ms);
    return () => clearTimeout(timer);
  }, []);

  // 자산검증 모달에서 특정 종목 1개를 즉시 재조회해 stockHistoryMap에 병합.
  // KIS(원주가) → Naver fchart 순으로 시도. 성공 시 true 반환.
  const refetchStockHistory = async (code: string): Promise<boolean> => {
    if (!code) return false;
    let hist: Record<string, number> | null = null;
    const rKIS = await fetchKISStockHistory(code);
    if (rKIS && Object.keys(rKIS.data).length > 0) hist = rKIS.data;
    if (!hist) { const rNaver = await fetchNaverStockHistory(code); if (rNaver) hist = rNaver.data; }
    if (!hist) { const rDomestic = await fetchNaverDomesticHistory(code); if (rDomestic) hist = rDomestic.data; }
    if (!hist || Object.keys(hist).length === 0) return false;
    setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...hist } }));
    return true;
  };

  return {
    handleStockBlur,
    handleSingleStockRefresh,
    handleAddCompStock,
    handleRemoveCompStock,
    handleCompStockBlur,
    handleToggleComp,
    handleFetchCompHistory,
    handleForceRefetchComp,
    autoRefreshStockPrices,
    refreshPrices,
    refetchStockHistory,
  };
}
