// KIS OpenAPI 접근토큰 공유 헬퍼 (Edge 호환 — fetch만 사용, SDK 의존성 없음)
//
// 배경: KIS는 앱키당 토큰 발급을 분당 1회로 제한한다. 토큰은 ~24h 유효.
// 같은 앱키를 쓰는 여러 Vercel 프로젝트(배포용/업데이트용) + 여러 엔드포인트 +
// Edge 콜드 아이솔레이트가 각자 발급하면 분당 1회 제한에 걸려 전건 503이 난다.
//
// 해결: Upstash Redis(REST) = Vercel KV 를 "프로젝트·아이솔레이트 공유 토큰 저장소"로
// 사용한다. 앱키가 같으면 어느 프로젝트에서 발급하든 토큰 1개를 모두가 재사용 →
// ~24h에 1회만 발급. 저장소 미설정/장애 시엔 인메모리 폴백으로 안전하게 동작.
//
// 필요한 env (배포용·업데이트용 두 프로젝트에 동일 값으로 설정):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   (Vercel KV 통합 사용 시 KV_REST_API_URL / KV_REST_API_TOKEN 도 자동 인식)

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY = process.env.KIS_APP_KEY ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? '';
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? '';

// 앱키별로 키 분리 (방법 A로 앱키를 나눠도 충돌 없게). 시크릿은 키에 넣지 않음.
const NS = `kis:token:${KIS_APP_KEY.slice(0, 10) || 'none'}`;
const TOKEN_KEY = `${NS}:v1`;
const LOCK_KEY = `${NS}:lock`;

// L1: 아이솔레이트 인메모리 캐시 (Redis 왕복 최소화)
let _token: string | null = null;
let _hardExpiry = 0; // 이 시각 이후로는 절대 사용 안 함 (KIS 실제 만료)
let _softExpiry = 0; // 이 시각 이후엔 가능하면 갱신 시도
let _inflight: Promise<string | null> | null = null;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Upstash Redis REST 단일 명령 (실패 시 null → 자동 폴백) ──────────────
async function redis(cmd: (string | number)[]): Promise<any | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.error(`[KIS token] redis ${cmd[0]} status=${res.status}`);
      return null;
    }
    const json = await res.json();
    return json?.result ?? null;
  } catch (e) {
    console.error(`[KIS token] redis ${cmd[0]} error: ${e}`);
    return null;
  }
}

// ── KIS tokenP 실제 발급 (rate-limit 1회 백오프 재시도) ──────────────────
async function issueToken(): Promise<{ token: string; expiresInSec: number } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: KIS_APP_KEY,
          appsecret: KIS_APP_SECRET,
        }),
        signal: AbortSignal.timeout(8000),
      });

      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* non-JSON */ }

      if (!res.ok || !json?.access_token) {
        const code = json?.error_code ?? json?.msg_cd ?? '';
        const desc = json?.error_description ?? json?.msg1 ?? text.slice(0, 300);
        console.error(`[KIS token] issue failed status=${res.status} code=${code} desc=${desc}`);
        if (attempt === 0 && (res.status === 403 || /EGW00133|초당|1분당|초과/.test(`${code}${desc}`))) {
          await sleep(1200);
          continue;
        }
        return null;
      }

      const expiresInSec = Number(json.expires_in) > 0 ? Number(json.expires_in) : 86400;
      return { token: json.access_token as string, expiresInSec };
    } catch (e) {
      console.error(`[KIS token] issue error: ${e}`);
      if (attempt === 0) { await sleep(800); continue; }
      return null;
    }
  }
  return null;
}

// L1 캐시에 반영
function cache(token: string, hardExpiry: number) {
  _token = token;
  _hardExpiry = hardExpiry;
  _softExpiry = Date.now() + Math.floor((hardExpiry - Date.now()) * 0.8);
}

// Redis에서 공유 토큰 읽기 → L1 반영
async function readShared(): Promise<string | null> {
  const raw = await redis(['GET', TOKEN_KEY]);
  if (typeof raw !== 'string') return null;
  try {
    const { token, hardExpiry } = JSON.parse(raw);
    if (token && Date.now() < hardExpiry) {
      cache(token, hardExpiry);
      return token;
    }
  } catch { /* 손상된 값 무시 */ }
  return null;
}

// 발급 후 Redis에 공유 저장 (TTL = 실제 만료까지)
async function writeShared(token: string, expiresInSec: number) {
  const hardExpiry = Date.now() + expiresInSec * 1000;
  cache(token, hardExpiry);
  await redis(['SET', TOKEN_KEY, JSON.stringify({ token, hardExpiry }), 'EX', String(expiresInSec)]);
}

/**
 * KIS 접근토큰 반환. 공유 저장소(Redis)로 프로젝트·아이솔레이트 간 토큰 1개를 공유한다.
 * 발급/저장소 실패 시에도 hard 만료 전 토큰이 있으면 그것을 반환 (전건 503 방지).
 */
export async function getKisToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) {
    console.error('[KIS token] KIS_APP_KEY/SECRET 미설정');
    return null;
  }

  const now = Date.now();
  // 1) L1 캐시가 soft 만료 전이면 즉시 사용
  if (_token && now < _softExpiry) return _token;

  // single-flight: 한 아이솔레이트 내 동시 호출 dedupe
  if (_inflight) return _inflight;

  let acquiredLock = false;
  _inflight = (async (): Promise<string | null> => {
    try {
      // 2) 공유 저장소에 유효 토큰이 있으면 재사용 (발급 안 함)
      const shared = await readShared();
      if (shared) return shared;

      // 3) 갱신 필요. 분산 락으로 "한 곳만 발급"
      acquiredLock = REDIS_URL
        ? (await redis(['SET', LOCK_KEY, '1', 'NX', 'EX', '15'])) === 'OK'
        : true; // 저장소 없으면 락 없이 진행 (인메모리 폴백)

      if (!acquiredLock) {
        // 다른 인스턴스가 발급 중 → 잠시 기다렸다 공유 토큰 재조회
        for (let i = 0; i < 6; i++) {
          await sleep(700);
          const s = await readShared();
          if (s) return s;
        }
        // 끝내 못 받음: 기존 토큰이라도 (hard 만료 전) 사용
        if (_token && Date.now() < _hardExpiry) {
          console.error('[KIS token] 락 대기 실패 — 기존 토큰으로 진행');
          return _token;
        }
        // 정말 없으면 마지막 수단으로 직접 발급 시도
      }

      const issued = await issueToken();
      if (issued) {
        await writeShared(issued.token, issued.expiresInSec);
        return issued.token;
      }

      // 발급 실패: hard 만료 전 기존 토큰이 있으면 그걸로 버틴다
      if (_token && Date.now() < _hardExpiry) {
        console.error('[KIS token] 발급 실패 — 기존 유효 토큰으로 계속 진행');
        return _token;
      }
      return null;
    } finally {
      if (acquiredLock && REDIS_URL) await redis(['DEL', LOCK_KEY]);
      _inflight = null;
    }
  })();

  return _inflight;
}
