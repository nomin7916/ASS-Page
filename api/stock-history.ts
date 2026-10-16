// Vercel Edge Function — KIS OpenAPI 종목 히스토리 서버사이드 수집
// [최적화] 과거 주가 히스토리(수년치 차트용)는 당일 1회 이상 갱신 불필요 → 24h 캐시
export const config = { runtime: 'edge' };

import { getKisToken } from './_kisToken.js';
import { fetchKisDailyRange } from './_kisDaily.js';

const KIS_APP_KEY    = process.env.KIS_APP_KEY    ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

const CONCURRENCY      = 4;     // KIS rate limit(20 req/sec/appkey) 고려 — 구간마다 페이지를 순차로 넘기므로 5→4
const CHUNK_TIMEOUT_MS = 5000;  // 개별 KIS 호출 최대 대기
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

  // 2년 단위 구간 생성 — 최신 데이터부터 확보하도록 역순 정렬.
  // ⚠️ KIS는 한 번에 최대 100건(구간의 최근 100거래일)만 준다. 구간 안의 나머지는 fetchKisDailyRange가
  //    페이지를 넘겨 받는다 — 구간당 1회 호출로 되돌리지 말 것(구간마다 앞쪽 ~390거래일이 조용히 사라지고
  //    클라이언트가 그 자리를 fchart 수정종가로 채운다. api/_kisDaily.ts 상단 주석).
  const chunks: Array<{ from: string; to: string }> = [];
  for (let year = fromYear; year <= endYear; year += 2) {
    const dateFrom = `${year}0101`;
    const rawTo    = `${Math.min(year + 1, endYear)}1231`;
    const dateTo   = rawTo <= today ? rawTo : today;
    chunks.push({ from: dateFrom, to: dateTo });
  }
  chunks.reverse();

  const deadlineAt = startTime + DEADLINE_MS;
  const result: Record<string, number> = {};
  // 응답 완전성 추적 — 클라이언트가 '신규 상장이라 건수가 적은 것'과
  // '수집이 잘려서 건수가 적은 것'을 구분할 수 있어야 한다.
  // (건수 임계값만으로 판정하면 상장 직후 종목이 영구히 '실패'로 오판된다.)
  let truncated = false;   // DEADLINE 초과 등으로 오래된 구간(또는 구간 앞쪽 페이지)을 받지 못함
  let failedChunks = 0;    // 시도했으나 실패한 구간 — 구간 중간에 구멍이 생긴다
  let pages = 0;           // 진단용 — 성공한 KIS 호출 수

  // CONCURRENCY 단위 배치 병렬 처리 — 최신 데이터부터 수집하므로
  // DEADLINE 초과 시 부분 결과(최근 N년)라도 반환 가능
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    if (Date.now() > deadlineAt) {
      console.warn(`[stock-history] ${code} deadline at batch ${Math.floor(i / CONCURRENCY)}, returning partial (${Object.keys(result).length} days)`);
      truncated = true;
      break;
    }

    const batch = chunks.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(({ from, to }) => fetchKisDailyRange({
        code, token, appKey: KIS_APP_KEY, appSecret: KIS_APP_SECRET,
        dateFrom: from, dateTo: to, timeoutMs: CHUNK_TIMEOUT_MS, deadlineAt,
      }))
    );

    let oldestEmpty = false;
    settled.forEach((r, k) => {
      if (r.status !== 'fulfilled') { failedChunks++; return; }
      const { data, ok, truncated: cut } = r.value;
      Object.assign(result, data);
      pages += r.value.pages;
      if (!ok) failedChunks++;
      if (cut) truncated = true;
      if (k === settled.length - 1) oldestEmpty = ok && !cut && Object.keys(data).length === 0;
    });
    // 이 배치의 가장 오래된 구간이 정상 응답으로 비어 있으면 그보다 이전은 상장 전이다 — 더 부르지 않는다.
    // (구간당 페이지가 늘어난 만큼, 상장 전 빈 구간 호출을 줄여 KIS 초당 한도에 덜 걸리게 한다.)
    if (oldestEmpty) break;
  }

  if (Object.keys(result).length === 0) {
    return new Response('No data', { status: 404 });
  }

  // partial=false 는 "요청 범위를 끝까지 훑었고 실패 청크가 없다"는 뜻이다.
  // 이때 건수가 적으면 그것은 수집 실패가 아니라 **상장 직후라 데이터가 그만큼뿐**인 것이다.
  // paged=true 는 "구간마다 100건 상한을 넘겨 페이지를 끝까지 받은 서버"라는 표시다. 클라이언트는 이 표시가
  // 있는 응답만 '완전'으로 쳐서 실제종가 마커(v2)를 세운다 — 페이지 넘김 이전 응답(구간마다 앞쪽 누락)이
  // 캐시에서 돌아와도 완전으로 오인하지 않게 하는 계약이다(src/hooks/useStockData.ts isCompleteKisHistory).
  const partial = truncated || failedChunks > 0;
  return new Response(JSON.stringify({ data: result, source: 'KIS-OpenAPI', partial, truncated, failedChunks, paged: true, pages }), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               's-maxage=86400, stale-while-revalidate=43200',
    },
  });
}
