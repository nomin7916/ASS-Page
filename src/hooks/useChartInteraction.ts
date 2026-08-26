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
    // 구간 수익률 = 두 끝점 재베이스 누적 TWR의 비(조회시작 base가 약분된다) — 입출금 왜곡 없음.
    // 구간 실손익 = 누적 실손익(Σ 일간 손익)의 차분. 평가액 raw 차분(입출금 포함)으로 되돌리지 말 것.
    const rate = (s.returnRate != null && e.returnRate != null)
      ? ((100 + e.returnRate) / (100 + s.returnRate) - 1) * 100 : 0;
    const profit = (s.cumProfit != null && e.cumProfit != null)
      ? e.cumProfit - s.cumProfit
      : (e.evalAmount - s.evalAmount);
    const result: any = { startDate: s.date, endDate: e.date, profit, rate, startEval: s.evalAmount, endEval: e.evalAmount };
    compStocks.forEach((_: any, ci: number) => {
      const key = `comp${ci + 1}Rate`;
      const sr = s[key];
      const er = e[key];
      result[`comp${ci + 1}PeriodRate`] = (sr != null && er != null) ? ((100 + er) / (100 + sr) - 1) * 100 : null;
    });
    return result;
  };

  // ── 개별 계좌 차트 핸들러 ──
  // ⚠️ recharts는 **플롯 영역 밖**(Y축 눈금 거터·X축 날짜 띠)을 눌러도 onMouseDown을 부른다 —
  // `handleOuterEvent`가 `getMouseInfo` 결과를 `mouse ?? {}`로 넘기기 때문(inRange가 플롯 rect만 검사).
  // 그때 activeLabel이 없다고 **아무것도 하지 않으면** 선택이 그대로 남는데, 그 영역은
  // `.chart-container-for-drag` 안이라 App.tsx의 차트 밖 클릭 해제도 건너뛴다 → 딤이 고착된다.
  // (종전엔 잔존 선택이 흰색 8~10% 띠라 티가 안 났다. 딤으로 바뀌며 대가가 커졌다.)
  const handleChartMouseDown = (e: any) => {
    if (e?.activeLabel) { setIsDragging(true); setRefAreaLeft(e.activeLabel); setRefAreaRight(''); setSelectionResult(null); }
    else { setIsDragging(false); setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); }
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
  // ⚠️ 플롯 영역 밖 클릭 = 해제 (개별 차트와 같은 이유 — 위 handleChartMouseDown 주석 참조).
  const handleIntChartMouseDown = (e: any) => {
    if (e?.activeLabel) { setIntIsDragging(true); setIntRefAreaLeft(e.activeLabel); setIntRefAreaRight(''); setIntSelectionResult(null); }
    else { setIntIsDragging(false); setIntRefAreaLeft(''); setIntRefAreaRight(''); setIntSelectionResult(null); }
  };

  const handleIntChartMouseMove = (e: any) => {
    if (intIsDragging && e?.activeLabel) setIntRefAreaRight(e.activeLabel);
    if (e?.activeLabel && e?.activePayload?.length) setIntHoveredPoint({ label: e.activeLabel, payload: e.activePayload });
  };

  const handleIntChartMouseUp = () => {
    if (!intIsDragging) return;
    setIntIsDragging(false);
    // ⚠️ 드래그 없는 '단순 클릭'은 선택 해제다 — calculateIntSelection에 그대로 넘기지 말 것.
    // 클릭만 하면 intRefAreaRight가 ''인데, 그 함수의 [l,r].sort()는 ''를 맨 앞으로 보내
    // 'l="" → 첫 데이터부터'로 해석해 **차트 시작~클릭 지점**이라는 있지도 않은 구간을 돌려준다.
    // 그러면 하이라이트(intRefAreaLeft && intRefAreaRight)는 안 뜨는데 패널만 '선택 기간'으로
    // 바뀌어 화면이 서로 모순된다. 개별 계좌 차트(handleChartMouseUp)는 원래부터 이 가드가 있다.
    const result = (intRefAreaLeft && intRefAreaRight && intRefAreaLeft !== intRefAreaRight)
      ? calculateIntSelection(intRefAreaLeft, intRefAreaRight)
      : null;
    if (result) {
      setIntSelectionResult(result);
    } else {
      setIntRefAreaLeft(''); setIntRefAreaRight(''); setIntSelectionResult(null);
    }
  };

  const handleIntChartMouseLeave = () => { setIntHoveredPoint(null); handleIntChartMouseUp(); };

  return {
    handleChartMouseDown, handleChartMouseMove, handleChartMouseUp, handleChartMouseLeave,
    handleIntChartMouseDown, handleIntChartMouseMove, handleIntChartMouseUp, handleIntChartMouseLeave,
  };
}
