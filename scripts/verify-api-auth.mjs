#!/usr/bin/env node
// verify:api-auth — 서버 경로(/api/…) 로그인 확인 (2026-11-05, CLAUDE.md '서버 경로 로그인 확인' 절)
//
// 막는 것: 주소만 알면 누구나 /api/…를 불러 관리자의 KIS·FRED·ECOS·구글 키 한도를 소모하던 구멍이 다시 열리는 것.
//   파트① 소스 가드 — 모든 경로가 처리부 첫 줄에서 requireAuth를 부르는가(열린 경로는 목록에 있는 것만),
//          서버끼리 부르는 /api/fred에 내부 키가 실리는가, 클라이언트 관문이 렌더 전에 설치되고 별도 창이 전부 'window'인가,
//          클라이언트·서버의 헤더 이름·CLIENT_ID·열린 경로 목록이 같은가. + 가드 자체의 변이 검출.
//   파트② api/_auth.ts 직접 import(타입 스트리핑) — tokeninfo를 가짜 fetch로 바꿔 통과·거부·캐시·내부 키를 실행으로 확인.
//   파트③ src/apiAuth.ts를 창마다 따로 실행(타입 제거 후 window를 주입) — 앱 탭·별도 창·창의 창 사이 토큰 전달과
//          401 무음 재발급 1회를 실제 postMessage 순서대로 확인.
// ⚠️ 실패하면 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${g}\n      want: ${w}`); }
};

// 토큰 확인 없이 열어 두는 경로 — 로그인 화면에서도 부르고 비밀 키를 쓰지 않는다(연도 범위는 서버가 묶는다)
const OPEN_ROUTES = ['market-calendar'];
// 서버 내부 호출(내부 키)을 받는 경로
const INTERNAL_ROUTES = ['fred'];

// ── 파트① 소스 가드 ─────────────────────────────────────────
console.log('\n[파트①] 소스 가드');

const HANDLER_RE = /export default async function handler\((\w+): Request\): Promise<Response> \{\n\s*const denied = await requireAuth\(\1(, \{ allowInternal: true \})?\);\n\s*if \(denied\) return denied;\n/;
const IMPORT_RE = /^import \{[^}]*\brequireAuth\b[^}]*\} from '\.\/_auth\.js';$/m;

function routeProblems(name, src) {
  const out = [];
  if (OPEN_ROUTES.includes(name)) {
    if (/requireAuth/.test(src)) out.push('열린 경로인데 requireAuth를 부른다(목록과 어긋남)');
    return out;
  }
  if (!IMPORT_RE.test(src)) out.push("import { requireAuth } from './_auth.js' 없음");
  const m = src.match(HANDLER_RE);
  if (!m) out.push('처리부 첫 줄이 requireAuth가 아니다');
  else if (!!m[2] !== INTERNAL_ROUTES.includes(name)) out.push(`allowInternal 사용이 목록과 다르다(${!!m[2]})`);
  if ((src.match(/export default/g) || []).length !== 1) out.push('export default가 하나가 아니다');
  return out;
}

const routeFiles = readdirSync(join(ROOT, 'api')).filter(f => f.endsWith('.ts') && !f.startsWith('_')).sort();
const routeNames = routeFiles.map(f => f.replace(/\.ts$/, ''));
ok(`경로 파일 수집(${routeFiles.length}개)`, routeFiles.length >= 10);
for (const name of OPEN_ROUTES) ok(`열린 경로 ${name}가 실제로 있다`, routeNames.includes(name));
const SRC = {};
for (const f of routeFiles) {
  const name = f.replace(/\.ts$/, '');
  SRC[name] = read(`api/${f}`);
  const probs = routeProblems(name, SRC[name]);
  ok(`api/${f} ${OPEN_ROUTES.includes(name) ? '열린 경로' : '처리부 첫 줄 requireAuth'}${probs.length ? ' — ' + probs.join(' · ') : ''}`, probs.length === 0);
}

// 서버끼리 부르는 같은 배포의 /api/… — 내부 키를 실어야 /api/fred가 받는다
const selfCalls = [];
for (const f of routeFiles) {
  read(`api/${f}`).split('\n').forEach((line, i) => {
    if (/fetch\(`\$\{\w+\}\/api\//.test(line)) selfCalls.push({ f, i: i + 1, line });
  });
}
ok(`서버 내부 호출 수집(${selfCalls.length}건: ${selfCalls.map(c => `${c.f}:${c.i}`).join(', ')})`, selfCalls.length >= 2);
for (const c of selfCalls) {
  ok(`${c.f}:${c.i} 내부 호출에 internalAuthHeaders`, /headers: await internalAuthHeaders\(\)/.test(c.line));
  const target = (c.line.match(/\/api\/([\w-]+)/) || [])[1];
  ok(`${c.f}:${c.i} 내부 호출 대상(${target})이 내부 키를 받는 경로`, INTERNAL_ROUTES.includes(target));
  ok(`${c.f} internalAuthHeaders import`, /^import \{[^}]*\binternalAuthHeaders\b[^}]*\} from '\.\/_auth\.js';$/m.test(read(`api/${c.f}`)));
}

const authSrc = read('api/_auth.ts');
const clientSrc = read('src/apiAuth.ts');
const serverClientId = (authSrc.match(/export const CLIENT_ID = '([^']+)'/) || [])[1];
const appClientId = (read('src/config.ts').match(/export const GOOGLE_CLIENT_ID = '([^']+)'/) || [])[1];
ok('CLIENT_ID = src/config.ts GOOGLE_CLIENT_ID', !!serverClientId && serverClientId === appClientId);
const serverHeader = (authSrc.match(/export const AUTH_HEADER = '([^']+)'/) || [])[1];
const clientHeader = (clientSrc.match(/export const AUTH_HEADER = '([^']+)'/) || [])[1];
ok('토큰 헤더 이름이 서버·클라이언트에서 같다', !!serverHeader && serverHeader.toLowerCase() === String(clientHeader).toLowerCase());
ok('토큰 헤더가 Authorization이 아니다(Vercel CDN 캐시 유지)', String(serverHeader).toLowerCase() !== 'authorization');
const clientOpen = JSON.parse(((clientSrc.match(/export const OPEN_PATHS = (\[[^\]]*\]);/) || [])[1] || 'null').replace(/'/g, '"'));
eq('클라이언트 OPEN_PATHS = 서버 열린 경로', clientOpen, OPEN_ROUTES.map(n => `/api/${n}`));
ok('_auth.ts import 0건(직접 import 가능)', !/^import /m.test(authSrc));
ok('apiAuth.ts import 0건(창마다 따로 실행)', !/^import /m.test(clientSrc));
ok('apiAuth.ts 브라우저 저장소 미사용', !/localStorage|sessionStorage|indexedDB/.test(clientSrc));
ok('401·503 응답은 캐시 금지(no-store)', /'Cache-Control': 'no-store'/.test(authSrc));

const mainSrc = read('src/main.tsx');
ok("main.tsx installApiAuth import", /^import \{ installApiAuth \} from '\.\/apiAuth'$/m.test(mainSrc));
const installAt = mainSrc.indexOf('installApiAuth(SEPARATE_WINDOW_BOOT');
ok('main.tsx 렌더 전에 installApiAuth', installAt > 0 && installAt < mainSrc.indexOf('createRoot('));
const bootConsts = [...mainSrc.matchAll(/^const (\w+_WINDOW_BOOT) = /gm)].map(m => m[1]).filter(n => n !== 'SEPARATE_WINDOW_BOOT');
const sepExpr = (mainSrc.match(/const SEPARATE_WINDOW_BOOT = ([\s\S]*?)\ninstallApiAuth/) || [])[1] || '';
ok(`별도 창 ${bootConsts.length}종이 전부 'window' 모드`, bootConsts.length >= 8 && bootConsts.every(n => new RegExp(`\\b${n}\\b`).test(sepExpr)));
const appSrc = read('src/App.tsx');
ok("App.tsx registerApiAuth import", /^import \{ registerApiAuth \} from '\.\/apiAuth';$/m.test(appSrc));
ok('App.tsx 로그인 토큰 등록', /registerApiAuth\(\(\) => driveTokenRef\.current, \(\) => new Promise/.test(appSrc));
ok('App.tsx 재발급이 진행 중인 대기자를 덮지 않는다', /registerApiAuth[\s\S]{0,400}const prev = pendingTokenResolveRef\.current;[\s\S]{0,200}if \(!prev\) client\.requestAccessToken\(\{ prompt: '' \}\)/.test(appSrc));

// 가드 자체의 변이 검출 — 가드가 실제로 빠진 경로를 잡는가
{
  const s = SRC['history'];
  const noCall = s.replace(/  const denied = await requireAuth\(request\);\n  if \(denied\) return denied;\n/, '');
  ok('변이: requireAuth 줄 삭제를 잡는다', routeProblems('history', noCall).length > 0);
  const noImport = s.replace(/^import \{ requireAuth, internalAuthHeaders \} from '\.\/_auth\.js';\n/m, '');
  ok('변이: import 삭제를 잡는다', routeProblems('history', noImport).length > 0);
  const late = s.replace(/(export default async function handler\(request: Request\): Promise<Response> \{\n)/, '$1  const { searchParams } = new URL(request.url);\n');
  ok('변이: 확인 앞에 다른 코드가 끼면 잡는다', routeProblems('history', late).length > 0);
  const internal = s.replace('await requireAuth(request);', 'await requireAuth(request, { allowInternal: true });');
  ok('변이: 내부 키 허용 확대를 잡는다', routeProblems('history', internal).length > 0);
  ok('변이: 열린 경로 목록 밖 경로가 확인을 빼면 잡는다', routeProblems('proxy', SRC['proxy'].replace('const denied = await requireAuth(request);', '')).length > 0);
}

// ── 파트② api/_auth.ts 실행 ─────────────────────────────────
console.log('\n[파트②] api/_auth.ts');

const CID = serverClientId;
const GOOD = 'ya29.good-token-0123456789abcdef';
let tokeninfoCalls = 0;
let tokeninfoMode = {};   // token → 'ok' | 'aud' | 'unverified' | '400' | '500' | 'throw' | 'short'
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.startsWith('https://oauth2.googleapis.com/tokeninfo?access_token=')) throw new Error(`예상 밖 fetch ${u}`);
  tokeninfoCalls++;
  const tok = decodeURIComponent(u.split('access_token=')[1]);
  const m = tokeninfoMode[tok] || '400';
  await new Promise(r => setTimeout(r, 5));
  if (m === 'throw') throw new TypeError('network');
  if (m === '500') return new Response('err', { status: 500 });
  if (m === '400') return new Response('{"error":"invalid_token"}', { status: 400 });
  const info = { aud: m === 'aud' ? 'other.apps.googleusercontent.com' : CID, email: 'User@Example.com',
    email_verified: m === 'unverified' ? 'false' : 'true', expires_in: m === 'short' ? '20' : '3599' };
  return new Response(JSON.stringify(info), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const reqWith = (headers) => new Request('https://site.example/api/history?key=x', { headers });

process.env.KIS_APP_SECRET = 'kis-secret-for-test';
const A = await import(pathToFileURL(join(ROOT, 'api/_auth.ts')).href + '?env=1');
const AUTH = A.AUTH_HEADER;

{
  tokeninfoCalls = 0;
  const r = await A.requireAuth(reqWith({}));
  eq('헤더 없음 → 401', r?.status, 401);
  eq('헤더 없음 → no-store', r?.headers.get('cache-control'), 'no-store');
  eq('헤더 없음 → 구글을 부르지 않는다', tokeninfoCalls, 0);
  const r2 = await A.requireAuth(reqWith({ [AUTH]: 'short' }));
  eq('형식이 틀린 토큰(짧음) → 401 · 구글 미호출', [r2?.status, tokeninfoCalls], [401, 0]);
  const r3 = await A.requireAuth(reqWith({ [AUTH]: 'ya29.<script>alert(1)</script>xxxxxxxx' }));
  eq('형식이 틀린 토큰(문자) → 401 · 구글 미호출', [r3?.status, tokeninfoCalls], [401, 0]);
  const r4 = await A.requireAuth(reqWith({ Authorization: `Bearer ${GOOD}` }));
  eq('Authorization 헤더만 → 401', r4?.status, 401);
}
{
  tokeninfoMode = { [GOOD]: 'ok' };
  tokeninfoCalls = 0;
  eq('맞는 토큰 → 통과(null)', await A.requireAuth(reqWith({ [AUTH]: GOOD })), null);
  eq('같은 토큰 다시 → 캐시(구글 1회)', [await A.requireAuth(reqWith({ [AUTH]: GOOD })), tokeninfoCalls], [null, 1]);
  const T2 = 'ya29.parallel-token-abcdefghijklmn';
  tokeninfoMode[T2] = 'ok';
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => A.requireAuth(reqWith({ [AUTH]: T2 }))));
  eq('동시 5건 → 구글 1회(진행 중 합치기)', [rs.every(r => r === null), tokeninfoCalls], [true, 2]);
}
for (const [mode, label] of [['aud', '다른 앱 토큰(aud)'], ['unverified', '이메일 미확인'], ['400', '구글이 무효라 함'], ['short', '수명 30초 이하']]) {
  const tok = `ya29.case-${mode}-0123456789abcdef`;
  tokeninfoMode[tok] = mode;
  tokeninfoCalls = 0;
  const r = await A.requireAuth(reqWith({ [AUTH]: tok }));
  const again = await A.requireAuth(reqWith({ [AUTH]: tok }));
  eq(`${label} → 401 · 거부도 1분 캐시`, [r?.status, again?.status, tokeninfoCalls], [401, 401, 1]);
}
for (const mode of ['500', 'throw']) {
  const tok = `ya29.case-${mode}-0123456789abcdef`;
  tokeninfoMode[tok] = mode;
  tokeninfoCalls = 0;
  const r = await A.requireAuth(reqWith({ [AUTH]: tok }));
  tokeninfoMode[tok] = 'ok';
  const again = await A.requireAuth(reqWith({ [AUTH]: tok }));
  eq(`구글 확인 불가(${mode}) → 503 · 캐시하지 않고 다음 요청은 다시 확인`, [r?.status, again, tokeninfoCalls], [503, null, 2]);
}
{
  const h = await A.internalAuthHeaders();
  const key = h[A.INTERNAL_HEADER];
  ok('내부 키 = 64자 해시(비밀값 원문 아님)', /^[0-9a-f]{64}$/.test(key || '') && !String(key).includes('kis-secret'));
  tokeninfoCalls = 0;
  eq('내부 키 + allowInternal → 통과 · 구글 미호출', [await A.requireAuth(reqWith(h), { allowInternal: true }), tokeninfoCalls], [null, 0]);
  eq('내부 키만 + allowInternal 없음 → 401', (await A.requireAuth(reqWith(h)))?.status, 401);
  eq('틀린 내부 키 → 401', (await A.requireAuth(reqWith({ [A.INTERNAL_HEADER]: 'f'.repeat(64) }), { allowInternal: true }))?.status, 401);
  eq('틀린 내부 키 + 맞는 토큰 → 통과', await A.requireAuth(reqWith({ [A.INTERNAL_HEADER]: 'x', [AUTH]: GOOD }), { allowInternal: true }), null);
}
{
  for (const k of ['API_INTERNAL_KEY', 'KIS_APP_SECRET', 'FRED_API_KEY', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'ECOS_API_KEY', 'GOOGLE_API_KEY']) delete process.env[k];
  const B = await import(pathToFileURL(join(ROOT, 'api/_auth.ts')).href + '?env=0');
  eq('서버 비밀값이 하나도 없으면 내부 키 없음', await B.internalAuthHeaders(), {});
  eq('그때 빈 내부 키 헤더는 거부', (await B.requireAuth(reqWith({ [B.INTERNAL_HEADER]: '' }), { allowInternal: true }))?.status, 401);
}
globalThis.fetch = realFetch;

// ── 파트③ src/apiAuth.ts — 창마다 따로 실행 ─────────────────
console.log('\n[파트③] src/apiAuth.ts (앱 탭 · 별도 창 · 창의 창)');

const ORIGIN = 'https://ass.example';
const CLIENT_CODE = stripTypeScriptTypes(clientSrc).replace(/^export /gm, '');
const loadClient = (win) => new Function('window', `${CLIENT_CODE}\nreturn { installApiAuth, registerApiAuth, AUTH_HEADER, OPEN_PATHS };`)(win);
const tick = () => new Promise(r => setTimeout(r, 0));

let validTokens = new Set();
let wantMessages = 0;
function makeWin(name) {
  const listeners = new Set();
  const w = {
    name, opener: null, closed: false, calls: [], listeners,
    location: { href: `${ORIGIN}/?${name}=1`, origin: ORIGIN },
    addEventListener: (t, fn) => { if (t === 'message') listeners.add(fn); },
    removeEventListener: (t, fn) => { if (t === 'message') listeners.delete(fn); },
    async fetch(input, init) {
      const req = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input instanceof URL ? input.href : input), ORIGIN), init);
      const tok = req.headers.get('x-app-token');
      w.calls.push({ url: req.url, tok, accept: req.headers.get('accept') });
      const u = new URL(req.url);
      if (u.origin === ORIGIN && u.pathname.startsWith('/api/') && u.pathname !== '/api/market-calendar' && !validTokens.has(tok)) {
        return new Response('{"error":"auth required"}', { status: 401 });
      }
      return new Response('ok', { status: 200 });
    },
  };
  w.mod = loadClient(w);
  return w;
}
function dispatch(target, data, targetOrigin, source) {
  if (targetOrigin !== ORIGIN || target.closed) return;
  const copy = structuredClone(data);
  if (copy?.type === 'apiauth:want') wantMessages++;
  setTimeout(() => { for (const fn of [...target.listeners]) fn({ data: copy, origin: ORIGIN, source }); }, 1);
}
function link(parent, child) {
  const parentHandle = { get closed() { return parent.closed; }, postMessage: (d, o) => dispatch(parent, d, o, childHandle) };
  const childHandle = { get closed() { return child.closed; }, postMessage: (d, o) => dispatch(child, d, o, parentHandle) };
  child.opener = parentHandle;
}

{
  const app = makeWin('app');
  app.mod.installApiAuth('app');
  validTokens = new Set(['tokA']);
  const r0 = await app.fetch('/api/history?key=us10y');
  eq('앱 탭 로그인 전 → 서버를 부르지 않고 401', [r0.status, app.calls.length], [401, 0]);
  await app.fetch('https://api.allorigins.win/raw?url=https%3A%2F%2Fx');
  eq('다른 출처의 /api/… 주소는 그대로(토큰 없음)', [app.calls.length, app.calls[0].tok], [1, null]);
  await app.fetch('/api/market-calendar?yearStart=2025&yearEnd=2031');
  eq('열린 경로(market-calendar)는 로그인 전에도 그대로 · 토큰 없음', [app.calls.length, app.calls[1].tok], [2, null]);

  let token = 'tokA';
  let refreshCalls = 0;
  let refreshTo = 'tokB';
  app.mod.registerApiAuth(() => token, async () => { refreshCalls++; await tick(); token = refreshTo; return refreshTo; });
  const r1 = await app.fetch('/api/proxy?url=x', { headers: { Accept: 'application/json' } });
  const c1 = app.calls.at(-1);
  eq('로그인 뒤 → X-App-Token 탑재 · 기존 헤더 유지', [r1.status, c1.tok, c1.accept], [200, 'tokA', 'application/json']);
  await app.fetch(new URL('/api/indicators', ORIGIN));
  await app.fetch(`${ORIGIN}/api/stock-per?code=005930`);
  await app.fetch(new Request(`${ORIGIN}/api/etf-holdings?code=069500`));
  eq('URL 객체·절대 주소·Request 입력도 토큰 탑재', app.calls.slice(-3).map(c => c.tok), ['tokA', 'tokA', 'tokA']);

  validTokens = new Set(['tokB']);   // tokA 만료
  const before = app.calls.length;
  const rs = await Promise.all([1, 2, 3].map(i => app.fetch(`/api/history?key=k${i}`)));
  eq('만료 → 무음 재발급 1회로 동시 3건 모두 성공', [rs.map(r => r.status), refreshCalls], [[200, 200, 200], 1]);
  eq('재시도는 새 토큰', app.calls.slice(before).filter(c => c.tok === 'tokB').length, 3);

  validTokens = new Set(['tokC']);
  refreshTo = null;
  const n0 = app.calls.length;
  const rf = await app.fetch('/api/history?key=x');
  eq('재발급 실패 → 원래 401 그대로 · 한 번만 보낸다(무한 반복 없음)', [rf.status, app.calls.length - n0, refreshCalls], [401, 1, 2]);

  // 별도 창 — opener(앱 탭)에게 토큰을 받는다
  token = 'tokC'; validTokens = new Set(['tokC']);
  const rate = makeWin('rateWindow');
  link(app, rate);
  rate.mod.installApiAuth('window');
  wantMessages = 0;
  const w1 = await Promise.all([rate.fetch('/api/indicators'), rate.fetch('/api/history?key=krBase')]);
  eq('별도 창 → opener에게 받은 토큰으로 성공 · 요청 1번만', [w1.map(r => r.status), rate.calls.map(c => c.tok), wantMessages], [[200, 200], ['tokC', 'tokC'], 1]);
  await rate.fetch('/api/indicators');
  eq('받은 토큰은 다시 묻지 않는다', wantMessages, 1);

  // 창의 창(관심종목 창 → 종목 차트 창)
  const watch = makeWin('watchlistWindow');
  link(app, watch);
  watch.mod.installApiAuth('window');
  const chart = makeWin('stockChartWindow');
  link(watch, chart);
  chart.mod.installApiAuth('window');
  const w2 = await chart.fetch('/api/us-stock-price?ticker=SCHD');
  eq('창의 창 → 중간 창이 전달해 성공', [w2.status, chart.calls.at(-1).tok], [200, 'tokC']);

  // 앱 탭이 이미 새 토큰을 받은 뒤 창의 토큰이 만료
  token = 'tokD'; validTokens = new Set(['tokD']);
  const rc0 = refreshCalls;
  const w3 = await rate.fetch('/api/indicators');
  eq('창 토큰 만료 → opener의 새 토큰으로 재시도(앱 탭은 재발급하지 않음)', [w3.status, rate.calls.at(-1).tok, refreshCalls - rc0], [200, 'tokD', 0]);
  const w3b = await chart.fetch('/api/history?key=stock');
  eq('창의 창 토큰 만료 → 중간 창이 앱 탭의 새 토큰을 전달', [w3b.status, chart.calls.at(-1).tok, refreshCalls - rc0], [200, 'tokD', 0]);

  // 앱 탭 토큰도 만료 → 창의 요청이 앱 탭 무음 재발급을 끌어낸다
  validTokens = new Set(['tokE']); refreshTo = 'tokE';
  const w4 = await chart.fetch('/api/history?key=worldstock');
  eq('창의 창 만료 → 앱 탭 무음 재발급 1회 → 성공', [w4.status, chart.calls.at(-1).tok, refreshCalls - rc0], [200, 'tokE', 1]);

  // opener 없이 연 창 · opener가 닫힌 창
  const lone = makeWin('rateWindow');
  lone.mod.installApiAuth('window');
  const r5 = await lone.fetch('/api/indicators');
  eq('opener 없는 창 → 서버를 부르지 않고 401', [r5.status, lone.calls.length], [401, 0]);
  const orphan = makeWin('cardWindow');
  link(app, orphan);
  orphan.mod.installApiAuth('window');
  app.closed = true;
  const r6 = await orphan.fetch('/api/proxy?url=x');
  eq('opener가 닫힌 창(받은 토큰 없음) → 401', [r6.status, orphan.calls.length], [401, 0]);
  validTokens = new Set(['tokD', 'tokE']);   // 금리 창이 받아 둔 tokD가 아직 살아 있다
  const r7 = await rate.fetch('/api/indicators');
  eq('opener가 닫혀도 받아 둔 토큰은 계속 쓴다', [r7.status, rate.calls.at(-1).tok], [200, 'tokD']);
  app.closed = false;

  // 다른 출처에서 온 토큰 요청에는 답하지 않는다
  let leaked = false;
  const evil = { postMessage: () => { leaked = true; } };
  for (const fn of app.listeners) fn({ data: { type: 'apiauth:want', id: 'x', stale: '' }, origin: 'https://evil.example', source: evil });
  await new Promise(r => setTimeout(r, 20));
  ok('다른 출처의 apiauth:want에는 답하지 않는다', !leaked);

  // 관리자 접속 탭 — 무음 재발급분이 driveTokenRef가 아니라 관리자 쓰기 토큰 ref로 가서 getter 값이 그대로다
  const adm = makeWin('adminView');
  adm.mod.installApiAuth('app');
  let admTok = 'admOld', admRefresh = 0, admNext = ['admNew1', 'admNew2'];
  adm.mod.registerApiAuth(() => admTok, async () => { admRefresh++; return admNext.shift() || null; });
  validTokens = new Set(['admNew1']);
  const a1 = await adm.fetch('/api/history?key=x');
  const a2 = await adm.fetch('/api/history?key=y');
  eq('관리자 접속: getter가 그대로여도 재발급 토큰을 이어 쓴다', [a1.status, a2.status, adm.calls.at(-1).tok, admRefresh], [200, 200, 'admNew1', 1]);
  validTokens = new Set(['admNew2']);
  const a3 = await adm.fetch('/api/history?key=z');
  eq('관리자 접속: 재발급 토큰도 만료 → 다시 재발급(낡은 getter 값으로 돌아가지 않음)', [a3.status, adm.calls.at(-1).tok, admRefresh], [200, 'admNew2', 2]);
  admTok = 'admBack'; validTokens = new Set(['admBack']);
  const an = adm.calls.length;
  const a4 = await adm.fetch('/api/history?key=w');
  eq('getter가 새 토큰을 받으면 예전 재발급분은 버린다(헛요청 없이 1번)', [a4.status, adm.calls.at(-1).tok, admRefresh, adm.calls.length - an], [200, 'admBack', 2, 1]);

  // 두 번 설치해도 한 번만 감싼다
  const wrapped = app.fetch;
  app.mod.installApiAuth('app');
  ok('installApiAuth 두 번 → 한 번만 감싼다', app.fetch === wrapped);
}

console.log(`\nverify:api-auth — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
