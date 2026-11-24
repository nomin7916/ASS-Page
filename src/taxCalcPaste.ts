// 평균 과표 계산기 '사진으로 넣기·붙여넣기' — 증권사 주문내역 사진을 AI가 글로 옮긴 것으로 날짜별 매수·매도 행을 만든다.
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
const PROMPT_MARK = '첨부한 사진을 아래 형식의 글로만 바꿔 주세요.';

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
  // 부탁 문장을 통째로 붙이면 그 안의 '예)' 줄이 진짜 매매로 읽힌다 → 아무것도 넣지 않는다.
  if (String(text || '').includes(PROMPT_MARK)) {
    return { trades: [], taxBaseByDate, skipped: [{ line: PROMPT_MARK, reason: 'AI 부탁 문장입니다 — AI가 준 답을 붙여넣으세요' }] };
  }
  for (const raw of String(text || '').split(/\r?\n/)) {
    // AI 답에 흔한 꾸밈(글머리표 `- `·`• `·`1) `, 백틱, 굵게 `**`)은 걷어 낸다. ⚠️ `1.` 꼴 번호는 걷지 않는다 — `11.24` 날짜와 구분이 안 된다.
    const line = raw.replace(/[`*]/g, '').trim().replace(/^[-•·>]+\s*/, '').replace(/^\d{1,2}\)\s+/, '');
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
  // 계산기에 이미 매수·매도가 있는 날은 사진·글의 매매를 새 행으로 넣지 않는다(사용자 확정 2026-11-25 — 없는 날만 넣는다).
  // 같은 날·같은 쪽·같은 수량 행이면 전처럼 그 행의 빈 단가·과표만 채운다.
  const tradedDays = new Set(list.filter(e => num(e?.change) !== 0).map(e => String(e?.date || '')));
  for (const t of parsed.trades) {
    const sign = t.side === 'sell' ? -1 : 1;
    const sameSide = list.filter(e => String(e?.date || '') === t.date && Math.sign(num(e?.change)) === sign);
    const match = sameSide.find(e => Math.abs(num(e.change)) === t.qty && !used.has(e.id));
    if (!match) {
      if (tradedDays.has(t.date)) rows.push({ ...t, status: 'same', note: '그날 매매가 이미 있어 넣지 않음' });
      else rows.push({ ...t, status: 'add', note: '' });
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

// '다른 방법'(사진 읽기가 안 될 때) — 사용자가 쓰는 AI(Claude·Gemini·ChatGPT 등)에 사진과 함께 줄 부탁 문장.
// 기본 길은 아래 '사진으로 넣기'(사이트가 /api/tax-photo로 읽는다, 2026-11-24 사용자 요청). ⚠️ 예시 줄은 parseTaxCalcPaste가 그대로 읽어야 한다(verify:tax-paste #P8).
export function buildPastePrompt({ name, code, year }: { name: string; code: string; year: number }): string {
  const stock = [name, code ? `(${code})` : ''].filter(Boolean).join(' ');
  return [
    `${PROMPT_MARK} 설명·표·코드블록 없이 결과 줄만 주세요.`,
    `종목: ${stock} — 다른 종목 줄은 빼 주세요.`,
    ``,
    `[주문내역·체결내역 사진일 때] 한 줄에 체결 하나`,
    `YYYY-MM-DD 매수(또는 매도) 수량주 평균체결가원`,
    `- 날짜에 연도가 없으면 ${year}년으로 쓰세요(오늘보다 뒤 날짜면 ${year - 1}년).`,
    `- 체결수량이 0인 주문(미체결·취소)은 빼세요.`,
    `- 같은 날 여러 번 체결됐으면 줄을 나눠 그대로 쓰세요(합치지 마세요).`,
    `- 사진에 과표기준가가 있으면 줄 끝에 '과표 숫자'를 붙이세요.`,
    ``,
    `[기준가·과표기준가 표 사진일 때] 한 줄에 날짜 하나`,
    `YYYY-MM-DD 과표 과표기준가`,
    ``,
    `예)`,
    `${year}-11-23 매수 5주 6,960원`,
    `${year}-11-24 매도 50주 7,490원`,
    `${year}-11-24 과표 1,234.56`,
  ].join('\n');
}

export function pasteCounts(plan: PastePlanRow[]): { add: number; fill: number } {
  return {
    add: plan.filter(r => r.status === 'add').length,
    fill: plan.filter(r => r.status === 'fill').length,
  };
}

// ── '다른 방법' — 사진을 쓰시는 AI 앱으로 보내기(사진 읽기가 안 될 때 · 휴대폰 사진첩의 주문내역 사진) ──
// 기기의 '공유' 창(navigator.share)으로 사용자가 고른 AI 앱(Claude·ChatGPT·Gemini)에 사진과 부탁 문장을 넘긴다.
export const PASTE_PHOTO_MAX = 10;
// 사진 고르기 칸의 accept 값(모든 사진 — 아이폰은 HEIC를 JPEG로 바꿔 준다). 슬래시와 별표를 나눠 적는다 — 붙여 쓰면
// 주석 시작으로 보여, 주석을 걷어 내고 소스를 읽는 검사 도구들(importcheck·verify:*)이 그 뒤 코드를 통째로 놓친다.
export const PASTE_PHOTO_ACCEPT = 'image/' + '*';
const IMG_EXT = /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i;

interface PhotoLike { name?: string; size?: number; type?: string; lastModified?: number }

export function isPastePhoto(f: PhotoLike): boolean {
  if (!f) return false;
  return /^image\//.test(String(f.type || '')) || IMG_EXT.test(String(f.name || ''));
}

// 이미 고른 사진(prev)에 새로 고른 것(incoming)을 더할 때 넣을 것만 고른다 — 사진 아닌 파일·같은 사진·10장 넘는 것은 뺀다.
export function mergePastePhotos<T extends PhotoLike>(prev: T[], incoming: T[]): { add: T[]; notImage: number; dup: number; over: number } {
  const key = (f: PhotoLike) => `${f.name || ''}|${f.size || 0}|${f.lastModified || 0}`;
  const seen = new Set((prev || []).map(key));
  const add: T[] = [];
  let notImage = 0, dup = 0, over = 0;
  for (const f of incoming || []) {
    if (!isPastePhoto(f)) { notImage++; continue; }
    const k = key(f);
    if (seen.has(k)) { dup++; continue; }
    if ((prev || []).length + add.length >= PASTE_PHOTO_MAX) { over++; continue; }
    seen.add(k);
    add.push(f);
  }
  return { add, notImage, dup, over };
}

// 공유 창에 넘길 것 — 사진+부탁 문장이 되면 그것, 사진만 되면 사진만(부탁 문장은 클립보드로), 둘 다 안 되면 null(직접 올리기 안내).
export function photoShareData(nav: any, files: unknown[], prompt: string): { data: { files: unknown[]; text?: string }; withText: boolean } | null {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return null;
  if (!files || files.length === 0) return null;
  const full = { files, text: prompt };
  try { if (nav.canShare(full)) return { data: full, withText: true }; } catch { /* 아래로 */ }
  const bare = { files };
  try { if (nav.canShare(bare)) return { data: bare, withText: false }; } catch { /* 아래로 */ }
  return null;
}

// ── 사진으로 넣기(사용자 요청 2026-11-24 "사진만 올리면 AI가 읽고 평균 단가·수량을 바로 적용 — 붙여넣는 과정 없이") ──
// 사이트가 /api/tax-photo(구글 Gemini)로 사진을 읽게 한다. 사진은 기기에서 줄여 보내기만 하고 서버·Drive에 저장하지 않는다.
// 받은 글은 위 parseTaxCalcPaste → planTaxCalcPaste → applyTaxCalcPaste 그대로 거친다(같은 규칙: 같은 날·같은 수량은 빈칸만).
// 요청 본문 상한(서버 Edge 함수가 받는 크기) 안에 들게 사진 base64 합계를 이만큼으로 맞춘다.
export const PHOTO_BODY_BUDGET = 3_000_000;
export const PHOTO_ONE_MAX = 900_000;
export const PHOTO_LONG_MAX = 2400;
export const PHOTO_SHORT_MAX = 1400;
// 줄이는 차례 — 앞에서부터 해 보고 사진 한 장 몫(photoBudget) 안에 들면 그것을 쓴다.
export const PHOTO_TRIES = [
  { scale: 1, q: 0.85 }, { scale: 1, q: 0.72 }, { scale: 0.85, q: 0.7 },
  { scale: 0.7, q: 0.65 }, { scale: 0.55, q: 0.6 }, { scale: 0.45, q: 0.55 },
];

export function photoBudget(n: number): number {
  return Math.max(60_000, Math.min(PHOTO_ONE_MAX, Math.floor(PHOTO_BODY_BUDGET / Math.max(1, n || 1))));
}

// 긴 변·짧은 변을 상한 안으로(키우지는 않는다). scale<1이면 상한도 그만큼 줄인다.
export function photoFitSize(w: number, h: number, scale = 1): { w: number; h: number } {
  const W = Math.max(1, Math.round(w || 1)), H = Math.max(1, Math.round(h || 1));
  const long = Math.max(W, H), short = Math.min(W, H);
  const r = Math.min(1, (PHOTO_LONG_MAX * scale) / long, (PHOTO_SHORT_MAX * scale) / short);
  return { w: Math.max(1, Math.round(W * r)), h: Math.max(1, Math.round(H * r)) };
}

// /api/tax-photo의 응답(줄마다 JSON 하나)을 조금씩 받아 모은다 — api/tax-photo.ts 머리 주석의 형식.
export interface PhotoReadState { text: string; done: boolean; error: string; msg: string; model: string; rest: string }
export const photoReadInit = (): PhotoReadState => ({ text: '', done: false, error: '', msg: '', model: '', rest: '' });
export function photoReadStep(st: PhotoReadState, chunk: string, end = false): PhotoReadState {
  const next = { ...st };
  const lines = (st.rest + String(chunk || '')).split('\n');
  next.rest = end ? '' : (lines.pop() ?? '');
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let o: any;
    try { o = JSON.parse(s); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (typeof o.t === 'string') next.text += o.t;
    if (typeof o.m === 'string') next.model = o.m;
    if (typeof o.e === 'string' && !next.error) { next.error = o.e; next.msg = String(o.msg || ''); }
    if (o.d) next.done = true;
  }
  return next;
}

// 실패 까닭 → 사용자에게 보일 글.
export function photoErrorText(code: string): string {
  switch (code) {
    case 'nokey': return '사이트에 사진 읽기 AI 키가 아직 들어 있지 않습니다 — 관리자에게 알려 주세요(Vercel 환경 변수 GEMINI_API_KEY).';
    case 'rate': return 'AI 무료 사용량을 다 썼습니다 — 잠시 뒤(오래 걸리면 내일) 다시 올려 주세요.';
    case 'block': return 'AI가 이 사진을 읽지 않았습니다 — 주문내역 화면만 보이게 다시 찍어 올려 주세요.';
    case 'cut': return 'AI 답이 중간에 끊겼습니다 — 같은 사진으로 다시 읽어 주세요.';
    case 'auth': return '로그인이 확인되지 않았습니다 — 화면을 새로고침한 뒤 다시 올려 주세요.';
    case 'net': return '인터넷 연결이 끊겨 사진을 보내지 못했습니다 — 다시 읽어 주세요.';
    case 'decode': return '이 사진을 열지 못했습니다(HEIC 등) — 휴대폰 화면 캡처나 JPG 사진으로 올려 주세요.';
    case 'big': return '사진이 너무 커서 줄이지 못했습니다 — 장수를 줄여 다시 올려 주세요.';
    default: return 'AI가 사진을 읽지 못했습니다 — 다시 읽어 보거나, 아래 \'다른 방법\'으로 넣어 주세요.';
  }
}

// 읽은 결과를 어떻게 할지 — 'apply' 넣기 · 'same' 모두 이미 있음 · 'none' 이 종목 체결·과표를 못 찾음.
export function photoOutcome(parsed: PasteParsed, plan: PastePlanRow[]): 'apply' | 'same' | 'none' {
  if (parsed.trades.length === 0 && Object.keys(parsed.taxBaseByDate).length === 0) return 'none';
  const c = pasteCounts(plan);
  return c.add + c.fill > 0 ? 'apply' : 'same';
}
