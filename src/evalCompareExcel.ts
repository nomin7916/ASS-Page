// ── 자산검증 두 날짜 비교 → 엑셀 시트 모델 ──────────────────────────────────
// 사용자가 손으로 만들던 4블록 시트(① 기준일 ② 비교일 ③ 증감 ④ 반사실)를 그대로 만든다.
//
// ⚠️ import에 `.ts` 확장자를 쓴 것은 의도다 — `scripts/verify-compare.mjs`가 **미러 없이
//    직접 import**해 검증한다(`portfolioExcel.ts`와 같은 규약). 지우면 Node ESM이
//    `ERR_MODULE_NOT_FOUND`로 죽어 검증이 통째로 사라진다.
// ⚠️ 시트는 **1장**이다 — `buildXlsx`가 단일 시트 고정이라 `xlsxWriter.ts`를 건드리지 않는다.
// ⚠️ 저장·네트워크 금지(순수 파생 + 다운로드).
import { buildXlsx, downloadXlsx } from './xlsxWriter.ts';
import type { XlsxCell, XlsxMerge, XlsxSheet, XlsxStyle } from './xlsxWriter.ts';
import { FMT, StyleBag } from './portfolioExcel.ts';
import { buildEvalCompare, diffOf, diffRateOf, perShareValueOf } from './evalCompare.ts';
import type { EvalCompareInput, EvalCompareResult, EvalCompareRow, EvalCompareSide } from './evalCompare.ts';

// 표시용 색상. `portfolioExcel.ts`의 팔레트와 같은 값이지만 **계약이 아니라 표현 상수**라
// 복제해도 드리프트 피해가 없다(그쪽은 미export 지역 상수).
const C = {
  titleFg: '0F172A',
  subFg: '64748B',
  headBg: '1E293B',
  headFg: 'E2E8F0',
  capBasis: 'E0ECFF',   // ① 기준일
  capCompare: 'EAF3E4', // ② 비교일
  capDiff: 'FDE8E8',    // ③ 증감
  capCounter: 'F3E8FF', // ④ 반사실
  cashBg: 'F1F5F9',
  totalBg: 'E2E8F0',
  noteFg: '475569',
  warnBg: 'FEF3C7',
  warnFg: '92400E',
  gainFg: 'B91C1C',
  lossFg: '1D4ED8',
};

// 부호 있는 서식(본문 행) — 화면 규약과 같이 이익 빨강 / 손실 파랑, 0은 파랑.
// ⚠️ TOTAL 행만 0이 빨강(`FMT.*SignedPos`) — 두 규칙을 통일하지 말 것(portfolioExcel과 동일).
const FMT_NUM_SIGNED = '[Red]#,##0.###;[Blue]-#,##0.###;[Blue]0';
const FMT_QTY_SIGNED = '[Red]#,##0.########;[Blue]-#,##0.########;[Blue]0';
const FMT_PER_SHARE = '#,##0.####';
const FMT_PER_SHARE_USD = '"$"#,##0.####';
const FMT_PER_SHARE_SIGNED = '[Red]#,##0.####;[Blue]-#,##0.####;[Blue]0';
const FMT_PER_SHARE_USD_SIGNED = '[Red]"$"#,##0.####;[Blue]-"$"#,##0.####;[Blue]"$"0';

const S = (v: string, s?: number): XlsxCell => ({ t: 's', v, s });
const N = (v: number, s?: number): XlsxCell => ({ t: 'n', v, s });

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → 'YYYY-MM-DD (목)'. ⚠️ UTC 산술이라 로컬 타임존이 결과를 흔들지 않는다. */
export const dateLabel = (d: string): string => {
  const s = String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const w = WEEK[new Date(s + 'T00:00:00Z').getUTCDay()] || '';
  return w ? `${s} (${w})` : s;
};

/** 퍼센트·비율은 유한한 값일 때만 쓴다(∞·NaN을 셀에 넣으면 Excel이 파일을 거부한다). */
const ratioOrNull = (v: number | null | undefined): number | null =>
  (v == null || !Number.isFinite(v)) ? null : Number(v.toPrecision(12));

/**
 * 그 날짜에 **보유하지 않았으면 0**(=보유 없음이라는 확정 사실),
 * 보유했지만 값을 모르면 **null**(=빈 셀). 증감 계산의 유일한 진입점이다.
 * ⚠️ 둘을 뭉뚱그리면 "매도로 −전량"과 "데이터 없음"이 같은 칸이 된다.
 */
const heldOr0 = (side: EvalCompareSide | null | undefined, pick: (s: EvalCompareSide) => number | null): number | null => {
  if (!side || !side.held) return 0;
  return pick(side);
};

/**
 * 주당분배금 값. ⚠️ 판정은 모델과 **같은 함수**(`perShareValueOf`)로 한다 —
 * 사용자가 직접 넣은 `0`은 '분배 없음' 확정이고 빈칸(모름)과 다르다.
 */
const perShareOrNull = (side: EvalCompareSide | null | undefined): number | null =>
  side ? perShareValueOf(side.perShare) : null;

export interface EvalCompareExcelInput extends EvalCompareInput {
  /** 계좌명(시트명·파일명·제목) */
  accountName: string;
  /** 이미 만들어 둔 모델이 있으면 그대로 쓴다(화면 요약과 **같은 값**을 보장). */
  result?: EvalCompareResult | null;
}

interface Col { key: string; label: string; width: number }
type BlockKind = 'basis' | 'compare' | 'diff' | 'counter';

/**
 * 4블록 단일 시트 모델.
 *
 * ⚠️ 네 블록이 **같은 열 집합**을 쓴다(라벨만 다름) — 세로로 눈이 따라가야 하기 때문.
 * ⚠️ 미입력·산출 불가는 **0이 아니라 빈 셀**이다. 특히 분배금·반사실은 '데이터 없음'이
 *    정상 상태라 0으로 누르면 "분배금 0원"을 단언하게 된다.
 * ⚠️ 퍼센트는 분수 + `%` 서식(원시 퍼센트에 리터럴 '%'를 붙이면 셀을 더했을 때 300%가 된다).
 * ⚠️ 병합 범위에서 덮이는 칸을 null로 두면 배경·테두리가 첫 칸에서 끊긴다 → 같은 스타일 빈 셀로 채운다.
 * ⚠️ 해외계좌의 ③(증감) 블록에는 **원화 열을 만들지 않는다** — 종목·수량이 완전히 같아도
 *    두 날짜 환율이 다르면 원화 차이가 생겨 '가짜 손익'을 단언하게 된다(CLAUDE.md 해외 규약).
 */
export const buildEvalCompareSheet = (input: EvalCompareExcelInput): XlsxSheet => {
  const model = input.result || buildEvalCompare(input);
  const accountName = String(input.accountName || '').trim() || '계좌';
  const isOverseas = !!model.isOverseas;
  const money = isOverseas ? FMT.usd : FMT.krw;
  const moneySigned = isOverseas ? FMT.usdSigned : FMT.krwSigned;
  const moneySignedPos = isOverseas ? FMT.usdSignedPos : FMT.krwSignedPos;
  const priceFmt = isOverseas ? FMT.usd : FMT.num;
  const priceSigned = isOverseas ? FMT.usdSigned : FMT_NUM_SIGNED;
  const perShareFmt = isOverseas ? FMT_PER_SHARE_USD : FMT_PER_SHARE;
  const perShareSigned = isOverseas ? FMT_PER_SHARE_USD_SIGNED : FMT_PER_SHARE_SIGNED;
  const fxB = model.fxBasis > 0 ? model.fxBasis : 1;
  const fxC = model.fxCompare > 0 ? model.fxCompare : 1;

  // ⚠️ 해외계좌: 주 열은 **USD**(모델의 `evalNative`)이고 `(₩)` 동반 열은 그 날짜 환율로 환산된
  //    레벨 값이다(`portfolioExcel`과 같은 규약 — 정보 손실 0). 증감 블록에는 채우지 않는다.
  const cols: Col[] = [
    { key: 'name', label: '종목명', width: 34 },
    { key: 'code', label: '코드', width: 14 },
    { key: 'price', label: isOverseas ? '종가($)' : '종가', width: 13 },
    { key: 'purchase', label: isOverseas ? '구매단가($)' : '구매단가', width: 13 },
    { key: 'qty', label: '보유수량', width: 12 },
    { key: 'invest', label: isOverseas ? '투자금액($)' : '투자금액', width: 16 },
    { key: 'eval', label: isOverseas ? '평가금액($)' : '평가금액', width: 17 },
    ...(isOverseas ? [{ key: 'evalKrw', label: '평가금액(₩)', width: 18 }] : []),
    { key: 'ratio', label: '평가비중', width: 11 },
    { key: 'div', label: isOverseas ? '분배금($)' : '분배금', width: 15 },
    { key: 'perShare', label: isOverseas ? '주당분배금($)' : '주당분배금', width: 13 },
  ];
  const colIndex = new Map<string, number>();
  cols.forEach((c, i) => colIndex.set(c.key, i));
  const nCols = cols.length;

  const bag = new StyleBag();
  const rows: XlsxCell[][] = [];
  const merges: XlsxMerge[] = [];
  const rowHeights: (number | undefined)[] = [];

  const blank = (): XlsxCell[] => new Array(nCols).fill(null);
  const put = (row: XlsxCell[], key: string, cell: XlsxCell) => {
    const i = colIndex.get(key);
    if (i !== undefined) row[i] = cell;
  };
  const spanStyled = (row: XlsxCell[], c1: number, c2: number, styleId: number) => {
    for (let c = c1 + 1; c <= c2 && c < row.length; c++) row[c] = S('', styleId);
  };
  const pushRow = (row: XlsxCell[], h?: number): number => { rows.push(row); rowHeights.push(h); return rows.length - 1; };
  const bannerRow = (text: string, styleId: number, h?: number) => {
    const row = blank();
    row[0] = S(text, styleId);
    spanStyled(row, 0, nCols - 1, styleId);
    const r = pushRow(row, h);
    if (nCols > 1) merges.push({ r1: r, c1: 0, r2: r, c2: nCols - 1 });
  };

  const mk = (extra: XlsxStyle, bg?: string) => bag.id({ ...extra, bg, border: true });
  const textC = (bg?: string) => mk({ align: 'center' }, bg);
  const numR = (fmt: string, bg?: string) => mk({ numFmt: fmt, align: 'right' }, bg);
  const numC = (fmt: string, bg?: string) => mk({ numFmt: fmt, align: 'center' }, bg);

  const titleStyle = bag.id({ bold: true, size: 15, color: C.titleFg, align: 'left' });
  const subStyle = bag.id({ size: 9, color: C.subFg, align: 'left' });
  const warnStyle = bag.id({ size: 9, bold: true, color: C.warnFg, bg: C.warnBg, align: 'left' });
  const noteStyle = bag.id({ size: 9, color: C.noteFg, align: 'left' });
  const headStyle = bag.id({ bold: true, color: C.headFg, bg: C.headBg, align: 'center', border: true, wrap: true });

  const amt = (n: number): string => (isOverseas
    ? `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : `${n < 0 ? '-' : ''}₩${Math.abs(Math.round(n)).toLocaleString('en-US')}`);

  // ── 제목 / 부제 ───────────────────────────────────────────────────────────
  bannerRow(`${accountName} · 자산검증 비교`, titleStyle, 24);
  bannerRow(
    `기준일 ${dateLabel(model.basisDate)}   ·   비교일 ${dateLabel(model.compareDate)}` +
    (isOverseas ? `   ·   적용환율 기준일 ₩${Math.round(fxB).toLocaleString('en-US')} / 비교일 ₩${Math.round(fxC).toLocaleString('en-US')}` : ''),
    subStyle,
  );

  // ── 신뢰도 경고 ───────────────────────────────────────────────────────────
  // ⚠️ 조용히 확정하지 말 것 — 추정 수량이면 '수량 증감'이, 종가 미확보면 총액·거래 효과가 거짓이 된다.
  const warns: string[] = [];
  if (model.estimatedBasis) warns.push(`기준일 ${model.basisDate}의 보유수량이 추정입니다(그 날짜의 보유 스냅샷이 없어 현재 구성으로 대체) — 수량 증감이 실제와 다를 수 있습니다`);
  if (model.estimatedCompare) warns.push(`비교일 ${model.compareDate}의 보유수량이 추정입니다(그 날짜의 보유 스냅샷이 없어 현재 구성으로 대체) — 수량 증감이 실제와 다를 수 있습니다`);
  if (model.totals.basis.priceMissing || model.totals.counter.priceMissing) warns.push(`기준일 ${model.basisDate}의 종가를 구하지 못한 보유 종목이 있습니다 — 그 행의 평가금액은 비어 있고 합계도 그만큼 작습니다(거래 효과는 산출하지 않습니다)`);
  if (model.totals.compare.priceMissing) warns.push(`비교일 ${model.compareDate}의 종가를 구하지 못한 보유 종목이 있습니다 — 그 행의 평가금액은 비어 있고 합계도 그만큼 작습니다`);
  if (!model.allExactBasis) warns.push(`기준일 ${model.basisDate}에 그 날짜의 정확한 종가가 없어 근사값(직전/직후 거래일)이 섞인 종목이 있습니다`);
  if (!model.allExactCompare) warns.push(`비교일 ${model.compareDate}에 그 날짜의 정확한 종가가 없어 근사값(직전/직후 거래일)이 섞인 종목이 있습니다`);
  // ⚠️ ④ 반사실 전용 경고 — 기준일에 이미 매도한 종목의 종가는 수집 대상이 아니라
  //    ①②가 둘 다 exact인데 ④만 근사인 상황이 실제로 생긴다(빠뜨리면 경고가 0개가 된다).
  if (!model.allExactCounter && model.allExactBasis) warns.push('④ 반사실 평가에서 기준일 종가가 근사값인 종목이 있습니다(기준일에는 보유하지 않아 종가를 정확히 못 구한 종목)');
  if (model.netFlow !== 0) warns.push(`이 기간에 순입출금 ${amt(model.netFlow)}이 있습니다 — ③의 증감·증감율에는 그 금액이 포함돼 있어 추이 표의 기간 수익률과 다릅니다(거래 효과에서는 제외했습니다)`);
  // ⚠️ 원장 입금일과 예수금 반영일이 어긋나는 것은 구조적 정상이다 — 그 구간에서 순흐름을 그대로
  //    빼면 입금액 전액이 가짜 손실이 된다. 장부액 관측이 그 상태를 잡아낸다.
  if (!model.flowReflected) {
    warns.push(`원장의 입출금(${amt(model.netFlow)})이 아직 평가액·예수금에 반영되지 않은 것으로 보입니다`
      + (model.bookDelta != null ? ` (장부액 변화 ${amt(model.bookDelta)})` : ' (보유수량이 추정이라 확인 불가)')
      + ' — 거래 효과는 산출하지 않습니다');
  }
  if (model.totals.basis.dividendPartial || model.totals.compare.dividendPartial || model.totals.counter.dividendPartial) {
    warns.push('주당분배금을 알 수 없는 보유 종목이 있어 분배금 합계에서 빠졌습니다 — 자산검증 창에서 직접 입력하면 반영됩니다');
  }
  warns.forEach(w => bannerRow(`⚠ ${w}`, warnStyle));

  // ── 블록 ──────────────────────────────────────────────────────────────────
  const headerFor = (kind: BlockKind): string[] => cols.map(c => {
    if (kind === 'counter' && c.key === 'ratio') return '평가금 증감율';
    if (kind !== 'diff') return c.label;
    switch (c.key) {
      case 'name': return '종목명';
      case 'code': return '코드';
      case 'price': return '종가 차익';
      case 'purchase': return '구매단가 증감';
      case 'qty': return '수량 증감';
      case 'invest': return '투자금액 증감';
      case 'eval': return isOverseas ? '평가금액 증감($)' : '평가금액 증감';
      case 'evalKrw': return '—'; // ⚠️ 환율 시점이 섞여 가짜 손익이 되므로 비운다
      case 'ratio': return '평가금 증감율';
      case 'div': return isOverseas ? '분배금 증감($)' : '분배금 증감';
      case 'perShare': return '주당분배금 증감';
      default: return c.label;
    }
  });

  const sideOf = (row: EvalCompareRow, kind: BlockKind): EvalCompareSide | null =>
    kind === 'basis' ? row.basis : kind === 'compare' ? row.compare : row.counter;

  /**
   * 블록별 표시 행 (사용자 확정 2026-08).
   *  ①②④ = 그 블록이 평가하는 날짜에 **보유한 종목만** / ③ = **양쪽 모두 보유**한 종목만.
   * 그 전에는 네 블록이 같은 합집합을 돌아, 그날 보유하지 않은 종목이 `probePrice`가 채운
   * 종가 하나만 달고 행으로 나왔다 — 자산검증 창과 행이 어긋나 대조가 불가능했다(사용자 보고).
   *
   * ⚠️ 기준은 `held`가 아니라 **`present`**다. `held`는 평가 detail 진입 여부라 **수량 0 주식**이
   *    false인데, 그 행은 자산검증 화면에 그대로 보인다(→ 화면에 있는 행이 시트에서 사라진다).
   * ⚠️ 'diff'를 반드시 **앞에서** 분기할 것 — `sideOf(row,'diff')`는 `row.basis`가 아니라
   *    `row.counter`를 돌려주므로, 한 줄로 통일하면 ③ 필터가 `compare.present`가 되어
   *    '신규 편입은 사라지고 전량 매도는 남는' **사양과 정반대**가 된다(값은 diffOf로 계산돼
   *    숫자가 그럴듯하게 나오므로 조용히 통과한다).
   */
  const includeRow = (row: EvalCompareRow, kind: BlockKind): boolean =>
    kind === 'diff'
      ? (!!row.basis?.present && !!row.compare?.present)
      : !!sideOf(row, kind)?.present;

  // ③에서 빠지는 종목(한쪽에만 있음) — 아래 집계 행과 캡션 고지가 이 값을 쓴다.
  const onlyBasisRows = model.rows.filter(r => r.basis?.present && !r.compare?.present);
  const onlyCompareRows = model.rows.filter(r => !r.basis?.present && r.compare?.present);

  const emitBlock = (kind: BlockKind, caption: string, capBg: string) => {
    bannerRow(caption, bag.id({ bold: true, size: 11, color: C.titleFg, bg: capBg, align: 'left' }), 20);
    pushRow(headerFor(kind).map(l => S(l, headStyle)), 22);

    const isDiff = kind === 'diff';
    const shown = model.rows.filter(r => includeRow(r, kind));
    for (const row of shown) {
      const bg = row.type === 'deposit' ? C.cashBg : undefined;
      const out = blank();
      put(out, 'name', S(row.name, mk({ align: 'left' }, bg)));
      put(out, 'code', S(row.code || '', textC(bg)));

      const setNum = (key: string, v: number | null, fmt: string, align: 'right' | 'center' = 'right') => {
        if (v == null || !Number.isFinite(v)) return; // ⚠️ 빈 셀(0으로 단언 금지)
        put(out, key, N(v, align === 'right' ? numR(fmt, bg) : numC(fmt, bg)));
      };

      if (!isDiff) {
        const side = sideOf(row, kind);
        if (side) {
          setNum('price', side.price, priceFmt);
          setNum('purchase', side.purchasePrice, isOverseas ? FMT.usd : FMT.int);
          setNum('qty', side.held ? side.quantity : null, FMT.qty, 'center');
          setNum('invest', side.held ? side.investAmount : null, isOverseas ? FMT.usd : FMT.krw);
          setNum('eval', side.evalNative, money);
          if (isOverseas) setNum('evalKrw', side.evalAmount, FMT.krw);
          if (kind === 'counter') {
            // ④의 '평가금 증감율' = 그 종목을 그대로 들고 있었을 때의 **순수 시세 변동**
            //    (수량이 같으므로 ③의 증감율과 달리 매매 효과가 섞이지 않는다).
            setNum('ratio', ratioOrNull(diffRateOf(heldOr0(side, s => s.evalNative), heldOr0(row.compare, s => s.evalNative))), FMT.pctSigned, 'center');
          } else {
            setNum('ratio', ratioOrNull(side.ratio), FMT.pct, 'center');
          }
          setNum('div', side.held ? side.dividend : null, isOverseas ? FMT.usd : FMT.krw);
          setNum('perShare', perShareOrNull(side), perShareFmt, 'center');
        }
      } else {
        const a = row.basis, b = row.compare;
        setNum('price', diffOf(a?.price ?? null, b?.price ?? null), priceSigned);
        setNum('purchase', diffOf(a?.purchasePrice ?? null, b?.purchasePrice ?? null), isOverseas ? FMT.usdSigned : FMT_NUM_SIGNED);
        setNum('qty', diffOf(heldOr0(a, s => s.quantity), heldOr0(b, s => s.quantity)), FMT_QTY_SIGNED, 'center');
        setNum('invest', diffOf(heldOr0(a, s => s.investAmount), heldOr0(b, s => s.investAmount)), moneySigned);
        const evA = heldOr0(a, s => s.evalNative), evB = heldOr0(b, s => s.evalNative);
        setNum('eval', diffOf(evA, evB), moneySigned);
        setNum('ratio', ratioOrNull(diffRateOf(evA, evB)), FMT.pctSigned, 'center');
        setNum('div', diffOf(heldOr0(a, s => s.dividend), heldOr0(b, s => s.dividend)), moneySigned);
        setNum('perShare', diffOf(perShareOrNull(a), perShareOrNull(b)), perShareSigned, 'center');
      }
      pushRow(out);
    }

    // ── ③ 집계 행 (한쪽에만 있는 종목) ───────────────────────────────────────
    // ⚠️ 이 두 줄은 **선택이 아니라 필수**다. ③ TOTAL은 편입·매도까지 포함한 전체 차이
    //    (`model.diffEval` 등)인데 본문은 교집합만 그리므로, 없으면 '행 합 ≠ TOTAL'이 된다.
    //    그러면 같은 TOTAL 행 안에서 분배금만 '행이 못 받치면 비운다'(아래 dividendPartial
    //    게이트)이고 평가금액·투자금액·증감율은 '행이 못 받쳐도 단언한다'가 되어 규약이 갈린다
    //    (실측: 표시 행 합 +33,762,029 vs TOTAL −90,846,821 — 부호까지 반대).
    // ⚠️ 서로 다른 종목의 합이라 수량·종가·구매단가·증감율·주당분배금은 채우지 않는다.
    let aggEval = 0;
    if (isDiff && (onlyBasisRows.length || onlyCompareRows.length)) {
      const aggStyle = bag.id({ align: 'left', bg: C.cashBg, border: true, italic: true, color: C.noteFg });
      // ⚠️ null(종가 미확보 등)은 0으로 더한다 — TOTAL을 만드는 `calcPortfolioEvalDetail`도 그
      //    항목을 0으로 더하므로, 그래야 '집계 행 + 본문 = TOTAL' 항등식이 성립한다.
      type AggKey = 'evalNative' | 'investAmount' | 'dividend';
      const sumOf = (arr: EvalCompareRow[], side: 'basis' | 'compare', key: AggKey): number =>
        arr.reduce((s, r) => {
          const v = r[side] ? r[side]![key] : null;
          return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        }, 0);
      const emitAgg = (label: string, arr: EvalCompareRow[], side: 'basis' | 'compare', sign: 1 | -1) => {
        if (!arr.length) return;
        const out = blank();
        out[0] = S(label, aggStyle);
        put(out, 'code', S('', mk({ align: 'center' }, C.cashBg)));
        const ev = sign * sumOf(arr, side, 'evalNative');
        aggEval += ev;
        put(out, 'invest', N(sign * sumOf(arr, side, 'investAmount'), numR(moneySigned, C.cashBg)));
        put(out, 'eval', N(ev, numR(moneySigned, C.cashBg)));
        if (isOverseas) put(out, 'evalKrw', S('', mk({ align: 'center' }, C.cashBg)));
        // 분배금은 TOTAL과 같은 규약 — 한쪽이라도 '주당분배금 미확인'이면 합계를 단언하지 않는다.
        const partial = model.totals.basis.dividendPartial || model.totals.compare.dividendPartial;
        if (!partial) put(out, 'div', N(sign * sumOf(arr, side, 'dividend'), numR(moneySigned, C.cashBg)));
        for (let i = 0; i < nCols; i++) if (out[i] === null) out[i] = S('', mk({ align: 'center' }, C.cashBg));
        pushRow(out);
      };
      emitAgg(`신규 편입 (${onlyBasisRows.length}종목) — 비교일에는 없던 종목`, onlyBasisRows, 'basis', 1);
      emitAgg(`전량 매도·이관 (${onlyCompareRows.length}종목) — 기준일에는 없는 종목`, onlyCompareRows, 'compare', -1);
    }

    // ── 빈 블록 안내 ────────────────────────────────────────────────────────
    // ⚠️ 안내가 없으면 캡션+헤더+TOTAL만 남아, 표시할 근거가 하나도 없는데 TOTAL에만 숫자가
    //    덩그러니 찍힌다(그 상태는 '시트가 깨졌다'로 읽힌다).
    if (!shown.length && !aggEval && !(isDiff && (onlyBasisRows.length || onlyCompareRows.length))) {
      const emptyStyle = bag.id({ align: 'left', color: C.noteFg, border: true, italic: true });
      const out = blank();
      out[0] = S(isDiff ? '— 두 날짜 모두 보유한 종목이 없습니다 —' : '— 이 날짜에 보유한 종목이 없습니다 —', emptyStyle);
      spanStyled(out, 0, nCols - 1, emptyStyle);
      pushRow(out);
    }

    // ── TOTAL ──────────────────────────────────────────────────────────────
    const totText = bag.id({ bold: true, align: 'center', bg: C.totalBg, color: C.titleFg, border: true });
    const totNum = (fmt: string) => bag.id({ bold: true, numFmt: fmt, align: 'right', bg: C.totalBg, border: true });
    const totPct = (fmt: string) => bag.id({ bold: true, numFmt: fmt, align: 'center', bg: C.totalBg, border: true });
    const tot = blank();
    const labelSpan = Math.min(2, nCols); // 종목명 + 코드
    tot[0] = S('TOTAL', totText);
    spanStyled(tot, 0, labelSpan - 1, totText);
    for (let i = labelSpan; i < nCols; i++) tot[i] = S('', totText);
    const putT = (key: string, cell: XlsxCell) => { const i = colIndex.get(key); if (i !== undefined) tot[i] = cell; };

    if (!isDiff) {
      const t = kind === 'basis' ? model.totals.basis : kind === 'compare' ? model.totals.compare : model.totals.counter;
      putT('invest', N(t.investAmount, totNum(isOverseas ? FMT.usd : FMT.krw)));
      putT('eval', N(t.evalNative, totNum(money)));
      if (isOverseas) putT('evalKrw', N(t.evalAmount, totNum(FMT.krw)));
      if (kind === 'counter') {
        // ④ TOTAL의 증감율 = (반사실 총액 − 비교일 총액) ÷ 비교일 총액.
        //    ③ TOTAL의 증감율(실제)과 나란히 읽는 것이 이 시트의 결론이다.
        const r = ratioOrNull(model.counterRate);
        if (r != null) putT('ratio', N(r, totPct(FMT.pctSignedPos)));
      } else if (shown.length) {
        // ⚠️ 표시 행이 0건이면 '평가비중 100%'를 단언하지 않는다 — 같은 빈 블록인데도 ④는
        //    counterRate가 null이라 빈 칸이고 ①②만 100%가 찍히는 비대칭이 생긴다.
        putT('ratio', N(1, totPct(FMT.pctInt)));
      }
      if (t.dividend > 0) putT('div', N(t.dividend, totNum(isOverseas ? FMT.usd : FMT.krw)));
    } else {
      const b = model.totals.basis, c = model.totals.compare;
      putT('invest', N(b.investAmount - c.investAmount, totNum(moneySignedPos)));
      putT('eval', N(model.diffEval, totNum(moneySignedPos)));
      const r = ratioOrNull(model.diffRate);
      if (r != null) putT('ratio', N(r, totPct(FMT.pctSignedPos)));
      // ⚠️ 한쪽이라도 '주당분배금 미확인' 종목을 품고 있으면 두 부분합의 차는 임의로 틀릴 수 있다 —
      //    행은 빈 칸인데 합계만 숫자를 단언하면 각주('빈 칸은 0이 아니다')와 정면으로 어긋난다.
      if (!b.dividendPartial && !c.dividendPartial && (b.dividend > 0 || c.dividend > 0)) {
        putT('div', N(b.dividend - c.dividend, totNum(moneySignedPos)));
      }
    }
    pushRow(tot, 22);
  };

  emitBlock('basis', `① 기준일  ${dateLabel(model.basisDate)}  —  그날 보유수량 × 그날 종가`, C.capBasis);
  pushRow(blank());
  emitBlock('compare', `② 비교일  ${dateLabel(model.compareDate)}  —  그날 보유수량 × 그날 종가`, C.capCompare);
  pushRow(blank());
  // ⚠️ 고지는 **캡션·각주**에만 둔다 — 위 `warns`는 '값을 믿을 수 없다'는 신뢰도 경고 전용
  //    채널(⚠ + 앰버)이라, 정상 거래에서 상시 발동하는 이 문구를 거기 넣으면 진짜 경고가 묻힌다.
  emitBlock('diff',
    '③ 증감  (기준일 − 비교일)  ·  증감율 = 증감 ÷ 비교일  —  두 날짜 모두 보유한 종목만'
    + ((onlyBasisRows.length || onlyCompareRows.length)
      ? `  (한쪽에만 있는 ${onlyBasisRows.length + onlyCompareRows.length}종목은 아래 집계 행으로 합산 — 개별 종목은 ①②④에서 확인)`
      : ''),
    C.capDiff);
  pushRow(blank());
  emitBlock('counter', '④ 비교일 수량 × 기준일 종가  —  거래하지 않고 그대로 들고 있었다면', C.capCounter);

  // ── 거래 효과 (④ 바로 아래 캡션 1줄 — 별도 요약 블록을 만들지 않는다) ────
  // ⚠️ 순 외부 입출금을 빼지 않으면 입금액이 통째로 '거래 성과'로 단언된다.
  // ⚠️ 기준일 종가를 못 구한 보유 종목이 있으면 숫자를 내지 않는다(명시적 미적용).
  const effStyle = bag.id({
    bold: true, size: 11,
    color: model.tradeEffect >= 0 ? C.gainFg : C.lossFg,
    bg: C.capCounter, align: 'left',
  });
  if (model.tradeEffectValid) {
    bannerRow(
      `거래 효과 = 실제 기준일 총액 − 반사실 총액${model.netFlow !== 0 ? ' − 순입출금' : ''} = ${amt(model.tradeEffect)}` +
      (model.netFlow !== 0 ? `   (순입출금 ${amt(model.netFlow)} 제외)` : '') +
      `   ·   분배금 차이 ${amt(model.tradeEffectDividend)}${model.tradeEffectDividendPartial ? ' (일부 종목 미확인)' : ''}` +
      (model.diffRate != null && model.counterRate != null
        ? `   ·   실제 ${(model.diffRate * 100).toFixed(2)}%  vs  반사실 ${(model.counterRate * 100).toFixed(2)}%`
        : ''),
      effStyle, 20,
    );
  } else {
    bannerRow(
      model.flowReflected
        ? '거래 효과 산출 불가 — 기준일 종가를 구하지 못한 보유 종목이 있어 총액이 과소합니다'
        : '거래 효과 산출 불가 — 원장의 입출금이 아직 평가액에 반영되지 않아 그 금액이 손익으로 잘못 잡힙니다',
      warnStyle, 20);
  }

  // ── 각주 ──────────────────────────────────────────────────────────────────
  pushRow(blank());
  const notes = [
    '· 평가금액은 저장된 값이 아니라 그 날짜의 보유수량 × 그 날짜 종가로 다시 계산한 값입니다.',
    '· ④는 비교일의 보유(예수금·펀드·예적금 포함)를 그대로 유지했다면 기준일에 얼마인가를 보여 줍니다. 구매단가·투자금액은 비교일 기준입니다.',
    '· ④의 종목별 증감율은 수량이 같으므로 순수 시세 변동이고, ③의 증감율에는 그 사이의 매매와 입출금이 함께 반영됩니다.',
    '· 거래 효과 = (실제 기준일 총액 − 반사실 총액) − 순 외부 입출금. 그 사이 계좌로 들어온 분배금·이자와 새로 넣은 자금의 운용 성과는 여기에 포함됩니다.',
    '· 분배금 = 보유수량 × 주당분배금(세전). 세금은 반영하지 않았습니다. ④의 주당분배금은 기준일 기준값을 씁니다.',
    '· 주당분배금 기본값은 그 날짜까지 확정(배당락 경과)된 가장 최근 회차이며, 자산검증 창에서 직접 입력한 값이 있으면 그 값을 사용합니다.',
    '· 증감율 = 증감 ÷ 비교일 값. 비교일 값이 0이거나 산출할 수 없으면 빈 칸으로 둡니다.',
    // ⚠️ 필터 도입으로 '그날 보유하지 않았거나'는 더 이상 빈 칸의 원인이 아니다(그 행 자체가 없다).
    //    그 문구를 두면 사용자가 빈 칸을 '미보유'로 읽어 진짜 원인(데이터 누락)을 놓친다.
    '· 빈 칸은 0이 아니라 "값 없음"입니다(그 날짜의 종가·주당분배금을 구하지 못했거나 입력값이 없음).',
    '· ①②④는 그 블록이 평가하는 날짜에 보유한 종목만, ③은 두 날짜 모두 보유한 종목만 표시합니다. 한쪽에만 있는 종목은 ③의 "신규 편입 / 전량 매도·이관" 집계 행으로 합산해 TOTAL과 맞춥니다.',
    '· 행 순서는 기준일 보유 순서입니다 — 자산검증 창의 종목 순서와 다를 수 있습니다. 같은 코드를 여러 줄로 나눠 보유하거나 예수금 행이 여럿이면 한 줄로 합쳐 표시합니다.',
    '· 전량 매도한 종목의 기준일 종가는 ④ 블록에서 볼 수 있습니다. 새로 편입한 종목의 "편입 전(비교일) 종가"는 표시하지 않습니다.',
  ];
  if (isOverseas) {
    notes.push(`· 해외계좌: 금액은 USD 기준이고 (₩) 열은 그 날짜 환율로 환산한 값입니다(기준일 ₩${Math.round(fxB).toLocaleString('en-US')} / 비교일 ₩${Math.round(fxC).toLocaleString('en-US')}).`);
    notes.push('· ③(증감)에는 원화 열을 두지 않습니다 — 종목과 수량이 같아도 두 날짜의 환율이 달라 원화 차이가 생기면 실제로는 없는 손익을 단언하게 되기 때문입니다.');
  }
  notes.forEach(n => bannerRow(n, noteStyle));

  return {
    name: accountName,
    rows,
    cols: cols.map(c => c.width),
    rowHeights,
    merges,
    freezeRows: 2,
    styles: bag.styles,
  };
};

/**
 * 파일명 `{비교일YYMMDD}-{기준일YYMMDD}_{계좌명}_비교.xlsx`.
 * ⚠️ 날짜는 반드시 인자로 받은 KST 날짜 문자열에서 잘라낸다 — `new Date()` 파생값을 쓰면
 *    KST 00:00~09:00에 하루 밀린다(CLAUDE.md의 UTC/KST 규약).
 */
export const evalCompareFileName = (compareDate: string, basisDate: string, accountName: string): string => {
  const yy = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '').trim());
    return m ? `${m[1].slice(2)}${m[2]}${m[3]}` : '';
  };
  const a = yy(compareDate), b = yy(basisDate);
  const name = String(accountName || '').trim() || '계좌';
  const head = a && b ? `${a}-${b}_` : (b ? `${b}_` : '');
  return `${head}${name}_비교.xlsx`;
};

export const buildEvalCompareXlsx = (input: EvalCompareExcelInput, modDate?: Date): Uint8Array =>
  buildXlsx(buildEvalCompareSheet(input), modDate);

/** 화면 버튼 진입점. 파일명·바이트 생성 + 브라우저 다운로드. */
export const downloadEvalCompareXlsx = (input: EvalCompareExcelInput): void => {
  downloadXlsx(
    evalCompareFileName(input.compareDate, input.basisDate, input.accountName),
    buildEvalCompareXlsx(input),
  );
};
