// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { APPROVED_SHEET_ID, APPS_SCRIPT_URL, ADMIN_EMAIL } from '../config';
import { RULED_BG_STYLE, NOTIFY_HEX } from '../design';

const COLAB_URL = 'https://colab.research.google.com/drive/1hjCwtVjyKzooWly4AU_ufrMSV87FApzi#scrollTo=fe7b764e';
const COLAB_PASSWORD = '0000';

interface ApprovedUser {
  email: string;
  resetFlag: string; // Apps Script returns raw A열 value: '', 'RESET', 'RESET:1234'
  name?: string;
  feature1?: boolean;
  feature2?: boolean;
  feature3?: boolean;
}

interface SentNotification {
  id: string;
  targetEmail: string;
  message: string;
  type: string;
  createdAt: number;
}

interface NotebookLink {
  title: string;
  url: string;
  createdAt: number;
}

interface Props {
  adminEmail: string;
  onClose: () => void;
  onViewUser?: (email: string) => void;
  onOpenPortal?: () => void;
  userAccessStatus?: Record<string, boolean>;
  switching?: boolean;
  userLastSeen?: Record<string, number>;
  onRefreshUserSessions?: (emails: string[]) => Promise<void>;
  youtubeUrl?: string;
  onSetYoutubeUrl?: (url: string) => Promise<void>;
  notebookLinks?: NotebookLink[];
  onSetNotebookLinks?: (links: NotebookLink[]) => Promise<void>;
}

// Apps Script를 통해 사용자 목록 조회 (시트 비공개 유지)
async function fetchApprovedUsers(): Promise<ApprovedUser[]> {
  try {
    const url = `${APPS_SCRIPT_URL}?action=listUsers&cacheBust=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.users || []).filter((u: ApprovedUser) => u.email);
  } catch {
    return [];
  }
}

function formatLastSeen(ts: number): { label: string; isOnline: boolean } {
  const diff = Date.now() - ts;
  const isOnline = diff < 5 * 60 * 1000;
  if (isOnline) return { label: '접속 중', isOnline: true };
  if (diff < 60 * 60 * 1000) return { label: `${Math.floor(diff / 60000)}분 전`, isOnline: false };
  if (diff < 24 * 60 * 60 * 1000) return { label: `${Math.floor(diff / 3600000)}시간 전`, isOnline: false };
  return { label: `${Math.floor(diff / 86400000)}일 전`, isOnline: false };
}

export default function AdminPage({ adminEmail, onClose, onViewUser, onOpenPortal, userAccessStatus = {}, switching = false, userLastSeen = {}, onRefreshUserSessions, youtubeUrl = '', onSetYoutubeUrl, notebookLinks = [], onSetNotebookLinks }: Props) {
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionRefreshing, setSessionRefreshing] = useState(false);

  // 공지 보내기 상태
  const [notifTarget, setNotifTarget] = useState('__all__');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifType, setNotifType] = useState('info');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<'success' | 'error' | null>(null);

  // 발송 이력 상태
  const [sentNotifs, setSentNotifs] = useState<SentNotification[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);
  const [notifFilter, setNotifFilter] = useState('__all__');
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // YouTube 채널 링크 상태
  const [youtubeInput, setYoutubeInput] = useState(youtubeUrl);
  const [youtubeSaving, setYoutubeSaving] = useState(false);
  const [youtubeHistory, setYoutubeHistory] = useState<{url: string, savedAt: number}[]>([]);

  // 노트북LM 링크 상태
  const [nbTitle, setNbTitle] = useState('');
  const [nbUrl, setNbUrl] = useState('');
  const [nbSaving, setNbSaving] = useState(false);
  const [deletingNbIds, setDeletingNbIds] = useState<Set<number>>(new Set());
  const [movingNbId, setMovingNbId] = useState<number | null>(null);

  // API 진단 상태
  const [apiTestCode, setApiTestCode] = useState('');
  const [apiTestLoading, setApiTestLoading] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<any>(null);

  const runApiTest = async () => {
    const code = apiTestCode.trim().toUpperCase();
    if (!code) return;
    setApiTestLoading(true);
    setApiTestResult(null);
    const result: any = { code, steps: [] };

    const addStep = (label: string, status: 'ok' | 'fail' | 'info', data?: any) => {
      result.steps.push({ label, status, data });
    };

    const isKr = /^\d{6}$/.test(code);
    const isUs = /^[A-Z]{1,6}$/.test(code);

    if (isUs) {
      // US ETF: Yahoo Finance topHoldings
      addStep('코드 유형', 'info', '미국 ETF/주식 티커');
      try {
        const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${code}?modules=topHoldings`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        addStep(`Yahoo topHoldings (직접)`, res.ok ? 'ok' : 'fail',
          res.ok ? JSON.parse(JSON.stringify(
            (await res.json())?.quoteSummary?.result?.[0]?.topHoldings?.holdings?.slice(0, 3)
            ?? 'holdings 없음'
          )) : `HTTP ${res.status}`
        );
      } catch (e) { addStep('Yahoo topHoldings (직접)', 'fail', String(e)); }

      try {
        const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${code}?modules=summaryDetail`;
        const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const d = await res.json();
          const det = d?.quoteSummary?.result?.[0]?.summaryDetail;
          addStep('Yahoo summaryDetail (PER)', 'ok', { trailingPE: det?.trailingPE?.raw, forwardPE: det?.forwardPE?.raw });
        } else { addStep('Yahoo summaryDetail (PER)', 'fail', `HTTP ${res.status}`); }
      } catch (e) { addStep('Yahoo summaryDetail (PER)', 'fail', String(e)); }

    } else if (isKr) {
      addStep('코드 유형', 'info', '국내 6자리 코드');

      // Step 1: Naver etfAnalysis
      let naverData: any = null;
      try {
        const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/etfAnalysis`, { signal: AbortSignal.timeout(8000) });
        addStep(`Naver etfAnalysis`, res.ok ? 'ok' : 'fail', res.ok ? 'HTTP 200' : `HTTP ${res.status}`);
        if (res.ok) {
          naverData = await res.json();
          const rawList = naverData?.etfTop10MajorConstituentAssets ?? [];
          const isOverseas = Array.isArray(rawList) && rawList.length > 0 && rawList[0]?.etfWeight === '-';
          addStep('etfBaseIndex', 'info', naverData?.etfBaseIndex ?? '없음');
          addStep('해외 ETF 여부', isOverseas ? 'info' : 'ok', isOverseas ? '해외 ETF (etfWeight="-")' : '국내 ETF');
          addStep('구성종목 샘플 (Naver)', 'info',
            rawList.slice(0, 3).map((x: any) => ({ name: x.itemName, code: x.itemCode, etfWeight: x.etfWeight }))
          );

          if (isOverseas) {
            // 인덱스 매핑
            const u = (naverData?.etfBaseIndex ?? '').toUpperCase();
            let mapped = null;
            if (u.includes('NASDAQ 100') || u.includes('NASDAQ-100')) mapped = 'QQQ';
            else if (u.includes('S&P 500') || u.includes('S&P500')) mapped = 'SPY';
            else if (u.includes('PHLX SEMICONDUCTOR') || u.includes('PHILADELPHIA SEMICONDUCTOR')) mapped = 'SOXX';
            else if (u.includes('NIFTY 50') || u.includes('NIFTY50')) mapped = 'INDY';
            else if (u.includes('CSI 300') || u.includes('CSI300')) mapped = 'ASHR';
            else if (u.includes('MSCI CHINA')) mapped = 'MCHI';
            else if (u.includes('MSCI EM') || u.includes('MSCI EMERGING')) mapped = 'EEM';
            else if (u.includes('DOW JONES')) mapped = 'DIA';
            else if (u.includes('RUSSELL 2000')) mapped = 'IWM';
            else if (u.includes('NIKKEI')) mapped = 'EWJ';
            else if (u.includes('HANG SENG')) mapped = 'EWH';

            addStep('인덱스 → US ETF 매핑', mapped ? 'ok' : 'fail', mapped ? `→ ${mapped}` : '매핑 없음 (신규 추가 필요)');

            if (mapped) {
              // Yahoo Finance topHoldings
              try {
                const yUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${mapped}?modules=topHoldings`;
                const yRes = await fetch(yUrl, { signal: AbortSignal.timeout(8000) });
                if (yRes.ok) {
                  const yData = await yRes.json();
                  const holdings = yData?.quoteSummary?.result?.[0]?.topHoldings?.holdings?.slice(0, 3);
                  addStep(`Yahoo topHoldings (${mapped})`, holdings?.length > 0 ? 'ok' : 'fail',
                    holdings?.map((h: any) => ({ name: h.holdingName, code: h.symbol, ratio: h.holdingPercent?.raw != null ? (h.holdingPercent.raw * 100).toFixed(2) + '%' : '?' })) ?? 'holdings 없음'
                  );
                } else { addStep(`Yahoo topHoldings (${mapped})`, 'fail', `HTTP ${yRes.status}`); }
              } catch (e) { addStep(`Yahoo topHoldings (${mapped})`, 'fail', String(e)); }
            }
          }
        }
      } catch (e) { addStep('Naver etfAnalysis', 'fail', String(e)); }

      // Step 2: Naver domestic stock PER
      try {
        const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const d = await res.json();
          addStep('Naver basic (종목정보)', 'ok', { stockEndType: d.stockEndType, closePrice: d.closePrice, per: d.per });
        } else { addStep('Naver basic', 'fail', `HTTP ${res.status}`); }
      } catch (e) { addStep('Naver basic', 'fail', String(e)); }

      // Step 3: 서버 etf-holdings 엔드포인트
      try {
        const res = await fetch(`/api/etf-holdings?code=${code}&debug=1`, { signal: AbortSignal.timeout(10000) });
        addStep('/api/etf-holdings (서버)', res.ok ? 'ok' : 'fail',
          res.ok ? await res.json() : `HTTP ${res.status}`
        );
      } catch (e) { addStep('/api/etf-holdings (서버)', 'fail', String(e)); }

    } else {
      addStep('코드 유형', 'fail', '인식 불가: 6자리 숫자 또는 영문 1~6자 입력');
    }

    setApiTestResult(result);
    setApiTestLoading(false);
  };

  const loadYoutubeHistory = async () => {
    try {
      const res = await fetch(`${APPS_SCRIPT_URL}?action=getSettings&cacheBust=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.youtubeUrlHistory) {
          setYoutubeHistory(JSON.parse(data.youtubeUrlHistory));
        }
      }
    } catch {}
  };

  const saveYoutubeHistoryEntry = async (url: string, currentHistory: {url: string, savedAt: number}[]) => {
    const newEntry = { url, savedAt: Date.now() };
    const newHistory = [newEntry, ...currentHistory.filter(h => h.url !== url)].slice(0, 20);
    setYoutubeHistory(newHistory);
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'setSettings', key: 'youtubeUrlHistory', value: JSON.stringify(newHistory) }),
      });
    } catch {}
  };

  const handleAddNotebookLink = async () => {
    if (!nbTitle.trim() || !nbUrl.trim() || !onSetNotebookLinks) return;
    setNbSaving(true);
    const newLink: NotebookLink = { title: nbTitle.trim(), url: nbUrl.trim(), createdAt: Date.now() };
    await onSetNotebookLinks([newLink, ...notebookLinks]);
    // 새 슬라이드 등록 시 전체 사용자에게 자동 알림 (비차단)
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'sendNotification',
        targetEmail: '__all__',
        message: `📚 ${newLink.title}가 등록되었습니다.`,
        type: 'info',
      }),
    }).catch(() => {});
    setNbTitle('');
    setNbUrl('');
    setNbSaving(false);
  };

  const handleMoveNotebookLink = async (index: number, direction: 'up' | 'down') => {
    if (!onSetNotebookLinks) return;
    const arr = [...notebookLinks];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= arr.length) return;
    setMovingNbId(arr[index].createdAt);
    [arr[index], arr[target]] = [arr[target], arr[index]];
    await onSetNotebookLinks(arr);
    setMovingNbId(null);
  };

  const handleDeleteNotebookLink = async (createdAt: number) => {
    if (!onSetNotebookLinks) return;
    setDeletingNbIds(prev => new Set([...prev, createdAt]));
    await onSetNotebookLinks(notebookLinks.filter(l => l.createdAt !== createdAt));
    setDeletingNbIds(prev => { const next = new Set(prev); next.delete(createdAt); return next; });
  };

  const handleDeleteYoutubeHistory = async (savedAt: number) => {
    const newHistory = youtubeHistory.filter(h => h.savedAt !== savedAt);
    setYoutubeHistory(newHistory);
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'setSettings', key: 'youtubeUrlHistory', value: JSON.stringify(newHistory) }),
      });
    } catch {}
  };

  const fetchSentNotifications = async () => {
    setNotifsLoading(true);
    try {
      const res = await fetch(`${APPS_SCRIPT_URL}?action=getNotifications&cacheBust=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        const all: SentNotification[] = data.notifications || [];
        setSentNotifs(all.sort((a, b) => b.createdAt - a.createdAt));
      }
    } catch {}
    setNotifsLoading(false);
  };

  const handleDeleteNotification = async (id: string) => {
    setDeletingIds(prev => new Set([...prev, id]));
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'deleteNotification', notifId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setSentNotifs(prev => prev.filter(n => n.id !== id));
      }
    } catch {}
    setDeletingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const triggerSessionRefresh = async (userList: ApprovedUser[]) => {
    if (!onRefreshUserSessions || sessionRefreshing) return;
    setSessionRefreshing(true);
    const emails = userList
      .filter(u => u.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase())
      .map(u => u.email);
    await onRefreshUserSessions(emails);
    setSessionRefreshing(false);
  };

  useEffect(() => {
    fetchApprovedUsers().then(u => {
      setUsers(u);
      setLoading(false);
      triggerSessionRefresh(u);
    });
    fetchSentNotifications();
    loadYoutubeHistory();
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    const u = await fetchApprovedUsers();
    setUsers(u);
    setLoading(false);
    triggerSessionRefresh(u);
  };

  const handleSendNotification = async () => {
    if (!notifMessage.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      // Apps Script에 POST로 공지 전송
      // Apps Script doPost에 아래 코드 추가 필요:
      // if (action === 'sendNotification') {
      //   const ss = SpreadsheetApp.openById(SHEET_ID);
      //   let sheet = ss.getSheetByName('notifications') || ss.insertSheet('notifications');
      //   if (sheet.getLastRow() === 0) sheet.appendRow(['id','targetEmail','message','type','createdAt']);
      //   const id = Utilities.getUuid();
      //   sheet.appendRow([id, params.targetEmail, params.message, params.type || 'info', Date.now()]);
      //   return ContentService.createTextOutput(JSON.stringify({ success: true, id })).setMimeType(ContentService.MimeType.JSON);
      // }
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'sendNotification',
          targetEmail: notifTarget,
          message: notifMessage.trim(),
          type: notifType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setSendResult('success');
        setNotifMessage('');
        fetchSentNotifications();
      } else {
        setSendResult('error');
      }
    } catch {
      setSendResult('error');
    } finally {
      setSending(false);
    }
  };

  const handleOpenSheet = () => {
    window.open(`https://docs.google.com/spreadsheets/d/${APPROVED_SHEET_ID}/edit`, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">관리자 페이지</h1>
            <p className="text-gray-500 text-sm mt-0.5">{adminEmail}</p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenPortal && (
              <button
                onClick={onOpenPortal}
                className="flex items-center gap-1.5 bg-violet-800 hover:bg-violet-700 text-violet-100 text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
                title="관리자 포털"
              >
                <LayoutDashboard size={14} />
                포털
              </button>
            )}
            <button
              onClick={onClose}
              className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              나가기
            </button>
          </div>
        </div>

        {/* 승인 사용자 목록 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">
              승인된 사용자
              <span className="ml-2 text-gray-500 text-sm font-normal">
                {!loading && `(${users.length}명)`}
              </span>
            </h2>
            <div className="flex items-center gap-3">
              {sessionRefreshing && (
                <span className="flex items-center gap-1.5 text-xs text-sky-400">
                  <span className="w-3 h-3 border border-sky-500 border-t-transparent rounded-full animate-spin" />
                  접속현황 조회 중
                </span>
              )}
              <button
                onClick={handleRefresh}
                disabled={loading || sessionRefreshing}
                className="text-gray-400 hover:text-white text-sm transition-colors disabled:opacity-50"
              >
                새로고침
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
              <div className="w-4 h-4 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
              <span className="text-sm">불러오는 중...</span>
            </div>
          ) : users.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-6">승인된 사용자가 없습니다.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {users.map((u, i) => (
                <li key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-2.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${u.resetFlag ? 'bg-yellow-400' : 'bg-green-400'}`} />
                  <div className="flex-1 min-w-0">
                    {u.name && <div className="text-gray-100 text-xs font-semibold truncate">{u.name}</div>}
                    <span className="text-gray-400 text-sm truncate">{u.email}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                    {u.feature1 && (
                      <span className="text-xs bg-orange-900/60 text-orange-300 border border-orange-700/50 px-2 py-0.5 rounded-full">
                        기능1
                      </span>
                    )}
                    {u.resetFlag && (
                      <span className="text-xs bg-yellow-900/60 text-yellow-300 border border-yellow-700/50 px-2 py-0.5 rounded-full">
                        PIN 초기화됨
                      </span>
                    )}
                    {u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? (
                      <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">관리자</span>
                    ) : (
                      <>
                        {userAccessStatus[u.email] === true && (
                          <span className="text-xs bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 px-2 py-0.5 rounded-full">허용</span>
                        )}
                        {userAccessStatus[u.email] === false && (
                          <span className="text-xs bg-red-900/60 text-red-300 border border-red-700/50 px-2 py-0.5 rounded-full">차단</span>
                        )}
                        {userLastSeen[u.email] && (() => {
                          const { label, isOnline } = formatLastSeen(userLastSeen[u.email]);
                          return (
                            <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                              isOnline
                                ? 'bg-green-950/70 text-green-300 border-green-700/50'
                                : 'bg-gray-800/60 text-gray-400 border-gray-700/40'
                            }`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-500'}`} />
                              {label}
                            </span>
                          );
                        })()}
                        {onViewUser && (
                          <button
                            onClick={() => !switching && onViewUser(u.email)}
                            disabled={switching}
                            className={`text-xs border px-2 py-0.5 rounded-full transition-colors ${
                              switching
                                ? 'bg-gray-800/40 text-gray-600 border-gray-700/30 cursor-not-allowed'
                                : 'bg-green-900/60 hover:bg-green-800/80 text-green-300 border-green-700/50'
                            }`}
                          >
                            {switching ? '전환 중...' : '접속'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* 사용자 추가/시트 버튼 */}
          <div className="mt-5 pt-5 border-t border-gray-800">
            <p className="text-gray-500 text-sm mb-3">
              사용자 추가/제거는 구글 시트에서 직접 관리합니다.
            </p>
            <button
              onClick={handleOpenSheet}
              className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
              </svg>
              구글 시트에서 사용자 관리
            </button>
            <p className="text-gray-600 text-xs mt-2 text-center">
              A열: RESET / B열: 이메일 / C열: 이름 / D열: 기능1(ON/OFF)
            </p>

            <a
              href="https://console.cloud.google.com/auth/audience?project=useful-maxim-493212-r8"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors border border-gray-700"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              Google Cloud Console (테스트 사용자 관리)
            </a>

            <button
              onClick={() => {
                const pw = window.prompt('비밀번호를 입력하세요');
                if (pw === COLAB_PASSWORD) window.open(COLAB_URL, '_blank');
              }}
              className="mt-3 w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-semibold py-2.5 px-4 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2c5.523 0 10 4.477 10 10S17.523 22 12 22 2 17.523 2 12 6.477 2 12 2zm-1 5v10l7-5-7-5z"/>
              </svg>
              Google Colab 열기
            </button>
          </div>
        </div>

        {/* 공지 보내기 */}
        <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-wider">📢 공지 보내기</p>
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={notifTarget}
                onChange={e => setNotifTarget(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="__all__">전체 사용자</option>
                {users.filter(u => u.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()).map(u => (
                  <option key={u.email} value={u.email}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
                ))}
              </select>
              <select
                value={notifType}
                onChange={e => setNotifType(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="info">정보</option>
                <option value="success">성공</option>
                <option value="warning">경고</option>
                <option value="error">오류</option>
              </select>
            </div>
            <textarea
              value={notifMessage}
              onChange={e => setNotifMessage(e.target.value)}
              placeholder="전달할 공지 내용을 입력하세요..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSendNotification}
                disabled={sending || !notifMessage.trim()}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                {sending ? (
                  <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />전송 중...</>
                ) : '전송'}
              </button>
              {sendResult === 'success' && <span className="text-green-400 text-xs">✓ 전송 완료</span>}
              {sendResult === 'error' && <span className="text-red-400 text-xs">✗ 전송 실패</span>}
            </div>
          </div>

          {/* 발송 이력 */}
          <div className="pt-3 border-t border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-xs font-semibold">📋 발송 이력</span>
              <button
                onClick={fetchSentNotifications}
                disabled={notifsLoading}
                className="text-gray-600 hover:text-gray-400 text-xs transition-colors disabled:opacity-50"
              >
                {notifsLoading ? '불러오는 중...' : '새로고침'}
              </button>
            </div>

            {/* 필터 탭 */}
            {sentNotifs.length > 0 && (() => {
              const uniqueTargets = [...new Set(sentNotifs.map(n => n.targetEmail))].filter(e => typeof e === 'string' && e !== '__all__');
              return (
                <div className="flex gap-1 flex-wrap mb-2">
                  <button
                    onClick={() => setNotifFilter('__all__')}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      notifFilter === '__all__'
                        ? 'bg-blue-900/60 border-blue-700/60 text-blue-300'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    전체
                  </button>
                  {uniqueTargets.map(email => {
                    const user = users.find(u => u.email === email);
                    return (
                      <button
                        key={email}
                        onClick={() => setNotifFilter(email)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          notifFilter === email
                            ? 'bg-blue-900/60 border-blue-700/60 text-blue-300'
                            : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {user?.name || (typeof email === 'string' ? email.split('@')[0] : String(email))}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* 이력 목록 — 알림장 스타일 */}
            {(() => {
              const filtered = sentNotifs.filter(n =>
                notifFilter === '__all__' || n.targetEmail === notifFilter
              );
              if (notifsLoading && sentNotifs.length === 0) {
                return (
                  <div className="flex items-center justify-center py-4 text-gray-600 text-xs gap-1.5">
                    <div className="w-3 h-3 border border-gray-600 border-t-gray-400 rounded-full animate-spin" />
                    불러오는 중...
                  </div>
                );
              }
              if (filtered.length === 0) {
                return <p className="text-gray-700 text-xs text-center py-3">발송 이력이 없습니다.</p>;
              }
              return (
                <div
                  className="rounded-lg overflow-y-auto border border-gray-700/40 max-h-60"
                  style={RULED_BG_STYLE}
                >
                  {filtered.map((n, i) => {
                    const dot = NOTIFY_HEX[n.type] || NOTIFY_HEX.info;
                    const d = new Date(n.createdAt);
                    const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    const targetLabel = n.targetEmail === '__all__' ? '전체' : (() => {
                      const u = users.find(x => x.email === n.targetEmail);
                      return u?.name || (typeof n.targetEmail === 'string' ? n.targetEmail.split('@')[0] : String(n.targetEmail ?? ''));
                    })();
                    return (
                      <div
                        key={n.id}
                        className={`flex items-start gap-2 px-3 py-2 ${i < filtered.length - 1 ? 'border-b border-gray-700/30' : ''}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: dot }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-200 text-xs leading-relaxed break-words">{typeof n.message === 'string' ? n.message : String(n.message ?? '')}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-gray-600 text-xs">{dateStr}</span>
                            <span className="text-gray-700 text-xs">·</span>
                            <span className="text-gray-500 text-xs">{targetLabel}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteNotification(n.id)}
                          disabled={deletingIds.has(n.id)}
                          className="text-gray-700 hover:text-red-400 text-sm leading-none transition-colors disabled:opacity-40 flex-shrink-0 mt-0.5"
                          title="삭제"
                        >
                          {deletingIds.has(n.id) ? (
                            <span className="w-3 h-3 border border-gray-600 border-t-gray-400 rounded-full animate-spin inline-block" />
                          ) : '×'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* YouTube 채널 링크 설정 */}
        {onSetYoutubeUrl && (
          <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <p className="text-red-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              YouTube 채널 링크
            </p>
            <p className="text-gray-500 text-xs">
              링크를 설정하면 모든 사용자의 상단 바에 YouTube 버튼이 표시됩니다.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={youtubeInput}
                onChange={e => setYoutubeInput(e.target.value)}
                placeholder="https://www.youtube.com/@channel"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-xs placeholder-gray-600 focus:outline-none focus:border-red-500"
              />
              <button
                onClick={async () => {
                  const newUrl = youtubeInput.trim();
                  setYoutubeSaving(true);
                  await onSetYoutubeUrl(newUrl);
                  if (newUrl) await saveYoutubeHistoryEntry(newUrl, youtubeHistory);
                  setYoutubeSaving(false);
                }}
                disabled={youtubeSaving || youtubeInput.trim() === youtubeUrl}
                className="flex items-center gap-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors whitespace-nowrap"
              >
                {youtubeSaving ? (
                  <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />저장 중</>
                ) : '저장'}
              </button>
            </div>
            {youtubeUrl && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs">현재:</span>
                <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-red-400 hover:text-red-300 text-xs underline decoration-dotted truncate flex-1">
                  {youtubeUrl}
                </a>
                <button
                  onClick={async () => {
                    setYoutubeInput('');
                    setYoutubeSaving(true);
                    await onSetYoutubeUrl('');
                    setYoutubeSaving(false);
                  }}
                  disabled={youtubeSaving}
                  className="text-gray-600 hover:text-red-400 text-xs transition-colors shrink-0"
                >
                  삭제
                </button>
              </div>
            )}

            {/* YouTube 링크 이력 */}
            {youtubeHistory.length > 0 && (
              <div className="pt-3 border-t border-gray-800">
                <span className="text-gray-500 text-xs font-semibold">링크 이력</span>
                <div
                  className="mt-2 rounded-lg overflow-y-auto border border-gray-700/40 max-h-44"
                  style={RULED_BG_STYLE}
                >
                  {youtubeHistory.map((h, i) => {
                    const d = new Date(h.savedAt);
                    const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    const isCurrent = h.url === youtubeUrl;
                    return (
                      <div
                        key={h.savedAt}
                        className={`flex items-start gap-2 px-3 py-2 ${i < youtubeHistory.length - 1 ? 'border-b border-gray-700/30' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <a
                            href={h.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`text-xs underline decoration-dotted truncate block ${isCurrent ? 'text-red-400' : 'text-gray-400 hover:text-gray-200'}`}
                          >
                            {h.url}
                          </a>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-gray-600 text-xs">{dateStr}</span>
                            {isCurrent && <span className="text-red-500/70 text-xs">현재 적용 중</span>}
                          </div>
                        </div>
                        {!isCurrent && (
                          <button
                            onClick={async () => {
                              setYoutubeInput(h.url);
                              setYoutubeSaving(true);
                              await onSetYoutubeUrl(h.url);
                              await saveYoutubeHistoryEntry(h.url, youtubeHistory);
                              setYoutubeSaving(false);
                            }}
                            disabled={youtubeSaving}
                            className="text-gray-600 hover:text-red-400 text-xs transition-colors flex-shrink-0 disabled:opacity-40"
                            title="이 링크로 적용"
                          >
                            적용
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteYoutubeHistory(h.savedAt)}
                          className="text-gray-700 hover:text-red-400 text-sm leading-none transition-colors flex-shrink-0"
                          title="이력에서 삭제"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 노트북LM 링크 관리 */}
        {onSetNotebookLinks && (
          <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <p className="text-sky-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                <path d="M9 8.5a3 3 0 0 1 6 0" />
                <rect x="8.5" y="10.5" width="2" height="2.5" rx="1" />
                <rect x="13.5" y="10.5" width="2" height="2.5" rx="1" />
              </svg>
              노트북 LM 슬라이드
            </p>
            <p className="text-gray-500 text-xs">
              링크를 추가하면 모든 사용자의 상단 바 노트북 아이콘 드롭다운에 표시됩니다.
            </p>

            {/* 추가 폼 */}
            <div className="space-y-2">
              <input
                type="text"
                value={nbTitle}
                onChange={e => setNbTitle(e.target.value)}
                placeholder="제목 (예: 2024년 투자 전략 팟캐스트)"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-xs placeholder-gray-600 focus:outline-none focus:border-sky-500"
              />
              <div className="flex gap-2">
                <input
                  type="url"
                  value={nbUrl}
                  onChange={e => setNbUrl(e.target.value)}
                  placeholder="https://notebooklm.google.com/..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-xs placeholder-gray-600 focus:outline-none focus:border-sky-500"
                />
                <button
                  onClick={handleAddNotebookLink}
                  disabled={nbSaving || !nbTitle.trim() || !nbUrl.trim()}
                  className="flex items-center gap-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors whitespace-nowrap"
                >
                  {nbSaving ? (
                    <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />추가 중</>
                  ) : '추가'}
                </button>
              </div>
            </div>

            {/* 링크 목록 */}
            {notebookLinks.length === 0 ? (
              <p className="text-gray-700 text-xs text-center py-2">등록된 링크가 없습니다.</p>
            ) : (
              <div className="rounded-lg overflow-hidden border border-gray-700/40" style={RULED_BG_STYLE}>
                <div className="overflow-y-auto max-h-64">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-gray-700/50 bg-gray-800/60">
                        <th className="px-2 py-1.5 text-center text-gray-500 font-semibold w-8">#</th>
                        <th className="px-2 py-1.5 text-left text-gray-500 font-semibold whitespace-nowrap">등록일시</th>
                        <th className="px-2 py-1.5 text-left text-gray-500 font-semibold">제목</th>
                        <th className="px-2 py-1.5 text-left text-gray-500 font-semibold">링크</th>
                        <th className="px-1 py-1.5 w-8"></th>
                        <th className="px-2 py-1.5 w-6"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {notebookLinks.map((link, i) => {
                        const d = new Date(link.createdAt);
                        const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                        const isBusy = movingNbId !== null || deletingNbIds.has(link.createdAt);
                        return (
                          <tr key={link.createdAt} className={i < notebookLinks.length - 1 ? 'border-b border-gray-700/30' : ''}>
                            <td className="px-2 py-1.5 text-center text-gray-600">{i + 1}</td>
                            <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{dateStr}</td>
                            <td className="px-2 py-1.5 text-gray-200 font-medium max-w-[120px] truncate">{link.title}</td>
                            <td className="px-2 py-1.5 max-w-[160px]">
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-500 hover:text-sky-300 underline decoration-dotted truncate block transition-colors"
                                title={link.url}
                              >
                                {link.url}
                              </a>
                            </td>
                            <td className="px-1 py-1.5 text-center">
                              <div className="flex flex-col items-center gap-0">
                                <button
                                  onClick={() => handleMoveNotebookLink(i, 'up')}
                                  disabled={i === 0 || isBusy}
                                  className="text-gray-600 hover:text-gray-300 leading-none disabled:opacity-20 transition-colors px-0.5"
                                  style={{ fontSize: '9px' }}
                                  title="위로"
                                >▲</button>
                                <button
                                  onClick={() => handleMoveNotebookLink(i, 'down')}
                                  disabled={i === notebookLinks.length - 1 || isBusy}
                                  className="text-gray-600 hover:text-gray-300 leading-none disabled:opacity-20 transition-colors px-0.5"
                                  style={{ fontSize: '9px' }}
                                  title="아래로"
                                >▼</button>
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <button
                                onClick={() => handleDeleteNotebookLink(link.createdAt)}
                                disabled={isBusy}
                                className="text-gray-700 hover:text-red-400 text-sm leading-none transition-colors disabled:opacity-40"
                                title="삭제"
                              >
                                {deletingNbIds.has(link.createdAt) ? (
                                  <span className="w-3 h-3 border border-gray-600 border-t-gray-400 rounded-full animate-spin inline-block" />
                                ) : '×'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PIN 관리 안내 */}
        <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider">비밀번호(PIN) 관리</p>
          <div className="text-gray-400 text-xs leading-relaxed space-y-2">
            <p>
              <span className="text-gray-200 font-medium">초기 비밀번호:</span>{' '}
              모든 사용자의 기본 비밀번호는 <span className="text-yellow-300 font-bold font-mono">0000</span>입니다.
              로그인 후 상단 <span className="text-blue-300">비번 변경</span> 버튼으로 언제든지 변경할 수 있습니다.
            </p>
            <p>
              <span className="text-gray-200 font-medium">PIN 저장 위치:</span>{' '}
              각 사용자의 PIN은 <span className="text-green-400">본인의 구글 드라이브</span>{' '}
              (Index_Data/portfolio_pin.json)에 저장됩니다.
              어느 기기/브라우저에서 로그인해도 동일한 PIN이 적용됩니다.
            </p>
            <p>
              <span className="text-gray-200 font-medium">비밀번호 초기화 (요청 시):</span>{' '}
              구글 시트 <span className="text-green-400">B열</span>에{' '}
              <span className="text-yellow-300 font-mono">RESET</span>{' '}입력 →
              해당 사용자 다음 로그인 시 <span className="text-yellow-300 font-bold">0000</span>으로 초기화됩니다.
              특정 비밀번호로 초기화하려면 <span className="text-yellow-300 font-mono">RESET:1234</span> 형식으로 입력하세요.
            </p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 font-mono text-xs text-gray-400">
            <div className="text-gray-500 mb-1">시트 B열 사용 예시</div>
            <div><span className="text-blue-400">A열(이메일)</span>{'            '}<span className="text-green-400">B열(초기화)</span></div>
            <div>arui114501@gmail.com</div>
            <div>nomin1fi@gmail.com{'    '}<span className="text-yellow-300">RESET</span><span className="text-gray-600">{'       '}← 0000으로 초기화</span></div>
            <div>user@gmail.com{'        '}<span className="text-yellow-300">RESET:5678</span><span className="text-gray-600">{'  '}← 5678로 초기화</span></div>
          </div>
        </div>

        {/* 승인 요청 안내 */}
        <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-500 text-xs leading-relaxed">
            <span className="text-yellow-400 font-semibold">승인 요청 수신:</span>{' '}
            새 사용자가 접근을 요청하면 <span className="text-gray-300">{ADMIN_EMAIL}</span>로 이메일이 자동 발송됩니다.
            이메일을 확인 후 구글 시트에 해당 이메일을 추가하면 즉시 접근이 허용됩니다.
          </p>
        </div>

        {/* API 진단 도구 */}
        <div className="mt-6 bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-bold text-sky-400 mb-3">API 진단 도구</h3>
          <p className="text-xs text-gray-500 mb-3">ETF/종목 코드를 입력하고 각 API 단계별 응답을 확인합니다. 코드 수정 전 데이터 구조 파악에 사용하세요.</p>
          <div className="flex gap-2 mb-4">
            <input
              className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-sky-500"
              placeholder="예: 360750  /  QQQ  /  005930"
              value={apiTestCode}
              onChange={e => setApiTestCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runApiTest()}
            />
            <button
              onClick={runApiTest}
              disabled={apiTestLoading || !apiTestCode.trim()}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {apiTestLoading ? '조회 중…' : '테스트'}
            </button>
          </div>

          {apiTestResult && (
            <div className="space-y-1.5">
              {apiTestResult.steps.map((step: any, i: number) => (
                <div key={i} className="bg-gray-800 rounded-lg p-2.5 flex gap-2.5 items-start">
                  <span className={`text-xs font-bold mt-0.5 shrink-0 w-3 ${step.status === 'ok' ? 'text-green-400' : step.status === 'fail' ? 'text-red-400' : 'text-gray-400'}`}>
                    {step.status === 'ok' ? '✓' : step.status === 'fail' ? '✗' : '·'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs text-gray-300 font-medium">{step.label}</span>
                    {step.data !== undefined && (
                      <pre className="mt-1 text-[10px] text-gray-400 whitespace-pre-wrap break-all leading-relaxed font-mono bg-gray-900 rounded p-1.5 max-h-40 overflow-y-auto">
                        {typeof step.data === 'string' ? step.data : JSON.stringify(step.data, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
