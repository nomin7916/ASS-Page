// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  RefreshCw, ChevronLeft, TrendingUp, TrendingDown, Minus, AlertCircle,
  EyeOff, Plus, Trash2, Pencil, Check, X, ArrowUp, ArrowDown, Users,
} from 'lucide-react';
import { APPS_SCRIPT_URL, GOOGLE_CLIENT_ID, ADMIN_EMAIL } from '../config';
import {
  findUserIndexFolder, loadDriveFile, DRIVE_FILES,
  getOrCreateAdminFolder, saveAdminUserCache, loadAdminUserCache,
  saveAdminPortalConfig, loadAdminPortalConfig,
} from '../driveStorage';
import { cleanNum, calcPortfolioEvalDetail, formatShortDate, generateId } from '../utils';
import { fetchStockInfo, fetchUsStockInfo, fetchFundInfo, fetchMiraeFundInfo } from '../api';

interface ApprovedUser { email: string; name?: string; }

interface UserStat {
  email: string;
  name: string;
  accessCount: number;
  firstAt: number | null;
  lastAt: number | null;
  evalTotal: number;
  principal: number;
  totalReturnRate: number;
  prevEvalTotal: number;
  prevDate: string;
  dailyReturnRate: number;
  dodAbsChange: number;
  series: Record<string, number>;   // YYYY-MM-DD → 일별 총 평가금액 (수정3 매트릭스용)
  cachedAt: number;
  fetchFailed: boolean;
  adminAllowed: boolean;
  pending?: boolean;                // 새로고침 진행 중(아직 미처리)
}

interface AdminCache {
  users: Record<string, UserStat>;
  refreshedAt: number;
}

// ── 시각/날짜 유틸 (KST 기준 오늘 — 사용자 history 키와 정합) ──
const KST_OFFSET = 9 * 60 * 60 * 1000;
const todayKST = () => new Date(Date.now() + KST_OFFSET).toISOString().slice(0, 10);

// {date: value} 객체에서 최신 날짜의 값 (없으면 0)
const latestOf = (obj: Record<string, number> | null | undefined): number => {
  if (!obj) return 0;
  const ks = Object.keys(obj);
  if (!ks.length) return 0;
  ks.sort();
  const v = Number(obj[ks[ks.length - 1]]);
  return v > 0 ? v : 0;
};

// 계좌 마지막 기록 평가액 (실시간 재계산 실패 시 폴백)
const lastHistEval = (p: any): number => {
  const h = (p?.history || []).filter((x: any) => x && x.date && Number(x.evalAmount) > 0);
  if (!h.length) return 0;
  return Number(h.reduce((a: any, b: any) => (a.date >= b.date ? a : b)).evalAmount) || 0;
};

// ── 실시간 시세 조회 (관리자 브라우저 — useMarketData와 동일 소스/프록시) ──
const PROXIES = (url: string) => [
  `/api/proxy?url=${encodeURIComponent(url)}`,
  `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  `https://api.codetabs.com/v1/proxy?quest=${url}`,
];

// 시세 + 전일대비 등락률(%) 동반 반환 — 전일 종가 역산(현재가÷(1+등락률/100))에 사용.
type LiveQuote = { price: number; changeRate: number };

async function fetchLiveUsdKrw(): Promise<LiveQuote> {
  const targetUrl = 'https://m.stock.naver.com/api/marketIndex/exchange/FX_USDKRW';
  for (const proxy of PROXIES(targetUrl)) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
      if (price > 0) {
        const changeRate = parseFloat(String(data?.fluctuationsRatio ?? '0').replace(/,/g, '')) || 0;
        return { price, changeRate };
      }
    } catch { /* try next proxy */ }
  }
  return { price: 0, changeRate: 0 };
}

async function fetchLiveGoldKr(): Promise<LiveQuote> {
  const targetUrl = 'https://finance.naver.com/marketindex/goldDetail.naver';
  for (const proxy of PROXIES(targetUrl)) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const html = await res.text();
      const m = html.match(/var DEAL_VAL\s*=\s*([\d.]+)/);
      if (m) {
        const price = parseFloat(m[1]);
        if (price > 0) {
          // 전일대비 등락률(페이지 노출 시 사용, 없으면 0 → 금 일변동은 보수적으로 미반영)
          const rm = html.match(/var FLUC_RT\s*=\s*([+\-]?[\d.]+)/);
          const changeRate = rm ? (parseFloat(rm[1]) || 0) : 0;
          return { price, changeRate };
        }
      }
    } catch { /* try next proxy */ }
  }
  return { price: 0, changeRate: 0 };
}

// 종목 시세 dedup 캐시 (kind:code → {price,changeRate}). 모든 사용자 간 공유 → 중복 조회 방지.
async function getLivePrice(cache: Map<string, LiveQuote>, kind: 'kr' | 'us' | 'fund', code: string): Promise<LiveQuote> {
  const key = `${kind}:${code}`;
  if (cache.has(key)) return cache.get(key)!;
  let price = 0, changeRate = 0;
  try {
    let d: any = null;
    if (kind === 'kr') d = await fetchStockInfo(code);
    else if (kind === 'us') d = await fetchUsStockInfo(code);
    else if (kind === 'fund') d = code.startsWith('MA:') ? await fetchMiraeFundInfo(code) : await fetchFundInfo(code);
    if (d && Number(d.price) > 0) { price = Number(d.price); changeRate = Number(d.changeRate) || 0; }
  } catch { /* fail → 0 */ }
  const q: LiveQuote = { price, changeRate };
  cache.set(key, q);
  return q;
}

// 한 계좌의 평가액 산출 — { live: 현재 평가액, prev: 직전 거래일 평가액 }을 동시 반환.
// live: 실시간 시세, 미조회분은 저장된 currentPrice, 전체 실패 시 마지막 기록 평가액으로 폴백.
// prev: 각 종목의 전일 종가(현재가÷(1+등락률/100))로 재계산 → 사용자 통합 대시보드 '오늘 수익'과
//       동일 기준(저장 이력·백필·휴장 달력 의존 없이 라이브 시세 한 번으로 직전 거래일 복원).
//       현금성(simple·matong)·예수금은 일변동 0(prev=live), 보유종목 매매가 없으면 대시보드와 일치.
function recomputePortfolioEval(
  p: any,
  cache: Map<string, LiveQuote>,
  liveFxObj: LiveQuote,
  liveGoldObj: LiveQuote,
  ihm: any,
  today: string,
): { live: number; prev: number } {
  const at = p.accountType || 'portfolio';
  if (at === 'simple') { const v = cleanNum(p.evalAmount); return { live: v, prev: v }; }
  if (at === 'matong') {
    const v = Math.max(0, cleanNum(p.withdrawableTotal) - (cleanNum(p.currentWithdrawal) + cleanNum(p.withdrawalLimit)));
    return { live: v, prev: v };
  }
  const items = p.portfolio || [];
  const isOverseas = at === 'overseas';
  const toPrev = (px: number, rate: number) => { const f = 1 + (Number(rate) || 0) / 100; return f > 0 ? px / f : px; };
  const synthLive: Record<string, Record<string, number>> = {};
  const synthPrev: Record<string, Record<string, number>> = {};
  items.forEach((item: any) => {
    if (!item.code) return;
    let px = 0, rate = 0;
    if (item.type === 'stock') { const q = cache.get(`${isOverseas ? 'us' : 'kr'}:${item.code}`); px = (q?.price || 0) || cleanNum(item.currentPrice); rate = q?.changeRate || 0; }
    else if (item.type === 'fund') { const q = cache.get(`fund:${item.code}`); px = (q?.price || 0) || cleanNum(item.currentPrice); rate = q?.changeRate || 0; }
    else return;
    if (px > 0) { synthLive[item.code] = { [today]: px }; synthPrev[item.code] = { [today]: toPrev(px, rate) }; }
  });
  const fxLive = isOverseas ? (liveFxObj.price || cleanNum(p.avgExchangeRate) || latestOf(ihm?.usdkrw) || 1) : 1;
  const fxPrev = isOverseas ? (toPrev(liveFxObj.price, liveFxObj.changeRate) || fxLive) : 1;
  const goldLive = liveGoldObj.price || latestOf(ihm?.goldKr) || 0;
  const goldPrev = toPrev(goldLive, liveGoldObj.changeRate);
  const indLive = { usdkrw: { [today]: fxLive }, goldKr: goldLive > 0 ? { [today]: goldLive } : {} };
  const indPrev = { usdkrw: { [today]: fxPrev }, goldKr: goldPrev > 0 ? { [today]: goldPrev } : {} };
  const mpo = p.manualPriceOverrides || null;
  const rLive = calcPortfolioEvalDetail(items, at, today, synthLive, indLive, fxLive, mpo);
  const rPrev = calcPortfolioEvalDetail(items, at, today, synthPrev, indPrev, fxPrev, mpo);
  let live: number;
  if (rLive.hasAnyPrice && rLive.total > 0) live = rLive.total;
  else { const lh = lastHistEval(p); live = lh > 0 ? lh : (rLive.total || 0); }
  // 전일 종가를 신뢰성 있게 구한 경우만 prev 사용, 아니면 live로 폴백(일변동 0 → 노이즈 방지)
  const prev = (rPrev.hasAnyPrice && rPrev.total > 0) ? rPrev.total : live;
  return { live, prev };
}

// 사용자 일별 총 평가금액 시계열 산출(계좌별 carry-forward 합산, 오늘=실시간 합계).
// 통합대시보드 computedIntHistory와 동일 규칙(현금성은 0 포함, 시장은 evalAmount>0).
function buildUserSeries(portfolios: any[], liveTotal: number, today: string): Record<string, number> {
  const per = (portfolios || []).map((p: any) => {
    const isCash = p.accountType === 'matong' || p.accountType === 'simple';
    const m = new Map<string, number>();
    (p.history || []).forEach((h: any) => {
      if (!h || !h.date) return;
      const v = Number(h.evalAmount);
      if (isCash) { if (!isNaN(v) && v >= 0) m.set(h.date, v); }
      else { if (v > 0) m.set(h.date, v); }
    });
    return { dates: [...m.keys()].sort(), map: m };
  });
  const ds = new Set<string>();
  per.forEach(s => s.dates.forEach(d => ds.add(d)));
  ds.add(today);
  const sorted = [...ds].sort();
  const out: Record<string, number> = {};
  per.forEach(s => {
    let i = 0, last = 0;
    for (const d of sorted) {
      while (i < s.dates.length && s.dates[i] <= d) { last = s.map.get(s.dates[i])!; i++; }
      if (last > 0) out[d] = (out[d] || 0) + last;
    }
  });
  out[today] = liveTotal > 0 ? liveTotal : (out[today] || 0);
  return out;
}

function computePrincipal(portfolios: any[]): number {
  let principal = 0;
  for (const p of (portfolios || [])) {
    const isOverseas = p.accountType === 'overseas';
    const avgFx = isOverseas ? (Number(p.avgExchangeRate) || 1) : 1;
    principal += (Number(p.principal) || 0) * avgFx;
  }
  return principal;
}

const fmtAmount = (n: number) => {
  if (!n || isNaN(n)) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}억`;
  if (abs >= 10000) return `${sign}${Math.round(abs / 10000).toLocaleString()}만`;
  return n.toLocaleString();
};

const fmtSignedAmount = (n: number | null) => {
  if (n == null || isNaN(n)) return <span className="text-gray-600">-</span>;
  if (Math.abs(n) < 1) return <span className="text-gray-500">0</span>;
  const sign = n > 0 ? '+' : '';
  const color = n > 0 ? 'text-red-400' : 'text-blue-400';
  return <span className={color}>{sign}{fmtAmount(n)}</span>;
};

// 등락률(%) — 한국 관례: 상승=빨강, 하락=파랑
const fmtReturnEl = (r: number) => {
  if (!r || isNaN(r)) return <span className="text-gray-600">-</span>;
  const sign = r > 0 ? '+' : '';
  const color = r > 0 ? 'text-red-400' : 'text-blue-400';
  return <span className={color}>{sign}{r.toFixed(2)}%</span>;
};

const fmtRelTime = (ts: number | null) => {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
};

const fmtDays = (firstAt: number | null) => {
  if (!firstAt) return '-';
  return `${Math.floor((Date.now() - firstAt) / 86400000)}일`;
};

async function fetchApprovedUsers(): Promise<ApprovedUser[]> {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=listUsers&cacheBust=${Date.now()}`);
    if (!res.ok) return [];
    const data = await res.json();
    // 관리자도 사용자 현황에 포함(시트 이름 그대로 사용). 숨김은 포털 설정으로 별도 제어.
    return (data.users || []).filter((u: any) => u.email);
  } catch {
    return [];
  }
}

const isAdminEmail = (email: string) => email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

interface Props {
  adminEmail: string;
  onClose: () => void;
  onViewUser: (email: string) => void;
  notify: (msg: string, type?: string) => void;
}

export default function AdminPortal({ adminEmail, onClose, onViewUser, notify }: Props) {
  const [cache, setCache] = useState<AdminCache | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [portalToken, setPortalToken] = useState('');
  const adminFolderIdRef = useRef('');
  const tokenClientRef = useRef<any>(null);
  const pendingResolveRef = useRef<((t: string | null) => void) | null>(null);
  const refreshRef = useRef<((t?: string) => void) | null>(null);
  const autoRefreshedRef = useRef(false);

  // ── 포털 뷰 설정(숨김 사용자 · 그룹) — admin_portal_config.json에 영속 ──
  const [hiddenEmails, setHiddenEmails] = useState<string[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; members: string[] }[]>([]);
  const [manageMode, setManageMode] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState('');
  const [groupSort, setGroupSort] = useState<Record<string, { key: string; dir: 'asc' | 'desc' }>>({});
  const [editingGroupId, setEditingGroupId] = useState('');   // 이름 변경 중인 그룹
  const [editingGroupName, setEditingGroupName] = useState('');
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState(''); // 삭제 2단계 확인 대기
  const [addToGroupId, setAddToGroupId] = useState('');        // '기존 그룹에 추가' 선택값
  const configSaveTimerRef = useRef<any>(null);
  const confirmDeleteTimerRef = useRef<any>(null);
  const configLoadedRef = useRef(false);   // Drive에서 설정을 1회 로드(또는 부재 확인)하기 전엔 저장 금지
  const hiddenSet = useMemo(() => new Set(hiddenEmails), [hiddenEmails]);

  // Drive 설정 1회 로드 — 토큰을 먼저 얻은 경로(마운트/수동 새로고침)에서 호출.
  // 로드 전엔 persistConfig가 저장을 막아 빈 상태로 실제 설정을 덮어쓰는 데이터 손실 방지.
  const loadConfigOnce = async (token: string, fid: string) => {
    if (configLoadedRef.current) return;
    const config = await loadAdminPortalConfig(token, fid).catch(() => null) as any;
    if (config && typeof config === 'object') {
      if (Array.isArray(config.hiddenEmails)) setHiddenEmails(config.hiddenEmails.filter((e: any) => typeof e === 'string'));
      if (Array.isArray(config.groups)) {
        setGroups(config.groups
          .filter((g: any) => g && g.id && typeof g.name === 'string')
          .map((g: any) => ({ id: String(g.id), name: g.name, members: Array.isArray(g.members) ? [...new Set(g.members.filter((m: any) => typeof m === 'string'))] : [] })));
      }
    }
    configLoadedRef.current = true;  // 파일 부재(config===null)여도 로드 완료로 표시 → 신규 포털도 저장 가능
  };

  // 설정 영속화 — 다음 값을 인자로 받아 stale closure 방지, ~800ms 디바운스.
  // 로드 완료 + 토큰/폴더가 있을 때만 기록(없으면 메모리 유지), 디바운스 중엔 토큰 재요청 금지.
  const persistConfig = (nextHidden: string[], nextGroups: { id: string; name: string; members: string[] }[]) => {
    if (configSaveTimerRef.current) clearTimeout(configSaveTimerRef.current);
    configSaveTimerRef.current = setTimeout(async () => {
      if (!configLoadedRef.current) return;   // 로드 전 저장 금지 — Drive 설정 보호
      const tok = portalToken;
      const fid = adminFolderIdRef.current;
      if (!tok || !fid) return;
      try {
        await saveAdminPortalConfig(tok, fid, { hiddenEmails: nextHidden, groups: nextGroups, savedAt: Date.now() });
      } catch {
        notify('설정 저장 실패', 'warning');
      }
    }, 800);
  };

  const hideUser = (email: string) => {
    const next = hiddenEmails.includes(email) ? hiddenEmails : [...hiddenEmails, email];
    setHiddenEmails(next);
    setSelectedEmails(prev => { const n = new Set(prev); n.delete(email); return n; });
    persistConfig(next, groups);
  };
  const restoreUser = (email: string) => {
    const next = hiddenEmails.filter(e => e !== email);
    setHiddenEmails(next);
    persistConfig(next, groups);
  };

  const toggleSelect = (email: string) => {
    setSelectedEmails(prev => { const n = new Set(prev); n.has(email) ? n.delete(email) : n.add(email); return n; });
  };

  const createGroup = () => {
    const name = newGroupName.trim();
    if (!name) { notify('그룹 이름을 입력하세요.', 'warning'); return; }
    if (selectedEmails.size === 0) { notify('그룹에 넣을 사용자를 선택하세요.', 'warning'); return; }
    if (groups.some(g => g.name === name)) { notify('같은 이름의 그룹이 이미 있습니다.', 'warning'); return; }
    const next = [...groups, { id: generateId(), name, members: [...selectedEmails] }];
    setGroups(next);
    setNewGroupName('');
    setSelectedEmails(new Set());
    persistConfig(hiddenEmails, next);
    notify(`'${name}' 그룹 생성 (${[...selectedEmails].length}명)`, 'success');
  };
  const addToGroup = (groupId: string) => {
    if (!groupId) { notify('추가할 그룹을 선택하세요.', 'warning'); return; }
    if (!groups.some(g => g.id === groupId)) { setAddToGroupId(''); notify('선택한 그룹이 더 이상 존재하지 않습니다.', 'warning'); return; }
    if (selectedEmails.size === 0) { notify('추가할 사용자를 선택하세요.', 'warning'); return; }
    let added = 0;
    const next = groups.map(g => {
      if (g.id !== groupId) return g;
      const set = new Set(g.members);
      selectedEmails.forEach(e => { if (!set.has(e)) added++; set.add(e); });
      return { ...g, members: [...set] };
    });
    setGroups(next);
    setSelectedEmails(new Set());
    persistConfig(hiddenEmails, next);
    const gName = groups.find(g => g.id === groupId)?.name || '';
    notify(added > 0 ? `'${gName}'에 ${added}명 추가` : '이미 모두 포함된 사용자입니다.', added > 0 ? 'success' : 'info');
  };
  const removeMember = (groupId: string, email: string) => {
    const next = groups.map(g => g.id === groupId ? { ...g, members: g.members.filter(e => e !== email) } : g);
    setGroups(next);
    persistConfig(hiddenEmails, next);
  };
  const renameGroup = (groupId: string) => {
    const name = editingGroupName.trim();
    if (!name) { notify('그룹 이름을 입력하세요.', 'warning'); return; }
    if (groups.some(g => g.id !== groupId && g.name === name)) { notify('같은 이름의 그룹이 이미 있습니다.', 'warning'); return; }
    const next = groups.map(g => g.id === groupId ? { ...g, name } : g);
    setGroups(next);
    setEditingGroupId('');
    setEditingGroupName('');
    persistConfig(hiddenEmails, next);
  };
  const requestDeleteGroup = (groupId: string) => {
    if (confirmDeleteGroupId === groupId) {
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
      setConfirmDeleteGroupId('');
      const gName = groups.find(g => g.id === groupId)?.name || '';
      const next = groups.filter(g => g.id !== groupId);
      setGroups(next);
      setGroupSort(prev => { const n = { ...prev }; delete n[groupId]; return n; });
      if (addToGroupId === groupId) setAddToGroupId('');
      persistConfig(hiddenEmails, next);
      notify(`'${gName}' 그룹 삭제`, 'success');
    } else {
      setConfirmDeleteGroupId(groupId);
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
      confirmDeleteTimerRef.current = setTimeout(() => setConfirmDeleteGroupId(''), 3000);
    }
  };

  const toggleGroupSort = (groupId: string, key: string) => {
    setGroupSort(prev => {
      const cur = prev[groupId];
      if (cur && cur.key === key) return { ...prev, [groupId]: { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } };
      return { ...prev, [groupId]: { key, dir: 'desc' } };
    });
  };

  const initTokenClient = () => {
    if (!(window as any).google?.accounts?.oauth2) return;
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive',
      hint: adminEmail,
      callback: (resp: any) => {
        const token = resp.error ? null : resp.access_token;
        if (token) setPortalToken(token);
        if (pendingResolveRef.current) {
          pendingResolveRef.current(token);
          pendingResolveRef.current = null;
        }
      },
    });
    tokenClientRef.current = client;
  };

  const requestToken = (prompt = ''): Promise<string | null> =>
    new Promise((resolve) => {
      if (!tokenClientRef.current) { resolve(null); return; }
      pendingResolveRef.current = resolve;
      tokenClientRef.current.requestAccessToken({ prompt });
    });

  const ensureAdminFolder = async (token: string) => {
    if (adminFolderIdRef.current) return adminFolderIdRef.current;
    const id = await getOrCreateAdminFolder(token);
    adminFolderIdRef.current = id;
    return id;
  };

  const handleRefresh = async (providedToken?: string) => {
    setLoading(true);
    try {
      let tok = providedToken || portalToken;
      if (!tok) {
        tok = await requestToken('');
        if (!tok) {
          notify('Drive 인증 팝업을 확인해 주세요...', 'info');
          tok = await requestToken('select_account');
        }
        if (!tok) { notify('Drive 인증에 실패했습니다.', 'error'); return; }
      }
      if (tok && tok !== portalToken) setPortalToken(tok);

      const folderId = await ensureAdminFolder(tok);
      await loadConfigOnce(tok, folderId);   // 무음 토큰 실패로 마운트 로드를 건너뛴 경우에도 여기서 하이드레이트
      const existingCache = await loadAdminUserCache(tok, folderId) as AdminCache | null;
      const approved = await fetchApprovedUsers();
      const today = todayKST();

      // 공용 시장지표(USD/KRW, 국내금) 1회 조회
      setProgress('시장 지표 조회 중...');
      const [liveFxObj, liveGoldObj] = await Promise.all([fetchLiveUsdKrw(), fetchLiveGoldKr()]);

      const priceCache = new Map<string, LiveQuote>();
      const refreshedAt = Date.now();
      const users: Record<string, UserStat> = {};

      // 승인 순서대로 자리 표시자 시드(기존 캐시 값 유지 → 갱신 전까지 직전 값 노출)
      approved.forEach((u) => {
        const prev = existingCache?.users?.[u.email];
        users[u.email] = prev
          ? { ...prev, pending: true }
          : {
              email: u.email, name: u.name || u.email.split('@')[0],
              accessCount: 0, firstAt: null, lastAt: null,
              evalTotal: 0, principal: 0, totalReturnRate: 0,
              prevEvalTotal: 0, prevDate: '', dailyReturnRate: 0, dodAbsChange: 0,
              series: {}, cachedAt: 0, fetchFailed: false, adminAllowed: true, pending: true,
            };
      });
      setCache({ users: { ...users }, refreshedAt });

      // 사용자별 순차 처리 → 완료될 때마다 화면 갱신(순서대로 표시)
      let idx = 0;
      for (const u of approved) {
        idx++;
        setProgress(`사용자 자산 조회 중... (${idx}/${approved.length}) ${u.name || u.email}`);
        try {
          const userFolderId = await findUserIndexFolder(tok, u.email);
          if (!userFolderId) throw new Error('no folder');
          const stateData = await loadDriveFile(tok, userFolderId, DRIVE_FILES.STATE) as any;
          if (!stateData) throw new Error('no state');
          // TEST 계좌(p.isTest)는 사용자 통합 대시보드와 동일하게 모든 합산에서 제외
          // (평가총액·투자원금·전일대비·일별 추이 매트릭스 전부 portfolios에서 파생되므로 소스에서 1회 필터)
          const portfolios = (stateData.portfolios || []).filter((p: any) => !p.isTest);
          const ihm = stateData.indicatorHistoryMap || {};

          // 이 사용자 보유종목 시세 사전 조회(캐시 dedup → 중복 종목 1회만 호출)
          const needs: Array<['kr' | 'us' | 'fund', string]> = [];
          portfolios.forEach((p: any) => {
            const at = p.accountType || 'portfolio';
            if (at === 'simple' || at === 'matong') return;
            const isOverseas = at === 'overseas';
            (p.portfolio || []).forEach((item: any) => {
              if (!item.code) return;
              if (item.type === 'stock') needs.push([isOverseas ? 'us' : 'kr', item.code]);
              else if (item.type === 'fund') needs.push(['fund', item.code]);
            });
          });
          await Promise.all(needs.map(([k, c]) => getLivePrice(priceCache, k, c)));

          let evalTotal = 0, prevEvalTotal = 0;
          portfolios.forEach((p: any) => {
            const { live, prev } = recomputePortfolioEval(p, priceCache, liveFxObj, liveGoldObj, ihm, today);
            evalTotal += live; prevEvalTotal += prev;
          });
          const principal = computePrincipal(portfolios);
          const totalReturnRate = principal > 0 ? ((evalTotal - principal) / principal) * 100 : 0;

          // 전일대비: 보유종목의 전일 종가로 재계산한 직전 거래일 평가액(prevEvalTotal) 기준 →
          // 사용자 통합 대시보드 '오늘 수익'과 동일(저장 이력·새로고침 시점에 의존하지 않음).
          const series = buildUserSeries(portfolios, evalTotal, today);   // 일별 비교 매트릭스용
          const prevDate = Object.keys(series).filter(d => d < today).sort().pop() || '';
          const dailyReturnRate = prevEvalTotal > 0 ? ((evalTotal - prevEvalTotal) / prevEvalTotal) * 100 : 0;
          const dodAbsChange = prevEvalTotal > 0 ? (evalTotal - prevEvalTotal) : 0;

          users[u.email] = {
            email: u.email,
            name: u.name || u.email.split('@')[0],
            accessCount: stateData.accessLog?.count || 0,
            firstAt: stateData.accessLog?.firstAt || null,
            lastAt: stateData.accessLog?.lastAt || null,
            evalTotal, principal, totalReturnRate,
            prevEvalTotal, prevDate, dailyReturnRate, dodAbsChange,
            series,
            cachedAt: Date.now(),
            fetchFailed: false,
            adminAllowed: stateData.adminAccessAllowed !== false,
            pending: false,
          };
        } catch {
          const prev = existingCache?.users?.[u.email];
          users[u.email] = prev
            ? { ...prev, fetchFailed: true, pending: false, adminAllowed: prev.adminAllowed ?? false }
            : {
                email: u.email, name: u.name || u.email.split('@')[0],
                accessCount: 0, firstAt: null, lastAt: null,
                evalTotal: 0, principal: 0, totalReturnRate: 0,
                prevEvalTotal: 0, prevDate: '', dailyReturnRate: 0, dodAbsChange: 0,
                series: {}, cachedAt: 0, fetchFailed: true, adminAllowed: false, pending: false,
              };
        }
        setCache({ users: { ...users }, refreshedAt });
      }

      const finalCache: AdminCache = { users, refreshedAt: Date.now() };
      await saveAdminUserCache(tok, folderId, finalCache);
      setCache(finalCache);
      notify('대시보드 업데이트 완료', 'success');
    } catch (err) {
      notify('데이터 로드에 실패했습니다.', 'error');
      console.error('[AdminPortal]', err);
    } finally {
      setLoading(false);
      setProgress('');
    }
  };
  refreshRef.current = handleRefresh;

  // 마운트 시 GIS 초기화 → 무음 토큰 → 캐시 로드 → 자동 새로고침(수정1)
  useEffect(() => {
    const trySetup = (retries = 12) => {
      if ((window as any).google?.accounts?.oauth2) {
        initTokenClient();
        requestToken('').then(async (token) => {
          if (!token) return;
          try {
            const fid = await ensureAdminFolder(token);
            const [cached] = await Promise.all([
              loadAdminUserCache(token, fid) as Promise<AdminCache | null>,
              loadConfigOnce(token, fid),
            ]);
            if (cached?.users) setCache(cached);
          } catch {}
          // 접속과 동시에 자동 새로고침
          if (!autoRefreshedRef.current) {
            autoRefreshedRef.current = true;
            refreshRef.current?.(token);
          }
        });
      } else if (retries > 0) {
        setTimeout(() => trySetup(retries - 1), 300);
      }
    };
    trySetup();
  }, []);

  const today = todayKST();
  const userStats: UserStat[] = useMemo(() => (cache ? Object.values(cache.users) : []), [cache]);
  // 숨김 사용자는 복원 영역 외 모든 표시·합산에서 제외 — 단일 파생값으로 통일
  const visibleStats = useMemo(() => userStats.filter(u => !hiddenSet.has(u.email)), [userStats, hiddenSet]);
  // 캐시에 없는 숨김 이메일도 폴백 칩으로 노출 → '추가' 복원 경로 보존(승인 시트 제거 등으로 고아 방지)
  const hiddenStats = useMemo(
    () => hiddenEmails.map(e => cache?.users?.[e] || ({ email: e, name: e.split('@')[0] } as UserStat)),
    [hiddenEmails, cache]
  );
  const table2Stats = [...visibleStats]
    .filter(u => !u.fetchFailed && u.evalTotal > 0)
    .sort((a, b) => b.evalTotal - a.evalTotal);

  const totalEval = visibleStats.filter(u => !u.fetchFailed).reduce((s, u) => s + u.evalTotal, 0);
  const refreshedTime = cache?.refreshedAt
    ? new Date(cache.refreshedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  // 수정3 — 통합 비교 매트릭스: 행=일자(최신순), 열=사용자별 일별 총 평가금액·전일대비
  const matrix = useMemo(() => {
    const us = visibleStats.filter(u => !u.fetchFailed && u.series && Object.keys(u.series).length > 0);
    if (!us.length) return null;
    const ds = new Set<string>();
    us.forEach(u => Object.keys(u.series).forEach(d => ds.add(d)));
    const datesAsc = [...ds].sort();
    if (!datesAsc.length) return null;
    // 사용자별 전 일자 carry-forward 값 배열(datesAsc와 동일 인덱스)
    const perUser = us.map(u => {
      const keys = Object.keys(u.series).sort();
      let i = 0, last = 0;
      const cf: number[] = [];
      for (const d of datesAsc) {
        while (i < keys.length && keys[i] <= d) { last = Number(u.series[keys[i]]) || 0; i++; }
        cf.push(last);
      }
      return { name: u.name, email: u.email, cf };
    });
    // 전체 합계(사용자 carry-forward 합) 시계열
    const totalCf = datesAsc.map((_, di) => perUser.reduce((s, u) => s + (u.cf[di] > 0 ? u.cf[di] : 0), 0));
    return { datesAsc, perUser, totalCf };
  }, [visibleStats]);

  // 매트릭스 셀: 평가금액 + (전일대비% · 수익)
  const renderMatrixCell = (val: number, prev: number) => {
    if (!(val > 0)) return <span className="text-gray-700">-</span>;
    const hasPrev = prev > 0;
    const dod = hasPrev ? ((val / prev) - 1) * 100 : null;
    const abs = hasPrev ? (val - prev) : null;
    return (
      <div className="leading-tight">
        <div className="font-bold text-gray-100">{fmtAmount(val)}</div>
        <div className="text-[10px]">
          {dod != null ? fmtReturnEl(dod) : <span className="text-gray-600">-</span>}
          {abs != null && Math.abs(abs) >= 1 && <span className="text-gray-600"> · </span>}
          {abs != null && Math.abs(abs) >= 1 && fmtSignedAmount(abs)}
        </div>
      </div>
    );
  };

  // ── 공용 사용자 테이블 헤더/행 (Table 1 · 그룹 섹션 공유) ──
  const renderUserTableHead = (sortable: boolean, groupId?: string) => {
    const sort = sortable && groupId ? groupSort[groupId] : null;
    const th = (key: string, label: string) => sortable
      ? (
        <th
          onClick={() => groupId && toggleGroupSort(groupId, key)}
          className={`text-right px-4 py-2.5 font-medium whitespace-nowrap cursor-pointer select-none hover:text-gray-300 ${sort?.key === key ? 'text-violet-300' : 'text-gray-500'}`}
        >
          {label}
          {sort?.key === key && (sort.dir === 'asc' ? <ArrowUp size={10} className="inline ml-0.5" /> : <ArrowDown size={10} className="inline ml-0.5" />)}
        </th>
      )
      : <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">{label}</th>;
    return (
      <thead>
        <tr className="border-b border-gray-800">
          <th className="px-2 py-2.5 w-8"></th>
          <th className="text-left px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">이름 / 이메일</th>
          {th('firstAt', '사용일')}
          {th('evalTotal', '평가총액')}
          {th('totalReturnRate', '총수익율')}
          {th('principal', '투자원금')}
          {th('dailyReturnRate', '전일대비')}
          <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">접속횟수</th>
          <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">최근접속</th>
          <th className="px-4 py-2.5"></th>
        </tr>
      </thead>
    );
  };

  const renderUserRow = (u: UserStat, opts: { showCheckbox?: boolean; showHide?: boolean; onRemove?: (email: string) => void } = {}) => {
    const { showCheckbox, showHide, onRemove } = opts;
    const admin = isAdminEmail(u.email);
    return (
      <tr key={u.email} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
        <td className="px-2 py-3 text-center">
          {showCheckbox ? (
            <input
              type="checkbox"
              checked={selectedEmails.has(u.email)}
              onChange={() => toggleSelect(u.email)}
              className="accent-violet-500 cursor-pointer align-middle"
            />
          ) : onRemove ? (
            <button onClick={() => onRemove(u.email)} title="그룹에서 제거" className="text-gray-600 hover:text-red-400 transition-colors align-middle">
              <X size={13} />
            </button>
          ) : null}
        </td>
        <td className={`px-4 py-3 ${u.fetchFailed ? 'opacity-40' : ''}`}>
          <div className="flex items-center gap-1.5">
            {showHide && (
              <button onClick={() => hideUser(u.email)} title="숨기기" className="text-gray-600 hover:text-amber-400 transition-colors flex-shrink-0">
                <EyeOff size={12} />
              </button>
            )}
            {u.pending && <RefreshCw size={11} className="text-violet-400 flex-shrink-0 animate-spin" />}
            {u.fetchFailed && <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />}
            <div>
              <div className="font-medium text-gray-200 leading-tight flex items-center gap-1">
                {u.name}
                {admin && <span className="text-[9px] px-1 py-0.5 rounded bg-violet-900/60 text-violet-300 border border-violet-700/40">관리자</span>}
              </div>
              <div className="text-gray-600 text-[10px]">{u.email}</div>
            </div>
          </div>
        </td>
        <td className={`px-4 py-3 text-right text-gray-400 ${u.fetchFailed ? 'opacity-40' : ''}`}>{fmtDays(u.firstAt)}</td>
        <td className={`px-4 py-3 text-right font-medium text-gray-100 ${u.fetchFailed ? 'opacity-40' : ''}`}>{u.pending ? <span className="text-gray-600">조회 중</span> : fmtAmount(u.evalTotal)}</td>
        <td className={`px-4 py-3 text-right ${u.fetchFailed ? 'opacity-40' : ''}`}>{fmtReturnEl(u.totalReturnRate)}</td>
        <td className={`px-4 py-3 text-right text-gray-500 ${u.fetchFailed ? 'opacity-40' : ''}`}>{fmtAmount(u.principal)}</td>
        <td className={`px-4 py-3 text-right ${u.fetchFailed ? 'opacity-40' : ''}`}>
          <div className="leading-tight">
            {fmtReturnEl(u.dailyReturnRate)}
            {!!u.dodAbsChange && Math.abs(u.dodAbsChange) >= 1 && (
              <div className="text-[10px]">{fmtSignedAmount(u.dodAbsChange)}</div>
            )}
          </div>
        </td>
        <td className={`px-4 py-3 text-right text-gray-400 ${u.fetchFailed ? 'opacity-40' : ''}`}>{u.accessCount > 0 ? `${u.accessCount}회` : '-'}</td>
        <td className={`px-4 py-3 text-right text-gray-500 whitespace-nowrap text-[11px] ${u.fetchFailed ? 'opacity-40' : ''}`}>{fmtRelTime(u.lastAt)}</td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={() => onViewUser(u.email)}
            className={`text-[11px] px-2.5 py-1 rounded-full transition-colors whitespace-nowrap border ${
              u.adminAllowed
                ? 'bg-emerald-900/50 hover:bg-emerald-800/70 text-emerald-300 border-emerald-700/40'
                : 'bg-amber-900/50 hover:bg-amber-800/70 text-amber-300 border-amber-700/40'
            }`}
          >
            접속
          </button>
        </td>
      </tr>
    );
  };

  // ── 그룹 멤버 산출(현재 캐시 기준 + 숨김 제외) / 정렬 ──
  const isEmptyVal = (v: any, key: string) =>
    v == null || Number.isNaN(v) || ((key === 'evalTotal' || key === 'principal' || key === 'firstAt') && v === 0);
  const sortMembers = (members: UserStat[], sort?: { key: string; dir: 'asc' | 'desc' }) => {
    if (!sort) return members;
    const { key, dir } = sort;
    return [...members].sort((a: any, b: any) => {
      if (a.fetchFailed && b.fetchFailed) return 0;
      if (a.fetchFailed) return 1;
      if (b.fetchFailed) return -1;
      const av = a[key], bv = b[key];
      const ae = isEmptyVal(av, key), be = isEmptyVal(bv, key);
      if (ae && be) return 0;
      if (ae) return 1;
      if (be) return -1;
      // firstAt: 표시값(사용일=경과일)은 timestamp와 역방향 → 표시 기준으로 정렬해 화살표와 일치
      const base = key === 'firstAt' ? bv - av : av - bv;
      return dir === 'asc' ? base : -base;
    });
  };
  const groupMembersOf = (group: { members: string[] }) =>
    group.members
      .map(e => cache?.users?.[e])
      .filter(Boolean)
      .filter((u: any) => !hiddenSet.has(u.email)) as UserStat[];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
          >
            <ChevronLeft size={18} />
          </button>
          <div>
            <h1 className="text-sm font-bold text-white">관리자 포털</h1>
            {loading && progress
              ? <p className="text-violet-300 text-[11px]">{progress}</p>
              : refreshedTime
              ? <p className="text-gray-600 text-[11px]">갱신: {refreshedTime} · {visibleStats.length}명 · 총 {fmtAmount(totalEval)}</p>
              : <p className="text-gray-600 text-[11px]">데이터를 불러오는 중...</p>
            }
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setManageMode(m => !m); setSelectedEmails(new Set()); }}
            className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg transition-colors border ${
              manageMode
                ? 'bg-violet-600 hover:bg-violet-500 text-white border-violet-500'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700'
            }`}
          >
            <Users size={13} />
            {manageMode ? '완료' : '그룹 관리'}
          </button>
          <button
            onClick={() => handleRefresh()}
            disabled={loading}
            className="flex items-center gap-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? '로딩 중...' : '새로고침'}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-6 max-w-[1440px] mx-auto">

        {/* Table 1 — 사용자 현황 (실시간 시세 재계산) */}
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">사용자 현황 · 실시간 시세</p>

          {/* 그룹 관리 툴바 — 선택 → 이름 입력 → 그룹 만들기 / 기존 그룹에 추가 */}
          {manageMode && (
            <div className="mb-2 bg-gray-900 border border-violet-800/40 rounded-xl px-3 py-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-violet-300 font-semibold">선택 {selectedEmails.size}명</span>
              <div className="h-4 w-px bg-gray-700 mx-1" />
              <input
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createGroup(); }}
                placeholder="새 그룹 이름"
                className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500 w-32"
              />
              <button onClick={createGroup} className="flex items-center gap-1 bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-semibold px-2.5 py-1 rounded transition-colors">
                <Plus size={12} /> 그룹 만들기
              </button>
              {groups.length > 0 && (
                <>
                  <div className="h-4 w-px bg-gray-700 mx-1" />
                  <select
                    value={addToGroupId}
                    onChange={e => setAddToGroupId(e.target.value)}
                    className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-violet-500"
                  >
                    <option value="">기존 그룹 선택…</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button onClick={() => addToGroup(addToGroupId)} className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-[11px] font-semibold px-2.5 py-1 rounded transition-colors border border-gray-700">
                    기존 그룹에 추가
                  </button>
                </>
              )}
              {selectedEmails.size > 0 && (
                <button onClick={() => setSelectedEmails(new Set())} className="text-[11px] text-gray-500 hover:text-gray-300 px-1">선택 해제</button>
              )}
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                {renderUserTableHead(false)}
                <tbody>
                  {visibleStats.length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center py-14 text-gray-700 text-sm">
                        {userStats.length === 0 ? '데이터를 불러오는 중...' : '표시할 사용자가 없습니다.'}
                      </td>
                    </tr>
                  )}
                  {visibleStats.map(u => renderUserRow(u, { showCheckbox: manageMode, showHide: true }))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 숨김 사용자 — '추가'로 복원 */}
          {hiddenStats.length > 0 && (
            <div className="mt-2 bg-gray-900/60 border border-gray-800 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-2 text-[11px] text-gray-500">
                <EyeOff size={12} /> 숨김 사용자 {hiddenStats.length}명
              </div>
              <div className="flex flex-wrap gap-2">
                {hiddenStats.map(u => (
                  <div key={u.email} className="flex items-center gap-2 bg-gray-950 border border-gray-700 rounded-full pl-3 pr-1 py-1">
                    <span className="text-[11px] text-gray-400">{u.name}<span className="text-gray-600 ml-1">{u.email.split('@')[0]}</span></span>
                    <button
                      onClick={() => restoreUser(u.email)}
                      className="flex items-center gap-0.5 bg-emerald-900/60 hover:bg-emerald-800/70 text-emerald-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-emerald-700/40 transition-colors"
                    >
                      <Plus size={11} /> 추가
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Table 2 — 평가총액 순위 · 전일 대비 */}
        {table2Stats.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">평가총액 순위 · 전일 대비</p>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden" style={{ maxWidth: 620 }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-center px-3 py-2.5 text-gray-500 font-medium w-8">#</th>
                    <th className="text-left px-3 py-2.5 text-gray-500 font-medium">사용자</th>
                    <th className="text-right px-3 py-2.5 text-gray-500 font-medium">평가총액</th>
                    <th className="text-right px-3 py-2.5 text-gray-500 font-medium whitespace-nowrap">전일 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {table2Stats.map((u, i) => (
                    <tr key={u.email} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                      <td className="px-3 py-3 text-center text-gray-600">{i + 1}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-gray-200">{u.name}</div>
                        <div className="text-gray-600 text-[10px]">{u.email.split('@')[0]}</div>
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-gray-100">{fmtAmount(u.evalTotal)}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {u.dailyReturnRate > 0.001
                            ? <TrendingUp size={11} className="text-red-400" />
                            : u.dailyReturnRate < -0.001
                            ? <TrendingDown size={11} className="text-blue-400" />
                            : <Minus size={11} className="text-gray-600" />}
                          {fmtReturnEl(u.dailyReturnRate)}
                        </div>
                        {!!u.dodAbsChange && Math.abs(u.dodAbsChange) >= 1 && (
                          <div className="text-[10px]">{fmtSignedAmount(u.dodAbsChange)}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 그룹 섹션 — 컬럼 헤더 클릭으로 정렬 (그룹 섹션 전용) */}
        {groups.map(group => {
          const members = sortMembers(groupMembersOf(group), groupSort[group.id]);
          const isEditing = editingGroupId === group.id;
          return (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-2">
                {isEditing ? (
                  <>
                    <input
                      value={editingGroupName}
                      onChange={e => setEditingGroupName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') renameGroup(group.id); if (e.key === 'Escape') { setEditingGroupId(''); setEditingGroupName(''); } }}
                      autoFocus
                      className="bg-gray-950 border border-violet-500 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none w-40"
                    />
                    <button onClick={() => renameGroup(group.id)} className="text-emerald-400 hover:text-emerald-300"><Check size={14} /></button>
                    <button onClick={() => { setEditingGroupId(''); setEditingGroupName(''); }} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold text-violet-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Users size={12} /> {group.name}
                      <span className="text-gray-600 normal-case">· {members.length}명</span>
                    </p>
                    {manageMode && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }} title="이름 변경" className="text-gray-600 hover:text-gray-300"><Pencil size={12} /></button>
                        <button
                          onClick={() => requestDeleteGroup(group.id)}
                          title="그룹 삭제"
                          className={`flex items-center gap-1 transition-colors ${confirmDeleteGroupId === group.id ? 'text-red-400 text-[10px] font-semibold' : 'text-gray-600 hover:text-red-400'}`}
                        >
                          <Trash2 size={12} />{confirmDeleteGroupId === group.id && '삭제 확인?'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    {renderUserTableHead(true, group.id)}
                    <tbody>
                      {members.length === 0 && (
                        <tr>
                          <td colSpan={10} className="text-center py-8 text-gray-700 text-sm">
                            {group.members.length === 0 ? '멤버가 없습니다. 위 사용자 현황에서 선택해 추가하세요.' : '표시할 멤버가 없습니다 (숨김).'}
                          </td>
                        </tr>
                      )}
                      {members.map(u => renderUserRow(u, { showHide: false, onRemove: manageMode ? (email) => removeMember(group.id, email) : undefined }))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}

        {/* Table 3 — 사용자별 일자별 평가액 추이 (통합 비교 매트릭스, 수정3) */}
        {matrix && (
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">📅 일자별 평가액 추이 · 사용자 비교</p>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-auto max-h-[520px]">
                <table className="text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-800 text-gray-400 border-b border-gray-700">
                      <th className="text-center px-3 py-2.5 font-medium whitespace-nowrap sticky left-0 bg-gray-800 z-20 border-r border-gray-700">일자</th>
                      <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap border-r border-gray-700 bg-gray-800/80">
                        <div className="text-gray-300">전체 합계</div>
                      </th>
                      {matrix.perUser.map(u => (
                        <th key={u.email} className="text-right px-3 py-2.5 font-medium whitespace-nowrap border-r border-gray-700/50 min-w-[120px]">
                          <div className="text-gray-300 leading-tight">{u.name}</div>
                          <div className="text-gray-600 text-[10px] font-normal">{u.email.split('@')[0]}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...matrix.datesAsc].map((d, di) => ({ d, di }))
                      .reverse()
                      .slice(0, 120)
                      .map(({ d, di }) => {
                        const isToday = d === today;
                        const prevIdx = di - 1;
                        return (
                          <tr key={d} className={`border-b border-gray-800/50 ${isToday ? 'bg-blue-900/20' : 'hover:bg-gray-800/20'}`}>
                            <td className={`text-center px-3 py-2 font-bold text-gray-400 whitespace-nowrap sticky left-0 z-10 border-r border-gray-700 ${isToday ? 'bg-[#16223a]' : 'bg-gray-900'}`}>{formatShortDate(d)}</td>
                            <td className="text-right px-3 py-2 border-r border-gray-700 bg-gray-900/40">
                              {renderMatrixCell(matrix.totalCf[di], prevIdx >= 0 ? matrix.totalCf[prevIdx] : 0)}
                            </td>
                            {matrix.perUser.map(u => (
                              <td key={u.email} className="text-right px-3 py-2 border-r border-gray-700/50">
                                {renderMatrixCell(u.cf[di], prevIdx >= 0 ? u.cf[prevIdx] : 0)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-gray-600 text-[10px] mt-1.5">※ 오늘 행은 실시간 시세로 재계산한 값이며, 과거는 각 사용자가 기록한 일별 종가입니다. 전일대비·수익은 각 사용자 시계열의 직전 기록 대비입니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
