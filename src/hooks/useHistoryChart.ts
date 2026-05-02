// @ts-nocheck
import { useState } from 'react';

export function useHistoryChart() {
  // ── 개별 계좌 차트 상태 ──
  const [chartPeriod, setChartPeriod] = useState('3m');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' });
  const [isDragging, setIsDragging] = useState(false);
  const [refAreaLeft, setRefAreaLeft] = useState('');
  const [refAreaRight, setRefAreaRight] = useState('');
  const [selectionResult, setSelectionResult] = useState(null);
  const [showTotalEval, setShowTotalEval] = useState(true);
  const [showReturnRate, setShowReturnRate] = useState(true);
  const [showBacktest, setShowBacktest] = useState(false);
  const [backtestColor, setBacktestColor] = useState('#f97316');
  const [isZeroBaseMode, setIsZeroBaseMode] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [hoveredPortCatSlice, setHoveredPortCatSlice] = useState(null);
  const [hoveredPortStkSlice, setHoveredPortStkSlice] = useState(null);
  const [hoveredIntCatSlice, setHoveredIntCatSlice] = useState(null);
  const [hoveredIntHoldSlice, setHoveredIntHoldSlice] = useState(null);
  const [hoveredRebalCatSlice, setHoveredRebalCatSlice] = useState(null);
  const [hoveredCurCatSlice, setHoveredCurCatSlice] = useState(null);

  // ── 지수·지표 차트 표시 설정 ──
  const [showKospi, setShowKospi] = useState(true);
  const [showSp500, setShowSp500] = useState(false);
  const [showNasdaq, setShowNasdaq] = useState(false);
  const [showIndicatorsInChart, setShowIndicatorsInChart] = useState({
    us10y: false, kr10y: false, goldIntl: false, goldKr: false, usdkrw: false, dxy: false, fedRate: false, vix: false, btc: false, eth: false,
  });
  const [goldIndicators, setGoldIndicators] = useState({ goldIntl: true, goldKr: true, usdkrw: false, dxy: false });
  const [goldIndicatorColors, setGoldIndicatorColors] = useState({ goldIntl: '#ffd60a', goldKr: '#ff9f0a', usdkrw: '#0a84ff', dxy: '#5ac8fa' });
  const [indicatorScales, setIndicatorScales] = useState({ us10y: 1, goldIntl: 1, goldKr: 1, usdkrw: 1, dxy: 1, fedRate: 1, kr10y: 1, vix: 1, btc: 1, eth: 1 });
  const [isScaleSettingOpen, setIsScaleSettingOpen] = useState(false);

  // ── 패널·금액 표시 ──
  const [showMarketPanel, setShowMarketPanel] = useState(true);
  const [hideAmounts, setHideAmounts] = useState(false);

  // ── 통합 대시보드 차트 상태 ──
  const [intChartPeriod, setIntChartPeriod] = useState('1y');
  const [intDateRange, setIntDateRange] = useState({ start: '', end: '' });
  const [intAppliedRange, setIntAppliedRange] = useState({ start: '', end: '' });
  const [intRefAreaLeft, setIntRefAreaLeft] = useState('');
  const [intRefAreaRight, setIntRefAreaRight] = useState('');
  const [intSelectionResult, setIntSelectionResult] = useState(null);
  const [intIsDragging, setIntIsDragging] = useState(false);
  const [intIsZeroBaseMode, setIntIsZeroBaseMode] = useState(true);
  const [intHoveredPoint, setIntHoveredPoint] = useState(null);

  return {
    // 개별 계좌 차트
    chartPeriod, setChartPeriod,
    dateRange, setDateRange,
    appliedRange, setAppliedRange,
    isDragging, setIsDragging,
    refAreaLeft, setRefAreaLeft,
    refAreaRight, setRefAreaRight,
    selectionResult, setSelectionResult,
    showTotalEval, setShowTotalEval,
    showReturnRate, setShowReturnRate,
    showBacktest, setShowBacktest,
    backtestColor, setBacktestColor,
    isZeroBaseMode, setIsZeroBaseMode,
    hoveredPoint, setHoveredPoint,
    hoveredPortCatSlice, setHoveredPortCatSlice,
    hoveredPortStkSlice, setHoveredPortStkSlice,
    hoveredIntCatSlice, setHoveredIntCatSlice,
    hoveredIntHoldSlice, setHoveredIntHoldSlice,
    hoveredRebalCatSlice, setHoveredRebalCatSlice,
    hoveredCurCatSlice, setHoveredCurCatSlice,
    // 지수·지표 표시
    showKospi, setShowKospi,
    showSp500, setShowSp500,
    showNasdaq, setShowNasdaq,
    showIndicatorsInChart, setShowIndicatorsInChart,
    goldIndicators, setGoldIndicators,
    goldIndicatorColors, setGoldIndicatorColors,
    indicatorScales, setIndicatorScales,
    isScaleSettingOpen, setIsScaleSettingOpen,
    // 패널·금액
    showMarketPanel, setShowMarketPanel,
    hideAmounts, setHideAmounts,
    // 통합 대시보드 차트
    intChartPeriod, setIntChartPeriod,
    intDateRange, setIntDateRange,
    intAppliedRange, setIntAppliedRange,
    intRefAreaLeft, setIntRefAreaLeft,
    intRefAreaRight, setIntRefAreaRight,
    intSelectionResult, setIntSelectionResult,
    intIsDragging, setIntIsDragging,
    intIsZeroBaseMode, setIntIsZeroBaseMode,
    intHoveredPoint, setIntHoveredPoint,
  };
}
