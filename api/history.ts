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

  // ── 국내금(goldKr): Naver fchart XML ──────────────────────────────────
  if (key === 'goldKr') {
    try {
      const res = await fetch(
        'https://fchart.stock.naver.com/sise.nhn?symbol=M04020000&timeframe=day&count=2000&requestType=0',
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
