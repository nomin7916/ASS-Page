#!/usr/bin/env node
// 공시된 분배금의 예상 수량 = 공시일(배당락 전 영업일) 장 마감 보유 수량 — src/dividendQty.ts 를 **직접 import**한다(미러 금지).
//   사용자 확정(2026-11-12): 월중 ETF는 15일 지급 기준 — 1영업일 전 배당락, 2영업일 전 공시. 15일이 주말·휴일이면 당겨진다.
//   2026-11: 15일 일요일 → 기준일 13일 → 배당락 12일 → 공시 11일 → 11일까지 보유한 수량으로 계산.
// 런타임이 .ts를 못 읽으면 단위 검사만 건너뛰고 소스 가드는 돈다.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let Q = null;
try { Q = await import(pathToFileURL(join(ROOT, 'src/dividendQty.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/dividendQty.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (Q) {
  const { prevBusinessDay, isBusinessDay, midMonthSchedule, dividendRecordQty } = Q;

  console.log('\n── 파트① 영업일 ──');
  eq('#B1 11/12(목) 전 영업일 = 11/11(수)', prevBusinessDay('2026-11-12'), '2026-11-11');
  eq('#B2 11/16(월) 전 영업일 = 11/13(금) — 주말 건너뜀', prevBusinessDay('2026-11-16'), '2026-11-13');
  eq('#B3 휴장일도 건너뜀 (10/5 월 휴장 → 10/6 전 영업일 = 10/2 금)', prevBusinessDay('2026-10-06', ['2026-10-05']), '2026-10-02');
  eq('#B4 형식이 틀리면 빈 문자열', prevBusinessDay('2026/11/12'), '');
  ok('#B5 11/15(일)은 영업일 아님 · 11/13(금)은 영업일', !isBusinessDay('2026-11-15') && isBusinessDay('2026-11-13'));

  console.log('\n── 파트② 월중 일정(15일 기준) ──');
  eq('#M1 2026-11: 15일 일요일 → 기준일 13 · 배당락 12 · 공시 11 (사용자 예시)', midMonthSchedule('2026-11'),
    { recordDate: '2026-11-13', exDate: '2026-11-12', announceDate: '2026-11-11' });
  eq('#M2 2026-10: 15일 목요일 → 기준일 15 · 배당락 14 · 공시 13', midMonthSchedule('2026-10'),
    { recordDate: '2026-10-15', exDate: '2026-10-14', announceDate: '2026-10-13' });
  eq('#M3 15일이 휴장일(월)이면 그 전 금요일이 기준일', midMonthSchedule('2026-06', ['2026-06-15']),
    { recordDate: '2026-06-12', exDate: '2026-06-11', announceDate: '2026-06-10' });
  eq('#M4 배당락이 월요일이면 공시는 그 전 금요일', midMonthSchedule('2026-09'),
    { recordDate: '2026-09-15', exDate: '2026-09-14', announceDate: '2026-09-11' });
  ok('#M5 월중 배당락의 공시일 = dividendRecordQty가 쓰는 수량 날짜(같은 규칙 하나)',
    dividendRecordQty({ exDate: midMonthSchedule('2026-11').exDate, announced: true, today: '2026-11-12', currentQty: 1, holdingAt: () => 1 }).qtyDate
      === midMonthSchedule('2026-11').announceDate);

  console.log('\n── 파트③ 수량 판정 ──');
  const hold = { '2026-11-11': 4147, '2026-11-12': 10820 };
  const at = (d) => (d in hold ? hold[d] : null);
  const base = { exDate: '2026-11-12', announced: true, today: '2026-11-12', currentQty: 10820, holdingAt: at };
  eq('#Q1 공시된 분배금 · 공시일(11/11)이 지났다 → 11/11 보유 4,147주', dividendRecordQty(base), { qty: 4147, source: 'record', qtyDate: '2026-11-11' });
  eq('#Q2 오늘이 공시일이면 아직 사고팔 수 있다 → 지금 수량', dividendRecordQty({ ...base, today: '2026-11-11' }), { qty: 10820, source: 'current', qtyDate: '2026-11-11' });
  eq('#Q3 공시 전(예측 분배금) → 지금 수량', dividendRecordQty({ ...base, announced: false }), { qty: 10820, source: 'current', qtyDate: '' });
  eq('#Q4 그날 보유를 모르면(null) → 지금 수량 (0주로 단언하지 않는다)', dividendRecordQty({ ...base, holdingAt: () => null }), { qty: 10820, source: 'current', qtyDate: '2026-11-11' });
  eq('#Q5 그날 보유가 없었으면 0주 (공시 뒤에 산 주식은 분배금 없음)', dividendRecordQty({ ...base, holdingAt: () => 0 }), { qty: 0, source: 'record', qtyDate: '2026-11-11' });
  eq('#Q6 배당락일 형식이 틀리면 지금 수량', dividendRecordQty({ ...base, exDate: '' }), { qty: 10820, source: 'current', qtyDate: '' });
  eq('#Q7 holdingAt이 없으면 지금 수량', dividendRecordQty({ ...base, holdingAt: undefined }), { qty: 10820, source: 'current', qtyDate: '2026-11-11' });
  eq('#Q8 공시일은 영업일 기준 — 월요일 배당락이면 금요일 보유', dividendRecordQty({ ...base, exDate: '2026-09-14', today: '2026-11-12', holdingAt: (d) => (d === '2026-09-11' ? 777 : 1) }),
    { qty: 777, source: 'record', qtyDate: '2026-09-11' });
}

console.log('\n── 파트④ 소스 가드 ──');
{
  const QS = read('src/dividendQty.ts');
  ok('#G1 dividendQty.ts에는 import가 없다(직접 import 규약)', !/^\s*import\s/m.test(QS));
  const SRC = stripComments(read('src/components/DividendSummaryTable.tsx'));
  ok('#G2 DividendSummaryTable이 dividendRecordQty·getTodayKST를 import', /import \{[^}]*\bdividendRecordQty\b[^}]*\} from '\.\.\/dividendQty'/.test(SRC)
    && /import \{[^}]*\bgetTodayKST\b[^}]*\} from '\.\.\/hooks\/useMarketCalendar'/.test(SRC));
  ok('#G3 보유 수량은 자산검증 스냅샷(resolveHoldings) · 스냅샷 없음(live)은 모름(null)',
    /function holdingQtyAt\(pf, code, date\) \{\s*const r = resolveHoldings\(pf, date\);\s*if \(r\.kind === 'live'\) return null;/.test(SRC));
  ok('#G4 해외 계좌는 지금 수량(스냅샷 KST 날짜 ≠ 미국 거래일)', /if \(pf\.accountType === 'overseas'\) return \{ qty: currentQty, source: 'current', qtyDate: '' \};/.test(SRC));
  ok('#G5 공시 판정 = 확정 배당락 + 그 달 주당분배금 기록', /announced: !s\.exPredicted && !!codeHistory\?\.\[s\.exYm\]/.test(SRC));
  const calls = (SRC.match(/srcDividendQty\(pf, item\.code, s, divHistory\[item\.code\], (baseQty|qty), todayKST, hol\)/g) || []).length;
  ok(`#G6 월 예상(종목·계좌 합계)·월 입금 예상값 세 곳이 같은 수량 규칙을 쓴다 (got ${calls})`, calls === 3);
  ok('#G7 실지급액 역산이 공시일 수량보다 먼저', /const rq = backCalc \? null : srcDividendQty\(/.test(SRC));
  const deps = (SRC.match(/viewYear, isPastYear, todayKST\]\);/g) || []).length;
  ok(`#G8 세 memo 의존성에 todayKST (날짜가 바뀌면 다시 계산) (got ${deps})`, deps === 3);
  ok('#G9 하늘색 수량 + 범례', /d\.qtyRecord \? 'text-sky-300\/80'/.test(SRC) && /하늘 수량<\/span> = 공시일\(배당락 전 영업일\) 보유/.test(SRC));
  ok('#G10 공시일 보유 0주는 셀에 사유 한 줄', /\{fmtMD\(d\.qtyDate\)\} 보유 0주/.test(SRC));
}

console.log(`\n결과: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
console.log('✓ 모든 케이스 통과\n');
