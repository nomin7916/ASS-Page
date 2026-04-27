// @ts-nocheck
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { UI_CONFIG } from '../config';
import { formatPercent, formatCurrency } from '../utils';

const PieLabelOutside = ({ cx, cy, midAngle, outerRadius, percent, name }) => {
  const safePercent = isNaN(percent) ? 0 : percent;
  if (safePercent < 0.03) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 20;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#9ca3af" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight="bold">
      {name} ({(safePercent * 100).toFixed(1)}%)
    </text>
  );
};

export default function PortfolioSummaryPanel({
  totals,
  hoveredPortCatSlice,
  setHoveredPortCatSlice,
  hoveredPortStkSlice,
  setHoveredPortStkSlice,
  hideAmounts,
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 lg:grid-cols-12 gap-6 w-full items-stretch">
      {/* 자산 비중 테이블 */}
      <div className="xl:col-span-4 lg:col-span-12 bg-[#1e293b] rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col h-full">
        <div className="p-3 bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700">📊 자산 비중</div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-800 text-gray-400 font-bold border-b border-gray-700">
              <tr className="text-center">
                <th className="p-3 border-r border-gray-700">구분</th>
                <th className="p-3 border-r border-gray-700 text-blue-300">투자</th>
                <th className="p-3 border-r border-gray-700 text-yellow-400">평가</th>
                <th className="p-3">수익률</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(totals.cats).map(([c, d]) => (
                <tr key={c} className="border-b border-gray-700 hover:bg-gray-800 transition-colors">
                  <td className={`p-3 text-center align-middle font-bold border-r border-gray-700 ${UI_CONFIG.COLORS.CATEGORIES[c]}`}>{c}</td>
                  <td className="py-2 px-3 border-r border-gray-700 align-middle">
                    <div className="flex flex-col items-end justify-center">
                      <span className="whitespace-nowrap">{formatPercent(totals.totalInvest > 0 ? (d.invest / totals.totalInvest) * 100 : 0)}</span>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">{formatCurrency(d.invest)}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 border-r border-gray-700 font-bold text-yellow-400 align-middle">
                    <div className="flex flex-col items-end justify-center">
                      <span className="whitespace-nowrap">{formatPercent(totals.totalEval > 0 ? (d.eval / totals.totalEval) * 100 : 0)}</span>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">{formatCurrency(d.eval)}</span>
                    </div>
                  </td>
                  <td className={`p-3 align-middle font-bold ${d.profit >= 0 ? 'text-red-400' : 'text-blue-400'} whitespace-nowrap`}>
                    {formatPercent(d.invest > 0 ? d.profit / d.invest * 100 : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 도넛 차트 (카테고리 + 종목별) */}
      <div className="xl:col-span-8 lg:col-span-12 bg-[#1e293b] rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col h-full min-h-[400px]">
        <div className="flex bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700 divide-x divide-gray-700">
          <div className="p-3 flex-1 text-center">📊 자산 비중</div>
          <div className="p-3 flex-1 text-center text-blue-400">📈 종목별 비중</div>
        </div>
        <div className="p-4 flex-1 flex flex-col sm:flex-row items-stretch gap-4">
          {/* 카테고리 도넛 */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
              {hoveredPortCatSlice ? (
                <>
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredPortCatSlice.fill }} />
                  <span className="text-[11px] font-bold" style={{ color: hoveredPortCatSlice.fill }}>
                    {hoveredPortCatSlice.name} {(hoveredPortCatSlice.percent * 100).toFixed(1)}%
                  </span>
                  {!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredPortCatSlice.value)}</span>}
                </>
              ) : (
                <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
              )}
            </div>
            <div className="flex-1 min-h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={Object.entries(totals.cats).map(([n, d]) => ({ name: n, value: d.eval })).filter(x => x.value > 0)}
                    innerRadius="40%" outerRadius="70%" dataKey="value"
                    label={PieLabelOutside}
                    onMouseEnter={(data) => setHoveredPortCatSlice(data)}
                    onMouseLeave={() => setHoveredPortCatSlice(null)}
                  >
                    {Object.entries(totals.cats).map((_, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 종목별 도넛 */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
              {hoveredPortStkSlice ? (
                <>
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredPortStkSlice.fill }} />
                  <span className="text-[11px] font-bold" style={{ color: hoveredPortStkSlice.fill }}>
                    {hoveredPortStkSlice.payload?.name ?? hoveredPortStkSlice.name} {(hoveredPortStkSlice.percent * 100).toFixed(1)}%
                  </span>
                  {!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredPortStkSlice.value)}</span>}
                </>
              ) : (
                <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
              )}
            </div>
            <div className="flex-1 min-h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={totals.stks.filter(x => x.eval > 0)}
                    innerRadius="40%" outerRadius="70%" dataKey="eval"
                    label={PieLabelOutside}
                    onMouseEnter={(data) => setHoveredPortStkSlice(data)}
                    onMouseLeave={() => setHoveredPortStkSlice(null)}
                  >
                    {totals.stks.map((_, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CHART_PALETTE[(i + 3) % 8]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
