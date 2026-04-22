// Vercel Edge Function — 지표 장기 히스토리 수집
// stooq API 키 요구로 인해 Yahoo Finance v8 + FRED로 교체
export const config = { runtime: 'edge' };

const FRED_KEY = process.env.FRED_API_KEY ?? '';

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
  const start = new Date(Date.now() - 3 * 365.25 * 24 * 3600 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  return { start, end };
}

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const key   = searchParams.get('key') ?? '';
  const start = (searchParams.get('start') ?? '').replace(/-/g, '');
  const end   = (searchParams.get('end')   ?? '').replace(/-/g, '');

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
