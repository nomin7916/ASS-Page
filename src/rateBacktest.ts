// 금리 모니터링 — 과거 신호 검증(9-B, 2026-10). 순수 함수만.
// ⚠️ import 0건 · React 금지 · enum 금지 — scripts/verify-rate-signals.mjs가 미러 없이 직접 import한다.
// ⚠️ 판정 함수는 인자로 받는다(rateSignals.evaluateOne을 창이 넘긴다) — 이 모듈은 날짜별 지표를 만들고 신호·성과만 계산한다.
// ⚠️ 금리 지표 조건만 쓴다(종목·수동값·정치 메모는 제외). 종가·배당은 창 메모리에서 받는다(저장 금지).

export type Pt = [string, number];
export interface BtMetrics {
  current: number | null; asOf: string | null; change1m: number | null; high52: number | null; low52: number | null;
  position52: number | null; pct3y: number | null; high20: number | null; turnedDown: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EPS = 1e-9;
const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const fromDayNum = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export const shiftDays = (iso: string, d: number) => fromDayNum(dayNum(iso) + d);
// N개월 뒤(말일 보정: 1/31 + 1개월 = 2/28)
export function addMonthsIso(iso: string, n: number): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function pointsOf(series: Record<string, unknown> | null | undefined): Pt[] {
  if (!series || typeof series !== 'object') return [];
  const out: Pt[] = [];
  for (const d of Object.keys(series)) {
    const raw: any = (series as any)[d];
    if (!ISO.test(d) || raw === null || raw === '' || typeof raw === 'boolean') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out.push([d, v]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
// 날짜 d 그날 또는 직전 관측의 위치(없으면 -1)
export function indexOnOrBefore(pts: Pt[], d: string): number {
  let lo = 0, hi = pts.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
const valueOnOrBefore = (pts: Pt[], d: string, upto: number) => {
  const i = indexOnOrBefore(pts, d);
  return i >= 0 && i <= upto ? pts[i][1] : null;
};

// pts[0..i]만 보고 계산한 지표 — rateMetrics.computeRateMetrics와 같은 규칙(검증 #42가 결과를 대조한다)
export function metricsAt(pts: Pt[], i: number): BtMetrics {
  if (i < 0 || i >= pts.length) return { current: null, asOf: null, change1m: null, high52: null, low52: null, position52: null, pct3y: null, high20: null, turnedDown: false };
  const [asOf, current] = pts[i];
  const ago = valueOnOrBefore(pts, shiftDays(asOf, -30), i);
  const from52 = shiftDays(asOf, -365), from3 = shiftDays(asOf, -3 * 365);
  let high52: number | null = null, low52: number | null = null, below = 0, equal = 0, n3 = 0;
  for (let j = i; j >= 0; j--) {
    const [d, v] = pts[j];
    if (d < from3) break;
    n3++;
    if (v < current - EPS) below++; else if (Math.abs(v - current) <= EPS) equal++;
    if (d > from52) { high52 = high52 == null ? v : Math.max(high52, v); low52 = low52 == null ? v : Math.min(low52, v); }
  }
  let high20: number | null = null;
  for (let j = i; j >= 0 && j > i - 20; j--) high20 = high20 == null ? pts[j][1] : Math.max(high20, pts[j][1]);
  return {
    current, asOf, change1m: ago == null ? null : current - ago, high52, low52,
    position52: high52 != null && low52 != null && high52 - low52 > EPS ? ((current - low52) / (high52 - low52)) * 100 : null,
    pct3y: n3 ? ((below + equal / 2) / n3) * 100 : null,
    high20, turnedDown: high20 != null && current < high20 - EPS,
  };
}

// 자산군별 과거 검증 정의 — calendar = 날짜를 고르는 기준 지표(그 자산군 차트에 있는 날짜), keys = 판정에 쓰는 지표
export interface BtAssetDef { key: string; label: string; calendar: string; keys: string[]; rep: string | null; color: string; core: string[] }
export const RATE_BT_ASSETS: BtAssetDef[] = [
  { key: 'longBond', label: '미국 장기채', calendar: 'us10y', keys: ['us10y', 'us30y'], rep: 'TLT', color: '#fbbf24', core: ['us10y', 'us30y'] },
  { key: 'highYield', label: '하이일드 ETF', calendar: 'hySpread', keys: ['hySpread', 'hyYield'], rep: 'HYG', color: '#f472b6', core: ['hyYield', 'hySpread'] },
  { key: 'mortgageReit', label: '모기지 리츠', calendar: 'mbsSpread', keys: ['t10y2y', 'mbsSpread', 'move'], rep: 'AGNC', color: '#fb923c', core: ['t10y2y', 'mbsSpread'] },
  { key: 'equityReit', label: '실물 리츠', calendar: 'us10y', keys: ['us10y'], rep: 'O', color: '#38bdf8', core: ['us10y'] },
  { key: 'bdc', label: 'BDC', calendar: 'hySpread', keys: ['fedRate', 'hySpread'], rep: 'MAIN', color: '#a78bfa', core: ['fedRate', 'hySpread'] },
  { key: 'krBond', label: '한국 채권(비교용)', calendar: 'kr10y', keys: ['kr10y', 'kr3y'], rep: null, color: '#2dd4bf', core: ['kr10y'] },
  { key: 'brBond', label: '브라질 국채', calendar: 'br10y', keys: ['br10y', 'brReal', 'brExp12', 'brSelic', 'brlkrw'], rep: null, color: '#4ade80', core: ['br10y', 'brReal'] },
];
export const BT_MIN_GAP = 20;        // 같은 자산군 신호 사이 최소 거래일(기준 지표 관측 수)
export const BT_HORIZONS = [3, 6, 12];

// 날짜별 상태 — evaluate(key, metricsByKey, extras) → { state } (창이 rateSignals.evaluateOne(…, { rateOnly: true })를 넘긴다)
export function historyStates(def: BtAssetDef, seriesByKey: Record<string, any>, evaluate: (key: string, all: any, extras: any) => any, opts?: { warmupDays?: number }): Array<{ date: string; state: string; core: Record<string, number | null> }> {
  const cal = pointsOf(seriesByKey?.[def.calendar]);
  if (!cal.length) return [];
  const pts: Record<string, Pt[]> = {};
  for (const k of def.keys) pts[k] = pointsOf(seriesByKey?.[k]);
  const exp = def.key === 'brBond' ? pointsOf(seriesByKey?.brExp12) : [];
  const sel = def.key === 'brBond' ? pointsOf(seriesByKey?.brSelic) : [];
  const start = shiftDays(cal[0][0], opts?.warmupDays ?? 365);   // 백분위가 서도록 1년은 건너뛴다
  const out: Array<{ date: string; state: string; core: Record<string, number | null> }> = [];
  for (const [d] of cal) {
    if (d < start) continue;
    const all: Record<string, BtMetrics> = {};
    for (const k of def.keys) all[k] = metricsAt(pts[k], indexOnOrBefore(pts[k], d));
    let extras: any = null;
    if (def.key === 'brBond') {
      const ie = indexOnOrBefore(exp, d);
      const e0 = ie >= 0 ? exp[ie][1] : null, e3 = ie >= 0 ? valueOnOrBefore(exp, shiftDays(exp[ie][0], -90), ie) : null;
      const is = indexOnOrBefore(sel, d);
      let rose: boolean | null = is >= 1 ? false : null;
      if (is >= 1) { const from = shiftDays(sel[is][0], -60); for (let j = is; j >= 1 && sel[j][0] > from; j--) if (sel[j][1] > sel[j - 1][1] + EPS) { rose = true; break; } }
      extras = { exp12Change3m: e0 != null && e3 != null ? e0 - e3 : null, selicRose60d: rose, notes: [], today: d };
    }
    const sig = evaluate(def.key, all, extras);
    const core: Record<string, number | null> = {};
    for (const k of def.core) core[k] = all[k]?.current ?? null;
    out.push({ date: d, state: sig?.state || 'wait', core });
  }
  return out;
}

// '매수 적기'에 새로 들어간 날만 — 하루 전에는 아니었고, 직전 신호와 minGap 관측 이상 떨어진 날
export function extractSignals<T extends { date: string; state: string }>(states: T[], minGap = BT_MIN_GAP): Array<T & { index: number }> {
  const out: Array<T & { index: number }> = [];
  let last = -Infinity;
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    if (s.state !== 'buy') continue;
    if (i > 0 && states[i - 1].state === 'buy') continue;
    if (i - last < minGap) continue;
    out.push({ ...s, index: i });
    last = i;
  }
  return out;
}

// 신호 뒤 N개월 성과 — 주가 변화(%)와 배당 합계 포함 총수익(%, 재투자 없음). 기간이 아직 안 지났으면 pending
export function performanceAfter(prices: Pt[], divs: Array<{ exDate: string; amount: number }>, start: string, months: number, today: string):
  { pending: true } | { pending: false; price: number; total: number } | null {
  const i0 = indexOnOrBefore(prices, start);
  if (i0 < 0) return null;
  const end = addMonthsIso(start, months);
  const lastDate = prices.length ? prices[prices.length - 1][0] : '';
  if (end > today || end > lastDate) return { pending: true };
  const i1 = indexOnOrBefore(prices, end);
  const p0 = prices[i0][1], p1 = prices[i1][1];
  if (!(p0 > 0)) return null;
  const div = (divs || []).filter(x => x && x.exDate > prices[i0][0] && x.exDate <= prices[i1][0]).reduce((a, x) => a + (Number(x.amount) || 0), 0);
  return { pending: false, price: (p1 / p0 - 1) * 100, total: ((p1 + div) / p0 - 1) * 100 };
}
// 지표 변화(브라질 — 헤알·원 %, 10년 금리 %p)
export function changeAfter(pts: Pt[], start: string, months: number, today: string, mode: 'pct' | 'pp'): { pending: true } | { pending: false; value: number } | null {
  const i0 = indexOnOrBefore(pts, start);
  if (i0 < 0) return null;
  const end = addMonthsIso(start, months);
  const lastDate = pts.length ? pts[pts.length - 1][0] : '';
  if (end > today || end > lastDate) return { pending: true };
  const v0 = pts[i0][1], v1 = pts[indexOnOrBefore(pts, end)][1];
  if (mode === 'pct') return v0 > 0 ? { pending: false, value: (v1 / v0 - 1) * 100 } : null;
  return { pending: false, value: v1 - v0 };
}
// 자산군 요약 — 신호 수 · 12개월 값 평균 · 플러스 비율(끝난 신호만)
export function summarizeSignals(values: Array<number | null>): { count: number; done: number; avg: number | null; winRate: number | null } {
  const done = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return {
    count: values.length, done: done.length,
    avg: done.length ? done.reduce((a, v) => a + v, 0) / done.length : null,
    winRate: done.length ? (done.filter(v => v > 0).length / done.length) * 100 : null,
  };
}
