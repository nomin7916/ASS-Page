#!/usr/bin/env node
// 시장지표 과거 데이터 보충 검증 — 조회기간 부족분 자동 수집 · FRED 잘림 · 기준금리 이음 · 국내금 페이지 커서.
//
// 발단(사용자 보고 2026-10): 조회기간 2004~인데 시장지표가 일부 기간만 있고(VIX 2015~ 등), 미국 기준금리는
//   최신값이 반영되지 않았다. 사용자는 파이썬으로 받은 JSON을 직접 올려야 했다.
//   원인 ① 서버 FRED 조회가 limit=2000 + 오름차순이라 장기 조회에서 **최근 구간이 잘렸다**
//        ② 자동 수집이 '데이터 없음/최신일 경과'만 보고 **앞쪽·중간 공백**은 영영 채우지 않았다
//        ③ DFEDTARU(2008-12-16~)만 써서 그 이전 기준금리가 없었다
//
//   파트① src/indicatorCoverage.ts **직접 import** (#1~#20) — 미러 금지
//   파트② api/_indicatorSources.ts **직접 import** (#21~#32)
//   파트③ 소스 텍스트 가드 (#G1~#G21) — 배선(서버 라우트·훅 트리거·저장 경로)
//   ⚠️ 2026-10 확장: 패널 13개 항목 **전부**(지수 KOSPI·S&P500·Nasdaq100 포함)가 같은 보충 경로를 탄다(#10c·#G17~#G21).
//     ⚠️ 가드는 '선언'이 아니라 **사용부**를 단언한다. 실패 시 먼저 정규식이 낡았는지 확인할 것.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};
// 객체 키 순서는 의미가 없다(날짜 맵) — 정렬해서 비교
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(kk => [kk, x[kk]])) : x));
const eq = (name, got, want) => {
  const g = canon(got), w = canon(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
};
const S = (label, fn, check) => {
  try { const v = fn(); ok(label, check ? check(v) : true); return v; }
  catch (e) { fail++; console.log(`  ✗ ${label} — threw ${e && e.message}`); return undefined; }
};
const src = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const load = async (rel) => {
  try { return await import(pathToFileURL(join(ROOT, rel)).href); }
  catch (e) {
    const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
    if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 ${rel} 파트를 건너뜁니다.`);
    else { fail++; console.log(`  ✗ ${rel} 모듈을 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
    return null;
  }
};

// 일별 시계열 픽스처(주말 제외) — from~to
const daily = (from, to, val = 10) => {
  const out = {};
  let t = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const end = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  for (; t <= end; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out[d.toISOString().slice(0, 10)] = val;
  }
  return out;
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트① 커버리지 계산 (src/indicatorCoverage.ts 직접 import) ──');
const C = await load('src/indicatorCoverage.ts');
if (C) {
  const { indicatorMissingSegments: seg, mergeIndicatorHistory: merge, addDaysIso, INDICATOR_SOURCE_FLOOR } = C;
  const TODAY = '2026-10-17';

  // 사용자 실측 형태: 조회 2004-01-02~, VIX가 2015-06-01~2026-10-16만 있다
  const vix = daily('2015-06-01', '2026-10-16', 20);
  const r1 = S('#1 앞쪽 공백 계산이 던지지 않는다', () => seg(vix, '2004-01-02', '2026-10-17', TODAY));
  eq('#1b 앞쪽(머리) 구간 = 조회 시작 ~ 보유 최초일 전날', r1, [{ from: '2004-01-02', to: '2015-05-31', kind: 'head' }]);

  // 이미 충분하면 아무것도 받지 않는다(헛조회 없음)
  eq('#2 조회기간을 덮으면 빈 목록', seg(daily('2004-01-02', '2026-10-16'), '2004-01-02', '', TODAY), []);
  // 시작일이 주말·휴장이어도 7일 여유 안이면 부족이 아니다
  eq('#3 시작일 여유(7일) 안이면 머리 없음', seg(daily('2004-01-05', '2026-10-16'), '2004-01-01', '', TODAY), []);

  // 꼬리 — 최신일이 오래됐다(기준금리 '현재값 미반영' 형태)
  const fed = daily('2004-01-02', '2014-06-30', 1);
  const r4 = seg(fed, '2004-01-02', '', TODAY);
  eq('#4 꼬리 구간 = 최신일 5일 전(겹침) ~ 오늘', r4, [{ from: '2014-06-25', to: TODAY, kind: 'tail' }]);
  // 주말·하루 늦은 발표는 오래됨이 아니다
  eq('#5 최신일이 오늘-3일이면 꼬리 없음', seg(daily('2020-01-01', '2026-10-14'), '2020-01-01', '', TODAY), []);
  // 조회 종료일이 과거면 그 종료일 기준
  eq('#6 종료일이 과거면 그 날짜까지만', seg(daily('2020-01-01', '2024-12-31'), '2020-01-02', '2024-12-31', TODAY), []);

  // 내부 공백 — 45일 넘는 구멍만
  const holed = { ...daily('2004-01-02', '2010-12-31'), ...daily('2013-01-01', '2026-10-16') };
  eq('#7 내부 공백(2년) 하나', seg(holed, '2004-01-02', '', TODAY), [{ from: '2011-01-01', to: '2012-12-31', kind: 'gap' }]);
  // 월별 시계열(FRED 월간) — 30일 간격은 공백이 아니다
  const monthly = {};
  for (let y = 2004; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
    const d = `${y}-${String(m).padStart(2, '0')}-01`;
    if (d <= '2026-10-01') monthly[d] = 3;
  }
  monthly['2026-10-16'] = 3;
  eq('#8 월별 간격은 구멍으로 보지 않는다', seg(monthly, '2004-01-01', '', TODAY), []);

  // 데이터 없음 + 시작일 있음 → 전체
  eq('#9 데이터 없음 → 조회기간 전체', seg({}, '2004-01-02', '', TODAY), [{ from: '2004-01-02', to: TODAY, kind: 'all' }]);
  eq('#9b 데이터·시작일 둘 다 없음 → 빈 목록(호출부가 기본 기간 처리)', seg({}, '', '', TODAY), []);

  // 소스 최초일(floor) — BTC는 2014-09-17 이전을 줄 수 없다 → 그 앞을 부족으로 보지 않는다
  eq('#10 소스 최초일 이전은 요구하지 않는다(BTC)', seg(daily('2014-09-17', '2026-10-16'), '2004-01-02', '', TODAY, INDICATOR_SOURCE_FLOOR.btc), []);
  eq('#10b floor 표 — btc/eth/fedRate', [INDICATOR_SOURCE_FLOOR.btc, INDICATOR_SOURCE_FLOOR.eth, INDICATOR_SOURCE_FLOOR.fedRate], ['2014-09-17', '2017-11-09', '1982-09-27']);
  // 패널 13개 항목 전부 — 키 목록은 순수 모듈이 단일 소스, floor는 13개 전부 ISO 날짜
  // 2026-10 미국 금리 5종 → 18, 하이일드·모기지·MOVE 5종 → 23, 한국 금리 3종 → 26, 브라질 7종 → 지표 30 + 지수 3 = 33
  eq('#10c 커버리지 키 = 지표 30 + 지수 3 (33개, 중복 없음)', [...new Set(C.INDICATOR_COVERAGE_KEYS)].length, 33);
  eq('#10d 지수 키 3종', C.MARKET_INDEX_KEYS, ['kospi', 'sp500', 'nasdaq']);
  ok('#10e 33개 키 전부 floor가 있고 ISO 날짜', C.INDICATOR_COVERAGE_KEYS.every(k => C.isIsoDate(INDICATOR_SOURCE_FLOOR[k])));
  eq('#10f 지수 floor 이전은 요구하지 않는다(KOSPI 1997-07-01)', seg(daily('1997-07-01', '2026-10-16', 100), '1980-01-02', '', TODAY, INDICATOR_SOURCE_FLOOR.kospi), []);
  // ── 미국 금리 5종(2026-10) · 장단기 금리차는 0·음수가 정상값 ──
  ok('#10g 미국 금리 5종이 커버리지 키에 있다', ['us2y', 'us30y', 'us3m', 't10y2y', 't10y3m'].every(k => C.INDICATOR_HISTORY_KEYS.includes(k)));
  eq('#10h 부호 있는 지표 = 장단기 금리차 2종 + MBS 스프레드 + 한미 10년 금리차', C.SIGNED_INDICATOR_KEYS, ['t10y2y', 't10y3m', 'mbsSpread', 'krUs10y', 'brReal']);
  const BR = ['brSelic', 'brIpca', 'brExp12', 'br10y', 'brlusd', 'brlkrw', 'brReal'];
  ok('#10g6 브라질 7종이 커버리지 키에 있다 · 실질금리만 부호 있음', BR.every(k => C.INDICATOR_HISTORY_KEYS.includes(k)) && C.isSignedIndicator('brReal') && !C.isSignedIndicator('brSelic'));
  eq('#10g7 실측 첫 날짜 — Selic 1999-03-05 · IPCA 1980-12-01 · 기대물가 2001-12-12 · 10년 2023-10-17 · 헤알 2003-12-01', BR.map(k => INDICATOR_SOURCE_FLOOR[k]),
    ['1999-03-05', '1980-12-01', '2001-12-12', '2023-10-17', '2003-12-01', '2003-12-01', '2023-10-17']);
  ok('#10g4 한국 금리 3종이 커버리지 키에 있다', ['kr3y', 'krBase', 'krUs10y'].every(k => C.INDICATOR_HISTORY_KEYS.includes(k)) && C.isSignedIndicator('krUs10y') && !C.isSignedIndicator('kr3y'));
  eq('#10g5 실측 첫 날짜 — 국고채 3년·한미 금리차 2023-10-18(네이버 약 3년) · 기준금리 1999-05-06(ECOS)', ['kr3y', 'krBase', 'krUs10y'].map(k => INDICATOR_SOURCE_FLOOR[k]), ['2023-10-18', '1999-05-06', '2023-10-18']);
  ok('#10g2 하이일드·모기지·MOVE 5종이 커버리지 키에 있다', ['hyYield', 'hySpread', 'mort30', 'mbsSpread', 'move'].every(k => C.INDICATOR_HISTORY_KEYS.includes(k)));
  eq('#10g3 실측 첫 날짜 — 하이일드 2종 2023-10-17 · 모기지 1971-04-02 · MOVE 2002-11-12', ['hyYield', 'hySpread', 'mort30', 'mbsSpread', 'move'].map(k => INDICATOR_SOURCE_FLOOR[k]), ['2023-10-17', '2023-10-17', '1971-04-02', '1971-04-02', '2002-11-12']);
  ok('#10i isSignedIndicator — 금리차만 true', C.isSignedIndicator('t10y2y') && C.isSignedIndicator('t10y3m') && !C.isSignedIndicator('us10y') && !C.isSignedIndicator(''));
  {
    const sp = { '2023-01-03': -0.71, '2023-01-04': 0, '2023-01-05': 0.12 };
    eq('#10j signed 병합은 0·음수를 보존한다', merge({}, sp, true), sp);
    eq('#10k unsigned 병합은 종전대로 0 이하를 버린다', merge({}, sp), { '2023-01-05': 0.12 });
    eq('#10l signed 병합도 null·빈 문자열·NaN은 버린다', merge({}, { '2023-01-03': null, '2023-01-04': '', '2023-01-05': 'x', '2023-01-06': -1 }, true), { '2023-01-06': -1 });
    // 역전 구간이 내부 공백으로 오인되면 매 세션 헛조회가 난다
    const inv = daily('2022-01-03', '2026-10-16', -0.4);
    eq('#10m signed 커버리지는 음수 구간을 보유로 본다', seg(inv, '2022-01-03', '', TODAY, INDICATOR_SOURCE_FLOOR.t10y2y, true), []);
    ok('#10n [대조] unsigned로 재면 같은 데이터가 전부 빈 구간이 된다', seg(inv, '2022-01-03', '', TODAY).length > 0);
  }

  // 손상값은 날짜로 치지 않는다
  eq('#11 손상 키·0·NaN 값 무시', seg({ bad: 1, '2025-01-01': 0, '2025-01-02': NaN, ...daily('2004-01-05', '2026-10-16') }, '2004-01-01', '', TODAY), []);
  S('#12 null·문자열 입력에도 던지지 않는다', () => [seg(null, '2004-01-01', '', TODAY), seg('x', '', '', TODAY), seg({}, 'bad', 'bad', 'bad')], (v) => Array.isArray(v[0]) && Array.isArray(v[1]) && v[2].length === 0);

  // 머리 + 꼬리 + 공백 순서
  const mix = { ...daily('2008-01-01', '2010-12-31'), ...daily('2012-06-01', '2020-01-31') };
  const r13 = seg(mix, '2004-01-02', '', TODAY);
  eq('#13 머리·공백·꼬리가 날짜 순으로', r13.map(x => x.kind), ['head', 'gap', 'tail']);
  ok('#13b 꼬리 시작은 최신일-5일', r13[2]?.from === addDaysIso('2020-01-31', -5));

  // 병합 — 바뀐 게 없으면 같은 참조(헛된 Drive 저장 방지)
  const base = { '2025-01-02': 1, '2025-01-03': 2 };
  ok('#14 같은 값이면 원본 참조 그대로', merge(base, { '2025-01-02': 1 }) === base);
  const m15 = merge(base, { '2025-01-06': 3, '2025-01-03': 2.5 });
  eq('#15 새 날짜 추가 + 정정값 덮기', m15, { '2025-01-02': 1, '2025-01-03': 2.5, '2025-01-06': 3 });
  ok('#15b 입력 원본은 변하지 않는다', base['2025-01-03'] === 2 && !('2025-01-06' in base));
  eq('#16 손상 입력(0·음수·문자·날짜 아님)은 버린다', merge({}, { '2025-01-02': 0, '2025-01-03': -1, '2025-01-06': 'x', 'Date': 5, '2025-01-07': '4.25' }), { '2025-01-07': 4.25 });
  ok('#17 incoming null이면 원본', merge(base, null) === base);
  eq('#18 prev 없음', merge(undefined, { '2025-01-02': 1 }), { '2025-01-02': 1 });

  // 큰 공백이 여러 개면 큰 것부터 상한
  const many = {};
  for (let y = 2004; y <= 2016; y += 2) Object.assign(many, daily(`${y}-01-01`, `${y}-06-30`));
  Object.assign(many, daily('2017-01-01', '2026-10-16'));
  const r19 = seg(many, '2004-01-01', '', TODAY);
  ok('#19 내부 공백 상한(MAX_GAP_SEGMENTS) 이하', r19.filter(x => x.kind === 'gap').length <= C.MAX_GAP_SEGMENTS);
  ok('#20 시작일 > 종료일이면 빈 목록', seg(vix, '2030-01-01', '2029-01-01', TODAY).length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트② 소스 병합 (api/_indicatorSources.ts 직접 import) ──');
const I = await load('api/_indicatorSources.ts');
if (I) {
  const { parseFredGraphCsv, fillBefore, fillAfter, joinFedRate, isRecentRangeEnd, computeMbsSpread, computeKrUsSpread, parseEcosRows, parseNaverBondPrices, computeBrlKrw, computeBrReal, parseBcbSgs, parseOlindaExpect, parseBokBaseRateHtml, stepToDaily, stepLatest, extendStepChanges, parseNyFedTarget, parsePmmsCsv, fredStartFor, logSafe, parseFredApiObservations, fredLatest, fredKvKey, packFredKv, unpackFredKv, enoughRows } = I;
  const bokHtml = '<table><tr><th>연도</th><th>변경일자</th><th>기준금리</th></tr><tr><td>2026</td><td>08월 27일</td><td>3.00</td></tr>'
    + '<tr><td>2026</td><td>07월 16일</td><td>2.75</td></tr><tr><td>1999</td><td>05월 06일</td><td>4.75</td></tr><tr><td>합계</td><td>x</td><td>1</td></tr></table>';
  eq('#41 한국은행 기준금리 공시 페이지 해석 — 날짜 오름차순 · 표 아닌 행 무시', parseBokBaseRateHtml(bokHtml), [['1999-05-06', 4.75], ['2026-07-16', 2.75], ['2026-08-27', 3]]);
  eq('#41b 표가 없으면 null', parseBokBaseRateHtml('<html>점검 중</html>'), null);
  const ch = [['2026-07-16', 2.75], ['2026-08-27', 3]];
  eq('#42 변경 이력 → 달력 날짜마다(주말 포함 — ECOS 일별과 같은 모양) · 첫 변경 전은 만들지 않음', stepToDaily(ch, '2026-07-15', '2026-07-18'), { '2026-07-16': 2.75, '2026-07-17': 2.75, '2026-07-18': 2.75 });
  eq('#42b 변경일 당일부터 새 금리(ECOS 실측 2026-08-27 → 3.00)', [stepToDaily(ch, '2026-08-26', '2026-08-27')['2026-08-26'], stepToDaily(ch, '2026-08-26', '2026-08-27')['2026-08-27']], [2.75, 3]);
  const fch = [['2025-12-11', 3.75], ['2026-09-17', 4]];
  eq('#44 연준 변경 이력 + 뉴욕 연준 관측 — 스냅샷 뒤에 값이 바뀐 날만 추가 · 스냅샷 이전·같은 값은 무시', extendStepChanges(fch, { '2026-09-01': 3.5, '2026-10-01': 4, '2026-10-29': 3.75, '2026-10-30': 3.75 }), [['2025-12-11', 3.75], ['2026-09-17', 4], ['2026-10-29', 3.75]]);
  eq('#44b 관측 없음 → 스냅샷 그대로', extendStepChanges(fch, null), fch);
  eq('#45 뉴욕 연준 EFFR — 날짜→목표 상단 · 모양이 틀리면 null', [parseNyFedTarget({ refRates: [{ effectiveDate: '2026-10-15', percentRate: 3.88, targetRateFrom: 3.75, targetRateTo: 4.0 }, { effectiveDate: 'x', targetRateTo: 1 }] }), parseNyFedTarget({})], [{ '2026-10-15': 4 }, null]);
  eq('#46 프레디맥 PMMS CSV — M/D/YYYY · pmms30 열 · 빈 값 버림 · 머리글이 다르면 null',
    [parsePmmsCsv('date,pmms30,pmms30p,pmms15\n4/2/1971,7.33, ,\n10/15/2026,7.4,,6.71\n10/22/2026,,,'), parsePmmsCsv('a,b\n1,2')], [{ '1971-04-02': 7.33, '2026-10-15': 7.4 }, null]);
  eq('#47 ICE BofA(하이일드 2종) 시작일은 오늘 − 3년 + 2일보다 이르지 않게 · 3년 안이면 그대로 · 다른 시리즈는 그대로',
    [fredStartFor('BAMLH0A0HYM2EY', '2023-10-17', '2026-10-20'), fredStartFor('BAMLH0A0HYM2', '', '2026-10-20'), fredStartFor('BAMLH0A0HYM2', '2026-09-05', '2026-10-20'), fredStartFor('DGS10', '1962-01-02', '2026-10-20'), fredStartFor('BAMLH0A0HYM2', '2020-01-01', '2028-02-29')],
    ['2023-10-22', '2023-10-22', '2026-09-05', '1962-01-02', '2025-03-03']);
  eq('#48 로그 문자열 — 키는 ***로 지우고 공백 정리 · 300자로 자름', [logSafe('{"error_message":"Bad  Request\n KEY123 bad"}', 'KEY123'), logSafe('x'.repeat(400)).length, logSafe(null)], ['{"error_message":"Bad Request *** bad"}', 300, '']);
  eq('#49 FRED API JSON — 결측(.)·날짜 오류 버림 · 일반은 0 이하 버림 · signed는 보존',
    [parseFredApiObservations({ observations: [{ date: '2026-10-16', value: '3.05' }, { date: '2026-10-15', value: '.' }, { date: 'x', value: '1' }, { date: '2026-10-14', value: '-0.2' }] }), parseFredApiObservations({ observations: [{ date: '2026-10-14', value: '-0.2' }] }, true), parseFredApiObservations(null)],
    [{ '2026-10-16': 3.05 }, { '2026-10-14': -0.2 }, {}]);
  eq('#50 최신값 — 가장 늦은 관측·직전 · 비율(%) / diff는 %p 차이 · 빈 기록 null',
    [fredLatest({ '2026-10-15': 4, '2026-10-16': 5 }), fredLatest({ '2026-10-15': 3, '2026-10-16': 3.1 }, true)?.change.toFixed(2), fredLatest({})],
    [{ price: 5, prev: 4, date: '2026-10-16', prevDate: '2026-10-15', change: 25, source: 'FRED' }, '0.10', null]);
  eq('#51 KV 보관값 — 시리즈별 키 · 저장·복원 왕복에 stale:true · 손상값 null',
    [fredKvKey('BAMLH0A0HYM2'), unpackFredKv(packFredKv({ price: 3.1, prev: 3, date: '2026-10-16', prevDate: '2026-10-15' }), true)?.stale, unpackFredKv(packFredKv({ price: 3.1, prev: 3, date: '2026-10-16', prevDate: '2026-10-15' }), true)?.change.toFixed(2), unpackFredKv('{bad'), unpackFredKv(null)],
    ['fred:latest:v1:BAMLH0A0HYM2', true, '0.10', null, null]);
  eq('#52 관측 충분 — 짧은 구간(최신분 10일)은 영업일 절반이면 충분 · 긴 구간은 10건 · 0건은 부족 · 구간 모르면 10건',
    [enoughRows({ a: 1, b: 1, c: 1, d: 1 }, '20261011', '20261020'), enoughRows({ a: 1, b: 1 }, '20261011', '20261020'), enoughRows({ a: 1 }, '20261001', '20261231'), enoughRows({}, '20261019', '20261020'), enoughRows({ a: 1 }, '20261020', '20261020'), enoughRows({ a: 1 }, '', '')],
    [true, false, false, false, true, false]);
  eq('#43 오늘 금리 · 직전 변경 폭', [stepLatest(ch, '2026-10-18'), stepLatest(ch, '2026-08-01'), stepLatest(ch, '2026-01-01')], [{ price: 3, change: 0.25, date: '2026-08-27' }, { price: 2.75, change: 0, date: '2026-07-16' }, null]);
  eq('#37 헤알·원 = 원/달러 ÷ 헤알/달러(그날 또는 직전 헤알) · 소수 4자리', computeBrlKrw({ '2026-10-15': 1400, '2026-10-16': 1410 }, { '2026-10-15': 5.6 }), { '2026-10-15': 250, '2026-10-16': 251.7857 });
  eq('#37b 헤알 값이 0·없으면 만들지 않는다', [computeBrlKrw({ '2026-10-15': 1400 }, { '2026-10-15': 0 }), computeBrlKrw({ '2026-10-15': 1400 }, { '2026-10-16': 5 })], [{}, {}]);
  eq('#38 브라질 실질금리 = 10년 − 기대물가(그날 또는 직전 기대치) · 음수 보존', computeBrReal({ '2026-10-08': 13.9, '2026-10-12': 4.4 }, { '2026-10-08': 4.5, '2026-10-09': 4.48 }), { '2026-10-08': 9.4, '2026-10-12': -0.08 });
  eq('#39 BCB SGS — dd/MM/yyyy → ISO · 오늘 이후(다음 Copom 날짜) 버림', parseBcbSgs([{ data: '05/03/1999', valor: '45.00' }, { data: '04/11/2026', valor: '13.75' }, { data: 'x', valor: '1' }], '2026-10-18'), { '1999-03-05': 45 });
  eq('#39b BCB 오류 객체(10년 초과 조회 등)는 null', parseBcbSgs({ error: 'janela' }), null);
  eq('#40 Olinda 기대 인플레이션 중앙값', parseOlindaExpect({ value: [{ Data: '2026-10-09', Mediana: 4.4772 }, { Data: 'bad', Mediana: 1 }] }), { '2026-10-09': 4.4772 });
  eq('#40b Olinda 오류 응답은 null', parseOlindaExpect({ codigo: 400 }), null);
  eq('#34 한미 10년 금리차 = 한국 − 미국(그날 또는 직전 미국 값) · 음수 보존 · 소수 4자리',
    computeKrUsSpread({ '2026-10-13': 3.0, '2026-10-14': 3.1, '2026-10-15': 4.2 }, { '2026-10-13': 4.1, '2026-10-15': 4.2 }),
    { '2026-10-13': -1.1, '2026-10-14': -1, '2026-10-15': 0 });
  eq('#34b 미국 값이 생기기 전 한국 날짜는 만들지 않는다', computeKrUsSpread({ '2026-10-01': 3 }, { '2026-10-02': 4 }), {});
  eq('#35 ECOS 응답 → 날짜·값', parseEcosRows({ StatisticSearch: { row: [{ TIME: '19990506', DATA_VALUE: '4.75' }, { TIME: 'x', DATA_VALUE: '1' }, { TIME: '20261008', DATA_VALUE: '2.50' }] } }),
    { '1999-05-06': 4.75, '2026-10-08': 2.5 });
  eq('#35b ECOS 오류 응답(인증키 오류 등)은 null — 값을 지어내지 않는다', parseEcosRows({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } }), null);
  eq('#36 네이버 채권 일별 시세 해석', parseNaverBondPrices({ isSuccess: true, result: [{ localTradedAt: '2026-10-16T15:59:06+09:00', closePrice: '3.8820' }, { localTradedAt: '', closePrice: '1' }] }), { '2026-10-16': 3.882 });
  eq('#36b 실패 응답은 null', parseNaverBondPrices({ isSuccess: false }), null);
  const csv = 'observation_date,DFEDTARU\r\n2008-12-16,0.25\r\n2008-12-17,.\r\n2008-12-18,\r\n2026-10-16,3.75\r\n';
  eq('#21 fredgraph.csv 파싱(헤더·결측 . ·빈 칸·CRLF)', parseFredGraphCsv(csv), { '2008-12-16': 0.25, '2026-10-16': 3.75 });
  eq('#22 옛 헤더(DATE)도', parseFredGraphCsv('DATE,DGS10\n2004-01-02,4.38\n'), { '2004-01-02': 4.38 });
  eq('#23 빈·손상 입력', [parseFredGraphCsv(''), parseFredGraphCsv(null)], [{}, {}]);
  const spCsv = 'observation_date,T10Y2Y\n2023-01-03,-0.71\n2023-01-04,0.00\n2023-01-05,.\n2023-01-06,\n2023-01-09,0.12\n';
  eq('#23b signed: 금리차는 0·음수 보존(결측·빈 칸은 제외)', parseFredGraphCsv(spCsv, true), { '2023-01-03': -0.71, '2023-01-04': 0, '2023-01-09': 0.12 });
  eq('#23c unsigned: 종전대로 0 이하 제외', parseFredGraphCsv(spCsv), { '2023-01-09': 0.12 });

  const yahoo = { '2003-12-01': 1190, '2003-12-02': 1191 };
  const fred = { '2003-11-28': 1180, '2003-12-01': 9999, '2003-11-27': 1179 };
  eq('#24 fillBefore — 주 소스 최초일 이전만 보충, 겹치는 날은 주 소스', fillBefore(yahoo, fred), { '2003-11-27': 1179, '2003-11-28': 1180, '2003-12-01': 1190, '2003-12-02': 1191 });
  eq('#25 fillBefore — 주 소스 없음이면 보조 전체', fillBefore({}, { '2001-01-02': 1 }), { '2001-01-02': 1 });
  eq('#26 fillAfter — 주 소스 최신일 이후만', fillAfter({ '2026-10-14': 4.1, '2026-10-15': 4.2 }, { '2026-10-15': 9, '2026-10-16': 4.3 }), { '2026-10-14': 4.1, '2026-10-15': 4.2, '2026-10-16': 4.3 });
  eq('#27 joinFedRate — 2008-12-15까지 DFEDTAR + 이후 DFEDTARU', joinFedRate({ '2004-06-30': 1.25, '2008-12-15': 1 }, { '2008-12-16': 0.25, '2026-10-16': 3.75 }),
    { '2004-06-30': 1.25, '2008-12-15': 1, '2008-12-16': 0.25, '2026-10-16': 3.75 });
  eq('#28 joinFedRate — 조회 범위가 2008 이후뿐이면 상단만', joinFedRate({}, { '2026-10-16': 3.75 }), { '2026-10-16': 3.75 });
  ok('#29 isRecentRangeEnd — 오늘·어제 종료는 최근', isRecentRangeEnd('20261017', '20261017') && isRecentRangeEnd('20261015', '20261017'));
  ok('#30 isRecentRangeEnd — 과거 구간은 최근 아님', !isRecentRangeEnd('20150531', '20261017'));
  ok('#31 isRecentRangeEnd — 손상 입력은 최근으로(짧은 캐시가 안전)', isRecentRangeEnd('', '20261017'));
  // MBS 스프레드 = 30년 모기지(주간·목요일) − 미국 10년(일별). 같은 날짜면 그날 값끼리, 모기지가 없는 날은 직전 모기지.
  //   첫 모기지 이전 날짜는 만들지 않고, 음수도 그대로 낸다(부동소수 잔차는 소수 4자리로 정리).
  eq('#33 computeMbsSpread — 같은 날짜·직전 모기지 이월·첫 발표 이전 제외·음수 보존',
    computeMbsSpread({ '2026-10-02': 6.30, '2026-10-09': 6.81 }, { '2026-10-01': 4.0, '2026-10-02': 4.1, '2026-10-06': 4.2, '2026-10-09': 4.1, '2026-10-12': 7.0 }),
    { '2026-10-02': 2.2, '2026-10-06': 2.1, '2026-10-09': 2.71, '2026-10-12': -0.19 });
  ok('#32 fillBefore 입력 불변', (() => { const p = { '2004-01-02': 1 }; fillBefore(p, { '2003-01-02': 2 }); return Object.keys(p).length === 1; })());
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트③ 배선 가드 ──');
const H = stripComments(src('api/history.ts'));
const IND = stripComments(src('api/indicators.ts'));
const FR = stripComments(src('api/fred.ts'));
const M = stripComments(src('src/hooks/useMarketData.ts'));
const COV = src('src/indicatorCoverage.ts');
const SRCS = src('api/_indicatorSources.ts');

ok('#G1 FRED limit은 최대(100000) — 2000+오름차순은 최근 구간을 자른다(과거치는 /api/fred)', /p\.sort_order = 'asc'; p\.limit = '100000';/.test(FR) && !/limit\s*=?\s*:?\s*'2000'/.test(FR + H));
ok('#G2 FRED API 실패 → fredgraph.csv 폴백 → 1회 재시도(API → fredgraph) — /api/fred 단계표',
  /\{ stage: 'api', ms: 8000, retry: false \},\s*\{ stage: 'fredgraph', ms: 6000, retry: false \},\s*\{ stage: 'api', ms: 5000, retry: true \},\s*\{ stage: 'fredgraph', ms: 5000, retry: true \},/.test(FR)
  && /fred\.stlouisfed\.org\/graph\/fredgraph\.csv/.test(FR) && /parseFredGraphCsv\(await res\.text\(\), r\.signed\)/.test(FR) && /for \(const st of STEPS\)/.test(FR));
ok('#G3 실시간·과거치 모두 FRED는 /api/fred만 — 두 함수에 FRED 직접 호출 없음', !/stlouisfed\.org/.test(H + IND) && /\$\{origin\}\/api\/fred\?mode=latest/.test(IND) && /\$\{SELF_ORIGIN\}\/api\/fred\?\$\{p\}/.test(H));
ok('#G4 기준금리 = DFEDTAR(~2008-12-15) + DFEDTARU 이음', /fetchFredHistory\('DFEDTARU'/.test(H) && /fetchFredHistory\('DFEDTAR', d1/.test(H) && /joinFedRate\(legacy, upper\)/.test(H));
ok('#G5 US10Y 최신 꼬리를 Naver로 보충', /fillAfter\(data, tail\)/.test(H) && /fetchNaverBondHistory\('US10YT=RR', shiftYmd\(ymd\(last\), 1\)/.test(H));
ok('#G6 KR10Y 앞쪽을 FRED 월별로 보충', /fetchFredHistory\('IRLTLT01KRM156N', d1, shiftYmd\(ymd\(first\), -1\)/.test(H) && /fillBefore\(data, head\)/.test(H));
ok('#G7 USDKRW 앞쪽을 FRED DEXKOUS로 보충', /key === 'usdkrw'/.test(H) && /fetchFredHistory\('DEXKOUS'/.test(H));
ok('#G8 최근 종료 요청은 짧게 캐시', /csvResponse\(data, recent\)/.test(H) && /s-maxage=3600/.test(H) && /isRecentRangeEnd\(d2,/.test(H));
ok('#G9 Naver 채권 이력 청크 역순 수집(진전 없으면 종료)', /earliest >= chunkEnd\) break;/.test(H) && /chunkEnd = shiftYmd\(earliest, -1\);/.test(H));
ok('#G10 국내금 페이지 커서 모드(page·pages·stop → data·next·done)', /searchParams\.get\('page'\)/.test(H) && /JSON\.stringify\(\{ data, next, done \}\)/.test(H));
ok('#G11 훅: 커버리지 계산·병합은 공용 순수 함수', /indicatorMissingSegments\(hist, start, end, today, INDICATOR_SOURCE_FLOOR\[key\](, isSignedIndicator\(key\))?\)/.test(M)
  && (M.match(/mergeIndicatorHistory\(prev/g) || []).length >= 2);
ok('#G12 훅: 구간 키 단위 세션 가드 + 새로고침만 꼬리 강제', /const forced = opts\.forceTail && seg\.kind === 'tail';/.test(M) && /if \(!forced && coverageGuardRef\.current\.has\(g\)\) continue;/.test(M));
ok('#G13 훅: Drive 로드 뒤 1회 · 조회기간 변경 · 새로고침 3개 트리거', /coverageReadyRef\.current = true;[\s\S]{0,200}ensureIndicatorCoverage\(\);/.test(M)
  && /\}, \[appliedRange\?\.start, appliedRange\?\.end\]\);/.test(M)
  && /if \(fresh && coverageReadyRef\.current\) ensureIndicatorCoverage\(\{ forceTail: true \}\);/.test(M));
ok('#G14 훅: MARKET 파일을 직접 쓰지 않는다(App 자동 저장 게이트 경유)', !/saveDriveFile\(/.test(M));
ok('#G15 훅: 국내금은 조회 시작일까지 페이지를 이어 받는다', /&stop=\$\{stop\}/.test(M) && /if \(!\(json\.next > page\)\) break;/.test(M));
ok('#G16b 서버: 미국 금리 5종 FRED 시리즈 · 금리차는 signed + JSON 응답', /us2y:\s*\{ id: 'DGS2',\s*signed: false \}/.test(H) && /us30y:\s*\{ id: 'DGS30',\s*signed: false \}/.test(H)
  && /us3m:\s*\{ id: 'DGS3MO',\s*signed: false \}/.test(H) && /t10y2y:\s*\{ id: 'T10Y2Y',\s*signed: true \}/.test(H) && /t10y3m:\s*\{ id: 'T10Y3M',\s*signed: true \}/.test(H)
  && /fetchFredHistory\(id, d1, d2, FRED_TIMEOUT, signed\)/.test(H) && /if \(!signed\) return csvResponse\(data, recent\);/.test(H));
ok('#G16c 실시간: 5종 최신값 + 금리차 전일대비는 %p 차이', /fetchFred\('DGS2'\)/.test(IND) && /fetchFred\('DGS30'\)/.test(IND) && /fetchFred\('DGS3MO'\)/.test(IND)
  && /fetchFred\('T10Y2Y', true\)/.test(IND) && /fetchFred\('T10Y3M', true\)/.test(IND) && /t10y3m:\s*t10y3mV/.test(IND));
ok('#G16d 훅: 금리차는 signed 병합·커버리지', /mergeIndicatorHistory\(prev\[key\], parsedData, isSignedIndicator\(key\)\)/.test(M)
  && /INDICATOR_SOURCE_FLOOR\[key\], isSignedIndicator\(key\)\)/.test(M) && /t10y3m:\s*'fred:T10Y3M'/.test(M));
ok('#G16 순수 모듈은 import 0건', !/^\s*import\s/m.test(COV) && !/^\s*import\s/m.test(SRCS));

// ── 2026-10: 지수 3종도 같은 보충 경로 ──
const MI = stripComments(src('src/components/MarketIndicators.tsx'));
// 패널은 같은 13개를 두 곳(표시 목록·검증 표)에서 나열한다 — 중복을 걷어 '어떤 항목이 있는가'만 센다
const panelKeys = [...new Set([...MI.matchAll(/label:\s*'[^']+',\s*key:\s*'(\w+)'/g)].map(m => m[1]))];
const covKeys = (COV.match(/INDICATOR_HISTORY_KEYS = \[([^\]]+)\]/) || [])[1];
const idxKeys = (COV.match(/MARKET_INDEX_KEYS = \[([^\]]+)\]/) || [])[1];
const covSet = new Set([...(covKeys || '').matchAll(/'(\w+)'/g), ...(idxKeys || '').matchAll(/'(\w+)'/g)].map(m => m[1]));
ok('#G17 패널의 모든 항목(33)이 커버리지 키 목록에 있다', panelKeys.length === 33 && panelKeys.every(k => covSet.has(k)));
ok('#G17e 서버: 브라질 7종 — SGS 432·13522 · Olinda · 네이버 BR10YT → Yahoo · BRL=X · 계산 2종', /fetchBcbSgsLatest\(432, 60\)/.test(IND) && /fetchBcbSgsLatest\(13522, 400\)/.test(IND)
  && /fetchNaverBond\('BR10YT=RR', 'Naver채권'\)/.test(IND) && /fetchYahoo\('BRL=X'\)/.test(IND) && /usdkrw\.price \/ bu\.price/.test(IND) && /br10y\.price - ex\.price/.test(IND)
  && /key === 'brSelic' \? 432 : 13522/.test(H) && /fetchNaverBondDaily\('BR10YT=RR'/.test(H) && /brlusd:\s*'BRL=X'/.test(H)
  && /const data = computeBrlKrw\(krw, brl\);/.test(H) && /const data = computeBrReal\(r10, exp\);/.test(H));
ok('#G17f 패널: 물가·기대물가는 관측일 표시 · 10년은 비면 자료 없음', /asOf: marketIndicators\.brIpcaDate/.test(MI) && /asOf: marketIndicators\.brExp12Date/.test(MI) && /emptyText: '자료 없음'/.test(MI));
ok('#G17c 서버: 한국 금리 3종 — 국고채 3년 네이버→Yahoo · 기준금리 ECOS(722Y001/0101000, 키 없으면 needKey) · 한미 금리차 계산', /fetchNaverBond\('KR3YT=RR', 'Naver채권'\)/.test(IND)
  && /fetchYahoo\('\^KR3YT=RR'\)/.test(IND) && /const ecos = ECOS_KEY \? await fetchEcosBaseRateRaw\(\) : \{ price: null, change: null, source: 'ECOS', needKey: true \};/.test(IND) && /await fetchBokBaseRateChanges\(\)/.test(IND)
  && /722Y001\/D\/\$\{ymdOf\(start\)\}\/\$\{ymdOf\(end\)\}\/0101000/.test(IND) && /krBase:\s*ok\(krBase\)/.test(IND) && /kr10y\.price - us10y\.price/.test(IND)
  && /if \(key === 'kr3y'\)/.test(H) && /fetchNaverBondDaily\('KR3YT=RR'/.test(H) && /if \(ECOS_KEY\) try \{/.test(H) && /data = stepToDaily\(changes, iso\(d1\), to\);/.test(H)
  && /const data = computeKrUsSpread\(kr, ust\);/.test(H) && /fetchNaverBondDaily\('KR10YT=RR', d1, d2/.test(H));
const KB = await load('api/_krBaseRateData.ts');
if (KB) {
  const c = KB.KR_BASE_RATE_CHANGES;
  ok('#G17g 기준금리 스냅샷 — 한국은행 공시 61건 · 1999-05-06 4.75 ~ 2026-08-27 3.00 · 날짜 오름차순',
    c.length === 61 && c[0][0] === '1999-05-06' && c[0][1] === 4.75 && c[60][0] === '2026-08-27' && c[60][1] === 3 && c.every((x, i) => i === 0 || x[0] > c[i - 1][0]));
}
const UF = await load('api/_usFedRateData.ts');
if (UF) {
  const c = UF.US_FED_RATE_CHANGES;
  ok('#G17i 연준 기준금리 스냅샷 — FRED DFEDTAR+DFEDTARU 변경 186건 · 1982-09-27 10.25 ~ 2026-09-17 4.00 · 오름차순 · 연속 같은 값 없음',
    c.length === 186 && c[0][0] === '1982-09-27' && c[0][1] === 10.25 && c[185][0] === '2026-09-17' && c[185][1] === 4
    && c.every((x, i) => i === 0 || (x[0] > c[i - 1][0] && x[1] !== c[i - 1][1])));
}
ok('#G17k 하이일드 null 대책 — FRED 시작일 3년 안(ICE BofA) · 실패 로그(시리즈·단계·ms·상태, 키는 지움)',
  /start: fredStartFor\(id, since, today\)/.test(FR) && /const start = fredStartFor\(id, ISO\.test\(s0\) \? s0 : '', today\);/.test(FR)
  && /console\.error\(`\[fred\] \$\{id\} \$\{tag\} 실패 status=\$\{res\.status\} \$\{ms\}ms: \$\{logSafe\(await res\.text\(\)\.catch\(\(\) => ''\), FRED_KEY\)\}`\);/.test(FR)
  && /console\.error\(`\[fred\] \$\{id\} \$\{tag\} 오류 \$\{logSafe\(\(e as any\)\?\.name \|\| e, FRED_KEY\)\} \$\{Date\.now\(\) - t0\}ms`\);/.test(FR));
ok('#G19 짧은 구간을 \'부족\'으로 보지 않는다(kr10y·us10y·네이버 채권) · kr10y는 네이버 일별을 버리지 않고 앞쪽만 월별 · API 정상 0건이면 그대로 끝',
  (H.match(/enoughRows\(/g) || []).length === 4 && !/length (<|>=) 10\)/.test(H.replace(/allData\)\.length < 10/, '')) && /data = fillBefore\(data, await fetchFredHistory\('IRLTLT01KRM156N', d1, d2\)\);/.test(H)
  && /fillBefore, fillAfter, enoughRows,/.test(H) && /if \(st\.stage === 'api'\) return rec;/.test(FR));
ok('#G18 FRED는 미국 동부(iad1) 전용 함수 · 두 함수는 그대로(한국 출처) · KV 마지막 성공값(MSET 저장·MGET 읽기, stale) · 카드 기준일',
  /export const config = \{ runtime: 'edge', regions: \['iad1'\] \};/.test(FR) && /export const config = \{ runtime: 'edge' \};/.test(H) && /export const config = \{ runtime: 'edge' \};/.test(IND)
  && /redis\(\['MSET', \.\.\.fresh\]\)/.test(FR) && /redis\(\['MGET', \.\.\.missing\.map\(fredKvKey\)\]\)/.test(FR) && /unpackFredKv\(kept\[i\], diffs\.has\(id\)\)/.test(FR)
  && /parseFredGraphCsv, parseFredApiObservations, fredLatest, fredStartFor, logSafe,\s*fredKvKey, packFredKv, unpackFredKv,\s*\} from '\.\/_indicatorSources\.js';/.test(FR)
  && /const fredBatch = fetchFredBatch\(new URL\(req\.url\)\.origin, fresh\);/.test(IND) && /SELF_ORIGIN = origin;/.test(H)
  && /merged\[`\$\{k\}Stale`\] = d\.stale === true;/.test(M) && /기준일 \{marketIndicators\[`\$\{item\.key\}Date`\]\}/.test(src('src/components/MarketIndicators.tsx'))
  && /staleDate=\{live\?\.\[k\]\?\.stale \? live\[k\]\.date : null\}/.test(src('src/components/RateWindow.tsx')) && /· 기준일 \{staleDate\}/.test(src('src/components/RateWindow.tsx')));
ok('#G17j FRED 키 없는 배포 — 미국 국채는 네이버 · 금리차는 네이버 10년 − 2년/3개월 · 모기지 프레디맥 · 기준금리 스냅샷+뉴욕 연준 · 키 없으면 FRED 4초',
  /const FRED_TIMEOUT = 9000;/.test(H) && /us3m: 'US3MT=RR', us2y: 'US2YT=RR', us10y: 'US10YT=RR', us30y: 'US30YT=RR'/.test(H)
  && /if \(NAVER_US_BOND\[key\]\) data = await fetchNaverUsBond\(key, d1, d2\);/.test(H) && /data = computeKrUsSpread\(ten, short\);/.test(H)
  && /else if \(key === 'mort30'\) data = await fetchPmmsHistory\(d1, d2\);/.test(H) && /data = await fetchUsFedRateNoKey\(d1, d2,/.test(H)
  && /: await fetchPmmsHistory\(shiftYmd\(d1, -14\), d2\);/.test(H) && (H.match(/fetchUs10yAny\(/g) || []).length === 3
  && /extendStepChanges, parseNyFedTarget, parsePmmsCsv, logSafe,\s*\} from '\.\/_indicatorSources\.js';/.test(H) && /import \{ US_FED_RATE_CHANGES \} from '\.\/_usFedRateData\.js';/.test(H)
  && /fetchNaverBond\('US2YT=RR'/.test(IND) && /fetchNaverBond\('US3MT=RR'/.test(IND) && /fetchNaverBond\('US30YT=RR'/.test(IND)
  && /\n\s+fetchUsFedRateNoKey\(\),/.test(IND) && /\n\s+fetchPmmsLatest\(\),/.test(IND) && /const fedRateV = pick\(ok\(fedRate\), ok\(fedRateAlt\)\);/.test(IND)
  && /fedRate: fedRateV,/.test(IND) && /us2y:\s*us2yV,/.test(IND) && /const m = ok\(mort30\), u = us10yForMbs;/.test(IND)
  && /import \{ parseBokBaseRateHtml, stepLatest, extendStepChanges, parseNyFedTarget, parsePmmsCsv, logSafe \} from '\.\/_indicatorSources\.js';/.test(IND) && /import \{ US_FED_RATE_CHANGES \} from '\.\/_usFedRateData\.js';/.test(IND));
{
  const RWs = src('src/components/RateWindow.tsx'), BC = src('src/bcbClient.ts');
  ok('#G17h 브라질 BCB — 서버가 비면 브라우저가 직접(과거치·현재값), 해석은 서버와 같은 함수', /if \(rec \|\| !BCB_BROWSER_KEYS\.includes\(key\)\) return rec;/.test(RWs) && /fetchBcbHistoryBrowser\(key, fromIso, toIso, fetchHistoryServer\)/.test(RWs)
    && /await fillBrazilLiveCapped\(data\);/.test(M) && /import \{ parseBcbSgs, parseOlindaExpect, computeBrReal \} from '\.\.\/api\/_indicatorSources';/.test(BC));
}
ok('#G17d 화면: 기준금리 인증키가 없으면 \'인증키 필요\'(패널·금리 창)', /emptyText: marketIndicators\.krBaseNeedKey \? '인증키 필요' : null/.test(MI)
  && /merged\.krBaseNeedKey = d\?\.needKey === true/.test(M));
ok('#G17b 서버: 하이일드·모기지 FRED · MBS 스프레드는 서버 계산(JSON) · MOVE는 Yahoo', /hyYield:\s*\{ id: 'BAMLH0A0HYM2EY',\s*signed: false \}/.test(H)
  && /hySpread:\s*\{ id: 'BAMLH0A0HYM2',\s*signed: false \}/.test(H) && /mort30:\s*\{ id: 'MORTGAGE30US',\s*signed: false \}/.test(H)
  && /const data = computeMbsSpread\(mort, ust\);/.test(H) && /move:\s*'\^MOVE'/.test(H)
  && /fetchFred\('MORTGAGE30US'\)/.test(IND) && /fetchYahoo\('\^MOVE'\)/.test(IND) && /mbsSpread,/.test(IND));
ok('#G18 서버: 지수 3종 Yahoo 라우트(kospi/sp500/nasdaq) — 임의 구간 조회 가능', /kospi:\s*'\^KS11'/.test(H) && /sp500:\s*'\^GSPC'/.test(H) && /nasdaq:\s*'\^NDX'/.test(H));
ok('#G19 훅: 커버리지 키는 순수 모듈 목록 그대로(13개) — 손나열 금지', /const AUTO_INDICATOR_KEYS = INDICATOR_COVERAGE_KEYS;/.test(M)
  && !/AUTO_INDICATOR_KEYS = \['us10y'/.test(M));
ok('#G20 훅: 지수는 marketIndices를 읽고 marketIndices에 병합(상태 표 갱신 포함)', /const hist = MARKET_INDEX_KEYS\.includes\(key\) \? marketIndicesRef\.current\?\.\[key\] : indicatorHistoryMapRef\.current\?\.\[key\];/.test(M)
  && /if \(MARKET_INDEX_KEYS\.includes\(key\)\) \{[\s\S]{0,700}setMarketIndices\(prev => \{[\s\S]{0,200}mergeIndicatorHistory\(prev\?\.\[key\], parsedData\)/.test(M)
  && /setIndexFetchStatus\(p => \(\{ \.\.\.p, \[key\]: buildIndexStatus\(mergedIdx, 'Yahoo\(server\)'\) \}\)\);/.test(M)
  && /kospi:\s*'yahoo:\^KS11'/.test(M));
ok('#G21 훅: 옛 지수 머리 확장 effect 삭제(두 경로 중복 수집 방지) · 전체 수집 버튼도 13개', !/indexAutoExpandedRef/.test(M)
  && /for \(const key of INDICATOR_COVERAGE_KEYS\) \{/.test(M));

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:indicators — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
