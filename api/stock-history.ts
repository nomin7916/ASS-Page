// Vercel Edge Function — KIS OpenAPI 종목 히스토리 서버사이드 수집
// 브라우저에서 인증 정보 노출 없이 직접 KIS API 호출
export const config = { runtime: 'edge' };

const KIS_BASE    = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY = process.env.KIS_APP_KEY    ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

// 토큰 모듈 레벨 캐시 (웜 인스턴스 재사용)
let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;
  if (_token && Date.now() < _tokenExpiry) return _token;

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
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.access_token) return null;
    _token = json.access_token as string;
    _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return _token;
  } catch {
    return null;
  }
}

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code     = searchParams.get('code') ?? '';
  const fromYear = parseInt(searchParams.get('fromYear') ?? '2000', 10);

  if (!code || code.length < 5) {
    return new Response('code 파라미터 필요 (5자리 이상)', { status: 400 });
  }

  const token = await getToken();
  if (!token) {
    return new Response('KIS 토큰 발급 실패 (앱키/시크릿 확인)', { status: 503 });
  }

  const result: Record<string, number> = {};
  const today   = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const endYear = new Date().getFullYear();

  // KIS는 한 번에 최대 ~100건 → 2년 단위 청크로 전체 기간 수집
  for (let year = fromYear; year <= endYear; year += 2) {
    const dateFrom = `${year}0101`;
    const rawTo    = `${Math.min(year + 1, endYear)}1231`;
    const dateTo   = rawTo <= today ? rawTo : today;

    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD:         code,
      FID_INPUT_DATE_1:       dateFrom,
      FID_INPUT_DATE_2:       dateTo,
      FID_PERIOD_DIV_CODE:    'D',
      FID_ORG_ADJ_PRC:        '0',
    });

    try {
      const res = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${params}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey':        KIS_APP_KEY,
            'appsecret':     KIS_APP_SECRET,
            'tr_id':         'FHKST03010100',
            'custtype':      'P',
          },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!res.ok) break;
      const json = await res.json();
      const rows: any[] = json.output2 ?? [];
      for (const item of rows) {
        const d     = item.stck_bsop_date as string;
        const close = parseInt(item.stck_clpr, 10);
        if (d?.length === 8 && !isNaN(close) && close > 0) {
          result[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = close;
        }
      }
    } catch {
      break;
    }
  }

  if (Object.keys(result).length === 0) {
    return new Response('No data', { status: 404 });
  }

  return new Response(JSON.stringify({ data: result, source: 'KIS-OpenAPI' }), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
    },
  });
}
