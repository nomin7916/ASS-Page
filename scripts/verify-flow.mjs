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

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const asStr = (v) => (typeof v === 'string' ? v : '');
const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function roundNode(n) {
  const x = Math.round(n.x), y = Math.round(n.y), w = Math.round(n.w), h = Math.round(n.h);
  if (x === n.x && y === n.y && w === n.w && h === n.h) return n;
  return { ...n, x, y, w, h };
}

function makeFlowNode(partial = {}) {
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
    ...(partial.fill ? { fill: partial.fill } : {}),
    ...(partial.stroke ? { stroke: partial.stroke } : {}),
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
        fixed.accountNameSnapshot !== n.accountNameSnapshot || fixed.amountSource !== n.amountSource
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
      if (label !== e.label || arrow !== e.arrow || dashed !== e.dashed) mapChanged = true;
      edges.push({
        id: eid, from, to, label, arrow, dashed,
        ...(e.fromSide ? { fromSide: e.fromSide } : {}),
        ...(e.toSide ? { toSide: e.toSide } : {}),
        ...(e.stroke ? { stroke: asStr(e.stroke) } : {}),
      });
    }

    const createdAt = isFiniteNum(m.createdAt) ? m.createdAt : (mapChanged = true, 1);
    const updatedAt = isFiniteNum(m.updatedAt) ? m.updatedAt : (mapChanged = true, createdAt);
    if (mapChanged) { changed = true; out.push({ id, name, nodes, edges, createdAt, updatedAt }); }
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
ok('#32 App.tsx: 저장 effect deps 에 flowMaps', /watchlistGroups\s*,\s*flowMaps\s*\]\s*\)\s*;/.test(app));
// ⚠️ sticky 판정을 손으로 복제하면 in-memory 와 Drive write 가 갈린다 → 반드시 공유 함수.
ok('#33 App.tsx: applyBackupData sticky 가 flowMapsHaveContent 공유', /flowMapsHaveContent\(/.test(app));
ok('#34 useDriveSync.ts: _preserveStickyPersonalData 가 flowMaps 를 다룬다', /flowMaps/.test(sync) && /flowMapsHaveContent/.test(sync));
ok('#35 flowMap.ts: @ts-nocheck 금지(이 파일의 타입이 유일한 안전망)', !/^\s*\/\/\s*@ts-nocheck/m.test(mod));
// ⚠️ '_' 접두 런타임 필드를 두면 순환 참조로 지문이 죽는다 → 타입에 없어야 한다.
ok('#36 flowMap.ts: FlowNode/FlowEdge 에 _ 접두 필드 없음', !/^\s+_[A-Za-z]\w*\s*[?:]/m.test(mod));

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:flow — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
