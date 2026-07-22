﻿// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Plus, Download, Trash2, Maximize2, X, Check, Activity, TrendingUp, Settings, BarChart3, RotateCcw } from 'lucide-react';
import ChartRangeControls from './ChartRangeControls';
import CompStockChips from './CompStockChips';
import {
  PieChart, Pie, Cell, ComposedChart, Line, Area, XAxis,
  YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts';
import { UI_CONFIG } from '../config';
import { MARK_COLOR_CYCLE, MARK_STRIP_BG } from '../constants';
import { formatCurrency, formatPercent, formatShortDate, formatVeryShortDate, cleanNum, recessionBandsForDates } from '../utils';

const ROW_COLOR_CYCLE: string[] = MARK_COLOR_CYCLE.map(k => MARK_STRIP_BG[k]);
const nextRowColor = (cur: string): string => {
  if (!cur) return ROW_COLOR_CYCLE[0];
  const idx = ROW_COLOR_CYCLE.indexOf(cur.toLowerCase());
  if (idx < 0) return '';
  return idx >= ROW_COLOR_CYCLE.length - 1 ? '' : ROW_COLOR_CYCLE[idx + 1];
};

import CustomDatePicker from './CustomDatePicker';
import { PieLabelOutside } from '../chartUtils';
import DividendSummaryTable from './DividendSummaryTable';
import { fetchEtfTopHoldings, fetchStockPer, fetchYahooStockPer, getEtfHoldingsFetchAt, getStockPerFetchAt } from '../api';

// 세션 캐시 (컴포넌트 재마운트 간 유지)
const _etfInfoCache = new Map(); // itemCode → { holdings: [...] | null, ts }
const _perCache = new Map();     // stockCode → { per, fper } | null


const hexToRgba = (hex, alpha) => {
  if (!hex || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getStockUrl = (code, category = '') => {
  if (!code) return null;
  if (category === 'FUND') return `https://www.funetf.co.kr/product/fund/view/${code}`;
  if (/^\d/.test(code)) return `https://m.stock.naver.com/domestic/stock/${code}/total`;
  if (/^[A-Za-z]+$/.test(code)) return `https://finance.yahoo.com/quote/${code.toUpperCase()}`;
  return null;
};

const blendWithDarkBg = (hex, alpha, bgHex = '#1e293b') => {
  if (!hex || hex.length < 7) return bgHex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const bgR = parseInt(bgHex.slice(1, 3), 16);
  const bgG = parseInt(bgHex.slice(3, 5), 16);
  const bgB = parseInt(bgHex.slice(5, 7), 16);
  return `rgb(${Math.round(bgR*(1-alpha)+r*alpha)}, ${Math.round(bgG*(1-alpha)+g*alpha)}, ${Math.round(bgB*(1-alpha)+b*alpha)})`;
};

export default function IntegratedDashboard({
  intHistory,
  intTotals,
  intMonthlyHistory,
  intChartData,
  intChartPeriod,
  intSelectionResult,
  intIsZeroBaseMode,
  intRefAreaLeft,
  intRefAreaRight,
  intCatDonutData,
  intHoldingsDonutData,
  hoveredIntCatSlice,
  hoveredIntHoldSlice,
  portfolioSummaries,
  intExpandedCat,
  simpleEditField,
  showNewAccountMenu,
  hideAmounts,
  setIntChartPeriod,
  intDateRange,
  setIntDateRange,
  setIntAppliedRange,
  handleIntSearchClick,
  setIntIsZeroBaseMode,
  setHoveredIntCatSlice,
  setHoveredIntHoldSlice,
  setShowNewAccountMenu,
  setSimpleEditField,
  addPortfolio,
  addSimpleAccount,
  addMatongAccount,
  updateMatongAccountField,
  deletePortfolio,
  restorePortfolio,
  purgePortfolio,
  switchToPortfolio,
  movePortfolio,
  updatePortfolioColor,
  togglePortfolioTest,
  updatePortfolioStartDate,
  updatePortfolioName,
  updatePortfolioMemo,
  updateSimpleAccountField,
  resetAllPortfolioColors,
  handleIntChartMouseDown,
  handleIntChartMouseMove,
  handleIntChartMouseUp,
  handleIntChartMouseLeave,
  intHoveredPoint,
  handleSave,
  allPortfoliosForDividend,
  updatePortfolioDividendHistory,
  updatePortfolioActualDividend,
  updatePortfolioDividendTaxRate,
  updatePortfolioDividendSeparateTax,
  updatePortfolioDividendTaxAmount,
  updatePortfolioActualDividendUsd,
  updatePortfolioActualAfterTaxUsd,
  updatePortfolioActualAfterTaxKrw,
  intDepositEvents = [],
  usdkrw = 1300,
  holidays = { kr: [], us: [] },
  dividendTaxHistory = {},
  intHiddenDivMonths = { expected: [], actual: [] },
  onToggleIntHiddenDivMonth,
  onManualBackfill,
  sec = { dividend: false, history: false, donut: false },
  setSec,
  intDefaultSelectionResult,
  matongClosedIds = {},
  setMatongClosedIds,
  compStocks = [],
  setCompStocks,
  stockHistoryMap = {},
  stockListingDates = {},
  setStockListingDates,
  appliedRange = { start: '', end: '' },
  autoFetchedCodes,
  stockFetchStatus = {},
  handleAddCompStock,
  handleToggleComp,
  handleCompStockBlur,
  handleFetchCompHistory,
  handleRemoveCompStock,
  customLinks = [],
  setCustomLinks,
  isLinkSettingsOpen = false,
  setIsLinkSettingsOpen,
  activePortfolioId = '',
  activeHistory = [],
  intAccountSeriesById = {},
  userFeatures = { feature1: false, feature2: false, feature3: false },
}) {
  const [showCompStocks, setShowCompStocks] = useState(false);
  const toggleSec = (key) => setSec(prev => ({ ...prev, [key]: !prev[key] }));
  const [rightAxisZoom, setRightAxisZoom] = useState(0);

  const [memoModal, setMemoModal] = useState(null);
  const [memoPos, setMemoPos] = useState({ x: 0, y: 0 });
  const memoDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const [showSimpleMenu, setShowSimpleMenu] = useState(false);
  const simpleMenuRef = useRef(null);
  useEffect(() => {
    if (!showSimpleMenu) return;
    const handler = (e) => { if (simpleMenuRef.current && !simpleMenuRef.current.contains(e.target)) setShowSimpleMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSimpleMenu]);

  const [showDeletedAccounts, setShowDeletedAccounts] = useState(false);

  // 삭제된 계좌(deletedAt) — 통합 표에서 숨기고 접힌 관리영역에 노출(복원/영구삭제). 마지막 총자산은
  // 삭제일 이전(d < deletedAt)의 마지막 기록 evalAmount(참고용).
  const deletedAccounts = useMemo(() => {
    return (allPortfoliosForDividend || [])
      .filter(p => p.deletedAt)
      .map(p => {
        const summary = portfolioSummaries.find(s => s.id === p.id);
        const recs = (p.history || []).filter(h => h && h.date && h.date < p.deletedAt && typeof h.evalAmount === 'number' && h.evalAmount > 0);
        let lastEval = 0;
        if (recs.length) lastEval = recs.reduce((a, b) => (a.date >= b.date ? a : b)).evalAmount;
        return { id: p.id, name: summary?.name || p.name || p.id, deletedAt: p.deletedAt, accountType: p.accountType || 'portfolio', lastEval };
      })
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }, [allPortfoliosForDividend, portfolioSummaries]);

  const [histDetailDate, setHistDetailDate] = useState(null);
  useEffect(() => {
    if (!histDetailDate) return;
    const handler = (e) => { if (e.key === 'Escape') setHistDetailDate(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [histDetailDate]);

  const histDetailRows = useMemo(() => {
    if (!histDetailDate || !allPortfoliosForDividend) return { rows: [], totalEval: 0, totalPrincipal: 0, totalDeposit: 0 };
    // intMonthlyHistory[0]가 오늘(실시간 값 사용 날짜)이므로 그 date와 비교.
    // ⚠️ 라이브 자산이 0(예: 유일 계좌 삭제 → 빈 계좌 자동생성)이면 computedIntHistory가 today를 추가하지
    //   않아 intMonthlyHistory[0].date가 '과거' 최신점이 된다 → 이때 realtime 취급하면 그 과거점에서 삭제
    //   계좌를 잘못 제외해 차트와 어긋난다. 따라서 라이브 자산이 있을 때만 realtime(오늘)으로 판정.
    const realtimeDate = intMonthlyHistory.length > 0 ? intMonthlyHistory[0].date : '';
    const isRealtimeDate = histDetailDate === realtimeDate && (intTotals?.totalEval || 0) > 0;
    let totalEval = 0, totalPrincipal = 0, totalDeposit = 0;
    const rows = [];
    allPortfoliosForDividend.forEach(p => {
      if (p.isTest) return; // TEST 계좌는 추이 팝업 소계에서 제외(차트 값과 일치)
      // 삭제 계좌: 삭제일 이후(및 라이브 시점)는 제외 — 삭제일 이전 과거 날짜만 표시(차트 값과 일치)
      if (p.deletedAt && (isRealtimeDate || histDetailDate >= p.deletedAt)) return;
      const summary = portfolioSummaries.find(s => s.id === p.id);
      const isCash = p.accountType === 'matong' || p.accountType === 'simple';
      let evalAmt = 0;
      if (isRealtimeDate) {
        // 오늘은 실시간 평가금 사용 → 테이블 합계와 일치
        evalAmt = summary?.currentEval || 0;
      } else if (isCash) {
        // 현금성 계좌(마통·직접입력): 일별 자동 스냅샷(p.history)을 carry-forward로 복원해
        // 그날의 잔액을 그대로 표시한다(현재값을 과거 날짜에 소급하지 않음). 오늘은 위 isRealtimeDate
        // 분기가 현재값을 쓰므로 여기는 항상 과거 날짜 → 스냅샷 기준. 추이 차트(computedIntHistory)와
        // 동일 규칙(스냅샷 carry-forward, 0 포함) → 소계가 차트 그날 값과 일치.
        const startDate = summary?.startDate || p.portfolioStartDate || p.startDate || '';
        if (startDate && startDate > histDetailDate) return;
        const hist = p.id === activePortfolioId ? activeHistory : (p.history || []);
        const sorted = [...hist].filter(h => h?.date && typeof h.evalAmount === 'number' && h.evalAmount >= 0).sort((a, b) => a.date.localeCompare(b.date));
        const rec = sorted.filter(h => h.date <= histDetailDate).pop();
        evalAmt = rec ? rec.evalAmount : 0;
      } else {
        // 시장 계좌: 통합 추이 차트(computedIntHistory)와 '동일한' 시계열(marketSeries)을 재사용한다.
        // 저장된 라이브 evalAmount가 아니라 '수량 × 종가'(확정 종가) carry-forward 값 → 팝업 소계가
        // 차트 그날 값·개별 계좌 추이와 정확히 일치(정확한 일별 자산 추적). 차트 dateToTotal과
        // 동일하게 histDetailDate 이하 최신 기록값을 이월(carry-forward)한다.
        const series = intAccountSeriesById[p.id];
        if (!series || !series.dates || series.dates.length === 0) return;
        let last = 0;
        for (const d of series.dates) {
          if (d <= histDetailDate) last = series.map.get(d);
          else break;
        }
        if (!(last > 0)) return;
        evalAmt = last;
      }
      if (evalAmt <= 0) return;
      totalEval += evalAmt;
      const isOverseas = p.accountType === 'overseas';
      const fxRate = isOverseas ? (p.avgExchangeRate || 1) : 1;
      const currentPrincipalKRW = (p.principal || 0) * fxRate;
      const deps = p.depositHistory || [];
      const wds = p.depositHistory2 || [];
      const futureDeposits = deps.filter(d => d.date > histDetailDate).reduce((s, d) => s + (d.amount || 0) * (isOverseas ? (d.fxRate || 1) : 1), 0);
      const futureWithdrawals = wds.filter(d => d.date > histDetailDate).reduce((s, d) => s + (d.amount || 0) * (isOverseas ? (d.fxRate || 1) : 1), 0);
      // 현금성 계좌(마통·직접입력): 투자원금=평가금액=예수금 불변 → 수익·수익률 항상 0.
      //   원금은 그날 잔액(=평가 스냅샷)과 동일하게 둔다(입출금 시점 보정식 미적용).
      // 그 외 계좌(주식 포트폴리오 등)는 입출금 시점 보정식 유지.
      const effPrincipal = isCash
        ? evalAmt
        : Math.max(0, currentPrincipalKRW - futureDeposits + futureWithdrawals);
      totalPrincipal += effPrincipal;
      // 현금성 계좌: 예수금도 잔액(=평가=원금)과 동일 유지.
      const depositAmt = isCash ? effPrincipal : (summary?.depositAmount || 0);
      totalDeposit += depositAmt;
      const name = (summary?.name || p.name || p.id) + (p.deletedAt ? ' (삭제됨)' : '');
      const profit = evalAmt - effPrincipal;
      const returnRate = effPrincipal > 0 ? (profit / effPrincipal) * 100 : 0;
      rows.push({ id: p.id, name, evalAmount: evalAmt, principal: effPrincipal, profit, returnRate, depositAmount: depositAmt, rowColor: p.rowColor || '' });
    });
    return { rows, totalEval, totalPrincipal, totalDeposit };
  }, [histDetailDate, intMonthlyHistory, allPortfoliosForDividend, activePortfolioId, activeHistory, portfolioSummaries, intAccountSeriesById, intTotals?.totalEval]);

  // 앱 기록 시작일: 모든 계좌의 가장 이른 '실제 기록일'(실시간 isFixed:false / 사용자 확정 adjustedAmount).
  // 순수 백필(isFixed:true + adjustedAmount 없음)은 역추산이라 제외 — 그 이전 구간은 전부 역추산이므로
  // 실제 보유 이력이 아니다. 백필 자체는 유지하되, 이 날짜에 차트 마커를 찍어 이전 데이터가 부정확할
  // 수 있음을 사용자가 알 수 있게 한다.
  const appTrackingStartDate = useMemo(() => {
    let earliest = null;
    (allPortfoliosForDividend || []).forEach(p => {
      if (p.isTest) return; // TEST 계좌는 차트 미표시 → 기록 시작일 마커 산정에서 제외
      const hist = p.id === activePortfolioId ? activeHistory : (p.history || []);
      (hist || []).forEach(h => {
        if (!h || !h.date) return;
        const isPureBackfill = h.isFixed === true && h.adjustedAmount === undefined;
        if (isPureBackfill) return;
        if (earliest === null || h.date < earliest) earliest = h.date;
      });
    });
    return earliest;
  }, [allPortfoliosForDividend, activePortfolioId, activeHistory]);

  // 차트 X축은 카테고리(날짜)라 ReferenceLine x는 실제 데이터 포인트와 일치해야 렌더된다.
  // 시작일 이전에 표시되는(역추산) 데이터가 있을 때만, 시작일 이상 첫 포인트에 스냅해 마커를 노출.
  const trackingMarkerDate = useMemo(() => {
    if (!appTrackingStartDate || intChartData.length === 0) return null;
    if (!intChartData.some(d => d.date < appTrackingStartDate)) return null;
    const hit = intChartData.find(d => d.date >= appTrackingStartDate);
    return hit ? hit.date : null;
  }, [appTrackingStartDate, intChartData]);

  // 조회기간에 겹치는 역사적 경기침체(NBER) 구간을 실제 데이터 날짜로 스냅해 음영 표시
  const recessionBands = useMemo(
    () => recessionBandsForDates(intChartData.map(d => d.date)),
    [intChartData]
  );

  const focusNextMatongInput = useCallback((el, dir) => {
    const tr = el.closest('tr');
    if (!tr) return;
    const inputs = Array.from(tr.querySelectorAll('input[data-matong-input]'));
    const idx = inputs.indexOf(el);
    const next = inputs[idx + dir];
    if (next) { next.focus(); next.select(); }
  }, []);

  const newAccBtnRef = useRef(null);
  const [newAccMenuPos, setNewAccMenuPos] = useState({ top: 0, right: 0 });

  // ETF 구성종목 + PER 데이터 (itemName → holdings[] | { isStock, per, fper } | 'loading')
  const [etfInfoMap, setEtfInfoMap] = useState({});
  const [holdingsFetchDate, setHoldingsFetchDate] = useState({});
  const [holdingsSortConfig, setHoldingsSortConfig] = useState({ key: null, direction: 1 });
  const fetchingRef = useRef(new Set());

  useEffect(() => {
    const isKr6 = (c) => /^[A-Z0-9]{6}$/i.test(c || '');
    const isUsTicker = (c) => /^[A-Za-z]{1,6}$/.test(c || '');
    const candidates = intHoldingsDonutData.filter(item => isKr6(item.code) || isUsTicker(item.code));
    if (candidates.length === 0) return;

    const fetchOne = async (item) => {
      const { name, code } = item;
      if (fetchingRef.current.has(name)) return;
      fetchingRef.current.add(name);
      setEtfInfoMap(prev => {
        if (prev[name] !== undefined) { fetchingRef.current.delete(name); return prev; }
        return { ...prev, [name]: 'loading' };
      });

      const holdings = await fetchEtfTopHoldings(code);
      const holdingDate = getEtfHoldingsFetchAt(code);
      if (!holdings || holdings.length === 0) {
        // ETF holdings 조회 실패 → 종목 자체 PER 시도
        const baseCode = code.includes('.') ? code.split('.')[0] : code;
        const perData = isKr6(code)
          ? await fetchStockPer(code)
          : isUsTicker(baseCode)
            ? await fetchYahooStockPer(baseCode)
            : null;
        const perDate = getStockPerFetchAt(isKr6(code) ? code : baseCode);
        const fetchDate = holdingDate ?? perDate ?? null;
        if (fetchDate) setHoldingsFetchDate(prev => ({ ...prev, [name]: fetchDate }));
        if (perData?.per != null || perData?.fper != null) {
          setEtfInfoMap(prev => ({ ...prev, [name]: { isStock: true, per: perData.per, fper: perData.fper } }));
        } else {
          setEtfInfoMap(prev => ({ ...prev, [name]: { isStock: true, per: null, fper: null } }));
        }
      } else {
        if (holdingDate) setHoldingsFetchDate(prev => ({ ...prev, [name]: holdingDate }));
        const isOverseasTicker = (c) => /^[A-Za-z]{1,6}$/.test(c || '');
        const perResults = await Promise.all(
          holdings.map(h => {
            if (isKr6(h.code)) return fetchStockPer(h.code);
            const base = h.code.includes('.') ? h.code.split('.')[0] : h.code;
            if (isOverseasTicker(base)) return fetchYahooStockPer(base);
            return Promise.resolve(null);
          })
        );
        const enriched = holdings.map((h, i) => ({ ...h, per: perResults[i]?.per ?? null, fper: perResults[i]?.fper ?? null }));
        setEtfInfoMap(prev => ({ ...prev, [name]: enriched }));
      }
      fetchingRef.current.delete(name);
    };

    candidates.forEach(item => fetchOne(item));
  }, [intHoldingsDonutData]);

  const handleHoldingsSort = (key) => setHoldingsSortConfig(prev => ({
    key,
    direction: prev.key === key ? -prev.direction : 1,
  }));

  const handleNewAccToggle = useCallback(() => {
    if (newAccBtnRef.current) {
      const rect = newAccBtnRef.current.getBoundingClientRect();
      setNewAccMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setShowNewAccountMenu(v => !v);
  }, [setShowNewAccountMenu]);

  const openMemoModal = (id, memo) => {
    setMemoPos({ x: window.innerWidth / 2 - 128, y: window.innerHeight / 2 - 180 });
    setMemoModal({ id, val: memo ?? '' });
  };

  const handleMemoDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    memoDrag.current = { active: true, offsetX: e.clientX - memoPos.x, offsetY: e.clientY - memoPos.y };
    const onMove = (e) => {
      if (!memoDrag.current.active) return;
      setMemoPos({ x: e.clientX - memoDrag.current.offsetX, y: e.clientY - memoDrag.current.offsetY });
    };
    const onUp = () => {
      memoDrag.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const saveMemoModal = () => {
    if (!memoModal) return;
    updatePortfolioMemo(memoModal.id, memoModal.val);
    setMemoModal(null);
  };

  return (
    <>
          <div className="flex flex-col gap-6 w-full">

            {/* 통합 요약 카드 */}
            {(() => {
              // ⚠️ 여기서 전일대비를 다시 계산하지 말 것 — intMonthlyHistory가 입출금 보정을 마친
              //    단일 소스다. 자체 raw diff(evalAmount 차)로 되돌리면 헤더 +9.10% vs 추이표 +1.59%로
              //    갈라지고 CLAUDE.md '달력 오늘 칸 = 통합 헤더 카드 정확 일치' 불변식이 즉시 깨진다.
              const todayRec = intMonthlyHistory[0];
              // ⚠️ 보류(dodAbsChange==null)를 `?? 0`으로 삼키지 말 것 — '+₩0 / +0.00%'는 '변동 없음'이라는
              //    사실 주장이 된다. 추이표('-')·메모 달력(줄 숨김)과 같은 '산출 불가' 규약을 공유해야
              //    CLAUDE.md '달력 오늘 칸 = 통합 헤더 카드 정확 일치' 불변식이 유지된다.
              const todayHeld = !todayRec || todayRec.dodAbsChange == null;
              const todayProfit = todayRec?.dodAbsChange ?? 0;
              const todayRate = todayRec?.dodChange ?? 0;
              const todayFlow = todayRec?.netFlow ?? 0;
              // 보류 행은 배지가 0이라 '입금했는데 아무것도 안 보인다'가 되므로 원본 원장 흐름을 안내
              const todayPendingFlow = todayHeld ? (todayRec?.ledgerFlow ?? 0) : 0;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">총 자산 (평가금)</span>
                    <span className="text-white text-lg font-extrabold">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalEval)}</span>
                  </div>
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">오늘 수익 ({todayRec?.date || '-'})</span>
                    {todayHeld ? (
                      <>
                        <span className="text-lg font-extrabold text-gray-500" title="입출금 기록과 평가 스냅샷이 어긋나 일간 지표를 보류했습니다.">-</span>
                        {todayPendingFlow !== 0 && (
                          <span className="text-[10px] font-bold text-amber-400">
                            {hideAmounts ? '••••' : `${todayPendingFlow > 0 ? '입금' : '출금'} ${formatCurrency(Math.abs(todayPendingFlow))} 반영 대기`}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className={`text-lg font-extrabold ${todayProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                          {hideAmounts ? '••••••' : `${todayProfit >= 0 ? '+' : ''}${formatCurrency(todayProfit)}`}
                        </span>
                        <span className={`text-[11px] font-bold ${todayRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                          {todayRate >= 0 ? '+' : ''}{todayRate.toFixed(2)}%
                        </span>
                        {todayFlow !== 0 && (
                          <span className={`text-[10px] font-bold ${todayFlow > 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
                            {hideAmounts ? '••••' : `${todayFlow > 0 ? '입금' : '출금'} ${formatCurrency(Math.abs(todayFlow))} 제외`}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">전체 수익율</span>
                    <span className={`text-lg font-extrabold ${intTotals.returnRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {intTotals.returnRate >= 0 ? '+' : ''}{intTotals.returnRate.toFixed(2)}%
                    </span>
                  </div>
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">총 투자원금</span>
                    <span className="text-white text-lg font-extrabold">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalPrincipal)}</span>
                  </div>
                </div>
              );
            })()}

            <div className="flex items-start gap-0 w-full">
              <div className="flex-1 flex flex-col gap-6 min-w-0" style={{ paddingBottom: '40vh' }}>
            <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg">
              <div className="p-3 bg-[#0f172a] flex justify-between items-center border-b border-gray-700">
                <span className="text-white font-bold text-sm">🏦 통합 계좌 현황</span>
                <div className="flex gap-1 items-center">
                  <div>
                    <button
                      ref={newAccBtnRef}
                      onClick={handleNewAccToggle}
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors text-xs font-bold px-2 py-1 hover:bg-blue-900/20 rounded"
                    >
                      <Plus size={12} /> 새 계좌 <span className="text-[9px] opacity-60">▼</span>
                    </button>
                    {showNewAccountMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowNewAccountMenu(false)} />
                        <div
                          className="fixed z-50 bg-[#1e293b] border border-gray-600 rounded-lg shadow-2xl py-1 min-w-[160px]"
                          style={{ top: newAccMenuPos.top, right: newAccMenuPos.right }}
                        >
                          {[
                            { type: 'dc-irp',    icon: '🏦', label: '퇴직연금 계좌' },
                            { type: 'isa',       icon: '🌱', label: 'ISA 계좌' },
                            { type: 'portfolio', icon: '📈', label: '일반증권 계좌' },
                            { type: 'dividend',  icon: '💰', label: '배당형 계좌' },
                            { type: 'pension',   icon: '🎯', label: '연금저축 계좌' },
                            { type: 'gold',      icon: '🥇', label: 'KRX 금현물 계좌' },
                            { type: 'overseas',  icon: '🌐', label: '해외계좌' },
                            { type: 'crypto',    icon: '₿',  label: 'CRYPTO 계좌' },
                          ].map(({ type, icon, label }) => (
                            <button
                              key={type}
                              onClick={() => { addPortfolio(type); setShowNewAccountMenu(false); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-blue-900/30 hover:text-white transition-colors flex items-center gap-2"
                            >
                              <span>{icon}</span> {label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="relative" ref={simpleMenuRef}>
                    <button onClick={() => setShowSimpleMenu(v => !v)} className="flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors text-xs font-bold px-2 py-1 hover:bg-green-900/20 rounded" title="직접입력 계좌 추가">
                      <Plus size={12} /> 직접입력 <span className="text-[10px]">▾</span>
                    </button>
                    {showSimpleMenu && (
                      <div className="absolute left-0 top-full mt-1 z-50 bg-[#1e293b] border border-gray-600 rounded shadow-lg min-w-[130px]">
                        <button onClick={() => { addSimpleAccount(); setShowSimpleMenu(false); }} className="w-full text-left px-3 py-2 text-xs text-green-300 hover:bg-green-900/30 transition-colors flex items-center gap-2">
                          <span>📋</span> 일반계좌
                        </button>
                        <button onClick={() => { addMatongAccount(); setShowSimpleMenu(false); }} className="w-full text-left px-3 py-2 text-xs text-green-300 hover:bg-green-900/30 transition-colors flex items-center gap-2">
                          <span>🏦</span> 마통계좌
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="w-[1px] h-4 bg-gray-700 mx-1" />
                  <button onClick={handleSave} className="flex items-center gap-1 text-orange-400 hover:text-orange-300 transition-colors text-xs font-bold px-2 py-1 hover:bg-orange-900/20 rounded" title="JSON 파일로 다운로드 (PC 백업)">
                    <Download size={12} /> PC 백업
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="bg-[#0f172a] text-gray-400 border-b border-gray-700">
                    <tr>
                      <th className="border-r border-gray-700 cursor-pointer hover:bg-red-900/30 transition-colors" style={{width:'10px',minWidth:'10px'}} onClick={resetAllPortfolioColors} title="클릭하여 모든 행 색상 초기화"></th>
                      <th className="py-2 px-2 text-center border-r border-gray-700">순서</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">시작일</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700 sticky left-0 z-20 bg-[#0f172a]">계좌</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">투자원금</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">평가비중</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">총자산</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">수익율</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">CAGR</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">예수금</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">수익</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700 min-w-[180px]">비고</th>
                      <th className="py-2 px-2 text-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const regularAccounts = portfolioSummaries.filter(s => s.accountType !== 'matong' && !s.deletedAt);
                      const matongAccounts = portfolioSummaries.filter(s => s.accountType === 'matong' && !s.deletedAt);
                      const sortedSummaries = [...regularAccounts, ...matongAccounts];
                      return sortedSummaries.map((s, sIdx) => {
                      const allocRatio = intTotals.totalEval > 0 ? s.currentEval / intTotals.totalEval * 100 : 0;
                      const isCatOpen = intExpandedCat === s.id;
                      const isSimple = s.accountType === 'simple';
                      const isMatong = s.accountType === 'matong';
                      const matongMonthlyInterest = isMatong ? Math.round((s.currentWithdrawal || 0) * ((s.agreedRate || 0) / 100 / 12)) : 0;
                      const isMatongIdx = isMatong;
                      const regularCount = regularAccounts.length;
                      return (
                        <React.Fragment key={s.id}>
                          <tr
                            className={`border-b border-gray-700 transition-colors ${!s.rowColor ? (s.isActive ? 'bg-blue-950/20' : isSimple ? 'bg-green-950/10 hover:bg-green-900/10' : isMatong ? 'bg-green-950/10 hover:bg-green-900/10' : 'hover:bg-gray-800/40') : ''}`}
                            style={s.rowColor ? { backgroundColor: hexToRgba(s.rowColor, 0.18) } : {}}
                          >
                            {/* 색상 스트립 — 클릭 시 노랑→슬레이트→로즈→갈색→해제 사이클 */}
                            <td className="px-0 py-1 border-r border-gray-700" style={{width:'10px',minWidth:'10px'}}>
                              <button
                                title="클릭하여 행 색상 토글 (노랑→슬레이트→로즈→갈색→해제)"
                                className="block w-full cursor-pointer border-0 outline-none rounded-sm"
                                style={{minHeight:'28px', backgroundColor: s.rowColor || 'transparent'}}
                                onClick={() => updatePortfolioColor(s.id, nextRowColor(s.rowColor || ''))}
                              />
                            </td>
                            {/* 순서 화살표 */}
                            <td className="py-1.5 px-2 text-center border-r border-gray-700">
                              {isMatong ? (
                                <div className="flex flex-col items-center gap-0.5 opacity-20 cursor-not-allowed">
                                  <span className="leading-none text-[10px] text-gray-500">▲</span>
                                  <span className="leading-none text-[10px] text-gray-500">▼</span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                  <button onClick={() => movePortfolio(s.id, -1)} disabled={sIdx === 0} className="text-gray-500 hover:text-blue-400 disabled:opacity-20 disabled:cursor-default leading-none text-[10px]" title="위로">▲</button>
                                  <button onClick={() => movePortfolio(s.id, 1)} disabled={sIdx === regularCount - 1} className="text-gray-500 hover:text-blue-400 disabled:opacity-20 disabled:cursor-default leading-none text-[10px]" title="아래로">▼</button>
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-3 text-center border-r border-gray-700">
                              <CustomDatePicker value={s.startDate} onChange={v => updatePortfolioStartDate(s.id, v)} />
                            </td>
                            {/* 계좌 */}
                            {/* 계좌명 셀의 빈 공간 클릭 → TEST 토글(합산·차트·카테고리 제외). 계좌명 텍스트 클릭은 계좌 열기 유지 */}
                            <td
                              className="py-1.5 px-3 text-center border-r border-gray-700 sticky left-0 z-[5] bg-[#1e293b] cursor-pointer hover:bg-blue-900/10"
                              style={s.rowColor ? { backgroundColor: blendWithDarkBg(s.rowColor, 0.35) } : {}}
                              onClick={() => togglePortfolioTest(s.id)}
                              title={s.isTest ? '셀 빈 곳 클릭 → TEST 해제 (합산·차트·카테고리에 포함)' : '셀 빈 곳 클릭 → TEST 계좌로 표시 (합산·수익율·평가액추이·카테고리 비중에서 제외)'}
                            >
                              {isSimple ? (
                                <input type="text" onClick={e => e.stopPropagation()} className={`w-full min-w-[70px] bg-transparent font-bold outline-none text-center text-green-300 ${s.isTest ? 'italic' : ''}`} value={s.name} onChange={e => updatePortfolioName(s.id, e.target.value)} />
                              ) : isMatong ? (
                                <input type="text" onClick={e => e.stopPropagation()} className={`w-full min-w-[70px] bg-transparent font-bold outline-none text-center text-green-300 ${s.isTest ? 'italic' : ''}`} value={s.name} onChange={e => updatePortfolioName(s.id, e.target.value)} />
                              ) : (
                                <span onClick={e => { e.stopPropagation(); switchToPortfolio(s.id); }} title="클릭하여 계좌 열기" className={`font-bold select-none cursor-pointer hover:underline ${s.isTest ? 'italic text-green-400' : 'text-blue-300'}`}>{s.name}</span>
                              )}
                            </td>
                            {/* 투자원금 */}
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-200 font-bold">
                              {isSimple ? (
                                hideAmounts ? '••••••' : (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="w-full min-w-[90px] bg-transparent font-bold outline-none text-center text-gray-200 border-b border-dashed border-gray-600 focus:border-green-400"
                                  value={simpleEditField?.id === s.id && simpleEditField?.field === 'principal'
                                    ? (simpleEditField.rawVal ?? '')
                                    : s.principal ? formatCurrency(s.principal) : ''}
                                  placeholder={s.currentEval ? formatCurrency(s.currentEval) : '₩0'}
                                  onFocus={e => { setSimpleEditField({id: s.id, field: 'principal', rawVal: s.principal ? String(cleanNum(s.principal)) : ''}); e.target.select(); }}
                                  onBlur={() => { if (simpleEditField?.id === s.id && simpleEditField?.field === 'principal') updateSimpleAccountField(s.id, 'principal', simpleEditField?.rawVal ?? ''); setSimpleEditField(null); }}
                                  onChange={e => setSimpleEditField(prev => prev ? { ...prev, rawVal: e.target.value } : null)}
                                />)
                              ) : isMatong ? (
                                hideAmounts ? '••••••' : <span className="text-gray-200">{formatCurrency(s.principal)}</span>
                              ) : (hideAmounts ? '••••••' : formatCurrency(s.principal))}
                            </td>
                            <td
                              className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-300 cursor-help"
                              title={s.isTest
                                ? `TEST 계좌 — 전체 합계에서 제외됨`
                                : `계좌 총자산 / 전체 총자산\n${s.name} ${formatCurrency(s.currentEval)} / TOTAL ${formatCurrency(intTotals.totalEval)} = ${allocRatio.toFixed(2)}%`}
                            >{s.isTest ? '-' : `${allocRatio.toFixed(2)}%`}</td>
                            {/* 총자산 */}
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center font-bold text-white">
                              {isSimple ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="w-full min-w-[90px] bg-transparent font-bold outline-none text-center text-white border-b border-dashed border-gray-600 focus:border-green-400"
                                  value={simpleEditField?.id === s.id && simpleEditField?.field === 'eval'
                                    ? (simpleEditField.rawVal ?? '')
                                    : s.currentEval ? formatCurrency(s.currentEval) : ''}
                                  placeholder="₩0"
                                  onFocus={e => { setSimpleEditField({id: s.id, field: 'eval', rawVal: s.currentEval ? String(cleanNum(s.currentEval)) : ''}); e.target.select(); }}
                                  onBlur={() => { if (simpleEditField?.id === s.id && simpleEditField?.field === 'eval') updateSimpleAccountField(s.id, 'evalAmount', simpleEditField?.rawVal ?? ''); setSimpleEditField(null); }}
                                  onChange={e => setSimpleEditField(prev => prev ? { ...prev, rawVal: e.target.value } : null)}
                                />
                              ) : (hideAmounts ? '••••••' : formatCurrency(s.currentEval))}
                            </td>
                            <td className={`py-1.5 px-3 border-r border-gray-700 text-center font-bold ${s.returnRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{isMatong ? '0.00%' : formatPercent(s.returnRate)}</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-blue-300 font-bold">{isMatong ? '0.00%' : formatPercent(s.cagr)}</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-400 font-bold">{hideAmounts ? '••••••' : formatCurrency(s.depositAmount)}</td>
                            {/* 수익 */}
                            <td className={`py-1.5 px-3 border-r border-gray-700 text-center font-bold ${s.currentEval - s.principal >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                              {isMatong ? '₩0' : (hideAmounts ? '••••••' : formatCurrency(s.currentEval - s.principal))}
                            </td>
                            <td className="p-0 border-r border-gray-700 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                              {isMatong ? (
                                <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                                  <span className="text-gray-400 font-bold">{parseFloat(s.agreedRate || 0).toFixed(2)}%</span>
                                  <span className="text-gray-500">|</span>
                                  <span className="text-gray-400">월이자</span>
                                  <span className="text-gray-300 font-bold">{hideAmounts ? '••••••' : formatCurrency(matongMonthlyInterest)}</span>
                                  <button
                                    onClick={() => setMatongClosedIds(prev => ({...prev, [s.id]: !prev[s.id]}))}
                                    className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-green-700/50 text-green-700 hover:text-green-300 hover:border-green-400 transition-colors"
                                  >
                                    {matongClosedIds[s.id] ? '펼치기' : '숨기기'}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center">
                                  <input type="text" className="flex-1 min-w-0 bg-transparent outline-none px-2 py-1.5 text-gray-300 text-xs caret-blue-400 overflow-hidden placeholder-gray-600" value={s.memo ?? ''} onChange={e => updatePortfolioMemo(s.id, e.target.value)} placeholder="메모..." />
                                  <button onClick={() => openMemoModal(s.id, s.memo)} className="shrink-0 pr-1 text-gray-600 hover:text-blue-400 transition-colors" title="메모 전체 보기"><Maximize2 size={10} /></button>
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button onClick={() => deletePortfolio(s.id)} className="text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                            </td>
                          </tr>
                          {isMatong && !matongClosedIds[s.id] && (
                            <tr className="bg-green-950/10 border-b border-gray-700/60">
                              <td colSpan={13} className="py-2 px-4">
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
                                  <label className="flex items-center gap-1.5 text-gray-400">
                                    인출가능 총액
                                    <input
                                      type="text" inputMode="numeric"
                                      data-matong-input="true"
                                      className="w-[110px] bg-[#1e293b] border border-green-700/50 rounded px-2 py-0.5 text-green-300 font-bold text-center outline-none focus:border-green-400"
                                      value={simpleEditField?.id === s.id && simpleEditField?.field === 'withdrawableTotal'
                                        ? (simpleEditField.rawVal ?? '') : s.withdrawableTotal ? formatCurrency(s.withdrawableTotal) : ''}
                                      placeholder="₩0"
                                      onFocus={e => { setSimpleEditField({id: s.id, field: 'withdrawableTotal', rawVal: s.withdrawableTotal ? String(cleanNum(s.withdrawableTotal)) : ''}); e.target.select(); }}
                                      onBlur={() => { if (simpleEditField?.id === s.id && simpleEditField?.field === 'withdrawableTotal') updateMatongAccountField(s.id, 'withdrawableTotal', simpleEditField?.rawVal ?? ''); setSimpleEditField(null); }}
                                      onChange={e => setSimpleEditField(prev => prev ? { ...prev, rawVal: e.target.value } : null)}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextMatongInput(e.target, 1); } }}
                                    />
                                  </label>
                                  <label className="flex items-center gap-1.5 text-gray-400">
                                    현재 인출액
                                    <input
                                      type="text" inputMode="numeric"
                                      data-matong-input="true"
                                      className="w-[110px] bg-[#1e293b] border border-green-700/50 rounded px-2 py-0.5 text-green-300 font-bold text-center outline-none focus:border-green-400"
                                      value={simpleEditField?.id === s.id && simpleEditField?.field === 'currentWithdrawal'
                                        ? (simpleEditField.rawVal ?? '') : s.currentWithdrawal ? formatCurrency(s.currentWithdrawal) : ''}
                                      placeholder="₩0"
                                      onFocus={e => { setSimpleEditField({id: s.id, field: 'currentWithdrawal', rawVal: s.currentWithdrawal ? String(cleanNum(s.currentWithdrawal)) : ''}); e.target.select(); }}
                                      onBlur={() => { if (simpleEditField?.id === s.id && simpleEditField?.field === 'currentWithdrawal') updateMatongAccountField(s.id, 'currentWithdrawal', simpleEditField?.rawVal ?? ''); setSimpleEditField(null); }}
                                      onChange={e => setSimpleEditField(prev => prev ? { ...prev, rawVal: e.target.value } : null)}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextMatongInput(e.target, 1); } }}
                                    />
                                  </label>
                                  <label className="flex items-center gap-1.5 text-gray-400">
                                    인출제한금액
                                    <input
                                      type="text" inputMode="numeric"
                                      data-matong-input="true"
                                      className="w-[110px] bg-[#1e293b] border border-green-700/50 rounded px-2 py-0.5 text-green-300 font-bold text-center outline-none focus:border-green-400"
                                      value={simpleEditField?.id === s.id && simpleEditField?.field === 'withdrawalLimit'
                                        ? (simpleEditField.rawVal ?? '') : s.withdrawalLimit ? formatCurrency(s.withdrawalLimit) : ''}
                                      placeholder="₩0"
                                      onFocus={e => { setSimpleEditField({id: s.id, field: 'withdrawalLimit', rawVal: s.withdrawalLimit ? String(cleanNum(s.withdrawalLimit)) : ''}); e.target.select(); }}
                                      onBlur={() => { if (simpleEditField?.id === s.id && simpleEditField?.field === 'withdrawalLimit') updateMatongAccountField(s.id, 'withdrawalLimit', simpleEditField?.rawVal ?? ''); setSimpleEditField(null); }}
                                      onChange={e => setSimpleEditField(prev => prev ? { ...prev, rawVal: e.target.value } : null)}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextMatongInput(e.target, 1); } }}
                                    />
                                  </label>
                                  <label className="flex items-center gap-1.5 text-gray-400">
                                    약정이율(%)
                                    <input
                                      type="text" inputMode="decimal"
                                      data-matong-input="true"
                                      className="w-[70px] bg-[#1e293b] border border-green-700/50 rounded px-2 py-0.5 text-green-300 font-bold text-center outline-none focus:border-green-400"
                                      value={s.agreedRateStr ?? ''}
                                      placeholder="0.00"
                                      onFocus={e => e.target.select()}
                                      onChange={e => updateMatongAccountField(s.id, 'agreedRate', e.target.value.replace(/[^0-9.]/g, ''))}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
                                    />
                                  </label>
                                  <span className="text-gray-500">→</span>
                                  <span className="text-gray-400">투자원금</span>
                                  <span className="text-gray-200 font-bold">{hideAmounts ? '••••••' : formatCurrency(s.principal)}</span>
                                  <span className="text-gray-500">|</span>
                                  <span className="text-gray-400">월이자</span>
                                  <span className="text-gray-300 font-bold">{hideAmounts ? '••••••' : formatCurrency(matongMonthlyInterest)}</span>
                                </div>
                              </td>
                            </tr>
                          )}
                          {isCatOpen && Object.keys(s.cats).length > 0 && (
                            <tr className="bg-gray-800/30 border-b border-gray-700">
                              <td colSpan={13} className="py-3 px-4">
                                <div className="text-[11px] text-gray-400 font-bold mb-2">📊 {s.name} - 구분별 평가금액</div>
                                <div className="flex flex-wrap gap-x-6 gap-y-2">
                                  {Object.entries(s.cats).filter(([,v]) => v > 0).map(([cat, val]) => (
                                    <div key={cat} className="flex items-center gap-2">
                                      <span className={`text-[11px] font-bold ${UI_CONFIG.COLORS.CATEGORIES[cat] || 'text-gray-300'}`}>{cat}</span>
                                      <span className="text-[11px] text-gray-200 font-bold">{hideAmounts ? '••••••' : formatCurrency(val)}</span>
                                      <span className="text-[10px] text-gray-500">{s.currentEval > 0 ? ((val / s.currentEval) * 100).toFixed(1) : 0}%</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    });
                    })()}
                    {portfolioSummaries.filter(s => !s.deletedAt).length === 0 && (
                      <tr><td colSpan={13} className="py-8 text-center text-gray-500 text-xs">계좌가 없습니다. <span className="text-blue-400 font-bold">+ 계좌 추가</span> 버튼을 눌러 추가하세요.</td></tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-red-700 bg-red-900/20">
                    <tr>
                      <td className="border-r border-gray-700"></td>
                      <td className="py-2 px-2 border-r border-gray-700"></td>
                      <td className="py-2 px-3 border-r border-gray-700"></td>
                      <td className="py-2 px-3 text-center text-red-400 font-extrabold border-r border-gray-700 sticky left-0 z-[5] bg-[#2d1a1e]">소 계</td>
                      <td className="py-2 px-3 text-center text-gray-200 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalPrincipal)}</td>
                      <td className="py-2 px-3 text-center text-gray-300 border-r border-gray-700">100%</td>
                      <td className="py-2 px-3 text-center text-yellow-400 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalEval)}</td>
                      <td className={`py-2 px-3 text-center font-bold border-r border-gray-700 ${intTotals.returnRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatPercent(intTotals.returnRate)}</td>
                      <td className="py-2 px-3 border-r border-gray-700"></td>
                      <td className="py-2 px-3 text-center text-gray-400 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalDeposit)}</td>
                      <td className={`py-2 px-3 text-center font-bold border-r border-gray-700 ${intTotals.totalEval - intTotals.totalPrincipal >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{hideAmounts ? '••••••' : formatCurrency(intTotals.totalEval - intTotals.totalPrincipal)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* 삭제된 계좌(소프트 삭제) — 통합 표에서 숨김. 과거 총자산·계좌별 현황은 그대로 보존됨.
                복원(다시 활성화) 또는 영구삭제(과거 기록까지 완전 제거) 가능. */}
            {deletedAccounts.length > 0 && (
              <div className="w-full bg-[#161e2e] rounded-xl border border-gray-700/60 overflow-hidden">
                <button
                  onClick={() => setShowDeletedAccounts(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-800/40 transition-colors"
                >
                  <span className="text-gray-400 text-xs font-bold flex items-center gap-2">
                    <Trash2 size={13} className="text-gray-500" />
                    삭제된 계좌 {deletedAccounts.length}개
                    <span className="text-gray-600 font-normal">· 과거 기록 보존(통합 현황·추이에서 제외)</span>
                  </span>
                  <span className="text-gray-500 text-[11px]">{showDeletedAccounts ? '접기 ▲' : '펼치기 ▼'}</span>
                </button>
                {showDeletedAccounts && (
                  <div className="px-3 pb-3 pt-1 flex flex-col gap-1.5">
                    {deletedAccounts.map(d => (
                      <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#1e293b] border border-gray-700/50">
                        <span className="font-bold text-gray-300 text-sm truncate max-w-[160px]" title={d.name}>{d.name}</span>
                        <span className="text-[11px] text-gray-500">삭제일 {d.deletedAt}</span>
                        {d.lastEval > 0 && (
                          <span className="text-[11px] text-gray-500">· 마지막 총자산 {hideAmounts ? '••••••' : formatCurrency(d.lastEval)}</span>
                        )}
                        <div className="ml-auto flex items-center gap-1.5">
                          {restorePortfolio && (
                            <button
                              onClick={() => restorePortfolio(d.id)}
                              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-blue-700/50 text-blue-300 hover:text-blue-200 hover:border-blue-400 transition-colors"
                              title="이 계좌를 복원 (다시 활성화)"
                            >
                              <RotateCcw size={11} /> 복원
                            </button>
                          )}
                          {purgePortfolio && (
                            <button
                              onClick={() => purgePortfolio(d.id)}
                              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-red-800/50 text-red-400 hover:text-red-300 hover:border-red-500 transition-colors"
                              title="영구 삭제 (과거 기록까지 완전 제거, 되돌리기 불가)"
                            >
                              <Trash2 size={11} /> 영구삭제
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!sec.history && (
            <div className="flex flex-col xl:flex-row gap-4 w-full items-stretch">

              {/* 평가액 추이 테이블 */}
              <div className="w-full xl:w-[490px] shrink-0 bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden flex flex-col max-h-[344px] sm:max-h-[384px] md:max-h-[424px] xl:max-h-[464px]">
                <div className="p-3 bg-[#0f172a] flex items-center justify-between border-b border-gray-700 shrink-0">
                  <span className="text-white font-bold text-sm">📅 평가액 추이</span>
                </div>
                <div className="overflow-x-auto overflow-y-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 z-10">
                      <tr>
                        <th className="py-2.5 px-2 text-center border-r border-gray-700 whitespace-nowrap">일자</th>
                        <th className="py-2.5 px-2 text-center border-r border-gray-700 whitespace-nowrap">평가금액</th>
                        <th className="py-2.5 px-2 text-center border-r border-gray-700 whitespace-nowrap cursor-help" title="(당일 총자산 + 당일 출금) ÷ (전일 총자산 + 당일 입금) − 1
입출금 영향을 제거한 순수 일간 수익률입니다. 입출금이 있던 날은 아래에 금액이 표시됩니다.">전일대비</th>
                        <th className="py-2.5 px-2 text-center border-r border-gray-700 whitespace-nowrap min-w-[100px] cursor-help" title="당일 총자산 − 전일 총자산 − 당일 순입출금
입금액 크기와 무관하게 그날 실제로 번 금액입니다.">일간 손익</th>
                        <th className="py-2.5 px-2 text-center border-r border-gray-700 whitespace-nowrap">원금대비</th>
                        <th className="py-2.5 px-2 text-center whitespace-nowrap">투자원금</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intMonthlyHistory.map((h, i) => (
                        <tr key={h.id || i} className={`border-b border-gray-700 ${h.date === new Date().toISOString().split('T')[0] ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                          <td className="py-2 px-2 text-center font-bold text-gray-400 border-r border-gray-700 cursor-pointer hover:text-sky-300 transition-colors" onClick={() => setHistDetailDate(h.date)}>{formatShortDate(h.date)}</td>
                          <td className="py-2 px-2 font-bold text-white text-center border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(h.evalAmount)}</td>
                          <td className="py-2 px-2 text-center border-r border-gray-700">
                            {/* 보류(dodAbsChange==null)는 '변동 없음(0.00%)'이 아니라 '산출 불가' —
                                0.00%로 단언하면 실제로 변동이 없던 날과 구분되지 않는다 */}
                            {h.dodAbsChange == null
                              ? <span className="text-gray-600">-</span>
                              : <span className={`font-bold ${h.dodChange > 0 ? 'text-red-400' : h.dodChange < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{formatPercent(h.dodChange)}</span>}
                          </td>
                          <td className="py-2 px-2 text-center border-r border-gray-700 whitespace-nowrap">
                            {hideAmounts ? (
                              <span className="text-gray-500">••••••</span>
                            ) : h.dodAbsChange != null ? (
                              <span className={`font-bold text-[11px] ${h.dodAbsChange > 0 ? 'text-red-400' : h.dodAbsChange < 0 ? 'text-blue-400' : 'text-gray-500'}`}>
                                {formatCurrency(h.dodAbsChange)}
                              </span>
                            ) : (
                              <span className="text-gray-600">-</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center border-r border-gray-700">
                            <span className={`font-bold ${h.monthlyChange > 0 ? 'text-red-400' : h.monthlyChange < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{formatPercent(h.monthlyChange)}</span>
                          </td>
                          <td className="py-2 px-2 font-bold text-gray-300 text-center">{hideAmounts ? '••••••' : formatCurrency(h.effectivePrincipal > 0 ? h.effectivePrincipal : intTotals.totalPrincipal)}</td>
                        </tr>
                      ))}
                      {intMonthlyHistory.length === 0 && (
                        <tr><td colSpan={6} className="py-6 text-center text-gray-500">데이터 없음<br/><span className="text-[10px] text-gray-600">계좌 평가금액을 입력하면 자동으로 기록됩니다.</span></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 기간별 수익 차트 */}
              <div className="w-full xl:flex-1 bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden flex flex-col xl:h-[464px]">
                {/* 헤더: 제목 + 링크 + 날짜범위 + 드롭다운 */}
                <div className="p-3 bg-[#0f172a] border-b border-gray-700 flex flex-col gap-2 shrink-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <TrendingUp size={14} className="text-red-400" />
                      <span className="text-white font-bold text-sm">총자산현황 수익율</span>
                    </div>
                    {/* 사이트 링크 버튼 (아이콘만, 툴팁=이름·URL) */}
                    {setCustomLinks && (
                      <div className="flex items-center gap-1 shrink-0">
                        {customLinks.slice(0, 3).map((link, i) => {
                          const tip = link.url
                            ? (link.name?.trim() ? `링크${i + 1} · ${link.name.trim()} — ${link.url}` : `링크${i + 1} — ${link.url}`)
                            : `링크${i + 1} 설정 필요`;
                          return (
                            <button
                              key={i}
                              onClick={() => link.url && window.open(link.url.startsWith('http') ? link.url : 'https://' + link.url, '_blank')}
                              className="bg-gray-800 hover:bg-gray-700 text-blue-300 w-[28px] h-[28px] rounded shadow transition border border-gray-600 flex items-center justify-center text-[16px] font-extrabold leading-none"
                              title={tip}
                            >{i + 1}</button>
                          );
                        })}
                        <button
                          onClick={() => setIsLinkSettingsOpen?.(!isLinkSettingsOpen)}
                          className="bg-gray-800 hover:bg-gray-700 text-gray-400 w-[28px] h-[28px] rounded shadow transition border border-gray-600 flex items-center justify-center"
                          title="퀵 링크 설정"
                        ><Settings size={12} /></button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
                      {setCompStocks && handleAddCompStock && (
                        <button
                          onClick={() => setShowCompStocks(v => !v)}
                          className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showCompStocks ? 'text-emerald-300 bg-emerald-900/30 border-emerald-700/50' : 'text-gray-500 border-gray-700 hover:text-gray-300 hover:bg-gray-800'}`}
                          title={showCompStocks ? '비교종목 숨기기' : '비교종목 펼치기'}
                        ><BarChart3 size={14} /></button>
                      )}
                      <ChartRangeControls
                        dateRange={intDateRange}
                        setDateRange={setIntDateRange}
                        period={intChartPeriod}
                        setPeriod={setIntChartPeriod}
                        onSearch={handleIntSearchClick}
                      />
                      <button onClick={() => setIntIsZeroBaseMode(m => !m)} className={`p-1.5 rounded border flex items-center justify-center transition-colors ${intIsZeroBaseMode ? 'text-indigo-300 bg-indigo-900/40 border-indigo-700/60' : 'text-gray-500 border-gray-700 hover:text-gray-300 hover:bg-gray-800'}`} title="기간 시작 기준 / 원금 기준 전환"><Activity size={14} /></button>
                      <div className="flex items-center gap-1 shrink-0 border border-gray-700 rounded px-2 py-1" title="우측 Y축(금액) 스케일 조절 — 오른쪽으로 당길수록 변동폭이 확대됩니다">
                        <span className="text-[10px] text-gray-500 select-none">↕</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={rightAxisZoom}
                          onChange={e => setRightAxisZoom(Number(e.target.value))}
                          className="w-14 cursor-pointer accent-blue-400"
                          style={{ height: '4px' }}
                          title={rightAxisZoom === 0 ? '우측 Y축: 전체 범위 (0 기준)' : `우측 Y축 확대: ${rightAxisZoom}%`}
                        />
                        {rightAxisZoom > 0 && (
                          <button onClick={() => setRightAxisZoom(0)} className="text-gray-600 hover:text-gray-400 text-[10px] leading-none" title="초기화">✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* 링크 설정 패널 */}
                  {isLinkSettingsOpen && setCustomLinks && (
                    <div className="flex flex-wrap gap-3 pb-1 border-b border-gray-700/50">
                      {customLinks.slice(0, 3).map((l, i) => (
                        <div key={i} className="flex flex-col gap-1.5 flex-1 min-w-[160px] max-w-[240px]">
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-gray-500 font-bold ml-1">버튼 {i + 1} 이름 <span className="text-gray-600 font-normal">(직접 입력, 최대 7자)</span></span>
                            <input
                              type="text" maxLength={7}
                              className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-400 shadow-inner font-normal"
                              value={l.name || ''}
                              onChange={(e) => { const n = [...customLinks]; n[i] = { ...n[i], name: e.target.value }; setCustomLinks(n); }}
                              placeholder="비워두면 URL에서 자동 추출"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-gray-500 font-bold ml-1">버튼 {i + 1} 연결 (URL)</span>
                            <input
                              type="text"
                              className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-500 shadow-inner font-normal"
                              value={l.url || ''}
                              onChange={(e) => { const n = [...customLinks]; n[i] = { ...n[i], url: e.target.value }; setCustomLinks(n); }}
                              placeholder="https://..."
                            />
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setIsLinkSettingsOpen?.(false)} className="self-end bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition">완료</button>
                    </div>
                  )}
                  {showCompStocks && setCompStocks && handleAddCompStock && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 xl:flex-wrap xl:overflow-visible xl:pb-0 xl:mx-0 xl:px-0">
                      <CompStockChips
                        compStocks={compStocks}
                        setCompStocks={setCompStocks}
                        stockHistoryMap={stockHistoryMap}
                        stockListingDates={stockListingDates}
                        setStockListingDates={setStockListingDates}
                        appliedRange={appliedRange}
                        autoFetchedCodes={autoFetchedCodes}
                        stockFetchStatus={stockFetchStatus}
                        handleAddCompStock={handleAddCompStock}
                        handleToggleComp={handleToggleComp}
                        handleCompStockBlur={handleCompStockBlur}
                        handleFetchCompHistory={handleFetchCompHistory}
                        handleRemoveCompStock={handleRemoveCompStock}
                      />
                    </div>
                  )}
                </div>
                {/* 드래그 기간 선택 결과 패널 */}
                {(() => {
                  const displayResult = intSelectionResult ?? intDefaultSelectionResult;
                  return (
                    <div className="px-4 py-2 border-b border-gray-700/40 bg-[#060f1e]/70 min-h-[34px] shrink-0 flex items-center">
                      {displayResult ? (
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 w-full">
                          <span className="text-gray-500 text-[10px] font-bold shrink-0">{intSelectionResult ? '선택 기간' : '조회기간'}</span>
                          <span className="text-gray-300 text-[11px] font-bold">{formatShortDate(displayResult.startDate)} ~ {formatShortDate(displayResult.endDate)}</span>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-sm bg-red-500 shrink-0" />
                            <span className="text-[11px] font-bold text-gray-300">수익</span>
                            <span className={`text-[12px] font-black ${displayResult.profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                              {displayResult.rate > 0 ? '+' : ''}{displayResult.rate.toFixed(2)}%
                            </span>
                            <span className={`text-[10px] font-bold ${displayResult.profit >= 0 ? 'text-red-300/80' : 'text-blue-300/80'}`}>
                              ({displayResult.profit >= 0 ? '+' : ''}{hideAmounts ? '••••••' : formatCurrency(displayResult.profit)})
                            </span>
                          </div>
                          {compStocks.map((comp, ci) => {
                            if (!comp?.active || !comp?.code) return null;
                            const periodRate = displayResult[`comp${ci + 1}PeriodRate`];
                            if (periodRate == null) return null;
                            return (
                              <div key={ci} className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: comp.color || '#10b981' }} />
                                <span className="text-[11px] font-bold" style={{ color: comp.color || '#10b981' }}>{comp.name || comp.code}</span>
                                <span className={`text-[12px] font-black ${periodRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                                  {periodRate >= 0 ? '+' : ''}{periodRate.toFixed(2)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-gray-600 text-[10px]">차트에 마우스를 올리면 상세 값이 표시됩니다</span>
                      )}
                    </div>
                  );
                })()}
                {/* 호버 정보 패널 */}
                <div className="px-4 py-2 border-b border-gray-700/40 bg-[#0a1628]/60 min-h-[34px] flex items-center gap-3 overflow-x-auto shrink-0">
                  {intHoveredPoint ? (
                    <>
                      <span className="text-gray-400 text-[11px] font-bold shrink-0 mr-1">{formatShortDate(intHoveredPoint.label)}</span>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                        {intHoveredPoint.payload
                          .filter(entry => entry.dataKey && entry.value != null)
                          .sort((a, b) => {
                            const order = { evalAmount: 0, returnRate: 1, costAmount: 2 };
                            const ak = order[a.dataKey] ?? (/^comp\d+Rate$/.test(a.dataKey) ? 10 + parseInt(a.dataKey.match(/\d+/)?.[0] || '0', 10) : 99);
                            const bk = order[b.dataKey] ?? (/^comp\d+Rate$/.test(b.dataKey) ? 10 + parseInt(b.dataKey.match(/\d+/)?.[0] || '0', 10) : 99);
                            return ak - bk;
                          })
                          .map((entry, i) => {
                            const isRate = entry.dataKey === 'returnRate' || /^comp\d+Rate$/.test(entry.dataKey);
                            const displayVal = isRate
                              ? `${Number(entry.value) >= 0 ? '+' : ''}${Number(entry.value).toFixed(2)}%`
                              : (hideAmounts ? '••••••' : formatCurrency(entry.value));
                            return (
                              <div key={i} className="flex items-center gap-1.5 shrink-0">
                                <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: entry.color || '#e5e7eb' }} />
                                <span className="text-[11px] font-bold" style={{ color: entry.color || '#e5e7eb' }}>{entry.name}</span>
                                <span className={`text-[11px] ${isRate ? (Number(entry.value) >= 0 ? 'text-red-400' : 'text-blue-400') : 'text-gray-300'}`}>{displayVal}</span>
                              </div>
                            );
                          })}
                      </div>
                    </>
                  ) : (
                    <span className="text-gray-600 text-[10px]">차트에 마우스를 올리면 상세 값이 표시됩니다</span>
                  )}
                </div>
                {/* 차트 영역 */}
                <div className="chart-container-for-drag px-2 pt-2 pb-1 relative select-none h-[260px] sm:h-[300px] md:h-[340px] xl:flex-1">
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <ComposedChart data={intChartData} onMouseDown={handleIntChartMouseDown} onMouseMove={handleIntChartMouseMove} onMouseUp={handleIntChartMouseUp} onMouseLeave={handleIntChartMouseLeave}>
                      <defs>
                        <linearGradient id="intReturnGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="intCostGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6b7280" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#6b7280" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="intEvalGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                      <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={formatVeryShortDate} minTickGap={30} />
                      <YAxis yAxisId="left" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${v.toFixed(1)}%`} width={48} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => (v >= 1e8 ? (v/1e8).toFixed(1)+'억' : (v/1e4).toFixed(0)+'만')} width={55} domain={(() => { if (rightAxisZoom === 0 || intChartData.length === 0) return [0, 'auto']; const vals = intChartData.flatMap(d => [d.costAmount, d.evalAmount]).filter(v => v != null && v > 0); if (vals.length === 0) return [0, 'auto']; const dataMin = Math.min(...vals); return [Math.max(0, dataMin * (rightAxisZoom / 100) * 0.98), 'auto']; })()} />
                      <RechartsTooltip content={() => null} />
                      {/* 역사적 경기침체(NBER) 음영 — 데이터 선보다 먼저 선언해 뒤쪽 배경으로 렌더 */}
                      {recessionBands.map((b, i) => (
                        <ReferenceArea
                          key={`rec-${i}`}
                          yAxisId="left"
                          x1={b.x1}
                          x2={b.x2}
                          fill="#94a3b8"
                          fillOpacity={0.13}
                          stroke="none"
                          label={({ viewBox }) => {
                            const w = viewBox?.width ?? 0;
                            if (w < 48) return null;
                            const cx = (viewBox?.x ?? 0) + w / 2;
                            const ty = (viewBox?.y ?? 0) + 10;
                            return (
                              <text x={cx} y={ty} textAnchor="middle" fill="#94a3b8" fillOpacity={0.75} fontSize={9} fontWeight={600}>{b.label}</text>
                            );
                          }}
                        />
                      ))}
                      <Area yAxisId="right" type="monotone" dataKey="costAmount" name="투자원금" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 3" fill="url(#intCostGrad)" dot={false} activeDot={false} />
                      <Area yAxisId="left" type="monotone" dataKey="returnRate" name="수익률" stroke="#ef4444" strokeWidth={2} fill="url(#intReturnGrad)" dot={false} activeDot={false} />
                      <Area yAxisId="right" type="monotone" dataKey="evalAmount" name="총평가금액" stroke="#60a5fa" strokeWidth={2} fill="url(#intEvalGrad)" dot={false} activeDot={false} />
                      {compStocks.map((comp, ci) => (
                        comp?.active && comp?.code ? (
                          <Line
                            key={`comp-${ci}`}
                            yAxisId="left"
                            type="monotone"
                            dataKey={`comp${ci + 1}Rate`}
                            name={comp.name || `종목${ci + 1}`}
                            stroke={comp.color || '#10b981'}
                            strokeWidth={1.5}
                            dot={false}
                            activeDot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        ) : null
                      ))}
                      {intDepositEvents
                        .filter(e => {
                          const first = intChartData[0]?.date;
                          const last = intChartData[intChartData.length - 1]?.date;
                          return first && last && e.date >= first && e.date <= last;
                        })
                        .map(e => (
                          <ReferenceLine
                            key={`dep-${e.date}`}
                            yAxisId="left"
                            x={e.date}
                            stroke={e.deposits >= e.withdrawals ? 'rgba(74,222,128,0.45)' : 'rgba(248,113,113,0.45)'}
                            strokeWidth={1}
                            strokeDasharray="4 3"
                          />
                        ))
                      }
                      {trackingMarkerDate && (
                        <ReferenceLine
                          yAxisId="left"
                          x={trackingMarkerDate}
                          stroke="#fbbf24"
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                          label={({ viewBox }) => {
                            const lx = viewBox?.x ?? 0;
                            const ly = (viewBox?.y ?? 0) + 9;
                            return (
                              <text x={lx - 5} y={ly} textAnchor="end" fill="#fbbf24" fontSize={9} fontWeight={700}>앱 기록 시작</text>
                            );
                          }}
                        />
                      )}
                      {intHoveredPoint && !intRefAreaLeft && (
                        <ReferenceLine yAxisId="left" x={intHoveredPoint.label} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                      )}
                      {intRefAreaLeft && intRefAreaRight && <ReferenceArea yAxisId="left" x1={intRefAreaLeft} x2={intRefAreaRight} fill="rgba(255,255,255,0.08)" strokeOpacity={0.3} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 px-3 pb-2 pt-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: 'rgba(74,222,128,0.7)' }} />
                    입금일
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: 'rgba(248,113,113,0.7)' }} />
                    출금일
                  </span>
                  {trackingMarkerDate && (
                    <span className="flex items-center gap-1.5 text-[11px] text-amber-400/90">
                      <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: '#fbbf24' }} />
                      앱 기록 시작 ({appTrackingStartDate}) · 이전 데이터는 역추산이라 부정확할 수 있음
                    </span>
                  )}
                  {recessionBands.length > 0 && (
                    <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <span className="inline-block w-4 h-3 rounded-sm" style={{ backgroundColor: 'rgba(148,163,184,0.28)' }} />
                      경기침체(NBER)
                    </span>
                  )}
                </div>
              </div>
            </div>
            )}
            {!sec.donut && (
            <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden mb-8">
              <div className="p-3 bg-[#0f172a] border-b border-gray-700">
                <span className="text-white font-bold text-sm">🍩 자산 카테고리 비중 (통합)</span>
              </div>
              <div className="divide-y divide-gray-700">
                {/* 위: 카테고리 도넛 + 카테고리 표 */}
                <div className="p-4">
                  <div className="text-gray-400 text-xs text-center mb-2 font-semibold">자산 카테고리</div>
                  {intCatDonutData.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 text-xs">카테고리 데이터가 없습니다.</div>
                  ) : (
                    <>
                      <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                        {hoveredIntCatSlice ? (
                          <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredIntCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredIntCatSlice.fill }}>{hoveredIntCatSlice.name} {(hoveredIntCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredIntCatSlice.value)}</span>}</>
                        ) : (
                          <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                        )}
                      </div>
                      <div style={{ height: 480 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={intCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredIntCatSlice(data)} onMouseLeave={() => setHoveredIntCatSlice(null)}>
                              {intCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <table className="w-full text-xs mt-3">
                        <thead className="text-gray-400 border-b border-gray-700">
                          <tr className="text-center">
                            <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                            <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">평가금액</th>
                            <th className="pb-2 px-3">비중</th>
                          </tr>
                        </thead>
                        <tbody>
                          {intCatDonutData.map(({ name, value }, i) => (
                            <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                              <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                                <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                              </td>
                              <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : formatCurrency(value)}</td>
                              <td className="py-1.5 px-3 text-gray-400 text-right">{intTotals.totalEval > 0 ? ((value / intTotals.totalEval) * 100).toFixed(1) : 0}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
                {/* 아래: 종목 도넛 + 종목 표 */}
                <div className="p-4">
                  <div className="text-gray-400 text-xs text-center mb-2 font-semibold">종목별 비중</div>
                  {intHoldingsDonutData.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 text-xs">종목 데이터가 없습니다.</div>
                  ) : (() => {
                    const holdingsTotal = intHoldingsDonutData.reduce((s, x) => s + x.value, 0);
                    const catOrder = intCatDonutData.map(x => x.name);
                    const catValueMap = {};
                    intCatDonutData.forEach(x => { catValueMap[x.name] = x.value; });
                    const grouped = {};
                    intHoldingsDonutData.forEach(item => {
                      if (!grouped[item.category]) grouped[item.category] = [];
                      grouped[item.category].push(item);
                    });
                    const LAST_CATS = ['현금', '예수금'];
                    const groupEntries = Object.entries(grouped).sort(([catA, itemsA], [catB, itemsB]) => {
                      const aLast = LAST_CATS.includes(catA);
                      const bLast = LAST_CATS.includes(catB);
                      if (aLast !== bLast) return aLast ? 1 : -1;
                      if (aLast && bLast) return LAST_CATS.indexOf(catA) - LAST_CATS.indexOf(catB);
                      const idxA = catOrder.indexOf(catA);
                      const idxB = catOrder.indexOf(catB);
                      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                      if (idxA !== -1) return -1;
                      if (idxB !== -1) return 1;
                      return itemsB.reduce((s, x) => s + x.value, 0) - itemsA.reduce((s, x) => s + x.value, 0);
                    });
                    const hsk = holdingsSortConfig.key, hsd = holdingsSortConfig.direction;
                    let sortedFlatItems = null;
                    if (hsk) {
                      const getSortVal = (item) => {
                        if (hsk === 'name') return item.name;
                        if (hsk === 'value') return item.value;
                        if (hsk === 'profit') return item.value - item.cost;
                        if (hsk === 'profitRate') return item.cost > 0 ? (item.value - item.cost) / item.cost * 100 : 0;
                        return 0;
                      };
                      sortedFlatItems = groupEntries.flatMap(([, items]) => items).slice().sort((a, b) => {
                        const va = getSortVal(a), vb = getSortVal(b);
                        if (typeof va === 'string') return va.localeCompare(vb) * hsd;
                        return (va - vb) * hsd;
                      });
                    }
                    const parseHex = (hex) => {
                      if (!hex || !hex.startsWith('#') || hex.length < 7) return null;
                      const r = parseInt(hex.slice(1, 3), 16) / 255;
                      const g = parseInt(hex.slice(3, 5), 16) / 255;
                      const b = parseInt(hex.slice(5, 7), 16) / 255;
                      const max = Math.max(r, g, b), min = Math.min(r, g, b);
                      const l = (max + min) / 2;
                      if (max === min) return [0, 0, l * 100];
                      const d = max - min;
                      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                      let h;
                      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                      else if (max === g) h = ((b - r) / d + 2) / 6;
                      else h = ((r - g) / d + 4) / 6;
                      return [h * 360, s * 100, l * 100];
                    };
                    const genShades = (baseHex, count) => {
                      const hsl = parseHex(baseHex);
                      if (!hsl || count === 1) return Array(count).fill(baseHex);
                      const [h, s, l] = hsl;
                      return Array.from({ length: count }, (_, i) => {
                        const t = i / (count - 1);
                        const shade = Math.min(78, Math.max(28, l + 18 - t * 36));
                        return `hsl(${h.toFixed(0)},${Math.min(100, s + 5).toFixed(0)}%,${shade.toFixed(0)}%)`;
                      });
                    };
                    const itemColorMap = {};
                    const catBaseColorMap = {};
                    groupEntries.forEach(([cat, items], gi) => {
                      const catIdx = catOrder.indexOf(cat);
                      const baseHex = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || UI_CONFIG.COLORS.CHART_PALETTE[catIdx !== -1 ? catIdx % 8 : gi % 8];
                      catBaseColorMap[cat] = baseHex;
                      const shades = genShades(baseHex, items.length);
                      items.forEach((item, j) => { itemColorMap[`${cat}::${item.name}`] = shades[j]; });
                    });
                    const totalDenom = intTotals.totalEval > 0 ? intTotals.totalEval : holdingsTotal;
                    const groupedDonutData = groupEntries.flatMap(([, items]) => items);
                    let rowNum = 0;
                    const nonCashItems = intHoldingsDonutData.filter(x => !LAST_CATS.includes(x.category));
                    const totalProfit = nonCashItems.reduce((s, x) => s + (x.value - x.cost), 0);
                    const totalCostForProfit = nonCashItems.reduce((s, x) => s + x.cost, 0);
                    const overallProfitRate = totalCostForProfit > 0 ? (totalProfit / totalCostForProfit * 100) : null;
                    return (
                      <>
                        <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                          {hoveredIntHoldSlice ? (
                            <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredIntHoldSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredIntHoldSlice.fill }}>{hoveredIntHoldSlice.name} {(hoveredIntHoldSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredIntHoldSlice.value)}</span>}</>
                          ) : (
                            <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                          )}
                        </div>
                        <div style={{ height: 480 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={groupedDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredIntHoldSlice(data)} onMouseLeave={() => setHoveredIntHoldSlice(null)}>
                                {groupedDonutData.map((entry, i) => (
                                  <Cell key={i} fill={itemColorMap[`${entry.category}::${entry.name}`] || catBaseColorMap[entry.category] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />
                                ))}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="overflow-x-auto mt-3">
                        <table className="w-full text-xs min-w-[780px]">
                          <thead className="text-gray-400 border-b border-gray-700">
                            <tr className="text-center">
                              <th className="pb-2 px-2 border-r border-gray-700 cursor-pointer hover:bg-gray-700/50 whitespace-nowrap" onClick={() => handleHoldingsSort(null)} title="클릭하여 정렬 초기화">구분</th>
                              <th className="pb-2 px-2 border-r border-gray-700 sticky left-0 z-20 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)] cursor-pointer hover:bg-gray-700/50 whitespace-nowrap" onClick={() => handleHoldingsSort('name')}>종목</th>
                              <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400 cursor-pointer hover:bg-gray-700/50 whitespace-nowrap" onClick={() => handleHoldingsSort('value')}>평가금액</th>
                              <th className="pb-2 px-3 border-r border-gray-700 cursor-pointer hover:bg-gray-700/50 whitespace-nowrap" onClick={() => handleHoldingsSort('value')}>비중</th>
                              <th className="pb-2 px-3 border-r border-gray-700 cursor-pointer hover:bg-gray-700/50 whitespace-nowrap" onClick={() => handleHoldingsSort('profit')}>수익</th>
                              <th className="pb-2 px-3 border-r border-gray-700 cursor-pointer hover:bg-gray-700/50 whitespace-nowrap" onClick={() => handleHoldingsSort('profitRate')}>수익률</th>
                              <th className="pb-2 px-2 border-r border-gray-700 text-sky-400/80 text-[10px]">비중1위<div className="text-[9px] text-gray-600 font-normal">종목·비중 / PER·선행PER</div>{(Object.values(holdingsFetchDate)[0] as string) && <div className="text-[9px] text-gray-600/60 font-normal">확인: {Object.values(holdingsFetchDate)[0] as string}</div>}</th>
                              <th className="pb-2 px-2 border-r border-gray-700 text-sky-400/80 text-[10px]">비중2위<div className="text-[9px] text-gray-600 font-normal">종목·비중 / PER·선행PER</div></th>
                              <th className="pb-2 px-2 text-sky-400/80 text-[10px]">비중3위<div className="text-[9px] text-gray-600 font-normal">종목·비중 / PER·선행PER</div></th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const renderItemCells = (item, cat, num) => {
                                const catColor = catBaseColorMap[cat];
                                const isLastCat = LAST_CATS.includes(cat);
                                const itemColor = itemColorMap[`${cat}::${item.name}`] || catColor;
                                const profit = item.value - item.cost;
                                const profitRate = item.cost > 0 ? (profit / item.cost) * 100 : null;
                                const profitColor = profit > 0 ? 'text-red-400' : profit < 0 ? 'text-blue-400' : 'text-gray-400';
                                const info = etfInfoMap[item.name];
                                return (<>
                                  <td className="py-1.5 px-2 text-center border-r border-gray-700 sticky left-0 z-10 bg-[#1e293b] group-hover:bg-[#1d2d40] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]">
                                    {getStockUrl(item.code, item.category)
                                      ? <a href={getStockUrl(item.code, item.category)} target="_blank" rel="noopener noreferrer" style={{ color: itemColor }} className="hover:underline">{num}. {item.name}</a>
                                      : <span style={{ color: itemColor }}>{num}. {item.name}</span>
                                    }
                                    {item.code && <div className="text-[9px] text-gray-600 mt-0.5">({item.code})</div>}
                                  </td>
                                  <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : formatCurrency(item.value)}</td>
                                  <td className="py-1.5 px-3 border-r border-gray-700 text-gray-400 text-right">{totalDenom > 0 ? ((item.value / totalDenom) * 100).toFixed(1) : 0}%</td>
                                  {isLastCat ? (
                                    <>
                                      <td className="py-1.5 px-3 border-r border-gray-700 text-gray-600 text-right">-</td>
                                      <td className="py-1.5 px-3 border-r border-gray-700 text-gray-600 text-right">-</td>
                                    </>
                                  ) : (
                                    <>
                                      <td className={`py-1.5 px-3 border-r border-gray-700 font-bold text-right ${profitColor}`}>
                                        {hideAmounts ? '••••••' : (<><span className="text-[9px] mr-0.5">{profit >= 0 ? '▲' : '▼'}</span>{formatCurrency(Math.abs(profit))}</>)}
                                      </td>
                                      <td className={`py-1.5 px-3 border-r border-gray-700 font-bold text-right ${profitColor}`}>
                                        {profitRate !== null ? (<><span className="text-[9px] mr-0.5">{profitRate >= 0 ? '▲' : '▼'}</span>{Math.abs(profitRate).toFixed(2)}%</>) : '-'}
                                      </td>
                                    </>
                                  )}
                                  {(() => {
                                    if (info === 'loading') return <td colSpan={3} className="py-1.5 px-2 text-center text-gray-600 align-middle"><span className="text-[9px] animate-pulse">…</span></td>;
                                    if (Array.isArray(info)) {
                                      return [0, 1, 2].map(idx => {
                                        const h = info[idx];
                                        const isLast = idx === 2;
                                        if (!h) return <td key={idx} className={`py-1.5 px-2 text-center text-gray-700 align-middle${isLast ? '' : ' border-r border-gray-700'}`}>—</td>;
                                        return (
                                          <td key={idx} className={`py-1.5 px-2 align-middle${isLast ? '' : ' border-r border-gray-700'}`}>
                                            <div className="flex flex-col items-center gap-0 leading-tight">
                                              <div className="flex items-center gap-1 whitespace-nowrap">
                                                {getStockUrl(h.code)
                                                  ? <a href={getStockUrl(h.code)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-300 font-medium hover:text-sky-300 hover:underline">{h.name.length > 8 ? h.name.slice(0, 8) + '…' : h.name}</a>
                                                  : <span className="text-[10px] text-gray-300 font-medium">{h.name.length > 8 ? h.name.slice(0, 8) + '…' : h.name}</span>
                                                }
                                                <span className="text-[9px] text-gray-600">|</span>
                                                <span className="text-[9px] text-gray-500">{h.ratio > 0 ? h.ratio.toFixed(1) + '%' : '—'}</span>
                                              </div>
                                              <div className="flex items-center gap-1 whitespace-nowrap">
                                                <span className="text-[9px] text-gray-400">{h.per != null ? h.per.toFixed(2) : '—'}</span>
                                                <span className="text-[9px] text-gray-600">|</span>
                                                <span className="text-[9px] text-gray-400">{h.fper != null ? h.fper.toFixed(2) : '—'}</span>
                                              </div>
                                            </div>
                                          </td>
                                        );
                                      });
                                    }
                                    if (info?.isStock) {
                                      const hasAny = info.per != null || info.fper != null;
                                      return (
                                        <td colSpan={3} className="py-1.5 px-3 text-center align-middle">
                                          {hasAny ? (
                                            <span className="text-[10px] text-gray-500">
                                              <span className="text-gray-300">{info.per != null ? info.per.toFixed(2) : '—'}</span>
                                              <span className="mx-1.5 text-gray-700">|</span>
                                              <span className="text-gray-300">{info.fper != null ? info.fper.toFixed(2) : '—'}</span>
                                            </span>
                                          ) : (
                                            <span className="text-[9px] text-gray-700">—</span>
                                          )}
                                        </td>
                                      );
                                    }
                                    return <td colSpan={3} className="py-1.5 px-2 text-center text-gray-700 align-middle">—</td>;
                                  })()}
                                </>);
                              };

                              if (sortedFlatItems) {
                                return sortedFlatItems.map((item) => {
                                  rowNum += 1;
                                  const cat = item.category;
                                  const catColor = catBaseColorMap[cat];
                                  return (
                                    <tr key={`sorted-${cat}-${item.name}`} className="group hover:bg-gray-800/30 border-b border-gray-700/30">
                                      <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700 align-middle whitespace-nowrap">
                                        <span style={{ color: catColor }}>{cat}</span>
                                      </td>
                                      {renderItemCells(item, cat, rowNum)}
                                    </tr>
                                  );
                                });
                              }

                              return groupEntries.flatMap(([cat, items]) => {
                                const catColor = catBaseColorMap[cat];
                                const catDisplayValue = catValueMap[cat] ?? items.reduce((s, x) => s + x.value, 0);
                                return items.map((item, j) => {
                                  rowNum += 1;
                                  return (
                                    <tr key={`${cat}-${item.name}`} className={`group hover:bg-gray-800/30 ${j === items.length - 1 ? 'border-b border-gray-700' : 'border-b border-gray-700/30'}`}>
                                      {j === 0 && (
                                        <td rowSpan={items.length} className="py-1.5 px-2 text-center font-bold border-r border-gray-700 border-b border-gray-700 align-middle">
                                          <div style={{ color: catColor }}>{cat}</div>
                                          <div className="text-gray-500 font-normal mt-0.5">{hideAmounts ? '••••••' : formatCurrency(catDisplayValue)}</div>
                                          <div className="text-gray-500 font-normal">{totalDenom > 0 ? ((catDisplayValue / totalDenom) * 100).toFixed(1) : 0}%</div>
                                        </td>
                                      )}
                                      {renderItemCells(item, cat, rowNum)}
                                    </tr>
                                  );
                                });
                              });
                            })()}
                          </tbody>
                          <tfoot className="border-t-2 border-gray-600 bg-gray-800/20">
                            <tr className="text-center">
                              <td className="py-2 px-2 border-r border-gray-700 text-gray-400 font-bold">합계</td>
                              <td className="py-2 px-2 border-r border-gray-700 text-gray-500 sticky left-0 z-10 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]">—</td>
                              <td className="py-2 px-3 border-r border-gray-700 text-yellow-400 font-bold text-right">{hideAmounts ? '••••••' : formatCurrency(holdingsTotal)}</td>
                              <td className="py-2 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{totalDenom > 0 ? ((holdingsTotal / totalDenom) * 100).toFixed(1) : 0}%</td>
                              <td className={`py-2 px-3 border-r border-gray-700 font-bold text-right ${totalProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                                {hideAmounts ? '••••••' : (<><span className="text-[9px] mr-0.5">{totalProfit >= 0 ? '▲' : '▼'}</span>{formatCurrency(Math.abs(totalProfit))}</>)}
                              </td>
                              <td className={`py-2 px-3 border-r border-gray-700 font-bold text-right ${overallProfitRate !== null && overallProfitRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                                {overallProfitRate !== null ? (<><span className="text-[9px] mr-0.5">{overallProfitRate >= 0 ? '▲' : '▼'}</span>{Math.abs(overallProfitRate).toFixed(2)}%</>) : '-'}
                              </td>
                              <td colSpan={3} className="py-2 px-2 text-center text-gray-700">—</td>
                            </tr>
                          </tfoot>
                        </table>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
            )}
            {userFeatures.feature3 && !sec.dividend && (
              <DividendSummaryTable compact portfolios={allPortfoliosForDividend} updatePortfolioDividendHistory={updatePortfolioDividendHistory} updatePortfolioActualDividend={updatePortfolioActualDividend} updatePortfolioDividendTaxRate={updatePortfolioDividendTaxRate} updatePortfolioDividendSeparateTax={updatePortfolioDividendSeparateTax} updatePortfolioDividendTaxAmount={updatePortfolioDividendTaxAmount} updatePortfolioActualDividendUsd={updatePortfolioActualDividendUsd} updatePortfolioActualAfterTaxUsd={updatePortfolioActualAfterTaxUsd} updatePortfolioActualAfterTaxKrw={updatePortfolioActualAfterTaxKrw} usdkrw={usdkrw} holidays={holidays} dividendTaxHistory={dividendTaxHistory} hiddenMonths={intHiddenDivMonths} onToggleHiddenMonth={onToggleIntHiddenDivMonth} />
            )}
              </div>
              <div className="sticky top-14 self-start flex flex-col gap-px flex-shrink-0 z-10 pt-3">
                <button onClick={() => toggleSec('history')} style={{ writingMode: 'vertical-lr' }}
                  className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sec.history ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>
                  추이·차트
                </button>
                <button onClick={() => toggleSec('donut')} style={{ writingMode: 'vertical-lr' }}
                  className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sec.donut ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>
                  자산카테고리
                </button>
                {userFeatures.feature3 && (
                <button onClick={() => toggleSec('dividend')} style={{ writingMode: 'vertical-lr' }}
                  className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sec.dividend ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>
                  분배금 현황
                </button>
                )}
              </div>
            </div>

          </div>
      {histDetailDate && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70" onClick={() => setHistDetailDate(null)}>
          <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-2xl w-full max-w-4xl mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#0f172a] border-b border-gray-700 shrink-0">
              <span className="text-white font-bold text-sm">📊 {formatShortDate(histDetailDate)} — 계좌별 현황</span>
              <button onClick={() => setHistDetailDate(null)} className="text-gray-400 hover:text-white transition-colors"><X size={16} /></button>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 z-10">
                  <tr>
                    <th className="py-2 px-3 text-left border-r border-gray-700">계좌</th>
                    <th className="py-2 px-2 text-right border-r border-gray-700 whitespace-nowrap">투자원금</th>
                    <th className="py-2 px-2 text-right border-r border-gray-700 whitespace-nowrap">평가금액</th>
                    <th className="py-2 px-2 text-center border-r border-gray-700">비중</th>
                    <th className="py-2 px-2 text-right border-r border-gray-700 whitespace-nowrap">예수금</th>
                    <th className="py-2 px-2 text-right border-r border-gray-700">수익</th>
                    <th className="py-2 px-2 text-right">수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {histDetailRows.rows.map((r, i) => (
                    <tr key={r.id} className={`border-b border-gray-700/50 ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                      <td className="py-2 px-3 text-left border-r border-gray-700">
                        <div className="flex items-center gap-1.5">
                          {r.rowColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.rowColor }} />}
                          <span className="text-gray-200 font-medium truncate max-w-[130px]">{r.name}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right text-gray-400 border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(r.principal)}</td>
                      <td className="py-2 px-2 text-right text-white font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(r.evalAmount)}</td>
                      <td className="py-2 px-2 text-center text-gray-300 border-r border-gray-700">{histDetailRows.totalEval > 0 ? formatPercent(r.evalAmount / histDetailRows.totalEval * 100) : '-'}</td>
                      <td className="py-2 px-2 text-right text-gray-400 border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(r.depositAmount)}</td>
                      <td className={`py-2 px-2 text-right border-r border-gray-700 font-bold ${r.profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{hideAmounts ? '••••••' : formatCurrency(r.profit)}</td>
                      <td className={`py-2 px-2 text-right font-bold ${r.returnRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatPercent(r.returnRate)}</td>
                    </tr>
                  ))}
                  {histDetailRows.rows.length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center text-gray-500">해당 날짜 데이터 없음</td></tr>
                  )}
                </tbody>
                {histDetailRows.rows.length > 0 && (
                  <tfoot className="border-t border-gray-600 bg-gray-800/60">
                    <tr>
                      <td className="py-2 px-3 text-gray-300 font-bold border-r border-gray-700">소계</td>
                      <td className="py-2 px-2 text-right text-gray-300 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(histDetailRows.totalPrincipal)}</td>
                      <td className="py-2 px-2 text-right text-yellow-400 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(histDetailRows.totalEval)}</td>
                      <td className="py-2 px-2 text-center text-gray-300 font-bold border-r border-gray-700">100%</td>
                      <td className="py-2 px-2 text-right text-gray-400 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(histDetailRows.totalDeposit)}</td>
                      <td className={`py-2 px-2 text-right font-bold border-r border-gray-700 ${histDetailRows.totalEval - histDetailRows.totalPrincipal >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {hideAmounts ? '••••••' : formatCurrency(histDetailRows.totalEval - histDetailRows.totalPrincipal)}
                      </td>
                      <td className={`py-2 px-2 text-right font-bold ${histDetailRows.totalPrincipal > 0 && (histDetailRows.totalEval - histDetailRows.totalPrincipal) / histDetailRows.totalPrincipal * 100 >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {histDetailRows.totalPrincipal > 0 ? formatPercent((histDetailRows.totalEval - histDetailRows.totalPrincipal) / histDetailRows.totalPrincipal * 100) : '-'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
      {memoModal && (
        <div className="fixed inset-0 z-50 bg-black/40">
          <div className="absolute w-64 shadow-2xl overflow-hidden" style={{ left: memoPos.x, top: memoPos.y }} onClick={e => e.stopPropagation()}>
            <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none" onMouseDown={handleMemoDragStart}>
              <div className="flex items-center gap-3">
                <button onClick={() => setMemoModal(null)} className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center group transition-all" title="취소 (Esc)">
                  <X size={10} className="text-white" />
                </button>
                <button onClick={saveMemoModal} className="w-[18px] h-[18px] rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center group transition-all" title="저장 (Ctrl+Enter)">
                  <Check size={10} className="text-white" />
                </button>
              </div>
              <span className="text-[11px] font-bold tracking-[0.25em] bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 bg-clip-text text-transparent select-none">MEMO</span>
              <div className="w-10" />
            </div>
            <textarea
              className="w-full text-gray-200 text-[12px] outline-none resize-none caret-purple-400 placeholder-gray-700"
              style={{
                backgroundColor: '#000',
                backgroundImage: `repeating-linear-gradient(transparent 0px, transparent 23px, rgba(99,130,255,0.3) 23px, rgba(99,130,255,0.3) 24px)`,
                backgroundSize: '100% 24px',
                backgroundPosition: '0 8px',
                lineHeight: '24px',
                paddingLeft: '10px',
                paddingRight: '10px',
                paddingTop: '8px',
                paddingBottom: '8px',
              }}
              rows={10}
              autoFocus
              placeholder="메모를 입력하세요..."
              value={memoModal.val}
              onChange={e => setMemoModal(prev => ({ ...prev, val: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Escape') setMemoModal(null);
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveMemoModal();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
