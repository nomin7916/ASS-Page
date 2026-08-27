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

import { readFileSync } from 'node:fs';
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
    // 미보유 행은 빈 셀(0 금지)
    const sheetSold = EX.buildEvalCompareSheet({ ...baseInput({ portfolio: soldPf }), accountName: 'A' });
    const soldRowIdx = sheetSold.rows.findIndex(row => row[1] && row[1].v === '498410');
    eq('#52 미보유 행의 수량·평가금은 빈 셀', [sheetSold.rows[soldRowIdx][4], sheetSold.rows[soldRowIdx][6]], [null, null]);
    ok('#52b 그래도 종가는 채운다(매도 후 주가 확인용)', sheetSold.rows[soldRowIdx][2] && sheetSold.rows[soldRowIdx][2].v === 11875);
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
  // 전량 매도 종목의 ③ 행 — '보유 없음 = 0'이 아니면 여기서 빈 칸이 된다.
  const sheetSold2 = S('#66 전량 매도 시트', () => EX.buildEvalCompareSheet({ ...baseInput({ portfolio: soldPf }), accountName: 'A' }));
  if (sheetSold2) {
    const b3 = blocksOf(sheetSold2)[2];
    const sold = bodyRow(sheetSold2, b3, '498410');
    eq('#66b ③ 전량 매도는 −전량으로 찍힌다(빈 칸 아님)',
      [cellNum(sold, CL.qty), Math.round(cellNum(sold, CL.eval))], [-10445, -(10445 * 11930)]);
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
