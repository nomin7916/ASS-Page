// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { Search, X, Calendar } from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';

const PERIOD_OPTIONS = [
  { value: '1w',  label: '1주일' },
  { value: '1m',  label: '1개월' },
  { value: '2m',  label: '2개월' },
  { value: '3m',  label: '3개월' },
  { value: '6m',  label: '6개월' },
  { value: '1y',  label: '1년' },
  { value: '2y',  label: '2년' },
  { value: '3y',  label: '3년' },
  { value: '4y',  label: '4년' },
  { value: '5y',  label: '5년' },
  { value: '10y', label: '10년' },
  { value: 'all', label: '전체' },
];

const fmtDate = (s) => s ? s.substring(2).replace(/-/g, '/') : '';

export default function ChartRangeControls({ dateRange, setDateRange, period, setPeriod, onSearch }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popupRef = useRef(null);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openPopup = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const popupW = 300;
      let left = rect.right - popupW;
      left = Math.max(8, Math.min(left, window.innerWidth - popupW - 8));
      setPopupPos({ top: rect.bottom + 4, left });
    }
    setOpen(v => !v);
  };

  const handleSearch = () => {
    if (!dateRange.start && !dateRange.end) return;
    onSearch();
    setOpen(false);
  };

  const handlePresetChange = (e) => {
    setPeriod(e.target.value);
    setOpen(false);
  };

  const tooltipText = (() => {
    const s = fmtDate(dateRange.start);
    const e = fmtDate(dateRange.end);
    if (!s && !e) return '기간 미설정';
    if (s && !e) return `${s} ~ 오늘`;
    if (!s && e) return `~ ${e}`;
    return `${s} ~ ${e}`;
  })();

  const canSearch = !!(dateRange.start || dateRange.end);
  const presetLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label ?? '직접입력';

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPopup}
        className={`p-1.5 rounded border flex items-center justify-center transition-colors ${open ? 'text-blue-300 bg-blue-900/30 border-blue-700/50' : 'text-gray-400 border-gray-700 hover:text-gray-200 hover:bg-gray-800'}`}
        title={`조회기간: ${tooltipText} (현재 ${presetLabel})`}
      >
        <Calendar size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[997]" onClick={() => setOpen(false)} />
          <div
            ref={popupRef}
            className="fixed z-[998] bg-[#1e293b] border border-gray-600 rounded-lg shadow-2xl p-3 w-[300px]"
            style={{ top: popupPos.top, left: popupPos.left }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] text-gray-300 font-bold flex items-center gap-1.5">
                <Calendar size={12} className="text-blue-300" /> 조회 기간
              </span>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white p-0.5" title="닫기">
                <X size={12} />
              </button>
            </div>
            <div className="mb-2.5">
              <span className="block text-[10px] text-gray-500 font-bold mb-1">프리셋</span>
              <select
                value={period}
                onChange={handlePresetChange}
                className="w-full bg-gray-900 text-gray-200 text-xs font-bold border border-gray-600 rounded px-2 py-1.5 outline-none cursor-pointer hover:bg-gray-800 transition-colors"
              >
                {PERIOD_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
                <option value="custom" hidden>직접입력</option>
              </select>
            </div>
            <div className="mb-2">
              <span className="block text-[10px] text-gray-500 font-bold mb-1">직접 선택</span>
              <div className="flex items-center bg-gray-900 border border-gray-600 rounded px-2 py-1.5">
                <div className="flex items-center min-w-0">
                  <CustomDatePicker
                    value={dateRange.start}
                    onChange={v => { setDateRange(p => ({ ...p, start: v })); setPeriod('custom'); }}
                  />
                  {dateRange.start && (
                    <button
                      onClick={() => { setDateRange(p => ({ ...p, start: '' })); setPeriod('custom'); }}
                      className="text-gray-500 hover:text-red-400 -ml-1 p-0.5 transition-colors"
                      title="시작일 비우기"
                    ><X size={10} /></button>
                  )}
                </div>
                <span className="text-gray-500 mx-1">~</span>
                <div className="flex items-center min-w-0">
                  <CustomDatePicker
                    value={dateRange.end}
                    onChange={v => { setDateRange(p => ({ ...p, end: v })); setPeriod('custom'); }}
                  />
                  {dateRange.end && (
                    <button
                      onClick={() => { setDateRange(p => ({ ...p, end: '' })); setPeriod('custom'); }}
                      className="text-gray-500 hover:text-red-400 -ml-1 p-0.5 transition-colors"
                      title="종료일 비우기 (오늘까지 자동 연장)"
                    ><X size={10} /></button>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-gray-500 mt-1.5 leading-tight">💡 종료일을 비우면 오늘까지 자동 연장됩니다</p>
            </div>
            <button
              onClick={handleSearch}
              disabled={!canSearch}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold transition-colors ${canSearch ? 'bg-blue-600 hover:bg-blue-500 text-white shadow' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
              title={canSearch ? '조회' : '시작일 또는 종료일을 선택하세요'}
            >
              <Search size={12} /> 조회
            </button>
          </div>
        </>
      )}
    </>
  );
}
