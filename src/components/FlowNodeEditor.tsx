// @ts-nocheck
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, ChevronUp, ChevronDown, ClipboardPaste } from 'lucide-react';
import {
  computeFlowTable, normalizeFlowTable, flowTableFromText, sameFlowTable, flowTableCheckStats,
  clampFlowEditorPos, FLOW_TABLE_BORDERS, MAX_FLOW_TABLE_ROWS, MAX_FLOW_TABLE_TEXT, FLOW_TABLE_LINK_ALL,
} from '../flowMap';

/**
 * 도형 메모·표 편집 팝업.
 *
 * ⚠️ **인스펙터에는 메모 draft를 두지 않는다.** 같은 값을 두 곳에서 편집하면, 팝업에서 고친 뒤
 *    인스펙터의 미커밋 draft가 나중에 flush되며 **방금 쓴 메모를 옛 값으로 덮는다**(인스펙터의
 *    flush는 대상 변경·언마운트에서 도는데 팝업 닫힘은 그 트리거가 아니다). 인스펙터 쪽은
 *    읽기 전용 미리보기로 두고 편집은 여기 한 곳에서만 한다.
 *
 * ⚠️ 커밋은 **blur·구조 변경·언마운트** 세 시점이다. 키스트로크마다 커밋하면 상위 patchMap →
 *    App 지문 재계산이 돌아 타이핑이 끊긴다(인스펙터와 같은 규약).
 * ⚠️ 언마운트 flush는 `useLayoutEffect`여야 한다 — passive는 Scheduler 태스크라 discrete 이벤트인
 *    blur보다 뒤처지고, 제거된 DOM에는 브라우저가 blur를 발화하지 않는다.
 *
 * ── 이동 가능한 비차단 팝업 (사용자 요청 2026-09) ─────────────────────────────
 * "메모를 열 때는 가운데에 뜨지만 사용자가 표나 메모를 원하는 곳에 옮길 수 있어야 한다."
 *  - 위치의 **정본은 보드**(`initialPos` ← 보드 state)다. 팝업이 열려 있는 동안 다른 도형의 메모를
 *    열어도(= key가 바뀌어 이 컴포넌트가 다시 마운트돼도) 옮겨 둔 자리를 지키고, **닫으면 초기화**되어
 *    다음에 열 때 다시 가운데에 뜬다. `null`이 곧 '가운데'다.
 *  - ⚠️ 끄는 동안의 좌표는 **이 컴포넌트 로컬 state**에만 두고 **놓을 때 한 번만** 보드에 알린다
 *    (`onPosCommit`). 프레임마다 보드 state를 바꾸면 보드 전체(툴바·인스펙터·캔버스)가 포인터 이동마다
 *    다시 그려진다. 놓는 순간의 값은 렌더된 state가 아니라 **dragRef에 적어 둔 마지막 계산값**을
 *    쓴다 — pointermove의 setState는 연속 우선순위라 discrete인 pointerup보다 늦게 커밋될 수 있다.
 *  - 어두운 백드롭을 두지 않는다 — 옮기는 이유가 뒤의 흐름도를 보면서 쓰기 위해서라, 화면을 덮으면
 *    옮길 이유가 사라진다. 대신 닫기는 X 버튼과 Esc로만 한다.
 *  - ⚠️ **Esc는 보드의 onKeyDownCapture가 처리한다**(`data-flow-node-editor` 판별). 이 컴포넌트의
 *    bubble onKeyDown은 **도달하지 않는다** — 보드가 캡처 단계에서 Escape의 전파를 끊기 때문이다
 *    (React 18은 루트 캡처 리스너에서 네이티브 전파를 멈춘다). 옛 코드는 여기에 Escape 핸들러를
 *    두고 '팝업이 먼저 소비한다'고 믿었지만 실제로는 보드가 선택을 풀거나 보드 전체를 닫았다.
 *
 * ⚠️ 이 팝업은 보드(z 990)의 **자식**이라 자체 스태킹 컨텍스트 안에서 뜬다. App의
 *    ConfirmDialog(z 1000)는 여전히 이 위에 뜨므로 확인창이 필요하면 그대로 쓸 수 있다.
 *    다만 별도 창(variant='page')에는 App이 없어 confirm이 없으므로 **행 삭제는 확인창을 쓰지
 *    않는다**(되돌리기 쉬운 조작이라 인라인 2단계도 두지 않았다).
 */

const ROW_KINDS = [
  { k: 'item', t: '항목', title: '값을 직접 적는 행. 소계·잔액 계산의 대상입니다.' },
  { k: 'subtotal', t: '소계', title: '기본: 바로 위 구분선 이후의 항목 합. 더하고 뺄 행을 직접 고를 수도 있습니다.' },
  { k: 'total', t: '총액', title: '직접 적거나, 계좌에 연결하거나, 다른 행을 더하고 빼서 계산합니다. 잔액 계산의 기준입니다.' },
  { k: 'balance', t: '잔액', title: '기본: 총액 합 − 항목 합. 더하고 뺄 행을 직접 고를 수도 있습니다.' },
  { k: 'rule', t: '구분선', title: '가로선만 그립니다. 소계는 이 선을 기준으로 끊깁니다.' },
];

const BORDER_LABEL = { none: '없음', outline: '바깥만', all: '전체' };

/** 총액 행 값 출처 드롭다운의 '항목 계산' 값(계좌 id와 겹치지 않는다). */
const CALC_SOURCE = '__calc__';

const isCalcTotalRow = (r) => r?.kind === 'total' && !!r.formula && typeof r.formula === 'object' && !Array.isArray(r.formula);
/** 계산식이 가리킬 수 있는 행 — flowMap 정규화와 같은 규칙(항목 + 계산식 없는 총액). */
const canRefRow = (r) => r?.kind === 'item' || (r?.kind === 'total' && !isCalcTotalRow(r));
const formulaCount = (r) => (r?.formula && typeof r.formula === 'object' ? Object.keys(r.formula).length : 0);

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:border-indigo-500 outline-none';

/** 제목 줄에서 드래그를 시작하지 않을 대상(버튼·입력은 원래 동작을 해야 한다). */
const NO_DRAG_SELECTOR = 'button,input,select,textarea,a,label';

const fmtToggleCls = (on) =>
  `w-6 h-6 shrink-0 rounded border text-[11px] leading-none transition disabled:opacity-25 ${on ? 'border-indigo-500 text-indigo-200 bg-indigo-900/40' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`;

export default function FlowNodeEditor({
  node, title, onPatch, onClose, readOnly, initialTab = 'memo', initialPos = null, onPosCommit,
  accountOptions = [], linkValueOf,
  nodeRefValueOf, refOptions = [], ensureNodeRowId,
}) {
  const [tab, setTab] = useState(initialTab);
  // null = 가운데. 끄는 동안은 여기만 바뀌고, 놓을 때 onPosCommit으로 보드에 알린다.
  const [pos, setPos] = useState(initialPos);
  const [memo, setMemo] = useState(node?.memo ?? '');
  // 표는 **로컬 사본**으로 들고 blur·구조 변경에서 커밋한다.
  const [tbl, setTbl] = useState(() => normalizeFlowTable(node?.table) || null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [notice, setNotice] = useState('');
  // 계산식 패널이 열린 행 인덱스(세션 로컬). 행 추가·삭제·이동으로 인덱스가 밀리면 닫는다.
  const [calcOpen, setCalcOpen] = useState(null);

  // flush는 언마운트에서 호출되므로 클로저가 아니라 ref를 읽어야 한다.
  const memoRef = useRef(memo); memoRef.current = memo;
  const tblRef = useRef(tbl); tblRef.current = tbl;
  const baseRef = useRef({ memo: node?.memo ?? '', table: normalizeFlowTable(node?.table) || null });
  const patchRef = useRef(onPatch); patchRef.current = onPatch;
  const idRef = useRef(node?.id); idRef.current = node?.id;
  const roRef = useRef(readOnly); roRef.current = readOnly;

  const panelRef = useRef(null);
  const dragRef = useRef(null);

  /** 미커밋 편집을 **이 팝업이 연 도형에게** 커밋한다(id 기준 — 대상이 바뀌어도 새지 않는다). */
  const flush = useCallback(() => {
    const id = idRef.current;
    if (!id || roRef.current) return;
    const base = baseRef.current;
    const o = {};
    if (memoRef.current !== base.memo) o.memo = memoRef.current;
    const nextTbl = normalizeFlowTable(tblRef.current);
    if (!sameFlowTable(nextTbl, base.table)) o.table = nextTbl;
    if (Object.keys(o).length === 0) return;
    patchRef.current?.(id, o);
    baseRef.current = { memo: memoRef.current, table: nextTbl };
  }, []);

  // 언마운트(닫기·보드 종료) 시 flush — blur가 발화하지 않는 유일한 안전망
  useLayoutEffect(() => () => { flush(); }, [flush]);

  /** 보드 기준 좌표로 묶는다. 보드(`fixed inset-0`)가 offsetParent다. */
  const clampHere = (x, y) => {
    const el = panelRef.current;
    const host = el?.offsetParent;
    return clampFlowEditorPos(
      x, y,
      el?.offsetWidth,
      host?.clientWidth ?? window.innerWidth,
      host?.clientHeight ?? window.innerHeight,
    );
  };

  // 제목 줄 드래그 — 포인터 캡처라 커서가 제목 줄 밖으로 나가도 끝까지 따라온다(마우스·터치 공통).
  const onHeaderPointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target?.closest?.(NO_DRAG_SELECTOR)) return;
    const el = panelRef.current;
    if (!el) return;
    const host = el.offsetParent;
    const hr = host?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const r = el.getBoundingClientRect();
    // ⚠️ 가운데 정렬(transform) 상태에서도 **지금 보이는 자리**에서 출발해야 잡는 순간 튀지 않는다.
    dragRef.current = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left - hr.left, oy: r.top - hr.top, last: null };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저·비신뢰 이벤트 */ }
    e.preventDefault();
  };
  const onHeaderPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    const next = clampHere(d.ox + e.clientX - d.sx, d.oy + e.clientY - d.sy);
    d.last = next;
    setPos(next);
  };
  const endHeaderDrag = (e) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    dragRef.current = null;
    // 실제로 움직였을 때만 알린다(제목 줄을 클릭만 한 경우 보드 state를 건드리지 않는다).
    if (d.last) onPosCommit?.(d.last);
  };
  const recenter = () => {
    setPos(null);
    onPosCommit?.(null);
  };

  // 창 크기가 줄면 옮겨 둔 팝업이 화면 밖으로 밀려날 수 있다 → 다시 묶는다(값이 같으면 쓰지 않는다).
  useEffect(() => {
    if (!pos) return;
    const reclamp = () => {
      const c = clampHere(pos.x, pos.y);
      if (c.x === pos.x && c.y === pos.y) return;
      setPos(c);
      onPosCommit?.(c);
    };
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [pos, onPosCommit]);

  const rows = tbl?.rows || [];
  // ⚠️ 도형 안 표와 **같은 해석 함수**(보드의 tableLinkValue)로 계산한다 — 갈리면 팝업과 도형의 숫자가 다르다.
  const computed = computeFlowTable(tbl, linkValueOf, nodeRefValueOf);
  /** 도형 참조 → 드롭다운 값. 대상 행에 id가 없으면 인덱스 형태(고르는 순간 id를 붙인다). */
  const refValueOf = (nodeId, pick) => (pick.id ? `nref:${nodeId}#${pick.id}` : `nidx:${nodeId}#${pick.idx}`);
  const refNameOf = (nr) => {
    if (!nr) return '';
    const g = refOptions.find(o => o.nodeId === nr.nodeId);
    const pick = g?.rows.find(x => x.id === nr.rowId);
    return g && pick ? `${g.name} · ${pick.label || ROW_KINDS.find(k => k.k === pick.kind)?.t}` : '';
  };
  const accountNameOf = (pid) => {
    if (pid === FLOW_TABLE_LINK_ALL) return '전체 계좌 합계';
    const o = accountOptions.find(a => a.id === pid);
    return o ? o.name : '';
  };
  /** 값 칸 연결 변경. '' = 직접 입력(직접 입력값은 지우지 않았으므로 그대로 되살아난다). */
  /**
   * 계산식이 참조할 행에 id를 붙인다(없는 행만). ⚠️ 계산식을 처음 쓸 때만 부른다 — 모든 표에 id를
   * 만들면 기존 흐름도가 배포만으로 '변경됨'이 된다. 이벤트 핸들러 안이라 난수 id가 안전하다.
   */
  const withIds = (list) => {
    const used = new Set(list.map(r => r.id).filter(Boolean));
    return list.map(r => {
      if (r.id || !(r.kind === 'item' || r.kind === 'total')) return r;
      let id;
      do { id = 'r' + Math.random().toString(36).slice(2, 9); } while (used.has(id));
      used.add(id);
      return { ...r, id };
    });
  };
  /** 행 i의 계산식에서 행 j를 더하기('+')·빼기('-')·제외(null)로. */
  const setOp = (i, j, op) => {
    const list = withIds(rows);
    const tid = list[j]?.id;
    if (!tid) return;
    const f = { ...(list[i].formula || {}) };
    if (op) f[tid] = op; else delete f[tid];
    // 소계·잔액은 고른 행이 없으면 기본 계산으로 돌아간다. 총액은 '항목 계산' 모드를 유지한다.
    const keep = list[i].kind === 'total' ? f : (Object.keys(f).length ? f : undefined);
    applyRows(list.map((r, k) => (k === i ? { ...r, formula: keep } : r)));
  };
  const setFormula = (i, formula) => applyRows(withIds(rows).map((r, k) => (k === i ? { ...r, formula } : r)));
  /** 기본 계산과 같은 선택으로 시작한다(거기서 빼거나 더하기 쉽게). */
  const loadDefaultFormula = (i) => {
    const list = withIds(rows);
    const f = {};
    if (list[i].kind === 'balance') {
      list.forEach((r, k) => {
        if (k === i) return;
        if (r.kind === 'total' && !isCalcTotalRow(r)) f[r.id] = '+';
        else if (r.kind === 'item') f[r.id] = '-';
      });
    } else if (list[i].kind === 'subtotal') {
      let s = i - 1;
      while (s >= 0 && list[s].kind !== 'rule') s--;
      for (let k = s + 1; k < i; k++) if (list[k].kind === 'item') f[list[k].id] = '+';
    }
    applyRows(list.map((r, k) => (k === i ? { ...r, formula: Object.keys(f).length ? f : (r.kind === 'total' ? {} : undefined) } : r)));
  };
  const setLink = (i, pid) => {
    const r = rows[i];
    if (!r) return;
    if (pid === CALC_SOURCE) {
      // 총액 '항목 계산' — 계좌 연결과 공존하지 않는다. 직접 입력값은 남겨 둔다(되돌리면 되살아난다).
      applyRows(withIds(rows).map((x, k) => (k === i ? { ...x, portfolioId: undefined, nodeRef: undefined, formula: x.formula || {} } : x)));
      setCalcOpen(i);
      return;
    }
    if (pid.startsWith('nref:') || pid.startsWith('nidx:')) {
      // 선으로 이어진 도형의 총액·소계·잔액 참조
      const [nodeId, tail] = pid.slice(5).split('#');
      const rowId = pid.startsWith('nref:') ? tail : ensureNodeRowId?.(nodeId, Number(tail));
      if (!nodeId || !rowId) return;
      const name = refNameOf({ nodeId, rowId }) || (() => {
        const g = refOptions.find(o => o.nodeId === nodeId);
        const pick = g?.rows.find(x => String(x.idx) === tail);
        return g && pick ? `${g.name} · ${pick.label || ROW_KINDS.find(k => k.k === pick.kind)?.t}` : '';
      })();
      setRow(i, {
        nodeRef: { nodeId, rowId }, portfolioId: undefined, formula: undefined,
        ...(!r.label.trim() && name ? { label: name } : {}),
      }, true);
      return;
    }
    if (!pid) { setRow(i, { portfolioId: undefined, formula: undefined, nodeRef: undefined }, true); return; }
    // 이름이 비어 있으면 계좌명으로 채운다(사용자가 적은 이름은 건드리지 않는다).
    const name = accountNameOf(pid);
    setRow(i, { portfolioId: pid, formula: undefined, nodeRef: undefined, ...(!r.label.trim() && name ? { label: name } : {}) }, true);
  };
  const checks = flowTableCheckStats(tbl);

  /** 구조 변경 — 즉시 커밋한다(행 추가·삭제·이동·유형 변경은 blur가 없다). */
  const applyRows = (nextRows, nextBorder) => {
    if (readOnly) return;
    const next = nextRows.length ? { rows: nextRows, border: nextBorder ?? tbl?.border ?? 'none' } : null;
    setTbl(next);
    tblRef.current = next;
    flushNow(next);
  };
  /** 로컬 사본이 setState 전이라도 커밋되게 값을 직접 넘긴다. */
  const flushNow = (next) => {
    const id = idRef.current;
    if (!id || readOnly) return;
    const nextTbl = normalizeFlowTable(next);
    if (sameFlowTable(nextTbl, baseRef.current.table)) return;
    onPatch?.(id, { table: nextTbl });
    baseRef.current = { ...baseRef.current, table: nextTbl };
  };

  const addRow = (kind) => {
    if (rows.length >= MAX_FLOW_TABLE_ROWS) { setNotice(`행은 최대 ${MAX_FLOW_TABLE_ROWS}개까지입니다.`); return; }
    applyRows([...rows, { kind, label: '', value: '' }]);
  };
  const setRow = (i, patch, commit) => {
    const next = rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
    setTbl({ rows: next, border: tbl?.border ?? 'none' });
    tblRef.current = { rows: next, border: tbl?.border ?? 'none' };
    if (commit) flushNow({ rows: next, border: tbl?.border ?? 'none' });
  };
  const removeRow = (i) => { setCalcOpen(null); applyRows(rows.filter((_, k) => k !== i)); };
  const moveRow = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    setCalcOpen(null);
    const next = rows.slice();
    const tmp = next[i]; next[i] = next[j]; next[j] = tmp;
    applyRows(next);
  };
  const applyPaste = () => {
    const parsed = flowTableFromText(pasteText);
    if (!parsed.length) { setNotice('붙여넣은 내용에서 행을 찾지 못했습니다.'); return; }
    const merged = [...rows, ...parsed].slice(0, MAX_FLOW_TABLE_ROWS);
    if (rows.length + parsed.length > MAX_FLOW_TABLE_ROWS) setNotice(`행 상한(${MAX_FLOW_TABLE_ROWS})을 넘어 일부만 넣었습니다.`);
    applyRows(merged);
    setPasteText('');
    setPasteOpen(false);
  };

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 3200); return () => clearTimeout(t); }, [notice]);

  if (!node) return null;

  return (
    <div
      ref={panelRef}
      data-flow-node-editor=""
      className="absolute w-[780px] max-w-[94vw] h-[560px] max-h-[88vh] flex flex-col rounded-lg border border-gray-600 bg-[#0f1623] shadow-2xl shadow-black/70"
      style={pos
        ? { zIndex: 60, left: pos.x, top: pos.y }
        : { zIndex: 60, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0 cursor-move select-none"
        style={{ touchAction: 'none' }}
        title="끌어서 옮기기 · 더블클릭하면 가운데로"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endHeaderDrag}
        onPointerCancel={endHeaderDrag}
        onLostPointerCapture={endHeaderDrag}
        onDoubleClick={(e) => { if (!e.target?.closest?.(NO_DRAG_SELECTOR)) recenter(); }}
      >
        <div className="text-xs font-semibold text-gray-200 truncate max-w-[220px]" title={title}>{title || '도형'}</div>
        <div className="flex gap-1 ml-2">
          {[{ k: 'memo', t: '메모' }, { k: 'table', t: '표' }].map(({ k, t }) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`text-[11px] px-2 py-1 rounded border transition cursor-pointer ${tab === k ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
            >
              {t}
              {k === 'memo' && memo ? <span className="ml-1 text-[9px] text-gray-500">●</span> : null}
              {k === 'table' && rows.length ? <span className="ml-1 text-[9px] text-gray-500">{rows.length}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-200 cursor-pointer" title="닫기 (Esc)"><X size={16} /></button>
      </div>

      {notice && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-900/20 border-b border-amber-800/40 shrink-0">{notice}</div>
      )}

      {tab === 'memo' ? (
        <div className="flex-1 min-h-0 flex flex-col p-3">
          <textarea
            autoFocus
            className={`${inputCls} flex-1 min-h-0 resize-none leading-relaxed`}
            style={{ fontSize: 13 }}
            value={memo}
            readOnly={readOnly}
            placeholder={'여러 줄로 자유롭게 적습니다.\n\n금액 목록처럼 열을 맞춰야 하면 위의 [표] 탭을 쓰세요 —\n글꼴에 상관없이 정렬되고 소계·잔액이 자동으로 계산됩니다.'}
            onChange={e => setMemo(e.target.value)}
            onBlur={flush}
          />
          <div className="text-[10px] text-gray-500 mt-2">도형 안에는 메모가 먼저, 그 아래에 표가 표시됩니다.</div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col p-3">
          <div className="flex items-center gap-2 mb-2 shrink-0">
            <span className="text-[11px] text-gray-400">표 선</span>
            <div className="flex gap-1">
              {FLOW_TABLE_BORDERS.map(b => (
                <button
                  key={b}
                  disabled={readOnly || !rows.length}
                  onClick={() => applyRows(rows, b)}
                  className={`text-[10px] px-2 py-1 rounded border transition disabled:opacity-40 ${(tbl?.border ?? 'none') === b ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                >{BORDER_LABEL[b]}</button>
              ))}
            </div>
            <div className="flex-1" />
            {/* 실행 현황 — 도형 안 표·인스펙터와 같은 flowTableCheckStats를 쓴다(각자 세면 숫자가 갈린다). */}
            {checks.total > 0 && (
              <span className="text-[10px] text-emerald-300/90" title="체크한 항목 수 / 항목 행 수">실행 {checks.done}/{checks.total}</span>
            )}
            {!readOnly && (
              <button
                onClick={() => setPasteOpen(v => !v)}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition"
                title="엑셀에서 복사한 내용을 붙여넣어 행을 만듭니다"
              ><ClipboardPaste size={11} /> 붙여넣기</button>
            )}
          </div>

          {pasteOpen && !readOnly && (
            <div className="mb-2 p-2 rounded border border-gray-700 bg-gray-900/60 shrink-0">
              <textarea
                autoFocus
                className={`${inputCls} resize-none`}
                rows={4}
                value={pasteText}
                placeholder={'엑셀에서 두 열(항목 · 금액)을 복사해 붙여넣으세요.\n----- 같은 줄은 구분선이 됩니다.'}
                onChange={e => setPasteText(e.target.value)}
              />
              <div className="flex gap-1 mt-1">
                <button onClick={applyPaste} className="text-[10px] px-2 py-1 rounded border border-indigo-600 text-indigo-300 hover:bg-indigo-900/30">현재 표에 추가</button>
                <button onClick={() => { setPasteOpen(false); setPasteText(''); }} className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200">취소</button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-[11px] text-gray-500 leading-relaxed">
                아래 버튼으로 행을 추가하세요.<br />
                <span className="text-gray-600">소계 = 바로 위 구분선 이후 항목의 합 · 잔액 = 총액 합 − 항목 합</span><br />
                <span className="text-gray-600">항목 이름 오른쪽 체크 = 실행 표시 · S = 취소선 · I = 기울임</span><br />
                <span className="text-gray-600">항목·총액의 금액은 직접 입력하거나 계좌(또는 전체 계좌 합계)를 연결할 수 있습니다</span><br />
                <span className="text-gray-600">총액·소계·잔액은 다른 행을 골라 더하거나 뺄 수 있습니다(값 칸 왼쪽 버튼)</span><br />
                <span className="text-gray-600">선으로 이어진 도형의 총액·소계·잔액도 값 출처에서 고를 수 있습니다</span>
              </div>
            ) : rows.map((r, i) => {
              const auto = r.kind === 'subtotal' || r.kind === 'balance';
              const isRule = r.kind === 'rule';
              const isItem = r.kind === 'item';
              const strikeOn = r.strike === true;
              const italicOn = r.italic === true;
              const calcTotal = isCalcTotalRow(r);
              // 계산식을 가질 수 있는 행 — 소계·잔액·항목 계산 총액
              const ownsFormula = auto || calcTotal;
              const custom = !!computed[i]?.custom;
              const panelOpen = calcOpen === i && ownsFormula;
              const nr = (isItem || r.kind === 'total') && r.nodeRef?.nodeId ? r.nodeRef : null;
              const nrValue = nr ? `nref:${nr.nodeId}#${nr.rowId}` : '';
              const nrListed = nr ? refOptions.some(g => g.nodeId === nr.nodeId && g.rows.some(x => x.id === nr.rowId)) : false;
              return (
                <React.Fragment key={i}>
                <div className="flex items-center gap-1 mb-1">
                  <select
                    disabled={readOnly}
                    value={r.kind}
                    onChange={e => { setCalcOpen(null); setRow(i, { kind: e.target.value, formula: undefined }, true); }}
                    className="w-[62px] shrink-0 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-[10px] text-gray-200 outline-none focus:border-indigo-500"
                  >
                    {ROW_KINDS.map(({ k, t, title: ti }) => <option key={k} value={k} title={ti}>{t}</option>)}
                  </select>
                  <input
                    className={`${inputCls} flex-1 min-w-0 ${isRule ? 'opacity-40' : ''} ${strikeOn && !isRule ? 'line-through' : ''} ${italicOn && !isRule ? 'italic' : ''}`}
                    value={r.label}
                    readOnly={readOnly || isRule}
                    maxLength={MAX_FLOW_TABLE_TEXT}
                    placeholder={isRule ? '─────' : '항목 이름'}
                    onChange={e => setRow(i, { label: e.target.value })}
                    onBlur={flush}
                  />
                  {/* 실행 체크 — 항목 이름 **오른쪽**(사용자 요구). 항목 행 전용이라 다른 행은 같은 폭의
                      빈 칸으로 열을 맞춘다. 표시·서식은 계산에 영향을 주지 않고 즉시 커밋한다(blur가 없다). */}
                  {isItem ? (
                    <input
                      type="checkbox"
                      checked={r.done === true}
                      disabled={readOnly}
                      onChange={e => setRow(i, { done: e.target.checked }, true)}
                      title={r.done === true ? '실행함 — 클릭하면 해제' : '실행했으면 체크하세요'}
                      className="w-4 h-4 shrink-0 mx-0.5 accent-emerald-500 cursor-pointer disabled:cursor-default"
                    />
                  ) : <span className="w-4 h-4 shrink-0 mx-0.5" />}
                  <button
                    type="button"
                    disabled={readOnly || isRule}
                    aria-pressed={strikeOn}
                    onClick={() => setRow(i, { strike: !strikeOn }, true)}
                    title="항목 이름 취소선"
                    className={fmtToggleCls(strikeOn && !isRule)}
                  ><span className="line-through">S</span></button>
                  <button
                    type="button"
                    disabled={readOnly || isRule}
                    aria-pressed={italicOn}
                    onClick={() => setRow(i, { italic: !italicOn }, true)}
                    title="항목 이름 기울임"
                    className={fmtToggleCls(italicOn && !isRule)}
                  ><span className="italic font-serif">I</span></button>
                  {/* 값 출처 — 항목·총액 행만 직접 입력 / 계좌 연결을 고른다(사용자 요청 2026-10).
                      다른 행은 같은 폭의 빈 칸으로 열을 맞춘다. */}
                  {(isItem || r.kind === 'total') ? (
                    <select
                      disabled={readOnly}
                      value={calcTotal ? CALC_SOURCE : nr ? nrValue : (r.portfolioId || '')}
                      onChange={e => setLink(i, e.target.value)}
                      title={r.portfolioId ? `계좌 연결: ${accountNameOf(r.portfolioId) || '(연결 끊김)'} — 현재 평가액이 자동으로 들어갑니다` : '금액을 직접 입력합니다. 계좌를 고르면 그 계좌의 현재 평가액이 들어갑니다.'}
                      className={`w-[96px] shrink-0 bg-gray-800 border rounded px-1 py-1 text-[10px] outline-none focus:border-indigo-500 ${calcTotal ? 'border-violet-700 text-violet-200' : nr ? 'border-teal-600 text-teal-200' : r.portfolioId ? 'border-sky-700 text-sky-200' : 'border-gray-700 text-gray-400'}`}
                    >
                      <option value="">직접 입력</option>
                      {r.kind === 'total' && <option value={CALC_SOURCE}>항목 계산</option>}
                      <option value={FLOW_TABLE_LINK_ALL}>전체 계좌 합계</option>
                      {accountOptions.map(o => (
                        <option key={o.id} value={o.id}>{o.name}{o.deleted ? ' (삭제됨)' : o.isTest ? ' (TEST)' : ''}</option>
                      ))}
                      {r.portfolioId && r.portfolioId !== FLOW_TABLE_LINK_ALL && !accountOptions.some(o => o.id === r.portfolioId) && (
                        <option value={r.portfolioId}>(연결 끊김)</option>
                      )}
                      {/* 선으로 이어진 도형의 총액·소계·잔액(사용자 요청 2026-10) */}
                      {refOptions.map(g => (
                        <optgroup key={g.nodeId} label={`이어진 도형 · ${g.name}`}>
                          {g.rows.map(x => (
                            <option key={x.idx} value={refValueOf(g.nodeId, x)}>
                              {(x.label || ROW_KINDS.find(k => k.k === x.kind)?.t)}{x.text ? ` (${x.text})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      {nr && !nrListed && <option value={nrValue}>(도형 연결 끊김)</option>}
                    </select>
                  ) : auto ? (
                    <button
                      type="button"
                      onClick={() => setCalcOpen(o => (o === i ? null : i))}
                      title="더하고 뺄 행을 고릅니다"
                      className={`w-[96px] shrink-0 rounded border px-1 py-1 text-[10px] truncate transition ${custom ? 'border-violet-700 text-violet-200 bg-violet-900/20' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                    >{custom ? `선택 계산 ${formulaCount(r)}` : '기본 계산'} {panelOpen ? '▴' : '▾'}</button>
                  ) : <span className="w-[96px] shrink-0" />}
                  {ownsFormula ? (
                    <button
                      type="button"
                      onClick={() => setCalcOpen(o => (o === i ? null : i))}
                      className={`w-[110px] shrink-0 px-2 py-1 text-xs text-right italic bg-gray-800/40 border rounded truncate ${custom ? 'text-violet-200 border-violet-800/70' : 'text-emerald-300/90 border-gray-700/60'}`}
                      title={custom ? '고른 행을 더하고 뺀 값입니다 — 클릭하면 계산식을 엽니다' : '기본 계산 값입니다 — 클릭하면 더하고 뺄 행을 고를 수 있습니다'}
                    >{computed[i]?.text || '0'}</button>
                  ) : nr ? (
                    <div
                      className="w-[110px] shrink-0 px-2 py-1 text-xs text-right text-teal-200 bg-gray-800/40 border border-teal-800/70 rounded truncate"
                      title={computed[i]?.text === '-' ? '이어진 도형의 값을 구하지 못했습니다(도형·행 삭제, 또는 서로를 참조하는 순환). 합계에서 제외됩니다.' : `${refNameOf(nr) || '이어진 도형'} 값(자동)`}
                    >{computed[i]?.text || '-'}</div>
                  ) : r.portfolioId && (isItem || r.kind === 'total') ? (
                    <div
                      className="w-[110px] shrink-0 px-2 py-1 text-xs text-right text-sky-300 bg-gray-800/40 border border-sky-800/60 rounded truncate"
                      title={computed[i]?.text === '-' ? '계좌 평가액을 구하지 못했습니다(삭제·연결 끊김·불러오는 중). 합계에서 제외됩니다.' : `${accountNameOf(r.portfolioId)} 현재 평가액(자동)`}
                    >{computed[i]?.text || '-'}</div>
                  ) : (
                    <input
                      className={`${inputCls} w-[110px] shrink-0 text-right ${isRule ? 'opacity-40' : ''}`}
                      value={r.value}
                      readOnly={readOnly || isRule}
                      maxLength={MAX_FLOW_TABLE_TEXT}
                      placeholder={isRule ? '' : '금액'}
                      onChange={e => setRow(i, { value: e.target.value })}
                      onBlur={flush}
                    />
                  )}
                  {!readOnly && (
                    <>
                      <button onClick={() => moveRow(i, -1)} disabled={i === 0} className="p-1 text-gray-500 hover:text-gray-200 disabled:opacity-25" title="위로"><ChevronUp size={12} /></button>
                      <button onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} className="p-1 text-gray-500 hover:text-gray-200 disabled:opacity-25" title="아래로"><ChevronDown size={12} /></button>
                      <button onClick={() => removeRow(i)} className="p-1 text-gray-500 hover:text-red-300" title="이 행 삭제"><Trash2 size={12} /></button>
                    </>
                  )}
                </div>
                {/* 계산식 패널 — 이 행에 더하고(+) 뺄(−) 행을 고른다(사용자 요청 2026-10). 행 바로 아래에
                    펼친다(팝업 안이라 부동 팝오버는 스크롤 영역에 잘린다). */}
                {panelOpen && (
                  <div className="ml-[66px] mb-2 p-2 rounded border border-violet-800/60 bg-gray-900/70 text-[11px]">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-violet-200 font-semibold">{r.label || ROW_KINDS.find(x => x.k === r.kind)?.t} 계산</span>
                      <span className="text-gray-500">+ 더하기 · − 빼기 · 제외</span>
                      <div className="flex-1" />
                      <span className="text-gray-300 tabular-nums">= {computed[i]?.text || '0'}</span>
                    </div>
                    {!custom && auto && (
                      <div className="text-[10px] text-gray-500 mb-1.5">
                        지금은 기본 계산입니다({r.kind === 'subtotal' ? '바로 위 구분선 이후 항목의 합' : '총액 합 − 항목 합'}). 아래에서 행을 고르면 그 식으로 바뀝니다.
                      </div>
                    )}
                    {rows.some((x, j) => j !== i && canRefRow(x)) ? rows.map((x, j) => {
                      if (j === i || !canRefRow(x)) return null;
                      const op = x.id && r.formula ? r.formula[x.id] : undefined;
                      const btn = (v, label, on) => (
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => setOp(i, j, v)}
                          className={`w-7 h-5 rounded border text-[11px] leading-none transition disabled:opacity-40 ${on}`}
                        >{label}</button>
                      );
                      return (
                        <div key={j} className="flex items-center gap-1 py-0.5">
                          <span className="w-9 shrink-0 text-[10px] text-gray-500">{x.kind === 'total' ? '총액' : '항목'}</span>
                          <span className={`flex-1 min-w-0 truncate ${op ? 'text-gray-100' : 'text-gray-500'}`}>{x.label || '(이름 없음)'}</span>
                          <span className={`w-[110px] shrink-0 text-right tabular-nums ${op ? 'text-gray-200' : 'text-gray-600'}`}>{computed[j]?.text || '-'}</span>
                          {btn('-', '−', op === '-' ? 'border-sky-500 text-sky-200 bg-sky-900/40' : 'border-gray-700 text-gray-400 hover:text-gray-200')}
                          {btn(null, '제외', !op ? 'border-gray-500 text-gray-200 bg-gray-700/40 w-9' : 'border-gray-700 text-gray-500 hover:text-gray-200 w-9')}
                          {btn('+', '+', op === '+' ? 'border-rose-500 text-rose-200 bg-rose-900/40' : 'border-gray-700 text-gray-400 hover:text-gray-200')}
                        </div>
                      );
                    }) : (
                      <div className="text-[10px] text-gray-500">더하거나 뺄 항목·총액 행이 없습니다.</div>
                    )}
                    {!readOnly && (
                      <div className="flex gap-1 mt-1.5 pt-1.5 border-t border-gray-700/60">
                        {auto && (
                          <button type="button" onClick={() => loadDefaultFormula(i)} className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white"
                            title="기본 계산과 같은 선택으로 채웁니다 — 거기서 빼거나 더하면 됩니다">기본 계산 불러오기</button>
                        )}
                        {auto && custom && (
                          <button type="button" onClick={() => setFormula(i, undefined)} className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white">기본 계산으로 되돌리기</button>
                        )}
                        {calcTotal && formulaCount(r) > 0 && (
                          <button type="button" onClick={() => setFormula(i, {})} className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white">모두 제외</button>
                        )}
                        <div className="flex-1" />
                        <button type="button" onClick={() => setCalcOpen(null)} className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200">닫기</button>
                      </div>
                    )}
                  </div>
                )}
                </React.Fragment>
              );
            })}
          </div>

          {!readOnly && (
            <div className="flex flex-wrap gap-1 pt-2 mt-1 border-t border-gray-700 shrink-0">
              {ROW_KINDS.map(({ k, t, title: ti }) => (
                <button
                  key={k}
                  onClick={() => addRow(k)}
                  title={ti}
                  className="flex items-center gap-0.5 text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-indigo-600 transition"
                ><Plus size={10} /> {t}</button>
              ))}
              <div className="flex-1" />
              <span className="text-[10px] text-gray-500 self-center">{rows.length} / {MAX_FLOW_TABLE_ROWS}행</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
