// 금리 모니터링 ⑤ '자산군별 종목' — 종목 목록 상수 + 순수 계산(6단계, 2026-10).
// ⚠️ import 0건 · React 금지 · enum/namespace 금지 — scripts/verify-rate-assets.mjs가 미러 없이 직접 import한다.
// ⚠️ 시세·배당은 창 메모리에만 둔다(브라우저 저장소·Drive·stockHistoryMap 금지). 여기는 계산만 한다.
// ⚠️ MANUAL_INPUTS는 사람이 확인해 넣는 값이다. 모르면 null — 값을 지어내지 않는다(화면은 '입력 필요').

export const ASSET_WITHHOLDING_PCT = 15; // rateSignals.RATE_RULES.withholdingPct와 같아야 한다(verify:rate-assets #G3)

export interface RateAssetGroup {
  key: string; label: string; tickers: string[]; etfs: string[];
  pin: string | null; sortByYield: boolean; extra: 'pb' | 'spread10y' | 'pnav' | null; note: string | null;
}
export const RATE_ASSET_GROUPS: RateAssetGroup[] = [
  { key: 'highYield', label: '하이일드 ETF', tickers: ['HYG', 'JNK', 'USHY', 'SPHY', 'HYLB', 'ANGL', 'FALN', 'SHYG', 'SJNK'], etfs: [], pin: null, sortByYield: true, extra: null, note: null },
  { key: 'longBond', label: '미국 장기채 ETF', tickers: ['TLT', 'EDV', 'ZROZ', 'VGLT', 'TLTW'], etfs: [], pin: null, sortByYield: true, extra: null, note: null },
  { key: 'mortgageReit', label: '모기지 리츠', tickers: ['AGNC', 'NLY', 'DX', 'TWO', 'ARR'], etfs: [], pin: null, sortByYield: false, extra: 'pb', note: null },
  { key: 'equityReit', label: '실물 리츠', tickers: ['O', 'PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'PSA', 'DLR', 'CCI', 'VICI', 'VNQ'], etfs: ['VNQ'], pin: 'O', sortByYield: false, extra: 'spread10y', note: null },
  { key: 'bdc', label: 'BDC', tickers: ['MAIN', 'ARCC', 'OBDC', 'BXSL', 'HTGC', 'TSLX', 'CSWC', 'FSK', 'BIZD'], etfs: ['BIZD'], pin: 'MAIN', sortByYield: false, extra: 'pnav',
    note: 'MAIN은 평소에도 주당 순자산보다 비싸게 거래되는 종목입니다(배율 1 이상이 보통).' },
];
// ③ 판정에 쓰는 대표 종목 — ⑤ 탭을 열지 않아도 창을 열 때 받는다
export const RATE_ANCHOR_TICKERS = ['HYG', 'AGNC', 'O', 'MAIN'];

// 수동 입력 — 분기 보고서 기준 주당 값. value·asOf(예: '2026-Q2')를 함께 채운다. 모르면 null.
export interface ManualValue { value: number | null; asOf: string | null }
export const MANUAL_INPUTS: { bookValue: Record<string, ManualValue>; nav: Record<string, ManualValue> } = {
  bookValue: {
    AGNC: { value: null, asOf: null },
    NLY: { value: null, asOf: null },
  },
  nav: {
    MAIN: { value: null, asOf: null },
    ARCC: { value: null, asOf: null },
    OBDC: { value: null, asOf: null },
    BXSL: { value: null, asOf: null },
    HTGC: { value: null, asOf: null },
    TSLX: { value: null, asOf: null },
    CSWC: { value: null, asOf: null },
    FSK: { value: null, asOf: null },
  },
};

export interface DivEvent { exDate: string; amount: number }
export type DivCycle = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export const DIV_CYCLE_LABEL: Record<DivCycle, string> = { monthly: '월', quarterly: '분기', semiannual: '반기', annual: '연' };
export type DivChange = 'up' | 'same' | 'down';
export const DIV_CHANGE_LABEL: Record<DivChange, string> = { up: '늘어남', same: '같음', down: '줄어듦' };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const fromDayNum = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const shift = (iso: string, d: number) => fromDayNum(dayNum(iso) + d);
const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Yahoo chart(events=div) 응답 → 배당 이력 전체(날짜 오름차순).
//   { status:'ok', events } / { status:'none' }(정상 응답인데 배당 없음) / null(응답 모양이 틀림 = 조회 실패)
export function pickYahooDividendEvents(json: any): { status: 'ok'; events: DivEvent[] } | { status: 'none' } | null {
  const r = json?.chart?.result?.[0];
  if (!r || typeof r !== 'object') return null;
  const ev = r.events?.dividends;
  const items = ev && typeof ev === 'object' ? Object.values(ev) : [];
  const events = items
    .map((x: any) => ({ t: Number(x?.date), amount: Number(x?.amount) }))
    .filter(x => Number.isFinite(x.t) && pos(x.amount))
    .map(x => ({ exDate: new Date(x.t * 1000).toISOString().slice(0, 10), amount: x.amount }))
    .sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
  if (!events.length) return items.length ? null : { status: 'none' };
  return { status: 'ok', events };
}

// 최근 12개월(asOf − 365일 초과 ~ asOf) 배당 합계
export function trailingDividend(events: DivEvent[] | null | undefined, asOf: string): { sum: number; count: number } | null {
  if (!Array.isArray(events) || !ISO.test(asOf || '')) return null;
  const from = shift(asOf, -365);
  const inWin = events.filter(e => e && ISO.test(e.exDate) && pos(e.amount) && e.exDate > from && e.exDate <= asOf);
  return { sum: inWin.reduce((s, e) => s + e.amount, 0), count: inWin.length };
}

export const dividendYield = (sum: number | null | undefined, price: number | null | undefined): number | null =>
  pos(price) && typeof sum === 'number' && Number.isFinite(sum) && sum >= 0 ? (sum / price) * 100 : null;
export const afterTax = (v: number | null): number | null => (v == null || !Number.isFinite(v) ? null : v * (1 - ASSET_WITHHOLDING_PCT / 100));

// 52주 최고 대비(%) — 최근 365일 종가 + 현재가 중 최고에서 현재가가 몇 % 아래인가(0 또는 음수)
export function drawdownFrom52High(daily: Array<[string, number]> | null | undefined, price: number | null | undefined, asOf: string): number | null {
  if (!pos(price) || !ISO.test(asOf || '')) return null;
  const from = shift(asOf, -365);
  let high = price;
  for (const [d, v] of daily || []) if (d > from && d <= asOf && pos(v) && v > high) high = v;
  return (price / high - 1) * 100;
}

// 배당 주기 — 최근 최대 7회의 간격 중앙값으로 판정(2회 미만이면 모름)
export function dividendCycle(events: DivEvent[] | null | undefined): DivCycle | null {
  const ev = (events || []).filter(e => e && ISO.test(e.exDate)).slice(-7);
  if (ev.length < 2) return null;
  const gaps = ev.slice(1).map((e, i) => dayNum(e.exDate) - dayNum(ev[i].exDate)).sort((a, b) => a - b);
  const g = gaps[Math.floor((gaps.length - 1) / 2)];
  return g <= 45 ? 'monthly' : g <= 130 ? 'quarterly' : g <= 250 ? 'semiannual' : 'annual';
}

const CYCLE_TOL_DAYS: Record<DivCycle, number> = { monthly: 12, quarterly: 40, semiannual: 60, annual: 60 };
export const DIV_SAME_TOL = 0.005; // ±0.5% 안이면 '같음'

// 최근 배당 vs 1년 전 같은 회차(최근 배당일 − 365일에 가장 가까운 배당, 주기별 허용 오차 안)
export function dividendChange(events: DivEvent[] | null | undefined): DivChange | null {
  const ev = (events || []).filter(e => e && ISO.test(e.exDate) && pos(e.amount));
  if (ev.length < 2) return null;
  const cycle = dividendCycle(ev);
  if (!cycle) return null;
  const last = ev[ev.length - 1];
  const target = dayNum(last.exDate) - 365;
  let best: DivEvent | null = null, bestGap = Infinity;
  for (const e of ev.slice(0, -1)) {
    const gap = Math.abs(dayNum(e.exDate) - target);
    if (gap < bestGap) { best = e; bestGap = gap; }
  }
  if (!best || bestGap > CYCLE_TOL_DAYS[cycle]) return null;
  const r = last.amount / best.amount - 1;
  return r > DIV_SAME_TOL ? 'up' : r < -DIV_SAME_TOL ? 'down' : 'same';
}

// 주가 ÷ 주당 장부가(또는 순자산) — 수동값이 있을 때만
export const priceToManual = (price: number | null | undefined, manual: ManualValue | null | undefined): number | null =>
  pos(price) && manual && pos(manual.value) ? price / manual.value : null;

export interface RateAssetInput {
  quote?: { price: number } | null;
  daily?: Array<[string, number]> | null;
  divs?: { status: 'ok'; events: DivEvent[] } | { status: 'none' } | null;
}
export interface RateAssetRow {
  ticker: string; isEtf: boolean; price: number | null;
  yield12: number | null; yieldPost: number | null; divSum: number | null; divCount: number;
  drawdown52: number | null; change: DivChange | null; cycle: DivCycle | null;
  pb: number | null; pnav: number | null; manual: ManualValue | null; manualKind: 'bookValue' | 'nav' | null; manualSet: boolean;
  spread10y: number | null; noDividend: boolean;
}

// 한 종목의 표 행 — 받지 못한 값은 null(0으로 단언하지 않는다)
// manualInputs — 설정 화면(⑥)에서 고친 수동값(rateSettings.mergeManual). 미전달이면 코드 기본값
export function buildRateAssetRow(ticker: string, input: RateAssetInput | null | undefined, asOf: string, us10y?: number | null, isEtf = false, manualInputs = MANUAL_INPUTS): RateAssetRow {
  const price = pos(input?.quote?.price) ? (input!.quote!.price as number) : null;
  const divs = input?.divs;
  const events = divs && divs.status === 'ok' ? divs.events : divs && divs.status === 'none' ? [] : null;
  const tr = events ? trailingDividend(events, asOf) : null;
  const yield12 = tr ? dividendYield(tr.sum, price) : null;
  const mi = manualInputs || MANUAL_INPUTS;
  const manualKind = mi.bookValue?.[ticker] ? 'bookValue' : mi.nav?.[ticker] ? 'nav' : null;
  const manual = manualKind ? mi[manualKind][ticker] : null;
  const ratio = priceToManual(price, manual);
  return {
    ticker, isEtf, price,
    yield12, yieldPost: afterTax(yield12), divSum: tr ? tr.sum : null, divCount: tr ? tr.count : 0,
    drawdown52: drawdownFrom52High(input?.daily, price, asOf),
    change: events ? dividendChange(events) : null,
    cycle: events ? dividendCycle(events) : null,
    pb: manualKind === 'bookValue' ? ratio : null,
    pnav: manualKind === 'nav' ? ratio : null,
    manual, manualKind, manualSet: !!manual && pos(manual.value),
    spread10y: yield12 != null && typeof us10y === 'number' && Number.isFinite(us10y) ? yield12 - us10y : null,
    noDividend: !!divs && divs.status === 'none',
  };
}

// 탭 표 행 순서 — 고정 종목 맨 위 → 배당률 높은 순(정렬 탭만, 모르는 값은 맨 아래) → 그 외 목록 순서
export function orderRateAssetRows(group: RateAssetGroup, rows: RateAssetRow[]): RateAssetRow[] {
  const idx = (t: string) => group.tickers.indexOf(t);
  return [...rows].sort((a, b) => {
    if (group.pin) { if (a.ticker === group.pin) return -1; if (b.ticker === group.pin) return 1; }
    if (group.sortByYield) {
      const ya = a.yield12, yb = b.yield12;
      if (ya != null && yb != null && ya !== yb) return yb - ya;
      if (ya != null && yb == null) return -1;
      if (ya == null && yb != null) return 1;
    }
    return idx(a.ticker) - idx(b.ticker);
  });
}
