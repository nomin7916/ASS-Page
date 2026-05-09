// @ts-nocheck
import React from 'react';

export interface AdminNotification {
  id: string;
  targetEmail: string;
  message: string;
  type: string;
  createdAt: number;
}

interface Props {
  notifications: AdminNotification[];
  onClose: () => void;
}

const BADGE_STYLE: Record<string, string> = {
  info:    'bg-green-900/60 text-green-300',
  success: 'bg-green-900/60 text-green-300',
  warning: 'bg-amber-900/60 text-amber-300',
  error:   'bg-red-900/60 text-red-300',
};

const BADGE_LABEL: Record<string, string> = {
  info:    '공지',
  success: '안내',
  warning: '주의',
  error:   '긴급',
};

export function renderMessageWithLinks(text: string) {
  const safe = typeof text === 'string' ? text : String(text ?? '');
  if (!safe) return null;
  const parts = safe.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted hover:opacity-80 break-all"
          onClick={e => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function AdminNotificationModal({ notifications, onClose }: Props) {
  return (
    <div className="fixed top-14 left-4 z-[300] w-64 shadow-2xl">
      <div className="bg-[#0f1623] border border-gray-700/60 rounded-2xl flex flex-col max-h-[70vh]">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2.5 border-b border-gray-800">
          <h2 className="text-white font-bold text-xs flex-1">관리자 공지</h2>
          <span className="text-gray-500 text-xs">{notifications.length}건</span>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
          {notifications.map((n) => (
            <div key={n.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${BADGE_STYLE[n.type] || BADGE_STYLE.info}`}>
                  {BADGE_LABEL[n.type] || BADGE_LABEL.info}
                </span>
              </div>
              <div className="bg-gray-800/80 rounded-xl px-3 py-2.5">
                <p className="text-gray-200 text-xs leading-relaxed whitespace-pre-wrap">
                  {renderMessageWithLinks(n.message)}
                </p>
                <p className="text-gray-600 text-xs mt-1.5 text-right">
                  {new Date(n.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 pb-4 pt-2.5 border-t border-gray-800">
          <button
            onClick={onClose}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 rounded-xl transition-colors text-xs"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
