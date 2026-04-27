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
import { DRIVE_FILES, getOrCreateIndexFolder, saveDriveFile, loadDriveFile, loadVersionTimestamp, saveVersionFile, saveVersionedBackup, listBackups, loadBackupById, MAX_BACKUPS, DriveBackupEntry } from './driveStorage';
import { fetchIndexData, fetchStockInfo, fetchUsStockInfo, fetchUsStockHistory, fetchNaverKospi, fetchNaverStockHistory, fetchKISStockHistory, fetchFundInfo } from './api';
import Header from './components/Header';
import PortfolioTable from './components/PortfolioTable';
import KrxGoldTable from './components/KrxGoldTable';
import MarketIndicators from './components/MarketIndicators';
import LoginGate, { verifyPin, savePin, hashPin, savePinToDrive, PIN_KEY, SESSION_KEY, UserFeatures } from './components/LoginGate';
import AdminPage from './components/AdminPage';
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

// ─── CustomDatePicker ───────────────────────────────────────────────────────
const DAYS = ['일','월','화','수','목','금','토'];
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

function CustomDatePicker({ value, onChange, placeholder = '--/--/--' }) {
  const [open, setOpen] = React.useState(false);
  const [viewYear, setViewYear] = React.useState(() => value ? parseInt(value.slice(0,4)) : new Date().getFullYear());
  const [viewMonth, setViewMonth] = React.useState(() => value ? parseInt(value.slice(5,7)) - 1 : new Date().getMonth());
  const [yearPickMode, setYearPickMode] = React.useState(false);
  const [yearRangeStart, setYearRangeStart] = React.useState(() => {
    const y = value ? parseInt(value.slice(0,4)) : new Date().getFullYear();
    return Math.floor(y / 12) * 12;
  });
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const openPicker = () => {
    const y = value ? parseInt(value.slice(0,4)) : new Date().getFullYear();
    const m = value ? parseInt(value.slice(5,7)) - 1 : new Date().getMonth();
    setViewYear(y); setViewMonth(m);
    setYearRangeStart(Math.floor(y / 12) * 12);
    setYearPickMode(false);
    setOpen(true);
  };

  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const firstDow = (y, m) => new Date(y, m, 1).getDay();

  const selectDay = (d) => {
    const mm = String(viewMonth + 1).padStart(2,'0');
    const dd = String(d).padStart(2,'0');
    onChange(`${viewYear}-${mm}-${dd}`);
    setOpen(false);
  };

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11); } else setViewMonth(m => m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0); } else setViewMonth(m => m+1); };

  const selDay = value ? parseInt(value.slice(8,10)) : null;
  const selMonth = value ? parseInt(value.slice(5,7)) - 1 : null;
  const selYear = value ? parseInt(value.slice(0,4)) : null;

  const totalCells = Math.ceil((firstDow(viewYear, viewMonth) + daysInMonth(viewYear, viewMonth)) / 7) * 7;

  const displayText = value ? value.substring(2).replace(/-/g, '/') : placeholder;

  return (
    <div className="relative" ref={ref}>
      <span
        onClick={openPicker}
        className="text-gray-300 text-xs font-bold font-mono px-1 w-[68px] text-center cursor-pointer hover:text-white select-none block"
      >
        {displayText}
      </span>
      {open && (
        <div className="absolute top-7 left-1/2 -translate-x-1/2 z-50 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl p-3 w-[220px]"
          onMouseDown={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={yearPickMode ? () => setYearRangeStart(s => s - 12) : prevMonth}
              className="text-gray-400 hover:text-white hover:bg-gray-700 rounded px-1.5 py-0.5 text-sm transition-colors">‹</button>
            <div className="flex items-center gap-1">
              {/* 년도 클릭 → year pick mode */}
              <button
                onClick={() => { setYearPickMode(m => !m); setYearRangeStart(Math.floor(viewYear/12)*12); }}
                className="text-blue-300 hover:text-blue-100 font-bold text-sm px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors"
              >{viewYear}년</button>
              {!yearPickMode && (
                <span className="text-gray-300 text-xs font-bold">{MONTHS[viewMonth]}</span>
              )}
            </div>
            <button onClick={yearPickMode ? () => setYearRangeStart(s => s + 12) : nextMonth}
              className="text-gray-400 hover:text-white hover:bg-gray-700 rounded px-1.5 py-0.5 text-sm transition-colors">›</button>
          </div>

          {yearPickMode ? (
            /* Year grid */
            <div className="grid grid-cols-3 gap-1">
              {Array.from({length:12}, (_,i) => yearRangeStart + i).map(y => (
                <button key={y}
                  onClick={() => { setViewYear(y); setYearPickMode(false); }}
                  className={`py-1.5 rounded text-xs font-bold transition-colors
                    ${y === viewYear ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}>
                  {y}
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* Day-of-week header */}
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map((d,i) => (
                  <span key={d} className={`text-center text-[10px] font-bold py-0.5
                    ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-500'}`}>{d}</span>
                ))}
              </div>
              {/* Day cells */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {Array.from({length: totalCells}, (_,i) => {
                  const dayNum = i - firstDow(viewYear, viewMonth) + 1;
                  const valid = dayNum >= 1 && dayNum <= daysInMonth(viewYear, viewMonth);
                  const isSelected = valid && dayNum === selDay && viewMonth === selMonth && viewYear === selYear;
                  const dow = i % 7;
                  return (
                    <button key={i}
                      onClick={() => valid && selectDay(dayNum)}
                      className={`text-center text-[11px] py-1 rounded transition-colors
                        ${!valid ? 'invisible' : ''}
                        ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                        ${valid && !isSelected ? (dow===0?'text-red-400':dow===6?'text-blue-400':'text-gray-300') : ''}
                        ${valid && !isSelected ? 'hover:bg-gray-700' : ''}`}>
                      {valid ? dayNum : ''}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
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

  const defaultCompStocks = [
    { id: 1, code: '', name: '비교종목1', active: false, loading: false, color: '#10b981' },
    { id: 2, code: '', name: '비교종목2', active: false, loading: false, color: '#0ea5e9' },
    { id: 3, code: '', name: '비교종목3', active: false, loading: false, color: '#ec4899' }
  ];

  const [title, setTitle] = useState("주식/ETF 포트폴리오");
  const [portfolio, setPortfolio] = useState([]);
  const [principal, setPrincipal] = useState(UI_CONFIG.DEFAULTS.PRINCIPAL);
  const [depositHistory, setDepositHistory] = useState([]);
  const [depositHistory2, setDepositHistory2] = useState([]);
  const [customLinks, setCustomLinks] = useState(UI_CONFIG.DEFAULT_LINKS);
  const [overseasLinks, setOverseasLinks] = useState(UI_CONFIG.OVERSEAS_DEFAULT_LINKS);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState({ mode: 'rebalance', amount: 1000000 });
  const [historyLimit, setHistoryLimit] = useState(UI_CONFIG.DEFAULTS.HISTORY_LIMIT);
  const [lookupRows, setLookupRows] = useState([]);
  const [comparisonMode, setComparisonMode] = useState('latestOverPast');
  const [isLinkSettingsOpen, setIsLinkSettingsOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 1 });
  const [rebalanceSortConfig, setRebalanceSortConfig] = useState({ key: null, direction: 1 });
  const [rebalExtraQty, setRebalExtraQty] = useState<Record<string, number>>({});
  
  const [globalToast, setGlobalToast] = useState({ text: "", isError: false });

  const [chartPeriod, setChartPeriod] = useState('3m');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' });
  const [isDragging, setIsDragging] = useState(false);
  const [refAreaLeft, setRefAreaLeft] = useState('');
  const [refAreaRight, setRefAreaRight] = useState('');
  const [selectionResult, setSelectionResult] = useState(null);
  const [showTotalEval, setShowTotalEval] = useState(true);
  const [showReturnRate, setShowReturnRate] = useState(true);
  const [showBacktest, setShowBacktest] = useState(false);
  const [backtestColor, setBacktestColor] = useState('#f97316');
  const [isZeroBaseMode, setIsZeroBaseMode] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<{label: string, payload: any[]} | null>(null);
  const [hoveredPortCatSlice, setHoveredPortCatSlice] = useState<any>(null);
  const [hoveredPortStkSlice, setHoveredPortStkSlice] = useState<any>(null);
  const [hoveredIntCatSlice, setHoveredIntCatSlice] = useState<any>(null);
  const [hoveredIntHoldSlice, setHoveredIntHoldSlice] = useState<any>(null);
  const [hoveredRebalCatSlice, setHoveredRebalCatSlice] = useState<any>(null);
  const [hoveredCurCatSlice, setHoveredCurCatSlice] = useState<any>(null);
  
  const [showKospi, setShowKospi] = useState(true);
  const [showSp500, setShowSp500] = useState(false);
  const [showNasdaq, setShowNasdaq] = useState(false);
  const [showIndicatorsInChart, setShowIndicatorsInChart] = useState({
    us10y: false, kr10y: false, goldIntl: false, goldKr: false, usdkrw: false, dxy: false, fedRate: false, vix: false, btc: false, eth: false
  });
  const [goldIndicators, setGoldIndicators] = useState({ goldIntl: true, goldKr: true, usdkrw: false, dxy: false });
  const [indicatorScales, setIndicatorScales] = useState({ us10y: 1, goldIntl: 1, goldKr: 1, usdkrw: 1, dxy: 1, fedRate: 1, kr10y: 1, vix: 1, btc: 1, eth: 1 });
  const [isScaleSettingOpen, setIsScaleSettingOpen] = useState(false);
  const [indicatorHistoryLoading, setIndicatorHistoryLoading] = useState({});
  
  const [marketIndices, setMarketIndices] = useState({ kospi: null, sp500: null, nasdaq: null });
  const [indicatorHistoryMap, setIndicatorHistoryMap] = useState({});
  const [stockHistoryMap, setStockHistoryMap] = useState({});
  const [stockListingDates, setStockListingDates] = useState<Record<string, string>>({});
  const [compStocks, setCompStocks] = useState(defaultCompStocks);
  const [adminAccessAllowed, setAdminAccessAllowed] = useState(false);
  const [userAccessStatus, setUserAccessStatus] = useState<Record<string, boolean>>({});
  // 세션 내 자동 전체이력 재조회 완료된 종목 코드 추적 (중복 API 호출 방지)
  const autoFetchedCodes = useRef<Set<string>>(new Set());
  const [portfolioStartDate, setPortfolioStartDate] = useState(() => {
    const today = new Date();
    today.setFullYear(today.getFullYear() - 1);
    return today.toISOString().split('T')[0];
  });
  const [depositSortConfig, setDepositSortConfig] = useState({ key: null, direction: 1 });
  const [depositSortConfig2, setDepositSortConfig2] = useState({ key: null, direction: 1 });

  const [indexFetchStatus, setIndexFetchStatus] = useState({ kospi: null, sp500: null, nasdaq: null });
  const [showIndexVerify, setShowIndexVerify] = useState(false);

  const [stockFetchStatus, setStockFetchStatus] = useState({});

  const [marketIndicators, setMarketIndicators] = useState({
    us10y: null, kr10y: null, usdkrw: null, dxy: null, goldIntl: null, goldKr: null,
    kospiPrice: null, sp500Price: null, nasdaqPrice: null,
    us10yChg: null, kr10yChg: null, usdkrwChg: null, dxyChg: null, goldIntlChg: null, goldKrChg: null,
    kospiChg: null, sp500Chg: null, nasdaqChg: null,
    fedRate: null, fedRateChg: null,
    vix: null, vixChg: null,
    btc: null, btcChg: null,
    eth: null, ethChg: null,
  });
  const [indicatorLoading, setIndicatorLoading] = useState(false);
  const [indicatorFetchStatus, setIndicatorFetchStatus] = useState({});
  const [showIndicatorVerify, setShowIndicatorVerify] = useState(false);
  const [showMarketPanel, setShowMarketPanel] = useState(true);

  // ── Google Drive 자동 동기화 ──
  const [driveStatus, setDriveStatus] = useState(''); // '' | 'auth_needed' | 'loading' | 'saving' | 'saved' | 'error'
  const [driveToken, setDriveToken] = useState('');
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupList, setBackupList] = useState<DriveBackupEntry[]>([]);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [applyingBackupId, setApplyingBackupId] = useState<string | null>(null);
  const driveTokenRef = useRef('');
  const driveFolderIdRef = useRef('');
  const tokenClientRef = useRef(null);
  const pendingTokenResolveRef = useRef<((token: string | null) => void) | null>(null);
  const isInitialLoad = useRef(true);
  const portfolioRef = useRef([]);
  const saveStateRef = useRef<Record<string, any>>({}); // 항상 최신 state 스냅샷 유지
  const driveSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portfolioUpdatedAtRef = useRef<number>(0); // 계좌/종목 구조 변경 시에만 갱신 (시장가격 갱신과 구분)
  const prevPortfolioStructureRef = useRef<string>(''); // 직전 포트폴리오 구조 해시
  const lastDriveSavedPortfolioUpdatedAtRef = useRef<number>(0); // Drive STATE 파일에 마지막으로 저장한 portfolioUpdatedAt
  const driveCheckInProgressRef = useRef(false); // Drive 확인 중복 실행 방지 (polling·visibilitychange 공유)
  const lastDriveCheckAtRef = useRef<number>(0); // 마지막 Drive 확인 시각 (중복 확인 최소화)
  const goldKrAutoCrawledRef = useRef(false); // 세션 당 한 번만 국내금 자동 크롤링
  const stooqAutoCrawledRef = useRef(false);  // 세션 당 한 번만 stooq 지표 자동 크롤링
  // 계좌별 차트 상태 독립 관리
  const currentChartStateRef = useRef<any>({ showKospi: true, showSp500: false, showNasdaq: false, showIndicatorsInChart: { us10y: false, kr10y: false, goldIntl: false, goldKr: false, usdkrw: false, dxy: false, fedRate: false, vix: false, btc: false, eth: false }, goldIndicators: { goldIntl: true, goldKr: true, usdkrw: false, dxy: false }, compStocks: [], chartPeriod: '3m', dateRange: { start: '', end: '' }, appliedRange: { start: '', end: '' }, backtestColor: '#f97316', showBacktest: false });
  const accountChartStatesRef = useRef<Record<string, any>>({});
  const prevActivePortfolioIdRef = useRef<string | null>(null);

  // ── 통합 대시보드 ──
  const [showIntegratedDashboard, setShowIntegratedDashboard] = useState(true);
  const [portfolios, setPortfolios] = useState([]); // multi-portfolio accounts
  const [activePortfolioId, setActivePortfolioId] = useState(null);
  const [intHistory, setIntHistory] = useState([]);
  const [intChartPeriod, setIntChartPeriod] = useState('1y');
  const [intDateRange, setIntDateRange] = useState({ start: '', end: '' });
  const [intAppliedRange, setIntAppliedRange] = useState({ start: '', end: '' });
  const [intRefAreaLeft, setIntRefAreaLeft] = useState('');
  const [intRefAreaRight, setIntRefAreaRight] = useState('');
  const [intSelectionResult, setIntSelectionResult] = useState(null);
  const [intIsDragging, setIntIsDragging] = useState(false);
  const [intIsZeroBaseMode, setIntIsZeroBaseMode] = useState(true);
  const [intExpandedCat, setIntExpandedCat] = useState(null);
  const [simpleEditField, setSimpleEditField] = useState<{id: string, field: string} | null>(null);
  const [showNewAccountMenu, setShowNewAccountMenu] = useState(false);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [showUnlockPinModal, setShowUnlockPinModal] = useState(false);
  const [unlockPinDigits, setUnlockPinDigits] = useState(['', '', '', '']);
  const [unlockPinError, setUnlockPinError] = useState('');

  // Drive 폴더 ID 캐시 확보 (없으면 생성)
  const ensureDriveFolder = async (token: string): Promise<string> => {
    if (driveFolderIdRef.current) return driveFolderIdRef.current;
    const id = await getOrCreateIndexFolder(token);
    driveFolderIdRef.current = id;
    return id;
  };

  // Google Drive Index_Data 폴더에서 데이터 불러오기
  const loadFromDrive = async (token: string) => {
    try {
      setDriveStatus('loading');
      const folderId = await ensureDriveFolder(token);

      // 3개 파일 병렬 로드
      const [stateData, stockData, marketData] = await Promise.all([
        loadDriveFile(token, folderId, DRIVE_FILES.STATE),
        loadDriveFile(token, folderId, DRIVE_FILES.STOCK),
        loadDriveFile(token, folderId, DRIVE_FILES.MARKET),
      ]);

      if (!stateData) { setDriveStatus(''); return null; }

      // 포트폴리오 데이터 로드 (새 형식 우선, 구 형식 마이그레이션)
      const resolvedStockHistoryMap = stockData?.stockHistoryMap || stateData.stockHistoryMap || {};
      setStockHistoryMap(resolvedStockHistoryMap);

      if (stateData.portfolios?.length > 0) {
        // 새 형식: portfolios 배열
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
        // 구 형식 마이그레이션: 현재 포트폴리오를 portfolios[0]으로
        const newId = generateId();
        const migrated = {
          id: newId,
          name: stateData.title || 'DC',
          startDate: stateData.portfolioStartDate || stateData.history?.[0]?.date || '',
          portfolioStartDate: stateData.portfolioStartDate || '',
          portfolio: stateData.portfolio || [],
          principal: cleanNum(stateData.principal),
          history: stateData.history || [],
          depositHistory: stateData.depositHistory || [],
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

      // 시장 데이터: marketdata 파일 우선, 없으면 state 파일 폴백
      const resolvedMarketIndices = marketData?.marketIndices || stateData.marketIndices;
      const resolvedIndicatorHistoryMap = marketData?.indicatorHistoryMap || stateData.indicatorHistoryMap || {};
      const resolvedMarketIndicators = marketData?.marketIndicators || stateData.marketIndicators;

      if (resolvedMarketIndices) {
        setMarketIndices(resolvedMarketIndices);
        setIndexFetchStatus({
          kospi: resolvedMarketIndices.kospi ? buildIndexStatus(resolvedMarketIndices.kospi, 'Drive') : null,
          sp500: resolvedMarketIndices.sp500 ? buildIndexStatus(resolvedMarketIndices.sp500, 'Drive') : null,
          nasdaq: resolvedMarketIndices.nasdaq ? buildIndexStatus(resolvedMarketIndices.nasdaq, 'Drive') : null,
        });
      }
      if (resolvedMarketIndicators) setMarketIndicators(resolvedMarketIndicators);
      if (resolvedIndicatorHistoryMap) setIndicatorHistoryMap(resolvedIndicatorHistoryMap);
      if (stateData.intHistory) setIntHistory(stateData.intHistory);

      setDriveStatus('saved');
      return stateData.portfolios?.[0]?.portfolio || stateData.portfolio || [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Drive 불러오기 실패:', msg);
      // 401/403은 권한 문제 안내
      if (msg.includes('401')) {
        console.warn('[Drive] 토큰 만료 또는 Drive 권한 없음 → 재로그인 필요');
        setDriveStatus('auth_needed');
      } else if (msg.includes('403')) {
        console.warn('[Drive] 403 Forbidden: Google Cloud Console에서 drive.file 권한 또는 테스트 사용자 설정 확인 필요');
        setDriveStatus('error');
      } else {
        setDriveStatus('error');
      }
      return null;
    }
  };

  // Google Drive Index_Data 폴더에 3개 파일로 저장
  // versioned: 'manual'=수동 저장, 'auto'=20분 자동저장, false=백업 이력 불필요한 저장
  const saveAllToDrive = async (state, versioned: false | 'manual' | 'auto' = false) => {
    const token = driveTokenRef.current;
    if (!token) { setDriveStatus('auth_needed'); return; }
    try {
      setDriveStatus('saving');
      const folderId = await ensureDriveFolder(token);
      const { stockHistoryMap: shm, marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm, ...stateCore } = state;
      // STATE(계좌/종목 구조)는 portfolioUpdatedAt이 실제로 변경됐을 때만 저장
      // → 시장가격·지표 갱신으로 인해 다른 기기의 최신 계좌 데이터를 덮어쓰는 것을 방지
      if ((state.portfolioUpdatedAt || 0) > lastDriveSavedPortfolioUpdatedAtRef.current) {
        await saveDriveFile(token, folderId, DRIVE_FILES.STATE, stateCore);
        // 폴링용 경량 version 파일도 동시에 갱신 (다른 기기가 50바이트 파일로 변경 감지)
        await saveVersionFile(token, folderId, state.portfolioUpdatedAt || 0);
        lastDriveSavedPortfolioUpdatedAtRef.current = state.portfolioUpdatedAt || 0;
      }
      // 수동 저장·20분 주기 타이머이면 portfolioUpdatedAt 변경 여부와 무관하게 항상 백업 생성
      if (versioned) {
        saveVersionedBackup(token, folderId, stateCore, versioned).catch(() => {});
      }
      await Promise.all([
        Object.keys(shm || {}).length > 0
          ? saveDriveFile(token, folderId, DRIVE_FILES.STOCK, { stockHistoryMap: shm })
          : Promise.resolve(),
        saveDriveFile(token, folderId, DRIVE_FILES.MARKET, { marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm }),
      ]);
      setDriveStatus('saved');
    } catch (err) {
      console.error('Drive 저장 실패:', err);
      setDriveStatus('error');
    }
  };

  // OAuth 토큰 요청 (팝업 또는 무음)
  const requestDriveToken = (prompt = '') => {
    if (!tokenClientRef.current) return;
    tokenClientRef.current.requestAccessToken({ prompt });
  };

  // 개별 패치 함수들을 밖으로 빼서 재사용 가능하도록 구성 (Retry 용도)
  const fetchersMap = {
    us10y: async (now, statusMap) => {
      const _us10yTarget = 'https://tradingeconomics.com/united-states/government-bond-yield';
      const proxies = [
        `/api/proxy?url=${encodeURIComponent(_us10yTarget)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(_us10yTarget)}`,
        `https://api.codetabs.com/v1/proxy?quest=${_us10yTarget}`
      ];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const html = await res.text();
          const match = html.match(/id="p"[^>]*>\s*([\d,]+\.?\d*)/) || html.match(/"last":\s*([\d,.]+)/);
          if (match) {
            const price = parseFloat(match[1].replace(/,/g, ''));
            const chgMatch = html.match(/id="pch"[^>]*>\s*([+-]?[\d,]*\.?\d+)%?/) || html.match(/"percentageChange":\s*"?([+-]?[\d.]+)/);
            const change = chgMatch ? parseFloat(chgMatch[1].replace(/,/g, '')) : null;
            if (price > 0) { statusMap['us10y'] = { status: 'success', source: proxy.startsWith('/api/proxy') ? 'TE(vercel)' : proxy.includes('allorigins') ? 'TE(allorigins)' : 'TE(codetabs)', updatedAt: now }; return { price, change }; }
          }
        } catch(e) {}
      }
      statusMap['us10y'] = { status: 'fail', source: 'TE 실패', updatedAt: now }; return { price: null, change: null };
    },
    kr10y: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/marketIndex/bond/KR10YT=RR';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['kr10y'] = { status: 'success', source: '네이버채권', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['kr10y'] = { status: 'fail', source: '네이버채권 실패', updatedAt: now }; return { price: null, change: null };
    },
    usdkrw: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/marketIndex/exchange/FX_USDKRW';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['usdkrw'] = { status: 'success', source: '네이버환율', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['usdkrw'] = { status: 'fail', source: '네이버환율 실패', updatedAt: now }; return { price: null, change: null };
    },
    dxy: async (now, statusMap) => {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=1d&interval=1d`;
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
            statusMap['dxy'] = { status: 'success', source: 'Yahoo', updatedAt: now }; return { price, change };
          }
        } catch(e) {}
      }
      statusMap['dxy'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    goldIntl: async (now, statusMap) => {
      const tryYahooGold = async (symbol: string) => {
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
        const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
        for (const proxy of proxies) {
          try {
            const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) continue;
            const json = await res.json();
            const meta = json?.chart?.result?.[0]?.meta;
            if (meta?.regularMarketPrice) {
              const price = meta.regularMarketPrice;
              const prevClose = meta.chartPreviousClose || meta.previousClose;
              const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
              return { price, change, src: `Yahoo(${symbol})` };
            }
          } catch(e) {}
        }
        return null;
      };
      // GC=F(선물) 시도 후 실패 시 XAUUSD=X(현물)로 폴백
      for (const symbol of ['GC=F', 'XAUUSD=X']) {
        const result = await tryYahooGold(symbol);
        if (result) {
          statusMap['goldIntl'] = { status: 'success', source: result.src, updatedAt: now };
          return { price: result.price, change: result.change };
        }
      }
      statusMap['goldIntl'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    goldKr: async (now, statusMap) => {
      // finance.naver.com/marketindex/goldDetail.naver: DEAL_VAL(현재가) + 변동률 span 파싱
      const targetUrl = 'https://finance.naver.com/marketindex/goldDetail.naver';
      const proxies = [
        `/api/proxy?url=${encodeURIComponent(targetUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`,
      ];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const html = await res.text();
          const priceMatch = html.match(/var DEAL_VAL\s*=\s*([\d.]+)/);
          if(!priceMatch) continue;
          const price = parseFloat(priceMatch[1]);
          if(!(price > 0)) continue;
          // 변동률: parenthesis1~per 구간에서 no{digit}/jum 클래스로 조합
          const pctSection = html.match(/class="parenthesis1">([\s\S]*?)class="per">/)?.[0] || '';
          let pctStr = '';
          const tokenRe = /class="(no\d|jum)"/g;
          let tm: RegExpExecArray | null;
          while ((tm = tokenRe.exec(pctSection)) !== null) {
            pctStr += tm[1] === 'jum' ? '.' : tm[1].replace('no', '');
          }
          let change = parseFloat(pctStr) || null;
          if(change !== null && pctSection.includes('class="ico minus"')) change = -change;
          statusMap['goldKr'] = { status: 'success', source: '네이버금시세', updatedAt: now }; return { price, change };
        } catch(e) {}
      }
      statusMap['goldKr'] = { status: 'fail', source: '네이버금시세 실패', updatedAt: now }; return { price: null, change: null };
    },
    kospi: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/index/KOSPI/basic';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['kospi'] = { status: 'success', source: '네이버', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['kospi'] = { status: 'fail', source: '네이버 실패', updatedAt: now }; return { price: null, change: null };
    },
    sp500: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/index/SPI@SPX/basic';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['sp500'] = { status: 'success', source: '네이버해외', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['sp500'] = { status: 'fail', source: '네이버해외 실패', updatedAt: now }; return { price: null, change: null };
    },
    nasdaq: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/index/NAS@NDX/basic';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['nasdaq'] = { status: 'success', source: '네이버해외', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['nasdaq'] = { status: 'fail', source: '네이버해외 실패', updatedAt: now }; return { price: null, change: null };
    },
    fedRate: async (now, statusMap) => {
      const url = 'https://tradingeconomics.com/united-states/interest-rate';
      const proxies = [`/api/proxy?url=${encodeURIComponent(url)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, `https://api.codetabs.com/v1/proxy?quest=${url}`];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const html = await res.text();
          const match = html.match(/id="p"[^>]*>\s*([\d,]+\.?\d*)/) || html.match(/"last":\s*([\d,.]+)/) || html.match(/data-value="([\d,.]+)"/);
          if (match) {
            const price = parseFloat(match[1].replace(/,/g, ''));
            const chgMatch = html.match(/id="pch"[^>]*>\s*([+-]?[\d,]*\.?\d+)%?/);
            const change = chgMatch ? parseFloat(chgMatch[1].replace(/,/g, '')) : null;
            if (price > 0) { statusMap['fedRate'] = { status: 'success', source: 'TE', updatedAt: now }; return { price, change }; }
          }
        } catch(e) {}
      }
      statusMap['fedRate'] = { status: 'fail', source: 'TE 실패', updatedAt: now }; return { price: null, change: null };
    },
    vix: async (now, statusMap) => {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1d&interval=1d`;
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
            statusMap['vix'] = { status: 'success', source: 'Yahoo', updatedAt: now };
            return { price, change };
          }
        } catch(e) {}
      }
      statusMap['vix'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    btc: async (now, statusMap) => {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=1d&interval=1d`;
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
            statusMap['btc'] = { status: 'success', source: 'Yahoo', updatedAt: now };
            return { price, change };
          }
        } catch(e) {}
      }
      statusMap['btc'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    eth: async (now, statusMap) => {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/ETH-USD?range=1d&interval=1d`;
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
            statusMap['eth'] = { status: 'success', source: 'Yahoo', updatedAt: now };
            return { price, change };
          }
        } catch(e) {}
      }
      statusMap['eth'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
  };

  // 재시도 큐 매니저
  const retryFailedIndicators = async (failedKeys, currentStatusMap, maxRetries = 10) => {
    let currentAttempt = 0;
    let pendingKeys = [...failedKeys];
    
    while (pendingKeys.length > 0 && currentAttempt < maxRetries) {
      currentAttempt++;
      // 1초 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      const tempStatusMap = { ...currentStatusMap };
      const newResults = {};
      const stillFailed = [];

      // 순차적으로 혹은 Promise.all로 재시도
      await Promise.all(pendingKeys.map(async (key) => {
         const fetcher = fetchersMap[key];
         if (fetcher) {
           const res = await fetcher(now, tempStatusMap);
           if (res.price !== null) {
             newResults[key] = res;
           } else {
             stillFailed.push(key);
           }
         }
      }));

      // 성공한 것들 업데이트
      if (Object.keys(newResults).length > 0) {
        setMarketIndicators(prev => {
          const merged = { ...prev };
          Object.keys(newResults).forEach(k => {
            if (k === 'kospi' || k === 'sp500' || k === 'nasdaq') {
              merged[`${k}Price`] = newResults[k].price;
              merged[`${k}Chg`] = newResults[k].change;
            } else {
              merged[k] = newResults[k].price;
              merged[`${k}Chg`] = newResults[k].change;
            }
          });
          return merged;
        });
        
        // 차트용 인덱스도 동기화
        const todayMI = new Date().toISOString().split("T")[0];
        setMarketIndices(prev => ({
          kospi:  newResults.kospi  ? { ...(prev.kospi  || {}), [todayMI]: newResults.kospi.price  } : prev.kospi,
          sp500:  newResults.sp500  ? { ...(prev.sp500  || {}), [todayMI]: newResults.sp500.price  } : prev.sp500,
          nasdaq: newResults.nasdaq ? { ...(prev.nasdaq || {}), [todayMI]: newResults.nasdaq.price } : prev.nasdaq,
        }));

        setIndicatorFetchStatus(prev => ({ ...prev, ...tempStatusMap }));
        currentStatusMap = { ...currentStatusMap, ...tempStatusMap };
      }

      pendingKeys = stillFailed;
    }

  };

  // Apps Script 프록시 제거 — 직접 fetchersMap 경로만 사용
  const fetchIndicatorsViaProxy = async () => null;

  // 히스토리 자동수집 가능 여부 매핑 (non-null = /api/history 자동수집 지원)
  const STOOQ_SYMBOLS = {
    us10y:    'yahoo:^TNX',        // FRED DGS10 primary → Yahoo fallback
    goldIntl: 'yahoo:GC=F',
    usdkrw:   'yahoo:KRW=X',
    dxy:      'yahoo:DX-Y.NYB',
    kr10y:    'yahoo:^KR10YT=RR', // Yahoo fallback
    fedRate:  'fred:DFEDTARU',    // FRED 기준금리 히스토리
    goldKr:   null,               // Naver 스크래핑 (별도 처리)
    vix:      'yahoo:^VIX',
    btc:      'yahoo:BTC-USD',
    eth:      'yahoo:ETH-USD',
  };

  const INDICATOR_LABELS = {
    us10y: 'US 10Y', kr10y: 'KR 10Y', goldIntl: 'Gold', goldKr: '국내금',
    usdkrw: 'USDKRW', dxy: 'DXY', fedRate: '미국 기준금리', vix: 'VIX',
    btc: 'Bitcoin', eth: 'Ethereum',
  };

  // stooq에서 과거 데이터 CSV 가져오기
  const fetchIndicatorHistory = async (key, startDate, endDate) => {
    const symbol = STOOQ_SYMBOLS[key];
    if (!symbol) {
      // 국내금(goldKr): 네이버 fchart에서 장기 데이터 크롤링
      if (key === 'goldKr') {
        setIndicatorHistoryLoading(prev => ({ ...prev, goldKr: true }));
        // /api/history: 서버사이드 finance.naver.com 다중 페이지 수집 → JSON 응답
        let goldData: Record<string, number> | null = null;
        try {
          const res = await fetch('/api/history?key=goldKr', { signal: AbortSignal.timeout(30000) });
          if (res.ok) {
            const json = await res.json();
            if (json && typeof json === 'object' && Object.keys(json).length > 10) {
              goldData = json;
            }
          }
        } catch (e) { /* 수집 실패 */ }
        setIndicatorHistoryLoading(prev => ({ ...prev, goldKr: false }));
        if (!goldData || Object.keys(goldData).length === 0) {
          return null;
        }
        const mergedGoldKr = { ...(indicatorHistoryMap.goldKr || {}), ...goldData };
        setIndicatorHistoryMap(prev => ({ ...prev, goldKr: mergedGoldKr }));
        const count = Object.keys(goldData).length;
        // Drive 백업 저장
        if (driveTokenRef.current) {
          try {
            const folderId = await ensureDriveFolder(driveTokenRef.current);
            const mergedIhm = { ...indicatorHistoryMap, goldKr: mergedGoldKr };
            await saveDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.MARKET, {
              marketIndices, marketIndicators, indicatorHistoryMap: mergedIhm,
            });
          } catch (e) { /* Drive 저장 실패는 무시 */ }
        }
        return goldData;
      }
      return null;
    }

    setIndicatorHistoryLoading(prev => ({ ...prev, [key]: true }));

    const d1 = (startDate || appliedRange.start || (() => {
      const d = new Date(); d.setFullYear(d.getFullYear() - 3); return d.toISOString().split('T')[0];
    })()).replace(/-/g, '');
    const d2 = (endDate || appliedRange.end || new Date().toISOString().split('T')[0]).replace(/-/g, '');
    // /api/history: 서버사이드에서 Yahoo Finance / FRED CSV 수집
    let parsedData = null;
    try {
      const res = await fetch(`/api/history?key=${key}&start=${d1}&end=${d2}`, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          // goldKr 등 JSON 응답
          const json = await res.json();
          if (json && typeof json === 'object' && Object.keys(json).length > 0) parsedData = json;
        } else {
          // Yahoo/FRED CSV 응답 (Date,Close 형식)
          const csv = await res.text();
          if (csv && !csv.includes('No data') && csv.length >= 30) {
            parsedData = parseIndexCSV(csv, `${key}.csv`);
          }
        }
      }
    } catch (e) { /* 수집 실패 */ }

    setIndicatorHistoryLoading(prev => ({ ...prev, [key]: false }));

    if (!parsedData || Object.keys(parsedData).length === 0) {
      return null;
    }

    // 기존 데이터 보존 + 새 데이터 병합 (최신 날짜 이후 데이터만 추가됨)
    setIndicatorHistoryMap(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...parsedData } }));
    return parsedData;
  };

  // 지표 전체 일괄 수집 (Yahoo Finance / FRED / Naver)
  const fetchAllIndicatorHistory = async () => {
    const keys = ['us10y', 'fedRate', 'kr10y', 'goldIntl', 'usdkrw', 'dxy', 'goldKr', 'vix', 'btc', 'eth'];
    for (const key of keys) {
      await fetchIndicatorHistory(key, appliedRange?.start, appliedRange?.end);
    }
  };

  // CSV / JSON 파일 직접 업로드로 지표 히스토리 주입 (stooq 미지원 지표용)
  const handleIndicatorUpload = (key, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result;
      if (typeof content !== 'string') return;
      const ext = file.name.split('.').pop()?.toLowerCase();
      let parsedData = null;

      try {
        if (ext === 'csv') {
          parsedData = parseIndexCSV(content, file.name);
        } else if (ext === 'json') {
          const raw = JSON.parse(content);
          const arr = raw.data ?? raw;
          if (Array.isArray(arr)) {
            parsedData = {};
            arr.forEach(item => {
              const d = (item.Date ?? item.date ?? item.index ?? item.INDEX ?? '').substring(0, 10);
              const v = item.Close ?? item.Value ?? item.close ?? item.value ?? (() => {
                const skip = ['Date', 'date', 'index', 'INDEX'];
                const key = Object.keys(item).find(k => !skip.includes(k) && typeof item[k] === 'number');
                return key ? item[key] : undefined;
              })();
              if (d && v != null && d !== '1970-01-01') parsedData[d] = Number(v);
            });
          }
        }
      } catch (err) {
        showToast(`${file.name} 파싱 실패`, true);
        return;
      }

      if (!parsedData || Object.keys(parsedData).length === 0) {
        showToast(`${file.name}: 유효 데이터 없음`, true);
        return;
      }

      setIndicatorHistoryMap(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...parsedData } }));
    };
    reader.readAsText(file);
  };

  const fetchMarketIndicators = async () => {
    setIndicatorLoading(true);
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const statusMap = {};

    try {
      // /api/indicators: 서버사이드에서 FRED / Naver / Yahoo 직접 수집
      const res = await fetch('/api/indicators', { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const keys = ['us10y', 'fedRate', 'kr10y', 'usdkrw', 'goldIntl', 'goldKr',
                    'kospi', 'sp500', 'nasdaq', 'dxy', 'vix', 'btc', 'eth'];

      setMarketIndicators(prev => {
        const merged = { ...prev };
        keys.forEach(k => {
          const d = data[k];
          if (d?.price != null) {
            statusMap[k] = { status: 'success', source: d.source ?? 'API', updatedAt: now };
            if (k === 'kospi' || k === 'sp500' || k === 'nasdaq') {
              merged[`${k}Price`] = d.price;
              merged[`${k}Chg`]   = d.change;
            } else {
              merged[k]           = d.price;
              merged[`${k}Chg`]   = d.change;
            }
          } else {
            statusMap[k] = { status: 'fail', source: 'API', updatedAt: now };
          }
        });
        return merged;
      });

      const todayMI = new Date().toISOString().split('T')[0];
      setMarketIndices(prev => ({
        kospi:  data.kospi?.price  ? { ...(prev.kospi  || {}), [todayMI]: data.kospi.price  } : prev.kospi,
        sp500:  data.sp500?.price  ? { ...(prev.sp500  || {}), [todayMI]: data.sp500.price  } : prev.sp500,
        nasdaq: data.nasdaq?.price ? { ...(prev.nasdaq || {}), [todayMI]: data.nasdaq.price } : prev.nasdaq,
      }));

      // 서버사이드 수집 실패 항목을 클라이언트 fallback으로 재시도
      const failedKeys = Object.keys(statusMap).filter(k => statusMap[k]?.status === 'fail');
      if (failedKeys.length > 0) {
        retryFailedIndicators(failedKeys, { ...statusMap });
      }
    } catch (e) {
      console.error('시장 지표 수집 오류:', e);
      ['us10y', 'fedRate', 'kr10y', 'usdkrw', 'goldIntl', 'goldKr',
       'kospi', 'sp500', 'nasdaq', 'dxy', 'vix', 'btc', 'eth']
        .forEach(k => { statusMap[k] = { status: 'fail', source: 'API 오류', updatedAt: now }; });
      // 서버 API 전체 실패 시 fetchersMap에 있는 항목들로 클라이언트 fallback 시도
      const clientKeys = Object.keys(fetchersMap);
      retryFailedIndicators(clientKeys, { ...statusMap });
    } finally {
      setIndicatorFetchStatus(statusMap);
      setIndicatorLoading(false);
    }
  };

  // portfolioRef를 항상 최신 portfolio로 동기화 (클로저 문제 해결용)
  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);

  // 국내금 장기 데이터 자동 크롤링: Drive 데이터 로드/저장 완료 후 데이터가 부족하거나 오래된 경우 자동 수집
  useEffect(() => {
    if (goldKrAutoCrawledRef.current) return;
    if (driveStatus !== 'saved') return;
    if (!driveTokenRef.current) return;
    const goldKrData = indicatorHistoryMap.goldKr || {};
    const goldKrCount = Object.keys(goldKrData).length;
    const latestDate = goldKrCount > 0 ? Object.keys(goldKrData).sort().pop() : null;
    const daysSinceLatest = latestDate
      ? Math.floor((Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24))
      : Infinity;
    if (goldKrCount < 200 || daysSinceLatest > 3) {
      goldKrAutoCrawledRef.current = true;
      fetchIndicatorHistory('goldKr', null, null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveStatus]);

  // 지표 자동 크롤링: Drive 저장 완료 후 데이터가 없거나 3일 이상 오래된 경우 자동 수집
  useEffect(() => {
    if (stooqAutoCrawledRef.current) return;
    if (driveStatus !== 'saved') return;
    if (!driveTokenRef.current) return;
    const STOOQ_KEYS = ['us10y', 'fedRate', 'kr10y', 'goldIntl', 'usdkrw', 'dxy', 'vix', 'btc', 'eth'];
    const staleKeys = STOOQ_KEYS.filter(key => {
      const hist = indicatorHistoryMap[key] || {};
      const count = Object.keys(hist).length;
      if (count === 0) return true;
      const latestDate = Object.keys(hist).sort().pop();
      const daysSince = Math.floor((Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24));
      return daysSince > 3;
    });
    if (staleKeys.length > 0) {
      stooqAutoCrawledRef.current = true;
      (async () => {
        for (const key of staleKeys) {
          await fetchIndicatorHistory(key, null, null);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveStatus]);

  const activePortfolioAccountType = useMemo(() =>
    portfolios.find(p => p.id === activePortfolioId)?.accountType || 'portfolio',
    [portfolios, activePortfolioId]
  );

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

  // KRX 금현물 포트폴리오: 주식 항목이 없으면 자동 초기화
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

  // KRX 금현물 포트폴리오: goldKr 시세를 주식 항목의 currentPrice에 자동 동기화
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
  const showToast = (text, isError = false) => { setGlobalToast({ text, isError }); setTimeout(() => setGlobalToast({ text: "", isError: false }), 4000); };

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
      const isOverseasRefresh = activePortfolioAccountType === 'overseas';

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
        const existing = stockHistoryMap[code];
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

  // 현재 활성 포트폴리오 state를 portfolios 배열에 반영하여 반환
  const buildPortfoliosState = () =>
    portfolios.map(p =>
      p.id === activePortfolioId
        ? { ...p, name: title, portfolio, principal, history, depositHistory, depositHistory2, startDate: portfolioStartDate, portfolioStartDate, settings }
        : p
    );

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

  const handleDriveLoadOnly = async () => {
    // CLIENT_ID 미설정
    if (GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
      showToast('config.ts에 Google Client ID를 설정해 주세요', true);
      return;
    }

    let token = driveTokenRef.current;

    // 토큰 없음 → 로그인 팝업 띄우고 토큰 대기
    if (!token) {
      if (!tokenClientRef.current) {
        showToast('Drive 클라이언트 초기화 실패. 페이지를 새로고침해 주세요.', true);
        return;
      }
      showToast('Google Drive 로그인 팝업을 확인해 주세요...');
      token = await new Promise<string | null>((resolve) => {
        pendingTokenResolveRef.current = resolve;
        tokenClientRef.current.requestAccessToken({ prompt: 'select_account' });
      });
    }

    if (!token) {
      showToast('Drive 로그인이 취소되었거나 실패했습니다.', true);
      return;
    }

    const result = await loadFromDrive(token);
    if (result === null) {
      showToast('Drive에서 데이터를 불러오지 못했습니다.', true);
    }
  };

  const handleOpenBackupModal = async () => {
    const token = driveTokenRef.current;
    if (!token) { showToast('Drive 연결 필요 — 먼저 Drive를 연결해 주세요', true); return; }
    setShowBackupModal(true);
    setBackupListLoading(true);
    try {
      const folderId = await ensureDriveFolder(token);
      const backups = await listBackups(token, folderId);
      setBackupList(backups);
    } catch {
      showToast('백업 목록을 불러오지 못했습니다.', true);
    } finally {
      setBackupListLoading(false);
    }
  };

  const handleApplyBackup = async (fileId: string, displayTime: string) => {
    if (!window.confirm(`"${displayTime}" 시점의 백업을 현재 데이터에 적용하시겠습니까?\n(현재 계좌·종목 구성이 백업 시점으로 교체됩니다)`)) return;
    setApplyingBackupId(fileId);
    setDriveStatus('loading');
    try {
      const stateData = await loadBackupById(driveTokenRef.current, fileId) as any;
      if (!stateData) throw new Error('empty');
      // 포트폴리오 구조 복원
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
        if (stateData.chartPrefs.accountChartStates) accountChartStatesRef.current = stateData.chartPrefs.accountChartStates;
        if (stateData.chartPrefs.showMarketPanel !== undefined) setShowMarketPanel(stateData.chartPrefs.showMarketPanel);
        if (stateData.chartPrefs.hideAmounts !== undefined) setHideAmounts(stateData.chartPrefs.hideAmounts);
        if (stateData.chartPrefs.showIndicatorsInChart) setShowIndicatorsInChart(stateData.chartPrefs.showIndicatorsInChart);
        if (stateData.chartPrefs.goldIndicators) setGoldIndicators(stateData.chartPrefs.goldIndicators);
        if (stateData.chartPrefs.indicatorScales) setIndicatorScales(stateData.chartPrefs.indicatorScales);
        if (stateData.chartPrefs.backtestColor) setBacktestColor(stateData.chartPrefs.backtestColor);
        if (stateData.chartPrefs.showBacktest !== undefined) setShowBacktest(stateData.chartPrefs.showBacktest);
      }
      setDriveStatus('saved');
      setShowBackupModal(false);
      showToast(`${displayTime} 백업이 적용되었습니다.`);
    } catch {
      showToast('백업 적용에 실패했습니다.', true);
      setDriveStatus('error');
    } finally {
      setApplyingBackupId(null);
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

    // GIS 토큰 클라이언트 초기화 (토큰 갱신용, 팝업 없이)
    const initClient = () => {
      if ((window as any).google?.accounts?.oauth2) {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          callback: (resp: any) => {
            const t: string | null = resp.error ? null : resp.access_token;
            if (t) {
              driveTokenRef.current = t;
              setDriveToken(t);
              setDriveStatus('');
            } else {
              setDriveStatus('auth_needed');
            }
            if (pendingTokenResolveRef.current) {
              pendingTokenResolveRef.current(t);
              pendingTokenResolveRef.current = null;
            }
          },
        });
        tokenClientRef.current = client;
      }
    };

    const bgTimer = setTimeout(async () => {
      initClient();

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

  useEffect(() => {
    const loadIndices = async () => {
      const [kRes, sRes, nRes] = await Promise.allSettled([
        fetchIndexData('^KS11'),
        fetchIndexData('^GSPC'),
        fetchIndexData('^NDX')
      ]);
      const newK = (kRes.status === 'fulfilled' && kRes.value) ? kRes.value : null;
      const newS = (sRes.status === 'fulfilled' && sRes.value) ? sRes.value : null;
      const newN = (nRes.status === 'fulfilled' && nRes.value) ? nRes.value : null;

      setMarketIndices(prev => {
        const mergedK = newK ? { ...(prev.kospi || {}), ...newK.data } : prev.kospi;
        const mergedS = newS ? { ...(prev.sp500 || {}), ...newS.data } : prev.sp500;
        const mergedN = newN ? { ...(prev.nasdaq || {}), ...newN.data } : prev.nasdaq;

        const resolveStatus = (fetchRes, merged) => {
          if (fetchRes) return buildIndexStatus(merged, fetchRes.source);
          if (merged && Object.keys(merged).length > 0) {
            const st = buildIndexStatus(merged, '백업데이터');
            st.status = 'partial';
            return st;
          }
          return null;
        };
        setIndexFetchStatus({
          kospi: resolveStatus(newK, mergedK),
          sp500: resolveStatus(newS, mergedS),
          nasdaq: resolveStatus(newN, mergedN),
        });

        return { kospi: mergedK, sp500: mergedS, nasdaq: mergedN };
      });
    };
    loadIndices();
  }, []);

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

  // Drive 버전 파일을 확인하고 최신 데이터가 있으면 불러오는 공통 함수
  // version 파일(~50바이트)만 읽어 변경 여부를 먼저 확인 → 변경 시에만 전체 STATE 로드
  const checkAndSyncFromDrive = async () => {
    if (!driveTokenRef.current || isInitialLoad.current) return;
    if (driveCheckInProgressRef.current) return;
    driveCheckInProgressRef.current = true;
    lastDriveCheckAtRef.current = Date.now();
    try {
      const folderId = await ensureDriveFolder(driveTokenRef.current);
      const driveTs = await loadVersionTimestamp(driveTokenRef.current, folderId);
      if (driveTs !== null && driveTs > portfolioUpdatedAtRef.current) {
        await loadFromDrive(driveTokenRef.current);
      }
    } catch {
      // 오프라인·토큰 만료 등 조용히 무시
    } finally {
      driveCheckInProgressRef.current = false;
    }
  };

  // 탭·앱 활성화 시 Drive 동기화 확인, 숨김(닫힘) 시 즉시 Drive 저장
  useEffect(() => {
    if (!authUser) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // 탭이 숨겨지거나 닫힐 때 즉시 Drive 백업
        const snap = saveStateRef.current;
        if (snap && snap.portfolios?.length > 0 && driveTokenRef.current && !isInitialLoad.current) {
          if (driveSaveTimerRef.current) clearTimeout(driveSaveTimerRef.current);
          saveAllToDrive(snap);
        }
        return;
      }
      checkAndSyncFromDrive();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [authUser]);

  // 10분마다 Drive version 파일을 polling → 다른 기기의 변경을 자동 반영
  // version 파일은 50바이트이므로 API 비용이 매우 낮음
  useEffect(() => {
    if (!authUser) return;
    const POLL_INTERVAL = 10 * 60 * 1000; // 10분
    const intervalId = setInterval(() => {
      if (document.hidden) return; // 탭이 숨겨진 상태면 불필요한 API 호출 생략
      // visibilitychange나 직전 poll과 9분 이내 중복 실행 방지
      if (Date.now() - lastDriveCheckAtRef.current < 9 * 60 * 1000) return;
      checkAndSyncFromDrive();
    }, POLL_INTERVAL);
    return () => clearInterval(intervalId);
  }, [authUser]);

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
      {isScaleSettingOpen && (() => {
        const INDICATOR_LABELS = {
          us10y: 'US 10Y', kr10y: 'KR 10Y', goldIntl: 'Gold', goldKr: '국내금',
          usdkrw: 'USDKRW', dxy: 'DXY', fedRate: '기준금리', vix: 'VIX'
        };
        const activeKeys = Object.keys(showIndicatorsInChart).filter(k => showIndicatorsInChart[k]);
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[400] animate-in fade-in backdrop-blur-sm">
            <div className="bg-[#1e293b] rounded-xl w-full max-w-sm border border-indigo-700/50 shadow-2xl overflow-hidden flex flex-col">
              <div className="bg-indigo-950/60 p-4 border-b border-indigo-800/50 flex justify-between items-center">
                <span className="text-indigo-300 font-extrabold flex items-center gap-2">⚙️ 지표 배율 설정</span>
                <button onClick={() => setIsScaleSettingOpen(false)} className="text-gray-400 hover:text-white transition-colors p-1"><X size={18} /></button>
              </div>
              <div className="p-5 flex flex-col gap-4">
                {activeKeys.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-4">차트에 표시 중인 지표가 없습니다.</p>
                ) : (
                  activeKeys.map(k => (
                    <div key={k} className="flex items-center gap-3">
                      <span className="text-[12px] font-bold text-gray-300 w-20 shrink-0">{INDICATOR_LABELS[k]}</span>
                      <input
                        type="range"
                        min="1"
                        max="50"
                        step="1"
                        value={indicatorScales[k] ?? 1}
                        onChange={e => setIndicatorScales(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                        className="flex-1 accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-[12px] font-bold text-indigo-300 w-8 text-right shrink-0">x{indicatorScales[k] ?? 1}</span>
                      {(indicatorScales[k] ?? 1) !== 1 && (
                        <button
                          onClick={() => setIndicatorScales(prev => ({ ...prev, [k]: 1 }))}
                          className="text-gray-500 hover:text-gray-300 transition"
                          title="초기화"
                        ><X size={12} /></button>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="px-5 pb-4 flex justify-between items-center border-t border-gray-700/50 pt-3">
                <button
                  onClick={() => setIndicatorScales({ us10y: 1, goldIntl: 1, usdkrw: 1, dxy: 1, fedRate: 1, kr10y: 1, vix: 1 })}
                  className="text-[11px] text-gray-400 hover:text-gray-200 transition"
                >전체 초기화</button>
                <button
                  onClick={() => setIsScaleSettingOpen(false)}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-bold transition"
                >닫기</button>
              </div>
            </div>
          </div>
        );
      })()}

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
        {showBackupModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#0f172a] border border-gray-700/60 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <div className="flex items-center gap-2 text-gray-200">
                  <History size={14} className="text-purple-400" />
                  <span className="font-semibold text-sm">Drive 백업 이력</span>
                </div>
                <button onClick={() => setShowBackupModal(false)} className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-800">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4">
                {backupListLoading ? (
                  <div className="flex items-center justify-center py-10 text-gray-500 gap-2">
                    <RefreshCw size={16} className="animate-spin" />
                    <span className="text-xs">백업 목록 불러오는 중...</span>
                  </div>
                ) : backupList.length === 0 ? (
                  <div className="text-center py-10 text-gray-500 text-xs">저장된 백업이 없습니다<br /><span className="text-gray-600">Save 버튼 또는 20분 자동저장 시 백업이 생성됩니다</span></div>
                ) : (
                  <div className="space-y-2">
                    {backupList.map((backup) => {
                      const m = backup.name.match(/portfolio_backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
                      const displayTime = m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : backup.name;
                      const isManual = backup.name.includes('_manual');
                      const isApplying = applyingBackupId === backup.id;
                      return (
                        <div key={backup.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-800/70 border border-gray-700/40 hover:border-purple-700/40 transition">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-300 font-mono">{displayTime}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${isManual ? 'bg-blue-700/60 text-blue-200' : 'bg-gray-700/60 text-gray-400'}`}>
                              {isManual ? '수동' : '자동'}
                            </span>
                          </div>
                          <button
                            onClick={() => handleApplyBackup(backup.id, displayTime)}
                            disabled={!!applyingBackupId}
                            className="text-[11px] px-3 py-1 rounded bg-purple-700 hover:bg-purple-600 text-white font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {isApplying ? '적용중...' : '적용'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="mt-3 text-[10px] text-gray-600 text-center">최대 {MAX_BACKUPS}개 저장 · 수동 Save 및 20분 자동저장 시 생성</p>
              </div>
            </div>
          </div>
        )}

        {/* 비밀번호 변경 모달 */}
        {showPinChange && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#0f172a] border border-gray-700/60 rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden">
              {/* 헤더 */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <div className="flex items-center gap-2 text-gray-200">
                  <Lock size={14} className="text-gray-400" />
                  <span className="font-semibold text-sm">비밀번호 변경</span>
                </div>
                <button
                  onClick={() => setShowPinChange(false)}
                  className="text-gray-600 hover:text-gray-300 transition-colors p-1 rounded"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 입력 영역 */}
              <div className="px-5 py-5 space-y-5">
                {/* 현재 비밀번호 */}
                <div className="space-y-2.5">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">현재 비밀번호</p>
                  <div className="flex gap-2.5 justify-center">
                    {[0,1,2,3].map(i => (
                      <input key={i} id={`pc-cur-${i}`} type="password" inputMode="numeric" maxLength={1}
                        value={pinCurrent[i] || ''}
                        onChange={e => {
                          if (!/^\d*$/.test(e.target.value)) return;
                          const n = [...pinCurrent]; n[i] = e.target.value.slice(-1); setPinCurrent(n);
                          setPinChangeError('');
                          if (e.target.value && i < 3) document.getElementById(`pc-cur-${i+1}`)?.focus();
                        }}
                        onKeyDown={e => { if (e.key==='Backspace' && !pinCurrent[i] && i>0) document.getElementById(`pc-cur-${i-1}`)?.focus(); }}
                        className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg text-white outline-none transition-colors"
                      />
                    ))}
                  </div>
                </div>

                {/* 구분선 */}
                <div className="border-t border-gray-800" />

                {/* 새 비밀번호 */}
                <div className="space-y-2.5">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">새 비밀번호</p>
                  <div className="flex gap-2.5 justify-center">
                    {[0,1,2,3].map(i => (
                      <input key={i} id={`pc-new-${i}`} type="password" inputMode="numeric" maxLength={1}
                        value={pinNew[i] || ''}
                        onChange={e => {
                          if (!/^\d*$/.test(e.target.value)) return;
                          const n = [...pinNew]; n[i] = e.target.value.slice(-1); setPinNew(n);
                          setPinChangeError('');
                          if (e.target.value && i < 3) document.getElementById(`pc-new-${i+1}`)?.focus();
                        }}
                        onKeyDown={e => { if (e.key==='Backspace' && !pinNew[i] && i>0) document.getElementById(`pc-new-${i-1}`)?.focus(); }}
                        className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg text-white outline-none transition-colors"
                      />
                    ))}
                  </div>
                </div>

                {/* 새 비밀번호 확인 */}
                <div className="space-y-2.5">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">새 비밀번호 확인</p>
                  <div className="flex gap-2.5 justify-center">
                    {[0,1,2,3].map(i => (
                      <input key={i} id={`pc-cfm-${i}`} type="password" inputMode="numeric" maxLength={1}
                        value={pinConfirm[i] || ''}
                        onChange={e => {
                          if (!/^\d*$/.test(e.target.value)) return;
                          const n = [...pinConfirm]; n[i] = e.target.value.slice(-1); setPinConfirm(n);
                          setPinChangeError('');
                          if (e.target.value && i < 3) document.getElementById(`pc-cfm-${i+1}`)?.focus();
                        }}
                        onKeyDown={e => { if (e.key==='Backspace' && !pinConfirm[i] && i>0) document.getElementById(`pc-cfm-${i-1}`)?.focus(); }}
                        className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg text-white outline-none transition-colors"
                      />
                    ))}
                  </div>
                </div>

                {pinChangeError && (
                  <p className="text-red-400 text-xs text-center">{pinChangeError}</p>
                )}
              </div>

              {/* 푸터 */}
              <div className="px-5 pb-5">
                <button
                  disabled={pinChangeSaving}
                  onClick={async () => {
                    const cur = pinCurrent.join('');
                    const np = pinNew.join('');
                    const cp = pinConfirm.join('');
                    if (cur.length < 4) { setPinChangeError('현재 비밀번호를 입력하세요.'); return; }
                    if (!verifyPin(cur, authUser.email)) { setPinChangeError('현재 비밀번호가 틀렸습니다.'); setPinCurrent(['','','','']); return; }
                    if (np.length < 4) { setPinChangeError('새 비밀번호를 입력하세요.'); return; }
                    if (np !== cp) { setPinChangeError('새 비밀번호가 일치하지 않습니다.'); setPinConfirm(['','','','']); return; }
                    setPinChangeSaving(true);
                    savePin(np, authUser.email);
                    await savePinToDrive(hashPin(np), authUser.token);
                    setPinChangeSaving(false);
                    setShowPinChange(false);
                    showToast('비밀번호가 변경되었습니다.');
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {pinChangeSaving ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />저장 중...</>
                  ) : '변경 완료'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 금액 보기 잠금 해제 모달 */}
        {showUnlockPinModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[500] p-4">
            <div className="bg-[#0f172a] border border-gray-700/60 rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <div className="flex items-center gap-2 text-gray-200">
                  <span className="text-[13px] font-bold text-gray-400 leading-none">₩</span>
                  <span className="font-semibold text-sm">금액 보기</span>
                </div>
                <button
                  onClick={() => setShowUnlockPinModal(false)}
                  className="text-gray-600 hover:text-gray-300 transition-colors p-1 rounded"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 py-5 space-y-4">
                <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium text-center">비밀번호를 입력하세요</p>
                <div className="flex gap-2.5 justify-center">
                  {[0,1,2,3].map(i => (
                    <input
                      key={i}
                      id={`ul-pin-${i}`}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={unlockPinDigits[i] || ''}
                      autoFocus={i === 0}
                      onChange={e => {
                        if (!/^\d*$/.test(e.target.value)) return;
                        const next = [...unlockPinDigits];
                        next[i] = e.target.value.slice(-1);
                        setUnlockPinDigits(next);
                        setUnlockPinError('');
                        if (e.target.value && i < 3) {
                          document.getElementById(`ul-pin-${i+1}`)?.focus();
                        } else if (e.target.value && i === 3) {
                          const pin = [...next].join('');
                          if (pin.length === 4) {
                            if (verifyPin(pin, authUser.email)) {
                              setHideAmounts(false);
                              setShowUnlockPinModal(false);
                            } else {
                              setUnlockPinError('비밀번호가 틀렸습니다.');
                              setUnlockPinDigits(['', '', '', '']);
                              setTimeout(() => document.getElementById('ul-pin-0')?.focus(), 50);
                            }
                          }
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Backspace' && !unlockPinDigits[i] && i > 0)
                          document.getElementById(`ul-pin-${i-1}`)?.focus();
                        if (e.key === 'Enter') {
                          const pin = unlockPinDigits.join('');
                          if (pin.length === 4) {
                            if (verifyPin(pin, authUser.email)) {
                              setHideAmounts(false);
                              setShowUnlockPinModal(false);
                            } else {
                              setUnlockPinError('비밀번호가 틀렸습니다.');
                              setUnlockPinDigits(['', '', '', '']);
                              setTimeout(() => document.getElementById('ul-pin-0')?.focus(), 50);
                            }
                          }
                        }
                      }}
                      className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg text-white outline-none transition-colors"
                    />
                  ))}
                </div>
                {unlockPinError && (
                  <p className="text-red-400 text-xs text-center">{unlockPinError}</p>
                )}
              </div>
            </div>
          </div>
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

          <div className="w-full xl:w-[26%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden shrink-0">
            <div className="p-3 bg-[#0f172a] text-white font-bold flex justify-between items-center text-sm border-b border-gray-700 shrink-0">
              <span>📈 자산 평가액 추이</span>
              <div className="flex items-center gap-1">
                <button onClick={() => { const today = new Date().toISOString().split('T')[0]; setHistory(prev => { const todayEntry = prev.find(h => h.date === today); return todayEntry ? [todayEntry] : (totals.totalEval > 0 ? [{ date: today, evalAmount: totals.totalEval, principal, isFixed: false }] : []); }); showToast("평가 기록 리셋 완료 (오늘 데이터만 유지)"); }} className="p-1 hover:bg-gray-800 rounded transition text-orange-400 hover:text-white" title="평가 기록 리셋 (오늘만 유지)"><Trash2 size={14} /></button>
                <button onClick={handleDownloadCSV} className="p-1 hover:bg-gray-800 rounded transition text-blue-400 hover:text-white" title="전체 엑셀 다운로드"><Download size={14} /></button>
              </div>
            </div>
            <div className="shrink-0 h-[140px] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-max text-right text-[13px] table-auto border-collapse whitespace-nowrap">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal">평가자산</th>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal cursor-help" title="수식: (당일/전일)-1">전일대비</th>
                    <th className="py-2 px-2 text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setHistoryLimit(p => p + 5)} className="text-gray-400 hover:text-white"><Plus size={12} /></button>
                        <button onClick={() => setHistoryLimit(p => Math.max(p - 5, 3))} className="text-gray-400 hover:text-white"><Minus size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayHistSliced.map((h, i) => {
                    const prev = sortedHistoryDesc[sortedHistoryDesc.indexOf(h) + 1];
                    const dod = (prev && prev.evalAmount > 0) ? ((h.evalAmount / prev.evalAmount) - 1) * 100 : 0;
                    return (
                      <tr key={h.id || i} className={`border-b border-gray-700 ${h.date === new Date().toISOString().split('T')[0] ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                        <td className="py-2 px-3 text-center border-r border-gray-600 font-bold text-gray-400">{formatShortDate(h.date)}</td>
                        <td className="py-2 px-3 border-r border-gray-600 font-bold text-white text-right">{activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end leading-tight"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(h.evalAmount/(marketIndicators.usdkrw||1))}</span><span className="text-[10px] text-gray-500">{formatCurrency(h.evalAmount)}</span></div> : formatCurrency(h.evalAmount)}</td>
                        <td className="py-2 px-3 border-r border-gray-600 text-center font-bold"><span className={dod > 0 ? 'text-red-400' : dod < 0 ? 'text-blue-400' : 'text-gray-500'}>{formatPercent(dod)}</span></td>
                        <td className="py-2 px-2 text-center"><button onClick={() => { setLookupRows([{ id: generateId(), date: h.date }, ...lookupRows]); showToast("조회 목록 복사"); }} className="text-blue-400"><ArrowDownToLine size={12} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-y border-gray-700 bg-[#0f172a] flex justify-start items-center shrink-0 shadow-sm z-20">
              <span className="text-xs text-white font-bold select-none tracking-widest">지정일 자산추이</span>
            </div>
            <div className="flex-1 overflow-x-auto overflow-y-auto bg-[#1e293b]">
              <table className="w-full min-w-max text-right text-[13px] table-auto border-collapse whitespace-nowrap">
                <thead className="bg-[#1e293b] text-gray-500 border-b border-gray-700/50 sticky top-0 z-10">
                  <tr>
                    <th className="py-1.5 px-3 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-1.5 px-3 border-r border-gray-700 text-center font-normal">평가자산</th>
                    <th className="py-1.5 px-3 border-r border-gray-700 text-center font-normal cursor-help" title={comparisonMode === 'latestOverPast' ? '(현재/과거)-1 (%)' : '1- (과거/현재) (%)'}>
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setComparisonMode('latestOverPast')} className={`p-0.5 rounded transition-colors ${comparisonMode === 'latestOverPast' ? 'text-blue-400 bg-blue-900/30' : 'text-gray-600 hover:text-gray-400'}`} title="(현재/과거)-1 (%)"><Triangle size={10} fill={comparisonMode === 'latestOverPast' ? "currentColor" : "none"} /></button>
                        <button onClick={() => setComparisonMode('pastOverLatest')} className={`p-0.5 rounded transition-colors ${comparisonMode === 'pastOverLatest' ? 'text-red-400 bg-red-900/30' : 'text-gray-600 hover:text-gray-400'}`} title="1- (과거/현재) (%)"><Triangle size={10} className="rotate-180" fill={comparisonMode === 'pastOverLatest' ? "currentColor" : "none"} /></button>
                      </div>
                    </th>
                    <th className="py-1.5 px-2 text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setLookupRows(prev => [{ id: generateId(), date: "" }, ...prev])} className="text-blue-400 hover:text-white transition-colors" title="빈 조회 행 맨 위 추가"><Plus size={12} /></button>
                        <button onClick={handleLookupDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="이 표 엑셀 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const currentTotalEval = totals.totalEval;
                    return lookupRows.length === 0 ? (
                      <tr><td colSpan="4" className="py-6 text-center text-gray-500 font-bold bg-gray-800/20">지정일 데이터가 없습니다.<br /><span className="text-[10px] font-normal mt-1 inline-block text-gray-600">위 표의 추가 아이콘을 눌러주세요.</span></td></tr>
                    ) : (
                      lookupRows.slice().sort((a, b) => {
                        const tA = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER;
                        const tB = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER;
                        return tB - tA;
                      }).map((row) => {
                        const lookupRecord = history.find(h => h.date === row.date);
                        return (
                          <tr key={row.id} className="bg-gray-800/60 border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors">
                            <td className="py-1 px-2 text-center border-r border-gray-700 align-middle">
                              <input type="date" className="w-full max-w-[120px] bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-xs text-gray-300 outline-none focus:border-blue-500 transition-colors cursor-pointer mx-auto block" value={row.date || ''} onChange={e => setLookupRows(lookupRows.map(r => r.id === row.id ? { ...r, date: e.target.value } : r))} />
                            </td>
                            {lookupRecord ? (() => {
                              const validRecords = lookupRows.map(r => history.find(h => h.date === r.date)).filter(Boolean);
                              let oldestEval = 0;
                              if (validRecords.length > 0) oldestEval = validRecords.reduce((min, curr) => new Date(curr.date) < new Date(min.date) ? curr : min).evalAmount;
                              const pastEval = lookupRecord.evalAmount;
                              let compareRate = comparisonMode === 'latestOverPast'
                                ? (oldestEval > 0 ? ((pastEval / oldestEval) - 1) * 100 : 0)
                                : (currentTotalEval > 0 ? (1 - (pastEval / currentTotalEval)) * 100 : 0);
                              return (
                                <>
                                  <td className="py-1.5 px-3 border-r border-gray-600 font-bold text-white text-right">{formatCurrency(pastEval)}</td>
                                  <td className="py-1.5 px-3 border-r border-gray-600 text-center font-bold"><span className={compareRate >= 0 ? 'text-red-400' : 'text-blue-400'}>{formatPercent(compareRate)}</span></td>
                                </>
                              );
                            })() : (<td colSpan="2" className="py-1.5 px-3 text-center text-gray-500 font-bold border-r border-gray-700">기록 없음</td>)}
                            <td className="py-1.5 px-2 text-center"><button onClick={() => setLookupRows(lookupRows.filter(r => r.id !== row.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                          </tr>
                        );
                      })
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* 입금 내역 */}
          <div className="flex-1 w-full bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden">
            <div className="p-2 bg-[#0f172a] text-white font-bold flex items-center justify-between text-xs border-b border-gray-700 shrink-0">
              <span>💰 입금 내역</span>
              {activePortfolioAccountType === 'overseas' && marketIndicators.usdkrw > 0 && <span className="text-sky-400 font-bold text-[11px]">$1 = ₩{Math.round(marketIndicators.usdkrw).toLocaleString()}</span>}
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-right text-[11px] table-fixed">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-2.5 w-[70px] text-center border-r border-gray-600 font-normal cursor-pointer hover:bg-gray-700" onClick={() => handleDepositSort('date')}>일자{sortArrow(depositSortConfig, 'date')}</th>
                    <th className="py-2.5 border-r border-gray-600 px-1 w-[80px] text-blue-300 font-normal text-center cursor-pointer hover:bg-gray-700" onClick={() => handleDepositSort('amount')}>{activePortfolioAccountType === 'overseas' ? '금액($)' : '금액'}{sortArrow(depositSortConfig, 'amount')}</th>
                    {activePortfolioAccountType === 'overseas' && <th className="py-2.5 border-r border-gray-600 px-1 w-[70px] text-sky-400 font-normal text-center">환율</th>}
                    <th className="py-2.5 border-r border-gray-600 px-1 w-[90px] text-yellow-400 font-normal text-center">{activePortfolioAccountType === 'overseas' ? '합계($)' : '합계'}</th>
                    <th className="py-2.5 border-r border-gray-600 text-center px-2 font-normal">메모</th>
                    <th className="py-2.5 w-[45px] text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDepositHistory([{ id: generateId(), date: new Date().toISOString().split('T')[0], amount: 0, fxRate: marketIndicators.usdkrw || 1, memo: "" }, ...depositHistory])} className="text-blue-400 hover:text-white transition-colors" title="행 추가"><Plus size={12} /></button>
                        <button onClick={handleDepositDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="입금 내역 CSV 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {depositWithSumSorted.map((h) => (
                    <tr key={h.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2 border-r border-gray-600 align-middle relative">
                        <div className="flex items-center justify-center font-mono text-[10px] text-gray-300 gap-1 pointer-events-none">{formatVeryShortDate(h.date)}<Calendar size={10} className="text-gray-500" /></div>
                        <input type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" value={h.date} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].date = e.target.value; setDepositHistory(n); }} />
                      </td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d1amount" className={`w-full bg-transparent text-right outline-none font-bold px-1 py-2 caret-blue-400 ${cleanNum(h.amount) >= 0 ? 'text-blue-300' : 'text-red-300'}`} value={activePortfolioAccountType === 'overseas' ? cleanNum(h.amount).toFixed(2) : formatNumber(h.amount)} onFocus={e => e.target.select()} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].amount = cleanNum(e.target.value); setDepositHistory(n); }} onKeyDown={e => handleTableKeyDown(e, 'd1amount')} />
                      </td>
                      {activePortfolioAccountType === 'overseas' && (
                        <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-500">
                          <input type="text" data-col="d1fxRate" className="w-full bg-transparent text-right outline-none font-bold px-1 py-2 text-sky-400 caret-sky-400" value={h.fxRate || ''} placeholder={(marketIndicators.usdkrw || 1400).toFixed(0)} onFocus={e => e.target.select()} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].fxRate = cleanNum(e.target.value); setDepositHistory(n); }} onKeyDown={e => handleTableKeyDown(e, 'd1fxRate')} />
                        </td>
                      )}
                      <td className="py-2 px-1 border-r border-gray-600 font-bold text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end leading-tight"><span className="text-yellow-400">${cleanNum(h.cumulative).toFixed(2)}</span><span className="text-[10px] text-gray-500">{formatCurrency(cleanNum(h.cumulative) * (marketIndicators.usdkrw || 1))}</span></div> : <span className="text-yellow-400">{formatCurrency(h.cumulative)}</span>}</td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d1memo" className="w-full bg-transparent outline-none px-2 py-2 text-gray-300 text-[11px] caret-blue-400" value={h.memo} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].memo = e.target.value; setDepositHistory(n); }} onKeyDown={e => handleTableKeyDown(e, 'd1memo')} />
                      </td>
                      <td className="py-2 text-center"><button onClick={() => setDepositHistory(depositHistory.filter(x => x.id !== h.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 출금 내역 */}
          <div className="flex-1 w-full bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden">
            <div className="p-2 bg-[#0f172a] text-white font-bold flex items-center justify-between text-xs border-b border-gray-700 shrink-0">
              <span>💰 출금 내역</span>
              {activePortfolioAccountType === 'overseas' && marketIndicators.usdkrw > 0 && <span className="text-sky-400 font-bold text-[11px]">$1 = ₩{Math.round(marketIndicators.usdkrw).toLocaleString()}</span>}
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-right text-[11px] table-fixed">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-2.5 w-[70px] text-center border-r border-gray-600 font-normal cursor-pointer hover:bg-gray-700" onClick={() => handleDepositSort2('date')}>일자{sortArrow(depositSortConfig2, 'date')}</th>
                    <th className="py-2.5 border-r border-gray-600 px-1 w-[80px] text-blue-300 font-normal text-center cursor-pointer hover:bg-gray-700" onClick={() => handleDepositSort2('amount')}>{activePortfolioAccountType === 'overseas' ? '금액($)' : '금액'}{sortArrow(depositSortConfig2, 'amount')}</th>
                    {activePortfolioAccountType === 'overseas' && <th className="py-2.5 border-r border-gray-600 px-1 w-[70px] text-sky-400 font-normal text-center">환율</th>}
                    <th className="py-2.5 border-r border-gray-600 px-1 w-[90px] text-yellow-400 font-normal text-center">{activePortfolioAccountType === 'overseas' ? '합계($)' : '합계'}</th>
                    <th className="py-2.5 border-r border-gray-600 text-center px-2 font-normal">메모</th>
                    <th className="py-2.5 w-[45px] text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDepositHistory2([{ id: generateId(), date: new Date().toISOString().split('T')[0], amount: 0, fxRate: marketIndicators.usdkrw || 1, memo: "" }, ...depositHistory2])} className="text-blue-400 hover:text-white transition-colors" title="행 추가"><Plus size={12} /></button>
                        <button onClick={handleWithdrawDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="출금 내역 CSV 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {depositWithSum2Sorted.map((h) => (
                    <tr key={h.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2 border-r border-gray-600 align-middle relative">
                        <div className="flex items-center justify-center font-mono text-[10px] text-gray-300 gap-1 pointer-events-none">{formatVeryShortDate(h.date)}<Calendar size={10} className="text-gray-500" /></div>
                        <input type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" value={h.date} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].date = e.target.value; setDepositHistory2(n); }} />
                      </td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d2amount" className={`w-full bg-transparent text-right outline-none font-bold px-1 py-2 caret-blue-400 ${cleanNum(h.amount) >= 0 ? 'text-blue-300' : 'text-red-300'}`} value={activePortfolioAccountType === 'overseas' ? cleanNum(h.amount).toFixed(2) : formatNumber(h.amount)} onFocus={e => e.target.select()} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].amount = cleanNum(e.target.value); setDepositHistory2(n); }} onKeyDown={e => handleTableKeyDown(e, 'd2amount')} />
                      </td>
                      {activePortfolioAccountType === 'overseas' && (
                        <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-500">
                          <input type="text" data-col="d2fxRate" className="w-full bg-transparent text-right outline-none font-bold px-1 py-2 text-sky-400 caret-sky-400" value={h.fxRate || ''} placeholder={(marketIndicators.usdkrw || 1400).toFixed(0)} onFocus={e => e.target.select()} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].fxRate = cleanNum(e.target.value); setDepositHistory2(n); }} onKeyDown={e => handleTableKeyDown(e, 'd2fxRate')} />
                        </td>
                      )}
                      <td className="py-2 px-1 border-r border-gray-600 font-bold text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end leading-tight"><span className="text-yellow-400">${cleanNum(h.cumulative).toFixed(2)}</span><span className="text-[10px] text-gray-500">{formatCurrency(cleanNum(h.cumulative) * (marketIndicators.usdkrw || 1))}</span></div> : <span className="text-yellow-400">{formatCurrency(h.cumulative)}</span>}</td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d2memo" className="w-full bg-transparent outline-none px-2 py-2 text-gray-300 text-[11px] caret-blue-400" value={h.memo} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].memo = e.target.value; setDepositHistory2(n); }} onKeyDown={e => handleTableKeyDown(e, 'd2memo')} />
                      </td>
                      <td className="py-2 text-center"><button onClick={() => setDepositHistory2(depositHistory2.filter(x => x.id !== h.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
              indicatorFetchStatus={indicatorFetchStatus}
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
              appliedRange={appliedRange}
              onUploadIndicator={handleIndicatorUpload}
              onFetchAll={fetchAllIndicatorHistory}
            />
          )}

          {/* 차트 본체 */}
          <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg flex-1 min-w-0 flex flex-col">
            <div className="p-3 bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700 flex flex-col shrink-0 gap-3">
              {/* 사이트 링크 버튼 */}
              {(() => {
                const isOverseasChart = activePortfolioAccountType === 'overseas';
                const activeLinks = isOverseasChart ? overseasLinks : customLinks;
                const setActiveLinks = isOverseasChart ? setOverseasLinks : setCustomLinks;
                return (
                  <>
                    <div className="flex items-center gap-1.5">
                      {activeLinks.slice(0, 3).map((link, i) => {
                        const label = link.name?.trim() ? link.name.trim().slice(0, 7) : extractLinkLabel(link.url);
                        return (
                          <button key={i} onClick={() => link.url && window.open(link.url.startsWith('http') ? link.url : 'https://' + link.url, '_blank')} className={`bg-gray-800 hover:bg-gray-700 text-blue-300 h-[28px] rounded shadow transition border border-gray-600 flex items-center justify-center font-bold tracking-tight ${label ? 'px-2 text-[11px] min-w-[28px]' : 'w-[28px] text-xs'}`} title={link.url || `버튼 ${i + 1} 설정 필요`}>{label ?? (i + 1)}</button>
                        );
                      })}
                      <button onClick={() => setIsLinkSettingsOpen(!isLinkSettingsOpen)} className="bg-gray-800 hover:bg-gray-700 text-gray-400 w-[30px] h-[30px] rounded shadow transition border border-gray-600 flex items-center justify-center" title="퀵 링크 설정"><Settings size={14} /></button>
                    </div>
                    {isLinkSettingsOpen && (
                      <div className="flex flex-wrap gap-3 pb-1 border-b border-gray-700/50">
                        {isOverseasChart && <div className="w-full text-[10px] text-sky-400/70 font-bold">🌐 해외계좌 전용 링크 (다른 계좌에 영향 없음)</div>}
                        {activeLinks.slice(0, 3).map((l, i) => (
                          <div key={i} className="flex flex-col gap-1.5 flex-1 min-w-[160px] max-w-[240px]">
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-gray-500 font-bold ml-1">버튼 {i + 1} 이름 <span className="text-gray-600 font-normal">(직접 입력, 최대 7자)</span></span>
                              <input type="text" maxLength={7} className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-400 shadow-inner font-normal" value={l.name || ''} onChange={(e) => { const n = [...activeLinks]; n[i] = { ...n[i], name: e.target.value }; setActiveLinks(n); }} placeholder="비워두면 URL에서 자동 추출" />
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-gray-500 font-bold ml-1">버튼 {i + 1} 연결 (URL)</span>
                              <input type="text" className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-500 shadow-inner font-normal" value={l.url} onChange={(e) => { const n = [...activeLinks]; n[i] = { ...n[i], url: e.target.value }; setActiveLinks(n); }} placeholder="https://..." />
                            </div>
                          </div>
                        ))}
                        <button onClick={() => setIsLinkSettingsOpen(false)} className="self-end bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition">완료</button>
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {/* gold 계좌: 고정 지표 4개 칩 / 그 외: 비교종목 칩 */}
                  {!userFeatures.feature1 && activePortfolioAccountType === 'gold' && (
                    <div className="flex flex-wrap items-center gap-2">
                      {([
                        { key: 'goldIntl', label: 'Gold(국제)', color: '#ffd60a' },
                        { key: 'goldKr',   label: '국내금(KRX)', color: '#ff9f0a' },
                        { key: 'usdkrw',  label: 'USD/KRW', color: '#0a84ff' },
                        { key: 'dxy',     label: 'DXY', color: '#5ac8fa' },
                      ] as { key: keyof typeof goldIndicators; label: string; color: string }[]).map(({ key, label, color }) => {
                        const active = goldIndicators[key];
                        const loading = indicatorHistoryLoading[key];
                        return (
                          <div
                            key={key}
                            className="flex items-center gap-0 rounded-md overflow-hidden shrink-0 border cursor-pointer transition-colors select-none"
                            style={{ borderColor: active ? color : '#4b5563', backgroundColor: active ? `${color}22` : '#1f2937' }}
                            onClick={() => {
                              if (!indicatorHistoryMap[key]) fetchIndicatorHistory(key, null, null);
                              setGoldIndicators(p => ({ ...p, [key]: !p[key] }));
                            }}
                          >
                            <div className="w-2 h-2 rounded-full mx-2 shrink-0" style={{ backgroundColor: color }} />
                            <span className="pr-2.5 py-1.5 text-[10px] font-bold" style={{ color: active ? color : '#6b7280' }}>{label}</span>
                            {loading && <RefreshCw size={10} className="animate-spin mr-1.5 text-gray-400" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && <div className="flex flex-wrap items-center gap-2">
                    {compStocks.map((comp, idx) => {
                      const histKeys = comp.active && stockHistoryMap[comp.code] ? Object.keys(stockHistoryMap[comp.code]).sort() : [];
                      const isFallback = comp.active && histKeys.length === 1;
                      // 데이터가 있지만 조회 시작일보다 늦게 시작 → 재조회 필요 (단, 상장일까지 이미 조회된 경우 제외)
                      const listingDate = stockListingDates[comp.code];
                      const needsCoverage = comp.active && histKeys.length > 1 && !!appliedRange.start && histKeys[0] > appliedRange.start && !listingDate;
                      const hasIssue = isFallback || needsCoverage;
                      const color = comp.color || '#10b981';
                      const borderColor = comp.active ? (hasIssue ? '#f97316' : color) : '#4b5563';
                      const bgColor = comp.active ? (hasIssue ? 'rgba(249,115,22,0.1)' : `${color}22`) : '#1f2937';
                      const textColor = comp.active ? (hasIssue ? '#fb923c' : color) : '#6b7280';
                      const refreshTitle = isFallback ? '조회기간 전체 이력 불러오기' : needsCoverage ? `조회기간(${appliedRange.start}) 이전 데이터 없음 — 전체 이력 재조회` : '데이터 장애 시 강제 재조회';
                      return (
                        <div key={idx} className="flex items-center gap-0 rounded-md overflow-hidden shrink-0 transition-colors border" style={{ borderColor, backgroundColor: bgColor }}>
                          {/* 컬러 인디케이터 + 숨겨진 color picker */}
                          <div className="relative flex items-center justify-center w-5 self-stretch border-r border-gray-700/50 hover:bg-gray-700/30 transition-colors" title="선 색상 변경">
                            <div className="w-2.5 h-2.5 rounded-full shadow-sm pointer-events-none" style={{ backgroundColor: color }} />
                            <input
                              type="color"
                              value={color}
                              onChange={e => { const n = [...compStocks]; n[idx] = { ...n[idx], color: e.target.value }; setCompStocks(n); }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                          </div>
                          <input type="text" className="bg-transparent text-[10px] px-2 py-1.5 outline-none text-center font-mono placeholder-gray-500 border-r transition-colors" style={{ width: '50px', borderColor, color: comp.active ? textColor : '#93c5fd' }} placeholder="코드" value={comp.code} onChange={e => { const n = [...compStocks]; n[idx] = { ...n[idx], code: e.target.value }; setCompStocks(n); }} onBlur={e => handleCompStockBlur(idx, e.target.value)} />
                          <button onClick={() => handleToggleComp(idx)} className="px-3 py-1.5 text-[10px] font-bold transition-colors min-w-[65px] max-w-[100px] truncate flex justify-center items-center gap-0.5" style={{ color: comp.loading ? '#9ca3af' : textColor, backgroundColor: comp.loading ? '#374151' : 'transparent', cursor: comp.loading ? 'wait' : 'pointer' }}>{comp.loading ? <RefreshCw size={12} className="animate-spin" /> : (comp.name || `종목${idx + 1}`)}<CompStockDot code={comp.code} /></button>
                          {comp.active && (
                            <button
                              onClick={() => { autoFetchedCodes.current.delete(comp.code); setStockListingDates(prev => { const n = { ...prev }; delete n[comp.code]; return n; }); handleFetchCompHistory(idx); }}
                              className={`px-1.5 py-1.5 transition-colors border-l ${hasIssue ? 'text-orange-400 hover:text-orange-200 hover:bg-orange-900/30 border-orange-700/40' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-700/40 border-gray-700/40'}`}
                              title={refreshTitle}
                            >
                              <RefreshCw size={10} />
                            </button>
                          )}
                          {compStocks.length > 1 && (
                            <button
                              onClick={() => handleRemoveCompStock(idx)}
                              className="px-1.5 py-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors border-l border-gray-700/40"
                              title="종목 제거"
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {compStocks.length < 8 && (
                      <button
                        onClick={handleAddCompStock}
                        className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-bold text-gray-500 hover:text-green-400 hover:bg-green-900/20 border border-gray-700 hover:border-green-700/50 transition-colors"
                        title="비교 종목 추가"
                      >
                        <Plus size={11} />
                        <span>추가</span>
                      </button>
                    )}
                    <button onClick={() => setShowIndexVerify(!showIndexVerify)} className={`px-2 py-1.5 rounded text-[11px] font-bold transition-colors flex items-center gap-1 ml-1 ${showIndexVerify ? 'bg-blue-900/50 text-blue-300 border border-blue-500/50' : 'bg-transparent text-gray-500 hover:bg-gray-700 border border-gray-700'}`} title="지수 데이터 검증">
                      <Search size={12} />
                    </button>
                  </div>}
                </div>
                <div className="flex items-center justify-end gap-3 w-full xl:w-auto">
                  <div className="flex items-center bg-gray-800 border border-gray-600 rounded shadow-sm px-1.5 py-1 relative z-30">
                    <CustomDatePicker
                      value={dateRange.start}
                      onChange={v => { setDateRange(p => ({ ...p, start: v })); setChartPeriod('custom'); }}
                    />
                    <span className="text-gray-500 mx-0.5">~</span>
                    <CustomDatePicker
                      value={dateRange.end}
                      onChange={v => { setDateRange(p => ({ ...p, end: v })); setChartPeriod('custom'); }}
                    />
                    <div className="w-[1px] h-4 bg-gray-600 mx-1.5"></div>
                    <button onClick={handleSearchClick} className="text-blue-400 hover:text-blue-300 hover:bg-gray-700 rounded p-1.5 transition-colors" title="조회">
                      <Search size={14} />
                    </button>
                  </div>
                  <select value={chartPeriod} onChange={e => setChartPeriod(e.target.value)} className="bg-gray-800 text-gray-300 text-xs font-bold border border-gray-600 rounded px-2 py-1.5 outline-none cursor-pointer hover:bg-gray-700 transition-colors shadow-sm"><option value="1w">1주일</option><option value="1m">1개월</option><option value="3m">3개월</option><option value="6m">6개월</option><option value="1y">1년</option><option value="2y">2년</option><option value="3y">3년</option><option value="4y">4년</option><option value="5y">5년</option><option value="10y">10년</option><option value="all">전체</option><option value="custom" hidden>직접입력</option></select>
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-700/50">
                <div className="flex items-center gap-1">
                  {/* 자산 총액 */}
                  <button
                    onClick={() => setShowTotalEval(!showTotalEval)}
                    className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showTotalEval ? 'text-gray-300 bg-gray-800 border-gray-600' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
                    title="자산 총액 표시"
                  ><BarChart2 size={14} /></button>
                  {/* 수익률 % */}
                  <button
                    onClick={() => setShowReturnRate(!showReturnRate)}
                    className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showReturnRate ? 'text-red-400 bg-red-900/20 border-red-700/40' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
                    title="수익률(%) 표시"
                  ><Percent size={14} /></button>
                  {/* 백테스트: 좌측=색상선택 / 우측=토글 — 하나의 통합 버튼 */}
                  <div
                    className="flex items-stretch rounded border overflow-hidden transition-colors"
                    style={{ borderColor: showBacktest ? backtestColor + '80' : '#374151', height: '29px' }}
                  >
                    {/* 좌측: 색상 스트라이프 — 클릭 시 색상 선택 */}
                    <div
                      className="relative w-[10px] shrink-0 cursor-pointer hover:opacity-75 transition-opacity"
                      style={{ backgroundColor: backtestColor }}
                      title="백테스트 선 색상 변경"
                    >
                      <input type="color" value={backtestColor} onChange={e => setBacktestColor(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    </div>
                    {/* 우측: 아이콘 — 클릭 시 백테스트 토글 */}
                    <button
                      onClick={() => setShowBacktest(!showBacktest)}
                      className="px-2 flex items-center justify-center transition-colors hover:opacity-80"
                      style={{ color: showBacktest ? backtestColor : '#6b7280', backgroundColor: showBacktest ? backtestColor + '18' : '#1e293b' }}
                      title="현재 종목·비중을 조회기간 시작일부터 투자 시 수익률 (백테스트)"
                    ><History size={13} /></button>
                  </div>
                  <div className="w-px h-3 bg-gray-700 mx-0.5" />
                  {/* 기준점 모드 */}
                  <button
                    onClick={() => setIsZeroBaseMode(!isZeroBaseMode)}
                    className={`p-1.5 rounded border flex items-center justify-center transition-colors ${isZeroBaseMode ? 'text-green-400 bg-green-900/20 border-green-700/40' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
                    title="조회 시작일을 0% 기준으로 차트 재정렬"
                  ><Activity size={14} /></button>
                  {/* 시장 지표 패널 토글 */}
                  {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && (<>
                    <div className="w-px h-3 bg-gray-700 mx-0.5" />
                    <button
                      onClick={() => setShowMarketPanel(p => !p)}
                      className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showMarketPanel ? 'text-blue-400 bg-blue-900/20 border-blue-700/40' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
                      title={showMarketPanel ? '시장 지표 숨기기' : '시장 지표 표시'}
                    >{showMarketPanel ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}</button>
                  </>)}
                </div>
                {/* 지표 배율 설정 버튼 */}
                <button
                  onClick={() => setIsScaleSettingOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all bg-indigo-900/40 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-800/60"
                  title="지표별 변동폭 배율 설정"
                >
                  ⚙️ 지표 배율 설정
                </button>
              </div>

              {showIndexVerify && (
                <div className="mt-2 border-t border-gray-700/50 pt-3 animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                       <span className="text-[11px] text-blue-300 font-bold">📊 종목 데이터 검증</span>
                       <span className="text-[10px] text-gray-500">새로고침(🔄) 버튼으로 최신 데이터 수집 | 🟢 정상 🟡 부분/구형 🔴 실패 ⚪ 미수집</span>
                    </div>
                    <button onClick={() => setShowIndexVerify(false)} className="text-gray-500 hover:text-white p-1"><X size={12} /></button>
                  </div>
                  <div className="mb-3 p-2 bg-gray-800/60 rounded-lg border border-gray-700 text-[10px] text-gray-400 leading-relaxed">
                    <span className="text-yellow-400 font-bold">📥 수동 CSV 업로드 방법:</span>
                    <span className="ml-2">주황색 📤 버튼 → CSV 파일 선택. 파일명에 </span>
                    <span className="text-yellow-300 font-bold">KOSPI</span> / <span className="text-purple-300 font-bold">SP500</span> / <span className="text-teal-300 font-bold">NASDAQ</span>
                    <span className="ml-1">포함 필요.</span>
                    <span className="ml-2 text-gray-500">지원형식: 네이버증권 / investing.com / stooq CSV</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] border-collapse min-w-[600px]">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700">
                          <th className="py-1.5 px-3 text-left font-normal">지수/종목</th>
                          <th className="py-1.5 px-3 text-center font-normal">상태</th>
                          <th className="py-1.5 px-3 text-center font-normal">출처</th>
                          <th className="py-1.5 px-3 text-right font-normal">데이터 건수</th>
                          <th className="py-1.5 px-3 text-center font-normal">최신일자</th>
                          <th className="py-1.5 px-3 text-right font-normal">최신값</th>
                          <th className="py-1.5 px-3 text-center font-normal">오늘과의 차이</th>
                          <th className="py-1.5 px-3 text-center font-normal">수집시각</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* 비교 종목 검증 데이터 추가 */}
                        {compStocks.filter(c => c.code && c.active).map((comp, idx) => {
                           const hist = stockHistoryMap[comp.code];
                           const hasData = hist && Object.keys(hist).length > 0;
                           const actualStatus = hasData ? buildIndexStatus(hist, '종목데이터') : null;
                           
                           const statusBadge = !actualStatus ? (
                            <span className="text-gray-500">⚪ 미수집</span>
                          ) : actualStatus.status === 'success' ? (
                            <span className="text-green-400">🟢 정상</span>
                          ) : actualStatus.status === 'partial' ? (
                            <span className="text-yellow-400">🟡 현재가만</span>
                          ) : (
                            <span className="text-red-400">🔴 실패</span>
                          );
                          const gapText = actualStatus?.gapDays != null
                            ? (actualStatus.gapDays === 0 ? '오늘' : actualStatus.gapDays <= 3 ? `${actualStatus.gapDays}일 전 (정상)` : actualStatus.gapDays <= 7 ? `${actualStatus.gapDays}일 전 ⚠️` : `${actualStatus.gapDays}일 전 ❌`)
                            : '-';
                          const gapColor = actualStatus?.gapDays != null
                            ? (actualStatus.gapDays <= 3 ? 'text-green-400' : actualStatus.gapDays <= 7 ? 'text-yellow-400' : 'text-red-400')
                            : 'text-gray-500';

                           return (
                             <tr key={`comp-${idx}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                              <td className={`py-2 px-3 font-bold text-gray-300`}>{comp.name || comp.code} <span className="text-[9px] text-gray-500 font-mono ml-1">({comp.code})</span></td>
                              <td className="py-2 px-3 text-center">{statusBadge}</td>
                              <td className="py-2 px-3 text-center text-gray-400">{actualStatus?.source || '-'}</td>
                              <td className="py-2 px-3 text-right text-gray-300 font-mono">{actualStatus?.count ? `${actualStatus.count.toLocaleString()}건` : '-'}</td>
                              <td className="py-2 px-3 text-center text-gray-300 font-mono">{actualStatus?.latestDate || '-'}</td>
                              <td className="py-2 px-3 text-right text-white font-bold font-mono">
                                {actualStatus?.latestValue ? actualStatus.latestValue.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '-'}
                              </td>
                              <td className={`py-2 px-3 text-center font-bold ${gapColor}`}>{gapText}</td>
                              <td className="py-2 px-3 text-center text-gray-500">{actualStatus?.updatedAt || '-'}</td>
                            </tr>
                           )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 text-[10px] text-gray-600 flex flex-wrap gap-3">
                    <span>💡 오늘과의 차이가 3일 이하면 정상 | 4~7일: 주의 | 8일 이상: 재수집 필요</span>
                    <span>💾 백업 파일 저장 시 수집된 지수 데이터도 함께 저장됩니다</span>
                    <span>📥 직접 수집 실패 시 Colab 버튼으로 JSON 파일 다운 후 주입 가능</span>
                  </div>
                </div>
              )}
            </div>

            {/* 호버 정보 패널 */}
            <div className="px-4 py-2 border-t border-gray-700/40 bg-[#0a1628]/60 min-h-[36px] flex items-center gap-3 overflow-x-auto shrink-0">
              {hoveredPoint ? (
                <>
                  <span className="text-gray-400 text-[11px] font-bold shrink-0 mr-1">{formatShortDate(hoveredPoint.label)}</span>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                    {hoveredPoint.payload
                      .filter(entry => entry.dataKey && !String(entry.dataKey).endsWith('Point') && entry.value != null)
                      .map((entry, i) => {
                        const dk = entry.dataKey as string;
                        const rawValue = entry.value;
                        const value = dk?.endsWith('RateScaled')
                          ? (entry.payload?.[dk.replace('RateScaled', 'Rate')] ?? rawValue)
                          : rawValue;
                        let displayVal: string;
                        if (entry.name === '총자산') {
                          displayVal = formatNumber(rawValue);
                        } else {
                          const pointKey = CHART_NAME_TO_POINT_KEY[entry.name];
                          let pointVal = pointKey && entry.payload ? entry.payload[pointKey] : null;
                          const inlineCompMatch = dk?.match(/^comp(\d+)Rate$/);
                          if (pointVal == null && inlineCompMatch && entry.payload) {
                            pointVal = entry.payload[`comp${inlineCompMatch[1]}Point`];
                          }
                          const sign = Number(value) >= 0 ? '+' : '';
                          const rateStr = `${sign}${Number(value).toFixed(2)}%`;
                          if (pointVal != null) {
                            const isComp = !!inlineCompMatch;
                            const priceStr = isComp ? Number(pointVal).toLocaleString() : Number(pointVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            displayVal = `${rateStr} (${priceStr})`;
                          } else {
                            displayVal = rateStr;
                          }
                        }
                        return (
                          <div key={i} className="flex items-center gap-1.5 shrink-0">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: entry.color || '#e5e7eb' }} />
                            <span className="text-[11px] font-bold" style={{ color: entry.color || '#e5e7eb' }}>{entry.name}</span>
                            <span className="text-[11px] text-gray-300">{displayVal}</span>
                          </div>
                        );
                      })}
                  </div>
                </>
              ) : (
                <span className="text-gray-600 text-[10px]">차트에 마우스를 올리면 상세 값이 표시됩니다</span>
              )}
            </div>

            {/* 드래그 기간 선택 결과 패널 */}
            <div className="px-4 py-2 border-t border-gray-700/40 bg-[#060f1e]/70 min-h-[36px] shrink-0">
              {selectionResult ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-[10px] font-bold shrink-0">선택 기간</span>
                    <span className="text-gray-300 text-[11px] font-bold">{formatShortDate(selectionResult.startDate)} ~ {formatShortDate(selectionResult.endDate)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm bg-red-500 shrink-0" />
                      <span className="text-[11px] font-bold text-gray-300">나의 수익</span>
                      <span className={`text-[12px] font-black ${selectionResult.profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {selectionResult.rate > 0 ? '+' : selectionResult.rate < 0 ? '' : ''}{selectionResult.rate.toFixed(2)}%
                      </span>
                      <span className={`text-[10px] font-bold ${selectionResult.profit >= 0 ? 'text-red-300/80' : 'text-blue-300/80'}`}>
                        ({selectionResult.profit >= 0 ? '+' : ''}{formatCurrency(selectionResult.profit)})
                      </span>
                    </div>
                    {showBacktest && selectionResult.backtestPeriodRate != null && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: backtestColor }} />
                        <span className="text-[11px] font-bold text-gray-300">백테스트</span>
                        <span className={`text-[12px] font-black ${selectionResult.backtestPeriodRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                          {selectionResult.backtestPeriodRate > 0 ? '+' : ''}{selectionResult.backtestPeriodRate.toFixed(2)}%
                        </span>
                      </div>
                    )}
                  </div>
                  {compStocks.some(c => c.active && c.code) && (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                      {compStocks.map((comp, ci) => {
                        if (!comp.active || !comp.code) return null;
                        const rate = selectionResult[`comp${ci + 1}PeriodRate`];
                        if (rate == null) return null;
                        const startPt = finalChartData.find(d => d.date === selectionResult.startDate)?.[`comp${ci + 1}Point`];
                        const endPt = finalChartData.find(d => d.date === selectionResult.endDate)?.[`comp${ci + 1}Point`];
                        return (
                          <div key={comp.id} className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: comp.color || '#10b981' }} />
                            <span className="text-[11px] font-bold" style={{ color: comp.color || '#10b981' }}>{comp.name}</span>
                            <span className={`text-[12px] font-black ${rate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                              {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
                            </span>
                            {startPt != null && endPt != null && (
                              <span className="text-[10px] text-gray-500 font-mono">
                                ({Number(startPt).toLocaleString()} → {Number(endPt).toLocaleString()})
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-gray-600 text-[10px]">차트를 드래그하면 기간별 수익이 표시됩니다</span>
              )}
            </div>

            <div className="chart-container-for-drag p-4 h-[400px] xl:flex-1 xl:h-auto relative select-none">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={finalChartData} onMouseDown={handleChartMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp} onMouseLeave={handleChartMouseLeave}>
                  <defs>
                    <filter id="neonGlow">
                      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                      <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                      </feMerge>
                    </filter>
                    <linearGradient id="vixGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff453a" stopOpacity={0.3}/>
                      <stop offset="50%" stopColor="#ff453a" stopOpacity={0.1}/>
                      <stop offset="100%" stopColor="#ff453a" stopOpacity={0.02}/>
                    </linearGradient>
                    <linearGradient id="backtestGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={backtestColor} stopOpacity={0.35}/>
                      <stop offset="95%" stopColor={backtestColor} stopOpacity={0.02}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#9ca3af" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" stroke="#ef4444" tickFormatter={v => v + '%'} tick={{ fontSize: 10 }} />
                  {showTotalEval && <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" tickFormatter={v => v / 10000 + '만'} tick={{ fontSize: 10 }} />}
                  {effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <YAxis yAxisId="right-us10y" orientation="right" stroke="#8e8e93" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)} width={52} domain={['dataMin', 'dataMax']}><Label value="US 10Y" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#8e8e93', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <YAxis yAxisId="right-goldIntl" orientation="right" stroke="#ffd60a" tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={56} domain={['dataMin', 'dataMax']}><Label value="Gold" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ffd60a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && <YAxis yAxisId="right-goldKr" orientation="right" stroke="#ff9f0a" tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={62} domain={['dataMin', 'dataMax']}><Label value="국내금" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ff9f0a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <YAxis yAxisId="right-usdkrw" orientation="right" stroke="#0a84ff" tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={56} domain={['dataMin', 'dataMax']}><Label value="USD/KRW" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#0a84ff', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <YAxis yAxisId="right-dxy" orientation="right" stroke="#5ac8fa" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(1)} width={52} domain={['dataMin', 'dataMax']}><Label value="DXY" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#5ac8fa', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <YAxis yAxisId="right-fedRate" orientation="right" stroke="#ff375f" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)+'%'} width={54} domain={['dataMin', 'dataMax']}><Label value="기준금리" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ff375f', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <YAxis yAxisId="right-kr10y" orientation="right" stroke="#636366" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)+'%'} width={52} domain={['dataMin', 'dataMax']}><Label value="KR 10Y" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#636366', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.vix && indicatorHistoryMap.vix && <YAxis yAxisId="right-vix" orientation="right" stroke="#ff453a" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(1)} width={48} domain={['dataMin', 'dataMax']}><Label value="VIX" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ff453a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.btc && indicatorHistoryMap.btc && <YAxis yAxisId="right-btc" orientation="right" stroke="#f7931a" tick={{ fontSize: 9 }} tickFormatter={v => '$' + Math.round(v).toLocaleString()} width={72} domain={['dataMin', 'dataMax']}><Label value="BTC" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#f7931a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  {effectiveShowIndicators.eth && indicatorHistoryMap.eth && <YAxis yAxisId="right-eth" orientation="right" stroke="#627eea" tick={{ fontSize: 9 }} tickFormatter={v => '$' + Math.round(v).toLocaleString()} width={72} domain={['dataMin', 'dataMax']}><Label value="ETH" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#627eea', fontSize: 11, fontWeight: 500 }} /></YAxis>}
                  <RechartsTooltip content={() => null} />
                  {showTotalEval && <Area yAxisId="right" type="monotone" dataKey="evalAmount" name="총자산" fill="rgba(156, 163, 175, 0.1)" stroke="#9ca3af" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />}
                  {showReturnRate && <Area yAxisId="left" type="monotone" dataKey="returnRate" name="수익률" fill="rgba(239, 68, 68, 0.1)" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />}
                  {!userFeatures.feature1 && showKospi && <Line yAxisId="left" type="monotone" dataKey="kospiRate" name="KOSPI" stroke="#38bdf8" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
                  {!userFeatures.feature1 && showSp500 && <Line yAxisId="left" type="monotone" dataKey="sp500Rate" name="S&P500" stroke="#bf5af2" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
                  {!userFeatures.feature1 && showNasdaq && <Line yAxisId="left" type="monotone" dataKey="nasdaqRate" name="NASDAQ" stroke="#30d158" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
                  {!userFeatures.feature1 && effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <Line yAxisId="left" type="monotone" dataKey="us10yRateScaled" name="US 10Y" stroke="#8e8e93" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <Line yAxisId="right-us10y" dataKey="us10yPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <Line yAxisId="left" type="monotone" dataKey="goldIntlRateScaled" name="Gold" stroke="#ffd60a" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <Line yAxisId="right-goldIntl" dataKey="goldIntlPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && <Line yAxisId="left" type="monotone" dataKey="goldKrRateScaled" name="국내금" stroke="#ff9f0a" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && <Line yAxisId="right-goldKr" dataKey="goldKrPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <Line yAxisId="left" type="monotone" dataKey="usdkrwRateScaled" name="USDKRW" stroke="#0a84ff" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <Line yAxisId="right-usdkrw" dataKey="usdkrwPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <Line yAxisId="left" type="monotone" dataKey="dxyRateScaled" name="DXY" stroke="#5ac8fa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <Line yAxisId="right-dxy" dataKey="dxyPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <Line yAxisId="left" type="monotone" dataKey="fedRateRateScaled" name="기준금리" stroke="#ff375f" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <Line yAxisId="right-fedRate" dataKey="fedRatePoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <Line yAxisId="left" type="monotone" dataKey="kr10yRateScaled" name="KR 10Y" stroke="#636366" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <Line yAxisId="right-kr10y" dataKey="kr10yPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.vix && indicatorHistoryMap.vix && <Area yAxisId="left" type="monotone" dataKey="vixRateScaled" name="VIX" stroke="#ff453a" strokeWidth={1.5} fill="url(#vixGradient)" strokeDasharray="4 2" connectNulls dot={false} />}
                  {!userFeatures.feature1 && effectiveShowIndicators.vix && indicatorHistoryMap.vix && <Line yAxisId="right-vix" dataKey="vixPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.btc && indicatorHistoryMap.btc && <Line yAxisId="left" type="monotone" dataKey="btcRateScaled" name="Bitcoin" stroke="#f7931a" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.btc && indicatorHistoryMap.btc && <Line yAxisId="right-btc" dataKey="btcPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.eth && indicatorHistoryMap.eth && <Line yAxisId="left" type="monotone" dataKey="ethRateScaled" name="Ethereum" stroke="#627eea" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {!userFeatures.feature1 && effectiveShowIndicators.eth && indicatorHistoryMap.eth && <Line yAxisId="right-eth" dataKey="ethPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
                  {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && compStocks.map((comp, idx) =>
                    comp.active ? <Line key={comp.id} yAxisId="left" type="monotone" dataKey={`comp${idx + 1}Rate`} name={comp.name} stroke={comp.color || '#10b981'} strokeWidth={1.5} dot={false} connectNulls={false} /> : null
                  )}
                  {showBacktest && <Area yAxisId="left" type="monotone" dataKey="backtestRate" name="백테스트(현재비중)" stroke={backtestColor} strokeWidth={2} fill="url(#backtestGradient)" strokeDasharray="6 3" dot={false} connectNulls />}
                  {refAreaLeft && refAreaRight && <ReferenceArea yAxisId="left" x1={refAreaLeft} x2={refAreaRight} fill="rgba(255, 255, 255, 0.1)" strokeOpacity={0.3} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* 리밸런싱 시뮬레이터 */}
        {activePortfolioAccountType !== 'gold' && (
        <>
        <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg w-full flex flex-col mb-6">
          <div className="p-5 bg-[#0f172a] border-b border-gray-700 flex flex-col xl:flex-row xl:justify-between xl:items-start gap-4">
            <span className="text-green-400 text-xl font-bold flex items-center gap-2">⚖️ 리밸런싱 & 적립 시뮬레이터</span>
            <div className="flex flex-col gap-3 w-full xl:w-[600px]">
              <div className="flex items-center justify-between bg-gray-800/80 px-4 py-3 rounded-lg border border-gray-700 shadow-inner"><span className="text-gray-300 text-sm font-bold">현재 예수금</span><span className="text-green-400 text-xl font-bold">{(() => { const dep = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0); if (activePortfolioAccountType === 'overseas') { const fx = marketIndicators.usdkrw || 1; return <div className="flex flex-col items-end leading-tight"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(dep)}</span><span className="text-sm text-green-600">{formatCurrency(dep * fx)}</span></div>; } return formatCurrency(dep); })()}</span></div>
              <div className="flex items-stretch bg-gray-900 border border-gray-600 rounded-lg overflow-hidden h-12 shadow-sm">
                <select className="bg-gray-800 text-gray-200 text-sm font-bold px-3 border-r border-gray-600 outline-none cursor-pointer" value={settings.mode} onChange={e => updateSettingsForType({ ...settings, mode: e.target.value })}><option value="rebalance">리밸런싱 (비중 기반)</option><option value="accumulate">적립 (신규 자금 분할)</option></select>
                <input type="text" className="flex-1 bg-transparent text-right text-white font-bold px-4 outline-none text-lg" value={formatNumber(settings.amount)} onChange={e => updateSettingsForType({ ...settings, amount: cleanNum(e.target.value) })} onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto bg-[#0f172a]">
            <table className="text-right text-[13px]">
              <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600 font-bold text-center">
                {(() => {
                  const sk = rebalanceSortConfig.key, sd = rebalanceSortConfig.direction;
                  const arr = (k) => <span className={`ml-0.5 text-[9px] ${sk === k ? 'text-gray-300' : 'invisible'}`}>{sk === k && sd === -1 ? '▼' : '▲'}</span>;
                  return (
                    <tr>
                      <th className="py-3 px-3 min-w-[80px] text-center cursor-pointer hover:bg-gray-700 border-r border-gray-600 sticky top-0 left-0 z-30 bg-[#1e293b]" onClick={() => handleRebalanceSort('category')}>구분{arr('category')}</th>
                      <th className="py-3 px-3 min-w-[110px] text-center text-gray-300 cursor-pointer hover:bg-gray-700 sticky top-0 left-[80px] z-30 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]" onClick={() => handleRebalanceSort('name')}>종목명{arr('name')}</th>
                      <th className="py-3 px-3 min-w-[90px] text-gray-500 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('code')}>코드{arr('code')}</th>
                      <th className="py-3 px-3 min-w-[120px] text-gray-400 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('curEval')}>평가금{arr('curEval')}</th>
                      <th className="py-3 px-3 min-w-[100px] text-gray-500 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('currentPrice')}>현재가{arr('currentPrice')}</th>
                      <th className="py-2 px-3 min-w-[100px] text-green-400 font-bold text-center sticky top-0 z-20 bg-[#1e293b]">
                        <div className="flex flex-col items-center gap-1">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (totals.totalEval <= 0) return;
                              const rebalFx = activePortfolioAccountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
                              setPortfolio(prev => prev.map(p => {
                                if (p.type !== 'stock' && p.type !== 'fund') return p;
                                const qty = cleanNum(p.quantity);
                                const price = cleanNum(p.currentPrice);
                                const curEval = p.type === 'fund' && !(qty > 0 && price > 0) ? cleanNum(p.evalAmount) : price * qty;
                                return { ...p, targetRatio: parseFloat((curEval * rebalFx / totals.totalEval * 100).toFixed(1)) };
                              }));
                            }}
                            className="px-2 py-0.5 text-[10px] font-bold rounded-md border border-green-500/70 text-green-300 bg-green-900/20 hover:bg-green-700/50 hover:border-green-400 active:scale-95 transition-all whitespace-nowrap"
                            title="현재 비중을 목표 비중으로 일괄 설정"
                          >현재→목표</button>
                          <span className="cursor-pointer hover:text-green-300" onClick={() => handleRebalanceSort('targetRatio')}>목표비중(%){arr('targetRatio')}</span>
                        </div>
                      </th>
                      <th className="py-3 px-3 min-w-[80px] text-gray-400 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('curEval')}>현재비중{arr('curEval')}</th>
                      <th className="py-3 px-3 min-w-[75px] text-blue-300 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('action')}>수량{arr('action')}</th>
                      <th className="py-3 px-3 min-w-[65px] text-orange-300 text-center sticky top-0 z-20 bg-[#1e293b]">추가</th>
                      <th className="py-3 px-3 min-w-[85px] text-cyan-400 text-center sticky top-0 z-20 bg-[#1e293b]">추가 가능</th>
                      <th className="py-3 px-3 min-w-[120px] text-blue-300 text-center font-normal cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('cost')}>실 구매비용{arr('cost')}</th>
                      <th className="py-3 px-3 min-w-[120px] text-yellow-500 text-center font-bold cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('expEval')}>예상평가금{arr('expEval')}</th>
                      <th className="py-3 px-3 min-w-[85px] text-yellow-500 font-bold text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('expRatio')}>예상비중{arr('expRatio')}</th>
                    </tr>
                  );
                })()}
              </thead>
              <tbody>
                {(() => {
                  const depositAmount = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
                  const baseTotalCost = rebalanceData.reduce((s, d) => s + d.cost, 0);
                  const rawRemaining = settings.mode === 'accumulate'
                    ? depositAmount + cleanNum(settings.amount) - baseTotalCost
                    : depositAmount - baseTotalCost;
                  const baseRemaining = settings.mode === 'accumulate' ? Math.max(0, rawRemaining) : rawRemaining;
                  const totalExtraAllocated = rebalanceData.reduce((s, d) => s + (rebalExtraQty[d.id] || 0) * cleanNum(d.currentPrice), 0);
                  const effectiveRemaining = baseRemaining - totalExtraAllocated;
                  const isOverseas = activePortfolioAccountType === 'overseas';
                  const usdkrw = marketIndicators.usdkrw || 1;
                  const fmtUSD = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));
                  const catOrder: string[] = [];
                  const grouped: Record<string, typeof rebalanceData> = {};
                  rebalanceData.forEach(item => {
                    const cat = (item.category as string) || '기타';
                    if (!grouped[cat]) { grouped[cat] = []; catOrder.push(cat); }
                    grouped[cat].push(item);
                  });
                  const parseHex = (hex: string): [number, number, number] | null => {
                    const m = hex.replace('#', '').match(/.{2}/g);
                    if (!m) return null;
                    const [r, g, b] = m.map(x => parseInt(x, 16) / 255);
                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                    const l = (max + min) / 2;
                    if (max === min) return [0, 0, l * 100];
                    const d = max - min;
                    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                    let h: number;
                    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                    else if (max === g) h = ((b - r) / d + 2) / 6;
                    else h = ((r - g) / d + 4) / 6;
                    return [h * 360, s * 100, l * 100];
                  };
                  const genShades = (baseHex: string, count: number): string[] => {
                    const hsl = parseHex(baseHex);
                    if (!hsl || count === 1) return Array(count).fill(baseHex);
                    const [h, s, l] = hsl;
                    return Array.from({ length: count }, (_, i) => {
                      const t = i / (count - 1);
                      const shade = Math.min(78, Math.max(28, l + 18 - t * 36));
                      return `hsl(${h.toFixed(0)},${Math.min(100, s + 5).toFixed(0)}%,${shade.toFixed(0)}%)`;
                    });
                  };
                  const itemColorMap: Record<string, string> = {};
                  catOrder.forEach(cat => {
                    const baseHex = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const shades = genShades(baseHex, grouped[cat].length);
                    grouped[cat].forEach((item, j) => { itemColorMap[`${cat}::${item.id}`] = shades[j]; });
                  });
                  let rowNum = 0;
                  return catOrder.flatMap(cat => {
                    const items = grouped[cat];
                    const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const catTotalEval = items.reduce((sum, item) => sum + item.curEval, 0);
                    const catRatio = totals.totalEval > 0 ? catTotalEval / totals.totalEval * 100 : 0;
                    return items.map((item, j) => {
                      rowNum += 1;
                      const num = rowNum;
                      const itemColor = itemColorMap[`${cat}::${item.id}`] || catColor;
                      const extraQty = rebalExtraQty[item.id] || 0;
                      const totalAction = item.action + extraQty;
                      const itemPrice = cleanNum(item.currentPrice);
                      const adjustedCost = totalAction * itemPrice;
                      const maxAdd = itemPrice > 0
                        ? (settings.mode === 'accumulate'
                            ? Math.max(0, Math.floor(effectiveRemaining / itemPrice))
                            : Math.floor(effectiveRemaining / itemPrice))
                        : 0;
                      return (
                      <tr key={item.id} className="group border-b border-gray-700 hover:bg-gray-800 transition-colors">
                        {j === 0 && (
                          <td rowSpan={items.length} className="py-3 px-3 text-center font-bold border-r border-gray-700 align-middle bg-[#0f172a] sticky left-0 z-[5]">
                            <div style={{ color: catColor }}>{cat}</div>
                            <div className="text-gray-400 text-[10px] font-normal mt-0.5">{isOverseas ? <>{fmtUSD(catTotalEval)}<br/><span className="text-gray-600">{formatCurrency(catTotalEval * usdkrw)}</span></> : formatCurrency(catTotalEval)}</div>
                            <div className="text-gray-400 text-[10px] font-normal">{catRatio.toFixed(1)}%</div>
                          </td>
                        )}
                        <td className="py-3 px-4 text-center font-bold sticky left-[80px] z-[5] bg-[#0f172a] group-hover:bg-gray-800 transition-colors [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav} style={{ color: itemColor }}><div className="line-clamp-2">{num}. {item.name}</div></td>
                        <td className="py-3 px-3 text-center text-gray-500 font-mono text-xs focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{item.code}</td>
                        <td className="py-3 px-3 text-gray-400 text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.curEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.curEval * usdkrw)}</span></div> : formatCurrency(item.curEval)}</td>
                        <td className="py-3 px-3 text-gray-500 font-mono text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.currentPrice)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.currentPrice * usdkrw)}</span></div> : formatNumber(item.currentPrice)}</td>
                        <td className="p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                          <input type="text" data-col="targetRatio" className="w-full h-full bg-transparent text-center text-green-400 font-bold outline-none py-3 focus:bg-blue-900/20 caret-blue-400" value={item.targetRatio || 0} onChange={e => handleUpdate(item.id, 'targetRatio', e.target.value)} onFocus={e => e.target.select()} onKeyDown={e => handleTableKeyDown(e, 'targetRatio')} />
                        </td>
                        <td className="py-3 px-3 text-center text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{(totals.totalEval > 0 ? (isOverseas ? item.curEval * usdkrw : item.curEval) / totals.totalEval * 100 : 0).toFixed(isOverseas ? 2 : 1)}%</td>
                        <td className="py-3 px-3 text-center font-bold text-blue-300 focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{(totalAction > 0 ? '+' : '') + totalAction}</td>
                        <td className="p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-orange-500">
                          <input type="text" className="w-full h-full bg-transparent text-center text-orange-300 font-bold outline-none py-3 focus:bg-orange-900/20 caret-orange-400 min-w-[65px]" value={extraQty !== 0 ? extraQty : ''} placeholder="0" onChange={e => { const val = parseInt(e.target.value.replace(/[^\-\d]/g, '')) || 0; setRebalExtraQty(prev => ({ ...prev, [item.id]: val })); }} onFocus={e => e.target.select()} />
                        </td>
                        <td className={`py-3 px-3 text-center font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${maxAdd > 0 ? 'text-cyan-400' : maxAdd < 0 ? 'text-red-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{maxAdd > 0 ? '+' + maxAdd : maxAdd < 0 ? maxAdd : '0'}</td>
                        <td className={`py-3 px-3 font-bold text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${adjustedCost > 0 ? 'text-red-400' : adjustedCost < 0 ? 'text-blue-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(adjustedCost)}</span><span className="text-[11px] opacity-70">{formatCurrency(adjustedCost * usdkrw)}</span></div> : formatCurrency(adjustedCost)}</td>
                        <td className="py-3 px-3 font-bold text-yellow-500 text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.expEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.expEval * usdkrw)}</span></div> : formatCurrency(item.expEval)}</td>
                        <td className="py-3 px-3 text-center text-yellow-600 font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{item.expRatio.toFixed(isOverseas ? 2 : 1)}%</td>
                      </tr>
                    );
                    });
                  });
                })()}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td colSpan={2} className="py-3 px-3 text-center uppercase tracking-widest text-gray-500 text-xs sticky left-0 z-[5] bg-[#1e293b]">TOTAL</td>
                  <td className="py-3 px-3"></td>
                  {(() => { const totCurEval = rebalanceData.reduce((s, d) => s + d.curEval, 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className="py-3 px-3 text-gray-300 font-bold text-right">{isOv ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUS(totCurEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(totCurEval * fxRate)}</span></div> : formatCurrency(totCurEval)}</td>; })()}
                  <td className="py-3 px-3"></td>
                  <td className="py-3 px-3 text-center font-bold text-green-400">{rebalanceData.reduce((s, d) => s + (d.targetRatio || 0), 0).toFixed(activePortfolioAccountType === 'overseas' ? 2 : 1)}%</td>
                  <td className="py-3 px-3 text-center font-bold text-gray-400">100%</td>
                  <td className="py-3 px-3"></td>
                  <td className="py-3 px-3"></td>
                  <td className="py-3 px-3"></td>
                  {(() => { const adjTotal = rebalanceData.reduce((s, d) => s + (d.action + (rebalExtraQty[d.id] || 0)) * cleanNum(d.currentPrice), 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className={`py-3 px-3 font-bold text-right ${adjTotal > 0 ? 'text-red-400' : adjTotal < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{isOv ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUS(adjTotal)}</span><span className="text-[11px] opacity-70">{formatCurrency(adjTotal * fxRate)}</span></div> : formatCurrency(adjTotal)}</td>; })()}
                  {(() => { const totExpEval = rebalanceData.reduce((s, d) => s + d.expEval, 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className="py-3 px-3 font-bold text-yellow-400 text-right">{isOv ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUS(totExpEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(totExpEval * fxRate)}</span></div> : formatCurrency(totExpEval)}</td>; })()}
                  <td className="py-3 px-3 text-center font-bold text-yellow-500">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 리밸런싱 자산 비중 도넛 차트 */}
        <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden mb-20">
          <div className="p-3 bg-[#0f172a] border-b border-gray-700">
            <span className="text-white font-bold text-sm">🍩 자산 비중 비교</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-700">
            {/* 왼쪽: 리밸런싱 후 예상 자산 비중 */}
            <div className="p-4">
              <div className="text-gray-400 text-xs text-center mb-2 font-semibold">리밸런싱 후 예상 자산 비중</div>
              {rebalCatDonutData.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs">데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                    {hoveredRebalCatSlice ? (
                      <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredRebalCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredRebalCatSlice.fill }}>{hoveredRebalCatSlice.name} {(hoveredRebalCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredRebalCatSlice.value)}</span>}</>
                    ) : (
                      <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                    )}
                  </div>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={rebalCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredRebalCatSlice(data)} onMouseLeave={() => setHoveredRebalCatSlice(null)}>
                          {rebalCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="w-full text-xs mt-3">
                    <thead className="text-gray-400 border-b border-gray-700">
                      <tr className="text-center">
                        <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                        <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">예상평가금</th>
                        <th className="pb-2 px-3">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = rebalCatDonutData.reduce((s, x) => s + x.value, 0);
                        return rebalCatDonutData.map(({ name, value }, i) => (
                          <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                            <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                              <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                            </td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : formatCurrency(value)}</td>
                            <td className="py-1.5 px-3 text-gray-400 text-right">{total > 0 ? ((value / total) * 100).toFixed(1) : 0}%</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </>
              )}
            </div>
            {/* 오른쪽: 현재 포트폴리오 자산 비중 */}
            <div className="p-4">
              <div className="text-gray-400 text-xs text-center mb-2 font-semibold">현재 자산 비중</div>
              {curCatDonutData.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs">데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                    {hoveredCurCatSlice ? (
                      <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredCurCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredCurCatSlice.fill }}>{hoveredCurCatSlice.name} {(hoveredCurCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredCurCatSlice.value)}</span>}</>
                    ) : (
                      <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                    )}
                  </div>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={curCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredCurCatSlice(data)} onMouseLeave={() => setHoveredCurCatSlice(null)}>
                          {curCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
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
                      {curCatDonutData.map(({ name, value }, i) => (
                        <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                          <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                            <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                          </td>
                          <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : formatCurrency(value)}</td>
                          <td className="py-1.5 px-3 text-gray-400 text-right">{totals.totalEval > 0 ? ((value / totals.totalEval) * 100).toFixed(1) : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
        </>
        )}
        </>)}

        {showIntegratedDashboard && (
          <div className="flex flex-col gap-6 w-full">

            {/* 통합 요약 카드 */}
            {(() => {
              const sortedIntHist = [...intHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
              const todayRec = sortedIntHist[0];
              const prevRec = sortedIntHist[1];
              const todayProfit = todayRec && prevRec ? todayRec.evalAmount - prevRec.evalAmount : 0;
              const todayRate = prevRec?.evalAmount > 0 ? todayProfit / prevRec.evalAmount * 100 : 0;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">총 자산 (평가금)</span>
                    <span className="text-white text-lg font-extrabold">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalEval)}</span>
                  </div>
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">오늘 수익 ({todayRec?.date || '-'})</span>
                    <span className={`text-lg font-extrabold ${todayProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {hideAmounts ? '••••••' : `${todayProfit >= 0 ? '+' : ''}${formatCurrency(todayProfit)}`}
                    </span>
                    <span className={`text-[11px] font-bold ${todayRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {todayRate >= 0 ? '+' : ''}{todayRate.toFixed(2)}%
                    </span>
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

            {/* 통합 계좌 현황 */}
            <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg">
              <div className="p-3 bg-[#0f172a] flex justify-between items-center border-b border-gray-700">
                <span className="text-white font-bold text-sm">🏦 통합 계좌 현황</span>
                <div className="flex gap-1 items-center">
                  <div className="relative">
                    <button
                      onClick={() => setShowNewAccountMenu(v => !v)}
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors text-xs font-bold px-2 py-1 hover:bg-blue-900/20 rounded"
                    >
                      <Plus size={12} /> 새 계좌 <span className="text-[9px] opacity-60">▼</span>
                    </button>
                    {showNewAccountMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowNewAccountMenu(false)} />
                        <div className="absolute right-0 top-full mt-1 z-50 bg-[#1e293b] border border-gray-600 rounded-lg shadow-2xl py-1 min-w-[160px]">
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
                  <button onClick={addSimpleAccount} className="flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors text-xs font-bold px-2 py-1 hover:bg-green-900/20 rounded" title="날짜·계좌·자산을 직접 입력하는 간단 계좌 추가">
                    <Plus size={12} /> 직접입력
                  </button>
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
                      <th className="py-2 px-3 text-center border-r border-gray-700">투자비율</th>
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
                    {portfolioSummaries.map((s, sIdx) => {
                      const allocRatio = intTotals.totalEval > 0 ? s.currentEval / intTotals.totalEval * 100 : 0;
                      const isCatOpen = intExpandedCat === s.id;
                      const isSimple = s.accountType === 'simple';
                      return (
                        <React.Fragment key={s.id}>
                          <tr
                            className={`border-b border-gray-700 transition-colors ${!s.rowColor ? (s.isActive ? 'bg-blue-950/20' : isSimple ? 'bg-green-950/10 hover:bg-green-900/10' : 'hover:bg-gray-800/40') : ''}`}
                            style={s.rowColor ? { backgroundColor: hexToRgba(s.rowColor, 0.18) } : {}}
                          >
                            {/* 색상 스트립 — 색 없으면 클릭 시 피커 열기, 색 있으면 클릭 시 색상 제거 */}
                            <td className="p-0 border-r border-gray-700" style={{width:'10px',minWidth:'10px'}}>
                              {s.rowColor ? (
                                <button
                                  title="클릭하여 행 색상 제거"
                                  className="block w-full cursor-pointer border-0 outline-none"
                                  style={{minHeight:'32px', backgroundColor: s.rowColor}}
                                  onClick={() => updatePortfolioColor(s.id, '')}
                                />
                              ) : (
                                <label title="클릭하여 행 색상 설정" className="block w-full cursor-pointer" style={{minHeight:'32px', backgroundColor: '#334155'}}>
                                  <input type="color" className="sr-only" defaultValue="#3b82f6" onChange={e => updatePortfolioColor(s.id, e.target.value)} />
                                </label>
                              )}
                            </td>
                            {/* 순서 화살표 */}
                            <td className="py-1.5 px-2 text-center border-r border-gray-700">
                              <div className="flex flex-col items-center gap-0.5">
                                <button onClick={() => movePortfolio(s.id, -1)} disabled={sIdx === 0} className="text-gray-500 hover:text-blue-400 disabled:opacity-20 disabled:cursor-default leading-none text-[10px]" title="위로">▲</button>
                                <button onClick={() => movePortfolio(s.id, 1)} disabled={sIdx === portfolioSummaries.length - 1} className="text-gray-500 hover:text-blue-400 disabled:opacity-20 disabled:cursor-default leading-none text-[10px]" title="아래로">▼</button>
                              </div>
                            </td>
                            <td className="py-1.5 px-3 text-center border-r border-gray-700">
                              <CustomDatePicker value={s.startDate} onChange={v => updatePortfolioStartDate(s.id, v)} />
                            </td>
                            {/* 계좌 — 포트폴리오는 클릭 시 해당 페이지 이동 */}
                            <td
                              className={`py-1.5 px-3 text-center border-r border-gray-700 sticky left-0 z-[5] bg-[#1e293b] ${!isSimple ? 'cursor-pointer hover:bg-blue-900/20' : ''}`}
                              style={s.rowColor ? { backgroundColor: blendWithDarkBg(s.rowColor, 0.35) } : {}}
                              onClick={!isSimple ? () => switchToPortfolio(s.id) : undefined}
                            >
                              {isSimple ? (
                                <input
                                  type="text"
                                  className="w-full min-w-[70px] bg-transparent font-bold outline-none text-center text-green-300"
                                  value={s.name}
                                  onChange={e => updatePortfolioName(s.id, e.target.value)}
                                />
                              ) : (
                                <span className="font-bold text-blue-300 select-none">{s.name}</span>
                              )}
                            </td>
                            {/* 직접입력형: 투자원금 직접 수정 가능 */}
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-200 font-bold">
                              {isSimple ? (
                                hideAmounts ? '••••••' : (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="w-full min-w-[90px] bg-transparent font-bold outline-none text-center text-gray-200 border-b border-dashed border-gray-600 focus:border-green-400"
                                  value={simpleEditField?.id === s.id && simpleEditField?.field === 'principal'
                                    ? (s.principal || '')
                                    : s.principal ? formatCurrency(s.principal) : ''}
                                  placeholder={s.currentEval ? formatCurrency(s.currentEval) : '₩0'}
                                  onFocus={e => { setSimpleEditField({id: s.id, field: 'principal'}); e.target.select(); }}
                                  onBlur={() => setSimpleEditField(null)}
                                  onChange={e => updateSimpleAccountField(s.id, 'principal', e.target.value.replace(/[^0-9]/g, ''))}
                                />)
                              ) : (hideAmounts ? '••••••' : formatCurrency(s.principal))}
                            </td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-300">{allocRatio.toFixed(2)}%</td>
                            {/* 직접입력형: 평가금액 직접 수정 가능 */}
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center font-bold text-white">
                              {isSimple ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="w-full min-w-[90px] bg-transparent font-bold outline-none text-center text-white border-b border-dashed border-gray-600 focus:border-green-400"
                                  value={simpleEditField?.id === s.id && simpleEditField?.field === 'eval'
                                    ? (s.currentEval || '')
                                    : s.currentEval ? formatCurrency(s.currentEval) : ''}
                                  placeholder="₩0"
                                  onFocus={e => { setSimpleEditField({id: s.id, field: 'eval'}); e.target.select(); }}
                                  onBlur={() => setSimpleEditField(null)}
                                  onChange={e => updateSimpleAccountField(s.id, 'evalAmount', e.target.value.replace(/[^0-9]/g, ''))}
                                />
                              ) : (hideAmounts ? '••••••' : formatCurrency(s.currentEval))}
                            </td>
                            <td className={`py-1.5 px-3 border-r border-gray-700 text-center font-bold ${s.returnRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatPercent(s.returnRate)}</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-blue-300 font-bold">{formatPercent(s.cagr)}</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-400 font-bold">{isSimple ? '-' : (hideAmounts ? '••••••' : formatCurrency(s.depositAmount))}</td>
                            {/* 수익 = 총자산 - 투자원금 */}
                            <td className={`py-1.5 px-3 border-r border-gray-700 text-center font-bold ${s.currentEval - s.principal >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                              {hideAmounts ? '••••••' : formatCurrency(s.currentEval - s.principal)}
                            </td>
                            <td className="py-1.5 px-2 border-r border-gray-700">
                              <input
                                type="text"
                                className="w-full bg-transparent outline-none text-gray-400 text-xs placeholder-gray-600"
                                value={s.memo}
                                onChange={e => updatePortfolioMemo(s.id, e.target.value)}
                                placeholder="메모..."
                              />
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button onClick={() => deletePortfolio(s.id)} className="text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                            </td>
                          </tr>
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
                    })}
                    {portfolioSummaries.length === 0 && (
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

            {/* 월별 평가 추이 + 기간별 수익 차트 */}
            <div className="flex flex-col xl:flex-row gap-4 w-full items-stretch">

              {/* 평가액 추이 테이블 */}
              <div className="w-full xl:w-[380px] shrink-0 bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden flex flex-col max-h-[320px] xl:max-h-none">
                <div className="p-3 bg-[#0f172a] flex justify-between items-center border-b border-gray-700 shrink-0">
                  <span className="text-white font-bold text-sm">📅 평가액 추이</span>
                  <button
                    onClick={() => {
                      const today = new Date().toISOString().split('T')[0];
                      setIntHistory(prev => {
                        const todayEntry = prev.find(h => h.date === today);
                        return todayEntry ? [todayEntry] : (intTotals.totalEval > 0 ? [{ id: generateId(), date: today, evalAmount: intTotals.totalEval }] : []);
                      });
                    }}
                    className="text-orange-400 hover:text-white p-1 hover:bg-gray-800 rounded transition" title="기록 리셋"
                  ><Trash2 size={14} /></button>
                </div>
                <div className="overflow-x-auto overflow-y-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 z-10">
                      <tr>
                        <th className="py-2.5 px-3 text-center border-r border-gray-700">일자</th>
                        <th className="py-2.5 px-3 text-right border-r border-gray-700">총 평가금액</th>
                        <th className="py-2.5 px-3 text-center border-r border-gray-700 whitespace-nowrap">전일대비(%)</th>
                        <th className="py-2.5 px-3 text-center whitespace-nowrap">월간수익률(%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intMonthlyHistory.map((h, i) => (
                        <tr key={h.id || i} className={`border-b border-gray-700 ${h.date === new Date().toISOString().split('T')[0] ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                          <td className="py-2 px-3 text-center font-bold text-gray-400 border-r border-gray-700">{formatShortDate(h.date)}</td>
                          <td className="py-2 px-3 font-bold text-white text-right border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(h.evalAmount)}</td>
                          <td className="py-2 px-3 text-center border-r border-gray-700">
                            <span className={`text-sm font-bold ${h.dodChange > 0 ? 'text-red-400' : h.dodChange < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{formatPercent(h.dodChange)}</span>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className={`text-sm font-bold ${h.monthlyChange > 0 ? 'text-red-400' : h.monthlyChange < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{formatPercent(h.monthlyChange)}</span>
                          </td>
                        </tr>
                      ))}
                      {intMonthlyHistory.length === 0 && (
                        <tr><td colSpan={4} className="py-6 text-center text-gray-500">데이터 없음<br/><span className="text-[10px] text-gray-600">계좌 평가금액을 입력하면 자동으로 기록됩니다.</span></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 기간별 수익 차트 */}
              <div className="w-full xl:flex-1 bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden flex flex-col">
                <div className="p-3 bg-[#0f172a] border-b border-gray-700 flex flex-wrap gap-2 items-center shrink-0">
                  <span className="text-white font-bold text-sm">📈 기간별 수익 차트 (통합)</span>
                  <div className="flex flex-wrap gap-1 ml-2">
                    {['1m','3m','6m','1y','2y','3y','5y','all'].map(p => (
                      <button key={p} onClick={() => setIntChartPeriod(p)} className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${intChartPeriod === p ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>{p}</button>
                    ))}
                  </div>
                  <button onClick={() => setIntIsZeroBaseMode(m => !m)} className={`ml-auto text-xs px-2 py-0.5 rounded font-bold transition-colors ${intIsZeroBaseMode ? 'bg-indigo-800/60 text-indigo-300 border border-indigo-700' : 'text-gray-500 hover:text-gray-300 border border-gray-700'}`} title="기간 시작 기준 / 원금 기준 전환">{intIsZeroBaseMode ? '기간기준' : '원금기준'}</button>
                </div>
                <div className="chart-container-for-drag p-3 sm:p-4 relative select-none h-[300px] sm:h-[340px] md:h-[380px] xl:h-[420px]">
                  {intSelectionResult && (
                    <div className="absolute top-4 left-4 bg-gray-900/95 border border-gray-600 rounded-xl px-4 py-2.5 shadow-lg z-20 flex flex-col items-start pointer-events-none">
                      <span className="text-gray-400 text-[11px] mb-1 font-bold">{formatShortDate(intSelectionResult.startDate)} ~ {formatShortDate(intSelectionResult.endDate)}</span>
                      <span className={`text-xl font-black ${intSelectionResult.profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{intSelectionResult.profit > 0 ? '▲' : '▼'} {Math.abs(intSelectionResult.rate).toFixed(2)}%</span>
                      <span className={`text-xs font-bold mt-1 ${intSelectionResult.profit >= 0 ? 'text-red-300' : 'text-blue-300'}`}>{hideAmounts ? '••••••' : `${intSelectionResult.profit >= 0 ? '+' : ''}${formatCurrency(intSelectionResult.profit)}`}</span>
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <ComposedChart data={intChartData} onMouseDown={handleIntChartMouseDown} onMouseMove={handleIntChartMouseMove} onMouseUp={handleIntChartMouseUp} onMouseLeave={handleIntChartMouseUp}>
                      <defs>
                        <linearGradient id="intReturnGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="intCostGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6b7280" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#6b7280" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                      <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={formatVeryShortDate} minTickGap={30} />
                      <YAxis yAxisId="left" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${v.toFixed(1)}%`} width={48} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => (v >= 1e8 ? (v/1e8).toFixed(1)+'억' : (v/1e4).toFixed(0)+'만')} width={55} />
                      <RechartsTooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div style={{ background: 'rgba(15,23,42,0.95)', border: '1px solid #4b5563', borderRadius: 8, padding: '10px 14px', minWidth: 180 }}>
                            <p style={{ color: '#9ca3af', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{formatShortDate(label)}</p>
                            {payload.filter(e => e.dataKey !== 'costAmount' || e.value > 0).map((entry, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, display: 'inline-block', flexShrink: 0 }} />
                                <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, marginRight: 4 }}>{entry.name}</span>
                                <span style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 700, marginLeft: 'auto' }}>
                                  {entry.name === '수익률' ? `${Number(entry.value).toFixed(2)}%` : (hideAmounts ? '••••••' : formatCurrency(entry.value))}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }} />
                      <Area yAxisId="right" type="monotone" dataKey="costAmount" name="투자원금" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 3" fill="url(#intCostGrad)" dot={false} activeDot={{ r: 3 }} />
                      <Area yAxisId="left" type="monotone" dataKey="returnRate" name="수익률" stroke="#ef4444" strokeWidth={2} fill="url(#intReturnGrad)" dot={false} activeDot={{ r: 4 }} />
                      <Line yAxisId="right" type="monotone" dataKey="evalAmount" name="총평가금액" stroke="#60a5fa" strokeWidth={2} dot={false} />
                      {intRefAreaLeft && intRefAreaRight && <ReferenceArea yAxisId="left" x1={intRefAreaLeft} x2={intRefAreaRight} fill="rgba(255,255,255,0.08)" strokeOpacity={0.3} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* 자산 카테고리 비중 (도넛 차트) */}
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
                    const catValueMap: Record<string, number> = {};
                    intCatDonutData.forEach(x => { catValueMap[x.name] = x.value; });
                    const grouped: Record<string, typeof intHoldingsDonutData> = {};
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
                    const parseHex = (hex: string): [number, number, number] | null => {
                      if (!hex || !hex.startsWith('#') || hex.length < 7) return null;
                      const r = parseInt(hex.slice(1, 3), 16) / 255;
                      const g = parseInt(hex.slice(3, 5), 16) / 255;
                      const b = parseInt(hex.slice(5, 7), 16) / 255;
                      const max = Math.max(r, g, b), min = Math.min(r, g, b);
                      const l = (max + min) / 2;
                      if (max === min) return [0, 0, l * 100];
                      const d = max - min;
                      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                      let h: number;
                      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                      else if (max === g) h = ((b - r) / d + 2) / 6;
                      else h = ((r - g) / d + 4) / 6;
                      return [h * 360, s * 100, l * 100];
                    };
                    const genShades = (baseHex: string, count: number): string[] => {
                      const hsl = parseHex(baseHex);
                      if (!hsl || count === 1) return Array(count).fill(baseHex);
                      const [h, s, l] = hsl;
                      return Array.from({ length: count }, (_, i) => {
                        const t = i / (count - 1);
                        const shade = Math.min(78, Math.max(28, l + 18 - t * 36));
                        return `hsl(${h.toFixed(0)},${Math.min(100, s + 5).toFixed(0)}%,${shade.toFixed(0)}%)`;
                      });
                    };
                    const itemColorMap: Record<string, string> = {};
                    const catBaseColorMap: Record<string, string> = {};
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
                        <table className="w-full text-xs min-w-[480px]">
                          <thead className="text-gray-400 border-b border-gray-700">
                            <tr className="text-center">
                              <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                              <th className="pb-2 px-2 border-r border-gray-700 sticky left-0 z-20 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]">종목</th>
                              <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">평가금액</th>
                              <th className="pb-2 px-3 border-r border-gray-700">비중</th>
                              <th className="pb-2 px-3 border-r border-gray-700">수익</th>
                              <th className="pb-2 px-3">수익률</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupEntries.flatMap(([cat, items]) => {
                              const catColor = catBaseColorMap[cat];
                              const catDisplayValue = catValueMap[cat] ?? items.reduce((s, x) => s + x.value, 0);
                              const isLastCat = LAST_CATS.includes(cat);
                              return items.map((item, j) => {
                                rowNum += 1;
                                const num = rowNum;
                                const itemColor = itemColorMap[`${cat}::${item.name}`] || catColor;
                                const profit = item.value - item.cost;
                                const profitRate = item.cost > 0 ? (profit / item.cost) * 100 : null;
                                const profitColor = profit > 0 ? 'text-red-400' : profit < 0 ? 'text-blue-400' : 'text-gray-400';
                                return (
                                  <tr key={`${cat}-${item.name}`} className={`group hover:bg-gray-800/30 ${j === items.length - 1 ? 'border-b border-gray-700' : 'border-b border-gray-700/30'}`}>
                                    {j === 0 && (
                                      <td rowSpan={items.length} className="py-1.5 px-2 text-center font-bold border-r border-gray-700 border-b border-gray-700 align-middle">
                                        <div style={{ color: catColor }}>{cat}</div>
                                        <div className="text-gray-500 font-normal mt-0.5">{hideAmounts ? '••••••' : formatCurrency(catDisplayValue)}</div>
                                        <div className="text-gray-500 font-normal">{totalDenom > 0 ? ((catDisplayValue / totalDenom) * 100).toFixed(1) : 0}%</div>
                                      </td>
                                    )}
                                    <td className="py-1.5 px-2 text-center border-r border-gray-700 sticky left-0 z-10 bg-[#1e293b] group-hover:bg-[#1d2d40] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]">
                                      <span style={{ color: itemColor }}>{num}. {item.name}</span>
                                    </td>
                                    <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : formatCurrency(item.value)}</td>
                                    <td className="py-1.5 px-3 border-r border-gray-700 text-gray-400 text-right">{totalDenom > 0 ? ((item.value / totalDenom) * 100).toFixed(1) : 0}%</td>
                                    {isLastCat ? (
                                      <>
                                        <td className="py-1.5 px-3 border-r border-gray-700 text-gray-600 text-right">-</td>
                                        <td className="py-1.5 px-3 text-gray-600 text-right">-</td>
                                      </>
                                    ) : (
                                      <>
                                        <td className={`py-1.5 px-3 border-r border-gray-700 font-bold text-right ${profitColor}`}>
                                          {hideAmounts ? '••••••' : (<><span className="text-[9px] mr-0.5">{profit >= 0 ? '▲' : '▼'}</span>{formatCurrency(Math.abs(profit))}</>)}
                                        </td>
                                        <td className={`py-1.5 px-3 font-bold text-right ${profitColor}`}>
                                          {profitRate !== null ? (<><span className="text-[9px] mr-0.5">{profitRate >= 0 ? '▲' : '▼'}</span>{Math.abs(profitRate).toFixed(2)}%</>) : '-'}
                                        </td>
                                      </>
                                    )}
                                  </tr>
                                );
                              });
                            })}
                          </tbody>
                        </table>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

          </div>
        )}
        </div>
        </div>
        {/* 우측 광고 패널 */}
        <div className="hidden min-[1800px]:flex w-[160px] shrink-0 flex-col items-center pt-16 border-l border-gray-800/50">
          <div className="sticky top-16 w-[140px] min-h-[600px] rounded-lg bg-gray-800/10">
          </div>
        </div>
      </div>


      {isPasteModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[300] animate-in fade-in backdrop-blur-sm">
          <div className="bg-[#1e293b] p-8 rounded-2xl w-full max-w-2xl border border-gray-600 shadow-2xl text-left">
            <h2 className="text-2xl font-extrabold mb-2 text-white">엑셀 데이터 일괄 추가</h2>
            <div className="text-gray-400 text-xs mb-4 font-semibold leading-relaxed">
              <p className="text-blue-400 mb-1">💡 엑셀 표에서 [종목코드]부터 [보유수량]까지 5개 열을 드래그해서 붙여넣으세요.</p>
              <p className="text-gray-500">(열 순서: 종목코드, 현재가격, 구매단가, 투자금액, 보유수량)</p>
            </div>
            <textarea id="paste-input" rows={8} className="w-full bg-gray-900 border border-gray-600 rounded-xl p-4 text-sm text-white font-mono focus:border-blue-500 transition shadow-inner outline-none" placeholder="005930&#9;199,400&#9;164,022&#9;4,428,600&#9;27"></textarea>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setIsPasteModalOpen(false)} className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition">취소</button>
              <button onClick={() => {
                const text = document.getElementById('paste-input')?.value; if (!text) return;
                const newItems = text.trim().split('\n').map(line => {
                  const cols = line.split('\t');
                  if (cols.length >= 5) return { id: generateId(), type: 'stock', category: '주식', code: cols[0].trim(), name: '', currentPrice: cleanNum(cols[1]), purchasePrice: cleanNum(cols[2]), quantity: cleanNum(cols[4]), targetRatio: 0, isManual: true };
                  return null;
                }).filter(x => x && x.code);
                setPortfolio([...newItems, ...portfolio]); setIsPasteModalOpen(false);
              }} className="px-8 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl font-extrabold shadow-lg border border-green-500 transition">데이터 일괄 추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
