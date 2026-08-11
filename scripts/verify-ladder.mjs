// verify:ladder — 호가 가중 분할매수/분할매도 사다리 검증
//
// ⚠️ 참조 구현을 다시 쓰지 않는다. src/components/LadderTradeModal.tsx의 **실제 원문**에서
//    순수 함수 구간(tri~redistribute)을 잘라 평가한다. 미러를 두면 드리프트가 나고,
//    이 파일들은 .tsx라 verify 스크립트가 텍스트로만 읽을 수 있어 더 위험하다.
//
// 고정하는 계약
//   ① 매수 dir=-1 / 매도 dir=+1 — 방향만 다른 같은 사다리(복제 금지)
//   ② 매도 Σ수량 === 목표 수량 (매수는 자금 제약, 매도는 수량 제약)
//   ③ 호가 간격은 가격 격자(원화 1원 / 달러 0.01)의 배수 — 소수점 호가 금지
//   ④ 정규화된 호가면 사다리 행 가격이 절대 중복되지 않는다

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as nodeModule from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PATH = join(ROOT, 'src/components/LadderTradeModal.tsx');
const src = readFileSync(SRC_PATH, 'utf8');

if (typeof nodeModule.stripTypeScriptTypes !== 'function') {
  console.log('⏭  verify:ladder — 이 Node 버전은 stripTypeScriptTypes 미지원이라 건너뜁니다.');
  process.exit(0);
}

function sliceFns(source, names) {
  const start = source.indexOf('function tri');
  const end = source.indexOf('export default');
  if (start < 0 || end < 0) throw new Error('순수 함수 구간을 찾지 못했습니다 — 파일 구조가 바뀌었는지 확인하세요.');
  const js = nodeModule.stripTypeScriptTypes(source.slice(start, end), { mode: 'strip' });
  return new Function(js + '\nreturn {' + names.join(',') + '};')();
}

const F = sliceFns(src, ['tri', 'roundTo', 'buildLadder', 'maxAffordableQty', 'recalcAllPrices', 'redistribute']);

let pass = 0, fail = 0;
const J = (v) => JSON.stringify(v);
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
};
const quiet = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
};

// 컴포넌트 안의 normalizeTick 규칙 — 원문 roundTo로 계산한다.
const normTick = (raw, decimals, floor) => {
  const s = F.roundTo(raw, decimals);
  return s >= floor ? s : floor;
};

const QTYS = [1, 2, 3, 6, 7, 10, 15, 21, 22, 55, 100];

console.log('\n■ 방향 — 매수는 내리고 매도는 올린다');
{
  const buy = F.buildLadder(50000, 10, 10, 1, 0, -1);
  const sell = F.buildLadder(50000, 10, 10, 1, 0, 1);
  ok('#1 매수 첫 행 = 현재가', buy[0].price === 50000);
  ok('#2 매수 내림차순 · tick 간격', buy.every((r, i) => r.price === 50000 - i * 10), J(buy.map(r => r.price)));
  ok('#3 매도 첫 행 = 현재가', sell[0].price === 50000);
  ok('#4 매도 오름차순 · tick 간격', sell.every((r, i) => r.price === 50000 + i * 10), J(sell.map(r => r.price)));
  ok('#5 수량 삼각 가중 1,2,3,4 (양방향 동일)',
    J(buy.map(r => r.qty)) === J([1, 2, 3, 4]) && J(sell.map(r => r.qty)) === J([1, 2, 3, 4]),
    J([buy.map(r => r.qty), sell.map(r => r.qty)]));
  ok('#6 매수/매도는 가격만 대칭 — 수량 배분은 같다',
    J(buy.map(r => r.qty)) === J(sell.map(r => r.qty)));
}

console.log('\n■ 매도 목표 수량 보존 (수량 제약)');
{
  const TICKS_FOR = (d) => d === 2 ? [0.01, 0.1, 1, 2.5] : [1, 5, 10, 100];
  for (const p of [1000, 50000, 3.33, 250.75]) for (const d of [0, 2]) for (const t of TICKS_FOR(d)) for (const q of QTYS) {
    const floor = d === 2 ? 0.01 : 1;
    const rows = F.buildLadder(p, t, q, floor, d, 1);
    const sum = rows.reduce((s, r) => s + r.qty, 0);
    quiet(`매도 Σ수량=목표 (p=${p},t=${t},q=${q},d=${d})`, Math.abs(sum - q) < 1e-9, `sum=${sum}`);
    quiet(`매도 오름차순 (p=${p},t=${t},q=${q},d=${d})`, rows.every((r, i) => i === 0 || r.price > rows[i - 1].price), J(rows.map(r => r.price)));
  }
  ok('#7 매도 Σ수량 = 목표 수량 (전 조합)', true);
  ok('#8 매도 가격 오름차순 (전 조합)', true);
}
{
  const rows = F.buildLadder(1000, 10, 2.5, 1, 0, 1);
  ok('#9 소수 좌수(펀드) 목표도 합 보존', Math.abs(rows.reduce((s, r) => s + r.qty, 0) - 2.5) < 1e-9, J(rows));
}
{
  // 매수는 가격이 내려가다 floor에 걸리면 잘린다 / 매도는 올라가므로 잘리지 않는다.
  const buy = F.buildLadder(30, 10, 21, 1, 0, -1);
  const sell = F.buildLadder(30, 10, 21, 1, 0, 1);
  ok('#10 매수: floor에서 잘림', buy.reduce((s, r) => s + r.qty, 0) < 21, J(buy.map(r => r.price)));
  ok('#11 매도: floor 무관 전량 배분', sell.reduce((s, r) => s + r.qty, 0) === 21, J(sell.map(r => r.price)));
}

console.log('\n■ 매도는 현재가보다 비싸게 판다');
for (const q of [3, 10, 55]) {
  const rows = F.buildLadder(50000, 10, q, 1, 0, 1);
  const qty = rows.reduce((s, r) => s + r.qty, 0);
  const proceeds = rows.reduce((s, r) => s + r.price * r.qty, 0);
  quiet(`#12 uplift>0 (q=${q})`, proceeds > qty * 50000, `proceeds=${proceeds}`);
  quiet(`#13 평균단가 >= 현재가 (q=${q})`, proceeds / qty >= 50000);
}
ok('#12 사다리 매도금액 > 현재가 매도금액', true);
ok('#13 매도 평균단가 >= 현재가', true);
{
  const rows = F.buildLadder(50000, 10, 1, 1, 0, 1);
  ok('#14 1주면 현재가와 동일(웃돈 없음)', rows.length === 1 && rows[0].price === 50000);
}

console.log('\n■ 잠금 행 기준 재계산 (recalcAllPrices)');
{
  const rows = F.buildLadder(1000, 10, 15, 1, 0, 1);
  const locked = rows.map((r, i) => i === 2 ? { ...r, locked: true, price: 1500 } : r);
  const out = F.recalcAllPrices(locked, 1000, 10, 1, 0, 1);
  ok('#15 매도: 잠금 이전 행은 현재가 기준 유지', out[0].price === 1000 && out[1].price === 1010, J(out.map(r => r.price)));
  ok('#16 매도: 잠금 행 보존', out[2].price === 1500);
  ok('#17 매도: 잠금 이후 행은 잠금가 + tick', out[3].price === 1510 && out[4].price === 1520, J(out.map(r => r.price)));
}
{
  const rows = F.buildLadder(1000, 10, 15, 1, 0, -1);
  const locked = rows.map((r, i) => i === 2 ? { ...r, locked: true, price: 800 } : r);
  const out = F.recalcAllPrices(locked, 1000, 10, 1, 0, -1);
  ok('#18 매수: 잠금 이후 행은 잠금가 − tick', out[3].price === 790 && out[4].price === 780, J(out.map(r => r.price)));
}

console.log('\n■ redistribute — 방향 무관, 목표 보존');
{
  for (const dir of [1, -1]) {
    const rows = F.buildLadder(50000, 10, 10, 1, 0, dir);
    const edited = rows.map((r, i) => i === 0 ? { ...r, qty: 5, locked: true } : r);
    const out = F.redistribute(edited, 10);
    quiet(`redistribute Σ=목표 (dir=${dir})`, out.reduce((s, r) => s + r.qty, 0) === 10, J(out.map(r => r.qty)));
    quiet(`redistribute 잠금 보존 (dir=${dir})`, out[0].qty === 5 && out[0].locked === true);
  }
  ok('#19 잠금 수량 보존 + 나머지 재배분', true);
}

console.log('\n■ 호가 간격 — 소수점 금지 (가격 격자의 배수)');
{
  ok('#20 normalizeTick 정의', /const normalizeTick = \(raw/.test(src));
  ok('#21 applyTick이 normalizeTick 경유', /applyTick = \(val[^)]*\) => \{\s*const t = normalizeTick\(cleanNum\(val\)\);/.test(src));
  ok('#22 applyTick이 입력칸까지 동기화', /const applyTick[\s\S]{0,220}setTickInput\(String\(t\)\)/.test(src));
  ok('#23 옛 무검증 대입 제거', !/if \(t > 0\) setTickSize\(t\);/.test(src));

  for (const [raw, want] of [[0.1, 1], [0.01, 1], [0.4, 1], [0.6, 1], [1, 1], [10, 10], [12.7, 13], [12.2, 12], [-3, 1], [0, 1]]) {
    quiet(`원화 ${raw} → ${want}`, normTick(raw, 0, 1) === want, `got=${normTick(raw, 0, 1)}`);
  }
  ok('#24 원화 호가는 1원 단위 정수로 스냅', true);

  for (const [raw, want] of [[0.1, 0.1], [0.01, 0.01], [0.005, 0.01], [0.001, 0.01], [0.257, 0.26], [0, 0.01]]) {
    quiet(`달러 ${raw} → ${want}`, normTick(raw, 2, 0.01) === want, `got=${normTick(raw, 2, 0.01)}`);
  }
  ok('#25 달러 호가는 0.01 격자로 스냅', true);

  // ④ 정규화만 거치면 사다리가 붕괴하지 않는다 = 이 가드의 존재 이유
  for (const raw of [0.1, 0.01, 0.4, 0.9, 1, 3, 10, 12.7]) {
    const t = normTick(raw, 0, 1);
    for (const dir of [1, -1]) {
      const rows = F.buildLadder(50000, t, 21, 1, 0, dir);
      quiet(`원화 raw=${raw}→${t} dir=${dir} 가격 중복 없음`, new Set(rows.map(r => r.price)).size === rows.length, J(rows.map(r => r.price)));
    }
  }
  for (const raw of [0.001, 0.005, 0.01, 0.1, 0.257]) {
    const t = normTick(raw, 2, 0.01);
    for (const dir of [1, -1]) {
      const rows = F.buildLadder(250.75, t, 21, 0.01, 2, dir);
      quiet(`달러 raw=${raw}→${t} dir=${dir} 가격 중복 없음`, new Set(rows.map(r => r.price)).size === rows.length, J(rows.map(r => r.price)));
    }
  }
  ok('#26 정규화된 호가는 행 가격이 절대 중복되지 않는다', true);

  // 변이 확인: 정규화를 빼면(격자 미만 호가) 실제로 가격이 겹친다 — 죽은 단언 방지.
  // 0.1 호가 × 21주 → [50000,50000,50000,50000,50000,50001] 처럼 대부분이 같은 가격으로 반올림된다.
  const collapsed = F.buildLadder(50000, 0.1, 21, 1, 0, 1);
  ok('#27 [변이] 격자 미만 호가는 실제로 가격이 겹친다 — 가드가 죽은 단언이 아님',
    collapsed.length > 1 && new Set(collapsed.map(r => r.price)).size < collapsed.length, J(collapsed.map(r => r.price)));
}

console.log('\n■ 배수(mult) — 수량 증가폭 사용자 설정');
{
  // ① 기본 1 = 종전 동작 (하위호환의 축)
  for (const dir of [1, -1]) for (const q of QTYS) {
    const a = F.buildLadder(50000, 10, q, 1, 0, dir);        // 인자 생략
    const b = F.buildLadder(50000, 10, q, 1, 0, dir, 1);     // 명시 1
    quiet(`mult 기본=1 동일 (dir=${dir},q=${q})`, J(a) === J(b));
  }
  ok('#31 mult 생략 = mult 1 (기존 호출 무영향)', true);

  // ② 배수 2 → 2,4,6,8
  {
    const rows = F.buildLadder(7815, 10, 156, 1, 0, 1, 2);
    ok('#32 배수 2 → 수량 2,4,6,8…', J(rows.slice(0, 4).map(r => r.qty)) === J([2, 4, 6, 8]), J(rows.map(r => r.qty)));
    ok('#33 배수 2 · 156주 → Σ 보존', rows.reduce((s, r) => s + r.qty, 0) === 156, `sum=${rows.reduce((s, r) => s + r.qty, 0)}`);
    ok('#34 가격은 배수와 무관 (호가 간격만 따른다)',
      rows.every((r, i) => r.price === 7815 + i * 10), J(rows.map(r => r.price)));
  }
  {
    const one = F.buildLadder(7815, 10, 156, 1, 0, 1, 1);
    const two = F.buildLadder(7815, 10, 156, 1, 0, 1, 2);
    ok('#35 배수가 크면 단계 수가 준다', two.length < one.length, `mult1=${one.length}단계 mult2=${two.length}단계`);
  }

  // ③ Σ수량 === 목표 (배수 무관) + 목표 초과 금지
  for (const m of [1, 2, 3, 5, 10, 100]) for (const dir of [1, -1]) for (const q of QTYS) {
    const rows = F.buildLadder(50000, 10, q, 1, 0, dir, m);
    const sum = rows.reduce((s, r) => s + r.qty, 0);
    quiet(`배수 Σ=목표 (m=${m},dir=${dir},q=${q})`, Math.abs(sum - q) < 1e-9, `sum=${sum} target=${q} rows=${J(rows.map(r => r.qty))}`);
    quiet(`배수 행 수량>0 (m=${m},dir=${dir},q=${q})`, rows.every(r => r.qty > 0), J(rows.map(r => r.qty)));
  }
  ok('#36 배수와 무관하게 Σ수량 = 목표 수량 (목표 초과 매매 없음)', true);
  ok('#37 빈 수량 행이 생기지 않는다', true);

  // ④ 배수가 목표보다 크면 1단계로 끝난다(과매도 방지) — Math.min 흡수가 없으면 여기서 깨진다
  {
    const rows = F.buildLadder(50000, 10, 3, 1, 0, 1, 10);
    ok('#38 배수 > 목표 → 1단계 · 목표만큼만', rows.length === 1 && rows[0].qty === 3, J(rows.map(r => r.qty)));
  }
  {
    const rows = F.buildLadder(50000, 10, 10, 1, 0, 1, 4);
    ok('#39 마지막 행이 나머지를 흡수(초과 금지)',
      rows.reduce((s, r) => s + r.qty, 0) === 10 && rows.every(r => r.qty > 0), J(rows.map(r => r.qty)));
  }

  // ⑤ redistribute도 같은 배수를 따른다
  {
    const rows = F.buildLadder(50000, 10, 30, 1, 0, 1, 2);
    const edited = rows.map((r, i) => i === 0 ? { ...r, qty: 6, locked: true } : r);
    const out = F.redistribute(edited, 30, 2);
    ok('#40 redistribute 배수 반영 · Σ=목표',
      out.reduce((s, r) => s + r.qty, 0) === 30 && out[0].qty === 6, J(out.map(r => r.qty)));
    ok('#41 redistribute 잠금 이후 행이 배수 간격', out[1].qty === 2 && out[2].qty === 4, J(out.map(r => r.qty)));
    const legacy = F.redistribute(edited, 30);
    ok('#42 redistribute mult 생략 = 1', J(legacy) === J(F.redistribute(edited, 30, 1)));
  }

  // ⑥ 매수 자금 탐색도 배수를 따른다
  {
    const q1 = F.maxAffordableQty(1000, 10, 100000, 1, 0, 1);
    const q2 = F.maxAffordableQty(1000, 10, 100000, 1, 0, 2);
    ok('#43 maxAffordableQty가 배수를 반영', q1 > 0 && q2 > 0 && q2 !== q1, `mult1=${q1} mult2=${q2}`);
    ok('#44 maxAffordableQty mult 생략 = 1', F.maxAffordableQty(1000, 10, 100000, 1, 0) === q1);
  }

  // ⑦ 방어: 0·음수·소수 배수가 들어와도 사다리가 깨지지 않는다(엔진 측 하한)
  for (const bad of [0, -1, -10]) {
    const rows = F.buildLadder(50000, 10, 10, 1, 0, 1, bad);
    quiet(`배수 방어 ${bad}`, rows.reduce((s, r) => s + r.qty, 0) === 10 && rows.every(r => r.qty > 0), J(rows.map(r => r.qty)));
  }
  ok('#45 배수 0/음수 → 1로 폴백 (사다리 붕괴 없음)', true);
}

console.log('\n■ 배선 가드 (미러로는 표현 불가 — 컴포넌트가 dir/side를 실제로 넘기는가)');
{
  // ⚠️ 위 산술 테스트는 dir을 '인자로' 받으므로, 컴포넌트가 방향을 거꾸로 넘겨도 잡지 못한다.
  //    그 계약은 원문 정규식으로만 단언할 수 있다. 실패 시 먼저 정규식이 낡았는지 확인할 것.
  ok('#46 매도 dir=+1 / 매수 dir=-1', /const dir = isSell \? 1 : -1;/.test(src));
  ok('#47 buildLadder 호출이 dir·mult를 넘긴다', /buildLadder\(price, tick, Q, priceFloor, decimals, dir, m\)/.test(src));
  ok('#48 recalcAllPrices 호출 2곳 모두 dir을 넘긴다',
    (src.match(/recalcAllPrices\([^)]*, dir\)/g) || []).length === 2,
    J((src.match(/recalcAllPrices\([^)]*dir\)/g) || [])));
  ok('#49 매도 목표는 자금이 아니라 |totalAction|',
    /const sellTarget = Math\.abs\(cleanNum\(totalAction\)\);/.test(src)
    && /const Q = isSell \? sellTarget : maxAffordableQty\(price, tick, fund, priceFloor, decimals, m\);/.test(src));

  // 배수 배선 — 세 소비자가 전부 mult를 받아야 화면과 계산이 갈리지 않는다
  ok('#50 normalizeMult 정의 (1 이상 정수)', /const normalizeMult = \(raw[\s\S]{0,140}Math\.round\(raw\)/.test(src));
  ok('#51 applyMult이 normalizeMult 경유 + 입력칸 동기화',
    /const applyMult = \(val[^)]*\) => \{\s*const m = normalizeMult\(cleanNum\(val\)\);/.test(src)
    && /const applyMult[\s\S]{0,200}setMultInput\(String\(m\)\)/.test(src));
  ok('#52 redistribute 호출 2곳 모두 mult를 넘긴다',
    (src.match(/redistribute\([^)]*, mult\)/g) || []).length === 2,
    J((src.match(/redistribute\([^)]*\)/g) || [])));
  ok('#53 mult 변경이 사다리를 재생성한다 (effect deps)',
    /\}, \[currentPrice, tickSize, rebalFund, side, sellTarget, mult\]\);/.test(src));

  const panel = readFileSync(join(ROOT, 'src/components/RebalancingPanel.tsx'), 'utf8');
  ok('#54 현재가 셀이 매도(−)에서도 열린다', /const ladderOpenable = totalAction !== 0 && itemPrice > 0;/.test(panel));
  ok('#55 side를 방향에 맞게 넘긴다',
    /side: isSellAction \? 'sell' : 'buy',/.test(panel)
    && /const isSellAction = totalAction < 0;/.test(panel));
  ok('#56 매도 금액은 부호 없는 절대액(현재가 기준 매도금액)',
    /rebalFund: Math\.abs\(totalAction\) \* itemPrice,/.test(panel));
  ok('#57 단일 컴포넌트 유지 — 매도 전용 모달 복제 금지',
    /import LadderTradeModal from '\.\/LadderTradeModal';/.test(panel) && !/LadderSellModal|LadderBuyModal/.test(panel));
}

console.log('\n■ 방어 입력');
{
  for (const [p, t, q] of [[0, 10, 5], [1000, 0, 5], [1000, 10, 0], [-5, 10, 5], [1000, -10, 5]]) {
    for (const dir of [1, -1]) {
      quiet(`빈 사다리 (${p},${t},${q},dir=${dir})`, J(F.buildLadder(p, t, q, 1, 0, dir)) === '[]');
    }
  }
  ok('#28 가격/호가/수량이 0 이하면 빈 사다리', true);
  ok('#29 매수 자금 0 → 수량 0', F.maxAffordableQty(1000, 10, 0, 1, 0) === 0);
  ok('#30 매수 자금이 커도 floor 아래로는 안 내려간다', F.buildLadder(30, 10, 100, 1, 0, -1).every(r => r.price >= 1));
}

console.log(`\n${fail ? '❌' : '✅'} verify:ladder — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
