// @ts-nocheck
import React from 'react';
import { Plus, Minus, Download, Trash2, ArrowDownToLine, Triangle } from 'lucide-react';
import { generateId, formatCurrency, formatPercent, formatShortDate } from '../utils';

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
  notify,
}) {
  const [editingDate, setEditingDate] = React.useState(null);
  const [editingValue, setEditingValue] = React.useState('');

  const startEdit = (date, currentVal) => {
    setEditingDate(date);
    setEditingValue(String(currentVal));
  };

  const commitEdit = (date) => {
    const parsed = parseInt(editingValue.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) {
      setHistory(prev => prev.map(h => h.date === date ? { ...h, evalAmount: parsed } : h));
      notify(`${date} 평가액 수정 완료`, 'success');
    }
    setEditingDate(null);
  };

  return (
          <div className="w-full xl:w-[26%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[520px] flex flex-col overflow-hidden shrink-0">
            <div className="p-4 bg-[#0f172a] text-white font-bold flex justify-between items-center text-sm border-b border-gray-700 shrink-0">
              <span>📈 자산 평가액 추이</span>
              <div className="flex items-center gap-1">
                <button onClick={() => { const today = new Date().toISOString().split('T')[0]; setHistory(prev => { const todayEntry = prev.find(h => h.date === today); return todayEntry ? [todayEntry] : (totals.totalEval > 0 ? [{ date: today, evalAmount: totals.totalEval, principal, isFixed: false }] : []); }); notify("평가 기록 리셋 완료 (오늘 데이터만 유지)", "success"); }} className="p-1 hover:bg-gray-800 rounded transition text-orange-400 hover:text-white" title="평가 기록 리셋 (오늘만 유지)"><Trash2 size={14} /></button>
                <button onClick={handleDownloadCSV} className="p-1 hover:bg-gray-800 rounded transition text-blue-400 hover:text-white" title="전체 엑셀 다운로드"><Download size={14} /></button>
              </div>
            </div>
            <div className="shrink-0 h-[215px] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-max text-right text-[13px] table-auto border-collapse whitespace-nowrap">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal">평가자산</th>
                    <th className="py-2 px-3 text-center border-r border-gray-600 font-normal cursor-help" title="수식: (당일/전일)-1">전일대비</th>
                    <th className="py-2 px-2 text-center font-normal">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setHistoryLimit(p => p + 5)} className="text-gray-400 hover:text-white"><Plus size={12} /></button>
                        <button onClick={() => setHistoryLimit(p => Math.max(p - 5, 3))} className="text-gray-400 hover:text-white"><Minus size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayHistSliced.map((h, i) => {
                    const prev = sortedHistoryDesc[sortedHistoryDesc.indexOf(h) + 1];
                    const dod = (prev && prev.evalAmount > 0) ? ((h.evalAmount / prev.evalAmount) - 1) * 100 : 0;
                    const isToday = h.date === new Date().toISOString().split('T')[0];
                    const showingActual = h.isAdjusted && h.evalAmount === h.actualEvalAmount;
                    const handleToggle = h.isAdjusted ? () => {
                      setHistory(prevHist => prevHist.map(entry => {
                        if (entry.date !== h.date) return entry;
                        const newEval = entry.evalAmount === entry.actualEvalAmount ? (entry.adjustedAmount ?? entry.evalAmount) : entry.actualEvalAmount;
                        return { ...entry, evalAmount: newEval, userChosen: true };
                      }));
                    } : undefined;
                    const isEditing = editingDate === h.date;
                    return (
                      <tr key={h.id || i} className={`border-b border-gray-700 ${isToday ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                        <td className={`py-2 px-3 text-center border-r border-gray-600 font-bold ${h.isAdjusted ? 'text-blue-300' : 'text-gray-400'}`}>{formatShortDate(h.date)}</td>
                        <td
                          className={`py-2 px-3 border-r border-gray-600 font-bold text-right ${h.isAdjusted ? 'text-blue-300 cursor-pointer hover:text-blue-200' : 'text-white cursor-pointer'}`}
                          onClick={handleToggle}
                          onDoubleClick={() => startEdit(h.date, h.evalAmount)}
                          title={h.isAdjusted ? (showingActual ? '클릭: 전일 종가로 전환 / 더블클릭: 값 직접 수정' : '클릭: 실제 포트폴리오 합계로 전환 / 더블클릭: 값 직접 수정') : '더블클릭: 값 직접 수정'}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              autoFocus
                              value={editingValue}
                              onChange={e => setEditingValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitEdit(h.date); if (e.key === 'Escape') setEditingDate(null); }}
                              onBlur={() => commitEdit(h.date)}
                              className="w-full bg-gray-900 text-yellow-300 text-right px-1 py-0.5 rounded border border-yellow-500 outline-none text-[13px]"
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <>
                              {activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end leading-tight"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(h.evalAmount/(marketIndicators.usdkrw||1))}</span><span className="text-[10px] text-gray-500">{formatCurrency(h.evalAmount)}</span></div> : formatCurrency(h.evalAmount)}
                              {h.isAdjusted && <span className="block text-[9px] font-normal leading-none mt-0.5">{showingActual ? '실제값' : '조정됨'}</span>}
                            </>
                          )}
                        </td>
                        <td className="py-2 px-3 border-r border-gray-600 text-center font-bold"><span className={dod > 0 ? 'text-red-400' : dod < 0 ? 'text-blue-400' : 'text-gray-500'}>{formatPercent(dod)}</span></td>
                        <td className="py-2 px-2 text-center"><button onClick={() => { setLookupRows([{ id: generateId(), date: h.date }, ...lookupRows]); notify("조회 목록 복사", "info"); }} className="text-blue-400"><ArrowDownToLine size={12} /></button></td>
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
