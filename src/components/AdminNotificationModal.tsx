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

const TYPE_STYLE: Record<string, string> = {
  info:    'bg-sky-900/40 border-sky-700/50 text-sky-200',
  success: 'bg-green-900/40 border-green-700/50 text-green-200',
  warning: 'bg-amber-900/40 border-amber-700/50 text-amber-200',
  error:   'bg-red-900/40 border-red-700/50 text-red-200',
};

const TYPE_ICON: Record<string, string> = {
  info: 'ℹ️', success: '✅', warning: '⚠️', error: '🚨',
};

export default function AdminNotificationModal({ notifications, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center gap-2 px-6 pt-6 pb-4 border-b border-gray-800">
          <span className="text-xl">📢</span>
          <h2 className="text-white font-bold text-base flex-1">관리자 공지</h2>
          <span className="text-gray-500 text-sm">{notifications.length}건</span>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-xl p-4 border ${TYPE_STYLE[n.type] || TYPE_STYLE.info}`}
            >
              <div className="flex items-start gap-2">
                <span className="text-base flex-shrink-0 mt-0.5">{TYPE_ICON[n.type] || TYPE_ICON.info}</span>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{n.message}</p>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-right">
                {new Date(n.createdAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          ))}
        </div>
        <div className="px-6 pb-6 pt-4 border-t border-gray-800">
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
