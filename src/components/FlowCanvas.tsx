// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  edgePath, anchorPoint, roundNode, snapToGrid,
  MIN_NODE_W, MIN_NODE_H, FLOW_GRID,
} from '../flowMap';

/**
 * 흐름도 캔버스 — SVG 렌더 + Pointer Events 드래그/리사이즈/연결.
 *
 * ⚠️ 드래그·리사이즈 중에는 **로컬 state만** 갱신하고, pointerup에서 1회 커밋한다.
 *    프레임마다 상위로 올리면 App의 portfolioStructureKey가 전 계좌를 매 프레임 재직렬화한다.
 * ⚠️ React.memo 필수 — 이 저장소에는 memo가 이 컴포넌트뿐이므로 상위가 리렌더될 때
 *    캔버스까지 재조정되는 것을 여기서 끊는다. 그러려면 상위가 넘기는 콜백이 전부
 *    useCallback으로 고정돼 있어야 한다(FlowBoard 참조).
 * ⚠️ 팬/줌(viewport)은 저장하지 않는다 — 세션 한정(FloatingCalculator의 창 위치와 동일 정책).
 */

const PALETTE_STROKE = '#1f2937';

function NodeShape({ n, fill, stroke, selected, dangling }) {
  const common = {
    fill,
    stroke: selected ? '#818cf8' : dangling ? '#f59e0b' : (stroke || PALETTE_STROKE),
    strokeWidth: selected ? 3 : dangling ? 2 : 1.5,
  };
  if (n.kind === 'ellipse') {
    return <ellipse cx={n.x + n.w / 2} cy={n.y + n.h / 2} rx={n.w / 2} ry={n.h / 2} {...common} />;
  }
  return <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={14} ry={14} {...common} />;
}

function FlowCanvasInner({
  map,
  viewOf,
  selectedId,
  onSelect,
  onNodesChange,      // (nodes) => void  — 커밋 1회
  onAddEdge,          // (fromId, toId) => void
  onBackgroundClick,
  viewport,
  onViewportChange,
  readOnly,
  hideAmounts,
  formatAmount,
  connectFrom,        // 연결 시작 노드 id (null이면 비활성)
  onConnectFromChange,
}) {
  const svgRef = useRef(null);
  // 드래그/리사이즈 중 임시 상태 — 커밋 전까지 상위로 올리지 않는다
  const [drag, setDrag] = useState(null);   // {mode:'move'|'resize', id, ox, oy, base:{x,y,w,h}}
  const [pan, setPan] = useState(null);     // {ox, oy, base:{x,y}}
  const [hoverId, setHoverId] = useState(null);

  const nodes = map?.nodes || [];
  const edges = map?.edges || [];

  // 화면 좌표 → 캔버스 좌표
  const toCanvas = useCallback((clientX, clientY) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: (clientX - r.left - viewport.x) / viewport.scale,
      y: (clientY - r.top - viewport.y) / viewport.scale,
    };
  }, [viewport.x, viewport.y, viewport.scale]);

  // 드래그 중인 노드만 오프셋을 얹어 보여준다(나머지 노드는 원본 참조 그대로 → 재조정 최소화)
  const liveNode = useCallback((n) => {
    if (!drag || drag.id !== n.id) return n;
    if (drag.mode === 'move') return { ...n, x: drag.base.x + drag.dx, y: drag.base.y + drag.dy };
    return {
      ...n,
      w: Math.max(MIN_NODE_W, drag.base.w + drag.dx),
      h: Math.max(MIN_NODE_H, drag.base.h + drag.dy),
    };
  }, [drag]);

  const nodeById = useCallback((id) => {
    const n = nodes.find(x => x.id === id);
    return n ? liveNode(n) : undefined;
  }, [nodes, liveNode]);

  const startDrag = (e, n, mode) => {
    if (readOnly) return;
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저·비신뢰 이벤트 */ }
    const p = toCanvas(e.clientX, e.clientY);
    setDrag({ mode, id: n.id, ox: p.x, oy: p.y, dx: 0, dy: 0, base: { x: n.x, y: n.y, w: n.w, h: n.h } });
    onSelect?.(n.id);
  };

  const onPointerMove = (e) => {
    if (drag) {
      const p = toCanvas(e.clientX, e.clientY);
      setDrag(d => (d ? { ...d, dx: p.x - d.ox, dy: p.y - d.oy } : d));
      return;
    }
    if (pan) {
      onViewportChange({ ...viewport, x: pan.base.x + (e.clientX - pan.ox), y: pan.base.y + (e.clientY - pan.oy) });
    }
  };

  const endDrag = () => {
    if (pan) setPan(null);
    if (!drag) return;
    const d = drag;
    setDrag(null);
    const src = nodes.find(n => n.id === d.id);
    if (!src) return;
    let next;
    if (d.mode === 'move') {
      next = roundNode({ ...src, x: snapToGrid(d.base.x + d.dx, FLOW_GRID), y: snapToGrid(d.base.y + d.dy, FLOW_GRID) });
    } else {
      next = roundNode({
        ...src,
        w: Math.max(MIN_NODE_W, snapToGrid(d.base.w + d.dx, FLOW_GRID)),
        h: Math.max(MIN_NODE_H, snapToGrid(d.base.h + d.dy, FLOW_GRID)),
      });
    }
    // ⚠️ no-op 커밋 생략 — 1px 미만 이동으로 지문이 흔들려 Drive 저장이 나가는 것을 막는다
    if (next.x === src.x && next.y === src.y && next.w === src.w && next.h === src.h) return;
    onNodesChange(nodes.map(n => (n.id === d.id ? next : n)));
  };

  const onBgPointerDown = (e) => {
    if (e.button !== 0) return;
    if (connectFrom) { onConnectFromChange?.(null); return; }
    onSelect?.(null);
    onBackgroundClick?.();
    setPan({ ox: e.clientX, oy: e.clientY, base: { x: viewport.x, y: viewport.y } });
  };

  const onNodePointerDown = (e, n) => {
    if (connectFrom) {
      e.stopPropagation();
      if (connectFrom !== n.id) onAddEdge?.(connectFrom, n.id);
      onConnectFromChange?.(null);
      return;
    }
    startDrag(e, n, 'move');
  };

  // 휠 확대/축소.
  // ⚠️ React의 onWheel은 루트에 **passive**로 붙어 preventDefault가 통하지 않는다 → 보드가
  //    전체화면 오버레이인데도 휠이 뒤쪽 페이지를 함께 스크롤한다. 네이티브 리스너를
  //    { passive: false }로 직접 달아야 한다.
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (ev) => {
      ev.preventDefault();
      const vp = vpRef.current;
      const delta = ev.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = Math.min(2.5, Math.max(0.25, vp.scale * delta));
      const r = el.getBoundingClientRect();
      const cx = ev.clientX - r.left;
      const cy = ev.clientY - r.top;
      const k = nextScale / vp.scale; // 커서 위치 고정 확대
      onViewportRef.current({ scale: nextScale, x: cx - (cx - vp.x) * k, y: cy - (cy - vp.y) * k });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full block"
      style={{ touchAction: 'none', background: '#0b1120', cursor: pan ? 'grabbing' : 'default' }}
      onPointerDown={onBgPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <defs>
        <marker id="flowArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#60a5fa" />
        </marker>
        <pattern id="flowGrid" width={FLOW_GRID * 5} height={FLOW_GRID * 5} patternUnits="userSpaceOnUse">
          <path d={`M ${FLOW_GRID * 5} 0 L 0 0 0 ${FLOW_GRID * 5}`} fill="none" stroke="#1e293b" strokeWidth="1" />
        </pattern>
      </defs>

      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
        <rect x={-4000} y={-4000} width={12000} height={12000} fill="url(#flowGrid)" />

        {/* 연결선 — 노드보다 아래에 그려 도형이 선을 가리도록 */}
        {edges.map(e => {
          const a = nodeById(e.from);
          const b = nodeById(e.to);
          const p = edgePath(a, b, e);
          if (!p) return null; // ⚠️ null 계약 — 노드가 없으면 조용히 건너뛴다(throw 금지)
          return (
            <g key={e.id}>
              <path
                d={p.d}
                fill="none"
                stroke={e.stroke || '#60a5fa'}
                strokeWidth={2}
                strokeDasharray={e.dashed ? '6 4' : undefined}
                markerEnd={e.arrow === 'none' ? undefined : 'url(#flowArrow)'}
                markerStart={e.arrow === 'both' ? 'url(#flowArrow)' : undefined}
              />
              {/* 클릭 히트박스 — 얇은 선을 잡기 쉽게 */}
              <path
                d={p.d}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                style={{ cursor: readOnly ? 'default' : 'pointer' }}
                onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.(`edge:${e.id}`); }}
              />
              {e.label && (
                <g pointerEvents="none">
                  <rect
                    x={p.labelX - Math.min(120, e.label.length * 6 + 8)}
                    y={p.labelY - 11}
                    width={Math.min(240, e.label.length * 12 + 16)}
                    height={22}
                    rx={5}
                    fill="#0b1120"
                    stroke={selectedId === `edge:${e.id}` ? '#818cf8' : '#334155'}
                  />
                  <text x={p.labelX} y={p.labelY + 4} textAnchor="middle" fill="#cbd5e1" fontSize="12">{e.label}</text>
                </g>
              )}
            </g>
          );
        })}

        {/* 노드 */}
        {nodes.map(raw => {
          const n = liveNode(raw);
          const v = viewOf(raw);
          const selected = selectedId === n.id;
          const isConnectSrc = connectFrom === n.id;
          const amountText =
            v.shownAmount == null ? '' : hideAmounts ? '••••••' : formatAmount(v.shownAmount, v.accountType);
          return (
            // ⚠️ hover 핸들러는 **바깥 <g>**에 둔다 — 안쪽 도형에만 걸면 리사이즈·연결 핸들
            //    (도형 경계 밖으로 절반 튀어나온다) 위로 커서를 옮기는 순간 pointerleave가 발화해
            //    핸들이 사라지고 잡을 수 없게 된다.
            <g
              key={n.id}
              onPointerEnter={() => setHoverId(n.id)}
              onPointerLeave={() => setHoverId(h => (h === n.id ? null : h))}
            >
              <g
                style={{ cursor: readOnly ? 'default' : connectFrom ? 'crosshair' : 'move' }}
                onPointerDown={(e) => onNodePointerDown(e, n)}
              >
                <NodeShape n={n} fill={raw.fill || '#2E75B6'} stroke={isConnectSrc ? '#818cf8' : raw.stroke} selected={selected} dangling={v.dangling} />
              </g>

              {/* 내용 — foreignObject로 HTML 줄바꿈을 그대로 쓴다. pointerEvents none이라 도형이 포인터를 받는다. */}
              <foreignObject x={n.x} y={n.y} width={n.w} height={n.h} pointerEvents="none">
                {/* React는 foreignObject의 자식을 HTML 네임스페이스로 만든다 → xmlns 불필요 */}
                <div
                  className="w-full h-full flex flex-col items-center justify-center px-2 py-1.5 overflow-hidden text-center select-none"
                  style={{ color: '#fff' }}
                >
                  {n.date && <div className="text-[10px] leading-tight opacity-90 truncate w-full">{n.date}</div>}
                  <div className={`font-bold leading-tight w-full break-words ${v.isTest ? 'italic opacity-70' : ''}`} style={{ fontSize: 15 }}>
                    {v.displayName || '(이름 없음)'}
                  </div>
                  {amountText && <div className="text-[11px] leading-tight mt-0.5 opacity-95">{amountText}</div>}
                  {n.memo && (
                    <div className="text-[10px] leading-snug mt-0.5 opacity-85 w-full whitespace-pre-wrap break-words overflow-hidden">
                      {n.memo}
                    </div>
                  )}
                  {v.dangling && <div className="text-[9px] text-amber-300 mt-0.5">연결 끊김</div>}
                </div>
              </foreignObject>

              {/* 연결 중에는 대상 노드의 핸들을 숨긴다 — 안 그러면 대상의 연결점을 눌러
                  '연결 완료' 대신 '시작점 변경'이 되어버린다(시작 노드 자신은 취소용으로 유지). */}
              {!readOnly && (!connectFrom || isConnectSrc) && (hoverId === n.id || selected) && (
                <>
                  {/* 연결 시작점 — 오른쪽 가장자리 */}
                  <circle
                    cx={anchorPoint(n, 'r').x}
                    cy={anchorPoint(n, 'r').y}
                    r={6}
                    fill={isConnectSrc ? '#818cf8' : '#0b1120'}
                    stroke="#818cf8"
                    strokeWidth={2}
                    style={{ cursor: 'crosshair' }}
                    onPointerDown={(e) => { e.stopPropagation(); onConnectFromChange?.(isConnectSrc ? null : n.id); }}
                  />
                  {/* 리사이즈 핸들 — 오른쪽 아래 */}
                  <rect
                    x={n.x + n.w - 6}
                    y={n.y + n.h - 6}
                    width={12}
                    height={12}
                    rx={2}
                    fill="#0b1120"
                    stroke="#818cf8"
                    strokeWidth={2}
                    style={{ cursor: 'nwse-resize' }}
                    onPointerDown={(e) => startDrag(e, n, 'resize')}
                  />
                </>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ⚠️ 상위(FlowBoard)가 넘기는 콜백이 useCallback으로 고정돼 있어야 이 memo가 실제로 작동한다.
export default React.memo(FlowCanvasInner);
