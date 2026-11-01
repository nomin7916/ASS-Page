// 계좌 '사용자 구분'의 순수 로직. `verify:user-category`가 미러 없이 **직접 import**한다.
// ⚠️ 이 파일에는 import를 두지 말 것(dividendYear.ts와 같은 규약) — Node가 타입만 벗겨 그대로 실행한다.
//
// 규칙(사용자 확정 2026-11-01):
//  - 구분(category)은 정해진 자산군 목록 그대로 두고, 사용자 구분(userCategory)을 항목에 따로 둔다(직접 입력).
//  - 포트폴리오 표의 구분 열과 자산 비중 카드는 계좌마다 각각 '자산군 / 사용자' 중 골라 본다. 기본은 자산군.
//  - 사용자 보기에서 사용자 구분이 빈 행은 자산군 이름으로 묶는다(입력한 행만 바뀐다).
//  - 예수금 행은 사용자 구분이 없다 — 어느 보기든 '예수금'.

export const USER_CATEGORY_MAX = 20;

export type CategoryView = 'asset' | 'user';

export function normalizeUserCategory(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, USER_CATEGORY_MAX);
}

export function normalizeCategoryView(v: unknown): CategoryView {
  return v === 'user' ? 'user' : 'asset';
}

// 자산군 보기의 묶음 이름 — usePortfolioData의 기존 규칙 그대로(예수금 행은 '예수금', 빈 구분은 '미지정').
export function baseCategoryOf(item: any): string {
  if (!item) return '미지정';
  return item.type === 'deposit' ? '예수금' : (item.category || '미지정');
}

export function groupCategoryOf(item: any, view: unknown): string {
  const base = baseCategoryOf(item);
  if (normalizeCategoryView(view) !== 'user' || !item || item.type === 'deposit') return base;
  return normalizeUserCategory(item.userCategory) || base;
}

// 이 계좌에서 쓰는 사용자 구분 목록(처음 나온 순서, 중복 없음) — 입력 칸의 고르기 목록·색 순번.
export function userCategoryList(items: any[]): string[] {
  const out: string[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || it.type === 'deposit') continue;
    const u = normalizeUserCategory(it.userCategory);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

// 사용자 구분 이름의 색 — 목록 순번으로 팔레트를 돈다(표 칸과 자산 비중 표가 같은 색을 쓴다).
export function userCategoryColor(name: string, list: string[], palette: string[]): string {
  if (!Array.isArray(palette) || palette.length === 0) return '';
  const i = Array.isArray(list) ? list.indexOf(normalizeUserCategory(name)) : -1;
  return i < 0 ? '' : palette[i % palette.length];
}
