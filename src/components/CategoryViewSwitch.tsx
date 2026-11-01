// @ts-nocheck
import React from 'react';

// 표 구분 열 머리의 '자산군 | 사용자' 전환(포트폴리오 표·리밸런싱 표 공용). 머리 클릭(정렬)과 겹치지 않도록 전파를 막는다.
export default function CategoryViewSwitch({ view, onChange }) {
  return (
    <div className="mt-1 inline-flex rounded border border-gray-600 overflow-hidden text-[9px] font-bold leading-none" onClick={e => e.stopPropagation()}>
      {[['asset', '자산군'], ['user', '사용자']].map(([m, label]) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-1.5 py-1 transition-colors ${view === m ? 'bg-blue-600/70 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
          title={m === 'asset' ? '구분 열에 자산군을 표시합니다' : '구분 열에 사용자 구분(직접 입력)을 표시합니다'}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
