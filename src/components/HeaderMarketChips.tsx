// @ts-nocheck
import React, { useState } from 'react';

const GROUPS = [
  {
    items: [
      { label: 'KOSPI',  getVal: (m) => m.kospiPrice,  getChg: (m) => m.kospiChg,   fmt: (v) => v?.toFixed(2),                                                   color: '#38bdf8' },
      { label: 'S&P500', getVal: (m) => m.sp500Price,  getChg: (m) => m.sp500Chg,   fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }),         color: '#bf5af2' },
      { label: 'NDX100', getVal: (m) => m.nasdaqPrice, getChg: (m) => m.nasdaqChg,  fmt: (v) => v?.toLocaleString('en-US', { maximumFractionDigits: 2 }),         color: '#30d158' },
    ],
  },
  {
    items: [
      { label: 'US 10Y', getVal: (m) => m.us10y,   getChg: (m) => m.us10yChg,   fmt: (v) => v?.toFixed(3) + '%',                                              color: '#8e8e93' },
      { label: 'KR 10Y', getVal: (m) => m.kr10y,   getChg: (m) => m.kr10yChg,   fmt: (v) => v?.toFixed(3) + '%',                                              color: '#636366' },
      { label: '국내 금', getVal: (m) => m.goldKr,  getChg: (m) => m.goldKrChg,  fmt: (v) => v?.toLocaleString('ko-KR', { maximumFractionDigits: 0 }),         color: '#d97706' },
    ],
  },
  {
    items: [
      { label: 'USDKRW', getVal: (m) => m.usdkrw,  getChg: (m) => m.usdkrwChg,  fmt: (v) => v?.toFixed(2),                                                   color: '#0a84ff' },
      { label: 'DXY',    getVal: (m) => m.dxy,     getChg: (m) => m.dxyChg,     fmt: (v) => v?.toFixed(3),                                                   color: '#5ac8fa' },
      { label: 'VIX',    getVal: (m) => m.vix,     getChg: (m) => m.vixChg,     fmt: (v) => v?.toFixed(2),                                                   color: '#ff453a' },
    ],
  },
];

export default function HeaderMarketChips({ marketIndicators }) {
  const [indices, setIndices] = useState([0, 0, 0]);

  if (!marketIndicators) return null;

  const cycle = (gi) => {
    setIndices(prev => {
      const next = [...prev];
      next[gi] = (next[gi] + 1) % 3;
      return next;
    });
  };

  return (
    <div className="flex items-center gap-0.5">
      {GROUPS.map((group, gi) => {
        const item = group.items[indices[gi]];
        const val = item.getVal(marketIndicators);
        const chg = item.getChg(marketIndicators);
        const formatted = val !== null && val !== undefined ? item.fmt(val) : null;
        return (
          <button
            key={gi}
            onClick={() => cycle(gi)}
            className="flex flex-col items-end px-1.5 py-0.5 rounded hover:bg-gray-800/70 transition-colors cursor-pointer select-none"
            style={{ minWidth: 58 }}
            title={`클릭: ${group.items.map(i => i.label).join(' → ')}`}
          >
            <span className="text-[9px] font-bold leading-none" style={{ color: item.color }}>
              {item.label}
            </span>
            <span className="text-[11px] font-bold font-mono text-white leading-none mt-[2px]">
              {formatted ?? '-'}
            </span>
            {chg !== null && chg !== undefined ? (
              <span className={`text-[9px] font-mono font-bold leading-none mt-[2px] ${chg > 0 ? 'text-red-400' : chg < 0 ? 'text-blue-400' : 'text-gray-500'}`}>
                {chg > 0 ? '▲' : chg < 0 ? '▼' : ''}{Math.abs(chg).toFixed(2)}%
              </span>
            ) : (
              <span className="text-[9px] text-gray-600 leading-none mt-[2px]">-</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
