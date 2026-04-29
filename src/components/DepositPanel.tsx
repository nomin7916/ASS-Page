// @ts-nocheck
import React, { useState } from 'react';
import { Plus, Download, Trash2, Calendar } from 'lucide-react';
import { generateId, formatCurrency, formatNumber, formatVeryShortDate, cleanNum, handleTableKeyDown, handleReadonlyCellNav } from '../utils';
import { sortArrow } from '../chartUtils';

export default function DepositPanel({
  depositHistory,
  setDepositHistory,
  depositHistory2,
  setDepositHistory2,
  depositWithSumSorted,
  depositWithSum2Sorted,
  depositSortConfig,
  depositSortConfig2,
  handleDepositSort,
  handleDepositSort2,
  handleDepositDownloadCSV,
  handleWithdrawDownloadCSV,
  activePortfolioAccountType,
  marketIndicators,
}) {
  const isOverseas = activePortfolioAccountType === 'overseas';
  const [editField, setEditField] = useState(null);
  const [editVal, setEditVal] = useState('');

  const amountDisplay = (h, prefix) =>
    editField === `${prefix}-${h.id}` ? editVal
      : isOverseas ? (h.amount !== 0 ? String(h.amount) : '') : formatNumber(h.amount);

  const amountFocus = (h, prefix, e) => {
    setEditField(`${prefix}-${h.id}`);
    setEditVal(h.amount !== 0 ? String(h.amount) : '');
    e.target.select();
  };

  const amountBlur = (h, prefix, history, setHistory) => {
    const n = [...history];
    n[h.originalIndex].amount = cleanNum(editVal);
    setHistory(n);
    setEditField(null);
  };

  return (
    <>
          {/* 입금 내역 */}
          <div className="flex-1 w-full bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden">
            <div className="p-2 bg-[#0f172a] text-white font-bold flex items-center justify-between text-xs border-b border-gray-700 shrink-0">
              <span>💰 입금 내역</span>
              {isOverseas && marketIndicators.usdkrw > 0 && <span className="text-sky-400 font-bold text-[11px]">$1 = ₩{Math.round(marketIndicators.usdkrw).toLocaleString()}</span>}
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-right text-[11px] table-fixed">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className={`py-2.5 ${isOverseas ? 'w-[58px]' : 'w-[70px]'} text-center border-r border-gray-600 font-normal cursor-pointer hover:bg-gray-700`} onClick={() => handleDepositSort('date')}>일자{sortArrow(depositSortConfig, 'date')}</th>
                    <th className={`py-2.5 border-r border-gray-600 px-1 ${isOverseas ? 'w-[65px]' : 'w-[80px]'} text-blue-300 font-normal text-center cursor-pointer hover:bg-gray-700`} onClick={() => handleDepositSort('amount')}>{isOverseas ? '금액($)' : '금액'}{sortArrow(depositSortConfig, 'amount')}</th>
                    {isOverseas && <th className="py-2.5 border-r border-gray-600 px-1 w-[54px] text-sky-400 font-normal text-center">환율</th>}
                    <th className={`py-2.5 border-r border-gray-600 px-1 ${isOverseas ? 'w-[80px]' : 'w-[90px]'} text-yellow-400 font-normal text-center`}>{isOverseas ? '합계($)' : '합계'}</th>
                    <th className="py-2.5 border-r border-gray-600 text-center px-2 font-normal whitespace-nowrap">메모</th>
                    <th className={`py-2.5 ${isOverseas ? 'w-[40px]' : 'w-[45px]'} text-center font-normal`}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDepositHistory([{ id: generateId(), date: new Date().toISOString().split('T')[0], amount: 0, fxRate: marketIndicators.usdkrw || 1, memo: "" }, ...depositHistory])} className="text-blue-400 hover:text-white transition-colors" title="행 추가"><Plus size={12} /></button>
                        <button onClick={handleDepositDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="입금 내역 CSV 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {depositWithSumSorted.map((h) => (
                    <tr key={h.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2 border-r border-gray-600 align-middle relative">
                        <div className="flex items-center justify-center font-mono text-[10px] text-gray-300 gap-1 pointer-events-none">{formatVeryShortDate(h.date)}<Calendar size={10} className="text-gray-500" /></div>
                        <input type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" value={h.date} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].date = e.target.value; setDepositHistory(n); }} />
                      </td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d1amount" className={`w-full bg-transparent text-right outline-none font-bold px-1 py-2 caret-blue-400 ${cleanNum(h.amount) >= 0 ? 'text-blue-300' : 'text-red-300'}`} value={amountDisplay(h, 'd1')} onFocus={e => amountFocus(h, 'd1', e)} onChange={e => setEditVal(e.target.value)} onBlur={() => amountBlur(h, 'd1', depositHistory, setDepositHistory)} onKeyDown={e => handleTableKeyDown(e, 'd1amount')} />
                      </td>
                      {isOverseas && (
                        <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-500">
                          <input type="text" data-col="d1fxRate" className="w-full bg-transparent text-right outline-none font-bold px-1 py-2 text-sky-400 caret-sky-400" value={h.fxRate || ''} placeholder={(marketIndicators.usdkrw || 1400).toFixed(0)} onFocus={e => e.target.select()} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].fxRate = cleanNum(e.target.value); setDepositHistory(n); }} onKeyDown={e => handleTableKeyDown(e, 'd1fxRate')} />
                        </td>
                      )}
                      <td className="py-2 px-1 border-r border-gray-600 font-bold text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end leading-tight"><span className="text-yellow-400">${cleanNum(h.cumulative).toFixed(2)}</span><span className="text-[10px] text-gray-500">{formatCurrency(cleanNum(h.cumulative) * (marketIndicators.usdkrw || 1))}</span></div> : <span className="text-yellow-400">{formatCurrency(h.cumulative)}</span>}</td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d1memo" className="w-full bg-transparent outline-none px-2 py-2 text-gray-300 text-[11px] caret-blue-400" value={h.memo ?? ''} onChange={e => { const n = [...depositHistory]; n[h.originalIndex] = { ...n[h.originalIndex], memo: e.target.value }; setDepositHistory(n); }} onKeyDown={e => handleTableKeyDown(e, 'd1memo')} />
                      </td>
                      <td className="py-2 text-center"><button onClick={() => setDepositHistory(depositHistory.filter(x => x.id !== h.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 출금 내역 */}
          <div className="flex-1 w-full bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[480px] flex flex-col overflow-hidden">
            <div className="p-2 bg-[#0f172a] text-white font-bold flex items-center justify-between text-xs border-b border-gray-700 shrink-0">
              <span>💰 출금 내역</span>
              {isOverseas && marketIndicators.usdkrw > 0 && <span className="text-sky-400 font-bold text-[11px]">$1 = ₩{Math.round(marketIndicators.usdkrw).toLocaleString()}</span>}
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-right text-[11px] table-fixed">
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className={`py-2.5 ${isOverseas ? 'w-[58px]' : 'w-[70px]'} text-center border-r border-gray-600 font-normal cursor-pointer hover:bg-gray-700`} onClick={() => handleDepositSort2('date')}>일자{sortArrow(depositSortConfig2, 'date')}</th>
                    <th className={`py-2.5 border-r border-gray-600 px-1 ${isOverseas ? 'w-[65px]' : 'w-[80px]'} text-blue-300 font-normal text-center cursor-pointer hover:bg-gray-700`} onClick={() => handleDepositSort2('amount')}>{isOverseas ? '금액($)' : '금액'}{sortArrow(depositSortConfig2, 'amount')}</th>
                    {isOverseas && <th className="py-2.5 border-r border-gray-600 px-1 w-[54px] text-sky-400 font-normal text-center">환율</th>}
                    <th className={`py-2.5 border-r border-gray-600 px-1 ${isOverseas ? 'w-[80px]' : 'w-[90px]'} text-yellow-400 font-normal text-center`}>{isOverseas ? '합계($)' : '합계'}</th>
                    <th className="py-2.5 border-r border-gray-600 text-center px-2 font-normal whitespace-nowrap">메모</th>
                    <th className={`py-2.5 ${isOverseas ? 'w-[40px]' : 'w-[45px]'} text-center font-normal`}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDepositHistory2([{ id: generateId(), date: new Date().toISOString().split('T')[0], amount: 0, fxRate: marketIndicators.usdkrw || 1, memo: "" }, ...depositHistory2])} className="text-blue-400 hover:text-white transition-colors" title="행 추가"><Plus size={12} /></button>
                        <button onClick={handleWithdrawDownloadCSV} className="text-gray-400 hover:text-white transition-colors" title="출금 내역 CSV 다운로드"><Download size={12} /></button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {depositWithSum2Sorted.map((h) => (
                    <tr key={h.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2 border-r border-gray-600 align-middle relative">
                        <div className="flex items-center justify-center font-mono text-[10px] text-gray-300 gap-1 pointer-events-none">{formatVeryShortDate(h.date)}<Calendar size={10} className="text-gray-500" /></div>
                        <input type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" value={h.date} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].date = e.target.value; setDepositHistory2(n); }} />
                      </td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d2amount" className={`w-full bg-transparent text-right outline-none font-bold px-1 py-2 caret-blue-400 ${cleanNum(h.amount) >= 0 ? 'text-blue-300' : 'text-red-300'}`} value={amountDisplay(h, 'd2')} onFocus={e => amountFocus(h, 'd2', e)} onChange={e => setEditVal(e.target.value)} onBlur={() => amountBlur(h, 'd2', depositHistory2, setDepositHistory2)} onKeyDown={e => handleTableKeyDown(e, 'd2amount')} />
                      </td>
                      {isOverseas && (
                        <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-500">
                          <input type="text" data-col="d2fxRate" className="w-full bg-transparent text-right outline-none font-bold px-1 py-2 text-sky-400 caret-sky-400" value={h.fxRate || ''} placeholder={(marketIndicators.usdkrw || 1400).toFixed(0)} onFocus={e => e.target.select()} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].fxRate = cleanNum(e.target.value); setDepositHistory2(n); }} onKeyDown={e => handleTableKeyDown(e, 'd2fxRate')} />
                        </td>
                      )}
                      <td className="py-2 px-1 border-r border-gray-600 font-bold text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end leading-tight"><span className="text-yellow-400">${cleanNum(h.cumulative).toFixed(2)}</span><span className="text-[10px] text-gray-500">{formatCurrency(cleanNum(h.cumulative) * (marketIndicators.usdkrw || 1))}</span></div> : <span className="text-yellow-400">{formatCurrency(h.cumulative)}</span>}</td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d2memo" className="w-full bg-transparent outline-none px-2 py-2 text-gray-300 text-[11px] caret-blue-400" value={h.memo ?? ''} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex] = { ...n[h.originalIndex], memo: e.target.value }; setDepositHistory2(n); }} onKeyDown={e => handleTableKeyDown(e, 'd2memo')} />
                      </td>
                      <td className="py-2 text-center"><button onClick={() => setDepositHistory2(depositHistory2.filter(x => x.id !== h.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
    </>
  );
}
