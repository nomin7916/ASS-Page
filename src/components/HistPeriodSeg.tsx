// @ts-nocheck
import React from 'react';

/**
 * 평가액 추이 표의 기간 단위 세그먼트 — 통합 대시보드와 개별 계좌가 **공유**한다.
 *
 * ⚠️ 배치가 두 카드에서 다르다(같게 만들지 말 것):
 *    · 통합    = 카드 헤더 우측 (xl:w-[490px]라 여유가 있다)
 *    · 개별 계좌 = thead 위 얇은 바 (카드가 xl:w-[21%] ≈ 252px, 헤더 가용 220px인데
 *      제목 ≈127 + ? 14 + 확장 49 ≈ 190이라 4버튼 102px이 안 들어간다. 억지로 넣으면
 *      제목이 한글 글자 단위로 줄바꿈되고, 카드가 h-[360px] 고정 + overflow-hidden이라
 *      늘어난 헤더 높이만큼 **표 행이 사라진다**. 헤더를 아예 건드리지 않으면
 *      verify:card-window #G14g(CardExpandButton 한 줄 문자 일치)도 구조적으로 안전하다.)
 *
 * ⚠️ 값은 화이트리스트('day'|'week'|'month'|'year')다. 손상값이 들어오면 어느 버튼도
 *    눌린 것으로 보이지 않으므로, 저장·복원 경로가 normalizeHistPeriod를 반드시 통과시킬 것.
 */
const OPTS = [
  { v: 'day', label: '일', desc: '기록일마다 한 행' },
  { v: 'week', label: '주', desc: '월요일~일요일을 한 행으로 (그 주 마지막 기록 기준)' },
  { v: 'month', label: '월', desc: '한 달을 한 행으로 (그 달 마지막 기록 기준)' },
  { v: 'year', label: '년', desc: '한 해를 한 행으로 (그 해 마지막 기록 기준)' },
];

export default function HistPeriodSeg({ value, onChange, note, className = '' }) {
  if (!onChange) return null;   // graceful — 핸들러가 없으면 렌더하지 않는다
  return (
    <div className={`flex items-center shrink-0 rounded border border-gray-700 overflow-hidden ${className}`}>
      {OPTS.map(o => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            title={`${o.label}간 — ${o.desc}${note ? `\n${note}` : ''}`}
            className={`px-1.5 py-0.5 text-[10px] font-bold leading-none transition-colors ${
              on ? 'bg-sky-600/70 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >{o.label}</button>
        );
      })}
    </div>
  );
}
