#!/usr/bin/env node
// 화면별로 실제 받는 JS 양 — 진입 조각에서 정적 import를 따라가 합산한다.  (명세: 성능개선_설계_2026-11.md §7)
//   실행: node scripts/perf/chunks.mjs <dist 폴더> [자세히 볼 조각 이름]
//   화면을 나누기 전(조각 1개)에는 모든 화면이 같은 값으로 나온다. 나눈 뒤(1-3 이후)에 화면별 차이가 보인다.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync } from 'node:zlib';

const dist = process.argv[2] && resolve(process.argv[2]);
const dir = dist && join(dist, 'assets');
if (!dir || !existsSync(dir)) { console.log('사용법: node scripts/perf/chunks.mjs <dist 폴더> [조각 이름]'); process.exit(1); }
const files = readdirSync(dir).filter(f => f.endsWith('.js'));
const src = Object.fromEntries(files.map(f => [f, readFileSync(join(dir, f), 'utf8')]));
const staticDeps = (f) => [...new Set([...src[f].matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)].map(m => m[1]))];
const closure = (start) => {
  const seen = new Set(); const st = [start];
  while (st.length) { const f = st.pop(); if (seen.has(f) || !src[f]) continue; seen.add(f); for (const d of staticDeps(f)) st.push(d); }
  return [...seen];
};
const size = (list) => list.reduce((a, f) => { const b = Buffer.from(src[f]); a[0] += b.length; a[1] += brotliCompressSync(b).length; return a; }, [0, 0]);
const kb = (n) => (n / 1024).toFixed(0).padStart(6) + 'KB';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = (html.match(/src="\/assets\/([^"]+\.js)"/) || [])[1];
if (!entry) { console.log('❌ index.html에서 진입 조각을 찾지 못했습니다.'); process.exit(1); }
const find = (name) => files.find(f => f.startsWith(name + '-'));

console.log(`\n=== 화면별 받는 JS (조각 ${files.length}개) ===\n`);
const NAMES = ['App', 'CalendarWindow', 'FlowWindow', 'BacktestWindow', 'CardWindow', 'LedgerWindow', 'RateWindow', 'WatchlistWindow', 'StockChartWindow'];
const base = closure(entry);
const [er, eb] = size(base);
console.log(`  ${'진입(모든 화면 공통)'.padEnd(20)} 파일 ${String(base.length).padStart(2)}  크기 ${kb(er)}  전송 ${kb(eb)}`);
for (const n of NAMES) {
  const f = find(n);
  if (!f) continue;   // 아직 나누지 않은 화면은 진입 조각 안에 있다
  const cl = [...new Set([...base, ...closure(f)])];
  const [r, b] = size(cl);
  console.log(`  ${n.padEnd(20)} 파일 ${String(cl.length).padStart(2)}  크기 ${kb(r)}  전송 ${kb(b)}`);
}
const [ar, ab] = size(files);
console.log(`  ${'전체 조각 합계'.padEnd(20)} 파일 ${String(files.length).padStart(2)}  크기 ${kb(ar)}  전송 ${kb(ab)}`);
const detail = process.argv[3] && find(process.argv[3]);
if (detail) for (const f of [...new Set([...base, ...closure(detail)])]) console.log(`      ${f}  ${kb(src[f].length)}`);
console.log('');
