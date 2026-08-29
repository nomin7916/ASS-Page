// ─────────────────────────────────────────────────────────────────────────────
// src/ledgerExcel.ts — 가계부 엑셀(.xlsx) 내보내기 (시트 3장)
//
// ⚠️ `// @ts-nocheck`를 붙이지 말 것 — 빌드가 esbuild(타입체크 없음)라 이 파일의 타입이
//    유일한 안전망이다(portfolioExcel.ts·evalCompareExcel.ts와 같은 계약).
//
// ⚠️ 상대 import에 **`.ts` 확장자 필수** — scripts/verify-ledger-excel.mjs가 이 모듈을
//    **직접 import**한다(미러 금지). 떼면 Node ESM이 해석하지 못해 검증 파트①이 통째로
//    죽는데 vite 빌드는 통과하므로 **무음으로** 반쪽이 된다.
//
// ⚠️ 외부 npm 의존성 0. package-lock.json이 없어 Vercel이 매 배포마다 npm install을
//    재해석하고, 정확히 그 원인으로 프로덕션 흰 화면이 났던 이력이 있다.
//
// ─────────────────────────────────────────────────────────────────────────────
// 시트 구성 (사용자 확정 2026-08)
//   ① 월 매트릭스 — 결제·항목·계획 + [실제·차이] × 12개월 + 연간[실제·차이] = 29열
//   ② 대출       — 사진의 표 + 값 출처·잔여 회차
//   ③ 연간요약    — KPI 블록 + 월별/구분별/결제수단별 표
// 범위는 **보고 있는 연도만**, 월은 **항상 12개월 전부**(화면에서 숨긴 월도 포함).
//
// ⚠️ 색 규약 — 화면과 **의도적으로 다르다**.
//    화면은 이 앱의 손익 색(이익=빨강)과 충돌하지 않으려고 상태색(초과 amber / 절약 teal)을
//    쓰지만, 엑셀 숫자서식은 8색(Black·Blue·Cyan·Green·Magenta·Red·White·Yellow)만 지원해
//    amber/teal을 표현할 수 없고, **내려받은 파일은 앱 밖의 독립 문서**라 스프레드시트 관례
//    (초과=빨강 / 절약=녹색)가 오히려 정확하다(사용자의 원본 시트도 초과분을 빨강으로 쓴다).
//    ⚠️ 대신 **▲/▼ 부호를 서식에 박아** 색만으로 뜻을 전달하지 않는다(색각 이상·흑백 인쇄 안전).
//
// ⚠️ `hideAmounts` **미적용** — portfolioExcel·evalCompareExcel과 같은 규약이다. 화면
//    토글은 '어깨너머 보기'를 막는 것이고, 내려받은 파일을 마스킹하면 쓸모가 없다.
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️ 타입은 반드시 `import type` — Node의 타입 스트리핑은 interface를 지운 뒤 런타임 import를
//    시도하므로, 값 import에 섞으면 "does not provide an export named"로 **검증 파트①이 통째로
//    죽는다**(vite 빌드는 통과하므로 무음이다). portfolioExcel.ts·evalCompareExcel.ts와 같은 규약.
import { buildXlsxMulti, downloadXlsx, sanitizeFileName } from './xlsxWriter.ts';
import type { XlsxCell, XlsxMerge, XlsxSheet, XlsxStyle } from './xlsxWriter.ts';
import { StyleBag } from './portfolioExcel.ts';
import type { LedgerBook, LedgerItem, LedgerGroup } from './ledger.ts';
import {
  LEDGER_GROUP_ORDER, LEDGER_GROUP_LABEL, LEDGER_PAY_LABEL, LEDGER_PAY_ORDER,
  loanSchedule, loanNext12Total, loanTermMonths,
  planOf, actualOf, isItemActive, expectsActual,
  monthTotals, ledgerKpi, compareMonths,
  makeYm, addMonthsYm, monthsBetweenYm, ymOfDate,
} from './ledger.ts';

/* ===========================================================================
 * A. 서식 · 색
 * =========================================================================== */

export const LFMT = {
  won: '"₩"#,##0',
  /** 계획 대비 차이 — ⚠️ 0은 '—'다(0원과 '변동 없음'을 눈으로 구분). */
  variance: '[Red]"▲"₩#,##0;[Green]"▼"₩#,##0;"—"',
  /** 전월 대비 등 증감률 */
  pctVar: '[Red]"▲"0.0%;[Green]"▼"0.0%;"—"',
  /** 비중 — ⚠️ 반드시 **분수 + % 서식**. 리터럴 '%'를 붙이면 셀을 더했을 때 300%가 된다. */
  pct: '0.0%',
  /** 월/년 납입 이율 (사진의 0.359% / 4.312%) */
  rate: '0.000%',
  int: '#,##0',
  text: '@',
};

/** 그룹 섹션 행 배경 — 화면의 카테고리 색을 인쇄에 견디는 옅은 톤으로 옮긴다. */
const GROUP_BG: Record<LedgerGroup, string> = {
  loan: 'DBEAFE',      // blue-100
  fixed: 'FCE7F3',     // pink-100
  variable: 'DCFCE7',  // green-100
  annual: 'FFEDD5',    // orange-100
  income: 'E0E7FF',    // indigo-100
};

const C = {
  title: '111827',
  head: 'E5E7EB',
  headFg: '111827',
  sub: '6B7280',
  subtotal: 'F3F4F6',
  total: 'FEF3C7',
  na: 'F9FAFB',
} as const;

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/* ===========================================================================
 * B. 입력
 * =========================================================================== */

export interface LedgerExcelInput {
  book: LedgerBook | null | undefined;
  /** 내보낼 연도 — 화면이 보고 있는 연도. */
  year: number;
  /**
   * KPI·대출 시트의 기준월(1~12). 원금균등은 회차마다 납입액이 달라 **어느 달 기준인지가
   * 값의 일부**다 — 열 제목에 이 달을 박는다.
   */
  month: number;
  /** ⚠️ KST 'YYYY-MM-DD'. 호출부가 넘긴다 — 이 모듈에서 `new Date()`를 부르지 말 것. */
  todayKST: string;
}

/* ===========================================================================
 * C. 셀 헬퍼
 * =========================================================================== */

const S = (v: string, s?: number): XlsxCell => ({ t: 's', v, s });
const N = (v: number, s?: number): XlsxCell => ({ t: 'n', v, s });
/**
 * ⚠️ **null은 빈 셀**이다 — 0으로 떨어뜨리지 말 것.
 *    가계부의 null 계약은 3종('미입력' / '0원' / '산출 불가')을 구분하는 것이 전부이고,
 *    0으로 뭉뚱그리면 "지출이 없었다"는 확정 단언이 되어 시트가 화면과 다른 말을 한다.
 */
const NUM = (v: number | null | undefined, s?: number): XlsxCell =>
  v === null || v === undefined || !Number.isFinite(v) ? null : N(v, s);

/** 백분율 셀 — ⚠️ 인자는 **분수**(0.276)이지 퍼센트 값(27.6)이 아니다. */
const PCT = (frac: number | null | undefined, s?: number): XlsxCell => NUM(frac, s);

/**
 * 병합 칸을 **같은 스타일 빈 셀**로 채운다.
 * ⚠️ Excel은 병합된 칸의 서식을 **덮이는 칸 각각에서** 읽는다 — null로 두면 배경·테두리가
 *    첫 칸에서 끊겨 블록이 반만 칠해진다(portfolioExcel의 spanStyled와 같은 이유).
 */
const spanStyled = (row: XlsxCell[], from: number, to: number, s: number): void => {
  for (let c = from + 1; c <= to; c++) row[c] = S('', s);
};

/* ===========================================================================
 * D. 시트 ① 월 매트릭스
 * =========================================================================== */

const COL_PAY = 0, COL_NAME = 1, COL_PLAN = 2;
const COL_M0 = 3;                       // 1월 실제
const COL_YEAR_ACTUAL = COL_M0 + 24;    // 27
const COL_YEAR_VAR = COL_YEAR_ACTUAL + 1;
const MATRIX_COLS = COL_YEAR_VAR + 1;   // 29

const monthActualCol = (m: number) => COL_M0 + (m - 1) * 2;
const monthVarCol = (m: number) => monthActualCol(m) + 1;

interface Ctx {
  bag: StyleBag;
  book: LedgerBook;
  year: number;
  month: number;
  ym: string;
  /** 내보낸 날짜(KST) — 제목 아래 부제에 쓴다. */
  todayLabel: string;
}

const buildMatrixSheet = (ctx: Ctx): XlsxSheet => {
  const { bag, book, year } = ctx;
  const rows: XlsxCell[][] = [];
  const merges: XlsxMerge[] = [];

  const st = (x: XlsxStyle) => bag.id(x);
  const titleS = st({ bold: true, size: 15, color: C.title, align: 'left' });
  const subS = st({ size: 10, color: C.sub, align: 'left' });
  const headS = st({ bold: true, size: 10, bg: C.head, color: C.headFg, align: 'center', border: true, wrap: true });
  const headL = st({ bold: true, size: 10, bg: C.head, color: C.headFg, align: 'left', border: true });
  const nameS = st({ align: 'left', border: true });
  const payS = st({ align: 'center', size: 10, border: true });
  const wonS = st({ numFmt: LFMT.won, align: 'right', border: true });
  const varS = st({ numFmt: LFMT.variance, align: 'right', border: true });
  const naS = st({ align: 'center', size: 10, color: C.sub, bg: C.na, border: true });

  const subName = st({ bold: true, align: 'left', bg: C.subtotal, border: true });
  const subWon = st({ bold: true, numFmt: LFMT.won, align: 'right', bg: C.subtotal, border: true });
  const subVar = st({ bold: true, numFmt: LFMT.variance, align: 'right', bg: C.subtotal, border: true });
  const subBlank = st({ bg: C.subtotal, border: true });

  const totName = st({ bold: true, size: 11, align: 'left', bg: C.total, border: true });
  const totWon = st({ bold: true, size: 11, numFmt: LFMT.won, align: 'right', bg: C.total, border: true });
  const totVar = st({ bold: true, size: 11, numFmt: LFMT.variance, align: 'right', bg: C.total, border: true });
  const totBlank = st({ bg: C.total, border: true });

  const blank = (n: number): XlsxCell[] => new Array(n).fill(null);

  // ── 제목 ──
  const r0 = blank(MATRIX_COLS);
  r0[0] = S(`${book.name || '가계부'} — ${year}년 월 매트릭스`, titleS);
  spanStyled(r0, 0, MATRIX_COLS - 1, titleS);
  merges.push({ r1: 0, c1: 0, r2: 0, c2: MATRIX_COLS - 1 });
  rows.push(r0);

  const r1 = blank(MATRIX_COLS);
  r1[0] = S(`기준 ${ctx.ym} · 내보낸 날짜 ${ctx.todayLabel} · 금액 단위 원 · '차이' = 실제 − 계획(▲ 초과 / ▼ 절약)`, subS);
  spanStyled(r1, 0, MATRIX_COLS - 1, subS);
  merges.push({ r1: 1, c1: 0, r2: 1, c2: MATRIX_COLS - 1 });
  rows.push(r1);

  // ── 헤더 2줄 ──
  const h0 = blank(MATRIX_COLS);
  const h1 = blank(MATRIX_COLS);
  h0[COL_PAY] = S('결제', headS); h1[COL_PAY] = S('', headS);
  h0[COL_NAME] = S('항목', headL); h1[COL_NAME] = S('', headL);
  h0[COL_PLAN] = S('계획', headS); h1[COL_PLAN] = S('', headS);
  merges.push({ r1: 2, c1: COL_PAY, r2: 3, c2: COL_PAY });
  merges.push({ r1: 2, c1: COL_NAME, r2: 3, c2: COL_NAME });
  merges.push({ r1: 2, c1: COL_PLAN, r2: 3, c2: COL_PLAN });
  for (const m of MONTHS) {
    const c = monthActualCol(m);
    h0[c] = S(`${m}월`, headS);
    h0[c + 1] = S('', headS);
    merges.push({ r1: 2, c1: c, r2: 2, c2: c + 1 });
    h1[c] = S('실제', headS);
    h1[c + 1] = S('차이', headS);
  }
  h0[COL_YEAR_ACTUAL] = S(`${year} 연간`, headS);
  h0[COL_YEAR_VAR] = S('', headS);
  merges.push({ r1: 2, c1: COL_YEAR_ACTUAL, r2: 2, c2: COL_YEAR_VAR });
  h1[COL_YEAR_ACTUAL] = S('실제', headS);
  h1[COL_YEAR_VAR] = S('차이', headS);
  rows.push(h0, h1);

  // ── 그룹 섹션 ──
  const items = Array.isArray(book.items) ? book.items : [];
  let grandPlan = 0, grandActual = 0, grandMissing = 0;
  let incomePlan = 0, incomeActual = 0;

  for (const g of LEDGER_GROUP_ORDER) {
    const list = items.filter((it) => it && it.group === g);
    if (list.length === 0) continue;

    const gBg = GROUP_BG[g];
    const gS = st({ bold: true, bg: gBg, align: 'left', border: true });
    const secRow = blank(MATRIX_COLS);
    const note = g === 'annual' ? ' (연 1회 목돈 — 월 지출 합계에 포함되지 않습니다)'
      : g === 'income' ? ' (수입 — 지출 합계와 분리)' : '';
    secRow[0] = S(`${LEDGER_GROUP_LABEL[g]}${note}`, gS);
    spanStyled(secRow, 0, MATRIX_COLS - 1, gS);
    merges.push({ r1: rows.length, c1: 0, r2: rows.length, c2: MATRIX_COLS - 1 });
    rows.push(secRow);

    // 그룹 소계 누적
    const subPlan = new Array(13).fill(0);      // [0]=연간, [1..12]=월
    const subActual = new Array(13).fill(0);
    const subMissing = new Array(13).fill(0);

    for (const it of list) {
      const row = blank(MATRIX_COLS);
      row[COL_PAY] = S(LEDGER_PAY_LABEL[it.pay] || '', payS);
      row[COL_NAME] = S(it.name || '(이름 없음)', nameS);
      row[COL_PLAN] = NUM(planOf(it, ctx.ym), wonS);

      let yActual = 0, yPlan = 0, yMissing = 0, yHasActual = false;
      for (const m of MONTHS) {
        const k = makeYm(year, m);
        const ac = monthActualCol(m);
        // ⚠️ '그 달에 없던 항목'과 '미입력'을 구분한다 — 회색 '-'는 전자다.
        if (!isItemActive(it, k)) {
          row[ac] = S('-', naS);
          row[ac + 1] = S('', naS);
          continue;
        }
        const a = actualOf(it, k);
        const p = planOf(it, k);
        row[ac] = NUM(a, wonS);
        row[ac + 1] = (a !== null && p !== null) ? NUM(a - p, varS) : null;
        if (p !== null && Number.isFinite(p)) { yPlan += p; subPlan[m] += p; subPlan[0] += p; }
        if (a !== null && Number.isFinite(a)) {
          yActual += a; yHasActual = true;
          subActual[m] += a; subActual[0] += a;
        } else if (expectsActual(it, k)) {
          // ⚠️ `isItemActive`가 아니라 `expectsActual` — annual의 비납부월은 미입력이 아니다.
          yMissing++; subMissing[m]++; subMissing[0]++;
        }
      }
      row[COL_YEAR_ACTUAL] = yHasActual ? N(yActual, wonS) : null;
      // ⚠️ 미입력이 하나라도 있으면 연간 차이는 **빈 셀**(비교 불가). 0으로 단언 금지.
      row[COL_YEAR_VAR] = yMissing === 0 ? N(yActual - yPlan, varS) : null;
      rows.push(row);

      if (g === 'income') { incomePlan += yPlan; incomeActual += yActual; }
      else { grandPlan += yPlan; grandActual += yActual; grandMissing += yMissing; }
    }

    // 그룹 소계
    const sr = blank(MATRIX_COLS);
    sr[COL_PAY] = S('', subBlank);
    sr[COL_NAME] = S(`${LEDGER_GROUP_LABEL[g]} 소계`, subName);
    sr[COL_PLAN] = N(list.reduce((s2, it) => {
      const p = planOf(it, ctx.ym);
      return s2 + (p !== null && Number.isFinite(p) ? p : 0);
    }, 0), subWon);
    for (const m of MONTHS) {
      const c = monthActualCol(m);
      sr[c] = subMissing[m] > 0 && subActual[m] === 0 ? null : N(subActual[m], subWon);
      sr[c + 1] = subMissing[m] === 0 ? N(subActual[m] - subPlan[m], subVar) : null;
    }
    sr[COL_YEAR_ACTUAL] = N(subActual[0], subWon);
    sr[COL_YEAR_VAR] = subMissing[0] === 0 ? N(subActual[0] - subPlan[0], subVar) : null;
    rows.push(sr);
  }

  // ── 총계 ──
  const push2 = (label: string, plan: number, actual: number, missing: number) => {
    const tr = blank(MATRIX_COLS);
    tr[COL_PAY] = S('', totBlank);
    tr[COL_NAME] = S(label, totName);
    tr[COL_PLAN] = N(plan, totWon);
    for (const m of MONTHS) { tr[monthActualCol(m)] = S('', totBlank); tr[monthVarCol(m)] = S('', totBlank); }
    tr[COL_YEAR_ACTUAL] = N(actual, totWon);
    tr[COL_YEAR_VAR] = missing === 0 ? N(actual - plan, totVar) : null;
    rows.push(tr);
  };
  push2(`${year} 지출 합계`, grandPlan, grandActual, grandMissing);
  if (incomePlan > 0 || incomeActual > 0) {
    push2(`${year} 수입 합계`, incomePlan, incomeActual, 0);
    const sr = blank(MATRIX_COLS);
    sr[COL_PAY] = S('', totBlank);
    sr[COL_NAME] = S(`${year} 저축여력 (수입 − 지출)`, totName);
    sr[COL_PLAN] = N(incomePlan - grandPlan, totWon);
    for (const m of MONTHS) { sr[monthActualCol(m)] = S('', totBlank); sr[monthVarCol(m)] = S('', totBlank); }
    sr[COL_YEAR_ACTUAL] = grandMissing === 0 ? N(incomeActual - grandActual, totWon) : null;
    sr[COL_YEAR_VAR] = S('', totBlank);
    rows.push(sr);
  }

  const cols = new Array(MATRIX_COLS).fill(12);
  cols[COL_PAY] = 8; cols[COL_NAME] = 26; cols[COL_PLAN] = 14;
  cols[COL_YEAR_ACTUAL] = 15; cols[COL_YEAR_VAR] = 14;

  return {
    name: '월 매트릭스',
    rows, cols, merges,
    // ⚠️ 29열이라 가로 고정이 없으면 항목명이 흘러가 어느 행인지 알 수 없다.
    freezeRows: 4, freezeCols: 3,
    styles: bag.styles,
  };
};

/* ===========================================================================
 * E. 시트 ② 대출
 * =========================================================================== */

const LOAN_METHOD_LABEL: Record<string, string> = {
  interestOnly: '만기일시(이자만)',
  amortizing: '원리금균등',
  equalPrincipal: '원금균등',
};

/**
 * '값 출처' 라벨.
 *
 * ⚠️ `loanSchedule`이 null을 돌려주는 이유는 **네 가지**인데(기준월/이율 등 데이터 부족 ·
 *    아직 시작 전 · 만기 경과 · 잔액 0) 반환값만으로는 구분되지 않는다. 전부 '계산 불가'로
 *    뭉개면 **상환이 끝난 대출**이 데이터 오류처럼 보여, 사용자가 멀쩡한 잔액·만기·이율을
 *    고치거나 행을 지운다 — 대출은 이 장부에서 DSR·저축여력의 분모라 그 편집이 요약 시트
 *    전체를 오염시킨다.
 * ⚠️ `loanSchedule`의 null 계약(0을 돌려주지 않는다)은 **손대지 않는다** — 그 계약이 합계
 *    오염을 막는다. 사유 판정은 여기(호출부)에서 따로 낸다.
 */
export const loanSourceLabel = (
  loan: LedgerItem['loan'],
  ym: string,
): string => {
  const sch = loanSchedule(loan, ym);
  if (sch) return sch.source === 'override' ? '직접 입력' : '계산';
  if (!loan) return '계산 불가';
  const n = loanTermMonths(loan);
  const k = loan.principalAsOfYm ? monthsBetweenYm(loan.principalAsOfYm, ym) : null;
  if (k === null) return '기준월 없음';
  if (k < 0) return '시작 전';
  // ⚠️ 만기 판정은 **두 갈래**다. 만기일이 잔액 기준월보다 **앞서면** loanTermMonths가 null이라
  //    (span + 1 <= 0) 아래 `k >= n` 분기에 닿지 못한다 — 그 경우가 바로 '이미 상환이 끝난
  //    대출을 지우지 않고 둔' 가장 흔한 상태이고, 그걸 '계산 불가'로 뭉개면 사용자가 멀쩡한
  //    설정을 고치게 된다. 목표 월과 만기 월을 직접 비교해 먼저 거른다.
  const endYm = ymOfDate(loan.endDate);
  if (endYm && ym > endYm) return '만기 경과';
  if (n !== null && k >= n) return '만기 경과';
  if (!(Number.isFinite(loan.principal) && loan.principal > 0)) return '잔액 없음';
  return '계산 불가';
};

const buildLoanSheet = (ctx: Ctx): XlsxSheet => {
  const { bag, book, year, month, ym } = ctx;
  const rows: XlsxCell[][] = [];
  const merges: XlsxMerge[] = [];
  const st = (x: XlsxStyle) => bag.id(x);

  const titleS = st({ bold: true, size: 15, color: C.title, align: 'left' });
  const subS = st({ size: 10, color: C.sub, align: 'left' });
  const headS = st({ bold: true, size: 10, bg: C.head, color: C.headFg, align: 'center', border: true, wrap: true });
  const txtL = st({ align: 'left', border: true });
  const txtC = st({ align: 'center', size: 10, border: true });
  const wonS = st({ numFmt: LFMT.won, align: 'right', border: true });
  const rateS = st({ numFmt: LFMT.rate, align: 'right', border: true });
  const pctS = st({ numFmt: LFMT.pct, align: 'right', border: true });
  const intS = st({ numFmt: LFMT.int, align: 'center', border: true });
  const totName = st({ bold: true, align: 'left', bg: C.total, border: true });
  const totWon = st({ bold: true, numFmt: LFMT.won, align: 'right', bg: C.total, border: true });
  const totRate = st({ bold: true, numFmt: LFMT.rate, align: 'right', bg: C.total, border: true });
  const totBlank = st({ bg: C.total, border: true });
  const kpiLabel = st({ bold: true, align: 'left' });
  const kpiWon = st({ numFmt: LFMT.won, align: 'left', bold: true });
  const kpiPct = st({ numFmt: LFMT.pct, align: 'left', bold: true });
  const warnS = st({ align: 'left', size: 10, color: 'B45309' });

  const HEAD = ['대출명', '대출금(잔액)', '잔액 기준월', '약정 이자', '상환방법', '만기일',
    '거치(개월)', '잔여 회차', `${month}월 납입액`, '값 출처', '월 납입 이율', '년 납입 이율'];
  const NC = HEAD.length;
  const blank = (): XlsxCell[] => new Array(NC).fill(null);

  const r0 = blank();
  r0[0] = S(`${book.name || '가계부'} — 대출 (${ym} 기준)`, titleS);
  spanStyled(r0, 0, NC - 1, titleS);
  merges.push({ r1: 0, c1: 0, r2: 0, c2: NC - 1 });
  rows.push(r0);

  const r1 = blank();
  // ⚠️ 원금균등은 회차마다 납입액이 다르다 — 이 시트의 '납입액'이 어느 달의 값인지가 값의 일부다.
  r1[0] = S('원금균등은 회차마다 납입액이 줄어듭니다 — 표의 납입액은 위 기준월의 회차입니다. '
    + "'값 출처'가 '직접 입력'이면 계산이 아니라 사용자가 적은 금액입니다.", subS);
  spanStyled(r1, 0, NC - 1, subS);
  merges.push({ r1: 1, c1: 0, r2: 1, c2: NC - 1 });
  rows.push(r1);

  rows.push(HEAD.map((h) => S(h, headS)));

  const loans = (Array.isArray(book.items) ? book.items : []).filter((it) => it && it.group === 'loan');
  let sumPrincipal = 0, sumPay = 0, unresolved = 0;

  for (const it of loans) {
    const l = it.loan;
    const sch = loanSchedule(l, ym);
    const P = l && Number.isFinite(l.principal) ? l.principal : null;
    const n = loanTermMonths(l);
    const row = blank();
    row[0] = S(it.name || '(이름 없음)', txtL);
    row[1] = NUM(P, wonS);
    row[2] = S(l?.principalAsOfYm || '', txtC);
    row[3] = PCT(l && Number.isFinite(l.annualRate) ? l.annualRate / 100 : null, pctS);
    row[4] = S(LOAN_METHOD_LABEL[l?.method || ''] || '', txtC);
    row[5] = S(l?.endDate || '', txtC);
    row[6] = NUM(l && Number.isFinite(l.graceMonths as number) ? (l.graceMonths as number) : null, intS);
    row[7] = NUM(n, intS);
    row[8] = NUM(sch ? sch.payment : null, wonS);
    row[9] = S(loanSourceLabel(l, ym), txtC);
    // 월/년 납입 이율 = 월 납입액 / 대출 잔액 (사진의 0.359% / 4.312%)
    const rate = sch && P && P > 0 ? sch.payment / P : null;
    row[10] = PCT(rate, rateS);
    row[11] = PCT(rate === null ? null : rate * 12, rateS);
    rows.push(row);

    if (P !== null) sumPrincipal += P;
    if (sch) sumPay += sch.payment; else unresolved++;
  }

  // 합계
  const tr = blank();
  tr[0] = S('합계', totName);
  tr[1] = N(sumPrincipal, totWon);
  for (let c = 2; c <= 7; c++) tr[c] = S('', totBlank);
  tr[8] = N(sumPay, totWon);
  tr[9] = S('', totBlank);
  const totRateV = sumPrincipal > 0 ? sumPay / sumPrincipal : null;
  tr[10] = PCT(totRateV, totRate);
  tr[11] = PCT(totRateV === null ? null : totRateV * 12, totRate);
  rows.push(tr);

  // ── 요약 블록 ──
  const kpi = ledgerKpi(book, ym);
  rows.push(blank());
  const kv = (label: string, cell: XlsxCell, note?: string) => {
    const r = blank();
    r[0] = S(label, kpiLabel);
    r[1] = cell;
    if (note) r[2] = S(note, subS);
    rows.push(r);
  };
  kv('연 납입액 (향후 12개월)', NUM(kpi.loanAnnualPayment, kpiWon),
    // ⚠️ '월 × 12'가 아니다 — 원금균등은 매달 줄어 ×12가 과대다(화면 각주와 같은 정의).
    kpi.loanAnnualMissing > 0 ? `※ ${kpi.loanAnnualMissing}개월은 계상하지 못했습니다(만기 경과 등)` : '월 × 12가 아니라 회차별 합입니다');
  kv('DSR (연 상환액 / 연 수입)', PCT(kpi.dsr, kpiPct),
    kpi.dsr === null ? '※ 수입 항목이 없어 계산할 수 없습니다' : '');
  if (unresolved > 0) {
    const r = blank();
    r[0] = S(`※ 월 납입액을 구하지 못한 대출 ${unresolved}건 — 잔액 기준월·만기일을 채우거나 직접 입력하세요.`, warnS);
    spanStyled(r, 0, NC - 1, warnS);
    merges.push({ r1: rows.length, c1: 0, r2: rows.length, c2: NC - 1 });
    rows.push(r);
  }

  return {
    name: '대출',
    rows, merges,
    cols: [22, 16, 13, 11, 16, 13, 11, 10, 15, 11, 13, 13],
    freezeRows: 3, freezeCols: 1,
    styles: bag.styles,
  };
};

/* ===========================================================================
 * F. 시트 ③ 연간요약
 * =========================================================================== */

const buildSummarySheet = (ctx: Ctx): XlsxSheet => {
  const { bag, book, year, ym } = ctx;
  const rows: XlsxCell[][] = [];
  const merges: XlsxMerge[] = [];
  const st = (x: XlsxStyle) => bag.id(x);

  const NC = 7;
  const blank = (): XlsxCell[] => new Array(NC).fill(null);

  const titleS = st({ bold: true, size: 15, color: C.title, align: 'left' });
  const subS = st({ size: 10, color: C.sub, align: 'left' });
  const secS = st({ bold: true, size: 12, bg: C.head, color: C.headFg, align: 'left', border: true });
  const headS = st({ bold: true, size: 10, bg: C.head, color: C.headFg, align: 'center', border: true });
  const kpiLabel = st({ align: 'left', border: true });
  const kpiWon = st({ bold: true, numFmt: LFMT.won, align: 'right', border: true });
  const kpiPct = st({ bold: true, numFmt: LFMT.pct, align: 'right', border: true });
  const txtL = st({ align: 'left', border: true });
  const txtC = st({ align: 'center', size: 10, border: true });
  const wonS = st({ numFmt: LFMT.won, align: 'right', border: true });
  const varS = st({ numFmt: LFMT.variance, align: 'right', border: true });
  const pctS = st({ numFmt: LFMT.pct, align: 'right', border: true });
  const pctVarS = st({ numFmt: LFMT.pctVar, align: 'right', border: true });
  const intS = st({ numFmt: LFMT.int, align: 'center', border: true });
  const totName = st({ bold: true, align: 'left', bg: C.total, border: true });
  const totWon = st({ bold: true, numFmt: LFMT.won, align: 'right', bg: C.total, border: true });
  const totVar = st({ bold: true, numFmt: LFMT.variance, align: 'right', bg: C.total, border: true });
  const totBlank = st({ bg: C.total, border: true });

  const section = (label: string) => {
    const r = blank();
    r[0] = S(label, secS);
    spanStyled(r, 0, NC - 1, secS);
    merges.push({ r1: rows.length, c1: 0, r2: rows.length, c2: NC - 1 });
    rows.push(r);
  };

  const r0 = blank();
  r0[0] = S(`${book.name || '가계부'} — ${year}년 요약`, titleS);
  spanStyled(r0, 0, NC - 1, titleS);
  merges.push({ r1: 0, c1: 0, r2: 0, c2: NC - 1 });
  rows.push(r0);
  const r1 = blank();
  r1[0] = S(`기준 ${ym} · 내보낸 날짜 ${ctx.todayLabel}`, subS);
  spanStyled(r1, 0, NC - 1, subS);
  merges.push({ r1: 1, c1: 0, r2: 1, c2: NC - 1 });
  rows.push(r1);

  // ── KPI ──
  const kpi = ledgerKpi(book, ym);
  section(`핵심 지표 (${ym} 기준)`);
  const kv = (label: string, cell: XlsxCell, note = '') => {
    const r = blank();
    r[0] = S(label, kpiLabel);
    r[1] = cell;
    r[2] = S(note, subS);
    spanStyled(r, 2, NC - 1, subS);
    if (NC - 1 > 2) merges.push({ r1: rows.length, c1: 2, r2: rows.length, c2: NC - 1 });
    rows.push(r);
  };
  kv('월 지출 합계', NUM(kpi.recurringMonthly, kpiWon), '대출 + 고정비 + 변동비 (연단위 제외)');
  kv('년단위 합계', NUM(kpi.annualLumpSum, kpiWon), '연 1회 목돈');
  kv('예상 年 지출', NUM(kpi.projectedAnnual, kpiWon), '월 지출 합계 × 12 + 년단위 합계');
  kv('예상 月 지출', NUM(kpi.projectedMonthly, kpiWon), '예상 年 지출 ÷ 12');
  kv('수입 (월)', NUM(kpi.incomeMonthly > 0 ? kpi.incomeMonthly : null, kpiWon),
    kpi.incomeMonthly > 0 ? '' : '수입 항목이 없습니다');
  kv('저축여력', NUM(kpi.savingCapacity, kpiWon), '수입 − 예상 月 지출');
  kv('대출 월 납입', NUM(kpi.loanMonthly, kpiWon), '');
  kv('대출 연 납입액', NUM(kpi.loanAnnualPayment, kpiWon), '향후 12개월 회차 합 (월 × 12가 아님)');
  kv('DSR', PCT(kpi.dsr, kpiPct), '연 상환액 / 연 수입(계획)');
  rows.push(blank());

  // ── 월별 ──
  section(`${year}년 월별`);
  rows.push(['월', '계획', '실제', '차이', '전월 대비', '미입력', ''].map((h, i) => i < 6 ? S(h, headS) : null));
  let yPlan = 0, yActual = 0, yMissing = 0;
  for (const m of MONTHS) {
    const k = makeYm(year, m);
    const t = monthTotals(book, k);
    const cmp = compareMonths(book, k, addMonthsYm(k, -1));
    const r = blank();
    r[0] = S(`${m}월`, txtC);
    r[1] = N(t.planExpense, wonS);
    r[2] = t.missingExpense >= t.activeExpense && t.activeExpense > 0 ? null : N(t.actualExpense, wonS);
    r[3] = t.missingExpense === 0 ? N(t.actualExpense - t.planExpense, varS) : null;
    // ⚠️ 비교 불가는 **빈 셀** — 0.00%로 단언하면 '변동 없음'과 구분되지 않는다.
    r[4] = cmp.comparable && cmp.rate !== null ? N(cmp.rate, pctVarS) : null;
    r[5] = t.missingExpense > 0 ? N(t.missingExpense, intS) : null;
    rows.push(r);
    yPlan += t.planExpense; yActual += t.actualExpense; yMissing += t.missingExpense;
  }
  {
    const r = blank();
    r[0] = S('연간', totName);
    r[1] = N(yPlan, totWon);
    r[2] = N(yActual, totWon);
    r[3] = yMissing === 0 ? N(yActual - yPlan, totVar) : null;
    r[4] = S('', totBlank);
    r[5] = yMissing > 0 ? N(yMissing, st({ bold: true, numFmt: LFMT.int, align: 'center', bg: C.total, border: true })) : S('', totBlank);
    rows.push(r);
  }
  rows.push(blank());

  // ── 구분별 ──
  section(`${ym} 구분별 지출`);
  rows.push(['구분', '계획', '실제', '비중', '', '', ''].map((h, i) => i < 4 ? S(h, headS) : null));
  const t = monthTotals(book, ym);
  const expenseGroups = LEDGER_GROUP_ORDER.filter((g) => g !== 'income');
  const denom = expenseGroups.reduce((s2, g) => s2 + (t.byGroup[g] ? Math.max(0, t.byGroup[g].actual) : 0), 0);
  for (const g of expenseGroups) {
    const agg = t.byGroup[g];
    if (!agg || (agg.plan === 0 && agg.actual === 0)) continue;
    const r = blank();
    r[0] = S(LEDGER_GROUP_LABEL[g], txtL);
    r[1] = N(agg.plan, wonS);
    r[2] = N(agg.actual, wonS);
    // ⚠️ 분수 + % 서식. 리터럴 '%'를 붙이면 셀을 더했을 때 300%가 된다.
    r[3] = denom > 0 ? N(Math.max(0, agg.actual) / denom, pctS) : null;
    rows.push(r);
  }
  rows.push(blank());

  // ── 결제수단별 (⚠️ 지출 전용) ──
  section(`${ym} 결제수단별 지출`);
  rows.push(['결제수단', '계획', '실제', '', '', '', ''].map((h, i) => i < 3 ? S(h, headS) : null));
  for (const p of LEDGER_PAY_ORDER) {
    const agg = t.byPay[p];
    if (!agg || (agg.plan === 0 && agg.actual === 0)) continue;
    const r = blank();
    r[0] = S(LEDGER_PAY_LABEL[p], txtL);
    r[1] = N(agg.plan, wonS);
    r[2] = N(agg.actual, wonS);
    rows.push(r);
  }

  return {
    name: '연간요약',
    rows, merges,
    cols: [22, 16, 16, 14, 14, 10, 10],
    freezeRows: 2,
    styles: bag.styles,
  };
};

/* ===========================================================================
 * G. 진입점
 * =========================================================================== */

/** `260829_2026_가계부.xlsx` — ⚠️ 날짜는 인자로 받은 KST에서 자른다(`new Date()` 금지). */
export const ledgerExcelFileName = (todayKST: string, year: number, bookName: string): string => {
  const d = String(todayKST || '');
  const yy = d.slice(2, 4), mm = d.slice(5, 7), dd = d.slice(8, 10);
  const stamp = yy && mm && dd ? `${yy}${mm}${dd}` : '';
  const name = String(bookName || '가계부').trim() || '가계부';
  return sanitizeFileName(`${stamp ? stamp + '_' : ''}${year}_${name}.xlsx`);
};

export const buildLedgerSheets = (input: LedgerExcelInput): XlsxSheet[] => {
  const book = input.book || ({ id: '', name: '가계부', items: [], months: {}, createdAt: 0, updatedAt: 0 } as LedgerBook);
  const year = Number.isFinite(input.year) ? Math.trunc(input.year) : 0;
  const month = Number.isFinite(input.month) && input.month >= 1 && input.month <= 12 ? Math.trunc(input.month) : 1;
  // ⚠️ **StyleBag 하나**를 세 시트가 공유한다 — 시트마다 만들면 셀의 `s` 인덱스가 통합문서에
  //    단 하나뿐인 styles.xml과 어긋나 색·서식이 조용히 뒤섞인다(buildXlsxMulti가 던진다).
  const bag = new StyleBag();
  const ctx: Ctx = {
    bag, book, year, month,
    ym: makeYm(year, month),
    todayLabel: String(input.todayKST || ''),
  };
  return [buildMatrixSheet(ctx), buildLoanSheet(ctx), buildSummarySheet(ctx)];
};

export const buildLedgerXlsx = (input: LedgerExcelInput, modDate?: Date): Uint8Array =>
  buildXlsxMulti(buildLedgerSheets(input), modDate);

/**
 * 다운로드. 실패하면 **던지지 않고 false**를 돌려준다 — 이 화면은 z-1090(오버레이)이고
 * 별도 창에는 App조차 마운트되지 않아 토스트·ConfirmDialog가 뜨지 않으므로, 호출부가
 * 인라인 피드백으로 처리해야 한다.
 */
export const downloadLedgerXlsx = (input: LedgerExcelInput): boolean => {
  try {
    const bytes = buildLedgerXlsx(input);
    downloadXlsx(ledgerExcelFileName(input.todayKST, input.year, input.book?.name || ''), bytes);
    return true;
  } catch {
    return false;
  }
};
