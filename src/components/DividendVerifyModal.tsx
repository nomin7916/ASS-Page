// @ts-nocheck
import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { BG, BORDER, Z } from '../design';
import { cleanNum, formatCurrency, dividendPayDate } from '../utils';
import { getNowKST } from '../hooks/useMarketCalendar';

// 분배금 검증 모달 — 올해 1월 ~ 전체 종목 공통 최신월(데이터가 조회된 마지막 달).
// 종목 행 × 월 컬럼 매트릭스. 각 칸 = 보유수량 × 그 달 주당 분배금
// (해외는 usdkrw로 원화 환산). 분배 없는 달은 '-'.
// 칸 하단: 배당락일 → 지급일(배당락일 +2영업일, 휴일 제외).
// 우측: 연합계(분배금) / 과세표준 합계(dividendTaxHistory, CSV 없으면 '-').
// 하단: 월별 합계.

const MONTH_LABEL = (m) => `${m}월`;
const MD = (ds) => (ds ? `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}` : '');

export default function DividendVerifyModal({ portfolios, dividendTaxHistory = {}, usdkrw = 1300, holidays = { kr: [], us: [] }, onClose }) {
  const year = getNowKST().getFullYear();

  const { months, rows, columnTotals, grandTotal, grandTaxable, taxableCovered } = useMemo(() => {
    const ymKey = (m) => `${year}-${String(m).padStart(2, '0')}`;

    // 전체 종목 통틀어 올해 데이터가 존재하는 가장 최근 월
    let latestMonth = 0;
    (portfolios || []).forEach(pf => {
      if (pf.accountType === 'gold') return;
      const divHistory = pf.dividendHistory || {};
      (pf.portfolio || []).forEach(item => {
        const codeHist = divHistory[item.code];
        if (!codeHist) return;
        for (let m = 12; m > latestMonth; m--) {
          if (cleanNum(codeHist[ymKey(m)]) > 0) { latestMonth = m; break; }
        }
      });
    });

    const monthList = [];
    for (let m = 1; m <= latestMonth; m++) monthList.push(m);

    const rowList = [];
    (portfolios || []).forEach(pf => {
      if (pf.accountType === 'gold') return;
      const divHistory = pf.dividendHistory || {};
      const taxRecsAll = dividendTaxHistory || {};
      const isOverseas = pf.accountType === 'overseas';
      const fx = isOverseas ? usdkrw : 1;
      const exDateMap = pf.dividendExDate || {};
      const hol = isOverseas ? (holidays?.us || []) : (holidays?.kr || []);
      (pf.portfolio || []).forEach(item => {
        const codeHist = divHistory[item.code];
        if (!codeHist) return;
        const qty = cleanNum(item.quantity);
        const cells = [];
        let rowTotal = 0;
        let hasAny = false;
        let taxable = 0;
        let taxableHas = false;
        monthList.forEach(m => {
          const perShare = cleanNum(codeHist[ymKey(m)]);
          if (perShare > 0) {
            const krw = Math.round(qty * perShare * fx);
            const ex = exDateMap?.[item.code]?.[ymKey(m)] || '';
            const pay = ex ? dividendPayDate(ex, hol) : '';
            cells.push({ krw, ex, pay });
            rowTotal += krw;
            hasAny = true;
            const taxRec = taxRecsAll?.[item.code]?.records?.[ymKey(m)];
            const perShareTax = cleanNum(taxRec?.perShareTaxableBase);
            if (perShareTax > 0) {
              taxable += Math.round(qty * perShareTax * fx);
              taxableHas = true;
            }
          } else {
            cells.push(null);
          }
        });
        if (!hasAny) return;
        rowList.push({
          key: `${pf.id}:${item.code}`,
          name: item.name || item.code,
          account: pf.title || '계좌',
          isOverseas,
          cells,
          rowTotal,
          taxable: taxableHas ? taxable : null,
        });
      });
    });

    rowList.sort((a, b) => b.rowTotal - a.rowTotal);

    const colTotals = monthList.map((_, i) =>
      rowList.reduce((s, r) => s + (r.cells[i]?.krw || 0), 0)
    );
    const gTotal = rowList.reduce((s, r) => s + r.rowTotal, 0);
    const gTaxable = rowList.reduce((s, r) => s + (r.taxable || 0), 0);
    const covered = rowList.filter(r => r.taxable != null).length;

    return {
      months: monthList,
      rows: rowList,
      columnTotals: colTotals,
      grandTotal: gTotal,
      grandTaxable: gTaxable,
      taxableCovered: covered,
    };
  }, [portfolios, dividendTaxHistory, usdkrw, year, holidays]);

  const latestLabel = months.length ? `${year}-${String(months[months.length - 1]).padStart(2, '0')}` : '-';

  return (
    <div className="fixed inset-0 flex items-start justify-center pt-10 px-4" style={{ zIndex: Z.dialog }} onMouseDown={onClose}>
      <div
        className="border rounded-xl shadow-2xl flex flex-col w-full max-w-5xl"
        style={{ backgroundColor: BG.card, borderColor: '#4b5563' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-3 py-2 border-b ${BORDER.default} select-none`}>
          <button onClick={onClose} className="text-pink-500 hover:text-pink-300"><X size={14} /></button>
          <span className="text-xs text-gray-300 font-bold">분배금 검증 · {year}-01 ~ {latestLabel}</span>
          <div style={{ width: 14 }} />
        </div>

        <div className="p-4 space-y-3 text-[11px] leading-relaxed overflow-y-auto max-h-[72vh]">
          <div className="bg-sky-900/25 border border-sky-700/40 rounded px-3 py-1.5 text-sky-300">
            올해 1월부터 데이터가 조회된 최근월까지 — 각 칸 = 보유수량 × 그 달 주당 분배금
            (해외는 원화 환산). 칸 아래 「락 → 지급」은 배당락일과 지급일(배당락일 +2영업일, 휴일 제외).
            분배 없는 달은 '-'.
          </div>

          <div className="rounded overflow-hidden border border-gray-700/60">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-[11px] border-collapse whitespace-nowrap">
                <thead className="bg-gray-800 text-gray-400">
                  <tr>
                    <th className="py-1.5 px-2 text-left font-normal border-r border-gray-700 sticky left-0 bg-gray-800">종목</th>
                    <th className="py-1.5 px-2 text-left font-normal border-r border-gray-700">계좌</th>
                    {months.map(m => (
                      <th key={m} className="py-1.5 px-2 font-normal border-r border-gray-700">{MONTH_LABEL(m)}</th>
                    ))}
                    <th className="py-1.5 px-2 font-normal border-r border-gray-700 text-emerald-400/80">연합계</th>
                    <th className="py-1.5 px-2 font-normal text-orange-300/70">과세표준</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={months.length + 4} className="py-4 text-center text-gray-500">올해 분배 이력이 있는 보유 종목이 없습니다.</td></tr>
                  )}
                  {rows.map(r => (
                    <tr key={r.key} className="border-t border-gray-700/60 hover:bg-gray-800/40">
                      <td className="py-1.5 px-2 text-left text-gray-200 border-r border-gray-700/40 sticky left-0 bg-[#0f1623]">
                        {r.name}
                        {r.isOverseas && <span className="ml-1 text-[9px] text-amber-400">USD</span>}
                      </td>
                      <td className="py-1.5 px-2 text-left text-gray-500 border-r border-gray-700/40">{r.account}</td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="py-1.5 px-2 text-gray-300 border-r border-gray-700/30 align-top">
                          {c != null ? (
                            <div className="flex flex-col items-end leading-tight">
                              <span>{formatCurrency(c.krw)}</span>
                              {c.ex && (
                                <span className="text-[9px] text-gray-500 mt-0.5">
                                  락 {MD(c.ex)}{c.pay && <span className="text-sky-400/70"> → 지급 {MD(c.pay)}</span>}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-gray-600">-</span>}
                        </td>
                      ))}
                      <td className="py-1.5 px-2 text-emerald-400 font-bold border-r border-gray-700/40">{formatCurrency(r.rowTotal)}</td>
                      <td className="py-1.5 px-2 text-orange-300/80">
                        {r.taxable != null ? formatCurrency(r.taxable) : <span className="text-gray-600">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-gray-600 bg-gray-800/60 font-bold">
                      <td className="py-1.5 px-2 text-left text-gray-300 sticky left-0 bg-gray-800">월별 합계</td>
                      <td className="py-1.5 px-2 border-r border-gray-700/40" />
                      {columnTotals.map((t, i) => (
                        <td key={i} className="py-1.5 px-2 text-gray-200 border-r border-gray-700/30">{formatCurrency(t)}</td>
                      ))}
                      <td className="py-1.5 px-2 text-emerald-400 border-r border-gray-700/40">{formatCurrency(grandTotal)}</td>
                      <td className="py-1.5 px-2 text-orange-300/80">{taxableCovered > 0 ? formatCurrency(grandTaxable) : '-'}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="space-y-2 pt-1 border-t border-gray-700/60">
            <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
              <div className="text-gray-500 text-[10px] font-bold mb-1">검증</div>
              <div className="text-gray-400 flex justify-between"><span>기간</span><span className="text-gray-200 font-bold">{year}-01 ~ {latestLabel}</span></div>
              <div className="text-gray-400 flex justify-between"><span>대상 종목</span><span className="text-gray-200 font-bold">{rows.length}종목</span></div>
              <div className="text-gray-400 flex justify-between"><span>분배금 합계 (Σ 수량 × 주당 분배금)</span><span className="text-emerald-400 font-bold">{formatCurrency(grandTotal)}</span></div>
              <div className="text-gray-400 flex justify-between">
                <span>과세표준 합계 (CSV 보유 {taxableCovered}/{rows.length})</span>
                <span className="text-orange-300/80 font-bold">{taxableCovered > 0 ? formatCurrency(grandTaxable) : '-'}</span>
              </div>
            </div>
            <div className="text-[10px] text-gray-600 text-center">조회·계산 전용 — 저장된 데이터를 변경하지 않습니다</div>
          </div>
        </div>
      </div>
    </div>
  );
}
