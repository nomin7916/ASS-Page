// @ts-nocheck
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { cleanNum, formatCurrency } from '../utils';
import { fetchDividendHistory } from '../api';

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const CURRENT_YEAR = new Date().getFullYear().toString();

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

export default function DividendSummaryTable({ portfolios, updatePortfolioDividendHistory }) {
  const [activeTab, setActiveTab] = useState('expected');
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(new Set()); // "portfolioId:code" 쌍 추적

  const nonGoldPortfolios = useMemo(() =>
    (portfolios || []).filter(p => p.accountType !== 'gold'),
    [portfolios]
  );

  // 종목 집합이 바뀔 때만 useEffect를 재실행하기 위한 안정적인 key
  const stockKeys = useMemo(() =>
    nonGoldPortfolios
      .flatMap(pf =>
        (pf.portfolio || [])
          .filter(item => /^\d{5,6}$/.test(String(item.code || '')))
          .map(item => `${pf.id}:${item.code}`)
      )
      .sort()
      .join(','),
    [nonGoldPortfolios]
  );

  // 아직 조회하지 않은 종목만 자동 fetch
  useEffect(() => {
    if (!stockKeys) return;
    const fetchMissing = async () => {
      const byPortfolio = {};
      nonGoldPortfolios.forEach(pf => {
        const divHistory = pf.dividendHistory || {};
        (pf.portfolio || []).forEach(item => {
          if (!/^\d{5,6}$/.test(String(item.code || ''))) return;
          const key = `${pf.id}:${item.code}`;
          if (fetchedRef.current.has(key) || divHistory[item.code]) return;
          fetchedRef.current.add(key);
          if (!byPortfolio[pf.id]) byPortfolio[pf.id] = [];
          byPortfolio[pf.id].push(item.code);
        });
      });
      if (!Object.keys(byPortfolio).length) return;
      setLoading(true);
      await Promise.all(
        Object.entries(byPortfolio).map(async ([portfolioId, codes]) => {
          const mergeMap = {};
          await Promise.all(codes.map(async code => {
            const data = await fetchDividendHistory(code);
            if (!data?.result?.length) return;
            const monthData = parseDividendApiResult(data.result);
            if (Object.keys(monthData).length) mergeMap[code] = monthData;
          }));
          if (Object.keys(mergeMap).length) updatePortfolioDividendHistory(portfolioId, mergeMap);
        })
      );
      setLoading(false);
    };
    fetchMissing();
  }, [stockKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // 수동 전체 새로고침
  const handleRefreshAll = useCallback(async () => {
    fetchedRef.current.clear();
    setLoading(true);
    await Promise.all(
      nonGoldPortfolios.map(async pf => {
        const stocks = (pf.portfolio || []).filter(item =>
          /^\d{5,6}$/.test(String(item.code || ''))
        );
        if (!stocks.length) return;
        const mergeMap = {};
        await Promise.all(stocks.map(async item => {
          fetchedRef.current.add(`${pf.id}:${item.code}`);
          const data = await fetchDividendHistory(String(item.code));
          if (!data?.result?.length) return;
          const monthData = parseDividendApiResult(data.result);
          if (Object.keys(monthData).length) mergeMap[item.code] = monthData;
        }));
        if (Object.keys(mergeMap).length) updatePortfolioDividendHistory(pf.id, mergeMap);
      })
    );
    setLoading(false);
  }, [nonGoldPortfolios, updatePortfolioDividendHistory]);

  const expectedRows = useMemo(() => {
    const result = [];
    nonGoldPortfolios.forEach(pf => {
      const divHistory = pf.dividendHistory || {};
      const stocks = (pf.portfolio || []).filter(item =>
        /^\d{5,6}$/.test(String(item.code || ''))
      );
      stocks.forEach(item => {
        if (!divHistory[item.code]) return;
        const qty = cleanNum(item.quantity);
        if (!qty) return;
        const pred = buildMonthPrediction(divHistory[item.code]);
        if (!Object.keys(pred).length) return;
        const monthData = Array.from({ length: 12 }, (_, i) => {
          const mo = String(i + 1).padStart(2, '0');
          const isActual = !!divHistory[item.code]?.[`${CURRENT_YEAR}-${mo}`];
          const amount = (pred[i + 1] || 0) * qty;
          return { amount, isActual };
        });
        result.push({
          portfolioTitle: pf.title || pf.name || '계좌',
          portfolioId: pf.id,
          code: item.code,
          name: item.name,
          qty,
          monthData,
          annual: monthData.reduce((s, d) => s + d.amount, 0),
        });
      });
    });
    return result;
  }, [nonGoldPortfolios]);

  const actualByMonth = useMemo(() => {
    const monthMap = {};
    nonGoldPortfolios.forEach(pf => {
      const divHistory = pf.dividendHistory || {};
      const stocks = (pf.portfolio || []).filter(item =>
        /^\d{5,6}$/.test(String(item.code || ''))
      );
      stocks.forEach(item => {
        if (!divHistory[item.code]) return;
        const qty = cleanNum(item.quantity);
        if (!qty) return;
        Object.entries(divHistory[item.code]).forEach(([yearMonth, perUnit]) => {
          if (!yearMonth.startsWith(CURRENT_YEAR)) return;
          const amount = perUnit * qty;
          if (!monthMap[yearMonth]) monthMap[yearMonth] = { total: 0, items: [] };
          monthMap[yearMonth].total += amount;
          monthMap[yearMonth].items.push({
            name: item.name,
            code: item.code,
            portfolioTitle: pf.title || pf.name || '계좌',
            qty,
            perUnit,
            amount,
          });
        });
      });
    });
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([yearMonth, data]) => {
        const [, mo] = yearMonth.split('-');
        return { yearMonth, monthLabel: `${CURRENT_YEAR}년 ${parseInt(mo)}월`, ...data };
      });
  }, [nonGoldPortfolios]);

  // 숫자 코드 종목 자체가 없으면 표시 안 함
  if (!stockKeys) return null;

  const hasDividendData = expectedRows.length > 0;
  const monthlyTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.reduce((sum, row) => sum + row.monthData[i].amount, 0)
  );
  const annualTotal = monthlyTotals.reduce((s, v) => s + v, 0);
  const actualTotal = actualByMonth.reduce((s, m) => s + m.total, 0);

  return (
    <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden w-full">
      <div className="p-3 bg-[#0f172a] border-b border-gray-700 flex items-center gap-2 flex-wrap">
        <span className="text-white font-bold text-sm">💰 분배금 현황</span>
        <span className="text-gray-600 text-[10px]">gold 계좌 제외</span>
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
          <span className="text-yellow-400 font-bold text-xs">연간 예상 {formatCurrency(annualTotal)}</span>
        )}
        {activeTab === 'actual' && actualTotal > 0 && (
          <span className="text-emerald-400 font-bold text-xs">{CURRENT_YEAR}년 누계 {formatCurrency(actualTotal)}</span>
        )}
        <button
          onClick={handleRefreshAll}
          disabled={loading}
          className="ml-auto px-3 py-1 text-xs font-bold rounded-md border border-gray-600 text-gray-400 hover:bg-gray-700/50 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? '조회 중...' : '🔄 새로고침'}
        </button>
      </div>

      {/* 초기 로딩 (데이터 없는 상태) */}
      {loading && !hasDividendData && (
        <div className="py-8 text-center text-blue-400 text-xs animate-pulse">분배금 데이터 조회 중...</div>
      )}

      {/* 조회 완료 후 분배금 없음 */}
      {!loading && !hasDividendData && (
        <div className="py-8 text-center text-gray-500 text-xs">분배금 지급 이력이 있는 종목이 없습니다.</div>
      )}

      {/* 월 예상 분배금 탭 */}
      {hasDividendData && activeTab === 'expected' && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-center">
            <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
              <tr>
                <th className="py-2 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">종목명</th>
                <th className="py-2 px-2 text-gray-500 min-w-[55px]">계좌</th>
                <th className="py-2 px-2 text-gray-500 min-w-[45px]">수량</th>
                {MONTHS.map(m => (
                  <th key={m} className="py-2 px-1 min-w-[68px]">{m}</th>
                ))}
                <th className="py-2 px-2 min-w-[88px] text-yellow-500 font-bold">연간합계</th>
              </tr>
            </thead>
            <tbody>
              {expectedRows.map((row) => (
                <tr key={`${row.portfolioId}-${row.code}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                  <td className="py-2 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-green-400">
                    <div className="line-clamp-1">{row.name}</div>
                  </td>
                  <td className="py-2 px-2 text-gray-500 text-[10px] truncate max-w-[55px]">{row.portfolioTitle}</td>
                  <td className="py-2 px-2 text-gray-400">{row.qty.toLocaleString()}</td>
                  {row.monthData.map((d, i) => (
                    <td key={i} className={`py-2 px-1 text-right text-[10px] ${
                      d.amount > 0
                        ? d.isActual ? 'text-emerald-300 font-bold bg-emerald-900/25' : 'text-blue-300/70'
                        : 'text-gray-700'
                    }`}>
                      {d.amount > 0 ? formatCurrency(d.amount) : '-'}
                    </td>
                  ))}
                  <td className={`py-2 px-2 text-right font-bold ${row.annual > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                    {row.annual > 0 ? formatCurrency(row.annual) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
              <tr>
                <td colSpan={3} className="py-2 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                {monthlyTotals.map((total, i) => (
                  <td key={i} className={`py-2 px-1 text-right font-bold text-[10px] ${total > 0 ? 'text-green-300' : 'text-gray-600'}`}>
                    {total > 0 ? formatCurrency(total) : '-'}
                  </td>
                ))}
                <td className="py-2 px-2 text-right font-bold text-yellow-300">
                  {annualTotal > 0 ? formatCurrency(annualTotal) : '-'}
                </td>
              </tr>
            </tfoot>
          </table>
          <div className="px-3 py-1.5 bg-[#0f172a]/60 text-[10px] text-gray-600 border-t border-gray-700/50">
            초록 배경 = {CURRENT_YEAR}년 실제 지급 데이터 &nbsp;·&nbsp; 파란 글씨 = 직전연도 기준 예측
          </div>
        </div>
      )}

      {/* 월 입금 내역 탭 */}
      {hasDividendData && activeTab === 'actual' && (
        <div className="overflow-x-auto">
          {actualByMonth.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-xs">{CURRENT_YEAR}년 실제 입금 분배금 데이터가 없습니다.</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                <tr>
                  <th className="py-2 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[75px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">입금월</th>
                  <th className="py-2 px-3 text-left min-w-[130px]">종목명</th>
                  <th className="py-2 px-2 text-left min-w-[55px]">계좌</th>
                  <th className="py-2 px-2 text-right min-w-[50px]">수량</th>
                  <th className="py-2 px-2 text-right min-w-[70px]">단위 분배금</th>
                  <th className="py-2 px-2 text-right min-w-[88px] text-emerald-400 font-bold">수령액</th>
                </tr>
              </thead>
              <tbody>
                {actualByMonth.map((monthGroup) => (
                  <React.Fragment key={monthGroup.yearMonth}>
                    {monthGroup.items.map((item, idx) => (
                      <tr key={`${item.code}-${item.portfolioTitle}-${idx}`} className="border-b border-gray-700/30 hover:bg-gray-800/20">
                        {idx === 0 ? (
                          <td rowSpan={monthGroup.items.length} className="py-2 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-blue-400 align-middle">
                            {monthGroup.monthLabel}
                          </td>
                        ) : null}
                        <td className="py-2 px-3 text-left font-bold text-green-400">
                          <div className="line-clamp-1">{item.name}</div>
                        </td>
                        <td className="py-2 px-2 text-gray-500 text-[10px]">{item.portfolioTitle}</td>
                        <td className="py-2 px-2 text-right text-gray-400">{item.qty.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right text-gray-400">{formatCurrency(item.perUnit)}</td>
                        <td className="py-2 px-2 text-right font-bold text-emerald-400">{formatCurrency(item.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-gray-600 bg-[#1e293b]/70">
                      <td colSpan={5} className="py-1.5 px-3 text-right text-[10px] text-gray-400 font-bold">월 합계</td>
                      <td className="py-1.5 px-2 text-right font-bold text-green-300">{formatCurrency(monthGroup.total)}</td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td colSpan={5} className="py-2 px-3 text-right text-gray-300 font-bold">{CURRENT_YEAR}년 누계</td>
                  <td className="py-2 px-2 text-right font-bold text-emerald-300">{formatCurrency(actualTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
