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

/**
 * **매수 재원** — 정기 리밸런싱 매수와 시그널 매수가 **같은 규칙을 공유**한다(사용자 확정 2026-08).
 *
 *  both      — '예수금 전부' = 매매 예수금 + 적립 분배금.
 *              매매 몫을 먼저 쓰고 모자라면 분배금 몫에서 꺼낸다(기본 = 종전 동작).
 *  tradeOnly — '매매 예수금만' = 매매차익 + 초기 매수 잔여 + 추가 예수금.
 *              적립 분배금(cashDiv)은 **1원도 쓰지 않는다**.
 *
 * ⚠️ 옛 설계는 tradeOnly에서도 시그널이 `적립 분배금 × 단계 비율`만큼 **개방**해 썼다. 사용자 정의가
 *    "매매 예수금만 = 누적 매매현금 + 초기 예수금"으로 확정되면서 그 개방 메커니즘은 폐기됐다 —
 *    `BtDipLevel.buyPct`는 이제 '분배금 개방 비율'이 아니라 **매수 재원의 투입 비율**이다.
 * ⚠️ 분배금 재투자 매수(divReinvest)는 원래 'div' 출금이라 이 설정의 영향을 받지 않는다.
 * ⚠️ allowNegativeCash와 함께 쓰면 **cashTrade만 음수로 진다**(cashDiv는 음수 불가).
 * ⚠️ 이벤트(구조 변경)는 종전대로 전체 예수금을 쓴다. 초기 매수는 **초기 투자금 한도**만 쓴다
 *    (추가 예수금은 손대지 않는다 — BtConfig.extraCash 주석 참조).
 */
export type BtBuyFunding = 'both' | 'tradeOnly';

/**
 * 매수 시그널 1단계.
 *  drop   = 가격 고점 대비 낙폭(%)
 *  buyPct = 이때 투입할 **매수 재원의 비율(%)**. 매수액 = `min(재원 × buyPct%, 목표 미달액)`.
 *           `null`이면 **'목표까지'** — 목표 미달액 전부를 재원 한도 안에서 채운다(종전 동작).
 *
 * ⚠️ 레거시 필드명은 `unlockPct`('적립 분배금 개방 비율')였다. 값은 그대로 승계하되 **뜻이 바뀌었다**
 *    (normalizeDipLevels가 마이그레이션한다).
 */
export interface BtDipLevel {
  drop: number;
  buyPct: number | null;
}

/**
 * 매도 시그널 1단계.
 *  rise    = 가격 **저점** 대비 상승률(%)
 *  sellPct = 이때 팔 **목표 초과분의 비율(%)**. 매도액 = `(평가액 − 목표) × sellPct%`.
 *            `null`이면 **'목표까지 전량'**(종전 동작).
 *
 * ⚠️ 밑변은 평가액이 아니라 **초과분**이다 — 그래야 목표 아래로 절대 내려가지 않는다
 *    ("매도 시그널은 매도만 한다 · 목표가 하한"이라는 계약).
 * ⚠️ 판 대금은 전액 매매 주머니로 간다(적립 분배금을 늘리지 않는다).
 */
export interface BtSellLevel {
  rise: number;
  sellPct: number | null;
}

/**
 * 시그널 리밸런싱 — 매수 시그널(급락 분할투입) + 매도 시그널(반등 차익실현).
 *
 * 종목별 **가격 고점/저점**(백테스트 구간 내 최고·최저 종가) 대비 당일 종가가 각 단계에
 * **처음 도달**하면, 그 **발동일 종가로 즉시** 그 종목을 목표까지 맞춘다.
 *
 * ── 매수 시그널(levels) 발동 시 ──
 *   재원 = `buyFunding`이 정한다(`tradeOnly` → 매매 예수금만 / `both` → 예수금 전부).
 *   매수액은 그 단계의 `buyPct`가 정한다:
 *     · `buyPct = P`  → `min(재원 스냅샷 × P%, 목표 미달액)`. **재조정을 하지 않는다**
 *                       ("가진 현금의 일부만 투입"이 규칙이라 재원 부족이라는 개념이 없다).
 *     · `buyPct = null` → 목표 미달액 전부(종전 동작). 재원이 모자라면 `reallocate`가
 *                       **목표를 초과한 다른 보유 종목**을 목표까지 팔아 재원을 만든다.
 *   ⚠️ 재원 스냅샷은 **매도 시그널 처리 뒤 · 재조정 앞**에서 1회 잡는다 — 같은 날 매도 시그널이
 *      만든 현금은 재원에 포함하고(실제로 쓸 수 있는 돈이다), 재조정 대금은 포함하지 않는다
 *      (재조정은 '목표까지' 매수를 위한 것이라 비율 매수의 밑변을 부풀리면 안 된다).
 *
 * ── 매도 시그널(sellLevels) 발동 시 ──
 *   `sellPct = P` → `(평가액 − 목표) × P%` 만큼 판다. `null`이면 목표까지 전량(종전 동작).
 *   목표 이하면 아무 일도 없다. 대금은 전액 매매 주머니로.
 *
 * ⚠️ 같은 종목의 여러 단계가 같은 날 겹치면(갭 하락/급등) **비율은 합산**한다(carrier 규약).
 *    단 하나라도 `null`(목표까지)이면 그 종목은 그날 '목표까지'로 처리한다 — 비율과 목표까지를
 *    섞어 두 번 체결하면 같은 시그널이 두 번 표시되고 목표를 넘겨 산다.
 *
 * ⚠️ **평가액 고점이 아니라 가격 고점/저점**이다 — 리밸런싱으로 수량이 계속 변하므로 평가액 극값은 왜곡된다.
 * ⚠️ 각 단계는 **극값이 갱신되기 전까지 1회만** 발동한다(새 고점 = 매수 전 단계 재무장 / 새 저점 = 매도 전 단계 재무장).
 * ⚠️ **정기 리밸런싱 일정(③)과 완전히 독립**이다 — `policy:'none'`(리밸런싱 안 함)이어도 시그널은 돈다.
 *    둘 다 켜면 둘 다 실행된다(같은 날이면 KIND_ORDER상 signal → rebal 순).
 * ⚠️ 리밸런싱 밴드(band)는 **정기 리밸런싱 전용**이라 시그널 매매에는 걸리지 않는다.
 */
/**
 * 앵커 축 단계. `move` = **직전 체결 종가(앵커) 대비** 하락%(매수) 또는 상승%(매도).
 * ⚠️ 비율(`buyPct`/`sellPct`)이 없다 — 앵커 매수는 항상 '목표까지'다. 비율을 주면 같은 날 두 축이
 *    겹칠 때 `pctSum`이 100%를 넘어 화면 계산식(밑변 × 비율 = 금액)과 실제 체결이 어긋난다.
 */
export interface BtAnchorLevel {
  move: number;
}

/**
 * 앵커를 **무엇이** 갱신하는가. 사용자 요청문에 기준이 둘("이전 매매시그널", "이전 리밸런싱")이라
 * 둘 다 표현할 수 있어야 한다.
 *  lastFill  — 리밸런싱 **또는 시그널** 체결이 앵커를 옮긴다(기본). 등락을 반복하면 계속 발동하는
 *              트레일링 ±N% 그리드가 된다.
 *  lastRebal — **리밸런싱 체결만** 앵커를 옮긴다. 한 기준에서 10% → 20%가 순차 발동한다
 *              (lastFill에서는 10%가 체결되면 앵커가 이동해 20%가 원 기준 −28%가 되어야 닿는다).
 */
export type BtAnchorSource = 'lastFill' | 'lastRebal';

export interface BtDip {
  enabled: boolean;
  /** 매수 시그널 단계(가격 고점 대비 낙폭). */
  levels: BtDipLevel[];
  /** 매도 시그널 단계(가격 저점 대비 반등). 기본 [] = 매도 시그널 없음. */
  sellLevels: BtSellLevel[];
  /** 매매 예수금이 모자랄 때 ②(다른 종목의 목표 초과분 매도)로 재원을 마련할지. 기본 true. */
  reallocate: boolean;
  /**
   * 고점/저점 축을 쓸지. 기본 true = 종전 동작.
   * ⚠️ 이 스위치가 없으면 `enabled`를 켜는 순간 `normalizeDipLevels`가 기본 3단계를 복원해
   *    고점 축이 **항상** 함께 무장된다 — 앵커 축만 쓰려는 사용자가 끌 방법이 없다.
   *    (`normalizeDipLevels`의 기본값 복원 규칙 자체는 '켰는데 아무 일도 안 함'을 막는 장치라 유지한다.)
   */
  extremeOn: boolean;
  /** 앵커 축 매수 단계(앵커 대비 하락%). 기본 [] = 미사용. */
  anchorLevels: BtAnchorLevel[];
  /** 앵커 축 매도 단계(앵커 대비 상승%). 기본 [] = 미사용. */
  anchorSellLevels: BtAnchorLevel[];
  /** 앵커 기준 소스. 기본 'lastFill'. */
  anchorSource: BtAnchorSource;
}

/**
 * 연간 가드레일 증액.
 * 시작일로부터 everyMonths개월이 지난 뒤 도래하는 달의 **첫 정기 리밸런싱일**에,
 * 생활비 예약금(reserve)을 뺀 잉여 현금의 value%만큼 종목 목표금액을 올린다(이후 매 everyMonths개월 반복).
 *
 * ⚠️ 매월 증액(contribution)과 **완전히 독립**이다. 같은 날 겹치면 **contribution 먼저 → annualReview 나중**
 *    (KIND_ORDER가 contrib < annual 로 고정).
 * ⚠️ **목표 금액 모드 전용**이다 — 비중 모드는 목표가 '종목 평가액 합계 × 비중'이라 올릴 대상이 없다
 *    (contribution과 같은 이유로 조기 반환 + 경고. 화면에서도 비활성화한다).
 * ⚠️ reserve는 **이 증액의 재원에서 제외**될 뿐 예수금의 하한이 아니다 — 증액액만 surplus(=cash−reserve)로
 *    잘린다. 기존 목표를 복원하는 평소 매수는 예약금이든 아니든 그냥 예수금을 쓴다.
 *    예수금 자체에 하한을 두려면 **`cashFloorPct`(현금 바닥선)** 를 쓸 것(그쪽이 매수 자체를 자른다).
 */
export interface BtAnnualReview {
  mode: 'none' | 'pctOfSurplus';
  /** 잉여 현금의 N% */
  value: number;
  /** 생활비 예약금(원) — 이 증액의 재원에서 제외한다(예수금 하한은 cashFloorPct가 담당). */
  reserve: number;
  /** 반복 주기(개월). 기본 12 */
  everyMonths: number;
  /** ratio=현재 목표금액 비율대로 배분 / even=대상 종목에 균등 배분 */
  split: 'ratio' | 'even';
}

/* ── 시나리오 평가 · 메모 (결과에 전혀 영향을 주지 않는 **기록 전용** 필드) ─────────────
 * ⚠️ runBacktest는 이 두 필드를 **읽지 않는다**. 읽는 순간 "메모를 고쳤더니 수익률이 달라졌다"가
 *    되어 기록으로서의 신뢰가 사라진다(검증 #262가 결과 불변을 단언한다).
 * =========================================================================== */

/** 평가 등급. 'none' = 아직 평가하지 않음(레거시·신규 기본값). */
export type BtRating = 'good' | 'watch' | 'bad' | 'none';

/**
 * 시나리오 한 줄 결론 — 결과 화면 표제 바로 아래(= 헤더 상단)에 항상 보이고 PDF에도 그대로 실린다.
 * ⚠️ updatedAt은 지문에서 제외한다(커밋 시각만 바뀌어도 Drive 저장이 재트리거되는 것 방지 — flowFingerprint 규약).
 */
export interface BtReview {
  rating: BtRating;
  /** 한 줄 결론. 길면 카드가 표제를 밀어내므로 MAX_BT_VERDICT_LEN에서 자른다. */
  verdict: string;
  updatedAt: number;
}

/**
 * 메모가 **어떤 조건에서 나온 평가인가**를 박제한 스냅샷.
 *
 * AI 분석은 특정 설정의 결과를 두고 쓴 글이라, 나중에 설정을 바꾸면 그 글이 조용히 거짓이 된다.
 * → 작성 시점의 조건 요약(사람이 읽는 문장)과 **설정 지문**을 함께 남기고, 지금 설정과 지문이
 *   다르면 화면에 '설정이 바뀌었습니다' 배지를 띄운다(조용한 오적용보다 명시적 고지).
 *
 * ⚠️ fp는 반드시 `backtestSettingsFingerprint`(결과에 영향 주는 필드만)로 만든다.
 *    `backtestFingerprint`를 쓰면 그 지문에 notes 자신이 들어가 있어, 메모를 추가하는 순간
 *    지문이 달라져 **모든 메모가 영구히 '설정이 바뀜'으로 표시**된다.
 */
export interface BtNoteSnapshot {
  /** 작성 시점 조건 요약(한 줄) */
  conditions: string;
  /** 작성 시점 설정 지문 — 현재 설정과 같은지 판정하는 데만 쓴다(표시 전용) */
  fp: string;
  /** 작성 시점 헤드라인 결과. 실행 불가였으면 null */
  finalTotal: number | null;
  profit: number | null;
  profitRate: number | null;
  /** 'YYYY-MM-DD ~ YYYY-MM-DD' */
  period: string;
}

/** 메모 한 건. kind='ai'는 AI 분석 붙여넣기, 'user'는 직접 쓴 메모(라벨만 다르다). */
export interface BtNote {
  id: string;
  kind: 'ai' | 'user';
  title: string;
  /** 본문(긴 AI 분석). MAX_BT_NOTE_LEN에서 자른다 — STATE는 백업 22본으로 복제된다. */
  body: string;
  snapshot: BtNoteSnapshot;
  createdAt: number;
  updatedAt: number;
}

export interface BtConfig {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /**
   * 초기 투자금(원) — **초기에 종목을 전부 매수하는 데 쓰는 돈**. 초기 매수의 예산 상한이자
   * 비중 모드 분모다. 1주 단위로 딱 떨어지지 않아 남는 잔돈은 자동으로 예수금이 된다.
   */
  initialCapital: number;
  /**
   * 추가(초기) 예수금 — 초기 투자금과 **별개**로 들고 시작할 현금(선택, 기본 0).
   *
   * ⚠️ **초기 매수에 쓰지 않는다**(사용자 확정 2026-08). 매매 시그널·정기 리밸런싱이 쓸 수 있게
   *    예수금(cashTrade)으로 남겨 둔다. 옛 코드는 초기 매수 예산·비중 분모를
   *    `initialCapital + extraCash`로 잡아 이 돈을 첫날 다 써 버렸다.
   * ⚠️ `extraCash === 0`이면 결과가 종전과 1원도 다르지 않다(하위호환).
   */
  extraCash: number;
  targetMode: BtTargetMode;
  rounding: BtRounding;
  /**
   * 정기 리밸런싱 스위치(③ 체크박스). 기본 true = 종전 동작.
   *
   * ⚠️ **`policy`를 덮어쓰지 말 것** — 체크를 끌 때 `policy:'none'`으로 바꾸면 사용자가 고른
   *    '월말 일괄'이 조용히 사라진다(백테스트는 undo가 없다). 이 플래그만 내리고 policy는 보존한다.
   * ⚠️ 레거시 `policy:'none'`과 **결과가 같아야** 한다 — `resolveAssetRebal`이 둘 다 mode:'none'으로
   *    떨어뜨리고, '수량 고정' 경고 게이트도 둘을 같이 봐야 한다(안 그러면 같은 뜻의 두 설정이
   *    경고 개수가 달라진다 — 검증 #116 계약).
   * ⚠️ 종목별로 일정을 지정한 종목(`rebalMode !== 'follow'`)은 이 스위치와 무관하게 그 지정을 따른다.
   * ⚠️ 전역 지정일(`rebalDates`)도 이 스위치와 무관하다 — 정기와 독립된 축이다.
   */
  regularOn: boolean;
  policy: BtPolicy;
  /** policy='fixedDay'일 때 매월 며칠(1~31) */
  fixedDay: number;
  /**
   * 전역 **지정일 리밸런싱** — 정기 정책에 **추가**되는 날짜 목록
   * ('YYYY-MM-DD', 휴장이면 직전 영업일로 스냅). 기본 [] = 없음(종전 동작).
   *
   * ⚠️ `rebalMode === 'follow'` 종목에만 걸린다 — 월별 **일괄** 오버라이드와 같은 규약이다.
   *    종목별로 일정을 따로 지정한 종목까지 끌고 가면 "일괄과 별개로 종목을 다르게"라는 기존
   *    계약이 깨지고, '이 종목은 리밸런싱 안 함'으로 둔 종목이 지정일 하나로 그 설정을 잃는다.
   *    특정 종목만 그 날짜에 넣고 싶으면 그 종목의 `rebalMode:'dates'`를 쓴다.
   * ⚠️ 정기 정책과 **완전히 독립**이다 — 정기를 꺼도(policy:'none') 지정일은 그대로 돈다.
   *    그래서 buildSlots에서 `r.mode==='none'` continue보다 **앞**에서 만들어야 한다.
   * ⚠️ 분배 일정(buildDividendSlots)은 이 값을 보지 않는다 — 분배락·지급일은 시장이 정한다.
   */
  rebalDates: string[];
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
  /* ── 평가금 고정 전략 보조 규칙 (전부 기본값 = 종전 동작) ────────────────────
   * ⚠️ 여기 6개는 **정기 리밸런싱에만** 걸린다. 초기 매수·이벤트(구조 변경)·분배금 재투자는
   *    종전 규약 그대로다 — 새 옵션이 그쪽까지 번지면 PDF 재현(#23~#42)이 깨진다.
   * =========================================================================== */
  /**
   * 리밸런싱 밴드(%). 기본 0 = 밴드 없음(종전 동작).
   * `|리밸런싱 전 평가액 − 목표금액| ≤ 목표금액 × band/100` 이면 **그 종목의 그 회차 매매를 생략**한다.
   * ⚠️ 목표가 0(전량 청산)인 종목은 밴드와 무관하게 항상 실행한다.
   */
  band: number;
  /** 정기 리밸런싱 매수의 재원. 기본 'both'(매매 → 분배금 순 = 종전 동작). */
  buyFunding: BtBuyFunding;
  /** 급락 분할투입. 기본 enabled:false. */
  dip: BtDip;
  /**
   * 현금 바닥선(%). 기본 0 = 바닥선 없음.
   * 바닥선 금액 = **그 시점 활성 종목 목표금액 합계 × pct/100**.
   * 정기 리밸런싱 매수(급락 개방 매수 포함)가 끝난 뒤 총 예수금이 이 아래로 내려가지 않도록 매수액을 줄인다.
   * ⚠️ **allowNegativeCash보다 우선**한다(바닥선이 0보다 크면 음수 예수금 진입 불가).
   * ⚠️ 매도·분배금 재투자에는 적용하지 않는다.
   */
  cashFloorPct: number;
  /** 연간 가드레일 증액. 기본 mode:'none'. */
  annualReview: BtAnnualReview;
  /**
   * 분배금 원천징수율(%). 기본 0 = 종전 동작.
   * ⚠️ **현금 흐름만 세후로 바꾼다** — divAccrued(분배락 기준 권리 확정액)는 세전 그대로 두고,
   *    지급일에 입금되는 divPaid를 세후로 정의한다(BtMonth.divPaid 주석의 항등식 참조).
   */
  divTaxPct: number;
  /**
   * 시나리오 결과 평가(한 줄 결론 + 등급). 기본 `{rating:'none', verdict:'', updatedAt:0}`.
   * ⚠️ 결과에 영향을 주지 않는 기록 전용 필드지만, 사용자가 쓴 글이라 **반드시 지문에 포함**한다
   *    — 빠지면 "평가만 고친 세션이 Drive에 저장되지 않는다"(historyVerifyKey·investmentNotesKey류).
   */
  review: BtReview;
  /** 시나리오별 메모(AI 분석 등). 기본 []. 지문 포함 규약은 review와 동일. */
  notes: BtNote[];
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
/** 매수 시그널(급락) 단계 수 상한 */
export const MAX_BT_DIP_LEVELS = 5;
/** 앵커 축 단계 수 상한(매수·매도 각각) */
export const MAX_BT_ANCHOR_LEVELS = 5;
/** 매도 시그널(반등) 단계 수 상한 */
export const MAX_BT_SELL_LEVELS = 5;
/**
 * 시나리오당 메모 수 / 본문 길이 / 제목 길이 / 한 줄 결론 길이 상한.
 * ⚠️ 상한 없이 긴 텍스트를 허용하지 말 것 — STATE는 백업 22본으로 복제되고, `backtest:live`
 *    브릿지가 시세 조회 한 건이 끝날 때마다 시나리오 전량을 새 창으로 재직렬화한다.
 * ⚠️ 화면 textarea/input에도 **같은 값으로 maxLength**를 걸어 잘림이 사용자에게 보이게 할 것
 *    — 정규화에서만 자르면 붙여넣은 분석이 조용히 뒤가 잘린다.
 */
export const MAX_BT_NOTES = 12;
export const MAX_BT_NOTE_LEN = 8000;
export const MAX_BT_NOTE_TITLE_LEN = 80;
export const MAX_BT_VERDICT_LEN = 200;

/**
 * 매수 시그널 기본 단계 — 고점 대비 −10%/−20%/−30%에서 매수 재원을 34/33/33%씩 투입한다.
 * ⚠️ `dip.enabled=false`(기본)면 이 값이 들어 있어도 **아무 일도 일어나지 않는다** — 토글을 켰을 때
 *    바로 쓸 수 있게 기본값을 채워 둘 뿐이다.
 */
export const DEFAULT_DIP_LEVELS: BtDipLevel[] = [
  { drop: 10, buyPct: 34 },
  { drop: 20, buyPct: 33 },
  { drop: 30, buyPct: 33 },
];

/**
 * 매도 시그널 기본 단계 — 저점 대비 +10%/+20%에서 목표 초과분을 판다.
 * ⚠️ 매수(levels)와 달리 **기본값이 채워져 있어도 `sellLevels: []`가 정상**이다 — 이 상수는
 *    사용자가 '매도 시그널 추가' 버튼을 눌렀을 때 시드로만 쓴다(빈 배열 = 매도 시그널 없음).
 *    그래서 normalizeSellLevels는 빈 배열을 기본값으로 되돌리지 **않는다**(매수 쪽과 반대).
 */
export const DEFAULT_SELL_LEVELS: BtSellLevel[] = [
  { rise: 10, sellPct: null },
  { rise: 20, sellPct: null },
];

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
  /**
   * 시그널 리밸런싱으로 발생한 매매인가(표시 전용 라벨).
   *  buy     — 매수 시그널(가격 고점 대비 낙폭)이 발동해 목표까지 채운 매수
   *  sell    — 매도 시그널(가격 저점 대비 반등)이 발동해 목표까지 줄인 매도
   *  realloc — 매수 시그널의 재원을 마련하려고 목표 초과분을 판 **다른 종목**의 매도
   *
   * ⚠️ `note`를 덮어쓰지 말 것 — 화면(`BacktestPage`)이 `t.note === '바닥선'` / `'예수금 부족'`
   *    **정확 일치**로 툴팁을 고르므로, 시그널 라벨을 note에 접두어로 붙이면 그 툴팁이 죽는다.
   *    그래서 별도 필드로 둔다(값이 없으면 종전과 100% 동일).
   * ⚠️ 집계상으로는 **평범한 정기 매매**다 — tradeNet에 그대로 들어간다(structural·reinvest와
   *    달리 따로 세지 않는다). 기말 예수금 분해 항등식(#125)에 새 항이 생기지 않는 이유다.
   */
  signal?: 'buy' | 'sell' | 'realloc';
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
  /** ⚠️ 'pctOfSurplus'는 **연간 가드레일 증액**(annualReview) 전용이다. */
  mode: 'pctOfCash' | 'amount' | 'pctOfSurplus';
  value: number;
  /** 그 달 전용 규칙이 적용됐는가 */
  overridden: boolean;
  perAsset: { assetId: string; code: string; name: string; added: number; targetAfter: number }[];
  note: string;
  /** annualReview 전용 — 그때 남겨 둔 생활비 예약금(표시용). */
  reserve?: number;
}

/**
 * 시그널 리밸런싱 발동 1건 — **화면이 계산식을 그대로 재현할 수 있도록** 밑변까지 남긴다.
 * (사용자 요청: "`1단계 · 매수 재원 ₩A × 34% = ₩B` 처럼 상세히 표시")
 */
export interface BtSignalEvent {
  /** 발동일(그 종가로 단계에 처음 도달한 날). **체결일과 같다**(당일 종가로 즉시 실행). */
  date: string;
  assetId: string;
  code: string;
  name: string;
  /** buy=매수 시그널(낙폭) / sell=매도 시그널(반등) */
  kind: 'buy' | 'sell';
  /** 1부터 시작하는 단계 번호(작은 낙폭·작은 반등이 1단계) — 화면의 "1단계" 표기용. */
  step: number;
  /** 발동 단계 값 = 기준가 대비 낙폭(%) 또는 상승률(%) */
  level: number;
  /**
   * 어느 축이 발동시켰는가. extreme=전 구간 가격 고점/저점 / anchor=직전 체결 종가.
   * ⚠️ 화면 `sigRefText`는 **이 값으로** 기준 문구를 고른다 — `kind`만 보고 '고점'/'저점'을 찍으면
   *    앵커 발동이 존재한 적 없는 고점을 근거로 제시하는 명백한 거짓말이 된다.
   */
  axis: 'extreme' | 'anchor';
  /** 앵커 축일 때 그 앵커를 만든 체결일(어느 체결이 기준인지 확인할 유일한 수단). extreme이면 ''. */
  anchorDate: string;
  /**
   * 이 **단계 하나**의 비율(%). 매수=매수 재원의 %, 매도=목표 초과분의 %.
   * `null`이면 '목표까지'(매수=목표 미달액 전부 / 매도=목표까지 전량).
   */
  pct: number | null;
  /**
   * 같은 종목·같은 날 겹친 단계들의 **대표 행인가**. 규모·체결·재원은 이 행에만 합산해 싣는다.
   * ⚠️ 화면은 이 플래그로 계산식 줄을 그릴지 정한다 — `planned > 0` 같은 값으로 대신 판정하지 말 것.
   *    비율 0%·목표 이하·재원 0원이라 금액이 0인 대표 행이야말로 "왜 0원인가"를 설명해야 하는 행이다.
   */
  carrier: boolean;
  /**
   * `planned`를 만든 비율의 **합**(carrier에만 채운다. 같은 종목 여러 단계가 같은 날 겹칠 때 합산).
   * ⚠️ 화면 계산식(`밑변 × 비율 = 금액`)은 반드시 이 값을 써야 산술적으로 성립한다 —
   *    단계별 `pct`를 쓰면 `₩1,000,000 × 34% = ₩670,000` 같은 거짓 계산식이 찍힌다.
   * ⚠️ 하나라도 '목표까지'가 섞이면 그 종목은 그날 목표까지로 처리하므로 여기도 `null`이다.
   */
  pctSum: number | null;
  /**
   * 매수 전용 — 발동 시점 **매수 재원 스냅샷**(계산식의 밑변).
   * `buyFunding:'tradeOnly'`면 매매 예수금, `'both'`면 예수금 전부(매매+적립 분배금).
   * ⚠️ 매도 시그널 처리 뒤·재조정 앞 값이다(BtDip 주석 참조). 매도 이벤트는 0.
   */
  poolAt: number;
  /** 매도 전용 — 발동 시점 **목표 초과 평가액**(계산식의 밑변). 매수 이벤트는 0. */
  excessAt: number;
  /** 비율·목표 상한을 적용한 뒤의 **목표 매매금액**(반올림 전). 실제 체결은 tradeAmount. */
  planned: number;
  /** 발동 시점 적립 분배금 잔액(표시용). */
  divPocketAt: number;
  /** 발동 시점 매매 예수금 잔액 — "이 돈으로 먼저 산다"의 밑변. */
  cashTradeAt: number;
  /** 매수 대금 중 **적립 분배금에서 나간** 몫(`buyFunding:'tradeOnly'`면 항상 0). */
  used: number;
  /** 발동 시점의 기준 극값 — buy=가격 고점 / sell=가격 저점 */
  ref: number;
  /** 발동일 종가 */
  price: number;
  /** 그 시그널로 실제 체결된 수량(+매수 / −매도). 0이면 체결 없음. */
  tradeQty: number;
  /** 그 시그널로 실제 체결된 금액(절댓값). */
  tradeAmount: number;
  /** 매수 대금 중 매매 주머니에서 나간 몫(음수 예수금 포함). */
  fromTrade: number;
  /**
   * 매수 대금 중 **예비금**에서 나간 몫(시그널 전용 재원).
   * ⚠️ 화면 `sigFundText`가 `fromTrade + fromReserve + used = tradeAmount`를 **산술식으로** 찍으므로
   *    이 항이 없으면 화면에 틀린 등식이 그대로 렌더된다.
   */
  fromReserve: number;
  /**
   * ②(다른 종목 목표 초과분 매도)로 **그날** 마련한 재원 총액.
   * ⚠️ 날짜 단위 값이라 그날 첫 매수 이벤트에만 싣는다(같은 날 여러 이벤트에 중복 표시하지 않기 위해).
   */
  reallocAmount: number;
  /** 체결이 없었거나 잘린 사유(표시용). */
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
   * ⚠️ **원천징수(divTaxPct)를 뺀 세후 금액**이다(2026-08). 세전 권리 확정액은 divAccrued가,
   *    세금은 divTax가 따로 센다. 이 정의라야 기말 예수금 분해 항등식이 종전 그대로 성립한다:
   *      finalCash = initialCashAfter + cumTradeNet + cumStructuralNet + cumReinvestNet + cumDivPaid
   */
  divPaid: number;
  cumDivPaid: number;
  /** 그 달 원천징수된 분배금 세금(세전 − 세후). divTaxPct=0이면 항상 0. */
  divTax: number;
  cumDivTax: number;
  /** 그 달까지 누적 재투자 매수 대금(≤ 0) */
  cumReinvestNet: number;
  /** 그 달 현금 증감 (정기차익 + 구조매매 + 분배금 재투자 + 입금 분배금) */
  cashDelta: number;
  /** 월말 시점 예수금 */
  cashEnd: number;
  /** 월말 예수금 중 매매(리밸런싱 차익) 몫. cashTradeEnd + cashDivEnd = cashEnd */
  cashTradeEnd: number;
  /** 월말 예수금 중 **예비금** 몫. cashTradeEnd + cashDivEnd + cashReserveEnd = cashEnd */
  cashReserveEnd: number;
  /** 월말 예수금 중 아직 쓰지 않은 누적 분배금 몫 */
  cashDivEnd: number;
  /**
   * 그 달 **매수 대금**을 어느 주머니에서 꺼냈는지 (합 = 그 달 총 매수 대금, 매도는 제외).
   * ⚠️ 누적 매매차익이 마이너스인 달에 "이 매수를 무엇으로 충당했는가"를 답하는 값이다.
   */
  cashUsedTrade: number;
  cashUsedDiv: number;
  /** 그 달 매수 대금 중 **예비금**에서 나간 몫(시그널 발동분). */
  cashUsedReserve: number;
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
  /** 그 달 실행된 **연간 가드레일 증액**(없으면 null). contribution과 완전히 별개다. */
  annualReview: BtContribRow | null;
  /** 그 달까지 누적 연간 증액 총액 */
  cumAnnualReview: number;
  /** 그 달 리밸런싱 밴드로 **생략한** 매매 건수 / 생략된 매매 예정 금액(절댓값 합) */
  bandSkipCount: number;
  bandSkipAmount: number;
  /**
   * 그 달 매수가 재원 한도로 잘린 건수('예수금 부족'·'바닥선').
   * ⚠️ 잘려서 수량이 0이 되면 거래 행 자체가 남지 않으므로, 표에서 사라지는 부족을 여기서 센다.
   */
  shortfallCount: number;
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
  /** 실행된 연간 가드레일 증액 목록(시간순). 월별로도 BtMonth.annualReview에 실린다. */
  annualRows: BtContribRow[];
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
    /**
     * 실제 입금된 누적 분배금(지급일 기준, **세후**). 기말 예수금에 반영된 값.
     * ⚠️ `cumDivAccrued − cumDivPaid`를 세금으로 읽지 말 것 — 그 차이에는 **지급일이 종료일 이후라
     *    아직 현금이 되지 않은 몫**도 섞여 있다(월말 사이클은 마지막 달이 항상 그렇다).
     *    정확히는 `cumDivAccrued = cumDivPaid + cumDivTax + 미지급 세전분` 이다.
     *    따라서 화면의 '아직 미지급'은 반드시 `cumDivAccrued − cumDivPaid − cumDivTax`로 구한다.
     */
    cumDivPaid: number;
    /** 원천징수된 누적 분배금 세금. divTaxPct=0이면 0. */
    cumDivTax: number;
    /** 매월 증액(재투자)으로 목표에 더한 누적 금액 */
    cumContribution: number;
    /** 연간 가드레일 증액으로 목표에 더한 누적 금액 */
    cumAnnualReview: number;
    /**
     * 기말 **예수금**(매매 몫) / **적립 분배금**(미사용 분배금 몫). 합 = finalCash.
     *
     * ⚠️ 사용자 정의(2026-08): '예수금'은 `매매차익 + 초기 매수 잔여 + 추가 예수금`만 가리키고
     *    분배금은 **합산하지 않는다**. 화면·CSV는 두 값을 나란히 따로 표시한다.
     *
     * ⚠️ 원천별 분해 항등식 **2개**(화면 '기말 보유 현황' 표가 그대로 렌더한다):
     *      finalCashTrade = (initialCashAfter − extraCash) + cumTradeNet + cumStructuralNet
     *                       + cumReinvestNet + cumDivDrawn + cumReserveDrawn
     *      finalCashDiv   = cumDivPaid − cumDivDrawn
     *      finalCashReserve = extraCash − cumReserveDrawn
     * ⚠️ 예비금 주머니가 생기면서 cashTrade의 시드가 initialCapital로 줄었다(−extraCash).
     *    예비금이 대신 낸 매수 대금만큼 cashTrade가 덜 나갔으므로 +cumReserveDrawn이 붙는다.
     *    두 식을 더하면 종전 항등식이 그대로 복원된다(검증 #110):
     *      finalCash = initialCashAfter + cumTradeNet + cumStructuralNet + cumReinvestNet + cumDivPaid
     *    분배금은 반드시 **지급 기준(cumDivPaid)** — 분배락 기준(cumDivAccrued)에는 아직 현금이
     *    되지 않은 몫이 섞여 항등식이 깨진다.
     */
    finalCashTrade: number;
    finalCashDiv: number;
    /** 기말 예수금 중 **예비금** 잔액 = extraCash − Σ cashUsedReserve */
    finalCashReserve: number;
    /**
     * 매수 대금 중 **적립 분배금 주머니에서 꺼낸** 누적 총액(≥ 0) = Σ `BtMonth.cashUsedDiv`.
     * ⚠️ 위 분해 항등식 2개를 성립시키는 연결 항이다. 예수금 쪽에 `+`로 들어가는 이유는
     *    "분배금이 대신 낸 매수 대금만큼 매매 예수금이 덜 나갔다"이기 때문.
     * ⚠️ `buyFunding:'tradeOnly'`면 분배금 재투자(divReinvest) 매수 외에는 0이다.
     */
    cumDivDrawn: number;
    /** 시그널이 예비금에서 인출한 누적액 = extraCash − finalCashReserve */
    cumReserveDrawn: number;
    /** 최고 자산 대비 최대 낙폭(%) */
    maxDrawdown: number;
    months: number;
    /* ── 평가금 고정 전략 생존 판정 지표 ─────────────────────────────────── */
    /**
     * 영업일 곡선(curve) 기준 **총 예수금 최저점**과 그 날짜.
     * ⚠️ 이 전략(목표 평가금 고정 + 하락 시 매수)의 생존 판정 핵심 지표다 — 여기가 0에 붙으면
     *    그 시점부터 목표를 복원하지 못한다.
     */
    minCash: { value: number; date: string };
    /**
     * 분배금 주머니(cashDiv) 최저점과 그 날짜.
     * ⚠️ cashDiv는 0에서 시작하므로 **첫 분배금 입금 이후** 구간에서만 잰다(안 그러면 항상 0).
     *    분배금이 한 번도 없으면 `{0, ''}`.
     */
    minCashDiv: { value: number; date: string };
    /**
     * 월별 divAccrued(분배락 기준)의 평균 / 모표준편차.
     * ⚠️ 구간은 **첫 분배가 있었던 달부터 마지막 달까지**(연속) — 앞쪽 램프업 달을 빼되
     *    이후의 진짜 0원 달('분배가 끊겼다')은 그대로 포함해야 변동성이 드러난다.
     */
    divMonthlyAvg: number;
    divMonthlyStdev: number;
    /** 리밸런싱 밴드로 생략한 총 건수 / 총 매매 예정 금액 */
    bandSkipCount: number;
    bandSkipAmount: number;
    /** 시그널 리밸런싱(매수·매도) 발동 로그(시간순). 발동일 = 체결일. */
    signalEvents: BtSignalEvent[];
    /** 매수가 재원 한도('예수금 부족'·'바닥선')로 잘린 달의 수 */
    shortfallMonths: number;
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
 * 'YYYY-MM'에 n개월을 더한다(n≥0). 연간 가드레일 증액의 도래월 계산용.
 * ⚠️ 날짜가 아니라 **월** 산술이다 — 말일 보정 같은 함정이 없다.
 */
export function addMonthsToYm(ym: string, n: number): string {
  if (!/^\d{4}-\d{2}$/.test(ym) || !Number.isFinite(n)) return '';
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7) + Math.trunc(n);
  const ny = y + Math.floor((m - 1) / 12);
  const nm = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${ny}-${pad2(nm)}`;
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

/**
 * 전역 지정일 정규화 — 유효 날짜만 + 중복 제거 + 정렬 + 상한.
 * ⚠️ **빈 배열을 보존한다**(기본값 복원 금지) — 지정일은 '안 쓰는 것'이 정상 상태이고,
 *    되살리면 레거시 시나리오에 없던 리밸런싱이 생겨 결과가 달라진다(normalizeSellLevels와 같은 규약).
 * ⚠️ 정렬·dedupe가 있어야 **멱등**이다(#237) — 매 정규화가 새 순서를 내면 Drive 폴링마다
 *    재저장되고 BacktestPage 시드 effect가 2.5초 idle 승격 전의 편집을 갈아엎는다.
 */
function normalizeRebalDates(raw: unknown): string[] {
  return Array.from(new Set(asArr(raw).filter(isIsoDate))).sort().slice(0, MAX_BT_REBAL_DATES);
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
    // ⚠️ 레거시(필드 부재)는 반드시 true — 명시적 false만 정기를 끈다.
    regularOn: partial.regularOn !== false,
    policy:
      policy === 'allMid' || policy === 'allEom' || policy === 'fixedDay' || policy === 'none'
        ? policy : 'perCycle',
    fixedDay: clampInt(asNum(partial.fixedDay, 15), 1, 31),
    // ⚠️ 화이트리스트 재구축기라 여기 등록을 빠뜨리면 Drive 로드·백업 복원·별도 창 수신·
    //    시나리오 복제 4경로에서 지정일이 통째로 사라진다.
    rebalDates: normalizeRebalDates(partial.rebalDates),
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
    // ── 전략 보조 규칙 ──
    // ⚠️ 전부 '기본값 = 종전 동작'이어야 한다(레거시 시나리오 결과 불변).
    band: Math.max(0, asNum(partial.band, 0)),
    buyFunding: partial.buyFunding === 'tradeOnly' ? 'tradeOnly' : 'both',
    dip: normalizeDip(partial.dip),
    cashFloorPct: Math.max(0, asNum(partial.cashFloorPct, 0)),
    annualReview: normalizeAnnualReview(partial.annualReview),
    divTaxPct: Math.min(100, Math.max(0, asNum(partial.divTaxPct, 0))),
    // ── 평가 · 메모 (기록 전용) ──
    // ⚠️ makeBtConfig는 **화이트리스트 재구축기**라 여기 등록하지 않으면 네 경로에서 통째로 사라진다:
    //    Drive 로드(applyStateData) · 백업 복원 · 별도 창 수신(normalizeBacktestScenarios) ·
    //    **시나리오 복제**(BacktestPage addScenario는 makeBtConfig로 사본을 만든다).
    review: normalizeReview(partial.review),
    notes: asArr(partial.notes).slice(0, MAX_BT_NOTES).map(normalizeNote),
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

/**
 * 단계 비율(%) 정규화. **`null`(= 목표까지)을 1급 값으로 다룬다.**
 * ⚠️ 숫자가 아니거나 범위를 벗어나면 null이 아니라 0~100으로 **클램프**한다 — 150을 적었다고
 *    조용히 '목표까지'로 바뀌면 사용자가 이유를 알 수 없다(빈칸만 목표까지다).
 * ⚠️ `asNum`은 `typeof v === 'number'`만 통과시키므로 `null`/`''`/문자열은 전부 여기서 걸린다.
 */
const asPctOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = asNum(v, NaN);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
};

/**
 * 매수 시그널 단계 정규화 — 낙폭 오름차순 + 중복 낙폭 제거 + 상한.
 * ⚠️ 유효한 단계가 하나도 없으면 **기본 3단계로 되돌린다** — 'enabled인데 단계 0개'는 조용히
 *    아무 일도 안 하는 상태라, 사용자가 켜 놓고 이유를 알 수 없게 된다.
 * ⚠️ 비율이 손상돼도 **행을 버리지 않는다**(옛 코드는 필터로 지웠다) — 사용자가 적은 낙폭이
 *    조용히 사라지는 것이 가장 나쁜 실패다. 비율만 치유한다.
 */
function normalizeDipLevels(raw: unknown): BtDipLevel[] {
  const arr = asArr(raw)
    .map((l: any) => ({
      drop: asNum(l?.drop, NaN),
      // ⚠️ 레거시 마이그레이션 — 옛 필드 `unlockPct`('적립 분배금 개방 비율')의 값을 승계한다.
      //    단 **0은 null(목표까지)로** 옮긴다: 옛 '단계 추가' 버튼이 0을 넣었고, 옛 의미로 0은
      //    '분배금을 안 연다'(= 매매 예수금으로 목표까지 매수)였다. 0을 그대로 두면 새 의미에서
      //    '재원의 0%' = **한 주도 안 사는** 단계로 뒤집힌다.
      buyPct: l?.buyPct !== undefined
        ? asPctOrNull(l.buyPct)
        : (asPctOrNull(l?.unlockPct) || null),
    }))
    .filter(l => Number.isFinite(l.drop) && l.drop > 0 && l.drop <= 100);
  if (!arr.length) return DEFAULT_DIP_LEVELS.map(l => ({ ...l }));
  arr.sort((a, b) => a.drop - b.drop);
  const seen = new Set<number>();
  const out: BtDipLevel[] = [];
  for (const l of arr) {
    if (seen.has(l.drop)) continue;
    seen.add(l.drop);
    out.push(l);
    if (out.length >= MAX_BT_DIP_LEVELS) break;
  }
  return out;
}

/**
 * 매도 시그널 단계 정규화 — 상승률 오름차순 + 중복 제거 + 상한.
 * ⚠️ 매수(normalizeDipLevels)와 달리 **빈 배열을 기본값으로 되돌리지 않는다** — 매도 시그널은
 *    "안 쓰는 것"이 정상 상태이고(레거시 시나리오는 필드 자체가 없다), 기본 단계를 밀어 넣으면
 *    **켜 놓은 적 없는 매도가 조용히 실행돼** 기존 결과가 달라진다.
 */
function normalizeSellLevels(raw: unknown): BtSellLevel[] {
  const arr = asArr(raw)
    // ⚠️ 레거시는 `sellPct` 필드가 아예 없다 → null(목표까지 전량) = **종전 동작 그대로**.
    .map((l: any) => ({ rise: asNum(l?.rise, NaN), sellPct: asPctOrNull(l?.sellPct) }))
    .filter(l => Number.isFinite(l.rise) && l.rise > 0 && l.rise <= 1000);
  arr.sort((a, b) => a.rise - b.rise);
  const seen = new Set<number>();
  const out: BtSellLevel[] = [];
  for (const l of arr) {
    if (seen.has(l.rise)) continue;
    seen.add(l.rise);
    out.push(l);
    if (out.length >= MAX_BT_SELL_LEVELS) break;
  }
  return out;
}

/**
 * 앵커 축 단계 정규화 — 오름차순 + 중복 제거 + 상한.
 * ⚠️ **빈 배열을 보존한다**(`normalizeSellLevels` 계열). `normalizeDipLevels`(빈 배열 → 기본 3단계
 *    복원)를 재사용하면 **레거시 시나리오 전부에서 앵커 축이 저절로 켜지고**, 정규화가 매번 새 배열을
 *    반환해 멱등(#237)·Drive 재저장·2.5초 idle 승격 전 편집 소실이 동시에 터진다.
 */
function normalizeAnchorLevels(raw: unknown): BtAnchorLevel[] {
  const arr = asArr(raw)
    .map((l: any) => ({ move: asNum(l?.move, NaN) }))
    .filter(l => Number.isFinite(l.move) && l.move > 0 && l.move <= 1000);
  arr.sort((a, b) => a.move - b.move);
  const seen = new Set<number>();
  const out: BtAnchorLevel[] = [];
  for (const l of arr) {
    if (seen.has(l.move)) continue;
    seen.add(l.move);
    out.push(l);
    if (out.length >= MAX_BT_ANCHOR_LEVELS) break;
  }
  return out;
}

function normalizeDip(raw: any): BtDip {
  return {
    enabled: !!raw?.enabled,
    levels: normalizeDipLevels(raw?.levels),
    sellLevels: normalizeSellLevels(raw?.sellLevels),
    // ⚠️ 레거시(필드 부재)는 extremeOn:true · 앵커 배열 [] · anchorSource:'lastFill'로 떨어져야
    //    기존 결과가 1원도 달라지지 않는다. normalizeDip은 **필드별 재구축기**라 여기 등록을
    //    빠뜨리면 Drive 로드·백업 복원·별도 창 수신·시나리오 복제 4경로에서 통째로 사라진다.
    extremeOn: raw?.extremeOn !== false,
    anchorLevels: normalizeAnchorLevels(raw?.anchorLevels),
    anchorSellLevels: normalizeAnchorLevels(raw?.anchorSellLevels),
    anchorSource: raw?.anchorSource === 'lastRebal' ? 'lastRebal' : 'lastFill',
    // ⚠️ 레거시(필드 부재)는 true로 떨어진다 — 재원이 모자랄 때 재조정으로 채우는 것이
    //    사양의 기본 동작이다(사용자 확정 2026-08). 끄려면 명시적으로 false를 저장한다.
    reallocate: raw?.reallocate !== false,
  };
}

function normalizeAnnualReview(raw: any): BtAnnualReview {
  const m = raw?.mode;
  const s = raw?.split;
  return {
    // ⚠️ 레거시(필드 부재)는 반드시 'none'으로 떨어져야 한다 — 기존 시나리오 결과가 이 기능
    //    도입만으로 1원도 달라지면 안 된다.
    mode: m === 'pctOfSurplus' ? 'pctOfSurplus' : 'none',
    value: Math.max(0, asNum(raw?.value, 0)),
    reserve: Math.max(0, asNum(raw?.reserve, 0)),
    everyMonths: clampInt(asNum(raw?.everyMonths, 12), 1, 120),
    split: s === 'even' ? 'even' : 'ratio',
  };
}

const RATINGS: BtRating[] = ['good', 'watch', 'bad', 'none'];

/** 문자열 자르기 — 상한을 넘지 않으면 **같은 참조**를 돌려준다(불필요한 지문 변화 방지). */
const cut = (v: unknown, max: number): string => {
  const s = asStr(v);
  return s.length > max ? s.slice(0, max) : s;
};

function normalizeReview(raw: any): BtReview {
  const r = raw?.rating;
  return {
    // ⚠️ 레거시(필드 부재)는 반드시 'none' / '' 로 떨어져야 한다 — 기존 시나리오가 이 기능
    //    도입만으로 '평가 있음'이 되면 아래 backtestScenariosHaveContent가 통째로 true가 되어
    //    백업 복원 경로가 영구히 막힌다.
    rating: RATINGS.includes(r) ? r : 'none',
    verdict: cut(raw?.verdict, MAX_BT_VERDICT_LEN),
    updatedAt: asNum(raw?.updatedAt, 0),
  };
}

function normalizeNoteSnapshot(raw: any): BtNoteSnapshot {
  return {
    conditions: cut(raw?.conditions, 400),
    fp: asStr(raw?.fp),
    finalTotal: asNumOrNull(raw?.finalTotal),
    profit: asNumOrNull(raw?.profit),
    profitRate: asNumOrNull(raw?.profitRate),
    period: cut(raw?.period, 40),
  };
}

/**
 * 메모 정규화.
 * ⚠️ **결정적이어야 한다** — id가 없을 때만 generateId를 부르고(그 한 번은 지문을 바꿔
 *    `changed=true`로 새 배열이 채택된 뒤 다음 패스부터 안정된다, normalizeContribOverride와 동일),
 *    createdAt/updatedAt은 지문에서 제외한다. 매 정규화가 지문을 흔들면 Drive 폴링마다 재저장되고
 *    BacktestPage의 시드 effect가 2.5초 idle 승격 전의 편집을 갈아엎는다(검증 #237).
 * ⚠️ 손상 항목도 **버리지 않는다** — 사용자가 쓴 글이라 조용한 삭제가 가장 나쁘다. 빈 문자열로 치유한다.
 */
function normalizeNote(raw: any): BtNote {
  const k = raw?.kind;
  const ts = asNum(raw?.createdAt, 0);
  return {
    id: asStr(raw?.id) || generateId(),
    kind: k === 'user' ? 'user' : 'ai',
    title: cut(raw?.title, MAX_BT_NOTE_TITLE_LEN),
    body: cut(raw?.body, MAX_BT_NOTE_LEN),
    snapshot: normalizeNoteSnapshot(raw?.snapshot),
    createdAt: ts,
    updatedAt: asNum(raw?.updatedAt, ts),
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
    (s: any) => !!s && (
      asArr(s.assets).length > 0 || asArr(s.events).length > 0 || asArr(s.overrides).length > 0
      // ⚠️ 평가·메모도 '내용'이다 — 종목을 다 지우고 분석만 남긴 시나리오(또는 종목을 넣기 전에
      //    AI 분석부터 붙여 둔 시나리오)가 백업 복원에서 조용히 사라지면 되돌릴 방법이 없다.
      // ⚠️ 단 **'값이 실제로 있는가'로만** 잰다 — `!!s.review` / `s.notes !== undefined` 같은
      //    존재 판정으로 쓰면 makeBtConfig가 모든 시나리오에 기본값을 물리므로 전부 true가 되어
      //    "빈 시나리오 1개는 내용 없음"(검증 #51) 계약이 깨지고 복원 경로가 영구히 막힌다.
      || !!asStr(s.review?.verdict).trim()
      || (s.review?.rating && s.review.rating !== 'none')
      || asArr(s.notes).some((n: any) => !!(asStr(n?.title).trim() || asStr(n?.body).trim()))
    ),
  );
}

/**
 * **결과에 영향을 주는 설정만** 투영한 지문. 메모 스냅샷의 '작성 이후 설정이 바뀌었는가' 판정 전용.
 *
 * ⚠️ 이 판정에 `backtestFingerprint`를 쓰지 말 것 — 그 지문에는 notes 자신이 들어 있어서
 *    메모를 한 건 추가하는 순간 지문이 달라지고, 그 결과 **모든 메모가 영구히 '설정이 바뀜'**
 *    으로 표시된다(배지가 상시 켜지면 진짜 변경을 알리는 기능이 죽는다).
 * ⚠️ 제외 대상: id · name · review · notes · compareOn · createdAt · updatedAt.
 *    (name과 compareOn은 표시 전용이라 바뀌어도 결과가 1원도 달라지지 않는다.)
 * ⚠️ backtestFingerprint와 같은 이유로 **절대 던지지 않는다**.
 *
 * ⚠️ **`SETTINGS_FP_SCHEMA`는 '같은 저장값의 뜻이 바뀐' 릴리스에서만 올린다**(적대적 리뷰 확정).
 *    2026-08 재정의에서 `unlockPct: 34`가 `buyPct: 34`로 이관됐는데, 지문 투영이 둘 다 `10:34`라
 *    **문자열이 완전히 동일**했다 — 사용자가 아무것도 안 건드렸는데 결과 숫자만 달라지고
 *    메모의 '설정이 바뀌었습니다' 배지는 뜨지 않아, 옛 해석으로 쓴 AI 분석이 조용히 거짓이 된다.
 *    저장 지문(`backtestFingerprint`)에는 **넣지 말 것** — 그쪽은 Drive 저장 트리거이자
 *    `normalizeBacktestScenarios`의 멱등 판정이라, 상수를 넣어도 양변에 똑같이 붙어 무의미하다.
 */
const SETTINGS_FP_SCHEMA = 2;

export function backtestSettingsFingerprint(cfg: unknown): string {
  try {
    const s: any = cfg;
    if (!s || typeof s !== 'object') return '';
    return JSON.stringify({
      v: SETTINGS_FP_SCHEMA,
      p: [
        s.startDate ?? '', s.endDate ?? '', s.initialCapital ?? 0, s.extraCash ?? 0,
        s.targetMode ?? '', s.rounding ?? '', s.policy ?? '', s.regularOn === false ? 0 : 1,
        s.fixedDay ?? 0, s.exDivOffset ?? 0, s.rebalOffset ?? 0, s.payOffset ?? 0,
        // 전역 지정일 — 슬롯을 만드는 사용자 설정이라 반드시 포함(빠지면 '지정일만 고친 세션'이 저장 안 됨)
        asArr(s.rebalDates).join(','),
        s.allowNegativeCash ? 1 : 0,
        s.divReinvest ?? '', s.divReinvestSplit ?? '',
        s.contribution?.mode ?? '', s.contribution?.value ?? 0, s.contribution?.split ?? '',
        s.band ?? 0, s.buyFunding ?? '', s.cashFloorPct ?? 0, s.divTaxPct ?? 0,
        s.dip?.enabled ? 1 : 0,
        // ⚠️ `?? ''`라야 null(목표까지)과 0(재원의 0%)이 서로 다른 지문이 된다 — 둘은 결과가 정반대다.
        asArr(s.dip?.levels).map((l: any) => `${l?.drop ?? ''}:${l?.buyPct ?? ''}`).join(','),
        asArr(s.dip?.sellLevels).map((l: any) => `${l?.rise ?? ''}:${l?.sellPct ?? ''}`).join(','),
        s.dip?.reallocate === false ? 0 : 1,
        // 앵커 축 — 축 on/off · 두 단계 목록 · 기준 소스가 전부 결과를 바꾼다
        s.dip?.extremeOn === false ? 0 : 1, s.dip?.anchorSource ?? '',
        asArr(s.dip?.anchorLevels).map((l: any) => `${l?.move ?? ''}`).join(','),
        asArr(s.dip?.anchorSellLevels).map((l: any) => `${l?.move ?? ''}`).join(','),
        s.annualReview?.mode ?? '', s.annualReview?.value ?? 0, s.annualReview?.reserve ?? 0,
        s.annualReview?.everyMonths ?? 0, s.annualReview?.split ?? '',
      ],
      c: asArr(s.contribOverrides).map((o: any) => [o?.ym ?? '', o?.mode ?? '', o?.value ?? 0]),
      a: asArr(s.assets).map((a: any) => [
        a?.id ?? '', a?.code ?? '', a?.payCycle ?? '',
        a?.targetAmount ?? null, a?.targetRatio ?? null,
        a?.startDate ?? '', a?.endDate ?? '',
        a?.rebalMode ?? '', a?.rebalDay ?? 0, asArr(a?.rebalDates).join(','),
        Object.keys(a?.divOverride ?? {}).sort().map((k) => `${k}:${a.divOverride[k]}`).join(','),
      ]),
      e: asArr(s.events).map((e: any) => [
        e?.date ?? '', e?.funding ?? '',
        asArr(e?.addAssets).join(','), asArr(e?.removeAssets).join(','),
        asArr(e?.targets).map((t: any) => `${t?.assetId ?? ''}:${t?.amount ?? ''}:${t?.ratio ?? ''}`).join('|'),
      ]),
      o: asArr(s.overrides).map((o: any) => [o?.ym ?? '', o?.group ?? '', o?.date ?? '', o?.assetId ?? '']),
    });
  } catch {
    return 'ERR';
  }
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
          s?.targetMode ?? '', s?.rounding ?? '', s?.policy ?? '', s?.regularOn === false ? 0 : 1,
          s?.fixedDay ?? 0, s?.exDivOffset ?? 0, s?.rebalOffset ?? 0, s?.payOffset ?? 0,
          // 전역 지정일 — 슬롯을 만드는 사용자 설정이라 반드시 포함
          asArr(s?.rebalDates).join(','),
          s?.allowNegativeCash ? 1 : 0,
          // 분배금 처리 — 결과를 통째로 바꾸는 사용자 설정
          s?.divReinvest ?? '', s?.divReinvestSplit ?? '',
          // 비교 종합 포함 여부 — 결과에는 영향이 없지만 사용자가 고른 조합이라 저장한다
          s?.compareOn === false ? 0 : 1,
          // 매월 증액 규칙 — 결과를 통째로 바꾸는 사용자 설정이라 반드시 지문에 포함
          s?.contribution?.mode ?? '', s?.contribution?.value ?? 0, s?.contribution?.split ?? '',
          // 전략 보조 규칙(밴드·재원·바닥선·원천징수) — 전부 결과를 바꾸므로 반드시 포함
          s?.band ?? 0, s?.buyFunding ?? '', s?.cashFloorPct ?? 0, s?.divTaxPct ?? 0,
          // 시그널 리밸런싱 — 단계 목록까지 포함해야 단계만 고친 편집이 저장된다
          s?.dip?.enabled ? 1 : 0,
          asArr(s?.dip?.levels).map((l: any) => `${l?.drop ?? ''}:${l?.buyPct ?? ''}`).join(','),
          asArr(s?.dip?.sellLevels).map((l: any) => `${l?.rise ?? ''}:${l?.sellPct ?? ''}`).join(','),
          s?.dip?.reallocate === false ? 0 : 1,
          // 앵커 축 — 단계만 고친 편집도 저장돼야 한다
          s?.dip?.extremeOn === false ? 0 : 1, s?.dip?.anchorSource ?? '',
          asArr(s?.dip?.anchorLevels).map((l: any) => `${l?.move ?? ''}`).join(','),
          asArr(s?.dip?.anchorSellLevels).map((l: any) => `${l?.move ?? ''}`).join(','),
          // 연간 가드레일 증액
          s?.annualReview?.mode ?? '', s?.annualReview?.value ?? 0, s?.annualReview?.reserve ?? 0,
          s?.annualReview?.everyMonths ?? 0, s?.annualReview?.split ?? '',
          // 시나리오 평가 — 결과에는 영향이 없지만 **사용자가 쓴 글**이라 반드시 포함한다
          // (빠지면 '평가만 고친 세션'이 Drive에 저장되지 않는다). updatedAt은 제외.
          s?.review?.rating ?? '', s?.review?.verdict ?? '',
        ],
        // ⚠️ 메모는 **본문 전문**을 넣는다 — 길이·개수 해시 절충안은 '본문만 고치면 저장 안 됨'
        //    (investmentNotesKey)과 '같은 날짜 수량만 재편집하면 저장 안 됨'(holdingSnapshotsKey)
        //    버그가 정확히 그것이었다. createdAt/updatedAt은 제외(#55 규약).
        m: asArr(s?.notes).map((n: any) => [
          n?.id ?? '', n?.kind ?? '', n?.title ?? '', n?.body ?? '', n?.snapshot?.fp ?? '',
          n?.snapshot?.conditions ?? '', n?.snapshot?.period ?? '',
          n?.snapshot?.finalTotal ?? null, n?.snapshot?.profit ?? null, n?.snapshot?.profitRate ?? null,
        ]),
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
  // ⚠️ 정기 스위치가 꺼지면 policy 값을 **보존한 채** 정기 일정만 멈춘다(policy:'none'과 동치).
  //    follows:true를 유지하는 근거는 아래 'none' 분기 주석과 같다.
  if (config.regularOn === false) return { mode: 'none', day: 0, follows: true };
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

      // 전역 지정일 — 정기 정책에 **추가**되는 축이라 아래 두 continue보다 **앞**에서 만든다.
      // ⚠️ 뒤에 두면 정기를 끈 달(policy:'none')이나 종목 오버라이드가 있는 달에서 지정일이
      //    통째로 사라진다 — '정기는 끄고 지정일만'이 이 기능의 주 사용 시나리오다.
      // ⚠️ follow 종목에만 건다(월별 일괄 오버라이드와 같은 규약, BtConfig.rebalDates 주석 참조).
      if (r.follows) {
        for (const raw of config.rebalDates) {
          if (ymOf(raw) !== ym) continue;
          add(onOrBeforeBusinessDay(raw, holidays), group, labelCycle, false, a.id);
        }
      }

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
    finalHoldings: [], annualRows: [],
    summary: {
      startDate: config.startDate, endDate: config.endDate,
      initialCapital: config.initialCapital,
      finalEval: 0, finalCash: 0, finalTotal: 0, profit: 0, profitRate: 0,
      cumTradeNet: 0, cumStructuralNet: 0, cumReinvestNet: 0,
      cumDivAccrued: 0, cumDivPaid: 0, cumDivTax: 0, cumContribution: 0, cumAnnualReview: 0,
      finalCashTrade: 0, finalCashDiv: 0, finalCashReserve: 0, cumDivDrawn: 0, cumReserveDrawn: 0, maxDrawdown: 0, months: 0,
      minCash: { value: 0, date: '' }, minCashDiv: { value: 0, date: '' },
      divMonthlyAvg: 0, divMonthlyStdev: 0,
      bandSkipCount: 0, bandSkipAmount: 0, signalEvents: [], shortfallMonths: 0,
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

  /** 분배금 원천징수율(0~1). 0이면 이 기능 전체가 무동작(세후 = 세전). */
  const divTaxRate = Math.min(1, Math.max(0, config.divTaxPct / 100)) || 0;

  let cash = config.initialCapital + config.extraCash;
  // ── 예수금 두 주머니 ──
  // ⚠️ 불변식: `cashTrade + cashDiv === cash` (항상). 총액은 종전과 1원도 다르지 않고,
  //    "예수금을 먼저 쓰고 모자라면 누적 분배금을 쓴다"는 사용 순서를 **보이게** 하려는 분해다.
  //    분배금을 cash와 별도로 더하면 이중 계상이 되므로 절대 그렇게 바꾸지 말 것.
  // ⚠️ 불변식이 3분할로 바뀌었다: cashTrade + cashDiv + cashReserve === cash.
  //    총액은 종전과 1원도 다르지 않고, "추가 예수금은 매매 시그널 발동 시에만 쓴다"는
  //    사용자 정의(2026-08)를 **구조적으로** 강제하기 위한 분해다.
  let cashTrade = config.initialCapital;  // 초기 매수 잔돈 + 매매(리밸런싱·구조변경) 순현금
  let cashDiv = 0;                        // 지급받은 분배금 중 아직 쓰지 않은 몫
  let cashReserve = config.extraCash;     // 예비금 — 시그널 발동 시에만 인출한다
  /** 월말 주머니 잔액 복원용 스냅샷(날짜 오름차순). */
  const bucketLog: { date: string; t: number; d: number; r: number }[] = [];
  const logBuckets = (date: string) => {
    const last = bucketLog[bucketLog.length - 1];
    if (last && last.date === date) { last.t = cashTrade; last.d = cashDiv; last.r = cashReserve; return; }
    bucketLog.push({ date, t: cashTrade, d: cashDiv, r: cashReserve });
  };
  /**
   * 그 달 매수 대금을 **어느 주머니에서 얼마씩** 꺼냈는지.
   * ⚠️ 누적 매매차익이 마이너스인 달에는 "이 매수를 무엇으로 충당했는가"가 화면에서
   *    보이지 않으면 사용자가 추적할 수 없다 — 그 근거를 남기는 기록이다.
   */
  const drawByYm = new Map<string, { fromTrade: number; fromDiv: number; fromReserve: number }>();
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
   * 직전 applyCash가 **어느 주머니에서 얼마씩** 꺼냈는가.
   * ⚠️ 급락 분할투입(dip)의 '실제 사용액'을 채우기 위한 것이다 — 매수 직후에만 읽고,
   *    매도(delta≥0)는 {0,0}으로 초기화되므로 앞선 매수 값이 새어 나오지 않는다.
   */
  let lastDraw = { fromTrade: 0, fromDiv: 0, fromReserve: 0 };
  /**
   * 매도(+)는 매매 주머니로, 매수(−)는 주머니에서 꺼낸다.
   * @param prefer 'trade'(기본) = 매매 → 분배금 순 / 'div' = 분배금 → 매매 순.
   * @param divCap 이 출금에서 **분배금 주머니에서 꺼낼 수 있는 상한**. 기본 Infinity = 종전 동작.
   *   ⚠️ `buyFunding:'tradeOnly'`가 평시 매수에 0을 넘겨 cashDiv를 잠그고, 급락이 개방한 만큼만
   *      열어 준다. 상한을 넘긴 잔여는 종전대로 **매매 주머니**가 음수로 떠안는다(cashDiv는 음수 불가).
   * ⚠️ 분배금 재투자 매수는 반드시 'div'로 꺼낸다 — 기본값으로 꺼내면 cashDiv가 줄지 않아
   *    **다음 회차가 같은 분배금을 또 투입**한다(무한 재투자로 예수금이 통째로 빨려 들어간다).
   */
  const applyCash = (
    delta: number, date: string,
    prefer: 'trade' | 'div' = 'trade', divCap: number = Infinity, reserveCap: number = 0,
  ) => {
    cash += delta;
    if (delta >= 0) { cashTrade += delta; lastDraw = { fromTrade: 0, fromDiv: 0, fromReserve: 0 }; logBuckets(date); return; }
    let need = -delta;
    let fromTrade = 0;
    let fromDiv = 0;
    let fromReserve = 0;
    const divRoom = Math.max(0, Math.min(cashDiv, divCap));
    const reserveRoom = Math.max(0, Math.min(cashReserve, reserveCap));
    const takeTrade = () => {
      const x = Math.max(0, Math.min(cashTrade, need));
      if (x > 0) { fromTrade += x; cashTrade -= x; need -= x; }
    };
    const takeDiv = () => {
      const x = Math.max(0, Math.min(divRoom, need));
      if (x > 0) { fromDiv += x; cashDiv -= x; drainPocket(x); need -= x; }
    };
    const takeReserve = () => {
      const x = Math.max(0, Math.min(reserveRoom, need));
      if (x > 0) { fromReserve += x; cashReserve -= x; need -= x; }
    };
    // ⚠️ 인출 순서는 **매매 → 예비금 → 분배금**이다. 예비금을 분배금 뒤에 두면
    //    buyFunding:'both'(기본, divCap=Infinity)에서 분배금이 먼저 소진돼 예비금 단계가
    //    영원히 실행되지 않고, drainPocket이 divPocket을 비워 이후 'source' 배분 가중치까지
    //    소실된다(설계 검증 확정 결함).
    // ⚠️ 재투자 경로(prefer==='div')는 예비금에 **닿지 않는다** — reserveCap이 0이기도 하지만
    //    분기 자체에서 호출하지 않아 구조적으로 보장한다.
    if (prefer === 'div') { takeDiv(); takeTrade(); }
    else { takeTrade(); takeReserve(); takeDiv(); }
    // 전부 바닥나면(allowNegativeCash) 초과분은 매매 주머니가 음수로 진다.
    if (need > 0) cashTrade -= need;
    lastDraw = { fromTrade: fromTrade + need, fromDiv, fromReserve };
    const ym = ymOf(date);
    if (ym) {
      const cur = drawByYm.get(ym);
      // 초과분(need)은 매매 주머니가 마이너스로 떠안았으므로 매매 몫에 함께 계상한다.
      if (cur) { cur.fromTrade += fromTrade + need; cur.fromDiv += fromDiv; cur.fromReserve += fromReserve; }
      else drawByYm.set(ym, { fromTrade: fromTrade + need, fromDiv, fromReserve });
    }
    logBuckets(date);
  };
  /** 첫 분배금 입금일 — minCashDiv를 잴 구간의 시작(cashDiv가 0에서 시작하기 때문). */
  let firstDivDate = '';
  const applyDividend = (amount: number, date: string, assetId?: string) => {
    cash += amount;
    cashDiv += amount;
    if (amount > 0 && !firstDivDate) firstDivDate = date;
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
    return eq > 0 ? eq : Math.max(0, cash - cashReserve);
  };

  /**
   * 그 시점 **활성 종목 목표금액 합계** — 현금 바닥선(cashFloorPct)의 기준.
   * ⚠️ 비중 모드에서도 targetOf로 환산해 같은 정의를 쓴다(목표 = 분모 × 비중).
   *    그래서 base(분모)를 인자로 받는다 — 호출부가 이미 구한 값을 재사용해 중복 계산을 막는다.
   */
  const activeTargetSum = (date: string, base: number): number => {
    let s = 0;
    for (const p of positions) {
      if (!p.active || p.removed) continue;
      if (date < p.effectiveStart || date > p.effectiveEnd) continue;
      s += targetOf(p, config, base);
    }
    return s;
  };

  /* ── 시그널 리밸런싱 상태 ───────────────────────────────────────────────
   * 발동일 종가로 **즉시** 체결하므로 회차를 넘겨 들고 다니는 상태가 없다 —
   * 기록(signalEvents)만 남는다. dip.enabled=false면 영원히 비어 있어 아무 분기도 타지 않는다.
   * ⚠️ 옛 설계(개방 한도를 dipUnlock/dipPending에 담아 **다음 정기 리밸런싱**까지 들고 가던 것)로
   *    되돌리지 말 것 — `policy:'none'`(리밸런싱 안 함)에서는 쓸 회차가 영영 오지 않아
   *    "개방 ₩0 → 사용 ₩0"만 찍히고 기능이 통째로 죽는다(2026-08 사용자 보고).
   * ========================================================================= */
  const signalEvents: BtSignalEvent[] = [];

  /* ── 앵커 축(직전 체결 종가 기준) 상태 ────────────────────────────────────
   * 앵커는 **체결 결과에 의존**해 사전 탐지가 불가능하다 → 런타임에 매 영업일 판정한다.
   * ⚠️ 앵커 배열이 비면(`anchorOn === false`) 아래 어떤 분기도 타지 않아 기존 결과가 1바이트도
   *    달라지지 않는다 — 매 영업일 signal 스텝도 만들지 않는다.
   * ========================================================================= */
  const anchorLevels = config.dip.enabled ? normalizeAnchorLevels(config.dip.anchorLevels) : [];
  const anchorSellLevels = config.dip.enabled ? normalizeAnchorLevels(config.dip.anchorSellLevels) : [];
  const anchorOn = anchorLevels.length > 0 || anchorSellLevels.length > 0;
  const anchorSrc: BtAnchorSource = config.dip.anchorSource === 'lastRebal' ? 'lastRebal' : 'lastFill';
  /** 종목별 앵커 가격(직전 체결 종가)과 그 체결일. */
  const anchorPx = new Map<string, number>();
  const anchorDateOf = new Map<string, string>();
  /** 그 앵커 아래에서 이미 발동한 단계 인덱스(앵커가 **실제로 이동**할 때만 비운다). */
  const firedAnchorBuy = new Map<string, Set<number>>();
  const firedAnchorSell = new Map<string, Set<number>>();

  /**
   * 앵커 갱신 — 어떤 체결이 기준을 옮기는지는 `anchorSource`가 정한다.
   *
   * ⚠️ **분배금 재투자·재조정 매도·종목 재편은 절대 앵커를 옮기지 않는다.** 사용자가 지명한
   *    사건은 '이전 리밸런싱'과 '이전 매매시그널' 둘뿐인데, 재투자를 켜면(`divReinvest:'payDate'`)
   *    매달 체결이 생겨 앵커가 갈아엎어져 **앵커 축이 사실상 죽는다** — 1월 대비 −17%까지 빠져도
   *    새 앵커 대비 −9%라 10% 단계가 끝내 발동하지 않는다(설계 검증 확정 결함).
   * ⚠️ 재조정 매도(`signal==='realloc'`)는 **다른 종목의 시그널 때문에** 팔린 것이라 그 종목의
   *    기준을 옮길 이유가 없다.
   * ⚠️ 값이 그대로면 재무장하지 않는다 — 같은 가격에 두 번 체결돼도 단계가 되살아나면 안 된다.
   */
  const touchAnchor = (t: BtTrade): void => {
    if (!anchorOn) return;
    if (t.reinvest || t.structural) return;
    if (t.signal === 'realloc') return;
    if (anchorSrc === 'lastRebal' && (t.signal === 'buy' || t.signal === 'sell')) return;
    if (!(t.price > 0)) return;
    if (anchorPx.get(t.assetId) === t.price) return;
    anchorPx.set(t.assetId, t.price);
    anchorDateOf.set(t.assetId, t.date);
    firedAnchorBuy.get(t.assetId)?.clear();
    firedAnchorSell.get(t.assetId)?.clear();
  };

  /**
   * 그 시점 **뒤이은 정기 리밸런싱이 실제로 쓸 수 있는 매수 재원** — 목표 증액(매월·연간)의 상한.
   *
   * ⚠️ '보유 예수금(cash)'으로 자르면 안 된다 — `buyFunding:'tradeOnly'`는 분배금 주머니가 잠겨 있고
   *    현금 바닥선이 있으면 그만큼 못 쓴다. 총 cash로 자르면 **쓸 수 없는 돈까지 목표에 얹혀**
   *    매달 복리로 부풀고, '누적 증액' 카드가 실제로 투입되지 않은 돈을 보고한다
   *    (적대적 리뷰 확정 결함: tradeOnly + pctOfCash 100%에서 목표 5,000만 → 3억 4천만, 평가액은 9,386만).
   * ⚠️ 기본값(`both` + 바닥선 0)에서는 `Math.max(0, cash)`라 종전 `cashBefore` 컷과 **결과가 동일**하다
   *    (cash<0이면 옛 코드도 `Math.max(0, cashBefore)`로 0을 만들었다).
   * ⚠️ 같은 회차의 매도 대금이 cashTrade를 불려 줄 수 있지만 그건 옛 컷도 무시하던 2차 효과다 —
   *    이 값은 '목표만 부풀지 않게' 막는 보수적 상한이지 정확한 예산이 아니다.
   */
  const deployableCash = (date: string): number => {
    // ⚠️ 예비금은 목표 증액의 재원이 아니다 — 시그널 발동 시에만 쓰는 돈이라 목표에 얹으면
    //    매달 복리로 부풀고 '누적 증액' 카드가 투입되지 않은 돈을 보고한다.
    let cap = config.buyFunding === 'tradeOnly' ? Math.max(0, cashTrade) : Math.max(0, cash - cashReserve);
    if (config.cashFloorPct > 0) {
      const fl = (activeTargetSum(date, targetBaseAt(date)) * config.cashFloorPct) / 100;
      cap = Math.min(cap, Math.max(0, cash - cashReserve - fl));
    }
    return cap;
  };

  /**
   * 매수가 재원 한도로 잘린 건수(월별). '예수금 부족'·'바닥선' 둘 다 센다.
   * ⚠️ 잘려서 수량이 0이 되면 adjustTo가 null을 반환해 **거래 행 자체가 남지 않는다** —
   *    표에서 사라지는 부족을 이 카운터가 대신 증언한다(summary.shortfallMonths의 원자재).
   */
  const shortfallByYm = new Map<string, number>();

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
  const adjustTo = (
    p: Pos, date: string, target: number, structural: boolean,
    opts?: {
      /** 매수 재원 상한. 미지정이면 종전대로 전체 예수금(cash). */
      budget?: number;
      /** 현금 바닥선을 지키기 위한 매수 상한(= cash − 바닥선). 미지정이면 Infinity. */
      floorCap?: number;
      /** 이 매수에서 분배금 주머니에서 꺼낼 수 있는 상한. 미지정이면 Infinity(종전). */
      divCap?: number;
      /** 이 매수에서 **예비금**에서 꺼낼 수 있는 상한. 미지정이면 0 = 잠김(시그널 매수만 넘긴다). */
      reserveCap?: number;
    },
  ): BtTrade | null => {
    const hit = priceAt(prices[p.asset.code], date);
    if (hit.missing || hit.price <= 0) return null;
    const evalBefore = p.qty * hit.price;
    let qty = roundQty((target - evalBefore) / hit.price, config.rounding);
    let note = '';

    if (qty < 0 && -qty > p.qty) { qty = -p.qty; note = '보유수량 한도'; }
    if (qty > 0) {
      // ⚠️ 기본값(opts 미지정)이면 rawBudget=cash · floorCap=Infinity · limited=!allowNegativeCash
      //    라서 종전 코드와 **문자 그대로 동일**하다. 새 옵션은 전부 opts를 넘기는 정기 리밸런싱에서만 산다.
      // ⚠️ 기본 한도에서 **예비금을 뺀다** — 초기 매수·이벤트는 opts를 넘기지 않으므로 이 한 줄이
      //    그 경로들의 예비금 보호를 담당한다(호출 형태는 그대로라 소스 가드 #231은 유지된다).
      //    다만 진짜 보호는 예산이 아니라 **인출 한도(reserveCap 기본 0)** 다 — allowNegativeCash면
      //    limited가 false라 이 컷이 통째로 꺼지지만, reserveCap이 0이라 예비금은 1원도 줄지 않는다.
      const rawBudget = opts?.budget ?? (cash - cashReserve);
      const floorCap = opts?.floorCap ?? Infinity;
      const budget = Math.min(rawBudget, floorCap);
      // ⚠️ 바닥선은 allowNegativeCash보다 **우선**한다 — 바닥선이 걸린 매수는 음수 예수금을 허용해도 자른다.
      const limited = !config.allowNegativeCash || floorCap < Infinity;
      if (limited) {
        const cost = qty * hit.price;
        if (cost > budget) {
          const afford = roundQty(budget / hit.price, config.rounding === 'exact' ? 'exact' : 'floor');
          if (afford < qty) {
            qty = Math.max(0, afford);
            note = budget === floorCap && floorCap < rawBudget ? '바닥선' : '예수금 부족';
            const sym = ymOf(date);
            if (sym) shortfallByYm.set(sym, (shortfallByYm.get(sym) ?? 0) + 1);
          }
        }
      }
    }
    // ⚠️ 결과가 0에 수렴하면 **정확히 전량**으로 스냅한다(QTY_EPS 주석 참조). p.qty를 나중에
    //    보정하면 러닝 누적 맵(runQty)은 t.qty를 더하므로 둘이 갈린다 — 반드시 qty 자체를 고친다.
    if (p.qty + qty !== 0 && Math.abs(p.qty + qty) < QTY_EPS) qty = -p.qty;
    if (qty === 0) return null;

    const cashDelta = -qty * hit.price;
    applyCash(cashDelta, date, 'trade', opts?.divCap ?? Infinity, opts?.reserveCap ?? 0);
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
    // ⚠️ 재투자는 예비금에 닿지 않는다 — 가용 현금에서 예비금을 뺀다.
    if (!config.allowNegativeCash && qty * hit.price > cash - cashReserve) {
      qty = roundQty((cash - cashReserve) / hit.price, floorMode);
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
    //    같은 원리다.
    // ⚠️ 그 투입 자본은 **초기 투자금뿐**이다(사용자 확정 2026-08) — 추가 예수금은 "매매 시그널
    //    때 매수할 수 있는 자금"이라 첫날 써 버리면 안 된다. 분모(base)만 바꾸면 목표 금액 모드에서
    //    목표 합계가 초기 투자금을 넘을 때 여전히 추가 예수금을 헐어 쓰므로, **예산도 함께 캡**한다.
    // ⚠️ `extraCash === 0`이면 initRemain이 cash와 항상 같아 종전과 문자 그대로 동일하다(하위호환).
    // ⚠️ allowNegativeCash는 종전대로 살아 있다 — adjustTo의 `limited`가 false면 budget을 무시한다.
    checkRatioSum(startBiz);
    const base = config.initialCapital;
    let initRemain = config.initialCapital;
    for (const p of positions) {
      if (!p.active) continue;
      const t = adjustTo(p, startBiz, targetOf(p, config, base), false, {
        budget: Math.max(0, initRemain),
      });
      // ⚠️ initialTrades는 pushTrade를 타지 않는다 — 여기서 앵커를 시드하지 않으면 초기 보유
      //    종목의 앵커가 미설정이라 첫 앵커 발동의 기준가가 영영 없다.
      if (t) { touchAnchor(t); initialTrades.push(t); initRemain += t.cashDelta; }
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
      // ⚠️ '정기를 명시적으로 껐는가'로 판정한다 — `policy !== 'none'`만 보면 체크박스로 끈 경우
      //    (policy는 'allEom' 그대로) 종목 수만큼 경고가 도배돼, 같은 뜻의 두 설정이 경고 개수가
      //    달라진다(검증 #116 계약 위반).
      } else if (config.policy !== 'none' && config.regularOn !== false) {
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

  /* ── 시그널 사전 탐지: '고점 대비 −N%'(매수) / '저점 대비 +N%'(매도) 첫 도달 ─────
   * ⚠️ **가격 고점/저점** 기준이다(평가액 아님) — 리밸런싱으로 수량이 계속 변하므로 평가액 극값은 왜곡된다.
   * ⚠️ 새 고점이 서면 **매수** 단계를, 새 저점이 서면 **매도** 단계를 재무장한다(각 단계는 그 전까지 1회만).
   * ⚠️ carry-forward 종가(priceAt)를 쓰되 값이 아예 없는 날은 건너뛴다 — 이월된 날은 등락이
   *    직전일과 같아 어차피 새로 발동하지 않는다.
   * ⚠️ 고점 갱신일에는 매수 판정을 건너뛴다(낙폭 0). 저점 갱신일에는 매도 판정을 건너뛴다(상승 0).
   *    두 판정은 **서로 독립**이다 — 신고가일에 매도가 발동하는 것은 정상이고(저점 대비 상승률이
   *    최대인 날), 신저가일에 매수가 발동하는 것도 정상이다(옛 코드가 `continue`로 하루를 통째로
   *    건너뛰던 것은 매수 판정 하나뿐이었으므로 **매수 동작은 문자 그대로 보존**된다).
   * 여기서는 **발동일만** 확정한다. 매매 규모는 런타임 재원·평가액에 달려 있어 signal 스텝에서 계산한다.
   * =========================================================================== */
  type SigTrig = {
    assetId: string; kind: 'buy' | 'sell';
    /** 그 단계의 비율(%). 매수=매수 재원의 %, 매도=목표 초과분의 %. null이면 '목표까지'. */
    step: number; level: number; pct: number | null;
    ref: number; price: number;
    /**
     * 어느 축이 발동시켰는가. extreme=전 구간 가격 고점/저점 / anchor=직전 체결 종가.
     * ⚠️ 두 축이 같은 날 같은 종목에서 겹치면 `ref`(고점·저점 또는 앵커가)만으로는 구분이
     *    불가능해 화면 문장이 거짓이 된다 — 축을 반드시 실어 보낸다.
     */
    axis: 'extreme' | 'anchor';
    /** 앵커 축일 때 그 앵커를 만든 체결일(표시용). extreme이면 ''. */
    anchorDate: string;
  };
  const sigTrigByDate = new Map<string, SigTrig[]>();
  // ⚠️ 단계 목록은 **반드시 정규화한 사본**으로 돈다(정렬·중복 제거·상한).
  //    화면은 로컬 사본을 2.5초 idle에만 승격하므로, 같은 낙폭을 두 번 적으면 저장 전에는
  //    그 단계가 **두 번 발동해 개방액이 2배**가 되고, 저장·재로드 뒤에는 normalizeDipLevels가
  //    dedup해 결과가 달라진다 — **같은 시나리오가 세션에 따라 다른 결과**를 내는 최악의 상태다.
  //    여기서 정규화하면 런타임과 영속 표현이 항상 일치한다(적대적 리뷰 확정 결함).
  const dipLevels = config.dip.enabled ? normalizeDipLevels(config.dip.levels) : [];
  const sellLevels = config.dip.enabled ? normalizeSellLevels(config.dip.sellLevels) : [];
  // ⚠️ `extremeOn` 게이트는 여기(루프 진입)에 둔다 — 위 두 선언줄은 소스 가드 #233c·#257이
  //    리터럴로 단언하므로 건드리지 말 것.
  if (config.dip.extremeOn !== false && (dipLevels.length > 0 || sellLevels.length > 0)) {
    for (const p of positions) {
      const series = prices[p.asset.code];
      if (!series) continue;
      let peak = 0;
      let trough = Infinity;
      const firedBuy = new Set<number>();
      const firedSell = new Set<number>();
      for (const d of allBiz) {
        const hit = priceAt(series, d);
        if (hit.missing) continue;
        const px = hit.price;
        const newPeak = px > peak;
        const newTrough = px < trough;
        if (newPeak) { peak = px; firedBuy.clear(); }
        if (newTrough) { trough = px; firedSell.clear(); }
        const push = (rec: SigTrig) => {
          const arr = sigTrigByDate.get(d);
          if (arr) arr.push(rec); else sigTrigByDate.set(d, [rec]);
        };
        if (!newPeak && peak > 0) {
          const dropPct = ((peak - px) / peak) * 100;
          for (let i = 0; i < dipLevels.length; i++) {
            const lv = dipLevels[i];
            if (firedBuy.has(i)) continue;
            if (dropPct < lv.drop) continue;
            firedBuy.add(i);
            push({
              assetId: p.asset.id, kind: 'buy', step: i + 1,
              level: lv.drop, pct: lv.buyPct, ref: peak, price: px,
              axis: 'extreme', anchorDate: '',
            });
          }
        }
        if (!newTrough && trough > 0 && Number.isFinite(trough)) {
          const risePct = ((px - trough) / trough) * 100;
          for (let i = 0; i < sellLevels.length; i++) {
            const lv = sellLevels[i];
            if (firedSell.has(i)) continue;
            if (risePct < lv.rise) continue;
            firedSell.add(i);
            push({
              assetId: p.asset.id, kind: 'sell', step: i + 1,
              level: lv.rise, pct: lv.sellPct, ref: trough, price: px,
              axis: 'extreme', anchorDate: '',
            });
          }
        }
      }
    }
  }
  // ⚠️ '켰는데 단계가 하나도 없다'가 조용히 아무 일도 안 하는 상태가 되지 않게 알린다.
  //    (매수 단계는 normalizeDipLevels가 기본값으로 되돌리므로 실제로는 매도만 비어 있을 수 있다.)
  if (config.dip.enabled && dipLevels.length === 0 && sellLevels.length === 0) {
    warnings.push('시그널 리밸런싱을 켰지만 매수·매도 단계가 하나도 없어 아무 일도 일어나지 않습니다.');
  }
  // ⚠️ 고점 축을 껐는데 앵커 축도 없으면 '켰는데 아무 일도 안 함'이 된다 — 조용히 두지 않는다.
  // ⚠️ 예비금은 **시그널 발동 시에만** 쓰인다 — 시그널이 꺼져 있으면 그 돈은 종료일까지
  //    한 푼도 쓰이지 않는다. 화면에 단서가 없으면 사용자는 이유를 알 수 없다.
  if (config.extraCash > 0 && !config.dip.enabled) {
    warnings.push(
      `추가 예수금 ${Math.round(config.extraCash).toLocaleString('ko-KR')}원은 **매매 시그널 발동 시에만** 쓰입니다 — `
      + '⑤-b 시그널 리밸런싱이 꺼져 있어 이 돈은 한 번도 쓰이지 않습니다(초기 매수·정기 리밸런싱은 초기 투자금만 씁니다).',
    );
  }
  if (config.dip.enabled && config.dip.extremeOn === false && !anchorOn) {
    warnings.push('시그널 리밸런싱을 켰지만 고점/저점 축을 끄고 직전 체결가 축 단계도 비어 있어 아무 일도 일어나지 않습니다.');
  }

  /**
   * 앵커 축 발동 판정 — **그 스텝 진입 시 한 번만** 계산한다(같은 날 체결이 판정을 바꾸지 않게).
   *
   * 규칙: 그날 도달한 **가장 깊은 단계 1건만** 발동시키고, 그보다 얕은 미발동 단계는 함께 소진 처리한다.
   * ⚠️ `fired` Set이 없으면 체결이 0인 날(이미 목표라 매매 없음)에 앵커가 안 바뀌어 **다음 날 또
   *    발동**한다 — 이벤트가 매일 쌓인다.
   * ⚠️ 앵커가 없는 종목(아직 한 번도 체결 안 됨)은 판정하지 않는다.
   */
  const anchorTrigsAt = (date: string): SigTrig[] => {
    if (!anchorOn) return [];
    const out: SigTrig[] = [];
    for (const p of positions) {
      if (p.removed) continue;
      if (date < p.effectiveStart || date > p.effectiveEnd) continue;
      const anchor = anchorPx.get(p.asset.id);
      if (!(anchor > 0)) continue;
      const hit = priceAt(prices[p.asset.code], date);
      if (hit.missing || hit.price <= 0) continue;
      const chgPct = ((hit.price - anchor) / anchor) * 100;
      const aDate = anchorDateOf.get(p.asset.id) ?? '';
      const fire = (
        levels: BtAnchorLevel[], mag: number, kind: 'buy' | 'sell',
        firedMap: Map<string, Set<number>>,
      ) => {
        if (!levels.length || !(mag > 0)) return;
        let deepest = -1;
        for (let i = 0; i < levels.length; i++) if (mag >= levels[i].move) deepest = i;
        if (deepest < 0) return;
        let fired = firedMap.get(p.asset.id);
        if (!fired) { fired = new Set<number>(); firedMap.set(p.asset.id, fired); }
        if (fired.has(deepest)) return;
        for (let i = 0; i <= deepest; i++) fired.add(i);
        out.push({
          assetId: p.asset.id, kind, step: deepest + 1, level: levels[deepest].move,
          // ⚠️ 앵커 축은 비율이 없다(항상 '목표까지') — 두 축이 겹칠 때 pctSum이 100%를 넘어
          //    화면 계산식과 실제 체결이 어긋나는 것을 원천 차단한다.
          pct: null,
          ref: anchor, price: hit.price, axis: 'anchor', anchorDate: aDate,
        });
      };
      fire(anchorLevels, -chgPct, 'buy', firedAnchorBuy);
      fire(anchorSellLevels, chgPct, 'sell', firedAnchorSell);
    }
    return out;
  };

  type Step =
    | { date: string; kind: 'exdiv'; div: BtDivSlot }
    | { date: string; kind: 'pay'; div: BtDivSlot }
    | { date: string; kind: 'signal'; trigs: SigTrig[] }
    | { date: string; kind: 'rebal'; slot: BtSlot }
    | { date: string; kind: 'event'; event: BtEvent }
    | { date: string; kind: 'contrib'; ym: string }
    | { date: string; kind: 'annual'; ym: string }
    | { date: string; kind: 'reinvest'; slot: BtReinvestSlot };

  const steps: Step[] = [];
  // ⚠️ 앵커 축은 체결 결과에 의존해 사전 탐지가 불가능하므로 **매 영업일** 스텝을 세우고 런타임에
  //    판정한다. 앵커가 꺼져 있으면 이 분기를 타지 않아 steps 배열이 종전과 1바이트도 다르지 않다.
  if (anchorOn) {
    for (const d of allBiz) steps.push({ date: d, kind: 'signal', trigs: sigTrigByDate.get(d) ?? [] });
  } else {
    for (const [d, trigs] of sigTrigByDate) steps.push({ date: d, kind: 'signal', trigs });
  }
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

    // ── 연간 가드레일 증액 ──
    // ⚠️ 시작월 + everyMonths × k 의 **첫 리밸런싱일**에 건다(매월 증액과 같은 배치 규약).
    //    그 달에 리밸런싱이 없으면 집행 수단이 없으므로 조용히 버리지 않고 경고한다.
    const ar = config.annualReview;
    if (ar.mode === 'pctOfSurplus' && ar.value > 0) {
      if (config.targetMode === 'ratio') {
        warnings.push(
          '비중 모드에서는 연간 가드레일 증액이 반영되지 않습니다 — 목표가 “종목 평가액 합계 × 비중”이라 '
          + '올릴 대상이 없습니다(매월 목표 증액과 같은 이유). 목표 금액 모드에서 사용하세요.',
        );
      } else if (firstRebalOfYm.size === 0) {
        warnings.push('리밸런싱이 한 번도 없어 연간 가드레일 증액이 전혀 집행되지 않습니다.');
      } else {
        const endYm = ymOf(endBiz);
        let k = 1;
        while (k < 2000) {
          const ym = addMonthsToYm(ymOf(startBiz), ar.everyMonths * k);
          if (!ym || ym > endYm) break;
          const d = firstRebalOfYm.get(ym);
          if (d) steps.push({ date: d, kind: 'annual', ym });
          else warnings.push(`${ym}: 연간 가드레일 증액 시점이지만 그 달에 리밸런싱이 없어 집행되지 않습니다.`);
          k++;
        }
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
  // ⚠️ signal은 pay **뒤**다 — 개방 한도가 '발동 시점 cashDiv'라 그날 받은 분배금까지 포함해야 한다.
  // ⚠️ signal은 event **뒤**다 — 같은 날 구조 변경(종목 재편)이 있으면 그 결과 구성 위에서
  //    시그널을 실행해야 한다(앞에 두면 곧 빠질 종목을 사들인다).
  // ⚠️ signal은 contrib·annual **뒤**다 — 그날 올린 목표를 반영해 매수해야 증액이 실제로 집행된다.
  // ⚠️ signal은 rebal **앞**이다 — 시그널이 먼저 목표를 맞추면 이어지는 정기 리밸런싱은 자연히
  //    할 일이 없어 no-op이 된다(반대 순서면 결과는 같지만 매매 행이 정기 쪽으로 잡혀 추적이 흐려진다).
  // ⚠️ annual은 contrib **뒤**로 고정한다 — 같은 날 둘 다 도래하면 매월 증액을 먼저 반영한 뒤
  //    그 결과 예수금에서 연간 잉여를 계산한다(사양 확정 순서).
  // ⚠️ 기존 5종의 **상대 순서는 그대로**다(exdiv<pay<event<contrib<annual<rebal<reinvest).
  const KIND_ORDER: Record<string, number> = {
    exdiv: 0, pay: 1, event: 2, contrib: 3, annual: 4, signal: 5, rebal: 6, reinvest: 7,
  };
  steps.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );

  // 분배락 시점 권리 확정 수량 — exdiv 스텝에서 채우고 pay 스텝에서 현금화한다.
  const pendingDiv = new Map<string, BtDividendRow[]>();
  /** 실행된 연간 가드레일 증액(시간순). */
  const annualRows: BtContribRow[] = [];

  const monthMap = new Map<string, BtMonth>();
  const monthOf = (ym: string): BtMonth => {
    let m = monthMap.get(ym);
    if (!m) {
      m = {
        ym, trades: [], dividends: [],
        tradeNet: 0, structuralNet: 0, reinvestNet: 0, cumTradeNet: 0,
        divAccrued: 0, cumDivAccrued: 0, divPaid: 0, cumDivPaid: 0, divTax: 0, cumDivTax: 0, cumReinvestNet: 0,
        cashDelta: 0, cashEnd: 0, cashTradeEnd: 0, cashDivEnd: 0, cashReserveEnd: 0,
        cashUsedTrade: 0, cashUsedDiv: 0, cashUsedReserve: 0, evalEnd: 0, totalEnd: 0, evalBeforeSum: 0,
        lastDate: '', holdings: [], contribution: null, cumContribution: 0,
        annualReview: null, cumAnnualReview: 0,
        bandSkipCount: 0, bandSkipAmount: 0, shortfallCount: 0,
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
    // ⚠️ 정기·시그널·재조정·이벤트·재투자 매매가 **전부 이 한 함수를 통과**한다 — 앵커 갱신을
    //    각 호출부에 흩으면 경로 하나만 빠져도 그 종목 앵커가 영구히 낡은 가격을 가리켜 매일 발동한다.
    //    (초기 매수는 pushTrade를 타지 않으므로 Phase 0에서 별도로 건다.)
    touchAnchor(t);
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
      // ⚠️ 원천징수는 **여기서만** 뗀다 — divAccrued(권리 확정액)는 세전 그대로 두고
      //    실제 입금(divPaid)만 세후로 정의해야 기말 예수금 분해 항등식이 종전 그대로 성립한다.
      const m = monthOf(ymOf(step.date));
      for (const r of rows) {
        const net = r.amount * (1 - divTaxRate);
        m.divPaid += net;
        m.divTax += r.amount - net;
        applyDividend(net, step.date, r.assetId);
      }
      continue;
    }

    if (step.kind === 'signal') {
      /* ── 시그널 리밸런싱 — **발동일 종가로 즉시 체결** ────────────────────────
       * 매수 재원은 `buyFunding` 하나가 정한다(tradeOnly → 매매 예수금만 / both → 예수금 전부).
       * 매매 규모는 단계의 비율이 정한다(`buyPct`/`sellPct`, null이면 목표까지).
       *   매수: `min(재원 스냅샷 × pct%, 목표 미달액)` · pct=null이면 목표 미달액 + 재조정 허용
       *   매도: `초과분 × pct%`                        · pct=null이면 목표까지 전량
       * ⚠️ 리밸런싱 밴드(band)는 **정기 리밸런싱 전용**이라 여기서는 보지 않는다 — 시그널은
       *    "지금 사라/팔라"는 명시적 지시라 밴드로 억눌러선 안 된다.
       * ⚠️ 정기 리밸런싱 일정(③ 정책)과 **완전히 독립**이다. policy:'none'이어도 여기는 돈다.
       * ===================================================================== */
      const date = step.date;
      /**
       * 앵커 축 판정은 **여기서 한 번만** 스냅샷한다(사전 탐지분과 합류).
       * ⚠️ 조기 탈출은 반드시 `checkRatioSum`·`targetBaseAt`보다 **앞**이다.
       *    ① 빈 스텝이 `checkRatioSum`을 부르면 경고 문구의 날짜·편입 종목 수가 달라지고
       *    ② `targetBaseAt`→`totalEvalAt`이 종목마다 `priceAt`을 부르는데 그 미스 경로는
       *       `for (const d in series)` 선형 스캔이라 `영업일 × 종목 × |시계열|`로 폭발한다.
       */
      const trigs = anchorOn ? [...step.trigs, ...anchorTrigsAt(date)] : step.trigs;
      if (!trigs.length) continue;
      const liveOf = (assetId: string): Pos | null => {
        const p = posById.get(assetId);
        if (!p || p.removed) return null;
        if (date < p.effectiveStart || date > p.effectiveEnd) return null;
        return p;
      };
      // 표시용 스냅샷 — 이 스텝이 pay 뒤라 그날 받은 분배금도 포함된다.
      const pocket = Math.max(0, cashDiv);
      const tradeOnly = config.buyFunding === 'tradeOnly';
      /**
       * 비중 모드 분모는 **이 스텝에서 단 한 번만** 잡는다(정기 리밸런싱이 plans를 실행 전에
       * 확정하는 것과 같은 규약).
       * ⚠️ 매도마다 다시 재면 **캐스케이드**가 난다 — 같은 날 A·B에 매도 시그널이 뜨면 A를 판
       *    직후 평가액 합계가 줄어 B의 목표까지 내려가고, B는 원래보다 더 팔게 된다(그 매도가
       *    다시 C의 목표를 내린다). 매수 재원 계산·현금 바닥선도 같은 base를 써야 하루 안에서
       *    목표가 흔들리지 않는다. 편입(`p.active = true`)은 수량을 바꾸지 않아 base와 무관하다.
       */
      checkRatioSum(date);
      const base = targetBaseAt(date);
      const mkEvent = (t: SigTrig, p: Pos): BtSignalEvent => {
        const ev: BtSignalEvent = {
          date, assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
          kind: t.kind, step: t.step, level: t.level,
          axis: t.axis, anchorDate: t.anchorDate,
          pct: t.pct, pctSum: null, carrier: false,
          poolAt: 0, excessAt: 0, planned: 0,
          divPocketAt: pocket, cashTradeAt: cashTrade,
          used: 0,
          ref: t.ref, price: t.price,
          tradeQty: 0, tradeAmount: 0, fromTrade: 0, fromReserve: 0, reallocAmount: 0, note: '',
        };
        signalEvents.push(ev);
        return ev;
      };
      /**
       * 같은 종목의 여러 단계가 같은 날 겹칠 때 비율을 합친다(carrier 규약).
       * ⚠️ 하나라도 '목표까지'(null)면 결과도 null — 비율과 목표까지를 섞어 두 번 체결하면
       *    같은 시그널이 두 번 표시되고 목표를 넘겨 산다.
       * ⚠️ 합이 100%를 넘어도 자르지 않는다(밑변 × 비율 = 금액 계산식이 화면에 그대로 찍히므로
       *    산술이 맞아야 한다). 매수는 목표에서, 매도는 초과분 전량에서 자연히 잘린다.
       */
      const sumPct = (list: BtSignalEvent[]): number | null => {
        let s = 0;
        for (const ev of list) {
          if (ev.pct === null) return null;
          s += ev.pct;
        }
        return s;
      };

      /* ── ① 매도 시그널 — 목표 **초과분**에서만 판다. 대금은 전액 매매 주머니로. ──
       * ⚠️ 매수와 같은 carrier 규약으로 **종목별로 묶어 한 번만 체결**한다. 옛 코드는 트리거마다
       *    독립 실행했는데(목표까지 전량이라 두 번째는 초과분 0으로 자연 종료), 비율 매도가
       *    생기면 그대로 두면 같은 날 단계들이 **연쇄 적용**돼(10% 판 뒤 남은 초과분의 20%)
       *    화면의 `초과분 × 비율` 계산식과 실제 체결이 어긋난다. */
      {
        const sellEvs = new Map<string, BtSignalEvent[]>();
        const sellPos: Pos[] = [];
        for (const t of trigs) {
          if (t.kind !== 'sell') continue;
          const p = liveOf(t.assetId);
          if (!p) continue;
          const ev = mkEvent(t, p);
          const list = sellEvs.get(p.asset.id);
          if (list) list.push(ev);
          else { sellEvs.set(p.asset.id, [ev]); sellPos.push(p); }
        }
        for (const p of sellPos) {
          const list = sellEvs.get(p.asset.id)!;
          const carrier = list[0];
          for (let i = 1; i < list.length; i++) {
            list[i].note = `동시 발동 — 체결은 ${carrier.step}단계 행에 합산`;
          }
          if (!p.active || p.qty <= QTY_EPS) { carrier.note = '보유 없음'; continue; }
          const hit = priceAt(prices[p.asset.code], date);
          if (hit.missing || hit.price <= 0) { carrier.note = '종가 없음'; continue; }
          // ⚠️ 밑변(excessAt)이 실제로 산출된 뒤에만 대표 행으로 표시한다 — 종가가 없어 여기까지
          //    못 온 행까지 carrier로 두면 화면에 "실제로 성립한 적 없는 계산식"이 렌더된다.
          carrier.carrier = true;
          const target = targetOf(p, config, base);
          const evalBefore = p.qty * hit.price;
          const excess = evalBefore - target;
          carrier.excessAt = Math.max(0, excess);
          // ⚠️ `pctSum`은 **초과분 가드보다 먼저** 채운다 — 뒤에 두면 '목표 이하'로 조기 반환한
          //    행의 pctSum이 null로 남아, 사용자가 30%를 지정했는데도 화면이 '목표 초과분 ₩0
          //    전량'(= 목표까지)이라고 설명한다(적대적 리뷰 확정 결함).
          carrier.pctSum = sumPct(list);
          // ⚠️ 아래 가드와 `tr.qty >= 0` 가드는 **의도적으로 중복된 방어선**이다(변이 테스트로 확인:
          //    하나만 지우면 다른 하나가 잡아 검증이 통과한다). 둘 다 지우면 목표에 못 미치는 보유
          //    상태에서 반등 시그널이 **매수로 뒤집혀** '매도 시그널'이 자산을 늘린다(검증 #308b).
          //    둘 중 하나를 지우고 싶더라도 그대로 둘 것 — "매도 시그널은 매도만 한다"가 계약이다.
          if (excess <= 0) { carrier.note = '목표 이하 — 팔 것 없음'; continue; }
          const pctSum = carrier.pctSum;
          // ⚠️ 비율 매도의 목표선은 `target`이 아니라 **초과분을 pct%만 덜어낸 수준**이다.
          //    이 식이라야 목표 아래로 절대 내려가지 않는다(pct=100이면 정확히 target).
          const sellAmount = pctSum === null
            ? excess
            : Math.min(excess, (excess * pctSum) / 100);
          carrier.planned = sellAmount;
          if (!(sellAmount > 0)) { carrier.note = '매도 비율 0% — 팔지 않음'; continue; }
          const tr = adjustTo(p, date, evalBefore - sellAmount, false);
          if (!tr || tr.qty >= 0) { carrier.note = '매도 수량 0(반올림)'; continue; }
          tr.signal = 'sell';
          pushTrade(tr);
          carrier.tradeQty = tr.qty;
          carrier.tradeAmount = Math.abs(tr.cashDelta);
          if (tr.note) carrier.note = tr.note;
        }
      }

      /* ── ② 매수 시그널 ─────────────────────────────────────────────────── */
      const buyTrigs = trigs.filter(t => t.kind === 'buy');
      if (!buyTrigs.length) continue;

      // 같은 종목에서 여러 단계가 같은 날 겹칠 수 있다(갭 하락). 이벤트는 단계별로 남기되
      // 체결·개방은 **그 종목의 첫 이벤트(carrier)에 합산**한다 — 행마다 나눠 실으면 같은 체결이
      // 두 번 표시된다.
      const evsByAsset = new Map<string, BtSignalEvent[]>();
      const buyPos: Pos[] = [];
      for (const t of buyTrigs) {
        const p = liveOf(t.assetId);
        if (!p) continue;
        const ev = mkEvent(t, p);
        const list = evsByAsset.get(p.asset.id);
        if (list) list.push(ev);
        else { evsByAsset.set(p.asset.id, [ev]); buyPos.push(p); }
        // 데이터가 생긴 시점부터 자동 편입 — 정기 리밸런싱·분배금 재투자와 같은 규약.
        if (!p.active) p.active = true;
      }
      if (!buyPos.length) continue;
      for (const list of evsByAsset.values()) {
        for (let i = 1; i < list.length; i++) {
          list[i].note = `동시 발동 — 체결은 ${list[0].step}단계 행에 합산`;
        }
      }

      const planOf = (p: Pos) => {
        const hit = priceAt(prices[p.asset.code], date);
        const target = targetOf(p, config, base);
        return { p, hit, evalBefore: hit.missing ? 0 : p.qty * hit.price, target };
      };
      const buyPlans: ReturnType<typeof planOf>[] = [];
      for (const p of buyPos) {
        const pl = planOf(p);
        if (pl.hit.missing || pl.hit.price <= 0) {
          const list = evsByAsset.get(p.asset.id);
          if (list) list[0].note = '종가 없음';
          continue;
        }
        buyPlans.push(pl);
      }
      const floorAmount = config.cashFloorPct > 0
        ? (activeTargetSum(date, base) * config.cashFloorPct) / 100
        : 0;

      /* ②-a 매수 재원 스냅샷 + 종목별 목표 매수액(`planned`) 확정.
       * ⚠️ 스냅샷은 **매도 시그널 처리 뒤 · 재조정 앞** 값이다 — 같은 날 매도 시그널이 만든 현금은
       *    실제로 쓸 수 있으므로 포함하고, 재조정 대금은 '목표까지' 매수를 위한 것이라 비율 매수의
       *    밑변을 부풀리지 않게 제외한다(BtDip 주석).
       * ⚠️ 밑변은 **종목별로 같은 스냅샷**이다 — 여러 종목이 같은 날 발동해도 서로의 몫을 빼앗지
       *    않아 화면 계산식(밑변 × 비율 = 금액)이 종목마다 성립한다. 합이 재원을 넘으면 뒤 종목이
       *    실제 예산에서 잘리고 그 사실은 note('예수금 부족')로 남는다.
       * ⚠️ **매수 계획이 살아 있는 종목만** 채운다 — 종가가 없어 계획에서 탈락한 종목까지 채우면
       *    화면에 "실제로 열린 적 없는 계산식"이 렌더된다(적대적 리뷰 확정 결함의 회귀). */
      const poolAt = tradeOnly ? Math.max(0, cashTrade) + Math.max(0, cashReserve) : Math.max(0, cash);
      /** '목표까지'(pct=null) 종목들의 필요액 합 — 재조정은 이 몫에 대해서만 돈다. */
      let needTotal = 0;
      for (const b of buyPlans) {
        const list = evsByAsset.get(b.p.asset.id);
        if (!list) continue;
        const carrier = list[0];
        const need = Math.max(0, b.target - b.evalBefore);
        const pctSum = sumPct(list);
        carrier.carrier = true;
        carrier.pctSum = pctSum;
        carrier.poolAt = poolAt;
        // ⚠️ 비율 매수는 **목표에서 자른다**(사용자 확정 2026-08) — "축소된 비중을 일정하게
        //    유지하는 것이 목적"이라 목표를 넘겨 사면 다음 회차가 되팔아 매매만 늘어난다.
        carrier.planned = pctSum === null ? need : Math.min(need, (poolAt * pctSum) / 100);
        for (let i = 1; i < list.length; i++) {
          list[i].pctSum = null; list[i].poolAt = 0; list[i].planned = 0;
        }
        if (pctSum === null) needTotal += need;
      }

      /**
       * 이 시그널 매수가 **지금 실제로 쓸 수 있는 재원**(+`extra`만큼 더 팔았다고 가정).
       * ⚠️ 재조정 발동 판정을 `cashTrade`만으로 하면 두 방향으로 틀린다:
       *    ① 기본 재원 모드('both')에서는 분배금 주머니가 이미 매수 재원인데 그것을 못 보고
       *       **쓸 필요가 없는 다른 종목을 팔아 치운다**(적대적 리뷰 확정).
       *    ② 현금 바닥선이 있으면 판 돈이 바닥선에 막혀 매수에 못 쓰이는데도 팔아 버려
       *       **매도만 남는 '나체 매도'**가 된다(같은 리뷰 확정).
       */
      const usableFor = (extra: number): number => {
        const avail = tradeOnly ? Math.max(0, cashTrade) + Math.max(0, cashReserve) : Math.max(0, cash);
        const withExtra = avail + extra;
        if (floorAmount <= 0) return withExtra;
        return Math.min(withExtra, Math.max(0, cash + extra - floorAmount));
      };

      /* ②-b 재조정 — 재원이 필요액에 못 미치면 **목표를 초과한 다른 보유 종목**을
       *      목표까지 팔아 재원을 만든다(= 사용자가 정한 비율/금액대로의 재조정).
       * ⚠️ **'목표까지'(pct=null) 단계에만 적용한다**(사용자 확정 2026-08) — 비율 매수는
       *    "가진 현금의 일부만 투입"이 규칙이라 재원 부족이라는 개념 자체가 없다. 비율 매수의
       *    필요액까지 needTotal에 넣으면 팔 이유가 없는 종목을 팔게 된다.
       * ⚠️ 초과분이 없으면(전 종목이 함께 하락) 아무것도 팔지 않고 ②-c로 넘어간다 — 그것이
       *    "보유 종목 전체가 하락했고 예수금이 없으면 누적 분배금을 쓴다"는 사양의 경로다. */
      // ⚠️ `!== false`로 읽는다(normalizeDip과 같은 규약) — 화면은 정규화를 거치지 않은 로컬
      //    사본을 그대로 넘길 수 있어, `config.dip.reallocate`가 undefined면 재조정이 조용히
      //    꺼진다(저장 전후 결과가 갈리는 최악의 상태 — 중복 낙폭 사고와 같은 부류).
      let realloc = 0;
      if (needTotal > 0 && config.dip.reallocate !== false && usableFor(0) < needTotal) {
        const buyIds = new Set(buyPos.map(p => p.asset.id));
        const donors = positions
          .filter(p => p.active && !p.removed && !buyIds.has(p.asset.id)
            && date >= p.effectiveStart && date <= p.effectiveEnd && p.qty > QTY_EPS)
          .map(planOf)
          .filter(x => !x.hit.missing && x.hit.price > 0 && x.evalBefore - x.target > 0)
          // 초과분이 큰 종목부터 — 필요액을 가장 적은 매매 건수로 채운다.
          .sort((a, b) => (b.evalBefore - b.target) - (a.evalBefore - a.target));
        let totalExcess = 0;
        for (const dp of donors) totalExcess += dp.evalBefore - dp.target;
        // ⚠️ **다 팔아도 쓸 수 있는 돈이 1원도 안 늘면 한 주도 팔지 않는다** — 바닥선에 막혀
        //    매수가 0주로 잘리는데 매도만 실행되는 '나체 매도'를 막는 유일한 방어선이다.
        if (usableFor(totalExcess) > usableFor(0)) {
          for (const dp of donors) {
            if (usableFor(0) >= needTotal) break;
            const tr = adjustTo(dp.p, date, dp.target, false);
            if (!tr || tr.qty >= 0) continue;
            tr.signal = 'realloc';
            pushTrade(tr);
            realloc += tr.cashDelta;
          }
        }
      }
      // ⚠️ 날짜 단위 값이라 그날 첫 매수 이벤트에만 싣는다(행마다 실으면 중복으로 읽힌다).
      {
        const first = evsByAsset.get(buyPos[0].asset.id);
        if (first) first[0].reallocAmount = realloc;
      }

      /* ②-c 실제 매수. */
      // 목표 매수액이 큰 종목부터 — 재원이 모자랄 때 큰 구멍부터 메운다.
      const ordered = [...buyPlans].sort((x, y) => {
        const px = evsByAsset.get(x.p.asset.id)?.[0].planned ?? 0;
        const py = evsByAsset.get(y.p.asset.id)?.[0].planned ?? 0;
        return py - px;
      });
      for (const b of ordered) {
        const list = evsByAsset.get(b.p.asset.id);
        if (!list) continue;
        const carrier = list[0];
        if (b.target - b.evalBefore <= 0) {
          if (!carrier.note) carrier.note = '목표 이상 — 살 것 없음';
          continue;
        }
        if (!(carrier.planned > 0)) {
          // ⚠️ '비율이 0%라 안 산다'와 '재원이 0원이라 못 산다'는 완전히 다른 사건이다 —
          //    뭉뚱그리면 사용자가 40%를 넣었는데 화면이 "매수 비율 0%"라고 단언한다
          //    (아래 `budget <= 0 → '재원 없음'` 분기는 이 가드에 가려 도달하지 못한다).
          if (!carrier.note) {
            carrier.note = carrier.pctSum === 0 ? '매수 비율 0% — 사지 않음'
              : poolAt <= 0 ? '재원 없음' : '매수 수량 0';
          }
          continue;
        }
        // ⚠️ `tradeOnly`는 분배금 주머니를 **완전히 잠근다**(사용자 확정 2026-08:
        //    "매매 예수금만 = 누적 매매현금 + 초기 예수금"). 옛 설계의 '단계 비율만큼 개방'은 폐기.
        //    정기 리밸런싱 runPlan과 **문자 그대로 같은 두 줄**이라야 두 경로가 갈리지 않는다.
        const divCap = tradeOnly ? 0 : Infinity;
        // ⚠️ 예비금은 **시그널 매수에서만** 열린다(사용자 정의). 재원 사다리는
        //    ① 매매 주머니 → ② 예비금 → ③ 재조정 매도 → ④ 분배금 개방 순이다.
        const reserveCap = Math.max(0, cashReserve);
        const budget = (tradeOnly ? Math.max(0, cashTrade) : cash - cashReserve) + reserveCap;
        const floorCap = floorAmount > 0 ? Math.max(0, cash - floorAmount) : Infinity;
        // ⚠️ 매수 상한은 목표가 아니라 **planned**다 — 비율 매수는 목표에 못 미치게 사는 것이 정상이고,
        //    목표를 그대로 넘기면 비율이 통째로 무시된다.
        const tr = adjustTo(b.p, date, b.evalBefore + carrier.planned, false, { budget, divCap, floorCap, reserveCap });
        if (!tr) {
          if (!carrier.note) carrier.note = budget <= 0 ? '재원 없음' : '매수 수량 0';
          continue;
        }
        tr.signal = 'buy';
        pushTrade(tr);
        carrier.tradeQty += tr.qty;
        carrier.tradeAmount += Math.abs(tr.cashDelta);
        if (tr.qty > 0) {
          carrier.used += lastDraw.fromDiv;
          carrier.fromTrade += lastDraw.fromTrade;
          carrier.fromReserve += lastDraw.fromReserve;
        }
        if (tr.note) carrier.note = tr.note;
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
      // ⚠️ 자르는 기준은 cashBefore가 아니라 **deployableCash**다(위 주석 참조) — tradeOnly·바닥선에서
      //    총 예수금으로 자르면 이 컷이 통째로 무력화된다. 기본값에서는 값이 같아 결과가 동일하다.
      const deployable = deployableCash(step.date);
      if ((!config.allowNegativeCash || config.cashFloorPct > 0) && amount > deployable) {
        amount = Math.max(0, deployable);
        note = config.buyFunding === 'tradeOnly' || config.cashFloorPct > 0 ? '가용 재원 한도' : '예수금 한도';
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

    if (step.kind === 'annual') {
      // ⚠️ 매월 증액(contrib)과 **완전히 독립**이다. KIND_ORDER가 contrib < annual 이라
      //    같은 날 둘 다 도래하면 매월 증액이 먼저 반영된 뒤의 예수금에서 잉여를 계산한다.
      const ar = config.annualReview;
      if (ar.mode !== 'pctOfSurplus' || !(ar.value > 0)) continue;
      // ⚠️ 비중 모드는 목표가 '평가액 합계 × 비중'이라 올릴 대상이 없다(매월 증액과 같은 이유).
      //    경고는 위 슬롯 준비 블록에서 한 번만 띄운다.
      if (config.targetMode === 'ratio') continue;
      const cashBefore = cash;
      // ⚠️ reserve(생활비 예약금)는 **절대 투자에 쓰지 않는다** — surplus로 상한을 둬서 잘라 낸다.
      // ⚠️ 예비금과 예약금은 성격이 다르지만 **둘 다 이 증액의 재원이 아니다** — 함께 뺀다.
      const surplus = Math.max(0, cashBefore - cashReserve - Math.max(0, ar.reserve));
      const requested = (surplus * ar.value) / 100;
      let amount = Math.min(requested, surplus);
      let note = amount < requested ? '예약금 한도' : '';
      // 매월 증액과 같은 컷 규약을 그대로 재사용한다 — 기준은 **deployableCash**(위 주석 참조).
      // ⚠️ tradeOnly·바닥선에서 총 예수금으로 자르면 컷이 무력화돼 목표만 부푼다(매월 증액과 동일 결함).
      const deployableA = deployableCash(step.date);
      if ((!config.allowNegativeCash || config.cashFloorPct > 0) && amount > deployableA) {
        amount = Math.max(0, deployableA);
        note = config.buyFunding === 'tradeOnly' || config.cashFloorPct > 0 ? '가용 재원 한도' : '예수금 한도';
      }
      amount = Math.floor(amount);
      if (!(amount > 0)) continue;

      // 매월 증액과 동일하게 **그 달 리밸런싱 슬롯에 실제로 든 종목**만 대상이다
      // (슬롯 없는 종목에 배분하면 목표만 오르고 영원히 매수되지 않는다).
      const slotAssets = contribAssetsByYm.get(step.ym) ?? new Set<string>();
      const live = positions.filter(
        p => p.active && !p.removed && step.date >= p.effectiveStart && step.date <= p.effectiveEnd,
      );
      const elig = live.filter(p => slotAssets.has(p.asset.id));
      if (!elig.length) continue;

      const perAsset: BtContribRow['perAsset'] = [];
      const ws = elig.map(p => (ar.split === 'even' ? 1 : Math.max(0, p.targetAmount ?? 0)));
      let totalW = ws.reduce((s, x) => s + x, 0);
      if (!(totalW > 0)) { ws.fill(1); totalW = elig.length; }
      let left = amount;
      elig.forEach((p, i) => {
        const share = i === elig.length - 1 ? left : Math.floor((amount * ws[i]) / totalW);
        left -= share;
        p.targetAmount = (p.targetAmount ?? 0) + share;
        perAsset.push({
          assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
          added: share, targetAfter: p.targetAmount,
        });
      });

      const row: BtContribRow = {
        ym: step.ym, date: step.date, cashBefore, requested, amount,
        mode: 'pctOfSurplus', value: ar.value, overridden: false,
        perAsset, note, reserve: Math.max(0, ar.reserve),
      };
      monthOf(step.ym).annualReview = row;
      annualRows.push(row);
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

      // ⚠️ 현금 바닥선의 기준은 **활성 종목 목표금액 합계**다. 슬롯에 든 종목만이 아니라
      //    그 시점 살아 있는 전 종목이 기준이어야 "포트폴리오 규모 대비 N%"라는 뜻이 유지된다.
      const floorAmount = config.cashFloorPct > 0
        ? (activeTargetSum(s.rebalDate, base) * config.cashFloorPct) / 100
        : 0;
      const bandPct = Math.max(0, config.band);
      const tradeOnly = config.buyFunding === 'tradeOnly';

      // ⚠️ 매도/매수 분할은 **실행 전에** 확정해야 한다. 실행 중 다시 판정하면 방금 매도해
      //    목표에 맞춰진 종목이 매수 패스에 또 걸리고(중복 처리), 반대로 매수 재원이 마련되기
      //    전에 매수가 예수금 한도에 막혀 조용히 목표 미달로 끝난다.
      const plans = eligible.map(p => {
        const hit = priceAt(prices[p.asset.code], s.rebalDate);
        const evalBefore = hit.missing ? 0 : p.qty * hit.price;
        const target = targetOf(p, config, base);
        return { p, hit, evalBefore, target, delta: hit.missing ? 0 : target - evalBefore };
      });

      // ── 리밸런싱 밴드 — 목표 대비 ±band% 안이면 그 회차 매매를 생략한다 ──
      // ⚠️ 목표 0(전량 청산)은 밴드 폭도 0이라 산술적으로 이미 예외다(`|평가액−0| > 0`).
      //    아래 `target > 0` 줄은 그 사실을 눈에 보이게 적어 둔 **방어적 중복**이라 지워도 동작은
      //    같다(변이 테스트에서 equivalent mutant로 확인됨). 지우지 말고 그대로 둘 것 —
      //    "청산은 항상 완결한다"가 이 코드의 계약임을 읽는 사람에게 알리는 유일한 단서다.
      // ⚠️ 시그널 리밸런싱은 **자기 발동일에 이미 체결**돼 여기 도달하지 않는다 — 옛 설계처럼
      //    '급락 발동 종목은 밴드 면제'를 여기서 다시 판정하지 말 것(그 상태 자체가 사라졌다).
      // ⚠️ 밴드 안이라도 반올림 결과 매매가 0주면 원래 아무 일도 없었으므로 '생략'으로 세지 않는다.
      const banded = new Set<string>();
      if (bandPct > 0) {
        for (const pl of plans) {
          if (pl.hit.missing || pl.hit.price <= 0) continue;
          if (!(pl.target > 0)) continue;
          if (Math.abs(pl.evalBefore - pl.target) > (pl.target * bandPct) / 100) continue;
          banded.add(pl.p.asset.id);
          const wouldQty = roundQty(pl.delta / pl.hit.price, config.rounding);
          if (wouldQty !== 0) {
            const bm = monthOf(ymOf(s.rebalDate));
            bm.bandSkipCount++;
            bm.bandSkipAmount += Math.abs(wouldQty * pl.hit.price);
          }
        }
      }

      const runPlan = (pl: (typeof plans)[number]) => {
        const id = pl.p.asset.id;
        if (banded.has(id)) return;
        // ⚠️ 'both'(기본)면 종전 그대로 전체 예수금이 재원이고 분배금 상한도 없다 — 이 두 줄이
        //    기본값 하위호환의 전부다. 'tradeOnly'는 평시에 분배금 주머니를 잠근다
        //    (열리는 것은 시그널 발동일뿐이고, 그 매수는 signal 스텝에서 이미 끝난다).
        const budget = tradeOnly ? Math.max(0, cashTrade) : cash - cashReserve;
        const divCap = tradeOnly ? 0 : Infinity;
        const floorCap = floorAmount > 0 ? Math.max(0, cash - floorAmount) : Infinity;
        const t = adjustTo(pl.p, s.rebalDate, pl.target, false, { budget, divCap, floorCap });
        if (t) pushTrade(t);
      };
      for (const pl of plans.filter(x => x.delta < 0)) runPlan(pl);
      for (const pl of plans.filter(x => x.delta > 0)) runPlan(pl);
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
  let cumAnnual = 0;
  let cumDivTax = 0;
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
    cumDivTax += m.divTax;
    cumContrib += m.contribution ? m.contribution.amount : 0;
    cumAnnual += m.annualReview ? m.annualReview.amount : 0;
    m.cumTradeNet = cumTrade;
    m.cumReinvestNet = cumReinvest;
    m.cumDivAccrued = cumDivAccrued;
    m.cumDivPaid = cumDivPaid;
    m.cumDivTax = cumDivTax;
    m.cumContribution = cumContrib;
    m.cumAnnualReview = cumAnnual;
    m.shortfallCount = shortfallByYm.get(m.ym) ?? 0;
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
      let t = config.initialCapital;
      let d = 0;
      let rr = config.extraCash;
      for (const bkt of bucketLog) {
        if (bkt.date > lastBiz) break;
        t = bkt.t; d = bkt.d; rr = bkt.r;
      }
      m.cashTradeEnd = t;
      m.cashDivEnd = d;
      m.cashReserveEnd = rr;
    }
    {
      const dr = drawByYm.get(m.ym);
      m.cashUsedTrade = dr ? dr.fromTrade : 0;
      m.cashUsedDiv = dr ? dr.fromDiv : 0;
      m.cashUsedReserve = dr ? dr.fromReserve : 0;
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
      // ⚠️ 곡선의 현금도 **세후**로 들어와야 실제 cash와 갈리지 않는다(divTaxRate=0이면 종전과 동일).
      for (const d of m.dividends) divByDate.set(d.payDate, (divByDate.get(d.payDate) ?? 0) + d.amount * (1 - divTaxRate));
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

  /* ── 생존 판정 지표 ─────────────────────────────────────────────────────── */
  // 총 예수금 최저점 — 이 전략에서 "언제 목표 복원이 불가능해졌는가"를 답하는 값.
  let minCash = { value: 0, date: '' };
  for (const c of curve) {
    if (!minCash.date || c.cash < minCash.value) minCash = { value: c.cash, date: c.date };
  }
  // 분배금 주머니 최저점 — cashDiv는 0에서 시작하므로 **첫 입금 이후**만 잰다(안 그러면 항상 0).
  let minCashDiv = { value: 0, date: '' };
  if (firstDivDate) {
    for (const b of bucketLog) {
      if (b.date < firstDivDate) continue;
      if (!minCashDiv.date || b.d < minCashDiv.value) minCashDiv = { value: b.d, date: b.date };
    }
  }
  // 월 분배금 평균 / 모표준편차 — 첫 분배가 있었던 달부터 마지막 달까지(연속 구간).
  // ⚠️ 이후의 진짜 0원 달('분배가 끊겼다')은 반드시 포함해야 변동성이 드러난다.
  let divMonthlyAvg = 0;
  let divMonthlyStdev = 0;
  {
    let firstIdx = -1;
    for (let i = 0; i < months.length; i++) {
      if (months[i].divAccrued > 0) { firstIdx = i; break; }
    }
    if (firstIdx >= 0) {
      const vals = months.slice(firstIdx).map(m => m.divAccrued);
      divMonthlyAvg = vals.reduce((s, x) => s + x, 0) / vals.length;
      divMonthlyStdev = Math.sqrt(
        vals.reduce((s, x) => s + (x - divMonthlyAvg) * (x - divMonthlyAvg), 0) / vals.length,
      );
    }
  }
  let bandSkipCount = 0;
  let bandSkipAmount = 0;
  let shortfallMonths = 0;
  // 매수 대금 중 적립 분배금 주머니에서 꺼낸 총액 — 기말 현금 분해 항등식 2개의 연결 항.
  // ⚠️ `drawByYm`이 아니라 **months를 돌아** 합산한다(둘은 같은 값이지만 표에 렌더되는 값과
  //    합계가 같은 소스에서 나와야 화면과 카드가 갈리지 않는다).
  let cumDivDrawn = 0;
  let cumReserveDrawn = 0;
  for (const m of months) {
    bandSkipCount += m.bandSkipCount;
    bandSkipAmount += m.bandSkipAmount;
    cumDivDrawn += m.cashUsedDiv;
    cumReserveDrawn += m.cashUsedReserve;
    if (m.shortfallCount > 0) shortfallMonths++;
  }

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
    annualRows,
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
      cumDivTax,
      cumContribution: cumContrib,
      cumAnnualReview: cumAnnual,
      finalCashTrade: cashTrade, finalCashDiv: cashDiv, finalCashReserve: cashReserve, cumDivDrawn, cumReserveDrawn,
      maxDrawdown: maxDd,
      months: months.length,
      minCash, minCashDiv,
      divMonthlyAvg, divMonthlyStdev,
      bandSkipCount, bandSkipAmount,
      signalEvents,
      shortfallMonths,
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
