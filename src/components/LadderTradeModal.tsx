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
  // 목표 금액 = |리밸런싱 수량| × 현재가 = 그 종목의 증가분(매수)·부족분(매도) 금액.
  // ⚠️ 이 값이 사다리의 앵커다. 수량은 여기서 파생된다(머리주석 참조).
  targetAmount: number;
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

// ⚠️ verify:ladder는 이 파일의 순수 함수 구간(tri 선언부터 컴포넌트 직전까지)만 잘라 평가한다.
//    이 상수들을 그 구간 위로 올리면 테스트가 ReferenceError로 죽는다.
//    같은 이유로 이 구간 안 주석에 컴포넌트 선언 키워드를 그대로 적지 말 것 — 구간이 잘린다.
// 사다리 최대 수량 — 옛 maxAffordableQty의 상한과 같은 값이라 행 수 상한(mult=1에서 ~450행)도 종전과 같다.
const MAX_LADDER_QTY = 100000;
const QTY_EPS = 1e-9;

// ⚠️ 금액 허용 오차 = **가격 격자 1칸**(원화 1원 / 달러 $0.01). 1e-6 같은 부동소수 여유로
//    되돌리지 말 것 — 이건 반올림 잡음이 아니라 **양자화 오차**를 덮는 값이다.
//    목표금액은 원시 현재가로 계산되는데(|action| × price) 사다리는 격자에 스냅된 가격으로만
//    거래하므로(buildLadder의 roundTo), 격자가 가격을 **올려** 반올림하면 1주조차 목표를 넘긴다.
//    실측: 펀드 기준가 1,234.56 · action −1 → 첫 호가 roundTo(1234.56)=1,235 > 목표 1,234.56
//    → Q=0 → 매도 계산기가 통째로 빈 채로 열렸다(소수부 ≥ 0.5인 가격 + |action|=1 전부 해당).
//    스냅 상승폭은 최대 격자의 절반이라 격자 1칸이면 항상 덮이고, 그래서
//    **baseQty >= 1 이면 Q >= 1 이 보장된다**. action = trunc(금액/가격)이 이미 1주분을
//    버리므로 이 여유(최대 1원)는 그 안에 묻힌다.
const amountTolOf = (decimals: number) => Math.pow(10, -decimals);

// ⚠️ 이 계산기의 앵커는 '수량'이 아니라 '금액'이다 — 절대 되돌리지 말 것.
//    리밸런싱이 정하는 1차값은 '이 종목을 ₩N만큼 늘린다/줄인다'(증가분·부족분)이고,
//    표의 수량은 그 금액의 파생값이다 — usePortfolioData.ts의
//      action = Math.trunc((목표금액 − 현재평가금) / price)
//    따라서 사다리도 **금액을 고정하고 수량을 푼다**: 호가를 올려 팔면 같은 금액에 더 적은
//    수량이, 호가를 내려 사면 같은 금액에 더 많은 수량이 필요하다. 수량을 고정하면 사다리가
//    목표금액을 그만큼 초과 매매한다(옛 매도 경로는 목표 ₩7,961,800을 ₩9,227,400으로
//    +15.9% 초과 매도했다 — 호가를 올려 팔면서 수량 940주를 그대로 뒀기 때문).
//
// ⚠️ 매수/매도는 방향(dir)만 다른 같은 사다리다 — 복제하지 말 것.
//    매수 dir=-1: 현재가에서 호가를 내리며 배치(쌀수록 많이 산다).
//    매도 dir=+1: 현재가에서 호가를 올리며 배치(비쌀수록 많이 판다).
//    수량은 양쪽 모두 mult,2·mult,3·mult,… 삼각수 가중 = '호가 가중방식'.
//    mult(배수)는 사용자 설정이며 기본 1 — mult=2면 2,4,6,8… 로 늘어난다.
// ⚠️ mult 기본값 1은 하위호환의 축이다. 인자를 뺀 기존 호출은 종전 1,2,3,4… 그대로다.
function buildLadder(basePrice: number, tickSize: number, totalQty: number, floor: number, decimals: number, dir: number, mult: number = 1): LadderRow[] {
  if (totalQty <= 0 || tickSize <= 0 || basePrice <= 0) return [];
  const m = mult > 0 ? mult : 1;
  let N = 1;
  while (m * tri(N) < totalQty) N++;
  const rows: LadderRow[] = [];
  let rem = totalQty;
  for (let i = 0; i < N; i++) {
    const price = roundTo(basePrice + dir * i * tickSize, decimals);
    if (price < floor) break;
    // 마지막 행이 나머지를 흡수해 Σ수량 === totalQty 를 만든다(목표 초과 매매 없음).
    // N은 m*tri(N) >= totalQty 를 만족하는 **최소값**이라 i < N-1 구간에서는
    // m*tri(i+1) <= m*tri(N-1) < totalQty — 즉 rem이 항상 남는다(상한 클램프 불필요).
    const qty = i < N - 1 ? m * (i + 1) : rem;
    rows.push({ id: `r${i}`, price, qty, locked: false });
    rem -= qty;
    if (rem <= 0) break;
  }
  return rows;
}

// 사다리 총액이 목표금액을 넘지 않는 **최대 수량**을 푼다 — 매수·매도 공용.
// 이 함수가 '금액 앵커'의 구현체다(위 머리주석 참조). 매도를 |action|으로 고정하던
// 옛 sellTarget 분기로 되돌리지 말 것.
//
// ⚠️ 잘린 사다리(Σ수량 < Q)는 거부한다. 매수는 호가를 내리다 가격 하한(floor)에 닿으면
//    buildLadder가 남은 행을 버리는데, 그러면 총액이 더 늘지 않아
//      ① 옛 선형탐색은 `cost > fund` 조건이 영영 참이 되지 않아 상한 100000까지 폭주했고
//         (실측: 현재가 1,000 · 호가 50 · 목표 100,000원 → Q=100000 반환, 정답 210)
//         그 탐색이 렌더 이펙트에서 동기 실행돼 화면이 수 초간 멈췄다.
//      ② targetQty가 실제 배치 수량보다 커져 요약의 '수량'이 거짓이 된다.
//
// ⚠️ 이분탐색이 성립하는 근거 — 술어 P(Q) = (총액 ≤ 목표 ∧ 사다리 안 잘림)는 Q에 대해
//    단조감소한다: ① 모든 행 가격 > 0 이라 총액은 Q에 단조증가 ② 잘림은 한 번 발생하면
//    그보다 큰 Q에서 계속 발생. 선형탐색으로 되돌리지 말 것(위 폭주가 재발한다).
function solveQtyForAmount(basePrice: number, tickSize: number, targetAmount: number, floor: number, decimals: number, dir: number, mult: number = 1): number {
  if (tickSize <= 0 || basePrice <= 0 || targetAmount <= 0) return 0;
  const fits = (Q: number): boolean => {
    const rows = buildLadder(basePrice, tickSize, Q, floor, decimals, dir, mult);
    if (!rows.length) return false;
    let sumQty = 0, cost = 0;
    for (const r of rows) { sumQty += r.qty; cost += r.price * r.qty; }
    return sumQty >= Q - QTY_EPS && cost <= targetAmount + amountTolOf(decimals);
  };
  let lo = 0, hi = 1;
  while (hi < MAX_LADDER_QTY && fits(hi)) { lo = hi; hi *= 2; }
  if (hi > MAX_LADDER_QTY) hi = MAX_LADDER_QTY;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
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

function redistribute(rows: LadderRow[], target: number, mult: number = 1): LadderRow[] {
  const lockedQty = rows.filter(r => r.locked).reduce((s, r) => s + r.qty, 0);
  const remaining = Math.max(0, target - lockedQty);
  const unlocked = rows.filter(r => !r.locked);
  const N = unlocked.length;
  if (!N) return rows;
  const m = mult > 0 ? mult : 1;

  let M = 0;
  while (M < N && m * tri(M) < remaining) M++;
  M = Math.min(M, N);

  const qtys: number[] = new Array(N).fill(0);
  let rem = remaining;
  // buildLadder와 같은 이유로 상한 클램프가 필요 없다 — M이 최소값이라 i < M-1 에서는 rem이 남는다.
  for (let i = 0; i < M; i++) {
    if (i < M - 1) { qtys[i] = m * (i + 1); rem -= m * (i + 1); }
    else { qtys[i] = rem; }
  }

  let ui = 0;
  return rows.map(r => r.locked ? r : { ...r, qty: qtys[ui++] ?? 0 });
}

export default function LadderTradeModal({ side = 'buy', itemName, currentPrice, totalAction, targetAmount, currency = 'KRW', fxRate = 1, pos, onClose }: Props) {
  const isSell = side === 'sell';
  const dir = isSell ? 1 : -1;
  const sideLabel = isSell ? '매도' : '매수';
  // 기준 수량 = 리밸런싱 표의 수량 = 목표금액 ÷ 현재가. **사다리 수량을 정하지 않는다** —
  // 사다리는 금액에서 수량을 풀고(solveQtyForAmount), 이 값은 '현재가로 그냥 거래하면 몇 주인가'를
  // 보여 주는 비교 기준으로만 쓴다. 여기에 사다리를 고정하면 목표금액을 초과 매매한다.
  const baseQty = Math.abs(cleanNum(totalAction));

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
  const [multInput, setMultInput] = useState('1');
  const [mult, setMult] = useState(1);
  const [rows, setRows] = useState<LadderRow[]>([]);
  const [targetQty, setTargetQty] = useState(0);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [position, setPosition] = useState(pos);
  const drag = useRef({ active: false, ox: 0, oy: 0 });

  // ⚠️ 매수·매도가 **같은 한 줄**을 쓴다. 매도만 수량으로 분기하던 옛 삼항으로 되돌리지 말 것.
  const doRegenerate = (price: number, tick: number, amount: number, m: number) => {
    const Q = solveQtyForAmount(price, tick, amount, priceFloor, decimals, dir, m);
    setTargetQty(Q);
    setRows(buildLadder(price, tick, Q, priceFloor, decimals, dir, m));
    setPriceEdits({});
  };

  useEffect(() => {
    doRegenerate(currentPrice, tickSize, targetAmount, mult);
  }, [currentPrice, tickSize, targetAmount, side, mult]);

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalCost = rows.reduce((s, r) => s + r.price * r.qty, 0);
  const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
  // 잔여 = 목표금액 중 사다리가 쓰지 못한 몫. 보통 1주 값 미만이지만, 호가가 지나치게 넓어
  // 사다리가 가격 하한에 먼저 닿으면(매수) 크게 남을 수 있어 반드시 화면에 노출한다.
  const residual = targetAmount - totalCost;
  // 표시 하한 = 가격 격자. 달러에서 residual이 1e-13로 남는 부동소수 잡음에 '잔여 0.00'을 띄우지 않는다.
  const residualUnit = isUSD ? 0.01 : 1;
  const residualShown = Math.abs(residual) >= residualUnit;
  // 자동 배분은 목표를 넘지 않지만, 행 수량·단가를 수동 편집하면 넘을 수 있다 → 그때는 '초과'로 경고한다.
  const residualOver = residual < 0;
  const residualBig = targetAmount > 0 && residual > targetAmount * 0.01;
  // 사다리가 주는 이득 = 같은 금액에 대한 수량 차이.
  //   매도(−): 호가를 올려 파니 더 적은 수량으로 목표금액을 채운다 → 그만큼 보유를 아낀다.
  //   매수(+): 호가를 내려 사니 같은 금액으로 더 많은 수량을 담는다.
  const qtyDiff = totalQty - baseQty;
  const qtyDiffValue = Math.abs(qtyDiff) * cleanNum(currentPrice);
  // 이득이 음(매수인데 수량이 오히려 적음)이면 사다리가 목표금액을 못 담은 것이다(잔여 큼).
  const diffGood = isSell ? qtyDiff <= 0 : qtyDiff >= 0;
  // 매도는 '덜 파는 것'이, 매수는 '더 사는 것'이 이득이라 라벨이 방향마다 다르다.
  const qtyDiffLabel = isSell
    ? (qtyDiff < 0 ? `${formatNumber(-qtyDiff)}주 절약` : `${formatNumber(qtyDiff)}주 초과`)
    : (qtyDiff > 0 ? `${formatNumber(qtyDiff)}주 추가` : `${formatNumber(-qtyDiff)}주 부족`);
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

  // ⚠️ 배수는 '주식 수'를 곱하므로 1 이상 정수여야 한다 — 1.5면 1.5주가 나온다.
  //    호가 간격과 같은 규약으로 커밋 시 스냅하고 입력칸도 되돌린다.
  const normalizeMult = (raw: number) => {
    const snapped = Math.round(raw);
    return snapped >= 1 ? snapped : 1;
  };

  const applyMult = (val: string) => {
    const m = normalizeMult(cleanNum(val));
    setMult(m);
    setMultInput(String(m));
  };

  const handleRowQtyChange = (id: string, val: string) => {
    const newQty = Math.max(0, parseInt(val.replace(/[^\d]/g, '')) || 0);
    const updated = rows.map(r => r.id === id ? { ...r, qty: newQty, locked: true } : r);
    setRows(redistribute(updated, targetQty, mult));
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
      return redistribute(priceFixed, targetQty, mult);
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
            onClick={() => doRegenerate(currentPrice, tickSize, targetAmount, mult)}
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
            {qtyGap !== 0 ? (
              <span className="block text-[9px] text-amber-400 font-normal leading-tight">배분 {formatNumber(targetQty)}주</span>
            ) : baseQty > 0 && qtyDiff !== 0 ? (
              <span className="block text-[9px] text-gray-500 font-normal leading-tight">기준 {formatNumber(baseQty)}주 · {qtyDiff > 0 ? '+' : ''}{formatNumber(qtyDiff)}</span>
            ) : null}
          </span>

          <span className="text-gray-500 whitespace-nowrap">배수</span>
          <input
            className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-right text-amber-300 font-bold outline-none focus:border-amber-400 text-[11px] select-text"
            title={`수량이 늘어나는 배수 — 1이면 1,2,3,4… / 2면 2,4,6,8… (1 이상 정수)`}
            value={multInput}
            onChange={e => setMultInput(e.target.value)}
            onBlur={e => applyMult(e.target.value)}
            onFocus={e => e.target.select()}
            onKeyDown={e => { if (e.key === 'Enter') { applyMult(multInput); (e.target as HTMLInputElement).blur(); } }}
          />
          <span className="text-gray-500 whitespace-nowrap">분할 단계</span>
          <span className="text-gray-300 font-bold text-right">{rows.length}단계</span>

          <span className="text-gray-500 whitespace-nowrap">현재가격</span>
          <span className="text-gray-300 font-bold">{fmtCurPrice(currentPrice)}{wonLine(currentPrice)}</span>
          <span className="text-gray-500 whitespace-nowrap" title={`리밸런싱이 정한 ${isSell ? '부족분' : '증가분'} 금액 = 기준 수량 × 현재가. 사다리는 이 금액을 넘지 않는 최대 수량을 배분합니다.`}>목표 금액</span>
          <span className="text-sky-300 font-bold text-right">{fmt(targetAmount)}{wonLine(targetAmount)}</span>

          <span className="text-gray-500 whitespace-nowrap">평균단가</span>
          <span className="text-yellow-400 font-bold">{avgPrice > 0 ? fmt(avgPrice) : '—'}{avgPrice > 0 && wonLine(avgPrice)}</span>
          <span className="text-gray-500 whitespace-nowrap">{sideLabel} 금액</span>
          <span className="text-yellow-400 font-bold text-right">
            {totalCost > 0 ? fmt(totalCost) : '—'}{totalCost > 0 && wonLine(totalCost)}
            {totalCost > 0 && residualShown && (
              <span className={`block text-[9px] font-normal leading-tight ${residualOver ? 'text-red-400' : residualBig ? 'text-amber-400' : 'text-gray-500'}`}>
                {residualOver ? `초과 ${fmt(-residual)}` : `잔여 ${fmt(residual)}`}
              </span>
            )}
          </span>
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
            {/* ⚠️ 빈 사다리는 반드시 이유를 밝힌다 — 잔여 줄(totalCost > 0)과 푸터(totalQty > 0)가
                둘 다 가려져 옛 화면은 '0주 / — / —'만 남아 계산기가 고장 난 것처럼 보였다. */}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="py-6 px-3 text-center text-[10px] text-gray-500 leading-relaxed">
                  배분할 수량이 없습니다.
                  <span className="block text-gray-600">
                    목표 금액({fmt(targetAmount)})이 1주 값보다 작습니다.
                  </span>
                </td>
              </tr>
            )}
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
        <span
          className="text-gray-500"
          title={`같은 목표 금액을 현재가로 한 번에 ${sideLabel}하면 ${formatNumber(baseQty)}주입니다. 사다리는 ${isSell ? '더 비싸게 팔아 더 적은' : '더 싸게 사서 더 많은'} 수량으로 같은 금액을 채웁니다.`}
        >
          현재가 대비
        </span>
        {baseQty > 0 && totalQty > 0 ? (
          <span className={`font-bold ${qtyDiff === 0 ? 'text-gray-400' : diffGood ? 'text-sky-400' : 'text-red-400'}`}>
            {formatNumber(baseQty)}주 → {formatNumber(totalQty)}주
            {qtyDiff !== 0 && (
              <span className="ml-1">{`(${qtyDiffLabel} · ${fmt(qtyDiffValue)})`}</span>
            )}
          </span>
        ) : (
          <span className="font-bold text-gray-500">—</span>
        )}
      </div>
    </div>
  );
}
