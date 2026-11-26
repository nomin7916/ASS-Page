// 펀드 기준가 우편함(2026-11-26) — 서버 공용 도구. CLAUDE.md '펀드 기준가 우편함' 절.
// 발단: 미래에셋·funetf가 서버(해외·데이터센터) 요청을 막아 퇴직연금 펀드 기준가가 10/27에서 멈췄다.
//   서울(icn1) 중계(api/fund-proxy.ts)로도 막히면 — 사용자의 맥미니 크롬(Claude 예약 작업 "[ASS-PAGE-펀드 기준가 · 맥미니 크롬]")이
//   미래에셋 화면에서 기준가를 읽어 이 우편함에 넣고(api/fund-job.ts), 앱은 직접 조회가 실패하면 여기서 가져간다(api/fund-feed.ts).
// 흐름: 앱(직접 조회 실패) → op=want(코드·필요한 시작일) → 예약 작업이 op=want(job)로 목록을 받아 크롬에서 읽고 → op=put(job)
//   → 앱이 GET ?codes= 로 받아 stockHistoryMap에 stage(replace) — 다른 출처와 같은 길.
// ⚠️ 열쇠: 관리자 앱이 op=key로 받아 관리자 Drive Index_Data 폴더의 fund_nav_job.json에만 둔다(Redis에는 해시만).
//    예약 작업은 Drive 커넥터로 그 파일을 읽는다. 새 열쇠를 받으면 앞 열쇠는 3일만 더 통한다(돌던 실행이 끊기지 않게).
//    이 열쇠로 할 수 있는 일은 '목록 읽기 · 기준가 넣기'뿐이다(사용자 데이터·Drive·다른 키에 닿지 않는다).
// ⚠️ 기준가는 공개 자료라 코드별로 모든 사용자가 같이 쓴다(사용자별로 나누지 않는다). 넣을 수 있는 코드는 목록(want)에 있는 것만.
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-fund-feed.mjs가 Node 타입 스트리핑으로 직접 import한다.

export const JOB_HEADER = 'x-job-key';
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
// MA:<미래에셋 펀드코드> · K…(funetf 표준코드). 앱 src/fundFeed.ts의 FUND_FEED_CODE_RE와 같아야 한다(verify:fund-feed가 대조).
export const CODE_RE = /^(MA:[0-9A-Z]{4,8}|K[0-9A-Z]{8,13})$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const JOB_SITE = 'https://14ass-page-eea5.vercel.app';
// 예약 작업이 크롬 화면에서 바로 넣을 수 있게 이 두 사이트의 요청만 CORS를 연다(열쇠는 그대로 필요하다).
export const CORS_ORIGINS = ['https://investments.miraeasset.com', 'https://www.funetf.co.kr', 'https://funetf.co.kr'];

export const KEY_TTL = 60 * 86_400_000;   // 열쇠 수명 60일 — 관리자 앱이 20일마다 새로 받는다
export const KEY_RENEW = 20 * 86_400_000;
export const PREV_GRACE = 3 * 86_400_000; // 새 열쇠를 받은 뒤 앞 열쇠가 통하는 기간
export const WANT_MAX = 40;               // 목록에 둘 코드 수
export const WANT_STALE = 30 * 86_400_000;// 30일 동안 아무도 찾지 않은 코드는 목록에서 뺀다
export const ROWS_KEEP = 4000;            // 코드마다 보관할 날 수(약 15년치 영업일)
export const ROWS_MAX_PUT = 5000;
export const BODY_MAX = 600_000;
export const CODES_MAX = 20;
export const FROM_MIN = '2008-01-01';

const K_NAV = (code: string) => `ffd:nav:${code}`;
const K_WANT = 'ffd:want';
const K_KEY = 'ffd:key';

export interface NavRec { v: 1; rows: Record<string, number>; at: number; src: string; }
export interface WantItem { from: string; at: number; n: number; }
export interface WantRec { v: 1; items: Record<string, WantItem>; }
export interface KeyRec { v: 1; h: string; at: number; ph: string; pat: number; }

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
export const newKey = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

export const kstToday = (now = Date.now()) => new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
export const shiftDays = (iso: string, d: number) => {
  const t = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(t) ? new Date(t + d * 86_400_000).toISOString().slice(0, 10) : iso;
};
export const validDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};
export const normCode = (c: unknown): string => {
  const s = String(c ?? '').trim().toUpperCase();
  return CODE_RE.test(s) ? s : '';
};

// {date: nav} 또는 [{date, nav|price}] → 검증한 {date: nav}. 미래(내일 넘음)·2000년 이전·이상한 값은 버린다.
export function cleanRows(input: unknown, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  const max = shiftDays(kstToday(now), 1);
  const add = (d: unknown, v: unknown) => {
    if (!validDate(d) || d < '2000-01-01' || d > max) return;
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000) return;
    out[d] = Math.round(n * 10000) / 10000;
  };
  if (Array.isArray(input)) {
    for (const r of input.slice(0, ROWS_MAX_PUT)) if (r && typeof r === 'object') add((r as any).date, (r as any).nav ?? (r as any).price);
  } else if (input && typeof input === 'object') {
    for (const [d, v] of Object.entries(input as Record<string, unknown>).slice(0, ROWS_MAX_PUT)) add(d, v);
  }
  return out;
}

export function rowsSummary(rows: Record<string, number> | undefined) {
  const ds = Object.keys(rows || {}).sort();
  return { n: ds.length, first: ds[0] || '', last: ds[ds.length - 1] || '' };
}

const parse = (s: unknown) => { try { return typeof s === 'string' ? JSON.parse(s) : null; } catch { return null; } };

export async function getNav(code: string): Promise<NavRec | null> {
  const j = parse(await redis(['GET', K_NAV(code)]));
  return j && j.v === 1 && j.rows && typeof j.rows === 'object' ? j as NavRec : null;
}
export async function getNavMany(codes: string[]): Promise<Record<string, NavRec>> {
  if (!codes.length) return {};
  const vals = await redis(['MGET', ...codes.map(K_NAV)]);
  const out: Record<string, NavRec> = {};
  if (!Array.isArray(vals)) return out;
  codes.forEach((c, i) => {
    const j = parse(vals[i]);
    if (j && j.v === 1 && j.rows && typeof j.rows === 'object') out[c] = j as NavRec;
  });
  return out;
}

// 기존 날짜는 새 값으로 덮고(정정 흡수) 없는 날짜는 남긴다 — 오래된 날부터 ROWS_KEEP을 넘는 만큼 버린다.
export function mergeRows(old: Record<string, number>, add: Record<string, number>): Record<string, number> {
  const all = { ...(old || {}), ...(add || {}) };
  const ds = Object.keys(all).sort();
  const keep = ds.slice(Math.max(0, ds.length - ROWS_KEEP));
  const out: Record<string, number> = {};
  for (const d of keep) out[d] = all[d];
  return out;
}

export async function putNav(code: string, add: Record<string, number>, src: string, now = Date.now()) {
  const old = await getNav(code);
  const before = rowsSummary(old?.rows);
  const rows = mergeRows(old?.rows || {}, add);
  const rec: NavRec = { v: 1, rows, at: now, src: String(src || '').slice(0, 40) };
  const ok = (await redis(['SET', K_NAV(code), JSON.stringify(rec)])) === 'OK';
  const after = rowsSummary(rows);
  return { ok, added: after.n - before.n, total: after.n, last: after.last };
}

export async function getWant(): Promise<WantRec> {
  const j = parse(await redis(['GET', K_WANT]));
  return j && j.v === 1 && j.items && typeof j.items === 'object' ? j as WantRec : { v: 1, items: {} };
}

// 목록 고치기(순수) — 이른 시작일을 남기고, 30일 지난 것은 빼고, 최근 것 WANT_MAX개만.
export function mergeWant(rec: WantRec, list: unknown, now = Date.now()): WantRec {
  const items: Record<string, WantItem> = {};
  for (const [c, it] of Object.entries(rec.items || {})) {
    if (normCode(c) && it && now - (it.at || 0) < WANT_STALE && validDate(it.from)) items[c] = { from: it.from, at: it.at, n: it.n || 1 };
  }
  const floor = FROM_MIN;
  for (const x of Array.isArray(list) ? list.slice(0, CODES_MAX) : []) {
    const c = normCode((x as any)?.code);
    if (!c) continue;
    let from = validDate((x as any)?.from) ? (x as any).from as string : shiftDays(kstToday(now), -30);
    if (from < floor) from = floor;
    if (from > kstToday(now)) from = kstToday(now);
    const p = items[c];
    items[c] = { from: p && p.from < from ? p.from : from, at: now, n: (p?.n || 0) + 1 };
  }
  const keep = Object.entries(items).sort((a, b) => b[1].at - a[1].at).slice(0, WANT_MAX);
  return { v: 1, items: Object.fromEntries(keep) };
}

export async function addWant(list: unknown, now = Date.now()): Promise<boolean> {
  const next = mergeWant(await getWant(), list, now);
  return (await redis(['SET', K_WANT, JSON.stringify(next)])) === 'OK';
}

// 예약 작업에 줄 목록 — 이미 받아 둔 기준가가 시작일을 덮으면 마지막 날 14일 전부터만(겹치게 — 정정 흡수).
export function jobItems(want: WantRec, have: Record<string, NavRec>, now = Date.now()) {
  const end = kstToday(now);
  return Object.entries(want.items).sort((a, b) => a[0].localeCompare(b[0])).map(([code, it]) => {
    const s = rowsSummary(have[code]?.rows);
    const covered = s.n > 0 && s.first <= it.from;
    let start = covered ? shiftDays(s.last, -14) : it.from;
    if (start < it.from) start = it.from;
    return { code, from: it.from, start, end, have: s };
  });
}

export async function getKeyRec(): Promise<KeyRec | null> {
  const j = parse(await redis(['GET', K_KEY]));
  return j && j.v === 1 && typeof j.h === 'string' ? j as KeyRec : null;
}

export async function mintKey(now = Date.now()): Promise<string | null> {
  const old = await getKeyRec();
  const key = newKey();
  const rec: KeyRec = { v: 1, h: await sha256Hex(key), at: now, ph: old?.h || '', pat: old?.at || 0 };
  return (await redis(['SET', K_KEY, JSON.stringify(rec)])) === 'OK' ? key : null;
}

// 열쇠 판정(순수) — 지금 열쇠(60일) 또는 앞 열쇠(새 열쇠를 받은 뒤 3일, 앞 열쇠 자체도 60일 안).
export function keyOk(rec: KeyRec | null, hash: string, now = Date.now()): boolean {
  if (!rec || !hash) return false;
  if (rec.h && safeEqual(hash, rec.h) && now - rec.at < KEY_TTL) return true;
  if (rec.ph && safeEqual(hash, rec.ph) && now - rec.at < PREV_GRACE && now - (rec.pat || 0) < KEY_TTL) return true;
  return false;
}

export function corsHeaders(req: Request): Record<string, string> {
  const o = req.headers.get('origin') || '';
  if (!CORS_ORIGINS.includes(o)) return {};
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': `${JOB_HEADER}, content-type`,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});

// 예약 작업 쪽 경로(/api/fund-job)의 문 — 처리부 첫 줄에서 부른다:
//   const denied = await requireFundJobKey(request); if (denied) return denied;
// CORS 사전 요청(OPTIONS)은 허용한 두 사이트에만 204로 답한다(본 요청은 여기서 다시 열쇠를 본다).
export async function requireFundJobKey(req: Request, now = Date.now()): Promise<Response | null> {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
  const key = (req.headers.get(JOB_HEADER) || '').trim();
  if (!KEY_RE.test(key)) return json(401, { error: 'job key required' }, cors);
  if (!storeOn()) return json(503, { error: 'store' }, cors);
  if (!keyOk(await getKeyRec(), await sha256Hex(key), now)) return json(401, { error: 'job key required' }, cors);
  return null;
}
