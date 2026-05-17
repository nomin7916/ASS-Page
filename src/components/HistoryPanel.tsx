// @ts-nocheck
import React, { useState } from 'react';
import { formatCurrency, formatPercent, formatShortDate } from '../utils';
import VerifyEvalModal from './VerifyEvalModal';

export default function HistoryPanel({
  history,
  setHistory,
  totals,
  principal,
  activePortfolioAccountType,
  marketIndicators,
  sortedHistoryDesc,
  handleDownloadCSV,
  stockHistoryMap,
  indicatorHistoryMap,
  activePortfolio,
  patchActivePortfolio,
  notify,
  effectiveDateKey,
}) {
  const [verifyRecord, setVerifyRecord] = useState(null);
  return (
        <>
          <div className="w-full xl:w-[24%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[520px] flex flex-col overflow-hidden shrink-0">
            <div className="p-4 bg-[#0f172a] text-white font-bold flex items-center text-sm border-b border-gray-700 shrink-0">
              <span>📈 자산 평가액 추이</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-right text-[11px] table-fixed border-collapse">
                <colgroup>
                  <col className="w-[35%]" />
                  <col className="w-[40%]" />
                  <col className="w-[25%]" />
                </colgroup>
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-1.5 px-1.5 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-1.5 px-1.5 text-center border-r border-gray-600 font-normal">평가자산</th>
                    <th className="py-1.5 px-1 text-center font-normal cursor-help" title="수식: (당일/전일)-1">전일대비</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHistoryDesc.map((h, i) => {
                    const prevEntry = sortedHistoryDesc[sortedHistoryDesc.indexOf(h) + 1];
                    const dod = (prevEntry && prevEntry.evalAmount > 0) ? ((h.evalAmount / prevEntry.evalAmount) - 1) * 100 : 0;
                    const isToday = h.date === new Date().toISOString().split('T')[0];

                    return (
                      <tr key={h.id || i} className={`border-b border-gray-700 ${isToday ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                        <td className={`py-1.5 px-1.5 text-center border-r border-gray-600 font-bold ${h.isFixed ? 'text-emerald-400/80' : 'text-gray-400'}`}>
                          <button
                            className="hover:text-sky-300 hover:underline transition-colors cursor-pointer"
                            title="클릭: 보유종목·종가 검증/편집"
                            onClick={() => setVerifyRecord(h)}
                          >
                            {formatShortDate(h.date)}
                          </button>
                          {h.isFixed && <span className="ml-0.5 text-[8px] text-emerald-500/60" title="종가 확정 기록&#10;거래 종료 후 종가 기준으로 확정된 히스토리입니다">●</span>}
                        </td>
                        <td className="py-1.5 px-1.5 border-r border-gray-600 font-bold text-right text-white">
                          <div className="flex items-center justify-end gap-1">
                            <span>
                              {activePortfolioAccountType === 'overseas'
                                ? <div className="flex flex-col items-end leading-tight"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(h.evalAmount/(marketIndicators.usdkrw||1))}</span><span className="text-[10px] text-gray-500">{formatCurrency(h.evalAmount)}</span></div>
                                : formatCurrency(h.evalAmount)}
                            </span>
                          </div>
                          {h.isAdjusted && <span className="block text-[9px] font-normal leading-none mt-0.5 text-blue-400">조정됨</span>}
                        </td>
                        <td className="py-1.5 px-1 text-center font-bold"><span className={dod > 0 ? 'text-red-400' : dod < 0 ? 'text-blue-400' : 'text-gray-500'}>{formatPercent(dod)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {verifyRecord && activePortfolio && (
            <VerifyEvalModal
              record={verifyRecord}
              portfolio={activePortfolio}
              accountType={activePortfolioAccountType}
              stockHistoryMap={stockHistoryMap}
              indicatorHistoryMap={indicatorHistoryMap}
              marketIndicators={marketIndicators}
              effectiveDateKey={effectiveDateKey}
              patchActivePortfolio={patchActivePortfolio}
              setHistory={setHistory}
              notify={notify}
              onClose={() => setVerifyRecord(null)}
            />
          )}
        </>
  );
}
