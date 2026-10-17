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
// 가짜 대표 종목 행(rateAssets.buildRateAssetRow 결과의 필요한 필드만)
const a = (o = {}) => ({ price: 20, yield12: null, yieldPost: null, drawdown52: null, pb: null, pnav: null, manualSet: false, ...o });

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
  ok('#12b 장부가 수동값이 없으면 ④는 표시하되 n/m에서 뺀다', mr0.conditions.some(c => c.pending && c.label === 'AGNC 주가 ÷ 장부가 0.9 이하' && c.met === false && c.detail === 'AGNC 주당 장부가 입력 필요'));

  // 실물 리츠 — ③ O 배당률(6단계)
  const O = (y) => ({ O: a({ yield12: y }) });
  eq('#13 실물 리츠 대기', st(evalEquityReit({ us10y: m({ pct3y: 50, turnedDown: true }) }, O(7))), ['wait', '2/3']);
  eq('#14 실물 리츠 관심 — ①', st(evalEquityReit({ us10y: m({ pct3y: 72 }) }, O(5))), ['watch', '1/3']);
  eq('#15 실물 리츠 적기 — ①②③', st(evalEquityReit({ us10y: m({ pct3y: 72, turnedDown: true }) }, O(6.2))), ['buy', '3/3']);
  eq('#15b 실물 리츠 — ①②여도 O 배당률 6.0% 미만이면 관심', st(evalEquityReit({ us10y: m({ pct3y: 72, turnedDown: true }) }, O(5.9))), ['watch', '2/3']);
  eq('#15c 실물 리츠 경계 — O 배당률 정확히 6.0%도 충족', evalEquityReit({ us10y: m({ pct3y: 72, turnedDown: true }) }, O(6.0)).state, 'buy');
  ok('#15d O 배당률 자료가 없으면 ③ 불충족(자료 없음)', evalEquityReit({ us10y: m({ pct3y: 72, turnedDown: true }) }).conditions[2].detail === '자료 없음');

  // BDC — ③ MAIN 가격(52주 최고 대비 −15% 이하 또는 주가÷순자산 1.5 이하)까지 맞으면 적기
  const BD = { fedRate: m({ pct3y: 60 }), hySpread: m({ change1m: 0.2, pct3y: 50 }) };
  eq('#16 BDC 대기', st(evalBdc({ fedRate: m({ pct3y: 40 }), hySpread: m({ change1m: 0.2, pct3y: 50 }) })), ['wait', '1/3']);
  eq('#17 BDC 관심 — ①②', st(evalBdc(BD, { MAIN: a({ drawdown52: -5 }) })), ['watch', '2/3']);
  eq('#17b BDC 적기 — ①② + MAIN 52주 최고 대비 −16%', st(evalBdc(BD, { MAIN: a({ drawdown52: -16 }) })), ['buy', '3/3']);
  eq('#17c BDC 적기 — ①② + 순자산 배율 1.4(하락 −5%여도)', st(evalBdc(BD, { MAIN: a({ drawdown52: -5, pnav: 1.4, manualSet: true }) })), ['buy', '3/3']);
  ok('#17d 순자산 수동값이 없으면 근거에 입력 필요', /순자산 입력 필요/.test(evalBdc(BD, { MAIN: a({ drawdown52: -5 }) }).conditions[2].detail));
  eq('#18 BDC — 스프레드가 3년 70 이상이면 ② 불충족', st(evalBdc({ fedRate: m({ pct3y: 90 }), hySpread: m({ change1m: 0, pct3y: 75 }) }, { MAIN: a({ drawdown52: -20 }) })), ['wait', '2/3']);
  ok('#18b BDC 설명 한 줄(채권과 반대)', /채권과 반대/.test(evalBdc({}).note || ''));

  // 모기지 리츠 ④ AGNC 주가÷장부가(6단계)
  const MR = { t10y2y: m({ current: -0.2 }), mbsSpread: m({ pct3y: 70 }), move: m({ turnedDown: true }) };
  eq('#22 모기지 리츠 적기 — ①②③ + 장부가 배율 0.85', st(evalMortgageReit(MR, { AGNC: a({ pb: 0.85, manualSet: true }) })), ['buy', '4/4']);
  eq('#23 모기지 리츠 — 장부가 배율 0.95면 관심', st(evalMortgageReit(MR, { AGNC: a({ pb: 0.95, manualSet: true }) })), ['watch', '3/4']);
  const hot = evalMortgageReit(MR, { AGNC: a({ pb: 1.15, manualSet: true }) });
  ok('#24 장부가 배율 1.1 이상이면 유상증자 위험 경고', /유상증자 위험/.test(hot.warning || '') && hot.state === 'watch');
  eq('#25 장부가 수동값이 없으면 ④를 빼고 ①②③만으로 적기', st(evalMortgageReit(MR, { AGNC: a({ pb: null }) })), ['buy', '3/3']);

  // 지금 투자 시 수익률 — 대표 종목 배당률
  const yl = (r) => r.yields.map(y => [y.label, y.pre, +y.post.toFixed(3)]);
  eq('#26 하이일드 = 하이일드 금리 + HYG 배당률', yl(evalHighYield({ hySpread: m(), hyYield: m({ current: 7 }) }, { HYG: a({ yield12: 5.6 }) })), [['하이일드 금리', 7, 5.95], ['HYG 배당률', 5.6, 4.76]]);
  eq('#27 모기지·실물·BDC = AGNC·O·MAIN 배당률', [
    yl(evalMortgageReit({}, { AGNC: a({ yield12: 14 }) })), yl(evalEquityReit({}, { O: a({ yield12: 5.4 }) })), yl(evalBdc({}, { MAIN: a({ yield12: 7 }) })),
  ], [[['AGNC 배당률', 14, 11.9]], [['O 배당률', 5.4, 4.59]], [['MAIN 배당률', 7, 5.95]]]);
  eq('#27b 대표 종목 자료가 없으면 수익률 칸은 비운다', evalEquityReit({}).yields, []);

  console.log('\n── 파트② 공통 규칙 ──');
  const none = evaluateRateSignals({});
  eq('#19 자료가 없으면 전부 대기(충족으로 치지 않는다)', none.map(r => r.state), ['wait', 'wait', 'wait', 'wait', 'wait']);
  ok('#19b 자료 없음은 근거에 그대로 드러낸다', none.some(r => /자료 없음/.test(r.rationale)));
  const sorted = evaluateRateSignals({ us10y: m({ pct3y: 72, turnedDown: true }), fedRate: m({ pct3y: 60 }), hySpread: m({ change1m: 0, pct3y: 50 }) });
  eq('#20 충족 비율 내림차순(같으면 정의 순서)', sorted.map(r => r.key), ['longBond', 'equityReit', 'bdc', 'highYield', 'mortgageReit']);
  ok('#20b 대표 종목 행을 넘기면 판정에 반영된다', evaluateRateSignals({ us10y: m({ pct3y: 72, turnedDown: true }) }, { O: a({ yield12: 6.5 }) }).find(r => r.key === 'equityReit').state === 'buy');
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
  ok('#G3 창은 판정을 rateSignals에서만 가져온다', /from '\.\.\/rateSignals'/.test(RW) && /evaluateRateSignals\(metrics, assetRows\)/.test(RW));
  ok('#G4 지시형 문구 없음(주석 제외)', !/사세요|매수하세요|파세요/.test(code + RW.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')));
  ok('#G6 새 기준치도 RATE_RULES에 있다', /pbMax: 0\.9, pbWarn: 1\.1/.test(RS) && /oYieldMin: 6\.0/.test(RS) && /mainDrawdownMax: -15, mainPnavMax: 1\.5/.test(RS));
  ok('#G7 6단계 자리표시 문구가 남지 않았다', !/6단계에서 추가/.test(RS));
  ok('#G5 행을 누르면 조건 목록을 펼친다', /setOpenSignal\(/.test(RW) && /c\.pending \? '…' : c\.met \? '○' : '×'/.test(RW));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:rate-signals — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
