// Vercel Edge Function — 해외주식 현재가 서버사이드 조회
// Yahoo Finance(직접) → KIS 해외주식 API → Naver worldstock polling 순으로 시도
export const config = { runtime: 'edge' };

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY = process.env.KIS_APP_KEY ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;
  if (_token && Date.now() < _tokenExpiry) return _token;
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
    _token = json.access_token;
    _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return _token;
  } catch { return null; }
}

// Naver suffix → KIS EXCD 매핑 (Reuters 거래소 코드 → KIS 거래소 코드)
const SUFFIX_TO_EXCD: Record<string, string> = { O: 'NASD', N: 'NYSE', P: 'AMEX', K: 'NYSE' };
const EXCD_TRY_ORDER = ['NASD', 'NYSE', 'AMEX'];

// 1순위: Yahoo Finance (서버사이드 직접 호출, CORS 없음)
async function yahooPrice(ticker: string): Promise<{ name: string; price: number; changeRate: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.chart?.result?.[0]) return null;
    const meta = data.chart.result[0].meta;
    const closes: (number | null)[] = data.chart.result[0].indicators?.quote?.[0]?.close ?? [];
    const price = closes.filter((p: number | null) => p !== null).pop() ?? meta?.regularMarketPrice;
    if (!price || price <= 0) return null;
    const prev = meta?.chartPreviousClose || meta?.previousClose;
    const changeRate = prev && prev > 0 ? ((price - prev) / prev) * 100 : (meta?.regularMarketChangePercent ?? 0);
    return { name: meta?.shortName || meta?.symbol || ticker, price, changeRate };
  } catch { return null; }
}

// 2순위: KIS 해외주식 현재가 (EXCD 힌트 있으면 직접, 없으면 NASD→NYSE→AMEX 순 시도)
async function kisPrice(
  baseTicker: string,
  token: string,
  excd?: string
): Promise<{ name: string; price: number; changeRate: number; excd: string } | null> {
  const targets = excd ? [excd] : EXCD_TRY_ORDER;
  for (const ex of targets) {
    try {
      const params = new URLSearchParams({ AUTH: '', EXCD: ex, SYMB: baseTicker });
      const res = await fetch(`${KIS_BASE}/uapi/overseas-price/v1/quotations/price?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
          appkey: KIS_APP_KEY,
          appsecret: KIS_APP_SECRET,
          tr_id: 'HHDFS00000300',
          custtype: 'P',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const out = json?.output;
      if (!out) continue;
      const price = parseFloat(String(out.last ?? out.stck_prpr ?? '0').replace(/,/g, ''));
      if (price <= 0) continue;
      const base = parseFloat(String(out.base ?? out.stck_prdy_clpr ?? '0').replace(/,/g, ''));
      const changeRate = base > 0 ? ((price - base) / base) * 100 : parseFloat(String(out.rate ?? out.prdy_ctrt ?? '0'));
      const name = out.name || out.hts_kor_isnm || out.rsym || baseTicker;
      return { name, price, changeRate, excd: ex };
    } catch { continue; }
  }
  return null;
}

// 3순위: Naver worldstock polling (suffix 순서로 탐색)
async function naverPrice(
  ticker: string
): Promise<{ name: string; price: number; changeRate: number; naverCode: string } | null> {
  const hasSuffix = /\.[A-Z]{1,2}$/.test(ticker);
  const base = hasSuffix ? ticker.split('.')[0] : ticker;
  const knownSuffix = hasSuffix ? ticker.split('.')[1] : null;
  const suffixOrder = knownSuffix
    ? [knownSuffix, ...Object.keys(SUFFIX_TO_EXCD).filter(s => s !== knownSuffix), 'Q']
    : [...Object.keys(SUFFIX_TO_EXCD), 'Q'];
  const codes = suffixOrder.map(s => `${base}.${s}`);

  for (const code of codes) {
    try {
      const res = await fetch(
        `https://polling.finance.naver.com/api/realtime/worldstock/stock/${encodeURIComponent(code)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            Referer: 'https://m.stock.naver.com/',
          },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (!res.ok) continue;
      const json = await res.json();
      const d = json?.datas?.[0];
      if (!d?.stockName) continue;
      const price = parseFloat(String(d.closePrice ?? '0').replace(/,/g, ''));
      if (price <= 0) continue;
      return {
        name: d.stockName,
        price,
        changeRate: parseFloat(String(d.fluctuationsRatio ?? '0')),
        naverCode: code,
      };
    } catch { continue; }
  }
  return null;
}

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawTicker = (searchParams.get('ticker') ?? '').trim().toUpperCase();
  const hintExcd = searchParams.get('excd') ?? '';

  if (!rawTicker) return new Response('ticker 파라미터 필요', { status: 400 });

  const baseTicker = rawTicker.includes('.') ? rawTicker.split('.')[0] : rawTicker;
  // suffix 또는 힌트에서 EXCD 파생 (NASD/NYSE/AMEX 중 하나)
  const suffixMatch = rawTicker.match(/\.([A-Z]{1,2})$/);
  const resolvedExcd = hintExcd || (suffixMatch ? SUFFIX_TO_EXCD[suffixMatch[1]] : undefined) || undefined;

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  // 1순위: Yahoo Finance
  const yahoo = await yahooPrice(baseTicker);
  if (yahoo) {
    return new Response(JSON.stringify({ ...yahoo, source: 'yahoo' }), { headers });
  }

  // 2순위: KIS 해외주식 현재가
  const token = await getToken();
  if (token) {
    const kis = await kisPrice(baseTicker, token, resolvedExcd);
    if (kis) {
      return new Response(
        JSON.stringify({ name: kis.name, price: kis.price, changeRate: kis.changeRate, excd: kis.excd, source: 'kis' }),
        { headers }
      );
    }
  }

  // 3순위: Naver worldstock polling
  const naver = await naverPrice(rawTicker);
  if (naver) {
    return new Response(
      JSON.stringify({ name: naver.name, price: naver.price, changeRate: naver.changeRate, naverCode: naver.naverCode, source: 'naver' }),
      { headers }
    );
  }

  return new Response('조회 실패 (Yahoo/KIS/Naver 모두 실패)', { status: 502 });
}
