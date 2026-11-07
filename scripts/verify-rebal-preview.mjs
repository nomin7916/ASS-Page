#!/usr/bin/env node
// 리밸런싱 표 입력 중 미리보기 말풍선 검증.   실행: npm run verify:rebal-preview
//
// 발단(사용자 요청 2026-11-07): 목표금액·목표비중을 입력하고 Enter를 쳐야 표 오른쪽 끝(예상비중 등)이 바뀌었다.
//   → 타이핑을 멈추고 0.3초 뒤 칸 아래 말풍선으로 수량·실 구매비용·예상평가금·예상비중을 먼저 보여준다.
//   말풍선의 실 구매비용은 종목 입장 부호(매수 +, 매도 −) — 표 열(계좌 현금 입장, 매수 −)은 그대로.
//
// 구성 ①  src/rebalPreview.ts 를 **직접 import** — 표(usePortfolioData)와 말풍선이 같은 함수를 부른다.
//        리팩터 전 인라인 식(legacy)과 무작위 대조해 표 값이 1원도 바뀌지 않았음을 확인한다.
// 구성 ②  소스 텍스트 가드 — 배선(어느 칸이 언제 부르는가)은 산술로 표현할 수 없다. 사용부와 import를 함께 단언한다.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
const S = (fn) => { try { return fn(); } catch (e) { return { __threw: String(e && e.message || e) }; } };

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\n── 파트① 순수 함수 (src/rebalPreview.ts 직접 import) ──');

let P = null;
try {
  P = await import(pathToFileURL(join(ROOT, 'src/rebalPreview.ts')).href);
} catch (e) {
  if (e && e.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
    console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  } else {
    fail++;
    console.log(`  ✗ src/rebalPreview.ts 로드 실패 — ${e && (e.code || e.message)}`);
  }
}

if (P) {
  const { rebalCapitalBase: FB, rebalActionQty: AQ, rebalRowOutcome: RO, parseDraftNumber: PD, flowSign: FS, REBAL_PREVIEW_DELAY_MS: DELAY, tradeSideLabel: TS } = P;

  eq('#1 말풍선 대기 = 0.3초 (사용자 확정)', DELAY, 300);

  // ── 화면 실측(사용자 스크린샷 2026-11-07, ISA 계좌) — TIGER 머니마켓액티브 80주 × 104,240원 ──
  // 투자가능금 87,664,934원(= 총평가금, 이번 투자금 0).
  const base = { mode: 'targetAmount', price: 104240, qty: 80, curEval: 8339200, overallExp: 87664934, allocBase: 0, extraQty: 0 };
  const r9m = S(() => RO({ ...base, amount: 9000000 }));
  eq('#2 목표금액 9,000,000 → 수량 +6 · 예상평가금 8,964,640 (표 Enter 뒤와 같음)', [r9m.action, r9m.expEval], [6, 8964640]);
  eq('#3   └ 예상비중 10.2%', r9m.expRatio?.toFixed(1), '10.2');
  eq('#4   └ 말풍선 금액(종목 입장) +625,440 = 표 실 구매비용 −625,440의 반대 부호', [r9m.flow, -r9m.flow], [625440, -625440]);
  const r400k = S(() => RO({ ...base, amount: 400000 }));
  eq('#5 목표금액 400,000 → 수량 −76 · 예상평가금 416,960 · 예상비중 0.5%', [r400k.action, r400k.expEval, r400k.expRatio?.toFixed(1)], [-76, 416960, '0.5']);
  eq('#6   └ 말풍선 금액 −7,922,240 (표는 ₩7,922,240)', r400k.flow, -7922240);

  // ── 모드별 수량 ──
  eq('#7 리밸런싱 10% → trunc((총액×10% − 평가금) ÷ 가격) = 4', S(() => RO({ ...base, mode: 'rebalance', ratio: 10 }).action), 4);
  eq('#8 적립식 → trunc(배분액 × 비중 ÷ 가격)', S(() => RO({ ...base, mode: 'accumulate', allocBase: 1000000, ratio: 50 }).action), 4);
  eq('#9 레거시 deposit-only는 적립식 식', S(() => RO({ ...base, mode: 'deposit-only', allocBase: 1000000, ratio: 50 }).action), 4);
  eq('#10 비-금액 모드는 목표금액을 무시', S(() => RO({ ...base, mode: 'rebalance', ratio: 10, amount: 1 }).action), 4);
  eq('#11 가격 0(기준가 미로드) → 수량 0 · NaN 없음', S(() => { const o = RO({ ...base, price: 0, amount: 9000000 }); return [o.action, o.expEval, o.flow, Number.isFinite(o.expRatio)]; }), [0, 0, 0, true]);
  eq('#12 총액 0 → 예상비중 0 (0으로 나누기 없음)', S(() => RO({ ...base, overallExp: 0, amount: 9000000 }).expRatio), 0);

  // ── '추가' 수량은 표처럼 포함 ──
  const rx = S(() => RO({ ...base, amount: 9000000, extraQty: 2 }));
  eq('#13 추가 +2 → 수량 합 8 · 평가금 (80+8)×가격 · 금액 흐름 8×가격 · cost는 action만', [rx.totalAction, rx.expEval, rx.flow, rx.cost], [8, 88 * 104240, 8 * 104240, 6 * 104240]);

  // ── 자금 축 ──
  eq('#14 국내: overallExp = 총평가금 + 투자금 · allocBase = 투자금 + 예수금', S(() => FB({ totalEval: 1000, fx: 1, amount: 100, depositAmount: 50, useDepositAmount: null })), { overallExp: 1100, allocBase: 150 });
  eq('#15 사용예수금은 0~예수금으로 묶인다', S(() => [FB({ totalEval: 0, amount: 0, depositAmount: 50, useDepositAmount: 80 }).allocBase, FB({ totalEval: 0, amount: 0, depositAmount: 50, useDepositAmount: -5 }).allocBase]), [50, 0]);
  eq('#16 해외: 총평가금(원화 프레임) ÷ 환율', S(() => FB({ totalEval: 1300000, fx: 1300, amount: 10, depositAmount: 0 }).overallExp), 1010);

  // ── 리팩터 전 인라인 식(usePortfolioData, 2026-11-07 이전)과 무작위 대조 — 표 값 불변 확인 ──
  const legacy = (mode, price, qty, curEval, overallExp, allocBase, tRatio, effAmt, extra) => {
    const isAmountMode = mode === 'targetAmount';
    const action = price > 0
      ? (isAmountMode
        ? Math.trunc((effAmt - curEval) / price)
        : (mode === 'rebalance' ? Math.trunc(((overallExp * tRatio) - curEval) / price) : Math.trunc((allocBase * tRatio) / price)))
      : 0;
    const expEval = (qty + action + extra) * price;
    return { action, cost: action * price, expEval, expRatio: overallExp > 0 ? (expEval / overallExp * 100) : 0 };
  };
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let mismatch = 0;
  const modes = ['rebalance', 'accumulate', 'targetAmount', 'deposit-only'];
  for (let i = 0; i < 5000; i++) {
    const mode = modes[i % 4];
    const price = rnd() < 0.05 ? 0 : Math.round(rnd() * 200000 * 100) / 100;
    const qty = Math.floor(rnd() * 3000);
    const curEval = price * qty;
    const overallExp = rnd() < 0.02 ? 0 : rnd() * 3e8;
    const allocBase = rnd() * 5e7;
    const ratio = Math.round(rnd() * 4000) / 100;
    const amt = rnd() * 5e7;
    const extra = Math.floor(rnd() * 21) - 10;
    const a = legacy(mode, price, qty, curEval, overallExp, allocBase, ratio / 100, amt, extra);
    const b = RO({ mode, price, qty, curEval, overallExp, allocBase, extraQty: extra, ratio, amount: amt });
    if (!Object.is(a.action, b.action) || a.cost !== b.cost || a.expEval !== b.expEval || a.expRatio !== b.expRatio) mismatch++;
  }
  eq('#17 무작위 5,000건 — 리팩터 전 식과 수량·비용·예상평가금·예상비중 전부 일치', mismatch, 0);
  eq('#18 rebalActionQty == rebalRowOutcome.action', S(() => AQ({ mode: 'targetAmount', price: 104240, curEval: 8339200, targetAmount: 9000000 })), 6);

  // ── 입력 초안 파싱 ──
  eq('#19 빈 칸·점·글자만 → null(비움)', S(() => [PD(''), PD('.'), PD('  '), PD(null), PD(undefined), PD('abc')]), [null, null, null, null, null, null]);
  eq('#20 콤마·공백 섞여도 숫자', S(() => [PD('9,000,000'), PD(' 12.5 '), PD('9000000')]), [9000000, 12.5, 9000000]);

  // ── 말풍선 부호 ──
  eq('#21 종목 입장 부호: 매수 + · 매도 − · 0은 없음', S(() => [FS(625440), FS(-7922240), FS(0)]), ['+', '-', '']);
  eq('#22 칸 이름 꼬리: + 매수 · − 매도 · 0 없음 (수량(매수) / 실 구매비용(매도))', S(() => [TS(6), TS(-76), TS(0), TS(625440), TS(-7922240)]), ['매수', '매도', '', '매수', '매도']);
  eq('#23 스크린샷 값: 4,000,000 → 수량 −41(매도) · −₩4,273,840(매도)', S(() => { const o = RO({ ...base, amount: 4000000 }); return [o.totalAction, TS(o.totalAction), o.flow, TS(o.flow)]; }), [-41, '매도', -4273840, '매도']);
}

console.log('\n── 파트② 소스 가드 ──');

const prevRaw = read('src/rebalPreview.ts');
const pd = stripComments(read('src/hooks/usePortfolioData.ts'));
const rp = stripComments(read('src/components/RebalancingPanel.tsx'));
const bubble = stripComments(read('src/components/RebalPreviewBubble.tsx'));
const pkg = JSON.parse(read('package.json'));

ok('#G1 rebalPreview.ts는 import 0 (verify가 직접 import)', !/^\s*import\s/m.test(prevRaw));
ok('#G2 표 계산(usePortfolioData)이 같은 함수를 import해 부른다',
  /import \{[^}]*\brebalCapitalBase\b[^}]*\brebalRowOutcome\b[^}]*\} from '\.\.\/rebalPreview';/.test(pd)
  && /const \{ overallExp, allocBase \} = rebalCapitalBase\(\{/.test(pd)
  && /const \{ action, cost, expEval, expRatio \} = rebalRowOutcome\(\{/.test(pd));
ok('#G2b 표 계산에 옛 인라인 수량식이 남아 있지 않다(두 식이 갈라지면 말풍선 ≠ 표)',
  !/Math\.trunc\(\(effectiveTargetAmount - curEval\) \/ price\)/.test(pd) && !/Math\.trunc\(\(allocBase \* tRatio\) \/ price\)/.test(pd));
ok('#G3 패널이 rebalPreview 다섯 이름과 말풍선 컴포넌트를 import한다',
  /import \{[^}]*\brebalCapitalBase\b[^}]*\brebalRowOutcome\b[^}]*\bparseDraftNumber\b[^}]*\bflowSign\b[^}]*\bREBAL_PREVIEW_DELAY_MS\b[^}]*\} from '\.\.\/rebalPreview';/.test(rp)
  && /import RebalPreviewBubble from '\.\/RebalPreviewBubble';/.test(rp));
ok('#G4 0.3초 대기는 상수로 — setTimeout(…, REBAL_PREVIEW_DELAY_MS)',
  /setTimeout\(\(\) => setDraftPreview\(\{ id, col, raw, anchor \}\), REBAL_PREVIEW_DELAY_MS\)/.test(rp));
ok('#G5 목표금액 칸 onChange가 말풍선을 예약한다',
  /setEditingTargetAmount\(prev => \(\{ \.\.\.prev, \[item\.id\]: raw \}\)\);\s*scheduleDraftPreview\(item\.id, 'targetAmount', raw, e\.currentTarget\);/.test(rp));
ok('#G6 목표비중 칸 onChange가 말풍선을 예약한다(예적금·현금 행 제외)',
  /setEditingRatio\(prev => \(\{ \.\.\.prev, \[item\.id\]: e\.target\.value \}\)\);\s*if \(!isSavings\) scheduleDraftPreview\(item\.id, 'targetRatio', e\.target\.value, e\.currentTarget\);/.test(rp));
ok('#G7 두 칸 모두 blur(=Enter)에서 말풍선을 닫는다',
  (rp.match(/onBlur=\{e => \{\s*clearDraftPreview\(\);/g) || []).length === 2);
ok('#G8 말풍선 금액은 flowSign(종목 입장) — 표 열은 계좌 입장(displayAdjustedCost = -adjustedCost) 그대로',
  /const flowText = `\$\{flowSign\(out\.flow\)\}\$\{money\(Math\.abs\(out\.flow\)\)\}`;/.test(rp)
  && /const displayAdjustedCost = -adjustedCost;/.test(rp));
ok('#G9 말풍선 값은 rebalCapitalBase + rebalRowOutcome로 계산한다(패널에서 식 재작성 금지)',
  /const renderDraftPreview = \(\) => \{[\s\S]*?rebalCapitalBase\(\{[\s\S]*?rebalRowOutcome\(\{[\s\S]*?<RebalPreviewBubble anchor=\{draftPreview\.anchor\}>/.test(rp)
  && /\{renderDraftPreview\(\)\}/.test(rp));
ok('#G10 말풍선은 body 포털 + 클릭 통과',
  /import \{ createPortal \} from 'react-dom';/.test(bubble) && /createPortal\(/.test(bubble) && /pointer-events-none/.test(bubble) && /document\.body/.test(bubble));
ok('#G11 말풍선이 떠 있는 칸은 기본 title 풍선을 끈다(두 풍선 겹침 방지)',
  /title=\{draftPreview\?\.id === item\.id && draftPreview\.col === 'targetAmount' \? undefined :/.test(rp)
  && /title=\{draftPreview\?\.id === item\.id && draftPreview\.col === 'targetRatio' \? undefined :/.test(rp));
ok('#G13 수량·실 구매비용 칸 이름에 (매수)/(매도) — tradeSideLabel import + 두 칸 사용',
  /import \{[^}]*\btradeSideLabel\b[^}]*\} from '\.\.\/rebalPreview';/.test(rp)
  && /const side = tradeSideLabel\(n\);/.test(rp)
  && /수량\{sideTag\(out\.totalAction\)\}/.test(rp)
  && /실 구매비용\{sideTag\(out\.flow\)\}/.test(rp));
ok('#G12 package.json에 verify:rebal-preview 등록', pkg.scripts['verify:rebal-preview'] === 'node scripts/verify-rebal-preview.mjs');

console.log(`\n  총 ${pass + fail}건 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
