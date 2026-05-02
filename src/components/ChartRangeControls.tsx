// @ts-nocheck
import React from 'react';
import { Search } from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';

const PERIOD_OPTIONS = [
  { value: '1w',  label: '1주일' },
  { value: '1m',  label: '1개월' },
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

export default function ChartRangeControls({ dateRange, setDateRange, period, setPeriod, onSearch }) {
  return (
    <>
      <div className="flex items-center bg-gray-800 border border-gray-600 rounded shadow-sm px-1.5 py-1 relative z-30">
        <CustomDatePicker
          value={dateRange.start}
          onChange={v => { setDateRange(p => ({ ...p, start: v })); setPeriod('custom'); }}
        />
        <span className="text-gray-500 mx-0.5">~</span>
        <CustomDatePicker
          value={dateRange.end}
          onChange={v => { setDateRange(p => ({ ...p, end: v })); setPeriod('custom'); }}
        />
        <div className="w-[1px] h-4 bg-gray-600 mx-1.5" />
        <button onClick={onSearch} className="text-blue-400 hover:text-blue-300 hover:bg-gray-700 rounded p-1.5 transition-colors" title="조회">
          <Search size={14} />
        </button>
      </div>
      <select
        value={period}
        onChange={e => setPeriod(e.target.value)}
        className="bg-gray-800 text-gray-300 text-xs font-bold border border-gray-600 rounded px-2 py-1.5 outline-none cursor-pointer hover:bg-gray-700 transition-colors shadow-sm"
      >
        {PERIOD_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
        <option value="custom" hidden>직접입력</option>
      </select>
    </>
  );
}
