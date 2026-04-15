// ============================================================
//  Google Apps Script — 계정 관리 (arui114501@gmail.com 전용)
//  작업일: 2026-04-15
//
//  [구글 보안 정책 준수 사항]
//  - 구글 시트를 비공개로 유지 (공개 링크 불필요)
//  - 모든 데이터 접근을 이 스크립트를 통해 처리
//  - 개인 이메일 데이터가 외부에 직접 노출되지 않음
//
//  [적용 방법]
//  1. script.google.com → 기존 프로젝트 열기
//  2. 아래 전체 코드로 교체
//  3. SHEET_ID 변수에 구글 시트 ID 입력
//  4. [저장] → [배포] → [기존 배포 관리] → [새 버전으로 업데이트]
// ============================================================

const SHEET_ID = '1Fy_LEhXkSNkv1lIihKdoFWu6mopEM0OEdpadmTXGeds';
const SHEET_NAME = 'approved_users';
const ADMIN_EMAIL = 'arui114501@gmail.com';

// ── GET 요청 처리 ─────────────────────────────────────────────
// ?action=check&email=xxx  → 승인 여부 확인
// ?action=listUsers        → 전체 사용자 목록 (관리자 페이지용)
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'check' && e.parameter.email) {
    return handleCheckApproval(e.parameter.email);
  }
  if (action === 'listUsers') {
    return handleListUsers();
  }
  return jsonResponse({ status: 'ok', admin: ADMIN_EMAIL });
}

// ── POST 요청 처리 ────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // 승인 요청 이메일 전송
    if (body.email && !body.action) {
      return handleApprovalRequest(body.email, body.name || body.email);
    }
    // RESET 플래그 제거
    if (body.action === 'clear_reset') {
      return handleClearReset(body.email);
    }

    return jsonResponse({ success: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 승인 여부 확인 ────────────────────────────────────────────
// 시트를 비공개로 유지하면서 Apps Script가 대신 읽어줌
function handleCheckApproval(email) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ approved: false, needsReset: false, adminPin: '0000' });

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowEmail = (data[i][0] || '').toString().toLowerCase().trim();
      if (rowEmail === email.toLowerCase().trim()) {
        const b = (data[i][1] || '').toString().trim();
        const needsReset = b.toUpperCase().startsWith('RESET');
        const adminPin = (needsReset && b.includes(':')) ? b.split(':')[1].trim() : '0000';
        return jsonResponse({ approved: true, needsReset, adminPin });
      }
    }
    return jsonResponse({ approved: false, needsReset: false, adminPin: '0000' });
  } catch (err) {
    return jsonResponse({ approved: false, needsReset: false, adminPin: '0000', error: err.toString() });
  }
}

// ── 전체 사용자 목록 반환 (관리자 페이지용) ───────────────────
function handleListUsers() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ users: [] });

    const data = sheet.getDataRange().getValues();
    const users = [];
    for (let i = 1; i < data.length; i++) {
      const email = (data[i][0] || '').toString().trim();
      if (!email) continue;
      const b = (data[i][1] || '').toString().trim();
      const resetFlag = b.toUpperCase().startsWith('RESET');
      users.push({ email, resetFlag });
    }
    return jsonResponse({ users });
  } catch (err) {
    return jsonResponse({ users: [], error: err.toString() });
  }
}

// ── 승인 요청 이메일 전송 ─────────────────────────────────────
function handleApprovalRequest(email, name) {
  try {
    const subject = `[포트폴리오] 접근 승인 요청: ${email}`;
    const body = [
      '새로운 사용자가 포트폴리오 대시보드 접근 승인을 요청했습니다.',
      '',
      '요청 이메일: ' + email,
      '요청 이름: ' + name,
      '요청 시각: ' + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      '',
      '──────────────────────────────',
      '승인하려면 아래 시트에 이메일을 추가하세요:',
      'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit',
      '──────────────────────────────',
      '',
      'A열에 "' + email + '"를 추가하면 즉시 접근이 허용됩니다.',
    ].join('\n');

    GmailApp.sendEmail(ADMIN_EMAIL, subject, body);
    return jsonResponse({ success: true, message: '승인 요청 이메일 전송 완료' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── RESET 플래그 제거 ─────────────────────────────────────────
function handleClearReset(email) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowEmail = (data[i][0] || '').toString().toLowerCase().trim();
      if (rowEmail === email.toLowerCase().trim()) {
        sheet.getRange(i + 1, 2).clearContent();
        return jsonResponse({ success: true, message: email + ' RESET 플래그 제거 완료' });
      }
    }
    return jsonResponse({ success: false, error: '사용자를 찾을 수 없습니다.' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── 헬퍼 ─────────────────────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
