// Vercel Edge Function — 시장 지표 서버사이드 수집
// 브라우저 CORS 없이 직접 FRED / Naver / Yahoo Finance 호출
export const config = { runtime: 'edge' };

const FRED_KEY = process.env.FRED_API_KEY ?? '';

async function safeJson(url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000), ...init });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// FRED API (미연준 공식): DGS10(US10Y), DFEDTARU(기준금리 상단)
async function fetchFred(seriesId: string) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=5`;
  const data = await safeJson(url);
  const obs: { value: string }[] = (data?.observations ?? []).filter((o: any) => o.value !== '.');
  if (!obs.length) return { price: null, change: null, source: 'FRED' };
  const price = parseFloat(obs[0].value);
  const prev  = obs.length > 1 ? parseFloat(obs[1].value) : null;
  return {
    price:  isNaN(price) ? null : price,
    change: prev && !isNaN(prev) ? ((price - prev) / Math.abs(prev)) * 100 : null,
    source: 'FRED',
  };
}

// Naver Mobile API (서버사이드 직접 호출 — CORS 없음)
async function fetchNaver(path: string, source: string) {
  const data = await safeJson(`https://m.stock.naver.com${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Referer':    'https://m.stock.naver.com/',
      'Accept':     'application/json',
    },
  });
  const raw    = String(data?.closePrice ?? data?.price ?? '0').replace(/,/g, '');
  const price  = parseFloat(raw);
  const change = data?.fluctuationsRatio != null ? parseFloat(String(data.fluctuationsRatio)) : null;
  return price > 0 ? { price, change, source } : { price: null, change: null, source };
}

// Yahoo Finance v8 chart API (서버사이드 직접 호출)
async function fetchYahoo(symbol: string) {
  const data = await safeJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
    {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }
  );
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return { price: null, change: null, source: 'Yahoo' };
  const price = meta.regularMarketPrice as number;
  const prev  = (meta.chartPreviousClose ?? meta.previousClose) as number | undefined;
  return { price, change: prev ? ((price / prev) - 1) * 100 : null, source: 'Yahoo' };
}

// CoinGecko (무료 공개 API — 암호화폐 fallback)
async function fetchCoinGecko(coinId: string) {
  const data = await safeJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`,
    { headers: { 'Accept': 'application/json' } }
  );
  const coin = data?.[coinId];
  return coin?.usd
    ? { price: coin.usd as number, change: (coin.usd_24h_change as number) ?? null, source: 'CoinGecko' }
    : { price: null, change: null, source: 'CoinGecko' };
}

export default async function handler(_req: Request): Promise<Response> {
  // 모든 지표를 병렬 수집 — 개별 실패가 전체에 영향 없음
  const [
    us10y, fedRate, kr10y, usdkrw, goldKr,
    kospi, sp500, nasdaq,
    dxy, goldIntlMain, goldIntlFallback,
    vix,
    btcYahoo, ethYahoo,
    btcCg, ethCg,
  ] = await Promise.allSettled([
    fetchFred('DGS10'),                                                // US 10Y
    fetchFred('DFEDTARU'),                                             // 미국 기준금리 상단
    fetchNaver('/api/marketIndex/bond/KR10YT=RR',      'Naver채권'),  // KR 10Y
    fetchNaver('/api/marketIndex/exchange/FX_USDKRW',  'Naver환율'),  // USDKRW
    fetchNaver('/api/stock/M04020000/basic',            'Naver금'),    // 국내금(KRX)
    fetchNaver('/api/index/KOSPI/basic',                'Naver'),      // KOSPI
    fetchNaver('/api/index/SPI@SPX/basic',              'Naver'),      // S&P500
    fetchNaver('/api/index/NAS@NDX/basic',              'Naver'),      // Nasdaq100
    fetchYahoo('DX-Y.NYB'),                                            // DXY
    fetchYahoo('GC=F'),                                                // 금 선물(primary)
    fetchYahoo('XAUUSD=X'),                                            // 금 현물(fallback)
    fetchYahoo('%5EVIX'),                                              // VIX
    fetchYahoo('BTC-USD'),                                             // BTC (Yahoo)
    fetchYahoo('ETH-USD'),                                             // ETH (Yahoo)
    fetchCoinGecko('bitcoin'),                                         // BTC (fallback)
    fetchCoinGecko('ethereum'),                                        // ETH (fallback)
  ]);

  const ok = <T>(r: PromiseSettledResult<T>) =>
    r.status === 'fulfilled' ? r.value : null;

  // GC=F 실패 시 XAUUSD=X 사용
  const goldIntl = ok(goldIntlMain)?.price ? ok(goldIntlMain) : ok(goldIntlFallback);
  // Yahoo 실패 시 CoinGecko 사용
  const btc = ok(btcYahoo)?.price ? ok(btcYahoo) : ok(btcCg);
  const eth = ok(ethYahoo)?.price ? ok(ethYahoo) : ok(ethCg);

  const body = {
    us10y:   ok(us10y),
    fedRate: ok(fedRate),
    kr10y:   ok(kr10y),
    usdkrw:  ok(usdkrw),
    goldKr:  ok(goldKr),
    kospi:   ok(kospi),
    sp500:   ok(sp500),
    nasdaq:  ok(nasdaq),
    dxy:     ok(dxy),
    goldIntl,
    vix:     ok(vix),
    btc,
    eth,
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Cache-Control':                's-maxage=600, stale-while-revalidate=60',
    },
  });
}
