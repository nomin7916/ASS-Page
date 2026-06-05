// @ts-nocheck
import React, { useState, useMemo, useRef } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { formatCurrency, formatPercent, formatShortDate, cleanNum, getClosestValue } from '../utils';
import VerifyEvalModal from './VerifyEvalModal';
import ErrorBoundary from './ErrorBoundary';

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
  refreshPrices,
  isLoading,
  depositHistory,
  depositHistory2,
  refetchStockHistory,
}) {
  const [verifyRecord, setVerifyRecord] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPos, setHelpPos] = useState({ x: 0, y: 0 });
  const helpDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });

  const openHelp = () => {
    setHelpPos({ x: Math.max(8, window.innerWidth / 2 - 160), y: Math.max(8, window.innerHeight / 2 - 240) });
    setHelpOpen(true);
  };

  const handleHelpDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    helpDrag.current = { active: true, offsetX: e.clientX - helpPos.x, offsetY: e.clientY - helpPos.y };
    const onMove = (e) => {
      if (!helpDrag.current.active) return;
      setHelpPos({ x: e.clientX - helpDrag.current.offsetX, y: e.clientY - helpDrag.current.offsetY });
    };
    const onUp = () => {
      helpDrag.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // 사용자가 직접 수정한 날짜 집합: manual 스냅샷(종목 추가/삭제/수량변경) + 수동 종가 입력.
  // kind 'auto'/'baseline'은 시스템 자동 생성이므로 제외.
  const userModifiedDates = useMemo(() => {
    const set = new Set();
    const snaps = activePortfolio?.holdingSnapshots || [];
    snaps.forEach(s => { if (s?.kind === 'manual' && s?.date) set.add(s.date); });
    const mpo = activePortfolio?.manualPriceOverrides || {};
    Object.values(mpo).forEach(byDate => {
      Object.keys(byDate || {}).forEach(d => set.add(d));
    });
    return set;
  }, [activePortfolio]);

  // 해외계좌: 차트와 동일한 방식으로 USD 평가액 계산 (stockHistoryMap × 현재보유수량)
  const computeOverseasUsd = useMemo(() => {
    if (activePortfolioAccountType !== 'overseas') return null;
    const holdings = activePortfolio?.portfolio ?? [];
    return (date) => {
      let usd = 0, hasData = false;
      for (const item of holdings) {
        if (item.type === 'deposit') {
          usd += cleanNum(item.depositAmount);
          hasData = true;
        } else if (item.code && stockHistoryMap?.[item.code]) {
          const p = getClosestValue(stockHistoryMap[item.code], date);
          if (p != null) { usd += p * item.quantity; hasData = true; }
        }
      }
      return hasData ? usd : null;
    };
  }, [activePortfolioAccountType, activePortfolio, stockHistoryMap]);

  return (
        <>
          <div className={`w-full xl:w-[21%] bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg ${activePortfolioAccountType === 'overseas' ? 'h-[520px]' : 'h-[360px]'} flex flex-col overflow-hidden shrink-0`}>
            <div className="p-4 bg-[#0f172a] text-white font-bold flex items-center justify-between text-sm border-b border-gray-700 shrink-0">
              <button
                onClick={() => refreshPrices({ force: true })}
                disabled={isLoading}
                className="flex items-center gap-1.5 hover:text-sky-300 transition-colors disabled:opacity-60"
                title="전체 강제 재수집 — 모든 필터 우회, 전 계좌 모든 종목의 과거 이력을 KIS·Naver·NAV API로 무조건 다시 조회"
              >
                <span>📈 자산 평가액 추이</span>
                {isLoading && <span className="inline-block animate-spin text-sky-400 text-base leading-none">↻</span>}
              </button>
              <button onClick={openHelp} className="text-gray-500 hover:text-sky-400 transition-colors" title="사용법 보기"><HelpCircle size={14} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
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
                    const isToday = h.date === effectiveDateKey;
                    const isUserModified = h.isAdjusted || userModifiedDates.has(h.date);

                    return (
                      <tr key={h.id || i} className={`border-b border-gray-700 ${isToday ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}`}>
                        <td className={`py-1.5 px-1.5 text-center border-r border-gray-600 font-bold ${isUserModified ? 'text-sky-300' : 'text-gray-300'}`}>
                          <button
                            className="hover:text-sky-300 hover:underline transition-colors cursor-pointer"
                            title="클릭: 보유종목·종가 검증/편집"
                            onClick={() => setVerifyRecord(h)}
                          >
                            {formatShortDate(h.date)}
                          </button>
                        </td>
                        <td className="py-1.5 px-1.5 border-r border-gray-600 font-bold text-right text-white">
                          <div className="flex items-center justify-end gap-1">
                            <span>
                              {activePortfolioAccountType === 'overseas'
                                ? (() => {
                                    const usd = computeOverseasUsd ? computeOverseasUsd(h.date) : null;
                                    const usdDisplay = usd != null
                                      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd)
                                      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(h.evalAmount / (marketIndicators.usdkrw || 1));
                                    return <div className="flex flex-col items-end leading-tight"><span>{usdDisplay}</span><span className="text-[10px] text-gray-500">{formatCurrency(h.evalAmount)}</span></div>;
                                  })()
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
            <ErrorBoundary label="자산검증">
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
                depositHistory={depositHistory}
                depositHistory2={depositHistory2}
                history={history}
                refetchStockHistory={refetchStockHistory}
              />
            </ErrorBoundary>
          )}
          {helpOpen && (
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setHelpOpen(false)}>
              <div className="absolute w-[320px] shadow-2xl overflow-hidden" style={{ left: helpPos.x, top: helpPos.y }} onClick={e => e.stopPropagation()}>
                <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none" onMouseDown={handleHelpDragStart}>
                  <button onClick={() => setHelpOpen(false)} className="w-3 h-3 rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all" title="닫기"><X size={7} className="text-white" /></button>
                  <span className="text-[11px] font-bold tracking-[0.18em] bg-gradient-to-r from-sky-400 via-blue-400 to-purple-400 bg-clip-text text-transparent select-none">자산 평가액 추이 안내</span>
                  <div className="w-3" />
                </div>
                <div className="overflow-y-auto max-h-[75vh]" style={{
                  backgroundColor: '#000',
                  backgroundImage: 'repeating-linear-gradient(transparent 0px, transparent 23px, rgba(99,130,255,0.25) 23px, rgba(99,130,255,0.25) 24px)',
                  backgroundSize: '100% 24px',
                  backgroundPosition: '0 8px',
                  lineHeight: '24px',
                  padding: '8px 12px',
                }}>
                  {[
                    { icon: '🕖', color: 'text-sky-300', title: '기록 시점 (KST 07:30 기준)', lines: [
                      '매일 전일 종가가 확정되면 평가자산이 기록됩니다.',
                      `07:30 이전 접속: 전날(${effectiveDateKey || ''}) 날짜로 기록됩니다.`,
                      '07:30 이후 접속: 오늘 날짜로 새 기록이 생성됩니다.',
                      '전일 종가 확정 후 해당 기록은 고정(isFixed)되어 변경되지 않습니다.',
                    ] },
                    { icon: '％', color: 'text-blue-300', title: '전일대비', lines: [
                      '수식: (당일 평가자산 ÷ 전일 평가자산) − 1',
                      '빨강 = 상승 · 파랑 = 하락 · 회색 = 변동 없음.',
                    ] },
                    { icon: '🎨', color: 'text-sky-300', title: '일자 색상', lines: [
                      '회색: 시스템이 자동 생성한 기록입니다.',
                      '하늘색: 사용자가 직접 수정한 날짜입니다.',
                      '(종목 추가·삭제·수량 변경 또는 종가 수동 입력)',
                    ] },
                    { icon: '✏', color: 'text-gray-300', title: '기록 검증·편집', lines: [
                      '일자를 클릭하면 해당일의 보유종목·종가를 검증/편집할 수 있습니다.',
                      '값을 보정하면 평가자산이 재계산됩니다.',
                    ] },
                    { icon: '🔵', color: 'text-blue-400', title: "'조정됨' 표시", lines: [
                      '평가자산이 수동으로 조정된 기록에 표시됩니다.',
                      '자동 기록과 구분하기 위한 표식입니다.',
                    ] },
                  ].map(({ icon, color, title, lines }) => (
                    <div key={title} className="mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`${color} font-bold text-[11px] w-4 text-center shrink-0`}>{icon}</span>
                        <span className="text-white font-bold text-[11px]">{title}</span>
                      </div>
                      {lines.map((line, i) => (
                        <div key={i} className="flex items-start gap-1.5 pl-1">
                          <span className="text-gray-600 text-[10px] shrink-0 mt-0.5">·</span>
                          <span className="text-[10px] leading-6 text-gray-400">{line}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="mt-2 pt-1 border-t border-gray-800">
                    <p className="text-[9px] text-gray-600 leading-5">기록은 Google Drive에 자동 백업됩니다.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
  );
}
