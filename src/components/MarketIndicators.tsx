// @ts-nocheck
import React, { useRef } from 'react';
import { RefreshCw, X, Search, Download, FileUp, DownloadCloud } from 'lucide-react';
import { formatNumber, getIndexLatest } from '../utils';

const INDICATOR_COLORS = {
  kospi: '#f97316', sp500: '#a78bfa', nasdaq: '#2dd4bf',
  fedRate: '#f472b6', us10y: '#d1d5db', kr10y: '#9ca3af',
  goldIntl: '#eab308', goldKr: '#d97706', usdkrw: '#60a5fa', dxy: '#22d3ee',
};

// stooq 자동수집 가능한 키
const STOOQ_SUPPORTED = ['us10y', 'goldIntl', 'usdkrw', 'dxy'];
// 차트에 표시 가능한 키 (goldKr 제외)
const CHART_INDICATOR_KEYS = ['us10y', 'kr10y', 'goldIntl', 'usdkrw', 'dxy', 'fedRate'];

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
  appliedRange,
  onUploadIndicator,
  onFetchAll,
}) {
  // stooq 미지원 지표용 파일 업로드 input refs
  const fileInputRefs = useRef({});

  // 지표 이름 클릭 → 메인 차트 토글 (데이터 없으면 자동 수집)
  const handleIndicatorClick = async (key) => {
    const isShown = showIndicatorsInChart[key];
    if (!isShown && !indicatorHistoryMap[key]) {
      await fetchIndicatorHistory(key, appliedRange?.start, appliedRange?.end);
    }
    setShowIndicatorsInChart(prev => ({ ...prev, [key]: !isShown }));
  };

  // 데이터 로드 버튼 표시 여부 결정
  // - 히스토리 없음 OR 히스토리가 조회 시작일보다 늦게 시작할 때
  const needsDataLoad = (key) => {
    if (!CHART_INDICATOR_KEYS.includes(key)) return false;
    const h = indicatorHistoryMap[key];
    if (!h || Object.keys(h).length === 0) return true;
    if (!appliedRange?.start) return false;
    const earliest = Object.keys(h).sort()[0];
    return earliest > appliedRange.start;
  };

  const indicators = [
    {
      label: 'KOSPI', key: 'kospi',
      val: marketIndicators.kospiPrice ?? getIndexLatest(marketIndices?.kospi).val,
      chg: marketIndicators.kospiChg ?? getIndexLatest(marketIndices?.kospi).chg,
      fmt: (v) => v?.toFixed(2), color: 'text-yellow-400',
      url: 'https://m.stock.naver.com/domestic/index/KOSPI/total',
      isIndexToggle: true, indexActive: showKospi, onIndexToggle: () => setShowKospi(!showKospi),
    },
    {
      label: 'S&P500', key: 'sp500',
      val: marketIndicators.sp500Price ?? getIndexLatest(marketIndices?.sp500).val,
      chg: marketIndicators.sp500Chg ?? getIndexLatest(marketIndices?.sp500).chg,
      fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-purple-400',
      url: 'https://m.stock.naver.com/worldstock/index/.INX/total',
      isIndexToggle: true, indexActive: showSp500, onIndexToggle: () => setShowSp500(!showSp500),
    },
    {
      label: 'Nasdaq100', key: 'nasdaq',
      val: marketIndicators.nasdaqPrice ?? getIndexLatest(marketIndices?.nasdaq).val,
      chg: marketIndicators.nasdaqChg ?? getIndexLatest(marketIndices?.nasdaq).chg,
      fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-teal-400',
      url: 'https://m.stock.naver.com/worldstock/index/.IXIC/total',
      isIndexToggle: true, indexActive: showNasdaq, onIndexToggle: () => setShowNasdaq(!showNasdaq),
    },
    {
      label: '미국 기준금리', key: 'fedRate',
      val: marketIndicators.fedRate, chg: marketIndicators.fedRateChg,
      fmt: (v) => v?.toFixed(2) + '%', color: 'text-pink-400',
      url: 'https://tradingeconomics.com/united-states/interest-rate', sep: true,
    },
    {
      label: 'US 10Y', key: 'us10y',
      val: marketIndicators.us10y, chg: marketIndicators.us10yChg,
      fmt: (v) => v?.toFixed(3) + '%', color: 'text-gray-300',
      url: 'https://tradingeconomics.com/united-states/government-bond-yield', sep: true,
    },
    {
      label: 'KR 10Y', key: 'kr10y',
      val: marketIndicators.kr10y, chg: marketIndicators.kr10yChg,
      fmt: (v) => v?.toFixed(3) + '%', color: 'text-gray-300',
      url: 'https://tradingeconomics.com/south-korea/government-bond-yield',
    },
    {
      label: 'Gold', key: 'goldIntl',
      val: marketIndicators.goldIntl, chg: marketIndicators.goldIntlChg,
      fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-yellow-500',
      url: 'https://tradingeconomics.com/commodity/gold', sep: true,
    },
    {
      label: '국내 금', key: 'goldKr',
      val: marketIndicators.goldKr, chg: marketIndicators.goldKrChg,
      fmt: (v) => formatNumber(v), color: 'text-yellow-600',
      url: 'https://m.stock.naver.com/marketindex/metals/M04020000',
    },
    {
      label: 'USDKRW', key: 'usdkrw',
      val: marketIndicators.usdkrw, chg: marketIndicators.usdkrwChg,
      fmt: (v) => v?.toFixed(2), color: 'text-blue-400',
      url: 'https://tradingeconomics.com/south-korea/currency', sep: true,
    },
    {
      label: 'DXY', key: 'dxy',
      val: marketIndicators.dxy, chg: marketIndicators.dxyChg,
      fmt: (v) => v?.toFixed(3), color: 'text-cyan-400',
      url: 'https://tradingeconomics.com/united-states/currency',
    },
  ];

  const isIndicatorInChart = (key) => {
    if (key === 'kospi') return showKospi;
    if (key === 'sp500') return showSp500;
    if (key === 'nasdaq') return showNasdaq;
    return showIndicatorsInChart?.[key] ?? false;
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
            title={`조회기간 시장지표 일괄 수집 (stooq API)\n기간: ${appliedRange?.start || '최근3년'} ~ ${appliedRange?.end || '오늘'}\nUS 10Y · Gold · USDKRW · DXY → GSheet 저장`}
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
      <div className="flex-1 flex flex-col text-[10px] overflow-y-auto">
        {indicators.map((item, idx) => {
          const st = indicatorFetchStatus[item.key];
          const inChart = isIndicatorInChart(item.key);
          const color = INDICATOR_COLORS[item.key] ?? '#9ca3af';
          const isLoading = indicatorHistoryLoading?.[item.key];
          const hasHistory = item.isIndexToggle
            ? (marketIndices?.[item.key] && Object.keys(marketIndices[item.key]).length > 0)
            : (indicatorHistoryMap?.[item.key] && Object.keys(indicatorHistoryMap[item.key]).length > 0);
          const showLoadBtn = !item.isIndexToggle && needsDataLoad(item.key);
          const isStooqSupported = STOOQ_SUPPORTED.includes(item.key);

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
                        onClick={() => item.url && window.open(item.url, '_blank')}
                        title={`${st.source} | ${st.updatedAt}`} />
                    : st?.status === 'fail' && item.val !== null
                      ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 cursor-pointer shrink-0"
                          onClick={() => item.url && window.open(item.url, '_blank')} title="백업데이터" />
                      : st?.status === 'fail'
                        ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 cursor-pointer shrink-0"
                            onClick={() => item.url && window.open(item.url, '_blank')} title="접속 불가" />
                        : item.val !== null
                          ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 cursor-pointer shrink-0"
                              onClick={() => item.url && window.open(item.url, '_blank')} title="백업데이터" />
                          : <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" title="미수집" />
                }

                {/* ── 데이터 로드 버튼 (히스토리 없거나 기간 부족할 때) ── */}
                {showLoadBtn && (
                  isLoading ? (
                    <span className="shrink-0" title="수집중...">
                      <RefreshCw size={9} className="animate-spin text-blue-400" />
                    </span>
                  ) : isStooqSupported ? (
                    /* stooq 자동수집 버튼 */
                    <button
                      onClick={async () => {
                        await fetchIndicatorHistory(item.key, appliedRange?.start, appliedRange?.end);
                        setShowIndicatorsInChart(prev => ({ ...prev, [item.key]: true }));
                      }}
                      className="shrink-0 p-0.5 rounded hover:bg-blue-900/50 text-blue-400 hover:text-blue-300 transition-colors"
                      title={`${item.label} 과거 데이터 자동 수집 (stooq.com)\n기간: ${appliedRange?.start || '최근3년'} ~ ${appliedRange?.end || '오늘'}`}
                    >
                      <Download size={9} />
                    </button>
                  ) : (
                    /* stooq 미지원: CSV/JSON 파일 업로드 버튼 */
                    <>
                      <button
                        onClick={() => fileInputRefs.current[item.key]?.click()}
                        className="shrink-0 p-0.5 rounded hover:bg-orange-900/50 text-orange-400 hover:text-orange-300 transition-colors"
                        title={`${item.label} CSV/JSON 파일 업로드\n(stooq 미지원 - 직접 업로드 필요)`}
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
                          if (f) {
                            onUploadIndicator(item.key, f);
                            setShowIndicatorsInChart(prev => ({ ...prev, [item.key]: true }));
                          }
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

              {/* 오른쪽: 수치 클릭 → 외부 사이트 이동 */}
              <div
                className="flex flex-col items-end ml-1 min-w-0 cursor-pointer hover:opacity-70 transition-opacity"
                onClick={() => item.url && window.open(item.url, '_blank')}
                title={item.url ? '클릭하여 사이트 이동' : undefined}
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
        })}

        {/* 범례 */}
        <div className="px-2.5 py-1.5 text-[8.5px] text-gray-600 border-t border-gray-700/30 leading-relaxed">
          이름 클릭 → 차트 표시&nbsp;&nbsp;수치 클릭 → 사이트<br />
          <span className="text-blue-400"><Download size={7} className="inline mb-0.5" /></span> 자동수집&nbsp;&nbsp;
          <span className="text-orange-400"><FileUp size={7} className="inline mb-0.5" /></span> 파일업로드&nbsp;&nbsp;
          <span className="text-blue-500">●</span> 히스토리 보유
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
                <th className="py-0.5 text-left">출처</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'KOSPI',  key: 'kospi',   val: marketIndicators.kospiPrice,  url: 'https://m.stock.naver.com/domestic/index/KOSPI/total',                    histKey: null },
                { label: 'S&P500', key: 'sp500',   val: marketIndicators.sp500Price,  url: 'https://m.stock.naver.com/worldstock/index/.INX/total',                   histKey: null },
                { label: 'Nasdaq', key: 'nasdaq',  val: marketIndicators.nasdaqPrice, url: 'https://m.stock.naver.com/worldstock/index/.IXIC/total',                  histKey: null },
                { label: '기준금리', key: 'fedRate', val: marketIndicators.fedRate,   url: 'https://tradingeconomics.com/united-states/interest-rate',                histKey: 'fedRate' },
                { label: 'US 10Y', key: 'us10y',   val: marketIndicators.us10y,       url: 'https://tradingeconomics.com/united-states/government-bond-yield',        histKey: 'us10y' },
                { label: 'KR 10Y', key: 'kr10y',   val: marketIndicators.kr10y,       url: 'https://tradingeconomics.com/south-korea/government-bond-yield',          histKey: 'kr10y' },
                { label: 'Gold',   key: 'goldIntl', val: marketIndicators.goldIntl,   url: 'https://tradingeconomics.com/commodity/gold',                             histKey: 'goldIntl' },
                { label: '국내 금', key: 'goldKr',  val: marketIndicators.goldKr,     url: 'https://m.stock.naver.com/marketindex/metals/M04020000',                  histKey: null },
                { label: 'USDKRW', key: 'usdkrw',  val: marketIndicators.usdkrw,     url: 'https://tradingeconomics.com/south-korea/currency',                       histKey: 'usdkrw' },
                { label: 'DXY',    key: 'dxy',      val: marketIndicators.dxy,        url: 'https://tradingeconomics.com/united-states/currency',                     histKey: 'dxy' },
              ].map((item, i) => {
                const st = indicatorFetchStatus[item.key];
                const hasBackup = item.val !== null && item.val !== undefined;
                const histCount = item.histKey && indicatorHistoryMap?.[item.histKey]
                  ? Object.keys(indicatorHistoryMap[item.histKey]).length : 0;
                let badge, sourceText;
                if (!st) {
                  badge = hasBackup ? <span className="text-yellow-400">🟡</span> : <span className="text-gray-500">⚪</span>;
                  sourceText = hasBackup ? '백업' : '-';
                } else if (st.status === 'success') {
                  badge = <span className="text-green-400">🟢</span>;
                  sourceText = st.source;
                } else {
                  badge = hasBackup ? <span className="text-yellow-400">🟡</span> : <span className="text-red-400">🔴</span>;
                  sourceText = hasBackup ? '백업' : '실패';
                }
                return (
                  <tr key={i} className="border-b border-gray-800">
                    <td className="py-0.5 text-gray-300 font-bold">{item.label}</td>
                    <td className="py-0.5 text-center">{badge}</td>
                    <td className="py-0.5 text-center text-[8px]">
                      {histCount > 0
                        ? <span className="text-blue-400">{histCount}건</span>
                        : item.histKey
                          ? <span className="text-gray-600">없음</span>
                          : <span className="text-gray-700">-</span>
                      }
                    </td>
                    <td className="py-0.5 text-blue-400 cursor-pointer hover:underline"
                      onClick={() => window.open(item.url, '_blank')}>{sourceText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1 text-gray-600">🟢 성공 🟡 백업 🔴 실패 | 이름 클릭 시 히스토리 자동수집</div>
        </div>
      )}
    </div>
  );
}
