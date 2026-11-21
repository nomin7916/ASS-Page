// 새 디자인(인디고 나이트) 시범 적용 — 관리자 계정만 켜고 끌 수 있다(사용자 확정 2026-11-21).
// ⚠️ import 0 — verify:ui-theme가 직접 import한다.
// ⚠️ 켜짐 여부는 이 기기의 브라우저 저장소 한 칸에만 둔다(Drive·STATE 금지 — 화면 모양 설정이라 계좌 데이터가 아니다).
//    다른 계정이 같은 기기로 로그인해도 isUiThemeEligible이 막으므로 그 사람 화면은 늘 이전 화면이다.
// ⚠️ 되돌리는 길은 둘: 위 막대의 '새 디자인' 버튼 · 주소 끝 ?ui=classic(저장값까지 지운다 — 새 화면이 깨져 버튼이 안 보일 때).
export const UI_THEME_KEY = 'assPage:uiTheme:v1';
export const UI_THEME_ON = 'indigo';
export const UI_THEME_CLASS = 'ui-indigo';
export const UI_THEME_FONT_ID = 'ui-indigo-font';
export const UI_THEME_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&display=swap';

export function isUiThemeEligible(email: string | null | undefined, adminEmail: string | null | undefined): boolean {
  if (!email || !adminEmail) return false;
  return String(email).trim().toLowerCase() === String(adminEmail).trim().toLowerCase();
}

export function isForcedClassic(search: string | null | undefined): boolean {
  return /(?:^|[?&])ui=classic(?:&|$)/.test(search || '');
}

export function readUiThemePref(storage: any): boolean {
  try { return !!storage && storage.getItem(UI_THEME_KEY) === UI_THEME_ON; } catch { return false; }
}

export function writeUiThemePref(storage: any, on: boolean): void {
  try {
    if (!storage) return;
    if (on) storage.setItem(UI_THEME_KEY, UI_THEME_ON); else storage.removeItem(UI_THEME_KEY);
  } catch { /* 저장소를 못 쓰는 창(사생활 보호 모드 등)에서는 이번 탭에서만 유지 */ }
}

export function resolveUiTheme(eligible: boolean, stored: boolean, search: string | null | undefined): boolean {
  if (!eligible) return false;
  if (isForcedClassic(search)) return false;
  return !!stored;
}

export function initialUiThemePref(storage: any, search: string | null | undefined): boolean {
  if (isForcedClassic(search)) { writeUiThemePref(storage, false); return false; }
  return readUiThemePref(storage);
}

export function applyUiThemeToDocument(doc: any, on: boolean): void {
  if (!doc || !doc.documentElement) return;
  doc.documentElement.classList.toggle(UI_THEME_CLASS, !!on);
  if (!on || doc.getElementById(UI_THEME_FONT_ID)) return;
  const link = doc.createElement('link');
  link.id = UI_THEME_FONT_ID;
  link.rel = 'stylesheet';
  link.href = UI_THEME_FONT_HREF;
  doc.head.appendChild(link);
}
