// 「내 PC가 구독 AI에 묻기」(사용자 요청 2026-11-26: "PC 직접 조작해서 … 자신의 구독 AI를 사용 · 모든 사용자 각자") — 서버 공용 도구.
// 흐름: AI 검색 창(로그인 토큰) → /api/pc-ask op=ask → Redis 우편함(사용자마다 따로) → 그 사용자의 PC에서 도는 Claude(PC 열쇠)가
//   /api/pc-job op=take 로 가져가 크롬에서 그 사람 계정으로 구독 AI 사이트(ChatGPT·Gemini…)에 묻고 → op=done 으로 답을 넣는다
//   → 창이 op=get 으로 받아 대화에 넣는다. 'claude'는 PC의 Claude가 직접 답한다(그 사람의 Claude 구독).
// PC 열쇠 = '<사용자 표시 24자>.<무작위 43자>' — Redis에는 무작위 부분의 해시만. 새로 만들면 앞 열쇠는 바로 끝난다(이 인스턴스 기억은 1분).
//   이 열쇠로 할 수 있는 일 = 그 사용자의 질문 받기·답 넣기·실패 알리기뿐(Drive·자산 자료·다른 사용자에 닿지 않는다).
// ⚠️ 서버는 구독 로그인(비밀번호·쿠키)을 받지도 쓰지도 않는다 — 로그인은 그 사람 PC 크롬에만 있다.
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-pc-ask.mjs가 Node 타입 스트리핑으로 직접 import한다.

export const PC_HEADER = 'x-pc-key';
export const PC_KEY_RE = /^([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$/;
export const JOB_ID_RE = /^[A-Za-z0-9_-]{12,40}$/;
export const PROMPT_MAX = 8000;
export const ANSWER_MAX = 30_000;
export const FAIL_MAX = 300;
export const WAIT_MAX = 5;            // 한 사람이 동시에 맡겨 둘 수 있는 질문
export const DAY_MAX = 60;            // 한 사람이 하루(한국 날짜)에 맡길 수 있는 질문
export const JOB_TTL_S = 2 * 86_400;  // 질문·답 보관(초)
export const SEEN_TTL_S = 7 * 86_400;
export const SEEN_EVERY = 60_000;     // PC 확인 시각은 1분에 한 번만 적는다(Redis 사용량)
export const KEY_CACHE_MS = 60_000;
export const IDS_MAX = 10;

// 구독 AI 사이트 — 화면 src/aiProviders.ts AI_HANDS 와 id·주소가 같아야 한다(verify:pc-ask가 대조). claude = PC의 Claude가 직접.
export const PC_TARGETS: { id: string; label: string; url: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', label: 'Claude', url: '' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'grok', label: 'Grok', url: 'https://grok.com/' },
  { id: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai/search' },
  { id: 'genspark', label: 'Genspark', url: 'https://www.genspark.ai/search' },
  { id: 'copilot', label: 'Copilot', url: 'https://copilot.microsoft.com/' },
  { id: 'googleai', label: '구글 AI 모드', url: 'https://www.google.com/search?udm=50' },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'lechat', label: 'Le Chat', url: 'https://chat.mistral.ai/chat' },
  { id: 'wrtn', label: '뤼튼', url: 'https://wrtn.ai/' },
];
export const pcTarget = (id: unknown) => PC_TARGETS.find(t => t.id === id) || null;

const K_KEY = (u: string) => `pca:key:${u}`;
const K_SEEN = (u: string) => `pca:seen:${u}`;
const K_Q = (u: string) => `pca:q:${u}`;
const K_JOB = (u: string, id: string) => `pca:job:${u}:${id}`;
const K_N = (u: string, day: string) => `pca:n:${u}:${day}`;

export interface PcKeyRec { v: 1; h: string; at: number }
export interface PcJob { v: 1; id: string; t: string; p: string; st: 'wait' | 'take' | 'done' | 'fail' | 'cancel'; at: number; ta?: number; da?: number; a?: string; m?: string; e?: string }

function env(name: string): string {
  return (typeof process !== 'undefined' && process.env && process.env[name]) || '';
}
const redisUrl = () => env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL');
const redisTok = () => env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN');
export const storeOn = () => !!(redisUrl() && redisTok());

// 실패는 undefined(값 없음 null과 구별)
export async function redis(cmd: (string | number)[]): Promise<any> {
  if (!storeOn()) return undefined;
  try {
    const res = await fetch(redisUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisTok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return undefined;
    const j = await res.json();
    return j && 'result' in j ? j.result : undefined;
  } catch {
    return undefined;
  }
}
const parse = (v: unknown): any => { if (typeof v !== 'string') return null; try { return JSON.parse(v); } catch { return null; } };

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const b64u = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const randomToken = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
export const newJobId = () => b64u(crypto.getRandomValues(new Uint8Array(12)));
export const kstDay = (now = Date.now()) => new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);

// 사용자 표시 — 이메일 해시 앞 24자(이메일 자체는 Redis에 두지 않는다).
export async function userTag(email: string): Promise<string> {
  return (await sha256Hex(`pca|${String(email || '').trim().toLowerCase()}`)).slice(0, 24);
}
export function parsePcKey(raw: unknown): { u: string; r: string } | null {
  const m = String(raw ?? '').trim().match(PC_KEY_RE);
  return m ? { u: m[1], r: m[2] } : null;
}

export async function getKeyRec(u: string): Promise<PcKeyRec | null | undefined> {
  const v = await redis(['GET', K_KEY(u)]);
  if (v === undefined) return undefined;
  const j = parse(v);
  return j && j.v === 1 && typeof j.h === 'string' ? j as PcKeyRec : null;
}
export async function mintPcKey(u: string, now = Date.now()): Promise<string | null> {
  const r = randomToken();
  const rec: PcKeyRec = { v: 1, h: await sha256Hex(r), at: now };
  keyCache.delete(u);
  return (await redis(['SET', K_KEY(u), JSON.stringify(rec)])) === 'OK' ? `${u}.${r}` : null;
}
export async function unlinkPc(u: string): Promise<boolean> {
  keyCache.delete(u);
  return (await redis(['DEL', K_KEY(u)])) !== undefined;
}

// 이 인스턴스 기억(1분) — PC가 30초마다 묻는 동안 열쇠 확인을 Redis에 매번 하지 않게.
const keyCache = new Map<string, { h: string; t: number }>();
const seenWrote = new Map<string, number>();
export function forgetCaches() { keyCache.clear(); seenWrote.clear(); }

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

// PC 쪽 경로(/api/pc-job)의 문 — 처리부 첫 줄에서 부른다:
//   const denied = await requirePcKey(request); if (denied) return denied;
export async function requirePcKey(req: Request, now = Date.now()): Promise<Response | null> {
  const k = parsePcKey(req.headers.get(PC_HEADER));
  if (!k) return json(401, { error: 'pc key required' });
  if (!storeOn()) return json(503, { error: 'store' });
  const hash = await sha256Hex(k.r);
  const c = keyCache.get(k.u);
  if (c && now - c.t < KEY_CACHE_MS) return safeEqual(hash, c.h) ? null : json(401, { error: 'pc key required' });
  const rec = await getKeyRec(k.u);
  if (rec === undefined) return json(503, { error: 'store' });
  if (!rec) { keyCache.delete(k.u); return json(401, { error: 'pc key required' }); }
  keyCache.set(k.u, { h: rec.h, t: now });
  return safeEqual(hash, rec.h) ? null : json(401, { error: 'pc key required' });
}
export const pcUserOf = (req: Request) => parsePcKey(req.headers.get(PC_HEADER))?.u || '';

export async function touchSeen(u: string, now = Date.now()): Promise<void> {
  if (now - (seenWrote.get(u) || 0) < SEEN_EVERY) return;
  seenWrote.set(u, now);
  await redis(['SET', K_SEEN(u), String(now), 'EX', SEEN_TTL_S]);
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const oneLine = (s: unknown, max: number) => clean(s, 2000).replace(/\s+/g, ' ').slice(0, max);
export function checkAsk(body: any): { t: string; p: string } | { error: string } {
  const t = pcTarget(body?.target);
  if (!t) return { error: '물을 AI가 틀렸습니다' };
  const p = clean(body?.prompt, PROMPT_MAX + 1);
  if (!p) return { error: '질문이 없습니다' };
  if (p.length > PROMPT_MAX) return { error: `질문이 너무 깁니다(${PROMPT_MAX.toLocaleString()}자까지)` };
  return { t: t.id, p };
}
export const cleanAnswer = (s: unknown) => clean(s, ANSWER_MAX);
export const cleanModel = (s: unknown) => oneLine(s, 60).replace(/[<>"'`]/g, '');
export const cleanFail = (s: unknown) => oneLine(s, FAIL_MAX);

async function getJob(u: string, id: string): Promise<PcJob | null> {
  const j = parse(await redis(['GET', K_JOB(u, id)]));
  return j && j.v === 1 && j.id === id ? j as PcJob : null;
}
const putJob = async (u: string, job: PcJob) => (await redis(['SET', K_JOB(u, job.id), JSON.stringify(job), 'EX', JOB_TTL_S])) === 'OK';

// 창 쪽 — 맡기기. 까닭이 있으면 { error, code }.
export async function askJob(u: string, t: string, p: string, now = Date.now()): Promise<{ id: string } | { error: string; code: string }> {
  const rec = await getKeyRec(u);
  if (rec === undefined) return { error: '우편함에 닿지 못했습니다', code: 'store' };
  if (!rec) return { error: 'PC가 아직 연결되지 않았습니다', code: 'nopc' };
  const waiting = Number(await redis(['LLEN', K_Q(u)])) || 0;
  if (waiting >= WAIT_MAX) return { error: `PC에 맡겨 둔 질문이 ${WAIT_MAX}개라 더 받지 않습니다 — 답이 온 뒤 다시`, code: 'busy' };
  const nk = K_N(u, kstDay(now));
  const n = Number(await redis(['INCR', nk])) || 0;
  if (n === 1) await redis(['EXPIRE', nk, 2 * 86_400]);
  if (n > DAY_MAX) return { error: `오늘은 PC에 ${DAY_MAX}번까지 맡길 수 있습니다`, code: 'day' };
  const job: PcJob = { v: 1, id: newJobId(), t, p, st: 'wait', at: now };
  if (!(await putJob(u, job))) return { error: '우편함에 넣지 못했습니다', code: 'store' };
  if ((await redis(['LPUSH', K_Q(u), job.id])) === undefined) return { error: '우편함에 넣지 못했습니다', code: 'store' };
  await redis(['EXPIRE', K_Q(u), JOB_TTL_S]);
  return { id: job.id };
}

// 창 쪽 — 여러 질문의 상태(답은 끝난 것만).
export async function jobsView(u: string, ids: string[]) {
  const ok = ids.filter(id => JOB_ID_RE.test(id)).slice(0, IDS_MAX);
  const vals = ok.length ? await redis(['MGET', ...ok.map(id => K_JOB(u, id))]) : [];
  const seen = await redis(['GET', K_SEEN(u)]);
  const jobs = ok.map((id, i) => {
    const j = parse(Array.isArray(vals) ? vals[i] : null);
    if (!j || j.v !== 1 || j.id !== id) return { id, st: 'gone' };
    const o: any = { id, st: j.st, at: j.at };
    if (j.ta) o.ta = j.ta;
    if (j.st === 'done') { o.a = j.a || ''; o.m = j.m || ''; o.da = j.da; }
    if (j.st === 'fail') { o.e = j.e || ''; o.da = j.da; }
    return o;
  });
  return { jobs, seen: Number(seen) || 0, store: vals !== undefined };
}

export async function cancelJob(u: string, id: string): Promise<boolean> {
  if (!JOB_ID_RE.test(id)) return false;
  const j = await getJob(u, id);
  if (!j || (j.st !== 'wait' && j.st !== 'take')) return false;
  return putJob(u, { ...j, st: 'cancel', da: Date.now() });
}

// PC 쪽 — 가장 오래 기다린 질문 하나(취소된 것은 건너뛴다).
export async function takeJob(u: string, now = Date.now()): Promise<PcJob | null | undefined> {
  for (let i = 0; i < 6; i++) {
    const id = await redis(['RPOP', K_Q(u)]);
    if (id === undefined) return undefined;
    if (!id || !JOB_ID_RE.test(String(id))) return null;
    const j = await getJob(u, String(id));
    if (!j || j.st !== 'wait') continue;
    const next: PcJob = { ...j, st: 'take', ta: now };
    if (!(await putJob(u, next))) return undefined;
    return next;
  }
  return null;
}

// PC 쪽 — 답·실패 넣기. 가져간(take) 질문에만(창에서 취소했으면 cancel).
export async function finishJob(u: string, id: string, patch: { a?: string; m?: string; e?: string }, now = Date.now()): Promise<'ok' | 'gone' | 'cancel' | 'state' | 'store'> {
  if (!JOB_ID_RE.test(id)) return 'gone';
  const j = await getJob(u, id);
  if (!j) return 'gone';
  if (j.st === 'cancel') return 'cancel';
  if (j.st !== 'take' && j.st !== 'wait') return 'state';
  const next: PcJob = patch.e !== undefined
    ? { ...j, st: 'fail', e: patch.e || '까닭 없음', da: now }
    : { ...j, st: 'done', a: patch.a || '', m: patch.m || '', da: now };
  return (await putJob(u, next)) ? 'ok' : 'store';
}

export async function pcStatus(u: string) {
  const v = await redis(['MGET', K_KEY(u), K_SEEN(u)]);
  if (!Array.isArray(v)) return { store: false, linked: false, keyAt: 0, seen: 0 };
  const rec = parse(v[0]);
  return { store: true, linked: !!(rec && rec.v === 1), keyAt: rec && rec.at ? Number(rec.at) : 0, seen: Number(v[1]) || 0 };
}
