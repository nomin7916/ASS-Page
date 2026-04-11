// ============================================================
//  Google Apps Script 추가 코드
//  작업일: 2026-04-11
//
//  [적용 방법]
//  1. script.google.com → 프로젝트 열기
//  2. 기존 doGet / doPost 함수 안에 아래 코드를 병합
//  3. 저장 후 [배포] → [기존 배포 관리] → [새 버전으로 업데이트]
// ============================================================


// ──────────────────────────────────────────────────────────
//  doGet 수정 - indicatorHistoryMap 반환 추가
//  기존 doGet 함수에서 return 직전에 아래 블록을 추가하세요
// ──────────────────────────────────────────────────────────

function getIndicatorHistoryMap(ss) {
  const sheet = ss.getSheetByName('IndicatorHistory');
  if (!sheet) return {};

  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return {}; // 헤더만 있는 경우

  const map = {};
  // 헤더(첫 행) 제외
  for (let i = 1; i < rows.length; i++) {
    const [key, date, value] = rows[i];
    if (!key || !date) continue;
    if (!map[key]) map[key] = {};
    map[key][String(date).substring(0, 10)] = Number(value);
  }
  return map;
}

// doGet 기존 반환 데이터에 indicatorHistoryMap 추가 예시:
//
// function doGet(e) {
//   ...
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const indicatorHistoryMap = getIndicatorHistoryMap(ss);
//
//   const responseData = {
//     ...기존데이터,          // portfolio, history, marketIndicators 등
//     indicatorHistoryMap,    // ← 이 줄 추가
//   };
//
//   return ContentService
//     .createTextOutput(JSON.stringify({ success: true, data: responseData }))
//     .setMimeType(ContentService.MimeType.JSON);
// }


// ──────────────────────────────────────────────────────────
//  doPost 수정 - indicatorHistory 저장 처리 추가
//  기존 doPost 함수 안에 아래 if 블록을 추가하세요
// ──────────────────────────────────────────────────────────

// doPost 함수 안에 추가:
//
// function doPost(e) {
//   const body = JSON.parse(e.postData.contents);
//
//   // ── 기존 저장 로직 (portfolio 등) ──
//   // ...
//
//   // ── 지표 히스토리 저장 (새로 추가) ──
//   if (body.action === 'saveIndicatorHistory') {
//     return saveIndicatorHistory(body.key, body.data);
//   }
//
//   // ...
// }

function saveIndicatorHistory(key, data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('IndicatorHistory');

    // 시트가 없으면 새로 생성
    if (!sheet) {
      sheet = ss.insertSheet('IndicatorHistory');
      sheet.appendRow(['key', 'date', 'value']);
      sheet.setFrozenRows(1);
      // 열 너비 설정
      sheet.setColumnWidth(1, 120);
      sheet.setColumnWidth(2, 120);
      sheet.setColumnWidth(3, 100);
    }

    // 해당 key의 기존 데이터 삭제
    const allData = sheet.getDataRange().getValues();
    const header = allData[0];
    const rowsToKeep = [header];
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] !== key) rowsToKeep.push(allData[i]);
    }

    sheet.clearContents();
    if (rowsToKeep.length > 0) {
      sheet.getRange(1, 1, rowsToKeep.length, 3).setValues(rowsToKeep);
    }

    // 새 데이터 추가 (날짜 오름차순 정렬)
    const newRows = Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => [key, date, value]);

    if (newRows.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, 3).setValues(newRows);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        message: `${key} 히스토리 ${newRows.length}건 저장 완료`
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ──────────────────────────────────────────────────────────
//  완성된 doGet / doPost 예시 (기존 코드와 병합 참고용)
// ──────────────────────────────────────────────────────────

/*
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 기존 데이터 로드
  // ... (기존 portfolio, history 등 읽는 로직) ...

  // 지표 히스토리 로드 (추가)
  const indicatorHistoryMap = getIndicatorHistoryMap(ss);

  const responseData = {
    // ... 기존 필드들 ...
    indicatorHistoryMap,  // ← 추가
  };

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data: responseData }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);

  // 지표 히스토리 저장 (추가)
  if (body.action === 'saveIndicatorHistory') {
    return saveIndicatorHistory(body.key, body.data);
  }

  // ... 기존 저장 로직 ...
}
*/


// ──────────────────────────────────────────────────────────
//  생성되는 시트 구조
//  시트명: IndicatorHistory
// ──────────────────────────────────────────────────────────
//
//  A열 (key)   | B열 (date)   | C열 (value)
//  ------------|--------------|------------
//  us10y       | 2023-01-03   | 3.79
//  us10y       | 2023-01-04   | 3.82
//  ...         | ...          | ...
//  goldIntl    | 2023-01-03   | 1825.40
//  goldIntl    | 2023-01-04   | 1831.20
//  ...         | ...          | ...
//  usdkrw      | 2023-01-03   | 1268.50
//  ...
//
//  지원 key 목록:
//    us10y   - 미국 10년 국채 금리
//    goldIntl - 국제 금 시세 (USD/oz)
//    usdkrw  - 달러/원 환율
//    dxy     - 달러 인덱스
//    kr10y   - 한국 10년 국채 금리 (수동 업로드)
//    fedRate - 미국 기준금리 (수동 업로드)