// 자산관리 서비스 워커 — 안드로이드 「공유」로 받은 캡처만 다룬다(사용자 요청 2026-11-28 「캡처 → 공유 → 바로 읽기」).
// ⚠️ 캐시·오프라인 없음: 공유 주소(POST /share-target) 말고는 손대지 않는다 — 앱 화면·시세는 늘 서버에서 받는다.
// ⚠️ 받은 사진은 서버로 보내지 않는다 — 이 기기 브라우저 저장소에 잠깐 두면 앱(src/shareTarget.ts)이 꺼내며 지운다.
// 이름·주소는 src/shareTarget.ts·manifest.webmanifest 와 같아야 한다(verify:mobile-view 가 대조).
const SHARE_PATH = '/share-target';
const SHARE_CACHE = 'ass-share-v1';
const SHARE_FIELD = 'photos';
const SHARE_MAX = 10;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // 크롬 123+: 공유 주소만 서비스 워커를 거치고 나머지는 곧장 네트워크로 — 화면·시세 요청이 느려지지 않게.
  if (event.addRoutes && typeof URLPattern !== 'undefined') {
    event.waitUntil(event.addRoutes([
      { condition: { urlPattern: new URLPattern({ pathname: SHARE_PATH }) }, source: 'fetch-event' },
      { condition: { urlPattern: new URLPattern({ pathname: '*' }) }, source: 'network' },
    ]).catch(() => {}));
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'POST') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname !== SHARE_PATH) return;
  event.respondWith(takeShare(req));
});

async function takeShare(req) {
  let n = 0;
  try {
    const form = await req.formData();
    const files = form.getAll(SHARE_FIELD).filter((f) => f && typeof f === 'object' && /^image\//.test(f.type || '')).slice(0, SHARE_MAX);
    await caches.delete(SHARE_CACHE);
    if (files.length) {
      const cache = await caches.open(SHARE_CACHE);
      const at = String(Date.now());
      for (const f of files) {
        await cache.put(new URL(`/__share/${n}`, self.location.origin).href, new Response(f, {
          headers: { 'Content-Type': f.type, 'X-Share-At': at, 'X-Share-Name': encodeURIComponent(f.name || '') },
        }));
        n++;
      }
    }
  } catch (e) {
    n = 0;
  }
  return Response.redirect(new URL(`/?shared=${n}`, self.location.origin).href, 303);
}
