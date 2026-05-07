// @ts-nocheck
// ── 앱 전역 디자인 토큰 ──
// 새 컴포넌트 작성 시 이 파일에서 상수를 import해 사용 (매직 스트링 방지)

// 배경 색상
export const BG = {
  primary:  '#0b1120',   // 앱 기본 배경
  card:     '#0f1623',   // 카드·모달 배경
  overlay:  'rgba(0,0,0,0.85)',
  ruleLine: '#000',      // 줄선 메모 배경
} as const;

// 알림 타입별 Tailwind 텍스트 클래스
export const NOTIFY_CLASS: Record<string, string> = {
  info:    'text-sky-300',
  success: 'text-green-400',
  warning: 'text-amber-400',
  error:   'text-red-400',
};

// 알림 타입별 hex 색상 (인라인 style 필요 시)
export const NOTIFY_HEX: Record<string, string> = {
  info:    '#7dd3fc',
  success: '#4ade80',
  warning: '#fbbf24',
  error:   '#f87171',
};

// 줄선 메모 배경 CSS (NotificationBar, LoadingOverlay 등 공통)
export const RULED_BG_STYLE = {
  backgroundColor: BG.ruleLine,
  backgroundImage: `repeating-linear-gradient(
    transparent 0px,
    transparent 23px,
    rgba(99,130,255,0.25) 23px,
    rgba(99,130,255,0.25) 24px
  )`,
  backgroundSize: '100% 24px',
} as const;

// z-index 계층 (겹침 순서 일관성 유지)
export const Z = {
  notification: 999,
  dialog:       1000,
  overlay:      1100,
} as const;

// 공통 border 클래스
export const BORDER = {
  default: 'border-gray-700',
  subtle:  'border-gray-700/40',
} as const;
