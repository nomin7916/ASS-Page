// @ts-nocheck
import React, { useState } from 'react';
import { AdminNotification, renderMessageWithLinks } from './AdminNotificationModal';

interface Props {
  notifications: AdminNotification[];
  onUnpin: (id: string) => void;
}

const TYPE_STYLE: Record<string, string> = {
  info:    'border-sky-700/40 bg-sky-950/30',
  success: 'border-green-700/40 bg-green-950/30',
  warning: 'border-amber-700/40 bg-amber-950/30',
  error:   'border-red-700/40 bg-red-950/30',
};

const TYPE_TEXT: Record<string, string> = {
  info:    'text-sky-200',
  success: 'text-green-200',
  warning: 'text-amber-200',
  error:   'text-red-200',
};

const TYPE_ICON: Record<string, string> = {
  info: 'ℹ️', success: '✅', warning: '⚠️', error: '🚨',
};

export default function PinnedNotificationsBar({ notifications, onUnpin }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (notifications.length === 0) return null;

  return (
    <div className="w-full border-b border-amber-700/30 bg-amber-950/10">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-sm">📌</span>
        <span className="text-amber-300 text-xs font-semibold flex-1">고정된 공지 {notifications.length}건</span>
        <span className="text-gray-500 text-xs">{collapsed ? '▼' : '▲'}</span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-3 space-y-2">
          {notifications.map(n => (
            <div
              key={n.id}
              className={`rounded-lg px-3 py-2.5 border flex items-start gap-2 ${TYPE_STYLE[n.type] || TYPE_STYLE.info}`}
            >
              <span className="text-sm flex-shrink-0 mt-0.5">{TYPE_ICON[n.type] || TYPE_ICON.info}</span>
              <p className={`text-xs leading-relaxed whitespace-pre-wrap flex-1 ${TYPE_TEXT[n.type] || TYPE_TEXT.info}`}>
                {renderMessageWithLinks(n.message)}
              </p>
              <div className="flex-shrink-0 flex items-center gap-1 mt-0.5">
                <span className="text-gray-600 text-xs">
                  {new Date(n.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                </span>
                <button
                  onClick={() => onUnpin(n.id)}
                  title="고정 해제"
                  className="text-gray-500 hover:text-amber-400 transition-colors text-xs px-1"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
