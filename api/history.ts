// Vercel Edge Function — 지표 장기 히스토리 수집
// stooq API 키 요구로 인해 Yahoo Finance v8 + FRED로 교체
// [최적화] goldKr 100→20페이지·5페이지 배치 처리(동시요청 폭주 방지), goldKr 캐시 6h, 지표히스토리 csvResponse 24h
export const config = { runtime: 'edge' };

const FRED_KEY = process.env.FRED_API_KEY ?? '';

import { getKisToken } from './_kisToken.js';
import { fetchKisDailyRange } from './_kisDaily.js';
import { parseFredGraphCsv, fillBefore, fillAfter, joinFedRate, isRecentRangeEnd } from './_indicatorSources.js';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY = process.env.KIS_APP_KEY ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

const SUFFIX_TO_EXCD: Record<string, string> = { O: 'NASD', N: 'NYSE', P: 'AMEX', K: 'NYSE' };
const EXCD_TRY_ORDER = ['NASD', 'NYSE', 'AMEX'];

// KIS 해외주식 기간별시세 (HHDFS76240000) — KEYB 페이지네이션으로 최대 ~3년치 수집
async function fetchKisOverseasHistory(
  baseTicker: string,
  token: string,
  excd: string,
  d1: string, // YYYYMMDD
  d2: string  // YYYYMMDD
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  let keyb = '';
  const endDate = d2.slice(0, 8);

  for (let page = 0; page < 12; page++) {
    try {
      const params = new URLSearchParams({
        AUTH: '', EXCD: excd, SYMB: baseTicker,
        GUBN: '0',   // 일별
        BYMD: endDate,
        MODP: '1',   // 수정주가
        KEYB: keyb,
      });
      const res = await fetch(`${KIS_BASE}/uapi/overseas-price/v1/quotations/dailyprice?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
          appkey: KIS_APP_KEY,
          appsecret: KIS_APP_SECRET,
          tr_id: 'HHDFS76240000',
          custtype: 'P',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) break;
      const json = await res.json();
      const rows: any[] = json.output2 ?? [];
      if (rows.length === 0) break;

      let earliest = '';
      for (const row of rows) {
        const d = String(row.bass_dt ?? '');
        const price = parseFloat(String(row.clos_prce ?? '0').replace(/,/g, ''));
        if (d.length === 8 && price > 0) {
          const dateStr = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          result[dateStr] = price;
          if (!earliest || d < earliest) earliest = d;
        }
      }

      if (earliest && earliest <= d1.slice(0, 8)) break;
      keyb = String(json.ctx_area_nk ?? '');
      if (!keyb) break;
    } catch { break; }
  }
  return result;
}

// KIS 해외주식 히스토리: EXCD 힌트 없으면 NASD→NYSE→AMEX 순 시도
async function fetchKisOverseasHistoryAuto(
  ticker: string,
  token: string,
  d1: string,
  d2: string,
  hintExcd?: string
): Promise<Record<string, number>> {
  const baseTicker = ticker.includes('.') ? ticker.split('.')[0] : ticker;
  const suffixMatch = ticker.match(/\.([A-Z]{1,2})$/);
  const targets = hintExcd
    ? [hintExcd]
    : (suffixMatch ? [SUFFIX_TO_EXCD[suffixMatch[1]] ?? 'NASD'] : EXCD_TRY_ORDER);

  for (const ex of targets) {
    const data = await fetchKisOverseasHistory(baseTicker, token, ex, d1, d2);
    if (Object.keys(data).length >= 5) return data;
  }
  return {};
}

// Yahoo Finance 심볼 매핑 (stooq 대체)
const YAHOO_SYMBOLS: Record<string, string> = {
  us10y:    '^TNX',
  goldIntl: 'GC=F',
  usdkrw:   'KRW=X',
  dxy:      'DX-Y.NYB',
  vix:      '^VIX',
  btc:      'BTC-USD',
  eth:      'ETH-USD',
  // 지수 3종(2026-10) — 시장지표 패널의 KOSPI·S&P500·Nasdaq100도 다른 지표와 같은 커버리지 보충(머리·공백·꼬리)을
  // 타야 한다. 옛 경로는 클라이언트가 외부 CORS 프록시로 Yahoo를 직접 불러 '시작일~오늘' 전량만 받았다.
  kospi:    '^KS11',
  sp500:    '^GSPC',
  nasdaq:   '^NDX',
};

// YYYYMMDD → Unix timestamp (초)
function toUnixSec(d: string): number {
  return Math.floor(new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T00:00:00Z`).getTime() / 1000);
}

// Yahoo Finance v8 chart API로 과거 일별 데이터 수집
async function fetchYahooHistory(symbol: string, d1: string, d2: string): Promise<Record<string, number>> {
  const defaultStart = Math.floor((Date.now() - 5 * 365.25 * 24 * 3600 * 1000) / 1000);
  const period1 = d1 ? toUnixSec(d1) : defaultStart;
  const period2 = d2 ? toUnixSec(d2) + 86400 : Math.floor(Date.now() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return {};
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return {};

    const timestamps: number[]           = result.timestamp ?? [];
    const closes: (number | null)[]      = result.indicators?.quote?.[0]?.close ?? [];
    const adjCloses: (number | null)[]   = result.indicators?.adjclose?.[0]?.adjclose ?? [];

    const record: Record<string, number> = {};
    for (let i = 0; i < timestamps.length; i++) {
      const price = closes[i] ?? adjCloses[i];
      if (price == null || isNaN(price) || price <= 0) continue;
      const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
      record[dateStr] = price;
    }
    return record;
  } catch {
    return {};
  }
}

// FRED 과거 일별 데이터 수집 — ① API(키 있을 때) → ② fredgraph.csv(키 불필요) 폴백.
// ⚠️ limit는 반드시 최대(100000)로 — 옛 값 2000 + sort_order=asc 조합은 조회 시작일부터 2000건만 돌려줘
//    장기 조회에서 **최근 구간이 통째로 잘렸다**(기준금리 DFEDTARU는 주말 포함 일별이라 2000건 ≈ 5.5년 →
//    2004년부터 조회하면 2014년 이후가 없음 = "현재 기준금리가 반영되지 않음"의 원인).
// ⚠️ 키가 없거나 API가 실패해도 fredgraph.csv는 키 없이 같은 시계열을 준다(파이썬 pandas_datareader와 같은 경로).
const toIsoDate = (d: string) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;

async function fetchFredApiHistory(seriesId: string, d1: string, d2: string, timeoutMs = 10000): Promise<Record<string, number>> {
  if (!FRED_KEY) return {};
  const params: Record<string, string> = {
    series_id:  seriesId,
    api_key:    FRED_KEY,
    file_type:  'json',
    sort_order: 'asc',
    limit:      '100000',
  };
  if (d1) params.observation_start = toIsoDate(d1);
  if (d2) params.observation_end   = toIsoDate(d2);
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?${new URLSearchParams(params)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return {};
    const data: any = await res.json();
    const record: Record<string, number> = {};
    for (const obs of (data.observations ?? [])) {
      if (obs.value === '.') continue;
      const v = parseFloat(obs.value);
      if (!isNaN(v) && v > 0) record[obs.date] = v;
    }
    return record;
  } catch {
    return {};
  }
}

async function fetchFredGraphHistory(seriesId: string, d1: string, d2: string, timeoutMs = 10000): Promise<Record<string, number>> {
  let url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  if (d1) url += `&cosd=${toIsoDate(d1)}`;
  if (d2) url += `&coed=${toIsoDate(d2)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return {};
    return parseFredGraphCsv(await res.text());
  } catch {
    return {};
  }
}

async function fetchFredHistory(seriesId: string, d1: string, d2: string, timeoutMs = 10000): Promise<Record<string, number>> {
  const api = await fetchFredApiHistory(seriesId, d1, d2, timeoutMs);
  if (Object.keys(api).length > 0) return api;
  return fetchFredGraphHistory(seriesId, d1, d2, timeoutMs);
}

// 조각 병합용 — 한 소스의 최초일·최신일
const firstKey = (r: Record<string, number>) => Object.keys(r).sort()[0] ?? '';
const lastKey  = (r: Record<string, number>) => Object.keys(r).sort().pop() ?? '';
const ymd = (iso: string) => iso.replace(/-/g, '');
const shiftYmd = (d: string, days: number) => {
  const t = Date.UTC(+d.slice(0,4), +d.slice(4,6) - 1, +d.slice(6,8)) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
};

// Naver m.stock 채권 prices API (일별 데이터 — FRED 월별보다 정밀)
// 한 번에 돌려주는 건수에 상한이 있을 수 있어 **최신→과거 순으로 청크를 이어 받는다**(진전이 없으면 멈춤).
async function fetchNaverBondHistory(reutersCode: string, d1: string, d2: string, deadlineAt = Date.now() + 15000): Promise<Record<string, number>> {
  const toNaverDt = (d: string, end = false) => `${d.slice(0, 8)}${end ? '235959' : '000000'}`;
  const defStart = new Date(Date.now() - 3 * 365.25 * 24 * 3600 * 1000)
    .toISOString().split('T')[0].replace(/-/g, '');
  const defEnd = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const limitStart = (d1 || defStart).slice(0, 8);
  let chunkEnd = (d2 || defEnd).slice(0, 8);
  const record: Record<string, number> = {};

  for (let iter = 0; iter < 15; iter++) {
    const remaining = deadlineAt - Date.now();
    if (remaining < 1500) break;
    const url = `https://m.stock.naver.com/api/marketIndex/bond/prices`
      + `?category=bond&reutersCode=${encodeURIComponent(reutersCode)}`
      + `&startDateTime=${toNaverDt(limitStart)}&endDateTime=${toNaverDt(chunkEnd, true)}&timeframe=day`;
    let earliest = '';
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Referer':    'https://m.stock.naver.com/',
          'Accept':     'application/json',
        },
        signal: AbortSignal.timeout(Math.min(12000, remaining)),
      });
      if (!res.ok) break;
      const data: any = await res.json();
      if (!data?.isSuccess || !Array.isArray(data?.result)) break;
      for (const item of data.result as any[]) {
        if (!item.localTradedAt || !item.closePrice) continue;
        const date  = String(item.localTradedAt).split('T')[0]; // "YYYY-MM-DD"
        const price = parseFloat(String(item.closePrice));
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(price) && price > 0) {
          record[date] = price;
          const k = ymd(date);
          if (!earliest || k < earliest) earliest = k;
        }
      }
    } catch { break; }
    // 진전 없음(빈 응답·같은 구간 반복) 또는 시작일 도달 → 종료
    if (!earliest || earliest <= limitStart || earliest >= chunkEnd) break;
    chunkEnd = shiftYmd(earliest, -1);
  }
  return record;
}

// { date: price } → "Date,Close\n..." CSV 변환 (기존 parseIndexCSV 호환)
function toCSV(data: Record<string, number>): string {
  const lines = ['Date,Close'];
  for (const [date, price] of Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${date},${price}`);
  }
  return lines.join('\n');
}

// 순수 과거 지표 히스토리(us10y/fedRate/kr10y/goldIntl/usdkrw/dxy/vix/btc/eth + 지수 kospi/sp500/nasdaq) → 24h 캐시
// ⚠️ 종료일이 최근(어제·오늘)인 요청은 1h만 캐시한다 — 24h로 두면 '새로고침' 꼬리 수집이 하루 내내 같은
//    (오늘 값이 빠진) 응답을 돌려받는다. 과거 구간만 담은 요청은 값이 바뀌지 않으므로 24h 그대로.
function csvResponse(data: Record<string, number>, recent = false): Response {
  return new Response(toCSV(data), {
    headers: {
      'Content-Type':                'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               recent
        ? 's-maxage=3600, stale-while-revalidate=600'
        : 's-maxage=86400, stale-while-revalidate=43200',
    },
  });
}

function defaultDateRange() {
  const end   = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const start = new Date(Date.now() - 10 * 365.25 * 24 * 3600 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  return { start, end };
}

// Naver 국내 주식 일별 이력 — /api/stock/CODE/day (모바일 API, trend API 폴백용)
async function fetchNaverDomesticDayHistory(code: string, d1: string): Promise<Record<string, number>> {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    'Referer':    'https://m.stock.naver.com/',
    'Accept':     'application/json',
  };
  const toNaverDt = (yyyymmdd: string, end = false) => `${yyyymmdd}${end ? '235959' : '000000'}`;
  const limitStart = (d1 || '20000101').slice(0, 8);
  const defEnd = new Date().toISOString().split('T')[0].replace(/-/g, '');

  const allData: Record<string, number> = {};
  let chunkEnd = defEnd;

  for (let iter = 0; iter < 25; iter++) {
    const url = `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/day`
      + `?startDateTime=${toNaverDt(limitStart)}&endDateTime=${toNaverDt(chunkEnd, true)}&timeframe=day`;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
      if (!res.ok) { console.error(`[domestic-day] ${code} status=${res.status} iter=${iter}`); break; }
      const raw: any = await res.json();
      const items: any[] = Array.isArray(raw) ? raw : (raw?.result ?? raw?.prices ?? []);
      if (items.length === 0) break;

      let earliestInChunk = chunkEnd;
      for (const item of items) {
        const ld = String(item.localDate ?? item.localTradedAt ?? item.bizdate ?? '').replace(/T.*/, '').replace(/-/g, '');
        const price = parseFloat(String(item.closePrice ?? item.close ?? 0).replace(/,/g, ''));
        if (ld.length === 8 && price > 0) {
          allData[`${ld.slice(0,4)}-${ld.slice(4,6)}-${ld.slice(6,8)}`] = price;
          if (ld < earliestInChunk) earliestInChunk = ld;
        }
      }

      if (earliestInChunk <= limitStart) break;
      const prev = new Date(
        parseInt(earliestInChunk.slice(0,4)),
        parseInt(earliestInChunk.slice(4,6)) - 1,
        parseInt(earliestInChunk.slice(6,8)) - 1,
      );
      if (isNaN(prev.getTime())) break;
      chunkEnd = prev.toISOString().split('T')[0].replace(/-/g, '');
      if (chunkEnd <= limitStart) break;
    } catch (e) { console.error(`[domestic-day] ${code} error=${e} iter=${iter}`); break; }
  }

  return allData;
}

// Naver 국내 주식 실제 종가 이력 — trend API (수정주가 미반영, 실제 체결가)
// front-api 차단 시 /api/stock/CODE/day 로 폴백
async function fetchNaverDomesticTrendHistory(code: string, d1: string): Promise<{ data: Record<string, number>; source: string }> {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    'Referer':    'https://m.stock.naver.com/',
    'Accept':     'application/json',
  };

  const result: Record<string, number> = {};
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0].replace(/-/g, '');
  let bizdate = tomorrow;
  const limitStart = (d1 || '20000101').slice(0, 8);

  for (let iter = 0; iter < 25; iter++) {
    const url = `https://m.stock.naver.com/front-api/stock/domestic/trend`
      + `?code=${encodeURIComponent(code)}&marketType=KRX&pageSize=100&bizdate=${bizdate}`;

    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        console.error(`[domestic-trend] ${code} iter=${iter} status=${res.status}`);
        break;
      }
      const json: any = await res.json();
      if (!json.isSuccess || !Array.isArray(json.result) || json.result.length === 0) {
        console.error(`[domestic-trend] ${code} iter=${iter} isSuccess=${json.isSuccess} len=${json.result?.length ?? 'N/A'} keys=${Object.keys(json).join(',')}`);
        break;
      }

      let earliest = '';
      for (const item of json.result) {
        const d = String(item.bizdate ?? '');
        const price = parseInt(String(item.closePrice ?? '').replace(/,/g, ''), 10);
        if (d.length === 8 && !isNaN(price) && price > 0) {
          result[`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`] = price;
          if (!earliest || d < earliest) earliest = d;
        }
      }

      if (!earliest || earliest <= limitStart) break;
      bizdate = earliest;
    } catch (e) {
      console.error(`[domestic-trend] ${code} iter=${iter} error=${e}`);
      break;
    }
  }

  if (Object.keys(result).length > 0) return { data: result, source: 'naver-trend' };

  // front-api 실패 → /api/stock/CODE/day 폴백
  console.error(`[domestic-trend] ${code} front-api 실패 → day API 폴백`);
  const dayData = await fetchNaverDomesticDayHistory(code, d1);
  return { data: dayData, source: 'naver-day' };
}

// Naver worldstock 해외주식 일별 히스토리 (다중 청크 수집)
async function fetchNaverWorldstockHistory(code: string, d1: string, d2: string): Promise<Record<string, number>> {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    'Referer':    'https://m.stock.naver.com/',
    'Accept':     'application/json',
  };

  const defStart = new Date(Date.now() - 12 * 365.25 * 24 * 3600 * 1000)
    .toISOString().split('T')[0].replace(/-/g, '');
  const limitStart = (d1 || defStart).slice(0, 8);

  const toNaverDt = (yyyymmdd: string, end = false) =>
    `${yyyymmdd}${end ? '235959' : '000000'}`;

  const allData: Record<string, number> = {};

  // 오늘부터 역순으로 청크 수집 (한 청크 = API가 반환하는 최대 건수)
  let chunkEnd = (d2 || new Date().toISOString().split('T')[0].replace(/-/g, '')).slice(0, 8);

  for (let iter = 0; iter < 25; iter++) {
    const url = `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/day`
      + `?startDateTime=${toNaverDt(limitStart)}&endDateTime=${toNaverDt(chunkEnd, true)}&timeframe=day`;

    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
      if (!res.ok) break;

      const raw: any = await res.json();
      // API는 배열 또는 { isSuccess, result } 형태 반환
      const items: any[] = Array.isArray(raw) ? raw : (raw?.result ?? raw?.prices ?? []);
      if (items.length === 0) break;

      let earliestInChunk = chunkEnd;
      for (const item of items) {
        const ld = String(item.localDate ?? item.localTradedAt ?? '').replace(/T.*/, '').replace(/-/g, '');
        const price = parseFloat(String(item.closePrice ?? item.close ?? 0));
        if (ld.length === 8 && price > 0) {
          const fmt = `${ld.slice(0,4)}-${ld.slice(4,6)}-${ld.slice(6,8)}`;
          allData[fmt] = price;
          if (ld < earliestInChunk) earliestInChunk = ld;
        }
      }

      // 더 이상 수집할 범위가 없으면 중단
      if (earliestInChunk <= limitStart) break;

      // 다음 청크: 이번 청크 최초일 하루 전까지
      const prevDay = new Date(
        parseInt(earliestInChunk.slice(0,4)),
        parseInt(earliestInChunk.slice(4,6)) - 1,
        parseInt(earliestInChunk.slice(6,8)) - 1
      );
      if (isNaN(prevDay.getTime())) break;
      chunkEnd = prevDay.toISOString().split('T')[0].replace(/-/g, '');
      if (chunkEnd <= limitStart) break;
    } catch {
      break;
    }
  }

  return allData;
}

// KIS 국내 주식 실제 종가 이력 (FID_ORG_ADJ_PRC=1 → 원주가, 수정주가 미반영)
// ⚠️ KIS는 호출당 최대 100건(구간의 최근 100거래일)만 준다 — 2년 구간을 한 번만 부르면 앞쪽이 통째로
//    빠진다. 페이지 넘김은 api/_kisDaily.ts(stock-history와 공유)가 맡는다.
async function fetchKisDomesticActualHistory(code: string, token: string, d1: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const today   = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const startY  = parseInt((d1 || '20210101').slice(0, 4), 10);
  const endYear = new Date().getFullYear();
  const deadlineAt = Date.now() + 20000;   // Edge 응답 시작 제한 전에 받은 만큼 돌려준다

  for (let year = startY; year <= endYear; year += 2) {
    const dateFrom = `${year}0101`;
    const rawTo    = `${Math.min(year + 1, endYear)}1231`;
    const dateTo   = rawTo <= today ? rawTo : today;
    const r = await fetchKisDailyRange({
      code, token, appKey: KIS_APP_KEY, appSecret: KIS_APP_SECRET,
      dateFrom, dateTo, timeoutMs: 10000, deadlineAt,
    });
    Object.assign(result, r.data);
    if (r.truncated) break;
  }
  return result;
}

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const key   = searchParams.get('key') ?? '';
  const start = (searchParams.get('start') ?? '').replace(/-/g, '');
  const end   = (searchParams.get('end')   ?? '').replace(/-/g, '');

  // ── 국내 종목 실제 종가 이력: Naver trend (1순위) → KIS 원주가 (2순위) ────────
  if (key === 'domestic') {
    const code = searchParams.get('code') ?? '';
    if (!code || code.length < 5) {
      return new Response('code 파라미터 필요', { status: 400 });
    }
    const fiveYearsAgo = new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000)
      .toISOString().split('T')[0].replace(/-/g, '');
    const d1 = start || fiveYearsAgo;

    const { data: navData, source: domSource } = await fetchNaverDomesticTrendHistory(code, d1);
    if (Object.keys(navData).length > 0) {
      return new Response(JSON.stringify({ data: navData, source: domSource }), {
        headers: {
          'Content-Type':                'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
        },
      });
    }

    // Naver 차단 시 KIS 원주가로 폴백
    const kisToken = await getKisToken();
    if (kisToken) {
      const kisData = await fetchKisDomesticActualHistory(code, kisToken, d1);
      if (Object.keys(kisData).length > 0) {
        console.log(`[domestic] ${code} KIS 원주가 폴백 성공: ${Object.keys(kisData).length}건`);
        return new Response(JSON.stringify({ data: kisData, source: 'KIS-actual' }), {
          headers: {
            'Content-Type':                'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
          },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Naver 국내 히스토리 수집 실패', code }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ── 해외주식 히스토리: Yahoo Finance (1순위) → KIS (2순위) → Naver worldstock (3순위) ──
  if (key === 'worldstock') {
    const code = searchParams.get('code') ?? '';
    if (!code) return new Response('code 파라미터 필요', { status: 400 });

    const { start: defStart, end: defEnd } = defaultDateRange();
    const d1 = start || defStart;
    const d2 = end   || defEnd;

    // 1순위: Yahoo Finance — 단일 호출로 수년치 데이터
    const yahooTicker = code.includes('.') ? code.split('.')[0] : code;
    let data = await fetchYahooHistory(yahooTicker, d1, d2);
    let source = 'Yahoo Finance';

    // 2순위: KIS 해외주식 기간별시세 — Yahoo 실패 시 사용
    if (Object.keys(data).length < 5) {
      const kisToken = await getKisToken();
      if (kisToken) {
        const kisData = await fetchKisOverseasHistoryAuto(code, kisToken, d1, d2);
        if (Object.keys(kisData).length >= 5) {
          data = kisData;
          source = 'KIS-Overseas';
        }
      }
    }

    // 3순위: Naver worldstock — KIS도 실패 시 청크 수집으로 보완
    if (Object.keys(data).length < 5) {
      const naverData = await fetchNaverWorldstockHistory(code, d1, d2);
      if (Object.keys(naverData).length > 0) {
        data = naverData;
        source = 'Naver worldstock';
      }
    }

    if (Object.keys(data).length === 0) {
      return new Response('해외주식 히스토리 수집 실패', { status: 502 });
    }

    return new Response(JSON.stringify({ data, source }), {
      headers: {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
      },
    });
  }

  // ── 개별 종목 히스토리: Naver fchart XML (key=stock&code=XXXXX) ──────────
  if (key === 'stock') {
    const code  = searchParams.get('code') ?? '';
    const count = searchParams.get('count') ?? '2000';
    if (!code || code.length < 5) {
      return new Response('code 파라미터 필요', { status: 400 });
    }
    try {
      const res = await fetch(
        `https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
            'Referer':    'https://m.stock.naver.com/',
          },
          signal: AbortSignal.timeout(12000),
        }
      );
      if (!res.ok) return new Response(`Naver fchart ${res.status}`, { status: 502 });
      const body = await res.text();
      return new Response(body, {
        headers: {
          'Content-Type':                'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
        },
      });
    } catch (e) {
      return new Response(`Naver fchart error: ${e}`, { status: 502 });
    }
  }

  // ── 국내금(goldKr): finance.naver.com 금일별시세 다중 페이지 스크래핑 ──
  if (key === 'goldKr') {
    const parsePage = async (page: number): Promise<Record<string, number>> => {
      try {
        const res = await fetch(
          `https://finance.naver.com/marketindex/goldDailyQuote.naver?page=${page}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
              'Referer':    'https://finance.naver.com/marketindex/',
            },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!res.ok) return {};
        const html = await res.text();
        const result: Record<string, number> = {};
        const trRe       = /<tr[^>]*>[\s\S]*?<\/tr>/g;
        const dateInRow  = /class="date">(\d{4})\.(\d{2})\.(\d{2})/;
        const priceInRow = /class="num">([\d,]+)/;
        let trm: RegExpExecArray | null;
        while ((trm = trRe.exec(html)) !== null) {
          const row = trm[0];
          const dm = dateInRow.exec(row);
          const pm = priceInRow.exec(row);
          if (dm && pm) {
            const date  = `${dm[1]}-${dm[2]}-${dm[3]}`;
            const price = parseFloat(pm[1].replace(/,/g, ''));
            if (price > 1000) result[date] = Math.round(price);
          }
        }
        return result;
      } catch {
        return {};
      }
    };

    // ── 페이지 커서 모드(?page=N&pages=M[&stop=YYYYMMDD]) — 조회기간 앞쪽(과거)을 채우는 장기 수집용 ──
    // 한 요청이 Edge 응답 제한(25s)을 넘지 않게 최대 40페이지만 받고 다음 커서를 돌려준다. 클라이언트가
    // stop(조회 시작일)에 닿거나 done이 될 때까지 이어 부른다. 범위 밖 페이지는 네이버가 빈 표나 마지막
    // 페이지를 반복해서 주므로 '새 날짜가 하나도 없는 페이지' = 끝으로 본다.
    const pageParam = searchParams.get('page');
    if (pageParam) {
      const from  = Math.max(1, parseInt(pageParam, 10) || 1);
      const count = Math.min(40, Math.max(1, parseInt(searchParams.get('pages') ?? '20', 10) || 20));
      const stop  = (searchParams.get('stop') ?? '').replace(/-/g, '');
      const t0 = Date.now();
      const data: Record<string, number> = {};
      let next = from;
      let done = false;
      for (let p = from; p < from + count && !done; p += 5) {
        if (Date.now() - t0 > 18000) break;
        const batch = Array.from({ length: Math.min(5, from + count - p) }, (_, i) => p + i);
        const results = await Promise.allSettled(batch.map(n => parsePage(n)));
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const page = r.status === 'fulfilled' ? r.value : {};
          const fresh = Object.keys(page).filter(d => !(d in data));
          if (fresh.length === 0) { done = true; break; }
          Object.assign(data, page);
          next = batch[i] + 1;
          if (stop && fresh.some(d => d.replace(/-/g, '') <= stop)) { done = true; break; }
        }
      }
      return new Response(JSON.stringify({ data, next, done }), {
        headers: {
          'Content-Type':                'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control':               from === 1 ? 's-maxage=3600, stale-while-revalidate=600' : 's-maxage=21600, stale-while-revalidate=3600',
        },
      });
    }

    // 100→20페이지: 한 페이지 약 10~15건이므로 200건 이상 확보 가능
    // 5페이지씩 순차 배치 처리 — 동시 요청 폭주 방지
    const pageNums = Array.from({ length: 20 }, (_, i) => i + 1);
    const batchSize = 5;
    const allData: Record<string, number> = {};
    for (let i = 0; i < pageNums.length; i += batchSize) {
      const batch = pageNums.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(p => parsePage(p)));
      for (const r of results) {
        if (r.status === 'fulfilled') Object.assign(allData, r.value);
      }
    }
    if (Object.keys(allData).length < 10) {
      return new Response('국내금 데이터 수집 실패', { status: 502 });
    }
    // 국내금 일별 데이터는 장중 변동 없음 → 6h 캐시
    return new Response(JSON.stringify(allData), {
      headers: {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               's-maxage=21600, stale-while-revalidate=3600',
      },
    });
  }

  // ── 시장 지표 히스토리: Yahoo Finance + FRED (stooq 대체) ─────────────
  const { start: defStart, end: defEnd } = defaultDateRange();
  const d1 = start || defStart;
  const d2 = end   || defEnd;

  const recent = isRecentRangeEnd(d2, new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const t0 = Date.now();
  const budgetLeft = () => 18000 - (Date.now() - t0);   // Edge 응답 시작 제한(25s) 안에 끝낸다

  // us10y: FRED DGS10(1962~, 하루 늦게 발표) → 최신 꼬리는 Naver 일별로 보충 · 실패 시 Naver → Yahoo ^TNX
  if (key === 'us10y') {
    let data = await fetchFredHistory('DGS10', d1, d2);
    if (Object.keys(data).length >= 10) {
      const last = lastKey(data);
      if (last && ymd(last) < d2 && budgetLeft() > 3000) {
        const tail = await fetchNaverBondHistory('US10YT=RR', shiftYmd(ymd(last), 1), d2, Date.now() + Math.min(8000, budgetLeft()));
        data = fillAfter(data, tail);
      }
    } else {
      data = await fetchNaverBondHistory('US10YT=RR', d1, d2);
      if (Object.keys(data).length < 10) data = await fetchYahooHistory('^TNX', d1, d2);
    }
    if (Object.keys(data).length === 0) return new Response('us10y 수집 실패', { status: 502 });
    return csvResponse(data, recent);
  }

  // fedRate: FRED DFEDTARU(상단, 2008-12-16~) + DFEDTAR(단일 목표, ~2008-12-15)
  // ⚠️ DFEDTARU만 쓰면 2008-12 이전 조회기간이 통째로 빈다(첫 화면의 2004~2008 구간).
  if (key === 'fedRate') {
    const legacyEnd = '20081215';
    const [upper, legacy] = await Promise.all([
      d2 >= '20081216' ? fetchFredHistory('DFEDTARU', d1 > '20081216' ? d1 : '20081216', d2) : Promise.resolve({}),
      d1 <= legacyEnd ? fetchFredHistory('DFEDTAR', d1, d2 < legacyEnd ? d2 : legacyEnd) : Promise.resolve({}),
    ]);
    const data = joinFedRate(legacy, upper);
    if (Object.keys(data).length === 0) return new Response('fedRate 수집 실패', { status: 502 });
    return csvResponse(data, recent);
  }

  // kr10y: Naver 일별 primary → 앞쪽(네이버가 못 준 과거)은 FRED 월별(IRLTLT01KRM156N)로 보충
  if (key === 'kr10y') {
    let data = await fetchNaverBondHistory('KR10YT=RR', d1, d2, Date.now() + 12000);
    const first = firstKey(data);
    if (Object.keys(data).length < 10) {
      data = await fetchFredHistory('IRLTLT01KRM156N', d1, d2);
    } else if (first && ymd(first) > shiftYmd(d1, 7) && budgetLeft() > 3000) {
      const head = await fetchFredHistory('IRLTLT01KRM156N', d1, shiftYmd(ymd(first), -1), Math.min(8000, budgetLeft()));
      data = fillBefore(data, head);
    }
    if (Object.keys(data).length === 0) return new Response('kr10y 수집 실패', { status: 502 });
    return csvResponse(data, recent);
  }

  // Yahoo Finance 지원 지표
  const yahooSymbol = YAHOO_SYMBOLS[key];
  if (!yahooSymbol) {
    return new Response(`Unknown indicator key: ${key}`, { status: 400 });
  }

  let data = await fetchYahooHistory(yahooSymbol, d1, d2);
  // usdkrw: Yahoo KRW=X는 2003-12부터 — 그 앞(또는 Yahoo 실패 시 전체)은 FRED 일별 환율 DEXKOUS로 보충
  if (key === 'usdkrw' && budgetLeft() > 3000) {
    const first = firstKey(data);
    if (!first) data = await fetchFredHistory('DEXKOUS', d1, d2, Math.min(8000, budgetLeft()));
    else if (ymd(first) > shiftYmd(d1, 7)) {
      const head = await fetchFredHistory('DEXKOUS', d1, shiftYmd(ymd(first), -1), Math.min(8000, budgetLeft()));
      data = fillBefore(data, head);
    }
  }
  if (Object.keys(data).length === 0) {
    return new Response(`${key} 데이터 수집 실패 (Yahoo Finance)`, { status: 502 });
  }
  return csvResponse(data, recent);
}
