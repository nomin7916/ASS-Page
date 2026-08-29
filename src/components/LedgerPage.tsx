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
  makeYm, addMonthsYm, isValidYm, roundWon, finiteOr,
} from '../ledger';
import {
  loanSchedule, loanNext12Total, planOf, actualOf, varianceOf, commitActual, isItemActive, expectsActual,
  monthTotals, ledgerKpi, momDelta, yoyDelta, ledgerFingerprint,
} from '../ledger';
import {
  expectedOf, expectedTotal, expectedIncomeTotal, expectedByPay, monthState, projectedByPay,
  moveItemInGroup, canMoveItemInGroup, ledgerCategories, ledgerRamp, ledgerPayColor,
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

const cellBase = 'px-2 py-1 text-[11px] border-b border-gray-800/70';
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
function NumCell({ value, onCommit, readOnly, align = 'right', placeholder = '', title, col }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null
    ? draft
    : (value === null || value === undefined || !Number.isFinite(value) ? '' : String(Math.round(value)));
  return (
    <input
      type="text"
      inputMode="numeric"
      data-col={col}
      className={inputCls}
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
  const [tab, setTab] = useState('matrix');
  const [collapsed, setCollapsed] = useState({});
  const [hiddenMonths, setHiddenMonths] = useState([]);
  const [armedDelete, setArmedDelete] = useState('');
  const [flash, setFlash] = useState('');
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
  const mom = useMemo(() => momDelta(book, ym), [book, ym]);
  const yoy = useMemo(() => yoyDelta(book, ym), [book, ym]);

  /**
   * 그 해 12개월의 계획/실제 — 차트 4종이 공유한다.
   * ⚠️ 결제수단 시리즈를 **별도 memo로 12회 더 돌리지 말 것** — `monthTotals`는 항목 전체를
   *    순회하고 `planOf`가 `loanSchedule`을 부른다. 여기 필드를 얹는 것이 훨씬 싸다.
   */
  const yearSeries = useMemo(() => MONTHS.map((m) => {
    const k = makeYm(year, m);
    const t = monthTotals(book, k);
    const c = momDelta(book, k);
    const e = expectedTotal(book?.items, k);
    const bp = expectedByPay(book?.items, k);
    const row = {
      m, ym: k, label: `${m}월`,
      plan: t.planExpense, actual: t.actualExpense,
      income: t.actualIncome || t.planIncome,
      missing: t.missingExpense,
      // ⚠️ comparable=false면 숫자를 내지 않는다(진행 중인 달은 항상 미입력이 많다).
      momDelta: c.comparable ? c.delta : null,
      hasActual: t.missingExpense < t.activeExpense,
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
  }), [book, year]);

  /**
   * 결제수단 막대 데이터 — 항목이 하나도 없던 달은 **행을 뺀다**(0 막대로 그리면
   * '그 달 지출 0원'이라는 거짓 단언이 된다).
   */
  const payChartData = useMemo(() => yearSeries.filter((r) => r.state !== 'none'), [yearSeries]);
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
   * ⚠️ 그룹당 조각은 `LEDGER_DETAIL_TOP_N`개 + '기타' = 최대 5개다. 램프가 6슬롯부터
   *    인접 ΔE 4 아래로 떨어지기 때문(팔레트 §2 실측). 접지 않고 늘리지 말 것.
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
      const head = sorted.slice(0, LEDGER_DETAIL_TOP_N);
      const tail = sorted.slice(LEDGER_DETAIL_TOP_N);
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

  /** 연간 비교 — 사용자가 명시적으로 요구한 '전년대비'. */
  const annualCompare = useMemo(() => yearsAvailable.map((y) => {
    let plan = 0, actual = 0, any = false;
    for (const m of MONTHS) {
      const t = monthTotals(book, makeYm(y, m));
      plan += t.planExpense; actual += t.actualExpense;
      if (t.missingExpense < t.activeExpense) any = true;
    }
    return { year: y, label: `${y}`, plan, actual, any };
  }), [book, yearsAvailable]);

  const visibleMonths = useMemo(() => MONTHS.filter((m) => !hiddenMonths.includes(m)), [hiddenMonths]);

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
    if (local.length === 0) {
      // ⚠️ **`setLocal`을 쓰지 말 것** — dirty가 서면 위 채택 effect가 조기 반환하므로, 앱 탭이
      //    새로고침 중일 때 뒤늦게 도착한 **저장된 장부가 영영 채택되지 않고** 2.5초 뒤 승격이
      //    그 장부를 빈 장부 1권으로 덮어쓴다(FlowBoard가 명시적으로 막아 둔 경로).
      //    화면을 띄우기 위한 자리 표시일 뿐이므로 로컬 사본만 갱신하고 승격 대상으로 삼지 않는다.
      const seed = [makeLedgerBook({ name: '가계부', createdAt: Date.now() })];
      localRef.current = seed;
      setLocalState(seed);
    }
    else if (bookIdx >= local.length) setBookIdx(0);
  }, [local.length, bookIdx, readOnly, setLocal]);

  /* ── 항목 추가 ─────────────────────────────────────────────────────────── */
  const addItem = (group) => {
    if (!book || readOnly) return;
    if ((book.items || []).length >= MAX_LEDGER_ITEMS) { doFlash(`항목은 최대 ${MAX_LEDGER_ITEMS}개입니다`); return; }
    const base = { group, createdAt: Date.now(), activeFrom: ym };
    if (group === 'loan') base.loan = makeLedgerLoan({ principalAsOfYm: ym });
    if (group === 'loan') base.pay = 'transfer';
    if (group === 'annual') { base.pay = 'cash'; base.dueMonth = month; base.dueDay = 1; }
    if (group === 'income') base.pay = 'transfer';
    patchBook(book.id, (b) => ({ ...b, items: [...(b.items || []), makeLedgerItem(base)] }));
    setCollapsed((c) => ({ ...c, [group]: false }));
  };

  const removeItem = (itemId) => {
    if (!book || readOnly) return;
    patchBook(book.id, (b) => ({ ...b, items: (b.items || []).filter((it) => it.id !== itemId) }));
    setArmedDelete('');
  };

  /**
   * 그룹 안에서 항목 순서 이동.
   * ⚠️ 순서는 `items` 배열 자체를 재정렬해 표현한다 — `ledgerFingerprint`가 항목을 배열 순서
   *    그대로 투영하므로 **영속화 신규 지점이 0곳**이다(`order` 필드를 만들면 정규화·`same`
   *    비교·지문·`makeLedgerItem` 4곳 등록이 필요하고 하나만 빠져도 조용히 유실된다).
   * ⚠️ 이동할 수 없으면 `moveItemInGroup`이 원본 참조를 돌려주고 `patchBook`이 no-op으로
   *    끝난다 → dirty가 서지 않아 헛된 Drive 저장이 없다.
   */
  const moveItem = (itemId, dir) => {
    if (!book || readOnly) return;
    patchBook(book.id, (b) => {
      const items = moveItemInGroup(b.items, itemId, dir);
      return items === b.items ? b : { ...b, items };
    });
  };

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
    let yearActual = 0, yearPlan = 0, yearMissing = 0;
    for (const m of MONTHS) {
      const k = makeYm(year, m);
      const a = actualOf(it, k);
      const p = planOf(it, k);
      // ⚠️ `isItemActive`가 아니라 `expectsActual` — annual의 비납부월은 미입력이 아니다.
      //    아니면 연단위 항목의 연간 차이 열이 11개월 미입력 때문에 영구히 '-'가 된다.
      if (a !== null) yearActual += a; else if (expectsActual(it, k)) yearMissing++;
      if (p !== null) yearPlan += p;
    }
    const yearVar = yearMissing === 0 ? yearActual - yearPlan : null;

    return (
      <tr key={it.id} className={`${rowTone} hover:bg-gray-800/30`}>
        <td className={`${cellBase} sticky left-0 z-[2] bg-[#0b1120]`} style={{ minWidth: 62 }}>
          {readOnly ? (
            <span className="text-[10px] text-gray-400">{LEDGER_PAY_LABEL[it.pay]}</span>
          ) : (
            <select
              className="bg-transparent text-[10px] text-gray-300 outline-none"
              value={it.pay}
              onChange={(e) => patchItem(book.id, it.id, (x) => ({ ...x, pay: e.target.value }))}
            >
              {Object.entries(LEDGER_PAY_LABEL).map(([k, v]) => <option key={k} value={k} className="bg-[#0f1623]">{v}</option>)}
            </select>
          )}
        </td>
        <td className={`${cellBase} sticky z-[2] bg-[#0b1120]`} style={{ left: LEFT_NAME, minWidth: COL_NAME }}>
          <div className="flex items-center gap-1">
            <MoveBtns
              readOnly={readOnly}
              canUp={canMoveItemInGroup(book.items, it.id, -1)}
              canDown={canMoveItemInGroup(book.items, it.id, 1)}
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
        <td className={`${cellBase} sticky z-[2] bg-[#0b1120] text-right`} style={{ left: LEFT_PLAN, minWidth: 96 }}>
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

        {visibleMonths.map((m) => {
          const k = makeYm(year, m);
          const active = isItemActive(it, k);
          const a = actualOf(it, k);
          const p = planOf(it, k);
          const v = varianceOf(it, k);
          return (
            <td key={m} className={`${cellBase} text-right ${!active ? 'bg-gray-900/40' : ''}`} style={{ minWidth: 84 }}>
              {!active ? (
                <span className="text-[10px] text-gray-700" title="이 달에는 없던 항목입니다">-</span>
              ) : (
                <>
                  <NumCell
                    col={`m${m}`}
                    value={a}
                    readOnly={readOnly}
                    placeholder={p === null ? '' : String(Math.round(p))}
                    title={`계획 ${p === null ? '-' : Math.round(p).toLocaleString()} · 비우면 미입력`}
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

        <td className={`${cellBase} text-right text-gray-300`} style={{ minWidth: 100 }}>
          {fmtWon(yearActual, hideAmounts)}
          <div className="text-[9px] text-gray-600">계획 {fmtWon(yearPlan, hideAmounts)}</div>
        </td>
        <td className={`${cellBase} text-right`} style={{ minWidth: 96 }}>
          {yearVar === null ? (
            <span className="text-gray-600" title={`미입력 ${yearMissing}개월 — 비교할 수 없습니다`}>-</span>
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
   * 소계 행 하나(그룹 소계 또는 그 안의 결제수단 소계).
   *
   * ⚠️ **월 셀은 `expectedTotal(...).value`(실제 ?? 계획)다.** 사용자가 계획만 입력해도
   *    소계가 나와야 한다는 요청이 이 행의 존재 이유다. 대신 계획으로 채운 건수를 반드시
   *    함께 노출해 실적으로 오독되지 않게 한다.
   * ⚠️ 이 값을 `monthTotals.actualExpense`/`compareMonths`/`yearSeries.actual`/
   *    `annualCompare`/`ledgerEventsByDate`로 **되돌려 보내지 말 것** — 그 순간 전월 대비가
   *    영구히 거짓말을 시작한다(ledger.ts G-2 절 참조).
   * ⚠️ '계획' 열은 `planSum`(활성 항목 전체의 계획)이지 `fromPlan`(실적 없는 항목의 계획)이
   *    아니다. 후자를 쓰면 **사용자가 실적을 채울수록 계획 열이 0으로 수렴**해, 예상값을
   *    검산할 유일한 기준선이 조용히 사라진다(실측 547,000 → 17,000).
   */
  const renderSubtotalRow = ({ key, label, color, items, indent = false, income = false }) => {
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
    for (const m of MONTHS) {
      const e = totalOf(items, makeYm(year, m));
      yearExpected += e.value; yearPlan += e.planSum; yearActual += e.fromActual;
      yearUnresolved += e.unresolved;
      yearPlanned += e.plannedCount;
    }
    const cur = totalOf(items, ym);
    return (
      <tr key={key} className={indent ? 'bg-gray-800/25' : 'bg-gray-800/50 font-semibold'}>
        <td className={`${cellBase} sticky left-0 z-[2] ${indent ? 'bg-[#131a27]' : 'bg-[#151b28]'}`} colSpan={2}>
          <span className={`text-[11px] ${indent ? 'pl-3' : ''}`} style={{ color }}>
            {indent ? '└ ' : ''}{label}
          </span>
          {cur.plannedCount > 0 && (
            // ⚠️ 배지 조건은 **선택한 달 하나**다. '보이는 달 중 하나라도'로 재면 미래 달이
            //    구조적으로 항상 계획-only라 배지가 1~11월 내내 켜져 신호가 0이 된다.
            <span className="ml-1.5 text-[9px] px-1 rounded bg-gray-700/70 text-gray-300"
              title={`${month}월 소계에 계획으로 채운 항목이 ${cur.plannedCount}건 있습니다 (실적 ${cur.actualCount}건)`}>
              계획 {cur.plannedCount}
            </span>
          )}
        </td>
        <td className={`${cellBase} sticky z-[2] ${indent ? 'bg-[#131a27]' : 'bg-[#151b28]'} text-right text-[11px]`} style={{ left: LEFT_PLAN }}>
          {fmtWon(cur.planSum, hideAmounts)}
        </td>
        {monthly.map(({ m, e, state }) => {
          /**
           * ⚠️ **산출된 항목이 하나도 없으면 `0`이 아니라 `-`다.** `unresolved`(실제도 계획도
           *    못 구함 — 예: `principalAsOfYm`이 빈 대출)를 0으로 계상하면 화면이 '납입 ₩0'을
           *    **확정 단언**한다. 구버전 규칙(`mm > 0 && ma === 0` → `-`)이 막던 것이고,
           *    `loanSchedule`의 null 계약("계산 실패는 0이 아니다")과 정면으로 어긋난다.
           */
          const resolved = e.actualCount + e.plannedCount;
          return (
            <td key={m} className={`${cellBase} text-right text-[11px]`}
              title={state === 'none' ? '이 달에는 항목이 없습니다'
                : `실제 ${fmtWon(e.fromActual, hideAmounts)} (${e.actualCount}건) + 계획 ${fmtWon(e.fromPlan, hideAmounts)} (${e.plannedCount}건)`
                  + (e.unresolved > 0 ? ` · 산출 불가 ${e.unresolved}건(합계에서 빠짐)` : '')}>
              {state === 'none' ? <span className="text-gray-700" >-</span>
                : resolved === 0 ? <span className="text-gray-600">-</span> : (
                  <>
                    {fmtWonShort(e.value, hideAmounts)}
                    {e.plannedCount > 0 && (
                      <div className="text-[9px] leading-tight" style={{ color: LEDGER_DIVERGING.flat }}>계획 {e.plannedCount}</div>
                    )}
                    {/* ⚠️ 산출 불가가 섞이면 이 값은 총액이 아니라 **하한**이다 — 반드시 알린다. */}
                    {e.unresolved > 0 && (
                      <div className="text-[9px] leading-tight" style={{ color: LEDGER_DIVERGING.over }}>?{e.unresolved}</div>
                    )}
                  </>
                )}
            </td>
          );
        })}
        <td className={`${cellBase} text-right text-[11px]`}
          title={`실제 ${fmtWon(yearActual, hideAmounts)} + 계획 ${fmtWon(yearExpected - yearActual, hideAmounts)}`
            + (yearUnresolved > 0 ? ` · 산출 불가 ${yearUnresolved}건이 빠진 하한입니다` : '')}>
          {fmtWon(yearExpected, hideAmounts)}
          <div className="text-[9px] text-gray-600">계획 {fmtWon(yearPlan, hideAmounts)}</div>
        </td>
        <td className={`${cellBase} text-right text-[10px] text-gray-500`}>
          {/* ⚠️ unresolved도 확정 불가 사유다 — yearPlanned만 보면 산출 실패가 '차이 ₩0'으로 단언된다. */}
          {yearPlanned > 0 || yearUnresolved > 0
            ? (
              <span title={`계획으로 채운 ${yearPlanned}건${yearUnresolved > 0 ? ` · 산출 불가 ${yearUnresolved}건` : ''}이 있어 계획 대비 차이를 확정할 수 없습니다`}>
                {yearUnresolved > 0 ? `산출불가 ${yearUnresolved}` : `계획 ${yearPlanned}`}
              </span>
            )
            : fmtWon(yearActual - yearPlan, hideAmounts)}
        </td>
      </tr>
    );
  };

  /**
   * 그룹 소계 블록 — 결제수단 소계 행 + 그룹 소계 행.
   *
   * ⚠️ 결제수단 행은 **그 그룹에 2종 이상 있을 때만**. 하나뿐이면 노이즈라 라벨에만 표기한다
   *    (대출은 전부 '이체'라 자동으로 사라진다). 그룹별 화이트리스트를 만들지 말 것.
   * ⚠️ **불변식: Σ(결제수단 행) === 그룹 소계 행.** 손상 데이터의 미지 결제수단은
   *    `normalizeLedgerBooks`가 'card'로 강제하므로 이 등식이 구조적으로 성립한다.
   *    수단을 하드코딩(현금/카드만)하면 `pay:'auto'`인 항목이 **어느 행에도 없이 사라진다**.
   */
  const renderGroupSubtotal = (g, items) => {
    const rows = [];
    if (g !== 'income') {
      const present = LEDGER_PAY_ORDER.filter((p) => items.some((it) => it && it.pay === p));
      if (present.length > 1) {
        for (const p of present) {
          rows.push(renderSubtotalRow({
            key: `sub-${g}-${p}`,
            label: `${LEDGER_PAY_LABEL[p]} 소계`,
            color: ledgerPayColor(p),
            items: items.filter((it) => it && it.pay === p),
            indent: true,
          }));
        }
      }
      rows.push(renderSubtotalRow({
        key: `sub-${g}`,
        label: present.length === 1
          ? `${LEDGER_GROUP_LABEL[g]} 합계 · 전액 ${LEDGER_PAY_LABEL[present[0]]}`
          : `${LEDGER_GROUP_LABEL[g]} 합계`,
        color: LEDGER_GROUP_COLOR[g],
        items,
      }));
    } else {
      rows.push(renderSubtotalRow({
        key: `sub-${g}`, label: `${LEDGER_GROUP_LABEL[g]} 합계`,
        color: LEDGER_GROUP_COLOR[g], items,
        income: true,   // ⚠️ 없으면 지출 전용 집계를 타서 수입 소계가 통째로 죽는다
      }));
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

        {(totals.missingExpense > 0 || kpi.loanUnresolved > 0) && (
          <div className="px-3 pb-2 flex gap-2 flex-wrap text-[10px]">
            {totals.missingExpense > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                {month}월 실제 미입력 {totals.missingExpense}건 — 합계·증감에서 제외됩니다
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
          {[['matrix', '월 매트릭스'], ['loan', '대출'], ['chart', '분석'], ['annual', '연간']].map(([k, label]) => (
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
            {hiddenMonths.length > 0 && (
              <div className="flex gap-1 flex-wrap mb-2">
                {hiddenMonths.slice().sort((a, b) => a - b).map((m) => (
                  <button key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
                    onClick={() => setHiddenMonths((h) => h.filter((x) => x !== m))}>{m}월 복원</button>
                ))}
              </div>
            )}
            <div className="overflow-x-auto isolate border border-gray-800 rounded-lg" onKeyDown={onGridKeyDown}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#151b28]">
                    <th className={`${cellBase} sticky left-0 z-[3] bg-[#151b28] text-left text-gray-400`}>결제</th>
                    <th className={`${cellBase} sticky z-[3] bg-[#151b28] text-left text-gray-400`} style={{ left: LEFT_NAME }}>항목</th>
                    <th className={`${cellBase} sticky z-[3] bg-[#151b28] text-right text-gray-400`} style={{ left: LEFT_PLAN }}>계획</th>
                    {visibleMonths.map((m) => (
                      <th key={m} className={`${cellBase} text-right text-gray-400 relative`}>
                        <button
                          className="absolute top-0 left-0 right-0 h-[4px] z-[1] hover:bg-amber-500/50"
                          title={`${m}월 열 숨기기`}
                          onClick={() => setHiddenMonths((h) => [...h, m])}
                        />
                        {m}월
                      </th>
                    ))}
                    <th className={`${cellBase} text-right text-gray-400`}>{year} 합계</th>
                    <th className={`${cellBase} text-right text-gray-400`}>차이</th>
                  </tr>
                </thead>
                <tbody>
                  {LEDGER_GROUP_ORDER.map((g) => {
                    const items = grouped[g] || [];
                    const isOpen = !collapsed[g];
                    return (
                      <React.Fragment key={g}>
                        <tr className="bg-[#111827]">
                          <td className={`${cellBase} sticky left-0 z-[2] bg-[#111827]`} colSpan={colCount}>
                            <div className="flex items-center gap-2">
                              <button className="text-[11px] font-bold" style={{ color: LEDGER_GROUP_COLOR[g] }}
                                onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}>
                                {isOpen ? '▾' : '▸'} {LEDGER_GROUP_LABEL[g]}
                                {g === 'annual' && <span className="text-[9px] text-gray-500 ml-1">연 1회 목돈 — 월 지출 합계에 포함되지 않습니다</span>}
                                {g === 'income' && <span className="text-[9px] text-gray-500 ml-1">수입 — 지출 합계와 분리됩니다</span>}
                              </button>
                              <span className="text-[10px] text-gray-600">{items.length}건</span>
                              {!readOnly && (
                                <button className="text-[10px] px-1.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
                                  onClick={() => addItem(g)}>+ 추가</button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isOpen && items.map(renderItemRow)}
                        {isOpen && items.length > 0 && renderGroupSubtotal(g, items)}
                      </React.Fragment>
                    );
                  })}
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
              · <b>소계 행의 월 금액은 '실제 ?? 계획'</b>입니다 — 실제를 아직 안 넣은 항목은 계획으로 채워집니다. 몇 건이 계획인지는 금액 아래 <span style={{ color: LEDGER_DIVERGING.flat }}>계획 N</span>으로 표시되고, 셀에 마우스를 올리면 실제/계획이 분리돼 보입니다.<br />
              · 그 계획 폴백은 <b>소계 표시에만</b> 쓰입니다 — 전월/전년 대비와 달력 칩은 실제 입력분만 봅니다(계획으로 채우면 "지출이 줄었다"고 거짓말하게 됩니다).<br />
              · 항목명 왼쪽 <b>▲▼</b>로 같은 그룹 안에서 순서를 바꿉니다. 항목명 아래 <b>구분</b>은 표 아래 '구분 관리'에서 미리 등록한 값 중에서 고릅니다.<br />
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
            {/* ① 월별 계획 vs 실제 */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-1">{year}년 월별 지출 — 계획 대비 실제</div>
              <div className="text-[10px] text-gray-500 mb-2">막대 = 실제 입력분 · 회색 선 = 계획</div>
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
                    <Bar dataKey="actual" name="실제" fill={LEDGER_BALANCE_COLOR.expense} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Line type="monotone" dataKey="plan" name="계획" stroke="#94a3b8" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ② 전월 대비 증감 */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-1">전월 대비 증감</div>
              <div className="text-[10px] text-gray-500 mb-2">
                <span style={{ color: LEDGER_DIVERGING.over }}>▲ 증가(초과)</span> · <span style={{ color: LEDGER_DIVERGING.under }}>▼ 감소(절약)</span>
                {' '}· 입력 완료도가 다른 달은 <b>표시하지 않습니다</b>
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={yearSeries} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (hideAmounts ? '' : fmtWonShort(v, false))} width={48} />
                    <RTooltip {...TOOLTIP_STYLE}
                      formatter={(v) => [fmtWon(v, hideAmounts), '전월 대비']} />
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
                그룹당 최대 {LEDGER_DETAIL_TOP_N}개까지 표시하고 나머지는 '기타'로 묶습니다.
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
              <div className="text-[10px] text-gray-500 mb-2">수입 − 지출 = 저축여력</div>
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
                    <Bar dataKey="income" name="수입" fill={LEDGER_BALANCE_COLOR.income} radius={[4, 4, 0, 0]} maxBarSize={18} />
                    <Bar dataKey="actual" name="지출" fill={LEDGER_BALANCE_COLOR.expense} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          /* ── 연간 탭 ── */
          <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-1">연도별 지출 — 전년 대비</div>
              <div className="text-[10px] text-gray-500 mb-2">실제 입력분 기준. 기록이 없는 해는 표시되지 않습니다.</div>
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
                    <Bar dataKey="actual" name="실제" fill={LEDGER_BALANCE_COLOR.expense} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Line type="monotone" dataKey="plan" name="계획" stroke="#94a3b8" strokeWidth={2} dot />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-[11px]">
                전년 동월({month}월) 대비:{' '}
                {yoy.comparable ? (
                  <span style={{ color: varianceTone(yoy.delta) }}>
                    {varianceMark(yoy.delta)} {fmtWon(Math.abs(yoy.delta), hideAmounts)} ({fmtSignedPct(yoy.rate)})
                  </span>
                ) : (
                  <span className="text-gray-500" title={yoy.reason === 'missing-mismatch' ? '두 달의 미입력 건수가 달라 비교할 수 없습니다' : '전년 기록이 없습니다'}>-</span>
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
