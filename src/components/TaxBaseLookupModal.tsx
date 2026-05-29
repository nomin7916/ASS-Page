// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, X, FileText } from 'lucide-react';
import { DRIVE_FILES, loadDriveFile } from '../driveStorage';
import { safeNum } from '../krEtfTaxHelpers';

type TaxBaseRecord = {
  purchases?: Array<{ id?: string; date?: string; shares?: number | string; taxBasePrice?: number | string }>;
  sales?: Array<{ id?: string; date?: string; shares?: number | string }>;
  exTaxBase?: Record<string, number | string>;
  avgTaxBase?: Record<string, number | string>;
};

type UnifiedRow = {
  kind: '매입' | '매도' | '배당락 과표' | '평균 과표';
  date: string;
  shares: number | null;
  price: number | null;
};

const fmtNum = (n: number, frac = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: frac, maximumFractionDigits: frac });

function buildRows(rec: TaxBaseRecord | null): UnifiedRow[] {
  if (!rec) return [];
  const rows: UnifiedRow[] = [];
  (rec.purchases || []).forEach(p => {
    const shares = safeNum(p.shares);
    const price = safeNum(p.taxBasePrice);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) return;
    rows.push({ kind: '매입', date: p.date as string, shares, price });
  });
  (rec.sales || []).forEach(s => {
    const shares = safeNum(s.shares);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) return;
    rows.push({ kind: '매도', date: s.date as string, shares, price: null });
  });
  Object.entries(rec.exTaxBase || {}).forEach(([ym, v]) => {
    const price = safeNum(v);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    rows.push({ kind: '배당락 과표', date: ym, shares: null, price });
  });
  Object.entries(rec.avgTaxBase || {}).forEach(([ym, v]) => {
    const price = safeNum(v);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    rows.push({ kind: '평균 과표', date: ym, shares: null, price });
  });
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.kind.localeCompare(b.kind);
  });
  return rows;
}

function downloadCsv(stock: { code: string; name?: string }, rows: UnifiedRow[]) {
  const header = ['구분', '날짜', '주식수', '과표기준가'];
  const lines = [header.join(',')];
  rows.forEach(r => {
    const cells = [
      r.kind,
      r.date,
      r.shares != null ? String(r.shares) : '',
      r.price != null ? r.price.toFixed(2) : '',
    ].map(c => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(cells.join(','));
  });
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const safeName = String(stock.name || stock.code).replace(/[\\/:*?"<>|]/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `과표_${safeName}_${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TaxBaseLookupModal({
  stock,
  portfolio,
  driveTokenRef,
  driveFolderIdRef,
  onClose,
  notify,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<TaxBaseRecord | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const fetchFromDrive = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = driveTokenRef?.current;
        const folderId = driveFolderIdRef?.current;
        if (!token || !folderId) throw new Error('Drive 인증 정보가 없습니다.');
        const state: any = await loadDriveFile(token, folderId, DRIVE_FILES.STATE);
        if (cancelled) return;
        const portfolios = state?.portfolios || [];
        const target = portfolios.find((p: any) => p.id === portfolio.id);
        const fresh = target?.taxBaseHistory?.[stock.code] || null;
        setRec(fresh);
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        setFetchedAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
      } catch (e: any) {
        if (cancelled) return;
        const fallback = portfolio?.taxBaseHistory?.[stock.code] || null;
        setRec(fallback);
        setError(`Drive 조회 실패: ${e?.message || e}. 메모리 캐시 표시.`);
        notify?.(`Drive에서 과표 데이터를 불러오지 못했습니다 — 현재 화면 데이터로 표시합니다.`, 'warning');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchFromDrive();
    return () => { cancelled = true; };
  }, [stock.code, portfolio.id, driveTokenRef, driveFolderIdRef, notify, portfolio]);

  const rows = useMemo(() => buildRows(rec), [rec]);
  const purchaseRows = rows.filter(r => r.kind === '매입');
  const saleRows = rows.filter(r => r.kind === '매도');
  const exRows = rows.filter(r => r.kind === '배당락 과표');
  const avgRows = rows.filter(r => r.kind === '평균 과표');
  const totalShares = purchaseRows.reduce((s, r) => s + (r.shares || 0), 0) - saleRows.reduce((s, r) => s + (r.shares || 0), 0);

  const handleRefetch = () => {
    setRec(null);
    setLoading(true);
    setError(null);
    setTimeout(async () => {
      try {
        const token = driveTokenRef?.current;
        const folderId = driveFolderIdRef?.current;
        if (!token || !folderId) throw new Error('Drive 인증 정보가 없습니다.');
        const state: any = await loadDriveFile(token, folderId, DRIVE_FILES.STATE);
        const portfolios = state?.portfolios || [];
        const target = portfolios.find((p: any) => p.id === portfolio.id);
        setRec(target?.taxBaseHistory?.[stock.code] || null);
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        setFetchedAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
      } catch (e: any) {
        setError(`Drive 조회 실패: ${e?.message || e}.`);
      } finally {
        setLoading(false);
      }
    }, 0);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0f172a] border border-gray-700/60 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 text-gray-200 min-w-0">
            <FileText size={14} className="text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{stock.name || stock.code}</div>
              <div className="text-[10px] text-gray-500 tabular-nums">
                {stock.code} · 과표 조회
                {fetchedAt && <span className="ml-2">· Drive 조회: {fetchedAt}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-800 shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* 본문 — 메모장 스타일 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500 gap-2">
              <RefreshCw size={16} className="animate-spin" />
              <span className="text-xs">Drive에서 과표 데이터 불러오는 중...</span>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-3 px-3 py-2 bg-amber-900/30 border border-amber-700/40 rounded text-[11px] text-amber-300">
                  {error}
                </div>
              )}
              <div className="bg-[#0a0f1a] border border-gray-700/60 rounded-lg p-4 font-mono text-[11px] text-gray-200 leading-relaxed whitespace-pre">
{`╔════════════════════════════════════════════════════════════╗
 ${(stock.name || stock.code).padEnd(40)} (${stock.code})
 보유 ${Number(stock.quantity || 0).toLocaleString()}주 · 입력 합계 ${totalShares.toLocaleString()}주
 조회 시각: ${fetchedAt || '-'}
╠════════════════════════════════════════════════════════════╣`}
                <span className="text-amber-300">
{`
 [매입 이벤트] ${purchaseRows.length}건`}
                </span>
{purchaseRows.length === 0
  ? `\n   (없음)`
  : '\n' + purchaseRows.map(r => `   ${r.date}    ${String(r.shares ?? 0).padStart(6)}주   @ ${fmtNum(r.price || 0).padStart(12)}원`).join('\n')}

                <span className="text-rose-300">
{`

 [매도 이벤트] ${saleRows.length}건`}
                </span>
{saleRows.length === 0
  ? `\n   (없음)`
  : '\n' + saleRows.map(r => `   ${r.date}    ${String(r.shares ?? 0).padStart(6)}주`).join('\n')}

                <span className="text-sky-300">
{`

 [월별 배당락 과표] ${exRows.length}건`}
                </span>
{exRows.length === 0
  ? `\n   (없음)`
  : '\n' + exRows.map(r => `   ${r.date}     @ ${fmtNum(r.price || 0).padStart(12)}원`).join('\n')}

                <span className="text-emerald-300">
{`

 [월별 평균 과표] ${avgRows.length}건`}
                </span>
{avgRows.length === 0
  ? `\n   (없음)`
  : '\n' + avgRows.map(r => `   ${r.date}     @ ${fmtNum(r.price || 0).padStart(12)}원`).join('\n')}
{`
╚════════════════════════════════════════════════════════════╝`}
              </div>
              {rows.length === 0 && (
                <div className="mt-3 text-center text-[11px] text-gray-500">
                  저장된 과표 데이터가 없습니다. 과표 계산 매트릭스에서 입력 후 다시 조회하세요.
                </div>
              )}
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between gap-2 shrink-0 bg-[#0b1322]">
          <button
            onClick={handleRefetch}
            disabled={loading}
            className="text-[11px] px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 재조회
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadCsv(stock, rows)}
              disabled={loading || rows.length === 0}
              className="text-[11px] px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Download size={11} /> CSV 다운로드
            </button>
            <button
              onClick={onClose}
              className="text-[11px] px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
