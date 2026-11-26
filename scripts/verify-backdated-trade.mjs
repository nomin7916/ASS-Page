#!/usr/bin/env node
// 지난 날짜 수량 변경 = 그날의 매매 기록 검증.   실행: npm run verify:backdated-trade
//
// 발단(사용자 요청 2026-11-26): 11/17에 매도·매수했는데 오늘(11/26) 계좌 표에서 고치면 '오늘 바뀐 것'으로 남는다.
//   자산 평가액 추이 → 날짜 → 자산 검증에서 그날 수량만 바꾸면 ① 투자금액이 식으로 계산되고(매수 = + 늘어난 수량 × 단가,
//   매도 = × 남은 수량 ÷ 원래 수량) ② 그 뒤 날짜와 ③ 지금 계좌 표에도 반영돼야 한다.
//
// 구성 ①  src/backdatedTrade.ts·src/utils.ts 를 **직접 import** — 계획·적용 산술 + resolveHoldings로 날짜별 보유를 다시 읽는다.
//        App의 구성 변경 효과(마지막 기록 ≠ 계좌 표면 오늘 날짜로 새 기록)를 같은 식으로 흉내 내 '되돌림 기록'이 안 생김을 본다.
// 구성 ②  소스 텍스트 가드 — 모달 배선(수량 편집 → 미리보기 → 같은 함수로 적용). 사용부와 import를 함께 단언한다.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\n── 파트① 계획·적용 (src/backdatedTrade.ts + src/utils.ts 직접 import) ──');

let T = null, U = null;
try {
  T = await import(pathToFileURL(join(ROOT, 'src/backdatedTrade.ts')).href);
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
} catch (e) {
  if (e && e.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
    console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  } else {
    fail++;
    console.log(`  ✗ 모듈 로드 실패 — ${e && (e.code || e.message)}`);
  }
}

// 모달과 같은 경로: 그날 보유 = resolveHoldings → snapshotItemsFromPortfolio, 적용은 최신 계좌 위에서 다시 계획.
const trade = (p, date, idxOrName, newQty, price, extra = {}) => {
  const base = U.snapshotItemsFromPortfolio(U.resolveHoldings(p, date).items || []);
  const baseIndex = typeof idxOrName === 'number' ? idxOrName : base.findIndex(i => i.name === idxOrName);
  const plan = T.planBackdatedTrade(p, { accountType: p.accountType, date, baseItems: base, baseIndex, newQty, price, cashOn: !!extra.cashOn, mode: extra.mode || 'auto' });
  const next = plan.ok ? T.applyBackdatedTrade(p, plan, base) : p;
  return { plan, next };
};
// App '자산검증 P1' 효과 흉내 — 마지막 기록의 구성 지문이 계좌 표와 다르면 오늘 날짜로 새 기록이 붙는다(= 방금 넣은 변경이 오늘부터 되돌려진다).
const wouldAddSnapshot = (p) => {
  const snaps = [...(p.holdingSnapshots || [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = snaps[snaps.length - 1];
  return U.snapshotCompositionKey(latest.items || []) !== U.snapshotCompositionKey(p.portfolio || []);
};
const itemAt = (p, date, name) => (U.resolveHoldings(p, date).items || []).find(i => i.name === name);
const liveOf = (p, name) => (p.portfolio || []).find(i => i.name === name);
const cashAt = (p, date) => (U.resolveHoldings(p, date).items || []).find(i => i.type === 'deposit')?.depositAmount;

// 사용자 계좌 모양(AI일반 증권): 예수금 + TIGER 반도체TOP10 + KODEX 반도체 + 현금성 ETF.
const mkLive = (o = {}) => [
  { id: 'd', type: 'deposit', depositAmount: o.cash ?? 2534 },
  { id: 'm', type: 'stock', category: '현금', code: '0043B0', name: 'TIGER 머니마켓', quantity: 25, investAmount: 2603675, purchasePrice: 0, currentPrice: 104465 },
  { id: 't', type: 'stock', category: '배당주식', code: '0177R0', name: 'TIGER 반도체TOP10', quantity: o.tq ?? 10885, investAmount: o.ti ?? 113049394, purchasePrice: 0, currentPrice: 6750 },
  { id: 'k', type: 'stock', category: '배당주식', code: '0190G0', name: 'KODEX 반도체', quantity: o.kq ?? 10527, investAmount: o.ki ?? 82781906, purchasePrice: 0, currentPrice: 5695 },
];
const mkAcct = (snapsSpec, liveSpec = {}) => ({
  id: 'p1', accountType: 'portfolio', baselineDate: '2026-10-28', preBaselineVerified: false,
  holdingSnapshots: snapsSpec.map(([date, kind, o]) => ({ date, kind, items: U.snapshotItemsFromPortfolio(mkLive(o)) })),
  portfolio: mkLive(liveSpec),
});

if (T && U) {
  // ── #A 매수 — 그날부터 오늘까지 + 계좌 표 ──
  {
    const p = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}]]);
    const { plan, next } = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 12000, 6750);
    eq('#A1 매수 판정·수량 차이', [plan.ok, plan.side, plan.dq], [true, 'buy', 1115]);
    eq('#A2 투자금액 = 113,049,394 + 1,115 × 6,750', plan.newCost, 113049394 + 1115 * 6750);
    eq('#A3 그날(11/17) 수량·투자금액', [itemAt(next, '2026-11-17', 'TIGER 반도체TOP10').quantity, itemAt(next, '2026-11-17', 'TIGER 반도체TOP10').investAmount], [12000, 120575644]);
    eq('#A4 전날(11/16)은 그대로', itemAt(next, '2026-11-16', 'TIGER 반도체TOP10').quantity, 10885);
    eq('#A5 계좌 표(오늘) 수량·투자금액', [liveOf(next, 'TIGER 반도체TOP10').quantity, liveOf(next, 'TIGER 반도체TOP10').investAmount], [12000, 120575644]);
    eq('#A6 계좌 표 항목 id·현재가 보존', [liveOf(next, 'TIGER 반도체TOP10').id, liveOf(next, 'TIGER 반도체TOP10').currentPrice], ['t', 6750]);
    ok('#A7 ⚠️ App 구성 변경 효과가 오늘 날짜로 되돌림 기록을 만들지 않는다(마지막 기록 = 계좌 표)', !wouldAddSnapshot(next));
    eq('#A8 그날 기록은 수동(manual) — 추이 표 ✏️ 표시', next.holdingSnapshots.find(s => s.date === '2026-11-17').kind, 'manual');
    eq('#A9 다른 종목·예수금은 안 건드림(예수금 체크 안 함)', [itemAt(next, '2026-11-20', 'KODEX 반도체').quantity, cashAt(next, '2026-11-20'), liveOf(next, 'KODEX 반도체').investAmount], [10527, 2534, 82781906]);
    eq('#A10 기준일 그대로', next.baselineDate, '2026-10-28');
    ok('#A11 원본 계좌 객체는 바뀌지 않는다(불변)', p.portfolio[2].quantity === 10885 && p.holdingSnapshots.length === 2);
  }
  // ── #B 매도 — 평균단가 그대로, 예수금 더하기 ──
  {
    const p = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}]]);
    const { plan, next } = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 9000, 6750, { cashOn: true });
    const expCost = Math.round(113049394 * 9000 / 10885);
    eq('#B1 매도 투자금액 = 투자금액 × 남은 ÷ 원래', plan.newCost, expCost);
    ok('#B2 매도 뒤 평균단가 그대로(±1원)', Math.abs(plan.avgAfter - plan.avgBefore) < 1);
    eq('#B3 매도 금액·실현손익', [plan.amount, plan.realized], [1885 * 6750, 1885 * 6750 - (113049394 - expCost)]);
    eq('#B4 그날·오늘 예수금 + 매도 금액', [cashAt(next, '2026-11-17'), cashAt(next, '2026-11-16'), next.portfolio[0].depositAmount], [2534 + 12723750, 2534, 2534 + 12723750]);
    eq('#B5 계좌 표 수량·투자금액', [liveOf(next, 'TIGER 반도체TOP10').quantity, liveOf(next, 'TIGER 반도체TOP10').investAmount], [9000, expCost]);
    ok('#B6 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(next));
    const sellNoPrice = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 9000, 0);
    eq('#B7 매도는 단가 없이도 계산(투자금액은 평균 원가로)', [sellNoPrice.plan.ok, sellNoPrice.plan.newCost, sellNoPrice.plan.amount], [true, expCost, 0]);
    eq('#B8 전량 매도 = 투자금액 0', trade(p, '2026-11-17', 'TIGER 반도체TOP10', 0, 6750).plan.newCost, 0);
  }
  // ── #C 그날 뒤에 다른 기록이 있으면 같은 차이를 더한다 ──
  {
    const p = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}], ['2026-11-20', 'auto', { kq: 11000, ki: 85000000, cash: 1000 }]], { kq: 11000, ki: 85000000, cash: 1000 });
    const { plan, next } = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 12000, 6750, { cashOn: true });
    eq('#C1 뒤 기록 수 = 1(11/20)', plan.laterDates, ['2026-11-20']);
    eq('#C2 11/20 TIGER 수량·투자금액 이동', [itemAt(next, '2026-11-21', 'TIGER 반도체TOP10').quantity, itemAt(next, '2026-11-21', 'TIGER 반도체TOP10').investAmount], [12000, 120575644]);
    eq('#C3 11/20 KODEX(뒤에서 바뀐 값)는 그대로', itemAt(next, '2026-11-21', 'KODEX 반도체').quantity, 11000);
    eq('#C4 예수금: 그날 2,534 − 7,526,250 · 11/20 1,000 − 7,526,250 · 표도 같음', [cashAt(next, '2026-11-17'), cashAt(next, '2026-11-21'), next.portfolio[0].depositAmount], [2534 - 7526250, 1000 - 7526250, 1000 - 7526250]);
    ok('#C5 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(next));
    ok('#C6 예수금이 마이너스면 미리보기가 알 수 있다(cashAfter < 0)', plan.cashAfter < 0);
    // 같은 날 매도 + 매수(사용자 사례: '17일에 매도 매수')
    const s1 = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 9000, 6750, { cashOn: true }).next;
    const s2 = trade(s1, '2026-11-17', 'KODEX 반도체', 12527, 5695, { cashOn: true }).next;
    eq('#C7 같은 날 두 번째 편집은 첫 편집 위에서(그날 기록 1개)', s2.holdingSnapshots.filter(s => s.date === '2026-11-17').length, 1);
    eq('#C8 그날 두 종목 모두 반영', [itemAt(s2, '2026-11-17', 'TIGER 반도체TOP10').quantity, itemAt(s2, '2026-11-17', 'KODEX 반도체').quantity], [9000, 12527]);
    eq('#C9 그날 예수금 = 2,534 + 매도 12,723,750 − 매수 11,390,000', cashAt(s2, '2026-11-17'), 2534 + 12723750 - 2000 * 5695);
    eq('#C10 계좌 표 KODEX = 11,000 + 2,000 (뒤 변경 위에 더함)', liveOf(s2, 'KODEX 반도체').quantity, 13000);
    ok('#C11 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(s2));
  }
  // ── #D 옮기기 — 오늘 표에서 이미 고친 수량을 그날로 ──
  {
    const p = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}], ['2026-11-26', 'auto', { tq: 9000 }]], { tq: 9000 });
    const { plan, next } = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 9000, 6750);
    const expCost = Math.round(113049394 * 9000 / 10885);
    eq('#D1 자동으로 옮기기(계좌 표가 이미 9,000)', [plan.mode, plan.moveAvailable, plan.stopDate], ['move', true, '2026-11-26']);
    eq('#D2 그날~표에서 고친 날 전: 9,000주 · 평균 원가', [itemAt(next, '2026-11-17', 'TIGER 반도체TOP10').quantity, itemAt(next, '2026-11-25', 'TIGER 반도체TOP10').investAmount], [9000, expCost]);
    eq('#D3 표 수량은 그대로 9,000 · 투자금액은 함께 맞춤(표에서 손대지 않았으므로)', [liveOf(next, 'TIGER 반도체TOP10').quantity, liveOf(next, 'TIGER 반도체TOP10').investAmount], [9000, expCost]);
    eq('#D4 11/26 기록도 같은 투자금액', itemAt(next, '2026-11-26', 'TIGER 반도체TOP10').investAmount, expCost);
    ok('#D5 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(next));
    const add = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 9000, 6750, { mode: 'add' });
    eq('#D6 사용자가 「따로 매매로 더하기」를 고르면 표가 7,115', [add.plan.mode, liveOf(add.next, 'TIGER 반도체TOP10').quantity], ['add', 7115]);
    // 표에서 투자금액도 직접 고쳤다면 그 값은 건드리지 않는다
    const p2 = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}], ['2026-11-26', 'auto', { tq: 9000, ti: 93000000 }]], { tq: 9000, ti: 93000000 });
    const mv2 = trade(p2, '2026-11-17', 'TIGER 반도체TOP10', 9000, 6750);
    eq('#D7 표에서 고친 투자금액(93,000,000)은 그대로', [mv2.plan.mode, liveOf(mv2.next, 'TIGER 반도체TOP10').investAmount, itemAt(mv2.next, '2026-11-20', 'TIGER 반도체TOP10').investAmount], ['move', 93000000, expCost]);
    ok('#D8 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(mv2.next));
    const notMove = trade(mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}]]), '2026-11-17', 'TIGER 반도체TOP10', 9000, 6750, { mode: 'move' });
    eq('#D9 옮길 것이 없으면 옮기기를 골라도 더하기', notMove.plan.mode, 'add');
    // 옛 행(투자금액 0 · 매입단가 × 수량)은 표에서 수량을 고친 순간 원가도 따라 바뀌었다 → 옮기기 금지(두 번 빼기 방지)
    const legacy = mkAcct([['2026-10-28', 'baseline', { cash: 0, ti: 0 }], ['2026-11-26', 'auto', { tq: 9000, ti: 0 }]], { tq: 9000, ti: 0 });
    legacy.holdingSnapshots.forEach(s => s.items.forEach(i => { if (i.name === 'TIGER 반도체TOP10') i.purchasePrice = 10000; }));
    legacy.portfolio.find(i => i.name === 'TIGER 반도체TOP10').purchasePrice = 10000;
    eq('#D10 옛 행은 옮기기 안 함', trade(legacy, '2026-11-17', 'TIGER 반도체TOP10', 9000, 6750).plan.moveAvailable, false);
  }
  // ── #E 기준일보다 이른 날짜 ──
  {
    const p = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}]]);
    const { next } = trade(p, '2026-10-20', 'TIGER 반도체TOP10', 11000, 7000);
    eq('#E1 기준일을 그날로 당김 + 미검증', [next.baselineDate, next.preBaselineVerified], ['2026-10-20', false]);
    eq('#E2 기준일 기록·뒤 기록·표 모두 +115', [itemAt(next, '2026-10-28', 'TIGER 반도체TOP10').quantity, itemAt(next, '2026-11-10', 'TIGER 반도체TOP10').quantity, liveOf(next, 'TIGER 반도체TOP10').quantity], [11000, 11000, 11000]);
    ok('#E3 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(next));
  }
  // ── #F 해외 — 투자금액(USD) 칸 + 매입단가 미러 ──
  {
    const live = [
      { id: 'd', type: 'deposit', depositAmount: 500, depositAmountKrw: 0 },
      { id: 's', type: 'stock', code: 'SCHD', name: 'SCHD', quantity: 100, investAmountUsd: 2500, purchasePrice: 25, currentPrice: 27 },
    ];
    const p = { id: 'o', accountType: 'overseas', baselineDate: '2026-10-01', holdingSnapshots: [{ date: '2026-10-01', kind: 'baseline', items: U.snapshotItemsFromPortfolio(live) }], portfolio: live };
    const { plan, next } = trade(p, '2026-11-10', 'SCHD', 110, 27.5, { cashOn: true });
    eq('#F1 해외 원가 종류·투자금액', [plan.kind, plan.newCost], ['usd', 2775]);
    eq('#F2 표: investAmountUsd·매입단가 미러', [liveOf(next, 'SCHD').investAmountUsd, liveOf(next, 'SCHD').purchasePrice], [2775, 25.2272727272727]);
    eq('#F3 그날 기록 매입단가(스냅샷엔 USD 칸 없음)', [itemAt(next, '2026-11-10', 'SCHD').purchasePrice, 'investAmountUsd' in itemAt(next, '2026-11-10', 'SCHD')], [25.2272727272727, false]);
    eq('#F4 USD 예수금 − 275', [cashAt(next, '2026-11-10'), next.portfolio[0].depositAmount], [225, 225]);
    ok('#F5 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(next));
  }
  // ── #G 금현물 — 매입단가 × 수량 ──
  {
    const live = [{ id: 'd', type: 'deposit', depositAmount: 0 }, { id: 'g', type: 'stock', code: '', name: 'KRX 금현물', quantity: 10, purchasePrice: 100000, currentPrice: 150000 }];
    const p = { id: 'g1', accountType: 'gold', baselineDate: '2026-10-01', holdingSnapshots: [{ date: '2026-10-01', kind: 'baseline', items: U.snapshotItemsFromPortfolio(live) }], portfolio: live };
    const buy = trade(p, '2026-11-10', 'KRX 금현물', 20, 140000);
    eq('#G1 금 매수 = 새 평균단가 120,000', [buy.plan.kind, liveOf(buy.next, 'KRX 금현물').purchasePrice, liveOf(buy.next, 'KRX 금현물').quantity], ['pp', 120000, 20]);
    const sell = trade(p, '2026-11-10', 'KRX 금현물', 4, 140000);
    eq('#G2 금 매도 = 평균단가 그대로 100,000', [liveOf(sell.next, 'KRX 금현물').purchasePrice, liveOf(sell.next, 'KRX 금현물').quantity], [100000, 4]);
    eq('#G3 금은 옮기기 대상 아님(원가 칸이 매입단가)', buy.plan.moveAvailable, false);
  }
  // ── #H 뒤 기록에서 종목이 사라지면 거기서 멈춘다 ──
  {
    const p = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}]]);
    p.holdingSnapshots.push({ date: '2026-11-22', kind: 'auto', items: p.holdingSnapshots[1].items.filter(i => i.name !== 'TIGER 반도체TOP10') });
    p.portfolio = p.portfolio.filter(i => i.name !== 'TIGER 반도체TOP10');
    const { plan, next } = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 12000, 6750);
    eq('#H1 그날은 반영, 사라진 뒤엔 되살리지 않음', [itemAt(next, '2026-11-17', 'TIGER 반도체TOP10').quantity, itemAt(next, '2026-11-23', 'TIGER 반도체TOP10')], [12000, undefined]);
    eq('#H2 표에 없음 → 표 그대로', [plan.live.found, next.portfolio.length], [false, 3]);
    ok('#H3 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(next));
  }
  // ── #I 막는 경우 ──
  {
    const p = mkAcct([['2026-10-28', 'baseline', { cash: 0 }]]);
    eq('#I1 매수인데 단가 없음 → noprice', trade(p, '2026-11-17', 'TIGER 반도체TOP10', 12000, 0).plan.reason, 'noprice');
    eq('#I2 같은 수량 → same', trade(p, '2026-11-17', 'TIGER 반도체TOP10', 10885, 6750).plan.reason, 'same');
    ok('#I3 예수금·예적금·현금 행은 매매 대상 아님', !T.tradeEligible({ type: 'deposit' }) && !T.tradeEligible({ type: 'savings' }) && !T.tradeEligible({ type: 'stock' }, true) && T.tradeEligible({ type: 'stock' }) && T.tradeEligible({ type: 'fund' }));
    eq('#I4 펀드는 투자금액 칸', T.tradeCostKind('overseas', { type: 'fund' }), 'invest');
    const bad = trade(p, '2026-11-17', 'TIGER 반도체TOP10', 12000, 0);
    ok('#I5 계획이 실패하면 계좌를 바꾸지 않는다', bad.next === p);
  }
  // ── #J 장부(예수금+원가): 매수 + 예수금 빼기 = 장부 그대로(입출금 판정이 흔들리지 않는다) ──
  {
    const p = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', { cash: 20000000 }]], { cash: 20000000 });
    const { next } = trade(p, '2026-11-17', 'KODEX 반도체', 12527, 5695, { cashOn: true });
    const b = U.buildBookCostSeries(next, ['2026-11-16', '2026-11-17']);
    eq('#J1 매수일 장부 변화 0', b.get('2026-11-17') - b.get('2026-11-16'), 0);
  }
}

console.log('\n── 파트② 배선 (소스 텍스트 가드) ──');
const mod = read('src/backdatedTrade.ts');
const modal = stripComments(read('src/components/VerifyEvalModal.tsx'));
const pkg = JSON.parse(read('package.json'));
ok('#W1 backdatedTrade.ts는 import 0(검증 스크립트가 직접 import)', !/^\s*import\s/m.test(stripComments(mod)));
ok('#W2 모달이 세 함수를 import', /import\s*\{[^}]*planBackdatedTrade[^}]*applyBackdatedTrade[^}]*tradeEligible[^}]*\}\s*from\s*'\.\.\/backdatedTrade'/.test(modal));
const commit = modal.slice(modal.indexOf('const commitQty'), modal.indexOf('const tradeBase'));
ok('#W3 수량 편집 → 매매 대상이면 바로 쓰지 않고 미리보기(setTrade)', /tradeEligible\(r\.item, r\.isCash\)/.test(commit) && /setTrade\(\{/.test(commit) && commit.indexOf('setTrade({') < commit.indexOf('patchActivePortfolio'));
const apply = modal.slice(modal.indexOf('const applyTrade'), modal.indexOf('const applyQtyOnly'));
ok('#W4 적용은 최신 계좌 위에서 다시 계획(같은 함수) 후 applyBackdatedTrade', /patchActivePortfolio\(p =>/.test(apply) && /resolveHoldings\(p, date\)/.test(apply) && /planBackdatedTrade\(p,/.test(apply) && /applyBackdatedTrade\(p, plan, base\)/.test(apply));
ok('#W5 미리보기도 같은 함수(planBackdatedTrade)', /const tradePlan = useMemo\(\(\) => \{[\s\S]{0,200}planBackdatedTrade\(portfolio,/.test(modal));
const panel = modal.slice(modal.indexOf('function TradePanel'), modal.indexOf('export default function VerifyEvalModal'));
ok('#W6 미리보기 칸은 식을 다시 쓰지 않는다(plan 값만 표시)', panel.length > 0 && !/\*\s*plan\.price|plan\.oldCost\s*\*|newQty\s*\/\s*|\/\s*plan\.oldQty/.test(panel));
ok('#W7 모달이 TradePanel을 그린다', /<TradePanel[\s\S]{0,400}onApply=\{applyTrade\}/.test(modal));
ok('#W8 예전 방식(그날만 수량) 통로 유지 — withManualSnapshot', /const applyQtyOnly[\s\S]{0,300}withManualSnapshot\(p, date/.test(modal));
ok('#W9 카드 별도 창은 계좌 쓰기를 막는다(patchActivePortfolio=blocked)', /patchActivePortfolio=\{blocked\(/.test(read('src/components/CardWindow.tsx')));
ok('#W10 package.json에 verify:backdated-trade 등록', pkg.scripts['verify:backdated-trade'] === 'node scripts/verify-backdated-trade.mjs');

console.log(`\n  총 ${pass + fail}건 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
