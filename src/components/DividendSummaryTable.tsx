// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { cleanNum, formatCurrency } from '../utils';

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

export default function DividendSummaryTable({ portfolios }) {
  const [activeTab, setActiveTab] = useState('expected');

  const nonGoldPortfolios = useMemo(() =>
    (portfolios || []).filter(p => p.accountType !== 'gold'),
    [portfolios]
  );

  const hasDividendData = useMemo(() =>
    nonGoldPortfolios.some(p => Object.keys(p.dividendHistory || {}).length > 0),
    [nonGoldPortfolios]
  );

  const expectedRows = useMemo(() => {
    const result = [];
    nonGoldPortfolios.forEach(pf => {
      const divHistory = pf.dividendHistory || {};
      if (!Object.keys(divHistory).length) return;
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

  if (!hasDividendData || !expectedRows.length) return null;

  const monthlyTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.reduce((sum, row) => sum + row.monthData[i].amount, 0)
  );
  const annualTotal = monthlyTotals.reduce((s, v) => s + v, 0);
  const actualTotal = actualByMonth.reduce((s, m) => s + m.total, 0);

  return (
    <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden w-full">
      <div className="p-3 bg-[#0f172a] border-b border-gray-700 flex items-center gap-2">
        <span className="text-white font-bold text-sm">💰 분배금 현황</span>
        <span className="text-gray-600 text-[10px]">gold 계좌 제외</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-700 ml-3">
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
        {activeTab === 'actual' && actualTotal > 0 && (
          <span className="ml-auto text-emerald-400 font-bold text-xs">
            {CURRENT_YEAR}년 누계 {formatCurrency(actualTotal)}
          </span>
        )}
        {activeTab === 'expected' && annualTotal > 0 && (
          <span className="ml-auto text-yellow-400 font-bold text-xs">
            연간 예상 {formatCurrency(annualTotal)}
          </span>
        )}
      </div>

      {activeTab === 'expected' && (
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
                        ? d.isActual
                          ? 'text-emerald-300 font-bold bg-emerald-900/25'
                          : 'text-blue-300/70'
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

      {activeTab === 'actual' && (
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
                          <td rowSpan={monthGroup.items.length} className="py-2 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-blue-400 align-middle text-[11px]">
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
                      <td className="py-1.5 px-2 text-right font-bold text-green-300 text-[11px]">{formatCurrency(monthGroup.total)}</td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td colSpan={5} className="py-2 px-3 text-right text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b]">{CURRENT_YEAR}년 누계</td>
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
