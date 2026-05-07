// @ts-nocheck
import React, { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { UI_CONFIG } from '../config';
import { cleanNum, formatCurrency, formatNumber, formatChangeRate, handleTableKeyDown, handleReadonlyCellNav } from '../utils';
import { PieLabelOutside } from '../chartUtils';

const SAFE_CATEGORIES = ['채권', '현금', '예수금'];
const getAssetClass = (item) => item.type === 'fund'
  ? (item.assetClass ?? 'S')
  : (item.assetClass ?? (SAFE_CATEGORIES.includes(item.category) ? 'S' : 'D'));

export default function RebalancingPanel({
  activePortfolioAccountType,
  portfolio,
  settings,
  updateSettingsForType,
  rebalanceData,
  rebalanceSortConfig,
  handleRebalanceSort,
  rebalExtraQty,
  setRebalExtraQty,
  rebalCatDonutData,
  curCatDonutData,
  marketIndicators,
  hideAmounts,
  hoveredRebalCatSlice,
  setHoveredRebalCatSlice,
  hoveredCurCatSlice,
  setHoveredCurCatSlice,
  totals,
  handleUpdate,
  setPortfolio,
  showTable = true,
  showDonut = true,
  isRetirement = false,
}) {
  const [editingRatio, setEditingRatio] = useState({});

  const renderCompactPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
    if (percent < 0.05) return null;
    const RADIAN = Math.PI / 180;
    const radius = (innerRadius + outerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    const label = name.length > 4 ? name.slice(0, 4) : name;
    return (
      <text x={x} y={y} fill="black" textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight="bold" style={{ pointerEvents: 'none' }}>
        <tspan x={x} dy="-0.55em">{label}</tspan>
        <tspan x={x} dy="1.15em">{(percent * 100).toFixed(0)}%</tspan>
      </text>
    );
  };

  return (
    <>
        {showTable && <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg w-full flex flex-col mb-6">
          <div className="p-5 bg-[#0f172a] border-b border-gray-700 flex flex-col xl:flex-row xl:items-center gap-4">
            <span className="text-green-400 text-xl font-bold shrink-0">리밸런싱</span>
            <div className="flex-1 flex justify-center gap-8">
              {(curCatDonutData.length > 0 || rebalCatDonutData.length > 0) && (
                <>
                  <div className="flex flex-col items-center">
                    <div className="text-gray-500 text-[10px] font-semibold mb-0.5">현재 비중</div>
                    <div style={{ height: 160, width: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={curCatDonutData} outerRadius="72%" dataKey="value" label={renderCompactPieLabel} labelLine={false} onMouseEnter={(data) => setHoveredCurCatSlice(data)} onMouseLeave={() => setHoveredCurCatSlice(null)}>
                            {curCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="text-gray-500 text-[10px] font-semibold mb-0.5">리밸런싱 후 비중</div>
                    <div style={{ height: 160, width: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={rebalCatDonutData} outerRadius="72%" dataKey="value" label={renderCompactPieLabel} labelLine={false} onMouseEnter={(data) => setHoveredRebalCatSlice(data)} onMouseLeave={() => setHoveredRebalCatSlice(null)}>
                            {rebalCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-col gap-3 w-full xl:w-[600px] shrink-0">
              <div className="flex items-center justify-between bg-gray-800/80 px-4 py-3 rounded-lg border border-gray-700 shadow-inner"><span className="text-gray-300 text-sm font-bold">현재 예수금</span><span className="text-green-400 text-xl font-bold">{(() => { const dep = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0); if (activePortfolioAccountType === 'overseas') { const fx = marketIndicators.usdkrw || 1; return <div className="flex flex-col items-end leading-tight"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(dep)}</span><span className="text-sm text-green-600">{formatCurrency(dep * fx)}</span></div>; } return formatCurrency(dep); })()}</span></div>
              <div className="flex flex-col gap-1">
                <div className="flex items-stretch bg-gray-900 border border-gray-600 rounded-lg overflow-hidden h-12 shadow-sm">
                  <select className="bg-gray-800 text-gray-200 text-sm font-bold px-3 border-r border-gray-600 outline-none cursor-pointer" value={settings.mode} onChange={e => updateSettingsForType({ ...settings, mode: e.target.value })}><option value="rebalance">리밸런싱 (비중 기반)</option><option value="accumulate">적립 (신규 자금 분할)</option></select>
                  {activePortfolioAccountType === 'overseas' ? (
                    <div className="flex-1 flex items-center justify-end px-4 gap-1">
                      <span className="text-sky-400 font-bold text-lg">$</span>
                      <input type="text" className="bg-transparent text-right text-white font-bold outline-none text-lg min-w-0 w-full" value={cleanNum(settings.amount) > 0 ? cleanNum(settings.amount) : ''} placeholder="0" onChange={e => updateSettingsForType({ ...settings, amount: cleanNum(e.target.value) })} onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
                    </div>
                  ) : (
                    <input type="text" className="flex-1 bg-transparent text-right text-white font-bold px-4 outline-none text-lg" value={formatNumber(settings.amount)} onChange={e => updateSettingsForType({ ...settings, amount: cleanNum(e.target.value) })} onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
                  )}
                </div>
                {activePortfolioAccountType === 'overseas' && cleanNum(settings.amount) > 0 && (
                  <div className="text-right text-[11px] text-gray-500 pr-1">≈ {formatCurrency(cleanNum(settings.amount) * (marketIndicators.usdkrw || 1))}</div>
                )}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto bg-[#0f172a]">
            <table className="text-right text-[13px]">
              <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600 font-bold text-center">
                {(() => {
                  const sk = rebalanceSortConfig.key, sd = rebalanceSortConfig.direction;
                  const arr = (k) => <span className={`ml-0.5 text-[9px] ${sk === k ? 'text-gray-300' : 'invisible'}`}>{sk === k && sd === -1 ? '▼' : '▲'}</span>;
                  return (
                    <tr>
                      <th className="py-3 px-3 min-w-[80px] text-center cursor-pointer hover:bg-gray-700 border-r border-gray-600 sticky top-0 left-0 z-30 bg-[#1e293b]" onClick={() => handleRebalanceSort('category')}>구분{arr('category')}</th>
                      <th className="py-3 px-2 min-w-[65px] text-center cursor-pointer hover:bg-gray-700 sticky top-0 left-[80px] z-30 bg-[#1e293b]" onClick={() => handleRebalanceSort('changeRate')}>등락률{arr('changeRate')}</th>
                      <th className="py-3 px-3 min-w-[110px] text-center text-gray-300 cursor-pointer hover:bg-gray-700 sticky top-0 left-[145px] z-30 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]" onClick={() => handleRebalanceSort('name')}>종목명{arr('name')}</th>
                      <th className={`py-3 px-3 min-w-[90px] text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] ${sk === 'code-global' ? 'text-gray-200' : 'text-gray-500'}`} title="왼쪽: 구분별 재배치  |  오른쪽: 코드순 전체 정렬" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); e.clientX < r.left + r.width / 2 ? handleRebalanceSort(null) : handleRebalanceSort('code-global'); }}>코드</th>
                      <th className="py-3 px-3 min-w-[120px] text-gray-400 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('curEval')}>평가금{arr('curEval')}</th>
                      <th className="py-3 px-3 min-w-[100px] text-gray-500 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('currentPrice')}>현재가{arr('currentPrice')}</th>
                      <th className="py-2 px-3 min-w-[100px] text-green-400 font-bold text-center sticky top-0 z-20 bg-[#1e293b]">
                        <div className="flex flex-col items-center gap-1">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (totals.totalEval <= 0) return;
                              const rebalFx = activePortfolioAccountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
                              setPortfolio(prev => prev.map(p => {
                                if (p.type !== 'stock' && p.type !== 'fund') return p;
                                const qty = cleanNum(p.quantity);
                                const price = cleanNum(p.currentPrice);
                                const curEval = p.type === 'fund' && !(qty > 0 && price > 0) ? cleanNum(p.evalAmount) : price * qty;
                                return { ...p, targetRatio: parseFloat((curEval * rebalFx / totals.totalEval * 100).toFixed(rebalFx > 1 ? 2 : 1)) };
                              }));
                            }}
                            className="px-2 py-0.5 text-[10px] font-bold rounded-md border border-green-500/70 text-green-300 bg-green-900/20 hover:bg-green-700/50 hover:border-green-400 active:scale-95 transition-all whitespace-nowrap"
                            title="현재 비중을 목표 비중으로 일괄 설정"
                          >현재→목표</button>
                          <span className="cursor-pointer hover:text-green-300" onClick={() => handleRebalanceSort('targetRatio')}>목표비중(%){arr('targetRatio')}</span>
                        </div>
                      </th>
                      <th className="py-3 px-3 min-w-[80px] text-gray-400 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('curEval')}>현재비중{arr('curEval')}</th>
                      <th className="py-3 px-3 min-w-[75px] text-blue-300 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('action')}>수량{arr('action')}</th>
                      <th className="py-3 px-3 min-w-[65px] text-orange-300 text-center sticky top-0 z-20 bg-[#1e293b]">추가</th>
                      <th className="py-3 px-3 min-w-[85px] text-cyan-400 text-center sticky top-0 z-20 bg-[#1e293b]">추가 가능</th>
                      <th className="py-3 px-3 min-w-[120px] text-blue-300 text-center font-normal cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('cost')}>실 구매비용{arr('cost')}</th>
                      <th className="py-3 px-3 min-w-[120px] text-yellow-500 text-center font-bold cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('expEval')}>예상평가금{arr('expEval')}</th>
                      <th className="py-3 px-3 min-w-[85px] text-yellow-500 font-bold text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b]" onClick={() => handleRebalanceSort('expRatio')}>예상비중{arr('expRatio')}</th>
                    </tr>
                  );
                })()}
              </thead>
              <tbody>
                {(() => {
                  const depositAmount = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
                  const baseTotalCost = rebalanceData.reduce((s, d) => s + d.cost, 0);
                  const rawRemaining = settings.mode === 'accumulate'
                    ? depositAmount + cleanNum(settings.amount) - baseTotalCost
                    : depositAmount - baseTotalCost;
                  const baseRemaining = settings.mode === 'accumulate' ? Math.max(0, rawRemaining) : rawRemaining;
                  const totalExtraAllocated = rebalanceData.reduce((s, d) => s + (rebalExtraQty[d.id] || 0) * cleanNum(d.currentPrice), 0);
                  const effectiveRemaining = baseRemaining - totalExtraAllocated;
                  const isOverseas = activePortfolioAccountType === 'overseas';
                  const usdkrw = marketIndicators.usdkrw || 1;
                  const fmtUSD = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));
                  const catOrder = [];
                  const grouped = {};
                  rebalanceData.forEach(item => {
                    const cat = item.category || '기타';
                    if (!grouped[cat]) { grouped[cat] = []; catOrder.push(cat); }
                    grouped[cat].push(item);
                  });
                  const parseHex = (hex) => {
                    const m = hex.replace('#', '').match(/.{2}/g);
                    if (!m) return null;
                    const [r, g, b] = m.map(x => parseInt(x, 16) / 255);
                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                    const l = (max + min) / 2;
                    if (max === min) return [0, 0, l * 100];
                    const d = max - min;
                    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                    let h;
                    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                    else if (max === g) h = ((b - r) / d + 2) / 6;
                    else h = ((r - g) / d + 4) / 6;
                    return [h * 360, s * 100, l * 100];
                  };
                  const genShades = (baseHex, count) => {
                    const hsl = parseHex(baseHex);
                    if (!hsl || count === 1) return Array(count).fill(baseHex);
                    const [h, s, l] = hsl;
                    return Array.from({ length: count }, (_, i) => {
                      const t = i / (count - 1);
                      const shade = Math.min(78, Math.max(28, l + 18 - t * 36));
                      return `hsl(${h.toFixed(0)},${Math.min(100, s + 5).toFixed(0)}%,${shade.toFixed(0)}%)`;
                    });
                  };
                  const itemColorMap = {};
                  catOrder.forEach(cat => {
                    const baseHex = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const shades = genShades(baseHex, grouped[cat].length);
                    grouped[cat].forEach((item, j) => { itemColorMap[`${cat}::${item.id}`] = shades[j]; });
                  });
                  let rowNum = 0;
                  const renderRow = (item, catTd) => {
                    rowNum += 1;
                    const num = rowNum;
                    const cat = item.category || '기타';
                    const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const itemColor = itemColorMap[`${cat}::${item.id}`] || catColor;
                    const extraQty = rebalExtraQty[item.id] || 0;
                    const totalAction = item.action + extraQty;
                    const itemPrice = cleanNum(item.currentPrice);
                    const adjustedCost = totalAction * itemPrice;
                    const maxAdd = itemPrice > 0
                      ? (settings.mode === 'accumulate' ? Math.max(0, Math.floor(effectiveRemaining / itemPrice)) : Math.floor(effectiveRemaining / itemPrice))
                      : 0;
                    return (
                      <tr key={item.id} className="group border-b border-gray-700 hover:bg-gray-800 transition-colors">
                        {catTd}
                        <td className="py-3 px-2 text-center sticky left-[80px] z-[5] bg-[#0f172a] group-hover:bg-gray-800 transition-colors focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}><span className={`text-xs font-bold ${(item.changeRate || 0) > 0 ? 'text-red-400' : (item.changeRate || 0) < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{item.changeRate != null ? formatChangeRate(item.changeRate) : '-'}</span></td>
                        <td className="py-3 px-4 text-center font-bold sticky left-[145px] z-[5] bg-[#0f172a] group-hover:bg-gray-800 transition-colors [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav} style={{ color: itemColor }}><div className="line-clamp-2">{num}. {item.name}</div></td>
                        <td className="py-3 px-3 text-center text-gray-500 font-mono text-xs focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{item.code}</td>
                        <td className="py-3 px-3 text-gray-400 text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.curEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.curEval * usdkrw)}</span></div> : formatCurrency(item.curEval)}</td>
                        <td className="py-3 px-3 text-gray-500 font-mono text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.currentPrice)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.currentPrice * usdkrw)}</span></div> : formatNumber(item.currentPrice)}</td>
                        <td className="p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                          <input type="text" data-col="targetRatio" className="w-full h-full bg-transparent text-center text-green-400 font-bold outline-none py-3 focus:bg-blue-900/20 caret-blue-400"
                            value={editingRatio[item.id] !== undefined ? editingRatio[item.id] : (isOverseas ? (cleanNum(item.targetRatio) || 0).toFixed(2) : (item.targetRatio || 0))}
                            onChange={e => setEditingRatio(prev => ({ ...prev, [item.id]: e.target.value }))}
                            onBlur={e => { handleUpdate(item.id, 'targetRatio', e.target.value); setEditingRatio(prev => { const n = { ...prev }; delete n[item.id]; return n; }); }}
                            onFocus={e => { setEditingRatio(prev => ({ ...prev, [item.id]: e.target.value })); e.target.select(); }}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); handleTableKeyDown(e, 'targetRatio'); }}
                          />
                        </td>
                        <td className="py-3 px-3 text-center text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{(totals.totalEval > 0 ? (isOverseas ? item.curEval * usdkrw : item.curEval) / totals.totalEval * 100 : 0).toFixed(isOverseas ? 2 : 1)}%</td>
                        <td className="py-3 px-3 text-center font-bold text-blue-300 focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{(totalAction > 0 ? '+' : '') + totalAction}</td>
                        <td className="p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-orange-500">
                          <input type="text" className="w-full h-full bg-transparent text-center text-orange-300 font-bold outline-none py-3 focus:bg-orange-900/20 caret-orange-400 min-w-[65px]" value={extraQty !== 0 ? extraQty : ''} placeholder="0" onChange={e => { const val = parseInt(e.target.value.replace(/[^\-\d]/g, '')) || 0; setRebalExtraQty(prev => ({ ...prev, [item.id]: val })); }} onFocus={e => e.target.select()} />
                        </td>
                        <td className={`py-3 px-3 text-center font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${maxAdd > 0 ? 'text-cyan-400' : maxAdd < 0 ? 'text-red-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{maxAdd > 0 ? '+' + maxAdd : maxAdd < 0 ? maxAdd : '0'}</td>
                        <td className={`py-3 px-3 font-bold text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${adjustedCost > 0 ? 'text-red-400' : adjustedCost < 0 ? 'text-blue-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(adjustedCost)}</span><span className="text-[11px] opacity-70">{formatCurrency(adjustedCost * usdkrw)}</span></div> : formatCurrency(adjustedCost)}</td>
                        <td className="py-3 px-3 font-bold text-yellow-500 text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.expEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.expEval * usdkrw)}</span></div> : formatCurrency(item.expEval)}</td>
                        <td className="py-3 px-3 text-center text-yellow-600 font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{item.expRatio.toFixed(isOverseas ? 2 : 1)}%</td>
                      </tr>
                    );
                  };
                  if (rebalanceSortConfig.key === 'code-global') {
                    return rebalanceData.map(item => {
                      const cat = item.category || '기타';
                      const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                      const catTd = <td className="py-3 px-3 text-center font-bold border-r border-gray-700 align-middle bg-[#0f172a] sticky left-0 z-[5]"><div style={{ color: catColor }} className="text-xs">{cat}</div></td>;
                      return renderRow(item, catTd);
                    });
                  }
                  return catOrder.flatMap(cat => {
                    const items = grouped[cat];
                    const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const catTotalEval = items.reduce((sum, item) => sum + item.curEval, 0);
                    const catRatio = totals.totalEval > 0 ? catTotalEval / totals.totalEval * 100 : 0;
                    return items.map((item, j) => {
                      const catTd = j === 0
                        ? <td rowSpan={items.length} className="py-3 px-3 text-center font-bold border-r border-gray-700 align-middle bg-[#0f172a] sticky left-0 z-[5]"><div style={{ color: catColor }}>{cat}</div><div className="text-gray-400 text-[10px] font-normal mt-0.5">{isOverseas ? <>{fmtUSD(catTotalEval)}<br/><span className="text-gray-600">{formatCurrency(catTotalEval * usdkrw)}</span></> : formatCurrency(catTotalEval)}</div><div className="text-gray-400 text-[10px] font-normal">{catRatio.toFixed(1)}%</div></td>
                        : null;
                      return renderRow(item, catTd);
                    });
                  });
                })()}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td colSpan={3} className="py-3 px-3 text-center uppercase tracking-widest text-gray-500 text-xs sticky left-0 z-[5] bg-[#1e293b]">TOTAL</td>
                  <td className="py-3 px-3"></td>
                  {(() => { const totCurEval = rebalanceData.reduce((s, d) => s + d.curEval, 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className="py-3 px-3 text-gray-300 font-bold text-right">{isOv ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUS(totCurEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(totCurEval * fxRate)}</span></div> : formatCurrency(totCurEval)}</td>; })()}
                  <td className="py-3 px-3"></td>
                  <td className="py-3 px-3 text-center font-bold text-green-400">{rebalanceData.reduce((s, d) => s + (d.targetRatio || 0), 0).toFixed(activePortfolioAccountType === 'overseas' ? 2 : 1)}%</td>
                  <td className="py-3 px-3 text-center font-bold text-gray-400">100%</td>
                  <td className="py-3 px-3"></td>
                  <td className="py-3 px-3"></td>
                  <td className="py-3 px-3"></td>
                  {(() => { const adjTotal = rebalanceData.reduce((s, d) => s + (d.action + (rebalExtraQty[d.id] || 0)) * cleanNum(d.currentPrice), 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className={`py-3 px-3 font-bold text-right ${adjTotal > 0 ? 'text-red-400' : adjTotal < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{isOv ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUS(adjTotal)}</span><span className="text-[11px] opacity-70">{formatCurrency(adjTotal * fxRate)}</span></div> : formatCurrency(adjTotal)}</td>; })()}
                  {(() => { const totExpEval = rebalanceData.reduce((s, d) => s + d.expEval, 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className="py-3 px-3 font-bold text-yellow-400 text-right">{isOv ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUS(totExpEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(totExpEval * fxRate)}</span></div> : formatCurrency(totExpEval)}</td>; })()}
                  <td className="py-3 px-3 text-center font-bold text-yellow-500">100%</td>
                </tr>
                {isRetirement && (() => {
                  const depositEval = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
                  const curD = rebalanceData.filter(d => getAssetClass(d) === 'D').reduce((s, d) => s + d.curEval, 0);
                  const curS = rebalanceData.filter(d => getAssetClass(d) === 'S').reduce((s, d) => s + d.curEval, 0) + depositEval;
                  const curTotal = curD + curS;
                  const curDRatio = curTotal > 0 ? curD / curTotal * 100 : 0;
                  const projD = rebalanceData.filter(d => getAssetClass(d) === 'D').reduce((s, d) => s + d.expEval, 0);
                  const projS = rebalanceData.filter(d => getAssetClass(d) === 'S').reduce((s, d) => s + d.expEval, 0) + depositEval;
                  const projTotal = projD + projS;
                  const projDRatio = projTotal > 0 ? projD / projTotal * 100 : 0;
                  const projSRatio = projTotal > 0 ? projS / projTotal * 100 : 0;
                  const onTarget = Math.abs(projDRatio - 70) <= 5;
                  return (
                    <tr className="border-t border-amber-600/30 bg-amber-950/20">
                      <td colSpan={14} className="py-2.5 px-4">
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className="text-amber-400 font-bold text-xs tracking-wide">퇴직연금 자산 비율</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-500 text-[11px]">현재</span>
                            <span className="text-red-300 text-xs font-bold">D {curDRatio.toFixed(1)}%</span>
                            <span className="text-gray-600 text-[10px]">/</span>
                            <span className="text-emerald-300 text-xs font-bold">S {(100 - curDRatio).toFixed(1)}%</span>
                            <span className="text-gray-500 text-[11px] ml-2">→</span>
                            <span className="text-gray-400 text-[11px]">예상</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-red-400 font-bold text-xs">위험 D</span>
                            <span className={`font-bold text-sm ${onTarget ? 'text-red-400' : 'text-red-300'}`}>{projDRatio.toFixed(1)}%</span>
                            <span className="text-gray-600 text-[11px]">(목표 70%)</span>
                            {!onTarget && (
                              <span className="text-orange-400 text-[11px]">
                                {projDRatio > 70 ? `+${(projDRatio - 70).toFixed(1)}%` : `${(projDRatio - 70).toFixed(1)}%`}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-emerald-400 font-bold text-xs">안전 S</span>
                            <span className={`font-bold text-sm ${Math.abs(projSRatio - 30) <= 5 ? 'text-emerald-400' : 'text-emerald-300'}`}>{projSRatio.toFixed(1)}%</span>
                            <span className="text-gray-600 text-[11px]">(목표 30%)</span>
                          </div>
                          <div className="flex-1 flex items-center gap-1 min-w-[120px]">
                            <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${Math.min(projDRatio, 100)}%`,
                                  background: onTarget
                                    ? 'linear-gradient(90deg, #ef4444 0%, #f97316 100%)'
                                    : 'linear-gradient(90deg, #dc2626 0%, #ea580c 100%)',
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500 shrink-0">D70/S30</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
        </div>}

        {/* 리밸런싱 자산 비중 도넛 차트 */}
        {showDonut && <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden mb-6">
          <div className="p-3 bg-[#0f172a] border-b border-gray-700">
            <span className="text-white font-bold text-sm">🍩 자산 비중 비교</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-700">
            {/* 왼쪽: 리밸런싱 후 예상 자산 비중 */}
            <div className="p-4">
              <div className="text-gray-400 text-xs text-center mb-2 font-semibold">리밸런싱 후 예상 자산 비중</div>
              {rebalCatDonutData.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs">데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                    {hoveredRebalCatSlice ? (
                      <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredRebalCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredRebalCatSlice.fill }}>{hoveredRebalCatSlice.name} {(hoveredRebalCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{activePortfolioAccountType === 'overseas' ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(hoveredRebalCatSlice.value) : formatCurrency(hoveredRebalCatSlice.value)}</span>}</>
                    ) : (
                      <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                    )}
                  </div>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={rebalCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredRebalCatSlice(data)} onMouseLeave={() => setHoveredRebalCatSlice(null)}>
                          {rebalCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="w-full text-xs mt-3">
                    <thead className="text-gray-400 border-b border-gray-700">
                      <tr className="text-center">
                        <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                        <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">예상평가금</th>
                        <th className="pb-2 px-3">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = rebalCatDonutData.reduce((s, x) => s + x.value, 0);
                        return rebalCatDonutData.map(({ name, value }, i) => (
                          <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                            <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                              <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                            </td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value)}</span><span className="text-[11px] text-gray-500">{formatCurrency(value * (marketIndicators.usdkrw || 1))}</span></div> : formatCurrency(value)}</td>
                            <td className="py-1.5 px-3 text-gray-400 text-right">{total > 0 ? ((value / total) * 100).toFixed(1) : 0}%</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </>
              )}
            </div>
            {/* 오른쪽: 현재 포트폴리오 자산 비중 */}
            <div className="p-4">
              <div className="text-gray-400 text-xs text-center mb-2 font-semibold">현재 자산 비중</div>
              {curCatDonutData.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs">데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                    {hoveredCurCatSlice ? (
                      <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredCurCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredCurCatSlice.fill }}>{hoveredCurCatSlice.name} {(hoveredCurCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{activePortfolioAccountType === 'overseas' ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(hoveredCurCatSlice.value / (marketIndicators.usdkrw || 1)) : formatCurrency(hoveredCurCatSlice.value)}</span>}</>
                    ) : (
                      <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                    )}
                  </div>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={curCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredCurCatSlice(data)} onMouseLeave={() => setHoveredCurCatSlice(null)}>
                          {curCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="w-full text-xs mt-3">
                    <thead className="text-gray-400 border-b border-gray-700">
                      <tr className="text-center">
                        <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                        <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">평가금액</th>
                        <th className="pb-2 px-3">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {curCatDonutData.map(({ name, value }, i) => (
                        <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                          <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                            <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                          </td>
                          <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value / (marketIndicators.usdkrw || 1))}</span><span className="text-[11px] text-gray-500">{formatCurrency(value)}</span></div> : formatCurrency(value)}</td>
                          <td className="py-1.5 px-3 text-gray-400 text-right">{totals.totalEval > 0 ? ((value / totals.totalEval) * 100).toFixed(1) : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>}
    </>
  );
}
