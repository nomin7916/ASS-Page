// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { X, RotateCcw, RefreshCw } from 'lucide-react';
import { formatNumber, formatCurrency, formatChangeRate, cleanNum } from '../utils';

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
  // 그 종목의 전일 대비 등락률(%) — 리밸런싱 표 '등락률' 열과 같은 값.
  // 여기서 전일 종가를 복원해 각 호가가 전일 대비 몇 %인지 보여 준다. 모르면 null(0%가 아니다).
  changeRate?: number | string | null;
  currency?: 'KRW' | 'USD';
  fxRate?: number;
  pos: { x: number; y: number };
  // 현재가 재조회 — **종목에 바인딩된 무인자 콜백**이다(모달은 어느 종목인지 모른다).
  // 호출부가 계산기를 열 때 이미 한 번 쏘고, 타이틀 바 버튼은 재시도용이다.
  onRefreshPrice?: (() => void) | null;
  // 그 종목의 조회 상태 — 'loading' | 'success' | 'fail'. 모르면 null/undefined(표시 안 함).
  refreshState?: string | null;
  // 사다리가 빈 이유를 호출부가 알 때 넘긴다(예: 추가 수량이 바뀌어 매도할 수량이 사라짐).
  // ⚠️ 이때 기본 문구('목표 금액이 1주 값보다 작습니다')를 재사용하면 **거짓 설명**이 된다 —
  //    실제 원인은 1주 값 미만이 아니라 방향/수량이 어긋난 것이다.
  emptyReason?: string | null;
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
// 사다리 행 수 상한 — 옛 경로는 MAX_LADDER_QTY가 행 수까지 간접적으로 묶었지만(mult=1에서 ~450행),
// 아래 seedLadder는 수량이 아니라 '예산이 남는 동안' 행을 잇는다. 예산이 크고 호가가 촘촘하면
// 행이 무한정 늘어나므로 명시적 상한이 필요하다(수량 상한은 그 안에서 따로 건다).
const MAX_LADDER_ROWS = 500;
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

// ── 전일 종가 대비 등락률 ──
// 사다리의 각 호가가 **전일 종가** 대비 몇 %인지 보여 주기 위한 두 함수.
// 목적: '오늘 전일 대비 얼마나 더 비싸게 팔 수 있는가(매도) / 더 싸게 살 수 있는가(매수)'를
// 리밸런싱 표의 등락률 열과 **같은 축**에서 읽는 것. 매도는 호가를 올릴수록 현재가 등락률보다
// 커지고, 매수는 호가를 내릴수록 작아진다.
//
// ⚠️ 전일 종가를 가격 격자로 스냅하지 말 것. changeRate는 API에서 이미 소수 2자리로 반올림된
//    값이라 prev = 현재가 ÷ (1 + c/100)가 정수에 딱 떨어지지 않는데, 여기서 반올림하면
//    **현재가 행의 등락률이 표의 등락률과 갈린다**(실측: 11,260 · ▲6.56% → 스냅하면 6.57%).
//    원본 그대로 두면 rateVsPrev(현재가, prev) === c 가 대수적으로 보장돼 앵커가 항상 일치한다.
// 등락률 원값(정규화) — 미확보면 null.
// ⚠️ 미확보(null/undefined/''/손상값)는 '변동 없음(0%)'이 아니라 '모름'이다 — 0으로 폴백 금지.
//    타입까지 본다: Number('')·Number([])·Number(false)가 전부 0이라 손상값이 0%로 통과한다.
function normalizeChangeRate(changeRate: number | string | null | undefined): number | null {
  const c = typeof changeRate === 'number'
    ? changeRate
    : (typeof changeRate === 'string' && /[0-9]/.test(changeRate) ? Number(changeRate) : NaN);
  return Number.isFinite(c) ? c : null;
}

function prevCloseFrom(currentPrice: number, changeRate: number | string | null | undefined): number | null {
  const p = Number(currentPrice);
  if (!Number.isFinite(p) || p <= 0) return null;
  const c = normalizeChangeRate(changeRate);
  if (c === null) return null;
  const k = 1 + c / 100;
  if (!(k > 0)) return null; // −100% 이하 = 전일 종가 복원 불가
  return p / k;
}

// 전일 종가를 모르면 null — 화면은 '-'로 표시한다(0.00%로 단언하지 않는다).
function rateVsPrev(price: number, prevClose: number | null): number | null {
  if (prevClose === null || !(prevClose > 0)) return null;
  const p = Number(price);
  if (!Number.isFinite(p)) return null;
  return (p / prevClose - 1) * 100;
}

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

// ⚠️ 수량을 직접 입력한 행이 **그 아래 사다리의 새 시작점**이다 — 10주를 넣었으면 다음 호가는
//    11주, 그 다음은 12주(배수 m이면 +m씩). 잠금이 하나도 없으면 가상 시작점 0에서 출발하므로
//    수량이 m, 2m, 3m… 으로 종전과 같아진다.
//
// ⚠️ 총수량을 targetQty에 고정하던 옛 redistribute로 되돌리지 말 것. 그 함수는 행 수를 그대로 둔 채
//    잠금 이후를 1,2,3…으로 **다시 깔아**, 사용자가 10주를 넣어도 다음 호가가 1주가 되고 총수량은
//    49주 그대로였다(사용자 보고 2026-09). 행 수·총수량은 이제 이 함수가 목표 금액에서 푼다.
//
// ⚠️ 잠금이 하나도 없으면 **레거시 경로(solveQtyForAmount + buildLadder)에 그대로 위임**한다.
//    아래 탐욕 배분은 그 둘과 대수적으로 같지만(실측 1,512조합 전부 일치), 위임이 있어야
//    "수량을 건드리지 않으면 종전과 1주도 다르지 않다"가 논증이 아니라 **구조**로 보장된다
//    (applyPins의 조기 반환과 같은 규약). 위임 없이 재구현하면 수량 상한(MAX_LADDER_QTY)과
//    금액 허용오차 경계에서 실제로 갈렸다.
//
// ⚠️ 예산은 **자동 호가**(현재가 ± i×호가간격)로 잰다 — 사용자가 지정한 단가(핀)로 재면 단가 입력
//    한 번이 사다리 크기를 통째로 좌우한다(핀이 100배면 첫 행에서 예산이 말라 사다리가 1행으로
//    무너진다). doRegenerate도 solveQtyForAmount를 **핀 적용 전** 가격으로 부르므로(applyPins는 그
//    뒤) 이쪽이 기존 규약과 같다. 표시 가격은 호출부의 recalcAllPrices가 핀 기준으로 다시 깐다.
//
// ⚠️ 잠금 행은 예산과 무관하게 그대로 둔다 — 사용자가 명시적으로 넣은 값이고, 수동 편집이 목표금액을
//    넘을 수 있다는 것은 이 계산기의 기존 계약이다(넘으면 요약이 '초과'로 경고한다).
function seedLadder(rows: LadderRow[], basePrice: number, tickSize: number, targetAmount: number, floor: number, decimals: number, dir: number, mult: number = 1): LadderRow[] {
  if (tickSize <= 0 || basePrice <= 0) return rows;
  const m = mult > 0 ? mult : 1;
  if (!rows.some(r => r.locked)) {
    return buildLadder(basePrice, tickSize, solveQtyForAmount(basePrice, tickSize, targetAmount, floor, decimals, dir, m), floor, decimals, dir, m);
  }
  const tol = amountTolOf(decimals);
  const out: LadderRow[] = [];
  let spent = 0;   // 여기까지 배분한 금액(자동 호가 기준)
  let placed = 0;  // 여기까지 배분한 수량
  let seedQty = 0; // 직전 잠금 행의 수량 — 잠금 전에는 0(= 종전 m, 2m, 3m…)
  let dist = 0;    // 그 잠금 행에서 몇 칸 내려왔는가
  for (let i = 0; i < MAX_LADDER_ROWS; i++) {
    const price = roundTo(basePrice + dir * i * tickSize, decimals);
    if (price < floor) break;
    const cur = rows[i];
    if (cur && cur.locked) {
      out.push(cur);
      spent += price * cur.qty;
      placed += cur.qty;
      seedQty = cur.qty;
      dist = 0;
      continue;
    }
    dist++;
    const want = seedQty + m * dist;
    // room은 **누적** 잔액이라 허용오차가 행마다 쌓이지 않는다(solveQtyForAmount와 같은 규약).
    const room = targetAmount - spent;
    const qtyRoom = MAX_LADDER_QTY - placed;
    if (want <= 0 || qtyRoom <= 0 || room + tol < price) break;
    const qty = Math.min(want, qtyRoom, Math.floor((room + tol) / price));
    if (qty <= 0) break;
    out.push(cur ? { ...cur, qty } : { id: `r${i}`, price, qty, locked: false });
    spent += price * qty;
    placed += qty;
    // 마지막 행이 남은 예산을 흡수했다 — buildLadder의 나머지 흡수와 같은 모양.
    if (qty < want) break;
  }
  return out;
}

export default function LadderTradeModal({ side = 'buy', itemName, currentPrice, totalAction, targetAmount, changeRate = null, currency = 'KRW', fxRate = 1, pos, onRefreshPrice = null, refreshState = null, emptyReason = null, onClose }: Props) {
  const isSell = side === 'sell';
  const dir = isSell ? 1 : -1;
  const sideLabel = isSell ? '매도' : '매수';
  // 기준 수량 = 리밸런싱 표의 수량 = 목표금액 ÷ 현재가. **사다리 수량을 정하지 않는다** —
  // 사다리는 금액에서 수량을 풀고(solveQtyForAmount), 이 값은 '현재가로 그냥 거래하면 몇 주인가'를
  // 보여 주는 비교 기준으로만 쓴다. 여기에 사다리를 고정하면 목표금액을 초과 매매한다.
  const baseQty = Math.abs(cleanNum(totalAction));

  // ── 전일 종가 대비 등락률 ──
  // 각 호가가 '전일 종가' 대비 몇 %인지 = 리밸런싱 표의 등락률 열과 같은 기준.
  // ⚠️ 등락률을 모르면(전일 종가 복원 불가) 열 자체를 렌더하지 않는다 — 모르는 값을 0.00%로
  //    단언하지 않는다(일간 지표의 null 계약과 같은 규약).
  const prevClose = prevCloseFrom(currentPrice, changeRate);
  const showRate = prevClose !== null;
  // ⚠️ 현재가와 같은 가격의 등락률은 **복원한 전일 종가로 되계산하지 않고 원값을 그대로** 쓴다.
  //    p → p/(1+c/100) → 다시 % 로 되돌리는 왕복은 ±1e-15 오차를 남기는데, c가 소수 3자리
  //    이상이고 .xx5 경계면(예: 6.565) 그 오차가 toFixed(2)를 갈라 표는 ▲6.57%, 계산기는
  //    ▲6.56%가 된다(미국 주식 changeRate는 반올림 없이 들어온다). 원값을 쓰면 대수적 보장이
  //    아니라 **같은 값**이라 어떤 자릿수에서도 표와 문자열까지 일치한다.
  const baseRate = normalizeChangeRate(changeRate);
  // ⚠️ 표의 열 수는 이 한 곳에서만 파생한다 — thead·빈 사다리 colSpan·tbody가 갈리면
  //    그 행부터 표 정렬이 통째로 깨진다.
  const colCount = showRate ? 6 : 5;
  const rateClass = (r: number | null) => r == null ? 'text-gray-500' : r > 0 ? 'text-red-400' : r < 0 ? 'text-blue-400' : 'text-gray-500';
  const rateText = (r: number | null) => r == null ? '-' : formatChangeRate(r);

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
  // ── 사용자가 직접 지정한 단가 (rowId → price) ──
  // ⚠️ 호가 간격·배수·현재가가 바뀌어 사다리를 다시 만들어도 이 값은 살아남는다. 옛 doRegenerate는
  //    buildLadder 결과를 그대로 setRows 해서 사용자가 넣은 단가를 통째로 지웠고, 그래서 호가를
  //    한 칸만 고쳐도 "내가 입력한 매수단가가 이전 가격으로 되돌아가는" 버그가 났다.
  // ⚠️ 수량 편집(handleRowQtyChange가 세우는 locked)은 **일부러 보존하지 않는다** — 배수·호가 간격이
  //    수량 배분 자체를 재정의하는 값이라, 옛 수량을 들고 가면 새 배수와 정면으로 모순된다.
  const [pinnedPrices, setPinnedPrices] = useState<Record<string, number>>({});
  // ⚠️ 이 값을 재생성 effect의 deps에 넣지 말 것 — 단가를 하나 커밋할 때마다 사다리가 통째로 다시
  //    만들어져 그 순간 수량 편집이 날아가고 스크롤도 튄다. effect는 ref로만 읽는다.
  const pinnedRef = useRef(pinnedPrices);
  pinnedRef.current = pinnedPrices;
  const [position, setPosition] = useState(pos);
  const drag = useRef({ active: false, ox: 0, oy: 0 });

  // 핀이 지금 이 사다리의 **진행 방향 쪽**에 있는가 — 매수는 현재가 이하, 매도는 현재가 이상.
  // ⚠️ 핀은 절대 가격이라, 현재가를 재조회하거나 호가를 바꿔 base가 옮겨지면 사다리 **반대편**으로
  //    넘어갈 수 있다. 그대로 앵커로 삼으면 recalcAllPrices가 그 아래를 거기서부터 다시 깔아
  //    **같은 가격이 두 행에 찍힌다**(실측: 매수 base 9,700 · 호가 100 · 핀 r2=9,900 →
  //    9,700/9,600/9,900/9,800/9,700/9,600 — r0과 r4, r1과 r5가 같은 가격 = 같은 값에 두 개의 주문).
  //    이 상태는 사용자가 만든 적이 없고 base 이동이 자동으로 만든다 → 조용한 오적용보다 명시적 미적용.
  // ⚠️ 방향 안쪽의 비단조(사용자가 r2를 r1보다 비싸게 지정)는 **막지 않는다** — 그건 사용자가 직접
  //    입력해 만든 상태이고, 수동 편집은 목표금액 초과까지 허용하는 것이 이 계산기의 기존 계약이다.
  const pinFits = (pin: number, price: number) => dir * (pin - price) >= 0;

  // 사용자가 지정한 단가를 다시 심고, 그 아래 행을 새 호가 간격으로 재앵커한다.
  // ⚠️ basePrice는 반드시 **이번 재생성에 쓰인 price** — prop currentPrice로 굳히면 현재가를 재조회한
  //    직후 한 프레임 동안 buildLadder와 다른 기준으로 재앵커돼 행 가격이 어긋난다.
  // ⚠️ 핀이 하나도 없으면 built를 그대로 돌려준다. recalcAllPrices(핀 0개)는 buildLadder 출력과
  //    대수적으로 같지만, 조기 반환이 있어야 "핀이 없으면 종전과 1원도 다르지 않다"가 논증이 아니라
  //    구조로 보장된다(하위호환의 축).
  // ⚠️ 적용하지 못한 핀을 pinnedPrices에서 **지우지는 않는다** — 시세가 잠깐 튀었다 돌아오면 되살아나야
  //    한다(사라진 인덱스의 핀과 같은 규약). 해제 수단은 ↺ 초기화이고, 아래 안내 띠가 그것을 알린다.
  const applyPins = (built: LadderRow[], pins: Record<string, number>, price: number, tick: number) => {
    if (!built.length) return built;
    const usable = new Set(built.filter(r => pins[r.id] !== undefined && pinFits(pins[r.id], price)).map(r => r.id));
    if (!usable.size) return built;
    const pinned = built.map(r => usable.has(r.id) ? { ...r, price: pins[r.id], locked: true } : r);
    return recalcAllPrices(pinned, price, tick, priceFloor, decimals, dir);
  };

  // ⚠️ 매수·매도가 **같은 한 줄**을 쓴다. 매도만 수량으로 분기하던 옛 삼항으로 되돌리지 말 것.
  const doRegenerate = (price: number, tick: number, amount: number, m: number, pins: Record<string, number>) => {
    const Q = solveQtyForAmount(price, tick, amount, priceFloor, decimals, dir, m);
    setTargetQty(Q);
    setRows(applyPins(buildLadder(price, tick, Q, priceFloor, decimals, dir, m), pins, price, tick));
    setPriceEdits({});
  };

  // 수량을 직접 입력해 사다리를 다시 깐 뒤의 공통 커밋.
  // ⚠️ targetQty를 옛 값으로 두지 말 것 — 총수량은 이제 사다리가 정하므로, 그대로 두면 요약이
  //    '배분 N주'(qtyGap)로 있지도 않은 미배분을 단언한다.
  // ⚠️ recalcAllPrices를 반드시 거친다 — seedLadder는 예산을 자동 호가로 재느라 새로 생긴 행에
  //    자동 가격을 넣는데, 위쪽에 지정 단가가 있으면 그 아래는 핀 기준으로 다시 깔려야 한다.
  const commitLadder = (next: LadderRow[]) => {
    const priced = recalcAllPrices(next, currentPrice, tickSize, priceFloor, decimals, dir);
    setRows(priced);
    setTargetQty(priced.reduce((s, r) => s + r.qty, 0));
  };

  useEffect(() => {
    doRegenerate(currentPrice, tickSize, targetAmount, mult, pinnedRef.current);
  }, [currentPrice, tickSize, targetAmount, side, mult]);

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalCost = rows.reduce((s, r) => s + r.price * r.qty, 0);
  const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
  // 현재가 행은 표의 등락률 원값을 그대로 쓴다(위 baseRate 주석 참조).
  const curRate = showRate ? baseRate : null;
  // ⚠️ 툴팁이 근거로 드는 전일 종가는 표시용으로 격자에 반올림된 값이라 그 숫자로 되계산하면
  //    옆에 찍힌 등락률이 재현되지 않는다(원화 1,000 · ▼30.00% → '1,429' → 되계산 −30.02%).
  //    계산은 반올림하지 않으므로, 문구를 '≈ … 복원한 추정값'으로 두어 단언하지 않는다.
  //    3개 툴팁이 이 한 문자열을 공유한다 — 손복제하면 한쪽만 낡는다.
  const prevLabel = showRate ? `전일 종가 ≈ ${fmt(prevClose)}(등락률에서 복원한 추정값)` : '';
  // 평균단가의 등락률 = '오늘 전일 대비 평균 얼마에 파는가(사는가)' — 이 계산기의 헤드라인 값.
  const avgRate = avgPrice > 0 ? rateVsPrev(avgPrice, prevClose) : null;
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
  // 지금 사다리에 반영되지 못한 지정 단가 — 방향이 어긋났거나(pinFits 탈락) 사다리가 짧아져 그 행이
  // 사라진 경우. 화면에 흔적이 없으면 사용자는 "내 입력이 왜 안 보이지"만 남는다.
  const droppedPins = Object.keys(pinnedPrices)
    .filter(id => !rows.some(r => r.id === id && r.locked && r.price === pinnedPrices[id])).length;

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

  // 사용자가 넣은 수량이 그 아래 호가의 시작점이 되고, 행 수·총수량은 목표 금액이 다시 정한다.
  const handleRowQtyChange = (id: string, val: string) => {
    const newQty = Math.max(0, parseInt(val.replace(/[^\d]/g, '')) || 0);
    const updated = rows.map(r => r.id === id ? { ...r, qty: newQty, locked: true } : r);
    commitLadder(seedLadder(updated, currentPrice, tickSize, targetAmount, priceFloor, decimals, dir, mult));
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
        // ⚠️ 사용자가 지정한 단가는 여기서만 심는다 — 호가 간격·배수·현재가가 바뀌어 사다리가
        //    재생성돼도 doRegenerate → applyPins가 이 값을 다시 심어 준다.
        setPinnedPrices(prev => ({ ...prev, [id]: newPrice }));
        setRows(prev => {
          const updated = prev.map(r => r.id === id ? { ...r, price: newPrice, locked: true } : r);
          return recalcAllPrices(updated, currentPrice, tickSize, priceFloor, decimals, dir);
        });
      }
    }
  };

  const unlockRow = (id: string) => {
    setPriceEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
    // ⚠️ 지정 단가도 함께 지운다 — 안 지우면 다음 재생성(호가·배수·현재가 변경)에서 방금 푼
    //    잠금이 그대로 되살아나 '잠금 해제'가 아무 일도 하지 않은 것처럼 보인다.
    setPinnedPrices(prev => { const n = { ...prev }; delete n[id]; return n; });
    // ⚠️ 함수형 setRows로 되돌리지 말 것 — 같은 커밋에서 targetQty도 함께 갱신해야 하는데,
    //    updater 안에서 setState를 부르면 StrictMode의 이중 호출에서 부수효과가 두 번 돈다.
    //    (handleRowQtyChange와 같은 규약: 렌더 스코프의 rows를 읽는다.)
    const unlocked = rows.map(r => r.id === id ? { ...r, locked: false } : r);
    commitLadder(seedLadder(unlocked, currentPrice, tickSize, targetAmount, priceFloor, decimals, dir, mult));
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
      style={{ left: position.x, top: position.y, width: 440 }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-[#1e293b] rounded-t-xl border-b border-gray-700 cursor-move"
        onMouseDown={handleDragStart}
      >
        <span className={`text-[11px] font-bold truncate max-w-[320px] ${isSell ? 'text-red-400' : 'text-sky-400'}`}>
          {itemName} — 분할{sideLabel} 계산기{isUSD ? ' ($)' : ''}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {onRefreshPrice && (
            <button
              onClick={() => onRefreshPrice()}
              className={`transition-colors ${refreshState === 'fail' ? 'text-red-400 hover:text-red-300' : 'text-gray-500 hover:text-teal-300'}`}
              title={refreshState === 'fail'
                ? '현재가를 불러오지 못했습니다 — 클릭하여 다시 시도'
                : '현재가 새로고침 — 계산기를 열 때 자동으로 한 번 조회합니다'}
            >
              <RefreshCw size={12} className={refreshState === 'loading' ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            onClick={() => { setPinnedPrices({}); doRegenerate(currentPrice, tickSize, targetAmount, mult, {}); }}
            className="text-gray-500 hover:text-amber-300 transition-colors"
            title="초기화 — 직접 입력한 단가·수량을 모두 버리고 현재가 기준으로 다시 배분합니다"
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
          <span className="text-gray-300 font-bold">
            {fmtCurPrice(currentPrice)}{wonLine(currentPrice)}
            {showRate && (
              <span
                className={`block text-[9px] font-normal leading-tight ${rateClass(curRate)}`}
                title={`${prevLabel} 대비 — 리밸런싱 표의 등락률과 같은 값입니다. 사다리의 등락률은 모두 이 전일 종가가 기준입니다.`}
              >
                {rateText(curRate)}
              </span>
            )}
          </span>
          <span className="text-gray-500 whitespace-nowrap" title={`리밸런싱이 정한 ${isSell ? '부족분' : '증가분'} 금액 = 기준 수량 × 현재가. 사다리는 이 금액을 넘지 않는 최대 수량을 배분합니다.`}>목표 금액</span>
          <span className="text-sky-300 font-bold text-right">{fmt(targetAmount)}{wonLine(targetAmount)}</span>

          <span className="text-gray-500 whitespace-nowrap">평균단가</span>
          <span className="text-yellow-400 font-bold">
            {avgPrice > 0 ? fmt(avgPrice) : '—'}{avgPrice > 0 && wonLine(avgPrice)}
            {avgPrice > 0 && showRate && (
              <span
                className={`block text-[9px] font-normal leading-tight ${rateClass(avgRate)}`}
                title={`평균 ${sideLabel}단가의 ${prevLabel} 대비 등락률 — 오늘 전일 대비 평균 얼마나 ${isSell ? '높게 파는지' : '낮게 사는지'}를 나타냅니다.`}
              >
                {rateText(avgRate)}
              </span>
            )}
          </span>
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

      {/* ⚠️ 이 모달은 z-1050이라 notify()·ConfirmDialog가 가려진다 — 사용자 피드백은 반드시 모달 내부 인라인. */}
      {droppedPins > 0 && (
        <div className="px-3 py-1.5 bg-amber-950/30 border-b border-amber-800/40 text-[10px] text-amber-300/90 leading-snug">
          직접 입력한 단가 {droppedPins}건이 현재가({fmtCurPrice(currentPrice)}) 기준 사다리 방향과 맞지 않아 반영되지 않았습니다.
          <span className="text-amber-200/60"> ↺ 초기화로 지울 수 있습니다.</span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-[#1e293b] text-gray-400 border-b border-gray-700 z-10">
            <tr>
              <th className="py-2 px-2 text-center font-semibold w-[90px]">{sideLabel}단가</th>
              {showRate && (
                <th
                  className="py-2 px-1 text-center font-semibold w-[58px]"
                  title={`각 ${sideLabel}단가의 ${prevLabel} 대비 등락률입니다. 호가를 ${isSell ? '올릴수록 현재가 등락률보다 커집니다' : '내릴수록 현재가 등락률보다 작아집니다'}.`}
                >
                  등락률
                </th>
              )}
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
                <td colSpan={colCount} className="py-6 px-3 text-center text-[10px] text-gray-500 leading-relaxed">
                  배분할 수량이 없습니다.
                  <span className="block text-gray-600">
                    {emptyReason || `목표 금액(${fmt(targetAmount)})이 1주 값보다 작습니다.`}
                  </span>
                </td>
              </tr>
            )}
            {rows.map((row, idx) => {
              const rowCost = row.price * row.qty;
              // 현재가와 같은 호가는 원값(baseRate)을 그대로 — 위 baseRate 주석의 왕복 오차 방지.
              const rowRate = row.price === currentPrice ? curRate : rateVsPrev(row.price, prevClose);
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
                    {/* ⚠️ Enter는 blur()만 부른다 — 호가·배수 칸처럼 '커밋 후 blur'로 쓰면 이어지는
                        blur 핸들러가 stale 클로저의 초안으로 한 번 더 커밋한다(값은 같지만 setRows가
                        두 번 돌아 재앵커가 중복된다). 커밋 경로는 onBlur 하나로 유지한다. */}
                    <input
                      className={`w-full bg-transparent text-center font-mono outline-none focus:bg-gray-800/60 rounded px-1 py-0.5 select-text ${
                        row.locked ? 'text-indigo-300' : 'text-gray-300'
                      }`}
                      value={priceEdits[row.id] !== undefined ? priceEdits[row.id] : fmt(row.price)}
                      onChange={e => handleRowPriceChange(row.id, e.target.value)}
                      onBlur={() => handleRowPriceBlur(row.id)}
                      onFocus={e => { setPriceEdits(prev => ({ ...prev, [row.id]: String(row.price) })); e.target.select(); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                    />
                  </td>
                  {showRate && (
                    <td className={`py-1 px-1 text-center font-mono text-[10px] ${rateClass(rowRate)}`}>
                      {rateText(rowRate)}
                    </td>
                  )}
                  <td className="py-1 px-1">
                    <input
                      className={`w-full bg-transparent text-center font-bold outline-none focus:bg-gray-800/60 rounded px-1 py-0.5 select-text ${
                        row.locked ? 'text-indigo-300' : isSell ? 'text-red-400' : 'text-green-400'
                      }`}
                      value={row.qty}
                      onChange={e => handleRowQtyChange(row.id, e.target.value)}
                      onFocus={e => e.target.select()}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
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
