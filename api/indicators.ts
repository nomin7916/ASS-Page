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
  if (!FRED_KEY) return { price: null, change: null, source: 'FRED' };
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

// Naver m.stock front-api (국내금 M04020000 실시간 현재가 — fetchNaverBond와 동일 패턴)
async function fetchGoldKrNaverMetal(): Promise<{ price: number | null; change: number | null; source: string }> {
  const data = await safeJson(
    'https://m.stock.naver.com/front-api/marketIndex/productDetail?category=metals&reutersCode=M04020000',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer':    'https://m.stock.naver.com/',
        'Accept':     'application/json',
      },
    }
  );
  if (!data?.isSuccess) return { price: null, change: null, source: 'NaverGoldKr' };
  const result = data.result;
  const price  = parseFloat(String(result?.closePrice ?? '0').replace(/,/g, ''));
  const change = result?.fluctuationsRatio != null ? parseFloat(String(result.fluctuationsRatio)) : null;
  return price > 0 ? { price: Math.round(price), change, source: 'NaverGoldKr' } : { price: null, change: null, source: 'NaverGoldKr' };
}

// finance.naver.com 금일별시세 HTML 파싱 (국내금 fallback — 기준가 기반)
async function fetchGoldKrFinanceNaver(): Promise<{ price: number | null; change: number | null; source: string }> {
  try {
    const res = await fetch(
      'https://finance.naver.com/marketindex/goldDailyQuote.naver?page=1',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Referer':    'https://finance.naver.com/marketindex/',
        },
        signal: AbortSignal.timeout(9000),
      }
    );
    if (!res.ok) return { price: null, change: null, source: 'Naver금' };
    const html  = await res.text();
    const prices: number[] = [];
    const re = /class="num">([\d,]+\.?\d*)</g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (v > 1000) prices.push(v);
    }
    if (prices.length < 2) return { price: null, change: null, source: 'Naver금' };
    const price  = prices[0];
    const prev   = prices[1];
    const change = prev > 0 ? ((price - prev) / prev) * 100 : null;
    return { price: Math.round(price), change, source: 'Naver금' };
  } catch {
    return { price: null, change: null, source: 'Naver금' };
  }
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

// Naver front-api/marketIndex/productDetail (채권 현재가 — /api/marketIndex/bond/ 경로 deprecated 대체)
async function fetchNaverBond(reutersCode: string, source: string) {
  const data = await safeJson(
    `https://m.stock.naver.com/front-api/marketIndex/productDetail?category=bond&reutersCode=${encodeURIComponent(reutersCode)}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer':    'https://m.stock.naver.com/',
        'Accept':     'application/json',
      },
    }
  );
  if (!data?.isSuccess) return { price: null, change: null, source };
  const result = data.result;
  const price  = parseFloat(String(result?.closePrice ?? '0').replace(/,/g, ''));
  const change = result?.fluctuationsRatio != null ? parseFloat(String(result.fluctuationsRatio)) : null;
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

// Naver m.stock front-api (국제금 GCcv1 실시간 — CORS 없는 서버사이드 전용)
async function fetchNaverGoldIntl(): Promise<{ price: number | null; change: number | null; source: string }> {
  try {
    const res = await fetch(
      'https://m.stock.naver.com/front-api/realTime/marketIndex/metals',
      {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Content-Type': 'application/json',
          'Accept':       'application/json, text/plain, */*',
          'Referer':      'https://m.stock.naver.com/marketindex/metals/GCcv1',
        },
        body: JSON.stringify({ reutersCodes: ['GCcv1'] }),
        signal: AbortSignal.timeout(9000),
      }
    );
    if (!res.ok) return { price: null, change: null, source: 'NaverGold' };
    const data = await res.json();
    if (!data?.isSuccess) return { price: null, change: null, source: 'NaverGold' };
    const item = data?.result?.metals?.GCcv1;
    if (!item) return { price: null, change: null, source: 'NaverGold' };
    const price  = parseFloat(String(item.closePrice).replace(/,/g, ''));
    const change = item.fluctuationsRatio != null ? parseFloat(String(item.fluctuationsRatio)) : null;
    return price > 0 ? { price, change, source: 'NaverGold' } : { price: null, change: null, source: 'NaverGold' };
  } catch {
    return { price: null, change: null, source: 'NaverGold' };
  }
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
    us10yFred, us10yYahoo, us10yNaver, fedRate,
    kr10yNaver, kr10yYahoo,
    kospi,
    sp500Yahoo, sp500Naver,
    nasdaqYahoo, nasdaqNaver,
    usdkrwYahoo, usdkrwNaver,
    goldKrMetal, goldKrHtml,
    dxy, goldIntlMain, goldIntlFallback, goldIntlNaver,
    vix,
    btcYahoo, ethYahoo,
    btcCg, ethCg,
  ] = await Promise.allSettled([
    fetchFred('DGS10'),                                                // US 10Y (FRED — 영업일 종가 기준)
    fetchYahoo('^TNX'),                                                // US 10Y (Yahoo — 장중 실시간 fallback)
    fetchNaverBond('US10YT=RR', 'Naver채권US'),                        // US 10Y (Naver — 3rd fallback)
    fetchFred('DFEDTARU'),                                             // 미국 기준금리 상단 (FRED)
    fetchNaverBond('KR10YT=RR', 'Naver채권'),                         // KR 10Y (Naver primary)
    fetchYahoo('^KR10YT=RR'),                                          // KR 10Y (Yahoo fallback)
    fetchNaver('/api/index/KOSPI/basic',                'Naver'),      // KOSPI
    fetchYahoo('^GSPC'),                                               // S&P500 (Yahoo primary)
    fetchNaver('/api/index/SPI@SPX/basic',              'Naver'),      // S&P500 (Naver fallback)
    fetchYahoo('^NDX'),                                                // Nasdaq100 (Yahoo primary)
    fetchNaver('/api/index/NAS@NDX/basic',              'Naver'),      // Nasdaq100 (Naver fallback)
    fetchYahoo('KRW=X'),                                               // USDKRW (Yahoo primary)
    fetchNaver('/api/marketIndex/exchange/FX_USDKRW',  'Naver환율'),  // USDKRW (Naver fallback)
    fetchGoldKrNaverMetal(),                                           // 국내금 M04020000 실시간 (primary)
    fetchGoldKrFinanceNaver(),                                         // 국내금 HTML 기준가 (fallback)
    fetchYahoo('DX-Y.NYB'),                                            // DXY
    fetchYahoo('GC=F'),                                                // 국제금 선물(Yahoo primary)
    fetchYahoo('XAUUSD=X'),                                            // 국제금 현물(Yahoo fallback)
    fetchNaverGoldIntl(),                                              // 국제금 GCcv1(Naver — 3rd fallback)
    fetchYahoo('^VIX'),                                                // VIX
    fetchYahoo('BTC-USD'),                                             // BTC (Yahoo)
    fetchYahoo('ETH-USD'),                                             // ETH (Yahoo)
    fetchCoinGecko('bitcoin'),                                         // BTC (fallback)
    fetchCoinGecko('ethereum'),                                        // ETH (fallback)
  ]);

  const ok = <T>(r: PromiseSettledResult<T>) =>
    r.status === 'fulfilled' ? r.value : null;

  // GC=F → XAUUSD=X → Naver GCcv1 순으로 fallback
  const goldIntl = ok(goldIntlMain)?.price ? ok(goldIntlMain)
    : ok(goldIntlFallback)?.price ? ok(goldIntlFallback)
    : ok(goldIntlNaver);
  // Yahoo 실패 시 CoinGecko 사용
  const btc = ok(btcYahoo)?.price ? ok(btcYahoo) : ok(btcCg);
  const eth = ok(ethYahoo)?.price ? ok(ethYahoo) : ok(ethCg);
  // Yahoo primary, Naver fallback
  const sp500  = ok(sp500Yahoo)?.price  ? ok(sp500Yahoo)  : ok(sp500Naver);
  const nasdaq = ok(nasdaqYahoo)?.price ? ok(nasdaqYahoo) : ok(nasdaqNaver);
  const usdkrw = ok(usdkrwYahoo)?.price ? ok(usdkrwYahoo) : ok(usdkrwNaver);
  // US 10Y: Naver(실시간) → Yahoo → FRED(전일 종가 fallback)
  const us10y = ok(us10yNaver)?.price ? ok(us10yNaver) : ok(us10yYahoo)?.price ? ok(us10yYahoo) : ok(us10yFred);
  // KR 10Y: Naver primary → Yahoo fallback
  const kr10y = ok(kr10yNaver)?.price ? ok(kr10yNaver) : ok(kr10yYahoo);
  // 국내금: Naver front-api(M04020000) → HTML 기준가 순으로 fallback
  const goldKr = ok(goldKrMetal)?.price ? ok(goldKrMetal) : ok(goldKrHtml)?.price ? ok(goldKrHtml) : null;

  const body = {
    us10y,
    fedRate: ok(fedRate),
    kr10y,
    usdkrw,
    goldKr,
    kospi:   ok(kospi),
    sp500,
    nasdaq,
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
      'Cache-Control':                's-maxage=300, stale-while-revalidate=60',
    },
  });
}
