// @ts-nocheck
import React, { useState, useMemo } from 'react';
import { RefreshCw, X, Search } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts';
import { formatNumber, getIndexLatest } from '../utils';

const INDICATOR_COLORS = {
  kospi: '#facc15',
  sp500: '#a78bfa',
  nasdaq: '#2dd4bf',
  fedRate: '#f472b6',
  us10y: '#d1d5db',
  kr10y: '#9ca3af',
  goldIntl: '#eab308',
  goldKr: '#d97706',
  usdkrw: '#60a5fa',
  dxy: '#22d3ee',
};

const CustomChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid #4b5563', borderRadius: 8, padding: '8px 12px' }}>
      <div className="text-gray-400 text-[10px] mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span>{p.value > 0 ? '+' : ''}{p.value?.toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
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
}) {
  const [selectedIndicators, setSelectedIndicators] = useState([]);

  const indicators = [
    {
      label: 'KOSPI', key: 'kospi',
      val: marketIndicators.kospiPrice ?? getIndexLatest(marketIndices?.kospi).val, chg: marketIndicators.kospiChg ?? getIndexLatest(marketIndices?.kospi).chg,
      fmt: (v) => v?.toFixed(2), color: 'text-yellow-400',
      url: 'https://m.stock.naver.com/domestic/index/KOSPI/total',
      isMainChartToggle: true, mainChartActive: showKospi, onMainToggle: () => setShowKospi(!showKospi),
    },
    {
      label: 'S&P500', key: 'sp500',
      val: marketIndicators.sp500Price ?? getIndexLatest(marketIndices?.sp500).val, chg: marketIndicators.sp500Chg ?? getIndexLatest(marketIndices?.sp500).chg,
      fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-purple-400',
      url: 'https://m.stock.naver.com/worldstock/index/.INX/total',
      isMainChartToggle: true, mainChartActive: showSp500, onMainToggle: () => setShowSp500(!showSp500),
    },
    {
      label: 'Nasdaq100', key: 'nasdaq',
      val: marketIndicators.nasdaqPrice ?? getIndexLatest(marketIndices?.nasdaq).val, chg: marketIndicators.nasdaqChg ?? getIndexLatest(marketIndices?.nasdaq).chg,
      fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'text-teal-400',
      url: 'https://m.stock.naver.com/worldstock/index/.IXIC/total',
      isMainChartToggle: true, mainChartActive: showNasdaq, onMainToggle: () => setShowNasdaq(!showNasdaq),
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

  const getHistory = (key) => {
    if (key === 'kospi') return marketIndices?.kospi ?? null;
    if (key === 'sp500') return marketIndices?.sp500 ?? null;
    if (key === 'nasdaq') return marketIndices?.nasdaq ?? null;
    return indicatorHistoryMap?.[key] ?? null;
  };

  const toggleIndicator = (key) => {
    setSelectedIndicators(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  // Build normalized % change chart data from selected indicators that have history
  const chartData = useMemo(() => {
    const activeWithData = selectedIndicators.filter(k => {
      const h = getHistory(k);
      return h && Object.keys(h).length > 0;
    });
    if (activeWithData.length === 0) return [];

    const allDates = new Set();
    activeWithData.forEach(k => {
      const h = getHistory(k);
      if (h) Object.keys(h).forEach(d => allDates.add(d));
    });
    const sortedDates = Array.from(allDates).sort();

    const baseValues = {};
    activeWithData.forEach(k => {
      const h = getHistory(k);
      if (h) {
        const firstDate = Object.keys(h).sort()[0];
        if (firstDate) baseValues[k] = h[firstDate];
      }
    });

    return sortedDates
      .map(date => {
        const point = { date, label: date.substring(5).replace('-', '/') };
        activeWithData.forEach(k => {
          const h = getHistory(k);
          if (h && h[date] !== undefined && baseValues[k]) {
            point[k] = parseFloat(((h[date] / baseValues[k] - 1) * 100).toFixed(2));
          }
        });
        return point;
      })
      .filter(p => activeWithData.some(k => p[k] !== undefined));
  }, [selectedIndicators, marketIndices, indicatorHistoryMap]);

  const activeWithData = selectedIndicators.filter(k => {
    const h = getHistory(k);
    return h && Object.keys(h).length > 0;
  });
  const activeWithoutData = selectedIndicators.filter(k => {
    const h = getHistory(k);
    return !h || Object.keys(h).length === 0;
  });

  const labelFor = (key) => indicators.find(i => i.key === key)?.label ?? key;

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
      <div className="flex flex-col text-[10px] overflow-y-auto">
        {indicators.map((item, idx) => {
          const st = indicatorFetchStatus[item.key];
          const isSelected = selectedIndicators.includes(item.key);
          const color = INDICATOR_COLORS[item.key] ?? '#9ca3af';
          return (
            <div
              key={idx}
              className={`px-2.5 py-1.5 flex items-center justify-between transition-colors ${item.sep ? 'border-t border-gray-600' : 'border-t border-gray-700/30'} ${isSelected ? 'bg-gray-700/60' : 'hover:bg-gray-800/50'}`}
            >
              <div className="flex items-center gap-1 shrink-0">
                {/* 이름 클릭 → 지표 차트 토글 */}
                <span
                  className={`font-bold cursor-pointer select-none transition-all ${isSelected ? 'underline underline-offset-2' : 'hover:opacity-80'}`}
                  style={{ color: isSelected ? color : undefined }}
                  onClick={() => toggleIndicator(item.key)}
                  title="클릭하여 차트에 표시/숨김"
                >
                  {item.label}
                </span>
                {/* 상태 점 (클릭 → 외부 링크) */}
                {indicatorLoading
                  ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" title="수집중" />
                  : st?.status === 'success'
                    ? <span className="w-1.5 h-1.5 rounded-full bg-green-400 cursor-pointer" onClick={() => item.url && window.open(item.url, '_blank')} title={`${st.source} | ${st.updatedAt}`} />
                    : st?.status === 'fail' && item.val !== null
                      ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 cursor-pointer" onClick={() => item.url && window.open(item.url, '_blank')} title="백업데이터" />
                      : st?.status === 'fail'
                        ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 cursor-pointer" onClick={() => item.url && window.open(item.url, '_blank')} title="접속 불가" />
                        : item.val !== null
                          ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 cursor-pointer" onClick={() => item.url && window.open(item.url, '_blank')} title="백업데이터" />
                          : <span className="w-1.5 h-1.5 rounded-full bg-gray-600" title="미수집" />
                }
                {/* 주 차트 토글 (KOSPI/SP500/Nasdaq만) */}
                {item.isMainChartToggle && (
                  <button
                    onClick={() => item.onMainToggle()}
                    className={`text-[8px] px-0.5 rounded transition-colors leading-none ${item.mainChartActive ? 'text-white opacity-80' : 'text-gray-600 hover:text-gray-400'}`}
                    title={`주 차트 ${item.mainChartActive ? '숨김' : '표시'}`}
                  >
                    {item.mainChartActive ? '◉' : '○'}
                  </button>
                )}
              </div>
              {/* 수치 클릭 → 외부 링크 */}
              <div
                className="flex flex-col items-end ml-1 min-w-0 cursor-pointer hover:opacity-70 transition-opacity"
                onClick={() => item.url && window.open(item.url, '_blank')}
                title="새 창에서 열기"
              >
                <span className="text-white font-bold font-mono text-[11px] truncate">
                  {item.val !== null && item.val !== undefined ? item.fmt(item.val) : '-'}
                </span>
                {item.chg !== null && item.chg !== undefined && (
                  <span className={`font-bold font-mono text-[9px] ${item.chg > 0 ? 'text-red-400' : item.chg < 0 ? 'text-blue-400' : 'text-gray-500'}`}>
                    {item.chg > 0 ? '▲' : item.chg < 0 ? '▼' : ''}
                    {Math.abs(item.chg).toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 지표 차트 */}
      {selectedIndicators.length > 0 && (
        <div className="border-t border-gray-600 bg-[#0f172a] flex flex-col">
          {/* 선택된 지표 태그 */}
          <div className="px-2 pt-1.5 flex flex-wrap gap-1">
            {selectedIndicators.map(key => {
              const color = INDICATOR_COLORS[key] ?? '#9ca3af';
              const hasData = activeWithData.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleIndicator(key)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border transition-all hover:opacity-80"
                  style={{ borderColor: color, color, backgroundColor: `${color}20` }}
                  title={hasData ? '클릭하여 제거' : '데이터 없음 - CSV 업로드 필요'}
                >
                  {labelFor(key)}
                  {!hasData && <span className="text-gray-500 ml-0.5">?</span>}
                  <X size={8} className="ml-0.5" />
                </button>
              );
            })}
          </div>

          {/* 데이터 없음 안내 */}
          {activeWithoutData.length > 0 && (
            <div className="px-2 pt-1 text-[9px] text-gray-500">
              {activeWithoutData.map(k => labelFor(k)).join(', ')}: CSV 업로드 필요
            </div>
          )}

          {/* recharts LineChart */}
          {chartData.length > 0 ? (
            <div className="px-1 pb-2 pt-1">
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#6b7280', fontSize: 8 }}
                    interval="preserveStartEnd"
                    tickLine={false}
                    axisLine={{ stroke: '#374151' }}
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 8 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`}
                  />
                  <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 3" />
                  <Tooltip content={<CustomChartTooltip />} />
                  {activeWithData.map(key => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={labelFor(key)}
                      stroke={INDICATOR_COLORS[key] ?? '#9ca3af'}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      activeDot={{ r: 3, strokeWidth: 0 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <div className="text-center text-[8px] text-gray-600 mt-0.5">기준 시점 대비 % 변화</div>
            </div>
          ) : activeWithData.length === 0 && (
            <div className="text-center text-[9px] text-gray-500 py-3 px-2">
              히스토리 데이터 없음<br />
              <span className="text-gray-600">📤 JSON/CSV 파일 업로드</span>
            </div>
          )}
        </div>
      )}

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
                <th className="py-0.5 text-center">상태</th>
                <th className="py-0.5 text-left">출처 (클릭이동)</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'KOSPI', key: 'kospi', val: marketIndicators.kospiPrice, url: 'https://m.stock.naver.com/domestic/index/KOSPI/total' },
                { label: 'S&P500', key: 'sp500', val: marketIndicators.sp500Price, url: 'https://m.stock.naver.com/worldstock/index/.INX/total' },
                { label: 'Nasdaq', key: 'nasdaq', val: marketIndicators.nasdaqPrice, url: 'https://m.stock.naver.com/worldstock/index/.IXIC/total' },
                { label: '미국 기준금리', key: 'fedRate', val: marketIndicators.fedRate, url: 'https://tradingeconomics.com/united-states/interest-rate' },
                { label: 'US 10Y', key: 'us10y', val: marketIndicators.us10y, url: 'https://tradingeconomics.com/united-states/government-bond-yield' },
                { label: 'KR 10Y', key: 'kr10y', val: marketIndicators.kr10y, url: 'https://tradingeconomics.com/south-korea/government-bond-yield' },
                { label: 'Gold', key: 'goldIntl', val: marketIndicators.goldIntl, url: 'https://tradingeconomics.com/commodity/gold' },
                { label: '국내 금', key: 'goldKr', val: marketIndicators.goldKr, url: 'https://m.stock.naver.com/marketindex/metals/M04020000' },
                { label: 'USDKRW', key: 'usdkrw', val: marketIndicators.usdkrw, url: 'https://tradingeconomics.com/south-korea/currency' },
                { label: 'DXY', key: 'dxy', val: marketIndicators.dxy, url: 'https://tradingeconomics.com/united-states/currency' },
              ].map((item, i) => {
                const st = indicatorFetchStatus[item.key];
                const hasBackup = item.val !== null && item.val !== undefined;
                let badge, sourceText;
                if (!st) {
                  badge = hasBackup ? <span className="text-yellow-400">🟡</span> : <span className="text-gray-500">⚪</span>;
                  sourceText = hasBackup ? '백업데이터' : '-';
                } else if (st.status === 'success') {
                  badge = <span className="text-green-400">🟢</span>;
                  sourceText = st.source;
                } else {
                  badge = hasBackup ? <span className="text-yellow-400">🟡</span> : <span className="text-red-400">🔴</span>;
                  sourceText = hasBackup ? '백업데이터' : '접속 불가';
                }
                return (
                  <tr key={i} className="border-b border-gray-800">
                    <td className="py-0.5 text-gray-300 font-bold">{item.label}</td>
                    <td className="py-0.5 text-center">{badge}</td>
                    <td className="py-0.5 text-blue-400 cursor-pointer hover:underline" onClick={() => window.open(item.url, '_blank')}>{sourceText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1 text-gray-600">🔄 새로고침으로 수집 | 🟢 성공 🟡 백업 🔴 실패</div>
        </div>
      )}
    </div>
  );
}
