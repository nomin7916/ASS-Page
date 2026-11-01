#!/usr/bin/env node
// 사용자 구분 검증 — 계좌 항목의 userCategory(직접 입력)와 '자산군 | 사용자' 보기 전환(표·자산 비중 카드·리밸런싱 표).
//   src/userCategory.ts 를 **직접 import**한다(미러 금지). 런타임이 .ts를 못 읽으면 단위 검사만 건너뛴다.
//   사용자 확정(2026-11-01): 기본은 자산군, 사용자 구분을 입력하면 고를 수 있다. 빈 행은 자산군으로 묶는다.
//   구분은 종목마다 하나 — 구분·사용자 구분을 고치면 다른 계좌의 같은 종목에도 쓰고, 빈 종목은 다른 계좌 값을 따른다.
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
  const { normalizeUserCategory: norm, normalizeCategoryView: view, baseCategoryOf: base, groupCategoryOf: group, userCategoryList: list, userCategoryColor: color, USER_CATEGORY_MAX,
    shareKeyOf: key, sharedUserCategoryMap: smap, effectiveUserCategory: eff, applySharedCategory: apply, sharedCategoryOf: scat, inheritSharedCategory: inherit,
    userCategoryNames: names, assetClassOfCategory: acls } = U;

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

  console.log('\n── 파트⑥ 종목 공유(다른 계좌의 같은 종목) ──');
  eq('#K1 같은 종목 키: 종류 + 대문자 코드, 앞자리 0 무시', [key({ type: 'stock', code: '0241d0' }), key({ type: 'stock', code: '241D0' }), key({ type: 'stock', code: ' 005930 ' })], ['stock:241D0', 'stock:241D0', 'stock:5930']);
  eq('#K2 코드 없음·예적금·예수금 → 키 없음(그 행에만 쓴다)', [key({ type: 'stock', code: '' }), key({ type: 'savings', code: 'X' }), key({ type: 'deposit' }), key(null)], ['', '', '', '']);
  eq('#K3 펀드와 주식은 같은 코드라도 다른 종목', key({ type: 'fund', code: 'A1' }) !== key({ type: 'stock', code: 'A1' }), true);
  eq('#K4 D/S 규칙 = 구분 칸과 같다', [acls('채권'), acls('현금'), acls('예수금'), acls('주식'), acls('금')], ['S', 'S', 'S', 'D', 'D']);

  const P = () => [
    { id: 'irp', accountType: 'dc-irp', portfolio: [
      { id: 'i1', type: 'stock', code: '0043B0', category: '주식', assetClass: 'D', userCategory: '현금성' },
      { id: 'i2', type: 'stock', code: '069500', category: '주식', assetClass: 'D' },
      { id: 'i3', type: 'savings', category: '예적금', userCategory: '' },
    ] },
    { id: 'isa', accountType: 'isa', portfolio: [
      { id: 's1', type: 'stock', code: '43B0', category: '주식' },
      { id: 's2', type: 'stock', code: '069500', category: '채권', userCategory: '성장' },
      { id: 's3', type: 'fund', code: '069500', category: 'FUND' },
    ] },
    { id: 'old', accountType: 'isa', deletedAt: '2026-10-01', portfolio: [
      { id: 'd1', type: 'stock', code: '0043B0', category: '금', userCategory: '삭제계좌값' },
    ] },
  ];
  {
    const m = smap(P());
    eq('#S4 공유 맵: 처음 입력된 값, 삭제 계좌 제외', m, { 'stock:43B0': '현금성', 'stock:69500': '성장' });
    eq('#S5 빈 종목은 다른 계좌 값을 따른다(앞자리 0 다른 코드 포함)', eff(P()[1].portfolio[0], m), '현금성');
    eq('#S6 자기 값이 있으면 자기 값', eff({ type: 'stock', code: '0043B0', userCategory: '내값' }, m), '내값');
    eq('#S7 같은 코드라도 펀드는 주식 값을 따르지 않는다', eff(P()[1].portfolio[2], m), '');
    eq('#S8 사용자 보기 묶음도 공유 값을 쓴다', [group(P()[1].portfolio[0], 'user', m), group(P()[1].portfolio[0], 'asset', m)], ['현금성', '주식']);
    eq('#S9 이름 목록: 공유 값 먼저 + 이 계좌 값, 중복 없음', names([{ type: 'stock', code: 'ZZ', userCategory: '배당' }, { type: 'stock', code: '0043B0' }], m), ['현금성', '성장', '배당']);
  }
  {
    const before = P();
    const after = apply(before, 'isa', 's1', 'userCategory', '  현금  ');
    eq('#A1 사용자 구분 → 원래 행 + 다른 계좌 같은 종목(정규화)', [after[1].portfolio[0].userCategory, after[0].portfolio[0].userCategory], ['현금', '현금']);
    eq('#A2 다른 종목·예적금은 그대로', [after[0].portfolio[1].userCategory, after[0].portfolio[2].userCategory], [undefined, '']);
    eq('#A3 삭제된 계좌는 건드리지 않는다', after[2], before[2]);
    eq('#A4 펀드(같은 코드)는 건드리지 않는다', after[1].portfolio[2], before[1].portfolio[2]);
    ok('#A5 원본 배열을 바꾸지 않는다(불변)', before[0].portfolio[0].userCategory === '현금성' && before[1].portfolio[0].userCategory === undefined);
  }
  {
    const before = P();
    const after = apply(before, 'isa', 's1', 'category', '현금');
    eq('#A6 구분(자산군)도 다른 계좌 같은 종목에 쓴다', [after[1].portfolio[0].category, after[0].portfolio[0].category], ['현금', '현금']);
    eq('#A7 dc-irp 대상 행은 D/S도 구분 규칙대로(현금 → S)', after[0].portfolio[0].assetClass, 'S');
    eq('#A8 원래 행의 D/S는 건드리지 않는다(구분 칸이 직접 쓴다)', after[1].portfolio[0].assetClass, undefined);
  }
  {
    const before = P();
    eq('#A9 바뀐 것이 없으면 같은 배열(저장 안 함)', apply(before, 'irp', 'i1', 'category', '주식') === before, true);
    eq('#A9b 다른 계좌 값이 다르면 그 계좌도 맞춘다(종목마다 하나)', apply(before, 'irp', 'i2', 'category', '주식')[1].portfolio[1].category, '주식');
    eq('#A10 공유 필드가 아니면 그대로', apply(before, 'irp', 'i2', 'name', 'x') === before, true);
    eq('#A11 없는 행이면 그대로', apply(before, 'irp', 'nope', 'category', '금') === before, true);
    const cleared = apply(before, 'irp', 'i1', 'userCategory', '');
    eq('#A12 지우기도 모든 계좌에 — 공유 값이 사라진다', [cleared[0].portfolio[0].userCategory, smap(cleared)['stock:43B0']], ['', undefined]);
    const sv = apply(before, 'irp', 'i3', 'userCategory', '정기예금');
    eq('#A13 코드 없는 행(예적금)은 그 행에만', [sv[0].portfolio[2].userCategory, sv[1], sv[0].portfolio[0]], ['정기예금', before[1], before[0].portfolio[0]]);
  }
  {
    const base = P();
    const added = base.map(p => (p.id !== 'isa' ? p : { ...p, portfolio: [...p.portfolio, { id: 'n1', type: 'stock', code: '0043b0', category: '주식' }] }));
    eq('#I1 다른 행의 같은 종목 구분(자기 제외)', [scat(added, { type: 'stock', code: '43B0' }, 'n1'), scat(added, { type: 'stock', code: 'NONE' })], ['주식', '']);
    const c1 = apply(added, 'irp', 'i1', 'category', '현금');
    const inh = inherit(c1, 'isa', 'n1');
    eq('#I2 새 종목이 이미 공유로 맞춰졌으면 그대로', inh === c1, true);
    const fresh = base.map(p => (p.id !== 'irp' ? p : { ...p, portfolio: [...p.portfolio, { id: 'n2', type: 'stock', code: '069500', category: '주식', assetClass: 'D' }] }));
    const inh2 = inherit(fresh, 'irp', 'n2');
    const n2 = inh2[0].portfolio.find(x => x.id === 'n2');
    eq('#I3 새 종목이 다른 행 구분을 이어받는다(dc-irp면 D/S도)', [n2.category, n2.assetClass], ['주식', 'D']);
    const fresh3 = base.map(p => (p.id !== 'irp' ? p : { ...p, portfolio: [...p.portfolio, { id: 'n3', type: 'stock', code: '43B0', category: '주식', assetClass: 'D' }] }));
    const c3 = apply(fresh3, 'isa', 's1', 'userCategory', 'x');
    const fresh4 = c3.map(p => (p.id !== 'isa' ? p : { ...p, portfolio: p.portfolio.map(x => (x.id === 's1' ? { ...x, category: '현금' } : x)) }));
    const fresh5 = fresh4.map(p => (p.id !== 'irp' ? p : { ...p, portfolio: p.portfolio.map(x => (x.id === 'i1' ? { ...x, category: '현금' } : x)) }));
    const n3 = inherit(fresh5, 'irp', 'n3')[0].portfolio.find(x => x.id === 'n3');
    eq('#I4 현금으로 구분된 종목을 새로 넣으면 현금 + S', [n3.category, n3.assetClass], ['현금', 'S']);
    eq('#I5 삭제 계좌의 값은 이어받지 않는다', scat([base[2]], { type: 'stock', code: '0043B0' }), '');
  }
}

console.log('\n── 파트⑤ 배선 가드 ──');
{
  const mod = read('src/userCategory.ts');
  ok('#W1 userCategory.ts 에 import 0 (Node 직접 실행 규약)', !/^\s*import\s/m.test(mod));

  const st = stripComments(read('src/hooks/usePortfolioState.ts'));
  // ⚠️ 이 분기가 빠지면 사용자 구분이 cleanNum을 타 '성장' → 0으로 저장되고(입력 즉시 유실), 다른 계좌로 퍼지지도 않는다.
  ok('#W2 handleUpdateFor: 구분·사용자 구분은 전 계좌 공유 쓰기로', /if \(SHARED_CATEGORY_FIELDS\.includes\(field\)\) \{ setPortfolios\(prev => applySharedCategory\(prev, pid, id, field, value\)\); return; \}/.test(st)
    && /import\s*\{[^}]*\bSHARED_CATEGORY_FIELDS\b[^}]*\bapplySharedCategory\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(st));
  ok('#W2b 새 종목 상속 setter', /const inheritSharedCategoryFor = \(pid, id\) => setPortfolios\(prev => inheritSharedCategory\(prev, pid, id\)\);/.test(st) && /\binheritSharedCategory\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(st));
  ok('#W3 보기 setter + normalizeCategoryView import', /setCategoryViewFor\s*=/.test(st) && /import\s*\{[^}]*\bnormalizeCategoryView\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(st));

  const app = stripComments(read('src/App.tsx'));
  const keyStart = app.indexOf('const portfolioStructureKey = JSON.stringify([');
  const keyBody = keyStart >= 0 ? app.slice(keyStart, app.indexOf('rebalExtraKey,', keyStart)) : '';
  // ⚠️ 지문에서 빠지면 사용자 구분만 고친 조용한 세션은 portfolioUpdatedAt이 안 올라 STATE 저장이 스킵된다.
  ok('#W4 Drive 지문: 항목 userCategory', /userCategory:\s*item\.userCategory/.test(keyBody));
  ok('#W5 Drive 지문: 계좌 categoryViewTable·categoryViewSummary·categoryViewRebal', /categoryViewTable:\s*p\.categoryViewTable/.test(keyBody) && /categoryViewSummary:\s*p\.categoryViewSummary/.test(keyBody) && /categoryViewRebal:\s*p\.categoryViewRebal/.test(keyBody));
  ok('#W6 정렬: userCategory 키(공유 값 포함) + groupCategoryOf import', /k\s*===\s*'userCategory'\)\s*return\s+groupCategoryOf\(item,\s*'user',\s*totals\.sharedUserCats\)/.test(app) && /import\s*\{[^}]*\bgroupCategoryOf\b[^}]*\}\s*from\s*'\.\/userCategory'/.test(app));
  ok('#W6b 새 종목 상속: 코드 변경 → inheritSharedCategoryFor, 붙여넣기 → sharedCategoryOf', /onCodeChanged=\{\(id\) => inheritSharedCategoryFor\(activePortfolioId, id\)\}/.test(app)
    && /categoryForCode=\{\(code\) => sharedCategoryOf\(portfolios, \{ type: 'stock', code \}\)\}/.test(app) && /import\s*\{[^}]*\bsharedCategoryOf\b[^}]*\}\s*from\s*'\.\/userCategory'/.test(app));
  ok('#W7 카드 창 커맨드 setCategoryView 처리', /case\s+'setCategoryView':/.test(app));
  ok('#W8 표·자산 비중 카드에 보기 props 전달', /categoryView=\{categoryViewTable\}/.test(app) && /onCategoryViewChange=\{setCategoryViewTable\}/.test(app)
    && /categoryView=\{categoryViewSummary\}/.test(app) && /onCategoryViewChange=\{setCategoryViewSummary\}/.test(app)
    && /categoryView=\{categoryViewRebal\}/.test(app) && /onCategoryViewChange=\{setCategoryViewRebal\}/.test(app));
  ok('#W8b 카드 창 커맨드 대상에 rebal', /a\.target !== 'rebal'/.test(app));

  const cw = stripComments(read('src/cardWindow.ts'));
  ok('#W9 CARD_OPS에 setCategoryView', /'setCategoryView'/.test(cw));
  const cwin = stripComments(read('src/components/CardWindow.tsx'));
  ok('#W10 카드 창 자산 비중·리밸런싱 → setCategoryView', /fire\('setCategoryView',\s*\{\s*pid:\s*PID,\s*target:\s*'summary'/.test(cwin) && /fire\('setCategoryView',\s*\{\s*pid:\s*PID,\s*target:\s*'rebal'/.test(cwin));
  // ⚠️ 창은 계좌 하나만 받는다 — 공유 맵을 안 실으면 창의 사용자 보기에서 다른 계좌 구분이 빠진다.
  const feed = stripComments(read('src/components/CardWinFeed.tsx'));
  ok('#W10b 피더가 공유 맵을 싣는다(import·payload·deps)', /import\s*\{[^}]*\bsharedUserCategoryMap\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(feed)
    && /sharedUserCats: JSON\.parse\(sharedUserCatsKey\)/.test(feed) && /histPeriod, sharedUserCatsKey\]\)/.test(feed));
  ok('#W10c 창이 받은 맵을 usePortfolioData에 넘긴다', /setSharedUserCats\(d\.sharedUserCats\)/.test(cwin) && /rebalExtraQty,\s*sharedUserCats,\s*\}\);/.test(cwin));

  const data = stripComments(read('src/hooks/usePortfolioData.ts'));
  ok('#W11 usePortfolioData: groupCategoryOf import + 공유 맵으로 userCats', /import\s*\{[^}]*\bgroupCategoryOf\b[^}]*\bsharedUserCategoryMap\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(data)
    && /\buserCats,/.test(data) && /groupCategoryOf\(item,\s*'user',\s*sharedCats\)/.test(data) && /sharedUserCats: sharedCats/.test(data)
    && /marketIndicators\.usdkrw, sharedCats\]\)/.test(data));

  const tbl = stripComments(read('src/components/PortfolioTable.tsx'));
  ok('#W12 PortfolioTable: userCategory 모듈 import + 사용자 칸 3종(종목·펀드·예적금) 모두 공유 맵', /import\s*\{[^}]*\beffectiveUserCategory\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(tbl)
    && (tbl.match(/<UserCategoryCell\b/g) || []).length === 3 && (tbl.match(/shared=\{sharedUserCats\}/g) || []).length === 3 && /const cur = effectiveUserCategory\(item, shared\)/.test(tbl));
  ok('#W12b PortfolioTable: 코드가 바뀌었을 때만 onCodeChanged', /if \(onCodeChanged && was\?\.id === item\.id && String\(was\.code \?\? ''\)\.trim\(\)\.toUpperCase\(\) !== e\.target\.value\.trim\(\)\.toUpperCase\(\)\) onCodeChanged\(item\.id\)/.test(tbl));
  const paste = stripComments(read('src/components/PasteModal.tsx'));
  ok('#W12c 붙여넣기 새 종목도 같은 종목 구분을 이어받는다', /category: \(categoryForCode && categoryForCode\(cols\[0\]\.trim\(\)\)\) \|\| '주식'/.test(paste));
  const rb = stripComments(read('src/components/RebalancingPanel.tsx'));
  ok('#W15 리밸런싱 표: 구분 이름은 rbCatOf 한 곳(자산군 직접 읽기 0)', /const rbCatOf = \(item\) => \(isUserCatView \? effectiveUserCategory\(item, rbSharedUserCats\) : ''\) \|\| item\.category \|\| '기타';/.test(rb)
    && !/(item|it)\.category \|\| '기타'/.test(rb.replace(/const rbCatOf[^\n]*\n/, '')) && (rb.match(/rbCatOf\(/g) || []).length >= 3
    && /import\s*\{[^}]*\beffectiveUserCategory\b[^}]*\}\s*from\s*'\.\.\/userCategory'/.test(rb));
  ok('#W16 리밸런싱 표: 사용자 보기 묶음은 이름순 + 칩·표가 같은 묶음 함수', /if \(isUserCatView\) order\.sort\(\(a, b\) => a\.localeCompare\(b, 'ko', \{ numeric: true \}\)\);/.test(rb)
    && /const \{ order, g \} = rbGroupBy\(data\);/.test(rb) && /const \{ order: catOrder, g: grouped \} = rbGroupBy\(rebalanceData\);/.test(rb));
  ok('#W17 리밸런싱 표: 보기 전환 → 묶음 정렬로', /onCategoryViewChange\(m\);\s*if \(rebalanceSortConfig\?\.key != null\) handleRebalanceSort\(null\);/.test(rb) && /import CategoryViewSwitch from '\.\/CategoryViewSwitch';/.test(rb));
  ok('#W13 PortfolioTable: 사용자 칸은 정규화 후 쓴다', /onUpdate\(item\.id,\s*'userCategory',\s*next\)/.test(tbl) && /const next = normalizeUserCategory\(v\)/.test(tbl));

  const sum = stripComments(read('src/components/PortfolioSummaryPanel.tsx'));
  ok('#W14 자산 비중 카드: 보기에 따라 cats/userCats 선택', /isUserView\s*\?\s*totals\.userCats\s*:\s*totals\.cats/.test(sum) && !/totals\.cats\)\.map/.test(sum));
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
