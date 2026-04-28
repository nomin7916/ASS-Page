// @ts-nocheck
import React, { useState, useMemo } from 'react';
import { Settings, Search, BarChart2, Percent, History, Activity, PanelLeftClose, PanelLeft, RefreshCw, X, Plus } from 'lucide-react';
import { ComposedChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Area, Line, ReferenceArea, ReferenceLine, Tooltip as RechartsTooltip, Label } from 'recharts';
import { formatShortDate, formatCurrency, formatNumber, buildIndexStatus } from '../utils';
import CustomDatePicker from './CustomDatePicker';
import { extractLinkLabel } from '../chartUtils';
import { CHART_NAME_TO_POINT_KEY } from '../constants';

const MA_PERIODS = [20, 60, 120, 240];
const MA_COLORS = ['#30d158', '#ffd60a', '#ff9f0a', '#bf5af2'];

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
  showMarketPanel, setShowMarketPanel,
  setIsScaleSettingOpen,
  showIndexVerify, setShowIndexVerify,
  showKospi,
  showSp500,
  showNasdaq,
  goldIndicators, setGoldIndicators,
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
  handleRemoveCompStock,
}) {
  const [showMA, setShowMA] = useState([false, false, false, false]);

  const chartDataWithMA = useMemo(() => {
    if (!showMA.some(Boolean)) return finalChartData;
    return finalChartData.map((point, i) => {
      const extra = {};
      MA_PERIODS.forEach((period, pi) => {
        if (!showMA[pi]) return;
        if (i < period - 1) { extra[`ma${pi + 1}`] = null; return; }
        const slice = finalChartData.slice(i - period + 1, i + 1);
        const rates = slice.map(p => p.returnRate).filter(v => v != null);
        extra[`ma${pi + 1}`] = rates.length >= Math.ceil(period / 2) ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
      });
      return { ...point, ...extra };
    });
  }, [finalChartData, showMA]);

  const hoveredData = hoveredPoint ? finalChartData.find(d => d.date === hoveredPoint.label) : null;
  const hoveredReturnRate = hoveredData?.returnRate ?? null;

  const CompStockDot = ({ code }) => {
    const st = stockFetchStatus?.[code];
    if (!st) return null;
    if (st === 'success') return <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block ml-0.5" title="갱신 완료" />;
    if (st === 'fail') return <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block ml-0.5" title="갱신 실패" />;
    if (st === 'loading') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-0.5 animate-pulse" title="갱신 중" />;
    return null;
  };

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
                  { key: 'goldIntl', label: 'Gold(국제)', color: '#ffd60a' },
                  { key: 'goldKr',   label: '국내금(KRX)', color: '#ff9f0a' },
                  { key: 'usdkrw',  label: 'USD/KRW', color: '#0a84ff' },
                  { key: 'dxy',     label: 'DXY', color: '#5ac8fa' },
                ]).map(({ key, label, color }) => {
                  const active = goldIndicators[key];
                  const loading = indicatorHistoryLoading[key];
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-0 rounded-md overflow-hidden shrink-0 border cursor-pointer transition-colors select-none"
                      style={{ borderColor: active ? color : '#4b5563', backgroundColor: active ? `${color}22` : '#1f2937' }}
                      onClick={() => {
                        if (!indicatorHistoryMap[key]) fetchIndicatorHistory(key, null, null);
                        setGoldIndicators(p => ({ ...p, [key]: !p[key] }));
                      }}
                    >
                      <div className="w-2 h-2 rounded-full mx-2 shrink-0" style={{ backgroundColor: color }} />
                      <span className="pr-2.5 py-1.5 text-[10px] font-bold" style={{ color: active ? color : '#6b7280' }}>{label}</span>
                      {loading && <RefreshCw size={10} className="animate-spin mr-1.5 text-gray-400" />}
                    </div>
                  );
                })}
              </div>
            )}
            {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && <div className="flex flex-wrap items-center gap-2">
              {compStocks.map((comp, idx) => {
                const histKeys = comp.active && stockHistoryMap[comp.code] ? Object.keys(stockHistoryMap[comp.code]).sort() : [];
                const isFallback = comp.active && histKeys.length === 1;
                const listingDate = stockListingDates[comp.code];
                const needsCoverage = comp.active && histKeys.length > 1 && !!appliedRange.start && histKeys[0] > appliedRange.start && !listingDate;
                const hasIssue = isFallback || needsCoverage;
                const color = comp.color || '#10b981';
                const borderColor = comp.active ? (hasIssue ? '#f97316' : color) : '#4b5563';
                const bgColor = comp.active ? (hasIssue ? 'rgba(249,115,22,0.1)' : `${color}22`) : '#1f2937';
                const textColor = comp.active ? (hasIssue ? '#fb923c' : color) : '#6b7280';
                const refreshTitle = isFallback ? '조회기간 전체 이력 불러오기' : needsCoverage ? `조회기간(${appliedRange.start}) 이전 데이터 없음 — 전체 이력 재조회` : '데이터 장애 시 강제 재조회';
                return (
                  <div key={idx} className="flex items-center gap-0 rounded-md overflow-hidden shrink-0 transition-colors border" style={{ borderColor, backgroundColor: bgColor }}>
                    <div className="relative flex items-center justify-center w-5 self-stretch border-r border-gray-700/50 hover:bg-gray-700/30 transition-colors" title="선 색상 변경">
                      <div className="w-2.5 h-2.5 rounded-full shadow-sm pointer-events-none" style={{ backgroundColor: color }} />
                      <input
                        type="color"
                        value={color}
                        onChange={e => { const n = [...compStocks]; n[idx] = { ...n[idx], color: e.target.value }; setCompStocks(n); }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <input type="text" className="bg-transparent text-[10px] px-2 py-1.5 outline-none text-center font-mono placeholder-gray-500 border-r transition-colors" style={{ width: '50px', borderColor, color: comp.active ? textColor : '#93c5fd' }} placeholder="코드" value={comp.code} onChange={e => { const n = [...compStocks]; n[idx] = { ...n[idx], code: e.target.value }; setCompStocks(n); }} onBlur={e => handleCompStockBlur(idx, e.target.value)} />
                    <button onClick={() => handleToggleComp(idx)} className="px-3 py-1.5 text-[10px] font-bold transition-colors min-w-[65px] max-w-[100px] truncate flex justify-center items-center gap-0.5" style={{ color: comp.loading ? '#9ca3af' : textColor, backgroundColor: comp.loading ? '#374151' : 'transparent', cursor: comp.loading ? 'wait' : 'pointer' }}>{comp.loading ? <RefreshCw size={12} className="animate-spin" /> : (comp.name || `종목${idx + 1}`)}<CompStockDot code={comp.code} /></button>
                    {comp.active && (
                      <button
                        onClick={() => { autoFetchedCodes.current.delete(comp.code); setStockListingDates(prev => { const n = { ...prev }; delete n[comp.code]; return n; }); handleFetchCompHistory(idx); }}
                        className={`px-1.5 py-1.5 transition-colors border-l ${hasIssue ? 'text-orange-400 hover:text-orange-200 hover:bg-orange-900/30 border-orange-700/40' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-700/40 border-gray-700/40'}`}
                        title={refreshTitle}
                      >
                        <RefreshCw size={10} />
                      </button>
                    )}
                    {compStocks.length > 1 && (
                      <button
                        onClick={() => handleRemoveCompStock(idx)}
                        className="px-1.5 py-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors border-l border-gray-700/40"
                        title="종목 제거"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                );
              })}
              {compStocks.length < 8 && (
                <button
                  onClick={handleAddCompStock}
                  className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-bold text-gray-500 hover:text-green-400 hover:bg-green-900/20 border border-gray-700 hover:border-green-700/50 transition-colors"
                  title="비교 종목 추가"
                >
                  <Plus size={11} />
                  <span>추가</span>
                </button>
              )}
              <button onClick={() => setShowIndexVerify(!showIndexVerify)} className={`px-2 py-1.5 rounded text-[11px] font-bold transition-colors flex items-center gap-1 ml-1 ${showIndexVerify ? 'bg-blue-900/50 text-blue-300 border border-blue-500/50' : 'bg-transparent text-gray-500 hover:bg-gray-700 border border-gray-700'}`} title="지수 데이터 검증">
                <Search size={12} />
              </button>
            </div>}
          </div>
          <div className="flex items-center justify-end gap-3 w-full xl:w-auto">
            <div className="flex items-center bg-gray-800 border border-gray-600 rounded shadow-sm px-1.5 py-1 relative z-30">
              <CustomDatePicker
                value={dateRange.start}
                onChange={v => { setDateRange(p => ({ ...p, start: v })); setChartPeriod('custom'); }}
              />
              <span className="text-gray-500 mx-0.5">~</span>
              <CustomDatePicker
                value={dateRange.end}
                onChange={v => { setDateRange(p => ({ ...p, end: v })); setChartPeriod('custom'); }}
              />
              <div className="w-[1px] h-4 bg-gray-600 mx-1.5"></div>
              <button onClick={handleSearchClick} className="text-blue-400 hover:text-blue-300 hover:bg-gray-700 rounded p-1.5 transition-colors" title="조회">
                <Search size={14} />
              </button>
            </div>
            <select value={chartPeriod} onChange={e => setChartPeriod(e.target.value)} className="bg-gray-800 text-gray-300 text-xs font-bold border border-gray-600 rounded px-2 py-1.5 outline-none cursor-pointer hover:bg-gray-700 transition-colors shadow-sm"><option value="1w">1주일</option><option value="1m">1개월</option><option value="3m">3개월</option><option value="6m">6개월</option><option value="1y">1년</option><option value="2y">2년</option><option value="3y">3년</option><option value="4y">4년</option><option value="5y">5년</option><option value="10y">10년</option><option value="all">전체</option><option value="custom" hidden>직접입력</option></select>
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
              onClick={() => setShowReturnRate(!showReturnRate)}
              className={`p-1.5 rounded border flex items-center justify-center transition-colors ${showReturnRate ? 'text-red-400 bg-red-900/20 border-red-700/40' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800 hover:border-gray-700'}`}
              title="수익률(%) 표시"
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
            <div className="w-px h-3 bg-gray-700 mx-0.5" />
            {MA_PERIODS.map((period, pi) => (
              <button
                key={pi}
                onClick={() => setShowMA(prev => { const n = [...prev]; n[pi] = !n[pi]; return n; })}
                className="px-1.5 py-1 rounded border text-[9px] font-bold transition-colors"
                style={showMA[pi] ? { color: MA_COLORS[pi], borderColor: MA_COLORS[pi] + '80', backgroundColor: MA_COLORS[pi] + '15' } : { color: '#6b7280', borderColor: 'transparent' }}
                title={`MA${period} 이동평균선`}
              >{period}</button>
            ))}
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
                  if (entry.name === '총자산') {
                    displayVal = formatNumber(rawValue);
                  } else {
                    const pointKey = CHART_NAME_TO_POINT_KEY[entry.name];
                    let pointVal = pointKey && entry.payload ? entry.payload[pointKey] : null;
                    const inlineCompMatch = dk?.match(/^comp(\d+)Rate$/);
                    if (pointVal == null && inlineCompMatch && entry.payload) {
                      pointVal = entry.payload[`comp${inlineCompMatch[1]}Point`];
                    }
                    const sign = Number(value) >= 0 ? '+' : '';
                    const rateStr = `${sign}${Number(value).toFixed(2)}%`;
                    if (pointVal != null) {
                      const isComp = !!inlineCompMatch;
                      const priceStr = isComp ? Number(pointVal).toLocaleString() : Number(pointVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      displayVal = `${rateStr} (${priceStr})`;
                    } else {
                      displayVal = rateStr;
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
      <div className="px-4 py-2 border-t border-gray-700/40 bg-[#060f1e]/70 min-h-[36px] shrink-0">
        {selectionResult ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-[10px] font-bold shrink-0">선택 기간</span>
              <span className="text-gray-300 text-[11px] font-bold">{formatShortDate(selectionResult.startDate)} ~ {formatShortDate(selectionResult.endDate)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm bg-red-500 shrink-0" />
                <span className="text-[11px] font-bold text-gray-300">나의 수익</span>
                <span className={`text-[12px] font-black ${selectionResult.profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {selectionResult.rate > 0 ? '+' : selectionResult.rate < 0 ? '' : ''}{selectionResult.rate.toFixed(2)}%
                </span>
                <span className={`text-[10px] font-bold ${selectionResult.profit >= 0 ? 'text-red-300/80' : 'text-blue-300/80'}`}>
                  ({selectionResult.profit >= 0 ? '+' : ''}{formatCurrency(selectionResult.profit)})
                </span>
              </div>
              {showBacktest && selectionResult.backtestPeriodRate != null && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: backtestColor }} />
                  <span className="text-[11px] font-bold text-gray-300">백테스트</span>
                  <span className={`text-[12px] font-black ${selectionResult.backtestPeriodRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {selectionResult.backtestPeriodRate > 0 ? '+' : ''}{selectionResult.backtestPeriodRate.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
            {compStocks.some(c => c.active && c.code) && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                {compStocks.map((comp, ci) => {
                  if (!comp.active || !comp.code) return null;
                  const rate = selectionResult[`comp${ci + 1}PeriodRate`];
                  if (rate == null) return null;
                  const startPt = finalChartData.find(d => d.date === selectionResult.startDate)?.[`comp${ci + 1}Point`];
                  const endPt = finalChartData.find(d => d.date === selectionResult.endDate)?.[`comp${ci + 1}Point`];
                  return (
                    <div key={comp.id} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: comp.color || '#10b981' }} />
                      <span className="text-[11px] font-bold" style={{ color: comp.color || '#10b981' }}>{comp.name}</span>
                      <span className={`text-[12px] font-black ${rate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
                      </span>
                      {startPt != null && endPt != null && (
                        <span className="text-[10px] text-gray-500 font-mono">
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
          <span className="text-gray-600 text-[10px]">차트를 드래그하면 기간별 수익이 표시됩니다</span>
        )}
      </div>

      <div className="chart-container-for-drag p-4 min-h-[400px] xl:flex-1 relative select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartDataWithMA} onMouseDown={handleChartMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp} onMouseLeave={handleChartMouseLeave}>
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
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#9ca3af" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="left" stroke="#ef4444" tickFormatter={v => v + '%'} tick={{ fontSize: 10 }} />
            {showTotalEval && <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" tickFormatter={v => v / 10000 + '만'} tick={{ fontSize: 10 }} />}
            {effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <YAxis yAxisId="right-us10y" orientation="right" stroke="#8e8e93" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)} width={52} domain={['dataMin', 'dataMax']}><Label value="US 10Y" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#8e8e93', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <YAxis yAxisId="right-goldIntl" orientation="right" stroke="#ffd60a" tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={56} domain={['dataMin', 'dataMax']}><Label value="Gold" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ffd60a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && <YAxis yAxisId="right-goldKr" orientation="right" stroke="#ff9f0a" tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={62} domain={['dataMin', 'dataMax']}><Label value="국내금" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ff9f0a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <YAxis yAxisId="right-usdkrw" orientation="right" stroke="#0a84ff" tick={{ fontSize: 9 }} tickFormatter={v => Math.round(v).toLocaleString()} width={56} domain={['dataMin', 'dataMax']}><Label value="USD/KRW" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#0a84ff', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <YAxis yAxisId="right-dxy" orientation="right" stroke="#5ac8fa" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(1)} width={52} domain={['dataMin', 'dataMax']}><Label value="DXY" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#5ac8fa', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <YAxis yAxisId="right-fedRate" orientation="right" stroke="#ff375f" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)+'%'} width={54} domain={['dataMin', 'dataMax']}><Label value="기준금리" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ff375f', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <YAxis yAxisId="right-kr10y" orientation="right" stroke="#636366" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(2)+'%'} width={52} domain={['dataMin', 'dataMax']}><Label value="KR 10Y" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#636366', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.vix && indicatorHistoryMap.vix && <YAxis yAxisId="right-vix" orientation="right" stroke="#ff453a" tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toFixed(1)} width={48} domain={['dataMin', 'dataMax']}><Label value="VIX" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#ff453a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.btc && indicatorHistoryMap.btc && <YAxis yAxisId="right-btc" orientation="right" stroke="#f7931a" tick={{ fontSize: 9 }} tickFormatter={v => '$' + Math.round(v).toLocaleString()} width={72} domain={['dataMin', 'dataMax']}><Label value="BTC" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#f7931a', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            {effectiveShowIndicators.eth && indicatorHistoryMap.eth && <YAxis yAxisId="right-eth" orientation="right" stroke="#627eea" tick={{ fontSize: 9 }} tickFormatter={v => '$' + Math.round(v).toLocaleString()} width={72} domain={['dataMin', 'dataMax']}><Label value="ETH" angle={90} position="insideRight" offset={14} style={{ textAnchor: 'middle', fill: '#627eea', fontSize: 11, fontWeight: 500 }} /></YAxis>}
            <RechartsTooltip content={() => null} />
            {showTotalEval && <Area yAxisId="right" type="monotone" dataKey="evalAmount" name="총자산" fill="rgba(156, 163, 175, 0.1)" stroke="#9ca3af" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />}
            {showReturnRate && <Area yAxisId="left" type="monotone" dataKey="returnRate" name="수익률" fill="rgba(239, 68, 68, 0.1)" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />}
            {!userFeatures.feature1 && showKospi && <Line yAxisId="left" type="monotone" dataKey="kospiRate" name="KOSPI" stroke="#38bdf8" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
            {!userFeatures.feature1 && showSp500 && <Line yAxisId="left" type="monotone" dataKey="sp500Rate" name="S&P500" stroke="#bf5af2" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
            {!userFeatures.feature1 && showNasdaq && <Line yAxisId="left" type="monotone" dataKey="nasdaqRate" name="NASDAQ" stroke="#30d158" strokeWidth={1.5} dot={false} strokeDasharray="3 3" filter="url(#neonGlow)" />}
            {!userFeatures.feature1 && effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <Line yAxisId="left" type="monotone" dataKey="us10yRateScaled" name="US 10Y" stroke="#8e8e93" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.us10y && indicatorHistoryMap.us10y && <Line yAxisId="right-us10y" dataKey="us10yPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <Line yAxisId="left" type="monotone" dataKey="goldIntlRateScaled" name="Gold" stroke="#ffd60a" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.goldIntl && indicatorHistoryMap.goldIntl && <Line yAxisId="right-goldIntl" dataKey="goldIntlPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && <Line yAxisId="left" type="monotone" dataKey="goldKrRateScaled" name="국내금" stroke="#ff9f0a" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.goldKr && indicatorHistoryMap.goldKr && <Line yAxisId="right-goldKr" dataKey="goldKrPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <Line yAxisId="left" type="monotone" dataKey="usdkrwRateScaled" name="USDKRW" stroke="#0a84ff" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.usdkrw && indicatorHistoryMap.usdkrw && <Line yAxisId="right-usdkrw" dataKey="usdkrwPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <Line yAxisId="left" type="monotone" dataKey="dxyRateScaled" name="DXY" stroke="#5ac8fa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.dxy && indicatorHistoryMap.dxy && <Line yAxisId="right-dxy" dataKey="dxyPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <Line yAxisId="left" type="monotone" dataKey="fedRateRateScaled" name="기준금리" stroke="#ff375f" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.fedRate && indicatorHistoryMap.fedRate && <Line yAxisId="right-fedRate" dataKey="fedRatePoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <Line yAxisId="left" type="monotone" dataKey="kr10yRateScaled" name="KR 10Y" stroke="#636366" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.kr10y && indicatorHistoryMap.kr10y && <Line yAxisId="right-kr10y" dataKey="kr10yPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.vix && indicatorHistoryMap.vix && <Area yAxisId="left" type="monotone" dataKey="vixRateScaled" name="VIX" stroke="#ff453a" strokeWidth={1.5} fill="url(#vixGradient)" strokeDasharray="4 2" connectNulls dot={false} />}
            {!userFeatures.feature1 && effectiveShowIndicators.vix && indicatorHistoryMap.vix && <Line yAxisId="right-vix" dataKey="vixPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.btc && indicatorHistoryMap.btc && <Line yAxisId="left" type="monotone" dataKey="btcRateScaled" name="Bitcoin" stroke="#f7931a" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.btc && indicatorHistoryMap.btc && <Line yAxisId="right-btc" dataKey="btcPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.eth && indicatorHistoryMap.eth && <Line yAxisId="left" type="monotone" dataKey="ethRateScaled" name="Ethereum" stroke="#627eea" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />}
            {!userFeatures.feature1 && effectiveShowIndicators.eth && indicatorHistoryMap.eth && <Line yAxisId="right-eth" dataKey="ethPoint" stroke="transparent" dot={false} legendType="none" tooltipType="none" connectNulls />}
            {!userFeatures.feature1 && activePortfolioAccountType !== 'gold' && compStocks.map((comp, idx) =>
              comp.active ? <Line key={comp.id} yAxisId="left" type="monotone" dataKey={`comp${idx + 1}Rate`} name={comp.name} stroke={comp.color || '#10b981'} strokeWidth={1.5} dot={false} connectNulls={false} /> : null
            )}
            {showBacktest && <Area yAxisId="left" type="monotone" dataKey="backtestRate" name="백테스트(현재비중)" stroke={backtestColor} strokeWidth={2} fill="url(#backtestGradient)" strokeDasharray="6 3" dot={false} connectNulls />}
            {refAreaLeft && refAreaRight && <ReferenceArea yAxisId="left" x1={refAreaLeft} x2={refAreaRight} fill="rgba(255, 255, 255, 0.1)" strokeOpacity={0.3} />}
            {showMA.map((active, pi) => active ? <Line key={`ma${pi + 1}`} yAxisId="left" type="monotone" dataKey={`ma${pi + 1}`} name={`MA${MA_PERIODS[pi]}`} stroke={MA_COLORS[pi]} strokeWidth={1.5} dot={false} connectNulls /> : null)}
            {hoveredPoint && !refAreaLeft && <ReferenceLine yAxisId="left" x={hoveredPoint.label} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />}
            {hoveredPoint && hoveredReturnRate != null && !refAreaLeft && <ReferenceLine yAxisId="left" y={hoveredReturnRate} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
