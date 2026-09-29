#!/usr/bin/env node
// 입출금 내역 표 = 날짜순 누적 합계 · 최신 날짜 우선 표시 검증.   실행: npm run verify:deposit-ledger
//
// 발단(사용자 보고 2026-09): 9/29 입금을 먼저 적고 과거 8/26 입금을 나중에 적으면 표가 8/26 → 9/29
//   순으로 뜨고, 일자로 정렬해도 **총합계가 나중에 적은 8/26 행에** 찍혔다. 합계를 저장 배열
//   (= 입력 순서) 순서대로 쌓았기 때문이다. 출금 내역도 같은 코드라 같은 증상이었다.
//
// 구성 ①  src/utils.ts 를 **직접 import** 해 순수 함수를 테스트한다(미러 금지).
// 구성 ②  소스 텍스트 가드 — 배선은 산술로 표현할 수 없다. **선언이 아니라 사용부**를 단언한다.
//        실패 시 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
// 단언이 던지면 스크립트가 죽어 요약 줄이 안 나오고, 변이 하네스가 그것을 '검출'로 위장한다 → 예외는 그 케이스의 실패로.
const S = (fn) => { try { return fn(); } catch (e) { return { __threw: String(e && e.message || e) }; } };

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? '' : s.slice(i, j);
};

console.log('\n── 파트① 순수 함수 (src/utils.ts 직접 import) ──');

let U = null;
try {
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
} catch (e) {
  if (e && e.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
    console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  } else {
    fail++;
    console.log(`  ✗ src/utils.ts 로드 실패 — ${e && (e.code || e.message)}`);
  }
}

// 저장 배열은 새 행을 **앞에** 붙인다(DepositPanel `[newLedgerRow(), ...history]`) → 인덱스 0 = 가장 나중에 입력한 행.
const row = (id, date, amount, extra = {}) => ({ id, date, amount, memo: '', noPrincipal: false, ...extra });
const view = (rows) => rows.map(r => [r.id, r.date, r.cumulative]);

if (U) {
  const { ledgerRowsWithRunningSum: W, sortLedgerRows: SO } = U;

  // ── 사용자 보고 그대로: 9/29를 먼저 적고 8/26을 나중에 적음 ──
  const user = [row('b', '2026-08-26', 200000), row('a', '2026-09-29', 300000)];
  eq('#1 최신 날짜가 맨 위 · 총합계는 최신 날짜 행에', S(() => view(W(user))),
    [['a', '2026-09-29', 500000], ['b', '2026-08-26', 200000]]);

  // ── 스크린샷 재현: 08/06을 가장 나중에 입력 ──
  const shot = [
    row('r4', '2026-08-06', 300000),
    row('r1', '2026-09-09', 300000),
    row('r3', '2026-07-03', 300000),
    row('r2', '2026-06-05', 300000),
  ];
  eq('#2 스크린샷: 09/09=1,200,000 → 08/06=900,000 → 07/03=600,000 → 06/05=300,000', S(() => view(W(shot))),
    [['r1', '2026-09-09', 1200000], ['r4', '2026-08-06', 900000], ['r3', '2026-07-03', 600000], ['r2', '2026-06-05', 300000]]);
  // 옛 코드가 실제로 틀렸는지(= 이 테스트가 죽은 단언이 아닌지) — 입력 순서 누적을 재현해 비교한다.
  const legacy = [...shot].reverse().reduce((acc, h) => { const s = (acc.length ? acc[acc.length - 1].cumulative : 0) + h.amount; acc.push({ ...h, cumulative: s }); return acc; }, []).reverse();
  ok('#2b 입력 순서로 쌓으면 총합계가 08/06에 찍힌다 (옛 결함 재현 — 이 대조가 있어야 #2가 의미를 갖는다)',
    legacy[0].id === 'r4' && legacy[0].cumulative === 1200000 && legacy[1].id === 'r1' && legacy[1].cumulative === 900000);

  // ── originalIndex = 저장 배열 위치 (편집은 이것으로 저장 배열을 가리킨다) ──
  const r2 = S(() => W(shot));
  ok('#3 originalIndex가 저장 배열의 그 행을 가리킨다', Array.isArray(r2) && r2.every(r => shot[r.originalIndex].id === r.id));
  ok('#3b 입력 배열을 변형하지 않는다', shot[0].id === 'r4' && !('cumulative' in shot[0]) && shot.length === 4);

  // ── 같은 날짜: 먼저 입력한 행부터 누적(= 종전 동작과 같다) ──
  const sameDay = [row('late', '2026-09-01', 50), row('early', '2026-09-01', 100), row('old', '2026-08-01', 10)];
  eq('#4 같은 날짜는 먼저 입력한 행부터 쌓고, 표시는 나중 입력이 위', S(() => view(W(sameDay))),
    [['late', '2026-09-01', 160], ['early', '2026-09-01', 110], ['old', '2026-08-01', 10]]);

  // ── 미반영(noPrincipal)은 더하지 않되 행은 남긴다 ──
  const np = [row('x', '2026-09-10', 999, { noPrincipal: true }), row('y', '2026-09-01', 100), row('z', '2026-09-20', 5)];
  eq('#5 미반영 행은 합계에 넣지 않는다 (행은 표시)', S(() => view(W(np))),
    [['z', '2026-09-20', 105], ['x', '2026-09-10', 100], ['y', '2026-09-01', 100]]);

  // ── 원화 행은 달러와 따로 쌓는다 ──
  const krw = [row('k2', '2026-09-05', 2000000, { currency: 'KRW' }), row('u2', '2026-09-03', 20), row('k1', '2026-09-02', 1000000, { currency: 'KRW' }), row('u1', '2026-09-01', 10)];
  const kr = S(() => W(krw));
  eq('#6 달러 누적은 원화 행을 섞지 않는다', Array.isArray(kr) ? kr.map(r => [r.id, r.cumulative]) : kr,
    [['k2', 30], ['u2', 30], ['k1', 10], ['u1', 10]]);
  eq('#6b 원화 누적은 달러 행을 섞지 않는다', Array.isArray(kr) ? kr.map(r => [r.id, r.cumulativeKrw]) : kr,
    [['k2', 3000000], ['u2', 1000000], ['k1', 1000000], ['u1', 0]]);

  // ── 날짜 없는 행 = 가장 오래된 것(맨 아래) ──
  const nd = [row('n', '', 7), row('d', '2026-09-01', 3)];
  eq('#7 날짜가 빈 행은 맨 아래·가장 먼저 누적', S(() => view(W(nd))), [['d', '2026-09-01', 10], ['n', '', 7]]);

  // ── 음수 정정 행은 부호 그대로 ──
  eq('#8 음수(정정) 행은 부호 그대로 누적', S(() => view(W([row('m', '2026-09-02', -40), row('p', '2026-09-01', 100)]))),
    [['m', '2026-09-02', 60], ['p', '2026-09-01', 100]]);

  // ── 손상 입력 ──
  eq('#9 배열이 아니면 빈 배열', S(() => [W(null), W(undefined), W('x')]), [[], [], []]);

  // ── 정렬 머리글 ──
  const base = S(() => W(shot));
  eq('#10 설정 없음 = 기본 순서(최신 날짜 우선)', S(() => SO(base, { key: null, direction: 1 }).map(r => r.id)), ['r1', 'r4', 'r3', 'r2']);
  eq('#10b 일자 ▼ = 기본 순서', S(() => SO(base, { key: 'date', direction: -1 }).map(r => r.id)), ['r1', 'r4', 'r3', 'r2']);
  eq('#10c 일자 ▲ = 정확한 역순 (합계가 위→아래로 증가)', S(() => SO(base, { key: 'date', direction: 1 }).map(r => [r.id, r.cumulative])),
    [['r2', 300000], ['r3', 600000], ['r4', 900000], ['r1', 1200000]]);
  const sd = S(() => W(sameDay));
  eq('#10d 같은 날짜도 ▲에서 정확히 뒤집힌다', S(() => SO(sd, { key: 'date', direction: 1 }).map(r => r.id)), ['old', 'early', 'late']);
  const amt = S(() => W([row('a1', '2026-09-01', 30), row('a2', '2026-08-01', 10), row('a3', '2026-07-01', 20)]));
  eq('#11 금액 ▲', S(() => SO(amt, { key: 'amount', direction: 1 }).map(r => r.id)), ['a2', 'a3', 'a1']);
  eq('#11b 금액 ▼', S(() => SO(amt, { key: 'amount', direction: -1 }).map(r => r.id)), ['a1', 'a3', 'a2']);
  ok('#11c 정렬은 합계를 바꾸지 않는다 (합계는 날짜 순서의 값)',
    (() => { const s = S(() => SO(amt, { key: 'amount', direction: 1 })); return Array.isArray(s) && s.find(r => r.id === 'a1').cumulative === 60 && s.find(r => r.id === 'a2').cumulative === 30 && s.find(r => r.id === 'a3').cumulative === 20; })());
  ok('#12 정렬은 입력 배열을 변형하지 않는다',
    (() => { const b = S(() => W(shot)); const before = b.map(r => r.id).join(); SO(b, { key: 'date', direction: 1 }); SO(b, { key: 'amount', direction: 1 }); return b.map(r => r.id).join() === before; })());
}

console.log('\n── 파트② 배선 가드 (소스 텍스트) ──');

const data = read('src/hooks/usePortfolioData.ts');
const dataNC = stripComments(data);
const state = stripComments(read('src/hooks/usePortfolioState.ts'));
const cardWin = stripComments(read('src/components/CardWindow.tsx'));
const panel = read('src/components/DepositPanel.tsx');
const panelNC = stripComments(panel);
const utilsNC = stripComments(read('src/utils.ts'));
const appNC = stripComments(read('src/App.tsx'));

ok('#G1 입금·출금 합계가 공유 함수를 쓴다 (한쪽만 손계산이면 두 표의 규칙이 갈린다)',
  /const depositWithSum = useMemo\(\(\) => ledgerRowsWithRunningSum\(depositHistory\), \[depositHistory\]\);/.test(dataNC)
  && /const depositWithSum2 = useMemo\(\(\) => ledgerRowsWithRunningSum\(depositHistory2\), \[depositHistory2\]\);/.test(dataNC));
ok('#G1b 입력 순서 누적(배열 reverse 후 map)이 되살아나지 않았다',
  !/\[\.\.\.depositHistory2?\]\.reverse\(\)/.test(dataNC));
ok('#G2 입금·출금 표시 정렬이 공유 함수를 쓴다',
  /const depositWithSumSorted = useMemo\(\(\) => sortLedgerRows\(depositWithSum, depositSortConfig\), \[depositWithSum, depositSortConfig\]\);/.test(dataNC)
  && /const depositWithSum2Sorted = useMemo\(\(\) => sortLedgerRows\(depositWithSum2, depositSortConfig2\), \[depositWithSum2, depositSortConfig2\]\);/.test(dataNC));
ok('#G2b usePortfolioData가 두 함수를 import한다 (사용부만 있고 import가 없으면 화면 전체가 오류)',
  /import \{[^}]*\bledgerRowsWithRunningSum\b[^}]*\} from '\.\.\/utils';/.test(data)
  && /import \{[^}]*\bsortLedgerRows\b[^}]*\} from '\.\.\/utils';/.test(data));
ok('#G2c 두 함수가 utils.ts에서 export된다',
  /export const ledgerRowsWithRunningSum = /.test(utilsNC) && /export const sortLedgerRows = /.test(utilsNC));
ok('#G3 앱 탭 기본 정렬 = 일자 최신순(▼) — 입금·출금 둘 다',
  (state.match(/useState\(\{ key: 'date', direction: -1 \}\)/g) || []).length === 2
  && !/const \[depositSortConfig2?, setDepositSortConfig2?\] = useState\(\{ key: null/.test(state));
ok('#G3b 카드 별도 창 기본 정렬도 같다',
  /const \[depositSortConfig, setDepositSortConfig\] = useState\(\{ key: 'date', direction: -1 \}\);/.test(cardWin)
  && /const \[depositSortConfig2, setDepositSortConfig2\] = useState\(\{ key: 'date', direction: -1 \}\);/.test(cardWin));
ok('#G4 표는 정렬된 결과를 렌더한다 (입금·출금)',
  /\{depositWithSumSorted\.map\(\(h\) =>/.test(panelNC) && /\{depositWithSum2Sorted\.map\(\(h\) =>/.test(panelNC));
ok('#G4b 편집은 originalIndex로 저장 배열을 가리킨다 (표시 순서 인덱스로 쓰면 다른 행이 고쳐진다)',
  (panelNC.match(/n\[h\.originalIndex\]/g) || []).length >= 8);
ok('#G5 새 행 날짜는 KST 오늘 (UTC면 한국 00~09시에 어제가 되어 날짜순 표에서 새 행이 맨 위가 아니다)',
  /date: getTodayKST\(\),/.test(between(panelNC, 'const newLedgerRow', '});'))
  && /import \{ getTodayKST \} from '\.\.\/hooks\/useMarketCalendar';/.test(panel)
  && !/toISOString/.test(between(panelNC, 'const newLedgerRow', '});')));
ok('#G6 CSV도 날짜순 합계를 쓴다 (depositWithSum 경유)',
  /buildDepositCSV\(depositWithSum\)/.test(appNC) && /buildDepositCSV\(depositWithSum2\)/.test(appNC));
ok('#G7 사용법에 합계 규칙이 적혀 있다',
  /가장 최근 날짜 행의 합계가 총합계입니다\./.test(panel) && /기본은 일자 최신순\(▼\)/.test(panel));

console.log(`\n  총 ${pass + fail}건 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
