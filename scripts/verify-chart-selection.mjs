#!/usr/bin/env node
// 수익률 차트 드래그 구간 선택 — '비선택 구간 딤(scrim)' 검증.
//
// 구성 ①  src/utils.ts 를 **직접 import** 해 selectionDimBands를 테스트한다(미러 금지 —
//        미러는 src에만 넣은 변경/미러에만 넣은 변경이 둘 다 통과하는 구멍을 만든다).
//        utils.ts는 import가 하나도 없어 Node가 타입만 벗겨 실행할 수 있다.
// 구성 ②  소스 텍스트 가드 — 배선·paint 순서는 산술로 표현할 수 없다.
//        **선언이 아니라 사용부**를 단언한다. 실패 시 먼저 정규식이 낡았는지 확인하고,
//        계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));

// 금지 토큰 검사는 **주석을 걷어낸 뒤** 한다 — 이 저장소는 금지 이유를 바로 그 자리 주석에
// 적으므로, 원문으로 재면 주석 속 토큰이 유령 사용으로 잡혀 가드가 영구히 실패한다.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\n── 파트① 순수 함수 selectionDimBands (src/utils.ts 직접 import) ──');

let U = null;
try {
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
} catch (e) {
  console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code || e.message}).`);
}

if (U) {
  const { selectionDimBands } = U;
  const rows = ['d1', 'd2', 'd3', 'd4', 'd5'].map(d => ({ date: d }));

  // ⚠️ 던지는 구현을 **그 케이스의 실패**로 보고하기 위한 래퍼. 직접 호출하면 예외가
  //    스크립트를 통째로 중단시켜(그 뒤 케이스가 전부 미실행) 어느 계약이 깨졌는지 알 수 없고,
  //    변이 테스트에서도 '검출됨'과 '죽은 단언'을 구분할 수 없다.
  //    (실측: 'i1 === -1' 가드를 지우면 rows[-1].date 로 TypeError가 났다.)
  const S = (...a) => { try { return selectionDimBands(...a); } catch (e) { return `__throw:${e && e.message}`; } };

  ok('#1 selectionDimBands가 export 되어 있다', typeof selectionDimBands === 'function');

  // ── 정상 선택 ──
  eq('#2 가운데 선택 → 양쪽 딤', S(rows, 'd2', 'd4'), {
    start: 'd2', end: 'd4', before: { from: 'd1', to: 'd2' }, after: { from: 'd4', to: 'd5' },
  });

  // ⚠️ 드래그는 오른쪽→왼쪽으로도 한다. 정규화하지 않으면 그쪽 드래그에서 딤이 뒤집혀
  //    **선택한 구간만 어두워진다**(의도와 정반대).
  eq('#3 역방향 드래그도 정방향과 동일(정규화)',
    S(rows, 'd4', 'd2'), S(rows, 'd2', 'd4'));

  eq('#4 왼쪽 끝에 닿으면 before 없음(폭 0 밴드 금지)', S(rows, 'd1', 'd3'), {
    start: 'd1', end: 'd3', before: null, after: { from: 'd3', to: 'd5' },
  });
  eq('#5 오른쪽 끝에 닿으면 after 없음', S(rows, 'd3', 'd5'), {
    start: 'd3', end: 'd5', before: { from: 'd1', to: 'd3' }, after: null,
  });
  eq('#6 전 구간 선택 → 딤 0개(차트 전체가 원본 밝기)', S(rows, 'd1', 'd5'), {
    start: 'd1', end: 'd5', before: null, after: null,
  });
  eq('#7 인접 두 날짜도 유효한 선택', S(rows, 'd2', 'd3'), {
    start: 'd2', end: 'd3', before: { from: 'd1', to: 'd2' }, after: { from: 'd3', to: 'd5' },
  });

  // ── null 계약 — '딤만 깔리고 선택 창은 없는(=차트 전체가 어두운)' 상태 차단 ──
  // ⚠️ ReferenceArea의 ifOverflow='discard'는 밴드마다 따로 판정하므로, 여기서 null을
  //    돌려주지 않으면 낡은 선택 날짜에서 딤 2개만 살아남아 차트가 통째로 어두워질 수 있다.
  ok('#8 같은 날짜 선택 → null', S(rows, 'd3', 'd3') === null);
  ok('#9 데이터에 없는 날짜(조회기간 변경 후 잔존) → null', S(rows, 'd2', 'zz') === null);
  ok('#9b 양쪽 다 없는 날짜 → null', S(rows, 'ya', 'zz') === null);
  ok('#10 빈 문자열(드래그 없는 단순 클릭) → null', S(rows, '', 'd3') === null);
  ok('#10b 오른쪽만 빈 문자열 → null', S(rows, 'd3', '') === null);
  ok('#11 행이 2개 미만 → null', S([{ date: 'd1' }], 'd1', 'd1') === null);
  ok('#12 rows가 null/undefined → null',
    S(null, 'a', 'b') === null && S(undefined, 'a', 'b') === null);
  ok('#13 date 없는 항목이 섞여도 던지지 않는다',
    typeof S([{}, { date: 'd2' }, null, { date: 'd4' }], 'd2', 'd4') !== 'string');

  // ── 상보성(complementarity) — 이 기능의 기하학적 핵심 ──
  // scalePoint(bandwidth 0)에서 ReferenceArea x1..x2는 '두 점의 중심 사이'를 정확히 덮는다.
  // 따라서 before/after/선택창 셋이 빈틈(딤이 안 칠해진 띠)도 겹침(두 번 칠해져 더 어두운 띠)도
  // 없이 플롯 영역을 정확히 분할해야 한다.
  let comp = true, edge = true;
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows.length; j++) {
      const r = S(rows, rows[i].date, rows[j].date);
      if (typeof r === 'string') { comp = false; continue; }
      if (i === j) { if (r !== null) comp = false; continue; }
      if (!r) { comp = false; continue; }
      const lo = Math.min(i, j), hi = Math.max(i, j);
      if (r.before && r.before.to !== r.start) comp = false;   // 왼쪽 딤은 선택 시작에서 딱 끝난다
      if (r.after && r.after.from !== r.end) comp = false;     // 오른쪽 딤은 선택 끝에서 딱 시작한다
      if (r.before && r.before.from !== rows[0].date) edge = false;
      if (r.after && r.after.to !== rows[rows.length - 1].date) edge = false;
      if ((lo > 0) !== !!r.before) comp = false;               // 끝에 닿으면 그쪽 딤은 없어야 한다
      if ((hi < rows.length - 1) !== !!r.after) comp = false;
    }
  }
  ok('#14 모든 (시작,끝) 조합에서 딤과 선택 창이 빈틈·겹침 없이 상보', comp);
  ok('#15 딤 밴드는 항상 차트 첫/마지막 날짜까지 뻗는다', edge);

  // ⚠️ 원본 배열을 건드리면(정렬 등) 차트 데이터가 뒤섞인다.
  const frozen = [{ date: 'b' }, { date: 'a' }, { date: 'c' }];
  const snapshot = JSON.stringify(frozen);
  S(frozen, 'b', 'c');
  eq('#16 입력 배열을 변형하지 않는다', JSON.stringify(frozen), snapshot);

  // ⚠️ 인덱스 기준이라 날짜가 사전순이 아니어도 '배열 순서'를 따른다(차트 X축 순서 = 배열 순서).
  eq('#17 경계는 사전순이 아니라 배열 순서로 정한다', S(frozen, 'c', 'a'), {
    start: 'a', end: 'c', before: { from: 'b', to: 'a' }, after: null,
  });
}

console.log('\n── 파트② 소스 텍스트 가드 (배선·paint 순서) ──');

const utils = read('src/utils.ts');
const design = read('src/design.ts');
const pcRaw = read('src/components/PortfolioChart.tsx');
const idRaw = read('src/components/IntegratedDashboard.tsx');
const hookRaw = read('src/hooks/useChartInteraction.ts');
const appRaw = read('src/App.tsx');
const pc = stripComments(pcRaw);
const id = stripComments(idRaw);
const hook = stripComments(hookRaw);
const app = stripComments(appRaw);

ok('#G1 utils가 selectionDimBands를 export', /export function selectionDimBands\(/.test(utils));
ok('#G1b design이 CHART_SELECTION 토큰을 export', /export const CHART_SELECTION = \{/.test(design));
ok('#G1c 딤 불투명도가 0<x<1 (0이면 안 보이고 1이면 바깥 맥락이 사라진다)',
  (() => { const m = design.match(/dimOpacity:\s*([0-9.]+)/); return !!m && +m[1] > 0 && +m[1] < 1; })());

// ── 두 차트: 딤 2개 + 선택 창 1개가 **실제로 렌더**되는가 (선언이 아니라 사용부) ──
// ⚠️ 셋 중 하나만 지워도 조용히 반쪽이 된다: before만 지우면 왼쪽이 안 어두워지고,
//    선택 창만 지우면 테두리 없이 딤만 남는다.
for (const [name, src, rows, left, right] of [
  ['PortfolioChart', pc, 'finalChartData', 'refAreaLeft', 'refAreaRight'],
  ['IntegratedDashboard', id, 'intChartData', 'intRefAreaLeft', 'intRefAreaRight'],
]) {
  ok(`#G2 ${name}: selectionDim import·memo 배선`,
    /selectionDimBands/.test(src) && /const selectionDim = useMemo\(/.test(src));
  ok(`#G2b ${name}: 왼쪽 딤 ReferenceArea 렌더`,
    /selectionDim\?\.before && <ReferenceArea[^>]*x1=\{selectionDim\.before\.from\}[^>]*x2=\{selectionDim\.before\.to\}/.test(src));
  ok(`#G2c ${name}: 오른쪽 딤 ReferenceArea 렌더`,
    /selectionDim\?\.after && <ReferenceArea[^>]*x1=\{selectionDim\.after\.from\}[^>]*x2=\{selectionDim\.after\.to\}/.test(src));
  ok(`#G2d ${name}: 선택 창 ReferenceArea 렌더`,
    /selectionDim && <ReferenceArea[^>]*x1=\{selectionDim\.start\}[^>]*x2=\{selectionDim\.end\}/.test(src));

  // ⚠️ 두 차트가 CHART_SELECTION을 **공유**해야 한다. 값을 손복제하면 같은 제스처가
  //    두 화면에서 다르게 보인다.
  ok(`#G3 ${name}: 색·불투명도를 CHART_SELECTION 토큰에서 읽는다(손복제 금지)`,
    /fill=\{CHART_SELECTION\.dimFill\}/.test(src)
    && /fillOpacity=\{CHART_SELECTION\.dimOpacity\}/.test(src)
    && /fill=\{CHART_SELECTION\.windowFill\}/.test(src)
    && /fillOpacity=\{CHART_SELECTION\.windowOpacity\}/.test(src)
    && /stroke=\{CHART_SELECTION\.windowStroke\}/.test(src));

  // ⚠️ 종전의 흰색 8~10% 하이라이트 부활 금지 — 그게 '선택이 안 보인다'의 원인이었다.
  ok(`#G3b ${name}: 옛 흰색 하이라이트 리터럴 부활 금지`,
    !/fill="rgba\(255,\s*255,\s*255,\s*0\.0?[0-9]+\)"/.test(src));

  // ⚠️ `ifOverflow` 기본값은 'discard'다 — `ScaleHelper.isInRange`가 epsilon 없이 `>=`/`<=`로
  //    재는데, d3 scalePoint의 `start += (stop-start-step*(n-1))*align` 잔차 때문에
  //    `scale(첫 날짜)`가 `range()[0]`보다 ~1e-13 작아지는 폭이 존재한다. 그러면 첫/마지막
  //    날짜를 x1/x2로 쓰는 **딤 밴드가 통째로 discard**돼 한쪽만 어두워진다(실측: 1년치 366행에서
  //    폭 534종 중 46종 ≈8.6%, 2년치 730행에서 8.1%. 리사이즈로 나타났다 사라지는 간헐 증상).
  //    선택 창도 첫 날짜에서 시작하면 같이 사라진다. 'hidden'은 discard 분기를 건너뛰고 clip만
  //    적용하므로 **정상 케이스 픽셀은 완전히 동일**하다(실측 148건 전수 대조).
  //    ⚠️ 밴드 **하나씩** 검사한다 — 개수만 세면 한 밴드에서 빼고 다른 곳에 붙여도 통과한다.
  const bands = src.split('\n').filter(l => /selectionDim[^\n]*<ReferenceArea/.test(l));
  ok(`#G3c ${name}: 3개 밴드 모두 ifOverflow="hidden" (경계 날짜 discard 방지)`,
    bands.length === 3 && bands.every(l => /ifOverflow="hidden"/.test(l)));

  // ⚠️ paint 순서 = 선언 순서(recharts renderByOrder). ReferenceArea의 isFront prop은
  //    2.x에서 무시되므로 **선언 위치가 유일한 수단**이다. 딤이 데이터 선보다 앞에 선언되면
  //    선 뒤에 깔려 아무것도 어두워지지 않는다.
  const lastSeries = Math.max(src.lastIndexOf('<Area '), src.lastIndexOf('<Line '));
  const dimAt = src.indexOf('CHART_SELECTION.dimFill');
  ok(`#G4 ${name}: 딤이 모든 <Area>/<Line> **뒤**에 선언(선 위에 덮인다)`,
    lastSeries > 0 && dimAt > lastSeries);

  // ⚠️ 선택 창은 딤보다 뒤 — 테두리가 딤에 먹히지 않게.
  ok(`#G4b ${name}: 선택 창이 딤 2개보다 뒤에 선언`,
    src.indexOf('CHART_SELECTION.windowStroke') > src.lastIndexOf('CHART_SELECTION.dimOpacity'));

  // ⚠️ Fragment로 묶지 말 것 — recharts는 자식을 renderByOrder로 훑는다. 형제/배열이 안전한
  //    형태이고, 이 저장소의 다른 차트 요소도 전부 그 형태다.
  ok(`#G5 ${name}: ReferenceArea 3개를 Fragment로 감싸지 않는다`,
    !/<>\s*\{selectionDim/.test(src) && !/<React\.Fragment>\s*\{selectionDim/.test(src));

  // ⚠️ 두 차트의 memo는 서로 복사-붙여넣기하기 딱 좋은 모양이다. 인자·deps가 **그 차트 자신의**
  //    데이터·state를 가리키는지 이름까지 단언한다 — 통합 차트가 finalChartData를 읽으면
  //    (개별 차트가 마운트돼 있지 않아) 딤이 아예 안 뜨거나 엉뚱한 날짜에 걸린다.
  const memoStart = src.indexOf('const selectionDim = useMemo(');
  const memoBlock = memoStart >= 0 ? src.slice(memoStart, memoStart + 400) : '';
  const memoCall = memoBlock.slice(0, memoBlock.indexOf(');') + 2);
  ok(`#G6 ${name}: memo가 자기 차트 데이터(${rows})와 자기 state(${left}/${right})를 읽는다`,
    new RegExp(`selectionDimBands\\(${rows}, ${left}, ${right}\\)`).test(memoCall));
  // ⚠️ deps에 양 끝이 다 없으면 드래그 중 딤이 갱신되지 않는다(한쪽만 넣는 사고 방지).
  ok(`#G6b ${name}: memo deps에 데이터·refArea 양 끝이 모두 있다`,
    new RegExp(`\\[${rows}, ${left}, ${right}\\]`).test(memoCall));
}

// ── 해제 경로 — 선택이 '어두운 채로 고착'되면 안 된다 ──
// 종전에는 선택 잔존이 흰색 8% 띠라 티가 안 났지만, 이제 잔존하면 차트 대부분이 어둡게 덮인다.

// ⚠️ 통합 차트의 단순 클릭: intRefAreaRight가 ''인 채로 calculateIntSelection에 넘기면
//    [l,r].sort()가 ''를 앞으로 보내 '차트 시작~클릭 지점'이라는 없는 구간을 돌려준다.
//    → 하이라이트는 안 뜨는데 패널만 '선택 기간'으로 바뀌어 화면이 서로 모순된다.
const upBlock = hook.slice(hook.indexOf('const handleIntChartMouseUp'), hook.indexOf('const handleIntChartMouseLeave'));
ok('#G7 통합 차트 mouseUp: 단순 클릭(빈 right·같은 날짜) 가드',
  /intRefAreaLeft && intRefAreaRight && intRefAreaLeft !== intRefAreaRight/.test(upBlock));
ok('#G7b 통합 차트 mouseUp: 해제 시 selectionResult도 함께 null',
  /setIntRefAreaLeft\(''\);\s*setIntRefAreaRight\(''\);\s*setIntSelectionResult\(null\)/.test(upBlock));
ok('#G7c 개별 차트 mouseUp: 기존 단순 클릭 가드 유지',
  /refAreaLeft && refAreaRight && refAreaLeft !== refAreaRight/.test(hook));

// ⚠️ recharts는 **플롯 영역 밖**(Y축 눈금 거터·X축 날짜 띠)에서도 onMouseDown을 부른다
//    (handleOuterEvent가 getMouseInfo 결과를 `mouse ?? {}`로 넘긴다 — inRange는 플롯 rect만 본다).
//    그때 activeLabel이 없다고 no-op으로 두면, 그 영역은 `.chart-container-for-drag` 안이라
//    차트 밖 클릭 해제도 건너뛰어 **딤이 고착된다**. 통합 차트 md 기준 축 띠가 카드의 약 1/4다.
for (const [name, block, left, right, res, drag] of [
  ['개별', hook.slice(hook.indexOf('const handleChartMouseDown'), hook.indexOf('const handleChartMouseMove')),
    'setRefAreaLeft', 'setRefAreaRight', 'setSelectionResult', 'setIsDragging'],
  ['통합', hook.slice(hook.indexOf('const handleIntChartMouseDown'), hook.indexOf('const handleIntChartMouseMove')),
    'setIntRefAreaLeft', 'setIntRefAreaRight', 'setIntSelectionResult', 'setIntIsDragging'],
]) {
  ok(`#G7d ${name} 차트 mouseDown: 플롯 밖(activeLabel 없음) 클릭이 선택을 해제한다`,
    new RegExp(`else \\{[^}]*${drag}\\(false\\);[^}]*${left}\\(''\\);[^}]*${right}\\(''\\);[^}]*${res}\\(null\\);[^}]*\\}`).test(block));
}

// ⚠️ 두 차트가 같은 '.chart-container-for-drag' 클래스를 쓰는데 과거엔 개별 계좌 state만 지웠다.
const outsideBlock = app.slice(app.indexOf("chart-container-for-drag") - 200, app.indexOf("chart-container-for-drag") + 400);
ok('#G8 차트 밖 클릭: 개별 차트 선택 해제', /setRefAreaLeft\(''\);\s*setRefAreaRight\(''\);\s*setSelectionResult\(null\)/.test(outsideBlock));
ok('#G8b 차트 밖 클릭: **통합 차트 선택도 함께** 해제(딤 고착 방지)',
  /setIntRefAreaLeft\(''\);\s*setIntRefAreaRight\(''\);\s*setIntSelectionResult\(null\)/.test(outsideBlock));

// ⚠️ 판정은 '카드 안인가'가 아니라 **recharts 표면 위인가**다 — 카드 안이라도 컨테이너 패딩에
//    떨어진 클릭은 recharts 이벤트가 아예 안 나서, 컨테이너만 보면 해제 경로가 비는 링이 생긴다.
ok('#G8c 차트 밖 클릭 판정이 .recharts-wrapper(표면)까지 본다',
  /closest\('\.chart-container-for-drag'\)\s*&&\s*[a-zA-Z.]*closest\('\.recharts-wrapper'\)/.test(outsideBlock));

// ⚠️ 터치 기기에서는 recharts가 onTouchStart를 onMouseDown으로 위임해(tooltipEvents 바인딩)
//    손가락 드래그로도 선택이 만들어지는데, 스크롤로 판정된 터치에는 호환 mousedown이 발생하지
//    않는다 → mousedown만 들으면 딤이 영영 안 걷힌다.
const listenerBlock = app.slice(app.indexOf("chart-container-for-drag"), app.indexOf("chart-container-for-drag") + 900);
ok('#G8d touchstart 리스너도 등록·해제한다(터치 기기 딤 고착 방지)',
  /addEventListener\('touchstart', handler/.test(listenerBlock)
  && /removeEventListener\('touchstart', handler\)/.test(listenerBlock));

// ⚠️ 조회기간이 바뀌면 선택 날짜가 데이터에서 사라진다 — 두 차트 모두 리셋 effect가 있어야 한다
//    (selectionDimBands의 null 계약이 2차 방어선이지만, 패널의 '선택 기간' 표기는 그것으로 안 지워진다).
ok('#G9 조회기간 변경 시 개별 차트 선택 리셋', /\}, \[appliedRange\]\);/.test(app));
ok('#G9b 조회기간 변경 시 통합 차트 선택 리셋', /\}, \[intAppliedRange\]\);/.test(app));

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:chart-sel — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
