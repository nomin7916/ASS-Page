// Vercel Serverless Function — KIS OpenAPI 종목 히스토리 서버사이드 수집
// Node.js 런타임: module-level L1 캐시가 인스턴스 수명(~15분) 동안 유지되어
// 동일 인스턴스로 들어오는 다중 요청이 KIS 토큰을 재발급 없이 공유함
export const config = { maxDuration: 60 };

import { getKisToken } from './_kisToken.js';

const KIS_BASE    = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY = process.env.KIS_APP_KEY    ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code     = searchParams.get('code') ?? '';
  const fromYear = parseInt(searchParams.get('fromYear') ?? '2000', 10);

  if (!code || code.length < 5) {
    return new Response('code 파라미터 필요 (5자리 이상)', { status: 400 });
  }

  const token = await getKisToken();
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
      FID_ORG_ADJ_PRC:        '1',  // 원주가 (실제종가, 수정주가 미반영)
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
      if (!res.ok) {
        console.error(`[stock-history] chunk ${dateFrom}-${dateTo} status=${res.status}`);
        continue; // 단일 청크 실패가 전체 수집을 죽이지 않게 (수집된 데이터는 유지)
      }
      const json = await res.json();
      const rows: any[] = json.output2 ?? [];
      for (const item of rows) {
        const d     = item.stck_bsop_date as string;
        const close = parseInt(item.stck_clpr, 10);
        if (d?.length === 8 && !isNaN(close) && close > 0) {
          result[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = close;
        }
      }
    } catch (e) {
      console.error(`[stock-history] chunk ${dateFrom}-${dateTo} error: ${e}`);
      continue;
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
