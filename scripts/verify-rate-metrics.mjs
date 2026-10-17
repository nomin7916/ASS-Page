#!/usr/bin/env node
// 금리 모니터링 계산 검증 — src/rateMetrics.ts 를 **직접 import**한다(미러 금지, 2026-10 4단계).
//   현재값·기준일 · 1개월 변화 · 52주 최고·최저 · 연중 위치 · 3년 백분위 · 구간 · 20일 고점 대비 꺾임
//   + 금리차·MBS 스프레드의 0·음수 보존 · 서버 응답(CSV/JSON) 해석 · 병합 · 현재값 붙이기 · 차트 행
// ⚠️ 이 모듈은 import 0건이라 Node가 타입만 벗겨 실행한다. 런타임이 .ts를 못 읽으면 명시적으로 건너뛴다.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const near = (name, got, want, tol = 1e-9) => ok(`${name} (got ${got}, want ${want})`, got != null && Math.abs(got - want) <= tol);
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want));

let M = null;
try { M = await import(pathToFileURL(join(ROOT, 'src/rateMetrics.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 계산 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/rateMetrics.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (M) {
  const { computeRateMetrics: calc, parseHistoryText, mergeSeries, withLive, buildRateChartRows, percentileOf, bandOf, seriesPoints, changeOverDays, roseWithinDays, fallingTogetherZones } = M;
  console.log('\n── 파트① 계산 ──');

  // 기본: 2026-01-01 ~ 2026-10-16 사이 몇 개 관측
  const s1 = { '2025-10-10': 4.0, '2026-01-02': 3.0, '2026-06-01': 5.0, '2026-09-15': 4.2, '2026-10-16': 4.5 };
  const m1 = calc(s1);
  eq('#1 현재값·기준일 = 가장 최근 관측', [m1.current, m1.asOf], [4.5, '2026-10-16']);
  near('#2 1개월 변화 = 현재 − 30일 전(그날 또는 직전 관측)', m1.change1m, 4.5 - 4.2);
  eq('#3 52주 최고·최저(기준일 365일 이내)', [m1.high52, m1.low52], [5.0, 3.0]);
  near('#4 연중 위치 = (현재 − 최저) ÷ (최고 − 최저) × 100', m1.position52, (4.5 - 3.0) / (5.0 - 3.0) * 100);
  // 3년 백분위: 4.0 3.0 5.0 4.2 4.5 중 4.5보다 작은 것 3개 + 같은 것 1개의 절반 → 3.5/5 = 70
  near('#5 3년 백분위(작은 개수 + 같은 개수 절반) ÷ 전체', m1.pct3y, 70);
  eq('#6 구간 — 70 이상은 높음', m1.band, 'high');
  eq('#7 구간 경계 — 0~30 낮음 / 30~70 보통 / 70~100 높음', [bandOf(0), bandOf(29.9), bandOf(30), bandOf(69.9), bandOf(70), bandOf(100), bandOf(null)], ['low', 'low', 'mid', 'mid', 'high', 'high', null]);

  // 52주 밖 값은 최고·최저에서 빠진다
  const m2 = calc({ '2025-01-02': 9.9, '2025-11-01': 2.0, '2026-10-16': 3.0 });
  eq('#8 52주 밖(2025-01-02)은 최고·최저 제외', [m2.high52, m2.low52], [3.0, 2.0]);

  // 꺾임: 최근 20개 관측의 최고보다 현재가 낮으면 true
  const up = {}; for (let i = 0; i < 25; i++) up[`2026-09-${String(i + 1).padStart(2, '0')}`] = 1 + i * 0.1;
  ok('#9 계속 오르면 꺾임 아님', calc(up).turnedDown === false);
  const turned = { ...up, '2026-09-26': 2.0 };
  ok('#10 20일 고점(3.4) 대비 내려오면 꺾임', calc(turned).turnedDown === true && Math.abs(calc(turned).high20 - 3.4) < 1e-9);

  // 금리차 — 음수도 정상값
  const sp = { '2026-01-02': -0.5, '2026-05-01': 0, '2026-09-10': 0.3, '2026-10-16': -0.2 };
  const ms = calc(sp);
  eq('#11 금리차 음수 현재값·최저 보존', [ms.current, ms.low52, ms.high52], [-0.2, -0.5, 0.3]);
  near('#12 음수 구간 연중 위치', ms.position52, (-0.2 - -0.5) / (0.3 - -0.5) * 100);
  near('#13 음수 포함 백분위(−0.5 하나 작음 · 같음 1개 절반)', ms.pct3y, (1 + 0.5) / 4 * 100);

  // 경계·손상 입력
  eq('#14 빈 입력은 전부 null', [calc({}).current, calc(null).asOf, calc(undefined).pct3y], [null, null, null]);
  ok('#15 최고 = 최저(변화 없음)이면 연중 위치 null', calc({ '2026-10-01': 1, '2026-10-02': 1 }).position52 === null);
  eq('#16 손상 값(null·빈 문자열·NaN·불리언)은 버리고 0·음수는 보존', seriesPoints({ '2026-01-01': null, '2026-01-02': '', '2026-01-03': 'x', '2026-01-04': true, '2026-01-05': 0, '2026-01-06': -1, bad: 3 }), [['2026-01-05', 0], ['2026-01-06', -1]]);
  ok('#17 percentileOf 빈 배열은 null', percentileOf([], 1) === null);
  near('#18 자료 기간(년) — 하이일드처럼 짧은 자료', calc({ '2023-10-17': 9.2, '2026-10-16': 7.0 }).coverageYears, 3.0, 0.05);

  console.log('\n── 파트② 서버 응답·병합·차트 ──');
  eq('#19 CSV(Date,Close) 해석 — 0 이하도 보존', parseHistoryText('Date,Close\n2026-10-15,4.1\n2026-10-16,-0.2\nbad,1\n'), { '2026-10-15': 4.1, '2026-10-16': -0.2 });
  eq('#20 JSON(금리차·MBS) 해석', parseHistoryText('{"2026-10-15":-0.71,"2026-10-16":0}'), { '2026-10-15': -0.71, '2026-10-16': 0 });
  eq('#21 손상 JSON·빈 응답은 빈 결과', [parseHistoryText('{bad'), parseHistoryText('')], [{}, {}]);
  const base = { '2026-10-15': 1 };
  ok('#22 병합 — 바뀐 게 없으면 같은 참조', mergeSeries(base, { '2026-10-15': 1 }) === base);
  eq('#23 병합 — 새 날짜 추가·같은 날짜는 새 값', mergeSeries(base, { '2026-10-15': 2, '2026-10-16': -1 }), { '2026-10-15': 2, '2026-10-16': -1 });
  eq('#24 현재값 — 기록 최신일 이후 날짜면 끝에 붙인다', withLive({ '2026-10-15': 4.1 }, 4.2, '2026-10-16'), { '2026-10-15': 4.1, '2026-10-16': 4.2 });
  eq('#25 현재값 — 기록보다 이른 날짜면 무시', withLive({ '2026-10-15': 4.1 }, 4.0, '2026-10-14'), { '2026-10-15': 4.1 });
  eq('#26 현재값 — 음수 금리차도 붙인다 / 값 없음은 무시', [withLive({}, -0.3, '2026-10-16'), withLive({ a: 1 }, null, '2026-10-16')], [{ '2026-10-16': -0.3 }, { a: 1 }]);
  const sx = { '2026-07-01': 4.0, '2026-07-20': 4.3, '2026-09-01': 4.6, '2026-10-16': 4.5 };
  near('#28 N일 변화 = 현재 − (기준일 − N일)의 그날 또는 직전 값', changeOverDays(sx, 90), 4.5 - 4.0);
  eq('#28b 그보다 오래된 자료가 없으면 null', changeOverDays({ '2026-10-16': 1 }, 90), null);
  eq('#29 최근 60일 안의 인상 여부 — 9/1 인상 있음 / 30일로 좁히면 없음', [roseWithinDays(sx, 60), roseWithinDays(sx, 30)], [true, false]);
  eq('#29b 관측 2개 미만이면 null(모름)', roseWithinDays({ '2026-10-16': 15 }, 60), null);
  // 매수 기회 구간 — 세 기록이 모두 30일 전보다 낮은 날짜(첫 기록의 관측일만)
  const lin = (from, n, f) => { const o = {}; for (let i = 0; i < n; i++) o[new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10)] = f(i); return o; };
  const down = lin('2026-01-01', 120, i => 100 - i), rise = lin('2026-01-01', 120, i => 100 + i);
  const vee = lin('2026-01-01', 120, i => (i < 60 ? 100 - i : 40 + (i - 60) * 2));
  eq('#30 셋 다 계속 하락 → 30일 뒤부터 끝까지 한 구간', fallingTogetherZones([down, down, down], 30), [['2026-01-31', '2026-04-30']]);
  eq('#30b 하나라도 오르면 구간 없음', fallingTogetherZones([down, rise, down], 30), []);
  eq('#30c V자(60일째 바닥) — 바닥 뒤 반등 폭이 30일 전 값을 넘기 전까지만', fallingTogetherZones([down, vee, down], 30), [['2026-01-31', '2026-03-11']]);
  eq('#30d 시작일 이후만 · 관측 3개 미만 구간 버림', [fallingTogetherZones([down, down, down], 30, '2026-04-29'), fallingTogetherZones([down, down, down], 30, '2026-04-20')], [[], [['2026-04-20', '2026-04-30']]]);
  eq('#30e 빈 기록이 있으면 없음', fallingTogetherZones([down, {}, down], 30), []);
  const gap = lin('2026-01-01', 120, i => (i >= 70 && i <= 72 ? 200 : 100 - i));
  eq('#30f 5일 이하 끊김은 잇는다 · 그보다 길면 나눈다', [fallingTogetherZones([down, gap, down], 30).length], [1]);
  eq('#27 차트 행 — 날짜 합집합 · 빈 값 null · 시작일 이후만',
    buildRateChartRows({ a: { '2026-10-01': 1, '2026-10-03': 3 }, b: { '2026-10-02': -2 } }, ['a', 'b'], '2026-10-02'),
    [{ date: '2026-10-02', a: null, b: -2 }, { date: '2026-10-03', a: 3, b: null }]);
}

console.log('\n── 파트③ 배선 가드 ──');
{
  const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const RM = src('src/rateMetrics.ts');
  const RW = src('src/components/RateWindow.tsx');
  ok('#G1 순수 모듈은 import 0건', !/^\s*import\s/m.test(RM));
  ok('#G2 창은 계산을 rateMetrics에서만 가져온다', /from '\.\.\/rateMetrics'/.test(RW) && /computeRateMetrics\(seriesByKey\[k\]\)/.test(RW));
  ok('#G3 창은 서버 경로를 직접 부른다(현재값·과거치)', /fetch\('\/api\/indicators'/.test(RW) && /\/api\/history\?key=\$\{key\}&start=/.test(RW));
  ok('#G4 받은 자료를 브라우저 저장소에 두지 않는다', !/localStorage|sessionStorage/.test(RW));
  ok('#G5 키 13개 전부 정의', ['fedRate', 'us3m', 'us2y', 'us10y', 'us30y', 't10y2y', 't10y3m', 'hyYield', 'hySpread', 'mort30', 'mbsSpread', 'move', 'kr10y']
    .every(k => new RegExp(`\\b${k}:\\s*\\{ label:`).test(RW)));
  ok('#G7 MBS 차트 매수 기회 — 2년 금리·MBS 스프레드·AGNC 주가(3년)가 모두 30일 전보다 낮은 구간을 초록 칸으로 · 접히는 활용법',
    /fallingTogetherZones\(\[seriesByKey\.mbsSpread, seriesByKey\.us2y, agncLong\], MBS_ZONE_DAYS, fromChart\)/.test(RW) && /import \{ changeOverDays, roseWithinDays, fallingTogetherZones \} from '\.\.\/rateMetrics';/.test(RW)
    && /fetchWatchDaily\('us', 'AGNC', shiftIsoDays\(today, -3 \* 365 - 45\)\)/.test(RW) && /<ReferenceArea key=\{`mz-\$\{a\}`\} yAxisId="left" x1=\{a\} x2=\{b\}/.test(RW)
    && /지표 활용법 · 모기지 채권\(AGNC\) 영향/.test(RW) && /\{footer\}/.test(RW) && !/localStorage|sessionStorage/.test(RW));
  ok('#G6 기간을 늘리면 모자란 앞쪽만 더 받는다', /if \(have && have <= from\) return \[k, null, true\];/.test(RW) && /const to = have \? shiftIsoDays\(have, -1\) : today;/.test(RW));
  ok('#G7 권한 확인 전엔 내용을 그리지 않는다(fail-closed)', /useState\('pending'\)/.test(RW) && /이 페이지를 사용할 권한이 없습니다/.test(RW));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:rate-metrics — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
