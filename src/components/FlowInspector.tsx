// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { cleanNum } from '../utils';

/**
 * 흐름도 속성 패널.
 *
 * ⚠️ 텍스트 입력은 로컬 draft + **onBlur 1회 커밋**이다. onChange마다 커밋하면 키스트로크마다
 *    상위 커밋 → App 지문 재계산이 돌아 타이핑이 끊긴다. blur 커밋의 대가(타이핑 중 alt-tab에서
 *    마지막 편집 유실)는 App의 종료 커밋(flowFlushRef)이 덮는다.
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
  onPatchNode, onPatchEdge,
  onDeleteNode, onDeleteEdge,
  onClose,
  readOnly,
}) {
  const [d, setD] = useState({ label: '', date: '', memo: '', amountManual: '', edgeLabel: '' });

  // 선택이 바뀌면 draft를 그 대상 값으로 리셋
  useEffect(() => {
    if (node) {
      setD({
        label: node.label ?? '',
        date: node.date ?? '',
        memo: node.memo ?? '',
        amountManual: node.amountManual == null ? '' : String(node.amountManual),
        edgeLabel: '',
      });
    } else if (edge) {
      setD(p => ({ ...p, edgeLabel: edge.label ?? '' }));
    }
  }, [node?.id, edge?.id]);

  if (!node && !edge) return null;

  const patch = (o) => { if (!readOnly) onPatchNode?.(o); };

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
              onBlur={() => { if (d.date !== (node.date ?? '')) patch({ date: d.date }); }}
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
              onBlur={() => { if (d.label !== (node.label ?? '')) patch({ label: d.label }); }}
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
                onBlur={() => {
                  const raw = d.amountManual.trim();
                  const v = raw === '' ? null : cleanNum(raw);
                  if (v !== node.amountManual) patch({ amountManual: v });
                }}
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
              onBlur={() => { if (d.memo !== (node.memo ?? '')) patch({ memo: d.memo }); }}
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
              onBlur={() => { if (d.edgeLabel !== (edge.label ?? '')) onPatchEdge?.({ label: d.edgeLabel }); }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
          </Field>
          <Field label="화살표">
            <div className="flex gap-1">
              {[{ k: 'to', t: '한쪽' }, { k: 'both', t: '양쪽' }, { k: 'none', t: '없음' }].map(({ k, t }) => (
                <button
                  key={k}
                  disabled={readOnly}
                  onClick={() => onPatchEdge?.({ arrow: k })}
                  className={`flex-1 text-[11px] py-1 rounded border transition ${(edge.arrow || 'to') === k ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                >{t}</button>
              ))}
            </div>
          </Field>
          <Field label="선 모양">
            <button
              disabled={readOnly}
              onClick={() => onPatchEdge?.({ dashed: !edge.dashed })}
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
