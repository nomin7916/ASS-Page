// @ts-nocheck
import React from 'react';
import { Trash2, RefreshCw, Plus } from 'lucide-react';
import { UI_CONFIG } from '../config';
import {
  cleanNum, formatCurrency, formatPercent, formatNumber,
  formatChangeRate, handleTableKeyDown
} from '../utils';

const formatUSD = (n) => {
  const v = cleanNum(n);
  if (v === 0) return '$0.00';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const PortfolioTable = ({ portfolio, totals, sortConfig, onSort, onUpdate, onBlur, onDelete, onAddStock, stockFetchStatus, onSingleRefresh, isOverseas = false, usdkrw = 1 }) => {
  const td = "py-3 px-3 border-r border-gray-600 align-middle text-[13px] whitespace-nowrap";
  const inp = "w-full bg-transparent outline-none font-bold focus:bg-blue-900/30 transition-colors";
  if (!totals) return null;
  return (
    <div className="bg-[#0f172a] rounded-xl shadow-lg border border-gray-700 overflow-hidden w-full">
      <div className="overflow-x-auto w-full">
        <table className="w-full text-right table-fixed min-w-[1200px]">
          <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600 font-bold">
            <tr className="text-center">
              <th className="py-3 w-[6%] cursor-pointer hover:bg-gray-700" onClick={() => onSort('category')}>구분</th>
              <th className="py-3 w-[15%] text-center px-4 text-gray-300 cursor-pointer hover:bg-gray-700 sticky left-0 z-20 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]" onClick={() => onSort('name')}>종목명</th>
              <th className="py-3 w-[6%] cursor-pointer hover:bg-gray-700" onClick={() => onSort('code')}>코드</th>
              <th className="py-3 w-[6%] cursor-pointer hover:bg-gray-700" onClick={() => onSort('changeRate')}>등락률</th>
              <th className="py-3 w-[8%] text-center cursor-pointer hover:bg-gray-700" onClick={() => onSort('currentPrice')}>{isOverseas ? '현재가(USD)' : '현재가'}</th>
              <th className="py-3 w-[8%] text-center cursor-pointer hover:bg-gray-700" onClick={() => onSort('purchasePrice')}>{isOverseas ? '구매단가(USD)' : '구매단가'}</th>
              <th className="py-3 w-[7%] bg-blue-900/20 text-blue-200 cursor-pointer hover:bg-blue-800/50" onClick={() => onSort('quantity')}>보유수량</th>
              <th className="py-3 w-[9%] bg-blue-900/20 text-blue-200 cursor-pointer hover:bg-blue-800/50" onClick={() => onSort('investAmount')}>투자금액</th>
              <th className="py-3 w-[5%] bg-blue-900/20 text-blue-200 cursor-pointer hover:bg-blue-800/50" onClick={() => onSort('investRatio')}>비중</th>
              <th className="py-3 w-[9%] bg-yellow-900/20 text-yellow-500 cursor-pointer hover:bg-yellow-800/50" onClick={() => onSort('evalAmount')}>평가금액</th>
              <th className="py-3 w-[5%] bg-yellow-900/20 text-yellow-500 cursor-pointer hover:bg-yellow-800/50" onClick={() => onSort('evalRatio')}>비중</th>
              <th className="py-3 w-[6%] cursor-pointer hover:bg-gray-700" onClick={() => onSort('returnRate')}>수익률</th>
              <th className="py-3 w-[7%] cursor-pointer hover:bg-gray-700" onClick={() => onSort('profit')}>차익</th>
              <th className="py-3 w-[3%] text-center"><button onClick={onAddStock} title="종목 추가" className="text-gray-400 hover:text-purple-400 transition-colors p-1"><Plus size={14} /></button></th>
            </tr>
          </thead>
          <tbody>
            {portfolio.filter(p => p.type === 'stock').map((item) => {
              const fStatus = stockFetchStatus?.[item.code];
              const isRefreshing = fStatus === 'loading';
              return (
                <tr key={item.id} className="group hover:bg-gray-800/40 transition-colors border-b border-gray-700">
                  <td className="p-0 border-r border-gray-600">
                    <input
                      list={`cat-list-${item.id}`}
                      className={`w-full h-full bg-transparent text-center text-xs outline-none font-bold cursor-pointer py-3 px-1 ${UI_CONFIG.COLORS.CATEGORIES[item.category] || 'text-white'}`}
                      value={item.category}
                      onChange={e => {
                        const val = e.target.value;
                        const validCats = Object.keys(UI_CONFIG.COLORS.CATEGORIES);
                        const match = validCats.find(c => c === val);
                        onUpdate(item.id, 'category', match || val);
                      }}
                      onPaste={e => {
                        e.preventDefault();
                        const text = e.clipboardData.getData('text');
                        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                        const validCats = Object.keys(UI_CONFIG.COLORS.CATEGORIES);
                        const normalize = s => s.replace(/\s/g, '').replace('α', 'a').replace('A', 'a');
                        const matchCat = s => validCats.find(c => normalize(c) === normalize(s)) || validCats.find(c => normalize(s).includes(normalize(c)));
                        if (lines.length <= 1) {
                          const match = matchCat(lines[0] || '');
                          if (match) onUpdate(item.id, 'category', match);
                        } else {
                          const stockItems = portfolio.filter(p => p.type === 'stock');
                          const startIdx = stockItems.findIndex(p => p.id === item.id);
                          lines.forEach((line, i) => {
                            const target = stockItems[startIdx + i];
                            if (!target) return;
                            const match = matchCat(line);
                            if (match) onUpdate(target.id, 'category', match);
                          });
                        }
                      }}
                      onBlur={e => {
                        const val = e.target.value;
                        const validCats = Object.keys(UI_CONFIG.COLORS.CATEGORIES);
                        if (!validCats.includes(val)) {
                          const normalize = s => s.replace(/\s/g, '').toLowerCase().replace('α', 'a');
                          const match = validCats.find(c => normalize(c) === normalize(val));
                          if (match) onUpdate(item.id, 'category', match);
                        }
                      }}
                    />
                    <datalist id={`cat-list-${item.id}`}>
                      {Object.keys(UI_CONFIG.COLORS.CATEGORIES).map(c => <option key={c} value={c} />)}
                    </datalist>
                  </td>
                  <td className="p-0 border-r border-gray-600 sticky left-0 z-10 bg-[#0f172a] group-hover:bg-[#1a2535] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]">
                    <div className="flex items-center gap-1 px-1">
                      <input type="text" data-col="name" className={`${inp} text-center flex-1 px-2 text-gray-300`} value={item.name} onChange={e => onUpdate(item.id, 'name', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'name')} />
                      {fStatus === 'success' && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="갱신 완료" />}
                      {fStatus === 'fail' && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="갱신 실패" />}
                      {fStatus === 'loading' && <RefreshCw size={10} className="animate-spin text-yellow-400 shrink-0" title="갱신 중..." />}
                      {!fStatus && item.code && <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0" title="미갱신" />}
                    </div>
                  </td>
                  <td className="p-0 border-r border-gray-600">
                    <input type="text" data-col="code" className={`${inp} text-center text-gray-400 text-xs font-mono`} value={item.code} onChange={e => onUpdate(item.id, 'code', e.target.value)} onBlur={e => onBlur(item.id, e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'code')} />
                  </td>
                  <td className="p-0 border-r border-gray-600 align-middle text-[13px] whitespace-nowrap">
                    <div className={`w-full h-full py-3 px-3 flex items-center justify-center cursor-pointer hover:bg-gray-700/50 transition-colors font-bold ${item.changeRate > 0 ? 'text-red-400' : item.changeRate < 0 ? 'text-blue-400' : 'text-gray-500'}`} onClick={() => item.code && window.open(isOverseas ? `https://finance.yahoo.com/quote/${item.code.toUpperCase()}` : `https://m.stock.naver.com/domestic/stock/${item.code.toUpperCase()}/total`, '_blank')} title="상세">{formatChangeRate(item.changeRate)}</div>
                  </td>
                  <td className="p-0 border-r border-gray-600">
                    <div className={`w-full h-full py-3 px-3 text-right text-gray-300 font-bold cursor-pointer hover:bg-teal-900/30 transition-colors flex items-center justify-end gap-1 ${isRefreshing ? 'animate-pulse' : ''}`} onClick={() => item.code && onSingleRefresh(item.id, item.code)} title={item.code ? (isOverseas ? `클릭하여 현재가 새로고침 (≈${formatNumber(Math.round(cleanNum(item.currentPrice) * usdkrw))}원)` : "클릭하여 현재가 새로고침") : "종목코드를 먼저 입력하세요"}>
                      {isRefreshing && <RefreshCw size={11} className="text-teal-400 animate-spin shrink-0" />}
                      <span>{isOverseas ? formatUSD(item.currentPrice) : formatNumber(item.currentPrice)}</span>
                    </div>
                  </td>
                  <td className="p-0 border-r border-gray-600">
                    <input type="text" data-col="purchasePrice" className={`${inp} text-right px-3 text-gray-400`} value={isOverseas ? formatUSD(item.purchasePrice) : formatNumber(item.purchasePrice)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'purchasePrice', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'purchasePrice')} />
                  </td>
                  <td className="p-0 border-r border-gray-600 bg-blue-900/10">
                    <input type="text" data-col="quantity" className={`${inp} text-center text-blue-200`} value={formatNumber(item.quantity)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'quantity', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'quantity')} />
                  </td>
                  <td className="p-0 border-r border-gray-600 bg-blue-900/10">
                    {isOverseas
                      ? <div className="w-full h-full py-3 px-3 text-right text-blue-200 font-bold text-[13px]">{formatCurrency(item.investAmount)}</div>
                      : <input type="text" data-col="investAmount" className={`${inp} text-right text-blue-200 px-3`} value={formatNumber(item.investAmount)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'investAmount', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'investAmount')} />
                    }
                  </td>
                  <td className={`${td} text-blue-300 bg-blue-900/10 text-center`}>{formatPercent(item.investRatio)}</td>
                  <td className={`${td} text-white font-bold text-right bg-[rgba(113,63,18,0.2)]`}>{formatCurrency(item.evalAmount)}</td>
                  <td className={`${td} text-yellow-600 bg-yellow-900/10 text-center`}>{formatPercent(item.evalRatio)}</td>
                  <td className={`${td} text-center font-bold ${item.returnRate > 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatPercent(item.returnRate)}</td>
                  <td className={`${td} font-bold text-right ${item.profit > 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatCurrency(item.profit)}</td>
                  <td className="text-center py-2.5"><button onClick={() => onDelete(item.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1"><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
            {portfolio.filter(p => p.type === 'deposit').map((item) => (
              <tr key={item.id} className="bg-gray-800/80 font-bold border-t-2 border-b border-gray-600">
                <td className="py-3 px-3 border-r border-gray-600 text-center text-yellow-500 tracking-[0.2em] text-[14px]" colSpan={7}>{isOverseas ? '예수금 (USD CASH)' : '예수금 (CASH)'}</td>
                <td className="p-0 border-r border-gray-600 bg-blue-900/20"><input type="text" className="w-full h-full bg-transparent outline-none font-bold text-right text-blue-300 px-3 py-3 focus:bg-blue-800/50 transition-colors text-[14px]" value={isOverseas ? formatUSD(item.depositAmount) : formatNumber(item.depositAmount)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'depositAmount', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} /></td>
                <td className="py-3 px-3 border-r border-gray-600 text-blue-300 bg-blue-900/20 text-right">{formatPercent(item.investRatio)}</td>
                <td className="py-3 px-3 border-r border-gray-600 text-white font-bold text-right bg-yellow-900/20 text-[14px]">{formatCurrency(item.evalAmount)}</td>
                <td className="py-3 px-3 border-r border-gray-600 text-yellow-500 bg-yellow-900/20 text-right">{formatPercent(item.evalRatio)}</td>
                <td className="py-3 px-3 border-r border-gray-600 text-center text-gray-500">-</td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-gray-500">₩0</td>
                <td className="text-center py-2.5 bg-gray-800/50">🔒</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-[#1e293b] font-bold border-t-2 border-gray-500">
            <tr>
              <td colSpan={7} className="py-3 text-center border-r border-gray-600 uppercase tracking-widest text-gray-500">Total Calculation</td>
              <td className="py-3 px-2 text-blue-200 bg-blue-900/10 border-r border-gray-600">{formatCurrency(totals.totalInvest)}</td>
              <td className="py-3 text-center text-gray-400 bg-blue-900/10 border-r border-gray-600">100%</td>
              <td className="py-3 px-2 text-white bg-yellow-900/10 border-r border-gray-600">{formatCurrency(totals.totalEval)}</td>
              <td className="py-3 text-center text-yellow-500 bg-yellow-900/10 border-r border-gray-600">100%</td>
              <td className={`py-3 text-center border-r border-gray-600 ${totals.totalProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatPercent(totals.totalInvest > 0 ? totals.totalProfit / totals.totalInvest * 100 : 0)}</td>
              <td className={`py-3 px-2 border-r border-gray-600 ${totals.totalProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatCurrency(totals.totalProfit)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default PortfolioTable;
