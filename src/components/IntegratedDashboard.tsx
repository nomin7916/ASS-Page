﻿// @ts-nocheck
import React, { useState, useRef, useCallback } from 'react';
import { Plus, Download, Trash2, Maximize2, X, Check, CalendarPlus, Activity, TrendingUp } from 'lucide-react';
import ChartRangeControls from './ChartRangeControls';
import {
  PieChart, Pie, Cell, ComposedChart, Line, Area, XAxis,
  YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts';
import { UI_CONFIG } from '../config';
import { formatCurrency, formatPercent, formatShortDate, formatVeryShortDate, cleanNum } from '../utils';

import CustomDatePicker from './CustomDatePicker';
import { PieLabelOutside } from '../chartUtils';
import DividendSummaryTable from './DividendSummaryTable';


const hexToRgba = (hex, alpha) => {
  if (!hex || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const blendWithDarkBg = (hex, alpha, bgHex = '#1e293b') => {
  if (!hex || hex.length < 7) return bgHex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const bgR = parseInt(bgHex.slice(1, 3), 16);
  const bgG = parseInt(bgHex.slice(3, 5), 16);
  const bgB = parseInt(bgHex.slice(5, 7), 16);
  return `rgb(${Math.round(bgR*(1-alpha)+r*alpha)}, ${Math.round(bgG*(1-alpha)+g*alpha)}, ${Math.round(bgB*(1-alpha)+b*alpha)})`;
};

export default function IntegratedDashboard({
  intHistory,
  intTotals,
  intMonthlyHistory,
  intChartData,
  intChartPeriod,
  intSelectionResult,
  intIsZeroBaseMode,
  intRefAreaLeft,
  intRefAreaRight,
  intCatDonutData,
  intHoldingsDonutData,
  hoveredIntCatSlice,
  hoveredIntHoldSlice,
  portfolioSummaries,
  intExpandedCat,
  simpleEditField,
  showNewAccountMenu,
  hideAmounts,
  setIntChartPeriod,
  intDateRange,
  setIntDateRange,
  setIntAppliedRange,
  handleIntSearchClick,
  setIntIsZeroBaseMode,
  setHoveredIntCatSlice,
  setHoveredIntHoldSlice,
  setShowNewAccountMenu,
  setSimpleEditField,
  addPortfolio,
  addSimpleAccount,
  deletePortfolio,
  switchToPortfolio,
  movePortfolio,
  updatePortfolioColor,
  updatePortfolioStartDate,
  updatePortfolioName,
  updatePortfolioMemo,
  updateSimpleAccountField,
  resetAllPortfolioColors,
  handleIntChartMouseDown,
  handleIntChartMouseMove,
  handleIntChartMouseUp,
  handleIntChartMouseLeave,
  intHoveredPoint,
  handleSave,
  allPortfoliosForDividend,
  updatePortfolioDividendHistory,
  updatePortfolioActualDividend,
  updatePortfolioDividendTaxRate,
  updatePortfolioDividendSeparateTax,
  updatePortfolioDividendTaxAmount,
  updatePortfolioActualDividendUsd,
  updatePortfolioActualAfterTaxUsd,
  updatePortfolioActualAfterTaxKrw,
  usdkrw = 1300,
  dividendTaxHistory = {},
  onManualBackfill,
  sec = { dividend: false, history: false, donut: false },
  setSec,
}) {
  const toggleSec = (key) => setSec(prev => ({ ...prev, [key]: !prev[key] }));

  const [memoModal, setMemoModal] = useState(null);
  const [memoPos, setMemoPos] = useState({ x: 0, y: 0 });
  const memoDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });

  const newAccBtnRef = useRef(null);
  const [newAccMenuPos, setNewAccMenuPos] = useState({ top: 0, right: 0 });

  const handleNewAccToggle = useCallback(() => {
    if (newAccBtnRef.current) {
      const rect = newAccBtnRef.current.getBoundingClientRect();
      setNewAccMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setShowNewAccountMenu(v => !v);
  }, [setShowNewAccountMenu]);

  const openMemoModal = (id, memo) => {
    setMemoPos({ x: window.innerWidth / 2 - 128, y: window.innerHeight / 2 - 180 });
    setMemoModal({ id, val: memo ?? '' });
  };

  const handleMemoDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    memoDrag.current = { active: true, offsetX: e.clientX - memoPos.x, offsetY: e.clientY - memoPos.y };
    const onMove = (e) => {
      if (!memoDrag.current.active) return;
      setMemoPos({ x: e.clientX - memoDrag.current.offsetX, y: e.clientY - memoDrag.current.offsetY });
    };
    const onUp = () => {
      memoDrag.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const saveMemoModal = () => {
    if (!memoModal) return;
    updatePortfolioMemo(memoModal.id, memoModal.val);
    setMemoModal(null);
  };

  return (
    <>
          <div className="flex flex-col gap-6 w-full">

            {/* 통합 요약 카드 */}
            {(() => {
              const sortedIntHist = [...intHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
              const todayRec = sortedIntHist[0];
              const prevRec = sortedIntHist[1];
              const todayProfit = todayRec && prevRec ? todayRec.evalAmount - prevRec.evalAmount : 0;
              const todayRate = prevRec?.evalAmount > 0 ? todayProfit / prevRec.evalAmount * 100 : 0;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">총 자산 (평가금)</span>
                    <span className="text-white text-lg font-extrabold">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalEval)}</span>
                  </div>
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">오늘 수익 ({todayRec?.date || '-'})</span>
                    <span className={`text-lg font-extrabold ${todayProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {hideAmounts ? '••••••' : `${todayProfit >= 0 ? '+' : ''}${formatCurrency(todayProfit)}`}
                    </span>
                    <span className={`text-[11px] font-bold ${todayRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {todayRate >= 0 ? '+' : ''}{todayRate.toFixed(2)}%
                    </span>
                  </div>
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">전체 수익율</span>
                    <span className={`text-lg font-extrabold ${intTotals.returnRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {intTotals.returnRate >= 0 ? '+' : ''}{intTotals.returnRate.toFixed(2)}%
                    </span>
                  </div>
                  <div className="bg-[#1e293b] rounded-xl border border-gray-700 p-4 flex flex-col gap-1">
                    <span className="text-gray-400 text-[11px] font-bold">총 투자원금</span>
                    <span className="text-white text-lg font-extrabold">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalPrincipal)}</span>
                  </div>
                </div>
              );
            })()}

            <div className="flex items-start gap-0 w-full">
              <div className="flex-1 flex flex-col gap-6 min-w-0" style={{ paddingBottom: '40vh' }}>
            <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg">
              <div className="p-3 bg-[#0f172a] flex justify-between items-center border-b border-gray-700">
                <span className="text-white font-bold text-sm">🏦 통합 계좌 현황</span>
                <div className="flex gap-1 items-center">
                  <div>
                    <button
                      ref={newAccBtnRef}
                      onClick={handleNewAccToggle}
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors text-xs font-bold px-2 py-1 hover:bg-blue-900/20 rounded"
                    >
                      <Plus size={12} /> 새 계좌 <span className="text-[9px] opacity-60">▼</span>
                    </button>
                    {showNewAccountMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowNewAccountMenu(false)} />
                        <div
                          className="fixed z-50 bg-[#1e293b] border border-gray-600 rounded-lg shadow-2xl py-1 min-w-[160px]"
                          style={{ top: newAccMenuPos.top, right: newAccMenuPos.right }}
                        >
                          {[
                            { type: 'dc-irp',    icon: '🏦', label: '퇴직연금 계좌' },
                            { type: 'isa',       icon: '🌱', label: 'ISA 계좌' },
                            { type: 'portfolio', icon: '📈', label: '일반증권 계좌' },
                            { type: 'dividend',  icon: '💰', label: '배당형 계좌' },
                            { type: 'pension',   icon: '🎯', label: '연금저축 계좌' },
                            { type: 'gold',      icon: '🥇', label: 'KRX 금현물 계좌' },
                            { type: 'overseas',  icon: '🌐', label: '해외계좌' },
                            { type: 'crypto',    icon: '₿',  label: 'CRYPTO 계좌' },
                          ].map(({ type, icon, label }) => (
                            <button
                              key={type}
                              onClick={() => { addPortfolio(type); setShowNewAccountMenu(false); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-blue-900/30 hover:text-white transition-colors flex items-center gap-2"
                            >
                              <span>{icon}</span> {label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <button onClick={addSimpleAccount} className="flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors text-xs font-bold px-2 py-1 hover:bg-green-900/20 rounded" title="날짜·계좌·자산을 직접 입력하는 간단 계좌 추가">
                    <Plus size={12} /> 직접입력
                  </button>
                  <div className="w-[1px] h-4 bg-gray-700 mx-1" />
                  <button onClick={handleSave} className="flex items-center gap-1 text-orange-400 hover:text-orange-300 transition-colors text-xs font-bold px-2 py-1 hover:bg-orange-900/20 rounded" title="JSON 파일로 다운로드 (PC 백업)">
                    <Download size={12} /> PC 백업
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="bg-[#0f172a] text-gray-400 border-b border-gray-700">
                    <tr>
                      <th className="border-r border-gray-700 cursor-pointer hover:bg-red-900/30 transition-colors" style={{width:'10px',minWidth:'10px'}} onClick={resetAllPortfolioColors} title="클릭하여 모든 행 색상 초기화"></th>
                      <th className="py-2 px-2 text-center border-r border-gray-700">순서</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">시작일</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700 sticky left-0 z-20 bg-[#0f172a]">계좌</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">투자원금</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">투자비율</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">총자산</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">수익율</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">CAGR</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">예수금</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700">수익</th>
                      <th className="py-2 px-3 text-center border-r border-gray-700 min-w-[180px]">비고</th>
                      <th className="py-2 px-2 text-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioSummaries.map((s, sIdx) => {
                      const allocRatio = intTotals.totalEval > 0 ? s.currentEval / intTotals.totalEval * 100 : 0;
                      const isCatOpen = intExpandedCat === s.id;
                      const isSimple = s.accountType === 'simple';
                      return (
                        <React.Fragment key={s.id}>
                          <tr
                            className={`border-b border-gray-700 transition-colors ${!s.rowColor ? (s.isActive ? 'bg-blue-950/20' : isSimple ? 'bg-green-950/10 hover:bg-green-900/10' : 'hover:bg-gray-800/40') : ''}`}
                            style={s.rowColor ? { backgroundColor: hexToRgba(s.rowColor, 0.18) } : {}}
                          >
                            {/* 색상 스트립 */}
                            <td className="p-0 border-r border-gray-700" style={{width:'10px',minWidth:'10px'}}>
                              {s.rowColor ? (
                                <button title="클릭하여 행 색상 제거" className="block w-full cursor-pointer border-0 outline-none" style={{minHeight:'32px', backgroundColor: s.rowColor}} onClick={() => updatePortfolioColor(s.id, '')} />
                              ) : (
                                <label title="클릭하여 행 색상 설정" className="block w-full cursor-pointer" style={{minHeight:'32px', backgroundColor: '#334155'}}>
                                  <input type="color" className="sr-only" defaultValue="#3b82f6" onChange={e => updatePortfolioColor(s.id, e.target.value)} />
                                </label>
                              )}
                            </td>
                            {/* 순서 화살표 */}
                            <td className="py-1.5 px-2 text-center border-r border-gray-700">
                              <div className="flex flex-col items-center gap-0.5">
                                <button onClick={() => movePortfolio(s.id, -1)} disabled={sIdx === 0} className="text-gray-500 hover:text-blue-400 disabled:opacity-20 disabled:cursor-default leading-none text-[10px]" title="위로">▲</button>
                                <button onClick={() => movePortfolio(s.id, 1)} disabled={sIdx === portfolioSummaries.length - 1} className="text-gray-500 hover:text-blue-400 disabled:opacity-20 disabled:cursor-default leading-none text-[10px]" title="아래로">▼</button>
                              </div>
                            </td>
                            <td className="py-1.5 px-3 text-center border-r border-gray-700">
                              <CustomDatePicker value={s.startDate} onChange={v => updatePortfolioStartDate(s.id, v)} />
                            </td>
                            {/* 계좌 */}
                            <td
                              className={`py-1.5 px-3 text-center border-r border-gray-700 sticky left-0 z-[5] bg-[#1e293b] ${!isSimple ? 'cursor-pointer hover:bg-blue-900/20' : ''}`}
                              style={s.rowColor ? { backgroundColor: blendWithDarkBg(s.rowColor, 0.35) } : {}}
                              onClick={!isSimple ? () => switchToPortfolio(s.id) : undefined}
                            >
                              {isSimple ? (
                                <input type="text" className="w-full min-w-[70px] bg-transparent font-bold outline-none text-center text-green-300" value={s.name} onChange={e => updatePortfolioName(s.id, e.target.value)} />
                              ) : (
                                <span className="font-bold text-blue-300 select-none">{s.name}</span>
                              )}
                            </td>
                            {/* 투자원금 */}
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-200 font-bold">
                              {isSimple ? (
                                hideAmounts ? '••••••' : (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="w-full min-w-[90px] bg-transparent font-bold outline-none text-center text-gray-200 border-b border-dashed border-gray-600 focus:border-green-400"
                                  value={simpleEditField?.id === s.id && simpleEditField?.field === 'principal'
                                    ? (s.principal || '')
                                    : s.principal ? formatCurrency(s.principal) : ''}
                                  placeholder={s.currentEval ? formatCurrency(s.currentEval) : '₩0'}
                                  onFocus={e => { setSimpleEditField({id: s.id, field: 'principal'}); e.target.select(); }}
                                  onBlur={() => setSimpleEditField(null)}
                                  onChange={e => updateSimpleAccountField(s.id, 'principal', e.target.value.replace(/[^0-9]/g, ''))}
                                />)
                              ) : (hideAmounts ? '••••••' : formatCurrency(s.principal))}
                            </td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-300">{allocRatio.toFixed(2)}%</td>
                            {/* 총자산 */}
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center font-bold text-white">
                              {isSimple ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="w-full min-w-[90px] bg-transparent font-bold outline-none text-center text-white border-b border-dashed border-gray-600 focus:border-green-400"
                                  value={simpleEditField?.id === s.id && simpleEditField?.field === 'eval'
                                    ? (s.currentEval || '')
                                    : s.currentEval ? formatCurrency(s.currentEval) : ''}
                                  placeholder="₩0"
                                  onFocus={e => { setSimpleEditField({id: s.id, field: 'eval'}); e.target.select(); }}
                                  onBlur={() => setSimpleEditField(null)}
                                  onChange={e => updateSimpleAccountField(s.id, 'evalAmount', e.target.value.replace(/[^0-9]/g, ''))}
                                />
                              ) : (hideAmounts ? '••••••' : formatCurrency(s.currentEval))}
                            </td>
                            <td className={`py-1.5 px-3 border-r border-gray-700 text-center font-bold ${s.returnRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatPercent(s.returnRate)}</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-blue-300 font-bold">{formatPercent(s.cagr)}</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-center text-gray-400 font-bold">{isSimple ? '-' : (hideAmounts ? '••••••' : formatCurrency(s.depositAmount))}</td>
                            {/* 수익 */}
                            <td className={`py-1.5 px-3 border-r border-gray-700 text-center font-bold ${s.currentEval - s.principal >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                              {hideAmounts ? '••••••' : formatCurrency(s.currentEval - s.principal)}
                            </td>
                            <td className="p-0 border-r border-gray-700 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                              <div className="flex items-center">
                                <input type="text" className="flex-1 min-w-0 bg-transparent outline-none px-2 py-1.5 text-gray-300 text-xs caret-blue-400 overflow-hidden placeholder-gray-600" value={s.memo ?? ''} onChange={e => updatePortfolioMemo(s.id, e.target.value)} placeholder="메모..." />
                                <button onClick={() => openMemoModal(s.id, s.memo)} className="shrink-0 pr-1 text-gray-600 hover:text-blue-400 transition-colors" title="메모 전체 보기"><Maximize2 size={10} /></button>
                              </div>
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button onClick={() => deletePortfolio(s.id)} className="text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                            </td>
                          </tr>
                          {isCatOpen && Object.keys(s.cats).length > 0 && (
                            <tr className="bg-gray-800/30 border-b border-gray-700">
                              <td colSpan={13} className="py-3 px-4">
                                <div className="text-[11px] text-gray-400 font-bold mb-2">📊 {s.name} - 구분별 평가금액</div>
                                <div className="flex flex-wrap gap-x-6 gap-y-2">
                                  {Object.entries(s.cats).filter(([,v]) => v > 0).map(([cat, val]) => (
                                    <div key={cat} className="flex items-center gap-2">
                                      <span className={`text-[11px] font-bold ${UI_CONFIG.COLORS.CATEGORIES[cat] || 'text-gray-300'}`}>{cat}</span>
                                      <span className="text-[11px] text-gray-200 font-bold">{hideAmounts ? '••••••' : formatCurrency(val)}</span>
                                      <span className="text-[10px] text-gray-500">{s.currentEval > 0 ? ((val / s.currentEval) * 100).toFixed(1) : 0}%</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {portfolioSummaries.length === 0 && (
                      <tr><td colSpan={13} className="py-8 text-center text-gray-500 text-xs">계좌가 없습니다. <span className="text-blue-400 font-bold">+ 계좌 추가</span> 버튼을 눌러 추가하세요.</td></tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-red-700 bg-red-900/20">
                    <tr>
                      <td className="border-r border-gray-700"></td>
                      <td className="py-2 px-2 border-r border-gray-700"></td>
                      <td className="py-2 px-3 border-r border-gray-700"></td>
                      <td className="py-2 px-3 text-center text-red-400 font-extrabold border-r border-gray-700 sticky left-0 z-[5] bg-[#2d1a1e]">소 계</td>
                      <td className="py-2 px-3 text-center text-gray-200 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalPrincipal)}</td>
                      <td className="py-2 px-3 text-center text-gray-300 border-r border-gray-700">100%</td>
                      <td className="py-2 px-3 text-center text-yellow-400 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalEval)}</td>
                      <td className={`py-2 px-3 text-center font-bold border-r border-gray-700 ${intTotals.returnRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatPercent(intTotals.returnRate)}</td>
                      <td className="py-2 px-3 border-r border-gray-700"></td>
                      <td className="py-2 px-3 text-center text-gray-400 font-bold border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(intTotals.totalDeposit)}</td>
                      <td className={`py-2 px-3 text-center font-bold border-r border-gray-700 ${intTotals.totalEval - intTotals.totalPrincipal >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{hideAmounts ? '••••••' : formatCurrency(intTotals.totalEval - intTotals.totalPrincipal)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            {!sec.history && (
            <div className="flex flex-col xl:flex-row gap-4 w-full items-stretch">

              {/* 평가액 추이 테이블 */}
              <div className="w-full xl:w-[380px] shrink-0 bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden flex flex-col max-h-[344px] sm:max-h-[384px] md:max-h-[424px] xl:max-h-[464px]">
                <div className="p-3 bg-[#0f172a] flex items-center justify-between border-b border-gray-700 shrink-0">
                  <span className="text-white font-bold text-sm">📅 평가액 추이</span>
                  {onManualBackfill && (
                    <CustomDatePicker
                      value=""
                      onChange={(date) => { onManualBackfill(date); }}
                      align="right"
                      trigger={
                        <button
                          className="p-1.5 rounded hover:bg-orange-900/30 transition-colors text-orange-400 hover:text-orange-300"
                          title="선택한 날짜부터 누락된 평가액 기록을 모든 계좌에 채웁니다"
                        >
                          <CalendarPlus size={15} />
                        </button>
                      }
                    />
                  )}
                </div>
                <div className="overflow-x-auto overflow-y-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 z-10">
                      <tr>
                        <th className="py-2.5 px-3 text-center border-r border-gray-700">일자</th>
                        <th className="py-2.5 px-3 text-right border-r border-gray-700">총 평가금액</th>
                        <th className="py-2.5 px-3 text-center border-r border-gray-700 whitespace-nowrap">전일대비(%)</th>
                        <th className="py-2.5 px-3 text-center whitespace-nowrap">원금대비수익률(%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intMonthlyHistory.map((h, i) => (
                        <tr key={h.id || i} className={`border-b border-gray-700 ${h.date === new Date().toISOString().split('T')[0] ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                          <td className="py-2 px-3 text-center font-bold text-gray-400 border-r border-gray-700">{formatShortDate(h.date)}</td>
                          <td className="py-2 px-3 font-bold text-white text-right border-r border-gray-700">{hideAmounts ? '••••••' : formatCurrency(h.evalAmount)}</td>
                          <td className="py-2 px-3 text-center border-r border-gray-700">
                            <span className={`text-sm font-bold ${h.dodChange > 0 ? 'text-red-400' : h.dodChange < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{formatPercent(h.dodChange)}</span>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className={`text-sm font-bold ${h.monthlyChange > 0 ? 'text-red-400' : h.monthlyChange < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{formatPercent(h.monthlyChange)}</span>
                          </td>
                        </tr>
                      ))}
                      {intMonthlyHistory.length === 0 && (
                        <tr><td colSpan={4} className="py-6 text-center text-gray-500">데이터 없음<br/><span className="text-[10px] text-gray-600">계좌 평가금액을 입력하면 자동으로 기록됩니다.</span></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 기간별 수익 차트 */}
              <div className="w-full xl:flex-1 bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden flex flex-col xl:h-[464px]">
                {/* 헤더: 제목 + 날짜범위 + 드롭다운 */}
                <div className="p-3 bg-[#0f172a] border-b border-gray-700 flex flex-wrap gap-2 items-center shrink-0">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <TrendingUp size={14} className="text-red-400" />
                    <span className="text-white font-bold text-sm">총자산현황 수익율</span>
                  </div>
                  <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
                    <ChartRangeControls
                      dateRange={intDateRange}
                      setDateRange={setIntDateRange}
                      period={intChartPeriod}
                      setPeriod={setIntChartPeriod}
                      onSearch={handleIntSearchClick}
                    />
                    <button onClick={() => setIntIsZeroBaseMode(m => !m)} className={`p-1.5 rounded border flex items-center justify-center transition-colors ${intIsZeroBaseMode ? 'text-indigo-300 bg-indigo-900/40 border-indigo-700/60' : 'text-gray-500 border-gray-700 hover:text-gray-300 hover:bg-gray-800'}`} title="기간 시작 기준 / 원금 기준 전환"><Activity size={14} /></button>
                  </div>
                </div>
                {/* 드래그 기간 선택 결과 패널 */}
                <div className="px-4 py-2 border-b border-gray-700/40 bg-[#060f1e]/70 min-h-[34px] shrink-0 flex items-center">
                  {intSelectionResult ? (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 w-full">
                      <span className="text-gray-500 text-[10px] font-bold shrink-0">선택 기간</span>
                      <span className="text-gray-300 text-[11px] font-bold">{formatShortDate(intSelectionResult.startDate)} ~ {formatShortDate(intSelectionResult.endDate)}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-sm bg-red-500 shrink-0" />
                        <span className="text-[11px] font-bold text-gray-300">수익</span>
                        <span className={`text-[12px] font-black ${intSelectionResult.profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                          {intSelectionResult.rate > 0 ? '+' : ''}{intSelectionResult.rate.toFixed(2)}%
                        </span>
                        <span className={`text-[10px] font-bold ${intSelectionResult.profit >= 0 ? 'text-red-300/80' : 'text-blue-300/80'}`}>
                          ({intSelectionResult.profit >= 0 ? '+' : ''}{hideAmounts ? '••••••' : formatCurrency(intSelectionResult.profit)})
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-600 text-[10px]">차트를 드래그하면 기간별 수익이 표시됩니다</span>
                  )}
                </div>
                {/* 호버 정보 패널 */}
                <div className="px-4 py-2 border-b border-gray-700/40 bg-[#0a1628]/60 min-h-[34px] flex items-center gap-3 overflow-x-auto shrink-0">
                  {intHoveredPoint ? (
                    <>
                      <span className="text-gray-400 text-[11px] font-bold shrink-0 mr-1">{formatShortDate(intHoveredPoint.label)}</span>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                        {intHoveredPoint.payload
                          .filter(entry => entry.dataKey && entry.value != null)
                          .map((entry, i) => {
                            const isRate = entry.dataKey === 'returnRate';
                            const displayVal = isRate
                              ? `${Number(entry.value) >= 0 ? '+' : ''}${Number(entry.value).toFixed(2)}%`
                              : (hideAmounts ? '••••••' : formatCurrency(entry.value));
                            return (
                              <div key={i} className="flex items-center gap-1.5 shrink-0">
                                <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: entry.color || '#e5e7eb' }} />
                                <span className="text-[11px] font-bold" style={{ color: entry.color || '#e5e7eb' }}>{entry.name}</span>
                                <span className={`text-[11px] ${isRate ? (Number(entry.value) >= 0 ? 'text-red-400' : 'text-blue-400') : 'text-gray-300'}`}>{displayVal}</span>
                              </div>
                            );
                          })}
                      </div>
                    </>
                  ) : (
                    <span className="text-gray-600 text-[10px]">차트에 마우스를 올리면 상세 값이 표시됩니다</span>
                  )}
                </div>
                {/* 차트 영역 */}
                <div className="chart-container-for-drag px-2 pt-2 pb-1 relative select-none h-[260px] sm:h-[300px] md:h-[340px] xl:flex-1">
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <ComposedChart data={intChartData} onMouseDown={handleIntChartMouseDown} onMouseMove={handleIntChartMouseMove} onMouseUp={handleIntChartMouseUp} onMouseLeave={handleIntChartMouseLeave}>
                      <defs>
                        <linearGradient id="intReturnGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="intCostGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6b7280" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#6b7280" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="intEvalGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                      <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={formatVeryShortDate} minTickGap={30} />
                      <YAxis yAxisId="left" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${v.toFixed(1)}%`} width={48} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => (v >= 1e8 ? (v/1e8).toFixed(1)+'억' : (v/1e4).toFixed(0)+'만')} width={55} />
                      <RechartsTooltip content={() => null} />
                      <Area yAxisId="right" type="monotone" dataKey="costAmount" name="투자원금" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 3" fill="url(#intCostGrad)" dot={false} activeDot={false} />
                      <Area yAxisId="left" type="monotone" dataKey="returnRate" name="수익률" stroke="#ef4444" strokeWidth={2} fill="url(#intReturnGrad)" dot={false} activeDot={false} />
                      <Area yAxisId="right" type="monotone" dataKey="evalAmount" name="총평가금액" stroke="#60a5fa" strokeWidth={2} fill="url(#intEvalGrad)" dot={false} activeDot={false} />
                      {intHoveredPoint && !intRefAreaLeft && (
                        <ReferenceLine yAxisId="left" x={intHoveredPoint.label} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                      )}
                      {intRefAreaLeft && intRefAreaRight && <ReferenceArea yAxisId="left" x1={intRefAreaLeft} x2={intRefAreaRight} fill="rgba(255,255,255,0.08)" strokeOpacity={0.3} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            )}
            {!sec.donut && (
            <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden mb-8">
              <div className="p-3 bg-[#0f172a] border-b border-gray-700">
                <span className="text-white font-bold text-sm">🍩 자산 카테고리 비중 (통합)</span>
              </div>
              <div className="divide-y divide-gray-700">
                {/* 위: 카테고리 도넛 + 카테고리 표 */}
                <div className="p-4">
                  <div className="text-gray-400 text-xs text-center mb-2 font-semibold">자산 카테고리</div>
                  {intCatDonutData.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 text-xs">카테고리 데이터가 없습니다.</div>
                  ) : (
                    <>
                      <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                        {hoveredIntCatSlice ? (
                          <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredIntCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredIntCatSlice.fill }}>{hoveredIntCatSlice.name} {(hoveredIntCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredIntCatSlice.value)}</span>}</>
                        ) : (
                          <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                        )}
                      </div>
                      <div style={{ height: 480 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={intCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredIntCatSlice(data)} onMouseLeave={() => setHoveredIntCatSlice(null)}>
                              {intCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
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
                          {intCatDonutData.map(({ name, value }, i) => (
                            <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                              <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                                <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                              </td>
                              <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : formatCurrency(value)}</td>
                              <td className="py-1.5 px-3 text-gray-400 text-right">{intTotals.totalEval > 0 ? ((value / intTotals.totalEval) * 100).toFixed(1) : 0}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
                {/* 아래: 종목 도넛 + 종목 표 */}
                <div className="p-4">
                  <div className="text-gray-400 text-xs text-center mb-2 font-semibold">종목별 비중</div>
                  {intHoldingsDonutData.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 text-xs">종목 데이터가 없습니다.</div>
                  ) : (() => {
                    const holdingsTotal = intHoldingsDonutData.reduce((s, x) => s + x.value, 0);
                    const catOrder = intCatDonutData.map(x => x.name);
                    const catValueMap = {};
                    intCatDonutData.forEach(x => { catValueMap[x.name] = x.value; });
                    const grouped = {};
                    intHoldingsDonutData.forEach(item => {
                      if (!grouped[item.category]) grouped[item.category] = [];
                      grouped[item.category].push(item);
                    });
                    const LAST_CATS = ['현금', '예수금'];
                    const groupEntries = Object.entries(grouped).sort(([catA, itemsA], [catB, itemsB]) => {
                      const aLast = LAST_CATS.includes(catA);
                      const bLast = LAST_CATS.includes(catB);
                      if (aLast !== bLast) return aLast ? 1 : -1;
                      if (aLast && bLast) return LAST_CATS.indexOf(catA) - LAST_CATS.indexOf(catB);
                      const idxA = catOrder.indexOf(catA);
                      const idxB = catOrder.indexOf(catB);
                      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                      if (idxA !== -1) return -1;
                      if (idxB !== -1) return 1;
                      return itemsB.reduce((s, x) => s + x.value, 0) - itemsA.reduce((s, x) => s + x.value, 0);
                    });
                    const parseHex = (hex) => {
                      if (!hex || !hex.startsWith('#') || hex.length < 7) return null;
                      const r = parseInt(hex.slice(1, 3), 16) / 255;
                      const g = parseInt(hex.slice(3, 5), 16) / 255;
                      const b = parseInt(hex.slice(5, 7), 16) / 255;
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
                    const catBaseColorMap = {};
                    groupEntries.forEach(([cat, items], gi) => {
                      const catIdx = catOrder.indexOf(cat);
                      const baseHex = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || UI_CONFIG.COLORS.CHART_PALETTE[catIdx !== -1 ? catIdx % 8 : gi % 8];
                      catBaseColorMap[cat] = baseHex;
                      const shades = genShades(baseHex, items.length);
                      items.forEach((item, j) => { itemColorMap[`${cat}::${item.name}`] = shades[j]; });
                    });
                    const totalDenom = intTotals.totalEval > 0 ? intTotals.totalEval : holdingsTotal;
                    const groupedDonutData = groupEntries.flatMap(([, items]) => items);
                    let rowNum = 0;
                    return (
                      <>
                        <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                          {hoveredIntHoldSlice ? (
                            <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredIntHoldSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredIntHoldSlice.fill }}>{hoveredIntHoldSlice.name} {(hoveredIntHoldSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{formatCurrency(hoveredIntHoldSlice.value)}</span>}</>
                          ) : (
                            <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                          )}
                        </div>
                        <div style={{ height: 480 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={groupedDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredIntHoldSlice(data)} onMouseLeave={() => setHoveredIntHoldSlice(null)}>
                                {groupedDonutData.map((entry, i) => (
                                  <Cell key={i} fill={itemColorMap[`${entry.category}::${entry.name}`] || catBaseColorMap[entry.category] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />
                                ))}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="overflow-x-auto mt-3">
                        <table className="w-full text-xs min-w-[480px]">
                          <thead className="text-gray-400 border-b border-gray-700">
                            <tr className="text-center">
                              <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                              <th className="pb-2 px-2 border-r border-gray-700 sticky left-0 z-20 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]">종목</th>
                              <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">평가금액</th>
                              <th className="pb-2 px-3 border-r border-gray-700">비중</th>
                              <th className="pb-2 px-3 border-r border-gray-700">수익</th>
                              <th className="pb-2 px-3">수익률</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupEntries.flatMap(([cat, items]) => {
                              const catColor = catBaseColorMap[cat];
                              const catDisplayValue = catValueMap[cat] ?? items.reduce((s, x) => s + x.value, 0);
                              const isLastCat = LAST_CATS.includes(cat);
                              return items.map((item, j) => {
                                rowNum += 1;
                                const num = rowNum;
                                const itemColor = itemColorMap[`${cat}::${item.name}`] || catColor;
                                const profit = item.value - item.cost;
                                const profitRate = item.cost > 0 ? (profit / item.cost) * 100 : null;
                                const profitColor = profit > 0 ? 'text-red-400' : profit < 0 ? 'text-blue-400' : 'text-gray-400';
                                return (
                                  <tr key={`${cat}-${item.name}`} className={`group hover:bg-gray-800/30 ${j === items.length - 1 ? 'border-b border-gray-700' : 'border-b border-gray-700/30'}`}>
                                    {j === 0 && (
                                      <td rowSpan={items.length} className="py-1.5 px-2 text-center font-bold border-r border-gray-700 border-b border-gray-700 align-middle">
                                        <div style={{ color: catColor }}>{cat}</div>
                                        <div className="text-gray-500 font-normal mt-0.5">{hideAmounts ? '••••••' : formatCurrency(catDisplayValue)}</div>
                                        <div className="text-gray-500 font-normal">{totalDenom > 0 ? ((catDisplayValue / totalDenom) * 100).toFixed(1) : 0}%</div>
                                      </td>
                                    )}
                                    <td className="py-1.5 px-2 text-center border-r border-gray-700 sticky left-0 z-10 bg-[#1e293b] group-hover:bg-[#1d2d40] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]">
                                      <span style={{ color: itemColor }}>{num}. {item.name}</span>
                                    </td>
                                    <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : formatCurrency(item.value)}</td>
                                    <td className="py-1.5 px-3 border-r border-gray-700 text-gray-400 text-right">{totalDenom > 0 ? ((item.value / totalDenom) * 100).toFixed(1) : 0}%</td>
                                    {isLastCat ? (
                                      <>
                                        <td className="py-1.5 px-3 border-r border-gray-700 text-gray-600 text-right">-</td>
                                        <td className="py-1.5 px-3 text-gray-600 text-right">-</td>
                                      </>
                                    ) : (
                                      <>
                                        <td className={`py-1.5 px-3 border-r border-gray-700 font-bold text-right ${profitColor}`}>
                                          {hideAmounts ? '••••••' : (<><span className="text-[9px] mr-0.5">{profit >= 0 ? '▲' : '▼'}</span>{formatCurrency(Math.abs(profit))}</>)}
                                        </td>
                                        <td className={`py-1.5 px-3 font-bold text-right ${profitColor}`}>
                                          {profitRate !== null ? (<><span className="text-[9px] mr-0.5">{profitRate >= 0 ? '▲' : '▼'}</span>{Math.abs(profitRate).toFixed(2)}%</>) : '-'}
                                        </td>
                                      </>
                                    )}
                                  </tr>
                                );
                              });
                            })}
                          </tbody>
                        </table>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
            )}
            {!sec.dividend && (
              <DividendSummaryTable compact portfolios={allPortfoliosForDividend} updatePortfolioDividendHistory={updatePortfolioDividendHistory} updatePortfolioActualDividend={updatePortfolioActualDividend} updatePortfolioDividendTaxRate={updatePortfolioDividendTaxRate} updatePortfolioDividendSeparateTax={updatePortfolioDividendSeparateTax} updatePortfolioDividendTaxAmount={updatePortfolioDividendTaxAmount} updatePortfolioActualDividendUsd={updatePortfolioActualDividendUsd} updatePortfolioActualAfterTaxUsd={updatePortfolioActualAfterTaxUsd} updatePortfolioActualAfterTaxKrw={updatePortfolioActualAfterTaxKrw} usdkrw={usdkrw} dividendTaxHistory={dividendTaxHistory} />
            )}
              </div>
              <div className="sticky top-14 self-start flex flex-col gap-px flex-shrink-0 z-10 pt-3">
                <button onClick={() => toggleSec('history')} style={{ writingMode: 'vertical-lr' }}
                  className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sec.history ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>
                  추이·차트
                </button>
                <button onClick={() => toggleSec('donut')} style={{ writingMode: 'vertical-lr' }}
                  className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sec.donut ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>
                  자산카테고리
                </button>
                <button onClick={() => toggleSec('dividend')} style={{ writingMode: 'vertical-lr' }}
                  className={`w-7 px-1.5 py-3 cursor-pointer select-none text-[10px] font-medium tracking-wide transition-all duration-150 rounded-r-md border-r border-t border-b ${!sec.dividend ? 'bg-gray-800/90 border-gray-600/60 text-gray-300' : 'bg-transparent border-transparent text-gray-700 hover:text-gray-400 hover:bg-gray-800/30 hover:border-gray-700/40'}`}>
                  분배금 현황
                </button>
              </div>
            </div>

          </div>
      {memoModal && (
        <div className="fixed inset-0 z-50 bg-black/40">
          <div className="absolute w-64 shadow-2xl overflow-hidden" style={{ left: memoPos.x, top: memoPos.y }} onClick={e => e.stopPropagation()}>
            <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none" onMouseDown={handleMemoDragStart}>
              <div className="flex items-center gap-2.5">
                <button onClick={() => setMemoModal(null)} className="w-3 h-3 rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center group transition-all" title="취소 (Esc)">
                  <X size={7} className="text-white" />
                </button>
                <button onClick={saveMemoModal} className="w-3 h-3 rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center group transition-all" title="저장 (Ctrl+Enter)">
                  <Check size={7} className="text-white" />
                </button>
              </div>
              <span className="text-[11px] font-bold tracking-[0.25em] bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 bg-clip-text text-transparent select-none">MEMO</span>
              <div className="w-10" />
            </div>
            <textarea
              className="w-full text-gray-200 text-[12px] outline-none resize-none caret-purple-400 placeholder-gray-700"
              style={{
                backgroundColor: '#000',
                backgroundImage: `repeating-linear-gradient(transparent 0px, transparent 23px, rgba(99,130,255,0.3) 23px, rgba(99,130,255,0.3) 24px)`,
                backgroundSize: '100% 24px',
                backgroundPosition: '0 8px',
                lineHeight: '24px',
                paddingLeft: '10px',
                paddingRight: '10px',
                paddingTop: '8px',
                paddingBottom: '8px',
              }}
              rows={10}
              autoFocus
              placeholder="메모를 입력하세요..."
              value={memoModal.val}
              onChange={e => setMemoModal(prev => ({ ...prev, val: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Escape') setMemoModal(null);
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveMemoModal();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
