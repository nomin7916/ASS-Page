// 서버 경로 호출자 확인 (⚠️ 회귀 주의 — CLAUDE.md '서버 경로 로그인 확인' 절)
// 사이트 주소만 알면 누구나 /api/…를 불러 관리자의 KIS·FRED·ECOS·구글 키 한도와 Redis를 소모할 수 있었다(2026-11-05).
// 요청 헤더 X-App-Token(구글 로그인 액세스 토큰)을 구글 tokeninfo로 확인한다 —
//   이 앱(CLIENT_ID)에서 발급됐고 이메일이 확인된 토큰만 통과(승인 스크립트 verifyCaller와 같은 기준).
// ⚠️ Authorization 헤더로 바꾸지 말 것 — Vercel CDN은 Authorization이 붙은 요청을 캐시하지 않아 s-maxage 캐시가
//    통째로 꺼진다(= 외부 호출이 오히려 늘어난다). CDN 캐시 키는 주소뿐이라 이미 캐시된 공개 시세는 토큰 없이도 나간다
//    — 그때는 함수가 돌지 않으므로 키 한도를 쓰지 않는다. 주소를 바꿔 캐시를 피하면 함수가 돌고 여기서 막힌다.
// 서버끼리 부르는 호출(/api/history·/api/indicators → /api/fred)은 내부 키(X-App-Internal)로 통과한다 —
//   서버 비밀값들에서 만든 해시라 밖에서 알 수 없고, 사용자 토큰을 함수 깊숙이 넘기지 않아도 된다.
// 확인 결과는 토큰 해시별로 이 인스턴스 메모리에 둔다(통과 최대 10분·토큰 남은 수명 안 · 거부 1분). 토큰 원문은 기록하지 않는다.
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-api-auth.mjs가 Node 타입 스트리핑으로 직접 import한다.

export const AUTH_HEADER = 'x-app-token';
export const INTERNAL_HEADER = 'x-app-internal';
// src/config.ts GOOGLE_CLIENT_ID와 같아야 한다(verify:api-auth가 대조)
export const CLIENT_ID = '972766008827-am47e7998m6o299d15gkul2p2r5btkff.apps.googleusercontent.com';

const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{20,4096}$/;
const OK_TTL_MAX = 600_000;
const BAD_TTL = 60_000;
const CACHE_MAX = 2000;

type Verdict = { ok: true; email: string; until: number } | { ok: false; until: number };
const cache = new Map<string, Verdict>();
const inflight = new Map<string, Promise<Verdict | null>>();

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// null = 확인 불가(구글 무응답·5xx·429) — 캐시하지 않고 503으로 답한다
async function askGoogle(token: string): Promise<Verdict | null> {
  let res: Response;
  try {
    res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(5000) });
  } catch {
    return null;
  }
  const now = Date.now();
  if (res.status >= 500 || res.status === 429) return null;
  if (!res.ok) return { ok: false, until: now + BAD_TTL };
  let info: any;
  try { info = await res.json(); } catch { return null; }
  const left = Number(info?.expires_in) || 0;
  const email = String(info?.email || '').trim().toLowerCase();
  if (info?.aud !== CLIENT_ID || String(info?.email_verified) !== 'true' || !email || left <= 30) {
    return { ok: false, until: now + BAD_TTL };
  }
  return { ok: true, email, until: now + Math.min(OK_TTL_MAX, (left - 30) * 1000) };
}

function remember(key: string, v: Verdict): void {
  if (cache.size >= CACHE_MAX) {
    const now = Date.now();
    for (const [k, e] of cache) if (e.until <= now) cache.delete(k);
    if (cache.size >= CACHE_MAX) cache.clear();
  }
  cache.set(key, v);
}

async function verifyToken(token: string): Promise<Verdict | null> {
  const key = await sha256Hex(token);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit;
  let p = inflight.get(key);
  if (!p) {
    p = askGoogle(token).then(v => { if (v) remember(key, v); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

const SECRET_SEED = [
  process.env.API_INTERNAL_KEY, process.env.KIS_APP_SECRET, process.env.FRED_API_KEY,
  process.env.UPSTASH_REDIS_REST_TOKEN, process.env.KV_REST_API_TOKEN, process.env.ECOS_API_KEY, process.env.GOOGLE_API_KEY,
].filter(Boolean).join('|');
let internalKeyP: Promise<string> | null = null;
function internalKey(): Promise<string> {
  if (!SECRET_SEED) return Promise.resolve('');
  if (!internalKeyP) internalKeyP = sha256Hex(`ass-api-internal-v1|${SECRET_SEED}`);
  return internalKeyP;
}

// 같은 배포의 다른 경로를 서버에서 부를 때 붙이는 헤더(서버 비밀값이 하나도 없으면 빈 객체 — 받는 쪽이 거부한다)
export async function internalAuthHeaders(): Promise<Record<string, string>> {
  const k = await internalKey();
  return k ? { [INTERNAL_HEADER]: k } : {};
}

const deny = (status: number, error: string) => new Response(JSON.stringify({ error }), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

// 통과면 null, 아니면 그대로 돌려줄 응답(401 토큰 없음·틀림 / 503 구글 확인 불가). 처리부 첫 줄에서 부른다:
//   const denied = await requireAuth(request); if (denied) return denied;
// allowInternal: 서버 내부 호출(내부 키)도 받는다 — /api/fred 전용.
export async function requireAuth(req: Request, opts: { allowInternal?: boolean } = {}): Promise<Response | null> {
  if (opts.allowInternal) {
    const got = req.headers.get(INTERNAL_HEADER) || '';
    if (got) {
      const k = await internalKey();
      if (k && safeEqual(got, k)) return null;
    }
  }
  const token = (req.headers.get(AUTH_HEADER) || '').trim();
  if (!TOKEN_RE.test(token)) return deny(401, 'auth required');
  const v = await verifyToken(token);
  if (!v) {
    console.error('[auth] tokeninfo 확인 불가');
    return deny(503, 'auth unavailable');
  }
  return v.ok ? null : deny(401, 'auth required');
}
