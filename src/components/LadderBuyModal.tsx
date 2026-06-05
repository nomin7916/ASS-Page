// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { formatNumber, formatCurrency, cleanNum } from '../utils';

interface LadderRow {
  id: string;
  price: number;
  qty: number;
  locked: boolean;
}

interface Props {
  itemName: string;
  currentPrice: number;
  totalAction: number;
  rebalFund: number;
  currency?: 'KRW' | 'USD';
  fxRate?: number;
  pos: { x: number; y: number };
  onClose: () => void;
}

function tri(n: number): number { return n * (n + 1) / 2; }

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function buildLadder(basePrice: number, tickSize: number, totalQty: number, floor: number, decimals: number): LadderRow[] {
  if (totalQty <= 0 || tickSize <= 0 || basePrice <= 0) return [];
  let N = 1;
  while (tri(N) < totalQty) N++;
  const rows: LadderRow[] = [];
  let rem = totalQty;
  for (let i = 0; i < N; i++) {
    const price = roundTo(basePrice - i * tickSize, decimals);
    if (price < floor) break;
    const qty = i < N - 1 ? i + 1 : rem;
    rows.push({ id: `r${i}`, price, qty, locked: false });
    rem -= qty;
    if (rem <= 0) break;
  }
  return rows;
}

function maxAffordableQty(basePrice: number, tickSize: number, fund: number, floor: number, decimals: number): number {
  if (tickSize <= 0 || basePrice <= 0 || fund <= 0) return 0;
  let Q = 0;
  while (Q < 100000) {
    const rows = buildLadder(basePrice, tickSize, Q + 1, floor, decimals);
    if (!rows.length) break;
    const cost = rows.reduce((s, r) => s + r.price * r.qty, 0);
    if (cost > fund || rows[rows.length - 1].price < floor) break;
    Q++;
  }
  return Q;
}

function recalcAllPrices(rows: LadderRow[], basePrice: number, tickSize: number, floor: number, decimals: number): LadderRow[] {
  // anchorPrice at virtual idx=-1 so that row 0 = basePrice
  let anchorPrice = basePrice + tickSize;
  let anchorIdx = -1;
  return rows.map((row, idx) => {
    if (row.locked) {
      anchorPrice = row.price;
      anchorIdx = idx;
      return row;
    }
    const newPrice = roundTo(Math.max(floor, anchorPrice - (idx - anchorIdx) * tickSize), decimals);
    return { ...row, price: newPrice };
  });
}

function redistribute(rows: LadderRow[], target: number): LadderRow[] {
  const lockedQty = rows.filter(r => r.locked).reduce((s, r) => s + r.qty, 0);
  const remaining = Math.max(0, target - lockedQty);
  const unlocked = rows.filter(r => !r.locked);
  const N = unlocked.length;
  if (!N) return rows;

  let M = 0;
  while (M < N && tri(M) < remaining) M++;
  M = Math.min(M, N);

  const qtys: number[] = new Array(N).fill(0);
  let rem = remaining;
  for (let i = 0; i < M; i++) {
    if (i < M - 1) { qtys[i] = i + 1; rem -= i + 1; }
    else { qtys[i] = rem; }
  }

  let ui = 0;
  return rows.map(r => r.locked ? r : { ...r, qty: qtys[ui++] ?? 0 });
}

export default function LadderBuyModal({ itemName, currentPrice, totalAction, rebalFund, currency = 'KRW', fxRate = 1, pos, onClose }: Props) {
  const isUSD = currency === 'USD';
  const decimals = isUSD ? 2 : 0;
  const priceFloor = isUSD ? 0.01 : 1;
  const defaultTick = isUSD ? 0.1 : 10;

  // 달러 기반 표시 — USD는 소수 2자리, KRW는 정수. 원화 환산(wonLine)은 참고용만.
  const fmt = (n: number) => new Intl.NumberFormat(isUSD ? 'en-US' : 'ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(cleanNum(n));
  // 현재가격은 KRW에서 원본대로 소수 보존(formatNumber), USD는 2자리 고정.
  const fmtCurPrice = (n: number) => isUSD ? fmt(n) : formatNumber(n);

  const [tickInput, setTickInput] = useState(String(defaultTick));
  const [tickSize, setTickSize] = useState(defaultTick);
  const [rows, setRows] = useState<LadderRow[]>([]);
  const [targetQty, setTargetQty] = useState(0);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [position, setPosition] = useState(pos);
  const drag = useRef({ active: false, ox: 0, oy: 0 });

  const doRegenerate = (price: number, tick: number, fund: number) => {
    const Q = maxAffordableQty(price, tick, fund, priceFloor, decimals);
    setTargetQty(Q);
    setRows(buildLadder(price, tick, Q, priceFloor, decimals));
    setPriceEdits({});
  };

  useEffect(() => {
    doRegenerate(currentPrice, tickSize, rebalFund);
  }, [currentPrice, tickSize, rebalFund]);

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalCost = rows.reduce((s, r) => s + r.price * r.qty, 0);
  const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
  const remaining = rebalFund - totalCost;

  const applyTick = (val: string) => {
    const t = cleanNum(val);
    if (t > 0) setTickSize(t);
  };

  const handleRowQtyChange = (id: string, val: string) => {
    const newQty = Math.max(0, parseInt(val.replace(/[^\d]/g, '')) || 0);
    const updated = rows.map(r => r.id === id ? { ...r, qty: newQty, locked: true } : r);
    setRows(redistribute(updated, targetQty));
  };

  const handleRowPriceChange = (id: string, val: string) => {
    setPriceEdits(prev => ({ ...prev, [id]: val }));
  };

  const handleRowPriceBlur = (id: string) => {
    const val = priceEdits[id];
    if (val !== undefined) {
      const newPrice = roundTo(cleanNum(val), decimals);
      setPriceEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
      if (newPrice > 0) {
        setRows(prev => {
          const updated = prev.map(r => r.id === id ? { ...r, price: newPrice, locked: true } : r);
          return recalcAllPrices(updated, currentPrice, tickSize, priceFloor, decimals);
        });
      }
    }
  };

  const unlockRow = (id: string) => {
    setPriceEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
    setRows(prev => {
      const unlocked = prev.map(r => r.id === id ? { ...r, locked: false } : r);
      const priceFixed = recalcAllPrices(unlocked, currentPrice, tickSize, priceFloor, decimals);
      return redistribute(priceFixed, targetQty);
    });
  };

  const handleDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { active: true, ox: e.clientX - position.x, oy: e.clientY - position.y };
    const onMove = (ev: MouseEvent) => {
      if (!drag.current.active) return;
      setPosition({ x: ev.clientX - drag.current.ox, y: ev.clientY - drag.current.oy });
    };
    const onUp = () => {
      drag.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const wonLine = (n: number) => isUSD
    ? <span className="block text-[9px] text-gray-500 font-normal leading-tight">{formatCurrency(cleanNum(n) * fxRate)}</span>
    : null;

  return (
    <div
      className="fixed z-[1050] bg-[#0f172a] border border-gray-600 rounded-xl shadow-2xl select-none"
      style={{ left: position.x, top: position.y, width: 400 }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-[#1e293b] rounded-t-xl border-b border-gray-700 cursor-move"
        onMouseDown={handleDragStart}
      >
        <span className="text-[11px] font-bold text-sky-400 truncate max-w-[280px]">
          {itemName} — 분할매수 계산기{isUSD ? ' ($)' : ''}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => doRegenerate(currentPrice, tickSize, rebalFund)}
            className="text-gray-500 hover:text-amber-300 transition-colors"
            title="초기화"
          >
            <RotateCcw size={12} />
          </button>
          <button onClick={onClose} className="text-gray-500 hover:text-red-400 transition-colors">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="px-3 py-2.5 bg-[#080e1c] border-b border-gray-700/60 text-[11px]">
        <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1.5 items-center">
          <span className="text-gray-500 whitespace-nowrap">호가 간격</span>
          <input
            className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-right text-amber-300 font-bold outline-none focus:border-amber-400 text-[11px] select-text"
            value={tickInput}
            onChange={e => setTickInput(e.target.value)}
            onBlur={e => applyTick(e.target.value)}
            onFocus={e => e.target.select()}
            onKeyDown={e => { if (e.key === 'Enter') { applyTick(tickInput); (e.target as HTMLInputElement).blur(); } }}
          />
          <span className="text-gray-500 whitespace-nowrap">매수 수량</span>
          <span className="text-green-400 font-bold text-right">{totalQty}주</span>

          <span className="text-gray-500 whitespace-nowrap">현재가격</span>
          <span className="text-gray-300 font-bold">{fmtCurPrice(currentPrice)}{wonLine(currentPrice)}</span>
          <span className="text-gray-500 whitespace-nowrap">리밸런싱 자금</span>
          <span className="text-sky-300 font-bold text-right">{fmt(rebalFund)}{wonLine(rebalFund)}</span>

          <span className="text-gray-500 whitespace-nowrap">평균단가</span>
          <span className="text-yellow-400 font-bold">{avgPrice > 0 ? fmt(avgPrice) : '—'}{avgPrice > 0 && wonLine(avgPrice)}</span>
          <span className="text-gray-500 whitespace-nowrap">매수 금액</span>
          <span className="text-yellow-400 font-bold text-right">{totalCost > 0 ? fmt(totalCost) : '—'}{totalCost > 0 && wonLine(totalCost)}</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-[#1e293b] text-gray-400 border-b border-gray-700 z-10">
            <tr>
              <th className="py-2 px-2 text-center font-semibold w-[90px]">매수단가</th>
              <th className="py-2 px-2 text-center font-semibold w-[60px]">수량</th>
              <th className="py-2 px-2 text-center font-semibold">매수합계</th>
              <th className="py-2 px-2 text-center font-semibold">매수평균</th>
              <th className="py-2 px-1 w-5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const rowCost = row.price * row.qty;
              const cumQty = rows.slice(0, idx + 1).reduce((s, r) => s + r.qty, 0);
              const cumCost = rows.slice(0, idx + 1).reduce((s, r) => s + r.price * r.qty, 0);
              const runAvg = cumQty > 0 ? cumCost / cumQty : 0;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-gray-700/40 transition-colors ${
                    row.locked ? 'bg-indigo-950/30' : 'hover:bg-gray-800/30'
                  }`}
                >
                  <td className="py-1 px-1">
                    <input
                      className={`w-full bg-transparent text-center font-mono outline-none focus:bg-gray-800/60 rounded px-1 py-0.5 select-text ${
                        row.locked ? 'text-indigo-300' : 'text-gray-300'
                      }`}
                      value={priceEdits[row.id] !== undefined ? priceEdits[row.id] : fmt(row.price)}
                      onChange={e => handleRowPriceChange(row.id, e.target.value)}
                      onBlur={() => handleRowPriceBlur(row.id)}
                      onFocus={e => { setPriceEdits(prev => ({ ...prev, [row.id]: String(row.price) })); e.target.select(); }}
                    />
                  </td>
                  <td className="py-1 px-1">
                    <input
                      className={`w-full bg-transparent text-center font-bold outline-none focus:bg-gray-800/60 rounded px-1 py-0.5 select-text ${
                        row.locked ? 'text-indigo-300' : 'text-green-400'
                      }`}
                      value={row.qty}
                      onChange={e => handleRowQtyChange(row.id, e.target.value)}
                      onFocus={e => e.target.select()}
                    />
                  </td>
                  <td className="py-1 px-2 text-center text-gray-400 font-mono">
                    {fmt(rowCost)}
                  </td>
                  <td className="py-1 px-2 text-center font-mono text-yellow-600">
                    {fmt(runAvg)}
                  </td>
                  <td className="py-1 px-1 text-center">
                    {row.locked && (
                      <button
                        onClick={() => unlockRow(row.id)}
                        className="text-indigo-400/60 hover:text-gray-400 transition-colors text-[10px] leading-none"
                        title="잠금 해제"
                      >
                        ↺
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-700/60 flex items-center justify-between text-[10px] rounded-b-xl">
        <span className="text-gray-500">남은 자금</span>
        <span className={`font-bold ${remaining >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
          {fmt(remaining)}
        </span>
      </div>
    </div>
  );
}
