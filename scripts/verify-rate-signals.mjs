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
  const { evalLongBond, evalHighYield, evalMortgageReit, evalEquityReit, evalBdc, evalKrBond, evalBrazilBond, evaluateRateSignals, RATE_RULES } = S;
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

  // 한국 채권(비교용) — ① 국고채 10년 3년 백분위 70 이상 → 관심, ①② 꺾임까지 → 적기
  eq('#28 한국 채권 대기', st(evalKrBond({ kr10y: m({ pct3y: 60, turnedDown: true }) })), ['wait', '1/2']);
  eq('#29 한국 채권 관심 — ①', st(evalKrBond({ kr10y: m({ pct3y: 75 }) })), ['watch', '1/2']);
  eq('#30 한국 채권 적기 — ①②', st(evalKrBond({ kr10y: m({ pct3y: 70, turnedDown: true }) })), ['buy', '2/2']);
  eq('#31 한국 채권 수익률 — 3년·10년, 세후 = × (1 − 15.4%)', evalKrBond({ kr3y: m({ current: 3 }), kr10y: m({ current: 3.5 }) }).yields.map(y => [y.label, y.pre, +y.post.toFixed(4)]), [['3년', 3, 2.538], ['10년', 3.5, 2.961]]);
  ok('#32 한국 채권 설명 한 줄', evalKrBond({}).note === '미국 자산과 비교하기 위한 참고 줄입니다' && RATE_RULES.krInterestTaxPct === 15.4);

  // 브라질 국채 — 종합 점수 6점(0~2 대기 · 3~4 관심 · 5~6 적기) + 경고 2종
  const TODAY = '2026-10-16';
  const brGood = { br10y: m({ current: 13.9, pct3y: 80 }), brReal: m({ current: 9.4 }), brExp12: m({ current: 4.5, change1m: 0 }),
    brSelic: m({ current: 15, pct3y: 85 }), brlkrw: m({ current: 250, change1m: -2, position52: 20 }) };
  const exGood = { exp12Change3m: -0.1, selicRose60d: false, notes: [], today: TODAY };
  const brBad = { br10y: m({ current: 11, pct3y: 20 }), brReal: m({ current: 3 }), brExp12: m({ current: 5, change1m: 0.1 }),
    brSelic: m({ current: 10, pct3y: 20 }), brlkrw: m({ current: 280, change1m: 3, position52: 90 }) };
  const exBad = { exp12Change3m: 0.6, selicRose60d: true, notes: [{ date: '2026-09-01', impact: '불리' }], today: TODAY };
  const bs = (all, ex) => { const r = evalBrazilBond(all, ex); return [r.state, `${r.met}/${r.total}`]; };
  eq('#33 브라질 0점 → 대기', bs(brBad, exBad), ['wait', '0/6']);
  eq('#34 브라질 3점(①②③) → 매수 관심', bs({ ...brBad, br10y: brGood.br10y, brReal: brGood.brReal }, { ...exBad, exp12Change3m: 0.2 }), ['watch', '3/6']);
  eq('#35 브라질 6점 → 매수 적기', bs(brGood, exGood), ['buy', '6/6']);
  eq('#35b 브라질 5점(메모 불리 1건) → 매수 적기', bs(brGood, { ...exGood, notes: [{ date: '2026-08-01', impact: '불리' }] }), ['buy', '5/6']);
  eq('#35c 90일보다 오래된 불리 메모는 세지 않는다', bs(brGood, { ...exGood, notes: [{ date: '2026-06-01', impact: '불리' }] }), ['buy', '6/6']);
  eq('#35d Selic이 최근 60일 안에 올랐으면 ④ 불충족', bs(brGood, { ...exGood, selicRose60d: true }), ['buy', '5/6']);
  eq('#35e Selic 인상 여부 자료가 없으면 ④ 불충족(인상 없음으로 단언하지 않는다)', bs(brGood, { ...exGood, selicRose60d: null }), ['buy', '5/6']);
  ok('#36 경고 — 기대물가 1개월 +0.5%p 이상', /기대물가 1개월/.test(evalBrazilBond({ ...brGood, brExp12: m({ current: 5, change1m: 0.6 }) }, exGood).warning || ''));
  ok('#37 경고 — 헤알·원 1개월 −8% 이상 급락', /헤알·원 1개월 -9\.8%/.test(evalBrazilBond({ ...brGood, brlkrw: m({ current: 230, change1m: -25, position52: 20 }) }, exGood).warning || ''));
  ok('#37b 평소에는 경고 없음', evalBrazilBond(brGood, exGood).warning === null);
  const by = evalBrazilBond(brGood, exGood);
  eq('#38 수익률 — 명목(10년)·실질, 세후는 만들지 않는다', by.yields.map(y => [y.label, y.pre, y.post]), [['명목(10년)', 13.9, null], ['실질', 9.4, null]]);
  ok('#38b 세금·환율 안내 문구(세율을 지어내지 않는다)', /환율 변동은 포함되지 않음/.test(by.note) && /조세협약/.test(by.note) && /최신 규정 확인 필요/.test(by.note));
  ok('#38c 실질금리 자료가 없으면 10년 − 기대물가로 계산', evalBrazilBond({ ...brGood, brReal: undefined }, exGood).conditions[1].met === true);

  console.log('\n── 파트② 공통 규칙 ──');
  const none = evaluateRateSignals({});
  eq('#19 자료가 없으면 전부 대기(충족으로 치지 않는다)', none.map(r => r.state), ['wait', 'wait', 'wait', 'wait', 'wait', 'wait', 'wait']);
  ok('#19b 자료 없음은 근거에 그대로 드러낸다', none.some(r => /자료 없음/.test(r.rationale)));
  const sorted = evaluateRateSignals({ us10y: m({ pct3y: 72, turnedDown: true }), fedRate: m({ pct3y: 60 }), hySpread: m({ change1m: 0, pct3y: 50 }) });
  eq('#20 충족 비율 내림차순(같으면 정의 순서)', sorted.map(r => r.key), ['longBond', 'equityReit', 'bdc', 'brBond', 'highYield', 'mortgageReit', 'krBond']); // 브라질은 메모 '불리' 없음(⑥)만으로 1/6
  ok('#20b 대표 종목 행을 넘기면 판정에 반영된다', evaluateRateSignals({ us10y: m({ pct3y: 72, turnedDown: true }) }, { O: a({ yield12: 6.5 }) }).find(r => r.key === 'equityReit').state === 'buy');
  ok('#21 원천징수율 15%', RATE_RULES.withholdingPct === 15);
}

let B = null, RM = null;
if (S) {
  try { B = await import(pathToFileURL(join(ROOT, 'src/rateBacktest.ts')).href); RM = await import(pathToFileURL(join(ROOT, 'src/rateMetrics.ts')).href); }
  catch (e) { fail++; console.log(`  ✗ rateBacktest/rateMetrics를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}
if (S && B && RM) {
  console.log('\n── 파트②-b 과거 신호 검증(9-B) ──');
  const { evaluateOne } = S;
  const { metricsAt, pointsOf, extractSignals, performanceAfter, changeAfter, summarizeSignals, addMonthsIso, historyStates, RATE_BT_ASSETS, BT_MIN_GAP } = B;
  const m = (o = {}) => ({ current: 1, change1m: 0, high52: 9, position52: 10, pct3y: 10, turnedDown: false, ...o });
  // 금리 지표만 — 종목·수동값·메모 조건은 빼고(막지 않고) 판정한다
  eq('#40 실물 리츠 rateOnly — O 배당률 없이 ①②면 적기 / 평소엔 관심', [evaluateOne('equityReit', { us10y: m({ pct3y: 72, turnedDown: true }) }, null, null, { rateOnly: true }).state,
    evaluateOne('equityReit', { us10y: m({ pct3y: 72, turnedDown: true }) }).state], ['buy', 'watch']);
  eq('#41 BDC rateOnly — MAIN 조건 없이 ①②면 적기', evaluateOne('bdc', { fedRate: m({ pct3y: 60 }), hySpread: m({ change1m: 0, pct3y: 50 }) }, null, null, { rateOnly: true }).state, 'buy');
  const brAll = { br10y: m({ current: 13.9, pct3y: 80 }), brReal: m({ current: 9 }), brExp12: m({ current: 4.5 }), brSelic: m({ current: 15, pct3y: 85 }), brlkrw: m({ current: 250, change1m: 0, position52: 20 }) };
  const brEx = { exp12Change3m: 0, selicRose60d: false, notes: [{ date: '2026-10-01', impact: '불리' }], today: '2026-10-16' };
  eq('#41b 브라질 rateOnly — 정치 메모는 빼고 금리 조건 5개로 적기', [evaluateOne('brBond', brAll, brEx, null, { rateOnly: true }).state, evaluateOne('brBond', brAll, brEx).state], ['buy', 'buy']);
  evaluateOne('equityReit', { us10y: m({ pct3y: 72, turnedDown: true }) }, null, null, { rateOnly: true });
  ok('#41c rateOnly는 호출이 끝나면 풀린다(개별 판정 함수는 다시 평소대로)', S.evalEquityReit({ us10y: m({ pct3y: 72, turnedDown: true }) }).state === 'watch');
  // metricsAt — rateMetrics.computeRateMetrics와 같은 값(드리프트 가드)
  const ser = {}; let v = 4; let seed = 7;
  for (let d = Date.UTC(2022, 0, 3); d <= Date.UTC(2026, 9, 16); d += 86400000) { seed = (seed * 16807) % 2147483647; v += (seed / 2147483647 - 0.5) * 0.06; if (new Date(d).getUTCDay() % 6) ser[new Date(d).toISOString().slice(0, 10)] = Math.round(v * 1000) / 1000; }
  const pts = pointsOf(ser);
  const bser = { '2025-10-16': 9, '2025-10-17': 5, '2026-06-01': 4, '2026-10-16': 4.5 };
  const bpts = pointsOf(bser), bm = metricsAt(bpts, bpts.length - 1), bc = RM.computeRateMetrics(bser);
  ok('#42b 경계 — 정확히 365일 전 값은 52주에서 빠지고 3년에는 들어간다(computeRateMetrics와 같음)', bm.high52 === 5 && bm.high52 === bc.high52 && Math.abs(bm.pct3y - bc.pct3y) < 1e-9);
  const idxs = [100, 500, 900, pts.length - 1];
  ok('#42 metricsAt(그날까지) = computeRateMetrics(그날까지 자른 기록)', idxs.every(i => {
    const cut = Object.fromEntries(pts.slice(0, i + 1));
    const a = metricsAt(pts, i), b = RM.computeRateMetrics(cut);
    return ['current', 'change1m', 'high52', 'low52', 'position52', 'pct3y', 'high20', 'turnedDown'].every(k => (a[k] == null && b[k] == null) || Math.abs(Number(a[k]) - Number(b[k])) < 1e-9);
  }));
  // 신호 추출 — 새로 '적기'에 들어간 날만, 직전 신호와 20거래일 이상
  const st = (arr) => arr.map((s, i) => ({ date: `D${String(i).padStart(3, '0')}`, state: s }));
  const seq = st(['wait', 'buy', 'buy', 'wait', 'buy', ...Array(18).fill('wait'), 'buy', 'wait', 'buy']);
  eq('#43 새 진입만 · 20거래일 간격(1일째 신호 뒤 4일째는 버리고 23일째·25일째 중 23일째)', extractSignals(seq).map(x => x.index), [1, 23]);
  eq('#43b 간격을 바꾸면 결과도 바뀐다', extractSignals(seq, 2).map(x => x.index), [1, 4, 23, 25]);
  eq('#43d 간격 1이어도 이어지는 적기(2일째)는 새 진입이 아니다', extractSignals(seq, 1).map(x => x.index), [1, 4, 23, 25]);
  ok('#43c 기본 간격 20', BT_MIN_GAP === 20);
  eq('#44 N개월 뒤 날짜(말일 보정)', [addMonthsIso('2026-01-31', 1), addMonthsIso('2025-11-15', 3), addMonthsIso('2024-02-29', 12)], ['2026-02-28', '2026-02-15', '2025-02-28']);
  const prices = [['2025-01-02', 100], ['2025-04-02', 110], ['2025-07-02', 90], ['2026-01-02', 120], ['2026-01-05', 121]];
  const divs = [{ exDate: '2024-12-15', amount: 50 }, { exDate: '2025-01-02', amount: 50 }, { exDate: '2025-02-01', amount: 2 }, { exDate: '2025-05-01', amount: 2 }, { exDate: '2026-03-01', amount: 5 }];  // 신호일 이전·당일 배당은 넣지 않는다
  const p3 = performanceAfter(prices, divs, '2025-01-02', 3, '2026-10-16');
  ok('#45 3개월 성과 — 주가 +10% · 총수익(배당 2) +12%', !p3.pending && Math.abs(p3.price - 10) < 1e-9 && Math.abs(p3.total - 12) < 1e-9);
  const p12 = performanceAfter(prices, divs, '2025-01-02', 12, '2026-10-16');
  ok('#45b 12개월 — 그날 또는 직전 종가(2026-01-02) · 기간 안 배당만(2+2)', !p12.pending && Math.abs(p12.total - ((120 + 4) / 100 - 1) * 100) < 1e-9);
  eq('#45c 기간이 아직 안 지났으면 진행 중', [performanceAfter(prices, divs, '2025-07-02', 12, '2026-01-05'), performanceAfter(prices, divs, '2026-01-02', 3, '2026-10-16')], [{ pending: true }, { pending: true }]);
  eq('#45d 신호일 이전 종가가 없으면 null', performanceAfter(prices, divs, '2024-01-01', 3, '2026-10-16'), null);
  const fx = [['2025-01-02', 250], ['2025-04-02', 240]];
  ok('#46 지표 변화 — 헤알·원 % · 10년 %p', Math.abs(changeAfter(fx, '2025-01-02', 3, '2026-10-16', 'pct').value - (-4)) < 1e-9 && Math.abs(changeAfter(fx, '2025-01-02', 3, '2026-10-16', 'pp').value - (-10)) < 1e-9);
  eq('#47 요약 — 신호 수 · 끝난 것만 평균 · 플러스 비율', summarizeSignals([10, -5, null, 25]), { count: 4, done: 3, avg: 10, winRate: (2 / 3) * 100 });
  // historyStates — 날짜별로 그날까지의 지표로 판정(미래 값을 쓰지 않는다)
  const def = RATE_BT_ASSETS.find(d => d.key === 'equityReit');
  const hs = historyStates(def, { us10y: ser }, (key, all, extras) => evaluateOne(key, all, extras, null, { rateOnly: true }));
  ok('#48 첫 1년은 건너뛰고 기준 지표 날짜마다 상태 1개', hs.length > 0 && hs[0].date >= '2023-01-03' && hs.every((h, i) => i === 0 || h.date > hs[i - 1].date));
  ok('#48b 그날 판정 = 그날까지 자른 기록으로 다시 판정한 값', [50, 300, hs.length - 1].every(i => {
    const d = hs[i].date;
    const cut = Object.fromEntries(pts.filter(([x]) => x <= d));
    return evaluateOne('equityReit', { us10y: RM.computeRateMetrics(cut) }, null, null, { rateOnly: true }).state === hs[i].state;
  }));
  eq('#49 대표 종목 — 장기채 TLT · 하이일드 HYG · 모기지 AGNC · 실물 O · BDC MAIN · 한국·브라질 없음', RATE_BT_ASSETS.map(d => d.rep), ['TLT', 'HYG', 'AGNC', 'O', 'MAIN', null, null]);
}

console.log('\n── 파트③ 배선 가드 ──');
{
  const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const RS = src('src/rateSignals.ts');
  const RW = src('src/components/RateWindow.tsx');
  const code = RS.replace(/\/\/.*$/gm, '');
  ok('#G1 순수 모듈은 import 0건', !/^\s*import\s/m.test(RS));
  ok('#G2 문턱값은 RATE_RULES 한 곳 — 판정 함수는 R(기본 RATE_RULES, 설정값으로 교체 가능)을 읽는다', /export const RATE_RULES = \{/.test(RS) && (code.match(/= R\.\w+;/g) || []).length === 7
    && /let R: typeof RATE_RULES = RATE_RULES;/.test(RS) && /R = rules \|\| RATE_RULES;/.test(RS) && /\} finally \{ R = prev; \}/.test(RS));
  ok('#G3 창은 판정을 rateSignals에서만 가져온다', /from '\.\.\/rateSignals'/.test(RW) && /evaluateRateSignals\(metrics, assetRows, brazilExtras, effRules\)/.test(RW));
  ok('#G4 지시형 문구 없음(주석 제외)', !/사세요|매수하세요|파세요/.test(code + RW.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')));
  ok('#G6 새 기준치도 RATE_RULES에 있다', /pbMax: 0\.9, pbWarn: 1\.1/.test(RS) && /oYieldMin: 6\.0/.test(RS) && /mainDrawdownMax: -15, mainPnavMax: 1\.5/.test(RS));
  ok('#G8 한국 채권 기준치 · 6번째 자산군', /krBond: \{ pctMin: 70 \}/.test(RS) && /evalBdc\(m, assets\), evalKrBond\(m\)/.test(RS));
  ok('#G9 브라질 기준치·7번째 자산군 · 메모는 readBrazilNotes 하나로 읽는다', /brBond: \{/.test(RS) && /evalKrBond\(m\), evalBrazilBond\(m, brazil\)\]/.test(RS)
    && /readBrazilNotes\(eff\.notes\)/.test(RW) && !/BRAZIL_NOTES/.test(RW.replace(/\/\/.*$/gm, '')));
  ok('#G10 brlBond.ts는 그대로 쓰고 이론 가격은 이분법으로 맞춘다', /computeBrlBond\(\{ price: p, face: BRL_BOND_FACE, couponRate: BRL_BOND_COUPON, years: BRL_BOND_YEARS \}\)\?\.ytmAnnual/.test(RW));
  ok('#G11 정치 메모는 처음에 빈 배열(지어내지 않는다)', /export const BRAZIL_NOTES: BrazilNote\[\] = \[\];/.test(src('src/brazilNotes.ts')));
  const RW2 = RW.replace(/\/\/.*$/gm, '');
  ok('#G12 상태 변경 기록 — 벨 알림 없이 설정 파일에 저장 · 패널', /appendStateChanges\(eff\.history, signals, today\)/.test(RW) && /상태 변경 기록/.test(RW) && !/notify\(/.test(RW2)
    && /history: data\?\.history \?\? effRef\.current\?\.history \?\? \[\]/.test(RW));
  ok('#G13 과거 검증은 펼칠 때만 종가·배당을 받고 고정 문구를 둔다', /if \(!btOpen\) return;/.test(RW) && /if \(!btOpen\) return null;/.test(RW)
    && /과거 성과는 미래를 보장하지 않습니다\. 신호 수가 적으면 우연일 수 있습니다\./.test(RW) && /fetchUsDividendEvents\(tk, '10y'\)/.test(RW) && /evaluateOne\(key, all, extras, effRules, \{ rateOnly: true \}\)/.test(RW));
  ok('#G14 차트 신호 점선 — 마우스를 올리면 이름', /<title>\{`\$\{def\.label\} 매수 적기 신호/.test(RW) && (RW.match(/\{signalLines\(\[/g) || []).length === 5);
  const GL = src('src/rateGlossary.ts'), COV = src('src/indicatorCoverage.ts');
  const covKeys = [...((COV.match(/INDICATOR_HISTORY_KEYS = \[([^\]]+)\]/) || [])[1] || '').matchAll(/'(\w+)'/g), ...((COV.match(/MARKET_INDEX_KEYS = \[([^\]]+)\]/) || [])[1] || '').matchAll(/'(\w+)'/g)].map(x => x[1]);
  const glKeys = [...(GL.split('RATE_GLOSSARY_ASSETS')[0]).matchAll(/key: '(\w+)'/g)].map(x => x[1]);
  ok('#G15 용어 풀이 — 지표 33개(커버리지 키와 같은 집합) · 자산군 7개', covKeys.length === 33 && glKeys.length === 33 && covKeys.every(k => glKeys.includes(k))
    && [...(GL.split('RATE_GLOSSARY_ASSETS')[1] || '').matchAll(/key: '(\w+)'/g)].length === 7);
  ok('#G7 6단계 자리표시 문구가 남지 않았다', !/6단계에서 추가/.test(RS));
  ok('#G5 행을 누르면 조건 목록을 펼친다', /setOpenSignal\(/.test(RW) && /c\.pending \? '…' : c\.met \? '○' : '×'/.test(RW));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:rate-signals — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
