// @ts-nocheck
import { useState, useRef } from 'react';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationEntry {
  id: string;
  time: number;
  message: string;
  type: NotificationType;
}

export interface ConfirmState {
  message: string;
  confirmLabel: string;
  resolve: (result: boolean) => void;
}

const MAX_LOG = 200;

export function useToast() {
  const [notificationLog, setNotificationLog] = useState<NotificationEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const counterRef = useRef(0);
  const recentMessagesRef = useRef<Map<string, number>>(new Map());

  const notify = (text: string, type: NotificationType = 'info') => {
    const now = Date.now();
    const lastTime = recentMessagesRef.current.get(text) ?? 0;
    if (now - lastTime < 5000) return;
    recentMessagesRef.current.set(text, now);
    const entry: NotificationEntry = {
      id: `${now}_${++counterRef.current}`,
      time: now,
      message: text,
      type,
    };
    setNotificationLog(prev => [entry, ...prev].slice(0, MAX_LOG));
    setUnreadCount(prev => prev + 1);
  };

  const clearNotificationLog = () => {
    setNotificationLog([]);
    setUnreadCount(0);
  };

  const markAsRead = () => setUnreadCount(0);

  const confirm = (message: string, confirmLabel = '확인'): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ message, confirmLabel, resolve });
    });
  };

  const resolveConfirm = (result: boolean) => {
    if (!confirmState) return;
    confirmState.resolve(result);
    setConfirmState(null);
  };

  return {
    notify,
    notificationLog,
    setNotificationLog,
    clearNotificationLog,
    unreadCount,
    markAsRead,
    confirmState,
    confirm,
    resolveConfirm,
  };
}
