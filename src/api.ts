// ── 한국투자증권 KIS OpenAPI ──────────────────────────────────────
const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY = (import.meta as any).env?.VITE_KIS_APP_KEY || '';
const KIS_APP_SECRET = (import.meta as any).env?.VITE_KIS_APP_SECRET || '';

// 토큰은 24시간 유효 → 모듈 레벨에서 캐시
let _kisToken: string | null = null;
let _kisTokenExpiry = 0;

const kisFetch = (url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> => {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(tid));
};

export const fetchKISToken = async (): Promise<string | null> => {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;
  if (_kisToken && Date.now() < _kisTokenExpiry) return _kisToken;

  const body = JSON.stringify({ grant_type: 'client_credentials', appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET });
  const tokenUrl = `${KIS_BASE}/oauth2/tokenP`;
  const proxiedUrl = `https://corsproxy.io/?url=${encodeURIComponent(tokenUrl)}`;

  for (const url of [tokenUrl, proxiedUrl]) {
    try {
      const res = await kisFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.access_token) {
        _kisToken = json.access_token;
        _kisTokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23시간 캐시
        return _kisToken;
      }
    } catch (e) { continue; }
  }
  return null;
};

export const fetchKISStockHistory = async (code: string): Promise<{ data: Record<string, number>; source: string } | null> => {
  const token = await fetchKISToken();
  if (!token) return null;

  const result: Record<string, number> = {};
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  // 연도별 청크로 요청 (KIS API는 한 번에 약 100건 반환)
  const startYear = 2000;
  const endYear = new Date().getFullYear();

  for (let year = startYear; year <= endYear; year += 2) {
    const dateFrom = `${year}0101`;
    const dateTo = `${Math.min(year + 1, endYear)}1231` <= today ? `${Math.min(year + 1, endYear)}1231` : today;

    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: dateFrom,
      FID_INPUT_DATE_2: dateTo,
      FID_PERIOD_DIV_CODE: 'D',
      FID_ORG_ADJ_PRC: '0'
    });
    const kisHeaders = {
      'Content-Type': 'application/json',
      'authorization': `Bearer ${token}`,
      'appkey': KIS_APP_KEY,
      'appsecret': KIS_APP_SECRET,
      'tr_id': 'FHKST03010100',
      'custtype': 'P'
    };
    const targetUrl = `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${params}`;

    let fetched = false;
    for (const url of [targetUrl, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`]) {
      try {
        const res = await kisFetch(url, { headers: kisHeaders });
        if (!res.ok) continue;
        const json = await res.json();
        const rows: any[] = json.output2 || [];
        for (const item of rows) {
          const d: string = item.stck_bsop_date; // YYYYMMDD
          const close = parseInt(item.stck_clpr);
          if (d?.length === 8 && !isNaN(close) && close > 0) {
            result[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = close;
          }
        }
        fetched = true;
        break;
      } catch (e) { continue; }
    }
    if (!fetched) break; // 네트워크/CORS 오류 → 중단
  }

  if (Object.keys(result).length > 0) return { data: result, source: 'KIS-OpenAPI' };
  return null;
};
// ─────────────────────────────────────────────────────────────────

export const fetchIndexData = async (symbol) => {
  const stooqMap = { '^KS11': '^kospi', '^GSPC': '^spx' };
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
          const result = {};
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

  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d`;
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
      const result = {};
      if (json.chart?.result?.[0]) {
        const timestamps = json.chart.result[0].timestamp;
        const closePrices = json.chart.result[0].indicators.quote[0].close;
        if (timestamps && closePrices) {
          timestamps.forEach((ts, idx) => {
            const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
            if (closePrices[idx] !== null) result[dateStr] = closePrices[idx];
          });
        }
        if (Object.keys(result).length > 0) return { data: result, source: `Yahoo(${proxy.name})` };
      }
    } catch (e) {}
  }
  return null;
};

export const fetchStockInfo = async (code) => {
  if (!code || code.length < 5) return null;
  const targetUrl = `https://m.stock.naver.com/api/stock/${code}/basic`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy);
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.stockName) {
        return { name: data.stockName, price: parseInt(data.closePrice.replace(/,/g, '')), changeRate: parseFloat(data.fluctuationsRatio) };
      }
    } catch (e) { continue; }
  }
  return null;
};

export const fetchNaverStockHistory = async (code: string, count: number = 2000) => {
  const targetUrl = `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=${count}&requestType=0`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`,
    `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 100) continue;
      const result: Record<string, number> = {};
      const lines = text.split('<item data="');
      for (let i = 1; i < lines.length; i++) {
        const raw = lines[i].split('"')[0];
        const parts = raw.split('|');
        if (parts.length >= 5) {
          const d = parts[0];
          const close = parseInt(parts[4]);
          if (d.length === 8 && !isNaN(close) && close > 0) {
            result[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = close;
          }
        }
      }
      if (Object.keys(result).length > 10) return { data: result, source: 'naver-fchart' };
    } catch (e) { continue; }
  }
  return null;
};

export const fetchNaverKospi = async () => {
  const targetUrl = `https://m.stock.naver.com/api/index/KOSPI/basic`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy);
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
