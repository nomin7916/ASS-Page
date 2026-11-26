// 계좌 표 「📷 사진으로 보유 맞추기」(사용자 요청 2026-11-26) — 증권사 잔고(보유종목) 화면 사진을 AI(구글 Gemini)가
// 읽은 글로 이 계좌 종목의 보유수량·투자금액(매입금액)을 맞춘다. 서버 /api/holdings-photo 가 사진을 읽고, 이 파일은 그 답을
// 해석·계획·적용한다.
//   - 답 한 줄 = 종목 하나: `보유 | 코드 | 종목명 | 보유수량 | 매입금액 | 평균단가` (서버 부탁 문장 api/_holdingsPhoto.ts)
//   - 사진 아래가 잘린 종목은 `보유 | 코드 | 종목명 | 잘림` — 보유 중이라 0으로 만들지 않고 숫자도 바꾸지 않는다.
//   - 사진에 없는 종목(이 계좌 주식 행 중 보유수량 > 0) = 판 종목 → 보유수량·투자금액 0 + 메모(syncNote, 종목명 칸 마우스 올리면 보임).
//     메모에 이전 수량·투자금액을 적어 두므로 잘못 맞춰도 손으로 되돌릴 수 있다.
//   - 이 계좌에 없는 종목 = 새로 산 종목 → 새 행(종목코드는 비워 둔다 — 틀린 코드는 다른 종목 시세를 조용히 끌어온다) + 메모.
//   - 사진 속 종목이 이 계좌와 하나도 맞지 않으면 아무것도 바꾸지 않는다(다른 계좌 사진으로 전 종목이 0이 되는 사고 방지).
//   - 잘린 줄이 남아 있으면(= 목록이 사진 아래로 이어진다) 사진에 없는 종목도 0으로 하지 않는다(keep) — 첫 화면만 찍어
//     올렸을 때 아래 종목이 전부 0이 되는 사고 방지. 맨 아래까지 찍은 사진을 함께 올리면 겹친 종목은 한 번만 쓰여 잘림이 사라진다.
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-holdings-photo.mjs가 Node 타입 스트리핑으로 직접 import한다.

// cut = 사진 아래가 잘려 숫자가 안 보임 · unread = 숫자를 읽었지만 믿을 수 없음(까닭). 둘 다 '사진에 있음'(0으로 하지 않음) · 숫자는 바꾸지 않음.
export interface HoldRow { code: string; name: string; qty: number; invest: number; avg: number; cut: boolean; unread: string; line: string }
export interface HoldSkip { line: string; reason: string }
export interface HoldParsed { rows: HoldRow[]; skipped: HoldSkip[]; none: boolean }
export type HoldKind = 'update' | 'same' | 'zero' | 'keep' | 'add' | 'cut' | 'bad';
export interface HoldPlanRow {
  kind: HoldKind;
  itemId?: string;
  name: string;
  code: string;
  before: { qty: number; invest: number };
  after: { qty: number; invest: number };
  note: string;
}
export type HoldOutcome = 'apply' | 'same' | 'none' | 'mismatch';
export interface HoldPlan { rows: HoldPlanRow[]; outcome: HoldOutcome }
export interface HoldUndo { restore: Record<string, { quantity: unknown; investAmount: unknown; syncNote: unknown }>; added: string[] }

const num = (v: unknown): number => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/[,\s원주]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const CODE_RE = /^[0-9A-Za-z]{4,12}$/;
const CUT_RE = /^(잘림|잘려|안\s*보임|-)$/;

// 종목 이름 비교용 — 띄어쓰기·점·괄호 등을 걷고 대문자로.
export function normName(s: unknown): string {
  return String(s ?? '').toUpperCase().replace(/[\s·.\-_()（）[\]{}'"`/&+]/g, '');
}

// 이 계좌에서 사진과 맞출 행 — 주식 행만(예수금·펀드·예적금·현금 행 제외). 코드나 이름이 있어야 한다.
export function syncTargets(items: any[]): any[] {
  return (Array.isArray(items) ? items : []).filter(it => it && it.type === 'stock' && !it.isManualCash
    && (String(it.code ?? '').trim() !== '' || String(it.name ?? '').trim() !== ''));
}

// 서버에 함께 보내는 '이 계좌 종목 목록' — AI가 잘린 이름을 이 코드로 맞춘다.
export function syncCandidates(items: any[]): { code: string; name: string }[] {
  const out: { code: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const it of syncTargets(items)) {
    const code = String(it.code ?? '').trim().toUpperCase();
    const name = String(it.name ?? '').replace(/[\r\n\t|]+/g, ' ').trim().slice(0, 60);
    const k = code || normName(name);
    if (!k || seen.has(k) || !CODE_RE.test(code || 'XXXX')) continue;
    seen.add(k);
    out.push({ code, name });
    if (out.length >= 80) break;
  }
  return out;
}

export function parseHoldingsText(text: string): HoldParsed {
  const rows: HoldRow[] = [];
  const skipped: HoldSkip[] = [];
  let none = false;
  const byKey = new Map<string, number>();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/[`*]/g, '').trim().replace(/^[-•·>]+\s*/, '');
    if (!line) continue;
    if (/^없음\.?$/.test(line)) { none = true; continue; }
    if (!/^보유\s*\|/.test(line)) {
      if (line.includes('|')) skipped.push({ line, reason: '형식이 다름' });
      continue;
    }
    const p = line.split('|').map(s => s.trim());
    const codeRaw = (p[1] || '').toUpperCase();
    const code = CODE_RE.test(codeRaw) ? codeRaw : '';
    const name = (p[2] || '').slice(0, 60);
    if (!name && !code) { skipped.push({ line, reason: '종목 이름 없음' }); continue; }
    const qtyRaw = p[3] || '';
    let row: HoldRow;
    if (!qtyRaw || CUT_RE.test(qtyRaw)) {
      row = { code, name, qty: 0, invest: 0, avg: 0, cut: true, unread: '', line };
    } else {
      // 숫자를 믿을 수 없는 줄도 '사진에 있는 종목'으로 남긴다 — 빼 버리면 그 종목이 '사진에 없음'으로 0이 된다.
      const qty = num(qtyRaw);
      let invest = num(p[4]);
      const avg = num(p[5]);
      if (qty > 0 && Number.isInteger(qty) && !(invest > 0) && avg > 0) invest = Math.round(qty * avg);
      let unread = '';
      if (!(qty > 0)) unread = '보유수량 없음';
      else if (!Number.isInteger(qty)) unread = '보유수량이 정수가 아님';
      else if (!(invest > 0)) unread = '매입금액·평균단가 없음';
      // 매입금액 = 보유수량 × 평균단가(단가는 원 단위로 반올림돼 보인다 → 수량만큼의 오차 + 0.2%)
      else if (avg > 0 && Math.abs(invest - qty * avg) > Math.max(qty, invest * 0.002)) {
        unread = `매입금액(${fmt(invest)})과 수량×평균단가(${fmt(qty * avg)})가 맞지 않음`;
      }
      if (unread) {
        skipped.push({ line, reason: unread });
        row = { code, name, qty: 0, invest: 0, avg: 0, cut: false, unread, line };
      } else {
        row = { code, name, qty, invest, avg, cut: false, unread: '', line };
      }
    }
    // 사진이 겹치면 같은 종목이 두 번 나올 수 있다 — 숫자가 다 보이는 줄을 남기고, 숫자가 다르면 앞의 것을 둔다.
    const key = code || normName(name);
    const at = byKey.get(key);
    if (at != null) {
      const prev = rows[at];
      const full = (r: HoldRow) => !r.cut && !r.unread;
      if (!full(prev) && full(row)) rows[at] = row;
      else if (full(prev) && full(row) && (prev.qty !== row.qty || prev.invest !== row.invest)) {
        skipped.push({ line, reason: '같은 종목이 다른 숫자로 두 번 나옴(앞의 것만 씀)' });
      }
      continue;
    }
    byKey.set(key, rows.length);
    rows.push(row);
  }
  return { rows, skipped, none: none && rows.length === 0 };
}

// 사진 줄 하나를 이 계좌 행에 잇는다 — 코드 → 이름 같음 → 잘린 이름(앞부분, 4글자 이상, 하나뿐일 때).
export function matchHolding(row: HoldRow, items: any[], used: Set<string>): any | null {
  const free = syncTargets(items).filter(it => !used.has(it.id));
  if (row.code) {
    const byCode = free.find(it => String(it.code ?? '').trim().toUpperCase() === row.code);
    if (byCode) return byCode;
  }
  const rn = normName(row.name);
  if (!rn) return null;
  const exact = free.filter(it => normName(it.name) === rn);
  if (exact.length >= 1) return exact[0];
  if (rn.length >= 4) {
    const head = free.filter(it => normName(it.name).startsWith(rn));
    if (head.length === 1) return head[0];
    const short = free.filter(it => { const n = normName(it.name); return n.length >= 4 && rn.startsWith(n); });
    if (short.length === 1) return short[0];
  }
  return null;
}

export function planHoldingsSync(parsed: HoldParsed, items: any[]): HoldPlan {
  const rows: HoldPlanRow[] = [];
  const used = new Set<string>();
  const targets = syncTargets(items);
  let matched = 0;
  for (const r of parsed.rows) {
    const it = matchHolding(r, items, used);
    if (it) {
      used.add(it.id);
      matched++;
      const before = { qty: num(it.quantity), invest: num(it.investAmount) };
      const name = String(it.name || r.name), code = String(it.code || '');
      if (r.cut || r.unread) { rows.push({ kind: 'cut', itemId: it.id, name, code, before, after: before, note: r.unread ? `숫자를 읽지 못함(${r.unread}) — 그대로 둠` : '사진 아래가 잘려 숫자를 읽지 못함 — 그대로 둠' }); continue; }
      const after = { qty: r.qty, invest: r.invest };
      const same = before.qty === after.qty && Math.round(before.invest) === Math.round(after.invest);
      rows.push({ kind: same ? 'same' : 'update', itemId: it.id, name, code, before, after, note: '' });
      continue;
    }
    if (r.cut || r.unread) { rows.push({ kind: 'bad', name: r.name, code: '', before: { qty: 0, invest: 0 }, after: { qty: 0, invest: 0 }, note: r.unread ? `이 계좌에 없는 종목인데 숫자를 읽지 못해(${r.unread}) 넣지 않음` : '이 계좌에 없는 종목인데 숫자가 잘려 넣지 않음 — 그 종목이 다 보이게 한 장 더 찍어 주세요' }); continue; }
    rows.push({ kind: 'add', name: r.name, code: '', before: { qty: 0, invest: 0 }, after: { qty: r.qty, invest: r.invest }, note: '새 종목 — 종목코드를 넣어 주세요' });
  }
  const listContinues = parsed.rows.some(r => r.cut);
  for (const it of targets) {
    if (used.has(it.id)) continue;
    const before = { qty: num(it.quantity), invest: num(it.investAmount) };
    if (!(before.qty > 0)) continue;
    if (listContinues) {
      rows.push({ kind: 'keep', itemId: it.id, name: String(it.name || it.code || ''), code: String(it.code || ''), before, after: before, note: '사진에 안 보임 — 목록이 사진 아래로 이어져(잘린 종목) 0으로 하지 않음' });
      continue;
    }
    rows.push({ kind: 'zero', itemId: it.id, name: String(it.name || it.code || ''), code: String(it.code || ''), before, after: { qty: 0, invest: 0 }, note: '사진에 없음 — 판 종목으로 보고 0으로' });
  }
  let outcome: HoldOutcome;
  if (parsed.rows.length === 0) outcome = 'none';
  else if (matched === 0 && targets.some(it => num(it.quantity) > 0)) outcome = 'mismatch';
  else outcome = rows.some(r => r.kind === 'update' || r.kind === 'zero' || r.kind === 'add') ? 'apply' : 'same';
  return { rows, outcome };
}

export function holdCounts(plan: HoldPlan): Record<HoldKind, number> {
  const c: Record<HoldKind, number> = { update: 0, same: 0, zero: 0, keep: 0, add: 0, cut: 0, bad: 0 };
  for (const r of plan.rows) c[r.kind]++;
  return c;
}

const mmdd = (today: string): string => {
  const m = String(today || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : String(today || '');
};

// 종목명 칸에 마우스를 올리면 보이는 메모(syncNote) 글.
export function zeroNote(today: string, before: { qty: number; invest: number }): string {
  return `${mmdd(today)} 사진 맞추기 — 사진에 없어 보유수량·투자금액을 0으로 맞췄습니다 (이전 ${fmt(before.qty)}주 · ${fmt(before.invest)}원)`;
}
export function addNote(today: string): string {
  return `${mmdd(today)} 사진 맞추기 — 사진에서 새로 추가한 종목입니다. 종목코드를 넣어 주세요`;
}

// 계획대로 바꾼 항목 배열 + 되돌리기 정보. 시세 필드는 건드리지 않는다(앱 탭이 최신 prev 위에서 부른다).
export function applyHoldingsPlan(items: any[], plan: HoldPlan, opts: { newId: () => string; today: string }): { next: any[]; undo: HoldUndo } {
  const undo: HoldUndo = { restore: {}, added: [] };
  if (plan.outcome !== 'apply') return { next: items, undo };
  const byId = new Map<string, HoldPlanRow>();
  for (const r of plan.rows) if (r.itemId && (r.kind === 'update' || r.kind === 'zero')) byId.set(r.itemId, r);
  const next = (Array.isArray(items) ? items : []).map(it => {
    const r = it && byId.get(it.id);
    if (!r) return it;
    undo.restore[it.id] = { quantity: it.quantity, investAmount: it.investAmount, syncNote: it.syncNote };
    const out: any = { ...it, quantity: r.after.qty, investAmount: r.after.invest };
    if (r.kind === 'zero') out.syncNote = zeroNote(opts.today, r.before);
    else delete out.syncNote;   // 다시 보유 중 — 지난번 '0으로 맞춤' 메모는 지운다
    return out;
  });
  const added: any[] = [];
  for (const r of plan.rows) {
    if (r.kind !== 'add') continue;
    const id = opts.newId();
    undo.added.push(id);
    added.push({
      id, type: 'stock', category: '주식', assetClass: 'D', code: '', name: r.name,
      currentPrice: 0, changeRate: 0, purchasePrice: 0, investAmount: r.after.invest, quantity: r.after.qty,
      targetRatio: 0, isManual: true, syncNote: addNote(opts.today),
    });
  }
  return { next: [...added, ...next], undo };
}

// 되돌리기 — 바꾼 세 칸만 이전 값으로, 새로 넣은 행은 뺀다(그 사이 들어온 시세는 그대로 둔다).
export function undoHoldingsPlan(items: any[], undo: HoldUndo): any[] {
  const added = new Set(undo?.added || []);
  const restore = undo?.restore || {};
  return (Array.isArray(items) ? items : []).filter(it => !(it && added.has(it.id))).map(it => {
    const r = it && restore[it.id];
    if (!r) return it;
    const out: any = { ...it, quantity: r.quantity, investAmount: r.investAmount };
    if (r.syncNote == null || r.syncNote === '') delete out.syncNote; else out.syncNote = r.syncNote;
    return out;
  });
}

// ── 화면 글 ──
export function holdErrorText(code: string): string {
  switch (code) {
    case 'needkey': return '내 Gemini API 키가 필요합니다 — 아래에 키를 넣어 주세요(받는 법: 메모 달력 → AI 연동).';
    case 'badkey': return 'Gemini API 키가 맞지 않습니다 — 키를 다시 복사해 넣어 주세요(앞뒤 빈칸 없이).';
    case 'nokey': return '사이트에 사진 읽기 AI 키가 아직 들어 있지 않습니다 — Vercel 환경 변수 GEMINI_API_KEY 또는 내 키를 넣어 주세요.';
    case 'rate': return 'Gemini 무료 사용량을 다 썼습니다 — 잠시 뒤(오래 걸리면 내일 오후 5시쯤 초기화) 다시 올려 주세요.';
    case 'block': return 'AI가 이 사진을 읽지 않았습니다 — 잔고(보유종목) 화면만 보이게 다시 찍어 올려 주세요.';
    case 'cut': return 'AI 답이 중간에 끊겼습니다 — 같은 사진으로 다시 올려 주세요.';
    case 'auth': return '로그인이 확인되지 않았습니다 — 화면을 새로고침한 뒤 다시 올려 주세요.';
    case 'net': return '인터넷 연결이 끊겨 사진을 보내지 못했습니다 — 다시 올려 주세요.';
    case 'decode': return '이 사진을 열지 못했습니다(HEIC 등) — 화면 캡처나 JPG 사진으로 올려 주세요.';
    case 'big': return '사진이 너무 커서 줄이지 못했습니다 — 장수를 줄여 다시 올려 주세요.';
    default: return 'AI가 사진을 읽지 못했습니다 — 잠시 뒤 다시 올려 주세요.';
  }
}

// Gemini API 키 모양 — 저장 전 가벼운 확인(진짜 확인은 Gemini가 한다).
export function looksLikeGeminiKey(k: unknown): boolean {
  return /^[A-Za-z0-9._-]{30,200}$/.test(String(k ?? '').trim());
}
export function maskKey(k: unknown): string {
  const s = String(k ?? '').trim();
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : '';
}
