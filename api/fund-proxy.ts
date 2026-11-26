// 펀드 기준가 전용 중계 — **서울(icn1)에서만** 실행한다(2026-11-26).
// 발단: 미래에셋 펀드 페이지(investments.miraeasset.com)가 2026-10-28부터 해외 서버 요청을 403 안내 페이지로
//   거절했다. 이 프로젝트의 Edge 함수는 싱가포르(sin1)에서 돌아(api/fred.ts 주석의 운영 로그) /api/proxy로는
//   펀드 기준가(현재가·이력)를 한 달간 하나도 못 받았다 → 퇴직연금 계좌 차트가 10/27에서 멈췄다.
//   funetf.co.kr도 해외 데이터센터 요청을 Cloudflare로 막는다(같은 날 확인).
// 그래서 이 두 곳만 국내 지역에서 부른다. /api/proxy를 통째로 옮기지 않는다 — 야후·트레이딩이코노믹스 등
//   해외 출처가 섞여 있다(fred를 iad1로 분리한 것과 같은 방식).
// ⚠️ 막힘을 '속이지' 않는다 — 브라우저 흉내(User-Agent·Referer 위조)를 하지 않고 앱 이름을 그대로 밝힌다.
//    다른 점은 국내 지역에서 실행한다는 것 하나다. 사이트가 이 요청까지 막으면 그 뜻을 따른다(우회 금지).
export const config = { runtime: 'edge', regions: ['icn1'] };
import { requireAuth } from './_auth.js';

const ALLOWED_HOSTS = ['investments.miraeasset.com', 'www.funetf.co.kr', 'funetf.co.kr'];

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return new Response('Missing url parameter', { status: 400 });

  let targetUrl: URL;
  try { targetUrl = new URL(target); } catch { return new Response('Invalid url', { status: 400 }); }
  if (targetUrl.protocol !== 'https:' || !ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    return new Response('Domain not allowed', { status: 403 });
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'ASS-Page/1.0 (personal portfolio app; fund NAV lookup)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      // @ts-ignore — Edge Runtime fetch cache option
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Fund-Proxy-Region': 'icn1',
      },
    });
  } catch (e) {
    return new Response(`Proxy error: ${e}`, { status: 502 });
  }
}
