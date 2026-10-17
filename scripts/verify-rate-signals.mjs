#!/usr/bin/env node
// 금리 모니터링 ③ '지금 적정 자산' 판정 검증 — src/rateSignals.ts 를 **직접 import**한다(미러 금지, 2026-10 5단계).
//   자산군 5종 × 가짜 입력 3종(대기 · 매수 관심 · 매수 적기) + 경고 · 안내 · n/m(6단계 조건 제외) · 정렬 · 세후 수익률
// ⚠️ 이 모듈은 import 0건이라 Node가 타입만 벗겨 실행한다. 런타임이 .ts를 못 읽으면 명시적으로 건너뛴다.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

let S = null;
try { S = await import(pathToFileURL(join(ROOT, 'src/rateSignals.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 판정 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/rateSignals.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

// 가짜 지표 — 지정하지 않은 값은 '아무 조건도 못 맞추는' 쪽으로 둔다
const m = (o = {}) => ({ current: 1, change1m: 0, high52: 9, position52: 10, pct3y: 10, turnedDown: false, ...o });

if (S) {
  const { evalLongBond, evalHighYield, evalMortgageReit, evalEquityReit, evalBdc, evaluateRateSignals, RATE_RULES } = S;
  const st = (r) => [r.state, `${r.met}/${r.total}`];
  console.log('\n── 파트① 자산군별 판정 ──');

  // 미국 장기채
  eq('#1 장기채 대기 — 조건 0개', st(evalLongBond({ us10y: m({ current: 4 }), us30y: m({ current: 4.3 }) })), ['wait', '0/3']);
  eq('#2 장기채 관심 — ①② (30년만 높아도 된다)', st(evalLongBond({ us10y: m({ current: 4 }), us30y: m({ current: 4.8, high52: 5.0, pct3y: 80 }) })), ['watch', '2/3']);
  eq('#3 장기채 적기 — ①②③', st(evalLongBond({ us10y: m({ current: 4.6, high52: 4.8, pct3y: 75, turnedDown: true }), us30y: m() })), ['buy', '3/3']);
  eq('#3b 장기채 — ①③만이면 대기(②가 빠짐)', evalLongBond({ us10y: m({ current: 4.0, high52: 4.8, pct3y: 75, turnedDown: true }) }).state, 'wait');
  const lb = evalLongBond({ us10y: m({ current: 4 }), us30y: m({ current: 5 }) });
  eq('#4 장기채 수익률 — 10년·30년 세전, 세후 = ×(1−15%)', lb.yields.map(y => [y.label, y.pre, +y.post.toFixed(4)]), [['10년', 4, 3.4], ['30년', 5, 4.25]]);

  // 하이일드
  eq('#5 하이일드 대기', st(evalHighYield({ hySpread: m(), hyYield: m() })), ['wait', '0/3']);
  eq('#6 하이일드 관심 — ①②', st(evalHighYield({ hySpread: m({ position52: 80 }), hyYield: m({ position52: 75 }) })), ['watch', '2/3']);
  eq('#7 하이일드 적기 — ①②③', st(evalHighYield({ hySpread: m({ position52: 80, turnedDown: true }), hyYield: m({ position52: 75, current: 7.5 }) })), ['buy', '3/3']);
  const crisis = evalHighYield({ hySpread: m({ position52: 90, turnedDown: true, change1m: 1.2 }), hyYield: m({ position52: 90 }) });
  eq('#8 하이일드 경고 — 스프레드 1개월 +1.0%p 이상이면 조건이 다 맞아도 대기', [crisis.state, crisis.warning], ['wait', '신용 불안 진행 중']);
  eq('#8b 하이일드 경고 경계 — 정확히 +1.0%p도 경고', evalHighYield({ hySpread: m({ change1m: 1.0 }), hyYield: m() }).warning, '신용 불안 진행 중');
  eq('#8c 하이일드 수익률 = 하이일드 금리', evalHighYield({ hySpread: m(), hyYield: m({ current: 7 }) }).yields.map(y => [y.pre, +y.post.toFixed(2)]), [[7, 5.95]]);

  // 모기지 리츠
  const mr0 = evalMortgageReit({ t10y2y: m({ current: 0.5, pct3y: 60 }), mbsSpread: m(), move: m() });
  eq('#9 모기지 리츠 대기 — 6단계 조건은 n/m에서 뺀다', [...st(mr0), mr0.conditions.length], ['wait', '0/3', 4]);
  eq('#10 모기지 리츠 관심 — 역전(음수)도 ①', st(evalMortgageReit({ t10y2y: m({ current: -0.3, pct3y: 60 }), mbsSpread: m({ pct3y: 65 }), move: m() })), ['watch', '2/3']);
  eq('#11 모기지 리츠 적기 — ①②③', st(evalMortgageReit({ t10y2y: m({ current: 0.4, pct3y: 20 }), mbsSpread: m({ pct3y: 70 }), move: m({ turnedDown: true }) })), ['buy', '3/3']);
  const mrOnly = evalMortgageReit({ t10y2y: m({ current: -0.5 }), mbsSpread: m(), move: m() });
  eq('#12 모기지 리츠 ①만 — 배당 삭감 안내', [mrOnly.state, mrOnly.note], ['wait', '역전 구간 — 배당 삭감 위험 함께 점검']);
  ok('#12b 6단계 조건은 표시하되 충족으로 치지 않는다', mr0.conditions.some(c => c.pending && c.label === '주가 ÷ 장부가' && c.met === false && c.detail === '6단계에서 추가'));

  // 실물 리츠
  eq('#13 실물 리츠 대기', st(evalEquityReit({ us10y: m({ pct3y: 50, turnedDown: true }) })), ['wait', '1/2']);
  eq('#14 실물 리츠 관심 — ①', st(evalEquityReit({ us10y: m({ pct3y: 72 }) })), ['watch', '1/2']);
  eq('#15 실물 리츠 적기 — ①②', st(evalEquityReit({ us10y: m({ pct3y: 72, turnedDown: true }) })), ['buy', '2/2']);
  ok('#15b 실물 리츠 6단계 조건 표시', evalEquityReit({}).conditions.some(c => c.pending && c.label === '리얼티인컴 배당률 6%'));

  // BDC — 최고 단계는 '매수 관심'
  eq('#16 BDC 대기', st(evalBdc({ fedRate: m({ pct3y: 40 }), hySpread: m({ change1m: 0.2, pct3y: 50 }) })), ['wait', '1/2']);
  eq('#17 BDC 관심 — ①②', st(evalBdc({ fedRate: m({ pct3y: 60 }), hySpread: m({ change1m: 0.2, pct3y: 50 }) })), ['watch', '2/2']);
  eq('#18 BDC — 스프레드가 3년 70 이상이면 ② 불충족(적기 단계 없음)', st(evalBdc({ fedRate: m({ pct3y: 90 }), hySpread: m({ change1m: 0, pct3y: 75 }) })), ['wait', '1/2']);
  ok('#18b BDC 설명 한 줄(채권과 반대)', /채권과 반대/.test(evalBdc({}).note || ''));

  console.log('\n── 파트② 공통 규칙 ──');
  const none = evaluateRateSignals({});
  eq('#19 자료가 없으면 전부 대기(충족으로 치지 않는다)', none.map(r => r.state), ['wait', 'wait', 'wait', 'wait', 'wait']);
  ok('#19b 자료 없음은 근거에 그대로 드러낸다', none.some(r => /자료 없음/.test(r.rationale)));
  const sorted = evaluateRateSignals({ us10y: m({ pct3y: 72, turnedDown: true }), fedRate: m({ pct3y: 60 }), hySpread: m({ change1m: 0, pct3y: 50 }) });
  eq('#20 충족 비율 내림차순(같으면 정의 순서)', sorted.map(r => r.key), ['equityReit', 'bdc', 'longBond', 'highYield', 'mortgageReit']);
  ok('#21 원천징수율 15%', RATE_RULES.withholdingPct === 15);
}

console.log('\n── 파트③ 배선 가드 ──');
{
  const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const RS = src('src/rateSignals.ts');
  const RW = src('src/components/RateWindow.tsx');
  const code = RS.replace(/\/\/.*$/gm, '');
  ok('#G1 순수 모듈은 import 0건', !/^\s*import\s/m.test(RS));
  ok('#G2 문턱값은 RATE_RULES 한 곳 — 판정 함수가 RATE_RULES를 읽는다', /export const RATE_RULES = \{/.test(RS) && (code.match(/= RATE_RULES\.\w+;/g) || []).length === 5);
  ok('#G3 창은 판정을 rateSignals에서만 가져온다', /from '\.\.\/rateSignals'/.test(RW) && /evaluateRateSignals\(metrics\)/.test(RW));
  ok('#G4 지시형 문구 없음(주석 제외)', !/사세요|매수하세요|파세요/.test(code + RW.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')));
  ok('#G5 행을 누르면 조건 목록을 펼친다', /setOpenSignal\(/.test(RW) && /c\.pending \? '…' : c\.met \? '○' : '×'/.test(RW));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:rate-signals — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
