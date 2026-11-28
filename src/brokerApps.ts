// 증권사 앱 열기(사용자 요청 2026-11-28 「증권사 앱을 지정하고 열고 화면을 캡처하면 바로 넣기」 — 사이트 안에서).
// 사진 맞추기 창(휴대폰·태블릿): 이 계좌 앱 = 큰 단추 · 다른 앱·사용자가 더한 앱 = 작은 단추 · + = 앱 더하기(App Store·Play 스토어 링크 또는 앱 주소).
// 누른 앱이 이 계좌의 앱이 된다(다음에 크게) → 캡처하고 돌아오면 카메라 칸이 빛나고 → 누르면 맨 앞 캡처를 골라 바로 읽기(OCR).
// 여는 주소(2026-11-28 확인):
//   아이폰 — 증권사 앱의 공개 주소(URL 스킴)가 없어 App Store 쪽 화면(「열기」 한 번 더) · 토스만 공개 스킴 supertoss://(토스페이먼츠 개발자 블로그).
//   안드로이드 — 패키지 이름으로 바로(없으면 Play 스토어) · 패키지를 모르는 앱은 Play 스토어 검색.
//   App Store 번호: apps.apple.com(M-STOCK 1248716281 · 영웅문S# 1570370057 · 한투 1621986905 · 토스 839333328).
// ⚠️ 계좌 → 앱, 사용자가 더한 앱 목록은 이 기기 localStorage 두 칸만 — 화면 설정이라 Drive·STATE에 두지 않는다(앱 설치는 기기마다 다르다).
// ⚠️ 사용자가 넣은 앱 주소는 앱 스킴(xxx://)만 — http·javascript 등은 받지 않는다.
// ⚠️ import 0 — verify:mobile-view 가 직접 import한다.

export type BrokerApp = { id: string; name: string; iosId?: string; iosScheme?: string; android?: string; androidSearch?: string; scheme?: string; custom?: boolean };

export const BROKER_APPS: BrokerApp[] = [
  { id: 'mstock', name: 'M-STOCK', iosId: '1248716281', androidSearch: '미래에셋증권 M-STOCK' },
  { id: 'kiwoom', name: '영웅문S#', iosId: '1570370057', android: 'com.kiwoom.heromts' },
  { id: 'kis', name: '한국투자', iosId: '1621986905', android: 'com.truefriend.neosmartarenewal' },
  { id: 'toss', name: '토스증권', iosId: '839333328', iosScheme: 'supertoss://', android: 'viva.republica.toss' },
];

export const BROKER_KEY = 'assPage:brokerApp:v1';
export const BROKER_CUSTOM_KEY = 'assPage:brokerAppsCustom:v1';
export const BROKER_CUSTOM_MAX = 12;
export const BROKER_NAME_MAX = 12;
const BROKER_MAX = 60;
const BAD_SCHEMES = /^(https?|javascript|vbscript|data|file|blob|about|intent|ftp|ws|wss|chrome|content|filesystem):/i;

// 'ios' | 'android' | ''(PC — 앱을 열지 않는다). 아이패드는 맥 글자를 쓰므로 터치 수로 가린다.
export function platformOf(ua: unknown, maxTouchPoints: unknown = 0): 'ios' | 'android' | '' {
  const s = String(ua || '');
  if (/Android/i.test(s)) return 'android';
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Macintosh/i.test(s) && Number(maxTouchPoints) > 1) return 'ios';
  return '';
}

export function localStore(): any {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

// 사용자가 붙여넣은 글 → 앱 여는 정보. App Store 링크(id 숫자) · Play 스토어 링크(id=패키지) · 앱 주소(xxx://). 못 읽으면 null.
export function parseAppLink(text: unknown): { iosId?: string; android?: string; scheme?: string; guessName: string } | null {
  const t = String(text || '').trim();
  if (!t) return null;
  const apple = /(?:apps|itunes)\.apple\.com\/[^\s]*?\/id(\d{6,12})\b/i.exec(t) || /(?:apps|itunes)\.apple\.com\/[^\s]*?[?&]id=(\d{6,12})\b/i.exec(t) || /^(?:id)?(\d{6,12})$/i.exec(t);
  if (apple) {
    let guessName = '';
    const slug = /\/app\/([^/\s?#]+)\/id\d/i.exec(t);
    if (slug) { try { guessName = decodeURIComponent(slug[1]).split('-')[0].trim(); } catch { guessName = ''; } }
    return { iosId: apple[1], guessName: guessName.slice(0, BROKER_NAME_MAX) };
  }
  const play = /play\.google\.com\/store\/apps\/details\?(?:[^\s#]*&)?id=([A-Za-z][\w]*(?:\.[\w]+)+)/i.exec(t);
  if (play) return { android: play[1], guessName: '' };
  const sch = /^([a-z][a-z0-9+.-]{1,30}):\/\/[^\s]*$/i.exec(t);
  if (sch && !BAD_SCHEMES.test(t)) return { scheme: t, guessName: sch[1].slice(0, BROKER_NAME_MAX) };
  return null;
}

function cleanCustom(v: any): BrokerApp | null {
  if (!v || typeof v !== 'object') return null;
  const id = String(v.id || '');
  const name = String(v.name || '').trim().slice(0, BROKER_NAME_MAX);
  if (!/^c_[\w-]{1,40}$/.test(id) || !name) return null;
  const out: BrokerApp = { id, name, custom: true };
  if (/^\d{6,12}$/.test(String(v.iosId || ''))) out.iosId = String(v.iosId);
  if (/^[A-Za-z][\w]*(\.[\w]+)+$/.test(String(v.android || ''))) out.android = String(v.android);
  if (v.scheme && parseAppLink(v.scheme)?.scheme) out.scheme = String(v.scheme);
  return out.iosId || out.android || out.scheme ? out : null;
}

export function readCustomApps(storage: any): BrokerApp[] {
  try {
    const raw = storage ? storage.getItem(BROKER_CUSTOM_KEY) : null;
    const v = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    return v.map(cleanCustom).filter((a): a is BrokerApp => !!a && !seen.has(a.id) && (seen.add(a.id), true)).slice(0, BROKER_CUSTOM_MAX);
  } catch { return []; }
}

function writeCustomApps(storage: any, list: BrokerApp[]): void {
  try {
    if (!storage) return;
    if (list.length) storage.setItem(BROKER_CUSTOM_KEY, JSON.stringify(list.map(({ custom, ...a }) => a)));
    else storage.removeItem(BROKER_CUSTOM_KEY);
  } catch { /* 저장소를 못 쓰는 창 */ }
}

export function allBrokerApps(storage: any): BrokerApp[] {
  return [...BROKER_APPS, ...readCustomApps(storage)];
}

export function brokerAppById(id: unknown, list: BrokerApp[] = BROKER_APPS): BrokerApp | null {
  return list.find(a => a.id === id) || null;
}

// 앱 더하기 — 이름이 비면 링크에서 짐작. 반환 { app } 또는 { error }.
export function addCustomApp(storage: any, name: unknown, link: unknown, newId: string): { app?: BrokerApp; error?: string } {
  const p = parseAppLink(link);
  if (!p) return { error: 'link' };
  const nm = String(name || '').trim().slice(0, BROKER_NAME_MAX) || p.guessName;
  if (!nm) return { error: 'name' };
  const list = readCustomApps(storage);
  if (list.length >= BROKER_CUSTOM_MAX) return { error: 'full' };
  const app = cleanCustom({ id: newId, name: nm, iosId: p.iosId, android: p.android, scheme: p.scheme });
  if (!app) return { error: 'link' };
  writeCustomApps(storage, [...list, app]);
  return { app };
}

// 앱 지우기 — 그 앱을 고른 계좌 칸도 지운다. 처음 넷(BROKER_APPS)은 지우지 않는다.
export function removeCustomApp(storage: any, id: unknown): void {
  const list = readCustomApps(storage);
  const next = list.filter(a => a.id !== id);
  if (next.length === list.length) return;
  writeCustomApps(storage, next);
  try {
    const raw = storage ? storage.getItem(BROKER_KEY) : null;
    const map = raw ? JSON.parse(raw) : null;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const k of Object.keys(map)) if (map[k] === id) delete map[k];
      if (Object.keys(map).length) storage.setItem(BROKER_KEY, JSON.stringify(map)); else storage.removeItem(BROKER_KEY);
    }
  } catch { /* 저장소를 못 쓰는 창 */ }
}

export function brokerAppUrl(app: BrokerApp | null, platform: string): string {
  if (!app) return '';
  if (platform !== 'ios' && platform !== 'android') return '';
  if (app.scheme) return app.scheme;
  if (platform === 'ios') return app.iosScheme || (app.iosId ? `https://apps.apple.com/kr/app/id${app.iosId}` : '');
  if (app.android) {
    const store = `https://play.google.com/store/apps/details?id=${app.android}`;
    return `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${app.android};S.browser_fallback_url=${encodeURIComponent(store)};end`;
  }
  return `https://play.google.com/store/search?q=${encodeURIComponent(app.androidSearch || app.name)}&c=apps`;
}

// 이 기기에서 열 수 있는 앱만(아이폰에 안드로이드 링크만 넣은 앱은 빼기)
export function appsForPlatform(list: BrokerApp[], platform: string): BrokerApp[] {
  return list.filter(a => !!brokerAppUrl(a, platform));
}

export function readBrokerMap(storage: any): Record<string, string> {
  try {
    const raw = storage ? storage.getItem(BROKER_KEY) : null;
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const all = allBrokerApps(storage);
    const out: Record<string, string> = {};
    for (const [k, id] of Object.entries(v)) if (k && brokerAppById(id, all)) out[k] = String(id);
    return out;
  } catch { return {}; }
}

export function brokerAppOf(storage: any, accountId: unknown): BrokerApp | null {
  if (!accountId) return null;
  return brokerAppById(readBrokerMap(storage)[String(accountId)], allBrokerApps(storage));
}

// appId 가 없거나 모르는 앱이면 그 계좌 칸을 지운다. 계좌가 많아도 최근 BROKER_MAX 개까지만.
export function writeBrokerApp(storage: any, accountId: unknown, appId: unknown): void {
  try {
    if (!storage || !accountId) return;
    const map = readBrokerMap(storage);
    const k = String(accountId);
    delete map[k];
    if (brokerAppById(appId, allBrokerApps(storage))) map[k] = String(appId);
    const keys = Object.keys(map);
    const keep = keys.slice(Math.max(0, keys.length - BROKER_MAX));
    const next: Record<string, string> = {};
    keep.forEach(key => { next[key] = map[key]; });
    if (keep.length) storage.setItem(BROKER_KEY, JSON.stringify(next)); else storage.removeItem(BROKER_KEY);
  } catch { /* 저장소를 못 쓰는 창 — 이번 화면에서만 */ }
}

// 고른 앱 열기 — 누름(클릭) 안에서 부른다(휴대폰이 다른 앱 열기를 허락하는 때).
export function openBrokerApp(app: BrokerApp | null, platform: string, win: any = typeof window !== 'undefined' ? window : null): boolean {
  const url = brokerAppUrl(app, platform);
  if (!url || !win) return false;
  try { win.location.href = url; return true; } catch { return false; }
}
