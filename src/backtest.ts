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
 *  none     — **리밸런싱하지 않음**. 초기 매수 후 수량을 그대로 둔다(Buy & Hold 기준선).
 *             종목별 rebalMode가 'follow'가 아닌 종목은 그 지정을 그대로 따른다.
 */
export type BtPolicy = 'perCycle' | 'allMid' | 'allEom' | 'fixedDay' | 'none';

/**
 * 목표 해석.
 *  amount — 종목별로 사용자가 적어 넣은 **목표 금액**에 맞춘다.
 *  ratio  — 사용자가 정한 **비중(%) × 종목 평가액 합계**에 맞춘다.
 *
 * ⚠️ 비중의 분모는 **종목 평가액 합계 하나로 고정**이다(사용자 정의 2026-08).
 *    예수금·매매차익·누적분배금은 절대 분모에 넣지 않는다 — 비중은 "들고 있는 종목들
 *    사이의 배분"이라 현금이 섞이면 A 50% / B 50% 라는 사용자의 지시와 뜻이 달라진다.
 *    과거엔 분모를 4종(equity/total/initial/totalWithDiv) 중에 고르게 했으나 제거됐다.
 *    되살리지 말 것.
 */
export type BtTargetMode = 'amount' | 'ratio';

/** 수량 산출 규칙. floor=0 방향 버림(PDF 규약) / round=반올림 / exact=소수 허용(펀드 좌수) */
export type BtRounding = 'floor' | 'round' | 'exact';

/**
 * 지급받은 분배금을 어떻게 처리할 것인가.
 *  hold    — 예수금에 그대로 쌓아 둔다(기본, 종전 동작). 리밸런싱이 매수 재원으로 쓸 때만 줄어든다.
 *  payDate — **지급일 당일**에 즉시 재매수한다.
 *  mid     — 매월 **월중** 분배락 직전 영업일에 모아서 재매수한다.
 *  eom     — 매월 **월말** 분배락 직전 영업일에 모아서 재매수한다.
 *
 * ⚠️ mid/eom의 날짜 규칙은 리밸런싱과 **같다**(기준일 + exDivOffset + rebalOffset = 분배락 직전
 *    영업일). 그날 사면 그 달 분배 권리까지 확보되므로 '분배금으로 다시 분배를 받는' 복리가
 *    자연스럽게 잡힌다 — 기준일 당일(15일/말일)에 사면 분배락이 이미 지나 그 달 권리를 놓친다.
 * ⚠️ 리밸런싱 정책과 **완전히 독립**이다. 리밸런싱을 끈(policy:'none') 상태에서도 재투자는 돈다.
 */
export type BtDivReinvest = 'hold' | 'payDate' | 'mid' | 'eom';

/**
 * 분배금 재투자 매수의 종목별 배분 기준.
 *  target — 목표 비중대로(목표금액 모드에서는 종목별 목표금액 비율대로). 기본값.
 *  source — 그 분배금을 **준 종목**을 그대로 되산다(전통적 DRIP).
 *  even   — 그 시점 매수 가능한 종목에 균등 배분.
 */
export type BtDivSplit = 'target' | 'source' | 'even';

/** 중도 이벤트의 재원 조달 방식. */
export type BtFunding =
  /** 활성 전 종목을 그 자리에서 새 목표로 맞춘다(기존 종목 매도 → 신규 매수). PDF 4/21 방식. */
  | 'reallocate'
  /** 신규 편입 종목만 보유 현금으로 매수. 기존 종목은 건드리지 않는다. */
  | 'cash'
  /** 목표만 바꾸고 매매는 다음 정기 리밸런싱까지 대기. */
  | 'defer';

/**
 * 종목별 리밸런싱 일정.
 *  follow — 전역 정책(config.policy)을 따른다(기본).
 *  mid/eom — 그 종목만 월중/월말 분배락 전에.
 *  day   — 그 종목만 매월 지정일(asset.rebalDay).
 *  dates — 그 종목만 지정한 날짜 목록(asset.rebalDates)에만. 분배가 불규칙한 종목용.
 *  none  — 리밸런싱하지 않음(최초 매수 후 방치).
 * ⚠️ follow가 아닌 종목은 **전역 월별 오버라이드에 끌려가지 않는다** — "일괄지정과 별개로
 *    종목을 지정해 다르게 리밸런싱"이라는 요구가 이 분리에서 나온다. 그 종목을 특정 월만
 *    옮기려면 assetId를 지정한 개별 오버라이드를 쓴다.
 */
export type BtAssetRebal = 'follow' | 'mid' | 'eom' | 'day' | 'dates' | 'none';

export interface BtAsset {
  id: string;
  /** 종목코드(국내 6자 영숫자 등). 시세·분배금 조회의 유일한 키. */
  code: string;
  name: string;
  payCycle: BtPayCycle;
  /** 리밸런싱 일정(기본 'follow' = 전역 정책). */
  rebalMode: BtAssetRebal;
  /** rebalMode==='day'일 때 매월 며칠(1~31, 휴장이면 직전 영업일). */
  rebalDay: number;
  /** rebalMode==='dates'일 때 리밸런싱할 날짜 목록('YYYY-MM-DD', 휴장이면 직전 영업일). */
  rebalDates: string[];
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
  /**
   * 비우면 그 그룹 전체(기존 동작), 값이 있으면 **그 종목만** 이 날짜로 옮긴다.
   * ⚠️ 종목 지정 오버라이드는 rebalMode가 'follow'가 아닌 종목에도 적용된다(그 종목의
   *    그 달 일정 전체를 이 날짜 하나로 대체).
   */
  assetId: string;
}

/**
 * 매월 목표 증액(재투자) 규칙.
 * 리밸런싱 매도 차익·분배금으로 쌓인 **예수금을 다시 투자에 투입**하기 위해, 그 달 첫
 * 리밸런싱 직전에 종목별 목표금액을 올린다.
 * ⚠️ 증액 자체는 현금을 움직이지 않는다 — 목표가 올라가면 그 직후 리밸런싱이 실제로 매수한다.
 *    그래서 증액액은 **보유 예수금을 넘지 않게 잘린다**(넘기면 곧바로 '예수금 부족'이 된다).
 */
export interface BtContribution {
  /** none=증액 없음 / pctOfCash=보유 예수금의 N% / amount=고정 금액 */
  mode: 'none' | 'pctOfCash' | 'amount';
  value: number;
  /** ratio=현재 목표 비율대로 배분 / even=활성 종목에 균등 배분 */
  split: 'ratio' | 'even';
}

/** 특정 월만 다른 증액 규칙(월별 미세조정). */
export interface BtContribOverride {
  id: string;
  ym: string;
  mode: 'none' | 'pctOfCash' | 'amount';
  value: number;
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
  /** 지급받은 분배금의 처리 방식. 기본 'hold'(예수금 보유 — 종전 동작). */
  divReinvest: BtDivReinvest;
  /** 분배금 재투자 매수의 종목별 배분 기준. 기본 'target'(목표 비중대로). */
  divReinvestSplit: BtDivSplit;
  /**
   * '전체 백테스트 비교 종합' 화면에 이 시나리오를 포함할지.
   * ⚠️ 결과에 영향을 주지 않는 **표시 전용** 필드지만, 사용자가 고른 조합이 유지돼야 하므로
   *    지문(backtestFingerprint)에 포함해 Drive에 저장한다. 기본값은 true(신규·레거시 모두 포함).
   */
  compareOn: boolean;
  /** 매월 목표 증액(재투자) 기본 규칙. */
  contribution: BtContribution;
  /** 특정 월만 다른 증액 규칙. */
  contribOverrides: BtContribOverride[];
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
export const MAX_BT_CONTRIB_OVERRIDES = 120;
/** rebalMode==='dates'일 때 종목당 지정 가능한 날짜 수 */
export const MAX_BT_REBAL_DATES = 120;

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
  /**
   * 분배금 재투자 매수인가.
   * ⚠️ structural과 마찬가지로 **리밸런싱 차익(tradeNet)에서 제외**한다 — 재투자는 목표를 맞추는
   *    매매가 아니라 '받은 현금을 다시 넣는' 행위라, 여기에 섞으면 '누적 매매차익'이 재투자 대금만큼
   *    마이너스로 부풀어 지표의 의미가 사라진다. 대신 reinvestNet으로 따로 센다.
   * ⚠️ reinvest와 structural은 상호배타다(재투자 매수는 절대 structural로 찍지 않는다).
   */
  reinvest: boolean;
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

/**
 * 분배금 재투자 실행일 슬롯.
 * ⚠️ 리밸런싱 슬롯(buildSlots)·분배 슬롯(buildDividendSlots)과 **완전히 독립**이다.
 *    리밸런싱을 끄든 옮기든 재투자 일정은 config.divReinvest만 따른다.
 */
export interface BtReinvestSlot {
  ym: string;
  /** 실제 매수 실행일 */
  date: string;
  /** 이 날짜를 만들어 낸 규칙(표시용) */
  label: 'pay' | 'mid' | 'eom';
}

/** 그 달 실제로 실행된 목표 증액(재투자) 1건. */
export interface BtContribRow {
  ym: string;
  /** 증액을 적용한 날(그 달 첫 리밸런싱일) */
  date: string;
  /** 적용 직전 예수금 */
  cashBefore: number;
  /** 규칙상 증액하려던 금액 */
  requested: number;
  /** 실제 증액한 금액(예수금 한도로 잘릴 수 있음) */
  amount: number;
  mode: 'pctOfCash' | 'amount';
  value: number;
  /** 그 달 전용 규칙이 적용됐는가 */
  overridden: boolean;
  perAsset: { assetId: string; code: string; name: string; added: number; targetAfter: number }[];
  note: string;
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
  /** 그 달 정기 리밸런싱 매매금액 합 (structural·reinvest 제외) — PDF '합계' 열 */
  tradeNet: number;
  /** 구조 변경 매매금액 합 (참고 표시용, 차익에 미포함) */
  structuralNet: number;
  /**
   * 그 달 분배금 재투자 매수 대금 합(항상 ≤ 0). 차익에 미포함.
   * ⚠️ 이 값의 절댓값이 곧 '그 달 분배금으로 실제 다시 산 금액'이다.
   */
  reinvestNet: number;
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
  /** 그 달까지 누적 재투자 매수 대금(≤ 0) */
  cumReinvestNet: number;
  /** 그 달 현금 증감 (정기차익 + 구조매매 + 분배금 재투자 + 입금 분배금) */
  cashDelta: number;
  /** 월말 시점 예수금 */
  cashEnd: number;
  /** 월말 예수금 중 매매(리밸런싱 차익) 몫. cashTradeEnd + cashDivEnd = cashEnd */
  cashTradeEnd: number;
  /** 월말 예수금 중 아직 쓰지 않은 누적 분배금 몫 */
  cashDivEnd: number;
  /**
   * 그 달 **매수 대금**을 어느 주머니에서 꺼냈는지 (합 = 그 달 총 매수 대금, 매도는 제외).
   * ⚠️ 누적 매매차익이 마이너스인 달에 "이 매수를 무엇으로 충당했는가"를 답하는 값이다.
   */
  cashUsedTrade: number;
  cashUsedDiv: number;
  /** 월말 시점 종목 평가액 합 */
  evalEnd: number;
  /** evalEnd + cashEnd */
  totalEnd: number;
  /** 리밸런싱 직전 평가액 합계 (PDF '리밸런싱 전 평가액' 합계 행) */
  evalBeforeSum: number;
  /** evalEnd 산출에 쓴 그 달의 마지막 영업일(기간 끝을 넘지 않음) */
  lastDate: string;
  /**
   * 월말 시점 **종목별** 보유 수량·평가금액.
   * ⚠️ trades와 달리 **그 달에 매매가 없던 종목도 포함**한다 — 리밸런싱 표에는 그 달 거래된
   *    종목만 행이 생기므로, 이것이 없으면 "이번 달에 안 건드린 종목은 몇 주 남았는지" 알 길이 없다.
   *    weight 분모는 evalEnd(종목만, 예수금 제외) — 기말 보유 현황 표와 같은 정의.
   */
  holdings: BtHolding[];
  /** 그 달 실행된 목표 증액(없으면 null) */
  contribution: BtContribRow | null;
  /** 그 달까지 누적 증액 총액 */
  cumContribution: number;
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
    /**
     * 누적 분배금 재투자 매수 대금(≤ 0). 절댓값 = 분배금으로 다시 산 총액.
     * ⚠️ 기말 예수금 분해 항등식의 한 항이다(아래 finalCashTrade 주석 참조).
     */
    cumReinvestNet: number;
    /** 분배락 기준 누적 분배금 — PDF의 '누적 분배금 합계'와 같은 정의 */
    cumDivAccrued: number;
    /** 실제 입금된 누적 분배금(지급일 기준). 기말 예수금에 반영된 값. */
    cumDivPaid: number;
    /** 매월 증액(재투자)으로 목표에 더한 누적 금액 */
    cumContribution: number;
    /**
     * 기말 예수금 중 매매 몫 / 미사용 분배금 몫 (합 = finalCash).
     * ⚠️ 원천별 분해 항등식(화면 '기말 보유 현황' 표가 그대로 렌더한다):
     *      finalCash = initialCashAfter + cumTradeNet + cumStructuralNet + cumReinvestNet + cumDivPaid
     *    분배금은 반드시 **지급 기준(cumDivPaid)** — 분배락 기준(cumDivAccrued)에는 아직 현금이
     *    되지 않은 몫이 섞여 항등식이 깨진다.
     */
    finalCashTrade: number;
    finalCashDiv: number;
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

/**
 * '보유 없음'으로 볼 수량 임계값.
 * ⚠️ `rounding:'exact'`(소수 좌수)에서 전량 매도 수량은 `(0 − qty×price) / price`로 구해지는데
 *    IEEE754에서 이 값이 원 수량보다 미세하게 작게 나오는 조합이 있다. 그러면 보유수량 한도
 *    가드가 발동하지 않아 1e-13 규모 잔여가 남고, 러닝 누적 맵에 실려 **이후 모든 달**의 월말
 *    보유에 `0주 · ₩0 (100.0%)` 유령 행으로 나타난다. 근원(adjustTo)에서 전량으로 스냅한다.
 */
export const QTY_EPS = 1e-9;

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

const REBAL_MODES: BtAssetRebal[] = ['follow', 'mid', 'eom', 'day', 'dates', 'none'];

export function makeBtAsset(partial: Partial<BtAsset> = {}, idx = 0): BtAsset {
  const cycle = partial.payCycle;
  const rm = partial.rebalMode;
  return {
    id: partial.id || generateId(),
    code: asStr(partial.code).trim().toUpperCase(),
    name: asStr(partial.name),
    payCycle: cycle === 'mid' || cycle === 'eom' || cycle === 'none' ? cycle : 'eom',
    rebalMode: REBAL_MODES.includes(rm as BtAssetRebal) ? (rm as BtAssetRebal) : 'follow',
    rebalDay: clampInt(asNum(partial.rebalDay, 15), 1, 31),
    rebalDates: Array.from(new Set(asArr(partial.rebalDates).filter(isIsoDate))).sort().slice(0, MAX_BT_REBAL_DATES),
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
  const rounding = partial.rounding;
  const reinv = partial.divReinvest;
  const divSplit = partial.divReinvestSplit;
  return {
    id: partial.id || generateId(),
    name: asStr(partial.name) || '백테스트',
    startDate: isIsoDate(partial.startDate) ? partial.startDate : '',
    endDate: isIsoDate(partial.endDate) ? partial.endDate : '',
    initialCapital: Math.max(0, asNum(partial.initialCapital, 0)),
    extraCash: Math.max(0, asNum(partial.extraCash, 0)),
    targetMode: mode === 'ratio' ? 'ratio' : 'amount',
    rounding: rounding === 'round' || rounding === 'exact' ? rounding : 'floor',
    policy:
      policy === 'allMid' || policy === 'allEom' || policy === 'fixedDay' || policy === 'none'
        ? policy : 'perCycle',
    fixedDay: clampInt(asNum(partial.fixedDay, 15), 1, 31),
    exDivOffset: clampInt(asNum(partial.exDivOffset, -1), -10, 0),
    rebalOffset: clampInt(asNum(partial.rebalOffset, -1), -10, 0),
    payOffset: clampInt(asNum(partial.payOffset, 2), 0, 10),
    allowNegativeCash: !!partial.allowNegativeCash,
    // ⚠️ 레거시(필드 부재)는 반드시 'hold' / 'target'으로 떨어져야 한다 — 기존 시나리오의
    //    결과가 이 기능 도입만으로 1원도 달라지면 안 된다.
    divReinvest:
      reinv === 'payDate' || reinv === 'mid' || reinv === 'eom' ? reinv : 'hold',
    divReinvestSplit: divSplit === 'source' || divSplit === 'even' ? divSplit : 'target',
    // ⚠️ `!!partial.compareOn`으로 두지 말 것 — 필드가 없는 기존 시나리오가 전부 비교에서
    //    빠져 '전체 비교'가 빈 화면이 된다. 명시적 false만 제외한다.
    compareOn: partial.compareOn !== false,
    contribution: normalizeContribution(partial.contribution),
    contribOverrides: asArr(partial.contribOverrides).slice(0, MAX_BT_CONTRIB_OVERRIDES)
      .map(normalizeContribOverride).filter(Boolean) as BtContribOverride[],
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
    assetId: asStr(raw?.assetId),
  };
}

const CONTRIB_MODES = ['none', 'pctOfCash', 'amount'];

function normalizeContribution(raw: any): BtContribution {
  const m = raw?.mode;
  const s = raw?.split;
  return {
    mode: CONTRIB_MODES.includes(m) ? m : 'none',
    value: Math.max(0, asNum(raw?.value, 0)),
    split: s === 'even' ? 'even' : 'ratio',
  };
}

function normalizeContribOverride(raw: any): BtContribOverride | null {
  const ym = asStr(raw?.ym);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const m = raw?.mode;
  return {
    id: asStr(raw?.id) || generateId(),
    ym,
    mode: CONTRIB_MODES.includes(m) ? m : 'none',
    value: Math.max(0, asNum(raw?.value, 0)),
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
          s?.targetMode ?? '', s?.rounding ?? '', s?.policy ?? '',
          s?.fixedDay ?? 0, s?.exDivOffset ?? 0, s?.rebalOffset ?? 0, s?.payOffset ?? 0,
          s?.allowNegativeCash ? 1 : 0,
          // 분배금 처리 — 결과를 통째로 바꾸는 사용자 설정
          s?.divReinvest ?? '', s?.divReinvestSplit ?? '',
          // 비교 종합 포함 여부 — 결과에는 영향이 없지만 사용자가 고른 조합이라 저장한다
          s?.compareOn === false ? 0 : 1,
          // 매월 증액 규칙 — 결과를 통째로 바꾸는 사용자 설정이라 반드시 지문에 포함
          s?.contribution?.mode ?? '', s?.contribution?.value ?? 0, s?.contribution?.split ?? '',
        ],
        c: asArr(s?.contribOverrides).map((o: any) => [o?.id ?? '', o?.ym ?? '', o?.mode ?? '', o?.value ?? 0]),
        a: asArr(s?.assets).map((a: any) => [
          a?.id ?? '', a?.code ?? '', a?.name ?? '', a?.payCycle ?? '',
          a?.targetAmount ?? null, a?.targetRatio ?? null,
          a?.startDate ?? '', a?.endDate ?? '', a?.color ?? '',
          // 종목별 리밸런싱 일정 — 지정 날짜 목록까지 포함해야 단독 편집이 저장된다
          a?.rebalMode ?? '', a?.rebalDay ?? 0, asArr(a?.rebalDates).join(','),
          // ⚠️ 주당 분배금 수동 입력은 결과를 바꾸는 사용자 데이터다 — 키 정렬로 안정화해 포함.
          Object.keys(a?.divOverride ?? {}).sort().map(k => `${k}:${a.divOverride[k]}`).join(','),
        ]),
        e: asArr(s?.events).map((e: any) => [
          e?.id ?? '', e?.date ?? '', e?.label ?? '', e?.funding ?? '',
          asArr(e?.addAssets).join(','), asArr(e?.removeAssets).join(','),
          asArr(e?.targets).map((t: any) => `${t?.assetId ?? ''}:${t?.amount ?? ''}:${t?.ratio ?? ''}`).join('|'),
        ]),
        o: asArr(s?.overrides).map((o: any) => [o?.id ?? '', o?.ym ?? '', o?.group ?? '', o?.date ?? '', o?.assetId ?? '']),
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

/**
 * 그 종목이 실제로 따를 리밸런싱 방식.
 * rebalMode가 'follow'면 전역 정책을 그 종목에 투영한다 — perCycle에서 **분배 없는 종목**
 * ('none')이 월말 그룹에 붙는 배정까지 종전과 동일하다.
 */
export function resolveAssetRebal(
  asset: BtAsset,
  config: BtConfig,
): { mode: 'mid' | 'eom' | 'day' | 'dates' | 'none'; day: number; follows: boolean } {
  const rm = asset.rebalMode || 'follow';
  if (rm !== 'follow') {
    return { mode: rm, day: clampInt(asNum(asset.rebalDay, 15), 1, 31), follows: false };
  }
  switch (config.policy) {
    case 'allMid': return { mode: 'mid', day: 0, follows: true };
    case 'allEom': return { mode: 'eom', day: 0, follows: true };
    case 'fixedDay': return { mode: 'day', day: clampInt(config.fixedDay, 1, 31), follows: true };
    // ⚠️ 전역 '리밸런싱 안 함' — follows는 true 그대로 둔다. 슬롯을 만들지 않으므로 그룹·
    //    월별 일괄 오버라이드 경로에는 어차피 닿지 않고, false로 두면 '종목이 개별 지정을
    //    했다'는 뜻이 되어 buildSlots의 개별/일괄 구분 의미가 흐려진다.
    case 'none': return { mode: 'none', day: 0, follows: true };
    default: return { mode: asset.payCycle === 'mid' ? 'mid' : 'eom', day: 0, follows: true };
  }
}

/** 전역 정책에서 그 종목이 속하는 그룹 = 월별 **일괄** 오버라이드의 대상 단위. */
function groupOfFollow(config: BtConfig, asset: BtAsset): BtGroup {
  if (config.policy !== 'perCycle') return 'all';
  return asset.payCycle === 'mid' ? 'mid' : 'eom';
}

/**
 * 리밸런싱 슬롯 생성 — **종목별로 날짜를 먼저 구한 뒤 (날짜, 그룹)으로 묶는다.**
 *
 * ⚠️ 오버라이드는 **rebalDate만** 옮긴다(recordDate·exDate·payDate 불변) — 분배 일정은
 *    시장이 정하는 값이라 사용자가 옮기면 권리 확정 수량이 실제와 달라진다.
 * ⚠️ 월별 **일괄** 오버라이드(assetId 없음)는 `rebalMode==='follow'` 종목에만 적용한다.
 *    개별 지정한 종목까지 끌고 가면 "일괄과 별개로 종목을 다르게" 라는 요구가 깨진다.
 *    개별 종목을 특정 월만 옮기려면 assetId를 지정한 오버라이드를 쓴다(그 달 일정을 통째로 대체).
 * ⚠️ 슬롯의 recordDate/exDate/payDate는 **표시·검증용 라벨**이다. 실제 분배 권리는
 *    buildDividendSlots가 종목의 payCycle로 따로 계산한다(정책과 독립).
 */
export function buildSlots(config: BtConfig, holidays: Set<string>): BtSlot[] {
  const out: BtSlot[] = [];
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return out;
  const groupOv = new Map<string, BtOverride>();
  const assetOv = new Map<string, BtOverride>();
  for (const o of config.overrides) {
    if (o.assetId) assetOv.set(`${o.ym}|${o.assetId}`, o);
    else groupOv.set(`${o.ym}|${o.group}`, o);
  }

  for (const ym of monthsBetween(config.startDate, config.endDate)) {
    // ⚠️ 병합 키는 **날짜 하나**다(그룹을 섞지 말 것). 같은 날짜를 그룹별로 쪼개면 그 날
    //    리밸런싱 스텝이 2회 돌면서 '전 종목 매도 → 그 다음 매수' 불변식이 깨진다:
    //    1패스의 매수가 아직 오지 않은 2패스 매도 대금을 못 써 예수금 부족으로 잘리고,
    //    비중 모드의 분모(종목 평가액 합계)도 패스 사이에 값이 달라져 결과가 그룹 순서에 의존하게 된다.
    const byKey = new Map<string, { date: string; group: BtGroup; cycle: 'mid' | 'eom' | null; overridden: boolean; assetIds: string[]; groups: Set<BtGroup> }>();
    const add = (date: string, group: BtGroup, cycle: 'mid' | 'eom' | null, overridden: boolean, assetId: string) => {
      if (!isIsoDate(date)) return;
      const cur = byKey.get(date);
      if (cur) {
        if (!cur.assetIds.includes(assetId)) cur.assetIds.push(assetId);
        if (cycle && !cur.cycle) cur.cycle = cycle;
        if (overridden) cur.overridden = true;
        cur.groups.add(group);
      } else {
        byKey.set(date, { date, group, cycle, overridden, assetIds: [assetId], groups: new Set([group]) });
      }
    };

    for (const a of config.assets) {
      const r = resolveAssetRebal(a, config);
      const group = r.follows ? groupOfFollow(config, a) : 'all';

      // 라벨용 사이클 — 사이클이 없는 모드에서도 그 종목의 분배 주기를 실어 보낸다.
      // (안 그러면 월중 분배 종목을 개별 지정했을 때 슬롯 라벨이 월말 기준으로 찍힌다.)
      const labelCycle: 'mid' | 'eom' = a.payCycle === 'mid' ? 'mid' : 'eom';

      // 종목 지정 오버라이드 — 그 달 그 종목의 일정을 이 날짜 하나로 대체(모드 무관).
      const ao = assetOv.get(`${ym}|${a.id}`);
      if (ao) { add(onOrBeforeBusinessDay(ao.date, holidays), group, labelCycle, true, a.id); continue; }

      if (r.mode === 'none') continue;

      if (r.mode === 'dates') {
        for (const raw of a.rebalDates) {
          if (ymOf(raw) !== ym) continue;
          add(onOrBeforeBusinessDay(raw, holidays), group, labelCycle, false, a.id);
        }
        continue;
      }

      // 일괄 오버라이드는 follow 종목에만
      const go = r.follows ? groupOv.get(`${ym}|${group}`) : undefined;

      if (r.mode === 'day') {
        const raw = `${ym}-${pad2(clampInt(r.day, 1, 31))}`;
        const capped = isIsoDate(raw) ? raw : lastDayOfMonth(ym);
        const d = go ? onOrBeforeBusinessDay(go.date, holidays) : onOrBeforeBusinessDay(capped, holidays);
        add(d, group, labelCycle, !!go, a.id);
        continue;
      }

      const cycle: 'mid' | 'eom' = r.mode;
      const recordDate = recordDateFor(ym, cycle, holidays);
      if (!recordDate) continue;
      const exDate = shiftBusinessDays(recordDate, config.exDivOffset, holidays);
      const d = go ? onOrBeforeBusinessDay(go.date, holidays) : shiftBusinessDays(exDate, config.rebalOffset, holidays);
      add(d, group, cycle, !!go, a.id);
    }

    for (const v of byKey.values()) {
      if (v.date < config.startDate || v.date > config.endDate) continue;
      // 라벨용 기준일 — 사이클이 없는 모드(day/dates/개별 오버라이드)는 그 종목의 payCycle을
      // 실어 보내므로 여기 폴백은 남은 예외(전 종목 payCycle:'none')에만 걸린다.
      const cycle: 'mid' | 'eom' = v.cycle ?? 'eom';
      const recordDate = recordDateFor(ym, cycle, holidays);
      out.push({
        // 그룹이 섞인 날짜는 'all'로 라벨링(실행은 한 슬롯으로 함께 돈다).
        ym, group: v.groups.size > 1 ? 'all' : v.group, recordDate,
        exDate: shiftBusinessDays(recordDate, config.exDivOffset, holidays),
        payDate: shiftBusinessDays(recordDate, config.payOffset, holidays),
        rebalDate: v.date, overridden: v.overridden, assetIds: v.assetIds,
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
 * 분배금 재투자 실행일 생성.
 *
 * ⚠️ `config.policy`를 절대 보지 말 것 — 재투자는 리밸런싱과 독립이다(리밸런싱을 꺼도 돌아야
 *    하는 것이 이 기능의 존재 이유다).
 * ⚠️ mid/eom의 날짜는 리밸런싱과 **같은 식**(기준일 + exDivOffset + rebalOffset)으로 구한다.
 *    분배락 직전 영업일이라 그날 산 수량이 그 달 분배 권리를 그대로 받는다.
 * ⚠️ 같은 날짜가 두 번 나오면 하나로 합친다 — 재투자는 '주머니 전액'을 쓰므로 두 번 돌아도
 *    두 번째는 빈 주머니를 보고 아무 일도 안 하지만, 스텝이 중복되면 표에 유령 행이 남는다.
 */
export function buildReinvestSlots(config: BtConfig, holidays: Set<string>): BtReinvestSlot[] {
  const out: BtReinvestSlot[] = [];
  const mode = config.divReinvest;
  if (mode !== 'payDate' && mode !== 'mid' && mode !== 'eom') return out;
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return out;

  const seen = new Set<string>();
  const add = (ym: string, date: string, label: BtReinvestSlot['label']) => {
    if (!isIsoDate(date)) return;
    if (date < config.startDate || date > config.endDate) return;
    if (seen.has(date)) return;
    seen.add(date);
    out.push({ ym, date, label });
  };

  if (mode === 'payDate') {
    for (const d of buildDividendSlots(config, holidays)) add(ymOf(d.payDate), d.payDate, 'pay');
  } else {
    const cycle: 'mid' | 'eom' = mode === 'mid' ? 'mid' : 'eom';
    for (const ym of monthsBetween(config.startDate, config.endDate)) {
      const recordDate = recordDateFor(ym, cycle, holidays);
      if (!recordDate) continue;
      const exDate = shiftBusinessDays(recordDate, config.exDivOffset, holidays);
      add(ym, shiftBusinessDays(exDate, config.rebalOffset, holidays), cycle);
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
  /**
   * 이벤트 `removeAssets`로 **의도적으로 제외**된 종목인가.
   * ⚠️ `!active`와 반드시 구분해야 한다 — `active:false`는 '아직 편입 전'(중간 상장 대기)도
   *    포함하고 그쪽은 매수 대상이 **맞다**. 이 플래그가 없으면 분배금 재투자·리밸런싱이
   *    사용자가 뺀 종목을 조용히 되사서 되살린다(기말 보유·수익률에 계속 남는다).
   */
  removed: boolean;
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
      cumTradeNet: 0, cumStructuralNet: 0, cumReinvestNet: 0,
      cumDivAccrued: 0, cumDivPaid: 0, cumContribution: 0,
      finalCashTrade: 0, finalCashDiv: 0, maxDrawdown: 0, months: 0,
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
      asset: a, qty: 0, active: false, removed: false,
      targetAmount: a.targetAmount, targetRatio: a.targetRatio,
      effectiveStart, effectiveEnd,
    });
  }

  const posById = new Map(positions.map(p => [p.asset.id, p]));
  const usable = positions.filter(p => !!prices[p.asset.code] && seriesRange(prices[p.asset.code]).count > 0);
  if (!usable.length) return empty('선택한 종목 중 종가 데이터가 있는 종목이 없습니다. 종목을 조회하거나 데이터를 붙여넣어 주세요.');

  let cash = config.initialCapital + config.extraCash;
  // ── 예수금 두 주머니 ──
  // ⚠️ 불변식: `cashTrade + cashDiv === cash` (항상). 총액은 종전과 1원도 다르지 않고,
  //    "예수금을 먼저 쓰고 모자라면 누적 분배금을 쓴다"는 사용 순서를 **보이게** 하려는 분해다.
  //    분배금을 cash와 별도로 더하면 이중 계상이 되므로 절대 그렇게 바꾸지 말 것.
  let cashTrade = cash;   // 초기 잔돈 + 매매(리밸런싱·구조변경) 순현금
  let cashDiv = 0;        // 지급받은 분배금 중 아직 쓰지 않은 몫
  /** 월말 주머니 잔액 복원용 스냅샷(날짜 오름차순). */
  const bucketLog: { date: string; t: number; d: number }[] = [];
  const logBuckets = (date: string) => {
    const last = bucketLog[bucketLog.length - 1];
    if (last && last.date === date) { last.t = cashTrade; last.d = cashDiv; return; }
    bucketLog.push({ date, t: cashTrade, d: cashDiv });
  };
  /**
   * 그 달 매수 대금을 **어느 주머니에서 얼마씩** 꺼냈는지.
   * ⚠️ 누적 매매차익이 마이너스인 달에는 "이 매수를 무엇으로 충당했는가"가 화면에서
   *    보이지 않으면 사용자가 추적할 수 없다 — 그 근거를 남기는 기록이다.
   */
  const drawByYm = new Map<string, { fromTrade: number; fromDiv: number }>();
  /**
   * 분배금 주머니의 **종목별 출처**. 합은 항상 cashDiv와 같다.
   * ⚠️ divReinvestSplit='source'(DRIP)에서만 쓰이지만, 주머니가 줄어들 때마다 함께 줄여
   *    합=cashDiv 불변식을 유지해야 한다 — 안 그러면 이미 써 버린 분배금의 출처가 남아
   *    다음 재투자에서 유령 가중치가 된다.
   */
  const divPocket = new Map<string, number>();
  /** cashDiv에서 x원이 빠질 때 출처 맵을 비례 축소한다(합 = cashDiv 유지). */
  const drainPocket = (x: number) => {
    if (!(x > 0)) return;
    let total = 0;
    for (const v of divPocket.values()) total += v;
    if (!(total > 0)) { divPocket.clear(); return; }
    const keep = Math.max(0, 1 - x / total);
    if (keep <= 0) { divPocket.clear(); return; }
    for (const [k, v] of divPocket) divPocket.set(k, v * keep);
  };
  /**
   * 매도(+)는 매매 주머니로, 매수(−)는 주머니에서 꺼낸다.
   * @param prefer 'trade'(기본) = 매매 → 분배금 순 / 'div' = 분배금 → 매매 순.
   * ⚠️ 분배금 재투자 매수는 반드시 'div'로 꺼낸다 — 기본값으로 꺼내면 cashDiv가 줄지 않아
   *    **다음 회차가 같은 분배금을 또 투입**한다(무한 재투자로 예수금이 통째로 빨려 들어간다).
   */
  const applyCash = (delta: number, date: string, prefer: 'trade' | 'div' = 'trade') => {
    cash += delta;
    if (delta >= 0) { cashTrade += delta; logBuckets(date); return; }
    let need = -delta;
    let fromTrade = 0;
    let fromDiv = 0;
    if (prefer === 'div') {
      fromDiv = Math.max(0, Math.min(cashDiv, need));
      cashDiv -= fromDiv;
      drainPocket(fromDiv);
      need -= fromDiv;
      if (need > 0) {
        fromTrade = Math.max(0, Math.min(cashTrade, need));
        cashTrade -= fromTrade;
        need -= fromTrade;
      }
    } else {
      fromTrade = Math.max(0, Math.min(cashTrade, need));
      cashTrade -= fromTrade;
      need -= fromTrade;
      if (need > 0) {
        fromDiv = Math.max(0, Math.min(cashDiv, need));
        cashDiv -= fromDiv;
        drainPocket(fromDiv);
        need -= fromDiv;
      }
    }
    // 둘 다 바닥나면(allowNegativeCash) 초과분은 매매 주머니가 음수로 진다.
    if (need > 0) cashTrade -= need;
    const ym = ymOf(date);
    if (ym) {
      const cur = drawByYm.get(ym);
      // 초과분(need)은 매매 주머니가 마이너스로 떠안았으므로 매매 몫에 함께 계상한다.
      if (cur) { cur.fromTrade += fromTrade + need; cur.fromDiv += fromDiv; }
      else drawByYm.set(ym, { fromTrade: fromTrade + need, fromDiv });
    }
    logBuckets(date);
  };
  const applyDividend = (amount: number, date: string, assetId?: string) => {
    cash += amount;
    cashDiv += amount;
    if (assetId && amount > 0) divPocket.set(assetId, (divPocket.get(assetId) ?? 0) + amount);
    logBuckets(date);
  };

  const evalOf = (p: Pos, date: string): { amount: number; hit: BtPriceHit } => {
    const hit = priceAt(prices[p.asset.code], date);
    return { amount: hit.missing ? 0 : p.qty * hit.price, hit };
  };

  /**
   * 종목 평가액 합계. **비중 모드의 분모이기도 하다**(BtTargetMode 주석 참조).
   *
   * ⚠️ 여기에 `cash`(예수금)나 누적 분배금·매매차익을 더하지 말 것 — 비중은 "들고 있는
   *    종목들 사이의 배분"이고, 현금이 분모에 섞이면 사용자가 정한 A 50% / B 50%가
   *    현금 잔고에 따라 흔들린다. 분모를 고르는 옵션(total/initial/totalWithDiv)은
   *    2026-08 사용자 정의로 제거됐다.
   */
  const totalEvalAt = (date: string): number => {
    let s = 0;
    for (const p of positions) { if (p.qty > QTY_EPS) s += evalOf(p, date).amount; }
    return s;
  };

  /**
   * 비중 모드 분모. 평소에는 종목 평가액 합계 그대로다.
   *
   * ⚠️ **보유가 하나도 없으면 그 시점 가용 현금으로 부트스트랩**한다 — 안 그러면 분모 0 →
   *    목표 0 → 매매 0 → 보유 0 이 스스로를 잠가(self-locking) 한 주도 사지 못한다.
   *    실제로 걸리는 경로가 둘 있다: ① 전 종목이 기간 중간 편입(시작일에 보유가 없다)
   *    ② ⑦ 이벤트의 전면 교체(1단계 전량 매도가 4단계 분모 산출보다 먼저 실행된다).
   *    초기 매수가 투입 자본을 분모로 쓰는 것과 **같은 원리**다(그 시점 cash = 투입 자본).
   * ⚠️ 평가액이 있으면 현금은 절대 섞이지 않는다 — '예수금은 분모가 아니다'(검증 #106)는
   *    그대로다. `eq + cash` 같은 형태로 바꾸지 말 것.
   */
  const targetBaseAt = (date: string): number => {
    const eq = totalEvalAt(date);
    return eq > 0 ? eq : Math.max(0, cash);
  };

  /**
   * 비중 합 점검(1회 경고). 분모가 '종목 평가액 합계'로 고정되면서 **합이 100%가 아닌 것의 뜻이
   * 달라졌다** — 1회성 현금 버퍼가 아니라 리밸런싱 **때마다** 그 차이만큼 사고파는 지시가 된다
   * (80%면 매번 20%씩 팔아 평가액이 복리로 줄어든다). 오타 한 번이 조용히 그렇게 돌면 안 된다.
   *
   * ⚠️ 판정은 **그 시점 살아 있는 종목**의 비중 합이다 — `config.assets` 정적 합으로 재지 말 것.
   *    ① 편입 기간이 갈린 정상 구성(A 100% → B 100%)이 정적 합 200%로 **상시 오탐**하고
   *    ② ⑦ 이벤트가 런타임에 바꾼 비중(`p.targetRatio` 덮어쓰기)의 진짜 오타는 **영영 미탐**이다.
   * ⚠️ 합 0%(목표 금액 → 비중 모드 전환 시 비중 칸이 전부 비어 있는 흔한 상태)는 피해가 가장
   *    큰데 `sum > 0` 게이트를 두면 **정확히 그 경우만 건너뛴다**. 별도 문구로 반드시 알린다.
   * ⚠️ 허용 오차는 반올림 잔차용이다(33.33×3=99.99). 이보다 넓히면 진짜 오타 가드가 죽는다.
   */
  const RATIO_SUM_TOL = 0.05;
  let ratioSumWarned = false;
  const checkRatioSum = (date: string): void => {
    if (config.targetMode !== 'ratio' || ratioSumWarned) return;
    const live = positions.filter(
      p => p.active && !p.removed && date >= p.effectiveStart && date <= p.effectiveEnd,
    );
    if (!live.length) return;
    const sum = live.reduce((s, p) => s + Math.max(0, p.targetRatio ?? 0), 0);
    if (!(sum > 0)) {
      ratioSumWarned = true;
      warnings.push(
        '목표 비중이 전부 0%라 아무것도 사지 않습니다 — ⑥ 종목에서 종목별 목표 비중을 입력하세요'
        + '(목표 금액 모드에서 전환했다면 비중 칸이 비어 있습니다).',
      );
      return;
    }
    if (Math.abs(sum - 100) > RATIO_SUM_TOL) {
      ratioSumWarned = true;
      // ⚠️ 합이 어긋나는 흔한 원인이 '아직 편입 전/이미 이탈한 종목'이라, 몇 종목의 합인지를
      //    함께 밝힌다 — 안 그러면 100%를 정확히 입력한 사용자가 이유를 알 수 없다.
      const scope = live.length < positions.length ? ` ${date} 기준 편입된 ${live.length}/${positions.length}종목의 합입니다.` : '';
      warnings.push(
        `목표 비중 합이 ${Math.round(sum * 100) / 100}%입니다(100% 아님).${scope} 분모가 ‘종목 평가액 합계’라 `
        + '리밸런싱마다 그 차이만큼 사고팝니다 — 100%보다 작으면 매번 팔아 현금이 쌓이고(평가액이 계속 줄어듭니다), '
        + '크면 예수금을 헐어 더 삽니다.',
      );
    }
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
    // ⚠️ 결과가 0에 수렴하면 **정확히 전량**으로 스냅한다(QTY_EPS 주석 참조). p.qty를 나중에
    //    보정하면 러닝 누적 맵(runQty)은 t.qty를 더하므로 둘이 갈린다 — 반드시 qty 자체를 고친다.
    if (p.qty + qty !== 0 && Math.abs(p.qty + qty) < QTY_EPS) qty = -p.qty;
    if (qty === 0) return null;

    const cashDelta = -qty * hit.price;
    applyCash(cashDelta, date);
    const qtyBefore = p.qty;
    p.qty += qty;

    return {
      date, assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
      price: hit.price, priceExact: hit.exact,
      qtyBefore, evalBefore, target,
      qty, cashDelta,
      qtyAfter: p.qty, evalAfter: p.qty * hit.price,
      structural, reinvest: false, note,
    };
  };

  /**
   * 주어진 **예산 안에서** 사는 매수 1건 (분배금 재투자 전용).
   *
   * ⚠️ 반올림은 config.rounding이 'round'여도 항상 **0 방향 버림**이다 — 예산을 넘겨 사면
   *    분배금이 아니라 매매 주머니를 헐게 되어 "분배금만 재투자한다"는 전제가 깨진다.
   *    소수 좌수(exact)만 그대로 통과시킨다(adjustTo의 '예수금 부족' 폴백과 같은 규약).
   * ⚠️ 1주 값에 못 미치는 잔돈은 **사지 않고 주머니에 남긴다** — 다음 재투자 회차로 이월돼
   *    누적된다(버리면 분배금이 조용히 증발한다).
   */
  const buyWithBudget = (p: Pos, date: string, budget: number): BtTrade | null => {
    if (!(budget > 0)) return null;
    const hit = priceAt(prices[p.asset.code], date);
    if (hit.missing || hit.price <= 0) return null;
    const floorMode: BtRounding = config.rounding === 'exact' ? 'exact' : 'floor';
    let qty = roundQty(budget / hit.price, floorMode);
    if (!(qty > 0)) return null;
    if (!config.allowNegativeCash && qty * hit.price > cash) {
      qty = roundQty(cash / hit.price, floorMode);
      if (!(qty > 0)) return null;
    }
    const evalBefore = p.qty * hit.price;
    const cashDelta = -qty * hit.price;
    applyCash(cashDelta, date, 'div');
    const qtyBefore = p.qty;
    p.qty += qty;
    return {
      date, assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
      price: hit.price, priceExact: hit.exact,
      qtyBefore, evalBefore,
      // '목표'는 레벨이 아니라 **배분받은 분배금을 전부 썼을 때 도달할 평가액**이다.
      // 실제 evalAfter와의 차이가 곧 1주 미만 잔돈(다음 회차로 이월).
      target: evalBefore + budget,
      qty, cashDelta,
      qtyAfter: p.qty, evalAfter: p.qty * hit.price,
      structural: false, reinvest: true, note: '',
    };
  };

  /**
   * 분배금 재투자 1회. 실행한 매매를 **반환**한다(적재는 호출부의 pushTrade가 한다 —
   * adjustTo와 같은 계약이라 월별 집계 경로가 하나로 유지된다).
   *
   * ⚠️ 재원은 **cashDiv 주머니 전액**(지급받았지만 아직 쓰지 않은 분배금)이다. 리밸런싱이
   *    이미 헐어 쓴 몫은 주머니에서 빠져 있으므로 이중 투입이 없고, 1주 미만 잔돈은 남아
   *    다음 회차에 합쳐진다.
   * ⚠️ 배분 후 각 종목이 쓰는 금액의 합은 예산을 넘지 않는다(share의 합 = budget, 각 매수는
   *    floor라 share 이하) → cashDiv가 음수로 내려가지 않는다.
   */
  const runReinvest = (date: string): BtTrade[] => {
    const done: BtTrade[] = [];
    const budget = cashDiv;
    if (!(budget > 0)) return done;
    // 그날 실제로 살 수 있는 종목만 — 편입 구간 안 + 쓸 수 있는 종가가 있는 종목.
    // ⚠️ `p.removed`(이벤트로 뺀 종목)는 반드시 제외한다. `p.active`로 거르면 안 된다 —
    //    '아직 편입 전'인 중간 상장 종목까지 빠져 재투자가 유일한 편입 경로라는 설계가 죽는다.
    const live = positions.filter(
      p => !p.removed
        && date >= p.effectiveStart && date <= p.effectiveEnd
        && !priceAt(prices[p.asset.code], date).missing,
    );
    if (!live.length) return done;

    const weightOf = (p: Pos): number => {
      if (config.divReinvestSplit === 'even') return 1;
      if (config.divReinvestSplit === 'source') return Math.max(0, divPocket.get(p.asset.id) ?? 0);
      return config.targetMode === 'amount'
        ? Math.max(0, p.targetAmount ?? 0)
        : Math.max(0, p.targetRatio ?? 0);
    };
    let ws = live.map(weightOf);
    let totalW = ws.reduce((s, x) => s + x, 0);
    // ⚠️ 가중치가 전부 0이면(목표 미설정 / 분배금을 준 종목이 이미 빠짐) 균등으로 폴백한다.
    //    여기서 그냥 반환하면 분배금이 영원히 현금으로 남아 사용자가 켠 '재투자' 설정이
    //    아무 경고도 없이 무시된다.
    if (!(totalW > 0)) { ws = live.map(() => 1); totalW = live.length; }

    for (let i = 0; i < live.length; i++) {
      if (!(ws[i] > 0)) continue;
      const t = buyWithBudget(live[i], date, (budget * ws[i]) / totalW);
      if (!t) continue;
      // 재투자 매수가 곧 편입이다 — 리밸런싱을 끈 시나리오에서 중간 상장 종목이 들어오는 유일한 경로.
      live[i].active = true;
      done.push(t);
    }
    return done;
  };

  // ── Phase 0: 초기 매수 ───────────────────────────────────────────────────
  const initialTrades: BtTrade[] = [];
  for (const p of positions) {
    if (p.effectiveStart > startBiz) continue;      // 중간 상장 종목은 나중에 편입
    if (p.effectiveEnd < startBiz) continue;
    p.active = true;
  }
  {
    // ⚠️ 초기 매수만은 비중 분모가 평가액이 아니라 **투입 자본**이다.
    //    평소 분모(종목 평가액 합계)를 그대로 쓰면 그 시점 평가액이 0이라 목표가 전부 0이 되어
    //    아무것도 사지 않는다(비중 모드가 통째로 죽는 회귀). `targetBaseAt`의 현금 부트스트랩과
    //    같은 원리이고 그 시점 cash와도 값이 같다.
    checkRatioSum(startBiz);
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

  // ⚠️ 리밸런싱 슬롯이 하나도 없는 종목은 **중간 편입 경로가 통째로 사라진다** — 종목을
  //    활성화하는 계기는 초기매수·리밸런싱 슬롯·이벤트 addAssets 셋뿐이라, 조회기간 중간에
  //    상장한 종목에 'none'/빈 날짜 목록을 주면 매수 자체가 일어나지 않는다.
  //    ⚠️ 단, 분배금 재투자가 켜져 있으면 그 매수가 편입 경로 역할을 하므로 문구가 달라진다.
  //    ⚠️ 전역 '리밸런싱 안 함'은 **사용자가 명시적으로 고른 설정**이라 종목 수만큼 경고를
  //       쏟지 않는다(Buy & Hold 기준선을 만들 때마다 경고가 도배되면 진짜 경고가 묻힌다).
  const reinvestSlots = buildReinvestSlots(config, holidays);
  {
    const slotted = new Set<string>();
    for (const s of slots) for (const id of s.assetIds) slotted.add(id);
    const reinvestOn = reinvestSlots.length > 0;
    // ⚠️ 'source'(DRIP) 배분은 가중치가 **그 종목이 준 분배금**이라, 아직 한 번도 분배한 적 없는
    //    신규 편입 종목은 가중치가 영구히 0이라 재투자로도 절대 매수되지 않는다(균등 폴백은
    //    totalW===0일 때만 도는데 기존 종목이 분배금을 계속 넣어 발동하지 않는다).
    const sourceSplit = config.divReinvestSplit === 'source';
    for (const p of positions) {
      if (slotted.has(p.asset.id)) continue;
      const nm = p.asset.name || p.asset.code;
      if (p.effectiveStart > startBiz) {
        warnings.push(
          !reinvestOn
            ? `${nm}: 리밸런싱 일정이 없어(‘리밸런싱 안 함’ 또는 지정 날짜 없음) 기간 중간 편입이 실행되지 않습니다 — 매수가 한 번도 일어나지 않습니다.`
            : sourceSplit
              ? `${nm}: 리밸런싱 일정이 없고 분배금 배분 기준이 ‘분배금 준 종목(DRIP)’이라 이 종목은 매수되지 않습니다 — 자기 분배 이력이 없으면 배분 몫이 0입니다(배분 기준을 ‘목표 비중’이나 ‘균등’으로 바꾸세요).`
              : `${nm}: 리밸런싱 일정이 없어 기간 중간 편입은 분배금 재투자 매수 시점에만 일어납니다(재투자할 분배금이 없으면 매수되지 않습니다).`,
        );
      } else if (config.policy !== 'none') {
        warnings.push(`${nm}: 리밸런싱 일정이 없어 최초 매수 후 수량이 고정됩니다(의도한 설정이면 무시하세요).`);
      }
    }
    // ⚠️ 목표가 **레벨(고정 금액)** 인 모드에서는 리밸런싱이 재투자분을 그대로 되판다.
    //    실질 효과는 거의 0인데 되판 대금이 tradeNet(‘누적 매매차익’)에 들어가 지표만 부푼다
    //    (재투자 매수는 reinvestNet으로 빠지므로 매수/매도가 비대칭이 된다). 조용히 두면
    //    비교 표에서 시나리오 순위가 뒤바뀐다.
    //    ⚠️ 비중 모드는 분모가 평가액이라 재투자가 분모를 키워 목표도 같이 오른다 → 되팔리지 않는다.
    if (reinvestOn && slots.length > 0 && config.targetMode === 'amount') {
      warnings.push(
        '목표 금액 모드에서는 분배금 재투자로 산 수량을 다음 리밸런싱이 목표 금액에 맞춰 되팝니다 — '
        + '재투자 효과가 거의 없고, 되판 대금이 ‘누적 매매차익’에 잡혀 실제보다 커 보입니다. '
        + '재투자를 살리려면 리밸런싱을 끄거나(‘리밸런싱 안 함’) 목표를 ‘목표 비중 %’로 바꾸세요.',
      );
    }
  }

  type Step =
    | { date: string; kind: 'exdiv'; div: BtDivSlot }
    | { date: string; kind: 'pay'; div: BtDivSlot }
    | { date: string; kind: 'rebal'; slot: BtSlot }
    | { date: string; kind: 'event'; event: BtEvent }
    | { date: string; kind: 'contrib'; ym: string }
    | { date: string; kind: 'reinvest'; slot: BtReinvestSlot };

  const steps: Step[] = [];
  for (const s of slots) steps.push({ date: s.rebalDate, kind: 'rebal', slot: s });
  for (const rs of reinvestSlots) {
    if (rs.date < startBiz || rs.date > endBiz) continue;
    steps.push({ date: rs.date, kind: 'reinvest', slot: rs });
  }

  // ── 매월 목표 증액(재투자) ──
  // ⚠️ 그 달 **첫 리밸런싱일**에 건다 — 목표를 올려 두면 바로 이어지는 리밸런싱이 실제로 매수한다.
  //    리밸런싱이 없는 달은 증액해도 그 달에 집행할 수단이 없으므로 건너뛴다.
  const contribOvByYm = new Map<string, BtContribOverride>();
  for (const o of config.contribOverrides) {
    if (contribOvByYm.has(o.ym)) warnings.push(`증액 예외 규칙에 ${o.ym}이(가) 중복 지정돼 마지막 것만 적용됩니다.`);
    contribOvByYm.set(o.ym, o);
  }
  // ⚠️ 월 귀속은 슬롯 라벨(s.ym)이 아니라 **실제 집행일(rebalDate)의 달**로 잡는다.
  //    오프셋·휴장 스냅으로 rebalDate가 라벨과 다른 달로 나갈 수 있는데(fixedDay 1~3, 큰 음수
  //    오프셋), s.ym을 쓰면 거래가 없는 달에 증액 행이 뜨고 실제 집행 달은 0으로 표시된다.
  //    거래(pushTrade)·분배 적재가 전부 ymOf(실제 날짜) 기준이라 여기만 다르면 내부 불일치다.
  // ⚠️ 그 달 리밸런싱에 **실제로 참여하는 종목 집합**도 함께 만든다 — 슬롯이 없는 종목
  //    (rebalMode:'none', 그 달 지정 날짜 없음)에 증액을 배분하면 목표만 오르고 영원히 매수되지
  //    않아, 예수금 한도를 갉아먹으면서 '누적 증액'이 재투자되지 않은 돈을 보고하게 된다.
  const contribAssetsByYm = new Map<string, Set<string>>();
  {
    const firstRebalOfYm = new Map<string, string>();
    for (const s of slots) {
      const ym = ymOf(s.rebalDate);
      if (!ym) continue;
      const cur = firstRebalOfYm.get(ym);
      if (!cur || s.rebalDate < cur) firstRebalOfYm.set(ym, s.rebalDate);
      let set = contribAssetsByYm.get(ym);
      if (!set) { set = new Set(); contribAssetsByYm.set(ym, set); }
      for (const id of s.assetIds) set.add(id);
    }
    if (config.contribution.mode !== 'none' || contribOvByYm.size > 0) {
      for (const [ym, d] of firstRebalOfYm) steps.push({ date: d, kind: 'contrib', ym });
    }
    // ⚠️ 기본 증액 규칙은 리밸런싱이 하나도 없으면 **결과·경고 어디에도 흔적 없이 사라진다**
    //    (예외 규칙만 아래에서 경고했다). 사용자가 설정한 값이 조용히 무시되면 안 된다.
    if (config.contribution.mode !== 'none' && config.contribution.value > 0 && firstRebalOfYm.size === 0) {
      warnings.push('리밸런싱이 한 번도 없어 매월 목표 증액이 전혀 집행되지 않습니다(증액은 그 달 첫 리밸런싱 직전에만 걸립니다).');
    }
    // ⚠️ 비중 모드에서는 증액이 **원리적으로** 집행되지 않는다(아래 contrib 스텝의 조기 반환).
    //    리밸런싱 유무와 무관하므로 스텝 안이 아니라 여기서 한 번 알린다 — 스텝은 리밸런싱이
    //    있는 달에만 생겨서, 거기서만 경고하면 '리밸런싱 없음' 시나리오가 사실과 다른 안내를 받는다.
    const anyContrib = (config.contribution.mode !== 'none' && config.contribution.value > 0)
      || config.contribOverrides.some(o => o.mode !== 'none' && o.value > 0);
    if (anyContrib && config.targetMode === 'ratio') {
      warnings.push(
        '비중 모드에서는 매월 목표 증액이 반영되지 않습니다 — 목표가 “종목 평가액 합계 × 비중”이라 '
        + '늘릴 대상이 없습니다. 쌓인 현금을 다시 투입하려면 목표 금액 모드를 쓰거나, '
        + '④ 분배금 처리를 재투자로 두거나, 목표 비중 합을 100%보다 크게 잡으세요.',
      );
    }
    // 집행할 리밸런싱이 없는 달을 겨냥한 예외 규칙은 조용히 버려지므로 알린다.
    for (const o of config.contribOverrides) {
      if (o.mode !== 'none' && o.value > 0 && !firstRebalOfYm.has(o.ym)) {
        warnings.push(`${o.ym}의 증액 예외 규칙은 그 달에 리밸런싱이 없어 적용되지 않습니다.`);
      }
    }
  }
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

  // ⚠️ contrib은 pay 뒤(그날 받은 분배금까지 재원에 포함) · rebal 앞(올린 목표로 바로 매수).
  // ⚠️ reinvest는 **맨 뒤**다 — 리밸런싱은 '목표 수준 맞추기'이고 재투자는 '그러고도 남은
  //    분배금 현금을 추가 투입'이라 나중에 와야 의미가 맞는다. 앞에 두면 재투자가 방금 산
  //    수량을 같은 날 리밸런싱이 되팔아(목표 초과) 매매만 늘고 결과는 그대로가 된다.
  const KIND_ORDER: Record<string, number> = {
    exdiv: 0, pay: 1, event: 2, contrib: 3, rebal: 4, reinvest: 5,
  };
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
        tradeNet: 0, structuralNet: 0, reinvestNet: 0, cumTradeNet: 0,
        divAccrued: 0, cumDivAccrued: 0, divPaid: 0, cumDivPaid: 0, cumReinvestNet: 0,
        cashDelta: 0, cashEnd: 0, cashTradeEnd: 0, cashDivEnd: 0, cashUsedTrade: 0, cashUsedDiv: 0, evalEnd: 0, totalEnd: 0, evalBeforeSum: 0,
        lastDate: '', holdings: [], contribution: null, cumContribution: 0,
      };
      monthMap.set(ym, m);
    }
    return m;
  };
  for (const ym of monthsBetween(startBiz, endBiz)) monthOf(ym);

  // ⚠️ 세 갈래는 상호배타다 — 재투자 매수를 tradeNet에 섞으면 '누적 매매차익'이 재투자 대금
  //    만큼 마이너스로 부풀어(리밸런싱을 끈 시나리오에서는 매매가 재투자뿐이라 통째로) 지표가
  //    의미를 잃는다. structural과 같은 이유로 따로 센다.
  const pushTrade = (t: BtTrade) => {
    const m = monthOf(ymOf(t.date));
    m.trades.push(t);
    if (t.reinvest) m.reinvestNet += t.cashDelta;
    else if (t.structural) m.structuralNet += t.cashDelta;
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
        applyDividend(r.amount, step.date, r.assetId);
      }
      continue;
    }

    if (step.kind === 'reinvest') {
      for (const t of runReinvest(step.date)) pushTrade(t);
      continue;
    }

    if (step.kind === 'contrib') {
      const rule = contribOvByYm.get(step.ym) ?? config.contribution;
      if (rule.mode === 'none' || !(rule.value > 0)) continue;
      // ⚠️ 비중 모드에서는 목표가 '종목 평가액 합계 × 비중'이라 **증액할 대상 자체가 없다** —
      //    현금을 더 넣겠다고 해도 분모가 그대로라 목표가 1원도 오르지 않는다(분모를 '초기
      //    투자금 고정'으로 두던 옛 선택지만 이걸 반영했는데 2026-08에 제거됐다).
      //    ⚠️ 실행한 척하지 말 것 — 과거엔 '증액 N원' 행과 '누적 증액' 카드가 그대로 찍히면서
      //       실제 매수는 0이라, 경고를 놓친 사용자가 결과를 정반대로 읽었다.
      //    경고는 위 슬롯 준비 블록에서 **한 번만** 띄운다(리밸런싱 유무와 무관한 사실이므로).
      if (config.targetMode === 'ratio') continue;
      const cashBefore = cash;
      const requested = rule.mode === 'pctOfCash' ? (cashBefore * rule.value) / 100 : rule.value;
      let amount = requested;
      let note = '';
      // ⚠️ 예수금을 넘겨 증액하면 곧바로 이어지는 리밸런싱이 '예수금 부족'으로 잘린다 —
      //    목표만 부풀고 실제로는 못 사는 상태가 되므로 여기서 미리 자른다.
      if (!config.allowNegativeCash && amount > cashBefore) {
        amount = Math.max(0, cashBefore);
        note = '예수금 한도';
      }
      amount = Math.floor(amount);
      if (!(amount > 0)) continue;

      // ⚠️ '활성'만으로 거르지 말 것 — 그 달 리밸런싱 슬롯에 실제로 들어 있는 종목만 대상이다.
      //    슬롯 없는 종목(rebalMode:'none' 등)에 배분하면 목표만 오르고 매수는 영원히 없다.
      const slotAssets = contribAssetsByYm.get(step.ym) ?? new Set<string>();
      const live = positions.filter(
        p => p.active && step.date >= p.effectiveStart && step.date <= p.effectiveEnd,
      );
      const elig = live.filter(p => slotAssets.has(p.asset.id));
      if (!elig.length) continue;
      if (elig.length < live.length) {
        warnings.push(`${step.ym}: 리밸런싱 일정이 없는 종목은 증액 대상에서 제외했습니다(목표만 오르고 매수되지 않기 때문).`);
      }

      // 여기 도달하는 것은 목표 금액 모드뿐이다(비중 모드는 위에서 조기 반환).
      const perAsset: BtContribRow['perAsset'] = [];
      const ws = elig.map(p =>
        config.contribution.split === 'even' ? 1 : Math.max(0, p.targetAmount ?? 0),
      );
      let totalW = ws.reduce((s, x) => s + x, 0);
      if (!(totalW > 0)) { ws.fill(1); totalW = elig.length; }
      let left = amount;
      elig.forEach((p, i) => {
        // 마지막 종목이 잔여를 받아 배분 합 = amount 를 정확히 만든다(원 단위 오차 방지).
        const share = i === elig.length - 1 ? left : Math.floor((amount * ws[i]) / totalW);
        left -= share;
        p.targetAmount = (p.targetAmount ?? 0) + share;
        perAsset.push({
          assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
          added: share, targetAfter: p.targetAmount,
        });
      });

      const m = monthOf(step.ym);
      m.contribution = {
        ym: step.ym, date: step.date, cashBefore, requested, amount,
        mode: rule.mode, value: rule.value,
        overridden: contribOvByYm.has(step.ym),
        perAsset, note,
      };
      continue;
    }

    if (step.kind === 'event') {
      const e = step.event;
      // 1) 제외 종목 전량 매도 (구조 변경)
      // ⚠️ 이미 비활성이어도 `removed`는 세운다 — '이 이벤트에서 제외하기로 했다'는 사용자
      //    의사 표시이고, 그래야 이후 리밸런싱·분배금 재투자가 되사지 않는다.
      for (const aid of e.removeAssets) {
        const p = posById.get(aid);
        if (!p) continue;
        if (p.active && p.qty > 0) {
          const t = adjustTo(p, e.date, 0, true);
          if (t) pushTrade(t);
        }
        p.active = false;
        p.removed = true;
      }
      // 2) 새 목표 반영
      for (const t of e.targets) {
        const p = posById.get(t.assetId);
        if (!p) continue;
        if (t.amount !== null) p.targetAmount = t.amount;
        if (t.ratio !== null) p.targetRatio = t.ratio;
      }
      // 3) 편입 — 다시 넣으면 제외 표시를 해제한다(같은 이벤트에서 remove→add도 add가 이긴다).
      for (const aid of e.addAssets) {
        const p = posById.get(aid);
        if (!p) continue;
        if (e.date < p.effectiveStart) {
          warnings.push(`${p.asset.name || p.asset.code}: ${e.date}에는 종가 기록이 없어 ${p.effectiveStart}부터 편입됩니다.`);
          continue;
        }
        p.active = true;
        p.removed = false;
      }
      // 4) 재원 조달
      if (e.funding === 'reallocate') {
        const base = targetBaseAt(e.date);
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
        const base = targetBaseAt(e.date);
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
      const base = targetBaseAt(s.rebalDate);
      const eligible: Pos[] = [];
      for (const aid of s.assetIds) {
        const p = posById.get(aid);
        if (!p) continue;
        // ⚠️ 이벤트로 뺀 종목은 슬롯에 남아 있어도 되사지 않는다 — `removeAssets`의 계약이
        //    '전량 매도 후 비활성화'인데, 다음 리밸런싱이 옛 목표로 다시 사면 제외가 무의미해진다.
        //    (`!p.active`는 '아직 편입 전'도 포함하므로 그것만으로는 구분할 수 없다.)
        if (p.removed) continue;
        if (s.rebalDate < p.effectiveStart || s.rebalDate > p.effectiveEnd) continue;
        // 데이터가 생긴 시점부터 자동 편입 — 중간 상장 종목이 첫 리밸런싱에서 들어온다.
        if (!p.active) p.active = true;
        eligible.push(p);
      }
      // ⚠️ 편입 처리(위 루프)가 끝난 뒤에 점검한다 — 중간 상장 종목이 이 슬롯에서 막 활성화되므로.
      checkRatioSum(s.rebalDate);
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
  let cumReinvest = 0;
  let cumContrib = 0;
  let runCash = config.initialCapital + config.extraCash;
  // 초기 매수 반영
  for (const t of initialTrades) runCash += t.cashDelta;

  // 월말 보유수량은 시뮬레이션 **종료 상태**가 아니라 그 달까지의 매매 누적이어야 한다.
  // ⚠️ 달마다 처음부터 다시 더하지 말 것(O(월²×거래)) — months가 오름차순이므로 러닝 맵으로 누적한다.
  const runQty = new Map<string, number>();
  for (const p of positions) runQty.set(p.asset.id, 0);
  for (const t of initialTrades) runQty.set(t.assetId, (runQty.get(t.assetId) ?? 0) + t.qty);

  for (const m of months) {
    m.trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    m.dividends.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
    cumTrade += m.tradeNet;
    cumStructural += m.structuralNet;
    cumReinvest += m.reinvestNet;
    cumDivAccrued += m.divAccrued;
    cumDivPaid += m.divPaid;
    cumContrib += m.contribution ? m.contribution.amount : 0;
    m.cumTradeNet = cumTrade;
    m.cumReinvestNet = cumReinvest;
    m.cumDivAccrued = cumDivAccrued;
    m.cumDivPaid = cumDivPaid;
    m.cumContribution = cumContrib;
    // ⚠️ reinvestNet을 빠뜨리면 runCash가 실제 cash와 갈려 월말 예수금·총자산이 전부 틀어진다.
    m.cashDelta = m.tradeNet + m.structuralNet + m.reinvestNet + m.divPaid;
    runCash += m.cashDelta;
    m.cashEnd = runCash;
    const lastBiz = onOrBeforeBusinessDay(
      lastDayOfMonth(m.ym) > endBiz ? endBiz : lastDayOfMonth(m.ym),
      holidays,
    );
    for (const t of m.trades) runQty.set(t.assetId, (runQty.get(t.assetId) ?? 0) + t.qty);

    const hold: BtHolding[] = [];
    let ev = 0;
    for (const p of positions) {
      const q = runQty.get(p.asset.id) ?? 0;
      if (q <= QTY_EPS) continue;
      const hit = priceAt(prices[p.asset.code], lastBiz);
      const amount = hit.missing ? 0 : q * hit.price;
      ev += amount;
      hold.push({
        assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
        qty: q, price: hit.price, priceExact: hit.exact, evalAmount: amount, weight: 0,
      });
    }
    for (const h of hold) h.weight = ev > 0 ? (h.evalAmount / ev) * 100 : 0;
    // 월말 주머니 잔액 — 시뮬레이션 중 남긴 스냅샷에서 그 달 마지막 영업일 이하 최신값을 집는다.
    // (runCash처럼 월별 합계로 재구성할 수 없다 — 매수가 어느 주머니에서 나갔는지는 실행 순서가 정한다.)
    {
      let t = config.initialCapital + config.extraCash;
      let d = 0;
      for (const bkt of bucketLog) {
        if (bkt.date > lastBiz) break;
        t = bkt.t; d = bkt.d;
      }
      m.cashTradeEnd = t;
      m.cashDivEnd = d;
    }
    {
      const dr = drawByYm.get(m.ym);
      m.cashUsedTrade = dr ? dr.fromTrade : 0;
      m.cashUsedDiv = dr ? dr.fromDiv : 0;
    }
    m.lastDate = lastBiz;
    m.holdings = hold;
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
        if (q <= QTY_EPS) continue;
        const hit = priceAt(prices[p.asset.code], d);
        if (!hit.missing) ev += q * hit.price;
      }
      curve.push({ date: d, evalAmount: ev, cash: c, total: ev + c });
    }
  }

  // ── 최종 보유 ────────────────────────────────────────────────────────────
  const finalEval = totalEvalAt(endBiz);
  const finalHoldings: BtHolding[] = positions
    .filter(p => p.qty > QTY_EPS)
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
      cumReinvestNet: cumReinvest,
      cumDivAccrued,
      cumDivPaid,
      cumContribution: cumContrib,
      finalCashTrade: cashTrade, finalCashDiv: cashDiv,
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
