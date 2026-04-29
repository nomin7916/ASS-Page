// @ts-nocheck
import React, { useState, useRef } from 'react';
import { Plus, Download, Trash2, Calendar, Maximize2, X, Check } from 'lucide-react';
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
  const [memoModal, setMemoModal] = useState(null); // { id, originalIndex, type: 'd1'|'d2', val }
  const [memoPos, setMemoPos] = useState({ x: 0, y: 0 });
  const memoDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });

  const openMemoModal = (h, type) => {
    setMemoPos({ x: window.innerWidth / 2 - 128, y: window.innerHeight / 2 - 180 });
    setMemoModal({ id: h.id, originalIndex: h.originalIndex, type, val: h.memo ?? '' });
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
    if (memoModal.type === 'd1') {
      const n = [...depositHistory];
      n[memoModal.originalIndex] = { ...n[memoModal.originalIndex], memo: memoModal.val };
      setDepositHistory(n);
    } else {
      const n = [...depositHistory2];
      n[memoModal.originalIndex] = { ...n[memoModal.originalIndex], memo: memoModal.val };
      setDepositHistory2(n);
    }
    setMemoModal(null);
  };

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
                      <td className="py-2 border-r border-gray-600 align-middle relative cursor-pointer" onClick={e => e.currentTarget.querySelector('input[type="date"]')?.showPicker()}>
                        <div className="flex items-center justify-center font-mono text-[10px] text-gray-300 gap-1 pointer-events-none">{formatVeryShortDate(h.date)}<Calendar size={10} className="text-gray-500" /></div>
                        <input type="date" className="absolute inset-0 w-full h-full opacity-0 pointer-events-none" value={h.date} onChange={e => { const n = [...depositHistory]; n[h.originalIndex].date = e.target.value; setDepositHistory(n); }} />
                      </td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d1amount" className={`w-full bg-transparent text-right outline-none font-bold px-1 py-2 caret-blue-400 ${cleanNum(h.amount) >= 0 ? 'text-blue-300' : 'text-red-300'}`} value={amountDisplay(h, 'd1')} onFocus={e => amountFocus(h, 'd1', e)} onChange={e => setEditVal(e.target.value)} onBlur={() => amountBlur(h, 'd1', depositHistory, setDepositHistory)} onKeyDown={e => handleTableKeyDown(e, 'd1amount')} />
                      </td>
                      {isOverseas && (
                        <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-500">
                          <input type="text" data-col="d1fxRate" className="w-full bg-transparent text-right outline-none font-bold px-1 py-2 text-sky-400 caret-sky-400" value={editField === `d1fx-${h.id}` ? editVal : (h.fxRate || '')} placeholder={(marketIndicators.usdkrw || 1400).toFixed(0)} onFocus={e => { setEditField(`d1fx-${h.id}`); setEditVal(h.fxRate ? String(h.fxRate) : ''); e.target.select(); }} onChange={e => setEditVal(e.target.value)} onBlur={() => { const n = [...depositHistory]; n[h.originalIndex].fxRate = cleanNum(editVal); setDepositHistory(n); setEditField(null); }} onKeyDown={e => handleTableKeyDown(e, 'd1fxRate')} />
                        </td>
                      )}
                      <td className="py-2 px-1 border-r border-gray-600 font-bold text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end leading-tight"><span className="text-yellow-400">${cleanNum(h.cumulative).toFixed(2)}</span><span className="text-[10px] text-gray-500">{formatCurrency(cleanNum(h.cumulative) * (marketIndicators.usdkrw || 1))}</span></div> : <span className="text-yellow-400">{formatCurrency(h.cumulative)}</span>}</td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <div className="flex items-center">
                          <input type="text" data-col="d1memo" className="flex-1 min-w-0 bg-transparent outline-none px-2 py-2 text-gray-300 text-[11px] caret-blue-400 overflow-hidden" value={h.memo ?? ''} onChange={e => { const n = [...depositHistory]; n[h.originalIndex] = { ...n[h.originalIndex], memo: e.target.value }; setDepositHistory(n); }} onKeyDown={e => handleTableKeyDown(e, 'd1memo')} />
                          <button onClick={() => openMemoModal(h, 'd1')} className="shrink-0 pr-1 text-gray-600 hover:text-blue-400 transition-colors" title="메모 전체 보기"><Maximize2 size={10} /></button>
                        </div>
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
                      <td className="py-2 border-r border-gray-600 align-middle relative cursor-pointer" onClick={e => e.currentTarget.querySelector('input[type="date"]')?.showPicker()}>
                        <div className="flex items-center justify-center font-mono text-[10px] text-gray-300 gap-1 pointer-events-none">{formatVeryShortDate(h.date)}<Calendar size={10} className="text-gray-500" /></div>
                        <input type="date" className="absolute inset-0 w-full h-full opacity-0 pointer-events-none" value={h.date} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex].date = e.target.value; setDepositHistory2(n); }} />
                      </td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <input type="text" data-col="d2amount" className={`w-full bg-transparent text-right outline-none font-bold px-1 py-2 caret-blue-400 ${cleanNum(h.amount) >= 0 ? 'text-blue-300' : 'text-red-300'}`} value={amountDisplay(h, 'd2')} onFocus={e => amountFocus(h, 'd2', e)} onChange={e => setEditVal(e.target.value)} onBlur={() => amountBlur(h, 'd2', depositHistory2, setDepositHistory2)} onKeyDown={e => handleTableKeyDown(e, 'd2amount')} />
                      </td>
                      {isOverseas && (
                        <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-500">
                          <input type="text" data-col="d2fxRate" className="w-full bg-transparent text-right outline-none font-bold px-1 py-2 text-sky-400 caret-sky-400" value={editField === `d2fx-${h.id}` ? editVal : (h.fxRate || '')} placeholder={(marketIndicators.usdkrw || 1400).toFixed(0)} onFocus={e => { setEditField(`d2fx-${h.id}`); setEditVal(h.fxRate ? String(h.fxRate) : ''); e.target.select(); }} onChange={e => setEditVal(e.target.value)} onBlur={() => { const n = [...depositHistory2]; n[h.originalIndex].fxRate = cleanNum(editVal); setDepositHistory2(n); setEditField(null); }} onKeyDown={e => handleTableKeyDown(e, 'd2fxRate')} />
                        </td>
                      )}
                      <td className="py-2 px-1 border-r border-gray-600 font-bold text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end leading-tight"><span className="text-yellow-400">${cleanNum(h.cumulative).toFixed(2)}</span><span className="text-[10px] text-gray-500">{formatCurrency(cleanNum(h.cumulative) * (marketIndicators.usdkrw || 1))}</span></div> : <span className="text-yellow-400">{formatCurrency(h.cumulative)}</span>}</td>
                      <td className="p-0 border-r border-gray-600 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500">
                        <div className="flex items-center">
                          <input type="text" data-col="d2memo" className="flex-1 min-w-0 bg-transparent outline-none px-2 py-2 text-gray-300 text-[11px] caret-blue-400 overflow-hidden" value={h.memo ?? ''} onChange={e => { const n = [...depositHistory2]; n[h.originalIndex] = { ...n[h.originalIndex], memo: e.target.value }; setDepositHistory2(n); }} onKeyDown={e => handleTableKeyDown(e, 'd2memo')} />
                          <button onClick={() => openMemoModal(h, 'd2')} className="shrink-0 pr-1 text-gray-600 hover:text-blue-400 transition-colors" title="메모 전체 보기"><Maximize2 size={10} /></button>
                        </div>
                      </td>
                      <td className="py-2 text-center"><button onClick={() => setDepositHistory2(depositHistory2.filter(x => x.id !== h.id))} className="text-gray-500 hover:text-red-400 px-1"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
      {memoModal && (
        <div className="fixed inset-0 z-50 bg-black/40">
          <div className="absolute w-64 shadow-2xl overflow-hidden" style={{ left: memoPos.x, top: memoPos.y }} onClick={e => e.stopPropagation()}>
            {/* 헤더 — 드래그 핸들 */}
            <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none" onMouseDown={handleMemoDragStart}>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setMemoModal(null)}
                  className="w-3 h-3 rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center group transition-all"
                  title="취소 (Esc)"
                >
                  <X size={7} className="text-white" />
                </button>
                <button
                  onClick={saveMemoModal}
                  className="w-3 h-3 rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center group transition-all"
                  title="저장 (Ctrl+Enter)"
                >
                  <Check size={7} className="text-white" />
                </button>
              </div>
              <span className="text-[11px] font-bold tracking-[0.25em] bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 bg-clip-text text-transparent select-none">MEMO</span>
              <div className="w-10" />
            </div>
            {/* 줄선 메모 입력 영역 */}
            <textarea
              className="w-full text-gray-200 text-[12px] outline-none resize-none caret-purple-400 placeholder-gray-700"
              style={{
                backgroundColor: '#000',
                backgroundImage: `repeating-linear-gradient(
                  transparent 0px,
                  transparent 23px,
                  rgba(99,130,255,0.3) 23px,
                  rgba(99,130,255,0.3) 24px
                )`,
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
