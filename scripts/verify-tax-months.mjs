#!/usr/bin/env node
// 평균 과표 계산기 '월별 접기' — src/taxCalcMonths.ts 를 **직접 import**한다(미러 금지).
//   사용자 요청(2026-11-12): 행이 늘어 표 머리 줄이 안 보인다 → 입력이 끝난 지난 달은 지우지 않고 월별로 접고, 필요하면 펼친다.
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

let T = null;
try { T = await import(pathToFileURL(join(ROOT, 'src/taxCalcMonths.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/taxCalcMonths.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (T) {
  const { taxRowMonth, groupTaxRowsByMonth, taxMonthOpen, showTaxMonthHeads, taxMonthLabel, taxMonthSummary } = T;
  // 사용자 화면(2026-11-12)과 같은 모양: 7~11월 기록 + 일자 미입력 1건
  const row = (date, change, runningQty, runningAvg, profit = null) => ({ evt: { date, change }, runningQty, runningAvg, realized: { profit } });
  const rows = [
    row('2026-07-15', 955, 955, 10258.89), row('2026-07-28', 2028, 2983, 10258.57),
    row('2026-08-25', -246, 2737, 10258.47, 170392),
    row('2026-09-09', '-8,535', 0, 10258.47, 4334976),
    row('2026-10-14', 115, 115, 10258.4),
    row('2026-11-11', 6673, 6788, 10258.3),
    row('', 0, 0, 0),
  ];
  const g = groupTaxRowsByMonth(rows, '2026-11', r => r.evt.date);

  console.log('\n── 파트① 묶음 ──');
  eq('#T1 달별 묶음 + 맨 뒤 일자 미입력', g.map(x => x.ym), ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '']);
  eq('#T2 지난 달 = 7·8·9·10월', g.filter(x => x.past).map(x => x.ym), ['2026-07', '2026-08', '2026-09', '2026-10']);
  eq('#T3 행 순서·개수 보존', g.flatMap(x => x.rows).length, rows.length);
  eq('#T4 일자 형식', [taxRowMonth('2026-07-15'), taxRowMonth('2026-7-1'), taxRowMonth(undefined)], ['2026-07', '', '']);

  console.log('\n── 파트② 펼침 기본값 ──');
  eq('#T5 기본: 지난 달 접힘 · 이번 달 펼침 · 일자 미입력 펼침', g.map(x => taxMonthOpen(x)), [false, false, false, false, true, true]);
  ok('#T6 사용자가 누른 값이 기본값을 이긴다', taxMonthOpen(g[0], true) === true && taxMonthOpen(g[4], false) === false);
  ok('#T7 일자 미입력 묶음은 접히지 않는다(입력할 행이 숨으면 안 된다)', taxMonthOpen(g[5], false) === true);
  ok('#T8 이번 달 행만 있으면 머리 줄 없음 · 지난 달이 하나라도 있으면 머리 줄', !showTaxMonthHeads(groupTaxRowsByMonth([rows[5]], '2026-11', r => r.evt.date))
    && showTaxMonthHeads(groupTaxRowsByMonth([rows[0]], '2026-11', r => r.evt.date)) && showTaxMonthHeads(g));
  ok('#T9 달이 바뀌면(12월) 11월도 지난 달로 접힌다', groupTaxRowsByMonth(rows, '2026-12', r => r.evt.date).find(x => x.ym === '2026-11').past === true);

  console.log('\n── 파트③ 머리 줄 요약 ──');
  eq('#T10 이름', [taxMonthLabel('2026-07'), taxMonthLabel('')], ['2026년 7월', '일자 미입력']);
  const s7 = taxMonthSummary(g[0].rows);
  eq('#T11 7월: 2건 · 매수 2,983 · 보유 2,983 · 평균 과표 = 마지막 행', [s7.count, s7.buyQty, s7.sellQty, s7.endQty, s7.endAvg, s7.realizedCount], [2, 2983, 0, 2983, 10258.57, 0]);
  const s9 = taxMonthSummary(g[2].rows);
  eq('#T12 9월: 쉼표 든 매도 수량도 해석 · 실현손익 합', [s9.sellQty, s9.realized, s9.realizedCount], [8535, 4334976, 1]);
}

console.log('\n── 파트④ 소스 가드 ──');
{
  ok('#G1 taxCalcMonths.ts에는 import가 없다(직접 import 규약)', !/^\s*import\s/m.test(read('src/taxCalcMonths.ts')));
  const MX = stripComments(read('src/components/KrEtfTaxMatrix.tsx'));
  ok('#G2 KrEtfTaxMatrix가 묶음 함수를 import', /import \{[^}]*\bgroupTaxRowsByMonth\b[^}]*\btaxMonthOpen\b[^}]*\btaxMonthSummary\b[^}]*\} from '\.\.\/taxCalcMonths'/.test(MX));
  ok('#G3 묶음은 계산이 끝난 sortedEventsWithAvg로 만든다(표시만 숨김 — 러닝 평균은 전 행)',
    /groupTaxRowsByMonth\(sortedEventsWithAvg, currentYm, r => r\.evt\.date\)/.test(MX));
  ok('#G4 표 본문은 calcRows를 그리고 머리 줄을 먼저 가른다', /\{calcRows\.map\(\(row\) => \{\s*if \(row\.monthHead\) \{/.test(MX)
    && /const \{ evt, runningAvg, basis, basisDiverged, realized: rz \} = row;/.test(MX));
  // 머리 줄 colSpan = 계산기 표 열 수 — 열을 더하거나 빼면 머리 줄이 표 폭을 못 채운다.
  const theadAt = MX.indexOf('<th className="text-left py-1 pl-2 pr-1 font-normal w-[108px]">일자</th>');
  const thead = theadAt >= 0 ? MX.slice(theadAt, MX.indexOf('</thead>', theadAt)) : '';
  const thCount = (thead.match(/<th[\s>]/g) || []).length;
  ok(`#G5 머리 줄 colSpan = 계산기 열 수 (열 ${thCount})`, thCount > 0 && new RegExp(`<td colSpan=\\{${thCount}\\} className="py-1 pl-2 pr-2">`).test(MX));
  ok('#G6 지난 달로 날짜를 옮기면 그 달을 펼친다', /if \(ym < currentYm\) toggleCalcMonth\(stock\.code, ym, true\);/.test(MX));
  ok('#G7 새 행 일자 = 오늘(KST) — UTC면 1일 아침 새 행이 지난 달에 숨는다', /date: getTodayKST\(\), prevQty: 0, change: 0, taxBasePrice: 0/.test(MX)
    && !/date: new Date\(\)\.toISOString\(\)\.slice\(0, 10\), prevQty/.test(MX));
  ok('#G8 펼침 상태는 세션 로컬(useState) — 저장 지점 없음', /const \[calcMonthOpen, setCalcMonthOpen\] = useState\(\{\}\);/.test(MX));
}

console.log(`\n결과: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
console.log('✓ 모든 케이스 통과\n');
