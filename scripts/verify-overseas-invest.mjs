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
//     미러는 함수 본문 회귀만 잡는다. 배선(쓰기 경로 스코프·0 나눗셈 가드·지문 등록·미러 계약)은
//     미러로 표현할 수 없어 소스를 직접 읽어 단언한다(verify-twr #30d · verify-transfer #17~ 선례).
//     ⚠️ 실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:overseas — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
