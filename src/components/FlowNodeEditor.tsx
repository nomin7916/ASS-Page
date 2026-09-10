// @ts-nocheck
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, ChevronUp, ChevronDown, ClipboardPaste } from 'lucide-react';
import {
  computeFlowTable, normalizeFlowTable, flowTableFromText, sameFlowTable,
  FLOW_TABLE_BORDERS, MAX_FLOW_TABLE_ROWS, MAX_FLOW_TABLE_TEXT,
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
 * ⚠️ 이 팝업은 보드(z 990)의 **자식**이라 자체 스태킹 컨텍스트 안에서 뜬다. App의
 *    ConfirmDialog(z 1000)는 여전히 이 위에 뜨므로 확인창이 필요하면 그대로 쓸 수 있다.
 *    다만 별도 창(variant='page')에는 App이 없어 confirm이 없으므로 **행 삭제는 확인창을 쓰지
 *    않는다**(되돌리기 쉬운 조작이라 인라인 2단계도 두지 않았다).
 */

const ROW_KINDS = [
  { k: 'item', t: '항목', title: '값을 직접 적는 행. 소계·잔액 계산의 대상입니다.' },
  { k: 'subtotal', t: '소계', title: '바로 위 구분선 이후의 항목 합이 자동으로 들어갑니다.' },
  { k: 'total', t: '총액', title: '값을 직접 적는 행. 잔액 계산의 기준입니다.' },
  { k: 'balance', t: '잔액', title: '총액 합에서 항목 합을 뺀 값이 자동으로 들어갑니다.' },
  { k: 'rule', t: '구분선', title: '가로선만 그립니다. 소계는 이 선을 기준으로 끊깁니다.' },
];

const BORDER_LABEL = { none: '없음', outline: '바깥만', all: '전체' };

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:border-indigo-500 outline-none';

export default function FlowNodeEditor({ node, title, onPatch, onClose, readOnly, initialTab = 'memo' }) {
  const [tab, setTab] = useState(initialTab);
  const [memo, setMemo] = useState(node?.memo ?? '');
  // 표는 **로컬 사본**으로 들고 blur·구조 변경에서 커밋한다.
  const [tbl, setTbl] = useState(() => normalizeFlowTable(node?.table) || null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [notice, setNotice] = useState('');

  // flush는 언마운트에서 호출되므로 클로저가 아니라 ref를 읽어야 한다.
  const memoRef = useRef(memo); memoRef.current = memo;
  const tblRef = useRef(tbl); tblRef.current = tbl;
  const baseRef = useRef({ memo: node?.memo ?? '', table: normalizeFlowTable(node?.table) || null });
  const patchRef = useRef(onPatch); patchRef.current = onPatch;
  const idRef = useRef(node?.id); idRef.current = node?.id;
  const roRef = useRef(readOnly); roRef.current = readOnly;

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

  // Esc로 닫기. ⚠️ 보드의 onKeyDownCapture가 Escape를 소비하기 전에 여기서 먼저 막는다
  //    (안 막으면 팝업이 아니라 보드가 닫히거나 선택이 풀린다).
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); }
  };

  const rows = tbl?.rows || [];
  const computed = computeFlowTable(tbl);

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
  const removeRow = (i) => applyRows(rows.filter((_, k) => k !== i));
  const moveRow = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
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
    <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 60 }} onKeyDown={onKeyDown}>
      {/* 백드롭 — 클릭하면 닫힌다(언마운트 flush가 편집을 회수하므로 유실되지 않는다) */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-[680px] max-w-[94vw] h-[560px] max-h-[88vh] flex flex-col rounded-lg border border-gray-700 bg-[#0f1623] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
          <div className="text-xs font-semibold text-gray-200 truncate max-w-[220px]" title={title}>{title || '도형'}</div>
          <div className="flex gap-1 ml-2">
            {[{ k: 'memo', t: '메모' }, { k: 'table', t: '표' }].map(({ k, t }) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`text-[11px] px-2 py-1 rounded border transition ${tab === k ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
              >
                {t}
                {k === 'memo' && memo ? <span className="ml-1 text-[9px] text-gray-500">●</span> : null}
                {k === 'table' && rows.length ? <span className="ml-1 text-[9px] text-gray-500">{rows.length}</span> : null}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-200" title="닫기 (Esc)"><X size={16} /></button>
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
                  <span className="text-gray-600">소계 = 바로 위 구분선 이후 항목의 합 · 잔액 = 총액 합 − 항목 합</span>
                </div>
              ) : rows.map((r, i) => {
                const auto = r.kind === 'subtotal' || r.kind === 'balance';
                const isRule = r.kind === 'rule';
                return (
                  <div key={i} className="flex items-center gap-1 mb-1">
                    <select
                      disabled={readOnly}
                      value={r.kind}
                      onChange={e => setRow(i, { kind: e.target.value }, true)}
                      className="w-[62px] shrink-0 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-[10px] text-gray-200 outline-none focus:border-indigo-500"
                    >
                      {ROW_KINDS.map(({ k, t, title: ti }) => <option key={k} value={k} title={ti}>{t}</option>)}
                    </select>
                    <input
                      className={`${inputCls} flex-1 min-w-0 ${isRule ? 'opacity-40' : ''}`}
                      value={r.label}
                      readOnly={readOnly || isRule}
                      maxLength={MAX_FLOW_TABLE_TEXT}
                      placeholder={isRule ? '─────' : '항목 이름'}
                      onChange={e => setRow(i, { label: e.target.value })}
                      onBlur={flush}
                    />
                    {auto ? (
                      <div
                        className="w-[110px] shrink-0 px-2 py-1 text-xs text-right text-emerald-300/90 italic bg-gray-800/40 border border-gray-700/60 rounded truncate"
                        title="자동 계산된 값입니다"
                      >{computed[i]?.text || '0'}</div>
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
    </div>
  );
}
