// @ts-nocheck
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { cleanNum } from '../utils';

/**
 * 흐름도 속성 패널.
 *
 * ⚠️ 텍스트 입력은 로컬 draft + **커밋 1회**다. onChange마다 커밋하면 키스트로크마다 상위 커밋 →
 *    App 지문 재계산이 돌아 타이핑이 끊긴다.
 *
 * ⚠️ **draft는 반드시 '누구의 것인지'(ownerRef)와 함께 들고, 커밋도 그 id로 한다.**
 *    onBlur만 믿고 현재 선택(selNode)에 커밋하면 두 가지가 조용히 깨진다:
 *    ① 도형 A의 이름을 타이핑하다 캔버스에서 B를 클릭하면 pointerdown → onSelect(B) 리렌더가
 *       blur보다 **먼저** 처리돼(discrete 이벤트 동기 flush) A의 입력값이 **B에 기록**된다.
 *    ② 배경을 클릭해 선택이 해제되면 이 패널이 **언마운트**되는데, 제거된 DOM 노드에는 브라우저가
 *       blur/focusout을 발화하지 않아 메모 전체가 **아무 데도 저장되지 않고 사라진다**.
 *    → 대상 변경(useLayoutEffect)·언마운트 양쪽에서 이전 owner에게 flush한다.
 *    (⚠️ App의 종료 커밋 flowFlushRef는 이걸 못 덮는다 — 그건 FlowBoard의 localRef만 회수하고
 *      미커밋 draft는 이 컴포넌트 로컬 state에만 있다.)
 *
 * ⚠️ 계좌 연결은 **id 참조만** 저장한다. 계좌명·평가액을 노드에 복사하면 라이브 값과 갈라지고
 *    지문이 시세마다 흔들린다(accountNameSnapshot은 바인딩 시점 1회 기록하는 표시 폴백 전용).
 */

const FILLS = [
  { hex: '#2E75B6', name: '파랑' },
  { hex: '#ED7D31', name: '주황' },
  { hex: '#70AD47', name: '초록' },
  { hex: '#A5A5A5', name: '회색' },
  { hex: '#7C3AED', name: '보라' },
  { hex: '#DC2626', name: '빨강' },
  { hex: '#0F766E', name: '청록' },
  { hex: '#334155', name: '검정' },
];

function Field({ label, children, hint }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] text-gray-400 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:border-indigo-500 outline-none';

export default function FlowInspector({
  node, view, edge,
  accountOptions,
  onPatchNodeById, onPatchEdgeById,
  onDeleteNode, onDeleteEdge,
  onClose,
  readOnly,
}) {
  const EMPTY_DRAFT = { label: '', date: '', memo: '', amountManual: '', edgeLabel: '' };
  const [d, setD] = useState(EMPTY_DRAFT);

  // 최신 값 미러 — flush는 effect cleanup/언마운트에서 호출되므로 클로저가 아니라 ref를 읽어야 한다
  const dRef = useRef(d);
  dRef.current = d;
  const ownerRef = useRef(null);   // { nodeId | edgeId, base }
  const patchNodeRef = useRef(onPatchNodeById);
  patchNodeRef.current = onPatchNodeById;
  const patchEdgeRef = useRef(onPatchEdgeById);
  patchEdgeRef.current = onPatchEdgeById;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const draftOf = (n, e) => (n
    ? { label: n.label ?? '', date: n.date ?? '', memo: n.memo ?? '',
        amountManual: n.amountManual == null ? '' : String(n.amountManual), edgeLabel: '' }
    : { ...EMPTY_DRAFT, edgeLabel: e?.label ?? '' });

  /** 미커밋 draft를 **draft의 주인**에게 커밋. 대상 변경·언마운트·blur 모두 이 함수 하나를 쓴다. */
  const flushDraft = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner || readOnlyRef.current) return;
    const cur = dRef.current;
    const base = owner.base;
    if (owner.nodeId) {
      const o = {};
      if (cur.label !== base.label) o.label = cur.label;
      if (cur.date !== base.date) o.date = cur.date;
      if (cur.memo !== base.memo) o.memo = cur.memo;
      const raw = String(cur.amountManual ?? '').trim();
      const v = raw === '' ? null : cleanNum(raw);
      const baseRaw = String(base.amountManual ?? '').trim();
      const baseV = baseRaw === '' ? null : cleanNum(baseRaw);
      if (v !== baseV) o.amountManual = v;
      if (Object.keys(o).length > 0) {
        patchNodeRef.current?.(owner.nodeId, o);
        ownerRef.current = { ...owner, base: { ...base, ...cur } };
      }
    } else if (owner.edgeId) {
      if (cur.edgeLabel !== base.edgeLabel) {
        patchEdgeRef.current?.(owner.edgeId, { label: cur.edgeLabel });
        ownerRef.current = { ...owner, base: { ...base, edgeLabel: cur.edgeLabel } };
      }
    }
  }, []);

  // 대상이 바뀌면 **이전 주인에게 먼저 flush**한 뒤 새 대상 값으로 draft를 리셋한다.
  // ⚠️ useEffect(passive)가 아니라 useLayoutEffect — passive는 Scheduler 태스크에서 늦게 돌아
  //    blur보다 뒤처지고, 그 사이 커밋이 새로 선택된 도형으로 새어 나간다.
  useLayoutEffect(() => {
    const nextId = node?.id ?? null;
    const nextEdgeId = edge?.id ?? null;
    const owner = ownerRef.current;
    if (owner && (owner.nodeId !== nextId || owner.edgeId !== nextEdgeId)) flushDraft();
    const nd = draftOf(node, edge);
    ownerRef.current = nextId || nextEdgeId ? { nodeId: nextId, edgeId: nextEdgeId, base: nd } : null;
    setD(nd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, edge?.id]);

  // 언마운트(배경 클릭으로 선택 해제·보드 닫기) 시 flush — blur가 발화하지 않는 유일한 안전망
  useLayoutEffect(() => () => { flushDraft(); }, [flushDraft]);

  if (!node && !edge) return null;

  /** 즉시 반영 컨트롤(모양·색상·계좌연결·금액출처·화살표·점선) — draft를 거치지 않는다 */
  const patch = (o) => { if (!readOnly && node) onPatchNodeById?.(node.id, o); };
  const patchEdge = (o) => { if (!readOnly && edge) onPatchEdgeById?.(edge.id, o); };

  return (
    <div className="w-64 shrink-0 h-full overflow-y-auto bg-[#0f1623] border-l border-gray-700 p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-gray-200">{node ? '도형 속성' : '연결선 속성'}</div>
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300" title="패널 닫기"><X size={14} /></button>
      </div>

      {node && (
        <>
          <Field label="모양">
            <div className="flex gap-1">
              {[{ k: 'rect', t: '사각형' }, { k: 'ellipse', t: '원' }].map(({ k, t }) => (
                <button
                  key={k}
                  disabled={readOnly}
                  onClick={() => patch({ kind: k })}
                  className={`flex-1 text-[11px] py-1 rounded border transition ${node.kind === k ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                >{t}</button>
              ))}
            </div>
          </Field>

          <Field label="색상">
            <div className="flex flex-wrap gap-1">
              {FILLS.map(f => (
                <button
                  key={f.hex}
                  disabled={readOnly}
                  title={f.name}
                  onClick={() => patch({ fill: f.hex })}
                  className={`w-6 h-6 rounded border-2 transition ${(node.fill || '#2E75B6') === f.hex ? 'border-indigo-400' : 'border-transparent'}`}
                  style={{ background: f.hex }}
                />
              ))}
            </div>
          </Field>

          <Field
            label="날짜 · 만기"
            hint="자유 입력 — '2027-05-01'도, '27년 5월'·'제한 없음'도 됩니다."
          >
            <input
              className={inputCls}
              value={d.date}
              readOnly={readOnly}
              placeholder="예: 27년 5월"
              onChange={e => setD(p => ({ ...p, date: e.target.value }))}
              onBlur={flushDraft}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
            {/* ⚠️ 계좌 레벨 만기 필드는 존재하지 않는다 — dc-irp 예적금 항목의 endDate만 '제안'한다(자동 채움 아님). */}
            {!readOnly && view?.maturityCandidates?.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {view.maturityCandidates.map(c => (
                  <button
                    key={c.itemId}
                    onClick={() => { setD(p => ({ ...p, date: c.endDate })); patch({ date: c.endDate }); }}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-teal-700/60 text-teal-300 bg-teal-900/30 hover:bg-teal-900/60"
                    title={`${c.name} 만기 채우기`}
                  >{c.endDate}</button>
                ))}
              </div>
            )}
          </Field>

          <Field label="이름" hint={view?.linked && !d.label ? '비우면 연결 계좌명이 표시됩니다.' : ''}>
            <input
              className={inputCls}
              value={d.label}
              readOnly={readOnly}
              placeholder={view?.resolved ? (view.displayName || '계좌명') : '도형 이름'}
              onChange={e => setD(p => ({ ...p, label: e.target.value }))}
              onBlur={flushDraft}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
          </Field>

          <Field label="계좌 연결" hint={view?.dangling ? '연결된 계좌를 찾을 수 없습니다(삭제됨). 다시 선택하거나 해제하세요.' : ''}>
            <select
              className={inputCls}
              disabled={readOnly}
              value={node.portfolioId || ''}
              onChange={e => {
                const id = e.target.value;
                if (!id) { patch({ portfolioId: null, accountNameSnapshot: '', amountSource: 'none' }); return; }
                const opt = accountOptions.find(o => o.id === id);
                // ⚠️ accountNameSnapshot은 **바인딩 시점 1회만** 기록(라이브 값 복사 금지)
                patch({ portfolioId: id, accountNameSnapshot: opt?.name || '', amountSource: 'account' });
              }}
            >
              <option value="">— 연결 안 함 —</option>
              {accountOptions.map(o => (
                <option key={o.id} value={o.id}>{o.name}{o.deleted ? ' (삭제됨)' : ''}{o.isTest ? ' [TEST]' : ''}</option>
              ))}
            </select>
          </Field>

          <Field label="금액">
            <div className="flex gap-1 mb-1">
              {[{ k: 'account', t: '계좌 자동' }, { k: 'manual', t: '직접입력' }, { k: 'none', t: '표시 안 함' }].map(({ k, t }) => (
                <button
                  key={k}
                  disabled={readOnly || (k === 'account' && !node.portfolioId)}
                  onClick={() => patch({ amountSource: k })}
                  className={`flex-1 text-[10px] py-1 rounded border transition disabled:opacity-40 ${node.amountSource === k ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                >{t}</button>
              ))}
            </div>
            {node.amountSource === 'manual' && (
              <input
                className={inputCls}
                value={d.amountManual}
                readOnly={readOnly}
                inputMode="numeric"
                placeholder="예: 100000000"
                onChange={e => setD(p => ({ ...p, amountManual: e.target.value }))}
                onBlur={flushDraft}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            )}
            {node.amountSource === 'account' && (
              <div className="text-[10px] text-gray-500">
                {view?.deleted ? '삭제된 계좌 — 금액 표시 안 함'
                  : view?.liveAmount == null ? '평가액을 불러오는 중이거나 없습니다'
                  : '현재 평가액이 자동 표시됩니다'}
              </div>
            )}
          </Field>

          <Field label="메모">
            <textarea
              className={`${inputCls} resize-y`}
              rows={5}
              value={d.memo}
              readOnly={readOnly}
              placeholder={'여러 줄 입력 가능\n예) 月 100만원\n    한도 1.7억'}
              onChange={e => setD(p => ({ ...p, memo: e.target.value }))}
              onBlur={flushDraft}
            />
          </Field>

          {!readOnly && (
            <button
              onClick={() => onDeleteNode?.(node.id)}
              className="w-full flex items-center justify-center gap-1 text-[11px] py-1.5 rounded border border-red-800/60 text-red-300 hover:bg-red-900/30 transition"
            >
              <Trash2 size={12} /> 도형 삭제
            </button>
          )}
        </>
      )}

      {edge && (
        <>
          <Field label="선 위 글자">
            <input
              className={inputCls}
              value={d.edgeLabel}
              readOnly={readOnly}
              placeholder="예: 이전 · 만기 이체"
              onChange={e => setD(p => ({ ...p, edgeLabel: e.target.value }))}
              onBlur={flushDraft}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
          </Field>
          <Field label="화살표">
            <div className="flex gap-1">
              {[{ k: 'to', t: '한쪽' }, { k: 'both', t: '양쪽' }, { k: 'none', t: '없음' }].map(({ k, t }) => (
                <button
                  key={k}
                  disabled={readOnly}
                  onClick={() => patchEdge({ arrow: k })}
                  className={`flex-1 text-[11px] py-1 rounded border transition ${(edge.arrow || 'to') === k ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                >{t}</button>
              ))}
            </div>
          </Field>
          <Field label="선 모양">
            <button
              disabled={readOnly}
              onClick={() => patchEdge({ dashed: !edge.dashed })}
              className={`w-full text-[11px] py-1 rounded border transition ${edge.dashed ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
            >{edge.dashed ? '점선' : '실선'}</button>
          </Field>
          {!readOnly && (
            <button
              onClick={() => onDeleteEdge?.(edge.id)}
              className="w-full flex items-center justify-center gap-1 text-[11px] py-1.5 rounded border border-red-800/60 text-red-300 hover:bg-red-900/30 transition"
            >
              <Trash2 size={12} /> 연결선 삭제
            </button>
          )}
        </>
      )}
    </div>
  );
}
