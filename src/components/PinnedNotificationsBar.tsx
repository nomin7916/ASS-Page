// @ts-nocheck
import React, { useState } from 'react';
import { AdminNotification, renderMessageWithLinks } from './AdminNotificationModal';

interface Props {
  notifications: AdminNotification[];
  onUnpin: (id: string) => void;
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

export default function PinnedNotificationsBar({ notifications, onUnpin }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (notifications.length === 0) return null;

  return (
    <div className="w-full border-b border-gray-700/30 bg-gray-900/40">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-sm">📌</span>
        <span className="text-gray-400 text-xs font-semibold flex-1">고정된 공지 {notifications.length}건</span>
        <span className="text-gray-500 text-xs">{collapsed ? '▼' : '▲'}</span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-3 space-y-3">
          {notifications.map(n => (
            <div key={n.id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_STYLE[n.type] || BADGE_STYLE.info}`}>
                  {BADGE_LABEL[n.type] || BADGE_LABEL.info}
                </span>
                <span className="text-gray-600 text-xs ml-auto">
                  {new Date(n.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                </span>
                <button
                  onClick={() => onUnpin(n.id)}
                  title="고정 해제"
                  className="text-gray-500 hover:text-gray-300 transition-colors text-xs px-1"
                >
                  ✕
                </button>
              </div>
              <div className="bg-gray-800/60 rounded-xl px-3 py-2.5">
                <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">
                  {renderMessageWithLinks(n.message)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
