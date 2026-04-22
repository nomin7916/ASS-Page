// Vercel Edge Function — 지표 장기 데이터 수집 (stooq / Naver fchart)
// 브라우저에서 공용 프록시를 경유하던 stooq/Naver 요청을 서버사이드로 이전
export const config = { runtime: 'edge' };

const STOOQ_SYMBOLS: Record<string, string> = {
  us10y:    'tnx.us',
  goldIntl: 'xauusd.oanda',
  usdkrw:   'usdkrw.fx',
  dxy:      'dxy.f',
  vix:      '^vix',
  btc:      'btcusd.cf',
  eth:      'ethusd.cf',
};

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const key   = searchParams.get('key') ?? '';
  const start = (searchParams.get('start') ?? '').replace(/-/g, '');
  const end   = (searchParams.get('end')   ?? '').replace(/-/g, '');

  // ── 개별 종목 히스토리: Naver fchart XML (key=stock&code=XXXXX) ─────────
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
          if (v > 1000) prices.push(v); // 국내금 KRW/g 가격은 항상 > 1000
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

    // 100페이지 동시 수집 (~1000 거래일 = 약 4년치)
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

  // ── stooq CSV (us10y, goldIntl, usdkrw, dxy, vix, btc, eth) ──────────
  const symbol = STOOQ_SYMBOLS[key];
  if (!symbol) {
    return new Response(`Unknown indicator key: ${key}`, { status: 400 });
  }

  const defaultStart = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 3);
    return d.toISOString().split('T')[0].replace(/-/g, '');
  })();
  const defaultEnd = new Date().toISOString().split('T')[0].replace(/-/g, '');

  const d1 = start || defaultStart;
  const d2 = end   || defaultEnd;

  const stooqUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${d1}&d2=${d2}&i=d`;

  try {
    const res = await fetch(stooqUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'text/csv,text/plain,*/*',
        'Referer':    'https://stooq.com/',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return new Response(`stooq ${res.status}`, { status: 502 });
    const body = await res.text();
    return new Response(body, {
      headers: {
        'Content-Type':                'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               's-maxage=3600, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    return new Response(`stooq error: ${e}`, { status: 502 });
  }
}
