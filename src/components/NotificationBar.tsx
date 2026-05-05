// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { NotificationEntry, NotificationType, ConfirmState } from '../hooks/useToast';

interface Props {
  notificationLog: NotificationEntry[];
  onClear: () => void;
  unreadCount: number;
  onRead: () => void;
}

const TYPE_COLOR: Record<string, string> = {
  info:    'text-sky-300',
  success: 'text-green-400',
  warning: 'text-amber-400',
  error:   'text-red-400',
};
const typeColor = (type: string) => TYPE_COLOR[type] ?? TYPE_COLOR.info;

function formatNotifTime(ts: number): string {
  const d = new Date(ts);
  const yy = d.getFullYear();
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${yy}-${mo}-${dd} ${hh}:${mm}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isSameDay = d.toDateString() === now.toDateString();
  if (isSameDay) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export default function NotificationBar({ notificationLog, onClear, unreadCount, onRead }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const posInitialized = useRef(false);
  const dragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLatestIdRef = useRef<string | null>(null);

  const latest = notificationLog[0] ?? null;

  // 새 알림 도착 시 10초 표시 후 숨김
  useEffect(() => {
    if (!latest) {
      setVisible(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      prevLatestIdRef.current = null;
      return;
    }
    if (latest.id !== prevLatestIdRef.current) {
      prevLatestIdRef.current = latest.id;
      if (timerRef.current) clearTimeout(timerRef.current);
      setVisible(true);
      timerRef.current = setTimeout(() => setVisible(false), 10000);
    }
  }, [latest?.id]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const openPanel = () => {
    if (!posInitialized.current) {
      setPos({ x: Math.max(0, window.innerWidth / 2 - 152), y: Math.max(60, window.innerHeight / 2 - 180) });
      posInitialized.current = true;
    }
    setIsOpen(true);
    onRead();
  };

  const handleDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { active: true, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y };
    const onMove = (mv) => {
      if (!dragRef.current.active) return;
      setPos({ x: mv.clientX - dragRef.current.offsetX, y: mv.clientY - dragRef.current.offsetY });
    };
    const onUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="relative w-full">
      {/* ── 알림 바 ── */}
      <div className="flex items-center bg-[#0b1120] border border-gray-700/40 rounded-md h-7 overflow-hidden select-none w-full">
        {/* 레이블 + 뱃지 */}
        <div className="relative flex-shrink-0 px-2.5 h-full flex items-center border-r border-gray-700/40 gap-1">
          <span className="text-[10px] text-gray-500 font-mono tracking-wider">알림</span>
          {unreadCount > 0 && (
            <span className="min-w-[14px] h-[14px] bg-red-500 rounded-full text-[8px] text-white font-bold flex items-center justify-center px-0.5 leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>

        {/* 텍스트 영역 */}
        <div className="flex-1 overflow-hidden h-full flex items-center gap-1.5 pl-2.5 pr-1">
          {visible && latest ? (
            <>
              <span className="flex-shrink-0 text-[9px] text-gray-500 font-mono">
                {formatNotifTime(latest.time)}
              </span>
              <span className={`text-[11px] font-mono truncate ${typeColor(latest.type)}`}>
                {latest.message}
              </span>
            </>
          ) : (
            <span className="text-[10px] text-gray-700 font-mono">없음</span>
          )}
        </div>

        {/* 토글 버튼 */}
        <button
          onClick={() => (isOpen ? setIsOpen(false) : openPanel())}
          className={`flex-shrink-0 px-2 h-full flex items-center border-l border-gray-700/40 transition-colors ${
            isOpen ? 'text-sky-400 bg-sky-900/20' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-800/40'
          }`}
          title={isOpen ? '알림 이력 닫기' : '알림 이력 열기'}
        >
          {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* ── 드래그 가능 팝업 ── */}
      {isOpen && (
        <div
          className="fixed z-[999] w-72 shadow-2xl"
          style={{ left: pos.x, top: pos.y }}
          onClick={e => e.stopPropagation()}
        >
          {/* 타이틀 바 (드래그 핸들) */}
          <div
            className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none"
            onMouseDown={handleDragStart}
          >
            <div className="flex items-center gap-2.5">
              {/* 분홍 — 닫기 */}
              <button
                onClick={() => setIsOpen(false)}
                className="w-3 h-3 rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all"
                title="닫기"
              >
                <X size={7} className="text-white" />
              </button>
              {/* 보라 — 이력 초기화 */}
              <button
                onClick={() => { onClear(); }}
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

          {/* 알림 목록 — 줄선 메모 배경 */}
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
                  className="flex items-baseline gap-2 px-3"
                  style={{ lineHeight: '24px', minHeight: 24 }}
                >
                  <span className="flex-shrink-0 text-[9px] text-gray-600 font-mono">
                    {formatTime(entry.time)}
                  </span>
                  <span
                    className={`text-[11px] font-mono break-all leading-snug ${typeColor(entry.type)}`}
                  >
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
