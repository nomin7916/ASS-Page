// @ts-nocheck
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '../design';

// 리밸런싱 표 입력 칸 아래에 뜨는 미리보기 말풍선(목표금액·목표비중 입력 중 — Enter 전에 결과를 보여준다).
// ⚠️ body로 포털한다 — 표가 가로 스크롤 컨테이너(overflow-x-auto) 안이라 셀 안에 두면 아래쪽이 잘리고,
//    가로 고정 칸(sticky, z-5)이 덮는다. 위치는 셀의 화면 좌표로 매 렌더·스크롤·창 크기 변경마다 다시 잡는다.
// ⚠️ pointer-events 없음 — 말풍선이 옆 칸 클릭을 가로채면 안 된다.
export default function RebalPreviewBubble({ anchor, children }) {
  const boxRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!anchor) return undefined;
    const bump = () => setTick(t => t + 1);
    window.addEventListener('scroll', bump, true);
    window.addEventListener('resize', bump);
    return () => {
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('resize', bump);
    };
  }, [anchor]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!anchor || !box || !anchor.isConnected) return;
    const r = anchor.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = r.left + r.width / 2;
    const left = Math.round(Math.max(8, Math.min(cx - w / 2, vw - w - 8)));
    const above = r.bottom + gap + h > vh - 8 && r.top - gap - h >= 8;
    const top = Math.round(above ? r.top - gap - h : r.bottom + gap);
    const arrow = Math.round(Math.max(12, Math.min(cx - left, w - 12)));
    setPos(prev => (prev && prev.left === left && prev.top === top && prev.arrow === arrow && prev.above === above)
      ? prev
      : { left, top, arrow, above });
  });

  if (!anchor || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={boxRef}
      role="status"
      aria-live="polite"
      className="fixed pointer-events-none rounded-lg border border-gray-600 bg-[#1f2937] px-3 py-2 text-xs text-gray-200 shadow-xl shadow-black/50"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: Z.notification, visibility: pos ? 'visible' : 'hidden' }}
    >
      <span
        aria-hidden="true"
        className={`absolute h-2.5 w-2.5 rotate-45 bg-[#1f2937] border-gray-600 ${pos?.above ? 'border-b border-r' : 'border-t border-l'}`}
        style={{ left: (pos?.arrow ?? 12) - 5, ...(pos?.above ? { bottom: -6 } : { top: -6 }) }}
      />
      {children}
    </div>,
    document.body,
  );
}
