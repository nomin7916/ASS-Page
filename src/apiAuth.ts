// ── 서버 경로(/api/…) 로그인 토큰 관문 (⚠️ 회귀 주의 — CLAUDE.md '서버 경로 로그인·승인 확인' 절) ──
// 서버(api/_auth.ts)는 X-App-Token 헤더의 구글 로그인 토큰을 확인하고, 없거나 틀리면 401 · 미승인 계정이면 403을 준다
// (403은 재발급해도 같으므로 다시 보내지 않는다).
// 호출 지점(70곳 넘음, 대체 경로 배열 포함)을 하나씩 고치지 않고 fetch를 한 번 감싸 '같은 출처 /api/…'에만 토큰을 붙인다
// — 새 호출 지점도 자동으로 덮인다. main.tsx가 렌더 전에 installApiAuth를 부른다.
// - 앱 탭('app'): App이 registerApiAuth로 로그인 토큰(driveTokenRef)과 무음 재발급을 등록한다. 로그인 전엔 토큰이 없어
//   서버를 부르지 않고 바로 401을 돌려준다(지수 시세 등은 다음 대체 경로로 넘어간다).
// - 별도 창('window'): App을 마운트하지 않으므로 opener에게 postMessage(apiauth:want → apiauth:token)로 받아 메모리에만 둔다
//   (브라우저 저장소 금지 — 다른 계정 로그인 시 오염). 창이 다시 연 창(관심종목 창 → 종목 차트 창)은 자기 opener에게 물어 전달한다.
//   opener가 닫혀도 받아 둔 토큰이 끝날 때(최대 1시간)까지는 그대로 쓴다.
// - 401을 받으면 한 번만 새 토큰을 받아 다시 보낸다(앱 탭: GIS 무음 재발급 · 창: '이 토큰은 만료'를 실어 opener에게 다시 요청).
// ⚠️ Authorization 헤더로 바꾸지 말 것 — Vercel CDN 캐시가 꺼진다(api/_auth.ts 머리말).
// ⚠️ OPEN_PATHS = 서버가 토큰을 확인하지 않는 경로(로그인 화면에서도 부른다). verify:api-auth가 서버 쪽과 대조한다.

export const AUTH_HEADER = 'X-App-Token';
export const OPEN_PATHS = ['/api/market-calendar'];

type Mode = 'app' | 'window';
type Getter = () => string | null | undefined;
type Refresher = () => Promise<string | null>;

let mode: Mode = 'app';
let installed = false;
let rawFetch: typeof fetch;
let getter: Getter = () => '';
let refresher: Refresher | null = null;
let held = '';      // 창: opener에게 받은 토큰 · 앱 탭: 무음 재발급으로 받은 토큰(관리자 접속 중엔 driveTokenRef가 그대로다)
let heldBase = '';  // 앱 탭: held를 받을 때의 getter 값 — getter가 바뀌면(앱이 새 토큰을 받음) held는 낡은 것이라 버린다
const bad = new Set<string>();   // 401을 받은 토큰(최근 20개)
let renewing: Promise<string> | null = null;
let obtaining: Promise<string> | null = null;
let seq = 0;

export function registerApiAuth(get: Getter, refresh: Refresher | null): void {
  getter = get;
  refresher = refresh;
}

const denied = () => new Response(JSON.stringify({ error: 'auth required' }), {
  status: 401,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

function isProtected(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url;
  if (typeof raw !== 'string') return false;
  let u: URL;
  try { u = new URL(raw, window.location.href); } catch { return false; }
  return u.origin === window.location.origin && u.pathname.startsWith('/api/') && !OPEN_PATHS.includes(u.pathname);
}

function withToken(input: RequestInfo | URL, init: RequestInit | undefined, token: string): [RequestInfo | URL, RequestInit | undefined] {
  if (input instanceof Request) {
    const h = new Headers(input.headers);
    new Headers(init?.headers).forEach((v, k) => h.set(k, v));
    h.set(AUTH_HEADER, token);
    return [new Request(input, { ...init, headers: h }), undefined];
  }
  const h = new Headers(init?.headers);
  h.set(AUTH_HEADER, token);
  return [input, { ...init, headers: h }];
}

function askOpener(staleTok: string): Promise<string> {
  const op = window.opener as Window | null;
  if (!op || op.closed) return Promise.resolve('');
  const id = `${Date.now()}-${++seq}`;
  return new Promise<string>((resolve) => {
    const finish = (t: string) => {
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      resolve(t);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== op) return;
      const d = e.data;
      if (!d || d.type !== 'apiauth:token' || d.id !== id) return;
      finish(typeof d.token === 'string' ? d.token : '');
    };
    // 만료 표시가 있으면 opener가 무음 재발급(최대 15초)을 거칠 수 있어 더 기다린다
    const timer = setTimeout(() => finish(''), staleTok ? 20000 : 8000);
    window.addEventListener('message', onMsg);
    try { op.postMessage({ type: 'apiauth:want', id, stale: staleTok }, window.location.origin); } catch { finish(''); }
  });
}

function markBad(t: string): void {
  bad.delete(t);
  bad.add(t);
  if (bad.size > 20) bad.delete(bad.values().next().value as string);
}

function appToken(): string {
  const g = getter() || '';
  if (!g) return '';
  if (held && g !== heldBase) held = '';
  return held && !bad.has(held) ? held : g;
}

async function currentToken(): Promise<string> {
  if (mode === 'app') return appToken();
  if (held && !bad.has(held)) return held;
  if (renewing) return renewing;
  if (!obtaining) {
    obtaining = askOpener(held)
      .then((t) => { if (t) held = t; return t; })
      .finally(() => { obtaining = null; });
  }
  return obtaining;
}

function renew(failed: string): Promise<string> {
  markBad(failed);
  if (renewing) return renewing;
  renewing = (async () => {
    if (mode === 'window') {
      const t = await askOpener(failed);
      if (t) held = t;
      return t;
    }
    const cur = appToken();
    if (cur && !bad.has(cur)) return cur;
    if (!refresher) return '';
    const t = await Promise.race([
      refresher().catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
    if (t) { held = t; heldBase = getter() || ''; }
    return t || '';
  })().finally(() => { renewing = null; });
  return renewing;
}

async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isProtected(input)) return rawFetch(input, init);
  const spare = input instanceof Request ? input.clone() : input;
  const token = await currentToken();
  if (!token) return denied();
  const res = await rawFetch(...withToken(input, init, token));
  if (res.status !== 401) return res;
  const fresh = await renew(token);
  if (!fresh || fresh === token) return res;
  return rawFetch(...withToken(spare, init, fresh));
}

// 창이 토큰을 물으면 내 토큰으로 답한다(앱 탭이든, 자식 창을 연 창이든). 같은 출처만.
function onWant(e: MessageEvent): void {
  const d = e.data;
  if (!d || d.type !== 'apiauth:want' || e.origin !== window.location.origin || !e.source) return;
  const src = e.source as Window;
  const staleTok = typeof d.stale === 'string' ? d.stale : '';
  (async () => {
    let t = await currentToken();
    if (staleTok && (t === staleTok || bad.has(t))) t = await renew(staleTok);
    try { src.postMessage({ type: 'apiauth:token', id: d.id, token: t }, window.location.origin); } catch { /* 창이 닫힘 */ }
  })();
}

export function installApiAuth(m: Mode): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  mode = m;
  rawFetch = window.fetch.bind(window);
  window.fetch = authedFetch as typeof fetch;
  window.addEventListener('message', onWant);
}
