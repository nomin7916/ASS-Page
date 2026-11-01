#!/usr/bin/env node
// 분배금 링크 공유 검증 — 관리자 7칸 → 설정 시트(reportLinks 행의 분배금 항목) → 분배금 사용자(feature3) 칸별 병합.
//   키가 reportLinks인 이유: 배포된 Apps Script가 새 키 dividendLinks를 거부해 공유가 늘 실패했다(2026-11, 재배포 불필요화).
//   src/utils.ts 를 **직접 import**한다(미러 금지). 사용자 확정(2026-10-29): 기본값 + 사용자 수정 가능,
//   관리자가 바꾼 칸만 다시 덮는다. 런타임이 .ts를 못 읽으면 단위 검사만 건너뛴다(배선 가드는 그대로 돈다).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

let U = null;
try { U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/utils.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

const L = (pairs) => Array.from({ length: 7 }, (_, i) => ({ initial: pairs[i]?.[0] ?? '', url: pairs[i]?.[1] ?? '' }));
const E = L([]);

if (U) {
  const { parseSharedDividendLinks: parse, mergeSharedDividendLinks: merge } = U;
  console.log('\n── 파트① 공유값 해석 ──');
  eq('#P1 키 없음 → null', parse(undefined), null);
  eq('#P2 빈 배열 → null(관리자 미배포)', parse([]), null);
  eq('#P3 깨진 JSON 문자열 → null', parse('[{'), null);
  eq('#P4 JSON 문자열 → 7칸 정규화', parse(JSON.stringify([{ initial: 'TT', url: 'a.com' }])), L([['T', 'a.com']]));
  eq('#P5 배열 → 7칸 정규화', parse([{ initial: 'K', url: 'k.com' }, null]), L([['K', 'k.com']]));

  console.log('\n── 파트② 칸별 병합 ──');
  const admin = L([['T', 't.com'], ['A', 'a.com'], ['K', 'k.com']]);
  eq('#M1 공유값 없음 → null(사용자 링크 불변)', merge(L([['X', 'x.com']]), null, null), null);
  {
    const r = merge(E, admin, null);
    eq('#M2 처음 + 빈 사용자 → 관리자 값으로 채움', r.links, admin);
    ok('#M2b changed·seenChanged', r.changed && r.seenChanged);
    eq('#M2c seen = 공유값', r.seen, admin);
  }
  {
    const mine = L([['X', 'x.com']]);
    const r = merge(mine, admin, null);
    eq('#M3 처음 + 개인 링크 있는 칸은 유지, 빈 칸만 채움', r.links, L([['X', 'x.com'], ['A', 'a.com'], ['K', 'k.com']]));
  }
  {
    const userEdited = L([['T', 't.com'], ['Z', 'z.com'], ['K', 'k.com']]);
    const r = merge(userEdited, admin, admin);
    eq('#M4 관리자 변경 없음 → 사용자 수정 유지', r.links, userEdited);
    ok('#M4b 변경 없음 = 저장 유발 없음', !r.changed && !r.seenChanged);
  }
  {
    const userEdited = L([['T', 't.com'], ['Z', 'z.com'], ['K', 'k.com']]);
    const admin2 = L([['T', 't2.com'], ['A', 'a.com'], ['K', 'k.com'], ['S', 's.com']]);
    const r = merge(userEdited, admin2, admin);
    eq('#M5 관리자가 바꾼 칸(1·4)만 덮고 사용자가 고친 칸(2)은 유지', r.links, L([['T', 't2.com'], ['Z', 'z.com'], ['K', 'k.com'], ['S', 's.com']]));
    eq('#M5b seen 갱신', r.seen, admin2);
  }
  {
    const admin3 = L([['T', 't.com'], ['', ''], ['K', 'k.com']]);
    const r = merge(admin, admin3, admin);
    eq('#M6 관리자가 지운 칸은 사용자 화면에서도 지워진다', r.links, admin3);
  }
  {
    const r1 = merge(E, admin, null);
    const r2 = merge(r1.links, admin, r1.seen);
    ok('#M7 멱등 — 두 번째 병합은 아무것도 바꾸지 않는다(effect 무한 루프 없음)', !r2.changed && !r2.seenChanged);
  }

  const { sharedDividendLinksFromReportRow: fromRow, patchReportRow: patchRow } = U;
  console.log('\n── 파트③ 시트 reportLinks 행(리포트 항목 + 분배금 항목) ──');
  const rep = { title: '시장동향 리포트', url: 'r.com' };
  eq('#R1 행 없음·빈 행·리포트만 → null(사용자 링크 불변)', [fromRow(undefined), fromRow([]), fromRow([rep]), fromRow('[{')], [null, null, null, null]);
  const withDiv = patchRow([rep], { dividendLinks: admin });
  eq('#R2 분배금 항목을 넣어도 리포트 항목은 그대로 맨 앞', withDiv[0], rep);
  ok('#R2b 분배금 항목에는 url 키가 없다(리포트 URL 선택이 무시)', withDiv.length === 2 && !('url' in withDiv[1]));
  eq('#R3 왕복 — 행에서 꺼낸 값 = 관리자 7칸(배열·JSON 문자열 모두)', [fromRow(withDiv), fromRow(JSON.stringify(withDiv))], [admin, admin]);
  eq('#R4 리포트를 바꿔도 분배금 항목은 시트 값 그대로', patchRow(withDiv, { report: [{ title: '시장동향 리포트', url: 'r2.com' }] }), [{ title: '시장동향 리포트', url: 'r2.com' }, withDiv[1]]);
  eq('#R5 리포트를 지워도 분배금 항목은 남는다', fromRow(patchRow(withDiv, { report: [] })), admin);
  {
    const admin2 = L([['T', 't2.com']]);
    const r = patchRow(withDiv, { dividendLinks: admin2 });
    ok('#R6 분배금 재배포는 항목을 교체(중복 없음)·리포트 유지', r.length === 2 && r[0] === withDiv[0] && JSON.stringify(fromRow(r)) === JSON.stringify(admin2));
  }
  eq('#R7 같은 값 재배포 = 시트 값과 동일(쓰기 생략 근거)', JSON.stringify(patchRow(JSON.parse(JSON.stringify(withDiv)), { dividendLinks: admin })), JSON.stringify(withDiv));
  eq('#R8 깨진 행 문자열은 빈 행으로 보고 분배금만 싣는다', fromRow(patchRow('[{', { dividendLinks: admin })), admin);
}

console.log('\n── 파트④ 배선 가드 ──');
{
  const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const strip = (x) => x.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const APP = strip(src('src/App.tsx'));
  const DST = strip(src('src/components/DividendSummaryTable.tsx'));
  const PS = strip(src('src/hooks/usePortfolioState.ts'));
  const GS = src('_downloads/AppsScript_계정관리_arui114501.js');
  const pkg = JSON.parse(src('package.json'));
  const utilsImport = (APP.match(/import \{([^}]*)\} from '\.\/utils';/) || [, ''])[1];
  ok('#G1 App이 두 함수를 utils에서 import한다', /\bparseSharedDividendLinks\b/.test(utilsImport) && /\bmergeSharedDividendLinks\b/.test(utilsImport));
  ok('#G2 관리자 배포 = reportLinks 행의 분배금 항목만 고친다(새 키 dividendLinks로 쓰지 않는다)',
    /await patchSheetReportRow\(\{ dividendLinks: JSON\.parse\(v\) \}\)/.test(APP) && !/deploySettingToSheet\('dividendLinks'/.test(APP));
  ok('#G3 배포·병합 모두 정상 로드 게이트(divLinksBootFor)를 거친다',
    /if \(!isRealAdmin \|\| divLinksBootFor !== authUser\.email\.toLowerCase\(\)\) return;/.test(APP)
    && /if \(divLinksBootFor !== authUser\.email\.toLowerCase\(\)\) return;/.test(APP)
    && /if \(syncStatusRef\.current !== 'error'\) setDivLinksBootFor\(authUser\.email\.toLowerCase\(\)\);/.test(APP));
  ok('#G4 로그인·계정 전환 시 게이트와 공유값을 초기화한다', /setAdminViewingAs\(null\);\s*adminViewingAsRef\.current = null;\s*setDivLinksBootFor\(null\);\s*setSharedDividendLinks\(null\);/.test(APP));
  ok('#G5 일반 사용자 부팅이 설정 시트 reportLinks 행에서 읽는다',
    /if \(!isAdmin\) setSharedDividendLinks\(sharedDividendLinksFromReportRow\(rl\) \?\? parseSharedDividendLinks\(settingsData\.dividendLinks\)\);/.test(APP)
    && /\bsharedDividendLinksFromReportRow\b/.test(utilsImport) && /\bpatchReportRow\b/.test(utilsImport));
  ok('#G6 병합은 분배금 사용자만 · 관리자 접속 중 제외', /if \(!authUser \|\| adminViewingAs \|\| !sharedDividendLinks \|\| !userFeatures\.feature3\) return;/.test(APP));
  ok('#G7 seen이 STATE에 저장·로드된다(payload · deps · 구조 지문 · applyStateData)',
    /overseasLinks, dividendLinks, dividendLinksSeen, stockHistoryMap/.test(APP)
    && (APP.match(/overseasLinks, dividendLinks, dividendLinksSeen, stockHistoryMap/g) || []).length === 2
    && /JSON\.stringify\(dividendLinks\), JSON\.stringify\(dividendLinksSeen\)/.test(APP)
    && /setDividendLinksSeen\(Array\.isArray\(stateData\.dividendLinksSeen\)/.test(APP)
    && /const \[dividendLinksSeen, setDividendLinksSeen\] = useState\(null\);/.test(PS) && /dividendLinksSeen, setDividendLinksSeen,/.test(PS));
  ok('#G8 공유 상태 문구가 링크 편집창까지 전달된다', /dividendLinksNote=\{dividendLinksNote\}/.test(APP) && /note=\{dividendLinksNote\}/.test(DST) && /\{note\.text\}/.test(DST));
  ok('#G9 벨 알림 없음(알림 최소화) — 공유 실패는 편집창 안 문구', !/notify\([^)]*공유/.test(APP));
  ok('#G10 재배포 불필요 — 기존 Apps Script도 reportLinks 쓰기를 허용하고 읽기에 돌려준다',
    /const allowed = \{[^}]*reportLinks: true[^}]*\};/.test(GS) && /reportLinks:\s*safeParseJson\(map\['reportLinks'\], \[\]\)/.test(GS));
  ok('#G12 reportLinks 행은 읽고-고쳐-쓰기로만 쓴다(통째 쓰기 금지 · error 응답 불신 · 같으면 생략)',
    (APP.match(/deploySettingToSheet\('reportLinks'/g) || []).length === 1
    && /return deploySettingToSheet\('reportLinks', JSON\.stringify\(next\)\);/.test(APP)
    && /if \(!d \|\| d\.error\) return false;/.test(APP)
    && /const next = patchReportRow\(row, patch\);/.test(APP));
  ok('#G13 리포트 저장과 분배금 배포가 같은 줄(sheetReportRowChainRef)로 직렬화된다',
    /sheetReportRowChainRef\.current = sheetReportRowChainRef\.current\.then\(async \(\) => \{/.test(APP)
    && /const run = sheetReportRowChainRef\.current\.then\(\(\) => patchSheetReportRow\(\{ report: links \}\)\);\s*sheetReportRowChainRef\.current = run;/.test(APP));
  ok('#G11 검증 스크립트가 게이트 목록에 있다', pkg.scripts['verify:div-links'] === 'node scripts/verify-div-links.mjs');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:div-links — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
