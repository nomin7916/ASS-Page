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
function runningBuyAvgSeries(events) {
  const valid = (events || [])
    .filter(e => RZ_ISO.test(String(e.date || '')))
    .sort((a, b) => a.date.localeCompare(b.date));
  let buyQty = 0, buyAvg = 0;
  return valid.map(evt => {
    const change = safeNum(evt.change);
    if (change > 0) {
      const pp = safeNum(evt.purchasePrice);
      if (pp > 0) {
        const nq = buyQty + change;
        buyAvg = nq > 0 ? (buyQty * buyAvg + change * pp) / nq : 0;
        buyQty = nq;
      }
    } else if (change < 0) {
      buyQty = Math.max(0, buyQty + change);
    }
    return { evt, runningBuyAvg: buyAvg };
  });
}
const RZ = (o) => computeSellRealized({ change: 0, sellPrice: 0, basisPrice: 0, ...o });

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

// ─── 소스 텍스트 가드 — 매도 실현손익 렌더 배선 ──────────────────────────────
// ⚠️ 위 미러는 "값이 맞다"만 증명한다. 셀 통째 삭제·값 바꿔치기·요약의 상수-곱 회귀·각주가 옛
//    서술로 남는 것은 하나도 못 잡으므로 렌더 지점을 직접 읽어 단언한다.
// ⚠️ **선언이 아니라 사용부를 단언할 것** — 선언만 보는 가드는 td 삭제 변이를 통과시킨다
//    (verify:ladder #94의 교훈). 실패 시 먼저 정규식이 낡았는지 확인하고, 계약이 바뀐 게
//    아니면 정규식을 고칠 것.
const MX = readFileSync(new URL('../src/components/KrEtfTaxMatrix.tsx', import.meta.url), 'utf8');
const HL = readFileSync(new URL('../src/krEtfTaxHelpers.ts', import.meta.url), 'utf8');

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
it('#G3 기준단가는 매도 시점 러닝 평균 — 현재 시점 avgBuy 직결 금지', () => {
  ok(/basisPrice: basis\.value/.test(MX), 'computeSellRealized 인자');
  ok(/computeSellRealized\(\{ change: row\.evt\.change, sellPrice: row\.evt\.sellPrice, basisPrice: basis\.value \}\)/.test(MX), '호출 형태');
  ok(/if \(buyAvgReliable && runningBuyAvg > 0\) return \{ value: runningBuyAvg, source: 'running' \};/.test(MX), '러닝 평균 1순위');
  ok(!/basisPrice: avgBuy\.value/.test(MX), 'avgBuy 직결 금지');
  // 과세 3열은 종전대로 avgBuy.value를 쓴다(사용자 선택 — 되돌리지 말 것).
  ok(/avgBuyPrice: avgBuy\.value,/.test(MX), '과세열은 avgBuy 유지');
});
it('#G4 러닝 평균이 표 순회에서 산출되고 매도는 평균단가를 바꾸지 않는다', () => {
  ok(/runningBuyAvg: buyAvg/.test(MX), 'buildSortedEventsWithAvg 반환');
  ok(/buyAvg = nq > 0 \? \(buyQty \* buyAvg \+ change \* pp\) \/ nq : 0;/.test(MX), '가중평균 갱신');
  ok(/buyQty = Math\.max\(0, buyQty \+ change\);/.test(MX), '매도는 수량만 감소');
});
it('#G5 매도 요약이 행별 값을 누적한다 — 상수 곱(평균단가 × 총수량) 금지', () => {
  ok(/sellRows\.reduce\(\(a, r\) => a \+ r\.realized\.cost, 0\)/.test(MX), '매입원가 누적');
  ok(/sellRows\.reduce\(\(a, r\) => a \+ r\.realized\.profit, 0\)/.test(MX), '실현손익 누적');
  ok(/r\.realized\.profit !== null/.test(MX), '미산출 행 제외');
  ok(!/avgBuy\.value \* sellQtyTotal/.test(MX), '상수 곱 금지');
  ok(/sellSummary\.profitTotal/.test(MX), '요약 렌더');
});
it('#G6 요약 바 게이트가 OR — 매수 행이 없어도 매도 요약이 뜬다', () => {
  ok(/\(buySummary\.count > 0 \|\| sellSummary\.count > 0\)/.test(MX), 'OR 게이트');
});
it('#G7 각주가 옛 서술을 남기지 않고 실현손익·기준단가·이중계상을 설명한다', () => {
  ok(!/현재가 × 매매수량은 <span[^>]*>-<\/span>/.test(MX), "옛 '매도 행은 -' 서술 제거");
  ok(/매도 행의 '현재 평가 \/ 실현손익' 칸/.test(MX), '실현손익 각주');
  ok(/매수 요약의 .손익.과 매도 요약의 .실현손익.을 더하지 마세요/.test(MX), '각주 이중 계상 경고');
  ok(/이 값과 겹칩니다 — 두 수를 더하지 마세요/.test(MX), '요약 툴팁 이중 계상 경고');
  ok(/러닝 평균 매입단가/.test(MX), '기준단가 설명');
});
it('#G8 열 헤더가 매도 행의 의미를 함께 표기한다', () => {
  ok(/현재 평가 \/ 실현손익/.test(MX), '헤더 라벨');
  ok(/매도 = 실현손익/.test(MX), '서브라인');
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

it('#G11 미러 드리프트 — computeSellRealized 본문이 src와 문자 단위로 같다', () => {
  // ⚠️ [11]은 **미러**를 검증하므로 src만 고치면 그대로 통과한다(이 파일의 구조적 사각지대).
  //    본문 텍스트를 직접 대조해 "src에만 넣은 변경"·"미러에만 넣은 변경"을 둘 다 잡는다.
  const grab = (src, name) => {
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
  const mine = grab(readFileSync(new URL(import.meta.url), 'utf8'), 'computeSellRealized');
  const theirs = grab(HL, 'computeSellRealized');
  ok(mine === theirs, '미러 드리프트:\n  mirror = ' + mine + '\n  src    = ' + theirs);
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
