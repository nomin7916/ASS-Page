// 금리 모니터링(RateWindow) 계산 — 순수 함수만(4단계, 2026-10).
// ⚠️ import 0건 · React 금지 · enum/namespace 금지 — scripts/verify-rate-metrics.mjs가 미러 없이 직접 import한다.
// ⚠️ 금리차(t10y2y·t10y3m)·MBS 스프레드는 **0·음수가 정상값**이다 — 여기서는 어떤 값도 부호로 버리지 않는다
//    (유효성은 '유한한 숫자인가'만 본다). 양수만 받는 다른 지표 경로와 섞지 말 것.

export type Series = Record<string, number>;

export interface RateMetrics {
  current: number | null;       // 현재값(가장 최근 관측)
  asOf: string | null;          // 기준일(YYYY-MM-DD)
  change1m: number | null;      // 1개월 변화 = 현재 − 30일 전(그날 또는 직전 관측) — 단위는 원래 값의 단위(%p 등)
  high52: number | null;        // 52주 최고
  low52: number | null;         // 52주 최저
  position52: number | null;    // 연중 위치(%) = (현재 − 52주 최저) ÷ (52주 최고 − 52주 최저) × 100
  pct3y: number | null;         // 3년 백분위(0~100)
  band: 'low' | 'mid' | 'high' | null; // 백분위 0~30 낮음 / 30~70 보통 / 70~100 높음
  high20: number | null;        // 최근 20개 관측의 최고
  turnedDown: boolean;          // 20일 최고보다 내려와 있는가(꺾임)
  firstDate: string | null;     // 받은 자료의 첫 날짜
  coverageYears: number | null; // 3년 백분위 계산에 실제로 쓴 자료 기간(년, 소수 1자리)
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const fromDayNum = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export const shiftIsoDays = (iso: string, days: number): string => fromDayNum(dayNum(iso) + days);
const EPS = 1e-9;

// 유효한 관측만 날짜 오름차순으로 — 0·음수도 유효(유한한 숫자만 본다)
export function seriesPoints(series: Series | null | undefined): Array<[string, number]> {
  if (!series || typeof series !== 'object') return [];
  const out: Array<[string, number]> = [];
  for (const d of Object.keys(series)) {
    const raw = (series as any)[d];
    if (!ISO.test(d) || raw === null || raw === '' || typeof raw === 'boolean') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out.push([d, v]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// 서버 응답(/api/history) 해석 — 값 부호로 버리지 않는다.
//   CSV: "Date,Close\nYYYY-MM-DD,값" (일반 키) / JSON: { "YYYY-MM-DD": 값 } (금리차·MBS 스프레드)
export function parseHistoryText(text: string): Series {
  const s = String(text || '').trim();
  const out: Series = {};
  if (!s) return out;
  if (s[0] === '{') {
    try {
      const obj = JSON.parse(s);
      for (const [d, v] of seriesPoints(obj)) out[d] = v;
    } catch { /* 손상 응답 — 빈 결과 */ }
    return out;
  }
  for (const line of s.split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2})\s*,\s*([^,\s]+)/.exec(line.trim());
    if (!m) continue;
    const v = Number(m[2]);
    if (Number.isFinite(v)) out[m[1]] = v;
  }
  return out;
}

// 두 기록을 합친다 — 같은 날짜는 새 값이 이긴다. 바뀐 게 없으면 원본 참조를 그대로 돌려준다.
export function mergeSeries(prev: Series | null | undefined, incoming: Series | null | undefined): Series {
  const base = prev && typeof prev === 'object' ? prev : {};
  let next: Series | null = null;
  for (const [d, v] of seriesPoints(incoming)) {
    if (base[d] === v) continue;
    if (!next) next = { ...base };
    next[d] = v;
  }
  return next || base;
}

// /api/indicators의 현재값을 기록 끝에 붙인다 — 날짜가 기록 최신일보다 늦을 때만(같은 날이면 덮어쓴다).
export function withLive(series: Series | null | undefined, price: unknown, date: string | null | undefined): Series {
  const base = series && typeof series === 'object' ? series : {};
  const v = Number(price);
  if (price === null || price === undefined || price === '' || !Number.isFinite(v) || !ISO.test(date || '')) return base;
  const pts = seriesPoints(base);
  const last = pts.length ? pts[pts.length - 1][0] : '';
  if (last && (date as string) < last) return base;
  if (base[date as string] === v) return base;
  return { ...base, [date as string]: v };
}

// 날짜 d 그날 또는 직전 관측값(정렬된 points에서)
function valueOnOrBefore(points: Array<[string, number]>, d: string): number | null {
  let lo = 0, hi = points.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? points[ans][1] : null;
}

export const bandOf = (pct: number | null): 'low' | 'mid' | 'high' | null =>
  pct == null || !Number.isFinite(pct) ? null : pct < 30 ? 'low' : pct < 70 ? 'mid' : 'high';

// 백분위 = (현재보다 작은 개수 + 같은 개수의 절반) ÷ 전체 × 100 — 동률이 많아도 한쪽으로 치우치지 않는다
export function percentileOf(values: number[], v: number): number | null {
  const xs = (values || []).filter(x => Number.isFinite(x));
  if (!xs.length || !Number.isFinite(v)) return null;
  let below = 0, equal = 0;
  for (const x of xs) { if (x < v - EPS) below++; else if (Math.abs(x - v) <= EPS) equal++; }
  return ((below + equal / 2) / xs.length) * 100;
}

export function computeRateMetrics(series: Series | null | undefined): RateMetrics {
  const pts = seriesPoints(series);
  const empty: RateMetrics = {
    current: null, asOf: null, change1m: null, high52: null, low52: null, position52: null,
    pct3y: null, band: null, high20: null, turnedDown: false, firstDate: null, coverageYears: null,
  };
  if (!pts.length) return empty;
  const [asOf, current] = pts[pts.length - 1];
  const firstDate = pts[0][0];

  const ago1m = valueOnOrBefore(pts, shiftIsoDays(asOf, -30));
  const change1m = ago1m == null ? null : current - ago1m;

  const from52 = shiftIsoDays(asOf, -365);
  const yr = pts.filter(([d]) => d > from52).map(([, v]) => v);
  const high52 = yr.length ? Math.max(...yr) : null;
  const low52 = yr.length ? Math.min(...yr) : null;
  const position52 = high52 != null && low52 != null && high52 - low52 > EPS
    ? ((current - low52) / (high52 - low52)) * 100
    : null;

  const from3y = shiftIsoDays(asOf, -3 * 365);
  // ⚠️ `>=` — 하이일드 2종은 자료 첫날(2023-10-17)이 정확히 3년 경계에 걸린다. `>`면 그 첫날이 빠진다.
  const win3 = pts.filter(([d]) => d >= from3y);
  const pct3y = percentileOf(win3.map(([, v]) => v), current);
  const coverageYears = win3.length ? Math.round(((dayNum(asOf) - dayNum(win3[0][0])) / 365) * 10) / 10 : null;

  const last20 = pts.slice(-20).map(([, v]) => v);
  const high20 = last20.length ? Math.max(...last20) : null;
  const turnedDown = high20 != null && current < high20 - EPS;

  return {
    current, asOf, change1m, high52, low52, position52, pct3y, band: bandOf(pct3y),
    high20, turnedDown, firstDate, coverageYears,
  };
}

// 차트 행 — 여러 기록을 날짜 합집합으로 펼친다(from 이후만). 빈 값은 null(선은 connectNulls로 잇는다).
export function buildRateChartRows(seriesByKey: Record<string, Series>, keys: string[], fromDate: string): Array<Record<string, any>> {
  const maps = keys.map(k => [k, seriesByKey?.[k] || {}] as const);
  const dates = new Set<string>();
  for (const [, m] of maps) for (const [d] of seriesPoints(m)) if (!fromDate || d >= fromDate) dates.add(d);
  return [...dates].sort().map(d => {
    const row: Record<string, any> = { date: d };
    for (const [k, m] of maps) {
      const v = Number((m as any)[d]);
      row[k] = (m as any)[d] === undefined || !Number.isFinite(v) ? null : v;
    }
    return row;
  });
}

// N일 변화 = 현재 − (기준일 − N일)의 그날 또는 직전 관측값. 자료가 없으면 null (8-B 브라질 ③ 기대물가 3개월 변화)
export function changeOverDays(series: Series | null | undefined, days: number): number | null {
  const pts = seriesPoints(series);
  if (!pts.length) return null;
  const [asOf, current] = pts[pts.length - 1];
  const ago = valueOnOrBefore(pts, shiftIsoDays(asOf, -days));
  return ago == null ? null : current - ago;
}

// 최근 N일 안에 직전 관측보다 오른 적이 있는가(8-B 브라질 ④ Selic 인상 여부). 자료가 없으면 null
export function roseWithinDays(series: Series | null | undefined, days: number): boolean | null {
  const pts = seriesPoints(series);
  if (pts.length < 2) return null;
  const from = shiftIsoDays(pts[pts.length - 1][0], -days);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] > from && pts[i][1] > pts[i - 1][1] + EPS) return true;
  }
  return false;
}
