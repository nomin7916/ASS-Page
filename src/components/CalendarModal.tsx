// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Check, Calendar as CalIcon, Trash2 } from 'lucide-react';
import { BG, Z } from '../design';
import { generateId } from '../utils';
import { getTodayKST } from '../hooks/useMarketCalendar';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

const pad2 = (n) => String(n).padStart(2, '0');
const dayKeyOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const firstLine = (s) => {
  const t = (s || '').trim();
  const i = t.indexOf('\n');
  return i === -1 ? t : t.slice(0, i);
};

// 달력 메모 모달 — 통합 대시보드 헤더의 달력 아이콘으로 진입.
// 데이터: { [YYYY-MM-DD]: { id, content, createdAt }[] } (앱 레벨, Drive STATE에 영속).
// 하루 배열은 append 순(오래된 메모 위 / 새 메모 아래)으로 표시.
export default function CalendarModal({ open, onClose, memos = {}, onUpdateMemos, holidays = { kr: [], us: [] }, notify, confirm }) {
  const todayStr = getTodayKST();
  const tp = todayStr.split('-');
  const ty = parseInt(tp[0], 10);
  const tm = parseInt(tp[1], 10) - 1;

  const [viewYear, setViewYear] = useState(ty);
  const [viewMonth, setViewMonth] = useState(tm);
  // pad: null | { dayKey, mode: 'new'|'edit', memoId, val }
  const [pad, setPad] = useState(null);

  // 재오픈 시 이번 달로 리셋 + 패드 닫기
  useEffect(() => {
    if (open) {
      setViewYear(ty);
      setViewMonth(tm);
      setPad(null);
    }
  }, [open]);

  // Esc: 패드가 열려있으면 패드부터 닫고, 아니면 모달 닫기
  // (부작용을 setState 업데이터 밖에서 실행 — pad를 deps에 넣어 클로저로 판별)
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === 'Escape') {
        if (pad) setPad(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, pad, onClose]);

  if (!open) return null;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const krHol = holidays?.kr || [];

  const gotoPrev = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); } else setViewMonth(viewMonth - 1);
  };
  const gotoNext = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); } else setViewMonth(viewMonth + 1);
  };
  const gotoToday = () => { setViewYear(ty); setViewMonth(tm); };

  const openNew = (dayKey) => setPad({ dayKey, mode: 'new', memoId: null, val: '' });
  const openEdit = (dayKey, memo) => setPad({ dayKey, mode: 'edit', memoId: memo.id, val: memo.content || '' });
  const closePad = () => setPad(null);

  const savePad = () => {
    if (!pad || !onUpdateMemos) { setPad(null); return; }
    const { dayKey, mode, memoId, val } = pad;
    const next = { ...memos };
    const arr = [...(next[dayKey] || [])];
    if (mode === 'new') {
      if (!val.trim()) { setPad(null); return; } // 빈 메모는 생성 안 함
      arr.push({ id: generateId(), content: val, createdAt: Date.now() });
    } else {
      const idx = arr.findIndex((m) => m.id === memoId);
      if (idx === -1) { setPad(null); return; }
      if (!val.trim()) arr.splice(idx, 1); // 편집 후 비면 삭제
      else arr[idx] = { ...arr[idx], content: val };
    }
    if (arr.length) next[dayKey] = arr; else delete next[dayKey];
    onUpdateMemos(next);
    setPad(null);
  };

  // 즉시 삭제 — 셀에서 바로 사라지는 것이 피드백(RebalancingPanel deleteNote와 동일 패턴).
  // 달력 모달(z-1000) 위에서 confirm()/notify()는 각각 ConfirmDialog(z-1000)·토스트(z-999)에
  // 가려지므로 사용하지 않는다.
  const deleteMemo = (dayKey, memoId) => {
    if (!onUpdateMemos) return;
    const next = { ...memos };
    const arr = (next[dayKey] || []).filter((m) => m.id !== memoId);
    if (arr.length) next[dayKey] = arr; else delete next[dayKey];
    onUpdateMemos(next);
  };

  return (
    <>
      <div
        className="fixed inset-0 flex items-center justify-center backdrop-blur-sm p-3 sm:p-6"
        style={{ zIndex: Z.dialog, background: BG.overlay }}
        onClick={onClose}
      >
        <div
          className="rounded-2xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden w-full max-w-5xl max-h-[92vh]"
          style={{ background: BG.card }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-2">
              <CalIcon size={16} className="text-sky-400" />
              <span className="text-gray-200 font-semibold text-sm">메모 달력</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={gotoPrev} title="이전 달" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition">
                <ChevronLeft size={18} />
              </button>
              <span className="text-gray-200 font-semibold text-sm w-[104px] text-center tabular-nums select-none">
                {viewYear}년 {viewMonth + 1}월
              </span>
              <button onClick={gotoNext} title="다음 달" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition">
                <ChevronRight size={18} />
              </button>
              <button onClick={gotoToday} className="ml-2 px-2.5 py-1 rounded-md text-[12px] border border-gray-700 text-gray-300 hover:bg-gray-800 transition">
                오늘
              </button>
            </div>
            <button onClick={onClose} title="닫기" className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition">
              <X size={16} />
            </button>
          </div>

          {/* 본문 */}
          <div className="p-3 overflow-y-auto">
            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 border-l border-t border-gray-800/60">
              {WD.map((w, i) => (
                <div
                  key={w}
                  className={`text-center text-[11px] font-semibold py-1.5 border-r border-b border-gray-800/60 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`}
                >
                  {w}
                </div>
              ))}
            </div>
            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7 border-l border-gray-800/60">
              {Array.from({ length: totalCells }).map((_, i) => {
                const dayNum = i - firstDow + 1;
                const valid = dayNum >= 1 && dayNum <= daysInMonth;
                const dow = i % 7;
                if (!valid) {
                  return <div key={i} className="border-r border-b border-gray-800/60 bg-black/20" style={{ minHeight: '98px' }} />;
                }
                const key = dayKeyOf(viewYear, viewMonth, dayNum);
                const isToday = key === todayStr;
                const isHol = krHol.includes(key);
                const dayMemos = memos[key] || [];
                const numColor = isHol || dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-300';
                return (
                  <div
                    key={i}
                    onClick={() => openNew(key)}
                    title="클릭하여 메모 추가"
                    className="border-r border-b border-gray-800/60 p-1 flex flex-col gap-0.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
                    style={{ minHeight: '98px' }}
                  >
                    <div className="flex items-center justify-between shrink-0 px-0.5">
                      <span
                        className={`text-[12px] font-semibold leading-none ${isToday ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center' : numColor}`}
                      >
                        {dayNum}
                      </span>
                      {dayMemos.length > 0 && <span className="text-[9px] text-gray-600 tabular-nums">{dayMemos.length}</span>}
                    </div>
                    <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: '72px' }}>
                      {dayMemos.map((m) => (
                        <div
                          key={m.id}
                          onClick={(e) => { e.stopPropagation(); openEdit(key, m); }}
                          title={m.content}
                          className="group/memo flex items-center gap-1 rounded px-1 py-0.5 bg-sky-500/15 hover:bg-sky-500/25 transition-colors"
                        >
                          <span className="flex-1 text-[10px] text-sky-200 truncate leading-tight">
                            {firstLine(m.content) || <span className="text-gray-500 italic">내용 없음</span>}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteMemo(key, m.id); }}
                            title="삭제"
                            className="opacity-0 group-hover/memo:opacity-100 text-gray-500 hover:text-red-400 shrink-0 transition-opacity"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 메모 패드 (사진3 형식) — 달력 위에 오버레이 */}
      {pad && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
          style={{ zIndex: Z.dialog + 10 }}
          onClick={(e) => { e.stopPropagation(); if (!pad.val.trim()) closePad(); }}
        >
          <div className="w-[576px] max-w-full shadow-2xl overflow-hidden rounded-lg" onClick={(e) => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between select-none">
              <div className="flex items-center gap-3">
                <button
                  onClick={closePad}
                  className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all"
                  title="취소 (Esc)"
                >
                  <X size={10} className="text-white" />
                </button>
                <button
                  onClick={savePad}
                  className="w-[18px] h-[18px] rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center transition-all"
                  title="저장 (Ctrl+Enter)"
                >
                  <Check size={10} className="text-white" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <CalIcon size={13} className="text-gray-500" />
                <span className="text-[13px] text-gray-400 font-mono">{pad.dayKey}</span>
                <span className="text-[15px] font-bold tracking-[0.25em] bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-400 bg-clip-text text-transparent select-none">
                  MEMO
                </span>
              </div>
              <div className="w-10" />
            </div>
            {/* 줄선 메모 입력 */}
            <textarea
              className="w-full text-gray-200 text-[15px] outline-none resize-none caret-sky-400 placeholder-gray-700"
              style={{
                backgroundColor: '#000',
                backgroundImage: `repeating-linear-gradient(transparent 0px, transparent 31px, rgba(99,130,255,0.3) 31px, rgba(99,130,255,0.3) 32px)`,
                backgroundSize: '100% 32px',
                backgroundPosition: '0 8px',
                lineHeight: '32px',
                padding: '8px 10px',
              }}
              rows={9}
              autoFocus
              placeholder="메모를 입력하세요..."
              value={pad.val}
              onChange={(e) => setPad((prev) => ({ ...prev, val: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); closePad(); }
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') savePad();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
