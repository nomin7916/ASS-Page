#!/usr/bin/env node
// 부팅 = STOCK-first · 영속 마커 증분 조회 · 이력 패스 단일 커밋 · 정착(settled) 게이트 · 하루 1회 종료 백업 검증
//
// 이 기능의 위험은 산식이 아니라 **순서와 횟수**다 — 표시 계층(buildCloseEvalSeries 등)은 한 줄도 바꾸지 않고
// 그 입력(stockHistoryMap)이 언제·몇 번 커밋되는가만 바꾼다. 그래서 검증도 두 파트로 나뉜다:
//
//   파트① 직접 import (미러 금지)
//     src/utils.ts        — '중간값 회귀 기록': 부분 맵(B만 도착)에서 buildCloseEvalSeries가 편입 이후 날짜에
//                           B-only carry-forward 값을 내는 사실을 못 박는다(= 화면에 보이면 안 되는 값의 문서화).
//     src/stockHistorySync.ts (Phase 2~3) — planKorHistoryFetch·normalizeStockMeta·mergeCodeHistory·applyStagedMerges.
//   파트② 소스 텍스트 가드 (G1~)
//     부팅 순서·중복 제거·게이트는 미러로 표현할 수 없어 소스를 직접 읽어 **사용부**를 단언한다
//     (verify-twr.mjs #30d · verify-transfer.mjs 선례). 부재 가드는 구간을 잘라 재고(메모리 규약),
//     ⚠️ 실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
};
// 주석 제거 — 이 저장소는 금지 근거를 바로 그 자리 주석에 적으므로 원문으로 재면 부재 가드가 영구히 실패한다.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// 구간 자르기 — 양쪽 마커가 있고 순서가 맞을 때만 본문을 돌려준다(없으면 빈 문자열 → 가드가 실패로 드러난다).
const slice = (src, startMarker, endMarker, fromIndex = 0) => {
  const s = src.indexOf(startMarker, fromIndex);
  if (s < 0) return '';
  const e = src.indexOf(endMarker, s + startMarker.length);
  if (e < 0) return '';
  return src.slice(s, e);
};
const count = (src, re) => (src.match(re) || []).length;

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 파트① 순수 함수 (src/utils.ts 직접 import) ──');
let U = null;
try {
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
} catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①(utils)을 건너뜁니다 (${e.code || e.message}).`);
  else { fail++; console.log(`  ✗ src/utils.ts 를 import하지 못했습니다: ${e.message}`); }
}

if (U) {
  const { buildCloseEvalSeries } = U;
  // 픽스처: B는 baseline부터 보유, A는 2026-06-01 편입. 날짜는 평일만.
  const DATES = ['2026-05-15', '2026-05-18', '2026-05-29', '2026-06-01', '2026-06-02', '2026-06-03'];
  const P = {
    id: 'P', accountType: 'portfolio', baselineDate: '2026-05-15', preBaselineVerified: false, manualPriceOverrides: {},
    holdingSnapshots: [
      { date: '2026-05-15', kind: 'baseline', items: [{ type: 'stock', code: 'B', quantity: 10 }] },
      { date: '2026-06-01', kind: 'auto', items: [{ type: 'stock', code: 'B', quantity: 10 }, { type: 'stock', code: 'A', quantity: 5 }] },
    ],
  };
  const B = { '2026-05-15': 100, '2026-05-18': 101, '2026-05-29': 102, '2026-06-01': 103, '2026-06-02': 104, '2026-06-03': 105 };
  const A = { '2026-05-15': 50, '2026-05-18': 51, '2026-05-29': 52, '2026-06-01': 53, '2026-06-02': 54, '2026-06-03': 55 };
  const EDK = '2026-06-10';
  const full = buildCloseEvalSeries(P, DATES, 'portfolio', { A, B }, {}, EDK);
  const partial = buildCloseEvalSeries(P, DATES, 'portfolio', { B }, {}, EDK);       // A 미도착(부팅 중간 상태)
  const empty = buildCloseEvalSeries(P, DATES, 'portfolio', {}, {}, EDK);            // 빈 맵(옛 부팅 첫 렌더)

  // #1 최종값 — 편입 이후는 B+A
  eq('#1 전 종목 도착 시 편입 이후 날짜 = 10×B + 5×A', [full.get('2026-06-01'), full.get('2026-06-03')], [10 * 103 + 5 * 53, 10 * 105 + 5 * 55]);
  // #1b 중간값 회귀 기록 — B만 도착하면 편입 이후 날짜가 B-only carry-forward(마지막 allExact = 05-29)로 남는다.
  //     이 값이 화면에 보이는 것이 곧 '부팅 중 과거 평가액 흔들림'이다(STOCK-first + 단일 커밋이 없애는 상태).
  eq('#1b 부분 맵(B만)에서 편입 이후 날짜는 B-only carry-forward(=10×102) — 최종값과 다르다',
    [partial.get('2026-06-01'), partial.get('2026-06-03'), partial.get('2026-06-03') !== full.get('2026-06-03')],
    [10 * 102, 10 * 102, true]);
  // #1c 편입 전 날짜는 부분 맵에서도 최종값과 같다(= 흔들리는 범위는 편입 경계 이후뿐)
  eq('#1c 편입 전(05-29) 값은 부분 맵과 최종값이 같다', partial.get('2026-05-29'), full.get('2026-05-29'));
  // #1d 빈 맵(옛 첫 렌더)은 어느 날짜도 미설정 → 호출부 저장값 폴백(= 부팅 직후 S0 상태)
  eq('#1d 빈 맵에서는 어떤 날짜도 설정되지 않는다(저장값 폴백)', empty.size, 0);
  // #1e 오늘(edk)은 항상 미설정
  eq('#1e 오늘(effectiveDateKey)은 미설정', full.get(EDK), undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 파트② 소스 텍스트 가드 — Phase 1 (순서·중복 제거·게이트) ──');
{
  const dsRaw = read('src/hooks/useDriveSync.ts');
  const ds = stripComments(dsRaw);
  const appRaw = read('src/App.tsx');
  const app = stripComments(appRaw);
  const sdRaw = read('src/hooks/useStockData.ts');
  const sd = stripComments(sdRaw);
  const acRaw = read('src/hooks/useAutoConfirmHistory.ts');
  const ac = stripComments(acRaw);

  // ── G1 loadFromDrive: STATE+MARKET+STOCK allSettled · STOCK 적용이 STATE 적용보다 앞 · 사이에 await 없음 ──
  const lfd = slice(ds, 'const loadFromDrive = async', 'const saveAllToDrive = async');
  ok('G1 loadFromDrive가 Promise.allSettled로 STATE·MARKET·STOCK을 함께 로드한다',
    lfd.length > 500 && /Promise\.allSettled\(\[/.test(lfd) && /DRIVE_FILES\.STOCK/.test(lfd) && /DRIVE_FILES\.STATE/.test(lfd));
  // ⚠️ '첫 applyStockData( 출현'으로 재면 지연 도착 경로(.then 안)의 호출이 대신 통과시킨다(변이로 실증한 죽은 단언)
  //    → fulfilled 분기 **블록 안**의 동기 호출을 본다.
  const FULFILLED = "if (stockRes.status === 'fulfilled' && stockRes.value !== STOCK_TIMED_OUT) {";
  const iStock = lfd.indexOf(FULFILLED);
  const fulfilledBlock = slice(lfd, FULFILLED, '} else if (stockRes.status');
  const iState = lfd.indexOf('applyStateData(');
  ok('G1b STOCK fulfilled 분기 안에서 applyStockData(driveMap)를 동기 호출하고, 그 분기가 applyStateData보다 앞이다(STOCK-first)',
    iStock > 0 && iState > 0 && iStock < iState && fulfilledBlock.length > 50 && /applyStockData\(driveMap\);/.test(fulfilledBlock));
  ok('G1c fulfilled 분기 시작부터 applyStateData까지 await가 없다(같은 동기 블록 → 한 렌더로 배치)',
    iStock > 0 && iState > iStock && !/\bawait\b/.test(lfd.slice(iStock, iState)));
  ok('G1d STOCK 대기 상한(STOCK_HYDRATE_WAIT_MS)이 Promise.race 사용부에 있고 상수가 선언돼 있다',
    /Promise\.race\(\[stockLoad, [^\]]*STOCK_HYDRATE_WAIT_MS/.test(lfd) && /export const STOCK_HYDRATE_WAIT_MS = 10000;/.test(ds));
  ok('G1e STOCK 실패는 stockLoadFailedRef로 강등되고(STATE 적용을 막지 않는다) STATE 실패는 throw로 종전 catch 규약을 탄다',
    /stockRes\.status === 'rejected'[\s\S]{0,80}stockLoadFailedRef\.current = true/.test(lfd)
    && /if \(stateRes\.status === 'rejected'\) throw stateRes\.reason;/.test(lfd));
  ok('G1f 하이드레이션 성공 시 stockHydratedRef=true + lastSavedStockMapRef 시드(방금 받은 맵은 dirty가 아니다)',
    /stockHydratedRef\.current = true;\s*lastSavedStockMapRef\.current = hasMap \? driveMap : null;/.test(lfd));
  ok('G1g stateAppliedRef는 STATE 없음(신규) 분기와 applyStateData 직후 **두 곳**에서 선다',
    count(lfd, /stateAppliedRef\.current = true;/g) === 2
    && /applyStateData\(stateToApply, null, marketData\);\s*stateAppliedRef\.current = true;/.test(lfd));

  // ── G2 applyStockData: refresh 예약 없음 · 빈 메모리면 같은 참조 채택 ──
  const asd = slice(app, 'const applyStockData = (driveStockMap) => {', 'applyStockDataRef.current = applyStockData;');
  ok('G2 applyStockData 본문에 setTimeout·refreshPricesRef가 없다(부팅 3번째 refresh 부활 차단)',
    asd.length > 100 && !/setTimeout/.test(asd) && !/refreshPricesRef/.test(asd));
  ok('G2b applyStockData는 메모리가 비어 있으면 Drive 맵을 같은 참조로 채택한다(참조 비교 dirty와 짝)',
    /if \(Object\.keys\(prev\)\.length === 0\) return driveStockMap;/.test(asd));

  // ── G3 로드 effect(bgTimer): 강제 복귀 없음 · STOCK 별도 로드 없음 · 오버레이 해제가 첫 갱신보다 앞 ──
  const bg = slice(app, 'const bgTimer = setTimeout(async () => {', '}, 400);');
  ok('G3 로드 effect에 setShowIntegratedDashboard(true)(강제 복귀)가 없다', bg.length > 1000 && !/setShowIntegratedDashboard\(true\)/.test(bg));
  ok('G3b 로드 effect에 loadStockFromDrive( 호출이 없다(STOCK은 loadFromDrive가 포함)', bg.length > 1000 && !/loadStockFromDrive\(/.test(bg));
  const iOverlay = bg.indexOf('setIsInitialLoading(false)');
  const iBootSeq = bg.indexOf('setBootRefreshSeq(');
  const iRefresh = bg.indexOf('refreshPrices(');
  ok('G3c setIsInitialLoading(false)가 첫 갱신 트리거(setBootRefreshSeq)와 refreshPrices( 폴백보다 앞이고 한 번뿐이다',
    iOverlay > 0 && iBootSeq > iOverlay && iRefresh > iOverlay && count(bg, /setIsInitialLoading\(false\)/g) === 1);
  ok('G3d 첫 갱신 완료를 기다린 뒤 initSession·isInitialLoad 해제가 온다(순서 유지)',
    /await \(started \? started\.run : refreshPrices\(\)\);/.test(bg)
    && bg.indexOf('await (started') < bg.indexOf('initSession();') && bg.indexOf('initSession();') < bg.indexOf('isInitialLoad.current = false'));
  ok('G3e 부수 로드(세금·알림로그·설정·공지)는 트리거 뒤·완료 대기 앞에서 종전 순서대로 await된다(시작만 병행)',
    iBootSeq > 0 && bg.indexOf('DRIVE_FILES.DIVIDEND_TAX') > iBootSeq && bg.indexOf('action=getNotifications') < bg.indexOf('await (started'));
  // 첫 갱신 effect는 ref 동기화 effect(portfoliosRef)보다 **뒤**에 선언돼야 한다 — 선언 순서 = 실행 순서.
  const iRefSync = app.indexOf('useEffect(() => { portfoliosRef.current = portfolios; }, [portfolios]);');
  const iBootEff = app.indexOf('}, [bootRefreshSeq]);');
  ok('G3f 부팅 첫 갱신 effect가 portfoliosRef 동기화 effect보다 뒤에 선언돼 있다(신선한 ref 보장)',
    iRefSync > 0 && iBootEff > iRefSync && /resolve\?\.\(\{ run \}\);/.test(app));

  // ── G4 refreshPrices 재진입 가드 · 탭 전환 effect 부팅 게이트 ──
  const rp = slice(sd, 'const refreshPrices = (options', 'const refreshPricesRef = useRef(refreshPrices);');
  ok('G4 refreshPrices 진입부가 refreshInFlightRef로 재진입을 막고 같은 Promise를 돌려준다',
    rp.length > 100 && /if \(refreshInFlightRef\.current\) \{/.test(rp) && /return refreshInFlightRef\.current;/.test(rp)
    && /refreshInFlightRef\.current = run;/.test(rp));
  ok('G4a force는 pendingForceRef로 1건만 큐잉되고 완료 후 1회 재실행된다',
    /if \(force\) pendingForceRef\.current = true;/.test(rp) && /pendingForceRef\.current = false; refreshPrices\(\{ force: true \}\);/.test(rp));
  const tab = slice(app, 'autoFundHistoryRef.current = null;', '}, [activePortfolioId]);');
  ok('G4c 계좌 탭 전환 effect는 부팅 중(isInitialLoad) refresh를 쏘지 않는다',
    tab.length > 50 && tab.indexOf('if (isInitialLoad.current) return;') > 0
    && tab.indexOf('if (isInitialLoad.current) return;') < tab.indexOf('refreshPrices();'));

  // ── G4b 임시 자동확정 게이트(firstHistoryPassDone) — Phase 3에서 histPhase 게이트로 교체 ──
  const acEff = slice(ac, 'useEffect(() => {', '}, [stockHistoryMap');
  ok('G4b useAutoConfirmHistory effect 첫 줄이 firstHistoryPassDone 게이트다',
    /^useEffect\(\(\) => \{\s*if \(!firstHistoryPassDone\) return;/.test(acEff) && /firstHistoryPassDone\]\);/.test(ac));
  ok('G4d useStockData: KIS/US 이력 Promise.all에 .finally(setFirstHistoryPassDone) + 미진입 패스는 finally에서 완료 처리',
    /\]\)\.then\(\(\) => \{[\s\S]{0,300}\}\)\.finally\(\(\) => setFirstHistoryPassDone\(true\)\);/.test(sd)
    && /if \(!historyPassStarted\) setFirstHistoryPassDone\(true\);/.test(sd) && /historyPassStarted = true;/.test(sd));
  const acCall = slice(app, 'useAutoConfirmHistory({', '});');
  ok('G4e App이 useAutoConfirmHistory에 firstHistoryPassDone을 넘기고, 그 호출은 useStockData 뒤·useHistoryBackfill 뒤다',
    /firstHistoryPassDone,/.test(acCall)
    && app.indexOf('useAutoConfirmHistory({') > app.indexOf('} = useStockData({')
    && app.indexOf('useAutoConfirmHistory({') > app.indexOf('useHistoryBackfill({'));

  // ── G5 STOCK 저장: hydrated 가드가 앞 + 참조 비교 dirty + 성공 후 대입 ──
  ok('G5 STOCK 분기 한 식에서 stockHydratedRef.current && 가 lastSavedStockMapRef 비교보다 앞이고 성공 시 대입한다',
    /Object\.keys\(shm \|\| \{\}\)\.length > 0 && stockHydratedRef\.current && shm !== lastSavedStockMapRef\.current\s*\? saveDriveFile\(token, folderId, DRIVE_FILES\.STOCK, \{ stockHistoryMap: shm \}\)\.then\(\(\) => \{ lastSavedStockMapRef\.current = shm; \}\)/.test(ds));

  // ── G5b 종료 저장 3경로의 게이트 = stateAppliedRef (isInitialLoad 부재) · 800ms 자동저장은 isInitialLoad 유지 ──
  const vis = slice(ds, 'const handleVisibilityChange = () => {', 'const handlePageHide = () => {');
  const ph = slice(ds, 'const handlePageHide = () => {', "document.addEventListener('visibilitychange'");
  const inact = slice(ds, 'const handleInactivityLogout = async () => {', 'const handleAutoBackupWithMemo');
  ok('G5b 탭 숨김 저장 게이트가 stateAppliedRef.current이고 isInitialLoad.current가 없다',
    vis.length > 50 && /stateAppliedRef\.current/.test(vis) && !/isInitialLoad\.current/.test(vis));
  ok('G5c pagehide 저장 게이트가 !stateAppliedRef.current이고 isInitialLoad.current가 없다',
    ph.length > 50 && /!stateAppliedRef\.current\) return;/.test(ph) && !/isInitialLoad\.current/.test(ph));
  ok('G5d 비활동 로그아웃 저장 게이트가 stateAppliedRef.current이고 isInitialLoad.current가 없다',
    inact.length > 50 && /stateAppliedRef\.current\) \{/.test(inact) && !/isInitialLoad\.current/.test(inact));
  const autosave = slice(app, 'saveStateRef.current = state;', 'driveSaveTimerRef.current = setTimeout(');
  ok('G5e (오탐 대조) 800ms 자동저장 effect의 isInitialLoad 게이트는 그대로 남아 있다',
    autosave.length > 50 && /!isInitialLoad\.current && driveTokenRef\.current/.test(autosave));
  ok('G5f 폴링(checkAndSyncFromDrive)·자동 백업(handleAutoBackupWithMemo)의 isInitialLoad 게이트는 그대로다',
    /const checkAndSyncFromDrive = async \(\) => \{\s*if \(!driveTokenRef\.current \|\| isInitialLoad\.current\) return;/.test(ds)
    && /if \(!token \|\| !folderId \|\| isInitialLoad\.current\) return;/.test(ds));

  // ── G12 표시 계층 무수정 보조 증거: buildCloseEvalSeries 시그니처 문자 일치 ──
  const utils = read('src/utils.ts');
  const SIG = `export const buildCloseEvalSeries = (
  p: any,
  dates: string[],
  accountType: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  effectiveDateKey: string,
  fxRate = 1,`;
  ok('G12 utils.buildCloseEvalSeries 시그니처가 문자 그대로 유지된다(표시 계층 무수정 보조 증거)', utils.includes(SIG));
  ok('G12b utils.evalSeriesDates 시그니처가 유지된다',
    utils.includes('export const evalSeriesDates = (p: any, histDates: string[], effectiveDateKey: string): string[] => {'));

  // ── G13 관심종목·백테스트·환율 계층은 stockHistoryMap 스테이징/병합 경로를 쓰지 않는다 ──
  for (const rel of ['src/components/WatchlistPopup.tsx', 'src/components/BacktestPage.tsx', 'src/fxRates.ts', 'src/watchlistQuote.ts', 'src/backtestFetch.ts']) {
    const t = stripComments(read(rel));
    ok(`G13 ${rel}: applyStagedMerges·historyStagingRef·setStockHistoryMap 부재`,
      !/applyStagedMerges|historyStagingRef|setStockHistoryMap\(/.test(t));
  }

  // ── G14 외부 의존성 무추가 ──
  const pkg = JSON.parse(read('package.json'));
  eq('G14 package.json dependencies는 4개 그대로다(react·react-dom·recharts·lucide-react)',
    Object.keys(pkg.dependencies).sort(), ['lucide-react', 'react', 'react-dom', 'recharts']);
  ok('G14b package.json에 verify:boot 게이트가 등록돼 있다', pkg.scripts && pkg.scripts['verify:boot'] === 'node scripts/verify-boot.mjs');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅' : '❌'} verify:boot — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
