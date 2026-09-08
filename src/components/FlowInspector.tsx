// @ts-nocheck
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cleanNum } from '../utils';
import {
  sanitizeHexColor, DEFAULT_NODE_FILL, DEFAULT_EDGE_STROKE, normalizeFlowArrow, arrowHeads,
  flowLineRender, resolveFlowLineStyle, normalizeFlowLineWidth, FLOW_CANVAS_BG,
} from '../flowMap';

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

/**
 * 화살촉 위치 = 자금 흐름 방향. 글리프를 실제로 화살촉이 붙는 쪽에 두어 한눈에 읽히게 한다.
 * ⚠️ 'from'(시작)을 빼지 말 것 — 도형을 이어 그린 순서와 돈의 방향이 반대인 경우가 흔한데,
 *    그러면 사용자가 할 수 있는 일이 '선을 지우고 반대로 다시 긋기'뿐이 된다.
 */
const ARROW_CHOICES = [
  { k: 'to',   t: '끝 →',   title: '끝(나중에 클릭한 도형) 쪽에 화살촉 — 선을 그은 방향대로 흐릅니다' },
  { k: 'from', t: '← 시작', title: '시작(먼저 클릭한 도형) 쪽에 화살촉 — 그은 방향과 반대로 흐릅니다' },
  { k: 'both', t: '양쪽 ↔', title: '양쪽 끝에 화살촉' },
  { k: 'none', t: '없음',   title: '화살촉 없음' },
];

/**
 * 지금 설정이 어느 방향을 뜻하는지 도형 이름으로 풀어 쓴다.
 * ⚠️ 반드시 `arrowHeads`에서 파생시킬 것 — 여기서 arrow 값을 다시 비교하면 캔버스에 그려진
 *    화살촉과 패널이 설명하는 방향이 갈린다(그게 이 문구의 존재 이유를 정면으로 부순다).
 */
const arrowFlowText = (arrow, ends) => {
  const h = arrowHeads(arrow);
  const a = ends?.from || '시작 도형';
  const b = ends?.to || '끝 도형';
  if (h.start && h.end) return `양방향 — ${a} ↔ ${b}`;
  if (!h.start && !h.end) return `방향 표시 없음 — ${a} · ${b}`;
  return h.end ? `자금 흐름: ${a} → ${b}` : `자금 흐름: ${b} → ${a}`;
};

/** 선 종류 — 값은 flowMap.FLOW_LINE_STYLES 순서와 같게 유지한다. */
const LINE_STYLE_CHOICES = [
  { k: 'solid', t: '실선' },
  { k: 'dot', t: '점선' },
  { k: 'dash', t: '파선' },
  { k: 'longDash', t: '긴 파선' },
  { k: 'dashDot', t: '일점쇄선' },
  { k: 'dashDotDot', t: '이점쇄선' },
  { k: 'double', t: '이중선' },
];

const LINE_WIDTH_CHOICES = [
  { k: 'thin', t: '얇게' },
  { k: 'normal', t: '보통' },
  { k: 'thick', t: '굵게' },
];

/**
 * 선 종류 미리보기 — 캔버스와 **같은 `flowLineRender`**로 그린다. 손으로 dasharray를 적으면
 * 고른 모양과 실제로 그려지는 모양이 갈려서 미리보기가 존재할 이유가 사라진다.
 * ⚠️ 배경을 FLOW_CANVAS_BG로 두는 것이 이중선의 전제다 — 이중선은 가운데를 배경색으로 덮어
 *    만들기 때문에, 버튼 배경이 캔버스와 다르면 미리보기의 가운데 띠만 다른 색이 된다.
 */
function LinePreview({ style, width, color }) {
  const r = flowLineRender({ lineStyle: style, lineWidth: width });
  return (
    <svg className="w-full block" height="14" aria-hidden="true">
      {r.double && <line x1="2" y1="7" x2="100%" y2="7" stroke={color} strokeWidth={r.width} />}
      <line
        x1="2"
        y1="7"
        x2="100%"
        y2="7"
        stroke={r.double ? FLOW_CANVAS_BG : color}
        strokeWidth={r.double ? r.innerWidth : r.width}
        strokeDasharray={r.dash}
      />
    </svg>
  );
}

/** 한 번에 누를 수 있는 자주 쓰는 색(기존 8색 그대로 — 이미 이 색으로 칠해 둔 도형이 있다). */
const QUICK_COLORS = [
  { hex: '#2E75B6', name: '파랑' },
  { hex: '#ED7D31', name: '주황' },
  { hex: '#70AD47', name: '초록' },
  { hex: '#A5A5A5', name: '회색' },
  { hex: '#7C3AED', name: '보라' },
  { hex: '#DC2626', name: '빨강' },
  { hex: '#0F766E', name: '청록' },
  { hex: '#334155', name: '검정' },
];

/* ===========================================================================
 * 엑셀식 색 팔레트 (테마 색 + 표준 색)
 * 기준 테마는 사용자가 보내온 엑셀 화면과 같은 Office 2007 테마다.
 * ⚠️ 색을 하드코딩 60개로 늘어놓지 말 것 — 열마다 밝기 변형 5단은 엑셀과 같은 규칙(밝게/어둡게
 *    비율)으로 계산한다. 표를 손으로 적으면 한 칸만 틀려도 아무도 눈치채지 못한다.
 * =========================================================================== */

const THEME_COLUMNS = [
  { base: '#FFFFFF', name: '흰색',        steps: [-0.05, -0.15, -0.25, -0.35, -0.50] },
  { base: '#000000', name: '검정',        steps: [0.50, 0.35, 0.25, 0.15, 0.05] },
  { base: '#EEECE1', name: '연한 회갈색', steps: [-0.10, -0.25, -0.50, -0.75, -0.90] },
  { base: '#1F497D', name: '진한 파랑',   steps: [0.80, 0.60, 0.40, -0.25, -0.50] },
  { base: '#4F81BD', name: '파랑',        steps: [0.80, 0.60, 0.40, -0.25, -0.50] },
  { base: '#C0504D', name: '빨강',        steps: [0.80, 0.60, 0.40, -0.25, -0.50] },
  { base: '#9BBB59', name: '녹색',        steps: [0.80, 0.60, 0.40, -0.25, -0.50] },
  { base: '#8064A2', name: '보라',        steps: [0.80, 0.60, 0.40, -0.25, -0.50] },
  { base: '#4BACC6', name: '청록',        steps: [0.80, 0.60, 0.40, -0.25, -0.50] },
  { base: '#F79646', name: '주황',        steps: [0.80, 0.60, 0.40, -0.25, -0.50] },
];

const STANDARD_COLORS = [
  { hex: '#C00000', name: '진한 빨강' },
  { hex: '#FF0000', name: '빨강' },
  { hex: '#FFC000', name: '주황' },
  { hex: '#FFFF00', name: '노랑' },
  { hex: '#92D050', name: '연한 녹색' },
  { hex: '#00B050', name: '녹색' },
  { hex: '#00B0F0', name: '연한 파랑' },
  { hex: '#0070C0', name: '파랑' },
  { hex: '#002060', name: '진한 파랑' },
  { hex: '#7030A0', name: '자주' },
];

/** p > 0 이면 흰색 쪽으로, p < 0 이면 검정 쪽으로 섞는다(엑셀의 '밝게/어둡게 %'와 같은 규칙). */
const shiftHex = (hex, p) => {
  const n = parseInt(hex.slice(1), 16);
  const out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const v = p >= 0 ? c + (255 - c) * p : c * (1 + p);
    return Math.max(0, Math.min(255, Math.round(v)));
  });
  return `#${out.map(c => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

/** 6행 × 10열(0행 = 기본색, 1~5행 = 밝기 변형). 모듈 로드 시 1회만 계산. */
const THEME_GRID = (() => {
  const rows = [THEME_COLUMNS.map(c => c.base.toUpperCase())];
  for (let r = 0; r < 5; r++) rows.push(THEME_COLUMNS.map(c => shiftHex(c.base, c.steps[r])));
  return rows;
})();

function Swatch({ hex, title, current, onPick, disabled, size }) {
  const on = current === hex.toUpperCase();
  return (
    <button
      type="button"
      disabled={disabled}
      title={title || hex}
      onClick={() => onPick(hex)}
      className={`rounded-[2px] border transition disabled:opacity-40 ${on ? 'border-white ring-1 ring-indigo-400' : 'border-black/50 hover:border-gray-200'}`}
      style={{ background: hex, height: size }}
    />
  );
}

/**
 * 색 선택기 — 도형 채우기와 연결선 색이 **같은 컴포넌트**를 쓴다(손복제하면 두 곳의 팔레트가 갈린다).
 *
 * ⚠️ 팝오버(부동 레이어)로 만들지 말 것 — 이 패널은 overflow-y-auto라 absolute 팝오버가 잘린다
 *    (CustomDatePicker가 같은 이유로 body 포털 + fixed 좌표를 써야 했다). 여기서는 접이식으로 두어
 *    그 문제 자체를 만들지 않는다.
 * ⚠️ onPick(null) = '기본색으로 되돌리기'(필드 자체를 지운다). 기본색 hex를 저장값으로 박으면
 *    나중에 기본색을 바꿔도 그 도형만 옛 색에 남는다.
 */
function ColorPicker({ value, fallback, onPick, disabled }) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState('');
  const stored = sanitizeHexColor(value);
  const current = (stored || fallback).toUpperCase();

  const applyDraft = () => {
    const c = sanitizeHexColor(hexDraft);
    if (!c) return;
    onPick(c.toUpperCase());
    setHexDraft('');
  };

  return (
    <>
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="w-7 h-7 rounded border border-gray-500 shrink-0"
          style={{ background: current }}
          title={`현재 색 ${current}`}
        />
        <span className="text-[10px] text-gray-400 flex-1 truncate">{current}{stored ? '' : ' (기본)'}</span>
        <button
          type="button"
          disabled={disabled || !stored}
          onClick={() => onPick(null)}
          className="text-[10px] px-1.5 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition disabled:opacity-30"
          title="기본색으로 되돌리기"
        >기본</button>
      </div>

      <div className="grid grid-cols-8 gap-1">
        {QUICK_COLORS.map(c => (
          <Swatch key={c.hex} hex={c.hex} title={`${c.name} ${c.hex}`} current={current} onPick={onPick} disabled={disabled} size={22} />
        ))}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="mt-1.5 w-full flex items-center justify-center gap-1 text-[10px] py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition disabled:opacity-40"
      >
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />} {open ? '색 접기' : '색 더 보기'}
      </button>

      {open && (
        <div className="mt-1.5 p-2 rounded border border-gray-700 bg-gray-900/60">
          <div className="text-[10px] text-gray-400 mb-1">테마 색</div>
          {THEME_GRID.map((row, ri) => (
            <div key={ri} className="grid grid-cols-10 gap-[2px] mb-[2px]">
              {row.map((hex, ci) => (
                <Swatch
                  key={`${ri}-${ci}`}
                  hex={hex}
                  title={`${THEME_COLUMNS[ci].name} ${hex}`}
                  current={current}
                  onPick={onPick}
                  disabled={disabled}
                  size={17}
                />
              ))}
            </div>
          ))}

          <div className="text-[10px] text-gray-400 mt-2 mb-1">표준 색</div>
          <div className="grid grid-cols-10 gap-[2px]">
            {STANDARD_COLORS.map(c => (
              <Swatch key={c.hex} hex={c.hex} title={`${c.name} ${c.hex}`} current={current} onPick={onPick} disabled={disabled} size={17} />
            ))}
          </div>

          <div className="mt-2 flex items-center gap-1">
            <input
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-100 focus:border-indigo-500 outline-none"
              value={hexDraft}
              readOnly={disabled}
              placeholder="#RRGGBB"
              onChange={e => setHexDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyDraft(); } }}
            />
            <button
              type="button"
              disabled={disabled || !sanitizeHexColor(hexDraft)}
              onClick={applyDraft}
              className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white transition disabled:opacity-30"
            >적용</button>
          </div>
        </div>
      )}
    </>
  );
}

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
  /** { from, to } — 선택된 연결선 양 끝 도형의 **표시 이름**(라이브 파생, 저장하지 않는다). */
  edgeEnds,
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

  // ⚠️ 이 세 값은 **이 컴포넌트 렌더 스코프**에 있어야 한다 — 다른 최상위 블록(LinePreview 등)의
  //    지역 변수를 JSX가 참조하면 런타임 ReferenceError로 화면이 통째로 오류 페이지가 되는데
  //    @ts-nocheck + esbuild라 빌드도 undefcheck도 잡지 못한다(initTradeRest 프로덕션 장애와 동일).
  // ⚠️ 선 종류는 resolveFlowLineStyle로 읽는다 — 레거시 `dashed:true` 선을 직접 읽으면 실선으로 표시된다.
  const curLineStyle = resolveFlowLineStyle(edge?.lineStyle, edge?.dashed);
  const curLineWidth = normalizeFlowLineWidth(edge?.lineWidth);
  const curEdgeColor = sanitizeHexColor(edge?.stroke) || DEFAULT_EDGE_STROKE;

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

          <Field label="색상" hint="밝은 색을 고르면 글자색이 자동으로 어두워집니다.">
            <ColorPicker
              value={node.fill}
              fallback={DEFAULT_NODE_FILL}
              disabled={readOnly}
              onPick={(hex) => patch({ fill: hex || undefined })}
            />
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
          <Field label="선 색상" hint="화살촉과 글자 상자 테두리도 같은 색을 따릅니다.">
            <ColorPicker
              value={edge.stroke}
              fallback={DEFAULT_EDGE_STROKE}
              disabled={readOnly}
              onPick={(hex) => patchEdge({ stroke: hex || undefined })}
            />
          </Field>
          {/* ⚠️ '한쪽' 한 칸을 시작/끝 두 칸으로 나눈 것이 이 패널의 핵심이다 — 도형을 이어 그린
              순서와 실제 돈의 방향이 반대인 경우가 흔한데, 종전에는 선을 지우고 반대로 다시 긋는
              방법밖에 없었다. 값 비교·표시는 flowMap.normalizeFlowArrow/arrowHeads 공유. */}
          <Field label="화살표 (자금 흐름 방향)">
            <div className="grid grid-cols-4 gap-1">
              {ARROW_CHOICES.map(({ k, t, title }) => (
                <button
                  key={k}
                  disabled={readOnly}
                  title={title}
                  onClick={() => patchEdge({ arrow: k })}
                  className={`text-[10px] py-1 rounded border transition ${normalizeFlowArrow(edge.arrow) === k ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                >{t}</button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-gray-500 leading-snug break-words">
              {arrowFlowText(edge.arrow, edgeEnds)}
            </div>
          </Field>
          {/* ⚠️ 미리보기는 지금 고른 **색·굵기**로 그린다 — 검은 실선 견본만 보여주면 굵게 골랐을 때
              어떻게 보일지 알 수 없다. 기본값(실선/보통)은 저장하지 않는다(undefined로 지운다). */}
          <Field label="선 종류">
            <div className="grid grid-cols-2 gap-1">
              {LINE_STYLE_CHOICES.map(({ k, t }) => (
                <button
                  key={k}
                  disabled={readOnly}
                  title={t}
                  onClick={() => patchEdge({ lineStyle: k === 'solid' ? undefined : k })}
                  className={`px-1.5 py-1 rounded border transition ${curLineStyle === k ? 'border-indigo-500 ring-1 ring-indigo-500/50' : 'border-gray-700 hover:border-gray-500'}`}
                  style={{ background: FLOW_CANVAS_BG }}
                >
                  <LinePreview style={k} width={curLineWidth} color={curEdgeColor} />
                  <span className={`block text-[9px] mt-0.5 ${curLineStyle === k ? 'text-indigo-300' : 'text-gray-500'}`}>{t}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="선 굵기">
            <div className="grid grid-cols-3 gap-1">
              {LINE_WIDTH_CHOICES.map(({ k, t }) => (
                <button
                  key={k}
                  disabled={readOnly}
                  onClick={() => patchEdge({ lineWidth: k === 'normal' ? undefined : k })}
                  className={`text-[10px] py-1 rounded border transition ${curLineWidth === k ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                >{t}</button>
              ))}
            </div>
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
