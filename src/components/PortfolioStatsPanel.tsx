// @ts-nocheck
import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';
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
  const [showCalcPopup, setShowCalcPopup] = useState(false);
  const [popupPos, setPopupPos] = useState({ x: 80, y: 120 });
  const dragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });

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

  // 달러 기준 계산
  const usdEval = isOv ? totals.totalEval / fx : 0;
  const usdProfit = isOv ? usdEval - principal : 0;
  const daysFromStart = portfolioStartDate
    ? (Date.now() - new Date(portfolioStartDate).getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  const usdCagr =
    isOv && daysFromStart > 0 && principal > 0 && usdEval > 0
      ? daysFromStart < 365
        ? (usdEval / principal - 1) * 100
        : (Math.pow(usdEval / principal, 365.25 / daysFromStart) - 1) * 100
      : 0;
  const fxGain = isOv ? (fx - effectiveFx) * principal : 0;
  const years = daysFromStart / 365.25;

  const handleDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { active: true, offsetX: e.clientX - popupPos.x, offsetY: e.clientY - popupPos.y };
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      setPopupPos({ x: e.clientX - dragRef.current.offsetX, y: e.clientY - dragRef.current.offsetY });
    };
    const onUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const rowPy = isOv ? 'py-1.5' : 'py-2.5';
  const contentP = isOv ? 'p-2' : 'p-3';

  return (
    <>
    <div className="w-full xl:w-[18%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg h-full min-h-[520px] flex flex-col overflow-hidden shrink-0">
      <div className={`${isOv ? 'p-5 space-y-4' : 'p-4 space-y-3'} bg-black shrink-0 border-b border-gray-700 text-gray-400 text-xs`}>
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

        {isOv ? (
          <div className="flex flex-col flex-1">
            {/* 달러 기준 / 환 평가 두 컬럼 */}
            <div className="flex flex-1 min-h-[80px]">
              <div className="w-[70px] bg-gray-800/50 flex flex-col items-center justify-center border-r border-gray-700 gap-1.5 shrink-0">
                <span className="text-[11px] text-gray-400 font-bold">수익률</span>
                <span className="text-[11px] text-gray-400 font-bold">수익금</span>
              </div>
              {/* 달러 기준 */}
              <div className="flex-1 flex flex-col items-center justify-center border-r border-gray-700 bg-gray-900/40 gap-0.5 p-1.5 overflow-hidden">
                <span className="text-[9px] text-gray-500 font-bold mb-0.5">달러 기준</span>
                <span className={`text-[17px] font-extrabold leading-none tracking-wide whitespace-nowrap ${usdCagr >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                  {formatPercent(usdCagr)}
                </span>
                <span className={`text-[11px] font-bold tracking-wide ${usdProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {fmtUS(usdProfit)}
                </span>
                <span className="text-[10px] text-gray-500">{formatCurrency(usdProfit * fx)}</span>
              </div>
              {/* 환 평가 */}
              <div className="flex-1 flex flex-col items-center justify-center bg-gray-900/40 gap-0.5 p-1.5 overflow-hidden">
                <span className="text-[9px] text-gray-500 font-bold mb-0.5">환 평가</span>
                <span className={`text-[17px] font-extrabold leading-none tracking-wide whitespace-nowrap ${cagr >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                  {formatPercent(cagr)}
                </span>
                <span className={`text-[11px] font-bold tracking-wide ${profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {fmtUS(profit / fx)}
                </span>
                <span className="text-[10px] text-gray-500">{formatCurrency(profit)}</span>
              </div>
            </div>
            {/* 수익율 계산 버튼 */}
            <div className="border-t border-gray-700 shrink-0">
              <button
                className="w-full py-1.5 text-[11px] text-gray-500 hover:text-sky-400 hover:bg-gray-800/40 transition-colors font-bold tracking-wide"
                onClick={() => {
                  setPopupPos({ x: Math.max(20, window.innerWidth / 2 - 160), y: Math.max(20, window.innerHeight / 2 - 220) });
                  setShowCalcPopup(true);
                }}
              >
                수익율 계산
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-[80px]">
            <div className="w-[70px] bg-gray-800/50 flex flex-col items-center justify-center border-r border-gray-700 gap-2 shrink-0">
              <span className="text-[11px] text-gray-400 font-bold">수익률</span>
              <span className="text-[11px] text-gray-400 font-bold">수익금</span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-900/40 gap-1 p-2 overflow-hidden">
              <span className={`text-[24px] font-extrabold leading-none tracking-wide whitespace-nowrap ${profit >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                {formatPercent(principalKRW > 0 ? (profit / principalKRW) * 100 : 0)}
              </span>
              <span className={`text-[14px] font-bold tracking-wide whitespace-nowrap ${profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {formatCurrency(profit)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* 수익율 계산 팝업 */}
    {showCalcPopup && (
      <div className="fixed inset-0 z-50" onMouseDown={() => setShowCalcPopup(false)}>
        <div
          className="fixed bg-[#0f172a] border border-gray-600 rounded-xl shadow-2xl flex flex-col"
          style={{ width: 320, top: popupPos.y, left: popupPos.x }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div
            className="flex items-center justify-between px-3 py-2 border-b border-gray-700 cursor-move select-none"
            onMouseDown={handleDragStart}
          >
            <button onClick={() => setShowCalcPopup(false)} className="text-pink-500 hover:text-pink-300">
              <X size={14} />
            </button>
            <span className="text-xs text-gray-300 font-bold">수익율 계산</span>
            <div style={{ width: 14 }} />
          </div>

          <div className="p-4 space-y-5 text-[11px] leading-relaxed overflow-y-auto max-h-[70vh]">

            {/* 환 평가 수익률 */}
            <div className="space-y-2">
              <div className="text-sky-400 font-bold border-b border-gray-700/60 pb-1 text-[12px]">환 평가 수익률</div>

              {/* 공식 */}
              <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
                <div className="text-gray-500 text-[10px] font-bold mb-1">공식</div>
                {daysFromStart < 365 ? (
                  <>
                    <div className="text-gray-300">수익률  =  ( 평가 KRW  ÷  원금 KRW )  −  1</div>
                    <div className="text-gray-600 text-[10px]">※ 투자기간 1년 미만 → 단순 수익률 적용</div>
                  </>
                ) : (
                  <>
                    <div className="text-gray-300">CAGR  =  ( 평가 KRW  ÷  원금 KRW ) <sup className="text-[9px]">( 1 ÷ n )</sup>  −  1</div>
                    <div className="text-gray-500 pl-2">n  =  투자일수  ÷  365.25  <span className="text-gray-600">(단위: 년)</span></div>
                  </>
                )}
              </div>

              {/* 계산 */}
              <div className="space-y-0.5 pl-1">
                <div className="text-gray-500 text-[10px] font-bold mb-1">계산</div>
                <div className="text-gray-400">투자일수  =  {Math.round(daysFromStart)} 일
                  {daysFromStart >= 365 && <span className="text-gray-600">  →  n  =  {years.toFixed(2)} 년</span>}
                </div>
                <div className="text-gray-400">평가 KRW  =  {formatCurrency(totals.totalEval)}</div>
                <div className="text-gray-400">원금 KRW  =  {formatCurrency(principalKRW)}</div>
                <div className="text-gray-400 pt-0.5">
                  {daysFromStart < 365
                    ? <>= ( {formatCurrency(totals.totalEval)}  ÷  {formatCurrency(principalKRW)} )  −  1</>
                    : <>= ( {formatCurrency(totals.totalEval)}  ÷  {formatCurrency(principalKRW)} ) <sup className="text-[9px]">( 1 ÷ {years.toFixed(2)} )</sup>  −  1</>
                  }
                </div>
                <div className={`font-bold text-[13px] pt-0.5 ${cagr >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  =  {formatPercent(cagr)}
                </div>
              </div>

              {/* 원화 수익금 */}
              <div className="space-y-0.5 pl-1 pt-1 border-t border-gray-700/40">
                <div className="text-gray-500 text-[10px] font-bold mb-1">원화 수익금</div>
                <div className="text-gray-400">= ( 평가$  ×  현재환율 )  −  ( 원금$  ×  매입환율 )</div>
                <div className="text-gray-400 pl-2">= ( {fmtUS(usdEval)}  ×  ₩{Math.round(fx).toLocaleString()} )</div>
                <div className="text-gray-400 pl-4">−  ( {fmtUS(principal)}  ×  ₩{Math.round(effectiveFx).toLocaleString()} )</div>
                <div className="text-gray-400">= {formatCurrency(totals.totalEval)}  −  {formatCurrency(principalKRW)}</div>
                <div className={`font-bold pt-0.5 ${profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  =  {formatCurrency(profit)}
                </div>
                <div className={`pl-2 text-[10px] ${profit >= 0 ? 'text-red-400/70' : 'text-blue-400/70'}`}>
                  ( 달러 환산  {fmtUS(profit / fx)} )
                </div>
              </div>
            </div>

            {/* 달러 기준 수익률 */}
            <div className="space-y-2">
              <div className="text-emerald-400 font-bold border-b border-gray-700/60 pb-1 text-[12px]">달러 기준 수익률</div>

              {/* 공식 */}
              <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
                <div className="text-gray-500 text-[10px] font-bold mb-1">공식</div>
                {daysFromStart < 365 ? (
                  <>
                    <div className="text-gray-300">수익률  =  ( 평가$  ÷  원금$ )  −  1</div>
                    <div className="text-gray-600 text-[10px]">※ 투자기간 1년 미만 → 단순 수익률 적용</div>
                  </>
                ) : (
                  <>
                    <div className="text-gray-300">CAGR  =  ( 평가$  ÷  원금$ ) <sup className="text-[9px]">( 1 ÷ n )</sup>  −  1</div>
                    <div className="text-gray-500 pl-2">n  =  투자일수  ÷  365.25  <span className="text-gray-600">(단위: 년)</span></div>
                  </>
                )}
              </div>

              {/* 계산 */}
              <div className="space-y-0.5 pl-1">
                <div className="text-gray-500 text-[10px] font-bold mb-1">계산</div>
                <div className="text-gray-400">투자일수  =  {Math.round(daysFromStart)} 일
                  {daysFromStart >= 365 && <span className="text-gray-600">  →  n  =  {years.toFixed(2)} 년</span>}
                </div>
                <div className="text-gray-400">평가$  =  {fmtUS(usdEval)}</div>
                <div className="text-gray-400">원금$  =  {fmtUS(principal)}</div>
                <div className="text-gray-400 pt-0.5">
                  {daysFromStart < 365
                    ? <>= ( {fmtUS(usdEval)}  ÷  {fmtUS(principal)} )  −  1</>
                    : <>= ( {fmtUS(usdEval)}  ÷  {fmtUS(principal)} ) <sup className="text-[9px]">( 1 ÷ {years.toFixed(2)} )</sup>  −  1</>
                  }
                </div>
                <div className={`font-bold text-[13px] pt-0.5 ${usdCagr >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  =  {formatPercent(usdCagr)}
                </div>
              </div>

              {/* 달러 수익금 */}
              <div className="space-y-0.5 pl-1 pt-1 border-t border-gray-700/40">
                <div className="text-gray-500 text-[10px] font-bold mb-1">달러 수익금</div>
                <div className="text-gray-400">= 평가$  −  원금$</div>
                <div className="text-gray-400">= {fmtUS(usdEval)}  −  {fmtUS(principal)}</div>
                <div className={`font-bold pt-0.5 ${usdProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  =  {fmtUS(usdProfit)}
                </div>
                <div className={`pl-2 text-[10px] ${usdProfit >= 0 ? 'text-red-400/70' : 'text-blue-400/70'}`}>
                  ( ₩ 환산  {formatCurrency(usdProfit * fx)} )
                </div>
              </div>
            </div>

            {/* 환차익 */}
            <div className="space-y-2">
              <div className="text-yellow-400 font-bold border-b border-gray-700/60 pb-1 text-[12px]">환차익</div>

              {/* 공식 */}
              <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
                <div className="text-gray-500 text-[10px] font-bold mb-1">공식</div>
                <div className="text-gray-300">환차익  =  ( 현재환율  −  매입환율 )  ×  원금$</div>
              </div>

              {/* 계산 */}
              <div className="space-y-0.5 pl-1">
                <div className="text-gray-500 text-[10px] font-bold mb-1">계산</div>
                <div className="text-gray-400">현재환율  =  ₩{Math.round(fx).toLocaleString()}</div>
                <div className="text-gray-400">매입환율  =  ₩{Math.round(effectiveFx).toLocaleString()}</div>
                <div className="text-gray-400">원금$  =  {fmtUS(principal)}</div>
                <div className="text-gray-400 pt-0.5">
                  = ( ₩{Math.round(fx).toLocaleString()}  −  ₩{Math.round(effectiveFx).toLocaleString()} )  ×  {fmtUS(principal)}
                </div>
                <div className={`font-bold pt-0.5 ${fxGain >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  =  {formatCurrency(fxGain)}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    )}
    </>
  );
}
