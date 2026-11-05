// ============================================================
//  Google Apps Script — 계정 관리 (arui114501@gmail.com 전용)
//  최종 갱신: 2026-11-05 (보안 강화 — 모든 요청에서 구글 로그인 확인 · 승인 요청은 '대기'로만 · 관리자 전용 동작 잠금)
//
//  [보안 모델 — 2026-11-05]  ⚠️ 이 절의 규칙을 하나라도 빼면 누구나 스스로 승인할 수 있게 된다.
//  - 사이트 코드는 누구나 받을 수 있다 → 이 스크립트 주소도 공개돼 있다고 본다. 문을 지키는 곳은 이 스크립트다.
//  - 모든 요청은 POST 본문의 token(구글 로그인 액세스 토큰)을 구글 tokeninfo로 확인해 '누가 불렀는지'를 안다.
//    이 앱(CLIENT_ID)에서 발급된 토큰이 아니거나 이메일이 확인되지 않았으면 거부한다(authError).
//  - 권한 3단계: 본인(check·requestAccess·clearReset) / 승인 사용자(getSettings·getFeatureLabels·getNotifications)
//    / 관리자(나머지 전부). 이메일은 언제나 토큰에서 꺼낸다 — 본문의 email은 관리자일 때만 따른다.
//  - 승인 요청은 access_requests 시트에 '대기(PENDING)'로만 적고 관리자에게 메일을 보낸다(하루 최대 MAIL_DAILY_CAP통).
//    approved_users에 들어가는 길은 관리자의 approveRequest(또는 관리자가 시트에 직접 입력)뿐이다.
//  - GET은 상태 확인 한 줄만 답한다(사용자 정보는 토큰 없이 절대 내보내지 않는다).
//  - audit_log 시트: 승인 요청·승인·거절·승인 취소·관리자 변경·권한 없는 호출을 남긴다(최근 AUDIT_MAX_ROWS줄).
//
//  [approved_users 시트 열 구성]
//    A(0): reset        — '' | 'RESET' | 'RESET:1234' (PIN 초기화 플래그)
//    B(1): email        — 사용자 이메일
//    C(2): name         — 이름
//    D(3): registeredAt — 가입일
//    E(4): feature1     — 종목 비교 숨김
//    F(5): feature2     — 배당 과세 관리
//    G(6): feature3     — 분배금 현황 숨김
//    H(7): youtubeEnabled  — 유튜브 링크 표시
//    I(8): notebookEnabled — 학습자료 표시
//    J(9): reportEnabled   — 시장동향 리포트 표시
//    K(10): flowEnabled    — 자금 흐름도 표시
//    L(11): backtestEnabled — 백테스트 표시
//    M(12): ledgerEnabled   — 가계부 표시
//    N(13): rateEnabled     — 금리 모니터링 표시
//  ※ E~N 값은 'ON' / 'OFF' 또는 체크박스(TRUE/FALSE) 모두 인식. 비어 있으면 OFF.
//
//  [access_requests 시트]  A=email  B=name  C=requestedAt  D=status(PENDING|REJECTED)  E=decidedAt
//    REJECTED 줄이 남아 있는 동안 그 계정은 다시 요청할 수 없다(관리자 페이지에서 '기록 지우기'로 풀린다).
//  [audit_log 시트]        A=at  B=who  C=action  D=target  E=detail
//
//  [settings 시트: A=key  B=value]
//    youtubeUrl / notebookLinks / reportLinks / youtubeUrlHistory
//    reportLinks 행에는 분배금 현황 사이트 링크 7칸 항목({title, dividendLinks})도 함께 실린다 — 관리자 앱이 자동으로 쓴다
//    dividendLinks — (구) 2026-10-29 전용 키. 앱은 더 이상 쓰지 않고 읽기 폴백만 남았다
//
//  [적용 방법]
//  1. script.google.com → 기존 프로젝트 열기
//  2. 아래 전체 코드로 교체 → [저장]
//  3. 위쪽 함수 선택 칸에서 setupSecurity 선택 → [실행] → 권한 검토 창에서 허용
//     (새로 필요한 권한: 외부 주소 확인(tokeninfo) · 관리자에게 메일 보내기)
//  4. [배포] → [배포 관리] → 연필(수정) → 버전: '새 버전' → [배포]   ※ 주소는 그대로 유지된다
//  5. [배포 관리] 목록에 다른 '활성' 배포가 있으면 전부 [보관] — 옛 버전 코드가 그 주소로 계속 열려 있다
// ============================================================

const SHEET_ID       = '1Fy_LEhXkSNkv1lIihKdoFWu6mopEM00EdpadmTXGeds';
const SHEET_NAME     = 'approved_users';
const SETTINGS_SHEET = 'settings';
const REQUESTS_SHEET = 'access_requests';
const AUDIT_SHEET    = 'audit_log';
const ADMIN_EMAIL    = 'arui114501@gmail.com';
const CLIENT_ID      = '972766008827-am47e7998m6o299d15gkul2p2r5btkff.apps.googleusercontent.com';

const MAX_PENDING     = 30;    // 대기 요청 상한 — 넘으면 새 요청을 받지 않는다(시트 도배 방지)
const MAIL_DAILY_CAP  = 20;    // 관리자 알림 메일 하루 상한(무료 계정 하루 100통 한도 보호)
const AUDIT_MAX_ROWS  = 1000;  // 보안 기록 보관 줄 수
const FEATURE_KEYS    = ['feature1', 'feature2', 'feature3', 'youtubeEnabled', 'notebookEnabled', 'reportEnabled', 'flowEnabled', 'backtestEnabled', 'ledgerEnabled', 'rateEnabled'];
const SETTINGS_KEYS   = { youtubeUrl: true, notebookLinks: true, reportLinks: true, youtubeUrlHistory: true, feature1Label: true, dividendLinks: true };

function doGet(e) {
  return jsonResponse({ status: 'ok' });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (_) {}
  if (!body || typeof body !== 'object') body = {};
  const action = String(body.action || '');

  const caller = verifyCaller(body.token);
  if (!caller) return jsonResponse({ success: false, authError: true, error: 'auth required' });
  const me = caller.email;
  const isAdmin = me === ADMIN_EMAIL;

  // ① 본인 — 승인 전(로그인 화면)에도 부른다. 대상 이메일은 토큰의 이메일(관리자만 남의 것 조회 — 관리자 접속).
  if (action === 'check') return jsonResponse(checkApproval(isAdmin && body.email ? normEmail(body.email) : me));
  if (action === 'requestAccess') return jsonResponse(requestAccess(me));
  if (action === 'clearReset') return jsonResponse(setResetFlag(me, false));

  // ② 승인된 사용자
  if (!isAdmin && !findUserRow(me)) return deny(me, action, '권한 없음(미승인 계정)');
  if (action === 'getSettings') return jsonResponse(getSettings());
  if (action === 'getFeatureLabels') return jsonResponse(getFeatureLabels());
  if (action === 'getNotifications') return jsonResponse(getNotifications(isAdmin ? null : me));

  // ③ 관리자
  if (!isAdmin) return deny(me, action, '권한 없음(관리자 전용)');
  switch (action) {
    case 'listUsers':              return jsonResponse(listUsers());
    case 'listRequests':           return jsonResponse(listRequests());
    case 'approveRequest':         return jsonResponse(approveRequest(normEmail(body.email)));
    case 'rejectRequest':          return jsonResponse(rejectRequest(normEmail(body.email)));
    case 'deleteRequest':          return jsonResponse(deleteRequest(normEmail(body.email)));
    case 'removeUser':             return jsonResponse(removeUser(normEmail(body.email)));
    case 'setSettings':            return jsonResponse(setSettings(String(body.key || ''), body.value));
    case 'setUserFeature':         return jsonResponse(setUserFeature(normEmail(body.email), String(body.feature || ''), body.value));
    case 'sendNotification':       return jsonResponse(sendNotification(String(body.targetEmail || '__all__'), String(body.message || ''), String(body.type || 'info')));
    case 'deleteNotification':     return jsonResponse(deleteNotification(String(body.notifId || '')));
    case 'deleteAllNotifications': return jsonResponse(deleteAllNotifications(String(body.targetEmail || '__all__')));
    case 'listAudit':              return jsonResponse(listAudit(Number(body.limit) || 50));
  }
  return jsonResponse({ success: false, error: 'unknown action: ' + action });
}

// ──────────────────────────────────────────────────────────
// 호출자 확인 — 구글 tokeninfo (결과는 토큰 해시 키로 최대 10분 캐시)
// ──────────────────────────────────────────────────────────

function verifyCaller(token) {
  token = String(token || '');
  if (token.length < 20 || token.length > 4096) return null;
  const cache = CacheService.getScriptCache();
  const key = 'tok:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return { email: hit };
  let info;
  try {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    info = JSON.parse(res.getContentText());
  } catch (_) { return null; }
  if (!info || info.aud !== CLIENT_ID) return null;          // 다른 앱에서 받은 토큰 거부
  if (String(info.email_verified) !== 'true') return null;
  const email = normEmail(info.email);
  if (!isSafeEmail(email)) return null;                      // '='·'+' 등으로 시작하면 시트 수식으로 실행될 수 있다
  const left = Number(info.expires_in) || 0;
  if (left <= 0) return null;
  const ttl = Math.min(600, left - 30);
  if (ttl >= 1) cache.put(key, email, ttl);
  return { email: email };
}

function deny(email, action, why) {
  const cache = CacheService.getScriptCache();
  const key = 'deny:' + email + ':' + action;
  if (!cache.get(key)) {
    cache.put(key, '1', 600);   // 같은 계정·같은 동작은 10분에 한 줄만(기록 도배 방지)
    audit(email, action, '', why);
  }
  return jsonResponse({ success: false, forbidden: true, error: why });
}

// ──────────────────────────────────────────────────────────
// 본인 동작
// ──────────────────────────────────────────────────────────

function checkApproval(email) {
  try {
    const found = findUserRow(email);
    if (!found) {
      const req = findRequestRow(email);
      return { status: 'not_approved', request: req ? (req.status === 'REJECTED' ? 'rejected' : 'pending') : 'none' };
    }
    const row = found.row;
    // A열 리셋 플래그 해석: '' = 없음, 'RESET' = 0000, 'RESET:1234' = 1234
    const resetFlag = String(row[0] || '').trim();
    let resetPassword = null;
    if (resetFlag.toUpperCase() === 'RESET') {
      resetPassword = '0000';
    } else if (resetFlag.toUpperCase().startsWith('RESET:')) {
      resetPassword = resetFlag.slice(6).trim() || '0000';
    }
    const out = {
      status:        'approved',
      resetPassword: resetPassword,
      name:          String(row[2] || ''),
      registeredAt:  String(row[3] || ''),
    };
    FEATURE_KEYS.forEach(function (k, i) { out[k] = parseBool(row[4 + i]); });
    return out;
  } catch (err) {
    return { status: 'error', error: err.toString() };
  }
}

function requestAccess(email) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: 'busy' };
  try {
    if (findUserRow(email)) return { success: true, status: 'approved' };
    const sheet = getRequestsSheet();
    const data = sheet.getDataRange().getValues();
    let pending = 0;
    for (let i = 1; i < data.length; i++) {
      const st = String(data[i][3] || '').toUpperCase();
      if (normEmail(data[i][0]) === email) return { success: true, status: st === 'REJECTED' ? 'rejected' : 'pending' };
      if (st === 'PENDING') pending++;
    }
    if (pending >= MAX_PENDING) {
      audit(email, 'requestAccess', email, '대기 요청 상한(' + MAX_PENDING + ') 초과로 받지 않음');
      return { success: false, error: 'too many pending' };
    }
    sheet.appendRow([email, email.split('@')[0], nowText(), 'PENDING', '']);
    const mailed = mailAdmin(email);
    audit(email, 'requestAccess', email, mailed ? '승인 대기 등록 · 관리자 메일 발송' : '승인 대기 등록 · 메일 생략(하루 상한)');
    return { success: true, status: 'pending' };
  } finally {
    lock.releaseLock();
  }
}

function setResetFlag(email, value) {
  if (!email) return { success: false, error: 'email required' };
  try {
    const found = findUserRow(email);
    if (!found) return { success: false, error: 'not found' };
    getUsersSheet().getRange(found.index + 1, 1).setValue(value ? 'RESET' : '');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ──────────────────────────────────────────────────────────
// 승인 사용자 읽기
// ──────────────────────────────────────────────────────────

function getSettings() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SETTINGS_SHEET);
    if (!sheet) return { youtubeUrl: '', notebookLinks: [], reportLinks: [], youtubeUrlHistory: [], dividendLinks: [] };
    const data = sheet.getDataRange().getValues();
    const map = {};
    for (const row of data) {
      if (row[0]) map[row[0]] = row[1];
    }
    return {
      youtubeUrl:        map['youtubeUrl'] || '',
      notebookLinks:     safeParseJson(map['notebookLinks'], []),
      reportLinks:       safeParseJson(map['reportLinks'], []),
      youtubeUrlHistory: safeParseJson(map['youtubeUrlHistory'], []),
      dividendLinks:     safeParseJson(map['dividendLinks'], []),
    };
  } catch (err) {
    return { youtubeUrl: '', notebookLinks: [], reportLinks: [], error: err.toString() };
  }
}

function getFeatureLabels() {
  const fallbacks = ['기능1', '기능2', '기능3', '유튜브', '학습자료', '시장리포트', '자금흐름도', '백테스트', '가계부', '금리'];
  try {
    const sheet = getUsersSheet();
    if (!sheet) return { labels: fallbacks };
    const headers = sheet.getRange('E1:N1').getValues()[0];
    return { labels: headers.map(function (h, i) { return extractLabel(h, fallbacks[i]); }) };
  } catch (err) {
    return { labels: fallbacks, error: err.toString() };
  }
}

function extractLabel(header, fallback) {
  var s = String(header || '').trim();
  if (!s) return fallback;
  s = s.replace(/^기능\d+\s*[-\s]+/i, '').trim();
  if (!s) return fallback;
  var match = s.match(/^([^\-,\(\s]+)/);
  var label = match ? match[1].trim() : s;
  return label || fallback;
}

// 공지 목록 (notifications 시트: id·targetEmail·message·type·createdAt)
// forEmail이 있으면(일반 사용자) 전체·묶음 공지('__'로 시작)와 본인 공지만 돌려준다 — 다른 사용자 이메일이 새지 않게.
function getNotifications(forEmail) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('notifications');
    if (!sheet) return { notifications: [] };
    const rows = sheet.getDataRange().getValues();
    const notifications = [];
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] || '').trim();
      if (!id) continue;
      const target = String(rows[i][1] || '');
      if (forEmail && target.indexOf('__') !== 0 && normEmail(target) !== forEmail) continue;
      notifications.push({
        id:          id,
        targetEmail: target,
        message:     rows[i][2],
        type:        rows[i][3] || 'info',
        createdAt:   Number(rows[i][4]) || 0,
      });
    }
    return { notifications: notifications };
  } catch (err) {
    return { notifications: [], error: err.toString() };
  }
}

// ──────────────────────────────────────────────────────────
// 관리자 동작
// ──────────────────────────────────────────────────────────

function listUsers() {
  try {
    const sheet = getUsersSheet();
    if (!sheet) return { users: [] };
    const data = sheet.getDataRange().getValues();
    const users = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[1]) continue;
      const u = {
        resetFlag:    String(row[0] || ''),
        email:        String(row[1] || ''),
        name:         String(row[2] || ''),
        registeredAt: String(row[3] || ''),
      };
      FEATURE_KEYS.forEach(function (k, j) { u[k] = parseBool(row[4 + j]); });
      users.push(u);
    }
    return { users: users };
  } catch (err) {
    return { users: [], error: err.toString() };
  }
}

function listRequests() {
  try {
    const data = getRequestsSheet().getDataRange().getValues();
    const requests = [];
    for (let i = 1; i < data.length; i++) {
      const email = normEmail(data[i][0]);
      if (!email) continue;
      requests.push({
        email:       email,
        name:        String(data[i][1] || ''),
        requestedAt: String(data[i][2] || ''),
        status:      String(data[i][3] || 'PENDING').toUpperCase(),
        decidedAt:   String(data[i][4] || ''),
      });
    }
    return { requests: requests };
  } catch (err) {
    return { requests: [], error: err.toString() };
  }
}

function approveRequest(email) {
  if (!isSafeEmail(email)) return { success: false, error: 'email required' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: 'busy' };
  try {
    const req = findRequestRow(email);
    if (!findUserRow(email)) {
      const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
      const name = (req && req.name) || email.split('@')[0];
      // A~N (14열): reset, email, name, registeredAt, 기능 10개 — 새 사용자는 기능이 전부 꺼진 채 시작한다
      getUsersSheet().appendRow(['', email, name, today].concat(FEATURE_KEYS.map(function () { return 'OFF'; })));
    }
    deleteRequestRows(email);
    audit(ADMIN_EMAIL, 'approveRequest', email, '승인');
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function rejectRequest(email) {
  if (!isSafeEmail(email)) return { success: false, error: 'email required' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: 'busy' };
  try {
    markRejected(email);
    audit(ADMIN_EMAIL, 'rejectRequest', email, '거절');
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function deleteRequest(email) {
  if (!email) return { success: false, error: 'email required' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: 'busy' };
  try {
    const n = deleteRequestRows(email);
    audit(ADMIN_EMAIL, 'deleteRequest', email, '요청 기록 삭제(다시 요청 가능)');
    return { success: true, deleted: n };
  } finally {
    lock.releaseLock();
  }
}

// 승인 취소 — 승인 명단에서 지우고 '거절'로 남겨 같은 계정이 곧바로 다시 요청하지 못하게 한다.
function removeUser(email) {
  if (!email) return { success: false, error: 'email required' };
  if (email === ADMIN_EMAIL) return { success: false, error: 'cannot remove admin' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: 'busy' };
  try {
    const found = findUserRow(email);
    if (!found) return { success: false, error: 'not found' };
    getUsersSheet().deleteRow(found.index + 1);
    markRejected(email);
    audit(ADMIN_EMAIL, 'removeUser', email, '승인 취소');
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function setSettings(key, value) {
  if (!SETTINGS_KEYS[key]) return { success: false, error: 'invalid key: ' + key };
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(SETTINGS_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(SETTINGS_SHEET);
      sheet.appendRow(['key', 'value']);
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const data = sheet.getDataRange().getValues();
    let written = false;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) {
        sheet.getRange(i + 1, 2).setValue(text);
        written = true;
        break;
      }
    }
    if (!written) sheet.appendRow([key, text]);
    audit(ADMIN_EMAIL, 'setSettings', key, '');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function setUserFeature(email, feature, value) {
  const col = FEATURE_KEYS.indexOf(feature);
  if (col < 0) return { success: false, error: 'invalid feature: ' + feature };
  if (!email) return { success: false, error: 'email required' };
  try {
    const found = findUserRow(email);
    if (!found) return { success: false, error: 'user not found' };
    getUsersSheet().getRange(found.index + 1, 5 + col).setValue(value ? 'ON' : 'OFF');
    audit(ADMIN_EMAIL, 'setUserFeature', email, feature + ' → ' + (value ? 'ON' : 'OFF'));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

//  targetEmail: '__all__'(전체) | '__notebook__'(학습자료 ON) | 특정 이메일
function sendNotification(targetEmail, message, type) {
  if (!message) return { success: false, error: 'message required' };
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName('notifications');
    if (!sheet) {
      sheet = ss.insertSheet('notifications');
      sheet.appendRow(['id', 'targetEmail', 'message', 'type', 'createdAt']);
    }
    const id = Utilities.getUuid();
    sheet.appendRow([id, targetEmail, message, type, Date.now()]);
    audit(ADMIN_EMAIL, 'sendNotification', targetEmail, '');
    return { success: true, id: id };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function deleteNotification(notifId) {
  if (!notifId) return { success: false, error: 'notifId required' };
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('notifications');
    if (!sheet) return { success: true };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === notifId) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// targetEmail이 '__all__'/빈 값이면 전체 삭제, 특정 이메일이면 그 대상 행만 삭제.
function deleteAllNotifications(targetEmail) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('notifications');
    if (!sheet) return { success: true, deleted: 0 };
    const last = sheet.getLastRow();
    if (last <= 1) return { success: true, deleted: 0 };
    const filter = String(targetEmail || '').trim();
    if (!filter || filter === '__all__') {
      sheet.deleteRows(2, last - 1);
      audit(ADMIN_EMAIL, 'deleteAllNotifications', '__all__', String(last - 1) + '건');
      return { success: true, deleted: last - 1 };
    }
    const data = sheet.getDataRange().getValues();
    let deleted = 0;
    for (let i = data.length - 1; i >= 1; i--) {   // 아래에서 위로(행 인덱스 밀림 방지)
      if (String(data[i][1]) === filter) {
        sheet.deleteRow(i + 1);
        deleted++;
      }
    }
    audit(ADMIN_EMAIL, 'deleteAllNotifications', filter, String(deleted) + '건');
    return { success: true, deleted: deleted };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function listAudit(limit) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(AUDIT_SHEET);
    if (!sheet) return { entries: [] };
    const data = sheet.getDataRange().getValues();
    const n = Math.max(1, Math.min(200, limit));
    const entries = [];
    for (let i = data.length - 1; i >= 1 && entries.length < n; i--) {
      entries.push({ at: String(data[i][0] || ''), who: String(data[i][1] || ''), action: String(data[i][2] || ''), target: String(data[i][3] || ''), detail: String(data[i][4] || '') });
    }
    return { entries: entries };
  } catch (err) {
    return { entries: [], error: err.toString() };
  }
}

// ──────────────────────────────────────────────────────────
// 시트·기록·메일 도우미
// ──────────────────────────────────────────────────────────

function getUsersSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function getRequestsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(REQUESTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(REQUESTS_SHEET);
    sheet.appendRow(['email', 'name', 'requestedAt', 'status', 'decidedAt']);
  }
  return sheet;
}

function findUserRow(email) {
  if (!email) return null;
  const sheet = getUsersSheet();
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normEmail(data[i][1]) === email) return { index: i, row: data[i] };
  }
  return null;
}

function findRequestRow(email) {
  if (!email) return null;
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(REQUESTS_SHEET);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normEmail(data[i][0]) === email) return { index: i, name: String(data[i][1] || ''), status: String(data[i][3] || 'PENDING').toUpperCase() };
  }
  return null;
}

function deleteRequestRows(email) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(REQUESTS_SHEET);
  if (!sheet) return 0;
  const data = sheet.getDataRange().getValues();
  let n = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (normEmail(data[i][0]) === email) { sheet.deleteRow(i + 1); n++; }
  }
  return n;
}

function markRejected(email) {
  const sheet = getRequestsSheet();
  const req = findRequestRow(email);
  if (req) {
    sheet.getRange(req.index + 1, 4).setValue('REJECTED');
    sheet.getRange(req.index + 1, 5).setValue(nowText());
  } else {
    sheet.appendRow([email, email.split('@')[0], '', 'REJECTED', nowText()]);
  }
}

function audit(who, action, target, detail) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(AUDIT_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(AUDIT_SHEET);
      sheet.appendRow(['at', 'who', 'action', 'target', 'detail']);
    }
    sheet.appendRow([nowText(), String(who || ''), String(action || ''), String(target || ''), String(detail || '')]);
    const last = sheet.getLastRow();
    if (last > AUDIT_MAX_ROWS + 200) sheet.deleteRows(2, last - 1 - AUDIT_MAX_ROWS);
  } catch (_) { /* 기록 실패가 본 동작을 막지 않는다 */ }
}

function mailAdmin(email) {
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    let st = {};
    try { st = JSON.parse(props.getProperty('mailCount') || '{}'); } catch (_) {}
    if (st.day !== today) st = { day: today, n: 0 };
    if (st.n >= MAIL_DAILY_CAP) return false;
    st.n++;
    props.setProperty('mailCount', JSON.stringify(st));
    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: '[자산관리 대시보드] 접속 승인 요청 — ' + email,
      body: '새 접속 승인 요청이 있습니다.\n\n'
        + '계정: ' + email + '\n'
        + '시각: ' + nowText() + '\n\n'
        + '관리자 페이지 → "승인 대기"에서 승인 또는 거절하세요.\n'
        + '모르는 계정이면 거절하세요. 승인하기 전에는 이 계정이 아무것도 볼 수 없습니다.',
    });
    return true;
  } catch (err) {
    audit('system', 'mail', email, '메일 발송 실패: ' + err);
    return false;
  }
}

// ──────────────────────────────────────────────────────────
// 초기 설정 (최초 1회 실행)
// ──────────────────────────────────────────────────────────

// 보안 강화판 첫 실행 — 새 시트 2개를 만들고, 새로 필요한 권한(외부 주소 확인·메일)을 한 번에 허용받는다.
function setupSecurity() {
  getRequestsSheet();
  audit(ADMIN_EMAIL, 'setupSecurity', '', '보안 강화판 설치');
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=setup-check', { muteHttpExceptions: true });
  Logger.log('메일 남은 한도: ' + MailApp.getRemainingDailyQuota());
  Logger.log('보안 설정 완료 — 이제 [배포] → [배포 관리] → 새 버전으로 배포하세요.');
}

function setupSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    // 신규 시트만 전체 헤더 작성. 기존 시트의 커스텀 헤더(E~N)는 절대 덮어쓰지 않음.
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['RESET', 'email', 'name', 'registeredAt', '기능1', '기능2', '기능3', '유튜브', '학습자료', '시장리포트', '자금흐름도', '백테스트', '가계부', '금리']);
  } else {
    // 기존 시트: 비어 있는 J1~N1에만 헤더 추가 (E~N 커스텀 라벨 보존 — 비파괴 규약)
    var j1 = sheet.getRange('J1');
    if (!String(j1.getValue() || '').trim()) j1.setValue('시장리포트');
    var k1 = sheet.getRange('K1');
    if (!String(k1.getValue() || '').trim()) k1.setValue('자금흐름도');
    var l1 = sheet.getRange('L1');
    if (!String(l1.getValue() || '').trim()) l1.setValue('백테스트');
    var m1 = sheet.getRange('M1');
    if (!String(m1.getValue() || '').trim()) m1.setValue('가계부');
    var n1 = sheet.getRange('N1');
    if (!String(n1.getValue() || '').trim()) n1.setValue('금리');
  }
  // E2:N100 ON/OFF 데이터 검증 + 빈 셀 OFF 채우기
  var range = sheet.getRange('E2:N100');
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['ON', 'OFF'], true)
    .setAllowInvalid(false)
    .build();
  range.setDataValidation(rule);
  var values = range.getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (!values[r][c]) values[r][c] = 'OFF';
    }
  }
  range.setValues(values);
  Logger.log('Sheet setup complete (A~N, E2:N100 validation)');
}

// ──────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────

function normEmail(v) {
  return String(v || '').toLowerCase().trim();
}

// 영문·숫자로 시작하는 평범한 주소만 받는다 — '='·'+'·'-'·'@'로 시작하는 값은 시트가 수식으로 실행할 수 있다.
function isSafeEmail(email) {
  return /^[a-z0-9][a-z0-9._%+\-]*@[a-z0-9.\-]+\.[a-z]{2,}$/.test(String(email || ''));
}

function nowText() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

function parseBool(v) {
  return String(v || '').trim().toUpperCase().startsWith('ON') || v === true;
}

function safeParseJson(v, fallback) {
  if (Array.isArray(v) || (v && typeof v === 'object')) return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
