// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { BG, NOTIFY_CLASS, RULED_BG_STYLE, Z, BORDER } from '../design';
import type { NotificationEntry } from '../hooks/useToast';

interface Props {
  visible: boolean;
  notificationLog: NotificationEntry[];
  onDismiss: () => void;
  autoCloseMs?: number;
}

export default function LoadingOverlay({ visible, notificationLog, onDismiss, autoCloseMs = 20000 }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [canDismiss, setCanDismiss] = useState(false);
  const startRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const showBtnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAll = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (showBtnRef.current) clearTimeout(showBtnRef.current);
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
  };

  useEffect(() => {
    if (!visible) { clearAll(); return; }

    setElapsed(0);
    setCanDismiss(false);
    startRef.current = Date.now();

    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
    showBtnRef.current = setTimeout(() => setCanDismiss(true), 5000);
    autoCloseRef.current = setTimeout(onDismiss, autoCloseMs);

    return clearAll;
  }, [visible]);

  if (!visible) return null;

  const remaining = Math.max(0, Math.round((autoCloseMs / 1000) - elapsed));

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: Z.overlay, backgroundColor: BG.overlay, cursor: 'wait', pointerEvents: 'all' }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      <div
        className={`w-80 rounded-xl shadow-2xl overflow-hidden border ${BORDER.default}`}
        style={{ backgroundColor: BG.card }}
      >
        {/* ── 타이틀 바 ── */}
        <div className={`px-4 py-2.5 border-b ${BORDER.subtle} flex items-center justify-between select-none`}>
          <div className="flex items-center gap-2.5">
            {/* macOS 트래픽 라이트 (비활성 — 로딩 중) */}
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-gray-700" />
              <div className="w-3 h-3 rounded-full bg-gray-700" />
              <div className="w-3 h-3 rounded-full bg-gray-700" />
            </div>
            <span className="text-[11px] text-gray-400 font-mono tracking-widest">데이터 로딩 중</span>
          </div>
          <div className="flex items-center gap-2">
            {/* 스피너 */}
            <svg className="animate-spin w-3 h-3 text-sky-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span className="text-[10px] text-gray-600 font-mono">{elapsed}s</span>
          </div>
        </div>

        {/* ── 줄선 메모 영역 — 최근 알림 3개 표시 ── */}
        <div style={{ ...RULED_BG_STYLE, minHeight: 72, padding: '4px 0' }}>
          {notificationLog.length === 0 ? (
            <div
              className="text-[11px] text-gray-600 font-mono px-3"
              style={{ lineHeight: '24px' }}
            >
              불러오는 중...
            </div>
          ) : (
            notificationLog.slice(0, 3).map(entry => (
              <div
                key={entry.id}
                className={`flex items-baseline gap-2 px-3 ${NOTIFY_CLASS[entry.type] ?? NOTIFY_CLASS.info}`}
                style={{ lineHeight: '24px', minHeight: 24 }}
              >
                <span className="flex-shrink-0 text-[9px] text-gray-600 font-mono">
                  {new Date(entry.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </span>
                <span className="text-[11px] font-mono truncate">{entry.message}</span>
              </div>
            ))
          )}
        </div>

        {/* ── 푸터 ── */}
        <div className={`px-4 py-2 border-t ${BORDER.subtle} flex items-center justify-between`}>
          <span className="text-[10px] text-gray-600 font-mono">
            {canDismiss ? `${remaining}초 후 자동 해제` : '잠시만 기다려 주세요...'}
          </span>
          {canDismiss && (
            <button
              onClick={onDismiss}
              className="text-[11px] font-mono text-gray-400 hover:text-sky-300 border border-gray-700 hover:border-sky-700/60 rounded px-3 py-0.5 transition-colors"
            >
              계속 사용하기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
