// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, ReferenceLine,
} from 'recharts';
import {
  LEDGER_GROUP_ORDER, LEDGER_GROUP_LABEL, LEDGER_GROUP_COLOR, LEDGER_PAY_LABEL,
  LEDGER_BALANCE_COLOR, LEDGER_DIVERGING, LEDGER_EXPENSE_GROUPS,
  MAX_LEDGER_BOOKS, MAX_LEDGER_ITEMS,
  loanSchedule, loanAnnualTotal, planOf, actualOf, varianceOf, commitActual, isItemActive,
  monthTotals, ledgerKpi, momDelta, yoyDelta, ledgerFingerprint,
  makeLedgerItem, makeLedgerLoan, makeLedgerBook,
  makeYm, addMonthsYm, isValidYm, roundWon, finiteOr,
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

function Kpi({ label, value, sub, tone, title }) {
  return (
    <div className="bg-[#0f1623] border border-gray-800 rounded-lg px-3 py-2 min-w-0" title={title || undefined}>
      <div className="text-[10px] text-gray-500 truncate">{label}</div>
      <div className="text-[15px] font-bold truncate" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub ? <div className="text-[10px] text-gray-500 truncate mt-0.5">{sub}</div> : null}
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
    if (books === localRef.current) return;
    localRef.current = books;
    setLocalState(books);
  }, [books]);

  /* ── 뷰 상태(세션 로컬 — 저장 지점 0곳) ────────────────────────────────── */
  const [bookIdx, setBookIdx] = useState(0);
  const todayYm = isValidYm(String(today).slice(0, 7)) ? String(today).slice(0, 7) : '';
  const [year, setYear] = useState(() => (todayYm ? Number(todayYm.slice(0, 4)) : 2026));
  const [month, setMonth] = useState(() => (todayYm ? Number(todayYm.slice(5, 7)) : 1));
  const [tab, setTab] = useState('matrix');
  const [collapsed, setCollapsed] = useState({});
  const [hiddenMonths, setHiddenMonths] = useState([]);
  const [armedDelete, setArmedDelete] = useState('');
  const [flash, setFlash] = useState('');
  const flashTimer = useRef(null);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
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

  /** 그 해 12개월의 계획/실제 — 차트 3종이 공유한다. */
  const yearSeries = useMemo(() => MONTHS.map((m) => {
    const k = makeYm(year, m);
    const t = monthTotals(book, k);
    const c = momDelta(book, k);
    return {
      m, ym: k, label: `${m}월`,
      plan: t.planExpense, actual: t.actualExpense,
      income: t.actualIncome || t.planIncome,
      missing: t.missingExpense,
      // ⚠️ comparable=false면 숫자를 내지 않는다(진행 중인 달은 항상 미입력이 많다).
      momDelta: c.comparable ? c.delta : null,
      hasActual: t.missingExpense < t.activeExpense,
    };
  }), [book, year]);

  /** 도넛 — 4슬롯 고정 순서. ⚠️ 직접 라벨 + 2px 간격이 필수(CVD ΔE 7.1 대역). */
  const donut = useMemo(() => {
    const rows = LEDGER_EXPENSE_GROUPS.map((g) => {
      const agg = totals.byGroup[g];
      const v = agg ? (agg.actual > 0 ? agg.actual : agg.plan) : 0;
      return { key: g, name: LEDGER_GROUP_LABEL[g], value: Math.max(0, v), color: LEDGER_GROUP_COLOR[g] };
    }).filter((r) => r.value > 0);
    const sum = rows.reduce((a, b) => a + b.value, 0);
    return { rows, sum };
  }, [totals]);

  const payRows = useMemo(() =>
    Object.entries(totals.byPay || {})
      .map(([k, v]) => ({ key: k, label: LEDGER_PAY_LABEL[k] || k, plan: v.plan, actual: v.actual }))
      .filter((r) => r.plan > 0 || r.actual > 0),
    [totals]);

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
    if (local.length === 0) setLocal(() => [makeLedgerBook({ name: '가계부', createdAt: Date.now() })]);
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

  const shell = variant === 'page'
    ? 'fixed inset-0 bg-[#0b1120] text-gray-200 flex flex-col'
    : 'fixed inset-0 bg-[#0b1120] text-gray-200 flex flex-col';

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
      if (a !== null) yearActual += a; else if (isItemActive(it, k)) yearMissing++;
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
        <td className={`${cellBase} sticky left-[62px] z-[2] bg-[#0b1120]`} style={{ minWidth: 150 }}>
          <div className="flex items-center gap-1">
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
        <td className={`${cellBase} sticky left-[212px] z-[2] bg-[#0b1120] text-right`} style={{ minWidth: 96 }}>
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

  const renderGroupSubtotal = (g, items) => {
    let plan = 0, actual = 0, missing = 0;
    const monthly = visibleMonths.map((m) => {
      const k = makeYm(year, m);
      let mp = 0, ma = 0, mm = 0;
      for (const it of items) {
        const p = planOf(it, k); const a = actualOf(it, k);
        if (p !== null) mp += p;
        if (a !== null) ma += a; else if (isItemActive(it, k)) mm++;
      }
      return { m, mp, ma, mm };
    });
    for (const it of items) {
      for (const m of MONTHS) {
        const k = makeYm(year, m);
        const p = planOf(it, k); const a = actualOf(it, k);
        if (p !== null) plan += p;
        if (a !== null) actual += a; else if (isItemActive(it, k)) missing++;
      }
    }
    return (
      <tr key={`sub-${g}`} className="bg-gray-800/50 font-semibold">
        <td className={`${cellBase} sticky left-0 z-[2] bg-[#151b28]`} colSpan={2}>
          <span className="text-[11px]" style={{ color: LEDGER_GROUP_COLOR[g] }}>{LEDGER_GROUP_LABEL[g]} 소계</span>
        </td>
        <td className={`${cellBase} sticky left-[212px] z-[2] bg-[#151b28] text-right text-[11px]`}>
          {fmtWon(monthly.length ? planOfGroupAt(items, ym) : 0, hideAmounts)}
        </td>
        {monthly.map(({ m, ma, mm }) => (
          <td key={m} className={`${cellBase} text-right text-[11px]`}>
            {mm > 0 && ma === 0 ? <span className="text-gray-600">-</span> : fmtWonShort(ma, hideAmounts)}
          </td>
        ))}
        <td className={`${cellBase} text-right text-[11px]`}>{fmtWon(actual, hideAmounts)}</td>
        <td className={`${cellBase} text-right text-[10px] text-gray-500`}>
          {missing > 0 ? `미입력 ${missing}` : fmtWon(actual - plan, hideAmounts)}
        </td>
      </tr>
    );
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
          <Kpi label="예상 月 지출" value={fmtWon(kpi.projectedMonthly, hideAmounts)}
            sub={`예상 年 ${fmtWon(kpi.projectedAnnual, hideAmounts)}`}
            title="예상 年 지출 = 월 지출 합계 × 12 + 년단위 합계. 그 값을 12로 나눈 것입니다." />
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
                    <th className={`${cellBase} sticky left-[62px] z-[3] bg-[#151b28] text-left text-gray-400`}>항목</th>
                    <th className={`${cellBase} sticky left-[212px] z-[3] bg-[#151b28] text-right text-gray-400`}>계획</th>
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
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10px] text-gray-600 leading-relaxed">
              · 실제 금액 칸을 <b>비우면 '미입력'</b>이고, <b>0을 넣으면 '그 달엔 안 썼다'</b>는 확정입니다 — 두 값은 합계에서 다르게 다뤄집니다.<br />
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
                    const annual = loanAnnualTotal(l, year);
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
                    <RTooltip contentStyle={{ background: '#0f1623', border: '1px solid #374151', fontSize: 11 }}
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
                    <RTooltip contentStyle={{ background: '#0f1623', border: '1px solid #374151', fontSize: 11 }}
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

            {/* ③ 구분별 도넛 */}
            <div className="bg-[#0f1623] border border-gray-800 rounded-lg p-3">
              <div className="text-[12px] font-semibold mb-1">{month}월 지출 구분</div>
              <div className="text-[10px] text-gray-500 mb-2">실제가 있으면 실제, 없으면 계획 기준</div>
              {donut.rows.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-[11px] text-gray-600">표시할 지출이 없습니다</div>
              ) : (
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      {/* ⚠️ 직접 라벨 + 2px 간격이 필수 — 이 4색은 CVD ΔE 7.1 대역이라
                          색만으로는 구분이 보장되지 않는다(보조 부호가 있어야 합법). */}
                      <Pie data={donut.rows} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82}
                        paddingAngle={2} stroke="#0f1623" strokeWidth={2}
                        label={({ name, value }) => `${name} ${donut.sum > 0 ? Math.round((value / donut.sum) * 100) : 0}%`}
                        labelLine={{ stroke: '#4b5563' }}>
                        {donut.rows.map((r) => <Cell key={r.key} fill={r.color} />)}
                      </Pie>
                      <RTooltip contentStyle={{ background: '#0f1623', border: '1px solid #374151', fontSize: 11 }}
                        formatter={(v, n) => [fmtWon(v, hideAmounts), n]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {payRows.length > 0 && (
                <div className="mt-2 border-t border-gray-800 pt-2">
                  <div className="text-[10px] text-gray-500 mb-1">결제수단별 (지출만)</div>
                  <div className="flex flex-wrap gap-2">
                    {payRows.map((r) => (
                      <span key={r.key} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                        {r.label} {fmtWonShort(r.actual > 0 ? r.actual : r.plan, hideAmounts)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
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
                    <RTooltip contentStyle={{ background: '#0f1623', border: '1px solid #374151', fontSize: 11 }}
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
                    <RTooltip contentStyle={{ background: '#0f1623', border: '1px solid #374151', fontSize: 11 }}
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

/** 그룹의 그 달 계획 합. 소계 행에서만 쓴다. */
function planOfGroupAt(items, ym) {
  let s = 0;
  for (const it of items) { const p = planOf(it, ym); if (p !== null && Number.isFinite(p)) s += p; }
  return s;
}
