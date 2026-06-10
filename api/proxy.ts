// Vercel Edge Function — 외부 API CORS 프록시
// 허용된 도메인으로만 요청을 중계하여 Vercel 배포 환경의 CORS 문제 해결
// [최적화] &cache=N 쿼리 파라미터가 있으면 s-maxage=N 캐시 허용, 없으면 기존 no-cache 유지(호환성 보존)

export const config = { runtime: 'edge' };

const ALLOWED_DOMAINS = [
  'tradingeconomics.com',
  'stock.naver.com',
  'finance.naver.com',
  'query1.finance.yahoo.com',
  'funetf.co.kr',
  'investments.miraeasset.com',
];

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url');
  const cacheSeconds = parseInt(searchParams.get('cache') ?? '0', 10);

  if (!target) {
    return new Response('Missing url parameter', { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }

  const isAllowed = ALLOWED_DOMAINS.some(d => targetUrl.hostname.endsWith(d));
  if (!isAllowed) {
    return new Response('Domain not allowed', { status: 403 });
  }

  try {
    const referer = targetUrl.hostname.includes('miraeasset.com')
      ? 'https://investments.miraeasset.com/'
      : 'https://m.stock.naver.com/';
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': referer,
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
        'Cache-Control': cacheSeconds > 0
          ? `s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds}`
          : 'no-cache',
      },
    });
  } catch (e) {
    return new Response(`Proxy error: ${e}`, { status: 502 });
  }
}
