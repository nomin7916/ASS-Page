export function useChartInteraction({
  finalChartData,
  intChartData,
  compStocks,
  INDICATOR_CHART_KEYS,
  isDragging, setIsDragging,
  refAreaLeft, setRefAreaLeft,
  refAreaRight, setRefAreaRight,
  setSelectionResult,
  setHoveredPoint,
  intIsDragging, setIntIsDragging,
  intRefAreaLeft, setIntRefAreaLeft,
  intRefAreaRight, setIntRefAreaRight,
  setIntSelectionResult,
}: {
  finalChartData: any[];
  intChartData: any[];
  compStocks: any[];
  INDICATOR_CHART_KEYS: string[];
  isDragging: boolean; setIsDragging: (v: boolean) => void;
  refAreaLeft: string; setRefAreaLeft: (v: string) => void;
  refAreaRight: string; setRefAreaRight: (v: string) => void;
  setSelectionResult: (v: any) => void;
  setHoveredPoint: (v: any) => void;
  intIsDragging: boolean; setIntIsDragging: (v: boolean) => void;
  intRefAreaLeft: string; setIntRefAreaLeft: (v: string) => void;
  intRefAreaRight: string; setIntRefAreaRight: (v: string) => void;
  setIntSelectionResult: (v: any) => void;
}) {
  const calculateSelection = (left: string, right: string) => {
    if (!left || !right) return null;
    const idx1 = finalChartData.findIndex(d => d.date === left);
    const idx2 = finalChartData.findIndex(d => d.date === right);
    if (idx1 === -1 || idx2 === -1 || idx1 === idx2) return null;
    const sData = finalChartData[Math.min(idx1, idx2)];
    const eData = finalChartData[Math.max(idx1, idx2)];
    const profit = eData.evalAmount - sData.evalAmount;
    const rate = sData.evalAmount > 0 ? (profit / sData.evalAmount) * 100 : 0;
    const indPeriodRates: Record<string, number | null> = {};
    INDICATOR_CHART_KEYS.forEach(k => {
      const sp = sData[`${k}Point`]; const ep = eData[`${k}Point`];
      indPeriodRates[`${k}PeriodRate`] = (sp > 0 && ep != null) ? ((ep / sp) - 1) * 100 : null;
    });
    const backtestPeriodRate = (sData.backtestRate != null && eData.backtestRate != null)
      ? ((100 + eData.backtestRate) / (100 + sData.backtestRate) - 1) * 100
      : null;
    return {
      startDate: sData.date, endDate: eData.date, profit, rate,
      kospiPeriodRate: sData.kospiPoint > 0 ? ((eData.kospiPoint / sData.kospiPoint) - 1) * 100 : null,
      sp500PeriodRate: sData.sp500Point > 0 ? ((eData.sp500Point / sData.sp500Point) - 1) * 100 : null,
      nasdaqPeriodRate: sData.nasdaqPoint > 0 ? ((eData.nasdaqPoint / sData.nasdaqPoint) - 1) * 100 : null,
      backtestPeriodRate,
      ...Object.fromEntries(compStocks.map((_, ci) => {
        const pk = `comp${ci + 1}Point`;
        return [`comp${ci + 1}PeriodRate`, (sData[pk] > 0 && eData[pk] != null) ? ((eData[pk] / sData[pk]) - 1) * 100 : null];
      })),
      ...indPeriodRates
    };
  };

  const handleChartMouseDown = (e: any) => {
    if (e?.activeLabel) { setIsDragging(true); setRefAreaLeft(e.activeLabel); setRefAreaRight(''); setSelectionResult(null); }
  };

  const handleChartMouseMove = (e: any) => {
    if (isDragging && refAreaLeft && e?.activeLabel) { setRefAreaRight(e.activeLabel); setSelectionResult(calculateSelection(refAreaLeft, e.activeLabel)); }
    if (e?.activeLabel && e?.activePayload?.length) setHoveredPoint({ label: e.activeLabel, payload: e.activePayload });
  };

  const handleChartMouseUp = () => {
    setIsDragging(false);
    if (refAreaLeft && refAreaRight && refAreaLeft !== refAreaRight) setSelectionResult(calculateSelection(refAreaLeft, refAreaRight));
    else { setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); }
  };

  const handleChartMouseLeave = () => { handleChartMouseUp(); setHoveredPoint(null); };

  const handleIntChartMouseDown = (e: any) => {
    if (e && e.activeLabel) {
      setIntIsDragging(true);
      setIntRefAreaLeft(e.activeLabel);
      setIntRefAreaRight('');
      setIntSelectionResult(null);
    }
  };

  const handleIntChartMouseMove = (e: any) => {
    if (intIsDragging && e && e.activeLabel) setIntRefAreaRight(e.activeLabel);
  };

  const handleIntChartMouseUp = () => {
    if (!intIsDragging) return;
    setIntIsDragging(false);
    if (!intRefAreaLeft || !intRefAreaRight || intRefAreaLeft === intRefAreaRight) {
      setIntRefAreaLeft(''); setIntRefAreaRight(''); return;
    }
    const [l, r] = [intRefAreaLeft, intRefAreaRight].sort();
    const startEntry = intChartData.find((d: any) => d.date >= l);
    const endEntry = [...intChartData].reverse().find((d: any) => d.date <= r);
    if (startEntry && endEntry) {
      const profit = endEntry.evalAmount - startEntry.evalAmount;
      const rate = startEntry.evalAmount > 0 ? ((endEntry.evalAmount / startEntry.evalAmount) - 1) * 100 : 0;
      setIntSelectionResult({ startDate: startEntry.date, endDate: endEntry.date, profit, rate });
    }
    setIntRefAreaLeft(''); setIntRefAreaRight('');
  };

  return {
    handleChartMouseDown, handleChartMouseMove, handleChartMouseUp, handleChartMouseLeave,
    handleIntChartMouseDown, handleIntChartMouseMove, handleIntChartMouseUp,
  };
}
