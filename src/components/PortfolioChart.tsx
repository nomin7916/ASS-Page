// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Settings, Search, BarChart2, Percent, History, Activity, PanelLeftClose, PanelLeft, RefreshCw, X, TrendingUp, HelpCircle } from 'lucide-react';
import { ComposedChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Area, Line, ReferenceArea, ReferenceLine, Tooltip as RechartsTooltip, Label } from 'recharts';
import { formatShortDate, formatCurrency, formatNumber, buildIndexStatus } from '../utils';
import CustomDatePicker from './CustomDatePicker';
import ChartRangeControls from './ChartRangeControls';
import CompStockChips from './CompStockChips';
import { extractLinkLabel } from '../chartUtils';
import { CHART_NAME_TO_POINT_KEY } from '../constants';

export default function PortfolioChart({
  activePortfolioAccountType,
  customLinks, setCustomLinks,
  overseasLinks, setOverseasLinks,
  isLinkSettingsOpen, setIsLinkSettingsOpen,
  dateRange, setDateRange,
  chartPeriod, setChartPeriod,
  showTotalEval, setShowTotalEval,
  showReturnRate, setShowReturnRate,
  showBacktest, setShowBacktest,
  backtestColor, setBacktestColor,
  isZeroBaseMode, setIsZeroBaseMode,
  isAvgPriceMode, setIsAvgPriceMode,
  showCalcVerify, setShowCalcVerify,
  showMarketPanel, setShowMarketPanel,
  setIsScaleSettingOpen,
  showIndexVerify, setShowIndexVerify,
  showKospi,
  showSp500,
  showNasdaq,
  goldIndicators, setGoldIndicators,
  goldIndicatorColors, setGoldIndicatorColors,
  compStocks, setCompStocks,
  userFeatures,
  finalChartData,
  effectiveShowIndicators,
  selectionResult,
  refAreaLeft, refAreaRight,
  hoveredPoint,
  appliedRange,
  stockListingDates, setStockListingDates,
  autoFetchedCodes,
  indicatorHistoryMap,
  stockHistoryMap,
  indicatorHistoryLoading,
  stockFetchStatus,
  fetchIndicatorHistory,
  handleSearchClick,
  handleAddCompStock,
  handleChartMouseDown,
  handleChartMouseMove,
  handleChartMouseUp,
  handleChartMouseLeave,
  handleCompStockBlur,
  handleToggleComp,
  handleFetchCompHistory,
  handleForceRefetchComp,
  handleRemoveCompStock,
  defaultSelectionResult,
  effectiveDateKey,
  depositHistory,
  depositHistory2,
}) {
  const [showPrincipal, setShowPrincipal] = useState(false);
  const [isXl, setIsXl] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const apply = () => setIsXl(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const hoveredData = hoveredPoint ? finalChartData.find(d => d.date === hoveredPoint.label) : null;
  const hoveredReturnRate = hoveredData?.returnRate ?? null;

  // 호버 시 '조회시작일 → 해당일' 병기용: 시리즈 키별 조회기간 첫 유효값(시작값).
  // 비교종목 등 시작 시점 데이터 없으면 첫 non-null 시점을 base로 사용(rate baseline과 일치).
  const firstNonNullVal = (key: string) => {
    if (!key) return null;
    for (const d of finalChartData) { if (d[key] != null) return d[key]; }
    return null;
  };

  const chartDateSet = new Set(finalChartData.map(d => d.date));
  const isOverseas = activePortfolioAccountType === 'overseas';
  const fmtMoney = (v) => isOverseas
    ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : formatCurrency(v);

  const fmtMarkerAmt = (amt) => {
    const a = Math.abs(amt);
    if (a >= 1e8) return (amt / 1e8).toFixed(1).replace(/\.0$/, '') + '억';
    if (a >= 1e4) return Math.round(amt / 1e4) + '만';
    return String(amt);
  };
  const depositMarkers = Object.entries(
    (depositHistory || [])
      .filter(d => !d.noPrincipal && d.amount && chartDateSet.has(d.date))
      .reduce((acc, d) => { acc[d.date] = (acc[d.date] || 0) + d.amount; return acc; }, {} as Record<string, number>)
  ).map(([date, amount]) => ({ date, amount, type: 'deposit' }));
  const withdrawalMarkers = Object.entries(
    (depositHistory2 || [])
      .filter(d => !d.noPrincipal && d.amount && chartDateSet.has(d.date))
      .reduce((acc, d) => { acc[d.date] = (acc[d.date] || 0) + d.amount; return acc; }, {} as Record<string, number>)
  ).map(([date, amount]) => ({ date, amount, type: 'withdrawal' }));

  return (
    <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg flex-1 min-w-0 flex flex-col">
      <div className="p-3 bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700 flex flex-col shrink-0 gap-3">
        {/* 사이트 링크 버튼 */}
        {(() => {
          const isOverseasChart = activePortfolioAccountType === 'overseas';
          const activeLinks = isOverseasChart ? overseasLinks : customLinks;
          const setActiveLinks = isOverseasChart ? setOverseasLinks : setCustomLinks;
          return (
            <>
              <div className="flex items-center gap-1.5">
                {activeLinks.slice(0, 3).map((link, i) => {
                  const label = link.name?.trim() ? link.name.trim().slice(0, 7) : extractLinkLabel(link.url);
                  return (
                    <button key={i} onClick={() => link.url && window.open(link.url.startsWith('http') ? link.url : 'https://' + link.url, '_blank')} className={`bg-gray-800 hover:bg-gray-700 text-blue-300 h-[28px] rounded shadow transition border border-gray-600 flex items-center justify-center font-bold tracking-tight ${label ? 'px-2 text-[11px] min-w-[28px]' : 'w-[28px] text-xs'}`} title={link.url || `버튼 ${i + 1} 설정 필요`}>{label ?? (i + 1)}</button>
                  );
                })}
                <button onClick={() => setIsLinkSettingsOpen(!isLinkSettingsOpen)} className="bg-gray-800 hover:bg-gray-700 text-gray-400 w-[30px] h-[30px] rounded shadow transition border border-gray-600 flex items-center justify-center" title="퀵 링크 설정"><Settings size={14} /></button>
              </div>
              {isLinkSettingsOpen && (
                <div className="flex flex-wrap gap-3 pb-1 border-b border-gray-700/50">
                  {isOverseasChart && <div className="w-full text-[10px] text-sky-400/70 font-bold">🌐 해외계좌 전용 링크 (다른 계좌에 영향 없음)</div>}
                  {activeLinks.slice(0, 3).map((l, i) => (
                    <div key={i} className="flex flex-col gap-1.5 flex-1 min-w-[160px] max-w-[240px]">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-500 font-bold ml-1">버튼 {i + 1} 이름 <span className="text-gray-600 font-normal">(직접 입력, 최대 7자)</span></span>
                        <input type="text" maxLength={7} className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-400 shadow-inner font-normal" value={l.name || ''} onChange={(e) => { const n = [...activeLinks]; n[i] = { ...n[i], name: e.target.value }; setActiveLinks(n); }} placeholder="비워두면 URL에서 자동 추출" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-500 font-bold ml-1">버튼 {i + 1} 연결 (URL)</span>
                        <input type="text" className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-500 shadow-inner font-normal" value={l.url} onChange={(e) => { const n = [...activeLinks]; n[i] = { ...n[i], url: e.target.value }; setActiveLinks(n); }} placeholder="https://..." />
                      </div>
                    </div>
                  ))}
                  <button onClick={() => setIsLinkSettingsOpen(false)} className="self-end bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition">완료</button>
                </div>
              )}
            </>
          );
        })()}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* gold 계좌: 고정 지표 4개 칩 / 그 외: 비교종목 칩 */}
            {!userFeatures.feature1 && activePortfolioAccountType === 'gold' && (
              <div className="flex flex-wrap items-center gap-2">
                {([
                  { key: 'goldIntl', label: 'Gold(국제)' },
                  { key: 'goldKr',   label: '국내금(KRX)' },
                  { key: 'usdkrw',  label: 'USD/KRW' },
                  { key: 'dxy',     label: 'DXY' },
                ] as const).map(({ key, label }) => {
                  const active = goldIndicators[key];
                  const color = goldIndicatorColors[key];
                  const loading = indicatorHistoryLoading[key];
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-0 rounded-md overflow-hidden shrink-0 border transition-colors select-none"
                      style={{ borderColor: active ? color : '#4b5563', backgroundColor: active ? `${color}22` : '#1f2937' }}
                    >
                      <div
                        className="relative flex items-center justify-center w-5 self-stretch border-r border-gray-700/50 hover:bg-gray-700/30 transition-colors cursor-pointer"
                        title="선 색상 변경"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="w-2.5 h-2.5 rounded-full shadow-sm pointer-events-none" style={{ backgroundColor: color }} />
                        <input
                          type="color"
                          value={color}
                          onChange={e => setGoldIndicatorColors(p => ({ ...p, [key]: e.target.value }))}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </div>
                      <button
                        className="pr-2.5 pl-2 py-1.5 text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                        style={{ color: active ? color : '#6b7280', backgroundColor: 'transparent' }}
                        onClick={() => {
                          if (!indicatorHistoryMap[key]) fetchIndicatorHistory(key, null, null);
                          setGoldIndicators(p => ({ ...p, [key]: !p[key] }));
                        }}
                      >
                        {label}
                        {loading && <RefreshCw size={10} className="animate-spin text-gray-400" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 w-full xl:w-auto xl:flex-wrap xl:overflow-visible xl:pb-0 xl:mx-0 xl:px-0">
              <CompStockChips
                compStocks={compStocks}
                setCompStocks={setCompStocks}
                stockHistoryMap={stockHistoryMap}
                stockListingDates={stockListingDates}
                setStockListingDates={setStockListingDates}
                appliedRange={appliedRange}
                autoFetchedCodes={autoFetchedCodes}
                stockFetchStatus={stockFetchStatus}
                handleAddCompStock={handleAddCompStock}
                handleToggleComp={handleToggleComp}
                handleCompStockBlur={handleCompStockBlur}
                handleFetchCompHistory={handleFetchCompHistory}
                handleForceRefetchComp={handleForceRefetchComp}
                handleRemoveCompStock={handleRemoveCompStock}
              />
              <button onClick={() => setShowIndexVerify(!showIndexVerify)} className={`shrink-0 px-2 py-1.5 rounded text-[11px] font-bold transition-colors flex items-center gap-1 ml-1 ${showIndexVerify ? 'bg-blue-900/50 text-blue-300 border border-blue-500/50' : 'bg-transparent text-gray-500 hover:bg-gray-700 border border-gray-700'}`} title="지수 데이터 검증">
                <Search size={12} />
              </button>
            </div>}
          </div>
          <div className="flex items-center justify-end gap-3 w-full xl:w-auto">
            <ChartRangeControls
              dateRange={dateRange}
              setDateRange={setDateRange}
              period={chartPeriod}
              setPeriod={setChartPeriod}
              onSearch={handleSearchClick}
            />
          </div>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-gray-700/50">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowTotalEval(!showTotalEval)}
              className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showTotalEval ? 'text-gray-300 bg-gray-800 border-gray-600' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
              title="자산 총액 표시"
            ><BarChart2 size={14} /></button>
            <button
              onClick={() => setShowPrincipal(!showPrincipal)}
              className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showPrincipal ? 'text-cyan-400 bg-cyan-900/20 border-cyan-700/40' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
              title="투자원금 표시"
            ><TrendingUp size={14} /></button>
            <button
              onClick={() => setShowReturnRate(!showReturnRate)}
              className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showReturnRate ? 'text-red-400 bg-red-900/20 border-red-700/40' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
              title="나의 수익률(%) 표시 — 투자원금 기준"
            ><Percent size={14} /></button>
            <div
              className="flex items-stretch rounded border overflow-hidden transition-colors"
              style={{ borderColor: showBacktest ? backtestColor + '80' : '#374151', height: '29px' }}
            >
              <div
                className="relative w-[10px] shrink-0 cursor-pointer hover:opacity-75 transition-opacity"
                style={{ backgroundColor: backtestColor }}
                title="백테스트 선 색상 변경"
              >
                <input type="color" value={backtestColor} onChange={e => setBacktestColor(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </div>
              <button
                onClick={() => setShowBacktest(!showBacktest)}
                className="px-2 flex items-center justify-center transition-colors hover:opacity-80"
                style={{ color: showBacktest ? backtestColor : '#6b7280', backgroundColor: showBacktest ? backtestColor + '18' : '#1e293b' }}
                title="현재 종목·비중을 조회기간 시작일부터 투자 시 수익률 (백테스트)"
              ><History size={13} /></button>
            </div>
            <div className="w-px h-3 bg-gray-700 mx-0.5" />
            <button
              onClick={() => setIsZeroBaseMode(!isZeroBaseMode)}
              className={`p-1.5 rounded border flex items-center justify-center transition-colors ${isZeroBaseMode ? 'text-green-400 bg-green-900/20 border-green-700/40' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
              title="조회 시작일을 0% 기준으로 차트 재정렬"
            ><Activity size={14} /></button>
            {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && (<>
              <div className="w-px h-3 bg-gray-700 mx-0.5" />
              <button
                onClick={() => setShowMarketPanel(p => !p)}
                className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showMarketPanel ? 'text-blue-400 bg-blue-900/20 border-blue-700/40' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
                title={showMarketPanel ? '시장 지표 숨기기' : '시장 지표 표시'}
              >{showMarketPanel ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}</button>
            </>)}
          </div>
          <button
            onClick={() => setIsScaleSettingOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all bg-indigo-900/40 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-800/60"
            title="지표별 변동폭 배율 설정"
          >
            ⚙️ 지표 배율 설정
          </button>
        </div>

        {showIndexVerify && (
          <div className="mt-2 border-t border-gray-700/50 pt-3 animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                 <span className="text-[11px] text-blue-300 font-bold">📊 종목 데이터 검증</span>
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

      {/* 호버 정보 패널 */}
      <div className="px-4 py-2 border-t border-gray-700/40 bg-[#0a1628]/60 min-h-[36px] flex items-center gap-3 overflow-x-auto shrink-0">
        {hoveredPoint ? (
          <>
            <span className="text-gray-400 text-[11px] font-bold shrink-0 mr-1">{formatShortDate(hoveredPoint.label)}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
              {hoveredPoint.payload
                .filter(entry => entry.dataKey && !String(entry.dataKey).endsWith('Point') && entry.value != null)
                .map((entry, i) => {
                  const dk = entry.dataKey as string;
                  const rawValue = entry.value;
                  const value = dk?.endsWith('RateScaled')
                    ? (entry.payload?.[dk.replace('RateScaled', 'Rate')] ?? rawValue)
                    : rawValue;
                  let displayVal: string;
                  if (entry.name === '총자산' || entry.name === '투자원금') {
                    displayVal = isOverseas
                      ? '$' + Number(rawValue).toLocaleString('en-US', { maximumFractionDigits: 0 })
                      : formatNumber(rawValue);
                  } else {
                    const pointKey = CHART_NAME_TO_POINT_KEY[entry.name];
                    const inlineCompMatch = dk?.match(/^comp(\d+)Rate$/);
                    const compPointKey = inlineCompMatch ? `comp${inlineCompMatch[1]}Point` : null;
                    let pointVal = pointKey && entry.payload ? entry.payload[pointKey] : null;
                    if (pointVal == null && compPointKey && entry.payload) {
                      pointVal = entry.payload[compPointKey];
                    }
                    const sign = Number(value) >= 0 ? '+' : '';
                    const rateStr = `${sign}${Number(value).toFixed(2)}%`;
                    // 조회시작일 → 해당일 병기. 가격 있는 시리즈(비교종목·지수·금)는 시작가→해당일가,
                    // 가격 없는 시리즈(나의 수익률 등)는 시작 %→해당일 %.
                    if (pointVal != null) {
                      const isComp = !!inlineCompMatch;
                      const isKrwPoint = ['국내금', 'USDKRW', 'KOSPI'].includes(entry.name);
                      const fmtPrice = (v: any) => (isComp || isKrwPoint)
                        ? Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 0 })
                        : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      const startPrice = firstNonNullVal(compPointKey || pointKey);
                      displayVal = startPrice != null
                        ? `${rateStr} (${fmtPrice(startPrice)} → ${fmtPrice(pointVal)})`
                        : `${rateStr} (${fmtPrice(pointVal)})`;
                    } else if (dk === 'principalReturnRate') {
                      // 나의 수익률: 퍼센트의 실제 분모·분자를 그대로 병기 — (평가자산 − 투자원금) ÷ 투자원금.
                      // 투자원금=그날까지 입금 누적(분모), 평가자산=그날 예수금 포함 총평가액(분자).
                      // '원금 → 평가'를 보여야 화면에서 퍼센트가 그대로 검산됨(투자 요약 패널과 동일 형식).
                      const dayPrin = entry.payload?.principalAmount;
                      const dayEval = entry.payload?.evalAmount;
                      const fmtEval = (v: any) => isOverseas
                        ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
                        : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
                      displayVal = (dayPrin != null && dayEval != null)
                        ? `${rateStr} (원금 ${fmtEval(dayPrin)} → 평가 ${fmtEval(dayEval)})`
                        : rateStr;
                    } else {
                      const startRate = firstNonNullVal(dk);
                      displayVal = startRate != null
                        ? `${rateStr} (시작 ${Number(startRate) >= 0 ? '+' : ''}${Number(startRate).toFixed(2)}% → ${rateStr})`
                        : rateStr;
                    }
                  }
                  return (
                    <div key={i} className="flex items-center gap-1.5 shrink-0">
                      <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: entry.color || '#e5e7eb' }} />
                      <span className="text-[11px] font-bold" style={{ color: entry.color || '#e5e7eb' }}>{entry.name}</span>
                      <span className="text-[11px] text-gray-300">{displayVal}</span>
                    </div>
                  );
                })}
            </div>
          </>
        ) : (
          <span className="text-gray-600 text-[10px]">차트에 마우스를 올리면 상세 값이 표시됩니다</span>
        )}
      </div>

      {/* 드래그 기간 선택 결과 패널 */}
      {(() => {
        const displayResult = selectionResult ?? defaultSelectionResult;
        return (
          <div className="px-4 py-2 border-t border-gray-700/40 bg-[#060f1e]/70 min-h-[36px] shrink-0">
            {displayResult ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCalcVerify(!showCalcVerify)}
                    className={`shrink-0 p-0.5 rounded transition-colors flex items-center justify-center ${showCalcVerify ? 'text-sky-300' : 'text-gray-600 hover:text-gray-300'}`}
                    title="각 선의 계산식·데이터 출처 검증"
                  >
                    <HelpCircle size={13} />
                  </button>
                  <span className="text-gray-500 text-[10px] font-bold shrink-0">{selectionResult ? '선택 기간' : '조회기간'}</span>
                  <span className="text-gray-300 text-[11px] font-bold">{formatShortDate(displayResult.startDate)} ~ {formatShortDate(displayResult.endDate)}</span>
                </div>
                {showCalcVerify && (() => {
                  const vStart = finalChartData.find(d => d.date === displayResult.startDate);
                  const vEnd = finalChartData.find(d => d.date === displayResult.endDate);
                  const fmtRate = (r) => r == null ? '—' : `${r > 0 ? '+' : ''}${Number(r).toFixed(2)}%`;
                  const rateCls = (r) => r == null ? 'text-gray-400' : (r >= 0 ? 'text-red-400' : 'text-blue-400');
                  const fmtPt = (v) => v == null ? '—' : Number(v).toLocaleString();
                  const isOverseasComp = activePortfolioAccountType === 'overseas';
                  const Row = ({ label, source, value, date, extra }) => (
                    <>
                      <span className="text-gray-500 whitespace-nowrap">{label}</span>
                      <span className="text-gray-300 leading-snug">
                        <span className="text-gray-400">{source}</span>
                        <span className="mx-1 text-gray-600">·</span>
                        <span className="font-mono text-gray-200">{value}</span>
                        {date && <span className="ml-1 text-gray-600">({date})</span>}
                        {extra}
                      </span>
                    </>
                  );
                  return (
                    <div className="rounded-lg border border-sky-700/40 bg-[#0a1322]/80 p-2.5 animate-in fade-in slide-in-from-top-1">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] text-sky-300 font-bold">🔍 시리즈별 계산식 · 데이터 출처</span>
                        <button onClick={() => setShowCalcVerify(false)} className="text-gray-500 hover:text-white p-0.5"><X size={12} /></button>
                      </div>

                      {/* ① 나의 수익률 (투자원금 기준) */}
                      <div className="py-2 border-t border-gray-700/30 first:border-t-0 first:pt-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-sm shrink-0 bg-red-500" />
                          <span className="text-[11px] font-bold text-red-400">나의 수익률</span>
                          <span className={`text-[11px] font-black ${rateCls(displayResult.principalReturnRateAtEnd)}`}>{fmtRate(displayResult.principalReturnRateAtEnd)}</span>
                        </div>
                        {displayResult.principalReturnRateAtEnd != null ? (
                          <>
                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] pl-3.5">
                              <Row
                                label="시작"
                                source="투자원금 / 평가자산(예수금 포함)"
                                value={`${vStart?.principalAmount != null ? fmtMoney(vStart.principalAmount) : '—'} / ${vStart?.evalAmount != null ? fmtMoney(vStart.evalAmount) : '—'}`}
                                date={formatShortDate(displayResult.startDate)}
                                extra={vStart?.principalReturnRate != null && <span className={`ml-1 font-bold ${rateCls(vStart.principalReturnRate)}`}>→ {fmtRate(vStart.principalReturnRate)}</span>}
                              />
                              <Row
                                label="종료"
                                source="투자원금 / 평가자산(예수금 포함)"
                                value={`${displayResult.principalAtEnd != null ? fmtMoney(displayResult.principalAtEnd) : '—'} / ${displayResult.endEval != null ? fmtMoney(displayResult.endEval) : '—'}`}
                                date={formatShortDate(displayResult.endDate)}
                                extra={<span className={`ml-1 font-bold ${rateCls(displayResult.principalReturnRateAtEnd)}`}>→ {fmtRate(displayResult.principalReturnRateAtEnd)}</span>}
                              />
                              <span className="text-gray-500">계산식</span>
                              <span className="text-sky-200/90 font-mono leading-snug">(당일 평가자산 − 투자원금) ÷ 투자원금 × 100</span>
                              <span className="text-gray-500">출처</span>
                              <span className="text-gray-400 leading-snug">투자원금 = 입금 누적(투자 요약의 투자 원금) · 평가자산 = 당일 총평가액(예수금 포함) · 투자 요약 패널 수익률과 동일 · 배당 재투자는 수익으로 반영</span>
                            </div>
                            <div className="mt-1.5 ml-3.5 p-1.5 rounded bg-gray-800/40 border border-gray-700/40 text-[9.5px] text-gray-400 leading-relaxed">
                              ℹ️ 기준은 <b>내 투자원금</b>입니다(조회 시작일 0% 아님). 평가자산이 투자원금보다 낮으면 <span className="text-blue-400 font-bold">−수익률</span>, 높으면 <span className="text-red-400 font-bold">+수익률</span>로 표시됩니다.
                            </div>
                          </>
                        ) : (
                          <div className="ml-3.5 text-[10px] text-gray-500">입출금 내역 또는 투자 원금을 입력하면 표시됩니다.</div>
                        )}
                      </div>

                      {/* ③ 비교종목 */}
                      {compStocks.map((comp, ci) => {
                        if (!comp.active || !comp.code) return null;
                        const rate = displayResult[`comp${ci + 1}PeriodRate`];
                        if (rate == null) return null;
                        const startPt = vStart?.[`comp${ci + 1}Point`];
                        const endPt = vEnd?.[`comp${ci + 1}Point`];
                        const color = comp.color || '#10b981';
                        return (
                          <div key={comp.id} className="py-2 border-t border-gray-700/30">
                            <div className="flex items-center gap-1.5 mb-1">
                              <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                              <span className="text-[11px] font-bold" style={{ color }}>{comp.name || comp.code}</span>
                              <span className={`text-[11px] font-black ${rateCls(rate)}`}>{fmtRate(rate)}</span>
                            </div>
                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] pl-3.5">
                              <Row label="시작" source={`비교종목 ${isOverseasComp ? '해외 ' : ''}API 종가`} value={fmtPt(startPt)} date={formatShortDate(displayResult.startDate)} />
                              <Row label="종료" source={`비교종목 ${isOverseasComp ? '해외 ' : ''}API 종가`} value={fmtPt(endPt)} date={formatShortDate(displayResult.endDate)} />
                              <span className="text-gray-500">계산식</span>
                              <span className="text-sky-200/90 font-mono leading-snug">(종료종가 ÷ 시작종가 − 1) × 100 = {fmtRate(rate)}</span>
                            </div>
                            <div className="mt-1 ml-3.5 text-[9.5px] text-gray-500 leading-snug">* 네이버→KIS→야후 종가, 15일 역탐색·수정주가 미반영. 차트 선은 0% 기준 정규화이나 이 %는 원시 시작/종료 종가로 직접 계산.</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <div className="w-2 h-2 rounded-sm bg-red-500 shrink-0" />
                    <span className="text-[11px] font-bold text-gray-300 whitespace-nowrap">나의 수익률</span>
                    {displayResult.principalReturnRateAtEnd != null ? (() => {
                      const prin = displayResult.principalAtEnd;
                      const evl = displayResult.endEval;
                      const prof = (prin != null && evl != null) ? evl - prin : null;
                      return (
                        <>
                          <span className={`text-[12px] font-black whitespace-nowrap ${displayResult.principalReturnRateAtEnd >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                            {displayResult.principalReturnRateAtEnd > 0 ? '+' : ''}{displayResult.principalReturnRateAtEnd.toFixed(2)}%
                          </span>
                          {prof != null && (
                            <span className={`text-[10px] font-bold whitespace-nowrap ${prof >= 0 ? 'text-red-300/80' : 'text-blue-300/80'}`}>
                              ({prof >= 0 ? '+' : ''}{fmtMoney(prof)})
                            </span>
                          )}
                          {prin != null && evl != null && (
                            <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
                              (원금 {fmtMoney(prin)} → 평가 {fmtMoney(evl)})
                            </span>
                          )}
                        </>
                      );
                    })() : (
                      <span className="text-[10px] text-gray-500 whitespace-nowrap">입출금 내역 또는 투자 원금 입력 필요</span>
                    )}
                  </div>
                  {showBacktest && displayResult.backtestPeriodRate != null && (
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: backtestColor }} />
                      <span className="text-[11px] font-bold text-gray-300 whitespace-nowrap">백테스트</span>
                      <span className={`text-[12px] font-black whitespace-nowrap ${displayResult.backtestPeriodRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {displayResult.backtestPeriodRate > 0 ? '+' : ''}{displayResult.backtestPeriodRate.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
                {compStocks.some(c => c.active && c.code) && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                    {compStocks.map((comp, ci) => {
                      if (!comp.active || !comp.code) return null;
                      const rate = displayResult[`comp${ci + 1}PeriodRate`];
                      if (rate == null) return null;
                      const startPt = finalChartData.find(d => d.date === displayResult.startDate)?.[`comp${ci + 1}Point`];
                      const endPt = finalChartData.find(d => d.date === displayResult.endDate)?.[`comp${ci + 1}Point`];
                      return (
                        <div key={comp.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: comp.color || '#10b981' }} />
                          <span className="text-[11px] font-bold whitespace-nowrap" style={{ color: comp.color || '#10b981' }}>{comp.name}</span>
                          <span className={`text-[12px] font-black whitespace-nowrap ${rate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                            {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
                          </span>
                          {startPt != null && endPt != null && (
                            <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
                              ({Number(startPt).toLocaleString()} → {Number(endPt).toLocaleString()})
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && (() => {
                  const marketItems = [
                    ...(showKospi ? [{ key: 'kospi', label: 'KOSPI', color: '#38bdf8', isKrw: true }] : []),
                    ...(showSp500 ? [{ key: 'sp500', label: 'S&P500', color: '#bf5af2', isKrw: false }] : []),
                    ...(showNasdaq ? [{ key: 'nasdaq', label: 'NASDAQ', color: '#30d158', isKrw: false }] : []),
                  ];
                  const indItems = [
                    { key: 'us10y', label: 'US 10Y', color: '#8e8e93' },
                    { key: 'kr10y', label: 'KR 10Y', color: '#636366' },
                    { key: 'goldIntl', label: 'Gold(국제)', color: goldIndicatorColors.goldIntl },
                    { key: 'goldKr', label: '국내금', color: goldIndicatorColors.goldKr },
                    { key: 'usdkrw', label: 'USD/KRW', color: goldIndicatorColors.usdkrw },
                    { key: 'dxy', label: 'DXY', color: goldIndicatorColors.dxy },
                    { key: 'fedRate', label: '기준금리', color: '#ff375f' },
                    { key: 'vix', label: 'VIX', color: '#ff453a' },
                    { key: 'btc', label: 'Bitcoin', color: '#f7931a' },
                    { key: 'eth', label: 'Ethereum', color: '#627eea' },
                  ].filter(({ key }) => effectiveShowIndicators[key]);
                  const allItems = [...marketItems, ...indItems];
                  const visibleItems = allItems.filter(({ key }) => {
                    const rate = displayResult[`${key}PeriodRate`];
                    return rate != null;
                  });
                  if (!visibleItems.length) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                      {visibleItems.map(({ key, label, color, isKrw }) => {
                        const rate = displayResult[`${key}PeriodRate`];
                        const startPt = finalChartData.find(d => d.date === displayResult.startDate)?.[`${key}Point`];
                        const endPt = finalChartData.find(d => d.date === displayResult.endDate)?.[`${key}Point`];
                        const fmtPt = (v) => (isKrw ?? false)
                          ? Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 0 })
                          : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        return (
                          <div key={key} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                            <span className="text-[11px] font-bold whitespace-nowrap" style={{ color }}>{label}</span>
                            <span className={`text-[12px] font-black whitespace-nowrap ${rate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                              {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
                            </span>
                            {startPt != null && endPt != null && (
                              <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
                                ({fmtPt(startPt)} → {fmtPt(endPt)})
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {activePortfolioAccountType === 'gold' && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                    {([
                      { key: 'goldIntl', label: 'Gold(국제)' },
                      { key: 'goldKr',   label: '국내금(KRX)' },
                      { key: 'usdkrw',  label: 'USD/KRW' },
                      { key: 'dxy',     label: 'DXY' },
                    ] as const).map(({ key, label }) => {
                      const color = goldIndicatorColors[key];
                      if (!goldIndicators[key]) return null;
                      const rate = displayResult[`${key}PeriodRate`];
                      if (rate == null) return null;
                      const startPt = finalChartData.find(d => d.date === displayResult.startDate)?.[`${key}Point`];
                      const endPt = finalChartData.find(d => d.date === displayResult.endDate)?.[`${key}Point`];
                      return (
                        <div key={key} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-[11px] font-bold whitespace-nowrap" style={{ color }}>{label}</span>
                          <span className={`text-[12px] font-black whitespace-nowrap ${rate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                            {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
                          </span>
                          {startPt != null && endPt != null && (
                            <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
                              ({Number(startPt).toLocaleString()} → {Number(endPt).toLocaleString()})
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-gray-600 text-[10px]">차트에 마우스를 올리면 상세 값이 표시됩니다</span>
            )}
          </div>
        );
      })()}

      <div
        className="chart-container-for-drag p-2 sm:p-3 md:p-4 h-[320px] sm:h-[380px] md:h-[440px] xl:h-auto xl:min-h-[400px] xl:flex-1 relative select-none"
      >
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <ComposedChart data={finalChartData} onMouseDown={handleChartMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp} onMouseLeave={handleChartMouseLeave}>
            <defs>
              <filter id="neonGlow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              <linearGradient id="vixGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff453a" stopOpacity={0.3}/>
                <stop offset="50%" stopColor="#ff453a" stopOpacity={0.1}/>
                <stop offset="100%" stopColor="#ff453a" stopOpacity={0.02}/>
              </linearGradient>
              <linearGradient id="backtestGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={backtestColor} stopOpacity={0.35}/>
                <stop offset="95%" stopColor={backtestColor} stopOpacity={0.02}/>
              </linearGradient>
              <linearGradient id="goldKrGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={goldIndicatorColors.goldKr} stopOpacity={0.4}/>
                <stop offset="95%" stopColor={goldIndicatorColors.goldKr} stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#9ca3af" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="left" stroke="#9ca3af" tickFormatter={v => v + '%'} tick={{ fontSize: 10 }} />
            {(showTotalEval || showPrincipal) && <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" tickFormatter={v => activePortfolioAccountType === 'overseas' ? '$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)) : v / 10000 + '만'} tick={{ fontSize: 10 }} />}
            {isXl && effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <YAxis yAxisId="right-us10y" orientation="right" stroke="#8e8e93" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)} width={52} domain={['dataMin', 'dataMax']}><Label value="US 10Y" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#8e8e93', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <YAxis yAxisId="right-goldIntl" orientation="right" stroke={goldIndicatorColors.goldIntl} tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={56} domain={['dataMin', 'dataMax']}><Label value="Gold" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: goldIndicatorColors.goldIntl, fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && <YAxis yAxisId="right-goldKr" orientation="right" stroke={goldIndicatorColors.goldKr} tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={62} domain={['dataMin', 'dataMax']}><Label value="국내금" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: goldIndicatorColors.goldKr, fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <YAxis yAxisId="right-usdkrw" orientation="right" stroke={goldIndicatorColors.usdkrw} tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={56} domain={['dataMin', 'dataMax']}><Label value="USD/KRW" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: goldIndicatorColors.usdkrw, fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <YAxis yAxisId="right-dxy" orientation="right" stroke={goldIndicatorColors.dxy} tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(1)} width={52} domain={['dataMin', 'dataMax']}><Label value="DXY" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: goldIndicatorColors.dxy, fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <YAxis yAxisId="right-fedRate" orientation="right" stroke="#ff375f" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)+'%'} width={54} domain={['dataMin', 'dataMax']}><Label value="기준금리" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ff375f', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <YAxis yAxisId="right-kr10y" orientation="right" stroke="#636366" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)+'%'} width={52} domain={['dataMin', 'dataMax']}><Label value="KR 10Y" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#636366', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.vix && indicatorHistoryMap.vix && <YAxis yAxisId="right-vix" orientation="right" stroke="#ff453a" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(1)} width={48} domain={['dataMin', 'dataMax']}><Label value="VIX" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ff453a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.btc && indicatorHistoryMap.btc && <YAxis yAxisId="right-btc" orientation="right" stroke="#f7931a" tick={{ fontSize: 9 }} tickFormatter={v => '$' + Math.round(v).toLocaleString()} width={72} domain={['dataMin', 'dataMax']}><Label value="BTC" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#f7931a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {isXl && effectiveShowIndicators.eth && indicatorHistoryMap.eth && <YAxis yAxisId="right-eth" orientation="right" stroke="#627eea" tick={{ fontSize: 9 }} tickFormatter={v => '$' + Math.round(v).toLocaleString()} width={72} domain={['dataMin', 'dataMax']}><Label value="ETH" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#627eea', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            <RechartsTooltip content={() => null} />
            {showTotalEval && <Area yAxisId="right" type="monotone" dataKey="evalAmount" name="총자산" fill="rgba(156, 163, 175, 0.1)" stroke="#9ca3af" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />}
            {showPrincipal && <Line yAxisId="right" type="monotone" dataKey="principalAmount" name="투자원금" stroke="#22d3ee" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />}
            {showReturnRate && <Area yAxisId="left" type="monotone" dataKey="principalReturnRate" name="나의 수익률" fill="rgba(239, 68, 68, 0.1)" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls />}
            {!userFeatures.feature1 && showKospi && <Line yAxisId="left" type="monotone" dataKey="kospiRate" name="KOSPI" stroke="#38bdf8" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
            {!userFeatures.feature1 && showSp500 && <Line yAxisId="left" type="monotone" dataKey="sp500Rate" name="S&P500" stroke="#bf5af2" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
            {!userFeatures.feature1 && showNasdaq && <Line yAxisId="left" type="monotone" dataKey="nasdaqRate" name="NASDAQ" stroke="#30d158" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
            {!userFeatures.feature1 && effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <Line yAxisId="left" type="monotone" dataKey="us10yRateScaled" name="US 10Y" stroke="#8e8e93" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <Line yAxisId="right-us10y" dataKey="us10yPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <Line yAxisId="left" type="monotone" dataKey="goldIntlRateScaled" name="Gold" stroke={goldIndicatorColors.goldIntl} strokeWidth={1.5} dot={false} strokeDasharray={activePortfolioAccountType === 'gold' ? undefined : "4 2"} connectNulls />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <Line yAxisId="right-goldIntl" dataKey="goldIntlPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && (
              activePortfolioAccountType === 'gold'
                ? <Area yAxisId="left" type="monotone" dataKey="goldKrRateScaled" name="국내금" stroke={goldIndicatorColors.goldKr} strokeWidth={2} fill="url(#goldKrGradient)" dot={false} connectNulls />
                : <Line yAxisId="left" type="monotone" dataKey="goldKrRateScaled" name="국내금" stroke={goldIndicatorColors.goldKr} strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />
            )}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && <Line yAxisId="right-goldKr" dataKey="goldKrPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <Line yAxisId="left" type="monotone" dataKey="usdkrwRateScaled" name="USDKRW" stroke={goldIndicatorColors.usdkrw} strokeWidth={1.5} dot={false} strokeDasharray={activePortfolioAccountType === 'gold' ? undefined : "4 2"} connectNulls />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <Line yAxisId="right-usdkrw" dataKey="usdkrwPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <Line yAxisId="left" type="monotone" dataKey="dxyRateScaled" name="DXY" stroke={goldIndicatorColors.dxy} strokeWidth={1.5} dot={false} strokeDasharray={activePortfolioAccountType === 'gold' ? undefined : "4 2"} connectNulls />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <Line yAxisId="right-dxy" dataKey="dxyPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <Line yAxisId="left" type="monotone" dataKey="fedRateRateScaled" name="기준금리" stroke="#ff375f" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <Line yAxisId="right-fedRate" dataKey="fedRatePoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <Line yAxisId="left" type="monotone" dataKey="kr10yRateScaled" name="KR 10Y" stroke="#636366" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <Line yAxisId="right-kr10y" dataKey="kr10yPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.vix && indicatorHistoryMap.vix && <Area yAxisId="left" type="monotone" dataKey="vixRateScaled" name="VIX" stroke="#ff453a" strokeWidth={1.5} fill="url(#vixGradient)" strokeDasharray="4 2" connectNulls dot={false} />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.vix && indicatorHistoryMap.vix && <Line yAxisId="right-vix" dataKey="vixPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.btc && indicatorHistoryMap.btc && <Line yAxisId="left" type="monotone" dataKey="btcRateScaled" name="Bitcoin" stroke="#f7931a" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.btc && indicatorHistoryMap.btc && <Line yAxisId="right-btc" dataKey="btcPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.eth && indicatorHistoryMap.eth && <Line yAxisId="left" type="monotone" dataKey="ethRateScaled" name="Ethereum" stroke="#627eea" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {isXl && !userFeatures.feature1 && effectiveShowIndicators.eth && indicatorHistoryMap.eth && <Line yAxisId="right-eth" dataKey="ethPoint" stroke="transparent" dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && compStocks.map((comp, idx) =>
              comp.active ? <Line key={comp.id} yAxisId="left" type="monotone" dataKey={`comp${idx + 1}Rate`} name={comp.name} stroke={comp.color || '#10b981'} strokeWidth={1.5} dot={false} connectNulls={false} /> : null
            )}
            {showBacktest && <Area yAxisId="left" type="monotone" dataKey="backtestRate" name="백테스트(현재비중)" stroke={backtestColor} strokeWidth={2} fill="url(#backtestGradient)" strokeDasharray="6 3" dot={false} connectNulls />}
            {depositMarkers.map((evt, i) => (
              <ReferenceLine key={`dep-${i}`} yAxisId="left" x={evt.date} stroke="#22c55e" strokeWidth={1} strokeDasharray="2 4" strokeOpacity={0.7}
                label={({ viewBox }) => {
                  const { x, y } = viewBox;
                  return (
                    <g>
                      <text x={x} y={y + 10} textAnchor="middle" fill="#22c55e" fontSize={9} fontWeight={700}>▲</text>
                      <text x={x} y={y + 20} textAnchor="middle" fill="#22c55e" fontSize={8}>{fmtMarkerAmt(evt.amount)}</text>
                    </g>
                  );
                }}
              />
            ))}
            {withdrawalMarkers.map((evt, i) => (
              <ReferenceLine key={`wdw-${i}`} yAxisId="left" x={evt.date} stroke="#f87171" strokeWidth={1} strokeDasharray="2 4" strokeOpacity={0.7}
                label={({ viewBox }) => {
                  const { x, y } = viewBox;
                  return (
                    <g>
                      <text x={x} y={y + 10} textAnchor="middle" fill="#f87171" fontSize={9} fontWeight={700}>▼</text>
                      <text x={x} y={y + 20} textAnchor="middle" fill="#f87171" fontSize={8}>{fmtMarkerAmt(evt.amount)}</text>
                    </g>
                  );
                }}
              />
            ))}
            {refAreaLeft && refAreaRight && <ReferenceArea yAxisId="left" x1={refAreaLeft} x2={refAreaRight} fill="rgba(255, 255, 255, 0.1)" strokeOpacity={0.3} />}
            {hoveredPoint && !refAreaLeft && <ReferenceLine yAxisId="left" x={hoveredPoint.label} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {hoveredPoint && !refAreaLeft && hoveredPoint.payload
              .filter(p =>
                p.value != null &&
                typeof p.value === 'number' &&
                !String(p.dataKey ?? '').endsWith('Point') &&
                p.dataKey !== 'evalAmount' &&
                (!p.yAxisId || p.yAxisId === 'left')
              )
              .map((entry, i) => {
                const yVal = entry.value;
                const labelText = `${yVal >= 0 ? '+' : ''}${yVal.toFixed(2)}%`;
                const color = entry.stroke || entry.color || '#ef4444';
                return (
                  <ReferenceLine
                    key={i}
                    yAxisId="left"
                    y={yVal}
                    stroke={color}
                    strokeOpacity={0.6}
                    strokeWidth={1}
                    label={({ viewBox }) => {
                      const { x, y } = viewBox;
                      return (
                        <text x={x - 4} y={y + 3.5} textAnchor="end" fill={color} fontSize={10} fontWeight={700}>
                          {labelText}
                        </text>
                      );
                    }}
                  />
                );
              })
            }
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
