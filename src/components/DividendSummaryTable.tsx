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

export default function DividendSummaryTable({ portfolios, updatePortfolioDividendHistory, updatePortfolioActualDividend, updatePortfolioActualDividendUsd, updatePortfolioDividendTaxRate, updatePortfolioDividendTaxAmount, updatePortfolioActualAfterTaxUsd, updatePortfolioActualAfterTaxKrw, addPortfolioExtraRow, updatePortfolioExtraRowCode, deletePortfolioExtraRow, updatePortfolioExtraRowMonth, compact = false, usdkrw = 1300 }) {
  const [activeTab, setActiveTab] = useState('expected');
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const fetchedRef = useRef(new Set());
  const inputRef = useRef(null);
  const krwInputRef = useRef(null);
  const afterTaxBlurTimer = useRef(null);

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

  // Fix: 셀 identity(code+monthIdx+field)가 바뀔 때만 focus/select 실행
  const editingCellKey = editingCell
    ? `${editingCell.portfolioId}-${editingCell.code ?? editingCell.rowId}-${editingCell.monthIdx}-${editingCell.field}`
    : null;

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCellKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const actualDividendUsd = pf.actualDividendUsd || {};
      const isOverseas = pf.accountType === 'overseas';
      const taxRate = pf.dividendTaxRate ?? 15.4;
      (pf.portfolio || []).forEach(item => {
        if (!getCodeType(item.code, pf)) return;
        const qty = cleanNum(item.quantity);
        if (!qty) return;
        const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
        const monthData = Array.from({ length: 12 }, (_, i) => {
          const mo = String(i + 1).padStart(2, '0');
          const yearMonth = `${CURRENT_YEAR}-${mo}`;
          if (isOverseas) {
            const codeActualUsd = actualDividendUsd[item.code] || {};
            const codeAfterTaxUsd = (pf.actualAfterTaxUsd || {})[item.code] || {};
            const codeAfterTaxKrw = (pf.actualAfterTaxKrw || {})[item.code] || {};
            const hasManualGross = yearMonth in codeActualUsd;
            const grossUsd = hasManualGross ? codeActualUsd[yearMonth] : (pred[i + 1] || 0) * qty;
            const grossKrw = Math.round(grossUsd * usdkrw);
            const storedAfterUsd = codeAfterTaxUsd[yearMonth];
            const storedAfterKrw = codeAfterTaxKrw[yearMonth];
            const autoAfterUsd = grossUsd * (1 - taxRate / 100);
            const afterTaxUsd = storedAfterUsd != null ? storedAfterUsd : autoAfterUsd;
            const afterTaxKrw = storedAfterKrw != null ? storedAfterKrw : Math.round(afterTaxUsd * usdkrw);
            const hasManualAfterTax = storedAfterUsd != null || storedAfterKrw != null;
            return { grossUsd, grossKrw, afterTaxUsd, afterTaxKrw, hasManualGross, hasManualAfterTax, yearMonth };
          } else {
            const codeActual = actualDividend[item.code] || {};
            const hasManual = yearMonth in codeActual;
            const predicted = (pred[i + 1] || 0) * qty;
            const amount = hasManual ? codeActual[yearMonth] : predicted;
            return { amount, amountUsd: 0, predicted, hasManual, yearMonth };
          }
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
          annual: isOverseas
            ? monthData.reduce((s, d) => s + d.grossKrw, 0)
            : monthData.reduce((s, d) => s + d.amount, 0),
          annualUsd: isOverseas ? monthData.reduce((s, d) => s + d.grossUsd, 0) : 0,
          annualAfterKrw: isOverseas ? monthData.reduce((s, d) => s + d.afterTaxKrw, 0) : 0,
          annualAfterUsd: isOverseas ? monthData.reduce((s, d) => s + d.afterTaxUsd, 0) : 0,
        });
      });
    });
    return result;
  }, [nonGoldPortfolios]);

  // 수동 추가 행 (포트폴리오에서 제거된 종목의 과거 배당금 기록용)
  const extraActualRows = useMemo(() => {
    const result = [];
    nonGoldPortfolios.forEach(pf => {
      const isOverseas = pf.accountType === 'overseas';
      (pf.extraDividendRows || []).forEach(row => {
        const monthData = Array.from({ length: 12 }, (_, i) => {
          const mo = String(i + 1).padStart(2, '0');
          const yearMonth = `${CURRENT_YEAR}-${mo}`;
          const entry = row.monthData?.[yearMonth] || {};
          return { yearMonth, afterTaxUsd: entry.afterTaxUsd || 0, afterTaxKrw: entry.afterTaxKrw || 0 };
        });
        result.push({
          portfolioId: pf.id,
          rowId: row.id,
          code: row.code || '',
          isOverseas,
          isExtra: true,
          monthData,
          annualAfterKrw: monthData.reduce((s, d) => s + d.afterTaxKrw, 0),
          annualAfterUsd: isOverseas ? monthData.reduce((s, d) => s + d.afterTaxUsd, 0) : 0,
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
      const actualDividendUsd = pf.actualDividendUsd || {};
      const isOverseas = pf.accountType === 'overseas';
      const taxRate = pf.dividendTaxRate ?? 15.4;
      const monthData = Array.from({ length: 12 }, (_, i) => {
        const mo = String(i + 1).padStart(2, '0');
        const yearMonth = `${CURRENT_YEAR}-${mo}`;
        if (isOverseas) {
          let pfAfterUsd = 0, pfAfterKrw = 0, pfGrossKrw = 0;
          (pf.portfolio || []).forEach(item => {
            if (!getCodeType(item.code, pf)) return;
            const qty = cleanNum(item.quantity);
            if (!qty) return;
            const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
            const codeActualUsd = actualDividendUsd[item.code] || {};
            const codeAfterTaxUsd = (pf.actualAfterTaxUsd || {})[item.code] || {};
            const codeAfterTaxKrw = (pf.actualAfterTaxKrw || {})[item.code] || {};
            const grossUsd = yearMonth in codeActualUsd ? codeActualUsd[yearMonth] : (pred[i + 1] || 0) * qty;
            const storedAfterUsd = codeAfterTaxUsd[yearMonth];
            const storedAfterKrw = codeAfterTaxKrw[yearMonth];
            let afterUsd, afterKrw;
            if (storedAfterUsd != null) {
              afterUsd = storedAfterUsd;
              afterKrw = storedAfterKrw != null ? storedAfterKrw : Math.round(afterUsd * usdkrw);
            } else if (storedAfterKrw != null && usdkrw > 0) {
              afterKrw = storedAfterKrw;
              afterUsd = afterKrw / usdkrw;
            } else {
              afterUsd = grossUsd * (1 - taxRate / 100);
              afterKrw = Math.round(afterUsd * usdkrw);
            }
            pfAfterUsd += afterUsd;
            pfAfterKrw += afterKrw;
            pfGrossKrw += Math.round(grossUsd * usdkrw);
          });
          let extraAfterUsd = 0, extraAfterKrw = 0;
          (pf.extraDividendRows || []).forEach(row => {
            const entry = row.monthData?.[yearMonth] || {};
            extraAfterUsd += entry.afterTaxUsd || 0;
            extraAfterKrw += entry.afterTaxKrw || 0;
          });
          return {
            amount: pfAfterKrw + extraAfterKrw,
            amountUsd: pfAfterUsd + extraAfterUsd,
            taxKrw: Math.max(0, pfGrossKrw - pfAfterKrw),
            yearMonth,
          };
        } else {
          let amount = (pf.portfolio || []).reduce((sum, item) => {
            if (!getCodeType(item.code, pf)) return sum;
            const qty = cleanNum(item.quantity);
            if (!qty) return sum;
            const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
            const codeActual = actualDividend[item.code] || {};
            const predicted = (pred[i + 1] || 0) * qty;
            return sum + (yearMonth in codeActual ? codeActual[yearMonth] : predicted);
          }, 0);
          amount += (pf.extraDividendRows || []).reduce((s, row) => {
            const entry = row.monthData?.[yearMonth] || {};
            return s + (entry.afterTaxKrw || 0);
          }, 0);
          return { amount, amountUsd: 0, taxKrw: 0, yearMonth };
        }
      });
      const annual = monthData.reduce((s, d) => s + d.amount, 0);
      const annualUsd = isOverseas ? monthData.reduce((s, d) => s + d.amountUsd, 0) : 0;
      const annualTaxKrw = isOverseas ? monthData.reduce((s, d) => s + d.taxKrw, 0) : 0;
      return { portfolioId: pf.id, portfolioTitle: pf.title || pf.name || '계좌', rowColor: pf.rowColor || '', isOverseas, monthData, annual, annualUsd, annualTaxKrw };
    }).filter(row => row.annual > 0);
  }, [compact, nonGoldPortfolios]);

  const commitEdit = () => {
    if (!editingCell) return;
    const { portfolioId, code, yearMonth, field, isOverseas, isExtra, rowId } = editingCell;
    if (isExtra) {
      const usdNum = isOverseas ? (parseFloat(String(editingCell.usdValue || '').replace(/,/g, '')) || 0) : 0;
      const krwNum = parseFloat(String(isOverseas ? (editingCell.krwValue || '') : (editingCell.value || '')).replace(/,/g, '')) || 0;
      updatePortfolioExtraRowMonth(portfolioId, rowId, yearMonth, usdNum, krwNum);
      setEditingCell(null);
      return;
    }
    if (field === 'gross' && isOverseas) {
      const num = parseFloat(String(editingCell.value).replace(/,/g, '')) || 0;
      updatePortfolioActualDividendUsd(portfolioId, code, yearMonth, num);
    } else if (field === 'afterTax') {
      const usdNum = parseFloat(String(editingCell.usdValue || '').replace(/,/g, '')) || 0;
      const krwNum = parseFloat(String(editingCell.krwValue || '').replace(/,/g, '')) || 0;
      updatePortfolioActualAfterTaxUsd(portfolioId, code, yearMonth, usdNum);
      updatePortfolioActualAfterTaxKrw(portfolioId, code, yearMonth, krwNum);
    } else if (!isOverseas) {
      const num = parseFloat(String(editingCell.value).replace(/,/g, '')) || 0;
      updatePortfolioActualDividend(portfolioId, code, yearMonth, num);
    }
    setEditingCell(null);
  };

  const handleGrossCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, code: row.code, monthIdx,
      yearMonth: d.yearMonth, isOverseas: true, field: 'gross',
      value: d.hasManualGross ? String(d.grossUsd) : '',
    });
  };

  const handleAfterTaxCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, code: row.code, monthIdx,
      yearMonth: d.yearMonth, isOverseas: true, field: 'afterTax',
      usdValue: d.afterTaxUsd > 0 ? String(Number(d.afterTaxUsd.toFixed(4))) : '',
      krwValue: d.afterTaxKrw > 0 ? String(d.afterTaxKrw) : '',
    });
  };

  const handleKrwCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, code: row.code, monthIdx,
      yearMonth: d.yearMonth, isOverseas: false, field: 'krw',
      value: d.amount > 0 ? String(d.amount) : '',
    });
  };

  const handleExtraOverseasCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, rowId: row.rowId, monthIdx,
      yearMonth: d.yearMonth, isOverseas: true, field: 'afterTax', isExtra: true,
      usdValue: d.afterTaxUsd > 0 ? String(Number(d.afterTaxUsd.toFixed(4))) : '',
      krwValue: d.afterTaxKrw > 0 ? String(d.afterTaxKrw) : '',
    });
  };

  const handleExtraKrwCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, rowId: row.rowId, monthIdx,
      yearMonth: d.yearMonth, isOverseas: false, field: 'krw', isExtra: true,
      value: d.afterTaxKrw > 0 ? String(d.afterTaxKrw) : '',
    });
  };

  const handleCellKeyDown = (e) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingCell(null);
  };

  const handleAfterTaxBlur = () => {
    afterTaxBlurTimer.current = setTimeout(commitEdit, 150);
  };

  const handleAfterTaxFocus = () => {
    if (afterTaxBlurTimer.current) clearTimeout(afterTaxBlurTimer.current);
  };

  const handleTaxChange = (portfolioId, code, yearMonth, value) => {
    const num = parseFloat(String(value).replace(/,/g, '')) || 0;
    updatePortfolioDividendTaxAmount(portfolioId, code, yearMonth, num);
  };

  const getTaxRate = (portfolioId) => {
    const pf = nonGoldPortfolios.find(p => p.id === portfolioId);
    return pf?.dividendTaxRate ?? 15.4;
  };

  // 비해외 계좌 전용 세금 계산
  const getEffectiveTax = (amount, portfolioId, code, yearMonth) => {
    const pf = nonGoldPortfolios.find(p => p.id === portfolioId);
    const manualKrw = pf?.dividendTaxAmounts?.[code]?.[yearMonth] || 0;
    if (manualKrw > 0) return manualKrw;
    const rate = getTaxRate(portfolioId);
    if (rate > 0 && amount > 0) return Math.round(amount * rate / 100);
    return 0;
  };

  // 비해외 계좌 전용 월 세금 합계 (compact 모드)
  const getPortfolioMonthTax = (pf, monthIdx) => {
    const mo = String(monthIdx + 1).padStart(2, '0');
    const yearMonth = `${CURRENT_YEAR}-${mo}`;
    const divHistory = pf.dividendHistory || {};
    const actualDividend = pf.actualDividend || {};
    return (pf.portfolio || []).reduce((sum, item) => {
      if (!getCodeType(item.code, pf)) return sum;
      const qty = cleanNum(item.quantity);
      if (!qty) return sum;
      const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
      const codeActual = actualDividend[item.code] || {};
      const predicted = (pred[monthIdx + 1] || 0) * qty;
      const amount = yearMonth in codeActual ? codeActual[yearMonth] : predicted;
      return sum + getEffectiveTax(amount, pf.id, item.code, yearMonth);
    }, 0);
  };

  if (!nonGoldPortfolios.length) return null;

  // ── 월 예상 분배금 탭 totals ──
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
  const monthlyUsdTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.filter(r => r.isOverseas).reduce((sum, row) => sum + row.monthData[i].amountUsd, 0)
  );
  const annualUsdTotal = monthlyUsdTotals.reduce((s, v) => s + v, 0);
  const monthlyUsdTaxTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.filter(r => r.isOverseas).reduce((sum, row) => {
      const rate = getTaxRate(row.portfolioId);
      return sum + row.monthData[i].amountUsd * rate / 100;
    }, 0)
  );
  const annualUsdTaxTotal = monthlyUsdTaxTotals.reduce((s, v) => s + v, 0);

  // ── 월 입금 내역 탭 totals (수동 추가 행 포함) ──
  const actualHasOverseas = actualRows.some(r => r.isOverseas) || extraActualRows.some(r => r.isOverseas);

  const actualMonthlyGrossKrw = Array.from({ length: 12 }, (_, i) =>
    actualRows.reduce((s, r) => s + (r.isOverseas ? r.monthData[i].grossKrw : r.monthData[i].amount), 0) +
    extraActualRows.reduce((s, r) => s + r.monthData[i].afterTaxKrw, 0)
  );
  const actualMonthlyGrossUsd = Array.from({ length: 12 }, (_, i) =>
    actualRows.filter(r => r.isOverseas).reduce((s, r) => s + r.monthData[i].grossUsd, 0) +
    extraActualRows.filter(r => r.isOverseas).reduce((s, r) => s + r.monthData[i].afterTaxUsd, 0)
  );
  const actualMonthlyAfterKrw = Array.from({ length: 12 }, (_, i) =>
    actualRows.reduce((s, r) => {
      if (r.isOverseas) return s + r.monthData[i].afterTaxKrw;
      const d = r.monthData[i];
      return s + Math.max(0, d.amount - getEffectiveTax(d.amount, r.portfolioId, r.code, d.yearMonth));
    }, 0) +
    extraActualRows.reduce((s, r) => s + r.monthData[i].afterTaxKrw, 0)
  );
  const actualMonthlyAfterUsd = Array.from({ length: 12 }, (_, i) =>
    actualRows.filter(r => r.isOverseas).reduce((s, r) => s + r.monthData[i].afterTaxUsd, 0) +
    extraActualRows.filter(r => r.isOverseas).reduce((s, r) => s + r.monthData[i].afterTaxUsd, 0)
  );
  const actualAnnualGrossKrw = actualMonthlyGrossKrw.reduce((s, v) => s + v, 0);
  const actualAnnualGrossUsd = actualMonthlyGrossUsd.reduce((s, v) => s + v, 0);
  const actualAnnualAfterKrw = actualMonthlyAfterKrw.reduce((s, v) => s + v, 0);
  const actualAnnualAfterUsd = actualMonthlyAfterUsd.reduce((s, v) => s + v, 0);
  const actualMonthlyTaxTotals = Array.from({ length: 12 }, (_, i) =>
    actualRows.filter(r => !r.isOverseas).reduce((s, r) => {
      const d = r.monthData[i];
      return s + getEffectiveTax(d.amount, r.portfolioId, r.code, d.yearMonth);
    }, 0)
  );
  const actualAnnualTaxTotal = actualMonthlyTaxTotals.reduce((s, v) => s + v, 0);

  // ── compact 모드 totals ──
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
    if (!pf || pf.accountType === 'overseas') {
      compactActualTaxMap[row.portfolioId] = { monthlyTax: Array(12).fill(0), annualTax: 0 };
      return;
    }
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
    const compactActualHasOverseas = compactActualRows.some(r => r.isOverseas);
    const compactActualAnnualUsd = compactActualRows.reduce((s, r) => s + (r.annualUsd || 0), 0);
    const compactActualMonthlyUsd = Array.from({ length: 12 }, (_, i) =>
      compactActualRows.filter(r => r.isOverseas).reduce((s, r) => s + (r.monthData[i].amountUsd || 0), 0)
    );
    const compactActualMonthlyOverseasTaxKrw = Array.from({ length: 12 }, (_, i) =>
      compactActualRows.filter(r => r.isOverseas).reduce((s, r) => s + (r.monthData[i].taxKrw || 0), 0)
    );
    const compactActualMonthlyTaxCombined = Array.from({ length: 12 }, (_, i) =>
      compactActualTotalMonthlyTax[i] + compactActualMonthlyOverseasTaxKrw[i]
    );
    const compactActualAnnualTaxCombined = compactActualMonthlyTaxCombined.reduce((s, v) => s + v, 0);
    const compactActualMonthlyDomesticKrw = Array.from({ length: 12 }, (_, i) =>
      compactActualRows.filter(r => !r.isOverseas).reduce((s, r) => s + r.monthData[i].amount, 0)
    );
    const compactActualDomesticAnnual = compactActualRows.filter(r => !r.isOverseas).reduce((s, r) => s + r.annual, 0);
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
            <div className="text-[10px] leading-[1.65]">
              {activeTab === 'expected' ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 w-14 shrink-0">연간 예상</span>
                    <span className="text-yellow-400 font-bold tabular-nums">{formatCurrency(totalAnnual)}</span>
                  </div>
                  {compactAnnualTax > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 w-14 shrink-0">세후(예상)</span>
                      <span className="text-emerald-400/45 text-[9px] tabular-nums">{formatCurrency(totalAnnual - compactAnnualTax)}</span>
                    </div>
                  )}
                  {compactAnnualTax > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 w-14 shrink-0">과세</span>
                      <span className="text-orange-300/40 text-[9px] tabular-nums">{formatCurrency(compactAnnualTax)}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 w-14 shrink-0">세후합계</span>
                    {compactActualHasOverseas && compactActualAnnualUsd > 0 && <span className="text-emerald-400 font-bold text-xs w-[4.8rem] text-right tabular-nums shrink-0">{formatUsd(compactActualAnnualUsd)}</span>}
                    {compactActualHasOverseas && compactActualDomesticAnnual > 0 && <span className="text-gray-700">|</span>}
                    {compactActualHasOverseas
                      ? compactActualDomesticAnnual > 0 && <span className="text-emerald-400/45 text-[9px] tabular-nums">{formatCurrency(compactActualDomesticAnnual)}</span>
                      : <span className="text-emerald-400 font-bold tabular-nums">{formatCurrency(totalAnnual)}</span>
                    }
                  </div>
                  {compactActualAnnualTaxCombined > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 w-14 shrink-0">과세합계</span>
                      <span className="text-orange-300/40 text-[9px] tabular-nums">{formatCurrency(compactActualAnnualTaxCombined)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <button
            onClick={handleRefreshAll}
            disabled={loading}
            title={loading ? '조회 중...' : '새로고침'}
            className="ml-auto w-7 h-7 flex items-center justify-center rounded border border-gray-600/70 text-gray-400 hover:bg-gray-700/50 hover:text-gray-200 hover:border-gray-500 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 16 16" className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8A5.5 5.5 0 1 1 10 3.07"/>
              <polyline points="10 1 10 4 13 4"/>
            </svg>
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
                        if (activeTab === 'actual' && row.isOverseas) {
                          return (
                            <td key={i} className={`py-1.5 px-1 text-center text-[10px] ${d.amountUsd > 0 ? 'text-emerald-400' : 'text-gray-700'}`}>
                              <div className="flex flex-col items-center justify-center gap-0">
                                <span className="font-semibold">{d.amountUsd > 0 ? formatUsd(d.amountUsd) : '-'}</span>
                                {d.amount > 0 && <span className="text-emerald-400/40 text-[9px]">{formatCurrency(d.amount)}</span>}
                                {d.taxKrw > 0 && <span className="text-orange-300/55 text-[9px]">{formatCurrency(d.taxKrw)}</span>}
                              </div>
                            </td>
                          );
                        }
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
                      {activeTab === 'actual' && row.isOverseas ? (
                        <td className={`py-2 px-2 text-center font-bold ${row.annualUsd > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center justify-center gap-0">
                            <span>{row.annualUsd > 0 ? formatUsd(row.annualUsd) : '-'}</span>
                            {row.annual > 0 && <span className="text-emerald-400/40 text-[9px] font-normal">{formatCurrency(row.annual)}</span>}
                            {row.annualTaxKrw > 0 && <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(row.annualTaxKrw)}</span>}
                          </div>
                        </td>
                      ) : (
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
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                  {activeTab === 'actual' && compactActualHasOverseas ? (
                    compactActualMonthlyUsd.map((usdTotal, i) => (
                      <td key={i} className="py-2.5 px-1 text-center font-bold text-[10px]">
                        <div className="flex flex-col items-center">
                          {usdTotal > 0 ? <span className="text-emerald-300">{formatUsd(usdTotal)}</span> : null}
                          {compactActualMonthlyDomesticKrw[i] > 0 ? <span className="text-emerald-300/40 text-[9px]">{formatCurrency(compactActualMonthlyDomesticKrw[i])}</span> : (!usdTotal ? <span className="text-gray-600">-</span> : null)}
                        </div>
                      </td>
                    ))
                  ) : (
                    compactMonthlyTotals.map((total, i) => (
                      <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-green-300' : 'text-gray-600'}`}>
                        {total > 0 ? formatCurrency(total) : '-'}
                      </td>
                    ))
                  )}
                  {activeTab === 'actual' && compactActualHasOverseas ? (
                    <td className="py-2 px-2 text-center font-bold text-emerald-300">
                      <div className="flex flex-col items-center">
                        {compactActualAnnualUsd > 0 && <span>{formatUsd(compactActualAnnualUsd)}</span>}
                        {compactActualDomesticAnnual > 0 && <span className="text-emerald-300/40 text-[9px] font-normal">{formatCurrency(compactActualDomesticAnnual)}</span>}
                      </div>
                    </td>
                  ) : (
                    <td className={`py-2 px-2 text-center font-bold ${activeTab === 'expected' ? 'text-yellow-300' : 'text-emerald-300'}`}>
                      {totalAnnual > 0 ? formatCurrency(totalAnnual) : '-'}
                    </td>
                  )}
                </tr>
                {activeTab === 'expected' && compactAnnualTax > 0 && (() => {
                  const monthlyTaxArr = Array.from({ length: 12 }, (_, i) =>
                    compactExpectedRows.reduce((sum, row) => {
                      const rate = getTaxRate(row.portfolioId);
                      return sum + Math.round((row.monthData[i]?.amount || 0) * rate / 100);
                    }, 0)
                  );
                  return (
                    <tr className="text-orange-300/60">
                      <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">과세합계</td>
                      {monthlyTaxArr.map((tax, i) => (
                        <td key={i} className="py-1 px-1 text-center text-[9px]">{tax > 0 ? formatCurrency(tax) : '-'}</td>
                      ))}
                      <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(compactAnnualTax)}</td>
                    </tr>
                  );
                })()}
                {activeTab === 'actual' && compactActualAnnualTaxCombined > 0 && (
                  <tr className="text-orange-300/60">
                    <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">과세합계</td>
                    {compactActualMonthlyTaxCombined.map((tax, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">{tax > 0 ? formatCurrency(tax) : '-'}</td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(compactActualAnnualTaxCombined)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden w-full">
      <div className="px-3 py-2.5 bg-[#0f172a] border-b border-gray-700 flex items-start gap-3">
        <span className="text-white font-bold text-sm shrink-0 self-center">💰 분배금 현황</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-700 shrink-0 self-center">
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
          <div className="flex items-start gap-3 self-center">
            <div className="text-[10px] leading-[1.65]">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 w-12 shrink-0">세전합계</span>
                {annualUsdTotal > 0 && <span className="text-blue-300 font-bold text-xs w-[4.8rem] text-right tabular-nums shrink-0">{formatUsd(annualUsdTotal)}</span>}
                {annualUsdTotal > 0 && <span className="text-gray-700">|</span>}
                <span className="text-blue-300/45 text-[9px] tabular-nums">{formatCurrency(annualTotal)}</span>
              </div>
              {annualTaxTotal > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 w-12 shrink-0">세후(예상)</span>
                  {annualUsdTaxTotal > 0 && <span className="text-emerald-400 font-bold text-xs w-[4.8rem] text-right tabular-nums shrink-0">{formatUsd(annualUsdTotal - annualUsdTaxTotal)}</span>}
                  {annualUsdTaxTotal > 0 && <span className="text-gray-700">|</span>}
                  <span className="text-emerald-400/45 text-[9px] tabular-nums">{formatCurrency(annualTotal - annualTaxTotal)}</span>
                </div>
              )}
              {annualTaxTotal > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 w-12 shrink-0">과세</span>
                  {annualUsdTaxTotal > 0 && <span className="text-orange-300/80 font-semibold text-xs w-[4.8rem] text-right tabular-nums shrink-0">{formatUsd(annualUsdTaxTotal)}</span>}
                  {annualUsdTaxTotal > 0 && <span className="text-gray-700">|</span>}
                  <span className="text-orange-300/40 text-[9px] tabular-nums">{formatCurrency(annualTaxTotal)}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-0.5 self-center">
              <span className="text-gray-500 text-[10px]">과세율</span>
              <input
                type="text"
                inputMode="decimal"
                value={getTaxRate(nonGoldPortfolios[0]?.id)}
                onChange={e => { const v = parseFloat(e.target.value); updatePortfolioDividendTaxRate(nonGoldPortfolios[0]?.id, isNaN(v) ? 0 : v); }}
                className="w-10 bg-transparent text-orange-300 text-[10px] text-center border-b border-gray-600/50 outline-none"
              />
              <span className="text-gray-500 text-[10px]">%</span>
            </div>
          </div>
        )}
        {activeTab === 'actual' && actualAnnualGrossKrw > 0 && (
          <div className="text-[10px] leading-[1.65] self-center">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500 w-12 shrink-0">세전합계</span>
              {actualAnnualGrossUsd > 0 && <span className="text-blue-300 font-bold text-xs w-[4.8rem] text-right tabular-nums shrink-0">{formatUsd(actualAnnualGrossUsd)}</span>}
              {actualAnnualGrossUsd > 0 && <span className="text-gray-700">|</span>}
              <span className="text-blue-300/45 text-[9px] tabular-nums">{formatCurrency(actualAnnualGrossKrw)}</span>
            </div>
            {actualAnnualAfterKrw > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 w-12 shrink-0">세후</span>
                {actualAnnualAfterUsd > 0 && <span className="text-emerald-400 font-bold text-xs w-[4.8rem] text-right tabular-nums shrink-0">{formatUsd(actualAnnualAfterUsd)}</span>}
                {actualAnnualAfterUsd > 0 && <span className="text-gray-700">|</span>}
                <span className="text-emerald-400/45 text-[9px] tabular-nums">{formatCurrency(actualAnnualAfterKrw)}</span>
              </div>
            )}
            {(actualAnnualGrossKrw - actualAnnualAfterKrw) > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 w-12 shrink-0">과세</span>
                {actualAnnualGrossUsd > 0 && <span className="text-orange-300/80 font-semibold text-xs w-[4.8rem] text-right tabular-nums shrink-0">{formatUsd(actualAnnualGrossUsd - actualAnnualAfterUsd)}</span>}
                {actualAnnualGrossUsd > 0 && <span className="text-gray-700">|</span>}
                <span className="text-orange-300/40 text-[9px] tabular-nums">{formatCurrency(actualAnnualGrossKrw - actualAnnualAfterKrw)}</span>
              </div>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0 self-center">
          {activeTab === 'actual' && addPortfolioExtraRow && (
            <button
              onClick={() => addPortfolioExtraRow(nonGoldPortfolios[0]?.id)}
              title="과거 종목 배당금 행 추가"
              className="w-7 h-7 flex items-center justify-center rounded border border-emerald-700/50 text-emerald-400/80 hover:bg-emerald-900/30 hover:text-emerald-300 hover:border-emerald-600 active:scale-95 transition-all"
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13"/>
                <line x1="3" y1="8" x2="13" y2="8"/>
              </svg>
            </button>
          )}
          <button
            onClick={handleRefreshAll}
            disabled={loading}
            title={loading ? '조회 중...' : '새로고침'}
            className="w-7 h-7 flex items-center justify-center rounded border border-gray-600/70 text-gray-400 hover:bg-gray-700/50 hover:text-gray-200 hover:border-gray-500 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 16 16" className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8A5.5 5.5 0 1 1 10 3.07"/>
              <polyline points="10 1 10 4 13 4"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 월 예상 분배금 탭 */}
      {activeTab === 'expected' && (() => {
        const expectedHasOverseas = expectedRows.some(r => r.isOverseas);
        return (
          <div className="overflow-x-auto">
            {loading && expectedRows.every(r => !r.hasDivData) ? (
              <div className="py-8 text-center text-blue-400 text-xs animate-pulse">분배금 데이터 조회 중...</div>
            ) : expectedRows.length === 0 ? (
              <div className="py-8 text-center text-gray-500 text-xs">주식·ETF 종목이 없습니다.</div>
            ) : (
              <table className="w-full text-[11px] text-center">
                <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                  <tr>
                    <th className="py-3 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">코드</th>
                    <th className="py-2 px-2 text-gray-500 min-w-[45px]">수량</th>
                    {MONTHS.map(m => (
                      <th key={m} colSpan={expectedHasOverseas ? 2 : 1} className="py-2.5 px-1 min-w-[68px]">{m}</th>
                    ))}
                    <th colSpan={expectedHasOverseas ? 2 : 1} className="py-2 px-2 min-w-[88px] text-yellow-500 font-bold">연간합계</th>
                  </tr>
                  {expectedHasOverseas && (
                    <tr className="text-[9px] border-b border-gray-700/50">
                      <th className="sticky left-0 z-10 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]"></th>
                      <th></th>
                      {MONTHS.map(m => (
                        <React.Fragment key={m}>
                          <th className="py-1 text-blue-400 font-normal min-w-[62px]">세전</th>
                          <th className="py-1 text-emerald-400 font-normal min-w-[62px]">세후</th>
                        </React.Fragment>
                      ))}
                      <th className="py-1 text-blue-400 font-normal min-w-[62px]">세전</th>
                      <th className="py-1 text-emerald-400 font-normal min-w-[62px]">세후</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {expectedRows.map((row) => {
                    const taxRate = getTaxRate(row.portfolioId);
                    return (
                      <tr key={`${row.portfolioId}-${row.code}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                        <td className="py-3 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-blue-300">
                          <div className="line-clamp-1">{row.name || row.code}</div>
                          {row.name && <div className="text-gray-500 text-[9px] font-normal">({row.code})</div>}
                        </td>
                        <td className="py-2 px-2 text-gray-400">{row.qty.toLocaleString()}</td>
                        {row.isOverseas && expectedHasOverseas ? (
                          row.monthData.map((d, i) => {
                            const afterTaxUsd = d.amountUsd * (1 - taxRate / 100);
                            const afterTaxKrw = Math.round(afterTaxUsd * usdkrw);
                            const isLastCol = i === 11;
                            return (
                              <React.Fragment key={i}>
                                <td className={`py-0.5 px-1 text-center text-[10px] border-r border-gray-700/20 ${
                                  d.amountUsd > 0
                                    ? d.isActual ? 'text-blue-300 font-bold bg-blue-900/10' : 'text-blue-300/60'
                                    : 'text-gray-700'
                                }`}>
                                  <div className="flex flex-col items-center gap-0">
                                    <span>{d.amountUsd > 0 ? formatUsd(d.amountUsd) : loading && !row.hasDivData ? '...' : '-'}</span>
                                    {d.amount > 0 && <span className="text-gray-500 text-[9px]">{formatCurrency(d.amount)}</span>}
                                  </div>
                                </td>
                                <td className={`py-0.5 px-1 text-center text-[10px] ${isLastCol ? '' : 'border-r border-gray-600/40'} ${
                                  afterTaxUsd > 0
                                    ? d.isActual ? 'text-emerald-300 font-bold bg-emerald-900/10' : 'text-emerald-300/70'
                                    : 'text-gray-700'
                                }`}>
                                  <div className="flex flex-col items-center gap-0">
                                    <span>{afterTaxUsd > 0 ? formatUsd(afterTaxUsd) : '-'}</span>
                                    {afterTaxKrw > 0 && <span className="text-gray-500 text-[9px]">{formatCurrency(afterTaxKrw)}</span>}
                                  </div>
                                </td>
                              </React.Fragment>
                            );
                          })
                        ) : (
                          row.monthData.map((d, i) => (
                            <td key={i} colSpan={expectedHasOverseas ? 2 : 1} className={`py-1.5 px-1 text-center text-[10px] ${
                              d.amount > 0
                                ? d.isActual ? 'text-emerald-300 font-bold bg-emerald-900/25' : 'text-blue-300/70'
                                : 'text-gray-700'
                            }`}>
                              <div className="flex flex-col items-center gap-0">
                                <span>{d.amount > 0 ? formatCurrency(d.amount) : loading && !row.hasDivData ? '...' : '-'}</span>
                                {taxRate > 0 && d.amount > 0 && (() => {
                                  const taxAmt = Math.round(d.amount * taxRate / 100);
                                  return (<>
                                    <span className="text-orange-300/55 text-[9px]">{formatCurrency(taxAmt)}</span>
                                    <span className="text-green-400/60 text-[9px]">{formatCurrency(d.amount - taxAmt)}</span>
                                  </>);
                                })()}
                              </div>
                            </td>
                          ))
                        )}
                        {row.isOverseas && expectedHasOverseas ? (() => {
                          const annualAfterUsd = row.annualUsd * (1 - taxRate / 100);
                          const annualAfterKrw = Math.round(annualAfterUsd * usdkrw);
                          return (
                            <React.Fragment key="annual">
                              <td className={`py-2 px-2 text-center font-bold border-r border-gray-700/20 ${row.annualUsd > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                                <div className="flex flex-col items-center gap-0">
                                  <span>{row.annualUsd > 0 ? formatUsd(row.annualUsd) : loading && !row.hasDivData ? '...' : '-'}</span>
                                  {row.annual > 0 && <span className="text-gray-400 text-[9px] font-normal">{formatCurrency(row.annual)}</span>}
                                </div>
                              </td>
                              <td className={`py-2 px-2 text-center font-bold ${annualAfterUsd > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                                <div className="flex flex-col items-center gap-0">
                                  <span>{annualAfterUsd > 0 ? formatUsd(annualAfterUsd) : '-'}</span>
                                  {annualAfterKrw > 0 && <span className="text-gray-400 text-[9px] font-normal">{formatCurrency(annualAfterKrw)}</span>}
                                </div>
                              </td>
                            </React.Fragment>
                          );
                        })() : (
                          <td colSpan={expectedHasOverseas ? 2 : 1} className={`py-2 px-2 text-center font-bold ${row.annual > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-center gap-0">
                              <span>{row.annual > 0 ? formatCurrency(row.annual) : loading && !row.hasDivData ? '...' : '-'}</span>
                              {taxRate > 0 && row.annual > 0 && (() => {
                                const tax = Math.round(row.annual * taxRate / 100);
                                return (<>
                                  <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(tax)}</span>
                                  <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - tax)}</span>
                                </>);
                              })()}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                  <tr>
                    <td colSpan={2} className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                    {expectedHasOverseas ? (
                      MONTHS.map((_, i) => (
                        <React.Fragment key={i}>
                          <td className={`py-2.5 px-1 text-center font-bold text-[10px] border-r border-gray-700/20 ${monthlyUsdTotals[i] > 0 ? 'text-blue-300/70' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-center">
                              {monthlyUsdTotals[i] > 0 && <span>{formatUsd(monthlyUsdTotals[i])}</span>}
                              {monthlyTotals[i] > 0 ? formatCurrency(monthlyTotals[i]) : '-'}
                            </div>
                          </td>
                          <td className={`py-2.5 px-1 text-center font-bold text-[10px] ${i < 11 ? 'border-r border-gray-600/40' : ''} ${(monthlyUsdTotals[i] - monthlyUsdTaxTotals[i]) > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-center">
                              {monthlyUsdTotals[i] > 0 && <span>{formatUsd(monthlyUsdTotals[i] - monthlyUsdTaxTotals[i])}</span>}
                              {monthlyTotals[i] > 0 ? formatCurrency(monthlyTotals[i] - (monthlyTaxTotals[i] || 0)) : '-'}
                            </div>
                          </td>
                        </React.Fragment>
                      ))
                    ) : (
                      monthlyTotals.map((total, i) => (
                        <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-green-300' : 'text-gray-600'}`}>
                          {total > 0 ? formatCurrency(total) : '-'}
                        </td>
                      ))
                    )}
                    {expectedHasOverseas ? (
                      <>
                        <td className="py-2 px-2 text-center font-bold text-blue-300 border-r border-gray-700/20">
                          <div className="flex flex-col items-center">
                            {annualUsdTotal > 0 && <span className="text-[9px] font-normal">{formatUsd(annualUsdTotal)}</span>}
                            {annualTotal > 0 ? formatCurrency(annualTotal) : '-'}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center font-bold text-emerald-300">
                          <div className="flex flex-col items-center">
                            {annualUsdTotal > 0 && <span className="text-[9px] font-normal">{formatUsd(annualUsdTotal - annualUsdTaxTotal)}</span>}
                            {annualTotal > 0 ? formatCurrency(annualTotal - annualTaxTotal) : '-'}
                          </div>
                        </td>
                      </>
                    ) : (
                      <td className="py-2 px-2 text-center font-bold text-yellow-300">
                        <div className="flex flex-col items-center">
                          {annualUsdTotal > 0 && <span className="text-gray-400 text-[9px] font-normal">{formatUsd(annualUsdTotal)}</span>}
                          {annualTotal > 0 ? formatCurrency(annualTotal) : '-'}
                        </div>
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            )}
            {!loading && expectedRows.length > 0 && (
              <div className="px-3 py-1.5 bg-[#0f172a]/60 text-[10px] text-gray-600 border-t border-gray-700/50">
                초록 배경 = {CURRENT_YEAR}년 실제 지급 데이터 &nbsp;·&nbsp; 파란 글씨 = 직전연도 기준 예측
              </div>
            )}
          </div>
        );
      })()}

      {/* 월 입금 내역 탭 */}
      {activeTab === 'actual' && (
        <div className="overflow-x-auto">
          {actualRows.length === 0 && extraActualRows.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-xs">주식·ETF 종목이 없습니다.</div>
          ) : (
            <table className="w-full text-[11px] text-center">
              <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                <tr>
                  <th className="py-3 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">코드</th>
                  <th className="py-2 px-2 text-gray-500 min-w-[45px]">수량</th>
                  {MONTHS.map(m => (
                    <th key={m} colSpan={actualHasOverseas ? 2 : 1} className="py-2.5 px-1 min-w-[68px]">{m}</th>
                  ))}
                  <th colSpan={actualHasOverseas ? 2 : 1} className="py-2 px-2 min-w-[88px] text-emerald-500 font-bold">연간합계</th>
                </tr>
                {actualHasOverseas && (
                  <tr className="text-[9px] border-b border-gray-700/50">
                    <th className="sticky left-0 z-10 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]"></th>
                    <th></th>
                    {MONTHS.map(m => (
                      <React.Fragment key={m}>
                        <th className="py-1 text-blue-400 font-normal min-w-[62px]">세전</th>
                        <th className="py-1 text-emerald-400 font-normal min-w-[62px]">세후</th>
                      </React.Fragment>
                    ))}
                    <th className="py-1 text-blue-400 font-normal min-w-[62px]">세전</th>
                    <th className="py-1 text-emerald-400 font-normal min-w-[62px]">세후</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {actualRows.map((row) => (
                  <tr key={`${row.portfolioId}-${row.code}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                    <td className="py-3 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-blue-300">
                      <div className="line-clamp-1">{row.code}</div>
                    </td>
                    <td className="py-2 px-2 text-gray-400">{row.qty.toLocaleString()}</td>
                    {row.monthData.map((d, i) => {
                      const isEditingCell = editingCell?.portfolioId === row.portfolioId
                        && editingCell?.code === row.code
                        && editingCell?.monthIdx === i
                        && !editingCell?.isExtra;
                      const isEditingGross = isEditingCell && editingCell?.field === 'gross';
                      const isEditingAfterTax = isEditingCell && editingCell?.field === 'afterTax';
                      const isLastMonthCol = i === 11;

                      if (row.isOverseas) {
                        return (
                          <React.Fragment key={i}>
                            <td
                              onClick={() => !isEditingCell && handleGrossCellClick(row, i)}
                              className={`py-0.5 px-1 text-center text-[10px] cursor-pointer transition-colors border-r border-gray-700/20 ${
                                isEditingGross ? 'bg-blue-900/40' :
                                d.hasManualGross ? 'text-blue-300 font-bold bg-blue-900/10 hover:bg-blue-900/30' :
                                d.grossUsd > 0 ? 'text-blue-300/60 hover:bg-gray-700/20' : 'text-gray-700 hover:bg-gray-700/20'
                              }`}
                            >
                              {isEditingGross ? (
                                <div className="flex items-center gap-0.5 justify-center">
                                  <span className="text-gray-400 text-[9px]">$</span>
                                  <input
                                    ref={inputRef}
                                    type="text" inputMode="decimal"
                                    value={editingCell.value}
                                    onChange={e => setEditingCell(prev => ({ ...prev, value: e.target.value }))}
                                    onBlur={commitEdit}
                                    onKeyDown={handleCellKeyDown}
                                    className="w-14 bg-transparent text-blue-300 text-right text-[10px] outline-none border-b border-blue-400"
                                    placeholder="세전 $"
                                  />
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-0">
                                  <span>{d.grossUsd > 0 ? formatUsd(d.grossUsd) : '-'}</span>
                                  {d.grossKrw > 0 && <span className="text-gray-500 text-[9px]">{formatCurrency(d.grossKrw)}</span>}
                                </div>
                              )}
                            </td>
                            <td
                              onClick={() => !isEditingCell && handleAfterTaxCellClick(row, i)}
                              className={`py-0.5 px-1 text-center text-[10px] cursor-pointer transition-colors ${
                                isLastMonthCol ? '' : 'border-r border-gray-600/40'
                              } ${
                                isEditingAfterTax ? 'bg-emerald-900/30' :
                                d.hasManualAfterTax ? 'text-emerald-300 font-bold bg-emerald-900/10 hover:bg-emerald-900/30' :
                                d.afterTaxUsd > 0 ? 'text-emerald-300/70 hover:bg-gray-700/20' : 'text-gray-700 hover:bg-gray-700/20'
                              }`}
                            >
                              {isEditingAfterTax ? (
                                <div className="flex flex-col gap-0.5 py-0.5">
                                  <div className="flex items-center gap-0.5 justify-center">
                                    <span className="text-[8px] text-gray-500">$</span>
                                    <input
                                      ref={inputRef}
                                      type="text" inputMode="decimal"
                                      value={editingCell.usdValue}
                                      onChange={e => setEditingCell(prev => ({ ...prev, usdValue: e.target.value }))}
                                      onBlur={handleAfterTaxBlur}
                                      onFocus={handleAfterTaxFocus}
                                      onKeyDown={handleCellKeyDown}
                                      className="w-14 bg-transparent text-emerald-300 text-right text-[10px] outline-none border-b border-emerald-500/60"
                                      placeholder="세후 $"
                                    />
                                  </div>
                                  <div className="flex items-center gap-0.5 justify-center">
                                    <span className="text-[8px] text-gray-500">₩</span>
                                    <input
                                      ref={krwInputRef}
                                      type="text" inputMode="numeric"
                                      value={editingCell.krwValue}
                                      onChange={e => setEditingCell(prev => ({ ...prev, krwValue: e.target.value }))}
                                      onBlur={handleAfterTaxBlur}
                                      onFocus={handleAfterTaxFocus}
                                      onKeyDown={handleCellKeyDown}
                                      className="w-14 bg-transparent text-emerald-300/80 text-right text-[10px] outline-none border-b border-emerald-500/40"
                                      placeholder="세후 ₩"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-0">
                                  <span>{d.afterTaxUsd > 0 ? formatUsd(d.afterTaxUsd) : '-'}</span>
                                  {d.afterTaxKrw > 0 && <span className="text-gray-500 text-[9px]">{formatCurrency(d.afterTaxKrw)}</span>}
                                </div>
                              )}
                            </td>
                          </React.Fragment>
                        );
                      } else {
                        const effectiveTax = getEffectiveTax(d.amount, row.portfolioId, row.code, d.yearMonth);
                        const isManualTax = (nonGoldPortfolios.find(p => p.id === row.portfolioId)?.dividendTaxAmounts?.[row.code]?.[d.yearMonth] || 0) > 0;
                        return (
                          <td
                            key={i}
                            colSpan={actualHasOverseas ? 2 : 1}
                            onClick={() => !isEditingCell && handleKrwCellClick(row, i)}
                            className={`py-0.5 px-0.5 text-center text-[10px] cursor-pointer transition-colors ${
                              isLastMonthCol ? '' : 'border-r border-gray-600/40'
                            } ${
                              isEditingCell ? 'bg-blue-900/40' :
                              d.hasManual ? d.amount > 0 ? 'text-emerald-300 font-bold bg-emerald-900/20 hover:bg-emerald-900/40' : 'text-gray-500 hover:bg-gray-700/30' :
                              d.amount > 0 ? 'text-blue-300/60 hover:bg-gray-700/30' : 'text-gray-700 hover:bg-gray-700/30'
                            }`}
                          >
                            {isEditingCell ? (
                              <input
                                ref={inputRef}
                                type="text" inputMode="numeric"
                                value={editingCell.value}
                                onChange={e => setEditingCell(prev => ({ ...prev, value: e.target.value }))}
                                onBlur={commitEdit}
                                onKeyDown={handleCellKeyDown}
                                className="w-full bg-transparent text-white text-right text-[10px] outline-none border-b border-blue-400 px-1"
                              />
                            ) : (
                              <div className="flex flex-col items-center gap-0.5">
                                <span>{d.amount > 0 ? formatCurrency(d.amount) : '-'}</span>
                                <input
                                  type="text" inputMode="numeric"
                                  placeholder={getTaxRate(row.portfolioId) > 0 && d.amount > 0 ? '' : '과세금액'}
                                  value={effectiveTax > 0 ? effectiveTax.toLocaleString() : ''}
                                  onChange={e => handleTaxChange(row.portfolioId, row.code, d.yearMonth, e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className={`w-full bg-transparent text-center text-[9px] border-b outline-none placeholder-gray-700 ${isManualTax ? 'text-orange-400 border-orange-700/40' : 'text-orange-300/55 border-gray-700/30'}`}
                                />
                                {effectiveTax > 0 && d.amount > 0 && (
                                  <span className="text-green-400/60 text-[9px]">{formatCurrency(d.amount - effectiveTax)}</span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      }
                    })}
                    {row.isOverseas ? (
                      <React.Fragment key="annual">
                        <td className={`py-2 px-2 text-center font-bold border-r border-gray-700/20 ${row.annual > 0 ? 'text-blue-400' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center gap-0">
                            {row.annualUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(row.annualUsd)}</span>}
                            <span>{row.annual > 0 ? formatCurrency(row.annual) : '-'}</span>
                          </div>
                        </td>
                        <td className={`py-2 px-2 text-center font-bold ${row.annualAfterKrw > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center gap-0">
                            {row.annualAfterUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(row.annualAfterUsd)}</span>}
                            <span>{row.annualAfterKrw > 0 ? formatCurrency(row.annualAfterKrw) : '-'}</span>
                          </div>
                        </td>
                      </React.Fragment>
                    ) : (
                      <td colSpan={actualHasOverseas ? 2 : 1} className={`py-2 px-2 text-center font-bold ${row.annual > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                        <div className="flex flex-col items-center gap-0">
                          <span>{row.annual > 0 ? formatCurrency(row.annual) : '-'}</span>
                          {(() => {
                            const rowAnnualTax = row.monthData.reduce((s, d) =>
                              s + getEffectiveTax(d.amount, row.portfolioId, row.code, d.yearMonth), 0);
                            return rowAnnualTax > 0 && row.annual > 0 ? (<>
                              <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(rowAnnualTax)}</span>
                              <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - rowAnnualTax)}</span>
                            </>) : null;
                          })()}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {/* 수동 추가 행 */}
                {extraActualRows.map((row) => {
                  return (
                    <tr key={`extra-${row.portfolioId}-${row.rowId}`} className="border-b border-gray-700/40 hover:bg-gray-800/30 bg-gray-900/10">
                      <td className="py-2 px-2 text-left sticky left-0 z-[5] bg-[#0a1120] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={row.code}
                            onChange={e => updatePortfolioExtraRowCode(row.portfolioId, row.rowId, e.target.value)}
                            placeholder="코드/종목명"
                            className="w-20 bg-transparent text-blue-300/80 text-[10px] border-b border-gray-700/40 outline-none placeholder-gray-700"
                          />
                          <button
                            onClick={() => deletePortfolioExtraRow(row.portfolioId, row.rowId)}
                            className="text-gray-600 hover:text-red-400 transition-colors text-[10px] ml-0.5"
                            title="행 삭제"
                          >✕</button>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-gray-600 text-[10px]">-</td>
                      {row.monthData.map((d, i) => {
                        const isEditingCell = editingCell?.isExtra && editingCell?.rowId === row.rowId && editingCell?.monthIdx === i;
                        const isEditingAfterTax = isEditingCell && editingCell?.field === 'afterTax';
                        const isEditingKrw = isEditingCell && editingCell?.field === 'krw';
                        const isLastMonthCol = i === 11;

                        if (row.isOverseas) {
                          return (
                            <React.Fragment key={i}>
                              <td className="py-0.5 px-1 text-center text-[10px] text-gray-700 border-r border-gray-700/20">-</td>
                              <td
                                onClick={() => !isEditingCell && handleExtraOverseasCellClick(row, i)}
                                className={`py-0.5 px-1 text-center text-[10px] cursor-pointer transition-colors ${isLastMonthCol ? '' : 'border-r border-gray-600/40'} ${
                                  isEditingAfterTax ? 'bg-emerald-900/30' :
                                  d.afterTaxUsd > 0 || d.afterTaxKrw > 0 ? 'text-emerald-300 font-bold bg-emerald-900/10 hover:bg-emerald-900/30' :
                                  'text-gray-700 hover:bg-gray-700/20'
                                }`}
                              >
                                {isEditingAfterTax ? (
                                  <div className="flex flex-col gap-0.5 py-0.5">
                                    <div className="flex items-center gap-0.5 justify-center">
                                      <span className="text-[8px] text-gray-500">$</span>
                                      <input
                                        ref={inputRef}
                                        type="text" inputMode="decimal"
                                        value={editingCell.usdValue}
                                        onChange={e => setEditingCell(prev => ({ ...prev, usdValue: e.target.value }))}
                                        onBlur={handleAfterTaxBlur}
                                        onFocus={handleAfterTaxFocus}
                                        onKeyDown={handleCellKeyDown}
                                        className="w-14 bg-transparent text-emerald-300 text-right text-[10px] outline-none border-b border-emerald-500/60"
                                        placeholder="세후 $"
                                      />
                                    </div>
                                    <div className="flex items-center gap-0.5 justify-center">
                                      <span className="text-[8px] text-gray-500">₩</span>
                                      <input
                                        ref={krwInputRef}
                                        type="text" inputMode="numeric"
                                        value={editingCell.krwValue}
                                        onChange={e => setEditingCell(prev => ({ ...prev, krwValue: e.target.value }))}
                                        onBlur={handleAfterTaxBlur}
                                        onFocus={handleAfterTaxFocus}
                                        onKeyDown={handleCellKeyDown}
                                        className="w-14 bg-transparent text-emerald-300/80 text-right text-[10px] outline-none border-b border-emerald-500/40"
                                        placeholder="세후 ₩"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center gap-0">
                                    <span>{d.afterTaxUsd > 0 ? formatUsd(d.afterTaxUsd) : '-'}</span>
                                    {d.afterTaxKrw > 0 && <span className="text-gray-500 text-[9px]">{formatCurrency(d.afterTaxKrw)}</span>}
                                  </div>
                                )}
                              </td>
                            </React.Fragment>
                          );
                        } else {
                          return (
                            <td
                              key={i}
                              colSpan={actualHasOverseas ? 2 : 1}
                              onClick={() => !isEditingCell && handleExtraKrwCellClick(row, i)}
                              className={`py-0.5 px-0.5 text-center text-[10px] cursor-pointer transition-colors ${isLastMonthCol ? '' : 'border-r border-gray-600/40'} ${
                                isEditingKrw ? 'bg-blue-900/40' :
                                d.afterTaxKrw > 0 ? 'text-emerald-300 font-bold bg-emerald-900/20 hover:bg-emerald-900/40' :
                                'text-gray-700 hover:bg-gray-700/30'
                              }`}
                            >
                              {isEditingKrw ? (
                                <input
                                  ref={inputRef}
                                  type="text" inputMode="numeric"
                                  value={editingCell.value}
                                  onChange={e => setEditingCell(prev => ({ ...prev, value: e.target.value }))}
                                  onBlur={commitEdit}
                                  onKeyDown={handleCellKeyDown}
                                  className="w-full bg-transparent text-white text-right text-[10px] outline-none border-b border-blue-400 px-1"
                                />
                              ) : (
                                <span>{d.afterTaxKrw > 0 ? formatCurrency(d.afterTaxKrw) : '-'}</span>
                              )}
                            </td>
                          );
                        }
                      })}
                      {row.isOverseas ? (
                        <React.Fragment key="annual">
                          <td className="py-2 px-2 text-center font-bold text-gray-600 border-r border-gray-700/20">-</td>
                          <td className={`py-2 px-2 text-center font-bold ${row.annualAfterKrw > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-center gap-0">
                              {row.annualAfterUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(row.annualAfterUsd)}</span>}
                              <span>{row.annualAfterKrw > 0 ? formatCurrency(row.annualAfterKrw) : '-'}</span>
                            </div>
                          </td>
                        </React.Fragment>
                      ) : (
                        <td colSpan={actualHasOverseas ? 2 : 1} className={`py-2 px-2 text-center font-bold ${row.annualAfterKrw > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                          {row.annualAfterKrw > 0 ? formatCurrency(row.annualAfterKrw) : '-'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td colSpan={2} className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                  {actualHasOverseas ? (
                    MONTHS.map((_, i) => (
                      <React.Fragment key={i}>
                        <td className={`py-2.5 px-1 text-center font-bold text-[10px] border-r border-gray-700/20 ${actualMonthlyGrossKrw[i] > 0 ? 'text-blue-300/70' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center">
                            {actualMonthlyGrossUsd[i] > 0 && <span className="text-[9px]">{formatUsd(actualMonthlyGrossUsd[i])}</span>}
                            {actualMonthlyGrossKrw[i] > 0 ? formatCurrency(actualMonthlyGrossKrw[i]) : '-'}
                          </div>
                        </td>
                        <td className={`py-2.5 px-1 text-center font-bold text-[10px] ${i < 11 ? 'border-r border-gray-600/40' : ''} ${actualMonthlyAfterKrw[i] > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center">
                            {actualMonthlyAfterUsd[i] > 0 && <span className="text-[9px]">{formatUsd(actualMonthlyAfterUsd[i])}</span>}
                            {actualMonthlyAfterKrw[i] > 0 ? formatCurrency(actualMonthlyAfterKrw[i]) : '-'}
                          </div>
                        </td>
                      </React.Fragment>
                    ))
                  ) : (
                    actualMonthlyGrossKrw.map((total, i) => (
                      <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>
                        {total > 0 ? formatCurrency(total) : '-'}
                      </td>
                    ))
                  )}
                  {actualHasOverseas ? (
                    <>
                      <td className="py-2 px-2 text-center font-bold text-blue-300 border-r border-gray-700/20">
                        <div className="flex flex-col items-center">
                          {actualAnnualGrossUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(actualAnnualGrossUsd)}</span>}
                          {actualAnnualGrossKrw > 0 ? formatCurrency(actualAnnualGrossKrw) : '-'}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center font-bold text-emerald-300">
                        <div className="flex flex-col items-center">
                          {actualAnnualAfterUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(actualAnnualAfterUsd)}</span>}
                          {actualAnnualAfterKrw > 0 ? formatCurrency(actualAnnualAfterKrw) : '-'}
                        </div>
                      </td>
                    </>
                  ) : (
                    <td className="py-2 px-2 text-center font-bold text-emerald-300">
                      {actualAnnualGrossKrw > 0 ? formatCurrency(actualAnnualGrossKrw) : '-'}
                    </td>
                  )}
                </tr>
                {!actualHasOverseas && actualAnnualTaxTotal > 0 && (<>
                  <tr className="text-orange-300/60">
                    <td colSpan={2} className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                      과세합계({getTaxRate(nonGoldPortfolios[0]?.id)}%)
                    </td>
                    {actualMonthlyTaxTotals.map((tax, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">
                        {tax > 0 ? formatCurrency(tax) : '-'}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(actualAnnualTaxTotal)}</td>
                  </tr>
                  <tr className="text-green-400/70">
                    <td colSpan={2} className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">실 수령(세후)</td>
                    {actualMonthlyGrossKrw.map((total, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">
                        {total > 0 ? formatCurrency(total - (actualMonthlyTaxTotals[i] || 0)) : '-'}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px] font-bold">
                      {formatCurrency(actualAnnualGrossKrw - actualAnnualTaxTotal)}
                    </td>
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
