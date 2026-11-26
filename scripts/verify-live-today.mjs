#!/usr/bin/env node
// 비활성 시장 계좌의 '오늘' 라이브 기록이 새 시세를 따라가는지 — src/liveTodayRow.ts 를 **직접 import**한다(미러 금지).
//   2026-11-26 사용자 확인 요청("종목 가격이 잘 반영되는지"): 효과#1(useHistoryBackfill)이 부팅 직후 저장돼 있던 시세로
//   오늘 줄을 먼저 적고 "같은 날 1건만(불변)"이라 새 시세가 와도 그대로 남았다(ISA·연금저축·REITs 오늘 줄 = 그저께 평가액).
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

let M = null;
try { M = await import(pathToFileURL(join(ROOT, 'src/liveTodayRow.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/liveTodayRow.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (M) {
  const { refreshLiveTodayRow: R } = M;
  console.log('\n── 파트① 라이브 줄 갱신 ──');
  const base = [
    { date: '2026-11-24', evalAmount: 87001918, principal: 80000000, isFixed: true },
    { date: '2026-11-25', evalAmount: 84281513, principal: 80000000, isFixed: true },
    { date: '2026-11-26', evalAmount: 87001918, principal: 80000000, isFixed: false },
  ];
  const snap = JSON.stringify(base);
  const out = R(base, 2, { currentEval: 88898463 });
  ok('#L1 부팅 때 옛 시세로 적힌 오늘 줄(그저께 값)이 새 평가액으로 바뀐다', !!out && out[2].evalAmount === 88898463);
  ok('#L2 원금·날짜·isFixed:false 유지, 다른 날 줄은 그대로', !!out && out[2].principal === 80000000 && out[2].date === '2026-11-26'
    && out[2].isFixed === false && out[0] === base[0] && out[1] === base[1]);
  ok('#L3 입력 배열·줄을 바꾸지 않는다(새 배열)', JSON.stringify(base) === snap && out !== base);
  eq('#L4 반올림해 같은 값이면 null(쓰기·저장 없음 — 무한 갱신 방지)', R(base, 2, { currentEval: 87001918.3 }), null);
  eq('#L5 확정 줄(isFixed — 백필·자동확정)은 건드리지 않음', R(base, 1, { currentEval: 1 }), null);
  eq('#L6 사용자 확정(isFixed+adjustedAmount)도 그대로', R([{ date: 'd', evalAmount: 5, adjustedAmount: 5, isFixed: true }], 0, { currentEval: 9 }), null);
  eq('#L7 휴일 이상치 보정 줄(isAdjusted)은 그대로', R([{ date: 'd', evalAmount: 5, isFixed: false, isAdjusted: true }], 0, { currentEval: 9 }), null);
  eq('#L8 평가액 0(시세 미로드)이면 null', R(base, 2, { currentEval: 0 }), null);
  eq('#L9 없는 줄(idx -1)이면 null', R(base, -1, { currentEval: 5 }), null);
  const act = R([{ date: 'd', evalAmount: 10, adjustedAmount: 10, actualEvalAmount: 10, principal: 146170.25, isFixed: false, isAdjusted: false }], 0, { currentEval: 20 });
  ok('#L10 활성 흐름이 만든 줄(adjustedAmount·actualEvalAmount)은 셋 다 같은 값으로', !!act && act[0].evalAmount === 20 && act[0].adjustedAmount === 20 && act[0].actualEvalAmount === 20);
  ok('#L11 원금 단위(해외계좌 달러 원금)는 건드리지 않음', !!act && act[0].principal === 146170.25);
}

console.log('\n── 파트② 소스 가드(useHistoryBackfill 효과#1) ──');
const raw = read('src/hooks/useHistoryBackfill.ts');
const hb = stripComments(raw);
const eff1 = (() => { const a = hb.indexOf('const typeById = new Map'); const b = hb.indexOf('}, [portfolioSummaries, activePortfolioId, effectiveDateKey, krEffectiveDateKey, marketHolidays]);'); return a > 0 && b > a ? hb.slice(a, b) : ''; })();
ok('#G1 import { refreshLiveTodayRow } from \'../liveTodayRow\'', /import \{ refreshLiveTodayRow \} from '\.\.\/liveTodayRow';/.test(hb));
ok('#G2 시장 계좌 분기가 오늘 줄이 있으면 refreshLiveTodayRow(hist, idx, summary)로 갱신한다', /if \(idx >= 0\) \{\s*const nh = refreshLiveTodayRow\(hist, idx, summary\);\s*return nh \? \{ \.\.\.p, history: nh \} : p;\s*\}/.test(eff1));
ok('#G3 옛 "같은 날 1건만(불변)" — 시장 계좌의 `if (idx >= 0) return p;` 가 돌아오지 않았다', !/nonActiveHistRecordedRef\.current\[key\] = summary\.currentEval;\s*if \(idx >= 0\) return p;/.test(eff1));
ok('#G4 사전체크/map ref 키 규칙 그대로(무한 루프 방지)', /nonActiveHistRecordedRef\.current\[key\] !== s\.currentEval/.test(eff1)
  && /nonActiveHistRecordedRef\.current\[key\] === summary\.currentEval\) return p;/.test(eff1));
const lt = stripComments(read('src/liveTodayRow.ts'));
ok('#G5 liveTodayRow.ts 는 import 0', !/^\s*import\s/m.test(lt));
ok('#G6 원금(principal)을 쓰지 않는다(해외계좌 원금 단위 보호)', !/\.principal\s*=/.test(lt));

console.log(`\n결과: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
console.log('✓ 모든 케이스 통과\n');
