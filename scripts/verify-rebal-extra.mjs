#!/usr/bin/env node
// 리밸런싱 '추가' 수량 · '추가 가능' 연동 영속화 검증.   실행: npm run verify:rebal-extra
//
// 발단(사용자 보고 2026-09): 목표비중·목표금액은 저장되는데 '추가' 수량과 '추가 가능' 클릭으로
//   채운 값은 앱을 닫았다 열면 사라졌다. 수량은 App state(계좌 전환용 ref 보존뿐), 연동은
//   RebalancingPanel 로컬 state라 **저장 경로가 아예 없었다**.
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

if (U) {
  const { normalizeRebalExtraQtyMap: NQ, normalizeRebalLinkMap: NL, rebalExtraIntentKey: K, updateRebalAcctMap: UP } = U;

  // ── normalizeRebalExtraQtyMap ──
  eq('#1 정상 정수는 그대로', S(() => NQ({ p1: { a: 3, b: -2 } })), { p1: { a: 3, b: -2 } });
  // ⚠️ 문자열을 통과시키면 `(수량 + action + extra) × 가격`이 문자열 결합이 되어 표 전체가 오염된다.
  eq('#2 문자열·불리언·null·객체는 버린다', S(() => NQ({ p1: { a: '3', b: true, c: null, d: {}, e: 4 } })), { p1: { e: 4 } });
  eq('#3 NaN·Infinity는 버린다 (JSON 왕복에서 null이 된다)', S(() => NQ({ p1: { a: NaN, b: Infinity, c: -Infinity, d: 1 } })), { p1: { d: 1 } });
  eq('#4 0은 저장하지 않는다 (추가 없음과 같다)', S(() => NQ({ p1: { a: 0, b: -0 }, p2: { c: 5 } })), { p2: { c: 5 } });
  eq('#5 소수는 0 방향 버림 (UI는 정수만 만든다)', S(() => NQ({ p1: { a: 2.9, b: -2.9 } })), { p1: { a: 2, b: -2 } });
  eq('#6 손상된 최상위·계좌 슬라이스는 빈 결과', S(() => [NQ(null), NQ(undefined), NQ([1, 2]), NQ('x'), NQ(3), NQ({ p1: [1], p2: 'x', p3: null })]), [{}, {}, {}, {}, {}, {}]);
  {
    const once = S(() => NQ({ p1: { a: 3, b: '2', c: 0 } }));
    eq('#7 멱등', S(() => NQ(once)), once);
  }

  // ── normalizeRebalLinkMap ──
  eq('#8 true만 남긴다', S(() => NL({ p1: { a: true, b: 'true', c: 1, d: false, e: null } })), { p1: { a: true } });
  eq('#9 손상값 방어', S(() => [NL(null), NL([]), NL({ p1: 'x' }), NL({ p1: {} })]), [{}, {}, {}, {}]);

  // ── rebalExtraIntentKey — 저장 트리거 지문 ──
  const qBase = { p1: { a: 3, b: 7 } };
  const lBase = { p1: { b: true } };
  const kBase = S(() => K(qBase, lBase));
  // ⚠️ 이 기능의 최대 위험: 연동 행은 유지 effect가 시세·잔액마다 다시 채운다 → 지문에 들어가면 저장 폭주.
  eq('#10 연동 행의 수량이 바뀌어도 지문은 그대로 (시세마다 Drive 저장 금지)', S(() => K({ p1: { a: 3, b: 912 } }, lBase)), kBase);
  ok('#11 수동 행의 수량이 바뀌면 지문이 바뀐다 (그래야 저장된다)', S(() => K({ p1: { a: 4, b: 7 } }, lBase)) !== kBase);
  ok('#12 연동 켜기/끄기가 지문을 바꾼다', S(() => K(qBase, {})) !== kBase && S(() => K(qBase, { p1: { a: true, b: true } })) !== kBase);
  eq('#13 수동 행 0은 없는 것과 같다', S(() => K({ p1: { a: 3, b: 7, c: 0 } }, lBase)), kBase);
  eq('#14 입력 순서와 무관 (결정적)', S(() => K({ p1: { b: 7, a: 3 } }, { p1: { b: true } })), kBase);
  ok('#15 같은 종목 id라도 계좌가 다르면 다른 지문', S(() => K({ p2: { a: 3 } }, {})) !== S(() => K({ p1: { a: 3 } }, {})));
  eq('#16 빈 맵은 빈 문자열', S(() => [K({}, {}), K(null, null), K({ p1: {} }, { p1: {} })]), ['', '', '']);
  // ⚠️ 이 지문은 저장 effect 첫 블록에서 계산된다 — 던지면 그 세션 Drive 저장이 통째로 멈춘다.
  {
    const circ = { p1: { a: 1 } }; circ.self = circ;
    const r = S(() => [K(circ, null), K({ p1: 'x' }, { p1: 3 }), K([], 'x'), K({ p1: { a: 1 } }, { p1: [true] })]);
    ok('#17 손상값에서도 던지지 않는다', Array.isArray(r) && r.every(v => typeof v === 'string'));
  }
  ok('#17b 연동 행만 있는 계좌도 지문에 남는다 (연동 자체가 의도다)', S(() => K({}, { p1: { a: true } })) !== '');

  // ── updateRebalAcctMap — App setter 리듀서 ──
  const EMPTY = Object.freeze({});
  const m0 = { p1: { a: 1 }, p2: { z: 9 } };
  {
    const r = S(() => UP(m0, 'p1', prev => prev));
    ok('#18 updater가 prev를 돌려주면 **같은 참조** (연동 유지 effect 루프 방지)', r === m0);
  }
  {
    const r = S(() => UP(m0, 'p1', prev => ({ ...prev, b: 2 })));
    eq('#19 해당 계좌만 바뀐다', r, { p1: { a: 1, b: 2 }, p2: { z: 9 } });
    ok('#19b 다른 계좌 슬라이스는 참조 보존', r && r.p2 === m0.p2);
    ok('#19c 원본 맵은 변형하지 않는다', JSON.stringify(m0) === JSON.stringify({ p1: { a: 1 }, p2: { z: 9 } }));
  }
  {
    let seen = null;
    const r = S(() => UP(m0, 'p9', prev => { seen = prev; return prev; }, EMPTY));
    ok('#20 없는 계좌는 빈 슬라이스(고정 참조)로 시작하고, 그대로면 맵도 그대로', seen === EMPTY && r === m0);
  }
  eq('#21 값 직접 전달도 지원', S(() => UP({}, 'p1', { a: 5 })), { p1: { a: 5 } });
  {
    const r = S(() => [UP(m0, null, { a: 1 }), UP(m0, '', { a: 1 }), UP(m0, undefined, p => ({ ...p, x: 1 }))]);
    ok('#22 계좌 id가 없으면 아무것도 쓰지 않는다 (null 키 슬라이스 금지)', Array.isArray(r) && r.every(v => v === m0));
  }
}

console.log('\n── 파트② 소스 텍스트 가드 (배선) ──');

const app = read('src/App.tsx');
const appNC = stripComments(app);
const panel = read('src/components/RebalancingPanel.tsx');
const panelNC = stripComments(panel);

// 1) 구조 지문 — 의도 지문만, 원시 맵은 금지
{
  const sk = between(appNC, 'const portfolioStructureKey = JSON.stringify([', 'if (portfolioStructureKey !== prevPortfolioStructureRef.current)');
  ok('#G1 portfolioStructureKey에 의도 지문(rebalExtraKey)이 들어 있다 (없으면 \'추가\'만 고친 세션이 저장 스킵)',
    sk.length > 0 && /\n\s*rebalExtraKey,\s*\n\s*\]\);/.test(sk));
  ok('#G1b ⚠️ 구조 지문에 원시 맵을 넣지 않는다 (연동 행이 시세마다 바뀌어 Drive 저장 폭주)',
    sk.length > 0 && !/rebalExtraQtyMap|rebalMaxAddLinkMap/.test(sk));
}
ok('#G2 의도 지문은 rebalExtraIntentKey가 두 맵으로 만든다',
  /const rebalExtraKey = useMemo\(\s*\(\) => rebalExtraIntentKey\(rebalExtraQtyMap, rebalMaxAddLinkMap\),\s*\[rebalExtraQtyMap, rebalMaxAddLinkMap\],\s*\);/.test(appNC));

// 2) 저장 payload + deps
{
  const lit = between(appNC, 'const state = { portfolios: currentPortfolios, activePortfolioId,', 'saveStateRef.current = state;');
  ok('#G3 STATE payload의 chartPrefs에 두 맵이 실린다', lit.length > 0 && /chartPrefs: \{[^}]*\brebalExtraQtyMap, rebalMaxAddLinkMap,/.test(lit));
  // 구간 시작은 저장 effect 고유의 디바운스 식 — 'saveAllToDrive(state);'는 파일에 여러 번 나온다.
  const deps = between(appNC, 'chartPeriodChanged ? 50 : 800);', 'ledgerSnapshots]);');
  ok('#G4 저장 effect deps에 의도 지문이 있다 (없으면 payload가 옛 값으로 남는다)', deps.length > 0 && /\brebalExtraKey\b/.test(deps));
  ok('#G4b ⚠️ deps에는 원시 맵을 넣지 않는다 (연동 행 자동 갱신마다 저장 effect 재실행)', deps.length > 0 && !/rebalExtraQtyMap|rebalMaxAddLinkMap/.test(deps));
}

// 3) 로드 2경로
{
  const asd = between(appNC, 'const applyStateData', 'applyStateDataRef.current = applyStateData');
  ok('#G5 applyStateData가 두 맵을 정규화해 복원한다',
    asd.length > 0
    && /setRebalExtraQtyMap\(normalizeRebalExtraQtyMap\(_rq\)\)/.test(asd)
    && /setRebalMaxAddLinkMap\(normalizeRebalLinkMap\(_rl\)\)/.test(asd));
  // ⚠️ 부팅에서 필드가 없어도 비우지 않으면, 같은 탭에서 다른 계정 STATE를 적용할 때 이전 사용자의 맵이 남아 저장된다.
  ok('#G5b 부팅(뷰 비보존)은 필드가 없어도 비우고, 폴링 재적용은 필드가 있을 때만',
    /if \(!preserveView \|\| _rq !== undefined\) setRebalExtraQtyMap/.test(asd)
    && /if \(!preserveView \|\| _rl !== undefined\) setRebalMaxAddLinkMap/.test(asd));
  const abd = between(appNC, 'const applyBackupData', 'applyBackupDataRef.current = applyBackupData');
  ok('#G6 applyBackupData도 두 맵을 정규화해 복원한다',
    abd.length > 0
    && /setRebalExtraQtyMap\(normalizeRebalExtraQtyMap\(stateData\.chartPrefs\.rebalExtraQtyMap\)\)/.test(abd)
    && /setRebalMaxAddLinkMap\(normalizeRebalLinkMap\(stateData\.chartPrefs\.rebalMaxAddLinkMap\)\)/.test(abd));
}

// 4) 활성 계좌 슬라이스 · setter
ok('#G7 활성 계좌 슬라이스는 고정 빈 참조로 폴백한다 (렌더마다 {} 생성 금지)',
  /const rebalExtraQty = rebalExtraQtyMap\[activePortfolioId\] \|\| EMPTY_REBAL_ROW;/.test(appNC)
  && /const rebalMaxAddLink = rebalMaxAddLinkMap\[activePortfolioId\] \|\| EMPTY_REBAL_ROW;/.test(appNC)
  && /const EMPTY_REBAL_ROW[^=]*= Object\.freeze\(\{\}\);/.test(appNC));
ok('#G8 setter는 공유 리듀서(updateRebalAcctMap)를 쓴다 (손복제하면 참조 보존 계약이 갈린다)',
  (appNC.match(/=> updateRebalAcctMap\(m, activePortfolioId, upd, EMPTY_REBAL_ROW\)/g) || []).length === 2
  && /setRebalExtraQtyMap\(m => updateRebalAcctMap\(/.test(appNC)
  && /setRebalMaxAddLinkMap\(m => updateRebalAcctMap\(/.test(appNC));
ok('#G9 옛 계좌 전환 보존 ref는 사라졌다 (두 메커니즘이 공존하면 전환 때 서로 덮는다)',
  !/accountRebalExtraQtyRef|rebalExtraQtyRef/.test(appNC));
ok('#G10 App이 연동 상태를 패널에 넘긴다',
  /maxAddLink=\{rebalMaxAddLink\}/.test(appNC) && /setMaxAddLink=\{setRebalMaxAddLink\}/.test(appNC)
  && /rebalExtraQty=\{rebalExtraQty\}/.test(appNC) && /setRebalExtraQty=\{setRebalExtraQty\}/.test(appNC));

// 5) 패널
ok('#G11 패널은 전달받은 연동 상태를 우선 쓴다 (로컬 state로 되돌리면 앱을 다시 열 때 연동이 풀린다)',
  /maxAddLink: maxAddLinkProp = null,/.test(panelNC) && /setMaxAddLink: setMaxAddLinkProp = null,/.test(panelNC)
  && /const maxAddLink = maxAddLinkProp \|\| localMaxAddLink;/.test(panelNC)
  && /const setMaxAddLink = setMaxAddLinkProp \|\| setLocalMaxAddLink;/.test(panelNC));
ok('#G11b 패널 로컬 전용 연동 state가 되살아나지 않았다',
  !/const \[maxAddLink, setMaxAddLink\] = useState\(/.test(panelNC));
ok('#G12 \'추가 가능\' 클릭·직접 입력·유지 effect가 그 setter를 쓴다',
  /const toggleMaxAddLink = \(id, capacity\) => \{[\s\S]{0,200}?setMaxAddLink\(prev =>/.test(panelNC)
  && /if \(maxAddLink\[item\.id\]\) setMaxAddLink\(prev =>/.test(panelNC)
  && /\}, \[rebalanceData, rebalBalance, maxAddLink, rebalExtraQty, setRebalExtraQty\]\);/.test(panelNC));

console.log(`\n  총 ${pass + fail}건 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
