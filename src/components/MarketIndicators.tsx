// @ts-nocheck
import React, { useRef } from 'react';
import { RefreshCw, X, Search, Download, FileUp, DownloadCloud } from 'lucide-react';
import { formatNumber, getIndexLatest } from '../utils';

const INDICATOR_COLORS = {
  kospi: '#38bdf8', sp500: '#bf5af2', nasdaq: '#30d158',
  fedRate: '#ff375f', us10y: '#8e8e93', kr10y: '#636366',
  goldIntl: '#ffd60a', goldKr: '#d97706', usdkrw: '#0a84ff', dxy: '#5ac8fa',
  vix: '#ff453a', btc: '#f7931a', eth: '#627eea',
};

// Yahoo Finance / FRED 자동수집 가능한 키
const STOOQ_SUPPORTED = ['us10y', 'fedRate', 'kr10y', 'goldIntl', 'usdkrw', 'dxy', 'vix', 'btc', 'eth'];
// 차트에 표시 가능한 키
const CHART_INDICATOR_KEYS = ['us10y', 'kr10y', 'goldIntl', 'goldKr', 'usdkrw', 'dxy', 'fedRate', 'vix', 'btc', 'eth'];

// 수집 source 이름 → 실제 출처 URL 매핑
const SOURCE_URLS: Record<string, Record<string, string>> = {
  kospi:   { Naver: 'https://m.stock.naver.com/domestic/index/KOSPI/total' },
  sp500:   { Yahoo: 'https://finance.yahoo.com/quote/%5EGSPC/', Naver: 'https://m.stock.naver.com/worldstock/index/SPI@SPX/total' },
  nasdaq:  { Yahoo: 'https://finance.yahoo.com/quote/%5ENDX/', Naver: 'https://m.stock.naver.com/worldstock/index/NAS@NDX/total' },
  goldIntl:{ Yahoo: 'https://finance.yahoo.com/quote/GC=F/', NaverGold: 'https://m.stock.naver.com/marketindex/metals/GCcv1' },
  goldKr:  { NaverGoldKr: 'https://m.stock.naver.com/marketindex/metals/M04020000', 'Naver금': 'https://finance.naver.com/marketindex/' },
  us10y:   { FRED: 'https://fred.stlouisfed.org/series/DGS10', Yahoo: 'https://finance.yahoo.com/quote/%5ETNX/', 'Naver채권US': 'https://m.stock.naver.com/marketindex/bond' },
  kr10y:   { 'Naver채권': 'https://m.stock.naver.com/marketindex/bond', Yahoo: 'https://finance.yahoo.com/quote/%5EKR10YT%3DRR/' },
  fedRate: { FRED: 'https://fred.stlouisfed.org/series/DFEDTARU' },
  usdkrw:  { Yahoo: 'https://finance.yahoo.com/quote/KRW=X/', 'Naver환율': 'https://m.stock.naver.com/marketindex/exchange/FX_USDKRW' },
  dxy:     { Yahoo: 'https://finance.yahoo.com/quote/DX-Y.NYB/' },
  vix:     { Yahoo: 'https://finance.yahoo.com/quote/%5EVIX/' },
  btc:     { Yahoo: 'https://finance.yahoo.com/quote/BTC-USD/', CoinGecko: 'https://www.coingecko.com/en/coins/bitcoin' },
  eth:     { Yahoo: 'https://finance.yahoo.com/quote/ETH-USD/', CoinGecko: 'https://www.coingecko.com/en/coins/ethereum' },
};

// 기본(fallback) URL
const DEFAULT_URLS: Record<string, string> = {
  kospi:   'https://m.stock.naver.com/domestic/index/KOSPI/total',
  sp500:   'https://finance.yahoo.com/quote/%5EGSPC/',
  nasdaq:  'https://finance.yahoo.com/quote/%5ENDX/',
  goldIntl:'https://finance.yahoo.com/quote/GC=F/',
  goldKr:  'https://m.stock.naver.com/marketindex/metals/M04020000',
  us10y:   'https://fred.stlouisfed.org/series/DGS10',
  kr10y:   'https://m.stock.naver.com/marketindex/bond',
  fedRate: 'https://fred.stlouisfed.org/series/DFEDTARU',
  usdkrw:  'https://finance.yahoo.com/quote/KRW=X/',
  dxy:     'https://finance.yahoo.com/quote/DX-Y.NYB/',
  vix:     'https://finance.yahoo.com/quote/%5EVIX/',
  btc:     'https://finance.yahoo.com/quote/BTC-USD/',
  eth:     'https://finance.yahoo.com/quote/ETH-USD/',
};

export default function MarketIndicators({
  marketIndicators,
  marketIndices,
  indicatorHistoryMap,
  indicatorLoading,
  indicatorFetchStatus,
  showIndicatorVerify,
  setShowIndicatorVerify,
  fetchMarketIndicators,
  showKospi, setShowKospi,
  showSp500, setShowSp500,
  showNasdaq, setShowNasdaq,
  showIndicatorsInChart,
  setShowIndicatorsInChart,
  indicatorHistoryLoading,
  fetchIndicatorHistory,
  fetchSingleIndexHistory,
  appliedRange,
  onUploadIndicator,
  onFetchAll,
}) {
  const fileInputRefs = useRef({});

  // 수집 source 기반 URL 반환 (source 미확인 시 기본 URL 사용)
  const getEffectiveUrl = (key: string) => {
    const source = indicatorFetchStatus[key]?.source;
    if (source && SOURCE_URLS[key]?.[source]) return SOURCE_URLS[key][source];
    return DEFAULT_URLS[key] ?? null;
  };

  // 지표 이름 클릭 → 메인 차트 토글 (데이터 없으면 자동 수집)
  const handleIndicatorClick = async (key) => {
    const isShown = showIndicatorsInChart[key];
    if (!isShown && !indicatorHistoryMap[key]) {
      await fetchIndicatorHistory(key, appliedRange?.start, appliedRange?.end);
    }
    setShowIndicatorsInChart(prev => ({ ...prev, [key]: !isShown }));
  };

  const needsDataLoad = (key) => {
    if (!CHART_INDICATOR_KEYS.includes(key)) return false;
    const h = indicatorHistoryMap[key];
    if (!h || Object.keys(h).length === 0) return true;
    if (!appliedRange?.start) return false;
    const earliest = Object.keys(h).sort()[0];
    return earliest > appliedRange.start;
  };

  // 새 순서: KOSPI → S&P500 → Nasdaq100 → Gold → 국내금 | US 10Y → KR 10Y → 미국기준금리 → 환율 → DXY → VIX → BTC → ETH
  const indicators = [
    // ── 상단 고정 (항상 표시) ──
    {
      label: 'KOSPI', key: 'kospi',
      val: marketIndicators.kospiPrice ?? getIndexLatest(marketIndices?.kospi).val,
      chg: marketIndicators.kospiChg ?? getIndexLatest(marketIndices?.kospi).chg,
      fmt: (v) => v?.toFixed(2), color: 'text-sky-400',
      isIndexToggle: true, indexActive: showKospi, onIndexToggle: () => setShowKospi(!showKospi),
    },
    {
      label: 'S&P500', key: 'sp500',
      val: marketIndicators.sp500Price ?? getIndexLatest(marketIndices?.sp500).val,
      chg: marketIndicators.sp500Chg ?? getIndexLatest(marketIndices?.sp500).chg,
      fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-purple-400',
      isIndexToggle: true, indexActive: showSp500, onIndexToggle: () => setShowSp500(!showSp500),
    },
    {
      label: 'Nasdaq100', key: 'nasdaq',
      val: marketIndicators.nasdaqPrice ?? getIndexLatest(marketIndices?.nasdaq).val,
      chg: marketIndicators.nasdaqChg ?? getIndexLatest(marketIndices?.nasdaq).chg,
      fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-teal-400',
      isIndexToggle: true, indexActive: showNasdaq, onIndexToggle: () => setShowNasdaq(!showNasdaq),
    },
    {
      label: 'Gold', key: 'goldIntl',
      val: marketIndicators.goldIntl, chg: marketIndicators.goldIntlChg,
      fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-yellow-500',
      sep: true,
    },
    {
      label: '국내 금', key: 'goldKr',
      val: marketIndicators.goldKr, chg: marketIndicators.goldKrChg,
      fmt: (v) => formatNumber(v), color: 'text-yellow-600',
    },
    // ── 하단 스크롤 영역 ──
    {
      label: 'US 10Y', key: 'us10y',
      val: marketIndicators.us10y, chg: marketIndicators.us10yChg,
      fmt: (v) => v?.toFixed(3) + '%', color: 'text-gray-300',
      sep: true,
    },
    {
      label: 'KR 10Y', key: 'kr10y',
      val: marketIndicators.kr10y, chg: marketIndicators.kr10yChg,
      fmt: (v) => v?.toFixed(3) + '%', color: 'text-gray-300',
    },
    {
      label: '미국 기준금리', key: 'fedRate',
      val: marketIndicators.fedRate, chg: marketIndicators.fedRateChg,
      fmt: (v) => v?.toFixed(2) + '%', color: 'text-pink-400',
      sep: true,
    },
    {
      label: 'USDKRW', key: 'usdkrw',
      val: marketIndicators.usdkrw, chg: marketIndicators.usdkrwChg,
      fmt: (v) => v?.toFixed(2), color: 'text-blue-400',
      sep: true,
    },
    {
      label: 'DXY', key: 'dxy',
      val: marketIndicators.dxy, chg: marketIndicators.dxyChg,
      fmt: (v) => v?.toFixed(3), color: 'text-cyan-400',
    },
    {
      label: 'VIX', key: 'vix',
      val: marketIndicators.vix, chg: marketIndicators.vixChg,
      fmt: (v) => v?.toFixed(2), color: 'text-red-400',
      sep: true,
    },
    {
      label: 'Bitcoin', key: 'btc',
      val: marketIndicators.btc, chg: marketIndicators.btcChg,
      fmt: (v) => '$' + v?.toLocaleString('en-US', { maximumFractionDigits: 0 }), color: 'text-orange-400',
      sep: true,
    },
    {
      label: 'Ethereum', key: 'eth',
      val: marketIndicators.eth, chg: marketIndicators.ethChg,
      fmt: (v) => '$' + v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-indigo-400',
    },
  ];

  const topIndicators = indicators.slice(0, 5);    // KOSPI ~ 국내금 (항상 표시)
  const bottomIndicators = indicators.slice(5);     // US 10Y ~ ETH (스크롤)

  const isIndicatorInChart = (key) => {
    if (key === 'kospi') return showKospi;
    if (key === 'sp500') return showSp500;
    if (key === 'nasdaq') return showNasdaq;
    return showIndicatorsInChart?.[key] ?? false;
  };

  const renderRow = (item, idx) => {
    const st = indicatorFetchStatus[item.key];
    const inChart = isIndicatorInChart(item.key);
    const color = INDICATOR_COLORS[item.key] ?? '#9ca3af';
    const isLoading = indicatorHistoryLoading?.[item.key];
    const hasHistory = item.isIndexToggle
      ? (marketIndices?.[item.key] && Object.keys(marketIndices[item.key]).length > 0)
      : (indicatorHistoryMap?.[item.key] && Object.keys(indicatorHistoryMap[item.key]).length > 0);
    const showLoadBtn = !item.isIndexToggle && needsDataLoad(item.key);
    const isStooqSupported = STOOQ_SUPPORTED.includes(item.key);
    const effectiveUrl = getEffectiveUrl(item.key);

    return (
      <div
        key={idx}
        className={`px-2 py-1.5 flex items-center justify-between transition-colors
          ${item.sep ? 'border-t border-gray-600' : 'border-t border-gray-700/30'}
          ${inChart ? 'bg-gray-700/50' : 'hover:bg-gray-800/40'}`}
      >
        {/* 왼쪽: 이름 + 상태 점 + 데이터 로드 버튼 */}
        <div className="flex items-center gap-1 shrink-0 min-w-0 flex-1">

          {/* 지표 이름 클릭 → 메인 차트 토글 */}
          <button
            className={`font-bold text-left leading-none transition-all select-none truncate
              ${inChart ? 'underline underline-offset-2' : 'hover:opacity-80'}`}
            style={{ color: inChart ? color : '#9ca3af', maxWidth: showLoadBtn ? '72px' : '100px' }}
            onClick={() => item.isIndexToggle ? item.onIndexToggle() : handleIndicatorClick(item.key)}
            title={inChart ? '차트에서 숨김' : hasHistory ? '차트에 표시' : '데이터 수집 후 차트 표시'}
            disabled={isLoading}
          >
            {item.label}
          </button>

          {/* 현재가 수집 상태 점 */}
          {indicatorLoading
            ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" title="수집중" />
            : st?.status === 'success'
              ? <span className="w-1.5 h-1.5 rounded-full bg-green-400 cursor-pointer shrink-0"
                  onClick={() => effectiveUrl && window.open(effectiveUrl, '_blank')}
                  title={`${st.source} | ${st.updatedAt}`} />
              : st?.status === 'fail' && item.val !== null
                ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 cursor-pointer shrink-0"
                    onClick={() => effectiveUrl && window.open(effectiveUrl, '_blank')} title="백업데이터" />
                : st?.status === 'fail'
                  ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 cursor-pointer shrink-0"
                      onClick={() => effectiveUrl && window.open(effectiveUrl, '_blank')} title="접속 불가" />
                  : item.val !== null
                    ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 cursor-pointer shrink-0"
                        onClick={() => effectiveUrl && window.open(effectiveUrl, '_blank')} title="백업데이터" />
                    : <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" title="미수집" />
          }

          {/* ── 데이터 로드 버튼 (히스토리 없거나 기간 부족할 때) ── */}
          {showLoadBtn && (
            isLoading ? (
              <span className="shrink-0" title="수집중...">
                <RefreshCw size={9} className="animate-spin text-blue-400" />
              </span>
            ) : isStooqSupported ? (
              /* 자동수집 버튼 — 수집만, 차트 자동 표시 안 함 */
              <button
                onClick={async () => {
                  await fetchIndicatorHistory(item.key, appliedRange?.start, appliedRange?.end);
                }}
                className="shrink-0 p-0.5 rounded hover:bg-blue-900/50 text-blue-400 hover:text-blue-300 transition-colors"
                title={`${item.label} 과거 데이터 자동 수집 (Yahoo Finance / FRED)\n기간: ${appliedRange?.start || '최근3년'} ~ ${appliedRange?.end || '오늘'}`}
              >
                <Download size={9} />
              </button>
            ) : (
              /* stooq 미지원: CSV/JSON 파일 업로드 버튼 — 수집만, 차트 자동 표시 안 함 */
              <>
                <button
                  onClick={() => fileInputRefs.current[item.key]?.click()}
                  className="shrink-0 p-0.5 rounded hover:bg-orange-900/50 text-orange-400 hover:text-orange-300 transition-colors"
                  title={`${item.label} CSV/JSON 파일 업로드\n(자동수집 미지원 - 직접 업로드 필요)`}
                >
                  <FileUp size={9} />
                </button>
                <input
                  ref={el => { fileInputRefs.current[item.key] = el; }}
                  type="file"
                  accept=".csv,.json"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) onUploadIndicator(item.key, f);
                    e.target.value = '';
                  }}
                />
              </>
            )
          )}

          {/* 히스토리 보유 표시 (로드 버튼 없을 때) */}
          {!item.isIndexToggle && !showLoadBtn && hasHistory && (
            <span className="w-1 h-1 rounded-full bg-blue-400 shrink-0"
              title={`히스토리 ${Object.keys(indicatorHistoryMap[item.key] || {}).length}건 보유`} />
          )}
        </div>

        {/* 오른쪽: 수치 클릭 → 출처 사이트 이동 */}
        <div
          className="flex flex-col items-end ml-1 min-w-0 cursor-pointer hover:opacity-70 transition-opacity"
          onClick={() => effectiveUrl && window.open(effectiveUrl, '_blank')}
          title={effectiveUrl ? `클릭하여 출처 이동 (${indicatorFetchStatus[item.key]?.source ?? ''})` : undefined}
        >
          <span className="text-white font-bold font-mono text-[11px] truncate">
            {item.val !== null && item.val !== undefined ? item.fmt(item.val) : '-'}
          </span>
          {item.chg !== null && item.chg !== undefined && (
            <span className={`font-bold font-mono text-[9px]
              ${item.chg > 0 ? 'text-red-400' : item.chg < 0 ? 'text-blue-400' : 'text-gray-500'}`}>
              {item.chg > 0 ? '▲' : item.chg < 0 ? '▼' : ''}
              {Math.abs(item.chg).toFixed(2)}%
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full xl:w-[200px] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg flex flex-col overflow-hidden shrink-0">

      {/* 헤더 */}
      <div className="p-2 bg-[#0f172a] text-white font-bold flex justify-between items-center text-[11px] border-b border-gray-700">
        <span>📊 시장 지표</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowIndicatorVerify(!showIndicatorVerify)}
            className={`p-1 rounded transition ${showIndicatorVerify ? 'text-blue-300 bg-blue-900/50' : 'text-gray-600 hover:text-gray-400 hover:bg-gray-800'}`}
            title="시장 지표 데이터 검증"
          >
            <Search size={10} />
          </button>
          {/* 조회기간 전체 지표 일괄 수집 버튼 */}
          <button
            onClick={onFetchAll}
            disabled={Object.values(indicatorHistoryLoading || {}).some(Boolean)}
            className="p-1 hover:bg-blue-900/50 rounded transition text-blue-400 hover:text-blue-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title={`조회기간 시장지표 일괄 수집\n기간: ${appliedRange?.start || '최근3년'} ~ ${appliedRange?.end || '오늘'}\nUS 10Y · 기준금리 · KR 10Y · Gold · USDKRW · DXY · 국내금 · VIX · BTC · ETH`}
          >
            {Object.values(indicatorHistoryLoading || {}).some(Boolean)
              ? <RefreshCw size={11} className="animate-spin" />
              : <DownloadCloud size={11} />
            }
          </button>
          <button
            onClick={fetchMarketIndicators}
            disabled={indicatorLoading}
            className="p-1 hover:bg-gray-800 rounded transition text-teal-400 hover:text-white"
            title="시장 지표 새로고침"
          >
            <RefreshCw size={12} className={indicatorLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 지표 리스트 */}
      <div className="flex-1 flex flex-col text-[10px] overflow-hidden">

        {/* 상단 고정 영역: KOSPI ~ 국내금 */}
        <div className="flex flex-col shrink-0">
          {topIndicators.map((item, idx) => renderRow(item, idx))}
        </div>

        {/* 하단 스크롤 영역: US 10Y ~ ETH + 범례 */}
        <div className="flex flex-col overflow-y-auto flex-1">
          {bottomIndicators.map((item, idx) => renderRow(item, idx))}

          {/* 범례 */}
          <div className="px-2.5 py-1.5 text-[8.5px] text-gray-600 border-t border-gray-700/30 leading-relaxed">
            이름 클릭 → 차트 표시&nbsp;&nbsp;수치 클릭 → 사이트<br />
            <span className="text-blue-400"><Download size={7} className="inline mb-0.5" /></span> 자동수집&nbsp;&nbsp;
            <span className="text-orange-400"><FileUp size={7} className="inline mb-0.5" /></span> 파일업로드&nbsp;&nbsp;
            <span className="text-blue-500">●</span> 히스토리 보유
          </div>
        </div>
      </div>

      {/* 데이터 검증 패널 */}
      {showIndicatorVerify && (
        <div className="border-t border-gray-600 bg-[#0f172a] p-2 text-[9px] overflow-y-auto max-h-[200px]">
          <div className="text-blue-300 font-bold mb-1 flex justify-between items-center">
            <span>📋 시장 지표 수집 검증</span>
            <button onClick={() => setShowIndicatorVerify(false)} className="text-gray-500 hover:text-white">
              <X size={10} />
            </button>
          </div>
          <table className="w-full text-[9px]">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="py-0.5 text-left">지표</th>
                <th className="py-0.5 text-center">현재</th>
                <th className="py-0.5 text-center">히스토리</th>
                <th className="py-0.5 text-left">수집</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'KOSPI',    key: 'kospi',   val: marketIndicators.kospiPrice,  histKey: null, marketIndexKey: 'kospi' },
                { label: 'S&P500',   key: 'sp500',   val: marketIndicators.sp500Price,  histKey: null, marketIndexKey: 'sp500' },
                { label: 'Nasdaq',   key: 'nasdaq',  val: marketIndicators.nasdaqPrice, histKey: null, marketIndexKey: 'nasdaq' },
                { label: 'Gold',     key: 'goldIntl', val: marketIndicators.goldIntl,   histKey: 'goldIntl', marketIndexKey: null },
                { label: '국내 금',  key: 'goldKr',  val: marketIndicators.goldKr,      histKey: 'goldKr', marketIndexKey: null },
                { label: 'US 10Y',   key: 'us10y',   val: marketIndicators.us10y,       histKey: 'us10y', marketIndexKey: null },
                { label: 'KR 10Y',   key: 'kr10y',   val: marketIndicators.kr10y,       histKey: 'kr10y', marketIndexKey: null },
                { label: '기준금리',  key: 'fedRate', val: marketIndicators.fedRate,     histKey: 'fedRate', marketIndexKey: null },
                { label: 'USDKRW',   key: 'usdkrw',  val: marketIndicators.usdkrw,     histKey: 'usdkrw', marketIndexKey: null },
                { label: 'DXY',      key: 'dxy',      val: marketIndicators.dxy,        histKey: 'dxy', marketIndexKey: null },
                { label: 'VIX',      key: 'vix',      val: marketIndicators.vix,        histKey: 'vix', marketIndexKey: null },
                { label: 'Bitcoin',  key: 'btc',      val: marketIndicators.btc,        histKey: 'btc', marketIndexKey: null },
                { label: 'Ethereum', key: 'eth',      val: marketIndicators.eth,        histKey: 'eth', marketIndexKey: null },
              ].map((item, i) => {
                const st = indicatorFetchStatus[item.key];
                const hasBackup = item.val !== null && item.val !== undefined;
                // 지수(KOSPI/SP500/Nasdaq)는 marketIndices에서, 나머지는 indicatorHistoryMap에서 히스토리 읽기
                const hist = item.marketIndexKey
                  ? (marketIndices?.[item.marketIndexKey] || {})
                  : item.histKey ? (indicatorHistoryMap?.[item.histKey] || {}) : {};
                const histCount = Object.keys(hist).length;
                const latestDate = histCount > 0 ? Object.keys(hist).sort().pop() : null;

                let badge, sourceText;
                if (!st) {
                  badge = hasBackup ? <span className="text-yellow-400">🟡</span> : <span className="text-gray-500">⚪</span>;
                  sourceText = hasBackup ? '백업' : '-';
                } else if (st.status === 'success') {
                  badge = <span className="text-green-400">🟢</span>;
                  sourceText = st.source ?? 'API';
                } else if (st.status === 'partial') {
                  badge = <span className="text-yellow-400">🟡</span>;
                  sourceText = st.source ?? '백업';
                } else {
                  badge = hasBackup ? <span className="text-yellow-400">🟡</span> : <span className="text-red-400">🔴</span>;
                  sourceText = hasBackup ? '백업' : '실패';
                }

                // 지수(KOSPI/SP500/Nasdaq): fetchSingleIndexHistory로 수집
                const isIndexItem = !!item.marketIndexKey;
                const isAutoCollectable = !isIndexItem && item.histKey && (STOOQ_SUPPORTED.includes(item.histKey) || item.histKey === 'goldKr');
                const isUploadOnly = !isIndexItem && item.histKey && !isAutoCollectable;
                // 지수 로딩 상태: indicatorHistoryLoading[key] 공유
                const isHistLoading = isIndexItem
                  ? indicatorHistoryLoading?.[item.key]
                  : indicatorHistoryLoading?.[item.histKey];

                const today = new Date().toISOString().split('T')[0];
                const incrementalStart = latestDate
                  ? (() => { const d = new Date(latestDate); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })()
                  : null;
                const isUpToDate = latestDate && latestDate >= today;

                // 수집 출처 URL
                const sourceUrl = (() => {
                  if (!st?.source) return null;
                  return SOURCE_URLS[item.key]?.[st.source] ?? DEFAULT_URLS[item.key] ?? null;
                })();

                return (
                  <tr key={i} className="border-b border-gray-800">
                    <td className="py-0.5 text-gray-300 font-bold">{item.label}</td>
                    <td className="py-0.5 text-center">{badge}</td>
                    <td className="py-0.5 text-center text-[8px]">
                      {histCount > 0
                        ? <span className="text-blue-400" title={latestDate ? `최신: ${latestDate}` : ''}>{histCount}건</span>
                        : (item.histKey || item.marketIndexKey)
                          ? <span className="text-gray-600">없음</span>
                          : <span className="text-gray-700">-</span>
                      }
                    </td>
                    <td className="py-0.5">
                      {isHistLoading ? (
                        <span className="text-blue-300 animate-pulse">수집중...</span>
                      ) : isIndexItem ? (
                        isUpToDate ? (
                          <span
                            className={`text-[8px] ${sourceUrl ? 'text-green-500 cursor-pointer hover:text-green-300' : 'text-green-600'}`}
                            onClick={() => sourceUrl && window.open(sourceUrl, '_blank')}
                            title={sourceUrl ? `출처: ${sourceText}` : undefined}
                          >
                            최신
                          </span>
                        ) : (
                          <button
                            className="text-blue-400 hover:text-blue-200 transition-colors"
                            onClick={() => fetchSingleIndexHistory?.(item.marketIndexKey)}
                            title={latestDate
                              ? `${item.label} 히스토리 수집\n보유: ~${latestDate}\n클릭하여 전체 갱신`
                              : `${item.label} 히스토리 수집 (데이터 없음)`}
                          >
                            {sourceText || 'stooq'} ↓
                          </button>
                        )
                      ) : isAutoCollectable ? (
                        isUpToDate ? (
                          <span
                            className={`text-[8px] ${sourceUrl ? 'text-green-500 cursor-pointer hover:text-green-300' : 'text-green-600'}`}
                            onClick={() => sourceUrl && window.open(sourceUrl, '_blank')}
                            title={sourceUrl ? `출처: ${sourceText}` : undefined}
                          >
                            최신
                          </span>
                        ) : (
                          <button
                            className="text-blue-400 hover:text-blue-200 transition-colors"
                            onClick={() => {
                              fetchIndicatorHistory(item.histKey, incrementalStart, today);
                            }}
                            title={latestDate
                              ? `${item.label} 증분 수집\n보유: ${latestDate} 이후 ~ 오늘`
                              : `${item.label} 전체 수집 (데이터 없음)`}
                          >
                            {sourceText} ↓
                          </button>
                        )
                      ) : isUploadOnly ? (
                        <button
                          className="text-orange-400 hover:text-orange-300 transition-colors"
                          onClick={() => fileInputRefs.current[item.histKey]?.click()}
                          title={`${item.label} CSV/JSON 파일 업로드`}
                        >
                          <FileUp size={9} className="inline" />
                        </button>
                      ) : (
                        <span
                          className={`text-[8px] ${sourceUrl ? 'text-gray-400 cursor-pointer hover:text-gray-200' : 'text-gray-600'}`}
                          onClick={() => sourceUrl && window.open(sourceUrl, '_blank')}
                          title={sourceUrl ? `출처: ${sourceText}` : undefined}
                        >
                          {sourceText}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1 text-gray-600">🟢 성공 🟡 백업 🔴 실패 | 수집 클릭 시 최신 날짜 이후만 증분 수집</div>
        </div>
      )}
    </div>
  );
}
