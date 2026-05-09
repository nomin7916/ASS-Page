// Vercel Edge Function — ETF 구성종목 서버사이드 조회
// m.stock.naver.com/domestic/stock/{code}/analysis 페이지 API를 서버에서 직접 호출
export const config = { runtime: 'edge' };

const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Referer': 'https://m.stock.naver.com/',
};

function parseRatio(raw: any): number {
  if (raw == null) return 0;
  const n = parseFloat(String(raw).replace('%', '').trim());
  return isFinite(n) && n >= 0 ? n : 0;
}

function parseHoldingList(data: any): Array<{ name: string; code: string; ratio: number }> | null {
  const list =
    data?.etfTop10MajorConstituentAssets ??
    data?.etfComponentStockList ??
    data?.holdingList ??
    data?.etfHoldingList ??
    data?.items ??
    (Array.isArray(data) ? data : null) ??
    [];

  if (!Array.isArray(list) || list.length === 0) return null;

  const items = list.slice(0, 3).map((x: any) => ({
    name: x.itemName ?? x.stockName ?? x.name ?? x.holdingName ?? '',
    code: x.itemCode ?? x.stockCode ?? x.code ?? x.symbol ?? x.ticker ?? '',
    ratio: parseRatio(
      x.etfWeight ?? x.holdingRatio ?? x.holdingRate ?? x.ratio ??
      x.weight ?? x.constituentRatio ?? x.stockRatio ?? x.holdingWeightRatio
    ),
  })).filter((x: any) => x.name);

  if (items.length === 0) return null;

  // 비중이 소수 표현(0.085 = 8.5%)인 경우 100 곱하기
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

  const endpoints = [
    `https://m.stock.naver.com/api/domestic/stock/${code}/etfAnalysis`,
    `https://m.stock.naver.com/api/stock/${code}/etfAnalysis`,
    `https://m.stock.naver.com/api/domestic/stock/${code}/etfComponentStock`,
  ];

  if (debug) {
    const out: Record<string, any> = {};
    for (const url of endpoints) {
      const key = url.replace('https://m.stock.naver.com/api/', '').replace(`/${code}/`, '_');
      try {
        const res = await fetch(url, { headers: NAVER_HEADERS, signal: AbortSignal.timeout(8000) });
        out[key + '_status'] = res.status;
        if (res.ok) {
          const d = await res.json();
          out[key + '_topKeys'] = Object.keys(d);
          const list =
            d?.etfTop10MajorConstituentAssets ??
            d?.etfComponentStockList ??
            d?.holdingList ??
            d?.etfHoldingList ??
            (Array.isArray(d) ? d : null) ?? [];
          out[key + '_listLen'] = Array.isArray(list) ? list.length : 0;
          if (Array.isArray(list) && list.length > 0) {
            out[key + '_sample0'] = list[0];
            if (list[1]) out[key + '_sample1'] = list[1];
          } else {
            out[key + '_raw'] = JSON.stringify(d).slice(0, 600);
          }
        }
      } catch (e) {
        out[key + '_error'] = String(e);
      }
    }
    return new Response(JSON.stringify(out, null, 2), { headers });
  }

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: NAVER_HEADERS, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const result = parseHoldingList(data);
      if (result && result.length > 0) {
        return new Response(JSON.stringify(result), { headers });
      }
    } catch {}
  }

  return new Response(JSON.stringify(null), { headers });
}
