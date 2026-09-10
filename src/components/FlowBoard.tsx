// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, RotateCcw, Maximize2, Save, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import FlowCanvas from './FlowCanvas';
import FlowInspector from './FlowInspector';
import FlowNodeEditor from './FlowNodeEditor';
import { useFlowMapData } from '../hooks/useFlowMapData';
import {
  makeFlowMap, makeFlowNode, removeNode, resolveFlowNodeView,
  countDanglingNodes, MAX_FLOW_NODES, MAX_FLOW_EDGES, MAX_FLOW_MAPS, MAX_FLOW_MAP_NAME,
  DEFAULT_FLOW_VIEWPORT, normalizeFlowViewport, sameFlowViewport, fitFlowViewport,
  addFlowMap, duplicateFlowMap, removeFlowMap, renameFlowMap, moveFlowMap, flowBundleEnabled,
} from '../flowMap';
import { generateId, formatCurrency } from '../utils';

/**
 * 자금 흐름도 보드 — 전체화면 오버레이.
 *
 * ── 마운트 위치 ──────────────────────────────────────────────────────────────
 * App 메인 return의 **최상위 형제**(CalendarModal 옆). 두 가지는 절대 하지 말 것:
 *  1) DividendTaxPage식 early-return 페이지 — ConfirmDialog·LoadingOverlay·플로팅 창이
 *     전부 언마운트되어 confirm()이 영원히 resolve되지 않는 Promise가 된다.
 *  2) 뷰 분기 안(개별/통합) in-flow 배치 — max-w 래퍼에 갇히고 계좌 탭 전환마다 언마운트되어
 *     팬/줌·선택 상태가 초기화된다.
 *
 * ── z-index = 990 ────────────────────────────────────────────────────────────
 * ConfirmDialog(1000)보다 **아래**여야 도형 삭제 확인창이 보드 위에 뜬다. 1050대(메모 달력·
 * 계산기·관심종목)에 두면 그 기능들이 겪은 "창 위에선 confirm/notify가 가려진다" 문제를
 * 그대로 재현하고, 결국 확인 없는 즉시 삭제로 후퇴하게 된다.
 * 알려진 한계(수용): 벨 알림 팝업(z-999)과 리밸런싱 투자기록 창(z-1000/1010)은 보드 위에 뜬다.
 *
 * ── 저장 정책 (⚠️ 회귀 주의) ─────────────────────────────────────────────────
 * 편집은 **로컬 사본**(mapsLocal)에 모으고 ① 2.5초 idle ② 보드 닫기 ③ 종료/수동저장 커밋
 * 시점에만 App state로 승격한다. 제스처마다 승격하면 App의 portfolioStructureKey가 전 계좌를
 * 재직렬화하고, 800ms 디바운스는 사람 손 간격(1~3초)보다 짧아 매번 만료되어 제스처마다
 * Drive 저장(STATE+VERSION+STOCK+MARKET = HTTP 8회 + 종목 2년치 일봉 전량)이 나간다.
 *
 * ── 팬/줌도 저장한다 (⚠️ 회귀 주의) ─────────────────────────────────────────
 * 저장 위치는 **map.viewport**(flowMaps 안) → 영속화 신규 지점 0곳. 규약 셋을 함께 지켜야 한다:
 *  1) 사용자가 실제로 움직였을 때만(vpTouchedRef) 커밋 — 복원·자동 맞춤은 커밋하지 않는다.
 *     아니면 '보드를 열기만 해도 Drive 저장'이 된다.
 *  2) dirtyRef(내용 편집)가 아니라 **vpDirtyRef**를 세운다 — dirtyRef는 늦게 도착한 Drive
 *     데이터 채택을 막는 가드라, 화면만 훑어도 그게 서면 시드된 빈 맵이 저장본을 덮는다.
 *  3) flush가 항상 직전 화면을 먼저 반영한다 — 디바운스가 안 터진 채 닫아도 위치가 남는다.
 *
 * ── 시트(다중 흐름도) (⚠️ 회귀 주의) ────────────────────────────────────────
 * flowMaps는 처음부터 **배열**이었지만 화면이 `maps[0]` 하나로 고정돼 있었다. 지금은 하단
 * 탭 바로 시트를 추가·복제·이름변경·순서이동·삭제한다(엑셀 시트 metaphor, 사용자 요청 2026-09).
 * 지켜야 하는 것 셋:
 *  1) 편집·팬줌 커밋은 **활성 시트 id 기준**(activeIdRef)이다. `prev[0]`으로 되돌리면 2번 시트를
 *     보면서 그린 도형이 1번 시트에 꽂힌다. 대상이 사라졌으면 조용한 no-op이 되는 것도 이 방식의
 *     안전장치다(patchNodeById와 같은 규약).
 *  2) 시트를 바꾸기 **전에** 떠나는 시트의 미승격 화면을 커밋하고, 새 시트의 저장 화면을
 *     setViewport(applyViewport 아님)로 복원하며 vpTouchedRef를 내린다. 안 그러면 A 시트의
 *     팬/줌이 B 시트에 기록된다.
 *  3) 활성 시트 선택은 **세션 로컬**이다(저장하지 않는다) — 인앱 보드와 별도 창이 같은 flowMaps를
 *     공유하므로, 저장하면 한쪽에서 시트를 바꿀 때 다른 쪽 화면이 따라 움직인다.
 */

const FLOW_Z = 990;
const IDLE_PROMOTE_MS = 2500;
/**
 * 팬/줌을 로컬 사본에 반영하기까지의 디바운스.
 * ⚠️ 프레임마다 커밋하지 말 것 — 훑어보는 동안 updatedAt이 매 프레임 갱신되고 도형을 하나도
 *    건드리지 않은 세션이 계속 '저장 대기'로 깜빡인다. 대신 flush(닫기·종료·수동저장)가 항상
 *    직전 화면을 먼저 반영하므로 디바운스가 안 터진 채 닫아도 위치는 남는다.
 */
const VIEWPORT_COMMIT_MS = 900;

/** 캔버스 가시 영역 근사 — 인스펙터 폭(256)과 툴바 높이를 뺀다. '맞춤' 버튼과 첫 화면이 공유. */
const canvasBox = () => ({
  w: (typeof window !== 'undefined' ? window.innerWidth : 1440) - 300,
  h: (typeof window !== 'undefined' ? window.innerHeight : 900) - 140,
});

/**
 * 보드를 열 때 보여줄 화면.
 * 저장된 위치가 있으면 그대로, 없으면(이 기능 이전에 만든 흐름도) 전체가 보이게 1회 맞춘다 —
 * 그 경우가 정확히 "닫았다 열면 엉뚱한 데를 보고 있다"는 사용자 보고의 상황이다.
 */
/** 배열에서 id로 시트를 찾는다(없으면 null). 커밋 경로가 **인덱스가 아니라 id**로 도는 근거. */
const findMap = (arr, id) => (Array.isArray(arr) ? arr.find(m => m?.id === id) : null) || null;

const initialViewportOf = (m) => {
  const saved = normalizeFlowViewport(m?.viewport);
  if (saved) return saved;
  const box = canvasBox();
  return fitFlowViewport(m?.nodes, box.w, box.h);
};

export default function FlowBoard({
  open,
  onClose,
  maps,
  onUpdateMaps,     // (updater: prev => next) — ⚠️ functional updater 계약
  flushRef,         // App이 종료·수동저장 시 미승격 편집을 동기 회수하는 슬롯
  portfolios,
  portfolioSummaries,
  hideAmounts,
  confirm,
  readOnly = false, // 관리자 impersonation 등
  // 'overlay' = 앱 안의 전체화면 오버레이 / 'page' = 별도 브라우저 창(FlowWindow)
  // ⚠️ page 모드에는 ConfirmDialog가 없다(App이 마운트되지 않음) → confirm 미전달 시 즉시 삭제.
  //    메모 달력 별도 창과 동일 규약(창 위에서는 확인창을 띄울 수 없다).
  variant = 'overlay',
  headerNotice = null,
}) {
  const [mapsLocal, setMapsLocal] = useState(maps);
  const [selectedId, setSelectedId] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [viewport, setViewport] = useState(() => ({ ...DEFAULT_FLOW_VIEWPORT }));
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  /**
   * 도형 정렬 스냅 on/off — **세션 로컬**(저장하지 않는다).
   * 뷰 선호도이고 클릭 한 번으로 복구되므로 chartPrefs·flowMaps 어느 쪽에도 올리지 않는다
   * (showTaxHelp·sidebarOpen과 같은 등급). 한 번만 끄고 싶을 때는 Alt(또는 Cmd)를 누른 채 끈다.
   */
  const [snapOn, setSnapOn] = useState(true);
  /**
   * 메모·표 편집 팝업. `{ nodeId, tab }` — **id로 들고** 있어야 그 사이 시트를 바꾸거나 도형이
   * 지워져도 엉뚱한 도형에 쓰지 않는다(대상이 사라지면 아래에서 조용히 닫힌다).
   */
  const [editor, setEditor] = useState(null);

  // ── 시트 ────────────────────────────────────────────────────────────────────
  // ⚠️ 활성 시트는 **세션 로컬**(저장하지 않는다 — 위 헤더 주석 3번). 커밋 경로가 읽는 것은
  //    state가 아니라 activeIdRef다(이벤트 핸들러·타이머에서 동기로 읽어야 하기 때문).
  const [activeId, setActiveId] = useState(null);
  const activeIdRef = useRef(null);
  const [renameId, setRenameId] = useState(null);     // 이름 편집 중인 시트
  const [renameDraft, setRenameDraft] = useState(''); // 원시 문자열 draft(커밋은 blur/Enter)
  // ⚠️ 편집 위치 판별자. 툴바 제목과 하단 탭이 **같은 `renameId`**를 공유하므로, 이게 없으면
  //    두 입력이 동시에 마운트돼 같은 시트 이름을 두 칸에서 고치게 된다(어느 쪽 blur가 이기는지
  //    브라우저가 정한다). 탭 기본값 'tab', 제목은 'title'.
  const [renameWhere, setRenameWhere] = useState('tab');
  const renameCancelRef = useRef(false);
  const [delArmId, setDelArmId] = useState(null);     // 별도 창(confirm 없음)용 인라인 2단계 확인
  const delArmRef = useRef(null);
  delArmRef.current = delArmId;

  const localRef = useRef(maps);
  const dirtyRef = useRef(false);
  const idleTimerRef = useRef(null);
  const onUpdateRef = useRef(onUpdateMaps);
  onUpdateRef.current = onUpdateMaps;

  // ── 팬/줌 영속화 ────────────────────────────────────────────────────────────
  // ⚠️ dirtyRef(내용 편집)와 **별도 플래그**를 쓴다. dirtyRef는 '늦게 도착한 Drive 데이터 채택'을
  //    막는 가드라, 화면을 훑기만 해도 그게 서면 로딩 중 연 보드가 시드한 빈 맵을 저장된 흐름도
  //    위에 덮어쓴다(복구 불가). 뷰포트는 vpDirtyRef만 세운다.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const vpDirtyRef = useRef(false);   // 미승격 팬/줌 변경
  const vpTouchedRef = useRef(false); // 이 세션에서 사용자가 실제로 화면을 움직였는가
  const vpTimerRef = useRef(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // flush → commitViewport → patchMap → commit → flush 순환을 끊는 ref(onUpdateRef와 같은 패턴)
  const commitViewportRef = useRef(null);

  /** 사용자 제스처로 화면이 움직였음을 표시하며 반영. ⚠️ 복원·자동 맞춤은 이 경로를 쓰지 않는다. */
  const applyViewport = useCallback((vp) => {
    vpTouchedRef.current = true;
    setViewport(vp);
  }, []);

  // 보드를 열 때만 App state로부터 로컬 사본을 시드한다.
  // (열려 있는 동안의 외부 갱신은 채택하지 않는다 — 저장소 전역이 last-writer-wins 계약이고,
  //  편집 중 폴링 결과로 화면이 튀는 것이 더 나쁘다.)
  useEffect(() => {
    if (!open) return;
    const seeded = Array.isArray(maps) && maps.length > 0 ? maps : [makeFlowMap('자금 흐름도')];
    setMapsLocal(seeded);
    localRef.current = seeded;
    dirtyRef.current = false;
    vpDirtyRef.current = false;
    vpTouchedRef.current = false;
    setDirty(false);
    setSelectedId(null);
    setConnectFrom(null);
    // 항상 첫 시트로 연다(활성 시트는 저장하지 않는다 — 헤더 주석 3번).
    activeIdRef.current = seeded[0]?.id || null;
    setActiveId(activeIdRef.current);
    setRenameId(null);
    setDelArmId(null);
    // ⚠️ 마지막으로 보던 화면 복원. setViewport(applyViewport 아님) — 복원 자체는 사용자 동작이
    //    아니므로 touched를 세우면 안 된다(열기만 해도 Drive 저장이 나간다).
    setViewport(initialViewportOf(seeded[0]));
    const dang = countDanglingNodes(seeded, portfolios);
    setNotice(dang > 0 ? `계좌 연결 ${dang}건이 끊겨 있습니다(계좌가 삭제됐거나 백업으로 교체됨).` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ⚠️ 아직 편집을 시작하지 않았으면 **늦게 도착한 App state를 채택**한다.
  //    LoadingOverlay는 로드 완료와 무관하게 20초 뒤 자동 해제되므로, 느린 회선에서 Drive의
  //    flowMaps가 도착하기 전에 보드를 열면 위 시딩이 '빈 맵 1장'을 만든다. 그 상태로 도형 하나만
  //    그려도 2.5초 뒤 승격이 **저장돼 있던 흐름도 전체를 빈 맵으로 대체**한다(복구 불가).
  //    편집 중(dirty)일 때는 채택하지 않는다 — 그건 기존의 의도된 last-writer-wins다.
  useEffect(() => {
    if (!open || dirtyRef.current) return;
    if (!Array.isArray(maps) || maps.length === 0) return;
    if (maps === localRef.current) return;
    localRef.current = maps;
    setMapsLocal(maps);
    // ⚠️ 늦게 도착한 배열에는 시드가 만든 임시 시트 id가 없다 → 활성 시트를 유효한 것으로 되돌린다.
    //    안 하면 activeId가 어디에도 없는 id를 가리켜, 아래 `map` 폴백 덕에 화면은 1번 시트를
    //    보여주는데 커밋은 findIndex 실패로 전부 조용한 no-op이 된다(그리는데 아무것도 안 남는다).
    if (!maps.some(m => m?.id === activeIdRef.current)) {
      activeIdRef.current = maps[0]?.id || null;
      setActiveId(activeIdRef.current);
      setSelectedId(null);
      setConnectFrom(null);
    }
    // 아직 사용자가 화면을 움직이지 않았다면 늦게 도착한 **저장 위치**도 함께 채택한다.
    // (움직였다면 그 화면을 유지하고, 디바운스가 채택한 맵 위에 다시 커밋한다.)
    if (!vpTouchedRef.current) setViewport(initialViewportOf(findMap(maps, activeIdRef.current) || maps[0]));
  }, [open, maps]);

  // ⚠️ 미승격 편집이 없으면 반드시 null — 항상 값을 반환하면 alt-tab마다 4파일 write가 강제된다.
  const flush = useCallback(() => {
    // ⚠️ 디바운스가 아직 안 터졌어도 **닫는 순간의 화면**이 저장되도록 뷰포트를 먼저 반영한다.
    //    commit은 localRef를 동기 갱신하므로 바로 아래에서 읽어도 최신값이다.
    commitViewportRef.current?.();
    if (!dirtyRef.current && !vpDirtyRef.current) return null;
    dirtyRef.current = false;
    vpDirtyRef.current = false;
    setDirty(false);
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    if (vpTimerRef.current) { clearTimeout(vpTimerRef.current); vpTimerRef.current = null; }
    return localRef.current;
  }, []);

  // ⚠️ 언마운트 시 반드시 null로 되돌린다(ErrorBoundary fallback·게이팅 OFF 포함) —
  //    죽은 클로저가 낡은 배열을 fresh portfolioUpdatedAt과 함께 Drive에 되쓰는 것을 막는다.
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => { flushRef.current = null; };
  }, [flushRef, flush]);

  const promoteNow = useCallback(() => {
    const next = flush();
    if (next) onUpdateRef.current?.(() => next);
  }, [flush]);

  // 편집 커밋 — 로컬 사본만 갱신하고 idle 타이머를 재무장한다.
  // ⚠️ setState 업데이터 **안에서** 계산하지 않는다. localRef가 로컬 사본의 단일 소스이므로
  //    거기서 next를 만들고 setMapsLocal에는 완성된 값만 넘긴다. 업데이터 안에서 ref를 대입하거나
  //    generateId()를 부르면 StrictMode 개발 모드의 업데이터 이중 호출에서 서로 다른 id가 만들어지고
  //    (React는 두 번째 결과만 채택) 첫 호출의 부수효과가 남아 선택 상태가 어긋난다.
  const commit = useCallback((updater, opts) => {
    if (readOnly) return;
    const prev = localRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    localRef.current = next;
    // ⚠️ viewportOnly는 dirtyRef를 세우지 않는다 — 위 '늦게 도착한 App state 채택' 가드가 그
    //    플래그를 보기 때문. 세우면 로딩 중 화면을 훑기만 해도 빈 맵이 저장본을 덮는다.
    if (opts && opts.viewportOnly) vpDirtyRef.current = true;
    else dirtyRef.current = true;
    setMapsLocal(next);
    setDirty(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      const promoted = flush();
      if (promoted) onUpdateRef.current?.(() => promoted);
    }, IDLE_PROMOTE_MS);
  }, [readOnly, flush]);

  // 언마운트 정리. ⚠️ 미승격 편집이 있으면 **상위로 올리고** 사라진다 —
  //    보드는 flowAccess가 false로 바뀌거나(관리자가 기능을 끔) ErrorBoundary가 fallback으로
  //    교체할 때 언마운트되는데, 그냥 사라지면 idle 타이머가 취소되고 flushRef도 null이 되어
  //    App이 회수할 방법이 없다(사용자가 방금 그린 도형이 조용히 증발).
  useEffect(() => () => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    if (vpTimerRef.current) { clearTimeout(vpTimerRef.current); vpTimerRef.current = null; }
    // ⚠️ 미승격 뷰포트도 함께 회수한다(commit이 localRef를 동기 갱신하므로 순서가 중요).
    commitViewportRef.current?.();
    if (!dirtyRef.current && !vpDirtyRef.current) return;
    dirtyRef.current = false;
    vpDirtyRef.current = false;
    const pending = localRef.current;
    onUpdateRef.current?.(() => pending);
  }, []);

  // ⚠️ 활성 시트가 사라졌으면 첫 시트로 폴백해 **그리기는 계속 되게** 한다(빈 화면 방지).
  //    다만 커밋 경로는 폴백하지 않는다 — 아래 patchMap은 activeIdRef를 못 찾으면 no-op이다.
  const map = findMap(mapsLocal, activeId) || mapsLocal?.[0];
  const { portfolioById, summaryById, accountOptions } = useFlowMapData(open, portfolios, portfolioSummaries);

  // ⚠️ **활성 시트 id 기준** 패치. `prev[0]`으로 되돌리면 2번 시트를 보면서 그린 도형이 1번
  //    시트에 꽂힌다(화면과 저장이 갈리는 최악의 형태 — 사용자는 한참 뒤에야 알아챈다).
  const patchMap = useCallback((fn) => {
    const id = activeIdRef.current;
    commit(prev => {
      const idx = Array.isArray(prev) ? prev.findIndex(m => m?.id === id) : -1;
      if (idx < 0) return prev;
      const cur = prev[idx];
      const nextMap = fn(cur);
      if (nextMap === cur) return prev;
      const out = prev.slice();
      out[idx] = { ...nextMap, updatedAt: Date.now() };
      return out;
    });
  }, [commit]);

  // 현재 화면 위치를 로컬 사본에 반영. ⚠️ patchMap을 쓰지 않는다 — updatedAt('마지막 편집')은
  //    도형·선을 고쳤을 때만 갱신해야 한다(화면을 훑은 것은 편집이 아니다).
  const commitViewport = useCallback(() => {
    if (vpTimerRef.current) { clearTimeout(vpTimerRef.current); vpTimerRef.current = null; }
    // ⚠️ 사용자가 실제로 움직였을 때만 저장한다 — 복원값·자동 맞춤을 커밋하면 '보드를 열기만 해도
    //    Drive 저장'이 되고, 구버전 맵의 자동 맞춤 결과가 사용자 동의 없이 박제된다.
    if (readOnlyRef.current || !vpTouchedRef.current) return;
    const vp = normalizeFlowViewport(viewportRef.current);
    if (!vp) return;
    // ⚠️ 시트 전환은 이 함수를 **먼저** 부른 뒤 activeIdRef를 바꾼다 → 여기서는 항상 '떠나기 전
    //    시트'가 대상이다. 인덱스(prev[0])로 되돌리면 A 시트의 팬/줌이 B 시트에 기록된다.
    const id = activeIdRef.current;
    commit(prev => {
      const idx = Array.isArray(prev) ? prev.findIndex(m => m?.id === id) : -1;
      if (idx < 0) return prev;
      const cur = prev[idx];
      if (sameFlowViewport(cur.viewport, vp)) return prev;   // no-op이면 원본 참조
      const out = prev.slice();
      out[idx] = { ...cur, viewport: vp };
      return out;
    }, { viewportOnly: true });
  }, [commit]);
  commitViewportRef.current = commitViewport;

  // 팬/줌 디바운스 — 마지막 움직임에서 VIEWPORT_COMMIT_MS 뒤 1회만 반영한다.
  useEffect(() => {
    if (!open || readOnly || !vpTouchedRef.current) return;
    if (vpTimerRef.current) clearTimeout(vpTimerRef.current);
    vpTimerRef.current = setTimeout(() => {
      vpTimerRef.current = null;
      commitViewportRef.current?.();
    }, VIEWPORT_COMMIT_MS);
    return () => { if (vpTimerRef.current) { clearTimeout(vpTimerRef.current); vpTimerRef.current = null; } };
  }, [open, readOnly, viewport]);

  const viewOf = useCallback(
    (node) => resolveFlowNodeView(node, portfolioById.get(node.portfolioId), summaryById.get(node.portfolioId)),
    [portfolioById, summaryById],
  );

  // ⚠️ 항상 원화. `portfolioSummaries[].currentEval`은 해외계좌도 **원화로 환산된 값**이라
  //    accountType==='overseas'일 때 '$'를 붙이면 원화 금액에 달러 기호가 붙어 약 1,390배로
  //    오표시된다(USD로 보이려면 별도 USD 소스가 필요한데 그건 이 뷰의 소스가 아니다).
  const formatAmount = useCallback((v) => formatCurrency(v), []);

  // ⚠️ 노드/엣지 생성(generateId)과 선택 변경은 업데이터 **밖**에서 수행한다(위 commit 주석 참조).
  const addNode = useCallback((kind) => {
    const cur = findMap(localRef.current, activeIdRef.current);
    if (!cur) return;
    if (cur.nodes.length >= MAX_FLOW_NODES) {
      setNotice(`도형은 최대 ${MAX_FLOW_NODES}개까지 만들 수 있습니다.`);
      return;
    }
    // 화면 중앙 근처에 겹치지 않게 배치
    const base = { x: Math.round((-viewport.x + 320) / viewport.scale), y: Math.round((-viewport.y + 220) / viewport.scale) };
    const off = (cur.nodes.length % 6) * 28;
    const n = makeFlowNode({ kind, x: base.x + off, y: base.y + off });
    patchMap(m => ({ ...m, nodes: [...m.nodes, n] }));
    setSelectedId(n.id);
  }, [patchMap, viewport]);

  const onNodesChange = useCallback((nodes) => patchMap(cur => ({ ...cur, nodes })), [patchMap]);

  /**
   * 연결선 합치기 토글 — 시트 단위 저장 필드다.
   * ⚠️ **켤 때는 `true`를 쓰지 말고 필드를 지운다**(생략 = 켜짐). `true`를 저장하면 정규화가
   *    그것을 생략형으로 되돌리려 매 로드 재구축 경로로 떨어지는데, 지문은 양쪽이 같아
   *    그 정리가 영영 저장되지 않는다(무한 churn).
   * ⚠️ 팬/줌과 달리 `viewportOnly` 커밋이 아니다 — 이건 저장 필드를 바꾸는 **내용 편집**이라
   *    도형을 추가하는 것과 같은 등급으로 dirty를 세우는 것이 맞다.
   */
  const toggleBundle = useCallback(() => {
    patchMap(cur => {
      if (flowBundleEnabled(cur.bundleEdges)) return { ...cur, bundleEdges: false };
      const next = { ...cur };
      delete next.bundleEdges;
      return next;
    });
  }, [patchMap]);

  const onAddEdge = useCallback((from, to) => {
    const cur = findMap(localRef.current, activeIdRef.current);
    if (!cur) return;
    if (cur.edges.length >= MAX_FLOW_EDGES) {
      setNotice(`연결선은 최대 ${MAX_FLOW_EDGES}개까지 만들 수 있습니다.`);
      return;
    }
    if (cur.edges.some(e => e.from === from && e.to === to)) return; // 같은 방향 중복 연결 금지
    // ⚠️ 기본값(lineStyle 'solid' · lineWidth 'normal')은 **넣지 않는다** — 생략이 곧 기본값이라
    //    normalizeFlowMaps가 새 선을 '변경됨'으로 보지 않는다(원본 참조 보존). 레거시 `dashed`도 금지.
    const e = { id: generateId(), from, to, label: '', arrow: 'to' };
    patchMap(m => ({ ...m, edges: [...m.edges, e] }));
    setSelectedId(`edge:${e.id}`);
  }, [patchMap]);

  // 팝업이 연 도형을 **매 렌더 id로 다시 찾는다**(스냅샷을 들고 있으면 편집 중 다른 창·폴링이
  // 계좌를 바꿔도 옛 값이 화면에 남는다). 대상이 사라지면 null → 아래 effect가 팝업을 닫는다.
  const editorNode = editor && map ? map.nodes.find(n => n.id === editor.nodeId) || null : null;
  useEffect(() => { if (editor && !editorNode) setEditor(null); }, [editor, editorNode]);

  const selNode = map && selectedId && !String(selectedId).startsWith('edge:')
    ? map.nodes.find(n => n.id === selectedId) : null;
  const selEdge = map && String(selectedId || '').startsWith('edge:')
    ? map.edges.find(e => e.id === String(selectedId).slice(5)) : null;

  // 선택된 선의 양 끝 도형 **이름**(라이브 파생 — 저장하지 않는다). 인스펙터가 화살촉 방향을
  // '자금 흐름: A → B'로 풀어 쓰는 데 쓴다. 선을 그은 순서를 사용자가 기억할 리 없어서,
  // 이름이 없으면 '시작/끝'이 어느 쪽인지 알 방법이 화면에 없다.
  const edgeEndName = (id) => {
    const n = map?.nodes?.find(x => x.id === id);
    return n ? (viewOf(n).displayName || '(이름 없음)') : '(삭제된 도형)';
  };
  const selEdgeEnds = selEdge ? { from: edgeEndName(selEdge.from), to: edgeEndName(selEdge.to) } : null;

  // ⚠️ **id 기준** 패치 — 현재 선택(selNode)에 바인딩하면 인스펙터의 미커밋 draft가 '새로 선택된'
  //    도형에 기록된다(타이핑 중 다른 도형 클릭 시 그쪽 이름이 덮어써짐). 대상이 이미 사라졌으면
  //    조용히 no-op이 되는 것도 이 방식의 안전장치다.
  const patchNodeById = useCallback((id, o) => {
    if (!id) return;
    patchMap(cur => {
      const idx = cur.nodes.findIndex(n => n.id === id);
      if (idx < 0) return cur;
      const nodes = cur.nodes.slice();
      nodes[idx] = { ...nodes[idx], ...o };
      return { ...cur, nodes };
    });
  }, [patchMap]);

  const patchEdgeById = useCallback((id, o) => {
    if (!id) return;
    patchMap(cur => {
      const idx = cur.edges.findIndex(e => e.id === id);
      if (idx < 0) return cur;
      const edges = cur.edges.slice();
      edges[idx] = { ...edges[idx], ...o };
      return { ...cur, edges };
    });
  }, [patchMap]);

  const deleteNode = useCallback(async (id) => {
    // ConfirmDialog(z-1000)가 보드(990)보다 위라 정상적으로 보인다 — 즉시 삭제로 후퇴하지 말 것.
    const okDel = confirm ? await confirm('이 도형과 연결된 선을 삭제할까요?', '삭제') : true;
    if (!okDel) return;
    patchMap(cur => removeNode(cur, id));
    setSelectedId(null);
  }, [confirm, patchMap]);

  const deleteEdge = useCallback(async (id) => {
    const okDel = confirm ? await confirm('이 연결선을 삭제할까요?', '삭제') : true;
    if (!okDel) return;
    patchMap(cur => ({ ...cur, edges: cur.edges.filter(e => e.id !== id) }));
    setSelectedId(null);
  }, [confirm, patchMap]);

  const closeBoard = useCallback(() => {
    promoteNow();
    setConnectFrom(null);
    onClose?.();
  }, [promoteNow, onClose]);

  // ⚠️ 첫 화면 자동 맞춤과 **같은 함수**(fitFlowViewport)를 쓴다 — 손계산으로 되돌리면 같은
  //    데이터인데 '열었을 때'와 '맞춤 버튼'이 다른 화면을 준다.
  const fitView = useCallback(() => {
    const box = canvasBox();
    applyViewport(fitFlowViewport(findMap(localRef.current, activeIdRef.current)?.nodes, box.w, box.h));
  }, [applyViewport]);

  const resetView = useCallback(() => applyViewport({ ...DEFAULT_FLOW_VIEWPORT }), [applyViewport]);

  /* ── 시트 조작 ──────────────────────────────────────────────────────────────
   * ⚠️ 배열 변형은 전부 flowMap.ts의 순수 함수(addFlowMap·duplicateFlowMap·…)를 쓴다.
   *    여기서 손으로 splice 하면 '변경 없으면 원본 참조' 계약이 깨져 아무 일도 없는 클릭마다
   *    Drive 저장이 나가고, 무엇보다 복제의 **id 재매핑**을 빠뜨리기 쉽다(사본의 연결선이 다음
   *    로드에서 통째로 사라진다 — duplicateFlowMap 주석 참조).
   * ⚠️ generateId를 부르는 순수 함수는 commit **업데이터 밖**에서 호출한다(StrictMode 이중 호출). */

  /**
   * 시트 전환. 순서가 곧 계약이다:
   *   ① 떠나는 시트의 미승격 화면 커밋(activeIdRef를 바꾸기 **전에**)
   *   ② 활성 id 교체 + 선택/연결 초기화
   *   ③ 새 시트의 저장 화면 복원 — setViewport(applyViewport 아님) + vpTouchedRef 리셋.
   *      applyViewport로 되돌리면 '탭을 눌렀을 뿐인데 Drive 저장'이 되고, 리셋을 빼먹으면
   *      복원값이 곧바로 새 시트에 다시 기록된다.
   */
  const switchSheet = useCallback((id) => {
    if (!id || id === activeIdRef.current) return;
    commitViewportRef.current?.();
    activeIdRef.current = id;
    setActiveId(id);
    setSelectedId(null);
    setConnectFrom(null);
    setRenameId(null);
    setDelArmId(null);
    vpTouchedRef.current = false;
    setViewport(initialViewportOf(findMap(localRef.current, id)));
  }, []);

  const addSheet = useCallback(() => {
    if (readOnly) return;
    const prev = localRef.current;
    const next = addFlowMap(prev);
    if (next === prev) { setNotice(`시트는 최대 ${MAX_FLOW_MAPS}장까지 만들 수 있습니다.`); return; }
    const created = next[next.length - 1];
    commit(() => next);
    switchSheet(created.id);
  }, [readOnly, commit, switchSheet]);

  const duplicateSheet = useCallback((id) => {
    if (readOnly) return;
    const prev = localRef.current;
    // ⚠️ duplicateFlowMap의 no-op 사유는 '상한 초과'와 '없는 id' 둘이다 — 뭉뚱그려 상한 안내를
    //    띄우면 있지도 않은 이유를 단언하게 된다. 상한만 미리 판정하고 나머지는 조용히 no-op.
    if ((prev?.length || 0) >= MAX_FLOW_MAPS) { setNotice(`시트는 최대 ${MAX_FLOW_MAPS}장까지 만들 수 있습니다.`); return; }
    const next = duplicateFlowMap(prev, id);
    if (next === prev) return;
    const created = next[next.findIndex(m => m.id === id) + 1];
    commit(() => next);
    switchSheet(created.id);
  }, [readOnly, commit, switchSheet]);

  const moveSheet = useCallback((id, delta) => {
    if (readOnly) return;
    commit(prev => moveFlowMap(prev, id, delta));
  }, [readOnly, commit]);

  /**
   * 시트 삭제 — 도형·선이 통째로 사라지고 undo가 없다.
   * ⚠️ overlay는 ConfirmDialog(z-1000 > 보드 990), page(별도 창)는 App이 없어 확인창이 뜨지
   *    않으므로 **인라인 2단계**로 되받는다(백테스트·가계부 별도 창과 같은 근거). 확인 없는
   *    즉시 삭제로 후퇴하지 말 것.
   */
  const deleteSheet = useCallback(async (id) => {
    if (readOnly) return;
    const prev = localRef.current;
    const target = findMap(prev, id);
    if (!target) return;
    if ((prev?.length || 0) <= 1) { setNotice('시트는 최소 한 장이 남아 있어야 합니다.'); return; }
    const msg = `'${target.name}' 시트를 삭제할까요? 도형 ${target.nodes?.length || 0}개와 선 ${target.edges?.length || 0}개가 함께 사라집니다.`;
    if (confirm) {
      if (!(await confirm(msg, '삭제'))) return;
    } else if (delArmRef.current !== id) {
      setDelArmId(id);
      setNotice(`${msg} 삭제 버튼을 한 번 더 누르세요.`);
      return;
    }
    const cur = localRef.current;
    const next = removeFlowMap(cur, id);
    if (next === cur) return;
    setDelArmId(null);
    setNotice('');
    commit(() => next);
    if (activeIdRef.current === id) {
      const idx = cur.findIndex(m => m.id === id);
      switchSheet((next[Math.min(idx, next.length - 1)] || next[0]).id);
    }
  }, [readOnly, confirm, commit, switchSheet]);

  const startRename = useCallback((m, where) => {
    if (readOnly || !m) return;
    renameCancelRef.current = false;
    setRenameWhere(where === 'title' ? 'title' : 'tab');
    setRenameId(m.id);
    setRenameDraft(m.name || '');
  }, [readOnly]);

  /** ⚠️ Escape 취소는 ref 플래그로 판정한다 — 입력이 언마운트될 때 브라우저가 blur를 발화하지
   *    않는 경우가 있어(그때만 커밋되면 취소가 무작위로 실패한다) 상태로 판정할 수 없다. */
  const commitRename = useCallback((id) => {
    const cancelled = renameCancelRef.current;
    renameCancelRef.current = false;
    setRenameId(null);
    if (cancelled || readOnly) return;
    commit(prev => renameFlowMap(prev, id, renameDraft));
  }, [readOnly, commit, renameDraft]);

  // ⚠️ 보드 키를 **먼저 처리한 뒤** stopPropagation 한다. 그냥 흘려보내면 FloatingCalculator가
  //    열려 있을 때 그 window keydown 핸들러가 Delete/Escape/화살표를 수식 입력으로 삼킨다
  //    (그쪽 가드는 input/textarea/select/contentEditable뿐이라 svg·button은 무방비).
  //    비활동 감지는 App에서 document 캡처 단계로 등록해 두었으므로 이 stopPropagation의 영향을 받지 않는다.
  const onKeyDownCapture = (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
    // ⚠️ 시트 이름 입력은 **자기 핸들러가** Enter(커밋)·Escape(취소)를 처리한다. 여기서 일반
    //    `typing` 분기로 흘려보내면 Escape가 target.blur()를 먼저 부르고, 그 blur가 커밋으로
    //    이어져 '취소'가 오히려 저장이 된다.
    if (e.target?.dataset?.flowSheetRename !== undefined) {
      if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
      return;
    }
    if (!typing) {
      if (e.key === 'Escape') {
        // 한 단계씩: 연결 취소 → 선택 해제 → 보드 닫기
        if (connectFrom) setConnectFrom(null);
        else if (selectedId) setSelectedId(null);
        else closeBoard();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !readOnly) {
        if (selNode) deleteNode(selNode.id);
        else if (selEdge) deleteEdge(selEdge.id);
      }
    } else if (e.key === 'Escape') {
      e.target.blur?.();
    }
    // ⚠️ **보드가 실제로 소비한 키에만** 전파를 끊는다. 무조건 stopPropagation 하면 React 18이
    //    root에 붙인 캡처 리스너에서 네이티브 이벤트가 멈춰 타깃까지 내려가지 못하고, 그 결과
    //    하위의 bubble onKeyDown이 전부 죽는다 → 인스펙터의 Enter 커밋(`e.currentTarget.blur()`)이
    //    먹통이 되고, 사용자는 커밋했다고 믿은 채 다른 도형을 눌러 편집이 새어 나간다.
    //    계산기 window 핸들러 차단이라는 원래 목적은 이 키들만 끊어도 그대로 달성된다.
    if (e.key === 'Escape' || (!typing && (e.key === 'Delete' || e.key === 'Backspace'))) {
      e.stopPropagation();
    }
  };

  if (!open) return null;

  const nodeCount = map?.nodes?.length || 0;
  const edgeCount = map?.edges?.length || 0;
  // ⚠️ 해석은 flowBundleEnabled 공유 함수로만 — `!!map?.bundleEdges`로 읽으면 저장하지 않은
  //    기존 시트(생략 = 켜짐)가 전부 꺼진 상태로 표시된다.
  const bundleOn = flowBundleEnabled(map?.bundleEdges);

  return (
    <div
      className="fixed inset-0 flex flex-col bg-[#0b1120]"
      style={{ zIndex: FLOW_Z }}
      onKeyDownCapture={onKeyDownCapture}
    >
      {/* 툴바 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-[#0f1623] shrink-0 flex-wrap">
        {/* 좌측 상단 제목 = **활성 시트 이름**. 고쳐 쓰면 하단 탭 이름이 함께 바뀐다(같은
            `renameFlowMap` 순수 함수 = 단일 쓰기 경로). 탭은 클릭이 '전환'이라 더블클릭이지만
            제목은 다른 동작이 없어 한 번 클릭으로 연다. */}
        {renameId === map?.id && renameWhere === 'title' ? (
          <input
            data-flow-sheet-rename=""
            autoFocus
            value={renameDraft}
            maxLength={MAX_FLOW_MAP_NAME}
            onChange={e => setRenameDraft(e.target.value)}
            onBlur={() => commitRename(map.id)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.currentTarget.blur(); }
              else if (e.key === 'Escape') { renameCancelRef.current = true; setRenameId(null); }
            }}
            className="mr-1 w-44 text-sm font-semibold px-2 py-0.5 rounded border border-indigo-600 bg-[#0b1120] text-white outline-none"
          />
        ) : readOnly ? (
          <span title={map?.name || ''} className="mr-1 inline-block max-w-[240px] truncate align-middle text-sm font-semibold text-indigo-300">{map?.name || '자금 흐름도'}</span>
        ) : (
          <button
            onClick={() => startRename(map, 'title')}
            title={`${map?.name || ''} — 클릭하면 이름을 바꿉니다(하단 시트 탭에도 반영)`}
            className="mr-1 max-w-[240px] truncate text-sm font-semibold text-indigo-300 px-1 -mx-1 rounded hover:bg-gray-800 hover:text-indigo-200 transition"
          >
            {map?.name || '자금 흐름도'}
          </button>
        )}
        {!readOnly && (
          <>
            <button onClick={() => addNode('rect')} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-indigo-600 transition">
              <Plus size={12} /> 사각형
            </button>
            <button onClick={() => addNode('ellipse')} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-indigo-600 transition">
              <Plus size={12} /> 원
            </button>
          </>
        )}
        <button onClick={fitView} title="전체 보기" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white transition">
          <Maximize2 size={12} /> 맞춤
        </button>
        <button onClick={resetView} title="배율 초기화" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white transition">
          <RotateCcw size={12} /> 100%
        </button>
        {!readOnly && (
          <>
            <button
              onClick={toggleBundle}
              title={bundleOn
                ? '연결선 합치기 — 켜짐\n한 도형의 같은 면에서 같은 색·같은 종류로 나가거나 들어오는 선이 2개 이상이면 한 줄로 합쳐졌다가 각 도형 앞에서 갈라집니다.\n(색이나 선 종류가 다른 선은 구분을 지우지 않으려고 합치지 않습니다.)\n클릭하면 이 시트에서 끕니다.'
                : '연결선 합치기 — 꺼짐\n클릭하면 이 시트에서 켭니다.'}
              className={`text-[11px] px-2 py-1 rounded border transition ${bundleOn ? 'border-indigo-600 text-indigo-300 bg-indigo-900/20' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}
            >선 합치기</button>
            <button
              onClick={() => setSnapOn(v => !v)}
              title={snapOn
                ? '도형 정렬 맞춤 — 켜짐\n도형을 옮길 때 다른 도형의 왼쪽·가운데·오른쪽(위·가운데·아래) 선에 가까우면 그 선에 맞춰집니다.\nAlt(또는 Cmd)를 누른 채 옮기면 이번만 맞추지 않습니다.\n※ 이 설정은 저장되지 않습니다.'
                : '도형 정렬 맞춤 — 꺼짐\n클릭하면 켭니다. ※ 이 설정은 저장되지 않습니다.'}
              className={`text-[11px] px-2 py-1 rounded border transition ${snapOn ? 'border-indigo-600 text-indigo-300 bg-indigo-900/20' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}
            >정렬 맞춤</button>
          </>
        )}
        <span className="text-[10px] text-gray-500">도형 {nodeCount} · 선 {edgeCount}</span>

        <div className="flex-1" />

        {readOnly && <span className="text-[10px] px-2 py-0.5 rounded border border-amber-700/60 text-amber-300 bg-amber-900/30">관리자 열람 모드 — 편집 불가</span>}
        {!readOnly && (
          <button
            onClick={promoteNow}
            disabled={!dirty}
            title={dirty ? '지금 저장' : '저장됨'}
            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition ${dirty ? 'border-indigo-600 text-indigo-300 hover:bg-indigo-900/30' : 'border-gray-700 text-gray-600'}`}
          >
            <Save size={12} /> {dirty ? '저장 대기' : '저장됨'}
          </button>
        )}
        <button onClick={closeBoard} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition" title={variant === 'page' ? '창 닫기' : '닫기 (Esc)'}>
          <X size={16} />
        </button>
      </div>

      {headerNotice && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-900/20 border-b border-amber-800/40 shrink-0">
          {headerNotice}
        </div>
      )}
      {notice && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-900/20 border-b border-amber-800/40 flex items-center gap-2 shrink-0">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-amber-500 hover:text-amber-300"><X size={12} /></button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 relative">
          {/* key = 시트 id. 캔버스가 들고 있는 드래그·리사이즈·hover 로컬 상태는 노드 id를
              참조하므로, 시트를 바꿀 때 remount로 비워 다른 시트의 노드를 가리키지 않게 한다. */}
          <FlowCanvas
            key={map?.id || 'none'}
            map={map}
            viewOf={viewOf}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNodesChange={onNodesChange}
            onAddEdge={onAddEdge}
            viewport={viewport}
            onViewportChange={applyViewport}
            readOnly={readOnly}
            hideAmounts={hideAmounts}
            formatAmount={formatAmount}
            connectFrom={connectFrom}
            onConnectFromChange={setConnectFrom}
            bundleEnabled={bundleOn}
            snapEnabled={snapOn}
          />
          {nodeCount === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-gray-500 text-xs leading-relaxed">
                위의 <span className="text-gray-300">사각형</span> · <span className="text-gray-300">원</span> 버튼으로 도형을 추가하세요.<br />
                도형을 선택하면 오른쪽에서 계좌 연결·날짜·금액·메모를 입력할 수 있습니다.<br />
                도형 위 <span className="text-indigo-300">파란 점</span>을 누른 뒤 다른 도형을 클릭하면 선으로 연결됩니다.
              </div>
            </div>
          )}
          {connectFrom && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[11px] px-2 py-1 rounded bg-indigo-900/80 border border-indigo-600 text-indigo-200 pointer-events-none">
              연결할 도형을 클릭하세요 (Esc 취소)
            </div>
          )}
        </div>

        {(selNode || selEdge) && (
          <FlowInspector
            node={selNode}
            view={selNode ? viewOf(selNode) : null}
            edge={selEdge}
            edgeEnds={selEdgeEnds}
            accountOptions={accountOptions}
            onOpenEditor={(tab) => selNode && setEditor({ nodeId: selNode.id, tab })}
            onPatchNodeById={patchNodeById}
            onPatchEdgeById={patchEdgeById}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onClose={() => setSelectedId(null)}
            readOnly={readOnly}
          />
        )}
      </div>

      {/* 시트 탭 바 — 엑셀 시트 metaphor. 탭 클릭=전환 / 더블클릭=이름 변경. */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-gray-700 bg-[#0f1623] shrink-0">
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
          {(mapsLocal || []).map(m => (
            renameId === m.id && renameWhere !== 'title' ? (
              <input
                key={m.id}
                data-flow-sheet-rename=""
                autoFocus
                value={renameDraft}
                maxLength={MAX_FLOW_MAP_NAME}
                onChange={e => setRenameDraft(e.target.value)}
                onBlur={() => commitRename(m.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.currentTarget.blur(); }
                  else if (e.key === 'Escape') { renameCancelRef.current = true; setRenameId(null); }
                }}
                className="shrink-0 w-28 text-[11px] px-2 py-1 rounded-t border border-indigo-600 bg-[#0b1120] text-white outline-none"
              />
            ) : (
              <button
                key={m.id}
                onClick={() => switchSheet(m.id)}
                onDoubleClick={() => startRename(m)}
                title={`${m.name} — 도형 ${m.nodes?.length || 0} · 선 ${m.edges?.length || 0}${readOnly ? '' : ' (더블클릭하면 이름을 바꿉니다)'}`}
                className={`shrink-0 max-w-[160px] truncate text-[11px] px-3 py-1 rounded-t border-t border-l border-r transition ${
                  m.id === activeId
                    ? 'border-indigo-600 bg-[#0b1120] text-indigo-200 font-semibold'
                    : 'border-gray-700 bg-[#0f1623] text-gray-400 hover:text-gray-200'
                }`}
              >
                {m.name}
              </button>
            )
          ))}
          {!readOnly && (
            <button onClick={addSheet} title="시트 추가" className="shrink-0 flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-indigo-600 transition">
              <Plus size={12} /> 시트
            </button>
          )}
        </div>

        {!readOnly && map && (
          <div className="shrink-0 flex items-center gap-1">
            <button onClick={() => moveSheet(map.id, -1)} title="왼쪽으로 이동" className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition"><ChevronLeft size={14} /></button>
            <button onClick={() => moveSheet(map.id, 1)} title="오른쪽으로 이동" className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition"><ChevronRight size={14} /></button>
            <button onClick={() => startRename(map)} title="이름 변경" className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition"><Pencil size={13} /></button>
            <button onClick={() => duplicateSheet(map.id)} title="이 시트를 복제" className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-indigo-600 transition">복제</button>
            <button
              onClick={() => deleteSheet(map.id)}
              disabled={(mapsLocal?.length || 0) <= 1}
              title={(mapsLocal?.length || 0) <= 1 ? '시트는 최소 한 장이 남아 있어야 합니다' : '이 시트를 삭제'}
              className={`p-1 rounded transition ${
                (mapsLocal?.length || 0) <= 1
                  ? 'text-gray-700'
                  : delArmId === map.id
                    ? 'text-red-300 bg-red-900/40'
                    : 'text-gray-400 hover:text-red-300 hover:bg-gray-800'
              }`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
        <span className="shrink-0 text-[10px] text-gray-500">시트 {(mapsLocal?.length || 0)}/{MAX_FLOW_MAPS}</span>
      </div>

      {/* 메모·표 편집 팝업 — 보드의 자식이라 보드 안에서 최상단에 뜬다(App의 ConfirmDialog는
          여전히 이 위). ⚠️ 대상 도형을 **id로 다시 찾아** 넘긴다: 그 사이 시트를 바꾸거나 도형이
          지워졌으면 editorNode가 null이 되어 아래 effect가 조용히 닫는다. */}
      {editorNode && (
        <FlowNodeEditor
          key={editorNode.id}
          node={editorNode}
          title={viewOf(editorNode).displayName || '(이름 없음)'}
          onPatch={patchNodeById}
          onClose={() => setEditor(null)}
          readOnly={readOnly}
          initialTab={editor?.tab || 'memo'}
        />
      )}
    </div>
  );
}
