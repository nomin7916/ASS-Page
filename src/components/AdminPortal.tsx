// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, ChevronLeft, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { APPS_SCRIPT_URL, GOOGLE_CLIENT_ID, ADMIN_EMAIL } from '../config';
import {
  findUserIndexFolder, loadDriveFile, DRIVE_FILES,
  getOrCreateAdminFolder, saveAdminUserCache, loadAdminUserCache,
} from '../driveStorage';

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
  cachedAt: number;
  fetchFailed: boolean;
}

interface AdminCache {
  users: Record<string, UserStat>;
  refreshedAt: number;
}

function computePortfolioStats(portfolios: any[]): { evalTotal: number; principal: number } {
  let evalTotal = 0;
  let principal = 0;
  for (const p of (portfolios || [])) {
    const isOverseas = p.accountType === 'overseas';
    const avgFx = isOverseas ? (Number(p.avgExchangeRate) || 1) : 1;
    principal += (Number(p.principal) || 0) * avgFx;
    if (p.accountType === 'simple') {
      evalTotal += Number(p.evalAmount) || 0;
    } else {
      // history의 evalAmount는 앱이 올바르게 계산한 KRW 값 — 환율 재계산 불필요
      const history = (p.history || []) as { date: string; evalAmount: number }[];
      const lastEntry = history.length > 0
        ? history.reduce((a, b) => (a.date >= b.date ? a : b))
        : null;
      if (lastEntry && Number(lastEntry.evalAmount) > 0) {
        evalTotal += Number(lastEntry.evalAmount);
      }
    }
  }
  return { evalTotal, principal };
}

const fmtAmount = (n: number) => {
  if (!n || isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${(n / 100000000).toFixed(2)}억`;
  if (abs >= 10000) return `${Math.round(n / 10000).toLocaleString()}만`;
  return n.toLocaleString();
};

const fmtReturnEl = (r: number) => {
  if (!r || isNaN(r)) return <span className="text-gray-600">-</span>;
  const sign = r > 0 ? '+' : '';
  const color = r > 0 ? 'text-emerald-400' : 'text-rose-400';
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
  const [portalToken, setPortalToken] = useState('');
  const adminFolderIdRef = useRef('');
  const tokenClientRef = useRef<any>(null);
  const pendingResolveRef = useRef<((t: string | null) => void) | null>(null);

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

  // 마운트 시 GIS 초기화 → 무음 토큰 요청 → 캐시 로드
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
        });
      } else if (retries > 0) {
        setTimeout(() => trySetup(retries - 1), 300);
      }
    };
    trySetup();
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      let tok = portalToken;
      if (!tok) {
        tok = await requestToken('');
        if (!tok) {
          notify('Drive 인증 팝업을 확인해 주세요...', 'info');
          tok = await requestToken('select_account');
        }
        if (!tok) { notify('Drive 인증에 실패했습니다.', 'error'); return; }
        setPortalToken(tok);
      }

      const folderId = await ensureAdminFolder(tok);
      const existingCache = await loadAdminUserCache(tok, folderId) as AdminCache | null;
      const users = await fetchApprovedUsers();
      const today = new Date().toISOString().slice(0, 10);

      const newCache: AdminCache = {
        users: { ...(existingCache?.users || {}) },
        refreshedAt: Date.now(),
      };

      await Promise.all(users.map(async (u) => {
        try {
          const userFolderId = await findUserIndexFolder(tok, u.email);
          if (!userFolderId) throw new Error('no folder');
          const stateData = await loadDriveFile(tok, userFolderId, DRIVE_FILES.STATE) as any;
          if (!stateData) throw new Error('no state');

          const { evalTotal, principal } = computePortfolioStats(stateData.portfolios || []);
          const totalReturnRate = principal > 0 ? ((evalTotal - principal) / principal) * 100 : 0;

          const prev = existingCache?.users[u.email];
          let prevEvalTotal = evalTotal;
          let dailyReturnRate = 0;

          if (prev && !prev.fetchFailed) {
            if (prev.prevDate === today) {
              // 같은 날 재갱신 — 어제 기준값(prevEvalTotal) 유지
              prevEvalTotal = prev.prevEvalTotal;
            } else {
              // 새 날짜 — 전일 종가(prev.evalTotal)를 기준으로 변동 계산
              prevEvalTotal = prev.evalTotal;
            }
            dailyReturnRate = prevEvalTotal > 0 ? ((evalTotal - prevEvalTotal) / prevEvalTotal) * 100 : 0;
          }

          newCache.users[u.email] = {
            email: u.email,
            name: u.name || u.email.split('@')[0],
            accessCount: stateData.accessLog?.count || 0,
            firstAt: stateData.accessLog?.firstAt || null,
            lastAt: stateData.accessLog?.lastAt || null,
            evalTotal,
            principal,
            totalReturnRate,
            prevEvalTotal,
            prevDate: today,
            dailyReturnRate,
            cachedAt: Date.now(),
            fetchFailed: false,
          };
        } catch {
          const prev = existingCache?.users[u.email];
          newCache.users[u.email] = prev
            ? { ...prev, fetchFailed: true }
            : {
                email: u.email,
                name: u.name || u.email.split('@')[0],
                accessCount: 0, firstAt: null, lastAt: null,
                evalTotal: 0, principal: 0, totalReturnRate: 0,
                prevEvalTotal: 0, prevDate: today, dailyReturnRate: 0,
                cachedAt: 0, fetchFailed: true,
              };
        }
      }));

      await saveAdminUserCache(tok, folderId, newCache);
      setCache(newCache);
      notify('대시보드 업데이트 완료', 'success');
    } catch (err) {
      notify('데이터 로드에 실패했습니다.', 'error');
      console.error('[AdminPortal]', err);
    } finally {
      setLoading(false);
    }
  };

  const userStats: UserStat[] = cache ? Object.values(cache.users) : [];
  const table2Stats = [...userStats]
    .filter(u => !u.fetchFailed && u.evalTotal > 0)
    .sort((a, b) => b.evalTotal - a.evalTotal);

  const totalEval = userStats.filter(u => !u.fetchFailed).reduce((s, u) => s + u.evalTotal, 0);
  const refreshedTime = cache?.refreshedAt
    ? new Date(cache.refreshedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

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
            {refreshedTime
              ? <p className="text-gray-600 text-[11px]">갱신: {refreshedTime} · {userStats.length}명 · 총 {fmtAmount(totalEval)}</p>
              : <p className="text-gray-600 text-[11px]">새로고침을 눌러 데이터를 불러오세요</p>
            }
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? '로딩 중...' : '새로고침'}
        </button>
      </div>

      <div className="p-4 space-y-6 max-w-[1440px] mx-auto">

        {/* Table 1 — 사용자 현황 */}
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">사용자 현황</p>
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
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">1일수익율</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">접속횟수</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">최근접속</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {userStats.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-14 text-gray-700 text-sm">
                        새로고침을 눌러 데이터를 불러오세요
                      </td>
                    </tr>
                  )}
                  {userStats.map((u) => (
                    <tr
                      key={u.email}
                      className={`border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors ${u.fetchFailed ? 'opacity-40' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {u.fetchFailed && <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />}
                          <div>
                            <div className="font-medium text-gray-200 leading-tight">{u.name}</div>
                            <div className="text-gray-600 text-[10px]">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">{fmtDays(u.firstAt)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-100">{fmtAmount(u.evalTotal)}</td>
                      <td className="px-4 py-3 text-right">{fmtReturnEl(u.totalReturnRate)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{fmtAmount(u.principal)}</td>
                      <td className="px-4 py-3 text-right">{fmtReturnEl(u.dailyReturnRate)}</td>
                      <td className="px-4 py-3 text-right text-gray-400">{u.accessCount > 0 ? `${u.accessCount}회` : '-'}</td>
                      <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap text-[11px]">{fmtRelTime(u.lastAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => onViewUser(u.email)}
                          className="text-[11px] bg-emerald-900/50 hover:bg-emerald-800/70 text-emerald-300 border border-emerald-700/40 px-2.5 py-1 rounded-full transition-colors whitespace-nowrap"
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

        {/* Table 2 — 전일 대비 수익율 순위 */}
        {table2Stats.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">평가총액 순위 · 전일 대비</p>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden" style={{ maxWidth: 560 }}>
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
                            ? <TrendingUp size={11} className="text-emerald-400" />
                            : u.dailyReturnRate < -0.001
                            ? <TrendingDown size={11} className="text-rose-400" />
                            : <Minus size={11} className="text-gray-600" />}
                          {fmtReturnEl(u.dailyReturnRate)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
