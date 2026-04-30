// @ts-nocheck
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { cleanNum, formatCurrency, formatPercent, formatNumber, handleTableKeyDown, handleReadonlyCellNav } from '../utils';

const TROY_OZ_TO_GRAM = 31.1035;

const fmtUsdOz = (v) =>
  v != null ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : null;

const KrxGoldTable = ({ portfolio, goldKr, goldIntl, usdkrw, onUpdate, onRefresh, isRefreshing, goldFetchStatus, goldIntlFetchStatus, usdkrwFetchStatus }) => {
  const goldItem = portfolio.find(p => p.type === 'stock');
  const depositItem = portfolio.find(p => p.type === 'deposit');
  const purchasePrice = goldItem ? cleanNum(goldItem.purchasePrice) : 0;
  const quantity = goldItem ? cleanNum(goldItem.quantity) : 0;
  const investAmount = purchasePrice * quantity;
  const evalAmount = (goldKr || 0) * quantity;
  const profit = evalAmount - investAmount;
  const returnRate = investAmount > 0 ? (profit / investAmount) * 100 : 0;

  const intlPriceKrw = (goldIntl && usdkrw)
    ? Math.round(goldIntl / TROY_OZ_TO_GRAM * usdkrw)
    : null;
  const priceDiff = (goldKr != null && intlPriceKrw != null)
    ? goldKr - intlPriceKrw
    : null;

  const th = "py-3 px-3 text-center text-gray-300 font-bold text-[13px] border-r border-gray-600";
  const td = "py-3 px-3 border-r border-gray-600 align-middle text-[13px] whitespace-nowrap";
  const roTd = `${td} focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none`;
  const inp = "w-full bg-transparent outline-none font-bold focus:bg-blue-900/30 transition-colors text-[13px]";
  const CELL_FOCUS = 'focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500';
  const refreshCls = `flex items-center justify-end gap-1 cursor-pointer hover:bg-teal-900/30 rounded px-1 py-0.5 font-bold text-gray-300 transition-colors ${isRefreshing ? 'animate-pulse' : ''}`;

  return (
    <div className="bg-[#0f172a] rounded-xl shadow-lg border border-gray-700 overflow-hidden w-full">
      <div className="overflow-x-auto w-full">
        <table className="w-full text-right table-fixed min-w-[860px]">
          <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600">
            <tr className="text-center">
              <th className={`${th} w-[5%]`}>단위</th>
              <th className={`${th} w-[16%] sticky left-0 z-20 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]`}>종목명</th>
              <th className={`${th} w-[11%]`}>현재금액</th>
              <th className={`${th} w-[11%]`}>구매 단가</th>
              <th className={`${th} w-[9%] bg-blue-900/20 text-blue-200`}>수량</th>
              <th className={`${th} w-[13%] bg-blue-900/20 text-blue-200`}>구매가격</th>
              <th className={`${th} w-[13%] bg-yellow-900/20 text-yellow-500`}>평가금액</th>
              <th className={`${th} w-[12%]`}>수익</th>
              <th className="py-3 px-3 text-center text-gray-300 font-bold text-[13px] w-[10%]">수익율</th>
            </tr>
          </thead>
          <tbody>
            {/* KRX 금현물 row */}
            <tr className="group border-b border-gray-700 hover:bg-gray-800/40 transition-colors">
              <td className={`${td} text-center text-gray-400 font-bold`}>1g</td>
              <td className={`${td} text-center font-bold text-gray-100 sticky left-0 z-10 bg-[#0f172a] group-hover:bg-[#1a2535] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]`}>
                <div className="flex items-center justify-center gap-1.5">
                  {isRefreshing ? (
                    <RefreshCw size={10} className="text-yellow-400 animate-spin shrink-0" />
                  ) : goldFetchStatus === 'success' ? (
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="갱신 완료" />
                  ) : goldFetchStatus === 'fail' ? (
                    <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="갱신 실패" />
                  ) : null}
                  <a href="https://m.stock.naver.com/marketindex/home/metals" target="_blank" rel="noopener noreferrer" className="hover:text-yellow-300 transition-colors">KRX 금현물</a>
                </div>
              </td>
              <td className={`${td} text-right`}>
                <div className={refreshCls} onClick={onRefresh} title="클릭하여 현재 금 시세 새로고침">
                  {isRefreshing && <RefreshCw size={11} className="text-teal-400 animate-spin shrink-0" />}
                  <span>{goldKr ? formatCurrency(goldKr) : '-'}</span>
                </div>
              </td>
              <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                <input
                  type="text"
                  data-col="purchasePrice"
                  className={`${inp} text-right px-3 py-3 text-gray-400 caret-blue-400`}
                  value={goldItem ? formatNumber(goldItem.purchasePrice) : '0'}
                  onFocus={e => e.target.select()}
                  onChange={e => goldItem && onUpdate(goldItem.id, 'purchasePrice', e.target.value)}
                  onKeyDown={e => handleTableKeyDown(e, 'purchasePrice')}
                />
              </td>
              <td className={`p-0 border-r border-gray-600 bg-blue-900/10 ${CELL_FOCUS}`}>
                <div className="flex items-center px-3 py-3 gap-1">
                  <input
                    type="text"
                    data-col="quantity"
                    className={`${inp} text-center text-blue-200 flex-1 min-w-0 caret-blue-400`}
                    value={goldItem ? formatNumber(goldItem.quantity) : '0'}
                    onFocus={e => e.target.select()}
                    onChange={e => goldItem && onUpdate(goldItem.id, 'quantity', e.target.value)}
                    onKeyDown={e => handleTableKeyDown(e, 'quantity')}
                  />
                  <span className="text-gray-500 text-[11px] shrink-0">g</span>
                </div>
              </td>
              <td className={`${roTd} bg-blue-900/10 text-blue-200 font-bold`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatCurrency(investAmount)}</td>
              <td className={`${roTd} bg-yellow-900/10 text-yellow-400 font-bold`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatCurrency(evalAmount)}</td>
              <td className={`${roTd} font-bold ${profit >= 0 ? 'text-red-400' : 'text-blue-400'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatCurrency(profit)}</td>
              <td className={`py-3 px-3 align-middle text-[13px] whitespace-nowrap text-right font-bold ${returnRate >= 0 ? 'text-red-500 bg-red-900/20' : 'text-blue-500 bg-blue-900/20'} focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                {formatPercent(returnRate)}
              </td>
            </tr>

            {/* 국제 금시세 row */}
            <tr className="group border-b border-gray-700 hover:bg-gray-800/40 transition-colors">
              <td className={`${td} text-center text-gray-400 font-bold`}>1g</td>
              <td className={`${td} text-center font-bold text-gray-300 sticky left-0 z-10 bg-[#0f172a] group-hover:bg-[#1a2535] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]`}>
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex items-center justify-center gap-1.5">
                    {isRefreshing ? (
                      <RefreshCw size={10} className="text-yellow-400 animate-spin shrink-0" />
                    ) : goldIntlFetchStatus === 'success' ? (
                      <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="갱신 완료" />
                    ) : goldIntlFetchStatus === 'fail' ? (
                      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="갱신 실패" />
                    ) : null}
                    <a href="https://finance.yahoo.com/quote/GC%3DF" target="_blank" rel="noopener noreferrer" className="hover:text-yellow-300 transition-colors">국제 금시세</a>
                  </div>
                  {goldIntl != null && (
                    <span className="text-[11px] text-yellow-500/80 font-normal tracking-wide">
                      {fmtUsdOz(goldIntl)}/oz
                    </span>
                  )}
                </div>
              </td>
              <td className={`${td} text-right`}>
                <div className={refreshCls} onClick={onRefresh} title="클릭하여 현재 금 시세 새로고침">
                  {isRefreshing && <RefreshCw size={11} className="text-teal-400 animate-spin shrink-0" />}
                  <span>{intlPriceKrw ? formatCurrency(intlPriceKrw) : '-'}</span>
                </div>
              </td>
              <td className={`${td} text-right text-gray-400 font-bold`}>
                {(goldIntl && usdkrw) ? formatCurrency(Math.round(goldIntl / TROY_OZ_TO_GRAM * usdkrw)) : '-'}
              </td>
              <td colSpan={4} className={td}></td>
              <td className="py-3 px-3 align-middle text-[13px] text-right text-gray-500">0.00%</td>
            </tr>

            {/* 국내-국제 차이 row */}
            <tr className="group border-b border-gray-700 hover:bg-gray-800/40 transition-colors bg-gray-900/30">
              <td className={`${td} text-center`}>
                {usdkrw != null && (
                  <div className="flex flex-col items-center gap-0.5 px-1 py-0.5">
                    <div className="flex items-center gap-1">
                      <div className="text-[10px] text-gray-500">USD/KRW</div>
                      {isRefreshing ? (
                        <RefreshCw size={9} className="text-teal-400 animate-spin shrink-0" />
                      ) : usdkrwFetchStatus === 'success' ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" title="갱신 완료" />
                      ) : usdkrwFetchStatus === 'fail' ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="갱신 실패" />
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <a
                        href="https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] font-bold text-teal-400 hover:text-teal-200 transition-colors"
                        title="네이버 환율 페이지 열기"
                      >
                        {formatNumber(Math.round(usdkrw))}
                      </a>
                      <button
                        onClick={onRefresh}
                        className={`text-gray-500 hover:text-teal-300 transition-colors ${isRefreshing ? 'animate-pulse' : ''}`}
                        title="환율 새로고침"
                      >
                        <RefreshCw size={10} />
                      </button>
                    </div>
                  </div>
                )}
              </td>
              <td className={`${td} text-center font-bold text-gray-400 text-[12px] sticky left-0 z-10 bg-[#0d1523] group-hover:bg-[#1a2535] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)]`}>국내 금시세-국제 금시세</td>
              <td className={`${td} text-right font-bold ${priceDiff != null ? (priceDiff >= 0 ? 'text-red-400' : 'text-blue-400') : 'text-gray-500'}`}>
                {priceDiff != null ? formatCurrency(priceDiff) : '-'}
              </td>
              <td colSpan={6} className={`${td} bg-gray-800/20 text-left`}>
                {(goldIntl != null && usdkrw != null && intlPriceKrw != null && goldKr != null) && (
                  <span className="text-[11px] text-gray-400 font-mono">
                    <span className="text-yellow-500/80">${goldIntl.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/oz</span>
                    <span className="text-gray-500"> ÷ 31.1035 × </span>
                    <span className="text-teal-400">{formatNumber(Math.round(usdkrw))}</span>
                    <span className="text-gray-500"> = </span>
                    <span className="text-gray-300">{formatCurrency(intlPriceKrw)}</span>
                    <span className="text-gray-600 mx-2">→</span>
                    <span className="text-gray-300">{formatCurrency(goldKr)}</span>
                    <span className="text-gray-500"> − </span>
                    <span className="text-gray-300">{formatCurrency(intlPriceKrw)}</span>
                    <span className="text-gray-500"> = </span>
                    <span className={priceDiff >= 0 ? 'text-red-400' : 'text-blue-400'}>{formatCurrency(priceDiff)}</span>
                  </span>
                )}
              </td>
            </tr>

            {/* 예수금 row */}
            {depositItem && (
              <tr className="bg-gray-800/80 font-bold border-t-2 border-b border-gray-600">
                <td className={`${td} text-center text-yellow-500 tracking-[0.2em] text-[14px]`} colSpan={7}>예수금 (CASH)</td>
                <td className="p-0 border-r border-gray-600 bg-blue-900/20">
                  <input
                    type="text"
                    className="w-full h-full bg-transparent outline-none font-bold text-right text-blue-300 px-3 py-3 focus:bg-blue-800/50 transition-colors text-[14px]"
                    value={formatNumber(depositItem.depositAmount)}
                    onFocus={e => e.target.select()}
                    onChange={e => onUpdate(depositItem.id, 'depositAmount', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                  />
                </td>
                <td className="py-3 px-3 text-center text-gray-500">🔒</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default KrxGoldTable;
