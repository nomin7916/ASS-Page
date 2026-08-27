// ── 자산검증: 두 날짜(기준일 · 비교일) 비교 모델 ─────────────────────────────
// "트레이딩하고 난 결과를 종합적으로 확인 분석" — 같은 계좌의 두 날짜를 종목 단위로
// 맞대어 ① 기준일 ② 비교일 ③ 증감 ④ **반사실**(비교일 보유를 그대로 들고 있었다면
// 기준일에 얼마인가)을 만든다. ④가 이 기능의 분석적 핵심이다.
//
// ⚠️ import에 `.ts` 확장자를 쓴 것은 의도다 — 지우지 말 것. 이 모듈은
//    `scripts/verify-compare.mjs`가 **미러 없이 직접 import**해 검증한다(미러는 src에만
//    넣은 변경·미러에만 넣은 변경이 둘 다 통과하는 구멍을 만든다). Node의 타입 스트리핑은
//    ESM이라 확장자 없는 상대 경로를 해석하지 못해(`ERR_MODULE_NOT_FOUND`) 그 순간 검증이
//    통째로 죽는다(`portfolioExcel.ts`와 같은 규약).
// ⚠️ `enum`·`namespace` 금지(타입 스트리핑 미지원). 타입 별칭·인터페이스·`as`는 안전.
// ⚠️ **읽기 전용 모듈** — 저장·네트워크·전역 상태를 건드리지 않는다. 특히
//    `dividendHistory`(API 새로고침이 얕은 병합으로 덮어쓴다)와 `stockHistoryMap`
//    (평가액 재계산의 권위 소스)에 **절대 쓰지 않는다**.
import {
  cleanNum, resolveHoldings, calcPortfolioEvalDetail, buildHeldNameMap,
  overseasInvestAmount, externalFlowInRange, bookCostOf,
} from './utils.ts';

// 흐름 판정 상수 — CLAUDE.md 일간 지표 절의 `MATERIAL_FLOW_RATIO`(1%)·`ABSORBED_RATIO`(0.5)와
// **같은 값**이다(그쪽은 모듈 지역 상수라 import할 수 없어 값만 복제한다).
const FLOW_MATERIAL_RATIO = 0.01;
const FLOW_ABSORBED_RATIO = 0.5;

// ── 분배금 대상 판정 ────────────────────────────────────────────────────────
// ⚠️ `DividendSummaryTable.tsx`의 `isKrCode`/`isUsCode`/`getCodeType`과 **같은 규칙**이어야
//    한다 — 다르면 분배금 현황 표에는 있는 종목이 비교표에서 빠지거나 그 반대가 된다.
//    (그쪽은 모듈 스코프 비export라 재사용할 수 없어 규칙만 복제한다.)
const isKrCode = (code: string): boolean => /^[A-Z0-9]{5,6}$/i.test(String(code || ''));
const isUsCode = (code: string): boolean => /^[A-Z]{1,5}$/i.test(String(code || ''));
export const dividendCodeType = (code: string, isOverseas: boolean): string | null => {
  if (isOverseas) return isUsCode(code) ? 'us' : null;
  return isKrCode(code) ? 'kr' : null;
};

/** 분배금 원천징수가 없는(과세이연) 계좌 — 실입금 역산에서 세후 = 세전으로 볼 수 있다. */
export const isTaxDeferredAccount = (accountType: string): boolean =>
  accountType === 'pension' || accountType === 'dc-irp' || accountType === 'isa';

/** 'YYYY-MM' → 그 달의 마지막 날 'YYYY-MM-DD'. UTC 기준이라 타임존 영향이 없다. */
export const lastDayOfMonth = (ym: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  return d.toISOString().slice(0, 10);
};

/** 'YYYY-MM' + n개월 → 'YYYY-MM'. UTC 산술이라 타임존 영향이 없다. */
export const addMonthsYm = (ym: string, n: number): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export type PerShareSource = 'paid' | 'declared' | 'predicted' | 'manual' | 'none';

export interface PerShareInfo {
  /** 주당분배금(세전). 산출 불가면 0 — ⚠️ '0원 분배'가 아니라 '모름'이다(호출부는 빈 셀). */
  perShare: number;
  /** 채택한 배당락월 'YYYY-MM' (없으면 '') */
  ym: string;
  source: PerShareSource;
  /** 실입금액에서 역산했는가(공시 주당액이 없어서) */
  derived: boolean;
  /** 아직 확정되지 않은 다가오는 회차(있으면 UI가 '예상 N 적용' 칩으로 제시) */
  upcoming: { ym: string; perShare: number } | null;
}

/**
 * 화면·엑셀·모델이 공유하는 '주당분배금 값이 확정됐는가' 판정.
 * ⚠️ 사용자가 **직접 0을 입력한 것은 '분배 없음' 확정**이고 빈칸(모름)과 다르다 —
 *    `perShare > 0`으로만 재면 그 입력이 무시되고 "직접 입력하면 반영됩니다" 경고까지 뜬다.
 */
export const perShareValueOf = (info: PerShareInfo | null | undefined): number | null => {
  if (!info) return null;
  if (info.source === 'manual') return info.perShare >= 0 ? info.perShare : null;
  return info.perShare > 0 ? info.perShare : null;
};

const EMPTY_PER_SHARE: PerShareInfo = { perShare: 0, ym: '', source: 'none', derived: false, upcoming: null };

/**
 * 특정 날짜 시점에 **알 수 있었던** 최신 주당분배금(세전).
 *
 * 규칙(사용자 확정 2026-08 — '각 날짜 시점의 최신 확정값'):
 *   1. 후보 배당락월(ym) = `dividendHistory[code]` ∪ 실입금 맵의 키
 *   2. known-at(date) — 배당락일에 주당분배금이 공시된다는 근거로 판정한다:
 *      ① `dividendExDate[code][ym]`(실제 배당락일)이 있으면 `그 날짜 <= date`
 *      ② 없으면 **같은 월(MM)의 다른 연도 배당락일에서 '일(日)'을 빌려** 추정
 *         (`DividendSummaryTable.buildMonthExPrediction`과 같은 규칙 — 월중형(15일) 배당을
 *         월말까지 기다리면 이미 지급된 이번 달 값을 못 쓴다)
 *      ③ 그것도 없으면 그 달의 말일
 *   3. known 중 **가장 늦은 ym**부터 내려오며 값이 나오는 첫 회차를 채택
 *      - `dividendHistory[code][ym] > 0` → 그 값(세전 공시). 실입금 기록도 있으면 'paid', 없으면 'declared'
 *      - 없으면 실입금 **역산**(수량 = `actualDividendQty[code][ym]`):
 *        국내 과세계좌는 **세액이 입력돼 있을 때만** `(세후 + 세액)/수량`,
 *        과세이연 계좌(연금·IRP·ISA)는 `세후/수량`, 해외는 `세전USD/수량`
 *   4. known이 하나도 없으면 **예상**: `date`보다 **이전 달** 중 같은 월(MM)의 가장 최근 값('predicted')
 *   5. 그래도 없으면 0('none') — 사용자가 직접 입력해야 분배금이 채워진다
 *
 * ⚠️ **휴장일 캘린더를 쓰지 않는다**(지급일 = 배당락+2영업일 계산 회피). `marketHolidays`는
 *    VerifyEvalModal까지 배선돼 있지 않고 **카드 별도 창(stats)** 은 애초에 받지도 않는다
 *    (`CARD_NEEDS.stats`에 dividend 없음) → 지급일 기준으로 바꾸면 앱과 창의 값이 갈린다.
 * ⚠️ 세전으로 통일한다. 국내 `actualDividend`는 세후, 해외 `actualDividendUsd`는 세전인
 *    비대칭이 있지만 `dividendHistory`(주당액)는 양쪽 다 **세전 공시액**이다.
 * ⚠️ 4단계에서 `date`보다 뒤의 연도 값을 끌어오지 말 것(look-ahead) — 2024년 행에 2026년
 *    공시액이 들어가 증감이 통째로 왜곡된다.
 */
export const resolvePerShareAsOf = (
  pf: any,
  code: string,
  date: string,
  isOverseas: boolean,
  taxDeferred = false,
): PerShareInfo => {
  const c = String(code || '');
  if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return EMPTY_PER_SHARE;
  const hist = (pf?.dividendHistory || {})[c] || {};
  const exMap = (pf?.dividendExDate || {})[c] || {};
  const actualKrw = (pf?.actualDividend || {})[c] || {};
  const actualUsd = (pf?.actualDividendUsd || {})[c] || {};
  const taxMap = (pf?.dividendTaxAmounts || {})[c] || {};
  const qtyMap = (pf?.actualDividendQty || {})[c] || {};
  const actualMap = isOverseas ? actualUsd : actualKrw;

  const yms = [...new Set([...Object.keys(hist), ...Object.keys(actualMap)])]
    .filter(ym => /^\d{4}-\d{2}$/.test(ym))
    .sort();
  if (yms.length === 0) return EMPTY_PER_SHARE;

  // 같은 월(MM)의 가장 최근 연도 배당락 '일(日)' — 배당락일이 비어 있는 회차의 추정용.
  const exDayByMonth: Record<string, string> = {};
  Object.keys(exMap).sort().forEach(ym => {
    const v = String(exMap[ym] || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) exDayByMonth[ym.slice(5, 7)] = v.slice(8, 10);
  });

  const exDateFor = (ym: string): string => {
    const exact = String(exMap[ym] || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(exact)) return exact;
    const dd = exDayByMonth[ym.slice(5, 7)];
    if (dd) return `${ym}-${dd}`;
    return lastDayOfMonth(ym);
  };
  const knownAt = (ym: string): boolean => {
    const ex = exDateFor(ym);
    return !!ex && ex <= date;
  };

  // 다가오는 회차(아직 확정 아님) — UI 힌트 전용. 값이 있는 것 중 가장 이른 것.
  // ⚠️ **그 날짜 기준 2개월 안**으로 제한한다 — 제한이 없으면 과거 비교일 칸에 몇 달 뒤 공시액을
  //    "아직 배당락 전"이라며 적용하는 버튼이 뜬다(4단계에서 막아 둔 look-ahead를 UI로 되살리는 셈).
  const horizonYm = addMonthsYm(String(date).slice(0, 7), 2);
  const upcomingYm = yms.find(ym => !knownAt(ym) && ym <= horizonYm && cleanNum(hist[ym]) > 0) || '';
  const upcoming = upcomingYm ? { ym: upcomingYm, perShare: cleanNum(hist[upcomingYm]) } : null;

  const known = yms.filter(knownAt);
  for (let i = known.length - 1; i >= 0; i--) {
    const ym = known[i];
    const declared = cleanNum(hist[ym]);
    const hasActual = ym in actualMap;
    if (declared > 0) {
      return { perShare: declared, ym, source: hasActual ? 'paid' : 'declared', derived: false, upcoming };
    }
    if (hasActual) {
      // 공시 주당액이 없을 때만 실입금에서 역산한다.
      // ⚠️ 수량은 `actualDividendQty`(사용자가 그 회차에 대해 직접 적어 둔 수량)뿐이다.
      //    그 날짜의 보유수량으로 나누면 배당락일 이후 매매가 섞여 조용히 틀린다 → 없으면 역산 포기.
      const qty = cleanNum(qtyMap[ym]);
      if (qty > 0) {
        let gross = 0;
        if (isOverseas) {
          gross = cleanNum(actualUsd[ym]); // 해외 실입금은 세전 USD로 저장된다
        } else {
          const net = cleanNum(actualKrw[ym]); // 국내 실입금은 **세후**
          const tax = cleanNum(taxMap[ym]);
          // ⚠️ 세액이 없는 과세계좌에서 세후를 세전이라 단언하지 말 것(−15.4% 오차).
          //    명시적 미적용(역산 포기) → 더 과거 회차나 예상값으로 내려간다.
          if (tax > 0) gross = net + tax;
          else if (taxDeferred) gross = net;
        }
        if (gross > 0) return { perShare: gross / qty, ym, source: 'paid', derived: true, upcoming };
      }
    }
  }

  // 확정된 회차가 하나도 없으면 **date 이전 달** 중 같은 월(MM)의 가장 최근 값으로 예상.
  const curYm = String(date).slice(0, 7);
  const mm = String(date).slice(5, 7);
  const sameMonth = yms.filter(ym => ym.slice(5, 7) === mm && ym < curYm && cleanNum(hist[ym]) > 0);
  if (sameMonth.length) {
    const ym = sameMonth[sameMonth.length - 1];
    return { perShare: cleanNum(hist[ym]), ym, source: 'predicted', derived: false, upcoming };
  }
  return { ...EMPTY_PER_SHARE, upcoming };
};

// ── 행 모델 ─────────────────────────────────────────────────────────────────

/** 한 날짜(또는 반사실)에서의 종목 값. 그 날짜에 보유하지 않았으면 수량·평가금이 null이다. */
export interface EvalCompareSide {
  /** 그 날짜에 실제로 보유했는가. false면 종가만 있는 '참고 행'이다. */
  held: boolean;
  quantity: number | null;
  /** 그 날짜의 종가/기준가. 보유하지 않아도 프로브(수량 1)로 채운다. */
  price: number | null;
  /** 'history'|'manual'|'approximate'|'none'|'deposit'|'savings'|'currentPrice'|'evalAmount' */
  source: string;
  /**
   * 평가금(원화). 해외계좌는 **그 날짜 환율로 원화 환산된 값**(calcPortfolioEvalDetail 규약).
   * ⚠️ 보유 중인데 그 날짜 종가를 못 구했으면 **null**이다(0으로 단언 금지 — 총액이 그만큼
   *    작아진 사실은 `priceMissing`으로 따로 알린다).
   */
  evalAmount: number | null;
  /** 계좌 통화 기준 평가금(해외=USD, 그 외=원화). 화면·엑셀의 주 열은 이 값을 쓴다. */
  evalNative: number | null;
  investAmount: number | null;
  purchasePrice: number | null;
  /** 그 블록 총 평가금 대비 비중(0~1). 총액이 0이면 null. */
  ratio: number | null;
  /** 분배금(세전, 계좌 통화) = 수량 × 주당분배금. 산출 불가면 null(⚠️ 0으로 단언 금지). */
  dividend: number | null;
  perShare: PerShareInfo | null;
  /** 보유 중인데 그 날짜 종가를 못 구했다(평가금이 총액에서 빠졌다). */
  priceMissing: boolean;
}

export interface EvalCompareRow {
  key: string;
  type: string;
  code: string;
  name: string;
  dividendEligible: boolean;
  basis: EvalCompareSide | null;
  compare: EvalCompareSide | null;
  /** 반사실 = 비교일 보유를 기준일 종가로 평가 */
  counter: EvalCompareSide | null;
}

export interface EvalCompareTotals {
  /** 원화 총액(해외계좌는 그 날짜 환율 환산) */
  evalAmount: number;
  /** 계좌 통화 총액(해외=USD) — 증감·비율은 전부 이 프레임에서 계산한다 */
  evalNative: number;
  investAmount: number;
  dividend: number;
  /** 보유 중인데 주당분배금을 몰라 분배금 합계에서 빠진 종목이 있는가 */
  dividendPartial: boolean;
  /** 보유 중인데 그 날짜 종가를 못 구해 평가액에서 빠진 종목이 있는가(총액 과소) */
  priceMissing: boolean;
}

export interface EvalCompareResult {
  basisDate: string;
  compareDate: string;
  isOverseas: boolean;
  isGold: boolean;
  /** 해외계좌: 각 날짜에 적용된 환율(원/USD). 그 외 1. */
  fxBasis: number;
  fxCompare: number;
  /** 보유수량이 추정(스냅샷 없음·pre-baseline)인가 — 수량 증감이 거짓일 수 있다 */
  estimatedBasis: boolean;
  estimatedCompare: boolean;
  /**
   * 그 날짜의 정확한 종가로만 평가됐는가(false면 근사·이월이 섞였다).
   * ⚠️ `allExactCounter`는 **반사실 블록**(비교일 보유를 기준일 종가로 평가) 전용이다 —
   *    기준일에 이미 매도한 종목의 종가는 `stockHistoryMap` 수집 대상이 아니라
   *    (`useStockData`는 현재 보유 코드 위주로 모은다) A·B가 둘 다 exact인데 C만 근사인
   *    상황이 실제로 생긴다. 빠뜨리면 그 경고가 화면·엑셀 어디에도 뜨지 않는다.
   */
  allExactBasis: boolean;
  allExactCompare: boolean;
  allExactCounter: boolean;
  rows: EvalCompareRow[];
  totals: { basis: EvalCompareTotals; compare: EvalCompareTotals; counter: EvalCompareTotals };
  /** 기준일 − 비교일 (계좌 통화) */
  diffEval: number;
  /** (기준일 − 비교일) ÷ 비교일. 비교일이 0 이하면 null. */
  diffRate: number | null;
  /** (반사실 − 비교일) ÷ 비교일. 비교일이 0 이하면 null. */
  counterRate: number | null;
  /**
   * (비교일, 기준일] 순 외부 입출금(계좌 통화).
   * ⚠️ `externalFlowInRange` 규약 — 입금은 `noPrincipal`(배당·이자) 제외, 출금은 전액.
   */
  netFlow: number;
  /**
   * 거래 효과 = (실제 기준일 총액 − 반사실 총액) − 순 외부 입출금.
   * ⚠️ 순흐름을 빼지 않으면 **입금액이 통째로 거래 성과로 계상**된다(CLAUDE.md의 일간 지표
   *    절이 고친 바로 그 버그). 그 사이 받은 분배금·이자와 새 자금의 운용 성과는 여기 남는다.
   */
  tradeEffect: number;
  /**
   * 원장의 순 입출금이 두 날짜의 **장부액 변화로 관측되는가**.
   * ⚠️ `DepositPanel`은 `portfolio`를 참조하지 않아 **원장 입금일과 예수금 반영일이 어긋나는 것이
   *    구조적 정상**이다(CLAUDE.md). 그 구간에서 순흐름을 그대로 빼면 입금액 전액이 **가짜 손실**로
   *    단언된다(실측 −₩10,000,000). 장부액(예수금 + 매입원가)은 매매로는 변하지 않고 외부 입출금으로만
   *    변하므로, 그 변화가 흐름을 설명하지 못하면 거래 효과를 내지 않는다.
   */
  flowReflected: boolean;
  /** 관측된 장부액 변화(기준일 − 비교일, 계좌 통화). 보유수량이 추정이면 null. */
  bookDelta: number | null;
  /** 종가 미확보·흐름 미반영으로 `tradeEffect`를 단언할 수 없으면 false */
  tradeEffectValid: boolean;
  tradeEffectDividend: number;
  /** 주당분배금 미확인 종목이 있어 분배금 차이가 과소한가 */
  tradeEffectDividendPartial: boolean;
}

/** 행 조인 키. ⚠️ 스냅샷 items에는 `id`가 없다(`snapshotItemsFromPortfolio`) — 절대 id로 조인하지 말 것. */
export const joinKeyOf = (item: any): string => {
  const type = String(item?.type || 'stock');
  if (type === 'deposit') return 'deposit'; // 예수금 행은 계좌당 하나로 합산한다
  const code = String(item?.code || '').trim().toUpperCase();
  if (code) return `${type}|${code}`;
  return `${type}|@${String(item?.name || '').trim()}`;
};

const num = (v: any): number | null => {
  const n = cleanNum(v);
  return Number.isFinite(n) ? n : null;
};

/** 미입력(''·null·undefined)은 0이 아니라 빈 값이다 — `portfolioExcel.numOrBlank`와 같은 계약. */
const numOrBlank = (v: any): number | null =>
  (v === '' || v === null || v === undefined) ? null : num(v);

/** 가격을 필요로 하는 항목인가(예수금·예적금은 종가 개념이 없다). */
const isPricedType = (type: string): boolean => type === 'stock' || type === 'fund';

interface SideCalc {
  detail: Map<string, any>;
  total: number;
  fxRate: number;
  estimated: boolean;
  allExact: boolean;
}

export interface EvalCompareInput {
  portfolio: any;
  accountType: string;
  basisDate: string;
  compareDate: string;
  stockHistoryMap: Record<string, Record<string, number>>;
  indicatorHistoryMap: Record<string, any>;
  /** 라이브 환율(해외계좌에서 그 날짜 환율을 못 구했을 때의 폴백) */
  fxRate?: number;
  /** 입출금 원장 — '거래 효과'에서 순 외부흐름을 빼기 위해 필요하다(없으면 흐름 0으로 본다). */
  depositHistory?: any[] | null;
  depositHistory2?: any[] | null;
  /**
   * 사용자가 모달에서 직접 입력한 주당분배금(세전). 키 = `joinKeyOf` 결과, 값은 **원시 문자열 허용**.
   * ⚠️ **모달 로컬 값**이다 — 저장하지 않는다(사용자 확정 2026-08 '이번 모달에서만').
   */
  perShareOverride?: { basis?: Record<string, any>; compare?: Record<string, any> } | null;
}

/**
 * 두 날짜 비교 모델을 만든다.
 *
 * ⚠️ 평가금은 **저장된 `evalAmount`가 아니라 항상 '수량 × 종가' 재계산**이다
 *    (CLAUDE.md '시장 계좌 평가액 추이·팝업 = 항상 수량×종가 단일 소스').
 * ⚠️ 반사실은 손산식이 아니라 **같은 함수를 기준일로 재호출**해 만든다 —
 *    펀드 NAV 폴백·예적금 단리·예수금 환율 규약이 전부 그 함수 안에 있어서, 손으로 곱하면
 *    그 규약들이 조용히 갈린다.
 * ⚠️ 해외계좌의 증감·비율은 **USD 프레임**으로 계산한다 — 원화 차이를 쓰면 종목·수량이
 *    완전히 같은데도 환율 변동만으로 '이익'이 찍힌다(CLAUDE.md '수익금은 USD − USD').
 */
export const buildEvalCompare = (input: EvalCompareInput): EvalCompareResult => {
  const {
    portfolio, accountType, basisDate, compareDate,
    stockHistoryMap, indicatorHistoryMap, fxRate = 1,
    depositHistory = null, depositHistory2 = null, perShareOverride = null,
  } = input;

  const isOverseas = accountType === 'overseas';
  const isGold = accountType === 'gold';
  const taxDeferred = isTaxDeferredAccount(accountType);
  const mpo = portfolio?.manualPriceOverrides || {};
  const imap = indicatorHistoryMap || {};
  const smap = stockHistoryMap || {};
  const nameMap = buildHeldNameMap(portfolio);

  const calcSide = (items: any[], date: string, estimated: boolean): SideCalc => {
    const r = calcPortfolioEvalDetail(items || [], accountType, date, smap, imap, fxRate, mpo);
    const detail = new Map<string, any>();
    (r.items || []).forEach((d: any) => {
      const k = joinKeyOf(d);
      const prev = detail.get(k);
      // 같은 키가 두 번(예수금 여러 행)이면 합산한다 — 화면의 '예수금 (CASH)' 한 줄과 같은 취급.
      if (prev) {
        detail.set(k, {
          ...prev,
          quantity: (prev.quantity == null && d.quantity == null) ? null : cleanNum(prev.quantity) + cleanNum(d.quantity),
          eval: cleanNum(prev.eval) + cleanNum(d.eval),
          price: prev.price != null ? prev.price : d.price,
          source: prev.source === 'none' ? d.source : prev.source,
        });
      } else detail.set(k, d);
    });
    return {
      detail, total: cleanNum(r.total), fxRate: cleanNum(r.fxRate) || 1,
      estimated, allExact: !!r.allExact,
    };
  };

  const rA = resolveHoldings(portfolio, basisDate);
  const rB = resolveHoldings(portfolio, compareDate);

  // ⚠️ `calcPortfolioEvalDetail`은 **이름이 빈 항목에 기본 이름을 대입**한다(금현물 → 'KRX 금현물',
  //    예적금 → '예적금'). 그 detail을 그대로 조인 키로 쓰면 원본(`stock|@`)과 detail
  //    (`stock|@KRX 금현물`)이 어긋나 그 행이 통째로 '보유 없음'이 되고, 값은 TOTAL에만 남아
  //    화면이 조용히 모순된다(금현물 계좌는 `KrxGoldTable`에 이름·코드 입력칸이 아예 없고,
  //    `handleAddSavings`도 `name:''`로 만든다 — 적대적 리뷰가 실측으로 재현했다).
  //    → **평가에 넘기기 전에 이름을 채워** 양쪽 키를 같게 만든다. utils의 기본값과 문자열이 같을
  //    필요는 없다(utils가 `item.name || 기본값`이라 채워져 있으면 그 값을 그대로 쓴다).
  const withKeyName = (it: any): any => {
    const t = String(it?.type || 'stock');
    if (t === 'deposit') return it; // 예수금 키는 이름과 무관
    if (String(it?.code || '').trim() || String(it?.name || '').trim()) return it;
    return { ...it, name: t === 'savings' ? '예적금' : (isGold ? 'KRX 금현물' : '(이름 없음)') };
  };
  const itemsA0 = (rA.items || []).map(withKeyName);
  const itemsB0 = (rB.items || []).map(withKeyName);

  const A = calcSide(itemsA0, basisDate, !!rA.estimated);
  const B = calcSide(itemsB0, compareDate, !!rB.estimated);
  // 반사실: **비교일 보유**를 **기준일 날짜**로 평가한다(같은 함수 재호출 — 손산식 금지).
  const C = calcSide(itemsB0, basisDate, !!rB.estimated);

  const fxB = A.fxRate > 0 ? A.fxRate : 1;
  const fxC = B.fxRate > 0 ? B.fxRate : 1;
  /** 원화 환산값 → 계좌 통화(해외=USD). 그 블록이 평가에 쓴 날짜의 환율로 되돌린다. */
  const toNative = (v: number | null, fx: number): number | null =>
    v == null ? null : (isOverseas ? v / (fx || 1) : v);

  // 원본 item(투자금액·구매단가 보존)을 키로 찾을 수 있게 모은다.
  // ⚠️ 같은 코드가 여러 행이면 구매단가는 **수량 가중평균**, 해외 투자금액은 **행별 합**이다.
  //    첫 행 단가를 합산 수량에 곱하면(옛 구현) 투자금액이 조용히 틀린다.
  const itemsOf = (items: any[]): Map<string, any> => {
    const m = new Map<string, any>();
    (items || []).forEach(it => {
      const k = joinKeyOf(it);
      const qty = cleanNum(it?.quantity);
      const investUsd = cleanNum(overseasInvestAmount(it || {}));
      const prev = m.get(k);
      if (prev) {
        const pq = cleanNum(prev.quantity);
        const wsum = cleanNum(prev.purchasePrice) * pq + cleanNum(it?.purchasePrice) * qty;
        const tq = pq + qty;
        m.set(k, {
          ...prev,
          quantity: tq,
          investAmount: cleanNum(prev.investAmount) + cleanNum(it?.investAmount),
          depositAmount: cleanNum(prev.depositAmount) + cleanNum(it?.depositAmount),
          purchasePrice: tq > 0 ? wsum / tq : cleanNum(prev.purchasePrice),
          __investUsd: cleanNum(prev.__investUsd) + investUsd,
        });
      } else m.set(k, { ...it, __investUsd: investUsd });
    });
    return m;
  };
  const itemsA = itemsOf(itemsA0);
  const itemsB = itemsOf(itemsB0);

  // 행 순서: 기준일 보유 순서 → 기준일에 없는 비교일 보유(매도·이관된 종목)를 뒤에.
  const keys: string[] = [];
  const seen = new Set<string>();
  const pushKeys = (items: any[]) => (items || []).forEach(it => {
    const k = joinKeyOf(it);
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  });
  pushKeys(itemsA0);
  pushKeys(itemsB0);

  // 그 날짜에 보유하지 않은 종목의 **종가만** 채우는 프로브(수량 1로 평가).
  // ⚠️ 평가금·수량은 채우지 않는다 — 보유하지 않은 종목에 금액을 만들어 내면 안 된다.
  //    (매도한 종목의 '그 뒤 주가'를 보는 것이 거래 분석의 핵심이라 종가만 채운다.)
  const probePrice = (item: any, date: string): { price: number | null; source: string } => {
    if (!item || !isPricedType(String(item.type || 'stock'))) return { price: null, source: 'none' };
    const r = calcPortfolioEvalDetail([{ ...item, quantity: 1 }], accountType, date, smap, imap, fxRate, mpo);
    const d = (r.items || [])[0];
    return {
      price: d && d.price != null ? cleanNum(d.price) : null,
      source: d ? String(d.source || 'none') : 'none',
    };
  };

  const perShareOf = (key: string, code: string, date: string, side: 'basis' | 'compare'): PerShareInfo | null => {
    if (!dividendCodeType(code, isOverseas)) return null;
    const base = resolvePerShareAsOf(portfolio, code, date, isOverseas, taxDeferred);
    const ovRaw = perShareOverride && perShareOverride[side] ? perShareOverride[side]![key] : undefined;
    const ov = numOrBlank(ovRaw);
    // ⚠️ 사용자 입력이 0이면 '분배 없음'을 명시한 것이므로 그대로 채택한다(빈 칸과 다르다).
    if (ov != null && ov >= 0) return { perShare: ov, ym: '', source: 'manual', derived: false, upcoming: base.upcoming };
    return base;
  };

  const rows: EvalCompareRow[] = [];
  const acc = {
    basis: { invest: 0, div: 0, divPartial: false, priceMissing: false },
    compare: { invest: 0, div: 0, divPartial: false, priceMissing: false },
    counter: { invest: 0, div: 0, divPartial: false, priceMissing: false },
  };

  for (const key of keys) {
    const itemA = itemsA.get(key);
    const itemB = itemsB.get(key);
    const refItem = itemA || itemB;
    const type = String(refItem?.type || 'stock');
    const code = String(refItem?.code || '').trim();
    const name = type === 'deposit'
      ? '예수금 (CASH)'
      : (String(refItem?.name || '').trim() || nameMap[code] || (isGold ? 'KRX 금현물' : code) || '—');
    const eligible = type === 'stock' && !!dividendCodeType(code, isOverseas);

    /**
     * 한 블록에서의 이 행의 값.
     *  - `item`   : 수량·투자금액·구매단가의 출처(= 그 블록이 쓰는 날짜의 보유 항목)
     *  - `sc`     : 그 블록의 평가 결과
     *  - `psDate` : 종가·주당분배금을 어느 날짜 기준으로 볼 것인가(④ 반사실은 **기준일**)
     */
    const mk = (item: any, sc: SideCalc, psDate: string, psSide: 'basis' | 'compare', fx: number): EvalCompareSide => {
      const d = sc.detail.get(key);
      const held = !!item && !!d;
      const ps = eligible ? perShareOf(key, code, psDate, psSide) : null;
      const qty = (type === 'deposit' || type === 'savings')
        ? null
        : (held ? (d.quantity != null ? cleanNum(d.quantity) : numOrBlank(item?.quantity)) : null);
      let price = held && d.price != null ? cleanNum(d.price) : null;
      let source = held ? String(d.source || 'none') : 'none';
      if (price == null && !held) {
        // 그 블록이 평가에 쓰는 날짜의 종가만 채운다(④ 반사실도 기준일 종가).
        const p = probePrice(refItem, psDate);
        price = p.price; source = p.source;
      }
      // ⚠️ 보유 중인데 종가를 못 구하면 `calcPortfolioEvalDetail`은 평가금 0을 넣는다.
      //    그 0을 그대로 쓰면 "그날 0원"이라고 단언하게 되므로 **null**로 두고 총액이 과소하다는
      //    사실만 `priceMissing`으로 알린다.
      const priceMissing = held && isPricedType(type) && cleanNum(qty) > 0 && !(cleanNum(d.eval) > 0);
      const evalAmt = held && !priceMissing ? cleanNum(d.eval) : null;
      const invest = !held ? null : (type === 'deposit'
        ? numOrBlank(item?.depositAmount)
        : (isOverseas && type === 'stock' ? num(item?.__investUsd) : numOrBlank(item?.investAmount)));
      const itemQty = cleanNum(item?.quantity);
      const purchase = (!held || type === 'deposit' || type === 'savings')
        ? null
        : (isOverseas
          // 해외는 저장된 구매단가(USD)가 권위. 국내는 화면과 같이 투자금액 ÷ 보유수량.
          ? (cleanNum(item?.purchasePrice) > 0 ? cleanNum(item.purchasePrice) : null)
          : (itemQty > 0 && cleanNum(item?.investAmount) > 0 ? cleanNum(item.investAmount) / itemQty : null));
      const psVal = perShareValueOf(ps);
      const dividend = (psVal != null && qty != null && qty > 0) ? qty * psVal : null;
      return {
        held,
        quantity: qty,
        price,
        source,
        evalAmount: evalAmt,
        evalNative: toNative(evalAmt, fx),
        investAmount: invest,
        purchasePrice: purchase,
        ratio: evalAmt != null && sc.total > 0 ? evalAmt / sc.total : null,
        dividend,
        perShare: ps,
        priceMissing,
      };
    };

    const basis = mk(itemA, A, basisDate, 'basis', fxB);
    const compare = mk(itemB, B, compareDate, 'compare', fxC);
    // 반사실: 수량·투자금액은 **비교일** 것, 종가·주당분배금은 **기준일** 것.
    const counter = mk(itemB, C, basisDate, 'basis', fxB);

    rows.push({ key, type, code, name, dividendEligible: eligible, basis, compare, counter });

    const bump = (side: EvalCompareSide, into: { invest: number; div: number; divPartial: boolean; priceMissing: boolean }) => {
      if (!side.held) return;
      into.invest += cleanNum(side.investAmount);
      if (side.priceMissing) into.priceMissing = true;
      if (side.dividend != null) into.div += side.dividend;
      else if (eligible && cleanNum(side.quantity) > 0) into.divPartial = true;
    };
    bump(basis, acc.basis);
    bump(compare, acc.compare);
    bump(counter, acc.counter);
  }

  const mkTotals = (sc: SideCalc, a: typeof acc.basis, fx: number): EvalCompareTotals => ({
    evalAmount: sc.total,
    evalNative: (toNative(sc.total, fx) as number) || 0,
    investAmount: a.invest,
    dividend: a.div,
    dividendPartial: a.divPartial,
    priceMissing: a.priceMissing,
  });
  const totals = {
    basis: mkTotals(A, acc.basis, fxB),
    compare: mkTotals(B, acc.compare, fxC),
    counter: mkTotals(C, acc.counter, fxB),
  };

  // ⚠️ 분모가 0 이하면 **null**이다(∞·NaN·0.00%로 단언 금지 — 화면·엑셀은 빈 칸).
  const rate = (a: number, b: number): number | null => (b > 0 ? (a - b) / b : null);

  // (비교일, 기준일] 순 외부 입출금. 해외계좌 원장은 USD라 환산하지 않는다(계좌 통화 프레임).
  const flow = externalFlowInRange(depositHistory || [], depositHistory2 || [], compareDate, basisDate);
  const netFlow = cleanNum(flow?.net);

  // ── 흐름이 실제로 계좌에 반영됐는가(장부액 관측) ─────────────────────────
  // ⚠️ 해외·금은 `costBasisOnly: true` — 그 항목들의 `investAmount`에는 원화 잔존값이 남을 수 있어
  //    (레거시·PasteModal 임포트) 매입가×수량만 써야 한다(CLAUDE.md '해외 장부' 규약).
  // ⚠️ 보유수량이 추정인 날짜는 구성 자체가 불확실해 관측이 성립하지 않는다 → 관측 없음(null).
  const bookOpts = { costBasisOnly: isOverseas || isGold };
  const bookDelta = (rA.estimated || rB.estimated)
    ? null
    : bookCostOf(itemsA0, bookOpts) - bookCostOf(itemsB0, bookOpts);
  const flowMaterial = Math.abs(netFlow) > Math.max(0, totals.compare.evalNative) * FLOW_MATERIAL_RATIO;
  const flowReflected = netFlow === 0 || !flowMaterial || (bookDelta != null && (netFlow > 0
    ? bookDelta >= netFlow * FLOW_ABSORBED_RATIO
    : bookDelta <= netFlow * FLOW_ABSORBED_RATIO));

  return {
    basisDate, compareDate, isOverseas, isGold,
    fxBasis: fxB, fxCompare: fxC,
    estimatedBasis: A.estimated, estimatedCompare: B.estimated,
    allExactBasis: A.allExact, allExactCompare: B.allExact, allExactCounter: C.allExact,
    rows, totals,
    diffEval: totals.basis.evalNative - totals.compare.evalNative,
    diffRate: rate(totals.basis.evalNative, totals.compare.evalNative),
    counterRate: rate(totals.counter.evalNative, totals.compare.evalNative),
    netFlow,
    flowReflected,
    bookDelta,
    tradeEffect: totals.basis.evalNative - totals.counter.evalNative - netFlow,
    // 기준일 종가를 못 구한 종목이 있으면 A·C 총액이 비대칭으로 과소해져 거래 효과가 부풀려지고,
    // 원장 흐름이 아직 평가액에 반영되지 않았으면 그 금액 전액이 가짜 손익이 된다.
    tradeEffectValid: !totals.basis.priceMissing && !totals.counter.priceMissing && flowReflected,
    tradeEffectDividend: acc.basis.div - acc.counter.div,
    tradeEffectDividendPartial: acc.basis.divPartial || acc.counter.divPartial,
  };
};

/** 두 값의 차. 한쪽이라도 없으면 null(빈 셀) — 0으로 단언하지 않는다. */
export const diffOf = (a: number | null | undefined, b: number | null | undefined): number | null =>
  (a == null || b == null) ? null : a - b;

/** (a − b) ÷ b. b가 0 이하이거나 한쪽이 없으면 null. */
export const diffRateOf = (a: number | null | undefined, b: number | null | undefined): number | null =>
  (a == null || b == null || !(b > 0)) ? null : (a - b) / b;
