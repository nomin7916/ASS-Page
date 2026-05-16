// @ts-nocheck
import React from 'react';
import { Plus, Minus, Download, Trash2, ArrowDownToLine, Triangle } from 'lucide-react';
import { generateId, formatCurrency, formatPercent, formatShortDate, calcPortfolioEvalForDate } from '../utils';

export default function HistoryPanel({
  history,
  setHistory,
  totals,
  principal,
  activePortfolioAccountType,
  marketIndicators,
  displayHistSliced,
  sortedHistoryDesc,
  historyLimit,
  setHistoryLimit,
  lookupRows,
  setLookupRows,
  comparisonMode,
  setComparisonMode,
  handleDownloadCSV,
  handleLookupDownloadCSV,
  stockHistoryMap,
  indicatorHistoryMap,
  portfolio,
  notify,
  effectiveDateKey,
}) {
  return (
          <div className="w-full xl:w-[24%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[520px] flex flex-col overflow-hidden shrink-0">
            <div className="p-4 bg-[#0f172a] text-white font-bold flex justify-between items-center text-sm border-b border-gray-700 shrink-0">
              <span>📈 자산 평가액 추이</span>
              <div className="flex items-center gap-1">
                <button onClick={() => { const today = new Date().toISOString().split('T')[0]; setHistory(prev => { const todayEntry = prev.find(h => h.date === today); return todayEntry ? [todayEntry] : (totals.totalEval > 0 ? [{ date: today, evalAmount: totals.totalEval, principal, isFixed: false }] : []); }); notify("평가 기록 리셋 완료 (오늘 데이터만 유지)", "success"); }} className="p-1 hover:bg-gray-800 rounded transition text-orange-400 hover:text-white" title="평가 기록 리셋 (오늘만 유지)"><Trash2 size={14} /></button>
                <button onClick={handleDownloadCSV} className="p-1 hover:bg-gray-800 rounded transition text-blue-400 hover:text-white" title="전체 엑셀 다운로드"><Download size={14} /></button>
              </div>
            </div>
            <div className="shrink-0 h-[215px] overflow-y-auto">
              <table className="w-full text-right text-[11px] table-fixed border-collapse">
                <colgroup>
                  <col className="w-[35%]" />
                  <col className="w-[38%]" />
                  <col className="w-[20%]" />
                  <col className="w-[7%]" />
                </colgroup>
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-1.5 px-1.5 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-1.5 px-1.5 text-center border-r border-gray-600 font-normal">평가자산</th>
                    <th className="py-1.5 px-1 text-center border-r border-gray-600 font-normal cursor-help" title="수식: (당일/전일)-1">전일대비</th>
                    <th className="py-1.5 px-1 text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setHistoryLimit(p => p + 5)} className="text-gray-400 hover:text-white"><Plus size={12} /></button>
                        <button onClick={() => setHistoryLimit(p => Math.max(p - 5, 3))} className="text-gray-400 hover:text-white"><Minus size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayHistSliced.map((h, i) => {
                    const prevEntry = sortedHistoryDesc[sortedHistoryDesc.indexOf(h) + 1];
                    const dod = (prevEntry && prevEntry.evalAmount > 0) ? ((h.evalAmount / prevEntry.evalAmount) - 1) * 100 : 0;
                    const isToday = h.date === new Date().toISOString().split('T')[0];
                    const dayOfWeek = new Date(h.date + 'T12:00:00').getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                    // 종가 검증
                    let verifyIcon = null;
                    if (isWeekend && prevEntry) {
                      // 주말: 직전 거래일 종가 계산 (stockHistoryMap/goldKr 우선, 없으면 직전 기록값)
                      let targetVal = prevEntry.evalAmount;
                      if (stockHistoryMap && portfolio?.length > 0) {
                        const closingExpected = calcPortfolioEvalForDate(
                          portfolio, activePortfolioAccountType, prevEntry.date,
                          stockHistoryMap, indicatorHistoryMap || {}, marketIndicators?.usdkrw || 1
                        );
                        if (closingExpected > 0) targetVal = closingExpected;
                      }
                      const diff = targetVal > 0 ? Math.abs(h.evalAmount - targetVal) / targetVal : 0;
                      if (diff < 0.001) {
                        verifyIcon = <span className="text-green-500 text-[9px]" title={`직전 거래일(${formatShortDate(prevEntry.date)}) 종가 일치`}>✓</span>;
                      } else {
                        const syncVal = Math.round(targetVal);
                        verifyIcon = (
                          <button
                            className="text-amber-400 text-[9px] hover:text-amber-200 cursor-pointer transition-colors"
                            title={`주말·휴장 불일치\n기록: ${Math.round(h.evalAmount).toLocaleString()}\n직전 거래일(${formatShortDate(prevEntry.date)}) 종가: ${syncVal.toLocaleString()}\n클릭 시 직전 거래일 종가로 업데이트`}
                            onClick={() => {
                              const isEffectiveToday = h.date === effectiveDateKey;
                              setHistory(hist => hist.map(item =>
                                (item.id ? item.id === h.id : item.date === h.date)
                                  ? { ...item, evalAmount: syncVal, adjustedAmount: syncVal, ...(isEffectiveToday ? { userChosen: true } : { isFixed: true }) }
                                  : item
                              ));
                              notify(`${formatShortDate(h.date)} 직전 거래일 종가로 업데이트 완료`, 'success');
                            }}
                          >△</button>
                        );
                      }
                    } else if (stockHistoryMap && portfolio?.length > 0) {
                      // 평일: 주식+펀드+예수금 전체 종가 비교 (calcPortfolioEvalForDate 사용)
                      const expected = calcPortfolioEvalForDate(
                        portfolio,
                        activePortfolioAccountType,
                        h.date,
                        stockHistoryMap,
                        indicatorHistoryMap || {},
                        marketIndicators?.usdkrw || 1
                      );
                      if (expected > 0) {
                        const diff = Math.abs(h.evalAmount - expected) / expected;
                        if (diff < 0.001) {
                          verifyIcon = <span className="text-green-500 text-[9px]" title={`종가 일치: ${Math.round(expected).toLocaleString()}원`}>✓</span>;
                        } else {
                          const rounded = Math.round(expected);
                          verifyIcon = (
                            <button
                              className="text-amber-400 text-[9px] hover:text-amber-200 cursor-pointer transition-colors"
                              title={`종가 불일치\n기록: ${Math.round(h.evalAmount).toLocaleString()}\n종가계산: ${rounded.toLocaleString()}\n클릭 시 종가로 업데이트`}
                              onClick={() => {
                                const isEffectiveToday = h.date === effectiveDateKey;
                                setHistory(hist => hist.map(item =>
                                  (item.id ? item.id === h.id : item.date === h.date)
                                    ? { ...item, evalAmount: rounded, adjustedAmount: rounded, ...(isEffectiveToday ? { userChosen: true } : { isFixed: true }) }
                                    : item
                                ));
                                notify(`${formatShortDate(h.date)} 종가 기준 업데이트 완료`, 'success');
                              }}
                            >△</button>
                          );
                        }
                      } else {
                        // 해당 날짜 종가 데이터 없음
                        const hasAnyItems = portfolio.some(p => (p.type === 'stock' || p.type === 'fund') && p.code);
                        if (hasAnyItems) {
                          verifyIcon = <span className="text-gray-500 text-[9px] cursor-default" title="종가 데이터 미조회\n주가 데이터가 로드되면 자동으로 비교됩니다">–</span>;
                        }
                      }
                    }

                    return (
                      <tr key={h.id || i} className={`border-b border-gray-700 ${isToday ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                        <td className={`py-1.5 px-1.5 text-center border-r border-gray-600 font-bold ${h.isFixed ? 'text-emerald-400/80' : 'text-gray-400'}`}>
                          {formatShortDate(h.date)}
                          {h.isFixed && <span className="ml-0.5 text-[8px] text-emerald-500/60" title="종가 확정 기록&#10;거래 종료 후 종가 기준으로 확정된 히스토리입니다">●</span>}
                        </td>
                        <td className="py-1.5 px-1.5 border-r border-gray-600 font-bold text-right text-white">
                          <div className="flex items-center justify-end gap-1">
                            {verifyIcon}
                            <span>
                              {activePortfolioAccountType === 'overseas'
                                ? <div className="flex flex-col items-end leading-tight"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(h.evalAmount/(marketIndicators.usdkrw||1))}</span><span className="text-[10px] text-gray-500">{formatCurrency(h.evalAmount)}</span></div>
                                : formatCurrency(h.evalAmount)}
                            </span>
                          </div>
                          {h.isAdjusted && <span className="block text-[9px] font-normal leading-none mt-0.5 text-blue-400">조정됨</span>}
                        </td>
                        <td className="py-1.5 px-1 border-r border-gray-600 text-center font-bold"><span className={dod > 0 ? 'text-red-400' : dod < 0 ? 'text-blue-400' : 'text-gray-500'}>{formatPercent(dod)}</span></td>
                        <td className="py-1.5 px-1 text-center"><button onClick={() => { setLookupRows([{ id: generateId(), date: h.date }, ...lookupRows]); notify("조회 목록 복사", "info"); }} className="text-blue-400"><ArrowDownToLine size={12} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-y border-gray-700 bg-[#0f172a] flex justify-start items-center shrink-0 shadow-sm z-20">
              <span className="text-xs text-white font-bold select-none tracking-widest">지정일 자산추이</span>
            </div>
            <div className="flex-1 overflow-x-auto overflow-y-auto bg-[#1e293b]">
              <table className="w-full min-w-max text-right text-[13px] table-auto border-collapse whitespace-nowrap">
                <thead className="bg-[#1e293b] text-gray-500 border-b border-gray-700/50 sticky top-0 z-10">
                  <tr>
                    <th className="py-1.5 px-3 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-1.5 px-3 border-r border-gray-700 text-center font-normal">평가자산</th>
                    <th className="py-1.5 px-3 border-r border-gray-700 text-center font-normal cursor-help" title={comparisonMode === 'latestOverPast' ? '(현재/과거)-1 (%)' : '1- (과거/현재) (%)'}>
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setComparisonMode('latestOverPast')} className={`p-0.5 rounded transition-colors ${comparisonMode === 'latestOverPast' ? 'text-blue-400 bg-blue-900/30' : 'text-gray-600 hover:text-gray-400'}`} title="(현재/과거)-1 (%)"><Triangle size={10} fill={comparisonMode === 'latestOverPast' ? "currentColor" : "none"} /></button>
                        <button onClick={() => setComparisonMode('pastOverLatest')} className={`p-0.5 rounded transition-colors ${comparisonMode === 'pastOverLatest' ? 'text-red-400 bg-red-900/30' : 'text-gray-600 hover:text-gray-400'}`} title="1- (과거/현재) (%)"><Triangle size={10} className="rotate-180" fill={comparisonMode === 'pastOverLatest' ? "currentColor" : "none"} /></button>
                      </div>
                    </th>
                    <th className="py-1.5 px-2 text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setLookupRows(prev => [{ id: generateId(), date: "" }, ...prev])} className="text-blue-400 hover:text-white transition-colors" title="빈 조회 행 맨 위 추가"><Plus size={12} /></button>
                        <button onClick={handleLookupDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="이 표 엑셀 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const currentTotalEval = totals.totalEval;
                    return lookupRows.length === 0 ? (
                      <tr><td colSpan="4" className="py-6 text-center text-gray-500 font-bold bg-gray-800/20">지정일 데이터가 없습니다.<br /><span className="text-[10px] font-normal mt-1 inline-block text-gray-600">위 표의 추가 아이콘을 눌러주세요.</span></td></tr>
                    ) : (
                      lookupRows.slice().sort((a, b) => {
                        const tA = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER;
                        const tB = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER;
                        return tB - tA;
                      }).map((row) => {
                        const exactRecord = history.find(h => h.date === row.date);
                        const prevRecord = !exactRecord && row.date
                          ? [...history].filter(h => h.date < row.date).sort((a, b) => b.date.localeCompare(a.date))[0]
                          : null;
                        const prevGap = prevRecord ? Math.round((new Date(row.date).getTime() - new Date(prevRecord.date).getTime()) / 86400000) : 99;
                        const lookupRecord = exactRecord || (prevGap <= 5 ? prevRecord : null);
                        const isCarryForward = !!lookupRecord && !exactRecord;
                        return (
                          <tr key={row.id} className="bg-gray-800/60 border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors">
                            <td className="py-1 px-2 text-center border-r border-gray-700 align-middle">
                              <input type="date" className="w-full max-w-[120px] bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-xs text-gray-300 outline-none focus:border-blue-500 transition-colors cursor-pointer mx-auto block" value={row.date || ''} onChange={e => setLookupRows(lookupRows.map(r => r.id === row.id ? { ...r, date: e.target.value } : r))} />
                            </td>
                            {lookupRecord ? (() => {
                              const validRecords = lookupRows.map(r => history.find(h => h.date === r.date)).filter(Boolean);
                              let oldestEval = 0;
                              if (validRecords.length > 0) oldestEval = validRecords.reduce((min, curr) => new Date(curr.date) < new Date(min.date) ? curr : min).evalAmount;
                              const pastEval = lookupRecord.evalAmount;
                              let compareRate = comparisonMode === 'latestOverPast'
                                ? (oldestEval > 0 ? ((pastEval / oldestEval) - 1) * 100 : 0)
                                : (currentTotalEval > 0 ? (1 - (pastEval / currentTotalEval)) * 100 : 0);
                              return (
                                <>
                                  <td className="py-1.5 px-3 border-r border-gray-600 font-bold text-white text-right">
                                    {formatCurrency(pastEval)}
                                    {isCarryForward && <span className="block text-[9px] text-gray-500 font-normal leading-none">{lookupRecord.date} 기준</span>}
                                  </td>
                                  <td className="py-1.5 px-3 border-r border-gray-600 text-center font-bold"><span className={compareRate >= 0 ? 'text-red-400' : 'text-blue-400'}>{formatPercent(compareRate)}</span></td>
                                </>
                              );
                            })() : (<td colSpan="2" className="py-1.5 px-3 text-center text-gray-500 font-bold border-r border-gray-700">기록 없음</td>)}
                            <td className="py-1.5 px-2 text-center"><button onClick={() => setLookupRows(lookupRows.filter(r => r.id !== row.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                          </tr>
                        );
                      })
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
  );
}
