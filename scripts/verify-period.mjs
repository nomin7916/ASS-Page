#!/usr/bin/env node
// 평가액 추이 표 기간 단위(일간/주간/월간/연간) 검증.
//
// 구성 ①  src/utils.ts 를 **직접 import** 해 순수 함수를 테스트한다(미러 금지 — 미러는
//        src에만 넣은 변경/미러에만 넣은 변경이 둘 다 통과하는 구멍을 만든다. 실측 사고:
//        verify-backtest의 rebalMode 3필드 누락). utils.ts는 import가 하나도 없어
//        Node가 타입만 벗겨 실행할 수 있다(verify:cal-detail #D1·verify:card-window 선례).
// 구성 ②  소스 텍스트 가드 — 배선은 산술로 표현할 수 없다. **선언이 아니라 사용부**를 단언한다.
//        실패 시 먼저 정규식이 낡았는지 확인하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
const near = (label, a, b, tol = 1e-9) => ok(`${label} (${a} ≈ ${b})`, Math.abs(a - b) <= tol);

// 금지 토큰 검사는 **주석을 걷어낸 뒤** 한다 — 이 저장소는 금지 이유를 바로 그 자리 주석에
// 적으므로, 원문으로 재면 주석 속 토큰이 유령 사용으로 잡혀 가드가 영구히 실패한다.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\n── 파트① 순수 함수 (src/utils.ts 직접 import) ──');

let U = null;
try {
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
} catch (e) {
  console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code || e.message}).`);
}

if (U) {
  const { normalizeHistPeriod, periodBucketKey, compressPeriodRows, periodRangeLabel,
          periodNoun, accumulateDailySeries, computeDailyMetricsSeries,
          computeCumulativeTwrSeries, rebaseTwr } = U;

  // ── normalizeHistPeriod — 화이트리스트 ──
  eq('#1 day', normalizeHistPeriod('day'), 'day');
  eq('#1b week/month/year 통과', [normalizeHistPeriod('week'), normalizeHistPeriod('month'), normalizeHistPeriod('year')], ['week', 'month', 'year']);
  // ⚠️ 손상값은 전부 'day'. 저장·복원·창 수신 3경로가 이걸 통과시켜야 세그먼트가 '눌린 것 없음'이 되지 않는다.
  eq('#1c 손상값은 전부 day', ['weke', '', null, undefined, true, 3, {}].map(normalizeHistPeriod), ['day','day','day','day','day','day','day']);

  // ── periodBucketKey — 주 경계는 월요일 시작(사용자 확정) ──
  eq('#2 금요일 → 그 주 월요일', periodBucketKey('2026-08-21', 'week'), '2026-08-17');
  eq('#2b 일요일 → 같은 주 월요일(일요일이 주의 끝)', periodBucketKey('2026-08-16', 'week'), '2026-08-10');
  eq('#2c 월요일 → 자기 자신', periodBucketKey('2026-08-17', 'week'), '2026-08-17');
  eq('#2d 연초 목요일 → 전년 12월 월요일', periodBucketKey('2026-01-01', 'week'), '2025-12-29');
  eq('#3 month', periodBucketKey('2026-08-21', 'month'), '2026-08');
  eq('#3b year', periodBucketKey('2026-08-21', 'year'), '2026');
  eq('#3c day/미지는 날짜 그대로', [periodBucketKey('2026-08-21', 'day'), periodBucketKey('2026-08-21', 'zz')], ['2026-08-21', '2026-08-21']);
  eq('#3d 손상 날짜도 던지지 않는다', [periodBucketKey('', 'week'), periodBucketKey(null, 'month'), periodBucketKey('26-8-1', 'week')], ['', '', '26-8-1']);

  // ── compressPeriodRows ──
  const mk = (d, v) => ({ date: d, evalAmount: v });
  const asc = [
    mk('2026-08-10', 100), mk('2026-08-14', 110), mk('2026-08-16', 120),   // 8/10 주 (월~일)
    mk('2026-08-17', 130), mk('2026-08-21', 140),                          // 8/17 주 (진행 중)
  ];
  // ⚠️ 하위호환의 축 — day/미지의 값은 **입력 배열을 그대로(참조 동일)** 반환한다.
  //    'day만 항등'으로 되돌리면 prop 누락·손상 Drive 값이 조용한 1행 붕괴가 된다.
  ok('#4 day는 참조 동일', compressPeriodRows(asc, 'day') === asc);
  ok('#4b 미지의 값도 참조 동일(fail-safe)', compressPeriodRows(asc, 'weke') === asc && compressPeriodRows(asc, undefined) === asc);

  const wk = compressPeriodRows(asc, 'week');
  eq('#5 주 단위 2행', wk.length, 2);
  eq('#5b 각 주의 **마지막** 기록이 대표', wk.map(r => r.date), ['2026-08-16', '2026-08-21']);
  eq('#5c periodStart/End', [wk[0].periodStart, wk[0].periodEnd], ['2026-08-10', '2026-08-16']);
  eq('#5d periodCount', wk.map(r => r.periodCount), [3, 2]);
  eq('#5e 원본 필드 보존', wk[1].evalAmount, 140);
  // ⚠️ 합성 날짜(달력상 말일 등)를 만들지 않는다 — 없는 날짜를 대표로 쓰면 buildCloseEvalSeries·
  //    bookByDate 조회가 miss돼 저장 라이브값으로 조용히 폴백한다.
  ok('#5f 대표 날짜는 실제 기록일', wk.every(r => asc.some(a => a.date === r.date)));
  eq('#6 월 단위는 1행(전부 8월)', compressPeriodRows(asc, 'month').map(r => r.date), ['2026-08-21']);
  eq('#6b 빈 입력', compressPeriodRows([], 'week').length, 0);
  eq('#6c null 안전', compressPeriodRows(null, 'week').length, 0);
  eq('#6d date 없는 행은 버린다', compressPeriodRows([{ evalAmount: 1 }, mk('2026-08-21', 2)], 'week').map(r => r.date), ['2026-08-21']);

  // ── periodRangeLabel ──
  eq('#7 주 라벨', periodRangeLabel(wk[1], 'week'), '8/17~8/21');
  eq('#7b 한 건뿐인 주', periodRangeLabel({ periodStart: '2026-08-17', periodEnd: '2026-08-17', date: '2026-08-17' }, 'week'), '8/17');
  eq('#7c 월/연 라벨', [periodRangeLabel({ periodKey: '2026-08', date: '2026-08-21' }, 'month'), periodRangeLabel({ periodKey: '2026', date: '2026-08-21' }, 'year')], ['2026-08', '2026년']);
  eq('#7d 손상 입력', periodRangeLabel(null, 'week'), '');

  // ── periodNoun ──
  eq('#8 문구', [periodNoun('week').prev, periodNoun('month').unit, periodNoun('year').span, periodNoun('day').prev], ['전주', '월간', '그 해', '전일']);

  // ── accumulateDailySeries — 기간 표의 유일한 산식 소스 ──
  // rows: 흐름 0인 순수 시장 변동 5일
  const rows = [
    { date: '2026-08-17', evalAmount: 1000, flowIn: 0, flowOut: 0 },
    { date: '2026-08-18', evalAmount: 1100, flowIn: 0, flowOut: 0 },
    { date: '2026-08-19', evalAmount: 1210, flowIn: 0, flowOut: 0 },
    { date: '2026-08-20', evalAmount: 1210, flowIn: 0, flowOut: 0 },
    { date: '2026-08-21', evalAmount: 1331, flowIn: 0, flowOut: 0 },
  ];
  const metrics = computeDailyMetricsSeries(rows);
  const dates = rows.map(r => r.date);
  const accm = accumulateDailySeries(dates, metrics);

  // #9 누적 손익 = 일별 손익의 합
  const sumProfit = dates.reduce((s, d) => s + (metrics.get(d)?.dodAbsChange ?? 0), 0);
  near('#9 누적 손익 = 일별 합', accm.profit.get('2026-08-21'), sumProfit);
  near('#9b 첫 행 누적 손익 0', accm.profit.get('2026-08-17'), 0);

  // #10 ⚠️ **차트와 같은 값이어야 한다** — computeCumulativeTwrSeries와 배율 갱신 규칙이
  //     문자 그대로 같지 않으면 같은 날짜에 표와 차트가 갈린다.
  const twrRef = computeCumulativeTwrSeries(rows);
  ok('#10 누적 TWR이 computeCumulativeTwrSeries와 완전 일치',
    dates.every(d => Math.abs((accm.twr.get(d) ?? 0) - (twrRef.get(d) ?? 0)) < 1e-9));

  // #11 기간 차분 항등식 — 기간 손익 = 그 기간 일별 손익의 합
  const pStart = '2026-08-18', pEnd = '2026-08-21';
  const periodProfit = accm.profit.get(pEnd) - accm.profit.get(pStart);
  const dailySum = dates.filter(d => d > pStart && d <= pEnd)
    .reduce((s, d) => s + (metrics.get(d)?.dodAbsChange ?? 0), 0);
  near('#11 기간 손익 = 구간 일별 손익 합', periodProfit, dailySum);

  // #12 기간 수익률 = 구간 일별 배율의 곱 − 1
  const periodRate = rebaseTwr(accm.twr.get(pEnd), accm.twr.get(pStart));
  const chain = dates.filter(d => d > pStart && d <= pEnd)
    .reduce((f, d) => { const m = metrics.get(d); return f * (1 + ((m && m.dodAbsChange != null) ? (m.dodChange || 0) : 0) / 100); }, 1);
  near('#12 기간 수익률 = 일별 배율 곱', periodRate, (chain - 1) * 100, 1e-9);

  // #13 held 행 처리 — dodAbsChange == null 이면 손익 누적 없음 + 배율 1.0 유지
  const heldMetrics = new Map([
    ['d1', { dodAbsChange: null, dodChange: 0 }],
    ['d2', { dodAbsChange: 50, dodChange: 5 }],
    ['d3', { dodAbsChange: null, dodChange: 999 }],   // held인데 dodChange가 남아 있어도 무시해야 한다
    ['d4', { dodAbsChange: 20, dodChange: 2 }],
  ]);
  const h = accumulateDailySeries(['d1', 'd2', 'd3', 'd4'], heldMetrics);
  eq('#13 held는 손익에 기여하지 않는다', [h.profit.get('d1'), h.profit.get('d2'), h.profit.get('d3'), h.profit.get('d4')], [0, 50, 50, 70]);
  near('#13b held는 배율 1.0(직전값 유지)', h.twr.get('d3'), h.twr.get('d2'));
  near('#13c held의 dodChange는 무시된다', h.twr.get('d4'), ((1.05 * 1.02) - 1) * 100, 1e-9);

  // #14 −100% 방어 — 곱이 0이 되면 이후 전 구간이 영구 고정된다(computeCumulativeTwrSeries와 동일 가드)
  const wipe = new Map([['a', { dodAbsChange: 10, dodChange: 10 }], ['b', { dodAbsChange: -1, dodChange: -100 }], ['c', { dodAbsChange: 5, dodChange: 5 }]]);
  const w = accumulateDailySeries(['a', 'b', 'c'], wipe);
  ok('#14 −100% 행이 배율을 0으로 만들지 않는다', w.twr.get('c') > 0);

  // #15 손상 입력 방어
  eq('#15 빈 날짜 배열', accumulateDailySeries([], metrics).profit.size, 0);
  eq('#15b null 안전', [accumulateDailySeries(null, null).profit.size, accumulateDailySeries(['x'], null).twr.get('x')], [0, 0]);

  // #16 ⚠️ 대형 입금일 중립 — 기간 값이 입출금 규모에 무관해야 한다(이 기능의 존재 이유).
  //     일별 지표가 이미 흐름을 제거하므로 누적 차분도 자동으로 중립이다.
  const flowRows = [
    { date: 'f1', evalAmount: 1000, flowIn: 0, flowOut: 0 },
    { date: 'f2', evalAmount: 1010, flowIn: 0, flowOut: 0 },
    { date: 'f3', evalAmount: 51020, flowIn: 50000, flowOut: 0, bookDelta: 50000 },  // 대형 입금 + 시장 +10
    { date: 'f4', evalAmount: 51530, flowIn: 0, flowOut: 0 },
  ];
  const fm = computeDailyMetricsSeries(flowRows);
  const fa = accumulateDailySeries(flowRows.map(r => r.date), fm);
  near('#16 입금 ₩50,000이 기간 손익에 섞이지 않는다', fa.profit.get('f4') - fa.profit.get('f1'), 10 + 10 + 510, 1e-6);
}

console.log('\n── 파트② 소스 텍스트 가드 ──');

const utils = read('src/utils.ts');
const intHook = read('src/hooks/useIntegratedData.ts');
const intDash = read('src/components/IntegratedDashboard.tsx');
const hist = read('src/components/HistoryPanel.tsx');
const app = read('src/App.tsx');
const cardWin = read('src/components/CardWindow.tsx');
const cardFeed = read('src/components/CardWinFeed.tsx');
const cardMod = read('src/cardWindow.ts');

// #G1 ⚠️ 공유 단일 소스를 제자리 압축하지 않는다. intMonthlyHistory를 압축하면 메모 달력이
//     주/월당 한 칸만 스냅샷을 그리고(ASSET 패드의 유일한 진입점), realtimeDate가 오늘이 아니게 돼
//     "달력 칸 총자산 = 팝업 소계 = 차트 그날 값" 불변식이 깨진다.
ok('#G1 useIntegratedData는 압축 함수를 쓰지 않는다(공유 소스 보존)',
  !/compressPeriodRows/.test(stripComments(intHook)));

// #G2 ⚠️ 압축 행을 computeDailyMetricsSeries에 재투입 금지 — 그 함수의 상수·bookDelta 관측이
//     전부 '하루치' 스케일 가정이라 기간 입력에서 동시에 무너진다(실측 4종).
const dashNoC = stripComments(intDash);
ok('#G2 통합 표는 computeDailyMetricsSeries를 부르지 않는다',
  !/computeDailyMetricsSeries/.test(dashNoC));
ok('#G2b 통합 표는 누적 차분(intTwrCumByDate)을 쓴다',
  /intTwrCumByDate\?\.cumProfit/.test(dashNoC) && /rebaseTwr\(/.test(dashNoC));

// #G3 개별 계좌: dailyMetricsByDate(일별)는 그대로 두고 그 위에 누적을 얹는다
const histNoC = stripComments(hist);
ok('#G3 개별 계좌 periodMetrics는 accumulateDailySeries + rebaseTwr을 쓴다',
  /accumulateDailySeries\(\s*asc\.map/.test(histNoC) && /rebaseTwr\(t,\s*tP\)/.test(histNoC));
ok('#G3b computeDailyMetricsSeries 호출은 일별 경로 1곳뿐',
  (histNoC.match(/computeDailyMetricsSeries\(/g) || []).length === 1);
// ⚠️ cumulativeByDate·displayEvalByDate에 압축본을 넘기면 principalManual 앵커·직전 principal
//    역스캔이 드롭된 날짜를 못 봐 차트와 표의 누적 수익률이 갈린다.
ok('#G3c cumulativeByDate는 전체 이력(sortedHistoryDesc)을 쓴다',
  /const cumulativeByDate = useMemo\(\(\) => \{\s*const asc = \[\.\.\.sortedHistoryDesc\]\.reverse\(\);/.test(histNoC));
ok('#G3d displayEvalByDate도 전체 이력을 쓴다',
  /buildCloseEvalSeries\(activePortfolio, evalSeriesDates\(activePortfolio, sortedHistoryDesc\.map/.test(histNoC));

// #G4 렌더 소스가 압축 배열로 바뀌었다(사용부 단언 — 선언만 보면 죽은 단언이 된다)
ok('#G4 통합 표 tbody가 histRows를 그린다', /\{histRows\.map\(\(h, i\) =>/.test(dashNoC));
ok('#G4b 통합 빈 상태도 histRows 기준', /\{histRows\.length === 0 &&/.test(dashNoC));
ok('#G4c 개별 표 tbody가 viewRows를 그린다', /\{viewRows\.map\(\(h, i\) => \{/.test(histNoC));

// #G5 ⚠️ hasPrev는 **화면 행** 기준. 원본 배열로 재면 기간 모드의 가장 오래된 행(구조적으로 '-')에
//     '입출금 불일치로 보류'라는 거짓 사유가 붙는다.
ok('#G5 hasPrev가 viewRows 기준', /const hasPrev = i < viewRows\.length - 1;/.test(histNoC));

// #G6 ⚠️ '오늘' 하이라이트는 인덱스 판정. 날짜 동등 비교는 (a) 통합이 UTC라 KST 새벽에 어긋나고
//     (b) 개별 KR 계좌는 effectiveDateKey가 21~09시 null이며 (c) 월/연 첫날엔 현재 기간 행이 없다.
// ⚠️ '오늘'은 달력상 오늘이 아니라 **최신 기록일**이다 — 행 날짜의 출처(computedIntHistory)가
//    getEffectiveDate() 기준이라 KST 00:00~07:30에는 전일인데, getTodayKST()와 비교하면 그
//    7.5시간 동안 어느 행도 칠해지지 않는다(CLAUDE.md 메모 달력 절의 latestRecDate 규약과 동일).
ok('#G6 통합 오늘 판정 = 인덱스 + 최신 기록일', /isHistPeriodMode \? i === 0 : h\.date === latestRecDate/.test(dashNoC));
ok('#G6b 통합에서 UTC 비교가 사라졌다', !/new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/.test(dashNoC));
ok('#G6d 달력상 오늘(getTodayKST) 비교가 없다', !/getTodayKST\(\)/.test(dashNoC));
ok('#G6e latestRecDate는 헤더 카드와 같은 행을 가리킨다',
  /const latestRecDate = intMonthlyHistory\.length > 0 \? intMonthlyHistory\[0\]\.date : '';/.test(dashNoC));
ok('#G6c 개별 오늘 판정 = 인덱스', /isPeriodMode \? i === 0 : h\.date === effectiveDateKey/.test(histNoC));

// #G7 ⚠️ '사용자가 손댔는가'는 범위 OR(대표일만 보면 거짓 음성 — 그 기간의 수동 개입이 화면에서 사라진다)
ok('#G7 배지는 periodModifiedCount 범위 집계', /\(h\.periodModifiedCount \|\| 0\) > 0/.test(histNoC));
// ⚠️ 일자 색상만 범위 집계로 고치고 '조정됨' 배지를 대표일만 보게 두면 같은 셀 안에서 모순되고
//    도움말('그 달 안에 조정된 기록이 있으면 표시')이 거짓이 된다.
ok('#G7b 조정됨 배지도 범위 집계', /\(h\.periodAdjustedCount \|\| 0\) > 0/.test(histNoC));
ok('#G7c 조정 집계는 isAdjusted 단독(수량·종가 편집과 의미가 다르다)',
  /if \(asc\[k\]\.isAdjusted\) adjusted \+= 1;/.test(histNoC));

// #G8 chartPrefs 영속화 5지점 — ②와 ③ 둘 다 없으면 조용한 유실(저장 미예약 / STATE write 스킵)
const appNoC = stripComments(app);
ok('#G8 ① state 리터럴', /chartPrefs: \{[^}]*intHistPeriod, acctHistPeriod/.test(appNoC));
const depLines = appNoC.split('\n').filter(l => /intHistPeriod, acctHistPeriod/.test(l) && /\}, \[/.test(l));
ok('#G8b ②③ effect deps 2곳', depLines.length === 2);
ok('#G8c ④⑤ 로드 2경로 모두 정규화 통과',
  (appNoC.match(/setIntHistPeriod\(normalizeHistPeriod\(stateData\.chartPrefs\.intHistPeriod\)\)/g) || []).length === 2 &&
  (appNoC.match(/setAcctHistPeriod\(normalizeHistPeriod\(stateData\.chartPrefs\.acctHistPeriod\)\)/g) || []).length === 2);

// #G9 prop 배선 (한쪽이라도 빠지면 그 화면만 조용히 기본값으로 뜬다)
ok('#G9 App→IntegratedDashboard', /intHistPeriod=\{intHistPeriod\}/.test(appNoC) && /setIntHistPeriod=\{setIntHistPeriod\}/.test(appNoC));
ok('#G9b App→HistoryPanel', /histPeriod=\{acctHistPeriod\}/.test(appNoC) && /setHistPeriod=\{setAcctHistPeriod\}/.test(appNoC));
ok('#G9c HistoryPanel prop 기본값(렌더 지점이 둘이라 필수)', /histPeriod = 'day',/.test(hist));

// #G10 ⚠️ 별도 창: card:data는 **반복 푸시**다. 매번 적용하면 창에서 고른 기간이 앱 값으로 되돌아간다.
ok('#G10 창은 gotData 이전 1회만 시드', /if \(!gotDataRef\.current && d\.histPeriod !== undefined\) setHistPeriod\(normalizeHistPeriod\(d\.histPeriod\)\);/.test(cardWin));
ok('#G10b CARD_NEEDS 게이팅(전 카드 브로드캐스트 방지)', /if \(needs\.histPeriod\) payload\.histPeriod = histPeriod;/.test(cardFeed));
ok('#G10c stats만 histPeriod를 받는다', /stats: \{ prices: true, fetchStatus: true, histPeriod: true \}/.test(cardMod));
ok('#G10d 창 세그먼트는 저장되지 않음을 표기', /histPeriodNote="이 창의 기간 설정은 저장되지 않습니다/.test(cardWin));

// #G11 기존 가드가 여전히 성립하는지 (이 변경이 깨뜨리기 쉬운 3줄)
ok('#G11 verify:card-window #G14g 대상 줄 무손상',
  hist.includes('<CardExpandButton onExpand={onExpand} opened={cardWindowOpen} label="통계·히스토리" />'));
ok('#G11b verify:transfer #32 대상 문자열 무손상',
  hist.includes('buildCloseEvalSeries(activePortfolio, evalSeriesDates(activePortfolio,'));
{
  const i = intDash.indexOf('const histDetailRows = useMemo'), j = intDash.indexOf('// 앱 기록 시작일');
  const slice = i >= 0 && j > i ? intDash.slice(i, j) : '';
  ok('#G11c verify:cal-detail #G1 슬라이스에 신규 memo가 침범하지 않았다',
    slice.length > 100 && slice.length < 1500 && !/histRows/.test(slice) && !/rows\.push/.test(slice));
}

// #G12 ⚠️ 세그먼트 바를 넣었으면 카드 높이를 함께 올려야 한다 — 고정 높이 + overflow-hidden이라
//     안 올리면 바 높이만큼 표 행이 그대로 사라진다.
ok('#G12 개별 카드 높이 보정', /'h-\[552px\]' : 'h-\[392px\]'/.test(hist));
// ⚠️ 각 카드가 명시적 height라 items-stretch가 먹지 않는다 — HistoryPanel만 올리면 같은 행의
//    형제 카드(통계·입출금) 바닥이 32px 어긋난다(비해외 = 가장 흔한 화면에서만 드러난다).
ok('#G12b 형제 카드 높이도 함께 올라갔다',
  /'h-full min-h-\[520px\]' : 'h-\[392px\]'/.test(read('src/components/PortfolioStatsPanel.tsx')) &&
  (read('src/components/DepositPanel.tsx').match(/'h-full min-h-\[520px\]' : 'h-\[392px\]'/g) || []).length === 2);

// #G13 fail-safe: 화이트리스트가 아니면 원본 반환 (선언 + 두 호출부 모두)
ok('#G13 compressPeriodRows 화이트리스트',
  /if \(mode !== 'week' && mode !== 'month' && mode !== 'year'\) return rows;/.test(utils));
ok('#G13b 통합 호출부 fail-safe',
  /if \(intHistPeriod !== 'week' && intHistPeriod !== 'month' && intHistPeriod !== 'year'\) return intMonthlyHistory;/.test(dashNoC));
ok('#G13c 개별 호출부 fail-safe',
  /const isPeriodMode = histPeriod === 'week' \|\| histPeriod === 'month' \|\| histPeriod === 'year';/.test(histNoC) &&
  /if \(!isPeriodMode\) return sortedHistoryDesc;/.test(histNoC));

// #G14 ⚠️ 흐름 합산은 **부호 있는 합**(Math.abs 금지 — 음수 정정 행이 유입으로 뒤집히면 오차가 2배)
ok('#G14 통합 기간 흐름 합산에 Math.abs가 없다',
  /pIn \+= h\.netFlowIn \|\| 0; pOut \+= h\.netFlowOut \|\| 0; pLedger \+= h\.ledgerFlow \|\| 0;/.test(dashNoC));
// ⚠️ 압축 전 '대표일 하루치' 스칼라가 남으면 진단 문구가 기간 합이 아니라 하루치를 표시한다
ok('#G14b 압축 행의 흐름 필드를 명시적으로 덮어쓴다',
  /netFlowIn: pIn, netFlowOut: pOut, ledgerFlow: pLedger, netFlow: pLedger,/.test(dashNoC));

// #G15 문구 — 모드별 분기가 실제 렌더 지점에 붙어 있는가(선언이 아니라 사용부)
ok('#G15 통합 th가 periodNoun을 쓴다', /\{histNoun\.prev\}대비/.test(dashNoC) && /\{histNoun\.unit\} 손익/.test(dashNoC));
ok('#G15b 개별 th가 periodNoun을 쓴다', /\{noun\.unit\} 수익<\/th>/.test(histNoC));
// ⚠️ 이 문장은 모드와 무관하게 **지금도 거짓**이었다 — CLAUDE.md가 "입출금 금액 배지는 어느 화면에도
//    렌더하지 않는다"로 못 박았고 실제 셀도 '-' 또는 %만 렌더한다.
ok('#G15c 거짓 툴팁 문장이 제거됐다(주석 인용은 제외)', !/입출금이 있던 날은 아래에 금액이 표시됩니다/.test(dashNoC));

// #G16 ⚠️ '그 기간 전체가 보류'를 0.00%('변동 없음')로 단언하지 않는다.
//     누적이 갱신되지 않아 경계 차분이 정확히 0이 되므로 차분만으로는 구분할 수 없다 →
//     기여일 카운트(okCount/count) 차분이 0이면 '산출 불가'로 본다. 같은 순간 헤더 카드는 '-'다.
ok('#G16 통합: 기여일 카운트로 전 구간 보류 판정',
  /const n = okCount\?\.get\(r\.date\), nP = prev \? okCount\?\.get\(prev\.date\) : 0;/.test(dashNoC) &&
  /noBase = !prev \|\| cp == null \|\| cpP == null \|\| \(n != null && nP != null && n === nP\)/.test(dashNoC));
ok('#G16b 개별: 같은 규약', /noBase = !prev \|\| cp == null \|\| cpP == null \|\| \(c != null && cP != null && c === cP\)/.test(histNoC));
ok('#G16c utils가 count를 낸다', /return \{ profit, twr, count \};/.test(utils));
ok('#G16d 훅이 okCount를 낸다', /return \{ twr, cumProfit, okCount \};/.test(stripComments(intHook)));

// #G17 ⚠️ 해외계좌에서 '수익률 차트와 같은 기준'이라 단언하지 않는다 — 표는 원화 프레임,
//     차트(App.tsx accountTwrByDate)는 USD 프레임이라 구조적으로 다르다(KRW 계좌만 보면 안 드러난다).
ok('#G17 해외 프레임 분리 고지', /const isOverseasAcct = activePortfolioAccountType === 'overseas';/.test(histNoC) &&
  /isOverseasAcct \? '' : ' — 수익률 차트의 구간 수익률과 같은 기준입니다\.'/.test(histNoC));

// #G18 ⚠️ 일간 수익 셀 툴팁도 모드별로 갈린다 — 월간 값에 '일간 손익'이라 쓰고
//     '(당일 − 전일) ÷ 전일 과 동일'이라 단언하면 둘 다 거짓이다(기간 값은 일별 배율의 곱).
ok('#G18 셀 툴팁 라벨 모드 분기', /`\$\{noun\.unit\} 손익 \$\{formatCurrency\(dodProfit\)\}`/.test(histNoC));
ok('#G18b 항등식 문구 모드 분기', /일별 수익률의 곱과 동일/.test(histNoC));

// #G19 ⚠️ 도움말은 평문 렌더다(마크다운 파서 없음) — `**`를 쓰면 화면에 그대로 보인다.
ok('#G19 도움말에 마크다운 강조가 없다', !/\*\*대표일 하루\*\*/.test(hist));

// #G20 ⚠️ 흐름 합산은 단조 포인터로 O(n) — 루프 안에서 전체 배열을 다시 훑으면
//     주간 3년치에 회당 ~17만 회가 시세 갱신마다 돈다.
ok('#G20 흐름 합산 커서가 map 밖에 있다', /let fi = 0;\s*\n\s*const rows = packed\.map/.test(dashNoC));

// #G21 ⚠️ date 없는 이력 행이 커서를 영구 정지시키지 않는다(그 이후 전 기간의 표시가 조용히 사라진다).
ok('#G21 압축 입력에서 date 없는 행 제거',
  /const asc = \[\.\.\.sortedHistoryDesc\]\.reverse\(\)\.filter\(h => h\?\.date\);/.test(histNoC));

// #G22 ⚠️ 프레젠테이션 플래그도 데이터 경로와 같은 화이트리스트(fail-open 비대칭 방지).
ok('#G22 통합 isHistPeriodMode 화이트리스트',
  /const isHistPeriodMode = intHistPeriod === 'week' \|\| intHistPeriod === 'month' \|\| intHistPeriod === 'year';/.test(dashNoC));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
