// ─────────────────────────────────────────────────────────────────────────────
// src/ledger.ts — 가계부(Ledger) 타입 + 순수 로직
//
// ⚠️ 이 파일에는 `// @ts-nocheck`를 붙이지 말 것.
//    빌드가 `vite build`(esbuild, 타입체크 없음)라 저장소 대부분이 nocheck인데,
//    nocheck가 없는 소수 파일(utils.ts·flowMap.ts·backtest.ts 등)만 에디터 타입검사를
//    받는다. 이 기능에서는 그 타입이 유일한 안전망이다.
//
// ⚠️ React state·DOM 접근 금지 — scripts/verify-ledger.mjs가 이 파일을 **직접 import**해
//    테스트한다(미러 금지 — 미러는 "src에만 넣은 변경"과 "미러에만 넣은 변경"이 둘 다
//    통과하는 구멍을 만든다. verify-period.mjs 헤더의 규약).
//    그래서 상대 import에는 **`.ts` 확장자가 필수**다(Node ESM은 확장자 없는 상대 경로를
//    해석하지 못해 검증 파트①이 통째로 죽는다). `enum`/`namespace`도 금지
//    (Node 타입 스트리핑 미지원 — tsconfig의 erasableSyntaxOnly와 같은 계약).
//
// ⚠️ 타입에 `_` 접두 런타임 필드를 두지 말 것 — 순환 참조가 생기면 ledgerFingerprint의
//    JSON.stringify가 던지고, 그 지문 계산은 App.tsx 저장 effect의 첫 블록이라
//    그 세션의 Drive 저장이 통째로 멈춘다.
//
// ─────────────────────────────────────────────────────────────────────────────
// 계산 규약 (첨부 스프레드시트에서 역산해 실측 검증 완료 — scripts/verify-ledger.mjs 파트①)
//
//  · 신용대출 95,000,000 @4.47% → 월 353,875 = `P × r/12` **정확 일치** → 만기일시(이자만)
//  · APT1 131,283,083 @3.70% 만기 2063-04 → 월 544,059 ≈ 원리금균등 n≈442.6
//  · 전세 159,550,000 @2.73% → 월 423,289 = **어떤 방식으로도 불일치**
//        → ⚠️ 계산은 '제안'이고 **사용자 입력(paymentOverride)이 권위**다. 이 케이스가 그 근거.
//  · 월 지출 합계 4,755,266 = 대출 1,654,443 + 현금 610,000 + 카드 2,490,823
//  · 예상 年 지출 62,743,196 = 월합 × 12 + 년단위 5,680,000
//
// ⚠️ **중간 반올림 금지**(이 규약이 깨지면 사진 값이 재현되지 않는다).
//    MS365는 연 127,000을 월로 환산해 계상하는데, 항목별로 반올림(10,583)하면
//    예상 年 지출이 62,743,192가 되어 사진의 62,743,196과 **4원** 어긋난다.
//    무반올림 10,583.333…으로 누산해야 정확히 일치한다. 계산은 무반올림, **표시만** 반올림.
// ─────────────────────────────────────────────────────────────────────────────

import { generateId } from './utils.ts';

/* ===========================================================================
 * A. 저장되는 타입 (Drive STATE `ledgerBooks` 필드)
 *    불변식: 여기에는 **사용자가 직접 입력한 값**만 들어간다.
 *    월 납입액·합계·증감률 등 파생값은 절대 저장하지 않는다.
 * =========================================================================== */

/**
 * 지출/수입의 성격. **단일 축**이다.
 * ⚠️ 과거 설계에 있던 `kind: 'expense'|'income'`을 되살리지 말 것 — `group`과 이중 축이 되어
 *    "수입 항목이 지출 합계에 섞이는" 경로가 열린다. 수입은 `group: 'income'` 하나로 표현한다.
 */
export type LedgerGroup =
  | 'loan'      // 지출 - 대출 (월 납입액을 상환방법으로 계산)
  | 'fixed'     // 지출 - 고정비 (매월 같은 금액)
  | 'variable'  // 지출 - 변동비 (매월 달라지는 금액)
  | 'annual'    // 지출 - 연 1회 목돈 (자동차세·재산세 등). ⚠️ 월 반복이 아니다.
  | 'income';   // 수입

/** 결제수단 — 사진의 '결재방법' 열. 소계를 이 축으로 가른다(고정비-현금 / 고정비-카드). */
export type LedgerPay = 'cash' | 'card' | 'transfer' | 'auto' | 'other';

/**
 * 사용자가 금액을 **어느 단위로 입력했는가**.
 * ⚠️ `group`과 직교한다(같은 것을 두 번 말하는 것이 아니다):
 *   · `planUnit:'year'` = "연 단위로 청구되지만 **매달 부담**"(연 구독 MS365) → 월 계획 = plan/12
 *   · `group:'annual'`  = "1년에 **한 번** 나가는 목돈"(재산세)          → 그 달에만 계상
 *  `group==='annual'`이면 planUnit은 무시된다(plan이 곧 그 1회 금액).
 */
export type LedgerPlanUnit = 'month' | 'year';

/** 대출 상환방법. 사진 역산으로 앞 둘을 실측 확인했다. */
export type LedgerLoanMethod =
  | 'interestOnly'    // 만기일시상환 — 매달 이자만, 원금은 만기에
  | 'amortizing'      // 원리금균등 — 매달 같은 금액
  | 'equalPrincipal'; // 원금균등 — 원금은 같고 이자가 줄어 **매달 납입액이 감소**

export interface LedgerLoan {
  /** 대출 잔액 */
  principal: number;
  /**
   * ⚠️ 위 `principal`이 **어느 시점의 잔액인가**('YYYY-MM'). 이 기능의 핵심 필드다.
   *
   * 이게 없이 "만기일 − 오늘"로 잔여 개월을 재면, 잔액은 그대로인데 n만 줄어들어
   * **사용자가 아무것도 건드리지 않았는데 월 납입액이 매달 상승한다**
   * (실측: APT1이 1년에 +8,757원, +1.3%). 원리금균등은 정의상 고정인데도 그렇게 된다.
   * 잔액과 기간의 기준 시점을 묶어 두면 납입액이 **1회 계산되고 고정**된다.
   *
   * 비어 있으면 계산을 포기하고 `source:'none'`으로 떨어뜨린다(조용한 오적용 금지).
   */
  principalAsOfYm: string;
  /** 약정 이자 (연 %) */
  annualRate: number;
  method: LedgerLoanMethod;
  /** 만기일 'YYYY-MM-DD' — 사진 A열. `termMonths`가 있으면 그쪽이 우선. */
  endDate: string;
  /** 잔여 개월수 직접 입력. `endDate` 대신 쓸 수 있다. */
  termMonths: number | null;
  /** 거치기간(개월) — `principalAsOfYm`부터 이 개월수 동안은 이자만 낸다. */
  graceMonths: number | null;
  /**
   * ⚠️ 사용자가 직접 적은 월 납입액. **있으면 계산값을 덮어쓴다.**
   * 전세(159,550,000 @2.73% → 423,289)가 어떤 상환방법으로도 재현되지 않는다 —
   * 실제 대출에는 중도상환·금리변동·부분거치 등 모델에 없는 조건이 흔하다.
   * 계산은 어디까지나 제안이고 사용자 입력이 권위다.
   */
  paymentOverride: number | null;
}

export interface LedgerItem {
  id: string;
  group: LedgerGroup;
  pay: LedgerPay;
  name: string;
  /** 자유 소분류(구독·통신·보험 …). 도넛 세부 그룹핑에 쓴다. 비어도 된다. */
  category: string;
  /**
   * 기본 계획 금액. `group==='annual'`이면 **연 1회 금액**, 그 외에는 `planUnit`이 정하는 단위.
   * null = 미입력.
   */
  plan: number | null;
  planUnit: LedgerPlanUnit;
  /**
   * 월별 계획 덮어쓰기 ('YYYY-MM' → 금액).
   * ⚠️ 이게 없으면 계획을 고쳤을 때 **과거 달의 '차이'가 전부 소급 변경**된다
   *    (작년 예산을 올려 잡으면 작년 실적이 갑자기 '절약'이 된다).
   */
  planOverride: Record<string, number>;
  /**
   * 실제 금액 ('YYYY-MM' → 금액).
   * ⚠️ **키의 유무가 '미입력'과 '0원'을 가른다.** 0을 넣는 것과 지우는 것은 다른 뜻이다:
   *    미입력은 합계에서 빠지고 `missing`으로 세어지지만, 명시적 0은 "그 달엔 안 썼다"는 확정이다.
   *    → 커밋은 반드시 `commitActual`을 쓸 것(`cleanNum`은 빈칸을 0으로 만들어 이 구분을 파괴한다).
   */
  actual: Record<string, number>;
  memo: string;
  /**
   * 항목이 유효한 기간 ('YYYY-MM'). 비어 있으면 제한 없음.
   * ⚠️ 없으면 연중에 추가한 항목이 **존재하지도 않던 1~7월에 영구히 '미입력'으로 계상**되고
   *    경고 배지가 절대 꺼지지 않는다. 사용자 요구("매월 새로운 추가 지출 항목이 생기면 추가")에 직결.
   */
  activeFrom: string;
  activeTo: string;
  /** `group==='annual'` 전용 — 납부 예정 월/일. 메모 달력 표시와 '그 달에만 계상'의 근거. */
  dueMonth: number | null;
  dueDay: number | null;
  loan: LedgerLoan | null;
  /** 사진의 노랑/초록/파랑 행 강조 */
  tone: 'none' | 'warn' | 'good' | 'info';
  /**
   * 실적을 **어느 레이어에서 입력하는가**. 기본 `'monthly'`(레거시 무변경).
   * 그 항목에 거래가 처음 생기면 `addTx`가 `'tx'`로 바꾼다.
   *
   * ⚠️ 이 값은 **표시·안내 전용**이다. 실제 금액의 단일 소스는 언제나 `actualResolved`이고,
   *    거래가 있으면 `entry`가 무엇이든 거래 합이 이긴다(두 값이 갈릴 자리를 만들지 말 것).
   */
  entry: LedgerEntryMode;
  createdAt: number;
}

/* ── 거래(기록 레이어) ───────────────────────────────────────────────────────
 * ⚠️ 저장 단위는 `LedgerBook.transactions`다 — **`LedgerBook` 안**이라 App.tsx의 영속화
 *    7지점(state·지문·payload·deps·applyStateData·applyBackupData·sticky)이 자동 상속된다.
 *    거래를 밖으로 빼면 그 7곳을 새로 배선해야 하고 하나만 빠져도 조용히 유실된다.
 * ────────────────────────────────────────────────────────────────────────── */

/** 실적 입력 레이어. */
export type LedgerEntryMode = 'monthly' | 'tx';

/**
 * 거래 종류.
 * ⚠️ `LedgerGroup`과 이중 축이 아니다 — 항목의 `group`에서 파생되지만 **저장**한다.
 *    항목을 지운 뒤에도(미분류로 남은 거래) 지출/수입을 가릴 수 있어야 하기 때문이다.
 * ⚠️ `'transfer'`는 지출도 수입도 아니다(계좌 간 이동). 단계 C에서 계좌가 들어오면 쓰인다.
 */
export type LedgerTxKind = 'expense' | 'income' | 'transfer';

/**
 * 거래가 어떻게 생겼는가. 값이 아니라 **상태**다(YNAB `approved`, Actual `~`의 선례).
 *  manual=직접 입력 / confirm=고정지출 ✔ / auto=자동 기입 / import=가져오기 /
 *  adjust=잔액 대조 조정 / migrate=수동 월 합계를 거래로 옮김
 */
export type LedgerTxOrigin = 'manual' | 'confirm' | 'auto' | 'import' | 'adjust' | 'migrate';

/** 한 거래를 여러 항목으로 쪼갠 몫. ⚠️ Σamount === tx.amount (정규화가 강제). */
export interface LedgerTxSplit {
  itemId: string;
  amount: number;
  memo: string;
}

export interface LedgerTx {
  id: string;
  /** KST 달력일 'YYYY-MM-DD'. ⚠️ 창에서 `new Date()`로 만들지 말 것(브릿지의 today를 쓴다). */
  date: string;
  /**
   * ⚠️ **항상 양수**다. 환급·취소는 `refund: true`로 표현한다.
   *    부호로 표현하면 집계마다 `Math.abs`/부호 실수가 생기고(이 저장소가 여러 번 겪은 실패 모드),
   *    "환급인가"라는 사실이 화면·필터에서 사라진다.
   */
  amount: number;
  refund: boolean;
  kind: LedgerTxKind;
  /** '' = 미분류(빠른 입력 허용). `splits`가 있으면 무시된다. */
  itemId: string;
  splits: LedgerTxSplit[];
  pay: LedgerPay;
  /** 단계 C(계좌)에서 쓰인다. '' = 미지정. */
  accountId: string;
  /** `kind==='transfer'`의 도착 계좌(단계 C). */
  toAccountId: string;
  memo: string;
  /** 누가 썼는가(부부 카드 명의 구분). '' = 미지정. */
  payer: string;
  /** 할부 개월(≥2). null = 일시불. 월 분배는 파생(`installmentCharges`). */
  installmentMonths: number | null;
  origin: LedgerTxOrigin;
  /** `confirm`·`auto`의 멱등 키 `${itemId}|${ym}` — 같은 키가 있으면 다시 만들지 않는다(단계 B). */
  originKey: string;
  /** '' = 살아 있음 / 'YYYY-MM-DD' = 휴지통(소프트 삭제). */
  deletedAt: string;
  createdAt: number;
}

export interface LedgerMonthMeta {
  /**
   * 이 달을 마지막으로 정리(입력·수정)한 날짜 (KST 'YYYY-MM-DD').
   * 메모 달력 BUDGET 칩이 걸리는 앵커다. ⚠️ 파생값을 여기 복사하지 말 것.
   */
  touchedDate: string;
  memo: string;
}

export interface LedgerBook {
  id: string;
  name: string;
  /**
   * ⚠️ `year` 필드를 두지 말 것. 장부를 한 해에 묶으면 `actual`/`planOverride` 키가
   *    'YYYY-MM'인데도 **전년 대비가 구조적으로 불가능**해진다(다른 장부를 봐야 하므로).
   *    사용자가 명시적으로 요구한 '전년대비 증감 그래프'가 만들어지지 않는다.
   *    장부는 연도 무관이고, 화면이 보고 있는 연도를 고른다.
   */
  items: LedgerItem[];
  /**
   * 사용자가 **미리 등록해 두는** 지출 구분 목록('구독'·'통신'·'보험' …).
   * 항목은 `LedgerItem.category`로 이 중 하나를 고른다.
   *
   * ⚠️ 선택 목록은 이 레지스트리 **∪ 실제 쓰이는 값**이다(`ledgerCategories`).
   *    레지스트리만 옵션으로 쓰면, 사용자가 목록에서 지운 구분을 가진 항목의 `<select>`가
   *    일치하는 `<option>`을 못 찾아 브라우저가 첫 옵션을 표시하고 — 그 상태에서 한 번만
   *    건드리면 원래 값이 영구히 덮인다(undo 없음, sticky 보호도 없다).
   */
  categories: string[];
  months: Record<string, LedgerMonthMeta>;
  /**
   * 거래 원장(기록 레이어). **정렬은 date desc, createdAt desc**(목록이 곧 최근순).
   * ⚠️ 빈 배열이면 이 장부는 **레거시와 1원도 다르지 않게** 동작한다(하위호환의 축).
   */
  transactions: LedgerTx[];
  createdAt: number;
  updatedAt: number;
}

export type LedgerBooks = LedgerBook[];

/* ===========================================================================
 * B. 소프트 상한
 *    STATE 파일은 백업 22본으로 복제되고 관리자 포털이 전 사용자 STATE를 순차 로드하므로,
 *    무한 증식만은 막는다.
 * =========================================================================== */

export const MAX_LEDGER_BOOKS = 5;
export const MAX_LEDGER_ITEMS = 200;
export const MAX_LEDGER_MONTHS = 240;
export const MAX_LEDGER_NAME_LEN = 60;
export const MAX_LEDGER_MEMO_LEN = 500;
/** 구분 프리셋 상한. ⚠️ 화면 입력의 `maxLength`도 **이 상수**를 쓸 것 — 정규화에서만
 *  자르면 붙여넣은 값의 뒤가 조용히 사라진다. */
export const MAX_LEDGER_CATEGORIES = 40;
export const MAX_LEDGER_CATEGORY_LEN = 20;

/**
 * 장부당 거래 상한 — ≈700KB. STATE는 백업 22본으로 복제되고 관리자 포털이 전 사용자 STATE를
 * 순차 로드하므로 무한 증식만은 막는다. 초과분은 **오래된 것부터** 버린다(정규화).
 * ⚠️ 80%에 닿으면 화면이 '연도 정리'(단계 E)를 안내해야 한다 — 조용히 버리지 말 것.
 */
export const MAX_LEDGER_TX = 6000;
export const MAX_LEDGER_TX_MEMO_LEN = 120;
export const MAX_LEDGER_TX_SPLITS = 8;
export const MAX_LEDGER_PAYER_LEN = 20;
export const MAX_LEDGER_INSTALLMENT_MONTHS = 60;
/**
 * 달력 패드 하루치 거래 목록 상한. 넘치면 목록만 자르고 **`txCount`는 전 건**을 유지한다 —
 * 조용한 절단은 합계와 목록이 어긋나 보이는데 사용자가 원인을 알 수 없게 만든다.
 */
export const LEDGER_CAL_TX_CAP = 20;

/* ===========================================================================
 * C. 팔레트 — `scripts/validate_palette.js`로 실측 검증한 값
 *
 * ⚠️ 이 앱의 손익 색 규약(이익=빨강 / 손실=파랑, 한국 증시 관행)을 **쓰지 않는다**.
 *    가계부는 '지출 증가'가 나쁜 것인데 빨강으로 칠하면 이 앱 사용자에게 정반대로 읽힌다.
 *    대신 상태색(초과=amber ▲ / 절약=teal ▼)을 쓰고 **아이콘과 라벨을 항상 동반**한다.
 *
 * ⚠️ 검증기는 `scripts/validate_palette.mjs`다. **`validate_palette.js`(옛 이름)는 저장소에
 *    존재한 적이 없어** 이 규약이 오랫동안 실행 불가였다 — 2026-08 6가지 수정에서 복원했다.
 *    색을 바꾸려면 `node scripts/validate_palette.mjs`를 반드시 다시 돌릴 것(눈으로 판단 금지).
 *
 * 검증 결과(dark, all-pairs, **Viénot/Brettel CVD + CIEDE2000**):
 *   · GROUP 4슬롯  : deutan 12.4 / protan 11.3 / **tritan 4.2** → 직접 라벨 + 2px 간격이 필수
 *   · BALANCE 2슬롯: 최소 23.2 — ALL PASS
 *   · 발산 2극     : 최소 26.6 — ALL PASS
 *   · 앱 표면 3종 대비 전부 6.5:1 이상
 *   · 그룹 내부 램프(≤5슬롯): 대비 ≥3.35:1 · 인접 ΔE(정상∧CVD) ≥5.0
 * ⚠️ 옛 주석은 GROUP 4슬롯 CVD를 **7.1**로 적었는데 이 모델에서는 재현되지 않는다(다른 CVD
 *    모델의 값). 기준선을 위 값으로 갱신했다 — 모델을 바꾸면 이 숫자도 함께 갱신할 것.
 * =========================================================================== */

/** 도넛 카테고리 — **고정 순서, 순환 금지**. 5번째 계열이 필요하면 'Other'로 접는다. */
export const LEDGER_GROUP_COLOR: Record<LedgerGroup, string> = {
  loan:     '#60a5fa',
  fixed:    '#f472b6',
  variable: '#4ade80',
  annual:   '#fb923c',
  income:   '#4ade80',
};

/** 수지 균형(2계열) */
export const LEDGER_BALANCE_COLOR = { expense: '#f472b6', income: '#4ade80' } as const;

/**
 * 분석 ① '계획 반영분' 막대 — **새 hue 금지**(§13.2.5). `expense`와 **같은 hue를 알파로만** 연하게
 * 만든다(`ledgerRamp`가 아니다 — 램프는 그룹 내부 분해 전용). 범례 라벨 `확인`/`계획 반영`이
 * 색과 항상 동반한다(색만으로 뜻을 전달하지 않는 기존 규약).
 * ⚠️ 값을 바꾸면 `node scripts/validate_palette.mjs` §7(카드면 위 합성색 대비·ΔE)을 다시 돌릴 것.
 */
export const LEDGER_PLANNED_ALPHA = 0.4;
export const ledgerPlannedFill = (hex: string): string => {
  const s = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${LEDGER_PLANNED_ALPHA})`;
};

/** 발산 — 계획 대비 / 전월 대비. 중립은 회색 midpoint(카테고리 슬롯이 아니다). */
export const LEDGER_DIVERGING = { over: '#fbbf24', flat: '#94a3b8', under: '#2dd4bf' } as const;

export const LEDGER_GROUP_LABEL: Record<LedgerGroup, string> = {
  loan: '대출', fixed: '고정비', variable: '변동비', annual: '연단위', income: '수입',
};

export const LEDGER_PAY_LABEL: Record<LedgerPay, string> = {
  cash: '현금', card: '카드', transfer: '이체', auto: '자동이체', other: '기타',
};

/** 화면 렌더 순서 — 사진의 섹션 순서를 따른다. */
export const LEDGER_GROUP_ORDER: LedgerGroup[] = ['loan', 'fixed', 'variable', 'annual', 'income'];

export const LEDGER_EXPENSE_GROUPS: LedgerGroup[] = ['loan', 'fixed', 'variable', 'annual'];

/** 결제수단 렌더 순서 — **고정, 순환 금지**. 스택 막대에서는 이 순서가 1차 식별자다. */
export const LEDGER_PAY_ORDER: LedgerPay[] = ['cash', 'card', 'transfer', 'auto', 'other'];

/**
 * 상세 도넛의 '기타' 슬롯.
 * ⚠️ `LEDGER_DIVERGING.flat`을 재사용하지 말 것 — 같은 회색이 이미 ① 차트의 '계획' 선
 *    ② 발산 차트의 '변동 없음'을 뜻한다. 세 번째 뜻이 겹치면 상세 도넛의 회색 조각이
 *    '계획분'이나 '변동 없음'으로 오독된다. 발산 midpoint를 나중에 조정하면 무관한
 *    '기타' 색이 함께 바뀌는 결합도 문제도 있다.
 */
export const LEDGER_DETAIL_OTHER = '#7c8798';

/* ─── 그룹 내부 램프 ────────────────────────────────────────────────────────
 * 한 그룹을 더 잘게 쪼갤 때(고정비→결제수단, 상세 도넛→항목/구분) 쓰는 명도 램프.
 * **부모 그룹의 hue를 유지**하므로 조각이 어느 그룹에 속하는지가 색으로 읽힌다.
 *
 * ⚠️ 상한은 **5슬롯**이다. 6이면 인접 ΔE가 4 아래로 떨어진다(§2 실측) — 그 이상은
 *    반드시 '기타'로 접을 것(`LEDGER_DETAIL_TOP_N`).
 * ⚠️ Lmin이 색상별로 다른 것은 임의값이 아니다 — 파랑·핑크는 같은 L에서 초록보다
 *    훨씬 어두워, 공통 스톱을 쓰면 어두운 끝의 대비가 3:1 아래로 떨어진다(실측 2.58:1).
 * ⚠️ 값을 바꾸면 `node scripts/validate_palette.mjs`를 **반드시 다시 돌릴 것**
 *    (그 스크립트가 이 함수의 사본을 들고 1:1 대조한다 — §0).
 */
export const LEDGER_RAMP_LMAX = 0.86;
export const LEDGER_RAMP_LMIN: Record<LedgerGroup, number> = {
  // ⚠️ 초록(variable)은 채도가 가장 낮고(S 0.69) 명도 변화의 지각 차이가 작아, 다른 색과
  //    같은 0.38을 쓰면 5슬롯 인접 ΔE가 3.4까지 떨어진다(실측). 더 어둡게 벌려야 한다.
  loan: 0.44, fixed: 0.45, variable: 0.32, annual: 0.36, income: 0.32,
};
/** 상세 도넛에서 한 그룹이 차지할 수 있는 최대 조각 수(초과분은 '기타'로 접는다). */
export const LEDGER_DETAIL_TOP_N = 4;

const hexToHsl = (hex: string): [number, number, number] => {
  const s = String(hex).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, sat = 0;
  if (d) {
    sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
    h *= 60;
  }
  return [h, sat, l];
};
const hslToHex = (h: number, s: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const k = ((Math.floor(h / 60) % 6) + 6) % 6;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
  return '#' + t.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
};

/**
 * 그룹 색의 명도 램프에서 `n`개 중 `i`번째 색.
 * `n <= 1`이면 기준색 그대로(쪼갤 필요가 없다).
 * ⚠️ 순수 함수 — 같은 인자면 항상 같은 값(검증 스크립트가 이 성질에 의존한다).
 */
export const ledgerRamp = (base: string, group: LedgerGroup, n: number, i: number): string => {
  if (!(n > 1) || !Number.isFinite(n) || !Number.isFinite(i)) return base;
  const lmin = LEDGER_RAMP_LMIN[group] ?? 0.42;
  const [h, s] = hexToHsl(base);
  const k = Math.min(Math.max(Math.trunc(i), 0), n - 1);
  return hslToHex(h, s, LEDGER_RAMP_LMAX - (LEDGER_RAMP_LMAX - lmin) * (k / (n - 1)));
};

/**
 * 결제수단 축의 색.
 *
 * ⚠️ **독립 팔레트가 아니라 램프다 — 되돌리지 말 것.** 이 앱의 색 공간은 이미 포화라
 *    (GROUP 4 + DIVERGING 3 + 빨강 금지) 결제수단 5슬롯에 줄 독립 hue가 **존재하지 않는다**
 *    (`validate_palette.mjs` §4가 그 불가능성을 매번 재확인한다 — 그 단언이 실패로
 *    뒤집히면 색 공간이 넓어진 것이므로 그때 독립 팔레트로 승격할 것).
 *    그래서 결제수단은 **스택 순서 + 범례 + 직접 라벨**이 1차 식별자이고 색은 보조다.
 * ⚠️ 고정비 도넛 분리와 결제수단 막대가 **같은 이 색을 공유**해야 한다 — 한 화면에서
 *    '현금'이 두 색으로 보이면 안 된다.
 */
export const ledgerPayColor = (pay: LedgerPay): string => {
  const i = LEDGER_PAY_ORDER.indexOf(pay);
  return ledgerRamp(LEDGER_GROUP_COLOR.fixed, 'fixed', LEDGER_PAY_ORDER.length, i < 0 ? LEDGER_PAY_ORDER.length - 1 : i);
};

/* ===========================================================================
 * D. 날짜/숫자 유틸 (전부 순수 — Date.now() 금지, 호출부가 기준 시점을 넘긴다)
 * =========================================================================== */

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isValidYm = (ym: unknown): boolean => typeof ym === 'string' && YM_RE.test(ym);

/** 사람이 실제로 쓰는 연도 범위. `rebalTarget` 절의 `isValidIsoDate`(1900~2999)와 같은 선례. */
export const LEDGER_YEAR_MIN = 1900;
export const LEDGER_YEAR_MAX = 2999;

/**
 * '연·월이 진짜 시드됐는가' — 내보내기처럼 **파일로 나가는 동작**의 게이트.
 *
 * ⚠️ `isValidYm`만으로는 부족하다. `YM_RE`의 연도부는 `\d{4}`라 **`'0000-01'`을 통과시킨다**.
 *    `LedgerPage`의 `year`/`month`는 `today`가 브릿지로 도착하기 전 **둘 다 0**이라
 *    `'0000-00'`이 되고, 그건 월(`00`)이 걸려 우연히 막힌다 — 즉 지금의 안전은
 *    **연도가 아니라 월 덕분**이다. 누군가 `month` 초기값을 1로 '정리'하는 순간
 *    `'0000-01'`이 되어 게이트가 겉모습 그대로인 채 조용히 무력화되고,
 *    제목 `가계부 — 0년 월 매트릭스` / 파일명 `..._0_가계부.xlsx`인 빈 파일이 나간다(실측).
 * ⚠️ 그래서 이 판정은 **순수 함수로 뽑아 직접 import 테스트**한다 — 소스 텍스트 가드는
 *    표현식의 생김새만 볼 뿐 그 변이를 잡지 못해 죽은 단언이 된다.
 */
export const isSeededYm = (ym: unknown): boolean => {
  if (!isValidYm(ym)) return false;
  const y = Number(String(ym).slice(0, 4));
  return Number.isFinite(y) && y >= LEDGER_YEAR_MIN && y <= LEDGER_YEAR_MAX;
};

/** 그 달의 일수. 윤년 포함. */
export const daysInMonth = (year: number, month1: number): number => {
  if (!Number.isFinite(year) || !Number.isFinite(month1)) return 0;
  const m = Math.trunc(month1);
  if (m < 1 || m > 12) return 0;
  return [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
};
/**
 * ⚠️ 패턴만 보지 않고 **실제 달력에 있는 날짜**인지 확인한다. 패턴만 보면 `2026-04-31`이
 *    통과하는데, CalendarModal은 `utils.isValidIsoDate`(달력 검증)로 한 번 더 거르므로
 *    연단위 지출 칩이 **아무 안내 없이 사라진다**(두 검증이 갈리는 것이 문제의 본질).
 */
export const isValidLedgerDate = (d: unknown): boolean => {
  if (typeof d !== 'string' || !ISO_RE.test(d)) return false;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), day = Number(d.slice(8, 10));
  return day <= daysInMonth(y, m);
};

/** 'YYYY-MM-DD' → 'YYYY-MM'. 유효하지 않으면 ''. */
export const ymOfDate = (d: unknown): string => (isValidLedgerDate(d) ? (d as string).slice(0, 7) : '');

/** 'YYYY-MM' → 정수 월 인덱스. 유효하지 않으면 null. */
export const ymIndex = (ym: unknown): number | null => {
  if (!isValidYm(ym)) return null;
  const s = ym as string;
  return Number(s.slice(0, 4)) * 12 + (Number(s.slice(5, 7)) - 1);
};

/** 두 'YYYY-MM' 사이의 개월수 (b − a). 하나라도 무효면 null. */
export const monthsBetweenYm = (a: unknown, b: unknown): number | null => {
  const ia = ymIndex(a), ib = ymIndex(b);
  if (ia === null || ib === null) return null;
  return ib - ia;
};

export const addMonthsYm = (ym: string, delta: number): string => {
  const i = ymIndex(ym);
  if (i === null || !Number.isFinite(delta)) return '';
  const n = i + Math.trunc(delta);
  if (n < 0) return '';
  const y = Math.floor(n / 12), m = (n % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
};

export const makeYm = (year: number, month1: number): string =>
  `${String(year).padStart(4, '0')}-${String(month1).padStart(2, '0')}`;

/**
 * ⚠️ 유한한 숫자만 통과시킨다. `cleanNum`(utils)은 `typeof val === 'number'`면 그대로
 *    돌려주므로 NaN·Infinity를 통과시킨다 — 이 모듈에서는 절대 쓰지 말 것.
 */
export const finiteOr = (v: unknown, fallback: number | null = null): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** 표시 전용 반올림. ⚠️ 계산 중간에 쓰지 말 것(사진의 4원 차이가 재발한다). */
export const roundWon = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : Math.round(v);

/* ===========================================================================
 * E. 대출 상환 계산
 * =========================================================================== */

export interface LoanScheduleResult {
  /** 그 달 납입액. 계산 불가면 이 함수가 통째로 null을 반환하므로 여기서는 항상 유한하다. */
  payment: number;
  principalPart: number;
  interestPart: number;
  /** 값의 출처. 'override' = 사용자가 직접 적은 값. */
  source: 'override' | 'computed';
  /** 기준 시점(principalAsOfYm)에서 만기까지의 총 개월수. override면 null일 수 있다. */
  termMonths: number | null;
  /** 기준 시점부터 그 달까지 경과한 회차(0-based). override면 null일 수 있다. */
  period: number | null;
  /** 거치기간 중인가 */
  inGrace: boolean;
  /** 상환방법이 매달 같은 금액인가(원금균등만 false) */
  levelPayment: boolean;
}

/**
 * 기준 시점(`principalAsOfYm`)에서 만기까지의 총 개월수.
 * `termMonths`가 있으면 그 값이 우선(사용자 직접 입력).
 */
export const loanTermMonths = (loan: LedgerLoan | null | undefined): number | null => {
  if (!loan) return null;
  const explicit = finiteOr(loan.termMonths);
  if (explicit !== null) return explicit > 0 ? Math.trunc(explicit) : null;
  const endYm = ymOfDate(loan.endDate);
  if (!endYm || !isValidYm(loan.principalAsOfYm)) return null;
  // ⚠️ **만기월도 납입 회차다** — `+1`을 빼면 만기월이 `kRaw >= n`에 걸려 'ㄱ계산 불가'가 되고,
  //    같은 대출을 `termMonths`로 넣었을 때와 회차 수가 1 달라진다(실측: 6개월 대출에서 월
  //    납입액이 19.7% 차이). 기준월(k=0)에는 납입하면서 만기월에는 납입하지 않는 비대칭을 없앤다.
  const span = monthsBetweenYm(loan.principalAsOfYm, endYm);
  const n = span === null ? null : span + 1;
  return n !== null && n > 0 ? n : null;
};

/**
 * 그 달(`ym`)의 대출 납입액.
 *
 * ⚠️ **null 계약**: 계산 불가·만기 경과·비유한 결과는 전부 `null`이다. 0을 돌려주지 말 것 —
 *    0은 "이번 달은 안 낸다"는 확정인데, 계산 실패는 "모른다"이고 화면 표기가 달라야 한다.
 *
 * ⚠️ **유한성 게이트가 이 함수의 존재 이유 절반이다.** 순진한 PMT 식은
 *    `annualRate=0`에서 0/0 = **NaN**, `n=0`에서 **Infinity**, `n<0`에서 **음수**(실측
 *    P=1억·4%·n=−3 → −33,222,469)를 낸다. 셋 다 `typeof === 'number'`라 타입으로는
 *    걸리지 않고 Σ를 지나 월 지출 합계·예상 年 지출·DSR·저축여력을 전부 오염시킨다.
 *    특히 `payment > 0` 같은 검사는 **Infinity를 통과시킨다** — `Number.isFinite`만이 막는다.
 *    (src/brlBond.ts가 같은 부류의 계산기에서 이미 이 패턴을 쓴다.)
 */
export const loanSchedule = (
  loan: LedgerLoan | null | undefined,
  ym: string,
): LoanScheduleResult | null => {
  if (!loan || !isValidYm(ym)) return null;

  const override = finiteOr(loan.paymentOverride);
  const P = finiteOr(loan.principal, 0) as number;
  const ratePct = finiteOr(loan.annualRate, 0) as number;
  const i = ratePct / 100 / 12;
  const n = loanTermMonths(loan);
  const baseYm = loan.principalAsOfYm;
  const kRaw = isValidYm(baseYm) ? monthsBetweenYm(baseYm, ym) : null;

  // ── 사용자 직접 입력이 최우선. 기준월 이전이면 아직 시작 전이므로 계상하지 않는다. ──
  if (override !== null && override >= 0) {
    if (kRaw !== null && kRaw < 0) return null;
    if (kRaw !== null && n !== null && kRaw >= n) return null;   // 만기 경과
    const interest = Number.isFinite(P * i) ? Math.min(P * i, override) : 0;
    return {
      payment: override,
      interestPart: interest,
      principalPart: override - interest,
      source: 'override',
      termMonths: n,
      period: kRaw,
      inGrace: false,
      levelPayment: loan.method !== 'equalPrincipal',
    };
  }

  // ── 계산 경로: 기준월이 없으면 포기한다(조용한 오적용보다 명시적 미적용). ──
  if (kRaw === null) return null;
  if (kRaw < 0) return null;                 // 아직 시작 전
  if (!(P > 0)) return null;                 // 잔액이 없으면 납입도 없다(0이 아니라 '해당 없음')
  if (!Number.isFinite(i) || i < 0) return null;

  const grace = finiteOr(loan.graceMonths, 0) as number;
  const inGrace = Number.isFinite(grace) && grace > 0 && kRaw < grace;

  // 만기 경과 — 상환이 끝난 대출을 지우지 않고 두는 것은 흔한 상태이고, 그때 계산식은
  // 음수·Infinity를 낸다. 여기서 끊어야 그 값이 합계로 새지 않는다.
  if (n === null) {
    // 만기 정보가 없으면 이자만 아는 셈이다. 이자만 방식은 그래도 성립한다.
    if (loan.method !== 'interestOnly') return null;
  } else if (kRaw >= n) {
    return null;
  }

  const interestNow = P * i;
  if (!Number.isFinite(interestNow)) return null;

  let payment: number;
  let principalPart: number;
  let interestPart: number;

  if (inGrace || loan.method === 'interestOnly') {
    payment = interestNow;
    interestPart = interestNow;
    principalPart = 0;
  } else if (loan.method === 'equalPrincipal') {
    // 원금균등 — 원금은 매달 같고 이자는 줄어든다. **회차마다 납입액이 다르다.**
    // ⚠️ '첫 회차를 대표값으로' 쓰지 말 것: 연 상환액을 구조적으로 과대 계상한다.
    //    연 합계는 loanAnnualTotal이 회차별로 더한다.
    const nEff = (n as number) - (grace > 0 ? grace : 0);
    if (!(nEff > 0)) return null;
    const k = kRaw - (grace > 0 ? grace : 0);
    const principalStep = P / nEff;
    const remaining = P - principalStep * k;
    if (!(remaining > 0)) return null;
    interestPart = remaining * i;
    principalPart = principalStep;
    payment = principalPart + interestPart;
  } else {
    // 원리금균등 — 기준 시점의 (잔액, 잔여 개월)에서 **1회 계산되고 만기까지 고정**된다.
    // ⚠️ n을 매달 재계산하지 말 것(월 납입액이 사용자 조작 없이 상승한다).
    const nEff = (n as number) - (grace > 0 ? grace : 0);
    if (!(nEff > 0)) return null;
    payment = i === 0 ? P / nEff : (P * i) / (1 - Math.pow(1 + i, -nEff));
    interestPart = interestNow;
    principalPart = payment - interestPart;
  }

  // ⚠️ 단일 유한성 게이트 — 위 분기 중 하나라도 NaN/Infinity/음수를 내면 여기서 끊는다.
  if (!Number.isFinite(payment) || payment < 0) return null;

  return {
    payment,
    principalPart: Number.isFinite(principalPart) ? principalPart : 0,
    interestPart: Number.isFinite(interestPart) ? interestPart : 0,
    source: 'computed',
    termMonths: n,
    period: kRaw,
    inGrace,
    levelPayment: loan.method !== 'equalPrincipal',
  };
};

/**
 * `fromYm`부터 **향후 12개월**의 납입액 합계(= 연 납입액의 정확한 정의).
 *
 * ⚠️ `월 납입액 × 12`로 대신하지 말 것 — 원금균등은 매달 줄어들어 첫 달 값의 12배가 실제보다
 *    크다. 화면의 각주가 그렇게 못 박고 있으므로, KPI가 ×12를 쓰면 같은 화면이 자기 각주를
 *    반증한다(행별 '향후 12개월'과 하단 요약의 '연 납입액'이 서로 다른 값이 된다).
 * ⚠️ **달력 연도(1~12월)로 재지 말 것** — 기준월이 연중이면 그 앞쪽 달들이 전부 '아직 시작 전'
 *    이라 null이 되어 합계가 통째로 모자란다(사진의 신용대출은 기준월이 8월이라 5개월치만
 *    잡힌다). 연 납입액은 '지금부터 1년'이라는 run-rate이고, 그래야 만기일시·원리금균등에서
 *    정확히 `월 × 12`와 같아진다.
 * `missing` = 그 12개월 중 계상하지 못한 달 수(만기 경과 등) — 화면이 노출해야 한다.
 */
export const loanNext12Total = (
  loan: LedgerLoan | null | undefined,
  fromYm: string,
): { total: number; missing: number; levelPayment: boolean } => {
  let total = 0, missing = 0, level = true;
  for (let k = 0; k < 12; k++) {
    const r = loanSchedule(loan, addMonthsYm(fromYm, k));
    if (!r) { missing++; continue; }
    total += r.payment;
    if (!r.levelPayment) level = false;
  }
  return { total, missing, levelPayment: level };
};

/* ===========================================================================
 * F. 항목 계획/실적
 * =========================================================================== */

/** 그 달에 이 항목이 살아 있는가. `activeFrom`/`activeTo`가 비어 있으면 제한 없음. */
export const isItemActive = (item: LedgerItem, ym: string): boolean => {
  if (!item || !isValidYm(ym)) return false;
  if (isValidYm(item.activeFrom) && ym < item.activeFrom) return false;
  if (isValidYm(item.activeTo) && ym > item.activeTo) return false;
  return true;
};

/**
 * 그 달에 이 항목을 **집계에 넣는가**. `isItemActive`보다 넓다 — 적용기간 밖이라도
 * **그 달에 거래가 있으면 넣는다**.
 *
 * ⚠️ 왜 필요한가: 할부 회차는 거래월부터 n개월로 나뉘므로 `activeTo` 이후 달에 떨어질 수 있다.
 *    그 회차는 `ix.byItemYm`에는 있는데 `isItemActive` 게이트에 막혀 `monthTotals`·
 *    `expectedTotal`·매트릭스에서 전부 0이 됐다 — **돈이 조용히 사라지는** 실패 모드다
 *    (실측: activeTo '2026-10' 항목의 11월 회차 10,000이 세 집계에서 모두 0).
 * ⚠️ `isItemActive` 자체를 넓히지 말 것 — 그 함수는 계획(`planOf`)·미입력 판정
 *    (`expectsActual`)·연단위 달력의 게이트라, 거래 유무로 활성이 바뀌면 "적용기간 밖인데
 *    계획이 뜬다"가 생긴다. 넓히는 곳은 **실적을 세는 소비자**뿐이다.
 * ⚠️ 판정을 `actualResolved(...).value !== null`로 넓히지 말 것 — 적용기간 밖에 남아 있는
 *    **수동** 값까지 딸려 들어와 거래 0건 장부의 동작이 달라진다(하위호환의 축).
 *    `source === 'tx'`라야 `ix` 없이는 구조적으로 `isItemActive`와 완전히 같다.
 */
export const isItemCounted = (
  item: LedgerItem | null | undefined,
  ym: string,
  ix?: LedgerTxIndex | null,
): boolean => {
  if (!item) return false;
  if (isItemActive(item, ym)) return true;
  return !!ix && actualResolved(item, ym, ix).source === 'tx';
};

/**
 * 그 달의 계획 금액.
 * ⚠️ 무반올림 — MS365(연 127,000)는 10,583.333…으로 흘러야 사진의 예상 年 지출이 재현된다.
 * ⚠️ `group==='annual'`은 `dueMonth`인 달에만 계상한다(그 외 달은 0, null이 아니다 —
 *    "그 달엔 계획이 없다"는 확정이므로).
 */
export const planOf = (item: LedgerItem, ym: string): number | null => {
  if (!item || !isValidYm(ym)) return null;
  if (!isItemActive(item, ym)) return null;

  if (item.group === 'loan') {
    const r = loanSchedule(item.loan, ym);
    return r ? r.payment : null;
  }

  const ov = item.planOverride && finiteOr(item.planOverride[ym]);
  const base = ov !== null && ov !== undefined ? ov : finiteOr(item.plan);
  if (base === null) return null;

  if (item.group === 'annual') {
    const due = finiteOr(item.dueMonth);
    if (due === null) return null;                 // 납부월을 모르면 어느 달에 놓을지 알 수 없다
    return Number(ym.slice(5, 7)) === Math.trunc(due) ? base : 0;
  }

  return item.planUnit === 'year' ? base / 12 : base;
};

/**
 * `planOf`가 null을 돌려준 **이유**. 두 가지를 절대 뭉뚱그리지 말 것(사용자 확정 2026-09).
 *
 *  - `'unset'` — 계획을 **입력한 적이 없다**. 변동비처럼 계획을 세우지 않는 지출의 **정상 상태**다.
 *    사용자가 손댈 것이 없으므로 화면이 '산출 불가'라고 경고하면 매달 상시 점등하는 가짜 오류가 된다
 *    (실측: 변동비 2건 × 12개월 → 차이 열에 `산출불가 22`).
 *  - `'failed'` — 계획을 **산출하려다 실패**했다(대출 스케줄 null · 연단위 납부월 미상). 사용자가
 *    채워야 할 값이 비어 있는 상태이므로 경고 대상이다(§13.11 R-3: `loanSchedule`의 null 계약이
 *    "계산 실패는 0이 아니다"를 지킨다).
 *
 * ⚠️ 대출은 완납·만기 경과로도 null이 되지만 그대로 `'failed'`다 — R-3이 지키는 바로 그 경로라
 *    여기서 정상으로 강등하면 그 가드가 통째로 죽는다.
 * ⚠️ `planOf(item, ym) === null`일 때만 뜻이 있다(그 외에는 `'none'`).
 */
export type LedgerPlanMissingKind = 'none' | 'unset' | 'failed';

export const planMissingKind = (item: LedgerItem, ym: string): LedgerPlanMissingKind => {
  if (!item || !isValidYm(ym)) return 'none';
  if (!isItemActive(item, ym)) return 'none';
  if (planOf(item, ym) !== null) return 'none';
  if (item.group === 'loan') return 'failed';
  const ov = item.planOverride && finiteOr(item.planOverride[ym]);
  const base = ov !== null && ov !== undefined ? ov : finiteOr(item.plan);
  // 계획 칸이 비어 있으면 '세우지 않은 것'이고, 값이 있는데도 null이면 산출에 실패한 것이다
  // (연단위 항목의 납부월 미상이 그 경로다).
  return base === null ? 'unset' : 'failed';
};

/**
 * 그 달에 이 항목이 **실적 입력 대상**인가.
 *
 * ⚠️ `isItemActive`와 구분할 것. `group:'annual'`은 1년에 한 번만 나가므로 **납부월에만** 대상이다.
 *    이 구분이 없으면 연단위 항목 하나가 비납부월 11개월 내내 '미입력'으로 세어져
 *    ① KPI 배너가 사용자가 손댈 방법 없이 상시 점등 ② 그 항목의 연간 차이 열이 영구히 `'-'`
 *    ③ 납부월과 그 다음 달의 전월 대비가 `missing` 불일치로 **매년 2개월씩 비교 불가**가 된다
 *    (정확히 `activeFrom`이 막으려던 실패 모드).
 * ⚠️ 화면 3곳(월 집계·항목 행 연간 차이·그룹 소계)이 **같은 함수를 공유**해야 값이 갈리지 않는다.
 */
export interface LedgerExpectsOpts {
  /** 거래 인덱스. 없으면 **종전 동작 그대로**(하위호환의 축). */
  ix?: LedgerTxIndex | null;
  /** 오늘이 속한 달 'YYYY-MM'. 진행 중인 달을 '미입력'으로 세지 않기 위해 쓴다. */
  todayYm?: string;
}

export const expectsActual = (
  item: LedgerItem,
  ym: string,
  opts?: LedgerExpectsOpts | null,
): boolean => {
  if (!item || !isItemActive(item, ym)) return false;
  if (item.group === 'annual') {
    const due = finiteOr(item.dueMonth);
    if (!(due !== null && Number(ym.slice(5, 7)) === Math.trunc(due))) return false;
  }
  /**
   * 거래로 입력하는 항목(`entry:'tx'`)의 **이번 달**은 미입력이 아니라 '진행 중'이다.
   * ⚠️ 이 게이트가 없으면 매달 1일마다 전 항목이 '미입력'으로 점등하고, 그 배지는 사용자가
   *    한 달을 다 살기 전에는 끌 방법이 없다(경고가 상시 켜지면 신호가 0이 된다).
   * ⚠️ `entry:'monthly'`(레거시)에는 적용하지 않는다 — 그쪽은 월 단위 입력이라 이번 달을
   *    미리 채워 넣는 것이 정상 습관이고, 동작을 바꾸면 기존 사용자의 화면이 달라진다.
   */
  if (opts && opts.ix && item.entry === 'tx' && opts.todayYm && ym === opts.todayYm) {
    const hit = opts.ix.byItemYm.get(`${item.id}|${ym}`);
    if (!hit || hit.count === 0) return false;
  }
  return true;
};

/**
 * 그 달의 실제 금액. **키가 없으면 null**(미입력) — 0과 다르다.
 */
export const actualOf = (item: LedgerItem, ym: string): number | null => {
  if (!item || !item.actual || !isValidYm(ym)) return null;
  if (!Object.prototype.hasOwnProperty.call(item.actual, ym)) return null;
  return finiteOr(item.actual[ym]);
};

/** 계획 대비 차이(실제 − 계획). 둘 중 하나라도 없으면 null. */
export const varianceOf = (item: LedgerItem, ym: string): number | null => {
  const a = actualOf(item, ym);
  if (a === null) return null;
  const p = planOf(item, ym);
  if (p === null) return null;
  return a - p;
};

/**
 * 실제 금액 커밋. **빈 문자열이면 키를 지운다.**
 * ⚠️ `cleanNum`을 쓰지 말 것 — 빈칸을 0으로 만들어 '미입력'과 '0원'의 구분이 입력 즉시 붕괴한다.
 * 반환은 **새 객체**이고, 바뀐 게 없으면 원본 참조를 그대로 돌려준다(불필요한 저장 트리거 방지).
 */
export const commitActual = (
  actual: Record<string, number>,
  ym: string,
  raw: string,
): Record<string, number> => {
  const src = actual && typeof actual === 'object' ? actual : {};
  if (!isValidYm(ym)) return src;
  const text = String(raw ?? '').trim().replace(/,/g, '');
  const had = Object.prototype.hasOwnProperty.call(src, ym);

  if (text === '') {
    if (!had) return src;
    const next = { ...src };
    delete next[ym];
    return next;
  }
  const n = Number(text);
  if (!Number.isFinite(n)) return src;          // 잘못된 입력은 조용히 무시(기존 값 보존)
  if (had && src[ym] === n) return src;
  return { ...src, [ym]: n };
};

/* ===========================================================================
 * F-2. 거래 레이어 — 인덱스 · 실제 금액의 단일 소스 · CRUD
 *
 * ⚠️ **실제 금액의 단일 소스는 `actualResolved`다.** (항목, 월)에 거래가 한 건이라도 있으면
 *    거래 합이 이기고, 없으면 수동 `actual[ym]`, 그것도 없으면 null(미입력).
 *    화면·엑셀·달력이 각자 다른 규칙으로 고르면 같은 칸이 두 값이 된다.
 *
 * ⚠️ 집계 함수는 `ix`(인덱스)를 인자로 받되 **넘기지 않으면 종전 동작**이다(하위호환의 축).
 *    호출부가 `ix`를 빠뜨리면 거래가 조용히 무시돼 합계가 줄어든다 — 소스 가드가 그 배선을
 *    단언한다(이 저장소가 가장 싫어하는 실패 모드: 조용한 과소 계상).
 * =========================================================================== */

/** 할부 회차 1건. `seq`는 1-based. */
export interface LedgerInstallmentCharge { ym: string; amount: number; seq: number; total: number; }

/**
 * 금액을 `ym0`부터 `n`개월에 나눈다. **잔여는 마지막 회차가 흡수**해 Σ가 원금과 정확히 같다.
 * ⚠️ 이 항등식이 깨지면 월 합계의 합 ≠ 거래 합이 되어 어떤 검산도 통과하지 못한다.
 */
const spreadAmount = (amount: number, ym0: string, n: number): { ym: string; amount: number }[] => {
  if (!Number.isFinite(amount) || !isValidYm(ym0)) return [];
  const k = Math.min(Math.max(Math.trunc(n), 1), MAX_LEDGER_INSTALLMENT_MONTHS);
  if (k <= 1) return [{ ym: ym0, amount }];
  const per = Math.floor(amount / k);
  const out: { ym: string; amount: number }[] = [];
  let used = 0;
  for (let i = 0; i < k - 1; i++) {
    const ym = addMonthsYm(ym0, i);
    if (!ym) break;
    out.push({ ym, amount: per });
    used += per;
  }
  const last = addMonthsYm(ym0, k - 1);
  if (last) out.push({ ym: last, amount: amount - used });
  return out;
};

/**
 * 거래의 **월별 청구 회차**.
 *
 * ⚠️ 할부는 '이번 달 할부금이 이달 지출'로 계상한다(사용자 결정 1의 기본값 — 똑똑가계부·
 *    같이가계부 규약). 발생주의(구입 시 전액)로 바꾸지 말 것 — 월 예산표 모델과 어긋난다.
 * ⚠️ 첫 회차 월은 **거래월**이다. 단계 C(카드 청구주기)가 들어오면 `closingDay` 규칙이
 *    첫 회차 월을 정하도록 확장한다 — 그때 이 함수 하나만 바꾸면 된다.
 */
export const installmentCharges = (tx: LedgerTx | null | undefined): LedgerInstallmentCharge[] => {
  if (!tx) return [];
  const ym0 = ymOfDate(tx.date);
  if (!ym0) return [];
  const amount = finiteOr(tx.amount, 0) as number;
  const n = finiteOr(tx.installmentMonths);
  const k = n !== null && n >= 2 ? Math.min(Math.trunc(n), MAX_LEDGER_INSTALLMENT_MONTHS) : 1;
  return spreadAmount(amount, ym0, k).map((p, i) => ({ ym: p.ym, amount: p.amount, seq: i + 1, total: k }));
};

/** 살아 있는(휴지통이 아닌) 거래인가. */
export const isLiveTx = (tx: LedgerTx | null | undefined): boolean =>
  !!tx && typeof tx.id === 'string' && !!tx.id && isValidLedgerDate(tx.date)
  && Number.isFinite(tx.amount) && String(tx.deletedAt || '') === '';

/** 거래가 항목별로 기여하는 몫. 분할이 있으면 각 split, 없으면 `itemId` 하나. */
const txTargets = (tx: LedgerTx): { itemId: string; amount: number }[] => {
  const splits = Array.isArray(tx.splits) ? tx.splits.filter((s) => s && Number.isFinite(s.amount)) : [];
  if (splits.length > 0) return splits.map((s) => ({ itemId: String(s.itemId || ''), amount: s.amount }));
  return [{ itemId: String(tx.itemId || ''), amount: finiteOr(tx.amount, 0) as number }];
};

/**
 * 거래의 표시 이름. **거래 탭과 달력 패드가 공유**한다 — 손복제하면 같은 거래가 두 화면에서
 * 다른 이름으로 보인다.
 */
export const txDisplayName = (
  tx: LedgerTx | null | undefined,
  itemById: Map<string, LedgerItem> | null | undefined,
): string => {
  if (!tx) return '';
  const by = itemById instanceof Map ? itemById : new Map<string, LedgerItem>();
  const splits = Array.isArray(tx.splits) ? tx.splits : [];
  if (splits.length > 0) return splits.map((sp) => (by.get(sp.itemId)?.name || '미분류')).join(' + ');
  if (!tx.itemId) return '미분류';
  return by.get(tx.itemId)?.name || '(삭제된 항목)';
};

/** 거래가 닿는 항목 id 집합(분할 포함, 빈 id 제외). 두 라이터가 같은 집합을 쓰게 하는 단일 소스. */
const txTouchedItemIds = (tx: LedgerTx): Set<string> =>
  new Set(txTargets(tx).map((t) => t.itemId).filter(Boolean));

/**
 * 그 거래가 닿는 항목의 `entry`를 'tx'로 전환. **바뀐 게 없으면 같은 배열 참조**를 돌려준다.
 *
 * ⚠️ `addTx`와 `updateTx`가 **반드시 공유**해야 한다. 과거엔 `addTx`에만 있어서, 거래 탭의
 *    항목 변경·일괄 재분류로 거래를 받은 항목이 `entry:'monthly'`에 머물렀고 그 항목은
 *    이번 달 거래가 0건인 동안 계속 '미입력'으로 점등했다(끌 방법이 없다). 새 writer를
 *    추가할 때도 이 헬퍼를 부를 것.
 */
const flipEntryToTx = (
  items: LedgerItem[] | undefined,
  tx: LedgerTx,
): LedgerItem[] | undefined => {
  const touched = txTouchedItemIds(tx);
  if (touched.size === 0 || !Array.isArray(items)) return items;
  let changed = false;
  const out = items.map((it) => {
    if (!it || !touched.has(it.id) || it.entry === 'tx') return it;
    changed = true;
    return { ...it, entry: 'tx' as LedgerEntryMode };
  });
  return changed ? out : items;
};

/**
 * **축 정합 — `kind`(거래)와 `group`(항목)이 어긋나지 않게 강제한다.**
 *
 * ⚠️ 두 축이 갈리면 같은 달에 `ix.byYm`은 수입 50,000·지출 0인데 `monthTotals`는 항목
 *    group으로 판정해 지출 50,000·수입 0을 낸다(실측). 빠른 입력 바의 `지출/수입` 토글이
 *    항목과 무관하게 눌리므로 **사용자가 쉽게 만들 수 있는 상태**다.
 *
 * 규칙 — `itemId`/`splits`가 있으면 kind는 항목 group에서 파생하고, `'transfer'`는
 * **항목이 비어 있을 때만** 살아남는다. 충돌은 **사용자가 방금 만진 축**이 이긴다:
 *  · `patch.kind === 'transfer'`(이체를 명시적으로 골랐다) → 항목·분할을 비운다.
 *  · 그 밖에 이미 이체인 거래에 항목을 붙이려는 경우 → **이체가 이긴다**(항목을 비운다).
 *    ⚠️ 이쪽을 '항목이 이긴다'로 뒤집지 말 것 — 카드대금 결제·적금 이체가 지출로 되살아나
 *    이 앱이 `'transfer'`를 둔 이유(이중 계상 차단)가 통째로 무너진다.
 *  · 그 밖에는 항목이 이긴다(kind를 group에서 파생).
 *
 * 순수·멱등: 이미 정합이면 **같은 객체 참조**를 돌려준다(정규화 멱등 계약의 축).
 */
const resolveTxAxis = (
  tx: LedgerTx,
  items: LedgerItem[] | null | undefined,
  patch?: Partial<LedgerTx> | null,
): LedgerTx => {
  const hasSplits = Array.isArray(tx.splits) && tx.splits.length > 0;
  const first = hasSplits ? String(tx.splits[0].itemId || '') : String(tx.itemId || '');
  const wantsTransfer = !!patch && patch.kind === 'transfer';

  if (tx.kind === 'transfer' || wantsTransfer) {
    // 이체 — 항목·분할을 비운다(이체는 항목 축에 존재하지 않는다).
    if (tx.kind === 'transfer' && !tx.itemId && !hasSplits) return tx;
    return { ...tx, kind: 'transfer' as LedgerTxKind, itemId: '', splits: [] };
  }
  if (!first) return tx;                       // 미분류 — kind(지출/수입)를 그대로 둔다.
  const list = Array.isArray(items) ? items : [];
  const it = list.find((x) => x && x.id === first);
  if (!it) return tx;                          // 모르는 항목 — 지어내지 않는다.
  const k: LedgerTxKind = it.group === 'income' ? 'income' : 'expense';
  return k === tx.kind ? tx : { ...tx, kind: k };
};

export interface LedgerTxIndex {
  /** `${itemId}|${ym}` → 그 달 그 항목의 거래 합(환급은 음수, 할부는 회차 몫). */
  byItemYm: Map<string, { sum: number; count: number }>;
  /** `ym` → 지출/수입 합(이체 제외). 할부는 회차 몫. */
  byYm: Map<string, { expense: number; income: number; count: number }>;
  /**
   * `YYYY-MM-DD` → 그 날 발생한 거래 합.
   * ⚠️ **할부도 그날 결제한 전액**이다(회차로 쪼개지 않는다) — 날짜는 사실이고, 회차 날짜는
   *    존재하지 않는다(지어내면 사용자가 확인할 수 없는 값이 달력에 찍힌다).
   *    전 기간을 통틀면 `Σ byDate === Σ byYm`이라 검산은 그대로 성립한다.
   */
  byDate: Map<string, { expense: number; income: number; count: number }>;
  /** `${accountId}|${ym}` → 계좌 입출(이체 포함, 단계 C). */
  byAccountYm: Map<string, { out: number; in: number; count: number }>;
  /** `ym` → 미분류(항목을 고르지 않은) 지출 합. 결제수단 분해를 함께 담는다. */
  uncategorizedYm: Map<string, { sum: number; count: number; byPay: Record<string, number> }>;
  /** `${payer}|${ym}` → 그 사람 몫 지출. */
  byPayerYm: Map<string, { expense: number; count: number }>;
  /** `itemId` → 그 항목의 **첫 거래 월**(미입력 판정·entry 전환에 쓴다). */
  firstTxYm: Map<string, string>;
  /** 살아 있는 거래 수(휴지통 제외). */
  liveCount: number;
  /** 휴지통 거래 수. */
  trashCount: number;
}

const emptyTxIndex = (): LedgerTxIndex => ({
  byItemYm: new Map(), byYm: new Map(), byDate: new Map(), byAccountYm: new Map(),
  uncategorizedYm: new Map(), byPayerYm: new Map(), firstTxYm: new Map(),
  liveCount: 0, trashCount: 0,
});

/**
 * ⚠️ **참조 캐시**(WeakMap). 장부 객체는 편집마다 새로 만들어지므로(불변 갱신) 참조가 곧
 *    정확한 무효화 신호다. 제자리 변형(mutation)을 하면 캐시가 낡는다 — 이 저장소의 모든
 *    쓰기 헬퍼가 새 객체를 만드는 이유이기도 하다.
 */
const txIndexCache = new WeakMap<object, LedgerTxIndex>();

/**
 * 거래 인덱스. O(거래 수) 1회. 순수·결정적(같은 book → 같은 결과).
 *
 * ⚠️ 휴지통(`deletedAt !== ''`)은 **어떤 집계에도 들어가지 않는다**(여기서 한 번 걸러
 *    그 뒤 소비자가 다시 신경 쓰지 않게 한다).
 * ⚠️ 이체(`kind:'transfer'`)는 지출·수입 어디에도 들어가지 않는다 — 카드대금 결제·적금 이체가
 *    지출로 이중 계상되는 것이 국내 자동연동 앱의 고질병이고, 그걸 **구조로** 막는 자리다.
 */
export const txIndexOf = (book: LedgerBook | null | undefined): LedgerTxIndex => {
  if (!book || typeof book !== 'object') return emptyTxIndex();
  const hit = txIndexCache.get(book as unknown as object);
  if (hit) return hit;

  const ix = emptyTxIndex();
  const txs = Array.isArray(book.transactions) ? book.transactions : [];

  const bumpItem = (itemId: string, ym: string, v: number) => {
    const key = `${itemId}|${ym}`;
    const cur = ix.byItemYm.get(key) || { sum: 0, count: 0 };
    cur.sum += v; cur.count += 1;
    ix.byItemYm.set(key, cur);
  };

  for (const tx of txs) {
    if (!tx || typeof tx !== 'object') continue;
    if (String(tx.deletedAt || '') !== '') { ix.trashCount++; continue; }
    if (!isLiveTx(tx)) continue;
    ix.liveCount++;

    const sign = tx.refund === true ? -1 : 1;
    const date = tx.date;
    const ym0 = ymOfDate(date);
    const isTransfer = tx.kind === 'transfer';
    const isIncome = tx.kind === 'income';
    const total = (finiteOr(tx.amount, 0) as number) * sign;

    // ── 날짜 축(달력) — 할부도 그날 전액. 이체는 지출/수입이 아니다. ──
    if (!isTransfer) {
      const d = ix.byDate.get(date) || { expense: 0, income: 0, count: 0 };
      if (isIncome) d.income += total; else d.expense += total;
      d.count += 1;
      ix.byDate.set(date, d);
    }

    // ── 계좌 축(단계 C에서 잔액·카드 청구가 쓴다) ──
    const acc = String(tx.accountId || '');
    if (acc && ym0) {
      const a = ix.byAccountYm.get(`${acc}|${ym0}`) || { out: 0, in: 0, count: 0 };
      if (isIncome) a.in += total; else a.out += total;
      a.count += 1;
      ix.byAccountYm.set(`${acc}|${ym0}`, a);
    }
    if (isTransfer) {
      const to = String(tx.toAccountId || '');
      if (to && ym0) {
        const a = ix.byAccountYm.get(`${to}|${ym0}`) || { out: 0, in: 0, count: 0 };
        a.in += total; a.count += 1;
        ix.byAccountYm.set(`${to}|${ym0}`, a);
      }
      continue;   // ⚠️ 이체는 여기서 끝 — 항목·월 지출 축에 절대 넣지 않는다.
    }

    // ── 월 축(할부 회차 분배) ──
    const charges = installmentCharges(tx);
    for (const c of charges) {
      const y = ix.byYm.get(c.ym) || { expense: 0, income: 0, count: 0 };
      if (isIncome) y.income += c.amount * sign; else y.expense += c.amount * sign;
      y.count += 1;
      ix.byYm.set(c.ym, y);
    }

    // ── 항목 축(분할 × 할부) ──
    const targets = txTargets(tx);
    const amount = finiteOr(tx.amount, 0) as number;
    for (const t of targets) {
      // 할부는 그 몫을 같은 비율로 나눈다 — 분할과 할부가 겹쳐도 Σ가 정확하다.
      const parts = charges.length > 1 && amount !== 0
        ? spreadAmount(t.amount, ym0, charges.length)
        : [{ ym: ym0, amount: t.amount }];
      for (const p of parts) {
        if (!p.ym) continue;
        if (t.itemId) {
          bumpItem(t.itemId, p.ym, p.amount * sign);
          const first = ix.firstTxYm.get(t.itemId);
          if (!first || p.ym < first) ix.firstTxYm.set(t.itemId, p.ym);
        } else if (!isIncome) {
          const u = ix.uncategorizedYm.get(p.ym) || { sum: 0, count: 0, byPay: {} };
          u.sum += p.amount * sign;
          u.count += 1;
          u.byPay[tx.pay] = (u.byPay[tx.pay] || 0) + p.amount * sign;
          ix.uncategorizedYm.set(p.ym, u);
        }
      }
    }

    // ── 누가 축 ──
    const payer = String(tx.payer || '');
    if (payer && ym0 && !isIncome) {
      const p = ix.byPayerYm.get(`${payer}|${ym0}`) || { expense: 0, count: 0 };
      p.expense += total; p.count += 1;
      ix.byPayerYm.set(`${payer}|${ym0}`, p);
    }
  }

  txIndexCache.set(book as unknown as object, ix);
  return ix;
};

export interface LedgerActual {
  /** null = 미입력(0원과 다르다). */
  value: number | null;
  source: 'tx' | 'manual' | 'none';
  /** 거래 건수(source==='tx'일 때만 > 0). */
  count: number;
}

/**
 * 그 달 그 항목의 **실제 금액 — 단일 소스**.
 *
 * ⚠️ `actualOf`(수동 값만)는 이름·의미를 그대로 둔다(레거시 테스트·커밋 경로 불변).
 *    화면·집계·엑셀은 전부 이 함수로 옮긴다.
 * ⚠️ 거래가 있으면 수동 값은 **무시**된다(단일 소스). 화면은 그 사실을 배지로 알린다 —
 *    조용한 오적용보다 명시적 미적용.
 */
export const actualResolved = (
  item: LedgerItem | null | undefined,
  ym: string,
  ix?: LedgerTxIndex | null,
): LedgerActual => {
  if (!item || !isValidYm(ym)) return { value: null, source: 'none', count: 0 };
  if (ix && ix.byItemYm) {
    const hit = ix.byItemYm.get(`${item.id}|${ym}`);
    if (hit && hit.count > 0 && Number.isFinite(hit.sum)) {
      return { value: hit.sum, source: 'tx', count: hit.count };
    }
  }
  const m = actualOf(item, ym);
  return m === null ? { value: null, source: 'none', count: 0 } : { value: m, source: 'manual', count: 0 };
};

/** 그 달에 이 항목의 수동 값이 거래에 가려져 있는가(화면 배지의 단일 판정). */
export const manualShadowed = (
  item: LedgerItem | null | undefined,
  ym: string,
  ix?: LedgerTxIndex | null,
): number | null => {
  if (!item || !isValidYm(ym) || !ix) return null;
  const hit = ix.byItemYm.get(`${item.id}|${ym}`);
  if (!hit || hit.count === 0) return null;
  return actualOf(item, ym);
};

/* ── 필터 · 자동완성 ─────────────────────────────────────────────────────── */

export interface LedgerTxFilter {
  ym?: string;
  from?: string;
  to?: string;
  itemId?: string;
  itemIds?: string[];
  pay?: LedgerPay | '';
  accountId?: string;
  payer?: string;
  kind?: LedgerTxKind | '';
  /** 메모·누가 부분일치(대소문자 무시). */
  q?: string;
  refundOnly?: boolean;
  uncategorizedOnly?: boolean;
  /** true면 휴지통만, false/미지정이면 살아 있는 것만. */
  trashOnly?: boolean;
}

const txTouchesItem = (tx: LedgerTx, ids: Set<string>): boolean => {
  if (ids.has(String(tx.itemId || ''))) return true;
  const splits = Array.isArray(tx.splits) ? tx.splits : [];
  return splits.some((s) => s && ids.has(String(s.itemId || '')));
};

/**
 * 거래 목록 필터. **정렬은 바꾸지 않는다**(입력 배열의 순서 = date desc 규약을 그대로 유지).
 * ⚠️ 기본은 휴지통 제외다 — 실수로 목록·합계에 섞이면 삭제가 삭제로 보이지 않는다.
 */
export const filterTx = (
  txs: LedgerTx[] | null | undefined,
  f: LedgerTxFilter | null | undefined,
): LedgerTx[] => {
  const src = Array.isArray(txs) ? txs : [];
  const o = f || {};
  const ids = Array.isArray(o.itemIds) && o.itemIds.length > 0
    ? new Set(o.itemIds.map((s) => String(s)))
    : (o.itemId ? new Set([String(o.itemId)]) : null);
  const q = String(o.q || '').trim().toLowerCase();
  const out: LedgerTx[] = [];
  for (const tx of src) {
    if (!tx || typeof tx !== 'object') continue;
    const deleted = String(tx.deletedAt || '') !== '';
    if (o.trashOnly ? !deleted : deleted) continue;
    if (!isValidLedgerDate(tx.date)) continue;
    if (o.ym && ymOfDate(tx.date) !== o.ym) continue;
    if (o.from && tx.date < o.from) continue;
    if (o.to && tx.date > o.to) continue;
    if (ids && !txTouchesItem(tx, ids)) continue;
    if (o.pay && tx.pay !== o.pay) continue;
    if (o.kind && tx.kind !== o.kind) continue;
    if (o.accountId && String(tx.accountId || '') !== o.accountId) continue;
    if (o.payer && String(tx.payer || '') !== o.payer) continue;
    if (o.refundOnly && tx.refund !== true) continue;
    if (o.uncategorizedOnly) {
      const splits = Array.isArray(tx.splits) ? tx.splits : [];
      if (String(tx.itemId || '') !== '' || splits.length > 0) continue;
      // ⚠️ 이체는 **항목이 없는 것이 정상**이다 — '미분류만'에 섞으면 사용자가 카드대금 결제에
      //    항목을 붙이려 하고, 그 순간 이체가 지출로 계상돼 이중 계상 방지가 무너진다.
      if (tx.kind === 'transfer') continue;
    }
    if (q) {
      const hay = `${tx.memo || ''} ${tx.payer || ''}`.toLowerCase();
      const inSplit = (Array.isArray(tx.splits) ? tx.splits : [])
        .some((s) => s && String(s.memo || '').toLowerCase().includes(q));
      if (!hay.includes(q) && !inSplit) continue;
    }
    out.push(tx);
  }
  return out;
};

export interface LedgerItemSuggestion { itemId: string; name: string; group: LedgerGroup; score: number; }

/**
 * 빠른 입력 항목 자동완성 — 이름 부분일치 + **최근 60일 사용 빈도**.
 * ⚠️ 순수 함수라 `todayDate`를 인자로 받는다(`Date.now()` 금지 — 검증이 직접 import한다).
 */
export const suggestItems = (
  book: LedgerBook | null | undefined,
  q: string,
  todayDate: string,
  limit = 8,
): LedgerItemSuggestion[] => {
  const items = book && Array.isArray(book.items) ? book.items : [];
  if (items.length === 0) return [];
  const needle = String(q || '').trim().toLowerCase();

  // 최근 60일 빈도
  const freq = new Map<string, number>();
  const from = isValidLedgerDate(todayDate) ? shiftLedgerDate(todayDate, -60) : '';
  for (const tx of (book && Array.isArray(book.transactions) ? book.transactions : [])) {
    if (!isLiveTx(tx)) continue;
    if (from && tx.date < from) continue;
    for (const t of txTargets(tx)) {
      if (!t.itemId) continue;
      freq.set(t.itemId, (freq.get(t.itemId) || 0) + 1);
    }
  }

  const out: LedgerItemSuggestion[] = [];
  for (const it of items) {
    if (!it) continue;
    const name = String(it.name || '');
    const lower = name.toLowerCase();
    let score = 0;
    if (needle) {
      if (lower === needle) score += 100;
      else if (lower.startsWith(needle)) score += 60;
      else if (lower.includes(needle)) score += 30;
      else if (String(it.category || '').toLowerCase().includes(needle)) score += 15;
      else continue;
    }
    score += Math.min(freq.get(it.id) || 0, 20) * 2;
    // 변동비를 살짝 앞세운다 — 빠른 입력은 대부분 변동비다(고정비는 ✔ 확인이 담당, 단계 B).
    if (it.group === 'variable') score += 3;
    out.push({ itemId: it.id, name, group: it.group, score });
  }
  out.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  return out.slice(0, Math.max(1, Math.trunc(limit)));
};

/** 'YYYY-MM-DD'를 일 단위로 옮긴다. ⚠️ UTC로 계산해 로컬 타임존이 결과를 흔들지 않게 한다. */
export const shiftLedgerDate = (date: string, days: number): string => {
  if (!isValidLedgerDate(date) || !Number.isFinite(days)) return '';
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  const t = Date.UTC(y, m - 1, d) + Math.trunc(days) * 86400000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear(), mm = dt.getUTCMonth() + 1, dd = dt.getUTCDate();
  if (yy < LEDGER_YEAR_MIN || yy > LEDGER_YEAR_MAX) return '';
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};

/* ── CRUD — 전부 순수(새 book 반환). 상한·정렬·entry 전환·충돌 보고를 여기서 끝낸다. ── */

export const makeLedgerTx = (over: Partial<LedgerTx> = {}): LedgerTx => ({
  id: generateId(),
  date: '',
  amount: 0,
  refund: false,
  kind: 'expense',
  itemId: '',
  splits: [],
  pay: 'card',
  accountId: '',
  toAccountId: '',
  memo: '',
  payer: '',
  installmentMonths: null,
  origin: 'manual',
  originKey: '',
  deletedAt: '',
  createdAt: 0,
  ...over,
});

/** 목록 정렬 규약 — date desc, 같으면 createdAt desc, 그래도 같으면 id로 결정적. */
export const compareTxDesc = (a: LedgerTx, b: LedgerTx): number => {
  const d = String(b.date || '').localeCompare(String(a.date || ''));
  if (d !== 0) return d;
  const c = (finiteOr(b.createdAt, 0) as number) - (finiteOr(a.createdAt, 0) as number);
  if (c !== 0) return c;
  return String(a.id || '').localeCompare(String(b.id || ''));
};

export const sortTxDesc = (txs: LedgerTx[]): LedgerTx[] => txs.slice().sort(compareTxDesc);

export interface LedgerAddTxResult {
  book: LedgerBook;
  /**
   * (항목, 월)에 수동 값이 있는데 그 달의 **첫 거래**가 들어온 경우.
   * ⚠️ 추가를 막지 않는다(입력 마찰 금지) — 화면이 인라인으로 묻고 사용자가 고른다.
   */
  conflict: { itemId: string; ym: string; manual: number } | null;
  error: '' | 'limit' | 'invalid';
}

/**
 * 거래 추가.
 * ⚠️ 상한에 걸리면 **거부**한다(조용히 오래된 것을 버리지 않는다 — 사용자가 방금 친 값과
 *    과거 기록 중 무엇을 버릴지는 사용자가 정한다: 연도 정리(단계 E)).
 */
export const addTx = (
  book: LedgerBook | null | undefined,
  tx: LedgerTx,
): LedgerAddTxResult => {
  if (!book) return { book: book as LedgerBook, conflict: null, error: 'invalid' };
  const raw = normalizeTx(tx);
  if (!raw) return { book, conflict: null, error: 'invalid' };
  // ⚠️ 축 정합을 먼저 — 아래 `touched`/저장이 전부 정정된 거래를 봐야 한다.
  const next = resolveTxAxis(raw, book.items);
  const list = Array.isArray(book.transactions) ? book.transactions : [];
  if (list.length >= MAX_LEDGER_TX) return { book, conflict: null, error: 'limit' };

  const ix = txIndexOf(book);
  const ym = ymOfDate(next.date);
  let conflict: LedgerAddTxResult['conflict'] = null;

  // 수동값 충돌 보고 — 이 거래가 닿는 항목만 본다(entry 전환은 공유 헬퍼가 한다).
  if (ym) {
    for (const id of txTouchedItemIds(next)) {
      const it = (Array.isArray(book.items) ? book.items : []).find((x) => x && x.id === id);
      if (!it) continue;
      const had = ix.byItemYm.get(`${id}|${ym}`);
      const manual = actualOf(it, ym);
      if ((!had || had.count === 0) && manual !== null) { conflict = { itemId: id, ym, manual }; break; }
    }
  }
  const items = flipEntryToTx(book.items, next);

  return {
    book: { ...book, items, transactions: sortTxDesc([...list, next]) },
    conflict,
    error: '',
  };
};

export const updateTx = (
  book: LedgerBook | null | undefined,
  id: string,
  patch: Partial<LedgerTx>,
): LedgerBook => {
  if (!book || !id) return book as LedgerBook;
  const list = Array.isArray(book.transactions) ? book.transactions : [];
  const i = list.findIndex((t) => t && t.id === id);
  if (i < 0) return book;
  const mergedRaw = normalizeTx({ ...list[i], ...patch, id: list[i].id });
  if (!mergedRaw) return book;
  // ⚠️ `patch`를 함께 넘긴다 — 사용자가 방금 만진 축(이체 선택 vs 항목 배정)이 이긴다.
  const merged = resolveTxAxis(mergedRaw, book.items, patch);
  const out = list.slice();
  out[i] = merged;
  // ⚠️ `addTx`와 **같은 헬퍼**로 entry를 전환한다 — 여기가 빠져 있어서 일괄 재분류로 거래를
  //    받은 항목이 영구히 '미입력'으로 표시됐다(단계 A 사후 검토 B2).
  const items = flipEntryToTx(book.items, merged);
  return { ...book, items, transactions: sortTxDesc(out) };
};

/**
 * 소프트 삭제(휴지통). ⚠️ 배열에서 지우지 말 것 — 되돌리기 없는 삭제는 이탈 원인이고,
 * 이 화면은 z-1090이라 확인 토스트도 뜨지 않는다.
 */
export const softDeleteTx = (
  book: LedgerBook | null | undefined,
  ids: string[],
  today: string,
): LedgerBook => {
  if (!book || !Array.isArray(ids) || ids.length === 0) return book as LedgerBook;
  const stamp = isValidLedgerDate(today) ? today : '';
  if (!stamp) return book;
  const set = new Set(ids.map(String));
  const list = Array.isArray(book.transactions) ? book.transactions : [];
  let changed = false;
  const out = list.map((t) => {
    if (!t || !set.has(t.id) || String(t.deletedAt || '') !== '') return t;
    changed = true;
    return { ...t, deletedAt: stamp };
  });
  return changed ? { ...book, transactions: out } : book;
};

export const restoreTx = (book: LedgerBook | null | undefined, ids: string[]): LedgerBook => {
  if (!book || !Array.isArray(ids) || ids.length === 0) return book as LedgerBook;
  const set = new Set(ids.map(String));
  const list = Array.isArray(book.transactions) ? book.transactions : [];
  let changed = false;
  const out = list.map((t) => {
    if (!t || !set.has(t.id) || String(t.deletedAt || '') === '') return t;
    changed = true;
    return { ...t, deletedAt: '' };
  });
  return changed ? { ...book, transactions: out } : book;
};

/** 영구 삭제 — 사용자가 휴지통에서 명시적으로 누를 때만. 정규화가 자동으로 비우지 않는다. */
export const purgeTx = (book: LedgerBook | null | undefined, ids: string[]): LedgerBook => {
  if (!book || !Array.isArray(ids) || ids.length === 0) return book as LedgerBook;
  const set = new Set(ids.map(String));
  const list = Array.isArray(book.transactions) ? book.transactions : [];
  const out = list.filter((t) => !(t && set.has(t.id)));
  return out.length === list.length ? book : { ...book, transactions: out };
};

/**
 * 수동 월 합계를 거래 1건으로 옮긴다(충돌 해소 '거래로 옮기기').
 * 날짜는 그 달 1일, `origin:'migrate'`.
 */
export const migrateManualToTx = (
  book: LedgerBook | null | undefined,
  itemId: string,
  ym: string,
): LedgerBook => {
  if (!book || !itemId || !isValidYm(ym)) return book as LedgerBook;
  const items = Array.isArray(book.items) ? book.items : [];
  const item = items.find((it) => it && it.id === itemId);
  if (!item) return book;
  const manual = actualOf(item, ym);
  if (manual === null) return book;
  const res = addTx(book, makeLedgerTx({
    date: `${ym}-01`,
    amount: Math.abs(manual),
    refund: manual < 0,
    kind: item.group === 'income' ? 'income' : 'expense',
    itemId,
    pay: item.pay,
    memo: '수동 입력 이전',
    origin: 'migrate',
    createdAt: finiteOr(item.createdAt, 0) as number,
  }));
  if (res.error) return book;
  return dropManual(res.book, itemId, ym);
};

/** 수동 월 합계를 지운다(충돌 해소 '수동 값 삭제'). */
export const dropManual = (
  book: LedgerBook | null | undefined,
  itemId: string,
  ym: string,
): LedgerBook => {
  if (!book || !itemId || !isValidYm(ym)) return book as LedgerBook;
  const items = Array.isArray(book.items) ? book.items : [];
  const i = items.findIndex((it) => it && it.id === itemId);
  if (i < 0) return book;
  const cur = items[i];
  if (!cur.actual || !Object.prototype.hasOwnProperty.call(cur.actual, ym)) return book;
  const actual = { ...cur.actual };
  delete actual[ym];
  const out = items.slice();
  out[i] = { ...cur, actual };
  return { ...book, items: out };
};

/**
 * 스냅샷 저장 전 거래를 벗긴다.
 *
 * ⚠️ **거래는 스냅샷에 넣지 않는다**(사용자 결정 2의 기본값). 512KB 예산에 700KB 거래를 넣으면
 *    `pushLedgerSnapshot`이 이전 스냅샷을 전부 버려 사실상 1개만 남는다 — 스냅샷의 존재 이유
 *    (여러 시점의 복구 지점)가 사라진다. 거래의 안전망은 휴지통이고, 스냅샷은 **계획 매트릭스·
 *    수동 실적·설정**의 안전망이다.
 */
export const stripTxForSnapshot = (books: LedgerBooks | null | undefined): LedgerBooks => {
  if (!Array.isArray(books)) return [];
  return books.map((b) => (b && Array.isArray(b.transactions) && b.transactions.length > 0
    ? { ...b, transactions: [] } : b));
};

/* ===========================================================================
 * G. 집계
 * =========================================================================== */

export interface LedgerMonthTotals {
  /** 그 달에 실제로 나가는 계획 지출(annual의 납부월 포함) */
  planExpense: number;
  /** 입력된 실제 지출만의 합 */
  actualExpense: number;
  planIncome: number;
  actualIncome: number;
  /** 실제를 아직 입력하지 않은 지출 항목 수 */
  missingExpense: number;
  /**
   * 미입력 항목의 id 목록(정렬).
   * ⚠️ 전월·전년 비교가 **개수가 아니라 이 집합**을 봐야 한다 — 개수만 보면 '1월은 월세만 입력,
   *    2월은 커피만 입력'처럼 완료도가 실제로 다른 두 달이 같은 개수로 통과해 −93.6% 같은
   *    거짓 신호를 낸다(이 함수가 막으려던 바로 그 실패 모드).
   */
  missingIds: string[];
  /** 계획을 산출하지 못한 항목 수(대출 계산 실패 등) — missing과 구분한다 */
  unresolved: number;
  /** 그 달에 살아 있는 지출 항목 수 */
  activeExpense: number;
  /** 미분류 거래 합(항목을 고르지 않은 지출) — `actualExpense`에 **이미 포함**돼 있다. */
  uncategorized: number;
  uncategorizedCount: number;
  byGroup: Record<string, { plan: number; actual: number; missing: number }>;
  /**
   * 결제수단별 소계 — 사진의 '현금합계' / '카드 합계' 회색 행.
   * ⚠️ **지출만** 담는다. 수입을 섞으면 '현금합계'가 급여를 포함해 사진과 정면으로 어긋나고,
   *    도넛의 결제수단 분해도 100%를 넘는다(수입 항목의 기본 결제수단이 'card'라 실제로 발생).
   */
  byPay: Record<string, { plan: number; actual: number }>;
}

const emptyGroupAgg = () => ({ plan: 0, actual: 0, missing: 0 });

/**
 * @param todayYm 오늘이 속한 달. 넘기면 `entry:'tx'` 항목의 **진행 중인 달**을 미입력으로
 *   세지 않는다(넘기지 않으면 종전 동작 그대로 — 하위호환의 축).
 */
export const monthTotals = (
  book: LedgerBook | null | undefined,
  ym: string,
  todayYm?: string,
): LedgerMonthTotals => {
  const out: LedgerMonthTotals = {
    planExpense: 0, actualExpense: 0, planIncome: 0, actualIncome: 0,
    missingExpense: 0, missingIds: [], unresolved: 0, activeExpense: 0,
    uncategorized: 0, uncategorizedCount: 0,
    byGroup: {}, byPay: {},
  };
  const items = book && Array.isArray(book.items) ? book.items : [];
  // ⚠️ 실제 금액의 단일 소스 — 거래가 있으면 거래 합이 이긴다(`actualResolved`).
  const ix = txIndexOf(book);
  const expOpts: LedgerExpectsOpts = { ix, todayYm: isValidYm(todayYm) ? todayYm : '' };
  for (const it of items) {
    // ⚠️ `isItemCounted` — 적용기간 밖이라도 그 달에 거래가 있으면 센다(할부 회차가 사라지지 않게).
    if (!it || !isItemCounted(it, ym, ix)) continue;
    const isIncome = it.group === 'income';
    const p = planOf(it, ym);
    const a = actualResolved(it, ym, ix).value;

    if (!out.byGroup[it.group]) out.byGroup[it.group] = emptyGroupAgg();
    // ⚠️ byPay는 지출 전용 — 수입을 섞으면 '현금합계'에 급여가 들어간다.
    if (!isIncome && !out.byPay[it.pay]) out.byPay[it.pay] = { plan: 0, actual: 0 };

    // ⚠️ Number.isFinite 검사 — 하나의 비유한 값이 합계 전체를 삼키는 것을 구조적으로 막는다.
    if (p !== null && Number.isFinite(p)) {
      if (isIncome) out.planIncome += p; else out.planExpense += p;
      out.byGroup[it.group].plan += p;
      if (!isIncome) out.byPay[it.pay].plan += p;
    } else if (!isIncome) {
      out.unresolved++;
    }

    if (a !== null && Number.isFinite(a)) {
      if (isIncome) out.actualIncome += a; else out.actualExpense += a;
      out.byGroup[it.group].actual += a;
      if (!isIncome) out.byPay[it.pay].actual += a;
    } else if (!isIncome && expectsActual(it, ym, expOpts)) {
      // ⚠️ annual의 비납부월은 '미입력'이 아니다 — expectsActual이 그 구분의 단일 소스다.
      out.missingExpense++;
      out.missingIds.push(String(it.id || ''));
      out.byGroup[it.group].missing++;
    }
    if (!isIncome && expectsActual(it, ym, expOpts)) out.activeExpense++;
  }

  /**
   * 미분류 거래 — 항목이 없어 위 순회로는 잡히지 않지만 **실제로 나간 돈**이다.
   * ⚠️ 빠뜨리면 사용자가 빠르게 입력한 지출이 KPI·전월 대비·달력에서 통째로 사라진다
   *    (입력 마찰을 없애려고 허용한 미분류가 곧 '기록해도 안 보이는 돈'이 된다).
   * ⚠️ 그룹은 `variable`로 계상한다 — 화면의 미분류 가상 행이 변동비 그룹 끝에 있고,
   *    Σ그룹 === 총계 항등식이 그래야 성립한다.
   */
  const un = ix.uncategorizedYm.get(ym);
  if (un && Number.isFinite(un.sum)) {
    out.actualExpense += un.sum;
    out.uncategorized = un.sum;
    out.uncategorizedCount = un.count;
    if (!out.byGroup.variable) out.byGroup.variable = emptyGroupAgg();
    out.byGroup.variable.actual += un.sum;
    for (const [pay, v] of Object.entries(un.byPay)) {
      if (!Number.isFinite(v)) continue;
      if (!out.byPay[pay]) out.byPay[pay] = { plan: 0, actual: 0 };
      out.byPay[pay].actual += v;
    }
  }

  out.missingIds.sort();
  return out;
};

/* ===========================================================================
 * G-2. 예상(expected)·반영(reflected) 집계 — "계획만 입력해도 소계가 나온다"
 *
 * 2026-09 개정(재설계 §13.6-1): **반영값(실제 ?? 계획)은 `reflectedMonth`·`reflectedCompare`
 * 전용 함수로만 소비**한다. 분석·전월/전년 대비·연간·달력이 전부 그 두 함수를 쓴다.
 *
 * ⚠️ **그래도 `monthTotals`(실제 전용)에는 여전히 섞지 않는다.** 실제 전용 집계의 소비자는
 *    **확인 현황**뿐이다 — 월 헤더 `확인 N/M`·배너·`applyPlanAsActual`(계획대로 확인)·
 *    엑셀 ①·③의 '실제'·'미확인' 열. 거기에 계획으로 채운 값이 섞이면 "무엇을 아직 확인하지
 *    않았는가"를 화면이 답할 수 없게 된다(옛 `missing-mismatch` 방어가 지키던 것의 잔여).
 * ⚠️ 옛 −87.2% 사고(완료도가 다른 두 달을 실제값으로 비교)의 방어는 산식이 아니라 **구조**로
 *    남는다 — 두 달이 모두 반영값이라 완비되고 '완료도 불일치'라는 상태 자체가 없다. 대신
 *    새 위험 = **'0% 거짓말'**(둘 다 계획으로만 채운 달끼리 비교 → 변동 없음)이 생기고,
 *    그 완화 4종(월 헤더 `확인 N/M · 진행 K` · 비교 라벨 `계획 반영 N건 포함` · 미래 달 `-` ·
 *    산출 불가 집합이 다른 달 `-`)은 `reflectedCompare`의 반환 필드가 전부 실어 나른다.
 *    **넷 중 하나라도 빼면 반영값 비교가 '확정 실적 비교'로 읽힌다.**
 * =========================================================================== */

/**
 * 그 달의 '예상' 금액 — 실제가 있으면 실제, 없으면 계획.
 *
 * ⚠️ **`??`이지 `||`가 아니다.** `actualOf`는 미입력=null / 명시적 0=0을 이미 인코딩한다.
 *    `||`로 쓰면 "그 달엔 안 썼다"는 확정 0이 계획으로 되살아나 미입력/0원 구분이
 *    이 한 줄에서 붕괴한다.
 * ⚠️ 실제도 계획도 없으면 **0이 아니라 null**(모른다 ≠ 0원).
 */
export const expectedOf = (
  item: LedgerItem,
  ym: string,
  ix?: LedgerTxIndex | null,
): number | null => {
  if (!item || !isValidYm(ym) || !isItemCounted(item, ym, ix)) return null;
  // ⚠️ `ix`를 넘기지 않으면 수동 값만 본다(종전 동작). 화면·엑셀은 반드시 넘길 것.
  const a = actualResolved(item, ym, ix).value;
  return a !== null ? a : planOf(item, ym);
};

export interface LedgerExpected {
  /** Σ(실제 ?? 계획) */
  value: number;
  /** 그중 실제로 입력된 몫 */
  fromActual: number;
  /** 그중 계획으로 채운 몫 */
  fromPlan: number;
  actualCount: number;
  /** 계획으로 채운 항목 수 — 화면이 "계획 N건"으로 노출해야 실적으로 오독되지 않는다 */
  plannedCount: number;
  /**
   * 실제도 계획도 못 구한 항목 수(대출 계산 실패 등).
   * ⚠️ `plannedCount`와 다른 뜻이다 — 이건 '모른다', 저건 '계획으로 채웠다'.
   * ⚠️ 이 수를 **화면의 '산출 불가' 경고에 그대로 쓰지 말 것** — 아래 `noPlan`을 뺀
   *    `unresolvedFailures(e)`가 그 용도다. 값 집계(`value`가 하한인가)와
   *    `unresolvedIds` 집합 비교(R-7)는 종전대로 이 수를 쓴다.
   */
  unresolved: number;
  /**
   * `unresolved` 중 **계획을 입력한 적이 없어서**인 항목 수(= `planMissingKind === 'unset'`).
   * 변동비처럼 계획을 세우지 않는 지출의 정상 상태라 **경고 대상이 아니다**(사용자 확정 2026-09).
   * ⚠️ `unresolved`에서 빼지 말 것 — 그 값은 `unresolvedIds`와 짝이고, 집합이 달라지면
   *    `reflectedCompare`의 전월/전년 비교 가능 판정(R-7)이 통째로 바뀐다.
   */
  noPlan: number;
  /**
   * 그 달 **활성 항목 전체**의 계획 합(실적 유무와 무관).
   * ⚠️ `fromPlan`과 절대 혼동하지 말 것 — `fromPlan`은 '실적이 없는 항목의 계획'이라
   *    사용자가 실적을 채워 넣을수록 0으로 수렴한다. 소계 행의 '계획' 열이 그 값을 쓰면
   *    사용자가 값을 검산할 기준선이 조용히 사라진다(실측: 계획 547,000 → 17,000).
   */
  planSum: number;
  /** 계획을 산출한 항목 수 */
  planCount: number;
  /** 그 달에 살아 있는 항목 수. 0이면 '항목 없음'이지 '미입력'이 아니다. */
  activeCount: number;
  /**
   * **확인분 차이** = Σ(실제 − 계획 | 두 값이 다 있는 셀). 차이 열(항목·소계·총계)의 단일 소스
   * (재설계 §13.6-4, 결정 D5). 항목 행과 롤업 행이 **같은 필드**를 더하므로 소계 = Σ항목이
   * 구조로 성립한다. ⚠️ 계획이 없는 셀(미분류·산출 불가)은 셀 자체가 없으므로 들어가지 않는다.
   */
  confirmedVar: number;
  /** 그 셀 수. 0이면 차이 열은 `-`(0으로 단언하지 않는다). */
  confirmedCells: number;
  /**
   * 산출 불가 항목 id(정렬). `reflectedCompare`가 두 달의 **집합**을 비교하는 데 쓴다 —
   * '하나라도 있으면 `-`'로 좁히면 완납 후 잔액 0인 대출 한 줄이 전 구간 전월 대비를 `-`로
   * 되돌린다(§13.11 R-7).
   */
  unresolvedIds: string[];
}

const emptyExpected = (): LedgerExpected => ({
  value: 0, fromActual: 0, fromPlan: 0,
  actualCount: 0, plannedCount: 0, unresolved: 0, noPlan: 0,
  planSum: 0, planCount: 0, activeCount: 0,
  confirmedVar: 0, confirmedCells: 0, unresolvedIds: [],
});

/**
 * 화면이 **'산출 불가'라고 경고해야 하는** 건수 = 계획을 산출하려다 실패한 것만.
 *
 * ⚠️ `e.unresolved`를 그대로 화면에 쓰지 말 것 — 거기에는 '계획을 세우지 않는 항목'(변동비 등)이
 *    섞여 있어, 사용자가 손댈 것이 없는 정상 상태가 매달 오류로 표시된다(사용자 보고 2026-09:
 *    변동비 소계 차이 열의 `산출불가 22`). 반대로 이 값을 0으로 뭉개면 `loanSchedule` 실패가
 *    '차이 ₩0'으로 확정 단언되는 R-3 회귀가 난다.
 * ⚠️ **소비자 전부가 이 함수 하나를 공유할 것**(매트릭스 소계·분석 탭 요약·수지 균형 각주) —
 *    한 화면만 규칙이 갈리면 같은 달에 대해 두 개의 '산출 불가'가 뜬다.
 */
export const unresolvedFailures = (e: LedgerExpected | null | undefined): number =>
  (e ? Math.max(0, (e.unresolved || 0) - (e.noPlan || 0)) : 0);

const addExpected = (
  o: LedgerExpected,
  item: LedgerItem,
  ym: string,
  ix?: LedgerTxIndex | null,
): void => {
  if (!item || !isItemCounted(item, ym, ix)) return;
  o.activeCount++;
  const p = planOf(item, ym);
  const hasPlan = p !== null && Number.isFinite(p);
  if (hasPlan) { o.planSum += p; o.planCount++; }
  const a = actualResolved(item, ym, ix).value;
  if (a !== null && Number.isFinite(a)) {
    o.value += a; o.fromActual += a; o.actualCount++;
    // 확인분 차이 — 실제·계획이 **둘 다** 있는 셀만. 무반올림(표시만 반올림).
    if (hasPlan) { o.confirmedVar += a - (p as number); o.confirmedCells++; }
  } else if (hasPlan) {
    o.value += p as number; o.fromPlan += p as number; o.plannedCount++;
  } else {
    o.unresolved++;
    o.unresolvedIds.push(String(item.id || ''));
    // ⚠️ '계획을 세우지 않는 항목'(변동비 등)과 '산출 실패'(대출 스케줄 null)를 여기서 가른다.
    //    값 집계·집합 비교는 종전대로 `unresolved`를 쓰고, 화면 경고만 `unresolvedFailures`를 쓴다.
    if (planMissingKind(item, ym) === 'unset') o.noPlan++;
  }
};

/** `addExpected` 누적이 끝난 뒤 한 번 — 집합 비교가 순서에 안 흔들리게 정렬한다. */
const finishExpected = (o: LedgerExpected): LedgerExpected => {
  if (o.unresolvedIds.length > 1) o.unresolvedIds.sort();
  return o;
};

/**
 * 항목 배열의 그 달 예상 합.
 * ⚠️ 넘겨받은 items를 **그대로** 더한다 — 수입 제외는 호출부 책임이 아니다:
 *    `group === 'income'` 항목은 이 함수가 **직접** 건너뛴다(아래). 지출 축 전용이다.
 * ⚠️ 절대 null을 돌려주지 않고 절대 throw하지 않는다. "모른다"는 `unresolved`가 진다.
 */
export const expectedTotal = (
  items: LedgerItem[] | null | undefined,
  ym: string,
  ix?: LedgerTxIndex | null,
): LedgerExpected => {
  const o = emptyExpected();
  if (!Array.isArray(items) || !isValidYm(ym)) return o;
  for (const it of items) {
    // ⚠️ 수입 제외 — 이 게이트를 호출부에 위임하지 말 것. `byPay`가 수입을 섞어 '현금합계'에
    //    급여가 들어가던 회귀(verify #48c)가 monthTotals 밖으로 자리만 옮겨 되살아난다.
    if (!it || it.group === 'income') continue;
    addExpected(o, it, ym, ix);
  }
  return finishExpected(o);
};

/** 수입 전용 예상 합 — 지출과 **분리된 축**이므로 별도 함수다(한 함수에 플래그 금지). */
export const expectedIncomeTotal = (
  items: LedgerItem[] | null | undefined,
  ym: string,
  ix?: LedgerTxIndex | null,
): LedgerExpected => {
  const o = emptyExpected();
  if (!Array.isArray(items) || !isValidYm(ym)) return o;
  for (const it of items) {
    if (!it || it.group !== 'income') continue;
    addExpected(o, it, ym, ix);
  }
  return finishExpected(o);
};

/**
 * 결제수단별 예상 합. **항목이 존재하는 수단만** 키를 만든다(값이 0이어도 만든다 —
 * 항목이 있으면 사용자가 봐야 한다).
 * ⚠️ 분석 탭의 기존 `payRows` 필터(`plan > 0 || actual > 0`)와 **다른 규칙이다. 통일하지
 *    말 것** — 묻는 질문이 다르다(그쪽은 도넛 슬롯, 이쪽은 표 행).
 */
export const expectedByPay = (
  items: LedgerItem[] | null | undefined,
  ym: string,
  ix?: LedgerTxIndex | null,
): Record<string, LedgerExpected> => {
  const out: Record<string, LedgerExpected> = {};
  if (!Array.isArray(items) || !isValidYm(ym)) return out;
  for (const it of items) {
    if (!it || it.group === 'income') continue;   // ⚠️ 수입 제외(위와 같은 이유)
    // ⚠️ 게이트가 **두 곳**이다(여기 + addExpected) — 한쪽만 넓히면 그 결제수단 버킷이
    //    통째로 비거나 전부 0인 키가 생긴다. 둘 다 아니면 둘 다.
    if (!isItemCounted(it, ym, ix)) continue;
    const key = it.pay;
    if (!out[key]) out[key] = emptyExpected();
    addExpected(out[key], it, ym, ix);
  }
  for (const k of Object.keys(out)) finishExpected(out[k]);
  return out;
};

/**
 * 장부 전체(지출 그룹만)의 그 달 예상 합.
 * ⚠️ **삭제 금지** — `verify:ledger #83*·#85b`가 직접 import한다. 호출부가 `reflectedMonth`로
 *    옮겨 가도 이 함수는 그 안에서 불린다(named export가 사라지면 검증 스크립트가 첫 줄에서
 *    죽고, 하네스는 그것을 '검출'로 위장한다 — §13.11 R-2).
 */
export const expectedGrandTotal = (book: LedgerBook | null | undefined, ym: string): LedgerExpected =>
  expectedTotal(book && Array.isArray(book.items) ? book.items : [], ym, txIndexOf(book));

/* ===========================================================================
 * G-3. 반영(reflected) 집계 — 소계·총계·분석·달력·엑셀 ③이 공유하는 단일 소스 (2026-09, §13)
 *
 * 반영값 = `actualResolved(...).value ?? planOf(...)`(= `expectedOf`, 무변경) + 미분류 거래.
 * 시간 경계는 **호출부가 `todayYm`으로 판정**한다(`ym > todayYm` = '예상'). 값은 같은 식이고
 * 표시·비교 가능 여부만 다르다.
 * =========================================================================== */

export interface LedgerReflected extends LedgerExpected {
  /** 미분류 거래 합(항목이 없는 지출) — `value`에 **이미 포함**돼 있다. */
  uncategorized: number;
  uncategorizedCount: number;
  /** 결제수단별 — 미분류 몫을 그 수단에 더한 뒤의 값. 불변식 Σ byPay.value === value */
  byPay: Record<string, LedgerExpected>;
  /** 그룹별 — 미분류는 `variable`. 불변식 Σ byGroup.value === value */
  byGroup: Record<string, LedgerExpected>;
  /** 수입 축(지출과 분리) = expectedIncomeTotal(items).value */
  incomeValue: number;
}

/**
 * 그 달의 **반영 집계**(지출 축).
 * ⚠️ `expectedGrandTotal`을 **여기서 부른다**(검증이 직접 import하는 이름이라 삭제·우회 금지).
 * ⚠️ 거래 0건 + 미분류 0건이면 `value === expectedTotal(items).value` — 하위호환의 축.
 */
export const reflectedMonth = (book: LedgerBook | null | undefined, ym: string): LedgerReflected => {
  const items = book && Array.isArray(book.items) ? book.items : [];
  const ix = txIndexOf(book);
  const base = expectedGrandTotal(book, ym);
  const out: LedgerReflected = {
    ...base,
    unresolvedIds: base.unresolvedIds.slice(),
    uncategorized: 0, uncategorizedCount: 0,
    byPay: expectedByPay(items, ym, ix),
    byGroup: {},
    incomeValue: expectedIncomeTotal(items, ym, ix).value,
  };
  for (const g of LEDGER_EXPENSE_GROUPS) {
    out.byGroup[g] = expectedTotal(items.filter((it) => it && it.group === g), ym, ix);
  }
  // 미분류 — 항목이 없어 위 순회로는 잡히지 않지만 실제로 나간 돈이다(`monthTotals`와 같은 규약:
  // 그룹은 variable, 결제수단은 거래의 pay).
  const un = isValidYm(ym) ? ix.uncategorizedYm.get(ym) : undefined;
  if (un && Number.isFinite(un.sum) && un.count > 0) {
    out.value += un.sum; out.fromActual += un.sum;
    out.uncategorized = un.sum; out.uncategorizedCount = un.count;
    if (!out.byGroup.variable) out.byGroup.variable = emptyExpected();
    out.byGroup.variable.value += un.sum; out.byGroup.variable.fromActual += un.sum;
    for (const [pay, v] of Object.entries(un.byPay || {})) {
      if (!Number.isFinite(v)) continue;
      if (!out.byPay[pay]) out.byPay[pay] = emptyExpected();
      out.byPay[pay].value += v; out.byPay[pay].fromActual += v;
    }
  }
  return out;
};

/**
 * 확인 현황 — 월 헤더 `확인 N/M`·배너·요약 줄·달력·'계획대로 확인' 버튼이 **공유**한다.
 * (각자 `monthTotals`를 다시 부르지 않게 `totals`를 넘길 수 있다 — `yearSeries` 행이 이미 갖고 있다.)
 *
 * ⚠️ `inProgress` — `ym === todayYm`인 달의 `entry:'tx'` 항목 중 거래 0건(§13.11 R-6).
 *    `expectsActual`이 그 항목을 미확인에서 빼는데 반영값은 계획으로 채우므로, 이 수를
 *    세지 않으면 헤더 `✓`와 반영값이 정면 모순이다. `✓`는 `unconfirmed === 0 && inProgress === 0`일 때만.
 */
export interface LedgerConfirmed {
  /** 실제가 확인된(입력된) 지출 항목 수 */
  confirmed: number;
  /** 실적 입력 대상 항목 수(annual 비납부월 제외, 진행 중 제외) */
  target: number;
  /** 아직 확인되지 않은(=계획으로 반영된) 항목 수 */
  unconfirmed: number;
  missingIds: string[];
  /** 이번 달 거래 입력 항목 중 거래 0건 — 값은 계획으로 채워져 있다 */
  inProgress: number;
}

export const confirmedOf = (
  book: LedgerBook | null | undefined,
  ym: string,
  todayYm?: string,
  totals?: LedgerMonthTotals | null,
): LedgerConfirmed => {
  const tYm = isValidYm(todayYm) ? String(todayYm) : '';
  const t = totals || monthTotals(book, ym, tYm);
  const out: LedgerConfirmed = {
    confirmed: Math.max(0, t.activeExpense - t.missingExpense),
    target: t.activeExpense,
    unconfirmed: t.missingExpense,
    missingIds: t.missingIds.slice(),
    inProgress: 0,
  };
  if (!book || !Array.isArray(book.items) || !tYm || ym !== tYm) return out;
  const ix = txIndexOf(book);
  for (const it of book.items) {
    if (!it || it.group === 'income' || it.entry !== 'tx') continue;
    // '진행 중' = 오늘 달 게이트 **없이는** 입력 대상인데, 게이트 때문에 빠진 항목(거래 0건).
    if (!expectsActual(it, ym, { ix }) || expectsActual(it, ym, { ix, todayYm: tYm })) continue;
    if (actualResolved(it, ym, ix).value !== null) continue;   // 수동 값이 있으면 확인된 것이다
    out.inProgress++;
  }
  return out;
};

/**
 * '이 달 계획대로 확인' — **유일한 쓰기 헬퍼**(재설계 §13.2.4). 대상 항목의 `actual[ym]`에
 * `planOf` 값을 **반올림 없이** 쓴다.
 *
 * 대상 W = `monthTotals(...).missingIds`(지출 전용·`expectsActual` 기준 — 수입은 구조적으로 제외)
 *   중 `planOf !== null`이고 `entry !== 'tx'`인 항목. 거래로 입력하는 항목은 단계 B의 거래 기반
 *   ✔로 넘긴다(여기서 수동 값을 박으면 다음 거래에서 충돌 프롬프트가 뜬다).
 * ⚠️ **무반올림** — `Math.round(planOf)`를 저장하면 MS365 10,583.333…이 10,583으로 박혀 확인
 *    직후 차이가 `▼ 0`, 연간 `▼ 4`가 된다(§13.11 R-1). `NumCell`은 표시만 반올림한다.
 * ⚠️ 바뀐 게 없으면 **같은 book 참조**(dirty 없음). `ym > todayYm`이면 no-op.
 * ⚠️ 명시적 0·거래가 있는 (항목, 월)은 `missingIds`에 없으므로 건드리지 않는다.
 */
export interface LedgerApplyPlanResult {
  book: LedgerBook;
  written: number;
  skippedTx: number;
  skippedUnresolved: number;
}

export const applyPlanAsActual = (
  book: LedgerBook | null | undefined,
  ym: string,
  todayYm?: string,
): LedgerApplyPlanResult => {
  const none = { book: book as LedgerBook, written: 0, skippedTx: 0, skippedUnresolved: 0 };
  if (!book || !Array.isArray(book.items) || !isValidYm(ym)) return none;
  const tYm = isValidYm(todayYm) ? String(todayYm) : '';
  if (tYm && ym > tYm) return none;
  const t = monthTotals(book, ym, tYm);
  if (t.missingIds.length === 0) return none;
  const targets = new Set(t.missingIds);
  let written = 0, skippedTx = 0, skippedUnresolved = 0;
  let changed = false;
  const items = book.items.map((it) => {
    if (!it || !targets.has(String(it.id || ''))) return it;
    if (it.entry === 'tx') { skippedTx++; return it; }
    const p = planOf(it, ym);
    if (p === null || !Number.isFinite(p)) { skippedUnresolved++; return it; }
    written++;
    changed = true;
    return { ...it, actual: { ...(it.actual || {}), [ym]: p } };
  });
  if (!changed) return { ...none, skippedTx, skippedUnresolved };
  return { book: { ...book, items }, written, skippedTx, skippedUnresolved };
};

/**
 * 그 달의 입력 상태 — **네 상태**다.
 *
 * ⚠️ `missing < active` 같은 2분법으로 되돌리지 말 것. 연중에 가계부를 시작하면
 *    시작 전 달은 활성 항목이 0건이라 `0 < 0 === false`가 되어 화면이 **"미입력 N개월"**
 *    이라 단언하는데, 실제로는 '그 달엔 항목이 존재하지 않았다'이고 매트릭스에서 그 칸은
 *    `-`로 잠겨 있어 사용자가 채울 방법이 없다 → 경고가 영원히 꺼지지 않는다.
 *    가계부를 연중에 시작하는 것은 이 기능의 **기본 사용 경로**다.
 */
export type LedgerMonthState = 'none' | 'empty' | 'partial' | 'full';
export const monthState = (e: LedgerExpected | null | undefined): LedgerMonthState => {
  if (!e || e.activeCount === 0) return 'none';
  if (e.actualCount === 0) return 'empty';
  return e.actualCount === e.activeCount ? 'full' : 'partial';
};

export interface LedgerKpi {
  /**
   * 사진의 '월 지출 합계' — **매월 반복되는 지출만**(대출 + 고정비 + 변동비).
   * ⚠️ `annual`을 여기 더하지 말 것: 아래 `projectedAnnual`이 `× 12 + annualLumpSum`이라
   *    더하는 순간 연 1회 목돈이 12배로 계상된다.
   */
  recurringMonthly: number;
  /** 사진의 '년단위 합계' */
  annualLumpSum: number;
  /** 사진의 '예상 年 지출합계' */
  projectedAnnual: number;
  /** 사진의 '예상 月 지출합계' */
  projectedMonthly: number;
  loanPrincipal: number;
  loanMonthly: number;
  /** 사진의 '월 납입 이율' — 월 납입액 / 대출 잔액 */
  loanMonthlyRate: number | null;
  /** 사진의 '년 납입 이율' */
  loanAnnualRate: number | null;
  /** 사진의 연 납입액 */
  loanAnnualPayment: number;
  incomeMonthly: number;
  /** 수입 − 예상 月 지출. 수입이 없으면 null. */
  savingCapacity: number | null;
  /**
   * 사진 H9의 27.6% — 연 대출 상환액 / 연 수입.
   * ⚠️ 분모는 **계획(plan) 기반 연 수입**이다. 실적 누계로 재면 연초에 분모가 작아
   *    같은 장부가 1월엔 300%, 12월엔 27%를 오간다.
   */
  dsr: number | null;
  /** 대출 중 계산도 입력도 못 한 항목 수 — 화면이 반드시 노출해야 한다 */
  loanUnresolved: number;
  /** 향후 12개월 중 계상하지 못한 (대출 × 달) 수 — 연 납입액이 과소인 이유 */
  loanAnnualMissing: number;
}

export const ledgerKpi = (book: LedgerBook | null | undefined, ym: string): LedgerKpi => {
  const items = book && Array.isArray(book.items) ? book.items : [];
  const year = Number(ym.slice(0, 4));
  let recurring = 0, annualLump = 0, loanPrincipal = 0, loanMonthly = 0, income = 0, loanUnresolved = 0;
  let loanAnnual = 0, loanAnnualMissing = 0;

  for (const it of items) {
    if (!it) continue;
    // ⚠️ annual은 **보고 있는 달의 활성 게이트보다 앞**에서 처리한다 — 연 1회 목돈은 그 해의
    //    납부월 기준으로 판정해야 하는데, 위에서 ym으로 걸러 버리면 addItem이 박은 activeFrom
    //    보다 앞선 달을 보고 있을 때 연 목돈이 예상 年 지출에서 통째로 사라진다(#68).
    if (it.group === 'annual') {
      const dueA = finiteOr(it.dueMonth);
      const dueYm = dueA === null ? '' : makeYm(year, Math.trunc(dueA));
      if (!dueYm || !isItemActive(it, dueYm)) continue;
      const baseA = finiteOr(it.plan);
      if (baseA !== null) annualLump += baseA;
      continue;
    }
    if (!isItemActive(it, ym)) continue;
    if (it.group === 'income') {
      const p = planOf(it, ym);
      if (p !== null && Number.isFinite(p)) income += p;
      continue;
    }
    if (it.group === 'loan') {
      const P = finiteOr(it.loan?.principal, 0) as number;
      if (Number.isFinite(P)) loanPrincipal += P;
      const r = loanSchedule(it.loan, ym);
      if (r) { loanMonthly += r.payment; recurring += r.payment; }
      else loanUnresolved++;
      // ⚠️ 연 납입액은 `월 × 12`가 아니라 **향후 12개월 스케줄 합**이다 — 원금균등은 매달
      //    줄어들어 ×12가 과대다(화면 각주가 그렇게 못 박고 있다).
      const n12 = loanNext12Total(it.loan, ym);
      loanAnnual += n12.total;
      loanAnnualMissing += n12.missing;
      continue;
    }
    const p = planOf(it, ym);
    if (p !== null && Number.isFinite(p)) recurring += p;
  }

  // ⚠️ 무반올림 누산 — 여기서 Math.round를 끼우면 사진의 62,743,196이 62,743,192가 된다.
  // ⚠️ 대출 몫만 실제 스케줄 합으로 바꿔 넣는다(나머지 반복 지출은 정의상 매달 같다).
  //    만기일시·원리금균등은 loanAnnual === loanMonthly * 12 라 사진 값이 그대로 재현된다.
  const projectedAnnual = (recurring - loanMonthly) * 12 + loanAnnual + annualLump;
  const projectedMonthly = projectedAnnual / 12;
  const loanAnnualPayment = loanAnnual;

  const loanMonthlyRate = loanPrincipal > 0 ? loanMonthly / loanPrincipal : null;
  const annualIncome = income * 12;

  return {
    recurringMonthly: recurring,
    annualLumpSum: annualLump,
    projectedAnnual,
    projectedMonthly,
    loanPrincipal,
    loanMonthly,
    loanMonthlyRate,
    loanAnnualRate: loanMonthlyRate === null ? null : loanMonthlyRate * 12,
    loanAnnualPayment,
    incomeMonthly: income,
    savingCapacity: income > 0 ? income - projectedMonthly : null,
    dsr: annualIncome > 0 ? loanAnnualPayment / annualIncome : null,
    loanUnresolved,
    loanAnnualMissing,
  };
};

/**
 * '예상 月 지출'을 결제수단으로 쪼갠 값. 헤더 KPI의 세분화 표시 전용.
 *
 * ⚠️ **축을 맞추는 것이 이 함수의 존재 이유다.** `monthTotals.byPay`를 그대로 쓰면
 *    부분합 ≠ 총액이 상시 발생한다 — `byPay`는 연단위를 **납부월에 전액** 넣는데
 *    `projectedMonthly`는 연단위를 **12분할**해 매달 넣기 때문이다(실측 픽스처에서
 *    비납부월 473,334 부족 / 납부월 5,680,000 초과). 그래서 여기서도 연단위를 ÷12 한다.
 *
 * ⚠️ **불변식: `Σ projectedByPay === ledgerKpi(book, ym).projectedMonthly`** (무반올림).
 *    검증이 이 항등식을 고정한다. 중간 반올림을 끼우면 깨진다.
 * ⚠️ 계획(plan) 축이다 — 실적이 섞이지 않는다. 화면 라벨에 '계획 기준'을 반드시 명시할 것
 *    (분석 탭 칩은 실적 우선이라 같은 '카드'라는 라벨로 다른 숫자가 나온다).
 */
export const projectedByPay = (
  book: LedgerBook | null | undefined,
  ym: string,
): Record<string, number> => {
  const out: Record<string, number> = {};
  const items = book && Array.isArray(book.items) ? book.items : [];
  if (!isValidYm(ym)) return out;
  const bump = (pay: LedgerPay, v: number) => {
    if (!Number.isFinite(v)) return;
    out[pay] = (out[pay] || 0) + v;
  };
  for (const it of items) {
    if (!it || it.group === 'income' || !isItemActive(it, ym)) continue;
    if (it.group === 'annual') {
      const base = finiteOr(it.plan);
      if (base !== null) bump(it.pay, base / 12);   // ⚠️ 무반올림
      continue;
    }
    const p = planOf(it, ym);
    if (p !== null) bump(it.pay, p);
  }
  return out;
};

/* ===========================================================================
 * H. 비교 (전월 대비 / 전년 동월 대비)
 * =========================================================================== */

export interface LedgerDelta {
  prev: number;
  cur: number;
  delta: number | null;
  rate: number | null;
  /** 비교가 성립하는가. false면 delta/rate가 null이다. */
  comparable: boolean;
  /**
   * `no-data` = 둘 중 하나라도 항목이 없는 달 / `future` = 미래 달 / `unresolved` = 산출 불가
   * **집합**이 다르다 / `zero-base` = 분모 0(comparable=true, rate=null).
   * (옛 `no-prev`·`missing-mismatch`는 `compareMonths`와 함께 폐기됐다 — §13.6)
   */
  reason: '' | 'no-data' | 'future' | 'unresolved' | 'zero-base';
  prevMissing: number;
  curMissing: number;
}

/**
 * 반영값 비교 결과. `LedgerDelta`의 shape을 유지한다(엑셀 ③의 `cmp.comparable && cmp.rate !== null`
 * 게이트가 그대로 동작한다).
 */
export interface LedgerReflectedDelta extends LedgerDelta {
  /** = confirmedOf(cur).unconfirmed + inProgress — 라벨 '계획 반영 N건 포함'의 N */
  curUnconfirmed: number;
  prevUnconfirmed: number;
  /** 두 달에 **같이** 산출 불가라 비교에서 제외한 항목 수(라벨 '산출 불가 J건 제외') */
  unresolvedExcluded: number;
}

/**
 * 두 달의 **반영값** 비교 — 옛 `compareMonths`(실제 전용)를 대체한다(§13.6).
 *
 * comparable=false 사유 순서(⚠️ 바꾸지 말 것):
 *   ① `no-data` — **양쪽** 중 하나라도 항목이 없는 달. prev만 보면 cur가 빈 달일 때 −100%가
 *      확정 표기된다(§13.11 R-8·R-9).
 *   ② `future` — `todayYm`이 유효하고 `curYm > todayYm`. 미래 달은 '예상'이라 비교하지 않는다(D7).
 *      ⚠️ `todayYm`이 유효하지 않으면 이 게이트를 **끈다** — 별도 창의 첫 렌더는 `today`가
 *         비어 있다. 잠깐 전부 '반영'으로 보이는 편이 전부 `-`인 것보다 낫고 `ledger:live`가
 *         곧 채운다. 그래서 화면의 모든 `reflected*` memo는 deps에 `todayYm`을 반드시 넣는다.
 *   ③ `unresolved` — 산출 불가 **집합이 다를 때만**. 같으면 그 항목들은 양쪽 값에서 이미
 *      빠져 있으므로 그대로 비교하고 `unresolvedExcluded`에 센다(완납 후 잔액 0인 대출이
 *      `activeTo` 없이 남은 것은 흔한 상태 — '하나라도 있으면 -'면 전 구간이 `-`가 된다, R-7).
 *   ④ `zero-base` — `prev.value ≤ 0`: comparable=true, delta 유효, rate=null(엑셀 #89 계약).
 */
export const reflectedCompare = (
  book: LedgerBook | null | undefined,
  curYm: string,
  prevYm: string,
  todayYm?: string,
): LedgerReflectedDelta => {
  const cur = reflectedMonth(book, curYm);
  const prev = reflectedMonth(book, prevYm);
  const cc = confirmedOf(book, curYm, todayYm);
  const pc = confirmedOf(book, prevYm, todayYm);
  const base: LedgerReflectedDelta = {
    prev: prev.value, cur: cur.value,
    delta: null, rate: null, comparable: false, reason: '',
    prevMissing: pc.unconfirmed, curMissing: cc.unconfirmed,
    curUnconfirmed: cc.unconfirmed + cc.inProgress,
    prevUnconfirmed: pc.unconfirmed + pc.inProgress,
    unresolvedExcluded: 0,
  };
  const hasData = (r: LedgerReflected) => r.activeCount > 0 || r.uncategorizedCount > 0;
  if (!isValidYm(curYm) || !isValidYm(prevYm) || !hasData(cur) || !hasData(prev)) return { ...base, reason: 'no-data' };
  if (isValidYm(todayYm) && curYm > String(todayYm)) return { ...base, reason: 'future' };
  if (cur.unresolvedIds.join('|') !== prev.unresolvedIds.join('|')) return { ...base, reason: 'unresolved' };
  const excluded = cur.unresolvedIds.length;
  const delta = cur.value - prev.value;
  if (!(prev.value > 0)) {
    return { ...base, delta, comparable: true, reason: 'zero-base', unresolvedExcluded: excluded };
  }
  return { ...base, delta, rate: delta / prev.value, comparable: true, unresolvedExcluded: excluded };
};

export interface LedgerMtd {
  /** 이달 1일~오늘 지출 합 */
  cur: number;
  /** 전달 1일~같은 일수 지출 합 */
  prev: number;
  /** 이달에서 비교에 쓴 일수(1일~오늘) */
  days: number;
  /**
   * 전달에서 비교에 쓴 일수. 전달이 짧으면(3/31 → 2월) **말일로 캡**돼 `days`보다 작다.
   * ⚠️ 화면이 이 값을 노출해야 한다 — 두 창의 길이가 다르면 "같은 기간 대비"가 거짓이 된다.
   */
  prevDays: number;
  delta: number | null;
  rate: number | null;
  comparable: boolean;
  reason: '' | 'no-tx' | 'no-prev' | 'zero-base' | 'not-current';
}

/**
 * **진행 중인 달의 같은 기간 비교**(month-to-date).
 *
 * `compareMonths`는 닫힌 달끼리만 확정한다(입력 완료도가 다르면 `-`) — 그래서 이번 달은
 * 구조적으로 항상 '비교 불가'다. 거래 레이어가 생기면서 **날짜 단위 비교**가 가능해졌으므로,
 * "이달 1~5일 vs 전달 1~5일"이라는 **같은 길이의 창**으로만 비교한다.
 *
 * ⚠️ 전달 일수가 부족하면(3/31 → 2월) **말일로 캡**한다 — 없는 날짜를 0으로 채우면
 *    2월이 항상 '덜 썼다'로 나온다.
 * ⚠️ 거래가 한 건도 없으면 숫자를 내지 않는다(`no-tx`). 수동 월 합계는 날짜가 없어
 *    같은 기간으로 자를 수 없다 — 0으로 섞으면 "이달 지출 0원"이라는 거짓 확정이 된다.
 */
export const mtdCompare = (
  book: LedgerBook | null | undefined,
  ym: string,
  todayDate: string,
  ix?: LedgerTxIndex | null,
): LedgerMtd => {
  const base: LedgerMtd = { cur: 0, prev: 0, days: 0, prevDays: 0, delta: null, rate: null, comparable: false, reason: '' };
  if (!isValidYm(ym) || !isValidLedgerDate(todayDate)) return { ...base, reason: 'no-tx' };
  if (ymOfDate(todayDate) !== ym) return { ...base, reason: 'not-current' };
  const index = ix || txIndexOf(book);
  if (index.liveCount === 0) return { ...base, reason: 'no-tx' };

  const day = Number(todayDate.slice(8, 10));
  const prevYm = addMonthsYm(ym, -1);
  if (!prevYm) return { ...base, days: day, reason: 'no-prev' };
  const prevDim = daysInMonth(Number(prevYm.slice(0, 4)), Number(prevYm.slice(5, 7)));
  const prevLastDay = Math.min(day, prevDim || day);

  const sumRange = (m: string, lastDay: number): { sum: number; count: number } => {
    let sum = 0, count = 0;
    for (let d = 1; d <= lastDay; d++) {
      const key = `${m}-${String(d).padStart(2, '0')}`;
      const hit = index.byDate.get(key);
      if (!hit) continue;
      sum += hit.expense;
      count += hit.count;
    }
    return { sum, count };
  };

  const cur = sumRange(ym, day);
  const prev = sumRange(prevYm, prevLastDay);
  const out: LedgerMtd = { ...base, cur: cur.sum, prev: prev.sum, days: day, prevDays: prevLastDay };
  if (prev.count === 0) return { ...out, reason: 'no-prev' };
  const delta = cur.sum - prev.sum;
  if (!(prev.sum > 0)) return { ...out, delta, comparable: true, reason: 'zero-base' };
  return { ...out, delta, rate: delta / prev.sum, comparable: true };
};

export const reflectedMomDelta = (book: LedgerBook | null | undefined, ym: string, todayYm?: string): LedgerReflectedDelta =>
  reflectedCompare(book, ym, addMonthsYm(ym, -1), todayYm);

export const reflectedYoyDelta = (book: LedgerBook | null | undefined, ym: string, todayYm?: string): LedgerReflectedDelta =>
  reflectedCompare(book, ym, addMonthsYm(ym, -12), todayYm);

/* ===========================================================================
 * H-2. 항목 순서 / 구분 목록
 * =========================================================================== */

/**
 * 같은 **버킷** 안에서 항목을 한 칸 이동. `dir = -1`(위) | `+1`(아래). 버킷은 `keyOf`가 정한다.
 *
 * ⚠️ `items`는 버킷이 **섞인 평면 배열**이다. 인접 인덱스와 그냥 교환하면 다른 버킷
 *    항목과 자리를 바꿔 **화면에서는 아무 일도 일어나지 않는다**(화면은 버킷별로 묶는다).
 *    반드시 '같은 키를 가진 가장 가까운 앞/뒤 항목'과 교환해야 한다. 화면이 항목을
 *    결제수단 아래로 묶으면서(§13.2.2) 버킷이 `group`에서 `group|pay`로 바뀌었다 — 그룹만
 *    보면 정확히 `verify:ledger #72`가 막은 실패 모드가 한 단계 아래에서 재현된다.
 * ⚠️ 이동할 수 없으면(경계·미발견) **원본 참조를 그대로 반환**한다 — 새 배열을 만들면
 *    dirty가 서서 2.5초 뒤 Drive 저장이 헛돈다.
 * ⚠️ 순서는 배열 자체를 재정렬해 표현한다(`order` 필드 신설 금지) — `ledgerFingerprint`가
 *    항목을 배열 순서 그대로 투영하므로 **영속화 신규 지점이 0곳**이 된다.
 */
export const moveItemInBucket = (
  items: LedgerItem[] | null | undefined,
  itemId: string,
  dir: -1 | 1,
  keyOf: (it: LedgerItem) => string,
): LedgerItem[] => {
  const src = Array.isArray(items) ? items : [];
  if (!itemId || (dir !== -1 && dir !== 1) || typeof keyOf !== 'function') return src as LedgerItem[];
  const i = src.findIndex((it) => it && it.id === itemId);
  if (i < 0) return src as LedgerItem[];
  const key = keyOf(src[i]);
  let j = -1;
  for (let k = i + dir; k >= 0 && k < src.length; k += dir) {
    if (src[k] && keyOf(src[k]) === key) { j = k; break; }
  }
  if (j < 0) return src as LedgerItem[];
  const out = src.slice();
  out[i] = src[j];
  out[j] = src[i];
  return out;
};

/** 버킷 안에서 위/아래로 더 갈 수 있는가 — 버튼 비활성 판정용. */
export const canMoveItemInBucket = (
  items: LedgerItem[] | null | undefined,
  itemId: string,
  dir: -1 | 1,
  keyOf: (it: LedgerItem) => string,
): boolean => moveItemInBucket(items, itemId, dir, keyOf) !== items;

/** 레거시 — 그룹 버킷. `moveItemInBucket`에 위임한다(#72~#73c 불변). */
export const moveItemInGroup = (
  items: LedgerItem[] | null | undefined,
  itemId: string,
  dir: -1 | 1,
): LedgerItem[] => moveItemInBucket(items, itemId, dir, (it) => it.group);

/** 그룹 안에서 위/아래로 더 갈 수 있는가 — 버튼 비활성 판정용. */
export const canMoveItemInGroup = (
  items: LedgerItem[] | null | undefined,
  itemId: string,
  dir: -1 | 1,
): boolean => moveItemInGroup(items, itemId, dir) !== items;

/**
 * 구분 선택 목록 = **레지스트리 ∪ 실제 쓰이는 값**.
 *
 * ⚠️ 실제 쓰이는 값은 `it.category`를 **가공하지 않고 그대로** 넣는다. trim해서 넣으면
 *    Drive/백업/브릿지로 들어온 `' 구독 '`이 옵션 `'구독'`과 일치하지 않아 `<select>`가
 *    선택 없는 상태가 되고, 브라우저가 첫 옵션을 표시해 그 행이 **미분류로 보인다**.
 *    거기서 한 번만 건드리면 원래 값이 영구히 덮인다(undo 없음).
 * ⚠️ 순서: 레지스트리 등록 순 → 그 뒤에 미등록 사용값(발견 순). 정렬하지 않는다 —
 *    사용자가 등록한 순서가 곧 우선순위다.
 */
export const ledgerCategories = (book: LedgerBook | null | undefined): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v !== 'string' || v === '') return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const c of (book && Array.isArray(book.categories) ? book.categories : [])) push(c);
  for (const it of (book && Array.isArray(book.items) ? book.items : [])) push(it && it.category);
  return out;
};

/* ===========================================================================
 * I. 메모 달력 이벤트 (라이브 파생 — calendarMemos에 복사 금지)
 * =========================================================================== */

/** 달력 패드에 그리는 거래 1건(읽기 전용 표시용 투영). */
export interface LedgerCalendarTx {
  name: string;
  /** 저장값 그대로 — **항상 양수**. 부호는 `refund`가 가진다. */
  amount: number;
  kind: 'expense' | 'income';
  pay: LedgerPay;
  refund: boolean;
  memo: string;
  /** 할부 개월(≥2)일 때만. */
  installmentMonths: number | null;
  /** 그 달 회차 금액(할부일 때만) — 달력은 전액, 월 표는 회차라는 차이를 패드가 설명한다. */
  installmentThisMonth: number | null;
}

export interface LedgerCalendarEvent {
  bookId: string;
  bookName: string;
  /**
   * 'tx' = 그 날 실제로 쓴 돈(거래 합) / 'touch' = 그 날 가계부를 정리했다 /
   * 'annual' = 연단위 지출 예정일
   * ⚠️ 칩 문구 우선순위는 **tx → 연단위 → 정리**다 — "그날 얼마 썼나"가 달력의 1순위 질문이고,
   *    '정리했다'는 그 다음이다(정리 기록은 금액이 그 달 전체라 날짜 칸의 뜻과 다르다).
   */
  kind: 'tx' | 'touch' | 'annual';
  ym: string;
  /** kind==='tx' — 그 날 거래 합. 이체는 제외, 환급은 음수. */
  txExpense?: number;
  txIncome?: number;
  txCount?: number;
  /**
   * 그 날 거래 목록(패드에 읽기 전용으로 렌더). 최대 `LEDGER_CAL_TX_CAP`건.
   * ⚠️ `amount`는 **저장값 그대로 항상 양수**다(부호는 `refund`가 가진다) — 미리 곱하면
   *    "금액은 양수 + 환급 플래그" 계약이 이벤트 경계에서 깨져 이중 부호 실수가 재발한다.
   * ⚠️ `kind`를 빼지 말 것 — `txCount`는 수입 거래도 세므로, 없으면 급여가 지출 행으로 렌더된다.
   */
  txs?: LedgerCalendarTx[];
  /** kind==='touch' — ⚠️ 칩·패드가 그리는 총지출은 `reflectedExpense`(반영값)다(§13). */
  actualExpense?: number;
  /** 반영값(실제 ?? 계획 + 미분류). */
  reflectedExpense?: number;
  /** 전월 대비 — 반영값 기준(`reflectedMomDelta`). 미래 달·산출 불가 집합이 다른 달은 비교 불가. */
  momDelta?: number | null;
  momRate?: number | null;
  momComparable?: boolean;
  momReason?: LedgerDelta['reason'];
  /** 비교에 계획으로 반영된 항목 수(라벨 '계획 반영 N건 포함') */
  momPlanned?: number;
  /** 아직 확인하지 않은(=계획으로 반영된) 항목 수. `missing`은 같은 값의 레거시 이름이다. */
  unconfirmed?: number;
  inProgress?: number;
  missing?: number;
  /** kind==='annual' */
  itemId?: string;
  itemName?: string;
  amount?: number | null;
  pay?: LedgerPay;
}

/**
 * 그 해의 날짜별 가계부 이벤트.
 * ⚠️ `books`가 시세 갱신마다 바뀌지 않는 앱 레벨 데이터라도, 호출부는 반드시 달력이
 *    열려 있을 때만 계산할 것(CalendarModal의 `open` 게이트 규약).
 * @param todayYm 오늘이 속한 달. 넘기면 **미래 달**의 정리 기록은 전월 대비를 내지 않는다
 *   (§13.11 R-5 — 달력에서만 미래 달 비교가 살아남지 않게). 없으면 종전(미래 게이트 없음).
 */
export const ledgerEventsByDate = (
  books: LedgerBooks | null | undefined,
  year: number,
  todayYm?: string,
): Record<string, LedgerCalendarEvent[]> => {
  const out: Record<string, LedgerCalendarEvent[]> = {};
  if (!Array.isArray(books) || !Number.isFinite(year)) return out;
  const tYm = isValidYm(todayYm) ? String(todayYm) : '';
  const push = (d: string, e: LedgerCalendarEvent) => {
    if (!isValidLedgerDate(d)) return;
    (out[d] || (out[d] = [])).push(e);
  };

  for (const b of books) {
    if (!b || !Array.isArray(b.items)) continue;
    const bookName = String(b.name || '가계부');

    /**
     * (a-0) 그 날 거래 합 — ⚠️ **라이브 파생**이다. `calendarMemos`에 복사하지 말 것
     *       (복사하면 가계부와 달력이 갈라져 같은 날짜에 두 값이 보인다).
     */
    const ixb = txIndexOf(b);
    /**
     * 날짜별 거래 목록 — **1회 순회**로 만든다. 날짜마다 `filterTx`를 부르면
     * O(날짜 x 거래)라 6,000건 상한에서 달력 한 달 렌더가 폭발한다.
     * ⚠️ 술어는 `byDate`와 **문자 그대로 같아야** 한다(살아 있음 + 이체 제외 + 그 해) —
     *    다르면 칩의 'N건'과 패드 목록 줄 수가 어긋나고, 이체가 새면 카드대금 결제가
     *    "이 날 이만큼 썼다"로 읽힌다.
     */
    const byId = new Map<string, LedgerItem>();
    for (const it of b.items) if (it && it.id) byId.set(it.id, it);
    const txsByDate = new Map<string, LedgerCalendarTx[]>();
    for (const tx of (Array.isArray(b.transactions) ? b.transactions : [])) {
      if (!isLiveTx(tx) || tx.kind === 'transfer') continue;
      if (Number(String(tx.date).slice(0, 4)) !== year) continue;
      const arr = txsByDate.get(tx.date) || [];
      if (arr.length >= LEDGER_CAL_TX_CAP) { txsByDate.set(tx.date, arr); continue; }
      const ch = installmentCharges(tx);
      arr.push({
        name: txDisplayName(tx, byId),
        amount: finiteOr(tx.amount, 0) as number,
        kind: tx.kind === 'income' ? 'income' : 'expense',
        pay: tx.pay,
        refund: tx.refund === true,
        memo: String(tx.memo || ''),
        installmentMonths: ch.length > 1 ? ch.length : null,
        installmentThisMonth: ch.length > 1 ? ch[0].amount : null,
      });
      txsByDate.set(tx.date, arr);
    }
    for (const [d, agg] of ixb.byDate) {
      if (!isValidLedgerDate(d) || Number(d.slice(0, 4)) !== year) continue;
      if (!agg || agg.count === 0) continue;
      push(d, {
        bookId: b.id, bookName, kind: 'tx', ym: ymOfDate(d),
        txExpense: agg.expense, txIncome: agg.income, txCount: agg.count,
        txs: txsByDate.get(d) || [],
      });
    }

    // (a) 정리 기록
    const months = b.months && typeof b.months === 'object' ? b.months : {};
    for (const [ym, meta] of Object.entries(months)) {
      if (!isValidYm(ym) || !meta) continue;
      const d = (meta as LedgerMonthMeta).touchedDate;
      if (!isValidLedgerDate(d) || Number(d.slice(0, 4)) !== year) continue;
      // 반영값(실제 ?? 계획 + 미분류) — 칩·패드의 총지출과 전월 대비는 이 값이다(§13).
      // `actualExpense`·`missing`은 레거시 필드로 남긴다(실제 전용 · 확인 현황).
      const t = monthTotals(b, ym, tYm);
      const r = reflectedMonth(b, ym);
      const cf = confirmedOf(b, ym, tYm, t);
      const m = reflectedMomDelta(b, ym, tYm);
      push(d, {
        bookId: b.id, bookName, kind: 'touch', ym,
        actualExpense: t.actualExpense,
        reflectedExpense: r.value,
        momDelta: m.comparable ? m.delta : null,
        momRate: m.comparable ? m.rate : null,
        momComparable: m.comparable,
        momReason: m.reason,
        momPlanned: m.curUnconfirmed,
        unconfirmed: cf.unconfirmed,
        inProgress: cf.inProgress,
        missing: t.missingExpense,
      });
    }

    // (b) 연단위 지출 예정일
    for (const it of b.items) {
      if (!it || it.group !== 'annual') continue;
      const mo = finiteOr(it.dueMonth), dy = finiteOr(it.dueDay);
      if (mo === null || dy === null) continue;
      const ym = makeYm(year, Math.trunc(mo));
      if (!isValidYm(ym) || !isItemActive(it, ym)) continue;
      // ⚠️ 그 달에 없는 날(2월 31일 등)은 버리지 말고 **말일로 클램프**한다 — 사용자가 31을
      //    넣은 의도는 '말일'이고, 버리면 칩이 아무 안내 없이 사라진다.
      const dim = daysInMonth(year, Math.trunc(mo));
      const dayNum = Math.min(Math.max(1, Math.trunc(dy)), dim || 28);
      const d = `${ym}-${String(dayNum).padStart(2, '0')}`;
      if (!isValidLedgerDate(d)) continue;
      push(d, {
        bookId: b.id, bookName, kind: 'annual', ym,
        itemId: it.id, itemName: String(it.name || '(이름 없음)'),
        amount: actualOf(it, ym) ?? finiteOr(it.plan),
        pay: it.pay,
      });
    }
  }
  return out;
};

/* ===========================================================================
 * J. 정규화 / sticky 판정 / 지문 — 영속화 계약
 * =========================================================================== */

const GROUPS: LedgerGroup[] = ['loan', 'fixed', 'variable', 'annual', 'income'];
const PAYS: LedgerPay[] = ['cash', 'card', 'transfer', 'auto', 'other'];
const METHODS: LedgerLoanMethod[] = ['interestOnly', 'amortizing', 'equalPrincipal'];
const TONES = ['none', 'warn', 'good', 'info'];

const str = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v : '';
  return s.length > max ? s.slice(0, max) : s;
};
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const normMoneyMap = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidYm(k)) continue;
    const n = numOrNull(v);
    if (n === null) continue;
    out[k] = n;
  }
  return out;
};

const TX_KINDS: string[] = ['expense', 'income', 'transfer'];
const TX_ORIGINS: string[] = ['manual', 'confirm', 'auto', 'import', 'adjust', 'migrate'];

/** 분할 합과 금액이 같다고 볼 수 있는가 — 부동소수 잔차만 허용한다(원 단위 오차는 불일치다). */
const SPLIT_EPS = 1e-6;

/**
 * 거래 1건 정규화. **무효면 null**(버린다).
 *
 * ⚠️ `amount`는 항상 양수로 만들고 음수 입력은 `refund:true`로 옮긴다 — 부호와 플래그가
 *    둘 다 뜻을 갖게 두면 집계마다 이중 부호 실수가 난다.
 * ⚠️ `Σsplits ≠ amount`면 **splits를 버리고 단일 항목으로 강등**한다. 그대로 두면 항목 합과
 *    거래 합이 조용히 갈려 어떤 검산도 통과하지 못한다(가장 나쁜 실패 모드).
 */
export const normalizeTx = (raw: unknown): LedgerTx | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (!isValidLedgerDate(s.date)) return null;
  const amountRaw = numOrNull(s.amount);
  if (amountRaw === null) return null;
  const amount = Math.abs(amountRaw);
  const refund = s.refund === true || amountRaw < 0;

  const rawSplits = Array.isArray(s.splits) ? s.splits : [];
  let splits: LedgerTxSplit[] = [];
  for (const sp of rawSplits.slice(0, MAX_LEDGER_TX_SPLITS)) {
    if (!sp || typeof sp !== 'object') continue;
    const o = sp as Record<string, unknown>;
    const v = numOrNull(o.amount);
    if (v === null) continue;
    splits.push({
      itemId: typeof o.itemId === 'string' ? o.itemId : '',
      amount: v,
      memo: str(o.memo, MAX_LEDGER_TX_MEMO_LEN),
    });
  }
  if (splits.length > 0) {
    const sum = splits.reduce((a, b) => a + b.amount, 0);
    if (Math.abs(sum - amount) > SPLIT_EPS) splits = [];
  }

  const instRaw = numOrNull(s.installmentMonths);
  const installmentMonths = instRaw !== null && instRaw >= 2
    ? Math.min(Math.trunc(instRaw), MAX_LEDGER_INSTALLMENT_MONTHS)
    : null;

  return {
    id: typeof s.id === 'string' && s.id ? s.id : generateId(),
    date: s.date as string,
    amount,
    refund,
    kind: TX_KINDS.includes(s.kind as string) ? (s.kind as LedgerTxKind) : 'expense',
    itemId: typeof s.itemId === 'string' ? s.itemId : '',
    splits,
    pay: (PAYS as string[]).includes(s.pay as string) ? (s.pay as LedgerPay) : 'card',
    accountId: typeof s.accountId === 'string' ? s.accountId : '',
    toAccountId: typeof s.toAccountId === 'string' ? s.toAccountId : '',
    memo: str(s.memo, MAX_LEDGER_TX_MEMO_LEN),
    payer: str(s.payer, MAX_LEDGER_PAYER_LEN),
    installmentMonths,
    origin: TX_ORIGINS.includes(s.origin as string) ? (s.origin as LedgerTxOrigin) : 'manual',
    originKey: str(s.originKey, MAX_LEDGER_NAME_LEN),
    deletedAt: isValidLedgerDate(s.deletedAt) ? (s.deletedAt as string) : '',
    createdAt: numOrNull(s.createdAt) ?? 0,
  };
};

/** 정규화 결과가 입력과 같은가 — 멱등 판정(`undefined`와 기본값을 같게 본다). */
const sameTx = (next: LedgerTx, src: Record<string, unknown>): boolean => {
  const rawSplits = Array.isArray(src.splits) ? (src.splits as Record<string, unknown>[]) : [];
  if (next.splits.length !== rawSplits.length) return false;
  for (let i = 0; i < next.splits.length; i++) {
    const a = next.splits[i], b = rawSplits[i] || {};
    if (a.itemId !== (b.itemId ?? '') || a.amount !== b.amount || a.memo !== (b.memo ?? '')) return false;
  }
  return next.id === src.id && next.date === src.date && next.amount === src.amount
    && next.refund === (src.refund === true) && next.kind === (src.kind ?? 'expense')
    && next.itemId === (src.itemId ?? '') && next.pay === (src.pay ?? 'card')
    && next.accountId === (src.accountId ?? '') && next.toAccountId === (src.toAccountId ?? '')
    && next.memo === (src.memo ?? '') && next.payer === (src.payer ?? '')
    && next.installmentMonths === (src.installmentMonths ?? null)
    && next.origin === (src.origin ?? 'manual') && next.originKey === (src.originKey ?? '')
    && next.deletedAt === (src.deletedAt ?? '') && next.createdAt === (src.createdAt ?? 0);
};

/** 구분 프리셋 정규화 — trim · 빈값/중복 제거 · 길이/개수 상한. */
const normCategories = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim().slice(0, MAX_LEDGER_CATEGORY_LEN);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_LEDGER_CATEGORIES) break;
  }
  return out;
};

/**
 * ⚠️ **`undefined`와 `[]`를 같게 본다.** 다르게 보면 `categories`가 없던 레거시 장부가
 *    로드마다 '변경됨'으로 판정돼 새 배열이 반환되고, Drive 폴링마다 재저장 + 로컬 사본
 *    시드가 갈아엎어져 2.5초 idle 승격 전 편집이 사라진다(멱등 계약, verify #58).
 */
const sameStrList = (a: string[], b: unknown): boolean => {
  if (!Array.isArray(b)) return a.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const sameMoneyMap = (a: Record<string, number>, b: unknown): boolean => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return Object.keys(a).length === 0;
  const bk = Object.keys(b as Record<string, unknown>);
  const ak = Object.keys(a);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if ((b as Record<string, unknown>)[k] !== a[k]) return false;
  return true;
};

/**
 * 로드 정규화. `applyStateData`·`applyBackupData`·별도 창 수신 3경로가 공유한다.
 *
 * ⚠️ **멱등 계약**: 바꿀 게 없으면 **원본 참조를 그대로 반환**한다. 매번 새 배열을 만들면
 *    ① Drive 폴링마다 재저장이 돌고 ② 컴포넌트의 로컬 사본 시드 effect가 매번 갈아엎어
 *    2.5초 idle 승격 전의 편집이 사라진다.
 */
export const normalizeLedgerBooks = (raw: unknown): LedgerBooks => {
  if (!Array.isArray(raw)) return [];
  let changed = raw.length > MAX_LEDGER_BOOKS;
  const books: LedgerBook[] = [];

  for (const b of raw.slice(0, MAX_LEDGER_BOOKS)) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) { changed = true; continue; }
    const src = b as Record<string, unknown>;
    const rawItems = Array.isArray(src.items) ? src.items : [];
    if (!Array.isArray(src.items) || rawItems.length > MAX_LEDGER_ITEMS) changed = true;

    let itemsChanged = false;
    const items: LedgerItem[] = [];
    for (const it of rawItems.slice(0, MAX_LEDGER_ITEMS)) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) { itemsChanged = true; continue; }
      const s = it as Record<string, unknown>;
      const group = (GROUPS as string[]).includes(s.group as string) ? (s.group as LedgerGroup) : 'fixed';
      const pay = (PAYS as string[]).includes(s.pay as string) ? (s.pay as LedgerPay) : 'card';
      const planUnit: LedgerPlanUnit = s.planUnit === 'year' ? 'year' : 'month';
      const tone = TONES.includes(s.tone as string) ? (s.tone as LedgerItem['tone']) : 'none';
      const planOverride = normMoneyMap(s.planOverride);
      const actual = normMoneyMap(s.actual);

      let loan: LedgerLoan | null = null;
      if (group === 'loan' && s.loan && typeof s.loan === 'object' && !Array.isArray(s.loan)) {
        const l = s.loan as Record<string, unknown>;
        loan = {
          principal: numOrNull(l.principal) ?? 0,
          principalAsOfYm: isValidYm(l.principalAsOfYm) ? (l.principalAsOfYm as string) : '',
          annualRate: numOrNull(l.annualRate) ?? 0,
          method: (METHODS as string[]).includes(l.method as string)
            ? (l.method as LedgerLoanMethod) : 'amortizing',
          endDate: isValidLedgerDate(l.endDate) ? (l.endDate as string) : '',
          termMonths: numOrNull(l.termMonths),
          graceMonths: numOrNull(l.graceMonths),
          paymentOverride: numOrNull(l.paymentOverride),
        };
      }

      const next: LedgerItem = {
        id: typeof s.id === 'string' && s.id ? s.id : generateId(),
        group, pay,
        name: str(s.name, MAX_LEDGER_NAME_LEN),
        category: str(s.category, MAX_LEDGER_NAME_LEN),
        plan: numOrNull(s.plan),
        planUnit,
        planOverride,
        actual,
        memo: str(s.memo, MAX_LEDGER_MEMO_LEN),
        activeFrom: isValidYm(s.activeFrom) ? (s.activeFrom as string) : '',
        activeTo: isValidYm(s.activeTo) ? (s.activeTo as string) : '',
        dueMonth: numOrNull(s.dueMonth),
        dueDay: numOrNull(s.dueDay),
        loan,
        tone,
        entry: s.entry === 'tx' ? 'tx' : 'monthly',
        createdAt: numOrNull(s.createdAt) ?? 0,
      };

      const same =
        next.id === s.id && next.group === s.group && next.pay === s.pay &&
        next.name === s.name && next.category === s.category && next.plan === (s.plan ?? null) &&
        next.planUnit === (s.planUnit ?? 'month') && next.memo === s.memo &&
        next.activeFrom === (s.activeFrom ?? '') && next.activeTo === (s.activeTo ?? '') &&
        next.dueMonth === (s.dueMonth ?? null) && next.dueDay === (s.dueDay ?? null) &&
        next.tone === (s.tone ?? 'none') && next.createdAt === (s.createdAt ?? 0) &&
        // ⚠️ `undefined ≡ 'monthly'` — 다르게 보면 레거시 장부가 로드마다 '변경됨'이 되어
        //    Drive 폴링마다 재저장 + 로컬 사본 갈아엎기가 돈다(멱등 계약).
        next.entry === (s.entry ?? 'monthly') &&
        sameMoneyMap(planOverride, s.planOverride) && sameMoneyMap(actual, s.actual) &&
        ((loan === null && !s.loan) || (loan !== null && !!s.loan));
      if (!same) itemsChanged = true;
      items.push(next);
    }

    const rawMonths = src.months && typeof src.months === 'object' && !Array.isArray(src.months)
      ? (src.months as Record<string, unknown>) : {};
    const months: Record<string, LedgerMonthMeta> = {};
    let monthsChanged = Object.keys(rawMonths).length > MAX_LEDGER_MONTHS;
    for (const [ym, meta] of Object.entries(rawMonths).slice(0, MAX_LEDGER_MONTHS)) {
      if (!isValidYm(ym) || !meta || typeof meta !== 'object') { monthsChanged = true; continue; }
      const m = meta as Record<string, unknown>;
      const td = isValidLedgerDate(m.touchedDate) ? (m.touchedDate as string) : '';
      const mm = str(m.memo, MAX_LEDGER_MEMO_LEN);
      if (td !== m.touchedDate || mm !== (m.memo ?? '')) monthsChanged = true;
      months[ym] = { touchedDate: td, memo: mm };
    }

    const categories = normCategories(src.categories);

    /**
     * 거래 정규화.
     * ⚠️ 상한 초과분은 **오래된 것부터** 버린다(date desc 정렬 후 앞에서 자른다) — 방금 넣은
     *    최근 기록이 밀려나면 사용자가 그 사실을 알 방법이 없다.
     * ⚠️ 정규화는 **휴지통을 비우지 않는다** — 시간(오늘)에 따라 결과가 달라지면 멱등이 깨지고,
     *    Drive 폴링마다 다른 결과가 나온다. 비우기는 사용자 동작이다(`purgeTx`).
     */
    const rawTx = Array.isArray(src.transactions) ? src.transactions : [];
    let txChanged = !Array.isArray(src.transactions)
      ? rawTx.length > 0
      : rawTx.length > MAX_LEDGER_TX;
    const txs: LedgerTx[] = [];
    for (const t of rawTx) {
      const nt0 = normalizeTx(t);
      if (!nt0) { txChanged = true; continue; }
      /**
       * ⚠️ 축 정합을 **`sameTx`보다 먼저** 돌린다. `sameTx`는 정규화 결과를 **원본**과 비교하므로,
       *    먼저 정정하면 어긋난 레거시 행이 `txChanged`를 딱 한 번 세우고 그 뒤로는 저장값이
       *    이미 정합이라 같은 참조가 유지된다(멱등 계약). 순서를 뒤집으면 `txChanged`가 영영
       *    서지 않아 정정이 저장되지 않고, 매 로드마다 같은 계산만 반복한다.
       */
      const nt = resolveTxAxis(nt0, items);
      if (nt !== nt0 || !sameTx(nt, t as Record<string, unknown>)) txChanged = true;
      txs.push(nt);
    }
    const sorted = sortTxDesc(txs);
    for (let i = 0; i < txs.length; i++) if (txs[i] !== sorted[i]) { txChanged = true; break; }
    const transactions = sorted.slice(0, MAX_LEDGER_TX);

    const book: LedgerBook = {
      id: typeof src.id === 'string' && src.id ? src.id : generateId(),
      name: str(src.name, MAX_LEDGER_NAME_LEN),
      items,
      categories,
      months,
      transactions,
      createdAt: numOrNull(src.createdAt) ?? 0,
      updatedAt: numOrNull(src.updatedAt) ?? 0,
    };
    if (itemsChanged || monthsChanged || txChanged || book.id !== src.id || book.name !== src.name
      || !sameStrList(categories, src.categories)) changed = true;
    books.push(book);
  }

  return changed ? books : (raw as LedgerBooks);
};

/**
 * sticky 복원 판정의 **단일 소스**.
 * App.tsx(`applyBackupData`)와 useDriveSync.ts(`_preserveStickyPersonalData`)가
 * 반드시 이 함수를 공유해야 두 경로가 갈리지 않는다.
 *
 * ⚠️ `length > 0`으로 재지 말 것 — 가계부 화면을 **열기만 해도** 빈 장부가 1권 생기므로
 *    length 기준이면 `keep`이 항상 true가 되어 **백업으로 되살릴 길이 영구히 막힌다**
 *    (flowMaps·backtestScenarios가 같은 이유로 값 기반 판정을 쓴다).
 */
export const ledgerBooksHaveContent = (books: unknown): boolean => {
  if (!Array.isArray(books)) return false;
  return books.some((b: any) => {
    if (!b || typeof b !== 'object') return false;
    // ⚠️ 거래가 한 건이라도 있으면 '내용 있음' — 항목을 다 지우고 거래만 남긴 장부가
    //    백업 복원에서 조용히 사라지면 복구할 방법이 없다(sticky 판정의 단일 소스).
    if (Array.isArray(b.transactions) && b.transactions.some((t: any) => t && typeof t === 'object')) return true;
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.some((it: any) => it && (
      String(it.name ?? '').trim() !== '' ||
      numOrNull(it.plan) !== null ||
      Object.keys(it.actual || {}).length > 0 ||
      Object.keys(it.planOverride || {}).length > 0 ||
      (it.loan && numOrNull(it.loan.principal) !== null && it.loan.principal !== 0)
    ))) return true;
    // 구분 프리셋만 등록해 둔 장부도 '내용 있음' — 사용자가 직접 친 값이라 복원이 되돌리면 안 된다.
    if (Array.isArray(b.categories) && b.categories.some((c: any) => typeof c === 'string' && c.trim() !== '')) return true;
    const months = b.months && typeof b.months === 'object' ? b.months : {};
    return Object.values(months).some((m: any) =>
      m && (String(m.touchedDate ?? '').trim() !== '' || String(m.memo ?? '').trim() !== ''));
  });
};

/**
 * Drive 저장 트리거용 지문.
 *
 * ⚠️ **절대 던지지 않는다** — 이 계산은 App.tsx 저장 effect의 첫 블록이라, 던지면 그 아래의
 *    `saveStateRef.current = state`와 저장 예약이 함께 죽어 그 세션의 Drive 저장이 통째로 멈춘다.
 *    화이트리스트 투영 + try/catch가 규약이다(raw `JSON.stringify` 금지 — 순환 참조에서 던진다).
 * ⚠️ **길이·개수 해시로 줄이지 말 것** — `investmentNotesKey`가 `id:date`만 담아 '본문만 고치면
 *    저장 안 됨' 버그를, `holdingSnapshotsKey`가 `date:kind:개수`만 담아 '같은 날짜 수량만
 *    재편집하면 저장 안 됨' 버그를 냈다.
 * ⚠️ `updatedAt`은 **제외** — 커밋 시각 변화만으로 지문이 흔들려 무의미한 저장 churn이 난다.
 */
/**
 * ⚠️ **참조 캐시**. 이 지문은 App.tsx 저장 effect의 첫 블록에서 매 렌더 계산되는데, 거래가
 *    6,000건이면 `JSON.stringify`가 매번 수 ms다. 장부 배열은 편집마다 새로 만들어지므로
 *    (불변 갱신) 참조가 곧 정확한 무효화 신호다 — 같은 참조면 재계산하지 않는다.
 * ⚠️ 제자리 변형(mutation)을 하면 캐시가 낡는다. 이 저장소의 모든 쓰기 헬퍼가 새 배열·새
 *    객체를 만드는 이유이기도 하다(순수성이 캐시의 전제).
 */
const ledgerFpCache = new WeakMap<object, string>();

export const ledgerFingerprint = (books: unknown): string => {
  if (books && typeof books === 'object') {
    const hit = ledgerFpCache.get(books as object);
    if (hit !== undefined) return hit;
  }
  const out = computeLedgerFingerprint(books);
  if (books && typeof books === 'object') ledgerFpCache.set(books as object, out);
  return out;
};

const computeLedgerFingerprint = (books: unknown): string => {
  try {
    if (!Array.isArray(books)) return '';
    return JSON.stringify(books.map((b: any) => ({
      i: b?.id ?? '', n: b?.name ?? '',
      // ⚠️ 구분 프리셋도 지문에 든다 — 빠뜨리면 '구분만 추가한 세션'이 portfolioUpdatedAt을
      //    올리지 못해 Drive STATE 저장이 통째로 스킵된다(이 저장소에서 6회 재발한 버그 클래스).
      c: Array.isArray(b?.categories) ? b.categories.slice() : [],
      m: Object.entries(b?.months || {})
        .map(([k, v]: [string, any]) => [k, v?.touchedDate ?? '', v?.memo ?? ''])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      // ⚠️ 거래는 **전 필드**를 담는다(`createdAt` 포함 — 같은 날 같은 금액을 두 번 넣은 것을
      //    구분해야 한다). 길이·개수 해시로 줄이지 말 것: 그 절충이 '메모만 고치면 저장 안 됨'
      //    버그를 두 번 냈다(investmentNotesKey·holdingSnapshotsKey).
      x: (Array.isArray(b?.transactions) ? b.transactions : []).map((t: any) => [
        t?.id ?? '', t?.date ?? '', t?.amount ?? null, t?.refund === true, t?.kind ?? '',
        t?.itemId ?? '', t?.pay ?? '', t?.accountId ?? '', t?.toAccountId ?? '',
        t?.memo ?? '', t?.payer ?? '', t?.installmentMonths ?? null,
        t?.origin ?? '', t?.originKey ?? '', t?.deletedAt ?? '', t?.createdAt ?? 0,
        (Array.isArray(t?.splits) ? t.splits : []).map((s: any) => [s?.itemId ?? '', s?.amount ?? null, s?.memo ?? '']),
      ]),
      t: (Array.isArray(b?.items) ? b.items : []).map((it: any) => [
        it?.id ?? '', it?.group ?? '', it?.pay ?? '', it?.name ?? '', it?.category ?? '',
        it?.plan ?? null, it?.planUnit ?? '', it?.memo ?? '',
        it?.activeFrom ?? '', it?.activeTo ?? '', it?.dueMonth ?? null, it?.dueDay ?? null,
        it?.tone ?? '', it?.entry ?? '',
        Object.entries(it?.planOverride || {}).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        Object.entries(it?.actual || {}).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        it?.loan ? [
          it.loan.principal ?? null, it.loan.principalAsOfYm ?? '', it.loan.annualRate ?? null,
          it.loan.method ?? '', it.loan.endDate ?? '', it.loan.termMonths ?? null,
          it.loan.graceMonths ?? null, it.loan.paymentOverride ?? null,
        ] : null,
      ]),
    })));
  } catch { return 'ERR'; }
};

/* ===========================================================================
 * K. 생성 헬퍼
 * =========================================================================== */

export const makeLedgerItem = (over: Partial<LedgerItem> = {}): LedgerItem => ({
  id: generateId(),
  group: 'fixed',
  pay: 'card',
  name: '',
  category: '',
  plan: null,
  planUnit: 'month',
  planOverride: {},
  actual: {},
  memo: '',
  activeFrom: '',
  activeTo: '',
  dueMonth: null,
  dueDay: null,
  loan: null,
  tone: 'none',
  entry: 'monthly',
  createdAt: 0,
  ...over,
});

export const makeLedgerLoan = (over: Partial<LedgerLoan> = {}): LedgerLoan => ({
  principal: 0,
  principalAsOfYm: '',
  annualRate: 0,
  method: 'amortizing',
  endDate: '',
  termMonths: null,
  graceMonths: null,
  paymentOverride: null,
  ...over,
});

export const makeLedgerBook = (over: Partial<LedgerBook> = {}): LedgerBook => ({
  id: generateId(),
  name: '가계부',
  items: [],
  // ⚠️ 반드시 빈 배열 — 기본값이 비어 있지 않으면 `ledgerBooksHaveContent`가
  //    빈 장부를 '내용 있음'으로 보고 백업 복원 경로가 영구히 막힌다(verify #60).
  categories: [],
  months: {},
  // ⚠️ 반드시 빈 배열 — 비어 있지 않으면 `ledgerBooksHaveContent`가 빈 장부를 '내용 있음'으로
  //    보고 백업 복원 경로가 영구히 막힌다(categories와 같은 근거).
  transactions: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/* ===========================================================================
 * L. 스냅샷 — 사용자 저장 + 이전 기록 복원
 *
 * ⚠️ **스냅샷은 `ledgerBooks` 안이 아니라 그 옆(앱 레벨 `ledgerSnapshots`)에 산다.**
 *    장부 안에 두면 장부가 통째로 덮이는 사고에서 안전망도 같이 죽는다 —
 *    그 사고(2026-08-29 실측 유실)가 정확히 이 기능이 막으려는 것이다.
 *
 * ⚠️ 자동 백업(`portfolio_backup_*.json`)과 **별개**다. 그쪽은 `versioned` 인자가 있을 때만
 *    (수동 저장·앱 닫기 등) 만들어지고, 800ms 디바운스 자동 저장은 백업 없이 STATE를
 *    덮어쓴다 — 그래서 하루 종일 편집해도 복구 지점이 하나도 안 생길 수 있다.
 * =========================================================================== */

export interface LedgerSnapshot {
  id: string;
  /** epoch ms. ⚠️ 이 모듈은 순수해야 하므로 호출부가 넘긴다(Date.now() 금지). */
  savedAt: number;
  label: string;
  /** 복원 직전 자동 저장인가(사용자가 누른 저장과 구분해 목록에서 표시·정리한다). */
  auto: boolean;
  /**
   * 거래를 벗기고 저장했는가(`stripTxForSnapshot`).
   * ⚠️ 화면이 이 사실을 **반드시 표시**해야 한다 — 복원해도 거래는 그대로라는 계약을
   *    모르면 사용자가 "복원했는데 거래가 안 돌아왔다"로 읽는다.
   */
  txStripped: boolean;
  books: LedgerBooks;
}

export const MAX_LEDGER_SNAPSHOTS = 10;
export const MAX_LEDGER_SNAPSHOT_LABEL_LEN = 40;
/**
 * 스냅샷 전체의 대략적 직렬화 예산.
 * ⚠️ STATE는 백업 22본으로 복제되고 저장마다 파일 전체가 업로드된다 — 개수 상한만으로는
 *    큰 장부에서 STATE가 배로 불어난다. 개수와 바이트를 **둘 다** 건다.
 */
export const MAX_LEDGER_SNAPSHOT_BYTES = 512 * 1024;

export const makeLedgerSnapshot = (over: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  id: generateId(),
  savedAt: 0,
  label: '',
  auto: false,
  txStripped: false,
  books: [],
  ...over,
});

export interface LedgerSnapshotSummary {
  books: number;
  items: number;
  /** 실제 금액이 입력된 칸 수 */
  actuals: number;
  months: number;
  /** 거래를 벗기고 저장했는가 — 목록이 그대로 표시한다. */
  txStripped: boolean;
}

/** 목록 표시용 요약 — ⚠️ 절대 throw하지 않는다(손상된 스냅샷이 목록 전체를 죽이면 안 된다). */
export const ledgerSnapshotSummary = (snap: LedgerSnapshot | null | undefined): LedgerSnapshotSummary => {
  const out: LedgerSnapshotSummary = { books: 0, items: 0, actuals: 0, months: 0, txStripped: !!(snap && snap.txStripped) };
  const books = snap && Array.isArray(snap.books) ? snap.books : [];
  out.books = books.length;
  for (const b of books) {
    const items = b && Array.isArray((b as any).items) ? (b as any).items : [];
    out.items += items.length;
    for (const it of items) out.actuals += Object.keys((it && it.actual) || {}).length;
    const months = b && (b as any).months && typeof (b as any).months === 'object' ? (b as any).months : {};
    out.months += Object.keys(months).length;
  }
  return out;
};

/**
 * 스냅샷 추가.
 * ⚠️ 직전 스냅샷과 **내용이 같으면 추가하지 않는다**(원본 참조 반환) — 저장 버튼을 연타하면
 *    같은 내용이 10개 쌓여 정작 필요한 과거 시점이 상한 밖으로 밀려난다.
 * ⚠️ 상한 초과 시 **오래된 것부터** 버리되, 같은 조건이면 `auto`를 먼저 버린다 —
 *    사용자가 직접 누른 저장이 자동 스냅샷 때문에 밀려나면 안 된다.
 */
export const pushLedgerSnapshot = (
  list: LedgerSnapshot[] | null | undefined,
  snap: LedgerSnapshot,
): LedgerSnapshot[] => {
  const src = Array.isArray(list) ? list : [];
  if (!snap || !Array.isArray(snap.books)) return src;
  if (src.length > 0 && ledgerFingerprint(src[0].books) === ledgerFingerprint(snap.books)) return src;

  let out = [snap, ...src];
  // ① 개수 상한 — auto를 먼저, 그다음 오래된 것부터
  while (out.length > MAX_LEDGER_SNAPSHOTS) {
    let victim = -1;
    for (let i = out.length - 1; i > 0; i--) { if (out[i].auto) { victim = i; break; } }
    out.splice(victim >= 0 ? victim : out.length - 1, 1);
  }
  // ② 바이트 상한 — 방금 넣은 것(index 0)은 절대 버리지 않는다.
  let guard = out.length;
  while (out.length > 1 && guard-- > 0) {
    let size = 0;
    try { size = JSON.stringify(out).length; } catch { break; }
    if (size <= MAX_LEDGER_SNAPSHOT_BYTES) break;
    out.splice(out.length - 1, 1);
  }
  return out;
};

/**
 * 로드 정규화. ⚠️ `normalizeLedgerBooks`와 같은 **멱등 계약** — 바꿀 게 없으면 원본 참조를
 *    그대로 반환한다(매번 새 배열이면 Drive 폴링마다 재저장이 돈다).
 */
export const normalizeLedgerSnapshots = (raw: unknown): LedgerSnapshot[] => {
  if (!Array.isArray(raw)) return [];
  let changed = raw.length > MAX_LEDGER_SNAPSHOTS;
  const out: LedgerSnapshot[] = [];
  for (const s of raw.slice(0, MAX_LEDGER_SNAPSHOTS)) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) { changed = true; continue; }
    const src = s as Record<string, unknown>;
    const books = normalizeLedgerBooks(src.books);
    const next: LedgerSnapshot = {
      id: typeof src.id === 'string' && src.id ? src.id : generateId(),
      savedAt: numOrNull(src.savedAt) ?? 0,
      label: str(src.label, MAX_LEDGER_SNAPSHOT_LABEL_LEN),
      auto: src.auto === true,
      txStripped: src.txStripped === true,
      books,
    };
    if (next.id !== src.id || next.savedAt !== (src.savedAt ?? 0) || next.label !== (src.label ?? '')
      || next.auto !== (src.auto === true) || next.txStripped !== (src.txStripped === true)
      || books !== src.books) changed = true;
    out.push(next);
  }
  return changed ? out : (raw as LedgerSnapshot[]);
};

/**
 * sticky 복원 판정 — 백업 복원이 사용자의 스냅샷 이력을 되돌리면 안 된다.
 * ⚠️ 여기서는 `length > 0`이 옳다(빈 스냅샷이 저절로 생기는 경로가 없다 — `ledgerBooks`가
 *    화면을 열기만 해도 빈 장부 1권을 만드는 것과 사정이 다르다).
 */
export const ledgerSnapshotsHaveContent = (list: unknown): boolean =>
  Array.isArray(list) && list.some((s: any) => s && Array.isArray(s.books) && s.books.length > 0);

/**
 * Drive 저장 트리거용 지문.
 * ⚠️ **절대 던지지 않는다** — 이 계산은 App.tsx 저장 effect의 첫 블록이라, 던지면 그 세션의
 *    Drive 저장이 통째로 멈춘다(`ledgerFingerprint`와 같은 규약).
 * ⚠️ 개수 해시로 줄이지 말 것 — 라벨만 고친 스냅샷이 저장되지 않는다.
 */
export const ledgerSnapshotsFingerprint = (list: unknown): string => {
  try {
    if (!Array.isArray(list)) return '';
    return JSON.stringify(list.map((s: any) => [
      s?.id ?? '', s?.savedAt ?? 0, s?.label ?? '', s?.auto === true, s?.txStripped === true,
      ledgerFingerprint(s?.books),
    ]));
  } catch { return 'ERR'; }
};
