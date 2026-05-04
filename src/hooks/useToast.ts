// @ts-nocheck
import { useState, useRef } from 'react';

export interface NotificationEntry {
  id: string;
  time: number;   // Unix ms timestamp
  message: string;
  isError: boolean;
}

const MAX_LOG = 200;

export function useToast() {
  const [globalToast, setGlobalToast] = useState({ text: "", isError: false });
  const [notificationLog, setNotificationLog] = useState<NotificationEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const counterRef = useRef(0);

  const showToast = (text, isError = false) => {
    setGlobalToast({ text, isError });
    setTimeout(() => setGlobalToast({ text: "", isError: false }), 4000);
    const entry: NotificationEntry = {
      id: `${Date.now()}_${++counterRef.current}`,
      time: Date.now(),
      message: text,
      isError,
    };
    setNotificationLog(prev => [entry, ...prev].slice(0, MAX_LOG));
    setUnreadCount(prev => prev + 1);
  };

  const clearNotificationLog = () => {
    setNotificationLog([]);
    setUnreadCount(0);
  };

  const markAsRead = () => setUnreadCount(0);

  return { globalToast, showToast, notificationLog, setNotificationLog, clearNotificationLog, unreadCount, markAsRead };
}
