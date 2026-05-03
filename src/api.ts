// ── 해외주식 히스토리: 서버사이드 Edge Function 경유 (Naver worldstock → Yahoo Finance) ──
export const fetchUsStockHistory = async (
  code: string,
  fromDate?: string
): Promise<{ data: Record<string, number>; source: string } | null> => {
  try {
    const params = new URLSearchParams({ key: 'worldstock', code });
    if (fromDate) params.set('start', fromDate.replace(/-/g, ''));
    const res = await fetch(`/api/history?${params}`, {
      signal: AbortSignal.timeout(90000), // 청크 다중 수집 시 최대 90초
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// ── KIS 종목 히스토리: 서버사이드 Edge Function 경유 ─────────────────────
// (인증 정보는 서버 env에만 보관 — 브라우저 번들에 미포함)

export const fetchKISStockHistory = async (
  code: string,
  fromYear: number = 2000
): Promise<{ data: Record<string, number>; source: string } | null> => {
  try {
    const params = new URLSearchParams({ code, fromYear: String(fromYear) });
    const res = await fetch(`/api/stock-history?${params}`, {
      signal: AbortSignal.timeout(60000), // 2000년부터 청크 수집 시 최대 60초
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// ── Naver fchart 종목 히스토리: 서버사이드 경유 (CORS 프록시 불필요) ────────
export const fetchNaverStockHistory = async (
  code: string,
  count: number = 2000
): Promise<{ data: Record<string, number>; source: string } | null> => {
  try {
    const params = new URLSearchParams({ key: 'stock', code, count: String(count) });
    const res = await fetch(`/api/history?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length < 100) return null;

    const result: Record<string, number> = {};
    const lines = text.split('<item data="');
    for (let i = 1; i < lines.length; i++) {
      const raw   = lines[i].split('"')[0];
      const parts = raw.split('|');
      if (parts.length >= 5) {
        const d     = parts[0];
        const close = parseInt(parts[4], 10);
        if (d.length === 8 && !isNaN(close) && close > 0) {
          result[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = close;
        }
      }
    }
    if (Object.keys(result).length > 10) return { data: result, source: 'naver-fchart' };
  } catch {
    // fall through
  }
  return null;
};
// ─────────────────────────────────────────────────────────────────────────────

export const fetchIndexData = async (symbol: string, startDate?: string) => {
  const stooqMap: Record<string, string> = { '^KS11': '^kospi', '^GSPC': '^spx' };
  const stooqSymbol = stooqMap[symbol];

  if (stooqSymbol) {
    try {
      const stooqUrl = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;
      const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(stooqUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${stooqUrl}`,
        `https://corsproxy.io/?url=${encodeURIComponent(stooqUrl)}`
      ];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy);
          if (!res.ok) continue;
          const text = await res.text();
          if (!text || text.includes('No data') || text.trim().length < 30) continue;
          const lines = text.trim().split('\n');
          if (lines.length < 2) continue;
          const result: Record<string, number> = {};
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length >= 5 && cols[0] && cols[4]) {
              const dateStr = cols[0].trim();
              const close = parseFloat(cols[4].trim());
              if (dateStr && !isNaN(close) && close > 0) {
                result[dateStr] = close;
              }
            }
          }
          if (Object.keys(result).length > 10) {
            return { data: result, source: `stooq` };
          }
        } catch (e) { continue; }
      }
    } catch (e) {}
  }

  const yahooQuery = startDate
    ? `period1=${Math.floor(new Date(startDate).getTime() / 1000)}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`
    : `range=2y&interval=1d`;
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?${yahooQuery}`;
  const proxies = [
    { url: `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`, name: 'corsproxy.io' },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, name: 'allorigins' },
    { url: `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`, name: 'codetabs' },
    { url: `https://thingproxy.freeboard.io/fetch/${targetUrl}`, name: 'thingproxy' }
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy.url);
      if (!res.ok) continue;
      const json = await res.json();
      const result: Record<string, number> = {};
      if (json.chart?.result?.[0]) {
        const timestamps: number[] = json.chart.result[0].timestamp;
        const closePrices: (number | null)[] = json.chart.result[0].indicators.quote[0].close;
        if (timestamps && closePrices) {
          timestamps.forEach((ts: number, idx: number) => {
            const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
            if (closePrices[idx] !== null) result[dateStr] = closePrices[idx] as number;
          });
        }
        if (Object.keys(result).length > 0) return { data: result, source: `Yahoo(${proxy.name})` };
      }
    } catch (e) {}
  }
  return null;
};

export const fetchStockInfo = async (code: string) => {
  if (!code || code.length < 5) return null;
  const targetUrl = `https://m.stock.naver.com/api/stock/${code}/basic`;
  const proxies = [
    `/api/proxy?url=${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.stockName) {
        return { name: data.stockName, price: parseInt(data.closePrice.replace(/,/g, '')), changeRate: parseFloat(data.fluctuationsRatio) };
      }
    } catch (e) { continue; }
  }
  return null;
};

// 해외(미국) 주식/ETF 현재가 조회: Naver polling → Naver worldstock → Yahoo Finance fallback
export const fetchUsStockInfo = async (ticker: string): Promise<{ name: string; price: number; changeRate: number } | null> => {
  if (!ticker || ticker.trim().length < 1) return null;
  const upper = ticker.trim().toUpperCase();

  const mkNaverProxies = (url: string) => [
    `/api/proxy?url=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${url}`,
  ];

  // 이미 거래소 코드 포함(.O/.K/.N/.P/.Q 등)된 경우 그 코드 먼저 시도, 아니면 후보 코드 순서로 시도
  const hasExchangeSuffix = /\.[A-Z]{1,2}$/.test(upper);
  const baseTicker = hasExchangeSuffix ? upper.split('.')[0] : upper;
  const naverCodes = hasExchangeSuffix
    ? [upper, ...['O','K','N','P','Q'].filter(s => !upper.endsWith(`.${s}`)).map(s => `${baseTicker}.${s}`)]
    : [`${upper}.O`, `${upper}.K`, `${upper}.N`, `${upper}.P`, `${upper}.Q`, upper];

  // 1순위: Naver polling realtime API (해외주식 전용, 종목명+현재가 포함)
  for (const code of naverCodes) {
    const pollingUrl = `https://polling.finance.naver.com/api/realtime/worldstock/stock/${code}`;
    for (const proxy of mkNaverProxies(pollingUrl)) {
      try {
        const res = await fetch(proxy, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        const json = await res.json();
        const datas = json?.datas;
        if (!Array.isArray(datas) || datas.length === 0) continue;
        const d = datas[0];
        const rawName = d?.stockName;
        if (!rawName) continue;
        const rawPrice = String(d.closePrice ?? '0').replace(/,/g, '');
        const price = parseFloat(rawPrice);
        if (price > 0) {
          return { name: rawName, price, changeRate: parseFloat(String(d.fluctuationsRatio ?? '0')) };
        }
      } catch { continue; }
    }
  }

  // 2순위: Naver m.stock basic API
  for (const code of naverCodes) {
    const targetUrl = `https://m.stock.naver.com/api/stock/${code}/basic`;
    for (const proxy of mkNaverProxies(targetUrl)) {
      try {
        const res = await fetch(proxy, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        const data = await res.json();
        const rawName = data?.stockName || data?.name;
        if (!rawName) continue;
        const rawPrice = String(data.closePrice ?? data.currentPrice ?? data.price ?? '0').replace(/,/g, '');
        const price = parseFloat(rawPrice);
        if (price > 0) {
          return {
            name: rawName,
            price,
            changeRate: parseFloat(String(data.fluctuationsRatio ?? data.fluctuations ?? '0')),
          };
        }
      } catch { continue; }
    }
  }

  // Yahoo Finance fallback
  const yahooTicker = upper.includes('.') ? upper.split('.')[0] : upper;
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?range=1d&interval=1d`;
  const yahooProxies = [
    `/api/proxy?url=${encodeURIComponent(yahooUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${yahooUrl}`,
  ];
  for (const proxy of yahooProxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.chart?.result?.[0]) {
        const meta = json.chart.result[0].meta;
        const closes: (number | null)[] = json.chart.result[0].indicators?.quote?.[0]?.close ?? [];
        const price = (closes as (number | null)[]).filter(p => p !== null).pop() ?? meta?.regularMarketPrice;
        if (price && price > 0) {
          const prev = meta?.chartPreviousClose || meta?.previousClose;
          const changeRate = prev && prev > 0 ? ((price - prev) / prev) * 100 : (meta?.regularMarketChangePercent ?? 0);
          return { name: meta?.shortName || meta?.symbol || yahooTicker, price, changeRate };
        }
      }
    } catch { continue; }
  }

  return null;
};

// ── funetf.co.kr 펀드 기준가 조회 ─────────────────────────────────────────
export const fetchFundInfo = async (code: string): Promise<{ name: string; price: number; changeRate: number } | null> => {
  if (!code || code.trim().length < 8) return null;
  const c = code.trim();

  const targetUrl = `https://www.funetf.co.kr/product/fund/view/${c}`;
  const proxies = [
    `/api/proxy?url=${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`,
  ];

  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 500) continue;

      // Next.js __NEXT_DATA__ 내장 JSON 파싱 시도
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        try {
          const nd = JSON.parse(nextDataMatch[1]);
          const pp = nd?.props?.pageProps;
          if (pp) {
            const rawPrice = pp.nav ?? pp.price ?? pp.basicPrice ?? pp.fundInfo?.nav ?? pp.fundInfo?.price;
            const rawName  = pp.fundName ?? pp.name ?? pp.fundInfo?.fundName ?? pp.fundInfo?.name;
            const rawRate  = pp.changeRate ?? pp.changeRatio ?? pp.fundInfo?.changeRate;
            if (rawPrice && rawName) {
              const price = parseFloat(String(rawPrice).replace(/,/g, ''));
              if (price > 0) return { name: String(rawName), price, changeRate: parseFloat(String(rawRate ?? 0)) };
            }
          }
        } catch { /* HTML 파싱으로 폴백 */ }
      }

      // HTML 파싱 폴백
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
      let name = titleMatch ? titleMatch[1].split('|')[0].split('-')[0].split('·')[0].trim() : '';

      let price = 0;
      for (const pat of [
        /기준가[^\d]*([0-9]{1,4}(?:,[0-9]{3})*(?:\.[0-9]+)?)/,
        /기준가격[^\d]*([0-9]{1,4}(?:,[0-9]{3})*(?:\.[0-9]+)?)/,
        /현재가[^\d]*([0-9]{1,4}(?:,[0-9]{3})*(?:\.[0-9]+)?)/,
        /"nav"\s*:\s*"?([0-9.]+)"?/,
        /"price"\s*:\s*"?([0-9.]+)"?/,
      ]) {
        const m = html.match(pat);
        if (m) {
          const v = parseFloat(m[1].replace(/,/g, ''));
          if (v > 100) { price = v; break; }
        }
      }

      let changeRate = 0;
      for (const pat of [
        /등락률[^0-9+\-]*([+\-]?[0-9]+(?:\.[0-9]+)?)/,
        /전일대비[^0-9+\-]*([+\-]?[0-9]+(?:\.[0-9]+)?)/,
        /"changeRate"\s*:\s*"?([+\-]?[0-9.]+)"?/,
      ]) {
        const m = html.match(pat);
        if (m) { changeRate = parseFloat(m[1]); break; }
      }

      if (price > 0) return { name: name || c, price, changeRate };
    } catch { continue; }
  }
  return null;
};

export const fetchDividendHistory = async (code: string): Promise<{
  totalCount: number;
  result: Array<{ dividendAmount: number; exDividendAt: string; dividendYield: number }>;
} | null> => {
  if (!code || !/^[A-Z0-9]{5,6}$/i.test(code)) return null;
  const targetUrls = [
    `https://m.stock.naver.com/api/etf/${code}/dividend/history?page=1&pageSize=100&firstPageSize=100`,
    `https://m.stock.naver.com/api/domestic/stock/${code}/dividend/history?page=1&pageSize=100&firstPageSize=100`,
    `https://m.stock.naver.com/api/dividend/history?itemCode=${code}&page=1&pageSize=100`,
  ];
  const proxyFns = [
    (u: string) => `/api/proxy?url=${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${u}`,
  ];
  for (const targetUrl of targetUrls) {
    for (const makeProxy of proxyFns) {
      try {
        const res = await fetch(makeProxy(targetUrl), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.result && Array.isArray(data.result) && data.result.length > 0) return data;
      } catch { continue; }
    }
  }
  return null;
};

export const fetchYahooDividendHistory = async (ticker: string): Promise<{ [yearMonth: string]: number } | null> => {
  if (!ticker || !/^[A-Z]{1,5}$/i.test(ticker)) return null;
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.toUpperCase()}?events=div&interval=1d&range=10y`;
  const proxyFns = [
    (u: string) => `/api/proxy?url=${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${u}`,
  ];
  for (const makeProxy of proxyFns) {
    try {
      const res = await fetch(makeProxy(targetUrl), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const dividends = data?.chart?.result?.[0]?.events?.dividends;
      if (!dividends) continue;
      const entries = Object.values(dividends) as Array<{ amount: number; date: number }>;
      if (!entries.length) continue;
      const monthData: { [yearMonth: string]: number } = {};
      entries.forEach(({ amount, date }) => {
        const d = new Date(date * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthData[key] = (monthData[key] || 0) + amount;
      });
      return Object.keys(monthData).length > 0 ? monthData : null;
    } catch { continue; }
  }
  return null;
};

// ── ETF 구성종목 Top3 조회 (네이버 증권) ────────────────────────────────────
const _etfHoldingsCache = new Map<string, { data: Array<{ name: string; code: string; ratio: number }> | null; ts: number }>();

const _parseHoldingList = (data: any): Array<{ name: string; code: string; ratio: number }> | null => {
  const list = data?.etfTop10MajorConstituentAssets ?? data?.etfComponentStockList ?? data?.holdingList ?? data?.etfHoldingList ?? data?.items ?? data?.data ?? [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const result = list.slice(0, 3).map((x: any) => ({
    name: x.itemName ?? x.stockName ?? x.name ?? '',
    code: x.itemCode ?? x.stockCode ?? x.code ?? '',
    ratio: parseFloat(String(x.etfWeight ?? x.holdingRatio ?? x.ratio ?? x.weight ?? 0).replace('%', '')),
  })).filter((x: any) => x.name);
  return result.length > 0 ? result : null;
};

export const fetchEtfTopHoldings = async (
  code: string
): Promise<Array<{ name: string; code: string; ratio: number }> | null> => {
  const cached = _etfHoldingsCache.get(code);
  if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached.data;

  const targetUrls = [
    `https://m.stock.naver.com/api/stock/${code}/etfAnalysis`,
    `https://m.stock.naver.com/api/domestic/stock/${code}/etfComponentStock`,
    `https://m.stock.naver.com/api/etf/${code}/holding`,
    `https://m.stock.naver.com/api/domestic/stock/${code}/etfHolding`,
    `https://m.stock.naver.com/api/stock/${code}/etfHolding`,
  ];
  const makeProxies = (url: string) => [
    url,
    `/api/proxy?url=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${url}`,
  ];

  for (const targetUrl of targetUrls) {
    for (const proxy of makeProxies(targetUrl)) {
      try {
        const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const data = await res.json();
        const result = _parseHoldingList(data);
        if (result) {
          _etfHoldingsCache.set(code, { data: result, ts: Date.now() });
          return result;
        }
      } catch { continue; }
    }
  }
  _etfHoldingsCache.set(code, { data: null, ts: Date.now() });
  return null;
};

// ── 종목 PER / 추정PER 조회 (주가 ÷ EPS 직접 계산) ─────────────────────────
// naver /basic 엔드포인트에는 PER 필드가 없음 → /basic 주가 + /finance/summary EPS 조합
const _stockPerCache = new Map<string, { data: { per: number | null; fper: number | null } | null; ts: number }>();

export const fetchStockPer = async (
  code: string
): Promise<{ per: number | null; fper: number | null } | null> => {
  const cached = _stockPerCache.get(code);
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) return cached.data;

  const parseNum = (v: any): number | null => {
    if (v == null || v === '' || v === '-') return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) || n <= 0 ? null : n;
  };

  const mkProxies = (url: string) => [
    url,
    `/api/proxy?url=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${url}`,
  ];

  // Step 1: 현재가 조회
  let closePrice: number | null = null;
  let isEtf = false;
  for (const proxy of mkProxies(`https://m.stock.naver.com/api/stock/${code}/basic`)) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.stockName && data?.closePrice) {
        closePrice = parseNum(String(data.closePrice).replace(/,/g, ''));
        isEtf = data.stockEndType === 'etf';
        break;
      }
    } catch { continue; }
  }

  // ETF는 EPS 기반 PER 없음
  if (!closePrice || isEtf) {
    _stockPerCache.set(code, { data: null, ts: Date.now() });
    return null;
  }

  // Step 2: 분기 EPS 조회 → PER = 주가 / 연환산EPS
  for (const proxy of mkProxies(`https://m.stock.naver.com/api/stock/${code}/finance/summary`)) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const epsRow: any[] = (data?.chartEps?.columns as any[])?.find((c: any[]) => c[0] === 'EPS');
      const titleList: any[] = data?.chartEps?.trTitleList;
      if (!epsRow || !titleList) continue;

      const quarters = titleList.map((t: any, i: number) => ({
        isConsensus: t.isConsensus === 'Y',
        eps: parseNum(epsRow[i + 1]),
      })).filter((q: any) => q.eps !== null);

      const actualQ = quarters.filter((q: any) => !q.isConsensus);
      const consensusQ = quarters.filter((q: any) => q.isConsensus);

      // trailing PER: 최근 4분기 실적 EPS 합산
      let per: number | null = null;
      const last4 = actualQ.slice(-4);
      if (last4.length >= 4) {
        const annualEps = last4.reduce((s: number, q: any) => s + q.eps, 0);
        if (annualEps > 0) per = Math.round(closePrice / annualEps * 100) / 100;
      }

      // forward PER: 첫 컨센서스 분기 EPS × 4 연환산
      let fper: number | null = null;
      if (consensusQ.length > 0 && consensusQ[0].eps > 0) {
        fper = Math.round(closePrice / (consensusQ[0].eps * 4) * 100) / 100;
      }

      const result = { per, fper };
      _stockPerCache.set(code, { data: result, ts: Date.now() });
      return result;
    } catch { continue; }
  }

  _stockPerCache.set(code, { data: null, ts: Date.now() });
  return null;
};

export const fetchNaverKospi = async () => {
  const targetUrl = `https://m.stock.naver.com/api/index/KOSPI/basic`;
  const proxies = [
    `/api/proxy?url=${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && (data.closePrice || data.price)) {
        const price = parseFloat((data.closePrice || data.price || '0').replace(/,/g, ''));
        if (price > 0) return price;
      }
    } catch (e) { continue; }
  }
  return null;
};
