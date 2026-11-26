#!/usr/bin/env node
// 펀드 기준가 공백 구제(fundGapEval) 검증 — 2026-11-26 사용자 신고.
//
// 사고: 퇴직연금 820 계좌(ETF 18종 + 미래에셋 펀드 1종, 펀드 비중 약 8%)에서 펀드 기준가 조회가
//       10/27 이후 막히자 buildCloseEvalSeries의 allExact가 평일마다 거짓 → **계좌 전체가 한 달간
//       10/27 값으로 이월**되어 차트가 평평했고, 오늘 라이브 값에서 −9%p 절벽이 났다. ETF 종가는
//       매일 정상으로 받아 저장돼 있었는데도 수익률 차트에 반영되지 않았다.
// 규칙: 그날 정확값이 빠진 항목이 **기준가 이력이 있는 펀드뿐**이면 그 펀드만 '그날 이전 마지막
//       기준가'로 계산한다. 주식·ETF·금이 빠진 날(주말·부팅 중간 상태)은 종전처럼 이월한다.
//
// 구성 ①  src/utils.ts 를 직접 import 해 순수 함수를 검증(미러 금지 — verify-period 선례).
// 구성 ②  소스 텍스트 가드 — 배선(구제 경로가 buildCloseEvalSeries에 실제로 걸려 있는지).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\n── 파트① 순수 함수 (src/utils.ts 직접 import) ──');
const U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
const { buildCloseEvalSeries, fundGapEval, lastNavOnOrBefore, calcPortfolioEvalDetail } = U;

// 날짜: 10/27(월)~11/03(월). 10/31·11/01 = 주말.
const D = ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];
const EDK = '2026-11-04'; // 오늘(라이브) — 시계열에서 빠진다
const ETF = { id: 'e', type: 'stock', code: 'AAA111', quantity: 10, currentPrice: 1000 };
const FUND = { id: 'f', type: 'fund', code: 'MA:FUND1', quantity: 100, currentPrice: 50 };
const DEP = { id: 'd', type: 'deposit', depositAmount: 7 };
const mkP = (items) => ({ id: 'p', accountType: 'dc-irp', portfolio: items, holdingSnapshots: [{ date: '2026-01-01', kind: 'baseline', items }] });
// ETF 종가는 평일 매일(주말 없음), 펀드 기준가는 10/27에서 멈춤(조회처 차단 재현)
const SHM = {
  AAA111: { '2026-10-27': 1000, '2026-10-28': 1100, '2026-10-29': 1200, '2026-10-30': 900, '2026-11-02': 950, '2026-11-03': 1050 },
  'MA:FUND1': { '2026-10-20': 40, '2026-10-27': 50 },
};
const P = mkP([ETF, FUND, DEP]);
const ser = buildCloseEvalSeries(P, D, 'dc-irp', SHM, {}, EDK);
const want = (etfClose, nav = 50) => 10 * etfClose + 100 * nav + 7;

// #F1 사고 재현: 펀드만 기준가가 없는 평일은 ETF 그날 종가 + 펀드 마지막 기준가
eq('#F1a 10/27(전부 정확) = 수량×종가', ser.get('2026-10-27'), want(1000));
eq('#F1b 10/28(펀드만 공백) = ETF 10/28 종가 + 펀드 10/27 기준가', ser.get('2026-10-28'), want(1100));
eq('#F1c 10/29', ser.get('2026-10-29'), want(1200));
eq('#F1d 10/30', ser.get('2026-10-30'), want(900));
ok('#F1e 펀드 공백 구간에서도 평일마다 값이 움직인다(한 달 평평 재발 방지)',
  new Set(['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03'].map(d => ser.get(d))).size === 5);
// #F2 주말(ETF도 정확값 없음) → 종전처럼 직전 값 이월
eq('#F2a 10/31(주말) = 10/30 이월', ser.get('2026-10-31'), ser.get('2026-10-30'));
eq('#F2b 11/01(주말) = 10/30 이월', ser.get('2026-11-01'), ser.get('2026-10-30'));
eq('#F2c 11/02(평일) 다시 계산', ser.get('2026-11-02'), want(950));
// #F3 오늘(effectiveDateKey)은 여전히 미설정(라이브 폴백)
ok('#F3 오늘 날짜는 시계열에 없다', !ser.has(EDK));

// #F4 주식·ETF가 빠진 날은 구제하지 않는다(부팅 중간 상태 = 이월이 맞다)
{
  // 펀드는 10/28·10/29 기준가가 모두 있고(값이 달라) ETF만 10/29가 빠졌다 — 이월값과 '구제값'이 갈리는 배치.
  const shm = { AAA111: { ...SHM.AAA111 }, 'MA:FUND1': { ...SHM['MA:FUND1'], '2026-10-28': 51, '2026-10-29': 60 } };
  delete shm.AAA111['2026-10-29'];
  const s = buildCloseEvalSeries(P, D, 'dc-irp', shm, {}, EDK);
  eq('#F4 ETF 종가가 빠진 10/29 = 10/28 이월(구제 안 함)', s.get('2026-10-29'), want(1100, 51));
}
// #F5 기준가 이력이 한 번도 없는 펀드 → 구제 안 함(종전과 같다: 정확값이 없으면 map 미설정)
{
  const shm = { AAA111: SHM.AAA111 };
  const s = buildCloseEvalSeries(P, D, 'dc-irp', shm, {}, EDK);
  eq('#F5 이력 없는 펀드 — 시계열이 비어 있다(호출부 저장값 폴백 유지)', s.size, 0);
}
// #F6 그날 이전 기준가가 없는 날(펀드 이력 시작 전) → 구제 안 함
{
  const shm = { ...SHM, 'MA:FUND1': { '2026-10-29': 55 } };
  const s = buildCloseEvalSeries(P, D, 'dc-irp', shm, {}, EDK);
  ok('#F6a 이력 시작(10/29) 전인 10/27·10/28은 미설정', !s.has('2026-10-27') && !s.has('2026-10-28'));
  eq('#F6b 10/29(정확) 계산', s.get('2026-10-29'), want(1200, 55));
  eq('#F6c 10/30(공백) = 10/29 기준가로 구제', s.get('2026-10-30'), want(900, 55));
}
// #F7 펀드 수량 0(평가금액만 입력하는 펀드)은 구제하지 않는다
{
  const P0 = mkP([ETF, { ...FUND, quantity: 0, evalAmount: 5000 }, DEP]);
  const s = buildCloseEvalSeries(P0, D, 'dc-irp', SHM, {}, EDK);
  ok('#F7 수량 0 펀드(평가금액만) — 구제하지 않는다(10/28 값 없음)', !s.has('2026-10-28'));
}
// #F8 펀드가 정확한 날은 종전 경로(구제 미사용)와 값이 같다
{
  const shm = { ...SHM, 'MA:FUND1': { ...SHM['MA:FUND1'], '2026-10-28': 51 } };
  const s = buildCloseEvalSeries(P, D, 'dc-irp', shm, {}, EDK);
  const r = calcPortfolioEvalDetail(P.portfolio, 'dc-irp', '2026-10-28', shm, {}, 1, {});
  ok('#F8 정확한 날은 calcPortfolioEvalDetail 합계 그대로', r.allExact && s.get('2026-10-28') === r.total && r.total === want(1100, 51));
}
// #F9 예수금 짝 이월: 구제된 날도 예수금 시계열이 같이 채워진다
{
  const dep = new Map();
  buildCloseEvalSeries(P, D, 'dc-irp', SHM, {}, EDK, 1, { depositOut: dep });
  ok('#F9 구제된 10/28의 예수금 = 7, 주말 11/01도 7(짝 이월)', dep.get('2026-10-28') === 7 && dep.get('2026-11-01') === 7);
}
// #F10 기준가 공백이 15일을 넘어도(getClosestValue 한도 밖) 마지막 기준가를 쓴다 — currentPrice로 튀지 않는다
{
  const longD = ['2026-10-27', '2026-11-20'];
  const shm = { AAA111: { '2026-10-27': 1000, '2026-11-20': 1300 }, 'MA:FUND1': { '2026-10-27': 50 } };
  const Pc = mkP([ETF, { ...FUND, currentPrice: 999 }, DEP]); // 라이브가가 달라도 과거 날짜엔 쓰지 않는다
  const s = buildCloseEvalSeries(Pc, longD, 'dc-irp', shm, {}, '2026-11-26');
  eq('#F10 24일 공백 → 10/27 기준가 50으로 계산', s.get('2026-11-20'), want(1300, 50));
}
// #F11 금현물 계좌는 구제 경로를 타지 않는다
{
  const s = buildCloseEvalSeries(P, D, 'gold', SHM, {}, EDK);
  ok('#F11 gold 계좌 — 구제 없음(10/28 값 없음 또는 이월)', !s.has('2026-10-28') || s.get('2026-10-28') === s.get('2026-10-27'));
}
// #F12 lastNavOnOrBefore 이진 탐색
{
  const m = { X: { '2026-01-05': 10, '2026-01-02': 9, '2026-01-09': 12, 'bad': 1, '2026-01-07': 0 } };
  eq('#F12a 정확한 날짜', lastNavOnOrBefore(m, 'X', '2026-01-05'), 10);
  eq('#F12b 사이 날짜 → 직전', lastNavOnOrBefore(m, 'X', '2026-01-08'), 10); // 01-07은 0이라 제외
  eq('#F12c 첫 날짜 이전 → null', lastNavOnOrBefore(m, 'X', '2026-01-01'), null);
  eq('#F12d 마지막 이후 → 마지막', lastNavOnOrBefore(m, 'X', '2026-12-31'), 12);
  eq('#F12e 없는 코드 → null', lastNavOnOrBefore(m, 'Y', '2026-01-05'), null);
}
// #F13 fundGapEval 직접: 주식이 빠지면 null
{
  const r = calcPortfolioEvalDetail(P.portfolio, 'dc-irp', '2026-10-31', SHM, {}, 1, {});
  eq('#F13 주말(ETF 정확값 없음)에는 null', fundGapEval(r, '2026-10-31', SHM), null);
}

console.log('\n── 파트② 소스 텍스트 가드 ──');
const utils = stripComments(read('src/utils.ts'));
const body = utils.slice(utils.indexOf('export const buildCloseEvalSeries'), utils.indexOf('export const calcPortfolioEvalForDate'));
ok('#G1 buildCloseEvalSeries가 fundGapEval을 부른다(allExact 거짓 + gold 제외일 때만)',
  /const fundGap = \(r\.hasAnyPrice && !r\.allExact && accountType !== 'gold'\) \? fundGapEval\(r, date, stockHistoryMap, navKeyCache\) : null;/.test(body));
ok('#G2 구제값도 예수금과 짝으로 들어간다',
  /else if \(fundGap != null\) \{ closeVal = fundGap; depVal = depositEvalOf\(r\.items\); \}/.test(body));
const fg = utils.slice(utils.indexOf('export const fundGapEval'), utils.indexOf('export const buildCloseEvalSeries'));
ok('#G3 fundGapEval은 펀드가 아닌 공백을 거절한다(주식·ETF 구제 금지)',
  /if \(it\.type !== 'fund' \|\| !it\.code\) return null;/.test(fg));
ok('#G4 fundGapEval은 마지막 기준가(lastNavOnOrBefore)를 쓴다 — currentPrice 아님',
  /lastNavOnOrBefore\(stockHistoryMap, it\.code, date, cache\)/.test(fg) && !/currentPrice/.test(fg));

// ── 펀드 기준가 조회 경로(2026-11-26 둘째 요청 — 미래에셋·funetf가 해외 서버를 막아 한 달간 0건) ──
console.log('\n── 파트③ 펀드 조회 경로 가드 ──');
const fp = read('api/fund-proxy.ts');
const fpCode = stripComments(fp);
ok('#R1 api/fund-proxy.ts는 서울(icn1)에서만 실행한다', /export const config = \{ runtime: 'edge', regions: \['icn1'\] \};/.test(fpCode));
ok('#R2 허용 주소는 미래에셋·funetf뿐(열린 중계 금지)',
  /const ALLOWED_HOSTS = \['investments\.miraeasset\.com', 'www\.funetf\.co\.kr', 'funetf\.co\.kr'\];/.test(fpCode)
  && /!ALLOWED_HOSTS\.includes\(targetUrl\.hostname\)/.test(fpCode) && /targetUrl\.protocol !== 'https:'/.test(fpCode));
ok('#R3 브라우저 흉내(Mozilla User-Agent·Referer 위조)를 하지 않는다', !/Mozilla/.test(fpCode) && !/Referer/.test(fpCode));
const apiSrc = stripComments(read('src/api.ts'));
const fnBody = (name) => { const i = apiSrc.indexOf(`export const ${name} = async`); return i < 0 ? '' : apiSrc.slice(i, apiSrc.indexOf('\nexport const ', i + 10)); };
const beforeProxy = (body) => { const a = body.indexOf('fundProxyUrl('); const b = body.indexOf('`/api/proxy?url='); return a > 0 && b > 0 && a < b; };
for (const name of ['fetchFundInfo', 'fetchFundNavHistory', 'fetchMiraeFundInfo', 'fetchMiraeFundNavHistory']) {
  ok(`#R4 ${name}: 서울 경로(fundProxyUrl)를 /api/proxy보다 먼저 시도`, beforeProxy(fnBody(name)));
}
{
  const mi = fnBody('fetchMiraeFundInfo');
  ok('#R4b fetchMiraeFundInfo의 세 단계(이름·현재가 페이지·기준가 목록) 모두 서울 경로를 쓴다', (mi.match(/fundProxyUrl\(/g) || []).length === 3);
}
ok('#R5 fundProxyUrl은 /api/fund-proxy를 가리킨다', /const fundProxyUrl = \(u: string\) => `\/api\/fund-proxy\?url=\$\{encodeURIComponent\(u\)\}`;/.test(apiSrc));
const sd = stripComments(read('src/hooks/useStockData.ts'));
ok('#R6 펀드 이력은 증분(마지막 기준가 14일 전부터)으로 받는다',
  /const incremental = !force && startCovered && tradingKeys\.length > 30 && latest < lastTradingDay;/.test(sd)
  && /const fetchFrom = incremental \? shiftIsoDays\(latest, -14\) : histStartDate;/.test(sd)
  && /fetchMiraeFundNavHistory\(code, fetchFrom, today\)/.test(sd) && /fetchFundNavHistory\(code, fetchFrom, today\)/.test(sd));
ok('#R7 증분 결과는 replace(기존 날짜 보존 병합)로 스테이징된다 — 과거 기준가를 지우지 않는다',
  /stage\(code, \{ replace: hist \|\| null, deleteKeys: staleWeekendKeys \}\);/.test(sd));
{
  // replace가 '덮어쓰기 병합'이라는 전제 자체를 실행으로 확인(전제가 바뀌면 증분이 과거를 지운다)
  const S = await import(pathToFileURL(join(ROOT, 'src/stockHistorySync.ts')).href);
  const next = S.applyStagedMerges({ 'MA:F': { '2022-04-01': 1000, '2026-10-27': 1500 } }, { 'MA:F': { replace: { '2026-10-27': 1501, '2026-11-25': 1400 } } });
  eq('#R8 replace 증분 병합: 옛 날짜 보존 + 겹친 날 정정 + 새 날 추가', next['MA:F'], { '2022-04-01': 1000, '2026-10-27': 1501, '2026-11-25': 1400 });
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
