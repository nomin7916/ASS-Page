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
//   ⑤ 각 호가의 등락률은 **전일 종가**(현재가 ÷ (1 + c/100)) 기준 — 전일 종가를 가격 격자로
//      반올림하지 않는다. 반올림하면 현재가 행의 등락률이 리밸런싱 표의 등락률과 갈린다.
//   ⑥ 계산기는 여는 시점의 스냅샷이 아니라 rebalanceData의 **살아 있는 행**을 본다. 여는 순간
//      그 종목의 현재가를 재조회하는데, 스냅샷을 들고 있으면 새 가격이 화면에 영영 닿지 않는다.
//   ⑦ 사용자가 직접 입력한 단가(핀)는 호가 간격·배수·현재가가 바뀌어 사다리를 다시 만들어도
//      살아남는다. 핀이 하나도 없으면 결과가 종전과 1원도 다르지 않다(하위호환의 축).
//   ⑧ side(매수/매도)는 여는 시점에 박제한다 — 라이브 파생 금지. 열림 게이트(totalAction !== 0)는
//      renderRow에만 있어 모달 렌더 경로를 못 막으므로, 부호 불일치는 모달 안에서 명시적으로 미적용한다.
//      base가 옮겨져 사다리 **반대편**으로 넘어간 핀도 마찬가지(같은 가격이 두 행에 찍히는 것 방지).

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

const F = sliceFns(src, ['tri', 'roundTo', 'buildLadder', 'solveQtyForAmount', 'recalcAllPrices', 'redistribute', 'normalizeChangeRate', 'prevCloseFrom', 'rateVsPrev']);

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

console.log('\n■ 전일 대비 등락률 — 각 호가가 전일 종가 대비 몇 %인가');
{
  // 사용자 실측 화면: 현재가 11,260 · ▲6.56%. 매도 호가를 올릴수록 6.56%보다 커져야 한다.
  const P = 11260, C = 6.56;
  const prev = F.prevCloseFrom(P, C);
  const at = (px) => F.rateVsPrev(px, prev);

  ok('#80 현재가 행의 등락률 = 표의 등락률 (앵커 정확 일치)',
    prev !== null && Math.abs(at(P) - C) < 1e-9, `prev=${prev} at(P)=${at(P)}`);

  {
    // ⚠️ 죽은 단언 방지 — 전일 종가를 격자로 스냅하면 앵커가 **실제로** 깨지는 조합이 있음을 보인다.
    //    (특정 값 하나를 박아 두면 그 값이 우연히 같은 소수 2자리로 떨어질 때 단언이 죽는다.)
    let diverge = 0, example = null;
    for (const p of [8500, 11260, 11570, 44300, 7215, 1234]) {
      for (let k = -1000; k <= 1000; k++) {
        const c = +(k / 100).toFixed(2);
        const exact = F.prevCloseFrom(p, c);
        if (exact === null) continue;
        const snapped = Math.round(exact);
        if (snapped <= 0) continue;
        const rateSnapped = (p / snapped - 1) * 100;
        if (rateSnapped.toFixed(2) !== c.toFixed(2)) {
          diverge++;
          if (!example) example = `${p} · ${c}% → 스냅 ${snapped} → ${rateSnapped.toFixed(2)}%`;
        }
      }
    }
    ok('#81 [변이] 전일 종가를 반올림하면 현재가 행이 표와 갈린다 (스냅 금지의 근거)',
      diverge > 0, `괴리 ${diverge}건 / 예: ${example}`);
    // 반대로 반올림하지 않으면 어떤 조합에서도 절대 갈리지 않는다.
    let mismatch = 0;
    for (const p of [8500, 11260, 11570, 44300, 7215, 1234, 3.33, 250.75]) {
      for (let k = -1000; k <= 1000; k++) {
        const c = +(k / 100).toFixed(2);
        const r = F.rateVsPrev(p, F.prevCloseFrom(p, c));
        if (!(Math.abs(r - c) < 1e-9)) mismatch++;
      }
    }
    ok('#81b 반올림하지 않으면 현재가 행이 전 조합에서 표와 일치', mismatch === 0, `불일치 ${mismatch}건`);
  }

  {
    const rows = F.buildLadder(P, 10, 55, 1, 0, 1);
    const rates = rows.map(r => at(r.price));
    ok('#82 매도: 호가를 올릴수록 등락률이 커진다 (첫 행만 현재가 등락률과 같다)',
      rates.length > 1 && Math.abs(rates[0] - C) < 1e-9
      && rates.every((r, i) => i === 0 || (r > rates[i - 1] && r > C)),
      J(rates.map(r => +r.toFixed(3))));
  }
  {
    // 사용자 예시: 현재가가 이미 −5%인 종목을 더 아래 호가로 분할매수한다.
    const prevB = F.prevCloseFrom(10000, -5);
    const rowsB = F.buildLadder(10000, 100, 55, 1, 0, -1);
    const ratesB = rowsB.map(r => F.rateVsPrev(r.price, prevB));
    ok('#83 매수: 호가를 내릴수록 등락률이 작아진다 (−5%보다 더 큰 하락으로 표시)',
      ratesB.length > 1 && Math.abs(ratesB[0] - (-5)) < 1e-9
      && ratesB.every((r, i) => i === 0 || (r < ratesB[i - 1] && r < -5)),
      J(ratesB.map(r => +r.toFixed(3))));
  }
  {
    // 대수 항등식 — 등락률(가격) = (가격 × (1 + c/100) / 현재가 − 1) × 100
    let bad = 0;
    for (const [p, c] of [[11260, 6.56], [8500, -1.24], [250.75, 0], [3.33, 12.5], [1000000, -30]])
      for (const px of [p, p * 1.1, p * 0.5, p + 1]) {
        const r = F.rateVsPrev(px, F.prevCloseFrom(p, c));
        const expect = (px * (1 + c / 100) / p - 1) * 100;
        if (!(Math.abs(r - expect) < 1e-9)) bad++;
      }
    ok('#84 등락률 항등식 (전 조합)', bad === 0, `위반 ${bad}건`);
  }
  {
    // ⚠️ 죽은 단언 방지 — 소수 3자리 이상 등락률에서 '전일 종가 왕복'이 실제로 표와 갈리는 것을
    //    보인다(미국 주식 changeRate는 반올림 없이 들어온다). 그래서 현재가 행은 원값을 쓴다.
    const CS = [6.565, -2.345, 0.125, 3.475, -7.005, 1.115, 4.005, -0.335, 2.225, 9.995];
    let diverge = 0, example = null;
    for (const p of [8500, 11260, 1234, 44300]) for (const c of CS) {
      const round = F.rateVsPrev(p, F.prevCloseFrom(p, c));
      if (round.toFixed(2) !== c.toFixed(2)) {
        diverge++;
        if (!example) example = `${p} · ${c}% → 왕복 ${round.toFixed(2)}% (표 ${c.toFixed(2)}%)`;
      }
    }
    ok('#99b [변이] 왕복 계산은 .xx5 경계에서 표와 갈린다 — 현재가 행에 원값을 쓰는 근거',
      diverge > 0, `괴리 ${diverge}건 / 예: ${example}`);
    ok('#99c normalizeChangeRate는 원값을 자릿수 손실 없이 그대로 돌려준다',
      [6.565, -2.345, 0, 12.3456789, -99.999].every(c => F.normalizeChangeRate(c) === c)
      && F.normalizeChangeRate('6.565') === 6.565
      && ['', ' ', true, false, [], {}, NaN, null, undefined, 'abc'].every(v => F.normalizeChangeRate(v) === null));
  }
}

console.log('\n■ 등락률 null 계약 — 모르는 값을 0%로 단언하지 않는다');
{
  ok('#85 등락률 미확보(null/undefined)는 null',
    F.prevCloseFrom(1000, null) === null && F.prevCloseFrom(1000, undefined) === null);
  const JUNK = ['', ' ', true, false, [], {}, NaN, 'abc'];
  ok('#86 손상값도 null (Number()가 0으로 만드는 값들)',
    JUNK.every(v => F.prevCloseFrom(1000, v) === null),
    J(JUNK.map(v => F.prevCloseFrom(1000, v))));
  ok('#87 숫자 문자열은 허용', Math.abs(F.prevCloseFrom(1065.6, '6.56') - 1000) < 1e-9);
  ok('#88 등락률 0은 유효한 값 — 전일 종가 = 현재가', F.prevCloseFrom(1000, 0) === 1000);
  ok('#89 −100% 이하는 전일 종가 복원 불가 → null',
    F.prevCloseFrom(1000, -100) === null && F.prevCloseFrom(1000, -150) === null);
  ok('#90 현재가가 0 이하·비수치면 null',
    F.prevCloseFrom(0, 5) === null && F.prevCloseFrom(-1, 5) === null && F.prevCloseFrom(NaN, 5) === null);
  ok('#91 rateVsPrev는 전일 종가가 없으면 null (0% 아님)',
    F.rateVsPrev(1000, null) === null && F.rateVsPrev(1000, 0) === null && F.rateVsPrev(NaN, 1000) === null);
}

console.log('\n■ 사용자 지정 단가(핀) 보존 — 호가·배수를 바꿔도 이전 가격으로 되돌아가지 않는다');
{
  // 컴포넌트 applyPins와 같은 규칙(핀 심기 → recalcAllPrices 재앵커)을 **원문 함수**로 재현한다.
  // ⚠️ applyPins 자체는 컴포넌트 안(순수 함수 구간 밖)이라 잘라 평가할 수 없다 → 그 배선은 #110이 맡는다.
  const applyPins = (built, pins, price, tick, floor, dec, dir) => {
    if (!built.length) return built;
    const fits = (pin) => dir * (pin - price) >= 0;
    const usable = new Set(built.filter(r => pins[r.id] !== undefined && fits(pins[r.id])).map(r => r.id));
    if (!usable.size) return built;
    const pinned = built.map(r => usable.has(r.id) ? { ...r, price: pins[r.id], locked: true } : r);
    return F.recalcAllPrices(pinned, price, tick, floor, dec, dir);
  };

  // 사용자 실측 시나리오 — 현재가 10,510 · 호가 10 → 첫 행에 10,000을 직접 입력 → 호가를 200으로 변경.
  const pins = { r0: 10000 };
  const built10 = F.buildLadder(10510, 10, 21, 1, 0, -1);
  const with10 = applyPins(built10, pins, 10510, 10, 1, 0, -1);
  ok('#101 지정한 단가가 그대로 남는다 (호가 10)', with10[0].price === 10000 && with10[0].locked === true);
  ok('#102 지정 단가 아래 행은 그 단가를 기준으로 호가 간격만큼 재배치된다',
    with10[1].price === 9990 && with10[2].price === 9980, J(with10.map(r => r.price)));

  const built200 = F.buildLadder(10510, 200, 21, 1, 0, -1);
  const with200 = applyPins(built200, pins, 10510, 200, 1, 0, -1);
  ok('#103 [회귀] 호가 간격을 바꿔도 지정 단가가 이전 가격으로 되돌아가지 않는다',
    with200[0].price === 10000, J(with200.map(r => r.price)));
  ok('#104 새 호가 간격은 지정 단가 아래부터 적용된다',
    with200[1].price === 9800 && with200[2].price === 9600, J(with200.map(r => r.price)));

  // 배수 변경도 같은 경로(doRegenerate)라 핀이 살아남는다.
  const builtM2 = F.buildLadder(10510, 10, 21, 1, 0, -1, 2);
  ok('#105 배수를 바꿔도 지정 단가가 유지된다',
    applyPins(builtM2, pins, 10510, 10, 1, 0, -1)[0].price === 10000);

  ok('#106 핀이 없으면 buildLadder 출력과 완전히 동일 (하위호환의 축)',
    J(applyPins(built10, {}, 10510, 10, 1, 0, -1)) === J(built10)
    && J(F.recalcAllPrices(built10, 10510, 10, 1, 0, -1)) === J(built10));

  const sellBuilt = F.buildLadder(10510, 10, 21, 1, 0, 1);
  const sellPinned = applyPins(sellBuilt, { r0: 11000 }, 10510, 10, 1, 0, 1);
  ok('#107 매도도 같은 규칙 (지정 단가 유지 + 위로 재앵커)',
    sellPinned[0].price === 11000 && sellPinned[1].price === 11010, J(sellPinned.map(r => r.price)));

  // 사다리가 짧아져 핀 인덱스가 사라져도 오류 없이 무시된다(핀은 지우지 않는다 — 다시 길어지면 되살아난다).
  const short = F.buildLadder(10510, 10, 3, 1, 0, -1);
  const shortPinned = applyPins(short, { r0: 10000, r9: 9000 }, 10510, 10, 1, 0, -1);
  quiet('사라진 인덱스의 핀은 조용히 무시된다',
    shortPinned.length === short.length && shortPinned.every(r => r.price >= 1) && shortPinned[0].price === 10000,
    J(shortPinned.map(r => r.price)));

  // ── 방향 게이트 — base가 옮겨져 사다리 반대편으로 넘어간 핀은 적용하지 않는다 ──
  // 현재가 재조회(수정1)가 base를 바꾸므로, 이 상태는 사용자가 만든 적 없이 **자동으로** 생긴다.
  {
    const base2 = F.buildLadder(9700, 100, 21, 1, 0, -1);   // 재조회로 현재가가 10,000 → 9,700
    const pinned2 = applyPins(base2, { r2: 9900 }, 9700, 100, 1, 0, -1);
    ok('#115 매수에서 현재가보다 비싼 핀은 적용되지 않는다 (같은 가격 중복 방지)',
      J(pinned2) === J(base2) && new Set(pinned2.map(r => r.price)).size === pinned2.length,
      J(pinned2.map(r => r.price)));

    // ⚠️ 죽은 단언 방지 — 게이트를 뺀 버전이 실제로 중복 가격을 만드는지 확인한다.
    const noGate = F.recalcAllPrices(
      base2.map(r => r.id === 'r2' ? { ...r, price: 9900, locked: true } : r),
      9700, 100, 1, 0, -1);
    ok('#115b [변이] 게이트가 없으면 같은 가격이 두 행에 찍힌다 (게이트의 존재 이유)',
      new Set(noGate.map(r => r.price)).size < noGate.length,
      J(noGate.map(r => r.price)));

    // 매도(dir=+1) 대칭 — 현재가보다 싼 핀은 적용되지 않는다.
    const sellBase = F.buildLadder(9700, 100, 21, 1, 0, 1);
    quiet('매도에서 현재가보다 싼 핀도 적용되지 않는다',
      J(applyPins(sellBase, { r2: 9500 }, 9700, 100, 1, 0, 1)) === J(sellBase));
  }

  // ⚠️ 게이트가 과잉 차단이 되면 수정2 자체가 무의미해진다 — 방향 **안쪽**의 비단조는 그대로 허용한다
  //    (사용자가 r2를 r1보다 비싸게 지정한 것은 직접 만든 상태이고, 수동 편집 자유는 기존 계약이다).
  {
    const b = F.buildLadder(10000, 100, 21, 1, 0, -1);
    const p = applyPins(b, { r2: 9950 }, 10000, 100, 1, 0, -1);
    ok('#116 방향 안쪽이면 앞 행보다 비싼 핀도 그대로 적용된다 (과잉 차단 금지)',
      p[2].price === 9950 && p[2].locked === true && p[3].price === 9850,
      J(p.map(r => r.price)));
  }
}

console.log('\n■ 배선 가드 (미러로는 표현 불가 — 컴포넌트가 dir/side를 실제로 넘기는가)');
{
  // ⚠️ 위 산술 테스트는 dir을 '인자로' 받으므로, 컴포넌트가 방향을 거꾸로 넘겨도 잡지 못한다.
  //    그 계약은 원문 정규식으로만 단언할 수 있다. 실패 시 먼저 정규식이 낡았는지 확인할 것.
  ok('#46 매도 dir=+1 / 매수 dir=-1', /const dir = isSell \? 1 : -1;/.test(src));
  ok('#47 buildLadder 호출이 dir·mult를 넘긴다', /buildLadder\(price, tick, Q, priceFloor, decimals, dir, m\)/.test(src));
  // ⚠️ 개수를 상수로 못 박지 말 것 — 호출이 하나 늘 때마다 계약과 무관하게 실패한다.
  //    계약은 "선언을 뺀 **모든** 호출이 dir을 넘긴다"이다.
  {
    // ⚠️ 반드시 주석을 걷어낸 본문에서 센다 — 이 저장소는 금지·설명 근거를 바로 그 자리 주석에
    //    적으므로, 원문으로 세면 주석 속 함수 이름이 유령 호출로 잡혀 가드가 영구히 실패한다.
    const code = stripComments(src);
    const recalcAll = (code.match(/recalcAllPrices\(/g) || []).length - 1; // 선언 1개 제외
    const recalcDir = (code.match(/recalcAllPrices\([^)]*, dir\)/g) || []).length;
    ok('#48 recalcAllPrices 호출이 전부 dir을 넘긴다 (개수 고정 아님)',
      recalcAll >= 3 && recalcDir === recalcAll,
      J({ recalcAll, recalcDir }));
  }
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
  // ⚠️ 아래 3건(#55·#56·#96)은 스냅샷 리터럴에서 **라이브 파생 블록**으로 자리를 옮겼다.
  //    계약(방향·앵커·등락률 소스)은 그대로다 — 옛 정규식으로 되돌리지 말 것.
  // ⚠️ side는 **여는 시점 스냅샷**이다 — ladderAction에서 라이브 파생하면 '추가' 칸 편집만으로
  //    분할매도 계산기가 분할매수 계산기로 뒤집힌다(#117이 그 금지를 함께 단언한다).
  ok('#55 side를 방향에 맞게 넘긴다 (여는 시점 박제)',
    /side: isSellAction \? 'sell' : 'buy'/.test(panel)
    && /const isSellAction = totalAction < 0;/.test(panel)
    && /side=\{ladderModal\.side\}/.test(panel));
  ok('#56 앵커는 목표 금액 = |수량| × 현재가 (증가분·부족분) · 부호 불일치는 명시적 미적용',
    /const ladderTargetAmount = ladderSignOk \? Math\.abs\(ladderAction\) \* ladderPrice : 0;/.test(panel)
    && /targetAmount=\{ladderTargetAmount\}/.test(panel)
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
  // ── 전일 대비 등락률 열 배선 ──
  // ⚠️ prop 순서(인접성)를 단언하지 말 것 — 신규 prop 하나만 사이에 끼워도 계약과 무관하게 실패한다.
  ok('#92 컴포넌트가 changeRate를 받아 전일 종가를 복원하고 열을 조건부로 렌더한다',
    /changeRate = null,/.test(src) && /currency = 'KRW',/.test(src)
    && /const prevClose = prevCloseFrom\(currentPrice, changeRate\);/.test(src)
    && /const showRate = prevClose !== null;/.test(src)
    && /등락률\s*<\/th>/.test(src));
  ok('#93 열 수는 단일 파생 상수 — 빈 사다리 colSpan이 그것을 쓴다 (표 정렬 붕괴 방지)',
    /const colCount = showRate \? 6 : 5;/.test(src)
    && /colSpan=\{colCount\}/.test(src)
    && !/colSpan=\{5\}/.test(src));
  // ⚠️ 선언만 검사하면 죽은 단언이 된다 — 실제 **사용부**(렌더 지점)를 단언한다.
  //    적대적 리뷰가 실증한 변이 3종: ① td 통째 삭제 ② showRate 래퍼만 제거
  //    ③ rateClass/rateText 인자를 rowRate → curRate 로 바꾸기. 셋 다 옛 가드를 통과했다.
  ok('#94 등락률 3표시가 각자 자기 값을 렌더한다 (선언이 아니라 사용부 단언)',
    /const rowRate = row\.price === currentPrice \? curRate : rateVsPrev\(row\.price, prevClose\);/.test(src)
    && /const avgRate = avgPrice > 0 \? rateVsPrev\(avgPrice, prevClose\) : null;/.test(src)
    && /rateClass\(rowRate\)/.test(src) && /\{rateText\(rowRate\)\}/.test(src)
    && /rateClass\(curRate\)/.test(src) && /\{rateText\(curRate\)\}/.test(src)
    && /rateClass\(avgRate\)/.test(src) && /\{rateText\(avgRate\)\}/.test(src));
  ok('#98 등락률 th·td가 둘 다 showRate 게이트 안에 있다 (thead/tbody 열 수 어긋남 방지)',
    /\{showRate && \(\s*<th[\s\S]{0,500}?등락률\s*<\/th>\s*\)\}/.test(src)
    && /\{showRate && \(\s*<td[\s\S]{0,240}?\{rateText\(rowRate\)\}\s*<\/td>\s*\)\}/.test(src));
  ok('#99 현재가 행은 등락률 원값을 그대로 쓴다 (전일 종가 왕복 오차 차단)',
    /const baseRate = normalizeChangeRate\(changeRate\);/.test(src)
    && /const curRate = showRate \? baseRate : null;/.test(src));
  ok('#100 툴팁의 전일 종가는 단언이 아니라 근사 표기 — 3곳이 한 문자열을 공유',
    /const prevLabel = showRate \? `전일 종가 ≈ \$\{fmt\(prevClose\)\}\(등락률에서 복원한 추정값\)` : '';/.test(src)
    && (src.match(/\$\{prevLabel\}/g) || []).length === 3
    && !/전일 종가 \$\{fmt\(prevClose\)\}/.test(src));
  ok('#95 모르면 0.00%가 아니라 - 로 표시한다 (null 계약)',
    /const rateText = \(r[^)]*\) => r == null \? '-' : formatChangeRate\(r\);/.test(src));
  ok('#96 리밸런싱 표가 등락률을 넘긴다 (양쪽 배선)',
    /const ladderChangeRate = ladderRow \? \(ladderRow\.changeRate \?\? null\) : null;/.test(panel)
    && /changeRate=\{ladderChangeRate\}/.test(panel));
  ok('#97 모달 폭·높이와 열림 위치 클램프가 짝 (440 ↔ 456 / 요약 확대 ↔ 560)',
    /width: 440 \}\}/.test(src) && /window\.innerWidth - 456\)/.test(panel)
    && /window\.innerHeight - 560\)/.test(panel));
  ok('#57 단일 컴포넌트 유지 — 매도 전용 모달 복제 금지',
    /import LadderTradeModal from '\.\/LadderTradeModal';/.test(panel) && !/LadderSellModal|LadderBuyModal/.test(panel));

  // ── 현재가 재조회 · 지정 단가 보존 · Enter 커밋 ──
  // ⚠️ 전부 **사용부**를 단언한다. 선언만 보면 셀 통째 삭제·값 바꿔치기가 그대로 통과한다.
  const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
  ok('#108 계산기는 스냅샷이 아니라 rebalanceData의 살아 있는 행을 본다',
    // state가 담는 것은 itemId·pos·side 셋뿐이다(side만 의도적 스냅샷 — #55·#117).
    /setLadderModal\(\{ itemId: item\.id, pos: \{ x, y \}, side: /.test(panel)
    && /const ladderRow = ladderModal \? rebalanceData\.find\(d => d\.id === ladderModal\.itemId\) : null;/.test(panel)
    && /const ladderPrice = ladderRow \? cleanNum\(ladderRow\.currentPrice\) : 0;/.test(panel)
    && /const ladderAction = ladderRow \? ladderRow\.action \+ \(rebalExtraQty\[ladderRow\.id\] \|\| 0\) : 0;/.test(panel)
    && /currentPrice=\{ladderPrice\}/.test(panel) && /totalAction=\{ladderTotalAction\}/.test(panel)
    && /\{ladderModal && ladderRow && \(/.test(panel)
    // ⚠️ 옛 스냅샷 필드가 하나라도 되살아나면 재조회한 새 가격이 모달에 닿지 않는다.
    //    side는 예외 — 그것만은 의도적으로 박제한다(#55·#117).
    && !/ladderModal\.(currentPrice|totalAction|targetAmount|changeRate|itemName|currency|fxRate)/.test(stripComments(panel)));
  ok('#109 현재가 셀 클릭이 그 종목을 즉시 재조회한다 (App→패널→모달 3단 배선)',
    /if \(item\.code && onRefreshPrice\) onRefreshPrice\(item\.id, item\.code\);/.test(panel)
    && /onRefreshPrice=\{handleSingleStockRefresh\}\s*stockFetchStatus=\{stockFetchStatus\}/.test(app)
    && /\? \(\) => onRefreshPrice\(ladderRow\.id, ladderRow\.code\)/.test(panel)
    && /onRefreshPrice=\{ladderRefresh\}/.test(panel)
    && /refreshState=\{ladderRefreshState\}/.test(panel)
    && /const ladderRefreshState = \(ladderRow && ladderRow\.code\) \? \(stockFetchStatus\?\.\[ladderRow\.code\] \?\? null\) : null;/.test(panel)
    // 모달이 실제로 그 콜백·상태를 쓴다(버튼 렌더 + 스피너)
    && /onClick=\{\(\) => onRefreshPrice\(\)\}/.test(src)
    && /refreshState === 'loading' \? 'animate-spin' : ''/.test(src));
  ok('#110 지정 단가가 재생성에서 다시 심어진다 (호가·배수·현재가 변경에도 유지)',
    /const \[pinnedPrices, setPinnedPrices\] = useState<Record<string, number>>\(\{\}\);/.test(src)
    && /setPinnedPrices\(prev => \(\{ \.\.\.prev, \[id\]: newPrice \}\)\);/.test(src)
    && /const doRegenerate = \(price: number, tick: number, amount: number, m: number, pins: Record<string, number>\) => \{/.test(src)
    && /setRows\(applyPins\(buildLadder\(price, tick, Q, priceFloor, decimals, dir, m\), pins, price, tick\)\);/.test(src)
    && /usable\.has\(r\.id\) \? \{ \.\.\.r, price: pins\[r\.id\], locked: true \}/.test(src));
  ok('#111 핀은 재생성 effect deps가 아니라 ref로 읽는다 (단가 커밋마다 전체 재생성 금지)',
    /pinnedRef\.current = pinnedPrices;/.test(src)
    && /doRegenerate\(currentPrice, tickSize, targetAmount, mult, pinnedRef\.current\);/.test(src)
    && !/\[currentPrice, tickSize, targetAmount, side, mult, pinnedPrices\]/.test(src));
  ok('#112 잠금 해제·초기화가 지정 단가를 지운다 (해제가 다음 재생성에서 되살아나지 않게)',
    /const unlockRow = \(id: string\) => \{[\s\S]{0,600}?setPinnedPrices\(prev => \{ const n = \{ \.\.\.prev \}; delete n\[id\]; return n; \}\);/.test(src)
    && /onClick=\{\(\) => \{ setPinnedPrices\(\{\}\); doRegenerate\(currentPrice, tickSize, targetAmount, mult, \{\}\); \}\}/.test(src));
  ok('#113 매수단가·수량 입력이 Enter로도 커밋된다',
    (src.match(/onKeyDown=\{e => \{ if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); \(e\.target as HTMLInputElement\)\.blur\(\); \} \}\}/g) || []).length === 2
    // ⚠️ Enter가 커밋을 직접 부르면 이어지는 blur가 stale 초안으로 한 번 더 커밋한다 — 커밋 경로는 onBlur 하나.
    && !/Enter'\) \{ handleRowPriceBlur/.test(src));
  ok('#114 핀이 없으면 사다리가 buildLadder 출력 그대로 (하위호환의 축)',
    /if \(!built\.length\) return built;/.test(src)
    && /if \(!usable\.size\) return built;/.test(src));
  ok('#117 side는 여는 시점에 박제한다 (라이브 파생 금지 — 매도 계산기가 매수로 뒤집힘 방지)',
    /const ladderSignOk = !!ladderModal && !!ladderRow\s*&& \(ladderModal\.side === 'sell' \? ladderAction < 0 : ladderAction > 0\);/.test(panel)
    && /const ladderTotalAction = ladderSignOk \? ladderAction : 0;/.test(panel)
    // 부호가 어긋난 이유가 화면에 남아야 한다(빈 사다리 기본 문구는 거짓 설명이 된다)
    && /emptyReason=\{ladderEmptyReason\}/.test(panel)
    && /\{emptyReason \|\| `목표 금액\(\$\{fmt\(targetAmount\)\}\)이 1주 값보다 작습니다\.`\}/.test(src)
    // 라이브 파생으로 되돌리면 실패한다
    && !/side=\{ladderAction/.test(panel));
  ok('#118 종목을 바꿔 열면 계산기가 다시 마운트된다 (다른 종목의 지정 단가 오염 방지)',
    /key=\{ladderModal\.itemId\}/.test(panel));
  ok('#119 사다리 반대편으로 넘어간 핀은 적용하지 않고, 그 사실을 모달 안에서 알린다',
    /const pinFits = \(pin: number, price: number\) => dir \* \(pin - price\) >= 0;/.test(src)
    && /pins\[r\.id\] !== undefined && pinFits\(pins\[r\.id\], price\)/.test(src)
    && /const droppedPins = Object\.keys\(pinnedPrices\)/.test(src)
    && /\{droppedPins > 0 && \(/.test(src)
    && /사다리 방향과 맞지 않아 반영되지 않았습니다/.test(src));
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
