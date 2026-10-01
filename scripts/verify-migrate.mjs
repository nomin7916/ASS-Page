#!/usr/bin/env node
// 관리자 '계정 이전' 검증.   실행: npm run verify:migrate
//
// 발단(사용자 보고 2026-10): Google 계정에 문제가 생겨 새 계정을 만든 사용자가 계좌·종목·기록을 전부
//   다시 입력해야 했다. 데이터는 전부 사용자 Drive `Index_Data_<email>` 폴더의 JSON이고 이메일이 박혀
//   있지 않으므로, 관리자가 옛 폴더를 읽어 새 폴더의 **기존 파일을 갱신**하면 그대로 산다.
//
// 구성 ①  src/accountMigration.ts 를 **직접 import** 해 순수 함수를 테스트한다(미러 금지).
// 구성 ②  소스 텍스트 가드 — 배선은 산술로 표현할 수 없다. **선언이 아니라 사용부**를 단언한다.
//        핵심 계약: 대상 폴더에 새 파일을 만들지 않는다(관리자 소유 파일은 사용자 앱이 못 읽을 수 있다) ·
//        원본에는 쓰지 않는다 · 덮어쓰기 전 대상 STATE를 관리자 폴더에 백업한다 · 전체 drive 스코프 토큰 ·
//        적용 게이트 3종(미리보기 ok·확인 체크·데이터 있으면 이메일 입력).
//        실패 시 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
// 단언이 던지면 스크립트가 죽어 요약 줄이 안 나오고, 변이 하네스가 그것을 '검출'로 위장한다 → 예외는 그 케이스의 실패로.
const S = (fn) => { try { return fn(); } catch (e) { return { __threw: String(e && e.message || e) }; } };

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? '' : s.slice(i, j);
};
const count = (s, re) => (s.match(re) || []).length;

console.log('\n── 파트① 순수 함수 (src/accountMigration.ts 직접 import) ──');

let M = null;
try {
  M = await import(pathToFileURL(join(ROOT, 'src/accountMigration.ts')).href);
} catch (e) {
  if (e && e.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
    console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  } else {
    fail++;
    console.log(`  ✗ src/accountMigration.ts 로드 실패 — ${e && (e.code || e.message)}`);
  }
}

const acct = (over = {}) => ({ id: 'a1', name: 'A', accountType: 'portfolio', portfolio: [], history: [], depositHistory: [], depositHistory2: [], ...over });
const srcState = () => ({
  portfolios: [
    acct({
      portfolio: [{ type: 'stock', code: '005930', quantity: 10, investAmount: 100000 }, { type: 'deposit', depositAmount: 5000 }],
      history: [{ date: '2026-01-02', evalAmount: 1 }, { date: '2026-01-03', evalAmount: 2 }],
      depositHistory: [{ date: '2026-01-01', amount: 100 }],
    }),
    acct({ id: 'a2', deletedAt: '2026-05-01', history: [{ date: '2025-12-30', evalAmount: 3 }] }),
  ],
  activePortfolioId: 'a1',
  calendarMemos: { '2026-01-02': [{ id: 'm' }] },
  watchlistGroups: [{ id: 'g' }],
  flowMaps: [{ id: 'f' }],
  backtestScenarios: [{ id: 'b' }],
  ledgerBooks: [{ id: 'l' }],
  chartPrefs: { hideAmounts: true },
  adminAccessAllowed: true,
  portfolioUpdatedAt: 1700000000000,
  chartPrefsUpdatedAt: 1600000000000,
  stockHistoryMap: { '005930': { '2026-01-02': 1 } },
  marketIndicators: { usdkrw: 1300 },
  manualSavedAt: 5,
});
// 전제 조건 '계좌 1개 생성' 직후의 대상 — 데이터로 치지 않는다
const dummyTarget = () => ({ portfolios: [acct({ portfolio: [{ type: 'deposit', depositAmount: 0 }], history: [{ date: '2026-09-30', evalAmount: 0 }] })] });
const allHas = { STATE: true, MARKET: true, STOCK: true, DIVIDEND_TAX: true, NOTIFICATION_LOG: true };
const baseIn = (over = {}) => ({
  srcEmail: 'old@x.com', dstEmail: 'new@x.com', adminEmail: 'admin@x.com',
  srcFolderFound: true, dstFolderFound: true, srcState: srcState(), dstHasState: true,
  dstState: dummyTarget(), srcHas: allHas, dstHas: allHas,
  srcUser: { email: 'old@x.com', feature1: true, flowEnabled: true },
  dstUser: { email: 'new@x.com', feature1: false, flowEnabled: true, ledgerEnabled: true },
  dstLastSeen: 0, now: 1_800_000_000_000,
  ...over,
});

if (M) {
  const { MIGRATION_FILES, MIGRATION_FEATURE_KEYS, diffFeatureFlags, summarizeState, targetHasData, planFileCopies,
    migrationBlockers, buildMigrationPreview, migrationErrorPreview, prepareMigratedState, migrationBackupName } = M;

  // ── 파일 목록 계약 ──
  eq('#1 STATE가 첫 항목(적용 루프가 STATE 실패 시 나머지를 중단한다)', S(() => MIGRATION_FILES[0].key), 'STATE');
  ok('#1b STATE만 required', MIGRATION_FILES.filter(f => f.required).map(f => f.key).join() === 'STATE');
  const ds = read('src/driveStorage.ts');
  const driveName = (k) => (ds.match(new RegExp(`^\\s*${k}:\\s*'([^']+)'`, 'm')) || [])[1];
  for (const f of MIGRATION_FILES) eq(`#1c ${f.key} 파일명이 DRIVE_FILES와 같다`, f.name, driveName(f.key));
  eq('#1d 기능 플래그 9종 = Apps Script colMap 순서', [...MIGRATION_FEATURE_KEYS],
    ['feature1', 'feature2', 'feature3', 'youtubeEnabled', 'notebookEnabled', 'reportEnabled', 'flowEnabled', 'backtestEnabled', 'ledgerEnabled']);

  // ── 기능 플래그 차이 ──
  eq('#2 차이 나는 것만, 값은 원본', S(() => diffFeatureFlags({ feature1: true, flowEnabled: true }, { feature1: false, flowEnabled: true, ledgerEnabled: true })),
    [{ feature: 'feature1', value: true }, { feature: 'ledgerEnabled', value: false }]);
  eq('#2b 같으면 빈 배열', S(() => diffFeatureFlags({ feature2: true }, { feature2: true })), []);
  eq('#2c undefined는 false로 본다 (dst null)', S(() => diffFeatureFlags({ feature1: true }, null)), [{ feature: 'feature1', value: true }]);

  // ── STATE 요약 ──
  const sum = S(() => summarizeState(srcState()));
  eq('#3 요약: 계좌 2 · 라이브 1 · 종목 1 · 기록 3건 · 원장 1 · 앱 레벨 각 1', [sum.accounts, sum.liveAccounts, sum.items, sum.historyRecords, sum.deposits, sum.calendarMemoDays, sum.watchlistGroups, sum.flowMaps, sum.backtestScenarios, sum.ledgerBooks],
    [2, 1, 1, 3, 1, 1, 1, 1, 1, 1]);
  eq('#3b 기록 범위는 삭제 계좌까지 포함해 가장 이른~늦은 날짜', [sum.historyFrom, sum.historyTo], ['2025-12-30', '2026-01-03']);
  eq('#3c portfolioUpdatedAt 전달', sum.portfolioUpdatedAt, 1700000000000);
  eq('#3d null·손상값은 0 요약', S(() => summarizeState(null).accounts), 0);
  eq('#3e 예수금 행은 종목 수에 넣지 않는다', S(() => summarizeState({ portfolios: [acct({ portfolio: [{ type: 'deposit', depositAmount: 9 }] })] }).items), 0);

  // ── 대상에 데이터가 있는가 ──
  eq('#4 더미 계좌 1개(종목 0·기록 1)는 데이터 없음', S(() => targetHasData(dummyTarget())), false);
  eq('#4b 종목 수량이 있으면 데이터 있음', S(() => targetHasData({ portfolios: [acct({ portfolio: [{ type: 'stock', quantity: 1 }] })] })), true);
  eq('#4c 라이브 계좌 2개면 데이터 있음', S(() => targetHasData({ portfolios: [acct(), acct({ id: 'b' })] })), true);
  eq('#4d 삭제 계좌는 라이브로 세지 않는다', S(() => targetHasData({ portfolios: [acct(), acct({ id: 'b', deletedAt: '2026-01-01' })] })), false);
  eq('#4e 메모달력이 있으면 데이터 있음', S(() => targetHasData({ portfolios: [acct()], calendarMemos: { '2026-01-01': [{}] } })), true);
  eq('#4f 입출금 원장이 있으면 데이터 있음', S(() => targetHasData({ portfolios: [acct({ depositHistory2: [{ amount: 1 }] })] })), true);

  // ── 파일 계획 ──
  const plan = S(() => planFileCopies({ STATE: true, MARKET: true, STOCK: true }, { STATE: true, MARKET: true, STOCK: false }));
  eq('#5 STATE·MARKET 갱신 / STOCK·배당세·알림은 대상 없음 건너뜀', plan.map(f => f.action),
    ['update', 'update', 'skip-target-missing', 'skip-target-missing', 'skip-target-missing']);
  eq('#5b 대상에 STATE가 없으면 blocked', S(() => planFileCopies(allHas, { ...allHas, STATE: false })[0].action), 'blocked');
  eq('#5c 원본에 STATE가 없어도 blocked', S(() => planFileCopies({ ...allHas, STATE: false }, allHas)[0].action), 'blocked');
  eq('#5d 원본에 MARKET이 없으면 skip-source-missing', S(() => planFileCopies({ ...allHas, MARKET: false }, allHas)[1].action), 'skip-source-missing');

  // ── 차단 사유 ──
  eq('#6 정상 입력은 차단 0건', S(() => migrationBlockers(baseIn())), []);
  ok('#6b 원본=대상', S(() => migrationBlockers(baseIn({ dstEmail: 'OLD@x.com' }))).some(b => b.includes('같은 계정')));
  ok('#6c 대상=관리자', S(() => migrationBlockers(baseIn({ dstEmail: 'admin@x.com' }))).some(b => b.includes('관리자 계정')));
  ok('#6d 원본 폴더 없음', S(() => migrationBlockers(baseIn({ srcFolderFound: false }))).some(b => b.includes('원본 계정의 Drive 폴더')));
  ok('#6e 원본 STATE 없음', S(() => migrationBlockers(baseIn({ srcState: null }))).some(b => b.includes('원본 폴더에 portfolio_state.json')));
  ok('#6f 원본 계좌 0개', S(() => migrationBlockers(baseIn({ srcState: { portfolios: [] } }))).some(b => b.includes('계좌가 하나도')));
  ok('#6g 대상 폴더 없음(로그인 전)', S(() => migrationBlockers(baseIn({ dstFolderFound: false }))).some(b => b.includes('로그인한 적이 없습니다')));
  ok('#6h 대상 STATE 없음 — 새 파일을 만들지 않는다는 사유를 밝힌다', S(() => migrationBlockers(baseIn({ dstHasState: false }))).some(b => b.includes('새 파일을 만들지 않습니다')));
  ok('#6i 미선택', S(() => migrationBlockers(baseIn({ srcEmail: '' }))).some(b => b.includes('모두 선택')));

  // ── 미리보기 ──
  const pv = S(() => buildMigrationPreview(baseIn()));
  eq('#7 정상이면 ok', pv.ok, true);
  eq('#7b 기능 차이 2건 포함', pv.features, [{ feature: 'feature1', value: true }, { feature: 'ledgerEnabled', value: false }]);
  eq('#7c 대상 요약·hasData·online', [pv.target.hasData, pv.target.online, pv.target.hasState], [false, false, true]);
  ok('#7d PIN·백업·세션 미이전 고지', pv.warnings.some(w => w.includes('PIN')));
  const pvOnline = S(() => buildMigrationPreview(baseIn({ dstLastSeen: 1_800_000_000_000 - 60_000 })));
  ok('#7e 5분 내 접속이면 online 경고', pvOnline.target.online === true && pvOnline.warnings.some(w => w.includes('접속 중')));
  const pvOld = S(() => buildMigrationPreview(baseIn({ dstLastSeen: 1_800_000_000_000 - 10 * 60_000 })));
  eq('#7f 10분 전 접속은 online 아님', pvOld.target.online, false);
  const pvData = S(() => buildMigrationPreview(baseIn({ dstState: { portfolios: [acct({ portfolio: [{ type: 'stock', quantity: 3 }] })] } })));
  ok('#7g 대상에 데이터가 있으면 hasData + 교체 경고', pvData.target.hasData === true && pvData.warnings.some(w => w.includes('전부 원본 내용으로 교체')));
  const pvSkip = S(() => buildMigrationPreview(baseIn({ dstHas: { ...allHas, STOCK: false } })));
  ok('#7h STOCK 건너뜀 경고에 재조회 안내', pvSkip.warnings.some(w => w.includes('portfolio_stockdata.json') && w.includes('다시 조회')));
  const pvBlocked = S(() => buildMigrationPreview(baseIn({ dstHasState: false, dstHas: { ...allHas, STATE: false } })));
  ok('#7i 차단이 있으면 ok=false이고 STATE 계획은 blocked', pvBlocked.ok === false && pvBlocked.files[0].action === 'blocked');
  const pvErr = S(() => migrationErrorPreview('a@x.com', 'b@x.com', '조회 실패: 401'));
  ok('#7j 오류 미리보기는 같은 모양(ok=false·blockers 1건·files 5건)', pvErr.ok === false && pvErr.blockers.length === 1 && pvErr.files.length === 5 && pvErr.source.email === 'a@x.com');

  // ── 대상 STATE 준비 ──
  const input = srcState();
  const before = JSON.stringify(input);
  const prepared = S(() => prepareMigratedState(input, 1_800_000_000_000));
  eq('#8 입력은 변형하지 않는다', JSON.stringify(input), before);
  ok('#8b 시세 계층·manualSavedAt 제거', !('stockHistoryMap' in prepared) && !('marketIndicators' in prepared) && !('manualSavedAt' in prepared));
  eq('#8c portfolioUpdatedAt·chartPrefsUpdatedAt·updatedAt = now', [prepared.portfolioUpdatedAt, prepared.chartPrefsUpdatedAt, prepared.updatedAt],
    [1_800_000_000_000, 1_800_000_000_000, 1_800_000_000_000]);
  eq('#8d 계좌·앱 레벨 데이터 보존', [prepared.portfolios.length, prepared.calendarMemos['2026-01-02'].length, prepared.watchlistGroups.length, prepared.flowMaps.length, prepared.backtestScenarios.length, prepared.ledgerBooks.length, prepared.chartPrefs.hideAmounts, prepared.adminAccessAllowed, prepared.activePortfolioId],
    [2, 1, 1, 1, 1, 1, true, true, 'a1']);
  eq('#8e startDate 정규화(둘 다 빈 문자열)', [prepared.portfolios[0].startDate, prepared.portfolios[0].portfolioStartDate], ['', '']);
  const prepStart = S(() => prepareMigratedState({ portfolios: [acct({ startDate: '2025-01-01' })] }, 1).portfolios[0]);
  eq('#8f 레거시 startDate → portfolioStartDate 승계', [prepStart.startDate, prepStart.portfolioStartDate], ['2025-01-01', '2025-01-01']);
  eq('#8g null 입력도 던지지 않는다', S(() => prepareMigratedState(null, 7).portfolios), []);

  // ── 백업 파일명 ──
  ok('#9 백업 파일명 형식 migration_backup_<email>_<YYYYMMDD_HHMMSS>.json (소문자)',
    /^migration_backup_a\.b@x\.com_\d{8}_\d{6}\.json$/.test(S(() => migrationBackupName('A.B@x.com', 1_800_000_000_000))));
}

console.log('\n── 파트② 배선 가드 (소스 텍스트) ──');

const mod = read('src/accountMigration.ts');
const dsRaw = read('src/driveStorage.ts');
const dsNC = stripComments(dsRaw);
const app = read('src/App.tsx');
const appNC = stripComments(app);
const page = read('src/components/AdminPage.tsx');
const pageNC = stripComments(page);
const pkg = JSON.parse(read('package.json'));

// 순수 모듈
// ⚠️ 주석을 걷어낸 뒤 잰다 — 모듈 상단 주석이 금지 이유로 'enum' 단어를 그대로 적는다.
const modNC = stripComments(mod);
ok('#G1 accountMigration.ts는 import 0건 · enum 없음 (검증이 직접 import한다)', !/^import /m.test(modNC) && !/\benum\b/.test(modNC));

// driveStorage — 갱신 전용 라이터
const upd = between(dsNC, 'export async function updateDriveFileIfExists', 'export async function loadVersionTimestamp');
ok('#G2 updateDriveFileIfExists 본문이 존재한다', upd.length > 200);
ok('#G2b 루트 가드를 지난다', /_assertNotRootFolder\(folderId, fileName\)/.test(upd));
ok('#G2c 파일이 없으면 false — 절대 만들지 않는다 (POST·parents·생성 엔드포인트 부재)',
  /if \(!fileId\) return false;/.test(upd) && !/method: 'POST'/.test(upd) && !/parents/.test(upd) && !/files\?uploadType/.test(upd));
ok('#G2d 기존 파일은 PATCH로 갱신하고 실패는 status 숫자와 함께 던진다',
  /method: 'PATCH'/.test(upd) && /throw new Error\(`\[Drive\] 파일 덮어쓰기\(\$\{fileName\}\) 실패 \$\{res\.status\}/.test(upd));
ok('#G2e driveFileExists는 findFileId 메타 조회만',
  /export async function driveFileExists\([^)]*\)[^{]*\{\s*return !!\(await findFileId\(token, folderId, fileName\)\);/.test(dsNC));

// App — 토큰·미리보기·적용
const blk = between(appNC, 'const migTokenClientRef', 'const [historyLimit, setHistoryLimit]');
ok('#G3 App 계정 이전 블록이 존재한다', blk.length > 2000);
ok('#G3b 전체 drive 스코프의 별도 토큰 (로그인 토큰 driveTokenRef 미사용)',
  /scope: 'https:\/\/www\.googleapis\.com\/auth\/drive',/.test(blk) && !/driveTokenRef/.test(blk));
const ensure = between(blk, 'const ensureMigrationToken', 'const withMigrationToken');
ok('#G3c 토큰 소유자를 OAuth 신원으로 관리자 검증', /fetchUserEmail\(t\)/.test(ensure) && /ADMIN_EMAIL\.toLowerCase\(\)/.test(ensure) && /throw new Error/.test(ensure));
ok('#G3d 무음 인증 후 select_account 폴백', /requestMigrationToken\(''\)/.test(ensure) && /requestMigrationToken\('select_account'\)/.test(ensure));
const prev = between(blk, 'const handleMigrationPreview', 'const handleMigrationApply');
ok('#G4 미리보기는 buildMigrationPreview·driveFileExists 경유, 실패는 migrationErrorPreview',
  /buildMigrationPreview\(\{/.test(prev) && /migrationErrorPreview\(srcEmail, dstEmail/.test(prev) && /driveFileExists\(token, folderId, f\.name\)/.test(blk));
ok('#G4b 미리보기는 쓰기 0건', !/saveDriveFile\(|updateDriveFileIfExists\(|saveVersionFile\(/.test(prev));
const apply = blk.slice(blk.indexOf('const handleMigrationApply'));
ok('#G5 적용 블록이 존재한다', apply.length > 1500);
ok('#G5b 적용은 그 자리에서 다시 계산한 미리보기가 ok일 때만', /const preview = await handleMigrationPreview\(srcUser, dstUser\);/.test(apply) && /if \(!preview\.ok\) return \{ ok: false/.test(apply));
ok('#G5c saveDriveFile은 관리자 폴더 백업 1곳뿐', count(apply, /saveDriveFile\(/g) === 1 && /saveDriveFile\(token, adminFolder, backupName,/.test(apply) && /getOrCreateAdminFolder\(token\)/.test(apply));
ok('#G5d 백업이 모든 갱신보다 앞', apply.indexOf('getOrCreateAdminFolder(') > 0 && apply.indexOf('getOrCreateAdminFolder(') < apply.indexOf('updateDriveFileIfExists('));
ok('#G5e 대상 폴더 쓰기는 updateDriveFileIfExists만 (version 포함 2곳 이상) · saveVersionFile/saveVersionedBackup 부재',
  count(apply, /updateDriveFileIfExists\(token, dstFolder,/g) >= 2 && !/saveVersionFile\(|saveVersionedBackup\(/.test(apply));
ok('#G5f 원본 폴더에는 쓰지 않는다', !/updateDriveFileIfExists\(token, srcFolder|saveDriveFile\(token, srcFolder/.test(apply));
ok('#G5g STATE는 prepareMigratedState를 거친다', /f\.key === 'STATE' \? prepareMigratedState\(srcState, now\)/.test(apply));
ok('#G5h STATE 실패 시 나머지 중단 (반환 2경로)', count(apply, /if \(f\.key === 'STATE'\) return \{ ok: false/g) >= 2);
ok('#G5i version 파일은 있을 때만 갱신(now)', /updateDriveFileIfExists\(token, dstFolder, DRIVE_FILES\.VERSION, \{ portfolioUpdatedAt: now \}\)/.test(apply));
ok('#G5j 기능 플래그는 setUserFeature로 대상 이메일에', /action: 'setUserFeature', email: dstEmail, feature: d\.feature, value: d\.value/.test(apply));
ok('#G5k 결과 ok는 fail 단계가 없을 때만', /ok: !steps\.some\(s => s\.status === 'fail'\)/.test(apply));
ok('#G6 AdminPage 렌더에 두 핸들러 전달', /onMigrationPreview=\{handleMigrationPreview\} onMigrationApply=\{handleMigrationApply\}/.test(appNC));
ok('#G6b App import 배선', /import \{[^}]*\bupdateDriveFileIfExists\b[^}]*\} from '\.\/driveStorage';/.test(app)
  && /import \{[^}]*\bgetOrCreateAdminFolder\b[^}]*\} from '\.\/driveStorage';/.test(app)
  && /import \{[^}]*\bdriveFileExists\b[^}]*\} from '\.\/driveStorage';/.test(app)
  && /import LoginGate, \{[^}]*\bfetchUserEmail\b[^}]*\} from '\.\/components\/LoginGate';/.test(app)
  && /import \{ MIGRATION_FILES, buildMigrationPreview, migrationErrorPreview, prepareMigratedState, migrationBackupName \} from '\.\/accountMigration';/.test(app));

// AdminPage — 적용 게이트
ok('#G7 props 배선', /onDeleteStudyMaterialFile, onMigrationPreview, onMigrationApply \}: Props\)/.test(pageNC));
ok('#G7b 적용 게이트 3종 (미리보기 ok · 확인 체크 · hasData면 이메일 입력)',
  /const migApplyAllowed = !!migPreview\?\.ok && migConfirm && !migBusy\s*&& \(!migPreview\?\.target\?\.hasData \|\| migTyped\.trim\(\)\.toLowerCase\(\) === String\(migPreview\?\.target\?\.email \|\| ''\)\.toLowerCase\(\)\);/.test(pageNC));
ok('#G7c 이전 실행 버튼이 그 게이트로 잠긴다', /onClick=\{handleMigrationApply\}\s*disabled=\{!migApplyAllowed\}/.test(pageNC));
const pageApply = between(pageNC, 'const handleMigrationApply = async () => {', 'const handleSendNotification');
ok('#G7d 핸들러도 게이트를 재확인하고 적용 뒤 목록을 새로고침한다', /if \(!onMigrationApply \|\| !migApplyAllowed \|\| !migSrcUser \|\| !migDstUser\) return;/.test(pageApply) && /handleRefresh\(\);/.test(pageApply) && /onMigrationApply\(migSrcUser, migDstUser\)/.test(pageApply));
ok('#G7e 원본·대상 모두 비관리자 목록에서만 고르고 대상은 원본을 제외',
  /const nonAdminUsers = users\.filter\(u => u\.email\.toLowerCase\(\) !== ADMIN_EMAIL\.toLowerCase\(\)\);/.test(pageNC)
  && /nonAdminUsers\.filter\(u => u\.email !== migSrc\)\.map/.test(pageNC));
ok('#G7f 카드가 두 핸들러가 있을 때만 렌더되고 제목은 계정 이전', /\{onMigrationPreview && onMigrationApply && \(/.test(pageNC) && /<h2 className="text-white font-semibold mb-1">계정 이전<\/h2>/.test(pageNC));
ok('#G7g 결과에 백업 파일명을 보여 준다', /Index_Data_Admin\/\{migResult\.backupName\}/.test(pageNC));
ok('#G7h 선택이 바뀌면 미리보기·확인 상태를 초기화', count(pageNC, /resetMigration\(\); \}\}/g) >= 2);

// 게이트 등록
ok('#G8 package.json verify:migrate', pkg.scripts['verify:migrate'] === 'node scripts/verify-migrate.mjs');

console.log(`\n  총 ${pass + fail}건 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
