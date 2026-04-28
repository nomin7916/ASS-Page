// @ts-nocheck
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { cleanNum, formatCurrency } from '../utils';
import { fetchDividendHistory, fetchYahooDividendHistory } from '../api';

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const CURRENT_YEAR = new Date().getFullYear().toString();
const formatUsd = (v) => v > 0 ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;

const isKrCode = (code) => /^[A-Z0-9]{5,6}$/i.test(String(code || ''));
const isUsCode = (code) => /^[A-Z]{1,5}$/i.test(String(code || ''));
const getCodeType = (code, pf) => {
  if (pf.accountType === 'overseas') return isUsCode(code) ? 'us' : null;
  return isKrCode(code) ? 'kr' : null;
};

function buildMonthPrediction(codeHistory) {
  const pred = {};
  for (let m = 1; m <= 12; m++) {
    const mo = String(m).padStart(2, '0');
    const entries = Object.entries(codeHistory || {})
      .filter(([key]) => key.endsWith(`-${mo}`))
      .sort(([a], [b]) => b.localeCompare(a));
    if (entries.length > 0) pred[m] = entries[0][1];
  }
  return pred;
}

function parseDividendApiResult(result) {
  const monthData = {};
  result.forEach(({ dividendAmount, exDividendAt }) => {
    const parts = exDividendAt.split('.');
    const key = `${parts[0]}-${parts[1].padStart(2, '0')}`;
    monthData[key] = (monthData[key] || 0) + dividendAmount;
  });
  return monthData;
}

export default function DividendSummaryTable({ portfolios, updatePortfolioDividendHistory, updatePortfolioActualDividend, updatePortfolioDividendTaxRate, updatePortfolioDividendTaxAmount, compact = false, usdkrw = 1300 }) {
  const [activeTab, setActiveTab] = useState('expected');
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState(null); // { portfolioId, code, monthIdx, value }
  const fetchedRef = useRef(new Set());
  const inputRef = useRef(null);

  const nonGoldPortfolios = useMemo(() =>
    (portfolios || []).filter(p => p.accountType !== 'gold'),
    [portfolios]
  );

  const stockKeys = useMemo(() =>
    nonGoldPortfolios
      .flatMap(pf =>
        (pf.portfolio || [])
          .filter(item => getCodeType(item.code, pf) !== null)
          .map(item => `${pf.id}:${item.code}`)
      )
      .sort()
      .join(','),
    [nonGoldPortfolios]
  );

  useEffect(() => {
    if (!stockKeys) return;
    const fetchMissing = async () => {
      const byPortfolio = {};
      nonGoldPortfolios.forEach(pf => {
        const divHistory = pf.dividendHistory || {};
        (pf.portfolio || []).forEach(item => {
          const codeType = getCodeType(item.code, pf);
          if (!codeType) return;
          const key = `${pf.id}:${item.code}`;
          if (fetchedRef.current.has(key) || divHistory[item.code]) return;
          fetchedRef.current.add(key);
          if (!byPortfolio[pf.id]) byPortfolio[pf.id] = [];
          byPortfolio[pf.id].push({ code: item.code, codeType });
        });
      });
      if (!Object.keys(byPortfolio).length) return;
      setLoading(true);
      await Promise.all(
        Object.entries(byPortfolio).map(async ([portfolioId, items]) => {
          const mergeMap = {};
          await Promise.all(items.map(async ({ code, codeType }) => {
            let monthData;
            if (codeType === 'us') {
              monthData = await fetchYahooDividendHistory(code);
            } else {
              const data = await fetchDividendHistory(code);
              if (data?.result?.length) monthData = parseDividendApiResult(data.result);
            }
            if (monthData && Object.keys(monthData).length) mergeMap[code] = monthData;
          }));
          if (Object.keys(mergeMap).length) updatePortfolioDividendHistory(portfolioId, mergeMap);
        })
      );
      setLoading(false);
    };
    fetchMissing();
  }, [stockKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const handleRefreshAll = useCallback(async () => {
    fetchedRef.current.clear();
    setLoading(true);
    await Promise.all(
      nonGoldPortfolios.map(async pf => {
        const stocks = (pf.portfolio || []).filter(item => getCodeType(item.code, pf) !== null);
        if (!stocks.length) return;
        const mergeMap = {};
        await Promise.all(stocks.map(async item => {
          fetchedRef.current.add(`${pf.id}:${item.code}`);
          const codeType = getCodeType(item.code, pf);
          let monthData;
          if (codeType === 'us') {
            monthData = await fetchYahooDividendHistory(String(item.code));
          } else {
            const data = await fetchDividendHistory(String(item.code));
            if (data?.result?.length) monthData = parseDividendApiResult(data.result);
          }
          if (monthData && Object.keys(monthData).length) mergeMap[item.code] = monthData;
        }));
        if (Object.keys(mergeMap).length) updatePortfolioDividendHistory(pf.id, mergeMap);
      })
    );
    setLoading(false);
  }, [nonGoldPortfolios, updatePortfolioDividendHistory]);

  // 월 예상 분배금 rows
  const expectedRows = useMemo(() => {
    const result = [];
    nonGoldPortfolios.forEach(pf => {
      const divHistory = pf.dividendHistory || {};
      const isOverseas = pf.accountType === 'overseas';
      const fxRate = isOverseas ? usdkrw : 1;
      (pf.portfolio || []).forEach(item => {
        if (!getCodeType(item.code, pf)) return;
        const qty = cleanNum(item.quantity);
        if (!qty) return;
        const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
        const monthData = Array.from({ length: 12 }, (_, i) => {
          const mo = String(i + 1).padStart(2, '0');
          const isActual = !!divHistory[item.code]?.[`${CURRENT_YEAR}-${mo}`];
          const perShare = pred[i + 1] || 0;
          const amountUsd = perShare * qty;
          const amount = amountUsd * fxRate;
          return { amount, amountUsd: isOverseas ? amountUsd : 0, isActual };
        });
        result.push({
          portfolioTitle: pf.title || pf.name || '계좌',
          portfolioId: pf.id,
          code: item.code,
          name: item.name,
          qty,
          isOverseas,
          hasDivData: Object.keys(pred).length > 0,
          monthData,
          annual: monthData.reduce((s, d) => s + d.amount, 0),
          annualUsd: isOverseas ? monthData.reduce((s, d) => s + d.amountUsd, 0) : 0,
        });
      });
    });
    return result;
  }, [nonGoldPortfolios]);

  // 월 입금 내역 rows — 예상값 기반 + 사용자 직접 입력 override
  const actualRows = useMemo(() => {
    const result = [];
    nonGoldPortfolios.forEach(pf => {
      const divHistory = pf.dividendHistory || {};
      const actualDividend = pf.actualDividend || {};
      const isOverseas = pf.accountType === 'overseas';
      const fxRate = isOverseas ? usdkrw : 1;
      (pf.portfolio || []).forEach(item => {
        if (!getCodeType(item.code, pf)) return;
        const qty = cleanNum(item.quantity);
        if (!qty) return;
        const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
        const codeActual = actualDividend[item.code] || {};
        const monthData = Array.from({ length: 12 }, (_, i) => {
          const mo = String(i + 1).padStart(2, '0');
          const yearMonth = `${CURRENT_YEAR}-${mo}`;
          const predicted = (pred[i + 1] || 0) * qty * fxRate;
          const hasManual = yearMonth in codeActual;
          const amount = hasManual ? codeActual[yearMonth] : predicted;
          const amountUsd = isOverseas ? amount / usdkrw : 0;
          return { amount, amountUsd, predicted, hasManual, yearMonth };
        });
        result.push({
          portfolioTitle: pf.title || pf.name || '계좌',
          portfolioId: pf.id,
          code: item.code,
          name: item.name,
          qty,
          isOverseas,
          hasDivData: Object.keys(pred).length > 0,
          monthData,
          annual: monthData.reduce((s, d) => s + d.amount, 0),
          annualUsd: isOverseas ? monthData.reduce((s, d) => s + d.amountUsd, 0) : 0,
        });
      });
    });
    return result;
  }, [nonGoldPortfolios]);

  // compact 모드 — 계좌별 월 합계
  const compactExpectedRows = useMemo(() => {
    if (!compact) return [];
    return nonGoldPortfolios.map(pf => {
      const divHistory = pf.dividendHistory || {};
      const fxRate = pf.accountType === 'overseas' ? usdkrw : 1;
      const monthData = Array.from({ length: 12 }, (_, i) => {
        const amount = (pf.portfolio || []).reduce((sum, item) => {
          if (!getCodeType(item.code, pf)) return sum;
          const qty = cleanNum(item.quantity);
          if (!qty) return sum;
          const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
          return sum + (pred[i + 1] || 0) * qty * fxRate;
        }, 0);
        return { amount };
      });
      const annual = monthData.reduce((s, d) => s + d.amount, 0);
      return { portfolioId: pf.id, portfolioTitle: pf.title || pf.name || '계좌', rowColor: pf.rowColor || '', monthData, annual };
    }).filter(row => row.annual > 0);
  }, [compact, nonGoldPortfolios]);

  const compactActualRows = useMemo(() => {
    if (!compact) return [];
    return nonGoldPortfolios.map(pf => {
      const divHistory = pf.dividendHistory || {};
      const actualDividend = pf.actualDividend || {};
      const fxRate = pf.accountType === 'overseas' ? usdkrw : 1;
      const monthData = Array.from({ length: 12 }, (_, i) => {
        const mo = String(i + 1).padStart(2, '0');
        const yearMonth = `${CURRENT_YEAR}-${mo}`;
        const amount = (pf.portfolio || []).reduce((sum, item) => {
          if (!getCodeType(item.code, pf)) return sum;
          const qty = cleanNum(item.quantity);
          if (!qty) return sum;
          const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
          const codeActual = actualDividend[item.code] || {};
          const predicted = (pred[i + 1] || 0) * qty * fxRate;
          return sum + (yearMonth in codeActual ? codeActual[yearMonth] : predicted);
        }, 0);
        return { amount, yearMonth };
      });
      const annual = monthData.reduce((s, d) => s + d.amount, 0);
      return { portfolioId: pf.id, portfolioTitle: pf.title || pf.name || '계좌', rowColor: pf.rowColor || '', monthData, annual };
    }).filter(row => row.annual > 0);
  }, [compact, nonGoldPortfolios]);

  const commitEdit = () => {
    if (!editingCell) return;
    const { portfolioId, code, monthIdx, value, yearMonth } = editingCell;
    const num = parseFloat(String(value).replace(/,/g, '')) || 0;
    updatePortfolioActualDividend(portfolioId, code, yearMonth, num);
    setEditingCell(null);
  };

  const handleCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId,
      code: row.code,
      monthIdx,
      yearMonth: d.yearMonth,
      value: d.amount > 0 ? String(d.amount) : '',
    });
  };

  const handleCellKeyDown = (e) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingCell(null);
  };

  const handleTaxChange = (portfolioId, code, yearMonth, value) => {
    const num = parseFloat(String(value).replace(/,/g, '')) || 0;
    updatePortfolioDividendTaxAmount(portfolioId, code, yearMonth, num);
  };

  const getTaxRate = (portfolioId) => {
    const pf = nonGoldPortfolios.find(p => p.id === portfolioId);
    return pf?.dividendTaxRate ?? 15.4;
  };
  const getEffectiveTax = (amount, portfolioId, code, yearMonth) => {
    const pf = nonGoldPortfolios.find(p => p.id === portfolioId);
    const manual = pf?.dividendTaxAmounts?.[code]?.[yearMonth] || 0;
    if (manual > 0) return manual;
    const rate = getTaxRate(portfolioId);
    if (rate > 0 && amount > 0) return Math.round(amount * rate / 100);
    return 0;
  };
  const getPortfolioMonthTax = (pf, monthIdx) => {
    const mo = String(monthIdx + 1).padStart(2, '0');
    const yearMonth = `${CURRENT_YEAR}-${mo}`;
    const divHistory = pf.dividendHistory || {};
    const actualDividend = pf.actualDividend || {};
    const fxRate = pf.accountType === 'overseas' ? usdkrw : 1;
    return (pf.portfolio || []).reduce((sum, item) => {
      if (!getCodeType(item.code, pf)) return sum;
      const qty = cleanNum(item.quantity);
      if (!qty) return sum;
      const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
      const codeActual = actualDividend[item.code] || {};
      const predicted = (pred[monthIdx + 1] || 0) * qty * fxRate;
      const amount = yearMonth in codeActual ? codeActual[yearMonth] : predicted;
      return sum + getEffectiveTax(amount, pf.id, item.code, yearMonth);
    }, 0);
  };

  if (!nonGoldPortfolios.length) return null;

  const totalTax = actualRows.reduce((sum, row) =>
    sum + row.monthData.reduce((s, d) => s + getEffectiveTax(d.amount, row.portfolioId, row.code, d.yearMonth), 0)
  , 0);

  const monthlyTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.reduce((sum, row) => sum + row.monthData[i].amount, 0)
  );
  const annualTotal = monthlyTotals.reduce((s, v) => s + v, 0);
  const monthlyTaxTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.reduce((sum, row) => {
      const rate = getTaxRate(row.portfolioId);
      return sum + Math.round(row.monthData[i].amount * rate / 100);
    }, 0)
  );
  const annualTaxTotal = monthlyTaxTotals.reduce((s, v) => s + v, 0);
  const actualMonthlyTotals = Array.from({ length: 12 }, (_, i) =>
    actualRows.reduce((sum, row) => sum + row.monthData[i].amount, 0)
  );
  const actualAnnualTotal = actualMonthlyTotals.reduce((s, v) => s + v, 0);
  const actualMonthlyTaxTotals = Array.from({ length: 12 }, (_, i) =>
    actualRows.reduce((sum, row) => {
      const d = row.monthData[i];
      return sum + getEffectiveTax(d.amount, row.portfolioId, row.code, d.yearMonth);
    }, 0)
  );
  const actualAnnualTaxTotal = actualMonthlyTaxTotals.reduce((s, v) => s + v, 0);

  const compactAnnualTotal = (activeTab === 'expected' ? compactExpectedRows : compactActualRows)
    .reduce((s, r) => s + r.annual, 0);
  const compactAnnualTax = compactExpectedRows.reduce((sum, row) => {
    const rate = getTaxRate(row.portfolioId);
    return sum + Math.round(row.annual * rate / 100);
  }, 0);
  const compactMonthlyTotals = Array.from({ length: 12 }, (_, i) =>
    (activeTab === 'expected' ? compactExpectedRows : compactActualRows)
      .reduce((sum, row) => sum + row.monthData[i].amount, 0)
  );
  const compactActualTaxMap = {};
  compactActualRows.forEach(row => {
    const pf = nonGoldPortfolios.find(p => p.id === row.portfolioId);
    if (!pf) { compactActualTaxMap[row.portfolioId] = { monthlyTax: Array(12).fill(0), annualTax: 0 }; return; }
    const monthlyTax = Array.from({ length: 12 }, (_, i) => getPortfolioMonthTax(pf, i));
    compactActualTaxMap[row.portfolioId] = { monthlyTax, annualTax: monthlyTax.reduce((s, v) => s + v, 0) };
  });
  const compactActualTotalMonthlyTax = Array.from({ length: 12 }, (_, i) =>
    compactActualRows.reduce((sum, row) => sum + (compactActualTaxMap[row.portfolioId]?.monthlyTax[i] || 0), 0)
  );
  const compactActualAnnualTax = compactActualTotalMonthlyTax.reduce((s, v) => s + v, 0);

  if (compact) {
    const rows = activeTab === 'expected' ? compactExpectedRows : compactActualRows;
    const totalAnnual = compactAnnualTotal;
    return (
      <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden w-full">
        <div className="p-4 bg-[#0f172a] border-b border-gray-700 flex items-center gap-2 flex-wrap">
          <span className="text-white font-bold text-sm">💰 분배금 현황</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-700 ml-2">
            <button
              onClick={() => setActiveTab('expected')}
              className={`px-3 py-1 text-xs font-bold transition-colors ${activeTab === 'expected' ? 'bg-blue-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
            >월 예상 분배금</button>
            <button
              onClick={() => setActiveTab('actual')}
              className={`px-3 py-1 text-xs font-bold transition-colors border-l border-gray-700 ${activeTab === 'actual' ? 'bg-emerald-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
            >월 입금 내역</button>
          </div>
          {totalAnnual > 0 && (
            <div className="flex flex-col leading-tight">
              <span className={`font-bold text-xs ${activeTab === 'expected' ? 'text-yellow-400' : 'text-emerald-400'}`}>
                {activeTab === 'expected' ? '연간 예상 ' : `${CURRENT_YEAR}년 누계 `}{formatCurrency(totalAnnual)}
              </span>
              {activeTab === 'expected' && compactAnnualTax > 0 && (
                <span className="text-orange-300/70 text-[10px]">연간 과세 {formatCurrency(compactAnnualTax)}</span>
              )}
              {activeTab === 'expected' && compactAnnualTax > 0 && (
                <span className="text-green-400/80 text-[10px]">실 분배금(세후) {formatCurrency(totalAnnual - compactAnnualTax)}</span>
              )}
              {activeTab === 'actual' && compactActualAnnualTax > 0 && (
                <span className="text-orange-300/70 text-[10px]">연간 과세 {formatCurrency(compactActualAnnualTax)}</span>
              )}
              {activeTab === 'actual' && compactActualAnnualTax > 0 && (
                <span className="text-green-400/80 text-[10px]">실 수령(세후) {formatCurrency(totalAnnual - compactActualAnnualTax)}</span>
              )}
            </div>
          )}
          <button
            onClick={handleRefreshAll}
            disabled={loading}
            className="ml-auto px-3 py-1 text-xs font-bold rounded-md border border-gray-600 text-gray-400 hover:bg-gray-700/50 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? '조회 중...' : '🔄 새로고침'}
          </button>
        </div>
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-xs">
              {loading ? '분배금 데이터 조회 중...' : '분배금 데이터가 없습니다.'}
            </div>
          ) : (
            <table className="w-full text-[11px] text-center">
              <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                <tr>
                  <th className="py-3 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">계좌</th>
                  {MONTHS.map(m => (
                    <th key={m} className="py-2.5 px-1 min-w-[68px] text-center">{m}</th>
                  ))}
                  <th className={`py-2 px-2 min-w-[88px] font-bold text-center ${activeTab === 'expected' ? 'text-yellow-500' : 'text-emerald-500'}`}>연간합계</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const rowTaxRate = getTaxRate(row.portfolioId);
                  const actualTax = activeTab === 'actual' ? compactActualTaxMap[row.portfolioId] : null;
                  return (
                    <tr key={row.portfolioId} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                      <td className="py-2 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold">
                        <div className="line-clamp-1" style={{ color: row.rowColor || '#93c5fd' }}>{row.portfolioTitle}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-gray-600 text-[9px]">과세율</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={rowTaxRate}
                            onChange={e => { const v = parseFloat(e.target.value); updatePortfolioDividendTaxRate(row.portfolioId, isNaN(v) ? 0 : v); }}
                            onClick={e => e.stopPropagation()}
                            className="w-8 bg-transparent text-orange-300/70 text-[9px] text-center border-b border-gray-700/40 outline-none"
                          />
                          <span className="text-gray-600 text-[9px]">%</span>
                        </div>
                      </td>
                      {row.monthData.map((d, i) => {
                        const taxAmt = activeTab === 'expected'
                          ? (rowTaxRate > 0 && d.amount > 0 ? Math.round(d.amount * rowTaxRate / 100) : 0)
                          : (actualTax?.monthlyTax[i] || 0);
                        return (
                          <td key={i} className={`py-1.5 px-1 text-center text-[10px] ${d.amount > 0 ? (activeTab === 'expected' ? 'text-blue-300/70' : 'text-emerald-300') : 'text-gray-700'}`}>
                            <div className="flex flex-col items-center justify-center gap-0">
                              <span>{d.amount > 0 ? formatCurrency(d.amount) : '-'}</span>
                              {taxAmt > 0 && (
                                <span className="text-orange-300/55 text-[9px]">{formatCurrency(taxAmt)}</span>
                              )}
                              {taxAmt > 0 && d.amount > 0 && (
                                <span className="text-green-400/60 text-[9px]">{formatCurrency(d.amount - taxAmt)}</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className={`py-2 px-2 text-center font-bold ${row.annual > 0 ? (activeTab === 'expected' ? 'text-yellow-400' : 'text-emerald-400') : 'text-gray-600'}`}>
                        <div className="flex flex-col items-center justify-center gap-0">
                          <span>{row.annual > 0 ? formatCurrency(row.annual) : '-'}</span>
                          {activeTab === 'expected' && rowTaxRate > 0 && row.annual > 0 && (() => {
                            const annualTax = Math.round(row.annual * rowTaxRate / 100);
                            return (<>
                              <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(annualTax)}</span>
                              <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - annualTax)}</span>
                            </>);
                          })()}
                          {activeTab === 'actual' && (actualTax?.annualTax || 0) > 0 && (<>
                            <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(actualTax.annualTax)}</span>
                            <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - actualTax.annualTax)}</span>
                          </>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                  {compactMonthlyTotals.map((total, i) => (
                    <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-green-300' : 'text-gray-600'}`}>
                      {total > 0 ? formatCurrency(total) : '-'}
                    </td>
                  ))}
                  <td className={`py-2 px-2 text-center font-bold ${activeTab === 'expected' ? 'text-yellow-300' : 'text-emerald-300'}`}>
                    {totalAnnual > 0 ? formatCurrency(totalAnnual) : '-'}
                  </td>
                </tr>
                {activeTab === 'expected' && compactAnnualTax > 0 && (() => {
                  const monthlyTaxArr = Array.from({ length: 12 }, (_, i) =>
                    compactExpectedRows.reduce((sum, row) => {
                      const rate = getTaxRate(row.portfolioId);
                      return sum + Math.round((row.monthData[i]?.amount || 0) * rate / 100);
                    }, 0)
                  );
                  return (<>
                    <tr className="text-orange-300/60">
                      <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">과세합계</td>
                      {monthlyTaxArr.map((tax, i) => (
                        <td key={i} className="py-1 px-1 text-center text-[9px]">{tax > 0 ? formatCurrency(tax) : '-'}</td>
                      ))}
                      <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(compactAnnualTax)}</td>
                    </tr>
                    <tr className="text-green-400/70">
                      <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">실 분배금(세후)</td>
                      {compactMonthlyTotals.map((total, i) => (
                        <td key={i} className="py-1 px-1 text-center text-[9px]">{total > 0 ? formatCurrency(total - monthlyTaxArr[i]) : '-'}</td>
                      ))}
                      <td className="py-1 px-2 text-center text-[10px] font-bold">{formatCurrency(compactAnnualTotal - compactAnnualTax)}</td>
                    </tr>
                  </>);
                })()}
                {activeTab === 'actual' && compactActualAnnualTax > 0 && (<>
                  <tr className="text-orange-300/60">
                    <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">과세합계</td>
                    {compactActualTotalMonthlyTax.map((tax, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">{tax > 0 ? formatCurrency(tax) : '-'}</td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(compactActualAnnualTax)}</td>
                  </tr>
                  <tr className="text-green-400/70">
                    <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">실 수령(세후)</td>
                    {compactMonthlyTotals.map((total, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">{total > 0 ? formatCurrency(total - (compactActualTotalMonthlyTax[i] || 0)) : '-'}</td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px] font-bold">{formatCurrency(compactAnnualTotal - compactActualAnnualTax)}</td>
                  </tr>
                </>)}
              </tfoot>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden w-full">
      <div className="p-3 bg-[#0f172a] border-b border-gray-700 flex items-center gap-2 flex-wrap">
        <span className="text-white font-bold text-sm">💰 분배금 현황</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-700 ml-2">
          <button
            onClick={() => setActiveTab('expected')}
            className={`px-3 py-1 text-xs font-bold transition-colors ${activeTab === 'expected' ? 'bg-blue-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
          >
            월 예상 분배금
          </button>
          <button
            onClick={() => setActiveTab('actual')}
            className={`px-3 py-1 text-xs font-bold transition-colors border-l border-gray-700 ${activeTab === 'actual' ? 'bg-emerald-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
          >
            월 입금 내역
          </button>
        </div>
        {activeTab === 'expected' && annualTotal > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-yellow-400 font-bold text-xs">연간 예상 {formatCurrency(annualTotal)}</span>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 text-[10px]">과세율</span>
              <input
                type="text"
                inputMode="decimal"
                value={getTaxRate(nonGoldPortfolios[0]?.id)}
                onChange={e => { const v = parseFloat(e.target.value); updatePortfolioDividendTaxRate(nonGoldPortfolios[0]?.id, isNaN(v) ? 0 : v); }}
                className="w-10 bg-[#1e293b] text-orange-300 text-[10px] text-center border border-gray-600 rounded px-1 py-0.5 outline-none"
              />
              <span className="text-gray-500 text-[10px]">%</span>
            </div>
            {annualTaxTotal > 0 && (
              <span className="text-orange-300/70 text-[10px]">예상 과세 {formatCurrency(annualTaxTotal)}</span>
            )}
            {annualTaxTotal > 0 && (
              <span className="text-green-400/80 text-[10px] font-bold">실 분배금(예상) {formatCurrency(annualTotal - annualTaxTotal)}</span>
            )}
          </div>
        )}
        {activeTab === 'actual' && actualAnnualTotal > 0 && (
          <div className="flex flex-col leading-tight">
            <span className="text-emerald-400 font-bold text-xs">분배금 합계 {formatCurrency(actualAnnualTotal)}</span>
            <span className="text-orange-300/80 text-[10px]">과세금액 합계 {totalTax > 0 ? formatCurrency(totalTax) : '-'}</span>
            {totalTax > 0 && (
              <span className="text-green-400/80 text-[10px] font-bold">실 수령(세후) {formatCurrency(actualAnnualTotal - totalTax)}</span>
            )}
          </div>
        )}
        <button
          onClick={handleRefreshAll}
          disabled={loading}
          className="ml-auto px-3 py-1 text-xs font-bold rounded-md border border-gray-600 text-gray-400 hover:bg-gray-700/50 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? '조회 중...' : '🔄 새로고침'}
        </button>
      </div>

      {/* 월 예상 분배금 탭 */}
      {activeTab === 'expected' && (
        <div className="overflow-x-auto">
          {loading && expectedRows.every(r => !r.hasDivData) ? (
            <div className="py-8 text-center text-blue-400 text-xs animate-pulse">분배금 데이터 조회 중...</div>
          ) : expectedRows.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-xs">주식·ETF 종목이 없습니다.</div>
          ) : (
            <table className="w-full text-[11px] text-center">
              <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                <tr>
                  <th className="py-3 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">종목명</th>
                  <th className="py-2 px-2 text-gray-500 min-w-[45px]">수량</th>
                  {MONTHS.map(m => (
                    <th key={m} className="py-2.5 px-1 min-w-[68px]">{m}</th>
                  ))}
                  <th className="py-2 px-2 min-w-[88px] text-yellow-500 font-bold">연간합계</th>
                </tr>
              </thead>
              <tbody>
                {expectedRows.map((row) => (
                  <tr key={`${row.portfolioId}-${row.code}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                    <td className="py-3 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-blue-300">
                      <div className="line-clamp-1">{row.name}</div>
                    </td>
                    <td className="py-2 px-2 text-gray-400">{row.qty.toLocaleString()}</td>
                    {row.monthData.map((d, i) => (
                      <td key={i} className={`py-1.5 px-1 text-center text-[10px] ${
                        d.amount > 0
                          ? d.isActual ? 'text-emerald-300 font-bold bg-emerald-900/25' : 'text-blue-300/70'
                          : 'text-gray-700'
                      }`}>
                        <div className="flex flex-col items-center gap-0">
                          {row.isOverseas && d.amountUsd > 0 && (
                            <span className="text-gray-400 text-[9px]">{formatUsd(d.amountUsd)}</span>
                          )}
                          <span>{d.amount > 0 ? formatCurrency(d.amount) : loading && !row.hasDivData ? '...' : '-'}</span>
                          {getTaxRate(row.portfolioId) > 0 && d.amount > 0 && (() => {
                            const taxAmt = Math.round(d.amount * getTaxRate(row.portfolioId) / 100);
                            return (<>
                              <span className="text-orange-300/55 text-[9px]">
                                {row.isOverseas ? `${formatUsd(d.amountUsd * getTaxRate(row.portfolioId) / 100)} ` : ''}
                                {formatCurrency(taxAmt)}
                              </span>
                              <span className="text-green-400/60 text-[9px]">{formatCurrency(d.amount - taxAmt)}</span>
                            </>);
                          })()}
                        </div>
                      </td>
                    ))}
                    <td className={`py-2 px-2 text-center font-bold ${row.annual > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                      <div className="flex flex-col items-center gap-0">
                        {row.isOverseas && row.annualUsd > 0 && (
                          <span className="text-gray-400 text-[9px] font-normal">{formatUsd(row.annualUsd)}</span>
                        )}
                        <span>{row.annual > 0 ? formatCurrency(row.annual) : loading && !row.hasDivData ? '...' : '-'}</span>
                        {getTaxRate(row.portfolioId) > 0 && row.annual > 0 && (() => {
                          const tax = Math.round(row.annual * getTaxRate(row.portfolioId) / 100);
                          return (<>
                            <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(tax)}</span>
                            <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - tax)}</span>
                          </>);
                        })()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td colSpan={2} className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                  {monthlyTotals.map((total, i) => (
                    <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-green-300' : 'text-gray-600'}`}>
                      {total > 0 ? formatCurrency(total) : '-'}
                    </td>
                  ))}
                  <td className="py-2 px-2 text-center font-bold text-yellow-300">
                    {annualTotal > 0 ? formatCurrency(annualTotal) : '-'}
                  </td>
                </tr>
                {annualTaxTotal > 0 && (<>
                  <tr className="text-orange-300/60">
                    <td colSpan={2} className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                      예상과세({getTaxRate(nonGoldPortfolios[0]?.id)}%)
                    </td>
                    {monthlyTaxTotals.map((tax, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">
                        {tax > 0 ? formatCurrency(tax) : '-'}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px]">
                      {annualTaxTotal > 0 ? formatCurrency(annualTaxTotal) : '-'}
                    </td>
                  </tr>
                  <tr className="text-green-400/70">
                    <td colSpan={2} className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">실 분배금(세후)</td>
                    {monthlyTotals.map((total, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">
                        {total > 0 ? formatCurrency(total - (monthlyTaxTotals[i] || 0)) : '-'}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px] font-bold">{formatCurrency(annualTotal - annualTaxTotal)}</td>
                  </tr>
                </>)}
              </tfoot>
            </table>
          )}
          {!loading && expectedRows.length > 0 && (
            <div className="px-3 py-1.5 bg-[#0f172a]/60 text-[10px] text-gray-600 border-t border-gray-700/50">
              초록 배경 = {CURRENT_YEAR}년 실제 지급 데이터 &nbsp;·&nbsp; 파란 글씨 = 직전연도 기준 예측
            </div>
          )}
        </div>
      )}

      {/* 월 입금 내역 탭 */}
      {activeTab === 'actual' && (
        <div className="overflow-x-auto">
          {actualRows.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-xs">주식·ETF 종목이 없습니다.</div>
          ) : (
            <table className="w-full text-[11px] text-center">
              <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                <tr>
                  <th className="py-3 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">종목명</th>
                  <th className="py-2 px-2 text-gray-500 min-w-[45px]">수량</th>
                  {MONTHS.map(m => (
                    <th key={m} className="py-2.5 px-1 min-w-[68px]">{m}</th>
                  ))}
                  <th className="py-2 px-2 min-w-[88px] text-emerald-500 font-bold">연간합계</th>
                </tr>
              </thead>
              <tbody>
                {actualRows.map((row) => (
                  <tr key={`${row.portfolioId}-${row.code}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                    <td className="py-3 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-blue-300">
                      <div className="line-clamp-1">{row.name}</div>
                    </td>
                    <td className="py-2 px-2 text-gray-400">{row.qty.toLocaleString()}</td>
                    {row.monthData.map((d, i) => {
                      const isEditing = editingCell?.portfolioId === row.portfolioId
                        && editingCell?.code === row.code
                        && editingCell?.monthIdx === i;
                      const pfForTax = nonGoldPortfolios.find(p => p.id === row.portfolioId);
                      const isManualTax = (pfForTax?.dividendTaxAmounts?.[row.code]?.[d.yearMonth] || 0) > 0;
                      const effectiveTax = getEffectiveTax(d.amount, row.portfolioId, row.code, d.yearMonth);
                      return (
                        <td
                          key={i}
                          onClick={() => !isEditing && handleCellClick(row, i)}
                          className={`py-0.5 px-0.5 text-center text-[10px] cursor-pointer transition-colors ${
                            isEditing
                              ? 'bg-blue-900/40'
                              : d.hasManual
                                ? d.amount > 0 ? 'text-emerald-300 font-bold bg-emerald-900/20 hover:bg-emerald-900/40' : 'text-gray-500 hover:bg-gray-700/30'
                                : d.amount > 0
                                  ? 'text-blue-300/60 hover:bg-gray-700/30'
                                  : 'text-gray-700 hover:bg-gray-700/30'
                          }`}
                        >
                          {isEditing ? (
                            <input
                              ref={inputRef}
                              type="text"
                              inputMode="numeric"
                              value={editingCell.value}
                              onChange={e => setEditingCell(prev => ({ ...prev, value: e.target.value }))}
                              onBlur={commitEdit}
                              onKeyDown={handleCellKeyDown}
                              className="w-full bg-transparent text-white text-right text-[10px] outline-none border-b border-blue-400 px-1"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-0.5">
                              {row.isOverseas && d.amountUsd > 0 && (
                                <span className="text-gray-400 text-[9px]">{formatUsd(d.amountUsd)}</span>
                              )}
                              <span>{d.amount > 0 ? formatCurrency(d.amount) : '-'}</span>
                              <div className="flex flex-col items-center w-full">
                                {row.isOverseas && effectiveTax > 0 && (
                                  <span className="text-orange-300/55 text-[9px]">{formatUsd(effectiveTax / usdkrw)}</span>
                                )}
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder={getTaxRate(row.portfolioId) > 0 && d.amount > 0 ? '' : '과세금액'}
                                  value={effectiveTax > 0 ? effectiveTax.toLocaleString() : ''}
                                  onChange={e => handleTaxChange(row.portfolioId, row.code, d.yearMonth, e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className={`w-full bg-transparent text-center text-[9px] border-b outline-none placeholder-gray-700 ${isManualTax ? 'text-orange-400 border-orange-700/40' : 'text-orange-300/55 border-gray-700/30'}`}
                                />
                              </div>
                              {effectiveTax > 0 && d.amount > 0 && (
                                <span className="text-green-400/60 text-[9px]">{formatCurrency(d.amount - effectiveTax)}</span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className={`py-2 px-2 text-center font-bold ${row.annual > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                      <div className="flex flex-col items-center gap-0">
                        {row.isOverseas && row.annualUsd > 0 && (
                          <span className="text-gray-400 text-[9px] font-normal">{formatUsd(row.annualUsd)}</span>
                        )}
                        <span>{row.annual > 0 ? formatCurrency(row.annual) : '-'}</span>
                        {(() => {
                          const rowAnnualTax = row.monthData.reduce((s, d) => {
                            const ym = d.yearMonth;
                            const pf = nonGoldPortfolios.find(p => p.id === row.portfolioId);
                            const manual = pf?.dividendTaxAmounts?.[row.code]?.[ym] || 0;
                            const rate = getTaxRate(row.portfolioId);
                            return s + (manual > 0 ? manual : (rate > 0 && d.amount > 0 ? Math.round(d.amount * rate / 100) : 0));
                          }, 0);
                          return rowAnnualTax > 0 && row.annual > 0 ? (<>
                            <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(rowAnnualTax)}</span>
                            <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - rowAnnualTax)}</span>
                          </>) : null;
                        })()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td colSpan={2} className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                  {actualMonthlyTotals.map((total, i) => (
                    <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>
                      {total > 0 ? formatCurrency(total) : '-'}
                    </td>
                  ))}
                  <td className="py-2 px-2 text-center font-bold text-emerald-300">
                    {actualAnnualTotal > 0 ? formatCurrency(actualAnnualTotal) : '-'}
                  </td>
                </tr>
                {actualAnnualTaxTotal > 0 && (<>
                  <tr className="text-orange-300/60">
                    <td colSpan={2} className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                      과세합계({getTaxRate(nonGoldPortfolios[0]?.id)}%)
                    </td>
                    {actualMonthlyTaxTotals.map((tax, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">
                        {tax > 0 ? formatCurrency(tax) : '-'}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px]">
                      {formatCurrency(actualAnnualTaxTotal)}
                    </td>
                  </tr>
                  <tr className="text-green-400/70">
                    <td colSpan={2} className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">실 수령(세후)</td>
                    {actualMonthlyTotals.map((total, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">
                        {total > 0 ? formatCurrency(total - (actualMonthlyTaxTotals[i] || 0)) : '-'}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px] font-bold">{formatCurrency(actualAnnualTotal - actualAnnualTaxTotal)}</td>
                  </tr>
                </>)}
              </tfoot>
            </table>
          )}
          <div className="px-3 py-1.5 bg-[#0f172a]/60 text-[10px] text-gray-600 border-t border-gray-700/50">
            셀 클릭 → 실제 입금액 직접 입력 (Enter 저장 · Esc 취소) &nbsp;·&nbsp; 초록 = 직접 입력 &nbsp;·&nbsp; 파란 = 예상값
          </div>
        </div>
      )}
    </div>
  );
}
