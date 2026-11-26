#!/usr/bin/env node
// verify:pc-ask — 「내 PC가 구독 AI에 묻기」(2026-11-26 · api/_pcAsk.ts · src/pcAsk.ts 머리 주석)
//   파트① 실제 처리부(api/pc-ask.ts · api/pc-job.ts)를 가짜 구글·승인 스크립트·Redis로 끝까지 — 연결 전 맡기기 거절 → 연결 문구(열쇠)
//          → 맡기기 → PC 가져가기 → 답 넣기 → 창이 받기 · 취소·실패 · 다른 사용자 우편함과 섞이지 않음 · 열쇠 바꾸면 앞 열쇠 끝 · 한도.
//   파트② 연결 문구 속 bash·curl을 **실제로 돌린다**(작은 로컬 서버가 pc-job 처리부를 감싼다) — 기다리기·질문 받기·답(한글·따옴표)·실패.
//   파트③ 화면 쪽 순수 도구(src/pcAsk.ts)와 저장 모양(src/aiSearch.ts) · 사이트 목록이 화면(AI_HANDS)과 같은가.
//   파트④ 소스 가드 — 화면이 부르는 길·열쇠를 저장하지 않음·관리자 접속 중 숨김·서버 문.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { register } from 'node:module';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
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

const USER_TOK = 'ya29.user-token-0123456789abcdefgh';
const OTHER_TOK = 'ya29.other-token-0123456789abcdefg';
const CID = (read('api/_auth.ts').match(/export const CLIENT_ID = '([^']+)'/) || [])[1];
const ADMIN = (read('api/_auth.ts').match(/export const ADMIN_EMAIL = '([^']+)'/) || [])[1];
const ADMIN_TOK = 'ya29.admin-token-0123456789abcdefgh';

// ── 가짜 바깥 세계 ──
const store = new Map();
let H = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/tokeninfo?access_token=')) {
    const tok = decodeURIComponent(u.split('access_token=')[1]);
    const email = tok === USER_TOK ? 'user@example.com' : tok === OTHER_TOK ? 'other@example.com' : tok === ADMIN_TOK ? ADMIN : '';
    if (!email) return new Response('{"error":"invalid_token"}', { status: 400 });
    return Response.json({ aud: CID, email, email_verified: 'true', expires_in: '3599' });
  }
  if (u.startsWith('https://script.google.com/')) return Response.json({ status: 'approved' });
  if (u === 'https://redis.example') {
    const [c, ...a] = JSON.parse(init.body);
    const r = (result) => Response.json({ result });
    const list = (k) => { if (!store.has(k)) store.set(k, []); return store.get(k); };
    if (c === 'GET') return r(store.has(a[0]) ? store.get(a[0]) : null);
    if (c === 'SET') { store.set(a[0], String(a[1])); return r('OK'); }
    if (c === 'DEL') { let n = 0; for (const k of a) if (store.delete(k)) n++; return r(n); }
    if (c === 'MGET') return r(a.map(k => (store.has(k) && typeof store.get(k) === 'string' ? store.get(k) : null)));
    if (c === 'INCR') { const n = (Number(store.get(a[0])) || 0) + 1; store.set(a[0], String(n)); return r(n); }
    if (c === 'EXPIRE') return r(1);
    if (c === 'LPUSH') { const l = list(a[0]); l.unshift(...a.slice(1)); return r(l.length); }
    if (c === 'RPOP') { const l = store.get(a[0]); return r(Array.isArray(l) && l.length ? l.pop() : null); }
    if (c === 'LLEN') { const l = store.get(a[0]); return r(Array.isArray(l) ? l.length : 0); }
    throw new Error(`가짜 Redis가 모르는 명령 ${c}`);
  }
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, init);
  throw new Error(`예상 밖 fetch ${u}`);
};

try {
  register('data:text/javascript,' + encodeURIComponent(
    'export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {' +
    ' if (s.startsWith(".") && s.endsWith(".js")) return n(s.slice(0, -3) + ".ts", c); throw e; } }'));
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token-for-test';
  H = {
    A: await import(pathToFileURL(join(ROOT, 'api/pc-ask.ts')).href),
    J: await import(pathToFileURL(join(ROOT, 'api/pc-job.ts')).href),
    L: await import(pathToFileURL(join(ROOT, 'api/_pcAsk.ts')).href),
    C: await import(pathToFileURL(join(ROOT, 'src/pcAsk.ts')).href),
    S: await import(pathToFileURL(join(ROOT, 'src/aiSearch.ts')).href),
    P: await import(pathToFileURL(join(ROOT, 'src/aiProviders.ts')).href),
  };
} catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension|register/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①~③을 건너뜁니다.');
  else { fail++; console.log(`  ✗ 처리부를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
  H = null;
}

const site = (body, tok = USER_TOK) => H.A.default(new Request('https://nominfi1.vercel.app/api/pc-ask', {
  method: 'POST', headers: { 'x-app-token': tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const pc = (op, key, { body, q = '', method = 'POST' } = {}) => H.J.default(new Request(`https://nominfi1.vercel.app/api/pc-job?op=${op}${q}`, {
  method, headers: key ? { 'x-pc-key': key, 'Content-Type': 'text/plain; charset=utf-8' } : {}, body: method === 'POST' ? (body ?? '') : undefined,
}));
const J = async (resP) => { const res = await resP; let j = null; try { j = await res.json(); } catch { j = null; } return { status: res.status, ...(j || {}) }; };
const sh = (cmd, cwd) => new Promise((resolve) => {
  execFile('bash', ['-c', cmd], { cwd, timeout: 30_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout).trim(), err: String(stderr) }));
});

if (H) {
  console.log('\n[파트①] 처리부 끝까지');
  eq('#A1 연결 전 — 상태 = 연결 안 됨', (await J(site({ op: 'status' }))).linked, false);
  const a0 = await J(site({ op: 'ask', target: 'chatgpt', prompt: '오늘 코스피' }));
  eq('#A2 연결 전 맡기기 → 409 nopc', [a0.status, a0.code], [409, 'nopc']);
  const nk = await J(site({ op: 'newkey' }));
  ok('#A3 연결 문구 열쇠 = 사용자 표시 24자 . 무작위 43자', H.L.PC_KEY_RE.test(nk.key || '') && H.C.PC_KEY_SHAPE.test(nk.key || ''));
  const KEY = nk.key;
  const keyRec = [...store.entries()].find(([k]) => k.startsWith('pca:key:'));
  ok('#A3 Redis에는 무작위 부분의 해시만(열쇠 그대로·이메일 없음)', !!keyRec && !keyRec[1].includes(KEY.split('.')[1]) && ![...store.keys()].some(k => k.includes('user@example.com')));
  eq('#A4 연결 뒤 상태 = 연결됨 · PC 확인 없음', [(await J(site({ op: 'status' }))).linked, (await J(site({ op: 'status' }))).seen], [true, 0]);
  eq('#A5 틀린 AI 이름 → 400', (await J(site({ op: 'ask', target: 'evil', prompt: 'x' }))).status, 400);
  eq('#A5 빈 질문 → 400', (await J(site({ op: 'ask', target: 'chatgpt', prompt: '  ' }))).status, 400);
  eq('#A5 너무 긴 질문 → 400', (await J(site({ op: 'ask', target: 'chatgpt', prompt: 'x'.repeat(H.L.PROMPT_MAX + 1) }))).status, 400);
  const pong = await J(pc('ping', KEY, { method: 'GET' }));
  eq('#B1 PC 연결 시험(ping) · PC 확인 시각이 적힌다', [pong.status, pong.ok, (await J(site({ op: 'status' }))).seen > 0], [200, true, true]);
  eq('#B2 열쇠 없음·모양 틀림·남의 무작위 → 401', [
    (await J(pc('take', ''))).status, (await J(pc('take', 'abc'))).status, (await J(pc('take', KEY.split('.')[0] + '.' + 'A'.repeat(43)))).status,
  ], [401, 401, 401]);
  eq('#B3 맡긴 것이 없으면 none', (await J(pc('take', KEY))).none, true);
  const q1 = await J(site({ op: 'ask', target: 'chatgpt', prompt: '[앞에서 나눈 대화]\n질문: a\n\n오늘 코스피 마감 알려 줘' }));
  ok('#B4 맡기기 → 번호', q1.status === 200 && H.C.PC_JOB_RE.test(q1.id || ''));
  const q2 = await J(site({ op: 'ask', target: 'claude', prompt: '미국 금리 전망' }));
  const g0 = await J(site({ op: 'get', ids: [q1.id, q2.id] }));
  eq('#B5 창이 보는 상태 = wait 둘', g0.jobs.map(j => j.st), ['wait', 'wait']);
  const t1 = await J(pc('take', KEY));
  eq('#B6 PC는 먼저 맡긴 것부터 받는다 · 사이트 이름·주소·질문 그대로', [t1.id, t1.target, t1.label, t1.url, t1.prompt.endsWith('오늘 코스피 마감 알려 줘')], [q1.id, 'chatgpt', 'ChatGPT', 'https://chatgpt.com/', true]);
  eq('#B6 가져간 뒤 창이 보는 상태 = take', (await J(site({ op: 'get', ids: [q1.id] }))).jobs[0].st, 'take');
  const otherKey = (await J(site({ op: 'newkey' }, OTHER_TOK))).key;
  eq('#B7 다른 사용자 PC는 내 질문을 못 받는다 · 내 답도 못 넣는다', [(await J(pc('take', otherKey))).none, (await J(pc('done', otherKey, { q: `&id=${q1.id}`, body: '가짜' }))).status], [true, 409]);
  eq('#B7 다른 사용자 창은 내 질문 번호로 내 상태를 못 본다', (await J(site({ op: 'get', ids: [q1.id] }, OTHER_TOK))).jobs[0].st, 'gone');
  const ans = '## 코스피 마감 (2026-11-26 기준)\n\n- **코스피**: 2,612.35 (+0.84%)\n- "따옴표" 와 \'작은따옴표\'';
  eq('#B8 빈 답은 거절', (await J(pc('done', KEY, { q: `&id=${q1.id}`, body: '   ' }))).status, 400);
  const d1 = await J(pc('done', KEY, { q: `&id=${q1.id}&model=GPT-5<script>`, body: ans }));
  eq('#B8 답 넣기', [d1.status, d1.ok], [200, true]);
  const g1 = await J(site({ op: 'get', ids: [q1.id, q2.id, 'bad id!'] }));
  eq('#B9 창이 받는 답 = 그대로 · 모델 이름 다듬음 · 틀린 번호는 뺌', [g1.jobs.length, g1.jobs[0].st, g1.jobs[0].a, g1.jobs[0].m, g1.jobs[1].st], [2, 'done', ans, 'GPT-5script', 'wait']);
  eq('#B10 끝난 질문에 또 넣기 → 409', (await J(pc('done', KEY, { q: `&id=${q1.id}`, body: 'x' }))).status, 409);
  eq('#B11 창에서 취소 → PC가 받지 않는다', [(await J(site({ op: 'cancel', id: q2.id }))).ok, (await J(pc('take', KEY))).none], [true, true]);
  const q3 = await J(site({ op: 'ask', target: 'gemini', prompt: 'q3' }));
  await J(pc('take', KEY));
  const f3 = await J(pc('fail', KEY, { q: `&id=${q3.id}`, body: '로그인 필요: Gemini' }));
  const v3 = (await J(site({ op: 'get', ids: [q3.id] }))).jobs[0];
  eq('#B12 PC가 실패를 알림 → 창이 까닭을 본다(답은 없음)', [f3.ok, v3.st, v3.e, 'a' in v3], [true, 'fail', '로그인 필요: Gemini', false]);
  const q4 = await J(site({ op: 'ask', target: 'grok', prompt: 'q4' }));
  await J(pc('take', KEY));
  await J(site({ op: 'cancel', id: q4.id }));
  eq('#B13 PC가 묻는 사이 창에서 취소 → 답 넣기는 cancel', (await J(pc('done', KEY, { q: `&id=${q4.id}`, body: '늦은 답' }))).error, 'cancel');
  // 사진이 든 질문(자산 평가액 추이 「주문내역 사진」 → 내 PC의 Claude) — 2026-11-26
  const AKEY = (await J(site({ op: 'newkey' }, ADMIN_TOK))).key;
  const PNG = randomBytes(600);   // 사진 자리(서버는 그림 내용이 아니라 base64 모양·크기만 본다)
  const bigImg = { mime: 'image/jpeg', data: 'A'.repeat(H.L.PC_IMG_MAX + 4) };
  const img1 = { mime: 'image/png', data: PNG.toString('base64') };
  const notAdmin = await J(site({ op: 'ask', target: 'claude', prompt: 'p', imgs: [img1] }));
  eq('#I9 사진이 든 질문은 관리자만 — 다른 사용자 403 admin(각자 쓰는 AI로 읽어 붙여 넣는다)', [notAdmin.status, notAdmin.code, [...store.keys()].some(k => k.startsWith('pca:img:'))], [403, 'admin', false]);
  eq('#I1 사진 질문 거절 — 다른 AI·5장·형식·너무 큼', [
    (await J(site({ op: 'ask', target: 'chatgpt', prompt: 'p', imgs: [img1] }, ADMIN_TOK))).error,
    (await J(site({ op: 'ask', target: 'claude', prompt: 'p', imgs: Array(H.L.PC_IMG_N + 1).fill(img1) }, ADMIN_TOK))).error,
    (await J(site({ op: 'ask', target: 'claude', prompt: 'p', imgs: [{ mime: 'image/gif', data: img1.data }] }, ADMIN_TOK))).error,
    (await J(site({ op: 'ask', target: 'claude', prompt: 'p', imgs: [bigImg] }, ADMIN_TOK))).error,
  ], ['사진은 내 PC의 Claude만 읽습니다', `사진은 한 번에 ${H.L.PC_IMG_N}장까지입니다`, '사진 형식이 틀렸습니다', '사진 자료가 깨졌거나 너무 큽니다']);
  const realImg = { mime: 'image/png', data: PNG.toString('base64') };
  const qi = await J(site({ op: 'ask', target: 'claude', prompt: '주문내역 사진을 읽어 매매 줄로', imgs: [realImg, realImg] }, ADMIN_TOK));
  ok('#I2 사진 두 장 맡기기 → 번호 · Redis에 사진 두 칸', qi.status === 200 && [...store.keys()].filter(k => k.includes(`:${qi.id}:`) && k.startsWith('pca:img:')).length === 2);
  const ti = await J(pc('take', AKEY));
  eq('#I3 PC가 받는 질문에 사진 수(imgs) · claude', [ti.id, ti.target, ti.imgs], [qi.id, 'claude', 2]);
  // 사용자 신고 2026-11-26: 사진 규칙 전에 연결한 PC 대화가 imgs만 보고 '사진 없음' → 질문 JSON에 받는 주소·받는 법을 싣는다.
  const viaUrl = Array.isArray(ti.imgUrls) && ti.imgUrls.length === 2
    ? await H.J.default(new Request(ti.imgUrls[1], { method: 'GET', headers: { 'x-pc-key': AKEY } })) : null;
  ok('#I3b 질문 JSON의 imgUrls(2개) 주소로 그대로 받으면 사진 · imgHow에 열쇠 머리말·실패 길 · 열쇠 글자는 싣지 않음',
    !!viaUrl && viaUrl.status === 200 && Buffer.from(await viaUrl.arrayBuffer()).equals(PNG)
    && ti.imgUrls[0] === `https://nominfi1.vercel.app/api/pc-job?op=img&id=${qi.id}&n=1`
    && typeof ti.imgHow === 'string' && ti.imgHow.includes('X-PC-Key') && ti.imgHow.includes('op=fail') && ti.imgHow.includes(ti.imgUrls[0])
    && !JSON.stringify(ti).includes(AKEY.split('.')[1]));
  eq('#I3c 사진 없는 질문엔 imgUrls·imgHow가 없다 · 이상한 값엔 null · 장수는 한도까지', [
    'imgUrls' in t1 || 'imgHow' in t1, H.L.takeImgInfo('https://x', qi.id, 0), H.L.takeImgInfo('https://x', 'bad id!', 2), H.L.takeImgInfo('https://x/', qi.id, 9).imgUrls.length,
  ], [false, null, null, H.L.PC_IMG_N]);
  const im1 = await pc('img', AKEY, { q: `&id=${qi.id}&n=1`, method: 'GET' });
  const im1b = Buffer.from(await im1.arrayBuffer());
  eq('#I4 사진 받기 = 그림 그대로(형식 포함)', [im1.status, im1.headers.get('content-type'), im1b.equals(PNG)], [200, 'image/png', true]);
  eq('#I5 없는 번호·남의 열쇠 → 404', [(await pc('img', AKEY, { q: `&id=${qi.id}&n=3`, method: 'GET' })).status, (await pc('img', KEY, { q: `&id=${qi.id}&n=1`, method: 'GET' })).status], [404, 404]);
  await J(pc('done', AKEY, { q: `&id=${qi.id}&model=Claude`, body: '매매 | 2026-11-17 | 0177R0 | TIGER | 매수 | 30 | 7,090' }));
  eq('#I6 답을 넣으면 사진은 바로 지운다 · 그 뒤 사진 받기 404', [[...store.keys()].some(k => k.startsWith('pca:img:') && k.includes(qi.id)), (await pc('img', AKEY, { q: `&id=${qi.id}&n=1`, method: 'GET' })).status], [false, 404]);
  const qc = await J(site({ op: 'ask', target: 'claude', prompt: 'x', imgs: [realImg] }, ADMIN_TOK));
  await J(site({ op: 'cancel', id: qc.id }, ADMIN_TOK));
  eq('#I7 취소해도 사진을 지운다', [...store.keys()].some(k => k.startsWith('pca:img:') && k.includes(qc.id)), false);
  eq('#I0 화면 한도 = 서버 한도(장수·글자 수)', [H.C.PC_PHOTO_N, H.C.PC_PHOTO_CHARS], [H.L.PC_IMG_N, H.L.PC_IMG_MAX]);
  // 동시에 맡길 수 있는 수
  const many = [];
  for (let i = 0; i < H.L.WAIT_MAX + 1; i++) many.push(await J(site({ op: 'ask', target: 'chatgpt', prompt: `m${i}` })));
  eq(`#B14 동시에 ${H.L.WAIT_MAX}개까지 — 넘으면 busy`, [many.slice(0, H.L.WAIT_MAX).every(r => r.status === 200), many[H.L.WAIT_MAX].code], [true, 'busy']);
  for (let i = 0; i < H.L.WAIT_MAX; i++) await J(pc('take', KEY));
  // 하루 한도
  const dayKey = [...store.keys()].find(k => k.startsWith('pca:n:') && !k.includes(otherKey.split('.')[0]));
  store.set(dayKey, String(H.L.DAY_MAX));
  eq(`#B15 하루 ${H.L.DAY_MAX}번 — 넘으면 day`, (await J(site({ op: 'ask', target: 'chatgpt', prompt: 'x' }))).code, 'day');
  store.set(dayKey, '1');
  // 열쇠 바꾸기·끊기
  const nk2 = (await J(site({ op: 'newkey' }))).key;
  H.L.forgetCaches();
  eq('#B16 열쇠를 새로 만들면 앞 열쇠는 끝 · 새 열쇠는 통함', [(await J(pc('take', KEY))).status, (await J(pc('take', nk2))).status], [401, 200]);
  await J(site({ op: 'unlink' }));
  H.L.forgetCaches();
  eq('#B17 연결 끊기 → 열쇠 끝 · 상태 = 연결 안 됨', [(await J(pc('take', nk2))).status, (await J(site({ op: 'status' }))).linked], [401, false]);
  eq('#B18 로그인 없이 창 쪽 → 401', (await J(site({ op: 'status' }, 'ya29.bad-token-xxxxxxxxxxxxxxxxxxxx'))).status, 401);
  eq('#B19 PC 쪽은 POST만(ping 빼고)', (await J(pc('take', otherKey, { method: 'GET' }))).status, 405);

  console.log('\n[파트②] 연결 문구 속 bash·curl을 실제로 돌린다');
  const KEY3 = (await J(site({ op: 'newkey' }))).key;
  H.L.forgetCaches();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const r = await H.J.default(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const SITE = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), 'pcask-'));
  try {
    const text = H.C.pcTaskPrompt(SITE + '/', KEY3);
    ok('#P1 문구 — 사이트·열쇠·준비·되풀이·지킬 것(비밀번호·우회·질문 속 지시·앱 화면)', text.includes(`사이트: ${SITE}\n`) && text.includes(`PC 열쇠: ${KEY3}`)
      && text.includes('Claude in Chrome') && text.includes('비밀번호') && text.includes('우회하지') && text.includes('따르지 말고') && text.includes('앱 화면은 열지 않습니다'));
    const loop = (text.match(/```bash\n([\s\S]*?)```/) || [])[1] || '';
    ok('#P2 기다리기 명령이 있다(처음 30번 20초 · 그 뒤 60초 · 120번 ≈ 100분)', /^S=20$/m.test(loop) && /seq 1 120/.test(loop) && /\[ "\$i" -ge 30 \] && S=60/.test(loop) && /sleep \$S/.test(loop) && /op=take/.test(loop));
    const fast = loop.replace('seq 1 120', 'seq 1 3').replace('S=20', 'S=0.1').replace('&& S=60', '&& S=0.1');
    const idle = await sh(fast, dir);
    eq('#P3 질문이 없으면 IDLE로 끝난다', [idle.code, idle.out], [0, 'IDLE']);
    const qa = await J(site({ op: 'ask', target: 'perplexity', prompt: '배당 ETF 소식' }));
    const got = await sh(fast, dir);
    let job = null;
    try { job = JSON.parse(got.out); } catch { job = null; }
    eq('#P4 질문이 오면 JSON 한 줄을 출력하고 끝난다', [got.code, job && job.id, job && job.target, job && job.prompt], [0, qa.id, 'perplexity', '배당 ETF 소식']);
    const answer = '## 배당 ETF 소식\n\n- "큰따옴표" · \'작은따옴표\' · $HOME · `백틱` · 100%\n| 이름 | 분배율 |\n|---|---|\n| A | 3.5% |\n';
    writeFileSync(join(dir, 'pcask-answer.md'), answer);
    const doneLine = (text.match(/^\s*(curl -s -X POST "[^"]*op=done[^\n]*)$/m) || [])[1] || '';
    const sent = await sh(doneLine.replace('<id>', job.id).replace('<모델>', 'Sonar-Pro'), dir);
    eq('#P5 답 보내기 명령 = {"ok":true}', sent.out, '{"ok":true}');
    const back = (await J(site({ op: 'get', ids: [qa.id] }))).jobs[0];
    eq('#P5 창이 받은 답 = 파일 그대로(한글·따옴표·$·백틱) · 모델', [back.st, back.a, back.m], ['done', answer.trim(), 'Sonar-Pro']);
    const qb = await J(site({ op: 'ask', target: 'chatgpt', prompt: 'x' }));
    await sh(fast, dir);
    const failLine = (text.match(/^\s*(curl -s -X POST "[^"]*op=fail[^\n]*)$/m) || [])[1] || '';
    const fsent = await sh(failLine.replace('<id>', qb.id), dir);
    eq('#P6 실패 알리기 명령 → 창이 까닭을 본다', [fsent.out, (await J(site({ op: 'get', ids: [qb.id] }))).jobs[0].e], ['{"ok":true}', '까닭 한 줄(예: 로그인 필요: ChatGPT)']);
    const pingLine = (text.match(/연결 시험: (curl[^\n]+)/) || [])[1] || '';
    eq('#P7 연결 시험 명령 = {"ok":true}', (await sh(pingLine, dir)).out, '{"ok":true}');
    const PNG2 = randomBytes(900);
    const AKEY3 = (await J(site({ op: 'newkey' }, ADMIN_TOK))).key;
    H.L.forgetCaches();
    const atext = H.C.pcTaskPrompt(SITE + '/', AKEY3);
    const afast = ((atext.match(/```bash\n([\s\S]*?)```/) || [])[1] || '').replace('seq 1 120', 'seq 1 3').replace('S=20', 'S=0.1').replace('&& S=60', '&& S=0.1');
    const qp = await J(site({ op: 'ask', target: 'claude', prompt: '사진', imgs: [{ mime: 'image/jpeg', data: PNG2.toString('base64') }] }, ADMIN_TOK));
    const gotp = JSON.parse((await sh(afast, dir)).out || '{}');
    const imgLine = (atext.match(/^\s*(curl -s "[^"]*op=img[^\n]*)$/m) || [])[1] || '';
    await sh(imgLine.replace('<id>', gotp.id).replace(/<n>/g, '1'), dir);
    let file = null;
    try { file = readFileSync(join(dir, 'pcask-img-1.jpg')); } catch { file = null; }
    eq('#I8 문구 속 사진 받기 명령 → 파일 = 보낸 사진 그대로', [gotp.id === qp.id, gotp.imgs, !!file && file.equals(PNG2)], [true, 1, true]);
    const add = H.C.pcPhotoAddendum(SITE + '/');
    const addLine = (add.match(/^(curl -s "[^"]*op=img[^\n]*)$/m) || [])[1] || '';
    eq('#I3 덧붙일 규칙 글의 사진 받기 명령 = 연결 문구의 것(열쇠 자리만 다름) · 열쇠를 적지 않음', [addLine.replace('<PC 열쇠>', AKEY3), add.includes(AKEY3)], [imgLine.trim(), false]);
    await J(pc('fail', AKEY3, { q: `&id=${qp.id}`, body: 'x' }));
    const bad = await sh(fast.split(KEY3).join(KEY3.slice(0, 25) + 'B'.repeat(43)), dir);
    ok('#P8 열쇠가 바뀌었으면 기다리기가 pc key required를 출력하고 바로 끝난다', bad.code === 0 && bad.out.includes('pc key required'));
  } catch (e) {
    fail++; console.log(`  ✗ 파트② 실행 중 오류 — ${e && (e.stack || e.message)}`);
  } finally {
    server.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ }
  }

  console.log('\n[파트③] 화면 쪽 도구 · 저장 모양 · 사이트 목록');
  const { C, S, P, L } = H;
  eq('#C1 사이트 목록 = 화면의 AI_HANDS(id 같은 차례) · 주소(Claude는 PC가 직접)', L.PC_TARGETS.map(t => t.id), P.AI_HANDS.map(h => h.id));
  ok('#C1 주소 = 화면이 여는 주소와 같은 곳', L.PC_TARGETS.every(t => t.id === 'claude' ? t.url === '' : P.AI_HANDS.find(h => h.id === t.id).open === t.url.split('?')[0]));
  const now = Date.parse('2026-11-26T10:00:00Z');
  eq('#C2 PC 확인 글', [C.pcSeenText(0, now), C.pcSeenText(now - 30_000, now), C.pcSeenText(now - 5 * 60_000, now), C.pcSeenText(now - 3 * 3_600_000, now)],
    ['PC가 아직 한 번도 확인하지 않았습니다', 'PC 연결됨 · 방금 확인', 'PC 마지막 확인 5분 전', 'PC 마지막 확인 3시간 전']);
  ok('#C3 기다리는 글 — PC 꺼짐 · 맡김 · 묻는 중 · 오래 걸림', C.pcWaitText('ChatGPT', { st: 'wait' }, now - 10 * 60_000, now).includes('꺼져')
    && C.pcWaitText('ChatGPT', { st: 'wait' }, now - 20_000, now).includes('곧 PC가 가져가') && C.pcWaitText('ChatGPT', { st: 'take', ta: now - 30_000 }, now, now).includes('묻는 중')
    && C.pcWaitText('ChatGPT', { st: 'take', ta: now - 15 * 60_000 }, now, now).includes('15분'));
  eq('#C4 답 모델 글', [C.pcModelLabel('ChatGPT', 'GPT-5'), C.pcModelLabel('Claude', 'Claude'), C.pcModelLabel('Gemini', '')], ['ChatGPT GPT-5 · 내 PC가 물어 옴', 'Claude · 내 PC가 물어 옴', 'Gemini · 내 PC가 물어 옴']);
  const chats = [{ id: 'c1', msgs: [{ id: 'u', role: 'user', text: 'q' }, { id: 'm1', role: 'model', text: '', err: 'pc', via: 'pc:gemini', job: 'abcdefghijkl1234', at: '2026-11-26T09:59:00.000Z' }, { id: 'm2', role: 'model', text: '', err: 'pc', job: '' }, { id: 'm3', role: 'model', text: 'x', err: 'hand' }] }];
  eq('#C5 기다리는 자리 = err pc + 번호', C.pcPending(chats), [{ chatId: 'c1', msgId: 'm1', job: 'abcdefghijkl1234', at: '2026-11-26T09:59:00.000Z', hid: 'gemini' }]);
  eq('#C6 확인 간격 — 막 맡겼으면 4초 · 아니면 10초 · 3시간 지나면 그만', [C.pcPollDelay([{ at: '2026-11-26T09:59:00.000Z' }], now), C.pcPollDelay([{ at: '2026-11-26T09:50:00.000Z' }], now), C.pcTooLate('2026-11-26T06:59:00.000Z', now), C.pcTooLate('2026-11-26T07:01:00.000Z', now)], [4000, 10000, true, false]);
  const n = S.normalizeSearchStore({ pcOn: 1, chats: [{ id: 'c1', updatedAt: '2026-11-26T09:59:00.000Z', msgs: [{ id: 'u', role: 'user', text: 'q' }, { id: 'm1', role: 'model', text: '', err: 'pc', via: 'pc:gemini', job: 'abcdefghijkl1234' }, { id: 'u2', role: 'user', text: 'q2' }, { id: 'm2', role: 'model', text: '', err: 'pc', via: 'pc:chatgpt', job: '' }] }] });
  const ms = n.chats[0].msgs;
  eq('#C7 저장 — PC 자동 켬 · 기다리는 자리는 번호와 함께 남는다 · 번호 없이 저장되면 실패로', [n.pcOn, ms[1].err, ms[1].job, ms[1].via, ms[3].err, ms[3].msg, 'job' in ms[3]], [true, 'pc', 'abcdefghijkl1234', 'pc:gemini', 'pcfail', 'PC에 맡기지 못했습니다', false]);
  eq('#C8 기다리는 자리·실패는 다음 질문의 맥락에서 뺀다', S.requestMessages(ms), [{ role: 'user', text: 'q' }, { role: 'user', text: 'q2' }]);
  ok('#C9 오류 글 — 연결 안 됨·바쁨·하루·늦음', ['nopc', 'busy', 'day', 'late', 'gone'].every(c => C.pcAskErrorText(c) !== C.pcAskErrorText('zzz')));
}

console.log('\n[파트④] 소스 가드');
const chat = stripComments(read('src/components/AiSearchChat.tsx'));
const srvA = stripComments(read('api/pc-ask.ts'));
const srvJ = stripComments(read('api/pc-job.ts'));
const lib = stripComments(read('api/_pcAsk.ts'));
const cl = stripComments(read('src/pcAsk.ts'));
ok('#S1 화면 → /api/pc-ask 하나(우편함) · 맡기기 본문 = AI 이름 + 넘길 글(handPrompt — 보유 종목은 켰을 때 이름만)',
  /fetch\('\/api\/pc-ask', \{ method: 'POST'/.test(chat) && /pcCall\(\{ op: 'ask', target: hid, prompt \}\)/.test(chat) && /const prompt = handPromptOf\(text, base\);/.test(chat));
ok('#S2 PC 열쇠·연결 문구는 저장하지 않는다(대화 묶음·Drive·브라우저 저장소에 넣지 않음 — 만든 그때 한 번만 보여 줌)',
  /setPcSetup\(\{ text: pcTaskPrompt\(window\.location\.origin, r\.key\) \}\)/.test(chat) && !/pcSetup[^\n]*setStore|setStore[^\n]*pcSetup|localStorage|sessionStorage/.test(chat)
  && !/\bkey\b/.test(stripComments(read('src/aiSearch.ts')).slice(stripComments(read('src/aiSearch.ts')).indexOf('export function normalizeSearchStore'), stripComments(read('src/aiSearch.ts')).indexOf('export function trimSearchStore'))));
ok('#S3 관리자 접속 중엔 PC 자동을 숨긴다(관리자 우편함을 쓰지 않게)', /const pcActive = !viewingAs && /.test(chat) && /const pcSettings = viewingAs \? null : \(/.test(chat)
  && /\{!viewingAs && <button onClick=\{togglePc\}/.test(chat) && /if \(!text \|\| running \|\| !s \|\| viewingAs\) return;/.test(chat));
ok('#S4 답 기다리기 — 저장된 번호(pcPending)로 · 끝난 답만 넣고 실패·취소·없어짐·3시간은 실패 글', /const pcPendKey = store && !viewingAs \? pcPending\(store\.chats\)/.test(chat)
  && /if \(j && j\.st === 'done' && j\.a\) \{/.test(chat) && /pcTooLate\(p\.at\)/.test(chat) && /\}, \[pcPendKey\]\);/.test(chat));
ok('#S5 PC 자동이 켜져 있으면 AI 이름 = 맡기기, 꺼져 있으면 그대로 사이트 열기', /onClick=\{\(\) => \(pcActive \? askPc\(h\.id, draft\) : askHand\(h\.id, draft\)\)\}/.test(chat));
ok('#S6 서버 창 쪽 — 첫 줄 requireAuth · 사용자 = 로그인 토큰 이메일(본문의 이메일을 믿지 않음)', /export default async function handler\(request: Request\): Promise<Response> \{\s*const denied = await requireAuth\(request\);\s*if \(denied\) return denied;/.test(srvA)
  && /const email = await callerEmail\(request\);/.test(srvA) && /const u = await userTag\(email\);/.test(srvA) && !/b\?\.email|body\.email/.test(srvA));
ok('#S7 서버 PC 쪽 — 첫 줄 requirePcKey · 사용자 = 열쇠 앞부분(해시가 맞을 때만 여기까지 온다) · CORS 없음',
  /export default async function handler\(request: Request\): Promise<Response> \{\s*const denied = await requirePcKey\(request\);\s*if \(denied\) return denied;\s*const u = pcUserOf\(request\);/.test(srvJ) && !/Access-Control/.test(srvJ + lib));
ok('#S8 공용 파일 import 0 · 상대 import는 .js', !/^\s*import\s/m.test(lib) && !/^\s*import\s/m.test(cl) && [...(srvA + srvJ).matchAll(/from '(\.\/[^']+)'/g)].every(m => m[1].endsWith('.js')));
ok('#S9 열쇠 비교는 해시 · 같은 길이 비교(safeEqual)', /safeEqual\(hash, rec\.h\)/.test(lib) && /const hash = await sha256Hex\(k\.r\);/.test(lib));

globalThis.fetch = realFetch;
console.log(`\nverify:pc-ask — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
