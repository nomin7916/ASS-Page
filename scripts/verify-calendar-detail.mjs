// 날짜별 '계좌별 현황' 검증 — src/utils.ts buildHistDetailRows 의 참조 구현과 1:1 동기화할 것.
//
//   파트① 참조 구현 미러 (#1~#18)
//     통합 대시보드 '평가액 추이' 팝업과 메모 달력 자산 스냅샷 팝업이 **같은 함수**를 쓴다는 것이
//     이 기능의 유일한 불변식이다. 함수 본문 회귀를 여기서 잡는다.
//   파트② 교차검증 (#X1~#X3)
//     "달력 칸의 총자산 = 팝업 소계 = 추이 차트 그날 값". 미러 단독 검증은 이 부류에 구조적으로
//     눈이 멀어 있으므로, useIntegratedData의 집계 규칙(carry-forward)을 좁게 미러해 대조한다.
//   파트③ 소스 텍스트 가드 (#G1~#G14)
//     배선(브릿지 화이트리스트·입양 게이트 순서·null 가드·open 게이트·ErrorBoundary)은 미러로
//     표현할 수 없어 소스를 직접 읽어 계약을 단언한다(verify-transfer #17~#33 선례).
//     ⚠️ 전부 '선언'이 아니라 **사용부**를 단언한다 — 존재 확인만 하면 셀 삭제·값 바꿔치기가 통과한다.
//     ⚠️ 실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
// '금지 토큰 부재'를 단언하는 가드는 **주석을 걷어낸 뒤** 봐야 한다 — 이 저장소는 금지 이유를
// 바로 그 자리 주석에 적는 관행이라(예: "markGotData()를 절대 부르지 말 것") 원문으로 재면
// 가드가 영구히 실패한다. 줄 주석만 제거한다(verify-twr #30d 선례).
// ⚠️ 줄 주석과 **블록 주석**(JSX의 {/* … */} 포함)을 모두 걷어낸다 — 이 저장소는 금지 이유를
//    JSX 주석으로 그 자리에 적으므로 줄 주석만 지우면 가드가 영구히 실패한다.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ───────── 참조 구현 (src/utils.ts buildHistDetailRows 미러) ─────────
const EMPTY_HIST_DETAIL = { rows: [], totalEval: 0, totalPrincipal: 0, totalDeposit: 0, totalProfit: 0, totalReturnRate: null };

const buildHistDetailRows = (opts) => {
  const o = opts || {};
  const date = o.date;
  const portfolios = o.portfolios;
  if (!date || !Array.isArray(portfolios)) return EMPTY_HIST_DETAIL;
  const summaries = Array.isArray(o.portfolioSummaries) ? o.portfolioSummaries : [];
  const seriesById = o.accountSeriesById || {};
  const activePortfolioId = o.activePortfolioId ?? null;
  const activeHistory = Array.isArray(o.activeHistory) ? o.activeHistory : null;
  const isRealtimeDate = !!o.realtimeDate && date === o.realtimeDate && (o.liveTotalEval || 0) > 0;

  let totalEval = 0, totalPrincipal = 0, totalDeposit = 0;
  const rows = [];
  portfolios.forEach(p => {
    if (!p) return;
    if (p.isTest) return;
    if (p.deletedAt && (isRealtimeDate || date >= p.deletedAt)) return;
    const summary = summaries.find(s => s.id === p.id);
    const isCash = p.accountType === 'matong' || p.accountType === 'simple';
    let evalAmt = 0;
    let seriesDeposit;
    if (isRealtimeDate) {
      evalAmt = summary?.currentEval || 0;
    } else if (isCash) {
      const startDate = summary?.startDate || p.portfolioStartDate || p.startDate || '';
      if (startDate && startDate > date) return;
      const hist = (activeHistory && p.id === activePortfolioId) ? activeHistory : (p.history || []);
      const sorted = [...hist].filter(h => h?.date && typeof h.evalAmount === 'number' && h.evalAmount >= 0).sort((a, b) => a.date.localeCompare(b.date));
      const rec = sorted.filter(h => h.date <= date).pop();
      evalAmt = rec ? rec.evalAmount : 0;
    } else {
      const series = seriesById[p.id];
      if (!series || !series.dates || series.dates.length === 0) return;
      let last = 0;
      let lastDate = '';
      for (const d of series.dates) {
        if (d <= date) { last = series.map.get(d); lastDate = d; }
        else break;
      }
      if (!(last > 0)) return;
      evalAmt = last;
      const dm = series.depositMap;
      if (dm) {
        const dv = dm.get(lastDate);
        if (Number.isFinite(dv)) seriesDeposit = dv;
      }
    }
    if (evalAmt <= 0) return;
    totalEval += evalAmt;
    const isOverseas = p.accountType === 'overseas';
    const fxRate = isOverseas ? (p.avgExchangeRate || 1) : 1;
    const currentPrincipalKRW = (p.principal || 0) * fxRate;
    const deps = p.depositHistory || [];
    const wds = p.depositHistory2 || [];
    const futureDeposits = deps.filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0) * (isOverseas ? (d.fxRate || 1) : 1), 0);
    const futureWithdrawals = wds.filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0) * (isOverseas ? (d.fxRate || 1) : 1), 0);
    const effPrincipal = isCash
      ? evalAmt
      : Math.max(0, currentPrincipalKRW - futureDeposits + futureWithdrawals);
    totalPrincipal += effPrincipal;
    const depositAmt = isCash
      ? effPrincipal
      : (seriesDeposit != null ? seriesDeposit : (summary?.depositAmount || 0));
    totalDeposit += depositAmt;
    const name = (summary?.name || p.name || p.id) + (p.deletedAt ? ' (삭제됨)' : '');
    const profit = evalAmt - effPrincipal;
    const returnRate = effPrincipal > 0 ? (profit / effPrincipal) * 100 : 0;
    rows.push({ id: p.id, name, evalAmount: evalAmt, principal: effPrincipal, profit, returnRate, depositAmount: depositAmt, rowColor: p.rowColor || '' });
  });
  const totalProfit = totalEval - totalPrincipal;
  return {
    rows: rows.map(r => ({ ...r, weight: totalEval > 0 ? (r.evalAmount / totalEval) * 100 : null })),
    totalEval, totalPrincipal, totalDeposit,
    totalProfit,
    totalReturnRate: totalPrincipal > 0 ? (totalProfit / totalPrincipal) * 100 : null,
  };
};

// ───────── 픽스처 ─────────
const series = (pairs) => ({ dates: pairs.map(([d]) => d), map: new Map(pairs) });
// ⚠️ 예수금 짝 시계열이 실린 series. **`series()`/`mkBase()`를 고쳐서 만들지 말 것** —
//    #1~#19b가 그 픽스처의 값(1200/500/700/120)을 하드코딩하고 있어 소계·예수금 기대치가
//    통째로 어긋난다(#19 주석과 같은 이유). 반드시 덮어쓰기로 만든다.
const seriesD = (pairs, depPairs) => ({ ...series(pairs), depositMap: new Map(depPairs) });

const mkBase = () => ({
  portfolios: [
    { id: 'A', name: '주식A', accountType: 'portfolio', principal: 1000, depositHistory: [], depositHistory2: [] },
    { id: 'C', name: '마통', accountType: 'matong', principal: 0, history: [{ date: '2026-04-01', evalAmount: 500 }, { date: '2026-04-03', evalAmount: 700 }] },
  ],
  portfolioSummaries: [
    { id: 'A', name: '주식A', currentEval: 9999, depositAmount: 120, startDate: '2026-03-01' },
    { id: 'C', name: '마통', currentEval: 800, depositAmount: 0, startDate: '2026-04-01' },
  ],
  accountSeriesById: {
    A: series([['2026-04-01', 1200], ['2026-04-03', 1300]]),
  },
  realtimeDate: '2026-04-10',
  liveTotalEval: 10799,
  activePortfolioId: null,
  activeHistory: null,
});

console.log('\n── 파트① 참조 구현 미러 ──');
{
  // #1 TEST 계좌는 행·소계 모두에서 제외
  const f = mkBase();
  f.portfolios.push({ id: 'T', name: '테스트', accountType: 'portfolio', isTest: true, principal: 100 });
  f.accountSeriesById.T = series([['2026-04-01', 5000]]);
  const r = buildHistDetailRows({ ...f, date: '2026-04-02' });
  ok('#1 isTest 계좌는 행에도 소계에도 없다',
    !r.rows.some(x => x.id === 'T') && near(r.totalEval, 1200 + 500));

  // #2 삭제 계좌는 삭제일 **이전** 날짜에만, 이름에 (삭제됨)
  const f2 = mkBase();
  f2.portfolios.push({ id: 'D', name: '지운계좌', accountType: 'portfolio', deletedAt: '2026-04-03', principal: 100 });
  f2.accountSeriesById.D = series([['2026-04-01', 400]]);
  const before = buildHistDetailRows({ ...f2, date: '2026-04-02' });
  ok('#2 삭제 계좌는 date < deletedAt 에 포함되고 이름에 (삭제됨)',
    before.rows.some(x => x.id === 'D' && x.name === '지운계좌 (삭제됨)') && near(before.totalEval, 1200 + 500 + 400));

  // #3 삭제일 당일부터 제외
  const on = buildHistDetailRows({ ...f2, date: '2026-04-03' });
  ok('#3 date >= deletedAt 이면 삭제 계좌 제외', !on.rows.some(x => x.id === 'D'));

  // #4 realtime 날짜에는 삭제 계좌를 (삭제일이 미래여도) 제외
  const f4 = mkBase();
  f4.portfolios.push({ id: 'D', name: '지운계좌', accountType: 'portfolio', deletedAt: '2026-12-31', principal: 100 });
  f4.accountSeriesById.D = series([['2026-04-01', 400]]);
  f4.portfolioSummaries.push({ id: 'D', name: '지운계좌', currentEval: 400, depositAmount: 0 });
  const rt = buildHistDetailRows({ ...f4, date: '2026-04-10' });
  ok('#4 라이브 시점에는 삭제 계좌 완전 제외', !rt.rows.some(x => x.id === 'D'));

  // #5 liveTotalEval === 0 이면 realtime 아님 → 그 날짜도 스냅샷 규칙
  const f5 = { ...mkBase(), liveTotalEval: 0 };
  const r5 = buildHistDetailRows({ ...f5, date: '2026-04-10' });
  ok('#5 라이브 자산 0이면 realtime 판정 안 함 (스냅샷 carry-forward)',
    near(r5.totalEval, 1300 + 700));

  // #6 현금성 carry-forward — 0도 유효한 스냅샷
  const f6 = mkBase();
  f6.portfolios[1].history = [{ date: '2026-04-01', evalAmount: 500 }, { date: '2026-04-02', evalAmount: 0 }];
  const r6 = buildHistDetailRows({ ...f6, date: '2026-04-05' });
  ok('#6 현금성 0 스냅샷이 carry-forward 되어 행이 사라진다(유령 잔액 방지)',
    !r6.rows.some(x => x.id === 'C') && near(r6.totalEval, 1300));

  // #7 현금성 startDate 이전 날짜는 제외
  const r7 = buildHistDetailRows({ ...mkBase(), date: '2026-03-15' });
  ok('#7 현금성 startDate > date 면 제외', !r7.rows.some(x => x.id === 'C'));

  // #8 현금성은 원금=예수금=평가 → 수익 0
  const r8 = buildHistDetailRows({ ...mkBase(), date: '2026-04-02' });
  const cash = r8.rows.find(x => x.id === 'C');
  ok('#8 현금성은 principal=depositAmount=evalAmount, 수익 0',
    cash && near(cash.principal, 500) && near(cash.depositAmount, 500) && near(cash.profit, 0) && near(cash.returnRate, 0));

  // #9 시장계좌 series carry-forward (date 이하 최신)
  const r9 = buildHistDetailRows({ ...mkBase(), date: '2026-04-02' });
  ok('#9 시장계좌는 date 이하 최신 series 값을 이월', near(r9.rows.find(x => x.id === 'A').evalAmount, 1200));

  // #10 series 없음 / 빈 dates / last <= 0 → 행 없음
  const f10 = mkBase();
  delete f10.accountSeriesById.A;
  const noSeries = buildHistDetailRows({ ...f10, date: '2026-04-02' });
  const f10b = mkBase(); f10b.accountSeriesById.A = series([]);
  const emptyDates = buildHistDetailRows({ ...f10b, date: '2026-04-02' });
  const f10c = mkBase(); f10c.accountSeriesById.A = series([['2026-04-01', 0]]);
  const zero = buildHistDetailRows({ ...f10c, date: '2026-04-02' });
  ok('#10 series 없음·빈 dates·값 0 이면 시장계좌 행 없음',
    !noSeries.rows.some(x => x.id === 'A') && !emptyDates.rows.some(x => x.id === 'A') && !zero.rows.some(x => x.id === 'A'));

  // #11 해외계좌: principal × avgExchangeRate, 미래 원장은 d.fxRate 로 환산
  const f11 = {
    portfolios: [{
      id: 'O', name: '해외', accountType: 'overseas', principal: 100, avgExchangeRate: 1300,
      depositHistory: [{ date: '2026-05-01', amount: 10, fxRate: 1400 }],
      depositHistory2: [{ date: '2026-05-02', amount: 5, fxRate: 1200 }],
    }],
    portfolioSummaries: [{ id: 'O', name: '해외', depositAmount: 0 }],
    accountSeriesById: { O: series([['2026-04-01', 200000]]) },
    realtimeDate: '', liveTotalEval: 0,
  };
  const r11 = buildHistDetailRows({ ...f11, date: '2026-04-02' });
  ok('#11 해외 원금 = principal×avgExchangeRate − 미래입금×fxRate + 미래출금×fxRate',
    near(r11.rows[0].principal, 100 * 1300 - 10 * 1400 + 5 * 1200));

  // #12 원금은 0으로 클램프
  const f12 = JSON.parse(JSON.stringify({ ...f11, portfolios: [{ ...f11.portfolios[0], principal: 1, avgExchangeRate: 1 }] }));
  f12.accountSeriesById = { O: series([['2026-04-01', 200000]]) };
  f12.realtimeDate = ''; f12.liveTotalEval = 0;
  const r12 = buildHistDetailRows({ ...f12, date: '2026-04-02' });
  ok('#12 원금은 Math.max(0, …) 로 클램프', near(r12.rows[0].principal, 0));

  // #13 Σ weight === 100
  const r13 = buildHistDetailRows({ ...mkBase(), date: '2026-04-02' });
  ok('#13 Σ weight === 100 (비중 분모는 표에 포함된 계좌 합)',
    near(r13.rows.reduce((s, x) => s + x.weight, 0), 100, 1e-9));

  // #14 소계는 행에 포함된 계좌만 누적 (제외된 계좌가 분모에 새지 않는다)
  const f14 = mkBase();
  f14.portfolios.push({ id: 'T2', name: '테스트2', accountType: 'portfolio', isTest: true, principal: 99999 });
  f14.accountSeriesById.T2 = series([['2026-04-01', 99999]]);
  const r14 = buildHistDetailRows({ ...f14, date: '2026-04-02' });
  ok('#14 제외된 계좌는 totalEval/totalPrincipal 어디에도 없다',
    near(r14.totalEval, 1200 + 500) && near(r14.totalPrincipal, 1000 + 500));

  // #15 totalPrincipal <= 0 → totalReturnRate === null (null 계약)
  const f15 = {
    portfolios: [{ id: 'Z', name: 'Z', accountType: 'portfolio', principal: 0, depositHistory: [], depositHistory2: [] }],
    portfolioSummaries: [{ id: 'Z', name: 'Z', depositAmount: 0 }],
    accountSeriesById: { Z: series([['2026-04-01', 5000]]) },
    realtimeDate: '', liveTotalEval: 0,
  };
  const r15 = buildHistDetailRows({ ...f15, date: '2026-04-02' });
  ok('#15 totalPrincipal 0 이면 totalReturnRate === null (0으로 단언 금지)',
    r15.rows.length === 1 && near(r15.totalPrincipal, 0) && r15.totalReturnRate === null);

  // #16 도달성 고정 — 미래 입금이 원금을 넘겨 전 계좌가 0 클램프되는 날짜가 실재한다.
  //     (지적 1이 지목한 fmtPct(null) 폭발 경로. 이 픽스처가 사라지면 그 가드가 죽은 단언이 된다.)
  const f16 = {
    portfolios: [{
      id: 'K', name: 'K', accountType: 'portfolio', principal: 1000,
      depositHistory: [{ date: '2026-04-20', amount: 5000 }], depositHistory2: [],
    }],
    portfolioSummaries: [{ id: 'K', name: 'K', depositAmount: 0 }],
    accountSeriesById: { K: series([['2026-04-01', 300]]) },
    realtimeDate: '', liveTotalEval: 0,
  };
  const r16 = buildHistDetailRows({ ...f16, date: '2026-04-02' });
  ok('#16 rows.length > 0 인데 totalReturnRate === null 인 날짜가 실재한다 (tfoot이 렌더된다)',
    r16.rows.length > 0 && r16.totalReturnRate === null);

  // #17 빈 결과도 같은 형태 (소비자 가드 균일성)
  const empty = buildHistDetailRows({ date: '', portfolios: [] });
  ok('#17 빈 결과 형태 = EMPTY_HIST_DETAIL (rows/totalProfit/totalReturnRate 키 존재)',
    Array.isArray(empty.rows) && empty.rows.length === 0
    && empty.totalProfit === 0 && empty.totalReturnRate === null
    && 'totalDeposit' in empty && 'totalPrincipal' in empty);

  // #18 realtime 날짜에는 summary.currentEval 을 쓴다(통합 표 합계와 일치)
  const r18 = buildHistDetailRows({ ...mkBase(), date: '2026-04-10' });
  ok('#18 realtime 날짜는 summary.currentEval 합 = liveTotalEval',
    near(r18.totalEval, 9999 + 800));

  // #19 활성 계좌는 p.history가 아니라 activeHistory를 읽는다.
  // ⚠️ mkBase()를 고쳐서 이 케이스를 만들지 말 것 — #1~#18이 그 픽스처의 값(1200/500/700)을
  //    하드코딩하고 있어 소계 기대치가 통째로 어긋난다. 반드시 덮어쓰기로 만든다.
  // (현재 usePortfolioState가 현금성 계좌의 활성화를 막아 실행상 도달 불가하지만, 그 게이트가
  //  완화되는 순간 팝업 소계만 stale한 p.history를 읽는지 여부를 게이트가 판정해야 한다.)
  const f19 = { ...mkBase(), activePortfolioId: 'C', activeHistory: [{ date: '2026-04-02', evalAmount: 900 }] };
  const r19 = buildHistDetailRows({ ...f19, date: '2026-04-02' });
  ok('#19 활성 계좌는 activeHistory 우선 (p.history의 500이 아니라 900)',
    near(r19.rows.find(x => x.id === 'C').evalAmount, 900));

  // #19b activeHistory가 없으면 p.history 폴백 (원본 useMemo와 동일 동작)
  const r19b = buildHistDetailRows({ ...mkBase(), activePortfolioId: 'C', date: '2026-04-02' });
  ok('#19b activeHistory 미제공이면 p.history 폴백',
    near(r19b.rows.find(x => x.id === 'C').evalAmount, 500));

  // ── #20~#25 시장 계좌 예수금 = **그날의 기록값**(자산검증과 같은 소스) ──
  // 2026-08 사용자 보고: 과거 날짜를 눌러도 예수금 칸만 '오늘의 라이브 예수금'이 떴다.
  // 소스는 accountSeriesById[].depositMap(평가액을 만든 그 계산에서 나온 짝) 하나다.

  // #20 depositMap이 있으면 그 날짜 값을 쓴다 (summary.depositAmount=120 을 쓰지 않는다)
  const f20 = mkBase();
  f20.accountSeriesById.A = seriesD(
    [['2026-04-01', 1200], ['2026-04-03', 1300]],
    [['2026-04-01', 300], ['2026-04-03', 700]]);
  const r20a = buildHistDetailRows({ ...f20, date: '2026-04-01' });
  const r20b = buildHistDetailRows({ ...f20, date: '2026-04-03' });
  ok('#20 시장계좌 예수금은 그날의 depositMap 값 (라이브 120 아님)',
    near(r20a.rows.find(x => x.id === 'A').depositAmount, 300)
    && near(r20b.rows.find(x => x.id === 'A').depositAmount, 700));

  // #21 ⚠️ 평가액이 이월된 날은 예수금도 **같은 커서(lastDate)** 값이어야 한다.
  //     `date`로 다시 조회하는 구현이면 여기서 4/03의 700이 새어 나온다.
  const r21 = buildHistDetailRows({ ...f20, date: '2026-04-02' });
  const a21 = r21.rows.find(x => x.id === 'A');
  ok('#21 이월된 날은 평가액·예수금이 같은 날짜(4/01)에서 온다',
    near(a21.evalAmount, 1200) && near(a21.depositAmount, 300));

  // #22 소계(totalDeposit)도 그날 값의 합이다 (현금성은 종전대로 평가액=예수금)
  ok('#22 totalDeposit = 그날 예수금 합 (300 + 마통 500)',
    near(r21.totalDeposit, 300 + 500));

  // #23 하위호환 — depositMap이 없으면 종전대로 summary.depositAmount 폴백
  const r23 = buildHistDetailRows({ ...mkBase(), date: '2026-04-02' });
  ok('#23 depositMap 미제공이면 summary 폴백(120) — 종전 동작 유지',
    near(r23.rows.find(x => x.id === 'A').depositAmount, 120));

  // #23b 그 날짜에만 값이 없으면(부분 제공) 그 행만 폴백한다
  const f23b = mkBase();
  f23b.accountSeriesById.A = seriesD(
    [['2026-04-01', 1200], ['2026-04-03', 1300]],
    [['2026-04-03', 700]]);   // 4/01 미설정
  ok('#23b depositMap에 그 커서 값이 없으면 그 행만 summary 폴백',
    near(buildHistDetailRows({ ...f23b, date: '2026-04-02' }).rows.find(x => x.id === 'A').depositAmount, 120)
    && near(buildHistDetailRows({ ...f23b, date: '2026-04-03' }).rows.find(x => x.id === 'A').depositAmount, 700));

  // #24 예수금 0은 유효한 기록이다 — falsy로 뭉뚱그려 summary(120)로 폴백하면 안 된다
  const f24 = mkBase();
  f24.accountSeriesById.A = seriesD([['2026-04-01', 1200]], [['2026-04-01', 0]]);
  ok('#24 예수금 0도 그대로 표시한다 (`||` 폴백 금지)',
    near(buildHistDetailRows({ ...f24, date: '2026-04-02' }).rows.find(x => x.id === 'A').depositAmount, 0));

  // #25 오늘(realtime) 행은 **라이브**가 정답이다 — 평가액도 summary.currentEval이라 같은 프레임.
  const r25 = buildHistDetailRows({ ...f20, date: '2026-04-10' });
  ok('#25 realtime 행은 summary.depositAmount(라이브 120) 유지',
    near(r25.rows.find(x => x.id === 'A').depositAmount, 120));

  // #26 예수금 ⊆ 평가금액 — 같은 계산에서 나온 짝이므로 구조적으로 성립한다
  const overs = ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-05']
    .flatMap(d => buildHistDetailRows({ ...f20, date: d }).rows)
    .filter(r => r.depositAmount > r.evalAmount);
  ok('#26 어느 날짜에도 예수금 > 평가금액이 없다', overs.length === 0);
}

console.log('\n── 파트② 교차검증 (달력 칸 총자산 = 팝업 소계) ──');
{
  // useIntegratedData computedIntHistory 의 집계 규칙만 좁게 미러한다(훅 전체 미러 금지).
  //   시장계좌: dates[i] <= d 인 마지막 값 carry-forward, lastVal > 0 이면 가산
  //   현금성  : 같은 carry-forward + (d === today ? currentEval : lastVal) + startDate 이전 0
  const chartTotalAt = (date, { accountSeries, cashSeries, today, liveTotalEval }) => {
    if (today && date === today && liveTotalEval > 0) return liveTotalEval;
    let total = 0;
    accountSeries.forEach(({ dates, map }) => {
      let last = 0;
      for (const d of dates) { if (d <= date) last = map.get(d); else break; }
      if (last > 0) total += last;
    });
    cashSeries.forEach(({ startDate, dates, map }) => {
      let last = 0;
      for (const d of dates) { if (d <= date) last = map.get(d); else break; }
      let v = last;
      if (startDate && date < startDate) v = 0;
      if (v > 0) total += v;
    });
    return total;
  };

  const f = mkBase();
  const agg = {
    accountSeries: [f.accountSeriesById.A],
    cashSeries: [{ startDate: '2026-04-01', dates: ['2026-04-01', '2026-04-03'], map: new Map([['2026-04-01', 500], ['2026-04-03', 700]]) }],
    today: f.realtimeDate,
    liveTotalEval: f.liveTotalEval,
  };

  const dates = ['2026-03-15', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-05'];
  const mismatch = dates.filter(d => !near(buildHistDetailRows({ ...f, date: d }).totalEval, chartTotalAt(d, agg)));
  ok(`#X1 과거 날짜 소계 = 추이 차트 그날 값 (불일치 ${mismatch.length}건: ${mismatch.join(',') || '없음'})`, mismatch.length === 0);

  ok('#X2 realtime 날짜 소계 = intTotals.totalEval (라이브 합)',
    near(buildHistDetailRows({ ...f, date: '2026-04-10' }).totalEval, chartTotalAt('2026-04-10', agg)));

  // 삭제 계좌도 같은 경계 규칙 — 차트는 cutoff 이후 미기여, 팝업도 date >= deletedAt 제외
  const f3 = mkBase();
  f3.portfolios.push({ id: 'D', name: 'D', accountType: 'portfolio', deletedAt: '2026-04-03', principal: 0 });
  f3.accountSeriesById.D = series([['2026-04-01', 400]]);
  const aggD = {
    ...agg,
    accountSeries: [f3.accountSeriesById.A, { ...f3.accountSeriesById.D, deletedAt: '2026-04-03' }],
  };
  const chartWithCutoff = (date) => {
    let total = 0;
    aggD.accountSeries.forEach(({ dates: ds, map, deletedAt }) => {
      if (deletedAt && date >= deletedAt) return;   // cutoff 이후 미기여
      let last = 0;
      for (const d of ds) { if (d <= date) last = map.get(d); else break; }
      if (last > 0) total += last;
    });
    aggD.cashSeries.forEach(({ startDate, dates: ds, map }) => {
      let last = 0;
      for (const d of ds) { if (d <= date) last = map.get(d); else break; }
      let v = last;
      if (startDate && date < startDate) v = 0;
      if (v > 0) total += v;
    });
    return total;
  };
  const bad3 = ['2026-04-02', '2026-04-03', '2026-04-05']
    .filter(d => !near(buildHistDetailRows({ ...f3, date: d }).totalEval, chartWithCutoff(d)));
  ok(`#X3 삭제 계좌 경계도 차트와 같은 규칙 (불일치 ${bad3.length}건)`, bad3.length === 0);
}

console.log('\n── 파트②-b 미러 드리프트 가드 (실제 모듈 vs 미러) ──');
{
  // ⚠️ 위 미러는 **복사본**이라 src/utils.ts만 고치면 전부 초록으로 통과한다(그 반대도 마찬가지).
  //    utils.ts는 import가 하나도 없어 Node가 타입만 벗겨 그대로 실행할 수 있으므로, 실제 모듈을
  //    불러 같은 픽스처로 결과를 대조한다(verify-backtest #450 선례).
  //    지원하지 않는 런타임에서는 명시적으로 건너뛴다고 출력한다 — 조용히 통과시키지 않는다.
  let real = null;
  try { real = await import(new URL('../src/utils.ts', import.meta.url).href); }
  catch (e) { real = null; console.log(`  … 실제 모듈 import 불가로 건너뜀 (${String(e && e.message).slice(0, 80)})`); }

  if (real && typeof real.buildHistDetailRows === 'function') {
    const cases = [];
    const push = (label, opts) => cases.push({ label, opts });
    const b = mkBase();
    ['2026-03-15', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-10'].forEach(d => push(`base ${d}`, { ...b, date: d }));

    const t = mkBase();
    t.portfolios.push({ id: 'T', name: '테스트', accountType: 'portfolio', isTest: true, principal: 100 });
    t.accountSeriesById.T = series([['2026-04-01', 5000]]);
    push('isTest', { ...t, date: '2026-04-02' });

    const del = mkBase();
    del.portfolios.push({ id: 'D', name: '지운계좌', accountType: 'portfolio', deletedAt: '2026-04-03', principal: 100 });
    del.accountSeriesById.D = series([['2026-04-01', 400]]);
    push('deleted-before', { ...del, date: '2026-04-02' });
    push('deleted-on', { ...del, date: '2026-04-03' });

    push('overseas', {
      date: '2026-04-02',
      portfolios: [{
        id: 'O', name: '해외', accountType: 'overseas', principal: 100, avgExchangeRate: 1300,
        depositHistory: [{ date: '2026-05-01', amount: 10, fxRate: 1400 }],
        depositHistory2: [{ date: '2026-05-02', amount: 5, fxRate: 1200 }],
      }],
      portfolioSummaries: [{ id: 'O', name: '해외', depositAmount: 0 }],
      accountSeriesById: { O: series([['2026-04-01', 200000]]) },
      realtimeDate: '', liveTotalEval: 0,
    });

    push('zero-principal', {
      date: '2026-04-02',
      portfolios: [{ id: 'K', name: 'K', accountType: 'portfolio', principal: 1000, depositHistory: [{ date: '2026-04-20', amount: 5000 }], depositHistory2: [] }],
      portfolioSummaries: [{ id: 'K', name: 'K', depositAmount: 0 }],
      accountSeriesById: { K: series([['2026-04-01', 300]]) },
      realtimeDate: '', liveTotalEval: 0,
    });
    push('empty', { date: '', portfolios: [] });
    push('active-cash', { ...mkBase(), activePortfolioId: 'C', activeHistory: [{ date: '2026-04-02', evalAmount: 900 }], date: '2026-04-02' });

    // ⚠️ depositMap 케이스가 없으면 이 가드는 새 분기에 **눈이 먼다**(죽은 단언) — 예수금 커서를
    //    `date`로 바꾸거나 `||` 폴백으로 되돌려도 드리프트 0건으로 통과한다.
    const dep = mkBase();
    dep.accountSeriesById.A = seriesD(
      [['2026-04-01', 1200], ['2026-04-03', 1300]],
      [['2026-04-01', 300], ['2026-04-03', 700]]);
    ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-10'].forEach(d => push(`depositMap ${d}`, { ...dep, date: d }));
    const depPartial = mkBase();
    depPartial.accountSeriesById.A = seriesD([['2026-04-01', 1200]], [['2026-04-01', 0]]);
    push('depositMap zero', { ...depPartial, date: '2026-04-02' });

    const drift = cases.filter(({ opts }) =>
      JSON.stringify(buildHistDetailRows(opts)) !== JSON.stringify(real.buildHistDetailRows(opts)));
    ok(`#D1 실제 utils.buildHistDetailRows 와 미러가 일치한다 (드리프트 ${drift.length}건: ${drift.map(d => d.label).join(', ') || '없음'})`,
      drift.length === 0);
    ok('#D2 실제 모듈의 EMPTY_HIST_DETAIL 형태가 미러와 같다',
      JSON.stringify(real.EMPTY_HIST_DETAIL) === JSON.stringify(EMPTY_HIST_DETAIL));
  }
}

console.log('\n── 파트③ 소스 텍스트 가드 ──');
{
  const utils = read('src/utils.ts');
  const app = read('src/App.tsx');
  const id = read('src/components/IntegratedDashboard.tsx');
  const cal = read('src/components/CalendarModal.tsx');
  const win = read('src/components/CalendarWindow.tsx');

  ok('#G0 utils가 buildHistDetailRows·EMPTY_HIST_DETAIL 를 내보낸다',
    /export const buildHistDetailRows/.test(utils) && /export const EMPTY_HIST_DETAIL/.test(utils));

  // ── IntegratedDashboard: 자체 계산 부활 차단 ──
  const hdr = id.slice(id.indexOf('const histDetailRows = useMemo'), id.indexOf('// 앱 기록 시작일'));
  ok('#G1 histDetailRows는 utils 함수 호출 한 곳뿐 (자체 계산 부활 차단)',
    hdr.length > 100 && /buildHistDetailRows\(\{/.test(hdr)
    && !/intAccountSeriesById\[/.test(hdr) && !/p\.isTest/.test(hdr) && !/rows\.push/.test(hdr));

  const idPopup = id.slice(id.indexOf('{histDetailDate && ('), id.indexOf('{memoModal && ('));
  ok('#G2 통합 대시보드 팝업은 파생값을 그대로 쓴다 (즉석 계산 부활 차단)',
    idPopup.length > 500
    && /r\.weight == null \? '-' :/.test(idPopup)
    && /histDetailRows\.totalProfit/.test(idPopup)
    && /histDetailRows\.totalReturnRate == null \? '-' :/.test(idPopup)
    && !/r\.evalAmount \/ histDetailRows\.totalEval/.test(idPopup));

  // ⚠️ '값'만 단언하면 색 판정이 `?? 0`으로 되돌아가도 통과한다(변이 N5로 실증한 죽은 단언) —
  //    그때 산출 불가('-')가 이익(빨강)으로 색칠되고 같은 날짜의 ASSET 패드(회색)와도 갈린다.
  ok('#G2b tfoot 수익률은 **색도** null 계약을 따른다 (`?? 0` 뭉뚱그리기 차단)',
    /totalReturnRate == null \? 'text-gray-400'/.test(idPopup)
    && !/\(histDetailRows\.totalReturnRate \?\? 0\)/.test(idPopup));

  // ── App: 단일 소스 · 렌더 중 ref 대입 · 입양 게이트 순서 ──
  ok('#G3 App이 utils 함수를 import하고 histDetailFnRef를 렌더 중 대입한다',
    /buildHistDetailRows, EMPTY_HIST_DETAIL/.test(app)
    && /const buildHistDetail = useCallback\(\(date\) => buildHistDetailRows\(\{/.test(app)
    && /^\s*histDetailFnRef\.current = buildHistDetail;$/m.test(app));

  const iAdopt = app.indexOf("e.source !== calWinRef.current");
  const iWant = app.indexOf("d.type === 'calendar:wantDetail'");
  ok('#G4 calendar:wantDetail 분기는 입양 게이트 **뒤**에 있다 (미입양 창의 자산 조회 차단)',
    iAdopt > 0 && iWant > 0 && iAdopt < iWant);

  const liveMsg = app.slice(app.indexOf("type: 'calendar:live',"), app.indexOf('}, [calendarMemos,'));
  ok('#G5 calendar:live payload에 상세 행을 얹지 않는다 (시세 틱마다 전 계좌 복제 차단)',
    liveMsg.length > 100 && !/rows/.test(liveMsg) && !/buildHistDetail/.test(liveMsg) && /hideAmounts,/.test(liveMsg));

  const appCal = app.slice(app.indexOf('<CalendarModal'), app.indexOf('</ErrorBoundary>', app.indexOf('<CalendarModal')));
  ok('#G6 App이 <CalendarModal>에 buildHistDetail·hideAmounts를 전달한다',
    /buildHistDetail=\{buildHistDetail\}/.test(appCal) && /hideAmounts=\{hideAmounts\}/.test(appCal));

  ok('#G7 App의 <CalendarModal>은 ErrorBoundary label="메모 달력" 안에 있다',
    /<ErrorBoundary label="메모 달력">\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<CalendarModal/.test(app)
    || app.indexOf('<ErrorBoundary label="메모 달력">') < app.indexOf('<CalendarModal')
    && app.indexOf('<CalendarModal') < app.indexOf('</ErrorBoundary>', app.indexOf('<ErrorBoundary label="메모 달력">')));

  // ── CalendarWindow: 화이트리스트 · markGotData 금지 · 재연결 ──
  ok('#G8 새 창 수신 화이트리스트에 calendar:detail 이 있다 (없으면 영원히 로딩)',
    /d\.type !== 'calendar:detail'/.test(win));

  const winDetailRaw = win.slice(win.indexOf("} else if (d.type === 'calendar:detail') {"), win.indexOf('    };', win.indexOf("} else if (d.type === 'calendar:detail') {")));
  const winDetail = stripComments(winDetailRaw);
  ok('#G9 calendar:detail 분기는 markGotData를 부르지 않는다 (저장 메모 전량 소실 경로 차단)',
    winDetailRaw.length > 200 && !/markGotData/.test(winDetail) && /d\.date !== detailDateRef\.current/.test(winDetail));

  const winReconnect = win.slice(win.indexOf('const was = prevLinkedRef.current'), win.indexOf('}, [linked, requestDetail]);'));
  ok('#G10 재연결 시 무조건 재구독한다 (ready면 건너뛰기 금지)',
    winReconnect.length > 40 && !/status !== 'ready'/.test(winReconnect) && /requestDetail\(detailDateRef\.current\)/.test(winReconnect));

  const reqFn = stripComments(win.slice(win.indexOf('const requestDetail = useCallback'), win.indexOf('}, [post]);', win.indexOf('const requestDetail = useCallback'))));
  ok('#G18 requestDetail(null)이 해제 메시지를 먼저 보낸다 (조기 반환 복귀 차단)',
    reqFn.length > 100 && /if \(!date\) \{[^}]*calendar:wantDetail[^}]*date: null/.test(reqFn));

  ok('#G18b 앱 재입양(calendar:accounts)도 재구독 트리거다 (13초 미만 새로고침에서 표가 어는 것 차단)',
    /setAccountsSeq\(\(s\) => s \+ 1\)/.test(win)
    && /if \(accountsSeq > 0 && detailDateRef\.current\) requestDetail\(detailDateRef\.current\)/.test(win)
    && /\}, \[accountsSeq, requestDetail\]\)/.test(win));

  const pushEff = stripComments(app.slice(app.indexOf('const d = calWinDetailDateRef.current;'), app.indexOf('}, [buildHistDetail, calWinNonce]);')));
  ok('#G18c 구독 푸시는 창 생존 확인을 **계산 앞**에서 한다 (닫힌 창을 위한 영구 재계산 차단)',
    pushEff.length > 80 && pushEff.indexOf('w.closed') < pushEff.indexOf('buildHistDetail(d)'));

  ok('#G10b 새 창은 <CalendarModal>을 label 있는 ErrorBoundary로 감싸고 구독 prop을 전달한다',
    /<ErrorBoundary label="메모 달력">/.test(win)
    && /accountDetail=\{detail\}/.test(win) && /onRequestAccountDetail=\{requestDetail\}/.test(win));

  // ── CalendarModal: open 게이트 · null 가드 · 진입점 · 읽기 전용 ──
  const padDetailMemo = cal.slice(cal.indexOf('const padDetail = useMemo'), cal.indexOf('const detailKey ='));
  ok('#G11 padDetail은 open 게이트를 갖고 deps에 open이 있다 (닫힌 뒤 영구 재계산 차단)',
    padDetailMemo.length > 100 && /if \(!open \|\| !pad \|\| pad\.kind !== 'detail'\) return null;/.test(padDetailMemo)
    && /\}, \[open, pad,/.test(padDetailMemo));

  const detailRender = cal.slice(cal.indexOf("pad.kind === 'detail' ? ("), cal.indexOf("pad.kind === 'pick' ? ("));
  ok('#G12 상세 표의 % 출력은 전부 pctCell 경유다 (fmtPct 직접 호출 0회 — null 폭발 차단)',
    detailRender.length > 1000 && !/fmtPct\(/.test(detailRender)
    && (detailRender.match(/pctCell\(/g) || []).length >= 2
    && /pctCell\(padDetail\.totalReturnRate\)/.test(detailRender));

  const detailCode = stripComments(detailRender);
  ok('#G13 상세 표는 읽기 전용이고 금액 마스킹·이상치 배너를 갖는다',
    !/confirm\(/.test(detailCode) && !/notify\(/.test(detailCode)
    && (detailCode.match(/maskMoney\(/g) || []).length >= 8
    && /flowSuspect/.test(detailCode));

  const FIELDS = ['principal', 'evalAmount', 'weight', 'depositAmount', 'profit', 'returnRate'];
  const missing = FIELDS.filter(f => !detailRender.includes(`r.${f}`) || !idPopup.includes(`r.${f}`));
  ok(`#G14 두 렌더러가 같은 열 집합을 쓴다 (누락: ${missing.join(',') || '없음'})`,
    missing.length === 0
    && /padDetail\.totalDeposit/.test(detailRender) && /histDetailRows\.totalDeposit/.test(idPopup));

  const cellBlock = cal.slice(cal.indexOf('{rawMetric && ('), cal.indexOf('{(dayRebals.length > 0'));
  ok('#G15 칸 자산 스냅샷이 클릭 진입점이고 stopPropagation을 한다 (메모 추가와 충돌 차단)',
    cellBlock.length > 200
    && /onClick=\{canOpenDetail \? \(e\) => \{ e\.stopPropagation\(\); openDetail\(key\); \} : undefined\}/.test(cellBlock)
    && /hideAmounts \? '••••••' : fmtAbbrev\(rawMetric\.evalAmount\)/.test(cellBlock));

  ok('#G16 ASSET 패드는 savePad allow-list 밖(읽기 전용)이고 헤더 라벨이 등록돼 있다',
    /if \(pad\.kind\) \{ setPad\(null\); return; \}/.test(cal)
    && /detail: 'ASSET'/.test(cal)
    && /\(!pad\.kind \|\| pad\.kind === 'note'\)/.test(cal));

  // ── 예수금 = 그날의 기록값 (미러로는 표현 못 하는 **공급측** 배선) ──
  const intg = read('src/hooks/useIntegratedData.ts');

  ok('#G19 utils가 depositEvalOf·depositAmountAt 를 내보낸다',
    /export const depositEvalOf/.test(utils) && /export const depositAmountAt/.test(utils));

  // ⚠️ 선언이 아니라 **사용부**를 단언한다 — 커서를 `date`로 되돌리거나 `||` 폴백으로 바꾸면
  //    과거 날짜에 오늘 예수금이 다시 뜬다(2026-08 사용자 보고 버그).
  const hdBody = utils.slice(utils.indexOf('export const buildHistDetailRows'), utils.indexOf('export const buildRebalTargetEntryFrom'));
  ok('#G20 팝업은 예수금을 평가액과 **같은 커서(lastDate)** 로 읽는다',
    hdBody.length > 500
    && /\{ last = series\.map\.get\(d\); lastDate = d; \}/.test(hdBody)
    && /const dv = dm\.get\(lastDate\);/.test(hdBody)
    && !/depositMap\.get\(date\)/.test(hdBody));
  ok('#G21 시장계좌 예수금 폴백은 `!= null` 이다 (0을 삼키는 `||` 금지)',
    /seriesDeposit != null \? seriesDeposit : \(summary\?\.depositAmount \|\| 0\)/.test(hdBody));

  // ⚠️ 평가액이 이월된 날 예수금만 최신이 되면 '예수금 > 평가금액'이 난다 → 짝으로 이월할 것.
  const bces = utils.slice(utils.indexOf('export const buildCloseEvalSeries'), utils.indexOf('export const calcPortfolioEvalForDate'));
  ok('#G22 buildCloseEvalSeries가 예수금을 평가액과 **짝으로** 이월한다',
    /lastClose = closeVal; lastDeposit = depVal;/.test(bces)
    && /depositOut\.set\(date, lastDeposit\)/.test(bces)
    && /depVal = depositEvalOf\(r\.items\)/.test(bces));

  const ms = intg.slice(intg.indexOf('const marketSeries = useMemo'), intg.indexOf('const computedIntHistory'));
  ok('#G23 marketSeries가 depositMap을 만들어 series에 실어 보낸다 (배선 0곳으로 두 렌더러 도달)',
    ms.length > 500
    && /const depositMap = new Map\(\);/.test(ms)
    && /\{ depositOut: depositMap \}/.test(ms)
    && /dates: dateKeys, map, depositMap,/.test(ms));
  // ⚠️ 해외는 평가액을 만든 **그 호출의 detail**에서 뽑아야 그날 환율 프레임이 일치한다
  //    (summary.depositAmount는 라이브 환율 — 되돌리면 예수금만 프레임이 갈린다).
  ok('#G24 해외 분기는 같은 calcPortfolioEvalDetail 결과에서 예수금을 뽑는다',
    /const dep = depositEvalOf\(r\.items\);/.test(ms)
    && /map\.set\(date, r\.total\); depositMap\.set\(date, dep\);/.test(ms));
  ok('#G25 저장값 폴백 날짜도 같은 날짜의 스냅샷 예수금으로 짝을 맞춘다',
    /const dep = depositAmountAt\(src, date\);/.test(ms) && /if \(dep != null\) depositMap\.set\(date, dep\);/.test(ms));

  // #27b(verify:transfer) 센티넬 구간 보호 — 신규 훅이 그 위로 올라가면 그 게이트가 깨진다
  const sentinel = cal.slice(cal.indexOf('const transfersByDate'), cal.indexOf('// 패드는 전부 앵커'));
  ok('#G17 신규 훅이 transfersByDate 센티넬 구간을 침범하지 않는다 (verify:transfer #27b 보호)',
    sentinel.length > 200 && !/setPad/.test(sentinel) && !/padDetail/.test(sentinel));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:cal-detail — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
