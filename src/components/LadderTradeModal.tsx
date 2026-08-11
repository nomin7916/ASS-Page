// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { formatNumber, formatCurrency, cleanNum } from '../utils';

type LadderSide = 'buy' | 'sell';

interface LadderRow {
  id: string;
  price: number;
  qty: number;
  locked: boolean;
}

interface Props {
  side?: LadderSide;
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

// ⚠️ 매수/매도는 방향(dir)만 다른 같은 사다리다 — 복제하지 말 것.
//    매수 dir=-1: 현재가에서 호가를 내리며 배치(쌀수록 많이 산다).
//    매도 dir=+1: 현재가에서 호가를 올리며 배치(비쌀수록 많이 판다).
//    수량은 양쪽 모두 1,2,3,… 삼각수 가중 = '호가 가중방식'.
function buildLadder(basePrice: number, tickSize: number, totalQty: number, floor: number, decimals: number, dir: number): LadderRow[] {
  if (totalQty <= 0 || tickSize <= 0 || basePrice <= 0) return [];
  let N = 1;
  while (tri(N) < totalQty) N++;
  const rows: LadderRow[] = [];
  let rem = totalQty;
  for (let i = 0; i < N; i++) {
    const price = roundTo(basePrice + dir * i * tickSize, decimals);
    if (price < floor) break;
    const qty = i < N - 1 ? i + 1 : rem;
    rows.push({ id: `r${i}`, price, qty, locked: false });
    rem -= qty;
    if (rem <= 0) break;
  }
  return rows;
}

// 매수 전용 — 매도는 수량(목표 매도량)이 이미 정해져 있어 자금 탐색이 필요 없다.
function maxAffordableQty(basePrice: number, tickSize: number, fund: number, floor: number, decimals: number): number {
  if (tickSize <= 0 || basePrice <= 0 || fund <= 0) return 0;
  let Q = 0;
  while (Q < 100000) {
    const rows = buildLadder(basePrice, tickSize, Q + 1, floor, decimals, -1);
    if (!rows.length) break;
    const cost = rows.reduce((s, r) => s + r.price * r.qty, 0);
    if (cost > fund || rows[rows.length - 1].price < floor) break;
    Q++;
  }
  return Q;
}

function recalcAllPrices(rows: LadderRow[], basePrice: number, tickSize: number, floor: number, decimals: number, dir: number): LadderRow[] {
  // anchorPrice at virtual idx=-1 so that row 0 = basePrice
  let anchorPrice = basePrice - dir * tickSize;
  let anchorIdx = -1;
  return rows.map((row, idx) => {
    if (row.locked) {
      anchorPrice = row.price;
      anchorIdx = idx;
      return row;
    }
    const newPrice = roundTo(Math.max(floor, anchorPrice + dir * (idx - anchorIdx) * tickSize), decimals);
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

export default function LadderTradeModal({ side = 'buy', itemName, currentPrice, totalAction, rebalFund, currency = 'KRW', fxRate = 1, pos, onClose }: Props) {
  const isSell = side === 'sell';
  const dir = isSell ? 1 : -1;
  const sideLabel = isSell ? '매도' : '매수';
  // 매도 목표 수량 = |리밸런싱 매도수량|. 매수와 달리 자금이 아니라 수량이 제약이다.
  const sellTarget = Math.abs(cleanNum(totalAction));

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
    const Q = isSell ? sellTarget : maxAffordableQty(price, tick, fund, priceFloor, decimals);
    setTargetQty(Q);
    setRows(buildLadder(price, tick, Q, priceFloor, decimals, dir));
    setPriceEdits({});
  };

  useEffect(() => {
    doRegenerate(currentPrice, tickSize, rebalFund);
  }, [currentPrice, tickSize, rebalFund, side, sellTarget]);

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalCost = rows.reduce((s, r) => s + r.price * r.qty, 0);
  const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
  const remaining = rebalFund - totalCost;
  // 매도: 사다리로 올려 판 금액 − 같은 수량을 현재가에 판 금액(= 호가를 올려 얻는 추가 수령액).
  const uplift = totalCost - totalQty * cleanNum(currentPrice);
  const qtyGap = roundTo(targetQty - totalQty, 6);

  // ⚠️ 호가 간격은 가격 격자(원화 1원 / 달러 0.01)의 배수여야 한다 — 소수점 호가는 없다.
  //    격자보다 작은 값을 그대로 받으면 roundTo(price, decimals)가 모든 행을 같은 가격으로
  //    반올림해 사다리가 통째로 무너진다(원화에 0.1을 넣으면 전 행이 현재가로 붕괴).
  //    커밋 시 격자에 스냅하고 입력칸도 그 값으로 되돌려 화면과 계산이 갈리지 않게 한다.
  const normalizeTick = (raw: number) => {
    const snapped = roundTo(raw, decimals);
    return snapped >= priceFloor ? snapped : priceFloor;
  };

  const applyTick = (val: string) => {
    const t = normalizeTick(cleanNum(val));
    setTickSize(t);
    setTickInput(String(t));
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
          return recalcAllPrices(updated, currentPrice, tickSize, priceFloor, decimals, dir);
        });
      }
    }
  };

  const unlockRow = (id: string) => {
    setPriceEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
    setRows(prev => {
      const unlocked = prev.map(r => r.id === id ? { ...r, locked: false } : r);
      const priceFixed = recalcAllPrices(unlocked, currentPrice, tickSize, priceFloor, decimals, dir);
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
        <span className={`text-[11px] font-bold truncate max-w-[280px] ${isSell ? 'text-red-400' : 'text-sky-400'}`}>
          {itemName} — 분할{sideLabel} 계산기{isUSD ? ' ($)' : ''}
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
            title={isUSD ? '$0.01 단위' : '1원 단위 정수 — 소수점은 사용하지 않습니다'}
            value={tickInput}
            onChange={e => setTickInput(e.target.value)}
            onBlur={e => applyTick(e.target.value)}
            onFocus={e => e.target.select()}
            onKeyDown={e => { if (e.key === 'Enter') { applyTick(tickInput); (e.target as HTMLInputElement).blur(); } }}
          />
          <span className="text-gray-500 whitespace-nowrap">{sideLabel} 수량</span>
          <span className={`font-bold text-right ${isSell ? 'text-red-400' : 'text-green-400'}`}>
            {formatNumber(totalQty)}주
            {isSell && qtyGap !== 0 && (
              <span className="block text-[9px] text-amber-400 font-normal leading-tight">목표 {formatNumber(targetQty)}주</span>
            )}
          </span>

          <span className="text-gray-500 whitespace-nowrap">현재가격</span>
          <span className="text-gray-300 font-bold">{fmtCurPrice(currentPrice)}{wonLine(currentPrice)}</span>
          <span className="text-gray-500 whitespace-nowrap">{isSell ? '현재가 기준' : '리밸런싱 자금'}</span>
          <span className="text-sky-300 font-bold text-right">{fmt(rebalFund)}{wonLine(rebalFund)}</span>

          <span className="text-gray-500 whitespace-nowrap">평균단가</span>
          <span className="text-yellow-400 font-bold">{avgPrice > 0 ? fmt(avgPrice) : '—'}{avgPrice > 0 && wonLine(avgPrice)}</span>
          <span className="text-gray-500 whitespace-nowrap">{sideLabel} 금액</span>
          <span className="text-yellow-400 font-bold text-right">{totalCost > 0 ? fmt(totalCost) : '—'}{totalCost > 0 && wonLine(totalCost)}</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-[#1e293b] text-gray-400 border-b border-gray-700 z-10">
            <tr>
              <th className="py-2 px-2 text-center font-semibold w-[90px]">{sideLabel}단가</th>
              <th className="py-2 px-2 text-center font-semibold w-[60px]">수량</th>
              <th className="py-2 px-2 text-center font-semibold">{sideLabel}합계</th>
              <th className="py-2 px-2 text-center font-semibold">{sideLabel}평균</th>
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
                        row.locked ? 'text-indigo-300' : isSell ? 'text-red-400' : 'text-green-400'
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
        {isSell ? (
          <>
            <span className="text-gray-500" title="사다리 매도금액 − (매도 수량 × 현재가)">현재가 대비</span>
            <span className={`font-bold ${uplift >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
              {uplift > 0 ? '+' : ''}{fmt(uplift)}
            </span>
          </>
        ) : (
          <>
            <span className="text-gray-500">남은 자금</span>
            <span className={`font-bold ${remaining >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
              {fmt(remaining)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
