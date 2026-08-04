// ─────────────────────────────────────────────────────────────────────────────
// src/backtest.ts — 리밸런싱 백테스트 엔진 (타입 + 순수 로직)
//
// ⚠️ 이 파일에는 `// @ts-nocheck`를 붙이지 말 것.
//    빌드가 `vite build`(esbuild, 타입체크 없음)라 저장소 대부분이 nocheck인데,
//    nocheck가 없는 소수 파일(utils.ts·flowMap.ts·fxRates.ts 등)만 에디터 타입검사를
//    받는다. 이 기능에서는 그 타입이 유일한 안전망이다.
//
// ⚠️ React state·DOM·fetch 접근 금지 — scripts/verify-backtest.mjs가 본문을 미러 복사해
//    테스트한다(verify-flow.mjs·verify-fx.mjs·verify-twr.mjs 선례).
//    아래 함수 본문을 고치면 verify-backtest.mjs의 참조 구현도 1:1로 동기화할 것.
//
// ⚠️ BtConfig에 시세 시계열을 넣지 말 것. 시나리오는 Drive STATE에 영속되는데
//    종목 1개의 2년치 일봉만 해도 수십 KB고, STATE는 백업 22본으로 복제된다.
//    시계열은 **코드 참조**로만 두고 실행 시점에 주입한다(BtPrices).
//
// ─────────────────────────────────────────────────────────────────────────────
//  일정 규칙 (2026 커버드콜 백테스트 PDF에서 역산 — 12개 리밸런싱일 중 10개 정확 일치,
//  불일치 2개는 PDF가 일요일을 쓴 오류였다)
//
//    지급기준일 = 월중 15일 / 월말 말일   (휴장이면 직전 영업일)
//    분배락일   = 기준일 −1영업일          (exDivOffset)
//    리밸런싱일 = 분배락 −1영업일 = 기준일 −2영업일  (rebalOffset)
//                 → 분배금을 받을 수 있는 마지막 매수일(T+2 결제)
//    지급일     = 기준일 +2영업일          (payOffset)
//
//  ⚠️ 월별 오버라이드는 **리밸런싱일만** 옮긴다. 분배락·지급일은 시장이 정하는 값이라
//     사용자가 옮길 수 없다(옮기면 권리 확정 수량이 실제와 달라진다).
// ─────────────────────────────────────────────────────────────────────────────

import { generateId } from './utils';

/* ===========================================================================
 * A. 저장되는 타입 (Drive STATE `backtestScenarios` 필드)
 *    불변식: 사용자가 직접 입력한 값과 코드 참조만 들어간다.
 *    종가·분배금 시계열 같은 라이브/대용량 파생값은 절대 저장하지 않는다.
 * =========================================================================== */

/** 분배 사이클. 'none' = 분배 없음(리밸런싱은 월말 그룹에 편입). */
export type BtPayCycle = 'mid' | 'eom' | 'none';

/** 리밸런싱 그룹. 'all' = 정책이 일괄일 때의 단일 그룹. */
export type BtGroup = 'mid' | 'eom' | 'all';

/**
 * 리밸런싱 정책.
 *  perCycle — 각 종목을 **자기 분배 사이클**의 분배락 전에 (PDF 방식)
 *  allMid   — 전 종목을 월중 분배락 전에 일괄
 *  allEom   — 전 종목을 월말 분배락 전에 일괄
 *  fixedDay — 매월 지정일(휴장이면 직전 영업일)에 전 종목 일괄
 */
export type BtPolicy = 'perCycle' | 'allMid' | 'allEom' | 'fixedDay';

/** 목표 해석. amount=종목별 목표금액 / ratio=비중(%) × ratioBase */
export type BtTargetMode = 'amount' | 'ratio';

/** 비중 모드의 분모. equity=활성 종목 평가액 합 / total=평가액+현금 / initial=초기 투자금 고정 */
export type BtRatioBase = 'equity' | 'total' | 'initial';

/** 수량 산출 규칙. floor=0 방향 버림(PDF 규약) / round=반올림 / exact=소수 허용(펀드 좌수) */
export type BtRounding = 'floor' | 'round' | 'exact';

/** 중도 이벤트의 재원 조달 방식. */
export type BtFunding =
  /** 활성 전 종목을 그 자리에서 새 목표로 맞춘다(기존 종목 매도 → 신규 매수). PDF 4/21 방식. */
  | 'reallocate'
  /** 신규 편입 종목만 보유 현금으로 매수. 기존 종목은 건드리지 않는다. */
  | 'cash'
  /** 목표만 바꾸고 매매는 다음 정기 리밸런싱까지 대기. */
  | 'defer';

export interface BtAsset {
  id: string;
  /** 종목코드(국내 6자 영숫자 등). 시세·분배금 조회의 유일한 키. */
  code: string;
  name: string;
  payCycle: BtPayCycle;
  /** 목표금액(원). targetMode='amount'일 때 사용. null=미지정 */
  targetAmount: number | null;
  /** 목표비중(%). targetMode='ratio'일 때 사용. null=미지정 */
  targetRatio: number | null;
  /**
   * 편입 시작일. 비우면 **종가 기록이 있는 첫날**로 자동 결정된다
   * (조회기간 중간 상장 종목이 그날부터 자연스럽게 편입되게 하는 장치).
   */
  startDate: string;
  /** 편입 종료일. 비우면 기간 끝까지. */
  endDate: string;
  /**
   * 주당 분배금 수동 입력 — `{ 'YYYY-MM'(배당락월): 원 }`.
   * 계좌 dividendHistory에 이력이 없는 달(미상장·미래·미입력)을 사용자가 직접 채운다.
   * ⚠️ 저장 키는 앱 전체 규약과 같은 **배당락월**이다(지급월 아님).
   */
  divOverride: Record<string, number>;
  color: string;
}

export interface BtEventTarget {
  assetId: string;
  amount: number | null;
  ratio: number | null;
}

export interface BtEvent {
  id: string;
  /** 실행일. 휴장이면 직전 영업일로 스냅된다. */
  date: string;
  label: string;
  funding: BtFunding;
  /** 이 날짜부터 활성화되는 종목(assets[].id) */
  addAssets: string[];
  /** 이 날짜에 전량 매도 후 비활성화되는 종목 */
  removeAssets: string[];
  /** 이 날짜 이후 적용될 새 목표 */
  targets: BtEventTarget[];
}

export interface BtOverride {
  id: string;
  /** 'YYYY-MM' */
  ym: string;
  group: BtGroup;
  /** 임의 리밸런싱일. 휴장이면 직전 영업일로 스냅. */
  date: string;
}

export interface BtConfig {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** 초기 투자금(원). 초기 매수 후 남는 잔돈은 자동으로 예수금이 된다. */
  initialCapital: number;
  /** 초기 투자금과 별도로 들고 시작할 현금(선택, 기본 0). */
  extraCash: number;
  targetMode: BtTargetMode;
  ratioBase: BtRatioBase;
  rounding: BtRounding;
  policy: BtPolicy;
  /** policy='fixedDay'일 때 매월 며칠(1~31) */
  fixedDay: number;
  /** 기준일 대비 분배락 오프셋(영업일). 기본 −1 */
  exDivOffset: number;
  /** 분배락 대비 리밸런싱 오프셋(영업일). 기본 −1 */
  rebalOffset: number;
  /** 기준일 대비 지급일 오프셋(영업일). 기본 +2 */
  payOffset: number;
  /** true면 현금이 부족해도 매수(마이너스 예수금 허용). 기본 false = 가능한 수량만. */
  allowNegativeCash: boolean;
  assets: BtAsset[];
  events: BtEvent[];
  overrides: BtOverride[];
  createdAt: number;
  /** ⚠️ 커밋 시에만 갱신. 렌더 중 갱신 금지(지문이 매 렌더 흔들려 저장이 무한 재트리거된다). */
  updatedAt: number;
}

export type BtScenarios = BtConfig[];

/* ===========================================================================
 * B. 소프트 상한 — STATE는 백업 22본으로 복제되므로 무한 증식만 막는다.
 * =========================================================================== */

export const MAX_BT_SCENARIOS = 10;
export const MAX_BT_ASSETS = 20;
export const MAX_BT_EVENTS = 40;
export const MAX_BT_OVERRIDES = 120;

export const BT_COLORS = [
  '#60A5FA', '#F472B6', '#34D399', '#FBBF24', '#A78BFA',
  '#22D3EE', '#FB923C', '#4ADE80', '#F87171', '#2DD4BF',
];

/* ===========================================================================
 * C. 실행 시점에만 주입되는 라이브 입력 (절대 저장하지 않음)
 * =========================================================================== */

/** `{ [code]: { 'YYYY-MM-DD': 종가 } }` */
export type BtPrices = Record<string, Record<string, number>>;
/** `{ [code]: { 'YYYY-MM'(배당락월): 주당분배금 } }` */
export type BtDividendMap = Record<string, Record<string, number>>;

export interface BtRunInput {
  config: BtConfig;
  prices: BtPrices;
  /** 계좌들에서 모은 주당 분배금 이력. asset.divOverride가 항상 우선한다. */
  dividends: BtDividendMap;
  /** KRX 휴장일 'YYYY-MM-DD' 배열. 비어 있으면 주말만 판정(graceful degradation). */
  holidays: string[];
}

/* ===========================================================================
 * D. 결과 타입
 * =========================================================================== */

export interface BtTrade {
  date: string;
  assetId: string;
  code: string;
  name: string;
  price: number;
  /** 종가가 그 날짜에 정확히 있었는가. false면 직전 종가를 이월했다(경고 대상). */
  priceExact: boolean;
  qtyBefore: number;
  evalBefore: number;
  /** 목표금액(그 시점) */
  target: number;
  /** + 매수 / − 매도 (PDF의 '매수/매도 수량'은 이 값의 절댓값 + 방향 라벨) */
  qty: number;
  /** + 매도대금(현금 유입) / − 매수대금(현금 유출) — PDF의 '리밸런싱 매매 금액' */
  cashDelta: number;
  qtyAfter: number;
  evalAfter: number;
  /**
   * ⚠️ 종목 편입/재편에 따른 구조 변경 매매 = **리밸런싱 차익에서 제외**.
   *    PDF 4월 합계 25,859,200은 회색 음영 3행(4/21 재편)을 뺀 값과 정확히 일치한다.
   */
  structural: boolean;
  /** 현금 부족으로 목표에 못 미쳤을 때의 사유 */
  note: string;
}

export interface BtDividendRow {
  ym: string;
  recordDate: string;
  exDate: string;
  payDate: string;
  assetId: string;
  code: string;
  name: string;
  perShare: number;
  /** 분배락일 기준 권리 확정 수량 */
  qty: number;
  amount: number;
  source: 'history' | 'manual' | 'none';
}

export interface BtSlot {
  ym: string;
  group: BtGroup;
  /** 이 리밸런싱일을 만들어 낸 기준 일정(표시용). 정책이 fixedDay면 참고값일 뿐이다. */
  recordDate: string;
  exDate: string;
  payDate: string;
  /** 실제 리밸런싱 실행일(오버라이드 반영 후) */
  rebalDate: string;
  /** 오버라이드로 옮겨진 슬롯인가 */
  overridden: boolean;
  assetIds: string[];
}

/**
 * 분배 일정 슬롯.
 * ⚠️ **리밸런싱 정책과 완전히 독립**이다 — 분배락·지급일은 시장이 정하는 값이라
 *    사용자가 리밸런싱을 언제 하든 바뀌지 않는다. 월중 종목은 항상 mid 일정,
 *    월말 종목은 항상 eom 일정으로 분배받는다.
 */
export interface BtDivSlot {
  ym: string;
  cycle: 'mid' | 'eom';
  recordDate: string;
  exDate: string;
  payDate: string;
  assetIds: string[];
}

export interface BtMonth {
  ym: string;
  trades: BtTrade[];
  /**
   * ⚠️ **분배락 기준 월**로 담는다(지급월 아님) — PDF 표의 '주당 분배금/지급 분배금' 열이
   *    리밸런싱 행 옆에 붙기 때문이고, 앱 전체의 dividendHistory 저장 키 규약과도 같다.
   *    실제 현금이 들어온 달은 divPaid가 따로 센다.
   */
  dividends: BtDividendRow[];
  /** 그 달 정기 리밸런싱 매매금액 합 (structural 제외) — PDF '합계' 열 */
  tradeNet: number;
  /** 구조 변경 매매금액 합 (참고 표시용, 차익에 미포함) */
  structuralNet: number;
  cumTradeNet: number;
  /** 분배락 기준 그 달에 확정된 분배금 합 — PDF '지급 분배금' 합계와 일치 */
  divAccrued: number;
  cumDivAccrued: number;
  /**
   * 그 달에 **실제로 입금된** 분배금 합(지급일 기준). 현금 잔고는 이 값으로만 움직인다.
   * ⚠️ 월말 분배는 지급일(기준일+2영업일)이 다음 달 초라 divAccrued와 한 달 어긋나는 것이 정상이다.
   */
  divPaid: number;
  cumDivPaid: number;
  /** 그 달 현금 증감 (정기차익 + 구조매매 + 입금 분배금) */
  cashDelta: number;
  /** 월말 시점 예수금 */
  cashEnd: number;
  /** 월말 시점 종목 평가액 합 */
  evalEnd: number;
  /** evalEnd + cashEnd */
  totalEnd: number;
  /** 리밸런싱 직전 평가액 합계 (PDF '리밸런싱 전 평가액' 합계 행) */
  evalBeforeSum: number;
}

export interface BtHolding {
  assetId: string;
  code: string;
  name: string;
  qty: number;
  price: number;
  priceExact: boolean;
  evalAmount: number;
  weight: number;
}

export interface BtAssetMeta {
  assetId: string;
  code: string;
  name: string;
  /** 주입된 종가 시계열의 첫/마지막 날짜 */
  firstDate: string;
  lastDate: string;
  /** 기간 내 종가가 있는 날 수 */
  daysInRange: number;
  /** 기간 내 영업일 수 */
  businessDaysInRange: number;
  /** 조회기간 시작보다 늦게 상장(또는 데이터 시작) */
  lateStart: boolean;
  /** 조회기간 끝보다 일찍 데이터가 끊김 */
  earlyEnd: boolean;
  /** 실제 편입일(사용자 지정 startDate 또는 데이터 첫날 중 늦은 쪽) */
  effectiveStart: string;
  /** 기간 내부의 결측 구간 수(연속 결측 1건 = 1) */
  gapCount: number;
}

export interface BtResult {
  ok: boolean;
  /** 실행 자체가 불가능한 사유(설정 오류·데이터 없음). 있으면 months는 비어 있다. */
  fatal: string;
  warnings: string[];
  slots: BtSlot[];
  assetMeta: BtAssetMeta[];
  initialDate: string;
  initialTrades: BtTrade[];
  initialCashAfter: number;
  months: BtMonth[];
  /** 영업일 단위 자산 추이 */
  curve: { date: string; evalAmount: number; cash: number; total: number }[];
  finalHoldings: BtHolding[];
  summary: {
    startDate: string;
    endDate: string;
    initialCapital: number;
    finalEval: number;
    finalCash: number;
    finalTotal: number;
    /** finalTotal − (initialCapital + extraCash) */
    profit: number;
    profitRate: number;
    cumTradeNet: number;
    cumStructuralNet: number;
    /** 분배락 기준 누적 분배금 — PDF의 '누적 분배금 합계'와 같은 정의 */
    cumDivAccrued: number;
    /** 실제 입금된 누적 분배금(지급일 기준). 기말 예수금에 반영된 값. */
    cumDivPaid: number;
    /** 최고 자산 대비 최대 낙폭(%) */
    maxDrawdown: number;
    months: number;
  };
}

/* ===========================================================================
 * E. 날짜 / 영업일 유틸
 *    ⚠️ 전부 'YYYY-MM-DD' 문자열 산술 + UTC 정오 앵커. `new Date('YYYY-MM-DD')`의
 *       UTC 자정 파싱이 로컬 타임존에서 하루 밀리는 사고를 이 앵커가 막는다
 *       (savingsEval의 '시각 비교 금지' 규약과 동일 이유).
 * =========================================================================== */

const DAY_MS = 86400000;

export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → UTC 정오 epoch ms. 유효하지 않으면 NaN. */
export function dateToMs(s: string): number {
  if (!isIsoDate(s)) return NaN;
  const y = +s.slice(0, 4);
  const m = +s.slice(5, 7);
  const d = +s.slice(8, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return NaN;
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  const back = msToDate(ms);
  return back === s ? ms : NaN;   // 2026-02-31 같은 비존재 날짜 배제
}

export function msToDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(s: string, n: number): string {
  const ms = dateToMs(s);
  if (!Number.isFinite(ms)) return s;
  return msToDate(ms + n * DAY_MS);
}

/** 0=일 … 6=토 */
export function weekdayOf(s: string): number {
  const ms = dateToMs(s);
  if (!Number.isFinite(ms)) return -1;
  return new Date(ms).getUTCDay();
}

/**
 * 영업일 판정 — 주말 + KRX 휴장일.
 * ⚠️ 휴장일 배열이 비어 있어도(캘린더 로드 전) 주말만으로 우아하게 동작해야 한다.
 */
export function isBusinessDay(s: string, holidays: Set<string> | string[]): boolean {
  const wd = weekdayOf(s);
  if (wd < 0 || wd === 0 || wd === 6) return false;
  const has = holidays instanceof Set ? holidays.has(s) : holidays.includes(s);
  return !has;
}

/** 그날이 영업일이면 그대로, 아니면 **직전** 영업일. */
export function onOrBeforeBusinessDay(s: string, holidays: Set<string>): string {
  let cur = s;
  for (let i = 0; i < 400; i++) {
    if (!isIsoDate(cur)) return s;
    if (isBusinessDay(cur, holidays)) return cur;
    cur = addDays(cur, -1);
  }
  return s;
}

/** 그날이 영업일이면 그대로, 아니면 **직후** 영업일. */
export function onOrAfterBusinessDay(s: string, holidays: Set<string>): string {
  let cur = s;
  for (let i = 0; i < 400; i++) {
    if (!isIsoDate(cur)) return s;
    if (isBusinessDay(cur, holidays)) return cur;
    cur = addDays(cur, 1);
  }
  return s;
}

/**
 * 영업일 n칸 이동. n<0이면 과거, n>0이면 미래.
 * 시작점이 영업일이 아니면 먼저 스냅한 뒤 센다.
 * ⚠️ n === 0은 **직전** 영업일로 스냅한다(onOrAfter 아님) — 백테스트가 어떤 경우에도
 *    미래 정보를 당겨 쓰지 않게 하는 보수적 기본값이다(priceAt의 carry-back 금지와 같은 원칙).
 */
export function shiftBusinessDays(s: string, n: number, holidays: Set<string>): string {
  if (!isIsoDate(s)) return s;
  let cur = n > 0 ? onOrAfterBusinessDay(s, holidays) : onOrBeforeBusinessDay(s, holidays);
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(n);
  let guard = 0;
  while (left > 0 && guard < 4000) {
    cur = addDays(cur, step);
    guard++;
    if (isBusinessDay(cur, holidays)) left--;
  }
  return cur;
}

/** 두 영업일 사이의 모든 영업일(양끝 포함). */
export function businessDaysBetween(from: string, to: string, holidays: Set<string>): string[] {
  const out: string[] = [];
  const endMs = dateToMs(to);
  if (!Number.isFinite(dateToMs(from)) || !Number.isFinite(endMs)) return out;
  let cur = from;
  let guard = 0;
  while (dateToMs(cur) <= endMs && guard < 20000) {
    if (isBusinessDay(cur, holidays)) out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

export const ymOf = (s: string): string => (isIsoDate(s) ? s.slice(0, 7) : '');

/** 'YYYY-MM'의 말일 'YYYY-MM-DD' */
export function lastDayOfMonth(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return '';
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7);
  const d = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  return `${ym}-${pad2(d)}`;
}

/** [startDate, endDate]를 덮는 'YYYY-MM' 목록 (오름차순). */
export function monthsBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return out;
  let y = +startDate.slice(0, 4);
  let m = +startDate.slice(5, 7);
  const ey = +endDate.slice(0, 4);
  const em = +endDate.slice(5, 7);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 1200) {
    out.push(`${y}-${pad2(m)}`);
    m++;
    if (m > 12) { m = 1; y++; }
    guard++;
  }
  return out;
}

/**
 * 그 달 사이클의 **지급기준일**.
 *   mid = 15일 / eom = 말일. 휴장이면 직전 영업일.
 */
export function recordDateFor(ym: string, cycle: 'mid' | 'eom', holidays: Set<string>): string {
  const raw = cycle === 'mid' ? `${ym}-15` : lastDayOfMonth(ym);
  if (!isIsoDate(raw)) return '';
  return onOrBeforeBusinessDay(raw, holidays);
}

/* ===========================================================================
 * F. 시세 조회
 * =========================================================================== */

export interface BtPriceHit {
  price: number;
  /** 그 날짜에 정확히 값이 있었는가. false = 직전 종가 이월. */
  exact: boolean;
  /** 값을 전혀 못 찾음 */
  missing: boolean;
  /** exact=false일 때 실제로 쓴 날짜 */
  usedDate: string;
}

const NO_PRICE: BtPriceHit = { price: 0, exact: false, missing: true, usedDate: '' };

/**
 * 그 날짜의 종가. 없으면 **직전** 기록으로 이월한다(carry-forward).
 * ⚠️ 미래로 당겨오는 carry-back은 절대 금지 — 백테스트가 미래 정보를 쓰게 된다.
 */
export function priceAt(series: Record<string, number> | undefined, date: string): BtPriceHit {
  if (!series || !isIsoDate(date)) return NO_PRICE;
  const exactVal = series[date];
  if (typeof exactVal === 'number' && Number.isFinite(exactVal) && exactVal > 0) {
    return { price: exactVal, exact: true, missing: false, usedDate: date };
  }
  let best = '';
  for (const d in series) {
    if (d > date) continue;
    if (d > best) {
      const v = series[d];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) best = d;
    }
  }
  if (!best) return NO_PRICE;
  return { price: series[best], exact: false, missing: false, usedDate: best };
}

/** 시계열의 첫/마지막 유효 날짜. */
export function seriesRange(series: Record<string, number> | undefined): { first: string; last: string; count: number } {
  let first = '';
  let last = '';
  let count = 0;
  if (!series) return { first, last, count };
  for (const d in series) {
    const v = series[d];
    if (!isIsoDate(d) || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    count++;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  return { first, last, count };
}

/* ===========================================================================
 * G. 수량 규칙
 * =========================================================================== */

/**
 * 목표금액까지 맞추기 위한 매매 수량.
 * ⚠️ 'floor'는 Math.floor가 아니라 **Math.trunc(0 방향 버림)** 이다 —
 *    매도(음수)에도 같은 규약이 걸려야 PDF의 `−594.67 → 594주 매도`가 재현된다.
 *    Math.floor(−594.67)은 −595가 되어 매도량이 1주 늘어난다.
 */
export function roundQty(raw: number, mode: BtRounding): number {
  if (!Number.isFinite(raw)) return 0;
  if (mode === 'exact') return raw;
  if (mode === 'round') return Math.round(raw);
  return Math.trunc(raw);
}

/* ===========================================================================
 * H. 정규화 / 지문 / sticky 판정
 * =========================================================================== */

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNum = (v: unknown, fb: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fb;
const asNumOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const asArr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const clampInt = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(v)));

export function makeBtAsset(partial: Partial<BtAsset> = {}, idx = 0): BtAsset {
  const cycle = partial.payCycle;
  return {
    id: partial.id || generateId(),
    code: asStr(partial.code).trim().toUpperCase(),
    name: asStr(partial.name),
    payCycle: cycle === 'mid' || cycle === 'eom' || cycle === 'none' ? cycle : 'eom',
    targetAmount: asNumOrNull(partial.targetAmount),
    targetRatio: asNumOrNull(partial.targetRatio),
    startDate: isIsoDate(partial.startDate) ? partial.startDate : '',
    endDate: isIsoDate(partial.endDate) ? partial.endDate : '',
    divOverride: normalizeDivOverride(partial.divOverride),
    color: asStr(partial.color) || BT_COLORS[idx % BT_COLORS.length],
  };
}

function normalizeDivOverride(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw as any)) {
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const v = (raw as any)[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

export function makeBtConfig(partial: Partial<BtConfig> = {}): BtConfig {
  const ts = Date.now();
  const policy = partial.policy;
  const mode = partial.targetMode;
  const base = partial.ratioBase;
  const rounding = partial.rounding;
  return {
    id: partial.id || generateId(),
    name: asStr(partial.name) || '백테스트',
    startDate: isIsoDate(partial.startDate) ? partial.startDate : '',
    endDate: isIsoDate(partial.endDate) ? partial.endDate : '',
    initialCapital: Math.max(0, asNum(partial.initialCapital, 0)),
    extraCash: Math.max(0, asNum(partial.extraCash, 0)),
    targetMode: mode === 'ratio' ? 'ratio' : 'amount',
    ratioBase: base === 'total' || base === 'initial' ? base : 'equity',
    rounding: rounding === 'round' || rounding === 'exact' ? rounding : 'floor',
    policy:
      policy === 'allMid' || policy === 'allEom' || policy === 'fixedDay' ? policy : 'perCycle',
    fixedDay: clampInt(asNum(partial.fixedDay, 15), 1, 31),
    exDivOffset: clampInt(asNum(partial.exDivOffset, -1), -10, 0),
    rebalOffset: clampInt(asNum(partial.rebalOffset, -1), -10, 0),
    payOffset: clampInt(asNum(partial.payOffset, 2), 0, 10),
    allowNegativeCash: !!partial.allowNegativeCash,
    assets: asArr(partial.assets).slice(0, MAX_BT_ASSETS).map((a, i) => makeBtAsset(a, i)),
    events: asArr(partial.events).slice(0, MAX_BT_EVENTS).map(normalizeEvent),
    overrides: asArr(partial.overrides).slice(0, MAX_BT_OVERRIDES).map(normalizeOverride).filter(Boolean) as BtOverride[],
    createdAt: asNum(partial.createdAt, ts),
    updatedAt: asNum(partial.updatedAt, ts),
  };
}

function normalizeEvent(raw: any): BtEvent {
  const f = raw?.funding;
  return {
    id: asStr(raw?.id) || generateId(),
    date: isIsoDate(raw?.date) ? raw.date : '',
    label: asStr(raw?.label),
    funding: f === 'cash' || f === 'defer' ? f : 'reallocate',
    addAssets: asArr(raw?.addAssets).map(asStr).filter(Boolean),
    removeAssets: asArr(raw?.removeAssets).map(asStr).filter(Boolean),
    targets: asArr(raw?.targets)
      .map((t: any) => ({
        assetId: asStr(t?.assetId),
        amount: asNumOrNull(t?.amount),
        ratio: asNumOrNull(t?.ratio),
      }))
      .filter(t => !!t.assetId),
  };
}

function normalizeOverride(raw: any): BtOverride | null {
  const ym = asStr(raw?.ym);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  if (!isIsoDate(raw?.date)) return null;
  const g = raw?.group;
  return {
    id: asStr(raw?.id) || generateId(),
    ym,
    group: g === 'mid' || g === 'all' ? g : g === 'eom' ? 'eom' : 'all',
    date: raw.date,
  };
}

/**
 * sticky 복원 판정의 **단일 소스**.
 * ⚠️ App.tsx(applyBackupData)와 useDriveSync.ts(_preserveStickyPersonalData)가 반드시 이
 *    함수를 공유해야 한다 — 판정식을 손으로 복제하면 in-memory와 Drive write가 갈려
 *    "화면엔 남아 있다가 다음 로드에서 사라지는" 최악의 유실이 된다(flowMapsHaveContent 선례).
 * ⚠️ '컨테이너가 있는가'(length>0)가 아니라 '내용이 있는가'로 잰다 — 페이지를 열기만 해도
 *    빈 시나리오 1개가 생기므로, length 기준이면 백업으로 되살릴 길이 영구히 막힌다.
 */
export function backtestScenariosHaveContent(scenarios: unknown): boolean {
  if (!Array.isArray(scenarios)) return false;
  return scenarios.some(
    (s: any) => !!s && (asArr(s.assets).length > 0 || asArr(s.events).length > 0 || asArr(s.overrides).length > 0),
  );
}

/**
 * 지문 문자열. App.tsx portfolioStructureKey에서 사용.
 * ⚠️ 저장 대상 필드만 화이트리스트로 투영한다(런타임 필드가 섞여도 순환 참조로 죽지 않게).
 * ⚠️ 절대 던지지 않는다 — 던지면 지문 계산 아래의 saveStateRef 갱신·저장 예약이 함께
 *    실행되지 않아 그 세션의 Drive 저장이 통째로 멈춘다.
 * ⚠️ 길이·개수 해시로 줄이지 말 것 — investmentNotesKey('본문만 고치면 저장 안 됨')와
 *    holdingSnapshotsKey('수량만 재편집하면 저장 안 됨') 버그가 정확히 그것이었다.
 * ⚠️ updatedAt은 제외(커밋 시각 변화만으로 지문이 흔들리지 않게 — flowFingerprint 동일 규약).
 */
export function backtestFingerprint(scenarios: unknown): string {
  try {
    if (!Array.isArray(scenarios)) return '';
    return JSON.stringify(
      scenarios.map((s: any) => ({
        i: s?.id ?? '',
        n: s?.name ?? '',
        p: [
          s?.startDate ?? '', s?.endDate ?? '', s?.initialCapital ?? 0, s?.extraCash ?? 0,
          s?.targetMode ?? '', s?.ratioBase ?? '', s?.rounding ?? '', s?.policy ?? '',
          s?.fixedDay ?? 0, s?.exDivOffset ?? 0, s?.rebalOffset ?? 0, s?.payOffset ?? 0,
          s?.allowNegativeCash ? 1 : 0,
        ],
        a: asArr(s?.assets).map((a: any) => [
          a?.id ?? '', a?.code ?? '', a?.name ?? '', a?.payCycle ?? '',
          a?.targetAmount ?? null, a?.targetRatio ?? null,
          a?.startDate ?? '', a?.endDate ?? '', a?.color ?? '',
          // ⚠️ 주당 분배금 수동 입력은 결과를 바꾸는 사용자 데이터다 — 키 정렬로 안정화해 포함.
          Object.keys(a?.divOverride ?? {}).sort().map(k => `${k}:${a.divOverride[k]}`).join(','),
        ]),
        e: asArr(s?.events).map((e: any) => [
          e?.id ?? '', e?.date ?? '', e?.label ?? '', e?.funding ?? '',
          asArr(e?.addAssets).join(','), asArr(e?.removeAssets).join(','),
          asArr(e?.targets).map((t: any) => `${t?.assetId ?? ''}:${t?.amount ?? ''}:${t?.ratio ?? ''}`).join('|'),
        ]),
        o: asArr(s?.overrides).map((o: any) => [o?.id ?? '', o?.ym ?? '', o?.group ?? '', o?.date ?? '']),
      })),
    );
  } catch {
    return 'ERR';
  }
}

/**
 * 로드 정규화. applyStateData·applyBackupData 양쪽에서 호출.
 * ⚠️ 변경이 없으면 **원본 참조를 그대로 반환** — 불필요한 저장 트리거 방지
 *    (normalizeFlowMaps·normalizeCalendarMemos·dedupeHistoryByDate 패턴).
 */
export function normalizeBacktestScenarios(raw: unknown): BtScenarios {
  if (!Array.isArray(raw)) return [];
  const sliced = raw.length > MAX_BT_SCENARIOS ? raw.slice(0, MAX_BT_SCENARIOS) : raw;
  let changed = sliced !== raw;
  const seen = new Set<string>();
  const out: BtConfig[] = [];
  for (const s of sliced as any[]) {
    if (!s || typeof s !== 'object') { changed = true; continue; }
    const fixed = makeBtConfig(s);
    if (!fixed.id || seen.has(fixed.id)) { fixed.id = generateId(); changed = true; }
    seen.add(fixed.id);
    // 얕은 동등 판정 — 지문이 같으면 원본 참조를 유지한다.
    if (backtestFingerprint([s]) !== backtestFingerprint([fixed])) changed = true;
    out.push(fixed);
  }
  return changed ? out : (raw as BtScenarios);
}

/* ===========================================================================
 * I. 일정 생성
 * =========================================================================== */

/** 정책이 요구하는 리밸런싱 그룹 목록. */
function groupsForPolicy(policy: BtPolicy): BtGroup[] {
  if (policy === 'perCycle') return ['mid', 'eom'];
  return ['all'];
}

/** 그 그룹에서 리밸런싱되는 종목. */
function assetsInGroup(assets: BtAsset[], group: BtGroup): string[] {
  if (group === 'all') return assets.map(a => a.id);
  if (group === 'mid') return assets.filter(a => a.payCycle === 'mid').map(a => a.id);
  // 'eom' — 분배 없는 종목('none')도 월말 그룹에서 리밸런싱한다.
  return assets.filter(a => a.payCycle === 'eom' || a.payCycle === 'none').map(a => a.id);
}

/**
 * 리밸런싱 슬롯 생성.
 * ⚠️ 오버라이드는 **rebalDate만** 옮긴다(recordDate·exDate·payDate 불변) — 분배 일정은
 *    시장이 정하는 값이라 사용자가 옮기면 권리 확정 수량이 실제와 달라진다.
 */
export function buildSlots(config: BtConfig, holidays: Set<string>): BtSlot[] {
  const out: BtSlot[] = [];
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return out;
  const ovMap = new Map<string, BtOverride>();
  for (const o of config.overrides) ovMap.set(`${o.ym}|${o.group}`, o);

  for (const ym of monthsBetween(config.startDate, config.endDate)) {
    for (const group of groupsForPolicy(config.policy)) {
      // 분배 기준일은 정책과 무관하게 그 그룹의 사이클을 따른다.
      const cycle: 'mid' | 'eom' =
        group === 'mid' ? 'mid'
        : group === 'eom' ? 'eom'
        : config.policy === 'allMid' ? 'mid'
        : 'eom';
      const recordDate = recordDateFor(ym, cycle, holidays);
      if (!recordDate) continue;
      const exDate = shiftBusinessDays(recordDate, config.exDivOffset, holidays);
      const payDate = shiftBusinessDays(recordDate, config.payOffset, holidays);

      let rebalDate: string;
      if (config.policy === 'fixedDay') {
        const raw = `${ym}-${pad2(clampInt(config.fixedDay, 1, 31))}`;
        const capped = isIsoDate(raw) ? raw : lastDayOfMonth(ym);
        rebalDate = onOrBeforeBusinessDay(capped, holidays);
      } else {
        rebalDate = shiftBusinessDays(exDate, config.rebalOffset, holidays);
      }

      const ov = ovMap.get(`${ym}|${group}`);
      const overridden = !!ov;
      if (ov) rebalDate = onOrBeforeBusinessDay(ov.date, holidays);

      if (rebalDate < config.startDate || rebalDate > config.endDate) continue;

      out.push({
        ym, group, recordDate, exDate, payDate, rebalDate, overridden,
        assetIds: assetsInGroup(config.assets, group),
      });
    }
  }
  out.sort((a, b) => (a.rebalDate < b.rebalDate ? -1 : a.rebalDate > b.rebalDate ? 1 : 0));
  return out;
}

/**
 * 분배 일정 슬롯 생성.
 * ⚠️ config.policy를 절대 보지 말 것 — 분배는 종목의 payCycle만 따른다.
 *    (리밸런싱을 월말에 몰아서 해도 월중 분배 종목은 여전히 15일 기준으로 분배받는다.)
 * ⚠️ 분배락일이 기간 안이면 슬롯을 만든다. 지급일이 기간 밖으로 나가는 경우는
 *    runBacktest가 '현금 미반영' 경고로 알린다(조용히 버리지 않는다).
 */
export function buildDividendSlots(config: BtConfig, holidays: Set<string>): BtDivSlot[] {
  const out: BtDivSlot[] = [];
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return out;
  const byCycle: Record<'mid' | 'eom', string[]> = {
    mid: config.assets.filter(a => a.payCycle === 'mid').map(a => a.id),
    eom: config.assets.filter(a => a.payCycle === 'eom').map(a => a.id),
  };
  for (const ym of monthsBetween(config.startDate, config.endDate)) {
    for (const cycle of ['mid', 'eom'] as const) {
      if (!byCycle[cycle].length) continue;
      const recordDate = recordDateFor(ym, cycle, holidays);
      if (!recordDate) continue;
      const exDate = shiftBusinessDays(recordDate, config.exDivOffset, holidays);
      const payDate = shiftBusinessDays(recordDate, config.payOffset, holidays);
      if (exDate < config.startDate || exDate > config.endDate) continue;
      out.push({ ym, cycle, recordDate, exDate, payDate, assetIds: byCycle[cycle] });
    }
  }
  out.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
  return out;
}

/**
 * 표시용 조인 — PDF처럼 "리밸런싱 행 오른쪽에 그 종목의 주당/지급 분배금"을 붙인다.
 * 같은 달, 같은 종목의 분배 중 **그 리밸런싱일 이후 첫 분배락**을 짝지운다
 * (리밸런싱은 분배락 직전에 하므로 정상 설정에서는 1:1로 붙는다).
 * 짝을 못 찾은 분배는 orphans로 반환해 표 하단에 따로 렌더한다(누락 은폐 방지).
 */
export function joinTradeDividends(
  trades: BtTrade[],
  dividends: BtDividendRow[],
): { rows: { trade: BtTrade; dividend: BtDividendRow | null }[]; orphans: BtDividendRow[] } {
  const used = new Set<BtDividendRow>();
  const rows = trades.map(trade => {
    let best: BtDividendRow | null = null;
    for (const d of dividends) {
      if (used.has(d)) continue;
      if (d.assetId !== trade.assetId) continue;
      if (d.exDate < trade.date) continue;
      if (!best || d.exDate < best.exDate) best = d;
    }
    if (best) used.add(best);
    return { trade, dividend: best };
  });
  return { rows, orphans: dividends.filter(d => !used.has(d)) };
}

/* ===========================================================================
 * J. 시뮬레이션
 * =========================================================================== */

interface Pos {
  asset: BtAsset;
  qty: number;
  active: boolean;
  targetAmount: number | null;
  targetRatio: number | null;
  /** 데이터 기준 실제 편입 가능일 */
  effectiveStart: string;
  effectiveEnd: string;
}

/** 그 시점 목표금액 산출. */
function targetOf(pos: Pos, config: BtConfig, base: number): number {
  if (config.targetMode === 'amount') {
    return Math.max(0, pos.targetAmount ?? 0);
  }
  const r = pos.targetRatio ?? 0;
  return Math.max(0, (base * r) / 100);
}

/**
 * 백테스트 실행.
 *
 * 하루 안의 처리 순서는 **분배락 스냅샷 → 분배금 입금 → 매매** 로 고정한다.
 *  - 분배락 스냅샷을 매매보다 먼저 처리해야 "분배락일 전일 종료 수량"이라는 권리 확정
 *    규약이 지켜진다(같은 날 매매가 권리 수량을 바꾸면 안 된다).
 *  - 입금을 매매보다 먼저 처리해야 그날 받은 분배금으로 매수할 수 있다
 *    (사용자 요구: "부족한 것은 보유한 현금으로 매수").
 */
export function runBacktest(input: BtRunInput): BtResult {
  const { config, prices, dividends } = input;
  const holidays = new Set(Array.isArray(input.holidays) ? input.holidays : []);
  const warnings: string[] = [];

  const empty = (fatal: string): BtResult => ({
    ok: false, fatal, warnings, slots: [], assetMeta: [],
    initialDate: '', initialTrades: [], initialCashAfter: 0, months: [], curve: [],
    finalHoldings: [],
    summary: {
      startDate: config.startDate, endDate: config.endDate,
      initialCapital: config.initialCapital,
      finalEval: 0, finalCash: 0, finalTotal: 0, profit: 0, profitRate: 0,
      cumTradeNet: 0, cumStructuralNet: 0, cumDivAccrued: 0, cumDivPaid: 0,
      maxDrawdown: 0, months: 0,
    },
  });

  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return empty('기간(시작일·종료일)을 선택해 주세요.');
  if (config.startDate > config.endDate) return empty('시작일이 종료일보다 늦습니다.');
  if (!config.assets.length) return empty('백테스트할 종목을 1개 이상 추가해 주세요.');
  if (config.initialCapital <= 0) return empty('초기 투자금을 입력해 주세요.');

  const startBiz = onOrAfterBusinessDay(config.startDate, holidays);
  const endBiz = onOrBeforeBusinessDay(config.endDate, holidays);
  if (startBiz > endBiz) return empty('선택한 기간에 영업일이 없습니다.');

  const allBiz = businessDaysBetween(startBiz, endBiz, holidays);
  if (!allBiz.length) return empty('선택한 기간에 영업일이 없습니다.');

  // ── 종목 메타 (상장일·결측 진단) ─────────────────────────────────────────
  const assetMeta: BtAssetMeta[] = [];
  const positions: Pos[] = [];
  for (const a of config.assets) {
    const series = prices[a.code];
    const { first, last } = seriesRange(series);
    let daysInRange = 0;
    let gapCount = 0;
    let inGap = false;
    for (const d of allBiz) {
      const v = series?.[d];
      const has = typeof v === 'number' && Number.isFinite(v) && v > 0;
      if (has) { daysInRange++; inGap = false; }
      else if (first && d >= first && d <= last) {
        if (!inGap) gapCount++;
        inGap = true;
      }
    }
    const userStart = a.startDate && a.startDate > startBiz ? a.startDate : '';
    const dataStart = first && first > startBiz ? first : '';
    const rawStart = userStart && dataStart ? (userStart > dataStart ? userStart : dataStart) : (userStart || dataStart || startBiz);
    const effectiveStart = onOrAfterBusinessDay(rawStart, holidays);
    const effectiveEnd = a.endDate && a.endDate < endBiz ? onOrBeforeBusinessDay(a.endDate, holidays) : endBiz;

    assetMeta.push({
      assetId: a.id, code: a.code, name: a.name,
      firstDate: first, lastDate: last,
      daysInRange, businessDaysInRange: allBiz.length,
      lateStart: !!first && first > startBiz,
      earlyEnd: !!last && last < endBiz,
      effectiveStart, gapCount,
    });

    if (!first) warnings.push(`${a.name || a.code}: 종가 데이터가 없어 백테스트에서 제외됩니다.`);
    else if (first > startBiz) warnings.push(`${a.name || a.code}: 종가 기록이 ${first}부터 있어 그날부터 편입됩니다.`);
    if (last && last < endBiz) warnings.push(`${a.name || a.code}: 종가 기록이 ${last}에서 끊겨 이후는 마지막 종가로 이월됩니다.`);
    if (gapCount > 0) warnings.push(`${a.name || a.code}: 기간 안에 종가 결측 구간이 ${gapCount}곳 있어 직전 종가로 이월됩니다.`);

    positions.push({
      asset: a, qty: 0, active: false,
      targetAmount: a.targetAmount, targetRatio: a.targetRatio,
      effectiveStart, effectiveEnd,
    });
  }

  const posById = new Map(positions.map(p => [p.asset.id, p]));
  const usable = positions.filter(p => !!prices[p.asset.code] && seriesRange(prices[p.asset.code]).count > 0);
  if (!usable.length) return empty('선택한 종목 중 종가 데이터가 있는 종목이 없습니다. 종목을 조회하거나 데이터를 붙여넣어 주세요.');

  let cash = config.initialCapital + config.extraCash;

  const evalOf = (p: Pos, date: string): { amount: number; hit: BtPriceHit } => {
    const hit = priceAt(prices[p.asset.code], date);
    return { amount: hit.missing ? 0 : p.qty * hit.price, hit };
  };

  const totalEvalAt = (date: string): number => {
    let s = 0;
    for (const p of positions) { if (p.qty > 0) s += evalOf(p, date).amount; }
    return s;
  };

  /** 비중 모드의 분모. */
  const ratioBaseAt = (date: string): number => {
    if (config.ratioBase === 'initial') return config.initialCapital + config.extraCash;
    const eq = totalEvalAt(date);
    return config.ratioBase === 'total' ? eq + cash : eq;
  };

  /**
   * 한 종목을 목표금액까지 맞추는 매매 1건.
   * ⚠️ 현금 한도 검사는 **반올림 후** 한다 — 먼저 자르면 수량이 목표를 넘겨 잡힌 뒤
   *    현금이 마이너스가 되거나, 반대로 1주 덜 사게 된다.
   */
  const adjustTo = (p: Pos, date: string, target: number, structural: boolean): BtTrade | null => {
    const hit = priceAt(prices[p.asset.code], date);
    if (hit.missing || hit.price <= 0) return null;
    const evalBefore = p.qty * hit.price;
    let qty = roundQty((target - evalBefore) / hit.price, config.rounding);
    let note = '';

    if (qty < 0 && -qty > p.qty) { qty = -p.qty; note = '보유수량 한도'; }
    if (qty > 0 && !config.allowNegativeCash) {
      const cost = qty * hit.price;
      if (cost > cash) {
        const afford = roundQty(cash / hit.price, config.rounding === 'exact' ? 'exact' : 'floor');
        if (afford < qty) { qty = Math.max(0, afford); note = '예수금 부족'; }
      }
    }
    if (qty === 0) return null;

    const cashDelta = -qty * hit.price;
    cash += cashDelta;
    const qtyBefore = p.qty;
    p.qty += qty;

    return {
      date, assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
      price: hit.price, priceExact: hit.exact,
      qtyBefore, evalBefore, target,
      qty, cashDelta,
      qtyAfter: p.qty, evalAfter: p.qty * hit.price,
      structural, note,
    };
  };

  // ── Phase 0: 초기 매수 ───────────────────────────────────────────────────
  const initialTrades: BtTrade[] = [];
  for (const p of positions) {
    if (p.effectiveStart > startBiz) continue;      // 중간 상장 종목은 나중에 편입
    if (p.effectiveEnd < startBiz) continue;
    p.active = true;
  }
  {
    // ⚠️ 초기 매수의 비중 분모는 ratioBase와 무관하게 **투입 자본**이다.
    //    ratioBase='equity'를 그대로 쓰면 그 시점 평가액이 0이라 목표가 전부 0이 되어
    //    아무것도 사지 않는다(비중 모드가 통째로 죽는 회귀).
    const base = config.initialCapital + config.extraCash;
    for (const p of positions) {
      if (!p.active) continue;
      const t = adjustTo(p, startBiz, targetOf(p, config, base), false);
      if (t) initialTrades.push(t);
    }
  }
  const initialCashAfter = cash;

  // ── 이벤트 / 슬롯 / 분배 타임라인 병합 ──────────────────────────────────
  // ⚠️ 리밸런싱 슬롯과 분배 슬롯은 **서로 독립**이다(buildDividendSlots 주석 참조).
  const slots = buildSlots(config, holidays);
  const divSlots = buildDividendSlots(config, holidays);

  type Step =
    | { date: string; kind: 'exdiv'; div: BtDivSlot }
    | { date: string; kind: 'pay'; div: BtDivSlot }
    | { date: string; kind: 'rebal'; slot: BtSlot }
    | { date: string; kind: 'event'; event: BtEvent };

  const steps: Step[] = [];
  for (const s of slots) steps.push({ date: s.rebalDate, kind: 'rebal', slot: s });
  for (const d of divSlots) {
    steps.push({ date: d.exDate, kind: 'exdiv', div: d });
    // 지급일이 종료일 이후면 pay 스텝을 만들지 않는다 → pendingDiv에 남아 경고로 보고된다.
    if (d.payDate >= startBiz && d.payDate <= endBiz) steps.push({ date: d.payDate, kind: 'pay', div: d });
  }
  for (const e of config.events) {
    if (!isIsoDate(e.date)) continue;
    const d = onOrBeforeBusinessDay(e.date, holidays);
    if (d < startBiz || d > endBiz) {
      warnings.push(`이벤트 "${e.label || e.date}"의 날짜가 백테스트 기간 밖이라 무시됩니다.`);
      continue;
    }
    steps.push({ date: d, kind: 'event', event: { ...e, date: d } });
  }

  const KIND_ORDER: Record<string, number> = { exdiv: 0, pay: 1, event: 2, rebal: 3 };
  steps.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );

  // 분배락 시점 권리 확정 수량 — exdiv 스텝에서 채우고 pay 스텝에서 현금화한다.
  const pendingDiv = new Map<string, BtDividendRow[]>();

  const monthMap = new Map<string, BtMonth>();
  const monthOf = (ym: string): BtMonth => {
    let m = monthMap.get(ym);
    if (!m) {
      m = {
        ym, trades: [], dividends: [],
        tradeNet: 0, structuralNet: 0, cumTradeNet: 0,
        divAccrued: 0, cumDivAccrued: 0, divPaid: 0, cumDivPaid: 0,
        cashDelta: 0, cashEnd: 0, evalEnd: 0, totalEnd: 0, evalBeforeSum: 0,
      };
      monthMap.set(ym, m);
    }
    return m;
  };
  for (const ym of monthsBetween(startBiz, endBiz)) monthOf(ym);

  const pushTrade = (t: BtTrade) => {
    const m = monthOf(ymOf(t.date));
    m.trades.push(t);
    if (t.structural) m.structuralNet += t.cashDelta;
    else m.tradeNet += t.cashDelta;
    m.evalBeforeSum += t.evalBefore;
  };

  for (const step of steps) {
    if (step.kind === 'exdiv') {
      const rows: BtDividendRow[] = [];
      for (const aid of step.div.assetIds) {
        const p = posById.get(aid);
        if (!p) continue;
        if (p.qty <= 0) continue;   // 분배락일 전일 종료 기준 권리 확정 수량

        // ⚠️ 저장 키는 앱 전체 규약과 같은 **배당락월**이다(지급월 아님).
        const ym = ymOf(step.div.exDate);
        const manual = p.asset.divOverride[ym];
        const hist = dividends[p.asset.code]?.[ym];
        const perShare =
          typeof manual === 'number' && Number.isFinite(manual) ? manual
          : typeof hist === 'number' && Number.isFinite(hist) ? hist
          : 0;
        const source: BtDividendRow['source'] =
          typeof manual === 'number' && Number.isFinite(manual) ? 'manual'
          : typeof hist === 'number' && Number.isFinite(hist) ? 'history'
          : 'none';

        rows.push({
          ym, recordDate: step.div.recordDate, exDate: step.div.exDate, payDate: step.div.payDate,
          assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
          perShare, qty: p.qty, amount: perShare * p.qty, source,
        });
      }
      if (!rows.length) continue;
      pendingDiv.set(`${step.div.ym}|${step.div.cycle}`, rows);
      // ⚠️ 표 표시는 **분배락 기준 월**에 적재한다(PDF의 '지급 분배금' 열이 리밸런싱 행 옆에
      //    붙는 형식). 현금 반영은 아래 'pay' 스텝에서 지급일 기준으로 따로 처리한다.
      const am = monthOf(ymOf(step.div.exDate));
      for (const r of rows) {
        am.dividends.push(r);
        am.divAccrued += r.amount;
        if (r.source === 'none' && r.qty > 0) {
          warnings.push(`${r.name || r.code} ${r.ym}: 주당 분배금 이력이 없어 0원으로 계산했습니다(표에서 직접 입력 가능).`);
        }
      }
      continue;
    }

    if (step.kind === 'pay') {
      const rows = pendingDiv.get(`${step.div.ym}|${step.div.cycle}`);
      if (!rows) continue;
      pendingDiv.delete(`${step.div.ym}|${step.div.cycle}`);
      // 현금은 **지급일**에만 늘어난다. 월말 분배는 지급일이 다음 달 초라 divAccrued와
      // 한 달 어긋나는 것이 정상이다(표는 분배락월, 현금은 지급월).
      const m = monthOf(ymOf(step.date));
      for (const r of rows) {
        m.divPaid += r.amount;
        cash += r.amount;
      }
      continue;
    }

    if (step.kind === 'event') {
      const e = step.event;
      // 1) 제외 종목 전량 매도 (구조 변경)
      for (const aid of e.removeAssets) {
        const p = posById.get(aid);
        if (!p || !p.active) continue;
        if (p.qty > 0) {
          const t = adjustTo(p, e.date, 0, true);
          if (t) pushTrade(t);
        }
        p.active = false;
      }
      // 2) 새 목표 반영
      for (const t of e.targets) {
        const p = posById.get(t.assetId);
        if (!p) continue;
        if (t.amount !== null) p.targetAmount = t.amount;
        if (t.ratio !== null) p.targetRatio = t.ratio;
      }
      // 3) 편입
      for (const aid of e.addAssets) {
        const p = posById.get(aid);
        if (!p) continue;
        if (e.date < p.effectiveStart) {
          warnings.push(`${p.asset.name || p.asset.code}: ${e.date}에는 종가 기록이 없어 ${p.effectiveStart}부터 편입됩니다.`);
          continue;
        }
        p.active = true;
      }
      // 4) 재원 조달
      if (e.funding === 'reallocate') {
        const base = ratioBaseAt(e.date);
        // ⚠️ 매도를 먼저 전부 처리한 뒤 매수 — 순서가 섞이면 재원이 마련되기 전에 매수가
        //    예수금 한도에 걸려 조용히 목표 미달로 끝난다(PDF 4/21이 정확히 이 형태다).
        const acts = positions.filter(p => p.active);
        const plans = acts.map(p => {
          const hit = priceAt(prices[p.asset.code], e.date);
          const target = targetOf(p, config, base);
          return { p, target, delta: hit.missing ? 0 : target - p.qty * hit.price };
        });
        for (const pl of plans.filter(x => x.delta < 0)) {
          const t = adjustTo(pl.p, e.date, pl.target, true);
          if (t) pushTrade(t);
        }
        for (const pl of plans.filter(x => x.delta > 0)) {
          const t = adjustTo(pl.p, e.date, pl.target, true);
          if (t) pushTrade(t);
        }
      } else if (e.funding === 'cash') {
        const base = ratioBaseAt(e.date);
        for (const aid of e.addAssets) {
          const p = posById.get(aid);
          if (!p || !p.active) continue;
          const t = adjustTo(p, e.date, targetOf(p, config, base), true);
          if (t) pushTrade(t);
        }
      }
      continue;
    }

    // kind === 'rebal'
    {
      const s = step.slot;
      const base = ratioBaseAt(s.rebalDate);
      const eligible: Pos[] = [];
      for (const aid of s.assetIds) {
        const p = posById.get(aid);
        if (!p) continue;
        if (s.rebalDate < p.effectiveStart || s.rebalDate > p.effectiveEnd) continue;
        // 데이터가 생긴 시점부터 자동 편입 — 중간 상장 종목이 첫 리밸런싱에서 들어온다.
        if (!p.active) p.active = true;
        eligible.push(p);
      }
      // ⚠️ 매도/매수 분할은 **실행 전에** 확정해야 한다. 실행 중 다시 판정하면 방금 매도해
      //    목표에 맞춰진 종목이 매수 패스에 또 걸리고(중복 처리), 반대로 매수 재원이 마련되기
      //    전에 매수가 예수금 한도에 막혀 조용히 목표 미달로 끝난다.
      const plans = eligible.map(p => {
        const hit = priceAt(prices[p.asset.code], s.rebalDate);
        const target = targetOf(p, config, base);
        return { p, target, delta: hit.missing ? 0 : target - p.qty * hit.price };
      });
      for (const pl of plans.filter(x => x.delta < 0)) {
        const t = adjustTo(pl.p, s.rebalDate, pl.target, false);
        if (t) pushTrade(t);
      }
      for (const pl of plans.filter(x => x.delta > 0)) {
        const t = adjustTo(pl.p, s.rebalDate, pl.target, false);
        if (t) pushTrade(t);
      }
    }
  }

  // 기간 끝까지 지급되지 못한 분배금(지급일이 종료일 이후)은 안내만 남긴다.
  for (const rows of pendingDiv.values()) {
    for (const r of rows) {
      if (r.amount > 0) {
        warnings.push(`${r.name || r.code} ${r.ym}: 지급일(${r.payDate})이 종료일 이후라 현금에 반영되지 않았습니다.`);
      }
    }
  }

  // ── 월별 마감 ────────────────────────────────────────────────────────────
  const months = monthsBetween(startBiz, endBiz).map(ym => monthOf(ym));
  let cumTrade = 0;
  let cumDivAccrued = 0;
  let cumDivPaid = 0;
  let cumStructural = 0;
  let runCash = config.initialCapital + config.extraCash;
  // 초기 매수 반영
  for (const t of initialTrades) runCash += t.cashDelta;

  for (const m of months) {
    m.trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    m.dividends.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
    cumTrade += m.tradeNet;
    cumStructural += m.structuralNet;
    cumDivAccrued += m.divAccrued;
    cumDivPaid += m.divPaid;
    m.cumTradeNet = cumTrade;
    m.cumDivAccrued = cumDivAccrued;
    m.cumDivPaid = cumDivPaid;
    m.cashDelta = m.tradeNet + m.structuralNet + m.divPaid;
    runCash += m.cashDelta;
    m.cashEnd = runCash;
    const lastBiz = onOrBeforeBusinessDay(
      lastDayOfMonth(m.ym) > endBiz ? endBiz : lastDayOfMonth(m.ym),
      holidays,
    );
    // 월말 시점 보유수량은 시뮬레이션 종료 상태가 아니라 **그 달까지의 매매 누적**이어야 한다.
    const qtyAt = new Map<string, number>();
    for (const p of positions) qtyAt.set(p.asset.id, 0);
    for (const t of initialTrades) qtyAt.set(t.assetId, (qtyAt.get(t.assetId) ?? 0) + t.qty);
    for (const mm of months) {
      if (mm.ym > m.ym) break;
      for (const t of mm.trades) qtyAt.set(t.assetId, (qtyAt.get(t.assetId) ?? 0) + t.qty);
    }
    let ev = 0;
    for (const p of positions) {
      const q = qtyAt.get(p.asset.id) ?? 0;
      if (q <= 0) continue;
      const hit = priceAt(prices[p.asset.code], lastBiz);
      if (!hit.missing) ev += q * hit.price;
    }
    m.evalEnd = ev;
    m.totalEnd = ev + runCash;
  }

  // ── 자산 추이 곡선 ──────────────────────────────────────────────────────
  const curve: BtResult['curve'] = [];
  {
    const qty = new Map<string, number>();
    for (const p of positions) qty.set(p.asset.id, 0);
    const tradesByDate = new Map<string, BtTrade[]>();
    const divByDate = new Map<string, number>();
    const push = (map: Map<string, BtTrade[]>, d: string, t: BtTrade) => {
      const arr = map.get(d);
      if (arr) arr.push(t); else map.set(d, [t]);
    };
    for (const t of initialTrades) push(tradesByDate, t.date, t);
    for (const m of months) {
      for (const t of m.trades) push(tradesByDate, t.date, t);
      for (const d of m.dividends) divByDate.set(d.payDate, (divByDate.get(d.payDate) ?? 0) + d.amount);
    }
    let c = config.initialCapital + config.extraCash;
    for (const d of allBiz) {
      for (const t of tradesByDate.get(d) ?? []) {
        qty.set(t.assetId, (qty.get(t.assetId) ?? 0) + t.qty);
        c += t.cashDelta;
      }
      c += divByDate.get(d) ?? 0;
      let ev = 0;
      for (const p of positions) {
        const q = qty.get(p.asset.id) ?? 0;
        if (q <= 0) continue;
        const hit = priceAt(prices[p.asset.code], d);
        if (!hit.missing) ev += q * hit.price;
      }
      curve.push({ date: d, evalAmount: ev, cash: c, total: ev + c });
    }
  }

  // ── 최종 보유 ────────────────────────────────────────────────────────────
  const finalEval = totalEvalAt(endBiz);
  const finalHoldings: BtHolding[] = positions
    .filter(p => p.qty > 0)
    .map(p => {
      const hit = priceAt(prices[p.asset.code], endBiz);
      const amount = hit.missing ? 0 : p.qty * hit.price;
      return {
        assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
        qty: p.qty, price: hit.price, priceExact: hit.exact,
        evalAmount: amount,
        weight: finalEval > 0 ? (amount / finalEval) * 100 : 0,
      };
    });

  let peak = 0;
  let maxDd = 0;
  for (const c of curve) {
    if (c.total > peak) peak = c.total;
    if (peak > 0) {
      const dd = ((peak - c.total) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }

  const invested = config.initialCapital + config.extraCash;
  const finalTotal = finalEval + cash;

  return {
    ok: true,
    fatal: '',
    warnings: Array.from(new Set(warnings)),
    slots,
    assetMeta,
    initialDate: startBiz,
    initialTrades,
    initialCashAfter,
    months,
    curve,
    finalHoldings,
    summary: {
      startDate: startBiz, endDate: endBiz,
      initialCapital: config.initialCapital,
      finalEval, finalCash: cash, finalTotal,
      profit: finalTotal - invested,
      profitRate: invested > 0 ? ((finalTotal - invested) / invested) * 100 : 0,
      cumTradeNet: cumTrade,
      cumStructuralNet: cumStructural,
      cumDivAccrued,
      cumDivPaid,
      maxDrawdown: maxDd,
      months: months.length,
    },
  };
}

/* ===========================================================================
 * K. 계좌 데이터에서 백테스트 입력 만들기 (App → BacktestPage)
 * =========================================================================== */

export interface BtCatalogEntry {
  code: string;
  name: string;
  firstDate: string;
  lastDate: string;
  count: number;
  /** 이 코드의 분배금 이력이 앱에 있는가 */
  hasDividend: boolean;
}

/**
 * 앱이 저장 중인 종가 맵 + 계좌들의 분배금 이력에서 종목 카탈로그를 만든다.
 * ⚠️ 여기서 만든 값은 **표시/선택용**이다 — 시세를 stockHistoryMap에 되돌려 쓰지 말 것.
 */
export function buildBtCatalog(
  stockHistoryMap: Record<string, Record<string, number>>,
  nameByCode: Record<string, string>,
  dividends: BtDividendMap,
): BtCatalogEntry[] {
  const out: BtCatalogEntry[] = [];
  const codes = new Set<string>([
    ...Object.keys(stockHistoryMap || {}),
    ...Object.keys(dividends || {}),
  ]);
  for (const code of codes) {
    const { first, last, count } = seriesRange(stockHistoryMap?.[code]);
    out.push({
      code,
      name: nameByCode[code] || code,
      firstDate: first, lastDate: last, count,
      hasDividend: !!dividends?.[code] && Object.keys(dividends[code]).length > 0,
    });
  }
  out.sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code, 'ko'));
  return out;
}

/**
 * 전 계좌의 dividendHistory를 코드별로 합친다.
 * ⚠️ 같은 코드가 여러 계좌에 있으면 **주당 분배금은 계좌와 무관하게 같아야** 하므로
 *    마지막 값이 아니라 **0이 아닌 첫 값**을 채택한다(빈 계좌가 실값을 덮지 않게).
 */
export function collectDividendHistory(portfolios: any[]): BtDividendMap {
  const out: BtDividendMap = {};
  for (const p of Array.isArray(portfolios) ? portfolios : []) {
    const dh = p?.dividendHistory;
    if (!dh || typeof dh !== 'object') continue;
    for (const code of Object.keys(dh)) {
      const byYm = dh[code];
      if (!byYm || typeof byYm !== 'object') continue;
      if (!out[code]) out[code] = {};
      for (const ym of Object.keys(byYm)) {
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;
        const v = byYm[ym];
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
        if (out[code][ym] === undefined) out[code][ym] = v;
      }
    }
  }
  return out;
}

/** 전 계좌에서 코드→종목명 맵을 만든다(최근 이름 우선). */
export function collectNameByCode(portfolios: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of Array.isArray(portfolios) ? portfolios : []) {
    for (const it of Array.isArray(p?.portfolio) ? p.portfolio : []) {
      if (it?.code && it?.name && !out[it.code]) out[it.code] = it.name;
    }
    for (const s of Array.isArray(p?.holdingSnapshots) ? p.holdingSnapshots : []) {
      for (const it of Array.isArray(s?.items) ? s.items : []) {
        if (it?.code && it?.name && !out[it.code]) out[it.code] = it.name;
      }
    }
  }
  return out;
}

/**
 * 'YYYY-MM-DD,종가' 줄 목록(CSV/TSV/공백 구분)을 시계열로 파싱.
 * 앱·API 어디에도 없는 종목(신규 상장 등)을 수동 주입할 때 사용.
 */
export function parsePastedSeries(text: string): { data: Record<string, number>; ok: number; bad: number } {
  const data: Record<string, number> = {};
  let ok = 0;
  let bad = 0;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/[,\t;]+|\s{1,}/).filter(Boolean);
    if (parts.length < 2) { bad++; continue; }
    let d = parts[0].trim();
    if (/^\d{8}$/.test(d)) d = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    d = d.replace(/[./]/g, '-');
    const v = Number(parts[1].replace(/[^0-9.\-]/g, ''));
    if (!isIsoDate(d) || !Number.isFinite(v) || v <= 0) { bad++; continue; }
    data[d] = v;
    ok++;
  }
  return { data, ok, bad };
}
