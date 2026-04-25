// @ts-nocheck
import React from 'react';
import { Trash2, RefreshCw, Plus } from 'lucide-react';
import { UI_CONFIG } from '../config';
import {
  cleanNum, formatCurrency, formatPercent, formatNumber,
  formatChangeRate, handleTableKeyDown, handleReadonlyCellNav, handleRowArrowNav
} from '../utils';

const formatUSD = (n) => {
  const v = cleanNum(n);
  if (v === 0) return '$0.00';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const SAFE_CATEGORIES = ['채권', '현금', '예수금'];
const getAssetClass = (cat) => SAFE_CATEGORIES.includes(cat) ? 'S' : 'D';

const CELL_FOCUS = 'focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500';
const RO_FOCUS = 'focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none';

const PortfolioTable = ({ portfolio, totals, sortConfig, onSort, onUpdate, onBlur, onDelete, onAddStock, onAddFund, stockFetchStatus, onSingleRefresh, isOverseas = false, usdkrw = 1, isRetirement = false }) => {
  const td = "py-3 px-3 border-r border-gray-600 align-middle text-[13px] whitespace-nowrap";
  const inp = "w-full bg-transparent outline-none font-bold focus:bg-blue-900/30 transition-colors";
  if (!totals) return null;

  const stockItems = portfolio.filter(p => p.type === 'stock');
  const depositItems = portfolio.filter(p => p.type === 'deposit');
  const fundItems = portfolio.filter(p => p.type === 'fund');

  const retirementStats = isRetirement ? (() => {
    const dangerEval = stockItems
      .filter(p => (p.assetClass ?? getAssetClass(p.category)) === 'D')
      .reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const safeStockEval = stockItems
      .filter(p => (p.assetClass ?? getAssetClass(p.category)) === 'S')
      .reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const depositEval = depositItems.reduce((sum, p) => sum + (cleanNum(p.evalAmount) || cleanNum(p.depositAmount) || 0), 0);
    const fundDangerEval = fundItems.filter(p => (p.assetClass ?? 'S') === 'D').reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const fundSafeEval = fundItems.filter(p => (p.assetClass ?? 'S') === 'S').reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const totalEval = dangerEval + fundDangerEval + safeStockEval + fundSafeEval + depositEval;
    const dRatio = totalEval > 0 ? (dangerEval + fundDangerEval) / totalEval * 100 : 0;
    const sRatio = totalEval > 0 ? (safeStockEval + fundSafeEval + depositEval) / totalEval * 100 : 0;
    return { dRatio, sRatio, totalEval };
  })() : null;

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
            {stockItems.map((item) => {
              const fStatus = stockFetchStatus?.[item.code];
              const isRefreshing = fStatus === 'loading';
              const assetClass = item.assetClass ?? getAssetClass(item.category);
              return (
                <tr key={item.id} className="group hover:bg-gray-800/40 transition-colors border-b border-gray-700">
                  {/* 구분 */}
                  <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                    <div className="flex flex-row h-full">
                      <input
                        list={`cat-list-${item.id}`}
                        className={`${isRetirement ? 'flex-1 min-w-0' : 'w-full'} bg-transparent text-center text-xs outline-none font-bold cursor-pointer px-1 py-3 ${UI_CONFIG.COLORS.CATEGORIES[item.category] || 'text-white'} caret-transparent`}
                        value={item.category}
                        onFocus={e => e.target.select()}
                        onChange={e => {
                          const val = e.target.value;
                          const validCats = Object.keys(UI_CONFIG.COLORS.CATEGORIES);
                          const match = validCats.find(c => c === val);
                          onUpdate(item.id, 'category', match || val);
                          if (isRetirement && match) onUpdate(item.id, 'assetClass', getAssetClass(match));
                        }}
                        onKeyDown={handleRowArrowNav}
                        onPaste={e => {
                          e.preventDefault();
                          const text = e.clipboardData.getData('text');
                          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                          const validCats = Object.keys(UI_CONFIG.COLORS.CATEGORIES);
                          const normalize = s => s.replace(/\s/g, '').replace('α', 'a').replace('A', 'a');
                          const matchCat = s => validCats.find(c => normalize(c) === normalize(s)) || validCats.find(c => normalize(s).includes(normalize(c)));
                          if (lines.length <= 1) {
                            const match = matchCat(lines[0] || '');
                            if (match) {
                              onUpdate(item.id, 'category', match);
                              if (isRetirement) onUpdate(item.id, 'assetClass', getAssetClass(match));
                            }
                          } else {
                            const allStockItems = portfolio.filter(p => p.type === 'stock');
                            const startIdx = allStockItems.findIndex(p => p.id === item.id);
                            lines.forEach((line, i) => {
                              const target = allStockItems[startIdx + i];
                              if (!target) return;
                              const match = matchCat(line);
                              if (match) {
                                onUpdate(target.id, 'category', match);
                                if (isRetirement) onUpdate(target.id, 'assetClass', getAssetClass(match));
                              }
                            });
                          }
                        }}
                        onBlur={e => {
                          const val = e.target.value;
                          const validCats = Object.keys(UI_CONFIG.COLORS.CATEGORIES);
                          if (!validCats.includes(val)) {
                            const normalize = s => s.replace(/\s/g, '').toLowerCase().replace('α', 'a');
                            const match = validCats.find(c => normalize(c) === normalize(val));
                            if (match) {
                              onUpdate(item.id, 'category', match);
                              if (isRetirement) onUpdate(item.id, 'assetClass', getAssetClass(match));
                            }
                          } else if (isRetirement) {
                            onUpdate(item.id, 'assetClass', getAssetClass(val));
                          }
                        }}
                      />
                      {isRetirement && (
                        <>
                          <div className="w-px bg-gray-600/60 self-stretch" />
                          <select
                            className="w-4 shrink-0 bg-transparent outline-none cursor-pointer appearance-none"
                            style={{ color: 'transparent' }}
                            value={assetClass}
                            onChange={e => onUpdate(item.id, 'assetClass', e.target.value)}
                            onKeyDown={handleRowArrowNav}
                          >
                            <option value="D" style={{ background: '#0f172a', color: '#9ca3af' }}>D</option>
                            <option value="S" style={{ background: '#0f172a', color: '#9ca3af' }}>S</option>
                          </select>
                        </>
                      )}
                    </div>
                    <datalist id={`cat-list-${item.id}`}>
                      {Object.keys(UI_CONFIG.COLORS.CATEGORIES).map(c => <option key={c} value={c} />)}
                    </datalist>
                  </td>

                  {/* 종목명 */}
                  <td className={`p-0 border-r border-gray-600 sticky left-0 z-10 bg-[#0f172a] group-hover:bg-[#1a2535] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)] ${CELL_FOCUS}`}>
                    <div className="flex items-center gap-1 px-1">
                      <input type="text" data-col="name" className={`${inp} text-center flex-1 px-2 text-gray-300 caret-blue-400`} value={item.name} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'name', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'name')} />
                      {fStatus === 'success' && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="갱신 완료" />}
                      {fStatus === 'fail' && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="갱신 실패" />}
                      {fStatus === 'loading' && <RefreshCw size={10} className="animate-spin text-yellow-400 shrink-0" title="갱신 중..." />}
                      {!fStatus && item.code && <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0" title="미갱신" />}
                    </div>
                  </td>

                  {/* 코드 */}
                  <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                    <input type="text" data-col="code" className={`${inp} text-center text-gray-400 text-xs font-mono caret-blue-400`} value={item.code} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'code', e.target.value)} onBlur={e => onBlur(item.id, e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'code')} />
                  </td>

                  {/* 등락률 — 읽기전용 */}
                  <td
                    className={`p-0 border-r border-gray-600 align-middle text-[13px] whitespace-nowrap ${RO_FOCUS}`}
                    tabIndex={0}
                    onKeyDown={handleReadonlyCellNav}
                  >
                    <div className={`w-full h-full py-3 px-3 flex items-center justify-center cursor-pointer hover:bg-gray-700/50 transition-colors font-bold ${item.changeRate > 0 ? 'text-red-400' : item.changeRate < 0 ? 'text-blue-400' : 'text-gray-500'}`} onClick={() => item.code && window.open(isOverseas ? `https://finance.yahoo.com/quote/${item.code.toUpperCase()}` : `https://m.stock.naver.com/domestic/stock/${item.code.toUpperCase()}/total`, '_blank')} title="상세">{formatChangeRate(item.changeRate)}</div>
                  </td>

                  {/* 현재가 — 읽기전용(클릭 새로고침) */}
                  <td
                    className={`p-0 border-r border-gray-600 ${RO_FOCUS}`}
                    tabIndex={0}
                    onKeyDown={handleReadonlyCellNav}
                  >
                    <div className={`w-full h-full py-3 px-3 text-right text-gray-300 font-bold cursor-pointer hover:bg-teal-900/30 transition-colors flex items-center justify-end gap-1 ${isRefreshing ? 'animate-pulse' : ''}`} onClick={() => item.code && onSingleRefresh(item.id, item.code)} title={item.code ? (isOverseas ? `클릭하여 현재가 새로고침 (≈${formatNumber(Math.round(cleanNum(item.currentPrice) * usdkrw))}원)` : "클릭하여 현재가 새로고침") : "종목코드를 먼저 입력하세요"}>
                      {isRefreshing && <RefreshCw size={11} className="text-teal-400 animate-spin shrink-0" />}
                      <span>{isOverseas ? formatUSD(item.currentPrice) : formatNumber(item.currentPrice)}</span>
                    </div>
                  </td>

                  {/* 구매단가 */}
                  <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                    <input type="text" data-col="purchasePrice" className={`${inp} text-right px-3 text-gray-400 caret-blue-400`} value={isOverseas ? formatUSD(item.purchasePrice) : formatNumber(item.purchasePrice)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'purchasePrice', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'purchasePrice')} />
                  </td>

                  {/* 보유수량 */}
                  <td className={`p-0 border-r border-gray-600 bg-blue-900/10 ${CELL_FOCUS}`}>
                    <input type="text" data-col="quantity" className={`${inp} text-center text-blue-200 caret-blue-400`} value={formatNumber(item.quantity)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'quantity', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'quantity')} />
                  </td>

                  {/* 투자금액 */}
                  <td className={`p-0 border-r border-gray-600 bg-blue-900/10 ${CELL_FOCUS}`}>
                    {isOverseas
                      ? <div className="w-full h-full py-3 px-3 text-right text-blue-200 font-bold text-[13px]">{formatCurrency(item.investAmount)}</div>
                      : <input type="text" data-col="investAmount" className={`${inp} text-right text-blue-200 px-3 caret-blue-400`} value={formatNumber(item.investAmount)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'investAmount', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'investAmount')} />
                    }
                  </td>

                  {/* 비중(투자) — 읽기전용 */}
                  <td
                    className={`${td} text-blue-300 bg-blue-900/10 text-center ${RO_FOCUS}`}
                    tabIndex={0}
                    onKeyDown={handleReadonlyCellNav}
                  >{formatPercent(item.investRatio)}</td>

                  {/* 평가금액 — 읽기전용 */}
                  <td
                    className={`${td} text-white font-bold text-right bg-[rgba(113,63,18,0.2)] ${RO_FOCUS}`}
                    tabIndex={0}
                    onKeyDown={handleReadonlyCellNav}
                  >{formatCurrency(item.evalAmount)}</td>

                  {/* 비중(평가) — 읽기전용 */}
                  <td
                    className={`${td} text-yellow-600 bg-yellow-900/10 text-center ${RO_FOCUS}`}
                    tabIndex={0}
                    onKeyDown={handleReadonlyCellNav}
                  >{formatPercent(item.evalRatio)}</td>

                  {/* 수익률 — 읽기전용 */}
                  <td
                    className={`${td} text-center font-bold ${item.returnRate > 0 ? 'text-red-400' : 'text-blue-400'} ${RO_FOCUS}`}
                    tabIndex={0}
                    onKeyDown={handleReadonlyCellNav}
                  >{formatPercent(item.returnRate)}</td>

                  {/* 차익 — 읽기전용 */}
                  <td
                    className={`${td} font-bold text-right ${item.profit > 0 ? 'text-red-400' : 'text-blue-400'} ${RO_FOCUS}`}
                    tabIndex={0}
                    onKeyDown={handleReadonlyCellNav}
                  >{formatCurrency(item.profit)}</td>

                  <td className="text-center py-2.5"><button onClick={() => onDelete(item.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1"><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
            {depositItems.map((item) => (
              <tr key={item.id} className="bg-gray-800/80 font-bold border-t-2 border-b border-gray-600">
                <td className="py-3 px-3 border-r border-gray-600 text-center text-yellow-500 tracking-[0.2em] text-[14px]" colSpan={7}>{isOverseas ? '예수금 (USD CASH)' : '예수금 (CASH)'}</td>
                <td className={`p-0 border-r border-gray-600 bg-blue-900/20 ${CELL_FOCUS}`}><input type="text" className="w-full h-full bg-transparent outline-none font-bold text-right text-blue-300 px-3 py-3 focus:bg-blue-800/50 transition-colors text-[14px] caret-blue-400" value={isOverseas ? formatUSD(item.depositAmount) : formatNumber(item.depositAmount)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'depositAmount', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} /></td>
                <td className="py-3 px-3 border-r border-gray-600 text-blue-300 bg-blue-900/20 text-right">{formatPercent(item.investRatio)}</td>
                <td className="py-3 px-3 border-r border-gray-600 text-white font-bold text-right bg-yellow-900/20 text-[14px]">{formatCurrency(item.evalAmount)}</td>
                <td className="py-3 px-3 border-r border-gray-600 text-yellow-500 bg-yellow-900/20 text-right">{formatPercent(item.evalRatio)}</td>
                <td className="py-3 px-3 border-r border-gray-600 text-center text-gray-500">-</td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-gray-500">₩0</td>
                <td className="text-center py-2.5 bg-gray-800/50">🔒</td>
              </tr>
            ))}
            {isRetirement && fundItems.map((item) => {
              const fStatus = stockFetchStatus?.[item.code];
              const isRefreshing = fStatus === 'loading';
              const assetClass = item.assetClass ?? 'S';
              const computedQty = item.currentPrice > 0 ? item.evalAmount / item.currentPrice : 0;
              return (
                <tr key={item.id} className="group bg-indigo-950/30 hover:bg-indigo-900/20 transition-colors border-b border-indigo-800/30">
                  {/* 구분: FUND 링크 + S/D 선택 */}
                  <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                    <div className="flex flex-row h-full items-stretch">
                      <a href="https://www.funetf.co.kr/" target="_blank" rel="noopener noreferrer"
                         className="flex-1 py-3 px-1 text-center text-xs font-bold text-indigo-300 hover:text-indigo-100 hover:underline transition-colors">
                        FUND
                      </a>
                      <div className="w-px bg-gray-600/60 self-stretch" />
                      <select
                        className="w-4 shrink-0 bg-transparent outline-none cursor-pointer appearance-none"
                        style={{ color: 'transparent' }}
                        value={assetClass}
                        onChange={e => onUpdate(item.id, 'assetClass', e.target.value)}
                        onKeyDown={handleRowArrowNav}
                      >
                        <option value="D" style={{ background: '#0f172a', color: '#9ca3af' }}>D</option>
                        <option value="S" style={{ background: '#0f172a', color: '#9ca3af' }}>S</option>
                      </select>
                    </div>
                  </td>
                  {/* 종목명 */}
                  <td className={`p-0 border-r border-gray-600 sticky left-0 z-10 bg-indigo-950/60 group-hover:bg-indigo-900/30 [box-shadow:2px_0_6px_rgba(0,0,0,0.6)] ${CELL_FOCUS}`}>
                    <div className="flex items-center gap-1 px-1">
                      <input type="text" data-col="name" className={`${inp} text-center flex-1 px-2 text-indigo-200 caret-blue-400`} value={item.name} placeholder="펀드명" onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'name', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'name')} />
                      {fStatus === 'success' && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="갱신 완료" />}
                      {fStatus === 'fail' && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="갱신 실패" />}
                      {fStatus === 'loading' && <RefreshCw size={10} className="animate-spin text-yellow-400 shrink-0" title="갱신 중..." />}
                    </div>
                  </td>
                  {/* 코드 */}
                  <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                    <input type="text" data-col="code" className={`${inp} text-center text-indigo-400 text-[11px] font-mono caret-blue-400`} value={item.code} placeholder="K55301DW8222" onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'code', e.target.value)} onBlur={e => onBlur(item.id, e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'code')} />
                  </td>
                  {/* 등락률 */}
                  <td className={`p-0 border-r border-gray-600 align-middle ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                    <div className={`w-full h-full py-3 px-3 flex items-center justify-center font-bold text-[13px] cursor-pointer hover:bg-indigo-900/30 transition-colors ${item.changeRate > 0 ? 'text-red-400' : item.changeRate < 0 ? 'text-blue-400' : 'text-gray-500'}`}
                         onClick={() => item.code && window.open(`https://www.funetf.co.kr/product/fund/view/${item.code}`, '_blank')}
                         title={item.code ? 'funetf에서 상세보기' : ''}>
                      {formatChangeRate(item.changeRate)}
                    </div>
                  </td>
                  {/* 현재가(기준가) */}
                  <td className={`p-0 border-r border-gray-600 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                    <div className={`w-full h-full py-3 px-3 text-right text-indigo-200 font-bold cursor-pointer hover:bg-indigo-900/30 transition-colors flex items-center justify-end gap-1 ${isRefreshing ? 'animate-pulse' : ''}`}
                         onClick={() => item.code && onSingleRefresh(item.id, item.code)}
                         title={item.code ? '클릭하여 기준가 새로고침' : '펀드코드를 먼저 입력하세요'}>
                      {isRefreshing && <RefreshCw size={11} className="text-indigo-400 animate-spin shrink-0" />}
                      <span>{formatNumber(item.currentPrice)}</span>
                    </div>
                  </td>
                  {/* 구매단가 - 해당없음 */}
                  <td className="py-3 px-3 border-r border-gray-600 text-center text-gray-600 text-xs">-</td>
                  {/* 보유수량 - 자동계산 */}
                  <td className={`${td} text-center text-indigo-300 bg-blue-900/10 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                    {computedQty > 0 ? computedQty.toFixed(3) : '-'}
                  </td>
                  {/* 투자금액 - 직접입력 */}
                  <td className={`p-0 border-r border-gray-600 bg-blue-900/10 ${CELL_FOCUS}`}>
                    <input type="text" data-col="investAmount" className={`${inp} text-right text-blue-200 px-3 caret-blue-400`} value={formatNumber(item.investAmount)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'investAmount', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'investAmount')} />
                  </td>
                  {/* 비중(투자) */}
                  <td className={`${td} text-blue-300 bg-blue-900/10 text-center ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.investRatio)}</td>
                  {/* 평가금액 - 직접입력 */}
                  <td className={`p-0 border-r border-gray-600 bg-yellow-900/20 ${CELL_FOCUS}`}>
                    <input type="text" data-col="evalAmount" className={`${inp} text-right text-white font-bold px-3 caret-blue-400`} value={formatNumber(item.evalAmount)} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'evalAmount', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'evalAmount')} />
                  </td>
                  {/* 비중(평가) */}
                  <td className={`${td} text-yellow-600 bg-yellow-900/10 text-center ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.evalRatio)}</td>
                  {/* 수익률 */}
                  <td className={`${td} text-center font-bold ${item.returnRate > 0 ? 'text-red-400' : 'text-blue-400'} ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.returnRate)}</td>
                  {/* 차익 */}
                  <td className={`${td} font-bold text-right ${item.profit > 0 ? 'text-red-400' : 'text-blue-400'} ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatCurrency(item.profit)}</td>
                  <td className="text-center py-2.5"><button onClick={() => onDelete(item.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1"><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
            {isRetirement && (
              <tr className="border-b border-indigo-800/20 bg-indigo-950/10">
                <td colSpan={14} className="py-1.5 text-center">
                  <button onClick={onAddFund} className="text-indigo-500 hover:text-indigo-300 text-xs flex items-center gap-1 mx-auto transition-colors px-3 py-1 rounded hover:bg-indigo-900/30">
                    <Plus size={12} /> 펀드 추가
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-[#1e293b] font-bold border-t-2 border-gray-500">
            {isRetirement && retirementStats && (
              <tr className="border-b border-amber-600/30 bg-amber-950/20">
                <td colSpan={14} className="py-2.5 px-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-amber-400 font-bold text-xs tracking-wide">퇴직연금 자산 비율</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-red-400 font-bold text-xs">위험 D</span>
                      <span className={`font-bold text-sm ${Math.abs(retirementStats.dRatio - 70) <= 5 ? 'text-red-400' : 'text-red-300'}`}>
                        {retirementStats.dRatio.toFixed(1)}%
                      </span>
                      <span className="text-gray-600 text-[11px]">(목표 70%)</span>
                      {Math.abs(retirementStats.dRatio - 70) > 5 && (
                        <span className="text-orange-400 text-[11px]">
                          {retirementStats.dRatio > 70 ? `+${(retirementStats.dRatio - 70).toFixed(1)}%` : `${(retirementStats.dRatio - 70).toFixed(1)}%`}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-400 font-bold text-xs">안전 S</span>
                      <span className={`font-bold text-sm ${Math.abs(retirementStats.sRatio - 30) <= 5 ? 'text-emerald-400' : 'text-emerald-300'}`}>
                        {retirementStats.sRatio.toFixed(1)}%
                      </span>
                      <span className="text-gray-600 text-[11px]">(목표 30%)</span>
                    </div>
                    <div className="flex-1 flex items-center gap-1 min-w-[120px]">
                      <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(retirementStats.dRatio, 100)}%`,
                            background: Math.abs(retirementStats.dRatio - 70) <= 5
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
            )}
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
