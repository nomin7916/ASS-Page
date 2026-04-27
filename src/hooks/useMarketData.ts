// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { DRIVE_FILES, saveDriveFile } from '../driveStorage';
import { fetchIndexData } from '../api';
import { buildIndexStatus, parseIndexCSV } from '../utils';

export const defaultCompStocks = [
  { id: 1, code: '', name: '비교종목1', active: false, loading: false, color: '#10b981' },
  { id: 2, code: '', name: '비교종목2', active: false, loading: false, color: '#0ea5e9' },
  { id: 3, code: '', name: '비교종목3', active: false, loading: false, color: '#ec4899' },
];

interface UseMarketDataParams {
  driveStatus: string;
  driveTokenRef: React.MutableRefObject<string>;
  ensureDriveFolder: (token: string) => Promise<string>;
  appliedRange: { start: string; end: string };
  showToast: (text: string, isError?: boolean) => void;
  goldKrAutoCrawledRef: React.MutableRefObject<boolean>;
  stooqAutoCrawledRef: React.MutableRefObject<boolean>;
}

export function useMarketData({
  driveStatus,
  driveTokenRef,
  ensureDriveFolder,
  appliedRange,
  showToast,
  goldKrAutoCrawledRef,
  stooqAutoCrawledRef,
}: UseMarketDataParams) {
  // ── 시장 데이터 상태 ──
  const [indicatorHistoryLoading, setIndicatorHistoryLoading] = useState({});
  const [marketIndices, setMarketIndices] = useState({ kospi: null, sp500: null, nasdaq: null });
  const [indicatorHistoryMap, setIndicatorHistoryMap] = useState({});
  const [stockHistoryMap, setStockHistoryMap] = useState({});
  const [compStocks, setCompStocks] = useState(defaultCompStocks);
  const [stockListingDates, setStockListingDates] = useState({});
  const [marketIndicators, setMarketIndicators] = useState({
    us10y: null, kr10y: null, usdkrw: null, dxy: null, goldIntl: null, goldKr: null,
    kospiPrice: null, sp500Price: null, nasdaqPrice: null,
    us10yChg: null, kr10yChg: null, usdkrwChg: null, dxyChg: null, goldIntlChg: null, goldKrChg: null,
    kospiChg: null, sp500Chg: null, nasdaqChg: null,
    fedRate: null, fedRateChg: null,
    vix: null, vixChg: null,
    btc: null, btcChg: null,
    eth: null, ethChg: null,
  });
  const [indicatorLoading, setIndicatorLoading] = useState(false);
  const [indicatorFetchStatus, setIndicatorFetchStatus] = useState({});
  const [showIndicatorVerify, setShowIndicatorVerify] = useState(false);
  const [indexFetchStatus, setIndexFetchStatus] = useState({ kospi: null, sp500: null, nasdaq: null });
  const [showIndexVerify, setShowIndexVerify] = useState(false);
  const [stockFetchStatus, setStockFetchStatus] = useState({});

  // 세션 내 자동 전체이력 재조회 완료된 종목 코드 추적 (중복 API 호출 방지)
  const autoFetchedCodes = useRef(new Set());

  // appliedRange를 ref로 유지해 stale closure 방지
  const appliedRangeRef = useRef(appliedRange);
  useEffect(() => { appliedRangeRef.current = appliedRange; }, [appliedRange]);

  // 개별 패치 함수들을 밖으로 빼서 재사용 가능하도록 구성 (Retry 용도)
  const fetchersMap = {
    us10y: async (now, statusMap) => {
      const _us10yTarget = 'https://tradingeconomics.com/united-states/government-bond-yield';
      const proxies = [
        `/api/proxy?url=${encodeURIComponent(_us10yTarget)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(_us10yTarget)}`,
        `https://api.codetabs.com/v1/proxy?quest=${_us10yTarget}`
      ];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const html = await res.text();
          const match = html.match(/id="p"[^>]*>\s*([\d,]+\.?\d*)/) || html.match(/"last":\s*([\d,.]+)/);
          if (match) {
            const price = parseFloat(match[1].replace(/,/g, ''));
            const chgMatch = html.match(/id="pch"[^>]*>\s*([+-]?[\d,]*\.?\d+)%?/) || html.match(/"percentageChange":\s*"?([+-]?[\d.]+)/);
            const change = chgMatch ? parseFloat(chgMatch[1].replace(/,/g, '')) : null;
            if (price > 0) { statusMap['us10y'] = { status: 'success', source: proxy.startsWith('/api/proxy') ? 'TE(vercel)' : proxy.includes('allorigins') ? 'TE(allorigins)' : 'TE(codetabs)', updatedAt: now }; return { price, change }; }
          }
        } catch(e) {}
      }
      statusMap['us10y'] = { status: 'fail', source: 'TE 실패', updatedAt: now }; return { price: null, change: null };
    },
    kr10y: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/marketIndex/bond/KR10YT=RR';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['kr10y'] = { status: 'success', source: '네이버채권', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['kr10y'] = { status: 'fail', source: '네이버채권 실패', updatedAt: now }; return { price: null, change: null };
    },
    usdkrw: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/marketIndex/exchange/FX_USDKRW';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['usdkrw'] = { status: 'success', source: '네이버환율', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['usdkrw'] = { status: 'fail', source: '네이버환율 실패', updatedAt: now }; return { price: null, change: null };
    },
    dxy: async (now, statusMap) => {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=1d&interval=1d`;
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
            statusMap['dxy'] = { status: 'success', source: 'Yahoo', updatedAt: now }; return { price, change };
          }
        } catch(e) {}
      }
      statusMap['dxy'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    goldIntl: async (now, statusMap) => {
      const tryYahooGold = async (symbol: string) => {
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
        const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
        for (const proxy of proxies) {
          try {
            const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) continue;
            const json = await res.json();
            const meta = json?.chart?.result?.[0]?.meta;
            if (meta?.regularMarketPrice) {
              const price = meta.regularMarketPrice;
              const prevClose = meta.chartPreviousClose || meta.previousClose;
              const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
              return { price, change, src: `Yahoo(${symbol})` };
            }
          } catch(e) {}
        }
        return null;
      };
      // GC=F(선물) 시도 후 실패 시 XAUUSD=X(현물)로 폴백
      for (const symbol of ['GC=F', 'XAUUSD=X']) {
        const result = await tryYahooGold(symbol);
        if (result) {
          statusMap['goldIntl'] = { status: 'success', source: result.src, updatedAt: now };
          return { price: result.price, change: result.change };
        }
      }
      statusMap['goldIntl'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    goldKr: async (now, statusMap) => {
      // finance.naver.com/marketindex/goldDetail.naver: DEAL_VAL(현재가) + 변동률 span 파싱
      const targetUrl = 'https://finance.naver.com/marketindex/goldDetail.naver';
      const proxies = [
        `/api/proxy?url=${encodeURIComponent(targetUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`,
      ];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const html = await res.text();
          const priceMatch = html.match(/var DEAL_VAL\s*=\s*([\d.]+)/);
          if(!priceMatch) continue;
          const price = parseFloat(priceMatch[1]);
          if(!(price > 0)) continue;
          // 변동률: parenthesis1~per 구간에서 no{digit}/jum 클래스로 조합
          const pctSection = html.match(/class="parenthesis1">([\s\S]*?)class="per">/)?.[0] || '';
          let pctStr = '';
          const tokenRe = /class="(no\d|jum)"/g;
          let tm: RegExpExecArray | null;
          while ((tm = tokenRe.exec(pctSection)) !== null) {
            pctStr += tm[1] === 'jum' ? '.' : tm[1].replace('no', '');
          }
          let change = parseFloat(pctStr) || null;
          if(change !== null && pctSection.includes('class="ico minus"')) change = -change;
          statusMap['goldKr'] = { status: 'success', source: '네이버금시세', updatedAt: now }; return { price, change };
        } catch(e) {}
      }
      statusMap['goldKr'] = { status: 'fail', source: '네이버금시세 실패', updatedAt: now }; return { price: null, change: null };
    },
    kospi: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/index/KOSPI/basic';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['kospi'] = { status: 'success', source: '네이버', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['kospi'] = { status: 'fail', source: '네이버 실패', updatedAt: now }; return { price: null, change: null };
    },
    sp500: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/index/SPI@SPX/basic';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['sp500'] = { status: 'success', source: '네이버해외', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['sp500'] = { status: 'fail', source: '네이버해외 실패', updatedAt: now }; return { price: null, change: null };
    },
    nasdaq: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/index/NAS@NDX/basic';
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['nasdaq'] = { status: 'success', source: '네이버해외', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['nasdaq'] = { status: 'fail', source: '네이버해외 실패', updatedAt: now }; return { price: null, change: null };
    },
    fedRate: async (now, statusMap) => {
      const url = 'https://tradingeconomics.com/united-states/interest-rate';
      const proxies = [`/api/proxy?url=${encodeURIComponent(url)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, `https://api.codetabs.com/v1/proxy?quest=${url}`];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const html = await res.text();
          const match = html.match(/id="p"[^>]*>\s*([\d,]+\.?\d*)/) || html.match(/"last":\s*([\d,.]+)/) || html.match(/data-value="([\d,.]+)"/);
          if (match) {
            const price = parseFloat(match[1].replace(/,/g, ''));
            const chgMatch = html.match(/id="pch"[^>]*>\s*([+-]?[\d,]*\.?\d+)%?/);
            const change = chgMatch ? parseFloat(chgMatch[1].replace(/,/g, '')) : null;
            if (price > 0) { statusMap['fedRate'] = { status: 'success', source: 'TE', updatedAt: now }; return { price, change }; }
          }
        } catch(e) {}
      }
      statusMap['fedRate'] = { status: 'fail', source: 'TE 실패', updatedAt: now }; return { price: null, change: null };
    },
    vix: async (now, statusMap) => {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1d&interval=1d`;
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
            statusMap['vix'] = { status: 'success', source: 'Yahoo', updatedAt: now };
            return { price, change };
          }
        } catch(e) {}
      }
      statusMap['vix'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    btc: async (now, statusMap) => {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=1d&interval=1d`;
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
            statusMap['btc'] = { status: 'success', source: 'Yahoo', updatedAt: now };
            return { price, change };
          }
        } catch(e) {}
      }
      statusMap['btc'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    eth: async (now, statusMap) => {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/ETH-USD?range=1d&interval=1d`;
      const proxies = [`/api/proxy?url=${encodeURIComponent(targetUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
      for (const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = prevClose ? ((price / prevClose) - 1) * 100 : null;
            statusMap['eth'] = { status: 'success', source: 'Yahoo', updatedAt: now };
            return { price, change };
          }
        } catch(e) {}
      }
      statusMap['eth'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
  };

  // 재시도 큐 매니저
  const retryFailedIndicators = async (failedKeys, currentStatusMap, maxRetries = 10) => {
    let currentAttempt = 0;
    let pendingKeys = [...failedKeys];

    while (pendingKeys.length > 0 && currentAttempt < maxRetries) {
      currentAttempt++;
      await new Promise(resolve => setTimeout(resolve, 1000));

      const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      const tempStatusMap = { ...currentStatusMap };
      const newResults = {};
      const stillFailed = [];

      await Promise.all(pendingKeys.map(async (key) => {
        const fetcher = fetchersMap[key];
        if (fetcher) {
          const res = await fetcher(now, tempStatusMap);
          if (res.price !== null) {
            newResults[key] = res;
          } else {
            stillFailed.push(key);
          }
        }
      }));

      if (Object.keys(newResults).length > 0) {
        setMarketIndicators(prev => {
          const merged = { ...prev };
          Object.keys(newResults).forEach(k => {
            if (k === 'kospi' || k === 'sp500' || k === 'nasdaq') {
              merged[`${k}Price`] = newResults[k].price;
              merged[`${k}Chg`] = newResults[k].change;
            } else {
              merged[k] = newResults[k].price;
              merged[`${k}Chg`] = newResults[k].change;
            }
          });
          return merged;
        });

        const todayMI = new Date().toISOString().split("T")[0];
        setMarketIndices(prev => ({
          kospi:  newResults.kospi  ? { ...(prev.kospi  || {}), [todayMI]: newResults.kospi.price  } : prev.kospi,
          sp500:  newResults.sp500  ? { ...(prev.sp500  || {}), [todayMI]: newResults.sp500.price  } : prev.sp500,
          nasdaq: newResults.nasdaq ? { ...(prev.nasdaq || {}), [todayMI]: newResults.nasdaq.price } : prev.nasdaq,
        }));

        setIndicatorFetchStatus(prev => ({ ...prev, ...tempStatusMap }));
        currentStatusMap = { ...currentStatusMap, ...tempStatusMap };
      }

      pendingKeys = stillFailed;
    }
  };

  // Apps Script 프록시 제거 — 직접 fetchersMap 경로만 사용
  const fetchIndicatorsViaProxy = async () => null;

  // 히스토리 자동수집 가능 여부 매핑 (non-null = /api/history 자동수집 지원)
  const STOOQ_SYMBOLS = {
    us10y:    'yahoo:^TNX',
    goldIntl: 'yahoo:GC=F',
    usdkrw:   'yahoo:KRW=X',
    dxy:      'yahoo:DX-Y.NYB',
    kr10y:    'yahoo:^KR10YT=RR',
    fedRate:  'fred:DFEDTARU',
    goldKr:   null,
    vix:      'yahoo:^VIX',
    btc:      'yahoo:BTC-USD',
    eth:      'yahoo:ETH-USD',
  };

  const INDICATOR_LABELS = {
    us10y: 'US 10Y', kr10y: 'KR 10Y', goldIntl: 'Gold', goldKr: '국내금',
    usdkrw: 'USDKRW', dxy: 'DXY', fedRate: '미국 기준금리', vix: 'VIX',
    btc: 'Bitcoin', eth: 'Ethereum',
  };

  // stooq에서 과거 데이터 CSV 가져오기
  const fetchIndicatorHistory = async (key, startDate, endDate) => {
    const symbol = STOOQ_SYMBOLS[key];
    if (!symbol) {
      // 국내금(goldKr): 네이버 fchart에서 장기 데이터 크롤링
      if (key === 'goldKr') {
        setIndicatorHistoryLoading(prev => ({ ...prev, goldKr: true }));
        let goldData = null;
        try {
          const res = await fetch('/api/history?key=goldKr', { signal: AbortSignal.timeout(30000) });
          if (res.ok) {
            const json = await res.json();
            if (json && typeof json === 'object' && Object.keys(json).length > 10) {
              goldData = json;
            }
          }
        } catch (e) { /* 수집 실패 */ }
        setIndicatorHistoryLoading(prev => ({ ...prev, goldKr: false }));
        if (!goldData || Object.keys(goldData).length === 0) {
          return null;
        }
        const mergedGoldKr = { ...(indicatorHistoryMapRef.current.goldKr || {}), ...goldData };
        setIndicatorHistoryMap(prev => ({ ...prev, goldKr: mergedGoldKr }));
        // Drive 백업 저장
        if (driveTokenRef.current) {
          try {
            const folderId = await ensureDriveFolder(driveTokenRef.current);
            const mergedIhm = { ...indicatorHistoryMapRef.current, goldKr: mergedGoldKr };
            await saveDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.MARKET, {
              marketIndices: marketIndicesRef.current,
              marketIndicators: marketIndicatorsRef.current,
              indicatorHistoryMap: mergedIhm,
            });
          } catch (e) { /* Drive 저장 실패는 무시 */ }
        }
        return goldData;
      }
      return null;
    }

    setIndicatorHistoryLoading(prev => ({ ...prev, [key]: true }));

    const d1 = (startDate || appliedRangeRef.current.start || (() => {
      const d = new Date(); d.setFullYear(d.getFullYear() - 3); return d.toISOString().split('T')[0];
    })()).replace(/-/g, '');
    const d2 = (endDate || appliedRangeRef.current.end || new Date().toISOString().split('T')[0]).replace(/-/g, '');

    let parsedData = null;
    try {
      const res = await fetch(`/api/history?key=${key}&start=${d1}&end=${d2}`, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          if (json && typeof json === 'object' && Object.keys(json).length > 0) parsedData = json;
        } else {
          const csv = await res.text();
          if (csv && !csv.includes('No data') && csv.length >= 30) {
            parsedData = parseIndexCSV(csv, `${key}.csv`);
          }
        }
      }
    } catch (e) { /* 수집 실패 */ }

    setIndicatorHistoryLoading(prev => ({ ...prev, [key]: false }));

    if (!parsedData || Object.keys(parsedData).length === 0) {
      return null;
    }

    setIndicatorHistoryMap(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...parsedData } }));
    return parsedData;
  };

  // 지표 전체 일괄 수집 (Yahoo Finance / FRED / Naver)
  const fetchAllIndicatorHistory = async () => {
    const keys = ['us10y', 'fedRate', 'kr10y', 'goldIntl', 'usdkrw', 'dxy', 'goldKr', 'vix', 'btc', 'eth'];
    for (const key of keys) {
      await fetchIndicatorHistory(key, appliedRangeRef.current?.start, appliedRangeRef.current?.end);
    }
  };

  // CSV / JSON 파일 직접 업로드로 지표 히스토리 주입
  const handleIndicatorUpload = (key, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result;
      if (typeof content !== 'string') return;
      const ext = file.name.split('.').pop()?.toLowerCase();
      let parsedData = null;

      try {
        if (ext === 'csv') {
          parsedData = parseIndexCSV(content, file.name);
        } else if (ext === 'json') {
          const raw = JSON.parse(content);
          const arr = raw.data ?? raw;
          if (Array.isArray(arr)) {
            parsedData = {};
            arr.forEach(item => {
              const d = (item.Date ?? item.date ?? item.index ?? item.INDEX ?? '').substring(0, 10);
              const v = item.Close ?? item.Value ?? item.close ?? item.value ?? (() => {
                const skip = ['Date', 'date', 'index', 'INDEX'];
                const k2 = Object.keys(item).find(k => !skip.includes(k) && typeof item[k] === 'number');
                return k2 ? item[k2] : undefined;
              })();
              if (d && v != null && d !== '1970-01-01') parsedData[d] = Number(v);
            });
          }
        }
      } catch (err) {
        showToast(`${file.name} 파싱 실패`, true);
        return;
      }

      if (!parsedData || Object.keys(parsedData).length === 0) {
        showToast(`${file.name}: 유효 데이터 없음`, true);
        return;
      }

      setIndicatorHistoryMap(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...parsedData } }));
    };
    reader.readAsText(file);
  };

  const fetchMarketIndicators = async () => {
    setIndicatorLoading(true);
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const statusMap = {};

    try {
      const res = await fetch('/api/indicators', { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const keys = ['us10y', 'fedRate', 'kr10y', 'usdkrw', 'goldIntl', 'goldKr',
                    'kospi', 'sp500', 'nasdaq', 'dxy', 'vix', 'btc', 'eth'];

      setMarketIndicators(prev => {
        const merged = { ...prev };
        keys.forEach(k => {
          const d = data[k];
          if (d?.price != null) {
            statusMap[k] = { status: 'success', source: d.source ?? 'API', updatedAt: now };
            if (k === 'kospi' || k === 'sp500' || k === 'nasdaq') {
              merged[`${k}Price`] = d.price;
              merged[`${k}Chg`]   = d.change;
            } else {
              merged[k]           = d.price;
              merged[`${k}Chg`]   = d.change;
            }
          } else {
            statusMap[k] = { status: 'fail', source: 'API', updatedAt: now };
          }
        });
        return merged;
      });

      const todayMI = new Date().toISOString().split('T')[0];
      setMarketIndices(prev => ({
        kospi:  data.kospi?.price  ? { ...(prev.kospi  || {}), [todayMI]: data.kospi.price  } : prev.kospi,
        sp500:  data.sp500?.price  ? { ...(prev.sp500  || {}), [todayMI]: data.sp500.price  } : prev.sp500,
        nasdaq: data.nasdaq?.price ? { ...(prev.nasdaq || {}), [todayMI]: data.nasdaq.price } : prev.nasdaq,
      }));

      const failedKeys = Object.keys(statusMap).filter(k => statusMap[k]?.status === 'fail');
      if (failedKeys.length > 0) {
        retryFailedIndicators(failedKeys, { ...statusMap });
      }
    } catch (e) {
      console.error('시장 지표 수집 오류:', e);
      ['us10y', 'fedRate', 'kr10y', 'usdkrw', 'goldIntl', 'goldKr',
       'kospi', 'sp500', 'nasdaq', 'dxy', 'vix', 'btc', 'eth']
        .forEach(k => { statusMap[k] = { status: 'fail', source: 'API 오류', updatedAt: now }; });
      const clientKeys = Object.keys(fetchersMap);
      retryFailedIndicators(clientKeys, { ...statusMap });
    } finally {
      setIndicatorFetchStatus(statusMap);
      setIndicatorLoading(false);
    }
  };

  // KOSPI / S&P500 / Nasdaq 히스토리 단독 수집 (검증 패널 수집 버튼용)
  const fetchSingleIndexHistory = async (key) => {
    const symbolMap = { kospi: '^KS11', sp500: '^GSPC', nasdaq: '^NDX' };
    const symbol = symbolMap[key];
    if (!symbol) return;
    setIndicatorHistoryLoading(prev => ({ ...prev, [key]: true }));
    try {
      const result = await fetchIndexData(symbol);
      if (result?.data && Object.keys(result.data).length > 0) {
        setMarketIndices(prev => {
          const merged = { ...(prev[key] || {}), ...result.data };
          const status = buildIndexStatus(merged, result.source);
          setIndexFetchStatus(p => ({ ...p, [key]: status }));
          return { ...prev, [key]: merged };
        });
      }
    } finally {
      setIndicatorHistoryLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  // 최신값 ref 유지 (goldKr Drive 백업에서 stale closure 방지)
  const marketIndicesRef = useRef(marketIndices);
  const marketIndicatorsRef = useRef(marketIndicators);
  const indicatorHistoryMapRef = useRef(indicatorHistoryMap);
  useEffect(() => { marketIndicesRef.current = marketIndices; }, [marketIndices]);
  useEffect(() => { marketIndicatorsRef.current = marketIndicators; }, [marketIndicators]);
  useEffect(() => { indicatorHistoryMapRef.current = indicatorHistoryMap; }, [indicatorHistoryMap]);

  // 국내금 장기 데이터 자동 크롤링: Drive 저장 완료 후 데이터 부족/오래된 경우 자동 수집
  useEffect(() => {
    if (goldKrAutoCrawledRef.current) return;
    if (driveStatus !== 'saved') return;
    if (!driveTokenRef.current) return;
    const goldKrData = indicatorHistoryMap.goldKr || {};
    const goldKrCount = Object.keys(goldKrData).length;
    const latestDate = goldKrCount > 0 ? Object.keys(goldKrData).sort().pop() : null;
    const daysSinceLatest = latestDate
      ? Math.floor((Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24))
      : Infinity;
    if (goldKrCount < 200 || daysSinceLatest > 3) {
      goldKrAutoCrawledRef.current = true;
      fetchIndicatorHistory('goldKr', null, null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveStatus]);

  // 지표 자동 크롤링: Drive 저장 완료 후 데이터 없거나 3일 이상 오래된 경우 자동 수집
  useEffect(() => {
    if (stooqAutoCrawledRef.current) return;
    if (driveStatus !== 'saved') return;
    if (!driveTokenRef.current) return;
    const STOOQ_KEYS = ['us10y', 'fedRate', 'kr10y', 'goldIntl', 'usdkrw', 'dxy', 'vix', 'btc', 'eth'];
    const staleKeys = STOOQ_KEYS.filter(key => {
      const hist = indicatorHistoryMap[key] || {};
      const count = Object.keys(hist).length;
      if (count === 0) return true;
      const latestDate = Object.keys(hist).sort().pop();
      const daysSince = Math.floor((Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24));
      return daysSince > 3;
    });
    if (staleKeys.length > 0) {
      stooqAutoCrawledRef.current = true;
      (async () => {
        for (const key of staleKeys) {
          await fetchIndicatorHistory(key, null, null);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveStatus]);

  // 앱 시작 시 KOSPI / S&P500 / Nasdaq 히스토리 로드
  useEffect(() => {
    const loadIndices = async () => {
      const [kRes, sRes, nRes] = await Promise.allSettled([
        fetchIndexData('^KS11'),
        fetchIndexData('^GSPC'),
        fetchIndexData('^NDX')
      ]);
      const newK = (kRes.status === 'fulfilled' && kRes.value) ? kRes.value : null;
      const newS = (sRes.status === 'fulfilled' && sRes.value) ? sRes.value : null;
      const newN = (nRes.status === 'fulfilled' && nRes.value) ? nRes.value : null;

      setMarketIndices(prev => {
        const mergedK = newK ? { ...(prev.kospi || {}), ...newK.data } : prev.kospi;
        const mergedS = newS ? { ...(prev.sp500 || {}), ...newS.data } : prev.sp500;
        const mergedN = newN ? { ...(prev.nasdaq || {}), ...newN.data } : prev.nasdaq;

        const resolveStatus = (fetchRes, merged) => {
          if (fetchRes) return buildIndexStatus(merged, fetchRes.source);
          if (merged && Object.keys(merged).length > 0) {
            const st = buildIndexStatus(merged, '백업데이터');
            st.status = 'partial';
            return st;
          }
          return null;
        };
        setIndexFetchStatus({
          kospi: resolveStatus(newK, mergedK),
          sp500: resolveStatus(newS, mergedS),
          nasdaq: resolveStatus(newN, mergedN),
        });

        return { kospi: mergedK, sp500: mergedS, nasdaq: mergedN };
      });
    };
    loadIndices();
  }, []);

  return {
    // 상태
    indicatorHistoryLoading, setIndicatorHistoryLoading,
    marketIndices, setMarketIndices,
    indicatorHistoryMap, setIndicatorHistoryMap,
    stockHistoryMap, setStockHistoryMap,
    compStocks, setCompStocks,
    stockListingDates, setStockListingDates,
    marketIndicators, setMarketIndicators,
    indicatorLoading, setIndicatorLoading,
    indicatorFetchStatus, setIndicatorFetchStatus,
    showIndicatorVerify, setShowIndicatorVerify,
    indexFetchStatus, setIndexFetchStatus,
    showIndexVerify, setShowIndexVerify,
    stockFetchStatus, setStockFetchStatus,
    // refs
    autoFetchedCodes,
    // 함수
    fetchersMap,
    retryFailedIndicators,
    fetchIndicatorsViaProxy,
    STOOQ_SYMBOLS,
    INDICATOR_LABELS,
    fetchIndicatorHistory,
    fetchAllIndicatorHistory,
    handleIndicatorUpload,
    fetchMarketIndicators,
    fetchSingleIndexHistory,
  };
}
