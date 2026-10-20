// FRED 전용 함수 — 미국 동부(iad1)에서만 실행한다(2026-10-20).
// 발단: /api/indicators·/api/history는 Singapore(sin1)에서 실행되는데, 그곳에서 FRED 요청이 API·fredgraph 모두
//   TimeoutError로 실패했다(운영 로그: 한 번 호출에 20건). 두 함수는 네이버·한국은행·KIS 같은 한국 출처도 부르므로
//   통째로 옮기지 않고, FRED만 이 함수로 분리했다. 두 함수는 같은 배포의 이 경로를 서버에서 부른다.
// 흐름: 시리즈마다 API(키 있을 때) → fredgraph.csv → 1회 재시도(API → fredgraph), 전체 마감 안에서. 시리즈끼리는 병렬.
// mode=latest: 최신값 카드 + 마지막 성공값을 KV(Upstash)에 시리즈별 보관 — 실패하면 보관값을 stale:true로 돌려준다.
// mode=history: 날짜→값 JSON(실패 502). 값을 지어내지 않는다.
export const config = { runtime: 'edge', regions: ['iad1'] };

import {
  parseFredGraphCsv, parseFredApiObservations, fredLatest, fredStartFor, logSafe,
  fredKvKey, packFredKv, unpackFredKv,
} from './_indicatorSources.js';

const FRED_KEY = process.env.FRED_API_KEY ?? '';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// 단계별 시한 — 첫 시도는 넉넉히, 재시도는 짧게. 전체 마감(기본 20초)을 넘지 않게 남은 시간으로 자른다
const STEPS: Array<{ stage: 'api' | 'fredgraph'; ms: number; retry: boolean }> = [
  { stage: 'api', ms: 8000, retry: false },
  { stage: 'fredgraph', ms: 6000, retry: false },
  { stage: 'api', ms: 5000, retry: true },
  { stage: 'fredgraph', ms: 5000, retry: true },
];

async function redis(cmd: (string | number)[]): Promise<any | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) { console.error(`[fred] kv ${cmd[0]} status=${res.status}`); return null; }
    return (await res.json())?.result ?? null;
  } catch (e) {
    console.error(`[fred] kv ${cmd[0]} 오류: ${logSafe((e as any)?.name || e)}`);
    return null;
  }
}

interface Range { start: string; end: string; latest: boolean; signed: boolean }

function stepUrl(stage: 'api' | 'fredgraph', id: string, r: Range): string {
  if (stage === 'api') {
    const p: Record<string, string> = { series_id: id, api_key: FRED_KEY, file_type: 'json' };
    if (r.latest) { p.sort_order = 'desc'; p.limit = '5'; } else { p.sort_order = 'asc'; p.limit = '100000'; }
    if (r.start) p.observation_start = r.start;
    if (r.end) p.observation_end = r.end;
    return `https://api.stlouisfed.org/fred/series/observations?${new URLSearchParams(p)}`;
  }
  let u = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
  if (r.start) u += `&cosd=${r.start}`;
  if (r.end) u += `&coed=${r.end}`;
  return u;
}

// 한 시리즈 — 성공하면 { 날짜: 값 }, 끝내 실패하면 null. 실패마다 시리즈·단계·걸린 ms·HTTP 상태를 로그에 남긴다
async function fetchSeries(id: string, r: Range, deadline: number): Promise<Record<string, number> | null> {
  for (const st of STEPS) {
    if (st.stage === 'api' && !FRED_KEY) continue;
    const left = deadline - Date.now();
    if (left < 1200) { console.error(`[fred] ${id} 마감 — 남은 ${left}ms`); break; }
    const tag = `${st.stage}${st.retry ? '(재시도)' : ''}`;
    const t0 = Date.now();
    try {
      const res = await fetch(stepUrl(st.stage, id, r), {
        headers: st.stage === 'fredgraph' ? { 'User-Agent': UA } : {},
        signal: AbortSignal.timeout(Math.min(st.ms, left - 200)),
      });
      const ms = Date.now() - t0;
      if (!res.ok) {
        console.error(`[fred] ${id} ${tag} 실패 status=${res.status} ${ms}ms: ${logSafe(await res.text().catch(() => ''), FRED_KEY)}`);
        continue;
      }
      const rec = st.stage === 'api' ? parseFredApiObservations(await res.json(), r.signed) : parseFredGraphCsv(await res.text(), r.signed);
      if (Object.keys(rec).length) return rec;
      console.error(`[fred] ${id} ${tag} 관측 0건 status=200 ${ms}ms (start=${r.start || '-'})`);
    } catch (e) {
      console.error(`[fred] ${id} ${tag} 오류 ${logSafe((e as any)?.name || e, FRED_KEY)} ${Date.now() - t0}ms`);
    }
  }
  return null;
}

const json = (body: unknown, status: number, cache: string) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': cache },
});

export default async function handler(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const budget = Math.max(3000, Math.min(22000, Number(q.get('ms')) || 20000));
  const deadline = Date.now() + budget;

  if (q.get('mode') === 'history') {
    const id = String(q.get('id') || '');
    if (!/^[A-Z0-9]{2,40}$/.test(id)) return json({ error: 'id' }, 400, 'no-store');
    const s0 = String(q.get('start') || ''), end = String(q.get('end') || '');
    const start = fredStartFor(id, ISO.test(s0) ? s0 : '', today);
    if (start && ISO.test(end) && start > end) return json({}, 200, 's-maxage=3600');   // 구간 전체가 3년 제한 밖(ICE BofA)
    const rec = await fetchSeries(id, { start, end: ISO.test(end) ? end : '', latest: false, signed: q.get('signed') === '1' }, deadline);
    if (!rec) return json({ error: `${id} 수집 실패` }, 502, 'no-store');
    const recent = !ISO.test(end) || end >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    return json(rec, 200, recent ? 's-maxage=3600, stale-while-revalidate=600' : 's-maxage=86400, stale-while-revalidate=43200');
  }

  // mode=latest — ids=DGS10,… · diff=T10Y2Y,…(전일 대비를 %p 차이로)
  const ids = String(q.get('ids') || '').split(',').filter(x => /^[A-Z0-9]{2,40}$/.test(x)).slice(0, 20);
  const diffs = new Set(String(q.get('diff') || '').split(','));
  if (!ids.length) return json({ error: 'ids' }, 400, 'no-store');
  // 시작일은 최근 45일(ICE BofA 3년 제한 안) — 시작일이 없으면 FRED 기본값(1776년)이라 3년 제한 시리즈는 요청이 실패한다
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const got = await Promise.all(ids.map(id =>
    fetchSeries(id, { start: fredStartFor(id, since, today), end: '', latest: true, signed: diffs.has(id) }, deadline)
      .then(rec => fredLatest(rec, diffs.has(id)))));
  const out: Record<string, any> = {};
  const fresh: (string | number)[] = [];
  const missing: string[] = [];
  ids.forEach((id, i) => {
    const v = got[i];
    if (v) { out[id] = v; fresh.push(fredKvKey(id), packFredKv(v)); } else missing.push(id);
  });
  // 성공값은 한 번에 저장(MSET), 실패한 시리즈만 한 번에 읽는다(MGET) — 시리즈마다 명령을 보내지 않는다
  const [, kept] = await Promise.all([
    fresh.length ? redis(['MSET', ...fresh]) : Promise.resolve(null),
    missing.length ? redis(['MGET', ...missing.map(fredKvKey)]) : Promise.resolve(null),
  ]);
  missing.forEach((id, i) => {
    const v = Array.isArray(kept) ? unpackFredKv(kept[i], diffs.has(id)) : null;
    if (v) console.error(`[fred] ${id} 실패 — 보관값(${v.date}) 사용`);
    out[id] = v || { price: null, change: null, source: 'FRED' };
  });
  return json(out, 200, missing.length ? 's-maxage=60' : 's-maxage=600, stale-while-revalidate=300');
}
