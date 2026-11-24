// 평균 과표 계산기 '붙여넣기' — 증권사 주문내역 사진을 Claude가 글로 옮긴 것을 붙이면 날짜별 매수·매도 행을 만든다.
// `verify:tax-paste`가 직접 import한다. ⚠️ 이 파일에는 import를 두지 말 것 — Node가 타입만 벗겨 그대로 실행한다.
//
// 규칙(사용자 요청 2026-11-24):
//  - 한 줄 = 체결 하나. `2026-11-24 매도 50주 7,490원` · 미래에셋 표 그대로 `11.24 매도 7,485 50 7,490`
//    (주문단가 체결수량 평균체결가)도 받는다. 연도가 없으면 올해, 오늘보다 뒤면 작년.
//  - 같은 날·같은 구분은 한 행으로 합친다 — 수량 합, 단가 = 수량 가중평균(소수 2자리).
//  - 같은 날·같은 구분·같은 수량 행이 이미 있으면 새로 만들지 않는다(사진은 최근 1개월이라 이전 입력과 겹친다).
//    그 행의 **빈** 단가·과표기준가만 채운다. 이미 들어 있는 값은 덮지 않는다(다르면 미리보기에 메모만).
//  - `과표 10,385.80`이 붙으면 그 행의 과표기준가. 매수·매도 없이 `2026-11-24 과표 10,385.80`만 있으면
//    그날 행들의 빈 과표기준가를 채운다.

export type PasteSide = 'buy' | 'sell';
export interface PasteTrade { date: string; side: PasteSide; qty: number; price: number; fills: number; taxBase: number }
export interface PasteSkip { line: string; reason: string }
export interface PasteParsed { trades: PasteTrade[]; taxBaseByDate: Record<string, number>; skipped: PasteSkip[] }
export type PasteStatus = 'add' | 'fill' | 'same';
export interface PastePlanRow {
  date: string;
  side: PasteSide | null;
  qty: number;
  price: number;
  fills: number;
  taxBase: number;
  status: PasteStatus;
  targetId?: string;
  patch?: Record<string, number>;
  note: string;
}

// krEtfTaxHelpers.safeNum과 같은 해석(쉼표 허용).
const num = (v: unknown): number => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;
const pad2 = (n: number): string => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const DATE_FULL = /^\s*(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/;
const DATE_SHORT = /^\s*(\d{1,2})\s*[./월]\s*(\d{1,2})\s*일?(?![\d,])/;
const TAX_RE = /과표(?:기준가)?\s*[:=]?\s*([\d,]*\d(?:\.\d+)?)/;
// 소수도 잡아야 한다 — `1.5주`를 `5주`로 읽으면 수량 오류가 조용히 다른 수로 들어간다(정수 검사에서 거절).
const QTY_RE = /([\d,]*\d(?:\.\d+)?)\s*주(?!문)/;
const PRICE_RE = /([\d,]*\d(?:\.\d+)?)\s*원/;
const NUM_RE = /[\d,]*\d(?:\.\d+)?/g;
const KEYWORD_RE = /매수|매도|과표/;

function readDate(line: string, today: string): { date: string; rest: string } | null {
  const full = line.match(DATE_FULL);
  if (full) {
    const date = ymd(Number(full[1]), Number(full[2]), Number(full[3]));
    return { date, rest: line.slice(full[0].length) };
  }
  const short = line.match(DATE_SHORT);
  if (short) {
    const year = Number(String(today).slice(0, 4));
    const m = Number(short[1]), d = Number(short[2]);
    let date = ymd(year, m, d);
    if (date && date > today) date = ymd(year - 1, m, d);
    return { date, rest: line.slice(short[0].length) };
  }
  return null;
}

export function parseTaxCalcPaste(text: string, today: string): PasteParsed {
  const groups = new Map<string, { date: string; side: PasteSide; qty: number; amount: number; fills: number; taxBase: number }>();
  const taxBaseByDate: Record<string, number> = {};
  const skipped: PasteSkip[] = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const dated = readDate(line, today);
    if (!dated) {
      if (KEYWORD_RE.test(line)) skipped.push({ line, reason: '날짜 없음' });
      continue;
    }
    if (!dated.date) { skipped.push({ line, reason: '없는 날짜' }); continue; }
    let rest = dated.rest;
    let taxBase = 0;
    const tax = rest.match(TAX_RE);
    if (tax) { taxBase = num(tax[1]); rest = rest.replace(tax[0], ' '); }
    const isBuy = /매수/.test(rest), isSell = /매도/.test(rest);
    if (isBuy && isSell) { skipped.push({ line, reason: '매수·매도가 한 줄에 함께 있음' }); continue; }
    if (!isBuy && !isSell) {
      if (taxBase > 0) taxBaseByDate[dated.date] = taxBase;
      else skipped.push({ line, reason: '매수·매도 구분 없음' });
      continue;
    }
    let qty = 0, price = 0;
    const qtyU = rest.match(QTY_RE);
    if (qtyU) { qty = num(qtyU[1]); rest = rest.replace(qtyU[0], ' '); }
    const priceU = rest.match(PRICE_RE);
    if (priceU) { price = num(priceU[1]); rest = rest.replace(priceU[0], ' '); }
    const nums = (rest.match(NUM_RE) || []).map(num);
    if (!qtyU && !priceU) {
      // 미래에셋 표 순서: 주문단가 · 체결수량 · 평균체결가
      if (nums.length >= 3) { qty = nums[1]; price = nums[2]; }
      else if (nums.length === 2) { qty = nums[0]; price = nums[1]; }
    } else if (!qtyU) {
      qty = nums.length > 0 ? nums[0] : 0;
    } else if (!priceU) {
      price = nums.length > 0 ? nums[nums.length - 1] : 0;
    }
    if (!(qty > 0)) { skipped.push({ line, reason: '체결 수량 없음' }); continue; }
    if (!Number.isInteger(qty)) { skipped.push({ line, reason: '수량이 정수가 아님' }); continue; }
    if (!(price > 0)) { skipped.push({ line, reason: '단가 없음' }); continue; }
    const side: PasteSide = isBuy ? 'buy' : 'sell';
    const key = `${dated.date}|${side}`;
    const g = groups.get(key) || { date: dated.date, side, qty: 0, amount: 0, fills: 0, taxBase: 0 };
    g.qty += qty;
    g.amount += qty * price;
    g.fills += 1;
    if (taxBase > 0) g.taxBase = taxBase;
    groups.set(key, g);
  }
  const trades = [...groups.values()]
    .map(g => ({
      date: g.date,
      side: g.side,
      qty: g.qty,
      price: round2(g.amount / g.qty),
      fills: g.fills,
      taxBase: g.taxBase > 0 ? g.taxBase : (taxBaseByDate[g.date] || 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.side === 'buy' ? -1 : 1) - (b.side === 'buy' ? -1 : 1));
  return { trades, taxBaseByDate, skipped };
}

const priceFieldOf = (side: PasteSide): string => (side === 'sell' ? 'sellPrice' : 'purchasePrice');
const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function planTaxCalcPaste(parsed: PasteParsed, events: any[]): PastePlanRow[] {
  const list = Array.isArray(events) ? events : [];
  const used = new Set<string>();
  const rows: PastePlanRow[] = [];
  for (const t of parsed.trades) {
    const sign = t.side === 'sell' ? -1 : 1;
    const sameSide = list.filter(e => String(e?.date || '') === t.date && Math.sign(num(e?.change)) === sign);
    const match = sameSide.find(e => Math.abs(num(e.change)) === t.qty && !used.has(e.id));
    if (!match) {
      rows.push({ ...t, status: 'add', note: sameSide.length > 0 ? '같은 날 수량이 다른 행이 있음 — 겹치지 않는지 확인' : '' });
      continue;
    }
    used.add(match.id);
    const field = priceFieldOf(t.side);
    const patch: Record<string, number> = {};
    const notes: string[] = [];
    const curPrice = num(match[field]);
    if (!(curPrice > 0)) patch[field] = t.price;
    else if (Math.abs(curPrice - t.price) >= 1) notes.push(`입력된 단가 ${fmt(curPrice)}`);
    const curTax = num(match.taxBasePrice);
    if (t.taxBase > 0) {
      if (!(curTax > 0)) patch.taxBasePrice = t.taxBase;
      else if (Math.abs(curTax - t.taxBase) >= 0.01) notes.push(`입력된 과표 ${fmt(curTax)}`);
    }
    const filled = Object.keys(patch).length > 0;
    rows.push({ ...t, status: filled ? 'fill' : 'same', targetId: match.id, patch: filled ? patch : undefined, note: notes.join(' · ') });
  }
  for (const [date, taxBase] of Object.entries(parsed.taxBaseByDate)) {
    const dayRows = list.filter(e => String(e?.date || '') === date && num(e?.change) !== 0 && !used.has(e.id));
    const tradedToday = parsed.trades.some(t => t.date === date);
    if (dayRows.length === 0) {
      if (!tradedToday) rows.push({ date, side: null, qty: 0, price: 0, fills: 0, taxBase, status: 'same', note: '그날 매매 행 없음' });
      continue;
    }
    for (const e of dayRows) {
      used.add(e.id);
      const change = num(e.change);
      const side: PasteSide = change < 0 ? 'sell' : 'buy';
      const curTax = num(e.taxBasePrice);
      const base = { date, side, qty: Math.abs(change), price: num(e[priceFieldOf(side)]), fills: 0, taxBase, targetId: e.id };
      if (!(curTax > 0)) rows.push({ ...base, status: 'fill', patch: { taxBasePrice: taxBase }, note: '' });
      else rows.push({ ...base, status: 'same', note: Math.abs(curTax - taxBase) >= 0.01 ? `입력된 과표 ${fmt(curTax)}` : '' });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function applyTaxCalcPaste(
  events: any[],
  plan: PastePlanRow[],
  opts: { newId: () => string; prevQtyOf: (date: string) => number },
): any[] {
  const patches = new Map<string, Record<string, number>>();
  for (const r of plan) {
    if (r.status === 'fill' && r.targetId && r.patch) patches.set(r.targetId, { ...(patches.get(r.targetId) || {}), ...r.patch });
  }
  const next = (Array.isArray(events) ? events : []).map(e => (patches.has(e.id) ? { ...e, ...patches.get(e.id) } : e));
  for (const r of plan) {
    if (r.status !== 'add' || !r.side) continue;
    next.push({
      id: opts.newId(),
      date: r.date,
      prevQty: opts.prevQtyOf(r.date),
      change: r.side === 'sell' ? -r.qty : r.qty,
      [priceFieldOf(r.side)]: r.price,
      taxBasePrice: r.taxBase > 0 ? r.taxBase : 0,
    });
  }
  return next;
}

export function pasteCounts(plan: PastePlanRow[]): { add: number; fill: number } {
  return {
    add: plan.filter(r => r.status === 'add').length,
    fill: plan.filter(r => r.status === 'fill').length,
  };
}
