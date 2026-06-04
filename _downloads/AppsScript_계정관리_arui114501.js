// ============================================================
//  Google Apps Script — 계정 관리 (arui114501@gmail.com 전용)
//  최종 갱신: 2026-06-04
//
//  [구글 보안 정책 준수 사항]
//  - 구글 시트를 비공개로 유지 (공개 링크 불필요)
//  - 모든 데이터 접근을 이 스크립트를 통해 처리
//  - 개인 이메일 데이터가 외부에 직접 노출되지 않음
//
//  [approved_users 시트 열 구성]
//    A: reset        — '' | 'RESET' | 'RESET:1234' (PIN 초기화 플래그)
//    B: email        — 사용자 이메일
//    C: name         — 이름
//    D: registeredAt — 가입일
//    E: feature1     — 종목 비교 숨김 (ON → 차트의 비교종목·시장지표 숨김, '나의 수익률'만 표시)
//    F: feature2     — 배당 과세 관리 (ON → '배당 과세 이력 관리' 페이지 접근 허용)
//    G: feature3     — 분배금 현황 숨김 (ON → 통합대시보드·개별계좌의 분배금 현황 표/탭 숨김)
//  ※ E·F·G 값은 'ON' / 'OFF' 또는 체크박스(TRUE/FALSE) 모두 인식. 비어 있으면 OFF.
//
//  [적용 방법]
//  1. script.google.com → 기존 프로젝트 열기
//  2. 아래 전체 코드로 교체
//  3. SHEET_ID 변수에 구글 시트 ID 입력
//  4. [저장] → [배포] → [기존 배포 관리] → [새 버전으로 업데이트]
// ============================================================

const SHEET_ID   = '1Fy_LEhXkSNkv1lIihKdoFWu6mopEM00EdpadmTXGeds';
const SHEET_NAME = 'approved_users'; // A:reset  B:email  C:name  D:registeredAt  E:feature1  F:feature2  G:feature3
const ADMIN_EMAIL = 'arui114501@gmail.com';

// ── 공통 ──────────────────────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(sheetName, headerRow) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headerRow) sheet.appendRow(headerRow);
  }
  return sheet;
}

// ON/OFF·체크박스 값을 boolean으로 정규화 (빈 값·'OFF' → false)
function parseFeatureFlag(cell) {
  return String(cell || '').trim().toUpperCase().startsWith('ON') || cell === true;
}

// ── GET ───────────────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action;
  const email  = e.parameter.email;

  if (action === 'check' && email)   return handleCheckApproval(email);
  if (action === 'listUsers')        return handleListUsers();
  if (action === 'getSettings')      return handleGetSettings();
  if (action === 'getNotifications') return handleGetNotifications();

  return jsonResponse({ status: 'ok', admin: ADMIN_EMAIL });
}

// ── POST ──────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';

    if (!action && body.email) return handleApprovalRequest(body.email, body.name || '');

    if (action === 'clear_reset')        return handleClearReset(body.email || '');
    if (action === 'setSettings')        return handleSetSettings(body.key || '', body.value !== undefined ? String(body.value) : '');
    if (action === 'sendNotification')   return handleSendNotification(body.targetEmail || '__all__', body.message || '', body.type || 'info');
    if (action === 'deleteNotification') return handleDeleteNotification(String(body.notifId || ''));

    if (action === 'requestApproval' && body.email) return handleApprovalRequest(body.email, body.name || '');

    return jsonResponse({ success: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 승인 확인 ─────────────────────────────────────────────────
// A(0)=reset  B(1)=email  C(2)=name  D(3)=registeredAt  E(4)=feature1  F(5)=feature2  G(6)=feature3
function handleCheckApproval(email) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ status: 'not_approved' });
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const resetFlag    = String(data[i][0] || '').trim();
      const rowEmail     = String(data[i][1] || '').trim();
      const name         = String(data[i][2] || '').trim();
      const registeredAt = String(data[i][3] || '').trim();
      const feature1     = parseFeatureFlag(data[i][4]);
      const feature2     = parseFeatureFlag(data[i][5]);
      const feature3     = parseFeatureFlag(data[i][6]);
      if (rowEmail.toLowerCase() !== email.toLowerCase()) continue;
      let resetPassword = null;
      if (resetFlag === 'RESET')               resetPassword = '0000';
      else if (resetFlag.startsWith('RESET:')) resetPassword = resetFlag.substring(6).trim();
      return jsonResponse({ status: 'approved', email: rowEmail, name, resetPassword, registeredAt, feature1, feature2, feature3 });
    }
    return jsonResponse({ status: 'not_approved' });
  } catch (err) {
    return jsonResponse({ status: 'not_approved', error: err.toString() });
  }
}

// ── 사용자 목록 (관리자 페이지용) ─────────────────────────────
function handleListUsers() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ users: [] });
    const data = sheet.getDataRange().getValues();
    const users = [];
    for (let i = 1; i < data.length; i++) {
      const resetFlag    = String(data[i][0] || '').trim();
      const email        = String(data[i][1] || '').trim();
      const name         = String(data[i][2] || '').trim();
      const registeredAt = String(data[i][3] || '').trim();
      const feature1     = parseFeatureFlag(data[i][4]);
      const feature2     = parseFeatureFlag(data[i][5]);
      const feature3     = parseFeatureFlag(data[i][6]);
      if (!email) continue;
      users.push({ email, name, resetFlag, registeredAt, feature1, feature2, feature3 });
    }
    return jsonResponse({ status: 'ok', users });
  } catch (err) {
    return jsonResponse({ users: [], error: err.toString() });
  }
}

// ── 설정 조회 (settings 시트: A=key  B=value) ─────────────────
function handleGetSettings() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('settings');
    if (!sheet) return jsonResponse({ youtubeUrl: '', notebookLinks: '', youtubeUrlHistory: '' });
    const data = sheet.getDataRange().getValues();
    const settings = { youtubeUrl: '', notebookLinks: '', youtubeUrlHistory: '' };
    for (let i = 0; i < data.length; i++) {
      const key = String(data[i][0] || '').trim();
      if (key) settings[key] = String(data[i][1] !== undefined ? data[i][1] : '');
    }
    return jsonResponse(settings);
  } catch (err) {
    return jsonResponse({ youtubeUrl: '', notebookLinks: '', youtubeUrlHistory: '', error: err.toString() });
  }
}

// ── 설정 저장 ─────────────────────────────────────────────────
function handleSetSettings(key, value) {
  const allowed = { youtubeUrl: true, notebookLinks: true, youtubeUrlHistory: true };
  if (!key || !allowed[key]) return jsonResponse({ success: false, error: 'disallowed key: ' + key });
  try {
    const sheet = getOrCreateSheet('settings', null);
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return jsonResponse({ success: true });
      }
    }
    sheet.appendRow([key, value]);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 공지 목록 조회 ────────────────────────────────────────────
function handleGetNotifications() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('notifications');
    if (!sheet) return jsonResponse({ notifications: [] });
    const rows = sheet.getDataRange().getValues();
    const notifications = [];
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] || '').trim();
      if (!id) continue;
      notifications.push({ id, targetEmail: rows[i][1], message: rows[i][2], type: rows[i][3] || 'info', createdAt: Number(rows[i][4]) || 0 });
    }
    return jsonResponse({ notifications });
  } catch (err) {
    return jsonResponse({ notifications: [], error: err.toString() });
  }
}

// ── 공지 발송 ─────────────────────────────────────────────────
function handleSendNotification(targetEmail, message, type) {
  if (!message) return jsonResponse({ success: false, error: 'message required' });
  try {
    const sheet = getOrCreateSheet('notifications', ['id', 'targetEmail', 'message', 'type', 'createdAt']);
    const id = Utilities.getUuid();
    sheet.appendRow([id, targetEmail, message, type, Date.now()]);
    return jsonResponse({ success: true, id });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 공지 삭제 ─────────────────────────────────────────────────
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

// ── RESET 플래그 제거 ─────────────────────────────────────────
function handleClearReset(email) {
  if (!email) return jsonResponse({ success: false, error: 'email required' });
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ success: false, error: 'sheet not found' });
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').toLowerCase().trim() === email.toLowerCase().trim()) {
        sheet.getRange(i + 1, 1).clearContent();
        return jsonResponse({ status: 'ok' });
      }
    }
    return jsonResponse({ status: 'error', message: 'User not found' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 승인 요청 (LoginGate no-cors) ─────────────────────────────
function handleApprovalRequest(email, name) {
  try {
    const usersSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (usersSheet) {
      const data = usersSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][1] || '').toLowerCase() === email.toLowerCase()) {
          return jsonResponse({ status: 'already_exists' });
        }
      }
    }
    const pendingSheet = getOrCreateSheet('pending_requests', ['email', 'name', 'requestedAt']);
    pendingSheet.appendRow([email, name || email.split('@')[0], new Date().toISOString()]);
    try {
      MailApp.sendEmail(ADMIN_EMAIL, '[승인 요청] ' + email, '새로운 승인 요청\n\n이메일: ' + email + '\n이름: ' + (name || '-'));
    } catch (_) {}
    return jsonResponse({ status: 'requested' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}
