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
// ⚠️ `dialogPopover`는 **모달 안에서 뜨는 팝오버**(날짜 선택기 등) 전용이다. 그런 팝오버는
//    `document.body`로 포털되므로 조상이 아니라 **body 형제**로서 모달과 z를 겨룬다 —
//    `dialog`(1000)보다 낮으면 모달 패널이 그대로 덮어 **아무것도 안 뜬 것처럼 보인다**.
//    `CustomDatePicker`의 기본값 999가 정확히 그 상태였다(자산검증 비교일 선택 불가).
//    플로팅 창(계산기·관심종목·메모 달력 1050) **아래**로 두는 것이 의도다 — 팝오버는 자기
//    호스트 레이어에 붙어 있어야 하고, 호스트인 모달 자체가 이미 그 창들 아래이기 때문이다.
export const Z = {
  notification:  999,
  dialog:        1000,
  dialogPopover: 1020,
  overlay:       1100,
} as const;

// 차트 드래그 구간 선택 — 비선택 구간 딤(scrim) + 선택 창 스타일
// ⚠️ 개별 계좌 차트(PortfolioChart)와 통합 대시보드 차트(IntegratedDashboard)가 **이 상수를 공유**한다.
// 값을 각 컴포넌트에 손복제하면 같은 제스처가 두 화면에서 다르게 보인다.
// dimOpacity: 너무 낮으면 종전처럼 선택이 안 보이고, 1에 가까우면 바깥 맥락이 사라진다.
// windowOpacity: 선택 구간은 '원본 그대로 선명하게'가 목적이라 아주 옅은 lift만 준다(라인 색 씻김 방지).
export const CHART_SELECTION = {
  dimFill: BG.primary,
  dimOpacity: 0.66,
  windowFill: '#ffffff',
  windowOpacity: 0.04,
  windowStroke: 'rgba(255,255,255,0.5)',
  windowStrokeWidth: 1,
  // 더블클릭으로 고정한 시작점(앵커) — 종료점을 고르기 전의 대기 상태를 화면에 남긴다.
  // ⚠️ 두 차트가 이 토큰을 공유해야 같은 제스처가 같은 모양으로 보인다(딤·선택창과 동일 규약).
  anchorStroke: '#38bdf8',
  anchorStrokeWidth: 1.5,
  anchorDash: '4 3',
} as const;

// 공통 border 클래스
export const BORDER = {
  default: 'border-gray-700',
  subtle:  'border-gray-700/40',
} as const;
