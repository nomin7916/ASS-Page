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
import { DRIVE_FILES, saveDriveFile, loadDriveFile, MAX_BACKUPS, findUserIndexFolder, saveVersionedBackup } from './driveStorage';
import Header from './components/Header';
import PortfolioTable from './components/PortfolioTable';
import KrxGoldTable from './components/KrxGoldTable';
import MarketIndicators from './components/MarketIndicators';
import LoginGate, { verifyPin, savePin, hashPin, savePinToDrive, PIN_KEY, SESSION_KEY, UserFeatures } from './components/LoginGate';
import AdminPage from './components/AdminPage';
import AdminPortal from './components/AdminPortal';
import AdminNotificationModal, { AdminNotification } from './components/AdminNotificationModal';
import AdminChoiceModal from './components/AdminChoiceModal';
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
import LoadingOverlay from './components/LoadingOverlay';
import InactivityModal from './components/InactivityModal';
import FloatingCalculator from './components/FloatingCalculator';
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
import { useMarketCalendar, getTodayKST, getEffectiveDate, getMsUntilCutoff } from './hooks/useMarketCalendar';
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

  // ── 초기 로딩 오버레이 ──
  const [isInitialLoading, setIsInitialLoading] = useState(false);

  // ── 인증 상태 ──
  const [authUser, setAuthUser] = useState<{ email: string; token: string } | null>(null);
  const [userFeatures, setUserFeatures] = useState<UserFeatures>({ name: '', feature1: false, feature2: false, feature3: false });
  const [showAdminPage, setShowAdminPage] = useState(false);
  const [showAdminPortal, setShowAdminPortal] = useState(false);
  const [showAdminChoiceModal, setShowAdminChoiceModal] = useState(false);
  const [adminPendingChoice, setAdminPendingChoice] = useState(false);
  const [driveLoadReady, setDriveLoadReady] = useState(false);
  const [adminViewUserCtx, setAdminViewUserCtx] = useState<{
    userEmail: string; userFolderId: string; adminToken: string; adminPinHash: string;
  } | null>(null);
  const [showDividendTaxPage, setShowDividendTaxPage] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [dividendTaxHistory, setDividendTaxHistory] = useState<Record<string, any>>({});
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [notebookLinks, setNotebookLinks] = useState<{title: string, url: string, createdAt: number}[]>([]);
  const [adminViewingAs, setAdminViewingAs] = useState<string | null>(null);
  const [pendingAdminNotifs, setPendingAdminNotifs] = useState<AdminNotification[]>([]);
  const [seenAdminNotifIds, setSeenAdminNotifIds] = useState<string[]>([]);
  const seenAdminNotifIdsRef = useRef<string[]>([]);
  const adminOwnDriveTokenRef = useRef<string>('');
  const adminViewingAsRef = useRef<string | null>(null);
  const adminTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminSessionWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminSessionExpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminSessionStartAtRef = useRef(0);
  const [adminSessionElapsed, setAdminSessionElapsed] = useState(0);
  const [adminSwitching, setAdminSwitching] = useState(false);
  const [userLastSeen, setUserLastSeen] = useState<Record<string, number>>({});
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
    setAdminViewingAs(null);
    adminViewingAsRef.current = null;
    adminTransitioningRef.current = false;
    if (adminSessionWarningTimerRef.current) clearTimeout(adminSessionWarningTimerRef.current);
    if (adminSessionExpireTimerRef.current) clearTimeout(adminSessionExpireTimerRef.current);
    adminSessionStartAtRef.current = 0;
    setAdminSessionElapsed(0);
    setAuthUser({ email, token });
    setUserFeatures(features);
    driveTokenRef.current = token;
    // 관리자가 사용자로 접속: 사전 확보된 폴더 ID 주입 → Drive 로드 바로 시작
    if (adminViewUserCtx && email.toLowerCase() === adminViewUserCtx.userEmail.toLowerCase()) {
      driveFolderIdRef.current = adminViewUserCtx.userFolderId;
      setAdminViewUserCtx(null);
      setIsInitialLoading(true);
      setDriveLoadReady(true);
      return;
    }
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      setAdminPendingChoice(true);
    } else {
      setIsInitialLoading(true);
      setDriveLoadReady(true);
    }
  };

  const handleAdminViewUser = (targetEmail: string) => {
    if (adminSwitching) return;
    setAdminSwitching(true);
    setShowAdminPage(false);
    setShowAdminPortal(false);
    const tryInit = (retries = 20) => {
      if ((window as any).google?.accounts?.oauth2) {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile https://www.googleapis.com/auth/drive',
          hint: authUser.email,
          callback: async (resp: any) => {
            if (resp.error || !resp.access_token) {
              const errMsg =
                resp.error === 'access_denied' ? '관리자 Drive 권한이 거부되었습니다. Google 계정 권한을 확인하세요.' :
                resp.error === 'popup_closed_by_user' ? '인증 창이 닫혔습니다. 다시 시도해 주세요.' :
                resp.error === 'invalid_client' ? 'OAuth 클라이언트 설정 오류입니다. 관리자에게 문의하세요.' :
                `Drive 인증 실패 (${resp.error || '알 수 없는 오류'})`;
              notify(errMsg, 'error');
              setAdminSwitching(false);
              setShowAdminPage(true);
              return;
            }
            const freshToken = resp.access_token;
            let userFolderId: string | null = null;
            try {
              userFolderId = await findUserIndexFolder(freshToken, targetEmail);
            } catch (e) {
              const msg = e instanceof Error ? e.message : '';
              const errMsg =
                msg === 'TOKEN_EXPIRED' ? `토큰 충돌: 관리자 인증이 만료되었습니다. 다시 접속해 주세요.` :
                msg === 'PERMISSION_DENIED' ? `Drive 접근 권한 없음: ${targetEmail} 폴더에 접근할 수 없습니다.` :
                `폴더 검색 오류 (${msg}). 네트워크 상태를 확인하세요.`;
              notify(errMsg, 'error');
              setAdminSwitching(false);
              setShowAdminPage(true);
              return;
            }
            if (!userFolderId) {
              notify(`${targetEmail} 사용자의 Drive 폴더를 찾을 수 없습니다. 해당 사용자가 앱을 한 번 이상 실행했는지 확인하세요.`, 'error');
              setAdminSwitching(false);
              setShowAdminPage(true);
              return;
            }
            try {
              const stateData = await loadDriveFile(freshToken, userFolderId, DRIVE_FILES.STATE) as any;
              const isAllowed = !stateData || stateData.adminAccessAllowed !== false;
              setUserAccessStatus(prev => ({ ...prev, [targetEmail]: isAllowed }));
              if (!isAllowed) {
                notify(`${targetEmail} 사용자가 관리자 접속을 허용하지 않았습니다.`, 'warning');
                setAdminSwitching(false);
                setShowAdminPage(true);
                return;
              }
            } catch {
              setUserAccessStatus(prev => ({ ...prev, [targetEmail]: true }));
            }
            // 관리자 PIN 해시 저장 — LoginGate에서 마스터 키로 사용
            const adminPinHash = sessionStorage.getItem(PIN_KEY(authUser.email)) || '';
            // 컨텍스트 설정 후 완전 로그아웃 → LoginGate가 PIN 화면으로 재진입
            setAdminViewUserCtx({ userEmail: targetEmail, userFolderId, adminToken: freshToken, adminPinHash });
            setAdminSwitching(false);
            sessionStorage.removeItem(SESSION_KEY);
            setAuthUser(null);
            driveTokenRef.current = '';
            setDriveToken('');
            setDriveLoadReady(false);
            setAdminPendingChoice(false);
            setAdminViewingAs(null);
            adminViewingAsRef.current = null;
            adminTransitioningRef.current = false;
          },
        });
        client.requestAccessToken({ prompt: '' });
      } else if (retries > 0) {
        setTimeout(() => tryInit(retries - 1), 300);
      } else {
        notify('Google 인증 초기화 실패', 'error');
        setAdminSwitching(false);
        setShowAdminPage(true);
      }
    };
    tryInit();
  };


  const handleRefreshUserSessions = async (emails: string[]) => {
    const token = driveTokenRef.current;
    if (!token) return;
    for (const email of emails) {
      try {
        const folderId = await findUserIndexFolder(token, email);
        if (!folderId) continue;
        const sessionData = await loadDriveFile(token, folderId, DRIVE_FILES.SESSION) as any;
        if (sessionData?.lastSeen) {
          setUserLastSeen(prev => ({ ...prev, [email]: sessionData.lastSeen }));
        }
      } catch {}
    }
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

  // 07:30 이전: 전날 날짜로 기록 / 07:30 이후: 오늘 날짜로 기록
  const [effectiveDateKey, setEffectiveDateKey] = useState(() => getEffectiveDate());
  useEffect(() => {
    const ms = getMsUntilCutoff();
    if (ms === null) return;
    const timer = setTimeout(() => setEffectiveDateKey(getEffectiveDate()), ms);
    return () => clearTimeout(timer);
  }, []);

  const [userAccessStatus, setUserAccessStatus] = useState<Record<string, boolean>>({});

  const portfolioRef = useRef([]);
  const portfoliosRef = useRef([]);
  const marketIndicatorsRef = useRef({});
  const activePortfolioAccountTypeRef = useRef('portfolio'); // 클로저 문제 해결용
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
  const [simpleEditField, setSimpleEditField] = useState<{id: string, field: string, rawVal?: string} | null>(null);
  const [showNewAccountMenu, setShowNewAccountMenu] = useState(false);
  const [showUnlockPinModal, setShowUnlockPinModal] = useState(false);
  const [unlockPinDigits, setUnlockPinDigits] = useState(['', '', '', '']);
  const [unlockPinError, setUnlockPinError] = useState('');
  const [sectionCollapsedMap, setSectionCollapsedMap] = useState({});
  const [matongClosedIds, setMatongClosedIds] = useState({});
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
    showInactivityWarning,
    resetActivity,
    handleInactivityContinue,
    handleInactivityLogout,
    driveTokenRef, driveFolderIdRef, tokenClientRef, pendingTokenResolveRef,
    isInitialLoad, driveSaveTimerRef, portfolioUpdatedAtRef, prevPortfolioStructureRef,
    lastDriveSavedPortfolioUpdatedAtRef, driveCheckInProgressRef, lastDriveCheckAtRef,
    goldKrAutoCrawledRef, stooqAutoCrawledRef, adminTransitioningRef, ownFolderIdRef, syncStatusRef,
    ensureDriveFolder, loadFromDrive, loadStockFromDrive, saveAllToDrive, requestDriveToken,
    initTokenClient, checkAndSyncFromDrive,
    handleDriveLoadOnly, handleOpenBackupModal, handleApplyBackup, handleImportStateFile,
    handleAutoBackupWithMemo,
    initSession,
  } = useDriveSync({
    authUser,
    applyStateData: (...args) => applyStateDataRef.current?.(...args),
    applyStockData: (...args) => applyStockDataRef.current?.(...args),
    applyBackupData: (...args) => applyBackupDataRef.current?.(...args),
    accountChartStatesRef, saveStateRef, adminViewingAsRef, adminOwnDriveTokenRef, notify, confirm,
    onForceLogout: () => {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.reload();
    },
  });

  // ── 사용자 활동 감지 → 비활동 타임아웃 리셋 ──
  useEffect(() => {
    if (!authUser) return;
    const handler = () => resetActivity();
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [authUser]);

  useEffect(() => {
    document.title = authUser ? `종합 자산 관리 - ${authUser.email}` : '종합 자산 관리';
  }, [authUser]);

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
    hiddenColumnsPortfolio, hiddenColumnsRebalancing,
    toggleHiddenColumnPortfolio, toggleHiddenColumnRebalancing,
    adminAccessAllowed, setAdminAccessAllowed,
    activePortfolioAccountType,
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

  // ── 포트폴리오 구성 변경 감지 → 자동 백업 ──
  const portfolioCompositionTrackerRef = useRef({ id: '', key: '' });
  const portfolioCompositionKey = useMemo(() =>
    portfolio
      .filter(p => p.type === 'stock' || p.type === 'fund')
      .map(p => `${p.id}:${p.quantity ?? 0}:${p.investAmount ?? 0}`)
      .join('|'),
    [portfolio]
  );
  useEffect(() => {
    const tracker = portfolioCompositionTrackerRef.current;
    if (tracker.id !== activePortfolioId || tracker.key === '') {
      portfolioCompositionTrackerRef.current = { id: activePortfolioId, key: portfolioCompositionKey };
      return;
    }
    if (tracker.key !== portfolioCompositionKey) {
      portfolioCompositionTrackerRef.current = { ...tracker, key: portfolioCompositionKey };
      handleAutoBackupWithMemo('포트폴리오 변경');
    }
  }, [portfolioCompositionKey, activePortfolioId]);

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
      const restoredId = stateData.activePortfolioId || stateData.portfolios[0].id;
      const restoredP = normalizedPortfolios.find(p => p.id === restoredId);
      if (restoredP?.accountType === 'simple' || restoredP?.accountType === 'matong') {
        setShowIntegratedDashboard(true);
      } else {
        setActivePortfolioId(restoredId);
      }
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
      if (stateData.chartPrefs.matongClosedIds) setMatongClosedIds(stateData.chartPrefs.matongClosedIds);
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
    seenAdminNotifIdsRef.current = stateData.seenAdminNotifIds || [];
    setSeenAdminNotifIds(seenAdminNotifIdsRef.current);
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
      const restoredId = stateData.activePortfolioId || stateData.portfolios[0].id;
      const restoredP = normalizedPortfolios.find(p => p.id === restoredId);
      if (restoredP?.accountType === 'simple' || restoredP?.accountType === 'matong') {
        setShowIntegratedDashboard(true);
      } else {
        setActivePortfolioId(restoredId);
      }
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
      if (stateData.chartPrefs.matongClosedIds) setMatongClosedIds(stateData.chartPrefs.matongClosedIds);
    }
  };
  applyBackupDataRef.current = applyBackupData;

  // *Ref를 항상 최신 상태로 동기화 (stale closure 방지)
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
    rebalExtraQty,
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
    const sortedDeposits = [...depositHistory].sort((a, b) => a.date < b.date ? -1 : 1);
    const sortedWithdrawals = [...depositHistory2].sort((a, b) => a.date < b.date ? -1 : 1);
    const isOverseasChart = activePortfolioAccountType === 'overseas';
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
      let principalAmount = 0;
      for (const d of sortedDeposits) { if (d.date <= date) principalAmount += cleanNum(d.amount) * (isOverseasChart ? (cleanNum(d.fxRate) || 1) : 1); else break; }
      for (const w of sortedWithdrawals) { if (w.date <= date) principalAmount -= (w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount)) * (isOverseasChart ? (cleanNum(w.fxRate) || 1) : 1); else break; }
      if (principalAmount === 0 && date >= portfolioStartDate && cleanNum(principal) > 0) {
        const fallbackFx = isOverseasChart ? (cleanNum(avgExchangeRate) || marketIndicators?.usdkrw || 1) : 1;
        principalAmount = cleanNum(principal) * fallbackFx;
      }
      return { date, ...(indexDataMap[date] || {}), evalAmount: trueEvalAtDate, returnRate: retRate, principalAmount };
    });
    const zeroBasedData = (!isZeroBaseMode || rawData.length === 0) ? rawData : (() => {
      const baseItem = rawData.find(item => item.evalAmount > 0) || rawData[0];
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
          returnRate: item.evalAmount === 0 ? 0 : (baseItem.evalAmount > 0 ? ((item.evalAmount / baseItem.evalAmount) - 1) * 100 : 0),
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
  }, [filteredDates, indexDataMap, stockHistoryMap, portfolio, history, totals.totalEval, principal, portfolioStartDate, isZeroBaseMode, indicatorScales, compStocks, depositHistory, depositHistory2, activePortfolioAccountType, avgExchangeRate, marketIndicators]);

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
    intDepositEvents,
  } = useIntegratedData({
    portfolios, activePortfolioId, portfolio, principal,
    avgExchangeRate, portfolioStartDate, title, marketIndicators,
    history, depositHistory, depositHistory2, intAppliedRange, intIsZeroBaseMode,
    effectiveDateKey,
  });


  const { handleManualBackfill } = useHistoryBackfill({
    stockHistoryMap, indicatorHistoryMap, marketIndicators,
    portfolioSummaries, portfolios, setPortfolios,
    activePortfolioId, activePortfolioAccountType,
    portfolio, principal, history, setHistory,
    portfolioStartDate, notify, effectiveDateKey,
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
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds }, intHistory };
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

  const handleDeleteNotificationEntry = async (entry) => {
    const newLog = notificationLog.filter(e => e.id !== entry.id);
    setNotificationLog(newLog);
    if (driveTokenRef.current) {
      try {
        const folderId = driveFolderIdRef.current || await ensureDriveFolder(driveTokenRef.current);
        await saveDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.NOTIFICATION_LOG, { entries: newLog });
      } catch {}
    }
  };

  const handleSetYoutubeUrl = async (url: string) => {
    // 관리자 Drive에 직접 저장 (정본) — Apps Script 상태와 무관하게 즉시 반영
    try {
      const token = driveTokenRef.current;
      if (!token) { notify('Drive 인증 필요', 'error'); return; }
      const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
      await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, { youtubeUrl: url, notebookLinks });
      setYoutubeUrl(url);
      notify(url ? 'YouTube 채널 링크가 설정되었습니다.' : 'YouTube 채널 링크가 삭제되었습니다.', 'success');
    } catch {
      notify('YouTube 링크 저장 실패 (Drive 오류)', 'error');
      return;
    }
    // Apps Script 배포 — 일반 사용자에게 전달 (비차단, 실패 무시)
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'setSettings', key: 'youtubeUrl', value: url }),
    }).catch(() => {});
  };

  const handleSetNotebookLinks = async (links: {title: string, url: string, createdAt: number}[]) => {
    // 관리자 Drive에 직접 저장 (정본) — Apps Script 상태와 무관하게 즉시 반영
    try {
      const token = driveTokenRef.current;
      if (!token) { notify('Drive 인증 필요', 'error'); return; }
      const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
      await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, { youtubeUrl, notebookLinks: links });
      setNotebookLinks(links);
      notify('노트북LM 링크가 저장됐습니다.', 'success');
    } catch {
      notify('링크 저장 실패 (Drive 오류)', 'error');
      return;
    }
    // Apps Script 배포 — 일반 사용자에게 전달 (비차단, 실패 무시)
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'setSettings', key: 'notebookLinks', value: JSON.stringify(links) }),
    }).catch(() => {});
  };

  const handleDriveSave = () => {
    const currentPortfolios = buildPortfoliosState();
    // portfolioUpdatedAt이 없으면 saveAllToDrive의 guard(0 > 0)가 항상 false → STATE 저장 안됨
    // 수동 저장은 항상 강제 저장되어야 하므로 새 타임스탬프 생성 후 guard 초기화
    const newUpdatedAt = Date.now();
    portfolioUpdatedAtRef.current = newUpdatedAt;
    lastDriveSavedPortfolioUpdatedAtRef.current = 0;
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds }, intHistory, portfolioUpdatedAt: newUpdatedAt };
    if (driveTokenRef.current) {
      saveAllToDrive(state, 'manual'); // 수동 저장 → 타임스탬프 백업 포함
    } else {
      notify('☁️ Drive 미연결 — 먼저 Drive를 연결해 주세요', 'warning');
    }
  };

  const handleDownloadStateFile = () => {
    const currentPortfolios = buildPortfoliosState();
    const newUpdatedAt = Date.now();
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds }, intHistory, portfolioUpdatedAt: newUpdatedAt };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    a.href = url;
    a.download = `portfolio_state_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('PC에 데이터를 저장했습니다.', 'success');
  };

  const handleAppClose = async () => {
    notify('백업 저장합니다.', 'info');
    const currentPortfolios = buildPortfoliosState();
    const newUpdatedAt = Date.now();
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds }, intHistory, portfolioUpdatedAt: newUpdatedAt };
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


  // 로그인 완료 후 Drive 초기화 + 시장 데이터 수집
  useEffect(() => {
    if (!authUser || !driveLoadReady) return;

    // 로그인 완료 즉시 오버레이 표시 — Drive 로딩 전 구간부터 차단
    setIsInitialLoading(true);

    const token = authUser.token;

    // Drive 토큰 설정 (항상 Drive 우선 로드)
    driveTokenRef.current = token;
    setDriveToken(token);
    setDriveStatus('');

    const bgTimer = setTimeout(async () => {
      initTokenClient();

      // 항상 Drive에서 최신 데이터 로드 — localStorage 캐시 사용 안 함
      notify('Drive 데이터 불러오는 중...', 'info');
      const drivePortfolio = await loadFromDrive(token, true);
      if (drivePortfolio === null && syncStatusRef.current !== 'error') {
        // 완전 신규 사용자 (파일 없음, 오류 아님): 초기 포트폴리오 생성
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

      // 앱 설정 로드
      // 관리자: Drive가 정본. Drive 파일 없으면 Apps Script로 마이그레이션 (1회) 후 Drive에 저장
      // 일반 사용자: Drive 캐시 우선 → Apps Script로 갱신
      const isAdmin = authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      let driveSettingsFound = false;
      try {
        const settingsFolderId = driveFolderIdRef.current || await ensureDriveFolder(token);
        const driveSettings = await loadDriveFile(token, settingsFolderId, DRIVE_FILES.SETTINGS) as any;
        if (driveSettings) {
          if (driveSettings.youtubeUrl) setYoutubeUrl(driveSettings.youtubeUrl);
          if (Array.isArray(driveSettings.notebookLinks)) setNotebookLinks(driveSettings.notebookLinks);
          // 실제 데이터가 있을 때만 "찾음"으로 처리 — 빈 배열만 있으면 Apps Script 폴백 허용
          driveSettingsFound = !!(driveSettings.youtubeUrl || driveSettings.notebookLinks?.length > 0);
        }
      } catch {}
      if (!isAdmin || !driveSettingsFound) {
        // 일반 사용자는 항상, 관리자는 Drive 파일 없을 때만 (최초 마이그레이션)
        try {
          const settingsRes = await fetch(`${APPS_SCRIPT_URL}?action=getSettings&cacheBust=${Date.now()}`);
          if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            const yu = settingsData.youtubeUrl || '';
            const nl: any[] | null = settingsData.notebookLinks ? (() => { try { return JSON.parse(settingsData.notebookLinks); } catch { return null; } })() : null;
            setYoutubeUrl(yu);
            if (Array.isArray(nl)) setNotebookLinks(nl);
            // 관리자: Drive에 저장 (이후 Drive가 정본으로 동작)
            // 일반 사용자: Drive에 캐시 저장
            try {
              const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
              await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, { youtubeUrl: yu, notebookLinks: Array.isArray(nl) ? nl : [] });
            } catch {}
          }
        } catch {}
      }

      // 관리자 공지 확인 (관리자 본인 제외)
      if (authUser.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        try {
          // Apps Script getNotifications 엔드포인트 필요:
          // action=getNotifications → { notifications: [{id, targetEmail, message, type, createdAt}] }
          const notifsRes = await fetch(`${APPS_SCRIPT_URL}?action=getNotifications&cacheBust=${Date.now()}`);
          if (notifsRes.ok) {
            const notifsData = await notifsRes.json();
            const all: AdminNotification[] = notifsData.notifications || [];
            const myAll = all.filter(n =>
              n.targetEmail === '__all__' || n.targetEmail?.toLowerCase() === authUser.email.toLowerCase()
            );
            const myNotifs = myAll.filter(n => !seenAdminNotifIdsRef.current.includes(n.id));
            if (myNotifs.length > 0) {
              setPendingAdminNotifs(myNotifs);
            }
          }
        } catch {}
      }

      // 시장지표 수집 (백그라운드)
      fetchMarketIndicators();

      // 총자산현황으로 이동
      setShowIntegratedDashboard(true);

      // 전체 계좌 현재가 일괄 갱신
      await refreshPrices();
      setIsInitialLoading(false);

      // 세션 초기화 (단일 세션 강제 적용)
      initSession();

      isInitialLoad.current = false;

      // STOCK 파일 백그라운드 로드 — await 없이 실행 (앱 시작을 막지 않음)
      loadStockFromDrive(token);
    }, 400);

    return () => clearTimeout(bgTimer);
  }, [authUser, driveLoadReady]);

  // Admin Page 모드 전용 settings 로드
  // driveLoadReady=false 상태(포트폴리오 로드 없이 관리자 페이지 직접 진입)에서만 실행
  useEffect(() => {
    if (!showAdminPage || !authUser || driveLoadReady) return;
    const token = driveTokenRef.current;
    if (!token) return;
    (async () => {
      let found = false;
      try {
        const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
        const settings = await loadDriveFile(token, folderId, DRIVE_FILES.SETTINGS) as any;
        if (settings?.youtubeUrl) { setYoutubeUrl(settings.youtubeUrl); found = true; }
        if (Array.isArray(settings?.notebookLinks) && settings.notebookLinks.length > 0) {
          setNotebookLinks(settings.notebookLinks); found = true;
        }
      } catch {}
      if (!found) {
        try {
          const res = await fetch(`${APPS_SCRIPT_URL}?action=getSettings&cacheBust=${Date.now()}`);
          if (res.ok) {
            const d = await res.json();
            if (d.youtubeUrl) setYoutubeUrl(d.youtubeUrl);
            if (d.notebookLinks) {
              try { setNotebookLinks(JSON.parse(d.notebookLinks)); } catch {}
            }
          }
        } catch {}
      }
    })();
  }, [showAdminPage, authUser, driveLoadReady]);

  // 관리자 공지 주기적 폴링 (5분마다) — 앱 사용 중 새 공지 즉시 감지
  useEffect(() => {
    if (!authUser || authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return;
    const poll = async () => {
      try {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=getNotifications&cacheBust=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        const all: AdminNotification[] = data.notifications || [];
        const myAll = all.filter(n =>
          n.targetEmail === '__all__' || n.targetEmail?.toLowerCase() === authUser.email.toLowerCase()
        );
        const newNotifs = myAll.filter(n => !seenAdminNotifIdsRef.current.includes(n.id));
        if (newNotifs.length > 0) {
          setPendingAdminNotifs(prev => {
            const prevIds = prev.map(p => p.id);
            return [...prev, ...newNotifs.filter(n => !prevIds.includes(n.id))];
          });
        }
      } catch {}
    };
    const interval = setInterval(poll, 5 * 60 * 1000);
    return () => clearInterval(interval);
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
    // 계좌/종목 구조 + history 건수 비교
    // historyLen: 항목 추가·삭제 시 Drive 저장 트리거 (비활성 계좌 자동 기록, 백필, 수동 입력 모두 포함)
    // 평가액 값 자체는 제외 — 시장가격 갱신이 portfolioUpdatedAt을 덮어쓰지 않도록 방지
    // compStocks(비교종목 추가/활성화)도 구조 변경으로 간주 → Drive STATE 즉시 반영
    const portfolioStructureKey = JSON.stringify([
      currentPortfolios.map(p => ({
        id: p.id, name: p.name,
        startDate: p.startDate || p.portfolioStartDate,
        portfolioStartDate: p.portfolioStartDate || p.startDate,
        portfolio: (p.portfolio || []).map(item => ({ id: item.id, type: item.type, code: item.code, name: item.name, quantity: item.quantity, investAmount: item.investAmount, purchasePrice: item.purchasePrice, depositAmount: item.depositAmount })),
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
        historyLen: (p.history || []).length,
      })),
      activePortfolioId, customLinks,
      compStocks.map(c => `${c.code}:${c.active ? 1 : 0}`).join(','),
    ]);
    if (portfolioStructureKey !== prevPortfolioStructureRef.current) {
      const wasInitial = prevPortfolioStructureRef.current === '';
      prevPortfolioStructureRef.current = portfolioStructureKey;
      if (!wasInitial) {
        portfolioUpdatedAtRef.current = Date.now();
      }
    }
    // 활성 포트폴리오의 차트 상태(비교종목 포함)를 항상 최신으로 유지
    if (activePortfolioId) {
      accountChartStatesRef.current[activePortfolioId] = { ...currentChartStateRef.current };
    }
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds }, intHistory, seenAdminNotifIds, updatedAt: Date.now(), portfolioUpdatedAt: portfolioUpdatedAtRef.current };
    saveStateRef.current = state;
    if (!isInitialLoad.current && driveTokenRef.current) {
      if (driveSaveTimerRef.current) clearTimeout(driveSaveTimerRef.current);
      driveSaveTimerRef.current = setTimeout(() => {
        saveAllToDrive(state);
      }, 800);
    }
  }, [portfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, intHistory, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, chartPeriod, dateRange, seenAdminNotifIds]);

  useEffect(() => {
    if (totals.totalEval === 0) return;
    if (!calendarLoaded) return;
    const today = effectiveDateKey;
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
  }, [totals.totalEval, principal, calendarLoaded, activePortfolioAccountType, effectiveDateKey]);

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
    return <LoginGate onApproved={handleLoginApproved} adminViewUserCtx={adminViewUserCtx} onCancelAdminView={() => setAdminViewUserCtx(null)} />;
  }

  // 관리자 로그인 직후 — Drive 로딩 전 페이지 선택
  if (adminPendingChoice) {
    return (
      <AdminChoiceModal
        adminEmail={authUser.email}
        onSelectPortfolio={() => { setAdminPendingChoice(false); setDriveLoadReady(true); }}
        onSelectAdmin={() => { setAdminPendingChoice(false); setShowAdminPage(true); }}
      />
    );
  }

  // 관리자 포털
  if (showAdminPortal && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return (
      <AdminPortal
        adminEmail={authUser.email}
        onClose={() => { setShowAdminPortal(false); setShowAdminPage(true); }}
        onViewUser={handleAdminViewUser}
        notify={notify}
      />
    );
  }

  // 관리자 페이지
  if (showAdminPage && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return <AdminPage adminEmail={authUser.email} onClose={() => {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.reload();
    }} onViewUser={handleAdminViewUser} onOpenPortal={() => { setShowAdminPage(false); setShowAdminPortal(true); }} userAccessStatus={userAccessStatus} switching={adminSwitching} userLastSeen={userLastSeen} onRefreshUserSessions={handleRefreshUserSessions} youtubeUrl={youtubeUrl} onSetYoutubeUrl={handleSetYoutubeUrl} notebookLinks={notebookLinks} onSetNotebookLinks={handleSetNotebookLinks} />;
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
      <ConfirmDialog state={confirmState} onResolve={resolveConfirm} />
      <LoadingOverlay visible={isInitialLoading} notificationLog={notificationLog} onDismiss={() => setIsInitialLoading(false)} />
      {showInactivityWarning && <InactivityModal onContinue={handleInactivityContinue} onLogout={handleInactivityLogout} />}
      {showAdminChoiceModal && (
        <AdminChoiceModal
          adminEmail={authUser.email}
          onSelectPortfolio={() => { setShowAdminChoiceModal(false); if (!driveLoadReady) setDriveLoadReady(true); }}
          onSelectAdmin={() => { setShowAdminChoiceModal(false); setShowAdminPage(true); }}
        />
      )}
      {pendingAdminNotifs.length > 0 && (
        <AdminNotificationModal
          notifications={pendingAdminNotifs}
          onClose={() => {
            const newSeen = [...seenAdminNotifIds, ...pendingAdminNotifs.map(n => n.id)];
            seenAdminNotifIdsRef.current = newSeen;
            setSeenAdminNotifIds(newSeen);
            pendingAdminNotifs.forEach(n => notify(`[관리자 공지] ${n.message}`, n.type || 'info', { adminNotifId: n.id }));
            setPendingAdminNotifs([]);
            // portfolioUpdatedAt 없이 저장 시 가드가 STATE 파일 저장을 스킵 → seenAdminNotifIds 유실 방지
            const nowTs = Date.now();
            portfolioUpdatedAtRef.current = nowTs;
            lastDriveSavedPortfolioUpdatedAtRef.current = 0;
            saveAllToDrive({ ...saveStateRef.current, seenAdminNotifIds: newSeen, portfolioUpdatedAt: nowTs });
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
        {/* 메인 컨텐츠 */}
        <div className="flex-1 min-w-0 py-4 px-3 md:px-5 md:py-5">
        <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-6">
        {/* 로그인 사용자 정보 바 */}
        <UserInfoBar
          email={authUser.email}
          adminAccessAllowed={adminAccessAllowed}
          onOpenAdmin={undefined}
          onOpenAdminPortal={undefined}
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
          onLogout={() => {
            sessionStorage.removeItem(SESSION_KEY);
            window.location.reload();
          }}
          canAccessDividendTax={canAccessDividendTax}
          onOpenDividendTax={() => setShowDividendTaxPage(true)}
          onAppClose={handleAppClose}
          showCalculator={showCalculator}
          onToggleCalculator={() => setShowCalculator(v => !v)}
          youtubeUrl={youtubeUrl}
          notebookLinks={notebookLinks}
        />

        {/* 알림 바 */}
        <NotificationBar notificationLog={notificationLog} onClear={handleClearNotificationLog} unreadCount={unreadCount} onRead={markAsRead} onDeleteEntry={handleDeleteNotificationEntry} />

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
          handleDownloadStateFile={handleDownloadStateFile}
          isAdmin={authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()}
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
          <PortfolioTable portfolio={totals.calcPortfolio} totals={totals} sortConfig={sortConfig} onSort={handleSort} onUpdate={handleUpdate} onBlur={handleStockBlur} onDelete={handleDeleteStock} onAddStock={handleAddStock} onAddFund={handleAddFund} stockFetchStatus={stockFetchStatus} onSingleRefresh={handleSingleStockRefresh} isOverseas={activePortfolioAccountType === 'overseas'} usdkrw={marketIndicators.usdkrw || 1} isRetirement={activePortfolioAccountType === 'dc-irp' || activePortfolioAccountType === 'pension'} showRetirementStats={activePortfolioAccountType === 'dc-irp'} hiddenColumns={hiddenColumnsPortfolio} onToggleColumn={toggleHiddenColumnPortfolio} />
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
            stockHistoryMap={stockHistoryMap}
            indicatorHistoryMap={indicatorHistoryMap}
            portfolio={portfolio}
            notify={notify}
            effectiveDateKey={effectiveDateKey}
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
            setPrincipal={setPrincipal}
            principal={principal}
            evalAmount={totals.totalEval}
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
            effectiveDateKey={effectiveDateKey}
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
            isRetirement={activePortfolioAccountType === 'dc-irp' || activePortfolioAccountType === 'pension'}
            showRetirementStats={activePortfolioAccountType === 'dc-irp'}
            hiddenColumns={hiddenColumnsRebalancing}
            onToggleColumn={toggleHiddenColumnRebalancing}
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
            intDepositEvents={intDepositEvents}
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
            addMatongAccount={addMatongAccount}
            updateMatongAccountField={updateMatongAccountField}
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
            matongClosedIds={matongClosedIds}
            setMatongClosedIds={setMatongClosedIds}
          />
        )}

        </div>
        </div>
      </div>


      <PasteModal
        isPasteModalOpen={isPasteModalOpen}
        setIsPasteModalOpen={setIsPasteModalOpen}
        portfolio={portfolio}
        setPortfolio={setPortfolio}
      />
      <FloatingCalculator isOpen={showCalculator} onClose={() => setShowCalculator(false)} />
    </div>
  );
}
