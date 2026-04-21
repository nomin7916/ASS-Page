// @ts-nocheck
import React from 'react';
import { Trash2, Plus } from 'lucide-react';
import { cleanNum, formatCurrency, formatPercent, formatNumber, handleTableKeyDown } from '../utils';

// 금은 항상 troy ounce(트로이 온스) 기준 = 31.1035g
// 일반 온스(avoirdupois)는 28.3495g이지만 귀금속에는 사용하지 않음
const TROY_OZ_TO_GRAM = 31.1035;

const GoldPortfolioTable = ({
  portfolio,
  marketIndicators,
  principal,
  onUpdate,
  onBlur,
  onDelete,
  onAddStock,
  onSingleRefresh,
  stockFetchStatus,
}) => {
  const goldKr = marketIndicators?.goldKr || 0;       // KRX 금현물 (₩/g)
  const goldIntl = marketIndicators?.goldIntl || 0;   // 국제 금 ($/troy oz)
  const usdkrw = marketIndicators?.usdkrw || 0;       // USD/KRW

  // 국제 금시세 → ₩/g (troy oz 기준: $/oz ÷ 31.1035 × USD/KRW)
  const goldIntlKrwPerGram = goldIntl > 0 && usdkrw > 0
    ? goldIntl * usdkrw / TROY_OZ_TO_GRAM
    : 0;

  // 국내 - 국제 차이 (₩/g)
  const priceDiff = goldKr && goldIntlKrwPerGram ? goldKr - goldIntlKrwPerGram : 0;

  // KRW/USD for ₩10,000
  const krwPerUsd = usdkrw > 0 ? 10000 / usdkrw : 0;

  // 포트폴리오 집계 (stock 타입)
  const stocks = portfolio.filter(p => p.type === 'stock');
  const depositItems = portfolio.filter(p => p.type === 'deposit');

  const totalQuantity = stocks.reduce((sum, s) => sum + cleanNum(s.quantity), 0);
  const totalInvested = stocks.reduce((sum, s) => sum + cleanNum(s.purchasePrice) * cleanNum(s.quantity), 0);
  const avgPurchasePrice = totalQuantity > 0 ? totalInvested / totalQuantity : 0;
  const goldEval = goldKr > 0 ? totalQuantity * goldKr : 0;
  const goldProfit = goldEval - totalInvested;
  const goldReturnRate = totalInvested > 0 ? (goldProfit / totalInvested) * 100 : 0;

  const depositAmount = depositItems.reduce((sum, d) => sum + cleanNum(d.depositAmount), 0);

  const totalEval = goldEval + depositAmount;
  const totalProfit = totalEval - principal;
  const totalReturnRate = principal > 0 ? (totalProfit / principal) * 100 : 0;

  const inp = "w-full bg-transparent outline-none font-bold focus:bg-blue-900/30 transition-colors text-center";

  return (
    <div className="flex flex-col gap-3">
      {/* ── 금 시세 + 포트폴리오 테이블 ── */}
      <div className="bg-[#0f172a] rounded-xl shadow-lg border border-gray-700 overflow-hidden w-full">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-right table-fixed min-w-[900px]">
            <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600 font-bold text-[13px]">
              <tr className="text-center">
                <th className="py-3 w-[8%]">단위</th>
                <th className="py-3 w-[20%]">종목</th>
                <th className="py-3 w-[12%]">현재금액</th>
                <th className="py-3 w-[12%] text-blue-200 bg-blue-900/20">구매 단가</th>
                <th className="py-3 w-[10%] text-blue-200 bg-blue-900/20">수량</th>
                <th className="py-3 w-[12%] text-blue-200 bg-blue-900/20">구매가격</th>
                <th className="py-3 w-[12%] text-yellow-400 bg-yellow-900/20">평가금액</th>
                <th className="py-3 w-[10%]">수익</th>
                <th className="py-3 w-[7%]">수익율</th>
                <th className="py-3 w-[4%] text-center">
                  <button onClick={onAddStock} title="매수 추가" className="text-gray-400 hover:text-purple-400 transition-colors p-1">
                    <Plus size={14} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* KRX 금현물 행 */}
              <tr className="border-b border-gray-700 bg-[rgba(20,60,30,0.4)]">
                <td className="py-3 px-2 border-r border-gray-600 text-center text-gray-300 text-[13px] font-bold">1g</td>
                <td className="py-3 px-3 border-r border-gray-600 text-center text-green-300 font-bold text-[14px]">
                  KRX 금현물
                </td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-white font-bold text-[14px]">
                  {goldKr > 0 ? `₩${Math.round(goldKr).toLocaleString()}` : '-'}
                </td>
                {/* 구매단가 - 편집 가능 (평균) */}
                <td className="py-1 px-1 border-r border-gray-600 bg-blue-900/10 text-[13px]">
                  <div className="text-right px-2 text-blue-200 font-bold">
                    {avgPurchasePrice > 0 ? `₩${Math.round(avgPurchasePrice).toLocaleString()}` : '-'}
                  </div>
                </td>
                {/* 수량 */}
                <td className="py-3 px-3 border-r border-gray-600 bg-blue-900/10 text-center text-blue-200 font-bold text-[13px]">
                  {totalQuantity > 0 ? `${totalQuantity}g` : '-'}
                </td>
                {/* 구매가격 */}
                <td className="py-3 px-3 border-r border-gray-600 bg-blue-900/10 text-right text-blue-200 font-bold text-[13px]">
                  {totalInvested > 0 ? `₩${Math.round(totalInvested).toLocaleString()}` : '-'}
                </td>
                {/* 평가금액 */}
                <td className="py-3 px-3 border-r border-gray-600 bg-[rgba(113,63,18,0.2)] text-right text-white font-bold text-[13px]">
                  {goldEval > 0 ? `₩${Math.round(goldEval).toLocaleString()}` : '-'}
                </td>
                {/* 수익 */}
                <td className={`py-3 px-3 border-r border-gray-600 text-right font-bold text-[13px] ${goldProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {totalInvested > 0 ? formatCurrency(goldProfit) : '₩ -'}
                </td>
                {/* 수익율 */}
                <td className={`py-3 px-2 border-r border-gray-600 text-center font-bold text-[13px] rounded ${goldReturnRate > 0 ? 'bg-red-500/80 text-white' : goldReturnRate < 0 ? 'bg-blue-500/80 text-white' : 'text-gray-400'}`}>
                  {totalInvested > 0 ? formatPercent(goldReturnRate) : '0.00%'}
                </td>
                <td></td>
              </tr>

              {/* 국제 금시세 행 */}
              <tr className="border-b border-gray-700 bg-[rgba(20,60,30,0.25)]">
                <td className="py-3 px-2 border-r border-gray-600 text-center text-gray-300 text-[13px] font-bold">1g</td>
                <td className="py-2 px-3 border-r border-gray-600 text-center font-bold text-[13px]">
                  <div className="text-green-200">국제 금시세</div>
                  {goldIntl > 0 && usdkrw > 0 && (
                    <div className="text-gray-500 text-[9px] font-normal mt-0.5">
                      ${goldIntl.toLocaleString('en-US', {maximumFractionDigits: 2})}/oz ÷ {TROY_OZ_TO_GRAM}g × {usdkrw.toFixed(0)}
                    </div>
                  )}
                </td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-white font-bold text-[13px]">
                  {goldIntlKrwPerGram > 0 ? `₩${Math.round(goldIntlKrwPerGram).toLocaleString()}` : '-'}
                </td>
                <td className="border-r border-gray-600 bg-blue-900/10" colSpan={3}></td>
                <td className="border-r border-gray-600 bg-[rgba(113,63,18,0.1)]"></td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-yellow-600 font-bold text-[13px]">₩ -</td>
                <td className="py-3 px-2 border-r border-gray-600 text-center text-blue-400 font-bold text-[13px]">0.00%</td>
                <td></td>
              </tr>

              {/* USD/KRW 행 */}
              <tr className="border-b border-gray-700 bg-[rgba(30,50,80,0.4)]">
                <td className="py-3 px-2 border-r border-gray-600 text-center text-gray-300 text-[13px] font-bold">$ 1</td>
                <td className="py-3 px-3 border-r border-gray-600 text-center text-blue-300 font-bold text-[13px]">🏛 USD/KRW</td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-white font-bold text-[13px]">
                  {usdkrw > 0 ? `₩${usdkrw.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                </td>
                <td className="border-r border-gray-600 bg-blue-900/10" colSpan={3}></td>
                <td className="border-r border-gray-600 bg-[rgba(113,63,18,0.1)]"></td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-gray-400 font-bold text-[13px]">0</td>
                <td className="border-r border-gray-600"></td>
                <td></td>
              </tr>

              {/* KRW/USD 행 */}
              <tr className="border-b border-gray-700 bg-[rgba(30,50,80,0.25)]">
                <td className="py-3 px-2 border-r border-gray-600 text-center text-gray-300 text-[12px] font-bold">₩ 10,000</td>
                <td className="py-3 px-3 border-r border-gray-600 text-center text-blue-300 font-bold text-[13px]">🏛 KRW/USD</td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-white font-bold text-[13px]">
                  {krwPerUsd > 0 ? `$ ${krwPerUsd.toFixed(2)}` : '-'}
                </td>
                <td className="border-r border-gray-600 bg-blue-900/10" colSpan={3}></td>
                <td className="border-r border-gray-600 bg-[rgba(113,63,18,0.1)]"></td>
                <td className="py-3 px-3 border-r border-gray-600 text-right text-gray-400 font-bold text-[13px]">0</td>
                <td className="border-r border-gray-600"></td>
                <td></td>
              </tr>

              {/* 국내-국제 차이 행 */}
              <tr className="border-b border-gray-600 bg-[rgba(50,30,10,0.3)]">
                <td className="border-r border-gray-600"></td>
                <td className="py-3 px-3 border-r border-gray-600 text-center text-orange-300 font-bold text-[12px]">국내 금시세-국제 금시세</td>
                <td className={`py-3 px-3 border-r border-gray-600 text-right font-bold text-[13px] ${priceDiff >= 0 ? 'text-orange-300' : 'text-blue-300'}`}>
                  {priceDiff !== 0
                    ? `${priceDiff >= 0 ? '' : '-'}₩${Math.abs(Math.round(priceDiff)).toLocaleString()}`
                    : '-'}
                </td>
                <td className="border-r border-gray-600 bg-blue-900/10" colSpan={3}></td>
                <td className="border-r border-gray-600 bg-[rgba(113,63,18,0.1)]"></td>
                <td className="border-r border-gray-600" colSpan={2}></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 매수 내역 (개별 편집) ── */}
      {stocks.length > 0 && (
        <div className="bg-[#0f172a] rounded-xl shadow-lg border border-gray-700 overflow-hidden w-full">
          <div className="p-2 bg-[#1e293b] text-gray-400 text-xs font-bold border-b border-gray-700">매수 내역</div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-right table-fixed min-w-[900px]">
              <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-700 text-[12px]">
                <tr className="text-center">
                  <th className="py-2 w-[6%]">구분</th>
                  <th className="py-2 w-[20%]">메모</th>
                  <th className="py-2 w-[14%] text-blue-200 bg-blue-900/20">구매단가 (₩/g)</th>
                  <th className="py-2 w-[10%] text-blue-200 bg-blue-900/20">수량 (g)</th>
                  <th className="py-2 w-[14%] text-blue-200 bg-blue-900/20">투자금액</th>
                  <th className="py-2 w-[14%] text-yellow-400 bg-yellow-900/20">평가금액</th>
                  <th className="py-2 w-[10%]">수익률</th>
                  <th className="py-2 w-[10%]">수익금</th>
                  <th className="py-2 w-[4%]"></th>
                </tr>
              </thead>
              <tbody>
                {stocks.map(item => {
                  const inv = cleanNum(item.purchasePrice) * cleanNum(item.quantity);
                  const evl = goldKr > 0 ? cleanNum(item.quantity) * goldKr : cleanNum(item.currentPrice) * cleanNum(item.quantity);
                  const prf = evl - inv;
                  const rr = inv > 0 ? prf / inv * 100 : 0;
                  const fStatus = stockFetchStatus?.[item.code];
                  return (
                    <tr key={item.id} className="hover:bg-gray-800/40 transition-colors border-b border-gray-700">
                      <td className="py-2 px-2 border-r border-gray-600 text-center text-gray-400 text-[12px]">{item.category || '-'}</td>
                      <td className="p-0 border-r border-gray-600">
                        <input
                          type="text"
                          className="w-full bg-transparent outline-none text-center text-gray-300 font-bold text-[12px] py-2 px-2 focus:bg-blue-900/30"
                          value={item.name}
                          onChange={e => onUpdate(item.id, 'name', e.target.value)}
                          onKeyDown={e => handleTableKeyDown(e, 'name')}
                        />
                      </td>
                      <td className="p-0 border-r border-gray-600 bg-blue-900/10">
                        <input
                          type="text"
                          className="w-full bg-transparent outline-none text-right text-blue-200 font-bold text-[12px] py-2 px-3 focus:bg-blue-800/40"
                          value={formatNumber(item.purchasePrice)}
                          onFocus={e => e.target.select()}
                          onChange={e => onUpdate(item.id, 'purchasePrice', e.target.value)}
                          onKeyDown={e => handleTableKeyDown(e, 'purchasePrice')}
                        />
                      </td>
                      <td className="p-0 border-r border-gray-600 bg-blue-900/10">
                        <input
                          type="text"
                          className="w-full bg-transparent outline-none text-center text-blue-200 font-bold text-[12px] py-2 px-2 focus:bg-blue-800/40"
                          value={formatNumber(item.quantity)}
                          onFocus={e => e.target.select()}
                          onChange={e => onUpdate(item.id, 'quantity', e.target.value)}
                          onKeyDown={e => handleTableKeyDown(e, 'quantity')}
                        />
                      </td>
                      <td className="py-2 px-3 border-r border-gray-600 bg-blue-900/10 text-right text-blue-200 font-bold text-[12px]">
                        {formatCurrency(inv)}
                      </td>
                      <td className="py-2 px-3 border-r border-gray-600 bg-[rgba(113,63,18,0.15)] text-right text-white font-bold text-[12px]">
                        {goldKr > 0 ? formatCurrency(evl) : '-'}
                      </td>
                      <td className={`py-2 px-2 border-r border-gray-600 text-center font-bold text-[12px] ${rr >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {inv > 0 ? formatPercent(rr) : '-'}
                      </td>
                      <td className={`py-2 px-3 border-r border-gray-600 text-right font-bold text-[12px] ${prf >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {inv > 0 ? formatCurrency(prf) : '-'}
                      </td>
                      <td className="text-center py-2">
                        <button onClick={() => onDelete(item.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 요약 패널 (검정 배경, 사진과 동일) ── */}
      <div className="rounded-xl overflow-hidden border border-gray-700 shadow-lg">
        {/* 헤더 */}
        <div className="grid grid-cols-6 bg-black text-white font-bold text-[13px] text-center border-b border-gray-700">
          <div className="py-3 px-2 border-r border-gray-700">
            <span className="text-yellow-400">GOLD 투자원금</span>
          </div>
          <div className="py-3 px-2 border-r border-gray-700">예수금</div>
          <div className="py-3 px-2 border-r border-gray-700">구매가격</div>
          <div className="py-3 px-2 border-r border-gray-700">총 평가금</div>
          <div className="py-3 px-2 border-r border-gray-700">수익금</div>
          <div className="py-3 px-2"></div>
        </div>
        {/* 값 */}
        <div className="grid grid-cols-6 bg-[#0a0a0a] text-center border-t border-gray-800">
          <div className="py-4 px-2 border-r border-gray-800">
            <span className="text-yellow-400 font-bold text-[15px]">{formatCurrency(principal)}</span>
          </div>
          <div className="py-4 px-2 border-r border-gray-800">
            <span className="text-red-400 font-bold text-[15px]">{formatCurrency(depositAmount)}</span>
          </div>
          <div className="py-4 px-2 border-r border-gray-800">
            <span className="text-white font-bold text-[14px]">{formatCurrency(totalInvested)}</span>
          </div>
          <div className="py-4 px-2 border-r border-gray-800">
            <span className="text-white font-bold text-[14px]">{formatCurrency(totalEval)}</span>
          </div>
          <div className="py-4 px-2 border-r border-gray-800">
            <span className={`font-bold text-[14px] ${totalProfit >= 0 ? 'text-orange-400' : 'text-blue-400'}`}>
              {formatCurrency(totalProfit)}
            </span>
          </div>
          <div className={`py-4 px-2 font-extrabold text-[20px] ${totalReturnRate >= 0 ? 'text-orange-400' : 'text-blue-400'}`}>
            {formatPercent(totalReturnRate)}
          </div>
        </div>
      </div>

      {/* ── 네이버 금시세 링크 ── */}
      <div className="flex flex-col gap-1 pl-1">
        <a
          href="https://m.stock.naver.com/fchart/marketindex/metals/M04020000"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 text-xs underline"
        >
          https://m.stock.naver.com/fchart/marketindex/metals/M04020000
        </a>
        <a
          href="https://m.stock.naver.com/marketindex/home/metals"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 text-xs underline"
        >
          https://m.stock.naver.com/marketindex/home/metals
        </a>
      </div>
    </div>
  );
};

export default GoldPortfolioTable;
