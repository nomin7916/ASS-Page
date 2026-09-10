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

/** 대출 조건 변경 사건. `ym`이 곧 **적용월**이다(그 달 납입액부터 새 조건). */
export type LedgerLoanEventKind =
  | 'prepay'  // 중도상환(일부/전액) — 그 달 잔액에서 value만큼 뺀다
  | 'rate';   // 금리 변동 — 그 달부터 연이율이 value(%)가 된다

/**
 * ⚠️ 이 배열이 이 기능의 전부다. 대출은 **한 번 정하면 만기까지 그대로**가 아니라
 *    중도상환·금리변동으로 조건이 바뀌고, 그때마다 잔액과 이후 납입액이 재계산되어야 한다.
 *    (그 전에는 `paymentOverride`에 실제 납입액을 손으로 적는 것이 유일한 표현 수단이었다.)
 */
export interface LedgerLoanEvent {
  id: string;
  /**
   * 적용월 'YYYY-MM'. **이 달의 납입액 계산 전에** 적용된다.
   * ⚠️ 화면 기본값은 '다음 달'이다(사용자 확정 2026-09: "해당월에 입력하면 다음달에 계산되어
   *    반영") — 다만 값 자체는 사용자가 직접 고르므로 엔진은 `ym`을 그대로 해석한다.
   */
  ym: string;
  kind: LedgerLoanEventKind;
  /** prepay = 상환액(원, 양수) / rate = 새 연이율(%) */
  value: number;
  /**
   * prepay 전용 재약정 방식.
   *  · `'payment'`(기본) = **기간 유지 · 월 납입액 감소** — 가계부 월 지출이 바로 줄어든다.
   *  · `'term'`          = 월 납입액 유지 · 만기 단축.
   * ⚠️ 사용자 확정(2026-09)이 `'payment'`다. 기본값을 바꾸면 저장된 이벤트의 **뜻이 바뀐다**.
   */
  after: 'payment' | 'term';
  memo: string;
}

export interface LedgerLoan {
  /**
   * **`principalAsOfYm` 시점의** 잔액(= 이 대출의 출발점). 그 뒤 달의 잔액은 저장하지 않고
   * 상환 스케줄이 굴려서 낸다(`loanBalanceAt`) — 파생값을 저장하지 않는다는 이 파일의 규약.
   */
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
  /**
   * 중도상환·금리변동 이력. 비어 있으면(`[]`) **결과가 종전과 1원도 다르지 않다** —
   * 이것이 이 기능의 하위호환의 축이고 `#200`대 검증이 그 사실을 값으로 고정한다.
   */
  events: LedgerLoanEvent[];
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

/**
 * 표 보기 상태 — **가계부를 닫았다 열어도 마지막 조작 상태가 유지된다**(사용자 요청 2026-09).
 *
 * ⚠️ 장부(`LedgerBook`) **안**에 둔다 — App.tsx의 영속화 7지점(state·지문·payload·deps·
 *    applyStateData·applyBackupData·sticky)이 자동 상속되므로 **영속화 신규 지점이 0곳**이다.
 *    밖으로 빼면 그 7곳을 새로 배선해야 하고 하나만 빠져도 조용히 유실된다.
 * ⚠️ `ledgerBooksHaveContent`에는 **넣지 말 것** — 이것은 '내용'이 아니라 보기 선호도라,
 *    포함시키면 열만 숨긴 빈 장부가 '내용 있음'이 되어 백업 복원 경로가 영구히 막힌다.
 * ⚠️ 기본 상태(아무것도 숨기지 않고 아무것도 펼치지 않음)는 **저장하지 않는다**(정규화가
 *    `undefined`로 만든다) — 그래야 레거시 장부가 로드마다 '변경됨'이 되지 않는다(멱등 계약).
 */
export interface LedgerView {
  /** 숨긴 월(1~12, 오름차순·중복 없음). */
  hiddenMonths: number[];
  /** '계획' 열을 숨겼는가. */
  planHidden: boolean;
  /** 펼친 그룹 키(`LedgerGroup`). */
  openGroups: string[];
  /** 펼친 `그룹|결제수단` 버킷 키. */
  openPays: string[];
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
  /** 표 보기 상태(숨긴 열·펼침). 없으면 기본 상태 — 위 `LedgerView` 주석 참조. */
  view?: LedgerView;
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
 * 대출 한 건의 조건 변경 이력 상한. STATE는 백업 22본으로 복제되므로 무한 증식만 막는다.
 * ⚠️ 초과분은 **오래된 것부터** 버린다(최근 조건이 이후 납입액을 정한다).
 */
export const MAX_LEDGER_LOAN_EVENTS = 60;

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
  /**
   * 값의 출처.
   *  · `'override'` = 사용자가 직접 적은 값
   *  · `'paidOff'`  = **중도상환으로 잔액이 0이 된 뒤** — 납입액 0은 '모른다'가 아니라 확정이다.
   *    ⚠️ 이 경우를 null로 되돌리지 말 것: `planMissingKind`가 대출의 null을 `'failed'`로 세므로
   *       전액 상환한 대출이 **손댈 방법 없는 '산출 불가' 경고를 상시 점등**시킨다(2026-09에
   *       변동비에서 고친 것과 같은 부류의 가짜 오류).
   */
  source: 'override' | 'computed' | 'paidOff';
  /** 기준 시점(principalAsOfYm)에서 만기까지의 총 개월수. override면 null일 수 있다. */
  termMonths: number | null;
  /** 기준 시점부터 그 달까지 경과한 회차(0-based). override면 null일 수 있다. */
  period: number | null;
  /** 거치기간 중인가 */
  inGrace: boolean;
  /** 상환방법이 매달 같은 금액인가(원금균등만 false) */
  levelPayment: boolean;
  /**
   * 그 달 **말** 잔액. 잔액을 알 수 없으면 null(override인데 기준월이 없는 경우).
   * ⚠️ 저장하지 않는다 — 매 조회 시 스케줄에서 굴려 낸다.
   */
  balance: number | null;
  /** 그 달 **초** 잔액(중도상환 반영 후 = 이자 계산의 밑변). */
  openingBalance: number | null;
  /** 그 달에 적용된 연이율(%). 금리 변동 이벤트가 반영된 값이다. */
  annualRate: number;
  /** 그 달에 적용된 중도상환액(원). 없으면 0. */
  prepay: number;
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

/** 만기 정보가 없는 이자만 대출을 전개할 상한(100년). 실질 무한이지만 무한루프는 막는다. */
const MAX_LOAN_PERIODS = 1200;
/**
 * 잔액 소진 판정 여유. 원 단위 계산이라 1e-6 미만은 0으로 본다 —
 * 없으면 마지막 회차의 부동소수 잔여(1e-9 규모)가 **유령 회차**로 남는다.
 */
const LOAN_EPS = 1e-6;

/** 상환 스케줄 한 회차. `balance`는 그 달 **말** 잔액이다. */
export interface LoanRunRow {
  ym: string;
  /** 기준월(principalAsOfYm)부터의 회차(0-based) */
  period: number;
  /** 그 달 **초** 잔액 — 중도상환을 반영한 값이자 이자 계산의 밑변 */
  openingBalance: number;
  /** 그 달 적용 연이율(%) */
  annualRate: number;
  payment: number;
  interestPart: number;
  principalPart: number;
  /** 그 달에 적용된 중도상환액 */
  prepay: number;
  /** 그 달 **말** 잔액 */
  balance: number;
  inGrace: boolean;
  levelPayment: boolean;
  source: 'override' | 'computed';
}

export interface LoanRunResult {
  rows: LoanRunRow[];
  byYm: Map<string, LoanRunRow>;
  /** **중도상환으로** 잔액이 0이 된 달. 그 달부터 납입이 없다(만기 도달은 여기 해당하지 않는다). */
  paidOffYm: string | null;
  termMonths: number | null;
  /** 기준월 이전·만기 이후·손상값이라 적용되지 않은 이벤트 수 — 화면이 알려야 한다. */
  ignoredEvents: number;
}

/**
 * ⚠️ **참조 캐시.** 스케줄 전개는 만기까지 회차를 하나씩 굴리므로(APT 대출이 441회차)
 *    `loanSchedule`이 불릴 때마다 다시 돌면 O(회차 × 호출)이 된다 — `monthTotals`·
 *    `loanNext12Total`이 한 렌더에 수십 번 부른다. 대출 객체는 편집할 때만 새로 만들어지므로
 *    (불변 갱신) 참조가 곧 정확한 무효화 신호다. `ledgerFingerprint`의 캐시와 같은 규약.
 */
const loanRunsCache = new WeakMap<object, LoanRunResult | null>();

/**
 * 기준월부터 만기(또는 완납)까지의 상환 스케줄을 **순차 전개**한다.
 *
 * ⚠️ **하위호환의 축**: `events`가 비어 있으면 각 회차의 `payment`가 종전 폐쇄형 계산과
 *    **비트 단위로 같다**. 근거는 두 가지다 —
 *      ① 원리금균등·원금균등의 납입액을 **거치가 끝나는 그 회차에 1회만** 계산하고 이후
 *         회차로 캐리한다(매달 재계산하면 부동소수 잔차로 `p0 === p6`이 깨진다 — #12).
 *      ② 그 1회 계산의 입력(잔액·남은 회차)이 종전 식의 `(P, nEff)`와 정확히 같다
 *         (거치 중에는 원금 상환이 0이라 잔액이 P 그대로이고, `n - k|k=grace` = `n - grace`).
 *
 * ⚠️ **잔액 소진으로 스케줄을 끊는 것은 이벤트가 있을 때뿐이다.** 이벤트가 없으면 '완납'이라는
 *    개념이 종전 모델에 없었고, `paymentOverride`가 큰 짧은 대출에서 만기 전에 잔액이
 *    소진되면 **종전에는 만기까지 내던 납입액이 사라진다**(조용한 동작 변경).
 *
 * ⚠️ **null 계약은 종전 그대로다** — 게이트의 순서·조건을 바꾸지 말 것. 순진한 PMT 식은
 *    `annualRate=0`에서 0/0 = **NaN**, `n=0`에서 **Infinity**, `n<0`에서 **음수**(실측
 *    P=1억·4%·n=−3 → −33,222,469)를 낸다. 셋 다 `typeof === 'number'`라 타입으로 걸리지
 *    않고 Σ를 지나 월 지출 합계·예상 年 지출·DSR·저축여력을 전부 오염시킨다. 특히
 *    `payment > 0` 검사는 **Infinity를 통과시킨다** — `Number.isFinite`만이 막는다.
 */
export const buildLoanRuns = (loan: LedgerLoan | null | undefined): LoanRunResult | null => {
  if (!loan || typeof loan !== 'object') return null;
  if (loanRunsCache.has(loan)) return loanRunsCache.get(loan) ?? null;
  const out = buildLoanRunsInner(loan);
  loanRunsCache.set(loan, out);
  return out;
};

const buildLoanRunsInner = (loan: LedgerLoan): LoanRunResult | null => {
  const baseYm = loan.principalAsOfYm;
  if (!isValidYm(baseYm)) return null;

  const override = finiteOr(loan.paymentOverride);
  const useOverride = override !== null && override >= 0;
  const P0 = finiteOr(loan.principal, 0) as number;
  const rate0 = finiteOr(loan.annualRate, 0) as number;
  const n = loanTermMonths(loan);
  const graceRaw = finiteOr(loan.graceMonths, 0) as number;
  const grace = Number.isFinite(graceRaw) && graceRaw > 0 ? graceRaw : 0;

  // ── 게이트: 종전 loanSchedule의 계산 경로와 **같은 순서·같은 조건** ──
  if (!useOverride) {
    if (!(P0 > 0)) return null;                 // 잔액이 없으면 납입도 없다('0원'이 아니라 '해당 없음')
    const i0 = rate0 / 100 / 12;
    if (!Number.isFinite(i0) || i0 < 0) return null;
    // 만기 정보가 없으면 이자만 아는 셈이다 — 이자만 방식만 성립한다.
    if (n === null && loan.method !== 'interestOnly') return null;
  }

  // ── 이벤트 정리: 같은 달의 금리는 마지막 값, 중도상환은 합산 ──
  const evByYm = new Map<string, { rate: number | null; prepay: number; after: 'payment' | 'term' }>();
  let ignoredEvents = 0;
  const rawEvents = Array.isArray(loan.events) ? loan.events : [];
  for (const ev of rawEvents) {
    // ⚠️ 기준월 이전 이벤트는 이미 `principal`에 반영된 것으로 본다(이중 차감 금지).
    if (!ev || !isValidYm(ev.ym) || ev.ym < baseYm) { ignoredEvents++; continue; }
    const v = finiteOr(ev.value);
    if (v === null) { ignoredEvents++; continue; }
    const cur = evByYm.get(ev.ym) || { rate: null as number | null, prepay: 0, after: 'payment' as 'payment' | 'term' };
    if (ev.kind === 'rate') {
      if (v < 0) { ignoredEvents++; continue; }
      cur.rate = v;
    } else if (ev.kind === 'prepay') {
      if (!(v > 0)) { ignoredEvents++; continue; }
      cur.prepay += v;
      cur.after = ev.after === 'term' ? 'term' : 'payment';
    } else { ignoredEvents++; continue; }
    evByYm.set(ev.ym, cur);
  }
  /**
   * ⚠️ 잔액 소진으로 스케줄을 끊는 것은 **중도상환이 기록된 대출에서만**이다.
   *  · 이벤트가 없으면 '완납'이라는 개념이 종전 모델에 아예 없었다.
   *  · 금리변동만 있는 대출은 원리금균등·원금균등이 남은 회차로 재계산되므로 만기에 정확히
   *    0이 되어 조기 소진 자체가 일어나지 않는다.
   *  · **`paymentOverride`는 잔액과 독립**이다(전세 케이스가 그 근거 — 어떤 상환방법으로도
   *    재현되지 않는 실제 납입액). 여기에 `evByYm.size > 0`을 쓰면 금리변동 한 줄만 적어도
   *    납입액이 잔액보다 큰 대출이 조기에 '완납 0원'으로 꺼진다(#204e2·#204e3).
   */
  let hasPrepay = false;
  for (const v of evByYm.values()) if (v.prepay > 0) { hasPrepay = true; break; }
  const appliedYms = new Set<string>();

  const rows: LoanRunRow[] = [];
  const byYm = new Map<string, LoanRunRow>();
  const limit = n !== null ? n : MAX_LOAN_PERIODS;
  let balance = P0;
  let annualRate = rate0;
  let levelPay: number | null = null;   // 원리금균등 고정 납입액 (조건이 바뀔 때만 재계산)
  let epStep: number | null = null;     // 원금균등 원금 스텝 (〃)
  let paidOffYm: string | null = null;

  for (let k = 0; k < limit; k++) {
    const ym = addMonthsYm(baseYm, k);
    if (!isValidYm(ym)) break;

    // ── 이벤트는 그 달 납입액을 계산하기 **전에** 적용된다(= 그 달부터 새 조건). ──
    let prepay = 0;
    const ev = evByYm.get(ym);
    if (ev) {
      appliedYms.add(ym);
      if (ev.rate !== null) {
        annualRate = ev.rate;
        levelPay = null; epStep = null;              // 조건이 바뀌었으니 남은 회차로 재계산
      }
      if (ev.prepay > 0) {
        prepay = Math.min(ev.prepay, balance);
        balance -= prepay;
        // 'payment'(기본) = 기간 유지 · 납입액 재계산 / 'term' = 납입액 유지 · 만기 단축
        if (ev.after !== 'term') { levelPay = null; epStep = null; }
      }
    }

    // 전액 상환(또는 기간 단축으로 조기 소진) — **이벤트가 있을 때만** 스케줄을 끊는다.
    if (hasPrepay && !(balance > LOAN_EPS)) { paidOffYm = ym; break; }

    const i = annualRate / 100 / 12;
    if (!Number.isFinite(i) || i < 0) break;
    const interestNow = balance * i;
    if (!Number.isFinite(interestNow)) break;

    const inGrace = grace > 0 && k < grace;
    let payment: number, interestPart: number, principalPart: number;

    if (useOverride) {
      // 사용자가 적은 값이 권위다. 잔액은 그 값으로 굴리되 만기까지 납입액은 바뀌지 않는다.
      payment = override as number;
      interestPart = Math.min(interestNow, payment);
      principalPart = payment - interestPart;
    } else if (inGrace || loan.method === 'interestOnly') {
      payment = interestNow; interestPart = interestNow; principalPart = 0;
    } else if (loan.method === 'equalPrincipal') {
      // 원금균등 — 원금은 매달 같고 이자는 줄어 **회차마다 납입액이 다르다**.
      // ⚠️ '첫 회차를 대표값으로' 쓰지 말 것: 연 상환액을 구조적으로 과대 계상한다.
      if (epStep === null) {
        const remain = (n as number) - k;            // 그 달을 포함해 남은 회차
        if (!(remain > 0)) break;
        epStep = balance / remain;
      }
      principalPart = Math.min(epStep, balance);
      interestPart = interestNow;
      payment = principalPart + interestPart;
    } else {
      // 원리금균등 — 그 시점의 (잔액, 남은 회차)에서 **1회 계산되고 조건이 바뀔 때까지 고정**.
      if (levelPay === null) {
        const remain = (n as number) - k;
        if (!(remain > 0)) break;
        levelPay = i === 0 ? balance / remain : (balance * i) / (1 - Math.pow(1 + i, -remain));
      }
      payment = levelPay;
      interestPart = interestNow;
      principalPart = payment - interestPart;
    }

    // ⚠️ 단일 유한성 게이트 — 위 분기 중 하나라도 NaN/Infinity/음수를 내면 여기서 끊는다.
    if (!Number.isFinite(payment) || payment < 0) break;
    if (!Number.isFinite(principalPart)) principalPart = 0;
    if (!Number.isFinite(interestPart)) interestPart = 0;
    /**
     * 마지막 회차 정산 — 원금 상환분이 잔액을 넘지 않게 자른다. **기간 단축(`after:'term'`)에서
     * 만기가 앞당겨질 때** 마지막 회차의 과다 납입을 막는 것이 이 줄의 존재 이유다.
     *
     * ⚠️ 게이트 **둘 다** 필요하다:
     *  · `useOverride` 제외 — 사용자가 적은 납입액은 잔액과 독립인 권위값이다. 빼면
     *    `principal:1 + override:544,059`(실측 픽스처의 '사진 값 그대로' 구성)에서 납입액이
     *    **1원으로 잘려** 월 지출 합계·예상 年 지출·DSR이 통째로 무너진다(#39·#41·#43).
     *  · `hasPrepay` 한정 — 이벤트가 없으면 만기 회차에서 잔액과 원금 상환분이 **부동소수
     *    오차 수준으로만** 어긋나는데, 그 1e-9을 정산하면 그 달 납입액이 달라져
     *    "이벤트가 없으면 납입액이 만기까지 엄격히 고정"이 깨진다(#200b·#12).
     */
    if (!useOverride && hasPrepay && principalPart > balance) {
      principalPart = balance;
      payment = principalPart + interestPart;
    }

    const opening = balance;
    const closing = Math.max(0, balance - principalPart);
    const row: LoanRunRow = {
      ym, period: k,
      openingBalance: opening,
      annualRate,
      payment, interestPart, principalPart, prepay,
      balance: closing,
      inGrace,
      levelPayment: loan.method !== 'equalPrincipal',
      source: useOverride ? 'override' : 'computed',
    };
    rows.push(row);
    byYm.set(ym, row);
    balance = closing;
  }

  for (const key of evByYm.keys()) if (!appliedYms.has(key)) ignoredEvents++;

  return { rows, byYm, paidOffYm, termMonths: n, ignoredEvents };
};

/**
 * 그 달(`ym`)의 대출 납입액.
 *
 * ⚠️ **null 계약**: 계산 불가·만기 경과·기준월 이전은 전부 `null`이다. 0을 돌려주지 말 것 —
 *    0은 "이번 달은 안 낸다"는 확정인데, 계산 실패는 "모른다"이고 화면 표기가 달라야 한다.
 *    **유일한 예외가 `source:'paidOff'`**(중도상환으로 잔액이 0이 된 뒤)이고, 그건 사용자가
 *    직접 기록한 사건이라 '모름'이 아니라 확정이다.
 */
export const loanSchedule = (
  loan: LedgerLoan | null | undefined,
  ym: string,
): LoanScheduleResult | null => {
  if (!loan || !isValidYm(ym)) return null;

  const n = loanTermMonths(loan);
  const baseYm = loan.principalAsOfYm;

  // ⚠️ 기준월 없이 직접 입력만 있는 대출은 **스케줄을 전개할 수 없다**(잔액을 굴릴 출발점이
  //    없다). 종전에는 그래도 납입액을 냈으므로 그 동작을 그대로 지킨다 — 잔액만 미상(null).
  if (!isValidYm(baseYm)) {
    const override = finiteOr(loan.paymentOverride);
    if (override === null || override < 0) return null;
    const P = finiteOr(loan.principal, 0) as number;
    const ratePct = finiteOr(loan.annualRate, 0) as number;
    const i = ratePct / 100 / 12;
    const interest = Number.isFinite(P * i) ? Math.min(P * i, override) : 0;
    return {
      payment: override,
      interestPart: interest,
      principalPart: override - interest,
      source: 'override',
      termMonths: n,
      period: null,
      inGrace: false,
      levelPayment: loan.method !== 'equalPrincipal',
      balance: null,
      openingBalance: null,
      annualRate: ratePct,
      prepay: 0,
    };
  }

  const runs = buildLoanRuns(loan);
  if (!runs) return null;

  const row = runs.byYm.get(ym);
  if (row) {
    return {
      payment: row.payment,
      principalPart: row.principalPart,
      interestPart: row.interestPart,
      source: row.source,
      termMonths: runs.termMonths,
      period: row.period,
      inGrace: row.inGrace,
      levelPayment: row.levelPayment,
      balance: row.balance,
      openingBalance: row.openingBalance,
      annualRate: row.annualRate,
      prepay: row.prepay,
    };
  }

  // ── 완납 이후 = 확정된 0원. 만기 범위 밖이면 종전대로 null(만기 경과). ──
  if (runs.paidOffYm !== null && ym >= runs.paidOffYm) {
    const k = monthsBetweenYm(baseYm, ym);
    if (k === null || k < 0) return null;
    if (n !== null && k >= n) return null;
    return {
      payment: 0, principalPart: 0, interestPart: 0,
      source: 'paidOff',
      termMonths: n,
      period: k,
      inGrace: false,
      levelPayment: loan.method !== 'equalPrincipal',
      balance: 0, openingBalance: 0,
      annualRate: finiteOr(loan.annualRate, 0) as number,
      prepay: 0,
    };
  }
  return null;
};

/**
 * 그 달 **말** 잔액. 기준월 이전·만기 이후·계산 불가는 `null`.
 * ⚠️ 0(완납)과 null(모름)을 뭉개지 말 것 — 화면이 '₩0'과 '-'로 다르게 표기해야 한다.
 */
export const loanBalanceAt = (loan: LedgerLoan | null | undefined, ym: string): number | null => {
  const sch = loanSchedule(loan, ym);
  return sch ? sch.balance : null;
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

export const expectsActual = (item: LedgerItem, ym: string): boolean => {
  if (!item || !isItemActive(item, ym)) return false;
  if (item.group === 'annual') {
    const due = finiteOr(item.dueMonth);
    if (!(due !== null && Number(ym.slice(5, 7)) === Math.trunc(due))) return false;
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
 *   세지 않는다(넘기지 않으면 종전 동작 그대로 — 하위호환의 축).
 */
export const monthTotals = (
  book: LedgerBook | null | undefined,
  ym: string,
): LedgerMonthTotals => {
  const out: LedgerMonthTotals = {
    planExpense: 0, actualExpense: 0, planIncome: 0, actualIncome: 0,
    missingExpense: 0, missingIds: [], unresolved: 0, activeExpense: 0,
    byGroup: {}, byPay: {},
  };
  const items = book && Array.isArray(book.items) ? book.items : [];
  for (const it of items) {
    if (!it || !isItemActive(it, ym)) continue;
    const isIncome = it.group === 'income';
    const p = planOf(it, ym);
    const a = actualOf(it, ym);

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
    } else if (!isIncome && expectsActual(it, ym)) {
      // ⚠️ annual의 비납부월은 '미입력'이 아니다 — expectsActual이 그 구분의 단일 소스다.
      out.missingExpense++;
      out.missingIds.push(String(it.id || ''));
      out.byGroup[it.group].missing++;
    }
    if (!isIncome && expectsActual(it, ym)) out.activeExpense++;
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
export const expectedOf = (item: LedgerItem, ym: string): number | null => {
  if (!item || !isValidYm(ym) || !isItemActive(item, ym)) return null;
  const a = actualOf(item, ym);
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
): void => {
  if (!item || !isItemActive(item, ym)) return;
  o.activeCount++;
  const p = planOf(item, ym);
  const hasPlan = p !== null && Number.isFinite(p);
  if (hasPlan) { o.planSum += p; o.planCount++; }
  const a = actualOf(item, ym);
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
): LedgerExpected => {
  const o = emptyExpected();
  if (!Array.isArray(items) || !isValidYm(ym)) return o;
  for (const it of items) {
    // ⚠️ 수입 제외 — 이 게이트를 호출부에 위임하지 말 것. `byPay`가 수입을 섞어 '현금합계'에
    //    급여가 들어가던 회귀(verify #48c)가 monthTotals 밖으로 자리만 옮겨 되살아난다.
    if (!it || it.group === 'income') continue;
    addExpected(o, it, ym);
  }
  return finishExpected(o);
};

/** 수입 전용 예상 합 — 지출과 **분리된 축**이므로 별도 함수다(한 함수에 플래그 금지). */
export const expectedIncomeTotal = (
  items: LedgerItem[] | null | undefined,
  ym: string,
): LedgerExpected => {
  const o = emptyExpected();
  if (!Array.isArray(items) || !isValidYm(ym)) return o;
  for (const it of items) {
    if (!it || it.group !== 'income') continue;
    addExpected(o, it, ym);
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
): Record<string, LedgerExpected> => {
  const out: Record<string, LedgerExpected> = {};
  if (!Array.isArray(items) || !isValidYm(ym)) return out;
  for (const it of items) {
    if (!it || it.group === 'income') continue;   // ⚠️ 수입 제외(위와 같은 이유)
    // ⚠️ 게이트가 **두 곳**이다(여기 + addExpected) — 한쪽만 넓히면 그 결제수단 버킷이
    //    통째로 비거나 전부 0인 키가 생긴다. 둘 다 아니면 둘 다.
    if (!isItemActive(it, ym)) continue;
    const key = it.pay;
    if (!out[key]) out[key] = emptyExpected();
    addExpected(out[key], it, ym);
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
  expectedTotal(book && Array.isArray(book.items) ? book.items : [], ym);

/* ===========================================================================
 * G-3. 반영(reflected) 집계 — 소계·총계·분석·달력·엑셀 ③이 공유하는 단일 소스 (2026-09, §13)
 *
 * 반영값 = `actualOf(...) ?? planOf(...)`(= `expectedOf`).
 * 시간 경계는 **호출부가 `todayYm`으로 판정**한다(`ym > todayYm` = '예상'). 값은 같은 식이고
 * 표시·비교 가능 여부만 다르다.
 * =========================================================================== */

export interface LedgerReflected extends LedgerExpected {
  /** 결제수단별. 불변식 Σ byPay.value === value */
  byPay: Record<string, LedgerExpected>;
  /** 그룹별. 불변식 Σ byGroup.value === value */
  byGroup: Record<string, LedgerExpected>;
  /** 수입 축(지출과 분리) = expectedIncomeTotal(items).value */
  incomeValue: number;
}

/**
 * 그 달의 **반영 집계**(지출 축).
 * ⚠️ `expectedGrandTotal`을 **여기서 부른다**(검증이 직접 import하는 이름이라 삭제·우회 금지).
 */
export const reflectedMonth = (book: LedgerBook | null | undefined, ym: string): LedgerReflected => {
  const items = book && Array.isArray(book.items) ? book.items : [];
  const base = expectedGrandTotal(book, ym);
  const out: LedgerReflected = {
    ...base,
    unresolvedIds: base.unresolvedIds.slice(),
    byPay: expectedByPay(items, ym),
    byGroup: {},
    incomeValue: expectedIncomeTotal(items, ym).value,
  };
  for (const g of LEDGER_EXPENSE_GROUPS) {
    out.byGroup[g] = expectedTotal(items.filter((it) => it && it.group === g), ym);
  }
  return out;
};

/**
 * 확인 현황 — 월 헤더 `확인 N/M`·배너·요약 줄·달력·'계획대로 확인' 버튼이 **공유**한다.
 * (각자 `monthTotals`를 다시 부르지 않게 `totals`를 넘길 수 있다 — `yearSeries` 행이 이미 갖고 있다.)
 *
 */
export interface LedgerConfirmed {
  /** 실제가 확인된(입력된) 지출 항목 수 */
  confirmed: number;
  /** 실적 입력 대상 항목 수(annual 비납부월 제외) */
  target: number;
  /** 아직 확인되지 않은(=계획으로 반영된) 항목 수 */
  unconfirmed: number;
  missingIds: string[];
}

export const confirmedOf = (
  book: LedgerBook | null | undefined,
  ym: string,
  totals?: LedgerMonthTotals | null,
): LedgerConfirmed => {
  const t = totals || monthTotals(book, ym);
  return {
    confirmed: Math.max(0, t.activeExpense - t.missingExpense),
    target: t.activeExpense,
    unconfirmed: t.missingExpense,
    missingIds: t.missingIds.slice(),
  };
};

/**
 * '이 달 계획대로 확인' — **유일한 쓰기 헬퍼**(재설계 §13.2.4). 대상 항목의 `actual[ym]`에
 * `planOf` 값을 **반올림 없이** 쓴다.
 *
 * 대상 W = `monthTotals(...).missingIds`(지출 전용·`expectsActual` 기준 — 수입은 구조적으로 제외)
 *   중 `planOf !== null`인 항목.
 * ⚠️ **무반올림** — `Math.round(planOf)`를 저장하면 MS365 10,583.333…이 10,583으로 박혀 확인
 *    직후 차이가 `▼ 0`, 연간 `▼ 4`가 된다(§13.11 R-1). `NumCell`은 표시만 반올림한다.
 * ⚠️ 바뀐 게 없으면 **같은 book 참조**(dirty 없음). `ym > todayYm`이면 no-op.
 * ⚠️ 명시적 0인 (항목, 월)은 `missingIds`에 없으므로 건드리지 않는다.
 */
export interface LedgerApplyPlanResult {
  book: LedgerBook;
  written: number;
  skippedUnresolved: number;
}

export const applyPlanAsActual = (
  book: LedgerBook | null | undefined,
  ym: string,
  todayYm?: string,
): LedgerApplyPlanResult => {
  const none = { book: book as LedgerBook, written: 0, skippedUnresolved: 0 };
  if (!book || !Array.isArray(book.items) || !isValidYm(ym)) return none;
  const tYm = isValidYm(todayYm) ? String(todayYm) : '';
  if (tYm && ym > tYm) return none;
  const t = monthTotals(book, ym);
  if (t.missingIds.length === 0) return none;
  const targets = new Set(t.missingIds);
  let written = 0, skippedUnresolved = 0;
  let changed = false;
  const items = book.items.map((it) => {
    if (!it || !targets.has(String(it.id || ''))) return it;
    const p = planOf(it, ym);
    if (p === null || !Number.isFinite(p)) { skippedUnresolved++; return it; }
    written++;
    changed = true;
    return { ...it, actual: { ...(it.actual || {}), [ym]: p } };
  });
  if (!changed) return { ...none, skippedUnresolved };
  return { book: { ...book, items }, written, skippedUnresolved };
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
  /** 사용자가 적어 넣은 **기준월 잔액**의 합(= 출발점). 시간이 지나도 변하지 않는다. */
  loanPrincipal: number;
  /**
   * 그 달 **말** 잔액의 합 = '지금 남은 빚'. 상환이 진행되면 매달 줄고 중도상환이 반영된다.
   * ⚠️ `loanPrincipal`과 **합치지 말 것** — 묻는 질문이 다르다. 이 값을 '월 납입 이율'의
   *    분모로 바꾸는 것도 금지(사진 실측값 0.431%가 재현되지 않는다).
   */
  loanBalance: number;
  /** 잔액을 산출하지 못한 대출 수(계산 불가·기준월 없음) — `loanBalance`가 하한인 이유 */
  loanBalanceMissing: number;
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
  let loanBalance = 0, loanBalanceMissing = 0;

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
      // ⚠️ `loanPrincipal`(기준월 잔액 합)과 **별개 값**이다 — 합치지 말 것.
      //    저것은 사용자가 적어 넣은 출발점이고 이것은 스케줄이 굴린 '지금 남은 빚'이라,
      //    원리금균등에서는 매달 달라진다. 월 납입 이율의 분모는 종전대로 `loanPrincipal`이다.
      const bal = r ? r.balance : null;
      if (bal !== null && Number.isFinite(bal)) loanBalance += bal;
      else loanBalanceMissing++;
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
    loanBalance,
    loanBalanceMissing,
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
  /** = confirmedOf(cur).unconfirmed — 라벨 '계획 반영 N건 포함'의 N */
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
  const cc = confirmedOf(book, curYm);
  const pc = confirmedOf(book, prevYm);
  const base: LedgerReflectedDelta = {
    prev: prev.value, cur: cur.value,
    delta: null, rate: null, comparable: false, reason: '',
    prevMissing: pc.unconfirmed, curMissing: cc.unconfirmed,
    curUnconfirmed: cc.unconfirmed,
    prevUnconfirmed: pc.unconfirmed,
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

export interface LedgerCalendarEvent {
  bookId: string;
  bookName: string;
  /**
   * 'touch' = 그 날 가계부를 정리했다 / 'annual' = 연단위 지출 예정일
   * ⚠️ 칩 문구 우선순위는 **연단위 → 정리**다(정리 기록은 금액이 그 달 전체라 날짜 칸의 뜻과 다르다).
   */
  kind: 'touch' | 'annual';
  ym: string;
  /** kind==='touch' — ⚠️ 칩·패드가 그리는 총지출은 `reflectedExpense`(반영값)다(§13). */
  actualExpense?: number;
  /** 반영값(실제 ?? 계획). */
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

    // (a) 정리 기록
    const months = b.months && typeof b.months === 'object' ? b.months : {};
    for (const [ym, meta] of Object.entries(months)) {
      if (!isValidYm(ym) || !meta) continue;
      const d = (meta as LedgerMonthMeta).touchedDate;
      if (!isValidLedgerDate(d) || Number(d.slice(0, 4)) !== year) continue;
      // 반영값(실제 ?? 계획 + 미분류) — 칩·패드의 총지출과 전월 대비는 이 값이다(§13).
      // `actualExpense`·`missing`은 레거시 필드로 남긴다(실제 전용 · 확인 현황).
      const t = monthTotals(b, ym);
      const r = reflectedMonth(b, ym);
      const cf = confirmedOf(b, ym, t);
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

/**
 * 보기 상태 정규화. **기본 상태면 `undefined`**(저장하지 않는다 — 멱등 계약).
 * ⚠️ 손상값(문자열 월·13월·중복)을 조용히 통과시키면 `visibleMonths` 필터가 어긋나 열이
 *    영영 돌아오지 않는다(복원 칩도 그 값을 그대로 그린다).
 */
const normView = (raw: unknown): LedgerView | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>;
  const hidden = Array.isArray(v.hiddenMonths)
    ? [...new Set(v.hiddenMonths.filter((m) => Number.isInteger(m) && (m as number) >= 1 && (m as number) <= 12) as number[])]
      .sort((a, b) => a - b)
    : [];
  const strList = (x: unknown, cap: number): string[] => (Array.isArray(x)
    ? [...new Set(x.filter((k) => typeof k === 'string' && k) as string[])].slice(0, cap)
    : []);
  const openGroups = strList(v.openGroups, GROUPS.length);
  const openPays = strList(v.openPays, GROUPS.length * PAYS.length);
  const planHidden = v.planHidden === true;
  if (hidden.length === 0 && !planHidden && openGroups.length === 0 && openPays.length === 0) return undefined;
  return { hiddenMonths: hidden, planHidden, openGroups, openPays };
};

/** 정규화 결과가 원본과 같은가 — 다르면 `changed`(재저장). ⚠️ 레거시(필드 없음)는 같다고 본다. */
const sameView = (next: LedgerView | undefined, raw: unknown): boolean => {
  if (next === undefined) return raw === undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if ((r.planHidden === true) !== next.planHidden) return false;
  const sameArr = (a: unknown, b: (string | number)[]): boolean =>
    Array.isArray(a) && a.length === b.length && b.every((x, i) => (a as unknown[])[i] === x);
  return sameArr(r.hiddenMonths, next.hiddenMonths)
    && sameArr(r.openGroups, next.openGroups)
    && sameArr(r.openPays, next.openPays);
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
 * 대출 조건 변경 이력 정규화 — 손상값 제거 · ym 오름차순 · 상한.
 * ⚠️ 정렬이 **멱등의 근거**다(두 번째 정규화가 같은 배열을 낸다).
 * ⚠️ 상한 초과분은 **오래된 것부터** 버린다 — 최근 조건이 이후 납입액을 정한다.
 */
const normLoanEvents = (raw: unknown): LedgerLoanEvent[] => {
  if (!Array.isArray(raw)) return [];
  const out: LedgerLoanEvent[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    if (!isValidYm(r.ym)) continue;
    const value = numOrNull(r.value);
    if (value === null) continue;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : generateId(),
      ym: r.ym as string,
      kind: r.kind === 'rate' ? 'rate' : 'prepay',
      value,
      after: r.after === 'term' ? 'term' : 'payment',
      memo: str(r.memo, MAX_LEDGER_MEMO_LEN),
    });
  }
  out.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
  return out.length > MAX_LEDGER_LOAN_EVENTS ? out.slice(out.length - MAX_LEDGER_LOAN_EVENTS) : out;
};

/** ⚠️ 레거시(`events` 필드 없음)는 `[]`와 같다고 본다 — 아니면 로드마다 '변경됨'이 되어 churn. */
const sameLoanEvents = (next: LedgerLoanEvent[], raw: unknown): boolean => {
  if (!Array.isArray(raw)) return next.length === 0;
  if (raw.length !== next.length) return false;
  return next.every((e, idx) => {
    const r = raw[idx];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    const x = r as Record<string, unknown>;
    return x.id === e.id && x.ym === e.ym && x.kind === e.kind
      && x.value === e.value && x.after === e.after && (x.memo ?? '') === e.memo;
  });
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
          events: normLoanEvents(l.events),
        };
        // ⚠️ 이벤트는 배열이라 정규화가 항목을 **버릴 수 있다**(손상값·상한 초과). 그 결과가
        //    저장되려면 여기서 `changed`를 세워야 한다 — 나머지 loan 필드는 스칼라라 종전대로
        //    존재 여부만 비교하지만, 이 배열만은 내용을 봐야 한다.
        if (!sameLoanEvents(loan.events, l.events)) itemsChanged = true;
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
        createdAt: numOrNull(s.createdAt) ?? 0,
      };

      const same =
        next.id === s.id && next.group === s.group && next.pay === s.pay &&
        next.name === s.name && next.category === s.category && next.plan === (s.plan ?? null) &&
        next.planUnit === (s.planUnit ?? 'month') && next.memo === s.memo &&
        next.activeFrom === (s.activeFrom ?? '') && next.activeTo === (s.activeTo ?? '') &&
        next.dueMonth === (s.dueMonth ?? null) && next.dueDay === (s.dueDay ?? null) &&
        next.tone === (s.tone ?? 'none') && next.createdAt === (s.createdAt ?? 0) &&
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
    const view = normView(src.view);

    const book: LedgerBook = {
      id: typeof src.id === 'string' && src.id ? src.id : generateId(),
      name: str(src.name, MAX_LEDGER_NAME_LEN),
      items,
      categories,
      months,
      ...(view ? { view } : {}),
      createdAt: numOrNull(src.createdAt) ?? 0,
      updatedAt: numOrNull(src.updatedAt) ?? 0,
    };
    if (itemsChanged || monthsChanged || book.id !== src.id || book.name !== src.name
      || !sameStrList(categories, src.categories) || !sameView(view, src.view)) changed = true;
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
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.some((it: any) => it && (
      String(it.name ?? '').trim() !== '' ||
      numOrNull(it.plan) !== null ||
      Object.keys(it.actual || {}).length > 0 ||
      Object.keys(it.planOverride || {}).length > 0 ||
      (it.loan && numOrNull(it.loan.principal) !== null && it.loan.principal !== 0) ||
      // 중도상환·금리변동 이력만 남은 대출도 '내용 있음' — 사용자가 직접 친 값이라 복원이 되돌리면 안 된다.
      (it.loan && Array.isArray(it.loan.events) && it.loan.events.length > 0)
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
 * ⚠️ **참조 캐시**. 이 지문은 App.tsx 저장 effect의 첫 블록에서 매 렌더 계산되는데, 항목이
 *    많으면 `JSON.stringify`가 매번 수 ms다. 장부 배열은 편집마다 새로 만들어지므로
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
      // ⚠️ 보기 상태도 지문에 든다 — 빠뜨리면 '열만 숨긴 세션'이 portfolioUpdatedAt을 올리지
      //    못해 Drive STATE 저장이 통째로 스킵된다(이 저장소에서 여러 번 재발한 버그 클래스).
      v: b?.view ? [
        Array.isArray(b.view.hiddenMonths) ? b.view.hiddenMonths.slice() : [],
        b.view.planHidden === true,
        Array.isArray(b.view.openGroups) ? b.view.openGroups.slice() : [],
        Array.isArray(b.view.openPays) ? b.view.openPays.slice() : [],
      ] : null,
      m: Object.entries(b?.months || {})
        .map(([k, v]: [string, any]) => [k, v?.touchedDate ?? '', v?.memo ?? ''])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      t: (Array.isArray(b?.items) ? b.items : []).map((it: any) => [
        it?.id ?? '', it?.group ?? '', it?.pay ?? '', it?.name ?? '', it?.category ?? '',
        it?.plan ?? null, it?.planUnit ?? '', it?.memo ?? '',
        it?.activeFrom ?? '', it?.activeTo ?? '', it?.dueMonth ?? null, it?.dueDay ?? null,
        it?.tone ?? '',
        Object.entries(it?.planOverride || {}).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        Object.entries(it?.actual || {}).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        it?.loan ? [
          it.loan.principal ?? null, it.loan.principalAsOfYm ?? '', it.loan.annualRate ?? null,
          it.loan.method ?? '', it.loan.endDate ?? '', it.loan.termMonths ?? null,
          it.loan.graceMonths ?? null, it.loan.paymentOverride ?? null,
          // ⚠️ 빠뜨리면 '중도상환·금리변동만 기록한 세션'이 portfolioUpdatedAt을 올리지 못해
          //    Drive STATE 저장이 통째로 스킵된다(이 저장소에서 6회 재발한 버그 클래스).
          (Array.isArray(it.loan.events) ? it.loan.events : []).map((e: any) => [
            e?.id ?? '', e?.ym ?? '', e?.kind ?? '', e?.value ?? null, e?.after ?? '', e?.memo ?? '',
          ]),
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
  events: [],
  ...over,
});

/**
 * ⚠️ `after`의 기본값은 `'payment'`(기간 유지 · 월 납입액 감소)다 — 사용자 확정(2026-09).
 *    바꾸면 이미 저장된 이벤트의 **뜻이 조용히 달라진다**(그 값을 저장하지 않는 레거시 행 포함).
 */
export const makeLedgerLoanEvent = (over: Partial<LedgerLoanEvent> = {}): LedgerLoanEvent => ({
  id: generateId(),
  ym: '',
  kind: 'prepay',
  value: 0,
  after: 'payment',
  memo: '',
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
  books: [],
  ...over,
});

export interface LedgerSnapshotSummary {
  books: number;
  items: number;
  /** 실제 금액이 입력된 칸 수 */
  actuals: number;
  months: number;
}

/** 목록 표시용 요약 — ⚠️ 절대 throw하지 않는다(손상된 스냅샷이 목록 전체를 죽이면 안 된다). */
export const ledgerSnapshotSummary = (snap: LedgerSnapshot | null | undefined): LedgerSnapshotSummary => {
  const out: LedgerSnapshotSummary = { books: 0, items: 0, actuals: 0, months: 0 };
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
      books,
    };
    if (next.id !== src.id || next.savedAt !== (src.savedAt ?? 0) || next.label !== (src.label ?? '')
      || next.auto !== (src.auto === true)
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
      s?.id ?? '', s?.savedAt ?? 0, s?.label ?? '', s?.auto === true,
      ledgerFingerprint(s?.books),
    ]));
  } catch { return 'ERR'; }
};
