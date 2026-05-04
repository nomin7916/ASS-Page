// @ts-nocheck
import React, { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { NotificationEntry } from '../hooks/useToast';

interface Props {
  notificationLog: NotificationEntry[];
  onClear: () => void;
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

export default function NotificationBar({ notificationLog, onClear }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const posInitialized = useRef(false);
  const dragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const latest = notificationLog[0] ?? null;

  const openPanel = () => {
    if (!posInitialized.current) {
      setPos({ x: Math.max(0, window.innerWidth / 2 - 152), y: Math.max(60, window.innerHeight / 2 - 180) });
      posInitialized.current = true;
    }
    setIsOpen(true);
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
        {/* 레이블 */}
        <span className="flex-shrink-0 px-2.5 text-[10px] text-gray-500 font-mono border-r border-gray-700/40 tracking-wider">
          알림
        </span>

        {/* 마퀴 텍스트 */}
        <div className="flex-1 overflow-hidden relative h-full flex items-center">
          {latest ? (
            <span
              key={latest.id}
              className={`absolute whitespace-nowrap text-[11px] font-mono ${latest.isError ? 'text-red-400' : 'text-sky-300'}`}
              style={{ animation: 'notif-marquee 22s linear infinite' }}
            >
              {latest.message}
            </span>
          ) : (
            <span className="text-[10px] text-gray-700 font-mono pl-2.5">없음</span>
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
                    className={`text-[11px] font-mono break-all leading-snug ${entry.isError ? 'text-red-400' : 'text-gray-300'}`}
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
