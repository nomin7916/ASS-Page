// 주문내역 사진 → 글자 인식(src/screenOcr.ts)이 돌려준 글줄 → 표 구조 파악 → 매매 줄(2026-11-26 사용자 요청: "OCR로 텍스트 추출 → 사진의 구조 파악 → 계산·적용 · AI는 최종 검수만").
// 흐름: 글줄을 같은 높이끼리 행으로 묶는다 → 머리줄(주문날짜·구분·체결수량·평균체결가…)을 찾아 칸의 가로 자리를 잡는다 → 아래 행의 글자를 가장 가까운 칸에 넣는다
//   → 날짜·매수/매도·체결수량·체결가를 꺼낸다. 종목은 행의 종목명 칸, 없으면 위쪽 제목(미래에셋 MY주식처럼 종목명이 화면 위에만 있는 화면)을 이 계좌 종목과 맞춘다.
// 결과는 AI 답과 같은 줄(`매매 | 날짜 | 코드 | 종목명 | 구분 | 체결수량 | 체결단가`)이라 그 뒤는 같은 넣기(parseTradeText → runTradePhoto)를 지난다.
// 프로그램이 스스로 검사한다(AI 없이): 글자 확신이 낮음 · 머리줄 없이 짐작 · 주문단가뿐 · 그날 종가와 15% 넘게 다름 → 「확인 필요」(바로 넣지 않는다).
// ⚠️ DOM 없음 — scripts/verify-trade-ocr.mjs가 직접 import한다(tradePhoto·holdingsPhoto와 같은 .ts import 규약).

import { normTradeDate } from './tradePhoto.ts';
import { normName } from './holdingsPhoto.ts';

export interface OcrLineIn { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }
export type OcrFlag = 'lowconf' | 'noheader' | 'orderprice' | 'farclose' | 'noprice' | 'nodate' | 'noname' | 'selfcheck' | 'cut';
export interface OcrTrade { rawDate: string; date: string; code: string; name: string; side: 'buy' | 'sell'; qty: number; price: number; conf: number; flags: OcrFlag[]; src: string }
export interface OcrParsed { trades: OcrTrade[]; header: boolean; title: string }

export const OCR_LOWCONF = 0.85;
export const OCR_FAR_CLOSE = 0.15;
export const OCR_FLAG_TEXT: Record<OcrFlag, string> = {
  lowconf: '글자를 또렷하게 읽지 못함',
  noheader: '표 머리줄을 못 찾아 칸을 짐작함',
  orderprice: '체결가 칸이 없어 주문단가를 씀',
  farclose: '그날 종가와 15% 넘게 다름',
  noprice: '체결가를 못 읽음',
  nodate: '날짜를 못 읽음',
  noname: '종목을 못 찾음',
  selfcheck: '보유수량×평균단가가 매입금액과 맞지 않음',
  cut: '사진 아래가 잘려 숫자가 없음',
};
export const OCR_SELF_TOL = 0.01;   // 보유수량 × 평균단가 ≈ 매입금액(1% 안) — 숫자 하나를 잘못 읽으면 어긋난다

type Col = 'date' | 'side' | 'qty' | 'fill' | 'price' | 'order' | 'name' | 'other';
// 머리줄 낱말 → 칸 종류(긴 것부터 맞춘다 — '주문단가'를 '단가'로 잘못 보지 않게)
const HEAD: [RegExp, Col][] = [
  [/^(주문|체결|매매|거래)?(날짜|일자|일)$/, 'date'],
  [/^(평균)?체결(단가|가격|가)$|^평균(단가|가)$/, 'fill'],
  [/^주문(단가|가격|가)$/, 'order'],
  [/^(체결)?(수량|량)$|^체결량$/, 'qty'],
  [/^(매매|주문|거래)?구분$|^종류$|^매수\/?매도$/, 'side'],
  [/^종목(명)?$/, 'name'],
  [/^(단가|가격)$/, 'price'],
];
const headOf = (t: string): Col | null => {
  const s = t.replace(/[\s()·:]/g, '');
  for (const [re, c] of HEAD) if (re.test(s)) return c;
  return null;
};
const SIDE_RE = /(매수|매도)/;
const NUM_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$|^[+-]?\d+(\.\d+)?$/;
const DATE_RE = /^(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2})$/;
const num = (s: string) => Number(String(s).replace(/[,원주\s]/g, ''));

interface Tok { t: string; xc: number; conf: number }
// 쉼표 숫자 둘이 붙어 읽힌 덩어리(「-21,981,85057,654,546」 = -21,981,850 + 57,654,546)를 나눈다 — 쉼표 뒤는 늘 세 자리.
const GLUED = /[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g;
export function splitGlued(t: string): string[] {
  const m = t.match(GLUED);
  return m && m.length >= 2 && m.join('') === t ? m : [t];
}
// 글줄 상자 하나에 낱말이 여럿이면(칸이 붙어 한 상자로 읽힘) 글자 수 비례로 가로 자리를 나눈다.
function toksOf(l: OcrLineIn): Tok[] {
  const parts = l.text.split(/\s+/).filter(Boolean).flatMap(splitGlued);
  if (parts.length <= 1) return [{ t: l.text.trim(), xc: (l.x0 + l.x1) / 2, conf: l.conf }];
  const total = parts.reduce((a, p) => a + p.length, 0) + parts.length - 1;
  const out: Tok[] = [];
  let at = 0;
  for (const p of parts) { const c = at + p.length / 2; out.push({ t: p, xc: l.x0 + (l.x1 - l.x0) * (c / total), conf: l.conf }); at += p.length + 1; }
  return out;
}

// 같은 높이의 글줄을 한 행으로
export function ocrRows(lines: OcrLineIn[]): OcrLineIn[][] {
  const ls = [...lines].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows: { y: number; h: number; ls: OcrLineIn[] }[] = [];
  for (const l of ls) {
    const y = (l.y0 + l.y1) / 2, h = l.y1 - l.y0;
    const r = rows.length ? rows[rows.length - 1] : null;
    if (r && Math.abs(y - r.y) < 0.5 * Math.min(h, r.h)) { r.ls.push(l); r.y = (r.y * (r.ls.length - 1) + y) / r.ls.length; }
    else rows.push({ y, h, ls: [l] });
  }
  return rows.map(r => r.ls.sort((a, b) => a.x0 - b.x0));
}

// 두 글의 닮음(0~1) — 편집 거리
function sim(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
// 글에서 이 계좌 종목 찾기 — 코드 → 이름이 들어 있음 → 잘린 이름(앞부분 4자 이상) → 거의 같음(글자 인식 실수 1~2자)
export function matchCand(text: string, cands: { code: string; name: string }[]): { code: string; name: string } | null {
  const raw = String(text || '');
  const t = normName(raw);
  if (t.length < 2) return null;
  for (const c of cands) if (c.code && new RegExp(`(^|[^0-9A-Z])${c.code}([^0-9A-Z]|$)`, 'i').test(raw.toUpperCase())) return c;
  let best: { code: string; name: string } | null = null, bl = 0;
  for (const c of cands) { const n = normName(c.name); if (n.length >= 2 && t.includes(n) && n.length > bl) { best = c; bl = n.length; } }
  if (best) return best;
  if (t.length >= 4) {
    const head = cands.filter(c => normName(c.name).startsWith(t));
    if (head.length === 1) return head[0];
  }
  let sb: { code: string; name: string } | null = null, ss = 0;
  for (const c of cands) { const n = normName(c.name); if (n.length < 4) continue; const s = sim(t, n); if (s > ss) { ss = s; sb = c; } }
  return ss >= 0.85 ? sb : null;
}
const isWordy = (t: string) => /[가-힣A-Za-z]/.test(t) && !NUM_RE.test(t.replace(/[원%+\s]/g, ''));

export function parseOcrTrades(lines: OcrLineIn[], cands: { code: string; name: string }[], today: string): OcrParsed {
  const rows = ocrRows(lines || []);
  const trades: OcrTrade[] = [];
  let cols: { c: Col; xc: number }[] | null = null;
  let curName: { code: string; name: string } | null = null;
  let title = '';
  for (const row of rows) {
    const toks = row.flatMap(toksOf);
    const heads = toks.map(k => ({ k, c: headOf(k.t) })).filter(x => x.c);
    const kinds = new Set(heads.map(x => x.c));
    if (heads.length >= 2 && (kinds.has('qty') || kinds.has('fill') || kinds.has('order')) && !toks.some(k => SIDE_RE.test(k.t) && !headOf(k.t))) {
      cols = heads.map(x => ({ c: x.c as Col, xc: x.k.xc }));
      continue;
    }
    const rowText = row.map(l => l.text).join(' ');
    const sideTok = toks.find(k => SIDE_RE.test(k.t));
    const nums = toks.filter(k => NUM_RE.test(k.t.replace(/[원주]$/, '')) && !DATE_RE.test(k.t));
    if (!sideTok || nums.length === 0) {
      // 종목 이름 줄(제목·묶음 머리) — 이 계좌 종목과 맞으면 아래 행들의 종목이 된다
      const m = matchCand(rowText, cands);
      if (m) curName = m;
      else if (!title && !cols && isWordy(rowText) && !/주문|체결|내역|조회|계좌|잔고|합계|전체/.test(rowText)) title = rowText.trim();
      continue;
    }
    const flags: OcrFlag[] = [];
    const confMin = Math.min(...row.map(l => l.conf));
    if (confMin < OCR_LOWCONF) flags.push('lowconf');
    const side: 'buy' | 'sell' = (sideTok.t.match(SIDE_RE) as RegExpMatchArray)[1] === '매수' ? 'buy' : 'sell';
    const dateTok = toks.find(k => DATE_RE.test(k.t));
    let qty = 0, price = 0, nameText = '';
    if (cols && cols.length) {
      const colOf = (k: Tok) => { let best = cols![0], bd = 9; for (const c of cols!) { const d = Math.abs(c.xc - k.xc); if (d < bd) { bd = d; best = c; } } return best.c; };
      const by: Record<string, Tok[]> = {};
      for (const k of toks) (by[colOf(k)] ||= []).push(k);
      const n1 = (c: Col) => (by[c] || []).map(k => k.t.replace(/[원주]$/, '')).find(t => NUM_RE.test(t) && !DATE_RE.test(t));
      const q = n1('qty');
      if (q) qty = num(q);
      const f = n1('fill') || n1('price');
      if (f) price = num(f);
      else { const o = n1('order'); if (o) { price = num(o); flags.push('orderprice'); } }
      nameText = (by.name || []).map(k => k.t).join(' ');
    } else {
      // 머리줄 없음 — 숫자를 왼→오른 차례로: [주문단가, 체결수량, 체결가] 또는 [체결수량, 체결가]로 짐작(늘 확인 필요)
      flags.push('noheader');
      const ns = nums.map(k => k.t.replace(/[원주]$/, ''));
      if (ns.length >= 3) { qty = num(ns[ns.length - 2]); price = num(ns[ns.length - 1]); }
      else if (ns.length === 2) { qty = num(ns[0]); price = num(ns[1]); }
      else qty = num(ns[0]);
      nameText = toks.filter(k => isWordy(k.t) && !SIDE_RE.test(k.t)).map(k => k.t).join(' ');
    }
    if (!(price > 0)) flags.push('noprice');
    const date = dateTok ? normTradeDate(dateTok.t, today) : '';
    if (!date) flags.push('nodate');
    const m = (nameText && matchCand(nameText, cands)) || curName;
    if (!m && !nameText && !title) flags.push('noname');
    if (!(qty > 0)) continue;
    trades.push({
      rawDate: dateTok ? dateTok.t : '', date, code: m ? m.code : '', name: m ? m.name : (nameText || title),
      side, qty, price, conf: confMin, flags, src: rowText,
    });
  }
  return { trades, header: !!cols, title: curName ? curName.name : title };
}

// 여러 장 — 겹쳐 찍은 사진에 같은 행이 두 번 나오면 한 번만(같은 사진 안의 똑같은 행은 실제 체결이 둘일 수 있어 둔다).
export function mergeOcrPhotos(perPhoto: OcrTrade[][]): OcrTrade[] {
  const out: OcrTrade[] = [];
  const sig = (t: OcrTrade) => [t.date || t.rawDate, t.code || normName(t.name), t.side, t.qty, t.price].join('|');
  perPhoto.forEach((list, pi) => {
    const before = new Map<string, number>();
    if (pi > 0) for (const t of out) before.set(sig(t), (before.get(sig(t)) || 0) + 1);
    for (const t of list) {
      const s = sig(t), n = before.get(s) || 0;
      if (n > 0) { before.set(s, n - 1); continue; }
      out.push(t);
    }
  });
  return out;
}

// 그날 종가와 견주기(프로그램 검수) — closeOf(code, date) 가 0 이면 견주지 않는다.
export function checkOcrTrades(trades: OcrTrade[], closeOf: (code: string, date: string) => number): OcrTrade[] {
  return trades.map(t => {
    if (!t.code || !t.date || !(t.price > 0)) return t;
    const c = Number(closeOf(t.code, t.date)) || 0;
    if (c > 0 && Math.abs(t.price / c - 1) > OCR_FAR_CLOSE && !t.flags.includes('farclose')) return { ...t, flags: [...t.flags, 'farclose'] };
    return t;
  });
}

// 매매 줄(AI 답과 같은 꼴) — 확인 필요 없는 것 / 확인 필요한 것을 나눈다.
export const ocrTradeLine = (t: OcrTrade) => `매매 | ${t.date || t.rawDate || '-'} | ${t.code || '-'} | ${t.name || '-'} | ${t.side === 'buy' ? '매수' : '매도'} | ${t.qty} | ${t.price > 0 ? t.price : '-'}`;
export function splitOcrTrades(trades: OcrTrade[]): { okText: string; checkText: string; checks: OcrTrade[] } {
  const ok = trades.filter(t => t.flags.length === 0), checks = trades.filter(t => t.flags.length > 0);
  return { okText: ok.map(ocrTradeLine).join('\n'), checkText: checks.map(ocrTradeLine).join('\n'), checks };
}

// ── 잔고(보유) 화면 — MY자산·잔고처럼 종목마다 두 줄(종목명/주문가능·보유수량 · 평가손익/수익률 · 평가금액/매입금액 · 현재가/평균단가)이거나 한 줄 ──
// 머리줄 낱말의 가로 자리로 칸을 잡고, 같은 가로 자리에 머리줄이 위아래 둘이면(평가금액 위 · 매입금액 아래) 종목 칸 안의 숫자도 위아래 차례로 나눈다.
export interface OcrHold { code: string; name: string; qty: number; invest: number; avg: number; conf: number; flags: OcrFlag[]; cut?: boolean }
type HCol = 'name' | 'qty' | 'avail' | 'invest' | 'avg' | 'eval' | 'pl' | 'rate' | 'cur';
const HHEAD: [RegExp, HCol][] = [
  [/^종목(명)?$/, 'name'],
  [/^주문가능(수량)?$|^매도가능(수량)?$/, 'avail'],
  [/^보유(수량)?$|^잔고(수량)?$|^수량$/, 'qty'],
  [/^매입(금액|원가)$|^매수금액$|^투자(금액|원금)$/, 'invest'],
  [/^평균(단가|매입가|매수가)$|^매입(단가|가)$/, 'avg'],
  [/^평가손익$|^손익$/, 'pl'],
  [/^평가(금액)?$/, 'eval'],
  [/^수익률(%)?$/, 'rate'],
  [/^현재가$/, 'cur'],
];
const hheadOf = (t: string): HCol | null => {
  const s = t.replace(/[\s()·:%]/g, '');
  for (const [re, c] of HHEAD) if (re.test(s)) return c;
  return null;
};
interface PTok extends Tok { yc: number; y0: number; y1: number }
function ptoks(lines: OcrLineIn[]): PTok[] {
  return lines.flatMap(l => toksOf(l).map(k => ({ ...k, yc: (l.y0 + l.y1) / 2, y0: l.y0, y1: l.y1 })));
}
export function classifyOcr(lines: OcrLineIn[]): 'orders' | 'holdings' | 'unknown' {
  const ts = ptoks(lines || []);
  const hs = new Set(ts.map(k => hheadOf(k.t)).filter(Boolean));
  const os = new Set(ts.map(k => headOf(k.t)).filter(Boolean));
  const sides = ts.filter(k => /^(매수|매도)$/.test(k.t)).length;
  if ((hs.has('qty') || hs.has('invest')) && (hs.has('avg') || hs.has('invest')) && sides === 0) return 'holdings';
  if ((os.has('qty') || os.has('fill')) && sides > 0) return 'orders';
  if (sides >= 2) return 'orders';
  return 'unknown';
}

export function parseOcrHoldings(lines: OcrLineIn[], cands: { code: string; name: string }[]): { holds: OcrHold[]; header: boolean } {
  const ts = ptoks(lines || []);
  const heads = ts.map(k => ({ k, c: hheadOf(k.t) })).filter(x => x.c) as { k: PTok; c: HCol }[];
  const anchor = heads.find(x => x.c === 'qty') || heads.find(x => x.c === 'invest');
  if (!anchor) return { holds: [], header: false };
  const band = heads.filter(x => Math.abs(x.k.yc - anchor.k.yc) < 0.07);
  const hb = Math.max(...band.map(x => x.k.y1));
  const cols = band.map(x => ({ c: x.c, xc: x.k.xc, yc: x.k.yc }));
  const numCols = cols.filter(c => c.c !== 'name');
  const isNum = (t: string) => NUM_RE.test(t.replace(/[원주%]$/, ''));
  const body = ts.filter(k => k.y0 > hb - 0.002);
  const nameToks = body.filter(k => isWordy(k.t) && !hheadOf(k.t) && !/합계|총|예수금|평가|매매비용|현금/.test(k.t) && !isNum(k.t));
  // 같은 줄의 이름 조각은 하나로
  const names: { t: string; y0: number; y1: number; yc: number; conf: number }[] = [];
  for (const k of nameToks.sort((a, b) => a.yc - b.yc || a.xc - b.xc)) {
    const last = names[names.length - 1];
    if (last && Math.abs(last.yc - k.yc) < 0.5 * (k.y1 - k.y0)) { last.t += ' ' + k.t; last.conf = Math.min(last.conf, k.conf); }
    else names.push({ t: k.t, y0: k.y0, y1: k.y1, yc: k.yc, conf: k.conf });
  }
  const holds: OcrHold[] = [];
  names.forEach((nm, i) => {
    const h = nm.y1 - nm.y0;
    const top = nm.y0 - 0.6 * h, bot = i + 1 < names.length ? names[i + 1].y0 - 0.6 * h : 1.01;
    const nums = body.filter(k => k.yc >= top && k.yc < bot && isNum(k.t));
    const nearestX = (k: PTok) => { let b = numCols[0], d = 9; for (const c of numCols) { const dd = Math.abs(c.xc - k.xc); if (dd < d) { d = dd; b = c; } } return b.xc; };
    const valueOf = (key: HCol): { v: number; conf: number } | null => {
      const col = numCols.find(c => c.c === key);
      if (!col) return null;
      const stack = numCols.filter(c => Math.abs(c.xc - col.xc) < 0.07).sort((a, b) => a.yc - b.yc);
      const xs = new Set(stack.map(c => c.xc));
      const mine = nums.filter(k => xs.has(nearestX(k))).sort((a, b) => a.yc - b.yc);
      const idx = stack.indexOf(col);
      const pick = mine.length === stack.length ? mine[idx] : (stack.length === 1 && mine.length >= 1 ? mine[0] : null);
      return pick ? { v: num(pick.t.replace(/[원주%]$/, '')), conf: pick.conf } : null;
    };
    const q = valueOf('qty'), inv = valueOf('invest'), avg = valueOf('avg');
    const m0 = matchCand(nm.t, cands);
    if (!q || !(q.v >= 0)) {   // 이름은 보이는데 숫자 줄이 없다 = 사진 아래가 잘림 → 그 종목은 그대로(0으로 하지 않게 '잘림' 줄)
      holds.push({ code: m0 ? m0.code : '', name: m0 ? m0.name : nm.t.trim(), qty: 0, invest: 0, avg: 0, conf: nm.conf, flags: ['cut'], cut: true });
      return;
    }
    const flags: OcrFlag[] = [];
    if (q.v > 0 && inv && avg && inv.v > 0 && avg.v > 0 && Math.abs(q.v * avg.v / inv.v - 1) > OCR_SELF_TOL) flags.push('selfcheck');
    const conf = Math.min(nm.conf, q.conf, inv ? inv.conf : 1, avg ? avg.conf : 1);
    if (conf < OCR_LOWCONF) flags.push('lowconf');
    const m = m0;
    if (!m) flags.push('noname');
    holds.push({ code: m ? m.code : '', name: m ? m.name : nm.t.trim(), qty: q.v, invest: inv ? inv.v : 0, avg: avg ? avg.v : 0, conf, flags });
  });
  return { holds, header: true };
}
// 사진으로 보유 맞추기(src/holdingsPhoto.ts parseHoldingsText)가 읽는 줄
// 확인이 필요한 줄(글자 확신 낮음·자체 검사 어긋남·잘림)은 '잘림'으로 — 그 종목은 바꾸지 않는다.
export const ocrHoldBad = (h: OcrHold) => !!h.cut || h.flags.includes('lowconf') || h.flags.includes('selfcheck');
export const ocrHoldLine = (h: OcrHold) => ocrHoldBad(h)
  ? `보유 | ${h.code || '-'} | ${h.name} | 잘림`
  : `보유 | ${h.code || '-'} | ${h.name} | ${h.qty} | ${h.invest > 0 ? h.invest : '-'} | ${h.avg > 0 ? h.avg : '-'}`;
