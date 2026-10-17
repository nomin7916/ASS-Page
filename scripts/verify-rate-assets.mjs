#!/usr/bin/env node
// 금리 모니터링 ⑤ '자산군별 종목' 계산 검증 — src/rateAssets.ts 를 **직접 import**한다(미러 금지, 2026-10 6단계).
//   Yahoo 배당 이력 해석 · 12개월 합계 · 배당률·세후 · 52주 최고 대비 · 배당 주기 · 1년 전 회차 비교 · 주가÷장부가·순자산 · 정렬
// ⚠️ 이 모듈은 import 0건이라 Node가 타입만 벗겨 실행한다. 런타임이 .ts를 못 읽으면 명시적으로 건너뛴다.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const near = (name, got, want, tol = 1e-9) => ok(`${name} (got ${got}, want ${want})`, got != null && Math.abs(got - want) <= tol);
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

let A = null;
try { A = await import(pathToFileURL(join(ROOT, 'src/rateAssets.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 계산 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/rateAssets.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

const ts = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000 + 14 * 3600;
const yahoo = (divs) => ({ chart: { result: [{ events: { dividends: Object.fromEntries(divs.map(([d, v]) => [ts(d), { amount: v, date: ts(d) }])) } }] } });
const E = (pairs) => pairs.map(([exDate, amount]) => ({ exDate, amount }));

if (A) {
  const {
    pickYahooDividendEvents, trailingDividend, dividendYield, afterTax, drawdownFrom52High, dividendCycle, dividendChange,
    priceToManual, buildRateAssetRow, orderRateAssetRows, RATE_ASSET_GROUPS, MANUAL_INPUTS,
  } = A;
  console.log('\n── 파트① 계산 ──');
  eq('#1 Yahoo 배당 이력 — 날짜 오름차순 전체', pickYahooDividendEvents(yahoo([['2026-09-01', 0.3], ['2026-08-01', 0.2]])),
    { status: 'ok', events: [{ exDate: '2026-08-01', amount: 0.2 }, { exDate: '2026-09-01', amount: 0.3 }] });
  eq('#2 배당 없는 정상 응답 = none / 모양이 틀린 응답 = null', [pickYahooDividendEvents({ chart: { result: [{}] } }), pickYahooDividendEvents({ foo: 1 })], [{ status: 'none' }, null]);
  eq('#2b 항목은 있는데 전부 손상이면 null(배당 없음으로 단언하지 않는다)', pickYahooDividendEvents({ chart: { result: [{ events: { dividends: { a: { amount: 'x', date: 'y' } } } }] } }), null);

  const ev = E([['2025-10-16', 9], ['2025-10-17', 1], ['2026-04-01', 2], ['2026-10-16', 3], ['2026-10-20', 99]]);
  eq('#3 12개월 합계 — 기준일 365일 전 당일 제외 · 기준일 포함 · 미래 제외', trailingDividend(ev, '2026-10-16'), { sum: 6, count: 3 });
  eq('#3b 기준일이 없으면 null', trailingDividend(ev, ''), null);
  near('#4 배당률 = 합계 ÷ 현재가 × 100', dividendYield(2.4, 40), 6);
  eq('#4b 현재가가 0·없음이면 null', [dividendYield(2.4, 0), dividendYield(2.4, null), dividendYield(null, 40)], [null, null, null]);
  near('#5 세후 = × (1 − 15%)', afterTax(10), 8.5);

  const daily = [['2025-10-01', 80], ['2026-03-01', 50], ['2026-09-01', 40]];
  near('#6 52주 최고 대비 — 1년 밖의 고점은 무시', drawdownFrom52High(daily, 45, '2026-10-16'), (45 / 50 - 1) * 100);
  near('#6b 현재가가 최고면 0', drawdownFrom52High(daily, 60, '2026-10-16'), 0);
  eq('#6c 현재가가 없으면 null', drawdownFrom52High(daily, null, '2026-10-16'), null);

  const monthly = E(['2025-09-02', '2025-10-01', '2025-11-03', '2025-12-01', '2026-01-02', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01', '2026-10-01'].map(d => [d, 0.1]));
  const quarterly = E([['2025-03-10', 1], ['2025-06-10', 1], ['2025-09-10', 1], ['2025-12-10', 1], ['2026-03-10', 1], ['2026-06-10', 1], ['2026-09-10', 1]]);
  eq('#7 배당 주기 — 월·분기·반기·연 / 1회뿐이면 모름', [
    dividendCycle(monthly), dividendCycle(quarterly),
    dividendCycle(E([['2025-01-10', 1], ['2025-07-10', 1], ['2026-01-10', 1]])),
    dividendCycle(E([['2024-06-10', 1], ['2025-06-10', 1]])),
    dividendCycle(E([['2026-01-10', 1]])),
  ], ['monthly', 'quarterly', 'semiannual', 'annual', null]);

  const withLast = (arr, last, prevYear) => arr.map(e => (e.exDate === '2026-10-01' ? { ...e, amount: last } : e.exDate === '2025-10-01' ? { ...e, amount: prevYear } : e));
  eq('#8 1년 전 같은 회차와 비교 — 늘어남·같음·줄어듦', [
    dividendChange(withLast(monthly, 0.12, 0.1)), dividendChange(withLast(monthly, 0.1002, 0.1)), dividendChange(withLast(monthly, 0.08, 0.1)),
  ], ['up', 'same', 'down']);
  eq('#8b 분기 배당 — 1년 전 회차(2025-09-10)와 비교', dividendChange(quarterly.map((e, i, arr) => (i === arr.length - 1 ? { ...e, amount: 0.9 } : e))), 'down');
  eq('#8c 1년 전 회차가 허용 오차 밖이면 모름', dividendChange(E([['2026-06-01', 1], ['2026-07-01', 1], ['2026-08-01', 1], ['2026-09-01', 1], ['2026-10-01', 2]])), null);

  near('#9 주가 ÷ 수동값', priceToManual(20, { value: 25, asOf: '2026-Q2' }), 0.8);
  eq('#9b 수동값이 null이면 계산하지 않는다', priceToManual(20, { value: null, asOf: null }), null);

  const row = buildRateAssetRow('AGNC', { quote: { price: 10 }, daily: [['2026-06-01', 11]], divs: { status: 'ok', events: E([['2026-09-01', 0.12], ['2026-10-01', 0.12]]) } }, '2026-10-16', 4.0);
  ok('#10 행 — 배당률·세후·52주·장부가(입력 필요)', Math.abs(row.yield12 - 2.4) < 1e-9 && Math.abs(row.yieldPost - 2.04) < 1e-9
    && Math.abs(row.drawdown52 - (10 / 11 - 1) * 100) < 1e-9 && row.manualKind === 'bookValue' && row.manualSet === false && row.pb === null);
  near('#10b 배당률 − 미국 10년(%p)', row.spread10y, 2.4 - 4.0);
  const none = buildRateAssetRow('ZROZ', { quote: { price: 70 }, divs: { status: 'none' } }, '2026-10-16');
  ok('#11 배당 없음은 0%가 아니라 noDividend', none.noDividend === true && none.yield12 === 0);
  const empty = buildRateAssetRow('HYG', null, '2026-10-16');
  ok('#12 자료를 못 받으면 전부 null(0으로 단언하지 않는다)', empty.price === null && empty.yield12 === null && empty.drawdown52 === null && empty.cycle === null);

  const hy = RATE_ASSET_GROUPS.find(g => g.key === 'highYield');
  const rows = [['HYG', 5], ['JNK', 7], ['USHY', null], ['SPHY', 6]].map(([t, y]) => ({ ...buildRateAssetRow(t, null, '2026-10-16'), yield12: y }));
  eq('#13 하이일드 탭 — 배당률 높은 순, 모르는 값은 맨 아래', orderRateAssetRows(hy, rows).map(r => r.ticker), ['JNK', 'SPHY', 'HYG', 'USHY']);
  const rows2 = [['HYG', null], ['JNK', null], ['USHY', 4], ['SPHY', null], ['HYLB', 3]].map(([t, y]) => ({ ...buildRateAssetRow(t, null, '2026-10-16'), yield12: y }));
  eq('#13b 모르는 값이 앞에 있어도 맨 아래로(목록 순서 유지)', orderRateAssetRows(hy, rows2).map(r => r.ticker), ['USHY', 'HYLB', 'HYG', 'JNK', 'SPHY']);
  const re = RATE_ASSET_GROUPS.find(g => g.key === 'equityReit');
  const yr = (t, y) => ({ ...buildRateAssetRow(t, null, '2026-10-16'), yield12: y });
  eq('#14b 고정 종목은 배당률 정렬보다 앞선다', orderRateAssetRows({ ...re, sortByYield: true }, [yr('PLD', 9), yr('AMT', 8), yr('O', 1)]).map(r => r.ticker), ['O', 'PLD', 'AMT']);
  eq('#14 실물 리츠 탭 — O 맨 위 고정, 나머지는 목록 순서', orderRateAssetRows(re, ['PLD', 'O', 'AMT'].map(t => buildRateAssetRow(t, null, '2026-10-16'))).map(r => r.ticker), ['O', 'PLD', 'AMT']);

  console.log('\n── 파트② 목록·수동값 ──');
  const T = Object.fromEntries(RATE_ASSET_GROUPS.map(g => [g.key, g.tickers]));
  eq('#15 종목 목록', T, {
    highYield: ['HYG', 'JNK', 'USHY', 'SPHY', 'HYLB', 'ANGL', 'FALN', 'SHYG', 'SJNK'],
    longBond: ['TLT', 'EDV', 'ZROZ', 'VGLT', 'TLTW'],
    mortgageReit: ['AGNC', 'NLY', 'DX', 'TWO', 'ARR'],
    equityReit: ['O', 'PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'PSA', 'DLR', 'CCI', 'VICI', 'VNQ'],
    bdc: ['MAIN', 'ARCC', 'OBDC', 'BXSL', 'HTGC', 'TSLX', 'CSWC', 'FSK', 'BIZD'],
  });
  eq('#16 고정·정렬 — O·MAIN 고정, 하이일드·장기채만 배당률 정렬', RATE_ASSET_GROUPS.map(g => [g.key, g.pin, g.sortByYield]),
    [['highYield', null, true], ['longBond', null, true], ['mortgageReit', null, false], ['equityReit', 'O', false], ['bdc', 'MAIN', false]]);
  eq('#17 수동값 대상 — AGNC·NLY 장부가 / BDC 순자산(ETF 제외)', [Object.keys(MANUAL_INPUTS.bookValue), Object.keys(MANUAL_INPUTS.nav)],
    [['AGNC', 'NLY'], ['MAIN', 'ARCC', 'OBDC', 'BXSL', 'HTGC', 'TSLX', 'CSWC', 'FSK']]);
  const all = [...Object.values(MANUAL_INPUTS.bookValue), ...Object.values(MANUAL_INPUTS.nav)];
  ok('#18 수동값은 null이거나 (양수 + 기준일)이 함께 있다 — 기준일 없는 값 금지', all.every(v => v.value === null || (typeof v.value === 'number' && v.value > 0 && !!v.asOf)));
}

console.log('\n── 파트③ 배선 가드 ──');
{
  const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const RA = src('src/rateAssets.ts');
  const RS = src('src/rateSignals.ts');
  const RW = src('src/components/RateWindow.tsx');
  const WQ = src('src/watchlistQuote.ts');
  const pkg = JSON.parse(src('package.json'));
  const strip = (x) => x.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  ok('#G1 순수 모듈은 import 0건', !/^\s*import\s/m.test(RA));
  ok('#G2 창은 계산을 rateAssets에서 가져온다', /from '\.\.\/rateAssets'/.test(RW) && /buildRateAssetRow\(tk, assetData\[tk\]/.test(RW) && /orderRateAssetRows\(g,/.test(RW));
  ok('#G3 원천징수율이 두 모듈에서 같다', /ASSET_WITHHOLDING_PCT = 15;/.test(RA) && /withholdingPct: 15,/.test(RS));
  ok('#G4 동시 요청 4건 · 이미 요청한 종목은 다시 받지 않는다', /const ASSET_CONCURRENCY = 4;/.test(RW) && /assetActiveRef\.current < ASSET_CONCURRENCY/.test(RW) && /!assetRequestedRef\.current\.has\(tk\)/.test(RW));
  ok('#G5 탭을 열 때 그 탭 종목만 + ③ 대표 종목', /loadAssets\(RATE_ANCHOR_TICKERS\)/.test(RW) && /RATE_ASSET_GROUPS\.find\(g => g\.key === assetTab\)\?\.tickers/.test(RW));
  ok('#G6 시세·이력·배당 함수를 그대로 쓴다(market us)', /fetchWatchQuote\('us', tk\)/.test(RW) && /fetchWatchDaily\('us', tk\)/.test(RW) && /fetchUsDividendEvents\(tk\)/.test(RW)
    && /import \{ fetchWatchQuote, fetchWatchDaily, fetchUsDividendEvents \} from '\.\.\/watchlistQuote';/.test(RW));
  ok('#G7 기존 fetchWatchDividend는 그대로 · 이력 전체 함수 추가', /pickYahooDividend, 10000\)/.test(WQ) && /export async function fetchUsDividendEvents\(/.test(WQ)
    && /pickYahooDividendEvents, 10000\)/.test(WQ) && /import \{ pickYahooDividendEvents \} from '\.\/rateAssets';/.test(WQ));
  ok('#G8 받은 자료를 브라우저 저장소에 두지 않는다', !/localStorage|sessionStorage/.test(strip(RW)));
  ok('#G9 티커를 누르면 Yahoo Finance 새 탭', /finance\.yahoo\.com\/quote\//.test(RW) && /target="_blank" rel="noopener noreferrer"/.test(RW));
  ok('#G10 수동값이 없으면 입력 필요 표시', /입력 필요/.test(RW) && /!r\.manualSet/.test(RW));
  ok('#G11 장부가 배율 색 — 1.1 이상 빨강 유상증자 위험 · 0.9 이하 초록', /effRules\.mreit\.pbWarn\) extra = <span className="text-red-400 font-bold">\{v\.toFixed\(2\)\}배 유상증자 위험/.test(RW)
    && /effRules\.mreit\.pbMax\) extra = <span className="text-green-400/.test(RW));
  ok('#G12 검증 스크립트가 게이트 목록에 있다', pkg.scripts['verify:rate-assets'] === 'node scripts/verify-rate-assets.mjs');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:rate-assets — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
