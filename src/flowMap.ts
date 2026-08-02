// ─────────────────────────────────────────────────────────────────────────────
// src/flowMap.ts — 자금 흐름도(FlowMap) 타입 + 순수 로직
//
// ⚠️ 이 파일에는 `// @ts-nocheck`를 붙이지 말 것.
//    빌드가 `vite build`(esbuild, 타입체크 없음)라 저장소 대부분이 nocheck인데,
//    nocheck가 없는 소수 파일(utils.ts·api.ts·driveStorage.ts 등)만 에디터 타입검사를
//    받는다. 이 기능에서는 그 타입이 유일한 안전망이다.
//
// ⚠️ React state·DOM 접근 금지 — scripts/verify-flow.mjs가 본문을 미러 복사해
//    테스트한다(verify-fx.mjs·verify-brl-bond.mjs·verify-twr.mjs 선례).
//    아래 함수 본문을 고치면 verify-flow.mjs의 참조 구현도 1:1로 동기화할 것.
//
// ⚠️ FlowNode/FlowEdge에 `_`로 시작하는 런타임 전용 필드(DOM 참조·부모 역참조 등)를
//    두지 말 것. 순환 참조가 생기면 flowFingerprint의 JSON.stringify가 던지고,
//    그 지문 계산은 App.tsx 저장 effect의 첫 블록이라 그 세션의 Drive 저장이
//    통째로 멈춘다(App.tsx의 Array.isArray 가드 주석과 동일 위험).
// ─────────────────────────────────────────────────────────────────────────────

import { generateId } from './utils';

/* ===========================================================================
 * A. 저장되는 타입 (Drive STATE `flowMaps` 필드)
 *    불변식: 여기에는 **사용자가 직접 입력한 값**과 **id 참조**만 들어간다.
 *    계좌명·평가액·계좌타입 등 라이브 파생값은 절대 저장하지 않는다
 *    (CalendarModal의 "복사 금지, 라이브 재조회" 계약과 동일).
 * =========================================================================== */

export type FlowShapeKind = 'rect' | 'ellipse';
export type FlowSide = 'auto' | 'l' | 'r' | 't' | 'b';
export type FlowArrow = 'to' | 'both' | 'none';

/** 노드 금액의 출처. 'account'면 라이브 재조회, 'manual'이면 amountManual 사용. */
export type FlowAmountSource = 'account' | 'manual' | 'none';

export interface FlowNode {
  id: string;
  kind: FlowShapeKind;

  // ── 기하 (커밋 시 roundNode로 정수화) ──
  x: number;
  y: number;
  w: number;
  h: number;

  // ── 사용자 직접 입력 필드 ──
  /** 도형 이름. 비우면 연결 계좌명이 표시된다(사용자 입력이 항상 우선). */
  label: string;
  /**
   * 'YYYY-MM-DD' 또는 자유 텍스트('27년 5월', '제한 없음' 등). **반드시 사용자 입력**.
   * ⚠️ 계좌 레벨 만기 필드는 코드베이스에 존재하지 않는다 — 유일한 만기는 dc-irp 전용
   *    예적금 항목의 item.endDate이고 한 계좌에 여러 개 존재할 수 있어 단일 자동값으로
   *    성립하지 않는다. 자동 채움 금지, FlowInspector의 '제안'만 허용.
   */
  date: string;
  /** 사용자 직접 입력 금액. null = 미입력. amountSource==='manual'일 때만 표시. */
  amountManual: number | null;
  /** 사용자 메모(여러 줄) */
  memo: string;

  // ── 계좌 연결 = id 참조만 ──
  /** null = 미연결. 값이 있으면 매 렌더 portfolios/portfolioSummaries에서 재조회. */
  portfolioId: string | null;
  /**
   * ⚠️ 표시 폴백 **전용**. purgePortfolio가 캐스케이드 정리 없이 계좌 id를 하드 삭제하므로,
   *    계좌를 못 찾을 때만 쓰는 마지막 이름이다.
   *    **바인딩 시점에만 1회 기록**하고 이후 계좌명이 바뀌어도 갱신하지 않는다
   *    (갱신하면 라이브 값 복사가 되어 지문이 편집과 무관하게 흔들린다).
   */
  accountNameSnapshot: string;
  amountSource: FlowAmountSource;

  // ── 스타일 ──
  /** ⚠️ hex만 사용. `bg-${x}-500` 류 동적 Tailwind 클래스 금지(빌드타임 content 스캔이 못 잡는다). */
  fill?: string;
  stroke?: string;
}

export interface FlowEdge {
  id: string;
  /** FlowNode.id */
  from: string;
  to: string;
  /** 선 위 라벨 (사용자 입력) */
  label: string;
  fromSide?: FlowSide;
  toSide?: FlowSide;
  stroke?: string;
  dashed?: boolean;
  arrow?: FlowArrow;
}

export interface FlowMap {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  createdAt: number;
  /** ⚠️ 커밋 시에만 갱신. 렌더 중 갱신 금지(지문이 매 렌더 흔들려 저장이 무한 재트리거된다). */
  updatedAt: number;
}

export type FlowMaps = FlowMap[];

/* ===========================================================================
 * B. 소프트 상한
 *    STATE 파일은 백업 22본(auto 6·change 6·manual 10)으로 복제되고 관리자 포털이
 *    전 사용자 STATE를 순차 로드하므로, 무한 증식만은 막는다.
 *    노드 150 + 엣지 300 ≈ 85KB → 백업 22본 ≈ 1.9MB (수용 범위).
 * =========================================================================== */

export const MAX_FLOW_MAPS = 5;
export const MAX_FLOW_NODES = 150;
export const MAX_FLOW_EDGES = 300;

export const DEFAULT_NODE_W = 180;
export const DEFAULT_NODE_H = 120;
export const MIN_NODE_W = 60;
export const MIN_NODE_H = 44;
/** 격자 스냅 단위 */
export const FLOW_GRID = 8;

/* ===========================================================================
 * C. 라이브 파생 타입 (절대 저장하지 않음)
 *    매 렌더 useFlowMapData가 portfolios + portfolioSummaries에서 만든다.
 *    ⚠️ 이 타입의 어떤 필드도 FlowNode에 써 넣지 말 것.
 * =========================================================================== */

export interface FlowNodeView {
  /** 저장 원본 (참조) */
  node: FlowNode;
  /** 화면에 그릴 이름: node.label(사용자 입력 우선) → 라이브 계좌명 → 스냅샷 → '(연결 끊김)' */
  displayName: string;
  linked: boolean;
  resolved: boolean;
  /** linked && !resolved — 계좌가 영구삭제(purge)되었거나 다른 백업으로 교체됨 */
  dangling: boolean;
  /**
   * ⚠️ portfolioSummaries[].currentEval 단일 소스.
   *    portfolios[].portfolio에서 직접 합산하면 활성 계좌만 stale해지고
   *    해외 환산·savingsEval·펀드 폴백을 중복 구현하게 된다.
   * ⚠️ 삭제 계좌는 summary가 실수치 currentEval을 **그대로 반환**한다(제외는 소비처
   *    intTotals에서만 일어난다) → 여기서 명시적으로 null 처리해야 '삭제 계좌 =
   *    라이브/현재 완전 제외' 불변식이 지켜진다.
   */
  liveAmount: number | null;
  /** 최종 표시 금액(마스킹은 렌더 단계에서 hideAmounts로 처리) */
  shownAmount: number | null;
  /** ⚠️ summary.accountType 금지 — 시장 계좌를 전부 'portfolio'로 납작하게 만든다. */
  accountType: string;
  /** TEST 계좌: 회색+이탤릭 강등(금액은 표시 — 통합 표도 평가금액은 표시한다) */
  isTest: boolean;
  /** 삭제 계좌: '(삭제됨)' 접미 + 회색 강등, 금액은 null */
  deleted: boolean;
  /** dc-irp 계좌에 예적금이 있을 때 만기일 '제안' 후보(자동 채움 아님) */
  maturityCandidates: { itemId: string; name: string; endDate: string }[];
}

/* ===========================================================================
 * D. 순수 함수
 * =========================================================================== */

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const clampNum = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const snapToGrid = (v: number, grid: number = FLOW_GRID): number =>
  Math.round(v / grid) * grid;

/**
 * 커밋 직전 좌표 정수화 — 부동소수 노이즈가 지문에 새어 불필요한 Drive 저장이
 * 발생하는 것을 막는다.
 */
export function roundNode(n: FlowNode): FlowNode {
  const x = Math.round(n.x);
  const y = Math.round(n.y);
  const w = Math.round(n.w);
  const h = Math.round(n.h);
  if (x === n.x && y === n.y && w === n.w && h === n.h) return n;
  return { ...n, x, y, w, h };
}

export function makeFlowNode(partial: Partial<FlowNode> = {}): FlowNode {
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
    amountSource:
      partial.amountSource === 'account' || partial.amountSource === 'manual' ? partial.amountSource : 'none',
    ...(partial.fill ? { fill: partial.fill } : {}),
    ...(partial.stroke ? { stroke: partial.stroke } : {}),
  };
}

export function makeFlowMap(name: string = '흐름도'): FlowMap {
  const ts = Date.now();
  return { id: generateId(), name, nodes: [], edges: [], createdAt: ts, updatedAt: ts };
}

/**
 * sticky 복원 판정의 **단일 소스**.
 * ⚠️ App.tsx(applyBackupData)와 useDriveSync.ts(_preserveStickyPersonalData)가
 *    반드시 이 함수를 공유해야 한다 — 두 곳에 판정식을 손으로 복제하면 in-memory와
 *    Drive write가 갈려 "화면엔 남아 있다가 다음 로드에서 사라지는" 최악의 유실이 된다.
 * ⚠️ '컨테이너가 있는가'(length > 0)가 아니라 '내용이 있는가'로 잰다 — 보드를 열기만 해도
 *    빈 맵 1장이 생기므로, length 기준이면 백업으로 흐름도를 되살릴 길이 영구히 막힌다.
 *    (calendarMemos는 빈 항목이 생길 수 없어 length 기준으로도 안전했다.)
 */
export function flowMapsHaveContent(maps: unknown): boolean {
  if (!Array.isArray(maps)) return false;
  return maps.some(
    (m: any) =>
      !!m &&
      ((Array.isArray(m.nodes) && m.nodes.length > 0) || (Array.isArray(m.edges) && m.edges.length > 0)),
  );
}

/**
 * 지문 문자열. App.tsx portfolioStructureKey에서 사용.
 * ⚠️ 저장 대상 필드만 화이트리스트로 투영해 직렬화한다(App.tsx가 계좌 항목을 raw가 아니라
 *    투영으로 만드는 것과 동일 이유 — 런타임 전용 필드가 섞여도 순환 참조로 죽지 않는다).
 * ⚠️ 절대 던지지 않는다 — 던지면 지문 계산 아래의 saveStateRef 갱신·저장 예약이 함께
 *    실행되지 않아 그 세션의 Drive 저장이 통째로 멈춘다.
 * ⚠️ 길이·개수 해시로 줄이지 말 것 — investmentNotesKey('본문만 고치면 저장 안 됨')와
 *    holdingSnapshotsKey('수량만 재편집하면 저장 안 됨') 버그가 정확히 그것이었다.
 */
export function flowFingerprint(maps: unknown): string {
  try {
    if (!Array.isArray(maps)) return '';
    return JSON.stringify(
      maps.map((m: any) => ({
        i: m?.id ?? '',
        n: m?.name ?? '',
        nd: (Array.isArray(m?.nodes) ? m.nodes : []).map((n: any) => [
          n?.id ?? '', n?.kind ?? '', n?.x ?? 0, n?.y ?? 0, n?.w ?? 0, n?.h ?? 0,
          n?.label ?? '', n?.date ?? '', n?.amountManual ?? null, n?.memo ?? '',
          n?.portfolioId ?? null, n?.accountNameSnapshot ?? '', n?.amountSource ?? '',
          n?.fill ?? '', n?.stroke ?? '',
        ]),
        eg: (Array.isArray(m?.edges) ? m.edges : []).map((e: any) => [
          e?.id ?? '', e?.from ?? '', e?.to ?? '', e?.label ?? '',
          e?.fromSide ?? '', e?.toSide ?? '', e?.stroke ?? '',
          e?.dashed ? 1 : 0, e?.arrow ?? '',
        ]),
      })),
    );
  } catch {
    return 'ERR';
  }
}

/**
 * 로드 정규화. applyStateData·applyBackupData 양쪽에서 호출.
 * ⚠️ 변경이 없으면 **원본 참조를 그대로 반환** — 불필요한 저장 트리거 방지
 *    (normalizeCalendarMemos·dedupeHistoryByDate 패턴).
 * ⚠️ dangling portfolioId는 **삭제하지 않는다** — 계좌 복원(restorePortfolio)으로
 *    되살아나야 한다. 지우는 것은 존재하지 않는 노드를 가리키는 고아 edge뿐.
 */
export function normalizeFlowMaps(raw: unknown): FlowMaps {
  if (!Array.isArray(raw)) return [];
  let changed = false;
  const out: FlowMap[] = [];

  const rawMaps = raw.length > MAX_FLOW_MAPS ? (changed = true, raw.slice(0, MAX_FLOW_MAPS)) : raw;
  const seenMapIds = new Set<string>();

  for (const m of rawMaps as any[]) {
    if (!m || typeof m !== 'object') { changed = true; continue; }

    let mapChanged = false;
    let id = asStr(m.id);
    if (!id || seenMapIds.has(id)) { id = generateId(); mapChanged = true; }
    seenMapIds.add(id);

    const name = asStr(m.name) || '흐름도';
    if (name !== m.name) mapChanged = true;

    // ── 노드 ──
    const rawNodes: any[] = Array.isArray(m.nodes) ? m.nodes : [];
    if (!Array.isArray(m.nodes) && m.nodes !== undefined) mapChanged = true;
    const nodes: FlowNode[] = [];
    const seenNodeIds = new Set<string>();
    for (const n of rawNodes) {
      if (nodes.length >= MAX_FLOW_NODES) { mapChanged = true; break; }
      if (!n || typeof n !== 'object') { mapChanged = true; continue; }
      const nid = asStr(n.id);
      if (!nid || seenNodeIds.has(nid)) { mapChanged = true; continue; }
      seenNodeIds.add(nid);
      const fixed = makeFlowNode({ ...n, id: nid });
      // makeFlowNode가 값을 바꿨는지 얕게 비교(모든 저장 필드)
      if (
        fixed.kind !== n.kind || fixed.x !== n.x || fixed.y !== n.y || fixed.w !== n.w || fixed.h !== n.h ||
        fixed.label !== n.label || fixed.date !== n.date || fixed.amountManual !== (n.amountManual ?? null) ||
        fixed.memo !== n.memo || fixed.portfolioId !== (n.portfolioId ?? null) ||
        fixed.accountNameSnapshot !== n.accountNameSnapshot || fixed.amountSource !== n.amountSource
      ) mapChanged = true;
      nodes.push(fixed);
    }

    // ── 엣지 (고아 제거) ──
    const rawEdges: any[] = Array.isArray(m.edges) ? m.edges : [];
    if (!Array.isArray(m.edges) && m.edges !== undefined) mapChanged = true;
    const edges: FlowEdge[] = [];
    const seenEdgeIds = new Set<string>();
    for (const e of rawEdges) {
      if (edges.length >= MAX_FLOW_EDGES) { mapChanged = true; break; }
      if (!e || typeof e !== 'object') { mapChanged = true; continue; }
      const eid = asStr(e.id);
      const from = asStr(e.from);
      const to = asStr(e.to);
      if (!eid || seenEdgeIds.has(eid) || !seenNodeIds.has(from) || !seenNodeIds.has(to)) { mapChanged = true; continue; }
      seenEdgeIds.add(eid);
      const label = asStr(e.label);
      const arrow: FlowArrow = e.arrow === 'both' || e.arrow === 'none' ? e.arrow : 'to';
      const dashed = !!e.dashed;
      if (label !== e.label || arrow !== e.arrow || dashed !== e.dashed) mapChanged = true;
      edges.push({
        id: eid, from, to, label, arrow, dashed,
        ...(e.fromSide ? { fromSide: e.fromSide as FlowSide } : {}),
        ...(e.toSide ? { toSide: e.toSide as FlowSide } : {}),
        ...(e.stroke ? { stroke: asStr(e.stroke) } : {}),
      });
    }

    const createdAt = isFiniteNum(m.createdAt) ? m.createdAt : (mapChanged = true, Date.now());
    const updatedAt = isFiniteNum(m.updatedAt) ? m.updatedAt : (mapChanged = true, createdAt);

    if (mapChanged) {
      changed = true;
      out.push({ id, name, nodes, edges, createdAt, updatedAt });
    } else {
      out.push(m as FlowMap);
    }
  }

  return changed ? out : (raw as FlowMaps);
}

/** 노드 삭제 시 그 노드에 붙은 엣지를 동반 제거. 변경 없으면 원본 참조 반환. */
export function removeNode(map: FlowMap, nodeId: string): FlowMap {
  const nodes = map.nodes.filter(n => n.id !== nodeId);
  if (nodes.length === map.nodes.length) return map;
  const edges = map.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
  return { ...map, nodes, edges };
}

/** 존재하지 않는 노드를 가리키는 엣지 제거. 변경 없으면 원본 참조 반환. */
export function pruneOrphanEdges(map: FlowMap): FlowMap {
  const ids = new Set(map.nodes.map(n => n.id));
  const edges = map.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  if (edges.length === map.edges.length) return map;
  return { ...map, edges };
}

export function nodeCenter(n: FlowNode): { x: number; y: number } {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

/** 도형 경계 위의 앵커 좌표. 사각형·타원 모두 4방위에서는 같은 식이 성립한다. */
export function anchorPoint(n: FlowNode, side: Exclude<FlowSide, 'auto'>): { x: number; y: number } {
  switch (side) {
    case 'l': return { x: n.x, y: n.y + n.h / 2 };
    case 'r': return { x: n.x + n.w, y: n.y + n.h / 2 };
    case 't': return { x: n.x + n.w / 2, y: n.y };
    default:  return { x: n.x + n.w / 2, y: n.y + n.h };
  }
}

/** 두 노드의 상대 위치로 연결 방향 자동 결정 */
export function autoSides(a: FlowNode, b: FlowNode): { from: Exclude<FlowSide, 'auto'>; to: Exclude<FlowSide, 'auto'> } {
  const ca = nodeCenter(a);
  const cb = nodeCenter(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'r', to: 'l' } : { from: 'l', to: 'r' };
  }
  return dy >= 0 ? { from: 'b', to: 't' } : { from: 't', to: 'b' };
}

const normalOf = (side: Exclude<FlowSide, 'auto'>): { x: number; y: number } => {
  switch (side) {
    case 'l': return { x: -1, y: 0 };
    case 'r': return { x: 1, y: 0 };
    case 't': return { x: 0, y: -1 };
    default:  return { x: 0, y: 1 };
  }
};

/**
 * 두 노드 사이 연결선 SVG path(3차 베지어) + 라벨 위치.
 * ⚠️ 노드가 없으면 **null 반환(예외 금지)** — throw하면 렌더 중 TypeError가 루트
 *    ErrorBoundary까지 올라가 앱 화면 전체가 오류 페이지로 대체된다
 *    (fxRates.convertFx·brlBond의 null 계약과 동일).
 */
export function edgePath(
  a: FlowNode | undefined | null,
  b: FlowNode | undefined | null,
  e?: Pick<FlowEdge, 'fromSide' | 'toSide'> | null,
): { d: string; labelX: number; labelY: number } | null {
  if (!a || !b) return null;
  const auto = autoSides(a, b);
  const fs = (e?.fromSide && e.fromSide !== 'auto' ? e.fromSide : auto.from) as Exclude<FlowSide, 'auto'>;
  const ts = (e?.toSide && e.toSide !== 'auto' ? e.toSide : auto.to) as Exclude<FlowSide, 'auto'>;
  const p0 = anchorPoint(a, fs);
  const p3 = anchorPoint(b, ts);
  if (!isFiniteNum(p0.x) || !isFiniteNum(p0.y) || !isFiniteNum(p3.x) || !isFiniteNum(p3.y)) return null;

  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const pull = clampNum(dist * 0.4, 24, 160);
  const n0 = normalOf(fs);
  const n3 = normalOf(ts);
  const p1 = { x: p0.x + n0.x * pull, y: p0.y + n0.y * pull };
  const p2 = { x: p3.x + n3.x * pull, y: p3.y + n3.y * pull };

  // 3차 베지어의 t=0.5 지점 = (P0 + 3P1 + 3P2 + P3) / 8
  const labelX = (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8;
  const labelY = (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8;

  const r = (v: number) => Math.round(v * 100) / 100;
  const d = `M ${r(p0.x)} ${r(p0.y)} C ${r(p1.x)} ${r(p1.y)}, ${r(p2.x)} ${r(p2.y)}, ${r(p3.x)} ${r(p3.y)}`;
  return { d, labelX: r(labelX), labelY: r(labelY) };
}

/**
 * 계좌 해석 — portfolios(타입·삭제·TEST·예적금 만기 후보) + summaries(금액) 결합.
 * @param portfolio  portfolios.find(p => p.id === node.portfolioId)
 * @param summary    portfolioSummaries.find(s => s.id === node.portfolioId)
 */
export function resolveFlowNodeView(node: FlowNode, portfolio: any, summary: any): FlowNodeView {
  const linked = !!node.portfolioId;
  const resolved = linked && !!portfolio;
  const dangling = linked && !resolved;
  const deleted = !!(portfolio && portfolio.deletedAt);
  const isTest = !!(portfolio && portfolio.isTest);

  // ⚠️ 삭제 계좌는 summary.currentEval이 실수치를 그대로 담고 있다(제외는 intTotals에서만
  //    일어난다) → 여기서 명시적으로 null 처리.
  const liveAmount =
    resolved && !deleted && summary && typeof summary.currentEval === 'number' && Number.isFinite(summary.currentEval)
      ? summary.currentEval
      : null;

  const liveName = resolved ? (portfolio.name || portfolio.title || '') : '';
  const baseName = node.label || liveName || node.accountNameSnapshot || (linked ? '(연결 끊김)' : '');
  const displayName = deleted && !node.label ? `${baseName} (삭제됨)` : baseName;

  const shownAmount =
    node.amountSource === 'account' ? liveAmount : node.amountSource === 'manual' ? node.amountManual : null;

  // ⚠️ summary.accountType 금지 — 시장 계좌를 전부 'portfolio'로 납작하게 만든다.
  const accountType = resolved ? (portfolio.accountType || 'portfolio') : '';

  const maturityCandidates: { itemId: string; name: string; endDate: string }[] = [];
  if (resolved && (portfolio.accountType || '') === 'dc-irp' && Array.isArray(portfolio.portfolio)) {
    for (const item of portfolio.portfolio) {
      if (item && item.type === 'savings' && item.endDate) {
        maturityCandidates.push({ itemId: item.id, name: item.name || '예적금', endDate: item.endDate });
      }
    }
  }

  return {
    node, displayName, linked, resolved, dangling,
    liveAmount, shownAmount, accountType, isTest, deleted, maturityCandidates,
  };
}

/** 흐름도 전체에서 계좌 연결이 끊긴 노드 수 — 백업 복원 후 안내에 사용. */
export function countDanglingNodes(maps: FlowMaps, portfolios: any[]): number {
  const ids = new Set((Array.isArray(portfolios) ? portfolios : []).map((p: any) => p?.id).filter(Boolean));
  let n = 0;
  for (const m of Array.isArray(maps) ? maps : []) {
    for (const node of Array.isArray(m?.nodes) ? m.nodes : []) {
      if (node?.portfolioId && !ids.has(node.portfolioId)) n++;
    }
  }
  return n;
}
