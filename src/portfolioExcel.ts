// ── 포트폴리오 테이블 → 엑셀 시트 모델 ──────────────────────────────────────
// 화면(`PortfolioTable`)이 그리는 표를 그대로 스프레드시트 행/셀로 옮긴다.
//
// ⚠️ import에 `.ts` 확장자를 쓴 것은 의도다 — 지우지 말 것. 이 모듈은
//    `scripts/verify-excel.mjs`가 **미러 없이 직접 import**해 검증한다(미러는 src에만
//    넣은 변경·미러에만 넣은 변경이 둘 다 통과하는 구멍을 만든다 — CLAUDE.md의 실측
//    사고: verify-backtest의 rebalMode 3필드 누락). Node의 타입 스트리핑은 ESM이라
//    확장자 없는 상대 경로를 해석하지 못해(`ERR_MODULE_NOT_FOUND`) 그 순간 검증이
//    통째로 죽는다. `tsconfig.app.json`에 `allowImportingTsExtensions: true`가 이미
//    켜져 있어 TS·vite 어느 쪽도 문제되지 않는다.
import { cleanNum, overseasInvestAmount, savingsMaturity, formatSavingsPeriod, formatSavingsDailyRate } from './utils.ts';
import { buildXlsx, downloadXlsx } from './xlsxWriter.ts';
import type { XlsxCell, XlsxMerge, XlsxSheet, XlsxStyle } from './xlsxWriter.ts';

// ⚠️ `PortfolioTable.tsx`의 동명 상수/함수와 **문자 그대로 같아야** 한다(D/S 배지 판정).
//    verify:excel #G가 두 파일의 배열 리터럴이 일치하는지 단언한다 — 한쪽만 고치면 실패한다.
const SAFE_CATEGORIES = ['채권', '현금', '예수금'];
const getAssetClass = (cat: string) => SAFE_CATEGORIES.includes(cat) ? 'S' : 'D';

// ── 열 정의 ─────────────────────────────────────────────────────────────────
// ⚠️ key 집합은 `PortfolioTable.tsx`의 `PT_COLS`와 동일해야 한다(숨김 열 토글이 같은
//    키를 쓴다). verify:excel #G가 단언한다.
// ⚠️ 라벨은 화면 `<th>`가 아니라 `PT_COLS` 쪽('투자비중'/'평가비중')을 쓴다 — 화면은
//    두 열이 모두 '비중'이라 스프레드시트에서 동명 열 두 개가 되어 구분이 불가능하다.
//    두 라벨 모두 앱이 이미(숨김 열 복원 칩에서) 쓰는 문구다.
export const EXCEL_COLS: { key: string; label: string; width: number }[] = [
  { key: 'category', label: '구분', width: 11 },
  { key: 'name', label: '종목명', width: 34 },
  { key: 'code', label: '코드', width: 14 },
  { key: 'changeRate', label: '등락률', width: 10 },
  { key: 'currentPrice', label: '현재가', width: 13 },
  { key: 'purchasePrice', label: '구매단가', width: 13 },
  { key: 'quantity', label: '보유수량', width: 12 },
  { key: 'investAmount', label: '투자금액', width: 15 },
  { key: 'investRatio', label: '투자비중', width: 10 },
  { key: 'evalAmount', label: '평가금액', width: 16 },
  { key: 'evalRatio', label: '평가비중', width: 10 },
  { key: 'returnRate', label: '수익률', width: 10 },
  { key: 'profit', label: '차익', width: 15 },
];

// ── 숫자 서식 ───────────────────────────────────────────────────────────────
// 화면 포매터와 **같은 자릿수**로 맞춘 Excel 서식 코드.
//   formatCurrency  → ko-KR KRW(소수 0자리, 음수는 앞에 '-')
//   formatNumber    → ko-KR 기본(최대 소수 3자리)
//   formatQty       → 최대 소수 8자리
//   formatFundPrice → 소수 2자리 고정
//   formatPercent   → 소수 2자리 + '%'
//   formatChangeRate→ ▲/▼ + 소수 2자리 + '%'
// ⚠️ 퍼센트 칸은 **분수(값/100)** 로 저장하고 '%' 서식을 쓴다. 화면과 표시가 100% 동일하면서
//    Excel이 진짜 백분율로 정렬·계산할 수 있다. 원시 퍼센트값(3.00)을 그대로 넣고 리터럴
//    "%"를 붙이는 방식으로 되돌리지 말 것 — 셀을 더하면 300%가 나온다.
// ⚠️ 색상은 한국식(이익 빨강 / 손실 파랑)이며 화면과 같다. 0은 화면이 파랑(`> 0 ? red : blue`)이라
//    3번째 구역도 파랑으로 둔다.
export const FMT = {
  krw: '"₩"#,##0',
  krwSigned: '[Red]"₩"#,##0;[Blue]-"₩"#,##0;[Blue]"₩"0',
  usd: '"$"#,##0.00',
  usdSigned: '[Red]"$"#,##0.00;[Blue]-"$"#,##0.00;[Blue]"$"0.00',
  num: '#,##0.###',
  int: '#,##0',
  qty: '#,##0.########',
  fund: '#,##0.00',
  pct: '0.00%',
  pctSigned: '[Red]0.00%;[Blue]-0.00%;[Blue]0.00%',
  change: '[Red]"▲"0.00%;[Blue]"▼"0.00%;0.00%',
  // TOTAL 행 전용 — 화면의 tfoot만 `>= 0 ? red : blue`라 0이 빨강이다(본문 행은 `> 0`이라
  // 0이 파랑). 두 규칙을 통일하지 말 것. 비중은 화면이 '100%' 문자열이라 소수를 붙이지 않는다.
  pctInt: '0%',
  pctSignedPos: '[Red]0.00%;[Blue]-0.00%;[Red]0.00%',
  krwSignedPos: '[Red]"₩"#,##0;[Blue]-"₩"#,##0;[Red]"₩"0',
  usdSignedPos: '[Red]"$"#,##0.00;[Blue]-"$"#,##0.00;[Red]"$"0.00',
};

// 행 색상 표시(4색 사이클)를 시트 배경으로 옮긴 값. `constants.MARK_STRIP_BG`의 원색을
// 흰 종이 위 25% 틴트로 환산한 것 — 화면의 `MARK_ROW_BG`(어두운 배경 위 20~28% 알파)와
// 같은 자리를 가리킨다. 표시하지 않으면 사용자가 일부러 칠해 둔 행 구분이 통째로 사라진다.
export const MARK_XLSX_BG: Record<string, string> = {
  yellow: 'FAECC1',
  slate: 'E4E8ED',
  rose: 'F8C7D1',
  brown: 'ECD4C2',
};

// ── 색상(화면 테마와 대응) ──────────────────────────────────────────────────
const C = {
  headBg: '1E293B',
  headFg: 'E2E8F0',
  titleFg: '0F172A',
  subFg: '64748B',
  investBg: 'EFF6FF',
  evalBg: 'FEFCE8',
  cashBg: 'F1F5F9',
  fundBg: 'EEF2FF',
  savingsBg: 'ECFDF5',
  totalBg: 'E2E8F0',
  dsBg: 'FEF3C7',
  gray: '94A3B8',
};

/**
 * 같은 스타일을 한 번만 등록하고 인덱스를 돌려주는 레지스트리.
 * ⚠️ `evalCompareExcel.ts`(자산검증 비교 시트)가 그대로 재사용한다 — export를 떼지 말 것.
 *    복제하면 두 시트의 스타일 dedupe 규칙이 갈릴 수 있다.
 */
export class StyleBag {
  styles: XlsxStyle[] = [];
  private map = new Map<string, number>();
  id(style: XlsxStyle): number {
    const key = JSON.stringify([style.numFmt || '', style.bold ? 1 : 0, style.italic ? 1 : 0,
      style.size || 0, style.color || '', style.bg || '', style.align || '', style.wrap ? 1 : 0,
      style.border ? 1 : 0]);
    const found = this.map.get(key);
    if (found !== undefined) return found;
    const idx = this.styles.length;
    this.styles.push(style);
    this.map.set(key, idx);
    return idx;
  }
}

export interface PortfolioExcelInput {
  /** 계좌명(예: '퇴직연금 820') */
  accountName: string;
  /** 기준일 'YYYY-MM-DD' (KST) */
  dateKST: string;
  /** ⚠️ `totals.calcPortfolio` 행 — 아래 '해외 단위' 주석 참조 */
  portfolio: any[];
  totals: { totalInvest: number; totalEval: number; totalProfit: number };
  hiddenColumns?: string[];
  isOverseas?: boolean;
  usdkrw?: number;
  isRetirement?: boolean;
  showSavings?: boolean;
  showAssetClass?: boolean;
  /** 화면과 같은 값이어야 하므로 컴포넌트가 계산해 넘긴다(재계산 금지 — 드리프트). */
  retirementStats?: { dRatio: number; sRatio: number } | null;
  /** 행 색상 표시 `{ [itemId]: 'yellow'|'slate'|'rose'|'brown' }` */
  markedRows?: Record<string, string>;
}

const S = (v: string, s?: number): XlsxCell => ({ t: 's', v, s });
const N = (v: number, s?: number): XlsxCell => ({ t: 'n', v, s });

/**
 * 화면 표 → 시트 모델.
 *
 * ⚠️ **해외계좌 단위 함정(CLAUDE.md '해외계좌 투자금액' 절)** — `portfolio`는
 *    `totals.calcPortfolio`라 `investAmount`·`evalAmount`·`profit`이 **이미 원화로 환산**돼
 *    있고(`usePortfolioData`가 fxRate를 곱한다), `currentPrice`·`purchasePrice`·`quantity`는
 *    **환산되지 않은 native USD**다. 그래서
 *      · 투자금액(USD)은 반드시 `overseasInvestAmount(item)` — `item.investAmount`를 읽으면 ≈1,390배
 *      · 평가금액·차익의 USD는 `item.evalAmount / usdkrw` (화면 `fmtDual`과 같은 식)
 *    를 쓴다. 되돌리지 말 것.
 */
export const buildPortfolioSheet = (input: PortfolioExcelInput): XlsxSheet => {
  const {
    accountName, dateKST, portfolio, totals,
    hiddenColumns = [], isOverseas = false, usdkrw = 1,
    isRetirement = false, showSavings = false, showAssetClass = false,
    retirementStats = null, markedRows = {},
  } = input;

  const H = (k: string) => hiddenColumns.includes(k);
  const fx = cleanNum(usdkrw) > 0 ? cleanNum(usdkrw) : 1;

  // 화면의 `formatNumber`/`formatQty`/`formatFundPrice`는 ''·null·undefined에 **빈 문자열**을
  // 돌려준다(`cleanNum` 경유가 아니다). 여기서 전부 0으로 눌러 버리면 화면이 비어 있는 칸에
  // 0이 찍혀 "입력한 적 없는 값"이 생긴다 → 미입력은 빈 셀로 남긴다.
  const numOrBlank = (v: unknown): number | null =>
    (v === '' || v === null || v === undefined) ? null : cleanNum(v);

  const markBg = (id: unknown): string | undefined => MARK_XLSX_BG[markedRows?.[String(id)]];

  // 퍼센트 칸은 분수로 저장한다(값/100). 나눗셈이 남기는 IEEE754 잔차(0.013 → 0.013000000000000001)를
  // 유효숫자 12자리로 정리한다 — 표시는 어차피 소수 2자리라 값이 바뀌지 않고, 셀을 눌렀을 때
  // 보이는 원시값만 깨끗해진다.
  const pct = (v: unknown) => Number((cleanNum(v) / 100).toPrecision(12));

  const items = Array.isArray(portfolio) ? portfolio : [];
  const stockItems = items.filter(p => p?.type === 'stock');
  const depositItems = items.filter(p => p?.type === 'deposit');
  const fundItems = isRetirement ? items.filter(p => p?.type === 'fund') : [];
  const savingsItems = showSavings ? items.filter(p => p?.type === 'savings') : [];

  // 예적금 만기금액은 화면에서 평가금액 셀 아래 작은 글씨로 붙는데, 스프레드시트에서는
  // 평가금액을 숫자로 유지해야 합계 검산이 되므로 별도 '비고' 열로 뺀다.
  const hasNote = savingsItems.some(it => cleanNum(savingsMaturity(it)) > 0);

  // ── 열 구성 ───────────────────────────────────────────────────────────────
  // 화면 헤더는 해외일 때 '현재가(USD)'/'구매단가(USD)'로 바뀐다. 금액 열은 해외에서
  // 화면이 USD·원화를 2줄로 보여주는데(fmtDual), 한 셀에 두 숫자를 넣을 수 없으므로
  // USD 열 바로 뒤에 '(₩)' 동반 열을 덧붙인다(정보 손실 없음).
  type Col = { key: string; label: string; width: number; krwOf?: string };
  const cols: Col[] = [];
  for (const c of EXCEL_COLS) {
    if (H(c.key)) continue;
    let label = c.label;
    if (isOverseas && c.key === 'currentPrice') label = '현재가(USD)';
    if (isOverseas && c.key === 'purchasePrice') label = '구매단가(USD)';
    if (isOverseas && (c.key === 'investAmount' || c.key === 'evalAmount' || c.key === 'profit')) {
      label = c.label + '(USD)';
    }
    cols.push({ key: c.key, label, width: c.width });
    if (isOverseas && (c.key === 'investAmount' || c.key === 'evalAmount' || c.key === 'profit')) {
      cols.push({ key: c.key + '__krw', label: c.label + '(₩)', width: c.width + 1, krwOf: c.key });
    }
  }
  if (hasNote) cols.push({ key: 'note', label: '비고', width: 20 });

  const colIndex = new Map<string, number>();
  cols.forEach((c, i) => colIndex.set(c.key, i));
  const nCols = Math.max(cols.length, 1);
  const at = (key: string) => colIndex.get(key);

  // 화면의 예수금/TOTAL 라벨이 가로지르는 열들(구분~보유수량 중 보이는 것)
  const SPAN_KEYS = ['category', 'name', 'code', 'changeRate', 'currentPrice', 'purchasePrice', 'quantity'];
  const spanCount = SPAN_KEYS.filter(k => !H(k)).length;

  const bag = new StyleBag();
  const rows: XlsxCell[][] = [];
  const merges: XlsxMerge[] = [];
  const rowHeights: (number | undefined)[] = [];

  const blankRow = (): XlsxCell[] => new Array(nCols).fill(null);
  const put = (row: XlsxCell[], key: string, cell: XlsxCell) => {
    const i = at(key);
    if (i !== undefined) row[i] = cell;
  };

  // ⚠️ 병합 범위에서 **덮이는 칸을 null로 두면 배경·테두리가 첫 칸에서 끊겨** 블록이 반만
  //    칠해진다(Excel은 병합 셀 서식을 덮인 칸 각각에서 읽는다). 같은 스타일의 빈 셀로 채운다.
  const spanStyled = (row: XlsxCell[], c1: number, c2: number, styleId: number) => {
    for (let c = c1 + 1; c <= c2 && c < row.length; c++) row[c] = S('', styleId);
  };

  // ── 1) 제목 / 2) 기준일 ───────────────────────────────────────────────────
  const titleStyle = bag.id({ bold: true, size: 15, color: C.titleFg, align: 'left' });
  const subStyle = bag.id({ size: 9, color: C.subFg, align: 'left' });
  const titleRow = blankRow();
  titleRow[0] = S(accountName, titleStyle);
  spanStyled(titleRow, 0, nCols - 1, titleStyle);
  rows.push(titleRow);
  rowHeights.push(24);
  if (nCols > 1) merges.push({ r1: 0, c1: 0, r2: 0, c2: nCols - 1 });

  const subRow = blankRow();
  subRow[0] = S(`기준일 ${dateKST}` + (isOverseas ? `  ·  적용환율 ₩${Math.round(fx).toLocaleString('en-US')}/USD` : ''), subStyle);
  spanStyled(subRow, 0, nCols - 1, subStyle);
  rows.push(subRow);
  rowHeights.push(undefined);
  if (nCols > 1) merges.push({ r1: 1, c1: 0, r2: 1, c2: nCols - 1 });

  // ── 3) 헤더 ───────────────────────────────────────────────────────────────
  const headStyle = bag.id({ bold: true, color: C.headFg, bg: C.headBg, align: 'center', border: true, wrap: true });
  rows.push(cols.map(c => S(c.label, headStyle)));
  rowHeights.push(22);

  const HEADER_ROWS = 3;

  // ── 본문 스타일 ───────────────────────────────────────────────────────────
  const money = isOverseas ? FMT.usd : FMT.krw;
  const moneySigned = isOverseas ? FMT.usdSigned : FMT.krwSigned;

  const mk = (extra: XlsxStyle, bg?: string) => bag.id({ ...extra, bg, border: true });
  const textC = (bg?: string) => mk({ align: 'center' }, bg);
  const textL = (bg?: string) => mk({ align: 'left' }, bg);
  const numR = (fmt: string, bg?: string) => mk({ numFmt: fmt, align: 'right' }, bg);
  const numC = (fmt: string, bg?: string) => mk({ numFmt: fmt, align: 'center' }, bg);
  const dash = (bg?: string) => bag.id({ align: 'center', color: C.gray, bg, border: true });

  /** 한 데이터 행을 채우는 공통 루틴. 값이 null이면 그 칸은 비운다. */
  const emit = (spec: {
    bg?: string;
    category?: string; name?: string; code?: string;
    changeRate?: number | string | null;
    currentPrice?: number | string | null;
    purchasePrice?: number | string | null;
    quantity?: number | string | null;
    investAmount?: number | string | null; investAmountKrw?: number | null;
    investRatio?: number | null;
    evalAmount?: number | null; evalAmountKrw?: number | null;
    evalRatio?: number | null;
    returnRate?: number | string | null;
    profit?: number | null; profitKrw?: number | null;
    note?: string;
    nameBold?: boolean;
  }) => {
    const bg = spec.bg;
    const row = blankRow();
    const val = (key: string, v: number | string | null | undefined, numFmt: string, align: 'right' | 'center') => {
      if (v === null || v === undefined) return;
      // 문자열은 숫자 서식을 적용할 수 없다. '-'(미사용 칸)만 회색으로 죽이고, 그 밖의
      // 표시 문자열(투자기간·1일 환산·미설정)은 보통 텍스트로 둔다.
      if (typeof v === 'string') put(row, key, S(v, v === DASH ? dash(bg) : textC(bg)));
      else put(row, key, N(v, align === 'right' ? numR(numFmt, bg) : numC(numFmt, bg)));
    };

    if (spec.category !== undefined) put(row, 'category', S(spec.category, textC(bg)));
    if (spec.name !== undefined) put(row, 'name', S(spec.name, bag.id({ align: 'left', bold: !!spec.nameBold, bg, border: true })));
    if (spec.code !== undefined) put(row, 'code', S(spec.code, textC(bg)));
    val('changeRate', spec.changeRate, FMT.change, 'center');
    val('currentPrice', spec.currentPrice, isOverseas ? FMT.usd : FMT.num, 'right');
    val('purchasePrice', spec.purchasePrice, isOverseas ? FMT.usd : FMT.int, 'right');
    val('quantity', spec.quantity, FMT.qty, 'center');
    val('investAmount', spec.investAmount, money, 'right');
    val('investAmount__krw', spec.investAmountKrw, FMT.krw, 'right');
    val('investRatio', spec.investRatio, FMT.pct, 'center');
    val('evalAmount', spec.evalAmount, money, 'right');
    val('evalAmount__krw', spec.evalAmountKrw, FMT.krw, 'right');
    val('evalRatio', spec.evalRatio, FMT.pct, 'center');
    val('returnRate', spec.returnRate, FMT.pctSigned, 'center');
    val('profit', spec.profit, moneySigned, 'right');
    val('profit__krw', spec.profitKrw, FMT.krwSigned, 'right');
    if (spec.note !== undefined) put(row, 'note', S(spec.note, textL(bg)));
    rows.push(row);
    rowHeights.push(undefined);
    return row;
  };

  // 화면과 달리 셀 하나에 서식이 하나뿐이라, '-' 같은 문자열은 회색 가운데 정렬로 통일한다.
  const DASH = '-';

  // ── 4) 주식 행 ────────────────────────────────────────────────────────────
  for (const item of stockItems) {
    const qty = cleanNum(item.quantity);
    const ac = item.assetClass ?? getAssetClass(item.category);
    const overseasInvest = isOverseas ? cleanNum(overseasInvestAmount(item)) : 0;
    const evalKrw = cleanNum(item.evalAmount);
    const profitKrw = cleanNum(item.profit);
    emit({
      bg: markBg(item.id),
      category: (item.category || '미지정') + (showAssetClass ? ` ${ac}` : ''),
      name: item.name || '',
      code: item.code || '',
      changeRate: pct(item.changeRate),
      // 화면: 해외는 formatUSD(0도 '$0.00'), 국내는 formatNumber(미입력이면 빈 칸).
      currentPrice: isOverseas ? cleanNum(item.currentPrice) : numOrBlank(item.currentPrice),
      // 화면: 해외는 저장된 구매단가(USD), 국내는 투자금액 ÷ 보유수량(반올림). 0이면 '-'.
      purchasePrice: isOverseas
        ? (cleanNum(item.purchasePrice) > 0 ? cleanNum(item.purchasePrice) : DASH)
        : (qty > 0 ? Math.round(cleanNum(item.investAmount) / qty) : DASH),
      quantity: numOrBlank(item.quantity),
      investAmount: isOverseas ? overseasInvest : cleanNum(item.investAmount),
      investAmountKrw: isOverseas ? overseasInvest * fx : null,
      investRatio: pct(item.investRatio),
      evalAmount: isOverseas ? evalKrw / fx : evalKrw,
      evalAmountKrw: isOverseas ? evalKrw : null,
      evalRatio: pct(item.evalRatio),
      returnRate: pct(item.returnRate),
      profit: isOverseas ? profitKrw / fx : profitKrw,
      profitKrw: isOverseas ? profitKrw : null,
    });
  }

  // ── 5) 예수금(CASH) 행 ────────────────────────────────────────────────────
  for (const item of depositItems) {
    const evalKrw = cleanNum(item.evalAmount);
    // 화면: 투자금액 칸은 fx를 곱하지 않은 원시 depositAmount(해외면 USD)를 보여준다.
    const depositAmt = numOrBlank(item.depositAmount);
    const row = emit({
      bg: C.cashBg,
      investAmount: depositAmt,
      investAmountKrw: (isOverseas && depositAmt !== null) ? depositAmt * fx : null,
      investRatio: pct(item.investRatio),
      evalAmount: isOverseas ? evalKrw / fx : evalKrw,
      evalAmountKrw: isOverseas ? evalKrw : null,
      evalRatio: pct(item.evalRatio),
      returnRate: DASH,
      profit: 0,
      profitKrw: isOverseas ? 0 : null,
    });
    // 라벨은 화면과 같이 구분~보유수량 구간을 가로지른다(보이는 열이 없으면 생략).
    if (spanCount > 0) {
      const r = rows.length - 1;
      const cashLabel = bag.id({ bold: true, align: 'center', bg: C.cashBg, border: true });
      row[0] = S(isOverseas ? '예수금 (USD CASH)' : '예수금 (CASH)', cashLabel);
      spanStyled(row, 0, spanCount - 1, cashLabel);
      if (spanCount > 1) merges.push({ r1: r, c1: 0, r2: r, c2: spanCount - 1 });
    }
  }

  // ── 6) 펀드 행 (퇴직연금·개인연금) ────────────────────────────────────────
  for (const item of fundItems) {
    const storedQty = cleanNum(item.quantity);
    const purchaseCalc = storedQty > 0 ? Math.round(cleanNum(item.investAmount) / storedQty) : 0;
    const ac = item.assetClass ?? 'S';
    const evalKrw = cleanNum(item.evalAmount);
    const profitKrw = cleanNum(item.profit);
    emit({
      bg: markBg(item.id) || C.fundBg,
      category: (String(item.code || '').startsWith('MA:') ? 'MIRAE' : 'FUND') + (showAssetClass ? ` ${ac}` : ''),
      name: item.name || '',
      code: item.code || '',
      changeRate: pct(item.changeRate),
      currentPrice: numOrBlank(item.currentPrice),
      purchasePrice: purchaseCalc > 0 ? purchaseCalc : DASH,
      quantity: storedQty > 0 ? Math.round(storedQty) : '미설정',
      investAmount: cleanNum(item.investAmount),
      investAmountKrw: isOverseas ? cleanNum(item.investAmount) * fx : null,
      investRatio: pct(item.investRatio),
      evalAmount: isOverseas ? evalKrw / fx : evalKrw,
      evalAmountKrw: isOverseas ? evalKrw : null,
      evalRatio: pct(item.evalRatio),
      returnRate: pct(item.returnRate),
      profit: isOverseas ? profitKrw / fx : profitKrw,
      profitKrw: isOverseas ? profitKrw : null,
    });
  }

  // ── 7) 예적금 행 (dc-irp 전용) ────────────────────────────────────────────
  // 화면이 열을 용도 변경해 쓴다: 코드=연이율, 등락률=1일 환산, 현재가=투자기간,
  // 구매단가·보유수량=미사용('-').
  for (const item of savingsItems) {
    const ac = item.assetClass ?? 'S';
    const investAmt = cleanNum(item.investAmount);
    const maturity = cleanNum(savingsMaturity(item));
    emit({
      bg: markBg(item.id) || C.savingsBg,
      category: '예적금' + (showAssetClass ? ` ${ac}` : ''),
      name: item.name || '',
      code: `연 ${item.annualRate ? String(item.annualRate) : '0'}%`,
      changeRate: formatSavingsDailyRate(item.annualRate),
      // 화면은 기간이 비면 '기간 미설정'으로 표기한다('-'가 아니다).
      currentPrice: formatSavingsPeriod(item.startDate, item.endDate) || '기간 미설정',
      purchasePrice: DASH,
      quantity: DASH,
      investAmount: investAmt > 0 ? investAmt : '미설정',
      investRatio: pct(item.investRatio),
      evalAmount: cleanNum(item.evalAmount),
      evalRatio: pct(item.evalRatio),
      returnRate: pct(item.returnRate),
      profit: cleanNum(item.profit),
      note: maturity > 0 ? `만기 ₩${Math.round(maturity).toLocaleString('en-US')}` : '',
    });
  }

  // ── 8) 퇴직연금 D/S 비율 (dc-irp 전용) ────────────────────────────────────
  if (retirementStats) {
    const d = cleanNum(retirementStats.dRatio);
    const s = cleanNum(retirementStats.sRatio);
    const gap = d - 70;
    const dsRow = blankRow();
    const dsStyle = bag.id({ bold: true, align: 'left', bg: C.dsBg, border: true });
    dsRow[0] = S(
      `퇴직연금 자산 비율   ·   위험 D ${d.toFixed(1)}% (목표 70%${Math.abs(gap) > 5 ? `, ${gap > 0 ? '+' : ''}${gap.toFixed(1)}%` : ''})` +
      `   ·   안전 S ${s.toFixed(1)}% (목표 30%)`,
      dsStyle,
    );
    spanStyled(dsRow, 0, nCols - 1, dsStyle);
    rows.push(dsRow);
    rowHeights.push(20);
    if (nCols > 1) merges.push({ r1: rows.length - 1, c1: 0, r2: rows.length - 1, c2: nCols - 1 });
  }

  // ── 9) TOTAL CALCULATION ──────────────────────────────────────────────────
  const totalInvest = cleanNum(totals?.totalInvest);
  const totalEval = cleanNum(totals?.totalEval);
  const totalProfit = cleanNum(totals?.totalProfit);
  const totalRate = totalInvest > 0 ? Number((totalProfit / totalInvest).toPrecision(12)) : 0;
  const totRow = blankRow();
  const totText = bag.id({ bold: true, align: 'center', bg: C.totalBg, color: C.titleFg, border: true });
  const totNum = (fmt: string) => bag.id({ bold: true, numFmt: fmt, align: 'right', bg: C.totalBg, border: true });
  const totPct = (fmt: string) => bag.id({ bold: true, numFmt: fmt, align: 'center', bg: C.totalBg, border: true });
  const putT = (key: string, cell: XlsxCell) => { const i = at(key); if (i !== undefined) totRow[i] = cell; };

  const moneySignedPos = isOverseas ? FMT.usdSignedPos : FMT.krwSignedPos;
  putT('investAmount', N(isOverseas ? totalInvest / fx : totalInvest, totNum(money)));
  putT('investAmount__krw', N(totalInvest, totNum(FMT.krw)));
  putT('investRatio', N(1, totPct(FMT.pctInt)));
  putT('evalAmount', N(isOverseas ? totalEval / fx : totalEval, totNum(money)));
  putT('evalAmount__krw', N(totalEval, totNum(FMT.krw)));
  putT('evalRatio', N(1, totPct(FMT.pctInt)));
  putT('returnRate', N(totalRate, totPct(FMT.pctSignedPos)));
  putT('profit', N(isOverseas ? totalProfit / fx : totalProfit, totNum(moneySignedPos)));
  putT('profit__krw', N(totalProfit, totNum(FMT.krwSignedPos)));
  if (hasNote) putT('note', S('', totText));
  if (spanCount > 0) {
    totRow[0] = S('TOTAL CALCULATION', totText);
    spanStyled(totRow, 0, spanCount - 1, totText);
  }
  rows.push(totRow);
  rowHeights.push(22);
  if (spanCount > 1) merges.push({ r1: rows.length - 1, c1: 0, r2: rows.length - 1, c2: spanCount - 1 });

  return {
    name: accountName,
    rows,
    cols: cols.map(c => c.width),
    rowHeights,
    merges,
    freezeRows: HEADER_ROWS,
    styles: bag.styles,
  };
};

/**
 * 파일명 규칙: `YYMMDD_계좌명` (예: '260827_퇴직연금 820').
 * ⚠️ 날짜는 반드시 KST 기준 'YYYY-MM-DD' 문자열에서 잘라낸다 — `new Date()`의 UTC 파생값을
 *    쓰면 KST 00:00~09:00에 파일명이 하루 밀린다(CLAUDE.md의 UTC/KST 규약).
 */
export const portfolioExcelFileName = (dateKST: string, accountName: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKST || '').trim());
  const yymmdd = m ? `${m[1].slice(2)}${m[2]}${m[3]}` : '';
  const name = String(accountName || '').trim() || '포트폴리오';
  return (yymmdd ? `${yymmdd}_${name}` : name) + '.xlsx';
};

/** 시트 모델 → .xlsx 바이트. */
export const buildPortfolioXlsx = (input: PortfolioExcelInput, modDate?: Date): Uint8Array =>
  buildXlsx(buildPortfolioSheet(input), modDate);

/** 화면 버튼이 부르는 진입점. 파일명·바이트 생성 + 브라우저 다운로드. */
export const downloadPortfolioXlsx = (input: PortfolioExcelInput): void => {
  downloadXlsx(portfolioExcelFileName(input.dateKST, input.accountName), buildPortfolioXlsx(input));
};
