#!/usr/bin/env node
// 계좌 탭 전환 속도를 지키는 검사 — 2026-11-15.  실행: npm run verify:fmt-cache
//
// 배경(실측, CPU 4배 느리게): 계좌 탭을 누르면 App이 5~12번 다시 그려지고, 그때마다 평가액 추이 표가 전 행을 다시 만들며
//   formatCurrency를 수천 번 불렀다. formatCurrency는 부를 때마다 Intl.NumberFormat을 새로 만들어 이것 하나가 전환 시간의 53~64%였다.
//   지켜야 할 것은 둘:
//   ① 자주 쓰는 숫자 포매터는 모듈에서 한 번만 만든다(FMT_* 상수) — 함수 안에서 new Intl.NumberFormat 금지.
//   ② HistoryPanel 표 본문(historyTbody)은 useMemo — 행 안에서 쓰는 컴포넌트 값이 전부 의존 목록에 있어야 한다.
//      빠지면 표가 **오류 없이 옛 값을 보여 준다**(조용한 오류). 그래서 존재가 아니라 '쓰는 값 ⊆ 의존 목록'을 잰다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`); }
};
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
// 주석 제거 — 이 저장소는 금지 사유를 주석에 적으므로(예: 'sortedHistoryDesc.length로 재면…') 원문으로 재면 유령 사용이 잡힌다.
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

console.log('\n── 파트① 숫자 포매터는 모듈에서 한 번만 만든다 ──');
const HOT = ['src/utils.ts', 'src/components/HistoryPanel.tsx', 'src/components/PortfolioTable.tsx'];
for (const f of HOT) {
  const lines = stripComments(read(f)).split('\n').filter(l => l.includes('new Intl.NumberFormat('));
  const bad = lines.filter(l => !/^const FMT_[A-Z0-9_]+ = new Intl\.NumberFormat\(/.test(l));
  ok(`#F1 ${f}: new Intl.NumberFormat은 모듈 상수(const FMT_* = …)에서만`, bad.length === 0, bad.map(l => l.trim().slice(0, 120)).join('\n      '));
}
const utils = stripComments(read('src/utils.ts'));
ok('#F2 formatCurrency·formatNumber·formatFundPrice가 모듈 상수를 쓴다',
  /export const formatCurrency = \(n\) => FMT_KRW\.format\(cleanNum\(n\)\);/.test(utils)
  && /export const formatNumber = \(n\) => \(n === '' \|\| n == null\) \? '' : FMT_NUM\.format\(cleanNum\(n\)\);/.test(utils)
  && /export const formatFundPrice = \(n\) => \(n === '' \|\| n == null\) \? '' : FMT_FUND\.format\(cleanNum\(n\)\);/.test(utils));
ok('#F3 모듈 상수의 형식 옵션이 종전과 같다(출력 글자 동일)',
  /const FMT_KRW = new Intl\.NumberFormat\('ko-KR', \{ style: 'currency', currency: 'KRW' \}\);/.test(utils)
  && /const FMT_NUM = new Intl\.NumberFormat\('ko-KR'\);/.test(utils)
  && /const FMT_FUND = new Intl\.NumberFormat\('ko-KR', \{ minimumFractionDigits: 2, maximumFractionDigits: 2 \}\);/.test(utils));
{
  // 같은 옵션이면 한 번 만든 포매터와 매번 만든 포매터의 글자가 같다(음수·소수·0·큰 수).
  const samples = [0, -0, 1, -1, 0.5, 1234.5678, -987654321.987, 1e15, 12.345];
  const opts = [['ko-KR', { style: 'currency', currency: 'KRW' }], ['ko-KR', undefined], ['ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }],
    ['en-US', { style: 'currency', currency: 'USD' }], ['ko-KR', { maximumFractionDigits: 8 }]];
  const same = opts.every(([loc, o]) => { const f = new Intl.NumberFormat(loc, o); return samples.every(n => f.format(n) === new Intl.NumberFormat(loc, o).format(n)); });
  ok('#F4 재사용 포매터 출력 = 매번 만든 포매터 출력(표본 9개 × 옵션 5종)', same);
}

console.log('\n── 파트② 평가액 추이 표 본문 메모의 의존 목록 ──');
const hpRaw = read('src/components/HistoryPanel.tsx');
const hp = stripComments(hpRaw);
const m = hp.match(/const historyTbody = useMemo\(\(\) => \(([\s\S]*?)\n  \), \[([^\]]*)\]\);/);
ok('#H1 표 본문이 useMemo(historyTbody)이고 JSX는 {historyTbody} 한 곳', !!m && (hp.match(/\{historyTbody\}/g) || []).length === 1);
if (m) {
  const body = m[1];
  const deps = m[2].split(',').map(x => x.trim()).filter(Boolean);
  ok('#H2 본문이 tbody 전체이고 viewRows를 그린다', /^\s*<tbody>/.test(body) && /<\/tbody>\s*$/.test(body) && /\{viewRows\.map\(\(h, i\) => \{/.test(body));
  // 컴포넌트 스코프 이름 = props + 컴포넌트 최상위(2칸 들여쓰기) const/function 선언
  const sig = hp.match(/export default function HistoryPanel\(\{([\s\S]*?)\}\) \{/);
  const props = sig ? sig[1].split(',').map(x => x.trim().split(/[\s=:]/)[0]).filter(Boolean) : [];
  const fnStart = hp.indexOf('export default function HistoryPanel(');
  const top = hp.slice(fnStart, hp.indexOf('const historyTbody = useMemo('));
  const locals = new Set();
  for (const mm of top.matchAll(/\n  const (\w+)\s*=/g)) locals.add(mm[1]);
  for (const mm of top.matchAll(/\n  const \[([^\]]+)\]\s*=/g)) mm[1].split(',').forEach(x => locals.add(x.trim()));
  for (const mm of top.matchAll(/\n  function (\w+)\s*\(/g)) locals.add(mm[1]);
  const scope = new Set([...props, ...locals]);
  ok('#H3 컴포넌트 스코프 이름을 읽었다(props·지역 선언)', props.length > 20 && locals.size > 10, `props ${props.length} · locals ${locals.size}`);
  const used = new Set();
  for (const mm of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) if (scope.has(mm[1])) used.add(mm[1]);
  // 바뀌지 않는 값(상태 setter)과, 의존 목록에 있는 값에서만 나오는 파생값은 원천을 대신 요구한다.
  const DERIVED = {
    setVerifyRecord: [],
    isPeriodMode: ['histPeriod'],
    noun: ['histPeriod'],
    isOverseasAcct: ['activePortfolioAccountType'],
    shownEvalOf: ['activePortfolioAccountType', 'overseasEvalByDate', 'displayEvalByDate'],
  };
  const depSet = new Set(deps);
  const missing = [];
  for (const u of used) {
    if (u in DERIVED) { for (const src of DERIVED[u]) if (!depSet.has(src)) missing.push(`${u}←${src}`); continue; }
    if (u === 'marketIndicators') {
      for (const mm of body.matchAll(/marketIndicators\.(\w+)/g)) if (!depSet.has('marketIndicators.' + mm[1])) missing.push('marketIndicators.' + mm[1]);
      if (/marketIndicators(?![.\w])/.test(body)) missing.push('marketIndicators(통째)');
      continue;
    }
    if (!depSet.has(u)) missing.push(u);
  }
  ok('#H4 본문이 쓰는 컴포넌트 값이 전부 의존 목록에 있다(빠지면 표가 옛 값을 보여 준다)', missing.length === 0, '빠진 값: ' + [...new Set(missing)].join(', '));
  const unknownDerived = [...used].filter(u => !(u in DERIVED) && !depSet.has(u) && u !== 'marketIndicators');
  ok('#H5 파생값 표(DERIVED)에 없는 이름을 의존 목록 밖에서 쓰지 않는다', unknownDerived.length === 0, unknownDerived.join(', '));
  // 파생값의 정의가 바뀌어 다른 값을 읽게 되면 DERIVED 표도 바뀌어야 한다 — 정의 글자를 못 박는다.
  ok('#H6 파생값 정의가 DERIVED 표와 같다',
    /const isPeriodMode = histPeriod === 'week' \|\| histPeriod === 'month' \|\| histPeriod === 'year';/.test(hp)
    && /const noun = periodNoun\(histPeriod\);/.test(hp)
    && /const isOverseasAcct = activePortfolioAccountType === 'overseas';/.test(hp)
    && /const shownEvalOf = \(r\) => \{\n    if \(!r \|\| !r\.date\) return null;\n    const o = isOverseasAcct && overseasEvalByDate \? overseasEvalByDate\.get\(r\.date\) : null;\n    if \(o\) return o\.krw;\n    const v = displayEvalByDate\?\.get\(r\.date\);\n    return v != null \? v : \(r\.evalAmount != null \? r\.evalAmount : null\);\n  \};/.test(hp)
    && /const \[verifyRecord, setVerifyRecord\] = useState\(null\);/.test(hp));
}

console.log(`\n${fail ? '❌' : '✅'} verify:fmt-cache — 통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
