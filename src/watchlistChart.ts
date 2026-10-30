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

type Holding = { acct: string; avg: number; qty: number; cur: 'KRW' | 'USD' };

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
  for (const p of list) {
    if (!p || typeof p !== 'object' || p.deletedAt || p.isTest) continue;
    const type = p.accountType || 'portfolio';
    if (HOLD_SKIP_ACCOUNTS.includes(type)) continue;
    const overseas = type === 'overseas';
    const acct = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : '계좌';
    const sums = new Map<string, { cost: number; qty: number }>();
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
      const s = sums.get(key) || { cost: 0, qty: 0 };
      s.cost += cost;
      s.qty += qty;
      sums.set(key, s);
    }
    for (const [key, s] of sums) {
      const avg = s.cost / s.qty;
      if (!Number.isFinite(avg) || avg <= 0) continue;
      if (!out[key]) out[key] = [];
      if (out[key].length < MAX_HOLD_PER_KEY) out[key].push({ acct, avg, qty: s.qty, cur: overseas ? 'USD' : 'KRW' });
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
      good.push({ acct, avg, qty, cur: h.cur });
    }
    if (key && good.length) { out[key] = good; n++; }
  }
  return out;
}

/**
 * 여러 계좌 보유분의 합산 매입가(총 투자금액 ÷ 총 수량) — 미니차트처럼 선을 **하나만** 그을 곳과 머리글 요약용.
 * 차트 창의 가로선은 계좌마다 따로 긋는다(이 값으로 합치지 않는다).
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
