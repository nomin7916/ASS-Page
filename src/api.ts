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
  const yahooQuery = startDate
    ? `period1=${Math.floor(new Date(startDate).getTime() / 1000)}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`
    : `range=2y&interval=1d`;
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?${yahooQuery}`;
  const proxies = [
    { url: `/api/proxy?url=${encodeURIComponent(targetUrl)}`, name: 'server' },
    { url: `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`, name: 'corsproxy.io' },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, name: 'allorigins' },
    { url: `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`, name: 'codetabs' }
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

// 해외(미국) 주식/ETF 현재가 조회: 서버사이드 라우트 1순위 → 클라이언트 사이드 fallback
export const fetchUsStockInfo = async (ticker: string): Promise<{ name: string; price: number; changeRate: number } | null> => {
  if (!ticker || ticker.trim().length < 1) return null;
  const upper = ticker.trim().toUpperCase();

  // 1순위: 서버사이드 /api/us-stock-price (Yahoo → KIS → Naver 내부 처리, CORS 없음)
  try {
    const params = new URLSearchParams({ ticker: upper });
    const res = await fetch(`/api/us-stock-price?${params}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.price > 0) {
        return { name: data.name || upper, price: data.price, changeRate: data.changeRate ?? 0 };
      }
    }
  } catch { /* fall through */ }

  // 2순위: 클라이언트 사이드 Naver polling (서버 라우트 불가 시 fallback)
  const mkNaverProxies = (url: string) => [
    `/api/proxy?url=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${url}`,
  ];
  const hasExchangeSuffix = /\.[A-Z]{1,2}$/.test(upper);
  const baseTicker = hasExchangeSuffix ? upper.split('.')[0] : upper;
  const naverCodes = hasExchangeSuffix
    ? [upper, ...['O','K','N','P','Q'].filter(s => !upper.endsWith(`.${s}`)).map(s => `${baseTicker}.${s}`)]
    : [`${upper}.O`, `${upper}.K`, `${upper}.N`, `${upper}.P`, `${upper}.Q`, upper];

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

  // 3순위: Yahoo Finance 클라이언트 사이드 (최종 fallback)
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
  const c = code.trim().toUpperCase();

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

// ── funetf.co.kr 펀드 기준가 이력 조회 ──────────────────────────────────────
export const fetchFundNavHistory = async (
  code: string,
  startDate: string, // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
): Promise<Record<string, number> | null> => {
  if (!code || code.trim().length < 8) return null;
  const c = code.trim().toUpperCase();
  const today = endDate.replace(/-/g, '');
  const start = startDate.replace(/-/g, '');
  const end = endDate.replace(/-/g, '');
  const apiUrl = `https://www.funetf.co.kr/api/public/product/view/fundnav?gijunYmd=${today}&wGijunYmd=${today}&fundCd=${c}&schNavTerm=A&schNavStDt=${start}&schNavEdDt=${end}&schCtenDvsn=MK_VIEW`;
  const proxies = [
    apiUrl,
    `/api/proxy?url=${encodeURIComponent(apiUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(apiUrl)}`,
  ];
  for (const url of proxies) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json();
      const list =
        data?.fundNavListInfo?.list ??
        data?.fundNavList ??
        data?.navList ??
        data?.list ??
        (Array.isArray(data) ? data : null);
      if (!Array.isArray(list) || list.length === 0) continue;
      const result: Record<string, number> = {};
      for (const item of list) {
        const dateRaw = item.gijunYmd ?? item.date ?? item.dt ?? item.ymd;
        // funetf 응답 필드: gijunGa(기준가) / ugijunGa(수정기준가). 라이브
        // fetchFundInfo가 기준가를 쓰므로 gijunGa 우선, 그다음 폴백.
        const priceRaw = item.gijunGa ?? item.ugijunGa ?? item.nav ?? item.basicNav ?? item.fundNav ?? item.basicPrice ?? item.price;
        if (!dateRaw || !priceRaw) continue;
        const d = String(dateRaw).replace(/-/g, '');
        if (d.length !== 8) continue;
        const dateStr = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const price = parseFloat(String(priceRaw).replace(/,/g, ''));
        if (price > 0) result[dateStr] = price;
      }
      if (Object.keys(result).length > 0) return result;
    } catch { continue; }
  }
  return null;
};

// ── 미래에셋 기준가 HTML 파싱 헬퍼 ──────────────────────────────────────────
function parseMiraeBasePricesHtml(html: string): Array<{ date: string; price: number }> {
  const results: Array<{ date: string; price: number }> = [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const content = tbodyMatch ? tbodyMatch[1] : html;
  const rows = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) continue;
    const getText = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    const dateRaw = getText(cells[0][1]);
    const priceRaw = getText(cells[1][1]);
    const dm = dateRaw.match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);
    if (!dm) continue;
    const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
    const price = parseFloat(priceRaw.replace(/,/g, ''));
    if (price > 0) results.push({ date, price });
  }
  return results;
}

function parseMiraeTotalPages(html: string): number {
  const patterns = [/pageNo=(\d+)/g, /doPage\((\d+)\)/g, /goPage\((\d+)\)/g, /fnPage\((\d+)\)/g];
  let maxPage = 1;
  for (const pat of patterns) {
    for (const m of html.matchAll(pat)) maxPage = Math.max(maxPage, parseInt(m[1]));
  }
  return maxPage;
}

// ── 미래에셋 펀드 기준가 조회 (현재가 + 등락액) ────────────────────────────
export const fetchMiraeFundInfo = async (rawCode: string): Promise<{ name: string; price: number; changeRate: number; changeAmount: number; navDate: string; prevNavDate?: string; prevNavPrice?: number } | null> => {
  const code = rawCode.replace(/^MA:/i, '').toUpperCase();
  const today = new Date().toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const priceUrl = `https://investments.miraeasset.com/magi/fund/basePrices/list.do?fundGb=2&fundCd=${code}&startDate=${twoWeeksAgo}&endDate=${today}&pageNo=1&_=${Date.now()}`;
  const viewUrl = `https://investments.miraeasset.com/magi/fund/view.do?fundGb=2&fundCd=${code}`;

  let name = '';
  let viewPagePrice = 0;
  // 펀드명: JSON API → view 페이지 title 순으로 시도
  const infoUrl = `https://investments.miraeasset.com/magi/fund/getBasicInfo.do?fundCd=${code}&fundGb=2&_=${Date.now()}`;
  for (const infoProxy of [infoUrl, `/api/proxy?url=${encodeURIComponent(infoUrl)}`]) {
    try {
      const res = await fetch(infoProxy, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 5) continue;
      const json = JSON.parse(text);
      const n = json.fundName ?? json.fund_name ?? json.name ?? json.data?.fundName ?? json.result?.fundName;
      if (n && String(n).length > 3) { name = String(n).trim(); break; }
    } catch { continue; }
  }
  // view 페이지: 이름 폴백 + 현재가 파싱 (basePrices API보다 빠르게 반영됨)
  for (const proxy of [viewUrl, `/api/proxy?url=${encodeURIComponent(viewUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(viewUrl)}`]) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 200) continue;
      if (!name) {
        const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (tm) {
          const t = tm[1].split('|')[0].split('::')[0].split('-')[0].trim();
          if (t.length > 3 && !/^미래에셋(자산운용)?$/.test(t)) name = t;
        }
      }
      for (const pat of [
        /기준가[^0-9\n]{0,30}([\d,]+\.\d{2})/,
        /([\d,]+\.\d{2})\s*원/,
        /"nav"\s*:\s*"?([\d.]+)"?/,
        /"basicPrice"\s*:\s*"?([\d.]+)"?/,
      ]) {
        const m = html.match(pat);
        if (m) {
          const v = parseFloat(m[1].replace(/,/g, ''));
          if (v > 100) { viewPagePrice = v; break; }
        }
      }
      break;
    } catch { continue; }
  }

  // 기준가: basePrices list 에서 최신 2행 파싱 → 등락액 계산
  for (const proxy of [priceUrl, `/api/proxy?url=${encodeURIComponent(priceUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(priceUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(priceUrl)}`]) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 100) continue;
      const rows = parseMiraeBasePricesHtml(html);
      if (rows.length === 0) continue;
      rows.sort((a, b) => b.date.localeCompare(a.date)); // 날짜 내림차순 정렬
      // view URL에서 이름을 못 가져온 경우 basePrices HTML에서 재시도
      if (!name) {
        const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (tm) {
          const t = tm[1].split('|')[0].split('::')[0].trim();
          if (t.length > 5 && !/^미래에셋(자산운용)?$/.test(t) && !t.toLowerCase().includes('error')) name = t;
        }
        if (!name) {
          const h1 = html.match(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/i);
          if (h1) {
            const t = h1[1].replace(/<[^>]+>/g, '').trim();
            if (t.length > 5) name = t;
          }
        }
      }
      // basePrices 최신 날짜가 오늘이 아닌 경우 view 페이지 가격 우선 사용
      if (rows[0].date < today && viewPagePrice > 0) {
        const changeAmt = +(viewPagePrice - rows[0].price).toFixed(2);
        const changeRt = rows[0].price > 0 ? +((changeAmt / rows[0].price) * 100).toFixed(2) : 0;
        return { name, price: viewPagePrice, changeRate: changeRt, changeAmount: changeAmt, navDate: today, prevNavDate: rows[0].date, prevNavPrice: rows[0].price };
      }
      const price = rows[0].price;
      const navDate = rows[0].date;
      const changeAmount = rows.length > 1 ? +(rows[0].price - rows[1].price).toFixed(2) : 0;
      const changeRate = (rows.length > 1 && rows[1].price > 0) ? +((changeAmount / rows[1].price) * 100).toFixed(2) : 0;
      const prevNavDate = rows.length > 1 ? rows[1].date : undefined;
      const prevNavPrice = rows.length > 1 ? rows[1].price : undefined;
      return { name, price, changeRate, changeAmount, navDate, prevNavDate, prevNavPrice };
    } catch { continue; }
  }
  return null;
};

// ── 미래에셋 펀드 기준가 이력 조회 (페이지네이션 전체 수집) ──────────────────
export const fetchMiraeFundNavHistory = async (
  rawCode: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, number> | null> => {
  const code = rawCode.replace(/^MA:/i, '').toUpperCase();
  const makeUrl = (page: number) =>
    `https://investments.miraeasset.com/magi/fund/basePrices/list.do?fundGb=2&fundCd=${code}&startDate=${startDate}&endDate=${endDate}&pageNo=${page}&_=${Date.now()}`;

  const fetchPage = async (page: number): Promise<string | null> => {
    const url = makeUrl(page);
    for (const proxy of [url, `/api/proxy?url=${encodeURIComponent(url)}`]) {
      try {
        const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) continue;
        const html = await res.text();
        if (html && html.length > 100) return html;
      } catch { continue; }
    }
    return null;
  };

  const firstHtml = await fetchPage(1);
  if (!firstHtml) return null;

  const totalPages = parseMiraeTotalPages(firstHtml);
  const result: Record<string, number> = {};
  for (const { date, price } of parseMiraeBasePricesHtml(firstHtml)) result[date] = price;

  if (totalPages > 1) {
    const BATCH = 10;
    for (let bStart = 2; bStart <= totalPages; bStart += BATCH) {
      const pages = Array.from({ length: Math.min(BATCH, totalPages - bStart + 1) }, (_, i) => bStart + i);
      const htmls = await Promise.all(pages.map(p => fetchPage(p)));
      for (const html of htmls) {
        if (!html) continue;
        for (const { date, price } of parseMiraeBasePricesHtml(html)) result[date] = price;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
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

export const fetchYahooDividendHistory = async (ticker: string): Promise<{
  amounts: { [yearMonth: string]: number };
  exDates: { [yearMonth: string]: string };
} | null> => {
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
      const amounts: { [yearMonth: string]: number } = {};
      const exDates: { [yearMonth: string]: string } = {};
      entries.forEach(({ amount, date }) => {
        // 배당락일은 UTC 자정 타임스탬프 — 로컬 시간대 변환 시 월이 밀릴 수 있어 UTC 기준으로 고정
        const d = new Date(date * 1000);
        const y = d.getUTCFullYear();
        const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const key = `${y}-${mo}`;
        const ds = `${y}-${mo}-${day}`;
        amounts[key] = (amounts[key] || 0) + amount;
        if (!exDates[key] || ds > exDates[key]) exDates[key] = ds;
      });
      return Object.keys(amounts).length > 0 ? { amounts, exDates } : null;
    } catch { continue; }
  }
  return null;
};

function _fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear()).slice(2)}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// ── ETF 구성종목 Top3 조회 (네이버 증권) ────────────────────────────────────
const _etfHoldingsCache = new Map<string, { data: Array<{ name: string; code: string; ratio: number }> | null; ts: number }>();
const _etfHoldingsFetchAt = new Map<string, string>();
export const getEtfHoldingsFetchAt = (code: string): string | null => _etfHoldingsFetchAt.get(code) ?? null;


const _parseHoldingList = (data: any): Array<{ name: string; code: string; ratio: number }> | null => {
  const list = data?.etfTop10MajorConstituentAssets ?? data?.etfComponentStockList ?? data?.holdingList ?? data?.etfHoldingList ?? data?.items ?? (Array.isArray(data) ? data : null) ?? data?.data ?? [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const result = list.slice(0, 3).map((x: any) => ({
    name: x.itemName ?? x.stockName ?? x.name ?? x.holdingName ?? '',
    code: x.itemCode ?? x.stockCode ?? x.code ?? x.symbol ?? x.ticker ?? '',
    ratio: parseFloat(String(x.etfWeight ?? x.holdingRatio ?? x.holdingRate ?? x.ratio ?? x.weight ?? x.constituentRatio ?? x.stockRatio ?? x.holdingWeightRatio ?? 0).replace('%', '')) || 0,
  })).filter((x: any) => x.name);
  if (result.length === 0) return null;
  const nonZero = result.filter((x: any) => x.ratio > 0);
  if (nonZero.length > 0 && Math.max(...nonZero.map((x: any) => x.ratio)) < 2.0) {
    result.forEach((x: any) => { x.ratio = Math.round(x.ratio * 10000) / 100; });
  }
  return result;
};

// etfBaseIndex → 미국 ETF 티커 (클라이언트/서버 공용)
const _matchIndexToUsTicker = (baseIndex: string): string | null => {
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
  if (u.includes('SEMICONDUCTOR') || u.includes('SOX')) return 'SOXX';
  if (u.includes('GOLD') || u.includes('GLD')) return 'GLD';
  if (u.includes('TREASURY') || u.includes('BOND') || u.includes('TLT')) return 'TLT';
  if (u.includes('DIVIDEND') && (u.includes('US') || u.includes('AMERICA'))) return 'VIG';
  if (u.includes('CHINA') || u.includes('CSI')) return 'MCHI';
  if (u.includes('JAPAN') || u.includes('TOPIX')) return 'EWJ';
  if (u.includes('EUROPE')) return 'EZU';
  if (u.includes('INDIA')) return 'INDY';
  if (u.includes('VIETNAM')) return 'VNM';
  if (u.includes('INDONESIA')) return 'EIDO';
  return null;
};

const _fetchYahooEtfHoldings = async (
  ticker: string
): Promise<Array<{ name: string; code: string; ratio: number }> | null> => {
  const key = ticker.toUpperCase();
  // 1순위: 서버사이드 Edge Function (crumb 인증 포함)
  try {
    const res = await fetch(`/api/etf-holdings?code=${key}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  // 2순위: 직접 조회 (CORS 허용 환경 fallback)
  const targetUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${key}?modules=topHoldings`;
  for (const proxy of [targetUrl, `/api/proxy?url=${encodeURIComponent(targetUrl)}`]) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const holdings = data?.quoteSummary?.result?.[0]?.topHoldings?.holdings;
      if (!Array.isArray(holdings) || holdings.length === 0) continue;
      const result = holdings.slice(0, 3).map((h: any) => ({
        name: h.holdingName ?? h.symbol ?? '',
        code: h.symbol ?? '',
        ratio: (() => { const r = h.holdingPercent?.raw; return (r != null && isFinite(r)) ? Math.round(r * 10000) / 100 : 0; })(),
      })).filter((h: any) => h.name);
      if (result.length > 0) return result;
    } catch { continue; }
  }
  return null;
};

export const fetchEtfTopHoldings = async (
  code: string
): Promise<Array<{ name: string; code: string; ratio: number }> | null> => {
  type H = Array<{ name: string; code: string; ratio: number }>;
  const save = (result: H | null) => {
    _etfHoldingsFetchAt.set(code, _fmtDate(Date.now()));
    _etfHoldingsCache.set(code, { data: result, ts: Date.now() });
  };

  const cached = _etfHoldingsCache.get(code);
  if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached.data;

  // US ETF (알파벳 1~6자): Yahoo Finance topHoldings
  if (/^[A-Za-z]{1,6}$/.test(code)) {
    const result = await _fetchYahooEtfHoldings(code);
    save(result);
    return result;
  }

  // 1순위: 서버사이드 /api/etf-holdings (CORS 제한 없음)
  try {
    const res = await fetch(`/api/etf-holdings?code=${code}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        save(data);
        return data;
      }
    }
  } catch {}

  // 2순위: Naver etfAnalysis 직접 조회 (CORS 허용 환경 fallback)
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${code}/etfAnalysis`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const rawList: any[] = data?.etfTop10MajorConstituentAssets ?? [];
      if (Array.isArray(rawList) && rawList.length > 0) {
        if (rawList[0]?.etfWeight === '-') {
          const etfItemName: string = data?.itemName ?? '';
          const isActiveFund = /액티브|active/i.test(etfItemName);
          if (!isActiveFund) {
            const usTicker = _matchIndexToUsTicker(data?.etfBaseIndex ?? '');
            if (usTicker) {
              const yahooResult = await _fetchYahooEtfHoldings(usTicker);
              if (yahooResult) { save(yahooResult); return yahooResult; }
            }
            const fallback = _parseHoldingList(data);
            save(fallback);
            return fallback;
          }
          // 해외 액티브 ETF: 비중 데이터 없음 → null (셀 숨김)
          save(null);
          return null;
        }
        const result = _parseHoldingList(data);
        if (result) { save(result); return result; }
      }
    }
  } catch {}

  _etfHoldingsCache.set(code, { data: null, ts: Date.now() });
  return null;
};

// ── 국내 종목 PER / 추정PER 조회 ────────────────────────────────────────────
const _stockPerCache = new Map<string, { data: { per: number | null; fper: number | null } | null; ts: number }>();
const _stockPerFetchAt = new Map<string, string>();
export const getStockPerFetchAt = (code: string): string | null => _stockPerFetchAt.get(code) ?? null;

export const fetchStockPer = async (
  code: string
): Promise<{ per: number | null; fper: number | null } | null> => {
  type P = { per: number | null; fper: number | null };
  const perSave = (result: P | null) => {
    _stockPerFetchAt.set(code, _fmtDate(Date.now()));
    _stockPerCache.set(code, { data: result, ts: Date.now() });
  };

  const cached = _stockPerCache.get(code);
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) return cached.data;

  // 서버사이드 Edge Function 우선 (CORS/401 우회)
  try {
    const res = await fetch(`/api/stock-per?code=${code}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const d = await res.json();
      if (d.per !== null || d.fper !== null) {
        perSave(d);
        return d;
      }
    }
  } catch {}

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

  let closePrice: number | null = null;
  let isEtf = false;
  let basicPer: number | null = null;
  for (const proxy of mkProxies(`https://m.stock.naver.com/api/stock/${code}/basic`)) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.stockName && data?.closePrice) {
        closePrice = parseNum(String(data.closePrice).replace(/,/g, ''));
        isEtf = data.stockEndType === 'etf';
        basicPer = parseNum(data.per ?? data.perValue ?? data.PER);
        break;
      }
    } catch { continue; }
  }

  if (!closePrice || isEtf) {
    _stockPerCache.set(code, { data: null, ts: Date.now() });
    return null;
  }

  for (const proxy of mkProxies(`https://m.stock.naver.com/api/stock/${code}/finance/annual`)) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const epsRow: any[] = (data?.chartEps?.columns as any[])?.find((c: any[]) => c[0] === 'EPS');
      const titleList: any[] = data?.chartEps?.trTitleList;
      if (!epsRow || !titleList) continue;

      const years = titleList.map((t: any, i: number) => ({
        isConsensus: t.isConsensus === 'Y',
        eps: parseNum(epsRow[i + 1]),
      })).filter((y: any) => y.eps !== null);

      const actualY = years.filter((y: any) => !y.isConsensus);
      const consensusY = years.filter((y: any) => y.isConsensus);

      let per: number | null = null;
      const lastActual = actualY[actualY.length - 1];
      if (lastActual?.eps > 0) per = Math.round(closePrice / lastActual.eps * 100) / 100;

      let fper: number | null = null;
      if (consensusY.length > 0 && consensusY[0].eps > 0) {
        fper = Math.round(closePrice / consensusY[0].eps * 100) / 100;
      }

      const result = { per: per ?? basicPer ?? null, fper };
      perSave(result);
      return result;
    } catch { continue; }
  }

  if (basicPer != null) {
    const result = { per: basicPer, fper: null };
    perSave(result);
    return result;
  }

  _stockPerCache.set(code, { data: null, ts: Date.now() });
  return null;
};

// ── 해외 종목 PER / 선행PER 조회 ─────────────────────────────────────────────
// 1차: Naver 해외종목 basic API (CORS 허용, ETF holdings와 동일 경로)
// 2차: Yahoo Finance v7/finance/quote
// 3차: Yahoo Finance v10/quoteSummary?modules=summaryDetail
const _yahooPerCache = new Map<string, { data: { per: number | null; fper: number | null } | null; ts: number }>();

const _toValidPer = (v: any): number | null =>
  v != null && isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;

export const fetchYahooStockPer = async (
  ticker: string
): Promise<{ per: number | null; fper: number | null } | null> => {
  type P = { per: number | null; fper: number | null };
  const key = ticker.toUpperCase();
  const yahooSave = (result: P | null) => {
    _stockPerFetchAt.set(key, _fmtDate(Date.now()));
    _yahooPerCache.set(key, { data: result, ts: Date.now() });
  };

  const cached = _yahooPerCache.get(key);
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) return cached.data;

  // 서버사이드 Edge Function 우선
  try {
    const res = await fetch(`/api/stock-per?ticker=${key}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const d = await res.json();
      yahooSave(d);
      return d;
    }
  } catch {}

  // Naver 해외종목 basic API — 프록시 경유
  for (const suffix of ['.O', '.N', '.A']) {
    const url = `https://m.stock.naver.com/api/overseas/stock/${key}${suffix}/basic`;
    for (const proxy of [`/api/proxy?url=${encodeURIComponent(url)}`]) {
      try {
        const res = await fetch(proxy, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data?.closePrice) continue;
        const per = _toValidPer(parseFloat(String(data.per ?? data.perValue ?? '').replace(/,/g, '')));
        if (per !== null) {
          const result = { per, fper: null };
          yahooSave(result);
          return result;
        }
      } catch { continue; }
    }
  }

  _yahooPerCache.set(key, { data: null, ts: Date.now() });
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
