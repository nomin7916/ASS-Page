#!/usr/bin/env node
// 종목 계좌 간 이관(transfer) 검증 — src/utils.ts 의 참조 구현과 1:1 동기화할 것.
//
// 이 기능의 위험은 UI가 아니라 회계다. 종목만 옮기고 끝내면 이관일에 원계좌는 평가액 전액이
// 가짜 손실, 대상계좌는 가짜 이익으로 찍히고, 수익률 라인이 누적 TWR(곱셈 체인)이라 그 오류가
// 이후 전 구간에 **영구 고정**된다. 그래서 이관을 '출금 + 입금' 원장 쌍으로 기록하는데,
// 그 3행 구성(원계좌 출금 1행 / 대상계좌 입금 + 음수출금 2행)이 정확히 다음을 만족해야 한다:
//
//   파트① 참조 구현 미러 (#1~#16)
//     #1~#4   흐름  — 원계좌 유출 = 대상계좌 유입 = M(시가). 손실 포지션·차익 0에서도 성립
//     #5~#6   원금  — 양쪽 모두 C(매입원가)만 이동 (cumDepositsUpTo = anchor 경로)
//     #7~#8   개별 계좌 과거 원금 불변 (finalChartData epochBase 역산)
//     #9      통합 과거 원금 불변 (effectivePrincipal back-out에서 +G와 −G가 상쇄)
//     #10~#12 일간 지표 — 통합 손익 0 / 개별은 시장분만
//     #13~#16 collectTransferRows 계약 · noPrincipal 미사용
//   파트② 소스 텍스트 가드 (#17~#27)
//     미러는 함수 본문 회귀만 잡는다. 배선(단일 setPortfolios·지문 갱신·기록일 소스·읽기 전용
//     패드)은 미러로 표현할 수 없어 소스를 직접 읽어 계약을 단언한다
//     (verify-twr.mjs #30d · verify-flow.mjs #27~#36 선례).
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
const near = (name, got, want, tol = 1e-6) => {
  const good = Math.abs(got - want) <= tol;
  if (good) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want}`); }
};

// ───────── 참조 구현 (src/utils.ts 미러) ─────────
const cleanNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = parseFloat(v.replace(/,/g, '')); return Number.isFinite(n) ? n : 0; }
  return 0;
};
let idSeq = 0;
const generateId = () => `gen${++idSeq}`;
const formatNumber = (n) => new Intl.NumberFormat('ko-KR').format(cleanNum(n));

// utils.ts buildTransferLedgerRows 미러
function buildTransferLedgerRows(args) {
  const a = args || {};
  const M = cleanNum(a.market);
  const C = cleanNum(a.cost);
  const G = M - C;
  const qty = cleanNum(a.quantity);
  const srcName = String(a.sourceName || '').trim() || '계좌';
  const tgtName = String(a.targetName || '').trim() || '계좌';
  const meta = {
    id: a.transferId || '', code: String(a.code || ''), name: String(a.name || ''),
    quantity: qty, market: M, cost: C, itemType: a.itemType || 'stock',
    fromId: a.sourceId || '', fromName: srcName, toId: a.targetId || '', toName: tgtName,
  };
  const unit = a.itemType === 'fund' ? '좌' : a.itemType === 'savings' ? '' : '주';
  const label = `${meta.name || meta.code || '종목'}${qty > 0 && unit ? ` ${formatNumber(qty)}${unit}` : ''}`;
  const ids = Array.isArray(a.rowIds) ? a.rowIds : [];
  return {
    srcWithdrawal: {
      id: ids[0] || generateId(), date: a.dateSrc, amount: M, principalDeducted: C,
      fxRate: 1, noPrincipal: false, memo: `[이관→${tgtName}] ${label}`,
      transfer: { ...meta, role: 'out' },
    },
    tgtDeposit: {
      id: ids[1] || generateId(), date: a.dateTgt, amount: M,
      fxRate: 1, noPrincipal: false, memo: `[이관←${srcName}] ${label}`,
      transfer: { ...meta, role: 'in' },
    },
    tgtGainRow: Math.round(G) === 0 ? null : {
      id: ids[2] || generateId(), date: a.dateTgt, amount: 0, principalDeducted: G,
      fxRate: 1, noPrincipal: false,
      memo: `[이관←${srcName}] ${label} 평가차익 ${G > 0 ? '+' : ''}${formatNumber(Math.round(G))} — 원금 보정(금액 이동 없음)`,
      transfer: { ...meta, role: 'gain' },
    },
  };
}

// utils.ts collectTransferRows 미러
function collectTransferRows(p) {
  const out = [];
  const scan = (list) => (Array.isArray(list) ? list : []).forEach((r) => {
    const t = r && r.transfer;
    if (!t || typeof t !== 'object' || t.role === 'gain') return;
    if (!r.date || typeof r.date !== 'string') return;
    out.push({ ...t, date: r.date, rowId: r.id, amount: cleanNum(r.amount) });
  });
  scan(p?.depositHistory);
  scan(p?.depositHistory2);
  return out;
}

// utils.ts externalFlowInRange 미러 (개별 계좌 흐름)
function externalFlowInRange(deps, wds, fromExclusive, toInclusive) {
  let inFlow = 0, outFlow = 0;
  const inRange = (dt) => dt && dt > (fromExclusive || '') && dt <= (toInclusive || '');
  for (const d of deps || []) {
    if (!d || d.noPrincipal || !inRange(d.date || '')) continue;
    const v = cleanNum(d.amount);
    if (v > 0) inFlow += v; else if (v < 0) outFlow += -v;
  }
  for (const w of wds || []) {
    if (!w || !inRange(w.date || '')) continue;
    const v = cleanNum(w.amount);
    if (v > 0) outFlow += v; else if (v < 0) inFlow += -v;
  }
  return { in: inFlow, out: outFlow, net: inFlow - outFlow };
}

// utils.ts cumDepositsUpTo 미러 (원금 anchor 경로)
function cumDepositsUpTo(date, deps, wds) {
  let cum = 0;
  for (const d of deps || []) {
    if ((d.date || '') > date) continue;
    if (!d.noPrincipal) cum += cleanNum(d.amount);
  }
  for (const w of wds || []) {
    if ((w.date || '') > date) continue;
    if (!w.noPrincipal) cum -= (w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount));
  }
  return cum;
}

// utils.ts dailyFlowAdjustedRate 미러
const dailyFlowAdjustedRate = (prevEval, curEval, flowIn, flowOut) => {
  const base = (prevEval || 0) + (flowIn || 0);
  if (!(base > 0)) return 0;
  const r = (((curEval || 0) + (flowOut || 0)) / base - 1) * 100;
  return Number.isFinite(r) ? r : 0;
};

// App.tsx finalChartData 의 epochBase 역산 미러 (개별 계좌 과거 원금)
//   principal 필드는 '현재 원금'이고, post-start 원장을 되빼서 시작 시점 원금을 복원한다.
function epochBase(principalField, deps, wds, startDate) {
  let post = 0;
  for (const d of deps || []) { if (d.date <= startDate) continue; if (!d.noPrincipal) post += cleanNum(d.amount); }
  for (const w of wds || []) { if (w.date <= startDate) continue; if (!w.noPrincipal) post -= (w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount)); }
  return Math.max(0, cleanNum(principalField) - post);
}

// useIntegratedData effectivePrincipal 의 back-out 미러 (통합 과거 원금)
//   ⚠️ 이 소비자는 raw amount만 본다(noPrincipal·principalDeducted 미반영) — 기존 동작 그대로 미러링.
function intPastPrincipal(currentPrincipal, deps, wds, date) {
  const futureDeps = (deps || []).filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0), 0);
  const futureWds = (wds || []).filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0), 0);
  return Math.max(0, currentPrincipal - futureDeps + futureWds);
}

// useIntegratedData ① 원장 집계 미러 (통합 흐름 — 부호 라우팅이 externalFlowInRange와 동일해야 한다)
function intLedgerFlow(deps, wds, onDate) {
  let inF = 0, outF = 0;
  (deps || []).forEach(d => {
    if (!d || !d.date || d.noPrincipal || d.date !== onDate) return;
    const v = cleanNum(d.amount);
    if (v > 0) inF += v; else if (v < 0) outF += -v;
  });
  (wds || []).forEach(w => {
    if (!w || !w.date || w.date !== onDate) return;
    const v = cleanNum(w.amount);
    if (v > 0) outF += v; else if (v < 0) inF += -v;
  });
  return { in: inF, out: outF };
}

// useIntegratedData ① + ①-c 미러 — **통합 뷰**의 계좌 간 이관 쌍 상쇄.
//   이관은 '원계좌 출금 M + 대상계좌 입금 M' 원장 쌍이라 순액은 0인데 총유입·총유출이 각각 M만큼
//   부푼다. Modified Dietz 분모가 (V_prev + IN)이라 그날 수익률이 (V+M)/(V_prev+M)−1 로 희석된다.
//   ⚠️ src(useIntegratedData.ts)의 holdTransfer / xferPend.forEach 본문과 **항상 1:1 동기화**할 것.
function intFlowNetted(accounts, onDate) {
  const inMap = new Map(), outMap = new Map();
  const addIn = (d, v) => { if (d && v > 0) inMap.set(d, (inMap.get(d) || 0) + v); };
  const addOut = (d, v) => { if (d && v > 0) outMap.set(d, (outMap.get(d) || 0) + v); };
  const xferPend = new Map();
  const holdTransfer = (row, side, date, v) => {
    const xf = row && row.transfer;
    if (!xf || !xf.id || xf.role !== side || !(v > 0)) return false;
    const key = String(xf.id);
    const rec = xferPend.get(key) || { in: null, out: null, bad: false };
    if (rec[side]) { rec.bad = true; xferPend.set(key, rec); return false; }
    rec[side] = { date, v };
    xferPend.set(key, rec);
    return true;
  };
  for (const acc of accounts || []) {
    (acc.deps || []).forEach(d => {
      if (!d || !d.date || d.noPrincipal) return;
      const v = cleanNum(d.amount);
      if (holdTransfer(d, 'in', d.date, v)) return;
      if (v > 0) addIn(d.date, v); else if (v < 0) addOut(d.date, -v);
    });
    (acc.wds || []).forEach(w => {
      if (!w || !w.date) return;
      const v = cleanNum(w.amount);
      if (holdTransfer(w, 'out', w.date, v)) return;
      if (v > 0) addOut(w.date, v); else if (v < 0) addIn(w.date, -v);
    });
  }
  xferPend.forEach(rec => {
    if (!rec.bad && rec.in && rec.out && rec.in.date === rec.out.date) return;   // 상쇄
    if (rec.in) addIn(rec.in.date, rec.in.v);
    if (rec.out) addOut(rec.out.date, rec.out.v);
  });
  return { in: inMap.get(onDate) || 0, out: outMap.get(onDate) || 0 };
}

// ───────── 시나리오 ─────────
// 스크린샷 실측: KODEX 미국배당커버드콜액티브 704주 · 매입원가 8,276,752 · 평가 9,127,360
const C = 8276752, M = 9127360, G = M - C;   // G = 850,608
const D = '2026-08-05';
const mk = (opts = {}) => buildTransferLedgerRows({
  transferId: 'tr1', code: '441640', name: 'KODEX 미국배당커버드콜액티브', quantity: 704,
  itemType: 'stock', market: opts.market ?? M, cost: opts.cost ?? C,
  dateSrc: D, dateTgt: D, sourceId: 'A', sourceName: '일반', targetId: 'B', targetName: 'ISA',
  rowIds: ['r-out', 'r-in', 'r-gain'],
});

console.log('\n── 파트① 참조 구현 미러 ──');
{
  const r = mk();
  // 이관 후 각 계좌의 원장 (이관 전에는 둘 다 비어 있다고 두어 delta를 그대로 읽는다)
  const aWds = [r.srcWithdrawal], aDeps = [];
  const bDeps = [r.tgtDeposit], bWds = r.tgtGainRow ? [r.tgtGainRow] : [];

  const fa = externalFlowInRange(aDeps, aWds, '2026-08-04', D);
  near('#1 원계좌 유출 = 시가 M', fa.out, M);
  near('#1b 원계좌 유입 = 0', fa.in, 0);

  const fb = externalFlowInRange(bDeps, bWds, '2026-08-04', D);
  near('#2 대상계좌 유입 = 시가 M', fb.in, M);
  near('#2b 대상계좌 유출 = 0 (원가 보정 행은 금액 0이라 흐름 기여 없음)', fb.out, 0);

  // 통합 ① 집계도 같은 부호 라우팅이어야 한다(개별과 통합이 갈리면 두 화면이 정면 모순)
  const ia = intLedgerFlow(aDeps, aWds, D), ib = intLedgerFlow(bDeps, bWds, D);
  ok('#2c 통합 집계도 동일 (유출 M / 유입 M)', Math.abs(ia.out - M) < 1e-6 && Math.abs(ib.in - M) < 1e-6);

  near('#5 원계좌 원금 delta = −매입원가 C', cumDepositsUpTo(D, aDeps, aWds), -C);
  near('#6 대상계좌 원금 delta = +매입원가 C', cumDepositsUpTo(D, bDeps, bWds), C);

  ok('#15 세 행 모두 noPrincipal 미사용', [r.srcWithdrawal, r.tgtDeposit, r.tgtGainRow].every(x => x && x.noPrincipal === false));
  ok('#16 대상계좌 입금 행에는 principalDeducted가 없다', !('principalDeducted' in r.tgtDeposit));
  ok('#16b 원가 보정 행은 금액 0 · principalDeducted = G', r.tgtGainRow.amount === 0 && Math.abs(r.tgtGainRow.principalDeducted - G) < 1e-6);
}

// #3 손실 포지션 — 부호가 뒤집혀도 유입/유출 규약이 이익 포지션과 **동일**해야 한다.
//    (amount: -G 방식이면 여기서 유입 C · 유출 |G|로 갈라져 일간 수익률 분모가 prev+C가 된다)
{
  const lossM = 7000000;
  const r = mk({ market: lossM });
  const fb = externalFlowInRange([r.tgtDeposit], r.tgtGainRow ? [r.tgtGainRow] : [], '', D);
  near('#3 손실 포지션에서도 대상계좌 유입 = M', fb.in, lossM);
  near('#3b 손실 포지션에서도 대상계좌 유출 = 0 (이익 포지션과 동일 규약)', fb.out, 0);
  near('#3c 손실 포지션 원금 delta = +C (평가손실은 원금 무관)', cumDepositsUpTo(D, [r.tgtDeposit], [r.tgtGainRow]), C);
  // 일간 수익률 분모가 prev + M 이어야 한다(prev + C가 되면 이익/손실 규약이 갈린다)
  const prev = 40000000, m = 400000;
  const cur = prev + lossM + m;
  near('#3d 손실 포지션 일간 수익률 분모 = 전일V + M', dailyFlowAdjustedRate(prev, cur, fb.in, fb.out), (m / (prev + lossM)) * 100, 1e-9);
}

// #4 평가차익 0 — 노이즈 행을 만들지 않는다
{
  const r = mk({ market: C });
  ok('#4 평가차익 0이면 보정 행을 만들지 않는다', r.tgtGainRow === null);
  near('#4b 그래도 대상계좌 유입 = M', externalFlowInRange([r.tgtDeposit], [], '', D).in, C);
}

// #7~#9 과거 원금 불변
{
  const r = mk();
  const START = '2026-01-01';
  const PA = 50000000, PB = 30000000;   // 이관 전 각 계좌의 principal 필드
  // 이관 후: A는 −C, B는 +C
  const aP = PA - C, bP = PB + C;
  const aDeps = [], aWds = [r.srcWithdrawal];
  const bDeps = [r.tgtDeposit], bWds = r.tgtGainRow ? [r.tgtGainRow] : [];

  near('#7 개별 원계좌 과거 원금 불변 (epochBase 역산)', epochBase(aP, aDeps, aWds, START), PA);
  near('#8 개별 대상계좌 과거 원금 불변 (epochBase 역산)', epochBase(bP, bDeps, bWds, START), PB);

  const past = '2026-07-01';
  const sumBefore = PA + PB;
  const sumAfter = intPastPrincipal(aP, aDeps, aWds, past) + intPastPrincipal(bP, bDeps, bWds, past);
  near('#9 통합 과거 원금 불변 (+G와 −G가 상쇄)', sumAfter, sumBefore);
  // 상쇄가 우연이 아님을 명시: 계좌별로는 어긋난다
  near('#9b 원계좌만 보면 +G 만큼 어긋난다(상쇄 전제)', intPastPrincipal(aP, aDeps, aWds, past) - PA, G);
}

// #10~#12 일간 지표
{
  const r = mk();
  const prevA = 60000000, prevB = 40000000;
  const mktA = 300000, mktB = 200000;              // 그날 각 계좌의 시장 손익
  const curA = prevA - M + mktA;                    // 이관으로 M 빠짐
  const curB = prevB + M + mktB;                    // 이관으로 M 들어옴

  const fa = externalFlowInRange([], [r.srcWithdrawal], '', D);
  const fb = externalFlowInRange([r.tgtDeposit], r.tgtGainRow ? [r.tgtGainRow] : [], '', D);

  near('#11 개별 원계좌 일간 손익 = 시장분만', (curA - prevA) - (fa.in - fa.out), mktA);
  near('#12 개별 대상계좌 일간 손익 = 시장분만', (curB - prevB) - (fb.in - fb.out), mktB);

  // 통합: ΔV는 시장분 합계뿐이고 IN=OUT=M 이라 흐름이 정확히 상쇄된다
  const prevT = prevA + prevB, curT = curA + curB;
  const inT = fa.in + fb.in, outT = fa.out + fb.out;
  near('#10 통합 일간 손익 = 시장분 합계 (이관 기여 0)', (curT - prevT) - (inT - outT), mktA + mktB);
  near('#10b 통합 유입 = 유출 = M', inT - outT, 0);

  // 원장 없이 종목만 옮겼다면 얼마나 틀리는가 — 이 기능이 막는 결함의 크기
  const naive = dailyFlowAdjustedRate(prevA, curA, 0, 0);
  ok('#10c (대조군) 원장이 없으면 원계좌 일간 수익률이 −10% 이하로 붕괴', naive < -10);
}

// #13~#14 collectTransferRows
{
  const r = mk();
  const p = {
    name: 'ISA',
    depositHistory: [r.tgtDeposit, { id: 'x', date: '2026-07-01', amount: 100 }],
    depositHistory2: [r.tgtGainRow, { id: 'y', date: '2026-07-02', amount: 50 }, { id: 'z', transfer: { role: 'in' } }],
  };
  const rows = collectTransferRows(p);
  ok('#13 평가차익 행(role gain)은 제외된다', rows.every(x => x.role !== 'gain'));
  ok('#13b 이관 행만 남는다 (일반 원장 행 제외)', rows.length === 1 && rows[0].role === 'in');
  ok('#14 날짜 없는 손상 행은 무시된다', rows.every(x => typeof x.date === 'string' && x.date));

  const a = collectTransferRows({ depositHistory2: [r.srcWithdrawal] });
  ok('#14b 출금 원장(depositHistory2)도 스캔한다', a.length === 1 && a[0].role === 'out');
  ok('#14c 수량·상대 계좌명이 실려 온다', a[0].quantity === 704 && a[0].toName === 'ISA');
  ok('#14d 손상 입력에 throw하지 않는다', collectTransferRows(null).length === 0 && collectTransferRows({ depositHistory: 'x' }).length === 0);
}

// ───────── 파트② 소스 텍스트 가드 ─────────
console.log('\n── 파트② 소스 텍스트 가드 ──');
{
  const ups = read('src/hooks/usePortfolioState.ts');
  const app = read('src/App.tsx');
  const cal = read('src/components/CalendarModal.tsx');
  const utils = read('src/utils.ts');

  const tfn = ups.slice(ups.indexOf('const transferStockToPortfolio'), ups.indexOf('const handleAddStock'));
  ok('#17 이관은 setPortfolios를 단 한 번만 호출한다 (두 계좌 원자적 갱신)',
    tfn.length > 200 && (tfn.match(/setPortfolios\(/g) || []).length === 1);
  ok('#17b patchActive/setPortfolio(활성 전용)를 쓰지 않는다',
    !/\bpatchActive\(/.test(tfn) && !/\bsetPortfolio\(/.test(tfn));
  ok('#18 양쪽 계좌의 dividendHistoryUpdatedAt을 갱신한다 (STATE 저장 트리거)',
    (tfn.match(/dividendHistoryUpdatedAt:\s*stamp/g) || []).length === 2);
  ok('#19 manualPriceOverrides는 원계좌 제거 목록(CODE_MAPS)에 없다 — 과거 스냅샷 재계산에 필요',
    /const CODE_MAPS = \[[^\]]*\]/s.test(tfn) && !/CODE_MAPS = \[[^\]]*manualPriceOverrides/s.test(tfn));
  ok('#19b 대상계좌에는 manualPriceOverrides를 복제한다',
    /next\.manualPriceOverrides = \{ \.\.\.\(p\.manualPriceOverrides \|\| \{\}\), \[code\]: carried\.manualPriceOverrides \}/.test(tfn));
  ok('#20 id 생성은 setPortfolios updater 밖에서 (StrictMode 이중 호출 방어)',
    tfn.indexOf('const movedItemId = generateId()') > 0
    && tfn.indexOf('const movedItemId = generateId()') < tfn.indexOf('setPortfolios('));
  ok('#21 updater 안에서 prev의 항목을 재확인해 멱등이다', /if \(!it\) return prev;/.test(tfn));
  ok('#22 기록일은 getBackfillBoundaryForAccount (effectiveDateKey state·getTodayKST 아님)',
    /getBackfillBoundaryForAccount\(src\.accountType/.test(tfn)
    && /getBackfillBoundaryForAccount\(tgt\.accountType/.test(tfn));

  const del = ups.slice(ups.indexOf('const handleDeleteStock'), ups.indexOf('const transferStockToPortfolio'));
  ok('#23 종목 삭제가 확인 창을 거친다 (이관 버튼 옆이라 오클릭 방지)',
    /await confirm\(/.test(del) && /setPortfolio\(prev => prev\.filter/.test(del));

  const plan = app.slice(app.indexOf('const buildTransferPlan'), app.indexOf('const handleTransferStock'));
  ok('#24 이관 금액은 직전 기록일 종가 (calcPortfolioEvalDetail)', /calcPortfolioEvalDetail\(\[transferItem\]/.test(plan));
  ok('#24b 원가는 bookCostOf — buildBookCostSeries의 장부액 정의와 일치',
    /bookCostOf\(\[transferItem\], \{ costBasisOnly: isOv \|\| srcType === 'gold' \}\)/.test(plan));
  ok('#24c 기록일은 getBackfillBoundaryForAccount', (plan.match(/getBackfillBoundaryForAccount\(/g) || []).length === 2);
  // ⚠️ calcPortfolioEvalDetail은 해외계좌를 내부에서 원화 환산한다 → USD로 되돌리지 않으면 약 1,390배
  ok('#24d 해외계좌 이관 금액은 USD로 되돌린다 (원장·원금과 단위 일치)',
    /isOv \? r\.total \/ \(r\.fxRate \|\| 1\) : r\.total/.test(plan));

  ok('#25 동일 코드 대상 계좌는 차단된다 (분배금·과표 맵 무음 덮어쓰기 방지)',
    /reason = '이미 보유'/.test(app));
  ok('#25b 통화·시장이 다른 계좌도 차단된다', /reason = '통화 불일치'/.test(app) && /reason = '시장 불일치'/.test(app));

  ok('#26 새 창 투영에 이관 원장 행이 실린다', /depositHistory: \(p\.depositHistory \|\| \[\]\)\.filter\(r => r && r\.transfer\)/.test(app));
  ok('#26b 새 창 지문에 이관 기록이 포함된다 (없으면 MOVE 칩이 갱신 안 됨)',
    /collectTransferRows\(p\)\.map\(r => `\$\{r\.date\}:\$\{r\.rowId\}:\$\{r\.role\}`\)/.test(app));

  ok('#27 달력은 원장에서 라이브 파생한다 (calendarMemos 복사 금지)',
    /const transfersByDate = useMemo/.test(cal) && /collectTransferRows\(p\)/.test(cal));
  const tbd = cal.slice(cal.indexOf('const transfersByDate'), cal.indexOf('// 패드는 전부 앵커'));
  ok('#27b transfersByDate는 memos/onUpdateMemos를 건드리지 않는다',
    !/onUpdateMemos/.test(tbd) && !/setPad/.test(tbd));
  ok('#27c MOVE 패드는 읽기 전용 (savePad allow-list 밖)',
    /if \(pad\.kind\) \{ setPad\(null\); return; \}/.test(cal)
    && !/pad\.kind === 'transfer'.*savePad/s.test(cal.slice(cal.indexOf('const savePad'), cal.indexOf('const savePad') + 900)));
  ok('#27d MOVE 칩·패드 라벨이 일치한다',
    /transfer: 'MOVE'/.test(cal) && (cal.match(/transfer: 'MOVE'/g) || []).length === 2);

  ok('#28 utils가 이관 헬퍼 2종을 내보낸다',
    /export const buildTransferLedgerRows/.test(utils) && /export const collectTransferRows/.test(utils));

  // ── #30~#33 '비운 계좌의 평가액 0' 배선 (이관 이중 계상 방지) ────────────────────
  // 종목을 전부 옮겨 비운 계좌가 과거 구성을 carry-forward로 유지하면, 대상계좌는 같은 날 그
  // 종목을 이미 반영하므로 그날 총자산이 이관 금액만큼 부풀려진다(2026-08 실측: 8/4 총자산이
  // ₩877,810,911로 표시, 정상값 대비 +₩112,511,543). 아래 4개 배선이 그 경로를 막는다.
  const intg = read('src/hooks/useIntegratedData.ts');
  const hp = read('src/components/HistoryPanel.tsx');

  const bces = utils.slice(utils.indexOf('export const buildCloseEvalSeries'), utils.indexOf('export const calcPortfolioEvalForDate'));
  // ⚠️ 2026-08 예수금 짝 시계열(depositOut) 도입으로 그 줄이 `{ closeVal = 0; depVal = 0; }` 블록이
  //    됐다 — **계약은 그대로**(빈 포지션은 이월이 아니라 exact 0)라 정규식만 갱신한다.
  ok('#30 buildCloseEvalSeries: 평가 포지션이 0건이면 이월이 아니라 exact 0',
    /r\.items\.length === 0\)\s*\{?\s*closeVal = 0/.test(bces));

  ok('#30b utils가 evalSeriesDates(기록일 ∪ 구성 변경일)를 내보낸다',
    /export const evalSeriesDates/.test(utils) && /holdingSnapshots/.test(utils.slice(utils.indexOf('export const evalSeriesDates'), utils.indexOf('export const buildCloseEvalSeries'))));

  const ms = intg.slice(intg.indexOf('const marketSeries = useMemo'), intg.indexOf('const computedIntHistory'));
  ok('#31 marketSeries는 평가액 0을 버리지 않는다 (`v > 0` 게이트 금지)',
    ms.length > 200 && !/if \(v > 0\) map\.set/.test(ms) && /if \(cb != null\) \{ map\.set/.test(ms));
  ok('#31b marketSeries는 구성 변경일도 평가한다 (evalSeriesDates 사용)',
    /evalSeriesDates\(src,/.test(ms));
  ok('#31c 계좌 편입일은 평가액이 0을 넘는 첫 날짜다 (dates[0] 금지)',
    /const d0 = dates\.find\(d => \(map\.get\(d\) \|\| 0\) > 0\)/.test(intg));

  ok('#32 개별 계좌 차트·추이 표도 같은 날짜 집합을 쓴다 (통합과 값이 갈리지 않게)',
    /buildCloseEvalSeries\(activePortfolio, evalSeriesDates\(activePortfolio,/.test(app)
    && /buildCloseEvalSeries\(activePortfolio, evalSeriesDates\(activePortfolio,/.test(hp));

  const snapEff = app.slice(app.indexOf('// ── 자산검증 P1: 구성 변경 트리거 보유 스냅샷 기록 ──'), app.indexOf('if (changed) setPortfolios(next);'));
  ok('#33 빈 구성 스냅샷은 baseline 부트스트랩에서만 막는다 (비워진 계좌는 기록)',
    snapEff.length > 200
    && /items\.length === 0 && snaps\.length === 0\) return null/.test(snapEff)
    && !/^\s*if \(items\.length === 0\) return null;/m.test(snapEff));
}

// #29 JSX 주석 무결성 — 이 저장소에서 실제로 빌드를 두 번 죽인 원인
{
  const bad = [];
  for (const rel of ['src/App.tsx', 'src/components/CalendarModal.tsx', 'src/components/PortfolioTable.tsx', 'src/components/StockTransferModal.tsx']) {
    const src = read(rel);
    let i = 0;
    while ((i = src.indexOf('{/*', i)) !== -1) {
      const end = src.indexOf('*/', i + 3);
      if (end === -1) { bad.push(`${rel}: 닫히지 않은 JSX 주석`); break; }
      const body = src.slice(i + 3, end);
      const lineNo = src.slice(0, i).split('\n').length;
      if (body.includes('/*')) bad.push(`${rel}:${lineNo} — 주석 본문에 '/*'가 있어 조기 종료됨`);
      else if (src[end + 2] !== '}') bad.push(`${rel}:${lineNo} — JSX 주석이 '}'로 닫히지 않음`);
      i = end + 2;
    }
  }
  ok(`#29 JSX 주석이 조기 종료되지 않는다${bad.length ? `\n      ${bad.join('\n      ')}` : ''}`, bad.length === 0);
}

// ── 파트④ 통합 뷰 이관 쌍 상쇄 (#34~#41) ─────────────────────────────────────
// 사용자 보고(2026-08): 통합 월간 '전월대비'가 손익÷직전평가액(2.12%)보다 낮은 1.90%였다.
// 원인은 이관·계좌 이동이 통합 뷰에서도 외부 입출금으로 계상돼 그날 분모가 부푼 것.
console.log('\n── 파트④ 통합 뷰 이관 쌍 상쇄 ──');
{
  const r = mk();
  const A = { deps: [], wds: [r.srcWithdrawal] };
  const B = { deps: [r.tgtDeposit], wds: r.tgtGainRow ? [r.tgtGainRow] : [] };

  const both = intFlowNetted([A, B], D);
  ok('#34 양쪽 계좌가 집계 대상이면 쌍을 통째로 제거 (통합 안에서 자리만 바뀜)', both.in === 0 && both.out === 0);

  // ⚠️ 순액은 상쇄 전에도 0이었다 — 바뀌는 건 **총액**뿐이다. 그래서 dodAbsChange(=ΔV−순흐름)와
  //    보류 판정(shouldHoldDailyMetrics는 fIn−fOut만 본다)은 무변이고, 오직 %만 정확해진다.
  const rawB = intLedgerFlow(B.deps, B.wds, D), rawA = intLedgerFlow(A.deps, A.wds, D);
  near('#35 상쇄 전에도 순액은 0', (rawA.in + rawB.in) - (rawA.out + rawB.out), 0);
  ok('#35b 상쇄 전 총액은 각각 M (이게 분모를 부풀리던 값)', Math.abs(rawB.in - M) < 1e-6 && Math.abs(rawA.out - M) < 1e-6);

  // Modified Dietz: (V + OUT) / (V_prev + IN) − 1
  const rate = (prevV, v, fIn, fOut) => ((v + fOut) / (prevV + fIn) - 1) * 100;
  const prevV = 774826963, v = prevV * 1.01;   // 그날 시장 +1.00%
  near('#36 상쇄 후에는 시장 등락이 그대로 나온다', rate(prevV, v, both.in, both.out), 1.0, 1e-9);
  ok('#36b 상쇄 전에는 이관 금액만큼 희석됐다 (사용자가 본 증상)', rate(prevV, v, M, M) < 1.0 - 0.005);

  // ⚠️ 한쪽이 집계 대상이 아니면(TEST·삭제·기록 0건) 상쇄 금지 — 통합 자산이 실제로 드나든 것이다.
  const onlyA = intFlowNetted([A], D);
  ok('#37 원계좌만 집계 대상 → 유출 M 유지', Math.abs(onlyA.out - M) < 1e-6 && onlyA.in === 0);
  const onlyB = intFlowNetted([B], D);
  ok('#37b 대상계좌만 집계 대상 → 유입 M 유지', Math.abs(onlyB.in - M) < 1e-6 && onlyB.out === 0);

  // ⚠️ 기록 확정일이 갈린 쌍은 상쇄 금지 — 원계좌 출금일에 M이 통째로 가짜 손실이 된다.
  const rSplit = buildTransferLedgerRows({
    transferId: 'tr2', code: 'X', name: 'X', quantity: 1, itemType: 'stock', market: M, cost: C,
    dateSrc: D, dateTgt: '2026-08-06', sourceId: 'A', sourceName: 'a', targetId: 'B', targetName: 'b',
    rowIds: ['o2', 'i2', 'g2'],
  });
  const split = intFlowNetted([{ deps: [], wds: [rSplit.srcWithdrawal] }, { deps: [rSplit.tgtDeposit], wds: [] }], D);
  ok('#38 날짜가 갈린 쌍은 상쇄하지 않는다 (원계좌 출금일 유출 M 유지)', Math.abs(split.out - M) < 1e-6);

  // ⚠️ 손상 데이터(같은 역할 2건)에서 흐름을 **잃지 않는다** — 버리면 그만큼 가짜 손익이 된다.
  const dup = intFlowNetted([{ deps: [], wds: [r.srcWithdrawal, { ...r.srcWithdrawal, id: 'dup' }] }, B], D);
  ok('#39 같은 역할 2건이면 상쇄를 포기하고 흐름을 보존한다', Math.abs(dup.out - 2 * M) < 1e-6 && Math.abs(dup.in - M) < 1e-6);

  // 원가 보정 행(금액 0)은 애초에 흐름 기여가 0이라 상쇄 대상이 아니다.
  const gainOnly = intFlowNetted([{ deps: [], wds: r.tgtGainRow ? [r.tgtGainRow] : [] }], D);
  ok('#40 원가 보정 행은 유입·유출 모두 0', gainOnly.in === 0 && gainOnly.out === 0);
}

{
  const intg = read('src/hooks/useIntegratedData.ts');
  ok('#41 ①-c 이관 쌍 상쇄가 실제로 배선돼 있다',
    /const xferPend = new Map\(\);/.test(intg) &&
    /if \(holdTransfer\(d, 'in', d\.date, v\)\) return;/.test(intg) &&
    /if \(holdTransfer\(w, 'out', w\.date, v\)\) return;/.test(intg));
  ok('#41b 같은 날짜일 때만 상쇄한다',
    /if \(!rec\.bad && rec\.in && rec\.out && rec\.in\.date === rec\.out\.date\) return;/.test(intg));
  // ⚠️ flowAtRow는 기록 없는 날의 흐름을 다음 기록일로 이월한다 — 상쇄가 그보다 뒤에 오면
  //    이미 이월된 값이 남아 상쇄가 무의미해진다.
  // ⚠️ indexOf **위치만** 재면 죽은 단언이 된다 — `if (0) xferPend.forEach(…)` 처럼 무력화해도
  //    문자열 위치는 그대로라 통과한다(변이 M5b로 실증). 문장이 **조건 없이** 서 있는지도 함께 본다.
  ok('#41c 상쇄가 조건 없이, flowAtRow(이월) 구성보다 앞에서 실행된다',
    /\n    xferPend\.forEach\(rec => \{/.test(intg) &&
    intg.indexOf('xferPend.forEach') < intg.indexOf('const flowAtRow = new Map();'));
  // ⚠️ 계좌 편입/이탈(③)은 상쇄 대상이 **아니다** — 빼면 편입일 평가액 전액이 가짜 수익,
  //    삭제일 평가액 전액이 가짜 손실이 된다(그건 통합 자산의 실제 증감이다).
  ok('#41d 계좌 편입/이탈 흐름은 그대로 남아 있다',
    /const d0 = dates\.find\(d => \(map\.get\(d\) \|\| 0\) > 0\)/.test(intg) && /addIn\(d0, map\.get\(d0\) \|\| 0\);/.test(intg));
  // ⚠️ 개별 계좌 뷰는 **무변경** — 그 계좌 기준으로는 자산이 실제로 나갔다.
  const u = read('src/utils.ts');
  const efr = u.slice(u.indexOf('export const externalFlowInRange'), u.indexOf('export const dailyFlowAdjustedRate'));
  ok('#41e 개별 계좌 흐름(externalFlowInRange)에는 이관 예외가 없다', efr.length > 200 && !/transfer/.test(efr));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:transfer — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
