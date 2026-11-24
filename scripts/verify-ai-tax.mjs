#!/usr/bin/env node
// verify:ai-tax — 과표 계산기 「📷 사진 맡기기」(관리자 전용, 2026-11-24). CLAUDE.md '과표 사진 맡기기' 절.
//   파트① 실제 처리부(api/ai-tax.ts · api/ai-job.ts)를 직접 import해 가짜 구글·Redis·Claude로 끝까지 돌린다 —
//          관리자만 · 사진 맡기기 → 예약 작업 부르기(본문은 번호·열쇠뿐) → 열쇠로 받기·보내기 → 화면이 글을 받아 붙여넣기 미리 보기 →
//          다시 부르면 앞 열쇠 무효 · 끝난 일 닫힘 · 사진 지움 · 한도(동시 3 · 시간 10) · 연결(시험 부르기 · 암호화 보관).
//   파트② 순수 도구(src/taxPhotoJob.ts · scripts/ai-task/taxphoto.mjs checkText)와 소스 가드(관리자·관리자 접속 아님만 켬,
//          화면 조각은 저장하지 않음·알림 없음, 지침 글 = 문서, 숫자·주소가 서버·화면·도구에서 같음).
// .ts 직접 import(타입 스트리핑) + './x.js' → './x.ts' 해석 훅. 런타임이 못 하면 파트①을 건너뛰고 파트②의 소스 가드만 돈다.
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
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SITE = 'https://14ass-page-eea5.vercel.app';
const APP_HOST = 'https://nominfi1.vercel.app'; // 사용자가 여는 운영 주소 — 예약 작업에는 늘 SITE를 알려야 한다(2026-11-25)
const ADMIN_TOK = 'ya29.admin-token-0123456789abcdef';
const USER_TOK = 'ya29.user-token-0123456789abcdefgh';
const ROUTINE = 'trig_01AbCdEfGhIjKlMnOp';
const RT_TOKEN = 'sk-ant-oat01-' + 'x'.repeat(40);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 1)]).toString('base64');
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(3000, 1)]).toString('base64');

// ── 가짜 바깥 세계 ─────────────────────────────────────────
const store = new Map();
let redisDown = false;
let fires = [];
let fireMode = 'ok';   // ok | 401 | 404 | 429 | throw
let tokeninfoCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/tokeninfo?access_token=')) {
    tokeninfoCalls++;
    const tok = decodeURIComponent(u.split('access_token=')[1]);
    const email = tok === ADMIN_TOK ? 'arui114501@gmail.com' : tok === USER_TOK ? 'user@example.com' : '';
    if (!email) return new Response('{"error":"invalid_token"}', { status: 400 });
    return Response.json({ aud: CID, email, email_verified: 'true', expires_in: '3599' });
  }
  if (u.startsWith('https://script.google.com/')) return Response.json({ status: 'approved' });
  if (u === 'https://redis.example') {
    if (redisDown) throw new TypeError('redis down');
    const [c, ...a] = JSON.parse(init.body);
    const r = (result) => Response.json({ result });
    if (c === 'GET') return r(store.has(a[0]) ? store.get(a[0]) : null);
    if (c === 'SET') { store.set(a[0], String(a[1])); return r('OK'); }
    if (c === 'DEL') { let n = 0; for (const k of a) if (store.delete(k)) n++; return r(n); }
    if (c === 'INCR') { const n = (Number(store.get(a[0])) || 0) + 1; store.set(a[0], String(n)); return r(n); }
    if (c === 'EXPIRE') return r(1);
    if (c === 'LPUSH') { const l = JSON.parse(store.get(a[0]) || '[]'); l.unshift(...a.slice(1)); store.set(a[0], JSON.stringify(l)); return r(l.length); }
    if (c === 'LTRIM') { const l = JSON.parse(store.get(a[0]) || '[]'); store.set(a[0], JSON.stringify(l.slice(a[1], a[2] + 1))); return r('OK'); }
    if (c === 'LRANGE') { const l = JSON.parse(store.get(a[0]) || '[]'); return r(l.slice(a[1], a[2] + 1)); }
    if (c === 'LREM') { const l = JSON.parse(store.get(a[0]) || '[]'); store.set(a[0], JSON.stringify(l.filter(x => x !== a[2]))); return r(1); }
    if (c === 'MGET') return r(a.map(k => (store.has(k) ? store.get(k) : null)));
    throw new Error(`가짜 Redis가 모르는 명령 ${c}`);
  }
  if (u.startsWith('https://api.anthropic.com/v1/claude_code/routines/')) {
    const h = new Headers(init.headers);
    fires.push({ url: u, auth: h.get('authorization'), beta: h.get('anthropic-beta'), body: JSON.parse(init.body) });
    if (fireMode === 'throw') throw new TypeError('net');
    if (fireMode !== 'ok') return new Response('{}', { status: Number(fireMode) });
    return Response.json({ claude_code_session_url: 'https://claude.ai/code/session_test01', type: 'routine_fire' });
  }
  throw new Error(`예상 밖 fetch ${u}`);
};

const authSrc = read('api/_auth.ts');
const CID = (authSrc.match(/export const CLIENT_ID = '([^']+)'/) || [])[1];

let H = null;
try {
  register('data:text/javascript,' + encodeURIComponent(
    'export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {' +
    ' if (s.startsWith(".") && s.endsWith(".js")) return n(s.slice(0, -3) + ".ts", c); throw e; } }'));
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token-for-test';
  process.env.KIS_APP_SECRET = 'kis-secret-for-test';
  H = {
    T: await import(pathToFileURL(join(ROOT, 'api/ai-tax.ts')).href),
    J: await import(pathToFileURL(join(ROOT, 'api/ai-job.ts')).href),
    A: await import(pathToFileURL(join(ROOT, 'api/_aiTax.ts')).href),
    P: await import(pathToFileURL(join(ROOT, 'src/taxCalcPaste.ts')).href),
    C: await import(pathToFileURL(join(ROOT, 'src/taxPhotoJob.ts')).href),
  };
} catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension|register/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다.');
  else { fail++; console.log(`  ✗ 처리부를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

const tax = (op, { tok = ADMIN_TOK, body, rid } = {}) => H.T.default(new Request(
  `${APP_HOST}/api/ai-tax?op=${op}${rid ? `&rid=${rid}` : ''}`,
  { method: body === undefined ? 'GET' : 'POST', headers: { 'x-app-token': tok, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
const job = (op, rid, key, body) => H.J.default(new Request(
  `${SITE}/api/ai-job?op=${op}&rid=${rid}`,
  { method: body === undefined ? 'GET' : 'POST', headers: key ? { 'x-job-key': key, 'Content-Type': 'application/json' } : {}, body: body === undefined ? undefined : JSON.stringify(body) }));
const J = async (res) => ({ s: res.status, j: await res.json().catch(() => ({})) });
const fireVal = (f, k) => ((f?.body?.text || '').match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';

if (H) {
  console.log('\n[파트①] 처리부 끝까지 (가짜 구글·Redis·Claude)');
  const { A } = H;

  // 문
  eq('토큰 없음 → 401', (await J(await tax('status', { tok: '' }))).s, 401);
  eq('승인 사용자(관리자 아님) → 403 admin only', await J(await tax('status', { tok: USER_TOK })), { s: 403, j: { error: 'admin only' } });
  eq('관리자 · 연결 전 → connected false · 일 없음', (await J(await tax('status'))).j, { connected: false, src: '', at: 0, jobs: [] });
  eq('연결 전 사진 맡기기 → 409 noconn(저장·부르기 없음)', [(await J(await tax('job', { body: { code: '0177R0', name: 'TIGER', year: 2026, img: JPEG } }))).j.error, fires.length, [...store.keys()].some(k => k.startsWith('ait:job:'))], ['noconn', 0, false]);

  // 연결
  fireMode = '401';
  const c1 = await J(await tax('connect', { body: { url: `https://api.anthropic.com/v1/claude_code/routines/${ROUTINE}/fire`, token: RT_TOKEN } }));
  eq('연결: 토큰 틀림(시험 부르기 401) → 보관하지 않음', [c1.j, store.has('ait:routine')], [{ ok: false, err: 'token', status: 401 }, false]);
  fireMode = 'ok';
  fires = [];
  eq('연결: 실행 URL 모양이 아님 → 400', (await J(await tax('connect', { body: { url: 'https://evil.example/x', token: RT_TOKEN } }))).j.error, 'url');
  eq('연결: 토큰 모양이 아님 → 400', (await J(await tax('connect', { body: { url: ROUTINE, token: 'abc' } }))).j.error, 'token');
  const c2 = await J(await tax('connect', { body: { url: `https://api.anthropic.com/v1/claude_code/routines/${ROUTINE}/fire`, token: RT_TOKEN } }));
  eq('연결: 시험으로 한 번 부름 → ok · 운영 주소로 열어도 사이트=기본 주소', [c2.j.ok, fires.length, fireVal(fires[0], '종류'), fireVal(fires[0], '사이트')], [true, 1, 'test', SITE]);
  eq('연결: 부르기 머리(Bearer·beta)', [fires[0].auth, fires[0].beta, fires[0].url], [`Bearer ${RT_TOKEN}`, 'experimental-cc-routine-2026-04-01', `https://api.anthropic.com/v1/claude_code/routines/${ROUTINE}/fire`]);
  const sealed = store.get('ait:routine') || '';
  ok('연결: 토큰은 암호화해 보관(원문 없음)', /^v1\./.test(sealed) && !sealed.includes(RT_TOKEN) && !sealed.includes(ROUTINE));
  eq('연결 뒤 status', (await J(await tax('status'))).j.connected, true);

  // 맡기기
  fires = [];
  eq('사진 아님(GIF) → 400 img', (await J(await tax('job', { body: { code: '0177R0', name: 'T', year: 2026, img: GIF } }))).j.error, 'img');
  eq('코드 이상 → 400 code', (await J(await tax('job', { body: { code: '0177r0;', name: 'T', year: 2026, img: JPEG } }))).j.error, 'code');
  const m1 = await J(await tax('job', { body: { code: '0177r0', name: 'TIGER 반도체TOP10커버드콜액티브', year: 2026, img: JPEG } }));
  const rid = m1.j.job?.rid;
  eq('맡기기 → 200 · fired · 상태 ask', [m1.s, m1.j.fired, m1.j.job?.st, m1.j.job?.code], [200, true, 'ask', '0177R0']);
  ok('일 요약에 열쇠 해시·글이 없다', !('kh' in (m1.j.job || {})) && !('text' in (m1.j.job || {})));
  const f1 = fires[0];
  const key1 = fireVal(f1, '열쇠');
  eq('부를 때 본문: 종류·사이트·번호·열쇠만', [fireVal(f1, '종류'), fireVal(f1, '사이트'), fireVal(f1, '번호'), key1.length], ['taxphoto', SITE, rid, 43]);
  ok('부를 때 본문에 종목·이름·사진·토큰이 없다', !/0177R0|TIGER|\/9j\/|sk-ant/.test(f1.body.text));
  ok('부를 때 본문이 지침 문서를 가리킨다', /docs\/ai-task\/TAX-PHOTO\.md/.test(f1.body.text));
  const kept = JSON.parse(store.get(`ait:job:${rid}`));
  ok('Redis에는 열쇠 원문이 없고 해시만', !JSON.stringify(kept).includes(key1) && kept.kh === await A.sha256Hex(key1));
  eq('사진은 따로 보관', store.get(`ait:img:${rid}`), JPEG);
  eq('세션 주소를 기억', (await J(await tax('status'))).j.jobs[0].ses, 'https://claude.ai/code/session_test01');

  // 예약 작업 쪽 문
  eq('열쇠 없이 → 401(연결 시험이 기대하는 답)', (await job('take', 't000000000000')).status, 401);
  eq('틀린 열쇠 → 401', (await job('take', rid, 'A'.repeat(43))).status, 401);
  eq('없는 번호 → 404', (await job('take', 'tzzzzzzzzzzzz', key1)).status, 404);
  const t1 = await J(await job('take', rid, key1));
  eq('받기 → 종목·ISIN·연도·사진', [t1.s, t1.j.code, t1.j.isin, t1.j.year, t1.j.mime, t1.j.img === JPEG], [200, '0177R0', 'KR70177R0000', 2026, 'image/jpeg', true]);
  eq('받으면 읽는 중', (await J(await tax('status'))).j.jobs[0].st, 'run');
  eq('읽는 중 다시 부르기 → 409 running', (await J(await tax('fire', { rid, body: {} }))).j.error, 'running');

  // 다시 부르기 — 앞 열쇠 무효
  const kj = JSON.parse(store.get(`ait:job:${rid}`)); kj.ta = Date.now() - 41 * 60_000; kj.fa = Date.now() - 41 * 60_000; store.set(`ait:job:${rid}`, JSON.stringify(kj));
  eq('40분 멈춘 일 → 화면에 stale', (await J(await tax('status'))).j.jobs[0].stale, true);
  fires = [];
  const r2 = await J(await tax('fire', { rid, body: {} }));
  const key2 = fireVal(fires[0], '열쇠');
  eq('다시 부르기 → fired · 2번 부름 · 새 열쇠', [r2.j.fired, r2.j.job.fn, key2.length === 43 && key2 !== key1], [true, 2, true]);
  eq('다시 부른 뒤 앞 열쇠 → 401', (await job('take', rid, key1)).status, 401);
  eq('3분 안에 또 다시 부르기 → 409 soon', (await J(await tax('fire', { rid, body: {} }))).j.error, 'soon');

  // 보내기
  const text = ['2026-11-24 매도 50주 7,490원', '2026-11-23 매수 5주 6,960원', '2026-11-17 매수 30주 7,090원', '2026-11-17 매수 20주 7,150원', '2026-11-17 매수 10주 7,200원'].join('\n');
  eq('빈 글 보내기 → 400', (await job('put', rid, key2, { text: '  ' })).status, 400);
  eq('보내기 → 200', (await J(await job('put', rid, key2, { text, note: '과표기준가를 찾지 못했습니다(접속 막힘)\u0000' }))).j, { ok: true });
  eq('보낸 뒤 사진을 지움', store.has(`ait:img:${rid}`), false);
  eq('끝난 일의 열쇠 → 410', (await job('take', rid, key2)).status, 410);
  eq('끝난 일 다시 부르기 → 409 closed', (await J(await tax('fire', { rid, body: {} }))).j.error, 'closed');
  const g = await J(await tax('job', { rid }));
  eq('화면이 받는 글·메모(제어 문자 지움)', [g.j.text, g.j.job.st, g.j.job.note], [text, 'done', '과표기준가를 찾지 못했습니다(접속 막힘)']);
  const parsed = H.P.parseTaxCalcPaste(g.j.text, '2026-11-24');
  eq('받은 글이 붙여넣기에서 그대로 읽힌다(11-17 세 줄 합침)', parsed.trades.map(t => [t.date, t.side, t.qty, t.price, t.fills]),
    [['2026-11-17', 'buy', 60, 7128.33, 3], ['2026-11-23', 'buy', 5, 6960, 1], ['2026-11-24', 'sell', 50, 7490, 1]]);
  eq('관리자 아님은 일 읽기도 403', (await tax('job', { rid, tok: USER_TOK })).status, 403);

  // 못 함
  fires = [];
  const m2 = await J(await tax('job', { body: { code: '0177R0', name: 'T', year: 2026, img: PNG } }));
  const rid2 = m2.j.job.rid, key3 = fireVal(fires[0], '열쇠');
  eq('PNG도 받는다 · 받기 mime png', (await J(await job('take', rid2, key3))).j.mime, 'image/png');
  eq('못 함 → 200 · 사진 지움 · 상태 err · 까닭', [(await job('fail', rid2, key3, { why: '주문내역 화면이 아닙니다' })).status, store.has(`ait:img:${rid2}`), (await J(await tax('job', { rid: rid2 }))).j.job.why], [200, false, '주문내역 화면이 아닙니다']);

  // 한도
  fireMode = '404';
  const m3 = await J(await tax('job', { body: { code: '0177R0', name: 'T', year: 2026, img: JPEG } }));
  eq('예약 작업 없음(404) → 맡기되 fired false · err trigger · 화면에 못 부름', [m3.j.fired, m3.j.err, H.C.jobState(m3.j.job).label], [false, 'trigger', '못 부름']);
  ok('못 부른 일은 바로 다시 부르기 단추(3분 지나면)', H.C.canRefire({ ...m3.j.job, fa: Date.now() - 200_000 }) && !H.C.canRefire(m3.j.job));
  fireMode = 'ok';
  await tax('job', { body: { code: '0177R0', name: 'T', year: 2026, img: JPEG } });
  await tax('job', { body: { code: '0177R0', name: 'T', year: 2026, img: JPEG } });
  eq('기다리는 일이 3개면(못 부른 일 포함) → 429 busy', (await J(await tax('job', { body: { code: '0177R0', name: 'T', year: 2026, img: JPEG } }))).j.error, 'busy');
  const hourKey = `ait:fh:${new Date().toISOString().slice(0, 13)}`;
  store.set(hourKey, '10');
  const st0 = (await J(await tax('status'))).j.jobs;
  const stuck = st0.find(j => j.fe === 'trigger');
  const sj = JSON.parse(store.get(`ait:job:${stuck.rid}`)); sj.fa = Date.now() - 200_000; store.set(`ait:job:${stuck.rid}`, JSON.stringify(sj));
  fires = [];
  eq('한 시간 10번을 넘으면 부르지 않음 → err hour · 부르기 0', [(await J(await tax('fire', { rid: stuck.rid, body: {} }))).j.err, fires.length], ['hour', 0]);
  store.delete(hourKey);

  // 지우기 · 끊기 · 저장소
  await tax('del', { rid: stuck.rid, body: {} });
  ok('지우기 → 목록·사진에서 빠짐', !(await J(await tax('status'))).j.jobs.some(j => j.rid === stuck.rid) && !store.has(`ait:img:${stuck.rid}`));
  eq('연결 끊기 → connected false', [(await tax('disconnect', { body: {} })).status, (await J(await tax('status'))).j.connected], [200, false]);
  redisDown = true;
  eq('저장소가 응답하지 않으면 맡기기 → 409 noconn 또는 503(사진을 잃지 않게 알림)', [409, 503].includes((await tax('job', { body: { code: '0177R0', name: 'T', year: 2026, img: JPEG } })).status), true);
  redisDown = false;

  // 순수 도구
  eq('trigOf: URL·id·다른 주소', [A.trigOf(`https://api.anthropic.com/v1/claude_code/routines/${ROUTINE}/fire`), A.trigOf(ROUTINE), A.trigOf(`https://api.anthropic.com.evil/v1/claude_code/routines/${ROUTINE}/fire`)], [ROUTINE, ROUTINE, '']);
  const s1 = await A.seal('비밀');
  eq('seal/unseal 왕복 · 고친 글은 null', [await A.unseal(s1), await A.unseal(s1.slice(0, -2) + 'AA')], ['비밀', null]);
  eq('imgOk: JPEG·PNG 예 · GIF·짧음·이상한 글자 아니오', [A.imgOk(JPEG), A.imgOk(PNG), A.imgOk(GIF), A.imgOk('/9j/'), A.imgOk(JPEG.slice(0, 2000) + '*')], [true, true, false, false, false]);
  ok('imgOk: 한도(850,000자) 넘으면 아니오', !A.imgOk('/9j/' + 'A'.repeat(A.IMG_MAX)));
  eq('kstToday: UTC 15시 = 한국 다음 날', A.kstToday(Date.UTC(2026, 10, 23, 15, 30)), '2026-11-24');
}

// ── 파트② 화면·도구·소스 가드 ─────────────────────────────
console.log('\n[파트②] 화면·도구·소스 가드');
const C = H?.C || (await import(pathToFileURL(join(ROOT, 'src/taxPhotoJob.ts')).href).catch(() => null));
if (C) {
  const base = { rid: 'tabc', code: '0177R0', name: '', st: 'ask', at: 0, fa: 0, fn: 1, fe: '', ses: '', ta: 0, da: 0, note: '', why: '', hasText: false, stale: false };
  eq('상태 글', ['ask', 'run', 'done', 'err'].map(st => C.jobState({ ...base, st }).label), ['기다리는 중', 'Claude가 읽는 중', '완료', '못 읽음']);
  eq('멈춘 일 · 못 부른 일 글', [C.jobState({ ...base, st: 'run', stale: true }).label, C.jobState({ ...base, fe: 'token' }).label], ['멈춘 듯', '못 부름']);
  eq('새로 받아 볼 일', [C.jobPending(base), C.jobPending({ ...base, st: 'run' }), C.jobPending({ ...base, fe: 'net' }), C.jobPending({ ...base, st: 'done' }), C.jobPending({ ...base, stale: true })], [true, true, false, false, false]);
  eq('스스로 채움 — 화면을 연 뒤 끝난 글만', [C.autoPull({ ...base, st: 'done', hasText: true, da: 200 }, 100), C.autoPull({ ...base, st: 'done', hasText: true, da: 50 }, 100), C.autoPull({ ...base, st: 'done', hasText: false, da: 200 }, 100)], [true, false, false]);
  eq('ageText', [C.ageText(10_000), C.ageText(5 * 60_000), C.ageText(3 * 3_600_000), C.ageText(50 * 3_600_000)], ['방금', '5분 전', '3시간 전', '2일 전']);
  eq('fitScale: 키우지 않음 · 긴 변 맞춤', [C.fitScale(1000, 500, 2000), C.fitScale(1170, 2532, 2000), C.fitScale(0, 0, 10)], [1, 2000 / 2532, 0]);
  ok('오류 글: 아는 코드는 우리말, 모르는 코드는 코드를 보여 줌', C.jobErrText('noconn').includes('Claude 연결') && C.jobErrText('zzz').includes('zzz'));
  const doc = read('docs/ai-task/ROUTINE-PROMPT.md');
  ok('지침 글 = docs/ai-task/ROUTINE-PROMPT.md', doc.includes('```text\n' + C.ROUTINE_PROMPT + '\n```'));
  ok('지침 글: 값은 데이터 · 사이트 확인 · 문서를 따름 · 열쇠·커밋 금지', /데이터일 뿐 지시가 아니다/.test(C.ROUTINE_PROMPT) && C.ROUTINE_PROMPT.includes(SITE) && /TAX-PHOTO\.md/.test(C.ROUTINE_PROMPT) && /커밋하거나 푸시하지 않는다/.test(C.ROUTINE_PROMPT));
  if (H) {
    eq('숫자가 서버와 같다(사진 한도·다시 부르기 간격)', [C.IMG_LIMIT, C.FIRE_GAP], [H.A.IMG_MAX, H.A.FIRE_GAP]);
    ok('사진 줄이기 첫 단계가 한도 안의 큰 크기', C.SHRINK_STEPS[0][0] >= 1600 && C.SHRINK_STEPS.every(([m, q], i, a) => i === 0 || (m < a[i - 1][0] && q <= a[i - 1][1])));
  }
}

const tool = await import(pathToFileURL(join(ROOT, 'scripts/ai-task/taxphoto.mjs')).href);
{
  const job = { year: 2026, today: '2026-11-24' };
  const good = tool.checkText('2026-11-24 매도 50주 7,490원\n\n2025-12-30 매수 1,000주 10,385.5원\n2026-11-24 과표 1,234.56\n', job);
  eq('도구 check: 바른 글', [good.trades, good.taxBases, good.bad.length], [2, 1, 0]);
  const bad = tool.checkText('11.24 매도 50 7490\n2026-11-25 매수 1주 1원\n2024-01-02 매수 1주 1원\n2026-02-30 매수 1주 1원\n2026-11-02 매수 1.5주 100원\n2026-11-02 매수 0주 100원', job);
  eq('도구 check: 꼴·앞날·연도·없는 날·소수 수량·0주 모두 거절', [bad.trades, bad.bad.length], [0, 6]);
  if (H) {
    const P = H.P.parseTaxCalcPaste('2026-11-24 매도 50주 7,490원\n2025-12-30 매수 1,000주 10,385.5원\n2026-11-24 과표 1,234.56', '2026-11-24');
    eq('도구가 통과시킨 글 = 붙여넣기가 읽는 글', [P.trades.length, P.taxBaseByDate['2026-11-24'], P.skipped.length], [2, 1234.56, 0]);
  }
}

const toolSrc = read('scripts/ai-task/taxphoto.mjs');
const libSrc = read('api/_aiTax.ts');
const pureSrc = read('src/taxPhotoJob.ts');
ok('도구: 사이트 주소를 하나로 고정', toolSrc.includes(`const SITE = '${SITE}';`) && pureSrc.includes(`SITE_ORIGIN = '${SITE}'`));
ok('서버: 예약 작업에 알리는 주소는 요청 주소가 아니라 JOB_SITE 하나', read('api/_aiTax.ts').includes(`JOB_SITE = '${SITE}'`) && /const origin = JOB_SITE;/.test(read('api/ai-tax.ts')) && !/url\.origin/.test(read('api/ai-tax.ts')));
ok('도구: fetch가 닿지 못하면 curl(프록시 환경) · 열쇠는 헤더 파일(0600)로 — 명령줄에 싣지 않음', /execFileSync\('curl', args/.test(toolSrc) && /args\.push\('-H', `@\$\{HDRF\}`\)/.test(toolSrc) && /writeFileSync\(HDRF, [^)]*\{ mode: 0o600 \}\)/.test(toolSrc));
ok('도구: 열쇠는 0600 파일에만', /writeFileSync\(KEYF, key, \{ mode: 0o600 \}\)/.test(toolSrc) && !/console\.log\([^)]*key/.test(toolSrc));
ok('_aiTax.ts · taxPhotoJob.ts import 0건', !/^import /m.test(libSrc) && !/^import /m.test(pureSrc));
ok('서버: 열쇠는 해시로만 저장 · 다시 부를 때 새 열쇠', /j\.kh = await sha256Hex\(key\)/.test(libSrc) && /const key = newKey\(\);/.test(libSrc));
ok('서버: 끝난 일 닫힘 · 사진 지움', /j\.st === 'done' \|\| j\.st === 'err'\) return json\(410/.test(libSrc) && (read('api/ai-job.ts').match(/await delImg\(j\.rid\)/g) || []).length === 2);
const taxSrc = read('api/ai-tax.ts');
ok('ai-tax: requireAuth 다음 줄에서 관리자만', /if \(denied\) return denied;\n  if \(\(await callerEmail\(request\)\) !== ADMIN_EMAIL\) return json\(403/.test(taxSrc));
ok('ai-tax · ai-job: 사용자 데이터·Drive에 닿지 않음', !/googleapis\.com\/drive|saveDriveFile|taxBaseHistory/.test(taxSrc + read('api/ai-job.ts') + libSrc));

const comp = read('src/components/TaxPhotoJobs.tsx');
const compCode = stripComments(comp);
ok('화면 조각: 저장하지 않음(onText로 붙여넣기 칸에만)', /onText\(r\.j\.text\)/.test(compCode) && !/updateTaxBase|persistEvents|saveDriveFile/.test(compCode));
ok('화면 조각: 알림(notify) 없음', !/\bnotify\(/.test(compCode));
ok('화면 조각: /api/ai-tax만 부른다', (compCode.match(/['`]\/api\/[\w-]+/g) || []).every(s => s.includes('/api/ai-tax')));
ok('화면 조각: 토큰 칸은 password · 자동완성 끔', /type="password"\s+autoComplete="off"/.test(comp));
const mx = read('src/components/KrEtfTaxMatrix.tsx');
ok('계산기: TaxPhotoJobs import · aiPhoto 기본 false', /^import TaxPhotoJobs from '\.\/TaxPhotoJobs';$/m.test(mx) && /\n  aiPhoto = false,\n\}\) \{/.test(mx));
ok('계산기: aiPhoto일 때만 · 글은 붙여넣기 칸으로(미리 보기 펼침 — 「넣기」는 사용자가)', /\{aiPhoto && \(\s*<TaxPhotoJobs code=\{stock\.code\} name=\{stock\.name \|\| ''\} canAuto=\{!pasteText\.trim\(\)\} onText=\{\(t\) => \{ setPasteText\(t\); setPasteMore\(true\); \}\} \/>/.test(mx));
const dst = read('src/components/DividendSummaryTable.tsx');
ok('분배금 표: aiPhoto 받아서 넘김(기본 false)', /cardWindowOpen, aiPhoto = false \}\) \{/.test(dst) && /aiPhoto=\{aiPhoto\}/.test(dst));
ok('App: 관리자 · 관리자 접속(impersonation) 아님만 켬', /aiPhoto=\{isAdminUser && !ADMIN_VIEW_EMAIL\}/.test(read('src/App.tsx')));
ok('카드 별도 창은 켜지 않음', !/aiPhoto/.test(read('src/components/CardWindow.tsx')));
ok('예약 작업 문서: 체결수량·평균체결가 · 합치지 않음 · 과표는 본 것만', (() => { const d = read('docs/ai-task/TAX-PHOTO.md'); return /체결수량, 가격 = 평균체결가/.test(d) && /합치지 않는다/.test(d) && /직접 본 것만/.test(d) && /연결 시험/.test(d); })());

console.log(`\nverify:ai-tax — ${pass} 통과 / ${fail} 실패`);
globalThis.fetch = realFetch;
process.exit(fail ? 1 : 0);
