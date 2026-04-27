// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Settings, RefreshCw, Save, ClipboardPaste, Plus,
  X, Trash2, Download, Calendar,
  Minus, ArrowDownToLine, Triangle, FileUp, Activity, Search, Lock, CloudDownload, LogOut, Link2,
  BarChart2, Percent, History, PanelLeft, PanelLeftClose
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ComposedChart, Line, Area, XAxis,
  YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceArea, Label
} from 'recharts';
import { UI_CONFIG, GOOGLE_CLIENT_ID, ADMIN_EMAIL } from './config';
import { DRIVE_FILES, getOrCreateIndexFolder, saveDriveFile, loadDriveFile, MAX_BACKUPS } from './driveStorage';
import { fetchIndexData, fetchStockInfo, fetchUsStockInfo, fetchUsStockHistory, fetchNaverKospi, fetchNaverStockHistory, fetchKISStockHistory, fetchFundInfo } from './api';
import Header from './components/Header';
import PortfolioTable from './components/PortfolioTable';
import KrxGoldTable from './components/KrxGoldTable';
import MarketIndicators from './components/MarketIndicators';
import LoginGate, { verifyPin, savePin, hashPin, savePinToDrive, PIN_KEY, SESSION_KEY, UserFeatures } from './components/LoginGate';
import AdminPage from './components/AdminPage';
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
import { useDriveSync } from './hooks/useDriveSync';
import { useMarketData, defaultCompStocks } from './hooks/useMarketData';
import { usePortfolioState } from './hooks/usePortfolioState';
import { useHistoryChart } from './hooks/useHistoryChart';
import {
  generateId, cleanNum, formatCurrency, formatPercent, formatNumber,
  formatChangeRate, formatShortDate, formatVeryShortDate, getSeededRandom,
  getClosestValue, getIndexLatest, handleTableKeyDown, handleReadonlyCellNav, buildIndexStatus,
  parseIndexCSV, detectIndexFromFileName
} from './utils';

const INT_CATEGORIES = ['주식', '주식-a', '금', '채권', '현금', '리츠', '배당주식', '예수금'];

const ACCOUNT_TYPE_CONFIG: Record<string, { emoji: string; activeColor: string; activeBorder: string; inactiveColor: string; label: string; color: string }> = {
  'dc-irp':    { emoji: '🏦', activeColor: 'text-amber-400',   activeBorder: 'border-amber-500',   inactiveColor: 'text-amber-600/70',   label: '퇴직연금', color: '#f59e0b' },
  'isa':       { emoji: '🌱', activeColor: 'text-emerald-400', activeBorder: 'border-emerald-500', inactiveColor: 'text-emerald-600/70', label: 'ISA',      color: '#34d399' },
  'portfolio': { emoji: '📈', activeColor: 'text-blue-400',    activeBorder: 'border-blue-500',    inactiveColor: 'text-blue-600/70',    label: '일반증권', color: '#60a5fa' },
  'dividend':  { emoji: '💰', activeColor: 'text-green-400',   activeBorder: 'border-green-500',   inactiveColor: 'text-green-600/70',   label: '배당형',   color: '#4ade80' },
  'pension':   { emoji: '🎯', activeColor: 'text-purple-400',  activeBorder: 'border-purple-500',  inactiveColor: 'text-purple-600/70',  label: '개인연금', color: '#c084fc' },
  'gold':      { emoji: '🥇', activeColor: 'text-yellow-400',  activeBorder: 'border-yellow-500',  inactiveColor: 'text-yellow-600/70',  label: 'KRX 금현물', color: '#facc15' },
  'overseas':  { emoji: '🌐', activeColor: 'text-sky-400',     activeBorder: 'border-sky-500',     inactiveColor: 'text-sky-600/70',     label: '해외계좌', color: '#38bdf8' },
  'crypto':    { emoji: '₿',  activeColor: 'text-orange-400',  activeBorder: 'border-orange-500',  inactiveColor: 'text-orange-600/70',  label: 'CRYPTO',   color: '#fb923c' },
  'simple':    { emoji: '📋', activeColor: 'text-gray-400',    activeBorder: 'border-gray-500',    inactiveColor: 'text-gray-600/70',    label: '직접입력', color: '#9ca3af' },
};

const sortArrow = (config, key) =>
  config.key === key
    ? (config.direction === 1 ? <span className="ml-0.5 text-blue-400 text-[8px]">▲</span> : <span className="ml-0.5 text-blue-400 text-[8px]">▼</span>)
    : <span className="ml-0.5 text-gray-600 text-[8px]">⇅</span>;

const PieLabelOutside = ({ cx, cy, midAngle, outerRadius, percent, name }) => {
  const safePercent = cleanNum(percent);
  if (safePercent < 0.03) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 20;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#9ca3af" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight="bold">
      {name} ({(safePercent * 100).toFixed(1)}%)
    </text>
  );
};

const CustomChartTooltip = ({ active, payload, total, hideAmounts = false }) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    const itemColor = data.payload?.fill || data.color || data.fill || '#f8fafc';
    let percentStr = "";
    if (total && total > 0) percentStr = `${((data.value / total) * 100).toFixed(1)}%`;
    else if (data.payload?.percent !== undefined || data.percent !== undefined) {
      percentStr = `${((data.payload?.percent ?? data.percent) * 100).toFixed(1)}%`;
    }
    return (
      <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid #4b5563', borderRadius: '10px', padding: '12px 16px' }} className="shadow-2xl flex flex-col items-center justify-center gap-1">
        <span style={{ color: itemColor, fontWeight: '900', fontSize: '20px' }}>{data.name} : {percentStr}</span>
        <span style={{ color: itemColor, fontWeight: 'bold', fontSize: '14px', opacity: 0.9 }}>{hideAmounts ? '••••••' : formatCurrency(data.value)}</span>
      </div>
    );
  }
  return null;
};


// ─── MainChartCustomTooltip ─────────────────────────────────────────────────
const CHART_NAME_TO_PERIOD_KEY = {
  '수익률':  null,
  '총자산':  null,
  'KOSPI':   'kospiPeriodRate',
  'S&P500':  'sp500PeriodRate',
  'NASDAQ':  'nasdaqPeriodRate',
  'US 10Y':  'us10yPeriodRate',
  'Gold':    'goldIntlPeriodRate',
  '국내금':   'goldKrPeriodRate',
  'USDKRW':  'usdkrwPeriodRate',
  'DXY':     'dxyPeriodRate',
  '기준금리': 'fedRatePeriodRate',
  'KR 10Y':  'kr10yPeriodRate',
  'VIX':     'vixPeriodRate',
};
const CHART_NAME_TO_POINT_KEY = {
  'KOSPI':   'kospiPoint',  'S&P500': 'sp500Point', 'NASDAQ': 'nasdaqPoint',
  'US 10Y':  'us10yPoint',  'Gold': 'goldIntlPoint', '국내금': 'goldKrPoint', 'USDKRW': 'usdkrwPoint',
  'DXY':     'dxyPoint',    '기준금리': 'fedRatePoint', 'KR 10Y': 'kr10yPoint', 'VIX': 'vixPoint',
};

function extractLinkLabel(url, maxLen = 7) {
  if (!url) return null;
  try {
    const withProto = url.startsWith('http') ? url : 'https://' + url;
    const hostname = new URL(withProto).hostname;
    let name = hostname.replace(/^(www\.|m\.)/, '');
    name = name.replace(/\.com$/, '');
    return name.slice(0, maxLen) || null;
  } catch {
    return null;
  }
}

function MainChartCustomTooltip({ active, payload, label, selectionResult, formatShortDateFn, formatNumberFn }) {
  if (!active || !payload || !payload.length) return null;

  const fmtRate = (r) => {
    if (r == null) return null;
    const sign = r >= 0 ? '+' : '';
    return `${sign}${r.toFixed(2)}%`;
  };

  const fmt = (d) => formatShortDateFn ? formatShortDateFn(d) : d;

  return (
    <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid #4b5563', borderRadius: '8px', color: '#ffffff', padding: '10px 14px', minWidth: 180, maxWidth: 280 }}>
      <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: selectionResult ? 2 : 6, fontWeight: 700 }}>
        {fmt(label)}
      </p>
      {selectionResult && (
        <p style={{ fontSize: 10, color: '#93c5fd', marginBottom: 6, fontWeight: 600 }}>
          선택 기간: {fmt(selectionResult.startDate)} ~ {fmt(selectionResult.endDate)}
        </p>
      )}
      {payload.map((entry, i) => {
        const name = entry.name;
        const rawValue = entry.value;
        if (rawValue == null) return null;
        // scaled dataKey면 원본 Rate 값으로 복원해 표시
        const dk = entry.dataKey;
        const value = dk?.endsWith('RateScaled')
          ? (entry.payload?.[dk.replace('RateScaled', 'Rate')] ?? rawValue)
          : rawValue;

        // 현재값 포맷
        let displayVal;
        if (name === '총자산') {
          displayVal = formatNumberFn ? formatNumberFn(rawValue) : rawValue;
        } else {
          const pointKey = CHART_NAME_TO_POINT_KEY[name];
          let pointVal = pointKey && entry.payload ? entry.payload[pointKey] : null;
          // comp 종목: dataKey 패턴(compNRate)으로 가격 조회
          const compRateMatch = dk?.match(/^comp(\d+)Rate$/);
          if (pointVal == null && compRateMatch && entry.payload) {
            pointVal = entry.payload[`comp${compRateMatch[1]}Point`];
          }
          const rateStr = Number(value).toFixed(2) + '%';
          if (pointVal != null) {
            // 시장 지표는 소수점 2자리, 종목 가격은 정수 포맷
            const isCompStock = !!compRateMatch;
            const priceStr = isCompStock
              ? Number(pointVal).toLocaleString()
              : Number(pointVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            displayVal = `${rateStr} (${priceStr})`;
          } else {
            displayVal = rateStr;
          }
        }

        // 드래그 구간 수익률
        let periodTag = null;
        if (selectionResult) {
          let periodRate = null;
          const periodKey = CHART_NAME_TO_PERIOD_KEY[name];
          if (periodKey && selectionResult[periodKey] != null) {
            periodRate = selectionResult[periodKey];
          } else if (name === '수익률' && selectionResult.rate != null) {
            periodRate = selectionResult.rate;
          } else if (compRateMatch) {
            const dragPeriodKey = `comp${compRateMatch[1]}PeriodRate`;
            if (selectionResult[dragPeriodKey] != null) periodRate = selectionResult[dragPeriodKey];
          }
          if (periodRate != null) {
            const color = periodRate >= 0 ? '#f87171' : '#60a5fa';
            periodTag = <span style={{ color, fontWeight: 700, fontSize: 10, marginLeft: 6, whiteSpace: 'nowrap' }}>[구간: {fmtRate(periodRate)}]</span>;
          }
        }

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: entry.color || '#e5e7eb', fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: entry.color || '#e5e7eb', display: 'inline-block', flexShrink: 0 }} />
              {name}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: '#e5e7eb', marginLeft: 10 }}>
              {displayVal}{periodTag}
            </span>
          </div>
        );
      })}
    </div>
  );
}
// ────────────────────────────────────────────────────────────────────────────


export default function App() {
  const historyInputRef = useRef(null);

  // ── 인증 상태 ──
  const [authUser, setAuthUser] = useState<{ email: string; token: string } | null>(null);
  const [userFeatures, setUserFeatures] = useState<UserFeatures>({ name: '', feature1: false, feature2: false, feature3: false });
  const [showAdminPage, setShowAdminPage] = useState(false);
  const [adminViewingAs, setAdminViewingAs] = useState<string | null>(null);
  const adminOwnDriveTokenRef = useRef<string>('');
  const adminViewingAsRef = useRef<string | null>(null);
  const [showPinChange, setShowPinChange] = useState(false);
  const [pinChangeSaving, setPinChangeSaving] = useState(false);
  const [pinCurrent, setPinCurrent] = useState(['', '', '', '']);
  const [pinNew, setPinNew] = useState(['', '', '', '']);
  const [pinConfirm, setPinConfirm] = useState(['', '', '', '']);
  const [pinChangeError, setPinChangeError] = useState('');

  const handleLoginApproved = (email: string, token: string, features: UserFeatures) => {
    setAuthUser({ email, token });
    setUserFeatures(features);
  };

  const handleAdminViewUser = (targetEmail: string) => {
    setShowAdminPage(false);
    const tryInit = (retries = 20) => {
      if ((window as any).google?.accounts?.oauth2) {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          hint: targetEmail,
          callback: async (resp: any) => {
            if (resp.error || !resp.access_token) {
              showToast(`${targetEmail} 계정 접속 실패. 해당 계정이 이 브라우저에 로그인되어 있지 않을 수 있습니다.`, true);
              setShowAdminPage(true);
              return;
            }
            const token = resp.access_token;
            try {
              const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
              });
              const infoData = await infoRes.json();
              if (infoData.email?.toLowerCase() !== targetEmail.toLowerCase()) {
                showToast('다른 계정으로 로그인되었습니다.', true);
                setShowAdminPage(true);
                return;
              }
            } catch {
              showToast('계정 확인 실패', true);
              setShowAdminPage(true);
              return;
            }
            // 접속 허용 여부 확인 (사용자 Drive state 파일에서 adminAccessAllowed 체크)
            try {
              const checkFolderId = await getOrCreateIndexFolder(token);
              const stateData = await loadDriveFile(token, checkFolderId, DRIVE_FILES.STATE) as any;
              const isAllowed = !stateData || stateData.adminAccessAllowed !== false;
              setUserAccessStatus(prev => ({ ...prev, [targetEmail]: isAllowed }));
              if (!isAllowed) {
                showToast(`${targetEmail} 사용자가 관리자 접속을 허용하지 않았습니다.`, true);
                setShowAdminPage(true);
                return;
              }
            } catch {
              // 파일 없거나 오류 시 허용 (신규 사용자)
              setUserAccessStatus(prev => ({ ...prev, [targetEmail]: true }));
            }
            adminOwnDriveTokenRef.current = driveTokenRef.current;
            adminViewingAsRef.current = targetEmail;
            setAdminViewingAs(targetEmail);
            isInitialLoad.current = true;
            driveTokenRef.current = token;
            setDriveToken(token);
            driveFolderIdRef.current = '';
            await loadFromDrive(token);
            isInitialLoad.current = false;
          },
        });
        client.requestAccessToken({ prompt: '' });
      } else if (retries > 0) {
        setTimeout(() => tryInit(retries - 1), 300);
      } else {
        showToast('Google 인증 초기화 실패', true);
        setShowAdminPage(true);
      }
    };
    tryInit();
  };

  const handleReturnToAdminPage = async () => {
    const ownToken = adminOwnDriveTokenRef.current;
    adminOwnDriveTokenRef.current = '';
    adminViewingAsRef.current = null;
    setAdminViewingAs(null);
    isInitialLoad.current = true;
    driveTokenRef.current = ownToken;
    setDriveToken(ownToken);
    driveFolderIdRef.current = '';
    await loadFromDrive(ownToken);
    isInitialLoad.current = false;
    setShowAdminPage(true);
  };

  const [historyLimit, setHistoryLimit] = useState(UI_CONFIG.DEFAULTS.HISTORY_LIMIT);
  const [comparisonMode, setComparisonMode] = useState('latestOverPast');
  const [isLinkSettingsOpen, setIsLinkSettingsOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 1 });
  const [rebalanceSortConfig, setRebalanceSortConfig] = useState({ key: null, direction: 1 });
  const [rebalExtraQty, setRebalExtraQty] = useState<Record<string, number>>({});
  
  const [globalToast, setGlobalToast] = useState({ text: "", isError: false });
  const showToast = (text, isError = false) => { setGlobalToast({ text, isError }); setTimeout(() => setGlobalToast({ text: "", isError: false }), 4000); };

  const [userAccessStatus, setUserAccessStatus] = useState<Record<string, boolean>>({});

  const portfolioRef = useRef([]);
  const activePortfolioAccountTypeRef = useRef('portfolio'); // 클로저 문제 해결용 (20분 인터벌 등)
  const stockHistoryMapRef = useRef<Record<string, Record<string, number>>>({}); // 클로저 문제 해결용
  const saveStateRef = useRef<Record<string, any>>({}); // 항상 최신 state 스냅샷 유지
  // applyStateData/applyBackupData 콜백 ref (useDriveSync → useMarketData 순환 의존 해소)
  const applyStateDataRef = useRef<Function | null>(null);
  const applyBackupDataRef = useRef<Function | null>(null);
  // 계좌별 차트 상태 독립 관리
  const currentChartStateRef = useRef<any>({ showKospi: true, showSp500: false, showNasdaq: false, showIndicatorsInChart: { us10y: false, kr10y: false, goldIntl: false, goldKr: false, usdkrw: false, dxy: false, fedRate: false, vix: false, btc: false, eth: false }, goldIndicators: { goldIntl: true, goldKr: true, usdkrw: false, dxy: false }, compStocks: [], chartPeriod: '3m', dateRange: { start: '', end: '' }, appliedRange: { start: '', end: '' }, backtestColor: '#f97316', showBacktest: false });
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
    goldKrAutoCrawledRef, stooqAutoCrawledRef,
    ensureDriveFolder, loadFromDrive, saveAllToDrive, requestDriveToken,
    initTokenClient, checkAndSyncFromDrive,
    handleDriveLoadOnly, handleOpenBackupModal, handleApplyBackup,
  } = useDriveSync({
    authUser,
    applyStateData: (...args) => applyStateDataRef.current?.(...args),
    applyBackupData: (...args) => applyBackupDataRef.current?.(...args),
    accountChartStatesRef, saveStateRef, showToast,
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
  } = useMarketData({ driveStatus, driveTokenRef, ensureDriveFolder, appliedRange, showToast, goldKrAutoCrawledRef, stooqAutoCrawledRef });

  // ── usePortfolioState 훅 ──
  const {
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
    activePortfolioAccountType,
    buildPortfoliosState,
    addPortfolio,
    deletePortfolio,
  } = usePortfolioState({ marketIndicators, showToast, setShowIntegratedDashboard });

  // ── Drive 데이터 적용 콜백 (loadFromDrive / handleApplyBackup 에서 호출) ──
  const applyStateData = (stateData, stockData, marketData) => {
    const resolvedStockHistoryMap = stockData?.stockHistoryMap || stateData.stockHistoryMap || {};
    setStockHistoryMap(resolvedStockHistoryMap);

    if (stateData.portfolios?.length > 0) {
      setPortfolios(stateData.portfolios);
      const activeId = stateData.activePortfolioId || stateData.portfolios[0].id;
      setActivePortfolioId(activeId);
      const active = stateData.portfolios.find(p => p.id === activeId) || stateData.portfolios[0];
      setTitle(active.name || '포트폴리오');
      setPortfolio(active.portfolio || []);
      setPrincipal(active.principal || 0);
      setHistory(active.history || []);
      setDepositHistory(active.depositHistory || []);
      if (active.depositHistory2) setDepositHistory2(active.depositHistory2);
      setPortfolioStartDate(active.startDate || active.portfolioStartDate || '');
      setSettings(active.settings || { mode: 'rebalance', amount: 1000000 });
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
      setTitle(stateData.title || '포트폴리오');
      setPortfolio(stateData.portfolio || []);
      setPrincipal(cleanNum(stateData.principal));
      setHistory(stateData.history || []);
      setDepositHistory(stateData.depositHistory || []);
      if (stateData.depositHistory2) setDepositHistory2(stateData.depositHistory2);
      setSettings(stateData.settings || { mode: 'rebalance', amount: 1000000 });
      if (stateData.portfolioStartDate) setPortfolioStartDate(stateData.portfolioStartDate);
    }
    setCustomLinks(stateData.customLinks || UI_CONFIG.DEFAULT_LINKS);
    if (stateData.overseasLinks) setOverseasLinks(stateData.overseasLinks);
    setLookupRows(stateData.lookupRows || []);
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
      if (stateData.chartPrefs.indicatorScales) setIndicatorScales(stateData.chartPrefs.indicatorScales);
      if (stateData.chartPrefs.backtestColor) setBacktestColor(stateData.chartPrefs.backtestColor);
      if (stateData.chartPrefs.showBacktest !== undefined) setShowBacktest(stateData.chartPrefs.showBacktest);
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

  const applyBackupData = (stateData, acRef) => {
    if (stateData.portfolios?.length > 0) {
      setPortfolios(stateData.portfolios);
      const activeId = stateData.activePortfolioId || stateData.portfolios[0].id;
      setActivePortfolioId(activeId);
      const active = stateData.portfolios.find(p => p.id === activeId) || stateData.portfolios[0];
      setTitle(active.name || '포트폴리오');
      setPortfolio(active.portfolio || []);
      setPrincipal(active.principal || 0);
      setHistory(active.history || []);
      setDepositHistory(active.depositHistory || []);
      if (active.depositHistory2) setDepositHistory2(active.depositHistory2);
      setPortfolioStartDate(active.startDate || active.portfolioStartDate || '');
      setSettings(active.settings || { mode: 'rebalance', amount: 1000000 });
    }
    if (stateData.customLinks) setCustomLinks(stateData.customLinks);
    if (stateData.overseasLinks) setOverseasLinks(stateData.overseasLinks);
    if (stateData.lookupRows) setLookupRows(stateData.lookupRows);
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
      if (stateData.chartPrefs.indicatorScales) setIndicatorScales(stateData.chartPrefs.indicatorScales);
      if (stateData.chartPrefs.backtestColor) setBacktestColor(stateData.chartPrefs.backtestColor);
      if (stateData.chartPrefs.showBacktest !== undefined) setShowBacktest(stateData.chartPrefs.showBacktest);
    }
  };
  applyBackupDataRef.current = applyBackupData;

  // *Ref를 항상 최신 상태로 동기화 (클로저 문제 해결용 — 20분 인터벌 등 stale closure 방지)
  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);
  useEffect(() => { activePortfolioAccountTypeRef.current = activePortfolioAccountType; }, [activePortfolioAccountType]);
  useEffect(() => { stockHistoryMapRef.current = stockHistoryMap; }, [stockHistoryMap]);

  // gold 계좌 전용 차트 지표 — 다른 계좌의 showIndicatorsInChart와 완전 분리
  const effectiveShowIndicators = useMemo(() => {
    if (activePortfolioAccountType === 'gold') {
      return { goldIntl: goldIndicators.goldIntl, goldKr: goldIndicators.goldKr, usdkrw: goldIndicators.usdkrw, dxy: goldIndicators.dxy, us10y: false, kr10y: false, fedRate: false, vix: false, btc: false, eth: false };
    }
    return showIndicatorsInChart;
  }, [activePortfolioAccountType, goldIndicators, showIndicatorsInChart]);

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
      compStocks: compStocks.map(({ loading, ...rest }) => rest),
      chartPeriod,
      dateRange,
      appliedRange,
      backtestColor,
      showBacktest,
    };
  }, [showKospi, showSp500, showNasdaq, showIndicatorsInChart, goldIndicators, compStocks, chartPeriod, dateRange, appliedRange, backtestColor, showBacktest]);

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
          setShowKospi(false); setShowSp500(false); setShowNasdaq(false);
          setGoldIndicators({ goldIntl: true, goldKr: true, usdkrw: false, dxy: false });
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

  const totals = useMemo(() => {
    const fxRate = activePortfolioAccountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
    let tInv = 0, tEvl = 0, tPrf = 0, cats = {}, stks = [];
    const calc = portfolio.map(item => {
      let inv = 0, evl = 0;
      if (item.type === 'deposit') { inv = evl = cleanNum(item.depositAmount) * fxRate; }
      else if (item.type === 'fund') {
        inv = cleanNum(item.investAmount) * fxRate;
        const qty = cleanNum(item.quantity);
        const price = cleanNum(item.currentPrice);
        evl = qty > 0 && price > 0 ? qty * price * fxRate : cleanNum(item.evalAmount) * fxRate;
      }
      else { inv = cleanNum(item.purchasePrice) * cleanNum(item.quantity) * fxRate; evl = cleanNum(item.currentPrice) * cleanNum(item.quantity) * fxRate; }
      const prf = evl - inv; tInv += inv; tEvl += evl; tPrf += prf;
      const c = item.type === 'deposit' ? '예수금' : (item.category || '미지정');
      if (!cats[c]) cats[c] = { invest: 0, eval: 0, profit: 0 };
      cats[c].invest += inv; cats[c].eval += evl; cats[c].profit += prf;
      if (item.type === 'stock') stks.push({ name: item.name, eval: evl });
      return { ...item, investAmount: inv, evalAmount: evl, profit: prf };
    }).map(item => ({
      ...item,
      investRatio: tInv > 0 ? (item.investAmount / tInv) * 100 : 0,
      evalRatio: tEvl > 0 ? (item.evalAmount / tEvl) * 100 : 0,
      returnRate: item.investAmount > 0 ? (item.profit / item.investAmount) * 100 : 0
    }));
    return { calcPortfolio: calc, totalInvest: tInv, totalEval: tEvl, totalProfit: tPrf, cats, stks };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio, activePortfolioAccountType, marketIndicators.usdkrw]);

  const cagr = useMemo(() => {
    if (!portfolioStartDate || principal <= 0 || totals.totalEval <= 0) return 0;
    const days = (new Date() - new Date(portfolioStartDate)) / (1000 * 60 * 60 * 24);
    if (days <= 0) return 0;
    if (days < 365) return (totals.totalEval / principal - 1) * 100;
    return (Math.pow(totals.totalEval / principal, 1 / (days / 365.25)) - 1) * 100;
  }, [portfolioStartDate, principal, totals.totalEval]);

  const sortedHistoryDesc = useMemo(() => [...history].sort((a, b) => new Date(b.date) - new Date(a.date)), [history]);

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

  const rebalanceData = useMemo(() => {
    const rebalFxRate = activePortfolioAccountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
    const depositAmount = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
    const nativeTotalEval = rebalFxRate > 1 ? totals.totalEval / rebalFxRate : totals.totalEval;
    const overallExp = nativeTotalEval + cleanNum(settings.amount);
    const accumulateBase = cleanNum(settings.amount) + depositAmount;
    let data = portfolio.filter(p => p.type === 'stock' || p.type === 'fund').map(item => {
      const tRatio = cleanNum(item.targetRatio) / 100;
      const qty = cleanNum(item.quantity);
      const price = cleanNum(item.currentPrice);
      const curEval = item.type === 'fund' && !(qty > 0 && price > 0)
        ? cleanNum(item.evalAmount)
        : price * qty;
      let action = price > 0 ? (settings.mode === 'rebalance' ? Math.trunc(((overallExp * tRatio) - curEval) / price) : Math.trunc((accumulateBase * tRatio) / price)) : 0;
      const expEval = (qty + action) * price;
      const cost = action * price;
      const expRatio = overallExp > 0 ? (expEval / overallExp * 100) : 0;
      return { ...item, curEval, action, cost, expEval, expRatio };
    });
    if (rebalanceSortConfig.key && rebalanceSortConfig.key !== 'category') {
      const catOrder: string[] = [];
      const grouped: Record<string, typeof data> = {};
      data.forEach(item => {
        const cat = (item.category as string) || '기타';
        if (!grouped[cat]) { grouped[cat] = []; catOrder.push(cat); }
        grouped[cat].push(item);
      });
      Object.values(grouped).forEach(items => {
        items.sort((a, b) => {
          const vA = a[rebalanceSortConfig.key], vB = b[rebalanceSortConfig.key];
          if (typeof vA === 'string') return vA.localeCompare(vB) * rebalanceSortConfig.direction;
          return (vA - vB) * rebalanceSortConfig.direction;
        });
      });
      data = catOrder.flatMap(cat => grouped[cat]);
    } else if (rebalanceSortConfig.key === 'category') {
      data.sort((a, b) => {
        const catA = (a.category as string) || '기타', catB = (b.category as string) || '기타';
        return catA.localeCompare(catB) * rebalanceSortConfig.direction;
      });
    }
    return data;
  }, [portfolio, totals.totalEval, settings, rebalanceSortConfig, activePortfolioAccountType, marketIndicators.usdkrw]);

  const rebalCatDonutData = useMemo(() => {
    const ORDER = ['주식', '주식-a', '채권', '금', '배당주식', '리츠', '현금', '예수금', 'FUND'];
    const catMap: Record<string, { value: number; ratio: number }> = {};
    rebalanceData.forEach(item => {
      const cat = (item.category as string) || '기타';
      if (!catMap[cat]) catMap[cat] = { value: 0, ratio: 0 };
      catMap[cat].value += item.expEval;
      catMap[cat].ratio += item.expRatio;
    });
    return Object.entries(catMap)
      .map(([name, { value, ratio }]) => ({ name, value, ratio }))
      .filter(x => x.value > 0 && x.ratio >= 0.05)
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.value - a.value;
      });
  }, [rebalanceData]);

  const curCatDonutData = useMemo(() => {
    const ORDER = ['주식', '주식-a', '채권', '금', '배당주식', '리츠', '현금', '예수금', 'FUND'];
    return Object.entries(totals.cats)
      .map(([name, val]: [string, any]) => ({ name, value: val.eval }))
      .filter(x => x.value > 0)
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.value - a.value;
      });
  }, [totals.cats]);

  // ── 통합 대시보드 계산 ──
  // 각 포트폴리오의 요약 계산 (active는 현재 state, 나머지는 저장된 데이터 사용)
  const portfolioSummaries = useMemo(() => {
    return portfolios.map(p => {
      const isActive = p.id === activePortfolioId;
      const startDate = isActive ? portfolioStartDate : (p.startDate || p.portfolioStartDate || '');
      const name = isActive ? title : p.name;
      const days = startDate ? (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24) : 0;

      // 직접입력형 계좌: evalAmount와 principal을 직접 사용
      if (p.accountType === 'simple') {
        const evalAmount = cleanNum(p.evalAmount) || 0;
        const prin = cleanNum(p.principal) || 0;
        const returnRate = prin > 0 ? (evalAmount - prin) / prin * 100 : 0;
        const cagr = prin > 0 && evalAmount > 0 && days > 0
          ? days < 365 ? (evalAmount / prin - 1) * 100 : (Math.pow(evalAmount / prin, 365.25 / days) - 1) * 100
          : 0;
        return { id: p.id, name, startDate, currentEval: evalAmount, principal: prin, depositAmount: 0, returnRate, cagr, cats: {}, isActive: false, accountType: 'simple', rowColor: p.rowColor || '', memo: p.memo || '' };
      }

      const items = isActive ? portfolio : (p.portfolio || []);
      const prin = isActive ? principal : (p.principal || 0);
      const summaryFxRate = p.accountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
      let totalEval = 0, depositAmt = 0;
      const cats = {};
      items.forEach(item => {
        if (item.type === 'deposit') {
          const v = cleanNum(item.depositAmount) * summaryFxRate;
          totalEval += v; depositAmt += v;
          cats['예수금'] = (cats['예수금'] || 0) + v;
        } else if (item.type === 'fund') {
          const qty = cleanNum(item.quantity);
          const price = cleanNum(item.currentPrice);
          const evl = qty > 0 && price > 0 ? qty * price * summaryFxRate : cleanNum(item.evalAmount) * summaryFxRate;
          totalEval += evl;
          cats['FUND'] = (cats['FUND'] || 0) + evl;
        } else {
          const evl = cleanNum(item.currentPrice) * cleanNum(item.quantity) * summaryFxRate;
          totalEval += evl;
          const cat = item.category || '미지정';
          cats[cat] = (cats[cat] || 0) + evl;
        }
      });
      const returnRate = prin > 0 ? (totalEval - prin) / prin * 100 : 0;
      const cagr = prin > 0 && totalEval > 0 && days > 0
        ? days < 365
          ? (totalEval / prin - 1) * 100
          : (Math.pow(totalEval / prin, 365.25 / days) - 1) * 100
        : 0;
      return { id: p.id, name, startDate, currentEval: totalEval, principal: prin, depositAmount: depositAmt, returnRate, cagr, cats, isActive, accountType: 'portfolio', rowColor: p.rowColor || '', memo: p.memo || '' };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios, activePortfolioId, portfolio, principal, portfolioStartDate, title, marketIndicators.usdkrw]);

  const intTotals = useMemo(() => {
    let totalEval = 0, totalPrincipal = 0, totalDeposit = 0;
    const cats = {};
    portfolioSummaries.forEach(s => {
      totalEval += s.currentEval;
      totalPrincipal += s.principal;
      totalDeposit += s.depositAmount;
      Object.entries(s.cats).forEach(([cat, val]) => {
        cats[cat] = (cats[cat] || 0) + val;
      });
    });
    const returnRate = totalPrincipal > 0 ? (totalEval - totalPrincipal) / totalPrincipal * 100 : 0;
    return { totalEval, totalPrincipal, totalDeposit, cats, returnRate };
  }, [portfolioSummaries]);

  const intSortedHistory = useMemo(() =>
    [...intHistory].sort((a, b) => new Date(a.date) - new Date(b.date)),
    [intHistory]);

  const intUnifiedDates = useMemo(() =>
    Array.from(new Set(intHistory.map(h => h.date))).sort(),
    [intHistory]);

  const intFilteredDates = useMemo(() => {
    if (!intAppliedRange.start || !intAppliedRange.end) return intUnifiedDates;
    return intUnifiedDates.filter(d => d >= intAppliedRange.start && d <= intAppliedRange.end);
  }, [intUnifiedDates, intAppliedRange]);

  const intChartData = useMemo(() => {
    if (intSortedHistory.length === 0) return [];
    const filtered = intFilteredDates.length > 0
      ? intSortedHistory.filter(h => intFilteredDates.includes(h.date))
      : intSortedHistory;
    if (filtered.length === 0) return [];
    const baseEval = filtered[0].evalAmount;
    const totalPrincipal = intTotals.totalPrincipal;
    return filtered.map(h => ({
      date: h.date,
      evalAmount: h.evalAmount,
      costAmount: totalPrincipal,
      returnRate: intIsZeroBaseMode
        ? (baseEval > 0 ? ((h.evalAmount / baseEval) - 1) * 100 : 0)
        : (totalPrincipal > 0 ? ((h.evalAmount - totalPrincipal) / totalPrincipal * 100) : 0),
    }));
  }, [intSortedHistory, intFilteredDates, intIsZeroBaseMode, intTotals.totalPrincipal]);

  const intMonthlyHistory = useMemo(() => {
    const sortedDesc = [...intHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    return sortedDesc.map((h, i) => {
      const month = h.date.substring(0, 7);
      const monthRecords = intHistory.filter(r => r.date.startsWith(month));
      const monthStartRecord = monthRecords.length > 0 ? monthRecords.reduce((min, r) => r.date < min.date ? r : min) : null;
      const monthlyChange = (monthStartRecord && monthStartRecord.evalAmount > 0 && monthStartRecord.id !== h.id)
        ? ((h.evalAmount / monthStartRecord.evalAmount) - 1) * 100 : 0;
      const prevRecord = sortedDesc[i + 1];
      const dodChange = (prevRecord && prevRecord.evalAmount > 0)
        ? ((h.evalAmount / prevRecord.evalAmount) - 1) * 100 : 0;
      return { ...h, monthlyChange, dodChange };
    });
  }, [intHistory]);

  const intCatDonutData = useMemo(() => {
    const ORDER = ['주식', '주식-a', '채권', '금', '배당주식', '리츠', '현금', '예수금', 'FUND'];
    return Object.entries(intTotals.cats)
      .map(([name, value]) => ({ name, value }))
      .filter(x => x.value > 0)
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.name);
        const ib = ORDER.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.value - a.value;
      });
  }, [intTotals.cats]);

  const intHoldingsDonutData = useMemo(() => {
    const holdingsMap: Record<string, { value: number; cost: number; category: string }> = {};
    portfolios.forEach(p => {
      if (p.accountType === 'simple') return;
      const isActive = p.id === activePortfolioId;
      const items = isActive ? portfolio : (p.portfolio || []);
      const fxRate = p.accountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
      const isGold = p.accountType === 'gold';
      items.forEach(item => {
        if (item.type === 'deposit') {
          const v = cleanNum(item.depositAmount) * fxRate;
          if (v <= 0) return;
          const key = '예수금';
          if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category: '예수금' };
          holdingsMap[key].value += v;
          holdingsMap[key].cost += v;
        } else if (item.type === 'fund') {
          const qty = cleanNum(item.quantity);
          const price = cleanNum(item.currentPrice);
          const evl = qty > 0 && price > 0 ? qty * price * fxRate : cleanNum(item.evalAmount) * fxRate;
          if (evl <= 0) return;
          const cost = cleanNum(item.investAmount) * fxRate;
          const key = item.name || item.code || 'FUND';
          if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category: 'FUND' };
          holdingsMap[key].value += evl;
          holdingsMap[key].cost += cost;
        } else {
          const qty = cleanNum(item.quantity);
          const evl = cleanNum(item.currentPrice) * qty * fxRate;
          if (evl <= 0) return;
          const cost = cleanNum(item.purchasePrice) * qty * fxRate;
          const key = isGold ? 'KRX 금현물' : (item.name || item.code || '기타');
          const category = isGold ? '금' : (item.category || '미지정');
          if (!holdingsMap[key]) holdingsMap[key] = { value: 0, cost: 0, category };
          holdingsMap[key].value += evl;
          holdingsMap[key].cost += cost;
        }
      });
    });
    return Object.entries(holdingsMap)
      .map(([name, { value, cost, category }]) => ({ name, value, cost, category }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios, activePortfolioId, portfolio, marketIndicators.usdkrw]);

  const displayHistSliced = useMemo(() => sortedHistoryDesc.slice(0, historyLimit), [sortedHistoryDesc, historyLimit]);

  const depositWithSum = useMemo(() => {
    let runSum = 0;
    return [...depositHistory].reverse().map((h, i) => {
      runSum += cleanNum(h.amount);
      return { ...h, cumulative: runSum, originalIndex: depositHistory.length - 1 - i };
    }).reverse();
  }, [depositHistory]);

  const depositWithSum2 = useMemo(() => {
    let runSum = 0;
    return [...depositHistory2].reverse().map((h, i) => {
      runSum += cleanNum(h.amount);
      return { ...h, cumulative: runSum, originalIndex: depositHistory2.length - 1 - i };
    }).reverse();
  }, [depositHistory2]);

  const depositWithSumSorted = useMemo(() => {
    if (!depositSortConfig.key) return depositWithSum;
    return [...depositWithSum].sort((a, b) => {
      if (depositSortConfig.key === 'date') { const da = a.date ? new Date(a.date).getTime() : 0; const db = b.date ? new Date(b.date).getTime() : 0; return (da - db) * depositSortConfig.direction; }
      if (depositSortConfig.key === 'amount') { return (cleanNum(a.amount) - cleanNum(b.amount)) * depositSortConfig.direction; }
      return 0;
    });
  }, [depositWithSum, depositSortConfig]);

  const depositWithSum2Sorted = useMemo(() => {
    if (!depositSortConfig2.key) return depositWithSum2;
    return [...depositWithSum2].sort((a, b) => {
      if (depositSortConfig2.key === 'date') { const da = a.date ? new Date(a.date).getTime() : 0; const db = b.date ? new Date(b.date).getTime() : 0; return (da - db) * depositSortConfig2.direction; }
      if (depositSortConfig2.key === 'amount') { return (cleanNum(a.amount) - cleanNum(b.amount)) * depositSortConfig2.direction; }
      return 0;
    });
  }, [depositWithSum2, depositSortConfig2]);

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

  const handleRebalanceSort = (key) => setRebalanceSortConfig(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));
  const handleDepositSort = (key) => setDepositSortConfig(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));
  const handleDepositSort2 = (key) => setDepositSortConfig2(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));
  const handleUpdate = (id, field, value) => setPortfolio(prev => prev.map(p => p.id === id ? { ...p, [field]: ['category', 'name', 'code', 'assetClass'].includes(field) ? value : cleanNum(value) } : p));
  const handleDeleteStock = (id) => setPortfolio(prev => prev.filter(p => p.id !== id));
  const handleAddStock = () => setPortfolio([{ id: generateId(), type: 'stock', category: "주식", assetClass: 'D', code: "", name: "", currentPrice: 0, changeRate: 0, purchasePrice: 0, quantity: 0, targetRatio: 0, isManual: true }, ...portfolio]);
  const handleAddFund = () => setPortfolio(prev => {
    const lastFundIdx = prev.reduceRight((acc, p, i) => acc === -1 && p.type === 'fund' ? i : acc, -1);
    const depositIdx = prev.findIndex(p => p.type === 'deposit');
    const insertIdx = lastFundIdx >= 0 ? lastFundIdx + 1 : (depositIdx >= 0 ? depositIdx + 1 : prev.length);
    const newFund = { id: generateId(), type: 'fund', category: 'FUND', assetClass: 'S', code: '', name: '', currentPrice: 0, changeRate: 0, investAmount: 0, evalAmount: 0, targetRatio: 0, isManual: true };
    return [...prev.slice(0, insertIdx), newFund, ...prev.slice(insertIdx)];
  });
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

  const COMP_STOCK_EXTRA_COLORS = ['#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#64748b', '#e11d48'];

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

  const refreshPrices = async () => {
    setIsLoading(true);
    setIndexFetchStatus({
      kospi: { status: 'loading' },
      sp500: { status: 'loading' },
      nasdaq: { status: 'loading' }
    });

    // portfolioRef로 항상 최신 portfolio를 안전하게 읽기
    const currentPortfolio = portfolioRef.current;

    const stockCodes = currentPortfolio.filter(p => p.type === 'stock' && p.code).map(p => p.code);
    const loadingStatus = {};
    stockCodes.forEach(c => { loadingStatus[c] = 'loading'; });
    setStockFetchStatus(prev => ({ ...prev, ...loadingStatus }));

    try {
      const today = new Date().toISOString().split('T')[0];
      const isOverseasRefresh = activePortfolioAccountTypeRef.current === 'overseas';

      // 종목별 현재가 조회 결과를 Map으로 수집
      const priceResults = {};
      await Promise.all(stockCodes.map(async (code) => {
        const d = isOverseasRefresh ? await fetchUsStockInfo(code) : await fetchStockInfo(code);
        if (d) {
          setStockFetchStatus(prev => ({ ...prev, [code]: 'success' }));
          setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
          priceResults[code] = d;
        } else {
          setStockFetchStatus(prev => ({ ...prev, [code]: 'fail' }));
        }
      }));

      // ① 포트폴리오 테이블 최신가 즉시 반영 (상단 표시값 - 과거 데이터 조회 전에 먼저 업데이트)
      setPortfolio(prev => prev.map(item => {
        if (item.type === 'stock' && item.code && priceResults[item.code]) {
          const d = priceResults[item.code];
          return { ...item, name: d.name, currentPrice: d.price, changeRate: d.changeRate };
        }
        return item;
      }));

      // ② 그래프용 과거 데이터: 충분한 이력이 없는 종목만 백그라운드로 조회 (상단 값에 영향 없음)
      const codesNeedingHistory = stockCodes.filter(code => {
        const existing = stockHistoryMapRef.current[code];
        return !existing || Object.keys(existing).length <= 3;
      });
      if (codesNeedingHistory.length > 0) {
        Promise.all(codesNeedingHistory.map(async (code) => {
          if (isOverseasRefresh) {
            const r = await fetchUsStockHistory(code);
            if (r?.data && Object.keys(r.data).length > 1) {
              setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...r.data } }));
            }
          } else {
            let hist: Record<string, number> | null = null;
            const rKIS = await fetchKISStockHistory(code);
            if (rKIS) hist = rKIS.data;
            if (!hist) { const rNaver = await fetchNaverStockHistory(code); if (rNaver) hist = rNaver.data; }
            if (!hist) { const r1 = await fetchIndexData(`${code}.KS`); if (r1) hist = r1.data; }
            if (!hist) { const r2 = await fetchIndexData(`${code}.KQ`); if (r2) hist = r2.data; }
            if (hist) {
              setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...hist } }));
            }
          }
        })).then(() => {
          // 백그라운드 과거 데이터 수집 완료 후 Drive 백업 (페이지 재시작 시 재수집 방지)
          setTimeout(() => {
            const snap = saveStateRef.current;
            if (snap && driveTokenRef.current) saveAllToDrive(snap);
          }, 600);
        });
        // await 없이 fire-and-forget: 과거 데이터는 백그라운드에서 로드되며 완료 시 그래프 자동 갱신
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

      // KOSPI 네이버 폴백 (비동기라 setMarketIndices 밖에서 처리)
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

        const hasFail = [kResult.status, sResult.status, nResult.status].some(s => s?.status === 'fail');
      
        if (!hasFail) {
        }

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
    }
  };

  const handleImportHistoryJSON = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        const fileName = file.name;
        const ext = fileName.split('.').pop().toLowerCase();

        if (ext === 'csv') {
          const parsedData = parseIndexCSV(content, fileName);
          if (!parsedData || Object.keys(parsedData).length === 0) {
            showToast(`${fileName}: CSV 파싱 실패 (지원 형식: 네이버증권/investing.com/stooq)`, true);
            return;
          }
          const detectedIndex = detectIndexFromFileName(fileName);
          if (detectedIndex === 'kospi') {
            setMarketIndices(prev => ({ ...prev, kospi: { ...(prev.kospi || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, kospi: buildIndexStatus({ ...(marketIndices.kospi || {}), ...parsedData }, 'CSV 업로드') }));
          } else if (detectedIndex === 'sp500') {
            setMarketIndices(prev => ({ ...prev, sp500: { ...(prev.sp500 || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, sp500: buildIndexStatus({ ...(marketIndices.sp500 || {}), ...parsedData }, 'CSV 업로드') }));
          } else if (detectedIndex === 'nasdaq') {
            setMarketIndices(prev => ({ ...prev, nasdaq: { ...(prev.nasdaq || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, nasdaq: buildIndexStatus({ ...(marketIndices.nasdaq || {}), ...parsedData }, 'CSV 업로드') }));
          } else {
            const codeMatch = fileName.match(/([A-Z0-9]{4,6})/);
            const code = codeMatch ? codeMatch[1] : fileName.replace('.csv', '');
            setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...parsedData } }));
          }
          return;
        }

        try {
          const raw = JSON.parse(content);
          const rawArr = Array.isArray(raw) ? raw : (raw.data && Array.isArray(raw.data) ? raw.data : null);
          if (rawArr) {
            const upperFN = fileName.toUpperCase();
            const detectMarketKey = (fn) => {
              if (fn.includes('GOLD_INTL')) return 'GOLD_INTL';
              if (fn.includes('GOLD_KRX') || fn.includes('GOLD_KR') || fn.includes('KRX_GOLD')) return 'GOLD_KR';
              if (fn.includes('FED_RATE')) return 'FED_RATE';
              if (fn.includes('USD_KRW')) return 'USD_KRW';
              if (fn.includes('US_10Y_BOND') || fn.includes('US10Y')) return 'US_10Y_BOND';
              if (fn.includes('NASDAQ100') || fn.includes('NASDAQ')) return 'NASDAQ100';
              if (fn.includes('SP500') || fn.includes('S&P500')) return 'SP500';
              if (fn.includes('KOSPI')) return 'KOSPI';
              if (fn.includes('VIX')) return 'VIX_INDEX';
              if (fn.includes('DXY')) return 'DXY';
              if (fn.includes('KR10Y') || fn.includes('KR_10Y')) return 'KR10Y';
              if (fn.includes('BTC')) return 'BTC';
              if (fn.includes('ETH')) return 'ETH';
              return null;
            };
            const marketKey = detectMarketKey(upperFN);

            let code = "";
            if (marketKey) {
              code = marketKey;
            } else {
              const exactMatch = fileName.match(/STOCK_([a-zA-Z0-9]+)_/i);
              if (exactMatch?.[1]) code = exactMatch[1];
              else { const fm = fileName.match(/[0-9]{5}[A-Za-z0-9]|[0-9]{6}/); code = fm ? fm[0] : (fileName.match(/[a-zA-Z0-9]{4,6}/)?.[0] ?? ""); }
            }

            const formattedData = {};
            rawArr.forEach(item => {
              const dateStr = item.Date ?? item.date ?? item.index ?? item.INDEX;
              const v = item.Close ?? item.Value ?? item.close ?? item.value ?? (() => {
                const skip = ['Date', 'date', 'index', 'INDEX'];
                const key = Object.keys(item).find(k => !skip.includes(k) && typeof item[k] === 'number');
                return key ? item[key] : undefined;
              })();
              if (dateStr && v != null && v > 0) {
                const d = dateStr.substring(0, 10);
                if (d !== '1970-01-01') formattedData[d] = v;
              }
            });

            if (Object.keys(formattedData).length === 0) {
              showToast(`${fileName}: 유효 데이터 없음 (날짜/값 확인 필요)`, true);
              return;
            }

            const getLatestChg = (data) => {
              const dates = Object.keys(data).sort();
              const latest = data[dates[dates.length - 1]];
              const prev = dates.length >= 2 ? data[dates[dates.length - 2]] : null;
              const chg = (prev && prev > 0) ? ((latest / prev) - 1) * 100 : null;
              return { latest, chg, count: dates.length };
            };

            if (Object.keys(formattedData).length > 0 && code) {
              const cu = code.toUpperCase();

              if (['KS11', 'KOSPI'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, kospi: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, kospi: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, kospiPrice: latest, kospiChg: chg }));
              } else if (['US500', 'GSPC', 'SPX', 'S&P500', 'SP500'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, sp500: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, sp500: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, sp500Price: latest, sp500Chg: chg }));
              } else if (['NDX', 'IXIC', 'NASDAQ', 'NASDAQ100'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, nasdaq: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, nasdaq: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, nasdaqPrice: latest, nasdaqChg: chg }));
              } else if (cu === 'GOLD_INTL') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, goldIntl: latest, goldIntlChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, goldIntl: formattedData }));
              } else if (cu === 'GOLD_KR' || cu === 'GOLD_KRX') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, goldKr: latest, goldKrChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, goldKr: formattedData }));
              } else if (cu === 'USD_KRW') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, usdkrw: latest, usdkrwChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, usdkrw: formattedData }));
              } else if (cu === 'US_10Y_BOND') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, us10y: latest, us10yChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, us10y: formattedData }));
              } else if (cu === 'FED_RATE') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, fedRate: latest, fedRateChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, fedRate: formattedData }));
              } else if (cu === 'VIX_INDEX') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, vix: latest, vixChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, vix: formattedData }));
              } else if (cu === 'DXY') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, dxy: latest, dxyChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, dxy: formattedData }));
              } else if (cu === 'KR10Y') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, kr10y: latest, kr10yChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, kr10y: formattedData }));
              } else if (cu === 'BTC') {
                const { latest, chg } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, btc: latest, btcChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, btc: { ...(prev.btc || {}), ...formattedData } }));
              } else if (cu === 'ETH') {
                const { latest, chg } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, eth: latest, ethChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, eth: { ...(prev.eth || {}), ...formattedData } }));
              } else {
                setStockHistoryMap(prev => ({ ...prev, [code]: formattedData }));
              }
            }
          }
        } catch (err) { showToast(`${fileName} 파싱 실패`, true); }
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  const handleSave = () => {
    const currentPortfolios = buildPortfoliosState();
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, lookupRows, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, indicatorScales, backtestColor, showBacktest }, intHistory };
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

  const handleDriveSave = () => {
    const currentPortfolios = buildPortfoliosState();
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, lookupRows, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, indicatorScales, backtestColor, showBacktest }, intHistory };
    if (driveTokenRef.current) {
      saveAllToDrive(state, 'manual'); // 수동 저장 → 타임스탬프 백업 포함
    } else {
      showToast('☁️ Drive 미연결 — 먼저 Drive를 연결해 주세요', true);
    }
  };

  const handleDownloadCSV = () => {
    let csv = '\uFEFF일자,평가자산,전일대비 수익금,전일대비 수익률\n';
    const sh = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
    sh.forEach((h, i) => {
      const prev = sh[i + 1];
      const dodProfit = prev ? h.evalAmount - prev.evalAmount : 0;
      const dodRate = (prev && prev.evalAmount > 0) ? ((h.evalAmount / prev.evalAmount) - 1) * 100 : 0;
      csv += `${h.date},${h.evalAmount},${dodProfit},${dodRate.toFixed(2)}%\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `ISA_자산추이_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  const handleLookupDownloadCSV = () => {
    const modeText = comparisonMode === 'latestOverPast' ? '(현재/과거)-1 (%)' : '1- (과거/현재) (%)';
    let csv = `\uFEFF일자,평가자산,${modeText}\n`;
    const currentTotalEval = totals.totalEval;
    const validRecords = lookupRows.map(r => history.find(h => h.date === r.date)).filter(Boolean);
    let oldestEval = 0;
    if (validRecords.length > 0) oldestEval = validRecords.reduce((min, curr) => new Date(curr.date) < new Date(min.date) ? curr : min).evalAmount;
    [...lookupRows].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(row => {
      const rec = history.find(h => h.date === row.date);
      if (rec) {
        const pastEval = rec.evalAmount;
        let compareRate = comparisonMode === 'latestOverPast'
          ? (oldestEval > 0 ? ((pastEval / oldestEval) - 1) * 100 : 0)
          : (currentTotalEval > 0 ? (1 - (pastEval / currentTotalEval)) * 100 : 0);
        csv += `${row.date},${pastEval},${compareRate.toFixed(2)}%\n`;
      } else { csv += `${row.date},기록 없음,-\n`; }
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `ISA_지정일비교_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  const handleDepositDownloadCSV = () => {
    let csv = '\uFEFF일자,금액,합계,메모\n';
    depositWithSum.forEach(h => { csv += `${h.date},${cleanNum(h.amount)},${cleanNum(h.cumulative)},${h.memo || ''}\n`; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `입금내역_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  const handleWithdrawDownloadCSV = () => {
    let csv = '\uFEFF일자,금액,합계,메모\n';
    depositWithSum2.forEach(h => { csv += `${h.date},${cleanNum(h.amount)},${cleanNum(h.cumulative)},${h.memo || ''}\n`; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `출금내역_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  const calculateSelection = (left, right) => {
    if (!left || !right) return null;
    const idx1 = finalChartData.findIndex(d => d.date === left);
    const idx2 = finalChartData.findIndex(d => d.date === right);
    if (idx1 === -1 || idx2 === -1 || idx1 === idx2) return null;
    const sData = finalChartData[Math.min(idx1, idx2)];
    const eData = finalChartData[Math.max(idx1, idx2)];
    const profit = eData.evalAmount - sData.evalAmount;
    const rate = sData.evalAmount > 0 ? (profit / sData.evalAmount) * 100 : 0;
    const indPeriodRates = {};
    INDICATOR_CHART_KEYS.forEach(k => {
      const sp = sData[`${k}Point`]; const ep = eData[`${k}Point`];
      indPeriodRates[`${k}PeriodRate`] = (sp > 0 && ep != null) ? ((ep / sp) - 1) * 100 : null;
    });
    const backtestPeriodRate = (sData.backtestRate != null && eData.backtestRate != null)
      ? ((100 + eData.backtestRate) / (100 + sData.backtestRate) - 1) * 100
      : null;
    return {
      startDate: sData.date, endDate: eData.date, profit, rate,
      kospiPeriodRate: sData.kospiPoint > 0 ? ((eData.kospiPoint / sData.kospiPoint) - 1) * 100 : null,
      sp500PeriodRate: sData.sp500Point > 0 ? ((eData.sp500Point / sData.sp500Point) - 1) * 100 : null,
      nasdaqPeriodRate: sData.nasdaqPoint > 0 ? ((eData.nasdaqPoint / sData.nasdaqPoint) - 1) * 100 : null,
      backtestPeriodRate,
      ...Object.fromEntries(compStocks.map((_, ci) => {
        const pk = `comp${ci + 1}Point`;
        return [`comp${ci + 1}PeriodRate`, (sData[pk] > 0 && eData[pk] != null) ? ((eData[pk] / sData[pk]) - 1) * 100 : null];
      })),
      ...indPeriodRates
    };
  };

  const handleChartMouseDown = (e) => { if (e?.activeLabel) { setIsDragging(true); setRefAreaLeft(e.activeLabel); setRefAreaRight(''); setSelectionResult(null); } };
  const handleChartMouseMove = (e) => {
    if (isDragging && refAreaLeft && e?.activeLabel) { setRefAreaRight(e.activeLabel); setSelectionResult(calculateSelection(refAreaLeft, e.activeLabel)); }
    if (e?.activeLabel && e?.activePayload?.length) setHoveredPoint({ label: e.activeLabel, payload: e.activePayload });
  };
  const handleChartMouseUp = () => { setIsDragging(false); if (refAreaLeft && refAreaRight && refAreaLeft !== refAreaRight) setSelectionResult(calculateSelection(refAreaLeft, refAreaRight)); else { setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); } };
  const handleChartMouseLeave = () => { handleChartMouseUp(); setHoveredPoint(null); };
  const handleSearchClick = () => { setChartPeriod('custom'); setAppliedRange({ start: dateRange.start, end: dateRange.end }); };


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

  // 1단계: 로그인 후 사용자별 localStorage에서 복원 (step 2 내부에서 처리)

  // 2단계: 로그인 완료 후 사용자별 localStorage 복원 + Drive 초기화 + 시장 데이터 수집
  useEffect(() => {
    if (!authUser) return;

    const token = authUser.token;
    const userKey = `portfolioState_v5_${authUser.email}`;
    const stockKey = `portfolioStockData_v5_${authUser.email}`;
    const marketKey = `portfolioMarketData_v5_${authUser.email}`;

    // 사용자별 localStorage에서 복원 (Drive와 동일하게 3개 키로 분리)
    let hasLocalData = false;
    let localUpdatedAt = 0;
    let localPortfolioUpdatedAt = 0; // 가격갱신과 구분된 계좌구조 변경 시각
    let localPortfoliosCount = 0;
    const saved = localStorage.getItem(userKey);
    if (saved) {
      try {
        const data = JSON.parse(saved);

        // 포트폴리오 데이터 로드 (새 형식 우선, 구 형식 마이그레이션)
        // 구버전 호환: 통합 키에 stockHistoryMap이 있으면 사용 (신버전은 별도 키 사용)
        setStockHistoryMap(data.stockHistoryMap || {});
        if (data.portfolios?.length > 0) {
          setPortfolios(data.portfolios);
          const activeId = data.activePortfolioId || data.portfolios[0].id;
          setActivePortfolioId(activeId);
          const active = data.portfolios.find(p => p.id === activeId) || data.portfolios[0];
          setTitle(active.name || '포트폴리오');
          setPortfolio(active.portfolio || []);
          setPrincipal(active.principal || 0);
          setHistory(active.history || []);
          setDepositHistory(active.depositHistory || []);
          if (active.depositHistory2) setDepositHistory2(active.depositHistory2);
          setPortfolioStartDate(active.startDate || active.portfolioStartDate || '');
          setSettings(active.settings || { mode: 'rebalance', amount: 1000000 });
        } else if (data.portfolio) {
          // 구 형식 마이그레이션
          const newId = generateId();
          const startDate = data.portfolioStartDate || data.history?.[0]?.date || '';
          const migrated = {
            id: newId,
            name: data.title || 'DC',
            startDate,
            portfolioStartDate: startDate,
            portfolio: data.portfolio || [],
            principal: cleanNum(data.principal),
            history: data.history || [],
            depositHistory: data.depositHistory || [],
            depositHistory2: data.depositHistory2 || [],
            settings: data.settings || { mode: 'rebalance', amount: 1000000 },
          };
          setPortfolios([migrated]);
          setActivePortfolioId(newId);
          setTitle(data.title || '포트폴리오');
          setPortfolio(data.portfolio || []);
          setPrincipal(cleanNum(data.principal));
          setHistory(data.history || []);
          setDepositHistory(data.depositHistory || []);
          if (data.depositHistory2) setDepositHistory2(data.depositHistory2);
          setPortfolioStartDate(startDate);
          setSettings(data.settings || { mode: 'rebalance', amount: 1000000 });
        }

        setCustomLinks(data.customLinks || UI_CONFIG.DEFAULT_LINKS);
        if (data.overseasLinks) setOverseasLinks(data.overseasLinks);
        setLookupRows(data.lookupRows || []);
        setCompStocks(data.compStocks || defaultCompStocks);
        if (data.adminAccessAllowed !== undefined) setAdminAccessAllowed(data.adminAccessAllowed);
        if (data.marketIndices) {
          setMarketIndices(data.marketIndices);
          setIndexFetchStatus({
            kospi: data.marketIndices.kospi ? buildIndexStatus(data.marketIndices.kospi, 'localStorage') : null,
            sp500: data.marketIndices.sp500 ? buildIndexStatus(data.marketIndices.sp500, 'localStorage') : null,
            nasdaq: data.marketIndices.nasdaq ? buildIndexStatus(data.marketIndices.nasdaq, 'localStorage') : null,
          });
        }
        if (data.chartPrefs) {
          if (data.chartPrefs.showKospi !== undefined) setShowKospi(data.chartPrefs.showKospi);
          if (data.chartPrefs.showSp500 !== undefined) setShowSp500(data.chartPrefs.showSp500);
          if (data.chartPrefs.showNasdaq !== undefined) setShowNasdaq(data.chartPrefs.showNasdaq);
          if (data.chartPrefs.isZeroBaseMode !== undefined) setIsZeroBaseMode(data.chartPrefs.isZeroBaseMode);
          if (data.chartPrefs.showTotalEval !== undefined) setShowTotalEval(data.chartPrefs.showTotalEval);
          if (data.chartPrefs.showReturnRate !== undefined) setShowReturnRate(data.chartPrefs.showReturnRate);
          if (data.chartPrefs.accountChartStates) accountChartStatesRef.current = data.chartPrefs.accountChartStates;
          if (data.chartPrefs.showMarketPanel !== undefined) setShowMarketPanel(data.chartPrefs.showMarketPanel);
          if (data.chartPrefs.hideAmounts !== undefined) setHideAmounts(data.chartPrefs.hideAmounts);
          if (data.chartPrefs.showIndicatorsInChart) setShowIndicatorsInChart(data.chartPrefs.showIndicatorsInChart);
          if (data.chartPrefs.goldIndicators) setGoldIndicators(data.chartPrefs.goldIndicators);
          if (data.chartPrefs.indicatorScales) setIndicatorScales(data.chartPrefs.indicatorScales);
          if (data.chartPrefs.backtestColor) setBacktestColor(data.chartPrefs.backtestColor);
          if (data.chartPrefs.showBacktest !== undefined) setShowBacktest(data.chartPrefs.showBacktest);
        }
        if (data.marketIndicators) setMarketIndicators(data.marketIndicators);
        if (data.indicatorHistoryMap) setIndicatorHistoryMap(data.indicatorHistoryMap);
        if (data.intHistory) setIntHistory(data.intHistory);
        localUpdatedAt = data.portfolioUpdatedAt || data.updatedAt || 0;
        localPortfolioUpdatedAt = data.portfolioUpdatedAt || 0;
        localPortfoliosCount = data.portfolios?.length || 0;
        hasLocalData = true;
      } catch (e) {}
    }

    // 분리 저장된 종목 이력 로드 (신버전 별도 키, 통합 키보다 우선)
    const savedStock = localStorage.getItem(stockKey);
    if (savedStock) {
      try {
        const stockData = JSON.parse(savedStock);
        if (stockData.stockHistoryMap && Object.keys(stockData.stockHistoryMap).length > 0)
          setStockHistoryMap(stockData.stockHistoryMap);
      } catch {}
    }

    // 분리 저장된 시장 데이터 로드 (신버전 별도 키, 통합 키보다 우선)
    const savedMarket = localStorage.getItem(marketKey);
    if (savedMarket) {
      try {
        const marketData = JSON.parse(savedMarket);
        if (marketData.marketIndices) {
          setMarketIndices(marketData.marketIndices);
          setIndexFetchStatus({
            kospi: marketData.marketIndices.kospi ? buildIndexStatus(marketData.marketIndices.kospi, 'localStorage') : null,
            sp500: marketData.marketIndices.sp500 ? buildIndexStatus(marketData.marketIndices.sp500, 'localStorage') : null,
            nasdaq: marketData.marketIndices.nasdaq ? buildIndexStatus(marketData.marketIndices.nasdaq, 'localStorage') : null,
          });
        }
        if (marketData.marketIndicators) setMarketIndicators(marketData.marketIndicators);
        if (marketData.indicatorHistoryMap) setIndicatorHistoryMap(marketData.indicatorHistoryMap);
      } catch {}
    }

    // Drive 토큰 설정
    driveTokenRef.current = token;
    setDriveToken(token);
    setDriveStatus('');

    const bgTimer = setTimeout(async () => {
      initTokenClient();

      let usedDriveData = false;

      if (!hasLocalData) {
        // localStorage 없음 → Drive에서 불러오거나 신규 생성
        const drivePortfolio = await loadFromDrive(token);
        if (drivePortfolio !== null) {
          // Drive에 데이터가 존재 (빈 포트폴리오, simple 계좌 포함 모두 처리)
          usedDriveData = true;
          await new Promise(r => setTimeout(r, 600));
        } else {
          // 완전 신규 사용자: 초기 포트폴리오 생성
          const newId = generateId();
          const today = new Date().toISOString().split('T')[0];
          const initP = { id: newId, name: '내 포트폴리오', startDate: today, portfolioStartDate: today, portfolio: [{ id: generateId(), type: 'deposit', depositAmount: 0 }], principal: 0, history: [], depositHistory: [], depositHistory2: [], settings: { mode: 'rebalance', amount: 1000000 } };
          setPortfolios([initP]);
          setActivePortfolioId(newId);
          setTitle(initP.name);
          setPortfolio(initP.portfolio);
          setPrincipal(0);
          setPortfolioStartDate(today);
        }
      } else {
        // localStorage가 있어도 Drive를 우선 확인 → 다른 기기의 최신 계좌 구조를 항상 반영
        // 핵심: portfolioUpdatedAt(계좌 구조 변경 시각)만 비교 — updatedAt(가격 갱신 포함)은 사용 안함
        // 로컬의 portfolioUpdatedAt이 명확히 더 최신일 때만 로컬 유지 (그 외 모두 Drive 우선)
        try {
          const checkFolderId = await ensureDriveFolder(token);
          const driveRaw = await loadDriveFile(token, checkFolderId, DRIVE_FILES.STATE) as any;
          if (driveRaw) {
            const drivePortfolioTs = driveRaw.portfolioUpdatedAt || 0;
            // 로컬이 명확히 최신인 경우: 둘 다 0이 아니고 로컬이 더 큰 값
            const keepLocal = localPortfolioUpdatedAt > 0 && drivePortfolioTs > 0 && localPortfolioUpdatedAt > drivePortfolioTs;
            if (!keepLocal) {
              await loadFromDrive(token);
              usedDriveData = true;
            }
          }
        } catch {
          // Drive 접근 실패 → localStorage 유지
        }
      }

      // 시장지표 백그라운드 수집, 종목 현재가 갱신
      fetchMarketIndicators();
      const portfolioToRefresh = portfolioRef.current;
      if (portfolioToRefresh.length > 0) {
        await autoRefreshStockPrices(portfolioToRefresh);
      }

      // 조회 완료 후 자동저장 활성화
      // Drive에서 이미 로드했으면 현재 상태 그대로 유지, localStorage 기준이면 Drive에 백업
      setTimeout(() => {
        isInitialLoad.current = false;
        if (!usedDriveData) {
          const snap = saveStateRef.current;
          if (snap && snap.portfolios?.length > 0 && driveTokenRef.current) {
            saveAllToDrive(snap);
          }
        }
      }, 1000);
    }, 400);

    return () => clearTimeout(bgTimer);
  }, [authUser]);

  // 20분(1,200,000ms)마다 자동으로 현재가 + 시장지표 갱신 후 Drive 백업
  useEffect(() => {
    const AUTO_REFRESH_INTERVAL = 20 * 60 * 1000; // 20분
    const intervalId = setInterval(async () => {
      // portfolio가 있을 때만 실행
      if (portfolioRef.current.length > 0 && portfolioRef.current.some(p => p.type === 'stock' && p.code)) {
        console.log('[자동갱신] 20분 주기 현재가 + 시장지표 갱신 시작');
        fetchMarketIndicators();
        await refreshPrices();
        // 갱신 완료 후 3초 대기 (React 상태 업데이트 반영) → Drive 자동저장
        setTimeout(() => {
          const snap = saveStateRef.current;
          if (snap && snap.portfolios?.length > 0) {
            console.log('[자동저장] 20분 주기 Drive 백업');
            saveAllToDrive(snap, 'auto'); // 20분 자동저장 백업
          }
        }, 3000);
      }
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (portfolios.length === 0) return;
    if (!authUser?.email) return;
    const currentPortfolios = portfolios.map(p =>
      p.id === activePortfolioId
        ? { ...p, name: title, portfolio, principal, history, depositHistory, depositHistory2, startDate: portfolioStartDate, portfolioStartDate, settings }
        : p
    );
    // 계좌/종목 구조만 비교 — history(일일 평가액)·시장 데이터는 제외하여
    // 시장가격 갱신이 portfolioUpdatedAt을 덮어쓰지 않도록 방지
    // compStocks(비교종목 추가/활성화)도 구조 변경으로 간주 → Drive STATE 즉시 반영
    const portfolioStructureKey = JSON.stringify([
      currentPortfolios.map(p => ({
        id: p.id, name: p.name,
        startDate: p.startDate || p.portfolioStartDate,
        portfolio: p.portfolio, principal: p.principal,
        depositHistory: p.depositHistory, depositHistory2: p.depositHistory2,
        settings: p.settings,
      })),
      activePortfolioId, customLinks, lookupRows,
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
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, lookupRows, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, indicatorScales, backtestColor, showBacktest }, intHistory, updatedAt: Date.now(), portfolioUpdatedAt: portfolioUpdatedAtRef.current };
    saveStateRef.current = state;
    // localStorage를 Drive와 동일하게 3개 키로 분리 저장 (QuotaExceeded 방지)
    const stateEmail = adminViewingAsRef.current || authUser.email;
    const { stockHistoryMap: shm, marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm, ...stateCore } = state;
    try { localStorage.setItem(`portfolioState_v5_${stateEmail}`, JSON.stringify(stateCore)); } catch {}
    try {
      if (Object.keys(shm || {}).length > 0)
        localStorage.setItem(`portfolioStockData_v5_${stateEmail}`, JSON.stringify({ stockHistoryMap: shm }));
    } catch {}
    try {
      localStorage.setItem(`portfolioMarketData_v5_${stateEmail}`, JSON.stringify({ marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm }));
    } catch {}
    // 초기 로드 완료 후 Drive 자동저장 (2초 디바운스 — 포트폴리오 테이블 변경 시 2초 이내 백업)
    if (!isInitialLoad.current && driveTokenRef.current) {
      if (driveSaveTimerRef.current) clearTimeout(driveSaveTimerRef.current);
      driveSaveTimerRef.current = setTimeout(() => {
        saveAllToDrive(state);
      }, 2000);
    }
  }, [portfolios, activePortfolioId, title, portfolio, principal, history, depositHistory, depositHistory2, customLinks, overseasLinks, settings, lookupRows, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, portfolioStartDate, compStocks, showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, intHistory, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, indicatorScales, backtestColor, showBacktest]);

  useEffect(() => {
    if (totals.totalEval === 0) return;
    const today = new Date().toISOString().split('T')[0];
    setHistory(prev => {
      const newHist = [...prev];
      const idx = newHist.findIndex(h => h.date === today);
      if (idx >= 0) { if (newHist[idx].evalAmount === totals.totalEval) return prev; newHist[idx] = { ...newHist[idx], evalAmount: totals.totalEval, principal }; }
      else { newHist.push({ date: today, evalAmount: totals.totalEval, principal, isFixed: false }); }
      return newHist;
    });
  }, [totals.totalEval, principal]);

  useEffect(() => {
    if (unifiedDates.length === 0) return;
    const latest = unifiedDates[unifiedDates.length - 1];
    const earliest = unifiedDates[0];
    let newStart = latest;
    if (chartPeriod === '1w') { const d = new Date(latest); d.setDate(d.getDate() - 7); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '1m') { const d = new Date(latest); d.setMonth(d.getMonth() - 1); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '3m') { const d = new Date(latest); d.setMonth(d.getMonth() - 3); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '6m') { const d = new Date(latest); d.setMonth(d.getMonth() - 6); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '1y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 1); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '2y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 2); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '3y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 3); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '4y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 4); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '5y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 5); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '10y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 10); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === 'all') { newStart = earliest; }
    if (chartPeriod !== 'custom') {
      if (new Date(newStart) < new Date(earliest)) newStart = earliest;
      setDateRange({ start: newStart, end: latest }); setAppliedRange({ start: newStart, end: latest });
    }
  }, [chartPeriod, unifiedDates]);

  // 통합 대시보드 - 총 평가액 변경 시 오늘 기록 자동 업데이트
  useEffect(() => {
    if (intTotals.totalEval === 0) return;
    const today = new Date().toISOString().split('T')[0];
    setIntHistory(prev => {
      const idx = prev.findIndex(h => h.date === today);
      if (idx >= 0) {
        if (prev[idx].evalAmount === intTotals.totalEval) return prev;
        const newHist = [...prev];
        newHist[idx] = { ...newHist[idx], evalAmount: intTotals.totalEval };
        return newHist;
      }
      return [...prev, { id: generateId(), date: today, evalAmount: intTotals.totalEval }];
    });
  }, [intTotals.totalEval]);

  // 통합 대시보드 - 기간 버튼 변경 시 차트 범위 업데이트
  useEffect(() => {
    if (intUnifiedDates.length === 0) return;
    const latest = intUnifiedDates[intUnifiedDates.length - 1];
    const earliest = intUnifiedDates[0];
    let newStart = latest;
    if (intChartPeriod === '1m') { const d = new Date(latest); d.setMonth(d.getMonth() - 1); newStart = d.toISOString().split('T')[0]; }
    else if (intChartPeriod === '3m') { const d = new Date(latest); d.setMonth(d.getMonth() - 3); newStart = d.toISOString().split('T')[0]; }
    else if (intChartPeriod === '6m') { const d = new Date(latest); d.setMonth(d.getMonth() - 6); newStart = d.toISOString().split('T')[0]; }
    else if (intChartPeriod === '1y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 1); newStart = d.toISOString().split('T')[0]; }
    else if (intChartPeriod === '2y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 2); newStart = d.toISOString().split('T')[0]; }
    else if (intChartPeriod === '3y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 3); newStart = d.toISOString().split('T')[0]; }
    else if (intChartPeriod === '5y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 5); newStart = d.toISOString().split('T')[0]; }
    else if (intChartPeriod === 'all') { newStart = earliest; }
    if (intChartPeriod !== 'custom') {
      if (new Date(newStart) < new Date(earliest)) newStart = earliest;
      setIntDateRange({ start: newStart, end: latest });
      setIntAppliedRange({ start: newStart, end: latest });
    }
  }, [intChartPeriod, intUnifiedDates]);

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

  const StatusDot = ({ status }) => {
    if (!status) return <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block ml-1" title="미수집" />;
    if (status.status === 'loading') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-1 animate-pulse" title="수집중" />;
    if (status.status === 'success') return <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block ml-1" title={`수집완료 | ${status.latestDate} | ${status.count}건`} />;
    if (status.status === 'partial') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-1" title={`${status.source === '백업데이터' ? '백업데이터' : status.source} | ${status.latestDate} | ${status.count}건`} />;
    return <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block ml-1" title="수집실패" />;
  };

  const CompStockDot = ({ code }) => {
    const st = stockFetchStatus?.[code];
    if (!st) return null;
    if (st === 'success') return <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block ml-0.5" title="갱신 완료" />;
    if (st === 'fail') return <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block ml-0.5" title="갱신 실패" />;
    if (st === 'loading') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-0.5 animate-pulse" title="갱신 중" />;
    return null;
  };

  // ── 멀티 포트폴리오 관리 ──
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
    // 통합 대시보드에 머물기
  };

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

  const updatePortfolioStartDate = (id, date) => {
    if (id === activePortfolioId) setPortfolioStartDate(date);
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, startDate: date, portfolioStartDate: date } : p));
  };

  const updatePortfolioName = (id, name) => {
    if (id === activePortfolioId) setTitle(name);
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  };

  const updatePortfolioColor = (id, rowColor) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, rowColor } : p));
  };

  const resetAllPortfolioColors = () => {
    setPortfolios(prev => prev.map(p => ({ ...p, rowColor: '' })));
  };

  // 같은 accountType의 모든 계좌에 settings를 동기화
  const updateSettingsForType = (newSettings) => {
    setSettings(newSettings);
    const activePortfolio = portfolios.find(p => p.id === activePortfolioId);
    if (!activePortfolio) return;
    setPortfolios(prev => prev.map(p =>
      p.accountType === activePortfolio.accountType ? { ...p, settings: newSettings } : p
    ));
  };

  const hexToRgba = (hex, alpha) => {
    if (!hex || hex.length < 7) return null;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // 스티키 셀용: 반투명 색상 대신 dark bg와 블렌드한 불투명 색상 반환 (스크롤 시 뒤 내용이 비치는 현상 방지)
  const blendWithDarkBg = (hex: string, alpha: number, bgHex = '#1e293b'): string => {
    if (!hex || hex.length < 7) return bgHex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const bgR = parseInt(bgHex.slice(1, 3), 16);
    const bgG = parseInt(bgHex.slice(3, 5), 16);
    const bgB = parseInt(bgHex.slice(5, 7), 16);
    return `rgb(${Math.round(bgR*(1-alpha)+r*alpha)}, ${Math.round(bgG*(1-alpha)+g*alpha)}, ${Math.round(bgB*(1-alpha)+b*alpha)})`;
  };

  const updatePortfolioMemo = (id, memo) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, memo } : p));
  };

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

  const handleIntChartMouseDown = (e) => {
    if (e && e.activeLabel) {
      setIntIsDragging(true);
      setIntRefAreaLeft(e.activeLabel);
      setIntRefAreaRight('');
      setIntSelectionResult(null);
    }
  };

  const handleIntChartMouseMove = (e) => {
    if (intIsDragging && e && e.activeLabel) setIntRefAreaRight(e.activeLabel);
  };

  const handleIntChartMouseUp = () => {
    if (!intIsDragging) return;
    setIntIsDragging(false);
    if (!intRefAreaLeft || !intRefAreaRight || intRefAreaLeft === intRefAreaRight) {
      setIntRefAreaLeft(''); setIntRefAreaRight(''); return;
    }
    const [l, r] = [intRefAreaLeft, intRefAreaRight].sort();
    const startEntry = intChartData.find(d => d.date >= l);
    const endEntry = [...intChartData].reverse().find(d => d.date <= r);
    if (startEntry && endEntry) {
      const profit = endEntry.evalAmount - startEntry.evalAmount;
      const rate = startEntry.evalAmount > 0 ? ((endEntry.evalAmount / startEntry.evalAmount) - 1) * 100 : 0;
      setIntSelectionResult({ startDate: startEntry.date, endDate: endEntry.date, profit, rate });
    }
    setIntRefAreaLeft(''); setIntRefAreaRight('');
  };

  // 로그인 전: LoginGate 표시
  if (!authUser) {
    return <LoginGate onApproved={handleLoginApproved} />;
  }

  // 관리자 페이지
  if (showAdminPage && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return <AdminPage adminEmail={authUser.email} onClose={() => setShowAdminPage(false)} onViewUser={handleAdminViewUser} userAccessStatus={userAccessStatus} />;
  }

  return (
    <div className="bg-gray-900 min-h-screen text-gray-200 font-sans text-sm relative">
      <style dangerouslySetInnerHTML={{ __html: `html, body, #root { width: 100% !important; margin: 0 !important; padding: 0 !important; } input[type="date"] { color-scheme: dark; }` }} />
      {adminViewingAs && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-gray-900/98 border-b border-gray-700 px-4 py-2 flex items-center justify-between backdrop-blur-sm">
          <span className="text-gray-400 text-xs">
            <span className="text-gray-500 mr-1">관리자 뷰</span>
            <span className="text-gray-200 font-medium">{adminViewingAs}</span>
            <span className="ml-2 text-gray-600 text-[10px] uppercase tracking-wider">읽기 전용</span>
          </span>
          <button
            onClick={handleReturnToAdminPage}
            className="text-gray-400 hover:text-gray-100 text-xs font-medium px-3 py-1 rounded border border-gray-700 hover:border-gray-500 transition-colors bg-gray-800 hover:bg-gray-750"
          >
            ← 관리자 페이지
          </button>
        </div>
      )}
      {globalToast.text && (
        <div className={`fixed ${adminViewingAs ? 'top-14' : 'top-6'} left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-xl shadow-2xl z-[100] font-bold text-white border transition-all duration-300 max-w-lg text-center ${globalToast.isError ? 'bg-red-900/90 border-red-500' : 'bg-blue-600/90 border-blue-400'}`}>{globalToast.text}</div>
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
        <div className="flex items-center justify-between text-xs text-gray-500 px-1">
          <span className="font-mono">{authUser.email}</span>
          <div className="flex items-center gap-1">
            {authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && (
              <button
                onClick={() => setShowAdminPage(true)}
                className="text-gray-500 hover:text-violet-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
                title="관리자"
              >
                <Settings size={14} />
              </button>
            )}
            <button
              onClick={() => {
                setPinCurrent(['', '', '', '']);
                setPinNew(['', '', '', '']);
                setPinConfirm(['', '', '', '']);
                setPinChangeError('');
                setShowPinChange(true);
              }}
              className="text-gray-500 hover:text-amber-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
              title="비밀번호 변경"
            >
              <Lock size={14} />
            </button>
            <button
              onClick={() => {
                const newVal = !adminAccessAllowed;
                setAdminAccessAllowed(newVal);
                if (driveTokenRef.current) {
                  const currentPortfolios = buildPortfoliosState();
                  const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, lookupRows, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed: newVal, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current }, intHistory };
                  saveAllToDrive(state);
                }
              }}
              title={adminAccessAllowed ? '관리자 접속 허용 중 — 클릭하여 차단' : '관리자 접속 차단 중 — 클릭하여 허용'}
              className={`relative p-1.5 rounded border transition-colors flex items-center justify-center ${
                adminAccessAllowed
                  ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 border-emerald-700/40 hover:bg-emerald-900/30'
                  : 'text-gray-600 hover:text-gray-400 hover:bg-gray-800 border-transparent hover:border-gray-700'
              }`}
            >
              <Link2 size={14} />
              {adminAccessAllowed && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
            <div className="w-px h-3 bg-gray-700/60 mx-0.5" />
            <button
              onClick={() => { sessionStorage.removeItem(SESSION_KEY); setAuthUser(null); driveTokenRef.current = ''; setDriveToken(''); }}
              className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
              title="로그아웃"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>

        {/* 뷰 전환 탭 */}
        <div className="flex items-center justify-between border-b border-gray-700/50 flex-wrap gap-y-1 py-1.5">
          <div className="flex gap-2 flex-wrap items-center">
            <button
              onClick={() => setShowIntegratedDashboard(true)}
              style={{ boxShadow: `inset 3px 0 0 0 #60a5fa${showIntegratedDashboard ? 'CC' : '66'}` }}
              className={`w-[96px] py-2 text-xs font-bold rounded-md border transition-all duration-200 truncate ${showIntegratedDashboard ? 'bg-slate-800 text-white border-slate-500' : 'text-gray-400 border-slate-700 hover:bg-slate-800 hover:text-white hover:border-slate-500'}`}
            >총 자산 현황</button>
            {portfolios.filter(p => p.accountType !== 'simple').map(p => {
              const typeConf = ACCOUNT_TYPE_CONFIG[p.accountType] || ACCOUNT_TYPE_CONFIG['portfolio'];
              const isActive = !showIntegratedDashboard && activePortfolioId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => switchToPortfolio(p.id)}
                  style={{ boxShadow: `inset 3px 0 0 0 ${typeConf.color}${isActive ? 'CC' : '66'}` }}
                  className={`w-[96px] py-2 text-xs font-bold rounded-md border transition-all duration-200 truncate ${isActive ? 'bg-slate-800 text-white border-slate-500' : 'text-gray-400 border-slate-700 hover:bg-slate-800 hover:text-white hover:border-slate-500'}`}
                >{(p.id === activePortfolioId ? title : p.name) || '계좌'}</button>
              );
            })}
          </div>
          {showIntegratedDashboard && (
            <div className="flex items-center gap-1 pr-1">
              <button
                onClick={() => {
                  if (hideAmounts) {
                    setUnlockPinDigits(['', '', '', '']);
                    setUnlockPinError('');
                    setShowUnlockPinModal(true);
                  } else {
                    setHideAmounts(true);
                  }
                }}
                title={hideAmounts ? '금액 보이기' : '금액 숨기기'}
                className={`p-1.5 hover:bg-gray-800 rounded transition ${hideAmounts ? 'text-gray-300 hover:text-white' : 'text-gray-500 hover:text-gray-200'}`}
              >
                <span className="text-[13px] font-bold leading-none">₩</span>
              </button>
              <button
                onClick={refreshPrices}
                title="새로고침 — 모든 계좌 종목가격·지수 데이터 갱신"
                className="p-1.5 hover:bg-gray-800 rounded transition text-teal-400 hover:text-teal-300"
              >
                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={handleDriveLoadOnly}
                title={driveStatus === 'loading' ? 'Drive 불러오는 중...' : driveStatus === 'saved' ? 'Drive 동기화 완료 — 다시 불러오기' : driveStatus === 'auth_needed' ? 'Drive 로그인 필요' : 'Google Drive에서 최신 데이터 불러오기'}
                className={`p-1.5 hover:bg-gray-800 rounded transition ${
                  driveStatus === 'loading'
                    ? 'text-blue-300 animate-pulse'
                    : driveStatus === 'saved'
                    ? 'text-blue-400 hover:text-blue-300'
                    : driveStatus === 'error' || driveStatus === 'auth_needed'
                    ? 'text-blue-800/60 hover:text-blue-500'
                    : 'text-blue-500/70 hover:text-blue-400'
                }`}
              >
                <CloudDownload size={14} />
              </button>
              <button
                onClick={handleDriveSave}
                title={driveStatus === 'saving' ? 'Drive 저장 중...' : driveStatus === 'saved' ? 'Drive 저장 완료 — 다시 저장' : driveStatus === 'auth_needed' ? 'Drive 로그인 필요' : 'Google Drive에 전체 데이터 백업'}
                className={`p-1.5 hover:bg-gray-800 rounded transition ${
                  driveStatus === 'saving'
                    ? 'text-indigo-300 animate-pulse'
                    : driveStatus === 'saved'
                    ? 'text-indigo-400 hover:text-indigo-300'
                    : driveStatus === 'error' || driveStatus === 'auth_needed'
                    ? 'text-indigo-800/60 hover:text-indigo-500'
                    : 'text-indigo-500/70 hover:text-indigo-400'
                }`}
              >
                <Save size={14} />
              </button>
              <button
                onClick={handleOpenBackupModal}
                title="Drive 백업 이력 보기 — 시간대별 백업 선택 적용"
                className="p-1.5 hover:bg-gray-800 rounded transition text-purple-500/70 hover:text-purple-400"
              >
                <History size={14} />
              </button>
              <button
                onClick={() => historyInputRef.current?.click()}
                title="지수/종목 히스토리 주입 (JSON 또는 CSV)"
                className="p-1.5 hover:bg-gray-800 rounded transition text-orange-400 hover:text-orange-300"
              >
                <FileUp size={14} />
              </button>
              <input type="file" ref={historyInputRef} onChange={handleImportHistoryJSON} className="hidden" accept=".json,.csv" multiple />
            </div>
          )}
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
        )}


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
          showToast={showToast}
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
        )}

        {!showIntegratedDashboard && (<>
        <Header title={title} setTitle={setTitle} isLoading={isLoading} driveStatus={driveStatus} onRefresh={refreshPrices} onDriveSave={handleDriveSave} onPaste={() => setIsPasteModalOpen(true)} onDriveConnect={() => requestDriveToken('select_account')} onDriveLoadOnly={handleDriveLoadOnly} />

        {activePortfolioAccountType === 'gold' ? (
          <KrxGoldTable
            portfolio={portfolio}
            goldKr={marketIndicators.goldKr}
            goldIntl={marketIndicators.goldIntl}
            usdkrw={marketIndicators.usdkrw}
            onUpdate={handleUpdate}
            onRefresh={fetchMarketIndicators}
            isRefreshing={indicatorLoading}
          />
        ) : (
          <PortfolioTable portfolio={totals.calcPortfolio} totals={totals} sortConfig={sortConfig} onSort={handleSort} onUpdate={handleUpdate} onBlur={handleStockBlur} onDelete={handleDeleteStock} onAddStock={handleAddStock} onAddFund={handleAddFund} stockFetchStatus={stockFetchStatus} onSingleRefresh={handleSingleStockRefresh} isOverseas={activePortfolioAccountType === 'overseas'} usdkrw={marketIndicators.usdkrw || 1} isRetirement={activePortfolioAccountType === 'dc-irp'} />
        )}

        {activePortfolioAccountType !== 'gold' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 lg:grid-cols-12 gap-6 w-full items-stretch">
          <div className="xl:col-span-4 lg:col-span-12 bg-[#1e293b] rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col h-full">
            <div className="p-3 bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700">📊 자산 비중</div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-800 text-gray-400 font-bold border-b border-gray-700"><tr className="text-center"><th className="p-3 border-r border-gray-700">구분</th><th className="p-3 border-r border-gray-700 text-blue-300">투자</th><th className="p-3 border-r border-gray-700 text-yellow-400">평가</th><th className="p-3">수익률</th></tr></thead>
                <tbody>{Object.entries(totals.cats).map(([c, d]) => (<tr key={c} className="border-b border-gray-700 hover:bg-gray-800 transition-colors"><td className={`p-3 text-center align-middle font-bold border-r border-gray-700 ${UI_CONFIG.COLORS.CATEGORIES[c]}`}>{c}</td><td className="py-2 px-3 border-r border-gray-700 align-middle"><div className="flex flex-col items-end justify-center"><span className="whitespace-nowrap">{formatPercent(totals.totalInvest > 0 ? (d.invest / totals.totalInvest) * 100 : 0)}</span><span className="text-[11px] text-gray-400 whitespace-nowrap">{formatCurrency(d.invest)}</span></div></td><td className="py-2 px-3 border-r border-gray-700 font-bold text-yellow-400 align-middle"><div className="flex flex-col items-end justify-center"><span className="whitespace-nowrap">{formatPercent(totals.totalEval > 0 ? (d.eval / totals.totalEval) * 100 : 0)}</span><span className="text-[11px] text-gray-400 whitespace-nowrap">{formatCurrency(d.eval)}</span></div></td><td className={`p-3 align-middle font-bold ${d.profit >= 0 ? 'text-red-400' : 'text-blue-400'} whitespace-nowrap`}>{formatPercent(d.invest > 0 ? d.profit / d.invest * 100 : 0)}</td></tr>))}</tbody>
              </table>
            </div>
          </div>
          <div className="xl:col-span-8 lg:col-span-12 bg-[#1e293b] rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col h-full min-h-[400px]">
            <div className="flex bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700 divide-x divide-gray-700"><div className="p-3 flex-1 text-center">📊 자산 비중</div><div className="p-3 flex-1 text-center text-blue-400">📈 종목별 비중</div></div>
            <div className="p-4 flex-1 flex flex-col sm:flex-row items-stretch gap-4">
              <div className="flex-1 flex flex-col min-h-0">
                <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                  {hoveredPortCatSlice ? (
                    <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredPortCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredPortCatSlice.fill }}>{hoveredPortCatSlice.name} {(hoveredPortCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredPortCatSlice.value)}</span>}</>
                  ) : (
                    <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                  )}
                </div>
                <div className="flex-1 min-h-[180px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={Object.entries(totals.cats).map(([n, d]) => ({ name: n, value: d.eval })).filter(x => x.value > 0)} innerRadius="40%" outerRadius="70%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredPortCatSlice(data)} onMouseLeave={() => setHoveredPortCatSlice(null)}>{Object.entries(totals.cats).map((_, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}</Pie></PieChart></ResponsiveContainer></div>
              </div>
              <div className="flex-1 flex flex-col min-h-0">
                <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                  {hoveredPortStkSlice ? (
                    <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredPortStkSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredPortStkSlice.fill }}>{hoveredPortStkSlice.payload?.name ?? hoveredPortStkSlice.name} {(hoveredPortStkSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredPortStkSlice.value)}</span>}</>
                  ) : (
                    <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                  )}
                </div>
                <div className="flex-1 min-h-[180px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={totals.stks.filter(x => x.eval > 0)} innerRadius="40%" outerRadius="70%" dataKey="eval" label={PieLabelOutside} onMouseEnter={(data) => setHoveredPortStkSlice(data)} onMouseLeave={() => setHoveredPortStkSlice(null)}>{totals.stks.map((_, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CHART_PALETTE[(i + 3) % 8]} />)}</Pie></PieChart></ResponsiveContainer></div>
              </div>
            </div>
          </div>
        </div>
        )}

        <div className="flex flex-col xl:flex-row gap-4 w-full items-stretch">
          <div className="w-full xl:w-[18%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden shrink-0">
            <div className="p-3 bg-black space-y-2 shrink-0 border-b border-gray-700 text-gray-400 text-xs">
              {(() => { const isOv = activePortfolioAccountType === 'overseas'; const fx = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n); const dualKRW = (krwVal, cls='text-gray-200') => isOv ? <div className="flex flex-col items-end leading-tight"><span className={`font-bold ${cls}`}>{fmtUS(krwVal/fx)}</span><span className="text-[10px] text-gray-500">{formatCurrency(krwVal)}</span></div> : <span className={`font-bold ${cls} whitespace-nowrap pl-1`}>{formatCurrency(krwVal)}</span>; return (<><div className="flex justify-between items-start"><span className="shrink-0">투자금액</span>{dualKRW(totals.totalInvest)}</div><div className="flex justify-between items-start"><span className="shrink-0">평가금액</span>{dualKRW(totals.totalEval, 'text-yellow-400 text-[13px]')}</div><div className="flex justify-between"><span className="shrink-0">수익률</span><span className="font-bold text-white text-[13px] whitespace-nowrap pl-1">{formatPercent(totals.totalInvest > 0 ? (totals.totalProfit / totals.totalInvest) * 100 : 0)}</span></div></>); })()}
            </div>
            <div className="flex-1 flex flex-col">
              <div className="flex h-auto py-1.5 border-b border-gray-700"><div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0"><span className="text-[11px] text-gray-400 font-bold">시작일</span></div><div className="flex-1 p-2 flex items-center bg-gray-800/20"><input type="date" value={portfolioStartDate} onChange={e => setPortfolioStartDate(e.target.value)} className="bg-transparent text-gray-200 font-bold outline-none cursor-text text-right w-full text-xs" /></div></div>
              <div className="flex h-auto py-1.5 border-b border-gray-700"><div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0"><span className="text-[11px] text-gray-400 font-bold">입금액</span></div><div className="flex-1 p-2 flex items-center bg-gray-800/20"><input type="text" className="w-full bg-gray-900/60 border border-gray-700/60 rounded text-right text-gray-400 font-bold outline-none px-2 py-1.5 text-xs" placeholder="Enter to apply" onKeyDown={e => { if (e.key === 'Enter') { const v = cleanNum(e.target.value); setPrincipal(p => p + v); setDepositHistory([{ id: generateId(), date: new Date().toISOString().split('T')[0], amount: v, memo: "수동입금" }, ...depositHistory]); e.target.value = ""; } }} /></div></div>
              <div className="flex h-[50px] border-b border-gray-700 shrink-0"><div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0"><span className="text-[11px] text-gray-400 font-bold">투자 원금</span></div><div className="flex-1 p-2 flex items-center bg-gray-800/20"><input type="text" className="w-full bg-gray-900/60 border border-gray-700/60 rounded text-right text-white font-bold outline-none px-2 py-1 text-xs" value={formatNumber(principal)} onChange={e => setPrincipal(cleanNum(e.target.value))} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} /></div></div>
              <div className="flex h-auto py-1.5 border-b border-gray-700"><div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0"><span className="text-[11px] text-gray-400 font-bold" title="1년 미만: 총수익율 / 1년 이상: CAGR(연평균 성장률)">CAGR</span></div><div className="flex-1 p-2 flex items-center justify-end bg-gray-800/20"><span className="font-bold text-blue-300 text-sm">{formatPercent(cagr)}</span></div></div>
              <div className="flex flex-1 min-h-[80px]"><div className="w-[70px] bg-gray-800/50 flex flex-col items-center justify-center border-r border-gray-700 gap-2 shrink-0"><span className="text-[11px] text-gray-400 font-bold">수익률</span><span className="text-[11px] text-gray-400 font-bold">수익금</span></div><div className="flex-1 flex flex-col items-center justify-center bg-gray-900/40 gap-1 p-2 overflow-hidden"><span className={`text-[24px] font-extrabold leading-none tracking-wide whitespace-nowrap ${totals.totalEval - principal >= 0 ? 'text-red-500' : 'text-blue-500'}`}>{formatPercent(principal > 0 ? (totals.totalEval - principal) / principal * 100 : 0)}</span>{(() => { const profit = totals.totalEval - principal; const isOv = activePortfolioAccountType === 'overseas'; const fx = marketIndicators.usdkrw || 1; const cls = `text-[14px] font-bold tracking-wide ${profit >= 0 ? 'text-red-400' : 'text-blue-400'}`; return isOv ? <div className="flex flex-col items-center leading-tight"><span className={cls}>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(profit/fx)}</span><span className="text-[11px] text-gray-500">{formatCurrency(profit)}</span></div> : <span className={`${cls} whitespace-nowrap`}>{formatCurrency(profit)}</span>; })()}</div></div>
            </div>
          </div>


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
            showToast={showToast}
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

        {/* 차트 영역 + 시장 지표 */}
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
            showKospi={showKospi}
            showSp500={showSp500}
            showNasdaq={showNasdaq}
            goldIndicators={goldIndicators}
            setGoldIndicators={setGoldIndicators}
            compStocks={compStocks}
            setCompStocks={setCompStocks}
            userFeatures={userFeatures}
            finalChartData={finalChartData}
            effectiveShowIndicators={effectiveShowIndicators}
            selectionResult={selectionResult}
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

        {/* 리밸런싱 시뮬레이터 */}
        {activePortfolioAccountType !== 'gold' && (
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
          />
        )}
        </>)}

        {showIntegratedDashboard && (
          <IntegratedDashboard
            intHistory={intHistory}
            intTotals={intTotals}
            intMonthlyHistory={intMonthlyHistory}
            intChartData={intChartData}
            intChartPeriod={intChartPeriod}
            intSelectionResult={intSelectionResult}
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
            setIntHistory={setIntHistory}
            setIntChartPeriod={setIntChartPeriod}
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
            handleSave={handleSave}
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
      )}
    </div>
  );
}
