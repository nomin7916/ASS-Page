// Vercel Edge Function — 지표 장기 히스토리 수집
// stooq API 키 요구로 인해 Yahoo Finance v8 + FRED로 교체
export const config = { runtime: 'edge' };

const FRED_KEY = process.env.FRED_API_KEY ?? '';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY = process.env.KIS_APP_KEY ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

let _kisToken: string | null = null;
let _kisTokenExpiry = 0;

async function getKisToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;
  if (_kisToken && Date.now() < _kisTokenExpiry) return _kisToken;
  try {
    const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.access_token) return null;
    _kisToken = json.access_token;
    _kisTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return _kisToken;
  } catch { return null; }
}

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

// FRED API로 과거 일별 데이터 수집 (us10y, usdkrw 등)
async function fetchFredHistory(seriesId: string, d1: string, d2: string): Promise<Record<string, number>> {
  if (!FRED_KEY) return {};
  const toDate = (d: string) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  const params: Record<string, string> = {
    series_id:  seriesId,
    api_key:    FRED_KEY,
    file_type:  'json',
    sort_order: 'asc',
    limit:      '2000',
  };
  if (d1) params.observation_start = toDate(d1);
  if (d2) params.observation_end   = toDate(d2);

  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?${new URLSearchParams(params)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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

// Naver m.stock 채권 prices API (일별 데이터 — FRED 월별보다 정밀)
async function fetchNaverBondHistory(reutersCode: string, d1: string, d2: string): Promise<Record<string, number>> {
  // d1/d2: YYYYMMDD → YYYYMMDDHHMMSS
  const toNaverDt = (d: string, end = false) =>
    `${d.slice(0,4)}${d.slice(4,6)}${d.slice(6,8)}${end ? '235959' : '000000'}`;

  const defStart = new Date(Date.now() - 3 * 365.25 * 24 * 3600 * 1000)
    .toISOString().split('T')[0].replace(/-/g, '');
  const defEnd = new Date().toISOString().split('T')[0].replace(/-/g, '');

  const start = toNaverDt(d1 || defStart, false);
  const end   = toNaverDt(d2 || defEnd,   true);

  const url = `https://m.stock.naver.com/api/marketIndex/bond/prices`
    + `?category=bond&reutersCode=${encodeURIComponent(reutersCode)}`
    + `&startDateTime=${start}&endDateTime=${end}&timeframe=day`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer':    'https://m.stock.naver.com/',
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return {};
    const data: any = await res.json();
    if (!data?.isSuccess || !Array.isArray(data?.result)) return {};

    const record: Record<string, number> = {};
    for (const item of data.result as any[]) {
      if (!item.localTradedAt || !item.closePrice) continue;
      const date  = String(item.localTradedAt).split('T')[0]; // "YYYY-MM-DD"
      const price = parseFloat(String(item.closePrice));
      if (!isNaN(price) && price > 0) record[date] = price;
    }
    return record;
  } catch {
    return {};
  }
}

// { date: price } → "Date,Close\n..." CSV 변환 (기존 parseIndexCSV 호환)
function toCSV(data: Record<string, number>): string {
  const lines = ['Date,Close'];
  for (const [date, price] of Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${date},${price}`);
  }
  return lines.join('\n');
}

function csvResponse(data: Record<string, number>): Response {
  return new Response(toCSV(data), {
    headers: {
      'Content-Type':                'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
    },
  });
}

function defaultDateRange() {
  const end   = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const start = new Date(Date.now() - 10 * 365.25 * 24 * 3600 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  return { start, end };
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

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const key   = searchParams.get('key') ?? '';
  const start = (searchParams.get('start') ?? '').replace(/-/g, '');
  const end   = (searchParams.get('end')   ?? '').replace(/-/g, '');

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
        const dates:  string[] = [];
        const prices: number[] = [];
        const dateRe  = /class="date">(\d{4})\.(\d{2})\.(\d{2})/g;
        const priceRe = /class="num">([\d,]+\.?\d*)</g;
        let dm: RegExpExecArray | null;
        while ((dm = dateRe.exec(html))  !== null) dates.push(`${dm[1]}-${dm[2]}-${dm[3]}`);
        let pm: RegExpExecArray | null;
        while ((pm = priceRe.exec(html)) !== null) {
          const v = parseFloat(pm[1].replace(/,/g, ''));
          if (v > 1000) prices.push(v);
        }
        const result: Record<string, number> = {};
        for (let i = 0; i < Math.min(dates.length, prices.length); i++) {
          result[dates[i]] = Math.round(prices[i]);
        }
        return result;
      } catch {
        return {};
      }
    };

    const pageNums = Array.from({ length: 100 }, (_, i) => i + 1);
    const results  = await Promise.allSettled(pageNums.map(p => parsePage(p)));
    const allData: Record<string, number> = {};
    for (const r of results) {
      if (r.status === 'fulfilled') Object.assign(allData, r.value);
    }
    if (Object.keys(allData).length < 10) {
      return new Response('국내금 데이터 수집 실패', { status: 502 });
    }
    return new Response(JSON.stringify(allData), {
      headers: {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
      },
    });
  }

  // ── 시장 지표 히스토리: Yahoo Finance + FRED (stooq 대체) ─────────────
  const { start: defStart, end: defEnd } = defaultDateRange();
  const d1 = start || defStart;
  const d2 = end   || defEnd;

  // us10y: FRED DGS10 → Naver daily → Yahoo ^TNX (3단계 fallback)
  if (key === 'us10y') {
    let data = await fetchFredHistory('DGS10', d1, d2);
    if (Object.keys(data).length < 10) {
      data = await fetchNaverBondHistory('US10YT=RR', d1, d2);
    }
    if (Object.keys(data).length < 10) {
      data = await fetchYahooHistory('^TNX', d1, d2);
    }
    if (Object.keys(data).length === 0) return new Response('us10y 수집 실패', { status: 502 });
    return csvResponse(data);
  }

  // fedRate: FRED DFEDTARU (연준 기준금리 상단 — 계단식 히스토리)
  if (key === 'fedRate') {
    const data = await fetchFredHistory('DFEDTARU', d1, d2);
    if (Object.keys(data).length === 0) return new Response('fedRate 수집 실패', { status: 502 });
    return csvResponse(data);
  }

  // kr10y: Naver 일별 primary → FRED IRLTLT01KRM156N 월별 fallback
  if (key === 'kr10y') {
    let data = await fetchNaverBondHistory('KR10YT=RR', d1, d2);
    if (Object.keys(data).length < 10) {
      data = await fetchFredHistory('IRLTLT01KRM156N', d1, d2);
    }
    if (Object.keys(data).length === 0) return new Response('kr10y 수집 실패', { status: 502 });
    return csvResponse(data);
  }

  // Yahoo Finance 지원 지표 (kr10y 포함)
  const yahooSymbol = YAHOO_SYMBOLS[key];
  if (!yahooSymbol) {
    return new Response(`Unknown indicator key: ${key}`, { status: 400 });
  }

  const data = await fetchYahooHistory(yahooSymbol, d1, d2);
  if (Object.keys(data).length === 0) {
    return new Response(`${key} 데이터 수집 실패 (Yahoo Finance)`, { status: 502 });
  }
  return csvResponse(data);
}
