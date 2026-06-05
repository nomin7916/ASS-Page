// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { formatNumber, cleanNum } from '../utils';

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
  pos: { x: number; y: number };
  onClose: () => void;
}

function tri(n: number): number { return n * (n + 1) / 2; }

function buildLadder(basePrice: number, tickSize: number, totalQty: number): LadderRow[] {
  if (totalQty <= 0 || tickSize <= 0 || basePrice <= 0) return [];
  let N = 1;
  while (tri(N) < totalQty) N++;
  const rows: LadderRow[] = [];
  let rem = totalQty;
  for (let i = 0; i < N; i++) {
    const price = basePrice - i * tickSize;
    if (price <= 0) break;
    const qty = i < N - 1 ? i + 1 : rem;
    rows.push({ id: `r${i}`, price, qty, locked: false });
    rem -= qty;
    if (rem <= 0) break;
  }
  return rows;
}

function maxAffordableQty(basePrice: number, tickSize: number, fund: number): number {
  if (tickSize <= 0 || basePrice <= 0 || fund <= 0) return 0;
  let Q = 0;
  while (Q < 100000) {
    const rows = buildLadder(basePrice, tickSize, Q + 1);
    if (!rows.length) break;
    const cost = rows.reduce((s, r) => s + r.price * r.qty, 0);
    if (cost > fund || rows[rows.length - 1].price <= 0) break;
    Q++;
  }
  return Q;
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

export default function LadderBuyModal({ itemName, currentPrice, totalAction, rebalFund, pos, onClose }: Props) {
  const [tickInput, setTickInput] = useState('10');
  const [tickSize, setTickSize] = useState(10);
  const [rows, setRows] = useState<LadderRow[]>([]);
  const [targetQty, setTargetQty] = useState(0);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [position, setPosition] = useState(pos);
  const drag = useRef({ active: false, ox: 0, oy: 0 });

  const doRegenerate = (price: number, tick: number, fund: number) => {
    const Q = maxAffordableQty(price, tick, fund);
    setTargetQty(Q);
    setRows(buildLadder(price, tick, Q));
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
      const newPrice = cleanNum(val);
      setPriceEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
      if (newPrice > 0) {
        setRows(rows.map(r => r.id === id ? { ...r, price: newPrice, locked: true } : r));
      }
    }
  };

  const unlockRow = (id: string) => {
    setPriceEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
    const unlocked = rows.map(r => r.id === id ? { ...r, locked: false } : r);
    setRows(redistribute(unlocked, targetQty));
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
          {itemName} — 분할매수 계산기
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
          <span className="text-gray-300 font-bold">{formatNumber(currentPrice)}</span>
          <span className="text-gray-500 whitespace-nowrap">리밸런싱 자금</span>
          <span className="text-sky-300 font-bold text-right">{formatNumber(Math.round(rebalFund))}</span>

          <span className="text-gray-500 whitespace-nowrap">평균단가</span>
          <span className="text-yellow-400 font-bold">{avgPrice > 0 ? formatNumber(Math.round(avgPrice)) : '—'}</span>
          <span className="text-gray-500 whitespace-nowrap">매수 금액</span>
          <span className="text-yellow-400 font-bold text-right">{totalCost > 0 ? formatNumber(Math.round(totalCost)) : '—'}</span>
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
                      value={priceEdits[row.id] !== undefined ? priceEdits[row.id] : formatNumber(row.price)}
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
                    {formatNumber(Math.round(rowCost))}
                  </td>
                  <td className="py-1 px-2 text-center font-mono text-yellow-600">
                    {formatNumber(Math.round(runAvg))}
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
          {formatNumber(Math.round(remaining))}
        </span>
      </div>
    </div>
  );
}
