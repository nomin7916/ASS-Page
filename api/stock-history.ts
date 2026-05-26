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

  // KIS는 한 번에 최대 ~100건 → 2년 단위 청크. 최신 청크부터 처리(역순):
  // 다중 코드 병렬 호출로 KIS rate limit(20 req/sec/appkey)에 걸려 후반 청크가
  // 떨어져나가도 최근 데이터가 먼저 확보돼 자산 검증에서 '근사값' 폴백 없이 표시됨.
  const chunks: Array<{ from: string; to: string }> = [];
  for (let year = fromYear; year <= endYear; year += 2) {
    const dateFrom = `${year}0101`;
    const rawTo    = `${Math.min(year + 1, endYear)}1231`;
    const dateTo   = rawTo <= today ? rawTo : today;
    chunks.push({ from: dateFrom, to: dateTo });
  }
  chunks.reverse();

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  const fetchChunk = async (dateFrom: string, dateTo: string): Promise<any[] | null> => {
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
          signal: AbortSignal.timeout(7000),
        }
      );
      if (!res.ok) {
        console.error(`[stock-history] ${code} chunk ${dateFrom}-${dateTo} status=${res.status}`);
        return null;
      }
      const json = await res.json();
      // KIS rate limit 응답(EGW00201/초당 거래건수 초과)도 200을 반환할 수 있어
      // rt_cd 검사로 throttling 판별 → 재시도 트리거
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

  // 청크별 1회 재시도(900ms 백오프) — KIS 일시적 throttling/timeout 회복.
  // maxDuration: 60s 제한 안에서 13청크 × (7s + 0.9s + 7s) = 약 195s 워스트 케이스가
  // 발생하지 않도록, 호출 측에서 동시성 4로 제한해 KIS 부하를 분산함.
  for (const { from, to } of chunks) {
    let rows = await fetchChunk(from, to);
    if (rows === null) {
      await sleep(900);
      rows = await fetchChunk(from, to);
    }
    if (!rows) continue;
    for (const item of rows) {
      const d     = item.stck_bsop_date as string;
      const close = parseInt(item.stck_clpr, 10);
      if (d?.length === 8 && !isNaN(close) && close > 0) {
        result[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = close;
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
      'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
    },
  });
}
