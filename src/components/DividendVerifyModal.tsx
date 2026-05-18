// @ts-nocheck
import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { BG, BORDER, Z } from '../design';
import { cleanNum, formatCurrency, formatShortDate } from '../utils';
import { useMarketCalendar, getNowKST, formatDateKST } from '../hooks/useMarketCalendar';

// 분배금 검증 모달 — "다가오는 1회 예상분배"
// 행: 종목당 1행. 주당 분배금 = dividendHistory[code]의 최신월 값.
// 분배금(예상) = 보유수량 × 주당 분배금. 과세표준액 = dividendTaxHistory의
// 최신월 perShareTaxableBase × 수량 (CSV 데이터 없으면 '-').
// 분배락 일자 컬럼은 제외(요구사항). 지급예정일 = 익월 2일, 휴일 제외 다음 영업일.

const latestKey = (obj) => {
  const keys = Object.keys(obj || {});
  if (!keys.length) return null;
  return keys.sort((a, b) => b.localeCompare(a))[0];
};

// 익월 2일 기준, KRX 휴일/주말이면 그 이후 첫 영업일
function computeNextPaymentDate(isKRXOpen) {
  const now = getNowKST();
  let y = now.getFullYear();
  let m = now.getMonth() + 1; // 익월 (0-based +1 → 다음 달)
  if (m > 11) { m = 0; y += 1; }
  const d = new Date(y, m, 2);
  for (let i = 0; i < 14; i++) {
    const ds = formatDateKST(d);
    if (isKRXOpen(ds)) return ds;
    d.setDate(d.getDate() + 1);
  }
  return formatDateKST(d);
}

export default function DividendVerifyModal({ portfolios, dividendTaxHistory = {}, usdkrw = 1300, onClose }) {
  const { isKRXOpen } = useMarketCalendar();

  const paymentDate = useMemo(() => computeNextPaymentDate(isKRXOpen), [isKRXOpen]);

  const rows = useMemo(() => {
    const result = [];
    (portfolios || []).forEach(pf => {
      if (pf.accountType === 'gold') return;
      const divHistory = pf.dividendHistory || {};
      const isOverseas = pf.accountType === 'overseas';
      (pf.portfolio || []).forEach(item => {
        const codeHist = divHistory[item.code];
        const ymKey = latestKey(codeHist);
        if (!ymKey) return; // 분배 이력 없는 종목은 검증 대상 아님
        const perShare = cleanNum(codeHist[ymKey]);
        if (perShare <= 0) return;
        const qty = cleanNum(item.quantity);
        const grossNative = qty * perShare;
        const grossKrw = isOverseas ? Math.round(grossNative * usdkrw) : Math.round(grossNative);

        const taxRecs = dividendTaxHistory?.[item.code]?.records || {};
        const taxYm = latestKey(taxRecs);
        const perShareTax = taxYm ? cleanNum(taxRecs[taxYm]?.perShareTaxableBase) : 0;
        const taxableKrw = taxYm && perShareTax > 0
          ? (isOverseas ? Math.round(perShareTax * qty * usdkrw) : Math.round(perShareTax * qty))
          : null;

        result.push({
          key: `${pf.id}:${item.code}`,
          account: pf.title || '계좌',
          name: item.name || item.code,
          code: item.code,
          isOverseas,
          qty,
          perShare,
          basisMonth: ymKey,
          grossNative,
          grossKrw,
          taxableKrw,
        });
      });
    });
    return result.sort((a, b) => b.grossKrw - a.grossKrw);
  }, [portfolios, dividendTaxHistory, usdkrw]);

  const totalGross = rows.reduce((s, r) => s + r.grossKrw, 0);
  const totalTaxable = rows.reduce((s, r) => s + (r.taxableKrw || 0), 0);
  const taxableCovered = rows.filter(r => r.taxableKrw != null).length;

  const fmtUsd = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 flex items-start justify-center pt-10 px-4" style={{ zIndex: Z.dialog }} onMouseDown={onClose}>
      <div
        className="border rounded-xl shadow-2xl flex flex-col w-full max-w-3xl"
        style={{ backgroundColor: BG.card, borderColor: '#4b5563' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-3 py-2 border-b ${BORDER.default} select-none`}>
          <button onClick={onClose} className="text-pink-500 hover:text-pink-300"><X size={14} /></button>
          <span className="text-xs text-gray-300 font-bold">분배금 검증 · 다음 지급 {formatShortDate(paymentDate)}</span>
          <div style={{ width: 14 }} />
        </div>

        <div className="p-4 space-y-3 text-[11px] leading-relaxed overflow-y-auto max-h-[72vh]">
          <div className="bg-sky-900/25 border border-sky-700/40 rounded px-3 py-1.5 text-sky-300">
            다가오는 1회 예상분배 — 주당 분배금은 최신 이력 기준, 분배금 = 보유수량 × 주당 분배금.
            지급예정일은 익월 2일(휴일 제외 다음 영업일)로 추정됩니다.
          </div>

          <div className="rounded overflow-hidden border border-gray-700/60">
            <table className="w-full text-right text-[11px] border-collapse">
              <thead className="bg-gray-800 text-gray-400">
                <tr>
                  <th className="py-1.5 px-2 text-left font-normal border-r border-gray-700">종목</th>
                  <th className="py-1.5 px-2 text-left font-normal border-r border-gray-700">계좌</th>
                  <th className="py-1.5 px-2 font-normal border-r border-gray-700">보유수량</th>
                  <th className="py-1.5 px-2 font-normal border-r border-gray-700">주당 분배금</th>
                  <th className="py-1.5 px-2 font-normal border-r border-gray-700">분배금(예상)</th>
                  <th className="py-1.5 px-2 font-normal">과세표준액</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-gray-500">분배 이력이 있는 보유 종목이 없습니다.</td></tr>
                )}
                {rows.map(r => (
                  <tr key={r.key} className="border-t border-gray-700/60 hover:bg-gray-800/40">
                    <td className="py-1.5 px-2 text-left text-gray-200">
                      {r.name}
                      {r.isOverseas && <span className="ml-1 text-[9px] text-amber-400">USD</span>}
                      <span className="ml-1 text-[9px] text-gray-600">({r.basisMonth})</span>
                    </td>
                    <td className="py-1.5 px-2 text-left text-gray-500">{r.account}</td>
                    <td className="py-1.5 px-2 text-gray-300">{r.qty.toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-gray-300">
                      {r.isOverseas ? fmtUsd(r.perShare) : Math.round(r.perShare).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2 text-gray-200 font-bold">
                      {formatCurrency(r.grossKrw)}
                      {r.isOverseas && <span className="ml-1 text-[9px] text-gray-500">({fmtUsd(r.grossNative)})</span>}
                    </td>
                    <td className="py-1.5 px-2 text-gray-300">
                      {r.taxableKrw != null ? formatCurrency(r.taxableKrw) : <span className="text-gray-600">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 pt-1 border-t border-gray-700/60">
            <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
              <div className="text-gray-500 text-[10px] font-bold mb-1">검증</div>
              <div className="text-gray-400 flex justify-between"><span>대상 종목</span><span className="text-gray-200 font-bold">{rows.length}종목</span></div>
              <div className="text-gray-400 flex justify-between"><span>예상 분배금 합계 (Σ 수량 × 주당 분배금)</span><span className="text-emerald-400 font-bold">{formatCurrency(totalGross)}</span></div>
              <div className="text-gray-400 flex justify-between">
                <span>예상 과세표준 합계 (CSV 보유 {taxableCovered}/{rows.length})</span>
                <span className="text-orange-300/80 font-bold">{taxableCovered > 0 ? formatCurrency(totalTaxable) : '-'}</span>
              </div>
              <div className="flex justify-between pt-0.5">
                <span className="text-gray-500">지급예정일</span>
                <span className="text-sky-300 font-bold">{formatShortDate(paymentDate)}</span>
              </div>
            </div>
            <div className="text-[10px] text-gray-600 text-center">조회·계산 전용 — 저장된 데이터를 변경하지 않습니다</div>
          </div>
        </div>
      </div>
    </div>
  );
}
