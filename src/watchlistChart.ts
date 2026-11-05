// 관심종목 **기간 구간 · 종목 비교 차트 · 최근 분배금**의 순수 로직.
// 컴포넌트에서 분리해 `verify:watchlist`가 미러 없이 **직접 import**한다.
//
// ⚠️ 이 파일에는 import를 두지 말 것(watchlistGroups.ts와 같은 규약) — Node가 타입만 벗겨 그대로
//    실행해야 검증이 참조 구현 미러 없이 돈다. 미러를 두면 src/미러 한쪽만 고친 변경이 둘 다 통과한다.
// ⚠️ `enum`/`namespace` 금지(Node 타입 스트리핑 미지원).
// ⚠️ 모든 함수는 **절대 던지지 않는다** — 렌더 중 예외는 창 전체를 오류 화면으로 바꾼다.

type Pair = [string, number];

const CUSTOM_PERIOD = '직접';

const isIsoDay = (s: any): boolean => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1900 || y > 2999) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const goodPairs = (arr: any): Pair[] =>
  (Array.isArray(arr) ? arr : []).filter(
    (p: any) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number' && Number.isFinite(p[1]) && p[1] > 0,
  );

// ────────────────────────────────────────────────────────────────────────────
// 기간 → 시작 컷오프(YYYY-MM-DD). today = KST 달력일(YYYY-MM-DD).
// ⚠️ 관심종목 팝업의 `cutoffFor`가 이 함수를 그대로 부른다 — 팝업 등락율과 차트 창의 기간 수익률이
//    **같은 시작일**을 쓰게 하는 단일 소스다. 따로 계산하면 같은 기간에 두 화면의 %가 갈린다.
// ⚠️ 월 이동은 JS `setUTCMonth`의 넘침 규칙(3/31 − 1개월 = 3/3)을 그대로 따른다 — 종전 팝업 동작과 같다.
export function periodCutoff(period: any, today: any): string {
  if (!isIsoDay(today)) return '';
  const [y, m, dd] = (today as string).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd));
  if (period === '1주') d.setUTCDate(d.getUTCDate() - 7);
  else if (period === '1개월') d.setUTCMonth(d.getUTCMonth() - 1);
  else if (period === '3개월') d.setUTCMonth(d.getUTCMonth() - 3);
  else if (period === '6개월') d.setUTCMonth(d.getUTCMonth() - 6);
  else if (period === '1년') d.setUTCFullYear(d.getUTCFullYear() - 1);
  else if (period === '3년') d.setUTCFullYear(d.getUTCFullYear() - 3);
  else if (period === '5년') d.setUTCFullYear(d.getUTCFullYear() - 5);
  else return '';
  return d.toISOString().split('T')[0];
}

/**
 * 일별 종가 배열에서 기간 구간을 잘라 낸다 — 관심종목 등락율·미니차트와 종목 차트 창의 **공용 규칙**.
 * - 직접 선택(`period === custom`): 시작일 미지정이면 빈 구간(null 계약 — 0.00%로 단언하지 않는다).
 *   종료일을 비우면 '현재까지' — 마지막 점을 실시간 현재가로 둔다(오늘 일봉이 있으면 대체, 없으면 덧붙임).
 *   시작 종가가 하나도 없으면 현재가만으로 구간을 만들지 않는다.
 * - 그 외: cutoff 이후 종가 전부(cutoff가 빈 문자열이면 전체).
 */
export function watchPeriodWindow(daily: any, opts: any): { win: Pair[]; liveTail: boolean } {
  const o = opts && typeof opts === 'object' ? opts : {};
  const pairs = goodPairs(daily);
  // '직접'은 관심종목(WATCH_CUSTOM_PERIOD)·차트 창(CHART_CUSTOM_PERIOD) 공통 값이다.
  if (o.period === CUSTOM_PERIOD) {
    const start = isIsoDay(o.customStart) ? o.customStart : '';
    const end = isIsoDay(o.customEnd) ? o.customEnd : '';
    let win: Pair[] = start ? pairs.filter(([dt]) => dt >= start && (!end || dt <= end)) : [];
    const livePx = typeof o.livePrice === 'number' && Number.isFinite(o.livePrice) ? o.livePrice : 0;
    if (!end && win.length && livePx > 0 && isIsoDay(o.today)) {
      const lastD = win[win.length - 1][0];
      win = lastD >= o.today ? [...win.slice(0, -1), [lastD, livePx]] : [...win, [o.today, livePx]];
      return { win, liveTail: true };
    }
    return { win, liveTail: false };
  }
  const cut = typeof o.cutoff === 'string' ? o.cutoff : '';
  return { win: cut ? pairs.filter(([dt]) => dt >= cut) : pairs, liveTail: false };
}

/**
 * 구간 등락률(%) = (마지막 종가 ÷ 첫 종가) − 1. 2점 미만·첫 종가 0 이하면 rate = null
 * (0.00%로 단언하지 않는다 — '변동 없음'과 구분할 수 없어진다).
 */
export function windowRate(win: any): { rate: number | null; first: Pair | null; last: Pair | null } {
  const w = goodPairs(win);
  const first = w[0] || null;
  const last = w[w.length - 1] || null;
  const ok = w.length >= 2 && !!first && first[1] > 0;
  return { rate: ok ? ((last as Pair)[1] / (first as Pair)[1] - 1) * 100 : null, first, last };
}

// ────────────────────────────────────────────────────────────────────────────
// 종목 비교 차트 창(`/?stockChartWindow=1`)

/** 차트 창 기간 버튼(화면 순서 그대로). '1일'은 장중이라 일별 차트로 표현할 수 없어 두지 않는다. */
export const CHART_PERIODS = ['1주', '1개월', '3개월', '6개월', '1년', '3년', '5년', '직접'];
export const CHART_CUSTOM_PERIOD = CUSTOM_PERIOD;
export const CHART_DEFAULT_PERIOD = '1년';
/** 비교 종목 상한 — 앱의 비교종목 칩과 같다. */
export const MAX_CHART_COMPS = 8;
/** 기준 종목 + 비교 종목 선 색(빨강 = 기준 종목, 사진2의 '기간 수익률' 선과 같은 색). */
export const CHART_SERIES_COLORS = Object.freeze(['#f87171', '#facc15', '#4ade80', '#e5e7eb', '#60a5fa', '#c084fc', '#fb923c', '#22d3ee', '#f472b6']);

/** 종목 상세페이지 URL(관심종목 등락율 클릭 · 차트 창 ↗ 공용 — PortfolioTable과 같은 규칙). */
export function stockDetailUrl(market: any, code: any): string {
  const c = typeof code === 'string' ? code.trim() : '';
  if (market === 'fund') {
    return /^MA:/i.test(c)
      ? `https://investments.miraeasset.com/magi/fund/view.do?fundGb=2&fundCd=${c.replace(/^MA:/i, '')}`
      : `https://www.funetf.co.kr/product/fund/view/${c}`;
  }
  if (market === 'us') return `https://finance.yahoo.com/quote/${c.toUpperCase()}`;
  return `https://m.stock.naver.com/domestic/stock/${c.toUpperCase()}/total`;
}

/**
 * 차트 창 이름 — **종목마다 하나**. 같은 종목의 미니차트를 다시 누르면 새 창을 또 만들지 않고 그 창을 쓴다.
 * 창 이름에 쓸 수 없는 문자는 '_'로 바꾼다(펀드 URL 코드 등).
 */
export function stockChartWindowName(code: any): string {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return 'ass-stockchart-' + (c.replace(/[^A-Z0-9]/g, '_') || 'none');
}

/**
 * 차트 창 URL. ⚠️ 종목·기간만 싣는다(사용자 데이터·토큰 금지 — 주소창·기록에 그대로 남는다).
 * 직접 선택 기간이면 시작일(from)·종료일(to, 비우면 현재까지)을 함께 싣는다.
 */
export function stockChartUrl(o: any): string {
  const x = o && typeof o === 'object' ? o : {};
  const code = normalizeChartCode(x.code);
  const qs = new URLSearchParams({ stockChartWindow: '1', code });
  if (x.market === 'kr' || x.market === 'us' || x.market === 'fund') qs.set('market', x.market);
  const v = normalizeChartView({ period: x.period, customStart: x.customStart, customEnd: x.customEnd });
  qs.set('period', v.period);
  if (v.period === CHART_CUSTOM_PERIOD) {
    qs.set('from', v.customStart);
    if (v.customEnd) qs.set('to', v.customEnd);
  }
  if (typeof x.name === 'string' && x.name.trim()) qs.set('name', x.name.trim().slice(0, 80));
  const comps = normalizeChartComps(x.comps, code);
  if (comps.length) qs.set('comp', comps.join(','));
  // 이평선 — 넘겨받았을 때만 싣는다(없으면 창이 MA_DEFAULT로 연다). 빈 목록은 'ma='(모두 끔).
  if (Array.isArray(x.ma)) qs.set('ma', normalizeMaPeriods(x.ma).join(','));
  if (x.maOff === true) qs.set('maoff', '1');
  const mat = normalizeChartCode(x.maTarget);
  if (mat && mat.toLowerCase() !== code.toLowerCase()) qs.set('mat', mat);
  return '/?' + qs.toString();
}

/**
 * 관심종목 팝업 기간 → 차트 창 기간. '1일'은 장중 흐름이라 일별 차트로 만들 수 없어 1개월로 연다.
 * 모르는 값은 기본 기간.
 */
export function chartPeriodFromWatch(period: any): string {
  if (period === '1일') return '1개월';
  return CHART_PERIODS.includes(period) ? period : CHART_DEFAULT_PERIOD;
}

const CODE_RE = /^[A-Za-z0-9.:\-_/?=&%#~+]{1,200}$/;

/** URL·입력으로 들어온 종목 코드 하나를 정리한다. 쓸 수 없으면 ''. */
export function normalizeChartCode(raw: any): string {
  if (typeof raw !== 'string') return '';
  const c = raw.trim();
  return CODE_RE.test(c) ? c : '';
}

/**
 * 비교 종목 코드 목록 정리 — 빈 값·잘못된 값 제거, 대소문자 무시 중복 제거, 기준 종목 제외, 상한.
 * 입력은 배열 또는 'A,B,C' 문자열.
 */
export function normalizeChartComps(list: any, mainCode: any): string[] {
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : [];
  const main = typeof mainCode === 'string' ? mainCode.trim().toLowerCase() : '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const c = normalizeChartCode(raw);
    const k = c.toLowerCase();
    if (!c || k === main || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= MAX_CHART_COMPS) break;
  }
  return out;
}

/**
 * 차트 창 보기 상태 정리 — 기간 화이트리스트, 실제 달력 날짜만, 종료일이 시작일보다 앞이면 비움,
 * '직접'인데 시작일이 없으면 기본 기간(결과를 낼 수 없다).
 */
export function normalizeChartView(v: any): { period: string; customStart: string; customEnd: string } {
  const o = v && typeof v === 'object' ? v : {};
  const customStart = isIsoDay(o.customStart) ? o.customStart : '';
  let customEnd = isIsoDay(o.customEnd) ? o.customEnd : '';
  if (customEnd && customStart && customEnd < customStart) customEnd = '';
  let period = CHART_PERIODS.includes(o.period) ? o.period : CHART_DEFAULT_PERIOD;
  if (period === CHART_CUSTOM_PERIOD && !customStart) period = CHART_DEFAULT_PERIOD;
  return { period, customStart, customEnd };
}

/**
 * 비교 차트 행 — 각 종목을 **자기 구간 첫 종가**로 0%에 맞춘 수익률(%)과 종가를 날짜 합집합 위에 싣는다.
 * series = [{ key, win }] (win = watchPeriodWindow 결과 — 화면의 '기간 수익률'과 같은 구간).
 * - 그 날 종가가 없는 종목은 null(국내·해외 휴장일이 다르다 — 선은 connectNulls로 잇는다).
 * - 행 키: `key`(수익률 %) · `px:key`(종가).
 * ⚠️ 마지막 행의 수익률은 windowRate(win).rate와 **같은 값**이어야 한다(차트 끝점 = 화면의 기간 수익률).
 */
export function buildChartRows(series: any): any[] {
  const list = (Array.isArray(series) ? series : []).filter((s: any) => s && typeof s.key === 'string');
  const prepared = list.map((s: any) => {
    const w = goodPairs(s.win);
    const map = new Map<string, number>();
    for (const [d, v] of w) map.set(d, v);
    return { key: s.key as string, base: w.length ? w[0][1] : 0, map };
  });
  const dates = new Set<string>();
  for (const p of prepared) for (const d of p.map.keys()) dates.add(d);
  const sorted = [...dates].sort();
  return sorted.map((date) => {
    const row: any = { date };
    for (const p of prepared) {
      const v = p.map.get(date);
      row[p.key] = v != null && p.base > 0 ? (v / p.base - 1) * 100 : null;
      row['px:' + p.key] = v != null ? v : null;
    }
    return row;
  });
}

/** 정렬된 [date, close] 배열에서 date 이하 마지막 종가(없으면 null) — 호버의 '직전 거래일 값'. */
export function closeOnOrBefore(win: any, date: any): Pair | null {
  const w = goodPairs(win);
  if (typeof date !== 'string' || !w.length) return null;
  let lo = 0, hi = w.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (w[mid][0] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? w[ans] : null;
}

/** 드래그로 고른 두 날짜 사이 등락률 — 구간 [from, to] 안 첫·마지막 종가(windowRate와 같은 규칙). */
export function rangeRate(win: any, a: any, b: any): { rate: number | null; first: Pair | null; last: Pair | null } {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return { rate: null, first: null, last: null };
  const from = a < b ? a : b;
  const to = a < b ? b : a;
  return windowRate(goodPairs(win).filter(([d]) => d >= from && d <= to));
}

// ── 차트 구간 선택 상태 전이(수익률 차트와 같은 제스처 — 사용자 요청 2026-10) ──
// ① 드래그 = 구간 선택 ② **더블클릭 = 시작점 고정** → 마우스를 움직이면 버튼을 안 눌러도 끝점이 따라오며
//    미리보기 → 클릭(또는 드래그)으로 끝점 확정. 시작점 위를 다시 누르면 시작점을 유지하고 계속 기다린다.
// state = { dragging, left, right, anchor } — left/right = 선택 양 끝 날짜, anchor = 고정한 시작점(대기 중).
// event = { type:'down'|'move'|'up'|'dbl'|'clear', label?, second?, buttons? }
//   label = 그 지점의 날짜(플롯 밖이면 ''), second = 더블클릭의 두 번째 클릭(detail ≥ 2),
//   buttons = 이동 중 눌린 버튼(0이면 창 밖에서 버튼을 놓고 돌아온 것).
// ⚠️ 바뀐 게 없으면 **같은 참조**를 돌려준다 — 호출부가 참조 비교로 setState를 건너뛴다(이동마다 렌더 방지).
// ⚠️ 더블클릭의 두 번째 클릭(second)은 down·up 모두 무시한다 — 안 그러면 한 제스처 안에서
//    '시작점 고정 → 곧바로 선택 확정 → 해제'가 연달아 일어나 화면이 번쩍인다.
// ⚠️ 버튼 놓침 자가치유(buttons === 0)는 **드래그 중일 때만** — 시작점 대기 중의 미리보기는 원래 버튼 없이
//    따라오므로 buttons만 보면 그 기능이 통째로 죽는다.
export const EMPTY_CHART_SEL = Object.freeze({ dragging: false, left: '', right: '', anchor: '' });

export function chartSelStep(st: any, ev: any): { dragging: boolean; left: string; right: string; anchor: string } {
  const s = st && typeof st === 'object' ? st : EMPTY_CHART_SEL;
  const e = ev && typeof ev === 'object' ? ev : {};
  const label = typeof e.label === 'string' ? e.label : '';
  switch (e.type) {
    case 'clear':
      return s === EMPTY_CHART_SEL || (!s.dragging && !s.left && !s.right && !s.anchor) ? s : EMPTY_CHART_SEL;
    case 'dbl':
      return label ? { dragging: false, left: label, right: '', anchor: label } : s;
    case 'down':
      if (e.second) return s;
      if (!label) return chartSelStep(s, { type: 'clear' });          // 플롯 밖(축 띠 등) 클릭 = 해제
      if (s.anchor) return { ...s, dragging: true, right: label };      // 시작점은 덮어쓰지 않는다 — 끝점 후보
      return { dragging: true, left: label, right: '', anchor: '' };
    case 'move':
      if (!(s.dragging || s.anchor)) return s;
      if (s.dragging && e.buttons === 0) return chartSelStep(s, { type: 'up' });
      if (!label || label === s.right) return s;
      return { ...s, right: label };
    case 'up':
      if (e.second || !s.dragging) return s;
      if (s.left && s.right && s.left !== s.right) return { dragging: false, left: s.left, right: s.right, anchor: '' };
      if (s.anchor) return { dragging: false, left: s.anchor, right: '', anchor: s.anchor };   // 시작점 위 클릭 = 계속 대기
      return EMPTY_CHART_SEL;                                                                  // 단순 클릭 = 해제
    default:
      return s;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 이동평균선(사용자 요청 2026-11-05 — 5·10·150·200일 등 원하는 기간을 골라 본다).
// 종목 차트 창에서 **대상 종목 하나**(기본 = 기준 종목)에 대해 고른 기간마다 한 줄씩 긋는다.
// 이평선 값 = 그날까지 n거래일 종가의 단순 평균. 조회 기간 앞의 종가도 함께 받아(maFetchFrom)
// 구간 첫날부터 선이 이어진다. 종가가 n개 미만인 날은 긋지 않는다(짧은 평균으로 대신 채우지 않는다).
// ⚠️ 색은 종목 선 색(CHART_SERIES_COLORS — 빨강·주황·노랑·초록·하늘·파랑·보라·분홍·흰색)의 **빈 색상대**에서만
//    고른다(연두·자홍·청록·남색·회청) — 종목 선과 이평선이 같은 색으로 보이면 어느 선이 시세인지 알 수 없다.

/** 기간 버튼(화면 순서 그대로). 그 밖의 기간은 '직접' 칸에 일수를 넣어 추가한다. */
export const MA_PRESETS = [5, 10, 20, 60, 120, 150, 200];
export const MA_MIN = 2;
export const MA_MAX = 400;
/** 한 번에 긋는 이평선 수 — 색이 서로 구분되는 개수까지만. */
export const MAX_MA_LINES = 5;
/** 창을 처음 열 때(주소에 ma가 없을 때)의 이평선 — 증권사 차트의 흔한 기본값. */
export const MA_DEFAULT = [5, 20, 60, 120];
export const MA_COLORS = Object.freeze(['#a3e635', '#e879f9', '#2dd4bf', '#818cf8', '#94a3b8']);

/** 이평선 기간 정리 — 'a,b' 문자열이나 배열 → 정수 · [MA_MIN, MA_MAX] · 중복 제외 · 입력 순서 · 최대 MAX_MA_LINES개. */
export function normalizeMaPeriods(raw: any): number[] {
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out: number[] = [];
  for (const v of arr) {
    const t = typeof v === 'string' ? v.trim() : v;
    if (t === '' || t == null || typeof t === 'boolean') continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < MA_MIN || n > MA_MAX || out.includes(n)) continue;
    out.push(n);
    if (out.length >= MAX_MA_LINES) break;
  }
  return out;
}

/** 선택 목록 `[{ n, c }]`(c = MA_COLORS 칸) — 주소에서 읽은 기간은 순서대로 칸 0, 1, 2…를 받는다. */
export function maSelFromPeriods(raw: any): { n: number; c: number }[] {
  return normalizeMaPeriods(raw).map((n, i) => ({ n, c: i }));
}

/**
 * 이평선 켜고 끄기 — 있으면 빼고, 없으면 **비어 있는 가장 앞 색 칸**으로 넣는다.
 * 다른 선을 끄고 켜도 이미 그어진 선의 색은 바뀌지 않는다(색이 바뀌면 사용자가 선을 다시 찾아야 한다).
 * 이미 MAX_MA_LINES개면 그대로 돌려준다(같은 참조 — 호출부가 안내를 띄운다). 잘못된 기간도 그대로.
 */
export function toggleMaSel(sel: any, n: any): { n: number; c: number }[] {
  const cur = (Array.isArray(sel) ? sel : []).filter(
    (x: any) => x && Number.isInteger(x.n) && Number.isInteger(x.c) && x.c >= 0 && x.c < MA_COLORS.length,
  );
  const p = normalizeMaPeriods([n])[0];
  if (p == null) return Array.isArray(sel) ? sel : cur;
  if (cur.some((x: any) => x.n === p)) return cur.filter((x: any) => x.n !== p);
  if (cur.length >= MAX_MA_LINES) return Array.isArray(sel) ? sel : cur;
  let c = 0;
  while (cur.some((x: any) => x.c === c)) c++;
  return [...cur, { n: p, c }];
}

/** 이평선 색(칸 번호 → MA_COLORS, 모르는 칸은 첫 색). */
export function maColor(c: any): string {
  return Number.isInteger(c) && c >= 0 && c < MA_COLORS.length ? MA_COLORS[c] : MA_COLORS[0];
}

/**
 * 이평선을 조회 첫날부터 그리려면 필요한 종가 시작일 — 시작일에서 n거래일 앞(달력일 n × 1.5 + 14일 여유:
 * 거래일은 달력일의 약 68%이고 설·추석 연휴가 몰린다). n이 없거나 시작일이 없으면 시작일 그대로.
 */
export function maFetchFrom(from: any, maxN: any): string {
  if (!isIsoDay(from)) return typeof from === 'string' ? from : '';
  const n = Number(maxN);
  if (!Number.isFinite(n) || n < 1) return from as string;
  const [y, m, d] = (from as string).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - (Math.ceil(Math.min(n, MA_MAX) * 1.5) + 14));
  return dt.toISOString().split('T')[0];
}

/**
 * n일 이동평균 — 구간(win) 날짜마다 그날까지 n개 종가의 평균 `[date, ma][]`.
 * 구간 앞 종가는 daily(같은 종목의 전체 이력)에서 잇는다. 구간 안은 win 그대로라
 * 직접 선택 '현재까지'의 실시간 끝점(watchPeriodWindow liveTail)도 평균에 들어간다.
 * 종가가 n개 미만인 날은 결과에서 빠진다.
 */
export function movingAverage(daily: any, win: any, n: any): Pair[] {
  const N = Number(n);
  if (!Number.isInteger(N) || N < 1) return [];
  const w = goodPairs(win);
  if (!w.length) return [];
  const start = w[0][0];
  const pre = goodPairs(daily).filter(([d]) => d < start).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const seq = [...pre, ...w];
  const out: Pair[] = [];
  let sum = 0;
  for (let i = 0; i < seq.length; i++) {
    sum += seq[i][1];
    if (i >= N) sum -= seq[i - N][1];
    if (i >= N - 1 && seq[i][0] >= start) out.push([seq[i][0], sum / N]);
  }
  return out;
}

/**
 * 차트 행에 이평선 값을 싣는다(새 배열 — 받은 행은 고치지 않는다). lines = [{ key, pts, win }].
 * - `key` = 수익률(%) — 대상 종목 구간 첫 종가(= buildChartRows의 0% 기준)로 환산해 시세 선과 같은 자리에 선다.
 * - `px:key` = 이평선 값 그대로(종가 보기).
 * 그날 값이 없으면 null(선은 connectNulls로 잇는다).
 */
export function withMaRows(rows: any, lines: any): any[] {
  const list = (Array.isArray(lines) ? lines : []).filter((l: any) => l && typeof l.key === 'string' && l.key);
  const src = Array.isArray(rows) ? rows : [];
  if (!list.length) return src;
  const prepared = list.map((l: any) => {
    const w = goodPairs(l.win);
    const map = new Map<string, number>();
    for (const [d, v] of goodPairs(l.pts)) map.set(d, v);
    return { key: l.key as string, base: w.length ? w[0][1] : 0, map };
  });
  return src.map((r: any) => {
    const row: any = { ...(r && typeof r === 'object' ? r : {}) };
    for (const p of prepared) {
      const v = typeof row.date === 'string' ? p.map.get(row.date) : undefined;
      row[p.key] = v != null && p.base > 0 ? (v / p.base - 1) * 100 : null;
      row['px:' + p.key] = v != null ? v : null;
    }
    return row;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 보유 종목 매입가 가로선(사용자 요청 2026-10-30 — 증권사 차트의 '매입가' 점선처럼).
// 관심종목 미니차트 · 종목 비교 차트 창에서 **포트폴리오 테이블에 있는 종목**이면 매입가 높이에 가로선을 긋는다.
// ⚠️ 매입가 = 포트폴리오 테이블 '구매단가' 칸과 **같은 식** — 따로 정의하면 표와 선이 갈린다.
//    국내 주식 · 펀드: 투자금액 ÷ 보유수량(투자금액이 비어 있는 옛 주식 행만 저장된 purchasePrice).
//    해외 주식: 투자금액(USD, investAmountUsd) ÷ 보유수량(입력이 없는 옛 행은 purchasePrice — utils.overseasInvestAmount 규칙).
// ⚠️ 한 계좌에 같은 종목 행이 둘이면 합산(총 투자금액 ÷ 총 수량), 계좌가 다르면 **계좌마다 한 줄**.
// ⚠️ 삭제된 계좌(deletedAt)·TEST 계좌는 뺀다 — 통합 대시보드의 '합산·차트 제외' 규약과 같다.
//    직접입력·마통(종목 행 없음), KRX 금현물·CRYPTO(차트 시세와 가격 단위가 다르다)도 뺀다.
// ⚠️ 통화가 차트 시장과 다르면 긋지 않는다(해외 = USD ↔ 'us', 그 외 = KRW ↔ 'kr'·'fund') — 원화 매입가를
//    달러 차트에 그으면 1,300배 엉뚱한 자리에 선이 선다.

// ord = 계좌 탭 순서·행 순서대로 붙인 일련번호(관심종목 '보유종목' 그룹의 줄 순서 — 객체 키 순서는 숫자 코드가 앞으로 섞인다).
// mk·code·name = 그 줄을 관심종목 행으로 조회할 시장·원래 코드·종목명(포트폴리오 행 그대로).
type Holding = { acct: string; avg: number; qty: number; cur: 'KRW' | 'USD'; ord?: number; mk?: 'kr' | 'us' | 'fund'; code?: string; name?: string };

const HOLD_SKIP_ACCOUNTS = ['simple', 'matong', 'gold', 'crypto'];
const MAX_HOLD_KEYS = 500;
const MAX_HOLD_PER_KEY = 20;

// utils.cleanNum과 같은 규칙(이 파일은 import 0 — 미러가 아니라 같은 한 줄 파서).
const holdNum = (v: any): number => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * 앞자리 0이 빠진 국내 종목 코드의 복원 후보 — '241D0' → '0241D0', '5930' → '005930'(사용자 신고 2026-10-30:
 * 0241D0을 넣었는데 241D0이 들어가 조회 실패). 국내 단축코드는 **늘 6자**라 앞을 0으로 채운다.
 * 후보는 숫자가 든 1~5자 영숫자만(순수 알파벳은 해외 티커, 'MA:'·URL은 펀드라 후보 없음 = '').
 * ⚠️ 이 값은 '국내로 조회해 보고 **맞으면** 쓰는' 후보다 — 확인 없이 바꾸지 말 것(5자 미래에셋 펀드 코드가 있다).
 */
export function krCodeWithZeros(code: any): string {
  if (typeof code !== 'string') return '';
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(c) || !/\d/.test(c)) return '';
  return c.padStart(6, '0');
}

/** 보유 종목 매칭 키 — 대소문자 무시 · 미래에셋 펀드 'MA:' 접두어 무시(관심종목은 접두어 없이 넣기도 한다). */
export function holdingKey(code: any): string {
  if (typeof code !== 'string') return '';
  const c = code.trim().toUpperCase().replace(/^MA:/, '');
  return c && c.length <= 200 ? c : '';
}

/**
 * portfolios(계좌 배열 — 앱의 단일 소스) → { [holdingKey]: [{ acct, avg, qty, cur }] }.
 * 순서 = 계좌 탭 순서. 매입가를 낼 수 없는 행(수량 0 · 투자금액 0)은 건너뛴다.
 */
export function buildHoldings(portfolios: any): Record<string, Holding[]> {
  const out: Record<string, Holding[]> = {};
  const list = Array.isArray(portfolios) ? portfolios : [];
  let ord = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object' || p.deletedAt || p.isTest) continue;
    const type = p.accountType || 'portfolio';
    if (HOLD_SKIP_ACCOUNTS.includes(type)) continue;
    const overseas = type === 'overseas';
    const acct = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : '계좌';
    const sums = new Map<string, { cost: number; qty: number; code: string; name: string; fund: boolean }>();
    for (const it of Array.isArray(p.portfolio) ? p.portfolio : []) {
      if (!it || typeof it !== 'object' || (it.type !== 'stock' && it.type !== 'fund')) continue;
      const key = holdingKey(it.code);
      const qty = holdNum(it.quantity);
      if (!key || !(qty > 0)) continue;
      let cost: number;
      if (it.type === 'fund') cost = holdNum(it.investAmount);
      else if (overseas) {
        const usd = it.investAmountUsd;
        cost = usd === null || usd === undefined || usd === '' ? holdNum(it.purchasePrice) * qty : holdNum(usd);
      } else {
        const inv = holdNum(it.investAmount);
        cost = inv > 0 ? inv : holdNum(it.purchasePrice) * qty;
      }
      if (!(cost > 0)) continue;
      const s = sums.get(key) || { cost: 0, qty: 0, code: it.code.trim().toUpperCase(), name: '', fund: it.type === 'fund' };
      s.cost += cost;
      s.qty += qty;
      if (!s.name && typeof it.name === 'string' && it.name.trim()) s.name = it.name.trim().slice(0, 80);
      sums.set(key, s);
    }
    for (const [key, s] of sums) {
      const avg = s.cost / s.qty;
      if (!Number.isFinite(avg) || avg <= 0) continue;
      if (!out[key]) out[key] = [];
      if (out[key].length >= MAX_HOLD_PER_KEY) continue;
      const mk = overseas ? 'us' : s.fund ? 'fund' : 'kr';
      out[key].push({ acct, avg, qty: s.qty, cur: overseas ? 'USD' : 'KRW', ord: ord++, mk, code: s.code, ...(s.name ? { name: s.name } : {}) });
    }
  }
  return out;
}

/** 차트 한 종목의 보유분 — 키가 같고 **통화가 시장과 맞는** 것만. */
export function holdingsFor(map: any, code: any, market: any): Holding[] {
  const key = holdingKey(code);
  if (!key || !map || typeof map !== 'object') return [];
  const arr = Array.isArray(map[key]) ? map[key] : [];
  const cur = market === 'us' ? 'USD' : 'KRW';
  return arr.filter((h: any) => h && h.cur === cur && typeof h.avg === 'number' && h.avg > 0);
}

/** 요청한 종목 코드의 보유분만 골라 낸다(차트 창에 계좌 전체를 보내지 않는다). */
export function pickHoldings(map: any, codes: any): Record<string, Holding[]> {
  const out: Record<string, Holding[]> = {};
  if (!map || typeof map !== 'object' || !Array.isArray(codes)) return out;
  for (const c of codes.slice(0, MAX_HOLD_KEYS)) {
    const key = holdingKey(c);
    if (key && Array.isArray(map[key]) && map[key].length) out[key] = map[key];
  }
  return out;
}

/**
 * 창 사이 메시지로 받은 보유분 정리 — 모양이 틀린 항목은 버린다(렌더 중 예외 방지).
 * null·배열·원시값 → null(= '아직 모른다' — 받는 쪽은 기존 값을 지우지 않는다).
 */
export function normalizeHoldings(raw: any): Record<string, Holding[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, Holding[]> = {};
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (n >= MAX_HOLD_KEYS) break;
    const key = holdingKey(k);
    const arr = Array.isArray(raw[k]) ? raw[k] : [];
    const good: Holding[] = [];
    for (const h of arr) {
      if (good.length >= MAX_HOLD_PER_KEY) break;
      if (!h || typeof h !== 'object') continue;
      const avg = typeof h.avg === 'number' && Number.isFinite(h.avg) && h.avg > 0 ? h.avg : 0;
      const qty = typeof h.qty === 'number' && Number.isFinite(h.qty) && h.qty > 0 ? h.qty : 0;
      if (!avg || !qty || (h.cur !== 'KRW' && h.cur !== 'USD')) continue;
      const acct = typeof h.acct === 'string' && h.acct.trim() ? h.acct.trim().slice(0, 40) : '계좌';
      const g: Holding = { acct, avg, qty, cur: h.cur };
      if (Number.isInteger(h.ord) && h.ord >= 0) g.ord = h.ord;
      if (h.mk === 'kr' || h.mk === 'us' || h.mk === 'fund') g.mk = h.mk;
      if (typeof h.code === 'string' && key && holdingKey(h.code) === key) g.code = h.code.trim();
      if (typeof h.name === 'string' && h.name.trim()) g.name = h.name.trim().slice(0, 80);
      good.push(g);
    }
    if (key && good.length) { out[key] = good; n++; }
  }
  return out;
}

/**
 * 관심종목 자동 '보유종목' 그룹의 줄 목록(사용자 요청 2026-10-30 — 전체 계좌의 보유 종목).
 * 한 줄 = 종목 하나 — 여러 계좌에 보유한 같은 종목도 **한 줄**이고(사용자 확정 2026-11-01: 관심종목은 시장과 내 자산을
 * 한눈에 보는 곳), 그 줄에 보유 계좌 이름(accts, 계좌 탭 순서)을 싣는다. 계좌마다의 매입가는 차트 점선·툴팁이 보인다.
 * 순서 = 종목이 처음 나온 순서(계좌 탭 순서 → 행 순서, ord — 객체 키 순서는 정수 모양 코드가 앞으로 섞여 쓰지 않는다).
 * 같은 키라도 통화가 다르면(원화 계좌 · 달러 계좌) 시세 단위가 달라 줄을 나눈다(holdingsFor의 통화 맞춤과 같은 기준).
 * ⚠️ 저장하지 않는 가상 줄이다(정본은 앱 탭 portfolios) — 그룹 배열(watchlistGroups)에 넣지 말 것.
 * mk·code가 없는 옛 모양은 통화·키로 시장을 추정한다(USD = 해외, 6자 숫자 포함 = 국내, 그 외 = 펀드).
 */
export function holdingWatchStocks(map: any): any[] {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  const rows: { key: string; cur: string; first: number; list: { h: any; ord: number }[] }[] = [];
  let seq = 0;
  for (const key of Object.keys(map)) {
    const byCur = new Map<string, { h: any; ord: number }[]>();
    for (const h of Array.isArray(map[key]) ? map[key] : []) {
      if (!h || typeof h !== 'object' || !(h.avg > 0) || !(h.qty > 0) || (h.cur !== 'KRW' && h.cur !== 'USD')) continue;
      const arr = byCur.get(h.cur) || [];
      arr.push({ h, ord: Number.isInteger(h.ord) && h.ord >= 0 ? h.ord : 1e9 + seq });
      byCur.set(h.cur, arr);
      seq++;
    }
    for (const [cur, list] of byCur) {
      list.sort((a, b) => a.ord - b.ord);
      rows.push({ key, cur, first: list[0].ord, list });
    }
  }
  rows.sort((a, b) => a.first - b.first);
  return rows.map(({ key, cur, list }) => {
    const h = list[0].h;
    const market = h.mk === 'kr' || h.mk === 'us' || h.mk === 'fund' ? h.mk
      : cur === 'USD' ? 'us' : /^[A-Z0-9]{6}$/.test(key) && /\d/.test(key) ? 'kr' : 'fund';
    const name = list.map((x) => x.h.name).find((n) => typeof n === 'string' && n) || '';
    return {
      id: `hold:${key}:${cur}`, code: typeof h.code === 'string' && h.code ? h.code : key, market, name,
      accts: [...new Set(list.map((x) => x.h.acct))], virtual: true,
    };
  });
}

/**
 * 여러 계좌 보유분의 합산 매입가(총 투자금액 ÷ 총 수량) — 툴팁·머리글의 합산 요약용.
 * 가로선은 미니차트·차트 창 모두 계좌마다 따로 긋는다(이 값으로 합치지 않는다 — 사용자 요청 2026-10-30).
 */
export function holdingAvg(list: any): { avg: number; qty: number; n: number } | null {
  const arr = (Array.isArray(list) ? list : []).filter(
    (h: any) => h && typeof h.avg === 'number' && h.avg > 0 && typeof h.qty === 'number' && h.qty > 0,
  );
  if (!arr.length) return null;
  let cost = 0, qty = 0;
  for (const h of arr) { cost += h.avg * h.qty; qty += h.qty; }
  const avg = cost / qty;
  return Number.isFinite(avg) && avg > 0 ? { avg, qty, n: arr.length } : null;
}

/** 매입가 → 수익률 차트 높이(%) — 그 종목 구간 첫 종가(base)를 0%로 둔 같은 눈금. base가 없으면 null. */
export function holdingPct(avg: any, base: any): number | null {
  if (typeof avg !== 'number' || typeof base !== 'number' || !(avg > 0) || !(base > 0)) return null;
  return (avg / base - 1) * 100;
}

/**
 * 매입가 선을 눈금 안에 넣을지(눈금 넓히기) · 가장자리에 표시만 할지(pin) 정한다.
 * 매입가가 시세와 멀면 눈금을 넓히는 순간 시세 선이 한쪽 끝에 납작하게 눌린다 → 시세 선이 높이의
 * minShare 미만으로 줄어드는 매입가는 눈금을 넓히지 않고 위('top')·아래('bottom') 가장자리 표시로 돌린다.
 * levels = 매입가 높이 배열(같은 눈금). 반환 = 같은 순서의 pin('' = 눈금 안) + 최종 눈금 lo·hi.
 */
export function holdingLayout(dataMin: any, dataMax: any, levels: any, minShare: any = 0.4): { pins: string[]; lo: number; hi: number } {
  const lv: any[] = Array.isArray(levels) ? levels : [];
  const okMin = typeof dataMin === 'number' && Number.isFinite(dataMin);
  const okMax = typeof dataMax === 'number' && Number.isFinite(dataMax);
  if (!okMin || !okMax || dataMax < dataMin) return { pins: lv.map(() => ''), lo: NaN, hi: NaN };
  const share = typeof minShare === 'number' && minShare > 0 && minShare < 1 ? minShare : 0.4;
  const span = dataMax - dataMin;
  let lo = dataMin, hi = dataMax;
  const pins = lv.map(() => '');
  // 시세 범위에서 가까운 매입가부터 받아들인다 — 먼 것 하나가 가까운 것까지 가장자리로 밀어내지 않게.
  const order = lv.map((v, i) => ({ v, i }))
    .filter((o) => typeof o.v === 'number' && Number.isFinite(o.v))
    .sort((a, b) => Math.max(dataMin - a.v, a.v - dataMax, 0) - Math.max(dataMin - b.v, b.v - dataMax, 0));
  for (const { v, i } of order) {
    if (v >= lo && v <= hi) continue;
    const nlo = Math.min(lo, v), nhi = Math.max(hi, v);
    // 시세가 한 값뿐(span 0)이면 눌릴 모양이 없다 — 넓힌다.
    if (span <= 0 || span / (nhi - nlo) >= share) { lo = nlo; hi = nhi; }
    else pins[i] = v > dataMax ? 'top' : 'bottom';
  }
  lv.forEach((v, i) => { if (typeof v !== 'number' || !Number.isFinite(v)) pins[i] = 'none'; });
  return { pins, lo, hi };
}

// ────────────────────────────────────────────────────────────────────────────
// 종목 차트 창 '비교 종목' 찾기(사용자 요청 2026-11-01) — 보유 종목을 **이름 일부 · 초성 · 코드**로 찾고,
// **계좌 → 종목** 계층으로도 고른다.
// 카탈로그 = 보유분에서 매입가·수량을 뺀 `{ acct, code, name, mk }` 줄(계좌 탭 → 행 순서). 차트 창은 찾기용으로
// 이것만 받고, 매입가는 여전히 물어본 종목 몫만 받는다(pickHoldings).

type CatalogItem = { acct: string; code: string; name: string; mk: 'kr' | 'us' | 'fund' };
const MAX_CATALOG = 1000;

// 보유분 한 줄의 시장 — mk가 없는 옛 모양은 통화·키로 추정(USD = 해외, 6자 숫자 포함 = 국내, 그 외 = 펀드).
const holdMarket = (h: any, key: string): 'kr' | 'us' | 'fund' =>
  h.mk === 'kr' || h.mk === 'us' || h.mk === 'fund' ? h.mk
    : h.cur === 'USD' ? 'us' : /^[A-Z0-9]{6}$/.test(key) && /\d/.test(key) ? 'kr' : 'fund';

/** 보유분 → 찾기용 카탈로그(계좌 탭 → 행 순서). 매입가·수량은 싣지 않는다. */
export function holdingCatalog(map: any): CatalogItem[] {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  const rows: { it: CatalogItem; ord: number }[] = [];
  let seq = 0;
  for (const raw of Object.keys(map)) {
    const key = holdingKey(raw);
    if (!key) continue;
    for (const h of Array.isArray(map[raw]) ? map[raw] : []) {
      if (!h || typeof h !== 'object' || !(h.avg > 0) || !(h.qty > 0) || (h.cur !== 'KRW' && h.cur !== 'USD')) continue;
      const acct = typeof h.acct === 'string' && h.acct.trim() ? h.acct.trim().slice(0, 40) : '계좌';
      const code = typeof h.code === 'string' && holdingKey(h.code) === key ? h.code.trim() : key;
      const name = typeof h.name === 'string' ? h.name.trim().slice(0, 80) : '';
      rows.push({ it: { acct, code, name, mk: holdMarket(h, key) }, ord: Number.isInteger(h.ord) && h.ord >= 0 ? h.ord : 1e9 + seq });
      seq++;
    }
  }
  rows.sort((a, b) => a.ord - b.ord);
  return rows.slice(0, MAX_CATALOG).map((r) => r.it);
}

/** 창 사이 메시지로 받은 카탈로그 정리 — 배열이 아니면 null(모름 — 받는 쪽은 기존 목록을 지킨다), 틀린 줄은 버린다. */
export function normalizeHoldingCatalog(raw: any): CatalogItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CatalogItem[] = [];
  for (const r of raw) {
    if (out.length >= MAX_CATALOG) break;
    if (!r || typeof r !== 'object') continue;
    const code = normalizeChartCode(r.code);
    if (!code || !holdingKey(code) || (r.mk !== 'kr' && r.mk !== 'us' && r.mk !== 'fund')) continue;
    const acct = typeof r.acct === 'string' && r.acct.trim() ? r.acct.trim().slice(0, 40) : '계좌';
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
    out.push({ acct, code, name, mk: r.mk });
  }
  return out;
}

/** 카탈로그 → 계좌 목록(처음 나온 순서 = 계좌 탭 순서) · 계좌마다 종목(같은 종목은 한 번) — 계층 선택의 두 단. */
export function catalogAccounts(catalog: any): { acct: string; items: CatalogItem[] }[] {
  const out: { acct: string; items: CatalogItem[]; seen: Set<string> }[] = [];
  const byAcct = new Map<string, { acct: string; items: CatalogItem[]; seen: Set<string> }>();
  for (const it of Array.isArray(catalog) ? catalog : []) {
    if (!it || typeof it !== 'object' || typeof it.acct !== 'string' || !holdingKey(it.code)) continue;
    let g = byAcct.get(it.acct);
    if (!g) { g = { acct: it.acct, items: [], seen: new Set() }; byAcct.set(it.acct, g); out.push(g); }
    const k = holdingKey(it.code) + ':' + it.mk;
    if (g.seen.has(k)) continue;
    g.seen.add(k);
    g.items.push(it);
  }
  return out.map(({ acct, items }) => ({ acct, items }));
}

// ── 한글 초성·부분 입력 맞춤 ──
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';   // 0번 = 받침 없음
// 겹받침 → [남는 받침, 다음 글자로 넘어가는 자음]('닭' + 모음 → '달기')
const JONG_SPLIT: Record<number, [number, string]> = {
  3: [1, 'ㅅ'], 5: [4, 'ㅈ'], 6: [4, 'ㅎ'], 9: [8, 'ㄱ'], 10: [8, 'ㅁ'], 11: [8, 'ㅂ'],
  12: [8, 'ㅅ'], 13: [8, 'ㅌ'], 14: [8, 'ㅍ'], 15: [8, 'ㅎ'], 18: [17, 'ㅅ'],
};
// 겹모음 → 먼저 치는 모음('고' + ㅏ → '과')
const JUNG_HEAD: Record<number, number> = { 9: 8, 10: 8, 11: 8, 14: 13, 15: 13, 16: 13, 19: 18 };

const syl = (ch: string): { cho: number; jung: number; jong: number } | null => {
  if (typeof ch !== 'string' || ch.length !== 1) return null;
  const c = ch.charCodeAt(0) - 0xac00;
  if (!(c >= 0 && c <= 11171)) return null;
  return { cho: Math.floor(c / 588), jung: Math.floor((c % 588) / 28), jong: c % 28 };
};

// 한 글자 — 같은 글자이거나, 입력이 초성(ㄱ…ㅎ)이고 이름 글자의 초성이 그것이면 맞다.
const chEq = (n: string, q: string): boolean => {
  if (n === q) return true;
  const ci = CHO.indexOf(q);
  if (ci < 0) return false;
  const s = syl(n);
  return !!s && s.cho === ci;
};

// 입력의 **마지막 글자**는 아직 조합 중일 수 있다 — '삼서'(→ 삼성) · '고'(→ 과) · '달'(→ 닭) · '탕'(→ 타이).
// 반환 = 이름에서 쓴 글자 수(0 = 안 맞음 · 2 = 받침이 다음 글자 초성으로 넘어간 경우).
const lastEq = (name: string[], i: number, q: string): number => {
  if (chEq(name[i], q)) return 1;
  const a = syl(q), b = syl(name[i]);
  if (!a || !b || a.cho !== b.cho) return 0;
  if (a.jong === 0) return a.jung === b.jung || JUNG_HEAD[b.jung] === a.jung ? 1 : 0;
  if (a.jung !== b.jung) return 0;
  if (JONG_SPLIT[b.jong] && JONG_SPLIT[b.jong][0] === a.jong) return 1;
  const sp = JONG_SPLIT[a.jong];
  const rest = sp ? sp[0] : 0;
  const next = sp ? sp[1] : JONG[a.jong];
  if (b.jong !== rest || i + 1 >= name.length) return 0;
  const ni = CHO.indexOf(next);
  const c = syl(name[i + 1]);
  return ni >= 0 && ((c && c.cho === ni) || name[i + 1] === next) ? 2 : 0;
};

/**
 * 이름에서 입력과 맞는 첫 구간 [시작, 끝)(원래 문자열 위치) — 없으면 null.
 * 대소문자·공백 무시 · 초성만('ㅅㅅㅈㅈ' → 삼성전자) · 섞어서('삼ㅅ') · 조합 중인 마지막 글자.
 */
export function hangulMatch(text: any, query: any): [number, number] | null {
  if (typeof text !== 'string' || typeof query !== 'string') return null;
  const qs = [...query.toLowerCase()].filter((ch) => !/\s/.test(ch));
  if (!qs.length) return null;
  const chars: string[] = [], starts: number[] = [], ends: number[] = [];
  let p = 0;
  for (const ch of text) {
    if (!/\s/.test(ch)) { chars.push(ch.toLowerCase()); starts.push(p); ends.push(p + ch.length); }
    p += ch.length;
  }
  const last = qs.length - 1;
  for (let s = 0; s + last < chars.length; s++) {
    let k = 0;
    while (k < last && chEq(chars[s + k], qs[k])) k++;
    if (k < last) continue;
    const used = lastEq(chars, s + last, qs[last]);
    if (used) return [starts[s], ends[s + last + used - 1]];
  }
  return null;
}

/**
 * 보유 종목 찾기 — 같은 종목(키·시장)은 한 줄로 모으고 보유 계좌를 함께 싣는다.
 * 순위: 코드 일치 → 코드 앞부분 → 이름 첫머리 → 이름 중간(앞에서 맞을수록 위) → 코드 중간 · 같으면 카탈로그 순서.
 * 입력이 길어질수록 맞는 종목이 줄어든다(사용자 요청 — 다 치지 않아도 고를 수 있게).
 */
export function searchHoldingCatalog(catalog: any, query: any, limit: any = 30): {
  code: string; mk: 'kr' | 'us' | 'fund'; name: string; accts: string[]; hit: [number, number] | null; codeHit: boolean;
}[] {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return [];
  const qCode = q.replace(/\s+/g, '').toUpperCase().replace(/^MA:/, '');
  const order: { key: string; code: string; mk: 'kr' | 'us' | 'fund'; name: string; accts: string[] }[] = [];
  const byKey = new Map<string, any>();
  for (const it of Array.isArray(catalog) ? catalog : []) {
    if (!it || typeof it !== 'object') continue;
    const key = holdingKey(it.code);
    if (!key || (it.mk !== 'kr' && it.mk !== 'us' && it.mk !== 'fund')) continue;
    let g = byKey.get(key + ':' + it.mk);
    if (!g) {
      g = { key, code: it.code.trim(), mk: it.mk, name: '', accts: [] };
      byKey.set(key + ':' + it.mk, g);
      order.push(g);
    }
    if (!g.name && typeof it.name === 'string' && it.name.trim()) g.name = it.name.trim();
    if (typeof it.acct === 'string' && it.acct && !g.accts.includes(it.acct)) g.accts.push(it.acct);
  }
  const found: { g: any; hit: [number, number] | null; ci: number; rank: number; at: number; i: number }[] = [];
  order.forEach((g, i) => {
    const hit = g.name ? hangulMatch(g.name, q) : null;
    const ci = qCode ? g.key.indexOf(qCode) : -1;
    const rank = g.key === qCode ? 0 : ci === 0 ? 1 : hit && hit[0] === 0 ? 2 : hit ? 3 : ci > 0 ? 4 : -1;
    if (rank >= 0) found.push({ g, hit, ci, rank, at: hit ? hit[0] : 0, i });
  });
  found.sort((a, b) => a.rank - b.rank || a.at - b.at || a.i - b.i);
  const n = Number.isInteger(limit) && limit > 0 ? limit : 30;
  return found.slice(0, n).map(({ g, hit, ci }) => ({ code: g.code, mk: g.mk, name: g.name, accts: g.accts, hit, codeHit: ci >= 0 }));
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
/** 'YYYY-MM-DD' → 'YY/MM/DD (요일)'. ⚠️ 요일은 UTC로 잰다(`new Date('YYYY-MM-DD')`는 뷰어 타임존에 따라 하루 밀린다). */
export function chartDateLabel(d: any): string {
  if (!isIsoDay(d)) return typeof d === 'string' ? d : '';
  const [y, m, dd] = (d as string).split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${(d as string).slice(2).replace(/-/g, '/')} (${wd})`;
}

// ────────────────────────────────────────────────────────────────────────────
// 최근 분배금(관심종목 '분배금' 열) — 응답 JSON에서 가장 최근 분배 1건을 고른다.
// 결과 상태 3종을 뭉뚱그리지 말 것(사용자가 할 일이 다르다):
//   ok   — 분배 기록이 있다            · none — 응답은 정상인데 분배 기록이 없다
//   null — 응답 모양이 틀렸다(조회 실패로 보고 다음 경로를 시도)
// rate는 **그 분배 1회분의 분배율(%)**이다(연환산 아님). 연간 값(kind:'annual')은 일반 주식의
// 주당배당금·배당수익률이라 화면이 '연'을 붙여 구분한다.

const ymdFromDot = (s: any): string => {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(s || '').trim());
  if (!m) return '';
  const ds = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isIsoDay(ds) ? ds : '';
};
const posNum = (v: any): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,%원$\s]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** 네이버 ETF 분배 이력(`/api/etf/{code}/dividend/history`) → 최근 분배. 분배율은 네이버 표기값. */
export function pickNaverDividend(json: any): any {
  if (!json || typeof json !== 'object' || !Array.isArray(json.result)) return null;
  const rows = json.result
    .map((r: any) => ({ exDate: ymdFromDot(r?.exDividendAt), amount: posNum(r?.dividendAmount), rate: posNum(r?.dividendYield) }))
    .filter((r: any) => r.exDate && r.amount != null);
  if (!rows.length) return json.result.length ? null : { status: 'none' };
  rows.sort((a: any, b: any) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0));
  const top = rows[0];
  return { status: 'ok', kind: 'last', amount: top.amount, exDate: top.exDate, rate: top.rate, rateBasis: 'naver', recent: rows.slice(0, 3) };
}

/** 네이버 종목 요약(`/api/stock/{code}/integration`) → 일반 주식의 연간 주당배당금·배당수익률. */
export function pickNaverAnnualDividend(json: any): any {
  if (!json || typeof json !== 'object' || !Array.isArray(json.totalInfos)) return null;
  const find = (code: string) => json.totalInfos.find((t: any) => t && t.code === code);
  const amount = posNum(find('dividend')?.value);
  if (amount == null) return { status: 'none' };
  return { status: 'ok', kind: 'annual', amount, exDate: '', rate: posNum(find('dividendYieldRatio')?.value), rateBasis: 'naver', recent: [] };
}

/**
 * 야후 차트(`v8/finance/chart?events=div&interval=1d`) → 최근 분배.
 * 분배율 = 분배금 ÷ **배당락 직전 거래일 종가**(같은 응답의 일봉 — 추가 조회 없음).
 * 배당락일 = 이벤트 타임스탬프의 UTC 날짜(장 시작 시각이라 미국 날짜와 같다).
 */
export function pickYahooDividend(json: any): any {
  const r = json?.chart?.result?.[0];
  if (!r || typeof r !== 'object') return null;
  const ev = r.events?.dividends;
  const items = ev && typeof ev === 'object' ? Object.values(ev) : [];
  const divs = items
    .map((x: any) => ({ t: Number(x?.date), amount: posNum(x?.amount) }))
    .filter((x: any) => Number.isFinite(x.t) && x.amount != null)
    .map((x: any) => ({ exDate: new Date(x.t * 1000).toISOString().slice(0, 10), amount: x.amount as number }))
    .sort((a: any, b: any) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0));
  if (!divs.length) return { status: 'none' };
  const ts: any[] = Array.isArray(r.timestamp) ? r.timestamp : [];
  const closes: any[] = Array.isArray(r.indicators?.quote?.[0]?.close) ? r.indicators.quote[0].close : [];
  const closePairs: Pair[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = Number(ts[i]);
    const c = closes[i];
    if (Number.isFinite(t) && typeof c === 'number' && Number.isFinite(c) && c > 0) {
      closePairs.push([new Date(t * 1000).toISOString().slice(0, 10), c]);
    }
  }
  closePairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const rateOf = (d: any) => {
    let prev: Pair | null = null;
    for (const p of closePairs) { if (p[0] < d.exDate) prev = p; else break; }
    return prev ? (d.amount / prev[1]) * 100 : null;
  };
  const recent = divs.slice(0, 3).map((d: any) => ({ ...d, rate: rateOf(d) }));
  return { status: 'ok', kind: 'last', amount: recent[0].amount, exDate: recent[0].exDate, rate: recent[0].rate, rateBasis: 'close', recent };
}
