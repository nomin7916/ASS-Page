// 한국 ETF 배당 과세 계산 단위 테스트 (calculateKrEtfDividendTax).
// 실행: npm run verify:tax
// 차이 발생 시 종료코드 1.
//
// utils.ts는 TS이므로 esbuild나 tsc 없이 직접 import 불가 →
// 함수 본문을 그대로 재정의(=참조 구현)하고 케이스 검증.
// 본 파일과 src/utils.ts의 함수 본문은 항상 동기화 필요.

function calculateKrEtfDividendTax(purchases, dividend, options = {}) {
  const taxRate = options.taxRate ?? 0.154;
  const saleMethod = options.saleMethod ?? 'avg';
  const sales = options.sales ?? [];
  const perShareDecimals = options.perShareDecimals ?? 2;

  if (!Array.isArray(purchases) || purchases.length === 0) {
    throw new Error('매입 이벤트가 최소 1건 필요합니다.');
  }
  if (!dividend || !/^\d{4}-\d{2}-\d{2}$/.test(String(dividend.exDate || ''))) {
    throw new Error('배당락일이 올바른 YYYY-MM-DD 형식이 아닙니다.');
  }
  if (!(dividend.exTaxBasePrice > 0)) {
    throw new Error('배당락일 과표기준가는 0보다 커야 합니다.');
  }
  if (!(dividend.perShareGrossDividend >= 0)) {
    throw new Error('주당 세전 배당금은 0 이상이어야 합니다.');
  }
  if (saleMethod !== 'avg') {
    throw new Error(`saleMethod '${saleMethod}' 미지원 (v1: 'avg'만 지원)`);
  }

  purchases.forEach((p, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) {
      throw new Error(`매입[${i}] 날짜 형식 오류: ${p.date}`);
    }
    if (!Number.isFinite(p.shares) || p.shares <= 0 || !Number.isInteger(p.shares)) {
      throw new Error(`매입[${i}] 주식수는 양의 정수여야 합니다: ${p.shares}`);
    }
    if (!Number.isFinite(p.taxBasePrice) || p.taxBasePrice <= 0) {
      throw new Error(`매입[${i}] 과표기준가는 0보다 커야 합니다: ${p.taxBasePrice}`);
    }
  });
  sales.forEach((s, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) {
      throw new Error(`매도[${i}] 날짜 형식 오류: ${s.date}`);
    }
    if (!Number.isFinite(s.shares) || s.shares <= 0 || !Number.isInteger(s.shares)) {
      throw new Error(`매도[${i}] 주식수는 양의 정수여야 합니다: ${s.shares}`);
    }
  });

  const events = [
    ...purchases.map(p => ({ date: p.date, kind: 'B', shares: p.shares, price: p.taxBasePrice })),
    ...sales.map(s => ({ date: s.date, kind: 'S', shares: s.shares })),
  ]
    .filter(e => e.date <= dividend.exDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'B' ? -1 : 1));

  let heldShares = 0;
  let totalCost = 0;
  for (const e of events) {
    if (e.kind === 'B') {
      totalCost += e.shares * e.price;
      heldShares += e.shares;
    } else {
      if (e.shares > heldShares) {
        throw new Error(`매도 ${e.date}: 보유수량(${heldShares}) 초과 매도(${e.shares})`);
      }
      const costPerShare = heldShares > 0 ? totalCost / heldShares : 0;
      totalCost -= e.shares * costPerShare;
      heldShares -= e.shares;
    }
  }

  if (heldShares <= 0) {
    return { weightedAvgTaxBase: 0, taxablePerShare: 0, totalShares: 0, taxableAmount: 0, tax: 0, grossDividend: 0, netDividend: 0 };
  }

  const weightedAvgTaxBase = totalCost / heldShares;
  const rawTaxablePerShare = Math.max(0, dividend.exTaxBasePrice - weightedAvgTaxBase);
  const factor = 10 ** perShareDecimals;
  const taxablePerShare = Math.round(rawTaxablePerShare * factor) / factor;
  const totalShares = heldShares;
  const taxableAmount = Math.round(taxablePerShare * totalShares);
  const tax = Math.round(taxableAmount * taxRate);
  const grossDividend = Math.round(dividend.perShareGrossDividend * totalShares);
  const netDividend = grossDividend - tax;

  return { weightedAvgTaxBase, taxablePerShare, totalShares, taxableAmount, tax, grossDividend, netDividend };
}

// ─── 테스트 러너 ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const FAILS = [];

function approx(actual, expected, tol = 0.01) {
  return Math.abs(actual - expected) <= tol;
}
function it(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    FAILS.push({ name, msg: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}
function expectEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: ${actual} ≠ ${expected}`);
}
function expectApprox(actual, expected, tol, label) {
  if (!approx(actual, expected, tol)) throw new Error(`${label}: ${actual} ≉ ${expected} (tol=${tol})`);
}
function expectThrows(fn, msgFragment) {
  try { fn(); } catch (e) {
    if (msgFragment && !String(e.message).includes(msgFragment)) {
      throw new Error(`예외 메시지 불일치: "${e.message}" (expected to include "${msgFragment}")`);
    }
    return;
  }
  throw new Error('예외가 발생하지 않음');
}

console.log('\n── 한국 ETF 배당 과세 계산 검증 ──\n');

console.log('[1] 명세 예시 케이스 (KODEX 200, 20,001주)');
it('가중평균·과세대상단가·세금·세전·세후 정확히 일치', () => {
  const r = calculateKrEtfDividendTax(
    [
      { date: '2026-04-13', shares: 17516, taxBasePrice: 9836.56 },
      { date: '2026-04-14', shares: 400,   taxBasePrice: 9837.45 },
      { date: '2026-04-15', shares: 2085,  taxBasePrice: 9837.65 },
    ],
    { exDate: '2026-05-30', exTaxBasePrice: 9841.20, perShareGrossDividend: 348 },
  );
  expectApprox(r.weightedAvgTaxBase, 9836.69, 0.01, 'weightedAvgTaxBase');
  expectEq(r.taxablePerShare, 4.51, 'taxablePerShare');
  expectEq(r.totalShares, 20001, 'totalShares');
  expectEq(r.taxableAmount, 90205, 'taxableAmount');
  expectEq(r.tax, 13892, 'tax');
  expectEq(r.grossDividend, 6960348, 'grossDividend');
  expectEq(r.netDividend, 6946456, 'netDividend');
});

console.log('\n[2] 매입 과표 > 배당락 과표 → 과세 0');
it('taxable 음수가 0으로 클램프', () => {
  const r = calculateKrEtfDividendTax(
    [{ date: '2026-01-01', shares: 100, taxBasePrice: 10000 }],
    { exDate: '2026-02-01', exTaxBasePrice: 9900, perShareGrossDividend: 50 },
  );
  expectEq(r.taxablePerShare, 0, 'taxablePerShare');
  expectEq(r.taxableAmount, 0, 'taxableAmount');
  expectEq(r.tax, 0, 'tax');
  expectEq(r.grossDividend, 5000, 'grossDividend');
  expectEq(r.netDividend, 5000, 'netDividend');
});

console.log('\n[3] 평균법 매도 — 가중평균 단가 유지, 보유수량만 차감');
it('100주 @10000 + 100주 @11000 매수 → 50주 매도 → 보유 150, avg 10500', () => {
  const r = calculateKrEtfDividendTax(
    [
      { date: '2026-01-01', shares: 100, taxBasePrice: 10000 },
      { date: '2026-02-01', shares: 100, taxBasePrice: 11000 },
    ],
    { exDate: '2026-04-01', exTaxBasePrice: 10600, perShareGrossDividend: 100 },
    { sales: [{ date: '2026-03-01', shares: 50 }] },
  );
  expectApprox(r.weightedAvgTaxBase, 10500, 0.0001, 'weightedAvgTaxBase');
  expectEq(r.taxablePerShare, 100, 'taxablePerShare');
  expectEq(r.totalShares, 150, 'totalShares');
  expectEq(r.taxableAmount, 15000, 'taxableAmount');
  expectEq(r.tax, 2310, 'tax');
});

console.log('\n[4] 배당락일 이후 매입은 무시');
it('ex-date 이후 매입은 가중평균에 영향 없음', () => {
  const r = calculateKrEtfDividendTax(
    [
      { date: '2026-01-01', shares: 100, taxBasePrice: 10000 },
      { date: '2026-06-01', shares: 500, taxBasePrice: 99999 }, // ex-date 이후
    ],
    { exDate: '2026-03-31', exTaxBasePrice: 10100, perShareGrossDividend: 100 },
  );
  expectEq(r.totalShares, 100, 'totalShares (ex-date 시점)');
  expectApprox(r.weightedAvgTaxBase, 10000, 0.0001, 'weightedAvgTaxBase');
});

console.log('\n[5] 매도가 보유수량 초과 → Error');
it('초과 매도 throw', () => {
  expectThrows(() => calculateKrEtfDividendTax(
    [{ date: '2026-01-01', shares: 100, taxBasePrice: 10000 }],
    { exDate: '2026-03-01', exTaxBasePrice: 10100, perShareGrossDividend: 100 },
    { sales: [{ date: '2026-02-01', shares: 150 }] },
  ), '초과 매도');
});

console.log('\n[6] 입력 검증');
it('매입 0건 → throw', () => {
  expectThrows(() => calculateKrEtfDividendTax([], { exDate: '2026-01-01', exTaxBasePrice: 100, perShareGrossDividend: 0 }), '매입 이벤트가 최소 1건');
});
it('음수 shares → throw', () => {
  expectThrows(() => calculateKrEtfDividendTax(
    [{ date: '2026-01-01', shares: -5, taxBasePrice: 10000 }],
    { exDate: '2026-02-01', exTaxBasePrice: 10100, perShareGrossDividend: 0 },
  ), '양의 정수');
});
it('소수 shares → throw', () => {
  expectThrows(() => calculateKrEtfDividendTax(
    [{ date: '2026-01-01', shares: 1.5, taxBasePrice: 10000 }],
    { exDate: '2026-02-01', exTaxBasePrice: 10100, perShareGrossDividend: 0 },
  ), '양의 정수');
});
it('0 taxBasePrice → throw', () => {
  expectThrows(() => calculateKrEtfDividendTax(
    [{ date: '2026-01-01', shares: 100, taxBasePrice: 0 }],
    { exDate: '2026-02-01', exTaxBasePrice: 10100, perShareGrossDividend: 0 },
  ), '과표기준가는 0보다');
});
it('잘못된 ex-date → throw', () => {
  expectThrows(() => calculateKrEtfDividendTax(
    [{ date: '2026-01-01', shares: 100, taxBasePrice: 10000 }],
    { exDate: 'invalid', exTaxBasePrice: 10100, perShareGrossDividend: 0 },
  ), 'YYYY-MM-DD');
});
it('saleMethod=fifo → throw (v1 미지원)', () => {
  expectThrows(() => calculateKrEtfDividendTax(
    [{ date: '2026-01-01', shares: 100, taxBasePrice: 10000 }],
    { exDate: '2026-02-01', exTaxBasePrice: 10100, perShareGrossDividend: 0 },
    { saleMethod: 'fifo' },
  ), '미지원');
});

console.log('\n[7] 부동소수점 누적 — 소수 둘째자리 과표 1000건 매수');
it('1000건 누적 후에도 평균이 안정적', () => {
  const purchases = Array.from({ length: 1000 }, (_, i) => ({
    date: '2026-01-01', shares: 10, taxBasePrice: 9836.56 + (i % 5) * 0.01,
  }));
  const r = calculateKrEtfDividendTax(
    purchases,
    { exDate: '2026-06-01', exTaxBasePrice: 9841.20, perShareGrossDividend: 348 },
  );
  expectEq(r.totalShares, 10000, 'totalShares');
  // 예상 평균 = 9836.56 + 0.01*0.4 (i%5 = 0,1,2,3,4 평균 = 2 → 0.02) wait...
  // i%5 = 0,1,2,3,4 균등, 평균 = 2.0 → +0.02
  expectApprox(r.weightedAvgTaxBase, 9836.58, 0.001, 'weightedAvgTaxBase');
});

console.log('\n[8] 전량 매도 후 배당락 → 보유 0 케이스');
it('보유 0이면 모든 값 0', () => {
  const r = calculateKrEtfDividendTax(
    [{ date: '2026-01-01', shares: 100, taxBasePrice: 10000 }],
    { exDate: '2026-04-01', exTaxBasePrice: 10100, perShareGrossDividend: 100 },
    { sales: [{ date: '2026-03-01', shares: 100 }] },
  );
  expectEq(r.totalShares, 0, 'totalShares');
  expectEq(r.tax, 0, 'tax');
  expectEq(r.grossDividend, 0, 'grossDividend');
  expectEq(r.netDividend, 0, 'netDividend');
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
