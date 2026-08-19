// @ts-nocheck
import React from 'react';

/**
 * 카드 헤더의 '별도 창으로 열기(⧉)' 버튼.
 *
 * ⚠️ 카드 **자기 헤더 안에 인라인**으로 둔다 — 카드 위에 absolute로 얹으면 헤더 우측의 기존
 *    컨트롤(분배금 표의 숨긴 월 칩·새로고침 등)과 겹쳐 클릭을 가로챈다.
 * ⚠️ `onExpand`가 없으면 **렌더하지 않는다**(통합 대시보드 compact·별도 창 자신처럼 확장이
 *    의미 없는 곳에서 죽은 버튼이 뜨지 않게 한다).
 * ⚠️ 인라인 SVG — 이 저장소는 package-lock.json이 없어 새 lucide 아이콘의 실재를 확인할 수단이
 *    없고(0.4x에서 AlertTriangle→TriangleAlert 개명 선례), 없는 아이콘은 undefined 렌더로 죽는다.
 */
export default function CardExpandButton({ onExpand, opened, label = '카드' }) {
  if (!onExpand) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onExpand(); }}
      title={opened ? `${label} — 열려 있는 별도 창으로 이동` : `${label}을(를) 별도 창으로 열기`}
      className={`shrink-0 self-center inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] leading-none transition-colors ${
        opened
          ? 'border-sky-600/70 text-sky-300 bg-sky-900/30'
          : 'border-gray-600/60 text-gray-400 hover:text-sky-300 hover:border-sky-700/70 hover:bg-sky-900/20'
      }`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      </svg>
      {opened ? '창' : '확장'}
    </button>
  );
}
