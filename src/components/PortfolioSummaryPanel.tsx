// @ts-nocheck
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { UI_CONFIG } from '../config';
import { formatPercent, formatCurrency } from '../utils';
import { PieLabelOutside } from '../chartUtils';
import CardExpandButton from './CardExpandButton';
import { normalizeCategoryView, userCategoryColor } from '../userCategory';

// '자산군 | 사용자 구분' 전환 — 계좌별 저장(categoryViewSummary). 포트폴리오 표 구분 열의 보기와는 따로다.
const VIEW_OPTIONS = [['asset', '자산군'], ['user', '사용자 구분']];

export default function PortfolioSummaryPanel({
  totals,
  hoveredPortCatSlice,
  setHoveredPortCatSlice,
  hoveredPortStkSlice,
  setHoveredPortStkSlice,
  hideAmounts,
  onExpand,          // 별도 창으로 열기(별도 창 자신에는 미전달 → 버튼 미렌더)
  cardWindowOpen,
  categoryView = 'asset',
  onCategoryViewChange = null,
}) {
  const isUserView = normalizeCategoryView(categoryView) === 'user';
  const cats = (isUserView ? totals.userCats : totals.cats) || {};
  const userCategories = totals.userCategories || [];
  const userCategoryNames = totals.userCategoryNames || userCategories;
  // 사용자 구분 이름 색 — 자산군과 같은 이름이면 그 색, 아니면 포트폴리오 표 칸과 같은 팔레트 순번 색.
  const labelProps = (c) => {
    const cls = UI_CONFIG.COLORS.CATEGORIES[c];
    if (!isUserView || cls) return { className: cls || '', style: undefined };
    const hex = userCategoryColor(c, userCategoryNames, UI_CONFIG.COLORS.CHART_PALETTE);
    return { className: '', style: hex ? { color: hex } : undefined };
  };
  const changeView = (m) => {
    if (!onCategoryViewChange || normalizeCategoryView(m) === normalizeCategoryView(categoryView)) return;
    setHoveredPortCatSlice(null);
    onCategoryViewChange(m);
  };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 lg:grid-cols-12 gap-6 w-full items-stretch">
      {/* 자산 비중 테이블 */}
      <div className="xl:col-span-4 lg:col-span-12 bg-[#1e293b] rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col h-full">
        <div className="p-3 bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700 flex items-center gap-2 flex-wrap">
          <span>📊 자산 비중</span>
          {onCategoryViewChange && (
            <div className="inline-flex rounded-md border border-gray-600 overflow-hidden text-[11px] font-bold">
              {VIEW_OPTIONS.map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => changeView(m)}
                  className={`px-2 py-0.5 transition-colors ${(isUserView ? 'user' : 'asset') === m ? 'bg-blue-600/70 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
                  title={m === 'asset' ? '자산군(구분)별 비중을 봅니다' : '사용자 구분별 비중을 봅니다 — 사용자 구분이 빈 종목은 자산군으로 묶입니다'}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="ml-auto"><CardExpandButton onExpand={onExpand} opened={cardWindowOpen} label="포트폴리오 요약" /></span>
        </div>
        {isUserView && userCategories.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-gray-400 border-b border-gray-700 bg-gray-900/40">
            입력한 사용자 구분이 없어 자산군과 같게 보입니다. 포트폴리오 표 구분 열에서 '사용자'를 눌러 입력하세요.
          </div>
        )}
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
              {Object.entries(cats).map(([c, d]) => {
                const lp = labelProps(c);
                return (
                <tr key={c} className="border-b border-gray-700 hover:bg-gray-800 transition-colors">
                  <td className={`p-3 text-center align-middle font-bold border-r border-gray-700 ${lp.className}`} style={lp.style}>{c}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 도넛 차트 (카테고리 + 종목별) */}
      <div className="xl:col-span-8 lg:col-span-12 bg-[#1e293b] rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col h-full min-h-[400px]">
        <div className="flex bg-[#0f172a] text-white font-bold text-sm border-b border-gray-700 divide-x divide-gray-700">
          <div className="p-3 flex-1 text-center">📊 {isUserView ? '사용자 구분 비중' : '자산 비중'}</div>
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
                    data={Object.entries(cats).map(([n, d]) => ({ name: n, value: d.eval })).filter(x => x.value > 0)}
                    innerRadius="40%" outerRadius="70%" dataKey="value"
                    label={PieLabelOutside}
                    onMouseEnter={(data) => setHoveredPortCatSlice(data)}
                    onMouseLeave={() => setHoveredPortCatSlice(null)}
                  >
                    {Object.entries(cats).map((_, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
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
