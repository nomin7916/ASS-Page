#!/usr/bin/env node
// 새 디자인(인디고 나이트) 시범 검증 — 관리자만 켜고 끄며, 끄면 이전 화면 그대로여야 한다(사용자 확정 2026-11-21).
//   src/uiTheme.ts 를 직접 import한다(미러 금지). 런타임이 .ts를 못 읽으면 단위 검사만 건너뛴다.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let U = null;
try { U = await import(pathToFileURL(join(ROOT, 'src/uiTheme.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/uiTheme.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

console.log('\n── 파트① 켜짐 규칙 ──');
if (U) {
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
  ok('#U1 관리자 이메일만 대상(대소문자·공백 무시)', U.isUiThemeEligible(' Admin@X.com ', 'admin@x.com') && !U.isUiThemeEligible('user@x.com', 'admin@x.com'));
  ok('#U2 이메일이 없으면 대상 아님', !U.isUiThemeEligible('', 'admin@x.com') && !U.isUiThemeEligible(null, 'admin@x.com') && !U.isUiThemeEligible('a@x.com', ''));
  ok('#U3 관리자가 아니면 저장값이 켜짐이어도 꺼짐', U.resolveUiTheme(false, true, '') === false);
  ok('#U4 관리자 + 저장값 켜짐 = 켜짐', U.resolveUiTheme(true, true, '') === true);
  ok('#U5 관리자라도 저장값이 없으면 꺼짐(기본은 이전 화면)', U.resolveUiTheme(true, false, '') === false);
  ok('#U6 ?ui=classic 이면 늘 꺼짐', U.resolveUiTheme(true, true, '?ui=classic') === false && U.resolveUiTheme(true, true, '?a=1&ui=classic&b=2') === false);
  ok('#U7 ui=classicX 같은 비슷한 글자는 무시', !U.isForcedClassic('?ui=classicx') && !U.isForcedClassic('?xui=classic'));
  const s = mem();
  U.writeUiThemePref(s, true);
  ok('#U8 켜기 저장 → 읽으면 켜짐', U.readUiThemePref(s) === true);
  ok('#U9 ?ui=classic 첫 읽기는 저장값까지 지운다(새 화면이 깨졌을 때 탈출구)', U.initialUiThemePref(s, '?ui=classic') === false && U.readUiThemePref(s) === false);
  U.writeUiThemePref(s, true); U.writeUiThemePref(s, false);
  ok('#U10 끄기 저장 → 칸을 지운다', !s.m.has(U.UI_THEME_KEY));
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  ok('#U11 저장소가 오류를 던져도 꺼짐으로 계속', U.readUiThemePref(bad) === false && (U.writeUiThemePref(bad, true), true));
  const cls = new Set(); const heads = [];
  const doc = { documentElement: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } }, getElementById: id => heads.find(h => h.id === id) || null, createElement: () => ({}), head: { appendChild: el => heads.push(el) } };
  U.applyUiThemeToDocument(doc, true); U.applyUiThemeToDocument(doc, true);
  ok('#U12 켜면 html에 클래스 + 글꼴 링크 1개만', cls.has(U.UI_THEME_CLASS) && heads.length === 1 && heads[0].href === U.UI_THEME_FONT_HREF);
  U.applyUiThemeToDocument(doc, false);
  ok('#U13 끄면 html 클래스가 빠진다', !cls.has(U.UI_THEME_CLASS));
}

console.log('\n── 파트② 배선 ──');
const theme = read('src/uiTheme.ts');
ok('#W1 src/uiTheme.ts는 import 0', !/^\s*import\s/m.test(theme));
const app = read('src/App.tsx');
ok('#W2 App이 uiTheme 함수를 import', /import\s*\{[^}]*isUiThemeEligible[^}]*resolveUiTheme[^}]*initialUiThemePref[^}]*writeUiThemePref[^}]*applyUiThemeToDocument[^}]*\}\s*from\s*'\.\/uiTheme'/.test(app));
const iPref = app.indexOf('const [uiThemePref, setUiThemePref] = useState(');
const iEarly = app.indexOf('const isAdminUser = authUser.email');
ok('#W3 켜짐 상태(useState)는 authUser 조기 반환보다 위에 선언(훅 순서)', iPref > 0 && iEarly > 0 && iPref < iEarly);
ok('#W4 켜짐 판정은 관리자 이메일 기준(isUiThemeEligible(authUser?.email, ADMIN_EMAIL))', /resolveUiTheme\(isUiThemeEligible\(authUser\?\.email, ADMIN_EMAIL\)/.test(app));
ok('#W5 UserInfoBar에 newUiOn·onToggleNewUi 전달', /newUiOn=\{newUiOn\}/.test(app) && /onToggleNewUi=\{toggleNewUi\}/.test(app));
ok('#W6 새 디자인 값은 App 두 곳(선언·판정)에서만 쓴다 — Drive 저장 경로에 들어가지 않는다', (app.match(/\buiThemePref\b/g) || []).length === 2);
const bar = read('src/components/UserInfoBar.tsx');
ok('#W7 UserInfoBar 버튼은 관리자에게만(isAdmin && onToggleNewUi)', /\{isAdmin && onToggleNewUi && \(/.test(bar));
const css = read('src/index.css');
const lines = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => /\[class[~*]=/.test(l));
ok('#W8 index.css의 새 디자인 규칙은 전부 html.ui-indigo 아래', lines.length > 20 && lines.every(l => /^html\.ui-indigo\s/.test(l.trim())));
ok('#W9 클래스 이름 UI_THEME_CLASS = ui-indigo 와 index.css가 일치', /UI_THEME_CLASS = 'ui-indigo'/.test(theme));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
