// verify:ladder — 호가 가중 분할매수/분할매도 사다리 검증
//
// ⚠️ 참조 구현을 다시 쓰지 않는다. src/components/LadderTradeModal.tsx의 **실제 원문**에서
//    순수 함수 구간(tri~redistribute)을 잘라 평가한다. 미러를 두면 드리프트가 나고,
//    이 파일들은 .tsx라 verify 스크립트가 텍스트로만 읽을 수 있어 더 위험하다.
//
// 고정하는 계약
//   ① 매수 dir=-1 / 매도 dir=+1 — 방향만 다른 같은 사다리(복제 금지)
//   ②-a buildLadder Σ수량 === 요청 수량 (배분 항등식)
//   ②-b 사다리의 앵커는 '금액' — 매수·매도 모두 총액이 목표금액을 넘지 않는 최대 수량을 푼다.
//        매도를 |action|으로 고정하면 목표금액을 초과 매도한다(옛 sellTarget 버그)
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
  // ⚠️ lastIndexOf — 구간 안 주석이 컴포넌트 선언 키워드를 그대로 적으면 indexOf가 거기서 잘려
  //    상수 선언이 통째로 빠지고 ReferenceError만 남는다(실제로 한 번 그랬다).
  const end = source.lastIndexOf('export default');
  if (start < 0 || end < 0 || end <= start) throw new Error('순수 함수 구간을 찾지 못했습니다 — 파일 구조가 바뀌었는지 확인하세요.');
  const body = source.slice(start, end);
  // 잘린 구간을 조용한 ReferenceError가 아니라 명시적 실패로 바꾼다.
  const missing = names.filter(n => !body.includes(n));
  if (missing.length) throw new Error('순수 함수 구간에 없는 이름: ' + missing.join(', ') + ' — 선언이 구간 밖으로 나갔는지 확인하세요.');
  const js = nodeModule.stripTypeScriptTypes(body, { mode: 'strip' });
  return new Function(js + '\nreturn {' + names.join(',') + '};')();
}

const F = sliceFns(src, ['tri', 'roundTo', 'buildLadder', 'solveQtyForAmount', 'recalcAllPrices', 'redistribute']);

// ⚠️ 금지 토큰 가드는 주석을 지우고 본다 — 이 파일의 설명 주석에는 옛 이름이 일부러 남아 있다.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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

console.log('\n■ buildLadder 배분 항등식 (요청 수량을 정확히 나눈다)');
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
    const q1 = F.solveQtyForAmount(1000, 10, 100000, 1, 0, -1, 1);
    const q2 = F.solveQtyForAmount(1000, 10, 100000, 1, 0, -1, 2);
    ok('#43 solveQtyForAmount가 배수를 반영', q1 > 0 && q2 > 0 && q2 !== q1, `mult1=${q1} mult2=${q2}`);
    ok('#44 solveQtyForAmount mult 생략 = 1', F.solveQtyForAmount(1000, 10, 100000, 1, 0, -1) === q1);
  }

  // ⑦ 방어: 0·음수·소수 배수가 들어와도 사다리가 깨지지 않는다(엔진 측 하한)
  for (const bad of [0, -1, -10]) {
    const rows = F.buildLadder(50000, 10, 10, 1, 0, 1, bad);
    quiet(`배수 방어 ${bad}`, rows.reduce((s, r) => s + r.qty, 0) === 10 && rows.every(r => r.qty > 0), J(rows.map(r => r.qty)));
  }
  ok('#45 배수 0/음수 → 1로 폴백 (사다리 붕괴 없음)', true);
}

console.log('\n■ 금액 앵커 — 수량은 목표금액에서 파생된다 (이 기능의 존재 이유)');
{
  const sum = (r) => r.reduce((a, x) => a + x.qty, 0);
  const amt = (r) => r.reduce((a, x) => a + x.price * x.qty, 0);
  const P = 8470, BASE = 940, TARGET = BASE * P;   // 스크린샷 실측: KODEX 200커버드콜액티브

  // ① 옛 버그 재현 — 수량을 고정하면 목표금액을 초과 매도한다
  {
    const fixed = F.buildLadder(P, 100, BASE, 1, 0, 1, 4);
    ok('#58 [옛 버그] 수량 고정 매도는 목표금액을 초과한다',
      amt(fixed) > TARGET * 1.15, `매도금액=${amt(fixed)} 목표=${TARGET}`);
  }

  // ② 새 계약 — 목표금액 이하 + 최대성(한 주 더하면 반드시 초과) + 사다리 안 잘림
  let viol = 0;
  for (const price of [8470, 50000, 1000, 120]) {
    for (const t of [1, 10, 50, 100, 400]) {
      for (const m of [1, 2, 4, 8]) {
        for (const a of [1, 10, 100, 940]) {
          for (const d of [1, -1]) {
            const target = a * price;
            const Q = F.solveQtyForAmount(price, t, target, 1, 0, d, m);
            if (Q <= 0) continue;
            const rows = F.buildLadder(price, t, Q, 1, 0, d, m);
            const nxt = F.buildLadder(price, t, Q + 1, 1, 0, d, m);
            const overshoot = amt(rows) > target + 1e-6;
            const truncated = Math.abs(sum(rows) - Q) > 1e-9;
            const maximal = !nxt.length || amt(nxt) > target + 1e-6 || Math.abs(sum(nxt) - (Q + 1)) > 1e-9;
            if (overshoot || truncated || !maximal) {
              viol++;
              if (viol <= 3) console.log(`    위반 p=${price} t=${t} m=${m} a=${a} d=${d} Q=${Q} 금액=${amt(rows)} 목표=${target}`);
            }
          }
        }
      }
    }
  }
  ok('#59 목표금액 이하 · 최대성 · 잘리지 않음 (전 조합)', viol === 0, `위반 ${viol}건`);

  // ③ 방향 — 매도는 덜 팔고, 매수는 더 산다 (같은 목표금액)
  {
    const qS = F.solveQtyForAmount(P, 100, TARGET, 1, 0, 1, 4);
    const rS = F.buildLadder(P, 100, qS, 1, 0, 1, 4);
    ok('#60 매도: 같은 금액을 더 적은 수량으로 채운다',
      qS < BASE && amt(rS) <= TARGET, `${BASE}주 → ${qS}주 · 금액 ${amt(rS)}/${TARGET}`);
    ok('#61 매도 평균단가 > 현재가 (그래서 수량이 준다)', amt(rS) / qS > P);

    const qB = F.solveQtyForAmount(P, 10, TARGET, 1, 0, -1, 1);
    const rB = F.buildLadder(P, 10, qB, 1, 0, -1, 1);
    ok('#62 매수: 같은 금액으로 더 많은 수량을 담는다',
      qB > BASE && amt(rB) <= TARGET, `${BASE}주 → ${qB}주 · 금액 ${amt(rB)}/${TARGET}`);
    ok('#63 매수 평균단가 < 현재가', amt(rB) / qB < P);
  }

  // ④ 매도 수량은 절대 기준 수량을 넘지 않는다 (평균단가 >= 현재가의 필연적 귀결)
  {
    let bad = 0;
    for (const t of [1, 10, 50, 100, 400]) for (const m of [1, 2, 4, 8]) for (const a of [1, 7, 100, 940]) {
      const Q = F.solveQtyForAmount(P, t, a * P, 1, 0, 1, m);
      if (Q > a) bad++;
    }
    ok('#64 매도 수량 <= 기준 수량 (초과 매도 없음)', bad === 0, `초과 ${bad}건`);
  }

  // ⑤ 호가가 넓어질수록 매도 수량이 준다 = 사용자가 요구한 동작
  {
    const qs = [10, 50, 100, 200, 400].map(t => F.solveQtyForAmount(P, t, TARGET, 1, 0, 1, 1));
    ok('#65 호가 확대 → 매도 수량 단조감소', qs.every((q, i) => i === 0 || q < qs[i - 1]), J(qs));
  }

  // ⑥ 폭주 회귀 — 옛 선형탐색은 여기서 상한 100000을 반환했다(잘린 사다리 탓에 cost가 안 늘어서).
  //    이분탐색 + '잘린 사다리 거부'가 그 경로를 막는다. 실측 정답 210.
  {
    const Q = F.solveQtyForAmount(1000, 50, 100 * 1000, 1, 0, -1, 1);
    const rows = F.buildLadder(1000, 50, Q, 1, 0, -1, 1);
    ok('#66 [회귀] 가격 하한에 닿는 매수가 상한까지 폭주하지 않는다',
      Q > 0 && Q < 100000 && Math.abs(sum(rows) - Q) < 1e-9, `Q=${Q}`);
    ok('#67 그 사다리의 모든 행이 가격 하한 이상', rows.every(r => r.price >= 1));
  }

  // ⑦ 달러 — 소수 2자리 누적 오차로 목표를 넘지 않는다
  {
    let bad = 0;
    for (const t of [0.01, 0.1, 1]) for (const m of [1, 4]) for (const a of [1, 13, 250]) {
      for (const d of [1, -1]) {
        const target = a * 250.75;
        const Q = F.solveQtyForAmount(250.75, t, target, 0.01, 2, d, m);
        if (Q <= 0) continue;
        if (amt(F.buildLadder(250.75, t, Q, 0.01, 2, d, m)) > target + 1e-6) bad++;
      }
    }
    ok('#68 달러(소수 2자리)도 목표금액을 넘지 않는다', bad === 0, `초과 ${bad}건`);
  }

  // ⑧ 방어 입력
  ok('#69 목표금액/가격/호가가 0 이하면 수량 0',
    F.solveQtyForAmount(0, 10, 1000, 1, 0, 1) === 0
    && F.solveQtyForAmount(1000, 0, 1000, 1, 0, 1) === 0
    && F.solveQtyForAmount(1000, 10, -5, 1, 0, 1) === 0);
  // 허용 오차 경계 = 정확히 가격 격자 1칸. 999(1칸 부족)는 구제되고 998(2칸)은 안 된다.
  ok('#70 목표금액 부족분이 격자 1칸 이내면 1주 (그 밖은 0주)',
    F.solveQtyForAmount(1000, 10, 999, 1, 0, 1) === 1
    && F.solveQtyForAmount(1000, 10, 998, 1, 0, 1) === 0);
  ok('#71 목표금액이 정확히 1주 값이면 1주', F.solveQtyForAmount(1000, 10, 1000, 1, 0, 1) === 1);

  // ⑨ 가격 격자 양자화 — 목표금액은 원시 현재가로 계산되는데 사다리는 스냅된 가격으로 거래한다.
  //    격자가 가격을 올려 반올림하면 1주조차 목표를 넘겨 Q=0(빈 사다리)이 되던 회귀.
  //    실측 결함: 기준가 1,234.56 · action −1 → 첫 호가 1,235 > 목표 1,234.56 → 매도 계산기가 통째로 비었다.
  {
    let empty = [];
    for (const price of [1234.56, 10500.50, 9999.90, 1000.5, 1000.99, 3.7]) {
      for (const d of [1, -1]) for (const m of [1, 4]) {
        const Q = F.solveQtyForAmount(price, 10, 1 * price, 1, 0, d, m);
        if (Q < 1) empty.push(`p=${price} dir=${d} m=${m} → Q=${Q}`);
      }
    }
    ok('#74 [회귀] 격자가 올려 반올림하는 가격에서도 1주는 배분된다 (빈 사다리 금지)',
      empty.length === 0, J(empty.slice(0, 4)));
  }
  {
    // 일반 계약: 기준 수량 >= 1 이면 어떤 조합에서도 Q >= 1 이다(스냅 상승폭 <= 격자의 절반).
    let bad = [];
    for (const price of [1234.56, 8470, 120.5, 3.7, 55555.55]) {
      for (const t of [1, 10, 100]) for (const m of [1, 2, 8]) for (const a of [1, 2, 5]) {
        for (const d of [1, -1]) {
          const Q = F.solveQtyForAmount(price, t, a * price, 1, 0, d, m);
          if (Q < 1) bad.push(`p=${price} t=${t} m=${m} a=${a} dir=${d}`);
        }
      }
    }
    ok('#75 기준 수량 >= 1 이면 항상 Q >= 1', bad.length === 0, J(bad.slice(0, 4)));
  }
  {
    // 달러 격자(0.01)도 같은 규칙 — 소수 3자리 가격이 올려 반올림되는 경우
    const Q = F.solveQtyForAmount(250.756, 0.1, 250.756, 0.01, 2, 1, 1);
    ok('#76 달러도 격자 반올림에 막혀 빈 사다리가 되지 않는다', Q >= 1, `Q=${Q}`);
  }
  {
    // 허용 오차는 '격자 1칸'이지 무제한이 아니다 — 목표가 진짜로 작으면 여전히 0이다.
    ok('#77 목표금액이 1주 값보다 격자 이상 작으면 여전히 0주',
      F.solveQtyForAmount(1000, 10, 900, 1, 0, 1) === 0);
  }
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
  ok('#49 매수·매도가 같은 금액 솔버 한 줄을 쓴다 (수량 고정 분기 부활 금지)',
    /const Q = solveQtyForAmount\(price, tick, amount, priceFloor, decimals, dir, m\);/.test(src)
    && !/sellTarget/.test(stripComments(src)));

  // 배수 배선 — 세 소비자가 전부 mult를 받아야 화면과 계산이 갈리지 않는다
  ok('#50 normalizeMult 정의 (1 이상 정수)', /const normalizeMult = \(raw[\s\S]{0,140}Math\.round\(raw\)/.test(src));
  ok('#51 applyMult이 normalizeMult 경유 + 입력칸 동기화',
    /const applyMult = \(val[^)]*\) => \{\s*const m = normalizeMult\(cleanNum\(val\)\);/.test(src)
    && /const applyMult[\s\S]{0,200}setMultInput\(String\(m\)\)/.test(src));
  ok('#52 redistribute 호출 2곳 모두 mult를 넘긴다',
    (src.match(/redistribute\([^)]*, mult\)/g) || []).length === 2,
    J((src.match(/redistribute\([^)]*\)/g) || [])));
  ok('#53 목표금액·배수 변경이 사다리를 재생성한다 (effect deps)',
    /\}, \[currentPrice, tickSize, targetAmount, side, mult\]\);/.test(src));

  const panel = readFileSync(join(ROOT, 'src/components/RebalancingPanel.tsx'), 'utf8');
  ok('#54 현재가 셀이 매도(−)에서도 열린다', /const ladderOpenable = totalAction !== 0 && itemPrice > 0;/.test(panel));
  ok('#55 side를 방향에 맞게 넘긴다',
    /side: isSellAction \? 'sell' : 'buy',/.test(panel)
    && /const isSellAction = totalAction < 0;/.test(panel));
  ok('#56 앵커는 목표 금액 = |수량| × 현재가 (증가분·부족분)',
    /targetAmount: Math\.abs\(totalAction\) \* itemPrice,/.test(panel)
    && /targetAmount=\{ladderModal\.targetAmount\}/.test(panel)
    && !/rebalFund/.test(panel));
  ok('#72 화면이 목표 금액과 잔여를 노출한다 (사다리가 목표를 못 채운 것을 숨기지 않음)',
    /목표 금액/.test(src) && /const residual = targetAmount - totalCost;/.test(src)
    && /잔여 \$\{fmt\(residual\)\}/.test(src) && /초과 \$\{fmt\(-residual\)\}/.test(src));
  ok('#73 푸터는 금액 우위가 아니라 기준 수량 대비 수량 이득을 보여 준다',
    /const qtyDiff = totalQty - baseQty;/.test(src) && !/const uplift/.test(src)
    && /const qtyDiffLabel = isSell/.test(src)
    && /주 절약/.test(src) && /주 추가/.test(src) && /주 부족/.test(src));
  ok('#78 허용 오차가 가격 격자(1e-6 같은 부동소수 여유 아님)',
    /const amountTolOf = \(decimals[^)]*\) => Math\.pow\(10, -decimals\);/.test(src)
    && /cost <= targetAmount \+ amountTolOf\(decimals\)/.test(src)
    && !/AMOUNT_EPS/.test(src));
  ok('#79 빈 사다리는 이유를 밝힌다 (잔여·푸터가 가려지므로)',
    /!rows\.length && \(/.test(src) && /배분할 수량이 없습니다/.test(src));
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
  ok('#29 목표금액 0 → 수량 0', F.solveQtyForAmount(1000, 10, 0, 1, 0, -1) === 0 && F.solveQtyForAmount(1000, 10, 0, 1, 0, 1) === 0);
  ok('#30 매수 자금이 커도 floor 아래로는 안 내려간다', F.buildLadder(30, 10, 100, 1, 0, -1).every(r => r.price >= 1));
}

console.log(`\n${fail ? '❌' : '✅'} verify:ladder — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
