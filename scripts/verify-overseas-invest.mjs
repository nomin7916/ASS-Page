#!/usr/bin/env node
// 해외계좌 투자금액(USD) = 사용자 입력 저장값 검증 — src/utils.ts 의 참조 구현과 1:1 동기화할 것.
//
// 해외 주식 행의 '투자금액'과 '보유수량'은 사용자가 직접 입력하는 칸이라 어느 쪽도 상대에서
// 자동 산출하지 않는다. 과거엔 저장 필드가 없어 화면이 purchasePrice × quantity 를 렌더하고
// blur 에 purchasePrice 만 기록해서
//   (1) 14505.01 입력 → 50.36461805… 저장 → 되곱해 14505.009999999998 (IEEE754 왕복)
//   (2) 수량만 고쳐도 총액이 자동으로 바뀜
// 두 증상이 났다. 저장 필드 `investAmountUsd` 를 신설하고 purchasePrice 는 파생 미러로 두는 설계다.
//
//   파트① 참조 구현 미러 (#1~#14)  — round15 / overseasInvestInput / overseasInvestAmount
//   파트② 소스 텍스트 가드 (#15~#26)
//   파트③ 원화 예수금 (#27~#45) — src/utils.ts 를 **직접 import** 해 산술을 검증한다(미러 금지).
//     해외계좌는 예수금·투자금액·원금·원장이 전부 USD 단일 프레임인데, 증권사 계좌에는 환전 전
//     원화가 함께 남는다. 그 원화를 담는 별도 필드가 `item.depositAmountKrw`,
//     원장의 원화 행이 `row.currency === 'KRW'` 다. 사용자 확정 규약(2026-09):
//       · 평가금액 = USD 자산 × 환율 + 원화 예수금
//       · 투자원금에는 **넣지 않는다**(환전 전 원화는 아직 투자하지 않은 대기 자금)
//       · 일간 손익에서는 **입출금으로 처리**한다(입금일에 가짜 수익이 찍히지 않게)
//     ⚠️ 하위호환의 축: 원화 값이 0이면 모든 반환값이 종전과 한 비트도 다르지 않아야 한다.
//     미러는 함수 본문 회귀만 잡는다. 배선(쓰기 경로 스코프·0 나눗셈 가드·지문 등록·미러 계약)은
//     미러로 표현할 수 없어 소스를 직접 읽어 단언한다(verify-twr #30d · verify-transfer #17~ 선례).
//     ⚠️ 실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};
const eq = (name, got, want) => {
  if (Object.is(got, want)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want}`); }
};

// ───────── 참조 구현 (src/utils.ts 미러) ─────────
const cleanNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
  return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
};

const round15 = (n) => (Number.isFinite(n) ? Number(n.toPrecision(15)) : 0);

const overseasInvestInput = (item) => {
  const v = item?.investAmountUsd;
  if (v === null || v === undefined || v === '') return null;
  const n = cleanNum(v);
  return Number.isFinite(n) ? n : null;
};

const overseasInvestAmount = (item) =>
  overseasInvestInput(item) ?? round15(cleanNum(item?.purchasePrice) * cleanNum(item?.quantity));

// 쓰기 경로 미러(usePortfolioState.handleUpdate 의 해외 주식 분기)
const applyOverseasEdit = (p, field, value) => {
  const num = cleanNum(value);
  const invest = field === 'investAmountUsd' ? num : overseasInvestAmount(p);
  const qty = field === 'quantity' ? num : cleanNum(p.quantity);
  const next = { ...p, investAmountUsd: invest, quantity: qty };
  if (qty > 0 && Number.isFinite(invest)) next.purchasePrice = invest / qty;
  return next;
};

// 해외 원가 소비자가 실제로 읽는 값(usePortfolioData:41 · useIntegratedData:711 · bookCostOf costBasisOnly)
const consumerCost = (p) => cleanNum(p.purchasePrice) * cleanNum(p.quantity);

console.log('\n── 파트① 참조 구현 미러 ──');

// #1 보고된 증상 그 자체 — 입력값이 왕복 오차 없이 되돌아온다
{
  const after = applyOverseasEdit({ type: 'stock', quantity: 288 }, 'investAmountUsd', '14505.01');
  eq('#1 14505.01 입력 → 저장값 그대로', overseasInvestAmount(after), 14505.01);
  eq('#1b 편집 초안 문자열에도 왕복 오차가 없다', String(overseasInvestAmount(after)), '14505.01');
  ok('#1c 옛 설계(단가 되곱)는 실제로 오차가 났다 — 이 테스트가 무의미하지 않음을 확인',
    (14505.01 / 288) * 288 !== 14505.01);
}

// #2 증상 (2) — 수량만 바꿔도 총액은 그대로
{
  const a = applyOverseasEdit({ type: 'stock', quantity: 288 }, 'investAmountUsd', 14505.01);
  const b = applyOverseasEdit(a, 'quantity', 300);
  eq('#2 수량 288→300 이어도 투자금액 불변', overseasInvestAmount(b), 14505.01);
  eq('#2b 구매단가(미러)만 재산출된다', b.purchasePrice, 14505.01 / 300);
}

// #3 미러 불변식 — 소비자가 읽는 원가 = 사용자가 입력한 총액
{
  const a = applyOverseasEdit({ type: 'stock', quantity: 288 }, 'investAmountUsd', 14505.01);
  ok('#3 purchasePrice × quantity ≈ 입력 총액', Math.abs(consumerCost(a) - 14505.01) < 1e-9);
  const b = applyOverseasEdit(a, 'quantity', 7);
  ok('#3b 수량 편집 뒤에도 미러 불변식 유지', Math.abs(consumerCost(b) - 14505.01) < 1e-9);
}

// #4 레거시 행(저장값 없음) — 매입가×수량 폴백, 그리고 그 폴백의 왕복 잔차를 정리한다
{
  const legacy = { type: 'stock', purchasePrice: 14505.01 / 288, quantity: 288 };
  eq('#4 레거시 폴백 = 매입가 × 수량', overseasInvestAmount(legacy), 14505.01);
  ok('#4b 폴백에 round15 가 없으면 옛 증상이 남는다',
    cleanNum(legacy.purchasePrice) * cleanNum(legacy.quantity) === 14505.009999999998);
}

// #5 레거시 행의 첫 수량 편집 = 편집 **직전** 총액으로 1회 시드
{
  const legacy = { type: 'stock', purchasePrice: 100, quantity: 300 };
  const after = applyOverseasEdit(legacy, 'quantity', 400);
  eq('#5 시드 총액 = purchasePrice × 옛수량', after.investAmountUsd, 30000);
  eq('#5b 미러는 새 수량 기준으로 재산출', after.purchasePrice, 75);
}

// #6 ⚠️ 레거시 원화 investAmount 는 절대 읽지 않는다 (costBasisOnly 방어선 우회 방지)
//    verify-twr #30b 픽스처와 같은 형태: 실제 원가 $30,000 인데 investAmount 에 원화 41,700,000 잔존
{
  const dirty = { type: 'stock', purchasePrice: 100, quantity: 300, investAmount: 41_700_000 };
  eq('#6 원화 잔존 investAmount 를 총액으로 채택하지 않는다', overseasInvestAmount(dirty), 30000);
  const after = applyOverseasEdit(dirty, 'quantity', 400);
  eq('#6b 수량 편집이 원화값을 purchasePrice 로 세탁하지 않는다', after.purchasePrice, 75);
  ok('#6c 세탁됐다면 매입단가가 3자릿수 규모로 폭발했을 것', 41_700_000 / 400 === 104_250);
}

// #7 수량 0 — 0 나눗셈 금지, 입력은 보존
{
  const a = applyOverseasEdit({ type: 'stock', quantity: 0 }, 'investAmountUsd', 14505.01);
  eq('#7 수량 0에서도 사용자 입력은 저장된다', overseasInvestAmount(a), 14505.01);
  ok('#7b purchasePrice 에 Infinity 를 쓰지 않는다', a.purchasePrice === undefined);
  const b = applyOverseasEdit(a, 'quantity', 288);
  eq('#7c 나중에 수량을 넣으면 미러가 생긴다', b.purchasePrice, 14505.01 / 288);
  eq('#7d 그 사이 총액은 변하지 않는다', overseasInvestAmount(b), 14505.01);
}

// #8 수량을 지워도(0) 총액·과거 미러가 파괴되지 않는다
{
  const a = applyOverseasEdit({ type: 'stock', quantity: 288 }, 'investAmountUsd', 14505.01);
  const b = applyOverseasEdit(a, 'quantity', '');
  eq('#8 수량 삭제 후에도 총액 보존', overseasInvestAmount(b), 14505.01);
  ok('#8b purchasePrice 가 Infinity/NaN 으로 오염되지 않는다', Number.isFinite(b.purchasePrice));
}

// #9 '0 입력'과 '미입력'은 다르다
{
  eq('#9 명시적 0 입력은 0으로 표시된다',
    overseasInvestAmount({ investAmountUsd: 0, purchasePrice: 50, quantity: 10 }), 0);
  eq('#9b 미입력(undefined)은 레거시 폴백',
    overseasInvestAmount({ purchasePrice: 50, quantity: 10 }), 500);
  eq('#9c 빈 문자열도 미입력', overseasInvestAmount({ investAmountUsd: '', purchasePrice: 50, quantity: 10 }), 500);
}

// #10 소수 수량 — 왕복 오차 0
{
  for (const q of [0.5, 1 / 3, 0.123456789, 12.75]) {
    const a = applyOverseasEdit({ type: 'stock', quantity: q }, 'investAmountUsd', 1234.56);
    eq(`#10 소수 수량 ${q} 에서도 총액 그대로`, overseasInvestAmount(a), 1234.56);
  }
}

// #11 파생 행(원화로 덮인 investAmount)을 넘겨도 총액이 오염되지 않는다
//     PortfolioTable 은 totals.calcPortfolio 행을 받는다 — 그 행의 investAmount 는 원화 환산값이다.
{
  const derived = { type: 'stock', investAmountUsd: 14505.01, purchasePrice: 50.364618, quantity: 288, investAmount: 14505.01 * 1390 };
  eq('#11 파생 행에서도 USD 저장값을 읽는다', overseasInvestAmount(derived), 14505.01);
}

// #12 round15 계약
{
  eq('#12 정상값에는 no-op', round15(14505.01), 14505.01);
  eq('#12b 왕복 잔차 제거', round15((14505.01 / 288) * 288), 14505.01);
  eq('#12c 비유한값은 0', round15(Infinity), 0);
  eq('#12d NaN 도 0', round15(NaN), 0);
  eq('#12e 0 보존', round15(0), 0);
}

// #13 손상 입력에 throw 하지 않는다
{
  ok('#13 null/undefined 안전', overseasInvestAmount(null) === 0 && overseasInvestAmount(undefined) === 0);
  eq('#13b 문자열 저장값도 숫자로 해석', overseasInvestAmount({ investAmountUsd: '14505.01' }), 14505.01);
}

// #14 음수 입력은 그대로 보존한다(정정 행 규약 — 국내 칸과 동일하게 막지 않는다)
{
  const a = applyOverseasEdit({ type: 'stock', quantity: 10 }, 'investAmountUsd', -500);
  eq('#14 음수 총액 보존', overseasInvestAmount(a), -500);
  eq('#14b 미러도 음수', a.purchasePrice, -50);
}

// ───────── 파트② 소스 텍스트 가드 ─────────
console.log('\n── 파트② 소스 텍스트 가드 ──');
{
  const utils = read('src/utils.ts');
  const ups = read('src/hooks/usePortfolioState.ts');
  const pt = read('src/components/PortfolioTable.tsx');
  const app = read('src/App.tsx');
  const upd = read('src/hooks/usePortfolioData.ts');
  const uid = read('src/hooks/useIntegratedData.ts');

  // ⚠️ 앵커는 `handleUpdateFor`(by-id 구현체)다 — 카드 별도 창이 비활성 계좌를 편집하려면 쓰기의
  //    바닥이 by-id여야 해서, 옛 `handleUpdate`는 활성 계좌를 넘기는 한 줄 위임으로 남았다.
  //    계약(해외 미러 규칙 = 유일한 쓰기 경로)은 그대로이고 위치·accountType 소스만 바뀌었다.
  //    accountType은 이제 활성 계좌가 아니라 **대상 계좌(pf)**에서 해석한다(`acctType`).
  const hu = ups.slice(ups.indexOf('const handleUpdateFor = (pid, id, field, value)'), ups.indexOf('const handleDeleteStock'));

  ok('#15 쓰기 경로는 handleUpdateFor 하나뿐 — 해외 분기가 존재한다',
    hu.length > 200 && /acctType === 'overseas'/.test(hu) && /investAmountUsd/.test(hu)
    // 옛 활성 계좌 전용 경로가 되살아나지 않았는지도 함께 단언(by-id 회귀 방지)
    && /const acctType = pf\.accountType \|\| 'portfolio';/.test(hu)
    && !/activePortfolioAccountType/.test(hu));
  ok('#16 미러 재산출이 accountType + type 으로 좁혀져 있다 (금현물·펀드 파괴 방지)',
    /acctType === 'overseas'\s*&&\s*p\.type === 'stock'/.test(hu));
  ok('#15b 활성 계좌 경로는 handleUpdateFor에 pid를 넘기는 위임이다 (앱 탭 동작 불변)',
    /const handleUpdate = \(id, field, value\) => handleUpdateFor\(activePortfolioId, id, field, value\);/.test(ups));
  ok('#17 미러는 qty > 0 일 때만 쓴다 (0 나눗셈 → Infinity 영속 방지)',
    /if \(qty > 0 && Number\.isFinite\(invest\)\) next\.purchasePrice = invest \/ qty;/.test(hu));
  ok('#18 수량 편집의 총액 소스는 overseasInvestAmount (레거시 1회 시드 + 원화값 차단)',
    /const invest = field === 'investAmountUsd' \? num : overseasInvestAmount\(p\);/.test(hu));

  ok('#19 해외 투자금액 셀이 저장값(overseasInvest)을 렌더한다',
    /value=\{editingInvestId === item\.id \? editingInvestVal : formatUSD\(overseasInvest\)\}/.test(pt));
  ok('#20 편집 초안도 저장값에서 시드한다 (되곱 문자열 노출 방지)',
    /setEditingInvestVal\(overseasInvest \? String\(overseasInvest\) : ''\)/.test(pt));
  ok('#21 셀 커밋 필드는 investAmountUsd 이고 셀에서 단가를 나누지 않는다',
    /onUpdate\(item\.id, 'investAmountUsd', next\)/.test(pt)
    && !/onUpdate\(item\.id, 'purchasePrice', next \/ qty\)/.test(pt));
  ok('#22 값이 그대로면 아무것도 쓰지 않는다 (비교 기준 = 저장값)',
    /if \(next === overseasInvest\) return;/.test(pt));

  ok('#23 portfolioStructureKey 화이트리스트에 investAmountUsd 가 있다 (조용한 유실 방지)',
    /investAmountUsd: item\.investAmountUsd/.test(app));
  // ⚠️ 부재 단언은 **함수 본문 구간**만 본다 — 파일 전체를 훑으면 위쪽 설계 주석의 산문에 걸려
  //    항상 실패한다(정규식이 코드가 아니라 주석을 읽는 전형적 오답).
  const snapBody = utils.slice(
    utils.indexOf('export const snapshotItemsFromPortfolio'),
    utils.indexOf('export const buildHeldNameMap'));
  const compKeyBody = utils.slice(
    utils.indexOf('export const snapshotCompositionKey'),
    utils.indexOf('export const snapshotCompositionKey') + 400);
  ok('#24 snapshotCompositionKey 는 investAmountUsd 를 담지 않는다 (원가 정정이 스냅샷을 만들지 않도록)',
    snapBody.length > 200
    && /\$\{it\.type\}:\$\{it\.code\}:\$\{it\.quantity\}:\$\{it\.depositAmount\}:\$\{it\.investAmount\}/.test(compKeyBody)
    && !/investAmountUsd/.test(snapBody)
    && !/investAmountUsd/.test(compKeyBody));

  ok('#25 bookCostOf 의 costBasisOnly 분기가 살아 있다 (해외 원화 잔존값 차단)',
    /const investAuthoritative = it\.type === 'fund' \|\| it\.type === 'savings';/.test(utils)
    && /if \(stored > 0 && \(investAuthoritative \|\| !costBasisOnly\)\) return s \+ stored;/.test(utils));
  ok('#26 해외 원가 소비자는 여전히 purchasePrice × quantity 를 읽는다 (미러 계약)',
    /activePortfolioAccountType === 'overseas' \|\| activePortfolioAccountType === 'gold'\) \? cleanNum\(item\.purchasePrice\) \* _qty \* fxRate/.test(upd)
    && /\(isGold \|\| p\.accountType === 'overseas'\) \? cleanNum\(item\.purchasePrice\) \* qty \* fxRate/.test(uid));
}

console.log('\n── 파트③ 원화 예수금 (src/utils.ts 직접 import) ──');

let U = null;
try {
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
} catch (e) {
  console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트③을 건너뜁니다 (${e.code || e.message}).`);
}

if (U) {
  const {
    depositKrwOf, depositRowEval, depositRowNative, isKrwLedgerRow, krwFlowRateOf,
    calcPortfolioEvalDetail, overseasUsdEvalAt, externalFlowInRange,
    computeDailyMetricsSeries, snapshotItemsFromPortfolio, snapshotCompositionKey,
    buildBookCostSeries,
  } = U;

  const near = (name, got, want, tol = 1e-6) => ok(name, Math.abs(got - want) <= tol);

  // 사용자 실측 화면(5826_환전 전용): USD 90,802.22 × 1,355.58 = ₩123,089,673
  const FX = 1355.58, USD = 90802.22, KRW = 5000000;
  const imap = { usdkrw: { '2026-09-22': FX } };
  const depOld = { id: 'd1', type: 'deposit', depositAmount: USD };
  const depNew = { id: 'd1', type: 'deposit', depositAmount: USD, depositAmountKrw: KRW };

  // ── 하위호환: 원화가 없으면 종전과 동일 ──
  near('#27 원화 없으면 depositRowEval = USD × 환율 (종전과 동일)', depositRowEval(depOld, FX, true), USD * FX, 1e-4);
  ok('#27b 국내 계좌는 환율도 원화도 타지 않는다',
    depositRowEval({ type: 'deposit', depositAmount: 1234 }, 1, false) === 1234);
  // ⚠️ 계좌 타입이 바뀌어 원화 잔존값이 남아도 비해외에서는 0으로 읽어야 이중 계상이 없다.
  ok('#28 depositKrwOf 는 비해외에서 항상 0 (잔존값 이중계상 차단)',
    depositKrwOf({ depositAmountKrw: 999999 }, false) === 0);
  ok('#28b 기존 원장 행은 원화 행이 아니다', isKrwLedgerRow({ amount: 100, fxRate: 1300 }) === false);
  ok('#28c currency:"KRW" 행만 원화 행', isKrwLedgerRow({ amount: 100, currency: 'KRW' }) === true);

  // ── 평가금액 = USD × 환율 + 원화 ──
  near('#29 depositRowEval = USD × 환율 + 원화', depositRowEval(depNew, FX, true), USD * FX + KRW, 1e-4);
  near('#29b depositRowNative = USD + 원화 ÷ 환율', depositRowNative(depNew, FX, true), USD + KRW / FX, 1e-9);
  const rOld = calcPortfolioEvalDetail([depOld], 'overseas', '2026-09-22', {}, imap, FX);
  const rNew = calcPortfolioEvalDetail([depNew], 'overseas', '2026-09-22', {}, imap, FX);
  eq('#30 종전 평가금액 (실측 화면 값)', Math.round(rOld.total), 123089673);
  eq('#30b 원화 포함 평가금액', Math.round(rNew.total), 128089673);
  near('#30c 증가분 = 원화 예수금 전액 (환율이 곱해지지 않는다)', rNew.total - rOld.total, KRW, 1e-4);
  // ⚠️ 국내 계좌에 잔존 원화 필드가 있어도 평가액이 변하면 안 된다(isOverseas 게이트).
  eq('#31 국내 계좌는 원화 필드가 있어도 무영향',
    calcPortfolioEvalDetail([{ type: 'deposit', depositAmount: 1000000, depositAmountKrw: 777 }],
      'portfolio', '2026-09-22', {}, {}, 1).total, 1000000);

  // ── USD 프레임(차트 TWR)과 원화 프레임이 같은 자산을 본다 ──
  near('#32 overseasUsdEvalAt: 환율 미전달이면 USD만 (하위호환 fail-safe)',
    overseasUsdEvalAt([depNew], '2026-09-22', {}), USD, 1e-9);
  near('#32b overseasUsdEvalAt: 환율 전달 시 USD + 원화 ÷ 환율',
    overseasUsdEvalAt([depNew], '2026-09-22', {}, FX), USD + KRW / FX, 1e-9);
  near('#32c 두 프레임이 같은 총자산을 가리킨다 (차트 ↔ 추이표 일치)',
    overseasUsdEvalAt([depNew], '2026-09-22', {}, FX) * FX, rNew.total, 1e-4);

  // ── 원장: 원금 제외 · 흐름 포함 ──
  const krwRow = { id: 'L1', date: '2026-09-22', amount: KRW, currency: 'KRW', fxRate: 0 };
  const usdRow = { id: 'L2', date: '2026-09-22', amount: 1000, fxRate: FX };
  const rateKrw = krwFlowRateOf(imap, FX);
  // ⚠️ 원화 행이 배율 1이 아니면 `d.fxRate || 라이브환율` 폴백이 원화에 환율을 곱해 ≈1,355배가 된다.
  eq('#33 krwFlowRateOf: 원화 행 배율 = 1', rateKrw(krwRow), 1);
  eq('#33b krwFlowRateOf: 달러 행 배율 = 그날 환율', rateKrw(usdRow), FX);
  near('#34 원화 프레임 흐름 = 원화 금액 그대로',
    externalFlowInRange([krwRow], [], '2026-09-21', '2026-09-22', rateKrw).in, KRW, 1e-9);
  near('#34b USD 프레임 흐름 = 원화 ÷ 환율',
    externalFlowInRange([krwRow], [], '2026-09-21', '2026-09-22',
      (d) => isKrwLedgerRow(d) ? 1 / FX : 1).in, KRW / FX, 1e-9);
  // ⚠️ rateOf 미전달 호출부(PortfolioChart 배지·evalCompare)는 프레임을 모른다 → 원화 행 제외.
  eq('#35 rateOf 없으면 원화 행을 흐름에서 제외 (단위 오염 fail-safe)',
    externalFlowInRange([krwRow], [], '2026-09-21', '2026-09-22').in, 0);
  eq('#35b rateOf 없어도 달러 행은 종전대로 집계',
    externalFlowInRange([usdRow], [], '2026-09-21', '2026-09-22').in, 1000);

  // ── 원화 입금일의 일간 손익 = 0 ──
  const d22 = computeDailyMetricsSeries([
    { date: '2026-09-21', evalAmount: rOld.total, flowIn: 0, flowOut: 0 },
    { date: '2026-09-22', evalAmount: rNew.total, flowIn: KRW, flowOut: 0 },
  ]).get('2026-09-22');
  near('#36 원화 입금일 일간 손익 = 0 (입금은 수익이 아니다)', d22.dodAbsChange, 0, 1e-6);
  near('#36b 원화 입금일 일간 수익률 = 0%', d22.dodChange, 0, 1e-9);
  ok('#36c 보류되지 않고 값을 낸다', d22.held === false);
  // ⚠️ 이 대조가 없으면 위 단언이 '흐름을 넣든 말든 0'이라는 죽은 단언인지 구분되지 않는다.
  near('#37 [대조] 흐름에서 빠지면 입금액이 통째로 가짜 수익이 된다',
    computeDailyMetricsSeries([
      { date: '2026-09-21', evalAmount: rOld.total, flowIn: 0, flowOut: 0 },
      { date: '2026-09-22', evalAmount: rNew.total, flowIn: 0, flowOut: 0 },
    ]).get('2026-09-22').dodAbsChange, KRW, 1e-6);

  // ── 스냅샷: 과거 날짜 재현 ──
  const snap = snapshotItemsFromPortfolio([depNew]);
  eq('#38 스냅샷이 원화 예수금을 보존한다', snap[0].depositAmountKrw, KRW);
  near('#38b 스냅샷 재계산 = 라이브 평가액 (과거 날짜가 어긋나지 않는다)',
    calcPortfolioEvalDetail(snap, 'overseas', '2026-09-22', {}, imap, FX).total, rNew.total, 1e-4);
  ok('#39 구성 지문: 원화가 바뀌면 새 스냅샷이 생긴다',
    snapshotCompositionKey([depNew]) !== snapshotCompositionKey([depOld]));
  // ⚠️ 토큰을 항상 붙이면 기존 계좌의 지문이 배포만으로 달라져 스냅샷이 한 번씩 더 쌓인다.
  //    '원화 금액이 안 보인다'로 재면 원화 0인 항목이 `:0`을 달아도 통과하는 죽은 단언이 된다
  //    → 종전 5필드 형식과 **정확히** 같은지 본다(변이 테스트로 실증).
  eq('#39b 구성 지문: 원화가 없으면 토큰을 붙이지 않는다 (배포 churn 방지)',
    snapshotCompositionKey([depOld]), JSON.stringify([`deposit::0:${USD}:0`]));

  // ── 장부액: 흡수 판정이 원화 흐름을 관측한다 ──
  const pf = { accountType: 'overseas', holdingSnapshots: [
    { date: '2026-09-21', kind: 'auto', items: snapshotItemsFromPortfolio([depOld]) },
    { date: '2026-09-22', kind: 'auto', items: snap },
  ] };
  const bk = buildBookCostSeries(pf, ['2026-09-21', '2026-09-22'], { rateOf: () => FX, costBasisOnly: true });
  near('#40 장부액 증가 = 원화 입금액 (환율이 두 번 곱해지지 않는다)',
    bk.get('2026-09-22') - bk.get('2026-09-21'), KRW, 1e-4);
  // ⚠️ rateOf 없이 부르면 USD 프레임이라 원화를 더하면 단위가 섞인다 → 더하지 않아야 한다.
  const bkUsd = buildBookCostSeries(pf, ['2026-09-21', '2026-09-22'], { costBasisOnly: true });
  near('#40b USD 프레임(rateOf 미전달)에서는 원화를 더하지 않는다',
    bkUsd.get('2026-09-22') - bkUsd.get('2026-09-21'), 0, 1e-9);
  // ⚠️ 국내 계좌 장부에 원화 필드가 새면 흡수 판정이 통째로 무너진다.
  const pfKr = { accountType: 'portfolio', holdingSnapshots: [
    { date: '2026-09-22', kind: 'auto', items: [{ type: 'deposit', depositAmount: 100, depositAmountKrw: 55 }] },
  ] };
  near('#40c 국내 계좌 장부는 원화 필드를 무시한다',
    buildBookCostSeries(pfKr, ['2026-09-22'], { rateOf: () => 1 }).get('2026-09-22'), 100, 1e-9);
}

// ── 파트③ 배선 가드 (소스 텍스트) ────────────────────────────────────────────
// 산술은 위에서 검증했지만 '그 함수를 화면이 실제로 부르는가'는 미러로 표현할 수 없다.
{
  const pt = read('src/components/PortfolioTable.tsx');
  const dp = read('src/components/DepositPanel.tsx');
  const upd = read('src/hooks/usePortfolioData.ts');
  const uid = read('src/hooks/useIntegratedData.ts');
  const app = read('src/App.tsx');

  ok('#41 portfolioStructureKey 화이트리스트에 depositAmountKrw 가 있다 (조용한 유실 방지)',
    /depositAmountKrw: item\.depositAmountKrw/.test(app));
  ok('#42 예수금 행이 공유 함수로 평가된다 (투자금액 = 평가금액 → 차익 0 유지)',
    /if \(item\.type === 'deposit'\) \{ inv = evl = depositRowEval\(item, fxRate, isOverseasAcc\); \}/.test(upd));
  ok('#42b 통합 대시보드 계좌 합계도 같은 함수를 쓴다',
    /const v = depositRowEval\(item, summaryFxRate, p\.accountType === 'overseas'\);/.test(uid));
  ok('#43 해외 예수금 행에 원화 입력 칸이 있다',
    /numericVal\(item\.id, 'depositAmountKrw'/.test(pt)
    && /numericBlur\(item\.id, 'depositAmountKrw'\)/.test(pt));
  // ⚠️ 새 <td>를 만들면 주식·펀드·예적금 행과 tfoot까지 전부 맞춰야 하고, 한 곳만 놓치면 정렬이 깨진다.
  ok('#43b 원화 칸은 기존 라벨 셀(colSpan) 안에 있다 (열 개수 불변)',
    /colSpan=\{depositColSpan\}/.test(pt)
    && pt.indexOf('depositAmountKrw') > pt.indexOf('colSpan={depositColSpan}'));
  // ⚠️ 개수로 센다 — 존재만 보면 입금·출금 중 **한쪽만** 지운 변이를 놓친다(실증된 죽은 단언).
  eq('#44 입출금 내역 양쪽에 원화 행 추가 버튼이 있다 (해외 전용)',
    (dp.match(/newLedgerRow\(true\)/g) || []).length, 2);
  ok('#44d 원화 버튼은 해외계좌에서만 렌더된다',
    /\{isOverseas && <button onClick=\{\(\) => setDepositHistory\(/.test(dp));
  // ⚠️ 원화 행에 환율을 저장하면 마커·누적·흐름이 그 값을 곱해 ≈1,355배 어긋난다.
  ok('#44b 원화 행은 환율을 저장하지 않는다', /fxRate: krw \? 0 :/.test(dp));
  ok('#44c 원화 행은 투자원금(USD)에 관여하지 않는다',
    /if \(isKrwLedgerRow\(h\)\) \{ setHistory\(n\); setEditField\(null\); return; \}/.test(dp));
  // ⚠️ 흐름 환산식을 화면마다 손복제하면 같은 날짜에 추이표·CSV·통합이 서로 다른 흐름을 쓴다.
  // ⚠️ HistoryPanel 은 flowRate 가 **2곳**(추이 행·기간 압축 행)이다. 존재만 보면 한쪽을
  //    옛 손복제 식으로 되돌린 변이를 놓친다(실증된 죽은 단언) → 개수로 센다.
  const hp = read('src/components/HistoryPanel.tsx');
  const uses = (t) => (t.match(/krwFlowRateOf\(indicatorHistoryMap, marketIndicators\.usdkrw\)/g) || []).length;
  eq('#45 추이표의 흐름 환산 2곳이 모두 공유 함수를 쓴다 (손복제 금지)', uses(hp), 2);
  ok('#45b CSV·통합도 같은 공유 함수를 쓴다', uses(app) >= 1 && uses(uid) >= 1);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:overseas — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
