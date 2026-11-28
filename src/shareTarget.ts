// 안드로이드 「공유」로 캡처 받기(사용자 요청 2026-11-28 「캡처 → 공유 → 바로 읽기」) — 화면 쪽 도구.
// 흐름: 홈 화면에 설치한 앱(public/manifest.webmanifest 의 share_target) → 증권사 앱에서 캡처 → 공유 → 「자산관리」
//   → 서비스 워커(public/sw.js)가 POST /share-target 의 사진을 이 기기 브라우저 저장소(Cache Storage)에 잠깐 두고 /?shared=N 으로 넘김
//   → 앱이 부팅 정착 뒤 takeSharedPhotos()로 꺼내며 바로 지움 → 휴대폰 화면이 계좌를 묻고 → 사진 맞추기 창이 바로 프로그램 읽기(OCR).
// ⚠️ 사진은 서버로 보내지 않는다(서비스 워커는 받기만 · 앱이 꺼내자마자 지움 · 30분 넘은 것은 버림).
// ⚠️ 아이폰은 웹 공유 받기를 지원하지 않는다 — 서비스 워커도 안드로이드에서만 등록한다.
// ⚠️ import 0 — verify:mobile-view 가 직접 import하고, 이름·주소가 sw.js·manifest와 같은지 대조한다.

export const SHARE_PATH = '/share-target';
export const SHARE_CACHE = 'ass-share-v1';
export const SHARE_FIELD = 'photos';
export const SHARE_MAX = 10;
export const SHARE_TTL_MS = 30 * 60 * 1000;
export const SHARE_PARAM = 'shared';
export const SHARE_SW_URL = '/sw.js';

export function isAndroidUA(ua: unknown): boolean {
  return /Android/i.test(String(ua || ''));
}

// 받은 지 30분 안(기기 시계가 조금 앞서도 1분까지는 받아 줌)
export function shareFresh(at: unknown, now: number): boolean {
  const t = Number(at);
  return Number.isFinite(t) && t > 0 && now - t >= -60000 && now - t <= SHARE_TTL_MS;
}

// 저장 칸 주소 …/__share/<차례> → 차례(아니면 -1)
export function shareIndexOf(url: unknown): number {
  const m = /\/__share\/(\d+)$/.exec(String(url || ''));
  return m ? Number(m[1]) : -1;
}

// 주소에서 ?shared= 만 뺀 경로(없으면 null) — 새로고침해도 다시 묻지 않게
export function withoutShareParam(href: string): string | null {
  try {
    const u = new URL(href);
    if (!u.searchParams.has(SHARE_PARAM)) return null;
    u.searchParams.delete(SHARE_PARAM);
    return u.pathname + u.search + u.hash;
  } catch { return null; }
}

// 받은 캡처를 꺼낸다(꺼내면서 저장소를 지운다). store = Cache Storage(검사는 가짜를 넣는다).
export async function takeSharedPhotos(store?: any, now: number = Date.now()): Promise<File[]> {
  const cs = store || (typeof caches !== 'undefined' ? caches : null);
  if (!cs) return [];
  try {
    if (!(await cs.has(SHARE_CACHE))) return [];
    const cache = await cs.open(SHARE_CACHE);
    const keys = (await cache.keys()).map((r: any) => ({ r, i: shareIndexOf(r.url) })).filter((k: any) => k.i >= 0).sort((a: any, b: any) => a.i - b.i);
    const out: File[] = [];
    for (const { r, i } of keys) {
      const res = await cache.match(r);
      if (!res || !shareFresh(res.headers.get('X-Share-At'), now)) continue;
      const blob = await res.blob();
      const type = blob.type || res.headers.get('Content-Type') || '';
      if (!/^image\//.test(type)) continue;
      let name = '';
      try { name = decodeURIComponent(res.headers.get('X-Share-Name') || ''); } catch { name = ''; }
      out.push(new File([blob], name || `shared-${i + 1}.png`, { type }));
      if (out.length >= SHARE_MAX) break;
    }
    await cs.delete(SHARE_CACHE);
    return out;
  } catch {
    try { await cs.delete(SHARE_CACHE); } catch { /* 지우지 못함 — 30분 뒤 버려진다 */ }
    return [];
  }
}

// 서비스 워커 등록 — 안드로이드만(공유 받기는 안드로이드만 된다). 화면이 다 뜬 뒤에 등록해 첫 화면을 늦추지 않는다.
export function registerShareWorker(
  nav: any = typeof navigator !== 'undefined' ? navigator : null,
  doc: any = typeof document !== 'undefined' ? document : null,
  win: any = typeof window !== 'undefined' ? window : null,
): boolean {
  if (!nav || !nav.serviceWorker || !isAndroidUA(nav.userAgent)) return false;
  const go = () => { try { nav.serviceWorker.register(SHARE_SW_URL, { scope: '/' }).catch(() => {}); } catch { /* 등록 못 함 — 공유 받기만 안 됨 */ } };
  if (doc && doc.readyState === 'complete') go();
  else if (win) win.addEventListener('load', go, { once: true });
  else go();
  return true;
}
