// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Star } from 'lucide-react';

// FloatingCalculator와 동일 규칙의 비차단·이동 가능 플로팅 패널.
// - 단일 position:fixed div (백드롭/오버레이 없음 → 아래 앱 클릭·스크롤 통과)
// - z 1050 (dialog 1000 < 여기 < LoadingOverlay 1100)
// - 타이틀 바만 드래그 핸들, window mousemove/touchmove 리스너로 이동, 뷰포트 클램프
const WATCHLIST_Z = 1050;
const PANEL_W = 380;

export default function WatchlistPopup({ open, onClose }) {
  const [pos, setPos] = useState(() => ({
    x: Math.max(10, Math.round((window.innerWidth - PANEL_W) / 2)),
    y: 80,
  }));
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const rootRef = useRef(null);

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

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: WATCHLIST_Z, width: PANEL_W, maxWidth: 'calc(100vw - 20px)', maxHeight: '82vh', touchAction: 'none' }}
      className="rounded-2xl shadow-2xl overflow-hidden border border-gray-600/60 bg-[#0b1120] flex flex-col"
    >
      {/* 타이틀 바 (드래그 핸들) */}
      <div
        className="flex items-center justify-between bg-gray-900 px-3 py-2 cursor-move border-b border-gray-700/40 select-none"
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

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto px-4 py-8" style={{ touchAction: 'auto' }}>
        <div className="flex flex-col items-center justify-center text-center gap-2 py-6">
          <Star size={28} className="text-gray-600" />
          <p className="text-gray-400 text-sm font-medium">관심 그룹을 만들어 종목을 모아 보세요</p>
          <p className="text-gray-600 text-xs">상단 바를 드래그해 창을 이동할 수 있습니다.</p>
        </div>
      </div>
    </div>
  );
}
