#!/usr/bin/env node
// 사용자 구분 검증 — 계좌 항목의 userCategory(직접 입력)와 '자산군 | 사용자' 보기 전환(표·자산 비중 카드).
//   src/userCategory.ts 를 **직접 import**한다(미러 금지). 런타임이 .ts를 못 읽으면 단위 검사만 건너뛴다.
//   사용자 확정(2026-11-01): 기본은 자산군, 사용자 구분을 입력하면 고를 수 있다. 빈 행은 자산군으로 묶는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let U = null;
try { U = await import(pathToFileURL(join(ROOT, 'src/userCategory.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/userCategory.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (U) {
  const { normalizeUserCategory: norm, normalizeCategoryView: view, baseCategoryOf: base, groupCategoryOf: group, userCategoryList: list, userCategoryColor: color, USER_CATEGORY_MAX } = U;

  console.log('\n── 파트① 정규화 ──');
  eq('#N1 앞뒤 공백 제거·연속 공백 1칸', norm('  미국   성장  '), '미국 성장');
  eq('#N2 null/undefined → 빈 문자열', [norm(null), norm(undefined)], ['', '']);
  eq('#N3 숫자 → 문자열', norm(123), '123');
  eq('#N4 최대 길이로 자른다', norm('가'.repeat(USER_CATEGORY_MAX + 5)).length, USER_CATEGORY_MAX);
  eq('#V1 보기: user만 user, 나머지는 전부 asset(기본)', [view('user'), view('asset'), view(undefined), view(''), view('USER')], ['user', 'asset', 'asset', 'asset', 'asset']);

  console.log('\n── 파트② 묶음 이름 ──');
  const stock = { type: 'stock', category: '주식', userCategory: '성장' };
  const stockBlank = { type: 'stock', category: '채권', userCategory: '   ' };
  const stockNoCat = { type: 'stock', category: '' };
  const fund = { type: 'fund', category: 'FUND', userCategory: '연금' };
  const savings = { type: 'savings', category: '예적금' };
  const deposit = { type: 'deposit', category: '주식', userCategory: '현금성' };
  eq('#G1 자산군 보기 = 구분 그대로(사용자 구분 무시)', group(stock, 'asset'), '주식');
  eq('#G2 사용자 보기 = 사용자 구분', group(stock, 'user'), '성장');
  eq('#G3 사용자 구분이 공백뿐이면 자산군으로 묶는다', group(stockBlank, 'user'), '채권');
  eq('#G4 빈 구분 → 미지정(기존 usePortfolioData 규칙)', [group(stockNoCat, 'asset'), group(stockNoCat, 'user')], ['미지정', '미지정']);
  eq('#G5 펀드도 사용자 구분을 쓴다', group(fund, 'user'), '연금');
  eq('#G6 예적금 빈 사용자 구분 → 예적금', group(savings, 'user'), '예적금');
  eq('#G7 예수금 행은 어느 보기든 예수금(사용자 구분 무시)', [group(deposit, 'asset'), group(deposit, 'user')], ['예수금', '예수금']);
  eq('#G8 보기 값이 낡거나 없으면 자산군', group(stock, undefined), '주식');
  eq('#G9 base = 자산군 보기와 같다', [base(stock), base(deposit), base(null)], ['주식', '예수금', '미지정']);

  console.log('\n── 파트③ 목록·색 ──');
  const items = [
    { type: 'stock', userCategory: '성장' }, { type: 'stock', userCategory: ' 배당 ' },
    { type: 'stock', userCategory: '성장' }, { type: 'stock' }, { type: 'deposit', userCategory: '현금성' },
    { type: 'fund', userCategory: '연금' }, null,
  ];
  eq('#L1 처음 나온 순서·중복 없음·예수금 제외·공백 정규화', list(items), ['성장', '배당', '연금']);
  eq('#L2 배열이 아니면 빈 목록', list(undefined), []);
  const pal = ['#a', '#b'];
  eq('#C1 목록 순번으로 팔레트를 돈다', [color('성장', ['성장', '배당', '연금'], pal), color('배당', ['성장', '배당', '연금'], pal), color('연금', ['성장', '배당', '연금'], pal)], ['#a', '#b', '#a']);
  eq('#C2 목록에 없으면 빈 문자열', color('없음', ['성장'], pal), '');

  console.log('\n── 파트④ 자산 비중 합계 보존(두 보기의 평가 합이 같다) ──');
  {
    const rows = [
      { it: { type: 'stock', category: '주식', userCategory: '성장' }, evl: 100 },
      { it: { type: 'stock', category: '주식' }, evl: 50 },
      { it: { type: 'stock', category: '채권', userCategory: '성장' }, evl: 30 },
      { it: { type: 'deposit' }, evl: 20 },
    ];
    const sum = (v) => rows.reduce((m, r) => { const k = group(r.it, v); m[k] = (m[k] || 0) + r.evl; return m; }, {});
    const a = sum('asset'), u = sum('user');
    eq('#S1 자산군 보기 묶음', a, { '주식': 150, '채권': 30, '예수금': 20 });
    eq('#S2 사용자 보기 묶음(입력한 행만 옮겨 간다)', u, { '성장': 130, '주식': 50, '예수금': 20 });
    eq('#S3 합계 동일', Object.values(a).reduce((x, y) => x + y, 0), Object.values(u).reduce((x, y) => x + y, 0));
  }
}

console.log('\n── 파트⑤ 배선 가드 ──');
{
  const mod = read('src/userCategory.ts');
  ok('#W1 userCategory.ts 에 import 0 (Node 직접 실행 규약)', !/^\s*import\s/m.test(mod));

  const st = stripComments(read('src/hooks/usePortfolioState.ts'));
  // ⚠️ 문자열 필드 화이트리스트에서 빠지면 cleanNum이 '성장' → 0으로 저장한다(입력 즉시 유실).
  ok('#W2 handleUpdateFor 문자열 필드에 userCategory', /\[\s*'category',\s*'name',\s*'code',\s*'assetClass',\s*'userCategory'\s*\]\.includes\(field\)/.test(st));
  ok('#W3 보기 setter + normalizeCategoryView import', /setCategoryViewFor\s*=/.test(st) && /import\s*\{[^}]*\bnormalizeCategoryView\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(st));

  const app = stripComments(read('src/App.tsx'));
  const keyStart = app.indexOf('const portfolioStructureKey = JSON.stringify([');
  const keyBody = keyStart >= 0 ? app.slice(keyStart, app.indexOf('rebalExtraKey,', keyStart)) : '';
  // ⚠️ 지문에서 빠지면 사용자 구분만 고친 조용한 세션은 portfolioUpdatedAt이 안 올라 STATE 저장이 스킵된다.
  ok('#W4 Drive 지문: 항목 userCategory', /userCategory:\s*item\.userCategory/.test(keyBody));
  ok('#W5 Drive 지문: 계좌 categoryViewTable·categoryViewSummary', /categoryViewTable:\s*p\.categoryViewTable/.test(keyBody) && /categoryViewSummary:\s*p\.categoryViewSummary/.test(keyBody));
  ok('#W6 정렬: userCategory 키 + groupCategoryOf import', /k\s*===\s*'userCategory'\)\s*return\s+groupCategoryOf\(item,\s*'user'\)/.test(app) && /import\s*\{[^}]*\bgroupCategoryOf\b[^}]*\}\s*from\s*'\.\/userCategory'/.test(app));
  ok('#W7 카드 창 커맨드 setCategoryView 처리', /case\s+'setCategoryView':/.test(app));
  ok('#W8 표·자산 비중 카드에 보기 props 전달', /categoryView=\{categoryViewTable\}/.test(app) && /onCategoryViewChange=\{setCategoryViewTable\}/.test(app)
    && /categoryView=\{categoryViewSummary\}/.test(app) && /onCategoryViewChange=\{setCategoryViewSummary\}/.test(app));

  const cw = stripComments(read('src/cardWindow.ts'));
  ok('#W9 CARD_OPS에 setCategoryView', /'setCategoryView'/.test(cw));
  const cwin = stripComments(read('src/components/CardWindow.tsx'));
  ok('#W10 카드 창 자산 비중 → setCategoryView(target summary)', /fire\('setCategoryView',\s*\{\s*pid:\s*PID,\s*target:\s*'summary'/.test(cwin));

  const data = stripComments(read('src/hooks/usePortfolioData.ts'));
  ok('#W11 usePortfolioData: groupCategoryOf import + userCats 반환', /import\s*\{[^}]*\bgroupCategoryOf\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(data) && /\buserCats,/.test(data) && /groupCategoryOf\(item,\s*'user'\)/.test(data));

  const tbl = stripComments(read('src/components/PortfolioTable.tsx'));
  ok('#W12 PortfolioTable: userCategory 모듈 import + 사용자 칸 3종(종목·펀드·예적금)', /from\s*'\.\.\/userCategory'/.test(tbl) && (tbl.match(/<UserCategoryCell\b/g) || []).length === 3);
  ok('#W13 PortfolioTable: 사용자 칸은 정규화 후 쓴다', /onUpdate\(item\.id,\s*'userCategory',\s*next\)/.test(tbl) && /const next = normalizeUserCategory\(v\)/.test(tbl));

  const sum = stripComments(read('src/components/PortfolioSummaryPanel.tsx'));
  ok('#W14 자산 비중 카드: 보기에 따라 cats/userCats 선택', /isUserView\s*\?\s*totals\.userCats\s*:\s*totals\.cats/.test(sum) && !/totals\.cats\)\.map/.test(sum));
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
