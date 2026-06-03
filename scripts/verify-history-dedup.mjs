// history 날짜 중복 제거(dedupeHistoryByDate) 단위 테스트.
// 실행: npm run verify:history
// 차이 발생 시 종료코드 1.
//
// utils.ts는 TS이므로 esbuild/tsc 없이 직접 import 불가 →
// dedupeHistoryByDate와 의존 헬퍼(cleanNum)를 그대로 재정의(=참조 구현)하고 케이스 검증.
// 본 파일과 src/utils.ts의 함수 본문은 항상 동기화 필요.
//
// 핵심 회귀 케이스: 수동 백필 버튼이 실시간(isFixed:false) 레코드가 있는 날짜를
// '누락'으로 오판해 같은 날짜에 백필(isFixed:true) 레코드를 중복 추가하던 버그.
// 통합 합산 Map(last-write-wins)이 뒤에 붙은 백필값을 채택해 그 날 총자산이 틀어졌음.
// dedupe는 로드 시 권위 있는 실시간 값을 보존하며 날짜당 1건으로 정리한다.

// ─── 참조 구현 (src/utils.ts 미러) ──────────────────────────────────────────
const cleanNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
  return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
};

const dedupeHistoryByDate = (history) => {
  if (!Array.isArray(history) || history.length < 2) return history;
  const rank = (h) => {
    if (!h?.isFixed && cleanNum(h?.evalAmount) > 0) return 2;
    if (h?.isFixed && h?.adjustedAmount !== undefined) return 1;
    return 0;
  };
  const best = new Map();
  for (const h of history) {
    if (!h?.date) continue;
    const cur = best.get(h.date);
    if (!cur || rank(h) >= rank(cur)) best.set(h.date, h);
  }
  if (best.size === history.length) return history;
  const seen = new Set();
  const out = [];
  for (const h of history) {
    if (!h?.date || seen.has(h.date)) continue;
    seen.add(h.date);
    out.push(best.get(h.date));
  }
  return out;
};

// ─── 테스트 러너 ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const FAILS = [];
function it(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; FAILS.push({ name, msg: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}
function expectEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: ${actual} ≠ ${expected}`);
}

console.log('\n── history 날짜 중복 제거(dedupeHistoryByDate) 검증 ──\n');

console.log('[1] 회귀: 실시간 + 백필 같은 날짜 → 실시간 권위값 유지');
it('실시간(isFixed:false) 값이 뒤에 붙은 백필(isFixed:true)을 이긴다', () => {
  // 퇴직연금 2026-06-01 재현: 실시간 ₩108,924,553 다음 백필 ₩109,789,368 append
  const hist = [
    { date: '2026-05-31', evalAmount: 107666311, isFixed: false },
    { date: '2026-06-01', evalAmount: 108924553, isFixed: false, adjustedAmount: 108924553 },
    { date: '2026-06-01', evalAmount: 109789368, isFixed: true }, // 백필이 나중에 append됨
    { date: '2026-06-02', evalAmount: 108950352, isFixed: false },
  ];
  const out = dedupeHistoryByDate(hist);
  expectEq(out.length, 3, '중복 제거 후 길이');
  const jun1 = out.filter(h => h.date === '2026-06-01');
  expectEq(jun1.length, 1, '2026-06-01 건수');
  expectEq(jun1[0].evalAmount, 108924553, '2026-06-01 채택값(실시간 권위)');
  expectEq(jun1[0].isFixed, false, '2026-06-01 채택 레코드는 실시간');
});

it('백필이 먼저, 실시간이 나중이어도 실시간을 채택(순서 무관)', () => {
  const hist = [
    { date: '2026-06-01', evalAmount: 109789368, isFixed: true },
    { date: '2026-06-01', evalAmount: 108924553, isFixed: false },
  ];
  const out = dedupeHistoryByDate(hist);
  expectEq(out.length, 1, '길이');
  expectEq(out[0].evalAmount, 108924553, '채택값');
});

console.log('\n[2] 동순위(둘 다 순수 백필) → 나중 값 채택');
it('isFixed:true 백필 2건이면 배열 뒤 값을 채택', () => {
  const hist = [
    { date: '2026-06-01', evalAmount: 100, isFixed: true },
    { date: '2026-06-01', evalAmount: 200, isFixed: true },
  ];
  const out = dedupeHistoryByDate(hist);
  expectEq(out.length, 1, '길이');
  expectEq(out[0].evalAmount, 200, '나중 값 채택');
});

it('확정(isFixed:true+adjustedAmount)이 순수 백필을 이긴다', () => {
  const hist = [
    { date: '2026-06-01', evalAmount: 500, isFixed: true, adjustedAmount: 500 }, // rank 1
    { date: '2026-06-01', evalAmount: 999, isFixed: true },                       // rank 0
  ];
  const out = dedupeHistoryByDate(hist);
  expectEq(out.length, 1, '길이');
  expectEq(out[0].evalAmount, 500, '확정값 채택(순서상 뒤가 더 낮은 rank여도)');
});

console.log('\n[3] 등장 순서(날짜 첫 등장 기준) 보존');
it('중복 정리 후에도 날짜 순서가 원본 첫 등장 순서를 따른다', () => {
  const hist = [
    { date: '2026-06-03', evalAmount: 3, isFixed: false },
    { date: '2026-06-01', evalAmount: 1, isFixed: false },
    { date: '2026-06-01', evalAmount: 11, isFixed: true }, // dup
    { date: '2026-06-02', evalAmount: 2, isFixed: false },
  ];
  const out = dedupeHistoryByDate(hist);
  expectEq(out.map(h => h.date).join(','), '2026-06-03,2026-06-01,2026-06-02', '순서');
  expectEq(out.find(h => h.date === '2026-06-01').evalAmount, 1, '06-01 실시간 유지');
});

console.log('\n[4] 중복 없으면 동일 참조 반환(불필요 재렌더 방지)');
it('중복 없는 배열은 같은 참조로 반환', () => {
  const hist = [
    { date: '2026-06-01', evalAmount: 1, isFixed: false },
    { date: '2026-06-02', evalAmount: 2, isFixed: false },
  ];
  const out = dedupeHistoryByDate(hist);
  if (out !== hist) throw new Error('동일 참조가 아님 (새 배열 생성됨)');
  expectEq(out.length, 2, '길이 보존');
});

it('길이<2 또는 비배열은 그대로 반환', () => {
  const one = [{ date: '2026-06-01', evalAmount: 1 }];
  if (dedupeHistoryByDate(one) !== one) throw new Error('단일 원소 동일 참조 아님');
  expectEq(dedupeHistoryByDate([]).length, 0, '빈 배열');
  expectEq(dedupeHistoryByDate(null), null, 'null 통과');
});

console.log('\n[5] date 없는 레코드는 의도적으로 폐기');
it('dateless 레코드 제거, 나머지는 유지', () => {
  const hist = [
    { date: '2026-06-01', evalAmount: 1, isFixed: false },
    { evalAmount: 999, isFixed: true }, // date 없음 → 폐기
    { date: '2026-06-02', evalAmount: 2, isFixed: false },
  ];
  const out = dedupeHistoryByDate(hist);
  expectEq(out.length, 2, '길이');
  expectEq(out.some(h => !h.date), false, 'dateless 잔존 없음');
  expectEq(out.map(h => h.date).join(','), '2026-06-01,2026-06-02', '유효 레코드 보존');
});

console.log('\n[6] 통합 합산 영향 — last-write-wins Map이 권위값을 채택');
it('dedupe 후 Map(last-wins)도 실시간 값을 가리킨다', () => {
  // useIntegratedData의 계좌별 Map 구성 미러: map.set(date, evalAmount) (evalAmount>0)
  const hist = [
    { date: '2026-06-01', evalAmount: 108924553, isFixed: false },
    { date: '2026-06-01', evalAmount: 109789368, isFixed: true }, // 백필 dup
  ];
  const cleaned = dedupeHistoryByDate(hist);
  const map = new Map();
  cleaned.forEach(h => { if (h && h.date && h.evalAmount > 0) map.set(h.date, h.evalAmount); });
  expectEq(map.get('2026-06-01'), 108924553, '통합 Map이 채택한 2026-06-01 값');
});

// ─── 결과 출력 ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`결과: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\n실패:');
  FAILS.forEach(f => console.log(`  • ${f.name}: ${f.msg}`));
  process.exit(1);
}
console.log('✓ 모든 케이스 통과\n');
