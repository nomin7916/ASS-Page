// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import CalendarModal from './components/CalendarModal';
import StockTransferModal from './components/StockTransferModal';
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
import WatchlistPopup from './components/WatchlistPopup';
import ErrorBoundary from './components/ErrorBoundary';
import { FX_DEFAULT, FX_MIN_SLOTS, normalizeFxCurrencies, normalizeFxSlotCount } from './fxRates';
import FlowBoard from './components/FlowBoard';
import { normalizeFlowMaps, flowFingerprint, flowMapsHaveContent } from './flowMap';
import BacktestPage from './components/BacktestPage';
import LedgerPage from './components/LedgerPage';
import { normalizeLedgerBooks, ledgerFingerprint, ledgerBooksHaveContent } from './ledger';
import { normalizeLedgerSnapshots, ledgerSnapshotsFingerprint, ledgerSnapshotsHaveContent } from './ledger';
import CardWinFeed from './components/CardWinFeed';
import { isCardKey, isCardWindowSupported, cardWindowUrl, cardWindowName, baseKeyOf } from './cardWindow';
import {
  normalizeBacktestScenarios, backtestFingerprint, backtestScenariosHaveContent,
  buildBtCatalog, collectDividendHistory, collectNameByCode,
} from './backtest';
import { fetchBacktestSeries, fetchBacktestName, fetchBacktestDividends } from './backtestFetch';
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
import { useMarketCalendar, getTodayKST, getEffectiveDate, getEffectiveDateKR, getEffectiveDateForAccount, getBackfillBoundaryKR, getBackfillBoundaryForAccount, isKrCutoffAccount, getMsUntilNextBoundary } from './hooks/useMarketCalendar';
import {
  generateId, cleanNum, formatCurrency, formatPercent, formatNumber,
  formatChangeRate, formatShortDate, formatVeryShortDate, getSeededRandom,
  getClosestValue, getIndexLatest, handleTableKeyDown, handleReadonlyCellNav, buildIndexStatus,
  hexToRgba, blendWithDarkBg, downloadCSV, buildHistoryCSV, buildLookupCSV, buildDepositCSV,
  fillWeekendGaps, fillNonTradingGaps, calcPeriodStart,
  ensurePortfolioVerificationFields, snapshotItemsFromPortfolio, snapshotCompositionKey,
  computeEffectivePrincipal, resolveRecordPrincipal, overseasPrincipalAt, dedupeHistoryByDate, savingsEval, buildCloseEvalSeries, evalSeriesDates,
  externalFlowInRange, computeCumulativeTwrSeries, rebaseTwr, overseasUsdEvalAt,
  buildBookCostSeries, bookDeltaBetween,
  noticeChannelOf, resolveNoticeMaterial, normalizeDividendLinks, isValidIsoDate,
  listRebalTargetSnapshots,
  bookCostOf, calcPortfolioEvalDetail, collectTransferRows,
  buildHistDetailRows, EMPTY_HIST_DETAIL,
  buildRebalTargetEntryFrom, sameRebalTargetEntry, upsertRebalTargetMemo,
  normalizeHistPeriod,
} from './utils';

import { INT_CATEGORIES, ACCOUNT_TYPE_CONFIG, CATEGORY_DISPLAY_ORDER } from './constants';

// 공지 수신 대상 판정 — '__notebook__'(학습자료 등록 알림)은 학습자료 ON 사용자만 수신.
// '__all__'은 전체, 그 외는 해당 이메일만. (관리자는 호출 전에 이미 제외됨)
// ⚠️ 옛 '__report__' 센티넬은 의도적으로 없다 — 시장동향 리포트가 '단일 URL 바로가기'로 바뀌며
// 공지 채널이 폐지됐다. 시트에 남은 옛 리포트 공지는 여기서 false로 떨어져 더는 발송되지 않는다.
function notifTargetsUser(targetEmail: string, email: string, notebookEnabled: boolean): boolean {
  if (targetEmail === '__notebook__') return notebookEnabled === true;
  if (targetEmail === '__report__') return false;
  return targetEmail === '__all__' || targetEmail?.toLowerCase() === email.toLowerCase();
}

// 자료 등록 시 사용자 공지 발송 여부('공지 ON/OFF' 토글) — app_settings.json 로드값 정규화.
// 미지정/손상값은 ON으로 해석(기존 동작 유지) — OFF는 명시적으로 false일 때만.
// 리포트 채널 폐지로 학습자료 하나만 남았다(옛 파일의 report 키는 로드 시 조용히 버려진다).
const NOTICE_FLAGS_DEFAULT = { notebook: true };

// 부팅 첫 시세 갱신을 쏘는 effect(bootRefreshSeq)가 이 시간 안에 안 돌면 로드 effect가 직접 쏜다(언마운트 등 예외 경로).
// 그 시점엔 렌더가 이미 끝난 지 오래라 ref가 신선하다. 정상 경로는 effect가 담당한다(선언부 주석 참조).
const BOOT_REFRESH_START_TIMEOUT_MS = 5000;
const normalizeNoticeFlags = (raw: any) => ({
  notebook: raw?.notebook !== false,
});

// ── 시장동향 리포트 = 유튜브식 단일 URL 바로가기 ──
// ⚠️ 저장은 기존 settings 키 'reportLinks'를 그대로 재사용한다(Apps Script의 setSettings/getSettings는
//    키 화이트리스트가 있어 새 키를 거부 → 새 키를 쓰면 재배포 전까지 일반 사용자에게 전달되지 않는다).
//    그래서 프론트 상태는 문자열 하나(reportUrl)지만 wire 포맷은 계속 배열이다.
// ⚠️ reportLinksFromUrl은 순수 함수여야 한다(타임스탬프 금지) — 유튜브/학습자료 저장 경로가 공동 기록
//    (co-write)으로 이 값을 매번 다시 만들기 때문에, 매 호출 다른 값이 나오면 무의미한 저장 churn이 난다.
const REPORT_LINK_TITLE = '시장동향 리포트';
const reportUrlFromLinks = (links: any): string => {
  if (!Array.isArray(links)) return '';
  // 레거시 다중 링크/HTML 파일 항목은 첫 URL만 승계(파일 전용 항목은 url이 없어 자연 탈락).
  const hit = links.find(l => l && typeof l.url === 'string' && l.url.trim());
  return hit ? hit.url.trim() : '';
};
const reportLinksFromUrl = (url: string) => {
  const u = (url || '').trim();
  return u ? [{ title: REPORT_LINK_TITLE, url: u }] : [];
};

// ── app_settings.json 정본 마커 ──
// ⚠️ 이 마커가 없으면 "링크가 전부 비어 있음"과 "파일이 없음"을 구분할 수 없어, 관리자가 마지막 링크를
//    삭제한 순간 로드가 Apps Script 시트로 폴백해 **방금 지운 옛 링크를 되살리고 Drive에 되쓴다**
//    (유튜브·학습자료가 함께 비어 있는 관리자에게서 재현 — 삭제가 영구히 먹지 않는다).
//    마커가 찍힌 파일은 값이 전부 비어 있어도 Drive가 정본이다. 마커 없는 레거시 파일은 종전대로
//    1회 마이그레이션(시트 → Drive)을 거치며 그때 마커가 찍힌다.
const SETTINGS_SCHEMA = 2;
const isAuthoritativeSettings = (s: any) => !!s && typeof s === 'object' && (s.settingsSchema ?? 0) >= SETTINGS_SCHEMA;
// Apps Script 설정 시트 기록 실패 안내 — 관리자 Drive에는 저장됐지만 일반 사용자에게는 전달되지 않은 상태.
const SHEET_DEPLOY_WARN = '관리자 화면에는 반영됐지만 사용자 배포(설정 시트) 기록에 실패했습니다. 잠시 후 [저장]을 다시 눌러 주세요.';

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

// 분배금 표 월 숨김 값 정규화 — 통합(chartPrefs.intHiddenDivMonths) 로드와 개별 계좌 prop 양쪽에서 사용.
// Drive에 저장된 값이 옛 형태·손상값이어도 항상 {expected:number[], actual:number[]}로 맞춰
// 렌더의 .includes 호출이 깨지지 않게 한다(중복 인덱스는 복원 칩 key 충돌 방지로 제거).
const normalizeHiddenDivMonths = (raw) => {
  const pick = (v) => Array.isArray(v)
    ? [...new Set(v.filter(n => Number.isInteger(n) && n >= 0 && n <= 11))]
    : [];
  return { expected: pick(raw?.expected), actual: pick(raw?.actual) };
};

// 메모 달력 로드 정규화 — Drive STATE/백업의 calendarMemos는 지금까지 무검증으로 대입돼 왔다.
// ⚠️ 손상값(날짜 키가 배열이 아닌 truthy)이 들어오면 `[...arr]` 계열 연산이 TypeError를 던져
// 저장·종료·탭전환 같은 임계 경로가 통째로 죽는다(App.tsx portfolioStructureKey의 Array.isArray
// 가드 주석과 같은 등급의 위험). 또 실제 달력에 없는 날짜 키(2026-13-45)는 CalendarModal이
// 렌더할 수 없어 화면에 안 보이고 삭제도 못 하는 유령 기록이 되므로 여기서 버린다.
// 변경이 없으면 원본 참조를 그대로 반환 → 불필요한 저장 트리거 방지(dedupeHistoryByDate 패턴).
// 행 색상 마킹({itemId: 'yellow'|'slate'|'rose'|'brown'}) 지문.
// ⚠️ 키 정렬 필수 — 4색 순환의 마지막이 `delete next[itemId]`라 재마킹 시 키가 객체 끝으로
//    재삽입된다. 정렬 없이 직렬화하면 의미가 같은 상태가 다른 문자열을 내어 가짜 지문 변경이
//    되고, 불필요한 STATE+VERSION write가 나간다(hiddenColumnsPortfolio의 .sort()와 같은 클래스).
// ⚠️ 인자를 지역 변수로 받아 그것만 인덱싱할 것 — Object.keys(null)은 TypeError이고, 이 지문
//    계산이 던지면 그 아래 Drive 저장 예약이 통째로 죽어 그 세션 저장이 멈춘다.
// ⚠️ 삭제된 종목의 stale 키는 정리하지 말 것 — 값이 변하지 않아 무해하고, 정리는 별개 동작 변경이다.
const markedRowsKey = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const m = raw;
  return Object.keys(m).sort().map(k => `${k}:${m[k]}`).join(',');
};

const normalizeCalendarMemos = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  let changed = false;
  const out = {};
  for (const [key, arr] of Object.entries(raw)) {
    if (!isValidIsoDate(key) || !Array.isArray(arr)) { changed = true; continue; }
    const clean = arr.filter(m => m && typeof m === 'object');
    if (clean.length !== arr.length) changed = true;
    if (clean.length) out[key] = clean.length === arr.length ? arr : clean;
    else changed = true; // 빈 날짜 키는 버린다(out과 raw의 의미를 일치시켜 반환 판정이 어긋나지 않게)
  }
  return changed ? out : raw;
};

// ── 카드 창 도입 1회 마이그레이션 ───────────────────────────────────────────────
// ⚠️ 확장(⧉) 버튼은 카드가 화면에 있어야 닿는다 — 사이드 탭으로 접어 둔 카드는 버튼 자체가
//    렌더되지 않아 '별도 창으로 열기'에 도달할 수단이 없다. 그래서 **한 번만** 전 계좌의 접힘을
//    펴 버튼을 노출한다(그 뒤 사용자가 다시 접으면 그대로 유지된다 — 숨기기 기능은 그대로다).
// ⚠️ '한 번'은 맵 **안의 예약 키**로 표현한다 — chartPrefs 영속 5지점을 새로 만들지 않기 위해서다
//    (sectionCollapsedMap은 이미 저장·복원 경로에 있다). 계좌 id와 충돌하지 않는 이름을 쓴다.
// ⚠️ 로드 시 무조건 비우는 방식으로 되돌리지 말 것 — 매 로드마다 숨김이 풀려 '숨기기 유지'가
//    사실상 제거된다.
const CARD_WIN_UNHIDE_KEY = '__cardWindowUnhide_v1__';
const unhideCardsOnce = (map) => {
  const m = (map && typeof map === 'object') ? map : {};
  if (m[CARD_WIN_UNHIDE_KEY]) return m;   // 이미 마이그레이션됨 — **같은 참조**를 돌려준다
  // _SEC_DEFAULT가 전부 false(=보임)라, 계좌별 항목을 비우면 그것이 곧 '전부 보이기'다.
  return { [CARD_WIN_UNHIDE_KEY]: true };
};

export default function App() {
  const historyInputRef = useRef(null);

  // ── 초기 로딩 오버레이 ──
  const [isInitialLoading, setIsInitialLoading] = useState(false);

  // ── 인증 상태 ──
  const [authUser, setAuthUser] = useState<{ email: string; token: string } | null>(null);
  const [userFeatures, setUserFeatures] = useState<UserFeatures>({ name: '', feature1: false, feature2: false, feature3: false, youtubeEnabled: false, notebookEnabled: false, reportEnabled: false, flowEnabled: false, backtestEnabled: false, ledgerEnabled: false });
  const [showAdminPage, setShowAdminPage] = useState(false);
  const [showAdminPortal, setShowAdminPortal] = useState(false);
  const [showAdminChoiceModal, setShowAdminChoiceModal] = useState(false);
  const [adminPendingChoice, setAdminPendingChoice] = useState(false);
  const [driveLoadReady, setDriveLoadReady] = useState(false);
  /**
   * 가계부 데이터가 Drive에서 확정됐는가. `'loading' | 'ready' | 'error'`.
   *
   * ⚠️ `086b582`가 '빈 장부 시드가 dirty를 세우던' 경로를 막았지만 **구멍이 하나 남는다**:
   *    로드 전에 화면을 열고 **사용자가 직접 한 글자라도 치면** dirty가 정당하게 서고,
   *    그러면 뒤늦게 도착한 진짜 장부가 `if (dirtyRef.current) return;`에 막혀 채택되지 않은 채
   *    2.5초 뒤 그 한 줄짜리 장부가 Drive의 실제 기록을 덮는다(2026-08-29 실측 유실 40여 건).
   *    별도 창은 `readOnly={!writable}`로 이미 막혀 있고 **인앱 경로에만 이 가드가 없었다.**
   * ⚠️ 로드 **실패**를 'ready'로 취급하지 말 것 — Drive엔 기록이 있는데 못 읽은 상태라,
   *    거기서 편집을 허용하면 다음 저장이 그 기록을 덮는다. 실패는 읽기 전용으로 잠근다.
   */
  const [ledgerDataState, setLedgerDataState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [adminViewUserCtx, setAdminViewUserCtx] = useState<{
    userEmail: string; userFolderId: string; adminToken: string; adminPinHash: string;
  } | null>(null);
  const [showDividendTaxPage, setShowDividendTaxPage] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  // 환율 계산기 통화 선택 — 코드는 항상 3개 보존(3번째를 지웠다 다시 추가해도 직전 선택 복원),
  // 화면에 보이는 개수만 fxSlotCount(2|3)로 분리 저장한다.
  const [fxCurrencies, setFxCurrencies] = useState<string[]>(() => normalizeFxCurrencies(FX_DEFAULT));
  const [fxSlotCount, setFxSlotCount] = useState(FX_MIN_SLOTS);
  const [dividendTaxHistory, setDividendTaxHistory] = useState<Record<string, any>>({});
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [notebookLinks, setNotebookLinks] = useState<{title: string, url?: string, fileId?: string, createdAt: number}[]>([]);
  // 시장동향 리포트 — 유튜브 채널처럼 URL 하나. 저장 wire 포맷만 'reportLinks' 배열(위 헬퍼 주석 참조).
  const [reportUrl, setReportUrl] = useState('');
  // 자료 등록 시 사용자 공지 발송 여부 — 관리자 페이지 학습자료 섹션 헤더의 '공지 ON/OFF' 토글.
  // 관리자 Drive app_settings.json에 영속. 기본 ON = 기존 동작.
  const [noticeFlags, setNoticeFlags] = useState<{ notebook: boolean }>(NOTICE_FLAGS_DEFAULT);
  // ⚠️ 이 세션에서 관리자가 app_settings를 이미 저장했는가. settings 로드 effect 2곳은 비동기라,
  //    로드가 끝나기 전에 저장하면 **늦게 도착한 로드가 방금 저장한 값을 저장 이전 값으로 되돌린다**
  //    (관리자 페이지 진입 직후 URL을 붙여넣고 바로 저장하면 재현). 저장 이후에는 로드 반영을 건너뛴다.
  const settingsWrittenRef = useRef(false);
  const [adminViewingAs, setAdminViewingAs] = useState<string | null>(null);
  const [targetEditAuthorized, setTargetEditAuthorized] = useState(false);
  const adminTargetNotifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 목표 비중 공지는 관리자 접속(impersonation) 세션당 1회만 — 발송 완료한 대상 이메일을 래치.
  const adminTargetNotifSentRef = useRef<string | null>(null);
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
    // 새 접속 세션 시작 — 목표 비중 공지 1회 래치 해제(같은 사용자로 재접속하면 다시 1건 발송 가능)
    if (adminTargetNotifTimerRef.current) {
      clearTimeout(adminTargetNotifTimerRef.current);
      adminTargetNotifTimerRef.current = null;
    }
    adminTargetNotifSentRef.current = null;
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
    // 대상 사용자가 바뀌면 목표 비중 공지 1회 래치도 해제 — 새 사용자에게는 다시 1건 발송돼야 함
    adminTargetNotifSentRef.current = null;
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
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  // 종목 계좌 간 이관 — 대상 항목 id(모달 열림 여부 겸용)
  const [transferItemId, setTransferItemId] = useState(null);
  const [calendarMemos, setCalendarMemos] = useState<Record<string, any[]>>({});
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [watchlistGroups, setWatchlistGroups] = useState<any[]>([]);
  const [showFlowBoard, setShowFlowBoard] = useState(false);
  const [flowMaps, setFlowMaps] = useState<any[]>([]);
  // ── 백테스트 ──
  // 시나리오는 flowMaps·calendarMemos와 동급의 **앱 레벨 개인 데이터**다(계좌 객체 안에 넣지 말 것 —
  // patchActive가 portfolios 참조를 바꿔 11개 파생 파이프라인이 매 제스처 재실행된다).
  const [showBacktestPage, setShowBacktestPage] = useState(false);
  const [backtestScenarios, setBacktestScenarios] = useState<any[]>([]);
  // ── 가계부 ──
  // 장부도 flowMaps·backtestScenarios와 동급의 **앱 레벨 개인 데이터**다(계좌 객체 안에 넣지 말 것).
  // ⚠️ 포트폴리오와 개념적 의존이 0이므로 '계좌가 하나도 없는 사용자'가 정상 경로다 —
  //    저장 effect의 조기 반환에 그 예외가 있다(없으면 그 사용자의 가계부가 새로고침마다 사라진다).
  const [showLedgerPage, setShowLedgerPage] = useState(false);
  const [ledgerBooks, setLedgerBooks] = useState<any[]>([]);
  // ⚠️ 스냅샷은 `ledgerBooks` **안이 아니라 그 옆**에 산다 — 장부가 통째로 덮이는
  //    사고에서 안전망까지 같이 죽으면 안 된다(2026-08-29 실측 유실이 그 경우다).
  const [ledgerSnapshots, setLedgerSnapshots] = useState<any[]>([]);
  // 가계부 접근 권한 — flowAccess/backtestAccess와 완전히 같은 근거.
  // ⚠️ **여기(위쪽)에 선언한다.** 아래쪽 isAdminUser는 authUser null 가드(early return) 뒤라
  //    별도 창 브릿지 effect에서 참조할 수 없다 — 그래서 관리자 판정을 옵셔널 체이닝으로 직접 한다.
  //    선언은 **한 곳뿐**이어야 인앱 prop과 브릿지 payload의 게이팅이 갈리지 않는다.
  // ⚠️ effectiveUserFeatures(feature1/2/3만 강제하는 별개 경로)에 얹지 말 것 —
  //    그러면 관리자 본인이 영구 접근 불가가 된다.
  const ledgerAccess = ((authUser?.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase()) || !!userFeatures.ledgerEnabled;
  // ⚠️ 백테스트용으로 조회한 종가는 **여기에만** 담는다. stockHistoryMap에 병합하면
  //    buildCloseEvalSeries(보유 평가액 재계산)·useAutoConfirmHistory 데이터완비 가드의 권위
  //    소스가 오염돼 보유+백테스트 중복 코드의 과거 평가액이 영구히 틀어진다(WatchlistPopup 불변식).
  const [btFetched, setBtFetched] = useState<Record<string, Record<string, number>>>({});
  // 백테스트용으로 조회한 종목명·분배 이력. 종가(btFetched)와 같은 이유로 **계좌 데이터에 병합
  // 금지** — 보유하지도 않은 종목이 계좌의 dividendHistory에 섞이면 분배금 현황 표에 유령 행으로
  // 새어 나온다. 파생값이라 Drive에 저장하지도 않는다(다음 세션에 다시 조회).
  const [btFetchedNames, setBtFetchedNames] = useState<Record<string, string>>({});
  const [btFetchedDivs, setBtFetchedDivs] = useState<Record<string, Record<string, number>>>({});
  // 별도 창 전송 게이팅용 단조 증가 카운터 — 이름/분배금은 '코드 수'가 그대로여도 내용만 바뀔 수
  // 있어(강제 재조회) 개수 기반 지문으로는 갱신을 놓친다.
  const [btMetaSeq, setBtMetaSeq] = useState(0);
  const [btFetching, setBtFetching] = useState<string[]>([]);
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
  const currentChartStateRef = useRef<any>({ showKospi: true, showSp500: false, showNasdaq: false, showIndicatorsInChart: { us10y: false, kr10y: false, goldIntl: false, goldKr: false, usdkrw: false, dxy: false, fedRate: false, vix: false, btc: false, eth: false }, goldIndicators: { goldIntl: true, goldKr: true, usdkrw: false, dxy: false }, goldIndicatorColors: { goldIntl: '#ffd60a', goldKr: '#ff9f0a', usdkrw: '#0a84ff', dxy: '#5ac8fa' }, compStocks: [], chartPeriod: '3m', dateRange: { start: '', end: '' }, appliedRange: { start: '', end: '' }, backtestColor: '#f97316', showBacktest: false, showTotalEval: true, showReturnRate: true, histPeriod: 'day' });
  const accountChartStatesRef = useRef<Record<string, any>>({});
  const accountRebalExtraQtyRef = useRef<Record<string, Record<string, number>>>({}); // 계좌별 리밸런싱 '추가' 입력값 보존
  const rebalExtraQtyRef = useRef<Record<string, number>>({}); // 최신 rebalExtraQty 스냅샷 (탭 전환 저장용)
  const intDashCompStocksRef = useRef<any[]>(defaultCompStocks);
  // ── 리밸런싱 목표비중 → 메모 달력 자동 기록 ──
  // calendarMemos state의 최신 미러(같은 tick 연속 커밋 합성 + 저장 핸들러의 동기 조회용)
  const calendarMemosRef = useRef<Record<string, any[]>>({});
  // 목표 관련 변경이 있었던 계좌(portfolioId → true). 리밸런싱 패널은 섹션 접기로 언마운트될 수
  // 있으므로 패널 state가 아니라 App 레벨 ref에 둔다.
  const rebalTargetDirtyRef = useRef<Record<string, true>>({});
  // 매 렌더 최신 build 클로저 유지 — blur→click 사이 리렌더 여부와 무관하게 최신 데이터를 읽는다
  const rebalCommitRef = useRef<any>(null);
  // 종료 경로(pagehide/visibilitychange-hidden/비활동 로그아웃)에서 useDriveSync가 동기 호출
  const rebalExitCommitRef = useRef<(() => any) | null>(null);
  // ── 자금 흐름도(flowMaps) ──
  // ⚠️ 여기에 `flowMapsRef` 같은 App 레벨 미러를 두지 말 것. 종료 커밋의 값 소스는 **FlowBoard의
  //    localRef**(flowFlushRef 경유)이지 App state가 아니다. App 미러를 두면 로드 경로
  //    (applyStateData/applyBackupData)와 동기화할 의무만 생기고, 실제로 읽히지 않아 "stale-write를
  //    막는다"는 잘못된 안전감만 준다(calendarMemosRef는 커밋이 App에서 일어나므로 사정이 다르다).
  // FlowBoard가 마운트 시 등록하고 **언마운트 시 null로 되돌린다**(ErrorBoundary fallback·게이팅 OFF 포함).
  const flowExitCommitRef = useRef<(() => any) | null>(null);
  // 종료 커밋 합성 슬롯 — useDriveSync의 beforeExitSnapshotRef는 단 하나뿐이라 리밸/흐름도를 여기서 합친다.
  const exitCommitRef = useRef<(() => any) | null>(null);
  // 목표 날짜 변경 디바운스 타이머 — 소유 계좌(pid)를 함께 실어 늦은 발화를 폐기
  const rebalDateTimerRef = useRef<{ t: any; pid: string; date: string } | null>(null);
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
  // 통합 대시보드 분배금 표의 월 컬럼 숨김(탭별). 개별 계좌는 계좌별 hiddenDivMonths*에 저장하지만
  // compact 표는 여러 계좌 합산 뷰라 저장할 단일 계좌가 없어 앱 레벨 chartPrefs에 보관한다.
  const [intHiddenDivMonths, setIntHiddenDivMonths] = useState({ expected: [], actual: [] });

  // 평가액 추이 표의 기간 단위 — 'day' | 'week' | 'month' | 'year'.
  // 통합(intHistPeriod)과 개별 계좌(acctHistPeriod)를 분리한다: 두 표는 소스도 열 구성도 다르고,
  // 사용자가 통합은 월간으로, 특정 계좌는 일간으로 보는 조합이 자연스럽다.
  // ⚠️ 개별 계좌 값은 **계좌 공통**(사용자 확정)이다. 계좌별로 두려면 rebalanceSortConfigMap처럼
  //    chartPrefs 단일 맵으로 만들면 되지만(선례 있음), 현재는 스칼라 1개로 충분하다.
  const [intHistPeriod, setIntHistPeriod] = useState('day');
  const [acctHistPeriod, setAcctHistPeriod] = useState('day');

  // ── useHistoryChart 훅 ──
  const {
    chartPeriod, setChartPeriod,
    dateRange, setDateRange,
    appliedRange, setAppliedRange,
    isDragging, setIsDragging,
    refAreaLeft, setRefAreaLeft,
    refAreaRight, setRefAreaRight,
    selectionResult, setSelectionResult,
    anchorDate, setAnchorDate,
    showTotalEval, setShowTotalEval,
    showReturnRate, setShowReturnRate,
    showBacktest, setShowBacktest,
    backtestColor, setBacktestColor,
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
    intHoveredPoint, setIntHoveredPoint,
    intAnchorDate, setIntAnchorDate,
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
    goldKrAutoCrawledRef, stooqAutoCrawledRef, adminTransitioningRef, ownFolderIdRef, syncStatusRef, stockMetaRef, stockLoadFailedRef,
    ensureDriveFolder, loadFromDrive, loadStockFromDrive, saveAllToDrive, requestDriveToken,
    initTokenClient, checkAndSyncFromDrive,
    handleDriveLoadOnly, handleOpenBackupModal, handleApplyBackup, handleImportStateFile,
    initSession, seedLastAutoBackupAt, lastAutoBackupAtRef,
  } = useDriveSync({
    authUser,
    applyStateData: (...args) => applyStateDataRef.current?.(...args),
    applyStockData: (...args) => applyStockDataRef.current?.(...args),
    applyBackupData: (...args) => applyBackupDataRef.current?.(...args),
    accountChartStatesRef, saveStateRef, adminViewingAsRef, adminOwnDriveTokenRef, notify, confirm,
    // 종료 계열 저장(pagehide·visibilitychange hidden·비활동 로그아웃) 직전에 동기 호출 —
    // 브라우저 X·새로고침·로그아웃이 '앱 닫기'의 지배적 경로이고, 그 경로는 saveStateRef만 저장하므로
    // 여기서 커밋하지 않으면 목표비중 기록이 영영 생성되지 않는다(dirty ref는 메모리라 함께 소멸).
    beforeExitSnapshotRef: exitCommitRef,
    onForceLogout: () => {
      // ⚠️ 카드 별도 창 정리를 **ADMIN_VIEW_EMAIL 가드보다 먼저** 한다 — impersonation 탭에서 연
      //    창에는 피조사 사용자의 데이터가 떠 있고, 그 탭이 닫히면 창은 opener 소멸로 읽기 전용이
      //    될 뿐 내용은 그대로 남는다(다중 계정 오염 방지 정책 위반).
      try { teardownCardWinsRef.current?.(); } catch {}
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
    // ⚠️ **캡처 단계** 등록 — 버블로 두면 하위 컴포넌트의 stopPropagation(예: 흐름도 캔버스가
    //    계산기 전역 키 핸들러로 키가 새는 것을 막는 onKeyDownCapture)이 이 리스너까지 차단해
    //    "도형 배치·장문 메모 입력만 하는 세션"이 활동으로 집계되지 않는다(50분 뒤 작업 중
    //    비활동 로그아웃 모달이 튀어나옴). 캡처면 React 트리보다 먼저 발화해 항상 집계된다.
    // ⚠️ pointerdown 추가 — 드래그 핸들러가 preventDefault를 하면 호환 mousedown이 억제된다.
    const opts = true;
    document.addEventListener('mousedown', handler, opts);
    document.addEventListener('pointerdown', handler, opts);
    document.addEventListener('keydown', handler, opts);
    document.addEventListener('touchstart', handler, opts);
    return () => {
      document.removeEventListener('mousedown', handler, opts);
      document.removeEventListener('pointerdown', handler, opts);
      document.removeEventListener('keydown', handler, opts);
      document.removeEventListener('touchstart', handler, opts);
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
    dividendLinks, setDividendLinks,
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
    restorePortfolio,
    purgePortfolio,
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
    transferStockToPortfolio,
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
    deletePortfolioDividendData,
    deletePortfolioTaxData,
    updateTaxBaseEvents,
    updateTaxBasePurchases,
    updateTaxBaseSales,
    updateTaxBaseExPrice,
    updateTaxBaseAvgPrice,
    updateTaxBaseAvgAdj,
    toggleHiddenTaxMonth,
    toggleHiddenDividendMonth,
    updateInvestmentNotes,
    updateInvestmentNotesFor,
    // by-id 라이터(카드 별도 창) — patchActive 계열은 활성 계좌 전용이라 창이 쓸 수 없다.
    handleUpdateFor, applyItemPatchesFor, applyCardWriteFor, patchSettingsForTypeOf,
    toggleHiddenColumnPortfolioFor, toggleHiddenColumnRebalancingFor,
    toggleMarkedRebalRowFor, toggleMarkedPortfolioRowFor,
    resetAllMarkedRebalRowsFor, resetAllMarkedPortfolioRowsFor,
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

  // ── 통합 대시보드 분배금 표 월 숨김 토글 (탭별 독립) ──
  const toggleIntHiddenDivMonth = (tab, monthIndex) => setIntHiddenDivMonths(prev => {
    const key = tab === 'actual' ? 'actual' : 'expected';
    const cur = prev?.[key] ?? [];
    const next = cur.includes(monthIndex) ? cur.filter(m => m !== monthIndex) : [...cur, monthIndex];
    return { ...prev, [key]: next };
  });

  // ── Drive 데이터 적용 콜백 (loadFromDrive / handleApplyBackup 에서 호출) ──
  // STOCK 파일은 loadFromDrive가 STATE와 함께 로드해 applyStockData로 **먼저** 적용한다(STOCK-first) → 여기서는 처리하지 않음
  // opts.preserveView(폴링 재적용 — useDriveSync.checkAndSyncFromDrive): 현재 뷰·활성 계좌를 유지한다.
  //   다른 기기에서 계좌를 전환한 뒤 이 탭으로 돌아오면 과거엔 원격의 활성 계좌·통합 대시보드로 화면이 점프했다.
  //   ⚠️ 단 현재 활성 계좌가 새 배열에 없거나 삭제됐으면 종전 firstLive 폴백은 그대로 수행한다(동결 계좌 오염 불변식).
  //   부팅·수동 불러오기·백업 복원은 종전대로(opts 없음 = 저장된 활성 계좌로 복원).
  const applyStateData = (stateData, _stockData, marketData, opts?) => {
    const preserveView = !!opts?.preserveView;

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
      const curActiveId = activePortfolioIdRef.current;
      const curActiveP = curActiveId ? normalizedPortfolios.find(p => p.id === curActiveId) : null;
      if (preserveView) {
        // 뷰 유지 — 활성 계좌·통합 대시보드 전환 3줄을 건너뛴다. 현재 활성 계좌가 사라졌거나 삭제됐을 때만 폴백.
        if (curActiveId && (!curActiveP || curActiveP.deletedAt)) {
          const firstLive = normalizedPortfolios.find(p => !p.deletedAt && p.accountType !== 'simple' && p.accountType !== 'matong');
          if (firstLive) setActivePortfolioId(firstLive.id);
          else { setActivePortfolioId(null); setShowIntegratedDashboard(true); }
        }
      } else if (restoredP?.deletedAt) {
        // ⚠️ 삭제된 계좌를 활성으로 복원하면 활성 기록 효과가 동결 계좌에 이력을 쓴다 → 라이브 계좌로 대체
        const firstLive = normalizedPortfolios.find(p => !p.deletedAt && p.accountType !== 'simple' && p.accountType !== 'matong');
        if (firstLive) setActivePortfolioId(firstLive.id);
        else { setActivePortfolioId(null); setShowIntegratedDashboard(true); }
      } else if (restoredP?.accountType === 'simple' || restoredP?.accountType === 'matong') {
        setShowIntegratedDashboard(true);
      } else {
        setActivePortfolioId(restoredId);
      }
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
    }
    setCustomLinks(stateData.customLinks || UI_CONFIG.DEFAULT_LINKS);
    if (stateData.overseasLinks) setOverseasLinks(stateData.overseasLinks);
    setDividendLinks(normalizeDividendLinks(stateData.dividendLinks));
    if (stateData.adminAccessAllowed !== undefined) setAdminAccessAllowed(stateData.adminAccessAllowed);
    if (stateData.chartPrefs) {
      if (stateData.chartPrefs.showKospi !== undefined) setShowKospi(stateData.chartPrefs.showKospi);
      if (stateData.chartPrefs.showSp500 !== undefined) setShowSp500(stateData.chartPrefs.showSp500);
      if (stateData.chartPrefs.showNasdaq !== undefined) setShowNasdaq(stateData.chartPrefs.showNasdaq);
      if (stateData.chartPrefs.showTotalEval !== undefined) setShowTotalEval(stateData.chartPrefs.showTotalEval);
      if (stateData.chartPrefs.showReturnRate !== undefined) setShowReturnRate(stateData.chartPrefs.showReturnRate);
      if (stateData.chartPrefs.accountChartStates) {
        accountChartStatesRef.current = stateData.chartPrefs.accountChartStates;
        // 앱 시작 시 활성 계좌의 차트 기간 복원
        // (계좌 전환 이펙트는 prevId===null 조건으로 최초 로드 시 실행 안 됨)
        // 뷰 유지 시에는 **현재** 활성 계좌의 저장값을 복원한다 — 원격 활성 계좌의 조회기간을 이 계좌에 씌우면 안 된다.
        const restoredActiveId = preserveView
          ? (activePortfolioIdRef.current || null)
          : (stateData.activePortfolioId || stateData.portfolios?.[0]?.id);
        const activeSaved = restoredActiveId ? stateData.chartPrefs.accountChartStates[restoredActiveId] : null;
        if (activeSaved?.chartPeriod) setChartPeriod(activeSaved.chartPeriod);
        if (activeSaved?.dateRange) setDateRange(activeSaved.dateRange);
        if (activeSaved?.appliedRange) setAppliedRange(activeSaved.appliedRange);
        // 평가자산·수익률도 계좌별 값이 앱 레벨 값을 이긴다(위 chartPrefs.showTotalEval/
        // showReturnRate 복원보다 **뒤에** 와야 한다 — 순서가 바뀌면 앱 레벨 값이 이긴다).
        // ⚠️ 여기서는 `?? true` 폴백을 쓰지 말 것 — 부팅 시점엔 계좌가 하나뿐이라 누수가 없고,
        //    필드가 없는 옛 저장본은 앱 레벨 값(직전에 쓰던 값)이 가장 자연스러운 복원이다.
        if (activeSaved?.showTotalEval !== undefined) setShowTotalEval(activeSaved.showTotalEval);
        if (activeSaved?.showReturnRate !== undefined) setShowReturnRate(activeSaved.showReturnRate);
      }
      if (stateData.chartPrefs.showMarketPanel !== undefined) setShowMarketPanel(stateData.chartPrefs.showMarketPanel);
      if (stateData.chartPrefs.hideAmounts !== undefined) setHideAmounts(stateData.chartPrefs.hideAmounts);
      if (stateData.chartPrefs.showIndicatorsInChart) setShowIndicatorsInChart(stateData.chartPrefs.showIndicatorsInChart);
      if (stateData.chartPrefs.goldIndicators) setGoldIndicators(stateData.chartPrefs.goldIndicators);
      if (stateData.chartPrefs.goldIndicatorColors) setGoldIndicatorColors(stateData.chartPrefs.goldIndicatorColors);
      if (stateData.chartPrefs.indicatorScales) setIndicatorScales(stateData.chartPrefs.indicatorScales);
      if (stateData.chartPrefs.backtestColor) setBacktestColor(stateData.chartPrefs.backtestColor);
      if (stateData.chartPrefs.showBacktest !== undefined) setShowBacktest(stateData.chartPrefs.showBacktest);
      if (stateData.chartPrefs.sectionCollapsedMap) {
        const _secMap = unhideCardsOnce(stateData.chartPrefs.sectionCollapsedMap);
        setSectionCollapsedMap(_secMap);
        // 마이그레이션이 실제로 값을 바꿨으면 그 세션에 반드시 저장돼야 한다 — 로드 시점엔
        // 구조 지문 effect(첫 실행 스킵)도 chartPrefs effect(isInitialLoad 가드)도 저장을
        // 예약하지 않아, 플래그가 Drive에 안 남으면 다음 로드에서 접힘이 또 풀린다.
        if (_secMap !== stateData.chartPrefs.sectionCollapsedMap) chartPrefsUpdatedAtRef.current = Date.now();
      }
      if (stateData.chartPrefs.intSec) setIntSec(stateData.chartPrefs.intSec);
      if (stateData.chartPrefs.intChartPeriod) setIntChartPeriod(stateData.chartPrefs.intChartPeriod);
      if (stateData.chartPrefs.intDateRange) setIntDateRange(stateData.chartPrefs.intDateRange);
      if (stateData.chartPrefs.intAppliedRange) setIntAppliedRange(stateData.chartPrefs.intAppliedRange);
      if (stateData.chartPrefs.intHiddenDivMonths) setIntHiddenDivMonths(normalizeHiddenDivMonths(stateData.chartPrefs.intHiddenDivMonths));
      // ⚠️ 손상값 방어 필수 — 소비자(compressPeriodRows)가 화이트리스트라 안전하지만, state에
      //    'weke' 같은 값이 들어가면 세그먼트 버튼 어느 것도 눌린 것으로 보이지 않는다.
      if (stateData.chartPrefs.intHistPeriod !== undefined) setIntHistPeriod(normalizeHistPeriod(stateData.chartPrefs.intHistPeriod));
      // ⚠️ 개별 계좌 기간 단위는 **계좌별 값이 앱 레벨 값을 이긴다**. 계좌 전환 이펙트는
      //    prevId===null이라 최초 로드에서 돌지 않으므로 여기서 직접 복원해야 한다.
      //    (accountChartStates 블록이 이 줄보다 **위**에 있어서 거기 넣으면 아래 앱 레벨 값이
      //     덮어써 버린다 — showTotalEval/showReturnRate와 순서가 반대인 것이 이 분기의 이유다.)
      //    계좌별 필드가 없는 옛 저장본만 앱 레벨 값으로 폴백한다.
      {
        const _bootId = preserveView ? (activePortfolioIdRef.current || null) : (stateData.activePortfolioId || stateData.portfolios?.[0]?.id);
        const _bootAcct = _bootId ? stateData.chartPrefs.accountChartStates?.[_bootId] : null;
        if (_bootAcct?.histPeriod !== undefined) setAcctHistPeriod(normalizeHistPeriod(_bootAcct.histPeriod));
        else if (stateData.chartPrefs.acctHistPeriod !== undefined) setAcctHistPeriod(normalizeHistPeriod(stateData.chartPrefs.acctHistPeriod));
      }
      if (stateData.chartPrefs.fxCurrencies) setFxCurrencies(normalizeFxCurrencies(stateData.chartPrefs.fxCurrencies));
      if (stateData.chartPrefs.fxSlotCount !== undefined) setFxSlotCount(normalizeFxSlotCount(stateData.chartPrefs.fxSlotCount));
      if (stateData.chartPrefs.matongClosedIds) setMatongClosedIds(stateData.chartPrefs.matongClosedIds);
      if (stateData.chartPrefs.rebalanceSortConfigMap) setRebalanceSortConfigMap(stateData.chartPrefs.rebalanceSortConfigMap);
      // 통합 대시보드 비교종목 복원 — 앱은 항상 통합 대시보드에서 시작하므로 compStocks도 함께 설정
      if (stateData.chartPrefs.intDashCompStocks) {
        const restoredComps = stateData.chartPrefs.intDashCompStocks.map((s: any) => ({ ...s, loading: false }));
        intDashCompStocksRef.current = restoredComps;
        // 뷰 유지 중 개별 계좌를 보고 있으면 compStocks는 그 계좌의 비교종목이다 — 대시보드 비교종목으로 덮지 않는다.
        if (!preserveView || showIntegratedDashboard) setCompStocks(restoredComps);
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
    if (stateData.calendarMemos) setCalendarMemos(normalizeCalendarMemos(stateData.calendarMemos));
    if (stateData.watchlistGroups) setWatchlistGroups(stateData.watchlistGroups);
    if (stateData.flowMaps) setFlowMaps(normalizeFlowMaps(stateData.flowMaps));
    if (stateData.backtestScenarios) setBacktestScenarios(normalizeBacktestScenarios(stateData.backtestScenarios));
    if (stateData.ledgerBooks) setLedgerBooks(normalizeLedgerBooks(stateData.ledgerBooks));
    if (stateData.ledgerSnapshots) setLedgerSnapshots(normalizeLedgerSnapshots(stateData.ledgerSnapshots));
    seenAdminNotifIdsRef.current = stateData.seenAdminNotifIds || [];
    setSeenAdminNotifIds(seenAdminNotifIdsRef.current);
  };
  applyStateDataRef.current = applyStateData;

  // Drive STOCK 파일 로드 시 호출(부팅 STOCK-first 하이드레이션·지연 도착·폴링) — 기존 메모리 데이터와 병합 (덮어쓰기 금지)
  // ⚠️ 여기서 refreshPrices를 예약하지 말 것 — 옛 `setTimeout(refreshPricesRef, 1200)`이 부팅 중 3번째
  //    시세 갱신을 만들었다(재진입 가드 없이 in-flight 위에 큐잉 → KIS 동시 요청 배가). 갱신은 로드 effect·
  //    폴링·07:30 타이머·수동 버튼이 담당한다.
  // 2번째 인자 meta(realClose 마커)는 useDriveSync가 stockMetaRef에 보관한다 — 여기서는 받기만 하고 쓰지 않는다.
  const applyStockData = (driveStockMap, _meta?) => {
    setStockHistoryMap(prev => {
      // 부팅(메모리 비어 있음): Drive 맵을 **같은 참조**로 채택 — saveAllToDrive의 참조 비교 dirty 판정이
      // "방금 내려받은 맵을 그대로 다시 올리는" 헛업로드(수 MB)를 건너뛴다(lastSavedStockMapRef 시드와 짝).
      if (Object.keys(prev).length === 0) return driveStockMap;
      const merged = { ...driveStockMap };
      Object.entries(prev).forEach(([code, hist]) => {
        merged[code] = { ...(merged[code] || {}), ...hist };
      });
      return merged;
    });
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
      if (restoredP?.deletedAt) {
        const firstLive = normalizedPortfolios.find(p => !p.deletedAt && p.accountType !== 'simple' && p.accountType !== 'matong');
        if (firstLive) setActivePortfolioId(firstLive.id);
        else { setActivePortfolioId(null); setShowIntegratedDashboard(true); }
      } else if (restoredP?.accountType === 'simple' || restoredP?.accountType === 'matong') {
        setShowIntegratedDashboard(true);
      } else {
        setActivePortfolioId(restoredId);
      }
    }
    if (stateData.customLinks) setCustomLinks(stateData.customLinks);
    if (stateData.overseasLinks) setOverseasLinks(stateData.overseasLinks);
    if (stateData.dividendLinks) setDividendLinks(normalizeDividendLinks(stateData.dividendLinks));
    if (stateData.intHistory) setIntHistory(stateData.intHistory);
    // calendarMemos·watchlistGroups = 앱 레벨 개인 데이터 — 백업 복원/파일 가져오기가 현재 기록을
    // 덮어쓰지 않는다. 현재 값이 있으면 유지(과거 이력으로 복원해도 메모 달력·관심종목 보존), 비어
    // 있을 때만 백업/파일 값을 채택(신규 기기 이전 시 유실 방지). ⚠️ 회귀 주의: 이 sticky 규칙은
    // applyBackupData(복원)에만 적용 — applyStateData(정식 Drive 로드)는 그대로 최신값을 불러온다.
    setCalendarMemos(prev => (prev && Object.keys(prev).length > 0) ? prev : (stateData.calendarMemos ? normalizeCalendarMemos(stateData.calendarMemos) : prev));
    setWatchlistGroups(prev => (Array.isArray(prev) && prev.length > 0) ? prev : (stateData.watchlistGroups || prev));
    // ⚠️ 흐름도 sticky 판정은 '컨테이너가 있는가'(length>0)가 아니라 flowMapsHaveContent('내용이
    //    있는가')를 쓴다 — 보드를 열기만 해도 빈 맵 1장이 생기므로 length 기준이면 백업으로
    //    흐름도를 되살릴 길이 영구히 막힌다. useDriveSync의 Drive write 판정과 **같은 함수**를
    //    공유해야 in-memory와 Drive가 갈리지 않는다.
    setFlowMaps(prev => flowMapsHaveContent(prev) ? prev : (stateData.flowMaps ? normalizeFlowMaps(stateData.flowMaps) : prev));
    // ⚠️ 백테스트 시나리오도 같은 sticky 규칙 — 판정은 length가 아니라 backtestScenariosHaveContent
    //    ('내용이 있는가'). 페이지를 열기만 해도 빈 시나리오가 생길 수 있어 length 기준이면 백업으로
    //    되살릴 길이 영구히 막힌다. useDriveSync의 Drive write와 **같은 함수**를 공유해야 갈리지 않는다.
    setBacktestScenarios(prev => backtestScenariosHaveContent(prev) ? prev : (stateData.backtestScenarios ? normalizeBacktestScenarios(stateData.backtestScenarios) : prev));
    // ⚠️ 가계부도 같은 sticky 규칙 — 판정은 length가 아니라 ledgerBooksHaveContent('내용이 있는가').
    //    화면을 열기만 해도 빈 장부가 1권 생기므로 length 기준이면 백업으로 되살릴 길이 영구히 막힌다.
    setLedgerBooks(prev => ledgerBooksHaveContent(prev) ? prev : (stateData.ledgerBooks ? normalizeLedgerBooks(stateData.ledgerBooks) : prev));
    // ⚠️ 스냅샷도 sticky — 백업 복원이 사용자의 '이전 기록' 이력을 되돌리면 그 백업 시점 이후의
    //    복구 지점이 통째로 사라진다(복구 수단이 복구로 지워지는 역설).
    setLedgerSnapshots(prev => ledgerSnapshotsHaveContent(prev) ? prev : (stateData.ledgerSnapshots ? normalizeLedgerSnapshots(stateData.ledgerSnapshots) : prev));
    if (stateData.chartPrefs) {
      if (stateData.chartPrefs.showKospi !== undefined) setShowKospi(stateData.chartPrefs.showKospi);
      if (stateData.chartPrefs.showSp500 !== undefined) setShowSp500(stateData.chartPrefs.showSp500);
      if (stateData.chartPrefs.showNasdaq !== undefined) setShowNasdaq(stateData.chartPrefs.showNasdaq);
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
      if (stateData.chartPrefs.sectionCollapsedMap) {
        const _secMap = unhideCardsOnce(stateData.chartPrefs.sectionCollapsedMap);
        setSectionCollapsedMap(_secMap);
        // 마이그레이션이 실제로 값을 바꿨으면 그 세션에 반드시 저장돼야 한다 — 로드 시점엔
        // 구조 지문 effect(첫 실행 스킵)도 chartPrefs effect(isInitialLoad 가드)도 저장을
        // 예약하지 않아, 플래그가 Drive에 안 남으면 다음 로드에서 접힘이 또 풀린다.
        if (_secMap !== stateData.chartPrefs.sectionCollapsedMap) chartPrefsUpdatedAtRef.current = Date.now();
      }
      if (stateData.chartPrefs.intSec) setIntSec(stateData.chartPrefs.intSec);
      if (stateData.chartPrefs.intHiddenDivMonths) setIntHiddenDivMonths(normalizeHiddenDivMonths(stateData.chartPrefs.intHiddenDivMonths));
      // ⚠️ 손상값 방어 필수 — 소비자(compressPeriodRows)가 화이트리스트라 안전하지만, state에
      //    'weke' 같은 값이 들어가면 세그먼트 버튼 어느 것도 눌린 것으로 보이지 않는다.
      if (stateData.chartPrefs.intHistPeriod !== undefined) setIntHistPeriod(normalizeHistPeriod(stateData.chartPrefs.intHistPeriod));
      if (stateData.chartPrefs.acctHistPeriod !== undefined) setAcctHistPeriod(normalizeHistPeriod(stateData.chartPrefs.acctHistPeriod));
      if (stateData.chartPrefs.fxCurrencies) setFxCurrencies(normalizeFxCurrencies(stateData.chartPrefs.fxCurrencies));
      if (stateData.chartPrefs.fxSlotCount !== undefined) setFxSlotCount(normalizeFxSlotCount(stateData.chartPrefs.fxSlotCount));
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
      // ⚠️ 평가자산·수익률 토글은 **반드시 여기 있어야** 계좌별로 분리된다. 과거엔 app 레벨
      //    chartPrefs에만 있어서, A계좌에서 켠 버튼이 B계좌로 그대로 새어 나갔다(계좌 전환
      //    이펙트가 저장도 복원도 하지 않았다). 비교종목·시장지표·조회기간과 같은 등급이다.
      showTotalEval,
      showReturnRate,
      // ⚠️ 평가액 추이 표의 기간 단위(일/주/월/년)도 **계좌별**이다(사용자 요청 2026-08).
      //    앱 레벨 단일 값이면 한 계좌에서 '월'을 고르는 순간 전 계좌가 월간으로 바뀐다.
      //    바로 옆 조회기간(chartPeriod)이 이미 계좌별이라, 같은 화면의 두 '기간'이 다르게
      //    동작하던 문제도 함께 사라진다. 통합 대시보드(intHistPeriod)는 종전대로 별도 값이다.
      histPeriod: acctHistPeriod,
    };
  }, [showKospi, showSp500, showNasdaq, showIndicatorsInChart, goldIndicators, goldIndicatorColors, compStocks, chartPeriod, dateRange, appliedRange, backtestColor, showBacktest, showTotalEval, showReturnRate, acctHistPeriod]);

  // 차트 설정 변경 시 chartPrefsUpdatedAt 갱신 — Drive STATE 저장 트리거용
  useEffect(() => {
    if (isInitialLoad.current) return;
    chartPrefsUpdatedAtRef.current = Date.now();
  }, [chartPeriod, dateRange, appliedRange, intChartPeriod, intDateRange, intAppliedRange, intSec, showKospi, showSp500, showNasdaq, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, showMarketPanel, hideAmounts, showTotalEval, showReturnRate, sectionCollapsedMap, matongClosedIds, rebalanceSortConfigMap, intHiddenDivMonths, intHistPeriod, acctHistPeriod, fxCurrencies, fxSlotCount, compStocks]);

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
        // 평가자산·수익률 복원 — 필드가 없는 옛 저장본은 컴포넌트 기본값(둘 다 true)으로 폴백해야
        // 한다. `saved.showTotalEval`(undefined)을 그대로 넣으면 버튼이 꺼진 채로 뜨고,
        // '그대로 두기'로 폴백하면 마이그레이션 첫 한 바퀴 동안 원래의 누수가 그대로 보인다.
        setShowTotalEval(saved.showTotalEval ?? true);
        setShowReturnRate(saved.showReturnRate ?? true);
        // 평가액 추이 기간 단위 복원. 필드가 없는 옛 저장본은 normalizeHistPeriod가 'day'로
        // 떨어뜨린다 — 첫 방문 기본값과 같아서 직전 계좌 값을 물려받지 않는다(누수 방지).
        setAcctHistPeriod(normalizeHistPeriod(saved.histPeriod));
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
        // 처음 방문하는 계좌는 직전 계좌의 토글을 물려받지 않는다(useHistoryChart 기본값과 동일).
        setShowTotalEval(true);
        setShowReturnRate(true);
        // 처음 방문하는 계좌의 평가액 추이는 '일'로 시작한다(사용자 확정 2026-08) —
        // 다른 차트 토글과 같은 규약이라 직전 계좌 선택이 새어 나가지 않는다.
        setAcctHistPeriod('day');
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
    // 날짜 집합은 통합 대시보드(useIntegratedData marketSeries)와 **같은 함수**를 쓴다 —
    // 구성 변경일(계좌를 비운 날)이 빠지면 이관한 종목이 이 계좌에 계속 계상된다(evalSeriesDates 주석).
    return buildCloseEvalSeries(activePortfolio, evalSeriesDates(activePortfolio, history.map(h => h?.date), edk), activePortfolioAccountType, stockHistoryMap, indicatorHistoryMap, edk);
  }, [activePortfolio, history, activePortfolioAccountType, stockHistoryMap, indicatorHistoryMap, krEffectiveDateKey, effectiveDateKey]);

  // 활성 계좌의 날짜별 장부액(Σ 예수금+매입원가) — 일간 지표 보류 판정이 '원장 흐름이 그날 평가액에
  // 반영됐는가'를 ΔV로 추측하지 않고 관측하게 하는 값.
  // ⚠️ **활성 계좌의 `computeDailyMetricsSeries` 소비자 3곳이 이 하나의 Map을 공유해야 한다** —
  //    `accountTwrByDate`(차트 조회시작 0% 라인)·`HistoryPanel`(추이표)·`handleDownloadCSV`.
  //    한 곳만 빠지면 같은 날짜에 차트와 표가 다른 일간 수익률을 내고(표 −2.00% vs 차트 +0.01%),
  //    TWR은 곱셈 체인이라 그 오차가 이후 전 구간에 영구 고정된다.
  //    해외는 장부 USD ↔ 흐름 ₩ 단위 불일치로 미공급(null → 기존 ΔV 폴백).
  const activeBookByDate = useMemo(() => {
    if (['overseas', 'simple', 'matong'].includes(activePortfolioAccountType) || !activePortfolio) return null;
    return buildBookCostSeries(activePortfolio, history.map(h => h?.date));
  }, [activePortfolio, history, activePortfolioAccountType]);

  // ── 종목 계좌 간 이관 ─────────────────────────────────────────────────────────
  // 이관은 '출금 + 입금' 원장 쌍으로 기록해야 일간 지표가 정확히 상쇄된다(근거·3행 구성은
  // utils.buildTransferLedgerRows 주석 참조). 여기서는 미리보기 값 산출만 담당한다.
  const transferItem = useMemo(
    () => (transferItemId ? (activePortfolio?.portfolio || []).find(it => it && it.id === transferItemId) || null : null),
    [transferItemId, activePortfolio]
  );

  // 대상 계좌 후보 — 통화·시장·항목 타입이 맞는 계좌만. 부적격은 사유를 달아 그대로 노출한다
  // (목록에서 지워 버리면 "왜 안 보이지"가 되고, 사용자가 잘못된 계좌를 고를 위험도 없다).
  const transferTargets = useMemo(() => {
    if (!transferItem || !activePortfolio) return [];
    const srcType = activePortfolioAccountType;
    const code = String(transferItem.code || '').trim();
    const TYPE_LABEL = {
      portfolio: '일반', isa: 'ISA', 'dc-irp': '퇴직연금', pension: '연금저축',
      dividend: '배당형', crypto: 'CRYPTO', overseas: '해외',
    };
    return (portfolios || [])
      .filter(p => p && p.id !== activePortfolioId && !p.deletedAt)
      .map(p => {
        const t = p.accountType || 'portfolio';
        let reason = '';
        if (t === 'simple' || t === 'matong') reason = '현금성';
        else if (t === 'gold') reason = '금현물';
        // 통화·시장이 다르면 원가·원장 단위가 어긋난다(해외는 USD 기준, crypto는 24시간 시장)
        else if ((t === 'overseas') !== (srcType === 'overseas')) reason = '통화 불일치';
        else if ((t === 'crypto') !== (srcType === 'crypto')) reason = '시장 불일치';
        else if (transferItem.type === 'savings' && t !== 'dc-irp') reason = '예적금 불가';
        else if (transferItem.type === 'fund' && t !== 'dc-irp' && t !== 'pension') reason = '펀드 불가';
        // ⚠️ 동일 코드는 차단한다 — actualDividend[code][ym]·taxBaseHistory[code]가 양쪽에 있으면
        //    병합이 한쪽을 조용히 지운다. 조용한 오적용보다 명시적 미적용(복원 모달과 같은 규약).
        else if (code && (p.portfolio || []).some(x => x && String(x.code || '').trim() === code)) reason = '이미 보유';
        return { id: p.id, name: p.name, isTest: !!p.isTest, typeLabel: TYPE_LABEL[t] || t, blocked: !!reason, reason };
      })
      .sort((a, b) => (a.blocked === b.blocked ? 0 : a.blocked ? 1 : -1));
  }, [transferItem, portfolios, activePortfolioId, activePortfolio, activePortfolioAccountType]);

  // 함께 이동하는 코드별 기록 건수(미리보기 표시용)
  const transferMoves = useMemo(() => {
    if (!transferItem || !activePortfolio) return null;
    const code = String(transferItem.code || '').trim();
    if (!code) return { dividend: 0, tax: 0, price: 0 };
    const cnt = (m) => (m && typeof m === 'object' && m[code] && typeof m[code] === 'object' ? Object.keys(m[code]).length : 0);
    const dividend = ['actualDividend', 'actualDividendUsd', 'actualDividendQty', 'dividendTaxAmounts', 'actualAfterTaxUsd', 'actualAfterTaxKrw', 'dividendHistory']
      .reduce((s, k) => s + cnt(activePortfolio[k]), 0);
    const tb = (activePortfolio.taxBaseHistory || {})[code];
    const tax = tb ? ((tb.events || []).length + (tb.purchases || []).length + (tb.sales || []).length
      + Object.keys(tb.exTaxBase || {}).length + Object.keys(tb.avgTaxBase || {}).length) : 0;
    return { dividend, tax, price: cnt(activePortfolio.manualPriceOverrides) };
  }, [transferItem, activePortfolio]);

  // ⚠️ 기록일은 실행 시점에 getBackfillBoundaryForAccount를 **직접** 호출한다(effectiveDateKey state
  //    금지 — 타이머 드리프트 자가보정). 이 날짜라야 원장·보유 스냅샷·평가액이 같은 날 함께 움직인다.
  // ⚠️ 이관 금액 M = 수량 × '직전 기록일 종가'. 실시간 평가금액이 아니다 — 장중 이관이면 그 종목은
  //    당일 V에서 통째로 빠지므로 마지막 기여분이 직전 기록일 종가이고, 실시간가를 쓰면 그날 장중
  //    등락분이 양쪽 계좌에 반대 부호의 가짜 손익으로 남는다(TWR 곱셈 체인이 영구 고정).
  // ⚠️ 원가 C는 반드시 bookCostOf — buildBookCostSeries가 관측하는 장부액과 같은 정의라야
  //    shouldHoldDailyMetrics의 흡수 판정(bookDelta vs 흐름)이 정확히 맞물린다.
  const buildTransferPlan = (targetId) => {
    const tgt = (portfolios || []).find(p => p && p.id === targetId);
    if (!transferItem || !activePortfolio || !tgt) return null;
    const srcType = activePortfolioAccountType;
    const dateSrc = getBackfillBoundaryForAccount(srcType);
    const dateTgt = getBackfillBoundaryForAccount(tgt.accountType || 'portfolio');
    let prevDate = '';
    (history || []).forEach(h => {
      const d = h && h.date;
      if (d && d < dateSrc && d > prevDate) prevDate = d;
    });
    // ⚠️ 해외계좌는 calcPortfolioEvalDetail이 **내부에서 그 날짜 환율로 원화 환산**한다(utils.ts).
    //    원장 amount·principal·bookCostOf는 전부 USD이므로 반드시 되나눠 USD로 돌려야 한다 —
    //    안 그러면 이관 금액만 약 1,390배가 되어 원금·흐름이 통째로 오염된다.
    const isOv = srcType === 'overseas';
    let market = 0, exact = false;
    if (prevDate) {
      const r = calcPortfolioEvalDetail([transferItem], srcType, prevDate, stockHistoryMap, indicatorHistoryMap || {}, 1, activePortfolio.manualPriceOverrides);
      if (r.hasAnyPrice && r.total > 0) { market = isOv ? r.total / (r.fxRate || 1) : r.total; exact = !!r.allExact; }
    }
    if (!(market > 0)) {
      // 폴백: 라이브 평가액(직전 기록일 종가 미확보) — 그날 장중 등락분만큼 오차가 남을 수 있다
      prevDate = '';
      const qty = cleanNum(transferItem.quantity);
      const px = cleanNum(transferItem.currentPrice);
      market = transferItem.type === 'savings' ? savingsEval(transferItem)
        : (transferItem.type === 'fund' && !(qty > 0 && px > 0)) ? cleanNum(transferItem.evalAmount)
        : qty * px;
    }
    // ⚠️ costBasisOnly는 해외·금 계좌에 필수 — 그쪽 항목의 investAmount는 UI가 유지하지 않는
    //    잔존 필드라, 레거시 원화 값이 남아 있으면 장부 단위가 통째로 어긋난다(CLAUDE.md 검증 #30b).
    //    해외의 사용자 입력 총액은 별도 필드 `investAmountUsd`이고 purchasePrice가 그 파생 미러라,
    //    여기서 나오는 cost는 사용자가 입력한 투자금액과 같은 값이다(utils.overseasInvestAmount 참조).
    const cost = bookCostOf([transferItem], { costBasisOnly: isOv || srcType === 'gold' });
    return { market, cost, dateSrc, dateTgt, prevDate, exact };
  };

  const handleTransferStock = (targetId, plan) => {
    if (!transferItem || !plan || !activePortfolioId) return;
    const ok = transferStockToPortfolio({
      sourceId: activePortfolioId, targetId, itemId: transferItem.id,
      market: plan.market, cost: plan.cost, dateSrc: plan.dateSrc, dateTgt: plan.dateTgt,
    });
    if (ok) setTransferItemId(null);
  };

  // 개별 계좌 누적 TWR — '조회시작 0%' 모드 라인의 소스. 입출금이 있어도 곡선이 왜곡되지 않는다.
  // ⚠️ 전체 이력에서 한 번 누적한다(조회구간으로 자르지 않는다). 구간 재베이스는 finalChartData가
  //    rebaseTwr로 처리 — 그래야 조회구간을 바꿔도 곡선 모양이 불변이고 흐름 이월 상태가 안 끊긴다.
  // ⚠️ 평가액 소스는 차트 라인과 **동일**해야 한다: 시장계좌=activeCloseEvalByDate(수량×종가),
  //    해외=overseasUsdEvalAt(USD). 다른 소스를 쓰면 라인과 %가 갈린다.
  // 해외는 평가도 원장도 USD 그대로 쓴다(환산 없음 — 아래 해외 원금 계산·PortfolioChart 실손익과 동일 규약).
  const accountTwrByDate = useMemo(() => {
    const asc = history.filter(h => h?.date).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    if (asc.length === 0) return new Map();
    const isOv = activePortfolioAccountType === 'overseas';
    const rows = asc.map((h, i) => {
      const prev = asc[i - 1];
      const flow = prev
        ? externalFlowInRange(depositHistory, depositHistory2, prev.date, h.date)
        : { in: 0, out: 0 };
      const ovEval = isOv ? overseasUsdEvalAt(portfolio, h.date, stockHistoryMap) : null;
      const cb = isOv ? null : activeCloseEvalByDate.get(h.date);
      const ev = ovEval != null ? ovEval : (cb != null ? cb : cleanNum(h.evalAmount));
      // ⚠️ bookDelta를 빼지 말 것 — 추이표(HistoryPanel)와 같은 관측을 써야 같은 날짜에 두 화면이
      //    같은 일간 수익률을 낸다. 곱셈 체인이라 하루의 불일치가 이후 전 구간에 영구 고정된다.
      return {
        date: h.date, evalAmount: ev, flowIn: flow.in, flowOut: flow.out,
        bookDelta: prev ? bookDeltaBetween(activeBookByDate, prev.date, h.date) : null,
      };
    });
    return computeCumulativeTwrSeries(rows);
  }, [history, activePortfolioAccountType, portfolio, stockHistoryMap, activeCloseEvalByDate, activeBookByDate, depositHistory, depositHistory2]);

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
          // ⚠️ accountTwrByDate와 **같은 함수**를 쓴다(overseasUsdEvalAt) — 라인과 % 소스 일치.
          const usdRaw = overseasUsdEvalAt(portfolio, date, stockHistoryMap);
          const hasData = usdRaw != null;
          const usdEval = hasData ? usdRaw : 0;
          trueEvalAtDate = usdEval;
          hasReliableEval = hasData;
          const usdPrin = cleanNum(principal);
          if (hasData && usdPrin > 0) retRate = (usdEval - usdPrin) / usdPrin * 100;
        } else if (exactHist) {
          // 종가 확정 기반 재계산값(수량×종가)을 우선 사용, 없으면 저장된 라이브 값 폴백 (추이 표와 동일 소스)
          const cb = activeCloseEvalByDate.get(date);
          const evalForDate = cb != null ? cb : exactHist.evalAmount;
          trueEvalAtDate = evalForDate;
          hasReliableEval = true;
          const histPrin = resolveRecordPrincipal(effective.value, exactHist, date, localSortedHist, principal);
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
        // 해외계좌: USD 기준 — fxRate 미적용. ⚠️ 식을 여기 인라인으로 되돌리지 말 것 —
        // HistoryPanel(추이 표 누적)이 같은 함수를 호출해야 두 화면의 원금·수익금이 일치한다.
        principalAmount = overseasPrincipalAt(date, sortedDeposits, sortedWithdrawals, principal, portfolioStartDate);
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
    const zeroBasedData = (rawData.length === 0) ? rawData : (() => {
      const baseItem = rawData.find(item => item.evalAmount > 0) || rawData[0];
      // 지수·비교종목·시장지표 base는 각 시리즈의 조회기간 내 첫 non-null 시점(=조회시작)을 사용한다.
      // 포트폴리오 시리즈만 baseItem(포트폴리오 최초 평가일)을 0% 기준으로 쓰고, 시세 시리즈에
      // baseItem을 쓰면 안 된다 — 포트폴리오 최초 평가일이 조회시작보다 늦을 때 그 늦은 날의 지수값이
      // 0% 기준이 되어 조회시작 지점이 큰 음수(예: KOSPI −70%)로 찍히던 버그(정보패널 라벨·구간
      // 수익률은 조회시작 시점을 base로 쓰므로 라인과 불일치). 또 baseItem 시점에 특정 시리즈 값이
      // 0/null이면(상장 이전·캐시 미수집) 전 구간 rate가 null이 되어 라인이 통째로 사라진다.
      const firstBase = (pk) => rawData.find(d => d[pk] != null && d[pk] > 0)?.[pk] || 0;
      // '나의 수익률' 라인은 **누적 TWR을 조회시작 기준으로 재베이스**한 값이다(평가액 비율 아님).
      // ⚠️ (V(t) ÷ V(시작) − 1)로 되돌리지 말 것 — 입금액이 분자에 통째로 들어가 +747%처럼 부풀고,
      //    실제 손익이 마이너스인 구간이 플러스로 뒤집힌다(이 모드를 고친 이유).
      // 기록일이 아닌 차트 날짜(주말·지수만 있는 날)는 직전 기록일 TWR을 이월(carry-forward).
      // rawData는 filteredDates 순서(날짜 오름차순)라 포인터 1회 순회로 충분하다.
      const twrEntries = [...accountTwrByDate.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
      const twrByChartDate = new Map();
      let tIdx = 0, curTwr = null;
      for (const item of rawData) {
        while (tIdx < twrEntries.length && twrEntries[tIdx][0] <= item.date) { curTwr = twrEntries[tIdx][1]; tIdx++; }
        twrByChartDate.set(item.date, curTwr);
      }
      const baseTwr = twrByChartDate.get(baseItem.date);
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
          // 첫 기록 이전 날짜(TWR 미설정)는 null → 라인 미표시(0% 평탄선 방지, 기존 계약 유지).
          principalReturnRate: item.principalReturnRate != null ? rebaseTwr(twrByChartDate.get(item.date), baseTwr) : null,
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
  }, [filteredDates, indexDataMap, stockHistoryMap, portfolio, history, totals.totalEval, totals.totalInvest, principal, portfolioStartDate, indicatorScales, compStocks, depositHistory, depositHistory2, activePortfolioAccountType, avgExchangeRate, marketIndicators, activeCloseEvalByDate, accountTwrByDate]);

  // ── 통합 대시보드 계산 ──
  const {
    portfolioSummaries,
    intTotals,
    computedIntHistory,
    intAccountSeriesById,
    intSortedHistory,
    intUnifiedDates,
    intFilteredDates,
    intChartData,
    intMonthlyHistory,
    intTwrCumByDate,
    intCatDonutData,
    intHoldingsDonutData,
    intDepositEvents,
  } = useIntegratedData({
    portfolios, activePortfolioId, portfolio, principal,
    avgExchangeRate, portfolioStartDate, title, marketIndicators,
    history, depositHistory, depositHistory2, intAppliedRange,
    effectiveDateKey, krEffectiveDateKey,
    compStocks, stockHistoryMap, indicatorHistoryMap,
  });


  const { handleImportHistoryJSON } = useIndexImport({
    marketIndices, setMarketIndices, setIndexFetchStatus,
    setStockHistoryMap, setMarketIndicators, setIndicatorHistoryMap, notify,
  });


  const {
    handleChartMouseDown, handleChartMouseMove, handleChartMouseUp, handleChartMouseLeave, handleChartDoubleClick,
    handleIntChartMouseDown, handleIntChartMouseMove, handleIntChartMouseUp, handleIntChartMouseLeave, handleIntChartDoubleClick,
    resetChartSelectionRefs,
  } = useChartInteraction({
    finalChartData, intChartData, compStocks, INDICATOR_CHART_KEYS,
    // ⚠️ 읽기용 state(refAreaLeft/refAreaRight/isDragging)는 넘기지 않는다 — 훅 안 ref가 정본이고,
    //    지연 커밋되는 state를 읽으면 '긴 조회기간에서 드래그가 사라지던' 버그가 되살아난다.
    setIsDragging, setRefAreaLeft, setRefAreaRight,
    setSelectionResult, setHoveredPoint, setAnchorDate,
    setIntIsDragging, setIntRefAreaLeft, setIntRefAreaRight,
    setIntSelectionResult, setIntHoveredPoint, setIntAnchorDate,
  });

  // ── useStockData 훅 ──
  const {
    handleStockBlur,
    handleSingleStockRefresh,
    handleSingleStockRefreshFor,   // 카드 별도 창(비활성 계좌) 전용
    handleAddCompStock,
    handleRemoveCompStock,
    handleCompStockBlur,
    handleToggleComp,
    handleFetchCompHistory,
    handleForceRefetchComp,
    autoRefreshStockPrices,
    refreshPrices,
    refetchStockHistory,
    histPhase, histPartial, histProgress,
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
    stockMetaRef,
    stockLoadFailedRef,
    saveStateRef, driveTokenRef, saveAllToDrive,
    chartPeriod, appliedRange,
    setIsLoading, notify,
    setMarketIndices, setIndexFetchStatus,
    marketHolidays,
  });
  refreshPricesRef.current = refreshPrices;

  // 백필(효과#2)·자동확정은 useStockData **뒤**에 둔다 — 부팅 상태 머신 histPhase(정착 신호)를 게이트로 받기 위해서다.
  // STOCK-first는 Drive 캐시(전 세션 장중 stamp 포함)를 KIS 실제종가 도착 **전에** 보이게 하므로, 백필은 settled에서만,
  // 비가역 확정(자동확정)은 settled && !partial에서만 한다. ⚠️ useHistoryBackfill → useAutoConfirmHistory 순서는 그대로
  // (자동확정은 백필 결과 위에 합성된다 — useAutoConfirmHistory 상단 주석).
  useHistoryBackfill({
    stockHistoryMap, indicatorHistoryMap, marketIndicators,
    portfolioSummaries, portfolios, setPortfolios,
    activePortfolioId, setHistory, effectiveDateKey, krEffectiveDateKey,
    marketHolidays,
    histPhase,
  });

  // 앱 실행 시 자산검증 불일치 라이브 레코드를 '수량×종가로 자동확정' (useHistoryBackfill 뒤에서 합성)
  useAutoConfirmHistory({
    stockHistoryMap, indicatorHistoryMap, marketIndicators,
    portfolios, setPortfolios, effectiveDateKey, krEffectiveDateKey,
    histPhase, histPartial,
  });

  // ── 부팅 시세 갱신 트리거 ──
  // ⚠️ refreshPrices는 portfoliosRef·activePortfolioIdRef·stockHistoryMapRef처럼 **effect로 동기화되는 ref**를
  //    동기적으로 읽는다. loadFromDrive 안의 setState는 DefaultLane이라 렌더와 passive effect가 **다음
  //    매크로태스크들**에서 돌고, 로드 effect의 `await loadFromDrive()` 직후 컨티뉴에이션은 그보다 앞선
  //    마이크로태스크다 → 거기서 직접 부르면 빈 계좌를 읽어 시세를 한 건도 조회하지 않는다.
  //    (setTimeout(0)도 passive effect 태스크보다 먼저 발화할 수 있어 신뢰 불가.) 그래서 첫 갱신은
  //    ref 동기화 effect보다 **뒤에 선언된** 이 effect가 쏘고, 로드 effect는 그 Promise를 받아 기다린다.
  //    resolve에는 Promise를 직접 넘기지 않는다(넘기면 채택돼 '시작' 신호가 '완료'까지 미뤄진다) — 객체로 감싼다.
  // ── 로딩 오버레이 해제 = 이력 패스 정착(histPhase 'settled') ──
  // ⚠️ 'settled'만 보고 닫으면 안 된다 — 그 값은 부팅 뒤에도 갱신마다 refreshing↔settled를 오가고,
  //    관리자 impersonation 진입처럼 **리로드 없이** 오버레이를 다시 켜는 경로에서는 이전 세션의 'settled'가
  //    그대로 남아 있어 로드가 시작되기도 전에 팝업이 닫힌다. 그래서 이번 부팅이 정착을 기다리는 중인지
  //    (로드 effect가 세우는) awaitingSettleRef로 게이팅하고, 닫을 때 내린다.
  const awaitingSettleRef = useRef(false);
  useEffect(() => {
    if (!awaitingSettleRef.current) return;
    if (histPhase !== 'settled') return;
    awaitingSettleRef.current = false;
    setIsInitialLoading(false);
  }, [histPhase]);

  const [bootRefreshSeq, setBootRefreshSeq] = useState(0);
  const bootRefreshResolveRef = useRef<((v: { run: Promise<void> }) => void) | null>(null);
  useEffect(() => {
    if (bootRefreshSeq === 0) return;
    const run = refreshPrices();
    const resolve = bootRefreshResolveRef.current;
    bootRefreshResolveRef.current = null;
    resolve?.({ run });
  }, [bootRefreshSeq]);

  // 계좌 탭 전환 시 현재가 자동 갱신, 자동 기록 ref 초기화
  useEffect(() => {
    autoFundHistoryRef.current = null;
    if (!didSwitchPortfolioRef.current) { didSwitchPortfolioRef.current = true; return; }
    // 부팅 중(applyStateData의 null→복원 id 전환)에는 쏘지 않는다 — 첫 갱신은 위 bootRefreshSeq 트리거
    // 한 곳이 맡는다(과거엔 여기서 1회 더 나가 KIS 동시 요청이 배가됐다). 사용자 전환은 종전대로.
    if (isInitialLoad.current) return;
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

  // ── 리밸런싱 목표비중 → 메모 달력 자동 기록 ──
  // 리밸런싱 표 '목표(%)' 열 헤더의 날짜(settings.targetDate) 칸에 그 시점 목표 비중 스냅샷을 남긴다.
  // (날짜, portfolioId)당 1건 upsert. 상세 규약·회귀 주의는 CLAUDE.md 전용 섹션 참조.
  useEffect(() => { calendarMemosRef.current = calendarMemos; }, [calendarMemos]);

  // ⚠️ 실제 계산은 utils의 순수 함수(buildRebalTargetEntryFrom)가 한다 — 카드 별도 창이 **자기
  //    화면 값**으로 같은 엔트리를 만들어 보내야 '기록 = 화면 표 1:1'이 지켜지기 때문이다.
  //    여기(앱 탭)는 활성 계좌 스코프를 그 함수에 그대로 넘기는 얇은 래퍼다.
  const buildRebalTargetEntry = (overrideDate) => buildRebalTargetEntryFrom({
    portfolioId: activePortfolio?.id,
    accountName: title || activePortfolio?.name,
    accountType: activePortfolioAccountType,
    deletedAt: activePortfolio?.deletedAt,
    settings,
    rebalanceData,
    rebalanceSortConfig,
    rebalExtraQty,
    overrideDate,
  });

  // ⚠️ effect가 아니라 **렌더 중 대입**이다 — blur(setState)와 click 사이에 passive effect가
  //    flush된다는 보장에 기대지 않기 위해서다(이 ref는 이벤트 핸들러·타이머에서만 읽힌다).
  // ⚠️ 이 한 줄이 인앱 메모 달력 목표비중 자동 기록의 **유일한 배선**이다. 없으면
  //    commitRebalTargetSnapshot의 `built`가 항상 undefined가 되어 트리거 4계열(뷰 이탈·저장 3핸들러·
  //    종료 커밋·날짜 디바운스)이 전부 조용히 no-op이 되고, '즉시 기록' 칩은 언제나 '기록 불가'를
  //    표시하며 dirty 플래그가 영구히 남는다. RebalancingPanel은 이 ref를 모르므로(FlowBoard/
  //    BacktestPage의 flushRef prop과 달리) 등록자가 여기밖에 없다.
  //    ⚠️ 실제로 utils 추출 리팩터링에서 이 줄이 소실된 적이 있다 — undefcheck·scopecheck·esbuild
  //    어느 것도 못 잡는다(선언은 살아 있고 참조만 0이 된다). verify:card-window #G24가 단언한다.
  rebalCommitRef.current = buildRebalTargetEntry;

  const sameRebalEntry = sameRebalTargetEntry;   // utils 공유 — 창 경로와 판정이 갈리지 않게

  const commitRebalTargetSnapshot = (overrideDate?: string) => {
    // ⚠️ 예외 격리 필수 — 이 함수는 저장·앱닫기·탭전환 임계 경로의 첫 줄에서 동기 호출된다.
    // 여기서 던지면 window.close()·switchToPortfolio에 도달하지 못해 앱이 멈춘 것처럼 보인다.
    try {
      const pid = activePortfolioIdRef.current;
      if (!pid || !rebalTargetDirtyRef.current[pid]) return null;
      const built = rebalCommitRef.current?.(overrideDate);
      if (!built || built.entry.portfolioId !== pid) return null; // 날짜 미지정 등 → dirty 유지
      const { dayKey, entry } = built;
      // ⚠️ upsert는 utils 공유 함수 — 창 경로(saveTargetSnapshot)와 키·승계 규약이 갈리면
      //    같은 날짜에 기록이 둘 생기거나 칩 key가 흔들린다.
      const next = upsertRebalTargetMemo(calendarMemosRef.current, dayKey, entry, generateId(), Date.now());
      if (!next) {
        delete rebalTargetDirtyRef.current[pid]; // 기록할 내용이 없으니 dirty도 해제(무한 재시도 방지)
        return null;
      }
      calendarMemosRef.current = next;
      setCalendarMemos(next);
      delete rebalTargetDirtyRef.current[pid];
      return next;
    } catch (e) {
      console.warn('[rebalTarget] 목표비중 기록 실패 — 저장/종료/전환은 계속 진행', e);
      return null;
    }
  };

  // 대기 중인 날짜 디바운스 타이머를 회수해 커밋에 태운다(중복 발화 방지). 계좌가 바뀌었으면 폐기.
  const flushRebalTargetSnapshot = () => {
    const pending = rebalDateTimerRef.current;
    let date;
    if (pending) {
      clearTimeout(pending.t);
      rebalDateTimerRef.current = null;
      if (pending.pid === activePortfolioIdRef.current) date = pending.date;
    }
    return commitRebalTargetSnapshot(date);
  };

  // 리밸런싱 패널의 목표 관련 변경 통지(값이 실제 바뀐 편집만 도달). date가 오면 날짜 변경.
  const handleTargetEdited = (opts?: { date?: string }) => {
    const pid = activePortfolioIdRef.current;
    if (!pid) return;
    rebalTargetDirtyRef.current[pid] = true;
    const date = opts?.date;
    if (!date) return;
    // 날짜 변경은 즉시 기록이 기대되지만, 피커에서 여러 날짜를 연속 클릭하면 클릭한 날짜마다
    // 기록이 잔재한다(이전 날짜 기록은 자동 삭제하지 않는 규약) → 디바운스로 마지막 선택만 남긴다.
    if (rebalDateTimerRef.current) clearTimeout(rebalDateTimerRef.current.t);
    rebalDateTimerRef.current = { pid, date, t: setTimeout(() => {
      rebalDateTimerRef.current = null;
      if (pid !== activePortfolioIdRef.current) return; // 800ms 사이 계좌가 바뀌었으면 폐기
      commitRebalTargetSnapshot(date);
    }, 800) };
  };

  // 목표 날짜 칸 **왼쪽 여백 클릭 = 즉시 기록**(사용자 명시 액션).
  // ⚠️ 과거엔 기록을 남기는 통로가 '날짜를 다시 커밋해 dirty를 세우는' 우회로뿐이었고(칩 더블클릭 →
  //    직접 입력 → blur), 그 **첫 클릭이 네이티브 피커를 함께 열어** 두 번째 클릭이 피커의 날짜 칸에
  //    떨어져 엉뚱한 날짜로 바뀌었다. 저장 경로를 칩 왼쪽 구역으로 분리한 것이 이 핸들러다.
  // ⚠️ dirty 여부와 무관하게 기록한다 — dirty는 '값이 실제 바뀐 편집'에서만 서므로, 목표는 그대로고
  //    시세·수량만 움직인 지금 상태를 남기고 싶을 때 기존 경로로는 아무 일도 일어나지 않는다.
  // ⚠️ 반환값은 패널의 **인라인 피드백 전용**이다(알림 최소화 정책 — 성공 notify 금지, 화면 변화가 피드백).
  const handleTargetSaveNow = () => {
    const pid = activePortfolioIdRef.current;
    if (!pid) return 'fail';
    // 대기 중인 날짜 디바운스가 있으면 그 날짜가 기록 대상이다(flush가 아래에서 회수해 커밋에 태운다).
    const pending = rebalDateTimerRef.current;
    const dayKey = (pending && pending.pid === pid ? pending.date : '') || settings?.targetDate;
    // '헤더에 보이는 날짜 = 기록 날짜' 불변식 — 오늘로 폴백하지 않는다(빌드와 같은 유효성 검사).
    if (!isValidIsoDate(dayKey)) return 'nodate';
    const yr = parseInt(dayKey.slice(0, 4), 10);
    if (yr < 1900 || yr > 2999) return 'nodate';
    const wasDirty = !!rebalTargetDirtyRef.current[pid];
    rebalTargetDirtyRef.current[pid] = true;
    const next = flushRebalTargetSnapshot();
    if (next) return 'saved';
    // 커밋이 null인 경우는 둘 — ① 내용이 같아 기록할 게 없음(dirty 해제됨) ② 빌드 실패(dirty 잔존).
    if (rebalTargetDirtyRef.current[pid]) {
      if (!wasDirty) delete rebalTargetDirtyRef.current[pid]; // 명시 저장이 실패했으면 dirty도 원상 복구
      return 'fail';
    }
    return 'nochange';
  };

  // ── 과거 목표비중 복원 (읽기 방향) ──
  // 활성 계좌의 rebalTarget 스냅샷 목록(최신 우선). 리밸런싱 표 목표 열의 📅 아이콘이 소비한다.
  const rebalTargetSnapshots = useMemo(
    () => listRebalTargetSnapshots(calendarMemos, activePortfolioId),
    [calendarMemos, activePortfolioId],
  );

  // 복원 적용 후 통지. **복원 자체는 calendarMemos에 아무것도 쓰지 않는다**(순수 읽기).
  // ⚠️ dirty를 세우는 조건이 이 기능의 안전장치 전부다. 커밋은 **소스 날짜가 아니라 헤더 날짜**
  //    (`settings.targetDate`)에 쓰이고, upsert는 `(kind, portfolioId)`만 보고 그 날짜 기록을
  //    **통째로 교체**한다(`commitRebalTargetSnapshot`). 그러므로 **헤더 날짜에 이 계좌 기록이 이미
  //    있으면 절대 dirty를 세우면 안 된다** — 그 원본이 복원값 + 오늘 수량·평가금으로 덮여
  //    "그날 이 비중을 목표로 삼았다"는 **거짓 이력**이 되고, calendarMemos는 백업 복원 sticky라
  //    되살릴 수 없다. 기록은 언제나 헤더 날짜에 만들어지므로 '헤더에 기록 있음'이 오히려 기본 상태다.
  //    → 기록은 **헤더 날짜가 빈 날일 때만** 남긴다(그때는 파괴할 원본이 없다).
  //    사용자가 복원을 이력으로 남기고 싶으면 헤더 날짜를 기록 없는 날로 바꾸면 된다
  //    ('헤더에 보이는 날짜 = 기록 날짜' 불변식 그대로. 모달이 이 상태를 앰버로 사전 고지한다).
  // ⚠️ 기존 dirty를 **지우지 말 것** — 복원과 무관한 대기 중 편집까지 소각돼 그 날짜 기록이 영영 안 생긴다.
  const handleTargetRestored = (opts) => {
    const pid = activePortfolioIdRef.current;
    if (!pid || !opts || opts.portfolioId !== pid) return;
    const headerDate = settings?.targetDate;
    if (!headerDate || !opts.dayKey || headerDate === opts.dayKey) return;
    const headerArr = calendarMemosRef.current?.[headerDate];
    if (Array.isArray(headerArr) && headerArr.some(m => m?.kind === 'rebalTarget' && m.portfolioId === pid)) return;
    rebalTargetDirtyRef.current[pid] = true;
  };

  // 계좌 뷰를 떠나기 직전 커밋 — 탭/드롭다운/통합 대시보드 진입이 모두 이 래퍼를 경유한다.
  // ⚠️ usePortfolioState에 넘기는 원본 setShowIntegratedDashboard는 래핑하지 않는다(계좌 삭제 등 내부 흐름).
  const switchToPortfolioWithSnapshot = (id) => { flushRebalTargetSnapshot(); switchToPortfolio(id); };
  const goIntegratedDashboard = (v) => { if (v) flushRebalTargetSnapshot(); setShowIntegratedDashboard(v); };

  // 종료 계열 저장(pagehide·visibilitychange hidden·비활동 로그아웃) 직전에 useDriveSync가 동기 호출.
  // ⚠️ 언로드 중에는 리렌더가 보장되지 않아 setCalendarMemos만으로는 저장 payload에 안 실린다 →
  //    반환값을 그대로 스냅샷에 병합시키고, portfolioUpdatedAt을 올려 STATE 저장 가드를 통과시킨다.
  rebalExitCommitRef.current = () => {
    const next = flushRebalTargetSnapshot();
    if (!next) return null;
    const ts = Date.now();
    portfolioUpdatedAtRef.current = ts;
    // ⚠️ saveStateRef도 **동기 갱신** — 반환값 병합만으로는 부족하다. pagehide 시점에 이미 저장이
    // 진행 중이면 saveAllToDrive가 조기 반환하며 pendingSaveRef에 saveStateRef.current를 담는데,
    // 언로드라 리렌더가 없어 그 값이 기록 없는 옛 스냅샷이면 그대로 유실된다. 또 visibilitychange가
    // dirty를 먼저 소진한 뒤 pagehide가 발화하는 순서에서도 이 갱신이 기록을 살려 둔다.
    saveStateRef.current = { ...saveStateRef.current, calendarMemos: next, portfolioUpdatedAt: ts };
    return { calendarMemos: next, portfolioUpdatedAt: ts };
  };

  // ── 자금 흐름도 커밋 회수 ──
  // FlowBoard는 편집을 **로컬 사본**에 모으고 idle(2.5초)·보드 닫기·종료 시점에만 App state로
  // 승격한다. 드래그/타이핑마다 setFlowMaps를 하면 ① portfolioStructureKey가 전 계좌를 매 프레임
  // 재직렬화하고 ② 제스처마다 Drive 저장(STATE+VERSION+STOCK+MARKET = HTTP 8회 + 종목 2년치
  // 일봉 전량 재업로드)이 나간다. 여기서 그 미승격 편집을 동기 회수한다.
  // ⚠️ flowFlushRef는 FlowBoard가 마운트 시 등록하고 **언마운트 시 null로 되돌린다**
  //    (ErrorBoundary fallback·게이팅 OFF 포함) → 죽은 클로저가 낡은 값을 Drive에 쓰는 것을 막는다.
  const flowFlushRef = useRef<(() => any[] | null) | null>(null);
  const flushFlowSnapshot = () => {
    let next: any[] | null = null;
    try { next = flowFlushRef.current?.() ?? null; } catch { next = null; }
    if (!next) return null;
    setFlowMaps(next);
    return next;
  };

  // ⚠️ 미저장 편집이 없으면 반드시 null — 항상 truthy를 반환하면 alt-tab마다 4파일 write가 강제된다.
  flowExitCommitRef.current = () => {
    const next = flushFlowSnapshot();
    if (!next) return null;
    const ts = Date.now();
    portfolioUpdatedAtRef.current = ts;
    // saveStateRef 동기 갱신 — 언로드 중에는 리렌더가 없어 setFlowMaps만으로는 payload에 안 실린다.
    saveStateRef.current = { ...saveStateRef.current, flowMaps: next, portfolioUpdatedAt: ts };
    return { flowMaps: next, portfolioUpdatedAt: ts };
  };

  // ── 백테스트 커밋 회수 (흐름도와 동일 규약) ──
  // BacktestPage도 편집을 로컬 사본에 모으고 idle(2.5초)·닫기·언마운트에만 승격한다. 목표금액·
  // 기간을 타이핑할 때마다 setBacktestScenarios를 하면 글자마다 Drive 4파일 write가 나간다.
  const backtestFlushRef = useRef<(() => any[] | null) | null>(null);
  const flushBacktestSnapshot = () => {
    let next: any[] | null = null;
    try { next = backtestFlushRef.current?.() ?? null; } catch { next = null; }
    if (!next) return null;
    setBacktestScenarios(next);
    return next;
  };

  // ⚠️ 미저장 편집이 없으면 반드시 null — 항상 truthy를 반환하면 alt-tab마다 4파일 write가 강제된다.
  const backtestExitCommitRef = useRef<(() => any) | null>(null);
  backtestExitCommitRef.current = () => {
    const next = flushBacktestSnapshot();
    if (!next) return null;
    const ts = Date.now();
    portfolioUpdatedAtRef.current = ts;
    // saveStateRef 동기 갱신 — 언로드 중에는 리렌더가 없어 setBacktestScenarios만으로는 payload에 안 실린다.
    saveStateRef.current = { ...saveStateRef.current, backtestScenarios: next, portfolioUpdatedAt: ts };
    return { backtestScenarios: next, portfolioUpdatedAt: ts };
  };

  // ── 가계부 커밋 회수 (흐름도·백테스트와 동일 규약) ──
  // LedgerPage도 편집을 로컬 사본에 모으고 idle(2.5초)·언마운트·pagehide에만 승격한다.
  // ⚠️ ledgerFlushRef는 LedgerPage가 마운트 시 등록하고 **언마운트 시 null로 되돌린다**.
  const ledgerFlushRef = useRef<(() => any[] | null) | null>(null);
  const flushLedgerSnapshot = () => {
    let next: any[] | null = null;
    try { next = ledgerFlushRef.current?.() ?? null; } catch { next = null; }
    if (!next) return null;
    setLedgerBooks(next);
    return next;
  };

  // ⚠️ 미저장 편집이 없으면 반드시 null — 항상 truthy를 반환하면 alt-tab마다 4파일 write가 강제된다.
  const ledgerExitCommitRef = useRef<(() => any) | null>(null);
  ledgerExitCommitRef.current = () => {
    const next = flushLedgerSnapshot();
    if (!next) return null;
    const ts = Date.now();
    portfolioUpdatedAtRef.current = ts;
    // saveStateRef 동기 갱신 — 언로드 중에는 리렌더가 없어 setLedgerBooks만으로는 payload에 안 실린다.
    saveStateRef.current = { ...saveStateRef.current, ledgerBooks: next, portfolioUpdatedAt: ts };
    return { ledgerBooks: next, portfolioUpdatedAt: ts };
  };

  // 종료 커밋 합성 — 슬롯이 하나뿐이라 리밸런싱·흐름도·백테스트·가계부 커밋을 여기서 합친다.
  // ⚠️ 반환 키(calendarMemos / flowMaps / backtestScenarios)가 겹치지 않아 병합 순서는 무관하고, 셋 모두
  //    portfolioUpdatedAtRef와 saveStateRef를 동기 갱신하므로 뒤 커밋이 앞 커밋을 지우지 않는다.
  // ⚠️ 전부 없으면 반드시 **null**을 반환할 것 — 항상 truthy를 반환하면 alt-tab·탭 닫기마다
  //    STATE+VERSION+STOCK+MARKET 4파일 write가 무조건 강제된다(커밋할 게 없다는 신호가 소실).
  exitCommitRef.current = () => {
    let r: any = null, f: any = null, b: any = null, lg: any = null;
    try { r = rebalExitCommitRef.current?.() ?? null; } catch { r = null; }
    try { f = flowExitCommitRef.current?.() ?? null; } catch { f = null; }
    try { b = backtestExitCommitRef.current?.() ?? null; } catch { b = null; }
    try { lg = ledgerExitCommitRef.current?.() ?? null; } catch { lg = null; }
    if (!r && !f && !b && !lg) return null;
    return { ...(r || {}), ...(f || {}), ...(b || {}), ...(lg || {}) };
  };

  // 메모 달력 날짜 칸의 자산 스냅샷(총자산/일간/누적) 클릭 → 그날의 '계좌별 현황'.
  // ⚠️ 통합 대시보드 추이표 팝업(IntegratedDashboard가 utils를 직접 import)과 **같은 함수**를 쓴다 —
  //    달력 쪽에서 따로 계산하도록 되돌리면 같은 날짜에 두 화면의 소계가 갈린다.
  // ⚠️ 값 복사가 아니라 **호출마다 재계산**한다(달력 패드의 '앵커 + 라이브 재조회' 계약과 동일) —
  //    스냅샷을 들고 있으면 시세·계좌 변경 뒤에도 팝업만 옛 값을 보여준다.
  const buildHistDetail = useCallback((date) => buildHistDetailRows({
    date,
    portfolios: allPortfoliosForDividend,
    portfolioSummaries,
    accountSeriesById: intAccountSeriesById,
    realtimeDate: intMonthlyHistory.length > 0 ? intMonthlyHistory[0].date : '',
    liveTotalEval: intTotals?.totalEval,
    activePortfolioId,
    activeHistory: history,
  }), [allPortfoliosForDividend, portfolioSummaries, intAccountSeriesById, intMonthlyHistory, intTotals?.totalEval, activePortfolioId, history]);

  // ── 메모 달력 '별도 브라우저 창' 브릿지 (`/?calendarWindow=1`) ──────────────────────────────
  // 새 창은 로그인·Drive 없이 postMessage로만 동작하는 뷰어/에디터다. 저장은 전부 이 탭을 경유해
  // 기존 STATE 저장 경로로 흐른다 → **writer는 끝까지 이 탭 하나**.
  // ⚠️ 새 창에서 앱을 통째로 부팅하는 방식으로 바꾸지 말 것(상세 근거: CalendarWindow.tsx 상단).
  const calWinRef = useRef(null);
  // 새 창에서 열려 있는 '계좌별 현황' 패드의 날짜(없으면 null = 구독 해제). 그 창은 App을
  // 마운트하지 않고 잘린 원장만 받으므로 스스로 계산할 수 없다 → 이 탭이 계산해 밀어 준다.
  const calWinDetailDateRef = useRef(null);
  // ⚠️ **렌더 중 대입**(핸들러·effect에서만 읽는다) — message 핸들러 effect의 deps는
  //    [updateInvestmentNotesFor] 하나라, buildHistDetail을 그대로 클로저로 잡으면 그 함수가
  //    언젠가 useCallback으로 감싸이는 순간 핸들러가 마운트 시점 값에 얼어붙어 **영구히 낡은
  //    행**을 응답한다(rebalCommitRef·flowFlushRef와 동일 패턴).
  const histDetailFnRef = useRef(null);
  histDetailFnRef.current = buildHistDetail;
  const [calWinNonce, setCalWinNonce] = useState(0);   // ready/재입양 시 전체 재전송 트리거
  const [calWinBlocked, setCalWinBlocked] = useState(false);
  const postToCalWin = (msg) => {
    const w = calWinRef.current;
    if (!w || w.closed) return;
    try { w.postMessage(msg, window.location.origin); } catch {}
  };
  // 새 창이 실제로 읽는 계좌 필드만 투영. 시세 갱신마다 portfolios 배열이 새로 생기므로
  // ⚠️ 전송은 **지문**으로 게이팅한다 — 지문 없이 보내면 보유 스냅샷 전량이 수십 초마다 복제된다.
  const calWinAccounts = useMemo(() => (portfolios || []).map(p => ({
    id: p.id, name: p.name, accountType: p.accountType, deletedAt: p.deletedAt,
    baselineDate: p.baselineDate,
    investmentNotes: p.investmentNotes || [],
    holdingSnapshots: p.holdingSnapshots || [],
    // 메모 달력 '종목 이관(MOVE)' 칩 소스 — transfer 태그가 붙은 원장 행만 투영한다.
    // ⚠️ 잘린 원장이다. CalendarModal은 이 두 배열을 오직 collectTransferRows로만 읽으므로
    //    동작이 동일하지만, 새 창 쪽에서 입출금 원장 전체가 필요한 소비자를 추가하면 안 된다
    //    (전량 복제하면 시세 갱신마다 원장이 통째로 postMessage로 나간다).
    depositHistory: (p.depositHistory || []).filter(r => r && r.transfer),
    depositHistory2: (p.depositHistory2 || []).filter(r => r && r.transfer),
  })), [portfolios]);
  // ⚠️ 투자기록은 본문까지, 스냅샷은 snapshotCompositionKey까지 담는다 — 건수만 보면 '본문만 수정',
  //    '같은 날짜 스냅샷의 수량만 수정'이 새 창에 반영되지 않는다(portfolioStructureKey와 동일 이유).
  // ⚠️ 새 창이 한 번이라도 붙기 전(nonce 0)에는 계산 자체를 건너뛴다 — snapshotCompositionKey를
  //    전 스냅샷에 도는 비용을 시세 갱신마다 치를 이유가 없다(대다수 세션은 새 창을 안 쓴다).
  const calWinAccountsKey = useMemo(() => (calWinNonce === 0 ? '' : JSON.stringify((portfolios || []).map(p => [
    p.id, p.name || '', p.accountType || '', p.deletedAt || '', p.baselineDate || '',
    (p.investmentNotes || []).map(n => `${n?.id}:${n?.date}:${n?.content || ''}`).join('|'),
    (p.holdingSnapshots || []).map(s => `${s.date}:${s.kind}:${snapshotCompositionKey(s.items || [])}`).join('|'),
    // 이관 기록 — 없으면 새 창의 MOVE 칩이 갱신되지 않는다(위 두 지문과 동일 이유)
    collectTransferRows(p).map(r => `${r.date}:${r.rowId}:${r.role}`).join('|'),
  ]))), [portfolios, calWinNonce]);

  useEffect(() => {
    postToCalWin({ type: 'calendar:accounts', accounts: calWinAccounts, activePortfolioId, holidays: marketHolidays });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calWinAccountsKey, activePortfolioId, marketHolidays, calWinNonce]);

  useEffect(() => {
    postToCalWin({
      type: 'calendar:live',
      memos: calendarMemos,
      metricsHistory: intMonthlyHistory,
      todayReturnRate: intTotals.returnRate,
      fxHistory: indicatorHistoryMap?.usdkrw,
      us10yHistory: indicatorHistoryMap?.us10y,
      liveFx: marketIndicators?.usdkrw,
      liveUs10y: marketIndicators?.us10y,
      // ⚠️ payload와 deps **양쪽**에 넣을 것 — 한쪽만 하면 새 창이 토글 변경을 놓친다.
      hideAmounts,
      // 가계부 BUDGET 칩 — ⚠️ 지문 게이팅된 calendar:accounts가 아니라 여기에 싣는다.
      //    accounts는 `portfolios` 지문으로만 게이팅돼서, 장부만 바뀐 편집은 새 창에 영영
      //    반영되지 않는다(계좌를 건드릴 때까지). live는 원본 deps라 그 함정이 없다.
      // ⚠️ 인앱 prop과 **같은 표현**을 써야 두 렌더러의 게이팅이 구조적으로 일치한다 —
      //    raw로 보내면 권한이 꺼진 사용자의 별도 달력 창에만 BUDGET 칩이 남는다.
      ledgerBooks: ledgerAccess ? ledgerBooks : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMemos, intMonthlyHistory, intTotals.returnRate, indicatorHistoryMap, marketIndicators, hideAmounts, ledgerBooks, ledgerAccess, calWinNonce]);

  // 새 창의 '계좌별 현황' 패드가 열려 있는 동안 소스 데이터가 바뀌면 **다시 밀어 준다**(구독).
  // ⚠️ 1회성 스냅샷으로 되돌리지 말 것 — 같은 패드 상단의 지표 밴드(metricsByDate)는 calendar:live로
  //    시세 틱마다 갱신되므로, 표만 얼면 40px 거리에서 같은 날짜의 총자산이 두 값으로 보인다
  //    (패드의 '앵커 + 라이브 재조회' 계약 위반 + 인앱 경로와 갈림).
  // ⚠️ deps는 buildHistDetail 하나면 충분하다 — 그 useCallback의 deps가 곧 이 표의 입력 전부라
  //    identity가 바뀌는 시점 = 표가 달라질 수 있는 시점이다. 반대로 calendar:live payload에
  //    얹지는 말 것(그쪽은 패드가 닫혀 있어도 시세 틱마다 전 계좌 행을 무조건 복제한다).
  useEffect(() => {
    const d = calWinDetailDateRef.current;
    // ⚠️ 생존 확인을 **계산 앞**에 둔다 — postToCalWin 안의 closed 검사만 믿으면, 사용자가 새 창을
    //    브라우저 X로 닫아도(구독 해제 메시지가 못 온다) 전 계좌 시계열 스캔이 세션 내내 계속 돈다.
    const w = calWinRef.current;
    if (!d || !w || w.closed) return;
    let detail = null;
    try { detail = buildHistDetail(d); } catch { detail = null; }
    postToCalWin({ type: 'calendar:detail', date: d, ...(detail || EMPTY_HIST_DETAIL) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildHistDetail, calWinNonce]);

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;   // ⚠️ 필수 — 교차 출처 메시지는 전부 무시
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith('calendar:')) return;
      if (d.type === 'calendar:ping') {
        // ⚠️ `d.need`(= 새 창이 아직 데이터 없음)가 **초기 전송의 유일한 트리거**다. window.open 직후
        //    보내면 아직 로드 전(about:blank)이라 메시지가 버려지므로, 새 창의 준비 신호를 기다린다.
        // 이 탭이 새로고침되면 calWinRef가 비므로, 살아 있는 새 창의 핑을 받아 **재입양**하고
        // 전체 데이터를 다시 보낸다(없으면 새 창은 영영 낡은 데이터를 들고 있게 된다).
        if (d.need || calWinRef.current !== e.source) { calWinRef.current = e.source; setCalWinNonce(n => n + 1); }
        try { e.source?.postMessage({ type: 'calendar:pong' }, window.location.origin); } catch {}
        return;
      }
      if (!calWinRef.current || e.source !== calWinRef.current) return;   // 쓰기는 입양된 창만
      if (d.type === 'calendar:memos') {
        if (!d.memos || typeof d.memos !== 'object') return;
        // 인앱 창과 동일 계약 — 미러 ref도 같이 갱신(목표비중 커밋이 옛 값으로 통째 교체하는 것 방지)
        calendarMemosRef.current = d.memos;
        setCalendarMemos(d.memos);
      } else if (d.type === 'calendar:notes') {
        if (!d.portfolioId || !Array.isArray(d.notes)) return;
        updateInvestmentNotesFor(d.portfolioId, d.notes);
      } else if (d.type === 'calendar:openLedger') {
        // 별도 달력 창의 '가계부 열기' 위임. ⚠️ 그 창이 직접 window.open을 부르면 새 창의
        //    opener가 **달력 창**이 되어 가계부 창이 앱 탭과 영원히 연결되지 못하고 읽기
        //    전용으로 굳는다 → 앱 탭이 연다.
        // ⚠️ 권한 재확인 필수 — 창은 URL로 열리므로 조작 가능하다는 전제(fail-closed).
        // 알려진 한계: 이 탭에는 사용자 제스처가 없어 브라우저가 팝업을 막을 수 있다.
        //    그때는 openLedgerWindow가 인앱 폴백으로 떨어져 앱 탭에 가계부가 열린다.
        if (isAdminUser || userFeatures.ledgerEnabled) openLedgerWindow();
      } else if (d.type === 'calendar:wantDetail') {
        // 새 창의 자산 스냅샷 클릭 → 그 날짜의 '계좌별 현황' **구독 등록**. date가 null이면 패드가
        // 닫힌 것이라 구독을 해제하고 응답하지 않는다(열려 있는 동안은 위 effect가 재전송한다).
        // ⚠️ 이 분기는 반드시 위의 입양 게이트(e.source !== calWinRef.current) **뒤**에 있어야 한다 —
        //    입양되지 않은 창·iframe이 임의 날짜의 계좌별 자산을 뽑아가는 통로가 되면 안 된다
        //    (ping만 그 앞에 있는 것이 의도된 유일한 예외).
        // ⚠️ 응답은 여기서 **즉시** 보낸다. 지문 게이팅 effect로 만들면 같은 날짜를 두 번째로
        //    클릭할 때 지문이 같아 재발화하지 않아 응답이 영영 오지 않는다.
        if (d.date != null && (typeof d.date !== 'string' || !isValidIsoDate(d.date))) return;
        calWinDetailDateRef.current = d.date || null;
        if (!d.date) return;
        let detail = null;
        // ⚠️ 절대 던지지 않게 — 이 핸들러가 죽으면 그 창의 메모·투자기록 쓰기까지 함께 멈춘다.
        try { detail = histDetailFnRef.current ? histDetailFnRef.current(d.date) : null; } catch { detail = null; }
        postToCalWin({ type: 'calendar:detail', date: d.date, ...(detail || EMPTY_HIST_DETAIL) });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [updateInvestmentNotesFor]);

  // ⚠️ 클릭 제스처 직후 **동기** window.open이라야 팝업 차단을 피한다(관리자 '접속' 새 탭과 동일).
  // ⚠️ noopener 금지 — opener 브릿지가 이 기능의 전부다(impersonation 탭과 정반대 규칙).
  const openCalendarWindow = () => {
    const existing = calWinRef.current;
    if (existing && !existing.closed) { try { existing.focus(); } catch {} setShowCalendarModal(false); return; }
    // 칸 높이는 뷰포트에서 역산되므로 처음부터 화면을 꽉 채워 연다(칸을 키우는 것이 이 기능의 목적).
    const sw = (window.screen && window.screen.availWidth) || 1440;
    const sh = (window.screen && window.screen.availHeight) || 900;
    const w = window.open('/?calendarWindow=1', 'ass-calendar', `width=${sw},height=${sh},left=0,top=0`);
    if (!w) { setCalWinBlocked(true); return; }   // 차단 → 인앱 창을 그대로 두고 안내만 띄운다
    calWinRef.current = w;
    setCalWinBlocked(false);
    setShowCalendarModal(false);
  };

  // ── 자금 흐름도 '별도 브라우저 창' 브릿지 (`/?flowWindow=1`) ─────────────────────────────
  // 메모 달력 창과 **완전히 같은 규약**: 새 창은 App을 부팅하지 않고 postMessage로만 대화하며,
  // 저장은 전부 이 탭을 경유해 기존 STATE 저장 경로로 흐른다 → writer는 끝까지 이 탭 하나.
  const flowWinRef = useRef(null);
  const [flowWinNonce, setFlowWinNonce] = useState(0);
  const [flowWinBlocked, setFlowWinBlocked] = useState(false);
  const postToFlowWin = (msg) => {
    const w = flowWinRef.current;
    if (!w || w.closed) return;
    try { w.postMessage(msg, window.location.origin); } catch {}
  };
  // 새 창이 실제로 읽는 계좌 필드만 투영(dc-irp 예적금은 만기 '제안'에만 쓰이므로 그 항목만).
  // ⚠️ 전송은 **지문**으로 게이팅한다 — portfolios는 시세 갱신마다 새 배열이라 지문 없이 보내면
  //    수십 초마다 전량이 복제된다. 새 창이 붙기 전(nonce 0)에는 계산 자체를 건너뛴다.
  const flowWinAccounts = useMemo(() => (portfolios || []).map(p => ({
    id: p.id, name: p.name, accountType: p.accountType,
    deletedAt: p.deletedAt, isTest: p.isTest,
    portfolio: (p.portfolio || [])
      .filter(it => it && it.type === 'savings' && it.endDate)
      .map(it => ({ id: it.id, type: 'savings', name: it.name, endDate: it.endDate })),
  })), [portfolios]);
  const flowWinAccountsKey = useMemo(() => (flowWinNonce === 0 ? '' : JSON.stringify(flowWinAccounts)), [flowWinAccounts, flowWinNonce]);
  const flowWinSummaries = useMemo(() => (portfolioSummaries || []).map(s => ({
    id: s.id, currentEval: s.currentEval, deletedAt: s.deletedAt,
  })), [portfolioSummaries]);

  useEffect(() => {
    postToFlowWin({ type: 'flow:accounts', accounts: flowWinAccounts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowWinAccountsKey, flowWinNonce]);

  useEffect(() => {
    postToFlowWin({ type: 'flow:live', maps: flowMaps, summaries: flowWinSummaries, hideAmounts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowMaps, flowWinSummaries, hideAmounts, flowWinNonce]);

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;   // ⚠️ 필수 — 교차 출처 메시지는 전부 무시
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith('flow:')) return;
      if (d.type === 'flow:ping') {
        // `d.need`가 초기 전송의 유일한 트리거(window.open 직후 보내면 about:blank라 버려진다).
        // 이 탭이 새로고침되면 flowWinRef가 비므로 살아 있는 창의 핑에서 **재입양**한다.
        if (d.need || flowWinRef.current !== e.source) { flowWinRef.current = e.source; setFlowWinNonce(n => n + 1); }
        try { e.source?.postMessage({ type: 'flow:pong' }, window.location.origin); } catch {}
        return;
      }
      if (!flowWinRef.current || e.source !== flowWinRef.current) return;   // 쓰기는 입양된 창만
      if (d.type === 'flow:maps') {
        if (!Array.isArray(d.maps)) return;
        setFlowMaps(normalizeFlowMaps(d.maps));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ⚠️ 클릭 제스처 직후 **동기** window.open이라야 팝업 차단을 피한다.
  // ⚠️ noopener 금지 — opener 브릿지가 이 기능의 전부다(impersonation 탭과 정반대 규칙).
  const openFlowWindow = () => {
    const existing = flowWinRef.current;
    if (existing && !existing.closed) { try { existing.focus(); } catch {} setShowFlowBoard(false); return; }
    const sw = (window.screen && window.screen.availWidth) || 1440;
    const sh = (window.screen && window.screen.availHeight) || 900;
    const w = window.open('/?flowWindow=1', 'ass-flow', `width=${sw},height=${sh},left=0,top=0`);
    if (!w) {
      // 팝업 차단 → 인앱 보드로 폴백(최악의 경우가 기존 동작이 되게 한다)
      setFlowWinBlocked(true);
      setShowFlowBoard(true);
      return;
    }
    flowWinRef.current = w;
    setFlowWinBlocked(false);
    setShowFlowBoard(false);
  };

  // ── 계좌 카드 '별도 브라우저 창' 브릿지 (`/?cardWindow=1&card=…&pid=…`) ─────────────────
  // 메모 달력·흐름도·백테스트 창과 **같은 규약**(App 미마운트 · noopener 금지 · ping.need가 초기
  // 전송의 유일한 트리거 · 재입양 · 끊기면 읽기 전용)이되, **결정적으로 다른 점 하나**가 있다:
  // 카드 창은 (계좌 × 카드) 조합마다 하나씩 열리므로 **단일 ref가 아니라 레지스트리(Map)**다.
  // 기존 3창처럼 단일 ref로 두면 뒤에 핑을 보낸 창만 데이터를 받고 앞 창은 영구히 낡은 값을 든다.
  const cardWinsRef = useRef(new Map());          // winId → { id, card, pid, win }
  const [cardWinKeys, setCardWinKeys] = useState([]);   // 피더 렌더용(레지스트리의 키 목록)
  const [cardWinNonce, setCardWinNonce] = useState(0);  // 재입양 시 전량 재전송 트리거
  const [cardWinBlocked, setCardWinBlocked] = useState(false);

  // ⚠️ 로그인 세션 식별자. 앱 탭이 로그아웃→다른 사용자로 재로그인해도 창은 살아남아 5초 핑으로
  //    재입양되므로, epoch가 다르면 창이 **화면 내용을 지운다**(단순 읽기 전용으로는 이전 사용자의
  //    금융 데이터가 그대로 남는다 — 이 앱이 명시적으로 방어하는 '한 기기 다중 계정 오염' 정책).
  const cardAuthEpoch = (authUser && authUser.email) ? String(authUser.email).toLowerCase() : null;

  // 확장 버튼 표기 전환용 — 열려 있는 창의 (카드:계좌) 집합. 레지스트리는 ref라 렌더에 직접 쓰면
  // 안 되고, sweep/입양이 갱신하는 cardWinKeys에서 파생시켜야 화면이 실제 상태를 따라간다.
  const cardWinOpenSet = useMemo(() => new Set(cardWinKeys), [cardWinKeys]);

  const syncCardWinKeys = useCallback(() => {
    setCardWinKeys(prev => {
      const next = Array.from(cardWinsRef.current.keys());
      if (prev.length === next.length && prev.every((k, i) => k === next[i])) return prev;
      return next;
    });
  }, []);

  // 닫힌 창 정리 — 남겨 두면 피더가 계속 마운트된 채 postMessage를 시도한다.
  const sweepCardWins = useCallback(() => {
    let changed = false;
    cardWinsRef.current.forEach((v, k) => {
      if (!v.win || v.win.closed) { cardWinsRef.current.delete(k); changed = true; }
    });
    if (changed) syncCardWinKeys();
  }, [syncCardWinKeys]);

  useEffect(() => {
    const id = setInterval(sweepCardWins, 5000);
    return () => clearInterval(id);
  }, [sweepCardWins]);

  // ⚠️ 로그아웃·세션 충돌 시 모든 카드 창을 정리한다. `onForceLogout`은 reload만 하므로 창은
  //    살아남는다 — teardown을 보내 화면을 비우고 닫는다(창이 못 닫히면 창 쪽이 안내만 남긴다).
  const teardownCardWins = useCallback(() => {
    cardWinsRef.current.forEach(v => {
      try { v.win?.postMessage({ type: 'card:teardown', winId: v.id }, window.location.origin); } catch {}
      try { v.win?.close(); } catch {}
    });
    cardWinsRef.current.clear();
    syncCardWinKeys();
  }, [syncCardWinKeys]);
  const teardownCardWinsRef = useRef(teardownCardWins);
  teardownCardWinsRef.current = teardownCardWins;

  // ── 창→앱 커맨드 실행 ─────────────────────────────────────────────────────
  // ⚠️ allow-list(default deny). 모르는 op는 조용히 무시하지 말고 사유를 ack에 실어, 창이
  //    인라인으로 알릴 수 있게 한다(무음 실패 = '버튼이 고장난 것처럼 보임').
  // ⚠️ **모든 by-id 쓰기는 `pid === entry.pid`를 재확인한다** — 창이 자기 계좌 외에는 절대 쓰지
  //    못하게 하는 fail-closed 방어선이다(창은 URL 파라미터로 열리므로 조작 가능하다).
  const runCardCmdRef = useRef(null);
  runCardCmdRef.current = (entry, op, args) => {
    const a = args || {};
    const pidOk = (pid) => pid === entry.pid;
    if (op === 'dividendCall') {
      const fn = a.fn;
      const list = a.args || [];
      const byId = {
        updatePortfolioDividendHistory, updatePortfolioActualDividend, updatePortfolioActualDividendUsd,
        updatePortfolioActualDividendQty, updatePortfolioDividendTaxRate, updatePortfolioDividendSeparateTax,
        updatePortfolioDividendTaxAmount, updatePortfolioActualAfterTaxUsd, updatePortfolioActualAfterTaxKrw,
        addPortfolioExtraRow, updatePortfolioExtraRowCode, deletePortfolioExtraRow, updatePortfolioExtraRowMonth,
        updateTaxBaseEvents, updateTaxBasePurchases, updateTaxBaseSales, updateTaxBaseExPrice, updateTaxBaseAvgPrice, updateTaxBaseAvgAdj,
        toggleHiddenTaxMonth, toggleHiddenDividendMonth, deletePortfolioDividendData, deletePortfolioTaxData,
      };
      if (fn === 'setDividendLinks') {   // 앱 레벨 값(계좌 아님) — pid 검사 대상이 아니다
        if (!Array.isArray(list[0])) return { ok: false, reason: '링크 형식이 올바르지 않습니다.' };
        setDividendLinks(list[0]);
        return { ok: true };
      }
      const f = byId[fn];
      if (typeof f !== 'function') return { ok: false, reason: `지원하지 않는 동작입니다 (${fn}).` };
      if (!pidOk(list[0])) return { ok: false, reason: '이 창은 다른 계좌를 수정할 수 없습니다.' };
      f(...list);
      return { ok: true };
    }
    // ── 계좌 필드 / 항목 / settings ──────────────────────────────────────────
    if (!pidOk(a.pid)) return { ok: false, reason: '이 창은 다른 계좌를 수정할 수 없습니다.' };
    switch (op) {
      case 'updateItem':
        handleUpdateFor(a.pid, a.id, a.field, a.value);
        return { ok: true };
      case 'patchItems':
        applyItemPatchesFor(a.pid, a.patches);
        return { ok: true };
      case 'cardWrite': {
        // ⚠️ 항목 patch + settings + 계좌 필드를 **한 번의 setPortfolios**로 적용한다
        //    (미러 반쪽 적용 · 원장만 지워지고 원금은 그대로인 중간 상태 방지).
        // ⚠️ expect가 오면 낙관적 동시성 검사 — 창이 자기 스냅샷으로 계산한 절대값(원금 프로라타
        //    보정 등)이 그 사이 앱 탭이 만든 이관·입금을 덮는 것을 막는다. 다르면 **배치 전체 거부**.
        const exp = a.ops && a.ops.expect;
        if (exp && Object.prototype.hasOwnProperty.call(exp, 'principal')) {
          const cur = (portfoliosRef.current || []).find(x => x && x.id === a.pid);
          if (cur && cleanNum(cur.principal) !== cleanNum(exp.principal)) {
            return { ok: false, reason: '앱 창에서 원금이 바뀌어 반영하지 않았습니다. 화면이 갱신된 뒤 다시 시도하세요.' };
          }
        }
        applyCardWriteFor(a.pid, a.ops);
        return { ok: true };
      }
      case 'patchSettings':
        // ⚠️ 통째 교체가 아니라 **필드 병합**이다 — 창의 settings 스냅샷이 낡은 만큼 형제 계좌·앱
        //    탭의 최신 설정을 되감는 것을 막는다(settings는 같은 accountType 전 계좌 공유).
        patchSettingsForTypeOf(a.pid, a.fields);
        return { ok: true };
      case 'toggleColumn':
        if (a.table === 'rebalancing') toggleHiddenColumnRebalancingFor(a.pid, a.key);
        else toggleHiddenColumnPortfolioFor(a.pid, a.key);
        return { ok: true };
      case 'toggleMarkedRow':
        if (a.table === 'rebalancing') toggleMarkedRebalRowFor(a.pid, a.itemId);
        else toggleMarkedPortfolioRowFor(a.pid, a.itemId);
        return { ok: true };
      case 'resetMarkedRows':
        if (a.table === 'rebalancing') resetAllMarkedRebalRowsFor(a.pid);
        else resetAllMarkedPortfolioRowsFor(a.pid);
        return { ok: true };
      case 'updateInvestmentNotes': {
        if (!Array.isArray(a.notes)) return { ok: false, reason: '투자 기록 형식이 올바르지 않습니다.' };
        // ⚠️ 통째 교체 + 앱 탭 메모 달력이 같은 배열을 동시에 편집 → base 지문 검사(INV-4).
        //    불일치면 거부하고 창은 사유를 인라인으로 알린다(조용한 덮어쓰기 금지).
        if (a.base !== undefined) {
          const cur = (portfoliosRef.current || []).find(x => x && x.id === a.pid);
          if (baseKeyOf(cur?.investmentNotes || []) !== a.base) {
            return { ok: false, reason: '앱 창(또는 메모 달력)에서 투자 기록이 먼저 바뀌었습니다. 화면이 갱신된 뒤 다시 시도하세요.' };
          }
        }
        updateInvestmentNotesFor(a.pid, a.notes);
        return { ok: true };
      }
      case 'refreshPrice':
        // by-pid — 시장 라우팅·stockHistoryMap 스탬프 날짜를 그 계좌 타입으로 해석한다.
        handleSingleStockRefreshFor(a.pid, a.id, a.code);
        return { ok: true };
      case 'adminTargetChange':
        // 관리자 접속 중에만 실제 발송(앱 탭의 세션당 1회 래치를 그대로 탄다).
        if (adminViewingAs) notifyUserOfAdminTargetChange();
        return { ok: true };
      case 'verifyPin':
        // ⚠️ 창의 sessionStorage는 **열린 시점 사본**이라 앱 탭에서 PIN을 바꾸면 낡는다 →
        //    검증은 언제나 앱 탭에서 한다. 성공하면 이 탭의 세션 인증도 함께 열어 준다.
        if (!authUser?.email) return { ok: false, reason: '로그인 정보가 없습니다.' };
        if (verifyPin(String(a.pin || ''), authUser.email)) { setTargetEditAuthorized(true); return { ok: true, result: true }; }
        return { ok: true, result: false };
      case 'saveTargetSnapshot': {
        // ⚠️ 창이 **자기 화면 값으로 만든 엔트리**를 그대로 받는다 — 앱 탭이 활성 계좌 스코프로
        //    다시 빌드하면 그 순간 '기록 = 화면 표 1:1'이 깨지고, 앱 탭이 다른 계좌를 보고 있으면
        //    그 계좌의 기존 기록을 거짓 내용으로 교체한다(calendarMemos는 sticky라 복구 불가).
        const built = a.built;
        if (!built || !built.dayKey || !built.entry) return { ok: false, reason: '기록할 내용이 없습니다.' };
        if (built.entry.portfolioId !== a.pid) return { ok: false, reason: '계좌가 일치하지 않습니다.' };
        if (built.entry.kind !== 'rebalTarget') return { ok: false, reason: '기록 형식이 올바르지 않습니다.' };
        if (!isValidIsoDate(built.dayKey)) return { ok: false, reason: '날짜가 올바르지 않습니다.' };
        const next = upsertRebalTargetMemo(calendarMemosRef.current, built.dayKey, built.entry, generateId(), Date.now());
        if (!next) return { ok: true, result: 'nochange' };
        calendarMemosRef.current = next;
        setCalendarMemos(next);
        return { ok: true, result: 'saved' };
      }
      default:
        return { ok: false, reason: `지원하지 않는 동작입니다 (${op}).` };
    }
  };

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;   // ⚠️ 필수 — 교차 출처 메시지는 전부 무시
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith('card:')) return;
      if (d.type === 'card:ping') {
        if (!d.winId || !isCardKey(d.card) || !d.pid) return;
        const cur = cardWinsRef.current.get(d.winId);
        // `d.need`(창이 아직 데이터 없음)가 초기 전송의 유일한 트리거다. 앱 탭이 새로고침되면
        // 레지스트리가 비므로 살아 있는 창의 핑에서 **재입양**한다.
        if (d.need || !cur || cur.win !== e.source) {
          cardWinsRef.current.set(d.winId, { id: d.winId, card: d.card, pid: d.pid, win: e.source });
          syncCardWinKeys();
          setCardWinNonce(n => n + 1);
        }
        try { e.source?.postMessage({ type: 'card:pong', winId: d.winId }, window.location.origin); } catch {}
        return;
      }
      // ── 여기부터는 입양된 창만 ──
      const entry = d.winId ? cardWinsRef.current.get(d.winId) : null;
      if (!entry || entry.win !== e.source) return;
      if (d.type === 'card:activity') {
        // ⚠️ resetActivity만으로는 부족하다 — 비활동 **경고가 이미 뜬 뒤에는** 체크 루프가
        //    lastActivityAt을 아예 보지 않아(useDriveSync) 60초 뒤 무조건 로그아웃한다.
        //    그 모달은 카드 창 뒤 앱 탭에 있어 보이지도 않는다.
        if (showInactivityWarning) handleInactivityContinue(); else resetActivity();
        return;
      }
      if (d.type === 'card:cmd') {
        let res;
        try { res = runCardCmdRef.current(entry, d.op, d.args); }
        catch (err) { res = { ok: false, reason: '앱 창에서 처리 중 오류가 발생했습니다.' }; }
        try {
          e.source?.postMessage({ type: 'card:ack', winId: d.winId, reqId: d.reqId, ...(res || { ok: false, reason: '알 수 없는 오류' }) }, window.location.origin);
        } catch {}
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [syncCardWinKeys, showInactivityWarning, handleInactivityContinue, resetActivity]);

  // ⚠️ 클릭 제스처 직후 **동기** window.open이라야 팝업 차단을 피한다.
  // ⚠️ noopener 금지 — opener 브릿지가 이 기능의 전부다(impersonation 탭과 정반대 규칙).
  // ⚠️ 같은 (계좌, 카드)를 다시 누르면 새 창을 열지 않고 기존 창을 포커스한다(window name 재사용).
  const openCardWindow = useCallback((card, pid) => {
    if (!isCardWindowSupported(card) || !pid) return;
    const winId = `${card}:${pid}`;
    const existing = cardWinsRef.current.get(winId);
    if (existing?.win && !existing.win.closed) { try { existing.win.focus(); } catch {} return; }
    const sw = (window.screen && window.screen.availWidth) || 1440;
    const sh = (window.screen && window.screen.availHeight) || 900;
    const w = window.open(cardWindowUrl(pid, card), cardWindowName(pid, card), `width=${sw},height=${sh},left=0,top=0`);
    if (!w) { setCardWinBlocked(true); return; }
    setCardWinBlocked(false);
    cardWinsRef.current.set(winId, { id: winId, card, pid, win: w });
    syncCardWinKeys();
    setCardWinNonce(n => n + 1);
  }, [syncCardWinKeys]);

  // ── 백테스트 데이터 · 조회 · '별도 브라우저 창' 브릿지 (`/?backtestWindow=1`) ─────────────
  // 흐름도/메모 달력 창과 **완전히 같은 규약**: 새 창은 App을 부팅하지 않고 postMessage로만
  // 대화하며, 저장은 전부 이 탭을 경유해 기존 STATE 저장 경로로 흐른다 → writer는 이 탭 하나.
  const btWinRef = useRef(null);
  const [btWinNonce, setBtWinNonce] = useState(0);   // ready/재입양 시 전체 재전송 트리거
  const [btWinBlocked, setBtWinBlocked] = useState(false);
  // ── 가계부 별도 창 ──
  // ⚠️ 가계부는 포트폴리오 데이터가 전혀 필요 없는 자체 완결 기능이라 **채널이 하나뿐**이다
  //    (`ledger:live`). 무거운 원자재 채널(`ledger:data`)을 따로 두면 두 채널이 각각
  //    `markGotData`를 세우게 되고, 장부가 도착하기 전에 쓰기가 열려 저장된 장부 전체가
  //    빈 배열로 덮이는 경로가 생긴다(CalendarWindow가 실제로 그 함정을 겪었다).
  const ledgerWinRef = useRef(null);
  const [ledgerWinNonce, setLedgerWinNonce] = useState(0);   // ready/재입양 시 전체 재전송 트리거
  const [ledgerWinBlocked, setLedgerWinBlocked] = useState(false);
  // ⚠️ 아래 세 memo는 **백테스트를 실제로 연 뒤에만** 계산한다. deps에 portfolios·stockHistoryMap이
  //    있어 시세 갱신(수십 초 간격)마다 전 계좌 스냅샷과 전 종목 일봉을 훑는데, 백테스트를 쓰지
  //    않는 사용자가 그 비용을 치를 이유가 없다(FlowBoard를 flowAccess 안에 둔 것과 같은 근거).
  const btActive = showBacktestPage || btWinNonce > 0;
  // ⚠️ `marketHolidays?.kr || []` 를 prop으로 **직접** 넘기지 말 것 — 매 렌더 새 배열이라
  //    BacktestPage의 결과 useMemo 의존성이 매번 깨져, 시세가 갱신될 때마다(수십 초) 백테스트
  //    전 구간이 재계산된다.
  const btHolidays = useMemo(() => marketHolidays?.kr || [], [marketHolidays]);
  // ⚠️ 조회분과 계좌분을 **합친다** — 계좌에 없는 종목(백테스트에서 처음 넣은 코드)은
  //    collectDividendHistory가 아무것도 주지 않아 과거엔 분배금이 통째로 0이었다.
  //    ym 단위 병합에서 조회분이 우선(btPrices와 같은 규약 — 사용자가 ⟳로 새로 받은 값이
  //    낡은 계좌 저장값에 가려지면 고친 줄 모른다).
  const btDividends = useMemo(() => {
    if (!btActive) return {};
    const base = collectDividendHistory(portfolios);
    const out: Record<string, Record<string, number>> = { ...base };
    for (const [c, m] of Object.entries(btFetchedDivs)) {
      if (m && Object.keys(m).length) out[c] = { ...(base[c] || {}), ...m };
    }
    return out;
  }, [btActive, portfolios, btFetchedDivs]);
  // ⚠️ 이름은 반대로 **계좌분이 우선** — 사용자가 포트폴리오 테이블에서 손으로 고친 종목명을
  //    API 이름이 덮으면 안 된다. 조회분은 계좌에 없는 코드의 빈칸만 채운다.
  const btNameByCode = useMemo(
    () => (btActive ? { ...btFetchedNames, ...collectNameByCode(portfolios) } : {}),
    [btActive, portfolios, btFetchedNames],
  );
  // ⚠️ 카탈로그의 코드 집합은 `종가 맵 ∪ 분배금 맵`이다(buildBtCatalog). 저장분(stockHistoryMap)만
  //    넘기면 **백테스트에서 처음 입력한 코드가 카탈로그에 아예 없어** 조회해 둔 종목명이 화면에
  //    닿지 못한다 → 조회분(btFetched)도 합치고, 종가 조회가 실패해 이름만 확보된 코드는 빈 맵으로
  //    자리를 만들어 둔다.
  const btCatalogPrices = useMemo(() => {
    if (!btActive) return {};
    const out: Record<string, Record<string, number>> = { ...stockHistoryMap };
    for (const [c, m] of Object.entries(btFetched)) out[c] = { ...(out[c] || {}), ...m };
    for (const c of Object.keys(btFetchedNames)) if (!out[c]) out[c] = {};
    return out;
  }, [btActive, stockHistoryMap, btFetched, btFetchedNames]);
  const btCatalog = useMemo(
    () => (btActive ? buildBtCatalog(btCatalogPrices, btNameByCode, btDividends) : []),
    [btActive, btCatalogPrices, btNameByCode, btDividends],
  );
  // 시나리오가 실제로 참조하는 코드만 추린다 — stockHistoryMap 전량을 새 창에 보내면
  // 수십 초마다 수 MB가 복제된다(flowWinAccountsKey와 동일한 지문 게이팅 이유).
  // ⚠️ btRequested를 합집합에 반드시 포함할 것 — BacktestPage는 편집을 로컬 사본에 모으고
  //    2.5초 idle에만 승격하므로, 방금 추가한 종목의 코드는 그때까지 backtestScenarios에 없다.
  //    이 합집합이 없으면 "종목을 추가했는데 이미 저장된 종가조차 몇 초간 안 뜬다".
  const [btRequested, setBtRequested] = useState<string[]>([]);
  const btCodes = useMemo(() => {
    const s = new Set<string>(btRequested);
    for (const sc of backtestScenarios || []) {
      for (const a of (sc?.assets || [])) if (a?.code) s.add(a.code);
    }
    return Array.from(s).sort();
  }, [backtestScenarios, btRequested]);
  // ⚠️ 조회분(btFetched)이 저장분(stockHistoryMap)보다 **우선**한다 — 사용자가 "종가 다시 조회"나
  //    붙여넣기로 명시적으로 넣은 값이 낡은 저장값에 가려지면 고친 줄 모른다.
  const btPrices = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const c of btCodes) {
      const merged = { ...(stockHistoryMap[c] || {}), ...(btFetched[c] || {}) };
      if (Object.keys(merged).length) out[c] = merged;
    }
    return out;
  }, [btCodes, stockHistoryMap, btFetched]);

  const btFetchingRef = useRef<string[]>([]);
  btFetchingRef.current = btFetching;
  const btStateRef = useRef<any>({});
  btStateRef.current = { stockHistoryMap, btFetched, btNameByCode, btDividends };
  // 이번 세션에 이미 시도한 코드. 무배당 종목은 조회가 성공해도 결과가 비어 있어 '아직 없음'과
  // 구분되지 않으므로, 시도 자체를 기억해 매 호출마다 같은 API를 다시 치는 것을 막는다.
  // (⟳ 강제 조회는 이 집합을 무시한다.)
  const btMetaTriedRef = useRef<{ names: Set<string>; divs: Set<string> }>({ names: new Set(), divs: new Set() });
  /**
   * 종목 **종가 + 종목명 + 분배 이력** 조회(또는 종가 붙여넣기 주입).
   *
   * ⚠️ 결과는 절대 stockHistoryMap / 계좌 dividendHistory에 병합하지 않는다(평가액 재계산 권위
   *    소스 오염 금지 · 보유하지 않은 종목이 계좌 분배금 데이터에 섞이는 것 금지).
   * ⚠️ 세 갈래를 **각각** 필요 여부로 판정한다 — 옛 코드는 '종가가 이미 있으면' 통째로 조기
   *    반환해, 저장된 종가만 있고 이름·분배금이 없는 코드는 영영 채워지지 않았다.
   * @param force true면 이미 데이터가 있어도 다시 조회(표의 ⟳ 버튼). 종목 추가 시에는 false —
   *        저장된 데이터가 이미 있는데 매번 네트워크를 치면 코드 하나 넣을 때마다 수 초씩 걸린다.
   */
  const handleBacktestFetch = useCallback(async (code: string, pasted?: Record<string, number>, force?: boolean) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return;
    // 요청된 코드는 즉시 등록 — 승격(2.5초) 전에도 btPrices에 실려 화면에 뜬다.
    setBtRequested(prev => (prev.includes(c) ? prev : [...prev, c]));
    if (pasted && typeof pasted === 'object') {
      setBtFetched(prev => ({ ...prev, [c]: { ...(prev[c] || {}), ...pasted } }));
      return;
    }
    if (btFetchingRef.current.includes(c)) return;
    const { stockHistoryMap: shm, btFetched: bf, btNameByCode: nm, btDividends: dv } = btStateRef.current;
    const havePrices = Object.keys(shm?.[c] || {}).length + Object.keys(bf?.[c] || {}).length;
    // 이름은 '코드와 다른 값'일 때만 해결된 것으로 본다(buildBtCatalog가 미해결이면 코드를 넣는다).
    const resolvedName = nm?.[c];
    const tried = btMetaTriedRef.current;
    const needPrices = !!force || havePrices < 2;
    const needName = !!force || (!tried.names.has(c) && (!resolvedName || String(resolvedName).toUpperCase() === c));
    const needDivs = !!force || (!tried.divs.has(c) && (!dv?.[c] || Object.keys(dv[c]).length === 0));
    if (!needPrices && !needName && !needDivs) return;
    if (needName) tried.names.add(c);
    if (needDivs) tried.divs.add(c);
    setBtFetching(prev => (prev.includes(c) ? prev : [...prev, c]));
    try {
      // 실패는 화면 배지('종가 데이터 없음')·이름 미해결로만 알린다 — 시세 계층은 벨에 남기지 않는다.
      await Promise.all([
        needPrices
          ? fetchBacktestSeries(c).then(d => { if (d) setBtFetched(prev => ({ ...prev, [c]: { ...(prev[c] || {}), ...d } })); }).catch(() => {})
          : Promise.resolve(),
        needName
          ? fetchBacktestName(c).then(n => { if (n) { setBtFetchedNames(prev => ({ ...prev, [c]: n })); setBtMetaSeq(s => s + 1); } }).catch(() => {})
          : Promise.resolve(),
        needDivs
          ? fetchBacktestDividends(c).then(m => { if (m) { setBtFetchedDivs(prev => ({ ...prev, [c]: { ...(prev[c] || {}), ...m } })); setBtMetaSeq(s => s + 1); } }).catch(() => {})
          : Promise.resolve(),
      ]);
    } finally {
      setBtFetching(prev => prev.filter(x => x !== c));
    }
  }, []);

  const postToBtWin = (msg) => {
    const w = btWinRef.current;
    if (!w || w.closed) return;
    try { w.postMessage(msg, window.location.origin); } catch {}
  };
  // 무거운 페이로드(카탈로그·분배금·휴장일)는 지문으로 게이팅. 새 창이 붙기 전(nonce 0)엔 계산 자체를 건너뛴다.
  // ⚠️ btMetaSeq를 반드시 포함할 것 — 이름/분배금은 **코드 수가 그대로여도 내용만** 바뀔 수 있어
  //    (강제 재조회, 미해결 이름의 뒤늦은 해석) 개수 기반 지문만으로는 새 창이 갱신을 놓친다.
  const btWinDataKey = useMemo(
    () => (btWinNonce === 0 ? '' : `${btCatalog.length}|${Object.keys(btDividends).length}|${btHolidays.length}|${btMetaSeq}`),
    [btWinNonce, btCatalog, btDividends, btHolidays, btMetaSeq],
  );
  useEffect(() => {
    if (btWinNonce === 0) return;
    postToBtWin({ type: 'backtest:data', catalog: btCatalog, dividends: btDividends, holidays: btHolidays });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btWinDataKey, btWinNonce]);
  useEffect(() => {
    if (btWinNonce === 0) return;
    postToBtWin({ type: 'backtest:live', scenarios: backtestScenarios, prices: btPrices, fetchingCodes: btFetching });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backtestScenarios, btPrices, btFetching, btWinNonce]);

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;   // ⚠️ 필수 — 교차 출처 메시지는 전부 무시
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith('backtest:')) return;
      if (d.type === 'backtest:ping') {
        // `d.need`가 초기 전송의 유일한 트리거(window.open 직후 보내면 about:blank라 버려진다).
        // 이 탭이 새로고침되면 btWinRef가 비므로 살아 있는 창의 핑에서 **재입양**한다.
        if (d.need || btWinRef.current !== e.source) { btWinRef.current = e.source; setBtWinNonce(n => n + 1); }
        try { e.source?.postMessage({ type: 'backtest:pong' }, window.location.origin); } catch {}
        return;
      }
      if (!btWinRef.current || e.source !== btWinRef.current) return;   // 쓰기는 입양된 창만
      if (d.type === 'backtest:scenarios') {
        if (!Array.isArray(d.scenarios)) return;
        setBacktestScenarios(normalizeBacktestScenarios(d.scenarios));
      } else if (d.type === 'backtest:want') {
        if (typeof d.code !== 'string') return;
        handleBacktestFetch(d.code, d.data || undefined, !!d.force);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [handleBacktestFetch]);

  // ── 가계부 브릿지 ──
  const postToLedgerWin = (msg) => {
    const w = ledgerWinRef.current;
    if (!w || w.closed) return;
    try { w.postMessage(msg, window.location.origin); } catch {}
  };
  // ⚠️ 단일 채널. 장부는 사용자 입력만 담긴 가벼운 데이터라 지문 게이팅이 필요 없다
  //    (portfolios처럼 시세 갱신마다 새 배열이 되지 않는다).
  // ⚠️ `today`는 앱이 만들어 보낸다 — 창 안에서 new Date()로 만들면 KST 규약이 갈린다.
  useEffect(() => {
    if (ledgerWinNonce === 0) return;
    /**
     * ⚠️ **`dataState`를 반드시 함께 보낼 것**(2026-08-30 유실 경로 차단).
     * 인앱은 `ledgerDataState !== 'ready'`면 읽기 전용인데(아래 `<LedgerPage readOnly=…>`),
     * **정작 버튼이 여는 별도 창에는 그 잠금이 없었다.** 창의 `writable`은 첫 `ledger:live`가
     * 오면 서는 `gotData`만 봐서, Drive 로드 전 `books: []`가 실려 온 메시지에도 쓰기가 열렸다.
     * 그러면 창은 '아직 안 불러왔다'와 '저장된 게 없다'를 구분하지 못한 채 **편집 가능한 빈
     * 장부**를 띄우고, 거기서 한 글자만 쳐도 2.5초 뒤 승격이 그 빈 장부를 App으로 보내
     * **저장돼 있던 장부를 덮는다**. 스냅샷은 💾 버튼으로만 쓰이므로 그대로 살아남아,
     * "장부는 비었는데 이전 기록은 있다"는 증상이 된다(사용자 보고).
     * ⚠️ deps에 `ledgerDataState` 필수 — 없으면 로드가 끝나도 창이 잠긴 채 남는다.
     */
    postToLedgerWin({ type: 'ledger:live', books: ledgerBooks, snapshots: ledgerSnapshots, hideAmounts, today: getTodayKST(), readOnly: !!adminViewingAs, dataState: ledgerDataState });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerBooks, ledgerSnapshots, hideAmounts, adminViewingAs, ledgerDataState, ledgerWinNonce]);

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;   // ⚠️ 필수 — 교차 출처 메시지는 전부 무시
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith('ledger:')) return;
      if (d.type === 'ledger:ping') {
        // `d.need`가 초기 전송의 유일한 트리거(window.open 직후 보내면 about:blank라 버려진다).
        // 이 탭이 새로고침되면 ledgerWinRef가 비므로 살아 있는 창의 핑에서 **재입양**한다.
        if (d.need || ledgerWinRef.current !== e.source) { ledgerWinRef.current = e.source; setLedgerWinNonce(n => n + 1); }
        try { e.source?.postMessage({ type: 'ledger:pong' }, window.location.origin); } catch {}
        return;
      }
      if (!ledgerWinRef.current || e.source !== ledgerWinRef.current) return;   // 쓰기는 입양된 창만
      if (d.type === 'ledger:books') {
        // ⚠️ impersonation 읽기 전용은 **여기서도** 막아야 한다 — 인앱 폴백의 readOnly prop만으로는
        //    기본 경로인 별도 창의 쓰기를 못 막는다. 창은 조작 가능한 URL로 열리므로 App 측
        //    재확인이 정본이다(fail-closed).
        if (adminViewingAsRef.current) return;
        if (!Array.isArray(d.books)) return;
        // ⚠️ 창이 보낸 것을 그대로 채택하지 말 것 — 반드시 정규화한다.
        setLedgerBooks(normalizeLedgerBooks(d.books));
      }
      if (d.type === 'ledger:snapshots') {
        // ⚠️ 쓰기 게이트는 `ledger:books`와 **똑같이 fail-closed** — 한쪽만 막으면
        //    impersonation 창이 스냅샷 이력을 고칠 수 있다.
        if (adminViewingAsRef.current) return;
        if (!Array.isArray(d.snapshots)) return;
        setLedgerSnapshots(normalizeLedgerSnapshots(d.snapshots));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ⚠️ 클릭 제스처 직후 **동기** window.open이라야 팝업 차단을 피한다.
  // ⚠️ noopener 금지 — opener 브릿지가 이 기능의 전부다(impersonation 탭과 정반대 규칙).
  // ⚠️ **features(3번째 인자)를 넣지 말 것** — width/height를 주면 크롬이 이 창을 '팝업'으로 열어
  //    주소창·즐겨찾기 막대·확장프로그램 아이콘이 통째로 사라진다(브라우저 확장을 이 화면에서
  //    쓸 수 없게 된다). features를 생략하면 **일반 탭**으로 열리고 opener 브릿지는 그대로다.
  //    ⚠️ 이름('ass-backtest')은 유지 — 같은 탭 재사용이 중복 열기를 막는 유일한 장치다.
  const openBacktestWindow = () => {
    const existing = btWinRef.current;
    if (existing && !existing.closed) { try { existing.focus(); } catch {} setShowBacktestPage(false); return; }
    const w = window.open('/?backtestWindow=1', 'ass-backtest');
    if (!w) {
      // 팝업 차단 → 인앱 페이지로 폴백(최악의 경우가 기존 동작이 되게 한다)
      setBtWinBlocked(true);
      setShowBacktestPage(true);
      return;
    }
    btWinRef.current = w;
    // 이름이 같은 탭이 이미 있으면 window.open이 그 탭을 **재사용**하는데, 브라우저가 항상
    // 앞으로 가져오지는 않는다(이 탭의 btWinRef가 새로고침으로 비어 위 early-return을 못 탄 경우).
    // → 버튼을 눌렀는데 아무 일도 안 일어난 것처럼 보이지 않게 여기서도 focus를 보강한다.
    try { w.focus(); } catch {}
    setBtWinBlocked(false);
    setShowBacktestPage(false);
  };

  // ── 가계부 별도 창 ──
  // ⚠️ `noopener` 금지 — opener 브릿지가 이 기능의 전부다(impersonation 탭과 **정반대** 규칙).
  // ⚠️ 클릭 제스처 직후 **동기** window.open이라야 팝업 차단을 피한다.
  // ⚠️ features(width/height) 인자를 주면 크롬이 '팝업'으로 열어 주소창·확장 아이콘이 통째로
  //    사라진다 → 백테스트와 같이 생략해 일반 탭으로 연다.
  const openLedgerWindow = () => {
    const existing = ledgerWinRef.current;
    if (existing && !existing.closed) { try { existing.focus(); } catch {} setShowLedgerPage(false); return; }
    const w = window.open('/?ledgerWindow=1', 'ass-ledger');
    if (!w) {
      // 팝업 차단 → 인앱 페이지로 폴백(최악의 경우가 기존 동작이 되게 한다)
      setLedgerWinBlocked(true);
      setShowLedgerPage(true);
      return;
    }
    ledgerWinRef.current = w;
    // 이름이 같은 탭이 이미 있으면 window.open이 그 탭을 재사용하는데 브라우저가 항상 앞으로
    // 가져오지는 않는다 → 버튼을 눌렀는데 아무 일도 안 일어난 것처럼 보이지 않게 focus를 보강한다.
    try { w.focus(); } catch {}
    setLedgerWinBlocked(false);
    setShowLedgerPage(false);
  };

  const handleSave = () => {
    const currentPortfolios = buildPortfoliosState();
    // 정식 전체 state 스냅샷(saveStateRef.current) 기반 — 부분 state를 손으로 재구성하면
    // calendarMemos·watchlistGroups·seenAdminNotifIds 등 신규 필드가 PC 백업·Drive STATE에서 유실됨
    // (handleDownloadStateFile·handleAppClose와 동일 패턴).
    // 리밸런싱 목표비중 기록을 먼저 커밋해 이 저장본에 포함(setCalendarMemos는 비동기라 saveStateRef가
    // 아직 옛 값 → 명시 주입 필요). ⚠️ 기록이 실제 생겼을 때만 portfolioUpdatedAt을 올려야
    // useDriveSync의 STATE 저장 가드(portfolioUpdatedAt > lastSaved)를 통과한다(historyVerifyKey 버그와 동류).
    const nextMemos = flushRebalTargetSnapshot();
    const nextFlow = flushFlowSnapshot(); // 흐름도 미승격 편집 커밋 → payload에 명시 주입
    const nextBt = flushBacktestSnapshot(); // 백테스트 미승격 편집 커밋 → payload에 명시 주입
    const nextLedger = flushLedgerSnapshot(); // 가계부 미승격 편집 커밋 → payload에 명시 주입
    const memoTs = Date.now();
    if (nextMemos || nextFlow || nextBt || nextLedger) {
      portfolioUpdatedAtRef.current = memoTs;
      lastDriveSavedPortfolioUpdatedAtRef.current = 0;
    }
    const state = { ...saveStateRef.current, ...(nextMemos ? { calendarMemos: nextMemos } : {}), ...(nextFlow ? { flowMaps: nextFlow } : {}), ...(nextBt ? { backtestScenarios: nextBt } : {}), ...(nextLedger ? { ledgerBooks: nextLedger } : {}), ...((nextMemos || nextFlow || nextBt || nextLedger) ? { portfolioUpdatedAt: memoTs } : {}), portfolios: currentPortfolios, chartPrefsUpdatedAt: chartPrefsUpdatedAtRef.current };
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

  // ── 관리자 앱 설정(app_settings.json) 공동 기록 — 4개 설정 저장 경로의 단일 진입점 ──
  // ⚠️ co-write 규약: 이 파일은 통째로 덮어써지므로 4값(youtubeUrl·notebookLinks·reportLinks·noticeFlags)을
  //    항상 함께 실어야 한다. 지점마다 손나열하면 하나가 빠져 그 필드가 빈 값으로 지워지므로 여기 한 곳에 모은다.
  // ⚠️ 401(토큰 만료) 무음 갱신 후 1회 재시도 — 과거엔 재시도가 없어 토큰이 만료된 관리자 세션에서
  //    저장·삭제가 전부 실패했다. 게다가 실패는 notify(벨 이력)로만 알렸는데 관리자 페이지는 App이
  //    <AdminPage/>만 early-return하는 전체화면이라 **벨·토스트가 아예 렌더되지 않는다** → 화면상
  //    '저장 실패'와 '아무 일도 안 일어남'이 완전히 동일했다(이번 버그의 근본 원인).
  //    그래서 실패 사유를 문자열로 반환해 호출부(AdminPage)가 카드 안에 인라인으로 띄운다.
  // 반환: 성공이면 null, 실패면 화면에 보여줄 오류 메시지
  const writeAppSettings = async (patch: Record<string, any>, isRetry = false): Promise<string | null> => {
    const token = driveTokenRef.current;
    if (!token) return 'Drive 인증이 필요합니다. 페이지를 새로고침해 다시 로그인하세요.';
    try {
      const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
      await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, {
        youtubeUrl,
        notebookLinks,
        reportLinks: reportLinksFromUrl(reportUrl),
        noticeFlags,
        settingsSchema: SETTINGS_SCHEMA,
        ...patch,
      });
      settingsWrittenRef.current = true;   // 늦게 도착한 로드가 방금 저장한 값을 되돌리지 못하게
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[설정] Drive 저장 실패:', msg);
      if (msg.includes('401') && !isRetry && tokenClientRef.current) {
        const newToken = await new Promise<string | null>(resolve => {
          pendingTokenResolveRef.current = resolve;
          tokenClientRef.current.requestAccessToken({ prompt: '' });
        });
        if (newToken) {
          driveTokenRef.current = newToken;
          setDriveToken(newToken);
          return writeAppSettings(patch, true);
        }
      }
      if (msg.includes('401')) return '로그인이 만료되었습니다. 페이지를 새로고침해 다시 로그인한 뒤 저장하세요.';
      if (msg.includes('403')) return 'Drive 권한 오류(403)로 저장하지 못했습니다. 다시 로그인해도 계속되면 관리자 계정 권한을 확인하세요.';
      return `Drive 저장 실패 — ${msg}`;
    }
  };

  // Apps Script 설정 시트 배포 — 일반 사용자에게 전달되는 유일한 경로.
  // ⚠️ Apps Script는 거부도 HTTP 200 + {success:false}로 답하므로 res.ok만 봐서는 실패를 놓친다.
  //    과거엔 fire-and-forget이라, 시트 기록이 실패하면 관리자 화면만 새 링크로 바뀌고 **모든 사용자는
  //    옛 링크에 무기한 묶였다**(어느 쪽에도 표시 없음). 이제 결과를 돌려 호출부가 경고를 띄운다.
  const deploySettingToSheet = async (key: string, value: string): Promise<boolean> => {
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'setSettings', key, value }),
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      return !data || data.success !== false;   // 본문 파싱 실패는 성공으로 간주(응답 형식 변화 대비)
    } catch { return false; }
  };

  const handleSetYoutubeUrl = async (url: string) => {
    // 관리자 Drive가 정본 — Apps Script 상태와 무관하게 즉시 반영
    const err = await writeAppSettings({ youtubeUrl: url });
    if (err) { notify(`YouTube 링크 저장 실패 — ${err}`, 'error'); return { ok: false, message: err }; }
    setYoutubeUrl(url);
    const deployed = await deploySettingToSheet('youtubeUrl', url);
    return { ok: true, warning: deployed ? undefined : SHEET_DEPLOY_WARN };
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
    // 관리자 Drive가 정본 — Apps Script 상태와 무관하게 즉시 반영
    const err = await writeAppSettings({ notebookLinks: links });
    if (err) { notify(`학습자료 링크 저장 실패 — ${err}`, 'error'); return { ok: false, message: err }; }
    setNotebookLinks(links);
    const deployed = await deploySettingToSheet('notebookLinks', JSON.stringify(links));
    return { ok: true, warning: deployed ? undefined : SHEET_DEPLOY_WARN };
  };

  // 시장동향 리포트 URL — 유튜브 채널 링크와 동일한 '단일 URL 바로가기'.
  // ⚠️ 저장 키는 기존 'reportLinks'를 재사용한다(Apps Script 화이트리스트 — 재배포 불필요). 상세는
  //    reportLinksFromUrl 주석 참조. 빈 문자열이면 빈 배열이 저장돼 사용자 아이콘이 비활성으로 떨어진다.
  const handleSetReportUrl = async (url: string) => {
    const links = reportLinksFromUrl(url);
    const next = reportUrlFromLinks(links);
    // 관리자 Drive가 정본 — Apps Script 상태와 무관하게 즉시 반영
    const err = await writeAppSettings({ reportLinks: links });
    if (err) { notify(`시장동향 리포트 링크 저장 실패 — ${err}`, 'error'); return { ok: false, message: err }; }
    setReportUrl(next);
    const deployed = await deploySettingToSheet('reportLinks', JSON.stringify(links));
    return { ok: true, warning: deployed ? undefined : SHEET_DEPLOY_WARN };
  };

  // 학습자료 등록 시 사용자 공지 발송 여부('공지 ON/OFF') — 관리자 Drive app_settings.json에만 저장.
  // 일반 사용자는 읽지 않는 관리자 전용 설정이라 Apps Script 배포는 하지 않는다
  // (setSettings는 키 화이트리스트가 있어 새 키를 받지도 않는다 — 시트/재배포 불필요).
  const handleSetNoticeFlags = async (flags: { notebook: boolean }) => {
    const err = await writeAppSettings({ noticeFlags: flags });
    if (err) { notify(`공지 설정 저장 실패 — ${err}`, 'error'); return { ok: false, message: err }; }
    setNoticeFlags(flags);
    return { ok: true };
  };

  // 관리자가 사용자의 목표 비중을 변경했을 때 호출 — 관리자 접속(impersonation) 세션당 알림 1건만 발송.
  // ⚠️ 회귀 주의: 과거엔 5초 디바운스만 있어, 여러 종목을 하나씩 고치면(편집 간격 > 5초) 그때마다
  // 1건씩 계속 발송됐다. adminTargetNotifSentRef가 발송 완료한 대상 이메일을 래치해 같은 세션에서는
  // 몇 종목·몇 번을 고쳐도 1건으로 끝난다. 래치 해제는 세션 시작 지점 2곳(handleLoginApproved,
  // authUser 변경 effect)에서만 — 여기서 풀면 '세션당 1회'가 깨진다.
  // 디바운스 5초는 유지: 연속 편집을 한 요청으로 모으고, 실수로 되돌린 변경까지는 알리지 않는다.
  const notifyUserOfAdminTargetChange = () => {
    const targetEmail = adminViewingAsRef.current;
    if (!targetEmail) return;
    if (adminTargetNotifSentRef.current === targetEmail) return; // 이번 세션에서 이미 발송함
    if (adminTargetNotifTimerRef.current) clearTimeout(adminTargetNotifTimerRef.current);
    adminTargetNotifTimerRef.current = setTimeout(() => {
      adminTargetNotifTimerRef.current = null;
      const finalEmail = adminViewingAsRef.current;
      if (!finalEmail) return;
      if (adminTargetNotifSentRef.current === finalEmail) return;
      adminTargetNotifSentRef.current = finalEmail; // 발송 직전에 래치 (중복 발송 방지)
      // ⚠️ 발송이 실패하면 래치를 되돌린다 — 세션당 1회는 '성공 1건'을 뜻한다. 낙관적으로 래치만 남기면
      // 일시 장애(네트워크 단절·5xx) 1회로 그 세션 공지가 영영 사라진다(변경 전엔 다음 편집이 재발송해
      // 자연 복구됐다). Apps Script는 거부도 200 + {success:false}로 답하므로 본문까지 본다.
      // 본문을 못 읽는 경우(파싱 실패)는 성공으로 간주 — 중복 발송보다 낫다.
      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'sendNotification',
          targetEmail: finalEmail,
          message: '목표 비중이 수정되었습니다.',
          type: 'warning',
        }),
      })
        .then(async res => {
          if (!res.ok) return false;
          const data = await res.json().catch(() => null);
          return !data || data.success !== false;
        })
        .catch(() => false)
        .then(ok => {
          // 늦게 온 응답이 다른 세션의 래치를 지우지 않도록 대상 일치 확인
          if (!ok && adminTargetNotifSentRef.current === finalEmail) adminTargetNotifSentRef.current = null;
        });
    }, 5000);
  };

  const handleDriveSave = () => {
    const currentPortfolios = buildPortfoliosState();
    const nextMemos = flushRebalTargetSnapshot(); // 목표비중 기록 커밋 → 아래 payload에 명시 주입
    const nextFlow = flushFlowSnapshot();         // 흐름도 미승격 편집 커밋 → 아래 payload에 명시 주입
    const nextBt = flushBacktestSnapshot();       // 백테스트 미승격 편집 커밋 → 아래 payload에 명시 주입
    const nextLedger = flushLedgerSnapshot();     // 가계부 미승격 편집 커밋 → 아래 payload에 명시 주입
    // portfolioUpdatedAt이 없으면 saveAllToDrive의 guard(0 > 0)가 항상 false → STATE 저장 안됨
    // 수동 저장은 항상 강제 저장되어야 하므로 새 타임스탬프 생성 후 guard 초기화
    const newUpdatedAt = Date.now();
    portfolioUpdatedAtRef.current = newUpdatedAt;
    lastDriveSavedPortfolioUpdatedAtRef.current = 0;
    // 정식 전체 state 스냅샷(saveStateRef.current) 기반 — 부분 state를 손으로 재구성하면
    // calendarMemos·watchlistGroups·seenAdminNotifIds 등 신규 필드가 Drive STATE·수동 백업에서
    // 유실된다(과거 '저장' 버튼이 메모 달력을 지우던 원인 — handleAppClose와 동일 패턴으로 보장).
    const state = { ...saveStateRef.current, ...(nextMemos ? { calendarMemos: nextMemos } : {}), ...(nextFlow ? { flowMaps: nextFlow } : {}), ...(nextBt ? { backtestScenarios: nextBt } : {}), ...(nextLedger ? { ledgerBooks: nextLedger } : {}), portfolios: currentPortfolios, portfolioUpdatedAt: newUpdatedAt, chartPrefsUpdatedAt: chartPrefsUpdatedAtRef.current };
    if (driveTokenRef.current) {
      saveAllToDrive(state, 'manual'); // 수동 저장 → 타임스탬프 백업 포함
    } else {
      notify('☁️ Drive 미연결 — 먼저 Drive를 연결해 주세요', 'warning');
    }
  };

  const handleDownloadStateFile = () => {
    const currentPortfolios = buildPortfoliosState();
    const nextMemos = flushRebalTargetSnapshot(); // 목표비중 기록 커밋 → 아래 payload에 명시 주입
    const nextFlow = flushFlowSnapshot();         // 흐름도 미승격 편집 커밋 → 아래 payload에 명시 주입
    const nextBt = flushBacktestSnapshot();       // 백테스트 미승격 편집 커밋 → 아래 payload에 명시 주입
    const nextLedger = flushLedgerSnapshot();     // 가계부 미승격 편집 커밋 → 아래 payload에 명시 주입
    const newUpdatedAt = Date.now();
    // 정식 전체 state 스냅샷(saveStateRef.current) 기반 — 부분 state를 손으로 재구성하면
    // calendarMemos·seenAdminNotifIds·intDashCompStocks 등 신규/추가 필드가 누락되어
    // PC 백업 파일에서 유실된다(handleAppClose와 동일 패턴으로 메인 저장 필드 보장).
    const state = { ...saveStateRef.current, ...(nextMemos ? { calendarMemos: nextMemos } : {}), ...(nextFlow ? { flowMaps: nextFlow } : {}), ...(nextBt ? { backtestScenarios: nextBt } : {}), ...(nextLedger ? { ledgerBooks: nextLedger } : {}), portfolios: currentPortfolios, portfolioUpdatedAt: newUpdatedAt };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    a.href = url;
    a.download = `portfolio_state_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAppClose = async () => {
    const currentPortfolios = buildPortfoliosState();
    const nextMemos = flushRebalTargetSnapshot(); // 목표비중 기록 커밋 → 아래 payload에 명시 주입
    const nextFlow = flushFlowSnapshot();         // 흐름도 미승격 편집 커밋 → 아래 payload에 명시 주입
    const nextBt = flushBacktestSnapshot();       // 백테스트 미승격 편집 커밋 → 아래 payload에 명시 주입
    const nextLedger = flushLedgerSnapshot();     // 가계부 미승격 편집 커밋 → 아래 payload에 명시 주입
    const newUpdatedAt = Date.now();
    // 정식 전체 state 스냅샷(saveStateRef.current) 기반 저장 — 부분 state를 손으로 재구성하면
    // chartPrefs.intDashCompStocks(통합 대시보드 비교종목)·seenAdminNotifIds 등이 누락되어
    // "앱 닫기"로 종료할 때마다 비교종목이 초기화되던 버그 방지 (메인 저장과 동일 필드 보장)
    const state = { ...saveStateRef.current, ...(nextMemos ? { calendarMemos: nextMemos } : {}), ...(nextFlow ? { flowMaps: nextFlow } : {}), ...(nextBt ? { backtestScenarios: nextBt } : {}), ...(nextLedger ? { ledgerBooks: nextLedger } : {}), portfolios: currentPortfolios, portfolioUpdatedAt: newUpdatedAt };
    const minWait = new Promise<void>(r => setTimeout(r, 2000));
    if (driveTokenRef.current) {
      const token = driveTokenRef.current;
      const { stockHistoryMap: _shm, marketIndices: _mi, marketIndicators: _mInd, indicatorHistoryMap: _ihm, ...stateCore } = state;
      const savePromise = (async () => {
        try {
          const folderId = await ensureDriveFolder(token);
          await saveDriveFile(token, folderId, DRIVE_FILES.STATE, stateCore);
          await saveVersionedBackup(token, folderId, stateCore, 'auto');
          lastAutoBackupAtRef.current = Date.now();   // 같은 날 탭 숨김이 auto 백업을 한 번 더 내지 않게
        } catch {}
      })();
      await Promise.all([minWait, savePromise]);
    } else {
      await minWait;
    }
    window.close();
  };

  const today = new Date().toISOString().split('T')[0];
  // 화면(HistoryPanel)과 같은 공용 함수·같은 평가액 소스·같은 날짜별 환율을 태운다
  // (흐름 보정만 이식하고 평가액 소스를 raw로 두면 보류 판정 자체가 갈린다).
  // ⚠️ 알려진 한계: activeCloseEvalByDate는 해외·현금성 계좌에서 빈 Map이라(:975) 그 계좌들은
  //    CSV가 저장 evalAmount로 폴백한다. 해외는 화면이 날짜별 환율로 재계산하므로 CSV와
  //    평가자산·일간 손익이 어긋난다(기존 동작 유지 — 해소하려면 해외 재계산을 App으로 승격해야 함).
  const handleDownloadCSV = () => downloadCSV(`ISA_자산추이_${today}.csv`, buildHistoryCSV(
    history, depositHistory, depositHistory2,
    activePortfolioAccountType === 'overseas'
      ? (d) => (getClosestValue(indicatorHistoryMap?.usdkrw, d.date) || d.fxRate || marketIndicators.usdkrw || 1)
      : undefined,
    activeCloseEvalByDate,
    activeBookByDate,
  ));
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
      const drivePortfolio = await loadFromDrive(token, true);
      if (drivePortfolio === null && syncStatusRef.current !== 'error') {
        // 완전 신규 사용자 (파일 없음, 오류 아님): 초기 포트폴리오 생성
        const newId = generateId();
        const today = new Date().toISOString().split('T')[0];
        const initP = { id: newId, name: '내 포트폴리오', startDate: today, portfolioStartDate: today, portfolio: [{ id: generateId(), type: 'deposit', depositAmount: 0 }], principal: 0, history: [], depositHistory: [], depositHistory2: [], settings: { mode: 'rebalance', amount: 1000000 } };
        setPortfolios([initP]);
        setActivePortfolioId(newId);
      }

      // ⚠️ STATE가 확정된 **바로 이 지점**에서 가계부 잠금을 푼다(뒤의 부수 로드들을 기다리지 않는다).
      //    '파일 없음'(신규 사용자)은 정당한 빈 장부라 ready, 로드 **실패**는 error로 잠근다 —
      //    Drive엔 기록이 있는데 못 읽은 상태에서 편집을 허용하면 다음 저장이 그 기록을 덮는다.
      setLedgerDataState(syncStatusRef.current === 'error' ? 'error' : 'ready');

      // ⚠️ 여기서 오버레이를 닫지 않는다(사용자 확정 2026-09) — 로딩 팝업이 '과거 종가 동기화'까지 담당하고,
      //    닫히는 순간 앱이 완전한 상태여야 한다. 해제는 아래 '정착(settled) 시 해제' effect 한 곳이 맡는다.
      //    (안전장치는 LoadingOverlay 자체의 5초 수동 버튼 + 20초 자동 해제 — 첫 세션처럼 이력이 긴 경우
      //     그 시점부터는 배경에서 계속 받고 사용자는 앱을 쓴다.)
      awaitingSettleRef.current = true;

      // 시장지표 수집 (백그라운드)
      fetchMarketIndicators();

      // 전체 계좌 현재가 일괄 갱신 — 아래 부수 로드 5건과 **병행**. ref 동기화 뒤에 쏘도록 effect에 위임한다
      // (bootRefreshSeq 선언부 주석 참조). 여기서 refreshPrices()를 직접 부르면 빈 계좌를 읽는다.
      const bootStarted = new Promise<{ run: Promise<void> } | null>(resolve => { bootRefreshResolveRef.current = resolve; });
      setBootRefreshSeq(s => s + 1);

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
      // 공지 ON/OFF는 Apps Script에 없는 Drive 전용 값 → 아래 마이그레이션 저장이 덮어쓰지 않도록
      // 로드값을 지역 변수로 들고 간다(setState는 이 클로저에 반영되지 않음).
      let loadedNoticeFlags = NOTICE_FLAGS_DEFAULT;
      // ⚠️ 읽기 성공 여부를 따로 추적한다. loadDriveFile은 '파일 없음'만 null이고 401/5xx/네트워크 오류는
      // throw → catch가 삼키면 loadedNoticeFlags가 기본 ON으로 남는데, 그 상태로 아래 마이그레이션 저장이
      // 돌면 관리자가 저장해 둔 '공지 OFF'가 사용자 행동 없이 ON으로 되살아난다(noticeFlags는 Apps Script
      // 사본이 없어 복구 불가). 파일이 없는 최초 마이그레이션은 readOk=true라 종전대로 저장된다.
      let settingsReadOk = false;
      try {
        const settingsFolderId = driveFolderIdRef.current || await ensureDriveFolder(token);
        const driveSettings = await loadDriveFile(token, settingsFolderId, DRIVE_FILES.SETTINGS) as any;
        settingsReadOk = true;
        if (driveSettings) {
          // ⚠️ 이 세션에서 관리자가 이미 설정을 저장했다면 반영을 건너뛴다 — 늦게 도착한 로드가
          //    방금 저장한 값을 저장 이전 값으로 되돌린다(로드 중 저장 시 재현).
          if (!settingsWrittenRef.current) {
            if (driveSettings.youtubeUrl) setYoutubeUrl(driveSettings.youtubeUrl);
            if (Array.isArray(driveSettings.notebookLinks)) setNotebookLinks(driveSettings.notebookLinks);
            if (Array.isArray(driveSettings.reportLinks)) setReportUrl(reportUrlFromLinks(driveSettings.reportLinks));
          }
          loadedNoticeFlags = normalizeNoticeFlags(driveSettings.noticeFlags);
          if (!settingsWrittenRef.current) setNoticeFlags(loadedNoticeFlags);
          // 정본 마커가 있으면 값이 전부 비어 있어도 Drive가 정본(= 관리자가 링크를 지운 상태).
          // 마커 없는 레거시 파일만 종전대로 "값이 비면 Apps Script 폴백 허용".
          driveSettingsFound = isAuthoritativeSettings(driveSettings)
            || !!(driveSettings.youtubeUrl || driveSettings.notebookLinks?.length > 0 || driveSettings.reportLinks?.length > 0);
        }
      } catch {}
      if (!settingsWrittenRef.current && (!isAdmin || !driveSettingsFound)) {
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
            const ru = reportUrlFromLinks(rl);
            setYoutubeUrl(yu);
            if (Array.isArray(nl)) setNotebookLinks(nl);
            if (Array.isArray(rl)) setReportUrl(ru);
            // 관리자: Drive에 저장 (이후 Drive가 정본으로 동작)
            // 일반 사용자: Drive에 캐시 저장
            // ⚠️ 읽기가 실패한 세션에서는 저장을 건너뛴다 — 파일 내용을 모르는 채로 전체 교체하면
            // 저장돼 있던 noticeFlags(공지 OFF)를 기본 ON으로 지운다. 링크·유튜브는 Apps Script
            // 시트가 정본이라 이번 회차를 걸러도 다음 로그인에서 그대로 복원된다.
            try {
              if (settingsReadOk) {
                const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
                // 리포트는 단일 URL로 정규화해 저장한다 — 레거시 다중 링크는 첫 URL만 승계(의도).
                // ⚠️ settingsSchema 마커 필수 — 이 마이그레이션이 곧 "이후 Drive가 정본" 선언이다.
                //    빠뜨리면 링크를 전부 지운 순간 다시 시트 폴백이 돌아 옛 링크가 되살아난다.
                await saveDriveFile(token, folderId, DRIVE_FILES.SETTINGS, { youtubeUrl: yu, notebookLinks: Array.isArray(nl) ? nl : [], reportLinks: reportLinksFromUrl(ru), noticeFlags: loadedNoticeFlags, settingsSchema: SETTINGS_SCHEMA });
              }
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
              notifTargetsUser(n.targetEmail, authUser.email, userFeatures.notebookEnabled)
            );
            const myNotifs = myAll.filter(n => !seenAdminNotifIdsRef.current.includes(n.id));
            if (myNotifs.length > 0) {
              setPendingAdminNotifs(myNotifs);
            }
          }
        } catch {}
      }

      // ⚠️ 옛 '총자산현황으로 이동'(강제 복귀)은 삭제 — showIntegratedDashboard 초기값이 true라 정상 부팅에선
      //    no-op이고, 오버레이를 닫고 이동한 사용자만 통합 대시보드로 되돌려 보내던 부작용뿐이었다.
      // 첫 시세 갱신 완료 대기 — effect가 제때 못 쐈으면(언마운트 등) 직접 쏜다(그때는 렌더가 이미 끝난 지 오래다).
      const started = await Promise.race([bootStarted, new Promise<null>(r => setTimeout(() => r(null), BOOT_REFRESH_START_TIMEOUT_MS))]);
      await (started ? started.run : refreshPrices());

      // 세션 초기화 (단일 세션 강제 적용)
      initSession();

      isInitialLoad.current = false;
      // 하루 1회 종료 백업의 기준 시각 시드(비차단) — Drive 목록의 최신 auto 백업 createdTime.
      seedLastAutoBackupAt();
      // ⚠️ 옛 STOCK 백그라운드 로드는 삭제 — STOCK은 loadFromDrive가 STATE와 함께 로드한다(STOCK-first).
    }, 400);

    return () => clearTimeout(bgTimer);
  }, [authUser, driveLoadReady]);

  // Admin Page 모드 전용 settings 로드
  // driveLoadReady=false 상태(포트폴리오 로드 없이 관리자 페이지 직접 진입)에서만 실행
  useEffect(() => {
    if (!showAdminPage || !authUser || driveLoadReady) return;
    const token = driveTokenRef.current;
    if (!token) return;
    // ⚠️ 이 경로는 메인 로드 effect(driveLoadReady 게이트)를 타지 않아 initTokenClient()가 한 번도
    //    호출되지 않았다 → tokenClientRef가 null이라 401 무음 갱신이 통째로 no-op이 되고, 액세스
    //    토큰(1시간) 만료 후 관리자 페이지의 **모든 설정 저장이 새로고침 전까지 영구 실패**했다.
    initTokenClient();
    (async () => {
      // 이 세션에서 이미 저장했으면 늦게 도착한 로드가 되돌리지 않게 통째로 건너뛴다(메인 로드와 동일 규칙).
      if (settingsWrittenRef.current) return;
      let found = false;
      try {
        const folderId = driveFolderIdRef.current || await ensureDriveFolder(token);
        const settings = await loadDriveFile(token, folderId, DRIVE_FILES.SETTINGS) as any;
        if (settingsWrittenRef.current) return;   // 로드 중 저장이 끼어들었으면 반영하지 않는다
        if (settings?.youtubeUrl) { setYoutubeUrl(settings.youtubeUrl); found = true; }
        if (Array.isArray(settings?.notebookLinks) && settings.notebookLinks.length > 0) {
          setNotebookLinks(settings.notebookLinks); found = true;
        }
        if (Array.isArray(settings?.reportLinks) && settings.reportLinks.length > 0) {
          setReportUrl(reportUrlFromLinks(settings.reportLinks)); found = true;
        }
        // 정본 마커가 있으면 값이 비어 있어도 폴백하지 않는다 — 폴백하면 방금 지운 링크가 시트에서 되살아난다.
        if (isAuthoritativeSettings(settings)) found = true;
        // 공지 ON/OFF는 Drive 전용 값 — 파일이 있으면 항상 반영(없으면 기본 ON).
        // found 판정에는 넣지 않는다: 마커 없는 레거시 파일에서 링크가 비면 Apps Script 폴백이 그대로 진행돼야 한다.
        if (settings) setNoticeFlags(normalizeNoticeFlags(settings.noticeFlags));
      } catch {}
      if (!found && !settingsWrittenRef.current) {
        try {
          const res = await fetch(`${APPS_SCRIPT_URL}?action=getSettings&cacheBust=${Date.now()}`);
          if (res.ok) {
            const d = await res.json();
            if (settingsWrittenRef.current) return;   // 폴백 응답이 늦게 와도 방금 저장한 값을 덮지 않는다
            if (d.youtubeUrl) setYoutubeUrl(d.youtubeUrl);
            if (d.notebookLinks) {
              if (Array.isArray(d.notebookLinks)) setNotebookLinks(d.notebookLinks);
              else { try { setNotebookLinks(JSON.parse(d.notebookLinks)); } catch {} }
            }
            if (d.reportLinks) {
              if (Array.isArray(d.reportLinks)) setReportUrl(reportUrlFromLinks(d.reportLinks));
              else { try { setReportUrl(reportUrlFromLinks(JSON.parse(d.reportLinks))); } catch {} }
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
          notifTargetsUser(n.targetEmail, authUser.email, userFeatures.notebookEnabled)
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
  }, [authUser, userFeatures.notebookEnabled]);

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
    // ⚠️ 가계부는 포트폴리오와 개념적 의존이 **0**이다 — 계좌를 아직 만들지 않은 사용자가
    //    정상 경로이고, 그 조기 반환을 그대로 두면 그 사용자의 장부는 어떤 경로로도 저장되지
    //    않아 새로고침마다 통째로 사라진다. 계좌가 없어도 장부에 내용이 있으면 저장을 돌린다.
    if (portfolios.length === 0 && !ledgerBooksHaveContent(ledgerBooks) && !ledgerSnapshotsHaveContent(ledgerSnapshots)) return;
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
        // ⚠️ 이 화이트리스트는 항목 필드를 **손나열**한다 — 사용자가 편집할 수 있는 필드를
        //    빠뜨리면 그 필드만 고친 세션은 portfolioUpdatedAt이 오르지 않아 STATE 저장이
        //    통째로 스킵된다(화면은 정상이라 조용한 세션에서만 재현되는 유실).
        //    category('구분' 셀)·assetClass(dc-irp D/S 배지)가 정확히 그렇게 빠져 있었다.
        //    ⚠️ 시세 갱신으로 변하는 값은 절대 넣지 말 것(시세마다 Drive 저장 폭주) —
        //    category/assetClass는 useStockData·useMarketData에 참조 0건임을 확인했다.
        //    ⚠️ savings 스프레드의 assetClass는 그대로 둘 것(값이 같아 무해하고, 옮기다 오타가
        //    나면 예적금 지문이 조용히 깨진다 — @ts-nocheck+esbuild라 컴파일러가 못 잡는다).
        //    ⚠️ investAmountUsd(해외 투자금액 사용자 입력)도 필수 — 수량 0인 행에서는 미러
        //    purchasePrice를 쓰지 않으므로 이 필드만 바뀌고, 빠지면 그 편집이 조용히 유실된다.
        portfolio: (p.portfolio || []).map(item => ({ id: item.id, type: item.type, code: item.code, name: item.name, quantity: item.quantity, investAmount: item.investAmount, investAmountUsd: item.investAmountUsd, purchasePrice: item.purchasePrice, depositAmount: item.depositAmount, targetRatio: item.targetRatio, targetRatioVar: item.targetRatioVar, targetRatioOverride: item.targetRatioOverride, targetRatioVarOverride: item.targetRatioVarOverride, targetAmount: item.targetAmount, targetAmountOverride: item.targetAmountOverride, targetRatioAcc: item.targetRatioAcc, targetRatioAccVar: item.targetRatioAccVar, targetRatioAccOverride: item.targetRatioAccOverride, targetRatioAccVarOverride: item.targetRatioAccVarOverride, category: item.category, assetClass: item.assetClass, ...(item.type === 'savings' ? { annualRate: item.annualRate, startDate: item.startDate, endDate: item.endDate, assetClass: item.assetClass, deposits: (item.deposits || []).map(d => `${d.date}:${d.amount}`).join(',') } : {}) })),
        principal: p.principal, avgExchangeRate: p.avgExchangeRate,
        depositHistory: p.depositHistory, depositHistory2: p.depositHistory2,
        settings: p.settings,
        actualDividend: p.actualDividend,
        dividendHistoryUpdatedAt: p.dividendHistoryUpdatedAt || 0,
        extraDividendRows: p.extraDividendRows,
        actualDividendUsd: p.actualDividendUsd,
        actualAfterTaxUsd: p.actualAfterTaxUsd,
        actualAfterTaxKrw: p.actualAfterTaxKrw,
        // ⚠️ actualDividendQty·dividendTaxAmounts 필수 — 두 라이터
        //    (updatePortfolioActualDividendQty·updatePortfolioDividendTaxAmount)는
        //    `dividendHistoryUpdatedAt`을 올리지 않으므로, 이 지문이 유일한 저장 트리거다.
        //    빠뜨리면 '월 입금 내역'의 보유수량이나 세금 금액만 고친 세션이 portfolioUpdatedAt
        //    미상승 → useDriveSync의 STATE 저장 가드에 막혀 조용히 유실된다
        //    (historyVerifyKey·investmentNotesKey·targetAmount와 동일 버그 클래스).
        //    둘 다 사용자 입력 전용 맵이라 시세 갱신으로는 변하지 않는다(저장 폭주 없음).
        actualDividendQty: p.actualDividendQty,
        dividendTaxAmounts: p.dividendTaxAmounts,
        dividendTaxRate: p.dividendTaxRate,
        dividendSeparateTax: p.dividendSeparateTax,
        lookupRows: p.lookupRows,
        memo: p.memo || '',
        // ⚠️ 본문(content)까지 지문에 포함해야 한다 — 과거엔 `id:date`만 담아 **본문만 고치면**
        // portfolioUpdatedAt이 안 올라 Drive STATE 저장이 스킵됐다(historyVerifyKey·calendarMemos와
        // 동일 클래스). 다른 구조 변경에 편승 저장되는 경우가 많아 눈에 안 띄었을 뿐, chartPrefs를
        // 건드리지 않은 조용한 세션에서 본문만 고치고 새로고침하면 유실된다. 길이 해시 절충안은
        // 동일 길이 편집(오타 수정)을 놓치므로 금지 — JSON 전문이 미탐 0.
        investmentNotesKey: JSON.stringify((p.investmentNotes || []).map(n => ({
          id: n?.id, date: n?.date, content: n?.content || '',
        }))),
        rowColor: p.rowColor || '',
        isTest: !!p.isTest,
        deletedAt: p.deletedAt || '', // 소프트 삭제 태그 — 삭제/복원이 Drive STATE 저장을 트리거하도록 지문에 포함
        // ⚠️ Array.isArray 가드 필수 — 손상된 Drive 값이 비순회 truthy면 `[...x]`가 TypeError를 던져
        // 이 지문 계산이 중단되고, 그 뒤 저장 스케줄까지 통째로 죽어 Drive 저장이 멈춘다.
        hiddenTaxMonths: (Array.isArray(p.hiddenTaxMonths) ? [...p.hiddenTaxMonths] : []).sort((a, b) => a - b),
        // 분배금 표 월 숨김(탭별) — 단독 토글도 Drive STATE 저장을 트리거하도록 지문에 포함
        hiddenDivMonthsExpected: (Array.isArray(p.hiddenDivMonthsExpected) ? [...p.hiddenDivMonthsExpected] : []).sort((a, b) => a - b),
        hiddenDivMonthsActual: (Array.isArray(p.hiddenDivMonthsActual) ? [...p.hiddenDivMonthsActual] : []).sort((a, b) => a - b),
        // 표 열 숨김(포트폴리오·리밸런싱) — 단독 토글도 Drive STATE 저장을 트리거하도록 지문에 포함.
        // 없으면 다른 구조 변경에 편승할 때만 저장돼, 열만 숨기고 새로고침한 세션에서 조용히 되돌아간다.
        hiddenColumnsPortfolio: (Array.isArray(p.hiddenColumnsPortfolio) ? [...p.hiddenColumnsPortfolio] : []).slice().sort(),
        hiddenColumnsRebalancing: (Array.isArray(p.hiddenColumnsRebalancing) ? [...p.hiddenColumnsRebalancing] : []).slice().sort(),
        // 행 색상 마킹(포트폴리오 표·리밸런싱 표) — 단독 토글도 저장 트리거되도록 지문에 포함.
        // 두 필드는 별개다(한쪽만 넣으면 다른 표의 마킹이 계속 유실) — markedRowsKey 주석 참조.
        markedPortfolioRowsKey: markedRowsKey(p.markedPortfolioRows),
        markedRebalRowsKey: markedRowsKey(p.markedRebalRows),
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
        // ⚠️ items 구성까지 지문화 — date·kind·개수만 보면 **같은 날짜 스냅샷의 수량만 다시 고칠 때**
        // (자산검증 모달 commitQty 등) 지문이 그대로라 Drive STATE 저장이 스킵된다. 메모 달력이 이
        // 배열을 '수량 변경' 표시 소스로 쓰므로 "달력엔 떴는데 재접속하면 없다"로 노출된다.
        // snapshotCompositionKey는 수량·예수금·매입금액만 보고 시세는 제외 → 시세 갱신이 저장을 유발하지 않음.
        holdingSnapshotsKey: (p.holdingSnapshots || []).map(s => `${s.date}:${s.kind}:${snapshotCompositionKey(s.items || [])}`).join('|'),
        taxBaseKey: JSON.stringify(Object.keys(p.taxBaseHistory || {}).sort().map(code => {
          const rec = (p.taxBaseHistory || {})[code] || {};
          // ⚠️ avgTaxBaseAdj(실제 과세금 역산 앵커) 필수 — 이 지문은 필드를 손나열하므로 빠뜨리면
          //    '조정만 적용한 세션'이 portfolioUpdatedAt을 올리지 못해 Drive STATE 저장이 통째로
          //    스킵된다(historyVerifyKey·targetAmount와 동일 버그 클래스).
          return { code, events: rec.events || [], exTaxBase: rec.exTaxBase || {}, avgTaxBase: rec.avgTaxBase || {}, avgTaxBaseAdj: rec.avgTaxBaseAdj || {}, lastFetched: rec.lastFetched || '' };
        })),
      })),
      // ⚠️ overseasLinks(해외계좌 전용 퀵링크)는 payload(:state 리터럴)·저장 effect deps에는
      //    있었는데 이 지문에만 빠져 있었다 → 해외계좌에서 링크만 수정한 세션은
      //    portfolioUpdatedAt이 오르지 않아 STATE 저장 가드에 막혀 조용히 유실됐다
      //    (historyVerifyKey·investmentNotesKey·calendarMemos·targetAmount와 동일 버그 클래스).
      //    customLinks처럼 raw로 둘 것 — 바깥 JSON.stringify가 배열을 그대로 직렬화한다.
      activePortfolioId, customLinks, overseasLinks, JSON.stringify(dividendLinks),
      JSON.stringify(calendarMemos),
      JSON.stringify(watchlistGroups),
      // ⚠️ 흐름도 지문 — 없으면 portfolioUpdatedAt이 안 올라 STATE 저장이 통째로 스킵된다
      //    (historyVerifyKey·investmentNotesKey·holdingSnapshotsKey·calendarMemos와 동일 버그 클래스).
      //    flowFingerprint는 저장 필드만 화이트리스트로 투영하고 절대 던지지 않는다 — raw
      //    JSON.stringify로 되돌리지 말 것(순환 참조 하나로 이 지문 계산 아래의 저장 예약이 통째로 죽는다).
      flowFingerprint(flowMaps),
      // ⚠️ 백테스트 시나리오 지문 — 없으면 portfolioUpdatedAt이 안 올라 STATE 저장이 통째로 스킵된다
      //    (flowFingerprint와 동일 버그 클래스). backtestFingerprint도 절대 던지지 않는다.
      backtestFingerprint(backtestScenarios),
      ledgerFingerprint(ledgerBooks),
      ledgerSnapshotsFingerprint(ledgerSnapshots),
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
    const state = { portfolios: currentPortfolios, activePortfolioId, customLinks, overseasLinks, dividendLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, adminAccessAllowed, chartPrefs: { showKospi, showSp500, showNasdaq, showTotalEval, showReturnRate, accountChartStates: accountChartStatesRef.current, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, matongClosedIds, rebalanceSortConfigMap, intHiddenDivMonths, intHistPeriod, acctHistPeriod, fxCurrencies, fxSlotCount, intDashCompStocks: intDashCompStocksToSave }, intHistory, calendarMemos, watchlistGroups, flowMaps, backtestScenarios, ledgerBooks, ledgerSnapshots, seenAdminNotifIds, updatedAt: Date.now(), portfolioUpdatedAt: portfolioUpdatedAtRef.current, chartPrefsUpdatedAt: chartPrefsUpdatedAtRef.current };
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
  }, [portfolios, activePortfolioId, customLinks, overseasLinks, dividendLinks, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, compStocks, showKospi, showSp500, showNasdaq, showTotalEval, showReturnRate, intHistory, showMarketPanel, hideAmounts, showIndicatorsInChart, goldIndicators, goldIndicatorColors, indicatorScales, backtestColor, showBacktest, sectionCollapsedMap, intSec, intChartPeriod, intDateRange, intAppliedRange, chartPeriod, dateRange, appliedRange, seenAdminNotifIds, matongClosedIds, rebalanceSortConfigMap, intHiddenDivMonths, intHistPeriod, acctHistPeriod, fxCurrencies, fxSlotCount, calendarMemos, watchlistGroups, flowMaps, backtestScenarios, ledgerBooks, ledgerSnapshots]);

  // ── 자산검증 P1: 구성 변경 트리거 보유 스냅샷 기록 ──
  // 스냅샷 없으면 baseline(기준일) 부트스트랩, 이후 구성 변경 시에만 auto 스냅샷 추가.
  // 가격 변동은 무시(snapshotCompositionKey가 수량·예수금·구성만 비교) → 일별 적재 아님.
  useEffect(() => {
    if (portfolios.length === 0) return;
    const maybeUpdate = (p) => {
      if (!p || p.accountType === 'simple' || p.accountType === 'matong') return null;
      if (p.deletedAt) return null; // 삭제 계좌는 신규 스냅샷 기록 중단(기존 이력 동결 보존)
      // KR 계좌는 다음 실시간 기록 대상일(21:00 전 오늘 / 후 내일)로 기록 —
      // 새벽 구성 변경이 21:00에 확정된 전일 날짜 스냅샷으로 남는 것 방지
      // (accountType 미설정 레거시 계좌는 'portfolio' 취급 — 앱 전역 컨벤션)
      const today = isKrCutoffAccount(p.accountType || 'portfolio') ? getBackfillBoundaryKR() : effectiveDateKey;
      const items = snapshotItemsFromPortfolio(p.portfolio || []);
      const compKey = snapshotCompositionKey(p.portfolio || []);
      const snaps = Array.isArray(p.holdingSnapshots) ? p.holdingSnapshots : [];
      // 빈 구성은 baseline 부트스트랩만 막는다(기록할 과거가 없음). 이미 스냅샷이 있는 계좌가
      // ⚠️ **비워진 것은 반드시 기록**해야 한다(회귀 주의 — 종목 이관 이중 계상): 안 그러면
      //    resolveHoldings가 영원히 직전(종목 보유) 스냅샷을 돌려줘 이미 다른 계좌로 옮긴 종목이
      //    원계좌의 과거·현재 평가액에 계속 계상된다.
      if (items.length === 0 && snaps.length === 0) return null;
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
    if (activePortfolio?.deletedAt) return; // 삭제된 계좌가 활성이면(복원 후 재활성 등) 이력 기록 동결
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
    if (activePortfolio?.deletedAt) return; // 삭제된 계좌가 활성이면 이력 기록 동결
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
    // ⚠️ 진행 상태의 정본은 useChartInteraction의 ref다 — state만 지우면 다음 mousedown이
    //    유령 앵커/유령 시작점을 되살린다.
    resetChartSelectionRefs();
    setSelectionResult(null);
    setRefAreaLeft('');
    setRefAreaRight('');
    setAnchorDate('');
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
      // 조회시작 0%(TWR) 모드 전용 구간 수익률 — 라인이 재베이스된 누적 TWR이므로
      // 구간값은 두 끝점의 비(base가 약분된다). 원금대비 모드에서는 의미가 없어 쓰지 않는다.
      // 시작점이 null(첫 기록 이전)이면 재베이스 기준점=0%로 본다(라인이 조회시작에서 0%로 출발).
      myReturnPeriodRate: e.principalReturnRate != null
        ? ((100 + e.principalReturnRate) / (100 + (s.principalReturnRate ?? 0)) - 1) * 100 : null,
      ...indRates, ...compRates,
    });
  }, [finalChartData, compStocks]);

  // 통합 대시보드: 조회기간 변경 시 드래그 선택 초기화 + 전체 기간 기본값 계산
  useEffect(() => {
    resetChartSelectionRefs();
    setIntSelectionResult(null);
    setIntRefAreaLeft('');
    setIntRefAreaRight('');
    setIntAnchorDate('');
  }, [intAppliedRange]);

  useEffect(() => {
    if (intChartData.length < 2) { setIntDefaultSelectionResult(null); return; }
    const s = intChartData[0];
    const e = intChartData[intChartData.length - 1];
    // calculateIntSelection과 동일 규약(구간 TWR 비 + 누적 실손익 차분) — 두 곳이 항상 같아야 한다.
    const rate = (s.returnRate != null && e.returnRate != null)
      ? ((100 + e.returnRate) / (100 + s.returnRate) - 1) * 100 : 0;
    const profit = (s.cumProfit != null && e.cumProfit != null)
      ? e.cumProfit - s.cumProfit
      : (e.evalAmount - s.evalAmount);
    const result: any = { startDate: s.date, endDate: e.date, profit, rate, startEval: s.evalAmount, endEval: e.evalAmount };
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
    // 차트 밖 클릭 = 구간 선택 해제(선택 밖을 덮는 딤도 함께 걷힌다 → 전체 차트 원래 밝기로 복원).
    // ⚠️ 통합 대시보드 차트(int*)도 **반드시 함께** 초기화할 것 — 두 차트가 같은
    // '.chart-container-for-drag' 클래스를 쓰는데 과거엔 개별 계좌 state만 지웠다.
    // 선택 하이라이트가 흰색 8%였을 땐 잔존해도 티가 안 났지만, 이제 비선택 구간이 어둡게
    // 덮이므로 그대로 두면 **대시보드 대부분이 어두운 채로 고착**된다.
    // (두 차트는 showIntegratedDashboard로 갈려 동시에 마운트되지 않아 교차 초기화 부작용이 없다.)
    // ⚠️ 판정은 '카드 안인가'가 아니라 **recharts 표면 위인가**다. 카드 안이라도 컨테이너
    // 패딩(p-2~p-4 / px-2)에 떨어진 클릭은 recharts 이벤트가 아예 발생하지 않아, 컨테이너만
    // 보면 해제 경로가 통째로 비는 링이 생긴다. (플롯 rect 밖이지만 표면 위인 축 눈금 영역은
    // recharts가 activeLabel 없이 onMouseDown을 부르므로 useChartInteraction이 처리한다.)
    // ⚠️ touchstart도 함께 듣는다 — 터치 기기에서는 recharts가 onTouchStart를 onMouseDown으로
    // 위임해 손가락 드래그로도 선택이 만들어지는데, 스크롤로 판정된 터치에는 호환 mousedown이
    // 발생하지 않아 mousedown만 듣던 종전 코드로는 딤이 영영 안 걷혔다.
    const handler = (e) => {
      const t = e.target;
      const onSurface = t && t.closest && t.closest('.chart-container-for-drag') && t.closest('.recharts-wrapper');
      if (onSurface) return;
      resetChartSelectionRefs();
      setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); setAnchorDate('');
      setIntRefAreaLeft(''); setIntRefAreaRight(''); setIntSelectionResult(null); setIntAnchorDate('');
    };
    window.addEventListener('mousedown', handler);
    window.addEventListener('touchstart', handler, { passive: true });
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('touchstart', handler);
    };
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

  // ⚠️ 카드 별도 창 피더는 **early return보다 위에서** 만들고 모든 화면 분기에 함께 렌더한다 —
  //    메인 대시보드 return 안에만 두면 앱 탭이 관리자 페이지·배당세 페이지로 이동하는 순간
  //    피더가 언마운트돼 창은 갱신이 멈추는데도 ping/pong은 계속 오가 '연결됨·편집 가능'으로 남는다
  //    (창은 낡은 화면을 보며 편집하게 된다). 렌더 출력이 없으므로 어느 분기에 있어도 무해하다.
  const cardWinFeeds = (
    <>
      {/* 카드 별도 창 피더 — 렌더 출력 없음. 창 하나당 하나씩 마운트돼 그 계좌의 원자재를
          identity 게이팅으로 push한다(창이 닫히면 sweep이 레지스트리에서 지워 언마운트된다). */}
      {cardWinKeys.map(k => {
        const entry = cardWinsRef.current.get(k);
        return entry ? (
          <CardWinFeed
            key={k}
            entry={entry}
            portfolios={portfolios}
            marketIndicators={marketIndicators}
            marketHolidays={marketHolidays}
            dividendTaxHistory={dividendTaxHistory}
            dividendLinks={dividendLinks}
            stockHistoryMap={stockHistoryMap}
            indicatorHistoryMap={indicatorHistoryMap}
            stockFetchStatus={stockFetchStatus}
            hideAmounts={hideAmounts}
            histPeriod={acctHistPeriod}
            isAdmin={!!adminViewingAs || (authUser && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase())}
            authEpoch={cardAuthEpoch}
            nonce={cardWinNonce}
            effectiveDateKey={isKrCutoffAccount(
              (portfolios.find(p => p && p.id === entry.pid) || {}).accountType || 'portfolio',
            ) ? krEffectiveDateKey : effectiveDateKey}
          />
        ) : null;
      })}
    </>
  );

  // 관리자 로그인 직후 — Drive 로딩 전 페이지 선택
  if (adminPendingChoice) {
    return (
      <>
      {cardWinFeeds}
      <AdminChoiceModal
        adminEmail={authUser.email}
        onSelectPortfolio={() => { setAdminPendingChoice(false); setDriveLoadReady(true); }}
        onSelectAdmin={() => { setAdminPendingChoice(false); setShowAdminPage(true); }}
      />
      </>
    );
  }

  // 관리자 포털
  if (showAdminPortal && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return (
      <>
      {cardWinFeeds}
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
      </>
    );
  }

  // 관리자 페이지
  if (showAdminPage && authUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return <>{cardWinFeeds}<AdminPage adminEmail={authUser.email} onClose={() => {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.reload();
    }} onViewUser={handleAdminViewUser} onOpenPortal={() => { window.open(`${window.location.origin}/?adminPortal=1`, '_blank'); }} userAccessStatus={userAccessStatus} switching={adminSwitching} userLastSeen={userLastSeen} userDriveStatus={userDriveStatus} onRefreshUserSessions={handleRefreshUserSessions} youtubeUrl={youtubeUrl} onSetYoutubeUrl={handleSetYoutubeUrl} notebookLinks={notebookLinks} onSetNotebookLinks={handleSetNotebookLinks} reportUrl={reportUrl} onSetReportUrl={handleSetReportUrl} noticeFlags={noticeFlags} onSetNoticeFlags={handleSetNoticeFlags} onUploadStudyMaterial={handleUploadStudyMaterial} onDeleteStudyMaterialFile={handleDeleteStudyMaterialFile} /></>;
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
      <>
      {cardWinFeeds}
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
      </>
    );
  }

  // 계좌 유형 파생 플래그 — 의미가 다르므로 절대 합치지 말 것 (혼동/회귀 방지)
  //  · isRetirementAccount: 펀드 기능(펀드 행·"펀드 추가" 버튼) — 퇴직연금(DC/IRP) + 개인연금(pension)
  //  · isDcIrpAccount     : 위험/안전(D/S) 자산 구분 + D70/S30 통계 — 퇴직연금(DC/IRP) 전용
  const isRetirementAccount = activePortfolioAccountType === 'dc-irp' || activePortfolioAccountType === 'pension';
  const isDcIrpAccount = activePortfolioAccountType === 'dc-irp';
  const investmentNotes = activePortfolio?.investmentNotes ?? [];

  // ── 관리자 공지/벨 이력 클릭 → 학습자료 열기 ──
  // 시장동향 리포트는 단일 URL 바로가기라 복원할 자료 목록이 없다 → 학습자료 채널만 남는다.
  // ⚠️ resolveMaterial은 반드시 '기능 게이팅된' 배열만 사용한다(권한 OFF 사용자는 복원 0 → 접근 차단).
  //    UserInfoBar에 넘기는 게이팅 배열(아래 props)과 동일 소스를 써서 모달/벨/드롭다운이 한 기준으로 동작.
  //    isAdminUser는 위(관리자 자동 허용)에서 이미 선언됨 — 재선언 금지(중복 const = SyntaxError).
  // 헤더 자료 아이콘(유튜브·학습자료·시장동향) 접근 권한 — 관리자 또는 사용자별 기능 ON.
  // OFF면 아이콘 자체를 렌더하지 않는다(예초에 없었던 것처럼). 배당과세 아이콘(canAccessDividendTax)과 동일 패턴.
  const youtubeAccess = isAdminUser || userFeatures.youtubeEnabled;
  const notebookAccess = isAdminUser || userFeatures.notebookEnabled;
  const reportAccess = isAdminUser || userFeatures.reportEnabled;
  // 자금 흐름도 접근 권한. ⚠️ effectiveUserFeatures(feature1/2/3만 true로 강제하는 별개 경로)에
  //    얹지 말 것 — 흐름도는 App.tsx에서 직접 조건 렌더하므로 `*Access` 상수 패턴이 맞다.
  //    이 상수가 없으면 관리자 본인이 기능에 **영구히 접근 불가**하다(AdminPage 토글은 `!isAdminUser`
  //    조건이라 관리자 행에는 렌더조차 되지 않아 시트를 손으로 고치지 않는 한 켤 방법이 없다).
  const flowAccess = isAdminUser || userFeatures.flowEnabled;
  // 백테스트 접근 권한 — flowAccess와 완전히 같은 근거(관리자 본인이 영구 접근 불가가 되지 않게).
  const backtestAccess = isAdminUser || userFeatures.backtestEnabled;
  const gatedNotebookLinks = notebookAccess ? notebookLinks : [];
  const gatedReportUrl = reportAccess ? reportUrl : '';
  // 옛 벨 이력에 남은 materialChannel:'report' 태그는 빈 배열 + null 채널로 떨어져 평문 표시된다(클릭 불가).
  const resolveMaterial = (channel, message, refCreatedAt) => resolveNoticeMaterial(
    channel === 'notebook' ? gatedNotebookLinks : [],
    message, channel === 'notebook' ? 'notebook' : null, refCreatedAt,
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
      {cardWinFeeds}
      <ConfirmDialog state={confirmState} onResolve={resolveConfirm} />
      <LoadingOverlay
        visible={isInitialLoading}
        notificationLog={notificationLog}
        onDismiss={() => { awaitingSettleRef.current = false; setIsInitialLoading(false); }}
        histPhase={histPhase}
        histProgress={histProgress}
        histPartial={histPartial}
      />
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
            // ⚠️ 카드 별도 창을 먼저 정리한다(ADMIN_VIEW_EMAIL 가드보다 앞) — 그러지 않으면
            //    로그아웃 후에도 창에 이전 사용자의 계좌 데이터가 그대로 남는다.
            try { teardownCardWinsRef.current?.(); } catch {}
            // 새 탭 관리자 접속 중에는 로그아웃=탭 닫기(reload 시 ?adminView로 재진입 루프 방지)
            if (ADMIN_VIEW_EMAIL) { closeAdminViewTab(); return; }
            sessionStorage.removeItem(SESSION_KEY);
            window.location.reload();
          }}
          canAccessDividendTax={canAccessDividendTax}
          onOpenDividendTax={() => setShowDividendTaxPage(true)}
          onAppClose={handleAppClose}
          canAccessFlow={flowAccess}
          onOpenFlow={openFlowWindow}
          canAccessBacktest={backtestAccess}
          onOpenBacktest={openBacktestWindow}
          canAccessLedger={ledgerAccess}
          onOpenLedger={openLedgerWindow}
          showCalculator={showCalculator}
          onToggleCalculator={() => setShowCalculator(v => !v)}
          youtubeUrl={youtubeAccess ? youtubeUrl : ''}
          youtubeEnabled={youtubeAccess}
          notebookLinks={gatedNotebookLinks}
          notebookEnabled={notebookAccess}
          reportUrl={gatedReportUrl}
          reportEnabled={reportAccess}
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
          fetchMarketIndicators={fetchMarketIndicators}
          indicatorLoading={indicatorLoading}
          onOpenMaterial={openMaterial}
          resolveMaterial={resolveMaterial}
        />

        <AccountTabBar
          portfolios={portfolios}
          showIntegratedDashboard={showIntegratedDashboard}
          setShowIntegratedDashboard={goIntegratedDashboard}
          activePortfolioId={activePortfolioId}
          title={title}
          switchToPortfolio={switchToPortfolioWithSnapshot}
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
          indicatorLoading={indicatorLoading}
          activeLinks={activePortfolioAccountType === 'overseas' ? (overseasLinks || []) : (customLinks || [])}
          setActiveLinks={activePortfolioAccountType === 'overseas' ? setOverseasLinks : setCustomLinks}
          marketIndicators={marketIndicators}
          onOpenCalendar={() => { setCalWinBlocked(false); setShowCalendarModal(true); }}
          onOpenWatchlist={() => setShowWatchlist(true)}
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
            onRefresh={() => fetchMarketIndicators({ fresh: true })}
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
            onTransfer={(id) => setTransferItemId(id)}
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
            accountName={title}
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
            onExpand={() => openCardWindow('summary', activePortfolioId)}
            cardWindowOpen={cardWinOpenSet.has(`summary:${activePortfolioId}`)}
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
            portfolioStartDate={portfolioStartDate}
            activeBookByDate={activeBookByDate}
            histPeriod={acctHistPeriod}
            setHistPeriod={setAcctHistPeriod}
            refetchStockHistory={refetchStockHistory}
            onExpand={() => openCardWindow('stats', activePortfolioId)}
            cardWindowOpen={cardWinOpenSet.has(`stats:${activePortfolioId}`)}
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
            updateTaxBaseAvgAdj={updateTaxBaseAvgAdj}
            onToggleTaxMonth={toggleHiddenTaxMonth}
            hiddenMonths={normalizeHiddenDivMonths({
              expected: activePortfolio?.hiddenDivMonthsExpected,
              actual: activePortfolio?.hiddenDivMonthsActual,
            })}
            onToggleHiddenMonth={(tab, monthIndex) => toggleHiddenDividendMonth(activePortfolioId, tab, monthIndex)}
            deletePortfolioDividendData={deletePortfolioDividendData}
            deletePortfolioTaxData={deletePortfolioTaxData}
            confirmDialog={confirm}
            notify={notify}
            usdkrw={marketIndicators.usdkrw || 1300}
            holidays={marketHolidays}
            dividendTaxHistory={dividendTaxHistory}
            onDividendTaxHistoryUpdate={setDividendTaxHistory}
            dividendLinks={dividendLinks}
            setDividendLinks={setDividendLinks}
            onExpand={() => openCardWindow('dividend', activePortfolioId)}
            cardWindowOpen={cardWinOpenSet.has(`dividend:${activePortfolioId}`)}
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
            handleChartDoubleClick={handleChartDoubleClick}
            anchorDate={anchorDate}
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
            onTargetEdited={handleTargetEdited}
            onTargetSaveNow={handleTargetSaveNow}
            rebalTargetSnapshots={rebalTargetSnapshots}
            activePortfolioId={activePortfolioId}
            onTargetRestored={handleTargetRestored}
            onManualSave={handleDriveSave}
            driveStatus={driveStatus}
            showCalculator={showCalculator}
            onToggleCalculator={() => setShowCalculator(v => !v)}
            investmentNotes={investmentNotes}
            onUpdateInvestmentNotes={updateInvestmentNotes}
            onRefreshPrice={handleSingleStockRefresh}
            stockFetchStatus={stockFetchStatus}
            onExpandTable={() => openCardWindow('rebalancing', activePortfolioId)}
            onExpandDonut={() => openCardWindow('donut', activePortfolioId)}
            tableWindowOpen={cardWinOpenSet.has(`rebalancing:${activePortfolioId}`)}
            donutWindowOpen={cardWinOpenSet.has(`donut:${activePortfolioId}`)}
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
            intTwrCumByDate={intTwrCumByDate}
            intHistPeriod={intHistPeriod}
            setIntHistPeriod={setIntHistPeriod}
            intChartData={intChartData}
            intChartPeriod={intChartPeriod}
            intSelectionResult={intSelectionResult}
            intDefaultSelectionResult={intDefaultSelectionResult}
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
            setHoveredIntCatSlice={setHoveredIntCatSlice}
            setHoveredIntHoldSlice={setHoveredIntHoldSlice}
            setShowNewAccountMenu={setShowNewAccountMenu}
            setSimpleEditField={setSimpleEditField}
            addPortfolio={addPortfolio}
            addSimpleAccount={addSimpleAccount}
            addMatongAccount={addMatongAccount}
            updateMatongAccountField={updateMatongAccountField}
            deletePortfolio={deletePortfolio}
            restorePortfolio={restorePortfolio}
            purgePortfolio={purgePortfolio}
            switchToPortfolio={switchToPortfolioWithSnapshot}
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
            handleIntChartDoubleClick={handleIntChartDoubleClick}
            intAnchorDate={intAnchorDate}
            intHoveredPoint={intHoveredPoint}
            handleSave={handleSave}
            allPortfoliosForDividend={allPortfoliosForDividend}
            intAccountSeriesById={intAccountSeriesById}
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
            intHiddenDivMonths={intHiddenDivMonths}
            onToggleIntHiddenDivMonth={toggleIntHiddenDivMonth}
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
      {/* 계산기는 App 최상위 형제라 렌더 예외가 루트 ErrorBoundary까지 올라가면 앱 화면 전체가
          오류 페이지로 대체된다 → label 지정으로 섹션 모드 격리(2차 방어). */}
      <ErrorBoundary label="계산기">
        <FloatingCalculator
          isOpen={showCalculator}
          onClose={() => setShowCalculator(false)}
          fxCurrencies={fxCurrencies}
          fxSlotCount={fxSlotCount}
          onChangeFx={(codes, slots) => {
            setFxCurrencies(normalizeFxCurrencies(codes));
            setFxSlotCount(normalizeFxSlotCount(slots));
          }}
        />
      </ErrorBoundary>
      <WatchlistPopup
        open={showWatchlist}
        onClose={() => setShowWatchlist(false)}
        groups={watchlistGroups}
        onUpdateGroups={setWatchlistGroups}
      />
      {/* 종목 계좌 간 이관 — '미리보기 후 적용'(undo 없음). 항목이 사라지면 transferItem이 null이 되어 자동 닫힘 */}
      {transferItem && (
        <StockTransferModal
          item={transferItem}
          sourceName={title}
          currency={activePortfolioAccountType === 'overseas' ? 'USD' : 'KRW'}
          targets={transferTargets}
          getPlan={buildTransferPlan}
          moves={transferMoves}
          onConfirm={handleTransferStock}
          onClose={() => setTransferItemId(null)}
        />
      )}
      {/* 메모 달력 (비차단·이동 가능 플로팅 창) — App 최상위 형제로 마운트해 탭/뷰 전환에도 언마운트 안 됨.
          ⚠️ ErrorBoundary label 지정 = 섹션 모드 격리. 없으면 렌더 예외 하나가 루트 경계까지 올라가
             앱 화면 전체가 오류 페이지로 대체된다(계산기·자금 흐름도와 동일한 2차 방어). */}
      <ErrorBoundary label="메모 달력">
      <CalendarModal
        open={showCalendarModal}
        onClose={() => setShowCalendarModal(false)}
        memos={calendarMemos}
        // ⚠️ 미러 ref도 함께 갱신 — calendarMemosRef는 effect로 따라가므로 한 tick 뒤처질 수 있고,
        // 그 사이 목표비중 커밋이 옛 값 기준으로 통째 교체하면 방금 저장한 메모가 지워질 수 있다.
        onUpdateMemos={(next) => { calendarMemosRef.current = next; setCalendarMemos(next); }}
        holidays={marketHolidays}
        notify={notify}
        confirm={confirm}
        // 투자기록(investmentNotes)·종목 수량 변경(holdingSnapshots diff) 라이브 파생 소스.
        // ⚠️ calendarMemos에 복사하지 않는다 — 복사하면 리밸런싱 패널 메모장·자산검증과 갈라진다.
        portfolios={portfolios}
        activePortfolioId={activePortfolioId}
        onUpdateInvestmentNotes={updateInvestmentNotesFor}
        metricsHistory={intMonthlyHistory}
        todayReturnRate={intTotals.returnRate}
        fxHistory={indicatorHistoryMap?.usdkrw}
        us10yHistory={indicatorHistoryMap?.us10y}
        liveFx={marketIndicators?.usdkrw}
        liveUs10y={marketIndicators?.us10y}
        onOpenWindow={openCalendarWindow}
        headerNotice={calWinBlocked ? '팝업이 차단돼 별도 창을 열지 못했습니다. 주소창의 팝업 허용 후 다시 시도하세요.' : null}
        // 날짜 칸 자산 스냅샷 클릭 → 계좌별 현황. 인앱은 **동기 재조회**라 브릿지 prop이 필요 없다.
        buildHistDetail={buildHistDetail}
        hideAmounts={hideAmounts}
        // 💰 가계부 BUDGET 칩 — 라이브 파생(calendarMemos에 복사하지 않는다).
        // ⚠️ 권한이 없으면 빈 배열을 넘겨 칩 자체가 렌더되지 않게 한다.
        ledgerBooks={ledgerAccess ? ledgerBooks : []}
        onOpenLedger={ledgerAccess ? openLedgerWindow : null}
      />
      </ErrorBoundary>
      {/* 자금 흐름도 — App 최상위 형제(계좌 탭/뷰 전환에도 언마운트 안 됨).
          ⚠️ ErrorBoundary label 지정 = 섹션 모드 격리. 없으면 좌표 NaN 하나가 루트 경계까지
             올라가 앱 화면 전체가 오류 페이지로 대체된다(FloatingCalculator와 동일 2차 방어).
          ⚠️ flowAccess가 false면 **마운트 자체를 하지 않는다** — prop만 넘기고 내부에서 숨기면
             OFF 사용자가 파생 memo 구독 비용을 그대로 치른다. */}
      {flowAccess && (
        <ErrorBoundary label="자금 흐름도">
          <FlowBoard
            open={showFlowBoard}
            onClose={() => setShowFlowBoard(false)}
            maps={flowMaps}
            // ⚠️ functional updater 계약(WatchlistPopup 선례) — 통째 교체로 되돌리면 같은 tick에
            //    발생한 두 커밋(드래그 pointerup + 인스펙터 blur) 중 하나가 조용히 사라진다.
            onUpdateMaps={setFlowMaps}
            flushRef={flowFlushRef}
            portfolios={portfolios}
            portfolioSummaries={portfolioSummaries}
            hideAmounts={hideAmounts}
            confirm={confirm}
            // 관리자 impersonation 중에는 읽기 전용 — 목표비중과 달리 흐름도는 undo도 없고
            // 백업 복원으로도 되돌릴 수 없는 sticky 데이터라, 무통지 편집을 허용하지 않는다.
            readOnly={!!adminViewingAs}
            headerNotice={flowWinBlocked ? '팝업이 차단돼 별도 창을 열지 못했습니다. 주소창의 팝업 허용 후 다시 시도하세요(지금은 앱 안에서 표시 중).' : null}
          />
        </ErrorBoundary>
      )}
      {/* 백테스트 — 기본은 별도 브라우저 창이고, 이 인앱 렌더는 **팝업 차단 시 폴백**이다.
          ⚠️ 게이팅 밖에 두지 말 것: 접근 권한이 없는 사용자가 파생 memo 구독 비용을 그대로 치른다.
          ⚠️ ErrorBoundary label 지정 필수 — App 최상위 형제라 렌더 예외가 루트까지 올라가면
             앱 화면 전체가 오류 페이지로 대체된다(FloatingCalculator·FlowBoard와 동일 2차 방어). */}
      {backtestAccess && showBacktestPage && (
        <ErrorBoundary label="백테스트">
          <BacktestPage
            open
            variant="overlay"
            onClose={() => setShowBacktestPage(false)}
            scenarios={backtestScenarios}
            onUpdateScenarios={setBacktestScenarios}
            flushRef={backtestFlushRef}
            catalog={btCatalog}
            prices={btPrices}
            dividends={btDividends}
            holidays={btHolidays}
            fetchingCodes={btFetching}
            onFetchCode={handleBacktestFetch}
            onOpenWindow={openBacktestWindow}
            // 관리자 impersonation 중에는 읽기 전용 — 흐름도와 같은 근거(undo 없음 + sticky 데이터).
            readOnly={!!adminViewingAs}
            notice={btWinBlocked ? '팝업이 차단돼 별도 탭을 열지 못했습니다. 주소창의 팝업 허용 후 다시 시도하세요(지금은 앱 안에서 표시 중).' : ''}
          />
        </ErrorBoundary>
      )}
      {/* 가계부 — 기본은 별도 브라우저 창이고, 이 인앱 렌더는 **팝업 차단 시 폴백**이다.
          ⚠️ 게이팅 밖에 두지 말 것: 접근 권한이 없는 사용자가 파생 memo 구독 비용을 그대로 치른다.
          ⚠️ ErrorBoundary label 지정 필수 — App 최상위 형제라 렌더 예외가 루트까지 올라가면
             앱 화면 전체가 오류 페이지로 대체된다(FlowBoard·BacktestPage와 동일 2차 방어). */}
      {ledgerAccess && showLedgerPage && (
        <ErrorBoundary label="가계부">
          <LedgerPage
            open
            variant="overlay"
            onClose={() => setShowLedgerPage(false)}
            books={ledgerBooks}
            onUpdateBooks={setLedgerBooks}
            snapshots={ledgerSnapshots}
            onUpdateSnapshots={setLedgerSnapshots}
            flushRef={ledgerFlushRef}
            onOpenWindow={openLedgerWindow}
            hideAmounts={hideAmounts}
            today={getTodayKST()}
            // ⚠️ 관리자 impersonation(undo 없음 + sticky라 무통지 편집 금지)에 더해,
            //    **Drive 로드가 끝나기 전/실패했을 때도 반드시 읽기 전용**이어야 한다.
            //    로드 전에 사용자가 한 글자라도 치면 dirty가 서고, 그러면 뒤늦게 도착한 진짜
            //    장부가 채택되지 못한 채 2.5초 뒤 그 입력이 Drive를 덮는다(2026-08-29 실측 유실).
            //    `setLocal`·시드 효과 둘 다 `if (readOnly) return`이라 이 한 줄이 그 경로를 닫는다.
            readOnly={!!adminViewingAs || ledgerDataState !== 'ready'}
            notice={
              ledgerDataState === 'loading' ? '가계부를 불러오는 중입니다… 로드가 끝날 때까지 편집이 잠깁니다(빈 장부가 기존 기록을 덮는 것을 막습니다).'
                : ledgerDataState === 'error' ? '가계부를 불러오지 못했습니다. 기존 기록을 덮어쓰지 않도록 편집을 잠갔습니다 — 새로고침 후 다시 시도하세요.'
                  : ledgerWinBlocked ? '팝업이 차단돼 별도 탭을 열지 못했습니다. 주소창의 팝업 허용 후 다시 시도하세요(지금은 앱 안에서 표시 중).' : ''
            }
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
