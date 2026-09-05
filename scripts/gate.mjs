#!/usr/bin/env node
// gate — 커밋 전에 한 번에 돌리는 전체 게이트.  실행: npm run gate
//
// 왜 단일 명령인가(2026-09-05 프로덕션 장애):
//   게이트가 26개로 흩어져 있으면 "그때그때 관련된 것만" 고르게 되고, 고르는 판단 자체가 틀린다.
//   실제로 `holdReasonText` import 누락이 build·undefcheck·scopecheck·verify 22종을 전부 통과해
//   배포됐다. 한 명령으로 전부 돌리는 것이 유일하게 확실한 방법이다(전체 소요는 아래 출력 참조).
//
// 차단(blocking): importcheck · build · verify:* (calendar 제외)
// 참고(advisory): verify:calendar — nager.at 라이브 교차검증이라 공휴일 데이터 드리프트로 상시 실패할
//                 수 있다. 여기서 차단하면 게이트가 영구 빨강이 되어 사람이 통째로 무시하게 된다.
// 외부 도구(jsxcheck·undefcheck·scopecheck)는 저장소 밖 memory/tools 에 있어 **찾지 못하면 크게 알린다**.
//   경로 지정: 환경변수 CLAUDE_MEMORY_TOOLS=<디렉터리>

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const verifyKeys = Object.keys(pkg.scripts).filter(k => k.startsWith('verify:')).sort();

const ADVISORY = new Set(['verify:calendar']);   // 라이브 API 드리프트 — 차단하지 않고 보고만

const TOOL_DIRS = [
  process.env.CLAUDE_MEMORY_TOOLS,
  path.join(ROOT, 'scripts'),
  'C:/Users/arui1/.claude/projects/c--Users-arui1-OneDrive----GitHub-ASS-Page/memory/tools',
].filter(Boolean);
const findTool = (name) => TOOL_DIRS.map(d => path.join(d, name)).find(p => existsSync(p)) || null;

const run = (label, cmd, { advisory = false } = {}) => {
  const t0 = Date.now();
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8' });
  const ms = Date.now() - t0;
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  const tag = ok ? 'OK  ' : (advisory ? 'WARN' : 'FAIL');
  console.log(`  [${tag}] ${label.padEnd(22)} ${String(ms).padStart(6)}ms`);
  return { label, ok, advisory, ms, out };
};

console.log('\n=== gate: 커밋 전 전체 검증 ===\n');
const results = [];

// 1) 누락 import — 이번 장애 클래스. 가장 싸고 가장 치명적이라 맨 앞.
results.push(run('importcheck', 'node scripts/importcheck.mjs'));

// 2) 외부 정적 도구 — 없으면 크게 알린다(조용히 건너뛰면 게이트가 사라진 줄도 모른다)
const missingTools = [];
for (const t of ['jsxcheck.mjs', 'undefcheck.mjs', 'scopecheck.mjs']) {
  const p = findTool(t);
  if (p) results.push(run(t.replace('.mjs', ''), `node "${p}"`, { advisory: true }));
  else missingTools.push(t);
}

// 3) 빌드
results.push(run('build', 'npm run build'));

// 4) verify:* 전부 (importcheck 는 1단계에서 이미 돌았다)
for (const k of verifyKeys) {
  if (k === 'verify:imports') continue;
  results.push(run(k, `npm run ${k}`, { advisory: ADVISORY.has(k) }));
}

// ── 결과 ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok && !r.advisory);
const warned = results.filter(r => !r.ok && r.advisory);
const total = results.reduce((s, r) => s + r.ms, 0);

console.log(`\n  총 ${results.length}단계 / ${(total / 1000).toFixed(1)}초`);
if (missingTools.length) {
  console.log(`\n  !! 외부 도구를 찾지 못해 건너뜀: ${missingTools.join(', ')}`);
  console.log('     CLAUDE_MEMORY_TOOLS=<디렉터리> 로 경로를 지정하세요.');
}
if (warned.length) {
  console.log(`\n  참고(차단 아님) ${warned.length}건 — 수동 검토:`);
  for (const w of warned) console.log(`    · ${w.label}`);
}
if (failed.length) {
  console.log(`\n❌ 차단 ${failed.length}건 — 커밋하지 마세요.\n`);
  for (const f of failed) {
    console.log(`── ${f.label} ${'─'.repeat(Math.max(0, 60 - f.label.length))}`);
    console.log(f.out.split('\n').filter(l => /✗|❌|FAIL|MISSING|error|Error|실패/.test(l)).slice(0, 12).join('\n') || f.out.slice(-1200));
    console.log('');
  }
  process.exit(1);
}
console.log('\n✅ 전체 통과 — 커밋해도 됩니다.\n');
