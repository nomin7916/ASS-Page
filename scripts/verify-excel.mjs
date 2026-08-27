#!/usr/bin/env node
// 포트폴리오 테이블 엑셀(.xlsx) 내보내기 검증.
//
// 구성 ①  src/xlsxWriter.ts · src/portfolioExcel.ts 를 **직접 import** 해 순수 함수를
//        테스트한다(미러 금지 — 미러는 src에만 넣은 변경/미러에만 넣은 변경이 둘 다
//        통과하는 구멍을 만든다. 실측 사고: verify-backtest의 rebalMode 3필드 누락).
//        ⚠️ 그래서 두 모듈의 상대 import에는 `.ts` 확장자가 붙어 있다 — 떼면 Node ESM이
//        해석하지 못해(`ERR_MODULE_NOT_FOUND`) 파트①이 통째로 죽는다(#G9가 단언).
// 구성 ②  ZIP 되읽기 — 만든 바이트를 다시 파싱해 CRC·크기·XML 요소 순서를 확인한다.
//        Excel이 "복구할 수 없는 내용"으로 거부하는 사고는 전부 여기서 잡힌다.
// 구성 ③  소스 텍스트 가드 — 배선은 산술로 표현할 수 없다. **선언이 아니라 사용부**를
//        단언한다. 실패 시 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면
//        정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));

// ⚠️ 금지 토큰 검사는 **주석을 걷어낸 뒤** 한다 — 이 저장소는 금지 사유를 바로 그 자리
//    주석에 적으므로, 원문으로 재면 그 인용문이 유령 사용으로 잡혀 가드가 영구히 실패한다.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// 예외를 그 케이스의 실패로 바꾸는 래퍼. 직접 호출하면 던지는 구현이 스크립트를 통째로
// 중단시켜 어느 계약이 깨졌는지 알 수 없다(verify:chart-sel 선례).
const S = (label, fn, check) => {
  try { const v = fn(); ok(label, check ? check(v) : true); return v; }
  catch (e) { fail++; console.log(`  ✗ ${label} — threw ${e && e.message}`); return undefined; }
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트① 순수 함수 (src/*.ts 직접 import) ──');

let X = null, PE = null;
try {
  X = await import(pathToFileURL(join(ROOT, 'src/xlsxWriter.ts')).href);
  PE = await import(pathToFileURL(join(ROOT, 'src/portfolioExcel.ts')).href);
} catch (e) {
  // ⚠️ '런타임이 .ts를 못 읽는다'와 '모듈이 깨졌다'를 반드시 구분한다 — 뭉뚱그려 건너뛰면
  //    import 경로에서 `.ts` 확장자를 떼는 것만으로 파트① 54건이 **조용히 사라지고도**
  //    종료코드 0이 나온다(게이트가 무음으로 반쪽이 된다).
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) {
    console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  } else {
    fail++;
    console.log(`  ✗ 파트① 모듈을 불러오지 못했습니다 — ${e && (e.code || e.message)}`);
  }
}

// ── ZIP(STORE) 되읽기 파서 — 테스트 전용 ────────────────────────────────────
function unzipStore(buf, crc32) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('EOCD 없음');
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const files = [];
  let p = cdOff;
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('중앙 디렉터리 시그니처 불일치');
    const method = dv.getUint16(p + 10, true);
    const crcStored = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error('로컬 헤더 시그니처 불일치: ' + name);
    const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const data = buf.subarray(dataStart, dataStart + csize);
    files.push({
      name, method, crcOk: crc32(data) === crcStored,
      sizeOk: csize === usize && usize === data.length,
      text: new TextDecoder().decode(data),
    });
    p += 46 + nlen + elen + clen;
  }
  if (p !== cdOff + cdSize) throw new Error('중앙 디렉터리 크기 불일치');
  return files;
}

const orderOf = (s, tags) => { let last = -1; for (const t of tags) { const i = s.indexOf(t); if (i < 0) return `없음:${t}`; if (i < last) return `순서오류:${t}`; last = i; } return 'OK'; };

// ── 픽스처 ──────────────────────────────────────────────────────────────────
const stock = (over) => ({
  id: 's1', type: 'stock', category: '주식-a', name: 'TIGER 미국S&P500', code: '360750',
  quantity: 373, investAmount: 8897649, evalAmount: 9862120, profit: 964471,
  investRatio: 10.5, evalRatio: 11.32, returnRate: 10.84, currentPrice: 26440, changeRate: 1.93,
  assetClass: 'D', ...over,
});
const baseInput = (over) => ({
  accountName: '퇴직연금 820', dateKST: '2026-08-27',
  portfolio: [stock()],
  totals: { totalInvest: 8897649, totalEval: 9862120, totalProfit: 964471 },
  ...over,
});
const headerRow = (sheet) => sheet.rows[2].map(c => (c && c.v) || '');
const cellAt = (sheet, rowIdx, label) => {
  const i = headerRow(sheet).indexOf(label);
  return i < 0 ? undefined : sheet.rows[rowIdx][i];
};
const valAt = (sheet, rowIdx, label) => { const c = cellAt(sheet, rowIdx, label); return c ? c.v : undefined; };

if (X && PE) {
  // ─ #1~#7 저수준 유틸 ─
  eq('#1 crc32("123456789") = 0xCBF43926', X.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  eq('#2 crc32(빈 입력) = 0', X.crc32(new Uint8Array(0)), 0);
  eq('#3 colLetter 경계 (A/Z/AA/ZZ/AAA)',
    [0, 25, 26, 701, 702].map(X.colLetter), ['A', 'Z', 'AA', 'ZZ', 'AAA']);
  eq('#4 cellRef', [X.cellRef(0, 0), X.cellRef(4, 27)], ['A1', 'AB5']);
  eq('#5 escapeXml — & < > " \' 이스케이프 + 한글 보존',
    X.escapeXml('가&나<다>"라"\'마\''), '가&amp;나&lt;다&gt;&quot;라&quot;&apos;마&apos;');
  ok('#6 escapeXml — XML 1.0 불허 제어문자 제거(남기면 Excel이 파일을 거부)',
    X.escapeXml('a\u0000b\u0007c\u001fd') === 'abcd' && X.escapeXml('탭\t줄\n') === '탭\t줄\n');
  eq('#7 sanitizeSheetName — 금지문자 치환·31자·빈값 폴백',
    [X.sanitizeSheetName('a:b\\c/d?e*f[g]h'), X.sanitizeSheetName('가'.repeat(40)).length, X.sanitizeSheetName('   ')],
    ['a b c d e f g h', 31, 'Sheet1']);
  eq('#8 sanitizeFileName — Windows 금지문자·끝 마침표/공백 제거, 공백은 보존',
    [X.sanitizeFileName('퇴직연금 820'), X.sanitizeFileName('a/b:c*d'), X.sanitizeFileName('name. .')],
    ['퇴직연금 820', 'a_b_c_d', 'name']);

  // ─ #9~#14 ZIP/OOXML 구조 ─
  const sheet0 = PE.buildPortfolioSheet(baseInput());
  const bytes = S('#9 buildXlsx가 바이트를 만든다', () => X.buildXlsx(sheet0, new Date(2026, 7, 27, 9, 0, 0)),
    (b) => b instanceof Uint8Array && b.length > 1000);
  const files = S('#10 만든 바이트를 ZIP으로 되읽을 수 있다', () => unzipStore(bytes, X.crc32), (f) => f.length === 6);
  if (files) {
    eq('#11 OOXML 필수 파트 6개', files.map(f => f.name).sort(),
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    ok('#12 모든 엔트리가 CRC-32·크기 일치 + 압축방식 0(STORE)',
      files.every(f => f.crcOk && f.sizeOk && f.method === 0));
    const ws = files.find(f => f.name === 'xl/worksheets/sheet1.xml').text;
    const st = files.find(f => f.name === 'xl/styles.xml').text;
    eq('#13 worksheet 자식 순서(dimension→sheetViews→sheetFormatPr→cols→sheetData→mergeCells)',
      orderOf(ws, ['<dimension', '<sheetViews', '<sheetFormatPr', '<cols', '<sheetData', '<mergeCells']), 'OK');
    eq('#14 styleSheet 자식 순서(numFmts→fonts→fills→borders→cellStyleXfs→cellXfs→cellStyles→dxfs→tableStyles)',
      orderOf(st, ['<numFmts', '<fonts', '<fills', '<borders', '<cellStyleXfs', '<cellXfs', '<cellStyles', '<dxfs', '<tableStyles']), 'OK');
    ok('#15 fills 인덱스 0=none·1=gray125 예약 자리 유지(어기면 배경색이 통째로 밀린다)',
      /<fills count="\d+"><fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/><\/fill>/.test(st));
    ok('#16 cellXfs[0]은 기본 서식 — 사용자 스타일은 1번부터(셀 s는 +1)',
      /<cellXfs count="\d+"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"\/>/.test(st));
    ok('#17 한글이 UTF-8로 살아 있다', ws.includes('TIGER 미국S&amp;P500') && ws.includes('평가금액'));
    ok('#18 원시 제어문자가 XML에 남지 않는다', !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(ws + st));
  }
  const nanSheet = { name: 'x', rows: [[{ t: 'n', v: NaN }, { t: 'n', v: Infinity }, { t: 'n', v: 5 }]], styles: [] };
  const nanXml = X.buildSheetXml(nanSheet);
  ok('#19 NaN/Infinity는 빈 셀로 — <v>NaN</v>은 Excel이 파일을 거부한다',
    !/NaN|Infinity/.test(nanXml) && nanXml.includes('<v>5</v>'));

  // ─ #20~#22 파일명 ─
  eq('#20 파일명 = YYMMDD_계좌명.xlsx', PE.portfolioExcelFileName('2026-08-27', '퇴직연금 820'), '260827_퇴직연금 820.xlsx');
  eq('#21 날짜가 깨졌으면 접두사를 지어내지 않는다', PE.portfolioExcelFileName('nope', '계좌'), '계좌.xlsx');
  eq('#22 계좌명이 비면 폴백', PE.portfolioExcelFileName('2026-08-27', '  '), '260827_포트폴리오.xlsx');

  // ─ #23~#27 열 구성 / 숨김 열 ─
  eq('#23 기본 헤더 13열(화면 PT_COLS 순서, 비중은 투자/평가로 구분)',
    headerRow(sheet0),
    ['구분', '종목명', '코드', '등락률', '현재가', '구매단가', '보유수량', '투자금액', '투자비중', '평가금액', '평가비중', '수익률', '차익']);
  const hidden = PE.buildPortfolioSheet(baseInput({ hiddenColumns: ['category', 'changeRate', 'currentPrice', 'purchasePrice', 'investRatio', 'profit'] }));
  eq('#24 숨긴 열은 시트에서도 빠진다(스크린샷 구성)',
    headerRow(hidden), ['종목명', '코드', '보유수량', '투자금액', '평가금액', '평가비중', '수익률']);
  eq('#25 전 열 숨김이면 열이 남지 않는다',
    PE.buildPortfolioSheet(baseInput({ hiddenColumns: PE.EXCEL_COLS.map(c => c.key) })).rows[2].length, 0);
  eq('#26 틀 고정은 헤더 3줄(제목·기준일·헤더)', sheet0.freezeRows, 3);
  ok('#27 제목/기준일 행이 전 열을 가로지른다',
    sheet0.merges.some(m => m.r1 === 0 && m.c1 === 0 && m.c2 === 12) &&
    sheet0.merges.some(m => m.r1 === 1 && m.c1 === 0 && m.c2 === 12));

  // ─ #28~#34 해외계좌 단위 함정 (이 기능의 최대 리스크) ─
  const FX = 1390;
  const ovItem = stock({
    id: 'o1', code: 'AAPL', quantity: 10, purchasePrice: 150, investAmountUsd: 1500,
    investAmount: 1500 * FX, evalAmount: 2000 * FX, profit: 500 * FX,
    currentPrice: 200, returnRate: 33.33,
  });
  const ov = PE.buildPortfolioSheet(baseInput({
    portfolio: [ovItem], isOverseas: true, usdkrw: FX,
    totals: { totalInvest: 1500 * FX, totalEval: 2000 * FX, totalProfit: 500 * FX },
  }));
  eq('#28 해외 헤더에 (USD)/(₩) 동반 열',
    headerRow(ov),
    ['구분', '종목명', '코드', '등락률', '현재가(USD)', '구매단가(USD)', '보유수량',
      '투자금액(USD)', '투자금액(₩)', '투자비중', '평가금액(USD)', '평가금액(₩)', '평가비중', '수익률', '차익(USD)', '차익(₩)']);
  eq('#29 ⚠️ 해외 투자금액은 overseasInvestAmount(USD) — item.investAmount(원화 환산)를 읽으면 ≈1,390배',
    valAt(ov, 3, '투자금액(USD)'), 1500);
  eq('#30 해외 투자금액(₩) 동반 열', valAt(ov, 3, '투자금액(₩)'), 1500 * FX);
  eq('#31 해외 평가금액 USD = 원화 ÷ 환율 (화면 fmtDual과 같은 식)', valAt(ov, 3, '평가금액(USD)'), 2000);
  eq('#32 해외 평가금액(₩)은 저장된 원화값 그대로', valAt(ov, 3, '평가금액(₩)'), 2000 * FX);
  eq('#33 현재가·구매단가는 환산하지 않는다(native USD)',
    [valAt(ov, 3, '현재가(USD)'), valAt(ov, 3, '구매단가(USD)')], [200, 150]);
  eq('#34 해외 차익 USD/₩', [valAt(ov, 3, '차익(USD)'), valAt(ov, 3, '차익(₩)')], [500, 500 * FX]);

  // ─ #35~#38 퍼센트 규약 ─
  eq('#35 퍼센트는 분수로 저장(값/100) — Excel이 진짜 백분율로 계산한다',
    [valAt(sheet0, 3, '평가비중'), valAt(sheet0, 3, '수익률'), valAt(sheet0, 3, '등락률')],
    [0.1132, 0.1084, 0.0193]);
  ok('#36 나눗셈 잔차가 정리된다(0.013000000000000001 금지)',
    String(PE.buildPortfolioSheet(baseInput({ portfolio: [stock({ evalRatio: 1.3 })] }))
      .rows[3][headerRow(sheet0).indexOf('평가비중')].v) === '0.013');
  ok('#37 수익률 서식은 한국식(이익 빨강/손실 파랑)', PE.FMT.pctSigned.startsWith('[Red]') && PE.FMT.pctSigned.includes('[Blue]-'));
  ok('#38 등락률 서식은 ▲/▼', PE.FMT.change.includes('"▲"') && PE.FMT.change.includes('"▼"'));

  // ─ #39~#44 행 그룹 ─
  const full = PE.buildPortfolioSheet(baseInput({
    portfolio: [
      stock(),
      { id: 'c1', type: 'deposit', depositAmount: 11766564, investAmount: 11766564, evalAmount: 11766564, investRatio: 13.5, evalRatio: 13.5, returnRate: 0, profit: 0 },
      { id: 'f1', type: 'fund', code: 'MA:536630', name: '미래에셋연금동행성장형혼합자1호', quantity: 3766.4, investAmount: 6067250, evalAmount: 6173769, investRatio: 7, evalRatio: 7.09, returnRate: 1.76, profit: 106519, currentPrice: 1639.34, changeRate: 0.12, assetClass: 'D' },
      { id: 'v1', type: 'savings', name: 'kb손해보험 이율보증형 3년', annualRate: '3.5', startDate: '2026-03-01', endDate: '2029-03-01', investAmount: 5000000, evalAmount: 5085000, investRatio: 5.8, evalRatio: 5.8, returnRate: 1.7, profit: 85000, deposits: [{ id: 'd', date: '2026-03-01', amount: 5000000 }], assetClass: 'S' },
    ],
    isRetirement: true, showSavings: true, showAssetClass: true,
    retirementStats: { dRatio: 56.7, sRatio: 43.3 },
  }));
  // ⚠️ 저장 배열 순서(handleSort: 주식→펀드→예적금→예수금)와 화면 렌더 순서가 **다르다**.
  //    시트는 화면 순서를 따라야 한다.
  const rowText = (i) => full.rows[i].map(c => (c ? String(c.v) : '')).join(' ');
  const findRow = (needle) => full.rows.findIndex((_, i) => rowText(i).includes(needle));
  const order = ['TIGER 미국S&P500', '예수금 (CASH)', '미래에셋연금동행성장형혼합자1호',
    'kb손해보험 이율보증형 3년', '퇴직연금 자산 비율', 'TOTAL CALCULATION'].map(findRow);
  ok('#39 행 순서 = 화면 렌더 순서(주식→예수금→펀드→예적금→D/S→TOTAL)',
    order.every(i => i >= 3) && order.every((v, i) => i === 0 || v > order[i - 1]));
  eq('#40 예수금 행: 수익률은 문자열 "-", 차익은 숫자 0(화면과 같은 표기)',
    [valAt(full, 4, '수익률'), valAt(full, 4, '차익')], ['-', 0]);
  eq('#41 펀드 행: 보유수량은 정수 반올림, 구매단가는 투자금액÷수량',
    [valAt(full, 5, '보유수량'), valAt(full, 5, '구매단가')], [3766, Math.round(6067250 / 3766.4)]);
  eq('#42 펀드 구분 셀은 코드가 MA: 면 MIRAE(+ D/S 배지)', valAt(full, 5, '구분'), 'MIRAE D');
  eq('#43 예적금 행: 코드=연이율 / 구매단가·보유수량=미사용 / 현재가=투자기간',
    [valAt(full, 6, '코드'), valAt(full, 6, '구매단가'), valAt(full, 6, '보유수량'), String(valAt(full, 6, '현재가')).includes('~')],
    ['연 3.5%', '-', '-', true]);
  ok('#44 예적금 만기금액은 평가금액을 숫자로 유지한 채 비고 열로 뺀다',
    headerRow(full).includes('비고') && String(valAt(full, 6, '비고')).startsWith('만기 ₩') && typeof valAt(full, 6, '평가금액') === 'number');

  // ─ #45~#48 TOTAL / D/S ─
  const last = full.rows.length - 1;
  eq('#45 TOTAL 행 값', [valAt(full, last, '투자금액'), valAt(full, last, '평가금액')], [8897649, 9862120]);
  eq('#46 TOTAL 비중은 1(=100%) — 화면이 "100%"라 소수 없는 서식을 쓴다',
    [valAt(full, last, '투자비중'), valAt(full, last, '평가비중')], [1, 1]);
  ok('#47 TOTAL 수익률 = 총차익 ÷ 총투자(합산이 아니다)',
    Math.abs(valAt(full, last, '수익률') - 964471 / 8897649) < 1e-9);
  ok('#48 D/S 비율 행은 화면이 계산한 값을 그대로 쓴다',
    String(full.rows[7][0].v).includes('56.7%') && String(full.rows[7][0].v).includes('43.3%'));
  ok('#49 retirementStats가 없으면 D/S 행 자체가 없다',
    !PE.buildPortfolioSheet(baseInput()).rows.some(r => r[0] && String(r[0].v).includes('퇴직연금 자산 비율')));
  ok('#50 isRetirement=false면 펀드 행 제외 / showSavings=false면 예적금 행 제외',
    PE.buildPortfolioSheet(baseInput({
      portfolio: [stock(), { id: 'f', type: 'fund', name: 'F', investAmount: 1 }, { id: 'v', type: 'savings', name: 'V', investAmount: 1 }],
    })).rows.length === 5);

  // ─ #51~#53 미입력 vs 0, 행 색상 ─
  const blank = PE.buildPortfolioSheet(baseInput({ portfolio: [stock({ quantity: '', currentPrice: '' })] }));
  ok('#51 미입력 칸은 0이 아니라 빈 셀 — 화면 formatNumber/formatQty가 빈 문자열을 낸다',
    cellAt(blank, 3, '보유수량') === null && cellAt(blank, 3, '현재가') === null);
  const marked = PE.buildPortfolioSheet(baseInput({ markedRows: { s1: 'rose' } }));
  ok('#52 행 색상 표시가 시트 배경으로 옮겨진다',
    marked.styles.some(st => st.bg === PE.MARK_XLSX_BG.rose));
  ok('#53 색상 없는 행은 기본 배경(칠하지 않는다)',
    !PE.buildPortfolioSheet(baseInput()).styles.some(st => Object.values(PE.MARK_XLSX_BG).includes(st.bg)));

  // ─ #54 전체 왕복 ─
  const roundTrip = S('#54 buildPortfolioXlsx 왕복 — 시트 이름과 계좌명이 실제 바이트에 실린다',
    () => unzipStore(PE.buildPortfolioXlsx(baseInput(), new Date(2026, 7, 27)), X.crc32),
    (f) => f.find(x => x.name === 'xl/workbook.xml').text.includes('퇴직연금 820') &&
      f.find(x => x.name === 'xl/worksheets/sheet1.xml').text.includes('퇴직연금 820'));
  void roundTrip;
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트② 소스 텍스트 가드 (선언이 아니라 사용부를 단언) ──');

const PT_RAW = read('src/components/PortfolioTable.tsx');
const PT = stripComments(PT_RAW);
const APP = stripComments(read('src/App.tsx'));
const PX_RAW = read('src/portfolioExcel.ts');
const PX = stripComments(PX_RAW);
const XW_RAW = read('src/xlsxWriter.ts');
const PKG = JSON.parse(read('package.json'));

// #G1 — 외부 의존성 0. xlsx/exceljs/jszip이 들어오면 Vercel 배포가 흰 화면이 난 그 사고가 재발한다.
ok('#G1 외부 npm 의존성이 늘지 않았다(xlsx/exceljs/jszip/file-saver 없음)',
  Object.keys({ ...PKG.dependencies, ...PKG.devDependencies })
    .every(d => !/^(xlsx|exceljs|jszip|sheetjs|file-saver|write-excel-file)$/i.test(d)));
eq('#G2 dependencies는 기존 4개 그대로', Object.keys(PKG.dependencies).sort(),
  ['lucide-react', 'react', 'react-dom', 'recharts']);
ok('#G3 verify:excel이 package.json에 등록돼 있다', PKG.scripts['verify:excel'] === 'node scripts/verify-excel.mjs');

// #G4 — 버튼이 '수익률 옆 + 헤더'와 같은 th 안에, + 버튼 **위**에 있다.
//      th를 새로 만들면 열 개수가 어긋나 '렌더 지점 23곳' 부류의 정렬 붕괴가 난다.
const thBlock = (() => {
  const i = PT.indexOf("onClick={onAddStock}");
  if (i < 0) return '';
  const start = PT.lastIndexOf('<th', i);
  const end = PT.indexOf('</th>', i);
  return start < 0 || end < 0 ? '' : PT.slice(start, end);
})();
ok('#G4 엑셀 버튼이 종목추가(+)와 **같은 th** 안에 있다(새 열을 만들지 않았다)',
  thBlock.includes('handleDownloadExcel') && thBlock.includes('onClick={onAddStock}'));
ok('#G5 엑셀 버튼이 + 버튼보다 **위**에 온다(사용자 요구: 헤더 상단)',
  thBlock.indexOf('handleDownloadExcel') >= 0 &&
  thBlock.indexOf('handleDownloadExcel') < thBlock.indexOf('onClick={onAddStock}'));
ok('#G6 아이콘은 저장소에 이미 쓰는 lucide 아이콘만(FileSpreadsheet)',
  /import \{[^}]*\bFileSpreadsheet\b[^}]*\} from 'lucide-react'/.test(PT) && thBlock.includes('<FileSpreadsheet'));
ok('#G7 이 표의 z-index를 올리지 않았다(sticky 종목명 th와 앱 상단바 페인트 순서 회귀 방지)',
  !/z-\[?(3[0-9]|[4-9][0-9])/.test(thBlock));

// #G9 — 다운로드 핸들러가 화면 상태를 **전부** 넘긴다. 하나라도 빠지면 그 조건에서만
//       시트가 화면과 달라지는데(숨김 열·해외·퇴직연금) 화면상 아무 단서가 없다.
const handler = (() => {
  const i = PT.indexOf('const handleDownloadExcel');
  return i < 0 ? '' : PT.slice(i, PT.indexOf('\n  };', i));
})();
ok('#G9 핸들러가 downloadPortfolioXlsx를 호출한다',
  handler.includes('downloadPortfolioXlsx({'));
for (const k of ['portfolio', 'totals', 'hiddenColumns', 'isOverseas', 'usdkrw', 'isRetirement', 'showSavings', 'showAssetClass', 'retirementStats', 'markedRows']) {
  ok(`#G10 핸들러가 '${k}'를 넘긴다`, new RegExp('(^|[\\s{,])' + k + '\\s*[,:]').test(handler));
}
// #G11 — 파일명 날짜는 KST. 이 파일의 todayStr은 new Date().toISOString()(UTC) 파생이라
//        KST 00:00~09:00에 하루 밀린다(그 필드는 예적금 입금일에 쓰이는 별개 버그라 손대지 않는다).
ok('#G11 파일명 날짜는 getTodayKST() — todayStr(UTC 파생)을 쓰지 않는다',
  handler.includes('getTodayKST()') && !handler.includes('todayStr'));
ok('#G12 getTodayKST를 실제로 import한다',
  /import \{ getTodayKST \} from '\.\.\/hooks\/useMarketCalendar'/.test(PT));
// #G13 — 성공 시 notify 금지(CLAUDE.md 알림 최소화 정책). 이 컴포넌트엔 notify prop도 없다.
ok('#G13 내보내기 경로에서 notify()를 부르지 않는다', !handler.includes('notify('));
ok('#G14 실패/성공 피드백은 1.5초 아이콘 플래시 + 언마운트 타이머 정리',
  handler.includes("setExcelFlash('done')") && handler.includes("setExcelFlash('fail')") &&
  /useEffect\(\(\) => \(\) => \{ if \(excelTimerRef\.current\) clearTimeout/.test(PT));

// #G15 — App이 화면에 보이는 계좌명을 넘긴다. AccountTabBar가 활성 계좌에 `title`을 쓰므로
//        파일명이 탭에 보이는 이름과 일치한다.
ok('#G15 App이 accountName={title}을 넘긴다(탭에 보이는 이름 = 파일명)',
  /<PortfolioTable[\s\S]{0,3000}?accountName=\{title\}/.test(APP));

// #G16 — 해외 단위 함정. 시트 빌더의 주식 행이 overseasInvestAmount를 쓰고,
//        해외 분기에서 item.investAmount를 투자금액으로 쓰지 않는다.
const stockEmit = (() => {
  const i = PX.indexOf('for (const item of stockItems)');
  return i < 0 ? '' : PX.slice(i, PX.indexOf('for (const item of depositItems)'));
})();
ok('#G16 주식 행이 overseasInvestAmount(item)로 해외 투자금액을 구한다',
  stockEmit.includes('overseasInvestAmount(item)'));
ok('#G17 해외 분기가 item.investAmount를 투자금액으로 쓰지 않는다(≈1,390배 오염)',
  /investAmount: isOverseas \? overseasInvest :/.test(stockEmit));
ok('#G18 해외 평가금액·차익 USD는 원화 ÷ 환율(화면 fmtDual과 같은 식)',
  /evalAmount: isOverseas \? evalKrw \/ fx/.test(stockEmit) && /profit: isOverseas \? profitKrw \/ fx/.test(stockEmit));

// #G19 — 두 파일이 공유하는 리터럴. 한쪽만 고치면 D/S 배지·숨김 열 키가 갈린다.
const safeCatOf = (s) => (s.match(/const SAFE_CATEGORIES = \[[^\]]*\]/) || [''])[0];
ok('#G19 SAFE_CATEGORIES 리터럴이 PortfolioTable과 portfolioExcel에서 동일',
  safeCatOf(PT) !== '' && safeCatOf(PT) === safeCatOf(PX));
const keysOf = (s, name) => {
  const m = s.match(new RegExp(name + '[^=]*= \\[([\\s\\S]*?)\\n\\];'));
  return m ? [...m[1].matchAll(/key: '([a-zA-Z]+)'/g)].map(x => x[1]) : [];
};
eq('#G20 EXCEL_COLS의 key 집합이 화면 PT_COLS와 동일(숨김 열 토글이 같은 키를 쓴다)',
  keysOf(PX, 'EXCEL_COLS'), keysOf(PT, 'PT_COLS'));

// #G21 — 직접 import 가능성 유지. 확장자를 떼면 파트①이 통째로 죽는다.
ok('#G21 portfolioExcel.ts의 상대 import에 .ts 확장자가 붙어 있다(Node 직접 import 계약)',
  /from '\.\/utils\.ts'/.test(PX_RAW) && /from '\.\/xlsxWriter\.ts'/.test(PX_RAW));
ok('#G22 xlsxWriter.ts는 import가 0건이다(직접 import 가능 유지)',
  !/^\s*import\s/m.test(stripComments(XW_RAW)));
ok('#G23 xlsxWriter.ts에 enum/namespace가 없다(Node 타입 스트리핑이 지원하지 않는다)',
  !/^\s*(export\s+)?(enum|namespace)\s/m.test(stripComments(XW_RAW)));

// #G24 — ZIP/OOXML의 되돌리면 깨지는 계약들(사용부 단언).
ok('#G24 ZIP은 압축방식 0(STORE) — DEFLATE로 바꾸면 압축 라이브러리가 필요해진다',
  /lv\.setUint16\(8, 0, true\);\s*$/m.test(stripComments(XW_RAW).split('\n').map(l => l.trimEnd()).join('\n')) ||
  stripComments(XW_RAW).includes('lv.setUint16(8, 0, true);'));
ok('#G25 sheetData 앞에 cols, 뒤에 mergeCells를 붙인다',
  /cols \+\s*'<sheetData>' \+ body \+ '<\/sheetData>' \+\s*merges/.test(PX_RAW ? stripComments(XW_RAW) : ''));
ok('#G26 fills 0/1 예약 자리를 실제로 써 넣는다',
  stripComments(XW_RAW).includes("'<fill><patternFill patternType=\"none\"/></fill>' +") &&
  stripComments(XW_RAW).includes('patternType="gray125"'));
ok('#G27 인라인 문자열에 xml:space="preserve"를 붙인다(앞뒤 공백 소실 방지)',
  stripComments(XW_RAW).includes('<t xml:space="preserve">'));

// #G28 — 영속화 지점 0곳. 내보내기는 순수 파생이라 Drive 저장 경로를 건드리면 안 된다.
ok('#G28 영속화 지점을 건드리지 않았다(portfolioStructureKey에 excel 관련 필드 없음)',
  !/portfolioStructureKey[\s\S]{0,4000}?(excel|xlsx)/i.test(APP));
ok('#G29 내보내기 모듈이 저장/네트워크를 하지 않는다(순수 파생)',
  !/localStorage|sessionStorage|fetch\(|saveDriveFile|setPortfolios/.test(PX) &&
  !/localStorage|sessionStorage|fetch\(/.test(stripComments(XW_RAW)));

console.log(`\n결과: ${pass} 통과, ${fail} 실패\n`);
process.exit(fail > 0 ? 1 : 0);
