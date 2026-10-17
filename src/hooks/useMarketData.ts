// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { fetchIndexData } from '../api';
import { buildIndexStatus, parseIndexCSV } from '../utils';
import { getTodayKST } from './useMarketCalendar';
import { indicatorMissingSegments, mergeIndicatorHistory, INDICATOR_SOURCE_FLOOR, INDICATOR_COVERAGE_KEYS, MARKET_INDEX_KEYS, isSignedIndicator } from '../indicatorCoverage';
import { fillBrazilLiveCapped } from '../bcbClient';

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
  notify: (text: string, type?: string) => void;
  goldKrAutoCrawledRef: React.MutableRefObject<boolean>;
  stooqAutoCrawledRef: React.MutableRefObject<boolean>;
}

export function useMarketData({
  driveStatus,
  driveTokenRef,
  ensureDriveFolder,
  appliedRange,
  notify,
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
    us2y: null, us2yChg: null, us30y: null, us30yChg: null, us3m: null, us3mChg: null,
    t10y2y: null, t10y2yChg: null, t10y3m: null, t10y3mChg: null,
    hyYield: null, hyYieldChg: null, hySpread: null, hySpreadChg: null, mort30: null, mort30Chg: null, mort30Date: null,
    mbsSpread: null, mbsSpreadChg: null, move: null, moveChg: null,
    kr3y: null, kr3yChg: null, krBase: null, krBaseChg: null, krBaseNeedKey: false, krUs10y: null, krUs10yChg: null,
    brSelic: null, brSelicChg: null, brIpca: null, brIpcaChg: null, brIpcaDate: null, brExp12: null, brExp12Chg: null, brExp12Date: null,
    br10y: null, br10yChg: null, brlusd: null, brlusdChg: null, brlkrw: null, brlkrwChg: null, brReal: null, brRealChg: null,
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

  // 지수(KOSPI/S&P500/Nasdaq) 히스토리 수집 시작일 — 조회기간 시작일 우선, 없으면 10년 전.
  // fetchIndexData는 startDate 없으면 range=2y(약 500거래일)로 제한돼 장기 차트를 못 채운다.
  const wideIndexStart = () => {
    const s = appliedRangeRef.current?.start;
    if (s) return s;
    const d = new Date();
    d.setFullYear(d.getFullYear() - 10);
    return d.toISOString().split('T')[0];
  };

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
  // ⚠️ 동시 실행 금지: fetchMarketIndicators가 await 없이 호출하므로(finally에서 loading은 이미 해제)
  // 클릭 갱신이 실패를 반복하면 재시도 루프가 겹겹이 쌓인다.
  const retryRunningRef = useRef(false);
  const retryFailedIndicators = async (failedKeys, currentStatusMap, maxRetries = 10) => {
    if (retryRunningRef.current) return;
    retryRunningRef.current = true;
    try {
      await runRetryLoop(failedKeys, currentStatusMap, maxRetries);
    } finally {
      retryRunningRef.current = false;
    }
  };

  const runRetryLoop = async (failedKeys, currentStatusMap, maxRetries) => {
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
    // 미국 금리 5종(2026-10) — FRED 일별. t10y2y·t10y3m 단위는 %p(0·음수 정상 — isSignedIndicator)
    us2y:     'fred:DGS2',
    us30y:    'fred:DGS30',
    us3m:     'fred:DGS3MO',
    t10y2y:   'fred:T10Y2Y',
    t10y3m:   'fred:T10Y3M',
    // 하이일드·모기지·MOVE(2026-10). mbsSpread는 서버 계산값(mort30 − us10y, %p, 0·음수 정상)
    hyYield:   'fred:BAMLH0A0HYM2EY',
    hySpread:  'fred:BAMLH0A0HYM2',
    mort30:    'fred:MORTGAGE30US',
    mbsSpread: 'calc:MORTGAGE30US-DGS10',
    move:      'yahoo:^MOVE',
    // 한국 금리 3종(2026-10 7단계) — kr3y 네이버 일별 · krBase ECOS(인증키) · krUs10y 서버 계산(kr10y − DGS10, %p)
    kr3y:      'naver:KR3YT=RR',
    krBase:    'ecos:722Y001/0101000',
    krUs10y:   'calc:KR10Y-DGS10',
    // 브라질 7종(2026-10 8-A)
    brSelic:   'bcb:sgs432',
    brIpca:    'bcb:sgs13522',
    brExp12:   'bcb:olinda-ipca12m',
    br10y:     'naver:BR10YT=RR',
    brlusd:    'yahoo:BRL=X',
    brlkrw:    'calc:KRW=X/BRL=X',
    brReal:    'calc:BR10Y-EXP12',
    goldKr:   null,
    vix:      'yahoo:^VIX',
    btc:      'yahoo:BTC-USD',
    eth:      'yahoo:ETH-USD',
    // 지수 3종 — 저장 위치는 marketIndices(아래 fetchIndicatorHistory의 지수 분기)
    kospi:    'yahoo:^KS11',
    sp500:    'yahoo:^GSPC',
    nasdaq:   'yahoo:^NDX',
  };

  const INDICATOR_LABELS = {
    us10y: 'US 10Y', kr10y: 'KR 10Y', goldIntl: 'Gold', goldKr: '국내금',
    usdkrw: 'USDKRW', dxy: 'DXY', fedRate: '미국 기준금리', vix: 'VIX',
    us2y: '미국 2년', us30y: '미국 30년', us3m: '미국 3개월', t10y2y: '10년−2년', t10y3m: '10년−3개월',
    hyYield: '하이일드 금리', hySpread: '하이일드 스프레드', mort30: '30년 모기지', mbsSpread: 'MBS 스프레드', move: 'MOVE',
    kr3y: '국고채 3년', krBase: '한국 기준금리', krUs10y: '한미 10년 금리차',
    brSelic: '브라질 기준금리', brIpca: '브라질 물가', brExp12: '브라질 기대물가', br10y: '브라질 10년', brlusd: '헤알·달러', brlkrw: '헤알·원', brReal: '브라질 실질금리',
    btc: 'Bitcoin', eth: 'Ethereum',
    kospi: 'KOSPI', sp500: 'S&P500', nasdaq: 'Nasdaq100',
  };

  // stooq에서 과거 데이터 CSV 가져오기
  const fetchIndicatorHistory = async (key, startDate, endDate) => {
    const symbol = STOOQ_SYMBOLS[key];
    if (!symbol) {
      // 국내금(goldKr): 네이버 금일별시세 페이지 커서 수집 — startDate(조회 시작일)에 닿을 때까지 이어 받는다.
      // startDate가 없으면 종전처럼 최근 20페이지만(빠른 갱신).
      if (key === 'goldKr') {
        setIndicatorHistoryLoading(prev => ({ ...prev, goldKr: true }));
        const stop = startDate ? String(startDate).replace(/-/g, '') : '';
        let goldData = null;
        try {
          const acc = {};
          let page = 1;
          for (let calls = 0; calls < 12; calls++) {
            const url = `/api/history?key=goldKr&page=${page}&pages=${stop ? 40 : 20}${stop ? `&stop=${stop}` : ''}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!res.ok) break;
            const json = await res.json();
            // 구버전 서버(페이지 모드 미지원)는 날짜 맵을 그대로 준다 → 그대로 쓰고 끝낸다
            const isPaged = json && typeof json === 'object' && json.data && typeof json.data === 'object';
            Object.assign(acc, isPaged ? json.data : (json || {}));
            if (!isPaged || json.done || !stop) break;
            const earliest = Object.keys(acc).sort()[0];
            if (earliest && earliest.replace(/-/g, '') <= stop) break;
            if (!(json.next > page)) break;
            page = json.next;
          }
          if (Object.keys(acc).length > 0) goldData = acc;
        } catch (e) { /* 수집 실패 */ }
        setIndicatorHistoryLoading(prev => ({ ...prev, goldKr: false }));
        if (!goldData || Object.keys(goldData).length === 0) {
          return null;
        }
        // ⚠️ 여기서 MARKET 파일을 직접 쓰지 않는다 — 옛 코드는 ref 값으로 MARKET을 통째로 덮어써, Drive 로드
        //    전·실패 세션이면 빈 지수·지표로 저장본을 덮을 수 있었다. 저장은 App 자동 저장(stateAppliedRef 게이트)이 맡는다.
        setIndicatorHistoryMap(prev => {
          const merged = mergeIndicatorHistory(prev.goldKr, goldData);
          return merged === prev.goldKr ? prev : { ...prev, goldKr: merged };
        });
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
      const res = await fetch(`/api/history?key=${key}&start=${d1}&end=${d2}`, { signal: AbortSignal.timeout(25000) });
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

    // 지수(KOSPI/S&P500/Nasdaq)는 indicatorHistoryMap이 아니라 marketIndices에 산다 — 차트·패널·Drive MARKET 저장이
    // 그 상태를 읽는다. 다른 지표와 같은 서버 경로로 받되 병합 대상만 갈린다(상태 표도 함께 갱신).
    if (MARKET_INDEX_KEYS.includes(key)) {
      // 업데이터 안에서 다른 setState를 부르지 않는다(StrictMode 이중 호출) — 상태 표는 ref 기준 병합 결과로 따로 갱신
      const prevIdx = marketIndicesRef.current?.[key];
      const mergedIdx = mergeIndicatorHistory(prevIdx, parsedData);
      if (mergedIdx !== prevIdx) {
        setMarketIndices(prev => {
          const merged = mergeIndicatorHistory(prev?.[key], parsedData);
          return merged === prev?.[key] ? prev : { ...prev, [key]: merged };
        });
        setIndexFetchStatus(p => ({ ...p, [key]: buildIndexStatus(mergedIdx, 'Yahoo(server)') }));
      }
      return parsedData;
    }

    setIndicatorHistoryMap(prev => {
      // 장단기 금리차(%p)는 0·음수가 정상값 — signed 병합(그 외 키는 종전대로 0 이하 버림)
      const merged = mergeIndicatorHistory(prev[key], parsedData, isSignedIndicator(key));
      return merged === prev[key] ? prev : { ...prev, [key]: merged };
    });
    return parsedData;
  };

  // 지표 전체 일괄 수집 (Yahoo Finance / FRED / Naver)
  const fetchAllIndicatorHistory = async () => {
    for (const key of INDICATOR_COVERAGE_KEYS) {
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
        notify(`${file.name} 파싱 실패`, 'error');
        return;
      }

      if (!parsedData || Object.keys(parsedData).length === 0) {
        notify(`${file.name}: 유효 데이터 없음`, 'warning');
        return;
      }

      setIndicatorHistoryMap(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...parsedData } }));
    };
    reader.readAsText(file);
  };

  // opts.fresh — 사용자가 직접 누른 갱신(헤더 시장지표 칩 클릭·새로고침 버튼)은 엣지 캐시(300s)를
  // 건너뛰고 업스트림에서 다시 수집한다. 앱 시작 시 자동 수집은 캐시 경로 유지(응답 속도·업스트림 부하).
  // ⚠️ onClick에 직접 넘겨도 안전하도록 opts는 이벤트 객체일 수 있다 — `=== true`로만 판정.
  const indicatorInFlightRef = useRef(false);
  const fetchMarketIndicators = async (opts?: { fresh?: boolean }) => {
    // 진행 중인 수집이 있으면 건너뛴다(칩 연타 → 요청 중첩 방지). 진행 중 수집이 곧 최신값을 채운다.
    if (indicatorInFlightRef.current) return;
    indicatorInFlightRef.current = true;
    const fresh = opts?.fresh === true;
    setIndicatorLoading(true);
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const statusMap = {};

    try {
      const res = await fetch(fresh ? '/api/indicators?fresh=1' : '/api/indicators', {
        signal: AbortSignal.timeout(20000),
        ...(fresh ? { cache: 'no-store' as RequestCache } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // 브라질 BCB 값은 배포 서버에서 막히는 일이 있다 — 비어 있으면 브라우저가 직접 받아 채운다(bcbClient)
      await fillBrazilLiveCapped(data);

      const keys = ['us10y', 'fedRate', 'kr10y', 'usdkrw', 'goldIntl', 'goldKr',
                    'kospi', 'sp500', 'nasdaq', 'dxy', 'vix', 'btc', 'eth',
                    'us2y', 'us30y', 'us3m', 't10y2y', 't10y3m',
                    'hyYield', 'hySpread', 'mort30', 'mbsSpread', 'move', 'kr3y', 'krBase', 'krUs10y', 'brSelic', 'brIpca', 'brExp12', 'br10y', 'brlusd', 'brlkrw', 'brReal'];

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
              // 관측일 — 주간 지표(30년 모기지)는 카드에 '○월 ○일 값'으로 표시한다
              if (d.date) merged[`${k}Date`] = d.date;
            }
          } else {
            statusMap[k] = { status: 'fail', source: 'API', updatedAt: now };
          }
          // 한국 기준금리 — ECOS 인증키가 없으면 서버가 값 대신 needKey를 보낸다(카드에 '인증키 필요')
          if (k === 'krBase') merged.krBaseNeedKey = d?.needKey === true;
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
       'kospi', 'sp500', 'nasdaq', 'dxy', 'vix', 'btc', 'eth',
       'us2y', 'us30y', 'us3m', 't10y2y', 't10y3m',
       'hyYield', 'hySpread', 'mort30', 'mbsSpread', 'move', 'kr3y', 'krBase', 'krUs10y', 'brSelic', 'brIpca', 'brExp12', 'br10y', 'brlusd', 'brlkrw', 'brReal']
        .forEach(k => { statusMap[k] = { status: 'fail', source: 'API 오류', updatedAt: now }; });
      const clientKeys = Object.keys(fetchersMap);
      retryFailedIndicators(clientKeys, { ...statusMap });
    } finally {
      setIndicatorFetchStatus(statusMap);
      setIndicatorLoading(false);
      indicatorInFlightRef.current = false;
      // 사용자가 누른 새로고침은 과거 이력의 부족분·최신 꼬리까지 함께 채운다(Drive 로드 뒤에만)
      if (fresh && coverageReadyRef.current) ensureIndicatorCoverage({ forceTail: true });
    }
  };

  // KOSPI / S&P500 / Nasdaq 히스토리 단독 수집 (검증 패널 수집 버튼용)
  // startDate 미지정 시 조회기간 시작일(없으면 10년 전)부터 전체 수집
  const fetchSingleIndexHistory = async (key, startDate) => {
    const symbolMap = { kospi: '^KS11', sp500: '^GSPC', nasdaq: '^NDX' };
    const symbol = symbolMap[key];
    if (!symbol) return;
    setIndicatorHistoryLoading(prev => ({ ...prev, [key]: true }));
    try {
      const result = await fetchIndexData(symbol, startDate || wideIndexStart());
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

  // ── 시장지표 커버리지 보충 — 조회기간 안에서 비어 있는 구간(앞쪽·중간 공백·최신 꼬리)만 서버에서 받아 병합 ──
  // 발단(2026-10): 조회기간 2004~인데 VIX 등이 2015년 이후만 있었다. 옛 자동 수집은 "데이터 없음/최신일 3일 경과"만
  //   봐서 이미 일부 있는 지표의 앞쪽 공백을 영영 채우지 않았다(사용자가 파이썬으로 받아 JSON을 직접 올려야 했다).
  // 받은 값은 indicatorHistoryMap에 병합 → App 자동 저장이 Drive MARKET 파일(portfolio_market.json)에 남긴다.
  // ⚠️ 구간 키(지표:시작:끝) 단위로 세션당 1회 — 소스가 그보다 과거 값을 주지 못해도 매번 헛조회하지 않는다.
  //    새로고침(forceTail)만 최신 꼬리를 다시 받는다.
  // ⚠️ 13개 전부(지표 10 + 지수 3) — 사용자 확정 2026-10 "기준금리 이외의 모든 항목도 똑같이". 지수는 marketIndices를 읽는다.
  const AUTO_INDICATOR_KEYS = INDICATOR_COVERAGE_KEYS;
  const coverageGuardRef = useRef(new Set());
  const coverageReadyRef = useRef(false);
  const coverageRunningRef = useRef(false);
  const coveragePendingRef = useRef(null);
  const ensureIndicatorCoverage = async (opts: { forceTail?: boolean } = {}) => {
    if (coverageRunningRef.current) {
      coveragePendingRef.current = { forceTail: !!(opts.forceTail || coveragePendingRef.current?.forceTail) };
      return;
    }
    coverageRunningRef.current = true;
    try {
      const today = getTodayKST();
      const start = appliedRangeRef.current?.start || '';
      const end = appliedRangeRef.current?.end || '';
      await Promise.all(AUTO_INDICATOR_KEYS.map(async (key) => {
        const hist = MARKET_INDEX_KEYS.includes(key) ? marketIndicesRef.current?.[key] : indicatorHistoryMapRef.current?.[key];
        const segs = indicatorMissingSegments(hist, start, end, today, INDICATOR_SOURCE_FLOOR[key], isSignedIndicator(key));
        // 조회 시작일이 없고 데이터도 없으면 종전처럼 기본 기간(최근 3년)을 한 번 받는다
        if (segs.length === 0 && !start && (!hist || Object.keys(hist).length === 0)) {
          const g = `${key}:init`;
          if (coverageGuardRef.current.has(g)) return;
          coverageGuardRef.current.add(g);
          await fetchIndicatorHistory(key, null, null);
          return;
        }
        for (const seg of segs) {
          const g = `${key}:${seg.from}:${seg.to}`;
          const forced = opts.forceTail && seg.kind === 'tail';
          if (!forced && coverageGuardRef.current.has(g)) continue;
          coverageGuardRef.current.add(g);
          await fetchIndicatorHistory(key, seg.from, seg.to);
        }
      }));
    } finally {
      coverageRunningRef.current = false;
      const pending = coveragePendingRef.current;
      if (pending) {
        coveragePendingRef.current = null;
        ensureIndicatorCoverage(pending);
      }
    }
  };

  // Drive 로드 완료(저장 상태 'saved' 최초 관측) 뒤 1회 — 저장본 위에서 부족분만 받는다
  useEffect(() => {
    if (coverageReadyRef.current) return;
    if (driveStatus !== 'saved') return;
    if (!driveTokenRef.current) return;
    coverageReadyRef.current = true;
    goldKrAutoCrawledRef.current = true;
    stooqAutoCrawledRef.current = true;
    ensureIndicatorCoverage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveStatus]);

  // 조회기간이 바뀌면(특히 앞쪽으로 확장) 새 구간의 부족분을 받는다 — Drive 로드 전에는 기다린다
  useEffect(() => {
    if (!coverageReadyRef.current) return;
    ensureIndicatorCoverage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRange?.start, appliedRange?.end]);

  // 앱 시작 시 KOSPI / S&P500 / Nasdaq 히스토리 로드
  useEffect(() => {
    const loadIndices = async () => {
      const idxStart = wideIndexStart();
      const [kRes, sRes, nRes] = await Promise.allSettled([
        fetchIndexData('^KS11', idxStart),
        fetchIndexData('^GSPC', idxStart),
        fetchIndexData('^NDX', idxStart)
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

  // (옛 '지수 머리 확장' effect는 삭제 — 지수 3종도 ensureIndicatorCoverage가 머리·내부 공백·최신 꼬리를 전부 맡는다.
  //  둘을 함께 두면 조회기간 변경마다 같은 지수를 두 경로로 두 번 받았다.)

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
    ensureIndicatorCoverage,
  };
}
