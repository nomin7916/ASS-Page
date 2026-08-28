#!/usr/bin/env node
// 자산검증 '두 날짜 비교 → 엑셀' 검증.
//
// 구성 ①  src/evalCompare.ts · src/evalCompareExcel.ts 를 **직접 import** 해 순수 함수를
//        테스트한다(미러 금지 — 미러는 src에만 넣은 변경/미러에만 넣은 변경이 둘 다
//        통과하는 구멍을 만든다. 실측 사고: verify-backtest의 rebalMode 3필드 누락).
//        ⚠️ 그래서 두 모듈의 상대 import에는 `.ts` 확장자가 붙어 있다 — 떼면 Node ESM이
//        해석하지 못해(`ERR_MODULE_NOT_FOUND`) 파트①이 통째로 죽는다(#G20이 단언).
// 구성 ②  ZIP 되읽기 — 만든 바이트를 다시 파싱해 CRC·크기·XML 요소 순서를 확인한다.
// 구성 ③  소스 텍스트 가드 — 배선은 산술로 표현할 수 없다. **선언이 아니라 사용부**를
//        단언한다. 실패 시 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면
//        정규식을 고칠 것.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
const near = (label, a, b, tol = 0.5) => ok(`${label} (${a} ≈ ${b})`, Number.isFinite(a) && Math.abs(a - b) <= tol);

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

let EC = null, EX = null, U = null;
try {
  EC = await import(pathToFileURL(join(ROOT, 'src/evalCompare.ts')).href);
  EX = await import(pathToFileURL(join(ROOT, 'src/evalCompareExcel.ts')).href);
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
} catch (e) {
  // ⚠️ '런타임이 .ts를 못 읽는다'와 '모듈이 깨졌다'를 반드시 구분한다 — 뭉뚱그려 건너뛰면
  //    import 경로에서 `.ts` 확장자를 떼는 것만으로 파트①이 **조용히 사라지고도** 종료코드 0이 된다.
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  else { fail++; console.log(`  ✗ 파트① 모듈을 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

// ── ZIP(STORE) 되읽기 파서 — 테스트 전용 ────────────────────────────────────
function unzipStore(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('EOCD 없음');
  const total = dv.getUint16(eocd + 10, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const files = [];
  let p = cdOff;
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('중앙 디렉터리 시그니처 불일치');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const data = buf.subarray(dataStart, dataStart + csize);
    files.push({ name, method, sizeOk: csize === usize, text: new TextDecoder().decode(data) });
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const orderOf = (s, tags) => { let last = -1; for (const t of tags) { const i = s.indexOf(t); if (i < 0) return `없음:${t}`; if (i < last) return `순서오류:${t}`; last = i; } return 'OK'; };

// ── 픽스처 (사진2 = 사용자가 손으로 만든 시트) ──────────────────────────────
// ⚠️ 이 값들은 사용자 실측이다. 기대치가 하드코딩돼 있으니 **고치지 말 것** — 새 케이스는
//    덮어쓰기(over)로 추가한다.
const ST = (code, name, quantity, investAmount, purchasePrice) =>
  ({ code, name, type: 'stock', quantity, investAmount, purchasePrice, depositAmount: 0 });
const CASH = (amount) => ({ code: '', name: '예수금', type: 'deposit', quantity: 0, investAmount: 0, depositAmount: amount });

const basePf = () => ({
  name: 'COVERD 4', baselineDate: '2026-05-15', preBaselineVerified: true,
  holdingSnapshots: [
    { date: '2026-08-10', kind: 'auto', items: [
      ST('0177R0', 'TIGER 반도체TOP10커버드콜액티브', 12772, 120000000, 0),
      ST('0219E0', 'KODEX 200커버드콜액티브', 19370, 150000000, 0),
      ST('498410', 'KODEX 금융고배당TOP10타겟위클리커버드콜', 10445, 128000000, 0),
      CASH(9021471),
    ] },
    { date: '2026-08-27', kind: 'auto', items: [
      ST('0177R0', 'TIGER 반도체TOP10커버드콜액티브', 12567, 146760387, 11678),
      ST('0219E0', 'KODEX 200커버드콜액티브', 18653, 162201468, 8696),
      ST('498410', 'KODEX 금융고배당TOP10타겟위클리커버드콜', 10401, 128373267, 12342),
      CASH(17549765),
    ] },
  ],
  dividendHistory: {
    '0177R0': { '2026-06': 148, '2026-07': 151, '2026-08': 151 },
    '0219E0': { '2026-06': 150, '2026-07': 153, '2026-08': 165 },
    '498410': { '2026-06': 152, '2026-07': 154, '2026-08': 144 },
  },
  dividendExDate: {
    '0177R0': { '2026-06': '2026-06-29', '2026-07': '2026-07-30' },
    '0219E0': { '2026-06': '2026-06-29', '2026-07': '2026-07-30' },
    '498410': { '2026-06': '2026-06-29', '2026-07': '2026-07-30' },
  },
});
const baseMap = () => ({
  '0177R0': { '2026-08-10': 9940, '2026-08-27': 11185 },
  '0219E0': { '2026-08-10': 7720, '2026-08-27': 8640 },
  '498410': { '2026-08-10': 11930, '2026-08-27': 11875 },
});
const baseInput = (over = {}) => ({
  portfolio: basePf(), accountType: 'portfolio',
  basisDate: '2026-08-27', compareDate: '2026-08-10',
  stockHistoryMap: baseMap(), indicatorHistoryMap: {},
  ...over,
});
const rowOf = (r, code) => (r.rows || []).find(x => x.code === code);

// ── 시트 블록 탐색 (①②③④) ─────────────────────────────────────────────────
// ⚠️ 값 단언에 필요하다 — 구조(캡션·헤더·행 수)만 보면 **본문 셀을 통째로 바꿔치기해도** 통과한다
//    (적대적 리뷰 실측: ④ 블록을 ②로 바꿔도, 평가금을 2배로 만들어도 165건이 전부 초록이었다).
const blocksOf = (sheet) => ['①', '②', '③', '④'].map(mark => {
  const cap = sheet.rows.findIndex(r => r[0] && typeof r[0].v === 'string' && r[0].v.startsWith(mark));
  let tot = cap + 2;
  while (tot < sheet.rows.length && !(sheet.rows[tot][0] && sheet.rows[tot][0].v === 'TOTAL')) tot++;
  return { cap, head: cap + 1, bodyFrom: cap + 2, bodyTo: tot - 1, total: tot };
});
const bodyRow = (sheet, blk, code) => {
  for (let i = blk.bodyFrom; i <= blk.bodyTo; i++) {
    const r = sheet.rows[i];
    if (r && r[1] && r[1].v === code) return r;
  }
  return null;
};
// ⚠️ 행을 '코드'로만 특정하지 말 것 — 예수금·금현물·예적금은 코드가 전부 빈 문자열이라 한
//    블록 안에서 서로 구분되지 않는다(`bodyRow(sheet, blk, '')`은 언제나 첫 빈 코드 행만 집는다).
//    집계 행·안내 행도 코드가 없다. 라벨(종목명 셀)로 특정·집합 비교한다.
const labelsOf = (sheet, blk) => {
  const out = [];
  for (let i = blk.bodyFrom; i <= blk.bodyTo; i++) {
    const r = sheet.rows[i];
    out.push(r && r[0] && typeof r[0].v === 'string' ? r[0].v : '?');
  }
  return out;
};
const labelRow = (sheet, blk, prefix) => {
  for (let i = blk.bodyFrom; i <= blk.bodyTo; i++) {
    const r = sheet.rows[i];
    if (r && r[0] && typeof r[0].v === 'string' && r[0].v.startsWith(prefix)) return r;
  }
  return null;
};
const sumCol = (sheet, blk, idx) => {
  let s = 0;
  for (let i = blk.bodyFrom; i <= blk.bodyTo; i++) {
    const v = sheet.rows[i] && sheet.rows[i][idx];
    if (v && v.t === 'n' && Number.isFinite(v.v)) s += v.v;
  }
  return s;
};
const cellNum = (row, idx) => (row && row[idx] && row[idx].t === 'n' ? row[idx].v : null);
// 국내 10열: 0 종목명 · 1 코드 · 2 종가 · 3 구매단가 · 4 수량 · 5 투자금액 · 6 평가금액 · 7 비중/증감율 · 8 분배금 · 9 주당분배금
const CL = { price: 2, purchase: 3, qty: 4, invest: 5, eval: 6, ratio: 7, div: 8, perShare: 9 };

if (EC && EX && U) {
  // ─ #1~#6 저수준 유틸 ─
  eq('#1 lastDayOfMonth 8월', EC.lastDayOfMonth('2026-08'), '2026-08-31');
  eq('#2 lastDayOfMonth 윤년 2월', EC.lastDayOfMonth('2024-02'), '2024-02-29');
  eq('#3 lastDayOfMonth 손상 입력은 빈 문자열', EC.lastDayOfMonth('20xx'), '');
  eq('#4 dividendCodeType 국내 6자리', EC.dividendCodeType('0219E0', false), 'kr');
  eq('#4b dividendCodeType 해외 티커', EC.dividendCodeType('AAPL', true), 'us');
  eq('#4c dividendCodeType 펀드 코드는 대상 아님', EC.dividendCodeType('MA:12345', false), null);
  eq('#5 isTaxDeferredAccount', [EC.isTaxDeferredAccount('dc-irp'), EC.isTaxDeferredAccount('portfolio')], [true, false]);
  eq('#6 joinKeyOf 예수금은 계좌당 하나', EC.joinKeyOf({ type: 'deposit', code: 'X' }), 'deposit');
  eq('#6b joinKeyOf 코드 대문자 정규화', EC.joinKeyOf({ type: 'stock', code: ' aapl ' }), 'stock|AAPL');
  eq('#6c joinKeyOf 코드 없으면 이름', EC.joinKeyOf({ type: 'savings', name: 'kb 이율보증' }), 'savings|@kb 이율보증');

  // ─ #7~#16 resolvePerShareAsOf ─
  const pf = basePf();
  eq('#7 배당락 경과 회차 채택(2026-07)', EC.resolvePerShareAsOf(pf, '0219E0', '2026-08-27', false).perShare, 153);
  eq('#7b 아직 배당락 전인 8월은 채택하지 않는다', EC.resolvePerShareAsOf(pf, '0219E0', '2026-08-27', false).ym, '2026-07');
  eq('#8 다가오는 회차는 upcoming으로만 노출', EC.resolvePerShareAsOf(pf, '0219E0', '2026-08-27', false).upcoming, { ym: '2026-08', perShare: 165 });
  eq('#9 배당락일 직전이면 직전 회차', EC.resolvePerShareAsOf(pf, '0219E0', '2026-07-29', false).ym, '2026-06');
  eq('#9b 배당락일 당일이면 그 회차', EC.resolvePerShareAsOf(pf, '0219E0', '2026-07-30', false).ym, '2026-07');
  eq('#10 실입금 기록이 있으면 source=paid', EC.resolvePerShareAsOf(
    { ...pf, actualDividend: { '0219E0': { '2026-07': 1000 } } }, '0219E0', '2026-08-27', false).source, 'paid');
  // ⚠️ 월중형(15일) 배당락: 배당락일이 비어 있어도 같은 월 다른 연도의 '일'을 빌려 판정한다.
  //    월말 폴백만 쓰면 8/27에 이번 달(8/14 배당락) 값을 못 써 지난달 값을 '확정'이라 단언한다.
  const midPf = {
    dividendHistory: { A1: { '2025-08': 140, '2026-07': 151, '2026-08': 165 } },
    dividendExDate: { A1: { '2025-08': '2025-08-14', '2026-07': '2026-07-14' } },
  };
  eq('#11 월중형: 같은 월 배당락 일(日) 차용으로 이번 달 채택', EC.resolvePerShareAsOf(midPf, 'A1', '2026-08-27', false).ym, '2026-08');
  eq('#11b 월중형: 배당락 전이면 직전 회차', EC.resolvePerShareAsOf(midPf, 'A1', '2026-08-13', false).ym, '2026-07');
  // 역산 — 공시 주당액이 없을 때만, 그리고 국내 과세계좌는 세액이 있을 때만.
  const derPf = (over) => ({
    dividendHistory: {}, actualDividend: { A1: { '2026-06': 84600 } },
    actualDividendQty: { A1: { '2026-06': 600 } }, ...over,
  });
  eq('#12 국내: 세액이 없으면 역산하지 않는다(세후를 세전이라 단언 금지)',
    EC.resolvePerShareAsOf(derPf(), 'A1', '2026-08-27', false).source, 'none');
  near('#12b 국내: 세액이 있으면 (세후+세액)/수량',
    EC.resolvePerShareAsOf(derPf({ dividendTaxAmounts: { A1: { '2026-06': 15400 } } }), 'A1', '2026-08-27', false).perShare, 166.666, 0.01);
  near('#12c 과세이연 계좌(연금)는 세액 없이 세후 = 세전',
    EC.resolvePerShareAsOf(derPf(), 'A1', '2026-08-27', false, true).perShare, 141, 0.001);
  eq('#12d 역산에 쓸 수량이 없으면 포기', EC.resolvePerShareAsOf(
    { dividendHistory: {}, actualDividend: { A1: { '2026-06': 84600 } }, dividendTaxAmounts: { A1: { '2026-06': 15400 } } },
    'A1', '2026-08-27', false).source, 'none');
  near('#12e 해외: 세전 USD를 그대로 역산', EC.resolvePerShareAsOf(
    { dividendHistory: {}, actualDividendUsd: { AAPL: { '2026-06': 45 } }, actualDividendQty: { AAPL: { '2026-06': 100 } } },
    'AAPL', '2026-08-27', true).perShare, 0.45, 1e-9);
  // 예상 폴백 — ⚠️ look-ahead 금지(비교일 이후 연도의 공시액을 끌어오면 안 된다).
  const laPf = { dividendHistory: { A1: { '2024-06': 140, '2025-01': 150, '2026-01': 165 } } };
  eq('#13 예상 폴백은 date 이전 달에서만 고른다(look-ahead 차단)',
    EC.resolvePerShareAsOf(laPf, 'A1', '2024-01-05', false).source, 'none');
  eq('#13b 예상 폴백: 같은 월의 가장 최근 이전 연도',
    EC.resolvePerShareAsOf(laPf, 'A1', '2026-01-20', false).ym, '2025-01');
  eq('#14 데이터가 없으면 0 + none', EC.resolvePerShareAsOf({}, 'ZZZZZZ', '2026-08-27', false),
    { perShare: 0, ym: '', source: 'none', derived: false, upcoming: null });
  eq('#15 날짜가 손상되면 조용히 0', EC.resolvePerShareAsOf(pf, '0219E0', 'bad-date', false).perShare, 0);

  // ─ #16~#33 buildEvalCompare ─
  const r = S('#16 사진2 픽스처로 모델 생성', () => EC.buildEvalCompare(baseInput()));
  if (r) {
    eq('#17 기준일 총액', Math.round(r.totals.basis.evalNative), 442785455);
    eq('#18 비교일 총액', Math.round(r.totals.compare.evalNative), 410120401);
    eq('#19 반사실 총액(비교일 수량 × 기준일 종가)', Math.round(r.totals.counter.evalNative), 443267466);
    eq('#20 평가금액 증감', Math.round(r.diffEval), 32665054);
    near('#21 증감율 = 증감 ÷ 비교일', r.diffRate * 100, 7.96, 0.005);
    near('#22 반사실 증감율', r.counterRate * 100, 8.08, 0.005);
    eq('#23 거래 효과 = 실제 − 반사실 − 순흐름', Math.round(r.tradeEffect), -482011);
    ok('#23b 거래 효과 산출 가능', r.tradeEffectValid === true);
    eq('#24 입출금이 없으면 순흐름 0', r.netFlow, 0);
    // ⚠️ 반사실은 손산식이 아니라 같은 함수를 기준일로 재호출한 값이어야 한다.
    const rB = U.resolveHoldings(basePf(), '2026-08-10');
    const direct = U.calcPortfolioEvalDetail(rB.items, 'portfolio', '2026-08-27', baseMap(), {}, 1, {});
    eq('#25 반사실 = calcPortfolioEvalDetail(비교일 items, 기준일)',
      Math.round(r.totals.counter.evalNative), Math.round(direct.total));
    // 행 단위
    const t1 = rowOf(r, '0177R0');
    eq('#26 행 수량(기준일/비교일)', [t1.basis.quantity, t1.compare.quantity], [12567, 12772]);
    eq('#26b 반사실 행은 비교일 수량 × 기준일 종가', [t1.counter.quantity, t1.counter.price], [12772, 11185]);
    eq('#27 주당분배금 기본값은 as-of 확정값', rowOf(r, '0219E0').basis.perShare.perShare, 153);
    eq('#28 분배금 = 수량 × 주당분배금', Math.round(t1.basis.dividend), 12567 * 151);
    eq('#29 예수금 행은 분배금 대상이 아니다', rowOf(r, '') ? rowOf(r, '').dividendEligible : false, false);
  }

  // 사용자 입력(원시 문자열) override — 사진2의 ④ 블록 값 재현
  const rOv = S('#30 주당분배금 직접 입력(문자열)', () => EC.buildEvalCompare(baseInput({
    perShareOverride: { basis: { 'stock|0219E0': '165', 'stock|498410': '144' } },
  })));
  if (rOv) {
    eq('#30b ① 분배금 합계(사진2)', Math.round(rOv.totals.basis.dividend), 6473106);
    eq('#30c ④ 분배금 합계(사진2)', Math.round(rOv.totals.counter.dividend), 6628702);
    eq('#30d 입력값은 source=manual', rowOf(rOv, '0219E0').basis.perShare.source, 'manual');
    eq('#30e ④는 기준일 주당분배금을 쓴다', rowOf(rOv, '0219E0').counter.perShare.perShare, 165);
    eq('#30f ②는 비교일 값을 유지한다', rowOf(rOv, '0219E0').compare.perShare.perShare, 153);
  }
  const rZero = S('#31 입력 0은 "분배 없음"으로 채택(빈칸과 다르다)', () => EC.buildEvalCompare(baseInput({
    perShareOverride: { basis: { 'stock|0177R0': '0' } },
  })));
  if (rZero) {
    // ⚠️ 직접 넣은 0은 '분배 없음' **확정**이다(빈칸=모름과 다르다) — null로 돌리면 방금 입력한
    //    사용자에게 "직접 입력하면 반영됩니다" 경고가 뜬다.
    eq('#31b 0 입력 → 분배금 0(확정, 빈 칸 아님)', rowOf(rZero, '0177R0').basis.dividend, 0);
    eq('#31b2 0 입력은 미확인으로 세지 않는다', rZero.totals.basis.dividendPartial, false);
    eq('#31b3 음수 입력은 채택하지 않고 자동값으로 되돌아간다',
      EC.buildEvalCompare(baseInput({ perShareOverride: { basis: { 'stock|0177R0': '-5' } } })).rows[0].basis.perShare.source, 'declared');
    eq('#31c 빈 문자열은 자동값 유지', EC.buildEvalCompare(baseInput({
      perShareOverride: { basis: { 'stock|0177R0': '' } },
    })).rows[0].basis.perShare.perShare, 151);
  }

  // 전량 매도 / 신규 편입
  const soldPf = basePf();
  soldPf.holdingSnapshots[1].items = soldPf.holdingSnapshots[1].items.filter(i => i.code !== '498410');
  const rSold = S('#32 전량 매도 종목', () => EC.buildEvalCompare(baseInput({ portfolio: soldPf })));
  if (rSold) {
    const s = rowOf(rSold, '498410');
    eq('#32b 기준일에는 보유 없음', [s.basis.held, s.basis.quantity, s.basis.evalAmount], [false, null, null]);
    eq('#32c 그래도 기준일 종가는 채운다(매도 후 주가 확인용)', s.basis.price, 11875);
    eq('#32d 반사실에는 그대로 남는다', Math.round(s.counter.evalNative), 10445 * 11875);
    ok('#32e 매도분이 반사실 총액에 포함돼 거래 효과가 달라진다', Math.round(rSold.totals.counter.evalNative) > Math.round(rSold.totals.basis.evalNative));
  }

  // 종가 미확보 — ⚠️ 0으로 단언하지 않고 null + priceMissing + 거래 효과 무효
  const rMiss = S('#33 기준일 종가 미확보', () => EC.buildEvalCompare(baseInput({
    stockHistoryMap: { ...baseMap(), '498410': { '2026-08-10': 11930 } },
  })));
  if (rMiss) {
    const m = rowOf(rMiss, '498410');
    eq('#33b 평가금은 0이 아니라 null', m.basis.evalAmount, null);
    ok('#33c priceMissing 플래그', m.basis.priceMissing === true && rMiss.totals.basis.priceMissing === true);
    ok('#33d 거래 효과를 단언하지 않는다', rMiss.tradeEffectValid === false);
  }

  // 순 외부현금흐름 — ⚠️ 빼지 않으면 입금액이 통째로 '거래 성과'가 된다
  const rFlow = S('#34 입금이 있으면 거래 효과에서 제외', () => EC.buildEvalCompare(baseInput({
    depositHistory: [{ id: 'd1', date: '2026-08-20', amount: 5000000 }], depositHistory2: [],
  })));
  if (rFlow) {
    eq('#34b netFlow', rFlow.netFlow, 5000000);
    eq('#34c 거래 효과 = 기존 − 입금액', Math.round(rFlow.tradeEffect), -482011 - 5000000);
  }
  const rNoPrin = S('#35 배당·이자 입금(noPrincipal)은 외부흐름이 아니다', () => EC.buildEvalCompare(baseInput({
    depositHistory: [{ id: 'd1', date: '2026-08-20', amount: 5000000, noPrincipal: true }], depositHistory2: [],
  })));
  if (rNoPrin) eq('#35b noPrincipal 입금은 netFlow에서 제외', rNoPrin.netFlow, 0);
  const rOut = S('#36 출금은 전액 흐름', () => EC.buildEvalCompare(baseInput({
    depositHistory: [], depositHistory2: [{ id: 'w1', date: '2026-08-20', amount: 3000000 }],
  })));
  if (rOut) eq('#36b 출금은 음수 흐름', rOut.netFlow, -3000000);
  // ⚠️ 구간은 반개구간 (비교일, 기준일] — 비교일 당일 입금은 이미 비교일 평가액에 들어 있다.
  const rEdge = S('#37 비교일 당일 입금은 흐름에서 제외', () => EC.buildEvalCompare(baseInput({
    depositHistory: [{ id: 'd1', date: '2026-08-10', amount: 1000000 }], depositHistory2: [],
  })));
  if (rEdge) eq('#37b 반개구간 (비교일, 기준일]', rEdge.netFlow, 0);
  const rEdge2 = S('#37c 기준일 당일 입금은 포함', () => EC.buildEvalCompare(baseInput({
    depositHistory: [{ id: 'd1', date: '2026-08-27', amount: 1000000 }], depositHistory2: [],
  })));
  if (rEdge2) eq('#37d 기준일 당일 포함', rEdge2.netFlow, 1000000);

  // 분모 0 — null 계약
  const emptyPf = {
    baselineDate: '2026-05-15', preBaselineVerified: true,
    holdingSnapshots: [
      { date: '2026-08-10', kind: 'auto', items: [] },
      { date: '2026-08-27', kind: 'auto', items: [CASH(1000)] },
    ],
  };
  const rZeroDen = S('#38 비교일 총액이 0', () => EC.buildEvalCompare(baseInput({ portfolio: emptyPf })));
  if (rZeroDen) eq('#38b 증감율은 0.00%가 아니라 null', [rZeroDen.diffRate, rZeroDen.counterRate], [null, null]);

  // 중복 코드 병합 — 해외 투자금액·구매단가
  const dupPf = {
    baselineDate: '2026-05-15', preBaselineVerified: true,
    holdingSnapshots: [
      { date: '2026-08-10', kind: 'auto', items: [
        { code: 'NVDA', name: 'NVDA', type: 'stock', quantity: 10, purchasePrice: 100, investAmount: 0, depositAmount: 0 },
        { code: 'NVDA', name: 'NVDA', type: 'stock', quantity: 10, purchasePrice: 200, investAmount: 0, depositAmount: 0 },
      ] },
      { date: '2026-08-27', kind: 'auto', items: [
        { code: 'NVDA', name: 'NVDA', type: 'stock', quantity: 20, purchasePrice: 150, investAmount: 0, depositAmount: 0 },
      ] },
    ],
  };
  const rDup = S('#39 같은 코드 2행(해외)', () => EC.buildEvalCompare({
    portfolio: dupPf, accountType: 'overseas', basisDate: '2026-08-27', compareDate: '2026-08-10',
    stockHistoryMap: { NVDA: { '2026-08-10': 180, '2026-08-27': 200 } },
    indicatorHistoryMap: { usdkrw: { '2026-08-10': 1300, '2026-08-27': 1400 } },
  }));
  if (rDup) {
    const n = rowOf(rDup, 'NVDA');
    eq('#39b 투자금액은 lot별 합($1,000+$2,000)', Math.round(n.compare.investAmount), 3000);
    near('#39c 구매단가는 수량 가중평균', n.compare.purchasePrice, 150, 1e-9);
    eq('#39d 해외 평가금은 USD 프레임', Math.round(n.compare.evalNative), 20 * 180);
    eq('#39e 원화 열은 그 날짜 환율 환산', Math.round(n.compare.evalAmount), 20 * 180 * 1300);
  }
  // ⚠️ 해외: 수량·종가가 완전히 같고 환율만 움직인 구간에서 증감이 0이어야 한다.
  const fxOnlyPf = {
    baselineDate: '2026-05-15', preBaselineVerified: true,
    holdingSnapshots: [{ date: '2026-08-01', kind: 'auto', items: [
      { code: 'AAPL', name: 'AAPL', type: 'stock', quantity: 100, purchasePrice: 100, investAmount: 0, depositAmount: 0 },
    ] }],
  };
  const rFx = S('#40 해외: 환율만 변한 구간', () => EC.buildEvalCompare({
    portfolio: fxOnlyPf, accountType: 'overseas', basisDate: '2026-08-27', compareDate: '2026-08-10',
    stockHistoryMap: { AAPL: { '2026-08-10': 200, '2026-08-27': 200 } },
    indicatorHistoryMap: { usdkrw: { '2026-08-10': 1300, '2026-08-27': 1400 } },
  }));
  if (rFx) {
    eq('#40b USD 증감 0 (환율 효과가 섞이지 않는다)', Math.round(rFx.diffEval), 0);
    eq('#40c 원화 총액은 환율만큼 다르다(레벨 열 전용)',
      [Math.round(rFx.totals.basis.evalAmount), Math.round(rFx.totals.compare.evalAmount)], [100 * 200 * 1400, 100 * 200 * 1300]);
    eq('#40d 거래 효과 0', Math.round(rFx.tradeEffect), 0);
  }

  // 분배금 부분 집계
  const rPartial = S('#41 주당분배금 미확인 종목', () => EC.buildEvalCompare(baseInput({
    portfolio: { ...basePf(), dividendHistory: { '0177R0': { '2026-07': 151 } }, dividendExDate: { '0177R0': { '2026-07': '2026-07-30' } } },
  })));
  if (rPartial) {
    ok('#41b dividendPartial 플래그', rPartial.totals.basis.dividendPartial === true);
    ok('#41c 분배금 차이도 부분값임을 알린다', rPartial.tradeEffectDividendPartial === true);
  }

  // 예적금·펀드가 섞인 반사실 — 예적금은 기준일까지 이자가 더 붙는 것이 정상
  const savPf = {
    baselineDate: '2026-05-15', preBaselineVerified: true,
    holdingSnapshots: [{ date: '2026-08-10', kind: 'auto', items: [
      { code: '', name: 'kb 이율보증', type: 'savings', quantity: 0, investAmount: 12000000, depositAmount: 0,
        annualRate: 3.65, startDate: '2026-01-01', endDate: '2027-01-01',
        deposits: [{ date: '2026-01-01', amount: 12000000 }] },
    ] }],
  };
  const rSav = S('#42 예적금 반사실', () => EC.buildEvalCompare({
    portfolio: savPf, accountType: 'dc-irp', basisDate: '2026-08-27', compareDate: '2026-08-10',
    stockHistoryMap: {}, indicatorHistoryMap: {},
  }));
  if (rSav) {
    const sv = rSav.rows[0];
    ok('#42b 예적금은 기준일까지 이자가 더 붙는다(반사실 정의상 정상)',
      sv.counter.evalNative > sv.compare.evalNative);
    eq('#42c 예적금은 수량·종가가 없다', [sv.compare.quantity, sv.compare.price], [null, null]);
  }

  // ── #69~#73 적대적 리뷰(구현)가 실측으로 잡은 결함들의 회귀 테스트 ────────
  // ⚠️ 금현물 계좌는 `KrxGoldTable`에 종목명·코드 입력칸이 **아예 없어** `code:'' name:''`가 기본
  //    상태다. `calcPortfolioEvalDetail`이 그 항목에 'KRX 금현물'을 대입하므로, detail 쪽 키로
  //    조인하면 원본(`stock|@`)과 어긋나 행이 통째로 '보유 없음'이 되고 값은 TOTAL에만 남는다.
  const goldPf = {
    baselineDate: '2026-01-01', preBaselineVerified: true,
    holdingSnapshots: [
      { date: '2026-08-10', kind: 'auto', items: [
        { code: '', name: '', type: 'stock', quantity: 10, investAmount: 1500000, purchasePrice: 150000, depositAmount: 0 },
        CASH(500000),
      ] },
      { date: '2026-08-27', kind: 'auto', items: [
        { code: '', name: '', type: 'stock', quantity: 20, investAmount: 3100000, purchasePrice: 155000, depositAmount: 0 },
        CASH(500000),
      ] },
    ],
  };
  const rGold = S('#69 금현물 계좌(코드·이름 없음)', () => EC.buildEvalCompare({
    portfolio: goldPf, accountType: 'gold', basisDate: '2026-08-27', compareDate: '2026-08-10',
    stockHistoryMap: {}, indicatorHistoryMap: { goldKr: { '2026-08-10': 150000, '2026-08-27': 160000 } },
  }));
  if (rGold) {
    const g = rGold.rows[0];
    eq('#69b 금현물 행이 보유로 잡힌다(빈 칸이 되지 않는다)',
      [g.basis.held, g.basis.quantity, Math.round(g.basis.evalNative)], [true, 20, 20 * 160000]);
    eq('#69c 행 값의 합 = TOTAL(조용한 모순 없음)',
      Math.round(g.basis.evalNative + rGold.rows[1].basis.evalNative), Math.round(rGold.totals.basis.evalNative));
    eq('#69d ③ 수량 증감이 0이 아니다', g.basis.quantity - g.compare.quantity, 10);
  }
  const savUnnamed = {
    baselineDate: '2026-01-01', preBaselineVerified: true,
    holdingSnapshots: [{ date: '2026-08-10', kind: 'auto', items: [
      { code: '', name: '', type: 'savings', quantity: 0, investAmount: 12000000, depositAmount: 0,
        annualRate: 3.65, startDate: '2026-01-01', endDate: '2027-01-01',
        deposits: [{ date: '2026-01-01', amount: 12000000 }] },
    ] }],
  };
  const rSavU = S('#70 이름을 아직 넣지 않은 예적금', () => EC.buildEvalCompare({
    portfolio: savUnnamed, accountType: 'dc-irp', basisDate: '2026-08-27', compareDate: '2026-08-10',
    stockHistoryMap: {}, indicatorHistoryMap: {},
  }));
  if (rSavU) {
    ok('#70b 예적금 행이 보유로 잡힌다', rSavU.rows[0].basis.held === true && rSavU.rows[0].basis.evalNative > 0);
    eq('#70c 행 값 = TOTAL', Math.round(rSavU.rows[0].basis.evalNative), Math.round(rSavU.totals.basis.evalNative));
  }

  // ⚠️ 원장 입금일과 예수금 반영일이 어긋나는 것은 **구조적 정상**이다(`DepositPanel`은 `portfolio`를
  //    참조하지 않는다). 그 구간에서 순흐름을 그대로 빼면 입금액 전액이 가짜 손실이 된다.
  const flatItems = (cash) => [
    { code: '0177R0', name: 'A', type: 'stock', quantity: 1000, investAmount: 10000000, purchasePrice: 10000, depositAmount: 0 },
    CASH(cash),
  ];
  const flowInput = (basisCash) => ({
    portfolio: {
      baselineDate: '2026-05-15', preBaselineVerified: true,
      holdingSnapshots: [
        { date: '2026-08-10', kind: 'auto', items: flatItems(1000000) },
        { date: '2026-08-27', kind: 'auto', items: flatItems(basisCash) },
      ],
    },
    accountType: 'portfolio', basisDate: '2026-08-27', compareDate: '2026-08-10',
    stockHistoryMap: { '0177R0': { '2026-08-10': 10000, '2026-08-27': 10100 } }, indicatorHistoryMap: {},
    depositHistory: [{ id: 'd1', date: '2026-08-20', amount: 10000000 }], depositHistory2: [],
  });
  const rNoRefl = S('#71 원장 입금이 아직 반영되지 않은 구간', () => EC.buildEvalCompare(flowInput(1000000)));
  if (rNoRefl) {
    eq('#71b 장부액 변화 0 관측', Math.round(rNoRefl.bookDelta), 0);
    eq('#71c 흐름 미반영 → 거래 효과를 단언하지 않는다',
      [rNoRefl.flowReflected, rNoRefl.tradeEffectValid], [false, false]);
  }
  const rRefl = S('#71d 입금이 예수금에 반영된 구간', () => EC.buildEvalCompare(flowInput(11000000)));
  if (rRefl) {
    eq('#71e 장부액이 흐름을 설명하면 정상 산출',
      [rRefl.flowReflected, rRefl.tradeEffectValid], [true, true]);
    // 매매가 없으면 시세 변동은 실제·반사실 양쪽에 똑같이 들어가 상쇄된다 → 거래 효과 0이 정답.
    eq('#71f 매매가 없으면 거래 효과 0(입금액이 손익으로 새지 않는다)', Math.round(rRefl.tradeEffect), 0);
  }
  // 소액 흐름(비교일 총액의 1% 이하)은 판정 대상이 아니다 — 정상 산출되어야 한다.
  const rTiny = S('#71g 소액 흐름은 면제', () => EC.buildEvalCompare({
    ...flowInput(1000000), depositHistory: [{ id: 'd1', date: '2026-08-20', amount: 50000 }],
  }));
  if (rTiny) eq('#71h 소액 흐름은 미반영이어도 산출한다', rTiny.tradeEffectValid, true);

  // ⚠️ 과거 비교일 칸에 몇 달 뒤 회차를 '아직 배당락 전'이라며 제시하면 안 된다(UI look-ahead).
  const farPf = { dividendHistory: { A1: { '2026-06': 100, '2026-07': 110, '2026-08': 120 } } };
  eq('#72 먼 미래 회차는 upcoming으로 제시하지 않는다',
    EC.resolvePerShareAsOf(farPf, 'A1', '2026-01-15', false).upcoming, null);
  eq('#72b 2개월 안의 다가오는 회차는 제시한다',
    EC.resolvePerShareAsOf(farPf, 'A1', '2026-05-20', false).upcoming, { ym: '2026-06', perShare: 100 });
  eq('#72c addMonthsYm 연도 넘김', [EC.addMonthsYm('2026-11', 2), EC.addMonthsYm('bad', 1)], ['2027-01', '']);

  // diffOf / diffRateOf null 계약
  eq('#43 diffOf null 계약', [EC.diffOf(5, null), EC.diffOf(null, 5), EC.diffOf(5, 3)], [null, null, 2]);
  eq('#43b diffRateOf 분모 0이면 null', [EC.diffRateOf(5, 0), EC.diffRateOf(6, 3)], [null, 1]);

  // ── 파트② 시트 · ZIP ──────────────────────────────────────────────────────
  console.log('\n── 파트② 시트 모델 · ZIP 되읽기 ──');
  const sheet = S('#44 시트 생성', () => EX.buildEvalCompareSheet({ ...baseInput(), accountName: 'COVERD 4' }));
  if (sheet) {
    const txt = sheet.rows.map(row => row.map(c => (c && c.t === 's' ? c.v : '')).join('')).join('\n');
    ok('#45 ① 기준일 블록 캡션', /① 기준일 {2}2026-08-27/.test(txt));
    ok('#45b ② 비교일 블록 캡션', /② 비교일 {2}2026-08-10/.test(txt));
    ok('#45c ③ 증감 블록 캡션', /③ 증감/.test(txt));
    ok('#45d ④ 반사실 블록 캡션', /④ 비교일 수량 × 기준일 종가/.test(txt));
    ok('#46 거래 효과 캡션', /거래 효과 = 실제 기준일 총액 − 반사실 총액/.test(txt));
    ok('#47 각주(빈 칸은 0이 아니다)', /빈 칸은 0이 아니라/.test(txt));
    eq('#48 열 수(국내 10열)', sheet.cols.length, 10);
    eq('#48b 틀 고정 2행', sheet.freezeRows, 2);
    // 헤더 행 4개(블록마다 1개)
    const headerRows = sheet.rows.filter(row => row[0] && row[0].v === '종목명');
    eq('#49 블록 헤더 4개', headerRows.length, 4);
    eq('#49b ③ 블록 헤더는 증감 라벨', headerRows[2].map(c => c.v).slice(2, 6), ['종가 차익', '구매단가 증감', '수량 증감', '투자금액 증감']);
    eq('#49c ④ 블록 8번 열은 증감율(비중 아님)', headerRows[3][7].v, '평가금 증감율');
    // TOTAL 행 4개 + 퍼센트는 분수 저장
    const totals = sheet.rows.filter(row => row[0] && row[0].v === 'TOTAL');
    eq('#50 TOTAL 행 4개', totals.length, 4);
    const pctCell = totals[0][7];
    eq('#50b ① TOTAL 비중은 분수 1(100%)', pctCell.v, 1);
    near('#50c ③ TOTAL 증감율은 분수 저장', totals[2][7].v, 0.0796, 0.0001);
    near('#50d ④ TOTAL 증감율', totals[3][7].v, 0.0808, 0.0001);
    ok('#50e 퍼센트 서식은 % 코드', /%/.test(sheet.styles[pctCell.s].numFmt || ''));
    // 병합 칸은 같은 스타일 빈 셀로 채워야 배경·테두리가 끊기지 않는다
    const cap = sheet.rows.findIndex(row => row[0] && String(row[0].v).startsWith('① 기준일'));
    ok('#51 병합 행의 덮이는 칸이 같은 스타일로 채워져 있다',
      sheet.rows[cap].every(c => c && c.s === sheet.rows[cap][0].s));
    // 그 날짜에 보유하지 않은 종목은 그 블록에서 **빠진다**(사용자 확정 2026-08).
    // ⚠️ 그래도 '매도 후 주가'는 사라지지 않는다 — ④가 비교일 수량 × 기준일 종가로 계속 그린다.
    //    (#52b가 원래 지키던 목적이 ①에서 ④로 옮겨 갔다.)
    // ⚠️ `findIndex`로 '첫 498410 행'을 집는 옛 방식으로 되돌리지 말 것 — 블록마다 그 종목의
    //    유무가 다르므로 어느 블록을 집었는지 알 수 없다(블록을 지정해 특정한다).
    const sheetSold = EX.buildEvalCompareSheet({ ...baseInput({ portfolio: soldPf }), accountName: 'A' });
    const bSold = blocksOf(sheetSold);
    ok('#52 기준일에 매도한 종목은 ① 블록에서 빠진다', bodyRow(sheetSold, bSold[0], '498410') === null);
    const soldCounter = bodyRow(sheetSold, bSold[3], '498410');
    eq('#52b 매도 종목은 ④에 남는다 — 비교일 수량 × 기준일 종가',
      [cellNum(soldCounter, CL.qty), cellNum(soldCounter, CL.price), Math.round(cellNum(soldCounter, CL.eval))],
      [10445, 11875, 10445 * 11875]);
    ok('#52c ②(비교일)에도 남는다', bodyRow(sheetSold, bSold[1], '498410') !== null);
  }
  // 해외 시트 — ③ 블록에는 원화 열을 채우지 않는다
  const sheetOv = S('#53 해외 시트', () => EX.buildEvalCompareSheet({
    portfolio: dupPf, accountType: 'overseas', basisDate: '2026-08-27', compareDate: '2026-08-10',
    stockHistoryMap: { NVDA: { '2026-08-10': 180, '2026-08-27': 200 } },
    indicatorHistoryMap: { usdkrw: { '2026-08-10': 1300, '2026-08-27': 1400 } },
    accountName: 'US',
  }));
  if (sheetOv) {
    eq('#53b 해외는 11열(₩ 동반 열)', sheetOv.cols.length, 11);
    const hdrs = sheetOv.rows.filter(row => row[0] && row[0].v === '종목명');
    eq('#53c ③ 블록의 원화 열 헤더는 비운다(환율 시점이 섞인다)', hdrs[2][7].v, '—');
    const diffHdrIdx = sheetOv.rows.findIndex(row => row[0] && row[0].v === '종목명' && row[2].v === '종가 차익');
    ok('#53d ③ 블록 본문의 원화 열은 빈 셀', sheetOv.rows[diffHdrIdx + 1][7] === null);
    ok('#53e ①② 블록에는 원화 열을 채운다', sheetOv.rows.some(row => row[7] && row[7].t === 'n' && Math.round(row[7].v) === 20 * 180 * 1300));
  }
  // ZIP 되읽기
  const bytes = S('#54 xlsx 바이트 생성', () => EX.buildEvalCompareXlsx({ ...baseInput(), accountName: 'COVERD 4' }, new Date('2026-08-27T12:00:00Z')));
  if (bytes) {
    const files = S('#55 ZIP 파싱', () => unzipStore(bytes));
    if (files) {
      eq('#55b 파트 6개', files.length, 6);
      eq('#55c 파트 이름', files.map(f => f.name).sort(), [
        '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
        'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
      ].sort());
      ok('#55d 압축 방식 STORE + 크기 일치', files.every(f => f.method === 0 && f.sizeOk));
      const ws = files.find(f => f.name === 'xl/worksheets/sheet1.xml').text;
      eq('#56 worksheet 자식 순서', orderOf(ws, ['<dimension', '<sheetViews', '<sheetFormatPr', '<cols', '<sheetData', '<mergeCells']), 'OK');
      const st = files.find(f => f.name === 'xl/styles.xml').text;
      eq('#56b styleSheet 자식 순서', orderOf(st, ['<numFmts', '<fonts', '<fills', '<borders', '<cellStyleXfs', '<cellXfs', '<cellStyles']), 'OK');
      ok('#56c 예약 fill 2개 유지', /<fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/><\/fill>/.test(st));
      ok('#57 한글이 UTF-8로 그대로 실린다', ws.includes('기준일'));
      ok('#57b 계좌명이 workbook.xml에 들어간다', files.find(f => f.name === 'xl/workbook.xml').text.includes('COVERD 4'));
      ok('#57c NaN/Infinity가 없다', !/<v>(NaN|Infinity|-Infinity)<\/v>/.test(ws));
    }
  }
  // 파일명
  eq('#58 파일명 규칙', EX.evalCompareFileName('2026-08-10', '2026-08-27', 'COVERD 4'), '260810-260827_COVERD 4_비교.xlsx');
  eq('#58b 날짜가 손상되면 접두사 생략', EX.evalCompareFileName('bad', 'bad', 'A'), 'A_비교.xlsx');
  eq('#58c 계좌명 폴백', EX.evalCompareFileName('2026-08-10', '2026-08-27', '  '), '260810-260827_계좌_비교.xlsx');
  eq('#59 날짜 라벨(요일)', EX.dateLabel('2026-08-27'), '2026-08-27 (목)');
  const sheetNoRefl = S('#74 흐름 미반영 시트', () => EX.buildEvalCompareSheet({ ...flowInput(1000000), accountName: 'A' }));
  if (sheetNoRefl) {
    const t = sheetNoRefl.rows.map(row => row.map(c => (c && c.t === 's' ? c.v : '')).join('')).join(String.fromCharCode(10));
    ok('#74b 미반영 경고 배너', /아직 평가액·예수금에 반영되지 않은 것으로 보입니다/.test(t));
    ok('#74c 거래 효과를 숫자로 단언하지 않는다', /거래 효과 산출 불가 — 원장의 입출금/.test(t));
  }

  // ── 파트②-b 시트 **셀 값** 단언 ────────────────────────────────────────────
  // ⚠️ 구조만 보는 단언은 본문을 통째로 바꿔치기해도 통과한다(적대적 리뷰 실측) — 실제 값을 못 박는다.
  if (sheet) {
    const B = blocksOf(sheet);
    const t1a = bodyRow(sheet, B[0], '0177R0');
    eq('#60 ① 본문 = 그날 보유수량 × 그날 종가',
      [cellNum(t1a, CL.price), cellNum(t1a, CL.qty), Math.round(cellNum(t1a, CL.eval))],
      [11185, 12567, 140561895]);
    eq('#60b ① 분배금 = 수량 × 주당분배금', [Math.round(cellNum(t1a, CL.div)), cellNum(t1a, CL.perShare)], [12567 * 151, 151]);
    near('#60c ① 평가비중', cellNum(t1a, CL.ratio), 140561895 / 442785455, 1e-9);
    const t1b = bodyRow(sheet, B[1], '0177R0');
    eq('#61 ② 본문 = 비교일 보유수량 × 비교일 종가',
      [cellNum(t1b, CL.price), cellNum(t1b, CL.qty), Math.round(cellNum(t1b, CL.eval))],
      [9940, 12772, 126953680]);
    const t1c = bodyRow(sheet, B[2], '0177R0');
    eq('#62 ③ 본문 = 기준일 − 비교일',
      [cellNum(t1c, CL.price), cellNum(t1c, CL.qty), Math.round(cellNum(t1c, CL.eval))],
      [1245, -205, 13608215]);
    near('#62b ③ 증감율 = 증감 ÷ 비교일', cellNum(t1c, CL.ratio), 13608215 / 126953680, 1e-9);
    const t1d = bodyRow(sheet, B[3], '0177R0');
    // ⚠️ ④는 **비교일 수량 × 기준일 종가**다 — ②를 복사해 오면 여기서 잡힌다.
    eq('#63 ④ 본문 = 비교일 수량 × 기준일 종가',
      [cellNum(t1d, CL.price), cellNum(t1d, CL.qty), Math.round(cellNum(t1d, CL.eval))],
      [11185, 12772, 142854820]);
    near('#63b ④ 종목별 증감율 = 순수 시세 변동', cellNum(t1d, CL.ratio), (142854820 - 126953680) / 126953680, 1e-9);
    // TOTAL 금액
    const T = B.map(b => sheet.rows[b.total]);
    eq('#64 ① TOTAL 평가금액', Math.round(cellNum(T[0], CL.eval)), 442785455);
    eq('#64b ② TOTAL 평가금액', Math.round(cellNum(T[1], CL.eval)), 410120401);
    eq('#64c ③ TOTAL 증감', Math.round(cellNum(T[2], CL.eval)), 32665054);
    eq('#64d ④ TOTAL 반사실 평가금액', Math.round(cellNum(T[3], CL.eval)), 443267466);
    eq('#64e ① TOTAL 투자금액', Math.round(cellNum(T[0], CL.invest)), 146760387 + 162201468 + 128373267 + 17549765);
    // 분배금 TOTAL — ①과 ④가 서로 다른 주당분배금을 쓰는 override 픽스처로 확인한다(사진2 값).
    const sheetOv = EX.buildEvalCompareSheet({
      ...baseInput({ perShareOverride: { basis: { 'stock|0219E0': '165', 'stock|498410': '144' } } }),
      accountName: 'COVERD 4',
    });
    const TO = blocksOf(sheetOv).map(b => sheetOv.rows[b.total]);
    eq('#65 ① TOTAL 분배금(사진2)', Math.round(cellNum(TO[0], CL.div)), 6473106);
    eq('#65b ④ TOTAL 분배금(사진2)', Math.round(cellNum(TO[3], CL.div)), 6628702);
    eq('#65c ③ TOTAL 분배금 증감', Math.round(cellNum(TO[2], CL.div)), 6473106 - 6500712);
  }
  // ③은 두 날짜 **모두** 보유한 종목만(사용자 확정) — 전량 매도는 개별 행이 아니라 집계 행이 받는다.
  // ⚠️ 집계 행이 없으면 '표시 행 합 ≠ TOTAL'이 되고, 같은 TOTAL 행 안에서 분배금만 '행이 못
  //    받치면 비운다'(#73b)이고 평가금액·투자금액·증감율은 '행이 못 받쳐도 단언한다'가 되어
  //    규약이 갈린다(실측: 교집합 합 +33,762,029 vs TOTAL −90,846,821 — 부호까지 반대).
  const sheetSold2 = S('#66 전량 매도 시트', () => EX.buildEvalCompareSheet({ ...baseInput({ portfolio: soldPf }), accountName: 'A' }));
  if (sheetSold2) {
    const b3 = blocksOf(sheetSold2)[2];
    ok('#66b ③에는 전량 매도 종목의 개별 행이 없다', bodyRow(sheetSold2, b3, '498410') === null);
    const aggSell = labelRow(sheetSold2, b3, '전량 매도·이관');
    eq('#66c ③ 전량 매도 집계 행 = −(비교일 수량 × 비교일 종가)',
      Math.round(cellNum(aggSell, CL.eval)), -(10445 * 11930));
    eq('#66d ③ 표시 행 합(집계 포함) = ③ TOTAL',
      Math.round(sumCol(sheetSold2, b3, CL.eval)), Math.round(cellNum(sheetSold2.rows[b3.total], CL.eval)));
    eq('#66e 투자금액도 같은 항등식',
      Math.round(sumCol(sheetSold2, b3, CL.invest)), Math.round(cellNum(sheetSold2.rows[b3.total], CL.invest)));
  }
  // 경고 배너 · 거래 효과 무효 — 렌더 단계에서 사라지면 사용자가 과소 집계를 모른다.
  const sheetMiss = S('#67 종가 미확보 시트', () => EX.buildEvalCompareSheet({
    ...baseInput({ stockHistoryMap: { ...baseMap(), '498410': { '2026-08-10': 11930 } } }), accountName: 'A',
  }));
  if (sheetMiss) {
    const txtMiss = sheetMiss.rows.map(row => row.map(c => (c && c.t === 's' ? c.v : '')).join('')).join(String.fromCharCode(10));
    ok('#67b 종가 미확보 경고 배너', /⚠ 기준일 2026-08-27의 종가를 구하지 못한/.test(txtMiss));
    ok('#67c 거래 효과를 숫자로 단언하지 않는다', /거래 효과 산출 불가/.test(txtMiss));
  }
  // ⚠️ 한쪽이라도 '주당분배금 미확인'을 품으면 두 부분합의 차는 임의로 틀릴 수 있다 → ③ TOTAL은 비운다.
  const sheetPart = S('#73 분배금 부분 확정 시트', () => EX.buildEvalCompareSheet({
    ...baseInput({ portfolio: { ...basePf(), dividendHistory: { '0177R0': { '2026-07': 151 } }, dividendExDate: { '0177R0': { '2026-07': '2026-07-30' } } } }),
    accountName: 'A',
  }));
  if (sheetPart) {
    const bp = blocksOf(sheetPart);
    // TOTAL 행은 정렬을 위해 빈 문자열 셀로 채워지므로 '숫자가 아님'으로 단언한다.
    ok('#73b ③ TOTAL 분배금은 빈 칸(행은 빈 칸인데 합계만 숫자를 단언하지 않는다)',
      (sheetPart.rows[bp[2].total][CL.div] || {}).t !== 'n');
    ok('#73c ① TOTAL 분배금은 하한으로 남긴다(배너가 과소를 고지)',
      (sheetPart.rows[bp[0].total][CL.div] || {}).t === 'n');
  }
  const sheetFlow = S('#68 순입출금 시트', () => EX.buildEvalCompareSheet({
    ...baseInput({ depositHistory: [{ id: 'd1', date: '2026-08-20', amount: 5000000 }], depositHistory2: [] }),
    accountName: 'A',
  }));
  if (sheetFlow) {
    const txtFlow = sheetFlow.rows.map(row => row.map(c => (c && c.t === 's' ? c.v : '')).join('')).join(String.fromCharCode(10));
    ok('#68b 순입출금 경고 배너(③ 증감율에 포함됨을 고지)', /순입출금 ₩5,000,000이 있습니다/.test(txtFlow));
    ok('#68c 거래 효과 캡션이 순입출금 제외를 명시', /순입출금 ₩5,000,000 제외/.test(txtFlow));
  }
}

// ── 파트②-c 블록별 행 필터 (사용자 확정 2026-08) ────────────────────────────
// ⚠️ 아래 5종은 전부 '변이를 넣어도 스위트가 초록이었다'는 실측에서 나온 가드다
//    (② 필터 해제 / ④를 basis 기준으로 오배선 / 집계 행 삭제 / 안내 행 삭제 / TOTAL을 표시 합으로 교체).
//    존재 여부가 아니라 **블록별 라벨 집합**을 통째로 단언해야 그 변이들이 한 번에 잡힌다.
{
  // 편입 1종목 + 매도 1종목이 동시에 있는 픽스처(soldPf는 매도만 있어 ①·④ 변이를 못 잡는다).
  const mixPf = basePf();
  mixPf.holdingSnapshots[1].items = mixPf.holdingSnapshots[1].items
    .filter(i => i.code !== '498410')
    .concat([ST('NEW777', '신규 편입 ETF', 1000, 10000000, 10000)]);
  const mixMap = { ...baseMap(), NEW777: { '2026-08-10': 9000, '2026-08-27': 10500 } };
  const sheetMix = S('#75 필터 시트(편입 1 · 매도 1)', () => EX.buildEvalCompareSheet({
    ...baseInput({ portfolio: mixPf, stockHistoryMap: mixMap }), accountName: 'A',
  }));
  if (sheetMix) {
    const BM = blocksOf(sheetMix);
    const NM = { a: 'TIGER 반도체TOP10커버드콜액티브', b: 'KODEX 200커버드콜액티브', cash: '예수금 (CASH)' };
    eq('#75b ① = 기준일 보유만(신규 편입 포함 · 매도 제외)',
      labelsOf(sheetMix, BM[0]), [NM.a, NM.b, NM.cash, '신규 편입 ETF']);
    // ⚠️ 순서가 '기준일 보유 순서 → 기준일에 없는 비교일 보유'라 매도 종목이 맨 뒤로 밀린다
    //    (자산검증 창의 종목 순서와 다를 수 있다 — 각주가 이 사실을 고지한다).
    eq('#75c ② = 비교일 보유만(매도 포함 · 신규 편입 제외)',
      labelsOf(sheetMix, BM[1]), [NM.a, NM.b, NM.cash, 'KODEX 금융고배당TOP10타겟위클리커버드콜']);
    eq('#75d ③ = 교집합 + 집계 2행',
      labelsOf(sheetMix, BM[2]).map(s => s.split(' —')[0]),
      [NM.a, NM.b, NM.cash, '신규 편입 (1종목)', '전량 매도·이관 (1종목)']);
    eq('#75e ④ = 비교일 보유만(= ②와 같은 종목 집합)',
      labelsOf(sheetMix, BM[3]), labelsOf(sheetMix, BM[1]));
    // ④에서 매도 종목이 '비교일 수량 × 기준일 종가'로 그려진다 — ④를 basis 기준으로 오배선하면 사라진다.
    const mSold = bodyRow(sheetMix, BM[3], '498410');
    eq('#75f ④ 매도 종목 = 비교일 수량 × 기준일 종가',
      [cellNum(mSold, CL.qty), cellNum(mSold, CL.price)], [10445, 11875]);
    // 신규 편입 종목의 '편입 전 종가'는 ②에 남지 않는다(사양 — 조용한 잔존 방지).
    ok('#75g ②에 신규 편입 종목이 없다', bodyRow(sheetMix, BM[1], 'NEW777') === null);
    for (let k = 0; k < 4; k++) {
      eq(`#75h 블록 ${k + 1} 표시 행 합 = TOTAL(평가금액)`,
        Math.round(sumCol(sheetMix, BM[k], CL.eval)), Math.round(cellNum(sheetMix.rows[BM[k].total], CL.eval)));
    }
    // 교집합만으로는 TOTAL이 재구성되지 않는다는 사실을 함께 못 박는다(집계 행이 죽은 단언이 되지 않게).
    const interOnly = [BM[2].bodyFrom, BM[2].bodyFrom + 1, BM[2].bodyFrom + 2]
      .reduce((s, i) => s + (cellNum(sheetMix.rows[i], CL.eval) || 0), 0);
    ok('#75i 교집합 행만의 합은 ③ TOTAL과 다르다(집계 행이 실제로 일한다)',
      Math.abs(interOnly - cellNum(sheetMix.rows[BM[2].total], CL.eval)) > 1);
  }

  // 수량 0 주식 — 자산검증 화면에는 '수량 0 · 평가금 ₩0'으로 보인다.
  // ⚠️ 필터를 `held`로 걸면 이 행이 네 블록에서 전부 사라진다(화면에 있는 행이 시트에 없다).
  const zeroPf = basePf();
  zeroPf.holdingSnapshots.forEach(s => s.items.push(ST('ZERO01', '수량 0 종목', 0, 0, 0)));
  const sheetZero = S('#76 수량 0 종목 시트', () => EX.buildEvalCompareSheet({
    ...baseInput({ portfolio: zeroPf, stockHistoryMap: { ...baseMap(), ZERO01: { '2026-08-10': 5000, '2026-08-27': 5500 } } }),
    accountName: 'A',
  }));
  if (sheetZero) {
    const BZ = blocksOf(sheetZero);
    eq('#76b 수량 0 종목이 네 블록에 모두 남는다(present ≠ held)',
      [0, 1, 2, 3].map(k => bodyRow(sheetZero, BZ[k], 'ZERO01') !== null), [true, true, true, true]);
  }

  // 비교일 보유 0건 — 안내 행 + '평가비중 100%' 미단언
  const emptyCmpPf = basePf();
  emptyCmpPf.holdingSnapshots[0].items = [];
  const sheetEmpty = S('#77 비교일 보유 0건 시트', () => EX.buildEvalCompareSheet({
    ...baseInput({ portfolio: emptyCmpPf }), accountName: 'A',
  }));
  if (sheetEmpty) {
    const BE = blocksOf(sheetEmpty);
    eq('#77b ② 빈 블록은 안내 행 1줄', labelsOf(sheetEmpty, BE[1]), ['— 이 날짜에 보유한 종목이 없습니다 —']);
    eq('#77c ④ 빈 블록도 안내 행 1줄', labelsOf(sheetEmpty, BE[3]), ['— 이 날짜에 보유한 종목이 없습니다 —']);
    ok('#77d 빈 블록의 TOTAL은 평가비중을 단언하지 않는다', cellNum(sheetEmpty.rows[BE[1].total], CL.ratio) === null);
    ok('#77e 블록 헤더 4개·TOTAL 4개는 유지', sheetEmpty.rows.filter(r => r[0] && r[0].v === '종목명').length === 4
      && sheetEmpty.rows.filter(r => r[0] && r[0].v === 'TOTAL').length === 4);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트③ 소스 텍스트 가드 (선언이 아니라 사용부) ──');

const MODEL_RAW = read('src/evalCompare.ts');
const MODEL = stripComments(MODEL_RAW);
const XLS_RAW = read('src/evalCompareExcel.ts');
const XLS = stripComments(XLS_RAW);
const MODAL_RAW = read('src/components/VerifyEvalModal.tsx');
const MODAL = stripComments(MODAL_RAW);
const PX = read('src/portfolioExcel.ts');
const PKG = JSON.parse(read('package.json'));

// 읽기 전용 계약
ok('#G1 모델·시트 모듈이 저장/네트워크/전역 상태를 건드리지 않는다',
  !/localStorage|sessionStorage|fetch\(|saveDriveFile|setPortfolios|patchActive/.test(MODEL + XLS));
ok('#G2 dividendHistory에 쓰지 않는다(API 새로고침이 덮어써 사용자 입력이 소실된다)',
  !/dividendHistory\s*(\[[^\]]*\])*\s*=[^=]/.test(MODEL + XLS));
ok('#G3 stockHistoryMap에 쓰지 않는다(평가액 재계산의 권위 소스)',
  !/stockHistoryMap\s*\[[^\]]*\]\s*=[^=]/.test(MODEL + XLS));
ok('#G4 모듈에 인자 없는 new Date()가 없다(파일명·캡션이 하루 밀린다)',
  !/new Date\(\s*\)/.test(MODEL + XLS));
ok('#G5 상대 import에 .ts 확장자 유지(Node 직접 import 계약)',
  /from '\.\/utils\.ts'/.test(MODEL) && /from '\.\/xlsxWriter\.ts'/.test(XLS) && /from '\.\/evalCompare\.ts'/.test(XLS));
ok('#G6 모듈이 hooks/*(React)를 import하지 않는다',
  !/from '\.\.?\/hooks\//.test(MODEL + XLS));
ok('#G7 enum/namespace 미사용(타입 스트리핑)', !/\b(enum|namespace)\s+\w/.test(MODEL + XLS));

// 산식 배선
ok('#G8 반사실은 같은 함수를 기준일로 재호출한다(손산식 금지)',
  /const C = calcSide\(itemsB0, basisDate/.test(MODEL) && /const B = calcSide\(itemsB0, compareDate/.test(MODEL));
ok('#G9 거래 효과에서 순 외부현금흐름을 뺀다',
  /externalFlowInRange\(/.test(MODEL) && /tradeEffect:\s*totals\.basis\.evalNative - totals\.counter\.evalNative - netFlow/.test(MODEL));
ok('#G10 종가 미확보 행은 0이 아니라 null',
  /const evalAmt = held && !priceMissing \? cleanNum\(d\.eval\) : null/.test(MODEL));
ok('#G10b 종가 미확보면 거래 효과를 단언하지 않는다',
  /tradeEffectValid:\s*!totals\.basis\.priceMissing && !totals\.counter\.priceMissing/.test(MODEL));
ok('#G11 국내 역산은 세액이 있을 때만(세후를 세전이라 단언 금지)',
  /if \(tax > 0\) gross = net \+ tax;\s*else if \(taxDeferred\) gross = net;/.test(MODEL));
ok('#G12 예상 폴백에 look-ahead 차단(ym < curYm)',
  /ym\.slice\(5, 7\) === mm && ym < curYm/.test(MODEL));
ok('#G13 배당락일이 없으면 같은 월의 일(日)을 빌린다',
  /exDayByMonth\[ym\.slice\(5, 7\)\]/.test(MODEL) && /const dd = exDayByMonth/.test(MODEL));
// ⚠️ 토큰 존재만 보면 **한 지점만 되돌린 회귀**를 못 잡는다(적대적 리뷰 실측) — 사용부 4곳을 각각 단언한다.
ok('#G14 증감은 "보유 없음=0 / 모름=null"을 구분한다(사용부 4곳)',
  /if \(!side \|\| !side\.held\) return 0;/.test(XLS)
  && /diffOf\(heldOr0\(a, s => s\.quantity\), heldOr0\(b, s => s\.quantity\)\)/.test(XLS)
  && /diffOf\(heldOr0\(a, s => s\.investAmount\), heldOr0\(b, s => s\.investAmount\)\)/.test(XLS)
  && /heldOr0\(a, s => s\.evalNative\), evB = heldOr0\(b, s => s\.evalNative\)/.test(XLS)
  && /diffOf\(heldOr0\(a, s => s\.dividend\), heldOr0\(b, s => s\.dividend\)\)/.test(XLS));
ok('#G15 퍼센트는 분수로 저장한다(리터럴 % 금지)',
  /toPrecision\(12\)/.test(XLS) && !/\+\s*'%'/.test(XLS));
ok('#G16 해외 ③ 블록에는 원화 열을 채우지 않는다',
  /case 'evalKrw': return '—';/.test(XLS));

// 모달 배선
ok('#G17 모달에 엑셀 다운로드 버튼과 호출부가 있다',
  /downloadEvalCompareXlsx\(\{/.test(MODAL) && /엑셀 다운로드/.test(MODAL));
ok('#G17b 다운로드는 화면 요약과 같은 모델을 그대로 넘긴다(재계산 금지)',
  /result: compareModel/.test(MODAL));
ok('#G18 비교일 후보는 기준일보다 이전으로 자른다',
  /\.filter\(d => d < date\)/.test(MODAL));
ok('#G18b 후보 상한에 effectiveDateKey 폴백(KR 21~09시 null)',
  /evalSeriesDates\(portfolio, histDates, effectiveDateKey \|\| getTodayKST\(\)\)/.test(MODAL));
ok('#G18c 후보에 없는 날짜로는 계산하지 않는다',
  /!compareCandidates\.includes\(compareDateEff\)\) return null/.test(MODAL));
// ⚠️ 비교일을 effect로 채우면 섹션을 열 때 한 프레임 '만들 수 없습니다'가 번쩍인다(실측).
ok('#G18e 비교일은 effect가 아니라 파생값 + 사용자 덮어쓰기다',
  /const compareDateEff = useMemo\(/.test(MODAL) && (MODAL.match(/setCompareDate\(/g) || []).length === 1);
ok('#G18d 후보 0건이면 안내만 하고 다운로드 버튼을 그리지 않는다',
  /compareCandidates\.length === 0 \?/.test(MODAL) && /비교할 이전 기록일이 없습니다/.test(MODAL));
ok('#G19 주당분배금 입력은 원시 문자열(소수점 보존)',
  /onChange=\{e => setPs\(side, r\.key, e\.target\.value\)\}/.test(MODAL) && !/setPs\([^)]*cleanNum/.test(MODAL));
ok('#G19b 입력값을 계좌에 저장하지 않는다(모달 로컬 state)',
  /const \[psDraft, setPsDraft\] = useState\(\{ basis: \{\}, compare: \{\} \}\)/.test(MODAL));
ok('#G20 성공 피드백은 notify가 아니라 아이콘/문구 플래시',
  /setXlsxFlash\(true\)/.test(MODAL) && /clearTimeout\(flashTimer\.current\)/.test(MODAL)
  && !/notify\([^)]*엑셀/.test(MODAL));
ok('#G20b 실패는 모달 내부 인라인으로 알린다(토스트가 가려진다)',
  /setCompareError\('엑셀을 만들지 못했습니다/.test(MODAL));
// ⚠️ 배당 종목을 전량 매도하면 기준일 분배금이 0이라, 게이트에 반사실이 없으면 "팔지 않았으면
//    받았을 분배금"이 **정확히 그 시나리오에서만** 화면에서 사라진다(엑셀에는 남아 두 화면이 갈린다).
ok('#G27 모달의 분배금 차이 줄 게이트에 반사실이 포함된다',
  /\(compareModel\.totals\.basis\.dividend > 0 \|\| compareModel\.totals\.counter\.dividend > 0\)/.test(MODAL));
// ⚠️ 배지는 '입력했는가'가 아니라 '모델이 채택했는가'로 판정해야 한다 — 음수·문자를 넣으면 모델은
//    자동값으로 되돌아가는데 배지만 '직접입력'이면 사용자는 자기 입력이 반영된 줄 안다.
ok('#G28 주당분배금 배지는 모델의 source로 판정한다(입력 문자열 아님)',
  /const badge = info && info\.source === 'manual'/.test(MODAL) && /: typed \? '무효 입력'/.test(MODAL));
// 블록별 행 필터 배선 — 산술로는 '왜 그 기준인가'를 표현할 수 없다.
ok('#G29 블록별 행 필터가 실제로 루프에 걸려 있다(선언만이 아니라 사용부)',
  /const shown = model\.rows\.filter\(r => includeRow\(r, kind\)\);/.test(XLS) && /for \(const row of shown\)/.test(XLS));
// ⚠️ `held`로 되돌리면 수량 0 주식 행이 네 블록에서 전부 사라진다(자산검증 화면에는 남아 있다).
ok('#G29b 필터 기준은 held가 아니라 present',
  /kind === 'diff'\s*\?\s*\(!!row\.basis\?\.present && !!row\.compare\?\.present\)\s*:\s*!!sideOf\(row, kind\)\?\.present/.test(XLS));
ok('#G29c 모델이 present를 낸다(item 존재 여부)', /present: !!item,/.test(MODEL));
// ⚠️ `sideOf(row,'diff')`는 row.counter를 돌려준다 — 한 줄로 통일하면 ③이 정반대로 뒤집힌다.
ok('#G29d diff는 sideOf보다 앞에서 분기한다', /kind === 'diff'\s*\?/.test(XLS));
ok('#G30 ③ 집계 행 2줄(행 합 = TOTAL 유지)',
  /emitAgg\(`신규 편입 \(\$\{onlyBasisRows\.length\}종목\)/.test(XLS)
  && /emitAgg\(`전량 매도·이관 \(\$\{onlyCompareRows\.length\}종목\)/.test(XLS));
ok('#G30b 집계 행의 분배금은 TOTAL과 같은 dividendPartial 게이트를 쓴다',
  /const partial = model\.totals\.basis\.dividendPartial \|\| model\.totals\.compare\.dividendPartial;/.test(XLS));
ok('#G30c 빈 블록 안내 행', /이 날짜에 보유한 종목이 없습니다/.test(XLS) && /두 날짜 모두 보유한 종목이 없습니다/.test(XLS));
ok('#G30d 빈 블록에서는 평가비중 100%를 단언하지 않는다', /\} else if \(shown\.length\) \{/.test(XLS));
// ⚠️ warns는 '값을 믿을 수 없다'는 신뢰도 경고 전용 채널(⚠ + 앰버)이다. 정상 거래에서 상시
//    발동하는 표시 정책 고지를 거기 넣으면 진짜 경고가 묻힌다 → 캡션·각주에만 둔다.
// ⚠️ **구간을 잘라** 단언한다 — 같은 문장이 캡션과 각주 양쪽에 있어, 파일 전역 정규식으로 재면
//    캡션에서 통째로 사라져도 각주가 대신 통과시킨다(변이 M7로 실증한 죽은 단언).
const DIFF_CAP = XLS.slice(XLS.indexOf("emitBlock('diff'"), XLS.indexOf("emitBlock('counter'"));
const NOTES = XLS.slice(XLS.indexOf('const notes = ['), XLS.indexOf('notes.forEach('));
ok('#G30e ③ 캡션 자체에 표시 정책 고지가 있다',
  DIFF_CAP.length > 0 && /두 날짜 모두 보유한 종목만/.test(DIFF_CAP) && /아래 집계 행으로 합산/.test(DIFF_CAP));
ok('#G30e2 각주에도 남아 있다(캡션을 못 본 사용자용)',
  NOTES.length > 0 && /③은 두 날짜 모두 보유한 종목만 표시합니다/.test(NOTES) && /행 순서는 기준일 보유 순서입니다/.test(NOTES));
ok('#G30e3 고지를 신뢰도 경고 채널에 넣지 않았다', !/warns\.push\([^)]*집계 행/.test(XLS));
ok('#G30f 각주가 빈 칸의 원인에서 "미보유"를 뺐다(필터 후 도달 불가한 설명)',
  /빈 칸은 0이 아니라 "값 없음"입니다\(그 날짜의 종가·주당분배금을 구하지 못했거나/.test(XLS));
// 모달 — 기준일에만 편입한 종목의 '비교일' 칸은 어느 블록에도 렌더되지 않는 죽은 입력이다.
ok('#G31 죽은 주당분배금 칸을 막고 미확인 카운트에서 뺀다',
  /const psCellLive = \(row, side\) => side === 'basis' \|\| !!row\?\.compare\?\.present;/.test(MODAL)
  && /if \(!psCellLive\(r, side\)\) continue;/.test(MODAL)
  && /disabled=\{!live\}/.test(MODAL));

// 비교일 선택 = 달력 팝업(사용자 요청 2026-08 — 드롭다운 오선택 방지)
const PICKER = stripComments(read('src/components/CustomDatePicker.tsx'));
// ⚠️ 구간을 잘라 단언한다 — 이 파일에는 '종목 추가'용 `<select>`가 따로 있어, 파일 전역으로
//    `<select` 부재를 재면 영원히 실패한다(그리고 비교일 영역만 드롭다운으로 되돌려도 못 잡는다).
const CMP_UI = MODAL.slice(MODAL.indexOf('비교할 이전 기록일이 없습니다'), MODAL.indexOf('이 날짜 조합으로는 비교표를 만들 수 없습니다'));
ok('#G32 비교일은 드롭다운이 아니라 달력으로 고른다',
  CMP_UI.length > 0 && !/<select/.test(CMP_UI) && /<CustomDatePicker/.test(CMP_UI));
// ⚠️ 후보 제약이 이 변경의 핵심 — 빼면 기록이 없는 날짜를 골라 '만들 수 없습니다'로 떨어진다.
ok('#G32b 선택 가능한 날짜를 비교일 후보로 제한한다', /allowedDates=\{compareCandidates\}/.test(CMP_UI));
// ⚠️ 오선택의 발단이 2자리 연도였다 — 트리거는 4자리(엑셀 캡션과 같은 포매터)로 보여 준다.
ok('#G32c 트리거가 4자리 연도로 표시한다(엑셀 캡션과 같은 포매터)',
  /dateLabel\(compareDateEff\)/.test(CMP_UI) && /dateLabel/.test(MODAL.slice(0, MODAL.indexOf('export default'))));
// ⚠️ '연도가 다른가'로 되돌리지 말 것 — 기준일이 그 해 첫 기록일이면 기본 비교일이 전년
//    12/31이라 사용자가 아무것도 만지지 않은 상태에서 경고가 뜨고, YoY 비교도 상시 경고
//    대상이 되어 경보가 죽는다. 실제 신호는 '간격이 비정상적으로 큼'이다.
ok('#G32d 간격이 1년을 넘으면 경고한다(연도 문자열 비교가 아니다)',
  /const compareGapLarge = compareGapDays > 366;/.test(MODAL)
  && /Date\.UTC\(\+m\[1\], \+m\[2\] - 1, \+m\[3\]\)/.test(MODAL)
  && /이전입니다 — 의도한 날짜인지 확인하세요/.test(CMP_UI));
// ⚠️ 모달 본문이 overflow-y-auto라, 팝업(position:fixed)이 열린 채 스크롤되면 분리된다.
//    닫지 말고 **다시 붙인다** — 팝업 위에서 굴린 휠이 배경으로 체이닝돼 매번 닫히면 못 쓴다.
ok('#G32e 스크롤을 따라가게 켠다', /followScroll/.test(CMP_UI) && !/closeOnScroll/.test(MODAL));
// ⚠️ 오선택을 알아챌 마지막 표면 — 트리거만 4자리로 고치면 요약에서 여전히 24/… vs 26/…이다.
ok('#G32f 결과 요약도 4자리 연도로 보여 준다',
  /기준일 \{date\}/.test(MODAL) && /비교일 \{compareDateEff\}/.test(MODAL));
// CustomDatePicker는 공유 컴포넌트(사용처 6곳) — 신규 인자는 전부 **선택**이어야 한다.
ok('#G33 신규 인자는 기본값이 "제약 없음"이다(하위호환의 축)',
  /allowedDates = null, zIndex = 999, followScroll = false,/.test(PICKER)
  && /Array\.isArray\(allowedDates\) \? new Set\(allowedDates\.filter\(Boolean\)\) : null/.test(PICKER));
// ⚠️ 조상이 만든 스태킹 컨텍스트(Z.dialog 모달)에 갇히면 z-1050 플로팅 창(계산기·관심종목·
//    메모 달력)에 가려진다 — zIndex prop으로는 구조적으로 해결 불가. 옛 <select> 드롭다운은
//    브라우저 top layer라 항상 위였다.
ok('#G33f 팝업을 body로 포털한다', /createPortal\(popup, document\.body\)/.test(PICKER));
// ⚠️ 포털이라 `ref.contains`로는 팝업 클릭이 '바깥'으로 판정된다 — 함께 보지 않으면 즉시 닫힌다.
ok('#G33g 바깥 클릭 판정이 포털된 팝업도 안으로 본다',
  /if \(popupRef\.current && popupRef\.current\.contains\(t\)\) return;/.test(PICKER));
// ⚠️ 계산기의 window keydown이 input|textarea|select만 통과시켜 <button>은 Enter를 빼앗긴다
//    (옛 <select>는 그 목록에 있어 보호됐다 → 회귀). Escape·토글도 여기 묶여 있다.
ok('#G33h 위젯 키 입력이 window로 새지 않는다 + Escape로 닫힌다 + 트리거가 토글이다',
  /onKeyDownCapture=\{handleKeyDownCapture\}/.test(PICKER)
  && /if \(open && e\.key === 'Escape'\) \{ e\.preventDefault\(\); closePicker\(true\); \}/.test(PICKER)
  && /const togglePicker = \(\) => \{ if \(open\) closePicker\(true\); else openPicker\(\); \};/.test(PICKER));
// ⚠️ 하드코딩 높이로 뒤집으면 실제로는 들어가는 자리에서도 위로 튀어 기존 사용처가 달라진다.
ok('#G33i 세로 보정은 실측 높이로만 한다',
  /popupRef\.current \? popupRef\.current\.offsetHeight : 0/.test(PICKER) && !/popupH = \d+/.test(PICKER));
// ⚠️ 파란 칩이 '보고 있는' 연/월을 칠하면 탐색만 해도 '선택됨'으로 보이는 거짓 표시가 된다.
ok('#G33j 연·월 그리드의 선택 표시는 고른 값 기준(보고 있는 값 아님)',
  /y === selYear \? 'bg-blue-600 text-white'/.test(PICKER)
  && /mi === selMonth && viewYear === selYear \? 'bg-blue-600 text-white'/.test(PICKER));
// ⚠️ disabled 버튼의 title은 Chromium·WebKit이 띄우지 않는다 — 상시 문구가 유일한 안내다.
ok('#G33k 잠금 사유를 상시 문구로 알린다(죽은 title 금지)',
  /진하게 표시된 날짜만 고를 수 있습니다/.test(PICKER)
  && /이 달에는 고를 수 있는 날짜가 없습니다/.test(PICKER)
  && !/title=\{okY \? undefined/.test(PICKER));
// ⚠️ 제약이 없을 때 font-bold를 붙이면 기존 사용처 6곳에서 모든 날짜가 굵어진다.
ok('#G33l 날짜 강조는 제약이 있을 때만',
  /\(allowed \? 'hover:bg-gray-700 font-bold' : 'hover:bg-gray-700'\)/.test(PICKER));
// ⚠️ 포커스 되돌리기는 키보드로 닫을 때만 — 바깥 클릭까지 뺏으면 방금 누른 곳에서 달아난다.
ok('#G33m 선택·Escape에서만 포커스를 트리거로 되돌린다',
  /const closePicker = \(restoreFocus\) => \{ setOpen\(false\); if \(restoreFocus\) focusTrigger\(\); \};/.test(PICKER)
  && /onChange\(keyOf\(viewYear, viewMonth, d\)\);\s*closePicker\(true\);/.test(PICKER));
ok('#G33b 잠긴 날짜는 클릭·커밋 양쪽에서 막는다(한쪽만 막으면 우회된다)',
  /if \(!dayAllowed\(viewYear, viewMonth, d\)\) return;/.test(PICKER) && /onClick=\{\(\) => pick && selectDay\(dayNum\)\}/.test(PICKER));
ok('#G33c 연·월 그리드도 잠근다(빈 달을 헤매지 않게)',
  /const okY = yearAllowed\(y\);/.test(PICKER) && /const okM = monthAllowed\(viewYear, mi\);/.test(PICKER));
// ⚠️ scroll 이벤트는 버블하지 않는다 — capture가 아니면 모달 본문 스크롤을 통째로 놓친다.
ok('#G33d 스크롤 감지는 capture 단계', /window\.addEventListener\('scroll', onMove, true\)/.test(PICKER));
ok('#G33e 날짜 키는 직접 조립한다(toISOString은 UTC로 하루 밀린다)',
  /const keyOf = \(y, m0, d\) => `\$\{y\}-\$\{pad2\(m0 \+ 1\)\}-\$\{pad2\(d\)\}`;/.test(PICKER)
  && !/toISOString/.test(PICKER));

// ── 팝업이 호스트 위에 실제로 뜨는가 (2026-08 사고: "비교일 선택이 안 됩니다") ──────────
// ⚠️ **포털은 z 문제를 해결해 주지 않는다 — 오히려 뒤집는다.** 포털 전 팝업은 호스트의
//    **자손**이라 호스트 스태킹 컨텍스트 *안에서* 항상 위로 떴다(호스트 z와 무관). 포털 후에는
//    `document.body`의 **형제**가 되어 호스트와 직접 z를 겨룬다 → 기본값 999 < Z.dialog(1000)
//    이라 자산검증 모달 안에서 팝업이 패널 뒤로 통째로 가려 "눌러도 아무 일도 안 일어난다"가 됐다.
// ⚠️ **사각지대의 정체**: #G33f(포털했는가)와 #G33(기본값이 999인가)는 **각각 통과**하는데,
//    사고는 정확히 그 둘의 **관계**에서 났다. 아래는 값이 아니라 대소 관계를 잰다.
const DESIGN = stripComments(read('src/design.ts'));
const zTok = (name) => {
  const m = new RegExp(`\\b${name}:\\s*(\\d+)`).exec(DESIGN);
  return m ? +m[1] : NaN;
};
ok('#G34 모달 안 팝오버 층이 dialog 위·플로팅 창(1050) 아래에 있다',
  zTok('dialogPopover') > zTok('dialog') && zTok('dialogPopover') < 1050);
// ⚠️ 사용부 단언 — 토큰만 있고 안 넘기면 사고가 그대로다.
ok('#G34b 비교일 달력이 그 층을 명시적으로 넘겨받는다(미전달 = 기본값 = 모달 뒤)',
  /zIndex=\{Z\.dialogPopover\}/.test(CMP_UI));
// ⚠️ 이 단언이 깨지는 방향(기본값을 dialog 위로 올림)은 6곳 공유 컴포넌트의 하위호환을 건드린다 —
//    #G33의 "기본값 = 종전 동작" 계약과 함께 재검토할 것. 지금은 '모달 호스트는 반드시 명시'가 계약.
const PICKER_DEFAULT_Z = (() => { const m = /zIndex = (\d+)/.exec(PICKER); return m ? +m[1] : NaN; })();
ok('#G34c 기본값은 dialog보다 아래다(= 모달 호스트는 반드시 zIndex를 명시해야 한다는 뜻)',
  Number.isFinite(PICKER_DEFAULT_Z) && PICKER_DEFAULT_Z < zTok('dialog'));
// ⚠️ 호출처 census — 새 호스트가 생기면 여기서 걸려 z를 **의식적으로** 정하게 만든다.
//    (파일 단위로 "높은 z가 있으면 zIndex 필수"로 재면 오탐이 난다: IntegratedDashboard는
//     z-[1000] 팝업과 표의 달력이 **형제**라 그 달력에는 제약이 필요 없다.)
const PICKER_HOSTS = readdirSync(join(ROOT, 'src/components'))
  .filter(f => f.endsWith('.tsx'))
  .map(f => [f, (stripComments(read(`src/components/${f}`)).match(/<CustomDatePicker/g) || []).length])
  .filter(([, n]) => n > 0)
  .map(([f, n]) => `${f}:${n}`)
  .sort();
eq('#G34d 달력 호출처 census(새 호스트는 z를 의식적으로 정할 것)', PICKER_HOSTS,
  ['ChartRangeControls.tsx:2', 'IntegratedDashboard.tsx:1', 'PortfolioTable.tsx:3', 'VerifyEvalModal.tsx:1']);

// ── 포털된 팝업의 이벤트가 호스트를 닫아 버리지 않는가 ────────────────────────────────
// ⚠️ 포털해도 이벤트는 **React 트리**를 따라 올라간다(DOM 트리가 아니다) — 호스트의 닫기
//    핸들러가 그대로 발화한다. 세 제스처를 **전부** 흡수해야 한다(하나만 빠져도 그 입력 방식
//    에서만 조용히 샌다). 실재 경로: VerifyEvalModal = mousedown/touchstart, 적립 모달 = click.
const nPick = (re) => (PICKER.match(re) || []).length;
ok('#G35 백드롭·본체가 mousedown/touchstart를 각각 흡수한다(터치로 날짜를 누르면 호스트가 닫히던 경로)',
  nPick(/onMouseDown=\{swallow\}/g) === 2 && nPick(/onTouchStart=\{swallow\}/g) === 2);
ok('#G35b click도 흡수한다 — 본체는 그냥 삼키고, 백드롭은 삼킨 뒤 자기만 닫는다',
  nPick(/onClick=\{swallow\}/g) === 1
  && /onClick=\{e => \{ e\.stopPropagation\(\); setOpen\(false\); \}\}/.test(PICKER));
// ⚠️ '흡수가 필요한 이유'가 실제로 존재하는지도 잰다 — 호스트가 닫기 제스처를 바꾸면 위 가드의
//    근거가 사라지므로 함께 알려야 한다(죽은 단언 방지).
ok('#G35c 호스트들이 실제로 그 제스처로 닫는다',
  /onMouseDown=\{onClose\} onTouchStart=\{onClose\}/.test(MODAL)
  && /onClick=\{closeSavingsModal\}/.test(stripComments(read('src/components/PortfolioTable.tsx'))));

ok('#G21 요약 %는 "수익률"이 아니라 "평가금액 증감율(입출금 포함)"이라 표기한다',
  /평가금액 증감율/.test(MODAL) && /입출금 포함/.test(MODAL));

// 공유·의존성
ok('#G22 portfolioExcel의 StyleBag이 export되어 있다(비교 시트가 재사용)',
  /export class StyleBag/.test(PX) && /import \{ FMT, StyleBag \} from '\.\/portfolioExcel\.ts'/.test(XLS));
ok('#G23 외부 npm 의존성 0 (xlsx/exceljs/jszip 등 금지)',
  !/(xlsx|exceljs|jszip|sheetjs|file-saver|write-excel-file)/.test(JSON.stringify(PKG.dependencies || {})));
eq('#G23b dependencies 고정', Object.keys(PKG.dependencies || {}).sort(), ['lucide-react', 'react', 'react-dom', 'recharts']);
ok('#G24 verify:compare 스크립트 등록', (PKG.scripts || {})['verify:compare'] === 'node scripts/verify-compare.mjs');
ok('#G25 lucide 아이콘은 이미 쓰는 것만(FileSpreadsheet)',
  /FileSpreadsheet/.test(MODAL_RAW) && !/from 'lucide-react'[^\n]*\b(Sheet|Table|FileDown|GitCompare)\b/.test(MODAL_RAW));
ok('#G26 영속화 지점을 건드리지 않았다(App 지문에 evalCompare 흔적 없음)',
  !/evalCompare|perShareOverride|psDraft/.test(read('src/App.tsx')));

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
