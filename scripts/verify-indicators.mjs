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
  eq('#10c 커버리지 키 = 지표 10 + 지수 3 (13개, 중복 없음)', [...new Set(C.INDICATOR_COVERAGE_KEYS)].length, 13);
  eq('#10d 지수 키 3종', C.MARKET_INDEX_KEYS, ['kospi', 'sp500', 'nasdaq']);
  ok('#10e 13개 키 전부 floor가 있고 ISO 날짜', C.INDICATOR_COVERAGE_KEYS.every(k => C.isIsoDate(INDICATOR_SOURCE_FLOOR[k])));
  eq('#10f 지수 floor 이전은 요구하지 않는다(KOSPI 1997-07-01)', seg(daily('1997-07-01', '2026-10-16', 100), '1980-01-02', '', TODAY, INDICATOR_SOURCE_FLOOR.kospi), []);

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
  const { parseFredGraphCsv, fillBefore, fillAfter, joinFedRate, isRecentRangeEnd } = I;
  const csv = 'observation_date,DFEDTARU\r\n2008-12-16,0.25\r\n2008-12-17,.\r\n2008-12-18,\r\n2026-10-16,3.75\r\n';
  eq('#21 fredgraph.csv 파싱(헤더·결측 . ·빈 칸·CRLF)', parseFredGraphCsv(csv), { '2008-12-16': 0.25, '2026-10-16': 3.75 });
  eq('#22 옛 헤더(DATE)도', parseFredGraphCsv('DATE,DGS10\n2004-01-02,4.38\n'), { '2004-01-02': 4.38 });
  eq('#23 빈·손상 입력', [parseFredGraphCsv(''), parseFredGraphCsv(null)], [{}, {}]);

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
  ok('#32 fillBefore 입력 불변', (() => { const p = { '2004-01-02': 1 }; fillBefore(p, { '2003-01-02': 2 }); return Object.keys(p).length === 1; })());
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트③ 배선 가드 ──');
const H = stripComments(src('api/history.ts'));
const IND = stripComments(src('api/indicators.ts'));
const M = stripComments(src('src/hooks/useMarketData.ts'));
const COV = src('src/indicatorCoverage.ts');
const SRCS = src('api/_indicatorSources.ts');

ok('#G1 FRED limit은 최대(100000) — 2000+오름차순은 최근 구간을 자른다', /limit:\s*'100000'/.test(H) && !/limit:\s*'2000'/.test(H));
ok('#G2 FRED 키 없음/실패 → fredgraph.csv 폴백(히스토리)', /fetchFredApiHistory\(seriesId, d1, d2, timeoutMs\)[\s\S]{0,200}fetchFredGraphHistory\(seriesId, d1, d2, timeoutMs\)/.test(H)
  && /fred\.stlouisfed\.org\/graph\/fredgraph\.csv/.test(H) && /parseFredGraphCsv\(await res\.text\(\)\)/.test(H));
ok('#G3 실시간 기준금리도 fredgraph.csv 폴백', /fred\.stlouisfed\.org\/graph\/fredgraph\.csv/.test(IND) && /parseFredGraphCsv\(await res\.text\(\)\)/.test(IND));
ok('#G4 기준금리 = DFEDTAR(~2008-12-15) + DFEDTARU 이음', /fetchFredHistory\('DFEDTARU'/.test(H) && /fetchFredHistory\('DFEDTAR', d1/.test(H) && /joinFedRate\(legacy, upper\)/.test(H));
ok('#G5 US10Y 최신 꼬리를 Naver로 보충', /fillAfter\(data, tail\)/.test(H) && /fetchNaverBondHistory\('US10YT=RR', shiftYmd\(ymd\(last\), 1\)/.test(H));
ok('#G6 KR10Y 앞쪽을 FRED 월별로 보충', /fetchFredHistory\('IRLTLT01KRM156N', d1, shiftYmd\(ymd\(first\), -1\)/.test(H) && /fillBefore\(data, head\)/.test(H));
ok('#G7 USDKRW 앞쪽을 FRED DEXKOUS로 보충', /key === 'usdkrw'/.test(H) && /fetchFredHistory\('DEXKOUS'/.test(H));
ok('#G8 최근 종료 요청은 짧게 캐시', /csvResponse\(data, recent\)/.test(H) && /s-maxage=3600/.test(H) && /isRecentRangeEnd\(d2,/.test(H));
ok('#G9 Naver 채권 이력 청크 역순 수집(진전 없으면 종료)', /earliest >= chunkEnd\) break;/.test(H) && /chunkEnd = shiftYmd\(earliest, -1\);/.test(H));
ok('#G10 국내금 페이지 커서 모드(page·pages·stop → data·next·done)', /searchParams\.get\('page'\)/.test(H) && /JSON\.stringify\(\{ data, next, done \}\)/.test(H));
ok('#G11 훅: 커버리지 계산·병합은 공용 순수 함수', /indicatorMissingSegments\(hist, start, end, today, INDICATOR_SOURCE_FLOOR\[key\]\)/.test(M)
  && (M.match(/mergeIndicatorHistory\(prev/g) || []).length >= 2);
ok('#G12 훅: 구간 키 단위 세션 가드 + 새로고침만 꼬리 강제', /const forced = opts\.forceTail && seg\.kind === 'tail';/.test(M) && /if \(!forced && coverageGuardRef\.current\.has\(g\)\) continue;/.test(M));
ok('#G13 훅: Drive 로드 뒤 1회 · 조회기간 변경 · 새로고침 3개 트리거', /coverageReadyRef\.current = true;[\s\S]{0,200}ensureIndicatorCoverage\(\);/.test(M)
  && /\}, \[appliedRange\?\.start, appliedRange\?\.end\]\);/.test(M)
  && /if \(fresh && coverageReadyRef\.current\) ensureIndicatorCoverage\(\{ forceTail: true \}\);/.test(M));
ok('#G14 훅: MARKET 파일을 직접 쓰지 않는다(App 자동 저장 게이트 경유)', !/saveDriveFile\(/.test(M));
ok('#G15 훅: 국내금은 조회 시작일까지 페이지를 이어 받는다', /&stop=\$\{stop\}/.test(M) && /if \(!\(json\.next > page\)\) break;/.test(M));
ok('#G16 순수 모듈은 import 0건', !/^\s*import\s/m.test(COV) && !/^\s*import\s/m.test(SRCS));

// ── 2026-10: 지수 3종도 같은 보충 경로 ──
const MI = stripComments(src('src/components/MarketIndicators.tsx'));
// 패널은 같은 13개를 두 곳(표시 목록·검증 표)에서 나열한다 — 중복을 걷어 '어떤 항목이 있는가'만 센다
const panelKeys = [...new Set([...MI.matchAll(/label:\s*'[^']+',\s*key:\s*'(\w+)'/g)].map(m => m[1]))];
const covKeys = (COV.match(/INDICATOR_HISTORY_KEYS = \[([^\]]+)\]/) || [])[1];
const idxKeys = (COV.match(/MARKET_INDEX_KEYS = \[([^\]]+)\]/) || [])[1];
const covSet = new Set([...(covKeys || '').matchAll(/'(\w+)'/g), ...(idxKeys || '').matchAll(/'(\w+)'/g)].map(m => m[1]));
ok('#G17 패널의 모든 항목(13)이 커버리지 키 목록에 있다', panelKeys.length === 13 && panelKeys.every(k => covSet.has(k)));
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
