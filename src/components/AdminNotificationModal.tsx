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
  pinnedIds: string[];
  onPin: (id: string) => void;
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
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
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

export default function AdminNotificationModal({ notifications, pinnedIds, onPin, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4">
      <div className="bg-gray-900 border border-gray-700/60 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center gap-2 px-6 pt-6 pb-4 border-b border-gray-800">
          <h2 className="text-white font-bold text-base flex-1">관리자 공지</h2>
          <span className="text-gray-500 text-sm">{notifications.length}건</span>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {notifications.map((n) => {
            const isPinned = pinnedIds.includes(n.id);
            return (
              <div key={n.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE_STYLE[n.type] || BADGE_STYLE.info}`}>
                    {BADGE_LABEL[n.type] || BADGE_LABEL.info}
                  </span>
                  <span className="text-gray-600 text-xs ml-auto">
                    {new Date(n.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button
                    onClick={() => onPin(n.id)}
                    title={isPinned ? '고정 해제' : '상단 고정'}
                    className={`flex-shrink-0 text-base transition-opacity ${isPinned ? 'opacity-100' : 'opacity-30 hover:opacity-70'}`}
                  >
                    📌
                  </button>
                </div>
                <div className="bg-gray-800/60 rounded-xl px-4 py-3">
                  <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                    {renderMessageWithLinks(n.message)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-6 pb-6 pt-4 border-t border-gray-800">
          <p className="text-gray-600 text-xs text-center mb-3">📌 버튼을 누르면 공지를 상단에 고정할 수 있습니다</p>
          <button
            onClick={onClose}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
