#!/usr/bin/env node
// Tailwind 꾸밈은 **빌드 CSS 하나뿐**임을 지키는 검사 — 성능 개선 1-1(2026-11-14).  실행: npm run verify:tw-static
//
// 배경: index.html이 빌드 CSS와 별개로 외부 스크립트(cdn.tailwindcss.com, 358KB)를 또 불러 같은 꾸밈을 브라우저에서
//   다시 만들고 있었다(첫 화면 준비 1,812ms → 빼면 839ms, CPU 6배 느리게 측정). 빼도 화면이 같은 이유는
//   빌드가 소스의 **완성된 글자**로 적힌 클래스를 전부 CSS로 만들기 때문이다. 따라서 지켜야 할 것은 둘:
//   ① 외부 스크립트를 다시 넣지 않는다  ② 클래스 이름을 실행 중에 조립하지 않는다(`bg-${색}-500` — 빌드가 못 본다).
//   ②는 예전엔 외부 스크립트가 화면을 훑어 메워 줬지만 이제는 **그 요소만 꾸밈이 빠진다**(오류도 안 난다).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const walk = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

console.log('\n── 파트① 꾸밈 출처는 빌드 CSS 하나 ──');
const html = read('index.html');
ok('#T1 index.html이 Tailwind 외부 스크립트를 불러오지 않는다(cdn.tailwindcss.com · @tailwindcss/browser)',
  !/cdn\.tailwindcss\.com/.test(html) && !/@tailwindcss\/browser/.test(html) && !/tailwindcss[^"'>]*\.js/.test(html));
const css = read('src/index.css');
ok('#T2 src/index.css에 @tailwind base·components·utilities 세 줄이 있다',
  /@tailwind\s+base\s*;/.test(css) && /@tailwind\s+components\s*;/.test(css) && /@tailwind\s+utilities\s*;/.test(css));
const twCfg = read('tailwind.config.js');
ok('#T3 tailwind.config.js content가 index.html과 src 전체(js·ts·jsx·tsx)를 훑는다',
  /["']\.\/index\.html["']/.test(twCfg) && /["']\.\/src\/\*\*\/\*\.\{js,ts,jsx,tsx\}["']/.test(twCfg));
ok('#T4 postcss.config.js가 tailwindcss를 돌린다', /tailwindcss\s*:/.test(read('postcss.config.js')));
ok('#T5 main.tsx가 index.css를 불러온다', /^import '\.\/index\.css'$/m.test(read('src/main.tsx')));

console.log('\n── 파트② 클래스 이름을 실행 중에 조립하지 않는다 ──');
const TW_PREFIX = '(?:bg|text|border|ring|from|to|via|fill|stroke|w|h|p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|z|top|left|right|bottom|inset(?:-[xy])?'
  + '|grid-cols|grid-rows|col-span|row-span|min-w|max-w|min-h|max-h|opacity|shadow|rounded(?:-[a-z]+)?|translate-[xy]|scale(?:-[xy])?|rotate'
  + '|duration|delay|leading|tracking|basis|flex|order|space-[xy]|divide(?:-[xy])?|outline|decoration|accent|caret|size|font|line-clamp|aspect'
  + '|cursor|overflow(?:-[xy])?|justify|items|content|self|place|animate|blur|backdrop-blur|underline-offset|indent|columns)';
const GLUE_BEFORE = new RegExp(`(?:^|[\\s'"\`:])(?:[a-z-]+:)*-?${TW_PREFIX}-(?:\\[)?\\$\\{`);
const GLUE_CONCAT = new RegExp(`['"\`](?:[^'"\`]*\\s)?(?:[a-z-]+:)*-?${TW_PREFIX}-(?:\\[)?['"\`]\\s*\\+`);
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// className={…} 안의 템플릿 글자에서, `${…}`가 앞뒤 글자에 **붙어 있으면**(공백으로 떨어져 있지 않으면) 조립으로 본다.
const classNameGlue = (src) => {
  const out = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf('className={', from);
    if (at < 0) break;
    let i = at + 'className={'.length, depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
      else if (c === '`') {
        // 템플릿 글자: 정적 조각과 ${…} 경계를 본다
        i++;
        let prev = '`';
        while (i < src.length && src[i] !== '`') {
          if (src[i] === '\\') { prev = src[i + 1]; i += 2; continue; }
          if (src[i] === '$' && src[i + 1] === '{') {
            const before = prev;
            let d = 1; i += 2;
            const exprStart = i;
            while (i < src.length && d > 0) {
              const k = src[i];
              if (k === '{') d++; else if (k === '}') d--;
              else if (k === "'" || k === '"' || k === '`') { const q = k; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
              i++;
            }
            const expr = src.slice(exprStart, i - 1);
            const after = src[i] ?? '`';
            // 허용: `…a${조건 ? ' b c' : ''}` — 끼워 넣는 글자가 전부 '빈 글자'이거나 '공백으로 시작'하면 이름이 이어 붙지 않는다
            //   (빌드의 글자 추출기도 a·b·c를 각각 완성된 이름으로 읽는다 — 2026-11-14 추출기로 직접 확인).
            const lits = [...expr.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map(m => m[1] ?? m[2]);
            const condOnly = lits.length > 0 && /[?]|&&|\|\|/.test(expr);
            const safeLead = condOnly && lits.every(s => s === '' || /^\s/.test(s));
            const safeTail = condOnly && lits.every(s => s === '' || /\s$/.test(s));
            const gluedBefore = before !== '`' && !/\s/.test(before) && !safeLead;
            const gluedAfter = after !== '`' && after !== '$' && !/\s/.test(after) && !safeTail;
            if (gluedBefore || gluedAfter) out.push({ pos: i, before, after });
            prev = '}';
            continue;
          }
          prev = src[i]; i++;
        }
      }
      i++;
    }
    from = Math.max(i, start);
  }
  return out;
};

// 조립이지만 Tailwind 클래스가 아닌 것(직접 만든 이름 등)은 여기에 **이유와 함께** 적는다. 비어 있는 것이 정상.
const ALLOW = new Set([
]);

const files = walk(join(ROOT, 'src')).filter(f => /\.(ts|tsx)$/.test(f));
const hits = [];
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const src = stripComments(readFileSync(f, 'utf8'));
  const lineOf = (pos) => src.slice(0, pos).split('\n').length;
  src.split('\n').forEach((line, idx) => {
    if (GLUE_BEFORE.test(line) || GLUE_CONCAT.test(line)) hits.push(`${rel}:${idx + 1}  ${line.trim().slice(0, 120)}`);
  });
  for (const g of classNameGlue(src)) {
    const ln = lineOf(g.pos);
    const key = `${rel}:${ln}`;
    if (!hits.some(h => h.startsWith(key + ' '))) hits.push(`${key}  className 안 조립(앞 '${g.before}' · 뒤 '${g.after}')`);
  }
}
const real = hits.filter(h => !ALLOW.has(h.split('  ')[0]));
ok(`#T6 실행 중에 조립하는 클래스 이름 0건 (src ${files.length}개 파일)`, real.length === 0);
for (const h of real.slice(0, 20)) console.log(`      ${h}`);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
