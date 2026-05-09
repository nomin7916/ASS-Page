// Vercel Edge Function — ETF 구성종목 서버사이드 조회
// 국내 ETF: Naver etfWeight 직접 사용
// 해외 ETF: etfBaseIndex → 대응 미국 ETF → Yahoo Finance topHoldings
export const config = { runtime: 'edge' };

const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Referer': 'https://m.stock.naver.com/',
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// etfBaseIndex 문자열 → 미국 ETF 티커 매핑
function matchIndexToUsTicker(baseIndex: string): string | null {
  if (!baseIndex) return null;
  const u = baseIndex.toUpperCase();

  if (u.includes('NASDAQ 100') || u.includes('NASDAQ-100') || u.includes('NASDAQ100')) return 'QQQ';
  if (u.includes('S&P 500') || u.includes('S&P500')) return 'SPY';
  if (u.includes('DOW JONES')) return 'DIA';
  if (u.includes('RUSSELL 2000')) return 'IWM';
  if (u.includes('RUSSELL 1000')) return 'IWB';
  if (u.includes('PHLX SEMICONDUCTOR') || u.includes('PHILADELPHIA SEMICONDUCTOR')) return 'SOXX';
  if (u.includes('NIFTY 50') || u.includes('NIFTY50')) return 'INDY';
  if (u.includes('CSI 300') || u.includes('CSI300')) return 'ASHR';
  if (u.includes('MSCI CHINA')) return 'MCHI';
  if (u.includes('MSCI EM') || u.includes('MSCI EMERGING')) return 'EEM';
  if (u.includes('MSCI WORLD')) return 'URTH';
  if (u.includes('MSCI EUROPE')) return 'EZU';
  if (u.includes('NIKKEI')) return 'EWJ';
  if (u.includes('HANG SENG')) return 'EWH';
  if (u.includes('GLOBAL CLEAN ENERGY')) return 'ICLN';
  if (u.includes('BIOTECH')) return 'XBI';
  if (u.includes('FINANCIAL')) return 'XLF';
  if (u.includes('ENERGY') && !u.includes('CLEAN')) return 'XLE';
  if (u.includes('REAL ESTATE') || u.includes('REIT')) return 'VNQ';

  return null;
}

async function fetchYahooHoldings(
  ticker: string
): Promise<Array<{ name: string; code: string; ratio: number }> | null> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=topHoldings`;
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    const holdings = data?.quoteSummary?.result?.[0]?.topHoldings?.holdings;
    if (!Array.isArray(holdings) || holdings.length === 0) return null;
    const result = holdings.slice(0, 3).map((h: any) => ({
      name: h.holdingName ?? h.symbol ?? '',
      code: h.symbol ?? '',
      ratio: (() => {
        const r = h.holdingPercent?.raw;
        return r != null && isFinite(r) ? Math.round(r * 10000) / 100 : 0;
      })(),
    })).filter((h: any) => h.name);
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

function parseNaverHoldingList(
  list: any[]
): Array<{ name: string; code: string; ratio: number }> | null {
  const items = list.slice(0, 3).map((x: any) => {
    const raw = x.etfWeight ?? x.holdingRatio ?? x.holdingRate ?? x.ratio ??
                x.weight ?? x.constituentRatio ?? x.stockRatio ?? x.holdingWeightRatio;
    let ratio = 0;
    if (raw != null && raw !== '-') {
      const n = parseFloat(String(raw).replace('%', '').trim());
      ratio = isFinite(n) && n >= 0 ? n : 0;
    }
    return {
      name: x.itemName ?? x.stockName ?? x.name ?? x.holdingName ?? '',
      code: x.itemCode ?? x.stockCode ?? x.code ?? x.symbol ?? x.ticker ?? '',
      ratio,
    };
  }).filter((x: any) => x.name);

  if (items.length === 0) return null;

  // 소수 표현(0.085 = 8.5%) 정규화
  const nonZero = items.filter((x: any) => x.ratio > 0);
  if (nonZero.length > 0 && Math.max(...nonZero.map((x: any) => x.ratio)) < 2.0) {
    items.forEach((x: any) => { x.ratio = Math.round(x.ratio * 10000) / 100; });
  }

  return items;
}

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get('code') ?? '').trim().toUpperCase();
  const debug = searchParams.get('debug') === '1';

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };

  if (!code || !/^[A-Z0-9]{5,6}$/.test(code)) {
    return new Response(JSON.stringify(null), { headers });
  }

  let naverData: any = null;
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${code}/etfAnalysis`,
      { headers: NAVER_HEADERS, signal: AbortSignal.timeout(10000) }
    );
    if (res.ok) naverData = await res.json();
  } catch {}

  if (!naverData) {
    return new Response(JSON.stringify(null), { headers });
  }

  const rawList: any[] = naverData?.etfTop10MajorConstituentAssets ?? [];
  const isOverseas = Array.isArray(rawList) && rawList.length > 0 && rawList[0]?.etfWeight === '-';
  const baseIndex: string = naverData?.etfBaseIndex ?? '';
  const mappedTicker = isOverseas ? matchIndexToUsTicker(baseIndex) : null;

  if (debug) {
    return new Response(JSON.stringify({
      etfName: naverData.itemName,
      etfBaseIndex: baseIndex,
      isOverseas,
      mappedTicker,
      sample: rawList.slice(0, 2).map((x: any) => ({
        name: x.itemName, code: x.itemCode, etfWeight: x.etfWeight, stockCount: x.stockCount,
      })),
    }, null, 2), { headers });
  }

  if (isOverseas) {
    if (mappedTicker) {
      const yahooResult = await fetchYahooHoldings(mappedTicker);
      if (yahooResult) {
        return new Response(JSON.stringify(yahooResult), { headers });
      }
    }
    // Yahoo 실패 또는 매핑 없음: Naver 이름만 반환 (weight 0, code 없음)
    const fallback = parseNaverHoldingList(rawList);
    return new Response(JSON.stringify(fallback), { headers });
  }

  // 국내 ETF: Naver etfWeight 사용
  const result = parseNaverHoldingList(rawList);
  return new Response(JSON.stringify(result), { headers });
}
