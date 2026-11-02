#!/usr/bin/env node
// 인트로 영상 검증 — 로그인·PIN 뒤 계좌 로딩 중 재생하는 영상(IntroVideoOverlay)과 진행 막대·키 처리·App 배선.
//   src/introVideo.ts 를 **직접 import**한다(미러 금지). 런타임이 .ts를 못 읽으면 단위 검사만 건너뛴다.
//   사용자 확정(2026-11-02): 영상은 앱 저장소(public/intro)에 둔다 · 로딩이 먼저 끝나도 영상은 끝까지(막대만 '준비 완료') ·
//   Enter/Esc = 영상 닫기(로딩이 남았으면 로딩 팝업) · 좌측 상단 막대 클릭 = 영상 정지 + 대시보드 · 우측 상단 작은 글씨 = 로딩 현황.
import { readFileSync, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let I = null;
try { I = await import(pathToFileURL(join(ROOT, 'src/introVideo.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/introVideo.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

const introSrc = read('src/introVideo.ts');
const srcMatch = introSrc.match(/INTRO_VIDEO_SRC\s*=\s*'([^']+)'/);
const videoUrl = srcMatch ? srcMatch[1] : null;

if (I) {
  const { bootProgressRatio: ratio, ratchetProgress: ratchet, introStatusText: status, introKeyAction: key, INTRO_KEY_GRACE_MS: GRACE } = I;

  console.log('\n── 파트① 진행 막대 비율 ──');
  eq('#P1 계좌 로드 시작 = 0', ratio('loading', { done: 0, total: 0 }, 0), 0);
  ok('#P2 계좌 로드는 시간이 지나도 25%를 넘지 않는다', ratio('loading', { done: 0, total: 0 }, 600) <= 0.25 && ratio('loading', { done: 0, total: 0 }, 600) > 0.24);
  ok('#P3 계좌 로드는 시간에 따라 증가', ratio('loading', {}, 1) < ratio('loading', {}, 3) && ratio('loading', {}, 3) < ratio('loading', {}, 9));
  eq('#P4 동기화 시작(total 미정) = 30%', [ratio('hydrated', { done: 0, total: 0 }, 5), ratio('refreshing', { done: 0, total: 0 }, 5), ratio('hydrate-failed', { done: 0, total: 0 }, 5)], [0.3, 0.3, 0.3]);
  eq('#P5 동기화 절반 = 62.5%', ratio('refreshing', { done: 5, total: 10 }, 5), 0.625);
  eq('#P6 동기화 전부(정착 전) = 95%', ratio('hydrated', { done: 10, total: 10 }, 5), 0.95);
  eq('#P7 done > total 이어도 95%에서 멈춘다', ratio('hydrated', { done: 14, total: 10 }, 5), 0.95);
  eq('#P8 정착 = 100%', ratio('settled', { done: 3, total: 10 }, 5), 1);
  ok('#P9 계좌 로드 상한(25%) < 동기화 시작(30%) — 단계가 넘어갈 때 막대가 뒤로 가지 않는다', ratio('loading', {}, 1e6) < ratio('hydrated', { done: 0, total: 0 }, 0));
  eq('#P10 잘못된 값은 0으로', [ratio('loading', {}, NaN), ratio('loading', {}, -5), ratio('refreshing', null, 0)], [0, 0, 0.3]);

  console.log('\n── 파트② 막대는 뒤로 가지 않는다(ratchet) ──');
  eq('#R1 큰 값 유지', ratchet(0.6, 0.3), 0.6);
  eq('#R2 증가는 따라간다', ratchet(0.3, 0.6), 0.6);
  eq('#R3 1을 넘지 않는다', ratchet(0.9, 1.4), 1);
  eq('#R4 NaN·음수 → 0', [ratchet(NaN, NaN), ratchet(0, -1)], [0, 0]);

  console.log('\n── 파트③ 우측 상단 로딩 현황 글씨 ──');
  eq('#S1 계좌 로드', status('loading', { done: 0, total: 0 }, false), '계좌 불러오는 중');
  eq('#S2 동기화 개수', status('refreshing', { done: 3, total: 12 }, false), '과거 종가 동기화 3/12');
  eq('#S3 total 미정이면 개수를 감춘다("0/0"은 멈춘 것처럼 보인다)', status('hydrated', { done: 0, total: 0 }, false), '시세 확인 중');
  eq('#S4 캐시 실패 단계', status('hydrate-failed', { done: 1, total: 4 }, false), '종가 캐시 없이 동기화 1/4');
  eq('#S5 done > total 은 total로 자른다', status('refreshing', { done: 9, total: 4 }, false), '과거 종가 동기화 4/4');
  eq('#S6 정착', [status('settled', { done: 4, total: 4 }, false), status('settled', { done: 2, total: 4 }, true)], ['준비 완료', '준비 완료 · 일부 종가 미수집']);

  console.log('\n── 파트④ Enter·Esc 건너뛰기 ──');
  const after = GRACE + 1;
  eq('#K1 Enter·Esc = skip', [key({ key: 'Enter' }, after), key({ key: 'Escape' }, after)], ['skip', 'skip']);
  eq('#K2 다른 키는 무시', [key({ key: ' ' }, after), key({ key: 'a' }, after), key({ key: 'Tab' }, after)], [null, null, null]);
  eq('#K3 자동 반복(PIN Enter를 누른 채) 무시', key({ key: 'Enter', repeat: true }, after), null);
  eq('#K4 막 뜬 직후 입력 무시', key({ key: 'Enter' }, GRACE - 1), null);
  eq('#K5 한글 조합 중 Enter 무시', key({ key: 'Enter', isComposing: true }, after), null);
  eq('#K6 이벤트 없음·시간 NaN', [key(null, after), key({ key: 'Enter' }, NaN)], [null, null]);
}

console.log('\n── 파트⑤ 영상 파일 ──');
ok('#F1 INTRO_VIDEO_SRC는 사이트 루트 경로(/intro/…mp4)', !!videoUrl && /^\/intro\/[\w.-]+\.mp4$/.test(videoUrl));
const videoPath = videoUrl ? join(ROOT, 'public', videoUrl.slice(1)) : null;
const hasVideo = !!videoPath && existsSync(videoPath);
ok(`#F2 public${videoUrl || '/?'} 파일이 있다`, hasVideo);
if (hasVideo) {
  const size = statSync(videoPath).size;
  ok(`#F3 크기 1MB~20MB (${(size / 1048576).toFixed(1)}MB)`, size > 1048576 && size < 20 * 1048576);
  // moov가 mdat보다 앞(faststart) — 뒤에 있으면 브라우저가 파일을 다 받기 전엔 재생을 시작하지 못한다(로딩 대기용이라 치명적).
  const fd = openSync(videoPath, 'r');
  const atoms = [];
  let off = 0;
  const head = Buffer.alloc(16);
  while (off < size && atoms.length < 12) {
    if (readSync(fd, head, 0, 16, off) < 8) break;
    let len = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    if (len === 1) len = Number(head.readBigUInt64BE(8));
    if (len < 8) break;
    atoms.push(type);
    off += len;
  }
  closeSync(fd);
  ok(`#F4 mp4 머리 = ftyp (${atoms.join(',')})`, atoms[0] === 'ftyp');
  ok('#F5 moov가 mdat보다 앞(faststart — 받는 즉시 재생)', atoms.includes('moov') && atoms.includes('mdat') && atoms.indexOf('moov') < atoms.indexOf('mdat'));
}

console.log('\n── 파트⑥ 화면(IntroVideoOverlay) ──');
const comp = stripComments(read('src/components/IntroVideoOverlay.tsx'));
ok('#C1 introVideo.ts에서 막대·글씨·키 함수를 import', /import\s*\{[^}]*bootProgressRatio[^}]*\}\s*from\s*'\.\.\/introVideo'/.test(comp)
  && /import\s*\{[^}]*introKeyAction[^}]*\}\s*from\s*'\.\.\/introVideo'/.test(comp)
  && /import\s*\{[^}]*introStatusText[^}]*\}\s*from\s*'\.\.\/introVideo'/.test(comp)
  && /import\s*\{[^}]*ratchetProgress[^}]*\}\s*from\s*'\.\.\/introVideo'/.test(comp));
ok('#C2 Enter·Esc는 캡처 단계 window keydown — 아래 앱 단축키로 새지 않게', /addEventListener\('keydown',\s*onKey,\s*true\)/.test(comp) && /removeEventListener\('keydown',\s*onKey,\s*true\)/.test(comp) && /stopPropagation\(\)/.test(comp));
ok('#C3 영상 끝·오류 → 닫기(검은 화면 방치 금지)', /onEnded=\{\(\)\s*=>\s*finish\('close'\)\}/.test(comp) && /onError=\{\(\)\s*=>\s*finish\('close'\)\}/.test(comp));
ok('#C4 시작 제한 시간 안에 재생이 안 되면 닫기', /INTRO_START_TIMEOUT_MS/.test(comp) && /startedRef\.current\s*=\s*true/.test(comp));
ok('#C5 자동 재생이 막히면 소리 끄고 다시 시도', /v\.muted\s*=\s*true/.test(comp) && /v\.play\(\)\.catch/.test(comp));
ok('#C6 막대 클릭 = finish(\'dashboard\') → onSkipToDashboard', /onClick=\{\(\)\s*=>\s*finish\('dashboard'\)\}/.test(comp) && /onSkipToDashboard/.test(comp));
ok('#C7 막대는 좌측 상단, 로딩 현황 글씨는 우측 상단', /top:\s*16,\s*left:\s*16/.test(comp) && /top:\s*16,\s*right:\s*16/.test(comp));
ok('#C8 모바일 인라인 재생(playsInline)', /\bplaysInline\b/.test(comp));
ok('#C9 벨 알림·브라우저 저장소 없음(알림 최소화·다중 계정 정책)', !/\bnotify\s*\(/.test(comp) && !/localStorage|sessionStorage/.test(comp));
ok('#C10 한 번만 닫힌다(closedRef)', /if\s*\(closedRef\.current\)\s*return;/.test(comp));

console.log('\n── 파트⑦ App 배선 ──');
const app = stripComments(read('src/App.tsx'));
ok('#A1 IntroVideoOverlay import + 사용', /import IntroVideoOverlay from '\.\/components\/IntroVideoOverlay'/.test(app) && /<IntroVideoOverlay[\s>]/.test(app));
ok('#A2 영상 재생 중엔 가운데 로딩 팝업 숨김', /<LoadingOverlay\s+visible=\{isInitialLoading && !introPlaying\}/.test(app));
const startDef = app.match(/const startIntroOnce = \(\) => \{([\s\S]*?)\n  \};/);
ok('#A3 startIntroOnce = 페이지당 한 번 + 관리자 접속 제외', !!startDef && /introShownRef\.current \|\| adminViewingAsRef\.current/.test(startDef[1]) && /introShownRef\.current = true/.test(startDef[1]));
const startCalls = (app.match(/startIntroOnce\(\);/g) || []).length;
ok(`#A4 isInitialLoading을 켜는 두 곳(일반 로그인·부팅 effect)에서 함께 켠다 (${startCalls}곳)`, startCalls === 2
  && /setIsInitialLoading\(true\);\s*startIntroOnce\(\);\s*setDriveLoadReady\(true\);/.test(app)
  && /setIsInitialLoading\(true\);\s*startIntroOnce\(\);\s*const token = authUser\.token;/.test(app));
const imp = app.match(/if \(adminViewUserCtx && email\.toLowerCase\(\)[\s\S]*?return;\s*\}/);
ok('#A5 관리자 접속(impersonation) 진입 블록은 영상을 켜지 않는다', !!imp && !/startIntroOnce|setIntroPlaying\(true\)/.test(imp[0]) && /adminViewingAsRef\.current = email/.test(imp[0]));
ok('#A6 영상 닫기(Enter·Esc·끝) = 영상만 닫는다(로딩 남았으면 팝업이 이어받음)', /onClose=\{\(\) => setIntroPlaying\(false\)\}/.test(app));
const toDash = app.match(/const handleIntroToDashboard = \(\) => \{([\s\S]*?)\n  \};/);
ok('#A7 막대 클릭: 계좌 로드 전이면 빈 대시보드 대신 로드 직후 닫기', !!toDash && /setIntroPlaying\(false\)/.test(toDash[1]) && /histPhase === 'loading'\) introToDashRef\.current = true/.test(toDash[1]) && /else dismissInitialLoading\(\)/.test(toDash[1]));
ok('#A8 로드 직후 닫기 effect', /if \(!introToDashRef\.current \|\| histPhase === 'loading'\) return;\s*introToDashRef\.current = false;\s*dismissInitialLoading\(\);/.test(app));
ok('#A9 해제는 한 함수(dismissInitialLoading) — 정착 대기 플래그도 함께 내린다', /const dismissInitialLoading = \(\) => \{ awaitingSettleRef\.current = false; setIsInitialLoading\(false\); \};/.test(app) && /onDismiss=\{dismissInitialLoading\}/.test(app));
ok('#A10 영상은 로딩 정착으로 닫지 않는다(사용자 확정: 끝까지 재생)', !/setIntroPlaying\(false\)[^\n]*settled|settled[^\n]*setIntroPlaying\(false\)/.test(app));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
