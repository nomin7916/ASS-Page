// @ts-nocheck
import React from 'react';
import { X } from 'lucide-react';

const INDICATOR_LABELS = {
  us10y: 'US 10Y', kr10y: 'KR 10Y', goldIntl: 'Gold', goldKr: '국내금',
  usdkrw: 'USDKRW', dxy: 'DXY', fedRate: '기준금리', vix: 'VIX'
};

export default function ScaleSettingModal({
  isScaleSettingOpen,
  setIsScaleSettingOpen,
  showIndicatorsInChart,
  indicatorScales,
  setIndicatorScales,
}) {
  if (!isScaleSettingOpen) return null;
  const activeKeys = Object.keys(showIndicatorsInChart).filter(k => showIndicatorsInChart[k]);
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[400] animate-in fade-in backdrop-blur-sm">
      <div className="bg-[#1e293b] rounded-xl w-full max-w-sm border border-indigo-700/50 shadow-2xl overflow-hidden flex flex-col">
        <div className="bg-indigo-950/60 p-4 border-b border-indigo-800/50 flex justify-between items-center">
          <span className="text-indigo-300 font-extrabold flex items-center gap-2">⚙️ 지표 배율 설정</span>
          <button onClick={() => setIsScaleSettingOpen(false)} className="text-gray-400 hover:text-white transition-colors p-1"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {activeKeys.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">차트에 표시 중인 지표가 없습니다.</p>
          ) : (
            activeKeys.map(k => (
              <div key={k} className="flex items-center gap-3">
                <span className="text-[12px] font-bold text-gray-300 w-20 shrink-0">{INDICATOR_LABELS[k]}</span>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={indicatorScales[k] ?? 1}
                  onChange={e => setIndicatorScales(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                  className="flex-1 accent-indigo-500 cursor-pointer"
                />
                <span className="text-[12px] font-bold text-indigo-300 w-8 text-right shrink-0">x{indicatorScales[k] ?? 1}</span>
                {(indicatorScales[k] ?? 1) !== 1 && (
                  <button
                    onClick={() => setIndicatorScales(prev => ({ ...prev, [k]: 1 }))}
                    className="text-gray-500 hover:text-gray-300 transition"
                    title="초기화"
                  ><X size={12} /></button>
                )}
              </div>
            ))
          )}
        </div>
        <div className="px-5 pb-4 flex justify-between items-center border-t border-gray-700/50 pt-3">
          <button
            onClick={() => setIndicatorScales({ us10y: 1, goldIntl: 1, usdkrw: 1, dxy: 1, fedRate: 1, kr10y: 1, vix: 1 })}
            className="text-[11px] text-gray-400 hover:text-gray-200 transition"
          >전체 초기화</button>
          <button
            onClick={() => setIsScaleSettingOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-bold transition"
          >닫기</button>
        </div>
      </div>
    </div>
  );
}
