// ── 무의존성 XLSX(.xlsx) 라이터 ──────────────────────────────────────────────
// ⚠️ 외부 npm 의존성 0. `package-lock.json`이 없어 Vercel이 매 배포마다 `npm install`을
//    재해석하고, 정확히 그 원인으로 프로덕션 흰 화면이 났던 이력이 있다(CLAUDE.md
//    '자금 흐름도' 절). 그래서 xlsx/exceljs/jszip을 쓰지 않고 ZIP(STORE) + OOXML을
//    직접 조립한다. DEFLATE를 안 쓰므로 압축 라이브러리도 필요 없다.
//
// ⚠️ CSV로 되돌리지 말 것 — 사용자가 요구한 것은 '엑셀 파일'이고, CSV는 ① 숫자 서식·
//    색·열 너비가 전부 사라지고 ② 확장자와 내용이 어긋난다는 Excel 경고를 유발하거나
//    (`.xls` HTML 트릭) BOM 유무에 따라 한글이 깨진다. 진짜 .xlsx는 경고 없이 열린다.
//
// ⚠️ 이 파일은 import가 하나도 없다 — Node가 타입만 벗겨 그대로 실행할 수 있어야
//    `scripts/verify-excel.mjs`가 미러 없이 **직접 import**해 검증한다(미러는 src에만
//    넣은 변경·미러에만 넣은 변경이 둘 다 통과하는 구멍을 만든다). import를 추가하지 말 것.
//
// ⚠️ `enum`·`namespace`를 쓰지 말 것 — Node의 타입 스트리핑이 지원하지 않아
//    verify 스크립트가 통째로 죽는다(타입 별칭·인터페이스·`as`는 안전).

export type XlsxAlign = 'left' | 'center' | 'right';

export interface XlsxStyle {
  /** 사용자 서식 코드(예: '#,##0', '"₩"#,##0', '0.00%'). 미지정 시 General. */
  numFmt?: string;
  bold?: boolean;
  italic?: boolean;
  /** pt. 미지정 시 기본 11 */
  size?: number;
  /** RGB 6자리 대문자 hex(예: 'FF4D4D'). '#' 없이. */
  color?: string;
  /** 배경 solid fill. RGB 6자리 hex. */
  bg?: string;
  align?: XlsxAlign;
  wrap?: boolean;
  /** 얇은 테두리 4면 */
  border?: boolean;
}

/** null = 빈 칸(셀 자체를 쓰지 않는다). s = XlsxSheet.styles 배열의 0-based 인덱스. */
export type XlsxCell =
  | null
  | { t: 'n'; v: number; s?: number }
  | { t: 's'; v: string; s?: number };

/** 0-based, 양끝 포함 */
export interface XlsxMerge { r1: number; c1: number; r2: number; c2: number }

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
  /** 열 너비(Excel 문자 단위). 길이가 열 수보다 짧으면 나머지는 기본 너비. */
  cols?: number[];
  /** 행 높이(pt). 인덱스별, undefined면 기본. */
  rowHeights?: (number | undefined)[];
  merges?: XlsxMerge[];
  /** 상단 N개 행 고정(틀 고정). 0/미지정이면 고정 없음. */
  freezeRows?: number;
  styles: XlsxStyle[];
}

// ── 유틸 ────────────────────────────────────────────────────────────────────

/** 0-based 열 인덱스 → A1 표기 열 문자('A', 'Z', 'AA', 'AB', …) */
export const colLetter = (index: number): string => {
  let n = Math.floor(index);
  if (!Number.isFinite(n) || n < 0) n = 0;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

/** 0-based (row, col) → 'A1' */
export const cellRef = (row: number, col: number): string => colLetter(col) + String(Math.floor(row) + 1);

// XML 1.0이 허용하지 않는 제어문자. 남겨 두면 Excel이 파일을 '손상됨'으로 거부한다.
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** XML 텍스트/속성값 이스케이프. 한글은 UTF-8로 그대로 통과한다. */
export const escapeXml = (value: unknown): string =>
  String(value ?? '')
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * 시트 이름 정리. Excel 제약: 31자 이하, `: \ / ? * [ ]` 금지, 앞뒤 작은따옴표 금지,
 * 빈 문자열 금지. 어기면 Excel이 파일을 열지 못한다.
 */
export const sanitizeSheetName = (name: string): string => {
  const cleaned = String(name ?? '')
    .replace(ILLEGAL_XML, '')
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .slice(0, 31)
    .trim();
  return cleaned || 'Sheet1';
};

/**
 * 파일명 정리. Windows에서 금지된 문자(`\ / : * ? " < > |`)와 제어문자를 제거하고,
 * 끝의 마침표·공백을 지운다(Windows가 조용히 잘라내 확장자가 깨진다).
 * ⚠️ 공백은 남긴다 — '퇴직연금 820'처럼 계좌명에 공백이 정상적으로 들어간다.
 */
export const sanitizeFileName = (name: string): string => {
  const cleaned = String(name ?? '')
    .replace(ILLEGAL_XML, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return cleaned || 'export';
};

// ── CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) ─────────────────────────

let crcTable: Int32Array | null = null;
const getCrcTable = (): Int32Array => {
  if (crcTable) return crcTable;
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  crcTable = t;
  return t;
};

/** ZIP 엔트리 CRC-32. 부호 없는 32비트 값을 반환한다. */
export const crc32 = (bytes: Uint8Array): number => {
  const t = getCrcTable();
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

// ── ZIP(STORE) 컨테이너 ─────────────────────────────────────────────────────

interface ZipEntry { name: string; bytes: Uint8Array }

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// DOS 날짜/시각. 1980년 미만은 표현할 수 없어 1980-01-01로 클램프한다.
const dosDateTime = (d: Date): { time: number; date: number } => {
  const y = d.getFullYear();
  if (!Number.isFinite(y) || y < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1F),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
};

/**
 * ZIP 아카이브 조립. 압축 방식 0(STORE) — DEFLATE를 안 쓰므로 외부 압축 라이브러리가
 * 필요 없다. 파일명이 전부 ASCII라 UTF-8 플래그(bit 11)를 세우지 않는다.
 */
export const buildZip = (entries: ZipEntry[], modDate: Date): Uint8Array => {
  const { time, date } = dosDateTime(modDate);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array(30 + nameBytes.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034B50, true); // local file header signature
    lv.setUint16(4, 20, true);         // version needed to extract (2.0)
    lv.setUint16(6, 0, true);          // general purpose bit flag
    lv.setUint16(8, 0, true);          // compression method = 0 (STORE)
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);      // compressed size (== uncompressed, STORE)
    lv.setUint32(22, size, true);      // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);         // extra field length
    local.set(nameBytes, 30);
    local.set(entry.bytes, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014B50, true); // central directory header signature
    cv.setUint16(4, 20, true);         // version made by
    cv.setUint16(6, 20, true);         // version needed to extract
    cv.setUint16(8, 0, true);          // flags
    cv.setUint16(10, 0, true);         // method
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);         // extra length
    cv.setUint16(32, 0, true);         // comment length
    cv.setUint16(34, 0, true);         // disk number start
    cv.setUint16(36, 0, true);         // internal attributes
    cv.setUint32(38, 0, true);         // external attributes
    cv.setUint32(42, offset, true);    // relative offset of local header
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
    centralSize += central.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054B50, true);   // end of central directory signature
  ev.setUint16(4, 0, true);            // number of this disk
  ev.setUint16(6, 0, true);            // disk with start of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);      // central directory offset
  ev.setUint16(20, 0, true);           // comment length

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of locals) { out.set(b, p); p += b.length; }
  for (const b of centrals) { out.set(b, p); p += b.length; }
  out.set(eocd, p);
  return out;
};

// ── OOXML 파트 ──────────────────────────────────────────────────────────────

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const CONTENT_TYPES = XML_DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS = XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK_RELS = XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

const buildWorkbookXml = (sheetName: string): string => XML_DECL +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="' + escapeXml(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
  '</workbook>';

const DEFAULT_FONT_NAME = '맑은 고딕';

interface FontKey { bold: boolean; italic: boolean; size: number; color: string }

/**
 * xl/styles.xml 생성.
 * ⚠️ `<styleSheet>` 자식 순서(numFmts → fonts → fills → borders → cellStyleXfs →
 *    cellXfs → cellStyles)와 `<xf>` 안의 `<alignment>` 위치는 스키마가 강제한다.
 *    순서가 어긋나면 Excel이 "복구할 수 없는 내용"이라며 파일을 거부한다.
 * ⚠️ fills 인덱스 0(none)과 1(gray125)은 Excel이 예약한 자리다. 지우고 사용자 fill을
 *    0번에 넣으면 배경색이 통째로 어긋난다.
 */
export const buildStylesXml = (styles: XlsxStyle[]): string => {
  // numFmts — 사용자 서식 코드는 id 164부터.
  const numFmtIds = new Map<string, number>();
  for (const st of styles) {
    if (st.numFmt && !numFmtIds.has(st.numFmt)) numFmtIds.set(st.numFmt, 164 + numFmtIds.size);
  }

  // fonts — 인덱스 0은 기본 폰트(반드시 존재).
  const fontKeys: FontKey[] = [{ bold: false, italic: false, size: 11, color: '' }];
  const fontIndex = new Map<string, number>();
  fontIndex.set('0|0|11|', 0);
  const fontIdOf = (st: XlsxStyle): number => {
    const key: FontKey = {
      bold: !!st.bold, italic: !!st.italic,
      size: st.size || 11, color: (st.color || '').toUpperCase(),
    };
    const k = `${key.bold ? 1 : 0}|${key.italic ? 1 : 0}|${key.size}|${key.color}`;
    const found = fontIndex.get(k);
    if (found !== undefined) return found;
    const id = fontKeys.length;
    fontKeys.push(key);
    fontIndex.set(k, id);
    return id;
  };

  // fills — 0(none)·1(gray125)은 Excel 예약. 사용자 solid fill은 2번부터.
  const fillColors: string[] = [];
  const fillIndex = new Map<string, number>();
  const fillIdOf = (st: XlsxStyle): number => {
    if (!st.bg) return 0;
    const k = st.bg.toUpperCase();
    const found = fillIndex.get(k);
    if (found !== undefined) return found;
    const id = 2 + fillColors.length;
    fillColors.push(k);
    fillIndex.set(k, id);
    return id;
  };

  // borders — 0은 테두리 없음(예약), 1은 얇은 4면.
  const borderIdOf = (st: XlsxStyle): number => (st.border ? 1 : 0);

  const xfs = styles.map(st => ({
    numFmtId: st.numFmt ? (numFmtIds.get(st.numFmt) as number) : 0,
    fontId: fontIdOf(st),
    fillId: fillIdOf(st),
    borderId: borderIdOf(st),
    align: st.align,
    wrap: !!st.wrap,
  }));

  const numFmtsXml = numFmtIds.size
    ? '<numFmts count="' + numFmtIds.size + '">' +
      [...numFmtIds.entries()].map(([code, id]) =>
        '<numFmt numFmtId="' + id + '" formatCode="' + escapeXml(code) + '"/>').join('') +
      '</numFmts>'
    : '';

  const fontsXml = '<fonts count="' + fontKeys.length + '">' +
    fontKeys.map(f =>
      '<font>' +
      (f.bold ? '<b/>' : '') +
      (f.italic ? '<i/>' : '') +
      '<sz val="' + f.size + '"/>' +
      (f.color ? '<color rgb="FF' + escapeXml(f.color) + '"/>' : '') +
      '<name val="' + escapeXml(DEFAULT_FONT_NAME) + '"/>' +
      '<family val="2"/>' +
      '</font>').join('') +
    '</fonts>';

  const fillsXml = '<fills count="' + (2 + fillColors.length) + '">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    fillColors.map(c =>
      '<fill><patternFill patternType="solid"><fgColor rgb="FF' + escapeXml(c) + '"/>' +
      '<bgColor indexed="64"/></patternFill></fill>').join('') +
    '</fills>';

  const thin = '<left style="thin"><color rgb="FFBFBFBF"/></left>' +
    '<right style="thin"><color rgb="FFBFBFBF"/></right>' +
    '<top style="thin"><color rgb="FFBFBFBF"/></top>' +
    '<bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/>';
  const bordersXml = '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border>' + thin + '</border>' +
    '</borders>';

  // cellXfs[0] = 기본 서식. 사용자 스타일 i는 cellXfs[i+1]에 놓인다(호출부는 0-based로 쓴다).
  const cellXfsXml = '<cellXfs count="' + (xfs.length + 1) + '">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    xfs.map(x => {
      const needAlign = !!x.align || x.wrap;
      const attrs =
        'numFmtId="' + x.numFmtId + '" fontId="' + x.fontId + '" fillId="' + x.fillId +
        '" borderId="' + x.borderId + '" xfId="0"' +
        (x.numFmtId ? ' applyNumberFormat="1"' : '') +
        (x.fontId ? ' applyFont="1"' : '') +
        (x.fillId ? ' applyFill="1"' : '') +
        (x.borderId ? ' applyBorder="1"' : '') +
        (needAlign ? ' applyAlignment="1"' : '');
      if (!needAlign) return '<xf ' + attrs + '/>';
      return '<xf ' + attrs + '><alignment' +
        (x.align ? ' horizontal="' + x.align + '"' : '') +
        ' vertical="center"' +
        (x.wrap ? ' wrapText="1"' : '') +
        '/></xf>';
    }).join('') +
    '</cellXfs>';

  return XML_DECL +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    numFmtsXml + fontsXml + fillsXml + bordersXml +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    cellXfsXml +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '<dxfs count="0"/>' +
    '<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/>' +
    '</styleSheet>';
};

/**
 * xl/worksheets/sheet1.xml 생성.
 * ⚠️ CT_Worksheet 자식 순서: dimension → sheetViews → sheetFormatPr → cols →
 *    sheetData → mergeCells. `<cols>`를 sheetData 뒤에 두거나 `<mergeCells>`를 앞에
 *    두면 Excel이 파일을 손상으로 판정한다.
 */
export const buildSheetXml = (sheet: XlsxSheet): string => {
  const rows = sheet.rows || [];
  const maxCols = rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 1);
  const dimension = 'A1:' + cellRef(Math.max(rows.length, 1) - 1, Math.max(maxCols, 1) - 1);

  const freeze = Math.max(0, Math.floor(sheet.freezeRows || 0));
  const sheetViews = '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
    (freeze > 0
      ? '<pane ySplit="' + freeze + '" topLeftCell="A' + (freeze + 1) +
        '" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A' + (freeze + 1) + '" sqref="A' + (freeze + 1) + '"/>'
      : '') +
    '</sheetView></sheetViews>';

  const cols = sheet.cols && sheet.cols.length
    ? '<cols>' + sheet.cols.map((w, i) =>
        '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
        (Math.round(Math.max(1, w) * 100) / 100) + '" customWidth="1"/>').join('') + '</cols>'
    : '';

  // ⚠️ 존재하지 않는 스타일 인덱스는 Excel이 파일을 **여는 것 자체를 거부**한다(예약 fill을
  //    지웠을 때처럼 조용히 무시되지 않는다). 범위를 벗어나면 기본 서식으로 떨어뜨린다.
  const styleCount = (sheet.styles || []).length;

  const body = rows.map((cells, r) => {
    const ht = sheet.rowHeights ? sheet.rowHeights[r] : undefined;
    const rowAttrs = '<row r="' + (r + 1) + '"' +
      (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>';
    const cellXml = (cells || []).map((cell, c) => {
      if (!cell) return '';
      const ref = cellRef(r, c);
      const valid = typeof cell.s === 'number' && cell.s >= 0 && cell.s < styleCount;
      const s = valid ? ' s="' + (cell.s + 1) + '"' : '';
      if (cell.t === 'n') {
        // ⚠️ NaN/Infinity를 그대로 쓰면 <v>NaN</v>이 되어 Excel이 파일을 거부한다.
        if (!Number.isFinite(cell.v)) return '<c r="' + ref + '"' + s + '/>';
        return '<c r="' + ref + '"' + s + '><v>' + cell.v + '</v></c>';
      }
      // 인라인 문자열 — sharedStrings.xml 파트를 만들지 않아도 되고, 한글이 그대로 실린다.
      // xml:space="preserve"가 없으면 앞뒤 공백이 소실된다.
      return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' +
        escapeXml(cell.v) + '</t></is></c>';
    }).join('');
    return rowAttrs + cellXml + '</row>';
  }).join('');

  const merges = sheet.merges && sheet.merges.length
    ? '<mergeCells count="' + sheet.merges.length + '">' +
      sheet.merges.map(m =>
        '<mergeCell ref="' + cellRef(m.r1, m.c1) + ':' + cellRef(m.r2, m.c2) + '"/>').join('') +
      '</mergeCells>'
    : '';

  return XML_DECL +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="' + dimension + '"/>' +
    sheetViews +
    '<sheetFormatPr defaultRowHeight="16.5"/>' +
    cols +
    '<sheetData>' + body + '</sheetData>' +
    merges +
    '</worksheet>';
};

/** 시트 하나짜리 .xlsx 바이트를 만든다. modDate는 ZIP 타임스탬프(테스트 결정성용). */
export const buildXlsx = (sheet: XlsxSheet, modDate?: Date): Uint8Array => {
  const name = sanitizeSheetName(sheet.name);
  return buildZip([
    { name: '[Content_Types].xml', bytes: utf8(CONTENT_TYPES) },
    { name: '_rels/.rels', bytes: utf8(ROOT_RELS) },
    { name: 'xl/workbook.xml', bytes: utf8(buildWorkbookXml(name)) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: utf8(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', bytes: utf8(buildStylesXml(sheet.styles || [])) },
    { name: 'xl/worksheets/sheet1.xml', bytes: utf8(buildSheetXml(sheet)) },
  ], modDate || new Date());
};

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 브라우저 다운로드 트리거.
 * ⚠️ `revokeObjectURL`을 click 직후 동기로 부르면 일부 브라우저가 저장 전에 URL을 잃는다 →
 *    다음 태스크로 미룬다(utils.downloadCSV는 revoke를 아예 안 해 누수가 있는데, 새 코드는
 *    Blob이 수십 KB라 정리해 둔다).
 */
export const downloadXlsx = (filename: string, bytes: Uint8Array): void => {
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFileName(filename).replace(/\.xlsx$/i, '') + '.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
