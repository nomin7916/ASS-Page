// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ClipboardPaste, Plus,
  X, Trash2, Download, Calendar,
  Minus, ArrowDownToLine, Triangle, Activity, Search,
  BarChart2, Percent, PanelLeft, PanelLeftClose
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ComposedChart, Line, Area, XAxis,
  YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceArea, Label
} from 'recharts';
import { UI_CONFIG, GOOGLE_CLIENT_ID, ADMIN_EMAIL, APPS_SCRIPT_URL } from './config';
import { DRIVE_FILES, getOrCreateIndexFolder, saveDriveFile, loadDriveFile, MAX_BACKUPS, findUserIndexFolder, saveVersionedBackup } from './driveStorage';
import Header from './components/Header';
import PortfolioTable from './components/PortfolioTable';
import KrxGoldTable from './components/KrxGoldTable';
import MarketIndicators from './components/MarketIndicators';
import LoginGate, { verifyPin, savePin, hashPin, savePinToDrive, PIN_KEY, SESSION_KEY, UserFeatures } from './components/LoginGate';
import AdminPage from './components/AdminPage';
import AdminNotificationModal, { AdminNotification } from './components/AdminNotificationModal';
import IntegratedDashboard from './components/IntegratedDashboard';
import HistoryPanel from './components/HistoryPanel';
import DepositPanel from './components/DepositPanel';
import PortfolioChart from './components/PortfolioChart';
import RebalancingPanel from './components/RebalancingPanel';
import PinChangeModal from './components/PinChangeModal';
import ScaleSettingModal from './components/ScaleSettingModal';
import DriveBackupModal from './components/DriveBackupModal';
import UnlockPinModal from './components/UnlockPinModal';
import PasteModal from './components/PasteModal';
import PortfolioSummaryPanel from './components/PortfolioSummaryPanel';
import PortfolioStatsPanel from './components/PortfolioStatsPanel';
import AccountTabBar from './components/AccountTabBar';
import UserInfoBar from './components/UserInfoBar';
import DividendSummaryTable from './components/DividendSummaryTable';
import DividendTaxPage from './components/DividendTaxPage';
import NotificationBar from './components/NotificationBar';
import ConfirmDialog from './components/ConfirmDialog';
import { useDriveSync } from './hooks/useDriveSync';
import { useMarketData, defaultCompStocks } from './hooks/useMarketData';
import { usePortfolioState } from './hooks/usePortfolioState';
import { useHistoryChart } from './hooks/useHistoryChart';
import { useChartInteraction } from './hooks/useChartInteraction';
import { useStockData } from './hooks/useStockData';
import { usePinManager } from './hooks/usePinManager';
import { useToast } from './hooks/useToast';
import { useHistoryBackfill } from './hooks/useHistoryBackfill';
import { useIndexImport } from './hooks/useIndexImport';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useIntegratedData } from './hooks/useIntegratedData';
import { useMarketCalendar, getTodayKST } from './hooks/useMarketCalendar';
import {
  generateId, cleanNum, formatCurrency, formatPercent, formatNumber,
  formatChangeRate, formatShortDate, formatVeryShortDate, getSeededRandom,
  getClosestValue, getIndexLatest, handleTableKeyDown, handleReadonlyCellNav, buildIndexStatus,
  hexToRgba, blendWithDarkBg, downloadCSV, buildHistoryCSV, buildLookupCSV, buildDepositCSV,
  fillWeekendGaps, fillNonTradingGaps, calcPeriodStart
} from './utils';

import { INT_CATEGORIES, ACCOUNT_TYPE_CONFIG } from './constants';


export default function App() {
  const historyInputRef = useRef(null);

  // ── 인증 상태 ──
  const [authUser, setAuthUser] = useState<{ email: string; token: string } | null>(null);
  const [userFeatures, setUserFeatures] = useState<UserFeatures>({ name: '', feature1: false, feature2: false, feature3: false });
  const [showAdminPage, setShowAdminPage] = useState(false);
  const [showDividendTaxPage, setShowDividendTaxPage] = useState(false);
  const [dividendTaxHistory, setDividendTaxHistory] = useState<Record<string, any>>({});
  const [adminViewingAs, setAdminViewingAs] = useState<string | null>(null);
  const [pendingAdminNotifs, setPendingAdminNotifs] = useState<AdminNotification[]>([]);
  const adminOwnDriveTokenRef = useRef<string>('');
  const adminViewingAsRef = useRef<string | null>(null);
  const {
    showPinChange, setShowPinChange,
    pinChangeSaving, setPinChangeSaving,
    pinCurrent, setPinCurrent,
    pinNew, setPinNew,
    pinConfirm, setPinConfirm,
    pinChangeError, setPinChangeError,
    openPinChange,
  } = usePinManager();

  const handleLoginApproved = (email: string, token: string, features: UserFeatures) => {
    setAuthUser({ email, token });
    setUserFeatures(features);
  };

  const handleAdminViewUser = (targetEmail: string) => {
    setShowAdminPage(false);
    const tryInit = (retries = 20) => {
      if ((window as any).google?.accounts?.oauth2) {
        // 관리자 자신의 계정으로 drive 스코프 토큰 요청 — 공유받은 폴더 읽기/쓰기 가능
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile https://www.googleapis.com/auth/drive',
          hint: authUser.email,
          callback: async (resp: any) => {
            if (resp.error || !resp.access_token) {
              notify('관리자 Drive 인증 실패. 다시 시도해 주세요.', 'error');
              setShowAdminPage(true);
              return;
            }
            const adminToken = resp.access_token;
            // 대상 사용자가 공유한 Index_Data 폴더 찾기
            const userFolderId = await findUserIndexFolder(adminToken, targetEmail);
            if (!userFolderId) {
              notify(`${targetEmail} 사용자의 Drive 폴더를 찾을 수 없습니다. 해당 사용자가 관리자 접근을 허용했는지 확인하세요.`, 'error');
              setShowAdminPage(true);
              return;
            }
            // 접속 허용 여부 확인
            try {
              const stateData = await loadDriveFile(adminToken, userFolderId, DRIVE_FILES.STATE) as any;
              const isAllowed = !stateData || stateData.adminAccessAllowed !== false;
              setUserAccessStatus(prev => ({ ...prev, [targetEmail]: isAllowed }));
              if (!isAllowed) {
                notify(`${targetEmail} 사용자가 관리자 접속을 허용하지 않았습니다.`, 'warning');
                setShowAdminPage(true);
                return;
              }
            } catch {
              setUserAccessStatus(prev => ({ ...prev, [targetEmail]: true }));
            }
            // 전환 전 관리자 자신의 현재 상태를 Drive에 백업 (복구 수단 확보)
            const snapBeforeSwitch = saveStateRef.current;
            if (snapBeforeSwitch?.portfolios?.length > 0 && driveTokenRef.current) {
              await saveAllToDrive({ ...snapBeforeSwitch, portfolioUpdatedAt: Date.now() }, 'auto');
            }
            // 전환 전체 구간 동안 저장 차단 (React 렌더 완료까지 보호)
            adminTransitioningRef.current = true;
            adminOwnDriveTokenRef.current = driveTokenRef.current;
            adminViewingAsRef.current = targetEmail;
            setAdminViewingAs(targetEmail);
            isInitialLoad.current = true;
            driveTokenRef.current = adminToken;
            setDriveToken(adminToken);
            driveFolderIdRef.current = userFolderId;
            await loadFromDrive(adminToken);
            isInitialLoad.current = false;
            // 500ms 후 해제 — React가 사용자 데이터로 saveStateRef를 갱신할 충분한 시간
            setTimeout(() => { adminTransitioningRef.current = false; }, 500);
          },
        });
        client.requestAccessToken({ prompt: '' });
      } else if (retries > 0) {
        setTimeout(() => tryInit(retries - 1), 300);
      } else {
        notify('Google 인증 초기화 실패', 'error');
        setShowAdminPage(true);
      }
    };
    tryInit();
  };

  const handleReturnToAdminPage = async () => {
    // 전환 시작 즉시 저장 차단 — adminViewingAsRef 해제 후 React 렌더 전 사이의 race condition 방지
    adminTransitioningRef.current = true;
    const ownToken = adminOwnDriveTokenRef.current;
    const viewedEmail = adminViewingAsRef.current;
    if (viewedEmail) {
      ['portfolioState', 'portfolioStockData', 'portfolioMarketData']
        .forEach(p => localStorage.removeItem(`${p}_v5_${viewedEmail}`));
    }
    adminOwnDriveTokenRef.current = '';
    // adminViewingAsRef는 loadFromDrive 완료 후 해제 — 로드 중 저장 가드 역할 유지
    isInitialLoad.current = true;
    driveTokenRef.current = ownToken;
    setDriveToken(ownToken);
    driveFolderIdRef.current = '';
    await loadFromDrive(ownToken);
    // 관리자 데이터 로드 완료 후 뷰 상태 해제
    adminViewingAsRef.current = null;
    setAdminViewingAs(null);
    isInitialLoad.current = false;
    setShowAdminPage(true);
    // 500ms 후 전환 가드 해제 — React가 관리자 데이터로 saveStateRef를 갱신할 충분한 시간
    // 이 시간 동안 visibilitychange 등으로 saveAllToDrive가 호출돼도 차단됨
    setTimeout(() => { adminTransitioningRef.current = false; }, 500);
  };

  const [historyLimit, setHistoryLimit] = useState(UI_CONFIG.DEFAULTS.HISTORY_LIMIT);
  const [comparisonMode, setComparisonMode] = useState('latestOverPast');
  const [isLinkSettingsOpen, setIsLinkSettingsOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 1 });
  const [rebalanceSortConfigMap, setRebalanceSortConfigMap] = useState<Record<string, { key: string | null, direction: number }>>({});
  const [rebalExtraQty, setRebalExtraQty] = useState<Record<string, number>>({});
  
  const { notify, notificationLog, setNotificationLog, clearNotificationLog, unreadCount, markAsRead, confirmState, confirm, resolveConfirm } = useToast();
  const { isMarketOpen, holidays: marketHolidays, loaded: calendarLoaded } = useMarketCalendar();

  const [userAccessStatus, setUserAccessStatus] = useState<Record<string, boolean>>({});

  const portfolioRef = useRef([]);
  const portfoliosRef = useRef([]);
  const marketIndicatorsRef = useRef({});
  const activePortfolioAccountTypeRef = useRef('portfolio'); // 클로저 문제 해결용 (20분 인터벌 등)
  const activePortfolioIdRef = useRef<string | null>(null);
  const stockHistoryMapRef = useRef<Record<string, Record<string, number>>>({}); // 클로저 문제 해결용
  const didSwitchPortfolioRef = useRef(false); // 탭 전환 시 최초 마운트 skip용
  const saveStateRef = useRef<Record<string, any>>({}); // 항상 최신 state 스냅샷 유지
  // applyStateData/applyStockData/applyBackupData 콜백 ref (useDriveSync → useMarketData 순환 의존 해소)
  const applyStateDataRef = useRef<Function | null>(null);
  const applyStockDataRef = useRef<Function | null>(null);
  const applyBackupDataRef = useRef<Function | null>(null);
  const refreshPricesRef = useRef<Function | null>(null);
  // 계좌별 차트 상태 독립 관리
  const currentChartStateRef = useRef<any>({ showKospi: true, showSp500: false, showNasdaq: false, showIndicatorsInChart: { us10y: false, kr10y: false, goldIntl: false, goldKr: false, usdkrw: false, dxy: false, fedRate: false, vix: false, btc: false, eth: false }, goldIndicators: { goldIntl: true, goldKr: true, usdkrw: false, dxy: false }, goldIndicatorColors: { goldIntl: '#ffd60a', goldKr: '#ff9f0a', usdkrw: '#0a84ff', dxy: '#5ac8fa' }, compStocks: [], chartPeriod: '3m', dateRange: { start: '', end: '' }, appliedRange: { start: '', end: '' }, backtestColor: '#f97316', showBacktest: false });
  const accountChartStatesRef = useRef<Record<string, any>>({});
  const prevActivePortfolioIdRef = useRef<string | null>(null);

  // ── 통합 대시보드 ──
  const [showIntegratedDashboard, setShowIntegratedDashboard] = useState(true);
  const [intExpandedCat, setIntExpandedCat] = useState(null);
  const [simpleEditField, setSimpleEditField] = useState<{id: string, field: string} | null>(null);
  const [showNewAccountMenu, setShowNewAccountMenu] = useState(false);
  const [showUnlockPinModal, setShowUnlockPinModal] = useState(false);
  const [unlockPinDigits, setUnlockPinDigits] = useState(['', '', '', '']);
  const [unlockPinError, setUnlockPinError] = useState('');
  const [sectionCollapsedMap, setSectionCollapsedMap] = useState({});
  const [intSec, setIntSec] = useState({ dividend: false, history: false, donut: false });

  // ── useHistoryChart 훅 ──
  const {
    chartPeriod, setChartPeriod,
    dateRange, setDateRange,
    appliedRange, setAppliedRange,
    isDragging, setIsDragging,
    refAreaLeft, setRefAreaLeft,
    refAreaRight, setRefAreaRight,
    selectionResult, setSelectionResult,
    showTotalEval, setShowTotalEval,
    showReturnRate, setShowReturnRate,
    showBacktest, setShowBacktest,
    backtestColor, setBacktestColor,
    isZeroBaseMode, setIsZeroBaseMode,
    hoveredPoint, setHoveredPoint,
    hoveredPortCatSlice, setHoveredPortCatSlice,
    hoveredPortStkSlice, setHoveredPortStkSlice,
    hoveredIntCatSlice, setHoveredIntCatSlice,
    hoveredIntHoldSlice, setHoveredIntHoldSlice,
    hoveredRebalCatSlice, setHoveredRebalCatSlice,
    hoveredCurCatSlice, setHoveredCurCatSlice,
    showKospi, setShowKospi,
    showSp500, setShowSp500,
    showNasdaq, setShowNasdaq,
    showIndicatorsInChart, setShowIndicatorsInChart,
    goldIndicators, setGoldIndicators,
    goldIndicatorColors, setGoldIndicatorColors,
    indicatorScales, setIndicatorScales,
    isScaleSettingOpen, setIsScaleSettingOpen,
    showMarketPanel, setShowMarketPanel,
    hideAmounts, setHideAmounts,
    intChartPeriod, setIntChartPeriod,
    intDateRange, setIntDateRange,
    intAppliedRange, setIntAppliedRange,
    intRefAreaLeft, setIntRefAreaLeft,
    intRefAreaRight, setIntRefAreaRight,
    intSelectionResult, setIntSelectionResult,
    intIsDragging, setIntIsDragging,
    intIsZeroBaseMode, setIntIsZeroBaseMode,
    intHoveredPoint, setIntHoveredPoint,
  } = useHistoryChart();

  // ── useDriveSync 훅 ──
  const {
    driveStatus, setDriveStatus,
    driveToken, setDriveToken,
    showBackupModal, setShowBackupModal,
    backupList, setBackupList,
    backupListLoading, setBackupListLoading,
    applyingBackupId, setApplyingBackupId,
    driveTokenRef, driveFolderIdRef, tokenClientRef, pendingTokenResolveRef,
    isInitialLoad, driveSaveTimerRef, portfolioUpdatedAtRef, prevPortfolioStructureRef,
    lastDriveSavedPortfolioUpdatedAtRef, driveCheckInProgressRef, lastDriveCheckAtRef,
    goldKrAutoCrawledRef, stooqAutoCrawledRef, adminTransitioningRef,
    ensureDriveFolder, loadFromDrive, loadStockFromDrive, saveAllToDrive, requestDriveToken,
    initTokenClient, checkAndSyncFromDrive,
    handleDriveLoadOnly, handleOpenBackupModal, handleApplyBackup, handleImportStateFile,
  } = useDriveSync({
    authUser,
    applyStateData: (...args) => applyStateDataRef.current?.(...args),
    applyStockData: (...args) => applyStockDataRef.current?.(...args),
    applyBackupData: (...args) => applyBackupDataRef.current?.(...args),
    accountChartStatesRef, saveStateRef, adminViewingAsRef, adminOwnDriveTokenRef, notify, confirm,
  });

  // ── useMarketData 훅 ──
  const {
    indicatorHistoryLoading, setIndicatorHistoryLoading,
    marketIndices, setMarketIndices,
    indicatorHistoryMap, setIndicatorHistoryMap,
    stockHistoryMap, setStockHistoryMap,
    compStocks, setCompStocks,
    stockListingDates, setStockListingDates,
    marketIndicators, setMarketIndicators,
    indicatorLoading, setIndicatorLoading,
    indicatorFetchStatus, setIndicatorFetchStatus,
    showIndicatorVerify, setShowIndicatorVerify,
    indexFetchStatus, setIndexFetchStatus,
    showIndexVerify, setShowIndexVerify,
    stockFetchStatus, setStockFetchStatus,
    autoFetchedCodes,
    fetchersMap,
    retryFailedIndicators,
    fetchIndicatorsViaProxy,
    STOOQ_SYMBOLS,
    INDICATOR_LABELS,
    fetchIndicatorHistory,
    fetchAllIndicatorHistory,
    handleIndicatorUpload,
    fetchMarketIndicators,
    fetchSingleIndexHistory,
  } = useMarketData({ driveStatus, driveTokenRef, ensureDriveFolder, appliedRange, notify, goldKrAutoCrawledRef, stooqAutoCrawledRef });

  // ── usePortfolioState 훅 ──
  const {
    title, setTitle,
    portfolio, setPortfolio,
    principal, setPrincipal,
    avgExchangeRate, setAvgExchangeRate,
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
    activePortfolioAccountType,
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
    updatePortfolioActualDividendUsd,
    updatePortfolioDividendTaxRate,
    updatePortfolioDividendSeparateTax,
    updatePortfolioDividendTaxAmount,
    updatePortfolioActualAfterTaxUsd,
    updatePortfolioActualAfterTaxKrw,
    addPortfolioExtraRow,
    updatePortfolioExtraRowCode,
    deletePortfolioExtraRow,
    updatePortfolioExtraRowMonth,
  } = usePortfolioState({ marketIndicators, notify, confirm, setShowIntegratedDashboard });

  // ── 리밸런싱 정렬 (계좌별 독립) ──
  const rebalanceSortConfig = rebalanceSortConfigMap[activePortfolioId] ?? { key: null, direction: 1 };

  // ── 섹션 접기/펼치기 (계좌별 독립) ──
  const _SEC_DEFAULT = { summary: false, stats: false, dividend: false, chart: false, rebalancing: false, donut: false };
  const sectionCollapsed = { ..._SEC_DEFAULT, ...(sectionCollapsedMap[activePortfolioId] || {}) };
  const toggleSection = (key) => setSectionCollapsedMap(prev => {
    const cur = prev[activePortfolioId] || {};
    return { ...prev, [activePortfolioId]: { ..._SEC_DEFAULT, ...cur, [key]: !(cur[key] ?? false) } };
  });

  // ── Drive 데이터 적용 콜백 (loadFromDrive / handleApplyBackup 에서 호출) ──
  // STOCK 파일은 loadStockFromDrive가 별도 백그라운드 로드 → 여기서는 처리하지 않음
  const applyStateData = (stateData, _stockData, marketData) => {

    if (stateData.portfolios?.length > 0) {
      const normalizedPortfolios = stateData.portfolios.map(p => ({
        ...p,
        startDate: p.portfolioStartDate || p.startDate || '',
        portfolioStartDate: p.portfolioStartDate || p.startDate || '',
        depositHistory: (p.depositHistory || []).map(h => ({ ...h, memo: h.memo ?? '' })),
        depositHistory2: (p.depositHistory2 || []).map(h => ({ ...h, memo: h.memo ?? '' })),
      }));
      setPortfolios(normalizedPortfolios);
      setActivePortfolioId(stateData.activePortfolioId || stateData.portfolios[0].id);
      notify(`계좌 ${normalizedPortfolios.length}개 복구 완료 — 활성화 중`, 'info');
    } else if (stateData.portfolio) {
      const newId = generateId();
      const migrated = {
        id: newId, name: stateData.title || 'DC',
        startDate: stateData.portfolioStartDate || stateData.history?.[0]?.date || '',
        portfolioStartDate: stateData.portfolioStartDate || '',
        portfolio: stateData.portfolio || [], principal: cleanNum(stateData.principal),
        history: stateData.history || [], depositHistory: stateData.depositHistory || [],
        depositHistory2: stateData.depositHistory2 || [],
        settings: stateData.settings || { mode: 'rebalance', amount: 1000000 },
      };
      setPortfolios([migrated]);
      setActivePortfolioId(newId);
      notify('계좌 1개 복구 완료 — 활성화 중', 'info');
    }
    setCustomLinks(stateData.customLinks || UI_CONFIG.DEFAULT_LINKS);
    if (stateData.overseasLinks) setOverseasLinks(stateData.overseasLinks);
    setCompStocks(stateData.compStocks || defaultCompStocks);
    if (stateData.adminAccessAllowed !== undefined) setAdminAccessAllowed(stateData.adminAccessAllowed);
    if (stateData.chartPrefs) {
      if (stateData.chartPrefs.showKospi !== undefined) setShowKospi(stateData.chartPrefs.showKospi);
      if (stateData.chartPrefs.showSp500 !== undefined) setShowSp500(stateData.chartPrefs.showSp500);
      if (stateData.chartPrefs.showNasdaq !== undefined) setShowNasdaq(stateData.chartPrefs.showNasdaq);
      if (stateData.chartPrefs.isZeroBaseMode !== undefined) setIsZeroBaseMode(stateData.chartPrefs.isZeroBaseMode);
      if (stateData.chartPrefs.showTotalEval !== undefined) setShowTotalEval(stateData.chartPrefs.showTotalEval);
      if (stateData.chartPrefs.showReturnRate !== undefined) setShowReturnRate(stateData.chartPrefs.showReturnRate);
      if (stateData.chartPrefs.accountChartStates) accountChartStatesRef.current = stateData.chartPrefs.accountChartStates;
      if (stateData.chartPrefs.showMarketPanel !== undefined) setShowMarketPanel(stateData.chartPrefs.showMarketPanel);
      if (stateData.chartPrefs.hideAmounts !== undefined) setHideAmounts(stateData.chartPrefs.hideAmounts);
      if (stateData.chartPrefs.showIndicatorsInChart) setShowIndicatorsInChart(stateData.chartPrefs.showIndicatorsInChart);
      if (stateData.chartPrefs.goldIndicators) setGoldIndicators(stateData.chartPrefs.goldIndicators);
      if (stateData.chartPrefs.goldIndicatorColors) setGoldIndicatorColors(stateData.chartPrefs.goldIndicatorColors);
      if (stateData.chartPrefs.indicatorScales) setIndicatorScales(stateData.chartPrefs.indicatorScales);
      if (stateData.chartPrefs.backtestColor) setBacktestColor(stateData.chartPrefs.backtestColor);
      if (stateData.chartPrefs.showBacktest !== undefined) setShowBacktest(stateData.chartPrefs.showBacktest);
      if (stateData.chartPrefs.sectionCollapsedMap) setSectionCollapsedMap(stateData.chartPrefs.sectionCollapsedMap);
      if (stateData.chartPrefs.intSec) setIntSec(stateData.chartPrefs.intSec);
      if (stateData.chartPrefs.intChartPeriod) setIntChartPeriod(stateData.chartPrefs.intChartPeriod);
      if (stateData.chartPrefs.intDateRange) setIntDateRange(stateData.chartPrefs.intDateRange);
      if (stateData.chartPrefs.intAppliedRange) setIntAppliedRange(stateData.chartPrefs.intAppliedRange);
      if (stateData.chartPrefs.intIsZeroBaseMode !== undefined) setIntIsZeroBaseMode(stateData.chartPrefs.intIsZeroBaseMode);
    }
    const resolvedMarketIndices = marketData?.marketIndices || stateData.marketIndices;
    const resolvedIndicatorHistoryMap = marketData?.indicatorHistoryMap || stateData.indicatorHistoryMap || {};
    const resolvedMarketIndicators = marketData?.marketIndicators || stateData.marketIndicators;
    if (resolvedMarketIndices) {
      setMarketIndices(resolvedMarketIndices);
      setIndexFetchStatus({
        kospi:  resolvedMarketIndices.kospi  ? buildIndexStatus(resolvedMarketIndices.kospi,  'Drive') : null,
        sp500:  resolvedMarketIndices.sp500  ? buildIndexStatus(resolvedMarketIndices.sp500,  'Drive') : null,
        nasdaq: resolvedMarketIndices.nasdaq ? buildIndexStatus(resolvedMarketIndices.nasdaq, 'Drive') : null,
      });
    }
    if (resolvedMarketIndicators) setMarketIndicators(resolvedMarketIndicators);
    if (resolvedIndicatorHistoryMap) setIndicatorHistoryMap(resolvedIndicatorHistoryMap);
    if (stateData.intHistory) setIntHistory(stateData.intHistory);
  };
  applyStateDataRef.current = applyStateData;

  // Drive STOCK 파일 백그라운드 로드 완료 시 호출 — 기존 메모리 데이터와 병합 (덮어쓰기 금지)
  const applyStockData = (driveStockMap) => {
    setStockHistoryMap(prev => {
      const merged = { ...driveStockMap };
      Object.entries(prev).forEach(([code, hist]) => {
        merged[code] = { ...(merged[code] || {}), ...hist };
      });
      return merged;
    });
    // STOCK 파일 로드 완료 → 전체 계좌 누락 이력 수집 트리거 (useHistoryBackfill이 모든 계좌 빈 날짜 채우는 데 필요)
    setTimeout(() => refreshPricesRef.current?.(), 1200);
  };
  applyStockDataRef.current = applyStockData;

  const applyBackupData = (stateData, acRef) => {
    if (stateData.portfolios?.length > 0) {
      const normalizedPortfolios = stateData.portfolios.map(p => ({
        ...p,
        startDate: p.portfolioStartDate || p.startDate || '',
        portfolioStartDate: p.portfolioStartDate || p.startDate || '',
        depositHistory: (p.depositHistory || []).map(h => ({ ...h, memo: h.memo ?? '' })),
        depositHistory2: (p.depositHistory2 || []).map(h => ({ ...h, memo: h.memo ?? '' })),
      }));
      setPortfolios(normalizedPortfolios);
      setActivePortfolioId(stateData.activePortfolioId || stateData.portfolios[0].id);
    }
    if (stateData.customLinks) setCustomLinks(stateData.customLinks);
    if (stateData.overseasLinks) setOverseasLinks(stateData.overseasLinks);
    if (stateData.compStocks) setCompStocks(stateData.compStocks);
    if (stateData.intHistory) setIntHistory(stateData.intHistory);
    if (stateData.chartPrefs) {
      if (stateData.chartPrefs.showKospi !== undefined) setShowKospi(stateData.chartPrefs.showKospi);
      if (stateData.chartPrefs.showSp500 !== undefined) setShowSp500(stateData.chartPrefs.showSp500);
      if (stateData.chartPrefs.showNasdaq !== undefined) setShowNasdaq(stateData.chartPrefs.showNasdaq);
      if (stateData.chartPrefs.isZeroBaseMode !== undefined) setIsZeroBaseMode(stateData.chartPrefs.isZeroBaseMode);
      if (stateData.chartPrefs.showTotalEval !== undefined) setShowTotalEval(stateData.chartPrefs.showTotalEval);
      if (stateData.chartPrefs.showReturnRate !== undefined) setShowReturnRate(stateData.chartPrefs.showReturnRate);
      if (stateData.chartPrefs.accountChartStates) acRef.current = stateData.chartPrefs.accountChartStates;
      if (stateData.chartPrefs.showMarketPanel !== undefined) setShowMarketPanel(stateData.chartPrefs.showMarketPanel);
      if (stateData.chartPrefs.hideAmounts !== undefined) setHideAmounts(stateData.chartPrefs.hideAmounts);
      if (stateData.chartPrefs.showIndicatorsInChart) setShowIndicatorsInChart(stateData.chartPrefs.showIndicatorsInChart);
      if (stateData.chartPrefs.goldIndicators) setGoldIndicators(stateData.chartPrefs.goldIndicators);
      if (stateData.chartPrefs.goldIndicatorColors) setGoldIndicatorColors(stateData.chartPrefs.goldIndicatorColors);
      if (stateData.chartPrefs.indicatorScales) setIndicatorScales(stateData.chartPrefs.indicatorScales);
      if (stateData.chartPrefs.backtestColor) setBacktestColor(stateData.chartPrefs.backtestColor);
      if (stateData.chartPrefs.showBacktest !== undefined) setShowBacktest(stateData.chartPrefs.showBacktest);
      if (stateData.chartPrefs.sectionCollapsedMap) setSectionCollapsedMap(stateData.chartPrefs.sectionCollapsedMap);
      if (stateData.chartPrefs.intSec) setIntSec(stateData.chartPrefs.intSec);
    }
  };
  applyBackupDataRef.current = applyBackupData;

  // *Ref를 항상 최신 상태로 동기화 (클로저 문제 해결용 — 20분 인터벌 등 stale closure 방지)
  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);
  useEffect(() => { portfoliosRef.current = portfolios; }, [portfolios]);
  useEffect(() => { marketIndicatorsRef.current = marketIndicators; }, [marketIndicators]);
  useEffect(() => { activePortfolioAccountTypeRef.current = activePortfolioAccountType; }, [activePortfolioAccountType]);
  useEffect(() => { activePortfolioIdRef.current = activePortfolioId; }, [activePortfolioId]);
  useEffect(() => { stockHistoryMapRef.current = stockHistoryMap; }, [stockHistoryMap]);

  // gold 계좌 전용 차트 지표 — 다른 계좌의 showIndicatorsInChart와 완전 분리
  const effectiveShowIndicators = useMemo(() => {
    if (activePortfolioAccountType === 'gold') {
      return { goldIntl: goldIndicators.goldIntl, goldKr: goldIndicators.goldKr, usdkrw: goldIndicators.usdkrw, dxy: goldIndicators.dxy, us10y: false, kr10y: false, fedRate: false, vix: false, btc: false, eth: false };
    }
    return showIndicatorsInChart;
  }, [activePortfolioAccountType, goldIndicators, showIndicatorsInChart]);

  // gold 계좌에서 KOSPI/SP500/NASDAQ 추세선을 완전히 차단 — effectiveShowIndicators와 동일한 패턴
  const effectiveShowKospi = activePortfolioAccountType === 'gold' ? false : showKospi;
  const effectiveShowSp500 = activePortfolioAccountType === 'gold' ? false : showSp500;
  const effectiveShowNasdaq = activePortfolioAccountType === 'gold' ? false : showNasdaq;

  // gold 계좌 진입 시 4개 지표 히스토리 자동 로드
  useEffect(() => {
    if (activePortfolioAccountType !== 'gold') return;
    (['goldIntl', 'goldKr', 'usdkrw', 'dxy'] as const).forEach(key => {
      if (!indicatorHistoryMap[key]) fetchIndicatorHistory(key, null, null);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioAccountType]);

  // 최신 차트 상태를 ref에 동기화 (계좌 전환 시 저장용)
  useEffect(() => {
    currentChartStateRef.current = {
      showKospi, showSp500, showNasdaq,
      showIndicatorsInChart,
      goldIndicators,
      goldIndicatorColors,
      compStocks: compStocks.map(({ loading, ...rest }) => rest),
      chartPeriod,
      dateRange,
      appliedRange,
      backtestColor,
      showBacktest,
    };
  }, [showKospi, showSp500, showNasdaq, showIndicatorsInChart, goldIndicators, goldIndicatorColors, compStocks, chartPeriod, dateRange, appliedRange, backtestColor, showBacktest]);

  // 계좌 전환 시 차트 상태 저장 → 복원 (계좌별 완전 독립 — 조회기간 포함)
  useEffect(() => {
    const prevId = prevActivePortfolioIdRef.current;
    if (prevId !== null && prevId !== activePortfolioId) {
      setRebalExtraQty({});
      // 이전 계좌 상태 저장
      accountChartStatesRef.current[prevId] = { ...currentChartStateRef.current };
      // 새 계좌 상태 복원
      const saved = accountChartStatesRef.current[activePortfolioId];
      if (saved) {
        setShowKospi(saved.showKospi);
        setShowSp500(saved.showSp500);
        setShowNasdaq(saved.showNasdaq);
        setShowIndicatorsInChart(saved.showIndicatorsInChart);
        setGoldIndicators(saved.goldIndicators || { goldIntl: true, goldKr: true, usdkrw: false, dxy: false });
        setGoldIndicatorColors(saved.goldIndicatorColors || { goldIntl: '#ffd60a', goldKr: '#ff9f0a', usdkrw: '#0a84ff', dxy: '#5ac8fa' });
        setCompStocks((saved.compStocks || defaultCompStocks).map((s: any) => ({ ...s, loading: false })));
        // 조회기간 복원
        if (saved.chartPeriod) setChartPeriod(saved.chartPeriod);
        setDateRange(saved.dateRange || { start: '', end: '' });
        setAppliedRange(saved.appliedRange || { start: '', end: '' });
        // 백테스트 색상 복원
        if (saved.backtestColor) setBacktestColor(saved.backtestColor);
        if (saved.showBacktest !== undefined) setShowBacktest(saved.showBacktest);
      } else {
        // 처음 방문하는 계좌 — 계좌 타입별 기본값
        const accountType = portfolios.find(p => p.id === activePortfolioId)?.accountType;
        setShowIndicatorsInChart({ us10y: false, kr10y: false, goldIntl: false, goldKr: false, usdkrw: false, dxy: false, fedRate: false, vix: false, btc: false, eth: false });
        // 조회기간 기본값: ISA는 1주일, 나머지는 3개월
        const defaultPeriod = accountType === 'isa' ? '1w' : '3m';
        setChartPeriod(defaultPeriod);
        setDateRange({ start: '', end: '' });
        setAppliedRange({ start: '', end: '' });
        setBacktestColor('#f97316');
        setShowBacktest(false);
        if (accountType === 'gold') {
          setGoldIndicators({ goldIntl: true, goldKr: true, usdkrw: false, dxy: false });
          setGoldIndicatorColors({ goldIntl: '#ffd60a', goldKr: '#ff9f0a', usdkrw: '#0a84ff', dxy: '#5ac8fa' });
          setCompStocks(defaultCompStocks);
        } else {
          setShowKospi(true); setShowSp500(false); setShowNasdaq(false);
          setCompStocks(defaultCompStocks);
        }
      }
    }
    prevActivePortfolioIdRef.current = activePortfolioId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioId]);

  const {
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
  } = usePortfolioData({
    portfolio, activePortfolioAccountType, marketIndicators, principal,
    avgExchangeRate, portfolioStartDate, settings, depositHistory, depositHistory2,
    portfolios, activePortfolioId, history, historyLimit,
    rebalanceSortConfig, depositSortConfig, depositSortConfig2,
  });

  const unifiedDates = useMemo(() => {
    const dates = new Set();
    history.forEach(h => dates.add(h.date));
    if (marketIndices.kospi) Object.keys(marketIndices.kospi).forEach(d => dates.add(d));
    if (marketIndices.sp500) Object.keys(marketIndices.sp500).forEach(d => dates.add(d));
    if (marketIndices.nasdaq) Object.keys(marketIndices.nasdaq).forEach(d => dates.add(d));
    Object.values(stockHistoryMap).forEach(stock => Object.keys(stock).forEach(d => dates.add(d)));
    Object.values(indicatorHistoryMap).forEach(h => Object.keys(h).forEach(d => dates.add(d)));
    if (portfolioStartDate) dates.add(portfolioStartDate);
    return Array.from(dates).sort((a, b) => new Date(a) - new Date(b));
  }, [history, marketIndices, stockHistoryMap, indicatorHistoryMap, portfolioStartDate]);

  const filteredDates = useMemo(() => {
    if (!appliedRange.start || !appliedRange.end) return unifiedDates;
    return unifiedDates.filter(d => d >= appliedRange.start && d <= appliedRange.end);
  }, [unifiedDates, appliedRange]);

  const INDICATOR_CHART_KEYS = ['us10y', 'kr10y', 'goldIntl', 'goldKr', 'usdkrw', 'dxy', 'fedRate', 'vix', 'btc', 'eth'];

  const indexDataMap = useMemo(() => {
    const map = {};
    if (unifiedDates.length === 0) return map;
    let baseK = null, baseS = null, baseN = null;
    let baseComps = new Array(compStocks.length).fill(null);
    const baseIndicators = {};
    unifiedDates.forEach((dateStr, i) => {
      const currK = getClosestValue(marketIndices.kospi, dateStr);
      const currS = getClosestValue(marketIndices.sp500, dateStr);
      const currN = getClosestValue(marketIndices.nasdaq, dateStr);
      let kPoint = currK || (baseK ? baseK * (1 + (getSeededRandom(dateStr + 'k') - 0.49) * 0.015) : 2600);
      let sPoint = currS || (baseS ? baseS * (1 + (getSeededRandom(dateStr + 's') - 0.48) * 0.015) : 5000);
      let nPoint = currN || (baseN ? baseN * (1 + (getSeededRandom(dateStr + 'n') - 0.47) * 0.02) : 17000);
      const compValues = compStocks.map(comp =>
        comp.active && comp.code ? getClosestValue(stockHistoryMap[comp.code], dateStr) : null
      );

      // 시장 지표 히스토리
      const indPoints = {};
      INDICATOR_CHART_KEYS.forEach(k => {
        const h = indicatorHistoryMap[k];
        if (!h) return;
        const v = getClosestValue(h, dateStr);
        if (v !== null) {
          indPoints[`${k}Point`] = v;
          if (i === 0 || baseIndicators[k] == null) baseIndicators[k] = v;
          indPoints[`${k}Rate`] = baseIndicators[k] > 0 ? ((v / baseIndicators[k]) - 1) * 100 : 0;
        }
      });

      if (i === 0) { baseK = kPoint; baseS = sPoint; baseN = nPoint; }
      compStocks.forEach((_, ci) => {
        if (baseComps[ci] === null && compValues[ci] != null) baseComps[ci] = compValues[ci];
      });
      const compData: Record<string, number | null> = {};
      compStocks.forEach((_, ci) => {
        compData[`comp${ci + 1}Point`] = compValues[ci];
        compData[`comp${ci + 1}Rate`] = (baseComps[ci] && compValues[ci]) ? ((compValues[ci] / baseComps[ci]) - 1) * 100 : null;
      });
      map[dateStr] = {
        kospiPoint: kPoint, sp500Point: sPoint, nasdaqPoint: nPoint,
        kospiRate: baseK ? ((kPoint / baseK) - 1) * 100 : 0,
        sp500Rate: baseS ? ((sPoint / baseS) - 1) * 100 : 0,
        nasdaqRate: baseN ? ((nPoint / baseN) - 1) * 100 : 0,
        ...compData,
        ...indPoints,
      };
    });
    return map;
  }, [unifiedDates, marketIndices, compStocks, stockHistoryMap, indicatorHistoryMap]);

  const finalChartData = useMemo(() => {
    const localSortedHist = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
    const rawData = filteredDates.map(date => {
      let trueEvalAtDate = 0, retRate = 0;
      if (date >= portfolioStartDate) {
        let hasTrueData = false;
        const hIdx = localSortedHist.slice().reverse().find(h => h.date <= date) || localSortedHist[0];
        const baseEval = hIdx ? hIdx.evalAmount : totals.totalEval;
        const basePrin = hIdx ? hIdx.principal : principal;
        portfolio.forEach(item => {
          if (item.type === 'deposit') { trueEvalAtDate += cleanNum(item.depositAmount); }
          else if (item.code && stockHistoryMap[item.code]) {
            const priceAtDate = getClosestValue(stockHistoryMap[item.code], date);
            if (priceAtDate) { trueEvalAtDate += priceAtDate * item.quantity; hasTrueData = true; }
            else { trueEvalAtDate += cleanNum(item.evalAmount) * (baseEval / (totals.totalEval || 1)); }
          } else { trueEvalAtDate += cleanNum(item.evalAmount) * (baseEval / (totals.totalEval || 1)); }
        });
        if (!hasTrueData && hIdx) trueEvalAtDate = hIdx.evalAmount;
        retRate = basePrin > 0 ? ((trueEvalAtDate - basePrin) / basePrin * 100) : 0;
      }
      return { date, ...(indexDataMap[date] || {}), evalAmount: trueEvalAtDate, returnRate: retRate };
    });
    const zeroBasedData = (!isZeroBaseMode || rawData.length === 0) ? rawData : (() => {
      const baseItem = rawData[0];
      return rawData.map(item => {
        const indRates = {};
        INDICATOR_CHART_KEYS.forEach(k => {
          const basePoint = baseItem[`${k}Point`];
          const curPoint = item[`${k}Point`];
          if (basePoint > 0 && curPoint != null) {
            indRates[`${k}Rate`] = ((curPoint / basePoint) - 1) * 100;
          }
        });
        return {
          ...item,
          returnRate: baseItem.evalAmount > 0 ? ((item.evalAmount / baseItem.evalAmount) - 1) * 100 : 0,
          kospiRate: baseItem.kospiPoint > 0 ? ((item.kospiPoint / baseItem.kospiPoint) - 1) * 100 : 0,
          sp500Rate: baseItem.sp500Point > 0 ? ((item.sp500Point / baseItem.sp500Point) - 1) * 100 : 0,
          nasdaqRate: baseItem.nasdaqPoint > 0 ? ((item.nasdaqPoint / baseItem.nasdaqPoint) - 1) * 100 : 0,
          ...Object.fromEntries(compStocks.map((_, ci) => {
            const pk = `comp${ci + 1}Point`;
            const rk = `comp${ci + 1}Rate`;
            return [rk, (baseItem[pk] > 0 && item[pk] != null) ? ((item[pk] / baseItem[pk]) - 1) * 100 : null];
          })),
          ...indRates,
        };
      });
    })();
    // 백테스트: 현재 종목·비중을 조회기간 시작일부터 투자했을 경우 수익률
    const backtestItems = portfolio.filter(item => item.type === 'stock' && item.code && stockHistoryMap[item.code]);
    const backtestTotalEval = backtestItems.reduce((s, item) => s + cleanNum(item.currentPrice) * cleanNum(item.quantity), 0);
    const backtestBasePrices: Record<string, number | null> = {};
    if (filteredDates.length > 0 && backtestTotalEval > 0) {
      const firstDate = filteredDates[0];
      backtestItems.forEach(item => {
        backtestBasePrices[item.code] = getClosestValue(stockHistoryMap[item.code], firstDate);
      });
    }
    return zeroBasedData.map(item => {
      const scaled = {};
      INDICATOR_CHART_KEYS.forEach(k => {
        const r = item[`${k}Rate`];
        if (r != null) scaled[`${k}RateScaled`] = r * (indicatorScales[k] || 1);
      });
      let backtestRate: number | null = null;
      if (backtestItems.length > 0 && backtestTotalEval > 0) {
        let weightedReturn = 0;
        let coveredWeight = 0;
        backtestItems.forEach(btItem => {
          const basePrice = backtestBasePrices[btItem.code];
          const curPrice = getClosestValue(stockHistoryMap[btItem.code], item.date);
          const w = (cleanNum(btItem.currentPrice) * cleanNum(btItem.quantity)) / backtestTotalEval;
          if (basePrice && basePrice > 0 && curPrice) {
            weightedReturn += w * ((curPrice / basePrice) - 1) * 100;
            coveredWeight += w;
          }
        });
        if (coveredWeight > 0.01) backtestRate = weightedReturn / coveredWeight;
      }
      return { ...item, ...scaled, backtestRate };
    });
  }, [filteredDates, indexDataMap, stockHistoryMap, portfolio, history, totals.totalEval, principal, portfolioStartDate, isZeroBaseMode, indicatorScales, compStocks]);

  // ── 통합 대시보드 계산 ──
  const {
    portfolioSummaries,
    intTotals,
    computedIntHistory,
    intSortedHistory,
    intUnifiedDates,
    intFilteredDates,
    intChartData,
    intMonthlyHistory,
    intCatDonutData,
    intHoldingsDonutData,
  } = useIntegratedData({
    portfolios, activePortfolioId, portfolio, principal,
    avgExchangeRate, portfolioStartDate, title, marketIndicators,
    history, intAppliedRange, intIsZeroBaseMode,
  });


  const { handleManualBackfill } = useHistoryBackfill({
    stockHistoryMap, indicatorHistoryMap, marketIndicators,
    portfolioSummaries, portfolios, setPortfolios,
    activePortfolioId, activePortfolioAccountType,
    portfolio, principal, history, setHistory,
    portfolioStartDate, notify,
  });

  const { handleImportHistoryJSON } = useIndexImport({
    marketIndices, setMarketIndices, setIndexFetchStatus,
    setStockHistoryMap, setMarketIndicators, setIndicatorHistoryMap, notify,
  });


  const {
    handleChartMouseDown, handleChartMouseMove, handleChartMouseUp, handleChartMouseLeave,
    handleIntChartMouseDown, handleIntChartMouseMove, handleIntChartMouseUp, handleIntChartMouseLeave,
  } = useChartInteraction({
    finalChartData, intChartData, compStocks, INDICATOR_CHART_KEYS,
    isDragging, setIsDragging, refAreaLeft, setRefAreaLeft, refAreaRight, setRefAreaRight,
    setSelectionResult, setHoveredPoint,
    intIsDragging, setIntIsDragging, intRefAreaLeft, setIntRefAreaLeft, intRefAreaRight, setIntRefAreaRight,
    setIntSelectionResult, setIntHoveredPoint,
  });

  // ── useStockData 훅 ──
  const {
    handleStockBlur,
    handleSingleStockRefresh,
    handleAddCompStock,
    handleRemoveCompStock,
    handleCompStockBlur,
    handleToggleComp,
    handleFetchCompHistory,
    autoRefreshStockPrices,
    refreshPrices,
  } = useStockData({
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
  });
  refreshPricesRef.current = refreshPrices;

  // 계좌 탭 전환 시 현재가 자동 갱신
  useEffect(() => {
    if (!didSwitchPortfolioRef.current) { didSwitchPortfolioRef.current = true; return; }
    refreshPrices();
  }, [activePortfolioId]);



  const handleSort = (key) => {
    let dir = sortConfig.key === key ? -sortConfig.direction : 1;
    setSortConfig({ key, direction: dir });
    setPortfolio(prev => {
      const stocks = [...prev.filter(p => p.type === 'stock')];
      const deposits = prev.filter(p => p.type === 'deposit');
      let tInv = 0, tEvl = 0;
      prev.forEach(item => {
        if (item.type === 'deposit') { tInv += cleanNum(item.depositAmount); tEvl += cleanNum(item.depositAmount); }
        else { tInv += cleanNum(item.purchasePrice) * cleanNum(item.quantity); tEvl += cleanNum(item.currentPrice) * cleanNum(item.quantity); }
      });
      stocks.sort((a, b) => {
        const getVal = (item, k) => {
          const cP = cleanNum(item.currentPrice), pP = cleanNum(item.purchasePrice), qty = cleanNum(item.quantity);
          if (k === 'investAmount') return pP * qty;
          if (k === 'evalAmount') return cP * qty;
          if (k === 'profit') return (cP - pP) * qty;
          if (k === 'returnRate') return (pP * qty) > 0 ? ((cP - pP) * qty) / (pP * qty) : 0;
          if (k === 'investRatio') return tInv > 0 ? (pP * qty) / tInv : 0;
          if (k === 'evalRatio') return tEvl > 0 ? (cP * qty) / tEvl : 0;
          return item[k] || 0;
        };
        let vA = getVal(a, key), vB = getVal(b, key);
        if (typeof vA === 'string') return vA.localeCompare(vB) * dir;
        return (vA - vB) * dir;
      });
      return [...stocks, ...deposits];
    });
  };

  const handleRebalanceSort = (key) => setRebalanceSortConfigMap(prev => {
    const cur = prev[activePortfolioId] ?? { key: null, direction: 1 };
    return { ...prev, [activePortfolioId]: { key, direction: cur.key === key ? -cur.direction : 1 } };
  });
  const handleDepositSort = (key) => setDepositSortConfig(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));
  const handleDepositSort2 = (key) => setDepositSortConfig2(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));

  const handleSave = () => {
    const currentPortfolios = buildPortfoliosState();
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode }, intHistory };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `백업_ ${yy}-${mo}-${dd}_${hh},${mi},${ss}.json`; a.click();
    // PC 다운로드와 동시에 Google Drive에도 백업
    if (driveTokenRef.current) {
      saveAllToDrive(state);
    }
  };

  const handleClearNotificationLog = async () => {
    clearNotificationLog();
    if (driveTokenRef.current) {
      try {
        const folderId = driveFolderIdRef.current || await ensureDriveFolder(driveTokenRef.current);
        await saveDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.NOTIFICATION_LOG, { entries: [] });
      } catch {}
    }
  };

  const handleDriveSave = () => {
    const currentPortfolios = buildPortfoliosState();
    // portfolioUpdatedAt이 없으면 saveAllToDrive의 guard(0 > 0)가 항상 false → STATE 저장 안됨
    // 수동 저장은 항상 강제 저장되어야 하므로 새 타임스탬프 생성 후 guard 초기화
    const newUpdatedAt = Date.now();
    portfolioUpdatedAtRef.current = newUpdatedAt;
    lastDriveSavedPortfolioUpdatedAtRef.current = 0;
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode }, intHistory, portfolioUpdatedAt: newUpdatedAt };
    if (driveTokenRef.current) {
      saveAllToDrive(state, 'manual'); // 수동 저장 → 타임스탬프 백업 포함
    } else {
      notify('☁️ Drive 미연결 — 먼저 Drive를 연결해 주세요', 'warning');
    }
  };

  const handleAppClose = async () => {
    notify('백업 저장합니다.', 'info');
    const currentPortfolios = buildPortfoliosState();
    const newUpdatedAt = Date.now();
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode }, intHistory, portfolioUpdatedAt: newUpdatedAt };
    const minWait = new Promise<void>(r => setTimeout(r, 2000));
    if (driveTokenRef.current) {
      const token = driveTokenRef.current;
      const { stockHistoryMap: _shm, marketIndices: _mi, marketIndicators: _mInd, indicatorHistoryMap: _ihm, ...stateCore } = state;
      const savePromise = (async () => {
        try {
          const folderId = await ensureDriveFolder(token);
          await saveDriveFile(token, folderId, DRIVE_FILES.STATE, stateCore);
          await saveVersionedBackup(token, folderId, stateCore, 'auto');
        } catch {}
      })();
      await Promise.all([minWait, savePromise]);
    } else {
      await minWait;
    }
    window.close();
  };

  const today = new Date().toISOString().split('T')[0];
  const handleDownloadCSV = () => downloadCSV(`ISA_자산추이_${today}.csv`, buildHistoryCSV(history));
  const handleLookupDownloadCSV = () => downloadCSV(`ISA_지정일비교_${today}.csv`, buildLookupCSV(lookupRows, history, comparisonMode, totals.totalEval));
  const handleDepositDownloadCSV = () => downloadCSV(`입금내역_${today}.csv`, buildDepositCSV(depositWithSum));
  const handleWithdrawDownloadCSV = () => downloadCSV(`출금내역_${today}.csv`, buildDepositCSV(depositWithSum2));

  const handleSearchClick = () => {
    if (dateRange.start && dateRange.end) { setAppliedRange({ start: dateRange.start, end: dateRange.end }); setChartPeriod('custom'); }
  };


  // 1단계: 로그인 후 사용자별 localStorage에서 복원 (step 2 내부에서 처리)

  // 2단계: 로그인 완료 후 사용자별 localStorage 복원 + Drive 초기화 + 시장 데이터 수집
  useEffect(() => {
    if (!authUser) return;

    const token = authUser.token;
    const userKey = `portfolioState_v5_${authUser.email}`;
    const stockKey = `portfolioStockData_v5_${authUser.email}`;
    const marketKey = `portfolioMarketData_v5_${authUser.email}`;

    // Drive 토큰 설정 (localStorage 읽기 없이 바로 Drive 우선 로드)
    driveTokenRef.current = token;
    setDriveToken(token);
    setDriveStatus('');

    const bgTimer = setTimeout(async () => {
      initTokenClient();

      // 항상 Drive에서 최신 데이터 로드 — localStorage 캐시 사용 안 함
      notify('Drive 데이터 불러오는 중...', 'info');
      const drivePortfolio = await loadFromDrive(token);
      if (drivePortfolio === null) {
        // 완전 신규 사용자: 초기 포트폴리오 생성
        const newId = generateId();
        const today = new Date().toISOString().split('T')[0];
        const initP = { id: newId, name: '내 포트폴리오', startDate: today, portfolioStartDate: today, portfolio: [{ id: generateId(), type: 'deposit', depositAmount: 0 }], principal: 0, history: [], depositHistory: [], depositHistory2: [], settings: { mode: 'rebalance', amount: 1000000 } };
        setPortfolios([initP]);
        setActivePortfolioId(newId);
        notify('새 계좌 생성 완료', 'info');
      }

      // dividendTaxHistory는 별도 파일이므로 항상 Drive에서 로드
      try {
        const taxFolderId = driveFolderIdRef.current || await ensureDriveFolder(token);
        const taxData = await loadDriveFile(token, taxFolderId, DRIVE_FILES.DIVIDEND_TAX) as Record<string, any>;
        if (taxData && typeof taxData === 'object') setDividendTaxHistory(taxData);
      } catch {}

      // 알림 이력 Drive에서 복원
      try {
        const logFolderId = driveFolderIdRef.current || await ensureDriveFolder(token);
        const logData = await loadDriveFile(token, logFolderId, DRIVE_FILES.NOTIFICATION_LOG) as any;
        if (logData?.entries?.length > 0) setNotificationLog(logData.entries);
      } catch {}

      // 관리자 공지 확인 (관리자 본인 제외)
      if (authUser.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        try {
          // Apps Script getNotifications 엔드포인트 필요:
          // action=getNotifications → { notifications: [{id, targetEmail, message, type, createdAt}] }
          const notifsRes = await fetch(`${APPS_SCRIPT_URL}?action=getNotifications&cacheBust=${Date.now()}`);
          if (notifsRes.ok) {
            const notifsData = await notifsRes.json();
            const all: AdminNotification[] = notifsData.notifications || [];
            const seenKey = `adminNotifs_seen_v1_${authUser.email}`;
            const seenIds: string[] = JSON.parse(localStorage.getItem(seenKey) || '[]');
            const myNotifs = all.filter(n =>
              (n.targetEmail === '__all__' || n.targetEmail?.toLowerCase() === authUser.email.toLowerCase())
              && !seenIds.includes(n.id)
            );
            if (myNotifs.length > 0) {
              setPendingAdminNotifs(myNotifs);
            }
          }
        } catch {}
      }

      // 시장지표 수집 (백그라운드)
      fetchMarketIndicators();

      // 3단계: 각 계좌 탭 순환 — 활성화 상태 거치게 하여 총자산현황 합계 정합성 확보
      for (const p of portfoliosRef.current) {
        notify(p.name, 'info');
        switchToPortfolio(p.id);
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // 총자산현황으로 이동
      notify('총자산현황', 'info');
      setShowIntegratedDashboard(true);
      await new Promise(resolve => setTimeout(resolve, 150));

      // 4단계: 전체 계좌 현재가 갱신
      await refreshPrices();
      notify('전체 계좌 현재가 조회 완료', 'success');

      isInitialLoad.current = false;

      // STOCK 파일 백그라운드 로드 — await 없이 실행 (앱 시작을 막지 않음)
      loadStockFromDrive(token);
    }, 400);

    return () => clearTimeout(bgTimer);
  }, [authUser]);

  // 알림 로그 변경 시 Drive에 자동 저장 (5초 디바운스)
  useEffect(() => {
    if (!authUser || !driveTokenRef.current || isInitialLoad.current) return;
    const timer = setTimeout(async () => {
      try {
        const folderId = driveFolderIdRef.current || await ensureDriveFolder(driveTokenRef.current);
        await saveDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.NOTIFICATION_LOG, { entries: notificationLog });
      } catch {}
    }, 5000);
    return () => clearTimeout(timer);
  }, [notificationLog]);

  useEffect(() => {
    if (portfolios.length === 0) return;
    if (!authUser?.email) return;
    const currentPortfolios = portfolios;
    // 계좌/종목 구조만 비교 — history(일일 평가액)·시장 데이터는 제외하여
    // 시장가격 갱신이 portfolioUpdatedAt을 덮어쓰지 않도록 방지
    // compStocks(비교종목 추가/활성화)도 구조 변경으로 간주 → Drive STATE 즉시 반영
    const portfolioStructureKey = JSON.stringify([
      currentPortfolios.map(p => ({
        id: p.id, name: p.name,
        startDate: p.startDate || p.portfolioStartDate,
        portfolioStartDate: p.portfolioStartDate || p.startDate,
        portfolio: (p.portfolio || []).map(item => ({ id: item.id, type: item.type, code: item.code, name: item.name, shares: item.shares, buyPrice: item.buyPrice, depositAmount: item.depositAmount, fundCode: item.fundCode })),
        principal: p.principal, avgExchangeRate: p.avgExchangeRate,
        depositHistory: p.depositHistory, depositHistory2: p.depositHistory2,
        settings: p.settings,
        actualDividend: p.actualDividend,
        extraDividendRows: p.extraDividendRows,
        actualDividendUsd: p.actualDividendUsd,
        actualAfterTaxUsd: p.actualAfterTaxUsd,
        actualAfterTaxKrw: p.actualAfterTaxKrw,
        dividendTaxRate: p.dividendTaxRate,
        dividendSeparateTax: p.dividendSeparateTax,
        lookupRows: p.lookupRows,
        memo: p.memo || '',
        rowColor: p.rowColor || '',
      })),
      activePortfolioId, customLinks,
      compStocks.map(c => `${c.code}:${c.active ? 1 : 0}`).join(','),
    ]);
    if (portfolioStructureKey !== prevPortfolioStructureRef.current) {
      prevPortfolioStructureRef.current = portfolioStructureKey;
      portfolioUpdatedAtRef.current = Date.now();
    }
    // 활성 포트폴리오의 차트 상태(비교종목 포함)를 항상 최신으로 유지
    if (activePortfolioId) {
      accountChartStatesRef.current[activePortfolioId] = { ...currentChartStateRef.current };
    }
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode }, intHistory, updatedAt: Date.now(), portfolioUpdatedAt: portfolioUpdatedAtRef.current };
    saveStateRef.current = state;
    // Drive가 항상 정본 — localStorage에는 포트폴리오 구조만 최소 저장 (세션 중 안전망)
    // stockHistoryMap·marketData는 Drive에서 로드하므로 localStorage에 저장하지 않음
    const stateEmail = adminViewingAsRef.current || authUser.email;
    const { stockHistoryMap: shm, marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm, ...stateCore } = state;
    try { localStorage.setItem(`portfolioState_v5_${stateEmail}`, JSON.stringify(stateCore)); } catch {}
    // 초기 로드 완료 후 Drive 자동저장 (2초 디바운스 — 포트폴리오 테이블 변경 시 2초 이내 백업)
    if (!isInitialLoad.current && driveTokenRef.current) {
      if (driveSaveTimerRef.current) clearTimeout(driveSaveTimerRef.current);
      driveSaveTimerRef.current = setTimeout(() => {
        saveAllToDrive(state);
      }, 2000);
    }
  }, [portfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, intHistory, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, chartPeriod, dateRange]);

  useEffect(() => {
    if (totals.totalEval === 0) return;
    if (!calendarLoaded) return;
    const today = getTodayKST();
    const dayOfWeek = new Date(today + 'T12:00:00').getDay();
    const isTradingDay = (dayOfWeek !== 0 && dayOfWeek !== 6) && isMarketOpen(activePortfolioAccountType);
    setHistory(prev => {
      const krH = marketHolidays.kr;
      const usH = marketHolidays.us;
      const accType = activePortfolioAccountType;
      const existingToday = prev.find(h => h.date === today);
      // 주말 항목만 제거 — 공휴일은 유효한 기록으로 유지, 오늘 항목은 아래서 재구성
      const cleaned = prev.filter(h => {
        if (h.date === today) return false;
        if (h.isFixed) return true;
        const day = new Date(h.date + 'T12:00:00').getDay();
        return day !== 0 && day !== 6;
      });
      const prevEntries = [...cleaned].sort((a, b) => b.date.localeCompare(a.date));
      const lastEntry = prevEntries[0];
      const prevValue = lastEntry?.evalAmount ?? 0;
      // 직전 기록이 현재 합산가의 10% 미만이면 예수금만 기록된 비정상 데이터 → 현재값으로 보정
      const needsCorrection = !!(lastEntry && !lastEntry.isFixed && prevValue > 0 && prevValue < totals.totalEval * 0.1);
      const correctedCleaned = needsCorrection
        ? cleaned.map(h => h.date === lastEntry.date ? { ...h, evalAmount: totals.totalEval } : h)
        : cleaned;
      const effectivePrevValue = needsCorrection ? totals.totalEval : prevValue;
      const isHoliday = !isTradingDay;
      // 휴일에 합산가가 전일 대비 10% 미만으로 감소한 경우만 이상치로 판단 (가격 미로드 방지)
      const isAnomaly = isHoliday && effectivePrevValue > 0 && totals.totalEval < effectivePrevValue * 0.1;
      let todayEntry;
      if (existingToday?.userChosen) {
        todayEntry = { ...existingToday, actualEvalAmount: totals.totalEval };
      } else if (isAnomaly) {
        todayEntry = { date: today, evalAmount: effectivePrevValue, adjustedAmount: effectivePrevValue, actualEvalAmount: totals.totalEval, principal, isFixed: false, isAdjusted: true, userChosen: false };
      } else {
        todayEntry = { date: today, evalAmount: totals.totalEval, adjustedAmount: totals.totalEval, actualEvalAmount: totals.totalEval, principal, isFixed: false, isAdjusted: false, userChosen: false };
      }
      if (!needsCorrection && existingToday && !existingToday.userChosen && !isAnomaly &&
          existingToday.evalAmount === totals.totalEval && cleaned.length === prev.length - 1) {
        return prev;
      }
      const newHist = [...correctedCleaned, todayEntry];
      const fills = fillNonTradingGaps(newHist, krH, usH, accType);
      return fills.length > 0 ? [...newHist, ...fills] : newHist;
    });
  }, [totals.totalEval, principal, calendarLoaded, activePortfolioAccountType]);

  useEffect(() => {
    if (unifiedDates.length === 0) return;
    const latest = unifiedDates[unifiedDates.length - 1];
    const newStart = calcPeriodStart(chartPeriod, latest, unifiedDates[0]);
    if (newStart !== null) { setDateRange({ start: newStart, end: latest }); setAppliedRange({ start: newStart, end: latest }); }
  }, [chartPeriod, unifiedDates]);


  const handleIntSearchClick = () => {
    if (intDateRange.start && intDateRange.end) {
      setIntAppliedRange({ start: intDateRange.start, end: intDateRange.end });
      setIntChartPeriod('custom');
    }
  };

  // 통합 대시보드 - 기간 변경 시 차트 범위 업데이트
  useEffect(() => {
    if (intUnifiedDates.length === 0) return;
    const latest = intUnifiedDates[intUnifiedDates.length - 1];
    const newStart = calcPeriodStart(intChartPeriod, latest, intUnifiedDates[0]);
    if (newStart !== null) { setIntDateRange({ start: newStart, end: latest }); setIntAppliedRange({ start: newStart, end: latest }); }
  }, [intChartPeriod, intUnifiedDates]);

  // ── 기본 선택기간 자동 계산 ──
  const [defaultSelectionResult, setDefaultSelectionResult] = React.useState(null);
  const [intDefaultSelectionResult, setIntDefaultSelectionResult] = React.useState(null);

  // 개별 계좌: 조회기간 변경 시 드래그 선택 초기화 + 전체 기간 기본값 계산
  useEffect(() => {
    setSelectionResult(null);
    setRefAreaLeft('');
    setRefAreaRight('');
  }, [appliedRange]);

  useEffect(() => {
    if (finalChartData.length < 2) { setDefaultSelectionResult(null); return; }
    const s = finalChartData[0];
    const e = finalChartData[finalChartData.length - 1];
    const profit = e.evalAmount - s.evalAmount;
    setDefaultSelectionResult({ startDate: s.date, endDate: e.date, profit, rate: s.evalAmount > 0 ? (profit / s.evalAmount) * 100 : 0 });
  }, [finalChartData]);

  // 통합 대시보드: 조회기간 변경 시 드래그 선택 초기화 + 전체 기간 기본값 계산
  useEffect(() => {
    setIntSelectionResult(null);
    setIntRefAreaLeft('');
    setIntRefAreaRight('');
  }, [intAppliedRange]);

  useEffect(() => {
    if (intChartData.length < 2) { setIntDefaultSelectionResult(null); return; }
    const s = intChartData[0];
    const e = intChartData[intChartData.length - 1];
    const profit = e.evalAmount - s.evalAmount;
    setIntDefaultSelectionResult({ startDate: s.date, endDate: e.date, profit, rate: s.evalAmount > 0 ? ((e.evalAmount / s.evalAmount) - 1) * 100 : 0 });
  }, [intChartData]);

  // 조회기간 변경 시 활성 비교종목 데이터가 범위를 커버하지 못하면 자동 전체 이력 재조회
  useEffect(() => {
    if (!appliedRange.start) return;
    compStocks.forEach((comp, idx) => {
      if (!comp.active || !comp.code || comp.loading) return;
      if (autoFetchedCodes.current.has(comp.code)) return; // 이미 이번 세션에서 전체 조회 완료
      const hist = stockHistoryMap[comp.code];
      if (!hist || Object.keys(hist).length <= 1) return; // 단일포인트(폴백) 데이터는 별도 처리
      const earliestFetched = Object.keys(hist).sort()[0];
      if (earliestFetched > appliedRange.start) {
        // 조회기간이 보유 데이터 범위보다 앞으로 확장됨 → 자동 전체 이력 재조회
        autoFetchedCodes.current.add(comp.code); // 중복 트리거 방지 (비동기 중 재진입 막기)
        handleFetchCompHistory(idx);
      }
    });
  }, [appliedRange.start]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e) => { if (!e.target.closest('.chart-container-for-drag')) { setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); } };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  // 로그인 전: LoginGate 표시
  if (!authUser) {
    return <LoginGate onApproved={handleLoginApproved} />;
  }

  // 관리자 페이지
  if (showAdminPage && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return <AdminPage adminEmail={authUser.email} onClose={() => setShowAdminPage(false)} onViewUser={handleAdminViewUser} userAccessStatus={userAccessStatus} />;
  }

  // 배당 과세 이력 관리 페이지 (관리자 또는 feature2 허용 사용자)
  const canAccessDividendTax = authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userFeatures.feature2;
  if (showDividendTaxPage && canAccessDividendTax) {
    return (
      <DividendTaxPage
        onLoad={async () => {
          const folderId = driveFolderIdRef.current || await ensureDriveFolder(driveTokenRef.current);
          return loadDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.DIVIDEND_TAX);
        }}
        onSave={async (data) => {
          const folderId = driveFolderIdRef.current || await ensureDriveFolder(driveTokenRef.current);
          return saveDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.DIVIDEND_TAX, data);
        }}
        onClose={() => setShowDividendTaxPage(false)}
        notify={notify}
        confirm={confirm}
        isAdmin={authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()}
        onUpdate={setDividendTaxHistory}
      />
    );
  }

  return (
    <div className="bg-gray-900 min-h-screen text-gray-200 font-sans text-sm relative">
      <style dangerouslySetInnerHTML={{ __html: `html, body, #root { width: 100% !important; margin: 0 !important; padding: 0 !important; } input[type="date"] { color-scheme: dark; }` }} />
      {adminViewingAs && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-amber-950/95 border-b border-amber-700/60 px-4 py-2 flex items-center justify-between backdrop-blur-sm">
          <span className="text-amber-200 text-xs flex items-center gap-2">
            <span className="text-amber-400">✏️ 편집 모드</span>
            <span className="text-amber-100 font-medium">{adminViewingAs}</span>
            <span className="text-amber-600 text-[10px]">— 저장 시 해당 사용자 Drive에 반영됩니다</span>
          </span>
          <button
            onClick={handleReturnToAdminPage}
            className="text-amber-300 hover:text-white text-xs font-medium px-3 py-1 rounded border border-amber-700 hover:border-amber-400 transition-colors bg-amber-900/60 hover:bg-amber-800/60"
          >
            ← 관리자 페이지
          </button>
        </div>
      )}
      <ConfirmDialog state={confirmState} onResolve={resolveConfirm} />
      {pendingAdminNotifs.length > 0 && (
        <AdminNotificationModal
          notifications={pendingAdminNotifs}
          onClose={() => {
            const seenKey = `adminNotifs_seen_v1_${authUser.email}`;
            const prev: string[] = JSON.parse(localStorage.getItem(seenKey) || '[]');
            const newIds = [...prev, ...pendingAdminNotifs.map(n => n.id)];
            localStorage.setItem(seenKey, JSON.stringify(newIds));
            pendingAdminNotifs.forEach(n => notify(`[관리자 공지] ${n.message}`, n.type || 'info'));
            setPendingAdminNotifs([]);
          }}
        />
      )}
      
      
      {/* 지표 배율 설정 모달 */}
      <ScaleSettingModal
        isScaleSettingOpen={isScaleSettingOpen}
        setIsScaleSettingOpen={setIsScaleSettingOpen}
        showIndicatorsInChart={showIndicatorsInChart}
        indicatorScales={indicatorScales}
        setIndicatorScales={setIndicatorScales}
      />

      <div className="flex min-h-screen">
        {/* 좌측 광고 패널 */}
        <div className="hidden min-[1800px]:flex w-[160px] shrink-0 flex-col items-center pt-16 border-r border-gray-800/50">
          <div className="sticky top-16 w-[140px] min-h-[600px] rounded-lg bg-gray-800/10">
          </div>
        </div>
        {/* 메인 컨텐츠 */}
        <div className="flex-1 min-w-0 py-4 px-3 md:px-5 md:py-5">
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-6">
        {/* 로그인 사용자 정보 바 */}
        <UserInfoBar
          email={authUser.email}
          adminAccessAllowed={adminAccessAllowed}
          onOpenAdmin={() => setShowAdminPage(true)}
          onOpenPinChange={openPinChange}
          onToggleAdminAccess={() => {
            const newVal = !adminAccessAllowed;
            setAdminAccessAllowed(newVal);
            if (driveTokenRef.current) {
              const currentPortfolios = buildPortfoliosState();
              const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed: newVal, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current }, intHistory };
              saveAllToDrive(state);
            }
          }}
          onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setAuthUser(null); driveTokenRef.current = ''; setDriveToken(''); }}
          canAccessDividendTax={canAccessDividendTax}
          onOpenDividendTax={() => setShowDividendTaxPage(true)}
          onAppClose={handleAppClose}
        />

        {/* 알림 바 */}
        <NotificationBar notificationLog={notificationLog} onClear={handleClearNotificationLog} unreadCount={unreadCount} onRead={markAsRead} />

        {/* 뷰 전환 탭 */}
        <AccountTabBar
          portfolios={portfolios}
          showIntegratedDashboard={showIntegratedDashboard}
          setShowIntegratedDashboard={setShowIntegratedDashboard}
          activePortfolioId={activePortfolioId}
          title={title}
          switchToPortfolio={switchToPortfolio}
          hideAmounts={hideAmounts}
          setHideAmounts={setHideAmounts}
          setUnlockPinDigits={setUnlockPinDigits}
          setUnlockPinError={setUnlockPinError}
          setShowUnlockPinModal={setShowUnlockPinModal}
          refreshPrices={refreshPrices}
          isLoading={isLoading}
          handleDriveLoadOnly={handleDriveLoadOnly}
          driveStatus={driveStatus}
          handleDriveSave={handleDriveSave}
          handleOpenBackupModal={handleOpenBackupModal}
          historyInputRef={historyInputRef}
          handleImportHistoryJSON={handleImportHistoryJSON}
          handleImportStateFile={handleImportStateFile}
        />

        {/* Drive 백업 이력 모달 */}
        <DriveBackupModal
          showBackupModal={showBackupModal}
          setShowBackupModal={setShowBackupModal}
          backupListLoading={backupListLoading}
          backupList={backupList}
          applyingBackupId={applyingBackupId}
          handleApplyBackup={handleApplyBackup}
        />


        {/* 비밀번호 변경 모달 */}
        <PinChangeModal
          showPinChange={showPinChange}
          setShowPinChange={setShowPinChange}
          pinCurrent={pinCurrent}
          setPinCurrent={setPinCurrent}
          pinNew={pinNew}
          setPinNew={setPinNew}
          pinConfirm={pinConfirm}
          setPinConfirm={setPinConfirm}
          pinChangeError={pinChangeError}
          setPinChangeError={setPinChangeError}
          pinChangeSaving={pinChangeSaving}
          setPinChangeSaving={setPinChangeSaving}
          authUser={authUser}
          notify={notify}
        />
        {/* 금액 보기 잠금 해제 모달 */}
        <UnlockPinModal
          showUnlockPinModal={showUnlockPinModal}
          setShowUnlockPinModal={setShowUnlockPinModal}
          unlockPinDigits={unlockPinDigits}
          setUnlockPinDigits={setUnlockPinDigits}
          unlockPinError={unlockPinError}
          setUnlockPinError={setUnlockPinError}
          authUser={authUser}
          setHideAmounts={setHideAmounts}
        />

        {!showIntegratedDashboard && (
          <Header title={title} setTitle={setTitle} isLoading={isLoading} driveStatus={driveStatus} onRefresh={activePortfolioAccountType === 'gold' ? fetchMarketIndicators : refreshPrices} onDriveSave={handleDriveSave} onPaste={() => setIsPasteModalOpen(true)} onDriveConnect={() => requestDriveToken('select_account')} onDriveLoadOnly={handleDriveLoadOnly} />
        )}

        {!showIntegratedDashboard && (<>
        <div className="flex items-start gap-0 w-full">
          {/* 섹션 콘텐츠 */}
          <div className="flex-1 flex flex-col gap-6 min-w-0" style={{ paddingBottom: '40vh' }}>
        {activePortfolioAccountType === 'gold' ? (
          <KrxGoldTable
            portfolio={portfolio}
            goldKr={marketIndicators.goldKr}
            goldIntl={marketIndicators.goldIntl}
            usdkrw={marketIndicators.usdkrw}
            onUpdate={handleUpdate}
            onRefresh={fetchMarketIndicators}
            isRefreshing={indicatorLoading}
            goldFetchStatus={indicatorFetchStatus?.goldKr?.status}
            goldIntlFetchStatus={indicatorFetchStatus?.goldIntl?.status}
            usdkrwFetchStatus={indicatorFetchStatus?.usdkrw?.status}
          />
        ) : (
          <PortfolioTable portfolio={totals.calcPortfolio} totals={totals} sortConfig={sortConfig} onSort={handleSort} onUpdate={handleUpdate} onBlur={handleStockBlur} onDelete={handleDeleteStock} onAddStock={handleAddStock} onAddFund={handleAddFund} stockFetchStatus={stockFetchStatus} onSingleRefresh={handleSingleStockRefresh} isOverseas={activePortfolioAccountType === 'overseas'} usdkrw={marketIndicators.usdkrw || 1} isRetirement={activePortfolioAccountType === 'dc-irp'} />
        )}

        {activePortfolioAccountType !== 'gold' && !sectionCollapsed.summary && (
          <PortfolioSummaryPanel
            totals={totals}
            hoveredPortCatSlice={hoveredPortCatSlice}
            setHoveredPortCatSlice={setHoveredPortCatSlice}
            hoveredPortStkSlice={hoveredPortStkSlice}
            setHoveredPortStkSlice={setHoveredPortStkSlice}
            hideAmounts={hideAmounts}
          />
        )}

        {!sectionCollapsed.stats && (
        <div className="flex flex-col xl:flex-row gap-6 w-full items-stretch">
          <PortfolioStatsPanel
            totals={totals}
            marketIndicators={marketIndicators}
            activePortfolioAccountType={activePortfolioAccountType}
            portfolioStartDate={portfolioStartDate}
            setPortfolioStartDate={setPortfolioStartDate}
            principal={principal}
            setPrincipal={setPrincipal}
            avgExchangeRate={avgExchangeRate}
            setAvgExchangeRate={setAvgExchangeRate}
            depositHistory={depositHistory}
            setDepositHistory={setDepositHistory}
            depositHistory2={depositHistory2}
            cagr={cagr}
          />


          <HistoryPanel
            history={history}
            setHistory={setHistory}
            totals={totals}
            principal={principal}
            activePortfolioAccountType={activePortfolioAccountType}
            marketIndicators={marketIndicators}
            displayHistSliced={displayHistSliced}
            sortedHistoryDesc={sortedHistoryDesc}
            historyLimit={historyLimit}
            setHistoryLimit={setHistoryLimit}
            lookupRows={lookupRows}
            setLookupRows={setLookupRows}
            comparisonMode={comparisonMode}
            setComparisonMode={setComparisonMode}
            handleDownloadCSV={handleDownloadCSV}
            handleLookupDownloadCSV={handleLookupDownloadCSV}
            notify={notify}
          />

          <DepositPanel
            depositHistory={depositHistory}
            setDepositHistory={setDepositHistory}
            depositHistory2={depositHistory2}
            setDepositHistory2={setDepositHistory2}
            depositWithSumSorted={depositWithSumSorted}
            depositWithSum2Sorted={depositWithSum2Sorted}
            depositSortConfig={depositSortConfig}
            depositSortConfig2={depositSortConfig2}
            handleDepositSort={handleDepositSort}
            handleDepositSort2={handleDepositSort2}
            handleDepositDownloadCSV={handleDepositDownloadCSV}
            handleWithdrawDownloadCSV={handleWithdrawDownloadCSV}
            activePortfolioAccountType={activePortfolioAccountType}
            marketIndicators={marketIndicators}
          />
        </div>
        )}

        {activePortfolioAccountType !== 'gold' && !sectionCollapsed.dividend && (
          <DividendSummaryTable
            portfolios={allPortfoliosForDividend.filter(p => p.id === activePortfolioId)}
            updatePortfolioDividendHistory={updatePortfolioDividendHistory}
            updatePortfolioActualDividend={updatePortfolioActualDividend}
            updatePortfolioActualDividendUsd={updatePortfolioActualDividendUsd}
            updatePortfolioDividendTaxRate={updatePortfolioDividendTaxRate}
            updatePortfolioDividendSeparateTax={updatePortfolioDividendSeparateTax}
            updatePortfolioDividendTaxAmount={updatePortfolioDividendTaxAmount}
            updatePortfolioActualAfterTaxUsd={updatePortfolioActualAfterTaxUsd}
            updatePortfolioActualAfterTaxKrw={updatePortfolioActualAfterTaxKrw}
            addPortfolioExtraRow={addPortfolioExtraRow}
            updatePortfolioExtraRowCode={updatePortfolioExtraRowCode}
            deletePortfolioExtraRow={deletePortfolioExtraRow}
            updatePortfolioExtraRowMonth={updatePortfolioExtraRowMonth}
            usdkrw={marketIndicators.usdkrw || 1300}
            dividendTaxHistory={dividendTaxHistory}
            onDividendTaxHistoryUpdate={setDividendTaxHistory}
          />
        )}

        {/* 차트 영역 + 시장 지표 */}
        {!sectionCollapsed.chart && (
        <div className="flex flex-col xl:flex-row gap-4 w-full mb-10 items-stretch">
          {/* 시장 지표 카드 — gold 계좌 또는 패널 숨김 시 비표시 */}
          {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && showMarketPanel && (
            <MarketIndicators
              marketIndicators={marketIndicators}
              marketIndices={marketIndices}
              indicatorHistoryMap={indicatorHistoryMap}
              indicatorLoading={indicatorLoading}
              indicatorFetchStatus={{ ...indicatorFetchStatus, ...indexFetchStatus }}
              showIndicatorVerify={showIndicatorVerify}
              setShowIndicatorVerify={setShowIndicatorVerify}
              fetchMarketIndicators={fetchMarketIndicators}
              showKospi={showKospi}
              setShowKospi={setShowKospi}
              showSp500={showSp500}
              setShowSp500={setShowSp500}
              showNasdaq={showNasdaq}
              setShowNasdaq={setShowNasdaq}
              showIndicatorsInChart={showIndicatorsInChart}
              setShowIndicatorsInChart={setShowIndicatorsInChart}
              indicatorHistoryLoading={indicatorHistoryLoading}
              fetchIndicatorHistory={fetchIndicatorHistory}
              fetchSingleIndexHistory={fetchSingleIndexHistory}
              appliedRange={appliedRange}
              onUploadIndicator={handleIndicatorUpload}
              onFetchAll={fetchAllIndicatorHistory}
            />
          )}

          {/* 차트 본체 */}
          <PortfolioChart
            activePortfolioAccountType={activePortfolioAccountType}
            customLinks={customLinks}
            setCustomLinks={setCustomLinks}
            overseasLinks={overseasLinks}
            setOverseasLinks={setOverseasLinks}
            isLinkSettingsOpen={isLinkSettingsOpen}
            setIsLinkSettingsOpen={setIsLinkSettingsOpen}
            dateRange={dateRange}
            setDateRange={setDateRange}
            chartPeriod={chartPeriod}
            setChartPeriod={setChartPeriod}
            showTotalEval={showTotalEval}
            setShowTotalEval={setShowTotalEval}
            showReturnRate={showReturnRate}
            setShowReturnRate={setShowReturnRate}
            showBacktest={showBacktest}
            setShowBacktest={setShowBacktest}
            backtestColor={backtestColor}
            setBacktestColor={setBacktestColor}
            isZeroBaseMode={isZeroBaseMode}
            setIsZeroBaseMode={setIsZeroBaseMode}
            showMarketPanel={showMarketPanel}
            setShowMarketPanel={setShowMarketPanel}
            setIsScaleSettingOpen={setIsScaleSettingOpen}
            showIndexVerify={showIndexVerify}
            setShowIndexVerify={setShowIndexVerify}
            showKospi={effectiveShowKospi}
            showSp500={effectiveShowSp500}
            showNasdaq={effectiveShowNasdaq}
            goldIndicators={goldIndicators}
            setGoldIndicators={setGoldIndicators}
            goldIndicatorColors={goldIndicatorColors}
            setGoldIndicatorColors={setGoldIndicatorColors}
            compStocks={compStocks}
            setCompStocks={setCompStocks}
            userFeatures={userFeatures}
            finalChartData={finalChartData}
            effectiveShowIndicators={effectiveShowIndicators}
            selectionResult={selectionResult}
            defaultSelectionResult={defaultSelectionResult}
            refAreaLeft={refAreaLeft}
            refAreaRight={refAreaRight}
            hoveredPoint={hoveredPoint}
            appliedRange={appliedRange}
            stockListingDates={stockListingDates}
            setStockListingDates={setStockListingDates}
            autoFetchedCodes={autoFetchedCodes}
            indicatorHistoryMap={indicatorHistoryMap}
            stockHistoryMap={stockHistoryMap}
            indicatorHistoryLoading={indicatorHistoryLoading}
            stockFetchStatus={stockFetchStatus}
            fetchIndicatorHistory={fetchIndicatorHistory}
            handleSearchClick={handleSearchClick}
            handleAddCompStock={handleAddCompStock}
            handleChartMouseDown={handleChartMouseDown}
            handleChartMouseMove={handleChartMouseMove}
            handleChartMouseUp={handleChartMouseUp}
            handleChartMouseLeave={handleChartMouseLeave}
            handleCompStockBlur={handleCompStockBlur}
            handleToggleComp={handleToggleComp}
            handleFetchCompHistory={handleFetchCompHistory}
            handleRemoveCompStock={handleRemoveCompStock}
          />
        </div>
        )}

        {/* 리밸런싱 시뮬레이터 */}
        {activePortfolioAccountType !== 'gold' && (!sectionCollapsed.rebalancing || !sectionCollapsed.donut) && (
          <RebalancingPanel
            activePortfolioAccountType={activePortfolioAccountType}
            portfolio={portfolio}
            settings={settings}
            updateSettingsForType={updateSettingsForType}
            rebalanceData={rebalanceData}
            rebalanceSortConfig={rebalanceSortConfig}
            handleRebalanceSort={handleRebalanceSort}
            rebalExtraQty={rebalExtraQty}
            setRebalExtraQty={setRebalExtraQty}
            rebalCatDonutData={rebalCatDonutData}
            curCatDonutData={curCatDonutData}
            marketIndicators={marketIndicators}
            hideAmounts={hideAmounts}
            hoveredRebalCatSlice={hoveredRebalCatSlice}
            setHoveredRebalCatSlice={setHoveredRebalCatSlice}
            hoveredCurCatSlice={hoveredCurCatSlice}
            setHoveredCurCatSlice={setHoveredCurCatSlice}
            totals={totals}
            handleUpdate={handleUpdate}
            setPortfolio={setPortfolio}
            showTable={!sectionCollapsed.rebalancing}
            showDonut={!sectionCollapsed.donut}
            isRetirement={activePortfolioAccountType === 'dc-irp'}
          />
        )}
          </div>
          {/* 우측 바인더 탭 */}
          <div className="sticky top-14 self-start flex flex-col gap-px flex-shrink-0 z-10 pt-3">
            {activePortfolioAccountType !== 'gold' && (
              <button onClick={() => toggleSection('summary')} style={{ writingMode: 'vertical-lr' }} className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sectionCollapsed.summary ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>포트폴리오 요약</button>
            )}
            <button onClick={() => toggleSection('stats')} style={{ writingMode: 'vertical-lr' }} className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sectionCollapsed.stats ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>통계·히스토리</button>
            {activePortfolioAccountType !== 'gold' && (
              <button onClick={() => toggleSection('dividend')} style={{ writingMode: 'vertical-lr' }} className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sectionCollapsed.dividend ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>분배금 현황</button>
            )}
            <button onClick={() => toggleSection('chart')} style={{ writingMode: 'vertical-lr' }} className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sectionCollapsed.chart ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>수익률 차트</button>
            {activePortfolioAccountType !== 'gold' && (
              <button onClick={() => toggleSection('rebalancing')} style={{ writingMode: 'vertical-lr' }} className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sectionCollapsed.rebalancing ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>리밸런싱</button>
            )}
            {activePortfolioAccountType !== 'gold' && (
              <button onClick={() => toggleSection('donut')} style={{ writingMode: 'vertical-lr' }} className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sectionCollapsed.donut ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>자산비중비교</button>
            )}
          </div>
        </div>
        </>)}

        {showIntegratedDashboard && (
          <IntegratedDashboard
            intHistory={computedIntHistory}
            intTotals={intTotals}
            intMonthlyHistory={intMonthlyHistory}
            intChartData={intChartData}
            intChartPeriod={intChartPeriod}
            intSelectionResult={intSelectionResult}
            intDefaultSelectionResult={intDefaultSelectionResult}
            intIsZeroBaseMode={intIsZeroBaseMode}
            intRefAreaLeft={intRefAreaLeft}
            intRefAreaRight={intRefAreaRight}
            intCatDonutData={intCatDonutData}
            intHoldingsDonutData={intHoldingsDonutData}
            hoveredIntCatSlice={hoveredIntCatSlice}
            hoveredIntHoldSlice={hoveredIntHoldSlice}
            portfolioSummaries={portfolioSummaries}
            intExpandedCat={intExpandedCat}
            simpleEditField={simpleEditField}
            showNewAccountMenu={showNewAccountMenu}
            hideAmounts={hideAmounts}
            sec={intSec}
            setSec={setIntSec}
            setIntChartPeriod={setIntChartPeriod}
            intDateRange={intDateRange}
            setIntDateRange={setIntDateRange}
            setIntAppliedRange={setIntAppliedRange}
            handleIntSearchClick={handleIntSearchClick}
            setIntIsZeroBaseMode={setIntIsZeroBaseMode}
            setHoveredIntCatSlice={setHoveredIntCatSlice}
            setHoveredIntHoldSlice={setHoveredIntHoldSlice}
            setShowNewAccountMenu={setShowNewAccountMenu}
            setSimpleEditField={setSimpleEditField}
            addPortfolio={addPortfolio}
            addSimpleAccount={addSimpleAccount}
            deletePortfolio={deletePortfolio}
            switchToPortfolio={switchToPortfolio}
            movePortfolio={movePortfolio}
            updatePortfolioColor={updatePortfolioColor}
            updatePortfolioStartDate={updatePortfolioStartDate}
            updatePortfolioName={updatePortfolioName}
            updatePortfolioMemo={updatePortfolioMemo}
            updateSimpleAccountField={updateSimpleAccountField}
            resetAllPortfolioColors={resetAllPortfolioColors}
            handleIntChartMouseDown={handleIntChartMouseDown}
            handleIntChartMouseMove={handleIntChartMouseMove}
            handleIntChartMouseUp={handleIntChartMouseUp}
            handleIntChartMouseLeave={handleIntChartMouseLeave}
            intHoveredPoint={intHoveredPoint}
            handleSave={handleSave}
            allPortfoliosForDividend={allPortfoliosForDividend}
            updatePortfolioDividendHistory={updatePortfolioDividendHistory}
            updatePortfolioActualDividend={updatePortfolioActualDividend}
            updatePortfolioActualDividendUsd={updatePortfolioActualDividendUsd}
            updatePortfolioDividendTaxRate={updatePortfolioDividendTaxRate}
            updatePortfolioDividendSeparateTax={updatePortfolioDividendSeparateTax}
            updatePortfolioDividendTaxAmount={updatePortfolioDividendTaxAmount}
            updatePortfolioActualAfterTaxUsd={updatePortfolioActualAfterTaxUsd}
            updatePortfolioActualAfterTaxKrw={updatePortfolioActualAfterTaxKrw}
            usdkrw={marketIndicators.usdkrw || 1300}
            dividendTaxHistory={dividendTaxHistory}
            onManualBackfill={handleManualBackfill}
          />
        )}

        </div>
        </div>
        {/* 우측 광고 패널 */}
        <div className="hidden min-[1800px]:flex w-[160px] shrink-0 flex-col items-center pt-16 border-l border-gray-800/50">
          <div className="sticky top-16 w-[140px] min-h-[600px] rounded-lg bg-gray-800/10">
          </div>
        </div>
      </div>


      <PasteModal
        isPasteModalOpen={isPasteModalOpen}
        setIsPasteModalOpen={setIsPasteModalOpen}
        portfolio={portfolio}
        setPortfolio={setPortfolio}
      />
    </div>
  );
}
