// 금리 모니터링 — 브라질 정치·정책 이슈 메모(8-B, 2026-10).
// ⚠️ import 0건 · enum 금지 — 순수 모듈. 내용을 지어내지 않는다: 처음에는 빈 배열이고, 사용자가 확인한 사건만 넣는다.
// ⚠️ 화면·판정은 readBrazilNotes() 하나로만 읽는다 — 9단계에서 Drive 저장으로 바꿀 때 이 함수만 고친다.

export type BrazilNoteImpact = '유리' | '불리' | '중립';
export interface BrazilNote { date: string; text: string; impact: BrazilNoteImpact; source: string }

// 예: { date: '2026-10-01', text: '재정 준칙 개정안 하원 통과', impact: '유리', source: 'https://…' }
export const BRAZIL_NOTES: BrazilNote[] = [];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const IMPACTS = ['유리', '불리', '중립'];

// 유효한 메모만, 최근 날짜 순
export function readBrazilNotes(list: BrazilNote[] = BRAZIL_NOTES): BrazilNote[] {
  return (Array.isArray(list) ? list : [])
    .filter(n => n && ISO.test(n.date) && typeof n.text === 'string' && IMPACTS.includes(n.impact))
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
