// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Star, Plus, Pencil, Trash2, Check } from 'lucide-react';
import { generateId, formatNumber, formatFundPrice, formatChangeRate } from '../utils';
import { detectMarket, fetchWatchQuote } from '../watchlistQuote';

// FloatingCalculator와 동일 규칙의 비차단·이동 가능 플로팅 패널.
// - 단일 position:fixed div (백드롭/오버레이 없음 → 아래 앱 클릭·스크롤 통과)
// - z 1050 (dialog 1000 < 여기 < LoadingOverlay 1100)
// - 타이틀 바만 드래그 핸들, window mousemove/touchmove 리스너로 이동, 뷰포트 클램프
const WATCHLIST_Z = 1050;
const PANEL_W = 420;
const MARKET_LABEL = { kr: '국내', us: '해외', fund: '펀드' };

const fmtPrice = (market, price) => {
  if (market === 'us') return '$' + Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (market === 'fund') return formatFundPrice(price);
  return formatNumber(price);
};
const rateColor = (r) => (r > 0 ? 'text-red-400' : r < 0 ? 'text-blue-400' : 'text-gray-500');
const dotCls = (st) =>
  st === 'loading' ? 'bg-amber-400 animate-pulse' : st === 'success' ? 'bg-emerald-500' : st === 'fail' ? 'bg-red-500' : 'bg-gray-600';

export default function WatchlistPopup({ open, onClose, groups = [], onUpdateGroups }) {
  const [pos, setPos] = useState(() => ({
    x: Math.max(10, Math.round((window.innerWidth - PANEL_W) / 2)),
    y: 80,
  }));
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const rootRef = useRef(null);

  // 그룹 관리 로컬 상태
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [confirmDelId, setConfirmDelId] = useState(null);

  // 종목 시세 로컬 캐시 (메모리 전용 — Drive 저장 안 함)
  const [quotes, setQuotes] = useState({});   // { [code]: { name, price, changeRate } }
  const [status, setStatus] = useState({});   // { [code]: 'loading'|'success'|'fail' }
  const [codeInput, setCodeInput] = useState('');

  const list = Array.isArray(groups) ? groups : [];
  const activeGroup = list.find((g) => g.id === activeGroupId) || list[0] || null;

  const onDragStart = useCallback((cx, cy) => {
    dragging.current = true;
    dragOffset.current = { x: cx - pos.x, y: cy - pos.y };
  }, [pos]);

  // 드래그 이동 (window 리스너 — 커서가 패널 밖으로 나가도 추적)
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - (rootRef.current?.offsetWidth || PANEL_W), cx - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 40, cy - dragOffset.current.y)),
      });
    };
    const onEnd = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  // 열 때마다 화면 중앙 상단 근처로 재배치
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const w = rootRef.current?.offsetWidth || PANEL_W;
      setPos({
        x: Math.max(10, Math.round((window.innerWidth - w) / 2)),
        y: Math.max(20, Math.round(window.innerHeight * 0.12)),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // ───────── 시세 조회 ─────────
  const loadQuote = async (stock) => {
    const key = stock.code;
    setStatus((p) => ({ ...p, [key]: 'loading' }));
    const d = await fetchWatchQuote(stock.market, stock.code);
    if (d) {
      setQuotes((p) => ({ ...p, [key]: d }));
      setStatus((p) => ({ ...p, [key]: 'success' }));
      // 종목명 캐시(STATE 저장) — 로드 직후 코드만 뜨는 깜빡임 방지. 이름 다를 때만 갱신(저장 churn 최소화)
      if (d.name && d.name !== stock.name) {
        onUpdateGroups?.((prev) => (Array.isArray(prev) ? prev : []).map((g) => ({
          ...g,
          stocks: (g.stocks || []).map((s) => (s.id === stock.id ? { ...s, name: d.name } : s)),
        })));
      }
    } else {
      setStatus((p) => ({ ...p, [key]: 'fail' }));
    }
  };

  // 팝업 열 때 + 그룹 전환 시 활성 그룹 종목만 조회(전체 그룹 동시 조회 금지)
  useEffect(() => {
    if (!open || !activeGroup) return;
    (activeGroup.stocks || []).forEach((s) => { loadQuote(s); });
  }, [open, activeGroup?.id]);

  // ───────── 그룹 CRUD ─────────
  const addGroup = () => {
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(''); return; }
    const g = { id: generateId(), name, stocks: [], createdAt: Date.now() };
    onUpdateGroups?.((prev) => [...(Array.isArray(prev) ? prev : []), g]);
    setActiveGroupId(g.id);
    setCreating(false);
    setNewName('');
  };
  const renameGroup = (id) => {
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    onUpdateGroups?.((prev) => (Array.isArray(prev) ? prev : []).map((g) => (g.id === id ? { ...g, name } : g)));
    setEditingId(null);
  };
  const deleteGroup = (id) => {
    onUpdateGroups?.((prev) => (Array.isArray(prev) ? prev : []).filter((g) => g.id !== id));
    setConfirmDelId(null);
    if (activeGroup?.id === id) setActiveGroupId(null); // 다음 렌더에서 list[0]로 폴백
  };

  // ───────── 종목 CRUD ─────────
  const addStock = () => {
    const code = codeInput.trim();
    if (!code || !activeGroup) return;
    if ((activeGroup.stocks || []).some((s) => (s.code || '').toLowerCase() === code.toLowerCase())) {
      setCodeInput('');
      return; // 같은 그룹 내 중복 방지
    }
    const stock = { id: generateId(), code, market: detectMarket(code), name: '', addedAt: Date.now() };
    onUpdateGroups?.((prev) => (Array.isArray(prev) ? prev : []).map((g) =>
      (g.id === activeGroup.id ? { ...g, stocks: [...(g.stocks || []), stock] } : g)));
    setCodeInput('');
    loadQuote(stock);
  };
  const removeStock = (stockId) => {
    if (!activeGroup) return;
    onUpdateGroups?.((prev) => (Array.isArray(prev) ? prev : []).map((g) =>
      (g.id === activeGroup.id ? { ...g, stocks: (g.stocks || []).filter((s) => s.id !== stockId) } : g)));
  };
  // 조회 실패 행의 시장 수동 보정 → 재조회
  const setStockMarket = (stock, market) => {
    onUpdateGroups?.((prev) => (Array.isArray(prev) ? prev : []).map((g) => ({
      ...g,
      stocks: (g.stocks || []).map((s) => (s.id === stock.id ? { ...s, market } : s)),
    })));
    loadQuote({ ...stock, market });
  };

  if (!open) return null;

  const chipInput = 'bg-gray-900 border border-amber-500/50 rounded-full px-2.5 py-1 text-xs text-white outline-none w-24';

  return (
    <div
      ref={rootRef}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: WATCHLIST_Z, width: PANEL_W, maxWidth: 'calc(100vw - 20px)', maxHeight: '82vh' }}
      className="rounded-2xl shadow-2xl overflow-hidden border border-gray-600/60 bg-[#0b1120] flex flex-col"
    >
      {/* 타이틀 바 (드래그 핸들) */}
      <div
        className="flex items-center justify-between bg-gray-900 px-3 py-2 cursor-move border-b border-gray-700/40 select-none"
        style={{ touchAction: 'none' }}
        onMouseDown={(e) => { onDragStart(e.clientX, e.clientY); e.preventDefault(); }}
        onTouchStart={(e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
      >
        <span className="text-gray-200 text-sm font-semibold flex items-center gap-1.5">
          <Star size={14} className="text-amber-400" /> 관심종목
        </span>
        <button onClick={onClose} title="닫기" className="text-gray-400 hover:text-white p-1 rounded transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* 그룹 칩 행 */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800/70 overflow-x-auto whitespace-nowrap">
        {list.map((g) => {
          const isActive = activeGroup?.id === g.id;
          if (editingId === g.id) {
            return (
              <input
                key={g.id}
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') renameGroup(g.id); else if (e.key === 'Escape') setEditingId(null); }}
                onBlur={() => renameGroup(g.id)}
                className={chipInput}
                maxLength={20}
              />
            );
          }
          if (confirmDelId === g.id) {
            return (
              <span key={g.id} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs bg-red-900/30 border border-red-600/50 text-red-300">
                <span className="font-medium">삭제?</span>
                <button onClick={() => deleteGroup(g.id)} title="삭제 확인" className="hover:text-red-100"><Check size={12} /></button>
                <button onClick={() => setConfirmDelId(null)} title="취소" className="hover:text-white"><X size={12} /></button>
              </span>
            );
          }
          return (
            <span
              key={g.id}
              className={`inline-flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-1 text-xs border transition-colors ${
                isActive
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <button
                onClick={() => setActiveGroupId(g.id)}
                onDoubleClick={() => { setEditingId(g.id); setEditName(g.name); }}
                className="font-medium max-w-[120px] truncate"
                title={g.name}
              >
                {g.name}
              </button>
              {isActive && (
                <>
                  <button onClick={() => { setEditingId(g.id); setEditName(g.name); }} title="이름 변경" className="text-amber-400/70 hover:text-amber-200">
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => setConfirmDelId(g.id)} title="그룹 삭제" className="text-amber-400/70 hover:text-red-300">
                    <Trash2 size={11} />
                  </button>
                </>
              )}
            </span>
          );
        })}
        {creating ? (
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); else if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
            onBlur={addGroup}
            placeholder="그룹 이름"
            className={chipInput}
            maxLength={20}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            title="관심 그룹 추가"
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs bg-gray-800/60 border border-dashed border-gray-600 text-gray-400 hover:text-amber-300 hover:border-amber-500/50 transition-colors shrink-0"
          >
            <Plus size={12} /> 그룹
          </button>
        )}
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto px-3 py-3" style={{ touchAction: 'auto' }}>
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center gap-2 py-8">
            <Star size={28} className="text-gray-600" />
            <p className="text-gray-400 text-sm font-medium">관심 그룹을 만들어 종목을 모아 보세요</p>
            <button
              onClick={() => setCreating(true)}
              className="mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors"
            >
              <Plus size={13} /> 그룹 추가
            </button>
          </div>
        ) : activeGroup ? (
          <>
            {/* 코드 입력 */}
            <div className="flex items-center gap-1.5 mb-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addStock(); }}
                placeholder="종목 코드 (예: 005930, AAPL, MA:...)"
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-amber-500/50 placeholder:text-gray-600"
              />
              <button
                onClick={addStock}
                className="shrink-0 rounded px-3 py-1.5 text-xs font-medium bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors"
              >
                추가
              </button>
            </div>

            {/* 종목 리스트 */}
            {(activeGroup.stocks || []).length === 0 ? (
              <div className="text-center text-gray-600 text-xs py-8">코드를 입력해 종목을 추가하세요.</div>
            ) : (
              <div className="flex flex-col">
                {(activeGroup.stocks || []).map((s) => {
                  const q = quotes[s.code];
                  const st = status[s.code];
                  return (
                    <div key={s.id}>
                      <div className="flex items-center gap-2 px-1 py-1.5 border-b border-gray-800/50 hover:bg-white/[0.02] group">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls(st)}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-gray-100 text-[13px] font-medium truncate" title={q?.name || s.name || s.code}>
                            {q?.name || s.name || s.code}
                          </div>
                          <div className="text-gray-500 text-[10px] flex items-center gap-1">
                            <span>{s.code}</span>
                            <span className="text-gray-600">· {MARKET_LABEL[s.market] || s.market}</span>
                          </div>
                        </div>
                        <span className={`w-16 text-right text-xs font-medium ${q ? rateColor(q.changeRate) : 'text-gray-600'}`}>
                          {q ? formatChangeRate(q.changeRate) : st === 'loading' ? '…' : '-'}
                        </span>
                        <span className="w-24 text-right text-[13px] text-gray-200 tabular-nums">
                          {q ? fmtPrice(s.market, q.price) : '-'}
                        </span>
                        <button
                          onClick={() => removeStock(s.id)}
                          title="종목 삭제"
                          className="shrink-0 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {st === 'fail' && (
                        <div className="flex items-center gap-1 px-3 pb-1.5 pt-0.5 text-[10px] text-red-400/80">
                          <span>조회 실패 — 시장 선택:</span>
                          {(['kr', 'us', 'fund']).map((m) => (
                            <button
                              key={m}
                              onClick={() => setStockMarket(s, m)}
                              className={`rounded px-1.5 py-0.5 border transition-colors ${
                                s.market === m
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                  : 'border-gray-700 text-gray-400 hover:text-amber-300'
                              }`}
                            >
                              {MARKET_LABEL[m]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
