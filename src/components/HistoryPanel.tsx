// @ts-nocheck
import React, { useState, useMemo, useRef } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { formatCurrency, formatPercent, formatShortDate, calcPortfolioEvalDetail, resolveHoldings, buildCloseEvalSeries, externalFlowInRange, computeDailyMetricsSeries, computeEffectivePrincipal, resolveRecordPrincipal, overseasPrincipalAt, getClosestValue, cleanNum } from '../utils';
import { isKrCutoffAccount } from '../hooks/useMarketCalendar';
import VerifyEvalModal from './VerifyEvalModal';
import ErrorBoundary from './ErrorBoundary';

const formatUsd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));

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
  portfolioStartDate,
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

  // 해외계좌: 검증모달·통합대시보드와 동일 방식으로 USD·원화 재계산.
  //  USD = 해당일 보유종목 × 과거 종가, 원화 = USD × 날짜별 환율(getClosestValue(usdkrw) 이월, 없으면 라이브).
  //  저장된 evalAmount는 기록 시점 라이브 환율로 박제돼 있어, 같은 달러라도 환율 변동분이 누락된다.
  //  날짜별 환율로 재계산하면 주말 등 같은 달러·같은 이월환율 날짜가 동일 원화가 된다.
  const computeOverseasEval = useMemo(() => {
    if (activePortfolioAccountType !== 'overseas') return null;
    const liveFx = marketIndicators.usdkrw || 1;
    const mpo = activePortfolio?.manualPriceOverrides || {};
    return (date) => {
      const resolved = resolveHoldings(activePortfolio, date);
      const r = calcPortfolioEvalDetail(resolved.items, 'overseas', date, stockHistoryMap, indicatorHistoryMap || {}, liveFx, mpo);
      if (!r.hasAnyPrice) return null;
      const fx = r.fxRate || liveFx;
      return { usd: r.total / fx, krw: r.total };
    };
  }, [activePortfolioAccountType, activePortfolio, stockHistoryMap, indicatorHistoryMap, marketIndicators.usdkrw]);

  const overseasEvalByDate = useMemo(() => {
    if (!computeOverseasEval) return null;
    const m = new Map();
    sortedHistoryDesc.forEach(h => {
      if (h?.date && !m.has(h.date)) { const e = computeOverseasEval(h.date); if (e) m.set(h.date, e); }
    });
    return m;
  }, [computeOverseasEval, sortedHistoryDesc]);

  // 국내/gold 시장 계좌: 자산 평가액 추이를 '저장된 라이브 값'이 아니라 항상 '수량 × 종가'(확정 종가 기반)로 표시.
  //  - 과거 거래일 & 그날 종가 정확 로드(allExact) → 수량×종가 재계산값(검증 모달 '재계산 합계'와 동일).
  //  - 주말·공휴일·종가 미로드일 → 직전 '정확 종가 재계산값'을 이월(carry-forward) — carry-back 근사로 튀지 않게.
  //  - 오늘 → 종가 미확정 → 저장된 라이브 값 유지.
  //  - 추정 보유수량(스냅샷 없음)은 수량 불확실 → 그날은 저장값 폴백(잘못된 수량으로 재계산 방지).
  //  현금성(simple/matong)·해외는 제외(각자 기존 경로).
  const useCloseRecompute = !['overseas', 'simple', 'matong'].includes(activePortfolioAccountType);
  const displayEvalByDate = useMemo(() => {
    if (!useCloseRecompute || !activePortfolio) return null;
    return buildCloseEvalSeries(activePortfolio, sortedHistoryDesc.map(h => h?.date), activePortfolioAccountType, stockHistoryMap, indicatorHistoryMap, effectiveDateKey);
  }, [useCloseRecompute, activePortfolio, sortedHistoryDesc, activePortfolioAccountType, stockHistoryMap, indicatorHistoryMap, effectiveDateKey]);

  // 일간 지표(전일대비·일간 손익) — 통합 대시보드·CSV와 **같은 공용 함수**를 써야 화면이 어긋나지 않는다.
  // ⚠️ 행마다 독립 계산으로 되돌리지 말 것: 보류된 행(주말 원장 등)의 흐름을 다음 행으로 이월해야
  //    '입금액=수익' 버그가 하루 밀려 재발하지 않는다(computeDailyMetricsSeries가 그 역할).
  const dailyMetricsByDate = useMemo(() => {
    const asc = [...sortedHistoryDesc].reverse();
    const isOverseasAcc = activePortfolioAccountType === 'overseas';
    // 흐름 환산도 평가액과 같은 소스(날짜별 환율)를 쓴다 — 원장의 d.fxRate는 '행 생성 시점' 환율로
    // 박제되므로 소급 입력 시 V(날짜별 환율 재계산)와 어긋나 그날 가짜 손익이 남는다.
    const flowRate = isOverseasAcc
      ? (d) => (getClosestValue(indicatorHistoryMap?.usdkrw, d.date) || d.fxRate || marketIndicators.usdkrw || 1)
      : undefined;
    const evalOf = (h) => {
      const ov = isOverseasAcc && overseasEvalByDate ? overseasEvalByDate.get(h.date) : null;
      return ov ? ov.krw : (displayEvalByDate?.get(h.date) ?? h.evalAmount);
    };
    const rows = asc.map((h, i) => {
      const prev = asc[i - 1];
      const flow = prev
        ? externalFlowInRange(depositHistory, depositHistory2, prev.date, h.date, flowRate)
        : { in: 0, out: 0 };
      return { date: h.date, evalAmount: evalOf(h), flowIn: flow.in, flowOut: flow.out };
    });
    return computeDailyMetricsSeries(rows);
  }, [sortedHistoryDesc, activePortfolioAccountType, overseasEvalByDate, displayEvalByDate, depositHistory, depositHistory2, indicatorHistoryMap, marketIndicators.usdkrw]);

  // 누적(원금대비) 수익률·수익금 — "시작부터 통틀어 벌었나"에 답하는 값. 평가자산 셀 하단 2줄에 병기한다.
  // 3열의 일간 지표("오늘 장에서 벌었나")와 역할이 다르므로 같은 셀에 섞지 않는다.
  // ⚠️ 원금은 개별 계좌 차트('나의 수익률')와 **같은 공용 함수**로 구한다 — 원화 계좌는
  //    resolveRecordPrincipal, 해외 계좌는 overseasPrincipalAt(날짜별 원장 누적).
  //    행별 자체 계산으로 되돌리면 같은 날짜에 차트와 표가 서로 다른 누적 수익률을 표시한다
  //    (일간 지표의 computeDailyMetricsSeries 단일 소스 규약과 같은 이유).
  //    평가액도 이 표가 실제로 렌더하는 값(종가 재계산·해외 재계산)을 써야 %와 표시 금액이 맞는다.
  const cumulativeByDate = useMemo(() => {
    const asc = [...sortedHistoryDesc].reverse();
    const isOverseasAcc = activePortfolioAccountType === 'overseas';
    const m = new Map();
    // 해외계좌는 차트(App.tsx 해외 분기)와 동일하게 USD 기준 — 원금 필드도 평가도 USD라 환산하지 않는다.
    // 수익금도 USD − USD라 통화가 섞이지 않는다(표시만 $ 포맷). 원화 환산은 하지 않는다.
    // ⚠️ 원금은 principal 필드 평탄이 아니라 **날짜별 원장 누적**(overseasPrincipalAt 공용 함수)이다 —
    //    출금 시 principal 필드만 줄어들어, 평탄 적용하면 출금 이전 과거 행이 차트와 갈린다.
    const depAsc = isOverseasAcc ? [...(depositHistory || [])].sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
    const wdAsc = isOverseasAcc ? [...(depositHistory2 || [])].sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
    asc.forEach(h => {
      if (!h?.date) return;
      if (isOverseasAcc) {
        const usdPrin = overseasPrincipalAt(h.date, depAsc, wdAsc, principal, portfolioStartDate);
        const ov = overseasEvalByDate?.get(h.date);
        if (!ov || !(usdPrin > 0)) return;
        m.set(h.date, { rate: (ov.usd - usdPrin) / usdPrin * 100, profit: ov.usd - usdPrin, principal: usdPrin, eval: ov.usd });
        return;
      }
      const eff = computeEffectivePrincipal(h.date, asc, depositHistory, depositHistory2, false);
      const prin = resolveRecordPrincipal(eff.value, h, h.date, asc, principal);
      const v = displayEvalByDate?.get(h.date) ?? h.evalAmount;
      if (!(prin > 0) || v == null) return;
      m.set(h.date, { rate: (v - prin) / prin * 100, profit: v - prin, principal: prin, eval: v });
    });
    return m;
  }, [sortedHistoryDesc, activePortfolioAccountType, overseasEvalByDate, displayEvalByDate, depositHistory, depositHistory2, principal, portfolioStartDate]);

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
                  <col className="w-[30%]" />
                  <col className="w-[35%]" />
                  <col className="w-[35%]" />
                </colgroup>
                <thead className="sticky top-0 bg-gray-800 text-gray-400 border-b border-gray-600 shadow-sm z-10">
                  <tr>
                    <th className="py-1.5 px-1.5 text-center border-r border-gray-600 font-normal">일자</th>
                    <th className="py-1.5 px-1.5 text-center border-r border-gray-600 font-normal cursor-help" title="첫줄: 그날의 총평가액 (수량 × 그날 종가로 재계산)
둘째줄: 투자원금 대비 누적 수익률 = (평가자산 − 투자원금) ÷ 투자원금
셋째줄: 누적 수익금 = 평가자산 − 투자원금
시작부터 지금까지 통틀어 벌었는지를 보는 값입니다(투자 요약 패널·수익률 차트와 동일 기준).">평가자산
누적 수익률 · 수익금</th>
                    <th className="py-1.5 px-1 text-center font-normal cursor-help" title="그날 하루 시장에서 얼마를 벌었는가 (전일 종가 → 당일 종가)
윗줄 %  = 일간 수익금 ÷ 그날의 시작 자산(전일 평가자산 + 당일 입금)
아랫줄 ₩ = 일간 수익금 = 당일 평가자산 − 전일 평가자산 − 당일 순입출금
입출금이 없던 날은 (당일 − 전일) ÷ 전일 과 정확히 같습니다.
입출금이 있던 날은 그 금액을 빼므로, 입금해도 수익으로 잡히지 않습니다.">일간 수익률 · 수익금</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHistoryDesc.map((h, i) => {
                    const isOverseasAcc = activePortfolioAccountType === 'overseas';
                    const ov = isOverseasAcc && overseasEvalByDate ? overseasEvalByDate.get(h.date) : null;
                    const curKrw = ov ? ov.krw : (displayEvalByDate?.get(h.date) ?? h.evalAmount);
                    // ⚠️ 여기서 전일대비를 다시 계산하지 말 것 — dailyMetricsByDate(공용 함수)가 단일
                    //    소스다. 행별 재계산으로 되돌리면 보류 행의 흐름 이월이 깨져 통합 뷰와 갈라진다.
                    const m = dailyMetricsByDate.get(h.date) || { dodChange: 0, dodAbsChange: null, ledgerFlow: 0 };
                    const dod = m.dodChange;
                    const dodProfit = m.dodAbsChange;
                    const flowNet = m.ledgerFlow || 0;
                    const cum = cumulativeByDate.get(h.date) || null;
                    const hasPrev = i < sortedHistoryDesc.length - 1;
                    // 해외계좌는 누적을 USD 기준으로 내므로(원금·평가 모두 USD) 금액 표기도 $로 맞춘다.
                    const fmtAmount = isOverseasAcc ? formatUsd : formatCurrency;
                    const cumTitle = cum != null
                      ? `투자원금 ${fmtAmount(cum.principal)} · 평가자산 ${fmtAmount(cum.eval)}\n누적 수익금 = 평가자산 − 투자원금`
                      // ⚠️ 원인을 '투자원금 0'으로 단정하지 말 것 — cumulativeByDate가 항목을 비우는
                      //    경로는 원금 0 외에 '그날 종가 미로드'(해외 !ov)도 있어 오진단이 된다.
                      : '투자원금 또는 그날의 평가자산을 확정하지 못해 누적 수익률을 낼 수 없습니다.';
                    // 일간 수익률·수익금 셀 툴팁 — 사용자의 정의("어제 종가를 오늘의 시작 금액으로 보고,
                    // 오늘 종가와 비교해 얼마 벌었나")를 그대로 풀어 쓴다. 입출금이 있으면 그 금액은
                    // 수익이 아니라 '시작 자산'에 더해진다는 점을 명시(그게 이 지표의 유일한 보정).
                    const dodTitle = dodProfit != null
                      ? [
                          `일간 손익 ${formatCurrency(dodProfit)}`,
                          flowNet !== 0
                            ? `${flowNet > 0 ? '입금' : '출금'} ${formatCurrency(Math.abs(flowNet))}은 수익이 아니라 시작 자산에 반영됨`
                            : '입출금이 없던 날 — (당일 − 전일) ÷ 전일 과 동일',
                        ].join('\n')
                      : (hasPrev ? '입출금 기록과 평가 스냅샷이 어긋나 산출을 보류했습니다(다음 기록일에 합산).' : '');
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
                        <td className="py-1.5 px-1.5 border-r border-gray-600 font-bold text-right text-white" title={cumTitle}>
                          <div className="flex items-center justify-end gap-1">
                            <span>
                              {isOverseasAcc
                                ? (() => {
                                    const usd = ov ? ov.usd : h.evalAmount / (marketIndicators.usdkrw || 1);
                                    return <div className="flex flex-col items-end leading-tight"><span>{formatUsd(usd)}</span><span className="text-[10px] text-gray-500">{formatCurrency(curKrw)}</span></div>;
                                  })()
                                : formatCurrency(curKrw)}
                            </span>
                          </div>
                          {/* 누적(원금대비) 수익률·수익금 — 평가자산 바로 아래 병기.
                              "시작부터 통틀어 벌었나"에 답하는 값이라, 옆 칸의 '오늘 하루' 지표와 역할이 다르다.
                              ⚠️ 자체 계산 금지 — cumulativeByDate(resolveRecordPrincipal / 해외는
                                 overseasPrincipalAt)가 단일 소스이며 차트 '나의 수익률'·요약 카드와 같아야 한다. */}
                          {cum != null && (
                            <span className={`block text-[10px] font-bold leading-tight mt-0.5 whitespace-nowrap ${cum.rate > 0 ? 'text-red-400' : cum.rate < 0 ? 'text-blue-400' : 'text-gray-500'}`}>
                              {cum.rate > 0 ? '+' : ''}{formatPercent(cum.rate)}
                            </span>
                          )}
                          {cum != null && cum.profit != null && cum.profit !== 0 && (
                            <span className={`block text-[9px] font-bold leading-tight whitespace-nowrap ${cum.profit > 0 ? 'text-red-300/80' : 'text-blue-300/80'}`}>
                              {cum.profit > 0 ? '+' : '−'}{fmtAmount(Math.abs(cum.profit))}
                            </span>
                          )}
                          {h.isAdjusted && <span className="block text-[9px] font-normal leading-none mt-0.5 text-blue-400">조정됨</span>}
                        </td>
                        {/* 일간 수익률 · 수익금 — "그날 하루 시장에서 얼마 벌었나"(전일 종가 → 당일 종가).
                            사용자 정의: 어제의 평가금 총액이 오늘의 시작 금액. 입출금이 없던 날은
                            (당일 − 전일) ÷ 전일 과 정확히 같고, 있던 날만 그 금액이 시작 자산으로 빠진다.
                            ⚠️ 여기서 전일대비를 다시 계산하지 말 것 — dailyMetricsByDate(공용 함수)가 단일
                               소스다. 행별 재계산으로 되돌리면 보류 행의 흐름 이월이 깨져 통합 뷰와 갈라진다. */}
                        <td className="py-1.5 px-1 text-center font-bold" title={dodTitle}>
                          {/* 보류는 '변동 없음(0.00%)'이 아니라 '산출 불가' — 통합 추이표와 같은 규약 */}
                          {dodProfit == null
                            ? <span className="text-gray-600">-</span>
                            : <span className={dod > 0 ? 'text-red-400' : dod < 0 ? 'text-blue-400' : 'text-gray-500'}>{formatPercent(dod)}</span>}
                          {/* 일간 손익(₩) — "얼마 벌었나"는 %보다 금액이 직관적이다. */}
                          {dodProfit != null && dodProfit !== 0 && (
                            <span className={`block text-[9px] font-bold leading-none mt-0.5 whitespace-nowrap ${dodProfit > 0 ? 'text-red-300/80' : 'text-blue-300/80'}`}>
                              {dodProfit > 0 ? '+' : '−'}{formatCurrency(Math.abs(dodProfit))}
                            </span>
                          )}
                        </td>
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
                    isKrCutoffAccount(activePortfolioAccountType)
                    ? { icon: '🕘', color: 'text-sky-300', title: '기록 시점 (국내 계좌 — KST 21:00 확정)', lines: [
                      '당일 평가자산이 당일 21:00에 확정됩니다.',
                      '기록은 개장(09:00)부터 21:00까지 실시간으로 갱신됩니다.',
                      '21:00 이후·개장 전에는 기록이 일시 중지되며,',
                      '접속하지 못한 날은 종가 기준으로 자동 보완됩니다.',
                    ] }
                    : { icon: '🕖', color: 'text-sky-300', title: '기록 시점 (KST 익일 07:30 확정)', lines: [
                      '매일 전일 종가가 확정되면 평가자산이 기록됩니다.',
                      `07:30 이전 접속: 전날(${effectiveDateKey || ''}) 날짜로 기록됩니다.`,
                      '07:30 이후 접속: 오늘 날짜로 새 기록이 생성됩니다.',
                      '전일 종가 확정 후 해당 기록은 고정(isFixed)되어 변경되지 않습니다.',
                    ] },
                    { icon: '％', color: 'text-blue-300', title: '일간 수익률 · 수익금 (그날 하루)', lines: [
                      '"어제 종가를 오늘의 시작 금액으로 보고, 오늘 종가까지 얼마 벌었나"입니다.',
                      '아랫줄 금액 — 당일 평가자산 − 전일 평가자산 − 당일 순입출금.',
                      '윗줄 % — 그 금액 ÷ 그날의 시작 자산(전일 평가자산 + 당일 입금).',
                      '입출금이 없던 날은 (당일 − 전일) ÷ 전일 과 정확히 같습니다.',
                      '입출금이 있던 날은 그 돈이 수익이 아니라 시작 자산으로 들어갑니다',
                      '(입금해도 수익률이 뛰지 않습니다).',
                      "'-' 는 변동 없음이 아니라 '산출 보류'입니다(입출금이 아직 평가액에 반영 안 된 날).",
                      '보류된 금액은 사라지지 않고 다음 기록일에 합산됩니다.',
                      '빨강 = 상승 · 파랑 = 하락 · 회색 = 변동 없음.',
                    ] },
                    { icon: '∑', color: 'text-emerald-300', title: '누적 수익률 · 수익금 (투자원금 대비)', lines: [
                      '평가자산 아래 두 줄 — 시작부터 지금까지 통틀어 벌었는지를 봅니다.',
                      '수식: (평가자산 − 투자원금) ÷ 투자원금, 금액 = 평가자산 − 투자원금.',
                      '투자 요약 패널의 수익률·수익률 차트(투자원금 기준)와 같은 기준입니다.',
                      '입금을 하면 원금이 함께 늘어나므로 %는 희석됩니다(입금 자체는 수익이 아님).',
                      '옆 칸(전일)이 "오늘 장", 이 값이 "통산 성적"이라 함께 봐야 합니다.',
                      '빨강 = 이익 · 파랑 = 손실 · 회색 = 손익 없음(0.00%).',
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
