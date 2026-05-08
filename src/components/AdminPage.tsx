// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { APPROVED_SHEET_ID, APPS_SCRIPT_URL, ADMIN_EMAIL } from '../config';

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

export default function AdminPage({ adminEmail, onClose, onViewUser, onOpenPortal, userAccessStatus = {}, switching = false, userLastSeen = {}, onRefreshUserSessions, youtubeUrl = '', onSetYoutubeUrl }: Props) {
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionRefreshing, setSessionRefreshing] = useState(false);

  // 공지 보내기 상태
  const [notifTarget, setNotifTarget] = useState('__all__');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifType, setNotifType] = useState('info');
  const [sending, setSending] = useState(false);

  // YouTube 채널 링크 상태
  const [youtubeInput, setYoutubeInput] = useState(youtubeUrl);
  const [youtubeSaving, setYoutubeSaving] = useState(false);
  const [sendResult, setSendResult] = useState<'success' | 'error' | null>(null);

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
                  setYoutubeSaving(true);
                  await onSetYoutubeUrl(youtubeInput.trim());
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
      </div>
    </div>
  );
}
