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
      nd: (Array.isArray(m?.nodes) ? m.nodes : []).map(n => [
        n?.id ?? '', n?.kind ?? '', n?.x ?? 0, n?.y ?? 0, n?.w ?? 0, n?.h ?? 0,
        n?.label ?? '', n?.date ?? '', n?.amountManual ?? null, n?.memo ?? '',
        n?.portfolioId ?? null, n?.accountNameSnapshot ?? '', n?.amountSource ?? '',
        n?.fill ?? '', n?.stroke ?? '',
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
        fixed.fill !== n.fill || fixed.stroke !== n.stroke
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
      if (label !== e.label || arrow !== e.arrow || strokeChanged || lineChanged) mapChanged = true;
      edges.push({
        id: eid, from, to, label, arrow,
        ...(e.fromSide ? { fromSide: e.fromSide } : {}),
        ...(e.toSide ? { toSide: e.toSide } : {}),
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

    if (mapChanged) { changed = true; out.push({ id, name, nodes, edges, createdAt, updatedAt, ...(viewport ? { viewport } : {}) }); }
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

function edgePath(a, b, e) {
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
      nodes: (x.nodes || []).map(n => [t(n.id), n.x, n.y, n.label]),
      edges: (x.edges || []).map(e => [t(e.id), t(e.from), t(e.to), e.label]),
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
})();

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:flow — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
