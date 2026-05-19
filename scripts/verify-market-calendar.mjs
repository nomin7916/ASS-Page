// 큐레이션 휴장일(api/_marketCalendarData.ts) ↔ nager.at 라이브 교차검증.
// 실행: npm run verify:calendar
// nager 라이브에 동일 보정 규칙을 적용한 기대값과 큐레이션 스냅샷을 연도별로 비교,
// 누락/추가 항목을 출력한다. 차이가 있으면 종료코드 1 (CI/수동 점검용).
//
// 보정 규칙(데이터 파일과 동일):
//  KR: 제헌절(07-17) 제외, 부처님오신날 토/일→다음평일 대체 추가, 12/31 추가
//  US: NYSE 미휴장 항목 제외, Good Friday 추가, 토요일 새해(12/31 관측분) 제외
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const dataSrc = readFileSync(join(__dir, '..', 'api', '_marketCalendarData.ts'), 'utf8');

function extractRecord(name) {
  const m = dataSrc.match(new RegExp(`export const ${name}[^=]*=\\s*(\\{[\\s\\S]*?\\n\\});`));
  if (!m) throw new Error(`cannot parse ${name}`);
  const json = m[1]
    .replace(/'/g, '"')
    .replace(/(\d{4}):/g, '"$1":')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(json);
}
const CURATED_KR = extractRecord('CURATED_KR');
const CURATED_US = extractRecord('CURATED_US');

const NYSE_EXCLUDED = ['Columbus Day', "Indigenous Peoples' Day", 'Veterans Day', "Lincoln's Birthday", 'Truman Day'];

function goodFriday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const mon = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return new Date(Date.UTC(year, mon - 1, day - 2)).toISOString().slice(0, 10);
}
function nextWeekday(s) {
  const d = new Date(s + 'T12:00:00Z');
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const uniqSort = (a) => Array.from(new Set(a)).sort();

async function nager(year, cc) {
  const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`);
  if (!r.ok) throw new Error(`nager ${cc} ${year} ${r.status}`);
  return r.json();
}
function expectedKR(year, raw) {
  const out = [];
  for (const h of raw) {
    if (h.date.slice(5) === '07-17') continue;
    out.push(h.date);
    if (h.localName?.includes('부처님')) {
      const wd = new Date(h.date + 'T12:00:00Z').getUTCDay();
      if (wd === 0 || wd === 6) out.push(nextWeekday(h.date));
    }
  }
  out.push(`${year}-12-31`);
  return uniqSort(out);
}
function expectedUS(year, raw) {
  const out = raw
    .filter(h => !NYSE_EXCLUDED.includes(h.name))
    .filter(h => !(h.name === "New Year's Day" && h.date.slice(5, 7) === '12'))
    .map(h => h.date);
  const gf = goodFriday(year);
  if (!out.includes(gf)) out.push(gf);
  return uniqSort(out);
}
const diff = (exp, cur) => ({
  missing: exp.filter(d => !cur.includes(d)),
  extra: cur.filter(d => !exp.includes(d)),
});

let problems = 0;
for (const yr of Object.keys(CURATED_KR).map(Number).sort()) {
  const [rk, ru] = await Promise.all([nager(yr, 'KR'), nager(yr, 'US')]);
  for (const [mkt, exp, cur] of [
    ['KR', expectedKR(yr, rk), uniqSort([...CURATED_KR[yr], `${yr}-12-31`])],
    ['US', expectedUS(yr, ru), uniqSort(CURATED_US[yr])],
  ]) {
    const { missing, extra } = diff(exp, cur);
    if (missing.length || extra.length) {
      problems++;
      console.log(`\n[${yr} ${mkt}] 불일치`);
      if (missing.length) console.log(`  큐레이션 누락: ${missing.join(', ')}`);
      if (extra.length) console.log(`  큐레이션 추가분(검토): ${extra.join(', ')}`);
    } else {
      console.log(`[${yr} ${mkt}] OK (${cur.length}일)`);
    }
  }
}
console.log(problems ? `\n⚠ ${problems}건 불일치 — 수동 검토 필요` : '\n✓ 전체 일치');
process.exit(problems ? 1 : 0);
