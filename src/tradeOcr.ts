// 주문내역 사진 → 글자 인식(src/screenOcr.ts)이 돌려준 글줄 → 표 구조 파악 → 매매 줄(2026-11-26 사용자 요청: "OCR로 텍스트 추출 → 사진의 구조 파악 → 계산·적용 · AI는 최종 검수만").
// 흐름: 글줄을 같은 높이끼리 행으로 묶는다 → 머리줄(주문날짜·구분·체결수량·평균체결가…)을 찾아 칸의 가로 자리를 잡는다 → 아래 행의 글자를 가장 가까운 칸에 넣는다
//   → 날짜·매수/매도·체결수량·체결가를 꺼낸다. 종목은 행의 종목명 칸, 없으면 위쪽 제목(미래에셋 MY주식처럼 종목명이 화면 위에만 있는 화면)을 이 계좌 종목과 맞춘다.
// 결과는 AI 답과 같은 줄(`매매 | 날짜 | 코드 | 종목명 | 구분 | 체결수량 | 체결단가`)이라 그 뒤는 같은 넣기(parseTradeText → runTradePhoto)를 지난다.
// 프로그램이 스스로 검사한다(AI 없이): 글자 확신이 낮음 · 머리줄 없이 짐작 · 주문단가뿐 · 그날 종가와 15% 넘게 다름 → 「확인 필요」(바로 넣지 않는다).
// ⚠️ DOM 없음 — scripts/verify-trade-ocr.mjs가 직접 import한다(tradePhoto·holdingsPhoto와 같은 .ts import 규약).

import { normTradeDate } from './tradePhoto.ts';
import { normName } from './holdingsPhoto.ts';

export interface OcrLineIn { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }
export type OcrFlag = 'lowconf' | 'noheader' | 'orderprice' | 'farclose' | 'noprice' | 'nodate' | 'noname' | 'selfcheck' | 'cut' | 'dateorder';
export interface OcrTrade { rawDate: string; date: string; code: string; name: string; side: 'buy' | 'sell'; qty: number; price: number; conf: number; flags: OcrFlag[]; src: string; guess?: boolean }
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
  dateorder: '날짜가 앞뒤 줄과 이어지지 않음',
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

// ── 두 줄 머리줄 거래내역(키움 해외 「거래내역」: 거래일자/처리시간 · 거래종류/적요명 · 거래단가·환율/거래수량 · 거래금액/거래금액(외)) ──
// 한 거래 = 위·아래 두 줄. 위 줄 칸은 위 머리줄, 아래 줄 칸은 아래 머리줄에서 가장 가까운 것. 거래종류가 '매매'가 아닌 줄(입금·환전·배당)은 뺀다.
// 프로그램 검수: 거래수량 × 거래단가 ≈ 거래금액(외)(0.5% 안) — 숫자 하나를 잘못 읽으면 어긋난다(selfcheck).
// 종목명 칸이 화면 밖이면(「전체」 보기) 이름 없음(noname) → 화면(TradePhotoSync)이 guessOcrCodes로 그날 종가와 맞춰 찾는다.
type TCol2 = 'date' | 'time' | 'kind' | 'side' | 'price' | 'qty' | 'amt' | 'amtF' | 'name';
const HEAD2: [RegExp, TCol2][] = [
  [/^(거래|주문|체결|매매)?(일자|날짜)$/, 'date'],
  [/^(처리|체결|주문|거래)?시간$/, 'time'],
  [/^거래(종류|구분)$/, 'kind'],
  [/^적요(명)?$|^(매매)?구분$/, 'side'],
  [/^(거래|체결|평균체결)?단가(\/?환율)?$|^체결가$/, 'price'],
  [/^(거래|체결)?수량$/, 'qty'],
  [/^거래금액(외|\(외\))$/, 'amtF'],
  [/^거래금액$/, 'amt'],
  [/^종목(명)?$/, 'name'],
];
const head2Of = (t: string): TCol2 | null => {
  const w = t.replace(/[\s·:]/g, '').replace(/\((외)\)/, '$1');
  for (const [re, c] of HEAD2) if (re.test(w)) return c;
  return null;
};
function parseOcrTrades2(lines: OcrLineIn[], cands: { code: string; name: string }[], today: string): OcrParsed | null {
  const ts = ptoks(lines || []);
  const heads = ts.filter(k => !k.lnum).map(k => ({ k, c: head2Of(k.t) })).filter(x => x.c) as { k: PTok; c: TCol2 }[];
  const has = (c: TCol2) => heads.some(x => x.c === c);
  if (!(has('date') && has('qty') && has('price'))) return null;
  const qh = heads.find(x => x.c === 'qty') as { k: PTok; c: TCol2 }, ph = heads.find(x => x.c === 'price') as { k: PTok; c: TCol2 };
  const lh = qh.k.y1 - qh.k.y0;
  if (Math.abs(qh.k.yc - ph.k.yc) < 0.6 * lh) return null;   // 한 줄 머리줄 → 기존 해석
  const band = heads.filter(x => Math.abs(x.k.yc - qh.k.yc) < 3 * lh);
  const midY = (Math.min(...band.map(x => x.k.yc)) + Math.max(...band.map(x => x.k.yc))) / 2;
  const top = band.filter(x => x.k.yc < midY), bot = band.filter(x => x.k.yc >= midY);
  const hb = Math.max(...band.map(x => x.k.y1));
  const body = lines.filter(l => l.y0 > hb - 0.002);
  const trades: OcrTrade[] = [];
  const nearOf = (k: Tok, list: { k: PTok; c: TCol2 }[]) => list.reduce((b, x) => (Math.abs(x.k.xc - k.xc) < Math.abs(b.k.xc - k.xc) ? x : b)).c;
  // 날짜 줄 = 거래일자 칸에 있는 날짜만(「55.14」 같은 금액이 짧은 날짜 꼴로 읽혀도 거래를 나누지 않게)
  const dates = body.filter(l => DATE_RE.test(l.text.trim()) && nearOf({ t: l.text, xc: (l.x0 + l.x1) / 2, conf: l.conf }, top) === 'date').sort((a, b) => a.y0 - b.y0);
  dates.forEach((dl, i) => {
    const h = dl.y1 - dl.y0;
    const lo = dl.y0 - 0.4 * h, hi = i + 1 < dates.length ? dates[i + 1].y0 - 0.4 * h : 1.01;
    const rows = ocrRows(body.filter(l => (l.y0 + l.y1) / 2 >= lo && (l.y0 + l.y1) / 2 < hi));
    if (rows.length === 0) return;
    const got: Partial<Record<TCol2, Tok[]>> = {};
    rows.slice(0, 2).forEach((row, ri) => {
      for (const k of row.flatMap(toksOf)) (got[nearOf(k, ri === 0 ? top : bot)] ||= []).push(k);
    });
    const all = rows.flatMap(r => r.flatMap(toksOf));
    const sideTok = all.find(k => /^(매수|매도)$/.test(k.t));
    const kindTok = (got.kind || []).find(k => isWordy(k.t));
    if (!sideTok || (kindTok && !/매매/.test(kindTok.t))) return;
    const numIn = (c: TCol2) => (got[c] || []).find(k => NUM_RE.test(k.t.replace(/[원주$]/g, '')));
    const pT = numIn('price'), qT = numIn('qty'), aT = numIn('amtF');
    const qty = qT ? num(qT.t) : 0, price = pT ? num(pT.t) : 0, amtF = aT ? num(aT.t) : 0;
    if (!(qty > 0)) return;
    // 수량 × 단가 = 거래금액(외)이 맞으면 두 숫자는 서로 확인된 것 — 한 자리 수량(「1」)의 낮은 글자 확신은 보지 않는다
    const agree = price > 0 && amtF > 0 && Math.abs(qty * price / amtF - 1) <= 0.005;
    const used = (agree ? [sideTok] : [sideTok, pT, qT]).filter(Boolean) as Tok[];
    const conf = Math.min(dl.conf, ...used.map(k => k.conf));
    const flags: OcrFlag[] = [];
    if (conf < OCR_LOWCONF) flags.push('lowconf');
    if (!(price > 0)) flags.push('noprice');
    else if (amtF > 0 && Math.abs(qty * price / amtF - 1) > 0.005) flags.push('selfcheck');
    const date = normTradeDate(dl.text.trim(), today);
    if (!date) flags.push('nodate');
    const nameText = (got.name || []).filter(k => isWordy(k.t)).map(k => k.t).join(' ');
    const m = nameText ? matchCand(nameText, cands) : null;
    if (!m) flags.push('noname');
    trades.push({ rawDate: dl.text.trim(), date, code: m ? m.code : '', name: m ? m.name : nameText, side: (sideTok.t === '매수' ? 'buy' : 'sell'), qty, price, conf, flags, src: rows.map(r => r.map(l => l.text).join(' ')).join(' / ') });
  });
  return { trades, header: true, title: '' };
}

// 이름 없는 체결 → 그날(또는 그 앞 4일 — 해외는 한국 날짜가 미국 거래일보다 하루 뒤) 종가와 체결가가 2% 안인 이 계좌 종목이 **하나뿐**이면 그 종목(guess).
// 둘 이상이거나 없으면 그대로(확인 필요). closeOf(code, date) = 그날 종가(없으면 0).
export const OCR_GUESS_TOL = 0.02;
export function guessOcrCodes(trades: OcrTrade[], cands: { code: string; name: string }[], closeOf: (code: string, date: string) => number): OcrTrade[] {
  return trades.map(t => {
    if (t.code || !t.date || !(t.price > 0) || !t.flags.includes('noname')) return t;
    const d0 = dayNum(t.date);
    const hit = cands.filter(c => c.code && [0, 1, 2, 3, 4].some(back => {
      const cl = Number(closeOf(c.code, dayStr(d0 - back))) || 0;
      return cl > 0 && Math.abs(t.price / cl - 1) <= OCR_GUESS_TOL;
    }));
    if (hit.length !== 1) return t;
    return { ...t, code: hit[0].code, name: hit[0].name, flags: t.flags.filter(f => f !== 'noname'), guess: true };
  });
}

export function parseOcrTrades(lines: OcrLineIn[], cands: { code: string; name: string }[], today: string): OcrParsed {
  const two = parseOcrTrades2(lines, cands, today);
  if (two) return two;
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
export interface OcrHold { code: string; name: string; qty: number; invest: number; avg: number; conf: number; flags: OcrFlag[]; cut?: boolean; ticker?: string; usd?: boolean }
type HCol = 'name' | 'qty' | 'avail' | 'invest' | 'avg' | 'eval' | 'pl' | 'rate' | 'cur';
const HHEAD: [RegExp, HCol][] = [
  [/^종목(명)?$/, 'name'],
  [/^주문가능(수량)?$|^매도가능(수량)?$|^가능수량$/, 'avail'],
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
// li = 원래 글줄 번호 · lnum = 그 글줄에 숫자가 있음(머리줄 낱말은 글자만 있는 줄에서만 — 키움 원화 잔고 위 요약 「매입금액 189,890,144」를 머리줄로 보지 않게)
interface PTok extends Tok { yc: number; y0: number; y1: number; li: number; lnum: boolean }
function ptoks(lines: OcrLineIn[]): PTok[] {
  return lines.flatMap((l, li) => {
    const ks = toksOf(l);
    const lnum = ks.some(k => NUM_RE.test(k.t.replace(/[원주%]$/, '')));
    return ks.map(k => ({ ...k, yc: (l.y0 + l.y1) / 2, y0: l.y0, y1: l.y1, li, lnum }));
  });
}
const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
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
  const heads = ts.filter(k => !k.lnum).map(k => ({ k, c: hheadOf(k.t) })).filter(x => x.c) as { k: PTok; c: HCol }[];
  // 기준 머리줄 = 보유수량·매입금액 낱말 중 둘레(±0.07)에 머리줄 낱말이 가장 많은 것 — 화면 위 탭 「일반 잔고」의 '잔고' 같은 외톨이 낱말은 머리줄이 아니다
  const near = (a: { k: PTok }) => heads.filter(x => Math.abs(x.k.yc - a.k.yc) < 0.07).length;
  const anchor = heads.filter(x => x.c === 'qty' || x.c === 'invest').reduce((b: { k: PTok; c: HCol } | null, x) => (!b || near(x) > near(b) || (near(x) === near(b) && x.c === 'qty' && b.c !== 'qty') ? x : b), null);
  if (!anchor || near(anchor) < 2) return { holds: [], header: false };
  const band = heads.filter(x => Math.abs(x.k.yc - anchor.k.yc) < 0.07);
  const hb = Math.max(...band.map(x => x.k.y1));
  const cols = band.map(x => ({ c: x.c, xc: x.k.xc, yc: x.k.yc }));
  const numCols = cols.filter(c => c.c !== 'name');
  const isNum = (t: string) => NUM_RE.test(t.replace(/[원주%]$/, ''));
  const body = ts.filter(k => k.y0 > hb - 0.002);
  // 종목 이름 = 이름 낱말이 든 글줄 통째(「나스닥 100 코」의 100도 이름) · 위아래로 붙은 줄은 한 이름(키움: 「나스닥 100 코」/「어 프리미엄 인…」/「GPIQ」)
  const nameLi = new Set(body.filter(k => isWordy(k.t) && !hheadOf(k.t) && !/합계|총|예수금|평가|매매비용|현금/.test(k.t) && !isNum(k.t)).map(k => k.li));
  const nameLines = [...nameLi].map(li => lines[li]).sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const names: { t: string; y0: number; y1: number; yc: number; conf: number; h: number; parts: string[] }[] = [];
  for (const l of nameLines) {
    const last = names[names.length - 1];
    const h = l.y1 - l.y0, yc = (l.y0 + l.y1) / 2;
    if (last && Math.abs(last.yc - yc) < 0.5 * h) { last.parts[last.parts.length - 1] += ' ' + l.text.trim(); last.conf = Math.min(last.conf, l.conf); continue; }
    if (last && l.y0 - last.y1 < 0.5 * Math.min(h, last.h)) { last.parts.push(l.text.trim()); last.y1 = Math.max(last.y1, l.y1); last.conf = Math.min(last.conf, l.conf); continue; }
    names.push({ t: '', y0: l.y0, y1: l.y1, yc, conf: l.conf, h, parts: [l.text.trim()] });
  }
  for (const nm of names) {
    // 한글로 끝나고 한글로 이어지는 줄바꿈은 글자 단위로 잘린 것(「코」/「어」 = 코어) — 붙인다
    nm.t = nm.parts.reduce((acc, p) => (!acc ? p : /[가-힣]$/.test(acc) && /^[가-힣]/.test(p) ? acc + p : acc + ' ' + p), '').replace(/\.{2,}|…/g, '').trim();
  }
  const nameToksLi = nameLi;
  const holds: OcrHold[] = [];
  names.forEach((nm, i) => {
    const h = nm.h;
    const top = nm.y0 - 0.6 * h, bot = i + 1 < names.length ? names[i + 1].y0 - 0.6 * h : 1.01;
    const nums = body.filter(k => k.yc >= top && k.yc < bot && isNum(k.t) && !nameToksLi.has(k.li));
    // 이름 덩어리 마지막 줄이 티커(GPIQ)면 따로 — 해외 종목 코드
    const lastPart = nm.parts[nm.parts.length - 1];
    const ticker = nm.parts.length > 1 && TICKER_RE.test(lastPart) ? lastPart : (TICKER_RE.test(nm.t) ? nm.t : '');
    const shownName = ticker && nm.parts.length > 1 ? nm.parts.slice(0, -1).reduce((acc, p) => (!acc ? p : /[가-힣]$/.test(acc) && /^[가-힣]/.test(p) ? acc + p : acc + ' ' + p), '').replace(/\.{2,}|…/g, '').trim() : nm.t;
    const nearestX = (k: PTok) => { let b = numCols[0], d = 9; for (const c of numCols) { const dd = Math.abs(c.xc - k.xc); if (dd < d) { d = dd; b = c; } } return b.xc; };
    const valueOf = (key: HCol): { v: number; conf: number } | null => {
      const col = numCols.find(c => c.c === key);
      if (!col) return null;
      const stack = numCols.filter(c => Math.abs(c.xc - col.xc) < 0.07).sort((a, b) => a.yc - b.yc);
      const xs = new Set(stack.map(c => c.xc));
      const mine = nums.filter(k => xs.has(nearestX(k))).sort((a, b) => a.yc - b.yc);
      const idx = stack.indexOf(col);
      const pick = mine.length === stack.length ? mine[idx] : (stack.length === 1 && mine.length >= 1 ? mine[0] : null);
      return pick ? { v: num(pick.t.replace(/[원주%]$/, '')), conf: pick.conf, dec: /\.\d/.test(pick.t) } : null;
    };
    const q = valueOf('qty'), inv = valueOf('invest'), avg = valueOf('avg');
    const m0 = matchCand(nm.t, cands);
    if (!q || !(q.v >= 0)) {   // 이름은 보이는데 숫자 줄이 없다 = 사진 아래가 잘림 → 그 종목은 그대로(0으로 하지 않게 '잘림' 줄)
      holds.push({ code: m0 ? m0.code : '', name: m0 ? m0.name : shownName, qty: 0, invest: 0, avg: 0, conf: nm.conf, flags: ['cut'], cut: true, ticker });
      return;
    }
    const flags: OcrFlag[] = [];
    if (q.v > 0 && inv && avg && inv.v > 0 && avg.v > 0 && Math.abs(q.v * avg.v / inv.v - 1) > OCR_SELF_TOL) flags.push('selfcheck');
    const conf = Math.min(nm.conf, q.conf, inv ? inv.conf : 1, avg ? avg.conf : 1);
    if (conf < OCR_LOWCONF) flags.push('lowconf');
    const m = m0;
    if (!m) flags.push('noname');
    // 외화 화면(키움 해외잔고 「외화」) — 매입금액이 소수(141,150.7800)로 보인다 · 원화 화면은 정수
    holds.push({ code: m ? m.code : '', name: m ? m.name : shownName, qty: q.v, invest: inv ? inv.v : 0, avg: avg ? avg.v : 0, conf, flags, ticker, usd: !!((inv && inv.dec) || (avg && avg.dec)) });
  });
  return { holds, header: true };
}
// 사진으로 보유 맞추기(src/holdingsPhoto.ts parseHoldingsText)가 읽는 줄
// 확인이 필요한 줄(글자 확신 낮음·자체 검사 어긋남·잘림)은 '잘림'으로 — 그 종목은 바꾸지 않는다.
export const ocrHoldBad = (h: OcrHold) => !!h.cut || h.flags.includes('lowconf') || h.flags.includes('selfcheck');
export const ocrHoldLine = (h: OcrHold) => ocrHoldBad(h)
  ? `보유 | ${h.code || h.ticker || '-'} | ${h.name} | 잘림`
  : `보유 | ${h.code || h.ticker || '-'} | ${h.name} | ${h.qty} | ${h.invest > 0 ? h.invest : '-'} | ${h.avg > 0 ? h.avg : '-'}`;

// ── 평균 과표 계산기(한 종목) 「주문내역 사진 올리기」 1순위(2026-11-26 사용자 확정: 사진은 OCR 먼저, AI는 그다음) ──
// 주문내역 사진 → 이 종목 체결만 계산기 붙여넣기 줄(`2026-11-24 매도 50주 7490원` — taxCalcPaste.parseTaxCalcPaste가 읽는 꼴).
// 과세 화면 사진(미래에셋 종목 → 정보 → 과세: 일자 · 과표기준가격 · 전일배당전과표기준가격) →
//   과표기준가격 = `2026-11-24 과표 10266.18` 줄(그날 매매 행의 빈 과표기준가) · 전일배당전과표기준가격(배당락일에만 0이 아님) = 그 달 「배당 과표」.
//   화면이 좁으면 머리줄 '과표기준가격'의 앞이 잘려 '기준가격'으로 읽힌다 — 같은 머리줄에 '…배당전과표…' 칸이 있을 때만 그 칸을 과표로 본다.
//   화면 위 제목이 이 종목과 맞지 않으면(다른 종목 화면) 모두 확인 필요(noname).
// 확인 필요한 줄은 넣지 않고 따로 돌려준다(붙여넣기 칸에서 고쳐 넣기). 다른 종목 이름이 보이는 체결은 뺀다(other) · 종목 이름이 아예 없는 체결은 확인 필요.
export interface OcrTaxBase { date: string; rawDate: string; taxBase: number; conf: number; flags: OcrFlag[] }
type TCol = 'tax' | 'ex' | 'guess' | 'date' | 'other';
const tcolOf = (t: string): TCol => {
  const s = t.replace(/^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9]+$/g, '').replace(/[\s()·:]/g, '');
  if (/당전.*과표|전일.*과표|배당.*과표/.test(s)) return 'ex';
  if (/^(과표|과세표준)(기준가격?|기준가)?$/.test(s)) return 'tax';
  if (/^기준가격?$/.test(s)) return 'guess';
  if (/일자|날짜|기준일/.test(s)) return 'date';
  return 'other';
};
// 과세 화면은 하루씩 이어진 달력 날짜다(미래에셋 — 주말 포함). 날짜 + 줄 번호가 거의 모든 줄에서 같으면(이어진 날짜) 그 값에서 벗어난 줄은
//   잘못 읽은 것: 읽은 글자가 맞는 날짜의 앞부분이면(「2026.11.1」 ← 2026.11.11, 끝자리가 잘려 읽힘) 고치고, 아니면 확인 필요.
//   이어진 날짜가 아니면(영업일만 보이는 화면) 가장 긴 한 방향 차례에서 벗어난 줄만 확인 필요.
const dayNum = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5 : NaN);
const dayStr = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
function fixDateOrder<T extends { date: string; raw: string; bad?: boolean }>(recs: T[]): T[] {
  if (recs.length < 3) return recs;
  const d = recs.map(r => dayNum(r.date));
  let up = 0, down = 0;
  for (let i = 1; i < d.length; i++) { if (d[i] > d[i - 1]) up++; else if (d[i] < d[i - 1]) down++; }
  const dir = down >= up ? -1 : 1;
  const cnt = new Map<number, number>();
  d.forEach((v, i) => { if (Number.isFinite(v)) { const o = v - dir * i; cnt.set(o, (cnt.get(o) || 0) + 1); } });
  let mode = NaN, mc = 0;
  cnt.forEach((c, o) => { if (c > mc) { mc = c; mode = o; } });
  if (mc >= Math.max(3, Math.ceil(recs.length * 0.6))) {
    return recs.map((r, i) => {
      if (d[i] - dir * i === mode) return r;
      const want = dayStr(mode + dir * i), raw = r.raw.replace(/\D/g, ''), w = want.replace(/\D/g, '');
      if (raw.length >= 3 && (w.startsWith(raw) || w.slice(4).startsWith(raw))) return { ...r, date: want };
      return { ...r, bad: true };
    });
  }
  // 가장 긴 한 방향 차례(줄 수 적음 — 30줄 안팎)
  const len = d.map(() => 1), prev = d.map(() => -1);
  for (let i = 0; i < d.length; i++) {
    if (!Number.isFinite(d[i])) { len[i] = 0; continue; }
    for (let j = 0; j < i; j++) if (Number.isFinite(d[j]) && (d[i] - d[j]) * dir > 0 && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  }
  let end = 0;
  len.forEach((l, i) => { if (l > len[end]) end = i; });
  const keep = new Set<number>();
  for (let i = end; i >= 0 && len[i] > 0; i = prev[i]) keep.add(i);
  return recs.map((r, i) => (keep.has(i) ? r : { ...r, bad: true }));
}
export function parseOcrTaxBase(lines: OcrLineIn[], stock: { code: string; name: string } | null, today: string): { bases: OcrTaxBase[]; exs: OcrTaxBase[]; header: boolean; titleOk: boolean } {
  const bases: OcrTaxBase[] = [], exs: OcrTaxBase[] = [];
  let cols: { xc: number; c: TCol }[] = [];
  let titleOk = !stock;
  let recs: { date: string; raw: string; conf: number; tax?: Tok; ex?: Tok; bad?: boolean }[] = [];
  for (const row of ocrRows(lines || [])) {
    const toks = row.flatMap(toksOf);
    if (toks.some(k => /과표|과세표준/.test(k.t)) && toks.some(k => tcolOf(k.t) === 'tax' || tcolOf(k.t) === 'ex')) {
      cols = toks.filter(k => isWordy(k.t)).map(k => ({ xc: k.xc, c: tcolOf(k.t) }));
      if (!cols.some(c => c.c === 'tax') && cols.some(c => c.c === 'ex')) cols = cols.map(c => (c.c === 'guess' ? { ...c, c: 'tax' } : c));
      continue;
    }
    if (!cols.length) {
      if (stock && !titleOk && matchCand(row.map(l => l.text).join(' '), [stock])) titleOk = true;
      continue;
    }
    const dateTok = toks.find(k => DATE_RE.test(k.t));
    if (!dateTok) continue;
    const near = (k: Tok) => cols.reduce((b, c) => (Math.abs(c.xc - k.xc) < Math.abs(b.xc - k.xc) ? c : b)).c;
    const numOf = (c: TCol) => toks.find(k => k !== dateTok && NUM_RE.test(k.t.replace(/원$/, '')) && near(k) === c);
    recs.push({ date: normTradeDate(dateTok.t, today), raw: dateTok.t, conf: dateTok.conf, tax: numOf('tax'), ex: numOf('ex') });
  }
  recs = fixDateOrder(recs);
  for (const r of recs) {
    const push = (list: OcrTaxBase[], k: Tok | undefined) => {
      if (!k) return;
      const v = num(k.t);
      if (!(v > 0)) return;
      const flags: OcrFlag[] = [];
      const conf = Math.min(r.conf, k.conf);
      if (conf < OCR_LOWCONF) flags.push('lowconf');
      if (!r.date) flags.push('nodate');
      else if (r.bad) flags.push('dateorder');
      if (!titleOk) flags.push('noname');
      list.push({ date: r.date, rawDate: r.raw, taxBase: v, conf, flags });
    };
    push(bases, r.tax);
    push(exs, r.ex);
  }
  return { bases, exs, header: cols.length > 0, titleOk };
}
export const taxTradeLine = (t: OcrTrade) => `${t.date || t.rawDate || '?'} ${t.side === 'buy' ? '매수' : '매도'} ${t.qty}주 ${t.price > 0 ? t.price : '?'}원`;
export const taxBaseLine = (b: OcrTaxBase) => `${b.date || b.rawDate || '?'} 과표 ${b.taxBase}`;
export interface OcrTaxRead {
  okText: string; okN: number; checkText: string; checks: { line: string; why: string }[]; other: number; holdings: number;
  exs: { date: string; value: number }[]; otherScreens: number;
}
export function ocrTaxRead(perPhoto: OcrLineIn[][], stock: { code: string; name: string }, today: string): OcrTaxRead {
  const cand = { code: stock.code, name: stock.name || stock.code };
  const lists: OcrTrade[][] = [];
  const bases: OcrTaxBase[] = [], exs: OcrTaxBase[] = [];
  let other = 0, holdings = 0, otherScreens = 0;
  for (const lines of perPhoto) {
    if (classifyOcr(lines) === 'holdings') { holdings++; continue; }
    const mine: OcrTrade[] = [];
    for (const t of parseOcrTrades(lines, [cand], today).trades) {
      if (t.code === stock.code) mine.push(t);
      else if (normName(t.name).length >= 2) other++;
      else mine.push(t.flags.includes('noname') ? t : { ...t, flags: [...t.flags, 'noname'] });
    }
    lists.push(mine);
    const tb = parseOcrTaxBase(lines, cand, today);
    // 화면 위 종목 이름이 이 종목과 다르면(다른 종목의 과세 화면) 그 사진의 과표는 통째로 뺀다 — 확인 줄로도 넣지 않는다.
    if (!tb.titleOk && (tb.bases.length || tb.exs.length)) { otherScreens++; continue; }
    const add = (to: OcrTaxBase[], from: OcrTaxBase[]) => { const seen = new Set(to.map(b => b.date || b.rawDate)); for (const b of from) if (!seen.has(b.date || b.rawDate)) to.push(b); };
    add(bases, tb.bases);
    add(exs, tb.exs);
  }
  const trades = mergeOcrPhotos(lists);
  const okT = trades.filter(t => t.flags.length === 0), badT = trades.filter(t => t.flags.length > 0);
  const okB = bases.filter(b => b.flags.length === 0), badB = bases.filter(b => b.flags.length > 0);
  const okE = exs.filter(b => b.flags.length === 0), badE = exs.filter(b => b.flags.length > 0);
  const why = (fs: OcrFlag[]) => fs.map(f => OCR_FLAG_TEXT[f]).join(' · ');
  const checks = [
    ...badT.map(t => ({ line: taxTradeLine(t), why: why(t.flags) })),
    ...badB.map(b => ({ line: taxBaseLine(b), why: why(b.flags) })),
    ...badE.map(b => ({ line: `${b.date || b.rawDate || '?'} 배당 과표 ${b.taxBase}`, why: why(b.flags) + ' — 그 달 「배당 과표」 칸에 직접 넣어 주세요' })),
  ];
  return {
    okText: [...okT.map(taxTradeLine), ...okB.map(taxBaseLine)].join('\n'),
    okN: okT.length + okB.length + okE.length,
    // ⚠️ 배당 과표 줄은 붙여넣기 칸에 넣지 않는다 — `… 과표 N`으로 읽혀 그날 매매 행의 과표기준가에 들어간다.
    checkText: [...badT.map(taxTradeLine), ...badB.map(taxBaseLine)].join('\n'),
    checks, other, holdings, otherScreens,
    exs: okE.map(b => ({ date: b.date, value: b.taxBase })),
  };
}

// ── 예수금 화면(키움 해외 「예수금」: 「원화예수금 12원」 줄 · 통화 | 외화예수금 | 인출가능금 표의 미국달러 줄) ──
// 원화 = 「원화예수금」 낱말 오른쪽 숫자 · 달러 = 미국달러 줄에서 「외화예수금」 머리줄에 가장 가까운 숫자(인출가능금이 아니다).
export interface OcrCash { krw: number | null; usd: number | null; conf: number }
export function parseOcrCash(lines: OcrLineIn[]): OcrCash | null {
  let krw: number | null = null, usd: number | null = null, conf = 1, usdX = -1;
  const isN = (t: string) => NUM_RE.test(t.replace(/[원$]/g, ''));
  for (const row of ocrRows(lines || [])) {
    const toks = row.flatMap(toksOf);
    const w = (k: Tok) => k.t.replace(/\s/g, '');
    const ki = toks.findIndex(k => w(k) === '원화예수금');
    if (ki >= 0) {
      const n = toks.slice(ki + 1).find(k => isN(k.t));
      if (n && krw == null) { krw = num(n.t.replace(/[원$]/g, '')); conf = Math.min(conf, n.conf); }
      continue;
    }
    const hx = toks.find(k => w(k) === '외화예수금');
    if (hx && !toks.some(k => isN(k.t))) { usdX = hx.xc; continue; }
    if (usdX >= 0 && usd == null && toks.some(k => /^(미국달러|USD|달러)$/.test(w(k)))) {
      const n = toks.filter(k => isN(k.t)).reduce((b: Tok | null, k) => (!b || Math.abs(k.xc - usdX) < Math.abs(b.xc - usdX) ? k : b), null);
      if (n) { usd = num(n.t.replace(/[원$]/g, '')); conf = Math.min(conf, n.conf); }
    }
  }
  return krw == null && usd == null ? null : { krw, usd, conf };
}
