#!/usr/bin/env node
// verify:fund-feed — 펀드 기준가 우편함(2026-11-26, docs/fund-nav-task/TASK.md · api/_fundFeed.ts 머리 주석)
//
// 막는 것: 미래에셋·funetf가 서버 요청을 막는 동안 기준가가 다시 멈추는 것(퇴직연금 차트 한 달 평평 → 절벽).
//   파트① 실제 처리부(api/fund-feed.ts · api/fund-job.ts)를 직접 import해 가짜 구글·승인 스크립트·Redis로 끝까지 —
//          목록 올리기 → 관리자 열쇠 → 예약 작업 목록 → 넣기(검증) → 앱이 받기 · 열쇠 교체·만료 · CORS(두 사이트만) · 크기 제한.
//   파트② src/fundFeed.ts(앱 쪽) — 코드 모양 · 구간 자르기 · 열쇠 파일 판정 · ensureFundJobKeyFile · 메모·목록 올리기 간격.
//   파트③ src/api.ts 실제 함수 — 미래에셋·funetf·중계가 모두 막혔을 때 우편함 기준가로 이력·현재가가 나오는가.
//   파트④ 소스 가드 — 대체 길·관리자 열쇠 효과·현재가 보정·예약 작업 지시가 빠지지 않았는가.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}\n      got:  ${g}\n      want: ${w}`); }
};

const SITE = 'https://14ass-page-eea5.vercel.app';
const MIRAE = 'https://investments.miraeasset.com';
const ADMIN_TOK = 'ya29.admin-token-0123456789abcdef';
const USER_TOK = 'ya29.user-token-0123456789abcdefgh';
const authSrc = read('api/_auth.ts');
const CID = (authSrc.match(/export const CLIENT_ID = '([^']+)'/) || [])[1];

// ── 가짜 바깥 세계 ─────────────────────────────────────────
const store = new Map();
let appTok = USER_TOK;      // 앱 쪽 fetch(/api/…)가 실을 토큰
let H = null;               // 처리부
let blocked = true;         // 미래에셋·funetf·중계가 막혔나
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push(u);
  if (u.startsWith('https://oauth2.googleapis.com/tokeninfo?access_token=')) {
    const tok = decodeURIComponent(u.split('access_token=')[1]);
    const email = tok === ADMIN_TOK ? 'arui114501@gmail.com' : tok === USER_TOK ? 'user@example.com' : '';
    if (!email) return new Response('{"error":"invalid_token"}', { status: 400 });
    return Response.json({ aud: CID, email, email_verified: 'true', expires_in: '3599' });
  }
  if (u.startsWith('https://script.google.com/')) return Response.json({ status: 'approved' });
  if (u === 'https://redis.example') {
    const [c, ...a] = JSON.parse(init.body);
    const r = (result) => Response.json({ result });
    if (c === 'GET') return r(store.has(a[0]) ? store.get(a[0]) : null);
    if (c === 'SET') { store.set(a[0], String(a[1])); return r('OK'); }
    if (c === 'DEL') { let n = 0; for (const k of a) if (store.delete(k)) n++; return r(n); }
    if (c === 'MGET') return r(a.map(k => (store.has(k) ? store.get(k) : null)));
    if (c === 'INCR') { const n = (Number(store.get(a[0])) || 0) + 1; store.set(a[0], String(n)); return r(n); }
    if (c === 'EXPIRE' || c === 'PEXPIRE') return r(1);
    throw new Error(`가짜 Redis가 모르는 명령 ${c}`);
  }
  // 앱(브라우저)이 부르는 같은 출처 /api/… — 처리부로 보낸다(토큰은 installApiAuth가 싣는 것처럼)
  if (u.startsWith('/api/fund-feed')) {
    const req = new Request('https://nominfi1.vercel.app' + u, {
      method: init.method || 'GET', body: init.body,
      headers: { 'x-app-token': appTok, 'Content-Type': 'application/json' },
    });
    return H.F.default(req);
  }
  // 미래에셋·funetf 직접 · 서울 중계 · /api/proxy · 바깥 중계 — 막힘
  if (/miraeasset|funetf|\/api\/fund-proxy|\/api\/proxy|allorigins|corsproxy|codetabs/.test(u)) {
    if (blocked) return new Response('<html>안내</html>', { status: 403 });
  }
  throw new Error(`예상 밖 fetch ${u}`);
};

try {
  register('data:text/javascript,' + encodeURIComponent(
    'export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {' +
    ' if (s.startsWith(".") && s.endsWith(".js")) return n(s.slice(0, -3) + ".ts", c);' +
    ' if (s.startsWith(".") && !/\\.[a-z]+$/.test(s)) return n(s + ".ts", c); throw e; } }'));
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token-for-test';
  process.env.KIS_APP_SECRET = 'kis-secret-for-test';
  H = {
    F: await import(pathToFileURL(join(ROOT, 'api/fund-feed.ts')).href),
    J: await import(pathToFileURL(join(ROOT, 'api/fund-job.ts')).href),
    L: await import(pathToFileURL(join(ROOT, 'api/_fundFeed.ts')).href),
    C: await import(pathToFileURL(join(ROOT, 'src/fundFeed.ts')).href),
  };
  try { H.API = await import(pathToFileURL(join(ROOT, 'src/api.ts')).href); }
  catch (e) { console.log(`  ⓘ src/api.ts 직접 import 실패 — 파트③ 건너뜀 (${e && (e.code || e.message)})`); }
} catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension|register/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①~③을 건너뜁니다.');
  else { fail++; console.log(`  ✗ 처리부를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
  H = null;
}

const feed = (method, { tok = USER_TOK, body, q = '' } = {}) => H.F.default(new Request(
  `https://nominfi1.vercel.app/api/fund-feed${q}`,
  { method, headers: { 'x-app-token': tok, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
const job = (method, op, { key, body, origin, raw } = {}) => {
  const h = {};
  if (key) h['x-job-key'] = key;
  if (origin) h.origin = origin;
  if (body !== undefined || raw !== undefined) h['content-type'] = 'application/json';
  return H.J.default(new Request(`${SITE}/api/fund-job${op ? `?op=${op}` : ''}`,
    { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) }));
};
const J = async (res) => ({ s: res.status, j: await res.json().catch(() => ({})) });

const DAY = 86_400_000;
if (H) {
  const { L, C } = H;
  console.log('\n[파트①] 처리부 끝까지 (가짜 구글·Redis)');

  eq('토큰 없음 → 401', (await J(await feed('GET', { tok: '', q: '?codes=MA:53663O' }))).s, 401);
  eq('코드 없음 → 400', (await J(await feed('GET', { q: '?codes=' }))).s, 400);
  eq('받아 둔 것 없음 → 빈 feed', (await J(await feed('GET', { q: '?codes=MA:53663O' }))).j, { feed: {} });

  // 목록 올리기 — 승인 사용자 누구나
  eq('목록 올리기(사용자) → ok', (await J(await feed('POST', { body: { op: 'want', items: [{ code: 'ma:53663o', from: '2026-10-13' }, { code: 'bad code', from: '2026-10-01' }, { code: 'MA:1', from: 'x' }] } }))).j, { ok: true });
  const want1 = JSON.parse(store.get('ffd:want'));
  eq('목록에는 맞는 코드만 · 대문자 · 시작일', Object.entries(want1.items).map(([c, it]) => [c, it.from, it.n]), [['MA:53663O', '2026-10-13', 1]]);
  await feed('POST', { body: { op: 'want', items: [{ code: 'MA:53663O', from: '2026-11-01' }] } });
  eq('더 늦은 시작일은 이른 것을 지킨다 · 횟수', [JSON.parse(store.get('ffd:want')).items['MA:53663O'].from, JSON.parse(store.get('ffd:want')).items['MA:53663O'].n], ['2026-10-13', 2]);
  await feed('POST', { body: { op: 'want', items: [{ code: 'MA:53663O', from: '1999-01-01' }] } });
  eq('너무 이른 시작일은 FROM_MIN에서 자른다', JSON.parse(store.get('ffd:want')).items['MA:53663O'].from, L.FROM_MIN);
  store.set('ffd:want', JSON.stringify(want1));

  // 열쇠
  eq('열쇠 받기 — 사용자 → 403', (await J(await feed('POST', { body: { op: 'key' } }))).s, 403);
  const k1 = await J(await feed('POST', { tok: ADMIN_TOK, body: { op: 'key' } }));
  ok('열쇠 받기 — 관리자 → 43자 · 사이트', k1.s === 200 && L.KEY_RE.test(k1.j.key) && k1.j.site === SITE);
  const key1 = k1.j.key;
  ok('Redis에는 열쇠가 그대로 없다(해시만)', ![...store.values()].some(v => String(v).includes(key1)));

  // 예약 작업 쪽 문
  eq('job — 열쇠 없음 → 401', (await J(await job('GET', 'want'))).s, 401);
  eq('job — 틀린 열쇠 → 401', (await J(await job('GET', 'want', { key: 'A'.repeat(43) }))).s, 401);
  const pre = await job('OPTIONS', 'want', { origin: MIRAE });
  eq('CORS 사전 요청 — 미래에셋 → 204 · 그 출처 · 열쇠 머리 허용', [pre.status, pre.headers.get('access-control-allow-origin'), /x-job-key/.test(pre.headers.get('access-control-allow-headers') || '')], [204, MIRAE, true]);
  const preBad = await job('OPTIONS', 'want', { origin: 'https://evil.example' });
  eq('CORS 사전 요청 — 다른 사이트 → 403 · 출처 없음', [preBad.status, preBad.headers.get('access-control-allow-origin')], [403, null]);

  const w = await job('GET', 'want', { key: key1, origin: MIRAE });
  const wj = await w.json();
  eq('job 목록 — 받아 둔 것 없으면 시작일부터', wj.items.map(x => [x.code, x.start, x.have.n]), [['MA:53663O', '2026-10-13', 0]]);
  eq('job 응답에도 CORS(미래에셋 출처)', w.headers.get('access-control-allow-origin'), MIRAE);

  // 넣기
  const today = L.kstToday();
  const rows = { '2026-10-27': 1234.5, '2026-10-28': '1,240.25', '2026-11-25': 1301, '2026-02-30': 10, [L.shiftDays(today, 3)]: 99, '2026-11-24': -5 };
  const put1 = await J(await job('POST', 'put', { key: key1, body: { src: 'chrome-mirae<x>', rows: { 'MA:53663O': rows, 'MA:99999X': { '2026-11-25': 1 } } } }));
  eq('넣기 — 이상한 날짜·미래·음수는 버리고 3일', put1.j.res['MA:53663O'], { got: 3, added: 3, total: 3, last: '2026-11-25' });
  eq('넣기 — 목록에 없는 코드는 받지 않는다', put1.j.res['MA:99999X'], { error: 'not wanted' });
  const rec1 = JSON.parse(store.get('ffd:nav:MA:53663O'));
  eq('보관 — 쉼표 숫자 · 출처 다듬기', [rec1.rows['2026-10-28'], rec1.src], [1240.25, 'chrome-miraex']);
  eq('넣기 — 너무 큰 본문 → 413', (await J(await job('POST', 'put', { key: key1, raw: 'x'.repeat(L.BODY_MAX + 1) }))).s, 413);
  eq('넣기 — JSON 아님 → 400', (await J(await job('POST', 'put', { key: key1, raw: '{' }))).s, 400);
  await job('POST', 'put', { key: key1, body: { rows: { 'MA:53663O': { '2026-11-25': 1302.5, '2026-11-26': 1305 } } } });
  eq('다시 넣기 — 같은 날은 덮고(정정) 새 날은 더한다', Object.entries(JSON.parse(store.get('ffd:nav:MA:53663O')).rows), [['2026-10-27', 1234.5], ['2026-10-28', 1240.25], ['2026-11-25', 1302.5], ['2026-11-26', 1305]]);

  // 앱이 받기
  const g = await J(await feed('GET', { q: '?codes=MA:53663O,BAD' }));
  eq('앱 — 받아 둔 기준가', Object.keys(g.j.feed['MA:53663O'].rows).length, 4);
  const g2 = await J(await feed('GET', { q: '?codes=MA:53663O&from=2026-11-01' }));
  eq('앱 — from 이후만', Object.keys(g2.j.feed['MA:53663O'].rows), ['2026-11-25', '2026-11-26']);

  // 받아 둔 것이 시작일을 덮으면 마지막 14일 전부터
  const items2 = L.jobItems({ v: 1, items: { 'MA:53663O': { from: '2026-10-13', at: Date.now(), n: 1 } } },
    { 'MA:53663O': { v: 1, rows: { '2026-10-10': 1, '2026-11-26': 2 }, at: 0, src: '' } });
  eq('job 목록 — 덮었으면 마지막 14일 전부터', items2[0].start, '2026-11-12');
  const items3 = L.jobItems({ v: 1, items: { 'MA:53663O': { from: '2026-11-20', at: Date.now(), n: 1 } } },
    { 'MA:53663O': { v: 1, rows: { '2026-10-10': 1, '2026-11-26': 2 }, at: 0, src: '' } });
  eq('job 목록 — 시작일보다 앞으로는 가지 않는다', items3[0].start, '2026-11-20');

  // 열쇠 교체·만료
  const k2 = (await J(await feed('POST', { tok: ADMIN_TOK, body: { op: 'key' } }))).j.key;
  eq('새 열쇠 → 새 열쇠 통과', (await J(await job('GET', 'want', { key: k2 }))).s, 200);
  eq('새 열쇠 → 앞 열쇠도 3일은 통과', (await J(await job('GET', 'want', { key: key1 }))).s, 200);
  const kr = JSON.parse(store.get('ffd:key'));
  const now = Date.now();
  eq('keyOk — 앞 열쇠 3일 뒤 거절 · 새 열쇠 60일 안 통과 · 60일 뒤 거절', [
    L.keyOk(kr, await L.sha256Hex(key1), kr.at + L.PREV_GRACE + 1000),
    L.keyOk(kr, await L.sha256Hex(k2), kr.at + 59 * DAY),
    L.keyOk(kr, await L.sha256Hex(k2), kr.at + 61 * DAY),
    L.keyOk(null, 'x', now),
  ], [false, true, false, false]);

  // 목록 정리 — 30일 지난 코드 빼기 · 최대 개수
  const old = { v: 1, items: { 'MA:OLD01': { from: '2026-01-01', at: now - 31 * DAY, n: 1 } } };
  eq('mergeWant — 30일 지난 코드는 뺀다', Object.keys(L.mergeWant(old, [], now).items), []);
  const many = Array.from({ length: 50 }, (_, i) => ({ code: `MA:A${String(i).padStart(4, '0')}`, from: '2026-11-01' }));
  let wr = { v: 1, items: {} };
  for (let i = 0; i < 50; i += 10) wr = L.mergeWant(wr, many.slice(i, i + 10), now + i);
  eq('mergeWant — 최근 것 WANT_MAX개만', Object.keys(wr.items).length, L.WANT_MAX);
  const big = {}; for (let i = 0; i < L.ROWS_KEEP + 10; i++) big[L.shiftDays('2000-01-01', i)] = i + 1;
  const mr = L.mergeRows(big, {});
  eq('mergeRows — 오래된 날부터 ROWS_KEEP을 넘는 만큼 버린다', [Object.keys(mr).length, Object.keys(mr).sort()[0]], [L.ROWS_KEEP, L.shiftDays('2000-01-01', 10)]);

  console.log('\n[파트②] 앱 쪽 src/fundFeed.ts');
  eq('코드 모양 — 서버와 같은 정규식', C.FUND_FEED_CODE_RE.source, L.CODE_RE.source);
  eq('사이트 — 서버·앱·과표 우편함이 같다', [C.FUND_JOB_SITE, L.JOB_SITE, (read('api/_aiTax.ts').match(/export const JOB_SITE = '([^']+)'/) || [])[1]], [SITE, SITE, SITE]);
  eq('fundFeedCode', [C.fundFeedCode('ma:53663o', true), C.fundFeedCode('53663O', true), C.fundFeedCode('K55301BU5487', false), C.fundFeedCode('005930', false), C.fundFeedCode('', true)], ['MA:53663O', 'MA:53663O', 'K55301BU5487', '', '']);
  eq('feedSlice', C.feedSlice({ '2026-10-01': 1, '2026-10-15': 2, '2026-11-01': 3 }, '2026-10-10', '2026-10-31'), { '2026-10-15': 2 });
  eq('feedSlice — 구간에 없으면 null', C.feedSlice({ '2026-10-01': 1 }, '2026-11-01', '2026-11-30'), null);
  eq('feedLatest — 최근부터 · 오늘 넘는 날 빼기', C.feedLatest({ '2026-11-24': 1, '2026-11-26': 3, '2026-11-25': 2, '2026-11-27': 9 }, '2026-11-26').map(x => x.date), ['2026-11-26', '2026-11-25', '2026-11-24']);
  const fresh = { key: 'B'.repeat(43), site: SITE, atMs: now - DAY };
  eq('fundJobFileStale', [C.fundJobFileStale(null, now), C.fundJobFileStale(fresh, now), C.fundJobFileStale({ ...fresh, atMs: now - 21 * DAY }, now), C.fundJobFileStale({ ...fresh, site: 'https://x' }, now), C.fundJobFileStale({ ...fresh, key: 'short' }, now)], [true, false, true, true, true]);

  // ensureFundJobKeyFile — 관리자 앱
  appTok = ADMIN_TOK;
  let saved = []; let loadFails = true;
  const io = { load: async () => { if (loadFails) throw new Error('drive 500'); return saved.length ? saved[saved.length - 1] : null; }, save: async (d) => { saved.push(d); } };
  eq('ensure — 읽기 실패면 덮어쓰지 않는다', [await C.ensureFundJobKeyFile(io, now), saved.length], ['fail', 0]);
  loadFails = false;
  eq('ensure — 파일 없음 → 새 열쇠를 받아 쓴다', [await C.ensureFundJobKeyFile(io, now), saved.length, L.KEY_RE.test(saved[0]?.key || ''), saved[0]?.site], ['minted', 1, true, SITE]);
  eq('ensure — 새 파일의 열쇠가 실제로 통한다', (await J(await job('GET', 'want', { key: saved[0].key }))).s, 200);
  const n0 = calls.filter(u => u === '/api/fund-feed').length;
  eq('ensure — 신선하면 서버를 부르지 않는다', [await C.ensureFundJobKeyFile(io, now + DAY), saved.length, calls.filter(u => u === '/api/fund-feed').length - n0], ['ok', 1, 0]);
  eq('ensure — 20일 지나면 새로', [await C.ensureFundJobKeyFile(io, now + 21 * DAY), saved.length], ['minted', 2]);
  appTok = USER_TOK;
  eq('ensure — 관리자 아님 → 서버 거절 → fail(쓰지 않음)', [await C.ensureFundJobKeyFile({ load: async () => null, save: async (d) => { saved.push(d); } }, now), saved.length], ['fail', 2]);

  // 메모·목록 올리기 간격
  C._resetFundFeedMemo();
  const before = calls.filter(u => u.startsWith('/api/fund-feed?codes=')).length;
  const r1 = await C.fundFeedRows('MA:53663O', now);
  const r2 = await C.fundFeedRows('MA:53663O', now + 1000);
  eq('fundFeedRows — 2분 안에는 한 번만 부른다', [Object.keys(r1 || {}).length, r1 === r2, calls.filter(u => u.startsWith('/api/fund-feed?codes=')).length - before], [4, true, 1]);
  eq('fundFeedRows — 이상한 코드는 부르지 않는다', await C.fundFeedRows('../x', now), null);
  const wb = calls.filter(u => u === '/api/fund-feed').length;
  C.fundFeedWant('MA:53663O', '2026-11-01', now); C.fundFeedWant('MA:53663O', '2026-11-01', now + 1000);
  await new Promise(r => setTimeout(r, 30));
  eq('fundFeedWant — 코드마다 10분에 한 번', calls.filter(u => u === '/api/fund-feed').length - wb, 1);

  if (H.API) {
    console.log('\n[파트③] src/api.ts — 모두 막혔을 때 우편함으로');
    C._resetFundFeedMemo();
    blocked = true;
    const hist = await H.API.fetchMiraeFundNavHistory('MA:53663O', '2026-10-20', '2026-11-26');
    eq('fetchMiraeFundNavHistory — 막힘 → 우편함의 그 구간', hist, { '2026-10-27': 1234.5, '2026-10-28': 1240.25, '2026-11-25': 1302.5, '2026-11-26': 1305 });
    const hist2 = await H.API.fetchMiraeFundNavHistory('MA:53663O', '2026-11-26', '2026-11-26');
    eq('fetchMiraeFundNavHistory — 구간만 자른다', hist2, { '2026-11-26': 1305 });
    const info = await H.API.fetchMiraeFundInfo('MA:53663O');
    eq('fetchMiraeFundInfo — 막힘 → 최신 2거래일(이름은 비워 둠)', info && [info.name, info.price, info.navDate, info.prevNavDate, info.prevNavPrice, info.changeAmount], ['', 1305, '2026-11-26', '2026-11-25', 1302.5, 2.5]);
    eq('fetchMiraeFundNavHistory — 우편함에도 없는 코드 → null', await H.API.fetchMiraeFundNavHistory('MA:11111A', '2026-10-01', '2026-11-26'), null);
    ok('막힌 코드는 목록에 올라간다(다음 예약 작업이 읽게)', !!JSON.parse(store.get('ffd:want')).items['MA:11111A']);
  }
}

console.log('\n[파트④] 소스 가드');
const apiSrc = read('src/api.ts');
const fnBody = (name) => {
  const i = apiSrc.indexOf(`export const ${name} = async`);
  if (i < 0) return '';
  const j = apiSrc.indexOf('\nexport const ', i + 10);
  return apiSrc.slice(i, j < 0 ? undefined : j);
};
ok("api.ts — import { fundFeed… } from './fundFeed'", /^import \{[^}]*\bfundFeedRows\b[^}]*\} from '\.\/fundFeed';$/m.test(apiSrc));
for (const n of ['fetchFundInfo', 'fetchFundNavHistory', 'fetchMiraeFundInfo', 'fetchMiraeFundNavHistory']) {
  const b = fnBody(n);
  ok(`api.ts ${n} — 우편함 대체 길(fundFeedRows · fundFeedWant)`, /fundFeedRows\(/.test(b) && /fundFeedWant\(/.test(b));
}
ok('api.ts fetchMiraeFundNavHistory — 첫 쪽이 막히면 우편함', /if \(!firstHtml\) \{[\s\S]{0,400}feedSlice\(await fundFeedRows\(/.test(fnBody('fetchMiraeFundNavHistory')));
const appSrc = read('src/App.tsx');
ok("App.tsx — import { ensureFundJobKeyFile } from './fundFeed'", /^import \{[^}]*\bensureFundJobKeyFile\b[^}]*\} from '\.\/fundFeed';$/m.test(appSrc));
const eff = (appSrc.match(/const fundJobKeyDoneRef = useRef\(''\);\n\s*useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\);/) || [''])[0];
ok('App.tsx 열쇠 효과 — 진짜 관리자 · 관리자 접속 아님 · STATE 정상 로드 게이트', /if \(!isRealAdmin \|\| ADMIN_VIEW_EMAIL \|\| divLinksBootFor !== authUser\.email\.toLowerCase\(\)\) return;/.test(eff));
ok('App.tsx 열쇠 효과 — DRIVE_FILES.FUND_NAV_JOB 을 saveDriveFile/loadDriveFile로', /loadDriveFile\(token, folderId, DRIVE_FILES\.FUND_NAV_JOB\)/.test(eff) && /saveDriveFile\(token, folderId, DRIVE_FILES\.FUND_NAV_JOB, data\)/.test(eff));
ok('App.tsx 열쇠 효과 — saveVersionedBackup 쓰지 않음', eff && !/saveVersionedBackup/.test(eff));
const drvSrc = read('src/driveStorage.ts');
const fileName = (drvSrc.match(/FUND_NAV_JOB:\s*'([^']+)'/) || [])[1];
const clientFile = (read('src/fundFeed.ts').match(/export const FUND_JOB_FILE = '([^']+)'/) || [])[1];
eq('열쇠 파일 이름 — DRIVE_FILES · fundFeed · 예약 작업 지시가 같다', [fileName, clientFile, read('docs/fund-nav-task/TRIGGER-PROMPT.md').includes(`title = '${fileName}'`)], ['fund_nav_job.json', 'fund_nav_job.json', true]);
const usd = read('src/hooks/useStockData.ts');
ok('useStockData — 이력의 최신 날짜가 화면 기준가 날짜보다 새로우면 현재가를 맞춘다', /newestDay > \(item\.navDate \|\| ''\)/.test(usd) && /currentPrice: nav,/.test(usd));
const tp = read('docs/fund-nav-task/TRIGGER-PROMPT.md');
ok('예약 작업 지시 — 목록·넣기 경로와 열쇠 머리', tp.includes('/api/fund-job?op=want') && tp.includes('/api/fund-job?op=put') && tp.includes("'x-job-key'"));
ok('예약 작업 지시 — 미래에셋 목록 주소가 앱과 같은 모양', tp.includes('/magi/fund/basePrices/list.do?fundGb=2&fundCd=') && apiSrc.includes('/magi/fund/basePrices/list.do?fundGb=2&fundCd='));
ok('예약 작업 지시 — 열쇠를 답에 적지 않는다', /열쇠는 답·파일·기록에 적지 않습니다/.test(tp));
const corsList = read('api/_fundFeed.ts').match(/export const CORS_ORIGINS = \[([^\]]*)\]/)?.[1] || '';
eq('CORS는 미래에셋·funetf 두 곳만', corsList.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean), ['https://investments.miraeasset.com', 'https://www.funetf.co.kr', 'https://funetf.co.kr']);

console.log(`\nverify:fund-feed — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
