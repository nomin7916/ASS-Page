// 인트로 영상(로그인·PIN 뒤 계좌 로딩 중 재생) — 순수 로직. ⚠️ import 0 — verify:intro가 직접 import한다.
// 영상 파일은 public/intro/ (사이트와 함께 배포). 화면은 components/IntroVideoOverlay.tsx, 배선은 App.tsx.

// 영상을 바꿀 때는 파일 이름도 바꾼다 — 같은 주소면 브라우저·CDN 캐시가 옛 영상을 계속 틀 수 있다.
export const INTRO_VIDEO_SRC = '/intro/nominfi-intro-v3.mp4';

// 재생 음량 — 사용자 지시 '20% 이하'(2026-11-02). v3 원본은 v2보다 약 9.4dB 작아(−22.3 vs −12.9 LUFS)
// 20%로 틀어도 v2를 10%로 틀던 것보다 조용하다. 영상을 바꾸면 원본 음량을 재고 다시 정할 것.
export const INTRO_VOLUME = 0.2;

// 영상이 이 시간 안에 재생을 시작하지 못하면 닫고 기존 로딩 팝업으로 넘긴다(검은 화면 방치 금지).
export const INTRO_START_TIMEOUT_MS = 6000;

// 막 뜬 직후의 키 입력은 무시한다 — PIN 입력을 마친 Enter를 누른 채로 있으면 자동 반복으로 영상이 바로 꺼진다.
export const INTRO_KEY_GRACE_MS = 400;

export type BootPhase = 'loading' | 'hydrated' | 'hydrate-failed' | 'refreshing' | 'settled';
export type BootProgress = { done: number; total: number };

// 진행 막대 비율(0~1). 'loading'(Drive 계좌 로드)은 끝을 알 수 없어 시간에 따라 25%까지만 천천히 차오르고,
// 과거 종가 동기화는 30%에서 출발해 done/total로 95%까지, 정착하면 100%.
// 화면은 이 값의 최댓값만 따라간다(ratchetProgress) — total이 늦게 정해져도 막대가 뒤로 가지 않게.
export function bootProgressRatio(phase: BootPhase, progress: BootProgress, elapsedSec: number): number {
  if (phase === 'settled') return 1;
  if (phase === 'loading') {
    const t = Math.max(0, Number(elapsedSec) || 0);
    return 0.25 * (1 - Math.exp(-t / 3));
  }
  const done = Math.max(0, Number(progress?.done) || 0);
  const total = Math.max(0, Number(progress?.total) || 0);
  if (total <= 0) return 0.3;
  return 0.3 + 0.65 * Math.min(1, done / total);
}

export function ratchetProgress(prev: number, next: number): number {
  const p = Number.isFinite(prev) ? prev : 0;
  const n = Number.isFinite(next) ? next : 0;
  return Math.min(1, Math.max(p, n, 0));
}

// 상단 우측 작은 글씨 — 지금 무엇을 기다리는지.
export function introStatusText(phase: BootPhase, progress: BootProgress, partial: boolean): string {
  if (phase === 'settled') return partial ? '준비 완료 · 일부 종가 미수집' : '준비 완료';
  if (phase === 'loading') return '계좌 불러오는 중';
  const done = Math.max(0, Number(progress?.done) || 0);
  const total = Math.max(0, Number(progress?.total) || 0);
  const lead = phase === 'hydrate-failed' ? '종가 캐시 없이 동기화' : '과거 종가 동기화';
  return total > 0 ? `${lead} ${Math.min(done, total)}/${total}` : '시세 확인 중';
}

// Enter·Esc → 영상 닫기. 자동 반복·한글 조합 중·막 뜬 직후 입력은 무시.
export function introKeyAction(
  e: { key?: string; repeat?: boolean; isComposing?: boolean },
  msSinceMount: number,
): 'skip' | null {
  if (!e || e.repeat || e.isComposing) return null;
  if (!(msSinceMount >= INTRO_KEY_GRACE_MS)) return null;
  return e.key === 'Enter' || e.key === 'Escape' ? 'skip' : null;
}
