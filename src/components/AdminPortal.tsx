// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, ChevronLeft, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { APPS_SCRIPT_URL, GOOGLE_CLIENT_ID, ADMIN_EMAIL } from '../config';
import {
  findUserIndexFolder, loadDriveFile, DRIVE_FILES,
  getOrCreateAdminFolder, saveAdminUserCache, loadAdminUserCache,
} from '../driveStorage';
import { cleanNum, calcPortfolioEvalDetail, formatShortDate } from '../utils';
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

async function fetchLiveUsdKrw(): Promise<number> {
  const targetUrl = 'https://m.stock.naver.com/api/marketIndex/exchange/FX_USDKRW';
  for (const proxy of PROXIES(targetUrl)) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
      if (price > 0) return price;
    } catch { /* try next proxy */ }
  }
  return 0;
}

async function fetchLiveGoldKr(): Promise<number> {
  const targetUrl = 'https://finance.naver.com/marketindex/goldDetail.naver';
  for (const proxy of PROXIES(targetUrl)) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const html = await res.text();
      const m = html.match(/var DEAL_VAL\s*=\s*([\d.]+)/);
      if (m) { const price = parseFloat(m[1]); if (price > 0) return price; }
    } catch { /* try next proxy */ }
  }
  return 0;
}

// 종목 시세 dedup 캐시 (kind:code → price>0, 실패 시 0). 모든 사용자 간 공유 → 중복 조회 방지.
async function getLivePrice(cache: Map<string, number>, kind: 'kr' | 'us' | 'fund', code: string): Promise<number> {
  const key = `${kind}:${code}`;
  if (cache.has(key)) return cache.get(key)!;
  let price = 0;
  try {
    let d: any = null;
    if (kind === 'kr') d = await fetchStockInfo(code);
    else if (kind === 'us') d = await fetchUsStockInfo(code);
    else if (kind === 'fund') d = code.startsWith('MA:') ? await fetchMiraeFundInfo(code) : await fetchFundInfo(code);
    if (d && Number(d.price) > 0) price = Number(d.price);
  } catch { /* fail → 0 */ }
  cache.set(key, price);
  return price;
}

// 한 계좌의 실시간 평가액 산출. 시세 캐시는 사전 채움(prefetch) 완료 가정 → 동기 계산.
// 실시간 시세 우선, 미조회분은 저장된 currentPrice, 전체 실패 시 마지막 기록 평가액으로 폴백.
function recomputePortfolioEval(
  p: any,
  cache: Map<string, number>,
  liveFx: number,
  liveGold: number,
  ihm: any,
  today: string,
): number {
  const at = p.accountType || 'portfolio';
  if (at === 'simple') return cleanNum(p.evalAmount);
  if (at === 'matong') {
    return Math.max(0, cleanNum(p.withdrawableTotal) - (cleanNum(p.currentWithdrawal) + cleanNum(p.withdrawalLimit)));
  }
  const items = p.portfolio || [];
  const isOverseas = at === 'overseas';
  const synthMap: Record<string, Record<string, number>> = {};
  items.forEach((item: any) => {
    if (!item.code) return;
    let px = 0;
    if (item.type === 'stock') px = (cache.get(`${isOverseas ? 'us' : 'kr'}:${item.code}`) || 0) || cleanNum(item.currentPrice);
    else if (item.type === 'fund') px = (cache.get(`fund:${item.code}`) || 0) || cleanNum(item.currentPrice);
    else return;
    if (px > 0) synthMap[item.code] = { [today]: px };
  });
  const fx = isOverseas ? (liveFx || cleanNum(p.avgExchangeRate) || latestOf(ihm?.usdkrw) || 1) : 1;
  const gold = liveGold || latestOf(ihm?.goldKr) || 0;
  const indicatorMap = { usdkrw: { [today]: fx }, goldKr: gold > 0 ? { [today]: gold } : {} };
  const r = calcPortfolioEvalDetail(items, at, today, synthMap, indicatorMap, fx, p.manualPriceOverrides || null);
  if (r.hasAnyPrice && r.total > 0) return r.total;
  const lh = lastHistEval(p);
  return lh > 0 ? lh : (r.total || 0);
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
    return (data.users || []).filter(
      (u: any) => u.email && u.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()
    );
  } catch {
    return [];
  }
}

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
      const existingCache = await loadAdminUserCache(tok, folderId) as AdminCache | null;
      const approved = await fetchApprovedUsers();
      const today = todayKST();

      // 공용 시장지표(USD/KRW, 국내금) 1회 조회
      setProgress('시장 지표 조회 중...');
      const [liveFx, liveGold] = await Promise.all([fetchLiveUsdKrw(), fetchLiveGoldKr()]);

      const priceCache = new Map<string, number>();
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

          let evalTotal = 0;
          portfolios.forEach((p: any) => {
            evalTotal += recomputePortfolioEval(p, priceCache, liveFx, liveGold, ihm, today);
          });
          const principal = computePrincipal(portfolios);
          const totalReturnRate = principal > 0 ? ((evalTotal - principal) / principal) * 100 : 0;

          const series = buildUserSeries(portfolios, evalTotal, today);
          // 전일 대비: 사용자 자체 시계열의 '오늘 직전' 기록값 기준 → 1회 새로고침만으로 산출
          const prevDate = Object.keys(series).filter(d => d < today).sort().pop() || '';
          const prevClose = prevDate ? Number(series[prevDate]) : 0;
          const dailyReturnRate = prevClose > 0 ? ((evalTotal - prevClose) / prevClose) * 100 : 0;
          const dodAbsChange = prevClose > 0 ? (evalTotal - prevClose) : 0;

          users[u.email] = {
            email: u.email,
            name: u.name || u.email.split('@')[0],
            accessCount: stateData.accessLog?.count || 0,
            firstAt: stateData.accessLog?.firstAt || null,
            lastAt: stateData.accessLog?.lastAt || null,
            evalTotal, principal, totalReturnRate,
            prevEvalTotal: prevClose, prevDate, dailyReturnRate, dodAbsChange,
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
            const cached = await loadAdminUserCache(token, fid) as AdminCache | null;
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
  const userStats: UserStat[] = cache ? Object.values(cache.users) : [];
  const table2Stats = [...userStats]
    .filter(u => !u.fetchFailed && u.evalTotal > 0)
    .sort((a, b) => b.evalTotal - a.evalTotal);

  const totalEval = userStats.filter(u => !u.fetchFailed).reduce((s, u) => s + u.evalTotal, 0);
  const refreshedTime = cache?.refreshedAt
    ? new Date(cache.refreshedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  // 수정3 — 통합 비교 매트릭스: 행=일자(최신순), 열=사용자별 일별 총 평가금액·전일대비
  const matrix = useMemo(() => {
    const us = userStats.filter(u => !u.fetchFailed && u.series && Object.keys(u.series).length > 0);
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
  }, [userStats]);

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
              ? <p className="text-gray-600 text-[11px]">갱신: {refreshedTime} · {userStats.length}명 · 총 {fmtAmount(totalEval)}</p>
              : <p className="text-gray-600 text-[11px]">데이터를 불러오는 중...</p>
            }
          </div>
        </div>
        <button
          onClick={() => handleRefresh()}
          disabled={loading}
          className="flex items-center gap-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? '로딩 중...' : '새로고침'}
        </button>
      </div>

      <div className="p-4 space-y-6 max-w-[1440px] mx-auto">

        {/* Table 1 — 사용자 현황 (실시간 시세 재계산) */}
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">사용자 현황 · 실시간 시세</p>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">이름 / 이메일</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">사용일</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">평가총액</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">총수익율</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">투자원금</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">전일대비</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">접속횟수</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">최근접속</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {userStats.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-14 text-gray-700 text-sm">
                        데이터를 불러오는 중...
                      </td>
                    </tr>
                  )}
                  {userStats.map((u) => (
                    <tr
                      key={u.email}
                      className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                    >
                      <td className={`px-4 py-3 ${u.fetchFailed ? 'opacity-40' : ''}`}>
                        <div className="flex items-center gap-1.5">
                          {u.pending && <RefreshCw size={11} className="text-violet-400 flex-shrink-0 animate-spin" />}
                          {u.fetchFailed && <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />}
                          <div>
                            <div className="font-medium text-gray-200 leading-tight">{u.name}</div>
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
