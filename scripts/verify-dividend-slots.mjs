// 분배금 지급월 슬롯 재배치(buildPaySlots) 단위 테스트.
// 실행: npm run verify:dividend
// 차이 발생 시 종료코드 1.
//
// DividendSummaryTable.tsx는 TSX이므로 esbuild/tsc 없이 직접 import 불가 →
// buildPaySlots와 의존 헬퍼를 그대로 재정의(=참조 구현)하고 케이스 검증.
// 본 파일과 src/components/DividendSummaryTable.tsx의 함수 본문은 항상 동기화 필요.
//
// 핵심 회귀 케이스: 배당 일정 과도기(월중→월초)에 직전연도 기준 '예측' 배당락이
// 실제 '확정' 배당락의 지급월로 잘못 끌려와 같은 달에 이중 계상되던 버그.
// (예: 실제 5월말 배당락→6월 지급 + 직전연도 6월중 배당락 예측→6월 지급 합산되어
//  셀 합계 ≠ 수량×주당분배금으로 표시됨)

// ─── 참조 구현 (src 미러; CURRENT_YEAR만 CY 파라미터로 치환해 결정적 테스트) ───

// utils.ts addBusinessDays / dividendPayDate 미러
function addBusinessDays(dateStr, n, holidays = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return '';
  const set = new Set(holidays || []);
  const d = new Date(dateStr + 'T12:00:00');
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (d.getDay() === 0 || d.getDay() === 6 || set.has(ds)) continue;
    added++;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dividendPayDate = (exDate, holidays = []) => addBusinessDays(exDate, 2, holidays);

function buildMonthPrediction(codeHistory) {
  const pred = {};
  for (let m = 1; m <= 12; m++) {
    const mo = String(m).padStart(2, '0');
    const entries = Object.entries(codeHistory || {})
      .filter(([key]) => key.endsWith(`-${mo}`))
      .sort(([a], [b]) => b.localeCompare(a));
    if (entries.length > 0) pred[m] = entries[0][1];
  }
  return pred;
}

function buildMonthExPrediction(codeExHistory) {
  const pred = {};
  for (let m = 1; m <= 12; m++) {
    const mo = String(m).padStart(2, '0');
    const entries = Object.entries(codeExHistory || {})
      .filter(([key]) => key.endsWith(`-${mo}`))
      .sort(([a], [b]) => b.localeCompare(a));
    if (entries.length > 0) pred[m] = entries[0][1];
  }
  return pred;
}

// src의 buildPaySlots 미러. 차이: CURRENT_YEAR → CY 파라미터(결정적 테스트용).
function buildPaySlots(codeHistory, codeExHistory, hol, CY) {
  const monthPred = buildMonthPrediction(codeHistory);
  const exPred = buildMonthExPrediction(codeExHistory);
  const holAug = [...(hol || []), `${CY - 1}-12-31`];
  const slots = Array.from({ length: 12 }, () => []);
  const consider = (exYear, mIdx, prevDecToJan = false) => {
    const m = mIdx + 1;
    const mo = String(m).padStart(2, '0');
    const perShare = monthPred[m] || 0;
    if (!(perShare > 0)) return;
    const exYm = `${exYear}-${mo}`;
    const actualEx = codeExHistory?.[exYm];
    if (prevDecToJan && !actualEx) {
      const exDateRaw = `${exYear}-12-31`;
      slots[0].push({ exYm, exMonthIdx: mIdx, perShare, exDateRaw, payDateRaw: dividendPayDate(exDateRaw, holAug), exPredicted: true });
      return;
    }
    let exDateRaw, exPredicted;
    if (actualEx) { exDateRaw = actualEx; exPredicted = false; }
    else if (exPred[m]) { exDateRaw = `${exYear}-${mo}-${exPred[m].slice(8, 10)}`; exPredicted = true; }
    else return;
    const payDateRaw = dividendPayDate(exDateRaw, holAug);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payDateRaw))) return;
    if (Number(payDateRaw.slice(0, 4)) !== CY) return;
    slots[Number(payDateRaw.slice(5, 7)) - 1].push({ exYm, exMonthIdx: mIdx, perShare, exDateRaw, payDateRaw, exPredicted });
  };
  for (let i = 0; i < 12; i++) consider(CY, i);
  consider(CY - 1, 11, true);
  // 확정 우선: 같은 지급월에 확정 소스가 있으면 예측 소스 제거 (이중 계상 방지)
  return slots.map(srcs => {
    if (srcs.length <= 1 || !srcs.some(s => !s.exPredicted)) return srcs;
    return srcs.filter(s => !s.exPredicted);
  });
}

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

// 결정적 테스트를 위해 고정 연도 2026 사용 (영업일/요일은 고정된 달력 사실).
// 2026-05-28(목) +2영업일 = 2026-06-01(월) → 6월 지급
// 2026-06-15(월) +2영업일 = 2026-06-17(수) → 6월 지급
const CY = 2026;
const PY = CY - 1;

console.log('\n── 분배금 지급월 슬롯(buildPaySlots) 검증 ──\n');

console.log('[1] 회귀: 일정 과도기(월중→월초) 6월 이중 계상 방지');
it('6월 슬롯 = 확정 소스 1건만 (직전연도 예측 6월 배당락 제거)', () => {
  // RISE 미국AI 490590 재현: 2026년 월초형(말일 배당락→익월초 지급),
  // 직전연도엔 6월중 배당락(₩183)이 존재해 예측이 6월로 끌려옴.
  const codeHistory = {
    [`${CY}-04`]: 374, [`${CY}-05`]: 323, // 올해 주당분배금
    [`${PY}-06`]: 183,                    // 직전연도 6월(과도기 잔재)
  };
  const codeExHistory = {
    [`${CY}-05`]: `${CY}-05-28`, // 확정: 5월말 배당락 → 6월1일 지급
    [`${PY}-06`]: `${PY}-06-15`, // 직전연도 6월중 배당락 → 예측 6월 지급 유발
  };
  const slots = buildPaySlots(codeHistory, codeExHistory, [], CY);
  const june = slots[5]; // 6월(payIdx=5)
  expectEq(june.length, 1, '6월 소스 개수');
  expectEq(june[0].exYm, `${CY}-05`, '6월 지배 소스 exYm');
  expectEq(june[0].exPredicted, false, '6월 소스는 확정');
  // 셀 합계 = 수량×주당분배금 일치 확인 (수량 2004 가정)
  const qty = 2004;
  const cellAmount = june.reduce((s, src) => s + src.perShare * qty, 0);
  expectEq(cellAmount, 323 * qty, '6월 셀 합계 = 수량×주당분배금');
  expectEq(cellAmount, 647292, '6월 셀 합계 절댓값');
});

it('수정 전이었다면 6월에 2건이 잡혔어야 함(가드 없을 때 동작 대조)', () => {
  // 가드 미적용 버전으로 같은 입력 → 2건(이중 계상) 확인 → 가드의 효과 입증
  const codeHistory = { [`${CY}-05`]: 323, [`${PY}-06`]: 183 };
  const codeExHistory = { [`${CY}-05`]: `${CY}-05-28`, [`${PY}-06`]: `${PY}-06-15` };
  const noGuard = (() => {
    const monthPred = buildMonthPrediction(codeHistory);
    const exPred = buildMonthExPrediction(codeExHistory);
    const slots = Array.from({ length: 12 }, () => []);
    const consider = (exYear, mIdx) => {
      const m = mIdx + 1, mo = String(m).padStart(2, '0');
      const perShare = monthPred[m] || 0;
      if (!(perShare > 0)) return;
      const exYm = `${exYear}-${mo}`;
      const actualEx = codeExHistory[exYm];
      let exDateRaw, exPredicted;
      if (actualEx) { exDateRaw = actualEx; exPredicted = false; }
      else if (exPred[m]) { exDateRaw = `${exYear}-${mo}-${exPred[m].slice(8, 10)}`; exPredicted = true; }
      else return;
      const pay = dividendPayDate(exDateRaw, []);
      if (Number(pay.slice(0, 4)) !== CY) return;
      slots[Number(pay.slice(5, 7)) - 1].push({ exYm, exPredicted });
    };
    for (let i = 0; i < 12; i++) consider(CY, i);
    return slots;
  })();
  expectEq(noGuard[5].length, 2, '가드 미적용 시 6월 2건(버그 재현)');
});

console.log('\n[2] 정상 월배당(월중형) — 각 지급월 단일 소스 유지');
it('과도기 잔재 없으면 가드가 아무것도 제거하지 않음', () => {
  const codeHistory = {}, codeExHistory = {};
  for (let m = 1; m <= 12; m++) {
    const mo = String(m).padStart(2, '0');
    // 매월 10일 배당락 → +2영업일도 같은 달(드리프트 없음, 슬롯 충돌 방지).
    codeHistory[`${CY}-${mo}`] = 100 + m;
    codeHistory[`${PY}-${mo}`] = 90 + m;
    codeExHistory[`${PY}-${mo}`] = `${PY}-${mo}-10`;
  }
  // 올해 1~5월은 확정 배당락 존재(이미 지급됨 가정)
  for (let m = 1; m <= 5; m++) codeExHistory[`${CY}-${String(m).padStart(2, '0')}`] = `${CY}-${String(m).padStart(2, '0')}-10`;
  const slots = buildPaySlots(codeHistory, codeExHistory, [], CY);
  const multi = slots.filter(s => s.length > 1);
  expectEq(multi.length, 0, '단일 소스가 아닌 지급월 개수');
  const filled = slots.filter(s => s.length === 1).length;
  expectEq(filled, 12, '12개 지급월 모두 단일 소스로 채워짐');
});

console.log('\n[3] 전부 예측인 슬롯은 예측을 유지(미래월)');
it('확정 소스 없는 슬롯은 예측 소스 보존', () => {
  // 9월 지급분만 예측으로 존재 → 9월 슬롯에 예측 1건 유지
  const codeHistory = { [`${PY}-08`]: 145 };
  const codeExHistory = { [`${PY}-08`]: `${PY}-08-28` }; // 8월말 → 9월초 지급(예측)
  const slots = buildPaySlots(codeHistory, codeExHistory, [], CY);
  const sep = slots[8]; // 9월
  expectEq(sep.length, 1, '9월 소스 개수');
  expectEq(sep[0].exPredicted, true, '9월 소스는 예측');
});

console.log('\n[4] 같은 지급월 확정 2건은 합산 유지(특별+정기 등 정상 중복)');
it('확정 소스끼리는 제거하지 않고 둘 다 유지', () => {
  // 같은 달에 확정 배당락이 2건(서로 다른 exYm) — 둘 다 6월 지급으로 확정
  const codeHistory = { [`${CY}-05`]: 300, [`${CY}-06`]: 50 };
  const codeExHistory = {
    [`${CY}-05`]: `${CY}-05-28`, // → 6월1일
    [`${CY}-06`]: `${CY}-06-15`, // → 6월17일 (둘 다 확정)
  };
  const slots = buildPaySlots(codeHistory, codeExHistory, [], CY);
  expectEq(slots[5].length, 2, '6월 확정 2건 유지');
  expectEq(slots[5].every(s => s.exPredicted === false), true, '둘 다 확정');
});

console.log('\n[5] 직전연도 12월 배당락 → 올해 1월 지급 편입 유지');
it('prevDec→Jan 폴백이 가드에 의해 사라지지 않음', () => {
  const codeHistory = { [`${PY}-12`]: 27 };
  const codeExHistory = {}; // 12월 확정 배당락 미확정 → 월말 추정
  const slots = buildPaySlots(codeHistory, codeExHistory, [], CY);
  expectEq(slots[0].length, 1, '1월 소스 개수');
  expectEq(slots[0][0].exYm, `${PY}-12`, '1월 소스 exYm(직전연도 12월)');
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
