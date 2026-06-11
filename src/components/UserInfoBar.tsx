// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { Settings, Lock, Link2, LogOut, FileSpreadsheet, Power, LayoutDashboard, Calculator, Youtube, X, Bell } from 'lucide-react';
import { ADMIN_EMAIL } from '../config';
import HeaderMarketChips from './HeaderMarketChips';

function NotebookLMIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M9 8.5a3 3 0 0 1 6 0" />
      <rect x="8.5" y="10.5" width="2" height="2.5" rx="1" />
      <rect x="13.5" y="10.5" width="2" height="2.5" rx="1" />
    </svg>
  );
}

const TYPE_COLOR = {
  info:    'text-sky-300',
  success: 'text-green-400',
  warning: 'text-amber-400',
  error:   'text-red-400',
};
const typeColor = (type) => TYPE_COLOR[type] ?? TYPE_COLOR.info;

function formatNotifTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isSameDay = d.toDateString() === now.toDateString();
  if (isSameDay) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export default function UserInfoBar({
  email,
  adminAccessAllowed,
  onOpenAdmin,
  onOpenAdminPortal,
  onOpenPinChange,
  onToggleAdminAccess,
  onLogout,
  canAccessDividendTax,
  onOpenDividendTax,
  onAppClose,
  showCalculator,
  onToggleCalculator,
  youtubeUrl,
  notebookLinks = [],
  title,
  setTitle,
  showIntegratedDashboard,
  activeLinks = [],
  setActiveLinks,
  isOverseasLinks = false,
  notificationLog = [],
  unreadCount = 0,
  onReadNotifications,
  onClearNotifications,
  onDeleteNotificationEntry,
  marketIndicators,
}) {
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const [notebookOpen, setNotebookOpen] = useState(false);
  const dropdownRef = useRef(null);

  // HTML 학습자료 뷰어 (sandbox iframe) 상태
  const [viewer, setViewer] = useState(null); // { title }
  const [viewerHtml, setViewerHtml] = useState('');
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState('');

  const openStudyMaterial = async (link) => {
    setNotebookOpen(false);
    setViewer({ title: link.title });
    setViewerHtml('');
    setViewerError('');
    setViewerLoading(true);
    try {
      const res = await fetch(`/api/study-material?id=${encodeURIComponent(link.fileId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const html = await res.text();
      setViewerHtml(html);
    } catch {
      setViewerError('학습자료를 불러오지 못했습니다.');
    }
    setViewerLoading(false);
  };

  const closeViewer = () => { setViewer(null); setViewerHtml(''); setViewerError(''); };

  const [linkEditOpen, setLinkEditOpen] = useState(false);
  const linkEditRef = useRef(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifPos, setNotifPos] = useState({ x: 0, y: 0 });
  const notifPosInitialized = useRef(false);
  const notifDragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    if (!notebookOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setNotebookOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notebookOpen]);

  useEffect(() => {
    if (!linkEditOpen) return;
    const handler = (e) => {
      if (linkEditRef.current && !linkEditRef.current.contains(e.target)) {
        setLinkEditOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [linkEditOpen]);

  const openNotifPanel = () => {
    if (!notifPosInitialized.current) {
      setNotifPos({ x: Math.max(0, window.innerWidth / 2 - 152), y: Math.max(60, window.innerHeight / 2 - 180) });
      notifPosInitialized.current = true;
    }
    setNotifOpen(true);
    onReadNotifications?.();
  };

  const handleNotifDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    notifDragRef.current = { active: true, offsetX: e.clientX - notifPos.x, offsetY: e.clientY - notifPos.y };
    const onMove = (mv) => {
      if (!notifDragRef.current.active) return;
      setNotifPos({ x: mv.clientX - notifDragRef.current.offsetX, y: mv.clientY - notifDragRef.current.offsetY });
    };
    const onUp = () => {
      notifDragRef.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const showTitleInput = !showIntegratedDashboard && typeof setTitle === 'function';
  const showLinks = !showIntegratedDashboard && Array.isArray(activeLinks) && activeLinks.length > 0;

  return (
    <div className="flex items-center justify-between text-xs text-gray-500 px-1 gap-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {showIntegratedDashboard && (
          <span className="hidden md:inline font-mono whitespace-nowrap text-gray-400">{email}</span>
        )}
        {showTitleInput && (
          <input
            type="text"
            value={title || ''}
            onChange={(e) => setTitle(e.target.value)}
            className="hidden md:block text-lg md:text-xl font-bold bg-transparent outline-none border-b border-transparent hover:border-gray-600 focus:border-blue-400 text-white transition-colors caret-white cursor-text flex-shrink-0 max-w-[280px]"
            placeholder="계좌명"
          />
        )}
        {(showIntegratedDashboard || showTitleInput) && marketIndicators && (
          <div className="hidden md:block w-px h-4 bg-gray-600/70 mx-1 flex-shrink-0" />
        )}
        {marketIndicators && (
          <div className="hidden md:flex items-center">
            <HeaderMarketChips marketIndicators={marketIndicators} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {/* 알림 버튼 */}
        <button
          onClick={() => (notifOpen ? setNotifOpen(false) : openNotifPanel())}
          title={notifOpen ? '알림 이력 닫기' : '알림 이력 열기'}
          className={`relative p-1.5 rounded border transition-colors flex items-center justify-center gap-1 ${
            notifOpen
              ? 'text-sky-400 bg-sky-900/20 border-sky-700/40'
              : 'text-gray-500 hover:text-sky-300 hover:bg-gray-800 border-transparent hover:border-gray-700'
          }`}
        >
          <Bell size={14} />
          {unreadCount > 0 && (
            <span className="min-w-[14px] h-[14px] bg-red-500 rounded-full text-[8px] text-white font-bold flex items-center justify-center px-0.5 leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* 외부 링크 1·2·3 + 설정 팝오버 — 좁은 화면에서는 AccountTabBar로 이동 */}
        {showLinks && (
          <>
            <div className="hidden md:flex items-center gap-1 ml-1 relative" ref={linkEditRef}>
              {activeLinks.slice(0, 3).map((link, i) => {
                const tip = link.url
                  ? (link.name?.trim() ? `링크${i + 1} · ${link.name.trim()} — ${link.url}` : `링크${i + 1} — ${link.url}`)
                  : `링크${i + 1} 설정 필요`;
                return (
                  <button
                    key={i}
                    onClick={() => link.url && window.open(link.url.startsWith('http') ? link.url : 'https://' + link.url, '_blank')}
                    className="bg-gray-800/60 hover:bg-gray-700 text-blue-300 w-[22px] h-[22px] rounded border border-gray-600/60 flex items-center justify-center text-[11px] font-bold transition"
                    title={tip}
                  >{i + 1}</button>
                );
              })}
              {typeof setActiveLinks === 'function' && (
                <button
                  onClick={() => setLinkEditOpen(v => !v)}
                  title="퀵 링크 설정"
                  className={`w-[22px] h-[22px] rounded border flex items-center justify-center transition ${
                    linkEditOpen
                      ? 'text-sky-400 bg-sky-900/20 border-sky-700/40'
                      : 'bg-gray-800/60 hover:bg-gray-700 text-gray-400 border-gray-600/60'
                  }`}
                ><Settings size={11} /></button>
              )}
              {linkEditOpen && typeof setActiveLinks === 'function' && (
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 w-[300px] flex flex-col gap-3 cursor-default">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300 text-xs font-bold">퀵 링크 설정</span>
                    {isOverseasLinks && <span className="text-[10px] text-sky-400/70 font-bold">🌐 해외계좌 전용</span>}
                  </div>
                  {activeLinks.slice(0, 3).map((l, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-500 font-bold ml-0.5">버튼 {i + 1} 이름 <span className="text-gray-600 font-normal">(최대 7자)</span></span>
                        <input
                          type="text"
                          maxLength={7}
                          className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-400 shadow-inner font-normal"
                          value={l.name || ''}
                          onChange={(e) => { const n = [...activeLinks]; n[i] = { ...n[i], name: e.target.value }; setActiveLinks(n); }}
                          placeholder="비워두면 URL에서 자동 추출"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-500 font-bold ml-0.5">버튼 {i + 1} 연결 (URL)</span>
                        <input
                          type="text"
                          className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-500 shadow-inner font-normal"
                          value={l.url || ''}
                          onChange={(e) => { const n = [...activeLinks]; n[i] = { ...n[i], url: e.target.value }; setActiveLinks(n); }}
                          placeholder="https://..."
                        />
                      </div>
                    </div>
                  ))}
                  <button onClick={() => setLinkEditOpen(false)} className="self-end bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition">완료</button>
                </div>
              )}
            </div>
            <div className="hidden md:block w-px h-3 bg-gray-700/60 mx-0.5" />
          </>
        )}

        {onToggleCalculator && (
          <button
            onClick={onToggleCalculator}
            title={showCalculator ? '계산기 닫기' : '계산기 열기'}
            className={`p-1.5 rounded border transition-colors flex items-center justify-center ${
              showCalculator
                ? 'text-orange-400 bg-orange-900/20 border-orange-700/40 hover:bg-orange-900/30 hover:text-orange-300'
                : 'text-gray-500 hover:text-orange-300 hover:bg-gray-800 border-transparent hover:border-gray-700'
            }`}
          >
            <Calculator size={14} />
          </button>
        )}
        {youtubeUrl ? (
          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="YouTube 채널 바로가기"
            className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
          >
            <Youtube size={14} />
          </a>
        ) : (
          <span
            title="YouTube 링크 없음"
            className="text-gray-700 p-1.5 rounded border border-transparent flex items-center justify-center cursor-default"
          >
            <Youtube size={14} />
          </span>
        )}
        {/* 노트북LM 링크 드롭다운 */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => notebookLinks.length > 0 && setNotebookOpen(v => !v)}
            title={notebookLinks.length > 0 ? '학습 자료 바로가기' : '학습 자료 없음'}
            className={`p-1.5 rounded border transition-colors flex items-center justify-center ${
              notebookLinks.length === 0
                ? 'text-gray-700 border-transparent cursor-default'
                : notebookOpen
                  ? 'text-sky-400 bg-sky-900/20 border-sky-700/40'
                  : 'text-gray-500 hover:text-sky-400 hover:bg-gray-800 border-transparent hover:border-gray-700'
            }`}
          >
            <NotebookLMIcon size={14} />
          </button>
          {notebookOpen && notebookLinks.length > 0 && (
            <>
              {/* 모바일: 화면 중앙 배치를 위한 배경 오버레이 (탭 시 닫힘) */}
              <div
                className="md:hidden fixed inset-0 z-[998] bg-black/50"
                onClick={() => setNotebookOpen(false)}
              />
              <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(90vw,340px)] z-[999] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden md:absolute md:left-auto md:top-full md:right-0 md:translate-x-0 md:translate-y-0 md:mt-1.5 md:w-auto md:min-w-[220px] md:max-w-[300px] md:z-50">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                  <span className="text-gray-500 text-xs font-semibold">학습 자료</span>
                  <button
                    onClick={() => setNotebookOpen(false)}
                    className="md:hidden text-gray-500 hover:text-gray-300 transition-colors"
                    title="닫기"
                  >
                    <X size={14} />
                  </button>
                </div>
                <ul className="py-1 max-h-[60vh] md:max-h-64 overflow-y-auto">
                  {notebookLinks.map((link, i) => (
                    <li key={i}>
                      {link.fileId ? (
                        <button
                          onClick={() => openStudyMaterial(link)}
                          className="w-full text-left flex items-start md:items-center gap-2.5 px-3 py-2 hover:bg-gray-800 transition-colors group"
                        >
                          <span className="flex-shrink-0 mt-0.5 md:mt-0 text-violet-400 group-hover:text-violet-300 transition-colors">
                            <NotebookLMIcon size={13} />
                          </span>
                          <span className="text-gray-300 text-xs group-hover:text-white transition-colors break-words md:truncate">
                            {link.title}
                          </span>
                        </button>
                      ) : (
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setNotebookOpen(false)}
                          className="flex items-start md:items-center gap-2.5 px-3 py-2 hover:bg-gray-800 transition-colors group"
                        >
                          <span className="flex-shrink-0 mt-0.5 md:mt-0 text-sky-500 group-hover:text-sky-400 transition-colors">
                            <NotebookLMIcon size={13} />
                          </span>
                          <span className="text-gray-300 text-xs group-hover:text-white transition-colors break-words md:truncate">
                            {link.title}
                          </span>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* HTML 학습자료 뷰어 — sandbox iframe으로 격리 렌더 (allow-same-origin 미부여 → 앱 데이터 접근 차단) */}
          {viewer && (
            <div className="fixed inset-0 z-[1100] bg-black/80 flex flex-col" onClick={closeViewer}>
              <div
                className="m-auto w-[96vw] h-[92vh] max-w-[1100px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
                  <span className="text-gray-200 text-sm font-semibold truncate pr-2">{viewer.title}</span>
                  <button
                    onClick={closeViewer}
                    className="text-gray-500 hover:text-gray-200 transition-colors flex-shrink-0"
                    title="닫기"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 relative bg-white">
                  {viewerLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                      <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <div className="w-4 h-4 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
                        불러오는 중…
                      </div>
                    </div>
                  )}
                  {viewerError && !viewerLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                      <span className="text-red-400 text-sm">{viewerError}</span>
                    </div>
                  )}
                  {!viewerLoading && !viewerError && (
                    <iframe
                      title={viewer.title}
                      srcDoc={viewerHtml}
                      sandbox="allow-scripts allow-popups"
                      className="w-full h-full border-0"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="w-px h-3 bg-gray-700/60 mx-0.5" />
        {isAdmin && onOpenAdminPortal && (
          <button
            onClick={onOpenAdminPortal}
            className="text-gray-500 hover:text-violet-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
            title="관리자 포털"
          >
            <LayoutDashboard size={14} />
          </button>
        )}
        {isAdmin && onOpenAdmin && (
          <button
            onClick={onOpenAdmin}
            className="text-gray-500 hover:text-violet-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
            title="관리자 설정"
          >
            <Settings size={14} />
          </button>
        )}
        {canAccessDividendTax && (
          <button
            onClick={onOpenDividendTax}
            className="text-gray-500 hover:text-green-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
            title="배당 과세 이력 관리"
          >
            <FileSpreadsheet size={14} />
          </button>
        )}
        <button
          onClick={onOpenPinChange}
          className="text-gray-500 hover:text-amber-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
          title="비밀번호 변경"
        >
          <Lock size={14} />
        </button>
        <button
          onClick={onToggleAdminAccess}
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
          onClick={onLogout}
          className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
          title="로그아웃"
        >
          <LogOut size={14} />
        </button>
        {onAppClose && (
          <>
            <div className="w-px h-3 bg-gray-700/60 mx-0.5" />
            <button
              onClick={onAppClose}
              className="text-gray-500 hover:text-rose-400 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
              title="앱 닫기 (백업 저장 후 종료)"
            >
              <Power size={14} />
            </button>
          </>
        )}
      </div>

      {/* 알림 이력 드래그 가능 팝업 */}
      {notifOpen && (
        <div
          className="fixed z-[999] w-72 shadow-2xl"
          style={{ left: notifPos.x, top: notifPos.y }}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none"
            onMouseDown={handleNotifDragStart}
          >
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setNotifOpen(false)}
                className="w-3 h-3 rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all"
                title="닫기"
              >
                <X size={7} className="text-white" />
              </button>
              <button
                onClick={() => { onClearNotifications?.(); }}
                className="w-3 h-3 rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center transition-all"
                title="이력 초기화"
              >
                <span className="text-white leading-none" style={{ fontSize: 7 }}>✕</span>
              </button>
            </div>
            <span className="text-[11px] font-bold tracking-[0.25em] bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 bg-clip-text text-transparent select-none">
              알림 이력
            </span>
            <span className="text-[10px] text-gray-700 font-mono w-10 text-right">
              {notificationLog.length > 0 ? notificationLog.length : ''}
            </span>
          </div>
          <div
            className="overflow-y-auto"
            style={{
              backgroundColor: '#000',
              backgroundImage: `repeating-linear-gradient(
                transparent 0px,
                transparent 23px,
                rgba(99,130,255,0.25) 23px,
                rgba(99,130,255,0.25) 24px
              )`,
              backgroundSize: '100% 24px',
              backgroundPosition: '0 0',
              minHeight: 96,
              maxHeight: 288,
            }}
          >
            {notificationLog.length === 0 ? (
              <div
                className="text-[11px] text-gray-700 font-mono px-3"
                style={{ lineHeight: '24px' }}
              >
                알림 없음
              </div>
            ) : (
              notificationLog.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-baseline gap-2 px-3 group"
                  style={{ lineHeight: '24px', minHeight: 24 }}
                >
                  <span className="flex-shrink-0 text-[9px] text-gray-600 font-mono">
                    {formatNotifTime(entry.time)}
                  </span>
                  <span
                    className={`flex-1 text-[11px] font-mono break-all leading-snug ${typeColor(entry.type)}`}
                  >
                    {entry.message}
                  </span>
                  {onDeleteNotificationEntry && (
                    <button
                      onClick={() => onDeleteNotificationEntry(entry)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"
                      title="삭제"
                      style={{ lineHeight: '24px', fontSize: 10 }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
