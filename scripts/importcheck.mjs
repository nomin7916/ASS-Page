#!/usr/bin/env node
// importcheck — "로컬 모듈의 export 를 호출하는데 그 파일에 import 가 없는" 경우를 잡는다.
//
// 왜 필요한가(2026-09-05 프로덕션 장애):
//   커밋 e81c277 이 IntegratedDashboard.tsx 에 `holdReasonText(` 사용부만 넣고 import 를 빠뜨린 채
//   배포됐다 → 런타임 ReferenceError → ErrorBoundary 가 화면을 통째로 대체.
//   기존 게이트가 전부 통과했다:
//     · vite build   — esbuild 는 타입체크를 하지 않고, 미정의 **전역 참조**는 빌드 오류가 아니다
//     · tsc          — 이 저장소는 대부분 파일이 `// @ts-nocheck` 이라 구조적으로 무력(설치도 안 돼 있음)
//     · undefcheck   — 파일 전체를 한 스코프로 보고 긴 import 목록을 끝까지 읽지 않는다
//     · scopecheck   — '다른 블록의 지역 변수 참조'를 보지 '없는 import' 를 보지 않는다
//     · verify:*     — 소스 텍스트 가드가 **사용부 존재**만 단언하고 import 는 보지 않았다
//
// 사용: node memory/tools/importcheck.mjs [repoRoot]
// 종료코드: 누락 1건이라도 있으면 1
//
// ⚠️ 오탐이 나면 사람이 게이트를 무시하게 된다 → 판정은 **보수적**으로:
//    같은 이름이 그 파일에 어떤 형태로든 선언·바인딩돼 있으면 통과시킨다.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '.';
const SRC = path.join(ROOT, 'src');
if (!existsSync(SRC)) { console.error('src 디렉터리를 찾을 수 없습니다: ' + SRC); process.exit(2); }

const walk = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

const files = walk(SRC).filter(f => /\.(ts|tsx)$/.test(f));

// ── 1. 로컬 모듈이 내보내는 이름 수집 ────────────────────────────────────────
// (src/**/*.ts|tsx 의 `export const NAME` / `export function NAME`)
const exportsByFile = new Map();
const allExports = new Set();
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of s.matchAll(/^\s*export\s+(?:const|function|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  exportsByFile.set(f, names);
  names.forEach(n => allExports.add(n));
}

// ── 2. 파일별로 '바인딩된 이름' 과 '호출된 이름' 을 뽑아 대조 ────────────────
// ⚠️ import 캡처는 `[^}]*` 로 한다. `[\s\S]*?` 는 백트래킹으로 **앞선 import 까지 삼켜**
//    첫 이름이 `import { formatCurrency` 형태로 잘린다(실측: 오탐 47건의 원인).
const IMPORT_NAMED = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
const IMPORT_DEFAULT = /import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g;
const IMPORT_NS = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g;
const REQUIRE_NAMED = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(/g;

const bindingsOf = (s) => {
  const set = new Set();
  const addList = (raw) => raw.split(',').forEach(x => {
    const n = x.trim().split(/\s+as\s+/).pop().trim();
    if (/^[A-Za-z_$][\w$]*$/.test(n)) set.add(n);
  });
  for (const m of s.matchAll(IMPORT_NAMED)) addList(m[1]);
  for (const m of s.matchAll(REQUIRE_NAMED)) addList(m[1]);
  for (const m of s.matchAll(IMPORT_DEFAULT)) set.add(m[1]);
  for (const m of s.matchAll(IMPORT_NS)) set.add(m[1]);
  // 로컬 선언 — const/let/var/function/class
  for (const m of s.matchAll(/(?:^|[;{}\s])(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  // 구조분해 선언 · 함수 파라미터 · props — 보수적으로 '이름 뒤에 , ) } : = 가 오는 형태' 전부 바인딩으로 본다
  for (const m of s.matchAll(/[({,[]\s*([A-Za-z_$][\w$]*)\s*(?=[,)}\]:=])/g)) set.add(m[1]);
  return set;
};

// 주석·문자열을 걷어낸 뒤 호출부를 찾는다(주석 속 예시가 오탐이 되지 않게).
const stripNoise = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
  .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
  .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""');

let bad = 0;
const rows = [];
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const own = exportsByFile.get(f) || new Set();
  const bound = bindingsOf(raw);
  const body = stripNoise(raw);
  // `name(` 형태의 호출만 본다. 앞 문자가 `.`·식별자면 멤버 접근이라 제외.
  const called = new Set();
  for (const m of body.matchAll(/(^|[^\w$.'"`])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[2]);
  for (const name of called) {
    if (!allExports.has(name)) continue;   // 로컬 모듈 export 가 아니면 관심 없음
    if (own.has(name)) continue;           // 자기 파일이 정의한 것
    if (bound.has(name)) continue;         // import·선언·파라미터 등으로 바인딩됨
    rows.push(`  MISSING: ${path.relative(ROOT, f)} -> ${name}()`);
    bad++;
  }
}

if (bad) {
  console.log(rows.join('\n'));
  console.log(`\n  X ${bad}건 — 호출하는데 import/선언이 없습니다 (검사 ${files.length}파일)`);
  process.exit(1);
}
console.log(`  OK 누락 import 없음 (검사 ${files.length}파일, 로컬 export ${allExports.size}개)`);
