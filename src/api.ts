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
