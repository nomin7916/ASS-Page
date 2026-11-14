#!/usr/bin/env node
// 성능 측정용 임시 빌드 — 저장소 **밖** 폴더에 복사해 거기서 설치·빌드한다(저장소 안 npm install 금지 규칙을 지킨다).
//   실행: node scripts/perf/build-scratch.mjs <임시폴더>      예) node scripts/perf/build-scratch.mjs /tmp/perf-a
//   결과: <임시폴더>/dist  → measure.mjs · chunks.mjs 에 넘긴다.  (명세: 성능개선_설계_2026-11.md §7)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = process.argv[2] && resolve(process.argv[2]);
if (!out) { console.log('사용법: node scripts/perf/build-scratch.mjs <임시폴더(저장소 밖)>'); process.exit(1); }
if (out.startsWith(resolve(ROOT) + '/') || out === resolve(ROOT)) { console.log('❌ 임시 폴더는 저장소 밖이어야 합니다.'); process.exit(1); }

mkdirSync(out, { recursive: true });
for (const d of ['src', 'api', 'dist']) rmSync(join(out, d), { recursive: true, force: true });
for (const f of ['src', 'api', 'index.html', 'package.json', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js']) cpSync(join(ROOT, f), join(out, f), { recursive: true });
mkdirSync(join(out, 'public'), { recursive: true });
for (const f of readdirSync(join(ROOT, 'public'))) {
  const p = join(ROOT, 'public', f);
  if (statSync(p).isFile()) cpSync(p, join(out, 'public', f));   // 인트로 영상(public/intro, 15MB)은 측정에 필요 없어 뺀다
}
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: out, stdio: 'inherit' }).status === 0;
if (!existsSync(join(out, 'node_modules', 'vite'))) {
  const hasBun = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!(hasBun ? sh('bun', ['install']) : sh('npm', ['install', '--no-audit', '--no-fund']))) { console.log('❌ 설치 실패'); process.exit(1); }
}
if (!sh('node', ['node_modules/vite/bin/vite.js', 'build'])) { console.log('❌ 빌드 실패'); process.exit(1); }
console.log(`\n✅ 임시 빌드 완료: ${join(out, 'dist')}`);
