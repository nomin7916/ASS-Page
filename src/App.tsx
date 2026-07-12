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
import { DRIVE_FILES, saveDriveFile, loadDriveFile, MAX_BACKUPS, findUserIndexFolder, saveVersionedBackup, uploadHtmlStudyMaterial, deleteDriveFileById } from './driveStorage';
import PortfolioTable from './components/PortfolioTable';
import KrxGoldTable from './components/KrxGoldTable';
import MarketIndicators from './components/MarketIndicators';
import LoginGate, { verifyPin, savePin, hashPin, savePinToDrive, PIN_KEY, SESSION_KEY, UserFeatures } from './components/LoginGate';
import AdminPage from './components/AdminPage';
import AdminPortal from './components/AdminPortal';
import AdminNotificationModal, { AdminNotification } from './components/AdminNotificationModal';
import AdminChoiceModal from './components/AdminChoiceModal';
import AdminViewBootstrap from './components/AdminViewBootstrap';
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
import ConfirmDialog from './components/ConfirmDialog';
import LoadingOverlay from './components/LoadingOverlay';
import StudyMaterialViewer from './components/StudyMaterialViewer';
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
import { useAutoConfirmHistory } from './hooks/useAutoConfirmHistory';
import { useIndexImport } from './hooks/useIndexImport';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useIntegratedData } from './hooks/useIntegratedData';
import { useMarketCalendar, getTodayKST, getEffectiveDate, getEffectiveDateKR, getEffectiveDateForAccount, getBackfillBoundaryKR, isKrCutoffAccount, getMsUntilNextBoundary } from './hooks/useMarketCalendar';
import {
  generateId, cleanNum, formatCurrency, formatPercent, formatNumber,
  formatChangeRate, formatShortDate, formatVeryShortDate, getSeededRandom,
  getClosestValue, getIndexLatest, handleTableKeyDown, handleReadonlyCellNav, buildIndexStatus,
  hexToRgba, blendWithDarkBg, downloadCSV, buildHistoryCSV, buildLookupCSV, buildDepositCSV,
  fillWeekendGaps, fillNonTradingGaps, calcPeriodStart,
  ensurePortfolioVerificationFields, snapshotItemsFromPortfolio, snapshotCompositionKey,
  computeEffectivePrincipal, dedupeHistoryByDate, savingsEval, buildCloseEvalSeries,
  noticeChannelOf, resolveNoticeMaterial
} from './utils';

import { INT_CATEGORIES, ACCOUNT_TYPE_CONFIG, CATEGORY_DISPLAY_ORDER } from './constants';

// 공지 수신 대상 판정 — '__notebook__'(학습자료 등록 알림)은 학습자료 ON 사용자만,
// '__report__'(시장리포트 등록 알림)은 시장리포트 ON 사용자만 수신.
// '__all__'은 전체, 그 외는 해당 이메일만. (관리자는 호출 전에 이미 제외됨)
function notifTargetsUser(targetEmail: string, email: string, notebookEnabled: boolean, reportEnabled: boolean): boolean {
  if (targetEmail === '__notebook__') return notebookEnabled === true;
  if (targetEmail === '__report__') return reportEnabled === true;
  return targetEmail === '__all__' || targetEmail?.toLowerCase() === email.toLowerCase();
}

// 새 탭 관리자 접속(impersonation): "접속" 버튼이 window.open('/?adminView=<email>')로 새 탭을 연다.
// 이 상수는 새 탭 콜드부팅 시 1회 산출 — 관리자 포털 탭(파라미터 없음)에서는 null이라 영향 없음.
// noopener 새 탭은 보통 opener의 sessionStorage를 상속하지 않지만, 일부 브라우저가 복제할 경우
// 복제된 관리자 SESSION_KEY가 LoginGate 자동 재인증을 발동시켜 impersonation과 충돌하지 않도록
// 렌더 전에 SESSION_KEY를 제거한다(관리자 토큰은 AdminViewBootstrap이 GIS로 독립 재발급).
const ADMIN_VIEW_EMAIL: string | null = (() => {
  try { return new URLSearchParams(window.location.search).get('adminView'); } catch { return null; }
})();
if (ADMIN_VIEW_EMAIL) {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

// 새 탭 관리자 포털: 관리자 페이지의 "포털" 버튼이 window.open('/?adminPortal=1')로 새 탭을 연다.
// adminView(impersonation)와 달리 SESSION_KEY를 제거하지 않는다 — opener의 sessionStorage가
// 복제되면 LoginGate가 그 관리자 세션으로 무음 재인증(PIN 불필요) 후 곧바로 포털로 진입한다
// (복제가 안 되는 브라우저에선 로그인 화면 → 수동 로그인 후 포털로 진입, 동일 결과). 관리자
// 페이지 탭은 그대로 유지된다(상태 변경 없음). 토큰은 LoginGate/AdminPortal이 GIS로 재발급하므로
// noopener 불필요(오히려 noopener는 sessionStorage 복제를 막아 무음 재인증을 깨뜨림).
const ADMIN_PORTAL_BOOT: boolean = (() => {
  try { return new URLSearchParams(window.location.search).get('adminPortal') === '1'; } catch { return false; }
})();

export default function App() {
  const historyInputRef = useRef(null);

  // ── 초기 로딩 오버레이 ──
  const [isInitialLoading, setIsInitialLoading] = useState(false);

  // ── 인증 상태 ──
  const [authUser, setAuthUser] = useState<{ email: string; token: string } | null>(null);
  const [userFeatures, setUserFeatures] = useState<UserFeatures>({ name: '', feature1: false, feature2: false, feature3: false, youtubeEnabled: false, notebookEnabled: false, reportEnabled: false });
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
  const [notebookLinks, setNotebookLinks] = useState<{title: string, url?: string, fileId?: string, createdAt: number}[]>([]);
  const [reportLinks, setReportLinks] = useState<{title: string, url?: string, fileId?: string, createdAt: number}[]>([]);
  const [adminViewingAs, setAdminViewingAs] = useState<string | null>(null);
  const [targetEditAuthorized, setTargetEditAuthorized] = useState(false);
  const adminTargetNotifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingAdminNotifs, setPendingAdminNotifs] = useState<AdminNotification[]>([]);
  const [seenAdminNotifIds, setSeenAdminNotifIds] = useState<string[]>([]);
  const seenAdminNotifIdsRef = useRef<string[]>([]);
  // 관리자 공지/벨 이력 클릭 → 학습자료/리포트 fileId 자료를 여는 sandbox 뷰어(App 단일 인스턴스). url 자료는 새 탭.
  const [materialViewerLink, setMaterialViewerLink] = useState<any>(null);
  const adminOwnDriveTokenRef = useRef<string>('');
  const adminViewingAsRef = useRef<string | null>(null);
  const adminTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminSessionWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminSessionExpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminSessionStartAtRef = useRef(0);
  const [adminSessionElapsed, setAdminSessionElapsed] = useState(0);
  const [adminSwitching, setAdminSwitching] = useState(false);
  const [userLastSeen, setUserLastSeen] = useState<Record<string, number>>({});
  const [userDriveStatus, setUserDriveStatus] = useState<Record<string, 'found' | 'not_found' | 'error' | 'checking'>>({});
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
      // 관리자가 사용자 계정 보기 모드 진입 — 목표 비중 PIN 우회 및 변경 감시용 플래그
      setAdminViewingAs(email);
      adminViewingAsRef.current = email;
      return;
    }
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      // ?adminPortal=1 새 탭은 선택 모달/관리자 페이지를 건너뛰고 바로 포털로 진입
      if (ADMIN_PORTAL_BOOT) {
        setShowAdminPortal(true);
      } else {
        setAdminPendingChoice(true);
      }
    } else {
      setIsInitialLoading(true);
      setDriveLoadReady(true);
    }
  };

  // 관리자 "접속": 새 탭에서 대상 사용자 대시보드를 연다 — 관리자 포털 탭은 이미 조회된 상태로 유지(재조회 방지).
  // 새 탭은 콜드부팅 시 ?adminView 파라미터를 감지해(AdminViewBootstrap) 관리자 무음 재인증 → 해당 사용자 Drive 로드.
  // 클릭 제스처 직후 동기 window.open 이라야 팝업 차단 안 됨. noopener: 새 탭이 window.opener(포털 탭)에
  // 접근 못 하도록 격리(보안) — 새 탭은 토큰을 GIS로 독립 재발급하므로 opener가 불필요.
  const handleAdminViewUser = (targetEmail: string) => {
    const url = `${window.location.origin}/?adminView=${encodeURIComponent(targetEmail)}`;
    window.open(url, '_blank', 'noopener');
  };

  // 새 탭(impersonation) 종료 — 탭을 닫고, close가 막히면 파라미터 없는 깨끗한 루트로 이동.
  const closeAdminViewTab = () => {
    window.close();
    setTimeout(() => { try { window.location.replace(window.location.origin + '/'); } catch {} }, 150);
  };


  // 사용자 전환 / 로그아웃 시 목표 비중 편집 권한 초기화 (세션 1회 PIN 정책 유지)
  useEffect(() => {
    setTargetEditAuthorized(false);
    if (adminTargetNotifTimerRef.current) {
      clearTimeout(adminTargetNotifTimerRef.current);
      adminTargetNotifTimerRef.current = null;
    }
  }, [authUser?.email]);

  const handleRefreshUserSessions = async (emails: string[]) => {
    const token = driveTokenRef.current;
    if (!token) return;
    setUserDriveStatus(prev => {
      const next = { ...prev };
      for (const e of emails) next[e] = 'checking';
      return next;
    });
    for (const email of emails) {
      try {
        const folderId = await findUserIndexFolder(token, email);
        if (!folderId) {
          setUserDriveStatus(prev => ({ ...prev, [email]: 'not_found' }));
          continue;
        }
        setUserDriveStatus(prev => ({ ...prev, [email]: 'found' }));
        const sessionData = await loadDriveFile(token, folderId, DRIVE_FILES.SESSION) as any;
        if (sessionData?.lastSeen) {
          setUserLastSeen(prev => ({ ...prev, [email]: sessionData.lastSeen }));
        }
        // 관리자 접속 허용/차단 배지(AdminPage) 복원 — 새 탭 접속 흐름에선 호스트 탭이 STATE를 읽지
        // 않으므로(window.open만 수행) 세션 새로고침 시 STATE의 adminAccessAllowed로 배지를 채운다.
        try {
          const stateData = await loadDriveFile(token, folderId, DRIVE_FILES.STATE) as any;
          setUserAccessStatus(prev => ({ ...prev, [email]: !stateData || stateData.adminAccessAllowed !== false }));
        } catch {}
      } catch (e: any) {
        const msg = String(e?.message || '');
        const isApiError = msg.includes('TOKEN_EXPIRED') || msg.includes('PERMISSION_DENIED') || msg.includes('DRIVE_ERROR');
        setUserDriveStatus(prev => ({ ...prev, [email]: isApiError ? 'error' : 'not_found' }));
      }
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
  useEffect(() => { rebalExtraQtyRef.current = rebalExtraQty; }, [rebalExtraQty]);

  const { notify, notificationLog, setNotificationLog, clearNotificationLog, unreadCount, markAsRead, confirmState, confirm, resolveConfirm } = useToast();
  const { isMarketOpen, holidays: marketHolidays, loaded: calendarLoaded } = useMarketCalendar();

  // 글로벌(overseas/crypto/현금성): 07:30 이전 전날 날짜로 기록 / 이후 오늘 날짜로 기록
  // KR(국내시장 계좌): 09:00(개장)~21:00 오늘 날짜로 기록 / 그 외 null(21:00 당일 확정·동결)
  const [effectiveDateKey, setEffectiveDateKey] = useState(() => getEffectiveDate());
  const [krEffectiveDateKey, setKrEffectiveDateKey] = useState(() => getEffectiveDateKR());
  useEffect(() => {
    let timer;
    const arm = () => {
      timer = setTimeout(() => {
        setEffectiveDateKey(getEffectiveDate());
        setKrEffectiveDateKey(getEffectiveDateKR());
        arm(); // 07:30 → 09:00 → 21:00 매 경계 재무장 — 자정 통과·장시간 켜둔 앱 커버
      }, getMsUntilNextBoundary());
    };
    arm();
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
  const autoFundHistoryRef = useRef<string | null>(null); // 자동 기록한 마지막 navDate (포트폴리오별 추적)
  const saveStateRef = useRef<Record<string, any>>({}); // 항상 최신 state 스냅샷 유지
  // applyStateData/applyStockData/applyBackupData 콜백 ref (useDriveSync → useMarketData 순환 의존 해소)
  const applyStateDataRef = useRef<Function | null>(null);
  const applyStockDataRef = useRef<Function | null>(null);
  const applyBackupDataRef = useRef<Function | null>(null);
  const refreshPricesRef = useRef<Function | null>(null);
  // 계좌별 차트 상태 독립 관리
  const currentChartStateRef = useRef<any>({ showKospi: true, showSp500: false, showNasdaq: false, showIndicatorsInChart: { us10y: false, kr10y: false, goldIntl: false, goldKr: false, usdkrw: false, dxy: false, fedRate: false, vix: false, btc: false, eth: false }, goldIndicators: { goldIntl: true, goldKr: true, usdkrw: false, dxy: false }, goldIndicatorColors: { goldIntl: '#ffd60a', goldKr: '#ff9f0a', usdkrw: '#0a84ff', dxy: '#5ac8fa' }, compStocks: [], chartPeriod: '3m', dateRange: { start: '', end: '' }, appliedRange: { start: '', end: '' }, backtestColor: '#f97316', showBacktest: false });
  const accountChartStatesRef = useRef<Record<string, any>>({});
  const accountRebalExtraQtyRef = useRef<Record<string, Record<string, number>>>({}); // 계좌별 리밸런싱 '추가' 입력값 보존
  const rebalExtraQtyRef = useRef<Record<string, number>>({}); // 최신 rebalExtraQty 스냅샷 (탭 전환 저장용)
  const intDashCompStocksRef = useRef<any[]>(defaultCompStocks);
  const prevActivePortfolioIdRef = useRef<string | null>(null);
  // 직전 렌더의 통합 대시보드 표시 여부 — 계좌 전환 시 "대시보드에서 떠나는지" 판별용
  // (앱은 항상 대시보드로 부팅하므로 초기값 true). 배치 업데이트로 showIntegratedDashboard가
  // 이미 false가 된 시점에 [activePortfolioId] 이펙트가 실행되므로, 현재값 대신 이 ref로 직전 상태를 본다.
  const prevShowIntegratedDashboardRef = useRef<boolean>(true);
  const chartPrefsUpdatedAtRef = useRef<number>(0);

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
    isAvgPriceMode, setIsAvgPriceMode,
    showCalcVerify, setShowCalcVerify,
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
  const prevChartPeriodRef = useRef<string>(chartPeriod);
  const prevIntChartPeriodRef = useRef<string>(intChartPeriod);
  // 조회기간 자동 재계산 가드: chartPeriod 실제 변경 vs unifiedDates만 변경(계좌 전환·백그라운드 로드) 구분용
  const prevChartPeriodForRangeRef = useRef<string | null>(null);
  const prevIntChartPeriodForRangeRef = useRef<string | null>(null);

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
    initSession,
  } = useDriveSync({
    authUser,
    applyStateData: (...args) => applyStateDataRef.current?.(...args),
    applyStockData: (...args) => applyStockDataRef.current?.(...args),
    applyBackupData: (...args) => applyBackupDataRef.current?.(...args),
    accountChartStatesRef, saveStateRef, adminViewingAsRef, adminOwnDriveTokenRef, notify, confirm,
    onForceLogout: () => {
      // 새 탭 관리자 접속 중에는 reload가 ?adminView를 유지해 재부팅 루프가 되므로 탭을 닫는다.
      if (ADMIN_VIEW_EMAIL) { closeAdminViewTab(); return; }
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
    activePortfolio, patchActivePortfolio,
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
    markedRebalRows, toggleMarkedRebalRow, resetAllMarkedRebalRows,
    markedPortfolioRows, toggleMarkedPortfolioRow, resetAllMarkedPortfolioRows,
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
    togglePortfolioTest,
    resetAllPortfolioColors,
    updateSettingsForType,
    updatePortfolioMemo,
    movePortfolio,
    handleUpdate,
    handleDeleteStock,
    handleAddStock,
    handleAddFund,
    handleAddSavings,
    updateSavingsField,
    addSavingsDeposit,
    removeSavingsDeposit,
    updateDividendHistory,
    updatePortfolioDividendHistory,
    updatePortfolioActualDividend,
    updatePortfolioActualDividendUsd,
    updatePortfolioActualDividendQty,
    updatePortfolioDividendTaxRate,
    updatePortfolioDividendSeparateTax,
    updatePortfolioDividendTaxAmount,
    updatePortfolioActualAfterTaxUsd,
    updatePortfolioActualAfterTaxKrw,
    addPortfolioExtraRow,
    updatePortfolioExtraRowCode,
    deletePortfolioExtraRow,
    updatePortfolioExtraRowMonth,
    updateTaxBaseEvents,
    updateTaxBasePurchases,
    updateTaxBaseSales,
    updateTaxBaseExPrice,
    updateTaxBaseAvgPrice,
    updateInvestmentNotes,
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
      const normalizedPortfolios = stateData.portfolios.map(p => ensurePortfolioVerificationFields({
        ...p,
        startDate: p.portfolioStartDate || p.startDate || '',
        portfolioStartDate: p.portfolioStartDate || p.startDate || '',
        history: dedupeHistoryByDate(p.history || []),
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
        history: dedupeHistoryByDate(stateData.history || []), depositHistory: stateData.depositHistory || [],
        depositHistory2: stateData.depositHistory2 || [],
        settings: stateData.settings || { mode: 'rebalance', amount: 1000000 },
      };
      setPortfolios([migrated]);
      setActivePortfolioId(newId);
      notify('계좌 1개 복구 완료 — 활성화 중', 'info');
    }
    setCustomLinks(stateData.customLinks || UI_CONFIG.DEFAULT_LINKS);
    if (stateData.overseasLinks) setOverseasLinks(stateData.overseasLinks);
    if (stateData.adminAccessAllowed !== undefined) setAdminAccessAllowed(stateData.adminAccessAllowed);
    if (stateData.chartPrefs) {
      if (stateData.chartPrefs.showKospi !== undefined) setShowKospi(stateData.chartPrefs.showKospi);
      if (stateData.chartPrefs.showSp500 !== undefined) setShowSp500(stateData.chartPrefs.showSp500);
      if (stateData.chartPrefs.showNasdaq !== undefined) setShowNasdaq(stateData.chartPrefs.showNasdaq);
      if (stateData.chartPrefs.isZeroBaseMode !== undefined) setIsZeroBaseMode(stateData.chartPrefs.isZeroBaseMode);
      if (stateData.chartPrefs.showTotalEval !== undefined) setShowTotalEval(stateData.chartPrefs.showTotalEval);
      if (stateData.chartPrefs.showReturnRate !== undefined) setShowReturnRate(stateData.chartPrefs.showReturnRate);
      if (stateData.chartPrefs.accountChartStates) {
        accountChartStatesRef.current = stateData.chartPrefs.accountChartStates;
        // 앱 시작 시 활성 계좌의 차트 기간 복원
        // (계좌 전환 이펙트는 prevId===null 조건으로 최초 로드 시 실행 안 됨)
        const restoredActiveId = stateData.activePortfolioId || stateData.portfolios?.[0]?.id;
        const activeSaved = restoredActiveId ? stateData.chartPrefs.accountChartStates[restoredActiveId] : null;
        if (activeSaved?.chartPeriod) setChartPeriod(activeSaved.chartPeriod);
        if (activeSaved?.dateRange) setDateRange(activeSaved.dateRange);
        if (activeSaved?.appliedRange) setAppliedRange(activeSaved.appliedRange);
      }
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
      if (stateData.chartPrefs.rebalanceSortConfigMap) setRebalanceSortConfigMap(stateData.chartPrefs.rebalanceSortConfigMap);
      // 통합 대시보드 비교종목 복원 — 앱은 항상 통합 대시보드에서 시작하므로 compStocks도 함께 설정
      if (stateData.chartPrefs.intDashCompStocks) {
        const restoredComps = stateData.chartPrefs.intDashCompStocks.map((s: any) => ({ ...s, loading: false }));
        intDashCompStocksRef.current = restoredComps;
        setCompStocks(restoredComps);
      }
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
      const normalizedPortfolios = stateData.portfolios.map(p => ensurePortfolioVerificationFields({
        ...p,
        startDate: p.portfolioStartDate || p.startDate || '',
        portfolioStartDate: p.portfolioStartDate || p.startDate || '',
        history: dedupeHistoryByDate(p.history || []),
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
      if (stateData.chartPrefs.rebalanceSortConfigMap) setRebalanceSortConfigMap(stateData.chartPrefs.rebalanceSortConfigMap);
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

  // 차트 설정 변경 시 chartPrefsUpdatedAt 갱신 — Drive STATE 저장 트리거용
  useEffect(() => {
    if (isInitialLoad.current) return;
    chartPrefsUpdatedAtRef.current = Date.now();
  }, [chartPeriod, dateRange, appliedRange, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, intSec, showKospi, showSp500, showNasdaq, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, showMarketPanel, hideAmounts, isZeroBaseMode, showTotalEval, showReturnRate, sectionCollapsedMap, rebalanceSortConfigMap, compStocks]);

  // 계좌 전환 시 차트 상태 저장 → 복원 (계좌별 완전 독립 — 조회기간 포함)
  useEffect(() => {
    const prevId = prevActivePortfolioIdRef.current;
    if (prevId !== null && prevId !== activePortfolioId) {
      // 리밸런싱 '추가' 입력값을 계좌별로 보존 — 이전 계좌 저장 후 새 계좌 복원
      accountRebalExtraQtyRef.current[prevId] = { ...rebalExtraQtyRef.current };
      setRebalExtraQty(accountRebalExtraQtyRef.current[activePortfolioId] || {});
      // 이전 계좌 상태 저장 — 직전 뷰가 통합 대시보드였다면 currentChartStateRef.compStocks 는
      // 대시보드 비교종목이므로, 떠나는 개별 계좌(prevId)의 저장된 비교종목을 대시보드 값으로
      // 덮어쓰지 않도록 보존(메인 저장 가드와 동일 취지). 대시보드가 아니었으면 그대로 저장.
      const prevStateToSave = { ...currentChartStateRef.current };
      if (prevShowIntegratedDashboardRef.current) {
        prevStateToSave.compStocks = accountChartStatesRef.current[prevId]?.compStocks ?? defaultCompStocks;
      }
      accountChartStatesRef.current[prevId] = prevStateToSave;
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

  // 통합 대시보드 ↔ 개별 계좌 전환 시 비교종목 상태 분리
  useEffect(() => {
    if (showIntegratedDashboard) {
      setCompStocks(intDashCompStocksRef.current.map((s) => ({ ...s, loading: false })));
    } else {
      intDashCompStocksRef.current = currentChartStateRef.current.compStocks || defaultCompStocks;
      if (activePortfolioId) {
        const saved = accountChartStatesRef.current[activePortfolioId];
        if (saved?.compStocks) {
          setCompStocks(saved.compStocks.map((s) => ({ ...s, loading: false })));
        }
      }
    }
    // 다음 계좌 전환 이펙트가 "직전 뷰가 대시보드였는지" 판별할 수 있도록 기록
    prevShowIntegratedDashboardRef.current = showIntegratedDashboard;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showIntegratedDashboard]);

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
    if (!appliedRange.start && !appliedRange.end) return unifiedDates;
    return unifiedDates.filter(d =>
      (!appliedRange.start || d >= appliedRange.start) &&
      (!appliedRange.end   || d <= appliedRange.end)
    );
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

      // base는 각 지수의 첫 '실데이터'(currK/S/N) 시점으로 잡는다(지표·비교종목과 동일 패턴).
      // i===0 무조건 기준으로 잡으면, KOSPI(네이버)가 S&P/Nasdaq(야후)보다 늦게 시작해 unifiedDates[0]에
      // 실데이터가 없을 때 baseK가 합성 폴백(2600)이 되어 KOSPI 라인이 조회시작에서 −64%대로 찍힌다.
      if (baseK == null && currK != null) baseK = currK;
      if (baseS == null && currS != null) baseS = currS;
      if (baseN == null && currN != null) baseN = currN;
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

  // 개별 계좌 차트도 추이 표와 동일하게 '수량 × 종가'(확정 종가 기반)를 권위값으로 사용.
  // (해외·현금성은 각자 기존 경로 → 빈 Map이면 아래 exactHist 분기가 저장값으로 폴백)
  const activeCloseEvalByDate = useMemo(() => {
    if (['overseas', 'simple', 'matong'].includes(activePortfolioAccountType)) return new Map();
    const edk = isKrCutoffAccount(activePortfolioAccountType) ? krEffectiveDateKey : effectiveDateKey;
    return buildCloseEvalSeries(activePortfolio, history.map(h => h?.date), activePortfolioAccountType, stockHistoryMap, indicatorHistoryMap, edk);
  }, [activePortfolio, history, activePortfolioAccountType, stockHistoryMap, indicatorHistoryMap, krEffectiveDateKey, effectiveDateKey]);

  const finalChartData = useMemo(() => {
    const localSortedHist = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
    const sortedDeposits = [...depositHistory].sort((a, b) => a.date < b.date ? -1 : 1);
    const sortedWithdrawals = [...depositHistory2].sort((a, b) => a.date < b.date ? -1 : 1);
    const isOverseasChart = activePortfolioAccountType === 'overseas';
    const histByDate = new Map(localSortedHist.map(h => [h.date, h]));
    const reversedHist = [...localSortedHist].reverse();
    const findNearestPrincipal = (beforeDate) =>
      reversedHist.find(h => h.date < beforeDate && cleanNum(h.principal) > 0)?.principal;
    // portfolioStartDate 기준 누적 입출금 — 암묵적 앵커 계산용 (루프 밖에서 1회만 산출)
    let startCumDep = 0;
    for (const d of sortedDeposits) {
      if (d.date > portfolioStartDate) break;
      if (!d.noPrincipal) startCumDep += cleanNum(d.amount);
    }
    for (const w of sortedWithdrawals) {
      if (w.date > portfolioStartDate) break;
      if (!w.noPrincipal) startCumDep -= w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount);
    }
    // 이중 계상 감지용: portfolioStartDate 당일 입금 합계(에폭 시작 기준점)와
    // portfolioStartDate 이후 전체 입출금 합계(principal 필드가 post-start 입금을 포함하는지 역산)
    let historyEpochStart = 0;
    let finalPostStartDep = 0;
    if (portfolioStartDate) {
      for (const d of sortedDeposits) {
        if (d.date < portfolioStartDate) continue;
        if (d.date > portfolioStartDate) break;
        if (!d.noPrincipal) historyEpochStart += cleanNum(d.amount);
      }
      for (const w of sortedWithdrawals) {
        if (w.date < portfolioStartDate) continue;
        if (w.date > portfolioStartDate) break;
        if (!w.noPrincipal) historyEpochStart -= w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount);
      }
      for (const d of sortedDeposits) {
        if (d.date <= portfolioStartDate) continue;
        if (!d.noPrincipal) finalPostStartDep += cleanNum(d.amount);
      }
      for (const w of sortedWithdrawals) {
        if (w.date <= portfolioStartDate) continue;
        if (!w.noPrincipal) finalPostStartDep -= w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount);
      }
    }
    const rawData = filteredDates.map(date => {
      let trueEvalAtDate = 0, retRate = 0;
      // hasReliableEval: trueEvalAtDate가 실제 주가 데이터(또는 사용자 기록)에서 나왔는지 여부.
      // false = hIdx.evalAmount 폴백만 사용 → 해당 날짜는 principalReturnRate를 null로 반환해 차트에서 제외.
      let hasReliableEval = false;
      // 수동 anchor + delta: 사용자가 수동 설정한 원금이 다음 anchor 전까지 입출금 변동분만 반영해 전파.
      const effective = computeEffectivePrincipal(date, localSortedHist, sortedDeposits, sortedWithdrawals, isOverseasChart);
      if (date >= portfolioStartDate) {
        const exactHist = histByDate.get(date);
        if (isOverseasChart) {
          // 해외계좌: USD 주가 이력으로만 계산 — KRW evalAmount/fxRate 완전 미사용
          let usdEval = 0, hasData = false;
          portfolio.forEach(item => {
            if (item.type === 'deposit') { usdEval += cleanNum(item.depositAmount); hasData = true; }
            else if (item.code && stockHistoryMap[item.code]) {
              const p = getClosestValue(stockHistoryMap[item.code], date);
              if (p) { usdEval += p * item.quantity; hasData = true; }
            }
          });
          trueEvalAtDate = hasData ? usdEval : 0;
          hasReliableEval = hasData;
          const usdPrin = cleanNum(principal);
          if (hasData && usdPrin > 0) retRate = (usdEval - usdPrin) / usdPrin * 100;
        } else if (exactHist) {
          // 종가 확정 기반 재계산값(수량×종가)을 우선 사용, 없으면 저장된 라이브 값 폴백 (추이 표와 동일 소스)
          const cb = activeCloseEvalByDate.get(date);
          const evalForDate = cb != null ? cb : exactHist.evalAmount;
          trueEvalAtDate = evalForDate;
          hasReliableEval = true;
          const storedPrin = cleanNum(exactHist.principal);
          const fallbackPrin = storedPrin > 0 ? storedPrin : (cleanNum(findNearestPrincipal(date)) || cleanNum(principal));
          const histPrin = effective.value != null ? effective.value : fallbackPrin;
          retRate = histPrin > 0 ? ((evalForDate - histPrin) / histPrin * 100) : 0;
        } else {
          let hasTrueData = false;
          const hIdx = reversedHist.find(h => h.date <= date) || localSortedHist[0];
          const baseEval = hIdx ? hIdx.evalAmount : totals.totalEval;
          const fallbackPrin = cleanNum(hIdx?.principal) > 0 ? cleanNum(hIdx.principal) : (cleanNum(findNearestPrincipal(date)) || cleanNum(principal));
          const basePrin = effective.value != null ? effective.value : fallbackPrin;
          portfolio.forEach(item => {
            if (item.type === 'deposit') { trueEvalAtDate += cleanNum(item.depositAmount); }
            else if (item.type === 'savings') { trueEvalAtDate += savingsEval(item, date); }
            else if (item.code && stockHistoryMap[item.code]) {
              const priceAtDate = getClosestValue(stockHistoryMap[item.code], date);
              if (priceAtDate) { trueEvalAtDate += priceAtDate * item.quantity; hasTrueData = true; }
              else { trueEvalAtDate += cleanNum(item.evalAmount) * (baseEval / (totals.totalEval || 1)); }
            } else { trueEvalAtDate += cleanNum(item.evalAmount) * (baseEval / (totals.totalEval || 1)); }
          });
          if (!hasTrueData && hIdx) trueEvalAtDate = hIdx.evalAmount;
          // hIdx.date <= date: 이 날짜 이전에 기록된 이력(역방향 보간) → 신뢰 가능.
          // hasTrueData 없어도 확정 이력이 있는 계좌(펀드·simple 등)에서 빈 차트 방지.
          hasReliableEval = hasTrueData || (!!hIdx && hIdx.date <= date);
          retRate = basePrin > 0 ? ((trueEvalAtDate - basePrin) / basePrin * 100) : 0;
        }
      }
      let principalAmount = 0;
      if (isOverseasChart) {
        // 해외계좌: USD 기준 — fxRate 미적용
        for (const d of sortedDeposits) { if (d.date > date) break; if (!d.noPrincipal) principalAmount += cleanNum(d.amount); }
        for (const w of sortedWithdrawals) { if (w.date > date) break; if (!w.noPrincipal) principalAmount -= w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount); }
        if (principalAmount === 0 && date >= portfolioStartDate && cleanNum(principal) > 0) principalAmount = cleanNum(principal);
        // 해외: principal 필드(USD 수동 입력) 하한 — depositHistory 일부만 있을 때 과대 수익률 방지
        if (principalAmount > 0 && cleanNum(principal) > principalAmount) principalAmount = cleanNum(principal);
      } else if (effective.value != null && effective.value > 0) {
        // 수동 anchor + delta: principalManual 항목 기준
        principalAmount = effective.value;
      } else {
        const initPrin = cleanNum(principal);
        if (initPrin > 0 && date >= portfolioStartDate) {
          // 암묵적 앵커 + 이중 계상 방지:
          // principal 필드가 post-start 입금까지 포함한 누적 총액일 때,
          // (cumDep - startCumDep)을 그대로 더하면 해당 입금이 두 번 계산됨.
          // epochBase = max(historyEpochStart, initPrin - finalPostStartDep) 으로
          // "시작일 시점의 순수 원금"을 역산해 post-start delta와 합산.
          let cumDep = 0;
          for (const d of sortedDeposits) { if (d.date > date) break; if (!d.noPrincipal) cumDep += cleanNum(d.amount); }
          for (const w of sortedWithdrawals) { if (w.date > date) break; if (!w.noPrincipal) cumDep -= w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount); }
          const cappedInitPrin = Math.max(0, initPrin - finalPostStartDep);
          const epochBase = Math.max(historyEpochStart, cappedInitPrin);
          principalAmount = epochBase + (cumDep - startCumDep);
          if (principalAmount <= 0) principalAmount = initPrin;
        } else {
          // principal 미설정: 입출금 합산, 없으면 totals.totalInvest 폴백
          for (const d of sortedDeposits) { if (d.date > date) break; if (!d.noPrincipal) principalAmount += cleanNum(d.amount); }
          for (const w of sortedWithdrawals) { if (w.date > date) break; if (!w.noPrincipal) principalAmount -= (w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount)); }
          if (principalAmount === 0 && date >= portfolioStartDate) {
            const fallback = totals.totalInvest > 0 ? totals.totalInvest : cleanNum(principal);
            if (fallback > 0) principalAmount = fallback;
          }
        }
      }
      // 나의 수익률: 실제 주가/이력 데이터가 있는 날(hasReliableEval)만 산출.
      // 주가 데이터 없이 hIdx.evalAmount 폴백만 쓰는 날은 null → 차트에서 해당 구간 제외(0% 평탄선 방지).
      const principalReturnRate = (hasReliableEval && principalAmount > 0) ? (trueEvalAtDate - principalAmount) / principalAmount * 100 : null;
      return { date, ...(indexDataMap[date] || {}), evalAmount: trueEvalAtDate, returnRate: retRate, principalAmount, principalReturnRate };
    });
    const zeroBasedData = (!isZeroBaseMode || rawData.length === 0) ? rawData : (() => {
      const baseItem = rawData.find(item => item.evalAmount > 0) || rawData[0];
      // 지수·비교종목·시장지표 base는 각 시리즈의 조회기간 내 첫 non-null 시점(=조회시작)을 사용한다.
      // '나의 수익률'(evalAmount)만 baseItem(포트폴리오 최초 평가일)을 0% 기준으로 쓰고, 시세 시리즈에
      // baseItem을 쓰면 안 된다 — 포트폴리오 최초 평가일이 조회시작보다 늦을 때 그 늦은 날의 지수값이
      // 0% 기준이 되어 조회시작 지점이 큰 음수(예: KOSPI −70%)로 찍히던 버그(정보패널 라벨·구간
      // 수익률은 조회시작 시점을 base로 쓰므로 라인과 불일치). 또 baseItem 시점에 특정 시리즈 값이
      // 0/null이면(상장 이전·캐시 미수집) 전 구간 rate가 null이 되어 라인이 통째로 사라진다.
      const firstBase = (pk) => rawData.find(d => d[pk] != null && d[pk] > 0)?.[pk] || 0;
      const kospiBase = firstBase('kospiPoint');
      const sp500Base = firstBase('sp500Point');
      const nasdaqBase = firstBase('nasdaqPoint');
      const indBases = {};
      INDICATOR_CHART_KEYS.forEach(k => { indBases[k] = firstBase(`${k}Point`); });
      const compBases = compStocks.map((_, ci) => firstBase(`comp${ci + 1}Point`));
      return rawData.map(item => {
        const indRates = {};
        INDICATOR_CHART_KEYS.forEach(k => {
          const basePoint = indBases[k];
          const curPoint = item[`${k}Point`];
          if (basePoint > 0 && curPoint != null) {
            indRates[`${k}Rate`] = ((curPoint / basePoint) - 1) * 100;
          }
        });
        return {
          ...item,
          returnRate: (baseItem.evalAmount > 0 && item.evalAmount > 0) ? ((item.evalAmount / baseItem.evalAmount) - 1) * 100 : item.returnRate,
          principalReturnRate: (baseItem.evalAmount > 0 && item.principalReturnRate != null) ? ((item.evalAmount / baseItem.evalAmount) - 1) * 100 : item.principalReturnRate,
          kospiRate: kospiBase > 0 ? ((item.kospiPoint / kospiBase) - 1) * 100 : 0,
          sp500Rate: sp500Base > 0 ? ((item.sp500Point / sp500Base) - 1) * 100 : 0,
          nasdaqRate: nasdaqBase > 0 ? ((item.nasdaqPoint / nasdaqBase) - 1) * 100 : 0,
          ...Object.fromEntries(compStocks.map((_, ci) => {
            const pk = `comp${ci + 1}Point`;
            const rk = `comp${ci + 1}Rate`;
            const cBase = compBases[ci];
            return [rk, (cBase > 0 && item[pk] != null) ? ((item[pk] / cBase) - 1) * 100 : null];
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
  }, [filteredDates, indexDataMap, stockHistoryMap, portfolio, history, totals.totalEval, totals.totalInvest, principal, portfolioStartDate, isZeroBaseMode, indicatorScales, compStocks, depositHistory, depositHistory2, activePortfolioAccountType, avgExchangeRate, marketIndicators, activeCloseEvalByDate]);

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
    compStocks, stockHistoryMap, indicatorHistoryMap,
  });


  useHistoryBackfill({
    stockHistoryMap, indicatorHistoryMap, marketIndicators,
    portfolioSummaries, portfolios, setPortfolios,
    activePortfolioId, setHistory, effectiveDateKey, krEffectiveDateKey,
    marketHolidays,
  });

  // 앱 실행 시 자산검증 불일치 라이브 레코드를 '수량×종가로 자동확정' (useHistoryBackfill 뒤에서 합성)
  useAutoConfirmHistory({
    stockHistoryMap, indicatorHistoryMap, marketIndicators,
    portfolios, setPortfolios, effectiveDateKey, krEffectiveDateKey,
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
    handleForceRefetchComp,
    autoRefreshStockPrices,
    refreshPrices,
    refetchStockHistory,
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
    marketHolidays,
  });
  refreshPricesRef.current = refreshPrices;

  // 계좌 탭 전환 시 현재가 자동 갱신, 자동 기록 ref 초기화
  useEffect(() => {
    autoFundHistoryRef.current = null;
    if (!didSwitchPortfolioRef.current) { didSwitchPortfolioRef.current = true; return; }
    refreshPrices();
  }, [activePortfolioId]);



  const handleSort = (key) => {
    if (key === null) {
      setSortConfig({ key: null, direction: 1 });
      setPortfolio(prev => {
        const stocks = [...prev.filter(p => p.type === 'stock')];
        const rest = prev.filter(p => p.type !== 'stock');
        stocks.sort((a, b) => {
          const ia = CATEGORY_DISPLAY_ORDER.indexOf(a.category);
          const ib = CATEGORY_DISPLAY_ORDER.indexOf(b.category);
          const ra = ia === -1 ? CATEGORY_DISPLAY_ORDER.length : ia;
          const rb = ib === -1 ? CATEGORY_DISPLAY_ORDER.length : ib;
          return ra - rb;
        });
        return [...stocks, ...rest];
      });
      return;
    }
    let dir = sortConfig.key === key ? -sortConfig.direction : 1;
    setSortConfig({ key, direction: dir });
    setPortfolio(prev => {
      const stocks = [...prev.filter(p => p.type === 'stock')];
      const funds = prev.filter(p => p.type === 'fund');
      const savings = prev.filter(p => p.type === 'savings');
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
      return [...stocks, ...funds, ...savings, ...deposits];
    });
  };

  const handleRebalanceSort = (key, forcedDir) => setRebalanceSortConfigMap(prev => {
    const cur = prev[activePortfolioId] ?? { key: null, direction: 1 };
    const direction = forcedDir != null ? forcedDir : (cur.key === key ? -cur.direction : 1);
    return { ...prev, [activePortfolioId]: { key, direction } };
  });
  const handleDepositSort = (key) => setDepositSortConfig(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));
  const handleDepositSort2 = (key) => setDepositSortConfig2(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));

  const handleSave = () => {
    const currentPortfolios = buildPortfoliosState();
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds, rebalanceSortConfigMap }, intHistory, chartPrefsUpdatedAt: chartPrefsUpdatedAtRef.current };
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
      await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, { youtubeUrl: url, notebookLinks, reportLinks });
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

  // 학습자료 HTML 파일을 관리자 Drive에 업로드(공개 권한 부여) → fileId 반환. AdminPage가 notebookLinks에 등록.
  const handleUploadStudyMaterial = async (file: File): Promise<string> => {
    const token = driveTokenRef.current;
    if (!token) { notify('Drive 인증 필요', 'error'); throw new Error('no-token'); }
    const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
    const htmlContent = await file.text();
    const safeName = `study_${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
    return await uploadHtmlStudyMaterial(token, folderId, safeName, htmlContent);
  };

  // 학습자료 링크 삭제 시 Drive 원본 HTML 파일도 정리 (fileId 보유 항목만)
  const handleDeleteStudyMaterialFile = async (fileId: string): Promise<void> => {
    const token = driveTokenRef.current;
    if (!token || !fileId) return;
    await deleteDriveFileById(token, fileId);
  };

  const handleSetNotebookLinks = async (links: {title: string, url?: string, fileId?: string, createdAt: number}[]) => {
    // 관리자 Drive에 직접 저장 (정본) — Apps Script 상태와 무관하게 즉시 반영
    try {
      const token = driveTokenRef.current;
      if (!token) { notify('Drive 인증 필요', 'error'); return; }
      const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
      await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, { youtubeUrl, notebookLinks: links, reportLinks });
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

  // 시장동향 리포트 링크 — 학습자료와 동일 구조(외부 링크 + HTML 파일). 별도 settings 키 reportLinks.
  const handleSetReportLinks = async (links: {title: string, url?: string, fileId?: string, createdAt: number}[]) => {
    // 관리자 Drive에 직접 저장 (정본) — Apps Script 상태와 무관하게 즉시 반영
    try {
      const token = driveTokenRef.current;
      if (!token) { notify('Drive 인증 필요', 'error'); return; }
      const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
      await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, { youtubeUrl, notebookLinks, reportLinks: links });
      setReportLinks(links);
      notify('시장동향 리포트 링크가 저장됐습니다.', 'success');
    } catch {
      notify('링크 저장 실패 (Drive 오류)', 'error');
      return;
    }
    // Apps Script 배포 — 일반 사용자에게 전달 (비차단, 실패 무시)
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'setSettings', key: 'reportLinks', value: JSON.stringify(links) }),
    }).catch(() => {});
  };

  // 관리자가 사용자의 목표 비중을 변경했을 때 호출 — 디바운스 후 사용자 다음 로그인용 알림 1건 발송
  const notifyUserOfAdminTargetChange = () => {
    const targetEmail = adminViewingAsRef.current;
    if (!targetEmail) return;
    if (adminTargetNotifTimerRef.current) clearTimeout(adminTargetNotifTimerRef.current);
    adminTargetNotifTimerRef.current = setTimeout(() => {
      const finalEmail = adminViewingAsRef.current;
      if (!finalEmail) return;
      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'sendNotification',
          targetEmail: finalEmail,
          message: '목표 비중이 수정되었습니다.',
          type: 'warning',
        }),
      }).catch(() => {});
      adminTargetNotifTimerRef.current = null;
    }, 5000);
  };

  const handleDriveSave = () => {
    const currentPortfolios = buildPortfoliosState();
    // portfolioUpdatedAt이 없으면 saveAllToDrive의 guard(0 > 0)가 항상 false → STATE 저장 안됨
    // 수동 저장은 항상 강제 저장되어야 하므로 새 타임스탬프 생성 후 guard 초기화
    const newUpdatedAt = Date.now();
    portfolioUpdatedAtRef.current = newUpdatedAt;
    lastDriveSavedPortfolioUpdatedAtRef.current = 0;
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds, rebalanceSortConfigMap }, intHistory, portfolioUpdatedAt: newUpdatedAt, chartPrefsUpdatedAt: chartPrefsUpdatedAtRef.current };
    if (driveTokenRef.current) {
      saveAllToDrive(state, 'manual'); // 수동 저장 → 타임스탬프 백업 포함
    } else {
      notify('☁️ Drive 미연결 — 먼저 Drive를 연결해 주세요', 'warning');
    }
  };

  const handleDownloadStateFile = () => {
    const currentPortfolios = buildPortfoliosState();
    const newUpdatedAt = Date.now();
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds, rebalanceSortConfigMap }, intHistory, portfolioUpdatedAt: newUpdatedAt, chartPrefsUpdatedAt: chartPrefsUpdatedAtRef.current };
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
    // 정식 전체 state 스냅샷(saveStateRef.current) 기반 저장 — 부분 state를 손으로 재구성하면
    // chartPrefs.intDashCompStocks(통합 대시보드 비교종목)·seenAdminNotifIds 등이 누락되어
    // "앱 닫기"로 종료할 때마다 비교종목이 초기화되던 버그 방지 (메인 저장과 동일 필드 보장)
    const state = { ...saveStateRef.current, portfolios: currentPortfolios, portfolioUpdatedAt: newUpdatedAt };
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
    if (!dateRange.start && !dateRange.end) return;
    setAppliedRange({ start: dateRange.start, end: dateRange.end });
    setChartPeriod('custom');
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
          if (Array.isArray(driveSettings.reportLinks)) setReportLinks(driveSettings.reportLinks);
          // 실제 데이터가 있을 때만 "찾음"으로 처리 — 빈 배열만 있으면 Apps Script 폴백 허용
          driveSettingsFound = !!(driveSettings.youtubeUrl || driveSettings.notebookLinks?.length > 0 || driveSettings.reportLinks?.length > 0);
        }
      } catch {}
      if (!isAdmin || !driveSettingsFound) {
        // 일반 사용자는 항상, 관리자는 Drive 파일 없을 때만 (최초 마이그레이션)
        try {
          const settingsRes = await fetch(`${APPS_SCRIPT_URL}?action=getSettings&cacheBust=${Date.now()}`);
          if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            const yu = settingsData.youtubeUrl || '';
            const rawNl = settingsData.notebookLinks;
            const nl: any[] | null = rawNl ? (Array.isArray(rawNl) ? rawNl : (() => { try { return JSON.parse(rawNl); } catch { return null; } })()) : null;
            const rawRl = settingsData.reportLinks;
            const rl: any[] | null = rawRl ? (Array.isArray(rawRl) ? rawRl : (() => { try { return JSON.parse(rawRl); } catch { return null; } })()) : null;
            setYoutubeUrl(yu);
            if (Array.isArray(nl)) setNotebookLinks(nl);
            if (Array.isArray(rl)) setReportLinks(rl);
            // 관리자: Drive에 저장 (이후 Drive가 정본으로 동작)
            // 일반 사용자: Drive에 캐시 저장
            try {
              const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
              await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, { youtubeUrl: yu, notebookLinks: Array.isArray(nl) ? nl : [], reportLinks: Array.isArray(rl) ? rl : [] });
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
              notifTargetsUser(n.targetEmail, authUser.email, userFeatures.notebookEnabled, userFeatures.reportEnabled)
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
        if (Array.isArray(settings?.reportLinks) && settings.reportLinks.length > 0) {
          setReportLinks(settings.reportLinks); found = true;
        }
      } catch {}
      if (!found) {
        try {
          const res = await fetch(`${APPS_SCRIPT_URL}?action=getSettings&cacheBust=${Date.now()}`);
          if (res.ok) {
            const d = await res.json();
            if (d.youtubeUrl) setYoutubeUrl(d.youtubeUrl);
            if (d.notebookLinks) {
              if (Array.isArray(d.notebookLinks)) setNotebookLinks(d.notebookLinks);
              else { try { setNotebookLinks(JSON.parse(d.notebookLinks)); } catch {} }
            }
            if (d.reportLinks) {
              if (Array.isArray(d.reportLinks)) setReportLinks(d.reportLinks);
              else { try { setReportLinks(JSON.parse(d.reportLinks)); } catch {} }
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
      // 백그라운드 탭에서는 폴링 스킵 — 불필요한 외부 API 호출 방지
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=getNotifications&cacheBust=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        const all: AdminNotification[] = data.notifications || [];
        const myAll = all.filter(n =>
          notifTargetsUser(n.targetEmail, authUser.email, userFeatures.notebookEnabled, userFeatures.reportEnabled)
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
  }, [authUser, userFeatures.notebookEnabled, userFeatures.reportEnabled]);

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
        portfolio: (p.portfolio || []).map(item => ({ id: item.id, type: item.type, code: item.code, name: item.name, quantity: item.quantity, investAmount: item.investAmount, purchasePrice: item.purchasePrice, depositAmount: item.depositAmount, targetRatio: item.targetRatio, targetRatioVar: item.targetRatioVar, targetRatioOverride: item.targetRatioOverride, targetRatioVarOverride: item.targetRatioVarOverride, ...(item.type === 'savings' ? { annualRate: item.annualRate, startDate: item.startDate, endDate: item.endDate, assetClass: item.assetClass, deposits: (item.deposits || []).map(d => `${d.date}:${d.amount}`).join(',') } : {}) })),
        principal: p.principal, avgExchangeRate: p.avgExchangeRate,
        depositHistory: p.depositHistory, depositHistory2: p.depositHistory2,
        settings: p.settings,
        actualDividend: p.actualDividend,
        dividendHistoryUpdatedAt: p.dividendHistoryUpdatedAt || 0,
        extraDividendRows: p.extraDividendRows,
        actualDividendUsd: p.actualDividendUsd,
        actualAfterTaxUsd: p.actualAfterTaxUsd,
        actualAfterTaxKrw: p.actualAfterTaxKrw,
        dividendTaxRate: p.dividendTaxRate,
        dividendSeparateTax: p.dividendSeparateTax,
        lookupRows: p.lookupRows,
        memo: p.memo || '',
        investmentNotesKey: (p.investmentNotes || []).map(n => `${n.id}:${n.date}`).join('|'),
        rowColor: p.rowColor || '',
        isTest: !!p.isTest,
        historyLen: (p.history || []).length,
        // 자산검증 확정상태 지문: 확정(isFixed)·자동확정거부(autoConfirmDeclined)·확정값 변경을
        // 구조 변경으로 간주 → portfolioUpdatedAt 상승 → Drive STATE 저장(수동/자동 확정·확정취소
        // 영속화). 라이브(isFixed:false) 레코드의 evalAmount는 제외 — 시장가 갱신이 저장을 유발하지
        // 않도록(historyLen 주석의 의도 유지). 확정 레코드 evalAmount는 시장가로 안 바뀌어 안전.
        historyVerifyKey: (p.history || []).map(h =>
          h?.isFixed ? `${h.date}:${Math.round(cleanNum(h.evalAmount))}`
          : h?.autoConfirmDeclined ? `${h.date}:D` : '').filter(Boolean).join('|'),
        // 자산검증: 스냅샷·수동종가·기준일 변경도 구조 변경으로 간주 → Drive STATE 즉시 반영
        baselineDate: p.baselineDate || '',
        preBaselineVerified: !!p.preBaselineVerified,
        manualPriceOverrides: p.manualPriceOverrides || {},
        holdingSnapshotsKey: (p.holdingSnapshots || []).map(s => `${s.date}:${s.kind}:${(s.items || []).length}`).join('|'),
        taxBaseKey: JSON.stringify(Object.keys(p.taxBaseHistory || {}).sort().map(code => {
          const rec = (p.taxBaseHistory || {})[code] || {};
          return { code, events: rec.events || [], exTaxBase: rec.exTaxBase || {}, avgTaxBase: rec.avgTaxBase || {}, lastFetched: rec.lastFetched || '' };
        })),
      })),
      activePortfolioId, customLinks,
      compStocks.map(c => `${c.code}:${c.active ? 1 : 0}`).join(','),
      // 바인더 인덱스/섹션 펼침 상태 — 사용자 토글 시에만 변경(시세 갱신 무관)
      // → 변경 시 portfolioUpdatedAt 상승시켜 Drive STATE 저장 트리거 (앱 재시작 시 상태 유지)
      intSec, sectionCollapsedMap,
    ]);
    if (portfolioStructureKey !== prevPortfolioStructureRef.current) {
      const wasInitial = prevPortfolioStructureRef.current === '';
      prevPortfolioStructureRef.current = portfolioStructureKey;
      if (!wasInitial) {
        portfolioUpdatedAtRef.current = Date.now();
      }
    }
    // 활성 포트폴리오의 차트 상태(비교종목 포함)를 항상 최신으로 유지
    // 통합 대시보드 모드에서는 defaultCompStocks 가 계좌 저장값을 덮어쓰지 않도록 보호
    if (activePortfolioId) {
      const stateToSave = { ...currentChartStateRef.current };
      if (showIntegratedDashboard) {
        const prevCompStocks = accountChartStatesRef.current[activePortfolioId]?.compStocks;
        if (prevCompStocks) stateToSave.compStocks = prevCompStocks;
      }
      accountChartStatesRef.current[activePortfolioId] = stateToSave;
    }
    const intDashCompStocksToSave = (showIntegratedDashboard ? compStocks : intDashCompStocksRef.current).map(({ loading, ...rest }) => rest);
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, matongClosedIds, rebalanceSortConfigMap, intDashCompStocks: intDashCompStocksToSave }, intHistory, seenAdminNotifIds, updatedAt: Date.now(), portfolioUpdatedAt: portfolioUpdatedAtRef.current, chartPrefsUpdatedAt: chartPrefsUpdatedAtRef.current };
    saveStateRef.current = state;
    if (!isInitialLoad.current && driveTokenRef.current) {
      const chartPeriodChanged =
        prevChartPeriodRef.current !== chartPeriod ||
        prevIntChartPeriodRef.current !== intChartPeriod;
      if (chartPeriodChanged) {
        prevChartPeriodRef.current = chartPeriod;
        prevIntChartPeriodRef.current = intChartPeriod;
      }
      if (driveSaveTimerRef.current) clearTimeout(driveSaveTimerRef.current);
      driveSaveTimerRef.current = setTimeout(() => {
        saveAllToDrive(state);
      }, chartPeriodChanged ? 50 : 800);
    }
  }, [portfolios, activePortfolioId, customLinks, overseasLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, intHistory, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, intIsZeroBaseMode, chartPeriod, dateRange, appliedRange, seenAdminNotifIds, rebalanceSortConfigMap]);

  // ── 자산검증 P1: 구성 변경 트리거 보유 스냅샷 기록 ──
  // 스냅샷 없으면 baseline(기준일) 부트스트랩, 이후 구성 변경 시에만 auto 스냅샷 추가.
  // 가격 변동은 무시(snapshotCompositionKey가 수량·예수금·구성만 비교) → 일별 적재 아님.
  useEffect(() => {
    if (portfolios.length === 0) return;
    const maybeUpdate = (p) => {
      if (!p || p.accountType === 'simple' || p.accountType === 'matong') return null;
      // KR 계좌는 다음 실시간 기록 대상일(21:00 전 오늘 / 후 내일)로 기록 —
      // 새벽 구성 변경이 21:00에 확정된 전일 날짜 스냅샷으로 남는 것 방지
      // (accountType 미설정 레거시 계좌는 'portfolio' 취급 — 앱 전역 컨벤션)
      const today = isKrCutoffAccount(p.accountType || 'portfolio') ? getBackfillBoundaryKR() : effectiveDateKey;
      const items = snapshotItemsFromPortfolio(p.portfolio || []);
      if (items.length === 0) return null;
      const compKey = snapshotCompositionKey(p.portfolio || []);
      const snaps = Array.isArray(p.holdingSnapshots) ? p.holdingSnapshots : [];
      const baselineDate = p.baselineDate || today;
      if (snaps.length === 0) {
        return [{ date: baselineDate, kind: 'baseline', items }];
      }
      const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
      const latest = sorted[sorted.length - 1];
      if (snapshotCompositionKey(latest.items || []) === compKey) return null;
      const recordDate = today >= baselineDate ? today : baselineDate;
      const idx = snaps.findIndex(s => s.date === recordDate);
      if (idx >= 0) {
        const copy = snaps.slice();
        copy[idx] = { ...copy[idx], items };
        return copy;
      }
      return [...snaps, { date: recordDate, kind: 'auto', items }];
    };
    let changed = false;
    const next = portfolios.map(p => {
      const upd = maybeUpdate(p);
      if (!upd) return p;
      changed = true;
      return { ...p, holdingSnapshots: upd };
    });
    if (changed) setPortfolios(next);
  }, [portfolios, effectiveDateKey, krEffectiveDateKey]);

  useEffect(() => {
    if (totals.totalEval === 0) return;
    if (!calendarLoaded) return;
    const today = getEffectiveDateForAccount(activePortfolioAccountType);
    if (!today) return; // KR 계좌 기록 창(09:00~21:00) 밖 — 21:00 당일 확정·동결, 개장 전 placeholder 미생성
    const dayOfWeek = new Date(today + 'T12:00:00').getDay();
    const isTradingDay = (dayOfWeek !== 0 && dayOfWeek !== 6) && isMarketOpen(activePortfolioAccountType);
    setHistory(prev => {
      const krH = marketHolidays.kr;
      const usH = marketHolidays.us;
      const accType = activePortfolioAccountType;
      const existingToday = prev.find(h => h.date === today);
      // 자동확정/백필로 이미 잠긴 당일(isFixed+adjustedAmount)은 라이브 값으로 재구성하지 않음 —
      // 잠금 유지(21:00 이후 종가 확정 보존). useAutoConfirmHistory의 당일 자동확정이 되돌려지는 것 방지.
      if (existingToday?.isFixed && existingToday.adjustedAmount !== undefined) return prev;
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
      if (isAnomaly) {
        todayEntry = { date: today, evalAmount: effectivePrevValue, adjustedAmount: effectivePrevValue, actualEvalAmount: totals.totalEval, principal, isFixed: false, isAdjusted: true };
      } else {
        todayEntry = { date: today, evalAmount: totals.totalEval, adjustedAmount: totals.totalEval, actualEvalAmount: totals.totalEval, principal, isFixed: false, isAdjusted: false };
      }
      if (!needsCorrection && existingToday && !isAnomaly &&
          existingToday.evalAmount === totals.totalEval && cleaned.length === prev.length - 1) {
        return prev;
      }
      const newHist = [...correctedCleaned, todayEntry];
      const fills = fillNonTradingGaps(newHist, krH, usH, accType);
      return fills.length > 0 ? [...newHist, ...fills] : newHist;
    });
  }, [totals.totalEval, principal, calendarLoaded, activePortfolioAccountType, effectiveDateKey, krEffectiveDateKey]);

  // 07:30 이후 활성 포트폴리오의 전날 종가를 히스토리에 자동 기록 (MA: 펀드 보유 계좌)
  useEffect(() => {
    const now = new Date();
    if (now.getHours() < 7 || (now.getHours() === 7 && now.getMinutes() < 30)) return;

    const today = now.toISOString().split('T')[0];
    const maFunds = portfolio.filter(item => item.type === 'fund' && item.code?.startsWith('MA:'));
    if (maFunds.length === 0) return;
    if (maFunds.some(item => !item.navDate)) return; // 아직 가격 미로드

    let targetDate = null;
    let useCurrentPrices = true;

    const sample = maFunds[0];
    if (sample.navDate < today) {
      targetDate = sample.navDate; // rows[0] = 전날 종가
    } else if (sample.navDate === today && sample.prevNavDate && sample.prevNavDate < today) {
      targetDate = sample.prevNavDate; // 오늘 기준가 이미 발표, rows[1] = 전날
      useCurrentPrices = false;
    }

    if (!targetDate) return;
    if (autoFundHistoryRef.current === targetDate) return; // 이미 처리

    let targetEval = 0;
    portfolio.forEach(item => {
      if (item.type === 'deposit') {
        targetEval += cleanNum(item.depositAmount);
      } else if (item.type === 'fund') {
        const qty = cleanNum(item.quantity);
        const price = (!useCurrentPrices && item.code?.startsWith('MA:') && item.prevNavPrice != null)
          ? item.prevNavPrice
          : cleanNum(item.currentPrice);
        targetEval += qty > 0 && price > 0 ? qty * price : cleanNum(item.evalAmount);
      } else if (item.type === 'savings') {
        targetEval += savingsEval(item);
      } else {
        targetEval += cleanNum(item.currentPrice) * cleanNum(item.quantity);
      }
    });

    if (targetEval <= 0) return;

    setHistory(prev => {
      const idx = prev.findIndex(h => h.date === targetDate);
      if (idx >= 0 && Math.abs(prev[idx].evalAmount - targetEval) < 1) return prev;
      if (idx >= 0) return prev.map((h, i) => {
        if (i !== idx) return h;
        const next = { ...h, date: targetDate, evalAmount: targetEval, isFixed: false };
        if (!h.principalManual) next.principal = cleanNum(principal);
        return next;
      });
      return [...prev, { date: targetDate, evalAmount: targetEval, principal: cleanNum(principal), isFixed: false }];
    });

    autoFundHistoryRef.current = targetDate;
    notify(`${targetDate} 종가 기준 자산 평가액이 자동으로 기록되었습니다.`, 'success');
  }, [portfolio, totals.totalEval]);

  useEffect(() => {
    if (unifiedDates.length === 0) return;
    const prev = prevChartPeriodForRangeRef.current;
    prevChartPeriodForRangeRef.current = chartPeriod;
    if (chartPeriod === 'custom') return;
    const periodChanged = prev !== chartPeriod;
    // unifiedDates만 변경된 경우(계좌 전환·STOCK 백그라운드 로드 등) 사용자 range 보호.
    // chartPeriod이 실제로 바뀌었거나 appliedRange가 비어 있을 때만 재계산.
    if (!periodChanged && (appliedRange.start || appliedRange.end)) return;
    const latest = unifiedDates[unifiedDates.length - 1];
    const newStart = calcPeriodStart(chartPeriod, latest, unifiedDates[0]);
    if (newStart !== null) { setDateRange({ start: newStart, end: latest }); setAppliedRange({ start: newStart, end: latest }); }
  }, [chartPeriod, unifiedDates, appliedRange]);


  const handleIntSearchClick = () => {
    if (!intDateRange.start && !intDateRange.end) return;
    setIntAppliedRange({ start: intDateRange.start, end: intDateRange.end });
    setIntChartPeriod('custom');
  };

  // 통합 대시보드 - 기간 변경 시 차트 범위 업데이트
  useEffect(() => {
    if (intUnifiedDates.length === 0) return;
    const prev = prevIntChartPeriodForRangeRef.current;
    prevIntChartPeriodForRangeRef.current = intChartPeriod;
    if (intChartPeriod === 'custom') return;
    const periodChanged = prev !== intChartPeriod;
    if (!periodChanged && (intAppliedRange.start || intAppliedRange.end)) return;
    const latest = intUnifiedDates[intUnifiedDates.length - 1];
    const newStart = calcPeriodStart(intChartPeriod, latest, intUnifiedDates[0]);
    if (newStart !== null) { setIntDateRange({ start: newStart, end: latest }); setIntAppliedRange({ start: newStart, end: latest }); }
  }, [intChartPeriod, intUnifiedDates, intAppliedRange]);

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
    const indRates = {};
    INDICATOR_CHART_KEYS.forEach(k => {
      const sp = s[`${k}Point`]; const ep = e[`${k}Point`];
      indRates[`${k}PeriodRate`] = (sp > 0 && ep != null) ? ((ep / sp) - 1) * 100 : null;
    });
    const backtestPeriodRate = (s.backtestRate != null && e.backtestRate != null)
      ? ((100 + e.backtestRate) / (100 + s.backtestRate) - 1) * 100 : null;
    const compRates = Object.fromEntries(compStocks.map((_, ci) => {
      const pk = `comp${ci + 1}Point`;
      return [`comp${ci + 1}PeriodRate`, (s[pk] > 0 && e[pk] != null) ? ((e[pk] / s[pk]) - 1) * 100 : null];
    }));
    setDefaultSelectionResult({
      startDate: s.date, endDate: e.date, profit,
      rate: s.evalAmount > 0 ? (profit / s.evalAmount) * 100 : 0,
      startEval: s.evalAmount, endEval: e.evalAmount,
      backtestPeriodRate,
      kospiPeriodRate: s.kospiPoint > 0 ? ((e.kospiPoint / s.kospiPoint) - 1) * 100 : null,
      sp500PeriodRate: s.sp500Point > 0 ? ((e.sp500Point / s.sp500Point) - 1) * 100 : null,
      nasdaqPeriodRate: s.nasdaqPoint > 0 ? ((e.nasdaqPoint / s.nasdaqPoint) - 1) * 100 : null,
      principalReturnRateAtEnd: e.principalReturnRate ?? null,
      principalAtEnd: e.principalAmount ?? null,
      ...indRates, ...compRates,
    });
  }, [finalChartData, compStocks]);

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
    const result: any = { startDate: s.date, endDate: e.date, profit, rate: s.evalAmount > 0 ? ((e.evalAmount / s.evalAmount) - 1) * 100 : 0 };
    compStocks.forEach((_: any, ci: number) => {
      const key = `comp${ci + 1}Rate`;
      const sr = s[key];
      const er = e[key];
      result[`comp${ci + 1}PeriodRate`] = (sr != null && er != null) ? ((100 + er) / (100 + sr) - 1) * 100 : null;
    });
    setIntDefaultSelectionResult(result);
  }, [intChartData, compStocks]);

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

  // 새 탭 관리자 접속 콜드부팅 — ?adminView 파라미터가 있고 아직 ctx 미구성이면 관리자 무음 인증 진행.
  // 인증 완료 시 setAdminViewUserCtx → 아래 LoginGate가 ctx를 받아 PIN 화면(impersonation)으로 진입.
  if (!authUser && ADMIN_VIEW_EMAIL && !adminViewUserCtx) {
    return <AdminViewBootstrap targetEmail={ADMIN_VIEW_EMAIL} onReady={setAdminViewUserCtx} />;
  }

  // 로그인 전: LoginGate 표시
  if (!authUser) {
    return (
      <LoginGate
        onApproved={handleLoginApproved}
        adminViewUserCtx={adminViewUserCtx}
        onCancelAdminView={ADMIN_VIEW_EMAIL ? closeAdminViewTab : () => setAdminViewUserCtx(null)}
      />
    );
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
        onClose={() => {
          // ?adminPortal=1 새 탭의 뒤로가기는 탭을 닫는다(관리자 페이지는 원래 탭에 그대로 있음).
          if (ADMIN_PORTAL_BOOT) { closeAdminViewTab(); return; }
          setShowAdminPortal(false); setShowAdminPage(true);
        }}
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
    }} onViewUser={handleAdminViewUser} onOpenPortal={() => { window.open(`${window.location.origin}/?adminPortal=1`, '_blank'); }} userAccessStatus={userAccessStatus} switching={adminSwitching} userLastSeen={userLastSeen} userDriveStatus={userDriveStatus} onRefreshUserSessions={handleRefreshUserSessions} youtubeUrl={youtubeUrl} onSetYoutubeUrl={handleSetYoutubeUrl} notebookLinks={notebookLinks} onSetNotebookLinks={handleSetNotebookLinks} reportLinks={reportLinks} onSetReportLinks={handleSetReportLinks} onUploadStudyMaterial={handleUploadStudyMaterial} onDeleteStudyMaterialFile={handleDeleteStudyMaterialFile} />;
  }

  // 관리자는 모든 feature 자동 허용 — 컴포넌트에 admin 여부를 별도로 전달하지 않아도 됨
  const isAdminUser = authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const effectiveUserFeatures = isAdminUser
    ? { ...userFeatures, feature1: true, feature2: true, feature3: true }
    : userFeatures;

  // 배당 과세 이력 관리 페이지 (관리자 또는 feature2 허용 사용자)
  const canAccessDividendTax = isAdminUser || userFeatures.feature2;
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

  // 계좌 유형 파생 플래그 — 의미가 다르므로 절대 합치지 말 것 (혼동/회귀 방지)
  //  · isRetirementAccount: 펀드 기능(펀드 행·"펀드 추가" 버튼) — 퇴직연금(DC/IRP) + 개인연금(pension)
  //  · isDcIrpAccount     : 위험/안전(D/S) 자산 구분 + D70/S30 통계 — 퇴직연금(DC/IRP) 전용
  const isRetirementAccount = activePortfolioAccountType === 'dc-irp' || activePortfolioAccountType === 'pension';
  const isDcIrpAccount = activePortfolioAccountType === 'dc-irp';
  const investmentNotes = activePortfolio?.investmentNotes ?? [];

  // ── 관리자 공지/벨 이력 클릭 → 학습자료·리포트 열기 ──
  // ⚠️ resolveMaterial은 반드시 '기능 게이팅된' 배열만 사용한다(권한 OFF 사용자는 복원 0 → 접근 차단).
  //    UserInfoBar에 넘기는 게이팅 배열(아래 props)과 동일 소스를 써서 모달/벨/드롭다운이 한 기준으로 동작.
  //    isAdminUser는 위(관리자 자동 허용)에서 이미 선언됨 — 재선언 금지(중복 const = SyntaxError).
  const gatedNotebookLinks = isAdminUser || userFeatures.notebookEnabled ? notebookLinks : [];
  const gatedReportLinks = isAdminUser || userFeatures.reportEnabled ? reportLinks : [];
  const resolveMaterial = (channel, message, refCreatedAt) => resolveNoticeMaterial(
    channel === 'notebook' ? gatedNotebookLinks : channel === 'report' ? gatedReportLinks : [],
    message, channel, refCreatedAt,
  );
  const openMaterial = (link) => {
    if (!link) return;
    if (link.fileId) { setMaterialViewerLink(link); return; }
    if (link.url) {
      const u = String(link.url).trim();
      if (/^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener,noreferrer');
      else notify('잘못된 링크 형식입니다.', 'error');
    }
  };
  // 공지 확인 처리: 읽음 표시 + 벨 이력 적재(materialChannel 태그 포함) + Drive 저장.
  // 전체(확인 버튼) / 단건(자료 클릭 시 그 공지만) 공용. record 내용만 바뀌어 historyLen 불변이므로
  // portfolioUpdatedAt을 직접 올려 STATE 저장 가드를 통과시킨다(seenAdminNotifIds 유실 방지).
  const acknowledgeAdminNotices = (notices) => {
    if (!notices || notices.length === 0) return;
    const ids = notices.map(n => n.id);
    const fresh = ids.filter(id => !seenAdminNotifIdsRef.current.includes(id));
    if (fresh.length === 0) return;
    const newSeen = [...seenAdminNotifIdsRef.current, ...fresh];
    seenAdminNotifIdsRef.current = newSeen;
    setSeenAdminNotifIds(newSeen);
    notices.forEach(n => {
      const ch = noticeChannelOf(n.targetEmail);
      notify(`[관리자 공지] ${n.message}`, n.type || 'info', {
        adminNotifId: n.id, materialChannel: ch || undefined, materialCreatedAt: n.createdAt, skipDedup: true,
      });
    });
    setPendingAdminNotifs(prev => prev.filter(p => !ids.includes(p.id)));
    const nowTs = Date.now();
    portfolioUpdatedAtRef.current = nowTs;
    lastDriveSavedPortfolioUpdatedAtRef.current = 0;
    saveAllToDrive({ ...saveStateRef.current, seenAdminNotifIds: newSeen, portfolioUpdatedAt: nowTs });
  };

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
          getMaterial={(n) => resolveMaterial(noticeChannelOf(n.targetEmail), n.message, n.createdAt)}
          onOpenMaterial={(n) => {
            const mat = resolveMaterial(noticeChannelOf(n.targetEmail), n.message, n.createdAt);
            if (!mat) return;
            openMaterial(mat);
            // 자료를 연 공지는 그 자리에서 읽음 처리(확인 누락 시 다음 세션 재알림 방지). 나머지는 확인 버튼으로.
            acknowledgeAdminNotices([n]);
          }}
          onClose={() => acknowledgeAdminNotices(pendingAdminNotifs)}
        />
      )}
      <StudyMaterialViewer link={materialViewerLink} onClose={() => setMaterialViewerLink(null)} />
      
      
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
        {/* 상단 sticky 헤더: UserInfoBar + AccountTabBar */}
        <div className="sticky top-0 z-30 bg-[#0b1120] -mx-3 md:-mx-5 px-3 md:px-5 pt-2 pb-1 border-b-2 border-emerald-500/60 shadow-[0_2px_10px_rgba(16,185,129,0.18)]">
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
              // 정식 전체 state 스냅샷 기반 — 부분 state 저장 시 chartPrefs 대부분(비교종목 포함)·
              // seenAdminNotifIds 등이 누락되어 관리자 접근 토글 시 비교종목이 초기화되던 버그 방지
              const state = { ...saveStateRef.current, portfolios: buildPortfoliosState(), adminAccessAllowed: newVal, portfolioUpdatedAt: Date.now() };
              saveAllToDrive(state);
            }
          }}
          onLogout={() => {
            // 새 탭 관리자 접속 중에는 로그아웃=탭 닫기(reload 시 ?adminView로 재진입 루프 방지)
            if (ADMIN_VIEW_EMAIL) { closeAdminViewTab(); return; }
            sessionStorage.removeItem(SESSION_KEY);
            window.location.reload();
          }}
          canAccessDividendTax={canAccessDividendTax}
          onOpenDividendTax={() => setShowDividendTaxPage(true)}
          onAppClose={handleAppClose}
          showCalculator={showCalculator}
          onToggleCalculator={() => setShowCalculator(v => !v)}
          youtubeUrl={authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userFeatures.youtubeEnabled ? youtubeUrl : ''}
          notebookLinks={authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userFeatures.notebookEnabled ? notebookLinks : []}
          reportLinks={authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userFeatures.reportEnabled ? reportLinks : []}
          title={title}
          setTitle={setTitle}
          showIntegratedDashboard={showIntegratedDashboard}
          activeLinks={activePortfolioAccountType === 'overseas' ? (overseasLinks || []) : (customLinks || [])}
          setActiveLinks={activePortfolioAccountType === 'overseas' ? setOverseasLinks : setCustomLinks}
          isOverseasLinks={activePortfolioAccountType === 'overseas'}
          notificationLog={notificationLog}
          unreadCount={unreadCount}
          onReadNotifications={markAsRead}
          onClearNotifications={handleClearNotificationLog}
          onDeleteNotificationEntry={handleDeleteNotificationEntry}
          marketIndicators={marketIndicators}
          onOpenMaterial={openMaterial}
          resolveMaterial={resolveMaterial}
        />

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
          onPaste={() => setIsPasteModalOpen(true)}
          activePortfolioAccountType={activePortfolioAccountType}
          fetchMarketIndicators={fetchMarketIndicators}
          activeLinks={activePortfolioAccountType === 'overseas' ? (overseasLinks || []) : (customLinks || [])}
          setActiveLinks={activePortfolioAccountType === 'overseas' ? setOverseasLinks : setCustomLinks}
          marketIndicators={marketIndicators}
        />
        </div>

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
          <PortfolioTable
            portfolio={totals.calcPortfolio}
            totals={totals}
            sortConfig={sortConfig}
            onSort={handleSort}
            onUpdate={handleUpdate}
            onBlur={handleStockBlur}
            onDelete={handleDeleteStock}
            onAddStock={handleAddStock}
            onAddFund={handleAddFund}
            onAddSavings={handleAddSavings}
            onUpdateSavingsField={updateSavingsField}
            onAddSavingsDeposit={addSavingsDeposit}
            onRemoveSavingsDeposit={removeSavingsDeposit}
            showSavings={isDcIrpAccount}
            stockFetchStatus={stockFetchStatus}
            onSingleRefresh={handleSingleStockRefresh}
            isOverseas={activePortfolioAccountType === 'overseas'}
            usdkrw={marketIndicators.usdkrw || 1}
            isRetirement={isRetirementAccount}
            showAssetClass={isDcIrpAccount}
            showRetirementStats={isDcIrpAccount}
            hiddenColumns={hiddenColumnsPortfolio}
            onToggleColumn={toggleHiddenColumnPortfolio}
            markedPortfolioRows={markedPortfolioRows}
            onToggleMarkedPortfolioRow={toggleMarkedPortfolioRow}
            onResetAllMarkedPortfolioRows={resetAllMarkedPortfolioRows}
          />
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
        <div className="flex flex-col xl:flex-row gap-4 w-full items-stretch">
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
            sortedHistoryDesc={sortedHistoryDesc}
            handleDownloadCSV={handleDownloadCSV}
            stockHistoryMap={stockHistoryMap}
            indicatorHistoryMap={indicatorHistoryMap}
            activePortfolio={activePortfolio}
            patchActivePortfolio={patchActivePortfolio}
            notify={notify}
            effectiveDateKey={isKrCutoffAccount(activePortfolioAccountType) ? krEffectiveDateKey : effectiveDateKey}
            refreshPrices={refreshPrices}
            isLoading={isLoading}
            depositHistory={depositHistory}
            depositHistory2={depositHistory2}
            refetchStockHistory={refetchStockHistory}
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

        {(authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userFeatures.feature3) && activePortfolioAccountType !== 'gold' && !sectionCollapsed.dividend && (
          <DividendSummaryTable
            portfolios={allPortfoliosForDividend.filter(p => p.id === activePortfolioId)}
            updatePortfolioDividendHistory={updatePortfolioDividendHistory}
            updatePortfolioActualDividend={updatePortfolioActualDividend}
            updatePortfolioActualDividendUsd={updatePortfolioActualDividendUsd}
            updatePortfolioActualDividendQty={updatePortfolioActualDividendQty}
            updatePortfolioDividendTaxRate={updatePortfolioDividendTaxRate}
            updatePortfolioDividendSeparateTax={updatePortfolioDividendSeparateTax}
            updatePortfolioDividendTaxAmount={updatePortfolioDividendTaxAmount}
            updatePortfolioActualAfterTaxUsd={updatePortfolioActualAfterTaxUsd}
            updatePortfolioActualAfterTaxKrw={updatePortfolioActualAfterTaxKrw}
            addPortfolioExtraRow={addPortfolioExtraRow}
            updatePortfolioExtraRowCode={updatePortfolioExtraRowCode}
            deletePortfolioExtraRow={deletePortfolioExtraRow}
            updatePortfolioExtraRowMonth={updatePortfolioExtraRowMonth}
            updateTaxBaseEvents={updateTaxBaseEvents}
            updateTaxBasePurchases={updateTaxBasePurchases}
            updateTaxBaseSales={updateTaxBaseSales}
            updateTaxBaseExPrice={updateTaxBaseExPrice}
            updateTaxBaseAvgPrice={updateTaxBaseAvgPrice}
            notify={notify}
            usdkrw={marketIndicators.usdkrw || 1300}
            holidays={marketHolidays}
            dividendTaxHistory={dividendTaxHistory}
            onDividendTaxHistoryUpdate={setDividendTaxHistory}
          />
        )}

        {/* 차트 영역 + 시장 지표 */}
        {!sectionCollapsed.chart && (
        <div className="flex flex-col xl:flex-row gap-4 w-full mb-10 items-stretch">
          {/* 시장 지표 카드 — gold 계좌 또는 패널 숨김 시 비표시 */}
          {(authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userFeatures.feature1) && activePortfolioAccountType !== 'gold' && showMarketPanel && (
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
            isAvgPriceMode={isAvgPriceMode}
            setIsAvgPriceMode={setIsAvgPriceMode}
            showCalcVerify={showCalcVerify}
            setShowCalcVerify={setShowCalcVerify}
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
            userFeatures={effectiveUserFeatures}
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
            handleForceRefetchComp={handleForceRefetchComp}
            handleRemoveCompStock={handleRemoveCompStock}
            effectiveDateKey={effectiveDateKey}
            depositHistory={depositHistory}
            depositHistory2={depositHistory2}
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
            showRetirementStats={isDcIrpAccount}
            hiddenColumns={hiddenColumnsRebalancing}
            onToggleColumn={toggleHiddenColumnRebalancing}
            markedRebalRows={markedRebalRows}
            onToggleMarkedRebalRow={toggleMarkedRebalRow}
            onResetAllMarkedRebalRows={resetAllMarkedRebalRows}
            authUser={authUser}
            isAdmin={!!adminViewingAs || (authUser && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase())}
            targetEditAuthorized={targetEditAuthorized}
            setTargetEditAuthorized={setTargetEditAuthorized}
            onAdminTargetChange={adminViewingAs ? notifyUserOfAdminTargetChange : null}
            onManualSave={handleDriveSave}
            driveStatus={driveStatus}
            showCalculator={showCalculator}
            onToggleCalculator={() => setShowCalculator(v => !v)}
            investmentNotes={investmentNotes}
            onUpdateInvestmentNotes={updateInvestmentNotes}
          />
        )}
          </div>
          {/* 우측 바인더 탭 */}
          <div className="sticky top-14 self-start flex flex-col gap-px flex-shrink-0 z-10 pt-3">
            {activePortfolioAccountType !== 'gold' && (
              <button onClick={() => toggleSection('summary')} style={{ writingMode: 'vertical-lr' }} className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sectionCollapsed.summary ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>포트폴리오 요약</button>
            )}
            <button onClick={() => toggleSection('stats')} style={{ writingMode: 'vertical-lr' }} className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sectionCollapsed.stats ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>통계·히스토리</button>
            {(authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userFeatures.feature3) && activePortfolioAccountType !== 'gold' && (
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
            togglePortfolioTest={togglePortfolioTest}
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
            activePortfolioId={activePortfolioId}
            activeHistory={history}
            userFeatures={effectiveUserFeatures}
            updatePortfolioDividendHistory={updatePortfolioDividendHistory}
            updatePortfolioActualDividend={updatePortfolioActualDividend}
            updatePortfolioActualDividendUsd={updatePortfolioActualDividendUsd}
            updatePortfolioActualDividendQty={updatePortfolioActualDividendQty}
            updatePortfolioDividendTaxRate={updatePortfolioDividendTaxRate}
            updatePortfolioDividendSeparateTax={updatePortfolioDividendSeparateTax}
            updatePortfolioDividendTaxAmount={updatePortfolioDividendTaxAmount}
            updatePortfolioActualAfterTaxUsd={updatePortfolioActualAfterTaxUsd}
            updatePortfolioActualAfterTaxKrw={updatePortfolioActualAfterTaxKrw}
            usdkrw={marketIndicators.usdkrw || 1300}
            holidays={marketHolidays}
            dividendTaxHistory={dividendTaxHistory}
            matongClosedIds={matongClosedIds}
            setMatongClosedIds={setMatongClosedIds}
            compStocks={compStocks}
            setCompStocks={setCompStocks}
            stockHistoryMap={stockHistoryMap}
            stockListingDates={stockListingDates}
            setStockListingDates={setStockListingDates}
            appliedRange={intAppliedRange}
            autoFetchedCodes={autoFetchedCodes}
            stockFetchStatus={stockFetchStatus}
            handleAddCompStock={handleAddCompStock}
            handleToggleComp={handleToggleComp}
            handleCompStockBlur={handleCompStockBlur}
            handleFetchCompHistory={handleFetchCompHistory}
            handleForceRefetchComp={handleForceRefetchComp}
            handleRemoveCompStock={handleRemoveCompStock}
            customLinks={customLinks}
            setCustomLinks={setCustomLinks}
            isLinkSettingsOpen={isLinkSettingsOpen}
            setIsLinkSettingsOpen={setIsLinkSettingsOpen}
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
