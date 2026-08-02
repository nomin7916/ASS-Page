// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, RotateCcw, Maximize2, Save } from 'lucide-react';
import FlowCanvas from './FlowCanvas';
import FlowInspector from './FlowInspector';
import { useFlowMapData } from '../hooks/useFlowMapData';
import {
  makeFlowMap, makeFlowNode, removeNode, resolveFlowNodeView,
  countDanglingNodes, MAX_FLOW_NODES, MAX_FLOW_EDGES,
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
 */

const FLOW_Z = 990;
const IDLE_PROMOTE_MS = 2500;

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
}) {
  const [mapsLocal, setMapsLocal] = useState(maps);
  const [selectedId, setSelectedId] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [viewport, setViewport] = useState({ x: 80, y: 80, scale: 1 });
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');

  const localRef = useRef(maps);
  const dirtyRef = useRef(false);
  const idleTimerRef = useRef(null);
  const onUpdateRef = useRef(onUpdateMaps);
  onUpdateRef.current = onUpdateMaps;

  // 보드를 열 때만 App state로부터 로컬 사본을 시드한다.
  // (열려 있는 동안의 외부 갱신은 채택하지 않는다 — 저장소 전역이 last-writer-wins 계약이고,
  //  편집 중 폴링 결과로 화면이 튀는 것이 더 나쁘다.)
  useEffect(() => {
    if (!open) return;
    const seeded = Array.isArray(maps) && maps.length > 0 ? maps : [makeFlowMap('자금 흐름도')];
    setMapsLocal(seeded);
    localRef.current = seeded;
    dirtyRef.current = false;
    setDirty(false);
    setSelectedId(null);
    setConnectFrom(null);
    const dang = countDanglingNodes(seeded, portfolios);
    setNotice(dang > 0 ? `계좌 연결 ${dang}건이 끊겨 있습니다(계좌가 삭제됐거나 백업으로 교체됨).` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ⚠️ 미승격 편집이 없으면 반드시 null — 항상 값을 반환하면 alt-tab마다 4파일 write가 강제된다.
  const flush = useCallback(() => {
    if (!dirtyRef.current) return null;
    dirtyRef.current = false;
    setDirty(false);
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
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
  const commit = useCallback((updater) => {
    if (readOnly) return;
    const prev = localRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    localRef.current = next;
    dirtyRef.current = true;
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
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const pending = localRef.current;
    onUpdateRef.current?.(() => pending);
  }, []);

  const map = mapsLocal?.[0];
  const { portfolioById, summaryById, accountOptions } = useFlowMapData(open, portfolios, portfolioSummaries);

  const patchMap = useCallback((fn) => {
    commit(prev => {
      const cur = prev?.[0];
      if (!cur) return prev;
      const nextMap = fn(cur);
      if (nextMap === cur) return prev;
      return [{ ...nextMap, updatedAt: Date.now() }, ...prev.slice(1)];
    });
  }, [commit]);

  const viewOf = useCallback(
    (node) => resolveFlowNodeView(node, portfolioById.get(node.portfolioId), summaryById.get(node.portfolioId)),
    [portfolioById, summaryById],
  );

  const formatAmount = useCallback((v, accountType) => (
    accountType === 'overseas' ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : formatCurrency(v)
  ), []);

  // ⚠️ 노드/엣지 생성(generateId)과 선택 변경은 업데이터 **밖**에서 수행한다(위 commit 주석 참조).
  const addNode = useCallback((kind) => {
    const cur = localRef.current?.[0];
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

  const onAddEdge = useCallback((from, to) => {
    const cur = localRef.current?.[0];
    if (!cur) return;
    if (cur.edges.length >= MAX_FLOW_EDGES) {
      setNotice(`연결선은 최대 ${MAX_FLOW_EDGES}개까지 만들 수 있습니다.`);
      return;
    }
    if (cur.edges.some(e => e.from === from && e.to === to)) return; // 같은 방향 중복 연결 금지
    const e = { id: generateId(), from, to, label: '', arrow: 'to', dashed: false };
    patchMap(m => ({ ...m, edges: [...m.edges, e] }));
    setSelectedId(`edge:${e.id}`);
  }, [patchMap]);

  const selNode = map && selectedId && !String(selectedId).startsWith('edge:')
    ? map.nodes.find(n => n.id === selectedId) : null;
  const selEdge = map && String(selectedId || '').startsWith('edge:')
    ? map.edges.find(e => e.id === String(selectedId).slice(5)) : null;

  const patchNode = useCallback((o) => {
    if (!selNode) return;
    patchMap(cur => ({ ...cur, nodes: cur.nodes.map(n => (n.id === selNode.id ? { ...n, ...o } : n)) }));
  }, [patchMap, selNode]);

  const patchEdge = useCallback((o) => {
    if (!selEdge) return;
    patchMap(cur => ({ ...cur, edges: cur.edges.map(e => (e.id === selEdge.id ? { ...e, ...o } : e)) }));
  }, [patchMap, selEdge]);

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

  const fitView = useCallback(() => {
    if (!map?.nodes?.length) { setViewport({ x: 80, y: 80, scale: 1 }); return; }
    const xs = map.nodes.map(n => n.x), ys = map.nodes.map(n => n.y);
    const xe = map.nodes.map(n => n.x + n.w), ye = map.nodes.map(n => n.y + n.h);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const w = Math.max(...xe) - minX, h = Math.max(...ye) - minY;
    const vw = window.innerWidth - 300, vh = window.innerHeight - 140;
    const scale = Math.min(1.5, Math.max(0.25, Math.min(vw / (w + 120), vh / (h + 120))));
    setViewport({ scale, x: 60 - minX * scale, y: 90 - minY * scale });
  }, [map]);

  // ⚠️ 보드 키를 **먼저 처리한 뒤** stopPropagation 한다. 그냥 흘려보내면 FloatingCalculator가
  //    열려 있을 때 그 window keydown 핸들러가 Delete/Escape/화살표를 수식 입력으로 삼킨다
  //    (그쪽 가드는 input/textarea/select/contentEditable뿐이라 svg·button은 무방비).
  //    비활동 감지는 App에서 document 캡처 단계로 등록해 두었으므로 이 stopPropagation의 영향을 받지 않는다.
  const onKeyDownCapture = (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
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
    e.stopPropagation();
  };

  if (!open) return null;

  const nodeCount = map?.nodes?.length || 0;
  const edgeCount = map?.edges?.length || 0;

  return (
    <div
      className="fixed inset-0 flex flex-col bg-[#0b1120]"
      style={{ zIndex: FLOW_Z }}
      onKeyDownCapture={onKeyDownCapture}
    >
      {/* 툴바 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-[#0f1623] shrink-0 flex-wrap">
        <span className="text-sm font-semibold text-indigo-300 mr-1">자금 흐름도</span>
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
        <button onClick={() => setViewport({ x: 80, y: 80, scale: 1 })} title="배율 초기화" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white transition">
          <RotateCcw size={12} /> 100%
        </button>
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
        <button onClick={closeBoard} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition" title="닫기 (Esc)">
          <X size={16} />
        </button>
      </div>

      {notice && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-900/20 border-b border-amber-800/40 flex items-center gap-2 shrink-0">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-amber-500 hover:text-amber-300"><X size={12} /></button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 relative">
          <FlowCanvas
            map={map}
            viewOf={viewOf}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNodesChange={onNodesChange}
            onAddEdge={onAddEdge}
            viewport={viewport}
            onViewportChange={setViewport}
            readOnly={readOnly}
            hideAmounts={hideAmounts}
            formatAmount={formatAmount}
            connectFrom={connectFrom}
            onConnectFromChange={setConnectFrom}
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
            accountOptions={accountOptions}
            onPatchNode={patchNode}
            onPatchEdge={patchEdge}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onClose={() => setSelectedId(null)}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}
