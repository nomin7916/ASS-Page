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

// ─── src/krEtfTaxHelpers.ts 참조 구현 미러 ───────────────────────────────────
// ⚠️ 아래 3함수의 본문은 src/krEtfTaxHelpers.ts와 항상 1:1 동기화할 것.
function safeNum(v) {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function resolveAvgBuyPrice(stock, fallbackAvg, fallbackReliable = true) {
  const qty = safeNum(stock?.quantity);
  const inv = safeNum(stock?.investAmount);
  if (qty > 0 && inv > 0) return { value: inv / qty, source: 'portfolio' };
  const pp = safeNum(stock?.purchasePrice);
  if (pp > 0) return { value: pp, source: 'item' };
  const fb = safeNum(fallbackAvg);
  if (fb > 0) return fallbackReliable ? { value: fb, source: 'events' } : { value: 0, source: 'unreliable' };
  return { value: 0, source: 'none' };
}

const PER_SHARE_EPS = 1e-6;
const snapZero = (v) => (Math.abs(v) < PER_SHARE_EPS ? 0 : v);

function computeSellTaxRow({ change, taxBasePrice, sellPrice, avgTaxBase, avgBuyPrice }) {
  const changeNum = safeNum(change);
  const isSell = changeNum < 0;
  const soldQty = isSell ? -changeNum : 0;
  const sell = safeNum(sellPrice);
  const exBase = safeNum(taxBasePrice);
  const avgTb = safeNum(avgTaxBase);
  const avgBuy = safeNum(avgBuyPrice);

  const sellAmount = isSell && sell > 0 ? soldQty * sell : null;

  const baseReady = isSell && exBase > 0 && avgTb > 0;
  const basePerShare = baseReady ? snapZero(exBase - avgTb) : 0;
  const baseAmount = basePerShare > 0 ? basePerShare * soldQty : 0;

  const priceReady = isSell && sell > 0 && avgBuy > 0;
  const pricePerShare = priceReady ? snapZero(sell - avgBuy) : 0;
  const priceAmount = pricePerShare > 0 ? pricePerShare * soldQty : 0;

  let taxable = null;      // true=과세 / false=비과세 / null=판정 불가(입력 부족)
  let exemptReason = null; // 'base' | 'price' | 'both'
  if (isSell) {
    const baseExempt = baseReady && basePerShare <= 0;
    const priceExempt = priceReady && pricePerShare <= 0;
    if (baseExempt || priceExempt) {
      taxable = false;
      exemptReason = baseExempt && priceExempt ? 'both' : baseExempt ? 'base' : 'price';
    } else if (baseReady && priceReady) {
      taxable = true;
    }
  }
  const actualPerShare = taxable ? Math.min(basePerShare, pricePerShare) : 0;
  const actualAmount = taxable ? actualPerShare * soldQty : 0;

  return {
    isSell, soldQty, sellAmount,
    baseReady, basePerShare, baseAmount,
    priceReady, pricePerShare, priceAmount,
    taxable, exemptReason, actualPerShare, actualAmount,
  };
}

console.log('\n[9] resolveAvgBuyPrice — 평균단가(구매단가) 해석');
it('국내 주식: investAmount ÷ quantity (포트폴리오 테이블 구매단가와 동일 정의)', () => {
  const r = resolveAvgBuyPrice({ quantity: 100, investAmount: 869920, purchasePrice: 0 }, 0);
  expectApprox(r.value, 8699.2, 0.0001, 'value');
  expectEq(r.source, 'portfolio', 'source');
});
it('investAmount가 있어도 quantity 0이면 나눗셈하지 않고 폴백 (Infinity 방지)', () => {
  const r = resolveAvgBuyPrice({ quantity: 0, investAmount: 869920, purchasePrice: 8700 }, 0);
  expectEq(r.value, 8700, 'value');
  expectEq(r.source, 'item', 'source');
});
it('해외·붙여넣기 임포트 행: purchasePrice 폴백', () => {
  const r = resolveAvgBuyPrice({ quantity: 100, investAmount: 0, purchasePrice: 8700 }, 9999);
  expectEq(r.value, 8700, 'value');
  expectEq(r.source, 'item', 'source');
});
it('전량 매도·유령 행: 계산기 매수 평균으로 폴백', () => {
  const r = resolveAvgBuyPrice({ quantity: 0, investAmount: 0, purchasePrice: 0 }, 8699.2);
  expectApprox(r.value, 8699.2, 0.0001, 'value');
  expectEq(r.source, 'events', 'source');
});
it('전부 없음 → 0 / none (판정 불가로 흐름)', () => {
  const r = resolveAvgBuyPrice({}, 0);
  expectEq(r.value, 0, 'value');
  expectEq(r.source, 'none', 'source');
});
it('stock이 undefined여도 throw하지 않음', () => {
  const r = resolveAvgBuyPrice(undefined, 0);
  expectEq(r.source, 'none', 'source');
});
it('문자열·콤마 입력 정규화', () => {
  const r = resolveAvgBuyPrice({ quantity: '100', investAmount: '869,920' }, 0);
  expectApprox(r.value, 8699.2, 0.0001, 'value');
  expectEq(r.source, 'portfolio', 'source');
});
it('폴백 신뢰 불가(매입단가 미입력 매수 행 존재) → events 폴백을 쓰지 않고 판정 보류', () => {
  const r = resolveAvgBuyPrice({ quantity: 0, investAmount: 0 }, 10000, false);
  expectEq(r.value, 0, 'value');
  expectEq(r.source, 'unreliable', 'source');
});
it('폴백 신뢰 불가여도 포트폴리오 구매단가가 있으면 그대로 사용', () => {
  const r = resolveAvgBuyPrice({ quantity: 100, investAmount: 869920 }, 10000, false);
  expectApprox(r.value, 8699.2, 0.0001, 'value');
  expectEq(r.source, 'portfolio', 'source');
});
it('폴백 신뢰 불가 + 폴백값도 없음 → none (unreliable로 오표기하지 않음)', () => {
  const r = resolveAvgBuyPrice({}, 0, false);
  expectEq(r.source, 'none', 'source');
});
it('부분 평균으로 비과세를 확정하던 회귀 — 미입력 행이 있으면 단가 기준이 통째로 보류된다', () => {
  // 매수 100주@10,000(입력) + 900주(미입력) → 부분 평균 10,000. 매도단가 9,000이면
  // 부분 평균 기준으로는 -1,000 → '비과세 확정'이지만 실제 평균(8,200) 기준으로는 +800 과세다.
  const avg = resolveAvgBuyPrice({ quantity: 0, investAmount: 0 }, 10000, false);
  const r = computeSellTaxRow({ change: -1000, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: 9000, avgBuyPrice: avg.value });
  expectEq(r.priceReady, false, 'priceReady');
  expectEq(r.taxable, null, 'taxable (비과세로 확정하지 않는다)');
});

console.log('\n[10] computeSellTaxRow — 과표 기준 · 단가 기준 · 실제 과세');
const SELL = (o) => computeSellTaxRow({ change: 0, taxBasePrice: 0, sellPrice: 0, avgTaxBase: 0, avgBuyPrice: 0, ...o });

it('매수 행은 전부 미산출 (isSell=false, taxable=null, sellAmount=null)', () => {
  const r = SELL({ change: 100, taxBasePrice: 10100, sellPrice: 12000, avgTaxBase: 10000, avgBuyPrice: 11000 });
  expectEq(r.isSell, false, 'isSell');
  expectEq(r.soldQty, 0, 'soldQty');
  expectEq(r.sellAmount, null, 'sellAmount');
  expectEq(r.taxable, null, 'taxable');
  expectEq(r.baseAmount, 0, 'baseAmount');
  expectEq(r.priceAmount, 0, 'priceAmount');
});
it('매매수량 0 행도 미산출', () => {
  const r = SELL({ change: 0, taxBasePrice: 10100, sellPrice: 12000, avgTaxBase: 10000, avgBuyPrice: 11000 });
  expectEq(r.isSell, false, 'isSell');
  expectEq(r.taxable, null, 'taxable');
});
it('둘 다 이익 → 과세, 실제 과세표준 = 1주당 min × 매도수량 (과표가 작은 경우)', () => {
  const r = SELL({ change: -100, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: 12000, avgBuyPrice: 11000 });
  expectEq(r.taxable, true, 'taxable');
  expectApprox(r.basePerShare, 100, 1e-9, 'basePerShare');
  expectApprox(r.pricePerShare, 1000, 1e-9, 'pricePerShare');
  expectApprox(r.baseAmount, 10000, 1e-6, 'baseAmount');
  expectApprox(r.priceAmount, 100000, 1e-6, 'priceAmount');
  expectApprox(r.actualPerShare, 100, 1e-9, 'actualPerShare');
  expectApprox(r.actualAmount, 10000, 1e-6, 'actualAmount');
  expectEq(r.exemptReason, null, 'exemptReason');
});
it('둘 다 이익 → min이 단가 쪽인 경우도 정확 (방향 반대)', () => {
  const r = SELL({ change: -100, taxBasePrice: 12000, avgTaxBase: 10000, sellPrice: 11500, avgBuyPrice: 11000 });
  expectEq(r.taxable, true, 'taxable');
  expectApprox(r.actualPerShare, 500, 1e-9, 'actualPerShare');
  expectApprox(r.actualAmount, 50000, 1e-6, 'actualAmount');
});
it('actualAmount === min(baseAmount, priceAmount) — 둘 다 양수일 때 동치', () => {
  for (const [tb, sp] of [[10100, 12000], [12000, 11500], [10500, 11500]]) {
    const r = SELL({ change: -137, taxBasePrice: tb, avgTaxBase: 10000, sellPrice: sp, avgBuyPrice: 11000 });
    expectApprox(r.actualAmount, Math.min(r.baseAmount, r.priceAmount), 1e-6, `actualAmount(${tb},${sp})`);
  }
});
it('과표만 손실 → 비과세 (reason=base), 실제 금액 0', () => {
  const r = SELL({ change: -100, taxBasePrice: 9900, avgTaxBase: 10000, sellPrice: 12000, avgBuyPrice: 11000 });
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'base', 'exemptReason');
  expectEq(r.actualAmount, 0, 'actualAmount');
  expectApprox(r.priceAmount, 100000, 1e-6, 'priceAmount는 그대로 표시');
});
it('단가만 손실 → 비과세 (reason=price)', () => {
  const r = SELL({ change: -100, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: 10500, avgBuyPrice: 11000 });
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'price', 'exemptReason');
  expectEq(r.actualAmount, 0, 'actualAmount');
  expectEq(r.priceAmount, 0, 'priceAmount 음수는 0 클램프');
});
it('둘 다 손실 → 비과세 (reason=both)', () => {
  const r = SELL({ change: -100, taxBasePrice: 9900, avgTaxBase: 10000, sellPrice: 10500, avgBuyPrice: 11000 });
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'both', 'exemptReason');
});
it('1주당 차이가 정확히 0 → 비과세 (0은 과세하지 않음, 기존 열과 같은 규약)', () => {
  const r = SELL({ change: -100, taxBasePrice: 10000, avgTaxBase: 10000, sellPrice: 12000, avgBuyPrice: 11000 });
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'base', 'exemptReason');
  const r2 = SELL({ change: -100, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: 11000, avgBuyPrice: 11000 });
  expectEq(r2.taxable, false, 'taxable(단가 0)');
  expectEq(r2.exemptReason, 'price', 'exemptReason(단가 0)');
});
it('매도단가 미입력 + 과표 이익 → 판정 불가 (null, 조용한 과세 확정 금지)', () => {
  const r = SELL({ change: -100, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: 0, avgBuyPrice: 11000 });
  expectEq(r.taxable, null, 'taxable');
  expectEq(r.priceReady, false, 'priceReady');
  expectApprox(r.baseAmount, 10000, 1e-6, 'baseAmount는 계속 표시');
});
it('매도단가 미입력 + 과표 손실 → 한쪽만으로 비과세 확정', () => {
  const r = SELL({ change: -100, taxBasePrice: 9900, avgTaxBase: 10000, sellPrice: 0, avgBuyPrice: 11000 });
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'base', 'exemptReason');
});
it('과표기준가 미입력 + 단가 손실 → 한쪽만으로 비과세 확정', () => {
  const r = SELL({ change: -100, taxBasePrice: 0, avgTaxBase: 10000, sellPrice: 10500, avgBuyPrice: 11000 });
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'price', 'exemptReason');
  expectEq(r.baseReady, false, 'baseReady');
});
it('평균 과표 0(매수 이벤트에 과표 미입력) + 단가 이익 → 판정 불가', () => {
  const r = SELL({ change: -100, taxBasePrice: 10100, avgTaxBase: 0, sellPrice: 12000, avgBuyPrice: 11000 });
  expectEq(r.taxable, null, 'taxable');
  expectEq(r.baseReady, false, 'baseReady');
});
it('둘 다 미입력 → 판정 불가', () => {
  const r = SELL({ change: -100 });
  expectEq(r.taxable, null, 'taxable');
  expectEq(r.sellAmount, null, 'sellAmount');
});
it('평균단가 0(구매단가 산출 불가) → 단가 기준 미준비', () => {
  const r = SELL({ change: -100, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: 12000, avgBuyPrice: 0 });
  expectEq(r.priceReady, false, 'priceReady');
  expectEq(r.taxable, null, 'taxable');
});
it('매도금액 = 매도수량 × 매도단가', () => {
  const r = SELL({ change: -630, sellPrice: 8150 });
  expectEq(r.soldQty, 630, 'soldQty');
  expectEq(r.sellAmount, 5134500, 'sellAmount');
});
it('음수 매도단가는 미준비로 처리 (매도금액·단가 판정 없음)', () => {
  const r = SELL({ change: -100, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: -500, avgBuyPrice: 11000 });
  expectEq(r.sellAmount, null, 'sellAmount');
  expectEq(r.priceReady, false, 'priceReady');
  expectEq(r.taxable, null, 'taxable');
});
it('문자열·콤마 입력 정규화 (input value는 항상 문자열)', () => {
  const r = SELL({ change: '-630', taxBasePrice: '9773.99', avgTaxBase: 9775.22, sellPrice: '8,150', avgBuyPrice: '8699.20' });
  expectEq(r.isSell, true, 'isSell');
  expectEq(r.sellAmount, 5134500, 'sellAmount');
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'both', 'exemptReason');
});
it('실데이터 회귀 (KODEX 200커버드콜액티브 2026-08-05 매도 630주)', () => {
  const r = SELL({ change: -630, taxBasePrice: 9773.99, avgTaxBase: 9775.22, sellPrice: 8150, avgBuyPrice: 8699.20 });
  expectApprox(r.basePerShare, -1.23, 0.001, 'basePerShare');   // 화면 표기 -1.23/주와 일치
  expectApprox(r.pricePerShare, -549.20, 0.001, 'pricePerShare');
  expectEq(r.baseAmount, 0, 'baseAmount');
  expectEq(r.priceAmount, 0, 'priceAmount');
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'both', 'exemptReason');
  expectEq(r.sellAmount, 5134500, 'sellAmount');
});
it('부동소수점 잔차는 0으로 스냅 — 표기 0.00인데 과세로 판정되던 회귀', () => {
  // 같은 과표기준가로 7주 + 137주 매수 → 가중평균에 IEEE754 잔차가 남는다(수학적으로는 9773.99).
  let qty = 0, avg = 0;
  for (const n of [7, 137]) { const nq = qty + n; avg = (qty * avg + n * 9773.99) / nq; qty = nq; }
  if (avg === 9773.99) throw new Error('픽스처 무효: 잔차가 생기지 않아 이 회귀를 재현하지 못함');
  const r = computeSellTaxRow({ change: -100, taxBasePrice: 9773.99, avgTaxBase: avg, sellPrice: 9000, avgBuyPrice: 8000 });
  expectEq(r.basePerShare, 0, 'basePerShare (잔차 스냅)');
  expectEq(r.baseAmount, 0, 'baseAmount');
  expectEq(r.taxable, false, 'taxable (과세 ₩0으로 단언하지 않는다)');
  expectEq(r.exemptReason, 'base', 'exemptReason');
});
it('epsilon보다 큰 실제 차이는 스냅되지 않음', () => {
  const r = computeSellTaxRow({ change: -100, taxBasePrice: 10000.01, avgTaxBase: 10000, sellPrice: 9000, avgBuyPrice: 8000 });
  expectApprox(r.basePerShare, 0.01, 1e-9, 'basePerShare');
  expectEq(r.taxable, true, 'taxable');
  expectApprox(r.actualAmount, 1, 1e-6, 'actualAmount (0.01 × 100주)');
});
it('단가 쪽 잔차도 동일하게 스냅', () => {
  const r = computeSellTaxRow({ change: -100, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: 8699.2, avgBuyPrice: 8699.2 + 1e-11 });
  expectEq(r.pricePerShare, 0, 'pricePerShare');
  expectEq(r.taxable, false, 'taxable');
  expectEq(r.exemptReason, 'price', 'exemptReason');
});
it('소수 매도수량도 붕괴하지 않음', () => {
  const r = SELL({ change: -0.5, taxBasePrice: 10100, avgTaxBase: 10000, sellPrice: 12000, avgBuyPrice: 11000 });
  expectEq(r.soldQty, 0.5, 'soldQty');
  expectEq(r.taxable, true, 'taxable');
  expectApprox(r.actualAmount, 50, 1e-9, 'actualAmount');
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
