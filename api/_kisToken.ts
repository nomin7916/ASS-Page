// KIS OpenAPI 접근토큰 공유 헬퍼 (Edge 호환 — fetch만 사용)
//
// 배경: KIS는 앱키당 토큰 발급을 분당 1회로 제한한다. 토큰 자체는 ~24h 유효.
// Vercel에서 api/*.ts 는 함수마다·아이솔레이트마다 모듈 상태가 분리되므로
// "한 번 발급받은 토큰을 만료까지 최대한 재사용"하는 내성 설계가 핵심이다.
//
// 설계:
//  - 발급 성공 시 KIS가 준 expires_in(초)으로 hard 만료 시각을 잡고,
//    그 80% 시점부터 백그라운드성 갱신을 시도한다.
//  - 갱신이 rate-limit 등으로 실패해도 hard 만료 전이면 기존 토큰을 그대로 반환
//    (재발급 실패가 전건 503으로 번지지 않게).
//  - single-flight: 동시 요청이 tokenP를 중복 호출하지 않도록 in-flight Promise 공유.
//  - rate-limit(403/EGW00133 등) 응답 시 짧은 백오프로 1회 재시도.
//  - 실패 사유(status, error_code, body)를 console.error 로 남겨 Vercel 로그에서 진단 가능.

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY = process.env.KIS_APP_KEY ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

let _token: string | null = null;
let _hardExpiry = 0;   // 이 시각 이후로는 토큰을 절대 쓰지 않음 (KIS 실제 만료)
let _softExpiry = 0;   // 이 시각 이후엔 가능하면 갱신 시도 (실패해도 hard 전이면 기존 토큰 사용)
let _inflight: Promise<string | null> | null = null;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function issueToken(): Promise<string | null> {
  // rate-limit(EGW00133/403) 대비 1회 재시도
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
      try { json = JSON.parse(text); } catch { /* non-JSON 응답 */ }

      if (!res.ok || !json?.access_token) {
        const code = json?.error_code ?? json?.msg_cd ?? '';
        const desc = json?.error_description ?? json?.msg1 ?? text.slice(0, 300);
        console.error(`[KIS token] issue failed status=${res.status} code=${code} desc=${desc}`);
        // 발급 횟수 초과류는 잠깐 쉬고 1회 더 시도
        if (attempt === 0 && (res.status === 403 || /EGW00133|초당|1분당|초과/.test(`${code}${desc}`))) {
          await sleep(1200);
          continue;
        }
        return null;
      }

      const expiresInSec = Number(json.expires_in) > 0 ? Number(json.expires_in) : 86400;
      const now = Date.now();
      _token = json.access_token as string;
      _hardExpiry = now + expiresInSec * 1000;
      _softExpiry = now + Math.floor(expiresInSec * 0.8) * 1000;
      return _token;
    } catch (e) {
      console.error(`[KIS token] issue error: ${e}`);
      if (attempt === 0) { await sleep(800); continue; }
      return null;
    }
  }
  return null;
}

/**
 * KIS 접근토큰을 반환한다. 발급 실패 시에도 hard 만료 전 기존 토큰이 있으면 그것을 반환한다.
 * @returns 토큰 문자열, 또는 (한 번도 발급 못 했고 캐시도 없을 때만) null
 */
export async function getKisToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) {
    console.error('[KIS token] KIS_APP_KEY/SECRET 미설정');
    return null;
  }

  const now = Date.now();
  // 아직 soft 만료 전: 캐시된 토큰 그대로 사용
  if (_token && now < _softExpiry) return _token;

  // 갱신 필요. single-flight 로 동시 발급 방지.
  if (!_inflight) {
    _inflight = issueToken().finally(() => { _inflight = null; });
  }
  const fresh = await _inflight;

  if (fresh) return fresh;

  // 갱신 실패: hard 만료 전이면 기존 토큰으로 버틴다 (전건 장애 방지)
  if (_token && Date.now() < _hardExpiry) {
    console.error('[KIS token] 갱신 실패 — 기존 유효 토큰으로 계속 진행');
    return _token;
  }
  return null;
}
