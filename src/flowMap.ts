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
/**
 * 화살촉 위치. 선은 `from` 노드에서 `to` 노드로 그려지고, 화살촉이 어느 끝에 붙는지가
 * 곧 **사용자가 표현하려는 자금 흐름 방향**이다.
 *   'to'   = 끝(to 노드 쪽)   → from → to 로 흐른다   ← 기본값·레거시
 *   'from' = 시작(from 노드 쪽) → to → from 으로 흐른다
 *   'both' = 양쪽 / 'none' = 없음
 * ⚠️ 'from'을 지우지 말 것 — 도형을 이어 그린 순서와 실제 돈의 방향이 반대인 경우가 흔한데,
 *    그때 사용자가 할 수 있는 일이 '선을 지우고 반대로 다시 긋기'뿐이 된다.
 */
export type FlowArrow = 'to' | 'from' | 'both' | 'none';

/**
 * 선 종류. 종전 `dashed: boolean`(실선/점선 2택)을 대체한다.
 * ⚠️ 값 목록은 이 배열이 정본 — 화면·정규화·검증이 전부 여기서 파생된다.
 * ⚠️ 'none'(선 안 보임)은 **일부러 넣지 않았다** — 선이 사라지면 사용자가 지워진 줄 알고
 *    같은 연결을 다시 긋는다. 안 그릴 선은 삭제하는 것이 맞다.
 */
export const FLOW_LINE_STYLES = ['solid', 'dot', 'dash', 'longDash', 'dashDot', 'dashDotDot', 'double'] as const;
export type FlowLineStyle = (typeof FLOW_LINE_STYLES)[number];

/** 선 굵기. 저장은 이름으로(px를 저장하면 나중에 굵기 체계를 못 바꾼다). */
export const FLOW_LINE_WIDTHS = ['thin', 'normal', 'thick'] as const;
export type FlowLineWidth = (typeof FLOW_LINE_WIDTHS)[number];

/**
 * 팬/줌 상태. **저장 대상** — 보드를 닫고 다시 열면 마지막으로 보던 화면으로 돌아온다.
 * ⚠️ 값은 반드시 normalizeFlowViewport를 거쳐 저장한다(정수·유효자리 정리) — 휠 줌이 만드는
 *    1.3310000000000004 같은 부동소수 노이즈가 지문에 새면 화면을 훑기만 해도 Drive 저장이 나간다.
 */
export interface FlowViewport {
  x: number;
  y: number;
  scale: number;
}

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
  /**
   * @deprecated 레거시 2택(실선/점선). **새로 쓰지 말 것** — `normalizeFlowMaps`가 로드 시
   *    `lineStyle`로 1회 이관하고 이 필드를 지운다. 읽어야 할 때는 반드시
   *    `resolveFlowLineStyle(e.lineStyle, e.dashed)`를 통과시킬 것(직접 읽으면 새 종류를 놓친다).
   */
  dashed?: boolean;
  /** 기본값 'solid'는 **저장하지 않는다**(생략 = solid) — 기존 선이 전부 '변경됨'이 되는 것 방지. */
  lineStyle?: FlowLineStyle;
  /** 기본값 'normal'은 저장하지 않는다. */
  lineWidth?: FlowLineWidth;
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
  /**
   * 마지막 팬/줌 위치.
   * ⚠️ 저장 위치를 chartPrefs로 옮기지 말 것 — flowMaps는 이미 App.tsx 7지점·sticky 복원·별도 창
   *    브릿지가 통째로 실어 나르므로 여기에 두면 **영속화 신규 지점이 0곳**이다. 반대로 chartPrefs는
   *    계좌가 0개면 저장 effect가 조기 반환하고 saveVersionFile도 부르지 않는다(타 기기 반영 안 됨).
   * ⚠️ 새 맵에 기본값을 채워 넣지 말 것 — 그러면 normalizeFlowMaps가 모든 레거시 맵을 '변경됨'으로
   *    만들어 '변경 없으면 원본 참조 반환' 계약이 깨진다. 값이 없으면 호출부가 fitFlowViewport로
   *    1회 맞춤한다.
   */
  viewport?: FlowViewport;
  /**
   * 연결선 합치기(번들) — 한 도형의 같은 변에서 같은 스타일로 나가거나 들어오는 선이 2개 이상이면
   * 앵커에서 짧은 공유 트렁크를 뽑고 그 끝에서 분기시킨다. **기본은 켜짐**.
   *
   * ⚠️ `false`일 때만 저장한다(생략 = 켜짐). 기본값을 저장하면 기존 시트가 전부 정규화에서
   *    '변경됨'이 되어 '변경 없으면 원본 참조 반환' 계약이 깨지고, 폴링마다 재저장 + 보드 로컬
   *    사본이 갈아엎어져 2.5초 idle 승격 전의 편집이 사라진다.
   * ⚠️ 지문(flowFingerprint)에도 **끈 경우에만** 토큰을 싣는다 — 항상 실으면 배포 직후 모든
   *    시트의 지문이 달라져 사용자가 아무것도 안 고쳤는데 Drive 저장이 나간다.
   */
  bundleEdges?: boolean;
}

export type FlowMaps = FlowMap[];

/* ===========================================================================
 * B. 소프트 상한
 *    STATE 파일은 백업 22본(auto 6·change 6·manual 10)으로 복제되고 관리자 포털이
 *    전 사용자 STATE를 순차 로드하므로, 무한 증식만은 막는다.
 *    노드 150 + 엣지 300 ≈ 85KB → 백업 22본 ≈ 1.9MB (수용 범위).
 * =========================================================================== */

/**
 * 시트(맵) 개수 상한. 2026-09 사용자 요청("자금 계획에 따라 엑셀 시트처럼 원하는 만큼")으로
 * 5 → 20으로 올렸다.
 * ⚠️ **줄이지 말 것** — normalizeFlowMaps가 초과분을 `slice(0, MAX_FLOW_MAPS)`로 **잘라 버리므로**
 *    상한을 낮추는 순간 그 뒤 시트가 다음 로드에서 조용히 영구 삭제된다(undo 없음 + sticky 복원
 *    대상이라 백업으로도 못 되살린다). 올리는 방향은 데이터 손실이 없어 안전하다.
 * ⚠️ 노드·엣지 상한은 **시트마다** 적용되므로 최악의 STATE는 20배가 된다. 현실적인 흐름도는
 *    도형 수십 개라 문제되지 않지만, 상한을 더 올릴 때는 백업 22본 복제를 함께 계산할 것.
 */
export const MAX_FLOW_MAPS = 20;
export const MAX_FLOW_NODES = 150;
export const MAX_FLOW_EDGES = 300;

export const DEFAULT_NODE_W = 180;
export const DEFAULT_NODE_H = 120;
export const MIN_NODE_W = 60;
export const MIN_NODE_H = 44;
/** 격자 스냅 단위 */
export const FLOW_GRID = 8;

/**
 * 줌 한계 — FlowCanvas의 휠 핸들러와 normalizeFlowViewport가 **같은 상수**를 써야 한다.
 * 손복제하면 캔버스에서는 만들 수 있는데 저장 시 잘리는 배율이 생겨, 닫았다 열면 화면이 튄다.
 */
export const FLOW_MIN_SCALE = 0.25;
export const FLOW_MAX_SCALE = 2.5;
/** 저장된 위치가 없을 때의 기본 화면. ⚠️ 공유 객체 — 소비처는 반드시 스프레드로 복사할 것. */
export const DEFAULT_FLOW_VIEWPORT: FlowViewport = { x: 80, y: 80, scale: 1 };
/** 좌표 폭주 방지 — 손상값이 들어오면 복원 시 아무것도 안 보이는 화면이 된다. */
const VIEWPORT_XY_LIMIT = 200000;

/** 도형 기본 채우기 / 연결선 기본 색. ⚠️ 리터럴을 화면마다 손복제하지 말 것. */
export const DEFAULT_NODE_FILL = '#2E75B6';
export const DEFAULT_EDGE_STROKE = '#60a5fa';

/**
 * 캔버스 배경색.
 * ⚠️ **이중선(double)의 가운데 틈을 이 색으로 덮어 그린다** — 캔버스 배경과 한 글자라도 다르면
 *    선 한가운데에 다른 색 띠가 생긴다. 인스펙터의 미리보기 버튼 배경도 같은 값을 써야
 *    미리보기와 실제 렌더가 일치한다.
 */
export const FLOW_CANVAS_BG = '#0b1120';

/* ── 연결선 합치기(번들) 상수 ──────────────────────────────────────────────
 * ⚠️ 트렁크 길이 = min(구성원 축 투영 거리) × RATIO, 상한 MAX.
 *    `min`이라야 **가장 가까운 목적지를 지나치지 않는다** — 평균·최대를 쓰면 가까운 가지가
 *    되돌아오는 갈고리(S자)가 되고, 사용자 화면이 정확히 그 배치다(바로 옆 계좌 + 훨씬 아래 계좌).
 *    비율이 1 미만이라 오버슈트가 구조적으로 불가능하므로 **하한 클램프(Math.max)를 두지 말 것**.
 * ⚠️ MIN 미만이면 트렁크를 만들지 않는다(= 그 끝은 번들 아님). 9px짜리 트렁크는 '합쳐진 것'도
 *    '안 합쳐진 것'도 아닌 중간 상태로 보여, 무관한 도형 하나가 가까워지는 것만으로 뭉치가
 *    화면에서 녹아 없어진 것처럼 읽힌다.
 */
export const FLOW_TRUNK_RATIO = 0.45;
export const FLOW_TRUNK_MAX = 96;
export const FLOW_TRUNK_MIN = 16;

/* ── 도형 정렬 스냅 상수 ────────────────────────────────────────────────────
 * ⚠️ 임계값은 **화면 px**다. 캔버스 고정값으로 두면 축소(0.25배)에서 캡처 폭이 2px가 되어
 *    물리적으로 못 맞추고, 확대(2.5배)에서는 20px가 되어 확대의 목적인 미세 배치가 불가능해진다.
 */
export const SNAP_TOL_PX = 6;
/** 가이드선을 그릴 때 참조로 삼는 도형 수 상한(밀집 시트에서 화면을 가로지르는 난반사 방지). */
export const SNAP_GUIDE_MAX_REFS = 6;

/* ── 선 위 라벨 상수 ────────────────────────────────────────────────────────
 * ⚠️ 라벨은 **충돌이 실제로 있을 때만** 옮긴다(아래 layoutFlowLabels). 무조건 재배치하면
 *    번들을 꺼도 선이 1개뿐인 관계의 라벨까지 움직여 '지금과 픽셀 단위로 동일'이라는
 *    하위호환의 축이 깨진다.
 */
export const FLOW_LABEL_FONT = 12;
export const FLOW_LABEL_H = 22;
export const FLOW_LABEL_PAD = 8;
/** 점(dot)으로 강등됐을 때의 반지름 — 캔버스 좌표. */
export const FLOW_LABEL_DOT_R = 5;

/** 굵기 이름 → px. 'normal' 2는 **종전 연결선 굵기와 같은 값**(기존 흐름도 렌더 불변). */
const LINE_WIDTH_PX: Record<FlowLineWidth, number> = { thin: 1.2, normal: 2, thick: 3.5 };

/**
 * 파선 패턴 — **굵기의 배수**로 정의한다. px로 고정하면 굵은 선에서 점선이 뭉개지고
 * 얇은 선에서는 실선처럼 보인다.
 * ⚠️ `dash`의 [3, 2]는 굵기 normal(2)에서 정확히 '6 4' — 종전 `dashed:true` 렌더와 픽셀 동일하다.
 *    기존 점선 흐름도의 모양이 배포만으로 바뀌지 않게 하는 값이니 건드리지 말 것.
 */
const LINE_DASH_UNITS: Partial<Record<FlowLineStyle, number[]>> = {
  dot: [1, 3],
  dash: [3, 2],
  longDash: [7, 3],
  dashDot: [5, 2, 1, 2],
  dashDotDot: [5, 2, 1, 2, 1, 2],
};

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

/** 한 연결선의 양 끝 트렁크 길이. 0이면 그 끝은 번들이 아니다(= 종전과 동일하게 그린다). */
export interface FlowEdgeBundle {
  fromLen: number;
  toLen: number;
}

/**
 * 공유 트렁크 — 여러 선이 합쳐져 한 줄로 보이는 구간. **그룹당 하나만** 그린다.
 *
 * ⚠️ 트렁크를 선마다 각자 그려 겹치게 하지 말 것. 이중선(double)은 가운데를 캔버스 배경색으로
 *    덮어 그리므로 겹친 트렁크에서 **배경색 지우개**로 작동하고(어느 쪽이 이기는지는 사용자가
 *    선을 그린 순서가 정한다), 파선 계열도 공유 구간에서만 패턴이 사라진다. 게다가 선택 후광과
 *    클릭 히트박스가 공유 구간을 덮어 '선 하나를 골랐는데 뭉치 전체가 선택된 것처럼' 보인다.
 */
export interface FlowTrunk {
  key: string;
  d: string;
  /** 그룹 대표(팬 순서 0번)의 스타일 — 그룹 키에 스타일이 들어 있어 전원이 동일하다. */
  stroke?: string;
  lineStyle?: FlowLineStyle;
  lineWidth?: FlowLineWidth;
  /** 트렁크의 바깥 끝(도형 경계)에 화살촉을 그리는가 */
  head: boolean;
  /** 화살촉이 도형을 향하는가(도착 번들) — false면 도형에서 바깥으로 향한다(출발 번들) */
  headOutward: boolean;
  edgeIds: string[];
}

export interface FlowBundleResult {
  /** edgeId → 양 끝 트렁크 길이. 없는 키는 번들 아님. */
  byEdge: Record<string, FlowEdgeBundle>;
  trunks: FlowTrunk[];
}

/** 정렬 스냅 가이드선 — 스냅이 실제로 걸린 축에만 생긴다. */
export interface FlowSnapGuide {
  axis: 'x' | 'y';
  /** 가이드선이 놓이는 좌표(x축이면 x값) */
  value: number;
  /** 가이드선의 다른 축 범위 */
  from: number;
  to: number;
}

export interface FlowDragResolution {
  /** 드래그 중 화면에 보여줄 위치 */
  preview: { x: number; y: number };
  /** pointerup에서 저장할 위치 */
  commit: { x: number; y: number };
  guides: FlowSnapGuide[];
}

export type FlowLabelMode = 'label' | 'dot';

export interface FlowLabelPlacement {
  id: string;
  mode: FlowLabelMode;
  x: number;
  y: number;
}

/* ===========================================================================
 * D. 순수 함수
 * =========================================================================== */

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const clampNum = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const snapToGrid = (v: number, grid: number = FLOW_GRID): number =>
  Math.round(v / grid) * grid;

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX3_RE = /^#[0-9a-fA-F]{3}$/;

/**
 * 색상 값 정규화. 유효한 hex가 아니면 **빈 문자열**(= 기본색 사용).
 * ⚠️ 대소문자를 바꾸지 말 것 — 저장돼 있던 '#2E75B6'을 소문자로 바꾸면 normalizeFlowMaps가
 *    모든 기존 도형을 '변경됨'으로 판정해 원본 참조 보존 계약이 깨지고 배포 직후 전량 재저장된다.
 */
export function sanitizeHexColor(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (HEX6_RE.test(s)) return s;
  if (HEX3_RE.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return '';
}

/**
 * 도형 글자색 — 팔레트에 흰색·아주 옅은 톤이 들어오면서 흰 글자가 배경에 묻히는 것을 막는다.
 * ⚠️ 문턱 0.45는 **기존 8색이 전부 흰 글자를 유지**하도록 잡은 값이다(가장 밝은 #A5A5A5 = 0.376,
 *    주황 #ED7D31 = 0.327). 낮추면 사용자가 이미 칠해 둔 도형의 글자색이 배포만으로 뒤바뀐다.
 */
export function readableTextColor(fill: unknown): string {
  const hex = sanitizeHexColor(fill);
  if (!hex) return '#ffffff';
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  return L > 0.45 ? '#111827' : '#ffffff';
}

/**
 * 팬/줌 값 정규화 — 저장 직전과 로드 직후 **양쪽**에서 이 함수를 통과시킨다.
 * 유효하지 않으면 null(= 저장된 위치 없음)이고, 절대 던지지 않는다.
 */
export function normalizeFlowViewport(v: unknown): FlowViewport | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  if (!isFiniteNum(o.x) || !isFiniteNum(o.y) || !isFiniteNum(o.scale)) return null;
  return {
    x: Math.round(clampNum(o.x, -VIEWPORT_XY_LIMIT, VIEWPORT_XY_LIMIT)),
    y: Math.round(clampNum(o.y, -VIEWPORT_XY_LIMIT, VIEWPORT_XY_LIMIT)),
    // 소수 4자리 — 휠 줌의 부동소수 노이즈가 지문에 새는 것을 막는다
    scale: Math.round(clampNum(o.scale, FLOW_MIN_SCALE, FLOW_MAX_SCALE) * 1e4) / 1e4,
  };
}

/**
 * 화살표 값 정규화 — **저장 경로의 단일 판정 지점**.
 * ⚠️ 새 값을 추가할 때 여기를 빠뜨리면 `normalizeFlowMaps`가 그 값을 'to'로 되돌려,
 *    사용자가 고른 방향이 Drive 로드·별도 창 저장 왕복마다 조용히 사라진다
 *    (화이트리스트 재구축기 버그 클래스).
 */
/**
 * 연결 위치(변) 정규화. **4방위만 저장하고 'auto'·손상값은 생략형**(undefined)으로 만든다.
 * ⚠️ 'auto'를 저장하지 말 것 — 결과는 생략과 같은데 지문만 달라진다.
 */
export function normalizeFlowSide(v: unknown): Exclude<FlowSide, 'auto'> | undefined {
  return v === 'l' || v === 'r' || v === 't' || v === 'b' ? v : undefined;
}

export function normalizeFlowArrow(v: unknown): FlowArrow {
  return v === 'both' || v === 'none' || v === 'from' ? v : 'to';
}

/**
 * 어느 끝에 화살촉을 그릴지. 캔버스 렌더와 인스펙터 안내 문구가 **이 함수 하나**를 공유한다
 * (손복제하면 화면에 그려진 방향과 패널이 설명하는 방향이 갈린다).
 * ⚠️ 값이 없는 레거시 선은 'to'로 본다 — 종전 렌더가 정확히 그랬다.
 */
export function arrowHeads(arrow: unknown): { start: boolean; end: boolean } {
  const a = normalizeFlowArrow(arrow);
  return { start: a === 'both' || a === 'from', end: a === 'both' || a === 'to' };
}

/**
 * 선 종류 해석 — **레거시 `dashed`를 흡수하는 단일 지점**.
 * ⚠️ 소비처에서 `e.lineStyle`을 직접 읽지 말 것: 이 앱 이전에 만든 선은 `lineStyle`이 없고
 *    `dashed`만 있어서, 직접 읽으면 사용자가 점선으로 그려 둔 선이 전부 실선이 된다.
 */
export function resolveFlowLineStyle(lineStyle: unknown, dashed?: unknown): FlowLineStyle {
  if ((FLOW_LINE_STYLES as readonly string[]).includes(lineStyle as string)) return lineStyle as FlowLineStyle;
  return dashed ? 'dash' : 'solid';
}

export function normalizeFlowLineWidth(v: unknown): FlowLineWidth {
  return (FLOW_LINE_WIDTHS as readonly string[]).includes(v as string) ? (v as FlowLineWidth) : 'normal';
}

/**
 * 선 하나를 어떻게 그릴지 — **캔버스 렌더와 인스펙터 미리보기가 이 함수 하나를 공유**한다.
 * 손복제하면 고른 모양과 실제로 그려지는 모양이 갈려서, 미리보기가 존재할 이유가 사라진다.
 *
 * 이중선은 굵은 선(width) 위에 배경색 선(innerWidth)을 덮어 가운데를 비우는 방식이다.
 * ⚠️ 화살촉은 **안쪽 path**에 달아야 한다 — marker는 기본이 `markerUnits="strokeWidth"`라
 *    바깥 굵기(3배)에 붙이면 화살촉만 3배로 커진다.
 */
export function flowLineRender(edge: any): {
  width: number;
  dash: string | undefined;
  double: boolean;
  innerWidth: number;
} {
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

/** 두 팬/줌이 같은가. null/undefined는 '저장된 위치 없음'으로 같게 본다. */
export function sameFlowViewport(a: unknown, b: unknown): boolean {
  const x = a as any;
  const y = b as any;
  if (!x || !y) return !x && !y;
  return x.x === y.x && x.y === y.y && x.scale === y.scale;
}

/**
 * 전체 도형이 보이도록 맞춘 팬/줌.
 * ⚠️ '맞춤' 버튼과 **저장된 위치가 없는 구버전 맵의 첫 화면**이 같은 함수를 쓴다 — 손복제하면
 *    같은 데이터인데 두 경로가 다른 화면을 준다.
 */
export function fitFlowViewport(
  nodes: FlowNode[] | undefined | null,
  viewW: number,
  viewH: number,
): FlowViewport {
  const list = (Array.isArray(nodes) ? nodes : []).filter(
    (n: any) => n && isFiniteNum(n.x) && isFiniteNum(n.y) && isFiniteNum(n.w) && isFiniteNum(n.h),
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
  return (
    normalizeFlowViewport({ scale, x: 60 - minX * scale, y: 90 - minY * scale }) || {
      ...DEFAULT_FLOW_VIEWPORT,
    }
  );
}

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
    amountSource:
      partial.amountSource === 'account' || partial.amountSource === 'manual' ? partial.amountSource : 'none',
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
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
        // ⚠️ 팬/줌 지문 — 없으면 '화면 위치만 바꾼 세션'이 portfolioUpdatedAt을 올리지 못해
        //    STATE 저장이 통째로 스킵된다(historyVerifyKey·targetAmount와 동일 버그 클래스).
        vp: m?.viewport ? [m.viewport.x ?? 0, m.viewport.y ?? 0, m.viewport.scale ?? 1] : null,
        // ⚠️ 번들 토글은 **끈 경우에만** 키를 만든다. 항상 실으면 배포 직후 모든 시트의 지문이
        //    달라져 사용자가 아무것도 안 고쳤는데 Drive 저장이 나간다(배포 churn). 반대로 아예
        //    빼면 '토글만 바꾼 세션'의 저장이 통째로 스킵돼 별도 창에서는 영구히 저장되지 않는다.
        ...(m?.bundleEdges === false ? { nb: 1 } : {}),
        nd: (Array.isArray(m?.nodes) ? m.nodes : []).map((n: any) => [
          n?.id ?? '', n?.kind ?? '', n?.x ?? 0, n?.y ?? 0, n?.w ?? 0, n?.h ?? 0,
          n?.label ?? '', n?.date ?? '', n?.amountManual ?? null, n?.memo ?? '',
          n?.portfolioId ?? null, n?.accountNameSnapshot ?? '', n?.amountSource ?? '',
          n?.fill ?? '', n?.stroke ?? '',
        ]),
        eg: (Array.isArray(m?.edges) ? m.edges : []).map((e: any) => [
          e?.id ?? '', e?.from ?? '', e?.to ?? '', e?.label ?? '',
          e?.fromSide ?? '', e?.toSide ?? '', e?.stroke ?? '',
          // ⚠️ raw `dashed`가 아니라 **해석된 선 종류**를 담는다 — 레거시 이관(dashed:true →
          //    lineStyle:'dash')이 지문을 바꾸지 않아야 '아무것도 안 고쳤는데 저장이 나가는' 일이 없다.
          resolveFlowLineStyle(e?.lineStyle, e?.dashed), normalizeFlowLineWidth(e?.lineWidth),
          e?.arrow ?? '',
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
        fixed.accountNameSnapshot !== n.accountNameSnapshot || fixed.amountSource !== n.amountSource ||
        // ⚠️ 색상도 비교 대상 — 빠뜨리면 makeFlowNode가 손상된 hex를 걸러내도 mapChanged가 서지
        //    않아 원본 m이 그대로 push되고 정규화가 조용히 무효가 된다.
        fixed.fill !== n.fill || fixed.stroke !== n.stroke
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
      const arrow: FlowArrow = normalizeFlowArrow(e.arrow);
      const stroke = sanitizeHexColor(e.stroke);
      const strokeChanged = e.stroke === undefined ? stroke !== '' : stroke !== e.stroke;
      // ⚠️ 레거시 `dashed:boolean` → `lineStyle` 1회 이관. 기본값(solid/normal)은 **저장하지 않는다**
      //    — 저장하면 기존 선이 전부 '변경됨'이 되어 원본 참조 보존 계약이 깨진다.
      const outStyle = resolveFlowLineStyle(e.lineStyle, e.dashed);
      const outWidth = normalizeFlowLineWidth(e.lineWidth);
      const keepStyle = outStyle === 'solid' ? undefined : outStyle;
      const keepWidth = outWidth === 'normal' ? undefined : outWidth;
      const lineChanged = keepStyle !== e.lineStyle || keepWidth !== e.lineWidth || e.dashed !== undefined;
      // ⚠️ 연결 위치는 4방위만 저장한다. 'auto'와 손상값은 **생략형**으로 정규화한다(생략 = 자동) —
      //    검증 없이 통과시키면 손상값이 그대로 side로 쓰여 anchorPoint의 default 분기('아래')로
      //    떨어지고, 그 선만 이유 없이 도형 아래에서 뻗어 나온다.
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

    const createdAt = isFiniteNum(m.createdAt) ? m.createdAt : (mapChanged = true, Date.now());
    const updatedAt = isFiniteNum(m.updatedAt) ? m.updatedAt : (mapChanged = true, createdAt);

    // ⚠️ 팬/줌은 **여기서 반드시 보존**해야 한다. 이 함수는 화이트리스트 재구축기라, 필드를
    //    빠뜨리면 별도 창 저장 경로(flow:maps → normalizeFlowMaps)와 Drive 로드에서 사용자의
    //    마지막 화면 위치가 매번 조용히 삭제된다(makeBtConfig·_ensureTaxBase와 동일 버그 클래스).
    const rawVp = (m as any).viewport;
    const viewport = normalizeFlowViewport(rawVp);
    // undefined/null(= 저장된 위치 없음)은 '변경'이 아니다 — 레거시 맵이 매 로드마다
    // 새 객체가 되면 폴링마다 재저장 + 보드 로컬 사본이 갈아엎어진다.
    if (viewport ? !sameFlowViewport(rawVp, viewport) : rawVp !== undefined && rawVp !== null) mapChanged = true;

    // ⚠️ 번들 토글은 **끈 상태(false)만** 보존한다(생략 = 켜짐). `true`나 손상값은 생략형으로
    //    정규화하되, 그것만으로는 지문이 그대로라 저장이 트리거되지 않을 수 있다 → 호출부는
    //    토글을 켤 때 값을 `true`로 쓰지 말고 **필드를 지운다**(FlowBoard.toggleBundle).
    const rawBundle = (m as any).bundleEdges;
    const bundleOff = rawBundle === false;
    if (rawBundle !== undefined && !bundleOff) mapChanged = true;

    if (mapChanged) {
      changed = true;
      // ⚠️ 이 리터럴이 화이트리스트다 — 새 map 레벨 필드를 여기에 등록하지 않으면 정규형일
      //    때는 원본 참조라 살아남고 mapChanged가 서는 순간(이름 손상·레거시 dashed 이관·
      //    viewport 교정 등) **조용히 사라진다**. "가끔 잊어버린다"로 보이는 최악의 형태다.
      out.push({
        id, name, nodes, edges, createdAt, updatedAt,
        ...(viewport ? { viewport } : {}),
        ...(bundleOff ? { bundleEdges: false } : {}),
      });
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

/* ---------------------------------------------------------------------------
 * D-2. 시트(맵) 단위 조작 — 엑셀 시트식 다중 흐름도
 *
 * ⚠️ 전부 **변경이 없으면 원본 배열 참조를 그대로 반환**한다. FlowBoard의 commit이
 *    `next === prev`면 dirty를 세우지 않으므로, 이 계약이 곧 "아무 일도 일어나지 않은
 *    클릭에는 Drive 저장(STATE+VERSION+STOCK+MARKET)이 나가지 않는다"는 보장이다.
 * ⚠️ 시트 순서는 **배열 순서**가 곧 저장값이다(`order` 필드를 만들지 말 것). flowFingerprint가
 *    배열을 순서대로 투영하므로 순서 변경만으로도 저장이 트리거되고, 정규화·복원·별도 창
 *    브릿지가 배열을 통째로 나르므로 **영속화 신규 지점이 0곳**이다
 *    (관심종목 그룹 순서 드래그와 같은 규약).
 * ------------------------------------------------------------------------- */

/** 시트 이름 길이 상한. 탭 바 폭과 STATE 크기를 함께 지킨다. */
export const MAX_FLOW_MAP_NAME = 40;

const asMapList = (maps: unknown): FlowMap[] => (Array.isArray(maps) ? (maps as FlowMap[]) : []);

/** '시트 1', '시트 2' … 중 아직 쓰지 않은 가장 작은 번호. */
export function nextFlowMapName(maps: unknown, base: string = '시트'): string {
  const used = new Set(asMapList(maps).map(m => asStr(m?.name)));
  for (let i = 1; i <= MAX_FLOW_MAPS + 1; i++) {
    const cand = `${base} ${i}`;
    if (!used.has(cand)) return cand;
  }
  return `${base} ${Date.now()}`;
}

function copyNameOf(list: FlowMap[], name: unknown): string {
  const base = `${asStr(name) || '시트'} 복사`;
  const used = new Set(list.map(m => asStr(m?.name)));
  if (!used.has(base)) return base;
  for (let i = 2; i <= MAX_FLOW_MAPS + 1; i++) {
    const cand = `${base} ${i}`;
    if (!used.has(cand)) return cand;
  }
  return base;
}

/** 시트 추가. 상한 초과면 원본 참조(호출부가 안내 문구를 띄운다). */
export function addFlowMap(maps: unknown, name?: string): FlowMaps {
  const list = asMapList(maps);
  if (list.length >= MAX_FLOW_MAPS) return list;
  return [...list, makeFlowMap(asStr(name).trim().slice(0, MAX_FLOW_MAP_NAME) || nextFlowMapName(list))];
}

/**
 * 시트 복제 — 원본 **바로 뒤**에 꽂는다(엑셀 '시트 이동/복사'와 같은 위치).
 *
 * ⚠️ 노드 id를 전부 새로 만들고 **엣지의 from/to를 그 새 id로 다시 잇는다**. 안 하면 사본의
 *    엣지가 원본 시트의 노드 id를 가리키게 되는데, normalizeFlowMaps의 고아 엣지 제거가
 *    **다음 로드에서 사본의 연결선을 전부 조용히 삭제**한다(도형은 남고 선만 사라져 원인을
 *    추적할 수 없다). 지문에도 안 잡히는 종류의 유실이므로 절대 얕은 복사로 되돌리지 말 것.
 * ⚠️ 원본이 이미 고아 엣지를 들고 있으면 사본에는 만들지 않는다(정규화 결과와 미리 일치시킨다).
 */
export function duplicateFlowMap(maps: unknown, id: string): FlowMaps {
  const list = asMapList(maps);
  const idx = list.findIndex(m => m?.id === id);
  if (idx < 0 || list.length >= MAX_FLOW_MAPS) return list;
  const src = list[idx];
  const ts = Date.now();

  const idMap = new Map<string, string>();
  const nodes = (Array.isArray(src.nodes) ? src.nodes : []).map(n => {
    const nid = generateId();
    idMap.set(n.id, nid);
    return { ...n, id: nid };
  });
  const edges: FlowEdge[] = [];
  for (const e of Array.isArray(src.edges) ? src.edges : []) {
    const from = idMap.get(e.from);
    const to = idMap.get(e.to);
    if (!from || !to) continue;
    edges.push({ ...e, id: generateId(), from, to });
  }

  const copy: FlowMap = { ...src, id: generateId(), name: copyNameOf(list, src.name), nodes, edges, createdAt: ts, updatedAt: ts };
  const out = list.slice();
  out.splice(idx + 1, 0, copy);
  return out;
}

/**
 * 시트 삭제.
 * ⚠️ 마지막 1장은 지우지 않는다(엑셀과 같은 규약) — 0장이 되면 FlowBoard의 시드 로직이 빈 맵을
 *    새로 만들어 "지웠는데 이름만 초기화된 시트가 남는" 혼란이 되고, 그 사이 승격이 끼면
 *    flowMapsHaveContent가 false가 되어 sticky 복원 경로까지 흔들린다.
 */
export function removeFlowMap(maps: unknown, id: string): FlowMaps {
  const list = asMapList(maps);
  if (list.length <= 1) return list;
  const out = list.filter(m => m?.id !== id);
  return out.length === list.length ? list : out;
}

/** 시트 이름 변경. 빈 이름은 거부(원래 이름 유지) — 이름 없는 탭은 고를 수가 없다. */
export function renameFlowMap(maps: unknown, id: string, name: unknown): FlowMaps {
  const list = asMapList(maps);
  const idx = list.findIndex(m => m?.id === id);
  if (idx < 0) return list;
  const next = asStr(name).trim().slice(0, MAX_FLOW_MAP_NAME) || asStr(list[idx].name) || '시트';
  if (next === list[idx].name) return list;
  const out = list.slice();
  out[idx] = { ...list[idx], name: next, updatedAt: Date.now() };
  return out;
}

/** 시트 순서 이동(delta: -1 왼쪽 / +1 오른쪽). 끝에서 더 밀면 원본 참조. */
export function moveFlowMap(maps: unknown, id: string, delta: number): FlowMaps {
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
 * 연결선이 실제로 붙는 두 변을 확정한다.
 * ⚠️ **`edgePath`와 `buildFlowBundles`가 반드시 이 함수를 공유해야 한다.** 각자 계산하면
 *    그룹 키가 고른 변과 실제로 그려지는 앵커가 갈려 **트렁크가 엉뚱한 변에서 뻗어 나온다**
 *    (화면과 계산이 갈리는 최악의 형태 — 사용자는 한참 뒤에야 알아챈다).
 */
export function resolveEdgeSides(
  a: FlowNode,
  b: FlowNode,
  e?: Pick<FlowEdge, 'fromSide' | 'toSide'> | null,
): { fs: Exclude<FlowSide, 'auto'>; ts: Exclude<FlowSide, 'auto'> } {
  const auto = autoSides(a, b);
  return {
    fs: (e?.fromSide && e.fromSide !== 'auto' ? e.fromSide : auto.from) as Exclude<FlowSide, 'auto'>,
    ts: (e?.toSide && e.toSide !== 'auto' ? e.toSide : auto.to) as Exclude<FlowSide, 'auto'>,
  };
}

/**
 * 두 노드 사이 연결선 SVG path(3차 베지어) + 라벨 위치.
 * ⚠️ 노드가 없으면 **null 반환(예외 금지)** — throw하면 렌더 중 TypeError가 루트
 *    ErrorBoundary까지 올라가 앱 화면 전체가 오류 페이지로 대체된다
 *    (fxRates.convertFx·brlBond의 null 계약과 동일).
 *
 * ⚠️ **하위호환의 축**: `bundle`을 넘기지 않거나 양 끝 길이가 0이면 `q0 === p0`·`q3 === p3`가
 *    되어 아래 식이 종전 본문과 **문자 그대로 같은 값**을 낸다. 이것은 '값이 같다'는 논증이
 *    아니라 **같은 코드가 도는 것**이다 — 번들 분기를 별도 return으로 쪼개지 말 것(쪼개는 순간
 *    두 경로가 드리프트할 수 있는 표면이 생긴다).
 * ⚠️ 반환하는 `d`는 **분기 구간만**이다(트렁크는 공유 레이어가 따로 그린다). 그래서 선택 후광·
 *    클릭 히트박스·per-edge 스타일이 전부 종전 구조 그대로 남는다.
 */
export function edgePath(
  a: FlowNode | undefined | null,
  b: FlowNode | undefined | null,
  e?: Pick<FlowEdge, 'fromSide' | 'toSide'> | null,
  bundle?: FlowEdgeBundle | null,
): { d: string; labelX: number; labelY: number } | null {
  if (!a || !b) return null;
  const { fs, ts } = resolveEdgeSides(a, b, e);
  const p0 = anchorPoint(a, fs);
  const p3 = anchorPoint(b, ts);
  if (!isFiniteNum(p0.x) || !isFiniteNum(p0.y) || !isFiniteNum(p3.x) || !isFiniteNum(p3.y)) return null;

  const n0 = normalOf(fs);
  const n3 = normalOf(ts);

  // 트렁크 끝(분기점). 길이가 0이면 앵커 그 자체 → 아래 식이 종전과 동일해진다.
  const outLen = bundle && isFiniteNum(bundle.fromLen) && bundle.fromLen > 0 ? bundle.fromLen : 0;
  const inLen = bundle && isFiniteNum(bundle.toLen) && bundle.toLen > 0 ? bundle.toLen : 0;
  const q0 = outLen > 0 ? { x: p0.x + n0.x * outLen, y: p0.y + n0.y * outLen } : p0;
  const q3 = inLen > 0 ? { x: p3.x + n3.x * inLen, y: p3.y + n3.y * inLen } : p3;

  // ⚠️ pull은 **분기 구간의 길이**(q0↔q3)로 잰다. p0↔p3로 재면 트렁크가 축 방향 여유를
  //    다 써 버린 뒤에도 컨트롤 포인트가 그대로라 분기 곡선이 자기 트렁크로 되감긴다.
  const dist = Math.hypot(q3.x - q0.x, q3.y - q0.y);
  const pull = clampNum(dist * 0.4, 24, 160);
  const p1 = { x: q0.x + n0.x * pull, y: q0.y + n0.y * pull };
  const p2 = { x: q3.x + n3.x * pull, y: q3.y + n3.y * pull };

  // 3차 베지어의 t=0.5 지점 = (P0 + 3P1 + 3P2 + P3) / 8
  const labelX = (q0.x + 3 * p1.x + 3 * p2.x + q3.x) / 8;
  const labelY = (q0.y + 3 * p1.y + 3 * p2.y + q3.y) / 8;

  const r = (v: number) => Math.round(v * 100) / 100;
  const d = `M ${r(q0.x)} ${r(q0.y)} C ${r(p1.x)} ${r(p1.y)}, ${r(p2.x)} ${r(p2.y)}, ${r(q3.x)} ${r(q3.y)}`;
  return { d, labelX: r(labelX), labelY: r(labelY) };
}

/**
 * 시트의 번들 설정 해석. **생략 = 켜짐**.
 * ⚠️ truthy 판정(`!!v`)으로 되돌리지 말 것 — 저장하지 않은 기존 시트가 전부 꺼진 상태가 된다.
 */
export function flowBundleEnabled(v: unknown): boolean {
  return v !== false;
}

/**
 * 연결선 합치기 계산 — 한 도형의 **같은 변에서 같은 역할·같은 스타일**로 붙는 선을 묶어
 * 공유 트렁크를 만든다.
 *
 * 그룹 키 = `노드id · 확정된 변 · 역할(from|to) · 그 끝의 화살촉 유무 · 색 · 선종류 · 굵기`
 *
 * ⚠️ **역할은 위상**(`edge.from`인가 `edge.to`인가)이지 화살표 방향이 아니다. `arrow`로 정하면
 *    같은 앵커에서 출발하는 선들이 다른 그룹이 되어 같은 자리에 트렁크가 두 번 그려진다.
 * ⚠️ **화살촉 유무 한 비트를 키에 넣는다.** 빠지면 공유 트렁크 뿌리에 모순되는 화살촉 하나가
 *    생겨 뭉치 전체가 반대 방향 흐름으로 읽힌다. (화살촉을 렌더에서 억제하는 방식으로 우회하지
 *    말 것 — 사용자가 고른 방향을 조용히 지우는 것은 이 저장소가 반복해서 금지해 온 패턴이다.)
 * ⚠️ **색·선종류·굵기도 키에 넣는다.** 트렁크는 그룹당 하나만 그리므로, 스타일이 섞인 선들을
 *    한 뭉치로 묶으면 공유 구간에서 나머지 선의 색·패턴이 사라진다. 사용자가 색으로 구분해 둔
 *    선은 **의도적으로 구분한 것**이므로 합치지 않는 쪽이 옳다.
 * ⚠️ **한 (도형, 변)에는 트렁크가 최대 하나다.** 나가는 뭉치와 들어오는 뭉치가 같은 변에 동시에
 *    서면 두 트렁크가 문자 단위로 같은 선분이 되고 화살촉이 반대 방향으로 같은 자리에 찍힌다
 *    → 구성원이 많은 쪽만 남기고 나머지는 번들을 해제한다(동점이면 키 사전순).
 */
export function buildFlowBundles(
  nodes: FlowNode[] | undefined | null,
  edges: FlowEdge[] | undefined | null,
  enabled: boolean = true,
): FlowBundleResult {
  const out: FlowBundleResult = { byEdge: {}, trunks: [] };
  if (!enabled || !Array.isArray(nodes) || !Array.isArray(edges) || edges.length < 2) return out;

  const byId = new Map<string, FlowNode>();
  for (const n of nodes) if (n && typeof n.id === 'string' && n.id) byId.set(n.id, n);

  interface Group {
    key: string;
    nodeId: string;
    side: Exclude<FlowSide, 'auto'>;
    role: 'from' | 'to';
    head: boolean;
    stroke: string;
    lineStyle: FlowLineStyle;
    lineWidth: FlowLineWidth;
    edgeIds: string[];
    minProj: number;
  }
  const groups = new Map<string, Group>();

  for (const e of edges) {
    if (!e || typeof e.id !== 'string' || !e.id) continue;
    const a = byId.get(asStr(e.from));
    const b = byId.get(asStr(e.to));
    // ⚠️ 자기 자신으로 가는 선은 앵커가 한 도형 안에서 마주 보게 되어 트렁크 방향이 의미를
    //    잃는다 → 번들 대상에서 제외(종전 렌더 그대로).
    //    ⚠️ 이 `a === b`는 **도달 불가한 방어적 중복**이다 — self edge는 autoSides가 r/l을 주고
    //    두 앵커가 서로를 마주 보므로 아래 `proj > 0` 가드에서 어차피 전부 걸러진다(변이 테스트로
    //    확인: 이 조건을 지워도 결과가 한 건도 달라지지 않는다). 의도를 드러내려고 남긴다.
    if (!a || !b || a === b) continue;
    const { fs, ts } = resolveEdgeSides(a, b, e);
    const p0 = anchorPoint(a, fs);
    const p3 = anchorPoint(b, ts);
    if (!isFiniteNum(p0.x) || !isFiniteNum(p0.y) || !isFiniteNum(p3.x) || !isFiniteNum(p3.y)) continue;
    const heads = arrowHeads(e.arrow);
    const stroke = sanitizeHexColor(e.stroke) || DEFAULT_EDGE_STROKE;
    const lineStyle = resolveFlowLineStyle(e.lineStyle, e.dashed);
    const lineWidth = normalizeFlowLineWidth(e.lineWidth);

    const push = (
      nodeId: string, side: Exclude<FlowSide, 'auto'>, role: 'from' | 'to', head: boolean, proj: number,
    ) => {
      // ⚠️ 반대쪽 앵커가 이 변의 **뒤**에 있으면(proj <= 0) 트렁크가 목적지에서 멀어지는
      //    방향으로 뻗는다 → 그 그룹은 성립하지 않는다.
      if (!(proj > 0)) return;
      const key = JSON.stringify([nodeId, side, role, head ? 1 : 0, stroke, lineStyle, lineWidth]);
      const g = groups.get(key);
      if (g) {
        g.edgeIds.push(e.id);
        if (proj < g.minProj) g.minProj = proj;
      } else {
        groups.set(key, { key, nodeId, side, role, head, stroke, lineStyle, lineWidth, edgeIds: [e.id], minProj: proj });
      }
    };

    const n0 = normalOf(fs);
    const n3 = normalOf(ts);
    push(asStr(e.from), fs, 'from', heads.start, (p3.x - p0.x) * n0.x + (p3.y - p0.y) * n0.y);
    push(asStr(e.to), ts, 'to', heads.end, (p0.x - p3.x) * n3.x + (p0.y - p3.y) * n3.y);
  }

  // (도형, 변)당 하나만 남긴다 — 구성원 수 우선, 동점이면 키 사전순(결정적).
  const winner = new Map<string, Group>();
  for (const g of groups.values()) {
    if (g.edgeIds.length < 2) continue;
    const len = Math.min(g.minProj * FLOW_TRUNK_RATIO, FLOW_TRUNK_MAX);
    if (!(len >= FLOW_TRUNK_MIN)) continue;
    const slot = JSON.stringify([g.nodeId, g.side]);
    const cur = winner.get(slot);
    if (!cur || g.edgeIds.length > cur.edgeIds.length || (g.edgeIds.length === cur.edgeIds.length && g.key < cur.key)) {
      winner.set(slot, g);
    }
  }

  const r = (v: number) => Math.round(v * 100) / 100;
  const picked = Array.from(winner.values()).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  for (const g of picked) {
    const node = byId.get(g.nodeId);
    if (!node) continue;
    const len = r(Math.min(g.minProj * FLOW_TRUNK_RATIO, FLOW_TRUNK_MAX));
    const p = anchorPoint(node, g.side);
    const n = normalOf(g.side);
    const q = { x: p.x + n.x * len, y: p.y + n.y * len };
    const ids = g.edgeIds.slice().sort();
    for (const id of ids) {
      const slot = out.byEdge[id] || (out.byEdge[id] = { fromLen: 0, toLen: 0 });
      if (g.role === 'from') slot.fromLen = len;
      else slot.toLen = len;
    }
    // ⚠️ 방향: 출발 뭉치는 도형 → 바깥(p → q), 도착 뭉치는 바깥 → 도형(q → p).
    //    화살촉은 **도형 경계 쪽 끝**에 붙으므로 출발 뭉치는 markerStart, 도착 뭉치는 markerEnd다.
    const d = g.role === 'from'
      ? `M ${r(p.x)} ${r(p.y)} L ${r(q.x)} ${r(q.y)}`
      : `M ${r(q.x)} ${r(q.y)} L ${r(p.x)} ${r(p.y)}`;
    out.trunks.push({
      key: g.key,
      d,
      ...(g.stroke !== DEFAULT_EDGE_STROKE ? { stroke: g.stroke } : {}),
      ...(g.lineStyle !== 'solid' ? { lineStyle: g.lineStyle } : {}),
      ...(g.lineWidth !== 'normal' ? { lineWidth: g.lineWidth } : {}),
      head: g.head,
      headOutward: g.role === 'to',
      edgeIds: ids,
    });
  }
  return out;
}

/* ── 도형 정렬 스냅 ─────────────────────────────────────────────────────────
 * 사용자 요구: "도형을 대충 놓아도 이전 도형과 열이 맞아야 한다. 단 모서리 인근에 놓으면
 * 가운데로 강제 정렬하면 안 된다."
 *
 * ⚠️ 후보는 **가산점 없는 평면 집합**이고 x·y를 **독립**으로 판정한다. 중심에 우선권을 주지
 *    않는 것만으로 사용자가 명시적으로 거부한 '모서리 근처인데 가운데로 끌려감'이 구조적으로
 *    발생하지 않는다(가장 가까운 후보가 이기므로 모서리 근처면 모서리가 이긴다).
 * ⚠️ 후보는 **같은 종류끼리만**(왼↔왼·가운데↔가운데·오른↔오른) 짝짓는다. 왼↔오른(도형을 딱
 *    붙이기)을 넣으면 두 도형이 간격 0으로 붙어 그 사이 연결선의 길이가 0이 되고 **선 위 라벨이
 *    도형 뒤에 통째로 묻힌다** — 요구 ③(메모가 잘 보여야 한다)과 정면으로 충돌한다.
 *    사용자가 요구한 것은 '같은 열에 배열'이지 '붙이기'가 아니다.
 */

/** 화면 px 임계값을 캔버스 단위로 환산. ⚠️ scale이 유한 양수가 아니면 1로 떨어뜨린다 —
 *  손상된 viewport에서 tol이 Infinity가 되면 도형이 화면 밖 먼 노드로 순간이동한다. */
export function snapTolerance(scale: unknown, px: number = SNAP_TOL_PX): number {
  const s = isFiniteNum(scale) && scale > 0 ? scale : 1;
  return px / s;
}

interface SnapAxisHit { delta: number; value: number; refs: { from: number; to: number }[] }

/** 한 축의 최근접 스냅. `lo/mid/hi`는 이동 도형의 세 후보, peers는 참조 도형들의 같은 세 값. */
function snapAxis(
  lo: number, mid: number, hi: number,
  peers: { lo: number; mid: number; hi: number; cross: { from: number; to: number } }[],
  tol: number,
): SnapAxisHit | null {
  let bestDelta = 0;
  let bestValue = 0;
  let bestAbs = Infinity;
  for (const p of peers) {
    const pairs: [number, number][] = [[lo, p.lo], [mid, p.mid], [hi, p.hi]];
    for (const [cur, tgt] of pairs) {
      if (!isFiniteNum(cur) || !isFiniteNum(tgt)) continue;
      const d = tgt - cur;
      const ad = Math.abs(d);
      if (ad > tol) continue;
      if (ad < bestAbs) { bestAbs = ad; bestDelta = d; bestValue = tgt; }
    }
  }
  if (bestAbs === Infinity) return null;
  // 가이드 참조 = 그 값과 실제로 일치하는 도형들(밀집 시트에서 화면을 가로지르지 않게 상한).
  const refs: { from: number; to: number }[] = [];
  for (const p of peers) {
    if (refs.length >= SNAP_GUIDE_MAX_REFS) break;
    if (p.lo === bestValue || p.mid === bestValue || p.hi === bestValue) refs.push(p.cross);
  }
  return { delta: bestDelta, value: bestValue, refs };
}

/**
 * 드래그 중인 도형의 최종 위치와 가이드선.
 *
 * ⚠️ **미리보기와 커밋을 한 함수가 함께 낸다.** 둘을 따로 계산하면 화면에 보이는 자리와 실제로
 *    저장되는 자리가 갈리는데, 가이드선이 생기면 그 어긋남이 눈에 보인다.
 * ⚠️ **정렬이 걸린 축에는 격자 스냅을 다시 적용하지 않는다(축별 독립).** `DEFAULT_NODE_W = 180`이
 *    `mod 8 === 4`라 기본폭 도형의 오른쪽 모서리는 **항상** 격자 중간에 떨어지고, 정렬 결과에
 *    격자를 다시 걸면 100% 4px 어긋난다(폭 60~300 구간의 88%가 같은 증상).
 * ⚠️ 정렬이 걸리지 않은 축은 **종전 그대로**(미리보기 raw · 커밋 격자)다. 두 값을 통일하면
 *    드래그가 8px 계단이 되고 그 계단은 스냅을 꺼도 남는다.
 */
export function resolveNodeDrag(
  base: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  peers: FlowNode[] | undefined | null,
  tol: number,
  enabled: boolean = true,
): FlowDragResolution {
  const rawX = base.x + dx;
  const rawY = base.y + dy;
  const plain: FlowDragResolution = {
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
  const guides: FlowSnapGuide[] = [];
  if (hitX) {
    let from = y;
    let to = y + base.h;
    for (const r of hitX.refs) { if (r.from < from) from = r.from; if (r.to > to) to = r.to; }
    guides.push({ axis: 'x', value: hitX.value, from, to });
  }
  if (hitY) {
    let from = x;
    let to = x + base.w;
    for (const r of hitY.refs) { if (r.from < from) from = r.from; if (r.to > to) to = r.to; }
    guides.push({ axis: 'y', value: hitY.value, from, to });
  }
  return {
    preview: { x, y },
    commit: {
      x: hitX ? x : snapToGrid(rawX, FLOW_GRID),
      y: hitY ? y : snapToGrid(rawY, FLOW_GRID),
    },
    guides,
  };
}

/* ── 선 위 라벨 배치 ────────────────────────────────────────────────────────
 * ⚠️ **충돌이 실제로 있을 때만** 옮긴다. 무조건 재배치하면 번들을 꺼도 선이 1개뿐인 관계의
 *    라벨까지 움직여 '지금과 픽셀 단위로 동일'이라는 하위호환의 축이 깨진다.
 */

/**
 * 라벨 폭 근사.
 * ⚠️ 종전 `label.length * 12`는 한글/영문 혼용에서 최대 2배까지 틀린다(영문 12자 라벨의 실제
 *    폭은 약 절반). 전각(한글·한자·가나·전각기호)만 1em으로 보고 나머지는 0.55em으로 센다.
 * ⚠️ canvas measureText로 실측하지 않는 이유: 그 경로는 SVG의 실제 font-family를 알아야 하는데
 *    첫 렌더에서는 ref가 아직 null이라 폰트 문자열이 비고, 그러면 측정 경로가 **무음으로 죽어**
 *    근사가 유일한 경로가 된다. 그럴 바에는 근사 하나를 정확히 하는 편이 예측 가능하다.
 */
export function approxLabelWidth(text: unknown, fontSize: number = FLOW_LABEL_FONT): number {
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

/** 라벨 상자 크기(패딩 포함). 화면과 배치 계산이 반드시 이 한 함수를 공유해야 한다. */
export function flowLabelSize(text: unknown, fontSize: number = FLOW_LABEL_FONT): { w: number; h: number } {
  return { w: approxLabelWidth(text, fontSize) + FLOW_LABEL_PAD * 2, h: FLOW_LABEL_H };
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * 라벨 배치 — 기본 위치가 비어 있으면 그대로 두고, 막혔을 때만 위아래 후보를 시도하며,
 * 전부 막히면 점(dot)으로 강등한다.
 *
 * @param items      `{ id, cx, cy, w, h }` — cx/cy는 선이 준 기본 중심(edgePath의 labelX/Y)
 * @param obstacles  도형 박스. ⚠️ **반드시 포함해야 한다** — 라벨은 도형보다 아래 레이어라
 *                   겹치면 가려지고, '메모를 썼는데 화면 어디에도 없다'가 된다.
 * ⚠️ 우선순위는 **입력 배열 순서 하나뿐**이다. 선택·호버 상태를 우선순위에 넣으면 선을 클릭할
 *    때마다 다른 라벨이 밀려 화면이 출렁이고, 같은 데이터가 렌더마다 다른 배치를 낸다.
 * ⚠️ 점도 같은 충돌 검사를 통과한 자리에만 놓는다. 점이 장애물을 무시하면 라벨보다 더 잘 숨는다.
 */
export function layoutFlowLabels(
  items: { id: string; cx: number; cy: number; w: number; h: number }[] | undefined | null,
  obstacles: { x: number; y: number; w: number; h: number }[] | undefined | null,
): FlowLabelPlacement[] {
  const list = Array.isArray(items) ? items : [];
  const walls = (Array.isArray(obstacles) ? obstacles : []).filter(
    o => o && isFiniteNum(o.x) && isFiniteNum(o.y) && isFiniteNum(o.w) && isFiniteNum(o.h),
  );
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const res: FlowLabelPlacement[] = [];
  const free = (box: { x: number; y: number; w: number; h: number }) => {
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
    // ⚠️ 첫 후보는 **오프셋 0**이다 — 충돌이 없으면 종전과 정확히 같은 자리에 놓인다.
    // ⚠️ ±3단까지 훑는다 — 기본 도형 높이가 120이라 ±2단(약 52px)으로는 선이 도형을 관통할 때
    //    빠져나오지 못하고 전부 점으로 강등된다.
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
    // 어디에도 못 놓으면 기본 자리에 점만 — '메모가 있다'는 사실은 반드시 남긴다.
    if (!done) res.push({ id: it.id, mode: 'dot', x: it.cx, y: it.cy });
  }
  return res;
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
