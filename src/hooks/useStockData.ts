// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { fetchIndexData, fetchStockInfo, fetchUsStockInfo, fetchUsStockHistory, fetchNaverDomesticHistory, fetchNaverStockHistory, fetchKISStockHistory, fetchFundInfo, fetchFundNavHistory, fetchMiraeFundInfo, fetchMiraeFundNavHistory, fetchNaverKospi } from '../api';
import { buildIndexStatus, cleanNum, isWeekend, savingsEval } from '../utils';
import { getEffectiveDate, getEffectiveDateForAccount, getMsUntilCutoff, isNonTradingDayForAccount } from './useMarketCalendar';

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
  marketHolidays?: { kr: string[]; us: string[] };
}

const COMP_STOCK_EXTRA_COLORS = ['#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#64748b', '#e11d48'];

// 국내 코드 판별 — 6자리 영숫자 + 숫자 1개 이상 포함.
// 순수 6자리 숫자(472150)뿐 아니라 글자 섞인 최신 ETF 코드(0210E0, 0177R0)도 국내로 인식.
// (해외 티커는 대부분 5자 이하 또는 6자 전부 알파벳 → /\d/에서 걸러짐)
const isKoreanCode = (code: string) => /^[A-Za-z0-9]{6}$/.test(code) && /\d/.test(code);

// 종목별 종가 캐시 병합 — 가격 기준(基準)이 다른 두 소스를 한 번에 안전하게 합친다.
//
// ⚠️ 회귀 주의 — 이 앱의 종가 소스는 두 종류이고 **같은 날짜에 다른 숫자**를 준다.
//   · 실제종가(KIS FID_ORG_ADJ_PRC=1 / 네이버 trend): 그날 실제로 찍힌 가격 → `overwrite`
//   · 수정종가(네이버 fchart / Yahoo): 이후 배당·분할을 소급 반영해 과거를 낮춘 가격 → `gapFill`
//   실측 예: 490590(월배당 커버드콜) 2026-03-09 실제 12,380원 vs 수정 11,222원(배당 5회 소급, -9.4%).
//   두 기준이 한 종목 안에 섞이면 그 경계에서 차트에 인공적인 급등이 생기고, 누적 수익률은
//   곱셈 체인이라 그 하루가 이후 전 구간을 영구히 어긋나게 만든다.
//
// 규칙: gapFill은 **캐시에 그 날짜가 없을 때만** 채우고, overwrite는 무조건 덮어쓴다.
// ⚠️ 적용 순서를 바꾸지 말 것 — gapFill을 먼저, overwrite를 나중에 적용해야
//    같은 날짜가 양쪽에 있을 때 최종값이 항상 실제종가가 된다.
// 입력은 변형하지 않고 항상 새 객체를 반환한다.
// KIS 응답이 '완전한가' 판정 — 완전하면 그 코드는 실제종가 마이그레이션 완료로 표시한다.
//
// ⚠️ 건수 임계값(>=100)만으로 판정하지 말 것 — 상장 직후 종목은 정상 응답이어도 건수가 적다.
//    실측: 0219E0은 상장이 2026-07-14라 14건이 전부인데 옛 로직은 이를 '부분 응답'으로 오판했다.
//    그러면 매 세션 재조회 + `<1500` 조건으로 fchart(수정종가) 보강이 상시 발동한다.
// 서버(api/stock-history.ts)가 partial 플래그를 준다: DEADLINE 초과로 오래된 청크를 못 봤거나
// 실패한 청크가 있으면 true. 이 신호가 건수보다 정확하다.
// ⚠️ 응답이 24h 엣지 캐시되므로 구버전 캐시에는 partial이 없다 → undefined면 옛 휴리스틱으로 폴백.
const isCompleteKisHistory = (res: { partial?: boolean } | null, dateCount: number) => {
  if (!res) return false;
  if (typeof res.partial === 'boolean') return !res.partial;
  return dateCount >= 100;
};

const mergeCodeHistory = (
  base: Record<string, number>,
  sources: { overwrite?: Record<string, number> | null; gapFill?: Record<string, number> | null }
): Record<string, number> => {
  const merged: Record<string, number> = { ...(base || {}) };
  const { overwrite, gapFill } = sources || {};
  if (gapFill) {
    for (const [d, price] of Object.entries(gapFill)) {
      if (merged[d] === undefined) merged[d] = price as number;
    }
  }
  if (overwrite) {
    for (const [d, price] of Object.entries(overwrite)) {
      merged[d] = price as number;
    }
  }
  return merged;
};

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
  marketHolidays,
}: UseStockDataParams) {
  const krH = marketHolidays?.kr || [];
  const usH = marketHolidays?.us || [];

  // 라이브 시세를 stockHistoryMap[code][date]에 stamp할 날짜 (null이면 stamp 생략).
  // ⚠️ 이 키는 '그 날짜의 정확한 종가'(calcPortfolioEvalDetail의 allExact) 판정의 유일한
  //    근거다 — 키만 있으면 exact로 통과하므로, 종가가 아닌 값이 들어가면 자산검증·백필
  //    치유가 장중가를 '확정 종가'로 오인한다. 따라서 기록 창 밖이거나 비거래일이면
  //    stamp 자체를 하지 않는다.
  // ⚠️ 과거엔 `new Date().toISOString()`(UTC)을 써서 KST 00:00~09:00 접속 시 **전일 키**에
  //    당일 라이브가가 박혔다(전일 종가 오염). 반드시 시장별 KST 날짜로 판정할 것.
  // ⚠️ crypto(24시간 시장)·현금성은 isNonTradingDayForAccount가 항상 false라 그대로 통과 —
  //    주말 라이브값이 정당하므로 절대 막지 말 것.
  // ⚠️ overseas는 US 세션일 ≠ KST 날짜라 이번 범위 밖 — 기존 getEffectiveDate() 유지.
  const stampDateFor = (acctType: string): string | null => {
    if (acctType === 'overseas') return getEffectiveDate();
    const d = getEffectiveDateForAccount(acctType);
    if (!d) return null;
    return isNonTradingDayForAccount(acctType, d, krH, usH) ? null : d;
  };

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
      const stampD = stampDateFor(activePortfolioAccountType);
      if (stampD) setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [stampD]: d.price } }));
      if (isOverseas && (!stockHistoryMapRef.current[code] || Object.keys(stockHistoryMapRef.current[code]).length <= 1)) {
        fetchUsStockHistory(code).then(r => {
          if (r?.data && Object.keys(r.data).length > 1) {
            setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...r.data } }));
          }
        });
      }
    } else {
      setStockFetchStatus(prev => ({ ...prev, [code]: 'fail' }));
    }
  };

  // ⚠️ 단일 종목 재조회는 **계좌 id로** 동작해야 한다(카드 별도 창은 비활성 계좌를 띄운다).
  //    옛 구현은 ① 항목 조회(`portfolio.find`) ② 시장 라우팅(`activePortfolioAccountType`)
  //    ③ 쓰기(`setPortfolio`) ④ `stampDateFor` **넷 다** 활성 계좌에 묶여 있었다. 그래서 창이
  //    다른 계좌를 보고 있으면 국내 종목을 해외 API로 조회하거나(그 반대), 무엇보다
  //    **잘못된 확정일에 전역 stockHistoryMap을 스탬프**했다 — 그 맵은 buildCloseEvalSeries의
  //    allExact 판정과 자동확정 데이터완비 가드의 권위 소스이고 Drive에 영속되므로, 한 번
  //    오염되면 과거 평가액이 영구히 어긋난다. 활성 계좌 경로는 아래 위임으로 동작 불변.
  const handleSingleStockRefreshFor = async (pid, id, code) => {
    const acct = (portfoliosRef.current || []).find(p => p && p.id === pid);
    if (!acct) return;                       // 구조적 no-op — 없는 계좌에 쓰지 않는다
    const acctType = acct.accountType || 'portfolio';
    const item = (acct.portfolio || []).find(p => p && p.id === id);
    const setPortfolio = (updater) => setPortfolios(prev => prev.map(p => p.id !== pid ? p : ({
      ...p, portfolio: typeof updater === 'function' ? updater(p.portfolio ?? []) : updater,
    })));
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
      }
      return;
    }
    const isOverseas = acctType === 'overseas';
    if (!code || (!isOverseas && code.length < 5)) return;
    setStockFetchStatus(prev => ({ ...prev, [code]: 'loading' }));
    const d = isOverseas ? await fetchUsStockInfo(code) : await fetchStockInfo(code);
    if (d) {
      setPortfolio(prev => prev.map(p => p.id === id ? { ...p, name: d.name, currentPrice: d.price, changeRate: d.changeRate } : p));
      setStockFetchStatus(prev => ({ ...prev, [code]: 'success' }));
      const stampD = stampDateFor(acctType);
      if (stampD) setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [stampD]: d.price } }));
    } else {
      setStockFetchStatus(prev => ({ ...prev, [code]: 'fail' }));
    }
  };

  // 활성 계좌 경로(포트폴리오 표·리밸런싱 현재가 셀) — 동작 불변.
  const handleSingleStockRefresh = (id, code) => handleSingleStockRefreshFor(activePortfolioIdRef.current, id, code);

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

  // 비교종목 칩 안전 갱신 — await 뒤에는 사용자가 칩을 추가·삭제하거나 코드를 다시 고쳤을 수
  // 있어, 인덱스만 믿고 쓰면 **엉뚱한 칩에 결과가 꽂힌다**. 코드가 그대로일 때만 반영한다.
  const patchComp = (index: number, expectedCode: string, patch: Record<string, any>) => {
    setCompStocks(prev => {
      if (!prev[index] || prev[index].code !== expectedCode) return prev;
      const n = [...prev];
      n[index] = { ...n[index], ...patch };
      return n;
    });
  };

  // 이번 세션에서 '코드 입력만으로' 이력까지 확보한 코드. 코드를 바꾸지 않고 칸을 지나가기만
  // 해도 매번 전체 이력을 다시 긁는 것을 막는다(칩 활성화 경로는 종전대로 항상 갱신 시도).
  const compBlurEnsuredRef = useRef<Set<string>>(new Set());
  // 코드→종목명 세션 캐시. ⚠️ 위 ensured 조기 반환과 **한 쌍**이다 — 캐시가 없으면
  // "A 입력 → B 입력 → 다시 A" 에서 A가 이미 ensured라 조기 반환하고, 칩에는 B의 이름이 남는다.
  const compNameCacheRef = useRef<Record<string, string>>({});
  // 진행 중인 이력 조회(코드→프로미스). 같은 코드의 중복 네트워크를 막는다.
  const compHistInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());

  /**
   * 코드 입력(blur) → 종목명 + 종가 이력을 **즉시** 확보한다.
   *
   * ⚠️ 과거엔 이름만 조회하고 이력은 칩을 눌러 활성화할 때(handleToggleComp)만 받아왔다.
   *    그래서 ① 이미 활성인 칩의 코드를 바꾸면 새 코드의 이력이 영영 안 들어와 선이 비었고,
   *    ② 조회 중 표시가 없어 "종목명이 바로 안 뜬다"로 보였으며, ③ 포트폴리오 테이블에 같은
   *    코드를 넣어 refreshPrices가 이력을 채워야 비로소 동작했다. 포트폴리오 테이블처럼
   *    코드만 넣으면 바로 데이터가 나오도록 **이력까지 여기서** 확보한다.
   * ⚠️ 자동 활성화는 하지 않는다 — 어떤 칩을 차트에 그릴지는 사용자가 고른다.
   */
  const handleCompStockBlur = async (index, rawCode) => {
    const code = String(rawCode || '').trim();
    if (!code) return;
    // 포트폴리오에 같은 코드가 있으면 저장된 종목명 재사용 (API 호출 불필요)
    let resolvedName: string | null = null;
    for (const p of portfoliosRef.current) {
      const match = (p.portfolio || []).find((item: any) => item.code === code && item.name);
      if (match) { resolvedName = match.name; break; }
    }
    // ⚠️ stockFetchStatus는 포트폴리오 테이블과 **공유하는 맵**이다. 보유 종목이면 상태를
    //    건드리지 않는다 — 비교종목 이력 조회가 실패했다고 그 종목 행에 '갱신 실패' 빨간 점이
    //    찍히면 안 된다. 비보유(비교 전용) 코드에만 상태점을 남긴다.
    const heldInPortfolio = !!resolvedName;
    const markStatus = (v: string) => {
      if (!heldInPortfolio) setStockFetchStatus(prev => ({ ...prev, [code]: v }));
    };
    if (!resolvedName) resolvedName = compNameCacheRef.current[code] || null;
    if (resolvedName) patchComp(index, code, { name: resolvedName });
    if (compBlurEnsuredRef.current.has(code)) {
      // 이전 시도에서 이름을 못 구한 코드 — 이름 칸이 옛 종목 이름으로 남지 않게 코드로 되돌린다.
      if (!resolvedName) patchComp(index, code, { name: code });
      return;
    }

    patchComp(index, code, { loading: true });
    markStatus('loading');
    try {
      if (!resolvedName) {
        // 6자리 순수 숫자 또는 6자리 영숫자 혼합(한국 ETF 코드) → 한국 API.
        // 이력 조회 경로(ensureCompHistory)와 동일한 판별식 공유 — 이름/이력 라우팅 불일치 방지.
        const isKorean = isKoreanCode(code);
        let d = isKorean ? await fetchStockInfo(code) : await fetchUsStockInfo(code);
        // 판별식이 빗나간 코드(6자 전부 알파벳 티커 등)를 위한 반대편 폴백.
        if (!d) d = isKorean ? await fetchUsStockInfo(code) : await fetchStockInfo(code);
        resolvedName = d?.name || null;
        // ⚠️ 실패한 이름을 세션 캐시에 넣지 말 것 — 다음 blur가 재시도할 수 있어야 한다.
        if (resolvedName) compNameCacheRef.current[code] = resolvedName;
        patchComp(index, code, { name: resolvedName || code });
      }
      const ok = await ensureCompHistory({ code });
      if (ok) compBlurEnsuredRef.current.add(code);
      // ⚠️ 상태점은 **종가 이력 확보 여부**만 본다. 이름만 못 구한 경우까지 빨간 점을 찍으면
      //    선이 정상으로 그려지는 종목에 '갱신 실패'가 떠 오히려 오해를 준다(이름 미해결은
      //    칩에 코드가 그대로 보이는 것으로 이미 드러난다).
      markStatus(ok ? 'success' : 'fail');
    } finally {
      patchComp(index, code, { loading: false });
    }
  };

  /**
   * 비교종목 종가 이력 확보 — **코드 입력(blur)과 칩 활성화(toggle)가 이 한 함수를 공유**한다.
   * ⚠️ 두 경로가 각자 fetch 체인을 갖게 하지 말 것 — 실제종가/수정종가 우선순위가 갈리면 한
   *    종목 안에 두 가격기준이 섞여 차트에 인공 급등이 생긴다(mergeCodeHistory 주석 참조).
   * @param comp `{ code }` — 칩 객체를 그대로 넘겨도 된다.
   * @returns 이력 확보 성공 여부(단일 포인트 폴백 포함). false면 호출부가 칩을 활성화하지 않는다.
   */
  const ensureCompHistory = (comp: { code: string }): Promise<boolean> => {
    if (!comp?.code) return Promise.resolve(false);
    // ⚠️ 같은 코드의 동시 요청은 **같은 프로미스를 공유**한다 — blur 프리페치가 도는 중에 칩을
    //    누르면 수 초짜리 전체 이력 조회가 두 번 나간다. 칩의 loading 플래그로 막지 않는 이유는,
    //    어느 경로가 예외로 죽으면 그 플래그가 true로 굳어 **버튼이 영구히 죽기** 때문이다.
    //    여기서는 절대 reject하지 않고(catch → false) finally로 반드시 정리한다.
    const running = compHistInFlightRef.current.get(comp.code);
    if (running) return running;
    const p = ensureCompHistoryInner(comp)
      .catch(() => false)
      .finally(() => { compHistInFlightRef.current.delete(comp.code); });
    compHistInFlightRef.current.set(comp.code, p);
    return p;
  };

  const ensureCompHistoryInner = async (comp: { code: string }): Promise<boolean> => {
    const isOverseasComp = !isKoreanCode(comp.code);
    let hist = stockHistoryMap[comp.code];
    // fchart(수정종가) 보강분 — hist(실제종가)와 분리 보관. gap-only 슬롯으로만 흘러간다.
    let supHist: Record<string, number> | null = null;
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
        // ⚠️ 1순위는 KIS다 — 과거 전체를 실제종가로 주는 유일한 창구.
        //    trend를 먼저 부르고 성공 시 KIS를 건너뛰던 옛 순서는 sparse한 trend(실측 490590 =
        //    161/446건) 뒤를 fchart 수정종가로 채워, 한 종목 안에 두 가격기준이 섞이게 만들었다.
        const rKIS = await fetchKISStockHistory(comp.code);
        if (rKIS) {
          hist = rKIS.data;
          const kd = Object.keys(rKIS.data).length;
          // 마이그레이션 표시는 '완전한 KIS 응답'에만 — trend 성공만으로 세우면
          // refreshPrices의 KIS 경로가 이 코드를 건너뛰어 과거가 영영 실제종가로 안 채워진다.
          if (isCompleteKisHistory(rKIS, kd)) trendMigratedInSession.current.add(comp.code);
          console.log(`[history] ${comp.code} 비교종목 KIS 성공: ${kd}건${isCompleteKisHistory(rKIS, kd) ? '' : ' (부분 응답)'}`);
        }
        // 2순위: Naver trend (실제종가, KIS 실패 시)
        if (!hist) {
          const rTrend = await fetchNaverDomesticHistory(comp.code);
          if (rTrend) hist = rTrend.data;
          console.log(`[history] ${comp.code} 비교종목 trend API ${rTrend ? `성공 ${Object.keys(rTrend.data).length}건` : '실패 → fallback'}`);
        }
        // fchart(수정종가) 보강 — ⚠️ hist에 섞지 말고 supHist로 분리해 gap-only 슬롯으로만 흘린다.
        if (hist && Object.keys(hist).length < 1500) {
          const rSup = await fetchNaverStockHistory(comp.code);
          if (rSup) {
            const sup: Record<string, number> = {};
            let added = 0;
            for (const [d, price] of Object.entries(rSup.data)) {
              if (hist[d] === undefined) { sup[d] = price as number; added++; }
            }
            if (added > 0) {
              supHist = sup;
              console.log(`[history] ${comp.code} 비교종목 fchart 보강 후보: +${added}건 (캐시에 없는 날짜만 반영)`);
            }
          }
        }
        // 3순위: 네이버 fchart
        if (!hist) { const rNaver = await fetchNaverStockHistory(comp.code); if (rNaver) hist = rNaver.data; }
        // 4순위: Yahoo Finance (.KS / .KQ)
        if (!hist) { const r1 = await fetchIndexData(`${comp.code}.KS`); if (r1) hist = r1.data; }
        if (!hist) { const r2 = await fetchIndexData(`${comp.code}.KQ`); if (r2) hist = r2.data; }
      }
      if (hist) {
        // ⚠️ 통째 교체 금지 — 실제종가는 overwrite, fchart 보강분은 캐시에 없는 날짜만.
        setStockHistoryMap(prev => ({
          ...prev,
          [comp.code]: mergeCodeHistory(prev[comp.code] || {}, { overwrite: hist, gapFill: supHist }),
        }));
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
          return false;
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
          // 이 분기는 '이미 완전한 KIS 이력을 확보한 코드'만 도달한다(그 외는 위 전체조회 분기).
          // 따라서 순수 증분이면 충분하다. ⚠️ trend 성공만으로 마이그레이션 표시를 세우지 말 것 —
          // 그러면 아래 REPLACE가 발동해 며칠치 증분이 전체 이력을 대체한다(옛 코드의 치명적 결함).
          const rTrend = await fetchNaverDomesticHistory(comp.code, latestDate);
          if (rTrend) newData = rTrend.data;
          if (!newData) { const rKIS = await fetchKISStockHistory(comp.code, fromYear); if (rKIS) newData = rKIS.data; }
          if (!newData) { const rNaver = await fetchNaverStockHistory(comp.code, naverCount); if (rNaver) newData = rNaver.data; }
          if (!newData) { const r1 = await fetchIndexData(`${comp.code}.KS`, latestDate); if (r1) newData = r1.data; }
          if (!newData) { const r2 = await fetchIndexData(`${comp.code}.KQ`, latestDate); if (r2) newData = r2.data; }
        }
        if (newData) {
          // ⚠️ REPLACE 분기를 되살리지 말 것 — 옛 코드는 마이그레이션 표시가 선 코드에 대해
          //    `hist = newData`로 전체를 대체했다. newData는 latestDate 이후 며칠치 증분이라,
          //    그 순간 수년치 실제종가가 사라지고 뒤이은 fchart 보강이 과거 전체를 수정종가로 메웠다.
          //    실측 490590(446건 중 285건이 수정종가)이 이 경로로 만들어졌을 가능성이 크다.
          hist = { ...hist, ...newData };
          // 국내 sparse 캐시(<1500) 보강 — ⚠️ hist에 섞지 말고 supHist로 분리(gap-only 슬롯).
          if (!isOverseasComp && Object.keys(hist).length < 1500) {
            const rSup = await fetchNaverStockHistory(comp.code);
            if (rSup) {
              const sup: Record<string, number> = {};
              let added = 0;
              for (const [d, price] of Object.entries(rSup.data)) {
                if (hist[d] === undefined) { sup[d] = price as number; added++; }
              }
              if (added > 0) {
                supHist = sup;
                console.log(`[history] ${comp.code} 증분경로 fchart 보강 후보: +${added}건 (캐시에 없는 날짜만 반영)`);
              }
            }
          }
          setStockHistoryMap(prev => ({
            ...prev,
            [comp.code]: mergeCodeHistory(prev[comp.code] || {}, { overwrite: hist, gapFill: supHist }),
          }));
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
    return true;
  };

  const handleToggleComp = async (index) => {
    const comp = compStocks[index];
    if (!comp.code) return;

    if (comp.active) { setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: false }; return n; }); return; }
    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: true }; return n; });
    const ok = await ensureCompHistory(comp);
    // 실패 시엔 종전대로 비활성 유지 — 빈 선을 그리지 않는다.
    patchComp(index, comp.code, ok ? { active: true, loading: false } : { loading: false });
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
    // fchart(수정종가) 보강분 — hist(실제종가)와 분리 보관. gap-only 슬롯으로만 흘러간다.
    let supHist: Record<string, number> | null = null;

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
      // trend가 sparse한 경우 fchart로 과거 gap 보강.
      // ⚠️ hist에 섞지 말고 supHist로 분리 — 섞으면 아래 병합에서 수정종가가 캐시의 실제종가를 덮는다.
      // naverCount는 증분용(lastCachedDate 이후 일수)이라 작을 수 있어 풀카운트(2000) 사용.
      if (hist) {
        const rSup = await fetchNaverStockHistory(comp.code);
        if (rSup) {
          const sup: Record<string, number> = {};
          let added = 0;
          for (const [d, price] of Object.entries(rSup.data)) {
            if (hist[d] === undefined) { sup[d] = price as number; added++; }
          }
          if (added > 0) {
            supHist = sup;
            console.log(`[history] ${comp.code} 조회기간 fchart 보강 후보: +${added}건 (캐시에 없는 날짜만 반영)`);
          }
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
      // 실제종가(hist)는 덮어쓰기, fchart 보강분(supHist)은 캐시에 없는 날짜만.
      const mergedHist = mergeCodeHistory(existingHist || {}, { overwrite: hist, gapFill: supHist });
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
    // fchart(수정종가) 보강분 — hist(실제종가)와 분리 보관. gap-only 슬롯으로만 흘러간다.
    let supHist: Record<string, number> | null = null;

    if (isOverseasComp) {
      const rUS = await fetchUsStockHistory(comp.code);
      if (rUS) hist = rUS.data;
    } else {
      // ⚠️ 1순위는 반드시 KIS다 — 과거 전체를 실제종가로 주는 유일한 창구.
      //    옛 코드는 trend를 먼저 부르고 성공하면 KIS를 통째로 건너뛰었는데,
      //    trend는 sparse(실측 490590 = 161/446건)라 나머지 285건이 전부 fchart 수정종가로 채워졌다.
      //    그 결과 이 버튼을 누를수록 과거가 수정종가로 굳었다.
      const rKIS = await fetchKISStockHistory(comp.code);
      if (rKIS) {
        hist = rKIS.data;
        const kd = Object.keys(rKIS.data).length;
        // ⚠️ 마이그레이션 표시는 '완전한 KIS 응답'에만 — trend 성공만으로 세우면
        //    refreshPrices의 KIS 경로(:885 게이트)가 이 코드를 건너뛰어 과거가 영영 안 채워진다.
        if (isCompleteKisHistory(rKIS, kd)) trendMigratedInSession.current.add(comp.code);
        console.log(`[history] ${comp.code} 강제재조회 KIS 성공: ${kd}건${isCompleteKisHistory(rKIS, kd) ? '' : ' (부분 응답)'}`);
      } else {
        console.warn(`[history] ${comp.code} 강제재조회 KIS 실패 → trend 폴백`);
      }
      // 2순위: trend(실제종가) — KIS가 못 준 날짜만 보강
      if (!hist) {
        const rTrend = await fetchNaverDomesticHistory(comp.code);
        if (rTrend) hist = rTrend.data;
        console.log(`[history] ${comp.code} 강제재조회 trend ${rTrend ? `성공 ${Object.keys(rTrend.data).length}건` : '실패 → fallback'}`);
      }
      // fchart(수정종가) 보강 — ⚠️ hist에 섞지 말고 supHist로 분리해 gap-only 슬롯으로만 흘린다.
      if (hist && Object.keys(hist).length < 1500) {
        const rSup = await fetchNaverStockHistory(comp.code);
        if (rSup) {
          const sup: Record<string, number> = {};
          let added = 0;
          for (const [d, price] of Object.entries(rSup.data)) {
            if (hist[d] === undefined) { sup[d] = price as number; added++; }
          }
          if (added > 0) {
            supHist = sup;
            console.log(`[history] ${comp.code} 강제재조회 fchart 보강 후보: +${added}건 (캐시에 없는 날짜만 반영)`);
          }
        }
      }
      if (!hist) { const rNaver = await fetchNaverStockHistory(comp.code); if (rNaver) hist = rNaver.data; }
      if (!hist) { const r1 = await fetchIndexData(`${comp.code}.KS`); if (r1) hist = r1.data; }
      if (!hist) { const r2 = await fetchIndexData(`${comp.code}.KQ`); if (r2) hist = r2.data; }
    }

    if (hist && Object.keys(hist).length > 1) {
      // ⚠️ '기존 캐시 완전 교체'로 되돌리지 말 것 — 통째 교체는 이번에 받지 못한 과거 날짜를
      //    통째로 날린다. 대신 실제종가(hist)를 overwrite로 넣으면 캐시에 남아 있던 수정종가가
      //    그 날짜에서 자동으로 교정되므로, 교체 없이도 '수정주가 제거'라는 원래 목적이 달성된다.
      setStockHistoryMap(prev => ({
        ...prev,
        [comp.code]: mergeCodeHistory(prev[comp.code] || {}, { overwrite: hist, gapFill: supHist }),
      }));
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
    // 코드별 stamp 기준 계좌 타입. koreanCodes에는 KR 계좌와 crypto가 함께 섞이므로
    // (분리 기준이 overseas 하나뿐) 코드 단위로 타입을 기억해 stamp 게이트를 건다.
    // ⚠️ 같은 코드를 여러 계좌가 보유하면 **게이팅이 가장 느슨한 crypto를 우선** 채택 —
    //    24시간 시장의 비거래일 라이브값은 정당하므로 막으면 손익이 지워진다.
    const codeAcctType = new Map<string, string>();

    portfoliosRef.current.forEach(p => {
      if (p.accountType === 'simple' || p.deletedAt) return; // 삭제 계좌는 시세 수집 대상 아님(동결)
      const items = p.portfolio || [];
      const acctType = p.accountType || 'portfolio';
      const isOverseas = acctType === 'overseas';
      items.forEach(item => {
        if (item.type === 'stock' && item.code) {
          if (isOverseas) overseasCodes.add(item.code);
          else koreanCodes.add(item.code);
          const cur = codeAcctType.get(item.code);
          if (!cur || acctType === 'crypto') codeAcctType.set(item.code, acctType);
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
          // ⚠️ today(전역 getEffectiveDate) 대신 그 코드를 보유한 계좌의 시장 기준으로 stamp.
          //    KR 기록 창 밖·비거래일이면 null → stamp 생략(장중가가 '확정 종가'로 오인되는 것 방지).
          const stampD = stampDateFor(codeAcctType.get(code) || 'portfolio');
          if (stampD) setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [stampD]: d.price } }));
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
      if (p.accountType === 'simple' || p.deletedAt) return p; // 삭제 계좌는 가격·이력 갱신 안 함(동결)
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
        } else if (item.type === 'savings') {
          totalEval += savingsEval(item) * fxRate;
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
              } else if (item.type === 'savings') {
                targetEval += savingsEval(item) * fxRate;
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

      // 기존 동작: 기록 대상일 항목이 없을 때만 추가 (KR 계좌는 기록 창 09:00~21:00 밖이면 생략).
      // 이 경로는 비활성 계좌 전용(활성은 위 isActive에서 return) — 시장 계좌(KR/overseas)는 비거래일
      // (주말/공휴일)이면 라이브 스냅샷을 만들지 않는다(스테일 시세 박제 방지, 직전 거래일 종가 carry-forward).
      const acctType = p.accountType || 'portfolio';
      let recDate = getEffectiveDateForAccount(acctType);
      if (recDate && isNonTradingDayForAccount(acctType, recDate, krH, usH)) recDate = null;
      if (!recDate) return { ...p, portfolio: updatedItems };
      const idx = history.findIndex(h => h.date === recDate);
      if (idx >= 0) return { ...p, portfolio: updatedItems };
      const newHistory = [...history, { date: recDate, evalAmount: totalEval, principal: cleanNum(p.principal) || 0, isFixed: false }];
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

    const stampD = stampDateFor(accountType);
    const priceResults = {};

    await Promise.all(stocks.map(async (item) => {
      const d = isOverseas ? await fetchUsStockInfo(item.code) : await fetchStockInfo(item.code);
      if (d) {
        setStockFetchStatus(prev => ({ ...prev, [item.code]: 'success' }));
        if (stampD) setStockHistoryMap(prev => ({ ...prev, [item.code]: { ...(prev[item.code] || {}), [stampD]: d.price } }));
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
  // 첫 이력 패스(KIS/US 과거 종가 조회)가 끝났는가 — useAutoConfirmHistory의 비가역 확정 게이트.
  // ⚠️ state여야 한다(ref면 마지막 병합 뒤 effect를 재실행할 계기가 없다). 조회 대상이 0건이면 refreshPrices
  //    종료 시 true. 한 번 true면 세션 내내 true(다음 패스는 게이트 대상이 아니다 — 정착 신호는 Phase 3).
  const [firstHistoryPassDone, setFirstHistoryPassDone] = useState(false);

  const refreshPricesInner = async (force: boolean) => {
    let historyPassStarted = false;
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
          if (it.type === 'stock' && it.code && isKoreanCode(it.code)) allKoreanCodes.add(it.code);
        }));
      });
      // 활성 비교종목(국내 6자리, 영숫자 포함) 도 포함 — Drive 캐시의 수정주가를 실제종가로 교체.
      // ⚠️ 앱 재시작 시 저장된 활성 비교종목 이력 복구 경로(단일포인트 폴백은 auto-coverage가 스킵하므로
      // 여기서 refreshPrices의 KIS 재조회에 편입돼야 함) — 숫자전용으로 되돌리지 말 것.
      compStocks.filter(s => s.active && s.code && isKoreanCode(s.code)).forEach(s => allKoreanCodes.add(s.code));
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

      if (korCodesNeedingHistory.length > 0 || usCodesNeedingHistory.length > 0) {
        const korFailed: string[] = [];
        const korTasks = korCodesNeedingHistory.map(code => async () => {
          let hist: Record<string, number> | null = null;
          let fromRealPrice = false;
          // fchart(수정종가) 보강분 — ⚠️ hist(실제종가)와 절대 섞지 말 것.
          // hist는 아래 병합에서 '무조건 덮어쓰기' 대상이라, 여기에 수정종가가 들어가면
          // 캐시에 있던 실제종가가 파괴된다. 이 변수는 gap-only 슬롯으로만 흘러간다.
          let supHist: Record<string, number> | null = null;
          // 1순위: KIS 실제종가 (FID_ORG_ADJ_PRC=1, 수정주가 미반영)
          const rKIS = await fetchKISStockHistory(code);
          if (rKIS) {
            hist = rKIS.data;
            fromRealPrice = true;
            const dates = Object.keys(rKIS.data).sort();
            // 부분 응답(청크 일부만 성공) 가드: 100건 미만이면 마이그 플래그 보류 → 다음 갱신에서 재시도 허용.
            // KIS는 13청크 × ~50거래일 = 정상 시 600~6000건. 100건 미만 = rate limit으로 대부분 청크 실패한 상태.
            const complete = isCompleteKisHistory(rKIS, dates.length);
            if (complete) trendMigratedInSession.current.add(code);
            console.log(`[history] ${code} KIS 성공: ${dates.length}건${complete ? '' : ' (부분 응답 — 재시도 대기)'}, 최초=${dates[0]}, 최근=${dates[dates.length-1]}`);
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
              const sup: Record<string, number> = {};
              let added = 0;
              // ⚠️ hist에 대입하지 말 것 — 별도 객체(sup)에만 모은다.
              //    `hist[d] === undefined` 필터는 유지: 실제종가가 이미 있는 날짜는 후보에서 제외해
              //    병합 순서 실수에도 수정종가가 실제종가를 이길 수 없게 한다(이중 안전).
              for (const [d, price] of Object.entries(supData)) {
                if (hist[d] === undefined) { sup[d] = price as number; added++; }
              }
              if (added > 0) {
                supHist = sup;
                console.log(`[history] ${code} fchart 보강 후보: +${added}건 (캐시에 없는 날짜만 반영)`);
              }
            }
          }
          if (hist) {
            // 두 경로를 하나의 병합 규칙으로 통일한다.
            //  · fromRealPrice(KIS/trend): hist=실제종가는 덮어쓰기, supHist=fchart 보강분은 캐시에 없는 날짜만.
            //    응답에 없는 날짜는 기존 캐시 보존 — KIS 청크 부분 실패 시 데이터 손실 방지.
            //  · 그 외(fchart/Yahoo 폴백): hist 자체가 수정종가 위험이라 통째로 gap-only.
            // ⚠️ fromRealPrice 경로에서 hist를 그대로 spread하던 옛 코드로 되돌리지 말 것 —
            //    그 시절엔 보강분이 hist 안에 주입돼 있어서 수정종가가 캐시의 실제종가를 덮었다.
            setStockHistoryMap(prev => ({
              ...prev,
              [code]: mergeCodeHistory(
                prev[code] || {},
                fromRealPrice ? { overwrite: hist, gapFill: supHist } : { gapFill: hist }
              ),
            }));
          } else {
            korFailed.push(code);
          }
        });

        // KIS는 앱키당 초당 20건 제한. 코드별 함수가 각각 13청크를 sequential로 호출하므로
        // 동시 4개 인스턴스 = 평균 4~8건/초 → rate limit 폭주를 사전 차단.
        // force=true 시 전 계좌 모든 종목이 대상이라 직렬화가 특히 중요.
        const KIS_CONCURRENCY = force ? 4 : 8;
        historyPassStarted = true;
        Promise.all([
          runWithConcurrency(korTasks, KIS_CONCURRENCY),
          ...usCodesNeedingHistory.map(async (code) => {
            const r = await fetchUsStockHistory(code);
            if (r?.data && Object.keys(r.data).length > 1)
              setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...r.data } }));
          }),
        ]).then(() => {
          setTimeout(() => {
            const snap = saveStateRef.current;
            if (snap && driveTokenRef.current) saveAllToDrive(snap);
          }, 600);
        }).finally(() => setFirstHistoryPassDone(true));
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
        if (p.accountType === 'simple' || p.deletedAt) return; // 삭제 계좌는 펀드 NAV 이력 수집 대상 아님(동결)
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
                if (p.deletedAt) return p; // 삭제 계좌 동결
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
              if (p.deletedAt) return p; // 삭제 계좌 동결
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

    } catch (err) {
      console.error('데이터 갱신 오류:', err);
    } finally {
      setIsLoading(false);
      // 이력 조회 블록에 들어가지 않은 패스(대상 0건·예외)는 여기서 '첫 패스 완료'로 친다 — 안 그러면 자동확정이 영구 보류된다.
      if (!historyPassStarted) setFirstHistoryPassDone(true);
    }
  };

  // ── 재진입 가드 ──
  // 부팅 중 3경로(계좌 전환 effect·로드 effect·STOCK 하이드레이션 타이머)가 같은 함수를 무가드로 불러
  // in-flight 코드가 다시 큐잉되고 KIS 동시 요청이 8×2로 뛰던 것을 막는다. 폴링·07:30 타이머·HistoryPanel
  // force 경로도 전부 여기를 지난다. 진행 중이면 **같은 Promise**를 돌려주고, force는 1건만 큐잉해
  // 완료 후 1회 재실행한다(fetchMarketIndicators의 indicatorInFlightRef 패턴).
  // options는 이벤트 핸들러로 전달돼도 안전(MouseEvent에 force 프로퍼티 없음).
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const pendingForceRef = useRef(false);
  const refreshPrices = (options?: { force?: boolean } | any): Promise<void> => {
    const force = !!(options && typeof options === 'object' && options.force === true);
    if (refreshInFlightRef.current) {
      if (force) pendingForceRef.current = true;
      return refreshInFlightRef.current;
    }
    const run = refreshPricesInner(force).finally(() => {
      refreshInFlightRef.current = null;
      if (pendingForceRef.current) { pendingForceRef.current = false; refreshPrices({ force: true }); }
    });
    refreshInFlightRef.current = run;
    return run;
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
  // market==='us' → 해외(worldstock) 단독 1콜 / 그 외·미지정 → 국내 체인(KIS → fchart → trend).
  // ⚠️ 과거엔 국내 3소스만 시도해 **해외 티커는 100% 실패**했고, 사용자에게는 "신규 상장 또는
  //    API 일시 불가"로 표시돼 원인(조회 경로 부재)을 오도했다. 게다가 5자 이상 티커(GOOGL 등)는
  //    KIS 청크 조회로 최대 22초를 태우고 국내 수집과 rate-limit 예산을 나눠 썼다.
  // ⚠️ 시장은 **호출부가 알려주게** 할 것 — code만으로는 국내 최신 ETF(0190C0 같은 영숫자 6자)와
  //    해외 티커를 구분할 수 없다. detectMarket(watchlistQuote)은 정확히 그 오분류 이슈가 있어
  //    import하지 않는다.
  // ⚠️ 분기는 `=== 'us'` fail-safe 형태 — 미지정·미구현 값('fund' 등)이 흘러들어와도 기존 국내
  //    체인으로 떨어져 동작이 100% 하위호환이다(@ts-nocheck + esbuild라 오타를 잡을 컴파일러가 없다).
  const refetchStockHistory = async (code: string, market?: 'us' | 'kr'): Promise<boolean> => {
    if (!code) return false;
    if (market === 'us') {
      // ⚠️ KIS를 앞에 두고 해외를 폴백으로 붙이지 말 것 — 단순 지연이 아니라 국내 수집 방해다.
      //    /api/history?key=worldstock 이 이미 Yahoo → KIS 해외 → Naver 3단 폴백을 돈다.
      const r = await fetchUsStockHistory(code);
      // 대량 수집 경로(위 usCodesNeedingHistory 병합)와 동일한 `> 1` 임계 — worldstock 3순위
      // Naver는 1건 응답도 채택하므로, 1건짜리를 성공으로 보고하면 "성공했다는데 값이 안 변함"이 된다.
      if (!r?.data || Object.keys(r.data).length <= 1) return false;
      setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...r.data } }));
      return true;
    }
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
    handleSingleStockRefreshFor,   // 카드 별도 창(비활성 계좌) 전용 — 활성 경로는 위 위임
    handleAddCompStock,
    handleRemoveCompStock,
    handleCompStockBlur,
    handleToggleComp,
    handleFetchCompHistory,
    handleForceRefetchComp,
    autoRefreshStockPrices,
    refreshPrices,
    refetchStockHistory,
    firstHistoryPassDone,
  };
}
