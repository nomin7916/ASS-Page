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
          computeCumulativeTwrSeries, rebaseTwr, periodGapLines, periodRateGapLine,
          periodBucketSpan, periodBasisLines } = U;

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

  // ── periodGapLines / periodRateGapLine — 기간 셀 툴팁의 검산 분해 ──────────────
  // 사용자 확정(2026-08): 산식은 **그대로 두고** 왜 표의 평가금액 두 칸으로 검산이 안 맞는지를
  // 툴팁으로 설명한다. 실측 통합 데이터: 7월 대표 ₩774,826,963 → 8월 대표 ₩791,529,823,
  // 표시 월간 손익 ₩16,393,527. 차이 ₩16,702,860 중 ₩309,333이 그 기간 순입출금이다.
  const F = (v) => `₩${Math.round(v).toLocaleString('en-US')}`;
  const gl = periodGapLines({ prevEval: 774826963, curEval: 791529823, profit: 16393527, ledger: 309333, fmt: F, unit: '월간' });
  eq('#17 3줄 분해(평가금액 차이 / 순입출금 / 손익)', gl.length, 3);
  ok('#17b 첫 줄이 표의 두 평가금액을 그대로 보여준다',
    gl[0].includes('₩774,826,963') && gl[0].includes('₩791,529,823') && gl[0].includes('₩16,702,860'));
  ok('#17c 잔차가 원장과 일치할 때만 "순입출금"이라 부른다', gl[1].startsWith('− 순입출금') && gl[1].includes('₩309,333'));
  eq('#17d 마지막 줄이 표에 찍힌 손익과 같다', gl[2], `= 월간 손익 ${F(16393527)}`);

  // ⚠️ 잔차(ΔV − 손익)를 원장 순흐름이라 **단언하지 않는다** — 보류 이월·계좌 편입/이탈 경계가 섞인다.
  const gl2 = periodGapLines({ prevEval: 1000, curEval: 1100, profit: 60, ledger: 10, fmt: F, unit: '월간' });
  ok('#18 잔차 ≠ 원장이면 중립 표현', gl2[1].includes('입출금 등 시장 외 증감') && !gl2[1].includes('순입출금'));
  const gl3 = periodGapLines({ prevEval: 1000, curEval: 900, profit: 60, ledger: -160, fmt: F, unit: '월간' });
  ok('#18b 유출(잔차 음수)은 부호를 뒤집어 더한다', gl3[1].startsWith('+ 순입출금') && gl3[1].includes('₩160'));

  // 입출금이 없던 기간은 '차이가 곧 손익'이라 못 박는다(그 기간은 검산이 정확히 맞는다).
  const gl4 = periodGapLines({ prevEval: 1000, curEval: 1100, profit: 100, ledger: 0, fmt: F, unit: '월간' });
  eq('#19 흐름 0이면 2줄', gl4.length, 2);
  ok('#19b 둘째 줄이 "차이가 곧 손익"', gl4[1].includes('그 차이가 곧 월간 손익입니다'));

  // ⚠️ null 계약 — 산출 불가(보류 행)·첫 기간이면 아무 줄도 만들지 않는다(0으로 단언 금지).
  eq('#20 profit null이면 빈 배열', periodGapLines({ prevEval: 1000, curEval: 1100, profit: null, fmt: F, unit: '월간' }).length, 0);
  eq('#20b prevEval 없으면(첫 기간) 빈 배열', periodGapLines({ prevEval: null, curEval: 1100, profit: 10, fmt: F, unit: '월간' }).length, 0);
  eq('#20c 인자 전체 누락에도 던지지 않는다', periodGapLines({}).length, 0);

  // periodRateGapLine — 사용자의 검산(774,826,963 × 1.019 ≠ 791,529,823)에 직접 답한다.
  const rl = periodRateGapLine({ prevEval: 774826963, curEval: 791529823, rate: 1.90, unit: '월간' });
  ok('#21 단순 비교 %를 소수 2자리로 제시', rl.includes('+2.16%'));
  ok('#21b 왜 다른지(입금이 분모=시작 자산에 더해짐)를 말한다', rl.includes('시작 자산'));

  // ⚠️ 두 값이 사실상 같으면 줄을 만들지 않는다 — 맞는 값에 해명을 붙이면 오히려 오해를 부른다.
  eq('#22 흐름 없는 기간은 해명 줄 없음', periodRateGapLine({ prevEval: 1000, curEval: 1100, rate: 10, unit: '월간' }), '');
  ok('#22b rate 미제공(보류)이어도 단순 비교는 제시', periodRateGapLine({ prevEval: 1000, curEval: 1100, rate: null, unit: '월간' }).includes('+10.00%'));
  eq('#22c prevEval 0/음수면 빈 문자열',
    [periodRateGapLine({ prevEval: 0, curEval: 100, rate: 1, unit: '월간' }), periodRateGapLine({ prevEval: -5, curEval: 100, rate: 1, unit: '월간' })], ['', '']);

  // ── periodBucketSpan / periodBasisLines — '측정 기준일' 노출 (사용자 문의 2026-08) ──────
  // 사용자가 주간 행 '8/24~8/26'을 보고 "8/24 종가부터 재는 것 아니냐 → 8/23→8/24 하루가 빠진다"고
  // 물었다. 실제 측정은 (직전 대표일, 이번 대표일] **반개구간**이라 그 하루는 이미 들어가 있다.
  // 산식은 그대로 두고(#9~#16이 고정) 기준일을 툴팁에 노출하는 것이 이 블록의 대상이다.
  eq('#23 주 버킷 거리 — 인접', periodBucketSpan('2026-08-23', '2026-08-26', 'week'), 1);
  eq('#23b 주 버킷 거리 — 한 주 건너뜀', periodBucketSpan('2026-08-16', '2026-08-26', 'week'), 2);
  eq('#23c 월 버킷 거리(연 경계 포함)',
    [periodBucketSpan('2026-07-31', '2026-08-26', 'month'), periodBucketSpan('2026-12-31', '2027-01-05', 'month'), periodBucketSpan('2026-06-30', '2026-09-01', 'month')], [1, 1, 3]);
  eq('#23d 연 버킷 거리', [periodBucketSpan('2025-12-31', '2026-01-02', 'year'), periodBucketSpan('2024-12-31', '2026-01-02', 'year')], [1, 2]);
  eq('#23e 일간 모드·손상 입력은 null',
    [periodBucketSpan('2026-08-23', '2026-08-26', 'day'), periodBucketSpan(null, '2026-08-26', 'week'), periodBucketSpan('2026-08-23', undefined, 'month')], [null, null, null]);

  const bl = periodBasisLines({ prevDate: '2026-08-23', curDate: '2026-08-26', mode: 'week' });
  eq('#24 인접 기간은 2줄', bl.length, 2);
  ok('#24b 첫 줄이 두 대표일 종가를 못 박는다', bl[0].includes('08/23') && bl[0].includes('08/26') && bl[0].includes('종가'));
  ok('#24c 시작값이 라벨의 첫 날이 아님을 명시', bl[1].includes('바로 아래 행') && bl[1].includes('라벨'));
  // ⚠️ 가장 오래된 기간은 비교 대상이 없다 — 없는 기준을 지어내지 않는다(null 계약).
  eq('#24d 직전 대표일 없으면 빈 배열',
    [periodBasisLines({ prevDate: null, curDate: '2026-08-26', mode: 'week' }).length, periodBasisLines({}).length], [0, 0]);
  // ⚠️ 기록 0건 기간은 compressPeriodRows가 행을 만들지 않아 라벨이 측정 범위를 축소해 보여 준다.
  const blSkip = periodBasisLines({ prevDate: '2026-08-16', curDate: '2026-08-26', mode: 'week' });
  eq('#24e 건너뛴 기간은 경고 줄 추가', blSkip.length, 3);
  ok('#24f 몇 개 기간을 한 번에 재는지 밝힌다', blSkip[2].includes('2개'));
  // ⚠️ periodNoun(mode).unit.replace('간','')은 연간에서 '그 연'이라는 비문이 된다 — 쓰지 않았음을 고정.
  ok('#24g 연간 경고 문구가 비문이 아니다',
    !periodBasisLines({ prevDate: '2024-12-31', curDate: '2026-06-30', mode: 'year' }).join('').includes('그 연'));

  // ⚠️ 날짜·basis는 **선택 인자**다 — 미전달이면 종전과 한 글자도 다르지 않아야 한다(하위호환).
  eq('#25 날짜 미전달은 종전 문장 그대로',
    periodGapLines({ prevEval: 1000, curEval: 1100, profit: 100, ledger: 0, fmt: F, unit: '월간' })[0],
    `평가금액 ${F(1000)} → ${F(1100)}  (차이 ${F(100)})`);
  const glDate = periodGapLines({ prevEval: 66477186, curEval: 66317216, profit: -159970, ledger: 0, fmt: F, unit: '주간', prevDate: '2026-08-23', curDate: '2026-08-26' });
  ok('#25b 날짜 전달 시 어느 날 종가 → 어느 날 종가인지 보인다',
    glDate[0].includes('08/23 ₩66,477,186') && glDate[0].includes('08/26 ₩66,317,216'));
  ok('#25c 금액은 그대로(표시만 추가)', glDate[0].includes('-159,970') && glDate.length === 2);

  const basis2 = ['측정 기준: A', '시작값 = B'];
  eq('#26 해명이 없는 기간엔 기준만 남는다',
    periodRateGapLine({ prevEval: 1000, curEval: 1100, rate: 10, unit: '월간', basis: basis2 }), '측정 기준: A\n시작값 = B');
  const rlB = periodRateGapLine({ prevEval: 774826963, curEval: 791529823, rate: 1.90, unit: '월간', basis: basis2 });
  ok('#26b 해명이 있으면 기준 다음에 붙는다', rlB.startsWith('측정 기준: A\n시작값 = B\n') && rlB.includes('+2.16%'));
  eq('#26c 평가액이 없어도 기준은 남는다',
    periodRateGapLine({ prevEval: 0, curEval: 100, rate: 1, unit: '월간', basis: basis2 }), '측정 기준: A\n시작값 = B');
  eq('#26d basis 문자열 하나도 받는다',
    periodRateGapLine({ prevEval: 1000, curEval: 1100, rate: 10, unit: '월간', basis: '기준 X' }), '기준 X');

  // ── 사용자 실측 재현(2026-08) — '갭'이 실제로는 없음을 픽스처로 고정한다 ────────────────
  // 일별 화면값: 8/23 ₩66,477,186 → 8/24 −₩945,745 → 8/25 +₩611,500 → 8/26 +₩174,275.
  const wkRows = ['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26']
    .map((date, i) => ({ date, evalAmount: [66477186, 66477186, 66477186, 65531441, 66142941, 66317216][i], flowIn: 0, flowOut: 0, ledger: 0 }));
  const wkA = accumulateDailySeries(wkRows.map(r => r.date), computeDailyMetricsSeries(wkRows));
  near('#27 주간 손익 = cum(8/26) − cum(8/23) — 화면 −159,970과 일치',
    wkA.profit.get('2026-08-26') - wkA.profit.get('2026-08-23'), -159970, 1);
  // ⚠️ 라벨의 첫 날(8/24) 종가를 시작값으로 삼으면 +785,775가 되어 8/24 하루(−945,745)가 통째로 증발한다.
  //    그 차이가 정확히 그 하루라는 것이 '반개구간이 옳다'의 증거다.
  near('#27b 라벨 첫날 기준이면 8/24 하루가 사라진다(그래서 쓰지 않는다)',
    (66317216 - 65531441) - (wkA.profit.get('2026-08-26') - wkA.profit.get('2026-08-23')), 945745, 1);
  // 연쇄성 — 인접 기간 손익의 합 = 양 끝 누적의 차. 어느 하루도 두 번 세이거나 사라지지 않는다.
  near('#27c 연쇄성 — 기간 손익의 합 = 전체 누적 차',
    (wkA.profit.get('2026-08-23') - wkA.profit.get('2026-08-21')) + (wkA.profit.get('2026-08-26') - wkA.profit.get('2026-08-23')),
    wkA.profit.get('2026-08-26') - wkA.profit.get('2026-08-21'), 1e-6);
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
  (read('src/components/DepositPanel.tsx').match(/'h-full min-h-\[520px\]' : 'h-\[392px\] min-h-\[392px\]'/g) || []).length === 2);
// #G12c ⚠️ 입출금 두 카드는 모바일에서 `flex-1`을 쓰면 안 된다 — 부모가 `flex flex-col xl:flex-row`라
//     좁은 화면에서는 세로가 주축이 되고, flex-basis:0%가 h-[392px]를 무효화해 카드가 헤더만 남기고
//     통째로 접힌다(휴대폰·아이패드에서 입출금 내역이 안 보이던 버그, 2026-09). min-h-는 flex가
//     height를 덮어도 남는 안전장치라 위 #G12b가 함께 단언한다.
{
  const dp = read('src/components/DepositPanel.tsx');
  const cards = (dp.match(/<div className=\{`[^`]*rounded-xl[^`]*flex flex-col overflow-hidden`\}/g) || []);
  ok('#G12c 입출금 카드가 데스크톱에서만 flex-1을 쓴다',
    cards.length === 2 && cards.every(c => /xl:flex-1/.test(c) && !/(^|[^:])\bflex-1\b/.test(c.replace(/xl:flex-1/g, ''))));
}

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

// ── 개별 계좌 기간 단위는 **계좌별**이다 (사용자 요청 2026-08) ────────────────
// ⚠️ 차트 토글 화이트리스트(CLAUDE.md '차트 토글은 계좌별로 독립')와 같은 4지점 규약이다.
//    ①②만 하면 저장은 되는데 복원이 없어 값이 그대로 남고, ③만 하면 신규 계좌가 직전 계좌를 물려받는다.
ok('#G23 ① currentChartStateRef 기본값 리터럴에 histPeriod',
  /const currentChartStateRef = useRef<any>\(\{[^\n]*histPeriod: 'day' \}\)/.test(appNoC));
ok('#G23b ② 동기화 effect 객체에 histPeriod: acctHistPeriod',
  /histPeriod: acctHistPeriod,\s*\};/.test(appNoC));
ok('#G23c ② 그 effect deps에 acctHistPeriod',
  /showTotalEval, showReturnRate, acctHistPeriod\]\);/.test(appNoC));
ok('#G23d ③ 계좌 전환 saved 복원 분기', /setAcctHistPeriod\(normalizeHistPeriod\(saved\.histPeriod\)\);/.test(appNoC));
// ⚠️ 처음 방문하는 계좌는 '일'로 시작한다(사용자 확정) — 직전 계좌 값을 물려받으면 이 기능의
//    증상(한 계좌에서 고른 게 다른 계좌에 나타남)이 신규 계좌 첫 방문에서 그대로 재현된다.
ok("#G23e ④ 처음 방문 계좌는 'day'", /setShowReturnRate\(true\);\s*setAcctHistPeriod\('day'\);/.test(appNoC));

// ⚠️ 부팅 복원은 **계좌별 값이 앱 레벨 값을 이겨야** 한다. accountChartStates 블록이 acctHistPeriod
//    복원보다 **위**에 있어서, showTotalEval처럼 그 블록에 넣으면 아래 앱 레벨 줄이 덮어쓴다
//    (순서가 반대라 같은 자리에 둘 수 없다 — 계좌 전환 이펙트는 prevId===null이라 최초 로드에 안 돈다).
ok('#G24 부팅 복원이 계좌별 histPeriod를 먼저 본다',
  /_bootAcct\?\.histPeriod !== undefined\) setAcctHistPeriod\(normalizeHistPeriod\(_bootAcct\.histPeriod\)\)/.test(appNoC));
ok('#G24b 계좌별 필드가 없는 옛 저장본만 앱 레벨 값으로 폴백',
  /else if \(stateData\.chartPrefs\.acctHistPeriod !== undefined\) setAcctHistPeriod/.test(appNoC));
// 영속화 신규 지점 0곳 — accountChartStates가 이미 chartPrefs에 실려 저장된다.
ok('#G24c 계좌별 상태는 accountChartStates로 이미 영속된다',
  /accountChartStates: accountChartStatesRef\.current/.test(appNoC));

// ── 기간 셀 툴팁 = 검산 분해 (산식은 무변경 — 사용자 확정 2026-08) ─────────────
// ⚠️ 문구는 utils 공유 포매터로만 만든다(periodNoun과 같은 규약) — 화면마다 따로 들고 있으면
//    한 곳만 고쳐지고 나머지가 계속 거짓말을 한다.
ok('#G25 utils가 두 포매터를 내보낸다',
  /export const periodGapLines = /.test(utils) && /export const periodRateGapLine = /.test(utils));
ok('#G25b 통합 표가 두 포매터를 **사용부**에서 쓴다',
  /title=\{isHistPeriodMode \? periodRateGapLine\(\{ prevEval: h\.periodPrevEval/.test(dashNoC) &&
  /periodGapLines\(\{ prevEval: h\.periodPrevEval, curEval: h\.evalAmount, profit: h\.dodAbsChange/.test(dashNoC));
ok('#G25c 개별 표도 같은 두 포매터를 쓴다',
  /const out = periodGapLines\(\{ prevEval: pe, curEval: ce, profit: dodProfit/.test(histNoC) &&
  /const rl = periodRateGapLine\(\{ prevEval: pe, curEval: ce/.test(histNoC) &&
  /\.\.\.gapTail,/.test(histNoC));

// ⚠️ 분해의 기준 평가액은 **표가 실제로 그리는 값**이어야 검산이 된다(저장 evalAmount 직접 사용 금지 —
//    시장 계좌 평가액은 '수량 × 종가' 재계산이 권위값이다).
ok('#G26 통합은 직전 대표일 평가액을 행에 싣는다', /periodPrevEval: prev \? prev\.evalAmount : null,/.test(dashNoC));
ok('#G26b 개별은 평가자산 셀과 같은 소스(shownEvalOf)를 쓴다',
  /const shownEvalOf = \(r\) => \{/.test(histNoC) &&
  /const o = isOverseasAcct && overseasEvalByDate \? overseasEvalByDate\.get\(r\.date\) : null;/.test(histNoC) &&
  /const pe = shownEvalOf\(viewRows\[i \+ 1\]\), ce = shownEvalOf\(h\);/.test(histNoC));

// ⚠️ hideAmounts면 툴팁을 아예 만들지 않는다 — 셀은 가려 놓고 hover에 실금액을 노출하면 반쪽이 된다.
ok('#G27 통합 손익 툴팁이 hideAmounts를 존중한다',
  /title=\{isHistPeriodMode && !hideAmounts \? periodGapLines\(/.test(dashNoC));
// ⚠️ 툴팁 추가가 **값을 바꾸지 않았는지** 재확인(사용자 확정: 산식 무변경).
ok('#G27b 통합 기간 값은 여전히 누적 차분이다',
  /dodAbsChange: noBase \? null : cp - cpP,/.test(dashNoC) &&
  /dodChange: noBase \? 0 : \(rebaseTwr\(t, tP\) \?\? 0\),/.test(dashNoC));
ok('#G27c 개별 기간 값도 여전히 누적 차분이다', /dodAbsChange: noBase \? null : cp - cpP,/.test(histNoC));

// ── 기간 행의 '측정 기준일' 노출 (사용자 문의 2026-08) ─────────────────────────────────
// ⚠️ 라벨(periodRangeLabel)은 **버킷 범위**이고 실제 측정은 (직전 대표일, 이번 대표일] 반개구간이다.
//    기준일이 화면 어디에도 없으면 사용자가 라벨의 첫 날을 시작값으로 오독한다(실제 문의).
//    문구는 utils 공유 포매터로만 만든다 — 화면마다 따로 들고 있으면 한 곳만 고쳐진다.
ok('#G28 utils가 기준 포매터를 내보낸다',
  /export const periodBucketSpan = /.test(utils) && /export const periodBasisLines = /.test(utils));
ok('#G28b 통합 histRows가 직전 대표일 **날짜**를 싣는다', /periodPrevDate: prev \? prev\.date : null,/.test(dashNoC));
// ⚠️ **사용부**를 단언한다 — 선언만 보면 셀에서 호출을 통째로 지워도 통과한다.
ok('#G28c 통합 일자 셀 툴팁이 기준을 노출한다',
  /periodBasisLines\(\{ prevDate: h\.periodPrevDate, curDate: h\.date, mode: intHistPeriod \}\)\]\.join/.test(dashNoC));
ok('#G28d 통합 % 셀 툴팁이 기준을 노출한다',
  /basis: periodBasisLines\(\{ prevDate: h\.periodPrevDate, curDate: h\.date, mode: intHistPeriod \}\)/.test(dashNoC));
ok('#G28e 통합 손익 툴팁 분해에 날짜가 들어간다',
  /prevDate: h\.periodPrevDate, curDate: h\.date \}\)\.join/.test(dashNoC));
ok('#G28f 개별 표도 같은 두 경로로 기준을 노출한다',
  /const pd = viewRows\[i \+ 1\] \? viewRows\[i \+ 1\]\.date : null;/.test(histNoC) &&
  /unit: noun\.unit, prevDate: pd, curDate: h\.date \}\)/.test(histNoC) &&
  /periodBasisLines\(\{ prevDate: viewRows\[i \+ 1\] \? viewRows\[i \+ 1\]\.date : null, curDate: h\.date, mode: histPeriod \}\)/.test(histNoC));
// ⚠️ th 툴팁·도움말은 hover하지 않는 사용자를 위한 '항상 참인' 설명이다 — 지우면 오독이 되돌아온다.
//    (행별 날짜가 없어도 참이다: 시작값은 언제나 화면에서 바로 아래 행의 평가액이다.)
ok('#G28g 통합 th 두 개가 시작값의 위치를 명시한다',
  /시작값은 라벨에 적힌 첫 날이 아니라 직전 기간의 대표일 종가입니다/.test(dashNoC) &&
  /직전 기간의 대표일 종가부터 이번 대표일 종가까지 잽니다/.test(dashNoC));
ok('#G28h 개별 th·도움말이 같은 사실을 말한다',
  /시작값 = 직전 기간의 대표일 종가/.test(histNoC) &&
  /시작값은 라벨에 적힌 첫 날이 아니라 직전 기간의 대표일 종가입니다\./.test(histNoC));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
