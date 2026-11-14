#!/usr/bin/env node
// 첫 화면 준비 시간 측정 — 느린 컴퓨터 흉내(CPU 느리게) + 화면·콘솔 오류 확인.  (명세: 성능개선_설계_2026-11.md §7)
//   실행: node scripts/perf/measure.mjs <dist 폴더> [배율=6] [횟수=5]
//   재는 것: 화면(body)에 글자가 처음 뜬 시각(firstText — 백테스트는 body 포털이라 #root가 아니라 body를 본다) · 브라우저 작업 총량(task) · 스크립트 실행(script) · 콘솔 오류 수.
//   통신은 로컬이라 0 — CPU가 하는 일만 잰다. 외부 요청(구글 로그인 스크립트 등)은 전부 막는다. 로그인 뒤 화면은 못 잰다.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dist = process.argv[2] && resolve(process.argv[2]);
const rate = Number(process.argv[3] || 6), runs = Number(process.argv[4] || 5);
if (!dist || !existsSync(join(dist, 'index.html'))) { console.log('사용법: node scripts/perf/measure.mjs <dist 폴더> [배율=6] [횟수=5]'); process.exit(1); }
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
catch { console.log('❌ playwright를 찾지 못했습니다(이 측정은 클라우드 세션용).'); process.exit(1); }

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
  const f = join(dist, u.pathname);
  if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); return res.end(readFileSync(f)); }
  res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(html);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

const ROUTES = [['앱', '/'], ['달력 창', '/?calendarWindow=1'], ['흐름도 창', '/?flowWindow=1'], ['백테스트 창', '/?backtestWindow=1'], ['계좌 카드 창', '/?cardWindow=1'],
  ['가계부 창', '/?ledgerWindow=1'], ['금리 창', '/?rateWindow=1'], ['관심종목 창', '/?watchlistWindow=1'], ['종목 차트 창', '/?stockChartWindow=1&code=005930']];
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const browser = await chromium.launch();
let totalErrors = 0;
console.log(`\n=== 첫 화면 측정: CPU ${rate}배 느리게 · ${runs}회 중앙값 ===\n`);
for (const [name, url] of ROUTES) {
  const rows = []; const errs = new Set();
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.add('pageerror: ' + String(e.message).slice(0, 140)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.add('console: ' + m.text().slice(0, 140)); });
    await page.route('**/*', r => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.addInitScript(() => {
      window.__firstText = null;
      const tick = () => { const r = document.body; if (r && r.innerText.trim().length > 0) { window.__firstText = performance.now(); return; } requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await page.goto(base + url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__firstText !== null, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const first = await page.evaluate(() => window.__firstText);
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    rows.push({ first: first ?? NaN, script: m.ScriptDuration * 1000, task: m.TaskDuration * 1000 });
    await ctx.close();
  }
  const f = k => Math.round(median(rows.map(r => r[k])));
  totalErrors += errs.size;
  console.log(`  ${name.padEnd(8)} firstText=${String(f('first')).padStart(5)}ms  script=${String(f('script')).padStart(5)}ms  task=${String(f('task')).padStart(5)}ms  오류 ${errs.size}건`);
  for (const e of [...errs].slice(0, 3)) console.log('      ' + e);
}
await browser.close(); srv.close();
console.log(`\n콘솔 오류 합계: ${totalErrors}건${totalErrors ? '  ← 배포 전에 원인 확인' : ''}\n`);
process.exit(totalErrors ? 1 : 0);
