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
  if (item.group !== 'annual') return true;
  const due = finiteOr(item.dueMonth);
  return due !== null && Number(ym.slice(5, 7)) === Math.trunc(due);
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

export const monthTotals = (book: LedgerBook | null | undefined, ym: string): LedgerMonthTotals => {
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
 * G-2. 예상(expected) 집계 — "계획만 입력해도 소계가 나온다"
 *
 * ⚠️ **이 개념을 `monthTotals`에 필드로 얹지 말 것.** 그 구조체는 `compareMonths`·
 *    `momDelta`/`yoyDelta`·`yearSeries`·`annualCompare`·`ledgerEventsByDate`가 전부
 *    받아 간다. 계획으로 채운 값이 거기 섞이는 순간:
 *      · `compareMonths` — 두 달이 항상 채워져 `missing-mismatch`가 영영 발동하지 않는다.
 *        (−87.2% 거짓말이 "변동 없음 0%" 거짓말로 부호만 바뀌어 재발한다)
 *      · `yearSeries.actual` — 일어나지 않은 1년치 '실적' 막대가 그려진다.
 *      · `annualCompare` — 전년 대비가 영구히 '항상 비교 가능한 거짓 숫자'가 된다.
 *      · `ledgerEventsByDate` — 사용자가 아무것도 기록하지 않은 날에 달력 칩이 총지출을 찍는다.
 *    별도 함수 + 별도 반환 타입이라야 누출이 **import 심볼 변경을 요구**해 grep으로 잡힌다.
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
   */
  unresolved: number;
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
}

const emptyExpected = (): LedgerExpected => ({
  value: 0, fromActual: 0, fromPlan: 0,
  actualCount: 0, plannedCount: 0, unresolved: 0,
  planSum: 0, planCount: 0, activeCount: 0,
});

const addExpected = (o: LedgerExpected, item: LedgerItem, ym: string): void => {
  if (!item || !isItemActive(item, ym)) return;
  o.activeCount++;
  const p = planOf(item, ym);
  if (p !== null && Number.isFinite(p)) { o.planSum += p; o.planCount++; }
  const a = actualOf(item, ym);
  if (a !== null && Number.isFinite(a)) {
    o.value += a; o.fromActual += a; o.actualCount++;
  } else if (p !== null && Number.isFinite(p)) {
    o.value += p; o.fromPlan += p; o.plannedCount++;
  } else {
    o.unresolved++;
  }
};

/**
 * 항목 배열의 그 달 예상 합.
 * ⚠️ 넘겨받은 items를 **그대로** 더한다 — 수입 제외는 호출부 책임이 아니다:
 *    `group === 'income'` 항목은 이 함수가 **직접** 건너뛴다(아래). 지출 축 전용이다.
 * ⚠️ 절대 null을 돌려주지 않고 절대 throw하지 않는다. "모른다"는 `unresolved`가 진다.
 */
export const expectedTotal = (items: LedgerItem[] | null | undefined, ym: string): LedgerExpected => {
  const o = emptyExpected();
  if (!Array.isArray(items) || !isValidYm(ym)) return o;
  for (const it of items) {
    // ⚠️ 수입 제외 — 이 게이트를 호출부에 위임하지 말 것. `byPay`가 수입을 섞어 '현금합계'에
    //    급여가 들어가던 회귀(verify #48c)가 monthTotals 밖으로 자리만 옮겨 되살아난다.
    if (!it || it.group === 'income') continue;
    addExpected(o, it, ym);
  }
  return o;
};

/** 수입 전용 예상 합 — 지출과 **분리된 축**이므로 별도 함수다(한 함수에 플래그 금지). */
export const expectedIncomeTotal = (items: LedgerItem[] | null | undefined, ym: string): LedgerExpected => {
  const o = emptyExpected();
  if (!Array.isArray(items) || !isValidYm(ym)) return o;
  for (const it of items) {
    if (!it || it.group !== 'income') continue;
    addExpected(o, it, ym);
  }
  return o;
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
    if (!isItemActive(it, ym)) continue;
    const key = it.pay;
    if (!out[key]) out[key] = emptyExpected();
    addExpected(out[key], it, ym);
  }
  return out;
};

/** 장부 전체(지출 그룹만)의 그 달 예상 합. */
export const expectedGrandTotal = (book: LedgerBook | null | undefined, ym: string): LedgerExpected =>
  expectedTotal(book && Array.isArray(book.items) ? book.items : [], ym);

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
  reason: '' | 'no-prev' | 'missing-mismatch' | 'zero-base';
  prevMissing: number;
  curMissing: number;
}

/**
 * 두 달의 실제 지출 비교.
 *
 * ⚠️ **입력 완료도가 다르면 숫자를 내지 않는다**(`delta`/`rate` = null).
 *    진행 중인 달은 항상 미입력이 많다 — 그게 이 화면의 기본 상태다. 지난달 12건 전부 입력,
 *    이번 달 1건만 입력이면 순진한 차분은 **−87.2%**를 내고, 사용자는 '지출이 87% 줄었다'로 읽는다.
 *    이 저장소는 같은 상황을 이미 반대로 규정한다(일간 지표 절: 보류 시 `dodAbsChange=null` + `'-'`,
 *    "0.00%로 단언하면 '변동 없음'과 구분되지 않는다").
 */
export const compareMonths = (
  book: LedgerBook | null | undefined,
  curYm: string,
  prevYm: string,
): LedgerDelta => {
  const cur = monthTotals(book, curYm);
  const prev = monthTotals(book, prevYm);
  const base: LedgerDelta = {
    prev: prev.actualExpense, cur: cur.actualExpense,
    delta: null, rate: null, comparable: false, reason: '',
    prevMissing: prev.missingExpense, curMissing: cur.missingExpense,
  };
  const prevHasAny = prev.activeExpense > 0 && prev.missingExpense < prev.activeExpense;
  if (!prevHasAny) return { ...base, reason: 'no-prev' };
  // ⚠️ **개수가 아니라 집합**을 비교한다 — 개수만 보면 '1월은 월세만 입력, 2월은 커피만 입력'
  //    (달마다 다른 항목부터 채우는 흔한 습관)이 둘 다 missing=1로 통과해 −93.6% 같은
  //    거짓 신호가 확정 표시된다. 이 함수가 존재하는 이유가 바로 그 신호를 막는 것이다.
  if (prev.missingIds.join('|') !== cur.missingIds.join('|')) return { ...base, reason: 'missing-mismatch' };
  const delta = cur.actualExpense - prev.actualExpense;
  if (!(prev.actualExpense > 0)) {
    return { ...base, delta, comparable: true, reason: 'zero-base' };
  }
  return { ...base, delta, rate: delta / prev.actualExpense, comparable: true };
};

export const momDelta = (book: LedgerBook | null | undefined, ym: string): LedgerDelta =>
  compareMonths(book, ym, addMonthsYm(ym, -1));

export const yoyDelta = (book: LedgerBook | null | undefined, ym: string): LedgerDelta =>
  compareMonths(book, ym, addMonthsYm(ym, -12));

/* ===========================================================================
 * H-2. 항목 순서 / 구분 목록
 * =========================================================================== */

/**
 * 같은 그룹 안에서 항목을 한 칸 이동. `dir = -1`(위) | `+1`(아래).
 *
 * ⚠️ `items`는 그룹이 **섞인 평면 배열**이다. 인접 인덱스와 그냥 교환하면 다른 그룹
 *    항목과 자리를 바꿔 **화면에서는 아무 일도 일어나지 않는다**(화면은 그룹별로 버킷팅한다).
 *    반드시 '같은 group을 가진 가장 가까운 앞/뒤 항목'과 교환해야 한다.
 * ⚠️ 이동할 수 없으면(경계·미발견) **원본 참조를 그대로 반환**한다 — 새 배열을 만들면
 *    dirty가 서서 2.5초 뒤 Drive 저장이 헛돈다.
 * ⚠️ 순서는 배열 자체를 재정렬해 표현한다(`order` 필드 신설 금지) — `ledgerFingerprint`가
 *    항목을 배열 순서 그대로 투영하므로 **영속화 신규 지점이 0곳**이 된다.
 */
export const moveItemInGroup = (
  items: LedgerItem[] | null | undefined,
  itemId: string,
  dir: -1 | 1,
): LedgerItem[] => {
  const src = Array.isArray(items) ? items : [];
  if (!itemId || (dir !== -1 && dir !== 1)) return src as LedgerItem[];
  const i = src.findIndex((it) => it && it.id === itemId);
  if (i < 0) return src as LedgerItem[];
  const group = src[i].group;
  let j = -1;
  for (let k = i + dir; k >= 0 && k < src.length; k += dir) {
    if (src[k] && src[k].group === group) { j = k; break; }
  }
  if (j < 0) return src as LedgerItem[];
  const out = src.slice();
  out[i] = src[j];
  out[j] = src[i];
  return out;
};

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
  /** 'touch' = 그 날 가계부를 정리했다 / 'annual' = 연단위 지출 예정일 */
  kind: 'touch' | 'annual';
  ym: string;
  /** kind==='touch' */
  actualExpense?: number;
  momDelta?: number | null;
  momRate?: number | null;
  momComparable?: boolean;
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
 */
export const ledgerEventsByDate = (
  books: LedgerBooks | null | undefined,
  year: number,
): Record<string, LedgerCalendarEvent[]> => {
  const out: Record<string, LedgerCalendarEvent[]> = {};
  if (!Array.isArray(books) || !Number.isFinite(year)) return out;
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
      const t = monthTotals(b, ym);
      const m = momDelta(b, ym);
      push(d, {
        bookId: b.id, bookName, kind: 'touch', ym,
        actualExpense: t.actualExpense,
        momDelta: m.comparable ? m.delta : null,
        momRate: m.comparable ? m.rate : null,
        momComparable: m.comparable,
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

    const book: LedgerBook = {
      id: typeof src.id === 'string' && src.id ? src.id : generateId(),
      name: str(src.name, MAX_LEDGER_NAME_LEN),
      items,
      categories,
      months,
      createdAt: numOrNull(src.createdAt) ?? 0,
      updatedAt: numOrNull(src.updatedAt) ?? 0,
    };
    if (itemsChanged || monthsChanged || book.id !== src.id || book.name !== src.name
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
export const ledgerFingerprint = (books: unknown): string => {
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
