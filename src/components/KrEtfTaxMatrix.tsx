// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, RotateCcw, ExternalLink } from 'lucide-react';
import { generateId, cleanNum, formatCurrency, resolveHoldings } from '../utils';
import {
  getKrEtfStocks,
  getCodeTaxBase,
  safeNum,
  computeMonthlyAvgForGrid,
  computeMonthlyQtyForGrid,
} from '../krEtfTaxHelpers';
const FUNETF_ORIGIN = 'https://www.funetf.co.kr';

function tickerToIsin(ticker) {
  const base = 'KR7' + ticker.toUpperCase() + '00';
  const digits = [];
  for (const c of base) {
    if (c >= '0' && c <= '9') digits.push(parseInt(c, 10));
    else if (c >= 'A' && c <= 'Z') { const v = c.charCodeAt(0) - 65 + 10; digits.push(Math.floor(v / 10), v % 10); }
  }
  digits.push(0);
  let sum = 0;
  const len = digits.length;
  for (let i = len - 1; i >= 0; i--) {
    let d = digits[i];
    if ((len - i) % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return base + String((10 - (sum % 10)) % 10);
}

const funetfEtfUrl = (code) => `${FUNETF_ORIGIN}/product/etf/view/${tickerToIsin(code)}`;

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const CURRENT_YEAR = new Date().getFullYear().toString();

const numInputCls = 'w-full bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-1 py-0.5 text-[10px] text-gray-100 outline-none tabular-nums text-right';
const exInputCls = 'w-full bg-gray-900/60 border border-gray-700 focus:border-amber-500 rounded px-1 py-0.5 text-[10px] text-amber-300 outline-none tabular-nums text-right';
const avgInputCls = 'w-full bg-gray-900/60 border border-gray-700 focus:border-sky-400 rounded px-1 py-0.5 text-[10px] text-sky-200 outline-none tabular-nums text-right';

const fmtTaxBase = (v) => {
  const n = safeNum(v);
  if (!n) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function KrEtfTaxMatrix({
  portfolio,
  updateTaxBaseEvents,
  updateTaxBasePurchases,
  updateTaxBaseSales,
  updateTaxBaseExPrice,
  updateTaxBaseAvgPrice,
  notify,
}) {
  const [expandedCode, setExpandedCode] = useState(null);

  const krStocks = useMemo(() => getKrEtfStocks(portfolio), [portfolio?.portfolio]);

  if (!portfolio) return null;

  if (krStocks.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-gray-500">
        한국 ETF 종목이 없습니다. 종목을 추가하면 과표 계산을 사용할 수 있습니다.
      </div>
    );
  }

  const monthYms = MONTHS.map((_, i) => `${CURRENT_YEAR}-${String(i + 1).padStart(2, '0')}`);

  // 자산검증 스냅샷에서 전일 수량 조회
  const lookupPrevQty = (date, stockCode) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    const prevDate = d.toISOString().slice(0, 10);
    const { items } = resolveHoldings(portfolio, prevDate);
    const item = (items || []).find(i => i.code === stockCode);
    return item ? safeNum(item.quantity) : 0;
  };

  // 이벤트 목록에서 날짜순 정렬 + 누적 평균 과표 계산
  const buildSortedEventsWithAvg = (events) => {
    const valid = (events || [])
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')))
      .sort((a, b) => a.date.localeCompare(b.date));
    let runQty = 0, runAvg = 0;
    const withAvg = valid.map(evt => {
      const change = safeNum(evt.change);
      if (change > 0) {
        const newQty = runQty + change;
        runAvg = newQty > 0 ? (runQty * runAvg + change * safeNum(evt.taxBasePrice)) / newQty : 0;
        runQty = newQty;
      } else if (change < 0) {
        runQty = Math.max(0, runQty + change);
      }
      return { evt, runningAvg: runAvg, runningQty: runQty };
    });
    // 날짜 미입력 이벤트는 뒤에 추가
    const invalid = (events || []).filter(e => !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')));
    return [...withAvg, ...invalid.map(evt => ({ evt, runningAvg: 0, runningQty: 0 }))];
  };

  const stockRows = krStocks.map(stock => {
    const { events, purchases, sales, exTaxBase, avgTaxBase } = getCodeTaxBase(portfolio, stock.code);
    const computedAvg = computeMonthlyAvgForGrid(events, monthYms);
    const computedQtyMap = computeMonthlyQtyForGrid(events, monthYms);
    const hasQtyEvents = Object.keys(computedQtyMap).length > 0;
    const sortedEventsWithAvg = buildSortedEventsWithAvg(events);
    // 매수 요약: 매입단가>0 인 매수 이벤트 기준 매수일·총 매수수량·총 매입금액·평균 매입단가
    const buyEvts = (events || [])
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) && safeNum(e.change) > 0 && safeNum(e.purchasePrice) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const buyQtyTotal = buyEvts.reduce((s, e) => s + safeNum(e.change), 0);
    const buyAmountTotal = buyEvts.reduce((s, e) => s + safeNum(e.change) * safeNum(e.purchasePrice), 0);
    const buySummary = {
      count: buyEvts.length,
      firstDate: buyEvts[0]?.date || '',
      lastDate: buyEvts[buyEvts.length - 1]?.date || '',
      qtyTotal: buyQtyTotal,
      amountTotal: buyAmountTotal,
      avgPrice: buyQtyTotal > 0 ? buyAmountTotal / buyQtyTotal : 0,
    };
    const currentQty = cleanNum(stock.quantity || 0);
    const monthData = monthYms.map(ym => {
      const exVal = exTaxBase[ym];
      const manualAvgVal = avgTaxBase[ym] !== undefined ? avgTaxBase[ym] : undefined;
      const computedAvgVal = computedAvg[ym];
      const avgVal = manualAvgVal !== undefined ? manualAvgVal : computedAvgVal;
      const exNum = safeNum(exVal);
      const avgNum = safeNum(avgVal);
      const taxBasePerShare = exNum - avgNum;
      const monthQty = hasQtyEvents ? (computedQtyMap[ym] ?? 0) : currentQty;
      const expected = Math.max(0, taxBasePerShare) * monthQty;
      return { ym, exVal, manualAvgVal, computedAvgVal, avgVal, exNum, avgNum, taxBasePerShare, expected, monthQty };
    });
    const annualExpected = monthData.reduce((s, d) => s + d.expected, 0);
    return { stock, events, sortedEventsWithAvg, buySummary, purchases, sales, currentQty, monthData, annualExpected };
  });

  const monthlyExpected = monthYms.map((_, i) =>
    stockRows.reduce((s, r) => s + (r.monthData[i].expected || 0), 0),
  );
  const grandExpected = monthlyExpected.reduce((s, v) => s + v, 0);

  // ── 이벤트 CRUD ─────────────────────────────────────────────────────────────
  const persistEvents = (code, next) => updateTaxBaseEvents(portfolio.id, code, next);

  const addEvent = (code, events) => persistEvents(code, [
    ...events,
    { id: generateId(), date: new Date().toISOString().slice(0, 10), prevQty: 0, change: 0, taxBasePrice: 0 },
  ]);

  const updateEvent = (code, events, id, field, value) => persistEvents(code, events.map(e =>
    e.id !== id ? e : { ...e, [field]: field === 'date' ? String(value) : value },
  ));

  const deleteEvent = (code, events, id) => persistEvents(code, events.filter(e => e.id !== id));

  const handleEventDateChange = (stock, events, id, newDate) => {
    const updates = { date: newDate };
    if (/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      updates.prevQty = lookupPrevQty(newDate, stock.code);
    }
    persistEvents(stock.code, events.map(e => e.id !== id ? e : { ...e, ...updates }));
  };

  const refetchPrevQty = (stock, events, evt) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(evt.date || ''))) return;
    const prevQty = lookupPrevQty(evt.date, stock.code);
    persistEvents(stock.code, events.map(e => e.id !== evt.id ? e : { ...e, prevQty }));
  };

  return (
    <div className="overflow-x-auto">
      <div className="px-3 py-2 bg-[#0f172a]/60 border-b border-gray-700/50 flex items-center gap-3 flex-wrap text-[10px]">
        <span className="text-gray-500">{CURRENT_YEAR}년 · 과세 과표 = 배당 과표 − 평균 과표 · 예상 과세 = max(0, 과세과표) × 보유주식수</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-500">연간 예상 과세 합계</span>
        <span className="text-emerald-400 font-semibold tabular-nums">{formatCurrency(grandExpected)}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-gray-600">종목명 클릭 → 평균 과표 계산기</span>
        </span>
      </div>
      <table className="w-full text-[11px] text-center">
        <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
          <tr>
            <th className="py-2 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[170px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">종목</th>
            {MONTHS.map(m => (
              <th key={m} className="py-2 px-1 min-w-[128px] font-normal">{m}</th>
            ))}
            <th className="py-2 px-2 min-w-[96px] text-yellow-500 font-bold">연합계</th>
          </tr>
        </thead>
        <tbody>
          {stockRows.map(({ stock, events, sortedEventsWithAvg, buySummary, purchases, sales, currentQty, monthData, annualExpected }) => {
            const isExpanded = expandedCode === stock.code;
            return (
              <React.Fragment key={stock.code}>
                <tr className="border-b border-gray-700/40 hover:bg-gray-800/20">
                  <td className="py-2 px-3 text-left sticky left-0 z-10 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                    <div className="mb-1 flex items-center gap-1 flex-wrap">
                      <a
                        href={funetfEtfUrl(stock.code)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-2 py-0.5 rounded border border-gray-700/60 text-gray-400 hover:text-gray-200 hover:border-gray-500 hover:bg-gray-800/40 inline-flex items-center gap-1 transition"
                        title={`FunETF 상세 페이지 — ${stock.name || stock.code}`}
                      >
                        <ExternalLink size={10} /> FunETF
                      </a>
                    </div>
                    <button
                      onClick={() => setExpandedCode(isExpanded ? null : stock.code)}
                      className="flex items-start gap-1.5 text-left w-full hover:text-amber-300"
                    >
                      {isExpanded
                        ? <ChevronDown size={12} className="text-amber-400 mt-0.5 shrink-0" />
                        : <ChevronRight size={12} className="text-gray-500 mt-0.5 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-gray-100 font-medium truncate">{stock.name || stock.code}</div>
                        <div className="text-[9px] text-gray-500 tabular-nums">
                          {stock.code} · 보유 {currentQty.toLocaleString()}주
                          {events.length > 0 && (
                            <span className="text-sky-400/70 ml-1">· 이벤트 {events.length}건</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </td>
                  {monthData.map(d => (
                    <td key={d.ym} className="py-1 px-1 align-top">
                      <div className="space-y-0.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={d.exVal ?? ''}
                          onChange={e => updateTaxBaseExPrice(portfolio.id, stock.code, d.ym, e.target.value)}
                          placeholder="배당 과표"
                          className={exInputCls}
                          title="배당락일 과표기준가 (1주당)"
                        />
                        <div className="text-[9px] text-gray-500 tabular-nums text-right px-0.5" title="해당 월 말 기준 보유 주식수">
                          보유 {d.monthQty.toLocaleString()}주
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              d.manualAvgVal !== undefined
                                ? d.manualAvgVal
                                : (d.computedAvgVal ? fmtTaxBase(d.computedAvgVal) : '')
                            }
                            onChange={e => {
                              const val = e.target.value;
                              updateTaxBaseAvgPrice(portfolio.id, stock.code, d.ym, val === '' ? null : val);
                            }}
                            placeholder={d.computedAvgVal ? '자동' : '평균 과표'}
                            className={
                              avgInputCls +
                              (d.manualAvgVal === undefined && d.computedAvgVal ? ' opacity-60' : '')
                            }
                            title={
                              d.manualAvgVal === undefined && d.computedAvgVal
                                ? '이벤트 기반 자동 계산 (수정하면 수동 저장, 빈칸으로 되돌리기)'
                                : '평균 과표 (수동 입력)'
                            }
                          />
                        </div>
                        {d.manualAvgVal === undefined && d.computedAvgVal ? (
                          <div className="text-[8px] text-sky-500/50 text-right px-0.5">자동</div>
                        ) : d.manualAvgVal !== undefined && d.computedAvgVal ? (
                          <button
                            onClick={() => updateTaxBaseAvgPrice(portfolio.id, stock.code, d.ym, null)}
                            className="text-[8px] text-sky-500/60 hover:text-sky-400 text-right px-0.5 block w-full"
                            title="이벤트 기반 자동 계산값으로 되돌리기"
                          >↺ 자동</button>
                        ) : null}
                        <div className="text-[9px] text-sky-300 tabular-nums text-right px-0.5" title="과세 과표 = 배당 과표 − 평균 과표 (1주당)">
                          과세 {fmtTaxBase(d.taxBasePerShare)}
                        </div>
                        <div className="text-[10px] text-emerald-400 tabular-nums text-right px-0.5 font-medium" title="예상 과세 = max(0, 과세 과표) × 보유 주식수">
                          예상 {formatCurrency(d.expected)}
                        </div>
                      </div>
                    </td>
                  ))}
                  <td className="py-1 px-2 text-center tabular-nums align-top">
                    <div className="text-[11px] text-emerald-400 font-semibold">{annualExpected > 0 ? formatCurrency(annualExpected) : '-'}</div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-[#0b1322] border-b border-gray-700/40">
                    <td colSpan={MONTHS.length + 2} className="px-4 py-3">
                      <div className="border border-gray-700/60 rounded-lg bg-gray-900/40">
                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800">
                          <span className="text-[11px] font-semibold text-gray-200">평균 과표 계산기</span>
                          <span className="text-[10px] text-gray-500">{events.length}건</span>
                          <button
                            onClick={() => addEvent(stock.code, events)}
                            className="text-[10px] px-2 py-0.5 rounded border border-blue-700/60 text-blue-400 hover:text-blue-300 hover:border-blue-500 inline-flex items-center gap-1"
                          >
                            <Plus size={10} /> 행 추가
                          </button>
                        </div>
                        {events.length === 0 ? (
                          <div className="text-[10px] text-gray-600 text-center py-4">
                            이벤트가 없습니다. '행 추가'로 매입/매도를 입력하세요.
                          </div>
                        ) : (
                          <div>
                            <table className="text-[10px] border-collapse">
                              <thead className="text-gray-500 border-b border-gray-700/50">
                                <tr>
                                  <th className="text-left py-1 pl-2 pr-1 font-normal w-[108px]">일자</th>
                                  <th className="text-right py-1 px-1 font-normal w-[84px]">
                                    전일 수량
                                    <span className="text-gray-600 font-normal ml-0.5" title="자산검증 전일 수량 자동 조회">↺</span>
                                  </th>
                                  <th className="text-right py-1 px-1 font-normal w-[68px]">매도/매수</th>
                                  <th className="text-right py-1 px-1 font-normal w-[84px] text-orange-400/70">매입단가</th>
                                  <th className="text-right py-1 px-1 font-normal w-[64px]">조정 수량</th>
                                  <th className="text-right py-1 px-1 font-normal w-[88px]">과표기준가</th>
                                  <th className="text-right py-1 px-1 font-normal w-[80px]">평균 과표</th>
                                  <th className="py-1 px-1 w-[20px]"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortedEventsWithAvg.map(({ evt, runningAvg }) => {
                                  const prevQtyNum = safeNum(evt.prevQty);
                                  const changeNum = safeNum(evt.change);
                                  const adjustedQty = prevQtyNum + changeNum;
                                  const isSell = changeNum < 0;
                                  const isBuy = changeNum > 0;
                                  return (
                                    <tr key={evt.id} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/10">
                                      <td className="py-1 pl-2 pr-0.5">
                                        <input
                                          type="date"
                                          value={evt.date || ''}
                                          onChange={e => handleEventDateChange(stock, events, evt.id, e.target.value)}
                                          className="bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-1 py-0.5 text-[10px] text-gray-100 outline-none w-[100px]"
                                        />
                                      </td>
                                      <td className="py-1 px-1">
                                        <div className="flex items-center gap-0.5">
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={evt.prevQty !== undefined && evt.prevQty !== null && evt.prevQty !== '' ? evt.prevQty : ''}
                                            onChange={e => updateEvent(stock.code, events, evt.id, 'prevQty', e.target.value)}
                                            placeholder="0"
                                            className={numInputCls + ' flex-1 min-w-0'}
                                            title="전일 보유 수량 (직접 입력 가능)"
                                          />
                                          <button
                                            onClick={() => refetchPrevQty(stock, events, evt)}
                                            className="text-gray-600 hover:text-sky-400 p-0.5 rounded shrink-0 transition"
                                            title="자산검증에서 전일 수량 재조회"
                                          ><RotateCcw size={9} /></button>
                                        </div>
                                      </td>
                                      <td className="py-1 px-1">
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={evt.change !== undefined && evt.change !== '' ? evt.change : ''}
                                          onChange={e => updateEvent(stock.code, events, evt.id, 'change', e.target.value)}
                                          placeholder="0"
                                          className={numInputCls + (isSell ? ' !text-rose-400' : isBuy ? ' !text-emerald-400' : '')}
                                          title="매수=양수, 매도=음수"
                                        />
                                      </td>
                                      <td className="py-1 px-1">
                                        {isBuy ? (
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={evt.purchasePrice !== undefined && evt.purchasePrice !== '' ? evt.purchasePrice : ''}
                                            onChange={e => updateEvent(stock.code, events, evt.id, 'purchasePrice', e.target.value)}
                                            placeholder="0"
                                            className={numInputCls + ' !text-orange-300'}
                                            title="실제 매입단가 (차트 평균단가 기준 수익률 계산용)"
                                          />
                                        ) : (
                                          <div className="text-[10px] text-gray-700 text-right px-1">-</div>
                                        )}
                                      </td>
                                      <td className="py-1 px-1 text-right tabular-nums text-gray-300">
                                        {adjustedQty !== 0 || prevQtyNum !== 0
                                          ? adjustedQty.toLocaleString()
                                          : <span className="text-gray-700">-</span>}
                                      </td>
                                      <td className="py-1 px-1">
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          value={evt.taxBasePrice !== undefined && evt.taxBasePrice !== '' ? evt.taxBasePrice : ''}
                                          onChange={e => updateEvent(stock.code, events, evt.id, 'taxBasePrice', e.target.value)}
                                          placeholder="0.00"
                                          className={numInputCls}
                                        />
                                      </td>
                                      <td className="py-1 px-1 text-right tabular-nums text-sky-300">
                                        {runningAvg > 0 ? fmtTaxBase(runningAvg) : <span className="text-gray-700">-</span>}
                                      </td>
                                      <td className="py-1 px-1 text-center">
                                        <button
                                          onClick={() => deleteEvent(stock.code, events, evt.id)}
                                          className="text-gray-600 hover:text-red-400 p-0.5 rounded transition"
                                          title="삭제"
                                        ><Trash2 size={10} /></button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {buySummary.count > 0 && (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-t border-gray-700/50 bg-gray-900/40 text-[10px]">
                                <span className="text-gray-500">매수일
                                  <span className="text-gray-200 font-semibold ml-1">{buySummary.firstDate}{buySummary.lastDate !== buySummary.firstDate ? ` ~ ${buySummary.lastDate}` : ''}</span>
                                  <span className="text-gray-600 ml-1">({buySummary.count}건)</span>
                                </span>
                                <span className="text-gray-700">·</span>
                                <span className="text-gray-500">매수 합계
                                  <span className="text-emerald-300 font-semibold ml-1 tabular-nums">{buySummary.qtyTotal.toLocaleString()}주</span>
                                </span>
                                <span className="text-gray-700">·</span>
                                <span className="text-gray-500">매입금액
                                  <span className="text-gray-200 font-semibold ml-1 tabular-nums">{formatCurrency(Math.round(buySummary.amountTotal))}</span>
                                </span>
                                <span className="text-gray-700">·</span>
                                <span className="text-gray-500">매입 평균 단가
                                  <span className="text-orange-300 font-bold ml-1 tabular-nums">{buySummary.avgPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원</span>
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="px-3 py-1 text-[9px] text-gray-600 border-t border-gray-800/50">
                          일자 선택 시 자산검증 전일 수량 자동 조회 &nbsp;·&nbsp; 매수=양수 / 매도=음수 &nbsp;·&nbsp; 평균 과표는 이벤트 순서로 자동 계산되어 위 표에 반영됨
                          <br />
                          <span className="text-orange-400/60">매입단가</span> 는 아래 매수 요약(평균 매입단가) 산출에 사용됩니다 · 차트 '일일 수익률'(🎯)은 포트폴리오 테이블 매입금액 기준으로 증권사 수익률과 일치
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot className="bg-[#0f172a] border-t border-gray-600">
          <tr>
            <td className="py-2 px-3 text-left sticky left-0 z-10 bg-[#0f172a] text-[11px] font-bold text-gray-300 [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
              월별 예상 과세 합계
            </td>
            {monthlyExpected.map((v, i) => (
              <td key={i} className="py-1 px-1 tabular-nums">
                <div className="text-[10px] text-emerald-400 font-semibold">{v > 0 ? formatCurrency(v) : '-'}</div>
              </td>
            ))}
            <td className="py-1 px-2 tabular-nums">
              <div className="text-[11px] text-yellow-400 font-bold">{grandExpected > 0 ? formatCurrency(grandExpected) : '-'}</div>
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="px-3 py-1.5 bg-[#0f172a]/60 text-[10px] text-gray-600 border-t border-gray-700/50">
        배당 과표·평균 과표 입력 → 과세 과표(배당-평균)·예상 과세 자동 계산 · 평균 과표 "자동" = 이벤트 기반 자동 산출 (빈칸 입력 시 되돌리기)
      </div>
    </div>
  );
}
