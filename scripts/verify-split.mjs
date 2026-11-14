#!/usr/bin/env node
// 앱 본체·별도 창 8종 나누어 받기(성능 개선 1-3) + 앱 안 큰 화면 5개 열 때 받기·미리 받기(1-4) + 늘 떠 있는 창 3개 처음 열 때 받기(1-5)를 지키는 검사(2026-11-15).  실행: npm run verify:split
//
// 지켜야 할 것:
//   ① main.tsx는 App·창 8종을 lazyScreen(동적 import)으로만 부른다 — 정적 import가 하나라도 생기면 모든 창이 앱 전체를 다시 받는다.
//   ② 조각 받기 실패는 lazyScreen이 새로고침 안내로 바꾼다(자동 새로고침 금지 — 입력 중 내용 유실).
//   ③ 로딩 중 어두운 바탕은 html.booting + BootDone(첫 커밋에서 지움)으로만 — 실측한 두 함정 금지:
//      body:has(#root:empty) = 계좌 전환 약 0.5초 느려짐(문서 전체 스타일 재계산) · #root:empty 덮개 = 백테스트 창(body 포털)에서 덮개가 남음.
//   ⑤ App의 큰 화면 5개(백테스트·가계부·관리자·관리자 포털·분배금 과표)는 lazyScreen + 쓰는 자리마다 Suspense(빠지면 받는 동안 앱 전체가 사라진다)
//      + 로딩이 끝난 뒤 미리 받기(권한 있는 화면만).
//   ⑥ 늘 떠 있는 창 3개(계산기·메모 달력·자금 흐름도)는 KeepAfterOpen(처음 연 뒤로는 계속 마운트) + Suspense(WindowLoading).
//      관심종목은 나누지 않는다(닫혀 있어도 종목 차트 창의 물음에 답한다). 받아 둔 화면은 lazyScreen이 Suspense 없이 바로 그린다.
//   ④ vite.config.ts의 app-chunk-preload는 `…Window=1` 주소를 건너뛴다 — 창 파라미터가 전부 그 꼴이어야 창이 앱 조각을 미리 받지 않는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`); }
};
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const SCREENS = [['App', './App.tsx'], ['CalendarWindow', './components/CalendarWindow.tsx'], ['FlowWindow', './components/FlowWindow.tsx'],
  ['BacktestWindow', './components/BacktestWindow.tsx'], ['CardWindow', './components/CardWindow.tsx'], ['LedgerWindow', './components/LedgerWindow.tsx'],
  ['RateWindow', './components/RateWindow.tsx'], ['WatchlistWindow', './components/WatchlistWindow.tsx'], ['StockChartWindow', './components/StockChartWindow.tsx']];

console.log('\n── 파트① main.tsx — 화면 9개는 동적 import만 ──');
const main = stripComments(read('src/main.tsx'));
for (const [name, path] of SCREENS) {
  const esc = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  ok(`#M1 ${name} = lazyScreen(() => import('${path}'))`, new RegExp(`const ${name} = lazyScreen\\(\\(\\) => import\\('${esc}'\\)\\)`).test(main));
}
const staticImports = [...main.matchAll(/^import\s+[^'"\n]*from\s+'([^']+)'/gm)].map(m => m[1]);
const bad = staticImports.filter(p => /^\.\/App(\.tsx)?$/.test(p) || /^\.\/components\/\w+Window(\.tsx)?$/.test(p));
ok('#M2 App·창을 정적 import하지 않는다(하나라도 있으면 모든 창이 앱 전체를 받는다)', bad.length === 0, bad.join(', '));
ok('#M3 화면 분기가 Suspense 안이고 BootDone이 같은 경계 안에 있다',
  /<Suspense fallback=\{null\}>\s*<BootDone \/>\s*\{CALENDAR_WINDOW_BOOT \? <CalendarWindow \/>[\s\S]*?: <App \/>\}\s*<\/Suspense>/.test(main));
ok('#M4 BootDone은 useLayoutEffect에서 booting을 지운다(그리기 직전 — 흰 화면이 비치지 않게)',
  /function BootDone\(\) \{\s*useLayoutEffect\(\(\) => \{ document\.documentElement\.classList\.remove\('booting'\) \}, \[\]\)\s*return null\s*\}/.test(main));
const params = [...main.matchAll(/_params\.get\('(\w+)'\) === '1'/g)].map(m => m[1]);
ok('#M5 창 부팅 파라미터가 전부 …Window 꼴(앱 조각 미리 받기 건너뛰기 규칙과 맞물림)', params.length >= 8 && params.every(p => /Window$/.test(p)), params.join(', '));

console.log('\n── 파트② lazyScreen — 실패는 새로고침 안내 ──');
const ls = stripComments(read('src/lazyScreen.tsx'));
ok('#L1 받기 실패를 잡아 ChunkLoadFailed로 바꾼다', /lazy\(\(\) => loadKeep\(\)\.catch\(\(err\) => \{[\s\S]*?return \{ default: \(\) => <ChunkLoadFailed inApp=\{inApp\} \/> \}/.test(ls));
ok('#L3 preload는 같은 load를 부르고 실패를 삼킨다(미리 받기 실패가 앱을 멈추지 않게)', /C\.preload = \(\) => loadKeep\(\)\.catch\(\(\) => \{\}\)/.test(ls)
  && /const loadKeep = \(\) => load\(\)\.then\(\(m\) => \{ mod = m; return m \}\)/.test(ls));
ok('#L5 받아 둔 화면은 바로 그리고, 어느 쪽으로 그릴지는 마운트 때 한 번만 정한다(바뀌면 다시 마운트돼 입력이 사라진다)',
  /const \[Impl\] = useState\(\(\) => \(mod \? mod\.default : L\)\)\s*return <Impl \{\.\.\.props\} \/>/.test(ls)
  && (ls.match(/<L\b/g) || []).length === 0);
const keep = ls.match(/export function KeepAfterOpen\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
ok('#L6 KeepAfterOpen: 처음 열 때부터 마운트하고 닫혀도 되돌리지 않는다',
  !!keep && /const \[ever, setEver\] = useState\(open\)/.test(keep[1]) && /if \(open && !ever\) setEver\(true\)/.test(keep[1])
  && /return \(ever \|\| open\) \? children : null/.test(keep[1]) && !/setEver\(false\)/.test(keep[1]));
ok('#L4 앱 안 화면은 실패 안내에 닫기가 있다', /\{inApp && \(\s*<button\s*onClick=\{\(\) => setHidden\(true\)\}/.test(ls));
ok('#L2 자동 새로고침 없음 — reload는 버튼 클릭에서만', (ls.match(/location\.reload\(\)/g) || []).length === 1 && /onClick=\{\(\) => window\.location\.reload\(\)\}/.test(ls));

console.log('\n── 파트③ index.html — 로딩 중 바탕 ──');
const html = read('index.html');
const htmlNoC = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
ok('#H1 <html class="booting">', /<html lang="ko" class="booting">/.test(html));
ok('#H2 바탕 규칙은 html.booting, html.booting body', /html\.booting, html\.booting body \{ background: #0b1120; \}/.test(htmlNoC));
ok('#H3 :has() 금지(계좌 전환 약 0.5초 느려짐 실측)', !/:has\(/.test(htmlNoC));
ok('#H4 #root:empty 덮개 금지(백테스트 창에서 덮개가 남음 실측)', !/#root:empty/.test(htmlNoC));

console.log('\n── 파트④ vite.config.ts — 앱 조각 미리 받기 · 묶음 ──');
const vc = stripComments(read('vite.config.ts'));
ok('#V1 appChunkPreload()가 plugins에 있다', /plugins: \[\s*react\(\),\s*appChunkPreload\(\),/.test(vc));
ok('#V2 창 주소(…Window=1)는 미리 받기를 건너뛴다', vc.includes('if(/[?&]\\\\w+Window=1(?:&|$)/.test(location.search))return;'));
ok('#V3 앱 조각을 못 찾으면 빌드를 멈춘다(조용히 빠지지 않게)', /if \(!app \|\| !entry\) throw new Error/.test(vc));
ok('#V5 앱 조각은 App.tsx를 담은 조각으로 찾는다(facadeModuleId는 1-5 뒤 null일 수 있다) + 창이 앱 조각을 끌어오면 빌드 중단',
  /const app = chunks\.find\(c => has\(c, /.test(vc) && !/c\.facadeModuleId &&/.test(vc)
  && /closure\(w\.fileName\)\.has\(app\.fileName\)\) throw new Error/.test(vc) && /if \(wins\.length < 8\) throw new Error/.test(vc));
ok('#V4 React·아이콘 묶음(vendor-react · vendor-icons)', /return 'vendor-react'/.test(vc) && /return 'vendor-icons'/.test(vc));

console.log('\n── 파트⑤ App 안 큰 화면 5개 — 열 때 받기 + 미리 받기 ──');
const app = stripComments(read('src/App.tsx'));
const PAGES = ['BacktestPage', 'LedgerPage', 'AdminPage', 'AdminPortal', 'DividendTaxPage'];
for (const n of PAGES) {
  ok(`#A1 ${n} = lazyScreen(() => import('./components/${n}'), { inApp: true })`,
    new RegExp(`const ${n} = lazyScreen\\(\\(\\) => import\\('\\./components/${n}'\\), \\{ inApp: true \\}\\);`).test(app)
    && !new RegExp(`^import\\s+${n}\\s+from`, 'm').test(app));
  const uses = (app.match(new RegExp(`<${n}\\b`, 'g')) || []).length;
  const wrapped = (app.match(new RegExp(`<Suspense fallback=\\{<ScreenLoading \\/>\\}>\\s*<${n}\\b`, 'g')) || []).length;
  ok(`#A2 ${n}: 쓰는 자리 ${uses}곳 전부 바로 바깥이 <Suspense fallback={<ScreenLoading />}>`, uses > 0 && uses === wrapped, `쓰는 곳 ${uses} · 감싼 곳 ${wrapped}`);
}
const pf = app.match(/const prefetchedRef = useRef\(false\);\s*useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/);
ok('#A3 미리 받기는 로딩 화면·인트로가 끝난 뒤 한 번만', !!pf && /if \(prefetchedRef\.current \|\| !authUser \|\| isInitialLoading \|\| introPlaying\) return;/.test(pf[1]));
ok('#A4 미리 받기 목록에 5개가 권한 조건과 함께 있다', !!pf
  && /\(admin \|\| userFeatures\.backtestEnabled\) && BacktestPage/.test(pf[1]) && /\(admin \|\| userFeatures\.ledgerEnabled\) && LedgerPage/.test(pf[1])
  && /\(admin \|\| userFeatures\.feature2\) && DividendTaxPage/.test(pf[1]) && /admin && AdminPage/.test(pf[1]) && /admin && AdminPortal/.test(pf[1]));
ok('#A5 한 번에 하나씩(앞 것이 끝나면 다음)', !!pf && /C\.preload\(\)\.then\(\(\) => idle\(next\)\)/.test(pf[1]));
ok('#A6 미리 받기 효과가 첫 조기 반환보다 위(훅 순서)', app.indexOf('const prefetchedRef = useRef(false);') > 0
  && app.indexOf('const prefetchedRef = useRef(false);') < app.indexOf('if (!authUser && ADMIN_VIEW_EMAIL && !adminViewUserCtx)'));

console.log('\n── 파트⑥ 늘 떠 있는 창 3개 — 처음 열 때 받기(관심종목 제외) ──');
const WINS = [['FloatingCalculator', 'showCalculator'], ['CalendarModal', 'showCalendarModal'], ['FlowBoard', 'showFlowBoard']];
for (const [n, flag] of WINS) {
  ok(`#W1 ${n} = lazyScreen(() => import('./components/${n}'), { inApp: true })`,
    new RegExp(`const ${n} = lazyScreen\\(\\(\\) => import\\('\\./components/${n}'\\), \\{ inApp: true \\}\\);`).test(app)
    && !new RegExp(`^import\\s+${n}\\s+from`, 'm').test(app));
  const uses = (app.match(new RegExp(`<${n}\\b`, 'g')) || []).length;
  const wrapped = (app.match(new RegExp(`<KeepAfterOpen open=\\{${flag}\\}>\\s*<Suspense fallback=\\{<WindowLoading \\/>\\}>\\s*<${n}\\b`, 'g')) || []).length;
  ok(`#W2 ${n}: 쓰는 자리 ${uses}곳 전부 <KeepAfterOpen open={${flag}}><Suspense fallback={<WindowLoading />}> 바로 안`, uses > 0 && uses === wrapped, `쓰는 곳 ${uses} · 감싼 곳 ${wrapped}`);
}
ok('#W3 관심종목(WatchlistPopup)은 정적 import 그대로(닫혀 있어도 차트 창 물음에 답하는 리스너가 있다)',
  /^import WatchlistPopup from '\.\/components\/WatchlistPopup';/m.test(app) && !/const WatchlistPopup = lazyScreen/.test(app)
  && !/<KeepAfterOpen open=\{showWatchlist\}>/.test(app));
ok('#W4 미리 받기 목록에 창 3개(흐름도는 권한 조건과 함께)가 큰 화면보다 먼저 있다', !!pf
  && /const list = \[\s*FloatingCalculator,\s*CalendarModal,\s*\(admin \|\| userFeatures\.flowEnabled\) && FlowBoard,\s*\(admin \|\| userFeatures\.backtestEnabled\) && BacktestPage/.test(pf[1]));
ok('#W5 흐름도는 여전히 flowAccess 안에서만 마운트', /\{flowAccess && \(\s*<ErrorBoundary label="자금 흐름도">\s*<KeepAfterOpen open=\{showFlowBoard\}>/.test(app));

console.log(`\n${fail ? '❌' : '✅'} verify:split — 통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
