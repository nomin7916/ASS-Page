// Vercel Edge Function — KIS OpenAPI 종목 히스토리 서버사이드 수집
// [최적화] 과거 주가 히스토리(수년치 차트용)는 당일 1회 이상 갱신 불필요 → 24h 캐시
export const config = { runtime: 'edge' };

import { getKisToken } from './_kisToken.js';

const KIS_BASE       = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY    = process.env.KIS_APP_KEY    ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

const CONCURRENCY      = 5;     // KIS rate limit(20 req/sec/appkey) 고려
const CHUNK_TIMEOUT_MS = 5000;  // 개별 KIS 호출 최대 대기
const RETRY_DELAY_MS   = 300;   // rate limit 회복 대기
const DEADLINE_MS      = 22000; // Edge 30s 제한 전에 부분 결과 반환

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

  const today     = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const endYear   = new Date().getFullYear();
  const startTime = Date.now();

  // 2년 단위 청크 생성 — KIS는 한 번에 최대 ~100건 반환
  // 최신 데이터부터 확보하도록 역순 정렬
  const chunks: Array<{ from: string; to: string }> = [];
  for (let year = fromYear; year <= endYear; year += 2) {
    const dateFrom = `${year}0101`;
    const rawTo    = `${Math.min(year + 1, endYear)}1231`;
    const dateTo   = rawTo <= today ? rawTo : today;
    chunks.push({ from: dateFrom, to: dateTo });
  }
  chunks.reverse();

  const fetchChunk = async (dateFrom: string, dateTo: string): Promise<any[] | null> => {
    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD:         code,
      FID_INPUT_DATE_1:       dateFrom,
      FID_INPUT_DATE_2:       dateTo,
      FID_PERIOD_DIV_CODE:    'D',
      FID_ORG_ADJ_PRC:        '1',
    });
    try {
      const res = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${params}`,
        {
          headers: {
            'Content-Type':  'application/json',
            'authorization': `Bearer ${token}`,
            'appkey':        KIS_APP_KEY,
            'appsecret':     KIS_APP_SECRET,
            'tr_id':         'FHKST03010100',
            'custtype':      'P',
          },
          signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
        }
      );
      if (!res.ok) {
        console.error(`[stock-history] ${code} chunk ${dateFrom}-${dateTo} status=${res.status}`);
        return null;
      }
      const json = await res.json();
      if (json.rt_cd && json.rt_cd !== '0') {
        console.error(`[stock-history] ${code} chunk ${dateFrom}-${dateTo} rt_cd=${json.rt_cd} msg=${json.msg1}`);
        return null;
      }
      return json.output2 ?? [];
    } catch (e) {
      console.error(`[stock-history] ${code} chunk ${dateFrom}-${dateTo} error: ${e}`);
      return null;
    }
  };

  // 실패 시 1회 재시도 (rate limit EGW00201 회복용)
  const fetchChunkWithRetry = async (dateFrom: string, dateTo: string): Promise<any[] | null> => {
    const rows = await fetchChunk(dateFrom, dateTo);
    if (rows !== null) return rows;
    await new Promise<void>(r => setTimeout(r, RETRY_DELAY_MS));
    return fetchChunk(dateFrom, dateTo);
  };

  const result: Record<string, number> = {};

  // CONCURRENCY 단위 배치 병렬 처리 — 최신 데이터부터 수집하므로
  // DEADLINE 초과 시 부분 결과(최근 N년)라도 반환 가능
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    if (Date.now() - startTime > DEADLINE_MS) {
      console.warn(`[stock-history] ${code} deadline at batch ${Math.floor(i / CONCURRENCY)}, returning partial (${Object.keys(result).length} days)`);
      break;
    }

    const batch = chunks.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(({ from, to }) => fetchChunkWithRetry(from, to))
    );

    for (const r of settled) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      for (const item of r.value) {
        const d     = item.stck_bsop_date as string;
        const close = parseInt(item.stck_clpr, 10);
        if (d?.length === 8 && !isNaN(close) && close > 0) {
          result[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = close;
        }
      }
    }
  }

  if (Object.keys(result).length === 0) {
    return new Response('No data', { status: 404 });
  }

  return new Response(JSON.stringify({ data: result, source: 'KIS-OpenAPI' }), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               's-maxage=86400, stale-while-revalidate=43200',
    },
  });
}
