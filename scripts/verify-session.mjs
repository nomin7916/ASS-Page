#!/usr/bin/env node
// verify:session — 로그인 유지(사용 중 재로그인 없애기, 2026-11-06 · CLAUDE.md '로그인 유지' 절)
//
// 막는 것: 쓰는 중인데 구글 로그인을 다시 하게 되는 세 길이 되살아나는 것.
//   ① 비활동 자동 로그아웃이 짧거나(옛 50분) 스크롤·읽기·별도 창 작업을 '비활동'으로 세는 것
//   ② 낡은 토큰(1시간짜리)을 클릭 밖에서만 다시 받아 브라우저가 구글 창을 막는 것 — 클릭 안 미리 받기·창이 대신 받기
//   ③ 새로고침 뒤 무음 재인증이 막히면 세션을 지우고 처음 로그인으로 떨어지는 것 — '이어서 사용하기' 버튼
//   파트① src/sessionKeepAlive.ts 직접 import — 판정 함수와 별도 창 중계(installActivityRelay)를 가짜 창으로 실행.
//   파트② 소스 가드 — useDriveSync·App·main·LoginGate·InactivityModal 배선. + 가드 자체의 변이 검출.
// ⚠️ 실패하면 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

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

// ── 파트① 순수 로직 + 중계 실행 ─────────────────────────────
console.log('\n[파트①] sessionKeepAlive.ts 실행');
let K = null;
try { K = await import(pathToFileURL(join(ROOT, 'src/sessionKeepAlive.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 실행 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/sessionKeepAlive.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

const MIN = 60 * 1000, HOUR = 60 * MIN;
if (K) {
  eq('#U1 비활동 자동 로그아웃 = 4시간', K.IDLE_LOGOUT_MS, 4 * HOUR);
  eq('#U1b 안내 문구 4시간', K.idleLogoutLabel(), '4시간');
  eq('#U1c 시간 단위가 아니면 분으로', K.idleLogoutLabel(50 * MIN), '50분');
  ok('#U1d 비활동 시간이 토큰 수명(1시간)보다 길다 — 로그아웃이 토큰 만료를 가리는 안전장치가 아니다',
    K.IDLE_LOGOUT_MS > HOUR);

  const T0 = 1_000_000_000_000;
  eq('#U2 토큰 받은 기록이 없으면 받지 않는다', K.shouldRefreshToken(T0, 0, 0), false);
  eq('#U2b 39분 — 아직', K.shouldRefreshToken(T0 + 39 * MIN, T0, 0), false);
  eq('#U2c 40분 — 다음 클릭에서 받는다', K.shouldRefreshToken(T0 + 40 * MIN, T0, 0), true);
  eq('#U2d 1분 안에 시도했으면 쉰다', K.shouldRefreshToken(T0 + 50 * MIN, T0, T0 + 49.5 * MIN), false);
  eq('#U2e 1분이 지나면 다시', K.shouldRefreshToken(T0 + 50 * MIN, T0, T0 + 49 * MIN), true);
  eq('#U2f 401로 끝난 토큰(TOKEN_DEAD)은 나이와 상관없이', K.shouldRefreshToken(T0, K.TOKEN_DEAD, 0), true);
  ok('#U2g 미리 받기는 만료(60분) 전에 시작한다', K.TOKEN_REFRESH_AGE_MS < HOUR && K.TOKEN_REFRESH_AGE_MS >= 30 * MIN);
  eq('#U3 isTokenStale 39분/40분', [K.isTokenStale(T0 + 39 * MIN, T0), K.isTokenStale(T0 + 40 * MIN, T0)], [false, true]);

  const evs = new Set(K.ACTIVITY_EVENTS);
  ok('#U4 조작 목록: 클릭·키·터치 + 스크롤·휠·마우스 이동',
    ['mousedown', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'mousemove'].every(x => evs.has(x)));

  eq('#U5 parseTokenWanted 정상', K.parseTokenWanted({ type: K.TOKEN_WANTED_MSG, hint: 'a@b.c', clientId: 'cid', scope: 's' }),
    { hint: 'a@b.c', clientId: 'cid', scope: 's' });
  eq('#U5b 빈 칸·다른 type은 거부', [
    K.parseTokenWanted({ type: K.TOKEN_WANTED_MSG, hint: '', clientId: 'cid', scope: 's' }),
    K.parseTokenWanted({ type: 'x', hint: 'a', clientId: 'b', scope: 'c' }),
    K.parseTokenWanted(null),
  ], [null, null, null]);
  eq('#U5c freshTokenOf', [K.freshTokenOf({ type: K.TOKEN_FRESH_MSG, token: 'tk' }), K.freshTokenOf({ type: K.TOKEN_FRESH_MSG, token: 3 }), K.freshTokenOf({ type: 'x', token: 'tk' })], ['tk', '', '']);
  eq('#U5d isActivityMessage', [K.isActivityMessage({ type: K.ACTIVITY_MSG }), K.isActivityMessage({ type: 'card:activity' }), K.isActivityMessage('app:activity')], [true, false, false]);

  // ── 가짜 창으로 중계 실행 ──
  const ORIGIN = 'https://site.example';
  const mkWin = () => {
    const ls = {};
    const opener = { closed: false, posted: [], postMessage(msg, origin) { this.posted.push({ msg, origin }); } };
    const gis = { inits: [], requests: [] };
    const win = {
      opener,
      location: { origin: ORIGIN },
      navigator: { userActivation: { isActive: true } },
      google: { accounts: { oauth2: { initTokenClient(cfg) { gis.inits.push(cfg); return { requestAccessToken(o) { gis.requests.push(o); } }; } } } },
      addEventListener(t, fn) { (ls[t] ||= []).push(fn); },
      removeEventListener(t, fn) { ls[t] = (ls[t] || []).filter(f => f !== fn); },
      fire(t, e = {}) { (ls[t] || []).slice().forEach(f => f(e)); },
      count(t) { return (ls[t] || []).length; },
    };
    return { win, opener, gis };
  };

  {
    let now = T0;
    const { win, opener } = mkWin();
    const off = K.installActivityRelay(win, () => now);
    win.fire('wheel');
    eq('#R1 조작하면 opener에게 app:activity(같은 출처)', opener.posted.map(p => [p.msg.type, p.origin]), [[K.ACTIVITY_MSG, ORIGIN]]);
    now += 5000; win.fire('mousemove'); win.fire('keydown');
    eq('#R1b 10초 안에는 한 번만', opener.posted.length, 1);
    now += 5000; win.fire('scroll');
    eq('#R1c 10초가 지나면 다시', opener.posted.length, 2);
    now += 20000;
    const child = {};
    win.fire('message', { origin: ORIGIN, source: child, data: { type: K.ACTIVITY_MSG } });
    eq('#R2 자식 창의 활동 신호를 위로 전달', opener.posted.length, 3);
    now += 20000;
    win.fire('message', { origin: 'https://evil.example', source: child, data: { type: K.ACTIVITY_MSG } });
    win.fire('message', { origin: ORIGIN, source: opener, data: { type: K.ACTIVITY_MSG } });
    eq('#R2b 다른 출처·opener 자신의 신호는 전달하지 않는다', opener.posted.length, 3);
    opener.closed = true; win.fire('pointerdown');
    eq('#R3 opener가 닫혔으면 보내지 않는다', opener.posted.length, 3);
    opener.closed = false;
    off();
    eq('#R4 해제하면 리스너가 모두 빠진다', K.ACTIVITY_EVENTS.map(t => win.count(t)).concat([win.count('message'), win.count('click')]).every(n => n === 0), true);
  }

  {
    let now = T0;
    const { win, opener, gis } = mkWin();
    K.installActivityRelay(win, () => now);
    const wanted = { type: K.TOKEN_WANTED_MSG, hint: 'me@x.com', clientId: 'CID', scope: 'SCOPE' };
    win.fire('click');
    eq('#T1 부탁이 없으면 클릭해도 구글 창을 열지 않는다', gis.requests.length, 0);
    win.fire('message', { origin: ORIGIN, source: {}, data: wanted });
    win.fire('click');
    eq('#T1b opener가 아닌 곳의 부탁은 무시', gis.requests.length, 0);
    win.fire('message', { origin: ORIGIN, source: opener, data: wanted });
    win.navigator.userActivation.isActive = false;
    win.fire('click');
    eq('#T2 클릭 권한을 이미 썼으면(isActive=false) 미룬다', gis.requests.length, 0);
    win.navigator.userActivation.isActive = true;
    win.fire('click');
    eq('#T3 opener 부탁 + 클릭 → 구글 토큰 요청(무음 prompt)', gis.requests, [{ prompt: '' }]);
    const cfg = gis.inits[0] || {};
    eq('#T3b 계정·앱·범위는 opener가 보낸 그대로', [cfg.client_id, cfg.scope, cfg.login_hint], ['CID', 'SCOPE', 'me@x.com']);
    ok('#T3c 실패 콜백이 있다(막힘·닫힘에도 멈추지 않는다)', typeof cfg.error_callback === 'function');
    const before = opener.posted.length;
    cfg.callback({ access_token: 'NEW' });
    const last = opener.posted[opener.posted.length - 1];
    eq('#T4 받은 토큰을 opener에게 app:tokenFresh로', [opener.posted.length - before, last.msg, last.origin], [1, { type: K.TOKEN_FRESH_MSG, token: 'NEW' }, ORIGIN]);
    cfg.callback({ error: 'access_denied' });
    eq('#T4b 오류 응답은 보내지 않는다', opener.posted.length - before, 1);
    win.fire('click');
    eq('#T5 한 번 쓴 부탁은 비운다', gis.requests.length, 1);
    win.fire('message', { origin: ORIGIN, source: opener, data: wanted });
    now += 30 * 1000; win.fire('click');
    eq('#T5b 1분 안에는 다시 열지 않는다', gis.requests.length, 1);
    now += 31 * 1000; win.fire('click');
    eq('#T5c 1분이 지나면 다시', gis.requests.length, 2);
  }
}

// ── 파트② 소스 가드 ─────────────────────────────────────────
console.log('\n[파트②] 소스 가드');

const SRC = {
  ds: stripComments(read('src/hooks/useDriveSync.ts')),
  app: stripComments(read('src/App.tsx')),
  main: stripComments(read('src/main.tsx')),
  gate: stripComments(read('src/components/LoginGate.tsx')),
  modal: stripComments(read('src/components/InactivityModal.tsx')),
  ka: read('src/sessionKeepAlive.ts'),
};

const sliceFrom = (src, marker, len) => { const i = src.indexOf(marker); return i < 0 ? '' : src.slice(i, i + len); };

const GUARDS = [
  ['#S0 sessionKeepAlive.ts는 import 0', (s) => !/^\s*import\s/m.test(s.ka)],
  ['#S1 비활동 타임아웃이 IDLE_LOGOUT_MS이고 옛 50분 숫자가 없다',
    (s) => /const TIMEOUT = IDLE_LOGOUT_MS;/.test(s.ds) && !/50 \* 60 \* 1000/.test(s.ds)
      && /import \{[^}]*\bIDLE_LOGOUT_MS\b[^}]*\} from '\.\.\/sessionKeepAlive';/.test(s.ds)],
  ['#S2 클릭 안 미리 받기 — window click · 관리자 접속 제외 · 대기 중 제외 · 판정 · 클릭 권한 확인 · 무음 요청',
    (s) => {
      const b = sliceFrom(s.ds, 'const onClick = () => {', 900);
      return b.length > 100
        && /if \(adminViewingAsRef\.current\) return;/.test(b)
        && /if \(!client \|\| pendingTokenResolveRef\.current\) return;/.test(b)
        && /if \(!shouldRefreshToken\(now, tokenIssuedAtRef\.current, tokenTryAtRef\.current\)\) return;/.test(b)
        && /if \(ua && !ua\.isActive\) return;/.test(b)
        && /client\.requestAccessToken\(\{ prompt: '' \}\);/.test(b)
        && /window\.addEventListener\('click', onClick\);/.test(s.ds)
        && /import \{[^}]*\bshouldRefreshToken\b[^}]*\} from '\.\.\/sessionKeepAlive';/.test(s.ds);
    }],
  ['#S3 재발급 콜백이 setFreshToken으로 토큰·받은 시각·밀린 저장을 한 곳에서',
    (s) => /\} else \{\s*setFreshToken\(t\);\s*\}/.test(s.ds)
      && /const setFreshToken = \(t: string\) => \{\s*tokenIssuedAtRef\.current = Date\.now\(\);\s*driveTokenRef\.current = t;/.test(s.ds)
      && /if \(saveAfterTokenRef\.current\) \{\s*saveAfterTokenRef\.current = false;/.test(s.ds)],
  ['#S4 저장 401 + 재발급 실패 → 밀린 저장 표시 · 토큰 끝남 표시 · 다음 클릭 바로 시도',
    (s) => /setDriveStatus\('auth_needed'\);\s*saveAfterTokenRef\.current = true;\s*tokenIssuedAtRef\.current = TOKEN_DEAD;\s*tokenTryAtRef\.current = 0;/.test(s.ds)],
  ['#S4b 불러오기 401 실패도 토큰 끝남 표시',
    (s) => /tokenIssuedAtRef\.current = TOKEN_DEAD;\s*setDriveStatus\('auth_needed'\);/.test(s.ds)],
  ['#S5 재발급 클라이언트가 로그인 계정을 힌트로(관리자 접속 탭은 제외) · 범위는 LOGIN_SCOPE',
    (s) => /\.\.\.\(!adminViewingAsRef\.current && authUser\?\.email \? \{ login_hint: authUser\.email, hint: authUser\.email \} : \{\}\),/.test(s.ds)
      && /scope: LOGIN_SCOPE,/.test(s.ds)],
  ['#S6 창이 넘긴 토큰 반영 — 관리자 접속 제외 · 대기자 끝냄',
    (s) => /const adoptFreshToken = \(t: string\) => \{\s*if \(!t \|\| adminViewingAsRef\.current\) return;\s*setFreshToken\(t\);/.test(s.ds)
      && /adoptFreshToken,\s*tokenIsStale,/.test(s.ds)],
  ['#S7 앱 탭이 ACTIVITY_EVENTS 전부를 document 캡처로 센다',
    (s) => /ACTIVITY_EVENTS\.forEach\(ev => document\.addEventListener\(ev, handler, opts\)\);/.test(s.app)
      && /const opts = true;/.test(s.app)],
  ['#S8 앱 탭이 창의 app:activity로 비활동을 미루고(경고 중이면 계속 사용), 토큰이 낡았으면 tokenWanted로 답한다',
    (s) => {
      const b = sliceFrom(s.app, 'if (isActivityMessage(e.data)) {', 600);
      return /if \(showInactivityWarning\) handleInactivityContinue\(\); else resetActivity\(\);/.test(b)
        && /if \(tokenIsStale\(\) && e\.source\)/.test(b)
        && /type: TOKEN_WANTED_MSG, hint: authUser\.email, clientId: GOOGLE_CLIENT_ID, scope: LOGIN_SCOPE/.test(b)
        && /if \(e\.origin !== window\.location\.origin\) return;/.test(s.app);
    }],
  ['#S9 창이 넘긴 토큰은 계정 확인 뒤에만 쓴다',
    (s) => /const fresh = freshTokenOf\(e\.data\);\s*if \(!fresh \|\| adminViewingAsRef\.current\) return;\s*fetchUserEmail\(fresh\)\.then\(\(email\) => \{\s*if \(email && email\.toLowerCase\(\) === me && !adminViewingAsRef\.current\) adoptFreshToken\(fresh\);/.test(s.app)
      && /import \{[^}]*\bACTIVITY_EVENTS\b[^}]*\bLOGIN_SCOPE\b[^}]*\bTOKEN_WANTED_MSG\b[^}]*\bisActivityMessage\b[^}]*\bfreshTokenOf\b[^}]*\} from '\.\/sessionKeepAlive';/.test(s.app)
      && /initTokenClient, adoptFreshToken, tokenIsStale, checkAndSyncFromDrive,/.test(s.app)],
  ['#S10 별도 창 전부에 중계를 설치한다(main.tsx)',
    (s) => /if \(SEPARATE_WINDOW_BOOT\) installActivityRelay\(window\)/.test(s.main)
      && /import \{ installActivityRelay \} from '\.\/sessionKeepAlive'/.test(s.main)],
  ['#S11 새로고침 무음 재인증 실패는 세션을 지우지 않고 \'이어서 사용하기\'로',
    (s) => {
      const b = sliceFrom(s.gate, 'onFail: (detail) => {', 200);
      return /if \(!silent\) setErrorMsg\(describeAuthError\(detail\)\);\s*setStep\('resume'\);/.test(b)
        && !/removeItem\(SESSION_KEY\)/.test(b)
        && /resumeSession\(savedEmail, true\);/.test(s.gate)
        && /onClick=\{\(\) => resumeSession\(userEmail, false\)\}/.test(s.gate)
        && /\{step === 'resume' && \(/.test(s.gate);
    }],
  ['#S12 LoginGate의 로그인 범위 글자가 LOGIN_SCOPE와 같다(두 곳)',
    (s) => {
      const m = s.ka.match(/export const LOGIN_SCOPE = '([^']+)';/);
      if (!m) return false;
      const lit = `scope: '${m[1]}'`;
      return s.gate.split(lit).length - 1 === 2;
    }],
  ['#S14 본인 로그인은 비밀번호 화면 없이 바로 진입(PIN 해시는 계속 싣는다) · 관리자 접속만 비밀번호 화면',
    (s) => {
      const a = s.gate.indexOf('const handleLogin = () => {');
      const z = s.gate.indexOf('const handlePinSubmit = ');
      const login = a >= 0 && z > a ? s.gate.slice(a, z) : '';
      const imp = sliceFrom(s.gate, 'loadDriveFile(adminViewUserCtx.adminToken, adminViewUserCtx.userFolderId, DRIVE_FILES.PIN)', 900);
      return login.length > 500
        && /sessionStorage\.setItem\(SESSION_KEY, email\);\s*onApproved\(email, token, pickFeatures\(checkRes\)\);/.test(login)
        && !/setStep\('pin_entry'\)/.test(login)
        && /await loadPinFromDrive\(token, email\)/.test(login)
        && /sessionStorage\.setItem\(PIN_KEY\(email\), drivePinHash\);/.test(login)
        && /sessionStorage\.setItem\(PIN_KEY\(email\), adminHash\);/.test(login)
        && /featuresRef\.current = pickFeatures\(res\);\s*setStep\('pin_entry'\);/.test(imp)
        && /adminViewUserCtx\.adminPinHash === hashPin\(finalPin\)/.test(s.gate)
        && /\{step === 'pin_entry' && \(/.test(s.gate);
    }],
  ['#S13 안내창 문구가 idleLogoutLabel에서 온다(옛 50분 글자 없음)',
    (s) => /\{idleLogoutLabel\(\)\} 동안 사용이 없어/.test(s.modal) && !/50분/.test(s.modal)
      && /import \{ idleLogoutLabel \} from '\.\.\/sessionKeepAlive';/.test(s.modal)],
];

for (const [name, fn] of GUARDS) ok(name, fn(SRC));

// ── 가드 변이 검출 — 하나씩 깨뜨려 해당 가드가 떨어지는지 ──
console.log('\n[파트②-변이] 가드가 실제로 잡는가');
const MUTANTS = [
  ['#S1', 'ds', 'const TIMEOUT = IDLE_LOGOUT_MS;', 'const TIMEOUT = 50 * 60 * 1000;'],
  ['#S2', 'ds', 'if (ua && !ua.isActive) return;', ''],
  ['#S2', 'ds', "window.addEventListener('click', onClick);", "window.addEventListener('keydown', onClick);"],
  ['#S3', 'ds', '} else {\n              setFreshToken(t);\n            }', '} else {\n              driveTokenRef.current = t;\n            }'],
  ['#S4', 'ds', 'saveAfterTokenRef.current = true;', ''],
  ['#S5', 'ds', '{ login_hint: authUser.email, hint: authUser.email }', '{}'],
  ['#S6', 'ds', 'if (!t || adminViewingAsRef.current) return;\n    setFreshToken(t);', 'setFreshToken(t);'],
  ['#S7', 'app', 'ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, handler, opts));', "document.addEventListener('mousedown', handler, opts);"],
  ['#S8', 'app', 'if (tokenIsStale() && e.source)', 'if (false)'],
  ['#S9', 'app', 'email.toLowerCase() === me && ', ''],
  ['#S10', 'main', 'if (SEPARATE_WINDOW_BOOT) installActivityRelay(window)', ''],
  ['#S11', 'gate', "if (!silent) setErrorMsg(describeAuthError(detail));\n        setStep('resume');", "sessionStorage.removeItem(SESSION_KEY);\n        setStep('idle');"],
  ['#S13', 'modal', '{idleLogoutLabel()} 동안', '50분간'],
  ['#S14', 'gate', 'sessionStorage.setItem(SESSION_KEY, email);\n        onApproved(email, token, pickFeatures(checkRes));', "setStep('pin_entry');"],
  ['#S14', 'gate', 'sessionStorage.setItem(PIN_KEY(email), drivePinHash);', ''],
  ['#S14', 'gate', "featuresRef.current = pickFeatures(res);\n        setStep('pin_entry');", 'featuresRef.current = pickFeatures(res);\n        onApproved(adminViewUserCtx.userEmail, adminViewUserCtx.adminToken, featuresRef.current);'],
  ['#S14', 'gate', 'adminViewUserCtx.adminPinHash === hashPin(finalPin)', 'false'],
];
for (const [gid, key, from, to] of MUTANTS) {
  const guard = GUARDS.find(g => g[0].startsWith(gid + ' '));
  if (!SRC[key].includes(from)) { ok(`${gid} 변이 대상이 원본에 있다 (${from.slice(0, 40)}…)`, false); continue; }
  const mutated = { ...SRC, [key]: SRC[key].replace(from, to) };
  ok(`${gid} 변이 검출 — ${from.slice(0, 50).replace(/\n\s*/g, ' ')}…`, guard && !guard[1](mutated));
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
