#!/usr/bin/env node
// 자금 흐름도(flowMaps) 순수 로직 검증 — src/flowMap.ts 의 참조 구현과 1:1 동기화할 것.
//
// 이 파일이 고정하는 것은 "조용히 틀린 값이 나오거나, 조용히 데이터가 사라지는" 결함들이다.
//   파트① 참조 구현 미러 (#1~#26)
//     #1~#8   normalizeFlowMaps — 손상 입력에 throw하지 않음 / 변경 없으면 원본 참조 반환 /
//             고아 엣지만 제거하고 dangling portfolioId 는 보존(계좌 복원 대비)
//     #9~#12  flowMapsHaveContent — sticky 복원 판정. '빈 맵 1장'이 복원 경로를 막지 않아야 한다
//     #13~#16 flowFingerprint — 절대 throw 금지(저장 스케줄 사망 방지) + 동일 길이 편집 감지
//     #17~#20 edgePath — 노드 부재 시 null 계약(throw 시 루트 ErrorBoundary → 앱 전체 오류 페이지)
//     #21~#22 removeNode / pruneOrphanEdges — 노드 삭제 시 엣지 동반 제거
//     #23~#26 resolveFlowNodeView — 삭제 계좌 금액 null / TEST 계좌는 금액 표시 /
//             accountType 은 portfolios 소스 / dangling 판정
//   파트② 소스 텍스트 가드 (#27~#36)
//     미러 테스트는 함수 본문 회귀만 잡는다. 영속화 배선(호출부)은 미러로 표현할 수 없어
//     App.tsx·useDriveSync.ts·flowMap.ts 를 직접 읽어 계약을 단언한다
//     (verify-twr.mjs #30d · verify-rebal-restore.mjs #25~#32 선례).
//     ⚠️ 실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = Object.is(got, want) || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want}`); }
};
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};
const deep = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));

// ───────── 참조 구현 (src/flowMap.ts 미러) ─────────

let idSeq = 0;
const generateId = () => `gen${++idSeq}`;

const MAX_FLOW_MAPS = 20, MAX_FLOW_NODES = 150, MAX_FLOW_EDGES = 300;
const MAX_FLOW_MAP_NAME = 40;
const DEFAULT_NODE_W = 180, DEFAULT_NODE_H = 120, MIN_NODE_W = 60, MIN_NODE_H = 44;
const FLOW_MIN_SCALE = 0.25, FLOW_MAX_SCALE = 2.5;
const DEFAULT_FLOW_VIEWPORT = { x: 80, y: 80, scale: 1 };
const VIEWPORT_XY_LIMIT = 200000;
const DEFAULT_NODE_FILL = '#2E75B6', DEFAULT_EDGE_STROKE = '#60a5fa';
const FLOW_CANVAS_BG = '#0b1120';
const FLOW_LINE_STYLES = ['solid', 'dot', 'dash', 'longDash', 'dashDot', 'dashDotDot', 'double'];
const FLOW_LINE_WIDTHS = ['thin', 'normal', 'thick'];
const FLOW_TRUNK_RATIO = 0.45, FLOW_TRUNK_MAX = 96, FLOW_TRUNK_MIN = 16;
const SNAP_TOL_PX = 6, SNAP_GUIDE_MAX_REFS = 6;
const FLOW_GRID = 8;
const FLOW_LABEL_FONT = 12, FLOW_LABEL_H = 22, FLOW_LABEL_PAD = 8, FLOW_LABEL_DOT_R = 5;
const MAX_FLOW_TABLE_ROWS = 30, MAX_FLOW_TABLE_TEXT = 80;
const FLOW_EDITOR_GRIP_PX = 120, FLOW_EDITOR_HEADER_PX = 40;
const FLOW_TABLE_ROW_KINDS = ['item', 'subtotal', 'total', 'balance', 'rule'];
const FLOW_TABLE_BORDERS = ['none', 'outline', 'all'];
const LINE_WIDTH_PX = { thin: 1.2, normal: 2, thick: 3.5 };
const LINE_DASH_UNITS = {
  dot: [1, 3],
  dash: [3, 2],
  longDash: [7, 3],
  dashDot: [5, 2, 1, 2],
  dashDotDot: [5, 2, 1, 2, 1, 2],
};

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const asStr = (v) => (typeof v === 'string' ? v : '');
const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX3_RE = /^#[0-9a-fA-F]{3}$/;

function sanitizeHexColor(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (HEX6_RE.test(s)) return s;
  if (HEX3_RE.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return '';
}

function readableTextColor(fill) {
  const hex = sanitizeHexColor(fill);
  if (!hex) return '#ffffff';
  const lin = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  return L > 0.45 ? '#111827' : '#ffffff';
}

function normalizeFlowViewport(v) {
  if (!v || typeof v !== 'object') return null;
  const o = v;
  if (!isFiniteNum(o.x) || !isFiniteNum(o.y) || !isFiniteNum(o.scale)) return null;
  return {
    x: Math.round(clampNum(o.x, -VIEWPORT_XY_LIMIT, VIEWPORT_XY_LIMIT)),
    y: Math.round(clampNum(o.y, -VIEWPORT_XY_LIMIT, VIEWPORT_XY_LIMIT)),
    scale: Math.round(clampNum(o.scale, FLOW_MIN_SCALE, FLOW_MAX_SCALE) * 1e4) / 1e4,
  };
}

function normalizeFlowSide(v) {
  return v === 'l' || v === 'r' || v === 't' || v === 'b' ? v : undefined;
}

function normalizeFlowArrow(v) {
  return v === 'both' || v === 'none' || v === 'from' ? v : 'to';
}

function resolveFlowLineStyle(lineStyle, dashed) {
  if (FLOW_LINE_STYLES.includes(lineStyle)) return lineStyle;
  return dashed ? 'dash' : 'solid';
}

function normalizeFlowLineWidth(v) {
  return FLOW_LINE_WIDTHS.includes(v) ? v : 'normal';
}

function flowLineRender(edge) {
  const style = resolveFlowLineStyle(edge?.lineStyle, edge?.dashed);
  const w = LINE_WIDTH_PX[normalizeFlowLineWidth(edge?.lineWidth)];
  const units = LINE_DASH_UNITS[style];
  return {
    width: style === 'double' ? Math.round(w * 3 * 100) / 100 : w,
    dash: units ? units.map(u => Math.round(u * w * 100) / 100).join(' ') : undefined,
    double: style === 'double',
    innerWidth: w,
  };
}

function arrowHeads(arrow) {
  const a = normalizeFlowArrow(arrow);
  return { start: a === 'both' || a === 'from', end: a === 'both' || a === 'to' };
}

function sameFlowViewport(a, b) {
  const x = a, y = b;
  if (!x || !y) return !x && !y;
  return x.x === y.x && x.y === y.y && x.scale === y.scale;
}

function fitFlowViewport(nodes, viewW, viewH) {
  const list = (Array.isArray(nodes) ? nodes : []).filter(
    n => n && isFiniteNum(n.x) && isFiniteNum(n.y) && isFiniteNum(n.w) && isFiniteNum(n.h),
  );
  if (list.length === 0) return { ...DEFAULT_FLOW_VIEWPORT };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of list) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const availW = Math.max(200, isFiniteNum(viewW) ? viewW : 200);
  const availH = Math.max(200, isFiniteNum(viewH) ? viewH : 200);
  const scale = clampNum(Math.min(availW / (w + 120), availH / (h + 120)), FLOW_MIN_SCALE, 1.5);
  return normalizeFlowViewport({ scale, x: 60 - minX * scale, y: 90 - minY * scale }) || { ...DEFAULT_FLOW_VIEWPORT };
}

function roundNode(n) {
  const x = Math.round(n.x), y = Math.round(n.y), w = Math.round(n.w), h = Math.round(n.h);
  if (x === n.x && y === n.y && w === n.w && h === n.h) return n;
  return { ...n, x, y, w, h };
}

function makeFlowNode(partial = {}) {
  const fill = sanitizeHexColor(partial.fill);
  const stroke = sanitizeHexColor(partial.stroke);
  const table = normalizeFlowTable(partial.table);
  return {
    id: partial.id || generateId(),
    kind: partial.kind === 'ellipse' ? 'ellipse' : 'rect',
    x: isFiniteNum(partial.x) ? partial.x : 0,
    y: isFiniteNum(partial.y) ? partial.y : 0,
    w: isFiniteNum(partial.w) ? Math.max(MIN_NODE_W, partial.w) : DEFAULT_NODE_W,
    h: isFiniteNum(partial.h) ? Math.max(MIN_NODE_H, partial.h) : DEFAULT_NODE_H,
    label: asStr(partial.label),
    date: asStr(partial.date),
    amountManual: isFiniteNum(partial.amountManual) ? partial.amountManual : null,
    memo: asStr(partial.memo),
    portfolioId: typeof partial.portfolioId === 'string' && partial.portfolioId ? partial.portfolioId : null,
    accountNameSnapshot: asStr(partial.accountNameSnapshot),
    amountSource: partial.amountSource === 'account' || partial.amountSource === 'manual' ? partial.amountSource : 'none',
    ...(table ? { table } : {}),
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };
}

function makeFlowMap(name = '흐름도') {
  const ts = Date.now();
  return { id: generateId(), name, nodes: [], edges: [], createdAt: ts, updatedAt: ts };
}

function flowMapsHaveContent(maps) {
  if (!Array.isArray(maps)) return false;
  return maps.some(m => !!m && ((Array.isArray(m.nodes) && m.nodes.length > 0) || (Array.isArray(m.edges) && m.edges.length > 0)));
}

function flowFingerprint(maps) {
  try {
    if (!Array.isArray(maps)) return '';
    return JSON.stringify(maps.map(m => ({
      i: m?.id ?? '', n: m?.name ?? '',
      vp: m?.viewport ? [m.viewport.x ?? 0, m.viewport.y ?? 0, m.viewport.scale ?? 1] : null,
      ...(m?.bundleEdges === false ? { nb: 1 } : {}),
      nd: (Array.isArray(m?.nodes) ? m.nodes : []).map(n => [
        n?.id ?? '', n?.kind ?? '', n?.x ?? 0, n?.y ?? 0, n?.w ?? 0, n?.h ?? 0,
        n?.label ?? '', n?.date ?? '', n?.amountManual ?? null, n?.memo ?? '',
        n?.portfolioId ?? null, n?.accountNameSnapshot ?? '', n?.amountSource ?? '',
        n?.fill ?? '', n?.stroke ?? '',
        n?.table
          ? [
              n.table.border ?? '',
              (Array.isArray(n.table.rows) ? n.table.rows : []).map(r => {
                const f = flowTableRowFlags(r);
                return f ? [r?.kind ?? '', r?.label ?? '', r?.value ?? '', f] : [r?.kind ?? '', r?.label ?? '', r?.value ?? ''];
              }),
            ]
          : null,
      ]),
      eg: (Array.isArray(m?.edges) ? m.edges : []).map(e => [
        e?.id ?? '', e?.from ?? '', e?.to ?? '', e?.label ?? '',
        e?.fromSide ?? '', e?.toSide ?? '', e?.stroke ?? '',
        resolveFlowLineStyle(e?.lineStyle, e?.dashed), normalizeFlowLineWidth(e?.lineWidth),
        e?.arrow ?? '',
      ]),
    })));
  } catch { return 'ERR'; }
}

function normalizeFlowMaps(raw) {
  if (!Array.isArray(raw)) return [];
  let changed = false;
  const out = [];
  const rawMaps = raw.length > MAX_FLOW_MAPS ? (changed = true, raw.slice(0, MAX_FLOW_MAPS)) : raw;
  const seenMapIds = new Set();

  for (const m of rawMaps) {
    if (!m || typeof m !== 'object') { changed = true; continue; }
    let mapChanged = false;
    let id = asStr(m.id);
    if (!id || seenMapIds.has(id)) { id = generateId(); mapChanged = true; }
    seenMapIds.add(id);
    const name = asStr(m.name) || '흐름도';
    if (name !== m.name) mapChanged = true;

    const rawNodes = Array.isArray(m.nodes) ? m.nodes : [];
    if (!Array.isArray(m.nodes) && m.nodes !== undefined) mapChanged = true;
    const nodes = [];
    const seenNodeIds = new Set();
    for (const n of rawNodes) {
      if (nodes.length >= MAX_FLOW_NODES) { mapChanged = true; break; }
      if (!n || typeof n !== 'object') { mapChanged = true; continue; }
      const nid = asStr(n.id);
      if (!nid || seenNodeIds.has(nid)) { mapChanged = true; continue; }
      seenNodeIds.add(nid);
      const fixed = makeFlowNode({ ...n, id: nid });
      if (
        fixed.kind !== n.kind || fixed.x !== n.x || fixed.y !== n.y || fixed.w !== n.w || fixed.h !== n.h ||
        fixed.label !== n.label || fixed.date !== n.date || fixed.amountManual !== (n.amountManual ?? null) ||
        fixed.memo !== n.memo || fixed.portfolioId !== (n.portfolioId ?? null) ||
        fixed.accountNameSnapshot !== n.accountNameSnapshot || fixed.amountSource !== n.amountSource ||
        fixed.fill !== n.fill || fixed.stroke !== n.stroke ||
        !sameFlowTable(fixed.table, n.table)
      ) mapChanged = true;
      nodes.push(fixed);
    }

    const rawEdges = Array.isArray(m.edges) ? m.edges : [];
    if (!Array.isArray(m.edges) && m.edges !== undefined) mapChanged = true;
    const edges = [];
    const seenEdgeIds = new Set();
    for (const e of rawEdges) {
      if (edges.length >= MAX_FLOW_EDGES) { mapChanged = true; break; }
      if (!e || typeof e !== 'object') { mapChanged = true; continue; }
      const eid = asStr(e.id), from = asStr(e.from), to = asStr(e.to);
      if (!eid || seenEdgeIds.has(eid) || !seenNodeIds.has(from) || !seenNodeIds.has(to)) { mapChanged = true; continue; }
      seenEdgeIds.add(eid);
      const label = asStr(e.label);
      const arrow = normalizeFlowArrow(e.arrow);
      const stroke = sanitizeHexColor(e.stroke);
      const strokeChanged = e.stroke === undefined ? stroke !== '' : stroke !== e.stroke;
      const outStyle = resolveFlowLineStyle(e.lineStyle, e.dashed);
      const outWidth = normalizeFlowLineWidth(e.lineWidth);
      const keepStyle = outStyle === 'solid' ? undefined : outStyle;
      const keepWidth = outWidth === 'normal' ? undefined : outWidth;
      const lineChanged = keepStyle !== e.lineStyle || keepWidth !== e.lineWidth || e.dashed !== undefined;
      const keepFromSide = normalizeFlowSide(e.fromSide);
      const keepToSide = normalizeFlowSide(e.toSide);
      const sideChanged = keepFromSide !== e.fromSide || keepToSide !== e.toSide;
      if (label !== e.label || arrow !== e.arrow || strokeChanged || lineChanged || sideChanged) mapChanged = true;
      edges.push({
        id: eid, from, to, label, arrow,
        ...(keepFromSide ? { fromSide: keepFromSide } : {}),
        ...(keepToSide ? { toSide: keepToSide } : {}),
        ...(stroke ? { stroke } : {}),
        ...(keepStyle ? { lineStyle: keepStyle } : {}),
        ...(keepWidth ? { lineWidth: keepWidth } : {}),
      });
    }

    const createdAt = isFiniteNum(m.createdAt) ? m.createdAt : (mapChanged = true, 1);
    const updatedAt = isFiniteNum(m.updatedAt) ? m.updatedAt : (mapChanged = true, createdAt);

    const rawVp = m.viewport;
    const viewport = normalizeFlowViewport(rawVp);
    if (viewport ? !sameFlowViewport(rawVp, viewport) : rawVp !== undefined && rawVp !== null) mapChanged = true;

    const rawBundle = m.bundleEdges;
    const bundleOff = rawBundle === false;
    if (rawBundle !== undefined && !bundleOff) mapChanged = true;

    if (mapChanged) {
      changed = true;
      out.push({
        id, name, nodes, edges, createdAt, updatedAt,
        ...(viewport ? { viewport } : {}),
        ...(bundleOff ? { bundleEdges: false } : {}),
      });
    }
    else out.push(m);
  }
  return changed ? out : raw;
}

function removeNode(map, nodeId) {
  const nodes = map.nodes.filter(n => n.id !== nodeId);
  if (nodes.length === map.nodes.length) return map;
  const edges = map.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
  return { ...map, nodes, edges };
}

function pruneOrphanEdges(map) {
  const ids = new Set(map.nodes.map(n => n.id));
  const edges = map.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  if (edges.length === map.edges.length) return map;
  return { ...map, edges };
}

// ── 시트(맵) 단위 조작 (src/flowMap.ts D-2 미러) ──
const asMapList = (maps) => (Array.isArray(maps) ? maps : []);

function nextFlowMapName(maps, base = '시트') {
  const used = new Set(asMapList(maps).map(m => asStr(m?.name)));
  for (let i = 1; i <= MAX_FLOW_MAPS + 1; i++) {
    const cand = `${base} ${i}`;
    if (!used.has(cand)) return cand;
  }
  return `${base} ${Date.now()}`;
}

function copyNameOf(list, name) {
  const base = `${asStr(name) || '시트'} 복사`;
  const used = new Set(list.map(m => asStr(m?.name)));
  if (!used.has(base)) return base;
  for (let i = 2; i <= MAX_FLOW_MAPS + 1; i++) {
    const cand = `${base} ${i}`;
    if (!used.has(cand)) return cand;
  }
  return base;
}

function addFlowMap(maps, name) {
  const list = asMapList(maps);
  if (list.length >= MAX_FLOW_MAPS) return list;
  return [...list, makeFlowMap(asStr(name).trim().slice(0, MAX_FLOW_MAP_NAME) || nextFlowMapName(list))];
}

function duplicateFlowMap(maps, id) {
  const list = asMapList(maps);
  const idx = list.findIndex(m => m?.id === id);
  if (idx < 0 || list.length >= MAX_FLOW_MAPS) return list;
  const src = list[idx];
  const ts = Date.now();

  const idMap = new Map();
  const nodes = (Array.isArray(src.nodes) ? src.nodes : []).map(n => {
    const nid = generateId();
    idMap.set(n.id, nid);
    return { ...n, id: nid };
  });
  const edges = [];
  for (const e of Array.isArray(src.edges) ? src.edges : []) {
    const from = idMap.get(e.from);
    const to = idMap.get(e.to);
    if (!from || !to) continue;
    edges.push({ ...e, id: generateId(), from, to });
  }

  const copy = { ...src, id: generateId(), name: copyNameOf(list, src.name), nodes, edges, createdAt: ts, updatedAt: ts };
  const out = list.slice();
  out.splice(idx + 1, 0, copy);
  return out;
}

function removeFlowMap(maps, id) {
  const list = asMapList(maps);
  if (list.length <= 1) return list;
  const out = list.filter(m => m?.id !== id);
  return out.length === list.length ? list : out;
}

function renameFlowMap(maps, id, name) {
  const list = asMapList(maps);
  const idx = list.findIndex(m => m?.id === id);
  if (idx < 0) return list;
  const next = asStr(name).trim().slice(0, MAX_FLOW_MAP_NAME) || asStr(list[idx].name) || '시트';
  if (next === list[idx].name) return list;
  const out = list.slice();
  out[idx] = { ...list[idx], name: next, updatedAt: Date.now() };
  return out;
}

function moveFlowMap(maps, id, delta) {
  const list = asMapList(maps);
  if (!delta || !Number.isFinite(delta)) return list;
  const from = list.findIndex(m => m?.id === id);
  if (from < 0) return list;
  const to = from + (delta < 0 ? -1 : 1);
  if (to < 0 || to >= list.length) return list;
  const out = list.slice();
  const [m] = out.splice(from, 1);
  out.splice(to, 0, m);
  return out;
}

const nodeCenter = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

function anchorPoint(n, side) {
  switch (side) {
    case 'l': return { x: n.x, y: n.y + n.h / 2 };
    case 'r': return { x: n.x + n.w, y: n.y + n.h / 2 };
    case 't': return { x: n.x + n.w / 2, y: n.y };
    default:  return { x: n.x + n.w / 2, y: n.y + n.h };
  }
}

function autoSides(a, b) {
  const ca = nodeCenter(a), cb = nodeCenter(b);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'r', to: 'l' } : { from: 'l', to: 'r' };
  return dy >= 0 ? { from: 'b', to: 't' } : { from: 't', to: 'b' };
}

const normalOf = (side) => {
  switch (side) {
    case 'l': return { x: -1, y: 0 };
    case 'r': return { x: 1, y: 0 };
    case 't': return { x: 0, y: -1 };
    default:  return { x: 0, y: 1 };
  }
};

function resolveEdgeSides(a, b, e) {
  const auto = autoSides(a, b);
  return {
    fs: e?.fromSide && e.fromSide !== 'auto' ? e.fromSide : auto.from,
    ts: e?.toSide && e.toSide !== 'auto' ? e.toSide : auto.to,
  };
}

function edgePath(a, b, e, bundle) {
  if (!a || !b) return null;
  const { fs, ts } = resolveEdgeSides(a, b, e);
  const p0 = anchorPoint(a, fs), p3 = anchorPoint(b, ts);
  if (!isFiniteNum(p0.x) || !isFiniteNum(p0.y) || !isFiniteNum(p3.x) || !isFiniteNum(p3.y)) return null;
  const n0 = normalOf(fs), n3 = normalOf(ts);
  const outLen = bundle && isFiniteNum(bundle.fromLen) && bundle.fromLen > 0 ? bundle.fromLen : 0;
  const inLen = bundle && isFiniteNum(bundle.toLen) && bundle.toLen > 0 ? bundle.toLen : 0;
  const q0 = outLen > 0 ? { x: p0.x + n0.x * outLen, y: p0.y + n0.y * outLen } : p0;
  const q3 = inLen > 0 ? { x: p3.x + n3.x * inLen, y: p3.y + n3.y * inLen } : p3;
  const dist = Math.hypot(q3.x - q0.x, q3.y - q0.y);
  const pull = clampNum(dist * 0.4, 24, 160);
  const p1 = { x: q0.x + n0.x * pull, y: q0.y + n0.y * pull };
  const p2 = { x: q3.x + n3.x * pull, y: q3.y + n3.y * pull };
  const labelX = (q0.x + 3 * p1.x + 3 * p2.x + q3.x) / 8;
  const labelY = (q0.y + 3 * p1.y + 3 * p2.y + q3.y) / 8;
  const r = (v) => Math.round(v * 100) / 100;
  return { d: `M ${r(q0.x)} ${r(q0.y)} C ${r(p1.x)} ${r(p1.y)}, ${r(p2.x)} ${r(p2.y)}, ${r(q3.x)} ${r(q3.y)}`, labelX: r(labelX), labelY: r(labelY) };
}

function parseFlowNumber(raw) {
  const s = asStr(raw).trim();
  if (!s) return null;
  const cleaned = s.replace(/[,\s]/g, '').replace(/^[₩$€£¥]/, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatFlowNumber(n) {
  if (!isFiniteNum(n)) return '';
  const neg = n < 0;
  const abs = Math.abs(n);
  const int = Math.floor(abs);
  const frac = abs - int;
  let s = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac > 0) s += String(Math.round(frac * 1e6) / 1e6).slice(1);
  return (neg ? '-' : '') + s;
}

const asRowKind = (v) => (FLOW_TABLE_ROW_KINDS.includes(v) ? v : 'item');
const asBorder = (v) => (FLOW_TABLE_BORDERS.includes(v) ? v : 'none');

function normalizeFlowTable(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
  const rows = [];
  for (const r of rawRows) {
    if (rows.length >= MAX_FLOW_TABLE_ROWS) break;
    if (!r || typeof r !== 'object') continue;
    const kind = asRowKind(r.kind);
    rows.push({
      kind,
      label: kind === 'rule' ? '' : asStr(r.label).slice(0, MAX_FLOW_TABLE_TEXT),
      value: kind === 'rule' ? '' : asStr(r.value).slice(0, MAX_FLOW_TABLE_TEXT),
      ...(kind === 'item' && r.done === true ? { done: true } : {}),
      ...(kind !== 'rule' && r.strike === true ? { strike: true } : {}),
      ...(kind !== 'rule' && r.italic === true ? { italic: true } : {}),
    });
  }
  if (rows.length === 0) return undefined;
  return { rows, border: asBorder(raw.border) };
}

function sameFlowTable(a, b) {
  if (!a || !b) return !a && !b;
  if (a === b) return true;
  if (a.border !== b.border) return false;
  const ar = Array.isArray(a.rows) ? a.rows : [];
  const br = Array.isArray(b.rows) ? b.rows : [];
  if (ar.length !== br.length) return false;
  for (let i = 0; i < ar.length; i++) {
    if (ar[i].kind !== br[i].kind || ar[i].label !== br[i].label || ar[i].value !== br[i].value) return false;
    if (ar[i].done !== br[i].done || ar[i].strike !== br[i].strike || ar[i].italic !== br[i].italic) return false;
  }
  return true;
}

function flowTableRowFlags(r) {
  if (!r) return '';
  return (r.done === true ? 'd' : '') + (r.strike === true ? 's' : '') + (r.italic === true ? 'i' : '');
}

function flowTableCheckStats(table) {
  const rows = table && Array.isArray(table.rows) ? table.rows : [];
  let done = 0, total = 0;
  for (const r of rows) {
    if (!r || r.kind !== 'item') continue;
    total++;
    if (r.done === true) done++;
  }
  return { done, total };
}

function clampFlowEditorPos(x, y, panelW, hostW, hostH) {
  const num = (v, d) => (isFiniteNum(v) ? v : d);
  const pw = Math.max(0, num(panelW, 0));
  const hw = Math.max(0, num(hostW, 0));
  const hh = Math.max(0, num(hostH, 0));
  const hiX = hw - FLOW_EDITOR_GRIP_PX;
  const loX = Math.min(FLOW_EDITOR_GRIP_PX - pw, hiX);
  const hiY = Math.max(0, hh - FLOW_EDITOR_HEADER_PX);
  return {
    x: Math.round(clampNum(num(x, 0), loX, hiX)),
    y: Math.round(clampNum(num(y, 0), 0, hiY)),
  };
}

function computeFlowTable(table) {
  const rows = table && Array.isArray(table.rows) ? table.rows : [];
  const out = [];
  let sumItemAll = 0, sumTotal = 0;
  for (const r of rows) {
    if (!r) continue;
    const v = parseFlowNumber(r.value);
    if (v === null) continue;
    if (r.kind === 'item') sumItemAll += v;
    else if (r.kind === 'total') sumTotal += v;
  }
  let section = 0;
  for (const r of rows) {
    if (!r) continue;
    if (r.kind === 'rule') { section = 0; out.push({ kind: 'rule', label: '', text: '', computed: false, done: false, strike: false, italic: false }); continue; }
    const strike = r.strike === true;
    const italic = r.italic === true;
    if (r.kind === 'subtotal') { out.push({ kind: 'subtotal', label: r.label, text: formatFlowNumber(section), computed: true, done: false, strike, italic }); continue; }
    if (r.kind === 'balance') { out.push({ kind: 'balance', label: r.label, text: formatFlowNumber(sumTotal - sumItemAll), computed: true, done: false, strike, italic }); continue; }
    const v = parseFlowNumber(r.value);
    if (r.kind === 'item' && v !== null) section += v;
    out.push({
      kind: r.kind, label: r.label, text: v === null ? asStr(r.value) : formatFlowNumber(v), computed: false,
      done: r.kind === 'item' && r.done === true, strike, italic,
    });
  }
  return out;
}

function flowTableFromText(text) {
  const lines = asStr(text).split(/\r?\n/);
  const rows = [];
  for (const raw of lines) {
    if (rows.length >= MAX_FLOW_TABLE_ROWS) break;
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^[\s|]*[-=─━_]{3,}[\s|]*$/.test(line)) { rows.push({ kind: 'rule', label: '', value: '' }); continue; }
    const cells = line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/);
    const label = asStr(cells[0]).trim().slice(0, MAX_FLOW_TABLE_TEXT);
    const value = asStr(cells.length > 1 ? cells[cells.length - 1] : '').trim().slice(0, MAX_FLOW_TABLE_TEXT);
    if (!label && !value) continue;
    rows.push({ kind: 'item', label, value });
  }
  return rows;
}

function flowBundleEnabled(v) { return v !== false; }

function buildFlowBundles(nodes, edges, enabled = true) {
  const out = { byEdge: {}, trunks: [] };
  if (!enabled || !Array.isArray(nodes) || !Array.isArray(edges) || edges.length < 2) return out;
  const byId = new Map();
  for (const n of nodes) if (n && typeof n.id === 'string' && n.id) byId.set(n.id, n);
  const groups = new Map();
  for (const e of edges) {
    if (!e || typeof e.id !== 'string' || !e.id) continue;
    const a = byId.get(asStr(e.from)), b = byId.get(asStr(e.to));
    if (!a || !b || a === b) continue;
    const { fs, ts } = resolveEdgeSides(a, b, e);
    const p0 = anchorPoint(a, fs), p3 = anchorPoint(b, ts);
    if (!isFiniteNum(p0.x) || !isFiniteNum(p0.y) || !isFiniteNum(p3.x) || !isFiniteNum(p3.y)) continue;
    const heads = arrowHeads(e.arrow);
    const stroke = sanitizeHexColor(e.stroke) || DEFAULT_EDGE_STROKE;
    const lineStyle = resolveFlowLineStyle(e.lineStyle, e.dashed);
    const lineWidth = normalizeFlowLineWidth(e.lineWidth);
    const push = (nodeId, side, role, head, proj) => {
      if (!(proj > 0)) return;
      const key = JSON.stringify([nodeId, side, role, head ? 1 : 0, stroke, lineStyle, lineWidth]);
      const g = groups.get(key);
      if (g) { g.edgeIds.push(e.id); if (proj < g.minProj) g.minProj = proj; }
      else groups.set(key, { key, nodeId, side, role, head, stroke, lineStyle, lineWidth, edgeIds: [e.id], minProj: proj });
    };
    const n0 = normalOf(fs), n3 = normalOf(ts);
    push(asStr(e.from), fs, 'from', heads.start, (p3.x - p0.x) * n0.x + (p3.y - p0.y) * n0.y);
    push(asStr(e.to), ts, 'to', heads.end, (p0.x - p3.x) * n3.x + (p0.y - p3.y) * n3.y);
  }
  const winner = new Map();
  for (const g of groups.values()) {
    if (g.edgeIds.length < 2) continue;
    const len = Math.min(g.minProj * FLOW_TRUNK_RATIO, FLOW_TRUNK_MAX);
    if (!(len >= FLOW_TRUNK_MIN)) continue;
    const slot = JSON.stringify([g.nodeId, g.side]);
    const cur = winner.get(slot);
    if (!cur || g.edgeIds.length > cur.edgeIds.length || (g.edgeIds.length === cur.edgeIds.length && g.key < cur.key)) winner.set(slot, g);
  }
  const r = (v) => Math.round(v * 100) / 100;
  const picked = Array.from(winner.values()).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  for (const g of picked) {
    const node = byId.get(g.nodeId);
    if (!node) continue;
    const len = r(Math.min(g.minProj * FLOW_TRUNK_RATIO, FLOW_TRUNK_MAX));
    const p = anchorPoint(node, g.side), n = normalOf(g.side);
    const q = { x: p.x + n.x * len, y: p.y + n.y * len };
    const ids = g.edgeIds.slice().sort();
    for (const id of ids) {
      const slot = out.byEdge[id] || (out.byEdge[id] = { fromLen: 0, toLen: 0 });
      if (g.role === 'from') slot.fromLen = len; else slot.toLen = len;
    }
    const d = g.role === 'from'
      ? `M ${r(p.x)} ${r(p.y)} L ${r(q.x)} ${r(q.y)}`
      : `M ${r(q.x)} ${r(q.y)} L ${r(p.x)} ${r(p.y)}`;
    out.trunks.push({
      key: g.key, d,
      ...(g.stroke !== DEFAULT_EDGE_STROKE ? { stroke: g.stroke } : {}),
      ...(g.lineStyle !== 'solid' ? { lineStyle: g.lineStyle } : {}),
      ...(g.lineWidth !== 'normal' ? { lineWidth: g.lineWidth } : {}),
      head: g.head, headOutward: g.role === 'to', edgeIds: ids,
    });
  }
  return out;
}

const snapToGrid = (v, grid = FLOW_GRID) => Math.round(v / grid) * grid;

function snapTolerance(scale, px = SNAP_TOL_PX) {
  const s = isFiniteNum(scale) && scale > 0 ? scale : 1;
  return px / s;
}

function snapAxis(lo, mid, hi, peers, tol) {
  let bestDelta = 0, bestValue = 0, bestAbs = Infinity;
  for (const p of peers) {
    const pairs = [[lo, p.lo], [mid, p.mid], [hi, p.hi]];
    for (const [cur, tgt] of pairs) {
      if (!isFiniteNum(cur) || !isFiniteNum(tgt)) continue;
      const d = tgt - cur, ad = Math.abs(d);
      if (ad > tol) continue;
      if (ad < bestAbs) { bestAbs = ad; bestDelta = d; bestValue = tgt; }
    }
  }
  if (bestAbs === Infinity) return null;
  const refs = [];
  for (const p of peers) {
    if (refs.length >= SNAP_GUIDE_MAX_REFS) break;
    if (p.lo === bestValue || p.mid === bestValue || p.hi === bestValue) refs.push(p.cross);
  }
  return { delta: bestDelta, value: bestValue, refs };
}

function resolveNodeDrag(base, dx, dy, peers, tol, enabled = true) {
  const rawX = base.x + dx, rawY = base.y + dy;
  const plain = {
    preview: { x: rawX, y: rawY },
    commit: { x: snapToGrid(rawX, FLOW_GRID), y: snapToGrid(rawY, FLOW_GRID) },
    guides: [],
  };
  if (!enabled || !Array.isArray(peers) || peers.length === 0) return plain;
  if (!isFiniteNum(rawX) || !isFiniteNum(rawY) || !isFiniteNum(tol) || tol <= 0) return plain;
  const xs = peers.map(p => ({ lo: p.x, mid: p.x + p.w / 2, hi: p.x + p.w, cross: { from: p.y, to: p.y + p.h } }));
  const ys = peers.map(p => ({ lo: p.y, mid: p.y + p.h / 2, hi: p.y + p.h, cross: { from: p.x, to: p.x + p.w } }));
  const hitX = snapAxis(rawX, rawX + base.w / 2, rawX + base.w, xs, tol);
  const hitY = snapAxis(rawY, rawY + base.h / 2, rawY + base.h, ys, tol);
  const x = hitX ? rawX + hitX.delta : rawX;
  const y = hitY ? rawY + hitY.delta : rawY;
  const guides = [];
  if (hitX) {
    let from = y, to = y + base.h;
    for (const rf of hitX.refs) { if (rf.from < from) from = rf.from; if (rf.to > to) to = rf.to; }
    guides.push({ axis: 'x', value: hitX.value, from, to });
  }
  if (hitY) {
    let from = x, to = x + base.w;
    for (const rf of hitY.refs) { if (rf.from < from) from = rf.from; if (rf.to > to) to = rf.to; }
    guides.push({ axis: 'y', value: hitY.value, from, to });
  }
  return {
    preview: { x, y },
    commit: { x: hitX ? x : snapToGrid(rawX, FLOW_GRID), y: hitY ? y : snapToGrid(rawY, FLOW_GRID) },
    guides,
  };
}

function approxLabelWidth(text, fontSize = FLOW_LABEL_FONT) {
  const s = asStr(text);
  let units = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) || 0;
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    units += wide ? 1 : 0.55;
  }
  return Math.round(units * fontSize * 100) / 100;
}

function flowLabelSize(text, fontSize = FLOW_LABEL_FONT) {
  return { w: approxLabelWidth(text, fontSize) + FLOW_LABEL_PAD * 2, h: FLOW_LABEL_H };
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function layoutFlowLabels(items, obstacles) {
  const list = Array.isArray(items) ? items : [];
  const walls = (Array.isArray(obstacles) ? obstacles : []).filter(
    o => o && isFiniteNum(o.x) && isFiniteNum(o.y) && isFiniteNum(o.w) && isFiniteNum(o.h));
  const placed = [], res = [];
  const free = (box) => {
    for (const o of walls) if (overlaps(box, o)) return false;
    for (const o of placed) if (overlaps(box, o)) return false;
    return true;
  };
  for (const it of list) {
    if (!it || !isFiniteNum(it.cx) || !isFiniteNum(it.cy)) continue;
    const w = isFiniteNum(it.w) && it.w > 0 ? it.w : FLOW_LABEL_H;
    const h = isFiniteNum(it.h) && it.h > 0 ? it.h : FLOW_LABEL_H;
    const step = h + 4;
    let done = false;
    for (const off of [0, -step, step, -step * 2, step * 2, -step * 3, step * 3]) {
      const box = { x: it.cx - w / 2, y: it.cy - h / 2 + off, w, h };
      if (!free(box)) continue;
      placed.push(box);
      res.push({ id: it.id, mode: 'label', x: it.cx, y: it.cy + off });
      done = true;
      break;
    }
    if (done) continue;
    const dot = FLOW_LABEL_DOT_R * 2;
    for (const off of [0, -step, step, -step * 2, step * 2, -step * 3, step * 3]) {
      const box = { x: it.cx - dot / 2, y: it.cy - dot / 2 + off, w: dot, h: dot };
      if (!free(box)) continue;
      placed.push(box);
      res.push({ id: it.id, mode: 'dot', x: it.cx, y: it.cy + off });
      done = true;
      break;
    }
    if (!done) res.push({ id: it.id, mode: 'dot', x: it.cx, y: it.cy });
  }
  return res;
}

function resolveFlowNodeView(node, portfolio, summary) {
  const linked = !!node.portfolioId;
  const resolved = linked && !!portfolio;
  const dangling = linked && !resolved;
  const deleted = !!(portfolio && portfolio.deletedAt);
  const isTest = !!(portfolio && portfolio.isTest);
  const liveAmount =
    resolved && !deleted && summary && typeof summary.currentEval === 'number' && Number.isFinite(summary.currentEval)
      ? summary.currentEval : null;
  const liveName = resolved ? (portfolio.name || portfolio.title || '') : '';
  const baseName = node.label || liveName || node.accountNameSnapshot || (linked ? '(연결 끊김)' : '');
  const displayName = deleted && !node.label ? `${baseName} (삭제됨)` : baseName;
  const shownAmount = node.amountSource === 'account' ? liveAmount : node.amountSource === 'manual' ? node.amountManual : null;
  const accountType = resolved ? (portfolio.accountType || 'portfolio') : '';
  const maturityCandidates = [];
  if (resolved && (portfolio.accountType || '') === 'dc-irp' && Array.isArray(portfolio.portfolio)) {
    for (const item of portfolio.portfolio) {
      if (item && item.type === 'savings' && item.endDate) {
        maturityCandidates.push({ itemId: item.id, name: item.name || '예적금', endDate: item.endDate });
      }
    }
  }
  return { node, displayName, linked, resolved, dangling, liveAmount, shownAmount, accountType, isTest, deleted, maturityCandidates };
}

function countDanglingNodes(maps, portfolios) {
  const ids = new Set((Array.isArray(portfolios) ? portfolios : []).map(p => p?.id).filter(Boolean));
  let n = 0;
  for (const m of Array.isArray(maps) ? maps : []) {
    for (const node of Array.isArray(m?.nodes) ? m.nodes : []) {
      if (node?.portfolioId && !ids.has(node.portfolioId)) n++;
    }
  }
  return n;
}

// ───────── 테스트 픽스처 ─────────
const mkNode = (o) => makeFlowNode(o);
const cleanMap = (o = {}) => ({
  id: 'm1', name: '흐름도', createdAt: 1, updatedAt: 1,
  nodes: [mkNode({ id: 'n1', x: 0, y: 0 }), mkNode({ id: 'n2', x: 400, y: 0 })],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to' }],
  ...o,
});

console.log('\n■ normalizeFlowMaps — 손상 입력 방어 · 원본 참조 보존');
{
  const src = [cleanMap()];
  ok('#1 변경 없으면 원본 배열 참조를 그대로 반환(불필요한 저장 트리거 방지)', normalizeFlowMaps(src) === src);
  ok('#1b 맵 객체도 동일 참조', normalizeFlowMaps(src)[0] === src[0]);
}
deep('#2 비배열 입력 → 빈 배열 (throw 금지)', normalizeFlowMaps(null), []);
deep('#2b 문자열 입력 → 빈 배열', normalizeFlowMaps('corrupt'), []);
{
  const r = normalizeFlowMaps([{ id: 'm', name: 'x', createdAt: 1, updatedAt: 1, nodes: null, edges: undefined }]);
  eq('#3 nodes 가 배열이 아니어도 살아남고 빈 배열이 된다', r[0].nodes.length, 0);
}
{
  // 고아 엣지 = 존재하지 않는 노드를 가리키는 선 → 제거
  const r = normalizeFlowMaps([cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'GONE', label: '' }] })]);
  eq('#4 고아 엣지는 제거된다', r[0].edges.length, 0);
  eq('#4b 노드는 보존', r[0].nodes.length, 2);
}
{
  // ⚠️ dangling portfolioId 는 절대 지우지 않는다 — 계좌 복원(restorePortfolio)으로 되살아나야 함
  const r = normalizeFlowMaps([cleanMap({ nodes: [mkNode({ id: 'n1', portfolioId: 'DELETED_ACC' })], edges: [] })]);
  eq('#5 dangling portfolioId 는 보존된다(계좌 복원 대비)', r[0].nodes[0].portfolioId, 'DELETED_ACC');
}
{
  const r = normalizeFlowMaps([cleanMap({ nodes: [mkNode({ id: 'n1' }), mkNode({ id: 'n1' })], edges: [] })]);
  eq('#6 노드 id 중복은 제거', r[0].nodes.length, 1);
}
{
  const r = normalizeFlowMaps([cleanMap({ nodes: [{ id: 'n1', x: NaN, y: Infinity, w: 'x', h: null }], edges: [] })]);
  const n = r[0].nodes[0];
  ok('#7 좌표 NaN/Infinity 는 유한값으로 교정(SVG path NaN 크래시 방지)',
    Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.w) && Number.isFinite(n.h));
  eq('#7b w 는 기본값', n.w, DEFAULT_NODE_W);
}
eq('#8 맵 개수 상한 절단', normalizeFlowMaps(Array.from({ length: MAX_FLOW_MAPS + 4 }, (_, i) => cleanMap({ id: `m${i}` }))).length, MAX_FLOW_MAPS);

console.log('\n■ flowMapsHaveContent — sticky 복원 판정 (App.tsx ⟷ useDriveSync 공유)');
ok('#9 빈 배열 → 내용 없음', flowMapsHaveContent([]) === false);
// ⚠️ 이 케이스가 이 함수의 존재 이유다. length>0 으로 재면 보드를 '열기만 해도'
//    복원 경로가 영구히 막힌다(백업에서 흐름도를 되살릴 수 없게 된다).
ok('#10 빈 맵 1장뿐이면 내용 없음 → 백업 복원 채택 가능', flowMapsHaveContent([cleanMap({ nodes: [], edges: [] })]) === false);
ok('#11 노드가 하나라도 있으면 내용 있음 → 현재 값 보존', flowMapsHaveContent([cleanMap()]) === true);
ok('#11b 노드 없이 엣지만 있어도 내용 있음', flowMapsHaveContent([{ nodes: [], edges: [{ id: 'e' }] }]) === true);
ok('#12 비배열/null 방어', flowMapsHaveContent(null) === false && flowMapsHaveContent(undefined) === false);

console.log('\n■ flowFingerprint — 저장 트리거 (절대 throw 금지)');
{
  const circular = [cleanMap()];
  circular[0].nodes[0].self = circular[0]; // 런타임 전용 필드가 섞인 최악의 경우
  eq('#13 순환 참조가 있어도 던지지 않는다(저장 스케줄 사망 방지)', typeof flowFingerprint(circular), 'string');
  ok('#13b 화이트리스트 투영이라 순환이 애초에 직렬화 대상이 아니다', flowFingerprint(circular) !== 'ERR');
}
eq('#14 비배열 → 빈 문자열', flowFingerprint(null), '');
{
  const a = [cleanMap()];
  const b = [cleanMap({ nodes: [mkNode({ id: 'n1', x: 0, y: 0 }), mkNode({ id: 'n2', x: 400, y: 0 })] })];
  b[0].nodes[0].label = 'ISA';
  ok('#15 라벨 변경을 감지(길이 해시 절충안이면 놓친다)', flowFingerprint(a) !== flowFingerprint(b));
}
{
  // ⚠️ 동일 길이 편집 — investmentNotesKey/holdingSnapshotsKey 가 정확히 이걸 놓쳤다
  const a = [cleanMap()]; a[0].nodes[0].label = 'ISA';
  const b = [cleanMap()]; b[0].nodes[0].label = 'IRP';
  ok('#16 같은 길이 라벨 오타 수정도 감지', flowFingerprint(a) !== flowFingerprint(b));
}
{
  const a = [cleanMap()], b = [cleanMap()];
  b[0].updatedAt = 999999; // updatedAt 은 지문 대상이 아님(커밋 시각 변화만으로 저장 폭주 금지)
  eq('#16b updatedAt 변화만으로는 지문이 흔들리지 않는다', flowFingerprint(a), flowFingerprint(b));
}

console.log('\n■ edgePath — null 계약 (throw 시 앱 전체 오류 페이지)');
{
  const a = mkNode({ id: 'a', x: 0, y: 0, w: 100, h: 60 });
  const b = mkNode({ id: 'b', x: 300, y: 0, w: 100, h: 60 });
  ok('#17 노드가 없으면 null (예외 금지)', edgePath(undefined, b) === null && edgePath(a, null) === null);
  const p = edgePath(a, b);
  ok('#18 정상 경로는 문자열 d 반환', typeof p.d === 'string' && p.d.startsWith('M '));
  ok('#18b NaN 이 path 에 새지 않는다', !p.d.includes('NaN'));
  eq('#19 오른쪽 이웃 → 시작 앵커는 a 의 오른쪽 변 중점 x', Number(p.d.split(' ')[1]), 100);
  const lbl = edgePath(a, b);
  ok('#19b 라벨은 두 노드 사이에 놓인다', lbl.labelX > 100 && lbl.labelX < 300);
}
{
  const a = mkNode({ id: 'a', x: 0, y: 0, w: 100, h: 60 });
  const b = mkNode({ id: 'b', x: 0, y: 300, w: 100, h: 60 });
  const p = edgePath(a, b);
  eq('#20 아래쪽 이웃 → 세로 연결(시작 y = a 하단)', Number(p.d.split(' ')[2]), 60);
}

// ───────── 연결선 합치기(번들) ─────────
console.log('\n■ 연결선 합치기 — 하위호환의 축');
{
  // ⚠️ 이 블록의 `legacyEdgePath`는 **번들 도입 이전 본문 그대로**다(커밋 0c8a58c).
  //    "bundle을 안 넘기면 종전과 같다"를 논증이 아니라 **옛 코드와의 대조**로 못 박는다.
  //    edgePath를 고칠 때 이 함수는 절대 따라 고치지 말 것 — 그러면 단언이 통째로 죽는다.
  const legacyEdgePath = (a, b, e) => {
    if (!a || !b) return null;
    const auto = autoSides(a, b);
    const fs = e?.fromSide && e.fromSide !== 'auto' ? e.fromSide : auto.from;
    const ts = e?.toSide && e.toSide !== 'auto' ? e.toSide : auto.to;
    const p0 = anchorPoint(a, fs), p3 = anchorPoint(b, ts);
    if (!isFiniteNum(p0.x) || !isFiniteNum(p0.y) || !isFiniteNum(p3.x) || !isFiniteNum(p3.y)) return null;
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const pull = clampNum(dist * 0.4, 24, 160);
    const n0 = normalOf(fs), n3 = normalOf(ts);
    const p1 = { x: p0.x + n0.x * pull, y: p0.y + n0.y * pull };
    const p2 = { x: p3.x + n3.x * pull, y: p3.y + n3.y * pull };
    const labelX = (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8;
    const labelY = (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8;
    const r = (v) => Math.round(v * 100) / 100;
    return { d: `M ${r(p0.x)} ${r(p0.y)} C ${r(p1.x)} ${r(p1.y)}, ${r(p2.x)} ${r(p2.y)}, ${r(p3.x)} ${r(p3.y)}`, labelX: r(labelX), labelY: r(labelY) };
  };
  let seed = 20260910;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const mk = (i) => makeFlowNode({ id: 'n' + i, x: Math.round((rnd() - 0.5) * 2000), y: Math.round((rnd() - 0.5) * 2000), w: 60 + Math.round(rnd() * 400), h: 44 + Math.round(rnd() * 300) });
  const SIDES = [undefined, 'auto', 'l', 'r', 't', 'b'];
  let mismatch = 0, cases = 0;
  for (let i = 0; i < 3000; i++) {
    const a = mk(i), b = mk(i + 1);
    const e = { fromSide: SIDES[Math.floor(rnd() * SIDES.length)], toSide: SIDES[Math.floor(rnd() * SIDES.length)] };
    const want = JSON.stringify(legacyEdgePath(a, b, e));
    // 미전달 · null · 0/0 · 음수/NaN — 네 형태가 전부 종전과 같아야 한다
    for (const bundle of [undefined, null, { fromLen: 0, toLen: 0 }, { fromLen: -5, toLen: NaN }]) {
      cases++;
      if (JSON.stringify(edgePath(a, b, e, bundle)) !== want) mismatch++;
    }
  }
  eq(`#103 번들 인자가 없으면 종전 구현과 문자 단위로 동일 (${cases}건 대조)`, mismatch, 0);
  // ⚠️ 이 단언이 없으면 위 #103이 '번들 인자가 아무 일도 안 한다'로도 통과한다(죽은 단언).
  const A = makeFlowNode({ id: 'a', x: 0, y: 0, w: 100, h: 60 });
  const B = makeFlowNode({ id: 'b', x: 400, y: 0, w: 100, h: 60 });
  ok('#103b 번들 인자를 주면 경로가 실제로 달라진다(죽은 인자 방지)',
    edgePath(A, B, null).d !== edgePath(A, B, null, { fromLen: 40, toLen: 0 }).d);
  eq('#103c 트렁크만큼 시작점이 법선 방향으로 밀린다', edgePath(A, B, null, { fromLen: 40, toLen: 0 }).d.split(' ')[1], '140');
  eq('#103d 도착 트렁크는 끝점을 당긴다', edgePath(A, B, null, { fromLen: 0, toLen: 40 }).d.split(', ').pop(), '360 30');
}

console.log('\n■ 연결선 합치기 — 그룹핑');
{
  const N = (id, x, y, w = 180, h = 120) => makeFlowNode({ id, x, y, w, h });
  const E = (id, from, to, o = {}) => ({ id, from, to, label: '', arrow: 'to', ...o });
  const fan = [N('h', 0, 300), N('a', 600, 0), N('b', 600, 300), N('c', 600, 600)];
  const fanE = [E('1', 'h', 'a'), E('2', 'h', 'b'), E('3', 'h', 'c')];

  const r = buildFlowBundles(fan, fanE, true);
  eq('#104 같은 변·같은 스타일 3선 → 트렁크 1개', r.trunks.length, 1);
  eq('#104b 트렁크가 3선을 모두 포함', JSON.stringify(r.trunks[0].edgeIds), JSON.stringify(['1', '2', '3']));
  ok('#104c 세 선 모두 같은 트렁크 길이를 받는다',
    r.byEdge['1'].fromLen === r.byEdge['2'].fromLen && r.byEdge['2'].fromLen === r.byEdge['3'].fromLen);

  // ⚠️ 스타일이 섞이면 합치지 않는다 — 트렁크는 그룹당 하나뿐이라 합치면 나머지 색이 사라진다.
  const mixed = buildFlowBundles(fan, [E('1', 'h', 'a', { stroke: '#70AD47' }), E('2', 'h', 'b', { stroke: '#70AD47' }), E('3', 'h', 'c', { stroke: '#DC2626' })], true);
  eq('#104d 색이 다른 선은 뭉치에서 빠진다', JSON.stringify(mixed.trunks.map(t => t.edgeIds)), JSON.stringify([['1', '2']]));
  ok('#104e 빠진 선에는 트렁크가 없다', mixed.byEdge['3'] === undefined);
  const styled = buildFlowBundles(fan, [E('1', 'h', 'a'), E('2', 'h', 'b'), E('3', 'h', 'c', { lineStyle: 'double' })], true);
  eq('#104f 선 종류가 다르면 갈린다(이중선이 공유 구간을 지우는 것 방지)', JSON.stringify(styled.trunks.map(t => t.edgeIds)), JSON.stringify([['1', '2']]));
  // ⚠️ 화살촉이 갈리면 공유 트렁크 뿌리에 모순되는 화살촉이 생긴다.
  const arrowed = buildFlowBundles(fan, [E('1', 'h', 'a'), E('2', 'h', 'b'), E('3', 'h', 'c', { arrow: 'from' })], true);
  eq('#104g 화살촉 방향이 갈리면 뭉치도 갈린다', JSON.stringify(arrowed.trunks.map(t => t.edgeIds)), JSON.stringify([['1', '2']]));

  eq('#105 enabled=false면 아무것도 만들지 않는다', JSON.stringify(buildFlowBundles(fan, fanE, false)), JSON.stringify({ byEdge: {}, trunks: [] }));
  eq('#105b 선이 1개뿐이면 트렁크 없음', buildFlowBundles(fan, [E('1', 'h', 'a')], true).trunks.length, 0);
  eq('#105c 자기 자신으로 가는 선은 제외', buildFlowBundles([N('a', 0, 0)], [E('s', 'a', 'a'), E('s2', 'a', 'a')], true).trunks.length, 0);
  // ⚠️ 입력 순서가 결과를 바꾸면 같은 데이터가 렌더마다 다른 화면을 낸다.
  eq('#105d 입력 순서를 뒤집어도 같은 결과', JSON.stringify(buildFlowBundles(fan, fanE.slice().reverse(), true)), JSON.stringify(r));

  // ⚠️ 한 (도형, 변)에 나가는 뭉치와 들어오는 뭉치가 동시에 서면 두 트렁크가 **같은 선분**이 되고
  //    화살촉이 반대 방향으로 같은 자리에 찍힌다 → 구성원이 많은 쪽만 남는다.
  const both = [N('h', 0, 300), N('a', 600, 0), N('b', 600, 200), N('c', 600, 400), N('d', 600, 600)];
  const bothE = [E('o1', 'h', 'a'), E('o2', 'h', 'b'), E('o3', 'h', 'c'), E('i1', 'd', 'h'), E('i2', 'a', 'h')];
  const rb = buildFlowBundles(both, bothE, true);
  eq('#106 한 (도형,변)에는 트렁크가 최대 하나', rb.trunks.filter(t => t.key.startsWith(String.raw`["h","r"`)).length, 1);
  ok('#106b 남는 쪽은 구성원이 많은 뭉치', rb.trunks.some(t => t.edgeIds.length === 3));
}

console.log('\n■ 연결선 합치기 — 트렁크 길이');
{
  const N = (id, x, y, w = 180, h = 120) => makeFlowNode({ id, x, y, w, h });
  const E = (id, from, to) => ({ id, from, to, label: '', arrow: 'to' });
  // ⚠️ 세로 오프셋을 ±100으로 둔다 — ±300이면 gap이 작을 때 |dy| > |dx|가 되어 autoSides가
  //    위/아래 변을 골라 버리고, 이 블록이 재려던 '가로 뭉치의 트렁크 길이'를 재지 못한다.
  const lenAt = (gap) => {
    const r = buildFlowBundles([N('a', 0, 0), N('b', 180 + gap, -100), N('c', 180 + gap, 100)], [E('1', 'a', 'b'), E('2', 'a', 'c')], true);
    return r.byEdge['1'] ? r.byEdge['1'].fromLen : 0;
  };
  eq('#107 간격 300 → min(300*0.45, 96) = 96 (상한)', lenAt(300), 96);
  eq('#107b 간격 120 → 54', lenAt(120), 54);
  eq('#107c 간격 2000이어도 상한 96', lenAt(2000), 96);
  // ⚠️ 하한 미만이면 트렁크를 만들지 않는다 — 9px짜리는 '합쳐진 것도 안 합쳐진 것도 아닌' 중간 상태다.
  eq('#107d 간격 20 → 9px는 하한(16) 미만이라 번들 아님', lenAt(20), 0);
  eq('#107e 간격 36 → 16.2px는 하한 이상이라 번들', lenAt(36), 16.2);
  // ⚠️ 비율이 1 미만이라 **가장 가까운 대상을 지나치는 일이 구조적으로 불가능**하다.
  let over = 0;
  for (let gap = 18; gap <= 3000; gap += 7) if (lenAt(gap) >= gap) over++;
  eq('#107f 트렁크가 가장 가까운 대상을 지나치지 않는다(전 구간)', over, 0);
}

console.log('\n■ 시트 번들 토글 — 저장·정규화·지문');
{
  eq('#108 미설정은 켜짐', flowBundleEnabled(undefined), true);
  eq('#108b false만 꺼짐', flowBundleEnabled(false), false);
  eq('#108c true도 켜짐', flowBundleEnabled(true), true);
  eq('#108d 손상값은 켜짐(fail-safe)', flowBundleEnabled('nope'), true);

  const withOff = [cleanMap({ id: 'm1', bundleEdges: false })];
  eq('#109 정규형이면 원본 참조(멱등)', normalizeFlowMaps(withOff) === withOff, true);
  // ⚠️ 최우선 회귀 — 재구축 경로(mapChanged=true)에서 화이트리스트에 빠지면 **조용히 사라진다**.
  //    정규형일 때는 원본 참조라 살아남으므로, 반드시 mapChanged를 강제한 픽스처로 재야 한다.
  const forced = normalizeFlowMaps([cleanMap({ id: 'm1', name: 123, bundleEdges: false })]);
  eq('#109b 재구축 경로에서도 토글이 보존된다', forced[0].bundleEdges, false);
  eq('#109c 재구축이 실제로 일어났다(픽스처가 유효한가)', forced[0].name, '흐름도');
  const on = normalizeFlowMaps([cleanMap({ id: 'm1', bundleEdges: true })]);
  eq('#109d true는 생략형으로 정규화(생략 = 켜짐)', 'bundleEdges' in on[0], false);
  eq('#109e 손상값도 생략형', 'bundleEdges' in normalizeFlowMaps([cleanMap({ id: 'm1', bundleEdges: 'x' })])[0], false);

  // ⚠️ 지문 누락 = 토글만 바꾼 세션의 STATE 저장 통째 스킵(별도 창에서는 영구히 저장 안 됨).
  ok('#110 토글을 끄면 지문이 달라진다',
    flowFingerprint([cleanMap({ id: 'm1' })]) !== flowFingerprint([cleanMap({ id: 'm1', bundleEdges: false })]));
  // ⚠️ 반대로 항상 토큰을 실으면 배포 직후 모든 시트의 지문이 달라져 아무것도 안 고쳤는데 저장이 나간다.
  eq('#110b 켜진 시트(생략)와 true는 지문이 같다',
    flowFingerprint([cleanMap({ id: 'm1' })]), flowFingerprint([cleanMap({ id: 'm1', bundleEdges: true })]));
  ok('#110c 복제는 토글을 승계한다', duplicateFlowMap(withOff, 'm1')[1].bundleEdges === false);
  // ⚠️ 내용 판정에 넣으면 '토글만 끈 빈 시트'가 내용 있음이 되어 백업 복원 경로가 영구히 막힌다.
  eq('#110d 토글은 "내용 있음" 판정에 들어가지 않는다', flowMapsHaveContent([{ nodes: [], edges: [], bundleEdges: false }]), false);
  eq('#110e 새 시트에 기본값을 저장하지 않는다', 'bundleEdges' in makeFlowMap('x'), false);
}

console.log('\n■ 연결 위치(fromSide/toSide) 정규화');
{
  eq('#111 4방위는 통과', [normalizeFlowSide('l'), normalizeFlowSide('r'), normalizeFlowSide('t'), normalizeFlowSide('b')].join(','), 'l,r,t,b');
  eq('#111b auto는 생략형', normalizeFlowSide('auto'), undefined);
  eq('#111c 손상값은 생략형', normalizeFlowSide('xyz'), undefined);
  // ⚠️ 검증 없이 통과시키면 손상값이 그대로 side로 쓰여 anchorPoint의 default('아래')로 떨어진다.
  const m = normalizeFlowMaps([cleanMap({ id: 'm1', edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', fromSide: 'zzz' }] })]);
  eq('#111d 정규화가 손상 side를 제거', 'fromSide' in m[0].edges[0], false);
  const keep = normalizeFlowMaps([cleanMap({ id: 'm1', edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', fromSide: 'r' }] })]);
  eq('#111e 유효한 side는 보존', keep[0].edges[0].fromSide, 'r');
}

console.log('\n■ 도형 정렬 스냅');
{
  const P = (x, y, w = 260, h = 120) => makeFlowNode({ id: 'ref', x, y, w, h });
  const base = { x: 0, y: 0, w: 180, h: 120 };
  // ⚠️ 폭을 262로 둔다(260 아님) — right=862라 이동 후보(862-180=682)가 **격자 배수가 아니다**.
  //    260이면 후보가 680(=85×8)이 되어 "정렬된 축에 격자를 다시 걸어도 값이 같아" #115가
  //    죽은 단언이 된다(이 저장소가 반복해서 겪은 형태).
  const peers = [P(600, 100, 262)];      // left=600 center=731 right=862
  const tol = snapTolerance(1);
  eq('#112 임계값은 화면 px을 배율로 나눈 값', [snapTolerance(1), snapTolerance(0.25), snapTolerance(2.5)].join(','), '6,24,2.4');
  // ⚠️ tol이 Infinity가 되면 도형이 화면 밖 먼 노드로 순간이동한다.
  eq('#112b 손상 배율은 1로 떨어뜨린다', [snapTolerance(NaN), snapTolerance(0), snapTolerance(-2), snapTolerance('x')].join(','), '6,6,6,6');

  // 사용자 요구: "모서리 인근에 놓으면 가운데로 강제 정렬하면 안 된다"
  const nearLeft = resolveNodeDrag(base, 602, 400, peers, tol, true);
  eq('#113 왼쪽 모서리 근처면 왼쪽에 맞춘다', nearLeft.preview.x, 600);
  const nearCenter = resolveNodeDrag(base, 644, 400, peers, tol, true);   // center 후보 = 731-90 = 641
  eq('#113b 가운데 근처면 가운데에 맞춘다', nearCenter.preview.x, 641);
  const nearRight = resolveNodeDrag(base, 679, 400, peers, tol, true);    // right 후보 = 862-180 = 682
  eq('#113c 오른쪽 모서리 근처면 오른쪽에 맞춘다', nearRight.preview.x, 682);
  // ⚠️ 이 셋이 전부 통과해야 '중심에 가산점을 주지 않는다'가 실증된다.
  ok('#113d 세 후보가 서로 다른 자리로 간다(중심 편향 없음)',
    nearLeft.preview.x !== nearCenter.preview.x && nearCenter.preview.x !== nearRight.preview.x);

  const far = resolveNodeDrag(base, 300, 400, peers, tol, true);
  eq('#114 임계 밖이면 정렬하지 않는다', far.preview.x, 300);
  eq('#114b 정렬이 없는 축은 종전대로 격자 커밋', far.commit.x, 304);
  eq('#114c 가이드도 없다', far.guides.length, 0);

  // ⚠️ 최우선 회귀 — 정렬된 축에 격자를 다시 걸면 기본폭(180, mod 8 === 4)에서 100% 4px 어긋난다.
  eq('#115 정렬된 축은 커밋에도 격자를 적용하지 않는다', nearRight.commit.x, 682);
  ok('#115b 그 값은 격자 배수가 아니다(픽스처가 유효한가)', 682 % 8 !== 0);
  eq('#115c 미리보기와 커밋이 같다', nearRight.preview.x, nearRight.commit.x);

  // 축 독립
  const both = resolveNodeDrag(base, 602, 102, [P(600, 100)], tol, true);
  eq('#116 x·y를 독립으로 판정한다', [both.preview.x, both.preview.y].join(','), '600,100');
  eq('#116b 축마다 가이드가 하나씩', both.guides.length, 2);
  const onlyX = resolveNodeDrag(base, 602, 999, [P(600, 100)], tol, true);
  eq('#116c 한 축만 맞아도 그 축만 맞춘다', [onlyX.preview.x, onlyX.guides.length].join(','), '600,1');

  // ⚠️ 스냅을 끄면 **종전과 바이트 단위로 동일**해야 한다.
  const off = resolveNodeDrag(base, 602, 402, peers, tol, false);
  eq('#117 스냅 OFF는 종전 동작(미리보기 raw · 커밋 격자)', JSON.stringify(off), JSON.stringify({ preview: { x: 602, y: 402 }, commit: { x: 600, y: 400 }, guides: [] }));
  eq('#117b 참조가 없어도 종전 동작', JSON.stringify(resolveNodeDrag(base, 602, 402, [], tol, true)), JSON.stringify(off));

  // 가이드 범위 = 이동 도형 ∪ 맞춰진 참조들
  eq('#118 가이드는 스냅된 값에 놓인다', nearLeft.guides[0].value, 600);
  eq('#118b 가이드 축', nearLeft.guides[0].axis, 'x');
  ok('#118c 가이드가 두 도형을 모두 덮는다', nearLeft.guides[0].from <= 100 && nearLeft.guides[0].to >= 520);
}

console.log('\n■ 선 위 라벨');
{
  // ⚠️ 종전 `length * 12`는 한글/영문 혼용에서 최대 2배까지 틀린다.
  eq('#119 한글은 1em', approxLabelWidth('가나다'), 36);
  eq('#119b 영문은 0.55em', approxLabelWidth('abcde'), 33);
  ok('#119c 영문 12자는 종전 추정(144)보다 훨씬 좁다', approxLabelWidth('ABCDEFGHIJKL') < 100);
  eq('#119d 빈 문자열·비문자열은 0', [approxLabelWidth(''), approxLabelWidth(null), approxLabelWidth(7)].join(','), '0,0,0');
  eq('#119e 상자는 좌우 패딩을 더한다', flowLabelSize('가').w, 12 + FLOW_LABEL_PAD * 2);

  // ⚠️ **하위호환의 축** — 충돌이 없으면 종전과 같은 자리(오프셋 0)에 놓인다.
  const free = layoutFlowLabels([{ id: 'a', cx: 500, cy: 500, w: 80, h: 22 }, { id: 'b', cx: 900, cy: 500, w: 80, h: 22 }], []);
  eq('#120 겹치지 않으면 제자리', JSON.stringify(free), JSON.stringify([{ id: 'a', mode: 'label', x: 500, y: 500 }, { id: 'b', mode: 'label', x: 900, y: 500 }]));
  eq('#120b 도형이 있어도 안 겹치면 제자리', JSON.stringify(layoutFlowLabels([{ id: 'a', cx: 500, cy: 500, w: 80, h: 22 }], [{ x: 0, y: 0, w: 100, h: 100 }])), JSON.stringify([{ id: 'a', mode: 'label', x: 500, y: 500 }]));

  const clash = layoutFlowLabels([{ id: 'a', cx: 500, cy: 500, w: 80, h: 22 }, { id: 'b', cx: 505, cy: 502, w: 80, h: 22 }], []);
  eq('#121 먼저 온 라벨은 제자리', JSON.stringify(clash[0]), JSON.stringify({ id: 'a', mode: 'label', x: 500, y: 500 }));
  ok('#121b 겹친 라벨만 비켜난다', clash[1].mode === 'label' && clash[1].y !== 502);

  // ⚠️ 도형 박스를 장애물로 받지 않으면 '메모를 썼는데 화면 어디에도 없다'가 된다.
  const onNode = layoutFlowLabels([{ id: 'a', cx: 100, cy: 100, w: 80, h: 22 }], [{ x: 0, y: 60, w: 200, h: 80 }]);
  ok('#122 도형 위면 비켜나거나 점으로 접힌다', onNode[0].mode === 'dot' || onNode[0].y !== 100);
  const boxed = layoutFlowLabels([{ id: 'a', cx: 100, cy: 100, w: 80, h: 22 }], [{ x: -400, y: -400, w: 1000, h: 1000 }]);
  eq('#122b 사방이 막히면 점으로 접는다(메모가 있다는 사실은 남긴다)', boxed[0].mode, 'dot');
  eq('#122c 점도 제자리를 지킨다', [boxed[0].x, boxed[0].y].join(','), '100,100');
  eq('#123 손상 입력은 조용히 건너뛴다', JSON.stringify(layoutFlowLabels([{ id: 'a', cx: NaN, cy: 1, w: 1, h: 1 }, null], [])), '[]');
  eq('#123b 빈 입력은 빈 결과', JSON.stringify(layoutFlowLabels(null, null)), '[]');
}

console.log('\n■ 도형 안 표 — 값 파싱·포맷');
{
  eq('#140 콤마·통화기호를 벗긴다', [parseFlowNumber('30,000,000'), parseFlowNumber('₩1,000'), parseFlowNumber(' 42 ')].join(','), '30000000,1000,42');
  eq('#140b 음수·소수', [parseFlowNumber('-1,500'), parseFlowNumber('12.5')].join(','), '-1500,12.5');
  // ⚠️ '값 없음'과 '0'은 다른 사건이다 — cleanNum을 쓰면 빈칸이 0이 되어 합계에 들어간다.
  eq('#140c 빈칸은 null(0이 아니다)', parseFlowNumber(''), null);
  eq('#140d 0은 0', parseFlowNumber('0'), 0);
  // ⚠️ 가운데 섞인 글자를 통과시키면 '12x34'가 1234가 된다.
  eq('#140e 숫자가 아니면 null', ['약 3억', '12x34', '1,2,3원', null, {}].map(v => parseFlowNumber(v)).join(','), ',,,,');
  // ⚠️ `Number()`는 관대해서 16진수·지수 표기를 조용히 받아들인다 — 금액 칸에 `0x1A`를 치면
  //    26으로 계상된다. 정규식이 그 통로를 막는 유일한 장치이므로 반드시 테스트한다
  //    (Number.isFinite 가드만으로는 이 셋이 전부 통과한다 — 실측으로 죽은 단언이었다).
  eq('#140f 16진수·지수·앞점 표기는 받지 않는다',
    ['0x1A', '1e5', '.5', 'Infinity'].map(v => parseFlowNumber(v)).join(','), ',,,');
  eq('#141 천단위 콤마', [formatFlowNumber(30000000), formatFlowNumber(-1500), formatFlowNumber(0)].join(' / '), '30,000,000 / -1,500 / 0');
  eq('#141b 소수 유지', formatFlowNumber(1234.5), '1,234.5');
}

console.log('\n■ 도형 안 표 — 계산 (소계 = 직전 구분선 이후 항목 합 · 잔액 = Σ총액 − Σ항목)');
{
  const R = (kind, label, value = '') => ({ kind, label, value });
  // 사용자 화면(CMA 1)의 실제 구조
  const cma = {
    border: 'none',
    rows: [
      R('total', '총액', '360,000,000'),
      R('item', '자동차 구매', '30,000,000'),
      R('item', '마통', '90,000,000'),
      R('subtotal', '소계'),
      R('rule', ''),
      R('item', '해외 계좌 이전', '130,000,000'),
      R('subtotal', '소계'),
      R('rule', ''),
      R('item', '27년 ISA 일반', '20,000,000'),
      R('item', '27년 ISA 국내', '20,000,000'),
      R('item', '27년 연금저축', '18,000,000'),
      R('subtotal', '소계'),
      R('rule', ''),
      R('balance', '잔액'),
    ],
  };
  const c = computeFlowTable(cma);
  eq('#142 첫 소계 = 30,000,000 + 90,000,000', c[3].text, '120,000,000');
  eq('#142b 구분선 뒤 소계는 그 구역만', c[6].text, '130,000,000');
  eq('#142c 세 번째 소계', c[11].text, '58,000,000');
  // ⚠️ 잔액을 `Σtotal − Σsubtotal`로 바꾸면 이 값이 같아 보이지만, 소계를 안 쓰는 표에서
  //    총액 그대로가 되고 한 구역만 소계를 단 표에서는 나머지 항목이 통째로 빠진다.
  eq('#142d 잔액 = 360,000,000 − 308,000,000', c[13].text, '52,000,000');
  eq('#142e 자동 계산 행에 표시가 붙는다', [c[3].computed, c[13].computed, c[1].computed].join(','), 'true,true,false');
  eq('#142f 구분선은 빈 행', [c[4].kind, c[4].text].join(','), 'rule,');

  // 소계를 하나도 쓰지 않아도 잔액이 같아야 한다(그게 Σitem으로 정의한 이유다)
  const noSub = { border: 'none', rows: [R('total', '총액', '360,000,000'), R('item', 'a', '30,000,000'), R('item', 'b', '90,000,000'), R('balance', '잔액')] };
  eq('#143 소계가 없어도 잔액은 Σtotal − Σitem', computeFlowTable(noSub)[3].text, '240,000,000');
  // 한 구역에만 소계를 단 표 — Σsubtotal 방식이면 여기서 갈린다
  const partial = { border: 'none', rows: [R('total', '총액', '100'), R('item', 'a', '10'), R('subtotal', '소계'), R('rule', ''), R('item', 'b', '20'), R('balance', '잔액')] };
  eq('#143b 소계를 단 구역만 있어도 나머지 항목이 빠지지 않는다', computeFlowTable(partial)[5].text, '70');

  // ⚠️ 숫자로 안 읽히는 값은 합계에서 빼고 원문 그대로 보여 준다(0으로 떨어뜨리면 조용히 계산에 들어간다)
  const memoish = { border: 'none', rows: [R('total', '총액', '100'), R('item', 'a', '약 3억'), R('item', 'b', '30'), R('balance', '잔액')] };
  const mc = computeFlowTable(memoish);
  eq('#144 숫자가 아닌 값은 원문 그대로', mc[1].text, '약 3억');
  eq('#144b 합계에서는 빠진다', mc[3].text, '70');
  eq('#145 빈 표·손상 입력은 빈 결과', [computeFlowTable(null).length, computeFlowTable({ rows: null }).length].join(','), '0,0');
  eq('#145b 총액이 없으면 잔액은 음수(Σitem을 그대로 뺀다)', computeFlowTable({ rows: [R('item', 'a', '50'), R('balance', 'b')] })[1].text, '-50');
}

console.log('\n■ 도형 안 표 — 정규화·영속화');
{
  const R = (kind, label, value = '') => ({ kind, label, value });
  eq('#146 값이 없으면 undefined(빈 표를 만들지 않는다)', normalizeFlowTable({ rows: [], border: 'all' }), undefined);
  eq('#146b 표가 아니면 undefined', [normalizeFlowTable(null), normalizeFlowTable('x'), normalizeFlowTable(7)].filter(v => v !== undefined).length, 0);
  eq('#146c 손상 행 종류는 항목으로', normalizeFlowTable({ rows: [{ kind: 'zzz', label: 'a', value: '1' }] }).rows[0].kind, 'item');
  eq('#146d 손상 선 표시는 없음으로', normalizeFlowTable({ rows: [R('item', 'a')], border: 'zzz' }).border, 'none');
  // ⚠️ 구분선이 라벨·값을 들면 화면에 안 보이는 유령 텍스트가 남는다.
  eq('#146e 구분선은 라벨·값을 버린다', JSON.stringify(normalizeFlowTable({ rows: [R('rule', 'x', '9')] }).rows[0]), JSON.stringify({ kind: 'rule', label: '', value: '' }));
  eq('#146f 행 상한', normalizeFlowTable({ rows: Array.from({ length: 60 }, () => R('item', 'a', '1')) }).rows.length, MAX_FLOW_TABLE_ROWS);
  eq('#146g 텍스트 상한', normalizeFlowTable({ rows: [R('item', 'x'.repeat(200), 'y'.repeat(200))] }).rows[0].label.length, MAX_FLOW_TABLE_TEXT);
  // ⚠️ 멱등 — 두 번 정규화해도 같아야 폴링마다 재저장이 돌지 않는다.
  const once = normalizeFlowTable({ rows: [R('item', 'a', '1'), R('rule', '')], border: 'all' });
  eq('#146h 멱등', JSON.stringify(normalizeFlowTable(once)), JSON.stringify(once));

  // ⚠️ 객체라 `!==`로는 판정할 수 없다 — 참조가 다르면 항상 '변경됨'이 되어 매 로드 재구축이 돈다.
  ok('#147 같은 내용이면 같다고 본다', sameFlowTable({ rows: [R('item', 'a', '1')], border: 'none' }, { rows: [R('item', 'a', '1')], border: 'none' }));
  ok('#147b 값이 다르면 다르다', !sameFlowTable({ rows: [R('item', 'a', '1')], border: 'none' }, { rows: [R('item', 'a', '2')], border: 'none' }));
  ok('#147c 선 표시가 다르면 다르다', !sameFlowTable({ rows: [R('item', 'a', '1')], border: 'none' }, { rows: [R('item', 'a', '1')], border: 'all' }));
  ok('#147d 둘 다 없으면 같다', sameFlowTable(undefined, undefined) && !sameFlowTable(undefined, { rows: [R('item', 'a')], border: 'none' }));

  // 노드 화이트리스트 — 빠지면 재구축 경로에서 표가 조용히 사라진다
  eq('#148 makeFlowNode가 표를 보존', makeFlowNode({ id: 'n', table: { rows: [R('item', 'a', '1')], border: 'all' } }).table?.rows?.length, 1);
  eq('#148b 표가 없으면 필드를 만들지 않는다', 'table' in makeFlowNode({ id: 'n' }), false);
  eq('#148c 빈 표도 필드를 만들지 않는다', 'table' in makeFlowNode({ id: 'n', table: { rows: [] } }), false);

  // ⚠️ 최우선 회귀 — 정규형이면 원본 참조라 살아남고, mapChanged가 서는 순간 사라진다.
  //    반드시 **재구축을 강제한** 픽스처로 재야 한다.
  const withTbl = { id: 'n1', kind: 'rect', x: 0, y: 0, w: 180, h: 120, label: '', date: '', amountManual: null, memo: '', portfolioId: null, accountNameSnapshot: '', amountSource: 'none', table: { rows: [R('item', 'a', '1')], border: 'all' } };
  const forced = normalizeFlowMaps([cleanMap({ id: 'm1', name: 123, nodes: [withTbl], edges: [] })]);
  eq('#149 재구축 경로에서도 표가 보존된다', forced[0]?.nodes?.[0]?.table?.rows?.[0]?.label, 'a');
  eq('#149b 재구축이 실제로 일어났다(픽스처가 유효한가)', forced[0].name, '흐름도');
  const clean = [cleanMap({ id: 'm1', nodes: [withTbl], edges: [] })];
  eq('#149c 표만 있고 나머지가 정규형이면 원본 참조(멱등)', normalizeFlowMaps(clean) === clean, true);
  // ⚠️ 노드 비교에서 표를 빼면 '표가 사라진다'가 아니라 **손상된 표가 교정되지 않고 남는다**.
  //    다른 필드가 전부 정규형이면 mapChanged가 서지 않아 원본 노드가 그대로 push되기 때문이다
  //    → 상한을 넘는 행과 손상된 선 표시가 저장에 그대로 굳는다(실측: 이 픽스처가 없으면
  //    `!sameFlowTable(...)`을 `false`로 바꿔도 전 항목이 통과했다).
  const dirtyNode = { ...withTbl, table: { rows: Array.from({ length: MAX_FLOW_TABLE_ROWS + 20 }, () => R('item', 'a', '1')), border: 'bad' } };
  const fixedMap = normalizeFlowMaps([cleanMap({ id: 'm1', nodes: [dirtyNode], edges: [] })]);
  eq('#149d 손상된 표는 다른 필드가 정규형이어도 교정된다(행 절단)', fixedMap[0]?.nodes?.[0]?.table?.rows?.length, MAX_FLOW_TABLE_ROWS);
  eq('#149e 손상된 선 표시도 교정된다', fixedMap[0]?.nodes?.[0]?.table?.border, 'none');

  // ⚠️ 지문 누락 = '표만 고친 세션'의 STATE 저장 통째 스킵.
  const a = [cleanMap({ id: 'm1', nodes: [withTbl], edges: [] })];
  const b = [cleanMap({ id: 'm1', nodes: [{ ...withTbl, table: { rows: [R('item', 'a', '2')], border: 'all' } }], edges: [] })];
  ok('#150 표 값을 고치면 지문이 달라진다', flowFingerprint(a) !== flowFingerprint(b));
  const c2 = [cleanMap({ id: 'm1', nodes: [{ ...withTbl, table: { rows: [R('item', 'a', '1')], border: 'none' } }], edges: [] })];
  ok('#150b 선 표시만 바꿔도 지문이 달라진다', flowFingerprint(a) !== flowFingerprint(c2));
  // ⚠️ 표가 없는 도형은 null이라 기존 흐름도의 지문이 배포만으로 달라지지 않는다.
  const noTbl = { ...withTbl };
  delete noTbl.table;
  eq('#150c 표가 없는 도형의 지문에 표 자리는 null',
    JSON.parse(flowFingerprint([cleanMap({ id: 'm1', nodes: [noTbl], edges: [] })]))[0].nd[0].slice(-1)[0], null);
}

console.log('\n■ 도형 안 표 — 엑셀 붙여넣기');
{
  eq('#151 탭 구분', JSON.stringify(flowTableFromText('자동차\t30,000,000\n마통\t90,000,000')),
    JSON.stringify([{ kind: 'item', label: '자동차', value: '30,000,000' }, { kind: 'item', label: '마통', value: '90,000,000' }]));
  eq('#151b 2칸 이상 공백도 열 구분', flowTableFromText('자동차   30,000,000')[0].value, '30,000,000');
  eq('#151c 구분선처럼 보이는 줄은 구분선 행', flowTableFromText('a\t1\n-----\nb\t2').map(r => r.kind).join(','), 'item,rule,item');
  eq('#151d 빈 줄은 건너뛴다', flowTableFromText('a\t1\n\n\nb\t2').length, 2);
  eq('#151e 값 없는 줄도 항목으로', JSON.stringify(flowTableFromText('메모만')), JSON.stringify([{ kind: 'item', label: '메모만', value: '' }]));
  eq('#151f 행 상한', flowTableFromText(Array.from({ length: 60 }, (_, i) => `a${i}\t1`).join('\n')).length, MAX_FLOW_TABLE_ROWS);
  eq('#151g 빈 입력', flowTableFromText('').length, 0);
}

console.log('\n■ 도형 안 표 — 실행 체크 · 취소선 · 기울임 (사용자 요청 2026-09)');
{
  const R = (kind, label, value = '', o = {}) => ({ kind, label, value, ...o });
  deep('#152 세 표시를 보존한다',
    normalizeFlowTable({ rows: [R('item', 'a', '1', { done: true, strike: true, italic: true })] })?.rows?.[0],
    { kind: 'item', label: 'a', value: '1', done: true, strike: true, italic: true });
  // ⚠️ false를 저장하면 기존 표가 전부 정규화에서 '변경됨'이 되어 원본 참조 보존 계약이 깨진다.
  deep('#152b false는 필드를 만들지 않는다',
    normalizeFlowTable({ rows: [R('item', 'a', '1', { done: false, strike: false, italic: false })] })?.rows?.[0],
    { kind: 'item', label: 'a', value: '1' });
  // ⚠️ 실행 체크는 항목 행 전용 — 총액·소계·잔액에 남으면 화면에 안 보이는 유령 상태가 저장된다.
  eq('#152c 실행 체크는 항목 행에만 남는다',
    (normalizeFlowTable({ rows: ['total', 'subtotal', 'balance', 'item'].map(k => R(k, k, '1', { done: true })) })?.rows || []).map(r => (r.done === true ? 1 : 0)).join(''),
    '0001');
  eq('#152d 취소선·기울임은 구분선만 뺀다',
    (normalizeFlowTable({ rows: ['item', 'subtotal', 'total', 'balance', 'rule'].map(k => R(k, k, '1', { strike: true, italic: true })) })?.rows || []).map(r => flowTableRowFlags(r)).join(','),
    'si,si,si,si,');
  // ⚠️ 판정은 `=== true` — truthy 손상값을 받아들이면 사용자가 켠 적 없는 표시가 저장에 굳는다.
  deep('#152e 손상값(문자열·숫자·객체)은 버린다',
    normalizeFlowTable({ rows: [R('item', 'a', '', { done: 'yes', strike: 1, italic: {} })] })?.rows?.[0],
    { kind: 'item', label: 'a', value: '' });
  const withFlags = normalizeFlowTable({ rows: [R('item', 'a', '1', { done: true }), R('total', 't', '9', { italic: true }), R('rule', '')], border: 'all' });
  eq('#152f 멱등(표시 포함)', JSON.stringify(normalizeFlowTable(withFlags)), JSON.stringify(withFlags));

  // ⚠️ 비교에서 표시를 빼면 **체크·취소선만 바꾼 편집**이 팝업 flush에서 '변경 없음'으로 걸러져 저장되지 않는다.
  const base = { border: 'none', rows: [R('item', 'a', '1')] };
  ok('#153 실행 체크만 달라도 다르다', !sameFlowTable(base, { border: 'none', rows: [R('item', 'a', '1', { done: true })] }));
  ok('#153b 취소선만 달라도 다르다', !sameFlowTable(base, { border: 'none', rows: [R('item', 'a', '1', { strike: true })] }));
  ok('#153c 기울임만 달라도 다르다', !sameFlowTable(base, { border: 'none', rows: [R('item', 'a', '1', { italic: true })] }));
  ok('#153d 같은 표시면 참조가 달라도 같다',
    sameFlowTable({ border: 'none', rows: [R('item', 'a', '1', { done: true, italic: true })] }, { border: 'none', rows: [R('item', 'a', '1', { done: true, italic: true })] }));

  // ⚠️ 표시는 **그리기 전용**이다 — 실행한 계획도 금액은 그대로 합산된다.
  const plan = {
    border: 'none',
    rows: [R('total', '총액', '100'), R('item', '실행함', '30', { done: true, strike: true }), R('item', '아직', '20'), R('subtotal', '소계', '', { italic: true }), R('balance', '잔액')],
  };
  const c = computeFlowTable(plan);
  eq('#154 실행한 항목도 소계에 그대로 들어간다', c[3]?.text, '50');
  eq('#154b 잔액도 그대로(Σtotal − Σitem)', c[4]?.text, '50');
  eq('#154c 계산 결과에 표시가 실린다(도형이 원본 행을 인덱스로 다시 읽지 않게)',
    [c[1]?.done, c[1]?.strike, c[1]?.italic, c[2]?.done, c[3]?.italic].join(','), 'true,true,false,false,true');
  eq('#154d 항목이 아닌 행의 체크는 계산 결과에서도 false', computeFlowTable({ rows: [R('total', 't', '1', { done: true })] })[0]?.done, false);
  const bare = { border: 'none', rows: plan.rows.map(r => ({ kind: r.kind, label: r.label, value: r.value })) };
  eq('#154e 표시 유무와 무관하게 숫자가 같다', computeFlowTable(bare).map(r => r.text).join('|'), c.map(r => r.text).join('|'));

  deep('#155 실행 현황은 항목 행만 센다', flowTableCheckStats(plan), { done: 1, total: 2 });
  deep('#155b 손상된 표시·항목 외 행의 체크는 세지 않는다',
    flowTableCheckStats({ rows: [R('item', 'a', '', { done: 'yes' }), R('total', 't', '', { done: true })] }), { done: 0, total: 1 });
  deep('#155c 빈 표·손상 입력은 0/0', [flowTableCheckStats(null), flowTableCheckStats({ rows: 7 })], [{ done: 0, total: 0 }, { done: 0, total: 0 }]);

  const nodeOf = (rows) => ({ id: 'n1', kind: 'rect', x: 0, y: 0, w: 180, h: 120, label: '', date: '', amountManual: null, memo: '', portfolioId: null, accountNameSnapshot: '', amountSource: 'none', table: { rows, border: 'none' } });
  const fpOf = (rows) => flowFingerprint([cleanMap({ id: 'm1', nodes: [nodeOf(rows)], edges: [] })]);
  // ⚠️ 배포 churn 가드 — 표시가 없는 행의 지문은 이 기능 이전과 같은 3칸이어야 한다.
  eq('#156 표시 없는 행의 지문은 종전 3칸', JSON.parse(fpOf([R('item', 'a', '1')]))[0]?.nd?.[0]?.slice(-1)?.[0]?.[1]?.[0]?.length, 3);
  // ⚠️ 지문에서 빠지면 '체크만 한 세션'이 portfolioUpdatedAt을 못 올려 STATE 저장이 통째로 스킵된다.
  ok('#156b 실행 체크만 바꿔도 지문이 달라진다', fpOf([R('item', 'a', '1')]) !== fpOf([R('item', 'a', '1', { done: true })]));
  ok('#156c 취소선만 바꿔도 지문이 달라진다', fpOf([R('item', 'a', '1')]) !== fpOf([R('item', 'a', '1', { strike: true })]));
  ok('#156d 기울임만 바꿔도 지문이 달라진다', fpOf([R('item', 'a', '1')]) !== fpOf([R('item', 'a', '1', { italic: true })]));
  ok('#156e 취소선과 기울임은 서로 다른 지문', fpOf([R('item', 'a', '1', { strike: true })]) !== fpOf([R('item', 'a', '1', { italic: true })]));

  // ⚠️ 재구축 경로(mapChanged=true)를 강제한 픽스처로 재야 한다 — 정규형이면 원본 참조라 살아남는다.
  const forced = normalizeFlowMaps([cleanMap({ id: 'm1', name: 123, nodes: [nodeOf([R('item', 'a', '1', { done: true, strike: true })])], edges: [] })]);
  eq('#157 재구축 경로에서도 표시가 보존된다', flowTableRowFlags(forced[0]?.nodes?.[0]?.table?.rows?.[0]), 'ds');
  eq('#157b 재구축이 실제로 일어났다(픽스처가 유효한가)', forced[0]?.name, '흐름도');
  const clean = [cleanMap({ id: 'm1', nodes: [nodeOf([R('item', 'a', '1', { done: true, italic: true })])], edges: [] })];
  eq('#157c 표시만 있고 나머지가 정규형이면 원본 참조(멱등)', normalizeFlowMaps(clean) === clean, true);
  // ⚠️ 노드 비교에서 표시를 빼면 손상값이 교정되지 않고 남는다(다른 필드가 정규형이면 원본 노드가 그대로 push).
  const dirty = normalizeFlowMaps([cleanMap({ id: 'm1', nodes: [nodeOf([R('item', 'a', '1', { done: 'yes' }), R('rule', '', '', { strike: true })])], edges: [] })]);
  eq('#157d 손상된 표시는 다른 필드가 정규형이어도 교정된다',
    JSON.stringify(dirty[0]?.nodes?.[0]?.table?.rows), JSON.stringify([{ kind: 'item', label: 'a', value: '1' }, { kind: 'rule', label: '', value: '' }]));
}

console.log('\n■ 메모·표 팝업 위치 클램프 (가운데에서 열고, 제목 줄을 끌어 옮긴다)');
{
  deep('#158 화면 안이면 그대로(정수화)', clampFlowEditorPos(300.4, 200.6, 680, 1440, 900), { x: 300, y: 201 });
  deep('#158b 오른쪽 끝 — 최소 GRIP px는 화면에 남는다', clampFlowEditorPos(5000, 100, 680, 1440, 900), { x: 1440 - FLOW_EDITOR_GRIP_PX, y: 100 });
  deep('#158c 왼쪽 끝 — 최소 GRIP px는 화면에 남는다', clampFlowEditorPos(-5000, 100, 680, 1440, 900), { x: FLOW_EDITOR_GRIP_PX - 680, y: 100 });
  // ⚠️ 제목 줄이 화면 위로 사라지면 다시 잡을 곳이 없어 닫고 다시 여는 것 말고는 되찾을 방법이 없다.
  deep('#158d 위로는 제목 줄이 화면 밖으로 못 나간다', clampFlowEditorPos(100, -300, 680, 1440, 900), { x: 100, y: 0 });
  deep('#158e 아래로는 제목 줄 전체가 남는다', clampFlowEditorPos(100, 5000, 680, 1440, 900), { x: 100, y: 900 - FLOW_EDITOR_HEADER_PX });
  // ⚠️ 창이 GRIP보다 좁아도 하한이 상한을 넘으면 안 된다(뒤집히면 좌표가 튄다).
  const tiny = clampFlowEditorPos(50, 50, 680, 80, 30);
  ok('#158f 아주 좁은 창에서도 하한 ≤ 상한', tiny.x === 80 - FLOW_EDITOR_GRIP_PX && tiny.y === 0);
  // ⚠️ 팝업이 GRIP 두 배보다 좁고 창도 좁으면 'GRIP − 폭'이 '창 − GRIP'보다 커진다 — 하한을 상한으로
  //    묶지 않으면 clamp가 하한을 돌려줘 상한을 넘는다(위 #158f는 팝업이 넓어 이 분기를 밟지 않는다).
  eq('#158h 좁은 팝업 + 좁은 창에서도 상한을 넘지 않는다', clampFlowEditorPos(0, 0, 100, 100, 100).x, 100 - FLOW_EDITOR_GRIP_PX);
  deep('#158g 손상 입력은 0으로(팝업이 사라지지 않게)', clampFlowEditorPos(NaN, Infinity, 680, 1440, 900), { x: 0, y: 0 });
}

console.log('\n■ removeNode / pruneOrphanEdges');
{
  const m = cleanMap();
  const r = removeNode(m, 'n1');
  eq('#21 노드 삭제 시 연결 엣지 동반 제거', r.edges.length, 0);
  eq('#21b 남은 노드 1개', r.nodes.length, 1);
  ok('#21c 없는 id 삭제는 원본 참조 반환', removeNode(m, 'ZZZ') === m);
}
{
  const m = cleanMap({ nodes: [mkNode({ id: 'n1' })] });
  eq('#22 고아 엣지 정리', pruneOrphanEdges(m).edges.length, 0);
  const intact = cleanMap();
  ok('#22b 정리할 게 없으면 원본 참조', pruneOrphanEdges(intact) === intact);
}

console.log('\n■ resolveFlowNodeView — 계좌 해석 (라이브 재조회, 복사 금지)');
{
  const node = mkNode({ id: 'n', portfolioId: 'p1', amountSource: 'account', accountNameSnapshot: '옛이름' });
  const view = resolveFlowNodeView(node, { id: 'p1', name: 'ISA', accountType: 'isa' }, { id: 'p1', currentEval: 1000 });
  eq('#23 계좌명은 라이브 값', view.displayName, 'ISA');
  eq('#23b 금액은 summary.currentEval', view.shownAmount, 1000);
  eq('#23c accountType 은 portfolios 소스(summary 는 전부 portfolio 로 납작해진다)', view.accountType, 'isa');
}
{
  // ⚠️ 삭제 계좌: summary 는 실수치 currentEval 을 그대로 반환한다(제외는 intTotals 에서만).
  //    여기서 null 처리하지 않으면 '삭제 계좌 = 라이브 완전 제외' 불변식이 깨진다.
  const node = mkNode({ id: 'n', portfolioId: 'p1', amountSource: 'account' });
  const view = resolveFlowNodeView(node, { id: 'p1', name: 'ISA', deletedAt: '2026-07-01' }, { id: 'p1', currentEval: 1000 });
  eq('#24 삭제 계좌 금액은 null', view.shownAmount, null);
  eq('#24b 이름에 (삭제됨) 접미', view.displayName, 'ISA (삭제됨)');
  ok('#24c deleted 플래그', view.deleted === true);
}
{
  // TEST 계좌는 통합 표도 평가금액은 표시한다(평가비중만 '-') → 금액을 지우지 않는다
  const node = mkNode({ id: 'n', portfolioId: 'p1', amountSource: 'account' });
  const view = resolveFlowNodeView(node, { id: 'p1', name: 'T', isTest: true }, { id: 'p1', currentEval: 500 });
  eq('#25 TEST 계좌는 금액을 그대로 표시(강등만)', view.shownAmount, 500);
  ok('#25b isTest 플래그로 시각 강등', view.isTest === true);
}
{
  const node = mkNode({ id: 'n', portfolioId: 'GONE', amountSource: 'account', accountNameSnapshot: '옛 계좌' });
  const view = resolveFlowNodeView(node, undefined, undefined);
  ok('#26 purge 된 계좌 → dangling', view.dangling === true && view.resolved === false);
  eq('#26b 스냅샷 이름으로 폴백(코드만 남지 않게)', view.displayName, '옛 계좌');
  eq('#26c 금액은 null', view.shownAmount, null);
}
{
  const node = mkNode({ id: 'n', portfolioId: 'p1', label: '내가 쓴 이름', amountSource: 'manual', amountManual: 777 });
  const view = resolveFlowNodeView(node, { id: 'p1', name: 'ISA' }, { id: 'p1', currentEval: 1000 });
  eq('#26d 사용자 입력 라벨이 라이브 계좌명보다 우선', view.displayName, '내가 쓴 이름');
  eq('#26e amountSource=manual 이면 직접입력 금액', view.shownAmount, 777);
}
eq('#26f countDanglingNodes', countDanglingNodes([cleanMap({ nodes: [mkNode({ id: 'a', portfolioId: 'x' }), mkNode({ id: 'b', portfolioId: 'p1' })], edges: [] })], [{ id: 'p1' }]), 1);

console.log('\n■ 팬/줌 저장 — 닫았다 열면 마지막 화면 (normalizeFlowViewport · fitFlowViewport)');
ok('#38 비객체/손상값 → null (throw 금지)',
  normalizeFlowViewport(null) === null && normalizeFlowViewport('x') === null &&
  normalizeFlowViewport({ x: NaN, y: 0, scale: 1 }) === null && normalizeFlowViewport({ x: 0, y: 0 }) === null);
deep('#39 좌표는 정수, 배율은 소수 4자리로 정리(휠 줌 부동소수 노이즈가 지문에 새는 것 방지)',
  normalizeFlowViewport({ x: 12.4, y: -7.6, scale: 1.3310000000000004 }), { x: 12, y: -8, scale: 1.331 });
deep('#39b 배율은 캔버스 휠 한계와 같은 범위로 클램프', normalizeFlowViewport({ x: 0, y: 0, scale: 99 }), { x: 0, y: 0, scale: FLOW_MAX_SCALE });
deep('#39c 배율 하한도 동일', normalizeFlowViewport({ x: 0, y: 0, scale: 0.001 }), { x: 0, y: 0, scale: FLOW_MIN_SCALE });
// ⚠️ 값 단언에는 옵셔널 체이닝 필수 — 구현이 null 을 돌려주면 TypeError 로 **스크립트가 죽고**
//    그때는 exit!=0 이라 변이 테스트에서 모든 변이가 '검출'로 위장된다.
ok('#39d 좌표 폭주는 잘라낸다(복원 시 아무것도 안 보이는 화면 방지)',
  normalizeFlowViewport({ x: 1e12, y: -1e12, scale: 1 })?.x === VIEWPORT_XY_LIMIT);
ok('#40 sameFlowViewport — 없음/없음은 같다', sameFlowViewport(null, undefined) === true);
ok('#40b 없음/있음은 다르다', sameFlowViewport(null, { x: 0, y: 0, scale: 1 }) === false);
ok('#40c 값이 하나라도 다르면 다르다',
  sameFlowViewport({ x: 1, y: 2, scale: 1 }, { x: 1, y: 2, scale: 1 }) === true &&
  sameFlowViewport({ x: 1, y: 2, scale: 1 }, { x: 1, y: 2, scale: 1.1 }) === false);
{
  // ⚠️ '맞춤' 버튼과 '저장된 위치가 없는 구버전 맵의 첫 화면'이 이 함수를 공유한다.
  deep('#41 도형이 없으면 기본 화면', fitFlowViewport([], 1140, 760), DEFAULT_FLOW_VIEWPORT);
  deep('#41b 비배열도 기본 화면(throw 금지)', fitFlowViewport(null, 1140, 760), DEFAULT_FLOW_VIEWPORT);
  const far = [mkNode({ id: 'a', x: 2000, y: 1500, w: 180, h: 120 })];
  const vp = fitFlowViewport(far, 1140, 760);
  ok('#41c 멀리 떨어진 도형도 화면 안으로 들어온다', vp.x + 2000 * vp.scale >= 0 && vp.y + 1500 * vp.scale >= 0);
  ok('#41d 배율은 유효 범위', vp.scale >= FLOW_MIN_SCALE && vp.scale <= 1.5);
  const wide = [mkNode({ id: 'a', x: 0, y: 0, w: 100, h: 100 }), mkNode({ id: 'b', x: 4000, y: 0, w: 100, h: 100 })];
  ok('#41e 아주 넓은 흐름도는 축소된다', fitFlowViewport(wide, 1140, 760).scale < 1);
}

console.log('\n■ 팬/줌 영속화 — 화이트리스트 재구축기가 삼키지 않는가 (⚠️ 최대 회귀 지점)');
{
  // ⚠️ normalizeFlowMaps 는 필드를 손나열해 재구축한다. viewport 를 빠뜨리면 별도 창 저장 경로
  //    (flow:maps → normalizeFlowMaps)와 Drive 로드에서 마지막 화면이 매번 조용히 삭제된다.
  const src = [cleanMap({ nodes: [mkNode({ id: 'n1', label: 'A' })], edges: [], viewport: { x: 12, y: 34, scale: 1.25 } })];
  src[0].nodes[0].label = 'A';
  const r = normalizeFlowMaps([{ ...src[0], name: '' }]);   // name 손상 → mapChanged 경로 강제
  deep('#42 재구축 경로에서도 viewport 가 보존된다', r[0].viewport, { x: 12, y: 34, scale: 1.25 });
}
{
  const src = [cleanMap({ viewport: { x: 12, y: 34, scale: 1.25 } })];
  ok('#42b 정규형이면 원본 참조 그대로(폴링마다 재저장 방지)', normalizeFlowMaps(src) === src);
}
{
  // ⚠️ 레거시(viewport 없음)를 '변경됨'으로 만들면 로드마다 새 객체 → 폴링마다 재저장 +
  //    보드 로컬 사본이 갈아엎어져 2.5초 승격 전 편집이 사라진다.
  const src = [cleanMap()];
  ok('#42c viewport 가 없어도 변경으로 보지 않는다', normalizeFlowMaps(src) === src);
  ok('#42d viewport: null 도 변경으로 보지 않는다', normalizeFlowMaps([cleanMap({ viewport: null })])[0].viewport == null);
}
{
  const r = normalizeFlowMaps([cleanMap({ viewport: { x: 1.7, y: 2, scale: 9 } })]);
  deep('#42e 손상된 viewport 는 교정되어 저장된다', r[0].viewport, { x: 2, y: 2, scale: FLOW_MAX_SCALE });
  ok('#42f 교정은 곧 변경이다(원본 참조 아님)', normalizeFlowMaps([cleanMap({ viewport: { x: 1.7, y: 2, scale: 9 } })])[0].viewport?.scale === FLOW_MAX_SCALE);
}
{
  const r = normalizeFlowMaps([cleanMap({ viewport: { x: 'a', y: 0, scale: 1 } })]);
  ok('#42g 유효하지 않은 viewport 는 통째로 버린다(기본 화면으로 폴백)', r[0].viewport === undefined);
}
{
  // ⚠️ 지문 누락 = portfolioUpdatedAt 미상승 = STATE 저장 통째 스킵(이 저장소 5회 재발한 버그 클래스)
  const a = [cleanMap({ viewport: { x: 0, y: 0, scale: 1 } })];
  const b = [cleanMap({ viewport: { x: 400, y: 120, scale: 1 } })];
  ok('#43 화면 위치만 바뀌어도 지문이 달라진다', flowFingerprint(a) !== flowFingerprint(b));
  ok('#43b 배율만 바뀌어도 감지', flowFingerprint(a) !== flowFingerprint([cleanMap({ viewport: { x: 0, y: 0, scale: 1.5 } })]));
  ok('#43c 저장된 위치 없음 ⟷ 있음도 구분', flowFingerprint([cleanMap()]) !== flowFingerprint(a));
}
{
  // removeNode/pruneOrphanEdges 는 스프레드라 viewport 를 보존해야 한다
  const m = cleanMap({ viewport: { x: 5, y: 6, scale: 1 } });
  deep('#44 노드 삭제가 화면 위치를 지우지 않는다', removeNode(m, 'n1').viewport, { x: 5, y: 6, scale: 1 });
  deep('#44b 고아 엣지 정리도 마찬가지', pruneOrphanEdges(cleanMap({ nodes: [mkNode({ id: 'n1' })], viewport: { x: 5, y: 6, scale: 1 } })).viewport, { x: 5, y: 6, scale: 1 });
}

console.log('\n■ 색상 — 연결선/도형 사용자 지정 (sanitizeHexColor · readableTextColor)');
eq('#45 6자리 hex 는 그대로', sanitizeHexColor('#C00000'), '#C00000');
eq('#45b 3자리 hex 는 확장', sanitizeHexColor('#abc'), '#aabbcc');
eq('#45c 공백은 다듬는다', sanitizeHexColor('  #FF0000 '), '#FF0000');
ok('#45d 이름/함수형/손상값은 거부(SVG 에 이상한 값이 새는 것 방지)',
  sanitizeHexColor('red') === '' && sanitizeHexColor('rgb(1,2,3)') === '' &&
  sanitizeHexColor('#12345') === '' && sanitizeHexColor(42) === '' && sanitizeHexColor(null) === '');
// ⚠️ 대소문자를 바꾸면 저장돼 있던 '#2E75B6' 이 전부 '변경됨'이 되어 원본 참조 보존 계약이 깨진다
eq('#45e 대소문자를 바꾸지 않는다', sanitizeHexColor('#2E75B6'), '#2E75B6');
{
  // ⚠️ 문턱은 **기존 8색이 전부 흰 글자를 유지**하도록 잡았다 — 낮추면 사용자가 이미 칠해 둔
  //    도형의 글자색이 배포만으로 뒤바뀐다.
  const legacy = ['#2E75B6', '#ED7D31', '#70AD47', '#A5A5A5', '#7C3AED', '#DC2626', '#0F766E', '#334155'];
  ok('#46 기존 8색은 전부 흰 글자 유지', legacy.every(c => readableTextColor(c) === '#ffffff'));
  ok('#46b 흰색·옅은 노랑에서는 어두운 글자',
    readableTextColor('#FFFFFF') === '#111827' && readableTextColor('#FFFF00') === '#111827');
  ok('#46c 검정·진한 색은 흰 글자',
    readableTextColor('#000000') === '#ffffff' && readableTextColor('#002060') === '#ffffff');
  ok('#46d 색이 없으면 흰 글자(기본 채우기가 진한 파랑)', readableTextColor(undefined) === '#ffffff');
}
{
  const r = normalizeFlowMaps([cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', stroke: '#C00000' }] })]);
  eq('#47 연결선 색은 보존된다', r[0].edges[0].stroke, '#C00000');
  const bad = normalizeFlowMaps([cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', stroke: 'red' }] })]);
  ok('#47b 손상된 선 색은 버려지고(기본색 사용) 변경으로 표시된다', bad[0].edges[0].stroke === undefined);
  const node = mkNode({ id: 'n', fill: 'rgb(1,2,3)' });
  ok('#47c 도형 채우기도 같은 규칙', node.fill === undefined);
  eq('#47d 유효한 채우기는 보존', mkNode({ id: 'n', fill: '#FFC000' }).fill, '#FFC000');
}
{
  // ⚠️ 색만 바꾼 세션도 저장되어야 한다
  const a = [cleanMap()];
  const b = [cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', stroke: '#FF0000' }] })];
  ok('#48 연결선 색 변경을 지문이 감지', flowFingerprint(a) !== flowFingerprint(b));
  const c = [cleanMap({ nodes: [mkNode({ id: 'n1', fill: '#FF0000' }), mkNode({ id: 'n2' })] })];
  ok('#48b 도형 채우기 변경을 지문이 감지', flowFingerprint(a) !== flowFingerprint(c));
}

console.log('\n■ 화살촉 방향 — 자금 흐름 방향을 사용자가 고른다 (normalizeFlowArrow · arrowHeads)');
eq('#58 시작 쪽 화살촉을 저장할 수 있다', normalizeFlowArrow('from'), 'from');
ok('#58b 알 수 없는 값·미설정은 종전 기본값(끝)으로', normalizeFlowArrow(undefined) === 'to' && normalizeFlowArrow('zzz') === 'to' && normalizeFlowArrow(null) === 'to');
ok('#58c 기존 3값은 그대로', normalizeFlowArrow('to') === 'to' && normalizeFlowArrow('both') === 'both' && normalizeFlowArrow('none') === 'none');
deep('#59 끝(to) — markerEnd 만', arrowHeads('to'), { start: false, end: true });
deep('#59b 시작(from) — markerStart 만', arrowHeads('from'), { start: true, end: false });
deep('#59c 양쪽', arrowHeads('both'), { start: true, end: true });
deep('#59d 없음', arrowHeads('none'), { start: false, end: false });
// ⚠️ 레거시 선(arrow 미설정)의 렌더가 바뀌면 기존 흐름도의 화살표가 통째로 사라진다
deep('#59e arrow 미설정 레거시는 종전대로 끝에만', arrowHeads(undefined), { start: false, end: true });
{
  // ⚠️ 최대 회귀 지점 — normalizeFlowMaps 는 화이트리스트 재구축기다. 'from' 을 빠뜨리면
  //    사용자가 고른 방향이 Drive 로드·별도 창 저장 왕복마다 'to' 로 되돌아간다.
  const withFrom = cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'from' }] });
  eq('#60 저장된 시작 화살촉이 정규화를 통과한다', normalizeFlowMaps([withFrom])[0].edges[0].arrow, 'from');
  const src = [withFrom];
  ok('#60b 정규형이면 원본 배열 참조 그대로(폴링마다 재저장 방지)', normalizeFlowMaps(src) === src);
  ok('#60c 맵 객체도 동일 참조', normalizeFlowMaps(src)[0] === src[0]);
  const bad = normalizeFlowMaps([cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'sideways' }] })]);
  eq('#60d 손상된 방향 값은 기본값으로 교정', bad[0].edges[0].arrow, 'to');
}
{
  // ⚠️ 지문 누락 = portfolioUpdatedAt 미상승 = STATE 저장 통째 스킵
  const a = [cleanMap()];
  const b = [cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'from' }] })];
  ok('#61 방향만 바꾼 세션도 지문이 감지', flowFingerprint(a) !== flowFingerprint(b));
}
{
  // 화면 안내 문구가 캔버스와 갈리지 않는지 — FlowInspector.arrowFlowText 의 파생 규칙 미러
  const flowText = (arrow, ends) => {
    const h = arrowHeads(arrow);
    const x = ends?.from || '시작 도형';
    const y = ends?.to || '끝 도형';
    if (h.start && h.end) return `양방향 — ${x} ↔ ${y}`;
    if (!h.start && !h.end) return `방향 표시 없음 — ${x} · ${y}`;
    return h.end ? `자금 흐름: ${x} → ${y}` : `자금 흐름: ${y} → ${x}`;
  };
  const ends = { from: 'CMA 2', to: 'COVERD 4' };
  eq('#62 끝 화살촉이면 그은 방향대로 설명', flowText('to', ends), '자금 흐름: CMA 2 → COVERD 4');
  eq('#62b 시작 화살촉이면 **반대로** 설명(이 기능의 요점)', flowText('from', ends), '자금 흐름: COVERD 4 → CMA 2');
  eq('#62c 양쪽', flowText('both', ends), '양방향 — CMA 2 ↔ COVERD 4');
  eq('#62d 이름을 못 구해도 문장이 성립', flowText('to', null), '자금 흐름: 시작 도형 → 끝 도형');
}

console.log('\n■ 선 종류 — 레거시 dashed 이관 · 렌더 판정 (resolveFlowLineStyle · flowLineRender)');
{
  // ⚠️ 이 기능의 최대 위험: 기존 사용자가 점선으로 그려 둔 선이 배포만으로 실선이 되는 것.
  eq('#67 레거시 dashed:true → 파선', resolveFlowLineStyle(undefined, true), 'dash');
  eq('#67b 레거시 dashed:false → 실선', resolveFlowLineStyle(undefined, false), 'solid');
  eq('#67c 새 값이 있으면 레거시보다 우선', resolveFlowLineStyle('dot', true), 'dot');
  eq('#67d 알 수 없는 값은 레거시로 폴백', resolveFlowLineStyle('zigzag', true), 'dash');
  eq('#67e 둘 다 없으면 실선', resolveFlowLineStyle(undefined, undefined), 'solid');
  ok('#67f 7종이 전부 통과', FLOW_LINE_STYLES.every(k => resolveFlowLineStyle(k) === k));
}
{
  // ⚠️ 종전 렌더와 픽셀 동일해야 한다 — 이 두 값이 바뀌면 기존 흐름도의 모양이 배포만으로 달라진다.
  const legacyDash = flowLineRender({ dashed: true });
  eq('#68 레거시 점선의 dasharray가 종전과 동일', legacyDash.dash, '6 4');
  eq('#68b 레거시 점선의 굵기가 종전과 동일', legacyDash.width, 2);
  const legacySolid = flowLineRender({ dashed: false });
  eq('#68c 레거시 실선은 dasharray 없음', legacySolid.dash, undefined);
  eq('#68d 레거시 실선 굵기도 종전과 동일', legacySolid.width, 2);
  eq('#68e 값이 아예 없는 선도 실선 2px', flowLineRender({}).width, 2);
  eq('#68f null 입력도 던지지 않는다', flowLineRender(null).width, 2);
}
{
  // 패턴은 굵기 배수 — 굵은 선에서 점선이 뭉개지지 않는다
  eq('#69 얇게 파선', flowLineRender({ lineStyle: 'dash', lineWidth: 'thin' }).dash, '3.6 2.4');
  eq('#69b 굵게 파선', flowLineRender({ lineStyle: 'dash', lineWidth: 'thick' }).dash, '10.5 7');
  eq('#69c 일점쇄선은 4구간', flowLineRender({ lineStyle: 'dashDot' }).dash, '10 4 2 4');
  eq('#69d 이점쇄선은 6구간', flowLineRender({ lineStyle: 'dashDotDot' }).dash, '10 4 2 4 2 4');
  eq('#69e 점선', flowLineRender({ lineStyle: 'dot' }).dash, '2 6');
  eq('#69f 긴 파선', flowLineRender({ lineStyle: 'longDash' }).dash, '14 6');
  eq('#69g 굵기 이름이 손상되면 보통으로', flowLineRender({ lineWidth: 'huge' }).width, 2);
  ok('#69h 굵기 3종이 서로 다르다',
    new Set(FLOW_LINE_WIDTHS.map(w => flowLineRender({ lineWidth: w }).width)).size === 3);
}
{
  // 이중선 = 굵은 선 위에 배경색 선을 덮어 가운데를 비운다
  const d = flowLineRender({ lineStyle: 'double' });
  ok('#70 이중선 플래그', d.double === true);
  eq('#70b 바깥 굵기는 3배', d.width, 6);
  eq('#70c 안쪽(배경색) 굵기는 원래 굵기', d.innerWidth, 2);
  eq('#70d 이중선에는 dasharray 없음', d.dash, undefined);
  ok('#70e 다른 종류는 double=false', FLOW_LINE_STYLES.filter(k => k !== 'double').every(k => !flowLineRender({ lineStyle: k }).double));
}
{
  // ⚠️ 화이트리스트 재구축기 — 새 필드를 등록하지 않으면 Drive 로드·별도 창 저장마다 사라진다
  const styled = cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', lineStyle: 'dashDot', lineWidth: 'thick' }] });
  const r = normalizeFlowMaps([styled]);
  eq('#71 선 종류가 정규화를 통과한다', r[0].edges[0].lineStyle, 'dashDot');
  eq('#71b 선 굵기도 통과', r[0].edges[0].lineWidth, 'thick');
  const src = [styled];
  ok('#71c 정규형이면 원본 배열 참조 그대로', normalizeFlowMaps(src) === src);
  ok('#71d 맵 객체도 동일 참조', normalizeFlowMaps(src)[0] === src[0]);
}
{
  // ⚠️ 기본값(실선/보통)은 저장하지 않는다 — 저장하면 기존 선이 전부 '변경됨'이 되어
  //    폴링마다 재저장 + 보드 로컬 사본이 갈아엎어진다.
  const plain = cleanMap();
  const r = normalizeFlowMaps([plain]);
  ok('#72 기본값은 필드를 만들지 않는다', r[0].edges[0].lineStyle === undefined && r[0].edges[0].lineWidth === undefined);
  ok('#72b 그래서 원본 참조가 보존된다', normalizeFlowMaps([plain])[0] === plain);
  const explicitDefault = cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', lineStyle: 'solid', lineWidth: 'normal' }] });
  ok('#72c 명시된 기본값은 지워서 정규형으로 수렴', normalizeFlowMaps([explicitDefault])[0].edges[0].lineStyle === undefined);
  const badStyle = normalizeFlowMaps([cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', lineStyle: 'zigzag' }] })]);
  ok('#72d 손상된 종류는 실선으로 교정', badStyle[0].edges[0].lineStyle === undefined);
}
{
  // 레거시 이관 — 로드 1회로 dashed 가 사라지고 lineStyle 로 바뀐다(백업 복원 경로도 같은 함수)
  const legacy = cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', dashed: true }] });
  const r = normalizeFlowMaps([legacy]);
  eq('#73 dashed:true 가 파선으로 이관', r[0].edges[0].lineStyle, 'dash');
  ok('#73b 레거시 필드는 제거된다(두 소스 공존 금지)', !('dashed' in r[0].edges[0]));
  ok('#73c 이관은 1회로 수렴(두 번째 정규화는 원본 참조)', normalizeFlowMaps(r) === r);
  const legacyFalse = normalizeFlowMaps([cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', dashed: false }] })]);
  ok('#73d dashed:false 도 필드를 남기지 않는다',
    legacyFalse[0].edges[0].lineStyle === undefined && !('dashed' in legacyFalse[0].edges[0]));
}
{
  // ⚠️ 지문이 raw dashed 를 담으면 **이관만으로 저장이 트리거**된다(사용자는 아무것도 안 고쳤다).
  const legacy = [cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', dashed: true }] })];
  const migrated = [cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', lineStyle: 'dash' }] })];
  eq('#74 레거시와 이관본의 지문이 같다', flowFingerprint(legacy), flowFingerprint(migrated));
  const a = [cleanMap()];
  ok('#74b 선 종류를 바꾸면 지문이 달라진다', flowFingerprint(a) !== flowFingerprint(migrated));
  const thick = [cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', lineWidth: 'thick' }] })];
  ok('#74c 굵기만 바꿔도 지문이 달라진다(저장 스킵 방지)', flowFingerprint(a) !== flowFingerprint(thick));
}

console.log('\n■ 시트(맵) 단위 조작 — 엑셀 시트식 다중 흐름도');
{
  const one = [cleanMap({ id: 'm1', name: '시트 1' })];
  const added = addFlowMap(one);
  eq('#80 시트 추가 — 뒤에 붙는다', added.length, 2);
  eq('#80b 새 시트 이름은 안 쓰는 가장 작은 번호', added[1].name, '시트 2');
  ok('#80c 새 시트는 빈 캔버스', added[1].nodes.length === 0 && added[1].edges.length === 0);
  ok('#80d 기존 시트는 같은 참조(불필요한 저장·재렌더 방지)', added[0] === one[0]);
  eq('#80e 이름을 직접 주면 그대로', addFlowMap(one, '2026 자금계획')[1].name, '2026 자금계획');
  eq('#80f 긴 이름은 상한에서 자른다', addFlowMap(one, 'x'.repeat(200))[1].name.length, MAX_FLOW_MAP_NAME);
  const full = Array.from({ length: MAX_FLOW_MAPS }, (_, i) => cleanMap({ id: `m${i}`, name: `s${i}` }));
  ok('#81 상한을 넘기면 원본 참조(호출부가 안내 문구를 띄운다)', addFlowMap(full) === full);
  ok('#81b 비배열 입력에도 throw하지 않는다', Array.isArray(addFlowMap(null)) && addFlowMap(null).length === 1);
}
{
  // ⚠️ 이 기능 최대의 조용한 유실 지점 — 사본의 엣지가 **원본 노드 id**를 가리키면
  //    normalizeFlowMaps의 고아 제거가 다음 로드에서 사본의 연결선을 전부 지운다.
  const src = [cleanMap({ id: 'm1', name: '계획 A' })];
  const dup = duplicateFlowMap(src, 'm1');
  eq('#82 복제 — 원본 바로 뒤에 꽂는다', dup.length, 2);
  eq('#82b 사본 이름', dup[1].name, '계획 A 복사');
  ok('#82c 사본은 새 맵 id', dup[1].id !== 'm1');
  ok('#82d 노드 id가 전부 새로 만들어진다',
    dup[1].nodes.every(n => !src[0].nodes.some(o => o.id === n.id)) && dup[1].nodes.length === 2);
  {
    const ids = new Set(dup[1].nodes.map(n => n.id));
    ok('#82e ⚠️ 엣지 from/to가 사본 노드로 다시 이어진다(고아 제거로 선이 사라지지 않는다)',
      dup[1].edges.length === 1 && ids.has(dup[1].edges[0].from) && ids.has(dup[1].edges[0].to));
    // 실제 정규화를 통과시켜 '다음 로드에서 살아남는가'를 값으로 고정한다.
    const loaded = normalizeFlowMaps(dup);
    eq('#82f 정규화를 통과해도 사본의 연결선이 남는다', loaded[1].edges.length, 1);
  }
  ok('#82g 원본 시트는 손대지 않는다(같은 참조)', dup[0] === src[0]);
  ok('#82h 사본은 마지막 화면(viewport)을 물려받는다',
    JSON.stringify(duplicateFlowMap([cleanMap({ id: 'm1', viewport: { x: 5, y: 6, scale: 1.5 } })], 'm1')[1].viewport)
    === JSON.stringify({ x: 5, y: 6, scale: 1.5 }));
  ok('#82i 없는 시트를 복제하면 원본 참조', duplicateFlowMap(src, 'nope') === src);
  {
    // 원본이 이미 고아 엣지를 들고 있으면 사본에는 만들지 않는다(정규화 결과와 미리 일치).
    const orphan = [cleanMap({ id: 'm1', edges: [{ id: 'e1', from: 'n1', to: 'ghost', label: '', arrow: 'to' }] })];
    eq('#82j 원본의 고아 엣지는 사본에 복제하지 않는다', duplicateFlowMap(orphan, 'm1')[1].edges.length, 0);
  }
  {
    const two = [cleanMap({ id: 'm1', name: '계획 A' }), cleanMap({ id: 'm2', name: '계획 A 복사' })];
    eq('#82k 이름이 겹치면 번호를 붙인다', duplicateFlowMap(two, 'm1')[1].name, '계획 A 복사 2');
  }
}
{
  const two = [cleanMap({ id: 'm1' }), cleanMap({ id: 'm2' })];
  eq('#83 시트 삭제', removeFlowMap(two, 'm1').length, 1);
  eq('#83b 남은 시트는 그대로', removeFlowMap(two, 'm1')[0].id, 'm2');
  // ⚠️ 0장이 되면 보드 시드가 빈 맵을 새로 만들어 '지웠는데 초기화된 시트가 남는' 혼란이 된다.
  const one = [cleanMap({ id: 'm1' })];
  ok('#83c 마지막 한 장은 지우지 않는다(원본 참조)', removeFlowMap(one, 'm1') === one);
  ok('#83d 없는 id면 원본 참조', removeFlowMap(two, 'nope') === two);
}
{
  const two = [cleanMap({ id: 'm1', name: 'A' }), cleanMap({ id: 'm2', name: 'B' })];
  eq('#84 이름 변경', renameFlowMap(two, 'm1', '2026 계획')[0].name, '2026 계획');
  eq('#84b 앞뒤 공백 제거', renameFlowMap(two, 'm1', '  X  ')[0].name, 'X');
  eq('#84c 상한에서 자른다', renameFlowMap(two, 'm1', 'y'.repeat(120))[0].name.length, MAX_FLOW_MAP_NAME);
  // ⚠️ 이름 없는 탭은 고를 수가 없다 → 빈 이름은 거부하고 원래 이름을 유지한다.
  ok('#84d 빈 이름은 거부(원본 참조)', renameFlowMap(two, 'm1', '   ') === two);
  ok('#84e 같은 이름이면 원본 참조(헛된 저장 방지)', renameFlowMap(two, 'm1', 'A') === two);
  ok('#84f 다른 시트는 같은 참조', renameFlowMap(two, 'm1', 'Z')[1] === two[1]);
  ok('#84g 없는 id면 원본 참조', renameFlowMap(two, 'nope', 'Z') === two);
}
{
  const three = [cleanMap({ id: 'm1' }), cleanMap({ id: 'm2' }), cleanMap({ id: 'm3' })];
  deep('#85 오른쪽 이동', moveFlowMap(three, 'm1', 1).map(m => m.id), ['m2', 'm1', 'm3']);
  deep('#85b 왼쪽 이동', moveFlowMap(three, 'm3', -1).map(m => m.id), ['m1', 'm3', 'm2']);
  ok('#85c 왼쪽 끝에서 더 밀면 원본 참조', moveFlowMap(three, 'm1', -1) === three);
  ok('#85d 오른쪽 끝에서 더 밀면 원본 참조', moveFlowMap(three, 'm3', 1) === three);
  ok('#85e delta 0 은 no-op', moveFlowMap(three, 'm2', 0) === three);
  ok('#85f 없는 id면 원본 참조', moveFlowMap(three, 'nope', 1) === three);
  // ⚠️ 순서는 배열 순서가 곧 저장값이다(`order` 필드 금지) → 지문이 순서 변경을 잡아야 한다.
  ok('#85g 순서만 바꿔도 지문이 달라진다(저장 스킵 방지)',
    flowFingerprint(three) !== flowFingerprint(moveFlowMap(three, 'm1', 1)));
}
{
  // 여러 시트가 각자 자기 팬/줌을 들고 있어야 한다(시트 전환이 남의 화면을 덮지 않는 근거).
  const two = normalizeFlowMaps([
    cleanMap({ id: 'm1', viewport: { x: 10, y: 20, scale: 1 } }),
    cleanMap({ id: 'm2', viewport: { x: -300, y: 40, scale: 0.5 } }),
  ]);
  eq('#86 시트마다 자기 viewport 를 보존한다', two[1].viewport.x, -300);
  ok('#86b 다중 시트도 정규화가 원본 참조를 보존', normalizeFlowMaps(two) === two);
  ok('#86c 내용이 뒤쪽 시트에만 있어도 sticky 복원 대상',
    flowMapsHaveContent([{ id: 'a', nodes: [], edges: [] }, cleanMap({ id: 'b' })]) === true);
}

// ───────── 파트② 소스 텍스트 가드 ─────────
// ⚠️ 실패하면 먼저 '정규식이 낡았는지' 확인할 것. 계약이 바뀐 게 아니면 정규식을 고친다.

console.log('\n■ 소스 텍스트 가드 — 영속화 배선 (미러로 표현 불가한 호출부 계약)');
const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
const sync = readFileSync(join(ROOT, 'src/hooks/useDriveSync.ts'), 'utf8');
const mod = readFileSync(join(ROOT, 'src/flowMap.ts'), 'utf8');

ok('#27 App.tsx: flowMaps state 선언', /const\s*\[\s*flowMaps\s*,\s*setFlowMaps\s*\]\s*=\s*useState/.test(app));
// ⚠️ 지문 누락 = portfolioUpdatedAt 미상승 = STATE 저장 통째 스킵. 이 저장소에서 5회 재발한 버그 클래스.
ok('#28 App.tsx: portfolioStructureKey 지문에 flowFingerprint(flowMaps)', /flowFingerprint\(\s*flowMaps\s*\)/.test(app));
// ⚠️ 종료 커밋의 값 소스는 FlowBoard 의 localRef 다(flowFlushRef 경유). App 레벨 미러(flowMapsRef)를
//    두면 로드 경로와 동기화할 의무만 생기고 실제로 읽히지 않아 잘못된 안전감을 준다 → 두지 않는다.
ok('#29 App.tsx: flushFlowSnapshot 이 flowFlushRef 로 미승격 편집을 회수', /flowFlushRef\.current\s*\?\.\s*\(\s*\)/.test(app));
ok('#29b App.tsx: 죽은 App 레벨 미러(flowMapsRef)를 되살리지 않았다', !/flowMapsRef\.current\s*=/.test(app));
ok('#30 App.tsx: applyStateData 에서 normalizeFlowMaps 로 로드', /stateData\.flowMaps/.test(app) && /normalizeFlowMaps\(/.test(app));
// ⚠️ 리터럴에만 쓰고 로드하지 않으면 매 저장이 빈 배열로 Drive 를 덮는 '영구 파괴'가 된다.
ok('#31 App.tsx: 저장 payload 리터럴에 flowMaps 포함', /calendarMemos\s*,\s*watchlistGroups\s*,\s*flowMaps\s*,/.test(app));
// ⚠️ flowMaps 를 deps 배열의 **마지막 항목**으로 고정하지 말 것 — 뒤에 새 항목(backtestScenarios 등)이
//    추가되면 계약은 멀쩡한데 이 단언만 깨진다. 존재 + 인접만 본다.
ok('#32 App.tsx: 저장 effect deps 에 flowMaps', /watchlistGroups\s*,\s*flowMaps\s*[,\]]/.test(app));
// ⚠️ sticky 판정을 손으로 복제하면 in-memory 와 Drive write 가 갈린다 → 반드시 공유 함수.
ok('#33 App.tsx: applyBackupData sticky 가 flowMapsHaveContent 공유', /flowMapsHaveContent\(/.test(app));
ok('#34 useDriveSync.ts: _preserveStickyPersonalData 가 flowMaps 를 다룬다', /flowMaps/.test(sync) && /flowMapsHaveContent/.test(sync));
ok('#35 flowMap.ts: @ts-nocheck 금지(이 파일의 타입이 유일한 안전망)', !/^\s*\/\/\s*@ts-nocheck/m.test(mod));
// ⚠️ '_' 접두 런타임 필드를 두면 순환 참조로 지문이 죽는다 → 타입에 없어야 한다.
ok('#36 flowMap.ts: FlowNode/FlowEdge 에 _ 접두 필드 없음', !/^\s+_[A-Za-z]\w*\s*[?:]/m.test(mod));

console.log('\n■ 소스 텍스트 가드 — 팬/줌 저장 배선 (⚠️ 선언이 아니라 사용부를 단언한다)');
const board = readFileSync(join(ROOT, 'src/components/FlowBoard.tsx'), 'utf8');
const canvas = readFileSync(join(ROOT, 'src/components/FlowCanvas.tsx'), 'utf8');
const inspector = readFileSync(join(ROOT, 'src/components/FlowInspector.tsx'), 'utf8');
// ⚠️ 금지 토큰 부재를 잴 때는 반드시 주석을 걷어낸다 — 이 저장소는 금지 이유를 바로 그 자리
//    주석에 적으므로 원문으로 재면 그 설명에 걸려 가드가 영구히 실패한다.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const boardNC = stripComments(board);
const canvasNC = stripComments(canvas);
const inspNC = stripComments(inspector);
const sliceBetween = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? '' : s.slice(i, j);
};

// 연결선 렌더의 두 분기(이중선 / 일반선) — 여러 가드가 공유한다.
// ⚠️ 파일 전역으로 재지 말 것: 같은 문자열이 두 분기에 있어서 **한쪽만 되돌리는 변이가 그대로
//    통과한다**. 실측으로 죽은 단언 3건을 이렇게 잡았다(일반선 굵기 고정 · 바깥 path 에 화살촉
//    추가 · markerStart 제거).
// ⚠️ 끝 앵커로 JSX 주석을 쓰지 말 것 — stripComments 가 지워 구간을 못 찾고 가드가 통째로 실패한다.
const edgeTernary = sliceBetween(canvasNC, 'line.double ? (', 'stroke="transparent"');
const [doubleBranch = '', singleBranch = ''] = edgeTernary.split(') : (');

// 보드를 열 때 저장된 화면으로 복원하는 것이 이 기능의 전부다.
ok('#49 FlowBoard: 보드를 열 때 저장된 화면을 복원', /setViewport\(\s*initialViewportOf\(\s*seeded\[0\]\s*\)\s*\)/.test(boardNC));
// ⚠️ 다중 시트가 되면서 대상이 maps[0]이 아니라 **활성 시트**다(사용자가 시트를 바꾼 뒤 늦은
//    데이터가 도착하면 그 시트의 화면을 복원해야 한다).
ok('#49b FlowBoard: 늦게 도착한 Drive 데이터의 저장 위치도 채택(단, 사용자가 안 움직였을 때만)',
  /if\s*\(\s*!vpTouchedRef\.current\s*\)\s*setViewport\(\s*initialViewportOf\(\s*findMap\(maps, activeIdRef\.current\)\s*\|\|\s*maps\[0\]\s*\)\s*\)/.test(boardNC));
// ⚠️ 복원·자동 맞춤에 applyViewport(=touched)를 쓰면 '보드를 열기만 해도 Drive 저장'이 된다.
{
  const seed = sliceBetween(boardNC, 'const seeded = Array.isArray(maps)', 'const dang = countDanglingNodes');
  ok('#49c FlowBoard: 복원은 applyViewport(사용자 제스처 경로)를 쓰지 않는다',
    seed.includes('setViewport(initialViewportOf(') && !seed.includes('applyViewport('));
}
{
  // ⚠️ 최대 회귀 지점 — viewportOnly가 dirtyRef를 세우면, 로딩 중 보드를 열고 화면만 훑어도
  //    '늦게 도착한 Drive 데이터 채택'이 막혀 시드된 빈 맵이 저장본을 덮는다(복구 불가).
  const cm = sliceBetween(boardNC, 'const commit = useCallback((updater, opts)', 'setMapsLocal(next);');
  ok('#50 FlowBoard: viewportOnly 커밋은 vpDirtyRef만 세운다',
    /opts\.viewportOnly\)\s*vpDirtyRef\.current\s*=\s*true;/.test(cm) && /else\s+dirtyRef\.current\s*=\s*true;/.test(cm));
}
{
  const adopt = sliceBetween(boardNC, 'if (!open || dirtyRef.current) return;', '}, [open, maps]);');
  ok('#50b FlowBoard: 늦게 도착한 데이터 채택 가드는 여전히 dirtyRef만 본다(vpDirtyRef를 넣지 말 것)',
    adopt.length > 0 && !adopt.includes('vpDirtyRef'));
}
{
  const fl = sliceBetween(boardNC, 'const flush = useCallback(() => {', '}, []);');
  const iCommit = fl.indexOf('commitViewportRef.current?.()');
  const iCheck = fl.indexOf('if (!dirtyRef.current');
  ok('#51 FlowBoard: flush가 dirty 판정 **전에** 현재 화면을 반영(닫는 순간의 위치가 남는다)',
    iCommit >= 0 && iCheck > iCommit);
  ok('#51b FlowBoard: 화면 위치만 바뀐 세션도 flush가 회수한다',
    /if\s*\(\s*!dirtyRef\.current\s*&&\s*!vpDirtyRef\.current\s*\)\s*return null;/.test(fl));
}
ok('#52 FlowBoard: 사용자가 실제로 움직였을 때만 커밋(복원·자동맞춤은 저장하지 않는다)',
  /if\s*\(\s*readOnlyRef\.current\s*\|\|\s*!vpTouchedRef\.current\s*\)\s*return;/.test(boardNC));
ok('#52b FlowBoard: 커밋값은 정규화를 거친다(부동소수 노이즈가 지문에 새는 것 방지)',
  /normalizeFlowViewport\(\s*viewportRef\.current\s*\)/.test(boardNC));
ok('#52c FlowBoard: 같은 화면이면 원본 참조 반환(헛된 저장 방지)',
  /sameFlowViewport\(\s*cur\.viewport\s*,\s*vp\s*\)\s*\)\s*return prev;/.test(boardNC));
ok('#52d FlowBoard: 언마운트에서도 미승격 화면을 회수',
  /vpDirtyRef\.current\s*\)\s*return;[\s\S]{0,120}onUpdateRef\.current\?\.\(\(\) => pending\)/.test(boardNC));
// ⚠️ '맞춤' 버튼과 첫 화면이 같은 함수를 써야 같은 데이터가 두 화면을 주지 않는다.
ok('#53 FlowBoard: 맞춤 버튼이 fitFlowViewport 공유', /applyViewport\(\s*fitFlowViewport\(/.test(boardNC));
ok('#53b FlowBoard: 맞춤 손계산(Math.min(...xe) 류)을 되살리지 않았다', !/Math\.max\(\s*\.\.\.\s*xe/.test(boardNC));
ok('#53c FlowBoard: 100% 버튼이 공유 기본값 사용', /applyViewport\(\s*\{\s*\.\.\.DEFAULT_FLOW_VIEWPORT\s*\}\s*\)/.test(boardNC));
ok('#53d FlowBoard: 캔버스에 사용자 제스처 경로를 넘긴다', /onViewportChange=\{applyViewport\}/.test(boardNC));

console.log('\n■ 소스 텍스트 가드 — 연결선/도형 색 (사용자 지정)');
// ⚠️ marker의 fill은 참조 요소의 stroke를 물려받지 않는다 → 색깔마다 marker가 필요하다.
ok('#54 FlowCanvas: 화살촉 marker를 색깔마다 만든다', /arrowColors\.map\(c => \(\s*<marker key=\{c\} id=\{markerIdOf\(c\)\}/.test(canvasNC));
ok('#54b FlowCanvas: 단일 하드코딩 marker(url(#flowArrow))로 되돌리지 않았다', !/url\(#flowArrow\)/.test(canvasNC));
ok('#54c FlowCanvas: 기본색을 marker 집합에 반드시 포함(기본색 선의 화살촉 소실 방지)',
  /new Set\(\[\s*DEFAULT_EDGE_STROKE\s*\]\)/.test(canvasNC));
ok('#54d FlowCanvas: 선과 화살촉이 같은 색을 쓴다',
  /stroke=\{color\}/.test(singleBranch) && /markerEnd=\{heads\.end \? marker : undefined\}/.test(singleBranch));
// ⚠️ 후광 굵기는 선 굵기에서 파생시킨다 — 고정값(옛 9)이면 '굵게' 선에 묻혀 선택 표시가 사라진다.
ok('#54e FlowCanvas: 선택된 선을 색·굵기와 무관하게 알아볼 수 있다(후광)',
  /edgeSel && \(\s*<path[\s\S]{0,220}strokeOpacity=\{0\.35\}/.test(canvasNC) && /strokeWidth=\{line\.width \+ 7\}/.test(canvasNC));
ok('#55 FlowCanvas: 도형 글자색이 채우기 밝기를 따른다(흰 글자 묻힘 방지)',
  /readableTextColor\(fillColor\)/.test(canvasNC) && /style=\{\{ color: textColor \}\}/.test(canvasNC));
ok('#55b FlowCanvas: 기본 채우기 리터럴을 손복제하지 않았다', !/'#2E75B6'/.test(canvasNC) && /DEFAULT_NODE_FILL/.test(canvasNC));
ok('#55c FlowCanvas: 줌 한계가 flowMap.ts 상수와 공유(저장 시 잘리는 배율 방지)',
  /Math\.min\(FLOW_MAX_SCALE, Math\.max\(FLOW_MIN_SCALE/.test(canvasNC));
{
  const picks = inspNC.match(/<ColorPicker/g) || [];
  ok('#56 FlowInspector: 도형·연결선이 **같은** 색 선택기를 쓴다(팔레트 손복제 금지)', picks.length === 2);
  ok('#56b FlowInspector: 도형 채우기 배선', /value=\{node\.fill\}[\s\S]{0,160}patch\(\{ fill: hex \|\| undefined \}\)/.test(inspNC));
  ok('#56c FlowInspector: 연결선 색 배선', /value=\{edge\.stroke\}[\s\S]{0,160}patchEdge\(\{ stroke: hex \|\| undefined \}\)/.test(inspNC));
}
// ⚠️ 기본색 hex를 저장값으로 박으면 나중에 기본색을 바꿔도 그 도형만 옛 색에 남는다.
ok('#56d FlowInspector: 기본색 되돌리기는 필드를 지운다(hex 박제 금지)', /onPick\(null\)/.test(inspNC));
ok('#57 FlowInspector: 테마 색 6단은 계산으로 만든다(60색 손나열 금지)',
  /shiftHex\(c\.base, c\.steps\[r\]\)/.test(inspNC) && (inspNC.match(/THEME_COLUMNS = \[/g) || []).length === 1);
ok('#57b FlowInspector: 표준 색 10종(엑셀과 같은 대표색)', (inspNC.match(/name: '/g) || []).length >= 18);
// ⚠️ 이 패널은 overflow-y-auto라 absolute 팝오버가 잘린다 → 접이식으로 두어 그 문제를 만들지 않는다.
ok('#57c FlowInspector: 색 팔레트를 부동 팝오버로 만들지 않았다',
  !/ColorPicker[\s\S]{0,4000}position:\s*'fixed'/.test(inspNC) && !/createPortal/.test(inspNC));

console.log('\n■ 소스 텍스트 가드 — 화살촉 방향 배선');
// ⚠️ 캔버스와 인스펙터가 arrowHeads 한 함수를 공유해야 '그려진 방향'과 '설명하는 방향'이 안 갈린다.
ok('#63 FlowCanvas: 화살촉 위치를 arrowHeads가 단독 판정', /const heads = arrowHeads\(e\.arrow\)/.test(canvasNC));
// ⚠️ **두 분기 모두** 본다 — 전역으로 재면 한쪽만 지우는 변이를 놓친다(실측 죽은 단언).
ok('#63b FlowCanvas: 일반 선이 그 판정을 그대로 쓴다',
  /markerStart=\{heads\.start \? marker : undefined\}/.test(singleBranch)
  && /markerEnd=\{heads\.end \? marker : undefined\}/.test(singleBranch));
ok('#63d FlowCanvas: 이중선도 같은 판정을 쓴다',
  /markerStart=\{heads\.start \? marker : undefined\}/.test(doubleBranch)
  && /markerEnd=\{heads\.end \? marker : undefined\}/.test(doubleBranch));
// ⚠️ e.arrow 를 캔버스에서 직접 비교로 되돌리면 인스펙터 안내 문구와 조용히 갈린다.
ok('#63c FlowCanvas: arrow 값을 직접 문자열 비교하지 않는다', !/e\.arrow === '(to|from|both|none)'/.test(canvasNC));
{
  // ⚠️ 파일 전역으로 세지 말 것 — 금액 출처 선택지에도 `{ k: 'none'` 이 있어 개수가 맞지 않는다
  //    (실측: 4를 기대했는데 5가 나왔다). 반드시 ARROW_CHOICES 구간을 잘라서 본다.
  const ac = sliceBetween(inspNC, 'const ARROW_CHOICES = [', '];');
  ok('#64 FlowInspector: 화살표 선택지가 4개(시작/끝 분리)', (ac.match(/\{ k: '(to|from|both|none)'/g) || []).length === 4);
  ok('#64b FlowInspector: 시작(from) 선택지가 실재', /\{ k: 'from',/.test(ac));
}
ok('#64c FlowInspector: 선택 표시가 공유 정규화를 쓴다(레거시 미설정도 끝으로 표시)',
  /normalizeFlowArrow\(edge\.arrow\) === k/.test(inspNC));
ok('#64d FlowInspector: 선택지를 실제로 렌더한다', /ARROW_CHOICES\.map\(/.test(inspNC));
// ⚠️ 안내 문구가 arrow 값을 다시 비교하면 캔버스와 갈린다 → 반드시 arrowHeads 파생.
{
  const aft = sliceBetween(inspNC, 'const arrowFlowText =', '};');
  ok('#65 FlowInspector: 흐름 안내 문구가 arrowHeads에서 파생', aft.includes('arrowHeads(arrow)'));
  ok('#65b FlowInspector: 문구 안에서 arrow 값을 다시 비교하지 않는다', !/arrow === '/.test(aft));
  ok('#65c FlowInspector: 시작 화살촉이면 이름 순서를 뒤집어 설명(이 기능의 요점)',
    /h\.end \? `자금 흐름: \$\{a\} → \$\{b\}` : `자금 흐름: \$\{b\} → \$\{a\}`/.test(aft));
}
ok('#65d FlowInspector: 안내 문구를 실제로 렌더한다', /arrowFlowText\(edge\.arrow, edgeEnds\)/.test(inspNC));
// ⚠️ 이름이 없으면 '시작/끝'이 어느 도형인지 화면 어디에도 없다(선을 그은 순서를 기억할 리 없다).
ok('#66 FlowBoard: 선 양 끝 도형 이름을 인스펙터로 넘긴다', /edgeEnds=\{selEdgeEnds\}/.test(boardNC));
ok('#66b FlowBoard: 이름은 라이브 파생(viewOf)이고 노드가 없으면 안전 폴백',
  /const selEdgeEnds = selEdge \? \{ from: edgeEndName\(selEdge\.from\), to: edgeEndName\(selEdge\.to\) \} : null/.test(boardNC)
  && /viewOf\(n\)\.displayName/.test(boardNC));

console.log('\n■ 소스 텍스트 가드 — 선 종류 배선');
// ⚠️ 캔버스와 인스펙터 미리보기가 flowLineRender 하나를 공유해야 '고른 모양 = 그려지는 모양'이다.
ok('#75 FlowCanvas: 선 렌더 판정을 flowLineRender가 단독으로 한다', /const line = flowLineRender\(e\)/.test(canvasNC));
// ⚠️ 파일 전역으로 재지 말 것 — `strokeWidth={line.width}` 는 이중선 바깥 path 에도 있어서,
//    전역으로 재면 **일반 선의 굵기를 2로 고정하는 변이가 그대로 통과한다**(실측 죽은 단언).
//    두 분기를 잘라서 각각 본다.
ok('#75b FlowCanvas: 일반 선이 굵기·패턴을 그 판정에서 쓴다',
  /strokeWidth=\{line\.width\}/.test(singleBranch) && /strokeDasharray=\{line\.dash\}/.test(singleBranch));
// ⚠️ 레거시 dashed 를 캔버스에서 직접 읽으면 점선으로 그려 둔 기존 선이 전부 실선이 된다.
ok('#75c FlowCanvas: e.dashed를 직접 읽지 않는다', !/e\.dashed/.test(canvasNC));
ok('#75d FlowCanvas: 옛 하드코딩 dasharray("6 4")를 되살리지 않았다', !/'6 4'/.test(canvasNC));
{
  // 이중선: 바깥(색) 위에 안쪽(배경색)을 덮고, 화살촉은 **안쪽**에 단다(바깥에 달면 3배로 커진다).
  ok('#76 FlowCanvas: 이중선은 배경색으로 가운데를 덮는다', /stroke=\{FLOW_CANVAS_BG\}/.test(doubleBranch));
  ok('#76b FlowCanvas: 안쪽 굵기를 쓴다', /strokeWidth=\{line\.innerWidth\}/.test(doubleBranch));
  // ⚠️ '안쪽이 바깥보다 뒤에 있나'로 재면 죽은 단언이다 — 바깥 path 에 markerEnd 를 **추가**해도
  //    같은 줄이라 순서 비교를 통과한다(실측). 바깥 path 안에 marker 가 **없음**을 봐야 한다.
  const outerPath = sliceBetween(doubleBranch, '<path', '/>');
  ok('#76c FlowCanvas: 바깥(3배 굵기) path에는 화살촉을 붙이지 않는다(화살촉만 3배 확대 방지)',
    outerPath.includes('strokeWidth={line.width}') && !outerPath.includes('marker'));
  ok('#76c2 FlowCanvas: 화살촉은 안쪽 path에 붙는다',
    /stroke=\{FLOW_CANVAS_BG\}[\s\S]{0,240}markerEnd=\{heads\.end \? marker : undefined\}/.test(doubleBranch));
}
// ⚠️ 이중선 가운데 색은 캔버스 배경과 **같은 상수**여야 한다 — 다르면 선 한가운데 다른 색 띠가 생긴다.
ok('#76d FlowCanvas: 배경색 리터럴을 손복제하지 않았다', !/#0b1120/.test(canvasNC) && /FLOW_CANVAS_BG/.test(canvasNC));
{
  const lp = sliceBetween(inspNC, 'function LinePreview', 'function Swatch');
  ok('#77 FlowInspector: 미리보기가 캔버스와 같은 flowLineRender를 쓴다',
    /flowLineRender\(\{ lineStyle: style, lineWidth: width \}\)/.test(lp));
  ok('#77b FlowInspector: 미리보기가 dasharray를 손으로 적지 않는다', !/strokeDasharray="/.test(lp));
  ok('#77c FlowInspector: 이중선 미리보기도 배경색 덮기 방식', /stroke=\{r\.double \? FLOW_CANVAS_BG : color\}/.test(lp));
}
ok('#78 FlowInspector: 선 종류 선택지가 7종', (sliceBetween(inspNC, 'const LINE_STYLE_CHOICES = [', '];').match(/\{ k: '/g) || []).length === 7);
ok('#78b FlowInspector: 굵기 선택지가 3종', (sliceBetween(inspNC, 'const LINE_WIDTH_CHOICES = [', '];').match(/\{ k: '/g) || []).length === 3);
ok('#78c FlowInspector: 미리보기를 실제로 렌더한다', /<LinePreview style=\{k\} width=\{curLineWidth\} color=\{curEdgeColor\}/.test(inspNC));
// ⚠️ 기본값을 저장값으로 박으면 기존 선이 전부 '변경됨'이 되어 원본 참조 보존 계약이 깨진다.
ok('#78d FlowInspector: 기본값(실선/보통)은 필드를 지운다',
  /lineStyle: k === 'solid' \? undefined : k/.test(inspNC) && /lineWidth: k === 'normal' \? undefined : k/.test(inspNC));
// ⚠️ 옛 2택 토글로 되돌리면 새 5종을 고를 방법이 화면에서 사라진다.
ok('#78e FlowInspector: 옛 dashed 토글을 되살리지 않았다', !/dashed: !edge\.dashed/.test(inspNC));
// ⚠️ 현재값은 resolveFlowLineStyle 로 읽는다 — 직접 읽으면 레거시 점선 선택이 '실선'으로 표시된다.
ok('#78f FlowInspector: 현재 선 종류를 레거시까지 해석해서 읽는다',
  /const curLineStyle = resolveFlowLineStyle\(edge\?\.lineStyle, edge\?\.dashed\)/.test(inspNC));
// ⚠️ 렌더 스코프 선언 — 다른 최상위 블록의 지역 변수를 참조하면 런타임 ReferenceError 로
//    화면이 통째로 오류 페이지가 되는데 빌드도 undefcheck 도 잡지 못한다(initTradeRest 선례).
ok('#78g FlowInspector: 미리보기 인자 3종이 컴포넌트 렌더 스코프에 선언돼 있다',
  /const curLineWidth = normalizeFlowLineWidth\(edge\?\.lineWidth\)/.test(inspNC)
  && /const curEdgeColor = sanitizeHexColor\(edge\?\.stroke\) \|\| DEFAULT_EDGE_STROKE/.test(inspNC));
// ⚠️ 새 선에 기본값을 박으면 normalizeFlowMaps 가 매번 '변경됨'으로 본다.
ok('#79 FlowBoard: 새 연결선에 레거시 dashed·기본값을 넣지 않는다',
  /const e = \{ id: generateId\(\), from, to, label: '', arrow: 'to' \};/.test(boardNC));

console.log('\n■ 소스 텍스트 가드 — 시트(다중 흐름도) 배선');
// ⚠️ 상한을 **낮추면** normalizeFlowMaps 가 초과분을 slice 로 잘라 그 뒤 시트가 다음 로드에서
//    영구 삭제된다(sticky 복원 대상이라 백업으로도 못 되살린다). 관계로 단언한다.
{
  const m = mod.match(/export const MAX_FLOW_MAPS = (\d+)/);
  ok('#87 flowMap.ts: 시트 상한이 배포값(20) 아래로 내려가지 않았다(초과분 영구 절단 방지)',
    !!m && Number(m[1]) >= 20);
  ok('#87b 미러 상수가 src와 일치(드리프트 가드)', !!m && Number(m[1]) === MAX_FLOW_MAPS);
}
// ⚠️ 활성 시트를 저장하면 인앱 보드와 별도 창이 같은 flowMaps 를 공유하므로 한쪽에서 시트를
//    바꿀 때 다른 쪽 화면이 따라 움직인다 → 세션 로컬로 둔다(영속화 신규 지점 0곳).
ok('#87c flowMap.ts: 활성 시트를 저장 필드로 만들지 않았다', !/activeMapId|activeSheet/.test(mod));
ok('#87d App.tsx: 활성 시트 state 를 앱 레벨로 올리지 않았다', !/flowActiveId|setFlowActiveId/.test(app));
{
  // ⚠️ 최대 회귀 지점 — prev[0] 로 되돌리면 2번 시트를 보면서 그린 도형이 1번 시트에 꽂힌다.
  const pm = sliceBetween(boardNC, 'const patchMap = useCallback((fn) => {', '}, [commit]);');
  ok('#88 FlowBoard: 편집 커밋이 **활성 시트 id** 기준',
    /const id = activeIdRef\.current;/.test(pm) && /findIndex\(m => m\?\.id === id\)/.test(pm));
  ok('#88b FlowBoard: 인덱스 고정(prev[0]/prev.slice(1))으로 되돌리지 않았다',
    !/prev\?\.\[0\]/.test(pm) && !/prev\.slice\(1\)/.test(pm));
  const cv = sliceBetween(boardNC, 'const commitViewport = useCallback(() => {', 'commitViewportRef.current = commitViewport;');
  ok('#88c FlowBoard: 팬/줌 커밋도 활성 시트 id 기준(A 시트 화면이 B 시트에 기록되는 것 방지)',
    /const id = activeIdRef\.current;/.test(cv) && /findIndex\(m => m\?\.id === id\)/.test(cv)
    && !/prev\?\.\[0\]/.test(cv) && !/prev\.slice\(1\)/.test(cv));
}
{
  // 시트 전환 순서가 곧 계약이다: 떠나는 시트 커밋 → 활성 id 교체 → 새 시트 화면 복원.
  const sw = sliceBetween(boardNC, 'const switchSheet = useCallback((id) => {', '}, []);');
  const iCommit = sw.indexOf('commitViewportRef.current?.()');
  const iSwap = sw.indexOf('activeIdRef.current = id');
  const iRestore = sw.indexOf('setViewport(initialViewportOf(');
  ok('#89 FlowBoard: 전환은 **떠나는 시트를 먼저 커밋**한 뒤 활성 id 를 바꾼다',
    iCommit >= 0 && iSwap > iCommit && iRestore > iSwap);
  ok('#89b FlowBoard: 전환 복원은 사용자 제스처가 아니다(applyViewport 금지 + touched 리셋)',
    !sw.includes('applyViewport(') && /vpTouchedRef\.current = false;/.test(sw));
  ok('#89c FlowBoard: 전환 시 선택·연결 상태를 초기화(다른 시트의 도형이 선택된 채 남지 않게)',
    sw.includes('setSelectedId(null)') && sw.includes('setConnectFrom(null)'));
}
{
  // 늦게 도착한 배열에는 시드 시트의 id 가 없다 → 활성 id 를 유효한 것으로 되돌리지 않으면
  // 화면은 1번 시트인데 커밋은 전부 조용한 no-op 이 된다(그리는데 아무것도 안 남는다).
  const adopt = sliceBetween(boardNC, 'if (!open || dirtyRef.current) return;', '}, [open, maps]);');
  ok('#89d FlowBoard: 늦게 도착한 배열에 활성 시트가 없으면 첫 시트로 되돌린다',
    /!maps\.some\(m => m\?\.id === activeIdRef\.current\)/.test(adopt) && /activeIdRef\.current = maps\[0\]\?\.id/.test(adopt));
}
// ⚠️ 배열 변형은 flowMap.ts 순수 함수만 쓴다 — 손 splice 는 '변경 없으면 원본 참조' 계약을 깨고,
//    무엇보다 복제의 **노드 id 재매핑**을 빠뜨려 사본의 연결선이 다음 로드에서 통째로 사라진다.
ok('#90 FlowBoard: 시트 배열 변형은 공유 순수 함수 경유',
  /addFlowMap\(prev\)/.test(boardNC) && /duplicateFlowMap\(prev, id\)/.test(boardNC)
  && /removeFlowMap\(cur, id\)/.test(boardNC) && /renameFlowMap\(prev, id, renameDraft\)/.test(boardNC)
  && /moveFlowMap\(prev, id, delta\)/.test(boardNC));
ok('#90b FlowBoard: 배열을 손으로 splice 하지 않는다', !/\.splice\(/.test(boardNC));
{
  // ⚠️ 시트 삭제는 도형·선이 통째로 사라지고 undo 가 없다. 별도 창(confirm 없음)에서도
  //    확인 없는 즉시 삭제로 후퇴하지 말 것 → 인라인 2단계.
  const ds = sliceBetween(boardNC, 'const deleteSheet = useCallback(async (id) => {', '}, [readOnly, confirm, commit, switchSheet]);');
  ok('#91 FlowBoard: 삭제는 확인창 또는 인라인 2단계를 거친다',
    /if \(confirm\) \{/.test(ds) && /delArmRef\.current !== id/.test(ds));
  ok('#91b FlowBoard: 마지막 한 장은 지우지 않는다', /\(prev\?\.length \|\| 0\) <= 1/.test(ds));
  ok('#91c FlowBoard: 삭제 후 이웃 시트로 전환한다(빈 화면 방지)', /switchSheet\(/.test(ds));
}
ok('#91d FlowBoard: 시트가 한 장이면 삭제 버튼을 잠근다',
  /disabled=\{\(mapsLocal\?\.length \|\| 0\) <= 1\}/.test(boardNC));
// 탭 바 — 이 기능의 유일한 진입점이다.
ok('#92 FlowBoard: 탭 바가 전 시트를 렌더하고 클릭이 전환',
  /\(mapsLocal \|\| \[\]\)\.map\(m => \(/.test(boardNC) && /onClick=\{\(\) => switchSheet\(m\.id\)\}/.test(boardNC));
ok('#92b FlowBoard: 더블클릭으로 이름 변경', /onDoubleClick=\{\(\) => startRename\(m\)\}/.test(boardNC));
ok('#92c FlowBoard: 추가·복제·이동·이름·삭제 버튼 배선',
  /onClick=\{addSheet\}/.test(boardNC) && /duplicateSheet\(map\.id\)/.test(boardNC)
  && /moveSheet\(map\.id, -1\)/.test(boardNC) && /moveSheet\(map\.id, 1\)/.test(boardNC)
  && /startRename\(map\)/.test(boardNC) && /deleteSheet\(map\.id\)/.test(boardNC));
// ⚠️ 캔버스의 드래그·hover 로컬 상태는 노드 id 를 들고 있다 → 시트 전환 시 remount 로 비운다.
ok('#92d FlowBoard: 시트 전환 시 캔버스를 remount', /key=\{map\?\.id \|\| 'none'\}/.test(boardNC));
{
  // ⚠️ Escape 가 일반 typing 분기로 새면 target.blur() → blur 커밋이라 '취소'가 저장이 된다.
  ok('#93 FlowBoard: 시트 이름 입력은 자기 핸들러가 Enter/Escape 를 처리',
    /e\.target\?\.dataset\?\.flowSheetRename !== undefined/.test(boardNC)
    && /data-flow-sheet-rename=""/.test(boardNC));
  ok('#93b FlowBoard: Escape 취소는 ref 플래그로 판정(언마운트 시 blur 미발화 대비)',
    /renameCancelRef\.current = true; setRenameId\(null\);/.test(boardNC)
    && /const cancelled = renameCancelRef\.current;/.test(boardNC));
}

// ── 툴바 좌측 상단 제목 = 활성 시트 이름 (2026-09 사용자 요청) ──────────────────
// ⚠️ 파일 전역 정규식으로 재지 말 것 — 탭 입력과 제목 입력이 같은 문자열
//    (`data-flow-sheet-rename=""` 등)을 쓰므로 **한쪽만 되돌리는 변이가 그대로 통과**한다.
{
  const titleBlk = sliceBetween(boardNC, 'border-b border-gray-700 bg-[#0f1623] shrink-0 flex-wrap', "addNode('rect')");
  const tabBlk = sliceBetween(boardNC, '(mapsLocal || []).map(m => (', 'onClick={addSheet}');
  ok('#94 FlowBoard: 툴바 제목·탭 구간을 찾았다', titleBlk.length > 0 && tabBlk.length > 0);
  // ⚠️ 같은 문자열이 편집 버튼과 readOnly span **두 분기**에 있다 → '한 번이라도 등장하는가'로
  //    재면 한쪽만 하드코딩으로 되돌리는 변이가 다른 쪽으로 통과한다(실측 죽은 단언).
  ok('#94b FlowBoard: 제목이 활성 시트 이름을 렌더한다(하드코딩 아님, 두 분기 모두)',
    /\{map\?\.name \|\| '자금 흐름도'\}\s*<\/button>/.test(titleBlk)
    && /\{map\?\.name \|\| '자금 흐름도'\}<\/span>/.test(titleBlk));
  ok('#94c FlowBoard: 제목 클릭이 이름 편집을 연다',
    /onClick=\{\(\) => startRename\(map, 'title'\)\}/.test(titleBlk));
  ok('#94d FlowBoard: 제목 입력도 키 분기 속성을 단다(Escape 취소가 저장이 되지 않게)',
    /data-flow-sheet-rename=""/.test(titleBlk));
  ok('#94e FlowBoard: 제목 커밋은 탭과 같은 commitRename 경유(renameFlowMap 단일 쓰기 경로)',
    /onBlur=\{\(\) => commitRename\(map\.id\)\}/.test(titleBlk));
  ok('#94f FlowBoard: readOnly 면 제목을 편집하지 않는다', /\) : readOnly \? \(/.test(titleBlk));
  // ⚠️ 판별자가 없으면 두 입력이 같은 `renameId` 로 **동시에** 마운트돼 한 이름을 두 칸에서 고친다.
  ok('#94g FlowBoard: 제목 입력은 편집 위치가 title 일 때만 마운트',
    /renameId === map\?\.id && renameWhere === 'title'/.test(titleBlk));
  ok('#94h FlowBoard: 탭 입력은 제목을 편집 중이면 마운트하지 않는다',
    /renameId === m\.id && renameWhere !== 'title'/.test(tabBlk));
  ok('#94i FlowBoard: startRename 이 편집 위치를 받아 판별자를 세운다',
    /const startRename = useCallback\(\(m, where\) =>/.test(boardNC)
    && /setRenameWhere\(where === 'title' \? 'title' : 'tab'\)/.test(boardNC));
}

// ⚠️ #37 은 흐름도 전용 계약이 아니라 **빌드 차단 사고 재발 방지**다. 이 저장소에서 두 번 났다:
//    ① `(` 직후(표현식 위치)에 `{/* */}` 를 두어 빈 객체 리터럴로 파싱된 사고
//    ② JSX 주석 **본문에 `*/` 를 포함**시켜(주석 안에서 주석 문법을 설명하다) 주석이 조기 종료된 사고
//    둘 다 esbuild 파싱 에러라 `vite build` 가 통째로 죽는데, 이 환경에는 node 가 없어 빌드로는
//    못 잡는다.
//    ⚠️ 규칙은 "첫 `*/` 뒤가 `}` 인가" 가 **아니다** — 실제 사고가 정확히 그 형태로 통과한다
//       (본문에 주석 문법을 적으면 첫 `*/` 가 그 안쪽 것이라 뒤에 `}` 가 오고, 남은 산문이
//        JSX 자식이 되어 마지막 `}` 에서 터진다). 올바른 규칙: **본문에 `/*` 가 있으면 안 된다.**
console.log('\n■ JSX 주석 안전성 (빌드 차단 사고 재발 방지)');
{
  const files = [
    'src/components/FlowBoard.tsx', 'src/components/FlowCanvas.tsx',
    'src/components/FlowInspector.tsx', 'src/components/FlowWindow.tsx',
    'src/components/LedgerPage.tsx', 'src/components/LedgerWindow.tsx',
    'src/components/AdminPage.tsx', 'src/components/UserInfoBar.tsx',
    'src/components/AccountTabBar.tsx', 'src/App.tsx', 'src/main.tsx',
  ];
  const bad = [];
  for (const rel of files) {
    let src;
    try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
    let i = 0;
    while ((i = src.indexOf('{/*', i)) !== -1) {
      const end = src.indexOf('*/', i + 3);
      if (end === -1) { bad.push(`${rel}: 닫히지 않은 JSX 주석`); break; }
      const body = src.slice(i + 3, end);
      const lineNo = src.slice(0, i).split('\n').length;
      // 본문에 `/*` → 주석 문법을 산문으로 적었다는 뜻 = 조기 종료
      if (body.includes('/*')) bad.push(`${rel}:${lineNo} — 주석 본문에 '/*'가 있어 조기 종료됨`);
      // 첫 `*/` 뒤가 `}`도 아니고 공백/개행도 아니면 주석이 JSX 표현식을 닫지 못한 것
      else if (src[end + 2] !== '}') bad.push(`${rel}:${lineNo} — JSX 주석이 '}'로 닫히지 않음`);
      i = end + 2;
    }
  }
  ok(`#37 JSX 주석이 조기 종료되지 않는다${bad.length ? `\n      ${bad.join('\n      ')}` : ''}`, bad.length === 0);
}

console.log('\n■ 소스 텍스트 가드 — 연결선 합치기 배선 (⚠️ 선언이 아니라 사용부를 단언한다)');
// ⚠️ 계산은 flowMap이 단독으로 한다 — 캔버스가 그룹 키를 다시 만들면 트렁크가 뻗는 변과
//    실제로 그려지는 앵커가 갈린다.
ok('#G130 FlowCanvas: 번들을 flowMap 공유 함수로 계산',
  /const bundles = useMemo\(\s*\(\) => buildFlowBundles\(liveNodes, edges, bundleEnabled\),/.test(canvasNC));
// ⚠️ 이 한 줄이 '번들이 실제로 화면에 반영되는' 유일한 연결이다. 인자를 빠뜨리면 계산은 도는데
//    선은 종전대로 그려져 트렁크만 허공에 뜬다.
ok('#G130b FlowCanvas: edgePath에 번들 인자를 넘긴다',
  /edgePath\(nodeIndex\.get\(e\.from\), nodeIndex\.get\(e\.to\), e, bundles\.byEdge\[e\.id\]\)/.test(canvasNC));
// ⚠️ 렌더가 edgePath를 다시 부르면 라벨 배치가 쓰는 좌표와 화면의 선이 갈린다.
ok('#G130c FlowCanvas: 선 렌더는 paths memo를 읽는다', /const p = paths\.get\(e\.id\);/.test(canvasNC));
{
  // ⚠️ 트렁크는 **선 그룹보다 앞**(=아래)에 그린다. 뒤에 두면 도형과 선 위에 얹힌다.
  const iTrunk = canvasNC.indexOf('{bundles.trunks.map(t => {');
  const iEdges = canvasNC.indexOf('{edges.map(e => {');
  const iNodes = canvasNC.indexOf('{nodes.map(raw => {');
  ok('#G131 FlowCanvas: 트렁크 레이어가 선 그룹보다 먼저 그려진다', iTrunk >= 0 && iEdges > iTrunk);
  // ⚠️ 라벨 레이어는 **선 뒤 · 노드 앞**이다. 노드보다 뒤에 두면 라벨 히트박스가 도형의
  //    onPointerDown을 가로채 도형 드래그·리사이즈·연결이 통째로 죽는다.
  const iLabels = canvasNC.indexOf("const pl = labels.get(e.id);");
  ok('#G131b FlowCanvas: 라벨 레이어가 선 뒤 · 노드 앞', iLabels > iEdges && iNodes > iLabels);
  ok('#G131c FlowCanvas: 노드 렌더 앵커가 실재(위 순서 비교가 죽은 단언이 아님)', iNodes > 0);
}
{
  // ⚠️ 트렁크를 선마다 각자 그려 겹치게 하면 이중선이 배경색 지우개가 되고 선택 후광·히트박스가
  //    공유 구간을 덮는다 → 그룹당 하나만 그리고, 그 하나는 포인터를 받지 않는다.
  // ⚠️ 파일 전역 정규식으로 재지 말 것 — 이중선 분기의 `<g pointerEvents="none">` 하나가
  //    단일선 path의 누락을 가려 준다(실측: 그 형태가 죽은 단언이었다). 두 분기를 잘라서 각각 본다.
  const trunk = sliceBetween(canvasNC, '{bundles.trunks.map(t => {', '{edges.map(e => {');
  const [tDouble = '', tSingle = ''] = trunk.split(') : (');
  ok('#G132 FlowCanvas: 이중선 트렁크가 포인터를 받지 않는다',
    /<g key=\{t\.key\} pointerEvents="none">/.test(tDouble));
  ok('#G132b FlowCanvas: 일반 트렁크도 포인터를 받지 않는다(개별 선의 클릭을 가로채지 않는다)',
    /pointerEvents="none"/.test(tSingle) && tSingle.length > 0);
  ok('#G132c FlowCanvas: 트렁크도 flowLineRender 공유(선 종류·굵기가 본선과 갈리지 않게)',
    /flowLineRender\(\{ lineStyle: t\.lineStyle, lineWidth: t\.lineWidth \}\)/.test(trunk));
  // ⚠️ 이중선은 가운데를 배경색으로 덮어 만든다 — 바깥(3배 굵기) path에 화살촉을 달면
  //    markerUnits="strokeWidth"가 기본이라 화살촉만 3배로 커진다.
  // ⚠️ '안쪽에 marker가 있나'로만 재면 **죽은 단언**이다 — 바깥 path에 markerEnd를 **추가**해도
  //    안쪽 것이 그대로 있어 통과한다(실측). 바깥 path 안에 marker가 **없음**을 봐야 한다.
  //    (연결선 렌더의 #76c와 같은 함정.)
  {
    const outerPath = sliceBetween(tDouble, '<path', '/>');
    ok('#G132d FlowCanvas: 이중선 트렁크의 바깥 path에는 화살촉을 붙이지 않는다',
      outerPath.includes('strokeWidth={tLine.width}') && !outerPath.includes('marker'));
    ok('#G132d2 FlowCanvas: 화살촉은 안쪽(배경색) path에 붙는다',
      /stroke=\{FLOW_CANVAS_BG\}[\s\S]{0,200}markerEnd=\{t\.head && t\.headOutward/.test(tDouble));
  }
}
ok('#G132b FlowCanvas: 트렁크도 flowLineRender 공유(선 종류·굵기가 본선과 갈리지 않게)',
  /flowLineRender\(\{ lineStyle: t\.lineStyle, lineWidth: t\.lineWidth \}\)/.test(canvasNC));
// ⚠️ 화살촉은 도형 경계 쪽 끝에 붙는다 — 출발 뭉치는 markerStart, 도착 뭉치는 markerEnd.
ok('#G132c FlowCanvas: 트렁크 화살촉이 방향에 따라 갈린다',
  /markerEnd=\{t\.head && t\.headOutward \? tMarker : undefined\}/.test(canvasNC)
  && /markerStart=\{t\.head && !t\.headOutward \? tMarker : undefined\}/.test(canvasNC));
ok('#G133 FlowBoard: 시트 토글 해석을 공유 함수로(생략 = 켜짐)',
  /const bundleOn = flowBundleEnabled\(map\?\.bundleEdges\);/.test(boardNC));
ok('#G133b FlowBoard: 캔버스에 토글을 전달', /bundleEnabled=\{bundleOn\}/.test(boardNC));
{
  // ⚠️ 켤 때 `true`를 저장하면 그 시트가 매 로드 재구축 경로로 떨어지는데 지문은 같아
  //    그 정리가 영영 저장되지 않는다(무한 churn) → 필드를 **지운다**.
  const tb = sliceBetween(boardNC, 'const toggleBundle = useCallback(() => {', '}, [patchMap]);');
  ok('#G134 FlowBoard: 끌 때만 값을 저장한다', /bundleEdges: false/.test(tb));
  ok('#G134b FlowBoard: 켤 때는 필드를 지운다', /delete next\.bundleEdges;/.test(tb));
  ok('#G134c FlowBoard: `bundleEdges: true`를 저장하지 않는다', !/bundleEdges: true/.test(tb) && tb.length > 0);
}

console.log('\n■ 소스 텍스트 가드 — 도형 정렬 스냅 배선');
{
  // ⚠️ **최우선 회귀** — resolved 시드가 없으면 도형을 클릭만 해도(pointermove 0회)
  //    liveNode가 undefined를 읽어 렌더 중 TypeError → 보드가 통째로 오류 화면이 된다.
  const sd = sliceBetween(canvasNC, 'const startDrag = (e, n, mode) => {', 'const onPointerMove');
  ok('#G140 FlowCanvas: startDrag가 resolved를 반드시 시드한다',
    /const resolved = \{ preview: \{ x: base\.x, y: base\.y \}, commit: \{ x: base\.x, y: base\.y \}, guides: \[\] \};/.test(sd));
  ok('#G140b FlowCanvas: 그 값을 drag state에 싣는다', /setDrag\(\{ mode, id: n\.id, ox: p\.x, oy: p\.y, dx: 0, dy: 0, base, resolved, peers \}\);/.test(sd));
  // 스냅 참조는 시작 시 1회 고정(프레임마다 재수집 방지 + 자기 자신 제외).
  ok('#G140c FlowCanvas: 참조 도형에서 자기 자신을 뺀다', /nodes\.filter\(x => x && x\.id !== n\.id\)/.test(sd));
}
{
  const pm = sliceBetween(canvasNC, 'const onPointerMove = (e) => {', 'const endDrag');
  ok('#G141 FlowCanvas: 이동 중 위치를 resolveNodeDrag가 정한다',
    /const resolved = resolveNodeDrag\(d\.base, dx, dy, d\.peers, tolRef\.current, snapOnRef\.current && !bypass\);/.test(pm));
  // ⚠️ Alt/Cmd = 이번 드래그만 해제. keydown 리스너를 쓰면 SVG에 tabIndex가 없어 신뢰할 수 없고
  //    보드의 onKeyDownCapture 규약과도 얽힌다.
  ok('#G141b FlowCanvas: 수식 키 해제가 실제로 배선돼 있다', /const bypass = !!\(e\.altKey \|\| e\.metaKey\);/.test(pm));
  ok('#G141c FlowCanvas: 수식 키를 setState 업데이터 밖에서 읽는다(업데이터는 나중에 실행될 수 있다)',
    pm.indexOf('const bypass') < pm.indexOf('setDrag(d => {'));
}
{
  // ⚠️ **최우선 회귀** — 미리보기가 raw로 돌아가면 가이드선만 뜨고 도형은 안 붙는다.
  const ln = sliceBetween(canvasNC, 'const liveNode = useCallback((n) => {', 'const liveNodes');
  ok('#G142 FlowCanvas: 미리보기가 resolved.preview를 읽는다', /const p = drag\.resolved && drag\.resolved\.preview;/.test(ln));
  ok('#G142b FlowCanvas: 미리보기를 raw(base+d)로 되돌리지 않았다', !/drag\.base\.x \+ drag\.dx/.test(ln) && ln.length > 0);
}
{
  // ⚠️ **최우선 회귀** — 정렬된 축에 격자를 다시 걸면 기본폭(180, mod 8 === 4)에서 100% 4px 어긋난다.
  const ed = sliceBetween(canvasNC, 'const endDrag = () => {', 'const onBgPointerDown');
  ok('#G143 FlowCanvas: 커밋이 resolved.commit을 읽는다', /const c = d\.resolved && d\.resolved\.commit;/.test(ed));
  ok('#G143b FlowCanvas: 정렬 결과 위에 격자를 덧씌우지 않는다(폴백에만 남는다)',
    /x: c \? c\.x : snapToGrid\(/.test(ed) && !/snapToGrid\(\s*c\./.test(ed));
}
ok('#G144 FlowCanvas: 임계값은 화면 px을 배율로 나눈다(공유 함수)', /tolRef\.current = snapTolerance\(viewport\.scale\);/.test(canvasNC));
ok('#G144b FlowCanvas: 임계값을 인라인 손계산으로 되돌리지 않았다', !/6\s*\/\s*viewport\.scale/.test(canvasNC));
ok('#G145 FlowCanvas: 가이드는 drag state에서 그린다(별도 state로 분리 금지 — 리렌더 2배)',
  /drag && drag\.resolved && drag\.resolved\.guides\.map\(/.test(canvasNC));
ok('#G145b FlowCanvas: 가이드를 두 겹으로 그린다(도형 채우기 위에서 사라지지 않게)',
  /stroke=\{FLOW_CANVAS_BG\} strokeWidth=\{3 \/ sc\}/.test(canvasNC) && /stroke="#f472b6"/.test(canvasNC));
ok('#G145c FlowCanvas: 가이드 굵기가 배율을 보정한다', /strokeWidth=\{1 \/ sc\}/.test(canvasNC));
ok('#G146 FlowBoard: 스냅 토글을 캔버스에 전달', /snapEnabled=\{snapOn\}/.test(boardNC));
// ⚠️ 스냅 토글은 세션 로컬이다 — 저장 필드로 올리면 영속화 지점이 늘고, 뷰 선호도라 그럴 값이 아니다.
ok('#G146b FlowBoard: 스냅 토글을 저장하지 않는다', !/snapOn/.test(mod) && /const \[snapOn, setSnapOn\] = useState\(true\)/.test(boardNC));

console.log('\n■ 소스 텍스트 가드 — 선 위 라벨 배선');
ok('#G150 FlowCanvas: 라벨 배치를 flowMap 공유 함수가 한다', /layoutFlowLabels\(items, obstacles\)/.test(canvasNC));
// ⚠️ 장애물에 도형 박스가 빠지면 '메모를 썼는데 화면 어디에도 없다'가 된다.
ok('#G150b FlowCanvas: 도형 박스를 장애물로 넣는다',
  /const obstacles = liveNodes\.map\(n => \(\{ x: n\.x, y: n\.y, w: n\.w, h: n\.h \}\)\);/.test(canvasNC));
// ⚠️ 상자 폭도 공유 함수 — 손으로 재면 배치가 고른 자리와 그려지는 상자가 갈린다.
ok('#G150c FlowCanvas: 상자 크기를 flowLabelSize로 잰다', /const lSize = flowLabelSize\(e\.label\);/.test(canvasNC));
ok('#G150d FlowCanvas: 옛 길이 추정(length * 12)을 되살리지 않았다',
  !/label\.length \* 12/.test(canvasNC) && !/label\.length \* 6/.test(canvasNC));
{
  // ⚠️ 정상 라벨에 pointerEvents를 켜면 최대 수백 px짜리 상자가 남의 선 위에 얹혀 클릭을 가로챈다.
  //    포인터를 받는 것은 점(dot)뿐이다.
  const lab = sliceBetween(canvasNC, 'const pl = labels.get(e.id);', '{nodes.map(raw => {');
  ok('#G151 FlowCanvas: 정상 라벨은 포인터를 받지 않는다', /<g key=\{`lb:\$\{e\.id\}`\} pointerEvents="none">/.test(lab));
  ok('#G151b FlowCanvas: 점은 호버로 전문을 보여 준다', /onPointerEnter=\{\(\) => setHoverLabel\(/.test(lab));
  ok('#G151c FlowCanvas: 점을 누르면 그 선이 선택된다', /onSelect\?\.\(`edge:\$\{e\.id\}`\)/.test(lab));
  ok('#G151d FlowCanvas: 보조 경로로 네이티브 툴팁도 단다', /<title>\{e\.label\}<\/title>/.test(lab));
}
ok('#G152 FlowCanvas: 즉시 툴팁을 최상단에 그린다', /\{hoverLabel && \(\(\) => \{/.test(canvasNC));

console.log('\n■ 소스 텍스트 가드 — 메모 팝업·표 배선');
const editor = readFileSync(join(ROOT, 'src/components/FlowNodeEditor.tsx'), 'utf8');
const edNC = stripComments(editor);
{
  // ⚠️ **최우선 회귀** — 같은 값을 인스펙터와 팝업 두 곳에서 편집하면, 팝업에서 쓴 뒤 인스펙터의
  //    미커밋 draft가 나중에 flush되며 방금 쓴 메모를 옛 값으로 덮는다(인스펙터 flush는 대상
  //    변경·언마운트에서 도는데 팝업 닫힘은 그 트리거가 아니다).
  ok('#G170 FlowInspector: 메모 draft를 들지 않는다(편집 경로는 팝업 하나)',
    !/memo:\s*''/.test(inspNC) && !/cur\.memo/.test(inspNC) && !/p\.memo/.test(inspNC));
  ok('#G170b FlowInspector: 메모 칸은 미리보기 + 팝업 진입점',
    /onOpenEditor\?\.\('memo'\)/.test(inspNC) && /\{node\.memo\}/.test(inspNC));
  ok('#G170c FlowInspector: 표 칸도 같은 팝업으로 연다', /onOpenEditor\?\.\('table'\)/.test(inspNC));
  // ⚠️ 렌더 스코프 선언 — 다른 최상위 블록의 지역 변수를 JSX가 참조하면 런타임 ReferenceError로
  //    화면이 통째로 오류 페이지가 되는데 @ts-nocheck + esbuild라 빌드도 undefcheck도 못 잡는다.
  ok('#G170d FlowInspector: 표 행 수가 렌더 스코프에 선언돼 있다',
    /const tableRowCount = Array\.isArray\(node\?\.table\?\.rows\) \? node\.table\.rows\.length : 0;/.test(inspNC));
}
{
  // ⚠️ 대상은 **id로 다시 찾는다** — 스냅샷을 들면 편집 중 폴링·다른 창이 바꾼 값이 화면에 안 붙고,
  //    도형이 지워졌을 때 사라진 대상에 계속 쓴다.
  ok('#G171 FlowBoard: 팝업 대상을 매 렌더 id로 다시 찾는다',
    /const editorNode = editor && map \? map\.nodes\.find\(n => n\.id === editor\.nodeId\) \|\| null : null;/.test(boardNC));
  ok('#G171b FlowBoard: 대상이 사라지면 팝업을 닫는다',
    /if \(editor && !editorNode\) setEditor\(null\);/.test(boardNC));
  ok('#G171c FlowBoard: 팝업을 실제로 렌더하고 id 기준 라이터를 넘긴다',
    /<FlowNodeEditor/.test(boardNC) && /onPatch=\{patchNodeById\}/.test(boardNC));
  ok('#G171d FlowBoard: 인스펙터에 진입점을 배선', /onOpenEditor=\{\(tab\) => selNode && setEditor\(/.test(boardNC));
  // ⚠️ 활성 시트를 저장하지 않는 것과 같은 이유로, 열린 팝업도 저장 필드가 아니다(세션 로컬).
  ok('#G171e flowMap.ts: 팝업 상태를 저장 필드로 만들지 않았다', !/editorOpen|openEditor/.test(mod));
}
{
  // ⚠️ 커밋은 **id 기준**이어야 한다 — 현재 선택에 바인딩하면 편집 중 다른 도형을 고른 순간
  //    그쪽에 기록된다(인스펙터가 ownerRef로 막아 둔 것과 같은 사고).
  const fl = sliceBetween(edNC, 'const flush = useCallback(() => {', '}, []);');
  ok('#G172 FlowNodeEditor: 커밋 대상이 id 기준', /const id = idRef\.current;/.test(fl) && /patchRef\.current\?\.\(id, o\)/.test(fl));
  ok('#G172b FlowNodeEditor: 값이 그대로면 아무것도 쓰지 않는다(헛된 Drive 저장 방지)',
    /if \(Object\.keys\(o\)\.length === 0\) return;/.test(fl));
  ok('#G172c FlowNodeEditor: 표 비교는 sameFlowTable 공유 함수', /!sameFlowTable\(nextTbl, base\.table\)/.test(fl));
  ok('#G172d FlowNodeEditor: 커밋 전 정규화를 거친다(상한·손상값이 저장에 새지 않게)',
    /const nextTbl = normalizeFlowTable\(tblRef\.current\);/.test(fl));
  // ⚠️ passive effect는 discrete 이벤트인 blur보다 뒤처지고, 제거된 DOM에는 blur가 발화하지 않는다.
  ok('#G173 FlowNodeEditor: 언마운트 flush가 useLayoutEffect',
    /useLayoutEffect\(\(\) => \(\) => \{ flush\(\); \}, \[flush\]\)/.test(edNC));
  ok('#G173b FlowNodeEditor: 키스트로크마다 커밋하지 않는다(onChange는 로컬 state만)',
    /onChange=\{e => setMemo\(e\.target\.value\)\}/.test(edNC) && /onBlur=\{flush\}/.test(edNC));
  // ⚠️ Escape는 **보드가** 처리한다(#G176). 보드가 캡처 단계에서 Escape 전파를 끊으므로 React 18에서는
  //    팝업의 bubble onKeyDown까지 이벤트가 **도달하지 않는다** — 옛 가드는 그 죽은 핸들러의 존재를
  //    단언하고 있었고, 실제로는 팝업 버튼에 포커스가 있을 때 Esc가 선택 해제 → 보드 전체 닫기가 됐다.
  ok('#G173c FlowNodeEditor: 도달하지 않는 Escape 핸들러를 되살리지 않았다(처리는 보드가 한다)',
    !/e\.key === 'Escape'/.test(edNC));
  ok('#G174 FlowNodeEditor: 계산은 flowMap 공유 함수가 한다(팝업이 합을 다시 구하지 않는다)',
    /const computed = computeFlowTable\(tbl\);/.test(edNC));
  ok('#G174b FlowNodeEditor: 자동 계산 행은 값 입력을 막고 계산 결과를 보여 준다',
    /const auto = r\.kind === 'subtotal' \|\| r\.kind === 'balance';/.test(edNC) && /\{computed\[i\]\?\.text \|\| '0'\}/.test(edNC));
  ok('#G174c FlowNodeEditor: 붙여넣기도 공유 파서를 쓴다', /flowTableFromText\(pasteText\)/.test(edNC));
  ok('#G174d FlowNodeEditor: 선 표시 선택지를 flowMap 상수에서 만든다(손나열 금지)',
    /FLOW_TABLE_BORDERS\.map\(/.test(edNC));
}
{
  // ⚠️ 도형 안 표도 같은 계산을 써야 팝업이 보여 준 값과 화면이 갈리지 않는다.
  ok('#G175 FlowCanvas: 표를 flowMap 공유 함수로 계산',
    /const tableRows = raw\.table \? computeFlowTable\(raw\.table\) : \[\];/.test(canvasNC));
  ok('#G175b FlowCanvas: 표를 실제로 렌더한다', /\{tableRows\.map\(\(r, i\) => \(/.test(canvasNC));
  ok('#G175c FlowCanvas: 선 표시가 저장값을 따른다',
    /const border = raw\.table\?\.border \|\| 'none';/.test(canvasNC) && /border !== 'none'/.test(canvasNC));
  ok('#G175d FlowCanvas: 자동 계산 행을 시각적으로 구분한다', /r\.computed \? 'italic opacity-80' : ''/.test(canvasNC));
  ok('#G175e FlowCanvas: 구분선 행은 가로선만 그린다', /r\.kind === 'rule' \? \(/.test(canvasNC));
  // ⚠️ 표 선 색을 하드코딩하면 밝은 채우기에서 사라진다 — 글자색과 같은 규칙을 따른다.
  ok('#G175f FlowCanvas: 표 선 색이 채우기 밝기를 따른다',
    /const gridColor = darkText \? 'rgba\(0,0,0,0\.35\)' : 'rgba\(255,255,255,0\.35\)';/.test(canvasNC));
}

console.log('\n■ 소스 텍스트 가드 — 팝업 이동 · 키 처리 · 실행 체크 · 서식 (⚠️ 선언이 아니라 사용부를 단언한다)');
{
  const kd = sliceBetween(boardNC, 'const onKeyDownCapture = (e) => {', 'if (!open) return null;');
  const edBranchAt = kd.indexOf("closest?.('[data-flow-node-editor]')");
  // ⚠️ 이 분기가 보드 단축키보다 뒤에 있으면 팝업 버튼에 포커스가 있을 때 Backspace가 **편집 중인 도형을
  //    삭제**하려 들고, Esc가 선택 해제 → 보드 전체 닫기가 된다.
  ok('#G176 FlowBoard: 팝업 안의 키를 보드 단축키보다 먼저 가른다',
    edBranchAt > 0 && edBranchAt < kd.indexOf('if (!typing) {') && edBranchAt < kd.indexOf('flowSheetRename'));
  const edBranch = sliceBetween(kd, "closest?.('[data-flow-node-editor]')", 'flowSheetRename');
  ok('#G176b FlowBoard: 팝업 안 Esc는 팝업을 닫는다', /if \(e\.key === 'Escape'\) setEditor\(null\);/.test(edBranch));
  ok('#G176c FlowBoard: 팝업 분기는 보드 단축키로 흘러가지 않는다', /return;\s*\}/.test(edBranch) && !/deleteNode|closeBoard|setSelectedId/.test(edBranch));
  ok('#G176d FlowBoard: 팝업 안 Delete/Backspace는 계산기 창으로도 새지 않는다',
    /\(!typing && \(e\.key === 'Delete' \|\| e\.key === 'Backspace'\)\)\) e\.stopPropagation\(\);/.test(edBranch));
  ok('#G176e FlowNodeEditor: 판별 속성을 패널 루트에 단다', /ref=\{panelRef\}\s+data-flow-node-editor=""/.test(edNC));
}
{
  // ⚠️ 옮기는 이유가 뒤의 흐름도를 보면서 쓰기 위해서다 — 화면을 덮는 백드롭을 되살리면 옮길 이유가 사라진다.
  ok('#G177 FlowNodeEditor: 화면을 덮는 백드롭이 없다', !/bg-black\/60/.test(edNC) && !/absolute inset-0/.test(edNC));
  ok('#G177b FlowNodeEditor: 위치가 없으면 가운데에 뜬다',
    /: \{ zIndex: 60, left: '50%', top: '50%', transform: 'translate\(-50%, -50%\)' \}/.test(edNC));
  ok('#G177c FlowNodeEditor: 옮긴 위치를 그린다', /\? \{ zIndex: 60, left: pos\.x, top: pos\.y \}/.test(edNC));
  const down = sliceBetween(edNC, 'const onHeaderPointerDown = (e) => {', 'const onHeaderPointerMove');
  ok('#G177d 제목 줄 드래그: 버튼·입력에서는 시작하지 않는다',
    /if \(e\.target\?\.closest\?\.\(NO_DRAG_SELECTOR\)\) return;/.test(down) && /const NO_DRAG_SELECTOR = 'button,input,select,textarea,a,label';/.test(edNC));
  ok('#G177e 제목 줄 드래그: 포인터 캡처(커서가 제목 줄 밖으로 나가도 따라온다)', /setPointerCapture\(e\.pointerId\)/.test(down));
  // ⚠️ 가운데 정렬(transform) 상태의 좌표로 출발하면 잡는 순간 팝업이 오른쪽 아래로 튄다.
  ok('#G177f 제목 줄 드래그: 지금 보이는 자리에서 출발한다', /ox: r\.left - hr\.left, oy: r\.top - hr\.top/.test(down));
  const move = sliceBetween(edNC, 'const onHeaderPointerMove = (e) => {', 'const endHeaderDrag');
  ok('#G177g 이동은 공유 클램프를 거친다', /const next = clampHere\(/.test(move) && /d\.last = next;/.test(move) && /setPos\(next\);/.test(move));
  ok('#G177h 클램프는 flowMap 공유 함수', /return clampFlowEditorPos\(/.test(edNC));
  // ⚠️ 프레임마다 보드 state를 바꾸면 보드 전체(툴바·인스펙터·캔버스)가 포인터 이동마다 다시 그려진다.
  ok('#G177i 끄는 동안에는 보드에 알리지 않는다', move.length > 0 && !/onPosCommit/.test(move));
  const up = sliceBetween(edNC, 'const endHeaderDrag = (e) => {', 'const recenter');
  // ⚠️ 렌더된 pos가 아니라 dragRef의 마지막 계산값 — pointermove의 setState는 pointerup보다 늦게 커밋될 수 있다.
  ok('#G177j 놓을 때 마지막 계산값을 보드에 알린다', /if \(d\.last\) onPosCommit\?\.\(d\.last\);/.test(up));
  ok('#G177k 제목 줄에 드래그 핸들러를 실제로 단다',
    /onPointerDown=\{onHeaderPointerDown\}/.test(edNC) && /onPointerMove=\{onHeaderPointerMove\}/.test(edNC) && /onPointerUp=\{endHeaderDrag\}/.test(edNC));
  ok('#G177l 창 크기가 바뀌면 다시 묶는다', /window\.addEventListener\('resize', reclamp\)/.test(edNC));
  ok('#G177m 로컬 위치는 보드 값에서 시작한다(다른 도형을 열어도 옮긴 자리 유지)', /const \[pos, setPos\] = useState\(initialPos\);/.test(edNC));
  ok('#G178 FlowBoard: 위치를 보드가 들고 팝업에 넘긴다', /initialPos=\{editorPos\}/.test(boardNC) && /onPosCommit=\{setEditorPos\}/.test(boardNC));
  // ⚠️ 사용자 요구: "메모를 열 때는 가운데". 닫힐 때 초기화가 없으면 다음에 열었을 때 옛 자리에 뜬다.
  ok('#G178b FlowBoard: 팝업이 닫히면 위치를 초기화한다', /useEffect\(\(\) => \{ if \(!editor\) setEditorPos\(null\); \}, \[editor\]\);/.test(boardNC));
  ok('#G178c flowMap.ts: 팝업 위치를 저장 필드로 만들지 않았다(세션 로컬)', !/editorPos|initialPos/.test(mod));
}
{
  const rowBlk = sliceBetween(edNC, ') : rows.map((r, i) => {', '{auto ? (');
  const labelAt = rowBlk.indexOf("placeholder={isRule ? '─────' : '항목 이름'}");
  ok('#G179 FlowNodeEditor: 실행 체크가 항목 이름 오른쪽에 있다', labelAt > 0 && rowBlk.indexOf('type="checkbox"') > labelAt);
  ok('#G179b 실행 체크는 항목 행에서만', /const isItem = r\.kind === 'item';/.test(rowBlk) && /\{isItem \? \(\s*<input\s+type="checkbox"/.test(rowBlk));
  // ⚠️ 체크박스에는 blur가 없어 커밋하지 않으면 닫을 때 언마운트 flush에만 기대게 된다.
  ok('#G179c 실행 체크는 즉시 커밋', /onChange=\{e => setRow\(i, \{ done: e\.target\.checked \}, true\)\}/.test(rowBlk));
  ok('#G179d 체크 상태는 === true로 읽는다', /checked=\{r\.done === true\}/.test(rowBlk));
  ok('#G179e 취소선·기울임 토글이 즉시 커밋', /setRow\(i, \{ strike: !strikeOn \}, true\)/.test(rowBlk) && /setRow\(i, \{ italic: !italicOn \}, true\)/.test(rowBlk));
  ok('#G179f 항목 이름 칸이 고른 서식을 그대로 보여 준다',
    /\$\{strikeOn && !isRule \? 'line-through' : ''\} \$\{italicOn && !isRule \? 'italic' : ''\}/.test(rowBlk));
  ok('#G179g 구분선에서는 서식 버튼을 잠근다', (rowBlk.match(/disabled=\{readOnly \|\| isRule\}/g) || []).length === 2);
  ok('#G179h 팝업의 실행 현황은 공유 함수로 센다',
    /const checks = flowTableCheckStats\(tbl\);/.test(edNC) && /실행 \{checks\.done\}\/\{checks\.total\}/.test(edNC));
}
{
  const tb = sliceBetween(canvasNC, '{tableRows.map((r, i) => (', '{v.dangling && (');
  ok('#G180 FlowCanvas: 항목 이름에 취소선·기울임을 그린다', /\$\{r\.strike \? 'line-through' : ''\} \$\{r\.italic \? 'italic' : ''\}/.test(tb));
  // ⚠️ 체크한 적 없는 표까지 빈 칸을 그리면 기존 흐름도의 모양이 배포만으로 바뀐다.
  ok('#G180b FlowCanvas: 체크 칸은 한 항목이라도 체크한 표에서만',
    /const showChecks = raw\.table \? flowTableCheckStats\(raw\.table\)\.done > 0 : false;/.test(canvasNC) && /\{showChecks && r\.kind === 'item' && \(/.test(tb));
  const lab = tb.indexOf('{r.label}');
  const chk = tb.indexOf('{showChecks');
  ok('#G180c FlowCanvas: 체크 칸이 항목 이름 오른쪽 · 값 왼쪽', lab > 0 && chk > lab && tb.indexOf('>{r.text}</span>') > chk);
  // ⚠️ 원본 행을 인덱스로 다시 읽으면 손상 행을 건너뛴 computeFlowTable과 인덱스가 어긋난다.
  ok('#G180d FlowCanvas: 체크 표시는 계산 결과의 done을 따른다', /\{r\.done && \(/.test(tb) && !/raw\.table\.rows\[/.test(canvasNC));
  ok('#G180e FlowCanvas: 체크 칸 색은 글자색을 따른다(밝은 채우기에서도 보이게)',
    /border: '1px solid currentColor'/.test(tb) && /stroke="currentColor"/.test(tb));
}
ok('#G181 FlowInspector: 실행 현황을 공유 함수로 센다(렌더 스코프)',
  /const tableChecks = flowTableCheckStats\(node\?\.table\);/.test(inspNC) && /실행 \{tableChecks\.done\}\/\{tableChecks\.total\}/.test(inspNC));

console.log('\n■ 소스 텍스트 가드 — 연결 위치(fromSide/toSide) 배선');
{
  const sc2 = sliceBetween(inspNC, 'const SIDE_CHOICES = [', '];');
  ok('#G160 FlowInspector: 연결 위치 선택지가 5개(자동 + 4방위)', (sc2.match(/\{ k: '/g) || []).length === 5);
  ok('#G160b FlowInspector: 자동은 빈 값(저장하지 않는다)', /\{ k: '',\s+t: '자동'/.test(sc2));
}
// ⚠️ 'auto'를 저장하면 결과는 같은데 지문만 달라져 아무것도 안 고친 세션에서 저장이 나간다.
ok('#G161 FlowInspector: 자동을 고르면 필드를 지운다',
  /patchEdge\(\{ fromSide: k \|\| undefined \}\)/.test(inspNC) && /patchEdge\(\{ toSide: k \|\| undefined \}\)/.test(inspNC));
ok('#G161b FlowInspector: 현재값을 공유 정규화로 읽는다(손상값이 선택된 것처럼 보이지 않게)',
  /\(normalizeFlowSide\(edge\.fromSide\) \|\| ''\) === k/.test(inspNC)
  && /\(normalizeFlowSide\(edge\.toSide\) \|\| ''\) === k/.test(inspNC));
ok('#G161c FlowInspector: 선택지를 실제로 렌더한다(양 끝 모두)', (inspNC.match(/SIDE_CHOICES\.map\(/g) || []).length === 2);

// ───────── 파트③ 실모듈 드리프트 가드 ─────────
// ⚠️ 위 파트① 미러 테스트는 **미러만** 검사한다 — src/flowMap.ts 에만(또는 미러에만) 반영한
//    변경은 전부 통과한다(실측: 시트 조작 5종의 변이가 미러 테스트를 그대로 뚫었다).
//    실제 모듈을 로드해 같은 픽스처를 돌리고 결과를 대조해 그 구멍을 막는다.
//    (Node 22.6+ 타입 스트리핑 필요. 지원하지 않는 런타임에서는 명시적으로 건너뛴다.)
console.log('\n■ 실모듈 드리프트 가드 (src/flowMap.ts ↔ 미러)');
await (async () => {
  const canStrip = typeof process.features?.typescript === 'string';
  if (!canStrip) {
    console.log('  – #95 실모듈 드리프트 가드: 이 런타임은 .ts 스트리핑을 지원하지 않아 건너뜁니다');
    return;
  }
  let real = null;
  try {
    const os = await import('node:os');
    const { mkdtempSync, copyFileSync, writeFileSync } = await import('node:fs');
    const { pathToFileURL } = await import('node:url');
    const dir = mkdtempSync(join(os.tmpdir(), 'flowdrift-'));
    copyFileSync(join(ROOT, 'src/utils.ts'), join(dir, 'utils.ts'));
    writeFileSync(join(dir, 'flowMap.ts'),
      readFileSync(join(ROOT, 'src/flowMap.ts'), 'utf8').replace(/from '\.\/utils'/g, "from './utils.ts'"));
    real = await import(pathToFileURL(join(dir, 'flowMap.ts')).href);
  } catch (e) {
    ok(`#95 실모듈 로드 실패 — ${String(e && e.message).slice(0, 140)}`, false);
    return;
  }

  // 생성 id 는 양쪽이 다르므로(실모듈은 난수) **등장 순서 토큰**으로 정규화해 비교한다.
  // ⚠️ 위치 기반으로 뭉개면 안 된다 — '사본이 원본 노드 id 를 그대로 쓰는' 얕은 복사 회귀가
  //    정규화에 지워져 죽은 단언이 된다. 같은 문자열은 같은 토큰이어야 그 관계가 드러난다.
  const norm = (list) => {
    const m = new Map();
    const t = (v) => {
      if (typeof v !== 'string') return v;
      if (!m.has(v)) m.set(v, `#${m.size}`);
      return m.get(v);
    };
    return JSON.stringify((list || []).map(x => ({
      id: t(x.id), name: x.name, vp: x.viewport ?? null,
      // ⚠️ 새 map 레벨 필드를 이 투영에 넣지 않으면 드리프트 가드가 그 필드에 **눈이 먼다**
      //    (src에서 화이트리스트 push를 빼도 통과 = 죽은 단언).
      nb: x.bundleEdges ?? null,
      nodes: (x.nodes || []).map(n => [t(n.id), n.x, n.y, n.label, n.table ?? null]),
      edges: (x.edges || []).map(e => [t(e.id), t(e.from), t(e.to), e.label, e.fromSide ?? '', e.toSide ?? '']),
    })));
  };

  const one = [cleanMap({ id: 'm1', name: '계획 A', viewport: { x: 5, y: 6, scale: 1.5 } })];
  const two = [cleanMap({ id: 'm1', name: 'A' }), cleanMap({ id: 'm2', name: 'B' })];
  const three = [cleanMap({ id: 'm1' }), cleanMap({ id: 'm2' }), cleanMap({ id: 'm3' })];
  const full = Array.from({ length: MAX_FLOW_MAPS }, (_, i) => cleanMap({ id: `m${i}`, name: `s${i}` }));

  eq('#95 상한 상수가 실모듈과 일치', real.MAX_FLOW_MAPS, MAX_FLOW_MAPS);
  eq('#95b 이름 상한도 일치', real.MAX_FLOW_MAP_NAME, MAX_FLOW_MAP_NAME);
  eq('#96 addFlowMap 결과 일치', norm(real.addFlowMap(one)), norm(addFlowMap(one)));
  ok('#96b addFlowMap 상한 초과 시 원본 참조(실모듈)', real.addFlowMap(full) === full);
  // ⚠️ 이 한 줄이 '사본의 연결선이 다음 로드에서 통째로 사라지는' 회귀의 유일한 실모듈 방어선이다.
  eq('#97 duplicateFlowMap 결과 일치(노드 id 재매핑 포함)',
    norm(real.duplicateFlowMap(one, 'm1')), norm(duplicateFlowMap(one, 'm1')));
  eq('#97b duplicateFlowMap 이름 충돌 처리 일치',
    norm(real.duplicateFlowMap([cleanMap({ id: 'm1', name: 'A' }), cleanMap({ id: 'm2', name: 'A 복사' })], 'm1')),
    norm(duplicateFlowMap([cleanMap({ id: 'm1', name: 'A' }), cleanMap({ id: 'm2', name: 'A 복사' })], 'm1')));
  eq('#98 removeFlowMap 결과 일치', norm(real.removeFlowMap(two, 'm1')), norm(removeFlowMap(two, 'm1')));
  ok('#98b 마지막 한 장은 실모듈도 지우지 않는다(원본 참조)', real.removeFlowMap(one, 'm1') === one);
  eq('#99 renameFlowMap 결과 일치', norm(real.renameFlowMap(two, 'm1', ' 2026 계획 ')), norm(renameFlowMap(two, 'm1', ' 2026 계획 ')));
  ok('#99b 빈 이름은 실모듈도 거부(원본 참조)', real.renameFlowMap(two, 'm1', '   ') === two);
  eq('#100 moveFlowMap 결과 일치', norm(real.moveFlowMap(three, 'm1', 1)), norm(moveFlowMap(three, 'm1', 1)));
  ok('#100b 경계 밖 이동은 실모듈도 원본 참조',
    real.moveFlowMap(three, 'm1', -1) === three && real.moveFlowMap(three, 'm3', 1) === three);
  eq('#101 nextFlowMapName 일치', real.nextFlowMapName([cleanMap({ name: '시트 1' })]), nextFlowMapName([cleanMap({ name: '시트 1' })]));
  eq('#102 normalizeFlowMaps 결과 일치(다중 시트)', norm(real.normalizeFlowMaps(three)), norm(normalizeFlowMaps(three)));
  eq('#102b flowFingerprint 일치', real.flowFingerprint(three), flowFingerprint(three));

  // ── 1단계 신규 순수 함수 (⚠️ 파트①은 **미러만** 본다 — src만 고친 변경은 여기서만 잡힌다) ──
  eq('#130 번들 상수가 실모듈과 일치',
    [real.FLOW_TRUNK_RATIO, real.FLOW_TRUNK_MAX, real.FLOW_TRUNK_MIN].join(','),
    [FLOW_TRUNK_RATIO, FLOW_TRUNK_MAX, FLOW_TRUNK_MIN].join(','));
  eq('#130b 스냅·라벨 상수가 실모듈과 일치',
    [real.SNAP_TOL_PX, real.SNAP_GUIDE_MAX_REFS, real.FLOW_LABEL_FONT, real.FLOW_LABEL_H, real.FLOW_LABEL_PAD, real.FLOW_LABEL_DOT_R].join(','),
    [SNAP_TOL_PX, SNAP_GUIDE_MAX_REFS, FLOW_LABEL_FONT, FLOW_LABEL_H, FLOW_LABEL_PAD, FLOW_LABEL_DOT_R].join(','));

  {
    // ⚠️ 픽스처는 **재구축 경로(mapChanged=true)를 강제**해야 한다. 정규형이면 원본 참조라
    //    화이트리스트에서 bundleEdges를 빼도 살아남아 이 가드가 죽은 단언이 된다.
    const off = [cleanMap({ id: 'm1', name: 123, bundleEdges: false })];
    eq('#131 normalizeFlowMaps — 번들 토글 재구축 경로 일치', norm(real.normalizeFlowMaps(off)), norm(normalizeFlowMaps(off)));
    eq('#131b 실모듈도 재구축 경로에서 토글을 보존', real.normalizeFlowMaps(off)[0].bundleEdges, false);
    const onRaw = [cleanMap({ id: 'm1', bundleEdges: true })];
    eq('#131c true는 실모듈에서도 생략형', 'bundleEdges' in real.normalizeFlowMaps(onRaw)[0], false);
    const sideRaw = [cleanMap({ id: 'm1', edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', fromSide: 'zzz', toSide: 'r' }] })];
    eq('#131d 연결 위치 정규화 일치', norm(real.normalizeFlowMaps(sideRaw)), norm(normalizeFlowMaps(sideRaw)));
    eq('#131e 실모듈도 손상 side를 제거', 'fromSide' in real.normalizeFlowMaps(sideRaw)[0].edges[0], false);
    eq('#132 지문 일치(토글 끔)', real.flowFingerprint(off), flowFingerprint(off));
    ok('#132b 실모듈 지문도 토글에 반응',
      real.flowFingerprint([cleanMap({ id: 'm1' })]) !== real.flowFingerprint([cleanMap({ id: 'm1', bundleEdges: false })]));
    eq('#132c flowBundleEnabled 일치',
      [real.flowBundleEnabled(undefined), real.flowBundleEnabled(false), real.flowBundleEnabled(true), real.flowBundleEnabled('x')].join(','),
      [flowBundleEnabled(undefined), flowBundleEnabled(false), flowBundleEnabled(true), flowBundleEnabled('x')].join(','));
    eq('#132d normalizeFlowSide 일치',
      JSON.stringify(['l', 'r', 't', 'b', 'auto', 'zz', null, 7].map(v => real.normalizeFlowSide(v) ?? '·')),
      JSON.stringify(['l', 'r', 't', 'b', 'auto', 'zz', null, 7].map(v => normalizeFlowSide(v) ?? '·')));
  }

  {
    // 무작위 대조 — 한 픽스처로는 분기(그룹 갈림·상한·하한·역할 충돌)를 다 밟지 못한다.
    let s2 = 424242;
    const rr = () => { s2 = (s2 * 1103515245 + 12345) % 2147483648; return s2 / 2147483648; };
    const STROKES = [undefined, '#70AD47', '#DC2626'];
    const ARROWS = ['to', 'from', 'both', 'none'];
    const STYLES = [undefined, 'dash', 'double'];
    let bad = 0, badDrag = 0, badLabel = 0;
    for (let i = 0; i < 400; i++) {
      const cnt = 2 + Math.floor(rr() * 5);
      const nodes = [];
      for (let k = 0; k < cnt; k++) {
        nodes.push({
          id: 'n' + k, kind: 'rect',
          x: Math.round((rr() - 0.5) * 1600), y: Math.round((rr() - 0.5) * 1600),
          w: 60 + Math.round(rr() * 300), h: 44 + Math.round(rr() * 200),
          label: '', date: '', amountManual: null, memo: '', portfolioId: null, accountNameSnapshot: '', amountSource: 'none',
        });
      }
      const edges = [];
      for (let k = 0; k < cnt + 2; k++) {
        const a = nodes[Math.floor(rr() * nodes.length)].id;
        const b = nodes[Math.floor(rr() * nodes.length)].id;
        edges.push({
          id: 'e' + k, from: a, to: b, label: '',
          arrow: ARROWS[Math.floor(rr() * ARROWS.length)],
          ...(STROKES[Math.floor(rr() * STROKES.length)] ? { stroke: STROKES[Math.floor(rr() * STROKES.length)] } : {}),
          ...(STYLES[Math.floor(rr() * STYLES.length)] ? { lineStyle: STYLES[Math.floor(rr() * STYLES.length)] } : {}),
        });
      }
      if (JSON.stringify(real.buildFlowBundles(nodes, edges, true)) !== JSON.stringify(buildFlowBundles(nodes, edges, true))) bad++;
      // edgePath는 번들 인자까지 함께 대조한다(양 끝 트렁크 조합이 전부 나온다).
      const bd = buildFlowBundles(nodes, edges, true);
      for (const e of edges) {
        const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
        if (JSON.stringify(real.edgePath(a, b, e, bd.byEdge[e.id])) !== JSON.stringify(edgePath(a, b, e, bd.byEdge[e.id]))) bad++;
      }
      const base = { x: Math.round((rr() - 0.5) * 800), y: Math.round((rr() - 0.5) * 800), w: 60 + Math.round(rr() * 300), h: 44 + Math.round(rr() * 200) };
      const dx = Math.round((rr() - 0.5) * 2000), dy = Math.round((rr() - 0.5) * 2000);
      const tolR = snapTolerance([0.25, 1, 2.5][Math.floor(rr() * 3)]);
      if (JSON.stringify(real.resolveNodeDrag(base, dx, dy, nodes, tolR, true)) !== JSON.stringify(resolveNodeDrag(base, dx, dy, nodes, tolR, true))) badDrag++;
      const items = edges.slice(0, 4).map((e, k) => ({ id: e.id, cx: Math.round((rr() - 0.5) * 600), cy: Math.round((rr() - 0.5) * 600), w: 40 + k * 30, h: 22 }));
      const walls = nodes.map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
      if (JSON.stringify(real.layoutFlowLabels(items, walls)) !== JSON.stringify(layoutFlowLabels(items, walls))) badLabel++;
    }
    eq('#133 buildFlowBundles + edgePath(번들) 무작위 400세트 일치', bad, 0);
    eq('#133b resolveNodeDrag 무작위 400세트 일치', badDrag, 0);
    {
      // ⚠️ 무작위 픽스처는 특정 분기를 **밟지 않을 수 있다**(실측: 아래 세 계약이 전부 무작위
      //    400세트를 통과했다). 파트①은 미러만 보므로 src만 고친 변경은 여기서만 잡힌다 →
      //    분기마다 **결정적 픽스처**를 따로 둔다.
      const dn = (id, x, y, w = 180, h = 120) => ({ id, kind: 'rect', x, y, w, h, label: '', date: '', amountManual: null, memo: '', portfolioId: null, accountNameSnapshot: '', amountSource: 'none' });
      const de = (id, from, to, o = {}) => ({ id, from, to, label: '', arrow: 'to', ...o });
      // (1) 같은 (도형,변)에 나가는 뭉치 + 들어오는 뭉치 → 트렁크는 하나만 남아야 한다
      const bothN = [dn('h', 0, 300), dn('a', 600, 0), dn('b', 600, 200), dn('c', 600, 400), dn('d', 600, 600)];
      const bothE = [de('o1', 'h', 'a'), de('o2', 'h', 'b'), de('o3', 'h', 'c'), de('i1', 'd', 'h'), de('i2', 'a', 'h')];
      eq('#134 같은 변의 나가는/들어오는 뭉치 처리 일치',
        JSON.stringify(real.buildFlowBundles(bothN, bothE, true)), JSON.stringify(buildFlowBundles(bothN, bothE, true)));
      eq('#134b 실모듈도 (도형,변)당 트렁크 하나', real.buildFlowBundles(bothN, bothE, true).trunks.filter(t => t.key.startsWith(String.raw`["h","r"`)).length, 1);
      // (2) 한 구성원만 반대편(proj<=0) — 그 선만 빠지고 나머지는 뭉친다
      const backN = [dn('h', 600, 300), dn('f1', 1200, 200), dn('f2', 1200, 400), dn('bk', 0, 300)];
      const backE = [de('x1', 'h', 'f1'), de('x2', 'h', 'f2'), de('x3', 'h', 'bk', { fromSide: 'r', toSide: 'r' })];
      eq('#134c 반대편으로 향하는 구성원 처리 일치',
        JSON.stringify(real.buildFlowBundles(backN, backE, true)), JSON.stringify(buildFlowBundles(backN, backE, true)));
      ok('#134d 그 선만 빠지고 나머지는 뭉친다',
        JSON.stringify(buildFlowBundles(backN, backE, true).trunks.map(t => t.edgeIds)) === JSON.stringify([['x1', 'x2']]));
      // (3) 자기 자신으로 가는 선
      const selfN = [dn('s', 0, 0)];
      const selfE = [de('s1', 's', 's'), de('s2', 's', 's')];
      eq('#134e self edge 처리 일치',
        JSON.stringify(real.buildFlowBundles(selfN, selfE, true)), JSON.stringify(buildFlowBundles(selfN, selfE, true)));
      // (4) 스냅 OFF — 무작위 대조는 enabled=true 로만 돌아 이 분기를 밟지 않는다
      const sBase = { x: 0, y: 0, w: 180, h: 120 };
      const sPeers = [dn('p', 600, 100, 262)];
      const sTol = snapTolerance(1);
      eq('#134f 스냅 OFF 경로 일치',
        JSON.stringify(real.resolveNodeDrag(sBase, 602, 402, sPeers, sTol, false)),
        JSON.stringify(resolveNodeDrag(sBase, 602, 402, sPeers, sTol, false)));
      ok('#134g 실모듈의 OFF는 종전 동작(미리보기 raw)', real.resolveNodeDrag(sBase, 602, 402, sPeers, sTol, false).preview.x === 602);
      ok('#134h 픽스처가 유효하다(ON이면 실제로 붙는다)', real.resolveNodeDrag(sBase, 602, 402, sPeers, sTol, true).preview.x === 600);
      // (5) 라벨이 전부 막혀 점으로 접히는 경로
      const wall = [{ x: -400, y: -400, w: 1000, h: 1000 }];
      const lItems = [{ id: 'a', cx: 100, cy: 100, w: 80, h: 22 }];
      eq('#134i 점 강등 경로 일치',
        JSON.stringify(real.layoutFlowLabels(lItems, wall)), JSON.stringify(layoutFlowLabels(lItems, wall)));

      // (6) 도형 안 표 — 값 파싱·계산·정규화·붙여넣기
      const R = (kind, label, value = '') => ({ kind, label, value });
      const tbl = {
        border: 'all',
        rows: [
          R('total', '총액', '360,000,000'), R('item', 'a', '30,000,000'), R('item', 'b', '90,000,000'),
          R('subtotal', '소계'), R('rule', ''), R('item', 'c', '130,000,000'), R('subtotal', '소계'),
          R('rule', ''), R('item', 'd', '58,000,000'), R('balance', '잔액'), R('item', 'memo', '약 3억'),
        ],
      };
      eq('#135 computeFlowTable 일치', JSON.stringify(real.computeFlowTable(tbl)), JSON.stringify(computeFlowTable(tbl)));
      eq('#135b 값 파싱 일치',
        JSON.stringify(['30,000,000', '', '0', '약 3억', '-1.5', '₩900', '12x34', '0x1A', '1e5', '.5'].map(v => real.parseFlowNumber(v))),
        JSON.stringify(['30,000,000', '', '0', '약 3억', '-1.5', '₩900', '12x34', '0x1A', '1e5', '.5'].map(v => parseFlowNumber(v))));
      eq('#135c 숫자 포맷 일치',
        JSON.stringify([0, -1500, 30000000, 1234.5].map(v => real.formatFlowNumber(v))),
        JSON.stringify([0, -1500, 30000000, 1234.5].map(v => formatFlowNumber(v))));
      eq('#135d normalizeFlowTable 일치(손상값·상한 포함)',
        JSON.stringify(real.normalizeFlowTable({ rows: [{ kind: 'zzz', label: 'x'.repeat(200), value: '1' }, R('rule', 'a', '9')], border: 'bad' })),
        JSON.stringify(normalizeFlowTable({ rows: [{ kind: 'zzz', label: 'x'.repeat(200), value: '1' }, R('rule', 'a', '9')], border: 'bad' })));
      eq('#135e 빈 표는 양쪽 모두 undefined',
        String(real.normalizeFlowTable({ rows: [] })), String(normalizeFlowTable({ rows: [] })));
      eq('#135f sameFlowTable 일치',
        JSON.stringify([[tbl, tbl], [tbl, { ...tbl, border: 'none' }], [undefined, undefined], [tbl, undefined]].map(([a2, b2]) => real.sameFlowTable(a2, b2))),
        JSON.stringify([[tbl, tbl], [tbl, { ...tbl, border: 'none' }], [undefined, undefined], [tbl, undefined]].map(([a2, b2]) => sameFlowTable(a2, b2))));
      eq('#135g flowTableFromText 일치',
        JSON.stringify(real.flowTableFromText('자동차\t30,000,000\n-----\n마통   90,000,000\n\n메모만')),
        JSON.stringify(flowTableFromText('자동차\t30,000,000\n-----\n마통   90,000,000\n\n메모만')));
      // ⚠️ 재구축 경로 — 화이트리스트에서 표를 빼면 여기서만 잡힌다(정규형이면 원본 참조라 살아남는다).
      const nodeT = { id: 'n1', kind: 'rect', x: 0, y: 0, w: 180, h: 120, label: '', date: '', amountManual: null, memo: '', portfolioId: null, accountNameSnapshot: '', amountSource: 'none', table: { rows: [R('item', 'a', '1')], border: 'all' } };
      const forcedT = [cleanMap({ id: 'm1', name: 123, nodes: [nodeT], edges: [] })];
      eq('#135h 표를 든 노드의 재구축 경로 일치', norm(real.normalizeFlowMaps(forcedT)), norm(normalizeFlowMaps(forcedT)));
      eq('#135i 실모듈도 재구축에서 표를 보존', real.normalizeFlowMaps(forcedT)[0]?.nodes?.[0]?.table?.rows?.[0]?.label, 'a');
      eq('#135j 표 지문 일치', real.flowFingerprint(forcedT), flowFingerprint(forcedT));
      {
        // ⚠️ 노드 비교에서 표를 빼면 손상된 표가 교정되지 않고 남는다(다른 필드가 정규형이면
        //    mapChanged가 서지 않아 원본 노드가 그대로 push된다). 정규형 픽스처로는 안 잡힌다.
        const dirtyT = [cleanMap({ id: 'm1', nodes: [{ ...nodeT, table: { rows: Array.from({ length: MAX_FLOW_TABLE_ROWS + 20 }, () => R('item', 'a', '1')), border: 'bad' } }], edges: [] })];
        eq('#135s 손상된 표의 교정 결과 일치', norm(real.normalizeFlowMaps(dirtyT)), norm(normalizeFlowMaps(dirtyT)));
        eq('#135t 실모듈도 손상된 표를 교정한다', real.normalizeFlowMaps(dirtyT)[0]?.nodes?.[0]?.table?.rows?.length, MAX_FLOW_TABLE_ROWS);
      }
      ok('#135k 실모듈 지문도 표 값에 반응',
        real.flowFingerprint(forcedT) !== real.flowFingerprint([cleanMap({ id: 'm1', name: 123, nodes: [{ ...nodeT, table: { rows: [R('item', 'a', '2')], border: 'all' } }], edges: [] })]));
      eq('#135l 상한 상수 일치',
        [real.MAX_FLOW_TABLE_ROWS, real.MAX_FLOW_TABLE_TEXT].join(','), [MAX_FLOW_TABLE_ROWS, MAX_FLOW_TABLE_TEXT].join(','));
      // ⚠️ 행 종류 목록이 갈리면 asRowKind가 조용히 'item'으로 떨어뜨려 사용자가 고른 종류가
      //    저장에서 사라진다. 위 픽스처들은 그 목록을 밟지 않으므로 여기서 직접 대조한다.
      eq('#135m 행 종류·선 표시 목록 일치',
        JSON.stringify([real.FLOW_TABLE_ROW_KINDS, real.FLOW_TABLE_BORDERS]),
        JSON.stringify([FLOW_TABLE_ROW_KINDS, FLOW_TABLE_BORDERS]));
      eq('#135n 모든 행 종류가 정규화를 통과한다',
        JSON.stringify(real.normalizeFlowTable({ rows: FLOW_TABLE_ROW_KINDS.map(k => R(k, k, '1')) })),
        JSON.stringify(normalizeFlowTable({ rows: FLOW_TABLE_ROW_KINDS.map(k => R(k, k, '1')) })));
      // ⚠️ 상한을 밟는 픽스처가 없으면 `break` 한 줄을 지워도 드리프트 가드가 통과한다(실측).
      eq('#135o 행 상한 절단 일치',
        real.normalizeFlowTable({ rows: Array.from({ length: MAX_FLOW_TABLE_ROWS + 25 }, () => R('item', 'a', '1')) }).rows.length,
        normalizeFlowTable({ rows: Array.from({ length: MAX_FLOW_TABLE_ROWS + 25 }, () => R('item', 'a', '1')) }).rows.length);
      eq('#135p 붙여넣기 행 상한 일치',
        real.flowTableFromText(Array.from({ length: MAX_FLOW_TABLE_ROWS + 25 }, (_, i) => `a${i}\t1`).join('\n')).length,
        flowTableFromText(Array.from({ length: MAX_FLOW_TABLE_ROWS + 25 }, (_, i) => `a${i}\t1`).join('\n')).length);
      // ⚠️ **내용은 같은데 참조가 다른** 짝이 없으면 sameFlowTable을 참조 비교로 바꿔도 통과한다(실측).
      {
        const t1 = { border: 'all', rows: [R('item', 'a', '1'), R('rule', ''), R('subtotal', 's')] };
        const t2 = JSON.parse(JSON.stringify(t1));
        eq('#135q 내용 같고 참조 다른 표를 같다고 본다',
          String(real.sameFlowTable(t1, t2)), String(sameFlowTable(t1, t2)));
        ok('#135r 실모듈도 참조가 아니라 내용으로 판정한다', real.sameFlowTable(t1, t2) === true);
      }

      // (7) 실행 체크·취소선·기울임 + 팝업 위치 클램프.
      // ⚠️ 손상값·항목 외 행·구분선·false 명시·재구축 경로를 **결정적으로** 밟는다 — 정규형 픽스처만 두면
      //    src에서 `kind === 'item'` 게이트나 `=== true` 판정을 지워도 통과한다(파트①은 미러만 본다).
      {
        const F = (kind, label, value, o) => ({ kind, label, value, ...o });
        const flagRows = [
          F('item', 'a', '1', { done: true, strike: true, italic: true }),
          F('item', 'b', '2', { done: 'yes', strike: 1 }),
          F('total', 't', '9', { done: true, italic: true }),
          F('subtotal', 's', '', { strike: true, done: true }),
          F('rule', 'x', '', { strike: true, italic: true, done: true }),
          F('balance', 'z', '', { italic: true }),
          F('item', 'c', '3', { done: false, strike: false }),
        ];
        eq('#136 normalizeFlowTable 표시 정규화 일치',
          JSON.stringify(real.normalizeFlowTable({ rows: flagRows, border: 'all' })), JSON.stringify(normalizeFlowTable({ rows: flagRows, border: 'all' })));
        eq('#136b computeFlowTable 표시 전달 일치',
          JSON.stringify(real.computeFlowTable({ rows: flagRows })), JSON.stringify(computeFlowTable({ rows: flagRows })));
        eq('#136c flowTableCheckStats 일치',
          JSON.stringify(real.flowTableCheckStats({ rows: flagRows })), JSON.stringify(flowTableCheckStats({ rows: flagRows })));
        eq('#136d flowTableRowFlags 일치',
          JSON.stringify(flagRows.map(r => real.flowTableRowFlags(r))), JSON.stringify(flagRows.map(r => flowTableRowFlags(r))));
        const pairs = [[{ done: true }, {}], [{ strike: true }, {}], [{ italic: true }, {}], [{ done: 'yes' }, {}], [{ done: true, italic: true }, { done: true, italic: true }]];
        const pairTbl = (o) => ({ border: 'none', rows: [F('item', 'a', '1', o)] });
        eq('#136e sameFlowTable 표시 비교 일치',
          JSON.stringify(pairs.map(([p, q]) => real.sameFlowTable(pairTbl(p), pairTbl(q)))),
          JSON.stringify(pairs.map(([p, q]) => sameFlowTable(pairTbl(p), pairTbl(q)))));
        ok('#136f 실모듈도 표시만 다른 표를 다르다고 본다',
          real.sameFlowTable(pairTbl({ strike: true }), pairTbl({})) === false && real.sameFlowTable(pairTbl({ done: true }), pairTbl({})) === false);
        const forcedF = [cleanMap({ id: 'm1', name: 123, nodes: [{ ...nodeT, table: { rows: flagRows, border: 'none' } }], edges: [] })];
        eq('#136g 표시를 든 표의 재구축 경로 일치', norm(real.normalizeFlowMaps(forcedF)), norm(normalizeFlowMaps(forcedF)));
        const cleanF = [cleanMap({ id: 'm1', nodes: [{ ...nodeT, table: real.normalizeFlowTable({ rows: flagRows, border: 'none' }) }], edges: [] })];
        ok('#136h 실모듈도 표시만 있는 정규형 표는 원본 참조', real.normalizeFlowMaps(cleanF) === cleanF);
        const dirtyF = [cleanMap({ id: 'm1', nodes: [{ ...nodeT, table: { rows: [F('item', 'a', '1', { done: 'yes' })], border: 'all' } }], edges: [] })];
        eq('#136i 실모듈도 손상된 표시를 교정한다',
          JSON.stringify(real.normalizeFlowMaps(dirtyF)[0]?.nodes?.[0]?.table?.rows?.[0]), JSON.stringify({ kind: 'item', label: 'a', value: '1' }));
        eq('#136j 표시 지문 일치', real.flowFingerprint(forcedF), flowFingerprint(forcedF));
        eq('#136k 실모듈 지문: 표시 없는 행은 종전 3칸',
          JSON.parse(real.flowFingerprint([cleanMap({ id: 'm1', nodes: [nodeT], edges: [] })]))[0]?.nd?.[0]?.slice(-1)?.[0]?.[1]?.[0]?.length, 3);
        const fpDone = (o) => real.flowFingerprint([cleanMap({ id: 'm1', nodes: [{ ...nodeT, table: pairTbl(o) }], edges: [] })]);
        ok('#136l 실모듈 지문도 체크·취소선·기울임에 각각 반응',
          fpDone({}) !== fpDone({ done: true }) && fpDone({}) !== fpDone({ strike: true }) && fpDone({}) !== fpDone({ italic: true }));
        const clampCases = [
          [300.4, 200.6, 680, 1440, 900], [5000, 100, 680, 1440, 900], [-5000, 100, 680, 1440, 900],
          [100, -300, 680, 1440, 900], [100, 5000, 680, 1440, 900], [50, 50, 680, 80, 30], [NaN, Infinity, 680, 1440, 900],
          [10, 10, NaN, 'x', null], [0, 0, 100, 100, 100],
        ];
        eq('#136m clampFlowEditorPos 일치',
          JSON.stringify(clampCases.map(a => real.clampFlowEditorPos(...a))), JSON.stringify(clampCases.map(a => clampFlowEditorPos(...a))));
        eq('#136n 팝업 한계 상수 일치',
          [real.FLOW_EDITOR_GRIP_PX, real.FLOW_EDITOR_HEADER_PX].join(','), [FLOW_EDITOR_GRIP_PX, FLOW_EDITOR_HEADER_PX].join(','));
      }
    }
    eq('#133c layoutFlowLabels 무작위 400세트 일치', badLabel, 0);
    eq('#133d approxLabelWidth 일치',
      JSON.stringify(['가나다', 'abc', '1억3천만원 환전 이체', '', 'ｱｲｳ', '漢字'].map(v => real.approxLabelWidth(v))),
      JSON.stringify(['가나다', 'abc', '1억3천만원 환전 이체', '', 'ｱｲｳ', '漢字'].map(v => approxLabelWidth(v))));
    eq('#133e flowLabelSize 일치', JSON.stringify(real.flowLabelSize('환전 이체')), JSON.stringify(flowLabelSize('환전 이체')));
    eq('#133f snapTolerance 일치',
      JSON.stringify([1, 0.25, 2.5, NaN, 0, -1].map(v => real.snapTolerance(v))),
      JSON.stringify([1, 0.25, 2.5, NaN, 0, -1].map(v => snapTolerance(v))));
    const sa = mkNode({ id: 'sa', x: 0, y: 0, w: 100, h: 60 });
    const sb = mkNode({ id: 'sb', x: 400, y: 200, w: 100, h: 60 });
    eq('#133g resolveEdgeSides 일치(그룹 키와 렌더가 공유하는 단일 판정)',
      JSON.stringify([undefined, { fromSide: 'auto', toSide: 'b' }, { fromSide: 't' }].map(e => real.resolveEdgeSides(sa, sb, e))),
      JSON.stringify([undefined, { fromSide: 'auto', toSide: 'b' }, { fromSide: 't' }].map(e => resolveEdgeSides(sa, sb, e))));
  }
})();

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:flow — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
