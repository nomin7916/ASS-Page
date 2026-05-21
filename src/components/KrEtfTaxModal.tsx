// @ts-nocheck
import React, { useMemo, useState, useEffect } from 'react';
import { Calculator, X, Plus, Trash2, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { calculateKrEtfDividendTax, generateId, cleanNum, formatCurrency } from '../utils';
import { Z } from '../design';

const isKrCode = (code) => /^[A-Z0-9]{5,6}$/i.test(String(code || ''));

const numInputCls = 'w-full bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-2 py-1 text-xs text-gray-100 outline-none tabular-nums text-right';
const sectionCls = 'border border-gray-700/60 rounded-lg bg-gray-900/40';

function safeNum(v) {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export default function KrEtfTaxModal({
  portfolio,
  onClose,
  updateTaxBasePurchases,
  updateTaxBaseSales,
  updateTaxBaseExPrice,
  updatePortfolioDividendTaxAmount,
  notify,
}) {
  const krStocks = useMemo(
    () => (portfolio?.portfolio || []).filter(it => it.type === 'stock' && isKrCode(it.code)),
    [portfolio?.portfolio],
  );

  const [selectedCode, setSelectedCode] = useState(krStocks[0]?.code || '');
  const [purchasesOpen, setPurchasesOpen] = useState(true);
  const [salesOpen, setSalesOpen] = useState(false);
  const [dividendsOpen, setDividendsOpen] = useState(true);

  useEffect(() => {
    if (!selectedCode && krStocks[0]?.code) setSelectedCode(krStocks[0].code);
    if (selectedCode && !krStocks.some(s => s.code === selectedCode)) {
      setSelectedCode(krStocks[0]?.code || '');
    }
  }, [krStocks, selectedCode]);

  const selectedStock = krStocks.find(s => s.code === selectedCode);
  const codeTax = portfolio?.taxBaseHistory?.[selectedCode] || { purchases: [], sales: [], exTaxBase: {} };
  const purchases = codeTax.purchases || [];
  const sales = codeTax.sales || [];
  const exTaxBase = codeTax.exTaxBase || {};
  const taxRate = portfolio?.dividendTaxRate ?? 15.4;

  // 배당 이벤트 목록 (dividendHistory + dividendExDate에서 추출, 최신순)
  const dividendEvents = useMemo(() => {
    if (!selectedCode) return [];
    const hist = portfolio?.dividendHistory?.[selectedCode] || {};
    const exMap = portfolio?.dividendExDate?.[selectedCode] || {};
    return Object.keys(hist)
      .map(ym => ({
        yearMonth: ym,
        exDate: exMap[ym] || `${ym}-01`,
        perShareGrossDividend: hist[ym] || 0,
      }))
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.exDate))
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  }, [portfolio?.dividendHistory, portfolio?.dividendExDate, selectedCode]);

  const totalPurchasedShares = purchases.reduce((s, p) => s + (cleanNum(p.shares) || 0), 0);
  const totalSoldShares = sales.reduce((s, p) => s + (cleanNum(p.shares) || 0), 0);
  const netShares = totalPurchasedShares - totalSoldShares;
  const currentQty = cleanNum(selectedStock?.quantity || 0);

  const persistPurchases = (next) => updateTaxBasePurchases(portfolio.id, selectedCode, next);
  const persistSales = (next) => updateTaxBaseSales(portfolio.id, selectedCode, next);

  const addPurchase = () => persistPurchases([
    ...purchases,
    { id: generateId(), date: new Date().toISOString().slice(0, 10), shares: 0, taxBasePrice: 0 },
  ]);
  const updatePurchase = (id, field, value) => persistPurchases(purchases.map(p =>
    p.id !== id ? p : { ...p, [field]: field === 'date' ? String(value) : safeNum(value) },
  ));
  const deletePurchase = (id) => persistPurchases(purchases.filter(p => p.id !== id));

  const addSale = () => persistSales([
    ...sales,
    { id: generateId(), date: new Date().toISOString().slice(0, 10), shares: 0 },
  ]);
  const updateSale = (id, field, value) => persistSales(sales.map(p =>
    p.id !== id ? p : { ...p, [field]: field === 'date' ? String(value) : safeNum(value) },
  ));
  const deleteSale = (id) => persistSales(sales.filter(p => p.id !== id));

  const computeForEvent = (ev) => {
    const exPrice = exTaxBase[ev.yearMonth];
    if (!(exPrice > 0)) return null;
    const validPurchases = purchases
      .filter(p => p.shares > 0 && p.taxBasePrice > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
      .map(p => ({ id: p.id, date: p.date, shares: Math.floor(p.shares), taxBasePrice: p.taxBasePrice }));
    if (validPurchases.length === 0) return null;
    const validSales = sales
      .filter(s => s.shares > 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.date))
      .map(s => ({ id: s.id, date: s.date, shares: Math.floor(s.shares) }));
    try {
      return calculateKrEtfDividendTax(
        validPurchases,
        { exDate: ev.exDate, exTaxBasePrice: exPrice, perShareGrossDividend: ev.perShareGrossDividend },
        { taxRate: taxRate / 100, sales: validSales },
      );
    } catch (e) {
      return { error: e.message };
    }
  };

  const applyTax = (ev, result) => {
    if (!result || result.error) return;
    updatePortfolioDividendTaxAmount(portfolio.id, selectedCode, ev.yearMonth, result.tax);
    notify(`${ev.yearMonth} 세금 ${formatCurrency(result.tax)} 적용`, 'success');
  };

  if (!portfolio || !['portfolio', 'dividend', 'isa', 'pension', 'dc-irp'].includes(portfolio.accountType)) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex: Z.dialog }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0f1623] border border-gray-700/60 rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 text-gray-100">
            <Calculator size={15} className="text-amber-400" />
            <span className="font-semibold text-sm">한국 ETF 과표 계산기</span>
            <span className="text-[10px] text-gray-500 ml-1">평균법 · 세율 {taxRate}%</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 p-1 rounded hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        {krStocks.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">한국 ETF 종목이 없습니다.</div>
        ) : (
          <>
            {/* 종목 선택 */}
            <div className="px-5 py-3 border-b border-gray-800/60 shrink-0 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-gray-500">종목</span>
              <select
                value={selectedCode}
                onChange={e => setSelectedCode(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none focus:border-amber-500 min-w-[220px]"
              >
                {krStocks.map(s => (
                  <option key={s.code} value={s.code}>
                    {s.name ? `${s.name} (${s.code})` : s.code}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-gray-600 ml-2">
                현재 보유: <span className="text-gray-300 tabular-nums">{currentQty.toLocaleString()}주</span>
              </span>
              {netShares !== currentQty && totalPurchasedShares > 0 && (
                <span className="text-[10px] text-amber-400/80">
                  ⚠ 입력 합계({netShares.toLocaleString()}주) ≠ 현재 보유
                </span>
              )}
            </div>

            {/* 본문 — 스크롤 영역 */}
            <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
              {/* 매입 섹션 */}
              <div className={sectionCls}>
                <div className="flex items-center justify-between hover:bg-gray-800/30">
                  <button
                    onClick={() => setPurchasesOpen(o => !o)}
                    className="flex items-center gap-2 px-3 py-2 flex-1 text-left"
                  >
                    {purchasesOpen ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                    <span className="text-xs font-semibold text-gray-200">매입 이벤트</span>
                    <span className="text-[10px] text-gray-500">{purchases.length}건 · {totalPurchasedShares.toLocaleString()}주</span>
                  </button>
                  <button
                    onClick={addPurchase}
                    className="text-[10px] px-2 py-0.5 mr-3 rounded border border-blue-700/60 text-blue-400 hover:text-blue-300 hover:border-blue-500 inline-flex items-center gap-1"
                  >
                    <Plus size={10} /> 행 추가
                  </button>
                </div>
                {purchasesOpen && (
                  <div className="px-3 pb-3">
                    {purchases.length === 0 ? (
                      <div className="text-[11px] text-gray-600 text-center py-3">매입 이벤트가 없습니다.</div>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead className="text-gray-500 border-b border-gray-700/50">
                          <tr>
                            <th className="text-left py-1.5 pl-1 font-normal w-[130px]">날짜</th>
                            <th className="text-right py-1.5 px-1 font-normal">주식수</th>
                            <th className="text-right py-1.5 px-1 font-normal">매입 과표기준가</th>
                            <th className="py-1.5 pr-1 w-[28px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchases.map(p => (
                            <tr key={p.id} className="border-b border-gray-800/40 last:border-0">
                              <td className="py-1.5 pl-1">
                                <input
                                  type="date"
                                  value={p.date || ''}
                                  onChange={e => updatePurchase(p.id, 'date', e.target.value)}
                                  className="bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-1.5 py-1 text-[11px] text-gray-100 outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-1">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={p.shares || ''}
                                  onChange={e => updatePurchase(p.id, 'shares', e.target.value)}
                                  placeholder="0"
                                  className={numInputCls}
                                />
                              </td>
                              <td className="py-1.5 px-1">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={p.taxBasePrice || ''}
                                  onChange={e => updatePurchase(p.id, 'taxBasePrice', e.target.value)}
                                  placeholder="0.00"
                                  className={numInputCls}
                                />
                              </td>
                              <td className="py-1.5 pr-1 text-center">
                                <button
                                  onClick={() => deletePurchase(p.id)}
                                  className="text-gray-600 hover:text-red-400 p-1 rounded"
                                  title="삭제"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              {/* 매도 섹션 */}
              <div className={sectionCls}>
                <div className="flex items-center justify-between hover:bg-gray-800/30">
                  <button
                    onClick={() => setSalesOpen(o => !o)}
                    className="flex items-center gap-2 px-3 py-2 flex-1 text-left"
                  >
                    {salesOpen ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                    <span className="text-xs font-semibold text-gray-200">매도 이벤트 <span className="text-gray-600 text-[10px] font-normal">(평균법)</span></span>
                    <span className="text-[10px] text-gray-500">{sales.length}건 · {totalSoldShares.toLocaleString()}주</span>
                  </button>
                  <button
                    onClick={addSale}
                    className="text-[10px] px-2 py-0.5 mr-3 rounded border border-rose-700/60 text-rose-400 hover:text-rose-300 hover:border-rose-500 inline-flex items-center gap-1"
                  >
                    <Plus size={10} /> 행 추가
                  </button>
                </div>
                {salesOpen && (
                  <div className="px-3 pb-3">
                    {sales.length === 0 ? (
                      <div className="text-[11px] text-gray-600 text-center py-3">매도 이벤트가 없습니다.</div>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead className="text-gray-500 border-b border-gray-700/50">
                          <tr>
                            <th className="text-left py-1.5 pl-1 font-normal w-[130px]">날짜</th>
                            <th className="text-right py-1.5 px-1 font-normal">주식수</th>
                            <th className="py-1.5 pr-1 w-[28px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sales.map(s => (
                            <tr key={s.id} className="border-b border-gray-800/40 last:border-0">
                              <td className="py-1.5 pl-1">
                                <input
                                  type="date"
                                  value={s.date || ''}
                                  onChange={e => updateSale(s.id, 'date', e.target.value)}
                                  className="bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-1.5 py-1 text-[11px] text-gray-100 outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-1">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={s.shares || ''}
                                  onChange={e => updateSale(s.id, 'shares', e.target.value)}
                                  placeholder="0"
                                  className={numInputCls}
                                />
                              </td>
                              <td className="py-1.5 pr-1 text-center">
                                <button
                                  onClick={() => deleteSale(s.id)}
                                  className="text-gray-600 hover:text-red-400 p-1 rounded"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              {/* 배당 이벤트별 카드 */}
              <div className={sectionCls}>
                <button
                  onClick={() => setDividendsOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800/30"
                >
                  <div className="flex items-center gap-2">
                    {dividendsOpen ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                    <span className="text-xs font-semibold text-gray-200">배당 이벤트별 과표 입력 & 세금 계산</span>
                    <span className="text-[10px] text-gray-500">{dividendEvents.length}건</span>
                  </div>
                </button>
                {dividendsOpen && (
                  <div className="px-3 pb-3 space-y-2">
                    {dividendEvents.length === 0 ? (
                      <div className="text-[11px] text-gray-600 text-center py-3">분배금 이력이 없습니다.</div>
                    ) : (
                      dividendEvents.map(ev => {
                        const result = computeForEvent(ev);
                        const hasResult = result && !result.error && result.totalShares > 0;
                        const exPrice = exTaxBase[ev.yearMonth];
                        return (
                          <div key={ev.yearMonth} className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] font-semibold text-gray-200">{ev.yearMonth}</span>
                                <span className="text-[10px] text-gray-500">배당락 {ev.exDate}</span>
                                <span className="text-[10px] text-gray-500">· 주당 세전 <span className="text-blue-300">{formatCurrency(ev.perShareGrossDividend)}</span></span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-gray-500">배당락 과표</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={exPrice || ''}
                                  onChange={e => updateTaxBaseExPrice(portfolio.id, selectedCode, ev.yearMonth, safeNum(e.target.value))}
                                  placeholder="0.00"
                                  className="w-24 bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-2 py-1 text-[11px] text-amber-300 outline-none tabular-nums text-right"
                                />
                              </div>
                            </div>
                            {result?.error ? (
                              <div className="text-[10px] text-red-400">⚠ {result.error}</div>
                            ) : hasResult ? (
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10.5px] tabular-nums">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">가중평균 매입과표</span>
                                  <span className="text-gray-200">{result.weightedAvgTaxBase.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">과세대상 단가</span>
                                  <span className="text-amber-300">{result.taxablePerShare.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">보유수량</span>
                                  <span className="text-gray-200">{result.totalShares.toLocaleString()}주</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">과세대상금액</span>
                                  <span className="text-amber-300">{formatCurrency(result.taxableAmount)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">세전 배당금</span>
                                  <span className="text-blue-300">{formatCurrency(result.grossDividend)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">세금 ({taxRate}%)</span>
                                  <span className="text-orange-400 font-semibold">{formatCurrency(result.tax)}</span>
                                </div>
                                <div className="flex justify-between col-span-2 pt-1 border-t border-gray-800 mt-1">
                                  <span className="text-gray-400">실 수령액 (세후)</span>
                                  <span className="text-emerald-400 font-semibold">{formatCurrency(result.netDividend)}</span>
                                </div>
                                <div className="col-span-2 flex justify-end pt-1">
                                  <button
                                    onClick={() => applyTax(ev, result)}
                                    className="text-[10px] px-2.5 py-1 rounded bg-amber-700/70 hover:bg-amber-600 text-white font-semibold inline-flex items-center gap-1.5 transition-colors"
                                  >
                                    <Check size={11} /> 세금을 표에 적용
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-[10px] text-gray-600">
                                {purchases.length === 0
                                  ? '매입 이벤트를 먼저 추가하세요.'
                                  : !(exPrice > 0)
                                    ? '배당락일 과표기준가를 입력하면 자동 계산됩니다.'
                                    : '보유수량이 0이라 계산값이 없습니다.'}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-gray-800/60 shrink-0 flex items-center justify-between">
          <span className="text-[10px] text-gray-600">
            데이터는 자동 저장되어 Drive에 동기화됩니다.
          </span>
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
