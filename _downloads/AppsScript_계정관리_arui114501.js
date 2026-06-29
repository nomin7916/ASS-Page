// ============================================================
//  Google Apps Script — 계정 관리 (arui114501@gmail.com 전용)
//  최종 갱신: 2026-06-22 (시장동향 리포트 기능 추가)
//
//  [구글 보안 정책 준수 사항]
//  - 구글 시트를 비공개로 유지 (공개 링크 불필요)
//  - 모든 데이터 접근을 이 스크립트를 통해 처리
//  - 개인 이메일 데이터가 외부에 직접 노출되지 않음
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
//    J(9): reportEnabled   — 시장동향 리포트 표시  ★신규
//  ※ E~J 값은 'ON' / 'OFF' 또는 체크박스(TRUE/FALSE) 모두 인식. 비어 있으면 OFF.
//
//  [settings 시트: A=key  B=value]
//    youtubeUrl / notebookLinks / reportLinks / youtubeUrlHistory
//
//  [적용 방법]
//  1. script.google.com → 기존 프로젝트 열기
//  2. 아래 전체 코드로 교체
//  3. (최초 1회) setupSheet 실행 → J열 헤더·검증 추가
//  4. [저장] → [배포] → [배포 관리] → [새 버전으로 업데이트]
// ============================================================

const SHEET_ID      = '1Fy_LEhXkSNkv1lIihKdoFWu6mopEM00EdpadmTXGeds';
const SHEET_NAME    = 'approved_users';
const SETTINGS_SHEET = 'settings';
const ADMIN_EMAIL   = 'arui114501@gmail.com';

function doGet(e) {
  const action = (e.parameter || {}).action || '';

  // 'check' (앱 현재 버전) 및 'checkApproval' (구버전) 모두 처리
  if (action === 'check' || action === 'checkApproval') {
    const email = (e.parameter.email || '').toLowerCase().trim();
    return handleCheckApproval(email);
  }
  if (action === 'listUsers')        return handleListUsers();
  if (action === 'getSettings')      return handleGetSettings();
  if (action === 'getFeatureLabels') return handleGetFeatureLabels();
  if (action === 'getNotifications') return handleGetNotifications();

  return jsonResponse({ status: 'ok', admin: ADMIN_EMAIL });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (_) {}

  const action = body.action || '';

  if (action === 'addUser')            return handleAddUser(body.email, body.name);
  if (action === 'removeUser')         return handleRemoveUser(body.email);
  if (action === 'setReset')           return handleSetReset(body.email, body.value);
  if (action === 'clear_reset')        return handleSetReset(body.email, false);
  if (action === 'setSettings')        return handleSetSettings(body.key, body.value);
  if (action === 'setUserFeature')     return handleSetUserFeature(body.email, body.feature, body.value);
  if (action === 'sendNotification')   return handleSendNotification(body.targetEmail || '__all__', body.message || '', body.type || 'info');
  if (action === 'deleteNotification') return handleDeleteNotification(String(body.notifId || ''));
  if (action === 'deleteAllNotifications') return handleDeleteAllNotifications(String(body.targetEmail || '__all__'));

  // action 없이 email만 보내는 승인 요청 (구버전 호환)
  if (!action && body.email)           return handleAddUser(body.email, body.name);

  return jsonResponse({ success: false, error: 'unknown action: ' + action });
}

// ──────────────────────────────────────────────────────────
// GET handlers
// ──────────────────────────────────────────────────────────

function handleCheckApproval(email) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ status: 'not_approved' });
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[1]) continue;
      const rowEmail = String(row[1] || '').toLowerCase().trim();
      if (rowEmail !== email) continue;

      // A열 리셋 플래그 해석: '' = 없음, 'RESET' = 0000, 'RESET:1234' = 1234
      const resetFlag = String(row[0] || '').trim();
      let resetPassword = null;
      if (resetFlag.toUpperCase() === 'RESET') {
        resetPassword = '0000';
      } else if (resetFlag.toUpperCase().startsWith('RESET:')) {
        resetPassword = resetFlag.slice(6).trim() || '0000';
      }

      return jsonResponse({
        status:          'approved',
        resetPassword:   resetPassword,
        name:            String(row[2] || ''),
        registeredAt:    String(row[3] || ''),
        feature1:        parseBool(row[4]),
        feature2:        parseBool(row[5]),
        feature3:        parseBool(row[6]),
        youtubeEnabled:  parseBool(row[7]),
        notebookEnabled: parseBool(row[8]),
        reportEnabled:   parseBool(row[9]),
      });
    }
    return jsonResponse({ status: 'not_approved' });
  } catch (err) {
    return jsonResponse({ status: 'not_approved', error: err.toString() });
  }
}

function handleListUsers() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ users: [] });
    const data = sheet.getDataRange().getValues();
    const users = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[1]) continue;
      users.push({
        resetFlag:       String(row[0] || ''),
        email:           String(row[1] || ''),
        name:            String(row[2] || ''),
        registeredAt:    String(row[3] || ''),
        feature1:        parseBool(row[4]),
        feature2:        parseBool(row[5]),
        feature3:        parseBool(row[6]),
        youtubeEnabled:  parseBool(row[7]),
        notebookEnabled: parseBool(row[8]),
        reportEnabled:   parseBool(row[9]),
      });
    }
    return jsonResponse({ users });
  } catch (err) {
    return jsonResponse({ users: [], error: err.toString() });
  }
}

function handleGetSettings() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(SETTINGS_SHEET);
    if (!sheet) return jsonResponse({ youtubeUrl: '', notebookLinks: [], reportLinks: [], youtubeUrlHistory: [] });
    const data = sheet.getDataRange().getValues();
    const map = {};
    for (const row of data) {
      if (row[0]) map[row[0]] = row[1];
    }
    return jsonResponse({
      youtubeUrl:        map['youtubeUrl'] || '',
      notebookLinks:     safeParseJson(map['notebookLinks'], []),
      reportLinks:       safeParseJson(map['reportLinks'], []),
      youtubeUrlHistory: safeParseJson(map['youtubeUrlHistory'], []),
    });
  } catch (err) {
    return jsonResponse({ youtubeUrl: '', notebookLinks: [], reportLinks: [], error: err.toString() });
  }
}

function handleGetFeatureLabels() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const fallbacks = ['기능1', '기능2', '기능3', '유튜브', '학습자료', '시장리포트'];
    if (!sheet) return jsonResponse({ labels: fallbacks });
    const headers = sheet.getRange('E1:J1').getValues()[0];
    const labels = headers.map(function(h, i) {
      return extractLabel(h, fallbacks[i]);
    });
    return jsonResponse({ labels: labels });
  } catch (err) {
    return jsonResponse({ labels: ['기능1', '기능2', '기능3', '유튜브', '학습자료', '시장리포트'], error: err.toString() });
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

// ── 공지 목록 조회 (notifications 시트: id·targetEmail·message·type·createdAt) ──
function handleGetNotifications() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('notifications');
    if (!sheet) return jsonResponse({ notifications: [] });
    const rows = sheet.getDataRange().getValues();
    const notifications = [];
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] || '').trim();
      if (!id) continue;
      notifications.push({
        id:          id,
        targetEmail: rows[i][1],
        message:     rows[i][2],
        type:        rows[i][3] || 'info',
        createdAt:   Number(rows[i][4]) || 0,
      });
    }
    return jsonResponse({ notifications });
  } catch (err) {
    return jsonResponse({ notifications: [], error: err.toString() });
  }
}

// ──────────────────────────────────────────────────────────
// POST handlers
// ──────────────────────────────────────────────────────────

function handleAddUser(email, name) {
  if (!email) return jsonResponse({ success: false, error: 'email required' });
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const normalEmail = email.toLowerCase().trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').toLowerCase().trim() === normalEmail) {
        return jsonResponse({ success: false, error: 'already exists' });
      }
    }
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    // A~J (10열): reset, email, name, registeredAt, feature1~3, youtube, notebook, report
    sheet.appendRow(['', normalEmail, name || '', today, 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF']);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function handleRemoveUser(email) {
  if (!email) return jsonResponse({ success: false, error: 'email required' });
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const normalEmail = email.toLowerCase().trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').toLowerCase().trim() === normalEmail) {
        sheet.deleteRow(i + 1);
        return jsonResponse({ success: true });
      }
    }
    return jsonResponse({ success: false, error: 'not found' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function handleSetReset(email, value) {
  if (!email) return jsonResponse({ success: false, error: 'email required' });
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const normalEmail = email.toLowerCase().trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').toLowerCase().trim() === normalEmail) {
        sheet.getRange(i + 1, 1).setValue(value ? 'RESET' : '');
        return jsonResponse({ success: true });
      }
    }
    return jsonResponse({ success: false, error: 'not found' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function handleSetSettings(key, value) {
  const allowed = { youtubeUrl: true, notebookLinks: true, reportLinks: true, youtubeUrlHistory: true, feature1Label: true };
  if (!allowed[key]) return jsonResponse({ success: false, error: 'invalid key: ' + key });
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(SETTINGS_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(SETTINGS_SHEET);
      sheet.appendRow(['key', 'value']);
    }
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) {
        sheet.getRange(i + 1, 2).setValue(typeof value === 'string' ? value : JSON.stringify(value));
        return jsonResponse({ success: true });
      }
    }
    sheet.appendRow([key, typeof value === 'string' ? value : JSON.stringify(value)]);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function handleSetUserFeature(email, feature, value) {
  // 0-indexed 열: E=4, F=5, G=6, H=7, I=8, J=9
  const colMap = { feature1: 4, feature2: 5, feature3: 6, youtubeEnabled: 7, notebookEnabled: 8, reportEnabled: 9 };
  if (!colMap.hasOwnProperty(feature)) {
    return jsonResponse({ success: false, error: 'invalid feature: ' + feature });
  }
  if (!email) return jsonResponse({ success: false, error: 'email required' });
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const normalEmail = email.toLowerCase().trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').toLowerCase().trim() === normalEmail) {
        sheet.getRange(i + 1, colMap[feature] + 1).setValue(value ? 'ON' : 'OFF');
        return jsonResponse({ success: true });
      }
    }
    return jsonResponse({ success: false, error: 'user not found' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 공지 발송 ─────────────────────────────────────────────
//  targetEmail: '__all__'(전체) | '__notebook__'(학습자료 ON) | '__report__'(시장리포트 ON) | 특정 이메일
function handleSendNotification(targetEmail, message, type) {
  if (!message) return jsonResponse({ success: false, error: 'message required' });
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName('notifications');
    if (!sheet) {
      sheet = ss.insertSheet('notifications');
      sheet.appendRow(['id', 'targetEmail', 'message', 'type', 'createdAt']);
    }
    const id = Utilities.getUuid();
    sheet.appendRow([id, targetEmail, message, type, Date.now()]);
    return jsonResponse({ success: true, id });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 공지 삭제 ─────────────────────────────────────────────
function handleDeleteNotification(notifId) {
  if (!notifId) return jsonResponse({ success: false, error: 'notifId required' });
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('notifications');
    if (!sheet) return jsonResponse({ success: true });
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === notifId) {
        sheet.deleteRow(i + 1);
        return jsonResponse({ success: true });
      }
    }
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 공지 일괄 삭제 ────────────────────────────────────────
// targetEmail이 '__all__'/빈 값이면 전체 삭제, 특정 이메일이면 그 대상 행만 삭제.
function handleDeleteAllNotifications(targetEmail) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('notifications');
    if (!sheet) return jsonResponse({ success: true, deleted: 0 });
    const last = sheet.getLastRow();
    if (last <= 1) return jsonResponse({ success: true, deleted: 0 });
    const filter = String(targetEmail || '').trim();
    if (!filter || filter === '__all__') {
      // 전체 삭제: 헤더(1행)만 남기고 데이터 행 일괄 제거
      sheet.deleteRows(2, last - 1);
      return jsonResponse({ success: true, deleted: last - 1 });
    }
    // 특정 대상만 삭제: 아래에서 위로 스캔(행 인덱스 밀림 방지)
    const data = sheet.getDataRange().getValues();
    let deleted = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][1]) === filter) {
        sheet.deleteRow(i + 1);
        deleted++;
      }
    }
    return jsonResponse({ success: true, deleted });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ──────────────────────────────────────────────────────────
// 초기 설정 (최초 1회 실행)
// ──────────────────────────────────────────────────────────

function setupSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    // 신규 시트만 전체 헤더 작성. 기존 시트의 커스텀 헤더(E~I)는 절대 덮어쓰지 않음.
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['RESET', 'email', 'name', 'registeredAt', '기능1', '기능2', '기능3', '유튜브', '학습자료', '시장리포트']);
  } else {
    // 기존 시트: 비어 있는 J1에만 '시장리포트' 헤더 추가 (E~I 커스텀 라벨 보존)
    var j1 = sheet.getRange('J1');
    if (!String(j1.getValue() || '').trim()) j1.setValue('시장리포트');
  }
  // E2:J100 ON/OFF 데이터 검증 + 빈 셀 OFF 채우기
  var range = sheet.getRange('E2:J100');
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
  Logger.log('Sheet setup complete (A~J, E2:J100 validation)');
}

// ──────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────

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
