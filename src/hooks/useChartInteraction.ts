import { useEffect, useRef } from 'react';

// 차트 구간 선택의 **진행 상태 정본은 이 ref**다 (⚠️ 회귀 주의 — React state로 되돌리지 말 것).
//   anchor  : 더블클릭으로 고정한 시작점(''이면 앵커 없음)
//   left    : 구간 시작(앵커가 있으면 앵커와 같다)
//   right   : 구간 끝(''이면 아직 미정 = 단순 클릭)
//   dragging: 마우스 버튼을 누른 채인가
type ChartSel = { anchor: string; left: string; right: string; dragging: boolean };
const emptyChartSel = (): ChartSel => ({ anchor: '', left: '', right: '', dragging: false });

// 더블클릭의 두 번째 클릭(detail>=2)에서 발생하는 mousedown/mouseup은 무시한다.
// 그대로 두면 '앵커 확정 → 즉시 선택 확정 → 해제'가 한 제스처 안에서 연달아 일어나 화면이 번쩍인다.
// (Touch 경로는 detail이 없어 항상 false — 기존 동작 그대로.)
const isSecondClick = (ev: any) => ((ev && ev.detail) || 0) >= 2;

export function useChartInteraction({
  finalChartData,
  intChartData,
  compStocks,
  INDICATOR_CHART_KEYS,
  // ⚠️ 읽기용 state(refAreaLeft/refAreaRight/isDragging)는 **일부러 받지 않는다** — 아래 ref가
  //    정본이고, 지연 커밋되는 state를 읽을 수 있게 두면 이 훅이 고치려는 버그가 그대로 되살아난다.
  //    (구조적 불변식: 훅 안에서 그 값들을 참조할 방법 자체가 없어야 한다.)
  setIsDragging,
  setRefAreaLeft,
  setRefAreaRight,
  setSelectionResult,
  setHoveredPoint,
  setAnchorDate,
  setIntIsDragging,
  setIntRefAreaLeft,
  setIntRefAreaRight,
  setIntSelectionResult,
  setIntHoveredPoint,
  setIntAnchorDate,
}: {
  finalChartData: any[];
  intChartData: any[];
  compStocks: any[];
  INDICATOR_CHART_KEYS: string[];
  setIsDragging: (v: boolean) => void;
  setRefAreaLeft: (v: string) => void;
  setRefAreaRight: (v: string) => void;
  setSelectionResult: (v: any) => void;
  setHoveredPoint: (v: any) => void;
  setAnchorDate: (v: string) => void;
  setIntIsDragging: (v: boolean) => void;
  setIntRefAreaLeft: (v: string) => void;
  setIntRefAreaRight: (v: string) => void;
  setIntSelectionResult: (v: any) => void;
  setIntHoveredPoint: (v: any) => void;
  setIntAnchorDate: (v: string) => void;
}) {
  // ⚠️ 왜 ref가 정본인가 (이 훅의 존재 이유이자 '긴 조회기간에서 드래그가 안 되던' 버그의 원인):
  //    mousemove의 setState는 React 18에서 ContinuousLane → Scheduler(UserBlocking) **매크로태스크**로
  //    비동기 커밋되고, mouseup은 DiscreteLane이라 그 자리에서 즉시 처리된다. 차트가 무거우면
  //    (조회기간이 길수록 포인트 수 × 시리즈 수만큼 recharts 재렌더가 오래 걸린다) mousemove가
  //    커밋되기 전에 mouseup이 먼저 실행돼, mouseup 핸들러가 **직전 커밋 렌더의 클로저**를 쓰면서
  //    refAreaRight가 ''인 채로 '단순 클릭 = 해제' 분기를 타 **선택이 통째로 사라졌다**.
  //    ref는 커밋과 무관하게 동기 갱신되므로 렌더 속도와 정확성이 완전히 분리된다.
  const acctRef = useRef<ChartSel>(emptyChartSel());
  const intRef = useRef<ChartSel>(emptyChartSel());
  // 커서가 차트 밖에서 버튼을 놓아도 확정되게 하는 window mouseup(포인터 캡처 대용).
  const winUpRef = useRef<any>(null);
  // 활성 tick이 바뀌지 않은 mousemove는 통째로 건너뛴다(같은 tick 안 1px 이동마다 앱 전체가
  // 리렌더되던 낭비 제거). 화면에 보이는 값은 tick 단위라 시각적 변화가 없다.
  // ⚠️ 차트별로 분리한다 — 두 차트가 같은 ref를 쓰면 뷰를 전환한 직후 같은 날짜에 커서를 올렸을 때
  //    첫 갱신이 통째로 스킵돼 호버 패널이 한 tick 동안 갱신되지 않는다.
  const hoverKeyRef = useRef<string>('');
  const intHoverKeyRef = useRef<string>('');
  // window mouseup 커밋은 mousedown 시점 클로저가 아니라 **최신 렌더의 핸들러**를 써야
  // calculateSelection이 최신 finalChartData를 본다. (렌더 중 대입 — 이 ref는 이벤트에서만 읽힌다.)
  const commitRef = useRef<any>({ acct: null, int: null });

  const disarmWindowUp = () => {
    if (!winUpRef.current) return;
    window.removeEventListener('mouseup', winUpRef.current);
    window.removeEventListener('blur', winUpRef.current);
    winUpRef.current = null;
  };
  // ⚠️ blur도 함께 듣는다 — mouseleave가 더 이상 드래그를 취소하지 않으므로, 버튼을 누른 채
  //    alt-tab 하면 mouseup이 영영 오지 않아 dragging이 true로 고착된다(그 상태로 돌아오면
  //    버튼을 안 눌렀는데도 구간이 커서를 따라온다). blur 시점에 그대로 확정해 끝낸다.
  const armWindowUp = (which: 'acct' | 'int') => {
    disarmWindowUp();
    const h = () => {
      disarmWindowUp();
      const fn = commitRef.current[which];
      if (fn) fn();
    };
    winUpRef.current = h;
    window.addEventListener('mouseup', h);
    window.addEventListener('blur', h);
  };

  // ⚠️ App이 state를 직접 지우는 경로(차트 밖 클릭·조회기간 변경)는 **ref도 함께** 지워야 한다.
  //    ref가 정본이라 한쪽만 지우면 다음 mousedown이 유령 앵커를 되살린다.
  //    refs·setter는 전부 안정 참조라 첫 렌더 클로저를 [] deps effect가 잡아도 안전하다.
  const resetChartSelectionRefs = () => {
    acctRef.current = emptyChartSel();
    intRef.current = emptyChartSel();
    hoverKeyRef.current = '';
    intHoverKeyRef.current = '';
    disarmWindowUp();
  };

  useEffect(() => disarmWindowUp, []);

  // Esc = 앵커·선택 취소. 지울 게 있을 때만 동작해 다른 화면에 부작용을 만들지 않는다.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      const a = acctRef.current;
      const i = intRef.current;
      if (!a.anchor && !a.left && !i.anchor && !i.left) return;
      resetChartSelectionRefs();
      setIsDragging(false); setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); setAnchorDate('');
      setIntIsDragging(false); setIntRefAreaLeft(''); setIntRefAreaRight(''); setIntSelectionResult(null); setIntAnchorDate('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  //
  // ⚠️ 앵커(더블클릭으로 고정한 시작점)가 있으면 **누른 지점이 시작점을 덮어쓰지 않는다** —
  // 그 지점은 '종료점 후보'다. 이래야 "더블클릭으로 시작을 확실히 하고 드래그로 끝을 고른다"가 성립한다.
  const handleChartMouseDown = (e: any, ev?: any) => {
    if (isSecondClick(ev)) return;
    const label = e?.activeLabel;
    const s = acctRef.current;
    if (label) {
      s.dragging = true;
      if (s.anchor) { s.right = label; setRefAreaRight(label); setSelectionResult(calculateSelection(s.left, label)); }
      else { s.left = label; s.right = ''; setIsDragging(true); setRefAreaLeft(label); setRefAreaRight(''); setSelectionResult(null); }
      armWindowUp('acct');
    } else { resetChartSelectionRefs(); setIsDragging(false); setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null); setAnchorDate(''); }
  };

  const handleChartMouseMove = (e: any, ev?: any) => {
    const s = acctRef.current;
    // ⚠️ 자가치유 — 버튼이 이미 떼어졌는데 dragging이 남아 있으면(브라우저 크롬 위에서 놓기,
    //    컨텍스트 메뉴, blur를 못 받은 alt-tab) 그 자리에서 확정하고 끝낸다. mouseleave가 더는
    //    취소하지 않으므로 이 가드가 없으면 '버튼도 안 눌렀는데 구간이 따라오는' 상태로 고착된다.
    //    ⚠️ 앵커 미리보기(dragging=false)는 원래 버튼 없이 따라오므로 여기 걸리면 안 된다.
    if (s.dragging && ev && ev.buttons === 0) { handleChartMouseUp(); return; }
    const label = e?.activeLabel;
    if (!label) return;
    // 앵커 모드에서는 버튼을 누르지 않아도 미리보기가 따라온다(클릭 확정·드래그 확정 둘 다 지원).
    if (s.left && (s.dragging || s.anchor) && s.right !== label) {
      s.right = label;
      setRefAreaRight(label);
      setSelectionResult(calculateSelection(s.left, label));
    }
    if (hoverKeyRef.current === label) return;
    hoverKeyRef.current = label;
    if (e?.activePayload?.length) setHoveredPoint({ label, payload: e.activePayload });
  };

  // ⚠️ 판정은 전부 ref(정본)에서 읽는다 — React state를 읽으면 커밋 지연으로 '방금 끈 구간'이 사라진다.
  const handleChartMouseUp = (_e?: any, ev?: any) => {
    if (isSecondClick(ev)) return;
    disarmWindowUp();
    const s = acctRef.current;
    const wasAnchored = !!s.anchor;
    if (!s.dragging && !wasAnchored) return;
    s.dragging = false;
    setIsDragging(false);
    const left = s.left;
    const right = s.right;
    if (left && right && left !== right) {
      s.anchor = '';
      setAnchorDate('');
      setRefAreaLeft(left); setRefAreaRight(right);
      setSelectionResult(calculateSelection(left, right));
    } else if (wasAnchored) {
      // 앵커 위에서 그대로 놓았다 — 시작점은 유지하고 종료점 지정을 계속 기다린다.
      s.right = '';
      setRefAreaRight(''); setSelectionResult(null);
    } else {
      s.left = ''; s.right = '';
      setRefAreaLeft(''); setRefAreaRight(''); setSelectionResult(null);
    }
  };

  // ⚠️ 커서가 차트 밖으로 나가도 **드래그를 취소하지 않는다**. 종전엔 mouseleave가 곧 mouseUp이라,
  //    구간을 끝까지 끌다 플롯을 살짝 넘기면 선택이 통째로 사라졌다(축 거터가 얇아 아주 쉽게 발생).
  //    확정은 mousedown에서 무장한 window mouseup(armWindowUp)이 맡는다.
  const handleChartMouseLeave = () => { hoverKeyRef.current = ''; setHoveredPoint(null); };

  // 더블클릭 = 시작점 고정. 이후 이동하면 미리보기, 클릭하거나 드래그해 놓으면 종료점 확정.
  const handleChartDoubleClick = (e: any) => {
    const label = e?.activeLabel;
    if (!label) return;
    const s = acctRef.current;
    disarmWindowUp();
    s.anchor = label; s.left = label; s.right = ''; s.dragging = false;
    setIsDragging(false);
    setAnchorDate(label);
    setRefAreaLeft(label); setRefAreaRight(''); setSelectionResult(null);
  };

  // ── 통합 대시보드 차트 핸들러 ──
  // ⚠️ 플롯 영역 밖 클릭 = 해제 (개별 차트와 같은 이유 — 위 handleChartMouseDown 주석 참조).
  const handleIntChartMouseDown = (e: any, ev?: any) => {
    if (isSecondClick(ev)) return;
    const label = e?.activeLabel;
    const s = intRef.current;
    if (label) {
      s.dragging = true;
      if (s.anchor) { s.right = label; setIntRefAreaRight(label); setIntSelectionResult(calculateIntSelection(s.left, label)); }
      else { s.left = label; s.right = ''; setIntIsDragging(true); setIntRefAreaLeft(label); setIntRefAreaRight(''); setIntSelectionResult(null); }
      armWindowUp('int');
    } else { resetChartSelectionRefs(); setIntIsDragging(false); setIntRefAreaLeft(''); setIntRefAreaRight(''); setIntSelectionResult(null); setIntAnchorDate(''); }
  };

  const handleIntChartMouseMove = (e: any, ev?: any) => {
    const s = intRef.current;
    if (s.dragging && ev && ev.buttons === 0) { handleIntChartMouseUp(); return; }
    const label = e?.activeLabel;
    if (!label) return;
    if (s.left && (s.dragging || s.anchor) && s.right !== label) {
      s.right = label;
      setIntRefAreaRight(label);
      setIntSelectionResult(calculateIntSelection(s.left, label));
    }
    if (intHoverKeyRef.current === label) return;
    intHoverKeyRef.current = label;
    if (e?.activePayload?.length) setIntHoveredPoint({ label, payload: e.activePayload });
  };

  const handleIntChartMouseUp = (_e?: any, ev?: any) => {
    if (isSecondClick(ev)) return;
    disarmWindowUp();
    const s = intRef.current;
    const wasAnchored = !!s.anchor;
    if (!s.dragging && !wasAnchored) return;
    s.dragging = false;
    setIntIsDragging(false);
    // ⚠️ 드래그 없는 '단순 클릭'은 선택 해제다 — calculateIntSelection에 그대로 넘기지 말 것.
    // 클릭만 하면 right가 ''인데, 그 함수의 [l,r].sort()는 ''를 맨 앞으로 보내
    // 'l="" → 첫 데이터부터'로 해석해 **차트 시작~클릭 지점**이라는 있지도 않은 구간을 돌려준다.
    // 그러면 하이라이트(intRefAreaLeft && intRefAreaRight)는 안 뜨는데 패널만 '선택 기간'으로
    // 바뀌어 화면이 서로 모순된다.
    const left = s.left;
    const right = s.right;
    if (left && right && left !== right) {
      s.anchor = '';
      setIntAnchorDate('');
      setIntRefAreaLeft(left); setIntRefAreaRight(right);
      setIntSelectionResult(calculateIntSelection(left, right));
    } else if (wasAnchored) {
      s.right = '';
      setIntRefAreaRight(''); setIntSelectionResult(null);
    } else {
      s.left = ''; s.right = '';
      setIntRefAreaLeft(''); setIntRefAreaRight(''); setIntSelectionResult(null);
    }
  };

  const handleIntChartMouseLeave = () => { intHoverKeyRef.current = ''; setIntHoveredPoint(null); };

  const handleIntChartDoubleClick = (e: any) => {
    const label = e?.activeLabel;
    if (!label) return;
    const s = intRef.current;
    disarmWindowUp();
    s.anchor = label; s.left = label; s.right = ''; s.dragging = false;
    setIntIsDragging(false);
    setIntAnchorDate(label);
    setIntRefAreaLeft(label); setIntRefAreaRight(''); setIntSelectionResult(null);
  };

  // ⚠️ 렌더 중 대입(effect 아님) — window mouseup 커밋이 항상 최신 finalChartData/intChartData를
  //    본 calculateSelection을 쓰게 한다. 이 ref는 이벤트 핸들러에서만 읽힌다.
  commitRef.current.acct = handleChartMouseUp;
  commitRef.current.int = handleIntChartMouseUp;

  return {
    handleChartMouseDown, handleChartMouseMove, handleChartMouseUp, handleChartMouseLeave, handleChartDoubleClick,
    handleIntChartMouseDown, handleIntChartMouseMove, handleIntChartMouseUp, handleIntChartMouseLeave, handleIntChartDoubleClick,
    resetChartSelectionRefs,
  };
}
