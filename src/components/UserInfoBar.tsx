// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { Settings, Lock, Link2, LogOut, FileSpreadsheet, Power, LayoutDashboard, Calculator, Youtube, X, Bell } from 'lucide-react';
import { ADMIN_EMAIL } from '../config';

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
  onOpenLinkSettings,
  notificationLog = [],
  unreadCount = 0,
  onReadNotifications,
  onClearNotifications,
  onDeleteNotificationEntry,
}) {
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const [notebookOpen, setNotebookOpen] = useState(false);
  const dropdownRef = useRef(null);

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
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="font-mono whitespace-nowrap">{email}</span>
        {showTitleInput && (
          <input
            type="text"
            value={title || ''}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg md:text-xl font-bold bg-transparent outline-none border-b border-transparent hover:border-gray-600 focus:border-blue-400 text-white transition-colors caret-white cursor-text min-w-0 flex-1 max-w-[280px]"
            placeholder="계좌명"
          />
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

        {/* 외부 링크 1·2·3 */}
        {showLinks && (
          <>
            <div className="flex items-center gap-1 ml-1">
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
              {onOpenLinkSettings && (
                <button
                  onClick={onOpenLinkSettings}
                  title="퀵 링크 설정 (수익률 차트에서 편집)"
                  className="bg-gray-800/60 hover:bg-gray-700 text-gray-400 w-[22px] h-[22px] rounded border border-gray-600/60 flex items-center justify-center transition"
                ><Settings size={11} /></button>
              )}
            </div>
            <div className="w-px h-3 bg-gray-700/60 mx-0.5" />
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
            <div className="absolute right-0 top-full mt-1.5 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden min-w-[220px] max-w-[300px]">
              <div className="px-3 py-2 border-b border-gray-800">
                <span className="text-gray-500 text-xs font-semibold">학습 자료</span>
              </div>
              <ul className="py-1 max-h-64 overflow-y-auto">
                {notebookLinks.map((link, i) => (
                  <li key={i}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setNotebookOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-800 transition-colors group"
                    >
                      <span className="flex-shrink-0 text-sky-500 group-hover:text-sky-400 transition-colors">
                        <NotebookLMIcon size={13} />
                      </span>
                      <span className="text-gray-300 text-xs group-hover:text-white transition-colors truncate">
                        {link.title}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
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
