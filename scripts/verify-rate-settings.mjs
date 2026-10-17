#!/usr/bin/env node
// 금리 모니터링 ⑥ 설정 검증 — src/rateSettings.ts·rateSignals.ts·rateAssets.ts 를 **직접 import**한다(미러 금지, 2026-10 9-A).
//   기본값 병합 · 범위 밖 거부 · 오래된 값 판정 · 메모 검증 · 저장 파일 이름(DRIVE_FILES) · 앱 탭 저장 경로 배선
// ⚠️ 세 모듈은 import 0건이라 Node가 타입만 벗겨 실행한다. 런타임이 .ts를 못 읽으면 명시적으로 건너뛴다.
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
const X = await load('src/rateSettings.ts');
const S = await load('src/rateSignals.ts');
const AS = await load('src/rateAssets.ts');

if (X && S && AS) {
  const { mergeRules, diffRules, validateRules, rulesToDraft, draftToRules, checkRuleValue, RULE_FIELDS, fieldId, getRule,
    mergeManual, manualStale, manualAsOfDate, checkManualValue, checkNote, normalizeNotes, buildSettingsFile, applySettingsFile } = X;
  const { RATE_RULES, evaluateRateSignals } = S;
  const { MANUAL_INPUTS, buildRateAssetRow } = AS;
  console.log('\n── 파트① 기준치 병합·검증 ──');
  ok('#1 화면 칸이 RATE_RULES의 숫자 칸을 전부 덮는다', RULE_FIELDS.every(f => typeof getRule(RATE_RULES, f) === 'number')
    && RULE_FIELDS.length === Object.entries(RATE_RULES).reduce((n, [, v]) => n + (typeof v === 'number' ? 1 : Object.keys(v).length), 0));
  const before = JSON.stringify(RATE_RULES);
  const merged = mergeRules(RATE_RULES, { tlt: { pctMin: 80 }, hy: { positionMin: 150 }, reit: { oYieldMin: 'x' }, nope: { a: 1 }, withholdingPct: 10 });
  eq('#2 기본값 위에 유효한 저장값만 덮는다(범위 밖·문자·없는 칸은 기본값)', [merged.tlt.pctMin, merged.hy.positionMin, merged.reit.oYieldMin, merged.withholdingPct, 'nope' in merged],
    [80, RATE_RULES.hy.positionMin, RATE_RULES.reit.oYieldMin, 10, false]);
  ok('#2b 기본값 객체는 바뀌지 않는다', JSON.stringify(RATE_RULES) === before);
  eq('#3 파일이 없으면 기본값 그대로', JSON.stringify(applySettingsFile(null, RATE_RULES, MANUAL_INPUTS).rules) === before, true);
  eq('#4 저장할 것 = 기본값과 다른 칸만', diffRules(RATE_RULES, merged), { withholdingPct: 10, tlt: { pctMin: 80 } });
  const draft = rulesToDraft(RATE_RULES);
  eq('#5 기본값 초안은 오류 0', validateRules(draft), {});
  const bad = { ...draft, 'tlt.pctMin': '120', 'reit.oYieldMin': '-1', 'brBond.selicCalmDays': '10.5', 'hy.positionMin': '', 'bdc.mainDrawdownMax': '5' };
  const errs = validateRules(bad);
  eq('#6 범위 밖 거부 — 백분위 0~100 밖 · 음수 배당률 · 정수 칸 소수 · 빈 칸 · 하락률 양수', Object.keys(errs).sort(),
    ['bdc.mainDrawdownMax', 'brBond.selicCalmDays', 'hy.positionMin', 'reit.oYieldMin', 'tlt.pctMin']);
  ok('#6b 사유 문구', errs['tlt.pctMin'] === '0~100 사이만 가능합니다' && errs['brBond.selicCalmDays'] === '정수만 가능합니다' && errs['hy.positionMin'] === '값을 입력하세요');
  ok('#7 칸끼리 관계 — 매수 관심 > 매수 적기 · 장부가 기준 > 경고면 거부', !!validateRules({ ...draft, 'brBond.watchScore': '5', 'brBond.buyScore': '4' })['brBond.buyScore']
    && !!validateRules({ ...draft, 'mreit.pbMax': '1.2', 'mreit.pbWarn': '1.1' })['mreit.pbWarn']);
  eq('#8 초안 → 규칙(범위 밖 칸은 기본값 유지)', [draftToRules(RATE_RULES, { ...draft, 'tlt.pctMin': '75' }).tlt.pctMin, draftToRules(RATE_RULES, bad).tlt.pctMin], [75, RATE_RULES.tlt.pctMin]);
  ok('#9 문자열 숫자·공백 허용, 문자 거부', checkRuleValue(RULE_FIELDS[0], ' 15 ').ok && !checkRuleValue(RULE_FIELDS[0], '15%').ok);

  console.log('\n── 파트② 수동값·메모 ──');
  const m = mergeManual(MANUAL_INPUTS, { AGNC: { value: 8.5, asOf: '2026-06-30' }, NLY: { value: -1, asOf: '2026-06-30' }, MAIN: { value: 31.2, asOf: '2026-Q2' }, ZZZ: { value: 1, asOf: '2026-06-30' } });
  eq('#10 수동값 병합 — 유효값만 · 목록 밖 티커 무시', [m.bookValue.AGNC, m.bookValue.NLY.value, m.nav.MAIN, 'ZZZ' in m.bookValue || 'ZZZ' in m.nav], [{ value: 8.5, asOf: '2026-06-30' }, null, { value: 31.2, asOf: '2026-Q2' }, false]);
  ok('#10b 수동값 기본 객체는 바뀌지 않는다', MANUAL_INPUTS.bookValue.AGNC.value === null);
  eq('#11 기준일 — 날짜 · 분기(분기 말일) · 못 읽으면 null', [manualAsOfDate('2026-06-30'), manualAsOfDate('2026-Q2'), manualAsOfDate('2026-Q4'), manualAsOfDate('2026-02-30'), manualAsOfDate('')],
    ['2026-06-30', '2026-06-30', '2026-12-31', null, null]);
  eq('#12 오래된 값 — 120일 초과만 · 경계 120일은 아님 · 기준일 없으면 아님', [manualStale('2026-06-18', '2026-10-17'), manualStale('2026-06-19', '2026-10-17'), manualStale('2026-Q1', '2026-10-17'), manualStale('', '2026-10-17')],
    [true, false, true, false]);
  eq('#13 수동값 검사 — 빈 칸은 입력 필요(null) · 0·음수·문자 거부', [checkManualValue('').ok && checkManualValue('').value, checkManualValue('0').ok, checkManualValue('-2').ok, checkManualValue('abc').ok, checkManualValue('8.5').value],
    [null, false, false, false, 8.5]);
  const row = buildRateAssetRow('AGNC', { quote: { price: 9.35 } }, '2026-10-16', null, false, m);
  ok('#14 설정한 장부가가 ⑤ 표 주가÷장부가에 쓰인다', row.manualSet === true && Math.abs(row.pb - 9.35 / 8.5) < 1e-12);
  eq('#15 메모 검사', [checkNote({ date: '2026-10-01', text: '재정 준칙', impact: '불리', source: '' }), checkNote({ date: '2026-13-01', text: 'x', impact: '불리' }),
    checkNote({ date: '2026-10-01', text: ' ', impact: '불리' }), checkNote({ date: '2026-10-01', text: 'x', impact: '나쁨' }), checkNote({ date: '2026-10-01', text: 'x', impact: '중립', source: 'javascript:alert(1)' })],
    [null, '날짜(YYYY-MM-DD)를 확인하세요', '내용을 입력하세요', '영향을 고르세요', '출처는 http(s) 링크만 가능합니다']);
  eq('#16 저장 파일 — 바꾼 기준치만 · 값 있는 수동값만 · 유효 메모만', (() => {
    const f = buildSettingsFile(RATE_RULES, merged, m, [{ date: '2026-10-01', text: '재정 준칙 통과', impact: '유리', source: 'https://example.com' }, { date: 'bad', text: 'x', impact: '불리' }], '2026-10-18T00:00:00.000Z');
    return [f.rules, Object.keys(f.manual), f.brazilNotes.length, f.updatedAt];
  })(), [{ withholdingPct: 10, tlt: { pctMin: 80 } }, ['AGNC', 'MAIN'], 1, '2026-10-18T00:00:00.000Z']);
  eq('#16b 손상 파일은 기본값으로', JSON.stringify(applySettingsFile({ rules: 'x', manual: 5, brazilNotes: 'y' }, RATE_RULES, MANUAL_INPUTS).rules) === before, true);

  console.log('\n── 파트③ 판정에 반영 ──');
  const met = (o) => ({ current: 1, change1m: 0, high52: 9, position52: 10, pct3y: 10, turnedDown: false, ...o });
  const all = { us10y: met({ pct3y: 65 }) };
  const reit = (rules) => evaluateRateSignals(all, {}, {}, rules).find(r => r.key === 'equityReit').state;
  eq('#17 설정 기준치로 다시 판정 — 실물 리츠 10년 백분위 기준 70 → 60', [reit(null), reit(mergeRules(RATE_RULES, { reit: { pctMin: 60 } }))], ['wait', 'watch']);
  ok('#17b 판정 뒤 기본 기준치로 돌아온다', reit(null) === 'wait');
}

console.log('\n── 파트④ 배선 가드 ──');
{
  const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const DS = src('src/driveStorage.ts'), APP = src('src/App.tsx'), RW = src('src/components/RateWindow.tsx'), RS = src('src/rateSettings.ts');
  const PANEL = src('src/components/RateSettingsPanel.tsx');
  const pkg = JSON.parse(src('package.json'));
  const strip = (x) => x.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  ok('#G1 저장 파일 이름이 DRIVE_FILES에 있다', /RATE_SETTINGS:\s*'rate_monitor_settings\.json'/.test(DS));
  ok('#G2 순수 모듈은 import 0건', !/^\s*import\s/m.test(RS));
  const h = (APP.match(/if \(d\.type === 'rate:settingsSave'\) \{[\s\S]*?\n {6}\}/) || [''])[0];
  ok('#G3 앱 탭이 saveDriveFile로 사용자 폴더에 저장한다(버전 백업 없음)', /await saveDriveFile\(token, folderId, DRIVE_FILES\.RATE_SETTINGS, file\);/.test(h) && !/saveVersionedBackup/.test(h));
  ok('#G4 창이 보낸 값을 앱 탭에서 다시 병합·검증한다', /const merged = applySettingsFile\(d\.data, RATE_RULES, MANUAL_INPUTS\);/.test(h) && /buildSettingsFile\(RATE_RULES, merged\.rules, merged\.manual, merged\.notes,/.test(h));
  ok('#G5 관리자 접속 중·권한 없음·토큰 없음이면 저장하지 않는다', /const canWrite = !!rateAccessRef\.current && !!driveTokenRef\.current && !adminViewingAsRef\.current;/.test(APP) && /if \(!canWrite\) return reply\(\{ type: 'rate:settingsSaved'/.test(h));
  ok('#G6 입양된 창만 설정을 읽고 쓴다', /if \(rateWinRef\.current !== e\.source\) return;\s+\/\/ 입양된 창만/.test(APP));
  ok('#G7 불러오기는 loadDriveFile(파일 없으면 기본값)', /await loadDriveFile\(token, folderId, DRIVE_FILES\.RATE_SETTINGS\)/.test(APP) && /applySettingsFile\(settingsFile, RATE_RULES, MANUAL_INPUTS\)/.test(RW));
  ok('#G8 앱 탭이 없으면 수정 막고 안내', /writable=\{linked && canWrite && settingsState === 'ready'\}/.test(RW) && /'앱 탭이 열려 있어야 저장됩니다'/.test(RW));
  ok('#G9 판정·표가 설정값을 쓴다', /evaluateRateSignals\(metrics, assetRows, brazilExtras, effRules\)/.test(RW) && /buildRateAssetRow\(tk, assetData\[tk\], today, us10yNow, g\.etfs\.includes\(tk\), eff\.manual\)/.test(RW)
    && /readBrazilNotes\(eff\.notes\)/.test(RW));
  ok('#G10 알림 없음 — 실패는 패널 안 빨간 글씨', !/notify\(/.test(strip(PANEL)) && !/notify\(/.test(strip(RW)) && /setSaveError\(res\?\.error/.test(PANEL));
  ok('#G11 검증 스크립트가 게이트 목록에 있다', pkg.scripts['verify:rate-settings'] === 'node scripts/verify-rate-settings.mjs');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:rate-settings — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
