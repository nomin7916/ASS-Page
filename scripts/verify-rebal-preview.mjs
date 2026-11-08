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
  const { rebalCapitalBase: FB, rebalActionQty: AQ, rebalRowOutcome: RO, parseDraftNumber: PD, REBAL_PREVIEW_DELAY_MS: DELAY, tradeSideLabel: TS, minRatioForOneShare: MR } = P;

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

  // ── 말풍선 매매 방향(칸 이름) — 값은 부호 없이 크기만 ──
  eq('#22 방향: + 매수 · − 매도 · 0 없음 (수량(매수) / 매도금액)', S(() => [TS(6), TS(-76), TS(0), TS(625440), TS(-7922240)]), ['매수', '매도', '', '매수', '매도']);
  eq('#23 스크린샷 값: 4,000,000 → 수량(매도) 41 · 매도금액 ₩4,273,840', S(() => { const o = RO({ ...base, amount: 4000000 }); return [TS(o.totalAction), Math.abs(o.totalAction), Math.abs(o.flow)]; }), ['매도', 41, 4273840]);

  // ── 적립식 1주 최소 비중 (사용자 스크린샷 2026-11-08: 적립금 500,000 + 사용할 예수금 8,514, 104,240원 종목 10% → 0주) ──
  const acc = { mode: 'accumulate', price: 104240, qty: 80, curEval: 8339200, overallExp: 0, extraQty: 0 };
  eq('#24 스크린샷: 투자가능금 508,514 · 10% → 0주', S(() => RO({ ...acc, allocBase: 508514, ratio: 10 }).action), 0);
  const m1 = S(() => MR({ price: 104240, allocBase: 508514 }));
  eq('#25   └ 1주 최소 비중 20.50% (104,240 ÷ 508,514 = 20.4986%, 둘째 자리 올림)', m1, 20.5);
  eq('#26   └ 20.50%면 실제 수량식으로 1주 · 20.49%면 0주', S(() => [RO({ ...acc, allocBase: 508514, ratio: m1 }).action, RO({ ...acc, allocBase: 508514, ratio: 20.49 }).action]), [1, 0]);
  eq('#27 사용할 예수금 0(적립금 500,000만) → 20.85% (20.84%는 0주)', S(() => { const r = MR({ price: 104240, allocBase: 500000 }); return [r, RO({ ...acc, allocBase: 500000, ratio: r }).action, RO({ ...acc, allocBase: 500000, ratio: 20.84 }).action]; }), [20.85, 1, 0]);
  eq('#28 나누어떨어지는 경계: 100,000 ÷ 500,000 = 20.00% (20.01%로 부풀지 않음)', S(() => MR({ price: 100000, allocBase: 500000 })), 20);
  eq('#29 배분액보다 비싼 종목 → 100% 초과 그대로(배분액 전부로도 못 삼)', S(() => MR({ price: 600000, allocBase: 500000 })), 120);
  eq('#30 가격·배분액 없음 → null', S(() => [MR({ price: 0, allocBase: 500000 }), MR({ price: 104240, allocBase: 0 })]), [null, null]);
  let bad = 0;
  for (let i = 0; i < 3000; i++) {
    const price = Math.round(rnd() * 300000 * 100) / 100 + 1;
    const allocBase = Math.round(rnd() * 3e6) + 1;
    const r = MR({ price, allocBase });
    const one = RO({ ...acc, price, allocBase, ratio: r }).action;
    const less = RO({ ...acc, price, allocBase, ratio: Math.round((r - 0.01) * 100) / 100 }).action;
    if (one < 1 || (r > 0.01 && less >= 1)) bad++;
  }
  eq('#31 무작위 3,000건 — 최소 비중이면 1주 이상, 0.01%p 낮추면 0주', bad, 0);
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
ok('#G3 패널이 rebalPreview 여섯 이름과 말풍선 컴포넌트를 import한다',
  ['rebalCapitalBase', 'rebalRowOutcome', 'parseDraftNumber', 'REBAL_PREVIEW_DELAY_MS', 'tradeSideLabel', 'minRatioForOneShare']
    .every(n => new RegExp(`import \\{[^}]*\\b${n}\\b[^}]*\\} from '\\.\\./rebalPreview';`).test(rp))
  && /import RebalPreviewBubble from '\.\/RebalPreviewBubble';/.test(rp));
ok('#G4 0.3초 대기는 상수로 — setTimeout(…, REBAL_PREVIEW_DELAY_MS)',
  /setTimeout\(\(\) => setDraftPreview\(\{ id, col, raw, anchor \}\), REBAL_PREVIEW_DELAY_MS\)/.test(rp));
ok('#G5 목표금액 칸 onChange가 말풍선을 예약한다',
  /setEditingTargetAmount\(prev => \(\{ \.\.\.prev, \[item\.id\]: raw \}\)\);\s*scheduleDraftPreview\(item\.id, 'targetAmount', raw, e\.currentTarget\);/.test(rp));
ok('#G6 목표비중 칸 onChange가 말풍선을 예약한다(예적금·현금 행 제외)',
  /setEditingRatio\(prev => \(\{ \.\.\.prev, \[item\.id\]: e\.target\.value \}\)\);\s*if \(!isSavings\) scheduleDraftPreview\(item\.id, 'targetRatio', e\.target\.value, e\.currentTarget\);/.test(rp));
ok('#G7 두 칸 모두 blur(=Enter)에서 말풍선을 닫는다',
  (rp.match(/onBlur=\{e => \{\s*clearDraftPreview\(\);/g) || []).length === 2);
ok('#G8 말풍선은 매수금액/매도금액 + 부호 없는 금액 — \'실 구매비용\' 글자 없음 · 표 열(displayAdjustedCost = -adjustedCost)은 그대로',
  /\{side\}금액<\/span>/.test(rp)
  && /\{money\(Math\.abs\(out\.flow\)\)\}/.test(rp)
  && (() => { const i = rp.indexOf('const renderDraftPreview = () => {'); const body = i < 0 ? '' : rp.slice(i, rp.indexOf('\n  };', i)); return body.length > 500 && !/실 구매비용/.test(body) && !/Enter로/.test(body); })()
  && /const displayAdjustedCost = -adjustedCost;/.test(rp));
ok('#G9 말풍선 값은 rebalCapitalBase + rebalRowOutcome로 계산한다(패널에서 식 재작성 금지)',
  /const renderDraftPreview = \(\) => \{[\s\S]*?rebalCapitalBase\(\{[\s\S]*?rebalRowOutcome\(\{[\s\S]*?<RebalPreviewBubble anchor=\{draftPreview\.anchor\}>/.test(rp)
  && /\{renderDraftPreview\(\)\}/.test(rp));
ok('#G10 말풍선은 body 포털 + 클릭 통과',
  /import \{ createPortal \} from 'react-dom';/.test(bubble) && /createPortal\(/.test(bubble) && /pointer-events-none/.test(bubble) && /document\.body/.test(bubble));
ok('#G11 말풍선이 떠 있는 칸은 기본 title 풍선을 끈다(두 풍선 겹침 방지)',
  /title=\{draftPreview\?\.id === item\.id && draftPreview\.col === 'targetAmount' \? undefined :/.test(rp)
  && /title=\{draftPreview\?\.id === item\.id && draftPreview\.col === 'targetRatio' \? undefined :/.test(rp));
ok('#G13 수량 칸 이름 수량(매수)/(매도) · 값은 부호 없이 크기만',
  /const side = tradeSideLabel\(out\.totalAction\);/.test(rp)
  && /수량\{side && <span className=\{sideColor\}>\(\{side\}\)<\/span>\}/.test(rp)
  && /\{formatNumber\(Math\.abs\(out\.totalAction\)\)\}/.test(rp));
ok('#G14 적립식(비-레벨 모드)·0주·비중 > 0일 때만 1주 최소 비중 — 배분액(allocBase)은 표와 같은 rebalCapitalBase 값',
  /const minRatio = !isAmt && !isLevelMode && out\.action === 0 && cleanNum\(typed\) > 0\s*\? minRatioForOneShare\(\{ price: cleanNum\(item\.currentPrice\), allocBase \}\)/.test(rp)
  && /1주 최소 비중<\/span>/.test(rp));
ok('#G12 package.json에 verify:rebal-preview 등록', pkg.scripts['verify:rebal-preview'] === 'node scripts/verify-rebal-preview.mjs');

console.log(`\n  총 ${pass + fail}건 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
