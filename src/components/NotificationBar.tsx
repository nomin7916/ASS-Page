// @ts-nocheck
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function NotificationBar({ notificationLog, onClear }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const latest = notificationLog[0] ?? null;

  return (
    <div className="relative w-full">
      {/* 알림 바 */}
      <div className="flex items-center bg-[#0b1120] border border-gray-700/40 rounded-md h-7 overflow-hidden select-none w-full">
        {/* 레이블 */}
        <span className="flex-shrink-0 px-2.5 text-[10px] text-gray-500 font-mono border-r border-gray-700/40 tracking-wider">
          알림
        </span>

        {/* 마퀴 영역 */}
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

        {/* 이력 토글 버튼 */}
        <button
          onClick={() => setIsOpen(p => !p)}
          className={`flex-shrink-0 px-2 h-full flex items-center border-l border-gray-700/40 transition-colors ${
            isOpen ? 'text-sky-400 bg-sky-900/20' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-800/40'
          }`}
          title={isOpen ? '알림 이력 닫기' : '알림 이력 열기'}
        >
          {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* 알림 이력 패널 */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#0f172a] border border-gray-700 rounded-lg shadow-2xl flex flex-col max-h-72 overflow-hidden">
          {/* 패널 헤더 */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700/60 flex-shrink-0 bg-[#111827]">
            <span className="text-[11px] text-gray-400 font-mono">
              알림 이력
              {notificationLog.length > 0 && (
                <span className="ml-1.5 text-gray-600">({notificationLog.length})</span>
              )}
            </span>
            <button
              onClick={() => { onClear(); setIsOpen(false); }}
              title="알림 이력 초기화"
              className="text-gray-600 hover:text-red-400 transition-colors text-[20px] leading-none font-light w-5 h-5 flex items-center justify-center rounded hover:bg-red-900/20"
            >
              ×
            </button>
          </div>

          {/* 이력 목록 */}
          <div className="overflow-y-auto flex-1 divide-y divide-gray-800/60">
            {notificationLog.length === 0 ? (
              <div className="text-center text-[11px] text-gray-600 py-6 font-mono">알림 없음</div>
            ) : (
              notificationLog.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 px-3 py-1.5 hover:bg-gray-800/30 transition-colors"
                >
                  <span className="flex-shrink-0 text-[10px] text-gray-600 font-mono mt-0.5 w-[72px]">
                    {formatTime(entry.time)}
                  </span>
                  <span className={`text-[11px] font-mono leading-relaxed break-all ${entry.isError ? 'text-red-400' : 'text-gray-300'}`}>
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
