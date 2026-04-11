// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Settings, RefreshCw, Save, ClipboardPaste, Plus,
  X, Trash2, BookOpen, Bot, Download, Calendar, FolderOpen,
  Minus, ArrowDownToLine, Triangle, FileUp, Activity, Search
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ComposedChart, Line, Area, XAxis,
  YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceArea
} from 'recharts';
import { UI_CONFIG, GSHEET_URL } from './config';
import { fetchIndexData, fetchStockInfo, fetchNaverKospi } from './api';
import Header from './components/Header';
import PortfolioTable from './components/PortfolioTable';
import MarketIndicators from './components/MarketIndicators';
import {
  generateId, cleanNum, formatCurrency, formatPercent, formatNumber,
  formatChangeRate, formatShortDate, formatVeryShortDate, getSeededRandom,
  getClosestValue, getIndexLatest, handleTableKeyDown, buildIndexStatus,
  parseIndexCSV, detectIndexFromFileName
} from './utils';

const sortArrow = (config, key) =>
  config.key === key
    ? (config.direction === 1 ? <span className="ml-0.5 text-blue-400 text-[8px]">▲</span> : <span className="ml-0.5 text-blue-400 text-[8px]">▼</span>)
    : <span className="ml-0.5 text-gray-600 text-[8px]">⇅</span>;

const PieLabelOutside = ({ cx, cy, midAngle, outerRadius, percent, name }) => {
  const safePercent = cleanNum(percent);
  if (safePercent < 0.03) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 20;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#9ca3af" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight="bold">
      {name} ({(safePercent * 100).toFixed(1)}%)
    </text>
  );
};

const CustomChartTooltip = ({ active, payload, total }) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    const itemColor = data.payload?.fill || data.color || data.fill || '#f8fafc';
    let percentStr = "";
    if (total && total > 0) percentStr = `${((data.value / total) * 100).toFixed(1)}%`;
    else if (data.payload?.percent !== undefined || data.percent !== undefined) {
      percentStr = `${((data.payload?.percent ?? data.percent) * 100).toFixed(1)}%`;
    }
    return (
      <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid #4b5563', borderRadius: '10px', padding: '12px 16px' }} className="shadow-2xl flex flex-col items-center justify-center gap-1">
        <span style={{ color: itemColor, fontWeight: '900', fontSize: '20px' }}>{data.name} : {percentStr}</span>
        <span style={{ color: itemColor, fontWeight: 'bold', fontSize: '14px', opacity: 0.9 }}>{formatCurrency(data.value)}</span>
      </div>
    );
  }
  return null;
};


export default function App() {
  const fileInputRef = useRef(null);
  const historyInputRef = useRef(null);

  const defaultCompStocks = [
    { id: 1, code: '', name: '비교종목1', active: false, loading: false },
    { id: 2, code: '', name: '비교종목2', active: false, loading: false },
    { id: 3, code: '', name: '비교종목3', active: false, loading: false }
  ];

  const [title, setTitle] = useState("주식/ETF 포트폴리오");
  const [portfolio, setPortfolio] = useState([]);
  const [principal, setPrincipal] = useState(UI_CONFIG.DEFAULTS.PRINCIPAL);
  const [depositHistory, setDepositHistory] = useState([]);
  const [depositHistory2, setDepositHistory2] = useState([]);
  const [customLinks, setCustomLinks] = useState(UI_CONFIG.DEFAULT_LINKS);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState({ mode: 'rebalance', amount: 1000000 });
  const [historyLimit, setHistoryLimit] = useState(UI_CONFIG.DEFAULTS.HISTORY_LIMIT);
  const [lookupRows, setLookupRows] = useState([]);
  const [comparisonMode, setComparisonMode] = useState('latestOverPast');
  const [isLinkSettingsOpen, setIsLinkSettingsOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 1 });
  const [rebalanceSortConfig, setRebalanceSortConfig] = useState({ key: null, direction: 1 });
  
  // 에러 모달 상태 분리 (토스트는 유지)
  const [globalToast, setGlobalToast] = useState({ text: "", isError: false });
  const [errorModalContent, setErrorModalContent] = useState(null);

  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [chartPeriod, setChartPeriod] = useState('3m');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' });
  const [isDragging, setIsDragging] = useState(false);
  const [refAreaLeft, setRefAreaLeft] = useState('');
  const [refAreaRight, setRefAreaRight] = useState('');
  const [selectionResult, setSelectionResult] = useState(null);
  const [showTotalEval, setShowTotalEval] = useState(true);
  const [showReturnRate, setShowReturnRate] = useState(true);
  const [isZeroBaseMode, setIsZeroBaseMode] = useState(true);
  
  const [showKospi, setShowKospi] = useState(true);
  const [showSp500, setShowSp500] = useState(false);
  const [showNasdaq, setShowNasdaq] = useState(false);
  const [showIndicatorsInChart, setShowIndicatorsInChart] = useState({
    us10y: false, kr10y: false, goldIntl: false, usdkrw: false, dxy: false, fedRate: false
  });
  const [indicatorHistoryLoading, setIndicatorHistoryLoading] = useState({});
  
  const [marketIndices, setMarketIndices] = useState({ kospi: null, sp500: null, nasdaq: null });
  const [indicatorHistoryMap, setIndicatorHistoryMap] = useState({});
  const [stockHistoryMap, setStockHistoryMap] = useState({});
  const [compStocks, setCompStocks] = useState(defaultCompStocks);
  const [portfolioStartDate, setPortfolioStartDate] = useState(() => {
    const today = new Date();
    today.setFullYear(today.getFullYear() - 1);
    return today.toISOString().split('T')[0];
  });
  const [depositSortConfig, setDepositSortConfig] = useState({ key: null, direction: 1 });
  const [depositSortConfig2, setDepositSortConfig2] = useState({ key: null, direction: 1 });

  const [indexFetchStatus, setIndexFetchStatus] = useState({ kospi: null, sp500: null, nasdaq: null });
  const [showIndexVerify, setShowIndexVerify] = useState(false);

  const [stockFetchStatus, setStockFetchStatus] = useState({});

  const [marketIndicators, setMarketIndicators] = useState({
    us10y: null, kr10y: null, usdkrw: null, dxy: null, goldIntl: null, goldKr: null,
    kospiPrice: null, sp500Price: null, nasdaqPrice: null,
    us10yChg: null, kr10yChg: null, usdkrwChg: null, dxyChg: null, goldIntlChg: null, goldKrChg: null,
    kospiChg: null, sp500Chg: null, nasdaqChg: null,
    fedRate: null, fedRateChg: null
  });
  const [indicatorLoading, setIndicatorLoading] = useState(false);
  const [indicatorFetchStatus, setIndicatorFetchStatus] = useState({});
  const [showIndicatorVerify, setShowIndicatorVerify] = useState(false);

  // ── Google Sheets 자동 동기화 ──
  const [gsheetStatus, setGsheetStatus] = useState('');
  const gsheetTimer = useRef(null);
  const isInitialLoad = useRef(true);
  const portfolioRef = useRef([]);

  const loadFromGSheet = async () => {
    try {
      setGsheetStatus('loading');
      const res = await fetch(GSHEET_URL);
      const result = await res.json();
      if (result.success && result.data) {
        const data = result.data;
        setTitle(data.title || "포트폴리오");
        setPortfolio(data.portfolio || []);
        setPrincipal(cleanNum(data.principal));
        setHistory(data.history || []);
        setDepositHistory(data.depositHistory || []);
        if (data.depositHistory2) setDepositHistory2(data.depositHistory2);
        setCustomLinks(data.customLinks || UI_CONFIG.DEFAULT_LINKS);
        setSettings(data.settings || { mode: 'rebalance', amount: 1000000 });
        setLookupRows(data.lookupRows || []);
        setStockHistoryMap(data.stockHistoryMap || {});
        setCompStocks(data.compStocks || defaultCompStocks);
        if (data.marketIndices) {
          setMarketIndices(data.marketIndices);
          setIndexFetchStatus({
            kospi: data.marketIndices.kospi ? buildIndexStatus(data.marketIndices.kospi, 'GSheet') : null,
            sp500: data.marketIndices.sp500 ? buildIndexStatus(data.marketIndices.sp500, 'GSheet') : null,
            nasdaq: data.marketIndices.nasdaq ? buildIndexStatus(data.marketIndices.nasdaq, 'GSheet') : null,
          });
        }
        if (data.portfolioStartDate) setPortfolioStartDate(data.portfolioStartDate);
        if (data.chartPrefs) {
          if (data.chartPrefs.showKospi !== undefined) setShowKospi(data.chartPrefs.showKospi);
          if (data.chartPrefs.showSp500 !== undefined) setShowSp500(data.chartPrefs.showSp500);
          if (data.chartPrefs.showNasdaq !== undefined) setShowNasdaq(data.chartPrefs.showNasdaq);
          if (data.chartPrefs.isZeroBaseMode !== undefined) setIsZeroBaseMode(data.chartPrefs.isZeroBaseMode);
          if (data.chartPrefs.showTotalEval !== undefined) setShowTotalEval(data.chartPrefs.showTotalEval);
          if (data.chartPrefs.showReturnRate !== undefined) setShowReturnRate(data.chartPrefs.showReturnRate);
        }
        if (data.marketIndicators) setMarketIndicators(data.marketIndicators);
        if (data.indicatorHistoryMap) setIndicatorHistoryMap(data.indicatorHistoryMap);
        setGsheetStatus('saved');
        showToast('☁️ Google Sheets에서 데이터 불러옴');
        return data.portfolio || [];
      }
      setGsheetStatus('');
      return null;
    } catch (err) {
      console.error('GSheet 불러오기 실패:', err);
      setGsheetStatus('error');
      return null;
    }
  };

  const saveToGSheet = async (state) => {
    try {
      setGsheetStatus('saving');
      await fetch(GSHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ label: '자동저장', data: state }),
      });
      setGsheetStatus('saved');
    } catch (err) {
      console.error('GSheet 저장 실패:', err);
      setGsheetStatus('error');
    }
  };

  // 개별 패치 함수들을 밖으로 빼서 재사용 가능하도록 구성 (Retry 용도)
  const fetchersMap = {
    us10y: async (now, statusMap) => {
      const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent('https://tradingeconomics.com/united-states/government-bond-yield')}`,
        `https://api.codetabs.com/v1/proxy?quest=${'https://tradingeconomics.com/united-states/government-bond-yield'}`
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
            if (price > 0) { statusMap['us10y'] = { status: 'success', source: proxy.includes('allorigins') ? 'TE(allorigins)' : 'TE(codetabs)', updatedAt: now }; return { price, change }; }
          }
        } catch(e) {}
      }
      statusMap['us10y'] = { status: 'fail', source: 'TE 실패', updatedAt: now }; return { price: null, change: null };
    },
    kr10y: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/marketIndex/bond/KR10YT=RR';
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
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
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
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
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
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
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1d&interval=1d`;
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`];
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
            statusMap['goldIntl'] = { status: 'success', source: 'Yahoo', updatedAt: now }; return { price, change };
          }
        } catch(e) {}
      }
      statusMap['goldIntl'] = { status: 'fail', source: 'Yahoo 실패', updatedAt: now }; return { price: null, change: null };
    },
    goldKr: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/marketIndex/metals/M04020000';
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
      for(const proxy of proxies) {
        try {
          const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
          if(!res.ok) continue;
          const data = await res.json();
          const price = parseFloat(String(data?.closePrice || data?.price || '0').replace(/,/g, ''));
          const change = data?.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
          if(price > 0) { statusMap['goldKr'] = { status: 'success', source: '네이버금시세', updatedAt: now }; return { price, change }; }
        } catch(e) {}
      }
      statusMap['goldKr'] = { status: 'fail', source: '네이버금시세 실패', updatedAt: now }; return { price: null, change: null };
    },
    kospi: async (now, statusMap) => {
      const targetUrl = 'https://m.stock.naver.com/api/index/KOSPI/basic';
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
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
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
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
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`];
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
      const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, `https://api.codetabs.com/v1/proxy?quest=${url}`];
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
    }
  };

  // 재시도 큐 매니저
  const retryFailedIndicators = async (failedKeys, currentStatusMap, maxRetries = 10) => {
    let currentAttempt = 0;
    let pendingKeys = [...failedKeys];
    
    while (pendingKeys.length > 0 && currentAttempt < maxRetries) {
      currentAttempt++;
      // 1초 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      const tempStatusMap = { ...currentStatusMap };
      const newResults = {};
      const stillFailed = [];

      // 순차적으로 혹은 Promise.all로 재시도
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

      // 성공한 것들 업데이트
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
        
        // 차트용 인덱스도 동기화
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

    // 10회 재시도 후에도 실패한 항목이 있으면 에러 팝업 표시
    if (pendingKeys.length > 0) {
      const errorMsg = `다음 시장 지표의 연결이 지연되거나 실패했습니다. (10회 재시도 실패)\n\n[실패 항목]\n${pendingKeys.join(', ')}\n\n* 외부 API 제공 서버(네이버/Yahoo/TE)의 응답 지연일 수 있습니다. 잠시 후 다시 시도해 주세요.`;
      setErrorModalContent({ title: "시장 지표 갱신 오류", message: errorMsg });
    }
  };

  // Apps Script 프록시를 통한 시장지표 수집 (CORS 우회)
  const fetchIndicatorsViaProxy = async () => {
    try {
      const res = await fetch(`${GSHEET_URL}?action=indicators`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      const json = await res.json();
      if (json.success && json.data) return json.data;
      return null;
    } catch (e) {
      console.error('Apps Script 시장지표 프록시 실패:', e);
      return null;
    }
  };

  // stooq symbol 매핑
  const STOOQ_SYMBOLS = {
    us10y: 'tnx.us',
    goldIntl: 'xauusd.oanda',
    usdkrw: 'usdkrw.fx',
    dxy: 'dxy.f',
    kr10y: null,   // 무료 소스 없음
    fedRate: null, // 계단식 데이터 - 무료 소스 없음
  };

  const INDICATOR_LABELS = {
    us10y: 'US 10Y', kr10y: 'KR 10Y', goldIntl: 'Gold',
    usdkrw: 'USDKRW', dxy: 'DXY', fedRate: '미국 기준금리',
  };

  // stooq에서 과거 데이터 CSV 가져오기
  const fetchIndicatorHistory = async (key, startDate, endDate) => {
    const symbol = STOOQ_SYMBOLS[key];
    if (!symbol) {
      showToast(`${INDICATOR_LABELS[key] || key}: 자동 수집 미지원 (CSV 파일 업로드 필요)`, true);
      return null;
    }

    setIndicatorHistoryLoading(prev => ({ ...prev, [key]: true }));

    const d1 = (startDate || appliedRange.start || (() => {
      const d = new Date(); d.setFullYear(d.getFullYear() - 3); return d.toISOString().split('T')[0];
    })()).replace(/-/g, '');
    const d2 = (endDate || appliedRange.end || new Date().toISOString().split('T')[0]).replace(/-/g, '');
    const stooqUrl = `https://stooq.com/q/d/l/?s=${symbol}&d1=${d1}&d2=${d2}&i=d`;
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(stooqUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${stooqUrl}`,
    ];

    let parsedData = null;
    for (const proxy of proxies) {
      try {
        const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) continue;
        const csv = await res.text();
        if (!csv || csv.includes('No data') || csv.length < 50) continue;
        parsedData = parseIndexCSV(csv, `${key}.csv`);
        if (parsedData && Object.keys(parsedData).length > 5) break;
      } catch (e) { continue; }
    }

    setIndicatorHistoryLoading(prev => ({ ...prev, [key]: false }));

    if (!parsedData || Object.keys(parsedData).length === 0) {
      showToast(`${INDICATOR_LABELS[key] || key} 과거 데이터 수집 실패 - CSV 직접 업로드 필요`, true);
      return null;
    }

    setIndicatorHistoryMap(prev => ({ ...prev, [key]: parsedData }));
    showToast(`${INDICATOR_LABELS[key] || key} 과거 데이터 ${Object.keys(parsedData).length}건 수집 완료`);

    // Google Sheets 백업
    try {
      await fetch(GSHEET_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveIndicatorHistory', key, data: parsedData }),
      });
    } catch (e) { console.warn('GSheet 지표 히스토리 백업 실패:', e); }

    return parsedData;
  };

  // stooq 지원 지표 전체 일괄 수집 + GSheet 저장
  const fetchAllIndicatorHistory = async () => {
    const keys = ['us10y', 'goldIntl', 'usdkrw', 'dxy'];
    showToast('시장지표 일괄 수집 시작...');
    for (const key of keys) {
      await fetchIndicatorHistory(key, appliedRange?.start, appliedRange?.end);
    }
    showToast('✅ 시장지표 일괄 수집 완료 (GSheet 저장됨)');
  };

  // CSV / JSON 파일 직접 업로드로 지표 히스토리 주입 (stooq 미지원 지표용)
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
                const key = Object.keys(item).find(k => !skip.includes(k) && typeof item[k] === 'number');
                return key ? item[key] : undefined;
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
      showToast(`${INDICATOR_LABELS[key] || key} 히스토리 ${Object.keys(parsedData).length}건 업로드 완료`);

      // Google Sheets 백업
      try {
        await fetch(GSHEET_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'saveIndicatorHistory', key, data: parsedData }),
        });
      } catch (err) { console.warn('GSheet 지표 히스토리 백업 실패:', err); }
    };
    reader.readAsText(file);
  };

  const fetchMarketIndicators = async () => {
    setIndicatorLoading(true);
    const statusMap = {};
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    
    const resultsMap = {
      us10y: null, kr10y: null, usdkrw: null, dxy: null, goldIntl: null, goldKr: null,
      kospi: null, sp500: null, nasdaq: null, fedRate: null
    };

    // 1차: Apps Script 프록시 통합 호출 (CORS 무관, 안정적)
    const proxyData = await fetchIndicatorsViaProxy();
    
    if (proxyData) {
      // 프록시 성공 시 매핑
      const keyMap = {
        kospi: 'kospi', sp500: 'sp500', nasdaq: 'nasdaq',
        us10y: 'us10y', kr10y: 'kr10y', usdkrw: 'usdkrw',
        dxy: 'dxy', goldIntl: 'goldIntl', goldKr: 'goldKr', fedRate: 'fedRate'
      };
      Object.keys(keyMap).forEach(k => {
        const d = proxyData[k];
        if (d && d.price !== null && d.price !== undefined) {
          resultsMap[k] = { price: d.price, change: d.change ?? null };
          statusMap[k] = { status: 'success', source: d.source || 'Apps Script 프록시', updatedAt: now };
        }
      });
    }

    // 2차: 프록시에서 실패한 항목만 기존 fetchersMap으로 폴백
    const failedAfterProxy = Object.keys(resultsMap).filter(k => resultsMap[k] === null);
    
    if (failedAfterProxy.length > 0) {
      console.log(`Apps Script 프록시 미수집 항목 (${failedAfterProxy.length}건), 직접 호출 폴백:`, failedAfterProxy);
      await Promise.all(failedAfterProxy.map(async (key) => {
        const fetcher = fetchersMap[key];
        if (fetcher) {
          const res = await fetcher(now, statusMap);
          resultsMap[key] = res;
        }
      }));
    }

    // 상태 업데이트
    const keys = Object.keys(resultsMap);
    setMarketIndicators(prev => {
      const merged = { ...prev };
      keys.forEach(k => {
        if (resultsMap[k]?.price !== null && resultsMap[k]?.price !== undefined) {
          if (k === 'kospi' || k === 'sp500' || k === 'nasdaq') {
            merged[`${k}Price`] = resultsMap[k].price;
            merged[`${k}Chg`] = resultsMap[k].change;
          } else {
            merged[k] = resultsMap[k].price;
            merged[`${k}Chg`] = resultsMap[k].change;
          }
        }
      });
      return merged;
    });

    const todayMI = new Date().toISOString().split("T")[0];
    setMarketIndices(prev => ({
      kospi:  resultsMap.kospi?.price  ? { ...(prev.kospi  || {}), [todayMI]: resultsMap.kospi.price  } : prev.kospi,
      sp500:  resultsMap.sp500?.price  ? { ...(prev.sp500  || {}), [todayMI]: resultsMap.sp500.price  } : prev.sp500,
      nasdaq: resultsMap.nasdaq?.price ? { ...(prev.nasdaq || {}), [todayMI]: resultsMap.nasdaq.price } : prev.nasdaq,
    }));

    setIndicatorFetchStatus(statusMap);
    setIndicatorLoading(false);
    
    // 실패한 키 추출
    const finalFailedKeys = keys.filter(k => !resultsMap[k] || resultsMap[k].price === null);
    
    if (finalFailedKeys.length > 0) {
       // 백그라운드 재시도 큐 진입
       retryFailedIndicators(finalFailedKeys, statusMap, 10);
    } else {
       const proxyCount = proxyData ? Object.keys(resultsMap).filter(k => statusMap[k]?.source?.includes('프록시') || statusMap[k]?.source?.includes('Apps Script')).length : 0;
       showToast(`시장 지표 ${keys.length}건 수집 완료${proxyCount > 0 ? ` (프록시 ${proxyCount}건)` : ''}`);
    }
  };

  // portfolioRef를 항상 최신 portfolio로 동기화 (클로저 문제 해결용)
  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);

  const totals = useMemo(() => {
    let tInv = 0, tEvl = 0, tPrf = 0, cats = {}, stks = [];
    const calc = portfolio.map(item => {
      let inv = 0, evl = 0;
      if (item.type === 'deposit') { inv = evl = cleanNum(item.depositAmount); }
      else { inv = cleanNum(item.purchasePrice) * cleanNum(item.quantity); evl = cleanNum(item.currentPrice) * cleanNum(item.quantity); }
      const prf = evl - inv; tInv += inv; tEvl += evl; tPrf += prf;
      const c = item.category || '미지정';
      if (!cats[c]) cats[c] = { invest: 0, eval: 0, profit: 0 };
      cats[c].invest += inv; cats[c].eval += evl; cats[c].profit += prf;
      if (item.type === 'stock') stks.push({ name: item.name, eval: evl });
      return { ...item, investAmount: inv, evalAmount: evl, profit: prf };
    }).map(item => ({
      ...item,
      investRatio: tInv > 0 ? (item.investAmount / tInv) * 100 : 0,
      evalRatio: tEvl > 0 ? (item.evalAmount / tEvl) * 100 : 0,
      returnRate: item.investAmount > 0 ? (item.profit / item.investAmount) * 100 : 0
    }));
    return { calcPortfolio: calc, totalInvest: tInv, totalEval: tEvl, totalProfit: tPrf, cats, stks };
  }, [portfolio]);

  const cagr = useMemo(() => {
    if (!portfolioStartDate || principal <= 0 || totals.totalEval <= 0) return 0;
    const days = (new Date() - new Date(portfolioStartDate)) / (1000 * 60 * 60 * 24);
    if (days <= 0) return 0;
    return (Math.pow(totals.totalEval / principal, 1 / Math.max(days / 365.25, 1)) - 1) * 100;
  }, [portfolioStartDate, principal, totals.totalEval]);

  const sortedHistoryDesc = useMemo(() => [...history].sort((a, b) => new Date(b.date) - new Date(a.date)), [history]);

  const unifiedDates = useMemo(() => {
    const dates = new Set();
    history.forEach(h => dates.add(h.date));
    if (marketIndices.kospi) Object.keys(marketIndices.kospi).forEach(d => dates.add(d));
    if (marketIndices.sp500) Object.keys(marketIndices.sp500).forEach(d => dates.add(d));
    if (marketIndices.nasdaq) Object.keys(marketIndices.nasdaq).forEach(d => dates.add(d));
    Object.values(stockHistoryMap).forEach(stock => Object.keys(stock).forEach(d => dates.add(d)));
    Object.values(indicatorHistoryMap).forEach(h => Object.keys(h).forEach(d => dates.add(d)));
    if (portfolioStartDate) dates.add(portfolioStartDate);
    return Array.from(dates).sort((a, b) => new Date(a) - new Date(b));
  }, [history, marketIndices, stockHistoryMap, indicatorHistoryMap, portfolioStartDate]);

  const filteredDates = useMemo(() => {
    if (!appliedRange.start || !appliedRange.end) return unifiedDates;
    return unifiedDates.filter(d => d >= appliedRange.start && d <= appliedRange.end);
  }, [unifiedDates, appliedRange]);

  const INDICATOR_CHART_KEYS = ['us10y', 'kr10y', 'goldIntl', 'usdkrw', 'dxy', 'fedRate'];

  const indexDataMap = useMemo(() => {
    const map = {};
    if (unifiedDates.length === 0) return map;
    let baseK = null, baseS = null, baseN = null;
    let baseComps = [null, null, null];
    const baseIndicators = {};
    unifiedDates.forEach((dateStr, i) => {
      const currK = getClosestValue(marketIndices.kospi, dateStr);
      const currS = getClosestValue(marketIndices.sp500, dateStr);
      const currN = getClosestValue(marketIndices.nasdaq, dateStr);
      let kPoint = currK || (baseK ? baseK * (1 + (getSeededRandom(dateStr + 'k') - 0.49) * 0.015) : 2600);
      let sPoint = currS || (baseS ? baseS * (1 + (getSeededRandom(dateStr + 's') - 0.48) * 0.015) : 5000);
      let nPoint = currN || (baseN ? baseN * (1 + (getSeededRandom(dateStr + 'n') - 0.47) * 0.02) : 17000);
      let c1 = null, c2 = null, c3 = null;
      if (compStocks[0]?.active && compStocks[0].code) c1 = getClosestValue(stockHistoryMap[compStocks[0].code], dateStr);
      if (compStocks[1]?.active && compStocks[1].code) c2 = getClosestValue(stockHistoryMap[compStocks[1].code], dateStr);
      if (compStocks[2]?.active && compStocks[2].code) c3 = getClosestValue(stockHistoryMap[compStocks[2].code], dateStr);

      // 시장 지표 히스토리
      const indPoints = {};
      INDICATOR_CHART_KEYS.forEach(k => {
        const h = indicatorHistoryMap[k];
        if (!h) return;
        const v = getClosestValue(h, dateStr);
        if (v !== null) {
          indPoints[`${k}Point`] = v;
          if (i === 0 || baseIndicators[k] == null) baseIndicators[k] = v;
          indPoints[`${k}Rate`] = baseIndicators[k] > 0 ? ((v / baseIndicators[k]) - 1) * 100 : 0;
        }
      });

      if (i === 0) { baseK = kPoint; baseS = sPoint; baseN = nPoint; baseComps = [c1, c2, c3]; }
      map[dateStr] = {
        kospiPoint: kPoint, sp500Point: sPoint, nasdaqPoint: nPoint,
        comp1Point: c1, comp2Point: c2, comp3Point: c3,
        kospiRate: baseK ? ((kPoint / baseK) - 1) * 100 : 0,
        sp500Rate: baseS ? ((sPoint / baseS) - 1) * 100 : 0,
        nasdaqRate: baseN ? ((nPoint / baseN) - 1) * 100 : 0,
        comp1Rate: (baseComps[0] && c1) ? ((c1 / baseComps[0]) - 1) * 100 : 0,
        comp2Rate: (baseComps[1] && c2) ? ((c2 / baseComps[1]) - 1) * 100 : 0,
        comp3Rate: (baseComps[2] && c3) ? ((c3 / baseComps[2]) - 1) * 100 : 0,
        ...indPoints,
      };
    });
    return map;
  }, [unifiedDates, marketIndices, compStocks, stockHistoryMap, indicatorHistoryMap]);

  const finalChartData = useMemo(() => {
    const localSortedHist = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
    const rawData = filteredDates.map(date => {
      let trueEvalAtDate = 0, retRate = 0;
      if (date >= portfolioStartDate) {
        let hasTrueData = false;
        const hIdx = localSortedHist.slice().reverse().find(h => h.date <= date) || localSortedHist[0];
        const baseEval = hIdx ? hIdx.evalAmount : totals.totalEval;
        const basePrin = hIdx ? hIdx.principal : principal;
        portfolio.forEach(item => {
          if (item.type === 'deposit') { trueEvalAtDate += cleanNum(item.depositAmount); }
          else if (item.code && stockHistoryMap[item.code]) {
            const priceAtDate = getClosestValue(stockHistoryMap[item.code], date);
            if (priceAtDate) { trueEvalAtDate += priceAtDate * item.quantity; hasTrueData = true; }
            else { trueEvalAtDate += cleanNum(item.evalAmount) * (baseEval / (totals.totalEval || 1)); }
          } else { trueEvalAtDate += cleanNum(item.evalAmount) * (baseEval / (totals.totalEval || 1)); }
        });
        if (!hasTrueData && hIdx) trueEvalAtDate = hIdx.evalAmount;
        retRate = basePrin > 0 ? ((trueEvalAtDate - basePrin) / basePrin * 100) : 0;
      }
      return { date, ...(indexDataMap[date] || {}), evalAmount: trueEvalAtDate, returnRate: retRate };
    });
    if (!isZeroBaseMode || rawData.length === 0) return rawData;
    const baseItem = rawData[0];
    return rawData.map(item => {
      const indRates = {};
      INDICATOR_CHART_KEYS.forEach(k => {
        const basePoint = baseItem[`${k}Point`];
        const curPoint = item[`${k}Point`];
        if (basePoint > 0 && curPoint != null) {
          indRates[`${k}Rate`] = ((curPoint / basePoint) - 1) * 100;
        }
      });
      return {
        ...item,
        returnRate: baseItem.evalAmount > 0 ? ((item.evalAmount / baseItem.evalAmount) - 1) * 100 : 0,
        kospiRate: baseItem.kospiPoint > 0 ? ((item.kospiPoint / baseItem.kospiPoint) - 1) * 100 : 0,
        sp500Rate: baseItem.sp500Point > 0 ? ((item.sp500Point / baseItem.sp500Point) - 1) * 100 : 0,
        nasdaqRate: baseItem.nasdaqPoint > 0 ? ((item.nasdaqPoint / baseItem.nasdaqPoint) - 1) * 100 : 0,
        comp1Rate: baseItem.comp1Point > 0 ? ((item.comp1Point / baseItem.comp1Point) - 1) * 100 : 0,
        comp2Rate: baseItem.comp2Point > 0 ? ((item.comp2Point / baseItem.comp2Point) - 1) * 100 : 0,
        comp3Rate: baseItem.comp3Point > 0 ? ((item.comp3Point / baseItem.comp3Point) - 1) * 100 : 0,
        ...indRates,
      };
    });
  }, [filteredDates, indexDataMap, stockHistoryMap, portfolio, history, totals.totalEval, principal, portfolioStartDate, isZeroBaseMode]);

  const rebalanceData = useMemo(() => {
    const overallExp = cleanNum(totals.totalEval) + cleanNum(settings.amount);
    let data = portfolio.filter(p => p.type === 'stock').map(item => {
      const tRatio = cleanNum(item.targetRatio) / 100;
      const curEval = cleanNum(item.currentPrice) * cleanNum(item.quantity);
      let action = item.currentPrice > 0 ? (settings.mode === 'rebalance' ? Math.trunc(((overallExp * tRatio) - curEval) / item.currentPrice) : Math.trunc((cleanNum(settings.amount) * tRatio) / item.currentPrice)) : 0;
      const expEval = (cleanNum(item.quantity) + action) * cleanNum(item.currentPrice);
      const cost = action * item.currentPrice;
      const expRatio = overallExp > 0 ? (expEval / overallExp * 100) : 0;
      return { ...item, curEval, action, cost, expEval, expRatio };
    });
    if (rebalanceSortConfig.key) {
      data.sort((a, b) => {
        let vA = a[rebalanceSortConfig.key], vB = b[rebalanceSortConfig.key];
        if (typeof vA === 'string') return vA.localeCompare(vB) * rebalanceSortConfig.direction;
        return (vA - vB) * rebalanceSortConfig.direction;
      });
    }
    return data;
  }, [portfolio, totals.totalEval, settings, rebalanceSortConfig]);

  const displayHistSliced = useMemo(() => sortedHistoryDesc.slice(0, historyLimit), [sortedHistoryDesc, historyLimit]);

  const depositWithSum = useMemo(() => {
    let runSum = 0;
    return [...depositHistory].reverse().map((h, i) => {
      runSum += cleanNum(h.amount);
      return { ...h, cumulative: runSum, originalIndex: depositHistory.length - 1 - i };
    }).reverse();
  }, [depositHistory]);

  const depositWithSum2 = useMemo(() => {
    let runSum = 0;
    return [...depositHistory2].reverse().map((h, i) => {
      runSum += cleanNum(h.amount);
      return { ...h, cumulative: runSum, originalIndex: depositHistory2.length - 1 - i };
    }).reverse();
  }, [depositHistory2]);

  const depositWithSumSorted = useMemo(() => {
    if (!depositSortConfig.key) return depositWithSum;
    return [...depositWithSum].sort((a, b) => {
      if (depositSortConfig.key === 'date') { const da = a.date ? new Date(a.date).getTime() : 0; const db = b.date ? new Date(b.date).getTime() : 0; return (da - db) * depositSortConfig.direction; }
      if (depositSortConfig.key === 'amount') { return (cleanNum(a.amount) - cleanNum(b.amount)) * depositSortConfig.direction; }
      return 0;
    });
  }, [depositWithSum, depositSortConfig]);

  const depositWithSum2Sorted = useMemo(() => {
    if (!depositSortConfig2.key) return depositWithSum2;
    return [...depositWithSum2].sort((a, b) => {
      if (depositSortConfig2.key === 'date') { const da = a.date ? new Date(a.date).getTime() : 0; const db = b.date ? new Date(b.date).getTime() : 0; return (da - db) * depositSortConfig2.direction; }
      if (depositSortConfig2.key === 'amount') { return (cleanNum(a.amount) - cleanNum(b.amount)) * depositSortConfig2.direction; }
      return 0;
    });
  }, [depositWithSum2, depositSortConfig2]);

  const handleSort = (key) => {
    let dir = sortConfig.key === key ? -sortConfig.direction : 1;
    setSortConfig({ key, direction: dir });
    setPortfolio(prev => {
      const stocks = [...prev.filter(p => p.type === 'stock')];
      const deposits = prev.filter(p => p.type === 'deposit');
      let tInv = 0, tEvl = 0;
      prev.forEach(item => {
        if (item.type === 'deposit') { tInv += cleanNum(item.depositAmount); tEvl += cleanNum(item.depositAmount); }
        else { tInv += cleanNum(item.purchasePrice) * cleanNum(item.quantity); tEvl += cleanNum(item.currentPrice) * cleanNum(item.quantity); }
      });
      stocks.sort((a, b) => {
        const getVal = (item, k) => {
          const cP = cleanNum(item.currentPrice), pP = cleanNum(item.purchasePrice), qty = cleanNum(item.quantity);
          if (k === 'investAmount') return pP * qty;
          if (k === 'evalAmount') return cP * qty;
          if (k === 'profit') return (cP - pP) * qty;
          if (k === 'returnRate') return (pP * qty) > 0 ? ((cP - pP) * qty) / (pP * qty) : 0;
          if (k === 'investRatio') return tInv > 0 ? (pP * qty) / tInv : 0;
          if (k === 'evalRatio') return tEvl > 0 ? (cP * qty) / tEvl : 0;
          return item[k] || 0;
        };
        let vA = getVal(a, key), vB = getVal(b, key);
        if (typeof vA === 'string') return vA.localeCompare(vB) * dir;
        return (vA - vB) * dir;
      });
      return [...stocks, ...deposits];
    });
  };

  const handleRebalanceSort = (key) => setRebalanceSortConfig(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));
  const handleDepositSort = (key) => setDepositSortConfig(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));
  const handleDepositSort2 = (key) => setDepositSortConfig2(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }));
  const handleUpdate = (id, field, value) => setPortfolio(prev => prev.map(p => p.id === id ? { ...p, [field]: ['category', 'name', 'code'].includes(field) ? value : cleanNum(value) } : p));
  const handleDeleteStock = (id) => setPortfolio(prev => prev.filter(p => p.id !== id));
  const handleAddStock = () => setPortfolio([{ id: generateId(), type: 'stock', category: "주식", code: "", name: "", currentPrice: 0, changeRate: 0, purchasePrice: 0, quantity: 0, targetRatio: 0, isManual: true }, ...portfolio]);
  const showToast = (text, isError = false) => { setGlobalToast({ text, isError }); setTimeout(() => setGlobalToast({ text: "", isError: false }), 4000); };

  const handleStockBlur = async (id, code) => {
    if (code && code.length >= 5) {
      setStockFetchStatus(prev => ({ ...prev, [code]: 'loading' }));
      const d = await fetchStockInfo(code);
      if (d) {
        setPortfolio(prev => prev.map(p => p.id === id ? { ...p, name: d.name, currentPrice: d.price, changeRate: d.changeRate } : p));
        setStockFetchStatus(prev => ({ ...prev, [code]: 'success' }));
        const today = new Date().toISOString().split('T')[0];
        setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
      } else {
        setStockFetchStatus(prev => ({ ...prev, [code]: 'fail' }));
      }
    }
  };

  const handleSingleStockRefresh = async (id, code) => {
    if (!code || code.length < 5) return;
    setStockFetchStatus(prev => ({ ...prev, [code]: 'loading' }));
    const d = await fetchStockInfo(code);
    if (d) {
      setPortfolio(prev => prev.map(p => p.id === id ? { ...p, name: d.name, currentPrice: d.price, changeRate: d.changeRate } : p));
      setStockFetchStatus(prev => ({ ...prev, [code]: 'success' }));
      const today = new Date().toISOString().split('T')[0];
      setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
      showToast(`${d.name} 현재가 갱신 완료: ${formatNumber(d.price)}`);
    } else {
      setStockFetchStatus(prev => ({ ...prev, [code]: 'fail' }));
      showToast(`${code} 현재가 갱신 실패`, true);
    }
  };

  const handleCompStockBlur = async (index, code) => {
    if (!code || code.length < 5) return;
    const d = await fetchStockInfo(code);
    if (d) setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], name: d.name }; return n; });
  };

  const handleToggleComp = async (index) => {
    const comp = compStocks[index];
    if (!comp.code) return;
    
    // 비교 종목 데이터 호출 시 검증 패널 강제 오픈
    setShowIndexVerify(true);

    if (comp.active) { setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: false }; return n; }); return; }
    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: true }; return n; });
    let hist = stockHistoryMap[comp.code];
    if (!hist) {
      const r1 = await fetchIndexData(`${comp.code}.KS`);
      if (r1) hist = r1.data;
      if (!hist) { const r2 = await fetchIndexData(`${comp.code}.KQ`); if (r2) hist = r2.data; }
      if (hist) { setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist })); }
      else {
        const info = await fetchStockInfo(comp.code);
        if (info) {
          const todayStr = new Date().toISOString().split('T')[0];
          hist = { [todayStr]: info.price };
          setStockHistoryMap(prev => ({ ...prev, [comp.code]: hist }));
          showToast(`⚠️ ${comp.name || comp.code} 과거 데이터가 없어 현재가만 표시됩니다.`, true);
        } else {
          showToast(`${comp.code} 데이터를 찾을 수 없습니다.`, true);
          setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], loading: false }; return n; });
          return;
        }
      }
    }
    setCompStocks(prev => { const n = [...prev]; n[index] = { ...n[index], active: true, loading: false }; return n; });
  };

  const refreshPrices = async () => {
    setIsLoading(true);
    setIndexFetchStatus({
      kospi: { status: 'loading' },
      sp500: { status: 'loading' },
      nasdaq: { status: 'loading' }
    });

    // portfolioRef로 항상 최신 portfolio를 안전하게 읽기
    const currentPortfolio = portfolioRef.current;

    const stockCodes = currentPortfolio.filter(p => p.type === 'stock' && p.code).map(p => p.code);
    const loadingStatus = {};
    stockCodes.forEach(c => { loadingStatus[c] = 'loading'; });
    setStockFetchStatus(prev => ({ ...prev, ...loadingStatus }));

    try {
      const today = new Date().toISOString().split('T')[0];
      
      // 종목별 현재가 조회 결과를 Map으로 수집
      const priceResults = {};
      await Promise.all(stockCodes.map(async (code) => {
        const d = await fetchStockInfo(code);
        if (d) {
          setStockFetchStatus(prev => ({ ...prev, [code]: 'success' }));
          setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), [today]: d.price } }));
          priceResults[code] = d;
        } else {
          setStockFetchStatus(prev => ({ ...prev, [code]: 'fail' }));
        }
      }));

      // 함수형 업데이트로 portfolio를 안전하게 갱신 (클로저 문제 완전 해결)
      setPortfolio(prev => prev.map(item => {
        if (item.type === 'stock' && item.code && priceResults[item.code]) {
          const d = priceResults[item.code];
          return { ...item, name: d.name, currentPrice: d.price, changeRate: d.changeRate };
        }
        return item;
      }));

      const [kRes, sRes, nRes] = await Promise.allSettled([
        fetchIndexData('^KS11'),
        fetchIndexData('^GSPC'),
        fetchIndexData('^NDX')
      ]);

      let newK = (kRes.status === 'fulfilled' && kRes.value) ? kRes.value : null;
      let newS = (sRes.status === 'fulfilled' && sRes.value) ? sRes.value : null;
      let newN = (nRes.status === 'fulfilled' && nRes.value) ? nRes.value : null;

      const resolveFailure = (prevData) => {
        const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const hasPrev = prevData && Object.keys(prevData).length > 0;
        if (hasPrev) {
          const st = buildIndexStatus(prevData, '백업데이터');
          st.status = 'partial';
          return { data: prevData, status: st };
        }
        return { data: null, status: { status: 'fail', source: '접속 불가', latestDate: '-', latestValue: 0, count: 0, gapDays: null, updatedAt: now } };
      };

      // KOSPI 네이버 폴백 (비동기라 setMarketIndices 밖에서 처리)
      if (!newK) {
        const naverPrice = await fetchNaverKospi();
        if (naverPrice) {
          newK = { data: { [today]: naverPrice }, source: '네이버(당일) + 백업데이터' };
        }
      }

      setMarketIndices(prev => {
        let kResult, sResult, nResult;

        if (newK) {
          const merged = { ...(prev.kospi || {}), ...newK.data };
          kResult = { data: merged, status: buildIndexStatus(merged, newK.source) };
        } else {
          kResult = resolveFailure(prev.kospi);
        }

        if (newS) {
          const merged = { ...(prev.sp500 || {}), ...newS.data };
          sResult = { data: merged, status: buildIndexStatus(merged, newS.source) };
        } else {
          sResult = resolveFailure(prev.sp500);
        }

        if (newN) {
          const merged = { ...(prev.nasdaq || {}), ...newN.data };
          nResult = { data: merged, status: buildIndexStatus(merged, newN.source) };
        } else {
          nResult = resolveFailure(prev.nasdaq);
        }

        setIndexFetchStatus({ kospi: kResult.status, sp500: sResult.status, nasdaq: nResult.status });

        const hasFail = [kResult.status, sResult.status, nResult.status].some(s => s?.status === 'fail');
      
        if (hasFail) {
          let errDetails = [];
          if(kResult.status?.status === 'fail') errDetails.push("KOSPI 데이터 응답 지연");
          if(sResult.status?.status === 'fail') errDetails.push("S&P500 데이터 응답 지연");
          if(nResult.status?.status === 'fail') errDetails.push("NASDAQ 데이터 응답 지연");
        
          setErrorModalContent({
             title: "데이터 갱신 일부 실패",
             message: `다음 지표의 데이터를 불러오는데 실패했습니다:\n\n${errDetails.join('\n')}\n\n* 외부 통신(네이버/Yahoo API) 지연일 수 있습니다.\n* 잠시 후 새로고침 버튼을 다시 눌러주세요.`
          });
        } else {
          showToast(`전체 종목 및 지수 갱신 완료`);
        }

        return {
          kospi: kResult.data || prev.kospi,
          sp500: sResult.data || prev.sp500,
          nasdaq: nResult.data || prev.nasdaq
        };
      });

    } catch (err) {
      setErrorModalContent({
        title: "데이터 갱신 치명적 오류",
        message: `데이터 갱신 중 네트워크 단절 등 심각한 오류가 발생했습니다.\n\n오류 내용: ${err.message}`
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportHistoryJSON = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        const fileName = file.name;
        const ext = fileName.split('.').pop().toLowerCase();

        if (ext === 'csv') {
          const parsedData = parseIndexCSV(content, fileName);
          if (!parsedData || Object.keys(parsedData).length === 0) {
            showToast(`${fileName}: CSV 파싱 실패 (지원 형식: 네이버증권/investing.com/stooq)`, true);
            return;
          }
          const detectedIndex = detectIndexFromFileName(fileName);
          if (detectedIndex === 'kospi') {
            setMarketIndices(prev => ({ ...prev, kospi: { ...(prev.kospi || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, kospi: buildIndexStatus({ ...(marketIndices.kospi || {}), ...parsedData }, 'CSV 업로드') }));
            showToast(`[지수] KOSPI CSV 업로드 완료 (${Object.keys(parsedData).length}건)`);
          } else if (detectedIndex === 'sp500') {
            setMarketIndices(prev => ({ ...prev, sp500: { ...(prev.sp500 || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, sp500: buildIndexStatus({ ...(marketIndices.sp500 || {}), ...parsedData }, 'CSV 업로드') }));
            showToast(`[지수] S&P500 CSV 업로드 완료 (${Object.keys(parsedData).length}건)`);
          } else if (detectedIndex === 'nasdaq') {
            setMarketIndices(prev => ({ ...prev, nasdaq: { ...(prev.nasdaq || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, nasdaq: buildIndexStatus({ ...(marketIndices.nasdaq || {}), ...parsedData }, 'CSV 업로드') }));
            showToast(`[지수] NASDAQ CSV 업로드 완료 (${Object.keys(parsedData).length}건)`);
          } else {
            const codeMatch = fileName.match(/([A-Z0-9]{4,6})/);
            const code = codeMatch ? codeMatch[1] : fileName.replace('.csv', '');
            setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...parsedData } }));
            showToast(`[종목] ${code} CSV 업로드 완료 (${Object.keys(parsedData).length}건)\n※ 지수 CSV는 파일명에 KOSPI/SP500/NASDAQ 포함 필요`);
          }
          return;
        }

        try {
          const raw = JSON.parse(content);
          if (raw.data && Array.isArray(raw.data)) {
            const upperFN = fileName.toUpperCase();
            const detectMarketKey = (fn) => {
              if (fn.includes('GOLD_INTL')) return 'GOLD_INTL';
              if (fn.includes('FED_RATE')) return 'FED_RATE';
              if (fn.includes('USD_KRW')) return 'USD_KRW';
              if (fn.includes('US_10Y_BOND') || fn.includes('US10Y')) return 'US_10Y_BOND';
              if (fn.includes('NASDAQ100') || fn.includes('NASDAQ')) return 'NASDAQ100';
              if (fn.includes('SP500') || fn.includes('S&P500')) return 'SP500';
              if (fn.includes('KOSPI')) return 'KOSPI';
              return null;
            };
            const marketKey = detectMarketKey(upperFN);

            let code = "";
            if (marketKey) {
              code = marketKey;
            } else {
              const exactMatch = fileName.match(/STOCK_([a-zA-Z0-9]+)_/i);
              if (exactMatch?.[1]) code = exactMatch[1];
              else { const fm = fileName.match(/[a-zA-Z0-9]{4,6}/); code = fm ? fm[0] : ""; }
            }

            const formattedData = {};
            raw.data.forEach(item => {
              const dateStr = item.Date ?? item.date ?? item.index ?? item.INDEX;
              const v = item.Close ?? item.Value ?? item.close ?? item.value ?? (() => {
                const skip = ['Date', 'date', 'index', 'INDEX'];
                const key = Object.keys(item).find(k => !skip.includes(k) && typeof item[k] === 'number');
                return key ? item[key] : undefined;
              })();
              if (dateStr && v != null && v > 0) {
                const d = dateStr.substring(0, 10);
                if (d !== '1970-01-01') formattedData[d] = v;
              }
            });

            if (Object.keys(formattedData).length === 0) {
              showToast(`${fileName}: 유효 데이터 없음 (날짜/값 확인 필요)`, true);
              return;
            }

            const getLatestChg = (data) => {
              const dates = Object.keys(data).sort();
              const latest = data[dates[dates.length - 1]];
              const prev = dates.length >= 2 ? data[dates[dates.length - 2]] : null;
              const chg = (prev && prev > 0) ? ((latest / prev) - 1) * 100 : null;
              return { latest, chg, count: dates.length };
            };

            if (Object.keys(formattedData).length > 0 && code) {
              const cu = code.toUpperCase();

              if (['KS11', 'KOSPI'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, kospi: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, kospi: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, kospiPrice: latest, kospiChg: chg }));
                showToast(`[지수] KOSPI 데이터 수동 연동 완료 (${count}건)`);
              } else if (['US500', 'GSPC', 'SPX', 'S&P500', 'SP500'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, sp500: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, sp500: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, sp500Price: latest, sp500Chg: chg }));
                showToast(`[지수] S&P500 데이터 수동 연동 완료 (${count}건)`);
              } else if (['NDX', 'IXIC', 'NASDAQ', 'NASDAQ100'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, nasdaq: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, nasdaq: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, nasdaqPrice: latest, nasdaqChg: chg }));
                showToast(`[지수] NASDAQ 데이터 수동 연동 완료 (${count}건)`);
              } else if (cu === 'GOLD_INTL') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, goldIntl: latest, goldIntlChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, goldIntl: formattedData }));
                showToast(`[시장지표] 국제금 데이터 주입 완료 (${count}건, 최신: $${latest?.toFixed(2)})`);
              } else if (cu === 'USD_KRW') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, usdkrw: latest, usdkrwChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, usdkrw: formattedData }));
                showToast(`[시장지표] USD/KRW 환율 주입 완료 (${count}건, 최신: ${latest?.toFixed(2)})`);
              } else if (cu === 'US_10Y_BOND') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, us10y: latest, us10yChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, us10y: formattedData }));
                showToast(`[시장지표] 미국10년 금리 주입 완료 (${count}건, 최신: ${latest?.toFixed(3)}%)`);
              } else if (cu === 'FED_RATE') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, fedRate: latest, fedRateChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, fedRate: formattedData }));
                showToast(`[시장지표] 미국 기준금리 주입 완료 (${count}건, 최신: ${latest?.toFixed(2)}%)`);
              } else {
                setStockHistoryMap(prev => ({ ...prev, [code]: formattedData }));
                showToast(`[종목] ${code || fileName} 데이터 주입 완료`);
              }
            }
          }
        } catch (err) { showToast(`${fileName} 파싱 실패`, true); }
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  const handleSave = () => {
    const state = { title, portfolio, principal, history, depositHistory, depositHistory2, customLinks, settings, lookupRows, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, portfolioStartDate, compStocks, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate } };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `백업_ ${yy}-${mo}-${dd}_${hh},${mi},${ss}.json`; a.click();
  };

  const handleLoad = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.portfolio) {
          setTitle(data.title || "복구된 계좌"); setPortfolio(data.portfolio); setPrincipal(cleanNum(data.principal));
          setHistory(data.history || []); setDepositHistory(data.depositHistory || []);
          if (data.depositHistory2) setDepositHistory2(data.depositHistory2);
          setLookupRows(data.lookupRows || []); setCustomLinks(data.customLinks || UI_CONFIG.DEFAULT_LINKS);
          setStockHistoryMap(data.stockHistoryMap || {}); setCompStocks(data.compStocks || defaultCompStocks);
          if (data.marketIndices) {
            setMarketIndices(data.marketIndices);
            setIndexFetchStatus({
              kospi: data.marketIndices.kospi ? buildIndexStatus(data.marketIndices.kospi, '백업파일') : null,
              sp500: data.marketIndices.sp500 ? buildIndexStatus(data.marketIndices.sp500, '백업파일') : null,
              nasdaq: data.marketIndices.nasdaq ? buildIndexStatus(data.marketIndices.nasdaq, '백업파일') : null,
            });
          }
          if (data.portfolioStartDate) setPortfolioStartDate(data.portfolioStartDate);
          if (data.chartPrefs) {
            if (data.chartPrefs.showKospi !== undefined) setShowKospi(data.chartPrefs.showKospi);
            if (data.chartPrefs.showSp500 !== undefined) setShowSp500(data.chartPrefs.showSp500);
            if (data.chartPrefs.showNasdaq !== undefined) setShowNasdaq(data.chartPrefs.showNasdaq);
            if (data.chartPrefs.isZeroBaseMode !== undefined) setIsZeroBaseMode(data.chartPrefs.isZeroBaseMode);
            if (data.chartPrefs.showTotalEval !== undefined) setShowTotalEval(data.chartPrefs.showTotalEval);
            if (data.chartPrefs.showReturnRate !== undefined) setShowReturnRate(data.chartPrefs.showReturnRate);
          }
          if (data.marketIndicators) setMarketIndicators(data.marketIndicators);
        if (data.indicatorHistoryMap) setIndicatorHistoryMap(data.indicatorHistoryMap);
          setStockFetchStatus({});
          showToast("데이터 복원 완료");
        }
      } catch (err) { showToast("파일 형식이 올바르지 않습니다.", true); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const handleDownloadCSV = () => {
    let csv = '\uFEFF일자,평가자산,전일대비 수익금,전일대비 수익률\n';
    const sh = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
    sh.forEach((h, i) => {
      const prev = sh[i + 1];
      const dodProfit = prev ? h.evalAmount - prev.evalAmount : 0;
      const dodRate = (prev && prev.evalAmount > 0) ? ((h.evalAmount / prev.evalAmount) - 1) * 100 : 0;
      csv += `${h.date},${h.evalAmount},${dodProfit},${dodRate.toFixed(2)}%\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `ISA_자산추이_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  const handleLookupDownloadCSV = () => {
    const modeText = comparisonMode === 'latestOverPast' ? '(현재/과거)-1 (%)' : '1- (과거/현재) (%)';
    let csv = `\uFEFF일자,평가자산,${modeText}\n`;
    const currentTotalEval = totals.totalEval;
    const validRecords = lookupRows.map(r => history.find(h => h.date === r.date)).filter(Boolean);
    let oldestEval = 0;
    if (validRecords.length > 0) oldestEval = validRecords.reduce((min, curr) => new Date(curr.date) < new Date(min.date) ? curr : min).evalAmount;
    [...lookupRows].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(row => {
      const rec = history.find(h => h.date === row.date);
      if (rec) {
        const pastEval = rec.evalAmount;
        let compareRate = comparisonMode === 'latestOverPast'
          ? (oldestEval > 0 ? ((pastEval / oldestEval) - 1) * 100 : 0)
          : (currentTotalEval > 0 ? (1 - (pastEval / currentTotalEval)) * 100 : 0);
        csv += `${row.date},${pastEval},${compareRate.toFixed(2)}%\n`;
      } else { csv += `${row.date},기록 없음,-\n`; }
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `ISA_지정일비교_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  const handleDepositDownloadCSV = () => {
    let csv = '\uFEFF일자,금액,합계,메모\n';
    depositWithSum.forEach(h => { csv += `${h.date},${cleanNum(h.amount)},${cleanNum(h.cumulative)},${h.memo || ''}\n`; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `입금내역_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  const handleWithdrawDownloadCSV = () => {
    let csv = '\uFEFF일자,금액,합계,메모\n';
    depositWithSum2.forEach(h => { csv += `${h.date},${cleanNum(h.amount)},${cleanNum(h.cumulative)},${h.memo || ''}\n`; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `출금내역_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  const calculateSelection = (left, right) => {
    if (!left || !right) return null;
    const idx1 = finalChartData.findIndex(d => d.date === left);
    const idx2 = finalChartData.findIndex(d => d.date === right);
    if (idx1 === -1 || idx2 === -1 || idx1 === idx2) return null;
    const sData = finalChartData[Math.min(idx1, idx2)];
    const eData = finalChartData[Math.max(idx1, idx2)];
    const profit = eData.evalAmount - sData.evalAmount;
    const rate = sData.evalAmount > 0 ? (profit / sData.evalAmount) * 100 : 0;
    return {
      startDate: sData.date, endDate: eData.date, profit, rate,
      kospiPeriodRate: ((1 + eData.kospiRate / 100) / (1 + sData.kospiRate / 100) - 1) * 100,
      sp500PeriodRate: ((1 + eData.sp500Rate / 100) / (1 + sData.sp500Rate / 100) - 1) * 100,
      nasdaqPeriodRate: ((1 + eData.nasdaqRate / 100) / (1 + sData.nasdaqRate / 100) - 1) * 100
    };
  };

  const handleChartMouseDown = (e) => { if (e?.activeLabel) { setIsDragging(true); setRefAreaLeft(e.activeLabel); setRefAreaRight(''); setSelectionResult(null); } };
  const handleChartMouseMove = (e) => { if (isDragging && refAreaLeft && e?.activeLabel) { setRefAreaRight(e.activeLabel); setSelectionResult(calculateSelection(refAreaLeft, e.activeLabel)); } };
  const handleChartMouseUp = () => { setIsDragging(false); if (refAreaLeft && refAreaRight && refAreaLeft !== refAreaRight) setSelectionResult(calculateSelection(refAreaLeft, refAreaRight)); else { setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); } };
  const handleSearchClick = () => { setChartPeriod('custom'); setAppliedRange({ start: dateRange.start, end: dateRange.end }); };

  const handleAskAI = async () => {
    if (!aiQuery.trim()) return;
    setIsAiLoading(true); setAiResponse("");
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: "투자 비서로서 답변하세요: " + aiQuery }] }] }) });
      const data = await res.json();
      setAiResponse(data.candidates?.[0]?.content?.parts?.[0]?.text || "답변을 가져올 수 없습니다.");
    } catch (e) { setAiResponse("통신 오류 발생"); }
    setIsAiLoading(false);
  };

  // 초기 로드 후 종목 현재가를 직접 조회하는 함수 (React 상태 클로저 무관)
  const autoRefreshStockPrices = async (loadedPortfolio) => {
    const stocks = loadedPortfolio.filter(p => p.type === 'stock' && p.code);
    if (stocks.length === 0) return;
    
    setIsLoading(true);
    const loadingStatus = {};
    stocks.forEach(p => { loadingStatus[p.code] = 'loading'; });
    setStockFetchStatus(prev => ({ ...prev, ...loadingStatus }));

    const today = new Date().toISOString().split('T')[0];
    const priceResults = {};

    await Promise.all(stocks.map(async (item) => {
      const d = await fetchStockInfo(item.code);
      if (d) {
        setStockFetchStatus(prev => ({ ...prev, [item.code]: 'success' }));
        setStockHistoryMap(prev => ({ ...prev, [item.code]: { ...(prev[item.code] || {}), [today]: d.price } }));
        priceResults[item.code] = d;
      } else {
        setStockFetchStatus(prev => ({ ...prev, [item.code]: 'fail' }));
      }
    }));

    // 함수형 업데이트로 안전하게 portfolio 갱신
    if (Object.keys(priceResults).length > 0) {
      setPortfolio(prev => prev.map(item => {
        if (item.type === 'stock' && item.code && priceResults[item.code]) {
          const d = priceResults[item.code];
          return { ...item, name: d.name, currentPrice: d.price, changeRate: d.changeRate };
        }
        return item;
      }));
      showToast(`전체 종목 현재가 갱신 완료 (${Object.keys(priceResults).length}건)`);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      // 1단계: GSheet에서 종목 데이터 로드
      let loadedPortfolio = await loadFromGSheet();
      
      // GSheet 실패 시 localStorage 폴백
      if (!loadedPortfolio) {
        const saved = localStorage.getItem('portfolioState_v5');
        if (saved) {
          try {
            const data = JSON.parse(saved);
            setTitle(data.title || "포트폴리오"); setPortfolio(data.portfolio || []); setPrincipal(cleanNum(data.principal));
            setHistory(data.history || []); setDepositHistory(data.depositHistory || []);
            if (data.depositHistory2) setDepositHistory2(data.depositHistory2);
            setCustomLinks(data.customLinks || UI_CONFIG.DEFAULT_LINKS); setSettings(data.settings || { mode: 'rebalance', amount: 1000000 });
            setLookupRows(data.lookupRows || []); setStockHistoryMap(data.stockHistoryMap || {});
            setCompStocks(data.compStocks || defaultCompStocks);
            if (data.marketIndices) {
              setMarketIndices(data.marketIndices);
              setIndexFetchStatus({
                kospi: data.marketIndices.kospi ? buildIndexStatus(data.marketIndices.kospi, 'localStorage') : null,
                sp500: data.marketIndices.sp500 ? buildIndexStatus(data.marketIndices.sp500, 'localStorage') : null,
                nasdaq: data.marketIndices.nasdaq ? buildIndexStatus(data.marketIndices.nasdaq, 'localStorage') : null,
              });
            }
            if (data.portfolioStartDate) setPortfolioStartDate(data.portfolioStartDate);
            else if (data.history?.length > 0) setPortfolioStartDate(data.history[0].date);
            if (data.chartPrefs) {
              if (data.chartPrefs.showKospi !== undefined) setShowKospi(data.chartPrefs.showKospi);
              if (data.chartPrefs.showSp500 !== undefined) setShowSp500(data.chartPrefs.showSp500);
              if (data.chartPrefs.showNasdaq !== undefined) setShowNasdaq(data.chartPrefs.showNasdaq);
              if (data.chartPrefs.isZeroBaseMode !== undefined) setIsZeroBaseMode(data.chartPrefs.isZeroBaseMode);
              if (data.chartPrefs.showTotalEval !== undefined) setShowTotalEval(data.chartPrefs.showTotalEval);
              if (data.chartPrefs.showReturnRate !== undefined) setShowReturnRate(data.chartPrefs.showReturnRate);
            }
            if (data.marketIndicators) setMarketIndicators(data.marketIndicators);
        if (data.indicatorHistoryMap) setIndicatorHistoryMap(data.indicatorHistoryMap);
            loadedPortfolio = data.portfolio || [];
            showToast('📦 로컬 데이터에서 복원');
          } catch (e) {}
        }
      }

      setTimeout(() => { isInitialLoad.current = false; }, 15000);

      // 2단계: 시장지표 자동 수집 (Apps Script 프록시 우선)
      fetchMarketIndicators();

      // 3단계: 로드된 portfolio를 직접 전달하여 종목 현재가 자동 조회
      if (loadedPortfolio && loadedPortfolio.length > 0) {
        autoRefreshStockPrices(loadedPortfolio);
      }
    };
    init();
  }, []);

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

  // 20분(1,200,000ms)마다 자동으로 현재가 + 시장지표 갱신 후 GSheet 백업
  useEffect(() => {
    const AUTO_REFRESH_INTERVAL = 20 * 60 * 1000; // 20분
    const intervalId = setInterval(() => {
      // portfolio가 있을 때만 실행
      if (portfolioRef.current.length > 0 && portfolioRef.current.some(p => p.type === 'stock' && p.code)) {
        console.log('[자동갱신] 20분 주기 현재가 + 시장지표 갱신 시작');
        refreshPrices();
        fetchMarketIndicators();
      }
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (portfolio.length === 0) return;
    const state = { title, portfolio, principal, history, depositHistory, depositHistory2, customLinks, settings, lookupRows, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, portfolioStartDate, compStocks, chartPrefs: { showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate } };
    localStorage.setItem('portfolioState_v5', JSON.stringify(state));

    // Google Sheets 자동저장 (5초 디바운스)
    if (!isInitialLoad.current) {
      if (gsheetTimer.current) clearTimeout(gsheetTimer.current);
      gsheetTimer.current = setTimeout(() => saveToGSheet(state), 5000);
    }
  }, [title, portfolio, principal, history, depositHistory, depositHistory2, customLinks, settings, lookupRows, stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, portfolioStartDate, compStocks, showKospi, showSp500, showNasdaq, isZeroBaseMode, showTotalEval, showReturnRate]);

  useEffect(() => {
    if (totals.totalEval === 0) return;
    const today = new Date().toISOString().split('T')[0];
    setHistory(prev => {
      const newHist = [...prev];
      const idx = newHist.findIndex(h => h.date === today);
      if (idx >= 0) { if (newHist[idx].evalAmount === totals.totalEval) return prev; newHist[idx] = { ...newHist[idx], evalAmount: totals.totalEval, principal }; }
      else { newHist.push({ date: today, evalAmount: totals.totalEval, principal, isFixed: false }); }
      return newHist;
    });
  }, [totals.totalEval, principal]);

  useEffect(() => {
    if (unifiedDates.length === 0) return;
    const latest = unifiedDates[unifiedDates.length - 1];
    const earliest = unifiedDates[0];
    let newStart = latest;
    if (chartPeriod === '1w') { const d = new Date(latest); d.setDate(d.getDate() - 7); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '1m') { const d = new Date(latest); d.setMonth(d.getMonth() - 1); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '3m') { const d = new Date(latest); d.setMonth(d.getMonth() - 3); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '6m') { const d = new Date(latest); d.setMonth(d.getMonth() - 6); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === '1y') { const d = new Date(latest); d.setFullYear(d.getFullYear() - 1); newStart = d.toISOString().split('T')[0]; }
    else if (chartPeriod === 'all') { newStart = earliest; }
    if (chartPeriod !== 'custom') {
      if (new Date(newStart) < new Date(earliest)) newStart = earliest;
      setDateRange({ start: newStart, end: latest }); setAppliedRange({ start: newStart, end: latest });
    }
  }, [chartPeriod, unifiedDates]);

  useEffect(() => {
    const handler = (e) => { if (!e.target.closest('.chart-container-for-drag')) { setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); } };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  const StatusDot = ({ status }) => {
    if (!status) return <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block ml-1" title="미수집" />;
    if (status.status === 'loading') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-1 animate-pulse" title="수집중" />;
    if (status.status === 'success') return <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block ml-1" title={`수집완료 | ${status.latestDate} | ${status.count}건`} />;
    if (status.status === 'partial') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-1" title={`${status.source === '백업데이터' ? '백업데이터' : status.source} | ${status.latestDate} | ${status.count}건`} />;
    return <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block ml-1" title="수집실패" />;
  };

  const CompStockDot = ({ code }) => {
    const st = stockFetchStatus?.[code];
    if (!st) return null;
    if (st === 'success') return <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block ml-0.5" title="갱신 완료" />;
    if (st === 'fail') return <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block ml-0.5" title="갱신 실패" />;
    if (st === 'loading') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-0.5 animate-pulse" title="갱신 중" />;
    return null;
  };

  return (
    <div className="bg-gray-900 min-h-screen text-gray-200 p-2 md:p-6 lg:p-8 font-sans text-sm relative">
      <style dangerouslySetInnerHTML={{ __html: `html, body, #root { width: 100% !important; margin: 0 !important; padding: 0 !important; } input[type="date"] { color-scheme: dark; }` }} />
      {globalToast.text && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-xl shadow-2xl z-[100] font-bold text-white border transition-all duration-300 max-w-lg text-center ${globalToast.isError ? 'bg-red-900/90 border-red-500' : 'bg-blue-600/90 border-blue-400'}`}>{globalToast.text}</div>
      )}
      
      {/* 에러 팝업 모달 */}
      {errorModalContent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[300] animate-in fade-in backdrop-blur-sm">
          <div className="bg-[#1e293b] rounded-xl w-full max-w-md border border-red-900/50 shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-red-950/50 p-4 border-b border-red-900 flex justify-between items-center">
              <span className="text-red-400 font-extrabold flex items-center gap-2">⚠️ {errorModalContent.title}</span>
              <button onClick={() => setErrorModalContent(null)} className="text-gray-400 hover:text-white transition-colors p-1"><X size={18} /></button>
            </div>
            <div className="p-6 text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">
              {errorModalContent.message}
            </div>
            <div className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-end">
              <button onClick={() => setErrorModalContent(null)} className="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-[2560px] mx-auto flex flex-col gap-6 px-2">
        <Header title={title} setTitle={setTitle} isLoading={isLoading} gsheetStatus={gsheetStatus} customLinks={customLinks} setCustomLinks={setCustomLinks} onRefresh={refreshPrices} onSave={handleSave} onLoad={handleLoad} onPaste={() => setIsPasteModalOpen(true)} onAddStock={handleAddStock} onImportHistory={handleImportHistoryJSON} isLinkSettingsOpen={isLinkSettingsOpen} setIsLinkSettingsOpen={setIsLinkSettingsOpen} fileInputRef={fileInputRef} historyInputRef={historyInputRef} />

        <PortfolioTable portfolio={totals.calcPortfolio} totals={totals} sortConfig={sortConfig} onSort={handleSort} onUpdate={handleUpdate} onBlur={handleStockBlur} onDelete={handleDeleteStock} stockFetchStatus={stockFetchStatus} onSingleRefresh={handleSingleStockRefresh} />

        <div className="grid grid-cols-1 xl:grid-cols-12 lg:grid-cols-12 gap-6 w-full items-stretch">
          <div className="xl:col-span-4 lg:col-span-12 bg-[#1e293b] rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col h-full">
            <div className="p-3 bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700">📊 자산 비중</div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-800 text-gray-400 font-bold border-b border-gray-700"><tr className="text-center"><th className="p-3 border-r border-gray-700">구분</th><th className="p-3 border-r border-gray-700 text-blue-300">투자</th><th className="p-3 border-r border-gray-700 text-yellow-400">평가</th><th className="p-3">수익률</th></tr></thead>
                <tbody>{Object.entries(totals.cats).map(([c, d]) => (<tr key={c} className="border-b border-gray-700 hover:bg-gray-800 transition-colors"><td className={`p-3 text-center align-middle font-bold border-r border-gray-700 ${UI_CONFIG.COLORS.CATEGORIES[c]}`}>{c}</td><td className="py-2 px-3 border-r border-gray-700 align-middle"><div className="flex flex-col items-end justify-center"><span className="whitespace-nowrap">{formatPercent(totals.totalInvest > 0 ? (d.invest / totals.totalInvest) * 100 : 0)}</span><span className="text-[11px] text-gray-400 whitespace-nowrap">{formatCurrency(d.invest)}</span></div></td><td className="py-2 px-3 border-r border-gray-700 font-bold text-yellow-400 align-middle"><div className="flex flex-col items-end justify-center"><span className="whitespace-nowrap">{formatPercent(totals.totalEval > 0 ? (d.eval / totals.totalEval) * 100 : 0)}</span><span className="text-[11px] text-gray-400 whitespace-nowrap">{formatCurrency(d.eval)}</span></div></td><td className={`p-3 align-middle font-bold ${d.profit >= 0 ? 'text-red-400' : 'text-blue-400'} whitespace-nowrap`}>{formatPercent(d.invest > 0 ? d.profit / d.invest * 100 : 0)}</td></tr>))}</tbody>
              </table>
            </div>
          </div>
          <div className="xl:col-span-8 lg:col-span-12 bg-[#1e293b] rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col h-full min-h-[400px]">
            <div className="flex bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700 divide-x divide-gray-700"><div className="p-3 flex-1 text-center">📊 자산 비중</div><div className="p-3 flex-1 text-center text-blue-400">📈 종목별 비중</div></div>
            <div className="p-4 flex-1 flex flex-col sm:flex-row items-center gap-4"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={Object.entries(totals.cats).map(([n, d]) => ({ name: n, value: d.eval })).filter(x => x.value > 0)} innerRadius="40%" outerRadius="70%" dataKey="value" label={PieLabelOutside}>{Object.entries(totals.cats).map((_, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}</Pie><RechartsTooltip content={<CustomChartTooltip total={totals.totalEval} />} /></PieChart></ResponsiveContainer><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={totals.stks.filter(x => x.eval > 0)} innerRadius="40%" outerRadius="70%" dataKey="eval" label={PieLabelOutside}>{totals.stks.map((_, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CHART_PALETTE[(i + 3) % 8]} />)}</Pie><RechartsTooltip content={<CustomChartTooltip total={totals.totalEval} />} /></PieChart></ResponsiveContainer></div>
          </div>
        </div>

        <div className="flex flex-col xl:flex-row gap-4 w-full items-stretch">
          <div className="w-full xl:w-[18%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden shrink-0">
            <div className="p-3 bg-black space-y-2 shrink-0 border-b border-gray-700 text-gray-400 text-xs">
              <div className="flex justify-between"><span className="shrink-0">투자금액</span><span className="font-bold text-gray-200 whitespace-nowrap pl-1">{formatCurrency(totals.totalInvest)}</span></div>
              <div className="flex justify-between"><span className="shrink-0">평가금액</span><span className="font-bold text-yellow-400 text-[13px] whitespace-nowrap pl-1">{formatCurrency(totals.totalEval)}</span></div>
              <div className="flex justify-between"><span className="shrink-0">수익률</span><span className="font-bold text-white text-[13px] whitespace-nowrap pl-1">{formatPercent(totals.totalInvest > 0 ? (totals.totalProfit / totals.totalInvest) * 100 : 0)}</span></div>
            </div>
            <div className="flex-1 flex flex-col">
              <div className="flex h-auto py-1.5 border-b border-gray-700"><div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0"><span className="text-[11px] text-gray-400 font-bold">시작일</span></div><div className="flex-1 p-2 flex items-center bg-gray-800/20"><input type="date" value={portfolioStartDate} onChange={e => setPortfolioStartDate(e.target.value)} className="bg-transparent text-gray-200 font-bold outline-none cursor-text text-right w-full text-xs" /></div></div>
              <div className="flex h-auto py-1.5 border-b border-gray-700"><div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0"><span className="text-[11px] text-gray-400 font-bold">입금액</span></div><div className="flex-1 p-2 flex items-center bg-gray-800/20"><input type="text" className="w-full bg-gray-900/60 border border-gray-700/60 rounded text-right text-gray-400 font-bold outline-none px-2 py-1.5 text-xs" placeholder="Enter to apply" onKeyDown={e => { if (e.key === 'Enter') { const v = cleanNum(e.target.value); setPrincipal(p => p + v); setDepositHistory([{ id: generateId(), date: new Date().toISOString().split('T')[0], amount: v, memo: "수동입금" }, ...depositHistory]); e.target.value = ""; } }} /></div></div>
              <div className="flex h-[50px] border-b border-gray-700 shrink-0"><div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0"><span className="text-[11px] text-gray-400 font-bold">투자 원금</span></div><div className="flex-1 p-2 flex items-center bg-gray-800/20"><input type="text" className="w-full bg-gray-900/60 border border-gray-700/60 rounded text-right text-white font-bold outline-none px-2 py-1 text-xs" value={formatNumber(principal)} onChange={e => setPrincipal(cleanNum(e.target.value))} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} /></div></div>
              <div className="flex h-auto py-1.5 border-b border-gray-700"><div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0"><span className="text-[11px] text-gray-400 font-bold" title="연평균 성장률(CAGR)">CAGR</span></div><div className="flex-1 p-2 flex items-center justify-end bg-gray-800/20"><span className="font-bold text-blue-300 text-sm">{formatPercent(cagr)}</span></div></div>
              <div className="flex flex-1 min-h-[80px]"><div className="w-[70px] bg-gray-800/50 flex flex-col items-center justify-center border-r border-gray-700 gap-2 shrink-0"><span className="text-[11px] text-gray-400 font-bold">수익률</span><span className="text-[11px] text-gray-400 font-bold">수익금</span></div><div className="flex-1 flex flex-col items-center justify-center bg-gray-900/40 gap-1 p-2 overflow-hidden"><span className={`text-[24px] font-extrabold leading-none tracking-wide whitespace-nowrap ${totals.totalEval - principal >= 0 ? 'text-red-500' : 'text-blue-500'}`}>{formatPercent(principal > 0 ? (totals.totalEval - principal) / principal * 100 : 0)}</span><span className={`text-[14px] font-bold tracking-wide whitespace-nowrap ${totals.totalEval - principal >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatCurrency(totals.totalEval - principal)}</span></div></div>
            </div>
          </div>

          <div className="w-full xl:w-[26%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden shrink-0">
            <div className="p-3 bg-[#0f172a] text-white font-bold flex justify-between items-center text-sm border-b border-gray-700 shrink-0">
              <span>📈 자산 평가액 추이</span>
              <div className="flex items-center gap-1">
                <button onClick={() => { const today = new Date().toISOString().split('T')[0]; setHistory(prev => { const todayEntry = prev.find(h => h.date === today); return todayEntry ? [todayEntry] : (totals.totalEval > 0 ? [{ date: today, evalAmount: totals.totalEval, principal, isFixed: false }] : []); }); showToast("평가 기록 리셋 완료 (오늘 데이터만 유지)"); }} className="p-1 hover:bg-gray-800 rounded transition text-orange-400 hover:text-white" title="평가 기록 리셋 (오늘만 유지)"><Trash2 size={14} /></button>
                <button onClick={handleDownloadCSV} className="p-1 hover:bg-gray-800 rounded transition text-blue-400 hover:text-white" title="전체 엑셀 다운로드"><Download size={14} /></button>
              </div>
            </div>
            <div className="shrink-0 h-[140px] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-max text-right text-[13px] table-auto border-collapse whitespace-nowrap">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal">평가자산</th>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal cursor-help" title="수식: (당일/전일)-1">전일대비</th>
                    <th className="py-2 px-2 text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setHistoryLimit(p => p + 5)} className="text-gray-400 hover:text-white"><Plus size={12} /></button>
                        <button onClick={() => setHistoryLimit(p => Math.max(p - 5, 3))} className="text-gray-400 hover:text-white"><Minus size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayHistSliced.map((h, i) => {
                    const prev = sortedHistoryDesc[sortedHistoryDesc.indexOf(h) + 1];
                    const dod = (prev && prev.evalAmount > 0) ? ((h.evalAmount / prev.evalAmount) - 1) * 100 : 0;
                    return (
                      <tr key={h.id || i} className={`border-b border-gray-700 ${h.date === new Date().toISOString().split('T')[0] ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                        <td className="py-2 px-3 text-center border-r border-gray-600 font-bold text-gray-400">{formatShortDate(h.date)}</td>
                        <td className="py-2 px-3 border-r border-gray-600 font-bold text-white text-right">{formatCurrency(h.evalAmount)}</td>
                        <td className="py-2 px-3 border-r border-gray-600 text-center font-bold"><span className={dod > 0 ? 'text-red-400' : dod < 0 ? 'text-blue-400' : 'text-gray-500'}>{formatPercent(dod)}</span></td>
                        <td className="py-2 px-2 text-center"><button onClick={() => { setLookupRows([{ id: generateId(), date: h.date }, ...lookupRows]); showToast("조회 목록 복사"); }} className="text-blue-400"><ArrowDownToLine size={12} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-y border-gray-700 bg-[#0f172a] flex justify-start items-center shrink-0 shadow-sm z-20">
              <span className="text-xs text-white font-bold select-none tracking-widest">지정일 자산추이</span>
            </div>
            <div className="flex-1 overflow-x-auto overflow-y-auto bg-[#1e293b]">
              <table className="w-full min-w-max text-right text-[13px] table-auto border-collapse whitespace-nowrap">
                <thead className="bg-[#1e293b] text-gray-500 border-b border-gray-700/50 sticky top-0 z-10">
                  <tr>
                    <th className="py-1.5 px-3 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-1.5 px-3 border-r border-gray-700 text-center font-normal">평가자산</th>
                    <th className="py-1.5 px-3 border-r border-gray-700 text-center font-normal cursor-help" title={comparisonMode === 'latestOverPast' ? '(현재/과거)-1 (%)' : '1- (과거/현재) (%)'}>
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setComparisonMode('latestOverPast')} className={`p-0.5 rounded transition-colors ${comparisonMode === 'latestOverPast' ? 'text-blue-400 bg-blue-900/30' : 'text-gray-600 hover:text-gray-400'}`} title="(현재/과거)-1 (%)"><Triangle size={10} fill={comparisonMode === 'latestOverPast' ? "currentColor" : "none"} /></button>
                        <button onClick={() => setComparisonMode('pastOverLatest')} className={`p-0.5 rounded transition-colors ${comparisonMode === 'pastOverLatest' ? 'text-red-400 bg-red-900/30' : 'text-gray-600 hover:text-gray-400'}`} title="1- (과거/현재) (%)"><Triangle size={10} className="rotate-180" fill={comparisonMode === 'pastOverLatest' ? "currentColor" : "none"} /></button>
                      </div>
                    </th>
                    <th className="py-1.5 px-2 text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setLookupRows(prev => [{ id: generateId(), date: "" }, ...prev])} className="text-blue-400 hover:text-white transition-colors" title="빈 조회 행 맨 위 추가"><Plus size={12} /></button>
                        <button onClick={handleLookupDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="이 표 엑셀 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const currentTotalEval = totals.totalEval;
                    return lookupRows.length === 0 ? (
                      <tr><td colSpan="4" className="py-6 text-center text-gray-500 font-bold bg-gray-800/20">지정일 데이터가 없습니다.<br /><span className="text-[10px] font-normal mt-1 inline-block text-gray-600">위 표의 추가 아이콘을 눌러주세요.</span></td></tr>
                    ) : (
                      lookupRows.slice().sort((a, b) => {
                        const tA = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER;
                        const tB = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER;
                        return tB - tA;
                      }).map((row) => {
                        const lookupRecord = history.find(h => h.date === row.date);
                        return (
                          <tr key={row.id} className="bg-gray-800/60 border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors">
                            <td className="py-1 px-2 text-center border-r border-gray-700 align-middle">
                              <input type="date" className="w-full max-w-[120px] bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-xs text-gray-300 outline-none focus:border-blue-500 transition-colors cursor-pointer mx-auto block" value={row.date || ''} onChange={e => setLookupRows(lookupRows.map(r => r.id === row.id ? { ...r, date: e.target.value } : r))} />
                            </td>
                            {lookupRecord ? (() => {
                              const validRecords = lookupRows.map(r => history.find(h => h.date === r.date)).filter(Boolean);
                              let oldestEval = 0;
                              if (validRecords.length > 0) oldestEval = validRecords.reduce((min, curr) => new Date(curr.date) < new Date(min.date) ? curr : min).evalAmount;
                              const pastEval = lookupRecord.evalAmount;
                              let compareRate = comparisonMode === 'latestOverPast'
                                ? (oldestEval > 0 ? ((pastEval / oldestEval) - 1) * 100 : 0)
                                : (currentTotalEval > 0 ? (1 - (pastEval / currentTotalEval)) * 100 : 0);
                              return (
                                <>
                                  <td className="py-1.5 px-3 border-r border-gray-600 font-bold text-white text-right">{formatCurrency(pastEval)}</td>
                                  <td className="py-1.5 px-3 border-r border-gray-600 text-center font-bold"><span className={compareRate >= 0 ? 'text-red-400' : 'text-blue-400'}>{formatPercent(compareRate)}</span></td>
                                </>
                              );
                            })() : (<td colSpan="2" className="py-1.5 px-3 text-center text-gray-500 font-bold border-r border-gray-700">기록 없음</td>)}
                            <td className="py-1.5 px-2 text-center"><button onClick={() => setLookupRows(lookupRows.filter(r => r.id !== row.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                          </tr>
                        );
                      })
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* 입금 내역 */}
          <div className="flex-1 w-full bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden">
            <div className="p-2 bg-[#0f172a] text-white font-bold flex items-center text-xs border-b border-gray-700 shrink-0"><span>💰 입금 내역</span></div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-right text-[11px] table-fixed">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-2.5 w-[70px] text-center border-r border-gray-600 font-normal cursor-pointer hover:bg-gray-700" onClick={() => handleDepositSort('date')}>일자{sortArrow(depositSortConfig, 'date')}</th>
                    <th className="py-2.5 border-r border-gray-600 px-1 w-[80px] text-blue-300 font-normal text-center cursor-pointer hover:bg-gray-700" onClick={() => handleDepositSort('amount')}>금액{sortArrow(depositSortConfig, 'amount')}</th>
                    <th className="py-2.5 border-r border-gray-600 px-1 w-[90px] text-yellow-400 font-normal text-center">합계</th>
                    <th className="py-2.5 border-r border-gray-600 text-center px-2 font-normal">메모</th>
                    <th className="py-2.5 w-[45px] text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDepositHistory([{ id: generateId(), date: new Date().toISOString().split('T')[0], amount: 0, memo: "" }, ...depositHistory])} className="text-blue-400 hover:text-white transition-colors" title="행 추가"><Plus size={12} /></button>
                        <button onClick={handleDepositDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="입금 내역 CSV 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {depositWithSumSorted.map((h) => (
                    <tr key={h.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2 border-r border-gray-600 align-middle relative">
                        <div className="flex items-center justify-center font-mono text-[10px] text-gray-300 gap-1 pointer-events-none">{formatVeryShortDate(h.date)}<Calendar size={10} className="text-gray-500" /></div>
                        <input type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" value={h.date} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].date = e.target.value; setDepositHistory(n); }} />
                      </td>
                      <td className="p-0 border-r border-gray-600">
                        <input type="text" data-col="d1amount" className={`w-full bg-transparent text-right outline-none font-bold px-1 py-2 ${cleanNum(h.amount) >= 0 ? 'text-blue-300' : 'text-red-300'}`} value={formatNumber(h.amount)} onFocus={e => e.target.select()} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].amount = cleanNum(e.target.value); setDepositHistory(n); }} onKeyDown={e => handleTableKeyDown(e, 'd1amount')} />
                      </td>
                      <td className="py-2 px-1 border-r border-gray-600 text-yellow-400 font-bold text-center">{formatCurrency(h.cumulative)}</td>
                      <td className="p-0 border-r border-gray-600">
                        <input type="text" data-col="d1memo" className="w-full bg-transparent outline-none px-2 py-2 text-gray-300 text-[11px]" value={h.memo} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].memo = e.target.value; setDepositHistory(n); }} onKeyDown={e => handleTableKeyDown(e, 'd1memo')} />
                      </td>
                      <td className="py-2 text-center"><button onClick={() => setDepositHistory(depositHistory.filter(x => x.id !== h.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 출금 내역 */}
          <div className="flex-1 w-full bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden">
            <div className="p-2 bg-[#0f172a] text-white font-bold flex items-center text-xs border-b border-gray-700 shrink-0"><span>💰 출금 내역</span></div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-right text-[11px] table-fixed">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-2.5 w-[70px] text-center border-r border-gray-600 font-normal cursor-pointer hover:bg-gray-700" onClick={() => handleDepositSort2('date')}>일자{sortArrow(depositSortConfig2, 'date')}</th>
                    <th className="py-2.5 border-r border-gray-600 px-1 w-[80px] text-blue-300 font-normal text-center cursor-pointer hover:bg-gray-700" onClick={() => handleDepositSort2('amount')}>금액{sortArrow(depositSortConfig2, 'amount')}</th>
                    <th className="py-2.5 border-r border-gray-600 px-1 w-[90px] text-yellow-400 font-normal text-center">합계</th>
                    <th className="py-2.5 border-r border-gray-600 text-center px-2 font-normal">메모</th>
                    <th className="py-2.5 w-[45px] text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDepositHistory2([{ id: generateId(), date: new Date().toISOString().split('T')[0], amount: 0, memo: "" }, ...depositHistory2])} className="text-blue-400 hover:text-white transition-colors" title="행 추가"><Plus size={12} /></button>
                        <button onClick={handleWithdrawDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="출금 내역 CSV 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {depositWithSum2Sorted.map((h) => (
                    <tr key={h.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2 border-r border-gray-600 align-middle relative">
                        <div className="flex items-center justify-center font-mono text-[10px] text-gray-300 gap-1 pointer-events-none">{formatVeryShortDate(h.date)}<Calendar size={10} className="text-gray-500" /></div>
                        <input type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" value={h.date} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].date = e.target.value; setDepositHistory2(n); }} />
                      </td>
                      <td className="p-0 border-r border-gray-600">
                        <input type="text" data-col="d2amount" className={`w-full bg-transparent text-right outline-none font-bold px-1 py-2 ${cleanNum(h.amount) >= 0 ? 'text-blue-300' : 'text-red-300'}`} value={formatNumber(h.amount)} onFocus={e => e.target.select()} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].amount = cleanNum(e.target.value); setDepositHistory2(n); }} onKeyDown={e => handleTableKeyDown(e, 'd2amount')} />
                      </td>
                      <td className="py-2 px-1 border-r border-gray-600 text-yellow-400 font-bold text-center">{formatCurrency(h.cumulative)}</td>
                      <td className="p-0 border-r border-gray-600">
                        <input type="text" data-col="d2memo" className="w-full bg-transparent outline-none px-2 py-2 text-gray-300 text-[11px]" value={h.memo} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].memo = e.target.value; setDepositHistory2(n); }} onKeyDown={e => handleTableKeyDown(e, 'd2memo')} />
                      </td>
                      <td className="py-2 text-center"><button onClick={() => setDepositHistory2(depositHistory2.filter(x => x.id !== h.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 차트 영역 + 시장 지표 */}
        <div className="flex flex-col xl:flex-row gap-4 w-full mb-10 items-stretch">
          {/* 시장 지표 카드 */}
          <MarketIndicators
            marketIndicators={marketIndicators}
            marketIndices={marketIndices}
            indicatorHistoryMap={indicatorHistoryMap}
            indicatorLoading={indicatorLoading}
            indicatorFetchStatus={indicatorFetchStatus}
            showIndicatorVerify={showIndicatorVerify}
            setShowIndicatorVerify={setShowIndicatorVerify}
            fetchMarketIndicators={fetchMarketIndicators}
            showKospi={showKospi}
            setShowKospi={setShowKospi}
            showSp500={showSp500}
            setShowSp500={setShowSp500}
            showNasdaq={showNasdaq}
            setShowNasdaq={setShowNasdaq}
            showIndicatorsInChart={showIndicatorsInChart}
            setShowIndicatorsInChart={setShowIndicatorsInChart}
            indicatorHistoryLoading={indicatorHistoryLoading}
            fetchIndicatorHistory={fetchIndicatorHistory}
            appliedRange={appliedRange}
            onUploadIndicator={handleIndicatorUpload}
            onFetchAll={fetchAllIndicatorHistory}
          />

          {/* 차트 본체 */}
          <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg flex-1 min-w-0">
            <div className="p-3 bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700 flex flex-col shrink-0 gap-3">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {/* [수정5] 종목비교 컴포넌트를 좌측(대표지수 위치)으로 이동 */}
                  <div className="flex flex-wrap items-center gap-2">
                    {compStocks.map((comp, idx) => {
                      const isFallback = comp.active && stockHistoryMap[comp.code] && Object.keys(stockHistoryMap[comp.code]).length === 1;
                      const activeBorder = idx === 0 ? 'border-emerald-500/50' : idx === 1 ? 'border-cyan-500/50' : 'border-orange-500/50';
                      const activeBg = idx === 0 ? 'bg-emerald-900/50' : idx === 1 ? 'bg-cyan-900/50' : 'bg-orange-900/50';
                      const activeText = idx === 0 ? 'text-emerald-400' : idx === 1 ? 'text-cyan-400' : 'text-orange-400';
                      return (
                        <div key={idx} className={`flex items-center gap-0 rounded-md border shadow-inner overflow-hidden shrink-0 transition-colors ${comp.active ? (isFallback ? 'border-orange-500/50 bg-orange-900/20' : `${activeBorder} ${activeBg}`) : 'border-gray-600 bg-gray-800'}`}>
                          <input type="text" className={`w-[50px] bg-transparent text-[10px] px-2 py-1.5 outline-none text-center font-mono placeholder-gray-500 border-r transition-colors ${comp.active ? (isFallback ? 'border-orange-500/50 text-orange-400' : `${activeBorder} ${activeText}`) : 'border-gray-700 text-blue-300'}`} placeholder="코드" value={comp.code} onChange={e => { const n = [...compStocks]; n[idx].code = e.target.value; setCompStocks(n); }} onBlur={e => handleCompStockBlur(idx, e.target.value)} />
                          <button onClick={() => handleToggleComp(idx)} className={`px-3 py-1.5 text-[10px] font-bold transition-colors min-w-[65px] max-w-[100px] truncate flex justify-center items-center gap-0.5 ${comp.loading ? 'bg-gray-700 text-gray-400 cursor-wait' : comp.active ? (isFallback ? 'text-orange-400' : activeText) : 'bg-transparent text-gray-400 hover:bg-gray-700'}`}>{comp.loading ? '...' : (comp.name || `종목${idx + 1}`)}<CompStockDot code={comp.code} /></button>
                        </div>
                      );
                    })}
                    <button onClick={() => setShowIndexVerify(!showIndexVerify)} className={`px-2 py-1.5 rounded text-[11px] font-bold transition-colors flex items-center gap-1 ml-1 ${showIndexVerify ? 'bg-blue-900/50 text-blue-300 border border-blue-500/50' : 'bg-transparent text-gray-500 hover:bg-gray-700 border border-gray-700'}`} title="지수 데이터 검증">
                      <Search size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 w-full xl:w-auto">
                  <div className="flex items-center bg-gray-800 border border-gray-600 rounded shadow-sm px-1.5 py-1 relative z-30">
                    <div className="relative flex items-center">
                      <span className="text-gray-300 text-xs font-bold font-mono pointer-events-none px-1 w-[68px] text-center">
                        {dateRange.start ? dateRange.start.substring(2).replace(/-/g, '/') : '--/--/--'}
                      </span>
                      <input type="date" value={dateRange.start} onChange={e => { setDateRange(p => ({ ...p, start: e.target.value })); setChartPeriod('custom'); }} className="absolute inset-0 opacity-0 cursor-pointer w-full" />
                    </div>
                    <span className="text-gray-500 mx-0.5">~</span>
                    <div className="relative flex items-center">
                      <span className="text-gray-300 text-xs font-bold font-mono pointer-events-none px-1 w-[68px] text-center">
                        {dateRange.end ? dateRange.end.substring(2).replace(/-/g, '/') : '--/--/--'}
                      </span>
                      <input type="date" value={dateRange.end} onChange={e => { setDateRange(p => ({ ...p, end: e.target.value })); setChartPeriod('custom'); }} className="absolute inset-0 opacity-0 cursor-pointer w-full" />
                    </div>
                    <div className="w-[1px] h-4 bg-gray-600 mx-1.5"></div>
                    <button onClick={handleSearchClick} className="text-blue-400 hover:text-blue-300 hover:bg-gray-700 rounded p-1.5 transition-colors" title="조회">
                      <Search size={14} />
                    </button>
                  </div>
                  <select value={chartPeriod} onChange={e => setChartPeriod(e.target.value)} className="bg-gray-800 text-gray-300 text-xs font-bold border border-gray-600 rounded px-2 py-1.5 outline-none cursor-pointer hover:bg-gray-700 transition-colors shadow-sm"><option value="1w">1주일</option><option value="1m">1개월</option><option value="3m">3개월</option><option value="6m">6개월</option><option value="1y">1년</option><option value="all">전체</option><option value="custom" hidden>직접입력</option></select>
                </div>
              </div>
              <div className="flex justify-end pt-2 border-t border-gray-700/50">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setShowTotalEval(!showTotalEval)} className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 ${showTotalEval ? 'bg-gray-700 text-white shadow-inner border border-gray-500' : 'bg-transparent text-gray-500 border border-gray-700 hover:bg-gray-800'}`}><div className={`w-2 h-2 rounded-sm ${showTotalEval ? 'bg-gray-400 shadow-[0_0_4px_#9ca3af]' : 'bg-gray-600'}`}></div>자산</button>
                  <button onClick={() => setShowReturnRate(!showReturnRate)} className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 ${showReturnRate ? 'bg-red-900/50 text-red-400 border border-red-500/50' : 'bg-transparent text-gray-500 border border-transparent hover:bg-gray-800'}`}><div className={`w-2 h-2 rounded-sm ${showReturnRate ? 'bg-red-500 shadow-[0_0_4px_#ef4444]' : 'bg-gray-600'}`}></div>%</button>
                  <div className="w-[1px] h-3 bg-gray-600 mx-1"></div>
                  <button onClick={() => setShowKospi(!showKospi)} className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 ${showKospi ? 'bg-orange-900/40 text-orange-400 border border-orange-500/50' : 'bg-transparent text-gray-500 border border-gray-700 hover:bg-gray-800'}`} title="KOSPI 주 차트 표시/숨김"><div className={`w-2 h-2 rounded-sm ${showKospi ? 'bg-orange-400 shadow-[0_0_4px_#f97316]' : 'bg-gray-600'}`}></div>K</button>
                  <button onClick={() => setShowSp500(!showSp500)} className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 ${showSp500 ? 'bg-purple-900/40 text-purple-400 border border-purple-500/50' : 'bg-transparent text-gray-500 border border-gray-700 hover:bg-gray-800'}`} title="S&P500 주 차트 표시/숨김"><div className={`w-2 h-2 rounded-sm ${showSp500 ? 'bg-purple-400 shadow-[0_0_4px_#a78bfa]' : 'bg-gray-600'}`}></div>S</button>
                  <button onClick={() => setShowNasdaq(!showNasdaq)} className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 ${showNasdaq ? 'bg-teal-900/40 text-teal-400 border border-teal-500/50' : 'bg-transparent text-gray-500 border border-gray-700 hover:bg-gray-800'}`} title="Nasdaq100 주 차트 표시/숨김"><div className={`w-2 h-2 rounded-sm ${showNasdaq ? 'bg-teal-400 shadow-[0_0_4px_#2dd4bf]' : 'bg-gray-600'}`}></div>N</button>
                  <div className="w-[1px] h-3 bg-gray-600 mx-1"></div>
                  <button onClick={() => setIsZeroBaseMode(!isZeroBaseMode)} className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${isZeroBaseMode ? 'bg-green-900/50 text-green-400 border border-green-500/50 shadow-inner' : 'bg-transparent text-gray-500 hover:bg-gray-800 border border-gray-700'}`} title="조회 시작일을 0% 기준으로 차트 재정렬"><Activity size={14} className={isZeroBaseMode ? 'text-green-400' : 'text-gray-500'} /></button>
                </div>
              </div>

              {showIndexVerify && (
                <div className="mt-2 border-t border-gray-700/50 pt-3 animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                       <span className="text-[11px] text-blue-300 font-bold">📊 지수 및 종목 데이터 검증</span>
                       <span className="text-[10px] text-gray-500">새로고침(🔄) 버튼으로 최신 데이터 수집 | 🟢 정상 🟡 부분/구형 🔴 실패 ⚪ 미수집</span>
                    </div>
                    <button onClick={() => setShowIndexVerify(false)} className="text-gray-500 hover:text-white p-1"><X size={12} /></button>
                  </div>
                  <div className="mb-3 p-2 bg-gray-800/60 rounded-lg border border-gray-700 text-[10px] text-gray-400 leading-relaxed">
                    <span className="text-yellow-400 font-bold">📥 수동 CSV 업로드 방법:</span>
                    <span className="ml-2">주황색 📤 버튼 → CSV 파일 선택. 파일명에 </span>
                    <span className="text-yellow-300 font-bold">KOSPI</span> / <span className="text-purple-300 font-bold">SP500</span> / <span className="text-teal-300 font-bold">NASDAQ</span>
                    <span className="ml-1">포함 필요.</span>
                    <span className="ml-2 text-gray-500">지원형식: 네이버증권 / investing.com / stooq CSV</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] border-collapse min-w-[600px]">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700">
                          <th className="py-1.5 px-3 text-left font-normal">지수/종목</th>
                          <th className="py-1.5 px-3 text-center font-normal">상태</th>
                          <th className="py-1.5 px-3 text-center font-normal">출처</th>
                          <th className="py-1.5 px-3 text-right font-normal">데이터 건수</th>
                          <th className="py-1.5 px-3 text-center font-normal">최신일자</th>
                          <th className="py-1.5 px-3 text-right font-normal">최신값</th>
                          <th className="py-1.5 px-3 text-center font-normal">오늘과의 차이</th>
                          <th className="py-1.5 px-3 text-center font-normal">수집시각</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: 'KOSPI', key: 'kospi', color: 'text-orange-400' },
                          { label: 'S&P500', key: 'sp500', color: 'text-purple-400' },
                          { label: 'NASDAQ', key: 'nasdaq', color: 'text-teal-400' }
                        ].map(({ label, key, color }) => {
                          const st = indexFetchStatus[key];
                          const hasData = marketIndices[key] && Object.keys(marketIndices[key]).length > 0;
                          const actualStatus = st || (hasData ? buildIndexStatus(marketIndices[key], '저장됨') : null);
                          const statusBadge = !actualStatus ? (
                            <span className="text-gray-500">⚪ 미수집</span>
                          ) : actualStatus.status === 'loading' ? (
                            <span className="text-yellow-400 animate-pulse">🔄 수집중</span>
                          ) : actualStatus.status === 'success' ? (
                            <span className="text-green-400">🟢 정상</span>
                          ) : actualStatus.status === 'partial' ? (
                            <span className="text-yellow-400">{actualStatus.source === '백업데이터' ? '🟡 백업데이터' : '🟡 부분'}</span>
                          ) : (
                            <span className="text-red-400">🔴 실패</span>
                          );
                          const gapText = actualStatus?.gapDays != null
                            ? (actualStatus.gapDays === 0 ? '오늘' : actualStatus.gapDays <= 3 ? `${actualStatus.gapDays}일 전 (정상)` : actualStatus.gapDays <= 7 ? `${actualStatus.gapDays}일 전 ⚠️` : `${actualStatus.gapDays}일 전 ❌`)
                            : '-';
                          const gapColor = actualStatus?.gapDays != null
                            ? (actualStatus.gapDays <= 3 ? 'text-green-400' : actualStatus.gapDays <= 7 ? 'text-yellow-400' : 'text-red-400')
                            : 'text-gray-500';
                          return (
                            <tr key={key} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                              <td className={`py-2 px-3 font-bold ${color}`}>{label}</td>
                              <td className="py-2 px-3 text-center">{statusBadge}</td>
                              <td className="py-2 px-3 text-center text-gray-400">{actualStatus?.source || '-'}</td>
                              <td className="py-2 px-3 text-right text-gray-300 font-mono">{actualStatus?.count ? `${actualStatus.count.toLocaleString()}건` : (hasData ? `${Object.keys(marketIndices[key]).length.toLocaleString()}건` : '-')}</td>
                              <td className="py-2 px-3 text-center text-gray-300 font-mono">{actualStatus?.latestDate || (hasData ? Object.keys(marketIndices[key]).sort().pop() : '-')}</td>
                              <td className="py-2 px-3 text-right text-white font-bold font-mono">
                                {actualStatus?.latestValue ? actualStatus.latestValue.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : (hasData ? (() => { const dates = Object.keys(marketIndices[key]).sort(); const v = marketIndices[key][dates[dates.length-1]]; return v ? v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '-'; })() : '-')}
                              </td>
                              <td className={`py-2 px-3 text-center font-bold ${gapColor}`}>{gapText}</td>
                              <td className="py-2 px-3 text-center text-gray-500">{actualStatus?.updatedAt || '-'}</td>
                            </tr>
                          );
                        })}
                        
                        {/* 비교 종목 검증 데이터 추가 */}
                        {compStocks.filter(c => c.code && c.active).map((comp, idx) => {
                           const hist = stockHistoryMap[comp.code];
                           const hasData = hist && Object.keys(hist).length > 0;
                           const actualStatus = hasData ? buildIndexStatus(hist, '종목데이터') : null;
                           
                           const statusBadge = !actualStatus ? (
                            <span className="text-gray-500">⚪ 미수집</span>
                          ) : actualStatus.status === 'success' ? (
                            <span className="text-green-400">🟢 정상</span>
                          ) : actualStatus.status === 'partial' ? (
                            <span className="text-yellow-400">🟡 현재가만</span>
                          ) : (
                            <span className="text-red-400">🔴 실패</span>
                          );
                          const gapText = actualStatus?.gapDays != null
                            ? (actualStatus.gapDays === 0 ? '오늘' : actualStatus.gapDays <= 3 ? `${actualStatus.gapDays}일 전 (정상)` : actualStatus.gapDays <= 7 ? `${actualStatus.gapDays}일 전 ⚠️` : `${actualStatus.gapDays}일 전 ❌`)
                            : '-';
                          const gapColor = actualStatus?.gapDays != null
                            ? (actualStatus.gapDays <= 3 ? 'text-green-400' : actualStatus.gapDays <= 7 ? 'text-yellow-400' : 'text-red-400')
                            : 'text-gray-500';

                           return (
                             <tr key={`comp-${idx}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                              <td className={`py-2 px-3 font-bold text-gray-300`}>{comp.name || comp.code} <span className="text-[9px] text-gray-500 font-mono ml-1">({comp.code})</span></td>
                              <td className="py-2 px-3 text-center">{statusBadge}</td>
                              <td className="py-2 px-3 text-center text-gray-400">{actualStatus?.source || '-'}</td>
                              <td className="py-2 px-3 text-right text-gray-300 font-mono">{actualStatus?.count ? `${actualStatus.count.toLocaleString()}건` : '-'}</td>
                              <td className="py-2 px-3 text-center text-gray-300 font-mono">{actualStatus?.latestDate || '-'}</td>
                              <td className="py-2 px-3 text-right text-white font-bold font-mono">
                                {actualStatus?.latestValue ? actualStatus.latestValue.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '-'}
                              </td>
                              <td className={`py-2 px-3 text-center font-bold ${gapColor}`}>{gapText}</td>
                              <td className="py-2 px-3 text-center text-gray-500">{actualStatus?.updatedAt || '-'}</td>
                            </tr>
                           )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 text-[10px] text-gray-600 flex flex-wrap gap-3">
                    <span>💡 오늘과의 차이가 3일 이하면 정상 | 4~7일: 주의 | 8일 이상: 재수집 필요</span>
                    <span>💾 백업 파일 저장 시 수집된 지수 데이터도 함께 저장됩니다</span>
                    <span>📥 직접 수집 실패 시 Colab 버튼으로 JSON 파일 다운 후 주입 가능</span>
                  </div>
                </div>
              )}
            </div>

            <div className="chart-container-for-drag p-4 h-[400px] relative select-none">
              {selectionResult && (
                <div className="absolute top-4 left-4 bg-gray-900/95 border border-gray-600 rounded-xl px-4 py-2.5 shadow-lg z-20 flex flex-col items-start pointer-events-none transition-all">
                  <span className="text-gray-400 text-[11px] mb-1 font-bold">{formatShortDate(selectionResult.startDate)} ~ {formatShortDate(selectionResult.endDate)}</span>
                  <span className={`text-xl font-black tracking-wide leading-none ${selectionResult.profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{selectionResult.profit > 0 ? '▲' : selectionResult.profit < 0 ? '▼' : ''} {Math.abs(selectionResult.rate).toFixed(2)}%</span>
                  <span className={`text-xs font-bold mt-1 ${selectionResult.profit >= 0 ? 'text-red-300' : 'text-blue-300'}`}>{selectionResult.profit >= 0 ? '+' : '-'}{formatCurrency(Math.abs(selectionResult.profit))}</span>
                  {(showKospi || showSp500 || showNasdaq) && (
                    <div className="mt-2 w-full pt-1.5 border-t border-gray-700 flex flex-col gap-0.5">
                      {showKospi && <div className="flex justify-between items-center gap-4 text-[10px]"><span className="text-yellow-500 font-bold">KOSPI</span><span className={`font-bold ${selectionResult.kospiPeriodRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{selectionResult.kospiPeriodRate > 0 ? '+' : ''}{selectionResult.kospiPeriodRate.toFixed(2)}%</span></div>}
                      {showSp500 && <div className="flex justify-between items-center gap-4 text-[10px]"><span className="text-purple-400 font-bold">S&P500</span><span className={`font-bold ${selectionResult.sp500PeriodRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{selectionResult.sp500PeriodRate > 0 ? '+' : ''}{selectionResult.sp500PeriodRate.toFixed(2)}%</span></div>}
                      {showNasdaq && <div className="flex justify-between items-center gap-4 text-[10px]"><span className="text-teal-400 font-bold">NASDAQ</span><span className={`font-bold ${selectionResult.nasdaqPeriodRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{selectionResult.nasdaqPeriodRate > 0 ? '+' : ''}{selectionResult.nasdaqPeriodRate.toFixed(2)}%</span></div>}
                    </div>
                  )}
                </div>
              )}
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={finalChartData} onMouseDown={handleChartMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp} onMouseLeave={handleChartMouseUp}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#9ca3af" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" stroke="#ef4444" tickFormatter={v => v + '%'} tick={{ fontSize: 10 }} />
                  {showTotalEval && <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" tickFormatter={v => v / 10000 + '만'} tick={{ fontSize: 10 }} />}
                  <RechartsTooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#4b5563', color: '#ffffff', borderRadius: '8px' }} labelFormatter={formatShortDate} formatter={(value, name) => { if (name === '총자산') return [formatNumber(value), name]; return [Number(value).toFixed(2) + '%', name]; }} />
                  {showTotalEval && <Area yAxisId="right" type="monotone" dataKey="evalAmount" name="총자산" fill="rgba(156, 163, 175, 0.1)" stroke="#9ca3af" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />}
                  {showReturnRate && <Area yAxisId="left" type="monotone" dataKey="returnRate" name="수익률" fill="rgba(239, 68, 68, 0.1)" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />}
                  {showKospi && <Line yAxisId="left" type="monotone" dataKey="kospiRate" name="KOSPI" stroke="#f97316" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />}
                  {showSp500 && <Line yAxisId="left" type="monotone" dataKey="sp500Rate" name="S&P500" stroke="#c084fc" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />}
                  {showNasdaq && <Line yAxisId="left" type="monotone" dataKey="nasdaqRate" name="NASDAQ" stroke="#2dd4bf" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />}
                  {showIndicatorsInChart.us10y && indicatorHistoryMap.us10y && <Line yAxisId="left" type="monotone" dataKey="us10yRate" name="US 10Y" stroke="#d1d5db" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {showIndicatorsInChart.goldIntl && indicatorHistoryMap.goldIntl && <Line yAxisId="left" type="monotone" dataKey="goldIntlRate" name="Gold" stroke="#eab308" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {showIndicatorsInChart.usdkrw && indicatorHistoryMap.usdkrw && <Line yAxisId="left" type="monotone" dataKey="usdkrwRate" name="USDKRW" stroke="#60a5fa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {showIndicatorsInChart.dxy && indicatorHistoryMap.dxy && <Line yAxisId="left" type="monotone" dataKey="dxyRate" name="DXY" stroke="#22d3ee" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {showIndicatorsInChart.fedRate && indicatorHistoryMap.fedRate && <Line yAxisId="left" type="monotone" dataKey="fedRateRate" name="기준금리" stroke="#f472b6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {showIndicatorsInChart.kr10y && indicatorHistoryMap.kr10y && <Line yAxisId="left" type="monotone" dataKey="kr10yRate" name="KR 10Y" stroke="#9ca3af" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
                  {compStocks[0]?.active && <Line yAxisId="left" type="monotone" dataKey="comp1Rate" name={compStocks[0].name} stroke="#10B981" strokeWidth={1.5} dot={false} />}
                  {compStocks[1]?.active && <Line yAxisId="left" type="monotone" dataKey="comp2Rate" name={compStocks[1].name} stroke="#06B6D4" strokeWidth={1.5} dot={false} />}
                  {compStocks[2]?.active && <Line yAxisId="left" type="monotone" dataKey="comp3Rate" name={compStocks[2].name} stroke="#FB923C" strokeWidth={1.5} dot={false} />}
                  {refAreaLeft && refAreaRight && <ReferenceArea yAxisId="left" x1={refAreaLeft} x2={refAreaRight} fill="rgba(255, 255, 255, 0.1)" strokeOpacity={0.3} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* 리밸런싱 시뮬레이터 */}
        <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg w-full flex flex-col mb-20">
          <div className="p-5 bg-[#0f172a] border-b border-gray-700 flex flex-col xl:flex-row xl:justify-between xl:items-start gap-4">
            <span className="text-green-400 text-xl font-bold flex items-center gap-2">⚖️ 리밸런싱 & 적립 시뮬레이터</span>
            <div className="flex flex-col gap-3 w-full xl:w-[600px]">
              <div className="flex items-center justify-between bg-gray-800/80 px-4 py-3 rounded-lg border border-gray-700 shadow-inner"><span className="text-gray-300 text-sm font-bold">현재 예수금</span><span className="text-green-400 text-xl font-bold">{formatCurrency(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0)}</span></div>
              <div className="flex items-stretch bg-gray-900 border border-gray-600 rounded-lg overflow-hidden h-12 shadow-sm">
                <select className="bg-gray-800 text-gray-200 text-sm font-bold px-3 border-r border-gray-600 outline-none cursor-pointer" value={settings.mode} onChange={e => setSettings({ ...settings, mode: e.target.value })}><option value="rebalance">리밸런싱 (비중 기반)</option><option value="accumulate">적립 (신규 자금 분할)</option></select>
                <input type="text" className="flex-1 bg-transparent text-right text-white font-bold px-4 outline-none text-lg" value={formatNumber(settings.amount)} onChange={e => setSettings({ ...settings, amount: cleanNum(e.target.value) })} onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto bg-[#0f172a]">
            <table className="w-full text-right text-[13px] table-fixed">
              <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600 font-bold text-center">
                <tr>
                  <th className="py-3 px-3 w-[16%] text-center text-gray-300 cursor-pointer hover:bg-gray-700" onClick={() => handleRebalanceSort('name')}>종목명</th>
                  <th className="py-3 w-[10%] text-gray-400 text-center cursor-pointer hover:bg-gray-700" onClick={() => handleRebalanceSort('curEval')}>현재평가금</th>
                  <th className="py-3 w-[9%] text-gray-500 text-center cursor-pointer hover:bg-gray-700" onClick={() => handleRebalanceSort('currentPrice')}>현재가</th>
                  <th className="py-3 w-[9%] text-green-400 font-bold text-center cursor-pointer hover:bg-gray-700" onClick={() => handleRebalanceSort('targetRatio')}>목표비중(%)</th>
                  <th className="py-3 w-[9%] text-blue-300 text-center cursor-pointer hover:bg-gray-700" onClick={() => handleRebalanceSort('action')}>매수/매도(주)</th>
                  <th className="py-3 w-[10%] text-blue-300 text-center font-normal cursor-pointer hover:bg-gray-700" onClick={() => handleRebalanceSort('cost')}>실 구매비용</th>
                  <th className="py-3 w-[11%] text-yellow-500 text-center font-bold cursor-pointer hover:bg-gray-700" onClick={() => handleRebalanceSort('expEval')}>예상평가금</th>
                  <th className="py-3 w-[9%] text-yellow-500 font-bold text-center cursor-pointer hover:bg-gray-700" onClick={() => handleRebalanceSort('expRatio')}>예상비중</th>
                </tr>
              </thead>
              <tbody>
                {rebalanceData.map(item => (
                  <tr key={item.id} className="border-b border-gray-700 hover:bg-gray-800 transition-colors">
                    <td className="py-3 px-4 text-center text-gray-300 font-bold">{item.name}</td>
                    <td className="py-3 px-3 text-gray-400 text-right">{formatCurrency(item.curEval)}</td>
                    <td className="py-3 px-3 text-gray-500 font-mono text-right">{formatNumber(item.currentPrice)}</td>
                    <td className="p-0 border-r border-gray-700/50">
                      <input type="text" data-col="targetRatio" className="w-full h-full bg-transparent text-center text-green-400 font-bold outline-none py-3 focus:bg-blue-900/20" value={item.targetRatio || 0} onChange={e => handleUpdate(item.id, 'targetRatio', e.target.value)} onFocus={e => e.target.select()} onKeyDown={e => handleTableKeyDown(e, 'targetRatio')} />
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-blue-300">{(item.action > 0 ? '+' : '') + item.action}</td>
                    <td className={`py-3 px-3 font-bold text-right ${item.cost > 0 ? 'text-red-400' : item.cost < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{formatCurrency(item.cost)}</td>
                    <td className="py-3 px-3 font-bold text-yellow-500 text-right">{formatCurrency(item.expEval)}</td>
                    <td className="py-3 px-3 text-center text-yellow-600 font-bold">{item.expRatio.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI Bot */}
        <div className="fixed bottom-6 right-6 z-[200] group">
          <button onClick={() => setAiResponse(aiResponse ? "" : "질문 대기 중...")} className="bg-blue-600 text-white p-4 rounded-full shadow-2xl transition-all scale-110 active:scale-95 border border-blue-400"><BookOpen size={28} /></button>
          {aiResponse && (
            <div className="absolute bottom-20 right-0 w-[420px] bg-[#1e293b] border border-gray-700 rounded-2xl shadow-2xl p-5 animate-in fade-in slide-in-from-bottom-5">
              <div className="flex justify-between items-center mb-4"><span className="font-bold text-blue-400 flex items-center gap-2"><Bot size={18} /> AI 포트폴리오 비서</span><button onClick={() => setAiResponse("")} className="text-gray-500 hover:text-white transition"><X size={20} /></button></div>
              <div className="flex gap-2 mb-4"><input type="text" value={aiQuery} onChange={e => setAiQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAskAI()} className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-blue-500 transition shadow-inner outline-none" placeholder="분석 요청..." /><button onClick={handleAskAI} disabled={isAiLoading} className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-bold border border-blue-500 hover:bg-blue-500 transition">{isAiLoading ? '...' : '질문'}</button></div>
              <div className="max-h-[350px] overflow-y-auto p-4 bg-gray-900/50 rounded-xl text-xs leading-relaxed text-gray-300 border border-gray-700 whitespace-pre-wrap shadow-inner font-light">{aiResponse}</div>
            </div>
          )}
        </div>
      </div>

      {isPasteModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[300] animate-in fade-in backdrop-blur-sm">
          <div className="bg-[#1e293b] p-8 rounded-2xl w-full max-w-2xl border border-gray-600 shadow-2xl text-left">
            <h2 className="text-2xl font-extrabold mb-2 text-white">엑셀 데이터 일괄 추가</h2>
            <div className="text-gray-400 text-xs mb-4 font-semibold leading-relaxed">
              <p className="text-blue-400 mb-1">💡 엑셀 표에서 [종목코드]부터 [보유수량]까지 5개 열을 드래그해서 붙여넣으세요.</p>
              <p className="text-gray-500">(열 순서: 종목코드, 현재가격, 구매단가, 투자금액, 보유수량)</p>
            </div>
            <textarea id="paste-input" rows={8} className="w-full bg-gray-900 border border-gray-600 rounded-xl p-4 text-sm text-white font-mono focus:border-blue-500 transition shadow-inner outline-none" placeholder="005930&#9;199,400&#9;164,022&#9;4,428,600&#9;27"></textarea>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setIsPasteModalOpen(false)} className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition">취소</button>
              <button onClick={() => {
                const text = document.getElementById('paste-input')?.value; if (!text) return;
                const newItems = text.trim().split('\n').map(line => {
                  const cols = line.split('\t');
                  if (cols.length >= 5) return { id: generateId(), type: 'stock', category: '주식', code: cols[0].trim(), name: '', currentPrice: cleanNum(cols[1]), purchasePrice: cleanNum(cols[2]), quantity: cleanNum(cols[4]), targetRatio: 0, isManual: true };
                  return null;
                }).filter(x => x && x.code);
                setPortfolio([...newItems, ...portfolio]); setIsPasteModalOpen(false);
              }} className="px-8 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl font-extrabold shadow-lg border border-green-500 transition">데이터 일괄 추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
