// 계좌 '사용자 구분'의 순수 로직. `verify:user-category`가 미러 없이 **직접 import**한다.
// ⚠️ 이 파일에는 import를 두지 말 것(dividendYear.ts와 같은 규약) — Node가 타입만 벗겨 그대로 실행한다.
//
// 규칙(사용자 확정 2026-11-01):
//  - 구분(category)은 정해진 자산군 목록 그대로 두고, 사용자 구분(userCategory)을 항목에 따로 둔다(직접 입력).
//  - 포트폴리오 표의 구분 열과 자산 비중 카드는 계좌마다 각각 '자산군 / 사용자' 중 골라 본다. 기본은 자산군.
//  - 사용자 보기에서 사용자 구분이 빈 행은 자산군 이름으로 묶는다(입력한 행만 바뀐다).
//  - 예수금 행은 사용자 구분이 없다 — 어느 보기든 '예수금'.
//  - 구분은 **종목마다 하나**다: 구분(자산군)·사용자 구분을 고치면 다른 계좌의 같은 종목(같은 종류·코드)에도 함께 쓴다
//    (applySharedCategory). 사용자 구분이 빈 종목은 다른 계좌의 같은 종목 값을 따른다(effectiveUserCategory) —
//    그래서 이미 구분한 종목은 다시 입력할 필요가 없고, 다른 계좌에만 있는 종목만 구분하면 된다.
//    코드가 없는 행(예적금·수동 현금·금현물)은 그 행에만 쓴다. 삭제된(휴지통) 계좌는 건드리지도 참고하지도 않는다.

export const USER_CATEGORY_MAX = 20;

export type CategoryView = 'asset' | 'user';

export const SHARED_CATEGORY_FIELDS = ['category', 'userCategory'];

const SAFE_CATEGORIES = ['채권', '현금', '예수금'];

export function normalizeUserCategory(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, USER_CATEGORY_MAX);
}

export function normalizeCategoryView(v: unknown): CategoryView {
  return v === 'user' ? 'user' : 'asset';
}

// 퇴직연금(dc-irp) D/S 배지 — 구분을 고칠 때 PortfolioTable 구분 칸과 같은 규칙으로 다시 정한다.
export function assetClassOfCategory(cat: unknown): 'S' | 'D' {
  return SAFE_CATEGORIES.includes(String(cat ?? '')) ? 'S' : 'D';
}

// 같은 종목 판정 키 — 종류(stock/fund) + 대문자 코드(앞자리 0 제외: '241D0'과 '0241D0'은 같은 종목).
export function shareKeyOf(item: any): string {
  if (!item || (item.type !== 'stock' && item.type !== 'fund')) return '';
  const code = String(item.code ?? '').trim().toUpperCase().replace(/^0+(?=.)/, '');
  return code ? `${item.type}:${code}` : '';
}

const liveAccounts = (portfolios: any): any[] =>
  (Array.isArray(portfolios) ? portfolios : []).filter(p => p && !p.deletedAt);

// 모든 계좌의 '종목 → 사용자 구분'(처음 입력된 값). 키는 shareKeyOf.
export function sharedUserCategoryMap(portfolios: any): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of liveAccounts(portfolios)) {
    for (const it of Array.isArray(p.portfolio) ? p.portfolio : []) {
      const k = shareKeyOf(it);
      if (!k || map[k]) continue;
      const u = normalizeUserCategory(it.userCategory);
      if (u) map[k] = u;
    }
  }
  return map;
}

// 이 행의 사용자 구분 — 자기 값, 없으면 다른 계좌의 같은 종목 값.
export function effectiveUserCategory(item: any, shared?: Record<string, string> | null): string {
  if (!item || item.type === 'deposit') return '';
  const own = normalizeUserCategory(item.userCategory);
  if (own) return own;
  const k = shareKeyOf(item);
  return (k && shared && typeof shared === 'object' && typeof shared[k] === 'string') ? shared[k] : '';
}

// 자산군 보기의 묶음 이름 — usePortfolioData의 기존 규칙 그대로(예수금 행은 '예수금', 빈 구분은 '미지정').
export function baseCategoryOf(item: any): string {
  if (!item) return '미지정';
  return item.type === 'deposit' ? '예수금' : (item.category || '미지정');
}

export function groupCategoryOf(item: any, view: unknown, shared?: Record<string, string> | null): string {
  const base = baseCategoryOf(item);
  if (normalizeCategoryView(view) !== 'user' || !item || item.type === 'deposit') return base;
  return effectiveUserCategory(item, shared) || base;
}

// 이 계좌에서 쓰는 사용자 구분 목록(처음 나온 순서, 중복 없음).
export function userCategoryList(items: any[], shared?: Record<string, string> | null): string[] {
  const out: string[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    const u = effectiveUserCategory(it, shared);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

// 이름 목록(전 계좌 공유 값 먼저 + 이 계좌 값) — 입력 칸의 고르기 목록·색 순번. 같은 이름은 어느 계좌에서든 같은 색.
export function userCategoryNames(items: any[], shared?: Record<string, string> | null): string[] {
  const out: string[] = [];
  const push = (u: string) => { if (u && !out.includes(u)) out.push(u); };
  if (shared && typeof shared === 'object') Object.values(shared).forEach(v => push(normalizeUserCategory(v)));
  userCategoryList(items, shared).forEach(push);
  return out;
}

// 사용자 구분 이름의 색 — 목록 순번으로 팔레트를 돈다(표 칸과 자산 비중 표가 같은 색을 쓴다).
export function userCategoryColor(name: string, list: string[], palette: string[]): string {
  if (!Array.isArray(palette) || palette.length === 0) return '';
  const i = Array.isArray(list) ? list.indexOf(normalizeUserCategory(name)) : -1;
  return i < 0 ? '' : palette[i % palette.length];
}

// 구분(category)·사용자 구분(userCategory) 쓰기 — 원래 행 + 살아 있는 모든 계좌의 같은 종목.
// dc-irp 계좌의 다른 행에 구분을 옮겨 쓸 때는 D/S도 구분 칸과 같은 규칙으로 맞춘다(원래 행은 구분 칸이 직접 쓴다).
// 바뀐 것이 없으면 입력 배열을 그대로 돌려준다(불필요한 저장 방지).
export function applySharedCategory(portfolios: any, pid: string, itemId: string, field: string, value: unknown): any {
  if (!SHARED_CATEGORY_FIELDS.includes(field) || !Array.isArray(portfolios)) return portfolios;
  const srcAcct = portfolios.find(p => p && p.id === pid);
  const src = srcAcct && Array.isArray(srcAcct.portfolio) ? srcAcct.portfolio.find((it: any) => it && it.id === itemId) : null;
  if (!src) return portfolios;
  const v = field === 'userCategory' ? normalizeUserCategory(value) : value;
  const key = shareKeyOf(src);
  let any = false;
  const next = portfolios.map(p => {
    if (!p || !Array.isArray(p.portfolio)) return p;
    const isSrcAcct = p.id === pid;
    if (!isSrcAcct && p.deletedAt) return p;
    let changed = false;
    const items = p.portfolio.map((it: any) => {
      if (!it) return it;
      const isSrc = isSrcAcct && it.id === itemId;
      if (!isSrc && !(key && shareKeyOf(it) === key)) return it;
      const syncClass = !isSrc && field === 'category' && p.accountType === 'dc-irp';
      const cls = syncClass ? assetClassOfCategory(v) : it.assetClass;
      if (it[field] === v && it.assetClass === cls) return it;
      changed = true;
      return syncClass ? { ...it, [field]: v, assetClass: cls } : { ...it, [field]: v };
    });
    if (!changed) return p;
    any = true;
    return { ...p, portfolio: items };
  });
  return any ? next : portfolios;
}

// 다른 행(살아 있는 계좌, 자기 자신 제외)에 같은 종목이 있으면 그 구분 — 새로 넣은 종목이 이어받는다. 없으면 ''.
export function sharedCategoryOf(portfolios: any, item: any, excludeId?: string): string {
  const key = shareKeyOf(item);
  if (!key) return '';
  for (const p of liveAccounts(portfolios)) {
    for (const it of Array.isArray(p.portfolio) ? p.portfolio : []) {
      if (!it || (excludeId && it.id === excludeId) || shareKeyOf(it) !== key) continue;
      if (it.category) return String(it.category);
    }
  }
  return '';
}

// 코드를 새로 넣거나 바꾼 행이 다른 계좌의 같은 종목 구분을 이어받는다(dc-irp면 D/S도 함께). 바뀐 것이 없으면 입력 그대로.
export function inheritSharedCategory(portfolios: any, pid: string, itemId: string): any {
  if (!Array.isArray(portfolios)) return portfolios;
  const acct = portfolios.find(p => p && p.id === pid);
  const item = acct && Array.isArray(acct.portfolio) ? acct.portfolio.find((it: any) => it && it.id === itemId) : null;
  if (!item || item.type !== 'stock') return portfolios;
  const cat = sharedCategoryOf(portfolios, item, itemId);
  if (!cat || cat === item.category) return portfolios;
  const patch: any = { category: cat };
  if (acct.accountType === 'dc-irp') patch.assetClass = assetClassOfCategory(cat);
  return portfolios.map(p => (p !== acct ? p : {
    ...p,
    portfolio: p.portfolio.map((it: any) => (it && it.id === itemId ? { ...it, ...patch } : it)),
  }));
}
