// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  edgePath, anchorPoint, roundNode, snapToGrid, sanitizeHexColor, readableTextColor, arrowHeads,
  flowLineRender, buildFlowBundles, resolveNodeDrag, snapTolerance, layoutFlowLabels, flowLabelSize,
  computeFlowTable,
  MIN_NODE_W, MIN_NODE_H, FLOW_GRID, FLOW_MIN_SCALE, FLOW_MAX_SCALE,
  DEFAULT_NODE_FILL, DEFAULT_EDGE_STROKE, FLOW_CANVAS_BG, FLOW_LABEL_DOT_R, FLOW_LABEL_FONT,
} from '../flowMap';

/**
 * 흐름도 캔버스 — SVG 렌더 + Pointer Events 드래그/리사이즈/연결.
 *
 * ⚠️ 드래그·리사이즈 중에는 **로컬 state만** 갱신하고, pointerup에서 1회 커밋한다.
 *    프레임마다 상위로 올리면 App의 portfolioStructureKey가 전 계좌를 매 프레임 재직렬화한다.
 * ⚠️ React.memo 필수 — 이 저장소에는 memo가 이 컴포넌트뿐이므로 상위가 리렌더될 때
 *    캔버스까지 재조정되는 것을 여기서 끊는다. 그러려면 상위가 넘기는 콜백이 전부
 *    useCallback으로 고정돼 있어야 한다(FlowBoard 참조).
 * ⚠️ 팬/줌(viewport)은 상위(FlowBoard)가 map.viewport에 **저장**한다 — 여기서는 prop으로 받아
 *    그리기만 하고, 줌 한계는 flowMap.ts의 FLOW_MIN/MAX_SCALE을 공유한다(손복제 금지: 캔버스에서는
 *    만들 수 있는데 저장 시 잘리는 배율이 생기면 닫았다 열 때 화면이 튄다).
 */

const PALETTE_STROKE = '#1f2937';

/**
 * 화살촉은 marker의 `fill`이 정하고 참조 요소의 stroke를 물려받지 않는다 → **색깔마다 marker를
 * 하나씩** 만든다.
 * ⚠️ `fill="context-stroke"`(SVG2)로 대체하지 말 것 — 구형 Safari/WebKit에서 무시되어 화살촉이
 *    까맣게 뜨거나 사라진다. id는 hex에서 기호를 뺀 결정적 문자열이라 재렌더에도 안정적이다.
 */
const markerIdOf = (hex) => `flowArrow-${String(hex).replace(/[^a-zA-Z0-9]/g, '')}`;

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
  bundleEnabled = true,   // 시트 단위 연결선 합치기(map.bundleEdges)
  snapEnabled = true,     // 도형 정렬 스냅(세션 로컬 토글)
}) {
  const svgRef = useRef(null);
  // 드래그/리사이즈 중 임시 상태 — 커밋 전까지 상위로 올리지 않는다
  // ⚠️ move 모드는 `resolved`(= resolveNodeDrag 결과)를 함께 들고 다닌다. 미리보기와 커밋이
  //    같은 값을 읽어야 가이드선이 가리키는 자리와 실제로 저장되는 자리가 갈리지 않는다.
  const [drag, setDrag] = useState(null);   // {mode:'move'|'resize', id, ox, oy, base:{x,y,w,h}, resolved, peers}
  const [pan, setPan] = useState(null);     // {ox, oy, base:{x,y}}
  const [hoverId, setHoverId] = useState(null);
  const [hoverLabel, setHoverLabel] = useState(null); // 점으로 접힌 라벨의 즉시 툴팁

  const nodes = map?.nodes || [];
  const edges = map?.edges || [];

  // 스냅 판정에 필요한 최신값 — pointermove 핸들러가 동기로 읽는다(클로저 대신 ref).
  const snapOnRef = useRef(snapEnabled);
  snapOnRef.current = snapEnabled;
  const tolRef = useRef(1);
  tolRef.current = snapTolerance(viewport.scale);

  // ⚠️ 기본색을 **반드시 포함**한다 — stroke가 없는(=기본색) 선의 화살촉이 사라진다.
  const arrowColors = useMemo(() => {
    const set = new Set([DEFAULT_EDGE_STROKE]);
    for (const e of edges) {
      const c = sanitizeHexColor(e?.stroke);
      if (c) set.add(c);
    }
    return Array.from(set);
  }, [edges]);

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
    if (drag.mode === 'move') {
      // ⚠️ 미리보기는 **resolveNodeDrag가 낸 preview**다 — raw(base+d)로 되돌리면 정렬 스냅이
      //    화면에 보이지 않아 가이드선만 뜨고 도형은 안 붙는 상태가 된다.
      //    resolved는 startDrag가 반드시 시드한다(없으면 클릭만 해도 렌더 중 TypeError).
      const p = drag.resolved && drag.resolved.preview;
      return p ? { ...n, x: p.x, y: p.y } : n;
    }
    return {
      ...n,
      w: Math.max(MIN_NODE_W, drag.base.w + drag.dx),
      h: Math.max(MIN_NODE_H, drag.base.h + drag.dy),
    };
  }, [drag]);

  // 드래그가 반영된 노드 목록. 번들·경로·라벨이 **전부 이 배열 하나**를 공유해야 드래그 중에도
  // 선·트렁크·라벨이 도형을 따라온다(각자 nodes를 읽으면 그 중 하나가 제자리에 남는다).
  const liveNodes = useMemo(() => (drag ? nodes.map(liveNode) : nodes), [nodes, drag, liveNode]);
  const nodeIndex = useMemo(() => {
    const m = new Map();
    for (const n of liveNodes) if (n && n.id) m.set(n.id, n);
    return m;
  }, [liveNodes]);
  const nodeById = useCallback((id) => nodeIndex.get(id), [nodeIndex]);

  // 연결선 합치기. ⚠️ 계산은 flowMap.buildFlowBundles가 단독으로 한다 — 여기서 그룹 키를 다시
  //    만들면 트렁크가 뻗는 변과 실제로 그려지는 앵커가 갈린다.
  const bundles = useMemo(
    () => buildFlowBundles(liveNodes, edges, bundleEnabled),
    [liveNodes, edges, bundleEnabled],
  );

  // 선 경로 — 렌더와 라벨 배치가 같은 값을 읽도록 한 번만 계산한다.
  const paths = useMemo(() => {
    const m = new Map();
    for (const e of edges) {
      if (!e || !e.id) continue;
      m.set(e.id, edgePath(nodeIndex.get(e.from), nodeIndex.get(e.to), e, bundles.byEdge[e.id]));
    }
    return m;
  }, [edges, nodeIndex, bundles]);

  // 라벨 배치. ⚠️ 장애물에 **도형 박스를 반드시 포함**한다 — 라벨은 도형보다 아래 레이어라
  //    겹치면 가려지고 '메모를 썼는데 화면 어디에도 없다'가 된다.
  const labels = useMemo(() => {
    const items = [];
    for (const e of edges) {
      if (!e || !e.id || !e.label) continue;
      const p = paths.get(e.id);
      if (!p) continue;
      const s = flowLabelSize(e.label);
      items.push({ id: e.id, cx: p.labelX, cy: p.labelY, w: s.w, h: s.h });
    }
    const out = new Map();
    if (items.length === 0) return out;
    const obstacles = liveNodes.map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
    for (const pl of layoutFlowLabels(items, obstacles)) out.set(pl.id, pl);
    return out;
  }, [edges, paths, liveNodes]);

  const startDrag = (e, n, mode) => {
    if (readOnly) return;
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저·비신뢰 이벤트 */ }
    const p = toCanvas(e.clientX, e.clientY);
    const base = { x: n.x, y: n.y, w: n.w, h: n.h };
    // ⚠️ **resolved 시드는 필수다.** liveNode가 이 값을 읽으므로, 비워 두면 도형을 클릭만 해도
    //    (pointermove 0회) 렌더 중 TypeError가 나 보드가 통째로 오류 화면으로 대체된다.
    //    시작 시점에는 가이드를 만들지 않는다(클릭만 했는데 선이 뜨는 노이즈 방지).
    const resolved = { preview: { x: base.x, y: base.y }, commit: { x: base.x, y: base.y }, guides: [] };
    // 스냅 참조는 드래그 시작 시 1회만 고정한다(프레임마다 재수집 방지 + 자기 자신 제외).
    const peers = mode === 'move' ? nodes.filter(x => x && x.id !== n.id) : null;
    setDrag({ mode, id: n.id, ox: p.x, oy: p.y, dx: 0, dy: 0, base, resolved, peers });
    onSelect?.(n.id);
  };

  const onPointerMove = (e) => {
    if (drag) {
      const p = toCanvas(e.clientX, e.clientY);
      // ⚠️ 수식 키는 업데이터 **밖**에서 읽는다(업데이터는 나중에 실행될 수 있다).
      //    Alt/Cmd = 이번 드래그만 스냅 해제. keydown 리스너를 쓰지 않는 이유는 SVG에 tabIndex가
      //    없어 포커스를 못 받고, 보드의 onKeyDownCapture 규약과도 얽히기 때문이다.
      const bypass = !!(e.altKey || e.metaKey);
      setDrag(d => {
        if (!d) return d;
        const dx = p.x - d.ox;
        const dy = p.y - d.oy;
        if (d.mode !== 'move') return { ...d, dx, dy };
        const resolved = resolveNodeDrag(d.base, dx, dy, d.peers, tolRef.current, snapOnRef.current && !bypass);
        return { ...d, dx, dy, resolved };
      });
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
      // ⚠️ 커밋 값도 **resolveNodeDrag가 낸 commit**이다 — 여기서 snapToGrid를 다시 걸면
      //    정렬이 걸린 축이 최대 4px 밀려(기본폭 180은 mod 8 === 4라 100% 어긋난다) 방금 화면에서
      //    맞춘 정렬이 놓는 순간 깨진다. 정렬이 안 걸린 축의 격자 스냅은 그 함수 안에 있다.
      const c = d.resolved && d.resolved.commit;
      next = roundNode({ ...src, x: c ? c.x : snapToGrid(d.base.x + d.dx, FLOW_GRID), y: c ? c.y : snapToGrid(d.base.y + d.dy, FLOW_GRID) });
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
      const nextScale = Math.min(FLOW_MAX_SCALE, Math.max(FLOW_MIN_SCALE, vp.scale * delta));
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
      style={{ touchAction: 'none', background: FLOW_CANVAS_BG, cursor: pan ? 'grabbing' : 'default' }}
      onPointerDown={onBgPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <defs>
        {arrowColors.map(c => (
          <marker key={c} id={markerIdOf(c)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
          </marker>
        ))}
        <pattern id="flowGrid" width={FLOW_GRID * 5} height={FLOW_GRID * 5} patternUnits="userSpaceOnUse">
          <path d={`M ${FLOW_GRID * 5} 0 L 0 0 0 ${FLOW_GRID * 5}`} fill="none" stroke="#1e293b" strokeWidth="1" />
        </pattern>
      </defs>

      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
        <rect x={-4000} y={-4000} width={12000} height={12000} fill="url(#flowGrid)" />

        {/* 합쳐진 구간(트렁크) — 그룹당 **하나만** 그린다. 선마다 각자 그려 겹치게 하면 이중선이
            가운데를 배경색으로 덮어 지우개가 되고, 선택 후광·히트박스가 공유 구간을 덮어
            '선 하나를 골랐는데 뭉치 전체가 선택된 것처럼' 보인다.
            ⚠️ 화살촉은 **도형 경계 쪽 끝**에 붙는다 — 출발 뭉치는 뿌리(markerStart),
            도착 뭉치는 도형에 닿는 끝(markerEnd). 그룹 키에 화살촉 유무가 들어 있어 뭉치 안에서
            방향이 갈리지 않는다. */}
        {bundles.trunks.map(t => {
          const tColor = sanitizeHexColor(t.stroke) || DEFAULT_EDGE_STROKE;
          const tLine = flowLineRender({ lineStyle: t.lineStyle, lineWidth: t.lineWidth });
          const tMarker = `url(#${markerIdOf(tColor)})`;
          return tLine.double ? (
            <g key={t.key} pointerEvents="none">
              <path d={t.d} fill="none" stroke={tColor} strokeWidth={tLine.width} />
              <path
                d={t.d}
                fill="none"
                stroke={FLOW_CANVAS_BG}
                strokeWidth={tLine.innerWidth}
                markerEnd={t.head && t.headOutward ? tMarker : undefined}
                markerStart={t.head && !t.headOutward ? tMarker : undefined}
              />
            </g>
          ) : (
            <path
              key={t.key}
              d={t.d}
              fill="none"
              stroke={tColor}
              strokeWidth={tLine.width}
              strokeDasharray={tLine.dash}
              markerEnd={t.head && t.headOutward ? tMarker : undefined}
              markerStart={t.head && !t.headOutward ? tMarker : undefined}
              pointerEvents="none"
            />
          );
        })}

        {/* 연결선 — 노드보다 아래에 그려 도형이 선을 가리도록 */}
        {edges.map(e => {
          // ⚠️ 경로는 paths memo가 단독으로 만든다 — 여기서 edgePath를 다시 부르면 라벨 배치가
          //    쓰는 좌표와 화면에 그려지는 선이 갈린다(번들 인자를 빠뜨리기도 쉽다).
          const p = paths.get(e.id);
          if (!p) return null; // ⚠️ null 계약 — 노드가 없으면 조용히 건너뛴다(throw 금지)
          const color = sanitizeHexColor(e.stroke) || DEFAULT_EDGE_STROKE;
          const edgeSel = selectedId === `edge:${e.id}`;
          const marker = `url(#${markerIdOf(color)})`;
          // ⚠️ 어느 끝에 화살촉을 그릴지는 flowMap.arrowHeads가 단독 판정한다 —
          //    여기서 e.arrow를 직접 비교하면 인스펙터 안내 문구와 갈린다.
          const heads = arrowHeads(e.arrow);
          // ⚠️ 선 종류·굵기 판정은 flowMap.flowLineRender가 단독으로 한다(인스펙터 미리보기와 공유).
          //    레거시 dashed 흡수도 그 안에서 끝난다 — 여기서 e.dashed를 직접 읽지 말 것.
          const line = flowLineRender(e);
          return (
            <g key={e.id}>
              {/* ⚠️ 선택 표시(후광)를 지우지 말 것 — 색을 바꿀 수 있게 되면서 '어느 선을 고쳤는지'를
                  색으로는 알 수 없게 됐다(라벨 없는 선은 종전에 선택 피드백이 아예 없었다).
                  굵기를 고를 수 있으므로 후광도 선 굵기에서 파생시킨다(고정 9면 굵은 선에 묻힌다). */}
              {edgeSel && (
                <path d={p.d} fill="none" stroke="#818cf8" strokeWidth={line.width + 7} strokeOpacity={0.35} strokeLinecap="round" pointerEvents="none" />
              )}
              {line.double ? (
                <>
                  <path d={p.d} fill="none" stroke={color} strokeWidth={line.width} />
                  {/* ⚠️ 가운데를 캔버스 배경색으로 덮어 이중선을 만든다. 화살촉은 **안쪽 path**에 —
                      marker는 markerUnits="strokeWidth"가 기본이라 바깥(3배)에 붙이면 3배로 커진다.
                      marker의 색은 정의부 fill이 정하므로 이 path의 stroke 색과 무관하다. */}
                  <path
                    d={p.d}
                    fill="none"
                    stroke={FLOW_CANVAS_BG}
                    strokeWidth={line.innerWidth}
                    markerEnd={heads.end ? marker : undefined}
                    markerStart={heads.start ? marker : undefined}
                  />
                </>
              ) : (
                <path
                  d={p.d}
                  fill="none"
                  stroke={color}
                  strokeWidth={line.width}
                  strokeDasharray={line.dash}
                  markerEnd={heads.end ? marker : undefined}
                  markerStart={heads.start ? marker : undefined}
                />
              )}
              {/* 클릭 히트박스 — 얇은 선을 잡기 쉽게 */}
              <path
                d={p.d}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                style={{ cursor: readOnly ? 'default' : 'pointer' }}
                onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.(`edge:${e.id}`); }}
              />
            </g>
          );
        })}

        {/* 선 위 글자 — 선 그룹 **뒤**(=위)에, 노드 그룹 **앞**(=아래)에 둔다.
            ⚠️ 이 순서가 계약이다: 노드보다 앞에 두면 라벨 히트박스가 도형의 onPointerDown을
            가로채 도형 드래그·리사이즈·연결이 통째로 죽는다. 대신 라벨이 도형에 가려질 수
            있으므로 layoutFlowLabels가 도형 박스를 장애물로 받아 자리를 피한다.
            ⚠️ 정상 라벨은 종전대로 pointerEvents="none"이다 — 켜면 최대 수백 px짜리 상자가
            남의 선 위에 얹혀 그 선의 클릭을 가로챈다. 포인터를 받는 것은 점(dot)뿐이고,
            점은 작아서 배경 팬을 사실상 방해하지 않는다. */}
        {edges.map(e => {
          if (!e || !e.id || !e.label) return null;
          const pl = labels.get(e.id);
          if (!pl) return null;
          const lColor = sanitizeHexColor(e.stroke) || DEFAULT_EDGE_STROKE;
          const lSel = selectedId === `edge:${e.id}`;
          if (pl.mode === 'dot') {
            // 자리가 없어 점으로 접힌 라벨 — 호버로 전문을 보여 준다(요구 ③).
            return (
              <circle
                key={`lb:${e.id}`}
                cx={pl.x}
                cy={pl.y}
                r={FLOW_LABEL_DOT_R}
                fill={FLOW_CANVAS_BG}
                stroke={lSel ? '#818cf8' : lColor}
                strokeWidth={2}
                style={{ cursor: 'pointer' }}
                onPointerEnter={() => setHoverLabel({ id: e.id, x: pl.x, y: pl.y, text: e.label })}
                onPointerLeave={() => setHoverLabel(h => (h && h.id === e.id ? null : h))}
                onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.(`edge:${e.id}`); }}
              >
                {/* 네이티브 툴팁 — 아래 즉시 툴팁이 못 뜨는 경우(터치·보조기술)의 보조 경로 */}
                <title>{e.label}</title>
              </circle>
            );
          }
          // ⚠️ 상자 폭은 flowLabelSize(= 전각/반각을 구분한 근사)로 잰다. 종전 `length * 12`는
          //    한글/영문 혼용에서 최대 2배까지 틀려 상자가 글자를 못 감싸거나 과하게 넓었다.
          const lSize = flowLabelSize(e.label);
          return (
            <g key={`lb:${e.id}`} pointerEvents="none">
              <rect
                x={pl.x - lSize.w / 2}
                y={pl.y - lSize.h / 2}
                width={lSize.w}
                height={lSize.h}
                rx={5}
                fill={FLOW_CANVAS_BG}
                stroke={lSel ? '#818cf8' : lColor}
                strokeOpacity={lSel ? 1 : 0.6}
              />
              <text x={pl.x} y={pl.y + 4} textAnchor="middle" fill="#cbd5e1" fontSize={FLOW_LABEL_FONT}>{e.label}</text>
            </g>
          );
        })}

        {/* 노드 */}
        {nodes.map(raw => {
          const n = liveNode(raw);
          const v = viewOf(raw);
          const selected = selectedId === n.id;
          const isConnectSrc = connectFrom === n.id;
          // ⚠️ 팔레트에 흰색·옅은 톤이 들어오면서 흰 글자가 배경에 묻힐 수 있다 → 자동 대비.
          //    문턱은 flowMap.readableTextColor에 있고 기존 8색은 전부 흰 글자를 유지한다.
          const fillColor = sanitizeHexColor(raw.fill) || DEFAULT_NODE_FILL;
          const textColor = readableTextColor(fillColor);
          const darkText = textColor !== '#ffffff';
          const amountText =
            v.shownAmount == null ? '' : hideAmounts ? '••••••' : formatAmount(v.shownAmount, v.accountType);
          // ⚠️ 렌더 스코프 선언 — 다른 최상위 블록의 지역 변수를 JSX가 참조하면 런타임
          //    ReferenceError로 화면이 통째로 오류 페이지가 되는데 @ts-nocheck + esbuild라
          //    빌드도 undefcheck도 잡지 못한다(initTradeRest 프로덕션 장애와 동일).
          const tableRows = raw.table ? computeFlowTable(raw.table) : [];
          const border = raw.table?.border || 'none';
          // 표 선은 글자색을 옅게 쓴다 — 채우기가 밝든 어둡든 같은 규칙으로 읽힌다.
          const gridColor = darkText ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
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
                <NodeShape n={n} fill={fillColor} stroke={isConnectSrc ? '#818cf8' : raw.stroke} selected={selected} dangling={v.dangling} />
              </g>

              {/* 내용 — foreignObject로 HTML 줄바꿈을 그대로 쓴다. pointerEvents none이라 도형이 포인터를 받는다. */}
              <foreignObject x={n.x} y={n.y} width={n.w} height={n.h} pointerEvents="none">
                {/* React는 foreignObject의 자식을 HTML 네임스페이스로 만든다 → xmlns 불필요 */}
                <div
                  className="w-full h-full flex flex-col items-center justify-center px-2 py-1.5 overflow-hidden text-center select-none"
                  style={{ color: textColor }}
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
                  {/* 표 — 메모로는 열을 맞출 수 없는 '목록 + 소계 + 잔액'.
                      ⚠️ 계산은 flowMap.computeFlowTable이 단독으로 한다. 여기서 합을 다시 구하면
                      편집 팝업이 보여 준 값과 도형에 그려진 값이 갈린다. */}
                  {tableRows.length > 0 && (
                    <div
                      className={`w-full mt-1 text-[10px] leading-tight ${border !== 'none' ? 'border' : ''}`}
                      style={border !== 'none' ? { borderColor: gridColor } : undefined}
                    >
                      {tableRows.map((r, i) => (
                        r.kind === 'rule' ? (
                          <div key={i} style={{ borderTop: `1px solid ${gridColor}`, margin: '2px 0' }} />
                        ) : (
                          <div
                            key={i}
                            className="flex items-baseline gap-1 px-1"
                            style={{
                              // ⚠️ '전체' 선일 때만 행 사이에 선을 긋는다. 첫 행에는 긋지 않는다
                              //    (바깥 테두리와 겹쳐 두 줄로 보인다).
                              ...(border === 'all' && i > 0 ? { borderTop: `1px solid ${gridColor}` } : {}),
                              ...(r.kind === 'total' || r.kind === 'balance' ? { fontWeight: 700 } : {}),
                            }}
                          >
                            <span className="flex-1 min-w-0 truncate text-left">{r.label}</span>
                            <span
                              className={`shrink-0 tabular-nums ${r.computed ? 'italic opacity-80' : ''}`}
                              style={border === 'all' ? { borderLeft: `1px solid ${gridColor}`, paddingLeft: 4 } : undefined}
                            >{r.text}</span>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                  {/* 밝은 채우기에서는 amber-300이 배경에 묻힌다 — 글자색과 같은 규칙으로 강도를 바꾼다 */}
                  {v.dangling && (
                    <div className="text-[9px] mt-0.5" style={{ color: darkText ? '#b45309' : '#fcd34d' }}>연결 끊김</div>
                  )}
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
                    fill={isConnectSrc ? '#818cf8' : FLOW_CANVAS_BG}
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
                    fill={FLOW_CANVAS_BG}
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

        {/* 정렬 가이드 — 드래그 중에만, 스냅이 **실제로 걸린 축에만** 그린다.
            ⚠️ 최상단(노드 위)에 둔다. 노드 아래면 정작 맞추려는 도형에 가려 안 보인다.
            ⚠️ 두 겹(어두운 바탕 + 밝은 파선)으로 그린다 — 가운데 정렬 가이드는 정의상 도형을
            관통하는데, 도형 채우기 팔레트(테마 60색)에는 어떤 단색과도 대비가 무너지는 색이
            섞여 있어 한 겹으로는 배경에 따라 사라진다.
            ⚠️ 굵기를 배율로 나눠 어느 배율에서도 같은 두께로 보이게 한다(축소에서 실선이 사라짐 방지). */}
        {drag && drag.resolved && drag.resolved.guides.map((g, i) => {
          const x1 = g.axis === 'x' ? g.value : g.from;
          const x2 = g.axis === 'x' ? g.value : g.to;
          const y1 = g.axis === 'x' ? g.from : g.value;
          const y2 = g.axis === 'x' ? g.to : g.value;
          const sc = viewport.scale > 0 ? viewport.scale : 1;
          return (
            <g key={`gd:${g.axis}:${i}`} pointerEvents="none">
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={FLOW_CANVAS_BG} strokeWidth={3 / sc} strokeOpacity={0.85} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f472b6" strokeWidth={1 / sc} strokeDasharray={`${5 / sc} ${4 / sc}`} />
            </g>
          );
        })}

        {/* 점으로 접힌 라벨의 즉시 툴팁 — 최상단. 네이티브 <title>은 1초 가까이 지연되어
            "점에 뭐가 있는지" 확인하는 동작에 쓰기 어렵다. */}
        {hoverLabel && (() => {
          const s = flowLabelSize(hoverLabel.text);
          return (
            <g pointerEvents="none">
              <rect
                x={hoverLabel.x - s.w / 2}
                y={hoverLabel.y - s.h - FLOW_LABEL_DOT_R - 4}
                width={s.w}
                height={s.h}
                rx={5}
                fill={FLOW_CANVAS_BG}
                stroke="#818cf8"
              />
              <text
                x={hoverLabel.x}
                y={hoverLabel.y - FLOW_LABEL_DOT_R - 4 - s.h / 2 + 4}
                textAnchor="middle"
                fill="#e2e8f0"
                fontSize={FLOW_LABEL_FONT}
              >{hoverLabel.text}</text>
            </g>
          );
        })()}
      </g>
    </svg>
  );
}

// ⚠️ 상위(FlowBoard)가 넘기는 콜백이 useCallback으로 고정돼 있어야 이 memo가 실제로 작동한다.
export default React.memo(FlowCanvasInner);
