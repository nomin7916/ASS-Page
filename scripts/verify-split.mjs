#!/usr/bin/env node
// 앱 본체·별도 창 8종 나누어 받기(성능 개선 1-3, 2026-11-15)를 지키는 검사.  실행: npm run verify:split
//
// 지켜야 할 것:
//   ① main.tsx는 App·창 8종을 lazyScreen(동적 import)으로만 부른다 — 정적 import가 하나라도 생기면 모든 창이 앱 전체를 다시 받는다.
//   ② 조각 받기 실패는 lazyScreen이 새로고침 안내로 바꾼다(자동 새로고침 금지 — 입력 중 내용 유실).
//   ③ 로딩 중 어두운 바탕은 html.booting + BootDone(첫 커밋에서 지움)으로만 — 실측한 두 함정 금지:
//      body:has(#root:empty) = 계좌 전환 약 0.5초 느려짐(문서 전체 스타일 재계산) · #root:empty 덮개 = 백테스트 창(body 포털)에서 덮개가 남음.
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
ok('#L1 받기 실패를 잡아 ChunkLoadFailed로 바꾼다', /return lazy\(\(\) => load\(\)\.catch\(\(err\) => \{[\s\S]*?return \{ default: ChunkLoadFailed \}/.test(ls));
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
ok('#V4 React·아이콘 묶음(vendor-react · vendor-icons)', /return 'vendor-react'/.test(vc) && /return 'vendor-icons'/.test(vc));

console.log(`\n${fail ? '❌' : '✅'} verify:split — 통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
