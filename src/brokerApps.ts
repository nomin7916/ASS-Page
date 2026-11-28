// 증권사 앱 열기(사용자 요청 2026-11-28 「증권사 앱을 지정하고 열고 화면을 캡처하면 바로 넣기」 — 사이트 안에서).
// 계좌마다 증권사 앱을 한 번 고르면(이 기기 저장소 한 칸) 사진 맞추기 창·휴대폰 화면 위 카메라가 그 앱을 연다 →
// 캡처하고 돌아오면 사진 맞추기 창의 카메라 칸이 빛나고 → 누르면 맨 앞 캡처를 골라 바로 읽기(OCR).
// 여는 주소(2026-11-28 확인):
//   아이폰 — 증권사 앱의 공개 주소(URL 스킴)가 없어 App Store 쪽 화면(「열기」 한 번 더) · 토스만 공개 스킴 supertoss://(토스페이먼츠 개발자 블로그).
//   안드로이드 — 패키지 이름으로 바로(없으면 Play 스토어) · 패키지를 확인 못 한 앱(M-STOCK)은 Play 스토어 검색.
//   App Store 번호: apps.apple.com(M-STOCK 1248716281 · 영웅문S# 1570370057 · 한투 1621986905 · 토스 839333328).
// ⚠️ 고른 앱은 이 기기 localStorage 한 칸(계좌 id → 앱 id)만 — 화면 설정이라 Drive·STATE에 두지 않는다(앱 설치는 기기마다 다르다).
// ⚠️ import 0 — verify:mobile-view 가 직접 import한다.

export type BrokerApp = { id: string; name: string; iosId: string; iosScheme?: string; android?: string; androidSearch?: string };

export const BROKER_APPS: BrokerApp[] = [
  { id: 'mstock', name: 'M-STOCK', iosId: '1248716281', androidSearch: '미래에셋증권 M-STOCK' },
  { id: 'kiwoom', name: '영웅문S#', iosId: '1570370057', android: 'com.kiwoom.heromts' },
  { id: 'kis', name: '한국투자', iosId: '1621986905', android: 'com.truefriend.neosmartarenewal' },
  { id: 'toss', name: '토스증권', iosId: '839333328', iosScheme: 'supertoss://', android: 'viva.republica.toss' },
];

export const BROKER_KEY = 'assPage:brokerApp:v1';
const BROKER_MAX = 60;

// 'ios' | 'android' | ''(PC — 앱을 열지 않는다). 아이패드는 맥 글자를 쓰므로 터치 수로 가린다.
export function platformOf(ua: unknown, maxTouchPoints: unknown = 0): 'ios' | 'android' | '' {
  const s = String(ua || '');
  if (/Android/i.test(s)) return 'android';
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Macintosh/i.test(s) && Number(maxTouchPoints) > 1) return 'ios';
  return '';
}

export function brokerAppById(id: unknown): BrokerApp | null {
  return BROKER_APPS.find(a => a.id === id) || null;
}

export function brokerAppUrl(app: BrokerApp | null, platform: string): string {
  if (!app) return '';
  if (platform === 'ios') return app.iosScheme || `https://apps.apple.com/kr/app/id${app.iosId}`;
  if (platform === 'android') {
    if (app.android) {
      const store = `https://play.google.com/store/apps/details?id=${app.android}`;
      return `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${app.android};S.browser_fallback_url=${encodeURIComponent(store)};end`;
    }
    return `https://play.google.com/store/search?q=${encodeURIComponent(app.androidSearch || app.name)}&c=apps`;
  }
  return '';
}

export function localStore(): any {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function readBrokerMap(storage: any): Record<string, string> {
  try {
    const raw = storage ? storage.getItem(BROKER_KEY) : null;
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, id] of Object.entries(v)) if (k && brokerAppById(id)) out[k] = String(id);
    return out;
  } catch { return {}; }
}

export function brokerAppOf(storage: any, accountId: unknown): BrokerApp | null {
  if (!accountId) return null;
  return brokerAppById(readBrokerMap(storage)[String(accountId)]);
}

// appId 가 없거나 모르는 앱이면 그 계좌 칸을 지운다. 계좌가 많아도 최근 BROKER_MAX 개까지만.
export function writeBrokerApp(storage: any, accountId: unknown, appId: unknown): void {
  try {
    if (!storage || !accountId) return;
    const map = readBrokerMap(storage);
    const k = String(accountId);
    delete map[k];
    if (brokerAppById(appId)) map[k] = String(appId);
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
