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
  setIntHoveredPoint,
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
  setIntHoveredPoint: (v: any) => void;
}) {
  // 개별 계좌 차트 선택 계산 (지수·비교종목·백테스트 포함)
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
    const sPrin = Number(sData.principalAmount) || 0;
    const ePrin = Number(eData.principalAmount) || 0;
    return {
      startDate: sData.date, endDate: eData.date, profit, rate,
      startEval: sData.evalAmount,
      endEval: eData.evalAmount,
      startProfit: sData.evalAmount - sPrin,
      endProfit: eData.evalAmount - ePrin,
      kospiPeriodRate: sData.kospiPoint > 0 ? ((eData.kospiPoint / sData.kospiPoint) - 1) * 100 : null,
      sp500PeriodRate: sData.sp500Point > 0 ? ((eData.sp500Point / sData.sp500Point) - 1) * 100 : null,
      nasdaqPeriodRate: sData.nasdaqPoint > 0 ? ((eData.nasdaqPoint / sData.nasdaqPoint) - 1) * 100 : null,
      backtestPeriodRate,
      principalReturnRateAtEnd: eData.principalReturnRate ?? null,
      principalAtEnd: eData.principalAmount ?? null,
      // 조회시작 0%(TWR) 모드 전용 구간 수익률 — 라인이 재베이스된 누적 TWR이므로 구간값은
      // 두 끝점의 비(조회시작 base가 약분된다). 원금대비 모드에서는 의미가 없어 쓰지 않는다.
      // 시작점이 null(데이터 이전 구간)이면 재베이스 기준점=0%로 본다 — 라인이 조회시작에서
      // 정확히 0%로 시작하므로 이 폴백이 라인과 일치한다. 종료점이 null이면 산출 불가.
      myReturnPeriodRate: eData.principalReturnRate != null
        ? ((100 + eData.principalReturnRate) / (100 + (sData.principalReturnRate ?? 0)) - 1) * 100 : null,
      ...Object.fromEntries(compStocks.map((_, ci) => {
        const pk = `comp${ci + 1}Point`;
        return [`comp${ci + 1}PeriodRate`, (sData[pk] > 0 && eData[pk] != null) ? ((eData[pk] / sData[pk]) - 1) * 100 : null];
      })),
      ...indPeriodRates
    };
  };

  // 통합 대시보드 차트 선택 계산 (evalAmount 기반 + 비교종목 기간 수익률)
  const calculateIntSelection = (l: string, r: string) => {
    const [left, right] = [l, r].sort();
    const s = intChartData.find((d: any) => d.date >= left);
    const e = [...intChartData].reverse().find((d: any) => d.date <= right);
    if (!s || !e || s.date === e.date) return null;
    const profit = e.evalAmount - s.evalAmount;
    const result: any = { startDate: s.date, endDate: e.date, profit, rate: s.evalAmount > 0 ? ((e.evalAmount / s.evalAmount) - 1) * 100 : 0 };
    compStocks.forEach((_: any, ci: number) => {
      const key = `comp${ci + 1}Rate`;
      const sr = s[key];
      const er = e[key];
      result[`comp${ci + 1}PeriodRate`] = (sr != null && er != null) ? ((100 + er) / (100 + sr) - 1) * 100 : null;
    });
    return result;
  };

  // ── 개별 계좌 차트 핸들러 ──
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

  // ── 통합 대시보드 차트 핸들러 ──
  const handleIntChartMouseDown = (e: any) => {
    if (e?.activeLabel) { setIntIsDragging(true); setIntRefAreaLeft(e.activeLabel); setIntRefAreaRight(''); setIntSelectionResult(null); }
  };

  const handleIntChartMouseMove = (e: any) => {
    if (intIsDragging && e?.activeLabel) setIntRefAreaRight(e.activeLabel);
    if (e?.activeLabel && e?.activePayload?.length) setIntHoveredPoint({ label: e.activeLabel, payload: e.activePayload });
  };

  const handleIntChartMouseUp = () => {
    if (!intIsDragging) return;
    setIntIsDragging(false);
    const result = calculateIntSelection(intRefAreaLeft, intRefAreaRight);
    if (result) {
      setIntSelectionResult(result);
    } else {
      setIntRefAreaLeft(''); setIntRefAreaRight('');
    }
  };

  const handleIntChartMouseLeave = () => { setIntHoveredPoint(null); handleIntChartMouseUp(); };

  return {
    handleChartMouseDown, handleChartMouseMove, handleChartMouseUp, handleChartMouseLeave,
    handleIntChartMouseDown, handleIntChartMouseMove, handleIntChartMouseUp, handleIntChartMouseLeave,
  };
}
