#!/usr/bin/env node
// 금리 지표 과거 기록 Drive 저장 형식 검증 — src/rateHistStore.ts·indicatorCoverage.ts 를 **직접 import**한다(10-A, 2026-10).
//   압축·해제 왕복 · 병합(겹침·음수·잠정값 덮기) · 이어받기 시작일 · 10년 구간 · 4MB 분할 · 파일 읽기 · 배선
// ⚠️ 두 모듈은 import 0건이라 Node가 타입만 벗겨 실행한다. 런타임이 .ts를 못 읽으면 명시적으로 건너뛴다.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

const load = async (rel) => {
  try { return await import(pathToFileURL(join(ROOT, rel)).href); }
  catch (e) {
    const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
    if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 ${rel} 검사를 건너뜁니다.`);
    else { fail++; console.log(`  ✗ ${rel} 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
    return null;
  }
};
const H = await load('src/rateHistStore.ts');
const C = await load('src/indicatorCoverage.ts');

if (H && C) {
  const { encodeSeries, decodeSeries, mergeHist, resumeFrom, coversFloor, chunkRanges, planGroupFiles, readHistFiles, buildHistFile,
    HIST_GROUPS, HIST_KEYS, HIST_FILE_NAMES, HIST_FILE_MAX_BYTES, HIST_TAIL_OVERLAP_DAYS, splitFileName, fileBytes } = H;
  console.log('\n── 파트① 형식 ──');
  const s = { '2026-10-16': 4.12, '1962-01-02': 4.06, '2000-02-29': 6.5, '2026-10-15': 4.1 };
  const e = encodeSeries(s, false, 'api/history', '2026-10-18T00:00:00Z');
  eq('#1 압축 — 첫·마지막 날짜 · 일수 차이 · 값', [e.first, e.last, e.d[0], e.x], ['1962-01-02', '2026-10-16', 0, [4.06, 6.5, 4.1, 4.12]]);
  eq('#2 압축·해제 왕복 일치', decodeSeries(e), { '1962-01-02': 4.06, '2000-02-29': 6.5, '2026-10-15': 4.1, '2026-10-16': 4.12 });
  const sp = { '2023-01-03': -0.71, '2023-01-04': 0, '2023-01-05': 0.12 };
  eq('#3 금리차(signed) — 0·음수 보존 왕복', decodeSeries(encodeSeries(sp, true), true), sp);
  eq('#3b 일반 키 — 0·음수는 손상값으로 버린다', decodeSeries(encodeSeries(sp, false)), { '2023-01-05': 0.12 });
  eq('#4 빈 기록은 null', encodeSeries({}), null);
  eq('#5 손상 항목 — 길이 불일치·음수 일수는 그 관측만 버린다', decodeSeries({ first: '2026-01-01', d: [0, -1, 2, 3], x: [1, 2, 3] }), { '2026-01-01': 1, '2026-01-03': 3 });
  console.log('\n── 파트② 병합 ──');
  const base = { '2026-10-14': 4.0, '2026-10-15': 4.1 };
  const m1 = mergeHist(base, { '2026-10-15': 4.15, '2026-10-16': 4.2 });
  eq('#6 겹치는 날짜는 새로 받은 값이 이긴다(잠정값 보정) · 새 날짜 추가', m1, { '2026-10-14': 4.0, '2026-10-15': 4.15, '2026-10-16': 4.2 });
  ok('#6b 바뀐 게 없으면 원본 참조', mergeHist(base, { '2026-10-15': 4.1 }) === base);
  ok('#6c 입력 원본은 바뀌지 않는다', base['2026-10-15'] === 4.1 && !('2026-10-16' in base));
  eq('#7 금리차 병합은 음수로 덮어도 보존', mergeHist({ '2026-10-15': 0.1 }, { '2026-10-15': -0.2 }, true), { '2026-10-15': -0.2 });
  eq('#7b 일반 키 병합은 0·음수 덮기를 무시', mergeHist({ '2026-10-15': 4.1 }, { '2026-10-15': 0 }), { '2026-10-15': 4.1 });
  console.log('\n── 파트③ 이어받기·구간 ──');
  eq('#8 저장 기록 없음 → 출처 첫 날짜부터', resumeFrom(null, '1962-01-02', '2026-10-18'), '1962-01-02');
  eq('#9 저장 기록 있음 → 마지막 날짜 − 5일(겹쳐 받기)', resumeFrom({ last: '2026-10-10' }, '1962-01-02', '2026-10-18'), '2026-10-05');
  ok('#9b 겹침 5일', HIST_TAIL_OVERLAP_DAYS === 5);
  eq('#10 이미 최신이면 null(받지 않음)', resumeFrom({ last: '2026-10-18' }, '1962-01-02', '2026-10-18'), null);
  eq('#11 앞쪽이 비어 있으면(출처 첫 날짜 + 7일보다 늦게 시작) 처음부터 다시', [coversFloor({ first: '1962-01-05' }, '1962-01-02'), coversFloor({ first: '1990-01-02' }, '1962-01-02'), coversFloor(null, '1962-01-02')], [true, false, false]);
  const ch = chunkRanges('1962-01-02', '2026-10-18');
  ok('#12 10년 단위 — 7구간 · 빈틈·겹침 없음 · 오늘까지', ch.length === 7 && ch[0][0] === '1962-01-02' && ch[0][1] === '1972-01-01' && ch[6][1] === '2026-10-18'
    && ch.every((c, i) => i === 0 || c[0] === new Date(Date.parse(`${ch[i - 1][1]}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)));
  eq('#12b 짧은 기간은 1구간 · 거꾸로면 없음', [chunkRanges('2026-10-05', '2026-10-18'), chunkRanges('2026-10-19', '2026-10-18')], [[['2026-10-05', '2026-10-18']], []]);
  console.log('\n── 파트④ 파일·분할 ──');
  eq('#13 묶음 5개 · 키', HIST_GROUPS.map(g => [g.file, g.keys.length]), [['rate_hist_us.json', 7], ['rate_hist_credit.json', 5], ['rate_hist_kr.json', 4], ['rate_hist_br.json', 7], ['rate_hist_misc.json', 3]]);
  ok('#14 모든 키에 출처 첫 날짜(indicatorCoverage)가 있다', HIST_KEYS.every(k => /^\d{4}-\d{2}-\d{2}$/.test(C.INDICATOR_SOURCE_FLOOR[k] || '')));
  ok('#14b 금리차·스프레드 키는 signed', ['t10y2y', 't10y3m', 'mbsSpread', 'krUs10y', 'brReal'].every(k => HIST_KEYS.includes(k) && C.isSignedIndicator(k)));
  const g = HIST_GROUPS[0];
  const small = planGroupFiles(g, { us10y: e });
  ok('#15 4MB 이하 → 한 파일(둘째는 비움)', small[0].file === 'rate_hist_us.json' && small[0].body.keys.us10y && small[1].file === 'rate_hist_us_2.json' && small[1].body === null && small[0].bytes < HIST_FILE_MAX_BYTES);
  const big = {};
  const n = 140000;
  for (const k of g.keys) big[k] = { first: '1900-01-01', last: '2283-04-30', d: Array.from({ length: n }, (_, i) => i), x: Array.from({ length: n }, (_, i) => 4.123 + (i % 100) / 1000), source: 'x', savedAt: 'y' };
  const split = planGroupFiles(g, big);
  ok('#16 4MB 초과 → 키를 반으로 나눠 두 파일, 각 키는 한 파일에만', fileBytes(buildHistFile(big)) > HIST_FILE_MAX_BYTES && split[1].body && Object.keys(split[0].body.keys).length === 4 && Object.keys(split[1].body.keys).length === 3
    && split[1].file === splitFileName('rate_hist_us.json'));
  const files = { 'rate_hist_us.json': { v: 1, keys: { us10y: e, zzz: e } }, 'rate_hist_kr.json': { v: 2, keys: { kr10y: e } }, 'rate_hist_us_2.json': { v: 1, keys: { us2y: e } } };
  eq('#17 파일 읽기 — 버전이 다른 파일·모르는 키는 버린다 · 분할 파일도 읽는다', Object.keys(readHistFiles(files)).sort(), ['us10y', 'us2y']);
  eq('#17b 크기는 UTF-8 바이트(한글 3바이트)', [fileBytes({ a: 'x' }), fileBytes({ a: '한' }), fileBytes({ a: '😀' })], [9, 11, 12]);
  ok('#18 앱 탭 허용 이름 = 5개 + 분할 5개', HIST_FILE_NAMES.length === 10 && HIST_FILE_NAMES.includes('rate_hist_misc_2.json'));
}

console.log('\n── 파트⑤ 배선 가드 ──');
{
  const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const DS = src('src/driveStorage.ts'), APP = src('src/App.tsx'), RW = src('src/components/RateWindow.tsx'), HS = src('src/rateHistStore.ts');
  const pkg = JSON.parse(src('package.json'));
  ok('#G1 저장 파일 5개가 DRIVE_FILES에 있다', ['us', 'credit', 'kr', 'br', 'misc'].every(id => new RegExp(`RATE_HIST_${id.toUpperCase()}:\\s*'rate_hist_${id}\\.json'`).test(DS)));
  ok('#G2 순수 모듈은 import 0건', !/^\s*import\s/m.test(HS));
  const h = (APP.match(/if \(d\.type === 'rate:histSave'\) \{[\s\S]*?\n {6}\}/) || [''])[0];
  ok('#G3 앱 탭은 허용 이름만 saveDriveFile로 저장(버전 백업 없음)', /if \(!HIST_FILE_NAMES\.includes\(d\.name\)/.test(h) && /await saveDriveFile\(token, folderId, d\.name, d\.body\);/.test(h) && !/saveVersionedBackup/.test(h) && /if \(!canWrite\) return reply/.test(h));
  ok('#G4 불러오기는 허용 이름 전부를 loadDriveFile로', /HIST_FILE_NAMES\.map\(n => loadDriveFile\(token, folderId, n\)\)/.test(APP));
  ok('#G5 창 — Drive 모드면 이어받기, 아니면 메모리 모드(기존 받기) + 안내', /setStoreMode\('drive'\);\s+runCollection\(false\);/.test(RW) && /storeMode !== 'memory'\) return;\s+const y = PERIODS/.test(RW) && /기록 저장 안 됨\(앱 탭 필요\)/.test(RW));
  ok('#G6 한 번에 4개 키 · 묶음마다 저장 · 10년 구간 · 실패하면 멈춤', /i \+= HIST_BATCH_KEYS/.test(RW) && /for \(const g of groups\) await saveGroup\(g\);/.test(RW) && /chunkRanges\(j\.from, today\)/.test(RW) && /if \(!rec\) \{ ok = false; break; \}/.test(RW));
  ok('#G7 진행 막대 · 관리자 전체 다시 받기(확인 후)', /과거 기록 수집 중 \{collect\.done\}\/\{collect\.total\}/.test(RW) && /isAdmin && storeMode === 'drive'/.test(RW) && /runCollection\(true\)/.test(RW) && /진행할까요\?/.test(RW));
  ok('#G8 앱 탭이 관리자 여부를 알려 준다', /isAdmin: !!rateIsAdminRef\.current/.test(APP));
  ok('#G9 검증 스크립트가 게이트 목록에 있다', pkg.scripts['verify:rate-hist'] === 'node scripts/verify-rate-hist.mjs');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:rate-hist — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
