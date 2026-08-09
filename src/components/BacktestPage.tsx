// @ts-nocheck
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// ⚠️ 여기 있는 아이콘은 **이 저장소가 이미 쓰고 있어 lucide 0.577.0에 실재가 확인된 것**만이다.
//    package-lock.json도 node_modules도 없어 새 아이콘이 이 버전에 있는지 확인할 수단이 없고,
//    없으면 undefined 컴포넌트 렌더로 페이지가 통째로 죽는다(UserInfoBar FlowIcon 주석과 동일 근거).
//    특히 `AlertTriangle`은 lucide 0.4x에서 `TriangleAlert`로 개명됐다 → AlertCircle을 쓴다.
import {
  BarChart3, Plus, Trash2, FileText, ExternalLink, X, Download, RefreshCw,
  AlertCircle, ChevronDown, ChevronRight, HelpCircle, PanelLeft, PanelLeftClose,
} from 'lucide-react';
import {
  runBacktest, makeBtConfig, makeBtAsset, joinTradeDividends, parsePastedSeries,
  seriesRange, monthsBetween, backtestFingerprint, backtestSettingsFingerprint,
  BT_COLORS, DEFAULT_DIP_LEVELS, DEFAULT_SELL_LEVELS,
} from '../backtest';
// 소프트 상한 — ⚠️ 화면 maxLength는 backtest.ts 정규화와 **같은 값**을 써야 잘림이 사용자에게
//    보인다(정규화에서만 자르면 붙여넣은 분석의 뒤가 조용히 사라진다).
import {
  MAX_BT_SCENARIOS, MAX_BT_ASSETS, MAX_BT_EVENTS, MAX_BT_OVERRIDES, MAX_BT_CONTRIB_OVERRIDES,
  MAX_BT_REBAL_DATES, MAX_BT_DIP_LEVELS, MAX_BT_SELL_LEVELS,
  MAX_BT_NOTES, MAX_BT_NOTE_LEN, MAX_BT_NOTE_TITLE_LEN, MAX_BT_VERDICT_LEN,
} from '../backtest';
import { generateId, formatNumber, cleanNum } from '../utils';

/**
 * 리밸런싱 백테스트 페이지.
 *
 * ⚠️ 인앱 오버레이(variant='overlay')와 별도 브라우저 창(variant='page')이 **이 한 컴포넌트를
 *    공유**한다. 새 창용으로 표/설정을 복제하면 두 화면이 갈라진다(FlowBoard·CalendarModal 선례).
 *
 * ⚠️ 편집은 **로컬 사본**에 모으고 2.5초 idle·닫기·언마운트·종료커밋에만 상위로 승격한다.
 *    제스처(키 입력)마다 승격하면 App.tsx portfolioStructureKey가 전 계좌를 매번 재직렬화하고
 *    800ms 디바운스가 매번 만료되어 **글자마다 STATE+VERSION+STOCK+MARKET 4파일 write**가
 *    나간다(FlowBoard가 정확히 이 사고를 겪었다).
 *
 * ⚠️ 조회한 종가는 절대 stockHistoryMap에 병합하지 않는다 — 그 맵은 buildCloseEvalSeries(보유
 *    평가액 재계산)와 useAutoConfirmHistory 데이터완비 가드의 권위 소스라, 백테스트용 수정주가가
 *    섞이면 보유+백테스트 중복 코드의 과거 평가액이 영구히 오염된다(WatchlistPopup 불변식과 동일).
 */

const IDLE_MS = 2500;
const RUN_DEBOUNCE_MS = 220;
/**
 * 승격한 값이 상위에서 되돌아오기를 기다리는 유예시간.
 * ⚠️ 별도 브라우저 창의 **낡은 에코**를 무시하기 위한 값이다(아래 pendingEchoRef 주석 참조).
 */
const ECHO_GRACE_MS = 12000;

const won = (n) => `₩${formatNumber(Math.round(cleanNum(n)))}`;
const wonSigned = (n) => {
  const v = Math.round(cleanNum(n));
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}₩${formatNumber(Math.abs(v))}`;
};
const qtyText = (n) => (Number.isInteger(n) ? formatNumber(n) : formatNumber(Math.round(n * 10000) / 10000));
const pctText = (n) => `${cleanNum(n) >= 0 ? '+' : '−'}${Math.abs(cleanNum(n)).toFixed(2)}%`;
/** 한국식 손익 색상 — 이익 red / 손실 blue */
const pnlCls = (n) => (cleanNum(n) > 0 ? 'text-red-400' : cleanNum(n) < 0 ? 'text-blue-400' : 'text-gray-400');

/**
 * 목표 기준 라벨 — 설정 배지·표제·비교 표·CSV가 같은 이름을 쓴다.
 *
 * ⚠️ 비중의 분모는 **종목 평가액 합계 하나로 고정**이다(사용자 정의 2026-08) — 분모를 고르던
 *    옛 드롭다운(RATIO_BASE_LABEL 4종)은 제거됐다. 되살리지 말 것.
 */
const TARGET_MODE_LABEL = {
  amount: '목표금액',
  ratio: '목표비중',
};

/** 리밸런싱 정책 라벨 — 설정 드롭다운·표제·비교 표가 같은 이름을 쓴다. */
const POLICY_LABEL = {
  perCycle: '종목별 · 자기 분배락 전',
  allMid: '일괄 · 월중 분배락 전',
  allEom: '일괄 · 월말 분배락 전',
  fixedDay: '일괄 · 매월 지정일',
  none: '리밸런싱 안 함',
};

/** 분배금 처리 라벨. */
const DIV_REINVEST_LABEL = {
  hold: '현금 보유',
  payDate: '지급일 재매수',
  mid: '월중 매수',
  eom: '월말 매수',
};

/** 분배금 재투자 배분 기준 라벨. */
const DIV_SPLIT_LABEL = {
  target: '목표 비중대로',
  source: '분배금 준 종목',
  even: '균등',
};

/** 정기 리밸런싱 매수 재원 라벨. */
const BUY_FUNDING_LABEL = {
  both: '예수금 전부',
  tradeOnly: '매매 예수금만',
};

/**
 * 전략 보조 규칙(밴드·재원·급락·바닥선·연간증액·원천징수)의 기본값 안전 접근자.
 *
 * ⚠️ `cfg.dip.enabled`처럼 곧바로 파고들지 말 것 — 이 파일은 `@ts-nocheck`라 컴파일러가
 *    막아 주지 않는데, 정규화를 우회한 config가 한 번이라도 들어오면 **렌더 중 TypeError**가
 *    루트 ErrorBoundary까지 올라가 화면이 통째로 오류 페이지가 된다(runBacktest는 try/catch로
 *    감싸여 있지만 **화면 렌더는 감싸여 있지 않다**).
 */
const dipOf = (cfg) => {
  const d = (cfg && cfg.dip) || null;
  // ⚠️ 하위 배열도 반드시 접근자에서 채운다 — 레거시 시나리오에는 sellLevels가 아예 없어
  //    `dipOf(cfg).sellLevels.map(...)`이 그대로 TypeError가 된다(위 주석의 사고 그대로).
  return {
    enabled: !!(d && d.enabled),
    levels: (d && Array.isArray(d.levels) && d.levels.length) ? d.levels : DEFAULT_DIP_LEVELS,
    sellLevels: (d && Array.isArray(d.sellLevels)) ? d.sellLevels : [],
    reallocate: !d || d.reallocate !== false,
  };
};
/**
 * 전역 지정일 안전 접근자.
 * ⚠️ 반드시 이걸 통해서만 읽는다 — 정규화를 우회한 config(별도 창 수신·구버전 브릿지)가 한 번이라도
 *    들어오면 `active.rebalDates.length`가 렌더 중 TypeError가 되고, @ts-nocheck라 컴파일러가 못 막아
 *    루트 ErrorBoundary까지 올라가 **화면이 통째로 오류 페이지**가 된다(dipOf와 같은 근거).
 */
const rebalDatesOf = (cfg) => (cfg && Array.isArray(cfg.rebalDates) ? cfg.rebalDates : []);
/** 시그널 리밸런싱이 실제로 일을 하는가(단계가 하나라도 있는가). */
const sigOn = (cfg) => {
  const d = dipOf(cfg);
  return d.enabled && (d.levels.length > 0 || d.sellLevels.length > 0);
};
const annualOf = (cfg) =>
  (cfg && cfg.annualReview) || { mode: 'none', value: 0, reserve: 0, everyMonths: 12, split: 'ratio' };
const numOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * 종목별 목표값 접근자 — "사용자가 이 칸에 값을 넣었는가"와 "그 값이 얼마인가"를 분리한다.
 *
 * ⚠️ `0`도 엄연한 입력이다(전량 청산 목표). `!a.targetAmount` 같은 truthy 판정으로 재면
 *    0을 '미입력'으로 오판해 '빈 종목에 잔여 채우기'가 그 칸을 덮어쓴다.
 */
const hasTargetOf = (asset, mode) =>
  typeof (mode === 'amount' ? asset?.targetAmount : asset?.targetRatio) === 'number';
const targetValOf = (asset, mode) => numOf(mode === 'amount' ? asset?.targetAmount : asset?.targetRatio);

/**
 * 켜져 있는 전략 보조 규칙만 짧게 나열한다 — 설정 배지·시나리오 부제·CSV가 같은 문구를 쓴다.
 * ⚠️ **기본값은 한 글자도 내보내지 않는다**. 안 쓰는 사람에게 6개 태그가 상시 붙으면
 *    "무엇을 켰는지"라는 이 표기의 목적이 사라진다.
 */
function strategyTags(cfg) {
  if (!cfg) return [];
  const out = [];
  const dip = dipOf(cfg);
  const ar = annualOf(cfg);
  if (numOf(cfg.band) > 0) out.push(`밴드 ±${formatNumber(cfg.band)}%`);
  if (cfg.buyFunding === 'tradeOnly') out.push('매매 예수금만');
  if (dip.enabled) {
    out.push(`시그널 매수 ${dip.levels.length}단계`);
    if (dip.sellLevels.length) out.push(`매도 ${dip.sellLevels.length}단계`);
    if (!dip.reallocate) out.push('재조정 끔');
  }
  if (numOf(cfg.cashFloorPct) > 0) out.push(`바닥선 ${formatNumber(cfg.cashFloorPct)}%`);
  if (ar.mode === 'pctOfSurplus' && numOf(ar.value) > 0) out.push(`${ar.everyMonths}개월 증액 ${formatNumber(ar.value)}%`);
  if (numOf(cfg.divTaxPct) > 0) out.push(`원천징수 ${formatNumber(cfg.divTaxPct)}%`);
  return out;
}

/* ── 시그널 1건을 사람이 읽는 문장으로 ────────────────────────────────────────
 * ⚠️ 화면(KPI 카드·월별 블록)과 CSV가 **같은 함수**를 쓴다 — 문구를 각자 만들면 같은 사건이
 *    화면과 파일에서 다르게 설명된다. 사용자 요청("‘개방’을 계산식과 금액으로 상세히")의 구현부다.
 * ========================================================================= */

/** `매수 1단계 −10%` / `매도 2단계 +20%` */
const sigLabel = (e) =>
  `${e.kind === 'sell' ? '매도' : '매수'} ${formatNumber(e.step)}단계 `
  + `${e.kind === 'sell' ? '+' : '−'}${formatNumber(e.level)}%`;

/** `고점 ₩27,825 → 종가 ₩23,595 (−15.2%)` — 실제 등락률까지 밝혀 '왜 지금 발동했는가'를 남긴다. */
const sigRefText = (e) => {
  const ref = numOf(e.ref);
  const pct = ref > 0 ? ((numOf(e.price) - ref) / ref) * 100 : 0;
  return `${e.kind === 'sell' ? '저점' : '고점'} ${won(e.ref)} → 종가 ${won(e.price)}`
    + ` (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`;
};

/** 그 시그널이 '목표까지'인가(= 단계 비율이 비어 있는가). */
const sigIsToTarget = (e) => e?.pctSum === null || e?.pctSum === undefined;

/**
 * 시그널의 **규모 계산식**. '얼마를 사고팔기로 했는가'와 그 밑변·비율을 그대로 적는다
 * (사용자가 금액만 보고는 비율이 먹은 건지 잔액이 모자란 건지 알 수 없다).
 *  매수 · 비율   → `매수 재원 ₩A × 34% = ₩B`
 *  매수 · 목표까지 → `목표까지 ₩B (재원 ₩A)`
 *  매도 · 비율   → `목표 초과분 ₩A × 30% = ₩B`
 *  매도 · 목표까지 → `목표 초과분 ₩A 전량`
 * ⚠️ 비율은 반드시 `pctSum` — 같은 종목의 여러 단계가 같은 날 겹치면 금액이 합이라, 단계별 `pct`로
 *    쓰면 `₩1,000,000 × 34% = ₩670,000` 같은 거짓 계산식이 된다(적대적 리뷰 확정 결함).
 */
const sigSizeText = (e, cfg) => {
  const toTarget = sigIsToTarget(e);
  const pct = numOf(e.pctSum);
  // ⚠️ `밑변 × 비율 = planned`는 **상한에 걸리지 않았을 때만** 참이다 — planned는 매수면 목표
  //    미달액에서, 매도면 초과분 전량에서 한 번 더 잘린다. 그대로 등호를 찍으면
  //    `₩60,000,000 × 100% = ₩6,000,000` 같은 **거짓 계산식**이 된다(적대적 리뷰 확정 결함).
  //    잘린 경우에는 곱의 결과를 그대로 보여 주고 어디서 잘렸는지를 이어 붙인다.
  const capped = (raw, capLabel) => (raw > numOf(e.planned) + 0.5
    ? `${won(raw)} → ${capLabel}에서 자름 = ${won(e.planned)}`
    : `${won(e.planned)}`);
  if (e.kind === 'sell') {
    return toTarget
      ? `목표 초과분 ${won(e.excessAt)} 전량`
      : `목표 초과분 ${won(e.excessAt)} × ${formatNumber(pct)}% = `
        + capped((numOf(e.excessAt) * pct) / 100, '초과분 전량');
  }
  const poolLabel = (cfg?.buyFunding || 'both') === 'tradeOnly'
    ? '매수 재원(매매 예수금)'
    : '매수 재원(예수금 + 적립 분배금)';
  return toTarget
    ? `목표까지 ${won(e.planned)} · ${poolLabel} ${won(e.poolAt)}`
    : `${poolLabel} ${won(e.poolAt)} × ${formatNumber(pct)}% = `
      + capped((numOf(e.poolAt) * pct) / 100, '목표 미달액');
};

/**
 * 매수 대금의 **출처 분해**. `매매 예수금 ₩120,000 + 적립 분배금 ₩642,005 = ₩762,005 투입`
 * ⚠️ `매매 예수금만` 모드에서는 적립 분배금 몫이 구조적으로 항상 0이라 그 항을 아예 빼고 적는다 —
 *    `+ 적립 분배금 ₩0`을 상시 렌더하면 "왜 0인가"를 매번 되묻게 만든다.
 */
const sigFundText = (e, cfg) =>
  (cfg?.buyFunding || 'both') === 'tradeOnly'
    ? `매매 예수금 ${won(e.tradeAmount)} 투입 (적립 분배금 미사용)`
    : `매매 예수금 ${won(e.fromTrade)} + 적립 분배금 ${won(e.used)} = ${won(e.tradeAmount)} 투입`;

/** 체결 결과 한 줄. 미체결이면 사유를 그대로 보여 준다(왜 0원인지 알 수 없는 것이 옛 화면의 문제였다). */
const sigOutcomeText = (e, cfg) => {
  if (!numOf(e.tradeQty)) return e.note || '체결 없음';
  if (e.kind === 'sell') return `${formatNumber(Math.abs(e.tradeQty))}주 매도 → 매매 예수금 +${won(e.tradeAmount)}`;
  return `${formatNumber(e.tradeQty)}주 매수 · ${sigFundText(e, cfg)}`;
};

/**
 * Section 배지용 축약 — ⚠️ 6개를 다 이어 붙이면 배지가 제목을 밀어낸다.
 *    Section 헤더의 배지 span은 `truncate`(white-space:nowrap)라 flex에서 min-width가 auto가 되어
 *    스스로 줄지 않는다. 태그 수 자체를 여기서 자른다.
 */
function strategyBadge(cfg) {
  const tags = strategyTags(cfg);
  if (!tags.length) return '사용 안 함 (기본)';
  return tags.length > 3 ? `${tags.slice(0, 3).join(' · ')} 외 ${tags.length - 3}` : tags.join(' · ');
}

/**
 * '전체 백테스트 비교 종합' 뷰를 가리키는 예약 id.
 * ⚠️ 시나리오 id는 generateId() 산출물이라 이 문자열과 절대 충돌하지 않는다.
 */
const COMPARE_ID = '__compare__';

const INPUT = 'bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none focus:border-sky-500 w-full';
const LABEL = 'text-[10px] text-gray-500 font-bold';
const BTN = 'px-2 py-1 rounded text-[11px] font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * 결과 표 셀 규격 — 사용자 요청(2026-08): 칸이 좁고 글씨가 작아 시뮬레이션 내용을 읽기 어렵다.
 * ⚠️ 키우는 것은 **화면뿐**이다 — 인쇄(A4 가로)는 아래 print CSS가 다시 9px/좁은 여백으로 되돌린다.
 *    12열짜리 월별 표가 한 장에 들어가야 하기 때문이다(그대로 인쇄하면 열이 잘려 판독 불가).
 */
const TBL = 'w-full text-[13px] bt-tbl';
const TH = 'px-3 py-2 font-bold whitespace-nowrap';
const TD = 'px-3 py-2.5';

/**
 * 호버 설명 팝오버.
 *
 * ⚠️ 반드시 `position: fixed` + getBoundingClientRect로 좌표를 잡는다 — 설정 패널이
 *    `overflow-y-auto`인데 CSS는 한 축만 지정해도 **다른 축이 auto로 계산**되므로, 일반
 *    absolute 툴팁은 패널 안에서 잘려 아예 보이지 않는다.
 * ⚠️ 스크롤·리사이즈가 나면 좌표가 낡으므로 즉시 닫는다(마우스가 요소 밖으로 나가지 않아
 *    mouseleave가 안 뜨는 경우가 있다).
 */
const POP_CLS = 'fixed z-[1200] rounded-lg border border-gray-600 bg-[#111a2b] shadow-2xl px-3 py-2 leading-relaxed bt-noprint';

/**
 * 팝오버 배치 스타일 — Hint와 SummaryCard가 **같은 함수**를 쓴다(손복제 금지).
 * maxHeight/overflowY가 빠지면 아래 useHoverPop의 상한이 화면에 반영되지 않는다.
 */
const popStyle = (pos) => ({
  left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.w,
  maxHeight: pos.maxH, overflowY: 'auto',
  // ⚠️ 스크롤 체이닝 차단 — 없으면 팝오버를 끝까지 굴린 다음 틱이 조상 스크롤러로 넘어가고,
  //    그 scroll 이벤트를 아래 캡처 리스너가 잡아 **읽던 팝오버가 닫히며 페이지까지 튄다**.
  //    maxH 초과분을 읽게 하는 것이 이 팝오버의 목적이라 마지막 화면에서 끊기면 안 된다.
  overscrollBehavior: 'contain',
});

/**
 * 팝오버 지연 닫기 유예(ms).
 *
 * 팝오버는 앵커의 **형제**라 마우스를 팝오버로 옮기는 순간 앵커의 onMouseLeave가 뜬다 —
 * 그래서 옛 코드에서는 팝오버 위로 갈 수가 없었고, 아래 '[data-bt-pop]' 스크롤 예외는
 * 마우스 경로에서 死코드였다(내용이 maxH를 넘으면 읽을 방법이 아예 없었다).
 *
 * ⚠️ 아래 4가지가 **한 세트**다 — 하나라도 빠지면 팝오버가 고착되거나 스스로 닫힌다:
 *    ① open()이 대기 중인 타이머를 **먼저 취소**(앵커를 잠깐 벗어났다 되돌아오면 예약된
 *       타이머가 그대로 발화해 '호버 중인데 닫힌 채'로 남는다 — 카드 간격이 8px이라 흔하다)
 *    ② 팝오버 onMouseEnter → enter(cancel)  ③ 팝오버 onMouseLeave → leave(close 재예약)
 *       (③이 빠지면 z-1200 패널이 화면에 영구 고착돼 아래 표의 클릭을 삼킨다)
 *    ④ scroll/resize·blur·Hint 클릭·언마운트는 closeNow(즉시) — 유예를 두면 잔상이 겹친다
 */
const POP_GRACE_MS = 140;

/**
 * 지금 열려 있는 팝오버의 closeNow. 열려 있는 팝오버는 화면에 **하나뿐**이어야 한다 —
 * 지연 닫기가 생기면서 인접 카드로 마우스를 옮기는 상시 동작에서 이전 팝오버가 140ms 남아
 * z-1200 패널 두 장이 겹친다(포커스+호버 조합으로는 지연 닫기 이전에도 겹칠 수 있었다).
 */
let closeOpenPop = null;

function useHoverPop(width = 320) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const timerRef = useRef(null);
  // 마우스가 팝오버 위에 있는지 — 앵커가 포커스를 쥔 채 팝오버 안을 클릭(드래그 선택)하면
  // focusout이 떠서 onBlur가 팝오버를 즉시 지워 버린다. 그때만 blur를 무시한다.
  const overRef = useRef(false);
  const cancel = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);
  const closeNow = useCallback(() => { cancel(); setPos(null); }, [cancel]);
  const close = useCallback(() => {
    cancel();
    timerRef.current = setTimeout(() => { timerRef.current = null; setPos(null); }, POP_GRACE_MS);
  }, [cancel]);
  const open = useCallback(() => {
    cancel();
    const el = ref.current;
    if (!el) return;
    if (closeOpenPop && closeOpenPop !== closeNow) closeOpenPop();
    closeOpenPop = closeNow;
    const r = el.getBoundingClientRect();
    const w = Math.max(200, Math.min(width, window.innerWidth - 16));
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom;
    const placeBelow = below >= 220 || below >= r.top;
    // ⚠️ 높이 상한이 없으면 브라우저를 확대했을 때(= CSS px 뷰포트가 짧아졌을 때) 긴 설명이
    //    화면 밖으로 흘러 아래가 통째로 잘린다. 남는 공간에 맞춰 자르고 내부 스크롤로 넘긴다.
    const maxH = Math.max(120, (placeBelow ? below : r.top) - 14);
    setPos(placeBelow
      ? { left, w, top: r.bottom + 6, maxH }
      : { left, w, bottom: window.innerHeight - r.top + 6, maxH });
  }, [width, cancel, closeNow]);
  const enter = useCallback(() => { overRef.current = true; cancel(); }, [cancel]);
  const leave = useCallback(() => { overRef.current = false; close(); }, [close]);
  const blur = useCallback(() => { if (overRef.current) return; closeNow(); }, [closeNow]);
  // ⚠️ 언마운트 정리 — 대기 타이머가 남으면 사라진 컴포넌트에 setState가 걸리고,
  //    전역 등록이 남으면 다음 팝오버가 죽은 인스턴스를 닫으려 든다.
  useEffect(() => () => {
    cancel();
    if (closeOpenPop === closeNow) closeOpenPop = null;
  }, [cancel, closeNow]);
  useEffect(() => {
    if (!pos) return;
    // ⚠️ 팝오버 **내부** 스크롤로는 닫지 않는다 — 상한이 걸린 긴 설명은 안에서 스크롤해야
    //    끝까지 읽을 수 있는데, 캡처 리스너가 그것까지 잡으면 읽을 방법이 사라진다.
    const off = (e) => {
      const t = e?.target;
      if (t && t.nodeType === 1 && typeof t.closest === 'function' && t.closest('[data-bt-pop]')) return;
      closeNow();
    };
    window.addEventListener('scroll', off, true);
    window.addEventListener('resize', off);
    return () => { window.removeEventListener('scroll', off, true); window.removeEventListener('resize', off); };
  }, [pos, closeNow]);
  return { ref, pos, open, close, closeNow, enter, leave, blur };
}

/**
 * '?' 아이콘 — 호버(또는 키보드 포커스·클릭)에서만 상세 안내를 띄운다.
 * ⚠️ Section 헤더 안에 놓이므로 헤더 전체를 <button>으로 두면 버튼 중첩(잘못된 DOM)이 된다 —
 *    Section 헤더는 div + 내부 토글 버튼 구조여야 한다.
 */
function Hint({ children, width = 340, className = '', label = '설명 보기' }) {
  const { ref, pos, open, close, closeNow, enter, leave, blur } = useHoverPop(width);
  return (
    <>
      {/* ⚠️ 네이티브 title은 달지 않는다 — 1초 뒤 뜨는 브라우저 툴팁이 이 팝오버 위에 겹친다. */}
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={`shrink-0 text-gray-600 hover:text-sky-300 focus:text-sky-300 outline-none bt-noprint ${className}`}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={blur}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (pos) closeNow(); else open(); }}
      >
        <HelpCircle size={13} />
      </button>
      {pos && (
        <div role="tooltip" data-bt-pop className={`${POP_CLS} text-[12px] text-gray-300`}
          style={popStyle(pos)} onMouseEnter={enter} onMouseLeave={leave}>
          {children}
        </div>
      )}
    </>
  );
}

/**
 * 종목 상세 페이지 링크(새 탭).
 * ⚠️ 코드 규칙은 WatchlistPopup/CompStockChips와 같은 판정을 쓴다 — 숫자로 시작하면 국내,
 *    영문만이면 해외, MA:는 미래에셋 펀드. 판정이 안 되면 링크 없이 평문으로 둔다.
 */
const stockUrl = (code) => {
  const c = String(code || '').trim();
  if (!c) return '';
  if (/^MA:/i.test(c)) return `https://investments.miraeasset.com/magi/fund/view.do?fundGb=2&fundCd=${c.replace(/^MA:/i, '')}`;
  if (/^\d/.test(c)) return `https://m.stock.naver.com/domestic/stock/${c.toUpperCase()}/total`;
  if (/^[A-Za-z]+$/.test(c)) return `https://finance.yahoo.com/quote/${c.toUpperCase()}`;
  return '';
};
const openStock = (code) => {
  const u = stockUrl(code);
  if (u) window.open(u, '_blank', 'noopener');
};

function StockLink({ code, name, className = '', showCode = false }) {
  const url = stockUrl(code);
  const text = name || code || '-';
  if (!url) return <span className={className}>{text}{showCode && code ? <span className="ml-1 text-gray-600 font-mono text-[11px]">{code}</span> : null}</span>;
  return (
    <button type="button" onClick={() => openStock(code)}
      title={`${text} 상세 페이지 열기 (새 탭)`}
      className={`text-left hover:text-sky-300 hover:underline ${className}`}>
      {text}
      {showCode && <span className="ml-1 text-gray-600 font-mono text-[11px]">{code}</span>}
    </button>
  );
}

/** 콤마 표시 + 포커스 시 원문 편집. onCommit은 blur/Enter에서만 부른다. */
function NumInput({ value, onCommit, placeholder = '', disabled = false, className = '', allowEmpty = false }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : value === null || value === undefined || value === '' ? '' : formatNumber(value);
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    const next = allowEmpty && raw === '' ? null : cleanNum(raw);
    // ⚠️ 값이 그대로면 아무것도 쓰지 않는다(RebalancingPanel commitAmt의 조기 return과 같은 규약).
    //    포커스만 스치고 지나가도 커밋하면 patchActive가 updatedAt을 갱신해 ① 지문이 바뀌어
    //    Drive 4파일 write가 나가고 ② 불필요한 승격이 별도 창의 에코 경합을 만든다.
    const cur = allowEmpty
      ? (value === null || value === undefined || value === '' ? null : cleanNum(value))
      : cleanNum(value);
    if (next === cur) return;
    onCommit(next);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      disabled={disabled}
      className={`${INPUT} text-right ${className}`}
      placeholder={placeholder}
      value={shown}
      // ⚠️ 초안에 formatNumber 결과를 넣지 말 것 — DOM 값과 문자열이 달라지면 React가 커밋에서
      //    node.value를 다시 써 캐럿이 끝으로 튄다(목표금액 셀에서 겪은 회귀와 동일).
      onFocus={(e) => setDraft(String(value ?? '').replace(/[^0-9.\-]/g, ''))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }}
    />
  );
}

/**
 * 결과표 '주당 분배금' 셀 입력.
 * ⚠️ 반드시 로컬 draft를 둘 것 — 표시값(d.perShare)은 220ms 디바운스된 **계산 결과**라,
 *    onChange로 곧장 커밋하면 그 사이 리렌더에서 controlled value가 옛 값으로 되돌아가
 *    "170"을 치면 "1"만 남는다. blur/Enter에서만 커밋한다(NumInput과 같은 계약).
 */
function DivInput({ value, unknown, disabled, title, onCommit }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : (unknown && !value ? '' : String(value ?? ''));
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    onCommit(raw === '' ? 0 : cleanNum(raw));
  };
  return (
    <input
      className={`bg-transparent border rounded px-1 py-0.5 text-[10px] text-right w-14 outline-none focus:border-sky-500 ${unknown ? 'border-amber-700/70 text-amber-300' : 'border-transparent hover:border-gray-700 text-gray-300'}`}
      value={shown}
      placeholder="0"
      disabled={disabled}
      title={title}
      onFocus={(e) => setDraft(e.target.value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }}
    />
  );
}

/**
 * 접이식 설정 섹션.
 *
 * ⚠️ 기본은 **닫힘**이다(사용자 요청 2026-08) — 평소에는 제목 줄만 보이고 필요한 것만 펼친다.
 *    대신 접힌 상태에서도 무엇으로 설정돼 있는지 알 수 있도록 호출부가 `badge`에 현재 값을
 *    요약해 넘긴다(안 그러면 '숨은 설정'이 된다).
 * ⚠️ 헤더는 div + 내부 토글 버튼이다 — 헤더 자체를 <button>으로 두면 `?`(Hint)가 버튼 중첩이 된다.
 * ⚠️ 루트에 **shrink-0 필수**(2026-08 사용자 보고: 브라우저를 확대하면 항목이 겹쳐 보임).
 *    설정 패널의 스크롤 영역이 `flex flex-col`이라, 내용이 패널 높이를 넘으면 flex 기본값
 *    `flex-shrink:1`이 각 섹션을 자연 높이 아래로 눌러 버린다. 루트가 `overflow-hidden`이라
 *    눌린 만큼 제목 줄이 잘려 위아래 섹션과 겹쳐 보였다(확대할수록 CSS px 높이가 줄어 심해진다).
 *    shrink-0이면 눌리지 않고 패널이 그냥 스크롤된다.
 */
function Section({ title, children, defaultOpen = false, badge = null, hint = null }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="shrink-0 border border-gray-800 rounded-lg overflow-hidden bg-gray-900/40">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800/60">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
          title={open ? '접기' : '펼치기'}
        >
          {open ? <ChevronDown size={12} className="text-gray-500 shrink-0" /> : <ChevronRight size={12} className="text-gray-500 shrink-0" />}
          <span className="text-[12px] font-bold text-gray-300">{title}</span>
          {badge !== null && <span className="ml-auto pl-2 text-[10px] text-gray-500 truncate">{badge}</span>}
        </button>
        {hint && <Hint>{hint}</Hint>}
      </div>
      {open && <div className="p-2.5 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

/** 자산 추이 미니 차트 — recharts 대신 인라인 SVG(새 창의 컨테이너 측정 이슈 회피 + 인쇄 안정). */
function CurveChart({ curve }) {
  if (!curve || curve.length < 2) return null;
  const W = 640, H = 120, PAD = 4;
  let lo = Infinity, hi = -Infinity;
  for (const c of curve) { if (c.total < lo) lo = c.total; if (c.total > hi) hi = c.total; }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) { hi = lo + 1; }
  const x = (i) => PAD + (i / (curve.length - 1)) * (W - PAD * 2);
  const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);
  const line = curve.map((c, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(c.total).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(curve.length - 1).toFixed(1)} ${H - PAD} L ${x(0).toFixed(1)} ${H - PAD} Z`;
  const up = curve[curve.length - 1].total >= curve[0].total;
  const stroke = up ? '#f87171' : '#60a5fa';
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[120px] block">
        <path d={area} fill={stroke} opacity="0.12" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
        <span>{curve[0].date} · {won(curve[0].total)}</span>
        <span>최고 {won(hi)} · 최저 {won(lo)}</span>
        <span>{curve[curve.length - 1].date} · {won(curve[curve.length - 1].total)}</span>
      </div>
    </div>
  );
}

/**
 * 시나리오 색 스와치.
 * ⚠️ 반드시 **인라인 SVG**여야 한다 — 인쇄 CSS의 `.bt-shell * { background: transparent
 *    !important }`는 작성자 !important라 인라인 `style={{backgroundColor}}`를 이겨서, div/span
 *    스와치는 PDF에서 통째로 사라진다. 그러면 겹친 차트의 선(SVG stroke는 살아남는다)과
 *    시나리오 이름을 대응시킬 방법이 없어 비교 PDF가 판독 불가가 된다.
 *    SVG `fill`은 `background`·`color` 규칙 어느 쪽에도 걸리지 않는다.
 */
function Swatch({ color, shape = 'dot', className = '' }) {
  return shape === 'bar' ? (
    <svg width="12" height="3" viewBox="0 0 12 3" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect width="12" height="3" rx="1.5" fill={color} />
    </svg>
  ) : (
    <svg width="8" height="8" viewBox="0 0 8 8" className={`shrink-0 ${className}`} aria-hidden="true">
      <circle cx="4" cy="4" r="4" fill={color} />
    </svg>
  );
}

/**
 * 팝오버 id 채번 — 앵커의 aria-describedby와 잇는 용도라 **유일하기만** 하면 된다.
 * ⚠️ React.useId를 쓰지 않는다: node_modules가 없어 이 저장소의 React 버전에서 그 API가
 *    실재하는지 확인할 수단이 없다(lucide 아이콘과 같은 근거 — undefined면 렌더가 죽는다).
 */
let popSeq = 0;

/**
 * 요약 카드 한 장 — 호버하면 '무엇과 무엇을 더한 값인가'를 계산식 + 실제 값으로 보여 준다.
 * ⚠️ 팝오버는 position:fixed라 그리드 흐름에서 빠진다(그리드 칸을 하나 더 만들지 않는다).
 * ⚠️ `popRender(w)`는 2열 계산식 표로 감당이 안 되는 카드(시그널 체결)를 위한 탈출구다 —
 *    **측정된 실제 팝오버 폭**을 받아 자기 레이아웃을 정한다. 이 분기가 없으면 긴 문장을
 *    2열 표의 nowrap 값 셀에 넣게 되고, 그 열이 고유폭을 전부 요구해 라벨 열이 최소폭으로
 *    압축된다 → 한글이 **글자 하나당 한 줄**로 무너진다(2026-08 사용자 보고).
 * ⚠️ popRender를 쓰는 카드는 formula를 넘기지 않는다 → `(formula || [])` 방어 필수.
 *    @ts-nocheck + esbuild라 컴파일러가 못 막고, 팝오버는 `{pos && …}` 안이라 호버하기
 *    전까지 아무 게이트에도 걸리지 않은 채 **호버 순간 화면 전체가 오류 페이지**가 된다.
 */
function SummaryCard({ label, value, cls, formula, note, compact, popWidth = 380, popRender }) {
  const { ref, pos, open, close, enter, leave, blur } = useHoverPop(popWidth);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = `bt-pop-${++popSeq}`;
  return (
    <>
      <div
        ref={ref}
        tabIndex={0}
        aria-describedby={pos ? idRef.current : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={blur}
        className="border border-gray-800 rounded-lg px-3 py-2 bg-gray-900/50 outline-none cursor-help hover:border-gray-600 focus:border-sky-700 transition-colors"
      >
        <div className="text-[11px] text-gray-500 flex items-center gap-1">
          {label}
          <HelpCircle size={10} className="text-gray-700 shrink-0 bt-noprint" />
        </div>
        <div className={`${compact ? 'text-sm' : 'text-lg'} font-bold ${cls}`}>{value}</div>
      </div>
      {pos && (
        <div role="tooltip" id={idRef.current} data-bt-pop className={POP_CLS} style={popStyle(pos)}
          onMouseEnter={enter} onMouseLeave={leave}>
          <div className="text-[12px] font-bold text-gray-200 mb-1">{label} — 계산식</div>
          {popRender ? popRender(pos.w) : (
            <table className="w-full text-[12px]">
              <tbody>
                {(formula || []).map(([k, v, strong], i) => (
                  <tr key={i} className={strong ? 'border-t border-gray-700' : ''}>
                    <td className={`py-0.5 pr-3 align-top ${strong ? 'text-gray-200 font-bold' : 'text-gray-500'}`}>{k}</td>
                    <td className={`py-0.5 text-right whitespace-nowrap align-top ${strong ? 'text-gray-100 font-bold' : 'text-gray-300'}`}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {note && <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">{note}</p>}
        </div>
      )}
    </>
  );
}

/**
 * 요약 카드 6종.
 * ⚠️ 단일 시나리오 뷰와 비교 종합의 시나리오별 블록이 **이 한 컴포넌트를 공유**한다 —
 *    복제하면 두 화면이 갈라진다(사진1의 카드 구성이 곧 비교 화면의 카드 구성이어야 한다).
 * ⚠️ 계산식의 각 항은 result/summary의 **같은 필드**를 그대로 읽는다 — 설명에서 값을 다시
 *    계산하면 카드 숫자와 설명이 갈리는 최악의 상태가 된다.
 */
function SummaryCards({ result, compact = false }) {
  const s = result?.summary;
  if (!s) return null;
  // 투입 원금 = 초기 투자금 + 추가 예수금. summary.initialCapital은 추가 예수금을 빼고 담으므로
  // 카드 값(finalTotal·profit)과 어긋나지 않도록 두 값에서 역산한다.
  const invested = s.finalTotal - s.profit;
  const initRest = result.initialCashAfter ?? 0;
  // ⚠️ 원천징수를 켜면 accrued − paid 에 **세금**까지 섞인다 — 세금을 빼야 진짜 미지급분이다.
  //    (엔진 주석: cumDivAccrued = cumDivPaid + cumDivTax + 미지급 세전분)
  const divPending = s.cumDivAccrued - s.cumDivPaid - numOf(s.cumDivTax);
  const taxed = numOf(s.cumDivTax) > 0.5;
  const cards = [
    {
      label: '최종 자산', value: won(s.finalTotal), cls: pnlCls(s.profit),
      formula: [
        [`기말 평가액 (${s.endDate} 종가 × 보유수량)`, won(s.finalEval)],
        ['＋ 기말 예수금 (매매차익 + 초기 잔여 + 추가 예수금)', won(s.finalCashTrade)],
        ['＋ 적립 분배금 (지급받아 아직 안 쓴 몫)', won(s.finalCashDiv)],
        ['＝ 최종 자산', won(s.finalTotal), true],
      ],
      note: '마지막 영업일 종가로 전 종목을 같은 시점에 평가한 값 + 남은 현금입니다. 예수금과 적립 분배금은 따로 관리하지만 둘 다 현금이라 총자산에는 함께 들어갑니다. 아래 "기말 보유 현황" 표의 총자산과 같은 값입니다.',
    },
    {
      label: '총 손익', value: wonSigned(s.profit), cls: pnlCls(s.profit),
      formula: [
        ['최종 자산', won(s.finalTotal)],
        ['− 투입 원금 (초기 투자금 + 추가 예수금)', won(invested)],
        ['＝ 총 손익', wonSigned(s.profit), true],
      ],
      note: '받은 분배금은 적립 분배금으로 들어와 최종 자산에 이미 포함돼 있습니다(따로 더하면 이중 계상). 매매차익 과세·수수료는 반영하지 않았습니다.',
    },
    {
      label: '수익률', value: pctText(s.profitRate), cls: pnlCls(s.profit),
      formula: [
        ['총 손익', wonSigned(s.profit)],
        ['÷ 투입 원금', won(invested)],
        ['＝ 수익률', pctText(s.profitRate), true],
        ['참고 · 최대 낙폭', `${s.maxDrawdown.toFixed(2)}%`],
      ],
      note: `${s.startDate} ~ ${s.endDate} (${s.months}개월) 전체 기간의 단순 수익률입니다 — 연환산(CAGR)이 아닙니다.`,
    },
    {
      label: '누적 매매차익', value: wonSigned(s.cumTradeNet), cls: pnlCls(s.cumTradeNet),
      formula: [
        ['리밸런싱 매도 − 매수 누계', wonSigned(s.cumTradeNet), true],
        ['(따로 셈) 종목 재편 순현금', wonSigned(s.cumStructuralNet)],
        ['(따로 셈) 분배금 재투자 매수', wonSigned(s.cumReinvestNet)],
      ],
      note: '정기 리밸런싱으로 판 돈에서 산 돈을 뺀 누계입니다. 종목 재편(회색 행)과 분배금 재투자(초록 행)는 성격이 달라 이 값에 넣지 않고 따로 셉니다.',
    },
    {
      label: '누적 분배금', value: won(s.cumDivAccrued), cls: 'text-emerald-400',
      formula: [
        ['분배락 기준 누계 (월별 표의 합계와 같은 기준)', won(s.cumDivAccrued), true],
        // ⚠️ 원천징수를 켜면 '입금'은 세후다 — 세전 누계(divAccrued)는 그대로 두고 현금 흐름만 세후로 바꿨다.
        ...(taxed ? [['원천징수 세금 (지급분에서 차감)', `− ${won(s.cumDivTax)}`]] : []),
        [`이 중 실제 입금 (지급일 기준${taxed ? ' · 세후' : ''})`, won(s.cumDivPaid)],
        ['아직 미지급 (지급일이 종료일 이후)', won(divPending)],
      ],
      note: '적립 분배금은 실제 지급일에만 늘어납니다. 월말 분배는 다음 달 초에 입금되므로 두 값이 다를 수 있습니다.'
        + (taxed ? ' 원천징수를 켜면 세후 금액만 들어옵니다(세전 권리 확정액은 위 누계 그대로).' : ''),
    },
    {
      // ⚠️ '예수금'은 **매매 몫만** 가리킨다(사용자 정의 2026-08: 분배금은 예수금에 합산하지 않는다).
      //    합계(finalCash)를 여기 넣지 말 것 — 옆의 '적립 분배금' 카드와 이중 계상으로 읽힌다.
      label: '기말 예수금', value: won(s.finalCashTrade), cls: 'text-gray-200',
      formula: [
        ['초기 매수 후 잔여 + 추가 예수금', won(initRest)],
        ['＋ 누적 매매차익', wonSigned(s.cumTradeNet)],
        ['＋ 종목 재편 순현금', wonSigned(s.cumStructuralNet)],
        ['＋ 분배금 재투자 매수', wonSigned(s.cumReinvestNet)],
        ['＋ 적립 분배금이 대신 낸 매수 대금', won(s.cumDivDrawn)],
        ['＝ 기말 예수금', won(s.finalCashTrade), true],
      ],
      note: '매매차익 + 초기 매수 잔여 + 추가 예수금으로만 이루어진 돈입니다 — 분배금은 여기 합산하지 않고 옆 카드에서 따로 셉니다. '
        + '마지막 항이 ＋인 이유는, 분배금이 대신 낸 매수 대금만큼 예수금이 덜 나갔기 때문입니다.',
    },
    {
      label: '적립 분배금', value: won(s.finalCashDiv), cls: 'text-emerald-300',
      formula: [
        [`누적 분배금 (지급 기준${taxed ? ' · 세후' : ''})`, won(s.cumDivPaid)],
        ['− 매수에 사용한 분배금', won(s.cumDivDrawn)],
        ['＝ 적립 분배금 (기말 잔액)', won(s.finalCashDiv), true],
        ...(taxed ? [['(참고) 원천징수 세금 — 위 항에 이미 빠져 있음', won(s.cumDivTax)]] : []),
      ],
      note: '지급받은 분배금을 예수금과 **따로** 쌓아 둔 잔액입니다. ⑤-b 매수 재원을 ‘매매 예수금만’으로 두면 '
        + '매수에 쓰이지 않고 계속 쌓이고, ‘예수금 전부’로 두면 예수금이 모자랄 때 여기서 꺼내 씁니다.'
        + (taxed ? ' 세금은 애초에 입금되지 않은 돈이라 별도 항이 아니라 분배금 항에서 이미 빠져 있습니다.' : ''),
    },
  ];
  // ⚠️ 카드가 7장이 되면서 xl 6열 → 4열로 바꿨다. 7열로 늘리면 카드 폭이 100px 아래로 떨어져
  //    `₩381,666,374`(text-lg)가 줄바꿈된다 — 2행이 되더라도 4열이 읽기에 낫다.
  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 ${compact ? 'mb-2' : 'mb-3'}`}>
      {cards.map((c) => <SummaryCard key={c.label} {...c} compact={compact} />)}
    </div>
  );
}

/**
 * 시그널 체결 팝오버 본문 — 한 사건 = 한 행.
 *
 * ⚠️ 2열 계산식 표(값 셀이 whitespace-nowrap)에 이 문장들을 넣으면 안 된다. 매도는 28자,
 *    매수는 90자가 넘어(sigOutcomeText가 재원·개방 계산식까지 이어 붙인다) nowrap 열이 고유폭을
 *    전부 요구하고, auto 레이아웃이라 라벨 열이 최소폭으로 압축된다 → 한글은 아무 데서나
 *    줄바꿈되므로 **글자 하나당 한 줄**이 되고 값은 팝오버 밖으로 잘린다(2026-08 사용자 보고).
 *    → 열 폭을 **px로 못 박은 table-fixed**로 그려 고유폭 경쟁 자체를 없앤다.
 *
 * ⚠️ 폭이 SIG_WIDE_MIN 미만이면 표를 포기하고 **사건별 블록**으로 떨어진다. 퍼센트 열이든 px
 *    열이든 좁은 폭에서는 날짜('2026-01-16')가 하이픈에서 쪼개져 같은 증상이 재현되기 때문이다
 *    (이 페이지는 좁은 폭을 정식 지원한다 — 설정 패널 `w-full lg:w-[420px]`, 브라우저 확대도
 *    CSS px 뷰포트를 짧게 만든다). 블록 흐름은 어떤 폭에서도 무너지지 않는다.
 *
 * ⚠️ 문장은 sigLabel·sigRefText·sigOutcomeText를 **그대로** 쓴다 — 화면(월별 블록)·CSV와 같은
 *    함수를 써야 같은 사건이 화면과 파일에서 다르게 설명되지 않는다(가드 #259b).
 * ⚠️ 종목명은 평문이다(StockLink 금지) — 팝오버 안에 버튼을 두면 Tab이 그 버튼으로 가는 순간
 *    앵커 onBlur가 먼저 팝오버를 언마운트해 포커스가 body로 날아간다.
 * ⚠️ 셀 패딩은 결과 표 상수(TD, py-2.5)가 아니라 py-1이다 — 9건이 maxH 안에 스크롤 없이
 *    들어가야 한다는 것이 이 재설계의 목표다.
 */
const SIG_WIDE_MIN = 720;

function SignalPopBody({ events, cfg, limit, moreHint, w }) {
  const kindCls = (e) => (e.kind === 'sell' ? 'text-sky-300' : 'text-amber-300');
  const outCls = (e) => (numOf(e.tradeQty)
    ? (e.kind === 'sell' ? 'text-sky-200 font-bold' : 'text-amber-200 font-bold')
    : 'text-gray-500');
  if (!events.length) {
    return <p className="text-[12px] text-gray-500">발동 없음 — 아직 단계에 도달하지 않았습니다.</p>;
  }
  // ⚠️ 목록만 자르고 **합계는 전 건**으로 낸다 — 잘린 24건으로 합을 내면 25건째부터 표의
  //    합계가 조용히 줄어든다(카드 값 'N/M건'과도 어긋난다).
  const shown = events.slice(0, limit);
  const more = Math.max(0, events.length - limit);
  const buySum = events.filter((e) => numOf(e.tradeQty) > 0).reduce((a, e) => a + numOf(e.tradeAmount), 0);
  const sellSum = events.filter((e) => numOf(e.tradeQty) < 0).reduce((a, e) => a + numOf(e.tradeAmount), 0);
  const usedSum = events.reduce((a, e) => a + numOf(e.used), 0);
  // ⚠️ '매매 예수금만'에서는 적립 분배금 몫이 **구조적으로 항상 0**이다(주머니가 통째로 잠긴다).
  //    합계를 `₩0`으로 찍으면 "왜 0인가"를 되묻게 되므로 그 사실을 문장으로 밝힌다.
  const tradeOnly = (cfg?.buyFunding || 'both') === 'tradeOnly';
  const poolLabel = tradeOnly
    ? '이 중 적립 분배금에서 꺼낸 몫'
    : '이 중 적립 분배금에서 꺼낸 몫 (예수금 전부 모드)';
  const poolValue = tradeOnly ? '사용 안 함 (매매 예수금만)' : won(usedSum);

  if (w < SIG_WIDE_MIN) {
    return (
      <div className="flex flex-col gap-1.5 text-[12px] leading-snug">
        {shown.map((e, i) => (
          <div key={`${e.assetId}-${e.date}-${e.kind}-${e.step}-${i}`} className="border-t border-gray-800 pt-1">
            <div>
              <span className="text-gray-500">{e.date} </span>
              <b className={kindCls(e)}>{sigLabel(e)}</b>{' '}
              <span className="text-gray-300">{e.name || e.code}</span>
            </div>
            <div className="text-gray-600">{sigRefText(e)}</div>
            <div className={outCls(e)}>{sigOutcomeText(e, cfg)}</div>
          </div>
        ))}
        {more > 0 && <p className="text-gray-500">… 외 {formatNumber(more)}건 — {moreHint}</p>}
        <div className="border-t border-gray-700 pt-1 text-gray-200 font-bold">
          합계 (매수 체결 / 매도 체결) · {won(buySum)} / {won(sellSum)}
        </div>
        <div className="text-gray-500">{poolLabel} · {poolValue}</div>
      </div>
    );
  }

  // ⚠️ 폭을 퍼센트가 아니라 **측정된 실폭에서 px로** 계산한다. 날짜·단계는 고정(내용 폭이
  //    정해져 있다), 나머지 셋만 남은 폭을 나눈다. 퍼센트로 두면 좁아질 때 날짜 열이 61px
  //    아래로 떨어져 '2026-\n01-\n16'이 그대로 재현된다.
  // ⚠️ 세로 스크롤바 자리를 반드시 뺀다. 이 앱의 스크롤바는 오버레이가 아니라 **자리를 차지**하고
  //    (src/index.css `::-webkit-scrollbar { width: 6px }`), 이 팝오버는 내용이 maxH를 넘으면
  //    스크롤되는 것이 기본 경로다(24건 상한). 콘텐츠 폭과 열 폭 합이 정확히 같으면 스크롤바가
  //    뜨는 순간 그만큼 넘쳐 가로 스크롤바가 함께 생기고 마지막 열이 잘린다 — 그 가로 스크롤바는
  //    팝오버 밖에서는 닿을 수도 없다. 여유분은 보이지 않으므로(배경 투명) 넉넉히 잡는다.
  const POP_SCROLLBAR_RESERVE = 16;
  const inner = Math.max(320, w - 26 - POP_SCROLLBAR_RESERVE);
  const dateW = 96;
  const stepW = 118;
  const rest = Math.max(180, inner - dateW - stepW);
  const nameW = Math.round(rest * 0.28);
  const refW = Math.round(rest * 0.30);
  const outW = rest - nameW - refW;
  const TDC = 'px-2 py-1 align-top';
  return (
    <table className="w-full text-[12px] leading-snug" style={{ tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: dateW }} />
        <col style={{ width: nameW }} />
        <col style={{ width: stepW }} />
        <col style={{ width: refW }} />
        <col style={{ width: outW }} />
      </colgroup>
      <thead>
        <tr className="text-gray-500 border-b border-gray-700">
          <th className={`${TDC} text-left font-normal`}>날짜</th>
          <th className={`${TDC} text-left font-normal`}>종목</th>
          <th className={`${TDC} text-left font-normal`}>단계</th>
          <th className={`${TDC} text-left font-normal`}>발동 근거 (고점·저점 → 종가)</th>
          <th className={`${TDC} text-left font-normal`}>체결 결과</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((e, i) => (
          <tr key={`${e.assetId}-${e.date}-${e.kind}-${e.step}-${i}`} className="border-b border-gray-800/70">
            <td className={`${TDC} text-gray-500 whitespace-nowrap`}>{e.date}</td>
            <td className={`${TDC} text-gray-300`}>{e.name || e.code}</td>
            <td className={`${TDC} font-bold whitespace-nowrap ${kindCls(e)}`}>{sigLabel(e)}</td>
            <td className={`${TDC} text-gray-500`}>{sigRefText(e)}</td>
            <td className={`${TDC} ${outCls(e)}`}>{sigOutcomeText(e, cfg)}</td>
          </tr>
        ))}
        {more > 0 && (
          <tr><td colSpan={5} className={`${TDC} text-gray-500`}>… 외 {formatNumber(more)}건 — {moreHint}</td></tr>
        )}
      </tbody>
      <tfoot>
        <tr className="border-t border-gray-700">
          <td colSpan={4} className={`${TDC} text-gray-200 font-bold`}>합계 (매수 체결 / 매도 체결)</td>
          <td className={`${TDC} text-gray-100 font-bold`}>{won(buySum)} / {won(sellSum)}</td>
        </tr>
        <tr>
          <td colSpan={4} className={`${TDC} text-gray-500`}>{poolLabel}</td>
          <td className={`${TDC} text-gray-300`}>{poolValue}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * 전략(평가금 고정 + 현금 버퍼) 생존 판정 지표.
 *
 * ⚠️ 요약 카드와 **같은 SummaryCard 컴포넌트**를 쓴다 — 팝오버 배치·스크롤 상한·인쇄 규칙을
 *    한 곳에서만 관리하기 위해서다(복제 금지, SummaryCards와 같은 규약).
 * ⚠️ 단일 뷰와 비교 종합의 시나리오별 블록이 이 한 컴포넌트를 공유한다.
 * ⚠️ 켜지 않은 기능의 카드는 아예 그리지 않는다 — 안 쓰는 사람에게 '0건' 카드가 상시 붙으면
 *    이 줄의 신호가 죽는다. 반대로 **켜 놓고 0건**인 것은 의미 있는 정보라 그대로 보여 준다.
 */
function StrategyKpis({ result, cfg, compact = false }) {
  const s = result?.summary;
  if (!s) return null;
  const dip = dipOf(cfg);
  const ar = annualOf(cfg);
  const bandOn = numOf(cfg?.band) > 0 || numOf(s.bandSkipCount) > 0;
  const dipOn = dip.enabled || (s.signalEvents || []).length > 0;
  const annualOn = ar.mode === 'pctOfSurplus' && numOf(ar.value) > 0;
  const taxOn = numOf(cfg?.divTaxPct) > 0 || numOf(s.cumDivTax) > 0.5;
  const events = s.signalEvents || [];
  const shortMonths = (result.months || []).filter((m) => numOf(m.shortfallCount) > 0);
  // 변동계수 — 평균이 0이면 정의되지 않는다(분배금이 아예 없는 시나리오).
  const cv = numOf(s.divMonthlyAvg) > 0 ? (s.divMonthlyStdev / s.divMonthlyAvg) * 100 : null;

  const cards = [
    {
      // ⚠️ 값은 `curve.cash` 최저점 = **예수금 + 적립 분배금 합계**다. 이번 재정의로 '예수금'이
      //    매매 몫만 가리키게 됐으므로 라벨을 '최저 현금'으로 맞춘다 — 비교 표·CSV와도 같은 이름이다.
      //    '최저 예수금'으로 되돌리면 같은 카드 안에서 '예수금'이 두 가지 뜻으로 쓰인다(적대적 리뷰 확정).
      label: '최저 현금', value: won(s.minCash?.value ?? 0),
      cls: (s.minCash?.value ?? 0) < 0 ? 'text-blue-400' : 'text-gray-200',
      formula: [
        ['그 날짜', s.minCash?.date || '-'],
        ['기말 예수금', won(s.finalCashTrade)],
        ['기말 적립 분배금', won(s.finalCashDiv)],
        ['적립 분배금 최저점', `${won(s.minCashDiv?.value ?? 0)}${s.minCashDiv?.date ? ` (${s.minCashDiv.date})` : ''}`],
      ],
      note: '영업일 곡선 전 구간에서 현금 합계(예수금 + 적립 분배금)가 가장 낮았던 지점입니다. '
        + '목표 평가금을 고정하는 전략은 여기가 0에 붙는 순간부터 하락분을 되메울 수 없으므로, 이 값이 곧 생존 판정 지표입니다. '
        + '적립 분배금 최저점은 0에서 시작하는 값이라 첫 분배금 입금 이후 구간에서만 잽니다.',
    },
    {
      label: '월 분배금', value: won(s.divMonthlyAvg), cls: 'text-emerald-400',
      formula: [
        ['월 평균 (분배락 기준)', won(s.divMonthlyAvg), true],
        ['표준편차 (±)', won(s.divMonthlyStdev)],
        ['변동계수', cv === null ? '-' : `${cv.toFixed(1)}%`],
        ['누적 분배금', won(s.cumDivAccrued)],
      ],
      note: '“매달 얼마씩 꾸준히 나왔는가”를 보는 값입니다. 구간은 ‘첫 분배가 있었던 달부터 마지막 달까지’로, '
        + '앞쪽 램프업만 빼고 그 뒤의 0원 달(분배가 끊긴 달)은 그대로 포함합니다 — 그래야 “끊겼다”가 표준편차에 드러납니다.',
    },
    ...(bandOn ? [{
      label: '밴드 생략', value: `${formatNumber(s.bandSkipCount)}건`,
      cls: numOf(s.bandSkipCount) > 0 ? 'text-sky-300' : 'text-gray-500',
      formula: [
        ['밴드 폭', `목표 ±${formatNumber(numOf(cfg?.band))}%`],
        ['생략 건수', `${formatNumber(s.bandSkipCount)}건`, true],
        ['생략된 매매 예정 금액', won(s.bandSkipAmount)],
      ],
      note: '목표에 이미 충분히 가까워 그 회차 매매를 건너뛴 횟수입니다(세금·수수료 절약). '
        + '시그널 리밸런싱은 자기 발동일에 체결되므로 밴드의 적용을 받지 않고, 여기에도 잡히지 않습니다.',
    }] : []),
    ...(dipOn ? [{
      label: '시그널 체결',
      value: `${formatNumber(events.filter((e) => e.tradeQty !== 0).length)}/${formatNumber(events.length)}건`,
      cls: events.some((e) => e.tradeQty !== 0) ? 'text-amber-300' : 'text-gray-500',
      // ⚠️ 2열 계산식 표가 아니라 전용 표로 그린다(SignalPopBody 주석 참조) — 이 카드의 값은
      //    ₩ 한 덩어리가 아니라 사건별 문장이라, nowrap 2열에 넣으면 라벨 열이 무너진다.
      popWidth: 980,
      popRender: (w) => (
        <SignalPopBody
          events={events}
          limit={24}
          // ⚠️ 비교 종합의 시나리오 블록에는 월별 표가 없다(요약 카드·지표·곡선만 렌더된다) —
          //    거기서 '월별 표에서 보라'고 하면 같은 화면에 없는 곳을 가리키는 거짓말이 된다.
          moreHint={compact ? '‘상세 보기’로 열면 전체를 볼 수 있습니다' : '월별 표의 시그널 블록에서 전체를 볼 수 있습니다'}
          cfg={cfg}
          w={w}
        />
      ),
      note: '매수 시그널은 종목별 ‘가격 고점’ 대비 낙폭이, 매도 시그널은 ‘가격 저점’ 대비 상승률이 '
        + '각 단계에 처음 닿은 날 발동하고, **그날 종가로 즉시** 체결합니다. '
        + '새 고점(매수)·새 저점(매도)이 서면 전 단계가 다시 무장됩니다. '
        + '규모는 단계의 비율 칸이 정합니다 — 매수는 매수 재원 × 비율(목표에서 자름), 매도는 목표 초과분 × 비율, '
        + '비우면 목표까지입니다. 재원은 ⑤-b ‘매수 재원’ 설정을 그대로 따릅니다.',
    }] : []),
    {
      label: '부족 발생', value: `${formatNumber(s.shortfallMonths)}개월`,
      cls: numOf(s.shortfallMonths) > 0 ? 'text-amber-300' : 'text-gray-500',
      formula: [
        ['매수가 재원 한도로 잘린 달', `${formatNumber(s.shortfallMonths)}개월`, true],
        ...(shortMonths.length
          ? shortMonths.slice(0, 24).map((m) => [m.ym, `${formatNumber(m.shortfallCount)}건`])
          : [['없음 — 모든 매수가 목표대로 체결됐습니다', '-']]),
      ],
      note: "‘예수금 부족’ 또는 ‘바닥선’으로 매수액이 줄어든 달의 수입니다. "
        + '잘려서 수량이 0이 되면 표에 행 자체가 남지 않기 때문에 이 카운터가 대신 알려 줍니다.',
    },
    ...(annualOn ? [{
      label: '연간 증액', value: won(s.cumAnnualReview),
      cls: numOf(s.cumAnnualReview) > 0 ? 'text-teal-300' : 'text-gray-500',
      formula: [
        ['주기', `${ar.everyMonths}개월마다`],
        ['잉여의', `${formatNumber(ar.value)}%`],
        ['생활비 예약금 (투자 제외)', won(ar.reserve)],
        // ⚠️ 사유(r.note)는 **왼쪽 라벨**에 붙인다 — 값 셀은 whitespace-nowrap이라 '+₩… (사유)'를
        //    넣으면 그 열이 고유폭을 전부 요구하고 라벨 열이 최소폭으로 압축돼, 시그널 카드가
        //    겪은 '글자 하나당 한 줄' 붕괴가 380px 팝오버에서 그대로 재현된다.
        ...(result.annualRows || []).slice(0, 24).map((r) => [
          `${r.ym} · 예수금 ${won(r.cashBefore)}${r.note ? ` · ${r.note}` : ''}`,
          `+${won(r.amount)}`,
        ]),
        ['누적 증액', won(s.cumAnnualReview), true],
      ],
      note: '예약금을 뺀 잉여 현금의 일부를 목표 평가금에 얹어 월 분배금을 키우는 가드레일입니다. '
        + '증액 자체는 현금을 움직이지 않고 목표만 올리며, 바로 이어지는 리밸런싱이 실제로 매수합니다.',
    }] : []),
    ...(taxOn ? [{
      label: '분배금 세금', value: won(s.cumDivTax), cls: 'text-gray-400',
      formula: [
        ['원천징수율', `${formatNumber(numOf(cfg?.divTaxPct))}%`],
        ['세전 지급 누계', won(numOf(s.cumDivPaid) + numOf(s.cumDivTax))],
        ['− 원천징수 세금', won(s.cumDivTax)],
        ['＝ 실제 입금 (예수금 반영)', won(s.cumDivPaid), true],
      ],
      note: '지급일에 원천징수를 떼고 입금합니다. 분배락 기준 권리 확정액(누적 분배금)은 세전 그대로 두고 '
        + '현금 흐름만 세후로 바꿉니다 — 그래야 기말 예수금 분해가 그대로 맞습니다. 매매차익 과세는 반영하지 않습니다.',
    }] : []),
  ];

  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 ${compact ? 'mb-2' : 'mb-3'}`}>
      {cards.map((c) => <SummaryCard key={c.label} {...c} compact={compact} />)}
    </div>
  );
}

/**
 * 시나리오별 자산 추이를 한 축에 겹쳐 그리는 비교 차트.
 *
 * ⚠️ x축은 **전 시나리오 날짜의 합집합**이다. 시나리오마다 기간이 다를 수 있어, 없는 구간을
 *    0으로 채우면 가짜 폭락이 생긴다 — 각 선은 자기 날짜에만 점을 찍고 나머지 구간은 그리지 않는다.
 * ⚠️ 초기 투자금이 다른 시나리오를 금액(₩)으로 겹쳐 보면 규모 차이만 보인다 → 'pct' 모드는
 *    각 시나리오의 **자기 시작점**을 0%로 놓고 정규화한다(호출부가 기본 모드를 정한다).
 */
function CompareChart({ series, mode = 'won' }) {
  const live = (series || []).filter((s) => s && Array.isArray(s.curve) && s.curve.length >= 2);
  if (!live.length) return null;

  const W = 900, H = 210, PAD = 6, PADB = 16;
  const dateSet = new Set();
  for (const s of live) for (const c of s.curve) dateSet.add(c.date);
  const dates = Array.from(dateSet).sort();
  if (dates.length < 2) return null;
  const idx = new Map(dates.map((d, i) => [d, i]));

  const valueOf = (s, c) =>
    mode === 'pct'
      ? (s.curve[0].total > 0 ? (c.total / s.curve[0].total - 1) * 100 : 0)
      : c.total;

  let lo = Infinity, hi = -Infinity;
  for (const s of live) for (const c of s.curve) {
    const v = valueOf(s, c);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (hi === lo) hi = lo + 1;

  const x = (i) => PAD + (i / (dates.length - 1)) * (W - PAD * 2);
  const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD - PADB);
  const fmt = (v) => (mode === 'pct' ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%` : won(v));

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[210px] block">
        {/* 0% 기준선 — 정규화 모드에서 '본전'이 어디인지 보이지 않으면 비교가 안 된다. */}
        {mode === 'pct' && lo < 0 && hi > 0 && (
          <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="#4b5563" strokeWidth="1"
            strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {live.map((s) => {
          const d = s.curve
            .map((c, i) => {
              const xi = idx.get(c.date);
              if (xi === undefined) return '';
              return `${i === 0 ? 'M' : 'L'} ${x(xi).toFixed(1)} ${y(valueOf(s, c)).toFixed(1)}`;
            })
            .filter(Boolean)
            .join(' ');
          return (
            <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth="1.6"
              vectorEffect="non-scaling-stroke" opacity="0.95" />
          );
        })}
      </svg>
      <div className="flex justify-between text-[9px] text-gray-600 mt-0.5 px-0.5">
        <span>{dates[0]}</span>
        <span>최고 {fmt(hi)} · 최저 {fmt(lo)}</span>
        <span>{dates[dates.length - 1]}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
        {live.map((s) => {
          const last = s.curve[s.curve.length - 1];
          return (
            <span key={s.id} className="flex items-center gap-1 text-[10px] whitespace-nowrap">
              <Swatch color={s.color} shape="bar" />
              <b className="text-gray-300">{s.name}</b>
              <span className="text-gray-500">{fmt(valueOf(s, last))}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 시나리오 한 줄 설명 — 비교 표 부제·시나리오별 블록 부제가 같은 문구를 쓴다. */
function scenarioSubtitle(cfg, summary) {
  const parts = [
    summary ? `${summary.startDate} ~ ${summary.endDate}` : `${cfg.startDate || '?'} ~ ${cfg.endDate || '?'}`,
    `초기 ${won(cfg.initialCapital)}${cfg.extraCash > 0 ? ` (+예수금 ${won(cfg.extraCash)})` : ''}`,
    TARGET_MODE_LABEL[cfg.targetMode] || cfg.targetMode,
    POLICY_LABEL[cfg.policy] || cfg.policy,
    `분배금 ${DIV_REINVEST_LABEL[cfg.divReinvest] || '현금 보유'}`
      + (cfg.divReinvest !== 'hold' ? ` · ${DIV_SPLIT_LABEL[cfg.divReinvestSplit] || ''}` : ''),
    // ⚠️ 켠 보조 규칙만 붙는다(기본값은 한 글자도 안 나온다) — 안 그러면 부제가 상시 두 줄이 된다.
    ...strategyTags(cfg),
  ];
  return parts.join(' · ');
}

/* ===========================================================================
 * 시나리오 평가 · 메모 (결과에 영향이 없는 **기록 전용** 기능)
 * =========================================================================== */

/**
 * 평가 등급 표기.
 * ⚠️ 색은 **반드시 text-* 클래스**로 낼 것 — 인쇄 CSS `.bt-shell * { background: transparent
 *    !important }`(작성자 !important)가 인라인 backgroundColor를 이겨서, 배경으로 칠한 배지는
 *    PDF에서 통째로 사라진다(Swatch가 인라인 SVG인 것과 같은 근거). 아래 4색은 인쇄 CSS의
 *    text-emerald-/text-amber-/text-red- 되살림 규칙에 그대로 걸린다.
 */
const RATING_ORDER = ['good', 'watch', 'bad', 'none'];
const RATING_LABEL = { good: '좋음', watch: '보통', bad: '나쁨', none: '미평가' };
const RATING_MARK = { good: '◎', watch: '△', bad: '✕', none: '·' };
const RATING_CLS = {
  good: 'text-emerald-300',
  watch: 'text-amber-300',
  bad: 'text-red-400',
  none: 'text-gray-500',
};

/**
 * 평가·메모의 기본값 안전 접근자.
 * ⚠️ `cfg.review.rating`처럼 곧바로 파고들지 말 것 — 이 파일은 `@ts-nocheck`라 컴파일러가 막지
 *    않는데, 정규화를 우회한 config가 한 번이라도 들어오면 **렌더 중 TypeError**가 루트
 *    ErrorBoundary까지 올라가 화면이 통째로 오류 페이지가 된다(dipOf·annualOf와 같은 규약).
 */
const reviewOf = (cfg) => (cfg && cfg.review) || { rating: 'none', verdict: '', updatedAt: 0 };
const notesOf = (cfg) => (Array.isArray(cfg?.notes) ? cfg.notes : []);
const ratingKey = (r) => (RATING_LABEL[r] ? r : 'none');
/** 평가·메모에 실제로 쓴 내용이 하나라도 있는가(빈 카드를 PDF에 찍지 않기 위한 판정). */
const hasReviewContent = (cfg) => {
  const rv = reviewOf(cfg);
  return ratingKey(rv.rating) !== 'none'
    || !!String(rv.verdict || '').trim()
    || notesOf(cfg).some((n) => !!(String(n?.title || '').trim() || String(n?.body || '').trim()));
};

function RatingChip({ rating, className = '' }) {
  const r = ratingKey(rating);
  return (
    <span className={`font-bold ${RATING_CLS[r]} ${className}`}>{RATING_MARK[r]} {RATING_LABEL[r]}</span>
  );
}

/**
 * 시나리오 평가 카드 — 결과 표제 **바로 아래(= 헤더 상단)** 에 놓이고 PDF에도 그대로 실린다.
 *
 * 구성 = ① 등급(좋음/보통/나쁨/미평가) + 한 줄 결론  ② 메모 목록(AI 분석 / 내 메모).
 * 각 메모는 **작성 시점의 조건 요약과 헤드라인 결과를 함께 박제**한다 — AI 분석은 특정 설정의
 * 결과를 두고 쓴 글이라, 나중에 설정을 바꾸면 그 글이 조용히 거짓이 되기 때문이다. 지금 설정과
 * 지문이 다르면 '작성 이후 설정이 바뀌었습니다' 배지를 띄운다(조용한 오적용보다 명시적 고지).
 *
 * ⚠️ **로컬 draft + blur 커밋**이다(NumInput·DivInput과 같은 계약). 매 keystroke 커밋하면
 *    `active` 참조가 바뀌어 220ms 뒤 백테스트 전 구간이 재실행되고 결과 표 전체가 리렌더된다.
 * ⚠️ draft를 두는 순간 유실·오적용 경로가 새로 생기므로 FlowInspector 규약을 그대로 이식한다:
 *    ① 쓰기는 **id 기준**(`onPatch(ownerId, …)`) — 렌더 시점 `active.id`를 클로저로 잡으면
 *       타이핑 중 시나리오를 바꿨을 때 draft가 **다른 시나리오에 기록**된다.
 *    ② 소유자 변경·언마운트 flush는 **useLayoutEffect**로 — passive effect는 discrete 이벤트인
 *       blur보다 뒤처져 그 오적용을 못 막는다.
 *    ③ `registerFlush`로 커밋 훅을 부모에 등록한다 — 부모의 `promote()`는 `localRef`만 회수하므로
 *       draft를 전혀 보지 못한다(앱 종료 커밋에서 본문이 통째로 유실된다).
 */
function ScenarioReviewCard({ cfg, result, readOnly, onPatch, onAddNote, registerFlush }) {
  const [draft, setDraft] = useState({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const ownerRef = useRef(cfg.id);
  const [folded, setFolded] = useState({});
  const [delId, setDelId] = useState('');

  const review = reviewOf(cfg);
  const notes = notesOf(cfg);
  const rating = ratingKey(review.rating);

  /** 지금 설정의 지문 — 메모 스냅샷과 비교해 '작성 이후 바뀌었는가'를 판정한다. */
  const curFp = useMemo(() => {
    try { return backtestSettingsFingerprint(cfg); } catch { return ''; }
  }, [cfg]);

  const flush = useCallback(() => {
    const d = draftRef.current;
    const owner = ownerRef.current;
    const keys = Object.keys(d || {});
    if (!owner || !keys.length) return;
    draftRef.current = {};
    setDraft({});
    onPatch(owner, (s) => {
      const out = {};
      if (d.verdict !== undefined) {
        const cur = reviewOf(s);
        const next = String(d.verdict).slice(0, MAX_BT_VERDICT_LEN);
        // ⚠️ 값이 그대로면 아무것도 쓰지 않는다(NumInput 조기 return과 같은 규약) — 포커스만
        //    스치고 지나가도 커밋하면 updatedAt이 올라 지문이 바뀌고 Drive 4파일 write가 나간다.
        if (next !== cur.verdict) out.review = { ...cur, verdict: next, updatedAt: Date.now() };
      }
      const ids = new Set(
        keys.filter((k) => k.length > 2 && k[1] === ':' && (k[0] === 't' || k[0] === 'b')).map((k) => k.slice(2)),
      );
      if (ids.size) {
        let touched = false;
        const ts = Date.now();
        const list = notesOf(s).map((n) => {
          if (!ids.has(n.id)) return n;
          const t = d[`t:${n.id}`];
          const b = d[`b:${n.id}`];
          const title = t === undefined ? n.title : String(t).slice(0, MAX_BT_NOTE_TITLE_LEN);
          const body = b === undefined ? n.body : String(b).slice(0, MAX_BT_NOTE_LEN);
          if (title === n.title && body === n.body) return n;
          touched = true;
          return { ...n, title, body, updatedAt: ts };
        });
        if (touched) out.notes = list;
      }
      return out;
    });
  }, [onPatch]);

  // 소유 시나리오가 바뀌면 **이전 소유자**에게 먼저 커밋한다.
  // ⚠️ 호출부가 key={cfg.id}로 리마운트시키므로 평상시엔 도달하지 않는 2차 방어선이다(둘 다 유지).
  useLayoutEffect(() => {
    if (ownerRef.current !== cfg.id) { flush(); ownerRef.current = cfg.id; }
  });
  // ⚠️ 언마운트된 DOM에는 브라우저가 blur/focusout을 발화하지 않는다 — 이 cleanup이 없으면
  //    시나리오 전환·페이지 닫기에서 방금 붙여넣은 분석이 아무 데도 저장되지 않고 사라진다.
  useLayoutEffect(() => () => { flush(); }, [flush]);

  useEffect(() => {
    registerFlush?.(flush);
    return () => registerFlush?.(null);
  }, [registerFlush, flush]);

  const setRating = (r) => {
    if (readOnly) return;
    const cur = reviewOf(cfg);
    const next = ratingKey(cur.rating) === r ? 'none' : r;
    if (next === ratingKey(cur.rating)) return;
    onPatch(cfg.id, (s) => ({ review: { ...reviewOf(s), rating: next, updatedAt: Date.now() } }));
  };

  const removeNote = (id) => {
    setDelId('');
    onPatch(cfg.id, (s) => ({ notes: notesOf(s).filter((n) => n.id !== id) }));
  };

  const shownVerdict = draft.verdict !== undefined ? draft.verdict : review.verdict;
  /**
   * '아직 아무것도 안 쓴 카드'인가 — 인쇄에서 뺄지 판정한다.
   *
   * ⚠️ **커밋된 값만 보지 말 것**(`hasReviewContent(cfg)` 단독 금지). `addNote`가 만드는 메모는
   *    title·body가 ''이라, 붙여넣고 blur 없이 Ctrl+P를 누르면 `empty=true`가 되어 카드 루트에
   *    `bt-noprint`가 붙고, 인쇄 CSS가 카드를 통째로 감추면서 **아래 `.bt-printonly` 미러까지
   *    함께 사라진다**(자손의 `display:block !important`는 `display:none` 조상을 되살리지 못한다).
   *    그 미러는 바로 그 경로("blur가 나지 않는 인쇄에서도 방금 친 내용이 실린다")를 위해 존재하므로,
   *    커밋된 값만 보는 순간 미러의 존재 이유가 통째로 무효화된다. draft **전체**를 함께 본다.
   */
  const draftHasText = Object.keys(draft).some((k) => !!String(draft[k] ?? '').trim());
  const empty = !hasReviewContent(cfg) && !draftHasText;

  return (
    // ⚠️ 아무것도 안 쓴 카드는 인쇄에서 통째로 뺀다 — 안 그러면 PDF 첫 장에 빈 상자가 찍힌다.
    // ⚠️ 여기에 `bt-month`(page-break-inside: avoid)를 붙이지 말 것 — 긴 AI 분석은 페이지를
    //    넘어가며 이어져야 한다. 붙이면 한 장에 욱여넣으려다 뒤가 잘린다.
    <div className={`border border-gray-800 rounded-lg bg-gray-900/40 p-2.5 mb-3 ${empty ? 'bt-noprint' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <span className="text-[12px] font-bold text-gray-300">📝 시나리오 평가</span>
        <Hint width={340} label="시나리오 평가 안내">
          <p>
            이 시나리오를 돌려 보고 내린 <b className="text-gray-300">결론</b>과, AI에게 받은
            <b className="text-gray-300"> 분석 내용</b>을 여기에 적어 두면 시나리오와 함께 저장됩니다.
            다음에 열어도, 다른 기기에서 열어도 그대로 남아 있고 <b className="text-gray-300">PDF·CSV에도 함께</b> 나갑니다.
          </p>
          <p className="mt-1">
            메모마다 <b className="text-gray-300">그때의 조건과 결과가 함께 기록</b>됩니다. 나중에 설정을
            바꾸면 그 메모에 <span className="text-amber-300">설정이 바뀌었습니다</span> 표시가 붙어,
            지금 화면의 숫자와 메모의 내용이 다른 조건의 것임을 알 수 있습니다.
          </p>
        </Hint>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-600 bt-noprint">메모 {notes.length} / {MAX_BT_NOTES}</span>
        <button
          className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30 bt-noprint`}
          disabled={readOnly || notes.length >= MAX_BT_NOTES}
          onClick={() => onAddNote('ai')}
          title="AI에게 받은 분석을 붙여넣습니다. 지금 조건과 결과가 함께 기록됩니다."
        >
          <Plus size={11} className="inline -mt-0.5" /> AI 분석
        </button>
        <button
          className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800 bt-noprint`}
          disabled={readOnly || notes.length >= MAX_BT_NOTES}
          onClick={() => onAddNote('user')}
        >
          <Plus size={11} className="inline -mt-0.5" /> 내 메모
        </button>
      </div>

      {/* 등급 + 한 줄 결론 — 편집 UI는 화면 전용, 인쇄에는 바로 아래 정적 미러가 나간다. */}
      <div className="flex flex-wrap items-center gap-1 mb-1 bt-noprint">
        {RATING_ORDER.map((r) => (
          <button
            key={r}
            disabled={readOnly}
            onClick={() => setRating(r)}
            className={`${BTN} ${rating === r
              ? `${RATING_CLS[r]} border-gray-500 bg-gray-800`
              : 'text-gray-600 border-gray-700 hover:bg-gray-800'}`}
          >
            {RATING_MARK[r]} {RATING_LABEL[r]}
          </button>
        ))}
        <input
          className={`${INPUT} flex-1 min-w-[200px]`}
          disabled={readOnly}
          maxLength={MAX_BT_VERDICT_LEN}
          placeholder="한 줄 결론 (예: 급락 방어는 좋으나 반등 구간에서 뒤처짐)"
          value={shownVerdict}
          onChange={(e) => setDraft((p) => ({ ...p, verdict: e.target.value }))}
          onBlur={flush}
          onKeyDown={(e) => { if (e.key === 'Enter') { flush(); e.currentTarget.blur(); } }}
        />
      </div>
      <div className="bt-printonly text-[12px] mb-1">
        <RatingChip rating={rating} />
        {String(shownVerdict || '').trim() && <span className="text-gray-200"> — {shownVerdict}</span>}
      </div>

      {notes.length === 0 ? (
        <p className="text-[11px] text-gray-600 bt-noprint">
          결과를 보고 느낀 점이나 AI에게 받은 분석을 <b className="text-gray-500">AI 분석</b> 버튼으로 붙여넣어 두세요.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {notes.map((n) => {
            const shownTitle = draft[`t:${n.id}`] !== undefined ? draft[`t:${n.id}`] : (n.title || '');
            const shownBody = draft[`b:${n.id}`] !== undefined ? draft[`b:${n.id}`] : (n.body || '');
            const snap = n.snapshot || {};
            const stale = !!snap.fp && !!curFp && snap.fp !== curFp;
            const open = folded[n.id] !== true;
            return (
              <div key={n.id} className="border border-gray-800 rounded p-2 bg-gray-900/30">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] font-bold shrink-0 ${n.kind === 'user' ? 'text-gray-400' : 'text-sky-300'}`}>
                    {n.kind === 'user' ? '✍ 내 메모' : '🤖 AI 분석'}
                  </span>
                  <input
                    className={`${INPUT} flex-1 min-w-0 bt-noprint`}
                    disabled={readOnly}
                    maxLength={MAX_BT_NOTE_TITLE_LEN}
                    placeholder="제목 (예: 급락 분할투입 개방 비율 비교)"
                    value={shownTitle}
                    onChange={(e) => setDraft((p) => ({ ...p, [`t:${n.id}`]: e.target.value }))}
                    onBlur={flush}
                    onKeyDown={(e) => { if (e.key === 'Enter') { flush(); e.currentTarget.blur(); } }}
                  />
                  <span className="bt-printonly text-[12px] font-bold text-gray-200">{shownTitle || '(제목 없음)'}</span>
                  <button
                    className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 shrink-0 bt-noprint"
                    onClick={() => setFolded((p) => ({ ...p, [n.id]: open }))}
                    title={open ? '접기' : '펼치기'}
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  {/* ⚠️ 삭제 확인은 **인라인 2단계**다 — 이 화면은 z-1090이고 별도 브라우저 창에서는
                          App조차 마운트되지 않아, ConfirmDialog(z-1000)도 알림 토스트도 뜨지 않는다
                          (splitEven의 evenConfirm과 같은 근거). 긴 분석을 오클릭으로 잃으면 복구 불가다. */}
                  {delId === n.id ? (
                    <span className="flex items-center gap-1 shrink-0 bt-noprint">
                      <button className={`${BTN} text-red-200 border-red-700 hover:bg-red-900/40`} onClick={() => removeNote(n.id)}>
                        정말 삭제
                      </button>
                      <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800`} onClick={() => setDelId('')}>
                        취소
                      </button>
                    </span>
                  ) : (
                    <button
                      className="p-1 rounded text-gray-600 hover:text-red-300 hover:bg-red-900/20 shrink-0 bt-noprint disabled:opacity-40"
                      disabled={readOnly}
                      onClick={() => setDelId(n.id)}
                      title="이 메모 삭제"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {stale && (
                  <div className="text-[11px] text-amber-300 mt-1">
                    <AlertCircle size={11} className="inline -mt-0.5 mr-0.5" />
                    이 메모를 쓴 뒤 <b>설정이 바뀌었습니다</b> — 아래 '작성 시점' 조건과 지금 화면의 숫자는 서로 다른 조건의 결과입니다.
                  </div>
                )}

                {/* '세부적인 조건' — 이 메모가 어떤 설정·어떤 결과를 두고 쓴 글인지. PDF에도 나간다. */}
                <div className="text-[10px] text-gray-600 mt-1 leading-relaxed">
                  작성 시점 {snap.period || '-'}
                  {snap.finalTotal != null && <> · 총자산 {won(snap.finalTotal)}</>}
                  {snap.profit != null && <> · <span className={pnlCls(snap.profit)}>{wonSigned(snap.profit)}</span></>}
                  {snap.profitRate != null && <> · <span className={pnlCls(snap.profit)}>{pctText(snap.profitRate)}</span></>}
                  {snap.conditions && <div className="text-gray-700 break-words">{snap.conditions}</div>}
                </div>

                {open && (
                  <textarea
                    className={`${INPUT} mt-1 bt-noprint leading-relaxed resize-y`}
                    rows={8}
                    disabled={readOnly}
                    maxLength={MAX_BT_NOTE_LEN}
                    placeholder="여기에 AI 분석 결과나 메모를 붙여넣으세요."
                    value={shownBody}
                    onChange={(e) => setDraft((p) => ({ ...p, [`b:${n.id}`]: e.target.value }))}
                    onBlur={flush}
                  />
                )}
                {!open && shownBody && (
                  <p className="text-[11px] text-gray-500 mt-1 truncate bt-noprint">{shownBody}</p>
                )}
                {/* ⚠️ 인쇄 미러 — textarea는 내부 스크롤이라 **보이는 만큼만** 인쇄된다(긴 분석의
                        뒤가 통째로 잘린다). 접힌 메모도 PDF에는 전문이 나가야 하므로, 두 경우 모두
                        이 정적 블록 하나가 인쇄를 담당한다. draft를 그대로 읽으므로 Ctrl+P처럼
                        blur가 나지 않는 인쇄 경로에서도 방금 친 내용이 그대로 실린다. */}
                {!!String(shownBody || '').trim() && (
                  <div className="bt-printonly text-[12px] text-gray-200 whitespace-pre-wrap break-words leading-relaxed mt-1">
                    {shownBody}
                  </div>
                )}
                {open && (
                  <div className="text-[9px] text-gray-700 text-right bt-noprint">
                    {shownBody.length} / {MAX_BT_NOTE_LEN}
                    {shownBody.length >= MAX_BT_NOTE_LEN && <span className="text-amber-400"> · 길이 상한에 도달했습니다</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 전체 백테스트 비교 종합.
 *
 * 구성 = ① 비교 표(시나리오 행 × 지표 열) ② 시나리오 라인을 겹쳐 그린 차트
 *        ③ 시나리오별 요약 카드 + 개별 차트 블록.
 *
 * ⚠️ 지표 정의는 단일 시나리오 뷰와 **완전히 같은 summary 필드**를 읽는다 — 여기서 다시
 *    계산하면 같은 시나리오가 두 화면에서 다른 숫자를 보이는 최악의 상태가 된다.
 * ⚠️ 실행 불가(ok=false) 시나리오도 **숨기지 않고** 사유와 함께 행을 남긴다 — 조용히 빠지면
 *    사용자는 그 시나리오가 비교에 들어간 줄로 안다.
 */
function CompareView({ runs, okRuns, series, mode, onMode, capitalsDiffer, colorOf, onOpen, total }) {
  if (!runs.length) {
    return (
      <div className="max-w-lg mx-auto mt-10 border border-gray-800 rounded-lg p-4 text-center">
        <BarChart3 size={20} className="text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-400">비교할 시나리오를 왼쪽에서 하나 이상 선택하세요.</p>
        <p className="text-[11px] text-gray-600 mt-1">저장된 시나리오 {total}개 중 0개 선택됨</p>
      </div>
    );
  }

  // 최고 성과 표시 — 수익률 기준(초기 투자금이 다르면 최종 자산 비교는 의미가 없다).
  let bestId = '';
  let bestRate = -Infinity;
  for (const { cfg, result: r } of okRuns) {
    if (r.summary.profitRate > bestRate) { bestRate = r.summary.profitRate; bestId = cfg.id; }
  }

  const COL = `${TD} text-right whitespace-nowrap`;

  return (
    <>
      <div className="mb-3">
        <h2 className="text-lg font-bold text-gray-100">📊 전체 백테스트 비교 종합</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">
          선택한 {runs.length}개 시나리오 (저장된 시나리오 {total}개)
          {capitalsDiffer && (
            <span className="text-amber-400/90"> · 초기 투자금이 서로 달라 최종 자산 대신 <b>수익률</b>로 비교하세요</span>
          )}
        </p>
      </div>

      {/* ① 비교 표 */}
      <div className="overflow-x-auto border border-gray-800 rounded-lg mb-3 bt-month">
        <table className={`${TBL} min-w-[1080px]`}>
          <thead className="bg-gray-800/70 text-gray-400">
            <tr>
              <th className={`${TH} text-left`}>시나리오</th>
              <th className={`${TH} text-right`}>최종 자산</th>
              <th className={`${TH} text-right`}>총 손익</th>
              <th className={`${TH} text-right`}>수익률</th>
              <th className={`${TH} text-right`}>누적 매매차익</th>
              <th className={`${TH} text-right`}>누적 분배금</th>
              <th className={`${TH} text-right`}>분배금 재투자</th>
              <th className={`${TH} text-right`} title="매매차익 + 초기 매수 잔여 + 추가 예수금 (적립 분배금은 옆 열에 따로)">기말 예수금</th>
              <th className={`${TH} text-right`} title="지급받은 분배금 중 아직 쓰지 않은 잔액 — 예수금과 별도로 쌓인다">적립 분배금</th>
              {/* ⚠️ 이 두 열이 이 작업의 목적이다 — '평가금 고정 + 현금 버퍼' 전략은 최종 수익률보다
                      **버텼는가(최저 예수금)**와 **월 분배가 일정했는가(표준편차)**로 우열이 갈린다. */}
              <th className={`${TH} text-right`} title="영업일 곡선 전 구간에서 현금 합계(예수금 + 적립 분배금)가 가장 낮았던 값 — 0에 붙으면 목표를 복원할 수 없다">최저 현금</th>
              <th className={`${TH} text-right`} title="월별 분배금(분배락 기준)의 표준편차 — 작을수록 월 수입이 일정했다">월분배 표준편차</th>
              <th className={`${TH} text-right`}>최대 낙폭</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(({ cfg, result: r }) => {
              const s = r?.summary;
              return (
                <tr key={cfg.id} className={`border-t border-gray-800/70 ${cfg.id === bestId ? 'bg-emerald-950/25' : ''}`}>
                  <td className={`${TD} align-top`}>
                    <button
                      className="flex items-start gap-1.5 text-left hover:underline"
                      onClick={() => onOpen(cfg.id)}
                      title="이 시나리오의 상세 결과를 연다"
                    >
                      <Swatch color={colorOf(cfg.id)} className="mt-1.5" />
                      <span className="min-w-0">
                        <span className="block text-gray-200 font-bold">
                          {cfg.name}
                          {cfg.id === bestId && <span className="ml-1 text-[10px] text-emerald-400 font-normal">최고 수익률</span>}
                        </span>
                        {/* 시나리오 평가 — ⚠️ **열을 늘리지 않고** 이 셀 안에 넣는다. 열을 더하면
                            thead·실행불가 행 colSpan·비교 CSV를 모두 맞춰야 하고, 한 줄 결론은
                            표 셀에 담기엔 길다(검증 #241이 열 수와 colSpan을 대조한다). */}
                        {(ratingKey(reviewOf(cfg).rating) !== 'none' || String(reviewOf(cfg).verdict || '').trim()) && (
                          <span className="block text-[10px] leading-tight">
                            <RatingChip rating={reviewOf(cfg).rating} />
                            {String(reviewOf(cfg).verdict || '').trim() && (
                              <span className="text-gray-400"> {reviewOf(cfg).verdict}</span>
                            )}
                          </span>
                        )}
                        <span className="block text-[10px] text-gray-600 leading-tight">{scenarioSubtitle(cfg, s)}</span>
                      </span>
                    </button>
                  </td>
                  {/* ⚠️ colSpan은 위 thead의 **지표 열 수와 반드시 같아야 한다**(시나리오 열 제외).
                          열을 더하고 여기를 안 고치면 실행 불가 행부터 표 정렬이 통째로 어긋난다. */}
                  {!r?.ok || !s ? (
                    <td colSpan={11} className={`${TD} text-amber-300/90 text-[11px]`}>
                      <AlertCircle size={10} className="inline -mt-0.5 mr-1" />
                      {r?.fatal || '실행할 수 없는 설정입니다.'}
                    </td>
                  ) : (
                    <>
                      <td className={`${COL} text-gray-100 font-bold`}>{won(s.finalTotal)}</td>
                      <td className={`${COL} ${pnlCls(s.profit)}`}>{wonSigned(s.profit)}</td>
                      <td className={`${COL} font-bold ${pnlCls(s.profit)}`}>{pctText(s.profitRate)}</td>
                      <td className={`${COL} ${pnlCls(s.cumTradeNet)}`}>{wonSigned(s.cumTradeNet)}</td>
                      <td className={`${COL} text-emerald-300`}>{won(s.cumDivAccrued)}</td>
                      <td className={`${COL} ${s.cumReinvestNet ? 'text-sky-300' : 'text-gray-700'}`}>
                        {s.cumReinvestNet ? won(-s.cumReinvestNet) : '-'}
                      </td>
                      <td className={`${COL} text-gray-300`}>{won(s.finalCashTrade)}</td>
                      <td className={`${COL} text-emerald-300`}>{won(s.finalCashDiv)}</td>
                      <td className={`${COL} ${(s.minCash?.value ?? 0) < 0 ? 'text-blue-400 font-bold' : 'text-gray-300'}`}
                        title={s.minCash?.date ? `${s.minCash.date} 기준` : undefined}>
                        {won(s.minCash?.value ?? 0)}
                      </td>
                      <td className={`${COL} text-gray-400`}
                        title={`월 평균 ${won(s.divMonthlyAvg)} · 표준편차 ${won(s.divMonthlyStdev)}`}>
                        {won(s.divMonthlyStdev)}
                      </td>
                      <td className={`${COL} text-gray-400`}>{s.maxDrawdown.toFixed(2)}%</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ② 겹친 차트 */}
      {series.length > 0 && (
        <div className="border border-gray-800 rounded-lg p-2 bg-gray-900/40 mb-4 bt-month">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[11px] font-bold text-gray-400">자산 추이 비교</span>
            <div className="flex-1" />
            <div className="flex gap-1 bt-noprint">
              {[['won', '금액 ₩'], ['pct', '수익률 %']].map(([v, l]) => (
                <button key={v} onClick={() => onMode(v)}
                  className={`${BTN} ${mode === v ? 'text-sky-200 border-sky-600 bg-sky-900/40' : 'text-gray-500 border-gray-700 hover:bg-gray-800'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <CompareChart series={series} mode={mode} />
          <p className="text-[9px] text-gray-600 mt-1">
            {mode === 'pct'
              ? '각 시나리오의 시작 시점을 0%로 놓고 정규화했습니다(기간·초기 투자금이 달라도 비교 가능).'
              : '총자산(종목 평가액 + 예수금)을 그대로 그렸습니다. 기간이 다른 시나리오는 자기 구간에만 선이 있습니다.'}
          </p>
        </div>
      )}

      {/* ③ 시나리오별 블록 — 사진1과 같은 구성(요약 카드 + 개별 차트) */}
      {okRuns.map(({ cfg, result: r }) => (
        <div key={cfg.id} className="mb-4 bt-month">
          <div className="flex items-center gap-1.5 mb-1">
            <Swatch color={colorOf(cfg.id)} />
            <h3 className="text-sm font-bold text-gray-200">{cfg.name}</h3>
            <button className="text-[11px] text-sky-400 hover:underline bt-noprint" onClick={() => onOpen(cfg.id)}>
              상세 보기
            </button>
            {r.warnings.length > 0 && (
              <span className="text-[11px] text-amber-400/90" title={r.warnings.join('\n')}>
                <AlertCircle size={11} className="inline -mt-0.5" /> 확인 {r.warnings.length}건
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-600 mb-1.5">{scenarioSubtitle(cfg, r.summary)}</p>
          {/* 시나리오 평가 — 비교 PDF에서도 각 블록에 결론이 함께 실린다(읽기 전용).
              ⚠️ 편집은 단일 뷰에서만 한다 — 비교 뷰는 active가 null이라 patchActive가 무동작이고,
                 카드의 draft 소유자 판정(ownerRef)도 여기서는 성립하지 않는다. */}
          {(ratingKey(reviewOf(cfg).rating) !== 'none' || String(reviewOf(cfg).verdict || '').trim()) && (
            <p className="text-[12px] mb-1.5">
              <RatingChip rating={reviewOf(cfg).rating} />
              {String(reviewOf(cfg).verdict || '').trim() && <span className="text-gray-300"> — {reviewOf(cfg).verdict}</span>}
            </p>
          )}
          <SummaryCards result={r} compact />
          <StrategyKpis result={r} cfg={cfg} compact />
          <div className="border border-gray-800 rounded-lg p-2 bg-gray-900/40">
            <CurveChart curve={r.curve} />
          </div>
        </div>
      ))}

      <div className="border-t border-gray-800 pt-2 text-[12px] text-gray-600 leading-relaxed">
        <div className="flex items-start gap-1">
          <HelpCircle size={12} className="mt-0.5 shrink-0" />
          <div>
            <p>
              모든 값은 각 시나리오 상세 화면의 요약 카드와 <b>같은 계산 결과</b>입니다.
              '분배금 재투자'는 지급받은 분배금으로 다시 매수한 총액이며,
              <b> 누적 매매차익에는 포함하지 않습니다</b>(구조 변경 매매와 같은 규약).
            </p>
            <p>
              초기 투자금이나 기간이 다른 시나리오를 나란히 볼 때는 최종 자산 대신
              <b> 수익률</b>과 <b>수익률 % 차트</b>로 비교하세요.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export default function BacktestPage({
  open = true,
  variant = 'overlay',
  onClose,
  scenarios = [],
  onUpdateScenarios,
  flushRef,
  catalog = [],
  prices = {},
  dividends = {},
  holidays = [],
  readOnly = false,
  onFetchCode,
  fetchingCodes = [],
  onOpenWindow,
  notice = '',
}) {
  // ── 로컬 사본 + idle 승격 ────────────────────────────────────────────────
  const [local, setLocalState] = useState(scenarios);
  const localRef = useRef(scenarios);
  const dirtyRef = useRef(false);
  const idleRef = useRef(null);

  /**
   * 승격 직후 되돌아오는 **낡은 에코**를 무시하기 위한 대기표 `{ fp, until }`.
   *
   * 별도 브라우저 창은 편집을 postMessage로 앱 탭에 보내고, 앱 탭은 `backtest:live`로 시나리오를
   * 되돌려 보낸다. 그런데 ① 앱 탭은 백그라운드라 타이머·렌더가 스로틀되고 ② 시세 조회 완료
   * (btPrices·btFetching 변경)도 **같은 backtest:live를 쏜다**. 그래서 승격 **이전** 상태로 만들어진
   * 메시지가 승격 직후(dirty=false)에 도착해, 방금 입력한 종목별 목표값을 직전 상태(대개
   * '종목 수로 균등 분배'를 눌렀던 값)로 통째로 되돌릴 수 있다.
   * → 승격한 값이 한 번 되돌아오기 전까지(또는 유예시간이 지나기 전까지)는 다른 값을 채택하지 않는다.
   *
   * ⚠️ **승격한 적이 없으면(pending null) 종전대로 즉시 채택**한다 — Drive 로드가 LoadingOverlay
   *    해제(20초)보다 늦게 도착하는 경로를 막는 안전장치라 절대 없애지 말 것(FlowBoard 선례).
   * ⚠️ 인앱 오버레이는 onUpdateScenarios가 setBacktestScenarios라 다음 렌더에 참조가 그대로
   *    돌아오고, 아래 fast path가 대기표를 즉시 지운다 → 이 가드는 사실상 **별도 창 전용**이다.
   */
  const pendingEchoRef = useRef(null);

  /**
   * 시나리오 평가 카드의 **미커밋 draft 커밋 훅**(ScenarioReviewCard가 등록).
   * ⚠️ promote는 `localRef`(이미 커밋된 로컬 사본)만 회수하므로 자식 state에 있는 draft를 전혀
   *    보지 못한다 — 이 훅이 없으면 앱 종료 커밋·페이지 언마운트에서 방금 붙여넣은 AI 분석이
   *    통째로 유실된다(App.tsx의 flushRebalTargetSnapshot 동기 주입과 같은 근거).
   */
  const reviewFlushRef = useRef(null);
  const registerReviewFlush = useCallback((fn) => { reviewFlushRef.current = fn; }, []);
  /** draft → 로컬 사본. 승격·인쇄·CSV처럼 '지금 값'을 읽어야 하는 지점의 첫 줄에서 부른다. */
  const flushReview = useCallback(() => {
    try { reviewFlushRef.current?.(); } catch {}
  }, []);

  const promote = useCallback(() => {
    // ⚠️ 순서 고정 — flush가 setLocal을 태워 idle 타이머를 다시 걸므로 **flush → 타이머 정리 →
    //    dirty 판정** 이어야 한다. 반대로 두면 승격 직후 빈 타이머가 남는다.
    flushReview();
    if (idleRef.current) { clearTimeout(idleRef.current); idleRef.current = null; }
    if (!dirtyRef.current) return null;      // ⚠️ 승격할 게 없으면 반드시 null (종료 커밋 강제 방지)
    dirtyRef.current = false;
    const next = localRef.current;
    let fp = '';
    try { fp = backtestFingerprint(next); } catch { fp = ''; }
    pendingEchoRef.current = fp ? { fp, until: Date.now() + ECHO_GRACE_MS } : null;
    onUpdateScenarios?.(next);
    return next;
  }, [onUpdateScenarios, flushReview]);

  const setLocal = useCallback((updater) => {
    if (readOnly) return;
    const prev = localRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    localRef.current = next;
    setLocalState(next);
    dirtyRef.current = true;
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => { idleRef.current = null; promote(); }, IDLE_MS);
  }, [promote, readOnly]);

  // 상위에서 늦게 도착한 값 채택 — 편집 중(dirty)에는 채택하지 않는다(last-writer-wins).
  // ⚠️ Drive 로드가 LoadingOverlay 해제(20초)보다 늦으면 빈 배열로 시작하는데, 여기서 채택하지
  //    않으면 도형 하나 그리자마자 저장돼 있던 시나리오 전체가 빈 배열로 대체된다(FlowBoard 선례).
  useEffect(() => {
    if (dirtyRef.current) return;
    if (scenarios === localRef.current) { pendingEchoRef.current = null; return; }
    const pend = pendingEchoRef.current;
    if (pend) {
      if (Date.now() > pend.until) {
        pendingEchoRef.current = null;              // 유예 만료 — 종전 동작으로 복귀
      } else {
        let fp = '';
        try { fp = backtestFingerprint(scenarios); } catch { fp = ''; }
        if (fp !== pend.fp) return;                 // 낡은 에코 — 방금 입력한 목표값을 지키고 무시
        pendingEchoRef.current = null;              // 내가 올린 값이 되돌아왔다 — 정상 수렴
      }
    }
    localRef.current = scenarios;
    setLocalState(scenarios);
  }, [scenarios]);

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = promote;
    return () => { flushRef.current = null; };
  }, [flushRef, promote]);

  // 언마운트 시 승격 — 그냥 사라지면 편집이 유실된다.
  useEffect(() => () => { promote(); }, [promote]);

  // ⚠️ 별도 브라우저 창(variant='page')에는 App의 종료 커밋 체인(backtestExitCommitRef)이 없다 —
  //    창을 닫으면 최대 2.5초분의 미승격 편집이 **어떤 저장 경로로도 회수되지 않는다**. 짧은
  //    설정값 편집에서는 체감이 없었지만, AI 분석을 붙여넣고 곧바로 창을 닫는 것이 이 기능의
  //    주 사용 시나리오라 유실 체감이 완전히 다르다. promote는 dirty가 없으면 null을 반환하고
  //    아무것도 하지 않으므로 부작용이 없다(종료 커밋 강제 방지 규약 그대로).
  useEffect(() => {
    if (variant !== 'page') return;
    const onHide = () => { try { promote(); } catch {} };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [variant, promote]);

  // ── 활성 시나리오 ────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState('');
  /** 비교 종합 뷰인가. 시나리오가 하나도 없으면 비교할 것도 없으므로 자동 해제된다. */
  const isCompare = activeId === COMPARE_ID && local.length > 0;
  const active = useMemo(
    () => (activeId === COMPARE_ID ? null : local.find((s) => s.id === activeId) || local[0] || null),
    [local, activeId],
  );
  useEffect(() => {
    if (!local.length) return;
    // ⚠️ COMPARE_ID는 시나리오 배열에 없는 예약값이라 여기서 걸러 내야 한다 —
    //    안 그러면 비교 뷰를 열자마자 첫 시나리오로 되돌아간다.
    if (activeId === COMPARE_ID) return;
    if (!local.some((s) => s.id === activeId)) setActiveId(local[0].id);
  }, [local, activeId]);

  /** 시나리오 색상 — **local 안의 위치**로 고정한다(비교 체크를 껐다 켜도 색이 안 바뀐다). */
  const colorOfScenario = useCallback(
    (id) => {
      const i = local.findIndex((s) => s.id === id);
      return BT_COLORS[(i < 0 ? 0 : i) % BT_COLORS.length];
    },
    [local],
  );

  const patchActive = useCallback((patch) => {
    setLocal((prev) => prev.map((s) => (s.id === (active?.id) ? { ...s, ...patch, updatedAt: Date.now() } : s)));
  }, [setLocal, active?.id]);

  /**
   * **id 기준** 시나리오 패치. patch는 객체 또는 `(s) => 부분객체` 함수.
   *
   * ⚠️ 평가 카드처럼 **늦게(blur/언마운트에) 커밋**하는 UI는 patchActive를 쓰면 안 된다 —
   *    patchActive는 렌더 시점의 `active?.id`를 클로저로 잡으므로, 타이핑 중 시나리오를 바꾸면
   *    draft가 **새로 선택된 시나리오에 기록**된다(흐름도 patchNodeById와 같은 근거).
   * ⚠️ 계산된 패치가 비면 **아무것도 쓰지 않는다** — 빈 패치라도 updatedAt을 올리면 지문이 바뀌어
   *    Drive 4파일 write가 나가고 별도 창의 에코 경합이 무의미하게 발생한다(NumInput 조기 return).
   */
  const patchScenarioById = useCallback((id, patch) => {
    setLocal((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== id) return s;
        const p = typeof patch === 'function' ? patch(s) : patch;
        if (!p || Object.keys(p).length === 0) return s;
        changed = true;
        return { ...s, ...p, updatedAt: Date.now() };
      });
      return changed ? next : prev;
    });
  }, [setLocal]);

  /**
   * 비교 종합 포함 토글.
   * ⚠️ patchActive를 쓸 수 없다 — 비교 뷰에서는 active가 null이라 아무 일도 일어나지 않는다.
   *    반드시 **id 기준**으로 쓴다(흐름도 인스펙터의 patchNodeById와 같은 근거).
   * ⚠️ 기본값이 true(필드 부재 포함)라 토글은 `=== false` 로 판정한다.
   */
  const toggleCompare = useCallback((id) => {
    setLocal((prev) => prev.map((s) => (
      s.id === id ? { ...s, compareOn: s.compareOn === false, updatedAt: Date.now() } : s
    )));
  }, [setLocal]);

  const addScenario = (from = null) => {
    if (local.length >= MAX_BT_SCENARIOS) return;
    const base = from
      ? makeBtConfig({ ...JSON.parse(JSON.stringify(from)), id: generateId(), name: `${from.name} 사본` })
      : makeBtConfig({
          name: `백테스트 ${local.length + 1}`,
          startDate: '', endDate: '', initialCapital: 100000000,
          assets: [], events: [], overrides: [],
        });
    // ⚠️ id 생성은 업데이터 **밖**에서 — StrictMode의 업데이터 이중 호출에서 서로 다른 id가
    //    만들어지고 React는 두 번째 결과만 채택해 선택이 어긋난다(FlowBoard 순수성 규약).
    setLocal((prev) => [...prev, base]);
    setActiveId(base.id);
    // 새 시나리오는 곧바로 설정해야 하므로, 접어 둔 상태였다면 자동으로 펼친다.
    setSettingsOpen(true);
  };

  const removeScenario = (id) => {
    setLocal((prev) => prev.filter((s) => s.id !== id));
  };

  // ── 실행 (디바운스) ──────────────────────────────────────────────────────
  const [runCfg, setRunCfg] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setRunCfg(active), RUN_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [active]);

  const result = useMemo(() => {
    if (!runCfg) return null;
    try {
      return runBacktest({ config: runCfg, prices, dividends, holidays });
    } catch (err) {
      // ⚠️ 예외를 위로 던지지 말 것 — 렌더 중 TypeError가 루트 ErrorBoundary까지 올라가면
      //    앱 화면 전체가 오류 페이지로 대체된다(convertFx·edgePath의 null 계약과 동일 근거).
      return { ok: false, fatal: `계산 중 오류가 발생했습니다: ${String(err?.message || err)}`, warnings: [], months: [], slots: [], assetMeta: [], initialTrades: [], curve: [], finalHoldings: [], summary: null };
    }
  }, [runCfg, prices, dividends, holidays]);

  // ── 비교 종합 실행 ───────────────────────────────────────────────────────
  // ⚠️ 단일 뷰와 **같은 디바운스**를 태운다 — 체크박스를 연속으로 누르면 최대 10개 백테스트가
  //    매 클릭 재실행되므로, 여기만 즉시 실행으로 두면 체감 반응이 눈에 띄게 나빠진다.
  // ⚠️ 비교 뷰가 아닐 때는 아예 계산하지 않는다(btActive 게이팅과 같은 근거 — 안 쓰는 화면의
  //    비용을 항상 치를 이유가 없다).
  const [runAll, setRunAll] = useState(null);
  useEffect(() => {
    if (!isCompare) return;
    // ⚠️ 첫 진입은 즉시 — 디바운스를 태우면 220ms 동안 "0개 선택됨" 빈 화면이 뜨고
    //    PDF·CSV 버튼이 비활성으로 깜빡인다(사용자가 '아무것도 없다'고 오해한다).
    //    이후 편집은 디바운스를 태운다. 같은 참조를 다시 넣으면 React가 bail out 하므로 루프는 없다.
    if (runAll === null) { setRunAll(local); return; }
    const t = setTimeout(() => setRunAll(local), RUN_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [isCompare, local, runAll]);

  const compareRuns = useMemo(() => {
    if (!isCompare || !runAll) return [];
    return runAll
      .filter((s) => s.compareOn !== false)
      .map((cfg) => {
        try {
          return { cfg, result: runBacktest({ config: cfg, prices, dividends, holidays }) };
        } catch (err) {
          return {
            cfg,
            result: {
              ok: false, fatal: `계산 중 오류가 발생했습니다: ${String(err?.message || err)}`,
              warnings: [], months: [], slots: [], assetMeta: [], initialTrades: [],
              curve: [], finalHoldings: [], summary: null,
            },
          };
        }
      });
  }, [isCompare, runAll, prices, dividends, holidays]);

  const compareOk = useMemo(() => compareRuns.filter((r) => r.result?.ok), [compareRuns]);
  /** 겹친 차트 기본 모드 — 초기 투자금이 시나리오마다 다르면 금액 비교가 무의미하므로 %로 시작한다. */
  const [cmpMode, setCmpMode] = useState('won');
  const capitalsDiffer = useMemo(() => {
    const set = new Set(compareOk.map((r) => Math.round(r.cfg.initialCapital + r.cfg.extraCash)));
    return set.size > 1;
  }, [compareOk]);
  useEffect(() => { if (capitalsDiffer) setCmpMode('pct'); }, [capitalsDiffer]);

  const compareSeries = useMemo(
    () => compareOk.map((r) => ({
      id: r.cfg.id, name: r.cfg.name, color: colorOfScenario(r.cfg.id), curve: r.result.curve,
    })),
    [compareOk, colorOfScenario],
  );

  // ── 설정 패널 접기 ───────────────────────────────────────────────────────
  // ⚠️ 세션 로컬 상태다(Drive 저장 지점 0곳) — 저장하려면 chartPrefs 5지점을 모두 손대야 하는데
  //    이건 '지금 화면을 넓게 볼까'라는 순간 선호도라 그 비용을 치를 값이 아니다.
  const [settingsOpen, setSettingsOpen] = useState(true);

  // ── 종목 추가 ────────────────────────────────────────────────────────────
  const [newCode, setNewCode] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteCode, setPasteCode] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');

  const catalogByCode = useMemo(() => {
    const m = {};
    for (const c of catalog) m[c.code] = c;
    return m;
  }, [catalog]);

  // 종목명이 **뒤늦게** 해석되면(코드만 입력한 신규 종목) 자산 이름을 채운다.
  // ⚠️ addAsset은 추가 시점의 카탈로그를 스냅샷하므로, 조회가 비동기로 끝나는 코드는 이름이
  //    코드인 채로 굳는다("포트폴리오 테이블에 먼저 넣어야 이름이 뜬다"의 마지막 조각).
  // ⚠️ 이름은 사용자가 직접 고칠 수 있는 필드라(아래 name input) **아직 코드 그대로인 행만**
  //    건드린다. 바뀐 게 없으면 setLocal이 같은 참조를 받아 dirty를 세우지 않는다(저장 폭주 방지).
  useEffect(() => {
    if (readOnly) return;
    setLocal((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!Array.isArray(s?.assets)) return s;
        let touched = false;
        const assets = s.assets.map((a) => {
          if (!a?.code || (a.name && a.name !== a.code)) return a;
          const nm = catalogByCode[a.code]?.name;
          if (!nm || nm === a.code) return a;
          touched = true;
          return { ...a, name: nm };
        });
        if (!touched) return s;
        changed = true;
        return { ...s, assets, updatedAt: Date.now() };
      });
      return changed ? next : prev;
    });
  }, [catalogByCode, readOnly, setLocal]);

  const addAsset = (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c || !active) return;
    if (active.assets.length >= MAX_BT_ASSETS) return;
    if (active.assets.some((a) => a.code === c)) return;
    const meta = catalogByCode[c];
    const asset = makeBtAsset({
      code: c,
      name: meta?.name || c,
      payCycle: 'eom',
      targetAmount: active.targetMode === 'amount' ? null : null,
      targetRatio: null,
    }, active.assets.length);
    patchActive({ assets: [...active.assets, asset] });
    setNewCode('');
    // ⚠️ prices[c] 유무와 무관하게 **항상** 요청한다 — 이 호출이 App에 "이 코드를 쓴다"를
    //    등록하는 유일한 경로이고(btRequested), App이 저장된 종가가 있으면 네트워크를 생략한다.
    //    여기서 `!prices[c]` 로 거르면 승격 전까지 코드가 등록되지 않아 종가가 안 뜬다.
    onFetchCode?.(c);
  };

  const patchAsset = (id, patch) => {
    patchActive({ assets: active.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  };
  const removeAsset = (id) => {
    patchActive({
      assets: active.assets.filter((a) => a.id !== id),
      events: active.events.map((e) => ({
        ...e,
        addAssets: e.addAssets.filter((x) => x !== id),
        removeAssets: e.removeAssets.filter((x) => x !== id),
        targets: e.targets.filter((t) => t.assetId !== id),
      })),
      // ⚠️ 그 종목만 겨냥한 월별 오버라이드도 같이 지운다 — 남겨 두면 select 의 값
      //    `a:<삭제된 id>` 에 대응하는 option 이 없어 브라우저가 첫 항목('월중 일괄' 등)을
      //    표시하고, 사용자가 다른 칸을 건드리는 순간 조용히 그 그룹 일괄로 바뀐다.
      overrides: active.overrides.filter((o) => o.assetId !== id),
    });
  };

  /**
   * ⑥ 종목의 목표 합계 요약 — "내가 넣은 값이 재원(또는 100%)에 대해 어디쯤인가".
   *
   * ⚠️ 순수 **표시용**이다. 엔진은 합이 100%가 아니어도, 재원을 넘겨도 그대로 실행한다(경고만) —
   *    합계가 맞아야만 실행되는 것처럼 보이면 사용자가 자유 입력을 포기한다.
   */
  const targetSummary = useMemo(() => {
    if (!active) return null;
    const mode = active.targetMode;
    const isAmt = mode === 'amount';
    const assets = active.assets || [];
    const filled = assets.filter((a) => hasTargetOf(a, mode));
    const sum = filled.reduce((s, a) => s + targetValOf(a, mode), 0);
    // ⚠️ 목표 금액의 기준은 **초기 투자금뿐**이다 — 추가 예수금은 초기 매수에 쓰지 않으므로
    //    (사용자 확정 2026-08) 여기에 더하면 도달할 수 없는 목표 합계를 'ok'로 표시하게 된다.
    const capital = numOf(active.initialCapital);
    const goal = isAmt ? capital : 100;
    const diff = sum - goal;
    // 허용 오차 — 금액은 1원, 비중은 반올림 잔차(엔진 RATIO_SUM_TOL과 같은 0.05%p).
    const tol = isAmt ? 1 : 0.05;
    const level = assets.length === 0 || Math.abs(diff) <= tol
      ? 'ok'
      : diff > 0 ? 'over' : 'under';
    return {
      mode, isAmt, sum, goal, diff, capital, level,
      count: assets.length, filledCount: filled.length, emptyCount: assets.length - filled.length,
    };
  }, [active]);

  /** 이미 입력된 목표값이 하나라도 있는가 — 균등 분배가 '덮어쓰기'가 되는지 판정. */
  const hasAnyTarget = !!targetSummary && targetSummary.filledCount > 0;

  /** 균등 분배 덮어쓰기 확인 단계. 모드·시나리오가 바뀌면 반드시 초기화한다. */
  const [evenConfirm, setEvenConfirm] = useState(false);
  useEffect(() => { setEvenConfirm(false); }, [active?.id, active?.targetMode]);

  /**
   * 비어 있는(미입력) 종목에만 남은 재원을 균등 배분한다 — 금액 모드 전용.
   * ⚠️ **이미 입력된 값은 절대 건드리지 않는다.** 이 버튼의 존재 이유가 그것이다
   *    ('종목 수로 균등 분배'는 전부 덮어쓰므로 확인을 받고, 이쪽은 확인이 필요 없다).
   */
  const fillEmptyTargets = () => {
    if (!active || active.targetMode !== 'amount') return;
    const assets = active.assets || [];
    const empties = assets.filter((a) => !hasTargetOf(a, 'amount'));
    if (!empties.length) return;
    const used = assets.reduce((s, a) => s + (hasTargetOf(a, 'amount') ? Math.max(0, targetValOf(a, 'amount')) : 0), 0);
    const remain = Math.max(0, numOf(active.initialCapital) - used);
    const each = Math.floor(remain / empties.length);
    if (!(each > 0)) return;
    patchActive({ assets: assets.map((a) => (hasTargetOf(a, 'amount') ? a : { ...a, targetAmount: each })) });
  };

  /** 목표를 균등 분배 — 금액 모드는 초기 투자금 ÷ N (추가 예수금 제외), 비중 모드는 100 ÷ N */
  const splitEven = () => {
    setEvenConfirm(false);
    if (!active || !active.assets.length) return;
    const n = active.assets.length;
    if (active.targetMode === 'amount') {
      const each = Math.floor(numOf(active.initialCapital) / n);
      patchActive({ assets: active.assets.map((a) => ({ ...a, targetAmount: each })) });
    } else {
      // ⚠️ 마지막 종목이 반올림 잔여를 흡수해 합을 정확히 100%로 맞춘다 — 안 그러면 3·6·7·9·12…
      //    종목에서 합이 99.99/100.02/100.03이 되어, 사용자가 손댄 적 없는 **앱 자신의 버튼**이
      //    엔진의 '비중 합 100% 아님' 경고를 띄운다(경고 도배로 진짜 경고가 묻힌다).
      const each = Math.round((100 / n) * 100) / 100;
      const last = Math.round((100 - each * (n - 1)) * 100) / 100;
      patchActive({ assets: active.assets.map((a, i) => ({ ...a, targetRatio: i === n - 1 ? last : each })) });
    }
  };

  // ── 시나리오 평가 · 메모 ─────────────────────────────────────────────────
  /**
   * 메모 추가 — **작성 시점의 조건 요약과 헤드라인 결과를 함께 박제**한다.
   * ⚠️ 스냅샷 지문은 `backtestSettingsFingerprint`(결과에 영향 주는 필드만)를 쓴다.
   *    `backtestFingerprint`를 쓰면 그 안에 notes 자신이 들어 있어 메모를 추가하는 순간 지문이
   *    달라지고, 결과적으로 **모든 메모가 영구히 '설정이 바뀜'** 으로 표시된다.
   * ⚠️ id 생성은 setLocal 업데이터 **밖**에서 — StrictMode의 업데이터 이중 호출에서 서로 다른
   *    id가 만들어진다(addScenario와 같은 순수성 규약).
   */
  const addNote = useCallback((kind) => {
    if (!active || readOnly) return;
    if (notesOf(active).length >= MAX_BT_NOTES) return;
    // ⚠️ 조건(conditions·fp)과 숫자(summary)는 **반드시 같은 config**에서 가져온다.
    //    설정 칸을 고친 직후 곧바로 [AI 분석]을 누르면 그 클릭의 mousedown이 blur→커밋을 먼저
    //    태워 `active`는 이미 새 값인데, `result`는 220ms 디바운스라 아직 **옛 실행분**이다.
    //    섞으면 "새 조건 + 옛 숫자"가 영구 박제되고, `fp`도 현재와 같아져 '설정이 바뀌었습니다'
    //    배지마저 뜨지 않는다 — 배지의 존재 이유(분석이 조용히 거짓이 되는 것 방지)가 무력화된다.
    //    → 결과를 낸 그 config(`runCfg`)를 그대로 박제한다. 그러면 설정이 앞서 나간 경우 지문이
    //    자연히 어긋나 배지가 즉시 켜진다(= 정확히 의도한 동작).
    // ⚠️ `runCfg.id === active.id` 확인 필수 — 시나리오를 막 바꾼 220ms 동안 runCfg는 **직전
    //    시나리오**를 가리킨다(그 config를 이 시나리오의 메모에 박으면 전혀 다른 설정이 남는다).
    const ranCfg = runCfg && runCfg.id === active.id ? runCfg : null;
    const s = ranCfg && result?.ok ? result.summary : null;
    const src = s ? ranCfg : active;
    const ts = Date.now();
    const note = {
      id: generateId(),
      kind: kind === 'user' ? 'user' : 'ai',
      title: '',
      body: '',
      snapshot: {
        conditions: scenarioSubtitle(src, s),
        fp: (() => { try { return backtestSettingsFingerprint(src); } catch { return ''; } })(),
        finalTotal: s ? s.finalTotal : null,
        profit: s ? s.profit : null,
        profitRate: s ? s.profitRate : null,
        period: s ? `${s.startDate} ~ ${s.endDate}` : `${src.startDate || '?'} ~ ${src.endDate || '?'}`,
      },
      createdAt: ts,
      updatedAt: ts,
    };
    patchScenarioById(active.id, (cur) => ({ notes: [...notesOf(cur), note] }));
  }, [active, readOnly, result, runCfg, patchScenarioById]);

  // ── 인쇄 ────────────────────────────────────────────────────────────────
  // ⚠️ 첫 줄에서 draft를 커밋한다 — 인쇄 자체는 아래 `.bt-printonly` 미러가 draft를 그대로 읽어
  //    안전하지만, 인쇄 직후 화면·CSV가 방금 친 내용과 어긋나 보이는 것을 막는다.
  const doPrint = () => { flushReview(); try { window.print(); } catch {} };

  // ── 결과 CSV ────────────────────────────────────────────────────────────
  const downloadCsv = () => {
    if (!result?.ok || !active) return;
    // ⚠️ 평가 카드의 draft를 먼저 커밋하고, **로컬 사본에서 다시 읽는다** — flushReview는
    //    setState라 이 렌더의 `active`에는 반영되지 않는다(그대로 쓰면 방금 친 메모가 빠진다).
    flushReview();
    const cfgNow = (localRef.current || []).find((s) => s.id === active.id) || active;
    // ⚠️ 열 구성은 화면 표와 1:1로 유지할 것 — 갈리면 "화면과 CSV가 다르다"가 된다.
    const rows = [[
      '구분', '리밸런싱일', '종목', '종가', '리밸런싱 전 평가액', '매수/매도 수량',
      '리밸런싱 매매금액', '조정 후 수량', '조정 후 평가액', '분배락일', '지급일', '주당 분배금', '지급 분배금',
    ]];
    for (const t of result.initialTrades) {
      rows.push(['초기매수', t.date, `${t.name}(${t.code})`, t.price, Math.round(t.evalBefore),
        t.qty, Math.round(t.cashDelta), t.qtyAfter, Math.round(t.evalAfter), '', '', '', '']);
    }
    for (const m of result.months) {
      const { rows: joined, orphans } = joinTradeDividends(m.trades, m.dividends);
      for (const { trade: t, dividend: d } of joined) {
        // ⚠️ 시그널 매매를 '리밸런싱'으로 뭉뚱그리면 CSV만 받아 본 사람은 policy:'none'인데도
        //    매매 행이 가득한 이유를 알 수 없고, 재조정 매도는 출처가 통째로 사라진다.
        rows.push([t.reinvest ? '분배금재투자' : t.structural ? '구조변경'
          : t.signal === 'buy' ? '시그널매수' : t.signal === 'sell' ? '시그널매도'
            : t.signal === 'realloc' ? '시그널재조정' : '리밸런싱',
          t.date, `${t.name}(${t.code})`, t.price,
          Math.round(t.evalBefore), t.qty, Math.round(t.cashDelta), t.qtyAfter, Math.round(t.evalAfter),
          d?.exDate || '', d?.payDate || '', d?.perShare ?? '', d ? Math.round(d.amount) : '']);
      }
      for (const d of orphans) {
        rows.push(['분배금만', '', `${d.name}(${d.code})`, '', '', '', '', d.qty, '', d.exDate, d.payDate, d.perShare, Math.round(d.amount)]);
      }
      // ⚠️ 화면 tfoot과 **같은 규칙** — 같은 종목이 그 달에 두 번 이상 거래되면 평가액 합은
      //    중복 계상이므로 비운다(정확한 시점 정합 총액은 바로 아래 '월말보유' 행들의 합).
      const dup = new Set<string>();
      let dupTraded = false;
      for (const t of m.trades) { if (dup.has(t.assetId)) { dupTraded = true; break; } dup.add(t.assetId); }
      rows.push([`${m.ym} 합계`, '', '', '', dupTraded ? '' : Math.round(m.evalBeforeSum), '', Math.round(m.tradeNet), '',
        dupTraded ? '' : Math.round(joined.reduce((s, r) => s + r.trade.evalAfter, 0)), '', '', '', Math.round(m.divAccrued)]);
      // 매월 목표 증액 — 화면 sky 블록과 동일 소스
      if (m.contribution && m.contribution.amount > 0) {
        const c = m.contribution;
        rows.push([`${m.ym} 목표증액`, c.date, c.mode === 'pctOfCash' ? `예수금 ${c.value}%` : '고정 금액',
          '', Math.round(c.cashBefore), '', Math.round(c.amount), '', '', '', '', '', '']);
        for (const x of c.perAsset) {
          if (!(x.added > 0)) continue;
          rows.push([`${m.ym} 증액배분`, c.date, `${x.name}(${x.code})`, '', '', '',
            Math.round(x.added), '', Math.round(x.targetAfter), '', '', '', '']);
        }
      }
      // 연간 가드레일 증액 — 화면 teal 블록과 동일 소스(매월 증액과 별개 행)
      if (m.annualReview && m.annualReview.amount > 0) {
        const a = m.annualReview;
        rows.push([`${m.ym} 연간증액`, a.date, `잉여의 ${a.value}% (예약금 ${Math.round(a.reserve || 0)})`,
          '', Math.round(a.cashBefore), '', Math.round(a.amount), '', '', '', '', '', '']);
        for (const x of a.perAsset) {
          if (!(x.added > 0)) continue;
          rows.push([`${m.ym} 연간배분`, a.date, `${x.name}(${x.code})`, '', '', '',
            Math.round(x.added), '', Math.round(x.targetAfter), '', '', '', '']);
        }
      }
      // 시그널 리밸런싱 — 화면 amber 블록과 **같은 소스·같은 문구**(sigLabel/sigOutcomeText 공유).
      // ⚠️ 13열 고정. 열 수가 어긋나면 엑셀에서 조용히 밀린다.
      for (const e of (result.summary.signalEvents || []).filter((x) => x.date.slice(0, 7) === m.ym)) {
        // ⚠️ 규모 계산식은 **열을 늘리지 않고** 마지막 '비고' 열에 체결 결과와 함께 적는다 —
        //    13열 고정이라 새 열을 끼우면 엑셀에서 뒤 열이 통째로 밀린다.
        rows.push([`${m.ym} 시그널`, e.date, `${e.name}(${e.code}) ${sigLabel(e)}`, Math.round(e.price),
          Math.round(e.ref), Math.round(e.tradeQty), Math.round(e.tradeAmount), '',
          Math.round(e.planned), Math.round(e.used), Math.round(e.reallocAmount), '',
          e.carrier ? sigSizeText(e, cfgNow) + ' · ' + sigOutcomeText(e, cfgNow) : sigOutcomeText(e, cfgNow)]);
      }
      // 밴드 생략 — 화면 월 요약과 동일 소스(생략은 거래 행이 남지 않으므로 이 줄이 유일한 흔적)
      if (m.bandSkipCount > 0) {
        rows.push([`${m.ym} 밴드생략`, '', `${m.bandSkipCount}건`, '', '', '', Math.round(m.bandSkipAmount), '', '', '', '', '', '']);
      }
      // 월말 보유 — 그 달에 거래가 없던 종목도 포함(화면 '월말 보유 현황'과 동일 소스)
      for (const h of m.holdings) {
        rows.push([`${m.ym} 월말보유`, m.lastDate, `${h.name}(${h.code})`, h.price, '', '', '',
          h.qty, Math.round(h.evalAmount), '', '', '', '']);
      }
      rows.push([`${m.ym} 누적`, '', '', '', '', '', Math.round(m.cumTradeNet), '', '', '', '', '', Math.round(m.cumDivAccrued)]);
      rows.push([`${m.ym} 현금`, '', '', '', '', '', Math.round(m.cashDelta), '', Math.round(m.evalEnd), '', '', '', Math.round(m.cashEnd)]);
    }
    // 기말 보유 + 예수금 원천별 세분화 — 화면 '기말 보유 현황' 표와 같은 소스.
    for (const h of result.finalHoldings) {
      rows.push(['기말보유', result.summary.endDate, `${h.name}(${h.code})`, h.price, '', '', '',
        h.qty, Math.round(h.evalAmount), '', '', '', '']);
    }
    // ⚠️ 두 그룹의 합이 각각 예수금·적립 분배금이 되는 항등식(검증 #110). 화면 '기말 보유 현황'과 같은 소스.
    //    ⚠️ 분배금 재투자를 켜면 cumReinvestNet 항이 빠질 수 없다 — 없으면 소계가 어긋난다.
    //    ⚠️ 원천징수를 켜면 '누적 분배금' 항은 **세후**다 — 세금은 애초에 입금되지 않은 돈이라
    //       이 그룹에 항을 더하면 합이 어긋난다. 세금은 아래 '참고' 행으로 따로 적는다.
    const taxedCsv = result.summary.cumDivTax > 0.5;
    for (const [label, value] of [
      ['초기 매수 후 잔여 + 추가 예수금', result.initialCashAfter],
      ['누적 매매차익', result.summary.cumTradeNet],
      ['종목 재편 순현금', result.summary.cumStructuralNet],
      ['분배금 재투자 매수', result.summary.cumReinvestNet],
      ['적립 분배금이 대신 낸 매수 대금', result.summary.cumDivDrawn],
    ]) {
      if (Math.round(value) === 0) continue;
      rows.push(['기말예수금 내역', '', label, '', '', '', '', '', Math.round(value), '', '', '', '']);
    }
    rows.push(['기말예수금 내역', '', '＝ 기말 예수금', '', '', '', '', '',
      Math.round(result.summary.finalCashTrade), '', '', '', '']);
    for (const [label, value] of [
      [`누적 분배금(지급 기준${taxedCsv ? ' · 세후' : ''})`, result.summary.cumDivPaid],
      ['매수에 사용한 분배금', -result.summary.cumDivDrawn],
    ]) {
      if (Math.round(value) === 0) continue;
      rows.push(['적립분배금 내역', '', label, '', '', '', '', '', Math.round(value), '', '', '', '']);
    }
    rows.push(['적립분배금 내역', '', '＝ 적립 분배금', '', '', '', '', '',
      Math.round(result.summary.finalCashDiv), '', '', '', '']);
    rows.push(['기말 합계', result.summary.endDate, '', '', '', '', '', '', Math.round(result.summary.finalEval),
      '', '', '', Math.round(result.summary.finalCash)]);
    // 전략 지표 + 설정 요약 — ⚠️ 위 항등식 그룹 **밖**이다(합계에 섞이면 안 된다).
    //    파일만 받아 본 사람이 "어떤 조건으로 돌린 결과인가"를 알 수 있어야 한다.
    for (const [label, value] of [
      ['최저 현금(예수금+적립 분배금)', `${Math.round(result.summary.minCash?.value ?? 0)} (${result.summary.minCash?.date || '-'})`],
      ['적립 분배금 최저점', `${Math.round(result.summary.minCashDiv?.value ?? 0)} (${result.summary.minCashDiv?.date || '-'})`],
      ['월 분배금 평균', Math.round(result.summary.divMonthlyAvg)],
      ['월 분배금 표준편차', Math.round(result.summary.divMonthlyStdev)],
      ['밴드 생략', `${result.summary.bandSkipCount}건 / ${Math.round(result.summary.bandSkipAmount)}`],
      ['시그널 발동', `${result.summary.signalEvents.length}건`
        + ` (매수 ${result.summary.signalEvents.filter((e) => e.kind === 'buy').length}`
        + ` / 매도 ${result.summary.signalEvents.filter((e) => e.kind === 'sell').length}`
        + ` · 체결 ${result.summary.signalEvents.filter((e) => e.tradeQty !== 0).length})`],
      ['부족 발생', `${result.summary.shortfallMonths}개월`],
      ['누적 연간증액', Math.round(result.summary.cumAnnualReview)],
      ...(taxedCsv ? [['원천징수 세금(참고 · 위 합계에 미포함)', Math.round(result.summary.cumDivTax)]] : []),
      ['전략 옵션', strategyTags(active).join(' · ') || '사용 안 함(기본)'],
    ]) {
      rows.push(['참고 지표', '', label, '', '', '', '', '', value, '', '', '', '']);
    }
    // 시나리오 평가 · 메모 — ⚠️ 위 '기말예수금 내역' 항등식 그룹 **밖**이다(합계에 섞이면 안 된다).
    //    ⚠️ 모든 행이 13열이어야 한다 — 하나라도 짧으면 엑셀에서 그 행부터 열이 조용히 밀린다.
    {
      const rv = reviewOf(cfgNow);
      if (ratingKey(rv.rating) !== 'none' || String(rv.verdict || '').trim()) {
        rows.push(['시나리오 평가', '', RATING_LABEL[ratingKey(rv.rating)], '', '', '', '', '', rv.verdict || '', '', '', '', '']);
      }
      for (const n of notesOf(cfgNow)) {
        const snap = n.snapshot || {};
        rows.push([n.kind === 'user' ? '메모(내 메모)' : '메모(AI 분석)', '', n.title || '(제목 없음)',
          '', '', '', '', '', n.body || '', '', '', '', '']);
        if (snap.conditions || snap.period) {
          rows.push(['메모 작성시점', snap.period || '', n.title || '(제목 없음)', '', '', '', '', '',
            snap.conditions || '', '', '', '', snap.finalTotal != null ? Math.round(snap.finalTotal) : '']);
        }
      }
    }
    // ⚠️ BOM은 '\ufeff' 이스케이프로 — 소스에 보이지 않는 문자를 직접 넣으면 편집·머지 중 조용히
    //    사라져 엑셀에서 한글이 깨진다(원인 추적이 매우 어렵다).
    const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_${active.name}_${active.startDate}_${active.endDate}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /**
   * 비교 종합 CSV — 화면 비교 표와 **열 구성이 1:1**이어야 한다(갈리면 "화면과 CSV가 다르다").
   * 설정 요약을 함께 실어야 나중에 파일만 봐도 어떤 조건의 결과인지 알 수 있다.
   */
  const downloadCompareCsv = () => {
    if (!compareRuns.length) return;
    flushReview();
    // ⚠️ 열 구성은 화면 비교 표와 1:1이어야 한다. 설정 요약 열은 화면 부제(scenarioSubtitle)가
    //    담고 있는 정보를 CSV에서도 **열로 분해**해 필터·정렬이 가능하게 한 것이다.
    const rows = [[
      // ⚠️ 평가 2열은 화면 비교 표에서 **시나리오 셀 안**에 들어 있는 정보를 열로 분해한 것이다
      //    (부제→설정 요약 열과 같은 규약). 여기 열 수를 바꾸면 아래 rows.push와 검증 #247의
      //    하드코딩 열 수를 **함께** 고칠 것.
      '시나리오', '평가', '한 줄 결론',
      '기간', '초기 투자금', '리밸런싱', '분배금 처리', '배분 기준', '목표 기준',
      '밴드(%)', '매수 재원', '시그널 리밸런싱', '현금 바닥선(%)', '연간 증액', '원천징수(%)',
      '최종 자산', '총 손익', '수익률(%)', '누적 매매차익', '누적 분배금', '분배금 재투자', '기말 예수금', '적립 분배금',
      '최저 현금', '최저 현금일', '월분배 평균', '월분배 표준편차', '밴드 생략(건)', '시그널 발동(건)', '부족 발생(개월)',
      '기말 평가액', '최대 낙폭(%)', '비고',
    ]];
    for (const { cfg, result: r } of compareRuns) {
      const s = r?.summary;
      const dip = dipOf(cfg);
      const ar = annualOf(cfg);
      // ⚠️ 한 줄로 만들어 둔다 — 검증 #247이 `rows.push([` 안의 **줄 수**로 열 수를 세므로,
      //    셀 하나를 여러 줄에 걸쳐 쓰면 열 수가 부풀어 가드가 깨진다.
      const pctCell = (v) => (v === null || v === undefined ? '목표까지' : `${v}%`);
      const dipCell = dip.enabled
        ? [`매수 ${dip.levels.map((l) => `-${l.drop}%/${pctCell(l.buyPct)}`).join(' ')}`,
          dip.sellLevels.length ? `매도 ${dip.sellLevels.map((l) => `+${l.rise}%/${pctCell(l.sellPct)}`).join(' ')}` : '',
          dip.reallocate ? '' : '재조정 끔'].filter(Boolean).join(' · ')
        : '-';
      rows.push([
        cfg.name,
        RATING_LABEL[ratingKey(reviewOf(cfg).rating)],
        reviewOf(cfg).verdict || '',
        s ? `${s.startDate} ~ ${s.endDate}` : `${cfg.startDate} ~ ${cfg.endDate}`,
        Math.round(cfg.initialCapital + cfg.extraCash),
        POLICY_LABEL[cfg.policy] || cfg.policy,
        DIV_REINVEST_LABEL[cfg.divReinvest] || cfg.divReinvest,
        cfg.divReinvest === 'hold' ? '-' : (DIV_SPLIT_LABEL[cfg.divReinvestSplit] || cfg.divReinvestSplit),
        TARGET_MODE_LABEL[cfg.targetMode] || cfg.targetMode,
        numOf(cfg.band) > 0 ? cfg.band : '-',
        BUY_FUNDING_LABEL[cfg.buyFunding || 'both'],
        dipCell,
        numOf(cfg.cashFloorPct) > 0 ? cfg.cashFloorPct : '-',
        ar.mode === 'pctOfSurplus' && numOf(ar.value) > 0
          ? `${ar.everyMonths}개월마다 잉여의 ${ar.value}% (예약금 ${Math.round(ar.reserve)})` : '-',
        numOf(cfg.divTaxPct) > 0 ? cfg.divTaxPct : '-',
        s ? Math.round(s.finalTotal) : '',
        s ? Math.round(s.profit) : '',
        s ? s.profitRate.toFixed(2) : '',
        s ? Math.round(s.cumTradeNet) : '',
        s ? Math.round(s.cumDivAccrued) : '',
        s ? Math.round(-s.cumReinvestNet) : '',
        s ? Math.round(s.finalCashTrade) : '',
        s ? Math.round(s.finalCashDiv) : '',
        s ? Math.round(s.minCash?.value ?? 0) : '',
        s ? (s.minCash?.date || '') : '',
        s ? Math.round(s.divMonthlyAvg) : '',
        s ? Math.round(s.divMonthlyStdev) : '',
        s ? s.bandSkipCount : '',
        s ? s.signalEvents.length : '',
        s ? s.shortfallMonths : '',
        s ? Math.round(s.finalEval) : '',
        s ? s.maxDrawdown.toFixed(2) : '',
        r?.ok ? (r.warnings.length ? `확인 필요 ${r.warnings.length}건` : '') : (r?.fatal || '실행 불가'),
      ]);
    }
    const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_비교종합_${compareRuns.length}건.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!open) return null;

  // ⚠️ 인쇄를 위해 **반드시 document.body 직속 포털**로 렌더한다.
  //    오버레이 모드에서는 이 화면이 App 트리 깊숙이 있어 `body > *:not(.bt-shell){display:none}`
  //    규칙이 성립하지 않고, visibility 토글로 우회하면 숨겨진 앱 본문이 자리를 그대로 차지해
  //    **빈 페이지 수십 장**이 딸려 나온다. 포털로 올리면 두 모드(새 창/오버레이)가 같은 규칙을 쓴다.
  const content = (
    <div className={`bt-shell fixed inset-0 bg-[#0b1120] flex flex-col ${variant === 'page' ? '' : 'z-[1090]'}`}>
      {/* ⚠️ 인쇄 색상 강제 — 앱이 다크 테마라 그대로 인쇄하면 흰 종이에 밝은 회색 글씨가 찍혀
              사실상 판독 불가다(브라우저 기본값이 배경색을 버리기 때문). 검정 글씨 + 흰 배경으로
              뒤집고, 손익 의미가 있는 색만 인쇄용 진한 색으로 되살린다. */}
      <style>{`
/* ⚠️ 인쇄 전용 미러(평가·메모 본문). textarea는 내부 스크롤이라 화면에 보이는 만큼만 인쇄되고,
      접어 둔 메모는 아예 렌더되지 않는다 — 정적 텍스트 사본을 화면에서만 숨겨 두고 인쇄에서
      되살린다. 이 두 줄이 짝이므로 한쪽만 지우지 말 것. */
.bt-shell .bt-printonly { display: none; }
@media print {
  .bt-shell .bt-printonly { display: block !important; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.bt-shell) { display: none !important; }
  .bt-shell { position: static !important; display: block !important; height: auto !important;
              overflow: visible !important; background: #fff !important; }
  .bt-shell .bt-noprint { display: none !important; }
  .bt-body { display: block !important; overflow: visible !important; max-height: none !important; }
  #bt-print { overflow: visible !important; max-height: none !important; height: auto !important; padding: 0 !important; }
  .bt-shell, .bt-shell * { color: #111 !important; background: transparent !important;
                           border-color: #b0b0b0 !important; box-shadow: none !important; }
  .bt-shell [class*="text-red-"]     { color: #b91c1c !important; }
  .bt-shell [class*="text-blue-"]    { color: #1d4ed8 !important; }
  .bt-shell [class*="text-emerald-"] { color: #047857 !important; }
  .bt-shell [class*="text-amber-"]   { color: #b45309 !important; }
  /* ⚠️ 시그널 리밸런싱의 매수(amber)/매도(sky) 구분은 배경이 아니라 **글자색**으로만 표현된다
        (.bt-shell * 의 background:transparent가 인라인 배경까지 이긴다 — Swatch가 인라인 SVG인 것과
        같은 근거). sky 규칙이 없으면 매도가 본문과 같은 검정으로 인쇄돼 PDF에서 구분이 사라진다.
        ⚠️⚠️ 이 블록 전체는 **JS 템플릿 리터럴**이다 — 주석 안에도 역따옴표를 절대 쓰지 말 것.
        문자열이 거기서 끊기고 그 뒤가 JS로 파싱돼(.bt 멤버접근 빼기 shell 식별자) **빌드는
        통과하는데 렌더에서 "shell is not defined"로 화면이 통째로 죽는다**(2026-08 실측).
        게이트가 .tsx를 텍스트로만 읽어 못 잡는 부류라 검증 #259e가 역따옴표를 직접 막는다. */
  .bt-shell [class*="text-sky-"]     { color: #0369a1 !important; }
  .bt-shell [class*="text-gray-6"], .bt-shell [class*="text-gray-7"] { color: #555 !important; }
  .bt-shell thead th { background: #eee !important; }
  /* ⚠️ 화면은 크게(13px·넉넉한 행 높이), 인쇄는 종전 밀도로 되돌린다 — 12열짜리 월별 표가
        A4 가로 한 장에 들어가야 한다. 이 두 줄을 지우면 인쇄본에서 열이 잘려 판독 불가가 된다.
        값(10px / 3px 6px)은 화면을 키우기 전의 인쇄 밀도(11px / 4px 8px)에 맞춘 것이다. */
  .bt-shell .bt-tbl { font-size: 10px !important; }
  .bt-shell .bt-tbl th, .bt-shell .bt-tbl td { padding: 3px 6px !important; }
  .bt-shell table { page-break-inside: auto; width: 100% !important; min-width: 0 !important; }
  .bt-shell tr { page-break-inside: avoid; page-break-after: auto; }
  .bt-shell .bt-month { page-break-inside: avoid; }
  .bt-shell .overflow-x-auto { overflow: visible !important; }
  @page { size: A4 landscape; margin: 10mm; }
}
`}</style>

      {notice && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-900/30 border-b border-amber-800/50 bt-noprint">
          {notice}
        </div>
      )}

      {/* ── 상단 바 ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/70 shrink-0 bt-noprint">
        <BarChart3 size={14} className="text-emerald-400 shrink-0" />
        <span className="text-sm font-bold text-gray-100 shrink-0">백테스트</span>

        <select
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none max-w-[240px]"
          value={isCompare ? COMPARE_ID : (active?.id || '')}
          onChange={(e) => setActiveId(e.target.value)}
        >
          {local.length === 0 && <option value="">시나리오 없음</option>}
          {local.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {local.length > 0 && <option value={COMPARE_ID}>📊 전체 백테스트 비교 종합</option>}
        </select>

        <button className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30`} onClick={() => addScenario(null)} disabled={readOnly || local.length >= MAX_BT_SCENARIOS}>
          <Plus size={11} className="inline -mt-0.5" /> 새 시나리오
        </button>
        <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800`} onClick={() => active && addScenario(active)} disabled={readOnly || !active || local.length >= MAX_BT_SCENARIOS}>
          복제
        </button>
        <button className={`${BTN} text-red-300 border-red-900 hover:bg-red-900/30`} onClick={() => active && removeScenario(active.id)} disabled={readOnly || !active}>
          <Trash2 size={11} className="inline -mt-0.5" /> 삭제
        </button>

        {/* 설정 패널 접기/펴기 — 좁은 화면(세로 배치)에서는 '위로', 넓은 화면에서는 '왼쪽으로' 접힌다.
            설정을 끝낸 뒤 시뮬레이션 결과를 넓게 보기 위한 것이라 항상 상단 바에 노출한다. */}
        <button
          className={`${BTN} shrink-0 ${settingsOpen ? 'text-gray-300 border-gray-700 hover:bg-gray-800' : 'text-sky-300 border-sky-700 bg-sky-900/30'}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title={settingsOpen ? '설정을 접고 결과를 넓게 봅니다' : '설정 패널을 다시 엽니다'}
        >
          {settingsOpen
            ? <><PanelLeftClose size={11} className="inline -mt-0.5" /> 설정 숨기기</>
            : <><PanelLeft size={11} className="inline -mt-0.5" /> 설정 보기</>}
        </button>

        <div className="flex-1" />

        {/* 시나리오 평가 요약 — 결과를 아래로 스크롤해도 헤더에서 결론이 보이게 한다.
            누르면 결과 영역 맨 위(평가 카드)로 돌아간다. ⚠️ 비교 뷰에서는 active가 null이라 숨긴다. */}
        {!isCompare && active && (
          <button
            className={`${BTN} border-gray-700 hover:bg-gray-800 max-w-[280px] truncate ${RATING_CLS[ratingKey(reviewOf(active).rating)]}`}
            onClick={() => { try { document.getElementById('bt-print')?.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }}
            title="시나리오 평가로 이동"
          >
            {RATING_MARK[ratingKey(reviewOf(active).rating)]}{' '}
            {String(reviewOf(active).verdict || '').trim() || RATING_LABEL[ratingKey(reviewOf(active).rating)]}
            {notesOf(active).length > 0 && (
              <span className="text-gray-500 font-normal"> · 메모 {notesOf(active).length}</span>
            )}
          </button>
        )}

        {/* ⚠️ 인쇄·CSV 활성 조건은 **보고 있는 뷰**를 따라야 한다 — 비교 뷰에서 단일 result를
            보면 시나리오가 다 정상인데도 버튼이 죽어 있는 상태가 나온다. */}
        <button className={`${BTN} text-emerald-300 border-emerald-800 hover:bg-emerald-900/30`} onClick={doPrint}
          disabled={isCompare ? compareOk.length === 0 : !result?.ok}>
          <FileText size={11} className="inline -mt-0.5" /> PDF로 저장 (인쇄)
        </button>
        <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800`}
          onClick={isCompare ? downloadCompareCsv : downloadCsv}
          disabled={isCompare ? compareOk.length === 0 : !result?.ok}>
          <Download size={11} className="inline -mt-0.5" /> CSV
        </button>
        {onOpenWindow && (
          <button className={`${BTN} text-indigo-300 border-indigo-800 hover:bg-indigo-900/30`} onClick={onOpenWindow} title="별도 탭에서 크게 보기 (주소창·확장프로그램 사용 가능)">
            <ExternalLink size={11} className="inline -mt-0.5" /> 새 탭
          </button>
        )}
        {onClose && (
          <button className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800" onClick={() => { promote(); onClose(); }} title="닫기">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="bt-body flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* ── 설정 패널 (접혔을 때) ──
            ⚠️ 완전히 없애지 않고 얇은 띠를 남긴다 — 상단 바 버튼만으로는 "설정이 어디 갔나"가 된다.
               세로 배치에서는 가로 띠, 가로 배치에서는 왼쪽 세로 띠가 된다. */}
        {!settingsOpen && (
          <button
            onClick={() => setSettingsOpen(true)}
            title="시뮬레이션 조건 열기"
            className="shrink-0 w-full lg:w-9 flex lg:flex-col items-center justify-center lg:justify-start gap-1 py-1 lg:py-3 border-b lg:border-b-0 lg:border-r border-gray-800 bg-gray-900/50 hover:bg-gray-800/70 text-gray-400 hover:text-sky-300 transition-colors bt-noprint"
          >
            <PanelLeft size={14} />
            <span className="text-[11px] font-bold lg:hidden">시뮬레이션 조건 열기</span>
          </button>
        )}

        {/* ── 설정 패널 ── */}
        <div className={`${settingsOpen ? 'flex' : 'hidden'} w-full lg:w-[420px] shrink-0 border-b lg:border-b-0 lg:border-r border-gray-800 flex-col min-h-0 max-h-[60vh] lg:max-h-none bt-noprint`}>
          {/* 패널 자체 헤더 — 스크롤과 무관하게 항상 '숨기기'에 닿을 수 있어야 한다. */}
          <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 border-b border-gray-800 bg-gray-900/60">
            <span className="text-[12px] font-bold text-gray-400">시뮬레이션 조건</span>
            <Hint width={320} label="설정 패널 안내">
              <p>
                각 항목은 <b className="text-gray-300">제목 줄을 누르면 펼쳐집니다</b>. 평소에는 접혀 있고,
                접힌 상태에서도 오른쪽에 현재 설정값이 요약돼 보입니다.
              </p>
              <p className="mt-1">
                설정을 마쳤으면 <b className="text-gray-300">숨기기</b>를 눌러 결과를 넓게 보세요
                (넓은 화면에서는 왼쪽으로, 좁은 화면에서는 위로 접힙니다).
              </p>
            </Hint>
            <div className="flex-1" />
            <button
              onClick={() => setSettingsOpen(false)}
              title="설정을 접고 결과를 넓게 봅니다"
              className={`${BTN} text-gray-400 border-gray-700 hover:bg-gray-800`}
            >
              <PanelLeftClose size={11} className="inline -mt-0.5" /> 숨기기
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2">
          {isCompare ? (
            <Section
              title="비교할 시나리오 고르기"
              defaultOpen
              badge={`${local.filter((s) => s.compareOn !== false).length} / ${local.length}`}
              hint={(
                <>
                  <p>
                    체크한 시나리오만 오른쪽 비교 표·차트에 들어갑니다. 선택은
                    <b className="text-gray-300"> 시나리오와 함께 저장</b>되어 다음에 열어도 그대로입니다.
                  </p>
                  <p className="mt-1">
                    설정을 바꾸려면 위 드롭다운에서 그 시나리오를 고르세요. 리밸런싱 없이 분배금만
                    쌓는 기준선을 만들려면 <b className="text-gray-300">③ 리밸런싱 일정 → 리밸런싱 안 함</b> +
                    <b className="text-gray-300"> ④ 분배금 처리 → 현금 보유</b>로 두면 됩니다.
                  </p>
                </>
              )}
            >
              {local.map((s) => {
                const on = s.compareOn !== false;
                return (
                  <button
                    key={s.id}
                    disabled={readOnly}
                    onClick={() => toggleCompare(s.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border text-left transition-colors disabled:opacity-40 ${
                      on ? 'border-gray-700 bg-gray-800/60' : 'border-gray-800 bg-gray-900/40 hover:bg-gray-800/40'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center text-[9px] font-bold ${
                      on ? 'border-transparent text-gray-900' : 'border-gray-600 text-transparent'
                    }`} style={on ? { backgroundColor: colorOfScenario(s.id) } : undefined}>✓</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[11px] font-bold truncate ${on ? 'text-gray-200' : 'text-gray-500'}`}>{s.name}</span>
                      <span className="block text-[9px] text-gray-600 truncate">
                        {POLICY_LABEL[s.policy] || s.policy} · 분배금 {DIV_REINVEST_LABEL[s.divReinvest] || '현금 보유'}
                      </span>
                    </span>
                  </button>
                );
              })}
              <div className="flex gap-1">
                <button className={`${BTN} flex-1 text-gray-300 border-gray-700 hover:bg-gray-800`} disabled={readOnly}
                  onClick={() => setLocal((prev) => prev.map((s) => (s.compareOn === false ? { ...s, compareOn: true, updatedAt: Date.now() } : s)))}>
                  전체 선택
                </button>
                <button className={`${BTN} flex-1 text-gray-300 border-gray-700 hover:bg-gray-800`} disabled={readOnly}
                  onClick={() => setLocal((prev) => prev.map((s) => (s.compareOn === false ? s : { ...s, compareOn: false, updatedAt: Date.now() })))}>
                  전체 해제
                </button>
              </div>
            </Section>
          ) : !active ? (
            <div className="shrink-0 text-center text-gray-500 text-xs py-8">
              "새 시나리오"를 눌러 백테스트를 시작하세요.
            </div>
          ) : (
            <>
              <Section
                title="① 기본 설정"
                badge={active.startDate && active.endDate ? `${active.startDate} ~ ${active.endDate}` : '기간 미지정'}
                hint={(
                  <>
                    <p>
                      백테스트를 돌릴 <b className="text-gray-300">기간</b>과 <b className="text-gray-300">투입 원금</b>을 정합니다.
                      시작일에 <b className="text-gray-300">초기 투자금</b>으로 목표에 맞춰 매수한 뒤 시뮬레이션이 시작됩니다.
                    </p>
                    <p className="mt-1">
                      1주 단위로 딱 떨어지지 않아 <b className="text-gray-300">남는 잔돈은 자동으로 예수금</b>이 됩니다
                      (첨부 PDF의 15,000원).
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">추가 예수금</b>은 초기 투자금과 <b className="text-gray-300">별개</b>로 들고
                      시작할 현금입니다 — <b className="text-gray-300">초기 매수에는 쓰지 않고</b>, 이후 정기 리밸런싱·
                      매매 시그널의 매수 재원으로만 씁니다.
                    </p>
                  </>
                )}
              >
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>시나리오 이름</span>
                  <input className={INPUT} value={active.name} disabled={readOnly}
                    onChange={(e) => patchActive({ name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>시작일</span>
                    <input type="date" className={INPUT} value={active.startDate} disabled={readOnly}
                      onChange={(e) => patchActive({ startDate: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>종료일</span>
                    <input type="date" className={INPUT} value={active.endDate} disabled={readOnly}
                      onChange={(e) => patchActive({ endDate: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>초기 투자금 (원)</span>
                    <NumInput value={active.initialCapital} disabled={readOnly}
                      onCommit={(v) => patchActive({ initialCapital: Math.max(0, v) })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>추가 예수금 (선택)</span>
                    <NumInput value={active.extraCash} disabled={readOnly}
                      onCommit={(v) => patchActive({ extraCash: Math.max(0, v) })} />
                  </div>
                </div>
              </Section>

              <Section
                title="② 목표 기준"
                badge={targetSummary && targetSummary.count > 0
                  ? `${active.targetMode === 'amount' ? '목표 금액' : '목표 비중 %'} · 합계 ${
                      targetSummary.isAmt ? won(targetSummary.sum) : `${formatNumber(Math.round(targetSummary.sum * 100) / 100)}%`}`
                  : (active.targetMode === 'amount' ? '목표 금액' : '목표 비중 %')}
                hint={(
                  <>
                    <p>
                      리밸런싱이 <b className="text-gray-300">무엇에 맞춰 수량을 조정할지</b>를 정합니다.
                      값은 아래 <b className="text-gray-300">⑥ 종목</b>에서 종목마다 직접 적어 넣습니다.
                    </p>
                    <p className="mt-1 text-amber-300/90">
                      각 종목 칸에 원하는 <b>금액·비중을 직접 입력</b>할 수 있습니다. 종목마다 다른 값을
                      넣어도 되고, 일부만 넣어도 됩니다. 아래 <b>'종목 수로 균등 분배'는 편의 버튼일 뿐</b>이며
                      누를 때만 동작합니다(기본값이 균등 분배인 것이 아닙니다).
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">목표 금액</b> — 종목마다 "이 금액이 되게" 맞춥니다
                      (예: 종목A 1,000만원 · 종목B 2,000만원).
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">목표 비중 %</b> — <b className="text-gray-300">종목 평가액 합계</b>를
                      100으로 보고 그 안에서의 배분을 정합니다(예: 종목A 50% · 종목B 50%).
                      분모에 <b className="text-gray-300">예수금·매매차익·누적 분배금은 넣지 않습니다</b> —
                      현금 잔고에 따라 사용자가 정한 비율이 흔들리면 안 되기 때문입니다.
                    </p>
                    <p className="mt-1 text-gray-500">
                      ※ 비중 합은 <b className="text-gray-400">100%로 맞추는 것이 기본</b>입니다. 100%가 아니면
                      <b className="text-gray-400"> 리밸런싱마다</b> 그 차이만큼 사고팝니다 — 작으면 매번 팔아
                      현금이 쌓이고(평가액이 계속 줄어듭니다), 크면 예수금을 헐어 더 삽니다.
                      현금은 분모는 아니지만 <b className="text-gray-400">매수 재원</b>은 됩니다.
                    </p>
                    <p className="mt-1 text-gray-500">
                      ※ 첨부 PDF와 가장 가까운 것은 <b className="text-gray-400">목표 금액</b> 모드입니다
                      (2.25억 → 4월부터 1.5억).
                    </p>
                  </>
                )}
              >
                <div className="flex gap-1">
                  {[['amount', '목표 금액'], ['ratio', '목표 비중 %']].map(([v, l]) => (
                    <button key={v} disabled={readOnly}
                      className={`${BTN} flex-1 ${active.targetMode === v ? 'text-sky-200 border-sky-600 bg-sky-900/40' : 'text-gray-400 border-gray-700 hover:bg-gray-800'}`}
                      onClick={() => patchActive({ targetMode: v })}>{l}</button>
                  ))}
                </div>
                {/* ⚠️ 분모 선택 드롭다운은 없다(2026-08 사용자 정의) — 비중의 기준은 '종목 평가액
                    합계' 하나로 고정이다. 대신 그 사실을 여기 한 줄로 always-on 표시한다. */}
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  {active.targetMode === 'amount'
                    ? '종목마다 적어 넣은 금액이 되도록 매수·매도합니다. 남는 돈은 예수금으로 남습니다.'
                    : '기준(분모)은 종목 평가액 합계입니다 — 예수금·매매차익·누적 분배금은 포함하지 않습니다.'}
                </p>
                <p className="text-[10px] text-sky-300/80 leading-relaxed">
                  값은 <b>⑥ 종목</b>의 각 칸에 <b>직접 입력</b>합니다. 아래 버튼은 편의 기능일 뿐이며,
                  누르지 않는 한 입력한 값은 그대로 유지됩니다.
                </p>
                {/* ⚠️ 확인은 2단계 인라인 버튼이다 — App의 confirm()/notify()를 쓰지 말 것.
                    이 컴포넌트는 **별도 브라우저 창**(App 미마운트)에서도 그대로 렌더되므로
                    거기에는 ConfirmDialog도 알림 토스트도 존재하지 않는다. */}
                {evenConfirm ? (
                  <div className="flex flex-col gap-1 border border-amber-800 rounded p-1.5 bg-amber-900/20">
                    <span className="text-[10px] text-amber-300 leading-relaxed">
                      이미 입력한 목표값 {targetSummary?.filledCount ?? 0}종목을 <b>모두 덮어씁니다.</b>
                      {' '}되돌리기는 없습니다. 계속할까요?
                    </span>
                    <div className="flex gap-1">
                      <button className={`${BTN} flex-1 text-amber-200 border-amber-700 hover:bg-amber-900/40`}
                        onClick={splitEven}>덮어쓰기</button>
                      <button className={`${BTN} flex-1 text-gray-300 border-gray-700 hover:bg-gray-800`}
                        onClick={() => setEvenConfirm(false)}>취소</button>
                    </div>
                  </div>
                ) : (
                  <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800 w-full`}
                    onClick={() => { if (hasAnyTarget) setEvenConfirm(true); else splitEven(); }}
                    disabled={readOnly || !active.assets.length}
                    title={active.targetMode === 'amount'
                      ? '초기 투자금을 종목 수로 나눠 목표 금액에 채웁니다 (추가 예수금은 제외 · 이미 입력한 값도 덮어씁니다)'
                      : '100%를 종목 수로 나눠 목표 비중에 채웁니다 (이미 입력한 값도 덮어씁니다)'}>
                    종목 수로 균등 분배
                  </button>
                )}
              </Section>

              <Section
                title="②-b 매월 목표 증액 (현금 재투자)"
                badge={active.contribution.mode === 'none'
                  ? '증액 없음'
                  : active.contribution.mode === 'pctOfCash'
                    ? `예수금의 ${formatNumber(active.contribution.value)}%`
                    : `매월 ${won(active.contribution.value)}`}
                hint={(
                  <>
                    <p>
                      리밸런싱 매도 차익·분배금으로 쌓인 <b className="text-gray-300">예수금</b>을 매월 다시 투자에
                      넣습니다. 그 달 <b className="text-gray-300">첫 리밸런싱 직전</b>에 종목 목표를 올리면
                      바로 이어지는 리밸런싱이 실제로 매수합니다.
                    </p>
                    <p className="mt-1">
                      증액액은 <b className="text-gray-300">보유 예수금을 넘지 않게</b> 잘립니다(넘기면 곧바로
                      '예수금 부족'이 되기 때문). 리밸런싱이 없는 달은 건너뜁니다.
                    </p>
                  </>
                )}
              >
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>증액 방식</span>
                  {/* ⚠️ 방식을 바꾸면 값을 0으로 되돌린다 — %와 원은 단위가 달라서 값을 남기면
                      '예수금의 50%'가 '매월 50원'으로 조용히 바뀐다(자릿수 7자리 차이). */}
                  <select className={INPUT} value={active.contribution.mode} disabled={readOnly}
                    onChange={(e) => patchActive({
                      contribution: {
                        ...active.contribution,
                        mode: e.target.value,
                        value: e.target.value === active.contribution.mode ? active.contribution.value : 0,
                      },
                    })}>
                    <option value="none">증액 없음 (현금을 그대로 쌓아 둠)</option>
                    <option value="pctOfCash">보유 예수금의 % 만큼</option>
                    <option value="amount">매월 고정 금액</option>
                  </select>
                </div>
                {/* ⚠️ 값 입력·배분은 mode가 'none'이면 숨기되, **예외 규칙 목록은 항상 보여준다** —
                    엔진은 mode='none'이어도 월별 예외를 그대로 실행하므로, 숨기면 사용자가 이유를
                    모르는 증액이 결과에 나타난다(설정과 동작이 갈리는 숨은 상태). */}
                {active.contribution.mode !== 'none' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <span className={LABEL}>{active.contribution.mode === 'pctOfCash' ? '비율 (%)' : '금액 (원)'}</span>
                        <NumInput value={active.contribution.value} disabled={readOnly}
                          onCommit={(v) => patchActive({ contribution: { ...active.contribution, value: Math.max(0, v) } })} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className={LABEL}>종목별 배분</span>
                        <select className={INPUT} value={active.contribution.split} disabled={readOnly}
                          onChange={(e) => patchActive({ contribution: { ...active.contribution, split: e.target.value } })}>
                          <option value="ratio">현재 목표 비율대로</option>
                          <option value="even">활성 종목에 균등</option>
                        </select>
                      </div>
                    </div>
                    {active.targetMode === 'ratio' && (
                      <p className="text-[10px] text-amber-400/90 leading-relaxed">
                        ⚠️ <b>목표 비중 %</b> 모드에서는 증액이 <b>집행되지 않습니다</b> — 목표가
                        '종목 평가액 합계 × 비중'이라 늘릴 대상이 없기 때문입니다. 쌓인 현금을
                        다시 넣으려면 <b>목표 금액</b> 모드를 쓰거나, <b>④ 분배금 처리</b>를 재투자로
                        두거나, 목표 비중 합을 100%보다 크게 잡으세요.
                      </p>
                    )}

                  </>
                )}

                {/* 특정 월만 다른 증액 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>특정 월만 다르게</span>
                    <span className="text-[10px] text-gray-600">({active.contribOverrides.length})</span>
                    <button className={`${BTN} ml-auto text-gray-300 border-gray-700 hover:bg-gray-800`}
                      disabled={readOnly || !active.startDate || active.contribOverrides.length >= MAX_BT_CONTRIB_OVERRIDES}
                      onClick={() => {
                        const ms = monthsBetween(active.startDate, active.endDate);
                        if (!ms.length) return;
                        patchActive({
                          contribOverrides: [...active.contribOverrides, {
                            id: generateId(), ym: ms[0],
                            mode: active.contribution.mode, value: active.contribution.value,
                          }],
                        });
                      }}>
                      <Plus size={10} className="inline -mt-0.5" /> 추가
                    </button>
                  </div>
                  {active.contribOverrides.map((o) => (
                    <div key={o.id} className="flex items-center gap-1">
                      <select className={`${INPUT} w-[88px]`} value={o.ym} disabled={readOnly}
                        onChange={(e) => patchActive({ contribOverrides: active.contribOverrides.map((x) => x.id === o.id ? { ...x, ym: e.target.value } : x) })}>
                        {monthsBetween(active.startDate, active.endDate).map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {/* 방식 전환 시 값 초기화 — 위 기본 규칙과 같은 이유(% ↔ 원 단위 혼동 방지) */}
                      <select className={`${INPUT} w-[104px]`} value={o.mode} disabled={readOnly}
                        onChange={(e) => patchActive({ contribOverrides: active.contribOverrides.map((x) => x.id === o.id ? { ...x, mode: e.target.value, value: e.target.value === x.mode ? x.value : 0 } : x) })}>
                        <option value="none">증액 없음</option>
                        <option value="pctOfCash">예수금 %</option>
                        <option value="amount">고정 금액</option>
                      </select>
                      <NumInput value={o.value} disabled={readOnly || o.mode === 'none'}
                        onCommit={(v) => patchActive({ contribOverrides: active.contribOverrides.map((x) => x.id === o.id ? { ...x, value: Math.max(0, v) } : x) })} />
                      <button className="p-1 text-gray-600 hover:text-red-400 shrink-0" disabled={readOnly}
                        onClick={() => patchActive({ contribOverrides: active.contribOverrides.filter((x) => x.id !== o.id) })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </Section>

              <Section
                title="③ 리밸런싱 일정"
                badge={`${POLICY_LABEL[active.policy] || active.policy}${rebalDatesOf(active).length ? ` · 지정일 ${rebalDatesOf(active).length}` : ''}`}
                hint={(
                  <>
                    <p>
                      <b className="text-gray-300">언제</b> 목표에 맞춰 수량을 조정할지 정합니다. 기본 규칙은
                      지급기준일(월중 15일 / 월말 말일, 휴장이면 직전 영업일) →
                      <b className="text-gray-300"> 분배락 = 기준일 −1영업일</b> →
                      <b className="text-gray-300"> 리밸런싱 = 분배락 −1영업일</b>(분배금을 받을 수 있는 마지막 매수일)입니다.
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">종목별</b>은 각 종목이 자기 분배 주기를 따르고,
                      <b className="text-gray-300"> 일괄</b>은 전 종목을 같은 날 함께 조정합니다.
                      <b className="text-gray-300"> 리밸런싱 안 함</b>은 초기 매수 후 수량을 그대로 두는 기준선(Buy &amp; Hold)입니다.
                    </p>
                  </>
                )}
              >
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>전체 정책</span>
                  <select className={INPUT} value={active.policy} disabled={readOnly}
                    onChange={(e) => patchActive({ policy: e.target.value })}>
                    <option value="perCycle">종목별 — 각자 자기 분배락 전</option>
                    <option value="allMid">일괄 — 전 종목을 월중 분배락 전에</option>
                    <option value="allEom">일괄 — 전 종목을 월말 분배락 전에</option>
                    <option value="fixedDay">일괄 — 매월 지정일</option>
                    <option value="none">리밸런싱 안 함 (최초 매수 후 그대로 보유)</option>
                  </select>
                </div>
                {active.policy === 'none' && (
                  <div className="text-[11px] text-gray-500 leading-relaxed border border-gray-800 rounded bg-gray-900/40 px-2 py-1.5">
                    <div className="flex items-start gap-1">
                      <span className="flex-1">초기 매수 후 <b className="text-gray-400">수량을 그대로 둡니다</b>(Buy &amp; Hold).</span>
                      <Hint label="리밸런싱 안 함 설명">
                        <p>분배금은 <b className="text-gray-300">④ 분배금 처리</b>가 정하는 대로 쌓이거나 재투자됩니다.</p>
                        <p className="mt-1">
                          ※ 종목별로 <b className="text-gray-300">다르게</b> 지정한 리밸런싱(종목 목록의 '리밸런싱' 칸)은
                          그대로 실행됩니다 — 전 종목을 멈추려면 그 칸도 모두 '전체 정책 따름'이어야 합니다.
                        </p>
                      </Hint>
                    </div>
                    {/* ⚠️ 조건을 policy==='none'으로 두면 양방향으로 거짓말을 한다 — 종목별
                        rebalMode를 하나라도 지정하면 증액이 정상 집행되는데 '효과 없음'이라 하고,
                        반대로 policy는 none이 아닌데 전 종목 rebalMode:'none'이면 아무 안내도 없다.
                        실제 조건은 '리밸런싱 슬롯이 하나도 없다'이므로 결과에서 직접 읽는다. */}
                    {active.contribution.mode !== 'none' && result?.ok && result.slots.length === 0 && (
                      <div className="mt-1 text-amber-400/90">※ 매월 목표 증액은 <b>리밸런싱이 있는 달에만</b> 집행되므로 이 설정에서는 효과가 없습니다.</div>
                    )}
                  </div>
                )}
                {active.policy === 'fixedDay' && (
                  <div className="flex items-center gap-2">
                    <span className={LABEL}>매월</span>
                    <NumInput value={active.fixedDay} className="w-16" disabled={readOnly}
                      onCommit={(v) => patchActive({ fixedDay: Math.min(31, Math.max(1, Math.round(v))) })} />
                    <span className="text-[10px] text-gray-500">일 (휴장이면 직전 영업일)</span>
                  </div>
                )}

                {/* ── 전역 지정일 리밸런싱 — 전체 정책에 **추가**되는 축 ──
                    ⚠️ 체크박스로 만들지 말 것: 끄는 유일한 표현이 배열 비우기가 되어 입력이 통째로
                       소실된다(백테스트는 undo가 없고 sticky 복원 대상도 아니다). 개수 배지 + 칩
                       개별 삭제로 표현한다. */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>지정일 리밸런싱</span>
                    <span className="text-[10px] text-gray-600">({rebalDatesOf(active).length}건)</span>
                    <Hint width={380}>
                      <p>
                        <b className="text-gray-300">특정 날짜</b>를 찍어 그날 전 종목을 목표에 맞춥니다.
                        위 <b className="text-gray-300">전체 정책에 더해지는</b> 축이라 둘을 함께 쓸 수 있고,
                        전체 정책을 <b className="text-gray-300">‘리밸런싱 안 함’</b>으로 두면 지정한 날짜에만 리밸런싱합니다.
                      </p>
                      <p className="mt-1">
                        휴장·주말이면 <b className="text-gray-300">직전 영업일</b>로 옮겨 실행하고,
                        조회기간 밖 날짜는 무시합니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">‘전체 정책 따름’ 종목에만</b> 걸립니다 — ⑥ 종목 목록의
                        ‘리밸런싱’ 칸에서 일정을 따로 지정한 종목은 그 지정을 그대로 유지합니다
                        (그 종목만 특정 날짜에 넣으려면 그 종목의 ‘지정 날짜’ 모드를 쓰세요).
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 분배락·지급일은 시장이 정하는 값이라 지정일과 무관하게 그대로입니다.
                      </p>
                    </Hint>
                    <input type="date" className={`${INPUT} ml-auto w-[132px]`} value=""
                      disabled={readOnly || rebalDatesOf(active).length >= MAX_BT_REBAL_DATES}
                      onChange={(e) => {
                        const d = e.target.value;
                        // ⚠️ 중복·상한을 여기서 막지 않으면 초과분이 저장은 되고 **다음 로드에서
                        //    조용히 절삭**돼(정규화) 그때 결과가 달라진다.
                        const cur = rebalDatesOf(active);
                        if (!d || cur.includes(d) || cur.length >= MAX_BT_REBAL_DATES) return;
                        patchActive({ rebalDates: [...cur, d].sort() });
                      }} />
                  </div>
                  {rebalDatesOf(active).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {rebalDatesOf(active).map((d) => (
                        <button key={d} disabled={readOnly} title="클릭하여 제거"
                          className="px-1 py-0.5 rounded text-[9px] border border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-300"
                          onClick={() => patchActive({ rebalDates: rebalDatesOf(active).filter((x) => x !== d) })}>
                          {d} ✕
                        </button>
                      ))}
                    </div>
                  )}
                  {rebalDatesOf(active).length >= MAX_BT_REBAL_DATES && (
                    <span className="text-[9px] text-amber-400/90">
                      지정일은 최대 {MAX_BT_REBAL_DATES}건까지 넣을 수 있습니다.
                    </span>
                  )}
                </div>

                <Section
                  title="분배 일정 오프셋 (고급)"
                  badge={`${active.exDivOffset} · ${active.rebalOffset} · +${active.payOffset}`}
                  hint={(
                    <p>
                      기준일 = 월중 15일 / 월말 말일(휴장이면 직전 영업일). 기본값 −1·−1·+2는 첨부 PDF의
                      리밸런싱일 14개 중 12개를 정확히 재현합니다(나머지 2개는 PDF가 일요일을 쓴 오류).
                      단위는 <b className="text-gray-300">영업일</b>입니다.
                    </p>
                  )}
                >
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>분배락 (기준일 대비)</span>
                      <NumInput value={active.exDivOffset} disabled={readOnly}
                        onCommit={(v) => patchActive({ exDivOffset: Math.min(0, Math.max(-10, Math.round(v))) })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>리밸 (분배락 대비)</span>
                      <NumInput value={active.rebalOffset} disabled={readOnly}
                        onCommit={(v) => patchActive({ rebalOffset: Math.min(0, Math.max(-10, Math.round(v))) })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>지급 (기준일 대비)</span>
                      <NumInput value={active.payOffset} disabled={readOnly}
                        onCommit={(v) => patchActive({ payOffset: Math.min(10, Math.max(0, Math.round(v))) })} />
                    </div>
                  </div>
                </Section>

                {/* 월별 오버라이드 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>특정 월만 다른 날짜에</span>
                    <span className="text-[10px] text-gray-600">({active.overrides.length})</span>
                    <Hint label="월별 예외 설명">
                      <p>
                        ⚠️ 오버라이드는 <b className="text-gray-300">리밸런싱일만</b> 옮깁니다. 분배락·지급일은
                        시장이 정하는 값이라 그대로입니다.
                      </p>
                      <p className="mt-1">
                        <b className="text-gray-300">일괄</b> 항목은 '전역 정책 따름' 종목에만 적용되고,
                        종목별 일정을 따로 지정한 종목은 <b className="text-gray-300">○○만</b> 항목으로 옮깁니다.
                      </p>
                    </Hint>
                    <button className={`${BTN} ml-auto text-gray-300 border-gray-700 hover:bg-gray-800`}
                      disabled={readOnly || !active.startDate || active.overrides.length >= MAX_BT_OVERRIDES}
                      onClick={() => {
                        const ms = monthsBetween(active.startDate, active.endDate);
                        if (!ms.length) return;
                        patchActive({
                          overrides: [...active.overrides, {
                            id: generateId(), ym: ms[0],
                            group: active.policy === 'perCycle' ? 'eom' : 'all',
                            date: `${ms[0]}-15`, assetId: '',
                          }],
                        });
                      }}>
                      <Plus size={10} className="inline -mt-0.5" /> 추가
                    </button>
                  </div>
                  {active.overrides.map((o) => (
                    <div key={o.id} className="flex items-center gap-1">
                      <select className={`${INPUT} w-[88px]`} value={o.ym} disabled={readOnly}
                        onChange={(e) => patchActive({ overrides: active.overrides.map((x) => x.id === o.id ? { ...x, ym: e.target.value } : x) })}>
                        {monthsBetween(active.startDate, active.endDate).map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {/* 대상: 그룹 일괄 / 특정 종목 하나. 값 접두사로 두 축을 한 select에 담는다. */}
                      <select className={`${INPUT} w-[112px]`} value={o.assetId ? `a:${o.assetId}` : `g:${o.group}`} disabled={readOnly}
                        onChange={(e) => {
                          const v = e.target.value;
                          patchActive({
                            overrides: active.overrides.map((x) => x.id === o.id
                              ? (v.startsWith('a:') ? { ...x, assetId: v.slice(2) } : { ...x, assetId: '', group: v.slice(2) })
                              : x),
                          });
                        }}>
                        {active.policy === 'perCycle'
                          ? <><option value="g:mid">월중 일괄</option><option value="g:eom">월말 일괄</option></>
                          : <option value="g:all">전체 일괄</option>}
                        {active.assets.map((a) => (
                          <option key={a.id} value={`a:${a.id}`}>{(a.name || a.code)}만</option>
                        ))}
                      </select>
                      <input type="date" className={INPUT} value={o.date} disabled={readOnly}
                        onChange={(e) => patchActive({ overrides: active.overrides.map((x) => x.id === o.id ? { ...x, date: e.target.value } : x) })} />
                      <button className="p-1 text-gray-600 hover:text-red-400 shrink-0" disabled={readOnly}
                        onClick={() => patchActive({ overrides: active.overrides.filter((x) => x.id !== o.id) })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </Section>

              <Section
                title="④ 분배금 처리"
                badge={DIV_REINVEST_LABEL[active.divReinvest]
                  + (active.divReinvest !== 'hold' ? ` · ${DIV_SPLIT_LABEL[active.divReinvestSplit] || ''}` : '')}
                hint={(
                  <>
                    <p>
                      지급받은 분배금을 <b className="text-gray-300">현금으로 둘지, 다시 매수할지</b> 정합니다.
                      현금으로 두면 리밸런싱 매수 재원으로만 쓰이고, 리밸런싱까지 끄면 현금이 그대로 쌓이는
                      기준선(Buy &amp; Hold)이 됩니다.
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">월중·월말 매수</b>는 리밸런싱과 같은 날짜 규칙(분배락 직전 영업일)이라
                      그날 사면 <b className="text-gray-300">그 달 분배 권리까지 확보</b>되어 분배금이 다시 분배를 받습니다.
                    </p>
                    <p className="mt-1">
                      재원은 <b className="text-gray-300">아직 쓰지 않은 누적 분배금 전액</b>입니다(리밸런싱이 이미 헐어 쓴
                      몫은 자동으로 빠집니다). 1주 값에 못 미치는 잔돈은 버리지 않고 다음 회차로 이월됩니다.
                      재투자 매수 대금은 결과의 '누적 매매차익'에 <b className="text-gray-300">넣지 않고</b> 따로 셉니다.
                    </p>
                  </>
                )}
              >
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>지급받은 분배금을</span>
                  <select className={INPUT} value={active.divReinvest} disabled={readOnly}
                    onChange={(e) => patchActive({ divReinvest: e.target.value })}>
                    <option value="hold">현금으로 보유 (예수금에 쌓아 둠)</option>
                    <option value="payDate">지급일에 바로 재매수</option>
                    <option value="mid">모아서 월중에 매수 (월중 분배락 직전)</option>
                    <option value="eom">모아서 월말에 매수 (월말 분배락 직전)</option>
                  </select>
                </div>
                {active.divReinvest !== 'hold' && (
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>어느 종목을 살까 (배분 기준)</span>
                    <select className={INPUT} value={active.divReinvestSplit} disabled={readOnly}
                      onChange={(e) => patchActive({ divReinvestSplit: e.target.value })}>
                      <option value="target">
                        목표 비중대로 전 종목에 배분{active.targetMode === 'amount' ? ' (목표금액 비율)' : ''}
                      </option>
                      <option value="source">분배금을 준 그 종목을 되산다 (DRIP)</option>
                      <option value="even">그날 살 수 있는 종목에 균등</option>
                    </select>
                  </div>
                )}
                {active.divReinvest !== 'hold' && active.divReinvestSplit === 'target'
                  && active.targetMode === 'ratio'
                  && active.assets.length > 0
                  && active.assets.every((a) => !(a.targetRatio > 0)) && (
                  <p className="text-[10px] text-amber-400/90 leading-relaxed">
                    ⚠️ 목표 비중이 전부 0이라 배분 기준이 없습니다 — 이 경우에는 균등 배분으로 대체됩니다.
                  </p>
                )}
              </Section>

              <Section
                title="⑤ 수량·현금 규칙"
                badge={`${active.rounding === 'floor' ? '내림' : active.rounding === 'round' ? '반올림' : '소수 허용'}${active.allowNegativeCash ? ' · 마이너스 예수금 허용' : ''}`}
                hint={(
                  <>
                    <p>
                      매매 수량을 <b className="text-gray-300">1주 단위로 어떻게 자를지</b>와, 예수금이 모자랄 때
                      어떻게 할지를 정합니다. 첨부 PDF는 <b className="text-gray-300">내림(0 방향)</b> 규약입니다.
                    </p>
                    <p className="mt-1">
                      '마이너스 예수금 허용'을 끄면 보유 현금 한도까지만 매수하고 그 행에
                      <b className="text-gray-300"> "예수금 부족"</b>으로 표시합니다.
                    </p>
                  </>
                )}
              >
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>매매 수량</span>
                  <select className={INPUT} value={active.rounding} disabled={readOnly}
                    onChange={(e) => patchActive({ rounding: e.target.value })}>
                    <option value="floor">내림 (0 방향) — 첨부 PDF 규약</option>
                    <option value="round">반올림</option>
                    <option value="exact">소수 허용 (펀드 좌수)</option>
                  </select>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={active.allowNegativeCash} disabled={readOnly}
                    onChange={(e) => patchActive({ allowNegativeCash: e.target.checked })} />
                  예수금이 부족해도 매수 (마이너스 예수금 허용)
                </label>
              </Section>

              {/* ⚠️ 번호를 '⑤-b'로 둔 이유 — ⑥ 종목을 ⑦로 밀면 **엔진 경고 문구**('⑥ 종목에서 목표
                      비중을 입력하세요')와 화면 번호가 갈린다. ②-b(매월 증액)와 같은 선례를 따른다. */}
              <Section
                title="⑤-b 전략 옵션 — 매매 시그널 설정"
                badge={strategyBadge(active)}
                hint={(
                  <>
                    <p>
                      <b className="text-gray-300">목표 평가금을 고정</b>해 두고(오르면 팔고 내리면 사서 복원),
                      분배금은 <b className="text-gray-300">예수금과 따로 적립</b>해 두는 운용을 위한
                      보조 규칙 6종입니다. 그중 <b className="text-gray-300">시그널 리밸런싱</b>은
                      ③ 리밸런싱 일정과 <b className="text-gray-300">별개의 매매 트리거</b>라 둘을 동시에 켤 수 있습니다.
                    </p>
                    <p className="mt-1 text-gray-500">
                      ※ <b className="text-gray-400">전부 꺼 두는 것이 기본값</b>이고, 그 상태에서는 기존 시나리오의
                      결과가 1원도 달라지지 않습니다. 필요한 것만 켜세요.
                    </p>
                    <p className="mt-1 text-gray-500">
                      ※ <b className="text-gray-400">매수 재원</b>은 <b className="text-gray-400">정기 리밸런싱과
                      매매 시그널이 함께</b> 씁니다. 밴드·바닥선·증액은 정기 리밸런싱에만 걸리고,
                      종목 재편(이벤트)·분배금 재투자는 종전 규칙 그대로 돕니다.
                      초기 매수는 <b className="text-gray-400">초기 투자금만</b> 쓰고 추가 예수금은 남겨 둡니다.
                      <b className="text-gray-400"> 시그널 리밸런싱만</b> 자기 발동일에 독립적으로 매매합니다.
                    </p>
                  </>
                )}
              >
                {/* ── A. 리밸런싱 밴드 ── */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>리밸런싱 밴드 (%)</span>
                    <Hint width={360}>
                      <p>
                        리밸런싱 전 평가액이 목표금액의 <b className="text-gray-300">±이 비율 안</b>이면
                        그 종목의 <b className="text-gray-300">그 회차 매매를 생략</b>합니다. 목표 근처에서
                        몇 주씩 사고파는 잔매매를 줄여 세금·수수료를 아끼는 장치입니다.
                      </p>
                      <p className="mt-1">
                        예) 목표 1,000만원 · 밴드 3% → 평가액이 970만~1,030만원이면 그냥 둡니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">0이면 밴드 없음</b>(종전 동작). 목표가 0인 종목(전량 청산)은
                        밴드와 무관하게 항상 실행합니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 밴드는 <b className="text-gray-400">정기 리밸런싱 전용</b>입니다 —
                        ⑤-b 시그널 리밸런싱은 자기 발동일에 체결되므로 밴드가 막지 않습니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 종목 재편(이벤트) 매매와 분배금 재투자에는 적용하지 않습니다.
                      </p>
                    </Hint>
                  </div>
                  <NumInput value={numOf(active.band) || ''} disabled={readOnly} placeholder="0 = 밴드 없음"
                    onCommit={(v) => patchActive({ band: Math.max(0, v) })} />
                </div>

                {/* ── B. 매수 재원 ── */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>매수 재원</span>
                    <Hint width={380}>
                      <p>
                        <b className="text-gray-300">정기 리밸런싱과 매매 시그널이 함께 쓰는</b> 매수 재원입니다.
                        현금은 <b className="text-gray-300">예수금</b>(매매차익 + 초기 매수 잔여 + 추가 예수금)과
                        <b className="text-gray-300"> 적립 분배금</b>(지급받아 아직 안 쓴 분배금)으로 **따로** 관리됩니다.
                      </p>
                      <p className="mt-1">
                        <b className="text-gray-300">예수금 전부</b> — 예수금 + 적립 분배금. 예수금을 먼저 쓰고
                        모자라면 적립 분배금에서 꺼냅니다(기본).
                      </p>
                      <p className="mt-1">
                        <b className="text-gray-300">매매 예수금만</b> — 예수금만 씁니다. 적립 분배금은
                        <b className="text-gray-300"> 1원도 쓰지 않고</b> 계속 쌓입니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">④ 분배금 처리</b>를 재투자로 둔 경우의 재투자 매수는 원래
                        적립 분배금에서 나가므로 이 설정과 무관합니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">초기 매수</b>는 초기 투자금만 쓰고, <b className="text-gray-400">종목 재편</b>(⑦)은
                        종전대로 현금 전체를 씁니다.
                      </p>
                    </Hint>
                  </div>
                  <div className="flex gap-1">
                    {[['both', '예수금 전부'], ['tradeOnly', '매매 예수금만']].map(([v, l]) => (
                      <button key={v} disabled={readOnly}
                        className={`${BTN} flex-1 ${(active.buyFunding || 'both') === v ? 'text-sky-200 border-sky-600 bg-sky-900/40' : 'text-gray-400 border-gray-700 hover:bg-gray-800'}`}
                        onClick={() => patchActive({ buyFunding: v })}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* ── C. 시그널 리밸런싱 (매수 = 급락 분할투입 / 매도 = 반등 차익실현) ── */}
                <div className="flex flex-col gap-1.5 border-t border-gray-800 pt-2">
                  {/* ⚠️ Hint(=<button>)를 <label> **안**에 두지 말 것 — label의 활성화 동작이
                          내부 체크박스를 함께 토글해, ? 아이콘을 누를 때마다 시그널 리밸런싱이
                          켜졌다 꺼진다(Section 헤더의 '버튼 중첩 금지'와 같은 부류). */}
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                      <input type="checkbox" checked={dipOf(active).enabled} disabled={readOnly}
                        onChange={(e) => patchActive({ dip: { ...dipOf(active), enabled: e.target.checked } })} />
                      시그널 리밸런싱 (발동일 종가로 즉시 매매)
                    </label>
                    <Hint width={400}>
                      <p>
                        종목별 <b className="text-gray-300">가격 고점</b> 대비 낙폭(매수 시그널) 또는
                        <b className="text-gray-300"> 가격 저점</b> 대비 상승률(매도 시그널)이 각 단계에
                        <b className="text-gray-300"> 처음 닿는 날</b>, <b className="text-gray-300">그날 종가로 즉시</b>
                        {' '}그 종목을 목표까지 맞춥니다.
                      </p>
                      <p className="mt-1">
                        평가액이 아니라 <b className="text-gray-300">가격</b> 극값을 쓰는 이유는, 리밸런싱으로 수량이
                        계속 변해 평가액 고점·저점은 왜곡되기 때문입니다.
                      </p>
                      <p className="mt-1">
                        <b className="text-gray-300">매매 규모는 단계의 비율 칸</b>이 정합니다 —
                        매수는 <b className="text-gray-300">매수 재원 × 비율</b>(목표를 넘지 않게 자름),
                        매도는 <b className="text-gray-300">목표 초과분 × 비율</b>. 비율 칸을 비우면
                        <b className="text-gray-300"> 목표까지</b> 채우거나 팝니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 재원은 위 <b className="text-gray-400">매수 재원</b> 설정을 그대로 따릅니다.
                        ‘매매 예수금만’이면 적립 분배금은 시그널에서도 쓰지 않습니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 각 단계는 <b className="text-gray-400">극값이 갱신되기 전까지 1회만</b> 발동하고,
                        새 고점(매수)·새 저점(매도)이 서면 전 단계가 다시 무장됩니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 그래서 <b className="text-gray-400">한 방향으로만 가는 장에서는 반대편 시그널이
                        사실상 1회성</b>이 됩니다 — 계속 오르기만 하면 저점이 갱신되지 않아 매도 단계가
                        처음 도달할 때만 발동하고(그 뒤로는 목표 초과분이 계속 쌓입니다), 계속 내리기만
                        하면 고점이 갱신되지 않아 매수 단계도 마찬가지입니다. 주기적으로 되돌리려면
                        ③ 리밸런싱 일정을 함께 켜세요.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">③ 리밸런싱 일정과 완전히 독립</b>입니다 —
                        ‘리밸런싱 안 함’으로 두어도 시그널은 그대로 돌고, 둘 다 켜면 둘 다 실행됩니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 리밸런싱 밴드는 <b className="text-gray-400">정기 리밸런싱 전용</b>이라 시그널 매매를 막지 않습니다.
                      </p>
                    </Hint>
                  </div>
                  {dipOf(active).enabled && (
                    <div className="flex flex-col gap-1">
                      <div className="grid grid-cols-[1fr_1fr] gap-2">
                        <span className={LABEL}>매수 시그널 — 고점 대비 낙폭 (%)</span>
                        <span className={LABEL}>이때 매수 비율 (매수 재원의 %)</span>
                      </div>
                      {dipOf(active).levels.map((lv, i) => (
                        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                          <NumInput value={lv.drop} disabled={readOnly}
                            onCommit={(v) => patchActive({
                              dip: {
                                ...dipOf(active),
                                levels: dipOf(active).levels.map((x, j) => (j === i ? { ...x, drop: Math.min(100, Math.max(0.1, v)) } : x)),
                              },
                            })} />
                          {/* ⚠️ allowEmpty — 빈칸(null)이 '목표까지 매수'다. 0(재원의 0% = 한 주도 안 삼)과
                                  **반드시 구분**돼야 하므로 0으로 강제하지 말 것. */}
                          <NumInput value={lv.buyPct} disabled={readOnly} allowEmpty placeholder="목표까지"
                            onCommit={(v) => patchActive({
                              dip: {
                                ...dipOf(active),
                                levels: dipOf(active).levels.map((x, j) => (j === i
                                  ? { ...x, buyPct: v === null ? null : Math.min(100, Math.max(0, v)) }
                                  : x)),
                              },
                            })} />
                          {/* ⚠️ 삭제·추가 버튼이 없으면 중복 낙폭을 적었을 때 정규화가 행을 지운 뒤
                                  **되돌릴 수단이 사라진다**(적대적 리뷰 확정 결함). */}
                          <button className="p-1 text-gray-600 hover:text-red-400 shrink-0 disabled:opacity-30"
                            title="이 단계 삭제"
                            disabled={readOnly || dipOf(active).levels.length <= 1}
                            onClick={() => patchActive({
                              dip: { ...dipOf(active), levels: dipOf(active).levels.filter((_, j) => j !== i) },
                            })}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800 w-full`}
                        disabled={readOnly || dipOf(active).levels.length >= MAX_BT_DIP_LEVELS}
                        onClick={() => {
                          const cur = dipOf(active).levels;
                          const next = Math.min(100, (cur.length ? cur[cur.length - 1].drop : 0) + 10);
                          // ⚠️ 새 단계의 기본은 **목표까지(null)** 다 — 0을 넣으면 '재원의 0%'라
                          //    한 주도 사지 않는 단계가 조용히 생긴다.
                          patchActive({ dip: { ...dipOf(active), levels: [...cur, { drop: next, buyPct: null }] } });
                        }}>
                        <Plus size={10} className="inline -mt-0.5" /> 단계 추가 ({dipOf(active).levels.length}/{MAX_BT_DIP_LEVELS})
                      </button>
                      {/* ⚠️ 중복 낙폭은 정규화가 하나만 남기므로 **입력하는 순간** 알려야 한다 —
                              모르고 저장하면 그 단계가 영구히 사라진다. */}
                      {(() => {
                        const ds = dipOf(active).levels.map((x) => x.drop);
                        if (new Set(ds).size === ds.length) return null;
                        return (
                          <p className="text-[10px] text-amber-400/90 leading-relaxed">
                            ⚠️ 같은 낙폭이 겹칩니다 — <b>저장하면 하나만 남습니다</b>(그 전까지는 두 번 발동해
                            매수 비율이 두 배로 합산됩니다). 낙폭을 서로 다르게 고치세요.
                          </p>
                        );
                      })()}

                      {/* ── 매도 시그널 (저점 대비 반등) ── */}
                      <div className="grid grid-cols-[1fr_1fr] gap-2 mt-2">
                        <span className={LABEL}>매도 시그널 — 저점 대비 반등 (%)</span>
                        <span className={LABEL}>이때 매도 비율 (목표 초과분의 %)</span>
                      </div>
                      {dipOf(active).sellLevels.length === 0 && (
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          비어 있으면 매도 시그널을 쓰지 않습니다(기본값). 단계를 추가하면 저점 대비 그만큼
                          오른 날 <b className="text-gray-400">목표 초과분</b>에서 매도 비율만큼 팔고,
                          대금은 예수금으로 갑니다.
                        </p>
                      )}
                      {dipOf(active).sellLevels.map((lv, i) => (
                        <div key={`s${i}`} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                          <NumInput value={lv.rise} disabled={readOnly}
                            onCommit={(v) => patchActive({
                              dip: {
                                ...dipOf(active),
                                sellLevels: dipOf(active).sellLevels.map((x, j) => (j === i ? { ...x, rise: Math.min(1000, Math.max(0.1, v)) } : x)),
                              },
                            })} />
                          {/* ⚠️ 빈칸(null) = '목표까지 전량 매도'(종전 동작). 0(초과분의 0% = 안 팜)과 구분된다. */}
                          <NumInput value={lv.sellPct} disabled={readOnly} allowEmpty placeholder="목표까지 전량"
                            onCommit={(v) => patchActive({
                              dip: {
                                ...dipOf(active),
                                sellLevels: dipOf(active).sellLevels.map((x, j) => (j === i
                                  ? { ...x, sellPct: v === null ? null : Math.min(100, Math.max(0, v)) }
                                  : x)),
                              },
                            })} />
                          <button className="p-1 text-gray-600 hover:text-red-400 shrink-0 disabled:opacity-30"
                            title="이 매도 단계 삭제"
                            disabled={readOnly}
                            onClick={() => patchActive({
                              dip: { ...dipOf(active), sellLevels: dipOf(active).sellLevels.filter((_, j) => j !== i) },
                            })}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800 w-full`}
                        disabled={readOnly || dipOf(active).sellLevels.length >= MAX_BT_SELL_LEVELS}
                        onClick={() => {
                          const cur = dipOf(active).sellLevels;
                          const next = cur.length
                            ? Math.min(1000, cur[cur.length - 1].rise + 10)
                            : DEFAULT_SELL_LEVELS[0].rise;
                          patchActive({ dip: { ...dipOf(active), sellLevels: [...cur, { rise: next, sellPct: null }] } });
                        }}>
                        <Plus size={10} className="inline -mt-0.5" /> 매도 단계 추가 ({dipOf(active).sellLevels.length}/{MAX_BT_SELL_LEVELS})
                      </button>
                      {(() => {
                        const rs = dipOf(active).sellLevels.map((x) => x.rise);
                        if (new Set(rs).size === rs.length) return null;
                        return (
                          <p className="text-[10px] text-amber-400/90 leading-relaxed">
                            ⚠️ 같은 상승률이 겹칩니다 — <b>저장하면 하나만 남습니다</b>. 값을 서로 다르게 고치세요.
                          </p>
                        );
                      })()}

                      <div className="flex items-center gap-1.5 mt-1">
                        <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                          <input type="checkbox" checked={dipOf(active).reallocate} disabled={readOnly}
                            onChange={(e) => patchActive({ dip: { ...dipOf(active), reallocate: e.target.checked } })} />
                          예수금이 모자라면 다른 종목을 팔아 재원 마련 (재조정)
                        </label>
                        <Hint width={380}>
                          <p>
                            매수 시그널의 필요액이 매수 재원보다 크면, <b className="text-gray-300">목표를 초과한
                            다른 보유 종목</b>을 목표까지 팔아 재원을 만듭니다(초과분이 큰 종목부터).
                          </p>
                          <p className="mt-1 text-amber-300/90">
                            ※ <b>매수 비율 칸을 비운(‘목표까지’) 단계에만</b> 적용됩니다 — 비율 매수는
                            “가진 현금의 일부만 투입”이 규칙이라 재원 부족이라는 개념 자체가 없습니다.
                          </p>
                          <p className="mt-1 text-gray-500">
                            ※ 보유 종목이 <b className="text-gray-400">전부 함께 하락</b>해 팔 초과분이 없으면
                            아무것도 팔지 않고 가진 재원만큼만 삽니다.
                          </p>
                          <p className="mt-1 text-gray-500">
                            ※ 목표 아래로는 팔지 않습니다 — 사용자가 정한 비율/금액이 곧 하한입니다.
                          </p>
                        </Hint>
                      </div>

                      <p className="text-[10px] text-gray-500 leading-relaxed">
                        낙폭·상승률이 작은 단계부터 순서대로 정렬됩니다. 비율 칸을 <b className="text-gray-400">비우면
                        ‘목표까지’</b>(매수=목표 미달액 전부 / 매도=초과분 전량)이고, 채우면 그 비율만큼만 매매합니다.
                        같은 날 두 단계가 함께 발동하면 비율은 합산됩니다.
                      </p>
                    </div>
                  )}
                </div>

                {/* ── D. 현금 바닥선 ── */}
                <div className="flex flex-col gap-1 border-t border-gray-800 pt-2">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>현금 바닥선 (목표금액 합계의 %)</span>
                    <Hint width={360}>
                      <p>
                        정기 리밸런싱 매수가 끝난 뒤 총 예수금이 이 선 아래로 내려가지 않도록
                        <b className="text-gray-300"> 매수액을 줄입니다</b>. 바닥선 금액 =
                        <b className="text-gray-300"> 그 시점 활성 종목 목표금액 합계 × 이 비율</b>.
                      </p>
                      <p className="mt-1">
                        예) 목표금액 합계 1억 · 바닥선 5% → 예수금이 500만원 아래로 내려가는 매수는 그만큼만 체결.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">0이면 바닥선 없음</b>(종전 동작). 줄어든 행은 표에
                        <b className="text-gray-400"> ‘바닥선’</b>으로 표시되고 결과의 ‘부족 발생’에 집계됩니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 바닥선은 <b className="text-gray-400">‘마이너스 예수금 허용’보다 우선</b>합니다 —
                        바닥선이 0보다 크면 예수금은 음수가 되지 않습니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ 매도와 분배금 재투자에는 적용하지 않습니다.
                      </p>
                    </Hint>
                  </div>
                  <NumInput value={numOf(active.cashFloorPct) || ''} disabled={readOnly} placeholder="0 = 바닥선 없음"
                    onCommit={(v) => patchActive({ cashFloorPct: Math.max(0, v) })} />
                  {numOf(active.cashFloorPct) > 0 && active.allowNegativeCash && (
                    <p className="text-[10px] text-gray-500 leading-relaxed">
                      ⑤의 ‘마이너스 예수금 허용’이 켜져 있지만 <b className="text-gray-400">바닥선이 우선</b>이라
                      예수금은 음수가 되지 않습니다.
                    </p>
                  )}
                </div>

                {/* ── E. 연간 가드레일 증액 ── */}
                <div className="flex flex-col gap-1.5 border-t border-gray-800 pt-2">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>연간 가드레일 증액</span>
                    <Hint width={380}>
                      <p>
                        일정 주기마다 <b className="text-gray-300">생활비 예약금을 뺀 잉여 현금</b>의 일부를
                        종목 목표금액에 얹어 <b className="text-gray-300">월 분배금을 키웁니다</b>.
                        시작월 + 주기 × N 이 되는 달의 <b className="text-gray-300">첫 리밸런싱일</b>에 실행합니다.
                      </p>
                      <p className="mt-1">
                        증액액 = (그 시점 예수금 − 예약금) × 비율. 예약금은 <b className="text-gray-300">절대 투자에 쓰지
                        않습니다</b>(비율을 100%보다 크게 잡아도 예약금은 남습니다).
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">②-b 매월 목표 증액과 완전히 독립</b>입니다. 같은 날 겹치면
                        매월 증액이 먼저, 연간 증액이 나중입니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">목표 금액 모드 전용</b>입니다 — 목표 비중 % 모드는 목표가
                        ‘평가액 합계 × 비중’이라 올릴 대상이 없습니다.
                      </p>
                    </Hint>
                  </div>
                  <select className={INPUT} value={annualOf(active).mode} disabled={readOnly}
                    onChange={(e) => patchActive({ annualReview: { ...annualOf(active), mode: e.target.value } })}>
                    <option value="none">사용 안 함</option>
                    <option value="pctOfSurplus">잉여 현금(예수금 − 예약금)의 % 만큼</option>
                  </select>
                  {annualOf(active).mode === 'pctOfSurplus' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <span className={LABEL}>잉여의 비율 (%)</span>
                          <NumInput value={annualOf(active).value} disabled={readOnly}
                            onCommit={(v) => patchActive({ annualReview: { ...annualOf(active), value: Math.max(0, v) } })} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className={LABEL}>주기 (개월)</span>
                          <NumInput value={annualOf(active).everyMonths} disabled={readOnly}
                            onCommit={(v) => patchActive({ annualReview: { ...annualOf(active), everyMonths: Math.min(120, Math.max(1, Math.round(v))) } })} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <span className={LABEL}>생활비 예약금 (원)</span>
                          <NumInput value={annualOf(active).reserve} disabled={readOnly}
                            onCommit={(v) => patchActive({ annualReview: { ...annualOf(active), reserve: Math.max(0, v) } })} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className={LABEL}>종목별 배분</span>
                          <select className={INPUT} value={annualOf(active).split} disabled={readOnly}
                            onChange={(e) => patchActive({ annualReview: { ...annualOf(active), split: e.target.value } })}>
                            <option value="ratio">현재 목표금액 비율대로</option>
                            <option value="even">대상 종목에 균등</option>
                          </select>
                        </div>
                      </div>
                      {active.targetMode === 'ratio' && (
                        <p className="text-[10px] text-amber-400/90 leading-relaxed">
                          ⚠️ <b>목표 비중 %</b> 모드에서는 연간 증액이 <b>집행되지 않습니다</b> — 목표가
                          '종목 평가액 합계 × 비중'이라 늘릴 대상이 없기 때문입니다(②-b 매월 증액과 같은 이유).
                        </p>
                      )}
                    </>
                  )}
                </div>

                {/* ── F. 분배금 원천징수 ── */}
                <div className="flex flex-col gap-1 border-t border-gray-800 pt-2">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>분배금 원천징수 (%)</span>
                    <Hint width={360}>
                      <p>
                        지급일에 분배금이 예수금으로 들어올 때 이 비율만큼 <b className="text-gray-300">세금을 떼고</b>
                        입금합니다(예: 국내 배당소득세 15.4).
                      </p>
                      <p className="mt-1">
                        <b className="text-gray-300">분배락 기준 권리 확정액(누적 분배금)은 세전 그대로</b> 두고
                        현금 흐름만 세후로 바꿉니다 — 그래야 ‘기말 예수금’ 분해가 그대로 맞습니다.
                      </p>
                      <p className="mt-1 text-gray-500">
                        ※ <b className="text-gray-400">0이면 세금 없음</b>(종전 동작).
                        매매차익 과세는 반영하지 않습니다(국내주식형 ETF 비과세 전제).
                      </p>
                    </Hint>
                  </div>
                  <NumInput value={numOf(active.divTaxPct) || ''} disabled={readOnly} placeholder="0 = 세금 없음"
                    onCommit={(v) => patchActive({ divTaxPct: Math.min(100, Math.max(0, v)) })} />
                </div>
              </Section>

              <Section
                title="⑥ 종목"
                badge={`${active.assets.length}/${MAX_BT_ASSETS}`}
                hint={(
                  <>
                    <p>
                      종목코드를 넣으면 앱에 저장된 일별 종가·분배금 이력을 그대로 씁니다.
                      저장된 게 없으면 자동으로 조회하며, 그래도 없으면 아래
                      <b className="text-gray-300"> '종가 직접 붙여넣기'</b>로 넣을 수 있습니다.
                    </p>
                    <p className="mt-1">
                      종목명 옆 <b className="text-gray-300">종목코드</b>나 <b className="text-gray-300">↗ 아이콘</b>을 누르면
                      네이버 금융 상세 페이지가 새 탭에서 열립니다.
                    </p>
                  </>
                )}
              >
                <div className="flex gap-1">
                  <input className={INPUT} placeholder="종목코드 (예: 498400)" value={newCode} disabled={readOnly}
                    list="bt-catalog"
                    onChange={(e) => setNewCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addAsset(newCode); }} />
                  <datalist id="bt-catalog">
                    {catalog.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </datalist>
                  <button className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30 shrink-0`}
                    disabled={readOnly || !newCode.trim()} onClick={() => addAsset(newCode)}>추가</button>
                </div>

                {active.assets.map((a, i) => {
                  const rng = seriesRange(prices[a.code]);
                  const meta = result?.assetMeta?.find((m) => m.assetId === a.id);
                  const loading = fetchingCodes.includes(a.code);
                  return (
                    <div key={a.id} className="border border-gray-800 rounded p-1.5 flex flex-col gap-1 bg-gray-900/60">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color || BT_COLORS[i % BT_COLORS.length] }} />
                        <input className={`${INPUT} flex-1`} value={a.name} disabled={readOnly}
                          onChange={(e) => patchAsset(a.id, { name: e.target.value })} placeholder="종목명" />
                        {/* ⚠️ 종목명 칸은 사용자가 고칠 수 있는 input이라 링크로 만들 수 없다 —
                            대신 코드와 ↗ 아이콘을 상세 페이지 진입점으로 둔다. */}
                        <button type="button" className="text-[11px] text-gray-500 font-mono shrink-0 hover:text-sky-300 hover:underline"
                          title={`${a.name || a.code} 상세 페이지 열기 (새 탭)`} onClick={() => openStock(a.code)}>
                          {a.code}
                        </button>
                        <button type="button" className="p-0.5 text-gray-600 hover:text-sky-300 shrink-0"
                          title={`${a.name || a.code} 상세 페이지 열기 (새 탭)`} onClick={() => openStock(a.code)}>
                          <ExternalLink size={11} />
                        </button>
                        <button className="p-0.5 text-gray-600 hover:text-sky-300 shrink-0" title="종가 다시 조회"
                          disabled={readOnly || loading || !onFetchCode} onClick={() => onFetchCode?.(a.code, undefined, true)}>
                          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button className="p-0.5 text-gray-600 hover:text-red-400 shrink-0" disabled={readOnly}
                          onClick={() => removeAsset(a.id)}><Trash2 size={11} /></button>
                      </div>
                      {/* ⚠️ 목표 칸에는 반드시 라벨을 둔다 — 라벨 없이 두면 이 칸이 '내가 값을 넣는
                          자리'로 읽히지 않아, ② 목표 기준의 '종목 수로 균등 분배' 버튼이 유일한
                          조작 수단처럼 보인다("균등분배로 고정돼 있다"는 사용자 보고의 실체). */}
                      <div className="grid grid-cols-2 gap-1">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-gray-600">분배 주기</span>
                          <select className={INPUT} value={a.payCycle} disabled={readOnly}
                            onChange={(e) => patchAsset(a.id, { payCycle: e.target.value })}>
                            <option value="mid">월중 분배 (15일 기준)</option>
                            <option value="eom">월말 분배 (말일 기준)</option>
                            <option value="none">분배 없음</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-gray-600">
                            {active.targetMode === 'amount' ? '목표 금액 (직접 입력)' : '목표 비중 % (직접 입력)'}
                          </span>
                          {active.targetMode === 'amount' ? (
                            <NumInput value={a.targetAmount} allowEmpty placeholder="목표금액" disabled={readOnly}
                              onCommit={(v) => patchAsset(a.id, { targetAmount: v })} />
                          ) : (
                            <NumInput value={a.targetRatio} allowEmpty placeholder="목표비중 %" disabled={readOnly}
                              onCommit={(v) => patchAsset(a.id, { targetRatio: v })} />
                          )}
                        </label>
                      </div>
                      {/* 종목별 리밸런싱 일정 — 분배가 불규칙한 종목을 전역 정책과 다르게 돌린다.
                          ⚠️ '전역 정책 따름'이 아닌 종목은 월별 **일괄** 오버라이드에 끌려가지 않는다. */}
                      <div className="grid grid-cols-2 gap-1">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-gray-600">리밸런싱 일정</span>
                          <select className={INPUT} value={a.rebalMode} disabled={readOnly}
                            onChange={(e) => patchAsset(a.id, { rebalMode: e.target.value })}>
                            <option value="follow">전역 정책 따름</option>
                            <option value="mid">이 종목만 · 월중 분배락 전</option>
                            <option value="eom">이 종목만 · 월말 분배락 전</option>
                            <option value="day">이 종목만 · 매월 지정일</option>
                            <option value="dates">이 종목만 · 지정 날짜에만</option>
                            <option value="none">리밸런싱 안 함</option>
                          </select>
                        </label>
                        {a.rebalMode === 'day' ? (
                          <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] text-gray-600">매월 며칠 (휴장이면 직전 영업일)</span>
                            <NumInput value={a.rebalDay} disabled={readOnly}
                              onCommit={(v) => patchAsset(a.id, { rebalDay: Math.min(31, Math.max(1, Math.round(v))) })} />
                          </label>
                        ) : a.rebalMode === 'dates' ? (
                          <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] text-gray-600">날짜 추가</span>
                            <input type="date" className={INPUT} value="" disabled={readOnly || a.rebalDates.length >= MAX_BT_REBAL_DATES}
                              onChange={(e) => {
                                const d = e.target.value;
                                // ⚠️ 상한을 여기서 막지 않으면 초과분이 저장은 되고 **다음 로드에서
                                //    조용히 절삭**돼(정규화) 그때 결과가 달라진다.
                                if (!d || a.rebalDates.includes(d) || a.rebalDates.length >= MAX_BT_REBAL_DATES) return;
                                patchAsset(a.id, { rebalDates: [...a.rebalDates, d].sort() });
                              }} />
                          </label>
                        ) : <span />}
                      </div>
                      {a.rebalMode === 'dates' && (
                        <div className="flex flex-wrap gap-1">
                          {a.rebalDates.length === 0 && (
                            <span className="text-[9px] text-amber-400/90">날짜를 하나도 지정하지 않으면 이 종목은 리밸런싱되지 않습니다.</span>
                          )}
                          {a.rebalDates.map((d) => (
                            <button key={d} disabled={readOnly}
                              title="클릭하여 제거"
                              className="px-1 py-0.5 rounded text-[9px] border border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-300"
                              onClick={() => patchAsset(a.id, { rebalDates: a.rebalDates.filter((x) => x !== d) })}>
                              {d} ✕
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-gray-600">편입일 (비우면 자동)</span>
                          <input type="date" className={INPUT} value={a.startDate} disabled={readOnly}
                            onChange={(e) => patchAsset(a.id, { startDate: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-gray-600">제외일 (선택)</span>
                          <input type="date" className={INPUT} value={a.endDate} disabled={readOnly}
                            onChange={(e) => patchAsset(a.id, { endDate: e.target.value })} />
                        </label>
                      </div>
                      {/* 데이터 범위 배지 — 조회기간 중간 상장/결측을 눈에 띄게 */}
                      <div className="flex flex-wrap items-center gap-1 text-[9px]">
                        {loading ? (
                          <span className="px-1 py-0.5 rounded bg-sky-900/40 text-sky-300 border border-sky-800">조회 중…</span>
                        ) : rng.count === 0 ? (
                          <span className="px-1 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-800">종가 데이터 없음</span>
                        ) : (
                          <>
                            <span className="px-1 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                              {rng.first} ~ {rng.last} · {rng.count}일
                            </span>
                            {meta?.lateStart && (
                              <span className="px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800">
                                {meta.effectiveStart}부터 편입
                              </span>
                            )}
                            {meta?.earlyEnd && (
                              <span className="px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800">
                                {meta.lastDate}에 기록 끊김
                              </span>
                            )}
                            {meta?.gapCount > 0 && (
                              <span className="px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800">
                                결측 {meta.gapCount}구간
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* 목표 합계 줄 — 종목마다 자유롭게 넣은 값이 재원(또는 100%)에 대해 어디쯤인지 항상 보여 준다.
                    ⚠️ 색으로 경고만 하고 **실행은 절대 막지 않는다**. 합이 100%가 아닌 것도, 재원보다
                       적은 것도 엔진이 그대로 실행하는 정상 상태다(각각의 뜻은 ② 도움말 참조). */}
                {targetSummary && targetSummary.count > 0 && (
                  <div className={`rounded border px-2 py-1.5 flex flex-col gap-1 ${
                    targetSummary.level === 'over' ? 'border-red-800 bg-red-900/20'
                      : targetSummary.level === 'under' ? 'border-amber-800 bg-amber-900/20'
                        : 'border-gray-800 bg-gray-900/60'}`}>
                    <div className="flex items-baseline justify-between gap-2 text-[10px]">
                      <span className="text-gray-400 shrink-0">
                        {targetSummary.isAmt ? '목표 합계' : '비중 합계'}
                      </span>
                      <span className={`font-mono text-right ${
                        targetSummary.level === 'over' ? 'text-red-300'
                          : targetSummary.level === 'under' ? 'text-amber-300' : 'text-gray-200'}`}>
                        {targetSummary.isAmt
                          ? `${won(targetSummary.sum)} / ${won(targetSummary.goal)}`
                          : `${formatNumber(Math.round(targetSummary.sum * 100) / 100)}% / 100%`}
                      </span>
                    </div>
                    <div className="text-[9px] text-gray-500 leading-relaxed">
                      {targetSummary.filledCount === 0 ? (
                        <span className="text-amber-300">
                          아직 입력된 목표가 없습니다 — 위 각 종목의
                          {targetSummary.isAmt ? " '목표 금액'" : " '목표 비중 %'"} 칸에 직접 입력하세요.
                        </span>
                      ) : targetSummary.isAmt ? (
                        <>
                          재원 = 초기 투자금 (추가 예수금 제외) · 차액{' '}
                          <span className={targetSummary.level === 'over' ? 'text-red-300' : targetSummary.level === 'under' ? 'text-amber-300' : 'text-gray-400'}>
                            {wonSigned(targetSummary.diff)}
                          </span>
                          {targetSummary.level === 'over'
                            ? ' — 재원을 넘어섭니다(예수금이 모자라면 살 수 있는 만큼만 삽니다).'
                            : targetSummary.level === 'under'
                              ? ' — 남는 돈은 예수금으로 남습니다.'
                              : ' — 재원과 일치합니다.'}
                        </>
                      ) : (
                        <>
                          차액{' '}
                          <span className={targetSummary.level === 'over' ? 'text-red-300' : targetSummary.level === 'under' ? 'text-amber-300' : 'text-gray-400'}>
                            {`${targetSummary.diff > 0 ? '+' : targetSummary.diff < 0 ? '−' : ''}${formatNumber(Math.abs(Math.round(targetSummary.diff * 100) / 100))}%p`}
                          </span>
                          {targetSummary.level === 'ok'
                            ? ' — 100%와 일치합니다.'
                            : ' — 리밸런싱마다 그 차이만큼 사고팝니다(100%가 아니어도 실행됩니다).'}
                        </>
                      )}
                      {targetSummary.filledCount > 0 && targetSummary.emptyCount > 0 && (
                        <span className="text-gray-500">{` · 미입력 ${targetSummary.emptyCount}종목`}</span>
                      )}
                    </div>
                    {/* ⚠️ 이 버튼은 **미입력 칸만** 채운다 — 이미 넣은 값은 건드리지 않는다.
                        전부 덮어쓰는 '종목 수로 균등 분배'(② 목표 기준)와 혼동하지 말 것. */}
                    {targetSummary.isAmt && targetSummary.emptyCount > 0 && (
                      <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800 w-full`}
                        onClick={fillEmptyTargets}
                        disabled={readOnly || !(targetSummary.diff < -1)}
                        title={targetSummary.diff < -1
                          ? `남은 재원 ${won(-targetSummary.diff)}을 미입력 ${targetSummary.emptyCount}종목에 균등 배분합니다 (이미 입력한 값은 그대로)`
                          : '남은 재원이 없습니다'}>
                        빈 종목에 잔여 채우기 ({targetSummary.emptyCount}종목)
                      </button>
                    )}
                  </div>
                )}

                <button className={`${BTN} text-gray-400 border-gray-700 hover:bg-gray-800 w-full`}
                  onClick={() => setPasteOpen((v) => !v)}>
                  종가 직접 붙여넣기 (앱·API에 없는 종목)
                </button>
                {pasteOpen && (
                  <div className="flex flex-col gap-1 border border-gray-800 rounded p-1.5">
                    <input className={INPUT} placeholder="종목코드" value={pasteCode} onChange={(e) => setPasteCode(e.target.value)} />
                    <textarea className={`${INPUT} h-24 font-mono text-[10px]`} placeholder={'2026-01-02, 19500\n2026-01-05, 19600\n…'}
                      value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                    <div className="flex items-center gap-1">
                      <button className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30`}
                        disabled={readOnly || !pasteCode.trim() || !pasteText.trim()}
                        onClick={() => {
                          const { data, ok: n, bad } = parsePastedSeries(pasteText);
                          if (!n) { setPasteMsg('인식된 줄이 없습니다. "날짜, 종가" 형식인지 확인해 주세요.'); return; }
                          onFetchCode?.(pasteCode.trim().toUpperCase(), data);
                          setPasteMsg(`${n}건 적용${bad ? ` (${bad}건 무시)` : ''}`);
                          addAsset(pasteCode);
                          setPasteText('');
                        }}>적용</button>
                      {pasteMsg && <span className="text-[10px] text-gray-500">{pasteMsg}</span>}
                    </div>
                  </div>
                )}
              </Section>

              <Section
                title="⑦ 중도 종목 변경 / 추가"
                badge={`${active.events.length}/${MAX_BT_EVENTS}`}
                hint={(
                  <p>
                    기간 도중에 종목을 <b className="text-gray-300">갈아타거나 새로 편입</b>할 때 씁니다.
                    이 매매는 정기 리밸런싱과 성격이 달라 결과 표에 <b className="text-gray-300">회색 '재편' 행</b>으로
                    구분되고, <b className="text-gray-300">누적 매매차익에는 넣지 않습니다</b>(별도 집계).
                  </p>
                )}
              >
                <button className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30 w-full`}
                  disabled={readOnly || active.events.length >= MAX_BT_EVENTS}
                  onClick={() => patchActive({
                    events: [...active.events, {
                      id: generateId(), date: active.startDate || '', label: '종목 재편',
                      funding: 'reallocate', addAssets: [], removeAssets: [],
                      targets: active.assets.map((a) => ({ assetId: a.id, amount: null, ratio: null })),
                    }],
                  })}>
                  <Plus size={11} className="inline -mt-0.5" /> 이벤트 추가
                </button>
                {active.events.map((e) => (
                  <div key={e.id} className="border border-gray-800 rounded p-1.5 flex flex-col gap-1 bg-gray-900/60">
                    <div className="flex items-center gap-1">
                      <input type="date" className={`${INPUT} w-[130px]`} value={e.date} disabled={readOnly}
                        onChange={(ev) => patchActive({ events: active.events.map((x) => x.id === e.id ? { ...x, date: ev.target.value } : x) })} />
                      <input className={`${INPUT} flex-1`} value={e.label} placeholder="설명" disabled={readOnly}
                        onChange={(ev) => patchActive({ events: active.events.map((x) => x.id === e.id ? { ...x, label: ev.target.value } : x) })} />
                      <button className="p-0.5 text-gray-600 hover:text-red-400 shrink-0" disabled={readOnly}
                        onClick={() => patchActive({ events: active.events.filter((x) => x.id !== e.id) })}><Trash2 size={11} /></button>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className={LABEL}>금액 조정 방식</span>
                      <select className={INPUT} value={e.funding} disabled={readOnly}
                        onChange={(ev) => patchActive({ events: active.events.map((x) => x.id === e.id ? { ...x, funding: ev.target.value } : x) })}>
                        <option value="reallocate">전체 재편 — 기존 종목을 팔아 새 목표로 다 같이 맞춤</option>
                        <option value="cash">보유 현금으로만 — 신규 종목만 매수, 기존은 그대로</option>
                        <option value="defer">목표만 변경 — 매매는 다음 정기 리밸런싱에서</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className={LABEL}>이 날짜부터 편입할 종목</span>
                      <div className="flex flex-wrap gap-1">
                        {active.assets.map((a) => {
                          const on = e.addAssets.includes(a.id);
                          return (
                            <button key={a.id} disabled={readOnly}
                              className={`px-1.5 py-0.5 rounded text-[10px] border ${on ? 'text-emerald-200 border-emerald-700 bg-emerald-900/40' : 'text-gray-500 border-gray-700'}`}
                              onClick={() => patchActive({
                                events: active.events.map((x) => x.id === e.id ? {
                                  ...x, addAssets: on ? x.addAssets.filter((y) => y !== a.id) : [...x.addAssets, a.id],
                                } : x),
                              })}>{a.name || a.code}</button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className={LABEL}>이 날짜에 전량 매도할 종목</span>
                      <div className="flex flex-wrap gap-1">
                        {active.assets.map((a) => {
                          const on = e.removeAssets.includes(a.id);
                          return (
                            <button key={a.id} disabled={readOnly}
                              className={`px-1.5 py-0.5 rounded text-[10px] border ${on ? 'text-red-200 border-red-800 bg-red-900/40' : 'text-gray-500 border-gray-700'}`}
                              onClick={() => patchActive({
                                events: active.events.map((x) => x.id === e.id ? {
                                  ...x, removeAssets: on ? x.removeAssets.filter((y) => y !== a.id) : [...x.removeAssets, a.id],
                                } : x),
                              })}>{a.name || a.code}</button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className={LABEL}>이 날짜 이후 새 목표 ({active.targetMode === 'amount' ? '금액' : '비중 %'})</span>
                      {active.assets.map((a) => {
                        const t = e.targets.find((x) => x.assetId === a.id);
                        const val = active.targetMode === 'amount' ? (t?.amount ?? null) : (t?.ratio ?? null);
                        return (
                          <div key={a.id} className="flex items-center gap-1">
                            <span className="text-[10px] text-gray-500 flex-1 truncate">{a.name || a.code}</span>
                            <NumInput value={val} allowEmpty placeholder="변경 없음" className="w-28" disabled={readOnly}
                              onCommit={(v) => patchActive({
                                events: active.events.map((x) => x.id === e.id ? {
                                  ...x,
                                  targets: [
                                    ...x.targets.filter((y) => y.assetId !== a.id),
                                    { assetId: a.id, amount: active.targetMode === 'amount' ? v : (t?.amount ?? null), ratio: active.targetMode === 'ratio' ? v : (t?.ratio ?? null) },
                                  ],
                                } : x),
                              })} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </Section>
            </>
          )}
          </div>
        </div>

        {/* ── 결과 ── */}
        <div id="bt-print" className="flex-1 min-w-0 overflow-y-auto p-3">
          {isCompare ? (
            <CompareView
              runs={compareRuns}
              okRuns={compareOk}
              series={compareSeries}
              mode={cmpMode}
              onMode={setCmpMode}
              capitalsDiffer={capitalsDiffer}
              colorOf={colorOfScenario}
              onOpen={setActiveId}
              total={local.length}
            />
          ) : !active ? null : !result ? (
            <div className="text-center text-gray-500 text-xs py-10">계산 중…</div>
          ) : !result.ok ? (
            /* ⚠️ 실행 불가 상태에서도 평가·메모는 **반드시** 보여야 한다. 이 분기는 종목을 지운
                  경우만이 아니라 **저장된 시나리오를 새 세션에서 여는 흔한 경로**로도 들어온다
                  (btFetched는 메모리 전용이라 보유하지 않은 코드는 ⟳를 누르기 전까지 '종가 데이터가
                  있는 종목이 없습니다'로 떨어진다). 여기서 카드를 빼면 상단 바 칩은 '메모 3'을
                  광고하는데 눌러도 갈 곳이 없고, 저장해 둔 AI 분석에 닿는 경로가 하나도 없다. */
            <>
              <ScenarioReviewCard
                key={active.id}
                cfg={active}
                result={result}
                readOnly={readOnly}
                onPatch={patchScenarioById}
                onAddNote={addNote}
                registerFlush={registerReviewFlush}
              />
              <div className="max-w-lg mx-auto mt-10 border border-amber-800/60 bg-amber-900/20 rounded-lg p-4 text-center">
                <AlertCircle size={20} className="text-amber-400 mx-auto mb-2" />
                <p className="text-sm text-amber-200">{result.fatal}</p>
              </div>
            </>
          ) : (
            <>
              {/* 표제 */}
              <div className="mb-3">
                <h2 className="text-lg font-bold text-gray-100">📊 {active.name} — 리밸런싱 백테스트</h2>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  기간 {result.summary.startDate} ~ {result.summary.endDate} · 초기 투자금 {won(active.initialCapital)}
                  {active.extraCash > 0 && ` (+ 예수금 ${won(active.extraCash)})`} ·
                  {' '}{TARGET_MODE_LABEL[active.targetMode] || active.targetMode} ·
                  {' '}수량 {active.rounding === 'floor' ? '내림' : active.rounding === 'round' ? '반올림' : '소수 허용'}
                </p>
              </div>

              {/* 시나리오 평가 — 표제 **바로 아래(헤더 상단)**. PDF에서도 첫 장 맨 위에 실린다.
                  ⚠️ key={active.id} — 시나리오를 바꾸면 리마운트되어 카드의 미커밋 draft가
                     언마운트 cleanup에서 **이전 시나리오**에 커밋된다(다른 시나리오 오적용 방지). */}
              <ScenarioReviewCard
                key={active.id}
                cfg={active}
                result={result}
                readOnly={readOnly}
                onPatch={patchScenarioById}
                onAddNote={addNote}
                registerFlush={registerReviewFlush}
              />

              {/* 요약 카드 — ⚠️ 비교 종합의 시나리오별 블록과 같은 컴포넌트를 쓴다(복제 금지). */}
              <SummaryCards result={result} />
              {/* 전략 지표 — 켠 보조 규칙에 해당하는 카드만 나온다(안 켰으면 최저 예수금·월 분배금·부족 발생 3장). */}
              <StrategyKpis result={result} cfg={active} />

              <div className="border border-gray-800 rounded-lg p-2 bg-gray-900/40 mb-3">
                <CurveChart curve={result.curve} />
              </div>

              {/* 경고 */}
              {result.warnings.length > 0 && (
                <div className="border border-amber-800/50 bg-amber-900/15 rounded-lg p-2 mb-3">
                  <div className="flex items-center gap-1 text-[12px] font-bold text-amber-300 mb-1">
                    <AlertCircle size={12} /> 확인이 필요한 항목 ({result.warnings.length})
                  </div>
                  <ul className="text-[12px] text-amber-200/80 leading-relaxed list-disc pl-4">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {/* Phase 0 */}
              <div className="mb-4 bt-month">
                <h3 className="text-sm font-bold text-gray-300 mb-1">🏁 [Phase 0] 초기 자본 투입 — {result.initialDate}</h3>
                <div className="overflow-x-auto border border-gray-800 rounded-lg">
                  <table className={`${TBL} min-w-[680px]`}>
                    <thead className="bg-gray-800/70 text-gray-400">
                      <tr>
                        <th className={`${TH} text-left`}>종목명</th>
                        <th className={`${TH} text-right`}>당일 종가</th>
                        <th className={`${TH} text-right`}>매수 수량</th>
                        <th className={`${TH} text-right`}>매수 금액</th>
                        <th className={`${TH} text-right`}>비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.initialTrades.map((t) => (
                        <tr key={t.assetId} className="border-t border-gray-800/70">
                          <td className={`${TD} text-gray-200`}><StockLink code={t.code} name={t.name} showCode /></td>
                          <td className={`${TD} text-right text-gray-300`}>{won(t.price)}</td>
                          <td className={`${TD} text-right text-gray-200`}>{qtyText(t.qty)}주</td>
                          <td className={`${TD} text-right text-gray-200`}>{won(Math.abs(t.cashDelta))}</td>
                          <td className={`${TD} text-right text-gray-500 text-[11px]`}>목표 {won(t.target)}{t.note && ` · ${t.note}`}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                        <td className={`${TD} text-gray-300`}>합계</td>
                        <td className={`${TD} text-right text-gray-600`}>-</td>
                        <td className={`${TD} text-right text-gray-200`}>{qtyText(result.initialTrades.reduce((s, t) => s + t.qty, 0))}주</td>
                        <td className={`${TD} text-right text-gray-200`}>{won(result.initialTrades.reduce((s, t) => s + Math.abs(t.cashDelta), 0))}</td>
                        <td className={`${TD} text-right text-emerald-300`}>잔여 예수금 {won(result.initialCashAfter)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 월별 */}
              {result.months.map((m) => {
                const { rows, orphans } = joinTradeDividends(m.trades, m.dividends);
                // ⚠️ 보유가 있으면 거래·분배가 없는 달도 렌더한다 — 이 기능의 목적이 "이번 달에
                //    손대지 않은 종목이 몇 주인지"이고, CSV는 이미 그 달을 무조건 내보내므로
                //    여기서만 스킵하면 화면과 CSV가 갈린다.
                if (!rows.length && !orphans.length && !m.holdings.length) return null;
                const hasTable = rows.length > 0 || orphans.length > 0;
                // 같은 종목이 두 번 이상 거래된 달인가(합계 셀 중복 계상 판정)
                const seenAsset = new Set<string>();
                let dupTraded = false;
                for (const t of m.trades) {
                  if (seenAsset.has(t.assetId)) { dupTraded = true; break; }
                  seenAsset.add(t.assetId);
                }
                return (
                  <div key={m.ym} className="mb-4 bt-month">
                    <h3 className="text-sm font-bold text-gray-300 mb-1">
                      📅 {m.ym.replace('-', '년 ')}월
                      {!hasTable && <span className="ml-1 font-normal text-gray-600 text-[11px]">— 이 달은 매매·분배가 없습니다</span>}
                    </h3>
                    {hasTable && (
                    <div className="overflow-x-auto border border-gray-800 rounded-lg">
                      <table className={`${TBL} min-w-[1320px]`}>
                        <thead className="bg-gray-800/70 text-gray-400">
                          <tr>
                            <th className={`${TH} text-left`}>리밸런싱일</th>
                            <th className={`${TH} text-left`}>대상 종목</th>
                            <th className={`${TH} text-right`}>종가</th>
                            <th className={`${TH} text-right`}>리밸런싱 전 평가액</th>
                            <th className={`${TH} text-right`}>매수/매도</th>
                            <th className={`${TH} text-right`}>매매 금액</th>
                            <th className={`${TH} text-right`}>조정 후 수량</th>
                            <th className={`${TH} text-right`}>조정 후 평가액</th>
                            <th className={`${TH} text-center`}>분배락일</th>
                            <th className={`${TH} text-center`}>지급일</th>
                            <th className={`${TH} text-right`}>주당 분배금</th>
                            <th className={`${TH} text-right`}>지급 분배금</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ trade: t, dividend: d }, i) => (
                            <tr key={`${t.assetId}-${t.date}-${i}`}
                              className={`border-t border-gray-800/70 ${t.structural ? 'bg-gray-800/40' : t.reinvest ? 'bg-emerald-950/25' : ''}`}>
                              <td className={`${TD} text-gray-300 whitespace-nowrap`}>
                                {t.date}
                                {t.structural && <span className="ml-1 text-[10px] text-amber-400">재편</span>}
                                {t.reinvest && <span className="ml-1 text-[10px] text-emerald-400" title="분배금 재투자 매수 — 누적 매매차익에는 포함하지 않습니다">재투자</span>}
                                {/* ⚠️ 시그널 매매에 라벨이 없으면 policy:'none'(리밸런싱 안 함)에서
                                        각주는 "정기 리밸런싱은 일어나지 않습니다"라고 하는데 표는
                                        설명 없는 매매 행으로 가득 찬다. 특히 **재조정 매도**는
                                        시그널이 뜬 적 없는 다른 종목이 팔린 것이라 출처를 밝히지
                                        않으면 화면 어디에도 근거가 없다(적대적 리뷰 확정 결함). */}
                                {t.signal === 'buy' && <span className="ml-1 text-[10px] text-amber-300" title="매수 시그널 — 발동일 종가로 목표까지 매수">시그널 매수</span>}
                                {t.signal === 'sell' && <span className="ml-1 text-[10px] text-sky-300" title="매도 시그널 — 발동일 종가로 목표 초과분 매도">시그널 매도</span>}
                                {t.signal === 'realloc' && <span className="ml-1 text-[10px] text-sky-300" title="시그널 매수 재원을 만들려고 목표 초과분을 매도했습니다(재조정)">재조정 매도</span>}
                                {!t.priceExact && <span className="ml-1 text-[10px] text-amber-400" title="그 날짜 종가가 없어 직전 종가를 사용">≈</span>}
                                {/* ⚠️ 이 표에는 '비고' 열이 없어 t.note가 어디에도 보이지 않았다 —
                                        '예수금 부족'·'바닥선'·'보유수량 한도'로 매매가 잘린 사실이 화면에서
                                        통째로 사라진다. 열을 늘리면 12열 정합(thead·orphan·tfoot·CSV)을
                                        전부 손봐야 하므로 날짜 셀의 배지로 붙인다. */}
                                {t.note && (
                                  <span className="ml-1 text-[10px] text-amber-400"
                                    title={t.note === '바닥선'
                                      ? '현금 바닥선을 지키기 위해 매수액을 줄였습니다'
                                      : t.note === '예수금 부족'
                                        ? '재원 한도까지만 매수했습니다'
                                        : '보유수량을 넘겨 매도할 수 없어 전량 매도로 줄였습니다'}>
                                    {t.note}
                                  </span>
                                )}
                              </td>
                              <td className={`${TD} text-gray-200 whitespace-nowrap`}><StockLink code={t.code} name={t.name} /></td>
                              <td className={`${TD} text-right text-gray-300`}>{won(t.price)}</td>
                              <td className={`${TD} text-right text-gray-300`}>{won(t.evalBefore)}</td>
                              <td className={`${TD} text-right font-bold ${t.qty < 0 ? 'text-blue-300' : 'text-red-300'}`}>
                                {qtyText(Math.abs(t.qty))}주 {t.qty < 0 ? '매도' : '매수'}
                              </td>
                              <td className={`${TD} text-right ${pnlCls(t.cashDelta)}`}>{wonSigned(t.cashDelta)}</td>
                              <td className={`${TD} text-right text-gray-200`}>{qtyText(t.qtyAfter)}주</td>
                              {/* 조정 후 평가액 = 조정 후 수량 × 그날 종가 (BtTrade.evalAfter) */}
                              <td className={`${TD} text-right text-gray-200`}>{won(t.evalAfter)}</td>
                              <td className={`${TD} text-center text-gray-500 text-[11px] whitespace-nowrap`}>{d?.exDate || '-'}</td>
                              <td className={`${TD} text-center text-gray-500 text-[11px] whitespace-nowrap`}>{d?.payDate || '-'}</td>
                              <td className={`${TD} text-right`}>
                                {d ? (
                                  <DivInput
                                    value={d.perShare}
                                    unknown={d.source === 'none'}
                                    disabled={readOnly}
                                    title={d.source === 'history' ? '계좌 분배금 이력' : d.source === 'manual' ? '직접 입력' : '이력 없음 — 직접 입력하세요'}
                                    onCommit={(v) => patchAsset(d.assetId, {
                                      divOverride: { ...(active.assets.find((a) => a.id === d.assetId)?.divOverride || {}), [d.ym]: v },
                                    })}
                                  />
                                ) : <span className="text-gray-700">-</span>}
                              </td>
                              <td className={`${TD} text-right text-emerald-300`}>{d ? won(d.amount) : <span className="text-gray-700">-</span>}</td>
                            </tr>
                          ))}
                          {orphans.map((d, i) => (
                            <tr key={`orphan-${i}`} className="border-t border-gray-800/70">
                              <td className={`${TD} text-gray-600 text-[11px]`}>(리밸런싱 없음)</td>
                              <td className={`${TD} text-gray-300`}><StockLink code={d.code} name={d.name} /></td>
                              <td colSpan={4} className={`${TD} text-right text-gray-700`}>-</td>
                              <td className={`${TD} text-right text-gray-300`}>{qtyText(d.qty)}주</td>
                              <td className={`${TD} text-right text-gray-700`}>-</td>
                              <td className={`${TD} text-center text-gray-500 text-[11px]`}>{d.exDate}</td>
                              <td className={`${TD} text-center text-gray-500 text-[11px]`}>{d.payDate}</td>
                              <td className={`${TD} text-right text-gray-300`}>{formatNumber(d.perShare)}</td>
                              <td className={`${TD} text-right text-emerald-300`}>{won(d.amount)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                            <td className={`${TD} text-gray-300`}>합계</td>
                            <td className={`${TD} text-gray-600`}>-</td>
                            <td className={`${TD} text-right text-gray-600`}>-</td>
                            {/* ⚠️ 평가액 합계는 **한 종목이 그 달에 두 번 이상 거래되면 렌더하지 않는다**.
                                evalBefore/evalAfter는 거래 시점의 '포지션 전체 평가액'이라 거래 단위로 더하면
                                같은 종목이 중복 계상된다(재편+정기 리밸런싱이 겹친 달에서 실측 2.17배).
                                첨부 PDF도 정확히 그런 달(4월)의 합계를 '-'로 비워 뒀다 — 그 규약을 따른다.
                                시점 정합 총액은 아래 '월말 보유 현황 · 종목 합계'가 담당한다. */}
                            <td className={`${TD} text-right text-gray-200`} title={dupTraded ? '같은 종목이 이 달에 두 번 이상 거래되어 단순 합이 중복 계상됩니다 — 아래 월말 보유 현황을 참고하세요.' : undefined}>
                              {dupTraded ? <span className="text-gray-600 font-normal">-</span> : won(m.evalBeforeSum)}
                            </td>
                            <td className={`${TD} text-right text-gray-600`}>-</td>
                            <td className={`${TD} text-right ${pnlCls(m.tradeNet)}`}>{wonSigned(m.tradeNet)}</td>
                            <td className={`${TD} text-right text-gray-600`}>-</td>
                            <td className={`${TD} text-right text-gray-200`} title={dupTraded ? '같은 종목이 이 달에 두 번 이상 거래되어 단순 합이 중복 계상됩니다 — 아래 월말 보유 현황을 참고하세요.' : undefined}>
                              {dupTraded ? <span className="text-gray-600 font-normal">-</span> : won(rows.reduce((s, r) => s + r.trade.evalAfter, 0))}
                            </td>
                            <td colSpan={3} className={`${TD} text-right text-gray-600`}>-</td>
                            <td className={`${TD} text-right text-emerald-300`}>{won(m.divAccrued)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    )}
                    {/* 매월 목표 증액 — 리밸런싱 직전에 예수금을 목표로 옮긴 내역.
                        위 표의 매수 수량이 왜 늘었는지를 설명하는 값이라 표 바로 아래에 둔다. */}
                    {m.contribution && m.contribution.amount > 0 && (
                      <div className="mt-1 border border-sky-900/60 rounded-lg bg-sky-950/30 px-2.5 py-2">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]">
                          <span className="text-sky-300 font-bold">
                            목표 증액 {won(m.contribution.amount)}
                            {m.contribution.overridden && <span className="ml-1 text-amber-400 font-normal">(이 달 전용 규칙)</span>}
                          </span>
                          <span className="text-gray-500">
                            {m.contribution.date} · 예수금 {won(m.contribution.cashBefore)}의{' '}
                            {m.contribution.mode === 'pctOfCash' ? `${m.contribution.value}%` : '고정 금액'}
                          </span>
                          {m.contribution.note && <span className="text-amber-400/90">{m.contribution.note}</span>}
                          {Math.round(m.contribution.requested) !== m.contribution.amount && (
                            <span className="text-gray-600">요청 {won(m.contribution.requested)}</span>
                          )}
                        </div>
                        {m.contribution.perAsset.some((x) => x.added > 0) && (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                            {m.contribution.perAsset.filter((x) => x.added > 0).map((x) => (
                              <span key={x.assetId} className="text-[12px] whitespace-nowrap">
                                <span className="text-gray-400">{x.name}</span>
                                <span className="text-sky-300"> +{won(x.added)}</span>
                                <span className="text-gray-600"> → 목표 {won(x.targetAfter)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* 연간 가드레일 증액 — 매월 증액과 **완전히 별개**라 블록도 따로 둔다(색도 teal로 분리).
                        같은 달에 둘 다 있으면 위(sky)가 매월, 아래(teal)가 연간이다. */}
                    {m.annualReview && m.annualReview.amount > 0 && (
                      <div className="mt-1 border border-teal-900/60 rounded-lg bg-teal-950/30 px-2.5 py-2">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]">
                          <span className="text-teal-300 font-bold">
                            연간 증액 {won(m.annualReview.amount)}
                            <span className="ml-1 text-gray-500 font-normal">({annualOf(active).everyMonths}개월 주기)</span>
                          </span>
                          <span className="text-gray-500">
                            {m.annualReview.date} · 예수금 {won(m.annualReview.cashBefore)}
                            {m.annualReview.reserve > 0 && ` − 예약금 ${won(m.annualReview.reserve)}`}
                            {' '}의 {formatNumber(m.annualReview.value)}%
                          </span>
                          {m.annualReview.note && <span className="text-amber-400/90">{m.annualReview.note}</span>}
                        </div>
                        {m.annualReview.perAsset.some((x) => x.added > 0) && (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                            {m.annualReview.perAsset.filter((x) => x.added > 0).map((x) => (
                              <span key={x.assetId} className="text-[12px] whitespace-nowrap">
                                <span className="text-gray-400">{x.name}</span>
                                <span className="text-teal-300"> +{won(x.added)}</span>
                                <span className="text-gray-600"> → 목표 {won(x.targetAfter)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* 시그널 리밸런싱 — 그 달에 발동한 단계. ⚠️ signalEvents는 월별이 아니라 summary에
                        모여 있으므로 날짜의 앞 7자로 그 달 것만 고른다(월별로 복제 저장하지 않는다).
                        ⚠️ 옛 화면은 `개방 ₩0 → 사용 ₩0` 한 줄이라 **왜 0인지** 알 수 없었다(사용자 보고).
                           밑변(그 시점 적립 분배금)·비율·재원 내역·체결 결과를 전부 적는다. */}
                    {(() => {
                      const evs = (result.summary.signalEvents || []).filter((e) => e.date.slice(0, 7) === m.ym);
                      if (!evs.length) return null;
                      return (
                        <div className="mt-1 border border-amber-900/60 rounded-lg bg-amber-950/25 px-2.5 py-2">
                          <div className="text-[12px] text-amber-300 font-bold mb-1">
                            시그널 리밸런싱 {evs.length}건
                            <span className="ml-1 text-gray-500 font-normal">
                              (매수 = 고점 대비 낙폭 · 매도 = 저점 대비 반등 · 발동일 종가로 즉시 체결)
                            </span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {evs.map((e, i) => {
                              const sell = e.kind === 'sell';
                              const done = numOf(e.tradeQty) !== 0;
                              return (
                                <div key={`${e.assetId}-${e.date}-${e.kind}-${i}`} className="text-[12px] leading-relaxed">
                                  <div>
                                    <span className="text-gray-500">{e.date} </span>
                                    <span className={`px-1 rounded ${sell ? 'text-sky-300' : 'text-amber-300'} font-bold`}>
                                      {sigLabel(e)}
                                    </span>
                                    {' '}
                                    <StockLink code={e.code} name={e.name} className="text-gray-300 font-bold" />
                                    <span className="text-gray-600"> · {sigRefText(e)}</span>
                                  </div>
                                  {/* 규모 계산식을 밑변까지 펼쳐 보여 준다(왜 이 금액인가).
                                      ⚠️ 같은 종목의 2단계 이상이 같은 날 겹치면 규모·체결이 첫 행(carrier)에
                                         합산되므로(엔진 규약) 나머지 행에는 이 줄을 렌더하지 않는다 —
                                         `₩1,000,000 × 33% = ₩0` 같은 성립하지 않는 계산식이 찍힌다.
                                      ⚠️ carrier 판정은 `planned > 0`이 아니라 **엔진이 실어 보낸 플래그**로 한다:
                                         비율 0%·목표 이하·재원 0원이라 planned가 0인 대표 행이야말로
                                         "왜 0원인가"를 설명해야 하는 행이다(이 화면이 존재하는 이유). */}
                                  {e.carrier && (
                                    <div className="text-gray-500 pl-3">
                                      규모 · {sigSizeText(e, active)}
                                    </div>
                                  )}
                                  {!sell && numOf(e.reallocAmount) > 0 && (
                                    <div className="text-gray-500 pl-3">
                                      재조정 · 목표 초과 종목을 팔아 {won(e.reallocAmount)}을(를) 예수금에 편입
                                    </div>
                                  )}
                                  <div className="pl-3">
                                    <span className="text-gray-600">체결 · </span>
                                    <b className={done ? (sell ? 'text-sky-200' : 'text-amber-200') : 'text-gray-600'}>
                                      {sigOutcomeText(e, active)}
                                    </b>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    {/* 월말 보유 — ⚠️ 위 표는 '그 달 거래된 종목'만 행이 생기므로, 이 블록이 없으면
                        이번 달에 손대지 않은 종목의 수량·평가금액을 확인할 길이 없다. 모든 보유 종목을
                        같은 시점(월말 영업일)의 종가로 평가한 값이라 합계가 월말 총자산과 정합한다. */}
                    {m.holdings.length > 0 && (
                      <div className="mt-1 border border-gray-800/70 rounded-lg bg-gray-900/30 px-2.5 py-2">
                        <div className="text-[12px] text-gray-500 font-bold mb-1">
                          월말 보유 현황 <span className="font-normal text-gray-600">({m.lastDate} 종가 기준)</span>
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                          {m.holdings.map((h) => (
                            <span key={h.assetId} className="text-[12px] whitespace-nowrap">
                              <StockLink code={h.code} name={h.name} className="text-gray-300 font-bold" />
                              <span className="text-gray-500"> {qtyText(h.qty)}주 · </span>
                              <b className="text-gray-200">{won(h.evalAmount)}</b>
                              <span className="text-gray-600"> ({h.weight.toFixed(1)}%)</span>
                              {!h.priceExact && <span className="text-amber-400" title="그 날짜 종가가 없어 직전 종가를 사용">≈</span>}
                            </span>
                          ))}
                          <span className="text-[12px] whitespace-nowrap">
                            <span className="text-gray-500">종목 합계 </span>
                            <b className="text-gray-100">{won(m.evalEnd)}</b>
                          </span>
                        </div>
                      </div>
                    )}
                    {/* 월 요약 줄 */}
                    <div className="mt-1.5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-1 text-[12px] px-1">
                      <span className="text-gray-500">누적 매매차익 <b className={pnlCls(m.cumTradeNet)}>{wonSigned(m.cumTradeNet)}</b></span>
                      <span className="text-gray-500">월 분배금 <b className="text-emerald-300">{won(m.divAccrued)}</b></span>
                      <span className="text-gray-500">누적 분배금 <b className="text-emerald-300">{won(m.cumDivAccrued)}</b></span>
                      <span className="text-gray-500">월 현금 증감 <b className={pnlCls(m.cashDelta)}>{wonSigned(m.cashDelta)}</b></span>
                      {/* ⚠️ 예수금과 적립 분배금은 **따로** 표시한다(사용자 정의 2026-08) —
                          합계(m.cashEnd)를 '예수금'이라 부르면 분배금을 예수금에 합산한 것이 된다. */}
                      <span className="text-gray-500"
                        title={m.cashTradeEnd <= 0.5 && m.cashDivEnd > 0.5
                          ? `예수금이 0인 이유: 초기 잔여 + 누적 매매차익(${wonSigned(m.cumTradeNet)})이 매수 대금을 못 채워 부족분을 적립 분배금에서 꺼냈습니다.`
                          : '매매차익 + 초기 매수 잔여 + 추가 예수금 중 남은 몫'}>
                        월말 예수금 <b className="text-gray-300">{won(m.cashTradeEnd)}</b>
                      </span>
                      <span className="text-gray-500"
                        title="지급받은 분배금 중 아직 쓰지 않은 잔액 — 예수금과 별도로 쌓입니다">
                        적립 분배금 <b className="text-emerald-300">{won(m.cashDivEnd)}</b>
                      </span>
                      <span className="text-gray-500"
                        title={`월말 총자산 = 종목 합계 ${won(m.evalEnd)} + 예수금 ${won(m.cashTradeEnd)} + 적립 분배금 ${won(m.cashDivEnd)}`}>
                        월말 총자산 <b className="text-gray-200">{won(m.totalEnd)}</b>
                      </span>
                      {m.cumContribution > 0 && (
                        <span className="text-gray-500">누적 증액 <b className="text-sky-300">{won(m.cumContribution)}</b></span>
                      )}
                      {m.cumAnnualReview > 0 && (
                        <span className="text-gray-500">누적 연간증액 <b className="text-teal-300">{won(m.cumAnnualReview)}</b></span>
                      )}
                      {m.bandSkipCount > 0 && (
                        <span className="text-gray-500"
                          title="목표에 이미 충분히 가까워 그 회차 매매를 건너뛴 건수 — 괄호는 생략된 매매 예정 금액입니다">
                          밴드 생략 <b className="text-sky-300">{formatNumber(m.bandSkipCount)}건</b>
                          <span className="text-gray-600"> ({won(m.bandSkipAmount)})</span>
                        </span>
                      )}
                      {m.divTax > 0.5 && (
                        <span className="text-gray-500"
                          title="지급일에 원천징수한 세금 — 위 '월 분배금'(분배락 기준)은 세전이고, 예수금에는 세후만 들어옵니다">
                          원천징수 <b className="text-gray-400">−{won(m.divTax)}</b>
                        </span>
                      )}
                      {m.reinvestNet !== 0 && (
                        <span className="text-gray-500">
                          분배금 재투자 <b className="text-emerald-300">{won(-m.reinvestNet)}</b>
                          <span className="text-gray-600"> (누적 {won(-m.cumReinvestNet)})</span>
                        </span>
                      )}
                      {m.structuralNet !== 0 && (
                        <span className="text-amber-400/80 col-span-2">
                          ※ 종목 재편 순현금 {wonSigned(m.structuralNet)} — 매매차익에는 포함하지 않습니다
                        </span>
                      )}
                      {Math.abs(m.divPaid - m.divAccrued) > 0.5 && (
                        <span className="text-gray-600 col-span-2 xl:col-span-4">
                          ※ 이 달에 실제 입금된 분배금은 {won(m.divPaid)}
                          {m.divTax > 0.5 ? ' (원천징수 후 · 월말 분배는 지급일이 다음 달 초)' : ' (월말 분배는 지급일이 다음 달 초)'}
                        </span>
                      )}
                      {/* ⚠️ 매수 대금을 무엇으로 충당했는지 — 누적 매매차익이 마이너스인 달에는
                          이 줄이 없으면 "이 돈이 어디서 나왔나"를 화면에서 추적할 수 없다.
                          ⚠️ 분배금 재투자 매수는 **설계상 항상** 분배금 주머니에서 나가므로
                             (applyCash prefer='div'), cashUsedDiv만 보고 띄우면 재투자를 켠 모든 달에
                             "매매차익이 모자라"라는 거짓 설명이 붙어 진짜 부족 신호가 묻힌다.
                             → 재투자 몫을 뺀 **나머지 매수**가 분배금을 헐었을 때만 띄운다. */}
                      {(() => {
                        const reinvBuy = -m.reinvestNet;
                        const otherFromDiv = Math.max(0, m.cashUsedDiv - reinvBuy);
                        if (otherFromDiv <= 0.5) return null;
                        const otherFromTrade = m.cashUsedTrade;
                        return (
                          <span className="text-amber-400/90 col-span-2 xl:col-span-6">
                            ※ 이 달 {reinvBuy > 0.5 ? '재투자 외 ' : ''}매수 대금{' '}
                            <b>{won(otherFromTrade + otherFromDiv)}</b> ={' '}
                            예수금 <b>{won(otherFromTrade)}</b> + 적립 분배금 <b>{won(otherFromDiv)}</b>
                            {' '}— 예수금이 모자라 적립 분배금에서 충당했습니다.
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}

              {/* 최종 보유 */}
              <div className="mb-4 bt-month">
                <h3 className="text-sm font-bold text-gray-300 mb-1">🏁 기말 보유 현황 — {result.summary.endDate}</h3>
                <div className="overflow-x-auto border border-gray-800 rounded-lg">
                  <table className={`${TBL} min-w-[680px]`}>
                    <thead className="bg-gray-800/70 text-gray-400">
                      <tr>
                        <th className={`${TH} text-left`}>종목명</th>
                        <th className={`${TH} text-right`}>기말 종가</th>
                        <th className={`${TH} text-right`}>보유 수량</th>
                        <th className={`${TH} text-right`}>평가금액</th>
                        <th className={`${TH} text-right`}>비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.finalHoldings.map((h) => (
                        <tr key={h.assetId} className="border-t border-gray-800/70">
                          <td className={`${TD} text-gray-200`}><StockLink code={h.code} name={h.name} showCode /></td>
                          <td className={`${TD} text-right text-gray-300`}>{won(h.price)}{!h.priceExact && <span className="text-amber-400 ml-0.5">≈</span>}</td>
                          <td className={`${TD} text-right text-gray-200`}>{qtyText(h.qty)}주</td>
                          <td className={`${TD} text-right text-gray-200`}>{won(h.evalAmount)}</td>
                          <td className={`${TD} text-right text-gray-400`}>{h.weight.toFixed(1)}%</td>
                        </tr>
                      ))}
                      {/* ── 예수금(매매 몫) + 원천별 분해 ──
                          ⚠️ 사용자 정의(2026-08): '예수금'은 매매차익 + 초기 매수 잔여 + 추가 예수금만
                             가리키고 분배금은 합산하지 않는다. 아래 '적립 분배금' 행이 따로 선다.
                          ⚠️ 합이 정확히 기말 예수금이 되는 항등식이다(검증 #110):
                             초기 매수 후 잔여(+추가 예수금) + 누적 매매차익 + 종목 재편 순현금
                             + 분배금 재투자 매수(≤0) + 적립 분배금이 대신 낸 매수 대금.
                          ⚠️ 마지막 항이 ＋인 이유 — 분배금이 대신 낸 매수 대금만큼 예수금이 덜 나갔다. */}
                      <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                        <td className={`${TD} text-gray-300`}
                          title="매매차익 + 초기 매수 잔여 + 추가 예수금 (적립 분배금은 아래 행에 따로)">예수금</td>
                        <td colSpan={2} className={`${TD} text-right text-gray-600`}>-</td>
                        <td className={`${TD} text-right text-gray-200`}>{won(result.summary.finalCashTrade)}</td>
                        <td className={`${TD} text-right text-gray-600`}>-</td>
                      </tr>
                      {[
                        { key: 'init', label: '초기 매수 후 잔여 + 추가 예수금', value: result.initialCashAfter, signed: false },
                        { key: 'trade', label: '누적 매매차익', value: result.summary.cumTradeNet, signed: true },
                        { key: 'struct', label: '종목 재편 순현금', value: result.summary.cumStructuralNet, signed: true },
                        { key: 'reinv', label: '분배금 재투자 매수', value: result.summary.cumReinvestNet, signed: true },
                        { key: 'drawn', label: '적립 분배금이 대신 낸 매수 대금', value: result.summary.cumDivDrawn, signed: false },
                      ].filter((p) => Math.round(p.value) !== 0).map((p) => (
                        <tr key={p.key} className="border-t border-gray-800/40">
                          <td className={`${TD} pl-7 text-gray-500 text-[12px]`}>
                            └ {p.label}
                            {p.key === 'drawn' && (
                              <span className="text-gray-600" title="예수금이 모자라 적립 분배금에서 꺼내 낸 매수 대금 — 그만큼 예수금이 덜 나갔으므로 ＋로 들어간다">
                                {' '}(예수금이 그만큼 덜 나감)
                              </span>
                            )}
                          </td>
                          <td colSpan={2} className={`${TD} text-right text-gray-700`}>-</td>
                          <td className={`${TD} text-right text-[12px] ${p.signed ? pnlCls(p.value) : 'text-gray-300'}`}>
                            {p.signed ? wonSigned(p.value) : won(p.value)}
                          </td>
                          <td className={`${TD} text-right text-gray-700`}>-</td>
                        </tr>
                      ))}
                      {/* ── 적립 분배금 = 누적 분배금(지급 기준) − 매수에 사용한 분배금 ──
                          ⚠️ 분배금은 반드시 **지급 기준**(cumDivPaid) — 분배락 기준(cumDivAccrued)에는
                             아직 현금이 안 된 몫이 섞여 있어 소계가 어긋난다(검증 #110b).
                          ⚠️ 원천징수를 켜면 이 항은 **세후**다 — 세금은 애초에 입금되지 않은 돈이라
                             별도 항으로 더하면 항등식이 깨진다(검증 #204와 같은 정의). */}
                      <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                        <td className={`${TD} text-gray-300`}
                          title="지급받은 분배금 중 아직 쓰지 않은 잔액 — 예수금과 별도로 쌓인다">적립 분배금</td>
                        <td colSpan={2} className={`${TD} text-right text-gray-600`}>-</td>
                        <td className={`${TD} text-right text-emerald-300`}>{won(result.summary.finalCashDiv)}</td>
                        <td className={`${TD} text-right text-gray-600`}>-</td>
                      </tr>
                      {[
                        {
                          key: 'divpaid',
                          label: `누적 분배금 (지급 기준${result.summary.cumDivTax > 0.5 ? ' · 세후' : ''})`,
                          value: result.summary.cumDivPaid, signed: false,
                        },
                        { key: 'divused', label: '− 매수에 사용한 분배금', value: -result.summary.cumDivDrawn, signed: true },
                      ].filter((p) => Math.round(p.value) !== 0).map((p) => (
                        <tr key={p.key} className="border-t border-gray-800/40">
                          <td className={`${TD} pl-7 text-gray-500 text-[12px]`}>
                            └ {p.label}
                            {p.key === 'divpaid' && result.summary.cumDivTax > 0.5 && (
                              <span className="text-gray-600" title="지급일에 원천징수한 세금 — 입금되지 않았으므로 위 금액에서 이미 빠져 있다">
                                {' '}· 원천징수 −{won(result.summary.cumDivTax)}
                              </span>
                            )}
                            {p.key === 'divpaid' && Math.abs(result.summary.cumDivAccrued - result.summary.cumDivPaid) > 0.5 && (
                              <span className="text-gray-600" title="분배락 기준 누적 분배금(세전) — 지급일이 종료일 이후인 몫은 아직 현금이 아니다">
                                {' '}(분배락 기준 {won(result.summary.cumDivAccrued)})
                              </span>
                            )}
                          </td>
                          <td colSpan={2} className={`${TD} text-right text-gray-700`}>-</td>
                          <td className={`${TD} text-right text-[12px] ${p.signed ? pnlCls(p.value) : 'text-gray-300'}`}>
                            {p.signed ? wonSigned(p.value) : won(p.value)}
                          </td>
                          <td className={`${TD} text-right text-gray-700`}>-</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 bg-gray-800/60 font-bold">
                        <td className={`${TD} text-gray-200`}
                          title={`총자산 = 기말 평가액 ${won(result.summary.finalEval)} + 예수금 ${won(result.summary.finalCashTrade)} + 적립 분배금 ${won(result.summary.finalCashDiv)} = ${won(result.summary.finalTotal)}`}>
                          총자산
                        </td>
                        <td colSpan={2} className={`${TD} text-right text-gray-600`}>-</td>
                        <td className={`${TD} text-right text-gray-100`}>{won(result.summary.finalTotal)}</td>
                        <td className={`${TD} text-right ${pnlCls(result.summary.profit)}`}
                          title={`수익률 = (총자산 − 투입 원금 ${won(result.summary.finalTotal - result.summary.profit)}) ÷ 투입 원금`}>
                          {pctText(result.summary.profitRate)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 각주 — ⚠️ 이 블록은 호버 Hint로 접지 않는다. PDF만 받아 본 사람이 계산 규약을
                  확인할 수 있는 유일한 자리라 인쇄본에 반드시 글자로 남아야 한다. */}
              <div className="border-t border-gray-800 pt-2 text-[12px] text-gray-600 leading-relaxed">
                <div className="flex items-start gap-1">
                  <HelpCircle size={12} className="mt-0.5 shrink-0" />
                  <div>
                    <p>
                      지급기준일 = 월중 15일 / 월말 말일(휴장이면 직전 영업일) · <b>분배락 = 기준일 {active.exDivOffset}영업일</b> ·
                      <b> 리밸런싱 = 분배락 {active.rebalOffset}영업일</b>(분배금을 받을 수 있는 마지막 매수일) ·
                      <b> 지급 = 기준일 +{active.payOffset}영업일</b>.
                    </p>
                    <p>
                      '지급 분배금' 열과 월 합계는 <b>분배락 기준 월</b>로 묶습니다. 현금 잔고는 실제
                      <b> 지급일</b>에만 늘어나므로, 월말 분배는 다음 달 초에 예수금으로 들어옵니다.
                    </p>
                    <p>
                      회색 '재편' 행은 종목 편입·교체를 위한 구조 변경 매매라 <b>누적 매매차익에 포함하지 않습니다</b>.
                      초록 '재투자' 행(분배금 재투자 매수)도 같은 이유로 매매차익에서 빼고 따로 셉니다.
                    </p>
                    {active.divReinvest !== 'hold' && (
                      <p>
                        분배금 처리 = <b>{DIV_REINVEST_LABEL[active.divReinvest]}</b> ·
                        배분 <b>{DIV_SPLIT_LABEL[active.divReinvestSplit]}</b>.
                        {active.divReinvest !== 'payDate' && ' 재투자 매수일은 리밸런싱과 같은 날짜 규칙(분배락 직전 영업일)이라 그 달 분배 권리까지 확보됩니다.'}
                        {' '}1주 값에 못 미치는 잔돈은 다음 재투자 회차로 이월됩니다.
                      </p>
                    )}
                    {active.policy === 'none' && (
                      <p>
                        <b>리밸런싱 안 함</b> 설정이라 초기 매수 이후 <b>정기</b> 리밸런싱은 일어나지 않습니다
                        (종목별로 따로 지정한 일정은 그대로 실행됩니다).
                        {sigOn(active) && ' ⑤-b 시그널 리밸런싱은 이 설정과 무관하게 발동일마다 실행됩니다.'}
                      </p>
                    )}
                    {/* 전략 보조 규칙 — ⚠️ 켠 것만 적는다. 인쇄본만 받아 본 사람이 "왜 이 달엔 매매가
                        없지?"·"왜 매수가 잘렸지?"를 확인할 수 있는 유일한 자리라 반드시 글자로 남긴다. */}
                    {numOf(active.band) > 0 && (
                      <p>
                        <b>리밸런싱 밴드 ±{formatNumber(active.band)}%</b> — 리밸런싱 전 평가액이 목표금액의 이 범위
                        안이면 그 회차 매매를 생략했습니다(생략 {formatNumber(result.summary.bandSkipCount)}건 ·
                        예정 금액 {won(result.summary.bandSkipAmount)}). 목표 0(전량 청산)은 예외이고,
                        <b>시그널 리밸런싱</b>은 자기 발동일에 체결되므로 밴드의 적용을 받지 않습니다.
                      </p>
                    )}
                    <p>
                      <b>매수 재원 = {active.buyFunding === 'tradeOnly' ? '매매 예수금만' : '예수금 전부'}</b> —{' '}
                      {active.buyFunding === 'tradeOnly'
                        ? '정기 리밸런싱과 매매 시그널이 예수금(매매차익 + 초기 매수 잔여 + 추가 예수금)만 씁니다. 적립 분배금은 1원도 쓰지 않고 계속 쌓입니다.'
                        : '정기 리밸런싱과 매매 시그널이 예수금을 먼저 쓰고, 모자라면 적립 분배금에서 꺼내 씁니다.'}
                      {' '}분배금 재투자(④)는 이 설정과 무관하게 그대로 돕니다.
                      {numOf(active.extraCash) > 0
                        && ` 추가 예수금 ${won(active.extraCash)}은 초기 매수에 쓰지 않고 예수금으로 남겨 두었습니다.`}
                    </p>
                    {dipOf(active).enabled && (
                      <p>
                        <b>시그널 리밸런싱</b> — 매수는 종목별 <b>가격 고점</b> 대비 낙폭{' '}
                        {dipOf(active).levels.map((l) => `−${formatNumber(l.drop)}%(${l.buyPct === null || l.buyPct === undefined ? '목표까지' : `재원의 ${formatNumber(l.buyPct)}%`})`).join(' · ') || '없음'}
                        {dipOf(active).sellLevels.length
                          ? `, 매도는 가격 저점 대비 반등 ${dipOf(active).sellLevels.map((l) => `+${formatNumber(l.rise)}%(${l.sellPct === null || l.sellPct === undefined ? '초과분 전량' : `초과분의 ${formatNumber(l.sellPct)}%`})`).join(' · ')}`
                          : ''}
                        에 처음 닿는 날 <b>그날 종가로 즉시</b> 체결합니다
                        (발동 {result.summary.signalEvents.length}건 · 체결{' '}
                        {result.summary.signalEvents.filter((e) => e.tradeQty !== 0).length}건).
                        비율이 있으면 <b>매수 = 매수 재원 × 비율</b>(목표에서 자름) · <b>매도 = 목표 초과분 × 비율</b>이고,
                        비우면 목표까지입니다. ‘목표까지’ 매수만 재원이 모자랄 때 다른 종목을 팔아
                        재조정{dipOf(active).reallocate ? '합니다' : '하지 않습니다(끔)'}.
                        각 단계는 고점(매수)·저점(매도)이 갱신되기 전까지 1회만 발동합니다.
                      </p>
                    )}
                    {numOf(active.cashFloorPct) > 0 && (
                      <p>
                        <b>현금 바닥선 {formatNumber(active.cashFloorPct)}%</b>(활성 종목 목표금액 합계 기준) —
                        정기 리밸런싱 매수 후 예수금이 이 아래로 내려가지 않게 매수액을 줄였습니다
                        (표의 <b>'바닥선'</b> 표시). 마이너스 예수금 허용보다 <b>바닥선이 우선</b>이며,
                        매도·분배금 재투자에는 적용하지 않습니다.
                      </p>
                    )}
                    {annualOf(active).mode === 'pctOfSurplus' && numOf(annualOf(active).value) > 0 && (
                      <p>
                        <b>연간 가드레일 증액</b> — {annualOf(active).everyMonths}개월마다 그 달 첫 리밸런싱일에
                        (예수금 − 예약금 {won(annualOf(active).reserve)}) × {formatNumber(annualOf(active).value)}%
                        만큼 목표금액을 올렸습니다(누적 {won(result.summary.cumAnnualReview)}).
                        예약금은 투자에 쓰지 않습니다. 목표 금액 모드 전용입니다.
                      </p>
                    )}
                    <p>
                      {numOf(active.divTaxPct) > 0
                        ? (
                          <>
                            분배금 <b>원천징수 {formatNumber(active.divTaxPct)}%</b>를 지급일에 떼고 입금했습니다
                            (누적 세금 {won(result.summary.cumDivTax)}). '지급 분배금' 열과 '누적 분배금'은
                            <b> 세전</b>이고, 예수금에 반영된 금액은 <b>세후</b>입니다.
                            매매차익 과세·거래수수료·슬리피지는 반영하지 않았습니다.
                          </>
                        )
                        : '세금·거래수수료·슬리피지는 반영하지 않았습니다.'}
                      {' '}종가는 앱에 저장된 일별 종가를 사용하며, 그 날짜 기록이 없으면 직전 종가로 이월합니다(≈ 표시).
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // ⚠️ document.body 직속 포털 — 위 인쇄 규칙(`body > *:not(.bt-shell)`)이 성립하려면
  //    두 모드 모두에서 .bt-shell 이 body의 직계 자식이어야 한다.
  return createPortal(content, document.body);
}
