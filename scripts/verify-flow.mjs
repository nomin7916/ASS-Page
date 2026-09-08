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

const MAX_FLOW_MAPS = 5, MAX_FLOW_NODES = 150, MAX_FLOW_EDGES = 300;
const DEFAULT_NODE_W = 180, DEFAULT_NODE_H = 120, MIN_NODE_W = 60, MIN_NODE_H = 44;
const FLOW_MIN_SCALE = 0.25, FLOW_MAX_SCALE = 2.5;
const DEFAULT_FLOW_VIEWPORT = { x: 80, y: 80, scale: 1 };
const VIEWPORT_XY_LIMIT = 200000;
const DEFAULT_NODE_FILL = '#2E75B6', DEFAULT_EDGE_STROKE = '#60a5fa';

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
        e?.fromSide ?? '', e?.toSide ?? '', e?.stroke ?? '', e?.dashed ? 1 : 0, e?.arrow ?? '',
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
      const arrow = e.arrow === 'both' || e.arrow === 'none' ? e.arrow : 'to';
      const dashed = !!e.dashed;
      const stroke = sanitizeHexColor(e.stroke);
      const strokeChanged = e.stroke === undefined ? stroke !== '' : stroke !== e.stroke;
      if (label !== e.label || arrow !== e.arrow || dashed !== e.dashed || strokeChanged) mapChanged = true;
      edges.push({
        id: eid, from, to, label, arrow, dashed,
        ...(e.fromSide ? { fromSide: e.fromSide } : {}),
        ...(e.toSide ? { toSide: e.toSide } : {}),
        ...(stroke ? { stroke } : {}),
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
  edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', dashed: false }],
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
eq('#8 맵 개수 상한 절단', normalizeFlowMaps(Array.from({ length: 9 }, (_, i) => cleanMap({ id: `m${i}` }))).length, MAX_FLOW_MAPS);

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
  const r = normalizeFlowMaps([cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', dashed: false, stroke: '#C00000' }] })]);
  eq('#47 연결선 색은 보존된다', r[0].edges[0].stroke, '#C00000');
  const bad = normalizeFlowMaps([cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'to', dashed: false, stroke: 'red' }] })]);
  ok('#47b 손상된 선 색은 버려지고(기본색 사용) 변경으로 표시된다', bad[0].edges[0].stroke === undefined);
  const node = mkNode({ id: 'n', fill: 'rgb(1,2,3)' });
  ok('#47c 도형 채우기도 같은 규칙', node.fill === undefined);
  eq('#47d 유효한 채우기는 보존', mkNode({ id: 'n', fill: '#FFC000' }).fill, '#FFC000');
}
{
  // ⚠️ 색만 바꾼 세션도 저장되어야 한다
  const a = [cleanMap()];
  const b = [cleanMap({ edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '이체', arrow: 'to', dashed: false, stroke: '#FF0000' }] })];
  ok('#48 연결선 색 변경을 지문이 감지', flowFingerprint(a) !== flowFingerprint(b));
  const c = [cleanMap({ nodes: [mkNode({ id: 'n1', fill: '#FF0000' }), mkNode({ id: 'n2' })] })];
  ok('#48b 도형 채우기 변경을 지문이 감지', flowFingerprint(a) !== flowFingerprint(c));
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

// 보드를 열 때 저장된 화면으로 복원하는 것이 이 기능의 전부다.
ok('#49 FlowBoard: 보드를 열 때 저장된 화면을 복원', /setViewport\(\s*initialViewportOf\(\s*seeded\[0\]\s*\)\s*\)/.test(boardNC));
ok('#49b FlowBoard: 늦게 도착한 Drive 데이터의 저장 위치도 채택(단, 사용자가 안 움직였을 때만)',
  /if\s*\(\s*!vpTouchedRef\.current\s*\)\s*setViewport\(\s*initialViewportOf\(\s*maps\[0\]\s*\)\s*\)/.test(boardNC));
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
  /stroke=\{color\}/.test(canvasNC) && /markerEnd=\{e\.arrow === 'none' \? undefined : marker\}/.test(canvasNC));
ok('#54e FlowCanvas: 선택된 선을 색과 무관하게 알아볼 수 있다(후광 + 굵기)',
  /edgeSel && \(\s*<path[\s\S]{0,200}strokeOpacity=\{0\.35\}/.test(canvasNC) && /strokeWidth=\{edgeSel \? 3 : 2\}/.test(canvasNC));
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

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:flow — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
