// @ts-nocheck
import { useState, useRef } from 'react';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationEntry {
  id: string;
  time: number;
  message: string;
  type: NotificationType;
  adminNotifId?: string;
  // 자료 공지(학습자료/리포트)일 때만 채널 태그를 박아 벨 알림이력에서 클릭→자료 열기 복원에 사용.
  // 발송시각(materialCreatedAt = 공지 createdAt)은 동일 제목 자료 중 올바른 것을 고르는 tiebreak.
  materialChannel?: 'notebook' | 'report';
  materialCreatedAt?: number;
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

  const notify = (
    text: string,
    type: NotificationType = 'info',
    opts?: { adminNotifId?: string; materialChannel?: 'notebook' | 'report'; materialCreatedAt?: number; skipDedup?: boolean },
  ) => {
    const now = Date.now();
    // skipDedup: 관리자 공지→이력 적재 전용. 동일 제목 자료 2건의 메시지가 같아도 둘 다 이력에 남아야
    // 각각 클릭 가능(5초 텍스트 dedup이 둘째를 삼키는 것 방지). 일반 토스트는 종전대로 dedup.
    if (!opts?.skipDedup) {
      const lastTime = recentMessagesRef.current.get(text) ?? 0;
      if (now - lastTime < 5000) return;
    }
    recentMessagesRef.current.set(text, now);
    const entry: NotificationEntry = {
      id: `${now}_${++counterRef.current}`,
      time: now,
      message: text,
      type,
      adminNotifId: opts?.adminNotifId,
      materialChannel: opts?.materialChannel,
      materialCreatedAt: opts?.materialCreatedAt,
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
