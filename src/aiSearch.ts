// 「AI 검색」 채팅창(사용자 요청 2026-11-26) — 화면이 쓰는 순수 로직.
// 질문 → /api/ai-search(구글 Gemini + 구글 검색 연결, 내 키) → 답(NDJSON) 읽기 · 답 글(마크다운) 그리기 조각 · 듣기용 글 나누기 ·
// 대화 묶음(자료) 정리·한도 · 내보내기 글 · 보유 종목 목록.
// 대화 저장은 사용자 Index_Data 폴더 ai_search_chats.json(DRIVE_FILES.AI_SEARCH — App aiSearchApi, saveDriveFile만).
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-ai-search.mjs가 직접 import한다.
// ⚠️ 정규식에 뒤보기((?<=…)·(?<!…))를 쓰지 말 것 — 옛 사파리(16.3 이하)는 이 파일을 읽는 순간 멈춘다.

export const CHATS_MAX = 50;
export const MSGS_MAX = 60;
export const MSG_TEXT_MAX = 20_000;
export const STORE_CHARS_MAX = 1_500_000;
export const SPEECH_RATES = [0.8, 1, 1.2, 1.5, 1.8];
export const HOLD_SEND_MAX = 60;

// ── 답 읽기(NDJSON — api/ai-search.ts) ──
export interface SearchGround { sources: { uri: string; title: string }[]; queries: string[]; html: string }
export interface SearchReadState { text: string; done: boolean; error: string; msg: string; model: string; rest: string; ground: SearchGround | null }
export const searchReadInit = (): SearchReadState => ({ text: '', done: false, error: '', msg: '', model: '', rest: '', ground: null });
export function searchReadStep(st: SearchReadState, chunk: string, end = false): SearchReadState {
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
    if (o.g && typeof o.g === 'object') {
      next.ground = {
        sources: cleanSources(o.g.sources),
        queries: cleanQueries(o.g.queries),
        html: typeof o.g.html === 'string' ? o.g.html : '',
      };
    }
    if (typeof o.e === 'string' && !next.error) { next.error = o.e; next.msg = String(o.msg || ''); }
    if (o.d) next.done = true;
  }
  return next;
}

export function searchErrorText(code: string): string {
  switch (code) {
    case 'needkey': return '내 Gemini API 키가 필요합니다 — ⚙ 설정에서 키를 넣어 주세요(받는 법 그림이 있습니다).';
    case 'badkey': return 'Gemini API 키가 맞지 않습니다 — ⚙ 설정에서 키를 다시 복사해 넣어 주세요(앞뒤 빈칸 없이).';
    case 'credit': return 'Gemini 키의 선불 충전금이 0원입니다 — AI Studio 결제(Billing)에서 충전(최소 $5)하면 다시 됩니다. Google AI Pro 구독이면 매달 $10 크레딧이 먼저 쓰입니다(충전 잔액이 있어야 적용 — 아래 「구독 크레딧 쓰는 법」).';
    case 'nokey': return '사이트 AI 키가 아직 들어 있지 않습니다 — ⚙ 설정에서 내 키를 넣거나 Vercel 환경 변수 GEMINI_API_KEY를 넣어 주세요.';
    case 'rate': return 'Gemini 무료 사용량(하루 한도)을 다 썼습니다 — 한국 시간 오후 4~5시에 다시 채워집니다. 계속 쓰려면 키의 프로젝트에 결제(충전)를 연결하세요.';
    case 'rate1m': return '짧은 사이에 너무 많이 물어 1분 한도에 걸렸습니다 — 1분쯤 뒤 「다시 묻기」를 눌러 주세요.';
    case 'quota0': return '이 키(무료 등급)로는 구글 검색 답을 쓸 수 없습니다(한도 0) — 키의 프로젝트에 결제(충전)를 연결해야 합니다.';
    case 'block': return 'AI가 이 질문에는 답하지 않았습니다 — 질문을 조금 바꿔 다시 물어봐 주세요.';
    case 'cut': return 'AI 답이 중간에 끊겼습니다 — 「다시 묻기」를 눌러 주세요.';
    case 'auth': return '로그인이 확인되지 않았습니다 — 화면을 새로고침한 뒤 다시 물어봐 주세요.';
    case 'net': return '인터넷 연결이 끊겨 질문을 보내지 못했습니다 — 다시 물어봐 주세요.';
    case 'stop': return '답 받기를 멈췄습니다.';
    default: return 'AI가 답하지 못했습니다 — 잠시 뒤 다시 물어봐 주세요.';
  }
}

// ── 보낼 대화 ──
// 끝까지 받은 답과 질문만 맥락으로 넘긴다(오류·받는 중인 답은 뺀다). 같은 쪽이 이어지면 서버가 합친다.
export function requestMessages(msgs: any[]): { role: 'user' | 'model'; text: string }[] {
  const out: { role: 'user' | 'model'; text: string }[] = [];
  for (const m of Array.isArray(msgs) ? msgs : []) {
    if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;
    if (m.role === 'user') out.push({ role: 'user', text: m.text });
    else if (m.role === 'model' && !m.pending && !m.err) out.push({ role: 'model', text: m.text });
  }
  return out;
}

// 보유 종목(이름·코드만 — 수량·금액은 보내지 않는다). 주식 행 중 수량이 있는 것, 같은 종목은 한 번.
export function searchHoldings(portfolios: any[]): { code: string; name: string }[] {
  const out: { code: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(portfolios) ? portfolios : []) {
    for (const it of Array.isArray(p?.portfolio) ? p.portfolio : []) {
      if (!it || it.type !== 'stock' || it.isManualCash) continue;
      if (!(Number(it.quantity) > 0)) continue;
      const code = String(it.code ?? '').trim().toUpperCase();
      const name = String(it.name ?? '').replace(/[\r\n\t|]+/g, ' ').trim().slice(0, 60);
      if (!code && !name) continue;
      const k = code || name;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ code: /^[0-9A-Z]{4,12}$/.test(code) ? code : '', name });
      if (out.length >= HOLD_SEND_MAX) return out;
    }
  }
  return out;
}

export const EXAMPLE_ASKS = [
  '오늘 미국 증시 마감 요약해 줘',
  '이번 주 주요 경제 일정 알려 줘',
  '미국 기준금리 전망 최신 자료 정리해 줘',
  '월배당 ETF 분배금 최근 소식 찾아 줘',
];
export const HOLD_ASK = '내 보유 종목 관련 최신 뉴스를 종목별로 정리해 줘';
export const QUICK_ASKS = [
  { label: '요약 정리', text: '위 내용을 핵심만 5줄 이내로 요약 정리해 줘' },
  { label: '표로 정리', text: '위 내용을 비교하기 쉽게 표로 정리해 줘' },
  { label: '쉽게 설명', text: '위 내용을 투자 초보도 이해하게 쉬운 말로 설명해 줘' },
  { label: '더 자세히', text: '위 내용을 근거와 숫자를 더해 더 자세히 알려 줘' },
];

// ── 답 글(마크다운) 그리기 조각 ── 화면은 이 조각을 React 요소로만 그린다(innerHTML 금지).
export type MdInline = { t: 'text'; v: string } | { t: 'b'; c: MdInline[] } | { t: 'i'; v: string } | { t: 'code'; v: string } | { t: 'a'; href: string; v: string };
export type MdBlock =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; lines: string[] }
  | { t: 'list'; items: { text: string; depth: number; n: number | null }[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'code'; text: string }
  | { t: 'quote'; lines: string[] }
  | { t: 'hr' };

const tableCells = (line: string): string[] => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
};
const isSepRow = (cells: string[]) => cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c));

export function mdBlocks(src: string): MdBlock[] {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ t: 'p', lines: para }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      out.push({ t: 'code', text: buf.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    let m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) { flush(); out.push({ t: 'h', level: m[1].length, text: m[2] }); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ t: 'hr' }); continue; }
    if (/^\s*\|/.test(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(tableCells(lines[i])); i++; }
      i--;
      let head: string[] = [];
      if (rows.length >= 2 && isSepRow(rows[1])) { head = rows[0]; rows.splice(0, 2); }
      out.push({ t: 'table', head, rows: rows.filter(r => !isSepRow(r)) });
      continue;
    }
    m = line.match(/^(\s*)(?:[-*+•]|(\d{1,3})[.)])\s+(.*)$/);
    if (m) {
      flush();
      const item = { text: m[3], depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), n: m[2] ? Number(m[2]) : null };
      const last = out[out.length - 1];
      if (last && last.t === 'list') last.items.push(item);
      else out.push({ t: 'list', items: [item] });
      continue;
    }
    m = line.match(/^\s*>\s?(.*)$/);
    if (m) {
      flush();
      const last = out[out.length - 1];
      if (last && last.t === 'quote') last.lines.push(m[1]);
      else out.push({ t: 'quote', lines: [m[1]] });
      continue;
    }
    const last = out[out.length - 1];
    if (!para.length && last && last.t === 'list' && /^\s{2,}\S/.test(line)) { last.items[last.items.length - 1].text += ' ' + line.trim(); continue; }
    para.push(line.trim());
  }
  flush();
  return out;
}

const INLINE_RE = /(`[^`\n]+`)|(\*\*[^\n]+?\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<>()"'`]+)|(\*[^*\s](?:[^*\n]*[^*\s])?\*)/g;
const URL_TAIL = /[.,!?;:'"’”)\]]+$/;

export function mdInline(src: string, depth = 0): MdInline[] {
  const s = String(src ?? '');
  const out: MdInline[] = [];
  const text = (v: string) => { if (!v) return; const last = out[out.length - 1]; if (last && last.t === 'text') last.v += v; else out.push({ t: 'text', v }); };
  let at = 0;
  const re = new RegExp(INLINE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    text(s.slice(at, m.index));
    const tok = m[0];
    if (m[1]) out.push({ t: 'code', v: tok.slice(1, -1) });
    else if (m[2]) out.push(depth < 2 ? { t: 'b', c: mdInline(tok.slice(2, -2), depth + 1) } : { t: 'text', v: tok.slice(2, -2) });
    else if (m[3]) {
      const k = tok.indexOf('](');
      out.push({ t: 'a', v: tok.slice(1, k), href: tok.slice(k + 2, -1) });
    } else if (m[4]) {
      const tail = (tok.match(URL_TAIL) || [''])[0];
      const href = tail ? tok.slice(0, -tail.length) : tok;
      out.push({ t: 'a', v: href, href });
      text(tail);
    } else if (m[5]) out.push({ t: 'i', v: tok.slice(1, -1) });
    at = m.index + tok.length;
  }
  text(s.slice(at));
  return out;
}

// ── 듣기 ── 답 글 → 읽을 글(마크다운 기호·주소·이모지 뺌) → 문장 조각(한 조각 = 말하기 한 번).
// 조각을 짧게 두는 까닭: 크롬은 긴 말하기를 15초쯤에서 끊는다.
const stripInline = (s: string) => s
  .replace(/`([^`\n]+)`/g, '$1')
  .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
  .replace(/https?:\/\/[^\s<>()"'`]+/g, '')
  .replace(/\*\*([^\n]+?)\*\*/g, '$1')
  .replace(/\*([^*\s](?:[^*\n]*[^*\s])?)\*/g, '$1')
  .replace(/\p{Extended_Pictographic}️?/gu, '')
  .replace(/(\d)\s*~\s*(\d)/g, '$1에서 $2')
  .replace(/\s*(→|⇒|->)\s*/g, ', ')
  .replace(/\s*·\s*/g, ', ')
  .replace(/[*_#>|`]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const endDot = (s: string) => (s && !/[.!?。…:]$/.test(s) ? s + '.' : s);

export function speechText(md: string): string {
  const parts: string[] = [];
  for (const b of mdBlocks(md)) {
    if (b.t === 'h') parts.push(endDot(stripInline(b.text)));
    else if (b.t === 'p') parts.push(stripInline(b.lines.join(' ')));
    else if (b.t === 'quote') parts.push(stripInline(b.lines.join(' ')));
    else if (b.t === 'list') for (const it of b.items) parts.push(endDot(stripInline(it.text)));
    else if (b.t === 'table') for (const r of (b.head.length ? [b.head, ...b.rows] : b.rows)) parts.push(endDot(r.map(stripInline).filter(Boolean).join(', ')));
  }
  return parts.filter(Boolean).join('\n');
}

export function speechChunks(md: string, max = 120): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    let t = s.trim();
    while (t.length > max) {
      let cut = Math.max(t.lastIndexOf(', ', max), t.lastIndexOf(' ', max));
      if (cut < max * 0.4) cut = max;
      out.push(t.slice(0, cut).trim());
      t = t.slice(cut).replace(/^[,\s]+/, '');
    }
    if (t) out.push(t);
  };
  for (const line of speechText(md).split('\n')) {
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      cur += ch;
      if ('.!?。…'.includes(ch) && (i + 1 >= line.length || /\s/.test(line[i + 1]))) { push(cur); cur = ''; }
    }
    push(cur);
  }
  return out.filter(s => /[0-9A-Za-z가-힣]/.test(s));
}

// ── 대화 묶음(자료) ──
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const oneLine = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const VIA_RE = /^(api|hand|pc|cloud):[a-z0-9]{1,24}$/;
const PC_JOB_RE = /^[A-Za-z0-9_-]{12,40}$/;
const AI_ID_RE = /^[a-z0-9]{1,24}$/;
const AI_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,119}$/;
// 고른 AI·모델(키는 여기 없다 — ai_settings.json). 아는 회사인지는 화면(aiProviders.aiPrefsOf)이 다시 가린다.
function normAi(raw: any): { pick: string; models: Record<string, string>; web: Record<string, boolean>; ctx: boolean } {
  const r = raw && typeof raw === 'object' ? raw : {};
  const models: Record<string, string> = {};
  const web: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(r.models && typeof r.models === 'object' ? r.models : {}).slice(0, 40)) {
    if (AI_ID_RE.test(k) && typeof v === 'string' && AI_MODEL_RE.test(v)) models[k] = v;
  }
  for (const [k, v] of Object.entries(r.web && typeof r.web === 'object' ? r.web : {}).slice(0, 40)) {
    if (AI_ID_RE.test(k) && typeof v === 'boolean') web[k] = v;
  }
  return { pick: AI_ID_RE.test(String(r.pick ?? '')) ? String(r.pick) : 'gemini', models, web, ctx: !!r.ctx };
}
export function cleanSources(a: any): { uri: string; title: string }[] {
  const out: { uri: string; title: string }[] = [];
  for (const s of Array.isArray(a) ? a : []) {
    const uri = String(s?.uri ?? '').trim();
    if (!/^https:\/\/[^\s"'<>]+$/.test(uri) || uri.length > 2000 || out.some(o => o.uri === uri)) continue;
    out.push({ uri, title: oneLine(s?.title, 120) });
    if (out.length >= 20) break;
  }
  return out;
}
export function cleanQueries(a: any): string[] {
  const out: string[] = [];
  for (const q of Array.isArray(a) ? a : []) {
    const s = oneLine(q, 200);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 10) break;
  }
  return out;
}

export function chatTitleFrom(q: string): string {
  const s = oneLine(q, 200);
  return s.length > 40 ? s.slice(0, 40) + '…' : (s || '새 대화');
}

// 저장할 모양 — 받는 중인 답은 받은 데까지 '끊김'으로, 검색 제안(html)은 저장하지 않는다(그때만 보인다).
function normMsg(m: any): any | null {
  if (!m || typeof m !== 'object') return null;
  const role = m.role === 'model' ? 'model' : m.role === 'user' ? 'user' : '';
  if (!role) return null;
  const text = String(m.text ?? '').slice(0, MSG_TEXT_MAX);
  const out: any = { id: ID_RE.test(String(m.id)) ? String(m.id) : `m${Math.random().toString(36).slice(2, 10)}`, role, text, at: ISO.test(String(m.at)) ? String(m.at) : '' };
  if (role === 'model') {
    if (m.model) out.model = oneLine(m.model, 80);
    // 어느 길로 받은 답인가 — 없음 = Gemini 검색 · api:<회사> = 내 키로 다른 AI · hand:<곳> = 내 구독 사이트에서 붙여넣음(aiProviders.ts)
    // · pc:<곳> = 내 PC가 크롬으로 그 구독 사이트에 물어 옴(src/pcAsk.ts — 기다리는 동안 err 'pc' + job = 우편함 번호)
    // · cloud:claude = 클라우드 Claude(관리자 Claude 예약 작업 — PC 없이 · 기다리는 동안도 err 'pc' + job, 2026-11-26)
    if (VIA_RE.test(String(m.via ?? ''))) out.via = String(m.via);
    const src = cleanSources(m.sources);
    if (src.length) out.sources = src;
    const qs = cleanQueries(m.queries);
    if (qs.length) out.queries = qs;
    const err = /^[a-z]{1,12}$/.test(String(m.err ?? '')) ? String(m.err) : '';
    if (m.pending) { if (!text) return null; out.err = 'cut'; }
    else if (err) out.err = err;
    if (out.err === 'pc') {
      if (PC_JOB_RE.test(String(m.job ?? ''))) out.job = String(m.job);
      else { out.err = 'pcfail'; out.msg = 'PC에 맡기지 못했습니다'; }
    }
    if (out.err && m.msg && !out.msg) out.msg = oneLine(m.msg, 300);
    if (!text && !out.err) return null;
  } else if (!text.trim()) return null;
  return out;
}
function normChat(c: any): any | null {
  if (!c || typeof c !== 'object' || !ID_RE.test(String(c.id))) return null;
  const msgs = (Array.isArray(c.msgs) ? c.msgs : []).map(normMsg).filter(Boolean).slice(-MSGS_MAX);
  if (msgs.length === 0) return null;
  const first = msgs.find((m: any) => m.role === 'user');
  const createdAt = ISO.test(String(c.createdAt)) ? String(c.createdAt) : (msgs[0].at || '');
  return {
    id: String(c.id),
    title: oneLine(c.title, 60) || chatTitleFrom(first ? first.text : ''),
    createdAt,
    updatedAt: ISO.test(String(c.updatedAt)) ? String(c.updatedAt) : (msgs[msgs.length - 1].at || createdAt),
    pinned: !!c.pinned,
    msgs,
  };
}

export function normalizeSearchStore(raw: any): { v: 1; chats: any[]; voice: { rate: number; voiceURI: string }; holdOn: boolean; pcOn: boolean; ai: { pick: string; models: Record<string, string>; web: Record<string, boolean>; ctx: boolean } } {
  const r = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set<string>();
  const chats: any[] = [];
  for (const c of (Array.isArray(r.chats) ? r.chats : []).map(normChat)) {
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    chats.push(c);
  }
  const rate = Number(r.voice?.rate);
  return trimSearchStore({
    v: 1,
    chats,
    voice: { rate: SPEECH_RATES.includes(rate) ? rate : 1, voiceURI: oneLine(r.voice?.voiceURI, 200) },
    holdOn: !!r.holdOn,
    pcOn: !!r.pcOn,
    ai: normAi(r.ai),
  });
}

// 한도 — 최근 순으로 두고, 넘치면 오래된 것부터(고정한 자료는 맨 나중에) 뺀다. 가장 최근 하나는 늘 남긴다.
export function trimSearchStore<T extends { chats: any[] }>(store: T): T {
  const chats = [...store.chats].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const size = () => JSON.stringify(chats).length;
  const dropOne = () => {
    for (let i = chats.length - 1; i >= 1; i--) if (!chats[i].pinned) { chats.splice(i, 1); return true; }
    if (chats.length > 1) { chats.pop(); return true; }
    return false;
  };
  while (chats.length > CHATS_MAX && dropOne()) { /* 개수 */ }
  while (chats.length > 1 && size() > STORE_CHARS_MAX && dropOne()) { /* 크기 */ }
  return { ...store, chats };
}

export function chatMatches(chat: any, filter: string): boolean {
  const f = oneLine(filter, 100).toLowerCase();
  if (!f) return true;
  if (String(chat?.title ?? '').toLowerCase().includes(f)) return true;
  return (chat?.msgs || []).some((m: any) => String(m.text ?? '').toLowerCase().includes(f));
}

const dateLabel = (iso: string) => (ISO.test(String(iso)) ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '');

// 내보내기(복사·내려받기) 글 — 질문·답·출처.
export function chatToMarkdown(chat: any): string {
  const out: string[] = [`# ${oneLine(chat?.title, 60) || 'AI 검색'}`, ''];
  for (const m of chat?.msgs || []) {
    if (m.role === 'user') out.push(`## 질문${m.at ? ` (${dateLabel(m.at)})` : ''}`, '', m.text, '');
    else {
      if (!m.text) continue;
      out.push(`## 답${m.at ? ` (${dateLabel(m.at)})` : ''}`, '', m.text, '');
      if (m.sources && m.sources.length) {
        out.push('출처:');
        for (const s of m.sources) out.push(`- [${s.title || '출처'}](${s.uri})`);
        out.push('');
      }
    }
  }
  return out.join('\n').trim() + '\n';
}

export function chatFileName(chat: any): string {
  const base = oneLine(chat?.title, 40).replace(/[\\/:*?"<>|]+/g, ' ').trim().replace(/\s+/g, '_') || 'AI검색';
  const d = ISO.test(String(chat?.updatedAt)) ? new Date(new Date(chat.updatedAt).getTime() + 9 * 3600_000).toISOString().slice(0, 10) : '';
  return `${base}${d ? '_' + d : ''}.md`;
}
