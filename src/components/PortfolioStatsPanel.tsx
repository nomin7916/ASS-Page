// @ts-nocheck
import React, { useState } from 'react';
import { generateId, formatCurrency, formatNumber, formatPercent, cleanNum } from '../utils';

export default function PortfolioStatsPanel({
  totals,
  marketIndicators,
  activePortfolioAccountType,
  portfolioStartDate,
  setPortfolioStartDate,
  principal,
  setPrincipal,
  avgExchangeRate,
  setAvgExchangeRate,
  depositHistory,
  setDepositHistory,
  depositHistory2,
  cagr,
}) {
  const isOv = activePortfolioAccountType === 'overseas';
  const fx = marketIndicators.usdkrw || 1;
  const effectiveFx = isOv ? (avgExchangeRate || fx) : fx;
  const [principalEditing, setPrincipalEditing] = useState(false);
  const [principalRaw, setPrincipalRaw] = useState('');
  const [avgFxEditing, setAvgFxEditing] = useState(false);
  const [avgFxRaw, setAvgFxRaw] = useState('');
  const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  const dualKRW = (krwVal, cls = 'text-gray-200') =>
    isOv ? (
      <div className="flex flex-col items-end leading-tight">
        <span className={`font-bold ${cls}`}>{fmtUS(krwVal / fx)}</span>
        <span className="text-[10px] text-gray-500">{formatCurrency(krwVal)}</span>
      </div>
    ) : (
      <span className={`font-bold ${cls} whitespace-nowrap pl-1`}>{formatCurrency(krwVal)}</span>
    );

  const principalKRW = isOv ? principal * effectiveFx : principal;
  const profit = totals.totalEval - principalKRW;

  const rowPy = isOv ? 'py-1.5' : 'py-2.5';
  const contentP = isOv ? 'p-2' : 'p-3';

  return (
    <div className={`w-full xl:w-[18%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full ${isOv ? 'min-h-[440px]' : 'min-h-[520px]'} flex flex-col overflow-hidden shrink-0`}>
      <div className={`${isOv ? 'p-3 space-y-2' : 'p-4 space-y-3'} bg-black shrink-0 border-b border-gray-700 text-gray-400 text-xs`}>
        <div className="flex justify-between items-start">
          <span className="shrink-0">투자금액</span>
          {dualKRW(totals.totalInvest)}
        </div>
        <div className="flex justify-between items-start">
          <span className="shrink-0">평가금액</span>
          {dualKRW(totals.totalEval, 'text-yellow-400 text-[13px]')}
        </div>
        <div className="flex justify-between">
          <span className="shrink-0">수익률</span>
          <span className="font-bold text-white text-[13px] whitespace-nowrap pl-1">
            {formatPercent(totals.totalInvest > 0 ? (totals.totalProfit / totals.totalInvest) * 100 : 0)}
          </span>
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        <div className={`flex h-auto ${rowPy} border-b border-gray-700`}>
          <div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0">
            <span className="text-[11px] text-gray-400 font-bold">시작일</span>
          </div>
          <div className={`flex-1 ${contentP} flex items-center bg-gray-800/20`}>
            <input
              type="date"
              value={portfolioStartDate}
              onChange={e => setPortfolioStartDate(e.target.value)}
              className="bg-transparent text-gray-200 font-bold outline-none cursor-text text-right w-full text-xs"
            />
          </div>
        </div>
        <div className={`flex h-auto ${rowPy} border-b border-gray-700`}>
          <div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0">
            <span className="text-[11px] text-gray-400 font-bold">입금액</span>
          </div>
          <div className={`flex-1 ${contentP} flex items-center bg-gray-800/20`}>
            <input
              type="text"
              className={`w-full text-right text-gray-400 font-bold outline-none text-xs ${isOv ? 'bg-transparent' : 'bg-gray-900/60 border border-gray-700/60 rounded px-2 py-1.5'}`}
              placeholder="Enter to apply"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = cleanNum(e.target.value);
                  setPrincipal(p => p + v);
                  setDepositHistory([
                    { id: generateId(), date: new Date().toISOString().split('T')[0], amount: v, memo: '수동입금' },
                    ...depositHistory,
                  ]);
                  e.target.value = '';
                }
              }}
            />
          </div>
        </div>
        <div className={`flex h-auto ${rowPy} border-b border-gray-700 shrink-0`}>
          <div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0">
            <span className="text-[11px] text-gray-400 font-bold">{isOv ? '투자 원금(USD)' : '투자 원금'}</span>
          </div>
          <div className={`flex-1 ${contentP} flex flex-col items-end justify-center bg-gray-800/20 gap-0.5`}>
            <input
              type="text"
              className={`w-full text-right text-white font-bold outline-none text-xs ${isOv ? 'bg-transparent border-b border-gray-600/60' : 'bg-gray-900/60 border border-gray-700/60 rounded px-2 py-1'}`}
              value={principalEditing ? principalRaw : (isOv ? '$' + formatNumber(principal) : formatNumber(principal))}
              onFocus={e => { setPrincipalEditing(true); setPrincipalRaw(principal > 0 ? String(principal) : ''); e.target.select(); }}
              onChange={e => setPrincipalRaw(e.target.value)}
              onBlur={() => { setPrincipal(cleanNum(principalRaw)); setPrincipalEditing(false); }}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            />
            {isOv && (
              <span className="text-[10px] text-gray-500 pr-1">
                {formatCurrency(principal * effectiveFx)}
              </span>
            )}
          </div>
        </div>
        {isOv && (
          <div className={`flex h-auto ${rowPy} border-b border-gray-700 shrink-0`}>
            <div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0">
              <span className="text-[11px] text-gray-400 font-bold text-center leading-tight">평균<br/>매입환율</span>
            </div>
            <div className={`flex-1 ${contentP} flex flex-col items-end justify-center bg-gray-800/20 gap-0.5`}>
              <input
                type="text"
                className="w-full bg-transparent border-b border-sky-800/60 text-right text-sky-300 font-bold outline-none text-xs"
                value={avgFxEditing ? avgFxRaw : (avgExchangeRate > 0 ? String(avgExchangeRate) : '')}
                placeholder={String(Math.round(fx))}
                onFocus={e => { setAvgFxEditing(true); setAvgFxRaw(avgExchangeRate > 0 ? String(avgExchangeRate) : ''); e.target.select(); }}
                onChange={e => setAvgFxRaw(e.target.value)}
                onBlur={() => { setAvgExchangeRate(cleanNum(avgFxRaw) || 0); setAvgFxEditing(false); }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
              />
              <span className="text-[10px] text-gray-600 pr-1">
                현재 ₩{Math.round(fx).toLocaleString()}
              </span>
            </div>
          </div>
        )}
        <div className={`flex h-auto ${rowPy} border-b border-gray-700`}>
          <div className="w-[70px] bg-gray-800/50 flex items-center justify-center border-r border-gray-700 shrink-0">
            <span className="text-[11px] text-gray-400 font-bold" title="1년 미만: 총수익율 / 1년 이상: CAGR(연평균 성장률)">CAGR</span>
          </div>
          <div className={`flex-1 ${contentP} flex items-center justify-end bg-gray-800/20`}>
            <span className="font-bold text-blue-300 text-sm">{formatPercent(cagr)}</span>
          </div>
        </div>
        <div className="flex flex-1 min-h-[80px]">
          <div className="w-[70px] bg-gray-800/50 flex flex-col items-center justify-center border-r border-gray-700 gap-2 shrink-0">
            <span className="text-[11px] text-gray-400 font-bold">수익률</span>
            <span className="text-[11px] text-gray-400 font-bold">수익금</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center bg-gray-900/40 gap-1 p-2 overflow-hidden">
            <span className={`text-[24px] font-extrabold leading-none tracking-wide whitespace-nowrap ${profit >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
              {formatPercent(principalKRW > 0 ? (profit / principalKRW) * 100 : 0)}
            </span>
            {isOv ? (
              <div className="flex flex-col items-center leading-tight">
                <span className={`text-[14px] font-bold tracking-wide ${profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {fmtUS(profit / fx)}
                </span>
                <span className="text-[11px] text-gray-500">{formatCurrency(profit)}</span>
              </div>
            ) : (
              <span className={`text-[14px] font-bold tracking-wide whitespace-nowrap ${profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {formatCurrency(profit)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
