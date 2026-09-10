// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, ReferenceLine,
} from 'recharts';
// ⚠️ `../ledger` import를 **한 덩어리로 합치지 말 것** — `memory/tools/undefcheck.mjs`의
//    import 정규식이 `{...}` 안을 300자까지만 보므로, 합치면 여기서 들여온 이름이 전부
//    '미해결 후보'로 잡혀 그 게이트가 이 파일에서 영구히 무의미해진다(합쳤을 때 1010자).
import {
  LEDGER_GROUP_ORDER, LEDGER_GROUP_LABEL, LEDGER_GROUP_COLOR, LEDGER_PAY_LABEL,
  LEDGER_BALANCE_COLOR, LEDGER_DIVERGING, LEDGER_EXPENSE_GROUPS,
  LEDGER_PAY_ORDER, LEDGER_DETAIL_OTHER, LEDGER_DETAIL_TOP_N,
} from '../ledger';
import { downloadLedgerXlsx } from '../ledgerExcel';
import {
  MAX_LEDGER_BOOKS, MAX_LEDGER_ITEMS, MAX_LEDGER_CATEGORIES, MAX_LEDGER_CATEGORY_LEN,
  makeLedgerItem, makeLedgerLoan, makeLedgerBook,
  makeYm, addMonthsYm, isValidYm, isSeededYm, roundWon, finiteOr,
} from '../ledger';
import {
  loanSchedule, loanNext12Total, planOf, actualOf, varianceOf, commitActual, isItemActive, expectsActual,
  monthTotals, ledgerKpi, ledgerFingerprint,
} from '../ledger';
import {
  expectedOf, expectedTotal, expectedIncomeTotal, expectedByPay, monthState, projectedByPay,
  moveItemInBucket, canMoveItemInBucket, ledgerCategories, ledgerRamp, ledgerPayColor,
  unresolvedFailures,
} from '../ledger';
// 반영값(§13) — 분석·전월/전년 대비·연간·확인 현황·'이 달 계획대로 확인'
import {
  reflectedMonth, reflectedMomDelta, reflectedYoyDelta, confirmedOf, applyPlanAsActual, ledgerPlannedFill,
} from '../ledger';
import {
  makeLedgerSnapshot, pushLedgerSnapshot, ledgerSnapshotSummary, normalizeLedgerBooks,
  ledgerBooksHaveContent, MAX_LEDGER_SNAPSHOTS, MAX_LEDGER_SNAPSHOT_LABEL_LEN,
} from '../ledger';

/**
 * 가계부 본체 — **별도 브라우저 창(`variant='page'`)과 인앱 폴백(`variant='overlay'`)이 공유**한다.
 * 새 창용으로 화면을 복제하지 말 것(두 화면이 갈라진다 — FlowBoard·BacktestPage와 같은 규약).
 *
 * ⚠️ 편집은 **로컬 사본 + 2.5초 idle 승격**이다. 제스처마다 `onUpdateBooks`를 부르면
 *    ① `portfolioStructureKey`가 전 계좌를 매 프레임 재직렬화하고
 *    ② 800ms 디바운스가 사람 손 간격(1~3초)보다 짧아 매번 만료되어
 *    **글자마다 STATE+VERSION+STOCK+MARKET 4파일 write(HTTP 8회)** 가 나간다.
 *
 * ⚠️ `variant='page'`는 **pagehide 승격이 필수**다 — 별도 창에는 App의 종료 커밋 체인이 없어
 *    창을 닫으면 최대 2.5초분 편집이 어떤 경로로도 회수되지 않는다.
 *    (FlowBoard에는 이 핸들러가 없다 — BacktestPage 쪽이 옳고, 이 파일은 그쪽을 따른다.)
 *
 * ⚠️ 확인창은 **인라인 2단계**다. 이 화면은 z-1090(오버레이)이고 별도 창에는 App조차
 *    마운트되지 않아 `ConfirmDialog`(z-1000)도 알림 토스트도 뜨지 않는다.
 *
 * ⚠️ 색 규약: 이 앱의 손익 색(이익=빨강 / 손실=파랑)을 **쓰지 않는다**. 가계부는 '지출 증가'가
 *    나쁜 것이라 빨강으로 칠하면 이 앱 사용자에게 정반대로 읽힌다. 상태색(초과 amber ▲ /
 *    절약 teal ▼)을 쓰고 **아이콘과 라벨을 항상 동반**한다(색만으로 뜻을 전달하지 않는다).
 */

const IDLE_MS = 2500;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * 매트릭스 표의 sticky 3열 폭 — **파생 상수**다.
 * ⚠️ `left-[212px]` 같은 하드코딩으로 되돌리지 말 것. 212는 `62 + 150`이라는 전제 위에
 *    있어서, 항목 셀에 무언가(▲▼ 버튼 등)를 넣어 폭이 늘면 계획열이 제자리에 남아
 *    **가로 스크롤 시 항목 셀 오른쪽을 덮는다** — 정확히 × 삭제 버튼이 있는 자리다.
 */
const COL_PAY = 62;
const COL_NAME = 188;
const LEFT_NAME = COL_PAY;
const LEFT_PLAN = COL_PAY + COL_NAME;

/**
 * 열 구분선 — 사용자 보고 2026-09 "항목·계획·1월 칸의 구분이 없어 헷갈린다".
 *
 * 가로선(`cellBase`의 `border-b`)만 있고 세로선이 없어, 12개월 + 고정 3열이 늘어선 표에서
 * 어느 숫자가 어느 열인지 눈으로 따라갈 수 없었다. 일반 칸은 `border-r`로 긋는다.
 *
 * ⚠️ **sticky 열은 `border-r`만으로 부족하다.** 이 표는 `border-collapse: collapse`라
 *    테두리를 셀이 아니라 **테이블이** 그리는데, `position: sticky` 셀이 가로 스크롤로 이동하면
 *    그 세로 테두리는 원래 자리에 남는다(Chrome·Firefox 공통). 정확히 고정 3열의 오른쪽 경계,
 *    즉 사용자가 가장 헷갈린다고 지목한 자리가 스크롤하는 순간 사라진다.
 *    → 고정 열만 `box-shadow: inset`으로 한 번 더 긋는다. 스크롤 전에는 같은 자리에 겹쳐
 *      1px로 보이므로 이중선이 생기지 않는다.
 * ⚠️ 고정/스크롤 **경계 열**(보통 계획, 계획을 숨기면 항목)은 한 단계 굵고 밝게 둔다 —
 *    "여기까지가 따라다니는 열"을 알려 주는 유일한 단서다.
 */
const EDGE_STICKY = { boxShadow: 'inset -1px 0 0 #1f2937' };  // gray-800 — 일반 구분선과 같은 톤
const EDGE_FREEZE = { boxShadow: 'inset -2px 0 0 #475569' };  // slate-600 — 고정열 경계

/**
 * 차트 툴팁 스타일 — **6곳이 공유**한다(손복제 금지).
 *
 * ⚠️ 사용자 보고("금액이 배경과 같이 어두워 잘 안 보인다")의 근본 원인은 두 가지다:
 *   ① recharts 2.15.3 `Pie.defaultProps.fill = '#808080'` → `DefaultTooltipContent`의
 *      `color: entry.color || '#000'`이 그 회색을 글자색으로 채택한다. `<Pie>`에 fill을
 *      주지 않으면(색이 `<Cell>`에 있으면) **툴팁 글자가 항상 #808080**이다 — 4.59:1.
 *      → `itemStyle.color`로 덮어써야 한다. `contentStyle`만 고쳐서는 해결되지 않는다.
 *   ② 툴팁 배경이 카드면(#0f1623)과 **완전히 같은 색**이라 상자 자체가 떠오르지 않는다.
 *      → 다크 테마에서 배경 명도로 벌릴 수 있는 폭은 좁으므로(최선 1.23:1) **테두리 대비**
 *        (#374151 1.76:1 → #64748b 3.81:1)가 실질적인 분리 수단이다.
 * ⚠️ 값을 바꾸면 `node scripts/validate_palette.mjs` §6을 다시 돌릴 것.
 */
/**
 * 수지 균형 카드의 3번째 막대 이름.
 * ⚠️ **상수로 공유할 것** — 툴팁 formatter가 `n === BALANCE_BAR_NAME`으로 이 계열을 골라
 *    부호에 따라 '잉여금'/'부족분'으로 라벨을 갈라 쓴다. 문자열을 한쪽만 고치면 분기가
 *    조용히 죽어 부족분(음수)이 '수지 차액 -₩1,000,000'으로만 표시된다.
 */
const BALANCE_BAR_NAME = '수지 차액';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#1a2333',
    border: '1px solid #64748b',
    borderRadius: 6,
    fontSize: 11,
    boxShadow: '0 4px 16px rgba(0,0,0,0.55)',
    color: '#e5e7eb',
  },
  itemStyle: { color: '#e5e7eb' },
  labelStyle: { color: '#cbd5e1', fontWeight: 600 },
};

/**
 * 트리 매트릭스의 버킷 키 — 항목은 `그룹|결제수단` 아래에 묶인다(§13.2.2). ▲▼ 순서 이동도
 * **이 버킷 안에서만** 교환한다 — 그룹만 보면 다른 수단 하위의 항목과 교환해 화면에서는 아무 일도
 * 일어나지 않는다(`verify:ledger #72`가 막은 실패 모드가 한 단계 아래에서 재현된다).
 */
const bucketKeyOf = (it) => `${it.group}|${it.pay}`;
const bucketKey = (g, p) => `${g}|${p}`;
/** 롤업(그룹·결제수단·총계) 셀 숫자 — 콤마, ₩ 없음. 총합계를 검산하는 화면이라 '177만' 축약은 쓰지 않는다. */
const fmtNum = (v, hide) => {
  if (hide) return '***';
  const n = roundWon(v);
  return n === null ? '-' : n.toLocaleString();
};
/** 분석 ① '계획 반영분' 막대 색 — expense hue의 알파 톤(새 hue 금지, `validate_palette.mjs` §7). */
const PLANNED_BAR_FILL = ledgerPlannedFill(LEDGER_BALANCE_COLOR.expense);

/* ── 표시 유틸 ─────────────────────────────────────────────────────────────── */

const fmtWon = (v, hide) => {
  if (hide) return '***';
  const n = roundWon(v);
  return n === null ? '-' : `₩${n.toLocaleString()}`;
};
const fmtWonShort = (v, hide) => {
  if (hide) return '***';
  const n = roundWon(v);
  if (n === null) return '-';
  const a = Math.abs(n);
  if (a >= 100000000) return `${(n / 100000000).toFixed(2)}억`;
  if (a >= 10000) return `${Math.round(n / 10000).toLocaleString()}만`;
  return n.toLocaleString();
};
/** ⚠️ null은 '-'다. 0.00%로 단언하면 '변동 없음'과 구분되지 않는다. */
const fmtPct = (v, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(digits)}%`;
const fmtSignedPct = (v, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '-' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;

/** 지출 증감의 색 — ⚠️ 손익 색이 아니다. 증가(초과)=amber, 감소(절약)=teal. */
const varianceTone = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return LEDGER_DIVERGING.flat;
  return v > 0 ? LEDGER_DIVERGING.over : LEDGER_DIVERGING.under;
};
const varianceMark = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return '';
  return v > 0 ? '▲' : '▼';
};

// ⚠️ `border-r`이 세로 구분선이다(위 EDGE_* 주석 참조) — 빼면 12개월 표에서 열을 눈으로 따라갈 수 없다.
const cellBase = 'px-2 py-1 text-[11px] border-b border-r border-gray-800/70';
const inputCls =
  'w-full bg-transparent text-right outline-none focus:bg-gray-800/60 rounded px-1 text-[11px]';

/* ── 작은 조각들 ───────────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, tone, title, children }) {
  return (
    <div className="bg-[#0f1623] border border-gray-800 rounded-lg px-3 py-2 min-w-0" title={title || undefined}>
      <div className="text-[10px] text-gray-500 truncate">{label}</div>
      <div className="text-[15px] font-bold truncate" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub ? <div className="text-[10px] text-gray-500 truncate mt-0.5">{sub}</div> : null}
      {children}
    </div>
  );
}

/**
 * 숫자 입력 — **로컬 draft + blur 커밋**.
 * ⚠️ onChange마다 커밋하면 controlled value가 되돌아가 소수점·중간 상태를 칠 수 없고,
 *    `commitActual`의 '빈칸=키 삭제' 계약도 표현할 수 없다.
 */
function NumCell({ value, onCommit, readOnly, align = 'right', placeholder = '', title, col, className = '' }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null
    ? draft
    : (value === null || value === undefined || !Number.isFinite(value) ? '' : String(Math.round(value)));
  return (
    <input
      type="text"
      inputMode="numeric"
      data-col={col}
      className={`${inputCls} ${className}`}
      style={{ textAlign: align }}
      value={shown}
      placeholder={placeholder}
      title={title}
      readOnly={readOnly}
      onFocus={(e) => setDraft(e.target.value)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onBlur={(e) => { const raw = e.target.value; setDraft(null); if (!readOnly) onCommit(raw); }}
    />
  );
}

function TextCell({ value, onCommit, readOnly, placeholder, col, className = '' }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      type="text"
      data-col={col}
      className={`w-full bg-transparent outline-none focus:bg-gray-800/60 rounded px-1 text-[11px] ${className}`}
      value={draft !== null ? draft : (value ?? '')}
      placeholder={placeholder}
      readOnly={readOnly}
      onFocus={(e) => setDraft(e.target.value)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onBlur={(e) => { const raw = e.target.value; setDraft(null); if (!readOnly) onCommit(raw); }}
    />
  );
}

/** 인라인 2단계 삭제 — 창 위에서는 ConfirmDialog가 뜨지 않는다. */
function DeleteBtn({ armed, onArm, onConfirm, onCancel, readOnly }) {
  if (readOnly) return null;
  if (armed) {
    return (
      <span className="inline-flex gap-1">
        <button className="text-[10px] px-1 rounded bg-rose-900/60 text-rose-200 hover:bg-rose-800" onClick={onConfirm}>삭제</button>
        <button className="text-[10px] px-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700" onClick={onCancel}>취소</button>
      </span>
    );
  }
  return (
    <button className="text-[11px] text-gray-600 hover:text-rose-300 px-1" title="항목 삭제" onClick={onArm}>×</button>
  );
}

/**
 * 그룹 안에서 행을 위/아래로 옮기는 버튼.
 * ⚠️ `data-col`을 달지 말 것 — `onGridKeyDown`이 `[data-col]`의 DOM 순서로 ↑/↓ 이동을
 *    계산하므로, 버튼이 끼면 같은 열 세로 이동에 버튼이 섞인다.
 * ⚠️ 인라인 SVG가 아니라 텍스트 글리프다 — lucide 신규 아이콘 도입 금지 규약(#G3g)과
 *    같은 이유이고, 12px 폭이라 sticky 항목열 폭을 거의 늘리지 않는다.
 */
function MoveBtns({ canUp, canDown, onUp, onDown, readOnly }) {
  if (readOnly) return null;
  const cls = (on) => `block leading-[7px] text-[8px] px-0.5 ${on ? 'text-gray-500 hover:text-amber-300' : 'text-gray-800 cursor-default'}`;
  return (
    <span className="flex flex-col shrink-0 -my-0.5">
      <button className={cls(canUp)} title={canUp ? '위로 이동' : '더 위로 갈 수 없습니다'}
        disabled={!canUp} onClick={onUp}>▲</button>
      <button className={cls(canDown)} title={canDown ? '아래로 이동' : '더 아래로 갈 수 없습니다'}
        disabled={!canDown} onClick={onDown}>▼</button>
    </span>
  );
}

/* ── 본체 ──────────────────────────────────────────────────────────────────── */

export default function LedgerPage({
  open = true,
  variant = 'overlay',
  onClose,
  books = [],
  onUpdateBooks,
  /** 이전 기록(스냅샷). ⚠️ `ledgerBooks` 밖에 사는 앱 레벨 값이라 장부가 덮여도 살아남는다. */
  snapshots = [],
  onUpdateSnapshots = null,
  flushRef = null,
  onOpenWindow,
  readOnly = false,
  notice = '',
  hideAmounts = false,
  /** KST 기준 오늘 'YYYY-MM-DD' — ⚠️ 창 안에서 new Date()로 만들지 말 것(앱과 갈린다). */
  today = '',
}) {
  /* ── 로컬 사본 + idle 승격 ──────────────────────────────────────────────── */
  const [local, setLocalState] = useState(books);
  const localRef = useRef(books);
  const dirtyRef = useRef(false);
  const idleRef = useRef(null);

  const promote = useCallback(() => {
    if (idleRef.current) { clearTimeout(idleRef.current); idleRef.current = null; }
    // ⚠️ 승격할 게 없으면 반드시 null — 항상 truthy면 alt-tab·탭 닫기마다 4파일 write가 강제된다.
    if (!dirtyRef.current) return null;
    dirtyRef.current = false;
    const next = localRef.current;
    try { onUpdateBooks?.(next); } catch { /* 임계 경로에서 던지지 않는다 */ }
    return next;
  }, [onUpdateBooks]);

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

  // 부모 회수 슬롯 — ⚠️ 언마운트 시 반드시 null(죽은 클로저가 낡은 값을 Drive에 쓰는 것 방지).
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = promote;
    return () => { flushRef.current = null; };
  }, [flushRef, promote]);

  // 언마운트 승격 — 그냥 사라지면 idle 타이머가 취소되고 flushRef도 null이라 회수 경로가 0이다.
  useEffect(() => () => { promote(); }, [promote]);

  // ⚠️ 별도 창에는 App의 종료 커밋 체인이 없다 → pagehide가 유일한 회수 경로.
  useEffect(() => {
    if (variant !== 'page') return;
    const onHide = () => { try { promote(); } catch { /* noop */ } };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [variant, promote]);

  /**
   * 늦게 도착한 상위 값 채택.
   * ⚠️ 편집 중(dirty)에는 채택하지 않는다 — 그러지 않으면 타이핑이 되돌아간다.
   * ⚠️ **반대로 이 effect가 없으면** 느린 회선에서 저장된 장부가 통째로 사라진다:
   *    `LoadingOverlay`는 로드 완료와 무관하게 20초 뒤 자동 해제되므로, Drive의 ledgerBooks가
   *    도착하기 전에 화면을 열면 빈 배열로 시드되고, 항목 하나만 고쳐도 2.5초 뒤 승격이
   *    **저장돼 있던 장부 전체를 빈 배열로 대체**한다(FlowBoard가 명시적으로 막아 둔 경로).
   */
  useEffect(() => {
    if (dirtyRef.current) return;
    // ⚠️ 빈 배열은 채택하지 않는다 — 앱 탭이 새로고침 중이거나 Drive 로드 전이면 빈 배열이
    //    먼저 도착하는데, 그걸 채택하면 화면이 비고 이어지는 편집이 저장된 장부를 덮는다.
    if (!Array.isArray(books) || books.length === 0) return;
    if (books === localRef.current) return;
    localRef.current = books;
    setLocalState(books);
  }, [books]);

  /* ── 뷰 상태(세션 로컬 — 저장 지점 0곳) ────────────────────────────────── */
  const [bookIdx, setBookIdx] = useState(0);
  const todayYm = isValidYm(String(today).slice(0, 7)) ? String(today).slice(0, 7) : '';
  // ⚠️ 초기값을 상수로 두면 **별도 창(주 진입점)이 항상 그 상수 달로 열린다** — LedgerWindow는
  //    `today`를 빈 문자열로 시작해 `ledger:live` 수신 후에야 채우는데, useState 초기화는 첫
  //    렌더에서 한 번만 평가되고 이 컴포넌트는 리마운트되지 않기 때문이다. 그 상태에서 '+ 추가'는
  //    엉뚱한 달을 `activeFrom`에 박고, 셀 입력은 그 달을 '정리했다'고 기록한다(하드코딩 2026도 제거).
  const [year, setYear] = useState(() => (todayYm ? Number(todayYm.slice(0, 4)) : 0));
  const [month, setMonth] = useState(() => (todayYm ? Number(todayYm.slice(5, 7)) : 0));
  // `today`가 처음 유효해질 때 **한 번만** 동기화한다(사용자가 이미 옮긴 달을 덮지 않게 ref 게이트).
  const ymSyncedRef = useRef(!!todayYm);
  useEffect(() => {
    if (ymSyncedRef.current || !todayYm) return;
    ymSyncedRef.current = true;
    setYear(Number(todayYm.slice(0, 4)));
    setMonth(Number(todayYm.slice(5, 7)));
  }, [todayYm]);
  /** 기본 탭 = **분석**(상수 — 거래 유무와 무관, §13.6-5). 옛 `tabSeededRef`(거래가 있으면 거래 탭)는 폐기. */
  const [tab, setTab] = useState('chart');
  /**
   * 트리 매트릭스 펼침 상태. `openGroups` = 그 그룹의 모든 수단이 열림 /
   * `openPays` = `그룹|수단` 버킷 단위. 항목 행 표시 조건은
   * `openGroups.has(g) || openPays.has(bucketKey(g, p))`.
   * ⚠️ 이제 **장부에 저장된다**(`book.view`) — 아래 `applyView` 참조.
   */
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [openPays, setOpenPays] = useState(() => new Set());
  /** '이 달 계획대로 확인' 인라인 2단계 — 월 헤더를 누른 달(빈 문자열 = 닫힘). */
  const [confirmYm, setConfirmYm] = useState('');
  const [hiddenMonths, setHiddenMonths] = useState([]);
  /**
   * '계획' 열 숨기기(사용자 요청 2026-09) — 월 열과 **같은 UX**: 헤더 위 4px 띠를 누르면 접히고
   * 표 위 칩으로 되돌린다.
   * ⚠️ 숨김은 **화면 전용**이다. 계획 값은 월 칸의 흐린 이탤릭(반영값)·소계·연 합계에 그대로
   *    쓰이고 엑셀 시트도 종전대로 '계획' 열을 낸다.
   */
  const [planHidden, setPlanHidden] = useState(false);
  const [armedDelete, setArmedDelete] = useState('');
  const [flash, setFlash] = useState('');
  const [showSnapshots, setShowSnapshots] = useState(false);
  const flashTimer = useRef(null);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  /**
   * 엑셀 내보내기.
   * ⚠️ **`readOnly`로 게이팅하지 않는다** — 내보내기는 읽기 동작이고, 오히려 앱 탭과 링크가
   *    끊긴 그 순간이 사용자가 데이터를 파일로 빼내고 싶은 순간이다(끊김이 13초 이어지는
   *    앱 탭 새로고침 중에 버튼이 사라지면 안 된다).
   * ⚠️ 데이터가 아직 안 왔으면(`gotData` 전) 장부가 비어 있다 — 빈 파일을 조용히 내려받게
   *    두지 말고 사유를 밝힌다.
   * ⚠️ try/catch 필수 — 이 화면은 z-1090이고 별도 창에는 App조차 마운트되지 않아
   *    토스트·ConfirmDialog가 뜨지 않는다. 실패는 **인라인 플래시가 유일한 피드백**이고,
   *    던지면 창 전체가 ErrorBoundary 오류 박스로 래치돼 복구 경로가 창 닫기뿐이 된다.
   */
  const handleExcel = () => {
    try {
      if (!book || !Array.isArray(book.items) || book.items.length === 0) {
        doFlash('내보낼 내용이 없습니다'); return;
      }
      if (!ymReady) { doFlash('불러오는 중입니다'); return; }
      const ok2 = downloadLedgerXlsx({ book, year, month, todayKST: today || '' });
      doFlash(ok2 ? '엑셀 저장됨' : '엑셀을 만들지 못했습니다');
    } catch {
      doFlash('엑셀을 만들지 못했습니다');
    }
  };

  const doFlash = (msg) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 1800);
  };

  const book = local[bookIdx] || null;
  const ym = makeYm(year, month);
  /**
   * 엑셀 내보내기 게이트. ⚠️ **선언을 지우지 말 것** — `handleExcel`이 이 이름을 참조한다
   * (지웠더니 기능이 도입 이래 한 번도 동작하지 않았다 — 커밋 25fa69d).
   *
   * `today`는 브릿지로 늦게 도착하고(별도 창은 `''`로 시작) 그동안 `year`/`month`가 0이다.
   * 그 상태로 내보내면 **던지지 않고** 제목 `가계부 — 0년 월 매트릭스` / 파일명
   * `..._0_가계부.xlsx`인, 크기·시트 수까지 정상으로 보이는 빈 파일이 조용히 나간다(실측).
   *
   * ⚠️ `isValidYm`이 아니라 **`isSeededYm`** — `YM_RE`의 연도부가 `\d{4}`라
   *    `'0000-01'`을 통과시킨다. 지금 막히는 건 연도가 아니라 **월(`00`) 덕분**이라,
   *    `month` 초기값을 1로 '정리'하는 순간 게이트가 겉모습 그대로 무력화된다.
   * ⚠️ 게이트를 통째로 없애지 말 것 — 현재 배선에서는 도달하기 어렵지만
   *    ('books·today가 `ledger:live` 한 메시지로 함께 온다' + books 전에는 버튼이 disabled)
   *    그 불변식은 어디에도 강제돼 있지 않고, 깨졌을 때 결과가 예외가 아니라 위의 빈 파일이다.
   */
  const ymReady = isSeededYm(ym);

  /* ── 쓰기 헬퍼 — 전부 id 기준(인덱스 기준 금지) ────────────────────────── */
  const patchBook = useCallback((bookId, fn) => {
    setLocal((prev) => {
      const i = prev.findIndex((b) => b && b.id === bookId);
      if (i < 0) return prev;
      const next = fn(prev[i]);
      if (!next || next === prev[i]) return prev;
      const out = prev.slice();
      out[i] = next;
      return out;
    });
  }, [setLocal]);

  const patchItem = useCallback((bookId, itemId, fn) => {
    patchBook(bookId, (b) => {
      const i = (b.items || []).findIndex((it) => it && it.id === itemId);
      if (i < 0) return b;
      const nextItem = fn(b.items[i]);
      if (!nextItem || nextItem === b.items[i]) return b;
      const items = b.items.slice();
      items[i] = nextItem;
      return { ...b, items };
    });
  }, [patchBook]);

  /** 그 달을 '정리했다'고 기록 — 메모 달력 BUDGET 칩의 앵커. */
  const touchMonth = useCallback((bookId, targetYm) => {
    if (!today) return;
    patchBook(bookId, (b) => {
      const prev = b.months?.[targetYm];
      if (prev && prev.touchedDate === today) return b;
      return { ...b, months: { ...(b.months || {}), [targetYm]: { touchedDate: today, memo: prev?.memo || '' } } };
    });
  }, [patchBook, today]);

  /* ── 파생값 ────────────────────────────────────────────────────────────── */
  const kpi = useMemo(() => ledgerKpi(book, ym), [book, ym]);
  const totals = useMemo(() => monthTotals(book, ym), [book, ym]);
  /**
   * 반영값(§13) — 분석 요약 줄·배너·전월/전년 대비가 공유한다.
   * ⚠️ `reflected*` 비교 memo의 deps에 **`todayYm` 필수** — 별도 창은 `today`가 첫 `ledger:live`로
   *    늦게 오고, 그때 미래 게이트가 꺼진 결과가 deps 누락으로 세션 내내 고착된다(§13.6-10).
   */
  const reflected = useMemo(() => reflectedMonth(book, ym), [book, ym]);
  const confirmed = useMemo(() => confirmedOf(book, ym, totals), [book, ym, totals]);
  const mom = useMemo(() => reflectedMomDelta(book, ym, todayYm), [book, ym, todayYm]);
  const yoy = useMemo(() => reflectedYoyDelta(book, ym, todayYm), [book, ym, todayYm]);
  /** `ym > todayYm` = 예상(미래 달). `todayYm`이 비어 있으면(창 첫 렌더) 게이트를 끈다 — 곧 채워진다. */
  const isFutureYm = (k) => !!todayYm && k > todayYm;

  /**
   * 그 해 12개월의 계획/실제 — 차트 4종이 공유한다.
   * ⚠️ 결제수단 시리즈를 **별도 memo로 12회 더 돌리지 말 것** — `monthTotals`는 항목 전체를
   *    순회하고 `planOf`가 `loanSchedule`을 부른다. 여기 필드를 얹는 것이 훨씬 싸다.
   */
  const yearSeries = useMemo(() => MONTHS.map((m) => {
    const k = makeYm(year, m);
    const t = monthTotals(book, k);
    // 전월 대비 = 반영값 기준(§13). ⚠️ `todayYm`을 넘겨야 미래 달이 `-`가 된다(이 memo의 deps에도 있다).
    const c = reflectedMomDelta(book, k, todayYm);
    // 확인 현황 — 같은 행의 `t`를 넘겨 monthTotals를 다시 부르지 않는다(월 헤더·확인 버튼이 이 값을 쓴다).
    const cf = confirmedOf(book, k, t);
    const future = isFutureYm(k);
    const e = expectedTotal(book?.items, k);
    const ie = expectedIncomeTotal(book?.items, k);
    const bp = expectedByPay(book?.items, k);
    /**
     * 수지 균형 카드 전용 3필드 — **`plan`/`actual`/`expected`와 섞지 말 것.**
     * ⚠️ 수입·지출을 **같은 규칙(항목 단위 실제 ?? 계획)** 으로 뽑아야 그 차이가 잉여금이 된다.
     *    과거엔 수입만 `t.actualIncome || t.planIncome`(그룹 단위 폴백)이고 지출은
     *    `t.actualExpense`(폴백 없음)라, 실적 미입력이면 지출 막대가 0이 되어 **범례에는
     *    '지출'이 있는데 막대는 하나도 안 보였다**(사용자 보고 2026-08). 그 비대칭이 원인이다.
     * ⚠️ null 게이트는 `&&`가 아니라 `||`다. 한쪽 축의 활성 항목이 0건이면 그 축을 0으로
     *    단언하게 되는데, `makeLedgerBook`이 `items: []`로 시작하므로 '수입 항목을 아직
     *    등록하지 않은 장부'가 기본 경로다 → `&&`면 지출 전액이 12개월 내내 amber
     *    '부족분'으로 그려진다(부호까지 틀린 확정 표기).
     * ⚠️ `balUnresolved`는 산출 불가(실제도 계획도 못 구한) 항목 수다. `expectedTotal`의
     *    `value`는 그 몫을 빼고 더하므로 총액이 아니라 **하한**이다 — 각주가 그 사실을 알린다.
     *    ⚠️ 이 값으로 막대 색을 회색으로 중립화하지 말 것: `loanSchedule`은 **만기 경과·잔액 0**
     *    (= 상환이 끝난 대출을 지우지 않고 둔, 코드 주석이 "흔한 상태"라 부르는 경우)에도
     *    null을 내므로, 그러면 가장 흔한 정상 상태에서 차트가 통째로 회색이 된다.
     */
    const noInc = ie.activeCount === 0;
    const noExp = e.activeCount === 0;
    const row = {
      m, ym: k, label: `${m}월`,
      plan: t.planExpense, actual: t.actualExpense,
      balIncome: noInc ? null : ie.value,
      balExpense: noExp ? null : e.value,
      balance: (noInc || noExp) ? null : (ie.value - e.value),
      // ⚠️ **산출 실패분만** — 계획을 세우지 않는 항목(변동비 등)까지 세면 각주가 12개월 내내
      //    "산출 불가 항목이 있어 막대에서 빠져 있다"고 경고한다(사용자 확정 2026-09).
      balUnresolved: unresolvedFailures(e) + unresolvedFailures(ie),
      missing: t.missingExpense,
      // ⚠️ comparable=false면 숫자를 내지 않는다(미래 달 · 산출 불가 집합이 다른 달 · 항목 없는 달).
      momDelta: c.comparable ? c.delta : null,
      momRate: c.comparable ? c.rate : null,
      momReason: c.reason,
      momPlanned: c.curUnconfirmed,
      momExcluded: c.unresolvedExcluded,
      hasActual: t.missingExpense < t.activeExpense,
      /**
       * 분석 ① 스택 2단 — `confirmed`(실제 입력분 + 미분류, 진하게) / `planned`(계획 반영분, 연하게).
       * ⚠️ 미래 달은 **둘 다 null**(막대 없음 — 결정 D7). recharts는 stacked Bar에서 null을 0으로
       *    그리므로 막대가 안 보이는 것이 의도이고, 툴팁은 `filterNull`이 그 항목을 뺀다.
       */
      confirmed: future ? null : e.fromActual,
      planned: future ? null : e.fromPlan,
      future,
      /** 확인 현황(월 헤더 `확인 N/M · 진행 K`) — `confirmedOf` 한 함수에서만 온다(`plannedCount` 아님). */
      confirmedCount: cf.confirmed, targetCount: cf.target, unconfirmed: cf.unconfirmed,
      missingIds: cf.missingIds,
      /**
       * ⚠️ **네 상태**다 — `missing < active` 2분법으로 되돌리지 말 것.
       *    연중에 가계부를 시작하면 시작 전 달은 활성 항목이 0건이라 2분법이 그 달을
       *    '미입력'이라 단언하는데, 그 칸은 매트릭스에서 `-`로 잠겨 있어 채울 방법이 없다.
       */
      state: monthState(e),
      expected: e.value,
    };
    // 결제수단 스택 — ⚠️ recharts는 stacked Bar에서 `null`을 **0으로 강제**한다
    //    (`getValueByDataKey(d, key, 0)`). 그래서 '데이터 없음'을 null로 표현할 수 없고,
    //    아래 `payChartData`가 그 달 **행 자체를 제외**하는 방식으로 처리한다.
    for (const p of LEDGER_PAY_ORDER) row[`pay_${p}`] = bp[p] ? bp[p].value : 0;
    return row;
  }), [book, year, todayYm]);

  /**
   * 결제수단 막대 데이터 — 항목이 하나도 없던 달은 **행을 뺀다**(0 막대로 그리면
   * '그 달 지출 0원'이라는 거짓 단언이 된다).
   */
  const payChartData = useMemo(() => yearSeries.filter((r) => r.state !== 'none'), [yearSeries]);
  /**
   * 수지 균형 각주용 — 산출 불가 항목이 있는 달 수.
   * ⚠️ `expectedTotal`의 `value`는 산출 불가 몫을 빼고 더하므로 총액이 아니라 **하한**이다.
   *    합계를 확정 숫자로 그려 놓고 그 사실을 숨기면 소계 행의 '?N' 규약과 갈린다.
   */
  const balUnresolvedMonths = useMemo(
    () => yearSeries.filter((r) => r.balUnresolved > 0).length, [yearSeries]);
  /** 그 해에 실제로 쓰인 결제수단만 — 안 쓰는 수단의 빈 범례를 만들지 않는다. */
  const payKeys = useMemo(
    () => LEDGER_PAY_ORDER.filter((p) => yearSeries.some((r) => Math.abs(r[`pay_${p}`]) > 0.5)),
    [yearSeries]);
  /** 선택한 달의 결제수단 구성(100% 스트립) — 사용자 요청 "지출 1000이면 현금200 카드800". */
  const payStrip = useMemo(() => {
    const row = yearSeries.find((r) => r.ym === ym);
    if (!row) return { parts: [], sum: 0 };
    const parts = LEDGER_PAY_ORDER
      .map((p) => ({ key: p, label: LEDGER_PAY_LABEL[p], value: Math.max(0, row[`pay_${p}`] || 0), color: ledgerPayColor(p) }))
      .filter((x) => x.value > 0);
    return { parts, sum: parts.reduce((a, b) => a + b.value, 0) };
  }, [yearSeries, ym]);

  /** 구분(카테고리) 선택 목록 — 레지스트리 ∪ 실제 쓰이는 값. */
  const categories = useMemo(() => ledgerCategories(book), [book]);

  /**
   * 도넛 조각을 만들 때 쓰는 **단일 후처리**.
   * ⚠️ 메인 도넛과 상세 도넛이 **문자 그대로 같은 규칙**을 써야 한다 — 한쪽만 음수를
   *    클램프하면 두 도넛의 합이 갈리고(정정·환급 입력으로 음수 plan이 실제로 도달 가능),
   *    "Σ상세 === Σ메인"을 `byGroup`과 비교하는 검증은 그 경우에도 통과하는 죽은 단언이 된다.
   */
  const donutRows = (rows) => {
    const out = rows
      .map((r) => ({ ...r, value: Math.max(0, Number.isFinite(r.value) ? r.value : 0) }))
      .filter((r) => r.value > 0);
    return { rows: out, sum: out.reduce((a, b) => a + b.value, 0) };
  };

  /**
   * 메인 도넛 — 구분(그룹) 축 + **고정비만 결제수단으로 분리**(사용자 요청).
   * ⚠️ 고정비 몫은 `totals.byPay`가 아니라 **고정비 항목만 순회**해 구한다. `byPay`는
   *    그룹 구분 없이 전 지출을 결제수단으로 나눈 값이라 대출·연단위가 섞여 들어온다
   *    (`addItem`이 연단위를 `pay:'cash'`로 만들므로 오염이 기본 경로다).
   * ⚠️ 조각 색은 `ledgerRamp(고정비색, ...)` — 부모 hue를 유지해 어느 그룹의 부분인지가
   *    색으로 읽힌다. 결제수단 막대도 **같은 `ledgerPayColor`를 쓴다**(현금이 두 색이 되면 안 된다).
   */
  const donut = useMemo(() => {
    const fixedItems = (book?.items || []).filter((it) => it && it.group === 'fixed');
    const fixedByPay = expectedByPay(fixedItems, ym);
    const rows = [];
    for (const g of LEDGER_EXPENSE_GROUPS) {
      if (g === 'fixed') {
        const pays = LEDGER_PAY_ORDER.filter((p) => fixedByPay[p]);
        for (const p of pays) {
          rows.push({
            key: `fixed:${p}`,
            name: `고정비·${LEDGER_PAY_LABEL[p]}`,
            value: fixedByPay[p].value,
            color: pays.length > 1 ? ledgerPayColor(p) : LEDGER_GROUP_COLOR.fixed,
          });
        }
        continue;
      }
      // ⚠️ **항목 단위 폴백(`expectedTotal`)이다. `totals.byGroup`의 그룹 단위
      //    `actual > 0 ? actual : plan`으로 되돌리지 말 것.** 그건 '그룹에 실적이 하나라도
      //    있으면 실적만'이라 **미입력 항목이 통째로 탈락**하는데, 고정비 조각과 옆의 상세
      //    도넛은 항목 단위라 같은 캡션을 단 두 카드가 다른 총액을 보여 준다(실측: 메인
      //    880,000 vs 상세 1,080,000 — 월 중 부분 입력은 기본 상태다).
      //    항목 단위로 통일하면 `Σ메인 === Σ상세 === expectedGrandTotal`이 성립한다.
      rows.push({
        key: g,
        name: LEDGER_GROUP_LABEL[g],
        value: expectedTotal((book?.items || []).filter((it) => it && it.group === g), ym).value,
        color: LEDGER_GROUP_COLOR[g],
      });
    }
    return donutRows(rows);
  }, [book, ym]);

  /**
   * 상세구분 도넛 — 대출·연단위는 **항목별**, 고정비·변동비는 **사용자 구분(category)별**.
   * ⚠️ 그룹당 조각은 **최대 5개**다. 램프가 6슬롯부터 인접 ΔE 4 아래로 떨어지기 때문
   *    (팔레트 §2 실측 — 그 스크립트는 n=6 실패를 단언한다). 늘리지 말 것.
   * ⚠️ **'기타 1건'으로 접지 말 것** — head 4 + 기타 1 = 5로 조각 수가 전부 표시(5)와
   *    똑같은데 이름만 잃는 순손실이다. 실제로 대출 5건 중 APT 2가 그렇게 사라져
   *    사용자가 "누락됐다"고 보고했다(2026-08). 그래서 **6건 이상일 때만** 접는다.
   * ⚠️ 남는 조각은 전부 **직접 라벨을 갖는다** — '작으면 라벨 생략'으로 바꾸지 말 것
   *    (색만으로 구분이 보장되지 않는 대역이라 라벨이 유일한 보조 부호다).
   */
  const detailDonut = useMemo(() => {
    const rows = [];
    for (const g of LEDGER_EXPENSE_GROUPS) {
      const items = (book?.items || []).filter((it) => it && it.group === g && isItemActive(it, ym));
      if (!items.length) continue;
      const byKey = new Map();
      for (const it of items) {
        const v = expectedOf(it, ym);
        if (v === null || !Number.isFinite(v)) continue;
        // 대출·연단위는 항목이 곧 의미 단위, 고정비·변동비는 사용자 구분이 의미 단위다.
        const key = (g === 'loan' || g === 'annual')
          ? (it.name || '(이름 없음)')
          : (it.category || '(구분 없음)');
        byKey.set(key, (byKey.get(key) || 0) + v);
      }
      const sorted = [...byKey.entries()]
        .map(([name, value]) => ({ name, value }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value);
      // ⚠️ 임계는 `TOP_N + 1`이다. `TOP_N`으로 되돌리면 '기타 1건'이 부활하고(이름만 잃는
      //    순손실), `TOP_N + 2`로 넓히면 6건에서 n=6이 되어 램프 인접 ΔE가 4 아래로 떨어진다.
      const fold = sorted.length > LEDGER_DETAIL_TOP_N + 1;
      const head = fold ? sorted.slice(0, LEDGER_DETAIL_TOP_N) : sorted;
      const tail = fold ? sorted.slice(LEDGER_DETAIL_TOP_N) : [];
      const n = head.length + (tail.length ? 1 : 0);
      head.forEach((r, i) => rows.push({
        key: `${g}:${r.name}`, group: g,
        name: `${LEDGER_GROUP_LABEL[g]}·${r.name}`,
        value: r.value,
        color: ledgerRamp(LEDGER_GROUP_COLOR[g], g, n, i),
      }));
      if (tail.length) {
        rows.push({
          key: `${g}:__other__`, group: g,
          name: `${LEDGER_GROUP_LABEL[g]}·기타 ${tail.length}건`,
          value: tail.reduce((a, b) => a + b.value, 0),
          color: LEDGER_DETAIL_OTHER,
        });
      }
    }
    return donutRows(rows);
  }, [book, ym]);

  /** 헤더 '예상 月 지출' 세분화 — ⚠️ Σ가 `kpi.projectedMonthly`와 **정확히** 같아야 한다. */
  const projPay = useMemo(() => {
    const m = projectedByPay(book, ym);
    return LEDGER_PAY_ORDER
      .filter((p) => Number.isFinite(m[p]) && Math.abs(m[p]) > 0.5)
      .map((p) => ({ key: p, label: LEDGER_PAY_LABEL[p], value: m[p] }));
  }, [book, ym]);

  /* ⚠️ 옛 `payRows`(= `totals.byPay`의 `actual > 0 ? actual : plan`)는 **삭제됐다. 되살리지 말 것.**
     결제수단 축 표시는 전부 `payStrip`/`payChartData`(항목 단위 실제 ?? 계획)로 통일한다 —
     두 규칙을 한 화면에 두면 같은 카드가 같은 수단에 다른 금액을 찍는다(실측 580,000 vs 300,000). */

  const yearsAvailable = useMemo(() => {
    const s = new Set([year]);
    for (const it of book?.items || []) {
      for (const k of Object.keys(it.actual || {})) if (isValidYm(k)) s.add(Number(k.slice(0, 4)));
      for (const k of Object.keys(it.planOverride || {})) if (isValidYm(k)) s.add(Number(k.slice(0, 4)));
    }
    for (const k of Object.keys(book?.months || {})) if (isValidYm(k)) s.add(Number(k.slice(0, 4)));
    return [...s].sort((a, b) => a - b);
  }, [book, year]);

  /**
   * 연간 비교 — 사용자가 명시적으로 요구한 '전년대비'. **반영값**(§13) 기준.
   * ⚠️ 올해(와 그 이후)는 `todayYm`까지만 더한다 — 계획·반영 둘 다 같은 구간이라야 비교가 되고,
   *    라벨(`2026 (9월까지)`)이 그 사실을 밝힌다.
   */
  const annualCompare = useMemo(() => yearsAvailable.map((y) => {
    let plan = 0, reflectedSum = 0, any = false, months = 0;
    for (const m of MONTHS) {
      const k = makeYm(y, m);
      if (todayYm && k > todayYm) break;
      const r = reflectedMonth(book, k);
      plan += r.planSum; reflectedSum += r.value; months++;
      if (r.activeCount > 0 || r.uncategorizedCount > 0) any = true;
    }
    return { year: y, label: months < MONTHS.length ? `${y} (${months}월까지)` : `${y}`, plan, reflected: reflectedSum, any, months };
  }), [book, yearsAvailable, todayYm]);

  /**
   * 보기 상태(숨긴 열·펼침)를 **장부에서 복원**한다 — 가계부를 닫았다 열어도 마지막 조작
   * 상태가 유지된다(사용자 요청 2026-09).
   *
   * ⚠️ 동기화는 **`book.id`가 바뀔 때 한 번만**이다. `book` 객체가 바뀔 때마다 돌리면
   *    `applyView`의 저장 → local 갱신 → 재동기화 루프가 돌고, 그 사이 사용자가 누른 값이
   *    되돌아간다. 장부 전환·늦게 도착한 books 채택(시드 id → 실제 id)은 id가 바뀌므로 잡힌다.
   */
  const viewSyncedRef = useRef('');
  useEffect(() => {
    if (!book || viewSyncedRef.current === book.id) return;
    viewSyncedRef.current = book.id;
    const v = book.view || {};
    setHiddenMonths(Array.isArray(v.hiddenMonths)
      ? v.hiddenMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12) : []);
    setPlanHidden(v.planHidden === true);
    setOpenGroups(new Set(Array.isArray(v.openGroups) ? v.openGroups : []));
    setOpenPays(new Set(Array.isArray(v.openPays) ? v.openPays : []));
  }, [book]);

  /**
   * 보기 상태 쓰기의 **단일 경로**. state와 장부를 함께 갱신한다.
   * ⚠️ `setState` 업데이터 **안에서** `patchBook`을 부르지 말 것 — StrictMode 이중 호출에서
   *    부수효과가 두 번 돈다(이 파일의 `addItem`·`handleCreateItem`과 같은 규약).
   * ⚠️ `readOnly`(impersonation·연결 끊김)면 화면만 바꾸고 저장하지 않는다 — 보기 상태를
   *    남의 장부에 쓰면 안 되고, 끊긴 창의 조작이 나중에 되살아나서도 안 된다.
   */
  const applyView = useCallback((next) => {
    const hm = Array.isArray(next.hiddenMonths)
      ? [...new Set(next.hiddenMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b)
      : hiddenMonths;
    const ph = typeof next.planHidden === 'boolean' ? next.planHidden : planHidden;
    const og = next.openGroups instanceof Set ? [...next.openGroups] : [...openGroups];
    const op = next.openPays instanceof Set ? [...next.openPays] : [...openPays];
    setHiddenMonths(hm);
    setPlanHidden(ph);
    if (next.openGroups instanceof Set) setOpenGroups(next.openGroups);
    if (next.openPays instanceof Set) setOpenPays(next.openPays);
    if (!book || readOnly) return;
    patchBook(book.id, (b) => {
      const cur = b.view || {};
      const sameArr = (a, x) => Array.isArray(a) && a.length === x.length && x.every((y, i) => a[i] === y);
      if ((cur.planHidden === true) === ph && sameArr(cur.hiddenMonths, hm)
        && sameArr(cur.openGroups, og) && sameArr(cur.openPays, op)) return b;
      return { ...b, view: { hiddenMonths: hm, planHidden: ph, openGroups: og, openPays: op } };
    });
  }, [book, readOnly, patchBook, hiddenMonths, planHidden, openGroups, openPays]);

  const visibleMonths = useMemo(() => MONTHS.filter((m) => !hiddenMonths.includes(m)), [hiddenMonths]);
  /** 고정열의 **마지막 열**이 굵은 경계선을 갖는다 — 계획을 숨기면 그 자리가 항목 열로 옮겨 간다. */
  const nameEdge = planHidden ? EDGE_FREEZE : EDGE_STICKY;

  const grouped = useMemo(() => {
    const out = {};
    for (const g of LEDGER_GROUP_ORDER) out[g] = [];
    for (const it of book?.items || []) {
      if (!it) continue;
      (out[it.group] || (out[it.group] = [])).push(it);
    }
    return out;
  }, [book]);

  /* ── 장부 없으면 하나 만든다 (읽기 전용이면 안내만) ──────────────────── */
  useEffect(() => {
    if (readOnly) return;
    /**
     * ⚠️ **판정은 렌더 스코프 `local`이 아니라 `localRef.current`로 한다(2026-08-30 실측 버그).**
     * 별도 창(기본 진입점)의 첫 `ledger:live`는 `books`(실장부)와 `dataState:'ready'`를
     * **한 핸들러에서** 세팅하므로 React 18이 한 커밋으로 배치한다 → 그 렌더에서 `books`는
     * 실장부인데 `local`은 아직 `[]`다. effect는 선언 순서로 돌아 위 채택 effect(:308)가
     * `localRef.current`에 실장부를 넣은 **직후** 이 effect가 stale한 `local.length === 0`을
     * 보고 **빈 장부 1권으로 덮어썼다**. 그 다음 커밋부터는 `books` identity가 그대로라
     * 채택 effect의 deps `[books]`가 안 바뀌어 **실장부가 영영 화면에 닿지 못한다**
     * → 사용자가 매번 '이전 기록'으로 복원해야 했다(인앱 폴백은 두 setState가 다른 커밋이라 무사).
     * ⚠️ 이 시드는 dirty를 세우지 않아 Drive를 오염시키지는 않는다 — **표시만** 깨졌었다.
     */
    const cur = Array.isArray(localRef.current) ? localRef.current : [];
    if (cur.length === 0) {
      // ⚠️ 상위가 실제 장부를 들고 있으면 **빈 시드로 덮지 말고 그것을 채택한다**(자가 치유).
      //    `dirtyRef`를 함께 보는 이유: 사용자가 장부를 전부 지운 편집 중이면 되살리면 안 된다.
      if (!dirtyRef.current && Array.isArray(books) && books.length > 0) {
        localRef.current = books;
        setLocalState(books);
        return;
      }
      // ⚠️ **`setLocal`을 쓰지 말 것** — dirty가 서면 위 채택 effect가 조기 반환하므로, 앱 탭이
      //    새로고침 중일 때 뒤늦게 도착한 **저장된 장부가 영영 채택되지 않고** 2.5초 뒤 승격이
      //    그 장부를 빈 장부 1권으로 덮어쓴다(FlowBoard가 명시적으로 막아 둔 경로).
      //    화면을 띄우기 위한 자리 표시일 뿐이므로 로컬 사본만 갱신하고 승격 대상으로 삼지 않는다.
      const seed = [makeLedgerBook({ name: '가계부', createdAt: Date.now() })];
      localRef.current = seed;
      setLocalState(seed);
    }
    else if (bookIdx >= cur.length) setBookIdx(0);
  }, [local.length, bookIdx, readOnly, books, setLocal]);

  /* ── 트리 펼침 ─────────────────────────────────────────────────────────── */
  /** `그룹|수단` 버킷을 연다 — 항목 추가·결제수단 이동이 부른다(만든/옮긴 행이 화면에서 사라지지 않게). */
  /**
   * ⚠️ 펼침 3종은 전부 **`applyView` 한 경로**로만 쓴다(직접 `setOpenGroups`/`setOpenPays` 금지) —
   *    한 곳만 우회하면 그 조작이 장부에 저장되지 않아 다음에 열 때 되돌아간다.
   *    `applyView`가 다음 Set을 **업데이터 밖에서** 만들어 넘기는 이유이기도 하다(StrictMode).
   */
  const openBucket = useCallback((g, p) => {
    if (openPays.has(bucketKey(g, p))) return;
    const n = new Set(openPays); n.add(bucketKey(g, p));
    applyView({ openPays: n });
  }, [openPays, applyView]);
  /** 그룹 ▸ = 그 그룹의 **모든** 수단을 열고/닫는다(아이콘은 '전부 열림'일 때만 ▾). */
  const toggleGroup = (g, pays) => {
    const all = openGroups.has(g);
    const ng = new Set(openGroups); if (all) ng.delete(g); else ng.add(g);
    const np = new Set(openPays);
    for (const p of pays) { if (all) np.delete(bucketKey(g, p)); else np.add(bucketKey(g, p)); }
    applyView({ openGroups: ng, openPays: np });
  };
  /** 수단 ▸ = 그 수단만. 전부 열리면 그룹도 '전부 열림'으로 맞춘다. */
  const togglePay = (g, p, pays) => {
    const k = bucketKey(g, p);
    const np = new Set(openPays);
    if (np.has(k)) np.delete(k); else np.add(k);
    const allOpen = pays.every((q) => np.has(bucketKey(g, q)));
    const ng = new Set(openGroups);
    if (allOpen) ng.add(g); else ng.delete(g);
    applyView({ openGroups: ng, openPays: np });
  };
  const bucketOpen = (g, p) => openGroups.has(g) || openPays.has(bucketKey(g, p));

  /* ── 항목 추가 ─────────────────────────────────────────────────────────── */
  /** @param pay 결제수단 행의 `+ 추가`는 **그 수단**을 박는다(§13.2.2). 그룹 행은 종전 기본값. */
  /**
   * 변동비 적용범위 — 표시 라벨.
   * ⚠️ 변동비만 쓴다(다른 그룹은 '제한 없음'이 정상이라 칩을 달면 노이즈다).
   */
  const scopeLabel = (it) => {
    const f = isValidYm(it.activeFrom) ? it.activeFrom : '';
    const t = isValidYm(it.activeTo) ? it.activeTo : '';
    if (!f && !t) return '전체';
    if (f && f === t) {
      const fy = Number(f.slice(0, 4));
      return fy === year ? `${Number(f.slice(5, 7))}월만` : `${fy}년 ${Number(f.slice(5, 7))}월만`;
    }
    const fl = f ? `${Number(f.slice(5, 7))}월` : '처음';
    const tl = t ? `${Number(t.slice(5, 7))}월` : '끝';
    return `${fl}~${tl}`;
  };
  /**
   * '그 달만 ↔ 전체' 토글.
   * ⚠️ 좁힐 때 **값이 있는 달을 반드시 포함**한다 — `isItemActive` 밖으로 밀려난 값은 화면에서
   *    `-`로 잠기고 소계·연 합계에서도 빠져 **돈이 조용히 사라진다**(이 저장소가 가장 싫어하는
   *    실패 모드). 그래서 범위는 `저장된 값·계획오버라이드가 있는 달 ∪ 보고 있는 달`의 최소~최대다.
   */
  const toggleScope = (it) => {
    if (!book || readOnly) return;
    const f = isValidYm(it.activeFrom) ? it.activeFrom : '';
    const t = isValidYm(it.activeTo) ? it.activeTo : '';
    if (f && f === t) { patchItem(book.id, it.id, (x) => ({ ...x, activeFrom: '', activeTo: '' })); return; }
    const keys = [
      ...Object.keys(it.actual || {}),
      ...Object.keys(it.planOverride || {}),
    ].filter((k) => isValidYm(k));
    const all = [...keys, ym].sort();
    patchItem(book.id, it.id, (x) => ({ ...x, activeFrom: all[0], activeTo: all[all.length - 1] }));
  };
  /**
   * 변동비 항목 행을 **지금 보이는 달 범위**에서 그릴 것인가.
   * ⚠️ 사용자 확정(2026-09): "3월을 숨기면 4월에는 3월 변동비 항목이 보이지 않아야 한다."
   *    보이는 달에 활성인 달도 값도 하나 없으면 그 행은 지금 화면과 무관하다.
   * ⚠️ 값이 있으면 **활성 여부와 무관하게 보여 준다** — 적용기간 밖에 남은 값을 숨기면
   *    사용자가 그 돈을 영영 찾을 수 없다(위 `toggleScope`와 같은 근거).
   * ⚠️ 변동비 **외 그룹은 항상 true** — 고정비·대출은 매달 반복되는 항목이라 값이 없어도 보여야
   *    입력할 수 있다.
   * ⚠️ **적용범위가 '전체'인 변동비는 활성을 근거로 쓰지 않는다**(사용자 보고 2026-09-10):
   *    `activeFrom`/`activeTo`가 둘 다 비어 있으면 `isItemActive`가 12개월 모두 참이라 위 규칙이
   *    **구조적으로 무력화**된다(9월에만 값이 있는 행이 9월을 숨겨도 그대로 남는다). 그 상태는
   *    사용자가 고른 것이 아니라 '변동비는 추가한 달에만' 배포 **이전에 만든 항목의 잔재**이고
   *    (기존 항목은 규약상 마이그레이션하지 않는다 — `addItem` 주석), 변동비에서 '전체'는
   *    '매달 반복' = 고정비 성격이라 의미도 거의 없다 → 그런 행은 **값이 있는 달로만** 판정한다.
   * ⚠️ 그 경로에서는 `planOverride`도 '값'이다 — '전체'는 모든 달이 활성이라 그 계획이 **살아
   *    있고**(`planOf`는 비활성 달의 오버라이드를 애초에 읽지 않는다) 소계·연 합계에 들어간다.
   *    값 기준으로 접으면서 그 달을 빠뜨리면 사용자가 넣은 계획이 화면에서만 사라진다.
   * ⚠️ 그 해에 값이 하나도 없는 행은 **항상 보여 준다** — 숨기면 입력도 삭제도 못 하는 유령 행이
   *    된다(칩으로 '전체'로 되돌린 빈 행이 그 경로다).
   * ⚠️ 적용범위가 있는 행(`scoped`)의 판정은 **한 글자도 바뀌지 않았다** — 새로 추가한 변동비는
   *    전부 이 경로라 하위호환이 논증이 아니라 구조로 보장된다.
   */
  const rowInView = (it) => {
    if (!it || it.group !== 'variable') return true;
    const scoped = isValidYm(it.activeFrom) || isValidYm(it.activeTo);
    if (scoped) {
      return visibleMonths.some((m) => {
        const k = makeYm(year, m);
        return isItemActive(it, k) || actualOf(it, k) !== null;
      });
    }
    const hasValueAt = (m) => {
      const k = makeYm(year, m);
      return actualOf(it, k) !== null || finiteOr(it.planOverride && it.planOverride[k]) !== null;
    };
    if (!MONTHS.some(hasValueAt)) return true;
    return visibleMonths.some(hasValueAt);
  };

  const addItem = (group, pay = null) => {
    if (!book || readOnly) return;
    if ((book.items || []).length >= MAX_LEDGER_ITEMS) { doFlash(`항목은 최대 ${MAX_LEDGER_ITEMS}개입니다`); return; }
    /**
     * ⚠️ `activeFrom`을 **'보고 있는 달'로 박지 말 것**(사용자 보고 2026-08).
     * 8월에 가계부를 만들면 모든 항목이 `2026-08`로 고정돼 1~7월 칸이 `-`가 되고
     * `planOf`가 null을 돌려준다 → **계획이 1월부터 반영되지 않는다.** 게다가 그 필드를
     * 고칠 UI가 없어 사용자가 되돌릴 방법이 아예 없었다.
     *
     * 기본은 **제한 없음**('계획은 정해지면 거의 일정하다'는 사용 모델). 실제로 연중에
     * 시작·종료한 항목만 아래 '적용' 줄이나 비활성 칸(`-`) 클릭으로 기간을 지정한다.
     * ⚠️ `isItemActive`/`expectsActual`의 의미는 **그대로다** — 바뀐 건 생성 기본값뿐이다.
     */
    const base = { group, createdAt: Date.now(), activeFrom: '' };
    /**
     * ⚠️ **변동비만 예외 — 추가한 그 달에만 적용한다**(사용자 확정 2026-09).
     * 변동비는 고정비처럼 매달 반복되는 지출이 아니라 그 달에만 생긴 지출('벌칙금'·'고지서')이라,
     * 제한 없음으로 두면 엑셀처럼 **행 하나가 1~12월 전부에 생겨** 다른 달까지 입력칸·미확인으로
     * 잡힌다. 그 달만 활성이면 나머지 달은 `-`로 잠기고 미확인에서도 빠진다.
     * ⚠️ 다른 그룹은 종전대로 **제한 없음**이다 — 고정비·대출·연단위·수입은 계획이 1월부터
     *    반영돼야 한다(바로 위 주석이 그 근거다). 여기를 넓히지 말 것.
     * ⚠️ 기존 항목은 **마이그레이션하지 않는다**(저장값을 조용히 덮지 않는다) — 항목명 옆
     *    적용범위 칩으로 사용자가 직접 좁히거나 넓힌다.
     */
    if (group === 'variable') { base.activeFrom = ym; base.activeTo = ym; }
    if (group === 'loan') base.loan = makeLedgerLoan({ principalAsOfYm: ym });
    if (group === 'loan') base.pay = 'transfer';
    if (group === 'annual') { base.pay = 'cash'; base.dueMonth = month; base.dueDay = 1; }
    if (group === 'income') base.pay = 'transfer';
    if (pay && LEDGER_PAY_ORDER.includes(pay)) base.pay = pay;
    // ⚠️ `makeLedgerItem`(generateId)은 업데이터 **밖**에서 — StrictMode 이중 호출에서 id가 갈린다.
    const item = makeLedgerItem(base);
    patchBook(book.id, (b) => ({ ...b, items: [...(b.items || []), item] }));
    // ⚠️ 만든 행이 보이지 않으면 사용자는 추가가 실패했다고 읽는다 — 도착 버킷을 편다.
    openBucket(group, item.pay);
    // ⚠️ 변동비는 이 달에만 활성이라, 이 달 열이 숨겨져 있으면 만든 행이 **곧바로 사라진다**
    //    (`rowInView`). 그 달을 함께 되살린다.
    if (group === 'variable' && hiddenMonths.includes(month)) {
      applyView({ hiddenMonths: hiddenMonths.filter((x) => x !== month) });
    }
  };

  /**
   * '이 달 계획대로 확인'(§13.2.4) — **유일한 쓰기 경로**. `applyPlanAsActual`이 대상 항목의
   * `actual[ym]`에 계획값을 반올림 없이 적는다. 바뀐 게 없으면 같은 참조라 dirty가 서지 않는다.
   * 성공 시 `touchMonth` 1회(실제로 정리한 동작이다).
   */
  const applyPlanConfirm = (k) => {
    if (!book || readOnly || !isValidYm(k)) return;
    const res = applyPlanAsActual(book, k, todayYm);
    setConfirmYm('');
    if (res.written === 0 || res.book === book) { doFlash('계획으로 확인할 항목이 없습니다'); return; }
    // 순수 함수라 업데이터 안에서 다시 계산해도 안전하다(같은 참조면 위 결과를 그대로 쓴다).
    patchBook(book.id, (b) => (b === book ? res.book : applyPlanAsActual(b, k, todayYm).book));
    touchMonth(book.id, k);
    doFlash(`${Number(k.slice(5, 7))}월 ${res.written}건을 계획 금액으로 확인했습니다`);
  };

  const removeItem = (itemId) => {
    if (!book || readOnly) return;
    patchBook(book.id, (b) => ({ ...b, items: (b.items || []).filter((it) => it.id !== itemId) }));
    setArmedDelete('');
  };

  /**
   * 같은 그룹·**같은 결제수단** 안에서 항목 순서 이동(버킷 = `bucketKeyOf`, §13.6-6).
   * ⚠️ 순서는 `items` 배열 자체를 재정렬해 표현한다 — `ledgerFingerprint`가 항목을 배열 순서
   *    그대로 투영하므로 **영속화 신규 지점이 0곳**이다(`order` 필드를 만들면 정규화·`same`
   *    비교·지문·`makeLedgerItem` 4곳 등록이 필요하고 하나만 빠져도 조용히 유실된다).
   * ⚠️ 이동할 수 없으면 `moveItemInBucket`이 원본 참조를 돌려주고 `patchBook`이 no-op으로
   *    끝난다 → dirty가 서지 않아 헛된 Drive 저장이 없다.
   */
  const moveItem = (itemId, dir) => {
    if (!book || readOnly) return;
    patchBook(book.id, (b) => {
      const items = moveItemInBucket(b.items, itemId, dir, bucketKeyOf);
      return items === b.items ? b : { ...b, items };
    });
  };

  /* ── 이전 기록(스냅샷) 저장 / 복원 ──────────────────────────────────── */

  /**
   * 지금 장부를 스냅샷으로 남긴다.
   * ⚠️ **먼저 `promote()`로 로컬 편집을 회수**한다 — 안 하면 방금 친 값이 2.5초 idle 승격 전이라
   *    `books` prop에 아직 없고, 사용자가 "저장"을 눌렀는데 **직전 상태가 저장**된다.
   * ⚠️ 스냅샷은 `onUpdateSnapshots`(앱 레벨)로 나간다 — 장부와 **다른 저장 슬롯**이라
   *    장부가 통째로 덮이는 사고에서도 살아남는다.
   */
  const saveSnapshot = useCallback((label, auto = false) => {
    if (readOnly || !onUpdateSnapshots) return false;
    const books = promote() ?? localRef.current;
    if (!ledgerBooksHaveContent(books)) { doFlash('저장할 내용이 없습니다'); return false; }
    const stripped = books;
    const next = pushLedgerSnapshot(snapshots, makeLedgerSnapshot({
      savedAt: Date.now(), label: String(label || '').slice(0, MAX_LEDGER_SNAPSHOT_LABEL_LEN),
      auto, books: stripped,
    }));
    if (next === snapshots) { doFlash('직전 저장과 내용이 같습니다'); return false; }
    onUpdateSnapshots(next);
    if (!auto) doFlash('이전 기록에 저장했습니다');
    return true;
  }, [readOnly, onUpdateSnapshots, promote, snapshots]);

  /**
   * 스냅샷으로 되돌린다.
   * ⚠️ **복원 직전에 현재 상태를 자동 스냅샷**으로 남긴다 — 복원은 파괴적이고 undo가 없다.
   *    이게 없으면 잘못 고른 복원 한 번으로 지금 작업분이 사라진다.
   */
  const restoreSnapshot = useCallback((snapId) => {
    if (readOnly) return;
    const snap = (snapshots || []).find((s) => s && s.id === snapId);
    if (!snap || !Array.isArray(snap.books)) { doFlash('복원할 기록을 찾지 못했습니다'); return; }
    const cur = promote() ?? localRef.current;
    let nextSnaps = snapshots;
    if (onUpdateSnapshots && ledgerBooksHaveContent(cur)) {
      nextSnaps = pushLedgerSnapshot(snapshots, makeLedgerSnapshot({
        savedAt: Date.now(), label: '복원 직전 자동 저장', auto: true,
        books: cur,
      }));
      if (nextSnaps !== snapshots) onUpdateSnapshots(nextSnaps);
    }
    // ⚠️ 정규화해서 넣는다 — 손상된 스냅샷이 렌더 중 던지면 화면이 통째로 오류 페이지가 된다.
    setLocal(() => normalizeLedgerBooks(snap.books));
    // ⚠️ 복원본의 보기 상태로 다시 맞춘다 — `book.id`가 그대로면 동기화 effect가 돌지 않는다.
    viewSyncedRef.current = '';
    setShowSnapshots(false);
    doFlash('이전 기록으로 되돌렸습니다');
  }, [readOnly, snapshots, onUpdateSnapshots, promote, setLocal]);

  const removeSnapshot = useCallback((snapId) => {
    if (readOnly || !onUpdateSnapshots) return;
    const next = (snapshots || []).filter((s) => s && s.id !== snapId);
    if (next.length === (snapshots || []).length) return;
    onUpdateSnapshots(next);
  }, [readOnly, snapshots, onUpdateSnapshots]);

  /* ── 거래(기록 레이어) 쓰기 헬퍼 ──────────────────────────────────────────
   * ⚠️ 전부 **id 기준**이고 `setLocal` 업데이터 안에서는 **순수 계산만** 한다
   *    (generateId·setState·ref 대입을 업데이터에 넣으면 StrictMode 이중 호출에서 부수효과가
   *    두 번 돈다 — FlowBoard·BacktestPage와 같은 규약).
   * ────────────────────────────────────────────────────────────────────── */
  /* ── 구분(카테고리) 관리 ─────────────────────────────────────────────── */
  const addCategory = (raw) => {
    if (!book || readOnly) return false;
    const v = String(raw ?? '').trim().slice(0, MAX_LEDGER_CATEGORY_LEN);
    if (!v) return false;
    const cur = Array.isArray(book.categories) ? book.categories : [];
    if (cur.includes(v)) { doFlash(`'${v}'은(는) 이미 있습니다`); return false; }
    if (cur.length >= MAX_LEDGER_CATEGORIES) { doFlash(`구분은 최대 ${MAX_LEDGER_CATEGORIES}개입니다`); return false; }
    patchBook(book.id, (b) => ({ ...b, categories: [...(b.categories || []), v] }));
    return true;
  };
  /**
   * ⚠️ 레지스트리에서 지워도 **항목의 `category`는 건드리지 않는다**.
   *    그 값은 `ledgerCategories`의 합집합에 계속 남아 select 옵션이 되므로, 사용자가
   *    실수로 지워도 행의 구분이 조용히 사라지지 않는다(undo가 없는 화면이다).
   */
  const removeCategory = (name) => {
    if (!book || readOnly) return;
    patchBook(book.id, (b) => {
      const cur = Array.isArray(b.categories) ? b.categories : [];
      if (!cur.includes(name)) return b;
      return { ...b, categories: cur.filter((c) => c !== name) };
    });
  };

  /* ── 키보드 이동 (↑/↓ 같은 열, ←/→ 같은 행) ──────────────────────────── */
  const onGridKeyDown = (e) => {
    const k = e.key;
    if (k !== 'ArrowUp' && k !== 'ArrowDown') return;
    const el = e.target;
    const col = el?.dataset?.col;
    if (!col) return;
    const all = [...e.currentTarget.querySelectorAll(`[data-col="${CSS.escape(col)}"]`)];
    const i = all.indexOf(el);
    if (i < 0) return;
    const next = all[i + (k === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); try { next.select?.(); } catch { /* noop */ } }
  };

  if (!open) return null;

  // ⚠️ 인앱 폴백에는 **z가 필수**다 — App 루트는 스태킹 컨텍스트를 만들지 않아, z 없이 두면
  //    상단바(`sticky top-0 z-30`)와 플로팅 창(계산기·관심종목·메모 달력 z-1050)이 위에 그려져
  //    화면 최상단(장부 선택·연/월 네비·닫기 버튼이 전부 있는 줄)이 가려지고 닫을 수조차 없다.
  //    BacktestPage와 같은 층(1090): ConfirmDialog(1000) 위, LoadingOverlay(1100) 아래.
  const shell = variant === 'page'
    ? 'fixed inset-0 bg-[#0b1120] text-gray-200 flex flex-col'
    : 'fixed inset-0 z-[1090] bg-[#0b1120] text-gray-200 flex flex-col';

  /* ── 렌더: 매트릭스 행 ─────────────────────────────────────────────────── */
  const renderItemRow = (it) => {
    const isLoan = it.group === 'loan';
    const isAnnual = it.group === 'annual';
    const rowTone = it.tone === 'warn' ? 'bg-amber-500/5'
      : it.tone === 'good' ? 'bg-emerald-500/5'
        : it.tone === 'info' ? 'bg-sky-500/5' : '';
    const planNow = planOf(it, ym);
    let yearActual = 0, yearPlan = 0, yearMissing = 0, yearExpected = 0, yearPlanMonths = 0;
    // 확인분 차이(D5) — 실제·계획이 둘 다 있는 달만. 소계 행의 `confirmedVar`와 **같은 셀 규칙**.
    let confirmedVar = 0, confirmedCells = 0;
    for (const m of MONTHS) {
      const k = makeYm(year, m);
      // ⚠️ 실제 금액의 단일 소스 — 거래가 있으면 거래 합이 이긴다(`actualOf`로 되돌리지 말 것:
      //    거래로 입력한 달이 연간 합계에서 통째로 빠진다).
      const a = actualOf(it, k);
      const p = planOf(it, k);
      // ⚠️ `isItemActive`가 아니라 `expectsActual` — annual의 비납부월은 미입력이 아니다.
      //    아니면 연단위 항목의 연간 차이 열이 11개월 미입력 때문에 영구히 '-'가 된다.
      if (a !== null) yearActual += a; else if (expectsActual(it, k)) yearMissing++;
      if (p !== null) yearPlan += p;
      if (a !== null && p !== null) { confirmedVar += a - p; confirmedCells++; }
      /**
       * ⚠️ **표시 전용 예상 합계**(실제 ?? 계획) — 소계 행이 쓰는 `expectedTotal`과 같은 규약을
       *    항목 행에도 적용한 것이다(그 둘이 갈리면 같은 열에서 소계 ≠ Σ항목이 된다).
       * ⚠️ 이 값을 `compareMonths`/`momDelta`/`yoyDelta`/`yearSeries.actual`/`annualCompare`/
       *    `ledgerEventsByDate`로 **되돌려 보내지 말 것** — 그 순간 전월·전년 대비가 영구히
       *    거짓말을 시작한다(ledger.ts G-2 절). 여기서는 `<td>` 안에서만 쓰인다.
       */
      const e = expectedOf(it, k);
      if (e !== null) { yearExpected += e; if (a === null) yearPlanMonths++; }
    }
    /**
     * 차이 열 = **확인분 차이**(§13.6-4, 결정 D5): 실제·계획이 둘 다 있는 셀의 Σ(실제 − 계획).
     * 확인 셀이 0개면 `-`(0으로 단언하지 않는다). ⚠️ `yearExpected - yearPlan`으로 되돌리지 말 것 —
     * 반영 규약에서 미확인 셀의 차이는 정의상 0이라 언제나 "차이 없음"이 된다. `yearMissing`은
     * 툴팁용으로만 남는다.
     */
    const yearVar = confirmedCells === 0 ? null : confirmedVar;

    return (
      <tr key={it.id} className={`${rowTone} hover:bg-gray-800/30`}>
        <td className={`${cellBase} sticky left-0 z-[2] bg-[#0b1120]`} style={{ minWidth: 62, ...EDGE_STICKY }}>
          {readOnly ? (
            <span className="text-[10px] text-gray-400">{LEDGER_PAY_LABEL[it.pay]}</span>
          ) : (
            <select
              className="bg-transparent text-[10px] text-gray-300 outline-none"
              value={it.pay}
              /* 결제수단을 바꾸면 행이 다른 수단 하위로 **점프**한다 — 도착 버킷을 함께 펴서
                 편집 중인 행이 화면에서 사라지지 않게 한다(§13.8-⑤). */
              onChange={(e) => {
                const nextPay = e.target.value;
                patchItem(book.id, it.id, (x) => ({ ...x, pay: nextPay }));
                openBucket(it.group, nextPay);
              }}
            >
              {Object.entries(LEDGER_PAY_LABEL).map(([k, v]) => <option key={k} value={k} className="bg-[#0f1623]">{v}</option>)}
            </select>
          )}
        </td>
        <td className={`${cellBase} sticky z-[2] bg-[#0b1120]`} style={{ left: LEFT_NAME, minWidth: COL_NAME, ...nameEdge }}>
          <div className="flex items-center gap-1">
            <MoveBtns
              readOnly={readOnly}
              canUp={canMoveItemInBucket(book.items, it.id, -1, bucketKeyOf)}
              canDown={canMoveItemInBucket(book.items, it.id, 1, bucketKeyOf)}
              onUp={() => moveItem(it.id, -1)}
              onDown={() => moveItem(it.id, 1)}
            />
            <TextCell
              col="name"
              value={it.name}
              placeholder="항목명"
              readOnly={readOnly}
              onCommit={(raw) => patchItem(book.id, it.id, (x) => (x.name === raw ? x : { ...x, name: raw }))}
            />
            <DeleteBtn
              readOnly={readOnly}
              armed={armedDelete === it.id}
              onArm={() => setArmedDelete(it.id)}
              onConfirm={() => removeItem(it.id)}
              onCancel={() => setArmedDelete('')}
            />
          </div>
          {/* 구분(카테고리) — ⚠️ sticky 열을 새로 만들지 않고 항목 셀의 둘째 줄에 둔다.
              열을 늘리면 sticky 오프셋·colCount·소계 행 colSpan이 전부 따라 바뀐다. */}
          {!isLoan && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[9px] text-gray-600 shrink-0">구분</span>
              {readOnly ? (
                <span className="text-[9px] text-gray-400 truncate">{it.category || '-'}</span>
              ) : (
                <select
                  className="bg-transparent text-[9px] text-gray-400 outline-none min-w-0 flex-1 focus:bg-gray-800/60 rounded"
                  value={it.category || ''}
                  title="지출 구분 — 아래 '구분 관리'에서 미리 등록해 둔 값 중에서 고릅니다"
                  onChange={(e) => patchItem(book.id, it.id, (x) => (x.category === e.target.value ? x : { ...x, category: e.target.value }))}
                >
                  <option value="" className="bg-[#0f1623]">(구분 없음)</option>
                  {/* ⚠️ 목록은 레지스트리 ∪ 실제 쓰이는 값이다 — 사용자가 목록에서 지운 구분을
                      가진 행도 자기 값을 옵션으로 갖고 있어야 select가 조용히 덮지 않는다. */}
                  {categories.map((c) => <option key={c} value={c} className="bg-[#0f1623]">{c}</option>)}
                </select>
              )}
            </div>
          )}
          {it.group === 'variable' && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[9px] text-gray-600 shrink-0">적용</span>
              {readOnly ? (
                <span className="text-[9px] text-gray-400">{scopeLabel(it)}</span>
              ) : (
                <button
                  type="button"
                  className="text-[9px] px-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 shrink-0"
                  title={isValidYm(it.activeFrom) && it.activeFrom === it.activeTo
                    ? '이 달에만 적용되는 지출입니다 — 누르면 모든 달로 넓힙니다'
                    : '누르면 이 달만 적용으로 좁힙니다(값이 있는 달은 함께 남습니다)'}
                  onClick={() => toggleScope(it)}
                >{scopeLabel(it)}</button>
              )}
            </div>
          )}
          {isAnnual && (
            <div className="flex items-center gap-1 text-[9px] text-gray-500 mt-0.5">
              <span>납부</span>
              <NumCell col="dueMonth" align="center" value={it.dueMonth} readOnly={readOnly}
                onCommit={(raw) => patchItem(book.id, it.id, (x) => ({ ...x, dueMonth: raw.trim() === '' ? null : Number(raw) }))} />
              <span>월</span>
              <NumCell col="dueDay" align="center" value={it.dueDay} readOnly={readOnly}
                onCommit={(raw) => patchItem(book.id, it.id, (x) => ({ ...x, dueDay: raw.trim() === '' ? null : Number(raw) }))} />
              <span>일</span>
            </div>
          )}
        </td>
        {!planHidden && (
        <td className={`${cellBase} sticky z-[2] bg-[#0b1120] text-right`} style={{ left: LEFT_PLAN, minWidth: 96, ...EDGE_FREEZE }}>
          {isLoan ? (
            <span className="text-gray-400" title={loanSchedule(it.loan, ym) ? '대출 탭에서 계산됩니다' : '계산할 수 없습니다 — 대출 탭을 확인하세요'}>
              {planNow === null ? '-' : fmtWon(planNow, hideAmounts)}
            </span>
          ) : (
            <div className="flex items-center gap-1 justify-end">
              <NumCell
                col="plan"
                value={it.plan}
                readOnly={readOnly}
                placeholder="계획"
                title={it.planUnit === 'year' ? '연 금액 — 월 계획은 /12로 환산됩니다' : '월 금액'}
                onCommit={(raw) => {
                  const t = raw.trim().replace(/,/g, '');
                  const v = t === '' ? null : Number(t);
                  patchItem(book.id, it.id, (x) => ({ ...x, plan: (v === null || Number.isFinite(v)) ? v : x.plan }));
                }}
              />
              {!isAnnual && !readOnly && (
                <button
                  className={`text-[9px] px-1 rounded shrink-0 ${it.planUnit === 'year' ? 'bg-sky-900/60 text-sky-300' : 'bg-gray-800 text-gray-500'}`}
                  title={it.planUnit === 'year' ? '연 단위 입력 — 월 계획 = 금액/12 (예: MS365 연 127,000 → 월 10,583)' : '월 단위 입력'}
                  onClick={() => patchItem(book.id, it.id, (x) => ({ ...x, planUnit: x.planUnit === 'year' ? 'month' : 'year' }))}
                >{it.planUnit === 'year' ? '年' : '月'}</button>
              )}
            </div>
          )}
          {it.planUnit === 'year' && !isAnnual && planNow !== null && (
            <div className="text-[9px] text-gray-600">월 {fmtWon(planNow, hideAmounts)}</div>
          )}
        </td>
        )}

        {visibleMonths.map((m) => {
          const k = makeYm(year, m);
          const active = isItemActive(it, k);
          const a = actualOf(it, k);
          const p = planOf(it, k);
          const v = (a === null || p === null) ? null : a - p;
          return (
            <td key={m} className={`${cellBase} text-right ${!active ? 'bg-gray-900/40' : ''}`} style={{ minWidth: 84 }}>
              {!active ? (
                /* ⚠️ 이 칸은 클릭으로 적용기간을 넓힐 수 있어야 한다 — `activeFrom`을 고치는
                   UI가 없어서 "8월에 만든 항목의 계획이 1월에 안 뜬다"를 되돌릴 방법이
                   아예 없었다(사용자 보고 2026-08). 사유가 시작월이면 시작을, 종료월이면
                   종료를 이 달로 옮긴다. */
                readOnly ? (
                  <span className="text-[10px] text-gray-700" title="이 달에는 없던 항목입니다">-</span>
                ) : (
                  <button
                    type="button"
                    className="w-full text-right text-[10px] text-gray-700 hover:text-amber-300"
                    title={`이 달에는 없던 항목입니다 — 클릭하면 적용기간을 ${k}까지 넓힙니다`}
                    onClick={() => patchItem(book.id, it.id, (x) => {
                      if (isValidYm(x.activeFrom) && k < x.activeFrom) return { ...x, activeFrom: k };
                      if (isValidYm(x.activeTo) && k > x.activeTo) return { ...x, activeTo: k };
                      return x;
                    })}
                  >-</button>
                )
              ) : (
                <>
                  <NumCell
                    col={`m${m}`}
                    value={a}
                    readOnly={readOnly}
                    placeholder={p === null ? '' : String(Math.round(p))}
                    /* ⚠️ 계획으로 채워진 칸은 **값처럼 보이되 구분돼야** 한다(사용자 확정 2026-08).
                       기본 placeholder 색이면 '아직 없는 값'으로 읽혀 "계획이 반영 안 됐다"가
                       된다. 실제 입력(밝은 글씨)과 계획(흐린 이탤릭)이 한눈에 갈린다. */
                    className={a === null && p !== null ? 'placeholder:text-gray-500 placeholder:italic' : ''}
                    title={p === null
                      ? '계획 없음 · 비우면 미입력'
                      : `계획 ${Math.round(p).toLocaleString()} — 이 달 합계에는 이 계획 금액이 쓰입니다.\n실제와 다르면 숫자를 직접 넣으세요(비우면 다시 계획으로 돌아갑니다).`}
                    onCommit={(raw) => {
                      // ⚠️ **값이 실제로 바뀐 경우에만** 정리 기록을 남긴다 — NumCell의 onBlur는 값이
                      //    그대로여도 항상 커밋을 부르므로, 무조건 touchMonth를 하면 칸을 Tab으로
                      //    지나가기만 해도 그 달을 '정리했다'고 기록하고, 메모 달력에 사용자가 만든
                      //    적 없는 BUDGET 칩이 뜨며 Drive 4파일 write가 나간다.
                      if (commitActual(it.actual, k, raw) === it.actual) return;
                      patchItem(book.id, it.id, (x) => {
                        const nextActual = commitActual(x.actual, k, raw);
                        return nextActual === x.actual ? x : { ...x, actual: nextActual };
                      });
                      touchMonth(book.id, k);
                    }}
                  />
                  {v !== null && v !== 0 && (
                    <div className="text-[9px] leading-tight" style={{ color: varianceTone(v) }}>
                      {varianceMark(v)} {hideAmounts ? '***' : Math.abs(Math.round(v)).toLocaleString()}
                    </div>
                  )}
                </>
              )}
            </td>
          );
        })}

        {/* ⚠️ 연간 합계는 **예상**(실제 ?? 계획)이다 — 소계 행과 같은 규약이라야 소계 = Σ항목이
            성립한다. 계획으로 채운 달이 섞이면 월 칸과 **같은 시각 언어**(흐린 이탤릭)로 알린다. */}
        <td className={`${cellBase} text-right ${yearPlanMonths > 0 ? 'text-gray-400 italic' : 'text-gray-300'}`}
          style={{ minWidth: 100 }}
          title={yearPlanMonths > 0
            ? `실제 입력 ${fmtWon(yearActual, hideAmounts)} + 계획 반영 ${yearPlanMonths}개월 = ${fmtWon(yearExpected, hideAmounts)}\n(반영값 — 소계·분석·전월/전년 대비·달력도 같은 값을 씁니다)`
            : '전부 실제 입력입니다'}
        >
          {fmtWon(yearExpected, hideAmounts)}
          <div className="text-[9px] text-gray-600">계획 {fmtWon(yearPlan, hideAmounts)}</div>
        </td>
        <td className={`${cellBase} text-right`} style={{ minWidth: 96 }}
          title={yearVar === null
            ? '실제와 계획이 둘 다 있는 달이 없어 차이를 낼 수 없습니다'
            : `확인 ${confirmedCells}개 셀 기준 · 계획 없는 셀 제외${yearMissing > 0 ? ` · 미확인 ${yearMissing}개월은 포함되지 않습니다` : ''}`}>
          {yearVar === null ? (
            <span className="text-gray-600">-</span>
          ) : (
            <span style={{ color: varianceTone(yearVar) }}>
              {varianceMark(yearVar)} {hideAmounts ? '***' : Math.abs(Math.round(yearVar)).toLocaleString()}
            </span>
          )}
        </td>
      </tr>
    );
  };

  /**
   * 롤업 행 하나 — 트리의 L0(그룹) · L1(결제수단) · 총계가 **전부 이 함수**를 지난다(값의 단일 소스 —
   * 그룹·수단 행을 따로 계산하지 말 것, §13.2.2).
   *
   * ⚠️ **월 셀은 `expectedTotal(...).value`(실제 ?? 계획) = 반영값**이다. 사용자가 계획만 입력해도
   *    소계가 나와야 한다는 요청이 이 행의 존재 이유다. '몇 건이 계획인지'는 이제 셀 배지가 아니라
   *    **월 헤더 `확인 N/M`**이 보여 준다(§13.6-3 — 롤업 셀에 `계획 N` 배지를 되살리지 말 것).
   * ⚠️ 이 값을 `monthTotals.actualExpense`로 **되돌려 보내지 말 것** — 실제 전용 집계는 확인 현황의
   *    단일 소스다(ledger.ts G-2 절 참조). 비교·차트·달력은 `reflectedMonth`가 자기 손으로 계산한다.
   * ⚠️ '계획' 열은 `planSum`(활성 항목 전체의 계획)이지 `fromPlan`(실적 없는 항목의 계획)이
   *    아니다. 후자를 쓰면 **사용자가 실적을 채울수록 계획 열이 0으로 수렴**해, 예상값을
   *    검산할 유일한 기준선이 조용히 사라진다(실측 547,000 → 17,000).
   * ⚠️ 차이 열 = **확인분 차이**(`confirmedVar`, D5). 롤업의 `unresolved > 0 → 산출불가 N` 게이트는
   *    그대로다(§13.11 R-3 — `loanSchedule` null 계약이 소계 경로에서 깨지지 않게).
   *
   * @param toggle `{ open, onToggle }` — ▸/▾ 펼침 버튼(트리 행). null이면 총계처럼 버튼 없음.
   * @param onAdd `+ 추가` 버튼(수단 행은 그 수단을 기본값으로 항목 생성).
   */
  const renderSubtotalRow = ({ key, label, color, items, indent = false, income = false, toggle = null, onAdd = null, count = null, note = '' }) => {
    /**
     * ⚠️ **수입 그룹은 `expectedIncomeTotal`을 써야 한다.** `expectedTotal`은 지출 축 전용이라
     *    `group === 'income'`을 **함수 안에서** 건너뛴다(#48c 회귀 방지) — 수입 소계에 그걸
     *    그대로 쓰면 `activeCount === 0`이 되어 12개월이 전부 `-`, 계획·합계·차이가 ₩0으로
     *    죽는다. 적대적 리뷰 3렌즈가 독립적으로 잡은 회귀다.
     */
    const totalOf = income ? expectedIncomeTotal : expectedTotal;
    const monthly = visibleMonths.map((m) => {
      const k = makeYm(year, m);
      const e = totalOf(items, k);
      return { m, e, state: monthState(e) };
    });
    // 연 합계 — 열 숨김과 무관하게 12개월 전부(표의 '{year} 합계' 열 규약 유지)
    let yearExpected = 0, yearPlan = 0, yearActual = 0, yearUnresolved = 0, yearPlanned = 0;
    /**
     * ⚠️ **경고로 띄우는 '산출 불가'는 `yearFailed`(계획 산출 실패)뿐이다** — `yearUnresolved`를
     *    그대로 쓰면 계획을 세우지 않는 변동비가 매달 오류로 표시된다(사용자 보고 2026-09:
     *    `산출불가 22`). `yearUnresolved`는 값이 하한임을 알리는 중립 설명(툴팁)에만 남긴다.
     *    ⚠️ 반대로 `yearFailed`를 0으로 뭉개면 `loanSchedule` 실패가 '차이 ₩0'으로 확정 단언되는
     *    R-3 회귀가 난다 — 게이트 자체는 그대로 두고 **세는 대상만** 좁힌 것이다.
     */
    let yearFailed = 0, yearNoPlan = 0;
    // 확인분 차이(D5) — 항목 행과 **같은 필드**를 더하므로 소계 = Σ항목이 구조로 성립한다.
    let yearConfirmedVar = 0, yearConfirmedCells = 0;
    for (const m of MONTHS) {
      const k = makeYm(year, m);
      const e = totalOf(items, k);
      yearExpected += e.value; yearPlan += e.planSum; yearActual += e.fromActual;
      yearUnresolved += e.unresolved;
      yearFailed += unresolvedFailures(e); yearNoPlan += e.noPlan;
      yearPlanned += e.plannedCount;
      yearConfirmedVar += e.confirmedVar; yearConfirmedCells += e.confirmedCells;
    }
    const cur = totalOf(items, ym);
    // ⚠️ 롤업 차이 = 확인 셀이 1개 이상이면 그 셀들의 Σ(실제 − 계획), 0개면 `-`. 산출 불가 게이트가 먼저다.
    const yearVar = yearConfirmedCells === 0 ? null : yearConfirmedVar;
    const rowBg = indent ? 'bg-[#131a27]' : 'bg-[#151b28]';
    return (
      <tr key={key} className={indent ? 'bg-gray-800/25' : 'bg-gray-800/50 font-semibold'}>
        {/* 결제+항목을 합친 칸이라 오른쪽 경계가 곧 고정열 경계다(계획을 숨기면 이 칸이 마지막 고정열). */}
        <td className={`${cellBase} sticky left-0 z-[2] ${rowBg}`} colSpan={2} style={nameEdge}>
          <div className={`flex items-center gap-1.5 ${indent ? 'pl-3' : ''}`}>
            {toggle ? (
              <button type="button" className="text-[11px] hover:text-amber-300 text-left" style={{ color }}
                title={toggle.open ? '접기' : (indent ? '이 결제수단의 항목 펼치기' : '이 그룹의 모든 결제수단 펼치기')}
                onClick={toggle.onToggle}>
                {toggle.open ? '▾' : '▸'} {indent ? '└ ' : ''}{label}
              </button>
            ) : (
              <span className="text-[11px]" style={{ color }}>{indent ? '└ ' : ''}{label}</span>
            )}
            {count !== null && <span className="text-[10px] text-gray-600">{count}건</span>}
            {note && <span className="text-[9px] text-gray-500 truncate" title={note}>{note}</span>}
            {onAdd && !readOnly && (
              <button type="button" className="text-[10px] px-1.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 shrink-0"
                onClick={onAdd}>+ 추가</button>
            )}
          </div>
        </td>
        {!planHidden && (
        <td className={`${cellBase} sticky z-[2] ${rowBg} text-right text-[11px]`} style={{ left: LEFT_PLAN, ...EDGE_FREEZE }}
          title={`${month}월 계획 합계 — 활성 항목 ${cur.planCount}건`}>
          {/* ⚠️ 항목 0건이면 `₩0`이 아니라 `-`(0을 단언하지 않는다). */}
          {cur.planCount === 0 && cur.planSum === 0 ? <span className="text-gray-700">-</span> : fmtNum(cur.planSum, hideAmounts)}
        </td>
        )}
        {monthly.map(({ m, e, state }) => {
          /**
           * ⚠️ **산출된 항목이 하나도 없으면 `0`이 아니라 `-`다.** `unresolved`(실제도 계획도
           *    못 구함 — 예: `principalAsOfYm`이 빈 대출)를 0으로 계상하면 화면이 '납입 ₩0'을
           *    **확정 단언**한다. 구버전 규칙(`mm > 0 && ma === 0` → `-`)이 막던 것이고,
           *    `loanSchedule`의 null 계약("계산 실패는 0이 아니다")과 정면으로 어긋난다.
           */
          const resolved = e.actualCount + e.plannedCount;
          const cellValue = e.value;
          const k = makeYm(year, m);
          // 미래 달 = 예상 → 흐린 이탤릭(D7). 과거·현재 달의 계획 반영분은 월 헤더가 알린다.
          const future = isFutureYm(k);
          // ⚠️ 경고 배지는 **산출 실패분만** 센다(계획을 세우지 않는 변동비는 정상 상태다).
          const failed = unresolvedFailures(e);
          return (
            <td key={m} className={`${cellBase} text-right text-[11px] ${future ? 'text-gray-500 italic' : ''}`}
              title={state === 'none' ? '이 달에는 항목이 없습니다'
                : (future ? '예상(오늘 이후 달 — 계획 기준) · ' : '')
                  + `실제 ${fmtWon(e.fromActual, hideAmounts)} (${e.actualCount}건) + 계획 반영 ${fmtWon(e.fromPlan, hideAmounts)} (${e.plannedCount}건)`
                  + (failed > 0 ? ` · 산출 불가 ${failed}건(합계에서 빠짐 — 하한)` : '')
                  /* 계획을 세우지 않는 항목은 오류가 아니라 정상이다 — 중립적으로만 밝힌다. */
                  + (e.noPlan > 0 ? ` · 계획 없는 항목 ${e.noPlan}건(변동비 등 — 실제를 넣은 달만 잡힙니다)` : '')}>
              {(state === 'none' && !ex) ? <span className="text-gray-700" >-</span>
                : resolved === 0 ? <span className="text-gray-600">-</span> : (
                  <>
                    {fmtNum(cellValue, hideAmounts)}
                    {/* ⚠️ 산출 **실패**가 섞이면 이 값은 총액이 아니라 하한이다 — 그때만 알린다.
                        계획 미입력(`noPlan`)까지 세면 변동비가 매달 `?N`으로 점등한다(2026-09). */}
                    {failed > 0 && (
                      <div className="text-[9px] leading-tight" style={{ color: LEDGER_DIVERGING.over }}>?{failed}</div>
                    )}
                  </>
                )}
            </td>
          );
        })}
        <td className={`${cellBase} text-right text-[11px]`}
          title={`실제 ${fmtWon(yearActual, hideAmounts)} + 계획 반영 ${fmtWon(yearExpected - yearActual, hideAmounts)} (${yearPlanned}건)`
            + (yearFailed > 0 ? ` · 산출 불가 ${yearFailed}건이 빠진 하한입니다` : '')
            + (yearNoPlan > 0 ? ` · 계획 없는 항목 ${yearNoPlan}건(변동비 등 — 실제를 넣은 달만 잡힙니다)` : '')}>
          {fmtNum(yearExpected, hideAmounts)}
          <div className="text-[9px] text-gray-600">계획 {fmtNum(yearPlan, hideAmounts)}</div>
        </td>
        <td className={`${cellBase} text-right text-[10px]`}>
          {/* ⚠️ 산출 **실패**는 여전히 확정 불가 사유다 — '차이 ₩0'으로 단언되면 안 된다(R-3).
              ⚠️ 그러나 계획을 세우지 않는 항목(변동비 등)까지 이 게이트에 넣지 말 것 — 사용자가
                 손댈 것이 없는 정상 상태가 `산출불가 22`라는 상시 오류로 표시된다(사용자 확정 2026-09).
                 그 항목들은 확인 셀이 없어 자연히 `-`로 떨어진다. */}
          {yearFailed > 0 ? (
            <span className="text-gray-500" title={`산출 불가 ${yearFailed}건이 있어 계획 대비 차이를 확정할 수 없습니다`}>
              {`산출불가 ${yearFailed}`}
            </span>
          ) : yearVar === null ? (
            <span className="text-gray-600" title={yearNoPlan > 0
              ? '계획이 없는 항목이라 계획 대비 차이가 없습니다(변동비 등 — 오류가 아닙니다)'
              : '실제와 계획이 둘 다 있는 셀이 없어 차이를 낼 수 없습니다'}>-</span>
          ) : (
            <span style={{ color: varianceTone(yearVar) }}
              title={`확인 ${yearConfirmedCells}개 셀 기준 · 계획 없는 셀 제외${yearPlanned > 0 ? ` · 계획 반영 ${yearPlanned}건은 포함되지 않습니다` : ''}`}>
              {varianceMark(yearVar)} {hideAmounts ? '***' : Math.abs(Math.round(yearVar)).toLocaleString()}
            </span>
          )}
        </td>
      </tr>
    );
  };

  /**
   * 그룹 트리 블록(§13.2.2) — L0 그룹 행(항상) → L1 결제수단 행(수단이 2종 이상일 때 항상, D3) →
   * L2 항목 행(펼쳤을 때만). **소계가 위**에 오는 배치는 화면 전용이다(엑셀 ①은 종전대로 소계가 아래).
   *
   * ⚠️ 값의 단일 소스는 전부 `renderSubtotalRow`다 — 그룹·수단 행을 따로 계산하지 말 것.
   * ⚠️ 결제수단 행은 **그 그룹에 2종 이상 있을 때만**. 하나뿐이면 노이즈라 라벨에만 표기하고
   *    그룹 ▸가 곧 항목 토글이다(대출은 전부 '이체'라 자동으로 그렇게 된다). 그룹별 화이트리스트를
   *    만들지 말 것.
   * ⚠️ **불변식: Σ(결제수단 행) === 그룹 행.** 손상 데이터의 미지 결제수단은
   *    `normalizeLedgerBooks`가 'card'로 강제하므로 이 등식이 구조적으로 성립한다.
   *    수단을 하드코딩(현금/카드만)하면 `pay:'auto'`인 항목이 **어느 행에도 없이 사라진다**.
   * ⚠️ 항목 0건인 그룹도 행을 그린다(값 셀은 `-`) — `+ 추가` 진입점이 거기뿐이다.
   */
  const renderGroupTree = (g, items) => {
    const rows = [];
    const label = LEDGER_GROUP_LABEL[g];
    const note = g === 'annual' ? '연 1회 목돈 — 월 지출 합계에 포함되지 않습니다'
      : g === 'income' ? '수입 — 지출 합계와 분리됩니다' : '';
    if (g !== 'income') {
      const present = LEDGER_PAY_ORDER.filter((p) => items.some((it) => it && it.pay === p));
      const groupOpen = openGroups.has(g);
      /**
       * 지금 보이는 달과 무관해 숨긴 항목 수(변동비 전용 — `rowInView`).
       * ⚠️ 반드시 알린다 — 안 알리면 소계·연 합계에는 들어 있는데 행이 없어 사용자가
       *    "합계가 안 맞는다"로 읽는다(값은 정확하고 행만 접힌 것이다).
       */
      const hiddenRows = items.length - items.filter(rowInView).length;
      rows.push(renderSubtotalRow({
        key: `sub-${g}`,
        label: present.length === 1
          ? `${label} 합계 · 전액 ${LEDGER_PAY_LABEL[present[0]]}`
          : `${label} 합계`,
        color: LEDGER_GROUP_COLOR[g],
        items,
        toggle: { open: groupOpen, onToggle: () => toggleGroup(g, present) },
        onAdd: () => addItem(g),
        count: items.length,
        /**
         * ⚠️ 변동비는 '+ 추가'가 **보고 있는 달에만** 적용되는 항목을 만든다 — 그 사실이 화면에
         *    없으면 사용자가 다른 달을 입력하려다 잠긴 칸(`-`)만 보고 고장으로 읽는다.
         */
        note: [
          note,
          g === 'variable' ? `추가하면 ${month}월에만 적용됩니다(항목 옆 '적용'으로 바꿉니다)` : '',
          hiddenRows > 0 ? `숨긴 달에만 있는 항목 ${hiddenRows}건은 접혀 있습니다(합계에는 그대로 들어 있습니다)` : '',
        ].filter(Boolean).join(' · '),
      }));
      if (present.length > 1) {
        for (const p of present) {
          const payItems = items.filter((it) => it && it.pay === p);
          const open = bucketOpen(g, p);
          rows.push(renderSubtotalRow({
            key: `sub-${g}-${p}`,
            label: `${LEDGER_PAY_LABEL[p]} 소계`,
            color: ledgerPayColor(p),
            items: payItems,
            indent: true,
            toggle: { open, onToggle: () => togglePay(g, p, present) },
            onAdd: () => addItem(g, p),
            count: payItems.length,
          }));
          if (open) rows.push(...payItems.filter(rowInView).map(renderItemRow));
        }
      } else if (groupOpen) {
        rows.push(...items.filter(rowInView).map(renderItemRow));
      }
    } else {
      const groupOpen = openGroups.has(g);
      const pays = LEDGER_PAY_ORDER.filter((p) => items.some((it) => it && it.pay === p));
      rows.push(renderSubtotalRow({
        key: `sub-${g}`, label: `${label} 합계`,
        color: LEDGER_GROUP_COLOR[g], items,
        income: true,   // ⚠️ 없으면 지출 전용 집계를 타서 수입 소계가 통째로 죽는다
        toggle: { open: groupOpen, onToggle: () => toggleGroup(g, pays) },
        onAdd: () => addItem(g),
        count: items.length,
        note,
      }));
      if (groupOpen) rows.push(...items.map(renderItemRow));
    }
    return rows;
  };

  /**
   * 표 맨 아래 '월 지출 합계' 행 — 대출 + 고정비 + 변동비 + **그 달 납부하는 연단위**.
   *
   * ⚠️ 라벨에 '(연단위 납부월 포함)'을 반드시 남길 것. 헤더 KPI의 '월 지출 합계'는
   *    **연단위 제외**라 이름이 겹치는데, 그 둘을 맞추려는 후속 수정이 `recurringMonthly`에
   *    annual을 더하면 `projectedAnnual`(= ×12 + annualLump)에서 **12배 이중 계상**된다.
   * ⚠️ 이 행의 연 합계를 `kpi.projectedAnnual`과 같다고 단언하지 말 것 — 정의가 다르다
   *    (이쪽은 각 달의 자기 값 합, 저쪽은 기준월 recurring × 12). 대출의 `principalAsOfYm`
   *    이전 달은 납입액이 null이라 실측 픽스처에서 두 값이 11,581,101 어긋난다.
   */
  const renderGrandTotalRow = () => {
    const expenseItems = (book?.items || []).filter((it) => it && it.group !== 'income');
    return renderSubtotalRow({
      key: 'sub-grand',
      label: '월 지출 합계 (연단위 납부월 포함)',
      color: LEDGER_BALANCE_COLOR.expense,
      items: expenseItems,
    });
  };

  const colCount = 3 + visibleMonths.length + 2;

  return (
    <div className={shell} onKeyDownCapture={(e) => { if (e.key === 'Escape' && variant === 'overlay') { e.stopPropagation(); onClose?.(); } }}>
      {/* ── 헤더 ── */}
      <div className="shrink-0 border-b border-gray-800 bg-[#0f1623]">
        <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
          <span className="text-[13px] font-bold text-amber-300">가계부</span>
          {local.length > 1 && (
            <select
              className="bg-gray-800 text-[11px] rounded px-1.5 py-0.5 outline-none"
              value={bookIdx}
              onChange={(e) => setBookIdx(Number(e.target.value))}
            >
              {local.map((b, i) => <option key={b.id} value={i}>{b.name || `장부 ${i + 1}`}</option>)}
            </select>
          )}
          {book && !readOnly && (
            <TextCell
              className="max-w-[160px] text-gray-300"
              value={book.name}
              placeholder="장부 이름"
              onCommit={(raw) => patchBook(book.id, (b) => (b.name === raw ? b : { ...b, name: raw }))}
            />
          )}
          <div className="flex items-center gap-1 ml-2">
            <button className="text-[12px] px-1.5 rounded hover:bg-gray-800" onClick={() => setYear((y) => y - 1)}>◀</button>
            <span className="text-[12px] font-semibold tabular-nums">{year}년</span>
            <button className="text-[12px] px-1.5 rounded hover:bg-gray-800" onClick={() => setYear((y) => y + 1)}>▶</button>
          </div>
          <select
            className="bg-gray-800 text-[11px] rounded px-1.5 py-0.5 outline-none"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            title="KPI·도넛이 기준으로 삼는 달"
          >
            {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
          </select>

          <div className="flex-1" />
          {flash && <span className="text-[10px] text-amber-300">{flash}</span>}
          {readOnly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800/60">읽기 전용</span>}
          {/* ⚠️ readOnly 게이팅 없음 — 내보내기는 읽기 동작이다(위 handleExcel 주석 참조). */}
          <button
            className="text-[11px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40"
            onClick={handleExcel}
            disabled={!book || !(book.items || []).length}
            title={`${year}년 가계부를 엑셀(.xlsx)로 저장 — 시트 3장(월 매트릭스·대출·연간요약)`}
          >⭳ 엑셀</button>
          {/* 이전 기록 — ⚠️ 자동 백업(portfolio_backup_*)과 별개다. 그쪽은 수동 저장·앱 닫기에만
              만들어지고 800ms 자동 저장은 백업 없이 STATE를 덮으므로, 하루 종일 편집해도 복구
              지점이 하나도 안 생길 수 있다(2026-08-29 실측 유실). 이 버튼이 그 구멍을 메운다. */}
          {onUpdateSnapshots && (
            <button
              className="text-[11px] px-2 py-0.5 rounded bg-emerald-900/50 hover:bg-emerald-900/80 text-emerald-200 border border-emerald-800/60 disabled:opacity-40"
              onClick={() => saveSnapshot('')}
              disabled={readOnly || !book}
              title={readOnly ? '읽기 전용입니다' : '지금 장부를 이전 기록으로 저장합니다(최대 ' + MAX_LEDGER_SNAPSHOTS + '개 보관)'}
            >💾 저장</button>
          )}
          <button
            className="text-[11px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
            onClick={() => setShowSnapshots(true)}
            title="저장해 둔 이전 기록에서 되돌리기"
          >이전 기록{(snapshots || []).length > 0 ? ` ${snapshots.length}` : ''}</button>
          {onOpenWindow && variant === 'overlay' && (
            <button className="text-[11px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300" onClick={onOpenWindow} title="별도 창에서 열기">⧉ 새 창</button>
          )}
          {onClose && (
            <button className="text-[13px] px-2 py-0.5 rounded hover:bg-gray-800 text-gray-400" onClick={onClose} title="닫기">✕</button>
          )}
        </div>

        {notice && (
          <div className="px-3 py-1 text-[11px] text-amber-300 bg-amber-900/25 border-t border-amber-800/40">{notice}</div>
        )}

        {/* ── KPI ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 px-3 pb-2">
          <Kpi label={`월 지출 합계 (${month}월 기준)`} value={fmtWon(kpi.recurringMonthly, hideAmounts)}
            sub="대출 + 고정비 + 변동비 (연단위 제외)"
            title="매월 반복되는 지출만 더한 값입니다. 연 1회 목돈(연단위)은 아래 '예상 年 지출'에서 한 번만 더해집니다." />
          {/* ⚠️ 세분화 칩의 소스는 `projectedByPay`이지 `totals.byPay`가 **아니다**.
              후자는 연단위를 납부월에 전액 넣는데 이 카드 값은 연단위를 ÷12 해 매달 넣으므로,
              그대로 붙이면 부분합 ≠ 총액이 상시 발생한다(실측: 비납부월 473,334 부족 /
              납부월 5,680,000 초과). `projectedByPay`는 Σ가 이 값과 정확히 같도록 정의돼 있다.
              ⚠️ 라벨에 '계획 기준'을 남길 것 — 분석 탭 칩은 실적 우선이라 같은 '카드'라는
              이름으로 다른 숫자가 나온다. */}
          <Kpi label="예상 月 지출" value={fmtWon(kpi.projectedMonthly, hideAmounts)}
            sub={`예상 年 ${fmtWon(kpi.projectedAnnual, hideAmounts)}`}
            title="예상 年 지출 = 월 지출 합계 × 12 + 년단위 합계. 그 값을 12로 나눈 것입니다.&#10;아래 결제수단 칩은 이 값을 계획 기준으로 쪼갠 것이라 합이 정확히 일치합니다.">
            {projPay.length > 0 && (
              <div className="mt-1 pt-1 border-t border-gray-800 flex flex-wrap gap-1">
                <span className="text-[9px] text-gray-600">계획 기준</span>
                {projPay.map((p) => (
                  <span key={p.key} className="inline-flex items-center gap-0.5 text-[9px] px-1 rounded bg-gray-800/80"
                    title={`${p.label} ${fmtWon(p.value, hideAmounts)} · 예상 月 지출의 ${kpi.projectedMonthly > 0 ? Math.round((p.value / kpi.projectedMonthly) * 100) : 0}%`}>
                    <span className="inline-block w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: ledgerPayColor(p.key) }} />
                    <span className="text-gray-400">{p.label}</span>
                    <span className="text-gray-300">{fmtWonShort(p.value, hideAmounts)}</span>
                  </span>
                ))}
              </div>
            )}
          </Kpi>
          <Kpi label="수입 (월)" value={kpi.incomeMonthly > 0 ? fmtWon(kpi.incomeMonthly, hideAmounts) : '-'}
            tone={kpi.incomeMonthly > 0 ? LEDGER_BALANCE_COLOR.income : undefined}
            sub={kpi.incomeMonthly > 0 ? '' : '수입 항목을 추가하면 저축여력·DSR이 계산됩니다'} />
          <Kpi label="저축여력" value={kpi.savingCapacity === null ? '-' : fmtWon(kpi.savingCapacity, hideAmounts)}
            tone={kpi.savingCapacity === null ? undefined : (kpi.savingCapacity >= 0 ? LEDGER_DIVERGING.under : LEDGER_DIVERGING.over)}
            sub="수입 − 예상 月 지출" />
          <Kpi label="대출 월 납입" value={fmtWon(kpi.loanMonthly, hideAmounts)}
            sub={`월 ${fmtPct(kpi.loanMonthlyRate, 3)} · 년 ${fmtPct(kpi.loanAnnualRate, 3)}`}
            title="월 납입 이율 = 월 납입액 / 대출 잔액" />
          <Kpi label="DSR" value={fmtPct(kpi.dsr, 1)}
            tone={kpi.dsr === null ? undefined : (kpi.dsr > 0.4 ? LEDGER_DIVERGING.over : LEDGER_DIVERGING.under)}
            sub="연 대출 상환액 / 연 수입(계획)" />
        </div>

        {(confirmed.unconfirmed > 0 || kpi.loanUnresolved > 0) && (
          <div className="px-3 pb-2 flex gap-2 flex-wrap text-[10px]">
            {confirmed.unconfirmed > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                {/* ⚠️ 반영 규약(§13): 미확인은 계획으로 **반영**된다 — 합계·분석·전월/전년 대비·달력 전부.
                    옛 괄호 문장("전월·전년 대비와 달력은 제외")은 이제 거짓이라 삭제했다(#G37g). */}
                {month}월 확인 {confirmed.confirmed}/{confirmed.target}
                {confirmed.unconfirmed > 0 && <> — 미확인 {confirmed.unconfirmed}건은 계획으로 반영됩니다(실제가 다르면 수입 및 지출 탭에서 고치세요)</>}
              </span>
            )}
            {kpi.loanUnresolved > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800/60">
                월 납입액을 구하지 못한 대출 {kpi.loanUnresolved}건 — 대출 탭에서 기준월·만기 또는 직접 입력을 확인하세요
              </span>
            )}
          </div>
        )}

        {/* ── 탭 ── */}
        <div className="flex gap-1 px-3 pb-2">
          {/* 순서·라벨(§13.2.1): 분석이 첫 화면. 키 'matrix'·엑셀 시트명('월 매트릭스')은 유지한다. */}
          {[['chart', '분석'], ['matrix', '수입 및 지출'], ['loan', '대출'], ['annual', '연간']].map(([k, label]) => (
            <button key={k}
              className={`text-[11px] px-2.5 py-1 rounded ${tab === k ? 'bg-amber-900/50 text-amber-200 border border-amber-800/60' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-800'}`}
              onClick={() => setTab(k)}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="flex-1 overflow-auto">
        {!book ? (
          <div className="p-6 text-[12px] text-gray-500">
            {readOnly ? '표시할 장부가 없습니다.' : '장부를 준비하는 중입니다…'}
          </div>
        ) : tab === 'matrix' ? (
          <div className="p-3">
            {/* ⚠️ 복원 칩은 숨긴 열을 되돌리는 **유일한 경로**다 — 계획 열도 반드시 여기 낼 것
                (조건을 `hiddenMonths.length > 0`으로 두면 계획만 숨겼을 때 되돌릴 방법이 사라진다). */}
            {(hiddenMonths.length > 0 || planHidden) && (
              <div className="flex gap-1 flex-wrap mb-2 items-center">
                <span className="text-[10px] text-gray-500 shrink-0">숨긴 열</span>
                {planHidden && (
                  <button className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
                    title="계획 열 다시 보기"
                    onClick={() => applyView({ planHidden: false })}>계획</button>
                )}
                {hiddenMonths.slice().sort((a, b) => a - b).map((m) => (
                  <button key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
                    title={`${m}월 열 다시 보기`}
                    onClick={() => applyView({ hiddenMonths: hiddenMonths.filter((x) => x !== m) })}>{m}월</button>
                ))}
              </div>
            )}
            {/* '이 달 계획대로 확인' — 인라인 2단계(§13.2.4). z-1090 + 별도 창에는 App이 없어 ConfirmDialog가 안 뜬다.
                ⚠️ `applyPlanAsActual`은 순수라 미리보기로 불러도 아무것도 쓰지 않는다 — 프롬프트는 **실제로 쓰는 건수**를 말한다. */}
            {confirmYm && !readOnly && (() => {
              const pv = applyPlanAsActual(book, confirmYm, todayYm);
              const row = yearSeries.find((r) => r.ym === confirmYm);
              const unconfirmed = row ? row.unconfirmed : 0;
              const mm = Number(confirmYm.slice(5, 7));
              const skipped = [
                pv.skippedTx > 0 ? `거래 입력 항목 ${pv.skippedTx}건` : '',
                pv.skippedUnresolved > 0 ? `산출 불가 ${pv.skippedUnresolved}건` : '',
              ].filter(Boolean).join(' · ');
              return (
                <div className="mb-2 px-3 py-1.5 rounded border border-amber-800/50 bg-amber-900/25 flex items-center gap-2 flex-wrap text-[11px]">
                  {pv.written > 0 ? (
                    <>
                      <span className="text-amber-200">
                        <b>{mm}월</b> 미확인 {unconfirmed}건 중 <b>{pv.written}건</b>을 계획 금액으로 확인할까요?
                        {skipped && <span className="text-amber-300/80"> ({skipped} 제외)</span>}
                      </span>
                      <button className="text-[11px] px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-100 border border-emerald-800/60"
                        onClick={() => applyPlanConfirm(confirmYm)}>확인</button>
                      <button className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400"
                        onClick={() => setConfirmYm('')}>취소</button>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-300">
                        {mm}월에 계획 금액으로 확인할 항목이 없습니다{skipped ? ` (${skipped} 제외)` : ''}
                      </span>
                      <button className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400"
                        onClick={() => setConfirmYm('')}>닫기</button>
                    </>
                  )}
                  <span className="text-[9px] text-gray-500 w-full">
                    확인 = 그 항목의 이 달 실제 칸에 계획 금액을 그대로(반올림 없이) 적습니다. 비우면 다시 계획으로 돌아갑니다.
                    거래로 입력하는 항목은 여기서 확인하지 않습니다(거래를 넣으세요). 누르지 않아도 화면·분석은 반영값으로 이미 완전합니다.
                  </span>
                </div>
              );
            })()}
            <div className="overflow-x-auto isolate border border-gray-800 rounded-lg" onKeyDown={onGridKeyDown}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#151b28]">
                    <th className={`${cellBase} sticky left-0 z-[3] bg-[#151b28] text-left text-gray-400`} style={EDGE_STICKY}>결제</th>
                    <th className={`${cellBase} sticky z-[3] bg-[#151b28] text-left text-gray-400`} style={{ left: LEFT_NAME, ...nameEdge }}>항목</th>
                    {!planHidden && (
                      /* 계획 열 숨기기 — 월 열과 **같은 UX**(헤더 위 4px 띠). `relative`가 없으면
                         absolute 띠가 표 전체 기준으로 떠 엉뚱한 자리를 덮는다. */
                      <th className={`${cellBase} sticky z-[3] bg-[#151b28] text-right text-gray-400 relative`} style={{ left: LEFT_PLAN, ...EDGE_FREEZE }}>
                        <button
                          className="absolute top-0 left-0 right-0 h-[4px] z-[1] hover:bg-amber-500/50"
                          title="계획 열 숨기기 (표 위 '계획 복원'으로 되돌립니다)"
                          onClick={() => applyView({ planHidden: true })}
                        />
                        계획
                      </th>
                    )}
                    {visibleMonths.map((m) => {
                      const k = makeYm(year, m);
                      // 확인 현황은 `yearSeries` 행(`confirmedOf`)에서만 온다 — 새 루프·`plannedCount` 금지(§13.2.3).
                      const row = yearSeries[m - 1];
                      const isCur = k === todayYm;
                      const future = isFutureYm(k);
                      const done = row.unconfirmed === 0;
                      const status = future ? '예상' : done ? '✓' : `확인 ${row.confirmedCount}/${row.targetCount}`;
                      // ⚠️ `진행 K` — 이번 달 거래 입력 항목(거래 0건)은 미확인이 아니지만 값은 계획이다. 이 표시가
                      //    없으면 `✓`와 반영값이 모순된다(§13.11 R-6). `✓`는 미확인 0 && 진행 0일 때만.

                      const names = row.missingIds.slice(0, 5)
                        .map((id) => ((book.items || []).find((it) => it && it.id === id) || {}).name || id);
                      const title = future
                        ? '오늘 이후의 달 — 계획으로 예상한 값입니다(전월 대비·차트 막대 없음)'
                        : `실적 입력 대상 ${row.targetCount}건 중 ${row.confirmedCount}건 확인`
                          + (row.unconfirmed > 0 ? `\n미확인: ${names.join(', ')}${row.missingIds.length > 5 ? ' 외' : ''} — 계획으로 반영 중` : '')
                          + (!readOnly ? '\n클릭: 미확인 항목을 계획 금액으로 확인' : '');
                      return (
                        <th key={m} className={`${cellBase} text-right relative ${isCur ? 'text-amber-200' : 'text-gray-400'}`}>
                          <button
                            className="absolute top-0 left-0 right-0 h-[4px] z-[1] hover:bg-amber-500/50"
                            title={`${m}월 열 숨기기`}
                            onClick={() => applyView({ hiddenMonths: [...hiddenMonths, m] })}
                          />
                          {m}월
                          <button type="button"
                            className={`block w-full text-right text-[9px] leading-tight font-normal ${future ? 'text-gray-600 italic' : done ? 'text-emerald-400' : 'text-gray-500 hover:text-amber-300'} ${confirmYm === k ? 'underline' : ''}`}
                            title={title}
                            disabled={readOnly || future}
                            onClick={() => setConfirmYm((c) => (c === k ? '' : k))}>
                            {status}
                          </button>
                        </th>
                      );
                    })}
                    <th className={`${cellBase} text-right text-gray-400`}>{year} 합계</th>
                    <th className={`${cellBase} text-right text-gray-400`}>차이</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 트리(§13.2.2): 그룹 행 → 결제수단 행 → (펼쳤을 때) 항목 행. 값은 전부 renderSubtotalRow 경유. */}
                  {LEDGER_GROUP_ORDER.map((g) => (
                    <React.Fragment key={g}>{renderGroupTree(g, grouped[g] || [])}</React.Fragment>
                  ))}
                  {(book?.items || []).some((it) => it && it.group !== 'income') && renderGrandTotalRow()}
                </tbody>
              </table>
            </div>

            <CategoryManager
              readOnly={readOnly}
              registry={Array.isArray(book?.categories) ? book.categories : []}
              inUse={categories}
              items={book?.items || []}
              onAdd={addCategory}
              onRemove={removeCategory}
            />

            <div className="mt-2 text-[10px] text-gray-600 leading-relaxed">
              · 실제 금액 칸을 <b>비우면 '미입력'</b>이고, <b>0을 넣으면 '그 달엔 안 썼다'</b>는 확정입니다 — 두 값은 합계에서 다르게 다뤄집니다.<br />
              · <b>계획은 손대지 않아도 그 항목의 모든 달에 반영됩니다</b> — 월 칸의 <span className="text-gray-500 italic">흐린 이탤릭</span> 숫자가 계획이고, 직접 넣은 값은 밝게 보입니다. 그룹·결제수단 소계, 연간 합계, 분석 탭, 전월/전년 대비, 메모 달력이 전부 같은 <b>반영값(실제 ?? 계획)</b>을 씁니다. 몇 건이 아직 계획인지는 월 헤더의 <b>확인 N/M</b>이 보여 줍니다(오늘 이후 달은 <i>예상</i>).<br />
              · 실제가 계획과 다른 달만 숫자를 넣으면 됩니다. <b>다시 비우면 계획으로 돌아갑니다.</b> 월 헤더의 '확인 N/M'을 누르면 미확인 항목에 계획 금액을 그대로 적어 넣을 수 있습니다(선택 — 누르지 않아도 화면은 완전합니다).<br />
              · <b>차이</b> 열은 실제와 계획이 둘 다 있는 달만 더한 <b>확인분 차이</b>입니다. 한 달도 확인하지 않았으면 '-'(차이 0이라고 단언하지 않습니다). <b>계획을 세우지 않는 항목(변동비 등)은 차이가 없는 것이 정상</b>이라 그냥 '-'입니다 — '산출불가 N'은 <b>계획을 산출하려다 실패</b>했을 때만 뜹니다(예: 잔액 기준월이 빈 대출).<br />
              · <b>변동비</b>는 그 달에만 생기는 지출이라 <b>추가한 달에만</b> 적용됩니다(고정비·대출·연단위는 모든 달). 항목 이름 아래 <b>적용</b> 칩으로 '이 달만 ↔ 전체'를 바꾸고, 보이는 달과 무관한 변동비 행은 접힙니다(합계에는 그대로 들어 있습니다).<br />
              · 월 이름 <b>바로 위 얇은 띠</b>를 누르면 그 달 열이, <b>계획</b> 열의 같은 띠를 누르면 계획 열이 숨겨집니다. 표 위 <b>숨긴 열</b> 칩을 누르면 다시 보입니다(화면 전용 — 계획 값과 엑셀은 그대로이고, 다음에 열 때도 이 상태가 유지됩니다).<br />
              · 항목이 연중에 시작·종료했다면 그 달들만 <b>-</b>로 잠깁니다. 잠긴 칸을 <b>클릭하면 그 달까지 적용기간이 넓어집니다</b>.<br />
              · 그룹 행 ▸는 그 그룹의 모든 결제수단을, 결제수단 행 ▸는 그 수단의 항목만 펼칩니다. 항목명 왼쪽 <b>▲▼</b>는 같은 그룹·같은 결제수단 안에서 순서를 바꿉니다. 항목명 아래 <b>구분</b>은 표 아래 '구분 관리'에서 미리 등록한 값 중에서 고릅니다.<br />
              · 계획 칸 옆 <b>月/年</b> 버튼: 연 단위로 청구되는 항목(연 구독 등)은 <b>年</b>으로 두면 월 계획이 자동으로 ÷12 됩니다. 중간 반올림은 하지 않습니다.<br />
              · 지출 증감 색은 이 앱의 손익 색(이익=빨강)과 <b>다릅니다</b> — 계획 초과는 <span style={{ color: LEDGER_DIVERGING.over }}>▲ 노랑</span>, 절약은 <span style={{ color: LEDGER_DIVERGING.under }}>▼ 청록</span>입니다.
            </div>
          </div>
        ) : tab === 'loan' ? (
          <div className="p-3">
            <div className="overflow-x-auto isolate border border-gray-800 rounded-lg" onKeyDown={onGridKeyDown}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#151b28] text-gray-400">
                    <th className={`${cellBase} text-left`}>대출명</th>
                    <th className={`${cellBase} text-right`}>대출금(잔액)</th>
                    <th className={`${cellBase} text-center`}>잔액 기준월</th>
                    <th className={`${cellBase} text-right`}>약정 이자</th>
                    <th className={`${cellBase} text-center`}>상환방법</th>
                    <th className={`${cellBase} text-center`}>만기일</th>
                    <th className={`${cellBase} text-center`}>거치(개월)</th>
                    <th className={`${cellBase} text-right`}>월 납입액</th>
                    <th className={`${cellBase} text-right`}>직접 입력</th>
                    <th className={`${cellBase} text-right`}>월 납입 이율</th>
                    <th className={`${cellBase} text-right`}>년 납입 이율</th>
                    <th className={`${cellBase}`}></th>
                  </tr>
                </thead>
                <tbody>
                  {(grouped.loan || []).map((it) => {
                    const l = it.loan || makeLedgerLoan();
                    const sch = loanSchedule(l, ym);
                    const pay = sch ? sch.payment : null;
                    const rate = pay !== null && l.principal > 0 ? pay / l.principal : null;
                    const annual = loanNext12Total(l, ym);
                    const setLoan = (patch) => patchItem(book.id, it.id, (x) => ({ ...x, loan: { ...(x.loan || makeLedgerLoan()), ...patch } }));
                    return (
                      <tr key={it.id} className="hover:bg-gray-800/30">
                        <td className={`${cellBase}`} style={{ minWidth: 120 }}>
                          <div className="flex items-center gap-1">
                            <TextCell col="lname" value={it.name} placeholder="대출명" readOnly={readOnly}
                              onCommit={(raw) => patchItem(book.id, it.id, (x) => (x.name === raw ? x : { ...x, name: raw }))} />
                            <DeleteBtn readOnly={readOnly} armed={armedDelete === it.id}
                              onArm={() => setArmedDelete(it.id)} onConfirm={() => removeItem(it.id)} onCancel={() => setArmedDelete('')} />
                          </div>
                        </td>
                        <td className={`${cellBase} text-right`} style={{ minWidth: 110 }}>
                          <NumCell col="lprin" value={l.principal} readOnly={readOnly}
                            onCommit={(raw) => { const t = raw.trim().replace(/,/g, ''); const v = t === '' ? 0 : Number(t); if (Number.isFinite(v)) setLoan({ principal: v }); }} />
                        </td>
                        <td className={`${cellBase} text-center`} style={{ minWidth: 78 }}>
                          <input type="month" className="bg-transparent text-[10px] outline-none focus:bg-gray-800/60 rounded"
                            value={l.principalAsOfYm || ''} readOnly={readOnly}
                            title="⚠️ 위 잔액이 어느 시점의 값인지. 비우면 월 납입액을 계산할 수 없습니다(잔액과 기간의 기준을 묶어야 납입액이 고정됩니다)."
                            onChange={(e) => !readOnly && setLoan({ principalAsOfYm: e.target.value })} />
                        </td>
                        <td className={`${cellBase} text-right`} style={{ minWidth: 64 }}>
                          <div className="flex items-center justify-end gap-0.5">
                            <input type="text" inputMode="decimal" data-col="lrate" className={inputCls} readOnly={readOnly}
                              defaultValue={l.annualRate ?? ''} key={`${it.id}-rate-${l.annualRate}`}
                              onBlur={(e) => { if (readOnly) return; const t = e.target.value.trim(); const v = t === '' ? 0 : Number(t); if (Number.isFinite(v)) setLoan({ annualRate: v }); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                            <span className="text-[10px] text-gray-500">%</span>
                          </div>
                        </td>
                        <td className={`${cellBase} text-center`} style={{ minWidth: 96 }}>
                          <select className="bg-transparent text-[10px] outline-none" value={l.method} disabled={readOnly}
                            onChange={(e) => setLoan({ method: e.target.value })}>
                            <option value="interestOnly" className="bg-[#0f1623]">만기일시(이자만)</option>
                            <option value="amortizing" className="bg-[#0f1623]">원리금균등</option>
                            <option value="equalPrincipal" className="bg-[#0f1623]">원금균등</option>
                          </select>
                        </td>
                        <td className={`${cellBase} text-center`} style={{ minWidth: 108 }}>
                          <input type="date" className="bg-transparent text-[10px] outline-none focus:bg-gray-800/60 rounded"
                            value={l.endDate || ''} readOnly={readOnly}
                            onChange={(e) => !readOnly && setLoan({ endDate: e.target.value })} />
                        </td>
                        <td className={`${cellBase} text-center`} style={{ minWidth: 56 }}>
                          <NumCell col="lgrace" align="center" value={l.graceMonths} readOnly={readOnly}
                            onCommit={(raw) => { const t = raw.trim(); setLoan({ graceMonths: t === '' ? null : (Number.isFinite(Number(t)) ? Number(t) : null) }); }} />
                        </td>
                        <td className={`${cellBase} text-right font-semibold`} style={{ minWidth: 104 }}>
                          {pay === null ? (
                            <span className="text-amber-400 text-[10px]" title="잔액 기준월·만기일을 채우거나 오른쪽에 월 납입액을 직접 입력하세요">계산 불가</span>
                          ) : (
                            <span title={sch.source === 'override' ? '직접 입력한 값입니다' : `${sch.levelPayment ? '만기까지 고정' : '원금균등 — 매달 줄어듭니다'} · 잔여 ${sch.termMonths ?? '-'}개월`}>
                              {fmtWon(pay, hideAmounts)}
                              {sch.source === 'override' && <span className="text-[9px] text-sky-400 ml-1">직접</span>}
                              {!sch.levelPayment && <span className="text-[9px] text-gray-500 ml-1">▼</span>}
                            </span>
                          )}
                          {sch && !sch.levelPayment && (
                            <div className="text-[9px] text-gray-500">{year}년 합 {fmtWonShort(annual.total, hideAmounts)}</div>
                          )}
                        </td>
                        <td className={`${cellBase} text-right`} style={{ minWidth: 96 }}>
                          <NumCell col="lover" value={l.paymentOverride} readOnly={readOnly} placeholder="계산 대신"
                            title="⚠️ 값을 넣으면 계산을 덮어씁니다. 중도상환·금리변동 등 모델에 없는 조건이 있는 대출은 여기에 실제 납입액을 적으세요."
                            onCommit={(raw) => { const t = raw.trim().replace(/,/g, ''); setLoan({ paymentOverride: t === '' ? null : (Number.isFinite(Number(t)) ? Number(t) : null) }); }} />
                        </td>
                        <td className={`${cellBase} text-right text-gray-400`}>{fmtPct(rate, 3)}</td>
                        <td className={`${cellBase} text-right text-gray-400`}>{rate === null ? '-' : fmtPct(rate * 12, 3)}</td>
                        <td className={`${cellBase}`}></td>
                      </tr>
                    );
                  })}
                  <tr className="bg-gray-800/50 font-semibold">
                    <td className={`${cellBase}`}>합계</td>
                    <td className={`${cellBase} text-right`}>{fmtWon(kpi.loanPrincipal, hideAmounts)}</td>
                    <td className={`${cellBase}`} colSpan={5}></td>
                    <td className={`${cellBase} text-right`}>{fmtWon(kpi.loanMonthly, hideAmounts)}</td>
                    <td className={`${cellBase}`}></td>
                    <td className={`${cellBase} text-right`}>{fmtPct(kpi.loanMonthlyRate, 3)}</td>
                    <td className={`${cellBase} text-right`}>{fmtPct(kpi.loanAnnualRate, 3)}</td>
                    <td className={`${cellBase}`}></td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!readOnly && (
              <button className="mt-2 text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700" onClick={() => addItem('loan')}>+ 대출 추가</button>
            )}
            <div className="mt-2 text-[10px] text-gray-600 leading-relaxed">
              · <b>잔액 기준월</b>은 대출금이 <b>어느 시점의 잔액인가</b>입니다. 이게 있어야 월 납입액이 한 번 계산되고 만기까지 고정됩니다 — 없으면 계산하지 않습니다.<br />
              · <b>원금균등</b>은 매달 납입액이 줄어듭니다. 표의 값은 <b>{month}월 회차</b>이고, 연 합계는 12회차를 각각 더한 값입니다(첫 달 × 12가 아닙니다).<br />
              · 계산이 실제와 다르면 <b>직접 입력</b> 칸에 실제 납입액을 적으세요 — 계산보다 우선합니다.<br />
              · 연 납입액 {fmtWon(kpi.loanAnnualPayment, hideAmounts)} {kpi.dsr !== null && <>· DSR {fmtPct(kpi.dsr, 1)} (연 수입 대비)</>}
            </div>
          </div>
        ) : tab === 'chart' ? (
          <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
            {/* 상단 요약 줄(결정 D6) — 첫 화면이 "이달 얼마 썼나"에 한 줄로 답한다. 값은 전부 반영값 함수에서만.
                ⚠️ '산출 불가'는 매트릭스와 **같은 규칙**(실패분만)이어야 한다 — 한 화면만 규칙이 갈리면
                   같은 달에 두 개의 '산출 불가'가 뜬다(`unresolvedFailures` 공유 규약).
                ⚠️ 근거 주석을 **JSX 속성 위치**에 두지 말 것(이 저장소 규약) — children 위치의 주석으로만. */}
            <div className="xl:col-span-2 bg-[#0f1623] border border-gray-800 rounded-lg px-3 py-2 flex items-baseline gap-x-3 gap-y-1 flex-wrap text-[11px]"
              title={`${month}월 반영 지출 = 실제 ${fmtWon(reflected.fromActual, hideAmounts)} + 계획 반영 ${fmtWon(reflected.fromPlan, hideAmounts)}`
                + (unresolvedFailures(reflected) > 0 ? ` · 산출 불가 ${unresolvedFailures(reflected)}건 제외(하한)` : '')}>
              <span className="text-gray-400">{month}월 {isFutureYm(ym) ? '예상' : '반영'} 지출</span>
              <span className={`text-[15px] font-bold tabular-nums ${isFutureYm(ym) ? 'text-gray-400 italic' : 'text-gray-100'}`}>
                {fmtWon(reflected.value, hideAmounts)}
              </span>
              <span className="text-gray-500">
                확인 {confirmed.confirmed}/{confirmed.target}
                {unresolvedFailures(reflected) > 0 ? <span className="text-amber-500"> · 산출 불가 {unresolvedFailures(reflected)}</span> : ''}
              </span>
              <span className="text-gray-500">
                전월 대비{' '}
                {mom.comparable && mom.delta !== null ? (
                  <span style={{ color: varianceTone(mom.delta) }}>
                    {varianceMark(mom.delta)} {fmtWon(Math.abs(mom.delta), hideAmounts)}{mom.rate !== null ? ` (${fmtSignedPct(mom.rate)})` : ''}
                  </span>
                ) : (
                  <span title={mom.reason === 'future' ? '오늘 이후의 달은 비교하지 않습니다'
                    : mom.reason === 'unresolved' ? '두 달의 산출 불가 항목이 달라 비교할 수 없습니다'
                      : '전달 또는 이달에 항목이 없습니다'}>-</span>
                )}
                {mom.comparable && mom.curUnconfirmed > 0 ? <span className="text-gray-600"> (계획 반영 {mom.curUnconfirmed}건 포함)</span> : ''}
                {mom.comparable && mom.unresolvedExcluded > 0 ? <span className="text-gray-600"> (산출 불가 {mom.unresolvedExcluded}건 제외)</span> : ''}
              </span>
            </div>

            {/* ① 월별 계획 vs 실제 */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-1">{year}년 월별 지출 — 계획 대비 반영값</div>
              {/* ⚠️ '수지 균형' 카드와 **같은 그리드·같은 분홍색**이다. 둘 다 반영값(실제 ?? 계획)이라
                  이제 **같은 기준**이지만, 두 카드가 서로를 가리키는 문장은 지우지 말고 그대로 둔다
                  (#G18m/#G18n — 규칙이 다시 갈리면 그 자리에서 고지해야 한다). */}
              <div className="text-[10px] text-gray-500 mb-2">
                막대 = 반영값(진하게 <b>확인</b>분 + 연하게 <b>계획 반영</b>분) · 회색 선 = 계획 · 오늘 이후 달은 막대 없음 · '수지 균형' 카드는 <b>실제 ?? 계획</b> 기준 — 이 카드와 같은 기준입니다
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={yearSeries} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (hideAmounts ? '' : fmtWonShort(v, false))} width={48} />
                    <RTooltip {...TOOLTIP_STYLE}
                      formatter={(v, n) => [fmtWon(v, hideAmounts), n]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {/* 스택 2단(§13.2.5) — 같은 hue, 계획 반영분만 알파 톤. 범례 라벨이 색과 항상 동반한다. */}
                    <Bar dataKey="confirmed" name="확인" stackId="reflected" fill={LEDGER_BALANCE_COLOR.expense} maxBarSize={22} />
                    <Bar dataKey="planned" name="계획 반영" stackId="reflected" fill={PLANNED_BAR_FILL} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Line type="monotone" dataKey="plan" name="계획" stroke="#94a3b8" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ② 전월 대비 증감 */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-1">전월 대비 증감 — 반영값 기준</div>
              <div className="text-[10px] text-gray-500 mb-2">
                <span style={{ color: LEDGER_DIVERGING.over }}>▲ 증가(초과)</span> · <span style={{ color: LEDGER_DIVERGING.under }}>▼ 감소(절약)</span>
                {' '}· 오늘 이후 달·산출 불가 항목이 다른 달은 <b>표시하지 않습니다</b> · 계획으로 반영된 건수는 막대 툴팁에
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={yearSeries} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (hideAmounts ? '' : fmtWonShort(v, false))} width={48} />
                    {/* 툴팁 = `전월 대비 ▲N · 계획 반영 M건 포함 (· 산출 불가 J건 제외)` — '0% 거짓말' 완화 ②(§13.6-2). */}
                    <RTooltip {...TOOLTIP_STYLE}
                      formatter={(v, n, entry) => {
                        const d = entry && entry.payload ? entry.payload : {};
                        const tail = (d.momPlanned > 0 ? ` · 계획 반영 ${d.momPlanned}건 포함` : '')
                          + (d.momExcluded > 0 ? ` · 산출 불가 ${d.momExcluded}건 제외` : '');
                        return [fmtWon(v, hideAmounts) + (d.momRate !== null && d.momRate !== undefined ? ` (${fmtSignedPct(d.momRate)})` : ''), `전월 대비${tail}`];
                      }} />
                    <ReferenceLine y={0} stroke="#4b5563" />
                    <Bar dataKey="momDelta" name="전월 대비" radius={[4, 4, 0, 0]} maxBarSize={22}>
                      {yearSeries.map((d, i) => (
                        <Cell key={i} fill={d.momDelta === null ? 'transparent' : (d.momDelta > 0 ? LEDGER_DIVERGING.over : LEDGER_DIVERGING.under)} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ③ 구분 도넛 (고정비는 결제수단으로 분리) */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[12px] font-semibold">{month}월 지출 구분</span>
                <span className="text-[9px] px-1 rounded bg-gray-800 text-gray-500">구분 축</span>
              </div>
              <div className="text-[10px] text-gray-500 mb-2">실제가 있으면 실제, 없으면 계획 기준 · 고정비는 결제수단으로 나눠 표시</div>
              {donut.rows.length === 0 ? (
                <div className="h-[240px] flex items-center justify-center text-[11px] text-gray-600">표시할 지출이 없습니다</div>
              ) : (
                <DonutWithList rows={donut.rows} sum={donut.sum} hideAmounts={hideAmounts} />
              )}
            </div>

            {/* ③-b 상세구분 도넛 */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[12px] font-semibold">{month}월 지출 상세구분</span>
                <span className="text-[9px] px-1 rounded bg-gray-800 text-gray-500">구분 축</span>
              </div>
              <div className="text-[10px] text-gray-500 mb-2">
                대출·연단위는 <b>항목별</b>, 고정비·변동비는 <b>구분별</b> · 색의 밝기가 같으면 같은 그룹입니다
              </div>
              {detailDonut.rows.length === 0 ? (
                <div className="h-[240px] flex items-center justify-center text-[11px] text-gray-600">표시할 지출이 없습니다</div>
              ) : (
                <DonutWithList rows={detailDonut.rows} sum={detailDonut.sum} hideAmounts={hideAmounts} />
              )}
              <div className="mt-2 text-[9px] text-gray-600">
                그룹당 {LEDGER_DETAIL_TOP_N + 1}건까지는 전부 이름을 표시하고, 그보다 많으면
                상위 {LEDGER_DETAIL_TOP_N}개만 표시하고 나머지를 '기타'로 묶습니다.
                고정비·변동비의 구분은 매트릭스 탭 아래 <b>구분 관리</b>에서 등록합니다.
              </div>
            </div>

            {/* ⑤ 결제수단별 지출 */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[12px] font-semibold">결제수단별 지출</span>
                <span className="text-[9px] px-1 rounded bg-gray-800 text-gray-500">결제수단 축</span>
              </div>
              <div className="text-[10px] text-gray-500 mb-2">
                실제가 있으면 실제, 없으면 계획 기준 · <b>대출은 기본이 '이체'</b>라 현금/카드 두 칸에는 들어가지 않습니다
              </div>

              {/* 그 달 구성비 100% 스트립 — 사용자 요청 "지출 1000이면 현금200 카드800" */}
              {payStrip.sum > 0 && (
                <div className="mb-3">
                  <div className="flex h-5 rounded overflow-hidden">
                    {payStrip.parts.map((p) => {
                      const pct = (p.value / payStrip.sum) * 100;
                      return (
                        <div key={p.key}
                          className="flex items-center justify-center text-[9px] font-semibold text-[#0b1120] overflow-hidden"
                          style={{ width: `${pct}%`, background: p.color }}
                          title={`${p.label} ${fmtWon(p.value, hideAmounts)} · ${pct.toFixed(1)}%`}>
                          {/* ⚠️ 세그먼트 안 직접 라벨 — 결제수단 색은 램프라 색만으로는 구분이
                              보장되지 않는다. 폭이 좁으면 글자가 잘리므로 툴팁이 짝이다. */}
                          {pct >= 12 ? `${p.label} ${Math.round(pct)}%` : ''}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {payStrip.parts.map((p) => (
                      <span key={p.key} className="inline-flex items-center gap-1 text-[10px] text-gray-300">
                        <span className="inline-block w-2 h-2 rounded-sm" style={{ background: p.color }} />
                        {p.label} {fmtWonShort(p.value, hideAmounts)}
                        <span className="text-gray-600">{Math.round((p.value / payStrip.sum) * 100)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 12개월 추이 */}
              <div style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  {/* ⚠️ 데이터는 `payChartData`(항목이 없던 달은 행 자체를 제외)다.
                      recharts는 stacked Bar에서 null을 **0으로 강제**하므로(getValueByDataKey의
                      기본값 0) '데이터 없음'을 null로 표현할 수 없고, 0 막대로 그리면
                      '그 달 지출 0원'이라는 거짓 단언이 된다. */}
                  <ComposedChart data={payChartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (hideAmounts ? '' : fmtWonShort(v, false))} width={48} />
                    <RTooltip {...TOOLTIP_STYLE} formatter={(v, n) => [fmtWon(v, hideAmounts), n]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {payKeys.map((p) => (
                      <Bar key={p} dataKey={`pay_${p}`} name={LEDGER_PAY_LABEL[p]} stackId="pay"
                        fill={ledgerPayColor(p)} maxBarSize={26} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {payChartData.length < MONTHS.length && (
                <div className="mt-1 text-[9px] text-gray-600">
                  항목이 하나도 없던 달 {MONTHS.length - payChartData.length}개는 막대를 그리지 않습니다(지출 0원이 아니라 '기록 대상 없음').
                </div>
              )}
              {/* ⚠️ 여기에 `totals.byPay` 기반 칩을 **다시 넣지 말 것.** 그 값은 결제수단 단위
                  `actual > 0 ? actual : plan`(전부-아니면-전무)이라 위 스트립(항목 단위
                  실제 ?? 계획)과 **같은 카드 안에서 같은 수단에 다른 금액**을 찍는다
                  (실측: 카드 580,000 vs 300,000). 스트립 아래 범례가 그 역할을 이미 한다. */}
              <div className="mt-2 border-t border-gray-800 pt-2 text-[9px] text-gray-600">
                헤더 '예상 月 지출'의 칩과 숫자가 다를 수 있습니다 — 저쪽은 <b>계획 기준</b>이고 연단위를 ÷12 해 매달 나눠 담습니다.
                이 카드는 <b>그 달 실제 ?? 계획</b> 기준이고 연단위는 납부월에 전액 들어갑니다.
              </div>
            </div>

            {/* ④ 수지 균형 */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-1">수지 균형</div>
              <div className="text-[10px] text-gray-500 mb-2">
                수입 − 지출 = <span style={{ color: LEDGER_DIVERGING.under }}>▲ 잉여금</span>
                {' / '}<span style={{ color: LEDGER_DIVERGING.over }}>▼ 부족분</span>
                {' · '}실제가 있으면 실제, 없으면 계획 기준
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={yearSeries} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (hideAmounts ? '' : fmtWonShort(v, false))} width={48} />
                    {/* ⚠️ null 값은 recharts `Tooltip.filterNull`(기본 true)이 payload에서 **먼저**
                        걸러내므로 이 formatter에 도달하지 않는다 — `v >= 0`이 `null >= 0=== true`로
                        새는 함정은 없다. 부호 분기를 이 함수 밖으로 옮기지 말 것. */}
                    <RTooltip {...TOOLTIP_STYLE}
                      formatter={(v, n) => (n === BALANCE_BAR_NAME
                        ? [fmtWon(Math.abs(v), hideAmounts), v >= 0 ? '잉여금' : '부족분']
                        : [fmtWon(v, hideAmounts), n])} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceLine y={0} stroke="#4b5563" />
                    <Bar dataKey="balIncome" name="수입" fill={LEDGER_BALANCE_COLOR.income} radius={[2, 2, 0, 0]} maxBarSize={14} />
                    <Bar dataKey="balExpense" name="지출" fill={LEDGER_BALANCE_COLOR.expense} radius={[2, 2, 0, 0]} maxBarSize={14} />
                    {/* ⚠️ `legendType="none"` — 범례 한 칸으로는 잉여금·부족분 두 색을 설명할 수
                        없다. 색-의미 매핑은 위 부제가 진다(차트 ② `momDelta` 선례와 같은 규약).
                        ⚠️ Cell 인덱스는 **데이터 인덱스**로 매칭된다(값이 없어 막대를 안 그린 달이
                        앞에 있어도 밀리지 않는다 — recharts 2.15.3 SSR로 실측 확인). */}
                    <Bar dataKey="balance" name={BALANCE_BAR_NAME} legendType="none" radius={[2, 2, 0, 0]} maxBarSize={14}>
                      {yearSeries.map((d, i) => (
                        <Cell key={i} fill={d.balance === null ? 'transparent'
                          : (d.balance >= 0 ? LEDGER_DIVERGING.under : LEDGER_DIVERGING.over)} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 border-t border-gray-800 pt-2 text-[9px] text-gray-600">
                헤더 '저축여력'과 숫자가 다를 수 있습니다 — 저쪽은 <b>계획 기준</b>이고 연단위를 ÷12 해
                매달 나눠 담습니다. 이 카드는 <b>그 달 실제 ?? 계획</b> 기준이고 연단위는 납부월에 전액 들어갑니다.
                수입·지출 중 한쪽이라도 항목이 없는 달은 막대를 그리지 않습니다.
                {balUnresolvedMonths > 0 && (
                  <> <span className="text-amber-500">
                    {balUnresolvedMonths}개월에 산출 불가 항목(예: 잔액 기준월이 빈 대출)이 있어 막대에서 빠져 있습니다 — 실제 지출은 더 클 수 있습니다.
                  </span></>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ── 연간 탭 ── */
          <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-1">연도별 지출 — 전년 대비</div>
              <div className="text-[10px] text-gray-500 mb-2">
                반영값(실제 ?? 계획) 기준 · 올해는 <b>{todayYm ? `${Number(todayYm.slice(5, 7))}월` : '오늘'}까지</b>만 더합니다(계획도 같은 구간) · 항목이 없는 해는 표시되지 않습니다.
              </div>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={annualCompare.filter((r) => r.any)} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (hideAmounts ? '' : fmtWonShort(v, false))} width={52} />
                    <RTooltip {...TOOLTIP_STYLE}
                      formatter={(v, n) => [fmtWon(v, hideAmounts), n]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="reflected" name="반영" fill={LEDGER_BALANCE_COLOR.expense} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Line type="monotone" dataKey="plan" name="계획" stroke="#94a3b8" strokeWidth={2} dot />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-[11px]">
                전년 동월({month}월) 대비(반영값):{' '}
                {yoy.comparable && yoy.delta !== null ? (
                  <span style={{ color: varianceTone(yoy.delta) }}>
                    {varianceMark(yoy.delta)} {fmtWon(Math.abs(yoy.delta), hideAmounts)}{yoy.rate !== null ? ` (${fmtSignedPct(yoy.rate)})` : ''}
                    {yoy.curUnconfirmed > 0 && <span className="text-gray-600"> · 계획 반영 {yoy.curUnconfirmed}건 포함</span>}
                    {yoy.unresolvedExcluded > 0 && <span className="text-gray-600"> · 산출 불가 {yoy.unresolvedExcluded}건 제외</span>}
                  </span>
                ) : (
                  <span className="text-gray-500" title={yoy.reason === 'future' ? '오늘 이후의 달은 비교하지 않습니다'
                    : yoy.reason === 'unresolved' ? '두 달의 산출 불가 항목이 달라 비교할 수 없습니다'
                      : '전년 동월 또는 이달에 항목이 없습니다'}>-</span>
                )}
              </div>
            </div>

            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-2">연단위 지출 일정 ({year}년)</div>
              {(grouped.annual || []).length === 0 ? (
                <div className="text-[11px] text-gray-600">연단위 지출 항목이 없습니다.</div>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-gray-400">
                      <th className={`${cellBase} text-left`}>납부 예정</th>
                      <th className={`${cellBase} text-left`}>항목</th>
                      <th className={`${cellBase} text-center`}>결제</th>
                      <th className={`${cellBase} text-right`}>계획</th>
                      <th className={`${cellBase} text-right`}>실제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(grouped.annual || [])
                      .slice()
                      .sort((a, b) => (a.dueMonth ?? 99) - (b.dueMonth ?? 99) || (a.dueDay ?? 99) - (b.dueDay ?? 99))
                      .map((it) => {
                        const k = it.dueMonth ? makeYm(year, it.dueMonth) : '';
                        const a = k ? actualOf(it, k) : null;
                        return (
                          <tr key={it.id} className="hover:bg-gray-800/30">
                            <td className={`${cellBase}`}>
                              {it.dueMonth ? `${it.dueMonth}월 ${it.dueDay || 1}일` : <span className="text-amber-400" title="납부월을 지정해야 달력에 표시되고 그 달에 계상됩니다">미지정</span>}
                            </td>
                            <td className={`${cellBase}`}>{it.name || '(이름 없음)'}</td>
                            <td className={`${cellBase} text-center text-gray-400`}>{LEDGER_PAY_LABEL[it.pay]}</td>
                            <td className={`${cellBase} text-right`}>{fmtWon(it.plan, hideAmounts)}</td>
                            <td className={`${cellBase} text-right`}>{a === null ? <span className="text-gray-600">-</span> : fmtWon(a, hideAmounts)}</td>
                          </tr>
                        );
                      })}
                    <tr className="bg-gray-800/50 font-semibold">
                      <td className={`${cellBase}`} colSpan={3}>년단위 합계</td>
                      <td className={`${cellBase} text-right`}>{fmtWon(kpi.annualLumpSum, hideAmounts)}</td>
                      <td className={`${cellBase}`}></td>
                    </tr>
                  </tbody>
                </table>
              )}
              <div className="mt-2 text-[10px] text-gray-600">
                납부 예정일이 지정된 항목은 <b>메모 달력의 해당 날짜</b>에 항목명·금액이 표시됩니다.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 수동 값 ↔ 거래 충돌 안내 (§5.3.2) ──
          ⚠️ 모달이 아니라 **인라인**이다 — 이 화면은 z-1090이고 별도 창에는 App조차 없어
             ConfirmDialog·토스트가 뜨지 않는다. 그리고 추가를 막지 않으므로 입력 흐름도 끊기지 않는다. */}
      {showSnapshots && (
        <SnapshotModal
          snapshots={snapshots}
          readOnly={readOnly}
          hideAmounts={hideAmounts}
          canSave={!!onUpdateSnapshots}
          onSave={saveSnapshot}
          onRestore={restoreSnapshot}
          onRemove={removeSnapshot}
          onClose={() => setShowSnapshots(false)}
        />
      )}
    </div>
  );
}

/**
 * 이전 기록(스냅샷) 목록 — 저장 / 복원 / 삭제.
 *
 * ⚠️ 확인창은 **인라인 2단계**다(`DeleteBtn`과 같은 근거). 이 화면은 z-1090이고 별도 창에는
 *    App조차 마운트되지 않아 `ConfirmDialog`(z-1000)도 알림 토스트도 뜨지 않는다.
 * ⚠️ 복원은 파괴적이라 **2단계 확인 필수** — 대신 `restoreSnapshot`이 복원 직전에 현재 상태를
 *    자동 스냅샷으로 남기므로 잘못 눌러도 되돌릴 수 있다.
 * ⚠️ 금액은 `hideAmounts`를 통과시키지 않는다 — 이 목록은 **건수만** 보여 준다(금액 표시 0곳).
 */
function SnapshotModal({ snapshots, readOnly, canSave, onSave, onRestore, onRemove, onClose }) {
  const [label, setLabel] = useState('');
  const [armed, setArmed] = useState('');      // 복원 2단계
  const [armedDel, setArmedDel] = useState(''); // 삭제 2단계
  const list = Array.isArray(snapshots) ? snapshots : [];
  const fmtWhen = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return '시각 미상';
    try { return new Date(ms).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return '시각 미상'; }
  };
  return (
    <div className="fixed inset-0 z-[1095] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[#0f1623] border border-gray-700 rounded-lg w-full max-w-[560px] max-h-[80vh] flex flex-col"
        onKeyDownCapture={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
          <span className="text-[12px] font-bold text-gray-200">이전 기록</span>
          <span className="text-[10px] text-gray-500">{list.length} / {MAX_LEDGER_SNAPSHOTS}</span>
          <div className="flex-1" />
          <button className="text-[13px] px-2 text-gray-400 hover:bg-gray-800 rounded" onClick={onClose}>✕</button>
        </div>

        {!readOnly && canSave && (
          <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800">
            <input
              type="text"
              className="flex-1 min-w-0 bg-gray-800/70 rounded px-2 py-1 text-[11px] outline-none focus:bg-gray-800"
              placeholder="메모(선택) — 예: 8월 정리 끝"
              maxLength={MAX_LEDGER_SNAPSHOT_LABEL_LEN}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { if (onSave(label)) setLabel(''); } }}
            />
            <button className="text-[11px] px-2 py-1 rounded bg-emerald-900/60 text-emerald-200 hover:bg-emerald-900 shrink-0"
              onClick={() => { if (onSave(label)) setLabel(''); }}>💾 지금 저장</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {list.length === 0 ? (
            <div className="p-4 text-[11px] text-gray-500 leading-relaxed">
              저장된 기록이 없습니다.<br />
              위 <b>지금 저장</b>을 누르면 현재 장부가 이 목록에 남고, 나중에 그 시점으로 되돌릴 수 있습니다.
              최대 {MAX_LEDGER_SNAPSHOTS}개까지 보관하며 오래된 것부터 밀려납니다.
            </div>
          ) : list.map((s) => {
            const sum = ledgerSnapshotSummary(s);
            return (
              <div key={s.id} className="border border-gray-800 rounded px-2 py-1.5 mb-1.5 bg-[#0b1120]">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-200">{fmtWhen(s.savedAt)}</span>
                  {s.auto && <span className="text-[9px] px-1 rounded bg-gray-800 text-gray-400" title="복원 직전에 자동으로 남긴 되돌리기 지점입니다">자동</span>}
                  {/* ⚠️ 거래는 스냅샷에 담기지 않는다(512KB 예산) — 그 사실을 화면이 반드시 말해야
                      복원한 사용자가 "거래가 안 돌아왔다"로 오해하지 않는다. `shrink-0` 필수(옆 label이 truncate). */}
                  {s.label && <span className="text-[10px] text-gray-400 truncate">{s.label}</span>}
                  <div className="flex-1" />
                  {!readOnly && (armed === s.id ? (
                    <span className="inline-flex gap-1">
                      <button className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/70 text-amber-100 hover:bg-amber-800"
                        onClick={() => { setArmed(''); onRestore(s.id); }}>되돌리기</button>
                      <button className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
                        onClick={() => setArmed('')}>취소</button>
                    </span>
                  ) : (
                    <button className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
                      title="이 시점으로 되돌립니다 — 지금 상태는 자동으로 한 번 더 저장됩니다"
                      onClick={() => { setArmedDel(''); setArmed(s.id); }}>복원</button>
                  ))}
                  {!readOnly && canSave && (armedDel === s.id ? (
                    <span className="inline-flex gap-1">
                      <button className="text-[10px] px-1 rounded bg-rose-900/60 text-rose-200 hover:bg-rose-800"
                        onClick={() => { setArmedDel(''); onRemove(s.id); }}>삭제</button>
                      <button className="text-[10px] px-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
                        onClick={() => setArmedDel('')}>취소</button>
                    </span>
                  ) : (
                    <button className="text-[11px] text-gray-600 hover:text-rose-300 px-1" title="이 기록 삭제"
                      onClick={() => { setArmed(''); setArmedDel(s.id); }}>×</button>
                  ))}
                </div>
                {armed === s.id && (
                  <div className="text-[9px] text-amber-300/90 mt-0.5 leading-relaxed">
                    이 시점의 계획·항목·실제 입력으로 되돌립니다. <b>거래는 그대로 유지됩니다</b>(휴지통이 안전망).
                  </div>
                )}
                <div className="text-[9px] text-gray-500 mt-0.5">
                  장부 {sum.books} · 항목 {sum.items}건 · 실제 입력 {sum.actuals}칸 · 정리한 달 {sum.months}개
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-3 py-2 border-t border-gray-800 text-[9px] text-gray-600 leading-relaxed">
          · 이 기록은 계좌 백업과 <b>별개</b>입니다 — 가계부만 되돌립니다.<br />
          · <b>복원해도 지금 상태가 자동으로 한 번 더 저장</b>되므로, 잘못 눌러도 바로 위 '자동' 기록으로 되돌아갈 수 있습니다.<br />
          · 보관은 최대 {MAX_LEDGER_SNAPSHOTS}개이고, 자리가 모자라면 <b>자동 기록부터</b> 밀려납니다(직접 저장한 것이 오래 남습니다).<br />
          · <b>거래는 이 기록에 포함되지 않습니다</b> — 복원해도 그대로 유지되고, 삭제한 거래는 휴지통에서 되살립니다.
        </div>
      </div>
    </div>
  );
}

/**
 * 도넛 + 옆 목록 — 메인/상세 도넛이 **공유**한다(손복제 금지).
 *
 * ⚠️ 바깥 라벨(`label` + `labelLine`)로 되돌리지 말 것. 220px 높이에 4슬롯이 겨우 버티던
 *    구성인데 고정비 분리·상세 구분으로 슬롯이 최대 8~20개가 된다 — 라벨선 끝점이 서로
 *    충돌해 **CVD 대역에서 유일한 보조 부호인 직접 라벨이 실질적으로 무력화**된다.
 *    대신 조각마다 옆 목록에 색칩 + 이름 + 금액 + %를 두고, 큰 조각에만 안쪽 %를 얹는다.
 * ⚠️ 목록은 도넛과 **같은 순서**(recharts는 data 순서대로 시계방향으로 그린다)라
 *    조각↔행 대응이 위치로 복원된다.
 */
function DonutWithList({ rows, sum, hideAmounts }) {
  const pct = (v) => (sum > 0 ? (v / sum) * 100 : 0);
  return (
    <div className="flex gap-2 items-center">
      <div className="shrink-0" style={{ width: 190, height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius={54} outerRadius={88}
              paddingAngle={2} stroke="#0f1623" strokeWidth={2} isAnimationActive={false}
              labelLine={false}
              label={({ value, cx, cy, midAngle, innerRadius, outerRadius }) => {
                const p = pct(value);
                if (p < 8) return null;   // 좁은 조각은 안쪽 라벨이 안 들어간다 — 옆 목록이 받는다
                const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                const rad = (-midAngle * Math.PI) / 180;
                return (
                  <text x={cx + r * Math.cos(rad)} y={cy + r * Math.sin(rad)}
                    fill="#0b1120" fontSize={10} fontWeight={700}
                    textAnchor="middle" dominantBaseline="central">{Math.round(p)}%</text>
                );
              }}>
              {rows.map((r) => <Cell key={r.key} fill={r.color} />)}
            </Pie>
            <RTooltip {...TOOLTIP_STYLE} formatter={(v, n) => [fmtWon(v, hideAmounts), n]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 min-w-0 max-h-[240px] overflow-y-auto pr-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-1.5 text-[10px] py-0.5 border-b border-gray-800/50 last:border-0"
            title={`${r.name} ${fmtWon(r.value, hideAmounts)} · ${pct(r.value).toFixed(1)}%`}>
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: r.color }} />
            <span className="text-gray-300 truncate flex-1 min-w-0">{r.name}</span>
            <span className="text-gray-400 shrink-0 tabular-nums">{fmtWonShort(r.value, hideAmounts)}</span>
            <span className="text-gray-600 shrink-0 tabular-nums w-8 text-right">{Math.round(pct(r.value))}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 지출 구분(카테고리) 프리셋 관리 — 매트릭스 표 아래 접이식 패널.
 * ⚠️ 삭제해도 항목의 `category`는 지우지 않는다(그 값은 선택 목록에 계속 남는다) —
 *    undo가 없는 화면에서 오클릭 한 번으로 여러 행의 구분이 사라지면 안 된다.
 */
function CategoryManager({ registry, inUse, items, onAdd, onRemove, readOnly }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const countOf = (c) => items.filter((it) => it && it.category === c).length;
  // 레지스트리에 없는데 실제로 쓰이는 값 — '등록되지 않은 구분'으로 보여 준다.
  const orphans = inUse.filter((c) => !registry.includes(c));
  return (
    <div className="mt-2 border border-gray-800 rounded-lg bg-[#0f1623]">
      <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
        onClick={() => setOpen((o) => !o)}>
        <span className="text-[11px] text-gray-300">{open ? '▾' : '▸'} 구분 관리</span>
        <span className="text-[10px] text-gray-600">{registry.length}개 등록</span>
        {orphans.length > 0 && (
          <span className="text-[9px] px-1 rounded bg-gray-800 text-gray-400" title="항목에는 쓰이는데 목록에 없는 값입니다">
            미등록 {orphans.length}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-2">
          {!readOnly && (
            <div className="flex items-center gap-1 mb-2">
              <input
                type="text"
                className="bg-gray-800/70 rounded px-2 py-0.5 text-[11px] outline-none focus:bg-gray-800 w-40"
                placeholder="예: 구독"
                maxLength={MAX_LEDGER_CATEGORY_LEN}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { if (onAdd(draft)) setDraft(''); } }}
              />
              <button className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
                onClick={() => { if (onAdd(draft)) setDraft(''); }}>+ 등록</button>
              <span className="text-[9px] text-gray-600">최대 {MAX_LEDGER_CATEGORIES}개 · {MAX_LEDGER_CATEGORY_LEN}자</span>
            </div>
          )}
          {registry.length === 0 && orphans.length === 0 ? (
            <div className="text-[10px] text-gray-600">
              등록된 구분이 없습니다. 예: <b>구독</b>·<b>통신</b>·<b>보험</b>·<b>교통</b> — 등록하면 각 항목의 '구분' 칸에서 고를 수 있습니다.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {registry.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                  {c}<span className="text-gray-600">{countOf(c)}</span>
                  {!readOnly && (
                    <button className="text-gray-600 hover:text-rose-300"
                      title="목록에서 제거 — 이미 이 구분을 쓰는 항목의 값은 그대로 남습니다"
                      onClick={() => onRemove(c)}>×</button>
                  )}
                </span>
              ))}
              {orphans.map((c) => (
                <span key={`o-${c}`} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-900 text-gray-500 border border-gray-800"
                  title="항목에는 쓰이는데 목록에 없습니다 — 등록하면 다른 항목에서도 고를 수 있습니다">
                  {c}<span className="text-gray-700">{countOf(c)}</span>
                  {!readOnly && (
                    <button className="text-gray-600 hover:text-emerald-300" title="목록에 등록" onClick={() => onAdd(c)}>+</button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
