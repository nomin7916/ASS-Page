// 자산 평가액 추이 「📷 주문내역 사진으로 매매 넣기」(사용자 요청 2026-11-26)
//
// 증권사 주문·체결내역 사진 → /api/holdings-photo(kind 'trades', Gemini) → 줄 `매매 | 날짜 | 코드 | 종목명 | 구분 | 체결수량 | 체결단가`
//   → 해석(parseTradeText) → 날짜·종목·구분별로 합침(groupTrades — 같은 날 여러 번 체결 = 수량 합 · 단가 가중평균)
//   → 날짜순(같은 날은 매도 먼저)으로 그날의 매매를 하나씩 넣는다 = 자산검증 「매매 반영」과 **같은 함수**(backdatedTrade).
// 사용자 사진 사례(미래에셋 MY주식 → 주문내역(최근 1개월)): 종목명은 화면 위 제목에만 있고, 날짜는 '11.17'(연도 없음),
//   열은 주문날짜·구분·주문단가·체결수량·평균체결가 → 체결수량·평균체결가를 쓴다(주문단가 아님).
// 두 번 넣지 않기:
//   ① 이 도구·자산검증 「매매 반영」이 그날 기록에 남긴 매매(snapshot.trades)와 종목·구분·수량이 같으면 건너뛴다.
//   ② 그날 계좌 표에서 바로 고친 경우(그날 기록이 있고 직전 기록과의 수량 차이 = 사진의 그날 순매매) 건너뛴다.
//   ③ 계좌 표가 이미 매매 전부를 반영한 수량이면(오늘 표에서 먼저 고침) 그 변경을 매매 날짜들로 '옮긴다'(표 수량 그대로).
// ⚠️ 사진·계좌번호는 저장하지 않는다. ⚠️ utils·backdatedTrade·holdingsPhoto는 import가 없는 모듈이라
//    scripts/verify-trade-photo.mjs가 이 파일을 직접 import한다(.ts 확장자 import — evalCompare와 같은 규약).

import { resolveHoldings, snapshotItemsFromPortfolio } from './utils.ts';
import { planBackdatedTrade, applyBackdatedTrade, tradeKeyOf, tradeCostKind, tradeCostOf } from './backdatedTrade.ts';
import { normName } from './holdingsPhoto.ts';

export interface TradeRow { date: string; rawDate: string; code: string; name: string; side: 'buy' | 'sell'; qty: number; price: number; line: string }
export interface TradeSkip { line: string; reason: string }
export interface TradeParsed { rows: TradeRow[]; skipped: TradeSkip[]; none: boolean }
export interface TradeGroup { date: string; rawDate: string; code: string; name: string; side: 'buy' | 'sell'; qty: number; price: number; fills: number }
export type TradeStatus = 'ok' | 'nodate' | 'future' | 'noitem' | 'notyet' | 'dup' | 'dayedit' | 'noprice' | 'short' | 'fail';

const num = (v: unknown): number => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/[,\s원주$]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r15 = (n: number): number => (Number.isFinite(n) ? Number(n.toPrecision(15)) : 0);
const pad = (n: number): string => String(n).padStart(2, '0');
const realDate = (y: number, m: number, d: number): string => {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
};

// 사진의 날짜 → YYYY-MM-DD. 연도가 없으면(11.17) 오늘 이전의 가장 가까운 날(올해, 오늘보다 뒤면 작년).
export function normTradeDate(raw: unknown, today: string): string {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  let m = /^(\d{4})[.\-/년](\d{1,2})[.\-/월](\d{1,2})일?$/.exec(s);
  if (m) return realDate(+m[1], +m[2], +m[3]);
  m = /^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(s);
  if (m) return realDate(2000 + +m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[.\-/월](\d{1,2})일?$/.exec(s);
  if (!m) return '';
  const ty = /^\d{4}/.test(today) ? +today.slice(0, 4) : new Date().getFullYear();
  const cur = realDate(ty, +m[1], +m[2]);
  if (cur && (!today || cur <= today)) return cur;
  return realDate(ty - 1, +m[1], +m[2]);
}

const CODE_RE = /^[0-9A-Za-z]{4,12}$/;

export function parseTradeText(text: string, today: string): TradeParsed {
  const rows: TradeRow[] = [];
  const skipped: TradeSkip[] = [];
  let none = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^[\s*>`|-]+/, '').trim();
    if (!line) continue;
    if (/^없음\.?$/.test(line)) { none = true; continue; }
    if (!/^매매\s*\|/.test(line)) continue;
    const f = line.split('|').map(x => x.trim());
    if (f.length < 7) { skipped.push({ line, reason: '칸이 모자람' }); continue; }
    const [, rawDate, codeRaw, name, sideRaw, qtyRaw, priceRaw] = f;
    const side = /매수|buy/i.test(sideRaw) ? 'buy' : /매도|sell/i.test(sideRaw) ? 'sell' : '';
    if (!side) { skipped.push({ line, reason: '매수·매도를 못 읽음' }); continue; }
    const qty = num(qtyRaw);
    if (!(qty > 0)) { skipped.push({ line, reason: '체결수량 없음' }); continue; }
    const code = CODE_RE.test(codeRaw) ? codeRaw.toUpperCase() : '';
    if (!code && !name) { skipped.push({ line, reason: '종목을 못 읽음' }); continue; }
    rows.push({ date: normTradeDate(rawDate, today), rawDate, code, name, side, qty, price: Math.max(0, num(priceRaw)), line });
  }
  return { rows, skipped, none: none && rows.length === 0 };
}

// 구독 AI(Gemini 앱·Claude 앱)에 사진과 함께 줄 부탁 글 — API 키 없이 읽는 길(사용자 요청 2026-11-26: Gemini Pro·Claude 구독).
// ⚠️ 답 줄 형식은 서버 부탁 문장(api/_holdingsPhoto.ts buildTradePrompt)과 같아야 한다 — verify:trade-photo #P10이 대조한다.
// 사진을 읽힐 AI(다른 사용자는 이 길만 — 사용자 확정 2026-11-26: "각자 구독 AI와 연동 · 최대한 무료"). 전부 무료 계정으로 사진을 올릴 수 있는 곳,
// 차례 = 무료로 사진 읽기가 넉넉한 순. id는 src/aiProviders.ts AI_HANDS의 id(주소는 그 표 하나 — verify:trade-photo #P12).
export const PHOTO_AI_IDS = ['gemini', 'chatgpt', 'claude', 'copilot', 'grok', 'lechat', 'deepseek'];
export const TRADE_LINE_FORMAT = '매매 | 날짜 | 코드 | 종목명 | 구분 | 체결수량 | 체결단가';
export function tradeAskPrompt({ cands, today }: { cands: { code: string; name: string }[]; today: string }): string {
  const list = (cands || []).length > 0 ? cands.map(c => `${c.code || '-'} ${c.name || ''}`.trim()).join('\n') : '(목록 없음)';
  return [
    `첨부한 증권사 앱의 주문내역·체결내역 사진을 읽어, 체결된 매매마다 아래 형식의 줄 하나로만 답해 주세요. 설명·머리말·표·코드블록 없이 결과 줄만 씁니다.`,
    TRADE_LINE_FORMAT,
    ``,
    `- 날짜는 YYYY-MM-DD로 씁니다. 사진에 연도가 없으면 오늘(${today}) 이전의 가장 가까운 날로 정합니다.`,
    `- 줄마다 종목명이 없고 화면 위(제목)에만 있으면 그 이름을 모든 줄에 씁니다.`,
    `- 아래 [종목 목록]에 같은 종목이 있으면 코드 자리에 그 코드를, 없으면 '-'를 씁니다. 코드를 지어내지 마세요.`,
    `- 구분은 '매수' 또는 '매도'만 씁니다.`,
    `- 체결수량은 '체결수량'(실제 체결)입니다. '주문수량'이 아닙니다. 미체결·취소·거부 줄은 빼 주세요.`,
    `- 체결단가는 '평균체결가'·'체결단가'입니다. '주문단가'가 아닙니다.`,
    `- 같은 날 여러 번 체결했으면 합치지 말고 줄마다 씁니다.`,
    `- 계좌번호·이름 같은 개인정보는 쓰지 않습니다.`,
    ``,
    `[종목 목록]`,
    list,
    ``,
    `예)`,
    `매매 | ${today.slice(0, 4) || '2026'}-11-24 | 0091P0 | TIGER 머니마켓액티브 | 매도 | 50 | 103,920`,
  ].join('\n');
}

// 같은 날·같은 종목·같은 구분 = 한 건(수량 합 · 단가 = 체결가가 있는 줄의 수량 가중평균).
export function groupTrades(rows: TradeRow[]): TradeGroup[] {
  const map = new Map<string, TradeGroup & { pq: number; pv: number }>();
  for (const r of rows) {
    const sk = r.code ? `c:${r.code}` : `n:${normName(r.name)}`;
    const k = `${r.date}|${sk}|${r.side}`;
    const g = map.get(k) || { date: r.date, rawDate: r.rawDate, code: r.code, name: r.name, side: r.side, qty: 0, price: 0, fills: 0, pq: 0, pv: 0 };
    g.qty = r15(g.qty + r.qty);
    g.fills += 1;
    if (r.price > 0) { g.pq = r15(g.pq + r.qty); g.pv += r.qty * r.price; }
    if (!g.name && r.name) g.name = r.name;
    map.set(k, g);
  }
  return [...map.values()].map(({ pq, pv, ...g }) => ({ ...g, price: pq > 0 ? r15(pv / pq) : 0 }));
}

// 사진 줄 → 그날 보유 항목(스냅샷 항목엔 id가 없다) 위치. 코드 → 이름 같음 → 잘린 이름(앞부분 4글자 이상, 하나뿐).
export function matchTradeIndex(g: { code: string; name: string }, items: any[]): number {
  const list = Array.isArray(items) ? items : [];
  const ok = (it: any) => it && it.type === 'stock' && !it.isManualCash;
  if (g.code) {
    const i = list.findIndex(it => ok(it) && String(it.code ?? '').trim().toUpperCase() === g.code);
    if (i >= 0) return i;
  }
  const rn = normName(g.name);
  if (!rn) return -1;
  const ex = list.findIndex(it => ok(it) && normName(it.name) === rn);
  if (ex >= 0) return ex;
  if (rn.length < 4) return -1;
  const head = list.map((it, i) => (ok(it) && normName(it.name).startsWith(rn) ? i : -1)).filter(i => i >= 0);
  if (head.length === 1) return head[0];
  const short = list.map((it, i) => { const n = normName(it?.name); return ok(it) && n.length >= 4 && rn.startsWith(n) ? i : -1; }).filter(i => i >= 0);
  return short.length === 1 ? short[0] : -1;
}

const baseAt = (p: any, date: string): any[] => snapshotItemsFromPortfolio(resolveHoldings(p, date).items || []);
const sortedSnaps = (p: any): any[] => (Array.isArray(p?.holdingSnapshots) ? p.holdingSnapshots : [])
  .filter((s: any) => s && Array.isArray(s.items) && s.date)
  .slice().sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
const qtyOf = (items: any[], k: string): number => {
  const it = (items || []).find((x: any) => tradeKeyOf(x) === k);
  return it ? num(it.quantity) : 0;
};
const signed = (g: TradeGroup): number => (g.side === 'buy' ? g.qty : -g.qty);

export interface TradeResult extends TradeGroup {
  status: TradeStatus; k: string; itemName: string; before: number; after: number;
  costBefore: number; costAfter: number; mode: '' | 'add' | 'move'; reason: string;
}

// 계획 + 적용 — 계좌 객체 p(계좌 하나)를 받아 새 계좌와 건마다의 결과를 돌려준다(원본은 바꾸지 않는다).
// 화면은 미리 한 번(결과·되돌리기 준비) · 앱 탭 갱신 함수 안에서 최신 계좌 위에서 한 번 더 부른다(같은 결과).
export function runTradePhoto(p0: any, groups: TradeGroup[], opts: { accountType?: string; cashOn?: boolean; today: string }): {
  next: any; results: TradeResult[]; live: { k: string; name: string; qtyBefore: number; qtyAfter: number; costBefore: number; costAfter: number }[];
  cash: { before: number; after: number } | null; applied: number; moved: string[];
} {
  const accountType = opts.accountType || p0?.accountType || 'portfolio';
  const today = opts.today || '';
  const order = [...(groups || [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1)
    || String(a.name).localeCompare(String(b.name)));
  const snaps0 = sortedSnaps(p0);
  const results: TradeResult[] = order.map(g => {
    const r: TradeResult = { ...g, status: 'ok', k: '', itemName: g.name, before: 0, after: 0, costBefore: 0, costAfter: 0, mode: '', reason: '' };
    if (!g.date) { r.status = 'nodate'; return r; }
    if (today && g.date > today) { r.status = 'future'; return r; }
    const base = baseAt(p0, g.date);
    const idx = matchTradeIndex(g, base);
    if (idx < 0) { r.status = matchTradeIndex(g, p0?.portfolio || []) >= 0 ? 'notyet' : 'noitem'; return r; }
    r.k = tradeKeyOf(base[idx]);
    r.itemName = base[idx].name || g.name;
    const day = snaps0.find((s: any) => s.date === g.date);
    const recs = day && Array.isArray(day.trades) ? day.trades : [];
    if (recs.some((t: any) => t && t.k === r.k && t.side === g.side && r15(num(t.qty)) === r15(g.qty))) { r.status = 'dup'; return r; }
    if (g.side === 'buy' && !(g.price > 0)) { r.status = 'noprice'; return r; }
    return r;
  });
  // ② 그날 계좌 표에서 바로 고친 날(매매 기록 없는 그날 기록) — 직전 기록과의 수량 차이가 사진의 그날 순매매와 같으면 이미 반영된 것.
  const dayNet = new Map<string, number>();
  for (const r of results) if (r.status === 'ok' || r.status === 'noprice') dayNet.set(`${r.date}|${r.k}`, r15((dayNet.get(`${r.date}|${r.k}`) || 0) + signed(r)));
  for (const r of results) {
    if (r.status !== 'ok' && r.status !== 'noprice') continue;
    const si = snaps0.findIndex((s: any) => s.date === r.date);
    if (si <= 0 || (Array.isArray(snaps0[si].trades) && snaps0[si].trades.length > 0)) continue;
    const net = dayNet.get(`${r.date}|${r.k}`) || 0;
    if (net !== 0 && r15(qtyOf(snaps0[si].items, r.k) - qtyOf(snaps0[si - 1].items, r.k)) === net) r.status = 'dayedit';
  }
  // ③ 옮기기 — 종목마다: 첫 매매일 수량 q0 + 사진 순매매 = 계좌 표 수량이고, 그 수량이 마지막 매매일 뒤의 기록에서 처음 나타났으면.
  const stopFor = new Map<string, string>();
  const byK = new Map<string, TradeResult[]>();
  for (const r of results) if (r.status === 'ok') byK.set(r.k, [...(byK.get(r.k) || []), r]);
  for (const [k, list] of byK) {
    const d1 = list[0].date, dn = list[list.length - 1].date;
    const base1 = baseAt(p0, d1);
    const bi = base1.find((it: any) => tradeKeyOf(it) === k);
    if (!bi || tradeCostKind(accountType, bi) !== 'invest' || !(num(bi.investAmount) > 0)) continue;
    const q0 = num(bi.quantity);
    const target = r15(q0 + list.reduce((s, r) => s + signed(r), 0));
    if (target === q0) continue;
    const s = snaps0.find((x: any) => x.date > d1 && r15(qtyOf(x.items, k)) !== r15(q0));
    const live = (p0?.portfolio || []).find((it: any) => tradeKeyOf(it) === k);
    if (s && s.date > dn && r15(qtyOf(s.items, k)) === target && live && r15(num(live.quantity)) === target) stopFor.set(k, s.date);
  }
  let p = p0;
  let applied = 0;
  for (const r of results) {
    if (r.status !== 'ok') continue;
    const base = baseAt(p, r.date);
    const idx = base.findIndex((it: any) => tradeKeyOf(it) === r.k);
    if (idx < 0) { r.status = 'notyet'; continue; }
    const oldQty = num(base[idx].quantity);
    const newQty = r15(oldQty + signed(r));
    r.before = oldQty;
    if (newQty < 0) { r.status = 'short'; continue; }
    const stop = stopFor.get(r.k) || '';
    const plan = planBackdatedTrade(p, {
      accountType, date: r.date, baseItems: base, baseIndex: idx, newQty, price: r.price,
      cashOn: !!opts.cashOn, mode: stop ? 'move' : 'add', stopDate: stop || undefined, src: 'photo',
    });
    if (!plan.ok) { r.status = 'fail'; r.reason = plan.reason; continue; }
    p = applyBackdatedTrade(p, plan, base);
    r.after = newQty; r.costBefore = plan.oldCost; r.costAfter = plan.newCost; r.mode = plan.mode;
    applied += 1;
  }
  const keys = [...new Set(results.filter(r => r.status === 'ok').map(r => r.k))];
  const live = keys.map(k => {
    const a = (p0?.portfolio || []).find((it: any) => tradeKeyOf(it) === k);
    const b = (p?.portfolio || []).find((it: any) => tradeKeyOf(it) === k);
    const kind = tradeCostKind(accountType, a || b || {});
    return { k, name: (a || b)?.name || '', qtyBefore: a ? num(a.quantity) : 0, qtyAfter: b ? num(b.quantity) : 0, costBefore: tradeCostOf(a, kind), costAfter: tradeCostOf(b, kind) };
  }).filter(x => x.name);
  const depOf = (q: any) => { const d = (q?.portfolio || []).find((it: any) => it && it.type === 'deposit'); return d ? num(d.depositAmount) : null; };
  const cb = depOf(p0), ca = depOf(p);
  const moved = [...new Set(results.filter(r => r.status === 'ok' && r.mode === 'move').map(r => r.itemName))];
  return { next: p, results, live, cash: cb !== null && ca !== null && cb !== ca ? { before: cb, after: ca } : null, applied, moved };
}

// 되돌리기 — 넣기 전 보유 기록·기준일과 계좌 표 항목의 수량·원가·예수금 칸을 돌려놓는다(시세 등 다른 칸은 그대로).
const UNDO_FIELDS = ['quantity', 'investAmount', 'investAmountUsd', 'purchasePrice', 'depositAmount'];
export function tradePhotoUndo(p0: any): any {
  const items: Record<string, Record<string, unknown>> = {};
  for (const it of (p0?.portfolio || [])) {
    if (!it || !it.id) continue;
    const f: Record<string, unknown> = {};
    for (const k of UNDO_FIELDS) f[k] = Object.prototype.hasOwnProperty.call(it, k) ? it[k] : undefined;
    items[it.id] = f;
  }
  return {
    holdingSnapshots: p0?.holdingSnapshots, hasBaseline: Object.prototype.hasOwnProperty.call(p0 || {}, 'baselineDate'),
    baselineDate: p0?.baselineDate, preBaselineVerified: p0?.preBaselineVerified, items,
  };
}
export function undoTradePhoto(p: any, u: any): any {
  if (!p || !u) return p;
  const next: any = { ...p, holdingSnapshots: u.holdingSnapshots, preBaselineVerified: u.preBaselineVerified };
  if (u.hasBaseline) next.baselineDate = u.baselineDate; else delete next.baselineDate;
  next.portfolio = (p.portfolio || []).map((it: any) => {
    const f = it && it.id ? u.items[it.id] : null;
    if (!f) return it;
    const o = { ...it };
    for (const k of UNDO_FIELDS) { if (f[k] === undefined) delete o[k]; else o[k] = f[k]; }
    return o;
  });
  return next;
}

export const TRADE_STATUS_TEXT: Record<TradeStatus, string> = {
  ok: '넣음',
  nodate: '날짜를 못 읽음',
  future: '오늘 이후 날짜',
  noitem: '이 계좌에 없는 종목',
  notyet: '그날엔 이 계좌에 없던 종목',
  dup: '이미 넣은 매매',
  dayedit: '그날 표에서 이미 고침',
  noprice: '체결가를 못 읽음(매수)',
  short: '그날 보유보다 많이 판 기록',
  fail: '넣지 못함',
};
