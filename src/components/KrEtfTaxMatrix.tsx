// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { generateId, cleanNum, formatCurrency } from '../utils';
import {
  getKrEtfStocks,
  getCodeTaxBase,
  safeNum,
} from '../krEtfTaxHelpers';
import TaxBaseLookupModal from './TaxBaseLookupModal';

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
  updateTaxBasePurchases,
  updateTaxBaseSales,
  updateTaxBaseExPrice,
  updateTaxBaseAvgPrice,
  notify,
  driveTokenRef,
  driveFolderIdRef,
}) {
  const [expandedCode, setExpandedCode] = useState(null);
  const [lookupStock, setLookupStock] = useState(null);

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

  const stockRows = krStocks.map(stock => {
    const { purchases, sales, exTaxBase, avgTaxBase } = getCodeTaxBase(portfolio, stock.code);
    const currentQty = cleanNum(stock.quantity || 0);
    const monthData = monthYms.map(ym => {
      const exVal = exTaxBase[ym];
      const avgVal = avgTaxBase[ym];
      const exNum = safeNum(exVal);
      const avgNum = safeNum(avgVal);
      const taxBasePerShare = exNum - avgNum;
      const expected = Math.max(0, taxBasePerShare) * currentQty;
      return { ym, exVal, avgVal, exNum, avgNum, taxBasePerShare, expected };
    });
    const annualExpected = monthData.reduce((s, d) => s + d.expected, 0);
    return { stock, purchases, sales, currentQty, monthData, annualExpected };
  });

  const monthlyExpected = monthYms.map((_, i) =>
    stockRows.reduce((s, r) => s + (r.monthData[i].expected || 0), 0),
  );
  const grandExpected = monthlyExpected.reduce((s, v) => s + v, 0);

  const persistPurchases = (code, next) => updateTaxBasePurchases(portfolio.id, code, next);
  const persistSales = (code, next) => updateTaxBaseSales(portfolio.id, code, next);

  const addPurchase = (code, purchases) => persistPurchases(code, [
    ...purchases,
    { id: generateId(), date: new Date().toISOString().slice(0, 10), shares: 0, taxBasePrice: 0 },
  ]);
  const updatePurchase = (code, purchases, id, field, value) => persistPurchases(code, purchases.map(p =>
    p.id !== id ? p : { ...p, [field]: field === 'date' ? String(value) : value },
  ));
  const deletePurchase = (code, purchases, id) => persistPurchases(code, purchases.filter(p => p.id !== id));

  const addSale = (code, sales) => persistSales(code, [
    ...sales,
    { id: generateId(), date: new Date().toISOString().slice(0, 10), shares: 0 },
  ]);
  const updateSale = (code, sales, id, field, value) => persistSales(code, sales.map(s =>
    s.id !== id ? s : { ...s, [field]: field === 'date' ? String(value) : value },
  ));
  const deleteSale = (code, sales, id) => persistSales(code, sales.filter(s => s.id !== id));

  return (
    <div className="overflow-x-auto">
      <div className="px-3 py-2 bg-[#0f172a]/60 border-b border-gray-700/50 flex items-center gap-3 flex-wrap text-[10px]">
        <span className="text-gray-500">{CURRENT_YEAR}년 · 과세 과표 = 배당 과표 − 평균 과표 · 예상 과세 = max(0, 과세과표) × 보유주식수</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-500">연간 예상 과세 합계</span>
        <span className="text-emerald-400 font-semibold tabular-nums">{formatCurrency(grandExpected)}</span>
        <span className="ml-auto text-gray-600">
          종목명 클릭 → 매입/매도 이벤트 편집
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
          {stockRows.map(({ stock, purchases, sales, currentQty, monthData, annualExpected }) => {
            const isExpanded = expandedCode === stock.code;
            const purchasedShares = purchases.reduce((s, p) => s + safeNum(p.shares), 0);
            const soldShares = sales.reduce((s, p) => s + safeNum(p.shares), 0);
            const netShares = purchasedShares - soldShares;
            return (
              <React.Fragment key={stock.code}>
                <tr className="border-b border-gray-700/40 hover:bg-gray-800/20">
                  <td className="py-2 px-3 text-left sticky left-0 z-10 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                    <button
                      onClick={() => setLookupStock(stock)}
                      className="mb-1 text-[10px] px-2 py-0.5 rounded border border-amber-700/60 text-amber-300 hover:text-amber-200 hover:border-amber-500 hover:bg-amber-900/20 inline-flex items-center gap-1 transition"
                      title="Drive에서 최신 과표 데이터 조회 + 메모장 보기 + CSV 다운로드"
                    >
                      <FileText size={10} /> 과표 조회
                    </button>
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
                          {purchasedShares > 0 && netShares !== currentQty && (
                            <span className="text-amber-400/80 ml-1">⚠ 입력 {netShares.toLocaleString()}주</span>
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
                        <div className="text-[9px] text-gray-500 tabular-nums text-right px-0.5" title="포트폴리오 보유 주식수">
                          보유 {currentQty.toLocaleString()}주
                        </div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={d.avgVal ?? ''}
                          onChange={e => updateTaxBaseAvgPrice(portfolio.id, stock.code, d.ym, e.target.value)}
                          placeholder="평균 과표"
                          className={avgInputCls}
                          title="해당 시점의 평균 과표기준가 (1주당) — 다음 단계에서 매입 이벤트 기반 자동 계산 예정"
                        />
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
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {/* 매입 섹션 */}
                        <div className="border border-gray-700/60 rounded-lg bg-gray-900/40">
                          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-gray-200">매입 이벤트</span>
                              <span className="text-[10px] text-gray-500">{purchases.length}건 · {purchasedShares.toLocaleString()}주</span>
                            </div>
                            <button
                              onClick={() => addPurchase(stock.code, purchases)}
                              className="text-[10px] px-2 py-0.5 rounded border border-blue-700/60 text-blue-400 hover:text-blue-300 hover:border-blue-500 inline-flex items-center gap-1"
                            >
                              <Plus size={10} /> 행 추가
                            </button>
                          </div>
                          <div className="px-3 py-2">
                            {purchases.length === 0 ? (
                              <div className="text-[10px] text-gray-600 text-center py-2">매입 이벤트가 없습니다.</div>
                            ) : (
                              <table className="w-full text-[10px]">
                                <thead className="text-gray-500 border-b border-gray-700/50">
                                  <tr>
                                    <th className="text-left py-1 pl-1 font-normal w-[110px]">날짜</th>
                                    <th className="text-right py-1 px-1 font-normal">주식수</th>
                                    <th className="text-right py-1 px-1 font-normal">매입 과표기준가</th>
                                    <th className="py-1 pr-1 w-[24px]"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {purchases.map(p => (
                                    <tr key={p.id} className="border-b border-gray-800/40 last:border-0">
                                      <td className="py-1 pl-1">
                                        <input
                                          type="date"
                                          value={p.date || ''}
                                          onChange={e => updatePurchase(stock.code, purchases, p.id, 'date', e.target.value)}
                                          className="bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-1 py-0.5 text-[10px] text-gray-100 outline-none"
                                        />
                                      </td>
                                      <td className="py-1 px-1">
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={p.shares || ''}
                                          onChange={e => updatePurchase(stock.code, purchases, p.id, 'shares', e.target.value)}
                                          placeholder="0"
                                          className={numInputCls}
                                        />
                                      </td>
                                      <td className="py-1 px-1">
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          value={p.taxBasePrice || ''}
                                          onChange={e => updatePurchase(stock.code, purchases, p.id, 'taxBasePrice', e.target.value)}
                                          placeholder="0.00"
                                          className={numInputCls}
                                        />
                                      </td>
                                      <td className="py-1 pr-1 text-center">
                                        <button
                                          onClick={() => deletePurchase(stock.code, purchases, p.id)}
                                          className="text-gray-600 hover:text-red-400 p-0.5 rounded"
                                          title="삭제"
                                        >
                                          <Trash2 size={10} />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </div>
                        {/* 매도 섹션 */}
                        <div className="border border-gray-700/60 rounded-lg bg-gray-900/40">
                          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-gray-200">매도 이벤트 <span className="text-gray-600 text-[9px] font-normal">(평균법)</span></span>
                              <span className="text-[10px] text-gray-500">{sales.length}건 · {soldShares.toLocaleString()}주</span>
                            </div>
                            <button
                              onClick={() => addSale(stock.code, sales)}
                              className="text-[10px] px-2 py-0.5 rounded border border-rose-700/60 text-rose-400 hover:text-rose-300 hover:border-rose-500 inline-flex items-center gap-1"
                            >
                              <Plus size={10} /> 행 추가
                            </button>
                          </div>
                          <div className="px-3 py-2">
                            {sales.length === 0 ? (
                              <div className="text-[10px] text-gray-600 text-center py-2">매도 이벤트가 없습니다.</div>
                            ) : (
                              <table className="w-full text-[10px]">
                                <thead className="text-gray-500 border-b border-gray-700/50">
                                  <tr>
                                    <th className="text-left py-1 pl-1 font-normal w-[110px]">날짜</th>
                                    <th className="text-right py-1 px-1 font-normal">주식수</th>
                                    <th className="py-1 pr-1 w-[24px]"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sales.map(s => (
                                    <tr key={s.id} className="border-b border-gray-800/40 last:border-0">
                                      <td className="py-1 pl-1">
                                        <input
                                          type="date"
                                          value={s.date || ''}
                                          onChange={e => updateSale(stock.code, sales, s.id, 'date', e.target.value)}
                                          className="bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-1 py-0.5 text-[10px] text-gray-100 outline-none"
                                        />
                                      </td>
                                      <td className="py-1 px-1">
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={s.shares || ''}
                                          onChange={e => updateSale(stock.code, sales, s.id, 'shares', e.target.value)}
                                          placeholder="0"
                                          className={numInputCls}
                                        />
                                      </td>
                                      <td className="py-1 pr-1 text-center">
                                        <button
                                          onClick={() => deleteSale(stock.code, sales, s.id)}
                                          className="text-gray-600 hover:text-red-400 p-0.5 rounded"
                                        >
                                          <Trash2 size={10} />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
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
        배당 과표·평균 과표 입력 → 과세 과표(배당-평균)·예상 과세 자동 계산 · 데이터는 자동 저장 · 평균 과표 자동 산출은 다음 단계에서 추가 예정
      </div>
      {lookupStock && (
        <TaxBaseLookupModal
          stock={lookupStock}
          portfolio={portfolio}
          driveTokenRef={driveTokenRef}
          driveFolderIdRef={driveFolderIdRef}
          notify={notify}
          onClose={() => setLookupStock(null)}
        />
      )}
    </div>
  );
}
