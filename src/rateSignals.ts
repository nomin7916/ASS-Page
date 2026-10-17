// 금리 모니터링 ③ '지금 적정 자산' 판정 — 순수 함수만(5단계, 2026-10).
// ⚠️ import 0건 · React 금지 · enum/namespace 금지 — scripts/verify-rate-signals.mjs가 미러 없이 직접 import한다.
// ⚠️ 입력은 rateMetrics.computeRateMetrics의 결과(키 → 지표)다. 여기서 시계열을 다시 계산하지 말 것.
// ⚠️ 문턱값은 전부 RATE_RULES 한 곳에 둔다(9단계에서 설정 화면이 이 객체를 고친다 — 함수 안에 숫자를 박지 말 것).
// ⚠️ 판정은 '상태 이름'(대기 / 매수 관심 / 매수 적기)만 낸다. 지시형 문구('사세요' 등)를 만들지 않는다.
// ⚠️ 자료가 없는 조건은 '충족'으로 치지 않는다(met=false, 근거에 '자료 없음').
// ⚠️ 6단계 종목 조건: 대표 종목(AGNC·O·MAIN·HYG)의 계산 행(rateAssets.buildRateAssetRow)을 두 번째 인자로 받는다.
//    수동 입력값(장부가·순자산)이 null이면 그 조건은 '입력 필요'(pending)로 표시하고 n/m에서 뺀다.

export const RATE_RULES = {
  withholdingPct: 15,             // 미국 배당·이자 원천징수(세후 수익률 = 세전 × (1 − 15%))
  krInterestTaxPct: 15.4,         // 한국 채권 이자소득세(지방세 포함) — 한국 채권(비교용) 세후
  tlt: { pctMin: 70, nearHighPp: 0.3 },
  hy: { positionMin: 70, crisisChange1mPp: 1.0 },
  mreit: { curvePctMax: 30, mbsPctMin: 60, pbMax: 0.9, pbWarn: 1.1 },
  reit: { pctMin: 70, oYieldMin: 6.0 },
  bdc: { fedPctMin: 50, hyChangeMaxPp: 1.0, hyPctMax: 70, mainDrawdownMax: -15, mainPnavMax: 1.5 },
  krBond: { pctMin: 70 },
};

export type SignalState = 'wait' | 'watch' | 'buy';
export const SIGNAL_STATE_LABEL: Record<SignalState, string> = { wait: '대기', watch: '매수 관심', buy: '매수 적기' };

interface AssetLike { price: number | null; yield12: number | null; yieldPost: number | null; drawdown52: number | null; pb: number | null; pnav: number | null; manualSet?: boolean }
type Assets = Record<string, AssetLike | null | undefined> | null | undefined;
interface MetricsLike {
  current: number | null; change1m: number | null; high52: number | null;
  position52: number | null; pct3y: number | null; turnedDown: boolean;
}
export interface SignalCondition { label: string; met: boolean; detail: string; pending?: boolean }
export interface SignalYield { label: string; pre: number; post: number }
export interface AssetSignal {
  key: string; label: string; sample: string;
  state: SignalState; warning: string | null; note: string | null;
  conditions: SignalCondition[]; met: number; total: number; ratio: number;
  rationale: string; yields: SignalYield[];
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pct = (v: number | null) => (num(v) ? `${v.toFixed(2)}%` : '자료 없음');
const pp = (v: number | null) => (num(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%p` : '자료 없음');
const rank = (v: number | null) => (num(v) ? v.toFixed(0) : '-');
const M = (all: Record<string, MetricsLike> | null | undefined, k: string): MetricsLike =>
  (all && all[k]) || { current: null, change1m: null, high52: null, position52: null, pct3y: null, turnedDown: false };

const yieldOf = (label: string, v: number | null): SignalYield[] =>
  num(v) ? [{ label, pre: v, post: v * (1 - RATE_RULES.withholdingPct / 100) }] : [];

const pending = (label: string, detail = '입력 필요'): SignalCondition => ({ label, met: false, detail, pending: true });
const A = (assets: Assets, t: string): AssetLike | null => (assets && assets[t]) || null;
const yieldOfAsset = (label: string, a: AssetLike | null): SignalYield[] =>
  a && num(a.yield12) ? [{ label, pre: a.yield12, post: a.yield12 * (1 - RATE_RULES.withholdingPct / 100) }] : [];
const ratio = (v: number | null) => (num(v) ? v.toFixed(2) : '자료 없음');

function finish(base: Omit<AssetSignal, 'met' | 'total' | 'ratio'>): AssetSignal {
  const live = base.conditions.filter(c => !c.pending);
  const met = live.filter(c => c.met).length;
  const total = live.length;
  return { ...base, met, total, ratio: total ? met / total : 0 };
}

// ① 미국 장기채(TLT)
export function evalLongBond(all: Record<string, MetricsLike>): AssetSignal {
  const r = RATE_RULES.tlt;
  const a = M(all, 'us10y'), b = M(all, 'us30y');
  const highPct = (m: MetricsLike) => num(m.pct3y) && m.pct3y >= r.pctMin;
  const nearHigh = (m: MetricsLike) => num(m.current) && num(m.high52) && m.high52 - m.current <= r.nearHighPp + 1e-9;
  const gap = (m: MetricsLike) => (num(m.current) && num(m.high52) ? m.current - m.high52 : null);
  const c1 = !!(highPct(a) || highPct(b));
  const c2 = !!(nearHigh(a) || nearHigh(b));
  const c3 = !!((num(a.current) && a.turnedDown) || (num(b.current) && b.turnedDown));
  const conditions: SignalCondition[] = [
    { label: `10년 또는 30년 금리가 최근 3년 중 ${r.pctMin} 이상`, met: c1, detail: `10년 ${rank(a.pct3y)} · 30년 ${rank(b.pct3y)}` },
    { label: `52주 최고에서 ${r.nearHighPp.toFixed(1)}%p 이내`, met: c2, detail: `10년 ${pp(gap(a))} · 30년 ${pp(gap(b))}` },
    { label: '최근 20일 최고에서 꺾여 내려옴', met: c3, detail: `10년 ${a.turnedDown ? '꺾임' : '꺾임 없음'} · 30년 ${b.turnedDown ? '꺾임' : '꺾임 없음'}` },
  ];
  const state: SignalState = c1 && c2 && c3 ? 'buy' : c1 && c2 ? 'watch' : 'wait';
  return finish({
    key: 'longBond', label: '미국 장기채', sample: 'TLT', state, warning: null, note: null, conditions,
    rationale: `10년 ${pct(a.current)}(3년 ${rank(a.pct3y)}) · 30년 ${pct(b.current)}(3년 ${rank(b.pct3y)}) · 52주 최고 대비 10년 ${pp(gap(a))}`,
    yields: [...yieldOf('10년', a.current), ...yieldOf('30년', b.current)],
  });
}

// ② 하이일드 ETF
export function evalHighYield(all: Record<string, MetricsLike>, assets?: Assets): AssetSignal {
  const r = RATE_RULES.hy;
  const s = M(all, 'hySpread'), y = M(all, 'hyYield');
  const c1 = num(s.position52) && s.position52 >= r.positionMin;
  const c2 = num(y.position52) && y.position52 >= r.positionMin;
  const c3 = num(s.current) && s.turnedDown;
  const crisis = num(s.change1m) && s.change1m >= r.crisisChange1mPp - 1e-9;
  const conditions: SignalCondition[] = [
    { label: `스프레드가 52주 범위 ${r.positionMin}% 이상`, met: c1, detail: `연중 위치 ${rank(s.position52)}%` },
    { label: `하이일드 금리가 52주 범위 ${r.positionMin}% 이상`, met: c2, detail: `연중 위치 ${rank(y.position52)}%` },
    { label: '스프레드가 최근 20일 최고에서 꺾여 내려옴', met: c3, detail: s.turnedDown ? '꺾임' : '꺾임 없음' },
  ];
  const raw: SignalState = c1 && c2 && c3 ? 'buy' : c1 && c2 ? 'watch' : 'wait';
  return finish({
    key: 'highYield', label: '하이일드 ETF', sample: 'HYG', state: crisis ? 'wait' : raw,
    warning: crisis ? '신용 불안 진행 중' : null, note: null, conditions,
    rationale: `하이일드 금리 ${pct(y.current)} · 스프레드 ${pp(s.current)}(1개월 ${pp(s.change1m)})`,
    yields: [...yieldOf('하이일드 금리', y.current), ...yieldOfAsset('HYG 배당률', A(assets, 'HYG'))],
  });
}

// ③ 모기지 리츠(AGNC)
export function evalMortgageReit(all: Record<string, MetricsLike>, assets?: Assets): AssetSignal {
  const r = RATE_RULES.mreit;
  const c = M(all, 't10y2y'), m = M(all, 'mbsSpread'), v = M(all, 'move');
  const c1 = (num(c.current) && c.current <= 0) || (num(c.pct3y) && c.pct3y <= r.curvePctMax);
  const c2 = num(m.pct3y) && m.pct3y >= r.mbsPctMin;
  const c3 = num(v.current) && v.turnedDown;
  const ag = A(assets, 'AGNC');
  const pb = ag ? ag.pb : null;
  const pbInput = !ag || !ag.manualSet; // 주당 장부가(수동값)가 비어 있다 → '입력 필요'(n/m 제외)
  const c4 = num(pb) && pb <= r.pbMax + 1e-9;
  const pbHot = num(pb) && pb >= r.pbWarn - 1e-9;
  const conditions: SignalCondition[] = [
    { label: `10년−2년 역전(0 이하) 또는 최근 3년 중 ${r.curvePctMax} 이하`, met: !!c1, detail: `${pp(c.current)} · 3년 ${rank(c.pct3y)}` },
    { label: `MBS 스프레드가 최근 3년 중 ${r.mbsPctMin} 이상`, met: !!c2, detail: `${pp(m.current)} · 3년 ${rank(m.pct3y)}` },
    { label: 'MOVE가 최근 20일 최고에서 꺾여 내려옴', met: !!c3, detail: v.turnedDown ? '꺾임' : '꺾임 없음' },
    pbInput ? pending(`AGNC 주가 ÷ 장부가 ${r.pbMax} 이하`, 'AGNC 주당 장부가 입력 필요')
      : { label: `AGNC 주가 ÷ 장부가 ${r.pbMax} 이하`, met: !!c4, detail: num(pb) ? `${ratio(pb)}배` : '자료 없음' },
  ];
  // ④가 '입력 필요'면 n/m에서 빠지므로 적기 판정을 막지 않는다. 값이 있으면 ④까지 맞아야 적기.
  const state: SignalState = c1 && c2 && c3 && (pbInput || c4) ? 'buy' : c1 && c2 ? 'watch' : 'wait';
  return finish({
    key: 'mortgageReit', label: '모기지 리츠', sample: 'AGNC', state,
    warning: pbHot ? `AGNC 주가 ÷ 장부가 ${ratio(pb)}배 — 유상증자 위험` : null,
    note: c1 && !c2 && !c3 ? '역전 구간 — 배당 삭감 위험 함께 점검' : null, conditions,
    rationale: `10년−2년 ${pp(c.current)} · MBS 스프레드 ${pp(m.current)}(3년 ${rank(m.pct3y)}) · MOVE ${num(v.current) ? v.current.toFixed(1) : '자료 없음'}`,
    yields: yieldOfAsset('AGNC 배당률', ag),
  });
}

// ④ 실물 리츠(O)
export function evalEquityReit(all: Record<string, MetricsLike>, assets?: Assets): AssetSignal {
  const r = RATE_RULES.reit;
  const a = M(all, 'us10y');
  const c1 = num(a.pct3y) && a.pct3y >= r.pctMin;
  const c2 = num(a.current) && a.turnedDown;
  const o = A(assets, 'O');
  const oy = o ? o.yield12 : null;
  const c3 = num(oy) && oy >= r.oYieldMin - 1e-9;
  const conditions: SignalCondition[] = [
    { label: `10년 금리가 최근 3년 중 ${r.pctMin} 이상`, met: !!c1, detail: `3년 ${rank(a.pct3y)}` },
    { label: '10년 금리가 최근 20일 최고에서 꺾여 내려옴', met: !!c2, detail: a.turnedDown ? '꺾임' : '꺾임 없음' },
    { label: `리얼티인컴(O) 12개월 배당률 ${r.oYieldMin.toFixed(1)}% 이상`, met: !!c3, detail: pct(oy) },
  ];
  const state: SignalState = c1 && c2 && c3 ? 'buy' : c1 ? 'watch' : 'wait';
  return finish({
    key: 'equityReit', label: '실물 리츠', sample: 'O', state, warning: null, note: null, conditions,
    rationale: `10년 ${pct(a.current)}(3년 ${rank(a.pct3y)}) · ${a.turnedDown ? '꺾임' : '꺾임 없음'} · O 배당률 ${pct(oy)}`,
    yields: yieldOfAsset('O 배당률', o),
  });
}

// ⑤ BDC(MAIN) — 금리가 높을 때 이자 수익이 느는 구조라 채권과 반대로 읽는다. ③(MAIN 가격)까지 맞으면 '매수 적기'.
export function evalBdc(all: Record<string, MetricsLike>, assets?: Assets): AssetSignal {
  const r = RATE_RULES.bdc;
  const f = M(all, 'fedRate'), s = M(all, 'hySpread');
  const c1 = num(f.pct3y) && f.pct3y >= r.fedPctMin;
  const c2 = num(s.change1m) && s.change1m < r.hyChangeMaxPp && num(s.pct3y) && s.pct3y < r.hyPctMax;
  const mn = A(assets, 'MAIN');
  const dd = mn ? mn.drawdown52 : null, pn = mn ? mn.pnav : null;
  const c3 = (num(dd) && dd <= r.mainDrawdownMax + 1e-9) || (num(pn) && pn <= r.mainPnavMax + 1e-9);
  const conditions: SignalCondition[] = [
    { label: `기준금리가 최근 3년 중 ${r.fedPctMin} 이상`, met: !!c1, detail: `${pct(f.current)} · 3년 ${rank(f.pct3y)}` },
    { label: `하이일드 스프레드 1개월 +${r.hyChangeMaxPp.toFixed(1)}%p 미만 · 3년 ${r.hyPctMax} 미만`, met: !!c2, detail: `1개월 ${pp(s.change1m)} · 3년 ${rank(s.pct3y)}` },
    { label: `MAIN 52주 최고 대비 ${r.mainDrawdownMax}% 이하 또는 주가 ÷ 순자산 ${r.mainPnavMax} 이하`, met: !!c3,
      detail: `52주 최고 대비 ${num(dd) ? `${dd.toFixed(1)}%` : '자료 없음'} · 순자산 배율 ${num(pn) ? `${ratio(pn)}배` : !mn || !mn.manualSet ? '순자산 입력 필요' : '자료 없음'}` },
  ];
  return finish({
    key: 'bdc', label: 'BDC', sample: 'MAIN', state: c1 && c2 && c3 ? 'buy' : c1 && c2 ? 'watch' : 'wait', warning: null,
    note: 'BDC는 금리가 높을 때 받는 이자가 늘어 채권과 반대로 읽습니다', conditions,
    rationale: `기준금리 ${pct(f.current)}(3년 ${rank(f.pct3y)}) · 스프레드 1개월 ${pp(s.change1m)} · MAIN 52주 최고 대비 ${num(dd) ? `${dd.toFixed(1)}%` : '자료 없음'}`,
    yields: yieldOfAsset('MAIN 배당률', mn),
  });
}

// ⑥ 한국 채권(비교용) — 미국 자산과 비교하기 위한 참고 줄. 세후는 이자소득세 15.4%.
export function evalKrBond(all: Record<string, MetricsLike>): AssetSignal {
  const r = RATE_RULES.krBond;
  const a = M(all, 'kr10y'), b = M(all, 'kr3y');
  const c1 = num(a.pct3y) && a.pct3y >= r.pctMin;
  const c2 = num(a.current) && a.turnedDown;
  const conditions: SignalCondition[] = [
    { label: `국고채 10년이 최근 3년 중 ${r.pctMin} 이상`, met: !!c1, detail: `3년 ${rank(a.pct3y)}` },
    { label: '국고채 10년이 최근 20일 최고에서 꺾여 내려옴', met: !!c2, detail: a.turnedDown ? '꺾임' : '꺾임 없음' },
  ];
  const tax = 1 - RATE_RULES.krInterestTaxPct / 100;
  const ky = (label: string, v: number | null): SignalYield[] => (num(v) ? [{ label, pre: v, post: v * tax }] : []);
  return finish({
    key: 'krBond', label: '한국 채권(비교용)', sample: '국고채', state: c1 && c2 ? 'buy' : c1 ? 'watch' : 'wait',
    warning: null, note: '미국 자산과 비교하기 위한 참고 줄입니다', conditions,
    rationale: `국고채 3년 ${pct(b.current)} · 10년 ${pct(a.current)}(3년 ${rank(a.pct3y)}) · ${a.turnedDown ? '꺾임' : '꺾임 없음'}`,
    yields: [...ky('3년', b.current), ...ky('10년', a.current)],
  });
}

// 6개 자산군 — 충족 비율 내림차순(같으면 정의 순서)
export function evaluateRateSignals(all: Record<string, MetricsLike> | null | undefined, assets?: Assets): AssetSignal[] {
  const m = all || {};
  const list = [evalLongBond(m), evalHighYield(m, assets), evalMortgageReit(m, assets), evalEquityReit(m, assets), evalBdc(m, assets), evalKrBond(m)];
  return list.map((s, i) => [s, i] as const)
    .sort((x, y) => y[0].ratio - x[0].ratio || x[1] - y[1])
    .map(([s]) => s);
}
