import { readFileSync } from 'node:fs';

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
function ok(cond, label = '가드 불일치') {
  if (!cond) throw new Error(label);
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

// ─── src/krEtfTaxHelpers.ts computeSellRealized 참조 미러 ────────────────────
// ⚠️ 본문은 src/krEtfTaxHelpers.ts의 computeSellRealized와 항상 1:1 동기화할 것.
function computeSellRealized({ change, sellPrice, basisPrice }) {
  const changeNum = safeNum(change);
  const isSell = changeNum < 0;
  const soldQty = isSell ? -changeNum : 0;
  const sell = safeNum(sellPrice);
  const basis = safeNum(basisPrice);

  const ready = isSell && sell > 0 && basis > 0;
  const amount = ready ? soldQty * sell : null;
  const cost = ready ? basis * soldQty : null;
  const perShare = ready ? snapZero(sell - basis) : null;
  const profit = ready ? perShare * soldQty : null;
  const rate = ready && cost > 0 ? (profit / cost) * 100 : null;

  return { isSell, soldQty, basis: ready ? basis : null, amount, cost, perShare, profit, rate };
}

// ⚠️ KrEtfTaxMatrix.tsx의 buildSortedEventsWithAvg가 만드는 '매도 시점 러닝 평균 매입단가'와
//    항상 1:1 동기화할 것. 이동평균법 — 매수만 가중평균을 갱신하고 매도는 수량만 줄인다.
const RZ_ISO = /^\d{4}-\d{2}-\d{2}$/;
// ⚠️ buyAvgTrusted까지 미러해야 한다 — 컴포넌트 resolveBasis의 러닝 평균 분기는
//    `row.buyAvgTrusted && row.runningBuyAvg > 0`인데 이걸 빠뜨리면 미러가 **도달 불가능한
//    'running' 폴백**을 단언하게 되고(적대적 리뷰 확정), 컴포넌트에서 그 게이트를 지워도 통과한다.
function runningBuyAvgSeries(events) {
  const valid = (events || [])
    .filter(e => RZ_ISO.test(String(e.date || '')))
    .sort(compareTaxEvents);
  const undatedTrade = (events || []).some(e => safeNum(e.change) !== 0 && !RZ_ISO.test(String(e.date || '')));
  let buyQty = 0, buyAvg = 0;
  let excludedSeen = undatedTrade;
  return valid.map(evt => {
    const change = safeNum(evt.change);
    if (change > 0) {
      const pp = safeNum(evt.purchasePrice);
      if (pp > 0) {
        const nq = buyQty + change;
        buyAvg = nq > 0 ? (buyQty * buyAvg + change * pp) / nq : 0;
        buyQty = nq;
      } else {
        excludedSeen = true;
      }
    } else if (change < 0) {
      buyQty = Math.max(0, buyQty + change);
    }
    return { evt, runningBuyAvg: buyAvg, buyAvgTrusted: !excludedSeen };
  });
}
const RZ = (o) => computeSellRealized({ change: 0, sellPrice: 0, basisPrice: 0, ...o });

// ─── src/krEtfTaxHelpers.ts buildLofoLotSeries 참조 미러 ─────────────────────
// ⚠️ 본문은 src/krEtfTaxHelpers.ts의 compareTaxEvents·buildLofoLotSeries와 항상 1:1 동기화할 것
//    (#G12가 buildLofoLotSeries 본문을 문자 단위로 대조한다).
function compareTaxEvents(a, b) {
  const byDate = String(a?.date || '').localeCompare(String(b?.date || ''));
  if (byDate !== 0) return byDate;
  return (safeNum(b?.change) > 0 ? 1 : 0) - (safeNum(a?.change) > 0 ? 1 : 0);
}

const LOT_QTY_EPS = 1e-9;

function buildLofoLotSeries(events) {
  const valid = (events || [])
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')))
    .sort(compareTaxEvents);
  const undatedTrade = (events || []).some(e => safeNum(e.change) !== 0 && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')));
  const lots = [];
  let excludedSeen = undatedTrade;
  let seq = 0;
  const out = new Map();
  for (const evt of valid) {
    const change = safeNum(evt.change);
    if (change > 0) {
      const pp = safeNum(evt.purchasePrice);
      if (pp > 0) lots.push({ price: pp, qty: change, date: String(evt.date || ''), seq: seq++ });
      else excludedSeen = true;
      continue;
    }
    if (change === 0) continue;
    const order = lots
      .filter(l => l.qty > LOT_QTY_EPS)
      .sort((a, b) => (a.price - b.price) || (a.seq - b.seq));
    let rest = -change;
    const matched = [];
    for (const l of order) {
      if (rest <= LOT_QTY_EPS) break;
      const take = Math.min(l.qty, rest);
      l.qty -= take;
      rest -= take;
      matched.push({ date: l.date, price: l.price, qty: take });
    }
    const matchedQty = -change - rest;
    const cost = matched.reduce((s, m) => s + m.price * m.qty, 0);
    out.set(evt, {
      basis: matchedQty > LOT_QTY_EPS ? cost / matchedQty : 0,
      cost,
      lots: matched,
      matchedQty,
      shortfallQty: rest > LOT_QTY_EPS ? rest : 0,
      trusted: !excludedSeen,
    });
  }
  return out;
}

// KrEtfTaxMatrix.resolveBasis의 우선순위(최저가 매칭 → 러닝 평균 → avgBuy)를 그대로 재현한다.
// ⚠️ 게이트 3항(trusted · shortfall 0 · basis > 0)을 빠뜨리면 없는 매수분을 싼값으로 단언한다.
function lofoBasisOf(events, avgBuyValue = 0, avgBuySource = 'none') {
  const lofo = buildLofoLotSeries(events);
  const rows = runningBuyAvgSeries(events);
  return rows.map(({ evt, runningBuyAvg, buyAvgTrusted }) => {
    const lf = lofo.get(evt);
    const short = lf ? lf.shortfallQty : 0;
    if (lf && lf.trusted && lf.shortfallQty === 0 && lf.basis > 0) {
      return { evt, value: lf.basis, source: 'lofo', lots: lf.lots, shortfallQty: 0 };
    }
    if (buyAvgTrusted && runningBuyAvg > 0) return { evt, value: runningBuyAvg, source: 'running', lots: null, shortfallQty: short };
    if (avgBuyValue > 0) return { evt, value: avgBuyValue, source: avgBuySource, lots: null, shortfallQty: short };
    return { evt, value: 0, source: avgBuySource, lots: null, shortfallQty: short };
  });
}

// 사용자 실측 픽스처 (KODEX 200커버드콜액티브 — 화면 캡처 2026-08-13)
const REAL_EVENTS = [
  { id: 'b1', date: '2026-07-14', change: 10000, purchasePrice: 8524 },
  { id: 'b2', date: '2026-07-15', change: 6860, purchasePrice: 9405 },
  { id: 'b3', date: '2026-07-20', change: 120, purchasePrice: 8451.67 },
  { id: 'b4', date: '2026-07-21', change: 146, purchasePrice: 8745 },
  { id: 'b5', date: '2026-07-28', change: 2113, purchasePrice: 7778 },
  { id: 'b6', date: '2026-07-29', change: 761, purchasePrice: 7227 },
  { id: 's1', date: '2026-08-05', change: -630, sellPrice: 8260 },
  { id: 's2', date: '2026-08-11', change: -20, sellPrice: 7820 },
  { id: 's3', date: '2026-08-12', change: -421, sellPrice: 8071 },
];

console.log('\n[11] computeSellRealized — 매도 실현손익');
it('손실 매도 — 부호가 보존된다 (priceAmount식 0 클램프 재사용 금지)', () => {
  const r = RZ({ change: -630, sellPrice: 8260, basisPrice: 8699.19657 });
  expectApprox(r.profit, -276694.0, 1.0, 'profit');
  expectApprox(r.cost, 5480493.84, 0.01, 'cost');
  expectApprox(r.perShare, -439.19657, 1e-4, 'perShare');
  expectApprox(r.rate, -5.0489, 1e-3, 'rate');
});
it('이익 매도 — 금액·주당·수익률', () => {
  const r = RZ({ change: -100, sellPrice: 12000, basisPrice: 11000 });
  expectApprox(r.profit, 100000, 1e-6, 'profit');
  expectApprox(r.amount, 1200000, 1e-6, 'amount');
  expectApprox(r.cost, 1100000, 1e-6, 'cost');
  expectApprox(r.rate, 9.0909, 1e-3, 'rate');
});
it('주당 항등식 — profit / soldQty === perShare (이익·손실 양방향)', () => {
  for (const sp of [12000, 9000]) {
    const r = RZ({ change: -137, sellPrice: sp, basisPrice: 11000 });
    expectApprox(r.profit / r.soldQty, r.perShare, 1e-9, 'perShare ' + sp);
  }
});
it('수익률 분모는 매입원가 — 매도금액으로 바꾸면 값이 갈린다', () => {
  const r = RZ({ change: -100, sellPrice: 12000, basisPrice: 8000 });
  expectApprox(r.rate, 50, 1e-9, 'rate');
  expectApprox(r.rate, (r.profit / r.cost) * 100, 1e-9, '분모 정의');
});
it('매도단가 미입력 → 전 필드 null (0원으로 단언하지 않는다)', () => {
  const r = RZ({ change: -100, sellPrice: 0, basisPrice: 11000 });
  expectEq(r.profit, null, 'profit');
  expectEq(r.rate, null, 'rate');
  expectEq(r.cost, null, 'cost');
  expectEq(r.amount, null, 'amount');
  expectEq(r.basis, null, 'basis');
});
it('기준단가 0/음수 → null — 매도금액 전액을 수익으로 단언하지 않는다', () => {
  for (const b of [0, -1]) expectEq(RZ({ change: -100, sellPrice: 12000, basisPrice: b }).profit, null, 'basis ' + b);
});
it('매수 행·수량 0 행은 실현손익을 갖지 않는다', () => {
  expectEq(RZ({ change: 100, sellPrice: 12000, basisPrice: 11000 }).profit, null, '매수');
  expectEq(RZ({ change: 0, sellPrice: 12000, basisPrice: 11000 }).profit, null, '수량 0');
});
it('부동소수 잔차는 실현손익에도 스냅된다 (본전 매도가 이익 색으로 뜨던 부류)', () => {
  const r = RZ({ change: -630, sellPrice: 8699.2, basisPrice: 8699.2 + 1e-11 });
  expectEq(r.perShare, 0, 'perShare');
  expectEq(r.profit, 0, 'profit');
  expectEq(r.rate, 0, 'rate');
});
it('소수 매도수량을 floor하지 않는다 (과세 금액(단가)와 기준이 갈리지 않게)', () => {
  const r = RZ({ change: -0.5, sellPrice: 12000, basisPrice: 11000 });
  expectEq(r.soldQty, 0.5, 'soldQty');
  expectApprox(r.profit, 500, 1e-9, 'profit');
});
it('⚠ 시점 러닝 평균 계약 — 매도 후 추가매수가 과거 실현손익을 바꾸지 않는다', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-02-02', change: -50, sellPrice: 9000 },
    { date: '2026-03-02', change: 100, purchasePrice: 12000 },
  ];
  const rows = runningBuyAvgSeries(evts);
  expectApprox(rows[1].runningBuyAvg, 8000, 1e-9, '매도 시점 러닝 평균');
  const r = computeSellRealized({ change: rows[1].evt.change, sellPrice: rows[1].evt.sellPrice, basisPrice: rows[1].runningBuyAvg });
  expectApprox(r.profit, 50000, 1e-9, 'profit');
  // 현재 시점 평균(포트폴리오 구매단가)으로 계산하면 부호가 뒤집힌다는 사실을 픽스처로 고정한다.
  const nowAvg = (100 * 8000 - 50 * 8000 + 100 * 12000) / 150;
  const wrong = computeSellRealized({ change: -50, sellPrice: 9000, basisPrice: nowAvg });
  ok(wrong.profit < 0 && r.profit > 0, '현재 시점 평균이면 부호가 뒤집혀야 이 픽스처가 회귀를 잡는다');
});
it('이동평균법 — 매도는 러닝 평균단가를 바꾸지 않는다(수량만 감소)', () => {
  const rows = runningBuyAvgSeries([
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-02-02', change: -50, sellPrice: 9000 },
    { date: '2026-02-03', change: -10, sellPrice: 9500 },
  ]);
  expectApprox(rows[1].runningBuyAvg, 8000, 1e-9, '1차 매도');
  expectApprox(rows[2].runningBuyAvg, 8000, 1e-9, '2차 매도');
});
it('매입단가가 빈 매수 행은 러닝 평균을 오염시키지 않는다 (0원 매수 금지)', () => {
  const rows = runningBuyAvgSeries([
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-01-03', change: 100 },
    { date: '2026-02-02', change: -50, sellPrice: 9000 },
  ]);
  expectApprox(rows[2].runningBuyAvg, 8000, 1e-9, '러닝 평균');
});
it('요약 항등식 — Σ행별 실현손익 === 총 매도금액 − Σ매입원가 (행마다 기준단가가 달라도)', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-02-02', change: -50, sellPrice: 9000 },
    { date: '2026-03-02', change: 100, purchasePrice: 12000 },
    { date: '2026-04-02', change: -50, sellPrice: 11000 },
  ];
  const rz = runningBuyAvgSeries(evts)
    .map(r => computeSellRealized({ change: r.evt.change, sellPrice: r.evt.sellPrice, basisPrice: r.runningBuyAvg }))
    .filter(r => r.profit !== null);
  const amt = rz.reduce((a, r) => a + r.amount, 0);
  const cost = rz.reduce((a, r) => a + r.cost, 0);
  const prof = rz.reduce((a, r) => a + r.profit, 0);
  expectApprox(prof, amt - cost, 1e-6, '항등식');
  expectApprox(rz[0].basis, 8000, 1e-9, '1차 기준');
  expectApprox(rz[1].basis, 10666.6667, 1e-3, '2차 기준');
  ok(Math.abs(rz[0].basis - rz[1].basis) > 1, '기준단가가 행마다 달라야 이 픽스처가 상수-곱 회귀를 잡는다');
});

console.log('\n[13] buildLofoLotSeries — 최저가 우선(LOFO) 로트 매칭');
const lotsOf = (map, evt) => (map.get(evt)?.lots || []).map(l => `${l.date}|${l.price}|${l.qty}`);

it('사용자 실측 재현 — 8/5 630주는 전부 7/29 7,227원 로트에 배정된다', () => {
  const m = buildLofoLotSeries(REAL_EVENTS);
  const s1 = m.get(REAL_EVENTS[6]);
  expectApprox(s1.basis, 7227, 1e-9, 'basis');
  expectEq(s1.shortfallQty, 0, 'shortfallQty');
  expectEq(s1.trusted, true, 'trusted');
  expectEq(lotsOf(m, REAL_EVENTS[6]).join(','), '2026-07-29|7227|630', '배정 내역');
  const r = computeSellRealized({ change: -630, sellPrice: 8260, basisPrice: s1.basis });
  expectApprox(r.profit, 650790, 1e-6, 'profit');
  expectApprox(r.perShare, 1033, 1e-9, 'perShare');
  // 평균법(8,699.20)이면 −276,694 — 부호가 뒤집혀야 이 픽스처가 회귀를 잡는다(화면 캡처값).
  const avg = computeSellRealized({ change: -630, sellPrice: 8260, basisPrice: 8699.19657 });
  ok(avg.profit < 0 && r.profit > 0, '평균법과 부호가 갈려야 이 기능이 의미를 갖는다');
});
it('사용자 실측 재현 — 최저가 로트가 소진되면 다음 최저가로 넘어간다 (8/12 421주)', () => {
  const m = buildLofoLotSeries(REAL_EVENTS);
  // 7/29 761주 중 630(8/5) + 20(8/11) 소진 → 111주 남음 → 나머지 310주는 7/28 7,778원
  expectEq(lotsOf(m, REAL_EVENTS[8]).join(','), '2026-07-29|7227|111,2026-07-28|7778|310', '배정 내역');
  const s3 = m.get(REAL_EVENTS[8]);
  expectApprox(s3.cost, 111 * 7227 + 310 * 7778, 1e-6, 'cost');
  expectApprox(s3.basis, (111 * 7227 + 310 * 7778) / 421, 1e-9, 'basis');
  const r = computeSellRealized({ change: -421, sellPrice: 8071, basisPrice: s3.basis });
  expectApprox(r.amount, 3397891, 1e-6, 'amount (화면 표시값)');
  expectApprox(r.profit, 184514, 1e-6, 'profit');
});
it('사용자 실측 재현 — 3건 합계', () => {
  const rows = lofoBasisOf(REAL_EVENTS)
    .map(b => ({ b, rz: computeSellRealized({ change: b.evt.change, sellPrice: b.evt.sellPrice, basisPrice: b.value }) }))
    .filter(x => x.rz.profit !== null);
  expectEq(rows.length, 3, '매도 3건');
  ok(rows.every(x => x.b.source === 'lofo'), '전 행이 최저가 매칭');
  const amt = rows.reduce((a, x) => a + x.rz.amount, 0);
  const cost = rows.reduce((a, x) => a + x.rz.cost, 0);
  const prof = rows.reduce((a, x) => a + x.rz.profit, 0);
  expectApprox(amt, 8758091, 1e-6, '매도금액 합계 (화면 표시값)');
  expectApprox(cost, 7910927, 1e-6, '매입원가 합계');
  expectApprox(prof, 847164, 1e-6, '실현손익 합계');
  expectApprox(prof, amt - cost, 1e-6, '요약 항등식');
});
it('⚠ 매도 시점 이후의 매수는 배정되지 않는다 — 나중 매수가 과거 실현손익을 소급 변경 금지', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-02-02', change: -50, sellPrice: 9000 },
    { date: '2026-03-02', change: 100, purchasePrice: 3000 }, // 훨씬 싸지만 매도 이후
  ];
  const m = buildLofoLotSeries(evts);
  expectApprox(m.get(evts[1]).basis, 8000, 1e-9, 'basis (3000이 아니어야 한다)');
  expectEq(lotsOf(m, evts[1]).join(','), '2026-01-02|8000|50', '배정 내역');
});
it('같은 날짜 매수는 그 매도에 배정된다 (compareTaxEvents 매수 우선)', () => {
  const evts = [
    { date: '2026-02-02', change: -50, sellPrice: 9000 },
    { date: '2026-02-02', change: 100, purchasePrice: 7000 },
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
  ];
  const m = buildLofoLotSeries(evts);
  expectApprox(m.get(evts[0]).basis, 7000, 1e-9, 'basis');
});
it('같은 단가 로트는 먼저 매수한 것부터 배정 — 배정 내역이 결정적이어야 한다', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-01-03', change: 100, purchasePrice: 8000 },
    { date: '2026-02-02', change: -150, sellPrice: 9000 },
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(lotsOf(m, evts[2]).join(','), '2026-01-02|8000|100,2026-01-03|8000|50', '배정 순서');
});
it('여러 매수 로트를 낮은 가격 순으로 가로지른다', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 9000 },
    { date: '2026-01-03', change: 100, purchasePrice: 7000 },
    { date: '2026-01-04', change: 100, purchasePrice: 8000 },
    { date: '2026-02-02', change: -250, sellPrice: 10000 },
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(lotsOf(m, evts[3]).join(','), '2026-01-03|7000|100,2026-01-04|8000|100,2026-01-02|9000|50', '가격 오름차순 배정');
  expectApprox(m.get(evts[3]).basis, (100 * 7000 + 100 * 8000 + 50 * 9000) / 250, 1e-9, 'basis');
});
it('⚠ 매수 이력 부족 → shortfallQty로 알리고 호출부가 폴백한다 (싼값 단언 금지)', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 5000 },
    { date: '2026-02-02', change: -150, sellPrice: 9000 },
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(m.get(evts[1]).shortfallQty, 50, 'shortfallQty');
  expectEq(m.get(evts[1]).matchedQty, 100, 'matchedQty');
  const b = lofoBasisOf(evts)[1];
  expectEq(b.source, 'running', '최저가 매칭을 쓰지 않고 러닝 평균으로 폴백');
  expectApprox(b.value, 5000, 1e-9, '폴백값');
  expectEq(b.shortfallQty, 50, '부족 수량은 계속 노출');
});
it('⚠ 매수분이 전부 소진된 뒤의 매도도 부족으로 잡힌다', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-02-02', change: -100, sellPrice: 9000 },
    { date: '2026-03-02', change: -50, sellPrice: 9500 },
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(m.get(evts[1]).shortfallQty, 0, '1차 매도는 정상');
  expectEq(m.get(evts[2]).shortfallQty, 50, '2차 매도는 전량 부족');
  expectEq(m.get(evts[2]).basis, 0, 'basis를 단정하지 않는다');
});
it('⚠ 부족 행은 이후 행의 최저가 매칭을 오염시키지 않는다 (poison 금지)', () => {
  const evts = [
    { date: '2026-01-02', change: 10, purchasePrice: 8000 },
    { date: '2026-02-02', change: -50, sellPrice: 9000 },   // 부족
    { date: '2026-03-02', change: 100, purchasePrice: 6000 },
    { date: '2026-04-02', change: -40, sellPrice: 9500 },   // 정상 — 최저가 매칭 유지
  ];
  const b = lofoBasisOf(evts);
  expectEq(b[1].source, 'running', '부족 행은 폴백');
  expectEq(b[3].source, 'lofo', '이후 행은 최저가 매칭 유지');
  expectApprox(b[3].value, 6000, 1e-9, '이후 행 기준단가');
});
it('⚠ 매입단가가 빈 매수 행은 그 시점부터 신뢰도를 끈다 (0원 로트 금지)', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-02-02', change: -50, sellPrice: 9000 },   // 아직 신뢰
    { date: '2026-03-02', change: 100 },                    // 매입단가 없음
    { date: '2026-04-02', change: -50, sellPrice: 9500 },   // 신뢰 불가
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(m.get(evts[1]).trusted, true, '앞선 매도는 신뢰');
  expectEq(m.get(evts[3]).trusted, false, '뒤 매도는 신뢰 불가');
  ok(!m.get(evts[3]).lots.some(l => l.price === 0), '0원 로트가 만들어지지 않는다');
  const b = lofoBasisOf(evts);
  expectEq(b[1].source, 'lofo', '앞선 매도');
  // ⚠️ 러닝 평균도 **같은 excludedSeen**으로 꺼지므로 'running'은 이 경우 도달 불가다
  //    (미러가 buyAvgTrusted 게이트를 빠뜨렸을 때 도달 불가능한 폴백을 단언하던 회귀).
  expectEq(b[3].source, 'none', '뒤 매도는 러닝 평균도 건너뛰고 avgBuy 폴백(여기선 없음)');
  expectEq(b[3].value, 0, '기준단가 없음 → 계산하지 않는다');
});
it('⚠ 일자 없는 매수 행이 있으면 전 구간 신뢰 불가 (순서를 정할 수 없음)', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '', change: 100, purchasePrice: 3000 },
    { date: '2026-02-02', change: -50, sellPrice: 9000 },
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(m.get(evts[2]).trusted, false, 'trusted');
  const b = lofoBasisOf(evts, 8500, 'portfolio').find(x => x.evt === evts[2]);
  expectEq(b.source, 'portfolio', '러닝 평균도 함께 불신 → avgBuy 폴백');
  expectApprox(b.value, 8500, 1e-9, '폴백값');
});
it('⚠ 일자 없는 **매도** 행도 전 구간 신뢰 불가 — 이미 팔린 최저가 로트가 풀에 남는다', () => {
  // 적대적 리뷰 확정(HIGH): 옛 가드는 change > 0 만 봐서 무일자 매도를 놓쳤다.
  // 5,000 로트가 소진되지 않은 채 남아 04-02 매도가 basis 5,000(+450,000)으로 확정됐다 —
  // 참값은 그 로트가 이미 팔렸으므로 9,000 기준 +50,000. 9배 과대인데 셀에 * 도 안 붙었다.
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 5000 },
    { date: '', change: -100, sellPrice: 9000 },              // 일자 없는 매도
    { date: '2026-03-02', change: 100, purchasePrice: 9000 },
    { date: '2026-04-02', change: -100, sellPrice: 9500 },
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(m.get(evts[3]).trusted, false, 'trusted (풀 구성을 신뢰할 수 없다)');
  const b = lofoBasisOf(evts, 9000, 'portfolio').find(x => x.evt === evts[3]);
  ok(b.source !== 'lofo', '최저가 매칭을 확정하지 않는다');
  const r = computeSellRealized({ change: -100, sellPrice: 9500, basisPrice: b.value });
  ok(r.profit < 100000, `폴백 실현손익 ${r.profit} — 5,000 로트를 배정한 +450,000이면 회귀`);
  // 같은 픽스처의 일자를 채우면 정상적으로 최저가 매칭이 산다(가드가 과잉 차단이 아님을 고정).
  const fixed = evts.map((e, i) => (i === 1 ? { ...e, date: '2026-02-02' } : e));
  const fb = lofoBasisOf(fixed).find(x => x.evt === fixed[3]);
  expectEq(fb.source, 'lofo', '일자를 채우면 최저가 매칭 복귀');
  expectApprox(fb.value, 9000, 1e-9, '남은 로트는 9,000');
});
it('매수 행·수량 0 행·일자 없는 행은 Map에 담기지 않는다', () => {
  const m = buildLofoLotSeries([
    { date: '2026-01-02', change: 100, purchasePrice: 8000 },
    { date: '2026-01-03', change: 0 },
    { date: '', change: -10, sellPrice: 9000 },
  ]);
  expectEq(m.size, 0, 'Map size');
});
it('소수 매도수량·소수 로트도 붕괴하지 않는다', () => {
  const evts = [
    { date: '2026-01-02', change: 0.5, purchasePrice: 8000 },
    { date: '2026-01-03', change: 0.5, purchasePrice: 6000 },
    { date: '2026-02-02', change: -0.75, sellPrice: 9000 },
  ];
  const m = buildLofoLotSeries(evts);
  expectApprox(m.get(evts[2]).basis, (0.5 * 6000 + 0.25 * 8000) / 0.75, 1e-9, 'basis');
  expectEq(m.get(evts[2]).shortfallQty, 0, 'shortfallQty');
});
it('⚠ 전량 매도의 부동소수 잔여가 유령 로트로 남지 않는다 (LOT_QTY_EPS)', () => {
  // 0.1 + 0.2 !== 0.3 — 전량 매도 후 잔여 ~5.5e-17이 남아 다음 매도에 배정되면 값이 튄다.
  const evts = [
    { date: '2026-01-02', change: 0.1, purchasePrice: 5000 },
    { date: '2026-01-03', change: 0.2, purchasePrice: 5000 },
    { date: '2026-02-02', change: -0.3, sellPrice: 9000 },
    { date: '2026-02-03', change: 1, purchasePrice: 7000 },
    { date: '2026-02-04', change: -1, sellPrice: 9500 },
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(m.get(evts[2]).shortfallQty, 0, '전량 매도는 부족 아님');
  expectEq(lotsOf(m, evts[4]).join(','), '2026-02-03|7000|1', '잔여 5,000원 로트가 섞이지 않는다');
  expectApprox(m.get(evts[4]).basis, 7000, 1e-9, 'basis');
});
it('⚠ 잔여가 rest 쪽에 남는 경우도 부족으로 오판하지 않는다 (LOT_QTY_EPS — break·shortfall 임계)', () => {
  // ⚠️ 위 픽스처는 잔여가 l.qty에 남아 rest가 정확히 0으로 끝난다 → `rest <= LOT_QTY_EPS`(break)와
  //    `rest > LOT_QTY_EPS ? rest : 0`(shortfall) 두 임계를 **밟지 않는다**(적대적 리뷰 확정: 그 둘을
  //    0으로 바꿔도 전 테스트가 통과했다). 여기서는 rest에 8.3e-17이 남아 두 임계를 모두 통과시킨다.
  // ⚠️ 3번째 로트(더 비싼 것)가 있어야 break 임계가 실제로 갈린다 — 없으면 로트가 소진돼 루프가
  //    자연 종료되므로 `rest <= 0`으로 바꿔도 결과가 같다(그 상태로는 죽은 단언).
  const evts = [
    { date: '2026-01-02', change: 0.7, purchasePrice: 5000 },
    { date: '2026-01-03', change: 0.1, purchasePrice: 5000 },
    { date: '2026-01-04', change: 1, purchasePrice: 9000 },
    { date: '2026-02-02', change: -0.8, sellPrice: 9000 },
  ];
  const m = buildLofoLotSeries(evts);
  expectEq(m.get(evts[3]).shortfallQty, 0, 'shortfallQty (임계 0이면 8.3e-17이 남아 LOFO가 폐기된다)');
  expectApprox(m.get(evts[3]).basis, 5000, 1e-9, 'basis');
  // 임계 0이면 9,000 로트에서 8.3e-17을 더 집어 배정 내역에 '0주 × 9,000원' 유령 행이 뜬다.
  expectEq(lotsOf(m, evts[3]).join(','), '2026-01-02|5000|0.7,2026-01-03|5000|0.1', '배정 내역에 유령 로트 없음');
  expectEq(lofoBasisOf(evts)[3].source, 'lofo', '최저가 매칭 유지 — 가짜 "매수 이력 부족"이 뜨면 회귀');
});
it('⚠ 의미 없이 작은 매도수량은 기준단가를 단정하지 않는다 (break + matchedQty 임계 합작)', () => {
  // ⚠️ 두 임계가 서로를 가려 준다 — break가 먼저 걸리면 matchedQty가 0이 되고, break를 풀면
  //    matchedQty 임계가 잡는다. 그래서 이 픽스처는 **둘을 동시에** 0으로 바꿀 때만 실패한다.
  //    (`matchedQty > LOT_QTY_EPS`는 다른 두 게이트 때문에 단독으로는 도달 불가한 방어적 중복이다:
  //     로트는 qty > EPS인 것만 쓰이고 rest > EPS일 때만 집으므로 take는 항상 EPS를 넘는다.)
  const m = buildLofoLotSeries([
    { date: '2026-01-02', change: 100, purchasePrice: 5000 },
    { date: '2026-02-02', change: -1e-15, sellPrice: 9000 },
  ]);
  const s = [...m.values()][0];
  expectEq(s.basis, 0, 'basis (0 나눗셈 인접 구간에서 단가를 단언하지 않는다)');
});
it('한 번 배정된 매수분은 다음 매도에 다시 쓰이지 않는다 (순차 소진)', () => {
  const evts = [
    { date: '2026-01-02', change: 100, purchasePrice: 7000 },
    { date: '2026-01-03', change: 100, purchasePrice: 9000 },
    { date: '2026-02-02', change: -100, sellPrice: 10000 },
    { date: '2026-02-03', change: -100, sellPrice: 10000 },
  ];
  const m = buildLofoLotSeries(evts);
  expectApprox(m.get(evts[2]).basis, 7000, 1e-9, '1차 = 최저가');
  expectApprox(m.get(evts[3]).basis, 9000, 1e-9, '2차 = 다음 최저가');
});
it('실측 픽스처에서 기준단가가 평균법보다 낮다 (이 기능의 목적 — 일반 불변식은 아님)', () => {
  // ⚠️ '최저가 매칭 원가 ≤ 평균법 원가'는 **일반적으로 참이 아니다**. 싼 로트가 먼저 소진되면
  //    이후 매도의 기준단가는 평균법보다 높아진다(바로 위 '순차 소진' 테스트가 그 반례:
  //    1차 7,000 / 2차 9,000 vs 러닝 평균 8,000). 그러니 이 단언을 전 픽스처로 넓히지 말 것.
  const rows = lofoBasisOf(REAL_EVENTS);
  const run = runningBuyAvgSeries(REAL_EVENTS);
  for (const r of rows.filter(x => safeNum(x.evt.change) < 0)) {
    const avg = run.find(x => x.evt === r.evt).runningBuyAvg;
    ok(r.value < avg, `기준단가 ${r.value} < 러닝 평균 ${avg}`);
  }
});


// ─── src/krEtfTaxHelpers.ts 평균 과표 조정(실제 과세 역산) 참조 미러 ─────────
// ⚠️ src 본문과 항상 1:1 동기화. 한쪽만 고치면 이 미러가 옛 계약을 계속 통과시킨다.
function safeNumH(v) {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function compareTaxEventsH(a, b) {
  const byDate = String(a?.date || '').localeCompare(String(b?.date || ''));
  if (byDate !== 0) return byDate;
  return (safeNumH(b?.change) > 0 ? 1 : 0) - (safeNumH(a?.change) > 0 ? 1 : 0);
}

function monthEndOfYm(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!(y > 0) || !(m >= 1 && m <= 12)) return '';
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function buildAvgTaxAnchors(avgTaxBaseAdj) {
  return Object.entries(avgTaxBaseAdj || {})
    .map(([ym, a]) => {
      const raw = String(a?.exDate || '');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : monthEndOfYm(ym);
      return { date, value: safeNumH(a?.value) };
    })
    .filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a.date) && a.value > 0);
}

function computeRunningAvgSnapshotsA(events, anchors) {
  const valid = (events || [])
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) && safeNumH(e.change) !== 0)
    .sort(compareTaxEventsH);
  const anchorList = (anchors || [])
    .filter(a => /^\d{4}-\d{2}-\d{2}$/.test(String(a?.date || '')) && safeNumH(a?.value) > 0)
    .map(a => ({ date: String(a.date), value: safeNumH(a.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  let qty = 0, avg = 0, ai = 0;
  const out = [];
  const flushAnchorsTo = (date) => {
    while (ai < anchorList.length && (date == null || anchorList[ai].date <= date)) {
      avg = anchorList[ai].value;
      out.push({ id: `__anchor:${anchorList[ai].date}`, date: anchorList[ai].date, qty, avgPrice: avg, anchored: true });
      ai++;
    }
  };
  for (const e of valid) {
    flushAnchorsTo(e.date);
    const change = safeNumH(e.change);
    if (change > 0) {
      const newQty = qty + change;
      avg = newQty > 0 ? (qty * avg + change * safeNumH(e.taxBasePrice)) / newQty : 0;
      qty = newQty;
    } else {
      qty = Math.max(0, qty + change);
    }
    out.push({ id: e.id, date: e.date, qty, avgPrice: avg });
  }
  flushAnchorsTo(null);
  return out;
}

function computeMonthlyAvgForGridA(events, monthYms, anchors) {
  const snapshots = computeRunningAvgSnapshotsA(events, anchors);
  const result = {};
  for (const ym of (monthYms || [])) {
    const [year, month] = ym.split('-').map(Number);
    const lastDay = new Date(year, month, 0).toISOString().slice(0, 10);
    let best = null;
    for (const s of snapshots) {
      if (s.date <= lastDay) best = s;
      else break;
    }
    if (best && best.avgPrice > 0) result[ym] = best.avgPrice;
  }
  return result;
}

function solveAvgTaxBaseFromTax({ exTaxBase, taxAmount, qty }) {
  const ex = safeNumH(exTaxBase);
  const q = safeNumH(qty);
  if (!(ex > 0) || !(q > 0)) return null;
  if (taxAmount == null || taxAmount === '') return null;
  const tax = safeNumH(taxAmount);
  if (!Number.isFinite(tax) || tax < 0) return null;
  if (tax === 0) return { value: ex, kind: 'lowerBound', perShareTax: 0 };
  const perShareTax = tax / q;
  const value = ex - perShareTax;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, kind: 'exact', perShareTax };
}

const AVG_ADJ_MIN_DIFF = 1;

function avgTaxBaseAdjNeeded({ exTaxBase, avgTaxBase, taxAmount, qty }) {
  const solved = solveAvgTaxBaseFromTax({ exTaxBase, taxAmount, qty });
  if (!solved) return null;
  const expected = Math.max(0, safeNumH(exTaxBase) - safeNumH(avgTaxBase)) * safeNumH(qty);
  const diff = expected - safeNumH(taxAmount);
  return { ...solved, expected, diff, needed: Math.abs(diff) >= AVG_ADJ_MIN_DIFF };
}

function resolveActualTaxObservation(portfolio, code, ym) {
  const taxRaw = portfolio?.dividendTaxAmounts?.[code]?.[ym];
  if (taxRaw == null || taxRaw === '') return null;
  const tax = safeNumH(taxRaw);
  if (!Number.isFinite(tax) || tax < 0) return null;
  const afterTax = safeNumH(portfolio?.actualDividend?.[code]?.[ym]);
  const perShare = safeNumH(portfolio?.dividendHistory?.[code]?.[ym]);
  const manualQty = safeNumH(portfolio?.actualDividendQty?.[code]?.[ym]);
  const gross = afterTax + tax;
  const calcQty = (perShare > 0 && gross > 0) ? Math.round(gross / perShare) : 0;
  const qty = manualQty > 0 ? manualQty : calcQty;
  return { taxAmount: tax, afterTax, gross, perShare, qty, qtyIsManual: manualQty > 0, calcQty };
}

// ─── §14 평균 과표 조정 — 실제 과세금 역산 ──────────────────────────────────
console.log('\n[14] 평균 과표 조정 — 실제 과세금 역산 (사용자 실측 2026-09)');

it('#160 사용자 실측 역산 — 배당과표 9952.11 · 과세 56,050 · 10,401주 → 9,946.72', () => {
  const r = solveAvgTaxBaseFromTax({ exTaxBase: 9952.11, taxAmount: 56050, qty: 10401 });
  expectEq(r.kind, 'exact', 'kind');
  expectApprox(r.value, 9946.7211, 0.001, '역산 평균 과표');
  // 역산값을 되먹이면 실제 과세와 정확히 일치해야 한다(왕복 항등).
  const back = Math.max(0, 9952.11 - r.value) * 10401;
  expectApprox(back, 56050, 0.01, '왕복 항등');
});

it('#161 과세 0원은 정확한 역산이 아니라 하한(kind=lowerBound)이다', () => {
  const r = solveAvgTaxBaseFromTax({ exTaxBase: 9775.54, taxAmount: 0, qty: 18653 });
  expectEq(r.kind, 'lowerBound', 'kind');
  expectApprox(r.value, 9775.54, 0.001, '하한 = 배당 과표');
  // 하한을 적용하면 예상 과세가 정확히 0이 된다(실제와 일치).
  expectApprox(Math.max(0, 9775.54 - r.value) * 18653, 0, 0.001, '적용 후 예상 과세 0');
});

it('#162 ⚠️ 미입력(null/빈문자)과 0원을 구분한다 — 미입력은 관측 없음', () => {
  ok(solveAvgTaxBaseFromTax({ exTaxBase: 9952.11, taxAmount: null, qty: 10401 }) === null, 'null');
  ok(solveAvgTaxBaseFromTax({ exTaxBase: 9952.11, taxAmount: undefined, qty: 10401 }) === null, 'undefined');
  ok(solveAvgTaxBaseFromTax({ exTaxBase: 9952.11, taxAmount: '', qty: 10401 }) === null, '빈 문자열');
  ok(solveAvgTaxBaseFromTax({ exTaxBase: 9952.11, taxAmount: 0, qty: 10401 })?.kind === 'lowerBound', '0은 관측');
});

it('#163 역산 불가 입력은 null — 배당과표 없음 / 수량 0 / 음수 과세 / 평균과표 0 이하', () => {
  ok(solveAvgTaxBaseFromTax({ exTaxBase: 0, taxAmount: 100, qty: 10 }) === null, '배당과표 0');
  ok(solveAvgTaxBaseFromTax({ exTaxBase: 100, taxAmount: 100, qty: 0 }) === null, '수량 0');
  ok(solveAvgTaxBaseFromTax({ exTaxBase: 100, taxAmount: -1, qty: 10 }) === null, '음수 과세');
  ok(solveAvgTaxBaseFromTax({ exTaxBase: 100, taxAmount: 2000, qty: 10 }) === null, '평균과표 0 이하');
});

it('#164 판정 임계 ₩1 — 예상과 실제가 1원 이상 다를 때만 needed', () => {
  const near = avgTaxBaseAdjNeeded({ exTaxBase: 100, avgTaxBase: 99, taxAmount: 1000, qty: 1000 });
  expectEq(near.needed, false, '차이 0 → 불필요');
  const off = avgTaxBaseAdjNeeded({ exTaxBase: 100, avgTaxBase: 99, taxAmount: 999, qty: 1000 });
  expectEq(off.needed, true, '차이 1원 → 필요');
  const sub = avgTaxBaseAdjNeeded({ exTaxBase: 100, avgTaxBase: 99, taxAmount: 999.5, qty: 1000 });
  expectEq(sub.needed, false, '차이 0.5원 → 불필요');
});

it('#165 앵커 미전달 시 스냅샷이 종전과 완전히 동일하다 (하위호환의 축)', () => {
  const evts = [
    { id: 'a', date: '2026-07-14', change: 11000, taxBasePrice: 9911.30 },
    { id: 'b', date: '2026-07-15', change: 1305, taxBasePrice: 9911.19 },
    { id: 'c', date: '2026-07-29', change: -600, taxBasePrice: 0 },
  ];
  const base = computeRunningAvgSnapshotsA(evts, undefined);
  const empty = computeRunningAvgSnapshotsA(evts, []);
  expectEq(JSON.stringify(base), JSON.stringify(empty), '미전달 === 빈 배열');
  expectEq(base.length, 3, '앵커 행이 섞이지 않는다');
  ok(base.every(s => !s.anchored), 'anchored 스냅샷 없음');
});

it('#166 앵커는 그 시점 평균을 참값으로 고정하고 이후 매수를 그 값에서 다시 누적한다', () => {
  const evts = [
    { id: 'a', date: '2026-07-14', change: 1000, taxBasePrice: 9900 },
    { id: 'b', date: '2026-10-05', change: 1000, taxBasePrice: 10100 },
  ];
  const plain = computeMonthlyAvgForGridA(evts, ['2026-09', '2026-10']);
  expectApprox(plain['2026-09'], 9900, 0.001, '앵커 없음 9월');
  expectApprox(plain['2026-10'], 10000, 0.001, '앵커 없음 10월');
  const anchors = [{ date: '2026-09-02', value: 9946.72 }];
  const withA = computeMonthlyAvgForGridA(evts, ['2026-09', '2026-10'], anchors);
  expectApprox(withA['2026-09'], 9946.72, 0.001, '앵커 달');
  expectApprox(withA['2026-10'], 10023.36, 0.001, '⚠️ 앵커 이후도 보정된다(그 달만 대체가 아님)');
});

it('#167 앵커는 같은 날짜 매매보다 먼저 적용된다 (배당락일 매수는 그 배당 권리가 없다)', () => {
  const evts = [
    { id: 'a', date: '2026-07-14', change: 1000, taxBasePrice: 9900 },
    { id: 'b', date: '2026-09-02', change: 1000, taxBasePrice: 10100 },
  ];
  const withA = computeMonthlyAvgForGridA(evts, ['2026-09'], [{ date: '2026-09-02', value: 9946.72 }]);
  expectApprox(withA['2026-09'], 10023.36, 0.001, '앵커 → 그날 매수 순');
});

it('#168 앵커 스냅샷은 날짜 오름차순을 유지한다 (호출부의 else break 스캔 전제)', () => {
  const evts = [
    { id: 'a', date: '2026-07-14', change: 1000, taxBasePrice: 9900 },
    { id: 'b', date: '2026-11-01', change: 500, taxBasePrice: 10000 },
  ];
  const snaps = computeRunningAvgSnapshotsA(evts, [
    { date: '2026-12-01', value: 100 }, { date: '2026-09-02', value: 9946.72 },
  ]);
  const dates = snaps.map(s => s.date);
  expectEq(JSON.stringify(dates), JSON.stringify([...dates].sort()), '오름차순');
  ok(snaps[snaps.length - 1].date === '2026-12-01', '마지막 이벤트 이후 앵커도 흘러나온다');
});

it('#169 buildAvgTaxAnchors — exDate 박제 우선, 없으면 그 달 말일(UTC 조립)', () => {
  const a = buildAvgTaxAnchors({
    '2026-09': { value: 9946.72, exDate: '2026-09-02' },
    '2026-10': { value: 9900 },
    '2026-11': { value: 0 },
    '2026-12': { value: 9800, exDate: 'bad' },
  });
  const byDate = Object.fromEntries(a.map(x => [x.date, x.value]));
  expectApprox(byDate['2026-09-02'], 9946.72, 0.001, 'exDate 박제');
  expectApprox(byDate['2026-10-31'], 9900, 0.001, '말일 폴백');
  ok(!a.some(x => x.value === 0), '값 0은 앵커가 아니다');
  expectApprox(byDate['2026-12-31'], 9800, 0.001, '손상 exDate → 말일');
});

it('#170 관측 수량 — 수동 입력 우선, 없으면 세전 ÷ 주당분배금 역산', () => {
  const pf = {
    dividendTaxAmounts: { A: { '2026-09': 56050 } },
    actualDividend:     { A: { '2026-09': 1441694 } },
    dividendHistory:    { A: { '2026-09': 144 } },
  };
  const o = resolveActualTaxObservation(pf, 'A', '2026-09');
  expectEq(o.gross, 1497744, '세전 = 세후 + 과세');
  expectEq(o.qty, 10401, '역산 수량(=화면 10,401주)');
  expectEq(o.qtyIsManual, false, '역산');
  const pf2 = { ...pf, actualDividendQty: { A: { '2026-09': 10361 } } };
  const o2 = resolveActualTaxObservation(pf2, 'A', '2026-09');
  expectEq(o2.qty, 10361, '수동 수량 우선');
  expectEq(o2.qtyIsManual, true, '수동');
});

it('#171 ⚠️ 과세금 미입력이면 관측이 없다 — 가짜 하한 앵커 방지', () => {
  const pf = { actualDividend: { A: { '2026-09': 1441694 } }, dividendHistory: { A: { '2026-09': 144 } } };
  ok(resolveActualTaxObservation(pf, 'A', '2026-09') === null, '과세금 없음 → null');
  const pf0 = { ...pf, dividendTaxAmounts: { A: { '2026-09': 0 } } };
  expectEq(resolveActualTaxObservation(pf0, 'A', '2026-09').taxAmount, 0, '0원은 관측');
});

it('#172 조정 적용 후에는 제안이 꺼진다 (관측 수량 기준 판정이라 수렴)', () => {
  const ex = 9952.11, tax = 56050, qty = 10401;
  const before = avgTaxBaseAdjNeeded({ exTaxBase: ex, avgTaxBase: 9911.31, taxAmount: tax, qty });
  expectEq(before.needed, true, '조정 전');
  const after = avgTaxBaseAdjNeeded({ exTaxBase: ex, avgTaxBase: before.value, taxAmount: tax, qty });
  expectEq(after.needed, false, '⚠️ 조정 후 수렴 — 안 그러면 제안이 영원히 꺼지지 않는다');
});

// ─── 소스 텍스트 가드 — 매도 실현손익 렌더 배선 ──────────────────────────────
// ⚠️ 위 미러는 "값이 맞다"만 증명한다. 셀 통째 삭제·값 바꿔치기·요약의 상수-곱 회귀·각주가 옛
//    서술로 남는 것은 하나도 못 잡으므로 렌더 지점을 직접 읽어 단언한다.
// ⚠️ **선언이 아니라 사용부를 단언할 것** — 선언만 보는 가드는 td 삭제 변이를 통과시킨다
//    (verify:ladder #94의 교훈). 실패 시 먼저 정규식이 낡았는지 확인하고, 계약이 바뀐 게
//    아니면 정규식을 고칠 것.
const MX = readFileSync(new URL('../src/components/KrEtfTaxMatrix.tsx', import.meta.url), 'utf8');
const HL = readFileSync(new URL('../src/krEtfTaxHelpers.ts', import.meta.url), 'utf8');

// ⚠️ 각주 가드는 반드시 **각주 블록만** 잘라서 단언한다. 파일 전역 정규식으로 재면 같은 문구가
//    열 헤더 title 툴팁에도 있어 **각주에서 통째로 지워도 통과**한다(변이 M10·M17로 실증).
//    각주는 마우스를 올리지 않는 사용자가 이 값의 성격을 알 수 있는 유일한 자리라 별도 단언이 필요하다.
const sliceBlock = (src, from, to) => {
  const at = src.indexOf(from);
  if (at < 0) throw new Error(`구간 시작을 찾지 못함: ${from}`);
  const end = src.indexOf(to, at);
  if (end < 0) throw new Error(`구간 끝을 찾지 못함: ${to}`);
  return src.slice(at, end);
};
// 표 하단 각주 블록 (`일자 선택 시 …` ~ 그 div가 닫힐 때까지 — 내부에 중첩 div 없음)
const FOOT = sliceBlock(MX, '일자 선택 시 자산검증 전일 수량 자동 조회', '</div>');
// '현재 평가 / 실현손익' 열 헤더의 title 툴팁
const TH_REALIZED = sliceBlock(MX, '매수 행 = 현재가격 × 매매수량', '</th>');

console.log('\n[12] 소스 텍스트 가드 — 매도 실현손익 렌더 배선');
it('#G1 매도 셀이 부호 있는 실현손익을 렌더하고 손실 색에 바인딩한다', () => {
  ok(/rz\.profit !== null/.test(MX), 'null 게이트 사용부');
  ok(/\(rz\.profit >= 0 \? '\+' : ''\) \+ formatCurrency\(Math\.round\(rz\.profit\)\)/.test(MX), '금액 렌더');
  // 색 바인딩이 핵심 — priceAmount류(항상 ≥ 0)로 바꿔치기하면 blue 분기가 도달 불가가 된다.
  ok(/rz\.profit >= 0 \? 'text-red-400' : 'text-blue-400'/.test(MX), '이익 빨강 / 손실 파랑');
});
it('#G2 주당 손익·수익률 줄이 rz를 쓰고 null을 0%로 단언하지 않는다', () => {
  ok(/fmtTaxBase\(rz\.perShare\)/.test(MX), '주당 손익');
  ok(/rz\.rate !== null &&/.test(MX), 'rate null 가드');
  ok(/formatPercent\(rz\.rate\)/.test(MX), 'rate 렌더');
});
it('#G3 기준단가 우선순위 = 최저가 매칭 → 러닝 평균 → avgBuy (역전·직결 금지)', () => {
  ok(/basisPrice: basis\.value/.test(MX), 'computeSellRealized 인자');
  ok(/computeSellRealized\(\{ change: row\.evt\.change, sellPrice: row\.evt\.sellPrice, basisPrice: basis\.value \}\)/.test(MX), '호출 형태');
  ok(!/basisPrice: avgBuy\.value/.test(MX), 'avgBuy 직결 금지');
  ok(/avgBuyPrice: avgBuy\.value,/.test(MX), '과세열은 avgBuy 유지');
  // ⚠️ '존재'만 보면 return 줄을 **맞바꾸는** 변이가 통과한다(리뷰 확정 지적) → 순서를 단언한다.
  const lofo = MX.indexOf("return { value: lf.basis, source: 'lofo', lots: lf.lots, shortfallQty: 0 };");
  const run = MX.indexOf("if (row.buyAvgTrusted && row.runningBuyAvg > 0) return { value: row.runningBuyAvg, source: 'running', lots: null, shortfallQty: short };");
  const fb = MX.indexOf('if (avgBuy.value > 0) return { value: avgBuy.value, source: avgBuy.source, lots: null, shortfallQty: short };');
  ok(lofo >= 0, '최저가 매칭 분기 존재');
  ok(run >= 0, '러닝 평균 분기 존재');
  ok(fb >= 0, 'avgBuy 폴백 분기 존재');
  ok(lofo < run && run < fb, '최저가 매칭 → 러닝 평균 → avgBuy 순서(우선순위 역전 금지)');
  // ⚠️ 게이트 3항 중 하나만 빠져도 '없는 매수분'이나 '부분 풀'을 싼값으로 단언하게 된다.
  ok(/if \(lf && lf\.trusted && lf\.shortfallQty === 0 && lf\.basis > 0\) \{/.test(MX), '최저가 매칭 게이트 3항');
  // ⚠️ 전역 판정(buyExcludedCount)으로 되돌리면 매도 뒤의 불완전 매수 1건이 과거 손익 부호를 뒤집는다.
  ok(!/buyAvgReliable/.test(MX), '전역 신뢰도 판정 부활 금지 — 행별 buyAvgTrusted 사용');
  ok(/buyAvgTrusted: !excludedSeen/.test(MX), '행별 신뢰도 산출');
  // ⚠️ 플래그를 '읽는' 곳만 보면 '쓰는' 곳(else 분기)을 지우는 변이가 통과한다(2차 변이 N4로 실증).
  //    매수 분기 본문을 잘라 excludedSeen 갱신이 실제로 있는지 단언한다.
  const buyAt = MX.indexOf('      if (change > 0) {');
  ok(buyAt >= 0, '매수 분기 존재');
  const buyBody = MX.slice(buyAt, MX.indexOf('      } else if (change < 0) {', buyAt));
  ok(/excludedSeen = true;/.test(buyBody), '매입단가 빈 매수 행이 이후 행의 신뢰도를 끈다');
  // ⚠️ change > 0(매수만)으로 좁히면 **일자 없는 매도**가 로트 풀을 오염시켜도 통과한다(리뷰 HIGH).
  //    두 순회가 같은 판정을 써야 LOFO와 러닝 평균 폴백이 함께 막힌다.
  ok(/const undatedTrade = \(events \|\| \[\]\)\.some\(e => safeNum\(e\.change\) !== 0 &&/.test(MX), '무일자 판정은 매수·매도 모두(MX)');
  ok(/const undatedTrade = \(events \|\| \[\]\)\.some\(e => safeNum\(e\.change\) !== 0 &&/.test(HL), '무일자 판정은 매수·매도 모두(HL)');
  ok(/let excludedSeen = undatedTrade;/.test(MX), '일자 없는 행은 전 구간 신뢰 불가(MX)');
  ok(/let excludedSeen = undatedTrade;/.test(HL), '일자 없는 행은 전 구간 신뢰 불가(HL)');
});
it('#G4 러닝 평균이 표 순회에서 산출되고 매도는 평균단가를 바꾸지 않는다', () => {
  ok(/runningBuyAvg: buyAvg/.test(MX), 'buildSortedEventsWithAvg 반환');
  ok(/buyAvg = nq > 0 \? \(buyQty \* buyAvg \+ change \* pp\) \/ nq : 0;/.test(MX), '가중평균 갱신');
  ok(/buyQty = Math\.max\(0, buyQty \+ change\);/.test(MX), '매도는 수량만 감소');
  // ⚠️ '존재'만 보면 매도 분기에 buyAvg = 0 을 **추가**하는 변이가 통과한다(리뷰 확정 지적).
  //    매도 분기 본문을 잘라 buyAvg 재대입이 0건인지 단언한다.
  const at = MX.indexOf('      } else if (change < 0) {');
  ok(at >= 0, '매도 분기 존재');
  const body = MX.slice(at, MX.indexOf('return { evt, runningAvg: runAvg', at));
  ok(!/buyAvg\s*=/.test(body), '매도 분기에서 buyAvg 재대입 금지(이동평균법)');
  // 같은 날짜 타이브레이커 — 배열 삽입 순서에 손익 부호가 의존하지 않게.
  ok(/\.sort\(compareTaxEvents\)/.test(MX), '결정적 정렬');
  ok(/export function compareTaxEvents/.test(HL), '공유 비교자');
  ok((HL.match(/\.sort\(compareTaxEvents\)/g) || []).length >= 2, '러닝 평균 순회 전부가 같은 비교자를 공유');
});
it('#G5 매도 요약이 행별 값을 누적한다 — 상수 곱(평균단가 × 총수량) 금지', () => {
  ok(/sellRows\.reduce\(\(a, r\) => a \+ r\.realized\.cost, 0\)/.test(MX), '매입원가 누적');
  ok(/sellRows\.reduce\(\(a, r\) => a \+ r\.realized\.profit, 0\)/.test(MX), '실현손익 누적');
  ok(/r\.realized\.profit !== null/.test(MX), '미산출 행 제외');
  ok(!/avgBuy\.value \* sellQtyTotal/.test(MX), '상수 곱 금지');
  ok(/sellSummary\.profitTotal/.test(MX), '요약 렌더');
});
it('#G6 요약 바 래퍼 게이트가 내부 매도 줄 게이트를 전부 포함한다', () => {
  // ⚠️ 래퍼가 내부보다 좁으면 내부 분기가 도달 불가가 된다(리뷰 확정 지적:
  //    매수 0건 + 매도 전부 미산출이면 '합계 제외 N건' 진단이 통째로 사라졌다).
  ok(/\(buySummary\.count > 0 \|\| sellSummary\.count > 0 \|\| sellSummary\.excluded > 0\) && \(/.test(MX), '래퍼 OR 3항');
  ok(/\(sellSummary\.count > 0 \|\| sellSummary\.excluded > 0\) && \(/.test(MX), '내부 매도 줄 게이트');
  ok(/합계 제외 \{sellSummary\.excluded\}건/.test(MX), '제외 안내 렌더');
});
it('#G7 각주가 옛 서술을 남기지 않고 실현손익·기준단가·이중계상을 설명한다', () => {
  ok(!/현재가 × 매매수량은 <span[^>]*>-<\/span>/.test(MX), "옛 '매도 행은 -' 서술 제거");
  ok(/매도 행의 '현재 평가 \/ 실현손익' 칸/.test(MX), '실현손익 각주');
  ok(/매수 요약의 .손익.과 매도 요약의 .실현손익.을 더하지 마세요/.test(MX), '각주 이중 계상 경고');
  ok(/이 값과 겹칩니다 — 두 수를 더하지 마세요/.test(MX), '요약 툴팁 이중 계상 경고');
  // ⚠️ 아래 4줄은 **각주 블록만** 잘라 단언한다 — 전역 정규식이면 열 헤더 툴팁이 대신 통과시켜
  //    각주에서 통째로 사라져도 초록이 된다(변이 M10·M17로 실증한 죽은 단언).
  ok(/러닝 평균 매입단가/.test(FOOT), '기준단가 폴백 설명');
  // ⚠️ 최저가 매칭은 **분석용**이다. 세법상 원가법이 아니라는 고지가 사라지면 사용자가 이 값을
  //    과세 근거로 오해한다(같은 행에서 '이익' + '비과세'가 동시에 나오는 것이 정상인 이유).
  ok(/최저가 우선 매칭/.test(FOOT), '최저가 매칭 각주');
  ok(/분석용 원가법입니다/.test(FOOT), '세법상 원가법 아님 고지');
  ok(/남아 있는 매수분 중 가장 싼 것부터/.test(FOOT), '배정 규칙 서술');
  ok(/모자라면 그 다음으로 싼 매수분/.test(FOOT), '초과 매도 시 다음 최저가 서술');
  ok(/소급 변경하지 않습니다/.test(FOOT), '소급 변경 금지 서술');
  // ⚠️ 폴백은 **사유마다 도착지가 다르다**(부족 → 러닝 평균 / 매입단가·일자 누락 → 평균단가).
  //    한 사슬로 뭉뚱그리면 후자에서 러닝 평균을 건너뛰므로 각주가 거짓이 된다(리뷰 확정).
  ok(/ⓐ 배정할 매수분이 모자라면/.test(FOOT), '폴백 사유 ⓐ');
  ok(/러닝 평균도 같은 이유로 부분값이라 건너뛰고/.test(FOOT), '폴백 사유 ⓑ — 러닝 평균을 건너뛴다');
  // ⚠️ 일자 없는 매도는 이미 팔린 로트를 풀에 남겨 기준단가를 낮춘다(리뷰 HIGH) — 사용자가
  //    스스로 고칠 수 있는 유일한 단서라 각주에서 지우지 말 것.
  ok(/이미 팔린 로트가 풀에 남아 이후 매도의 기준단가를 실제보다 낮춥니다/.test(FOOT), '무일자 매도 경고');
  // 열 헤더 툴팁에도 같은 계약이 있어야 한다(각주를 안 읽는 사용자의 1차 안내).
  ok(/최저가 우선 매칭/.test(TH_REALIZED), '헤더 툴팁 매칭 규칙');
  ok(/분석용 원가법입니다/.test(TH_REALIZED), '헤더 툴팁 원가법 고지');
  // ⚠️ 실현손익 각주를 끼워 넣다 과세 3열 각주 4줄이 통째로 사라진 이력이 있다(리뷰 확정 지적).
  ok(/계산기 매수 평균 순으로 채택하며/.test(MX), '평균단가 폴백 3단계 각주');
  ok(/실제 사용된 출처를 헤더 아래에 표시/.test(MX), '출처 표시 각주');
  ok(/판정 불가<\/span>로 표기/.test(MX), '실제 과세 각주');
  ok(/과세 금액\(과표\)<\/span> = \(매도 과표기준가/.test(MX), '과세 금액 정의 각주');
});
it('#G8 열 헤더가 매도 행의 의미와 원가법을 함께 표기한다', () => {
  ok(/현재 평가 \/ 실현손익/.test(MX), '헤더 라벨');
  ok(/매도 = 실현손익 · 최저가 우선/.test(MX), '서브라인 — 어떤 원가법인지 상시 노출');
});
it('#G9 ISO_DATE 상수 공유 — 인라인 정규식 복제 금지(백슬래시 소실 회귀)', () => {
  ok(/const ISO_DATE = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//.test(MX), 'ISO_DATE 선언');
  ok(!/\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(/.test(MX), '인라인 리터럴 사용부 0건');
  ok(!/\/\^d\{4\}-d\{2\}-d\{2\}\$\//.test(MX), '백슬래시 소실 형태 0건');
});
it('#G10 과세 3열은 실현손익과 분리 유지 — computeSellTaxRow에 realized 필드 금지', () => {
  const body = HL.slice(HL.indexOf('export function computeSellTaxRow'), HL.indexOf('export function buildDividendEvents'));
  ok(body.indexOf('export function computeSellRealized') >= 0, 'computeSellRealized 존재');
  const taxOnly = body.slice(0, body.indexOf('export function computeSellRealized'));
  ok(!/realized/.test(taxOnly), 'computeSellTaxRow 본문에 realized 없음');
  ok(/taxable, exemptReason, actualPerShare, actualAmount,/.test(taxOnly), '과세 반환 필드 보존');
});

// ⚠️ [11]·[13]은 **미러**를 검증하므로 src만 고치면 그대로 통과한다(이 파일의 구조적 사각지대).
//    본문 텍스트를 직접 대조해 "src에만 넣은 변경"·"미러에만 넣은 변경"을 둘 다 잡는다.
// ⚠️ 파라미터 구조분해(`{ change, ... }`)를 본문으로 오인하면 어떤 드리프트도 못 잡는다 →
//    반드시 파라미터 괄호를 먼저 지나 본문 여는 중괄호를 찾는다.
const SELF = readFileSync(new URL(import.meta.url), 'utf8');
const grabBody = (src, name) => {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' 본문을 찾지 못함');
  const paren = src.indexOf(')', src.indexOf('(', at));
  let i = src.indexOf('{', paren), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  if (end < 0) throw new Error(name + ' 본문 괄호가 닫히지 않음');
  return src.slice(i, end)
    .replace(/\/\/[^\n]*/g, '')     // 줄 주석 제거(주석은 동기화 대상 아님)
    .replace(/\s+/g, ' ')
    .trim();
};
const expectMirror = (name) => {
  const mine = grabBody(SELF, name);
  const theirs = grabBody(HL, name);
  ok(mine === theirs, `${name} 미러 드리프트:\n  mirror = ${mine}\n  src    = ${theirs}`);
};

it('#G11 미러 드리프트 — computeSellRealized 본문이 src와 문자 단위로 같다', () => {
  expectMirror('computeSellRealized');
});

it('#G12 미러 드리프트 — buildLofoLotSeries·compareTaxEvents 본문이 src와 문자 단위로 같다', () => {
  expectMirror('buildLofoLotSeries');
  expectMirror('compareTaxEvents');
  ok(/export const LOT_QTY_EPS = 1e-9;/.test(HL), '로트 소진 epsilon 상수');
  ok(/const LOT_QTY_EPS = 1e-9;/.test(SELF), '미러 epsilon 동일');
});

it('#G13 최저가 매칭 배선 — 호출·배정 내역 노출·상시 ⚠ 억제', () => {
  ok(/const lofoByEvt = buildLofoLotSeries\(events\);/.test(MX), '종목별 1회 호출');
  // ⚠️ 인덱스 조인 금지 — buildSortedEventsWithAvg가 날짜 없는 행을 뒤에 덧붙이는 순간 한 칸씩 밀린다.
  ok(/const lf = lofoByEvt\.get\(row\.evt\);/.test(MX), '이벤트 객체 식별자 조인');
  // ⚠️ 배정 내역이 이 기능의 근거다 — 어디에도 없으면 "왜 기준단가가 7,227원인가"를 추적할 수 없다.
  ok((MX.match(/lotsDetailText\(basis\.lots\)/g) || []).length >= 2, '행 툴팁 + 기준 줄 툴팁 양쪽에 배정 내역');
  // ⚠️ 호출부만 보면 포매터 본문을 빈 배열로 바꾸는 변이가 통과한다(M15로 실증) → 본문을 단언한다.
  ok(/const lotsDetailText = \(lots\) => \(lots \|\| \[\]\)[\s\S]{0,120}?l\.date[\s\S]{0,60}?l\.qty[\s\S]{0,80}?fmtTaxBase\(l\.price\)/.test(MX),
    '배정 내역 포매터가 매수일·수량·단가를 낸다');
  ok(/basis\.lots\.length === 1 \? basis\.lots\[0\]\.date\.slice\(5\) : `\$\{basis\.lots\.length\}건`/.test(MX), '기준 줄 배정 요약(매수일 / N건)');
  // ⚠️ * 는 '폴백으로 계산됨' 표시다. 게이트가 'running'으로 되돌아가면 정상 행 전부에 * 가 붙는다.
  ok(/\{basis\.source !== 'lofo' && <span className="text-amber-400\/50 ml-0\.5">\*<\/span>\}/.test(MX), '폴백 행에만 * 표기');
  // ⚠️ 최저가 매칭은 평균단가와 벌어지는 것이 설계상 상시 — ⚠를 전 행에 띄우면 경보가 죽는다.
  ok(/basisDiverged: basis\.source !== 'lofo' &&/.test(MX), '최저가 매칭 행은 상시 ⚠ 억제');
  ok(/shortfallRows: sellRowsAll\.filter\(r => r\.basis\.shortfallQty > 0\)\.length,/.test(MX), '부족 행 집계');
  ok(/매수 이력 부족 \{sellSummary\.shortfallRows\}건/.test(MX), '요약 부족 안내 렌더');
  // ⚠️ shortfallRows는 실현손익이 아예 산출되지 않은(profit === null) 행까지 센다 — 그 행엔 * 도
  //    기준단가 줄도 없으므로 툴팁이 "대체 계산됐고 * 가 붙습니다"로 단언하면 거짓이다(리뷰 확정).
  ok(/실현손익이 산출된 행은 러닝 평균·평균단가로 대체 계산되고/.test(MX), '부족 안내 툴팁이 과잉 단언하지 않는다');
});

it('#G14 계산 규약·각주는 ? 토글로 접히되 상시 고지 2곳은 남는다', () => {
  ok(/const \[showTaxHelp, setShowTaxHelp\] = useState\(false\);/.test(MX), '기본 접힘');
  ok(/onClick=\{\(\) => setShowTaxHelp\(v => !v\)\}/.test(MX), '토글 버튼');
  // ⚠️ 각주 본문이 게이트 안에 있어야 실제로 접힌다(버튼만 달고 본문을 남기는 변이 차단).
  const gate = MX.indexOf('{showTaxHelp && (');
  const foot = MX.indexOf('일자 선택 시 자산검증 전일 수량 자동 조회');
  ok(gate >= 0, '펼침 게이트 존재');
  ok(gate < foot, '각주 본문이 게이트 안에 있다');
  // ⚠️ 접힌 상태에서도 '분석용 원가법'을 알 수 있어야 한다 — 각주가 유일한 고지가 되면
  //    사용자가 실현손익을 과세 근거로 오해한다. 토글 줄 요약 + 열 헤더 서브라인/툴팁 3중.
  ok(/분석용\(세법상 이동평균법 아님\)/.test(MX), '토글 줄 상시 요약');
  ok(/매도 = 실현손익 · 최저가 우선/.test(MX), '열 헤더 서브라인(상시)');
  ok(/분석용 원가법입니다/.test(TH_REALIZED), '열 헤더 툴팁(상시)');
});


// ─── §15 소스 텍스트 가드 — 평균 과표 조정 배선 ──────────────────────────────
// ⚠️ 위 §14 미러는 "값이 맞다"만 증명한다. 영속화 화이트리스트 누락·앵커 미전달·셀 통째 삭제는
//    하나도 못 잡으므로 배선 지점을 직접 읽어 단언한다. **선언이 아니라 사용부**를 볼 것.
const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const UPS = readFileSync(new URL('../src/hooks/usePortfolioState.ts', import.meta.url), 'utf8');
const DST = readFileSync(new URL('../src/components/DividendSummaryTable.tsx', import.meta.url), 'utf8');
const CWN = readFileSync(new URL('../src/components/CardWindow.tsx', import.meta.url), 'utf8');

console.log('\n[15] 소스 텍스트 가드 — 평균 과표 조정 배선');

// 미러 드리프트 비교용 정규화 — 주석·공백·export·TS 타입 주석·safeNum 접미사 차이를 흡수하고
// **로직만** 남긴다. ⚠️ 너무 많이 지우면 죽은 단언이 되므로 식별자·연산자는 그대로 둔다.
const normFn = (t) => t
  .replace(/\/\/[^\n]*/g, '')
  .replace(/^export /, '')
  .replace(/: any/g, '')
  .replace(/safeNumH\(/g, 'safeNum(')
  .replace(/\s+/g, ' ')
  .trim();

it('#G15 _ensureTaxBase 화이트리스트에 avgTaxBaseAdj — 다른 라이터 한 번에 소멸 방지', () => {
  // ⚠️ 이 함수는 codeRec 필드를 손나열해 재구축한다. 빠지면 배당 과표를 한 글자만 고쳐도
  //    사용자가 확정한 조정 앵커가 통째로 사라진다(undo 없음).
  // ⚠️ 종료 토큰을 '};' 로 두면 `p.taxBaseHistory || {};` 에 먼저 걸려 구간이 두 줄로 잘린다.
  const blk = sliceBlock(UPS, 'const _ensureTaxBase = (p, code) =>', '\n  };');
  ok(/avgTaxBaseAdj: codeRec\.avgTaxBaseAdj \|\| \{\}/.test(blk), '_ensureTaxBase 보존');
});

it('#G16 taxBaseKey 지문에 avgTaxBaseAdj — 조정만 한 세션의 Drive 저장 스킵 방지', () => {
  // ⚠️ 이 지문도 필드 손나열이다. 빠지면 portfolioUpdatedAt이 오르지 않아 STATE 저장이
  //    통째로 스킵된다(historyVerifyKey·targetAmount와 동일 버그 클래스).
  const blk = sliceBlock(APP, 'taxBaseKey: JSON.stringify(', '})),');
  ok(/avgTaxBaseAdj: rec\.avgTaxBaseAdj \|\| \{\}/.test(blk), '지문 포함');
});

it('#G17 라이터가 존재하고 값 0/null이면 앵커를 삭제한다', () => {
  ok(/const updateTaxBaseAvgAdj = \(portfolioId, code, yearMonth, adj\) => \{/.test(UPS), '라이터 선언');
  const blk = sliceBlock(UPS, 'const updateTaxBaseAvgAdj =', '\n  };');
  ok(/if \(adj == null \|\| !\(adj\.value > 0\)\) delete avgTaxBaseAdj\[yearMonth\]/.test(blk), '해제 경로');
  ok(/else avgTaxBaseAdj\[yearMonth\] = adj;/.test(blk), '저장 경로');
  ok(/taxBaseHistory: tbh/.test(blk), 'setPortfolios 반영');
});

it('#G18 별도 창(dividendCall) 화이트리스트에 updateTaxBaseAvgAdj — 창에서 조정 불가 방지', () => {
  const blk = sliceBlock(APP, "if (op === 'dividendCall') {", 'return { ok: true };');
  ok(/updateTaxBaseAvgAdj,/.test(blk), 'byId 등록');
  ok(/updateTaxBaseAvgAdj=\{call\('updateTaxBaseAvgAdj'\)\}/.test(CWN), '창 prop 배선');
});

it('#G19 prop 체인 4-hop이 끊기지 않는다 (App → DividendSummaryTable → KrEtfTaxMatrix)', () => {
  ok(/updateTaxBaseAvgAdj=\{updateTaxBaseAvgAdj\}/.test(APP), 'App → 표');
  ok(/updateTaxBaseAvgAdj,\s*onToggleTaxMonth/.test(DST), '표 props 수신');
  ok(/updateTaxBaseAvgAdj=\{updateTaxBaseAvgAdj\}/.test(DST), '표 → 매트릭스');
  ok(/^\s*updateTaxBaseAvgAdj,$/m.test(MX), '매트릭스 props 수신');
});

it('#G20 ⚠️ 자동 계산에 앵커를 반드시 넘긴다 — 안 넘기면 조정이 화면에 반영되지 않는다', () => {
  ok(/const anchors = buildAvgTaxAnchors\(avgTaxBaseAdj\);/.test(MX), '앵커 생성(공유 함수)');
  ok(/computeMonthlyAvgForGrid\(events, monthYms, anchors\)/.test(MX), '그리드 자동값에 전달');
  ok(/buildSortedEventsWithAvg\(events, anchors\)/.test(MX), '계산기 러닝 평균에 전달');
  // 앵커 생성을 손복제하면 두 화면의 날짜 해석이 갈린다.
  ok(!/exDate \|\| ''\) \|\| monthEndOf\(/.test(MX), '앵커 생성 손복제 없음');
});

it('#G21 과표 계산 셀 — 조정 적용 버튼과 해제 배지가 실제로 렌더된다', () => {
  ok(/d\.showSuggest && \(/.test(MX), '제안 게이트 사용부');
  ok(/d\.adjApplied && \(/.test(MX), '적용됨 게이트 사용부');
  // 적용: 역산값·근거를 함께 박제해야 나중에 근거를 추적할 수 있다.
  const apply = sliceBlock(MX, 'updateTaxBaseAvgAdj(portfolio.id, stock.code, d.ym, {', '})}');
  ok(/value: d\.suggest\.value/.test(apply), '역산값 저장');
  ok(/kind: d\.suggest\.kind/.test(apply), 'kind 저장');
  ok(/taxAmount: d\.obs\.taxAmount/.test(apply), '근거 과세금');
  ok(/qty: d\.obs\.qty/.test(apply), '근거 수량');
  ok(/exDate: exDateOf\(stock\.code, d\.ym\)/.test(apply), '앵커 날짜 박제');
  // 해제 경로(null)가 살아 있어야 되돌릴 수 있다.
  ok(/updateTaxBaseAvgAdj\(portfolio\.id, stock\.code, d\.ym, null\)/.test(MX), '해제 경로');
});

it('#G22 월 입금 내역 셀 — 역산 평균 과표가 렌더되고 공유 함수로 산출된다', () => {
  ok(/const avgAdj = resolveAvgAdjState\(pf, item\.code, dom\.exYm\);/.test(DST), '공유 함수 호출');
  ok(/d\.avgAdj && \(d\.avgAdj\.showSuggest \|\| d\.avgAdj\.applied\)/.test(DST), '셀 게이트 사용부');
  ok(/d\.avgAdj\.suggest\.value/.test(DST), '역산값 렌더');
  // ⚠️ 산식 손복제 금지 — 두 화면이 다른 값을 제시하면 안 된다.
  ok(!/exTaxBase\[.+\] - .*taxAmount \/ /.test(DST), '역산 산식 손복제 없음');
});

it('#G23 툴팁은 avgAdjTooltip 공유 포매터로만 만든다 (두 화면 설명 일치)', () => {
  ok(/title=\{avgAdjTooltip\(\{/.test(MX), '매트릭스 툴팁');
  ok(/title=\{avgAdjTooltip\(\{/.test(DST), '분배금 표 툴팁');
  // 하한(과세 0원)은 '='가 아니라 '≥'로 표기해야 없는 값을 단언하지 않는다.
  ok(/lowerBound/.test(MX) && /lowerBound/.test(DST), '하한 분기 노출');
});

it('#G24 미러 드리프트 — solveAvgTaxBaseFromTax 본문이 src와 문자 단위로 같다', () => {
  const srcFn = normFn(sliceBlock(HL, 'export function solveAvgTaxBaseFromTax(', '\n}'));
  const mirFn = normFn(sliceBlock(SELF, 'function solveAvgTaxBaseFromTax(', '\n}'));
  expectEq(mirFn, srcFn, 'solveAvgTaxBaseFromTax 드리프트');
});

it('#G25 미러 드리프트 — buildAvgTaxAnchors·avgTaxBaseAdjNeeded 본문이 src와 같다', () => {
  const a1 = normFn(sliceBlock(HL, 'export function buildAvgTaxAnchors(', '\n}'));
  const a2 = normFn(sliceBlock(SELF, 'function buildAvgTaxAnchors(', '\n}'));
  expectEq(a2, a1, 'buildAvgTaxAnchors 드리프트');
  const b1 = normFn(sliceBlock(HL, 'export function avgTaxBaseAdjNeeded(', '\n}'));
  const b2 = normFn(sliceBlock(SELF, 'function avgTaxBaseAdjNeeded(', '\n}'));
  expectEq(b2, b1, 'avgTaxBaseAdjNeeded 드리프트');
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
