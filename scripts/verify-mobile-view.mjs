#!/usr/bin/env node
// 휴대폰 화면 검증 — 사용자 확정 2026-11-27(미래에셋 MY자산 구조 참고 시안) · 2026-11-28 화면 폭과 상관없이 기본(PC 화면은 고를 때만).
//   src/mobileView.ts 를 직접 import한다(미러 금지). 런타임이 .ts를 못 읽으면 단위 검사만 건너뛴다.
//   ⚠️ 휴대폰 화면은 '모양만' 다르다 — PC 본문을 그대로 마운트한 채 위에 덮고, 같은 App 상태·핸들러만 쓴다.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let M = null;
try { M = await import(pathToFileURL(join(ROOT, 'src/mobileView.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/mobileView.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

console.log('\n── 파트① 배경·PC 화면 보기 ──');
if (M) {
  const s = mem();
  ok('#T1 기본은 시스템 연동', M.readMobileTheme(s) === 'system' && M.readMobileTheme(null) === 'system');
  M.writeMobileTheme(s, 'beige');
  ok('#T2 고른 배경을 이 기기에 저장', M.readMobileTheme(s) === 'beige');
  M.writeMobileTheme(s, 'system');
  ok('#T3 시스템 연동을 고르면 저장 칸을 지운다(기본값)', !s.m.has(M.MOBILE_THEME_KEY));
  s.setItem(M.MOBILE_THEME_KEY, 'pink');
  ok('#T4 모르는 값은 시스템 연동', M.readMobileTheme(s) === 'system');
  ok('#T5 시스템 연동 = 다크면 블랙, 라이트면 밝은 베이지', M.resolveMobileTheme('system', true) === 'black' && M.resolveMobileTheme('system', false) === 'beige');
  ok('#T6 고른 배경은 휴대폰 설정과 무관', M.resolveMobileTheme('beige', true) === 'beige' && M.resolveMobileTheme('black', false) === 'black' && M.resolveMobileTheme('navy', false) === 'navy');
  ok('#T7 고르기 목록 = 시스템·블랙·밝은 베이지·남색, 기본은 시스템 하나', M.MOBILE_THEME_OPTIONS.map(o => o.key).join() === 'system,black,beige,navy' && M.MOBILE_THEME_OPTIONS.filter(o => o.isDefault).map(o => o.key).join() === 'system');
  ok('#T8 배경마다 같은 색 이름을 모두 가진다', ['black', 'beige', 'navy'].every(k => ['bg', 'card', 'text', 'sub', 'up', 'down', 'line', 'sheet', 'overlay'].every(c => typeof M.MOBILE_THEMES[k][c] === 'string')));
  const ss = mem();
  ok('#P1 PC 화면 보기 기본 꺼짐', M.readPcView(ss) === false);
  M.writePcView(ss, true);
  ok('#P2 PC 화면 보기 켬/끔', M.readPcView(ss) === true && (M.writePcView(ss, false), M.readPcView(ss) === false));
  ok('#P3 화면 폭과 상관없이 휴대폰 화면이 기본 — PC 화면은 고른 탭만(사용자 확정 2026-11-28)', M.isMobileViewOn(false) === true && M.isMobileViewOn(true) === false);
  ok('#P4 넓은 화면은 가운데 한 줄(최대 폭) · 좁은 화면 기준 768px 미만(돌아가기 단추 모양만)', M.MOBILE_COL_MAX >= 360 && M.MOBILE_COL_MAX <= 720 && M.MOBILE_QUERY === '(max-width: 767px)');
  ok('#P5 덮개 z는 PIN 창(500)·사진 맞추기(1000)보다 아래, PC 고정 메뉴(100)보다 위', M.MOBILE_Z > 100 && M.MOBILE_Z < 300);
}

console.log('\n── 파트② 숫자 모양 ──');
if (M) {
  ok('#F1 원 단위 쉼표', M.fmtWon(1234567.4) === '1,234,567' && M.fmtWon('1,000') === '1,000' && M.fmtWon(null) === '0');
  ok('#F2 부호', M.fmtSigned(1500) === '+1,500' && M.fmtSigned(-1500) === '-1,500' && M.fmtSigned(0) === '0' && M.fmtSigned(-0.2) === '0');
  ok('#F3 수익률 두 자리·부호', M.fmtPct(2.289) === '+2.29' && M.fmtPct(-14.87) === '-14.87' && M.fmtPct(0) === '0.00' && M.fmtPct(-0.001) === '0.00');
  ok('#F4 달러(빼기는 $ 앞)', M.fmtUsd(1228.4) === '$1,228.40' && M.fmtUsd(-17.9) === '-$17.90');
  ok('#F5 색 방향 = 빨강 오름 / 파랑 내림', M.toneOf(1) === 'up' && M.toneOf(-1) === 'down' && M.toneOf(0) === 'flat');
  ok('#F6 날짜 짧게', M.shortDate('2026-11-27') === '11/27' && M.shortDate('') === '');
}

console.log('\n── 파트③ 대시보드 계좌 목록 ──');
if (M) {
  const portfolios = [
    { id: 'a', accountType: 'dc-irp', name: '퇴직' }, { id: 'b', accountType: 'isa' }, { id: 'c', accountType: 'simple' },
    { id: 'd', accountType: 'matong' }, { id: 'e', accountType: 'gold' }, { id: 'x', accountType: 'portfolio', deletedAt: '2026-11-01' },
    { id: 't', accountType: 'portfolio', isTest: true },
  ];
  const sums = [
    { id: 'd', name: '마통', currentEval: 100, principal: 100, returnRate: 0, accountType: 'matong' },
    { id: 'a', name: '퇴직', currentEval: 600, principal: 500, returnRate: 20, accountType: 'portfolio' },
    { id: 'b', name: 'ISA', currentEval: 300, principal: 400, returnRate: -25, accountType: 'portfolio' },
    { id: 'x', name: '삭제', currentEval: 50, principal: 50, returnRate: 0, accountType: 'portfolio', deletedAt: '2026-11-01' },
    { id: 'c', name: '비상금', currentEval: 100, principal: 100, returnRate: 0, accountType: 'simple' },
    { id: 'e', name: '금', currentEval: 0, principal: 0, returnRate: 0, accountType: 'portfolio' },
    { id: 't', name: '테스트', currentEval: 10, principal: 10, returnRate: 0, accountType: 'portfolio', isTest: true },
  ];
  const rows = M.mobileAccountList(portfolios, sums, 1100);
  ok('#A1 삭제 계좌는 안 보인다', !rows.some(r => r.id === 'x'));
  ok('#A2 마통은 맨 아래(PC 통합 표와 같은 차례)', rows[rows.length - 1].id === 'd' && rows[0].id === 'a');
  ok('#A3 종류는 portfolios에서 읽는다(summary는 portfolio로 뭉침)', rows.find(r => r.id === 'a').type === 'dc-irp' && rows.find(r => r.id === 'e').type === 'gold' && rows.find(r => r.id === 'b').badge === 'ISA');
  ok('#A4 수익 = 총자산 − 투자원금(PC 통합 표와 같은 값)', rows.find(r => r.id === 'b').profit === -100 && rows.find(r => r.id === 'a').rate === 20);
  ok('#A5 비중 = 총자산 ÷ 전체 총자산', Math.abs(rows.find(r => r.id === 'a').weight - 600 / 1100 * 100) < 1e-9);
  ok('#A6 TEST 계좌는 비중 없음(합계 제외)', rows.find(r => r.id === 't').weight === null && rows.find(r => r.id === 't').isTest);
  ok('#A7 직접입력·마통은 눌러 열지 않는다(PC 계좌 탭과 같은 규칙)', !rows.find(r => r.id === 'c').canOpen && !rows.find(r => r.id === 'd').canOpen && rows.find(r => r.id === 'a').canOpen);
}

console.log('\n── 파트④ 계좌 잔고 표 ──');
if (M) {
  const calc = [
    { id: 1, type: 'stock', name: 'TIGER 미국S&P500', code: '360750', quantity: '820', purchasePrice: 19480, currentPrice: 21935, investAmount: 15973600, evalAmount: 17986700, profit: 2013100, returnRate: 12.6, evalRatio: 40, changeRate: 0.84 },
    { id: 2, type: 'deposit', depositAmount: 500, evalAmount: 500, investAmount: 500 },
    { id: 3, type: 'fund', name: '어떤 펀드', investAmount: 1000, evalAmount: 1100, profit: 100, returnRate: 10, evalRatio: 5 },
    { id: 4, type: 'stock', name: '', code: '', quantity: '', evalAmount: 0, investAmount: 0 },
    { id: 5, type: 'deposit', depositAmount: 300, evalAmount: 300, investAmount: 300 },
    { id: 6, type: 'stock', name: '현금', isManualCash: true, investAmount: 700, evalAmount: 700, profit: 0, returnRate: 0, evalRatio: 2, quantity: 1 },
  ];
  const d = M.mobileHoldingRows(calc, 'isa');
  ok('#H1 예수금 행들은 합쳐 맨 아래 한 줄', d.depositEval === 800 && !d.rows.some(r => r.kind === 'deposit'));
  ok('#H2 빈 행은 뺀다', d.rows.length === 3);
  ok('#H3 값은 PC 종목 표(calcPortfolio) 그대로', d.rows[0].evalAmount === 17986700 && d.rows[0].invest === 15973600 && d.rows[0].profit === 2013100 && d.rows[0].weight === 40);
  ok('#H4 종류 구분(주식·펀드·현금)', d.rows.map(r => r.kind).join() === 'stock,fund,cash');
  ok('#H5 매입·평가 합계는 예수금 제외', d.holdInvest === 15973600 + 1000 + 700 && d.holdEval === 17986700 + 1100 + 700);
  ok('#H6 오늘 손익 = 평가 × 등락률 ÷ (100 + 등락률)', Math.abs(d.rows[0].today - 17986700 * 0.84 / 100.84) < 1e-6 && d.hasChange);
  ok('#H7 등락률이 없으면 오늘 손익 줄을 숨긴다', M.mobileHoldingRows([calc[2]], 'isa').hasChange === false);
  ok('#H8 단위: 금현물 g · 해외는 달러 표시', M.mobileHoldingRows([calc[0]], 'gold').rows[0].unit === 'g' && M.mobileHoldingRows([calc[0]], 'overseas').rows[0].usd === true && d.rows[0].usd === false);
  const noPp = { id: 9, type: 'stock', name: 'TIGER 머니마켓액티브', code: '488770', quantity: '64', purchasePrice: '', currentPrice: 102000, investAmount: 6650880, evalAmount: 6528000, profit: -122880, returnRate: -1.85, evalRatio: 7.5 };
  const stalePp = { ...noPp, purchasePrice: 28460, investAmount: 10409848, quantity: 300 };
  ok('#H9 평균단가 = PC 구매단가(국내 = 투자금액 ÷ 수량 반올림 · purchasePrice 무시)', M.mobileHoldingRows([noPp], 'isa').rows[0].avg === 103920 && M.mobileHoldingRows([stalePp], 'isa').rows[0].avg === Math.round(10409848 / 300));
  ok('#H10 해외 평균단가 = 저장된 달러 단가', M.mobileHoldingRows([{ ...noPp, purchasePrice: 182.4, quantity: 20, investAmount: 5052480 }], 'overseas').rows[0].avg === 182.4);
}

console.log('\n── 파트⑤ 보유종목 탭 ──');
if (M) {
  const ports = [
    { id: 'a', name: '퇴직', accountType: 'dc-irp', portfolio: [{ type: 'stock', name: 'KODEX 200', code: '069500' }, { type: 'deposit' }] },
    { id: 'b', name: '옛 이름', accountType: 'isa', portfolio: [{ type: 'stock', name: 'KODEX 200', code: '069500' }, { type: 'fund', name: '펀드A' }] },
    { id: 'g', name: '금', accountType: 'gold', portfolio: [{ type: 'stock', name: '금 99.99K', code: 'M04020000' }] },
    { id: 't', name: '테스트', isTest: true, accountType: 'isa', portfolio: [{ type: 'stock', name: 'KODEX 200' }] },
  ];
  const names = M.holdingAccountNames(ports, 'b', 'ISA 새 이름');
  ok('#M1 같은 종목은 계좌 이름을 모은다(활성 계좌는 지금 제목)', names['KODEX 200'].join() === '퇴직,ISA 새 이름');
  ok('#M2 금현물은 intHoldingsDonutData와 같은 이름(KRX 금현물)', names['KRX 금현물'].join() === '금');
  ok('#M3 TEST 계좌는 빼고(통합 비중과 같은 규칙)', !names['KODEX 200'].includes('테스트'));
  const merged = M.mobileMergedHoldings([
    { name: 'KODEX 200', value: 1200, cost: 1000, category: '국내주식', code: '069500' },
    { name: '예수금', value: 500, cost: 500, category: '예수금', code: '' },
    { name: '비상금', value: 300, cost: 300, category: '예수금', code: '' },
  ], names);
  ok('#M4 예수금 묶음은 종목 목록에서 빼고 맨 아래 합계 줄로', merged.length === 1 && merged[0].name === 'KODEX 200');
  ok('#M5 수익·수익률 = 평가 − 원가', merged[0].profit === 200 && Math.abs(merged[0].rate - 20) < 1e-9 && merged[0].accounts === '퇴직 · ISA 새 이름');
  const t1 = M.todayOf({ date: '2026-11-27', dodAbsChange: 1500, dodChange: 0.5 });
  const t2 = M.todayOf({ date: '2026-11-27', dodAbsChange: null, dodChange: null });
  ok('#M6 오늘의 수익 = PC 헤더 카드와 같은 행(intMonthlyHistory[0]) · 보류는 0으로 삼키지 않는다', !t1.held && t1.amount === 1500 && t2.held && M.todayOf(undefined).held);
}

console.log('\n── 파트⑤-2 리밸런싱 표(계좌 이름 옆 단추) ──');
let RP = null;
try { RP = await import(pathToFileURL(join(ROOT, 'src/rebalPreview.ts')).href); } catch (e) { if (!(e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message))))) { fail++; console.log(`  ✗ src/rebalPreview.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); } }
if (M && RP) {
  const data = [
    { id: 'a', type: 'stock', name: 'TIGER 미국S&P500', code: '360750', quantity: '705', currentPrice: 24265, action: 75, expEval: 780 * 24265 },
    { id: 'b', type: 'stock', name: 'TIME 미국나스닥', code: '426030', quantity: 671, currentPrice: '34,390', action: -20, expEval: 651 * 34390 },
    { id: 'c', type: 'fund', name: '펀드', quantity: 0, currentPrice: 0, action: 0, expEval: 500000 },
    { id: 'd', type: 'savings', name: '정기예금', quantity: '', currentPrice: 0, action: 0, expEval: 1000000, isSavings: true },
    { id: 'e', type: 'stock', name: '현금', isManualCash: true, quantity: 1, currentPrice: 0, action: 0, expEval: 300000 },
  ];
  const extra = { a: 5, b: -1, d: 9 };
  const rows = M.mobileRebalRows(data, extra, 'isa');
  ok('#R1 매매 수량 = action + 추가 수량(PC 표 totalAction과 같다)', rows[0].move === 80 && rows[1].move === -21);
  ok('#R2 예상 수량 = 현재 수량 + 매매', rows[0].expQty === 785 && rows[1].expQty === 650);
  ok('#R3 예상 투자금 = rebalanceData.expEval 그대로(PC 예상평가금)', rows[0].expEval === 780 * 24265 && rows[2].expEval === 500000);
  ok('#R4 예적금·수동 현금은 매매 대상 아님(추가 수량이 있어도 0)', rows[3].fixed && rows[3].move === 0 && rows[4].fixed && rows[4].move === 0);
  ok('#R5 단위: 펀드 좌 · 코인 개', rows[2].unit === '좌' && M.mobileRebalRows([data[0]], {}, 'crypto')[0].unit === '개' && M.mobileRebalRows([data[0]], {}, 'overseas')[0].usd);
  const sum = RP.rebalCashSummary({ rows: data, extraQty: extra, depositAmount: 2000000, settings: { mode: 'rebalance', amount: '1,000,000' } });
  const buy = 80 * 24265, sell = 21 * 34390;
  ok('#R6 매수·매도 금액 = Σ(action+추가)×현재가(쉼표 든 가격도 읽음)', sum.totalBuy === buy && sum.totalSell === sell);
  ok('#R7 잔액 = 예수금 + 적립금 + 매도 − 매수(리밸런싱은 예수금 전액)', sum.balance === 2000000 + 1000000 + sell - buy && sum.isLevelMode);
  const acc = RP.rebalCashSummary({ rows: data, extraQty: extra, depositAmount: 2000000, settings: { mode: 'accumulate', amount: 500000, useDepositAmount: 300000 } });
  ok('#R8 적립식은 쓸 예수금만(사용예수금) — PC 표와 같은 규칙', acc.depositForBuy === 300000 && acc.balance === 300000 + 500000 + sell - buy && !acc.isLevelMode);
  const over = RP.rebalCashSummary({ rows: [], depositAmount: 100, settings: { mode: 'accumulate', useDepositAmount: 999 } });
  ok('#R9 쓸 예수금은 예수금을 넘지 않는다', over.useDeposit === 100);
  ok('#R10 모드 글', M.rebalModeLabel('rebalance').includes('목표 비중') && M.rebalModeLabel('targetAmount').includes('목표 금액') && M.rebalModeLabel('accumulate').includes('적립식'));
}

console.log('\n── 파트⑥ 배선(소스) ──');
const app = read('src/App.tsx');
const mv = read('src/components/MobileView.tsx');
const hook = read('src/hooks/useMobileView.ts');
const css = read('src/index.css');
const hps = read('src/components/HoldingsPhotoSync.tsx');
ok('#W1 App이 MobileView·useMobileView·resolveMobileTheme을 import', /import MobileView from '\.\/components\/MobileView'/.test(app) && /import \{ useMobileView \} from '\.\/hooks\/useMobileView'/.test(app) && /import \{ resolveMobileTheme \} from '\.\/mobileView'/.test(app));
ok('#W2 휴대폰 화면은 덮개 — PC 본문(IntegratedDashboard·PortfolioTable)은 조건 없이 그대로 마운트', /\{mobile\.active && \(\s*<ErrorBoundary label="휴대폰 화면">/.test(app) && !/mobile\.active[^\n]*<IntegratedDashboard/.test(app) && !/!mobile\.active/.test(app));
ok('#W3 같은 핸들러: 대시보드 = goIntegratedDashboard · 계좌 = switchToPortfolioWithSnapshot · 사진 = setHoldPhotoPid', /onGoHome=\{goIntegratedDashboard\}/.test(app) && /onOpenAccount=\{switchToPortfolioWithSnapshot\}/.test(app) && /onPhotoSync=\{\(pid\) => setHoldPhotoPid\(pid\)\}/.test(app));
ok('#W4 숫자는 PC 계산값 그대로(portfolioSummaries·intTotals·intMonthlyHistory·totals)', /portfolioSummaries=\{portfolioSummaries\}/.test(app.slice(app.indexOf('<MobileView'))) && /activeTotals=\{totals\}/.test(app) && /intMonthlyHistory=\{intMonthlyHistory\}/.test(app.slice(app.indexOf('<MobileView'))));
ok('#W5 금액 보이기는 PIN 창(UnlockPinModal) — 숨기기만 바로', /const toggleHideAmountsMobile = \(\) => \{\s*if \(hideAmounts\) \{[\s\S]{0,200}setShowUnlockPinModal\(true\)[\s\S]{0,80}setHideAmounts\(true\)/.test(app));
ok('#W6 로그아웃은 PC와 같은 함수 하나(handleLogout)', /onLogout=\{handleLogout\}[\s\S]*onLogout=\{handleLogout\}/.test(app) && /const handleLogout = \(\) => \{[\s\S]{0,400}teardownCardWinsRef/.test(app));
ok('#W7 PC 화면으로 보기 → 「휴대폰 화면」 단추로 돌아온다(넓은 화면도) · 켜짐은 폭이 아니라 PC 보기 하나', /\{mobile\.pcView && \(/.test(app) && !/mobile\.narrow && mobile\.pcView/.test(app) && /mobile\.setPcView\(false\)/.test(app)
  && /active: isMobileViewOn\(pcView\)/.test(hook) && !/isMobileViewOn\(narrow/.test(hook));
ok('#W8 카메라 = lucide Camera 하나(글은 title·aria-label)', /import \{[^}]*\bCamera\b[^}]*\} from 'lucide-react'/.test(mv) && /aria-label="잔고 사진으로 맞추기" title="잔고 사진으로 맞추기"[^>]*><Camera size=\{23\} \/><\/button>/.test(mv) && !/ImagePlus/.test(mv));
ok('#W9 금현물 계좌는 카메라 없음(PC도 사진 맞추기 없음)', /activeAccountType !== 'gold'/.test(mv) && /a\.type !== 'gold'/.test(mv));
ok('#W10 배경을 고르면 창이 닫힌다', /onThemePref\(o\.key\); setSheet\(''\);/.test(mv));
ok('#W11 덮개가 떠 있는 동안 문서 스크롤 잠금 + 바탕색', /html\.mobile-view,\s*html\.mobile-view body \{ overflow: hidden;[^}]*background-color: var\(--mv-bg/.test(css) && /classList\.add\(MOBILE_HTML_CLASS\)/.test(mv) && /classList\.remove\(MOBILE_HTML_CLASS\)/.test(mv));
ok('#W12 뒤로 가기 = 계좌 → 대시보드(사이트를 떠나지 않음)', /window\.history\.pushState/.test(mv) && /addEventListener\('popstate'/.test(mv) && /removeEventListener\('popstate'/.test(mv));
ok('#W13 배경·PC 보기 저장은 브라우저 저장소 한 칸(Drive·STATE 아님)', /localStorage/.test(hook) && /sessionStorage/.test(hook) && !/saveDriveFile|saveAllToDrive/.test(mv + hook));
ok('#W14 사진 맞추기 창: 휴대폰은 아래 판, PC(sm 이상)는 종전 가운데 창', /flex items-end sm:items-center justify-center bg-black\/70 px-0 sm:px-3/.test(hps) && /rounded-t-2xl sm:rounded-2xl/.test(hps));
ok('#W15 휴대폰 화면은 숫자를 새로 계산하지 않는다(평가 = 수량×현재가 금지)', !/quantity\)?\s*\*\s*[^;\n]*currentPrice/.test(mv) && !/currentPrice[^;\n]*\*[^;\n]*quantity/.test(mv));

const rbp = read('src/components/RebalancingPanel.tsx');
ok('#W16 리밸런싱 매수·매도·잔액은 rebalCashSummary 하나(PC 표와 휴대폰이 같은 함수)',
  /import \{[^}]*\brebalCashSummary\b[^}]*\} from '\.\.\/rebalPreview'/.test(rbp) && /= rebalCashSummary\(\{ rows: rebalanceData, extraQty: rebalExtraQty, depositAmount: headerDepositAmount, settings \}\)/.test(rbp)
  && !/const headerTotalBuy = rebalanceData\.reduce/.test(rbp)
  && /import \{ rebalCashSummary \} from '\.\.\/rebalPreview'/.test(mv) && /rebalCashSummary\(\{ rows: rebalanceData \|\| \[\], extraQty: rebalExtraQty \|\| \{\}/.test(mv));
ok('#W17 App이 활성 계좌의 rebalanceData·추가 수량·설정을 넘긴다', /rebalanceData=\{rebalanceData\}\s*rebalExtraQty=\{rebalExtraQty\}\s*rebalSettings=\{settings\}/.test(app.slice(app.indexOf('<MobileView'))));
ok('#W18 리밸런싱 단추는 계좌 화면에서만 · 금현물 없음(PC처럼)', /const canRebal = !showDashboard && activeAccountType !== 'gold';/.test(mv) && /\{canRebal && \(/.test(mv) && /aria-pressed=\{rebalOn\}/.test(mv));
ok('#W19 리밸런싱 표 칸 = 종목명·코드 | 현재·예상 수량 | 매수·매도 수량 | 예상 투자금', /\['종목명', '종목코드'\], \['현재 수량', '예상 수량'\], \['매수·매도', '수량'\], \['예상 투자금', ''\]/.test(mv) && /mobileRebalRows\(rebalanceData, rebalExtraQty, activeAccountType\)/.test(mv));

// 카메라 = 누른 그 순간 사진 고르기(휴대폰은 최근 캡처가 맨 앞) + 뒤에서 창 열기 → 고르면 창이 바로 프로그램 읽기(사용자 요청 2026-11-28)
const startFn = (mv.match(/const startPhoto = \(pid\) => \{[\s\S]*?\n  \};/) || [''])[0];
ok('#W20 카메라 — 누름 안에서 사진 고르기를 연다(fileRef.click) · 창도 연다 · 고른 사진은 onPhotoFiles로 그 계좌에',
  startFn.indexOf('fileRef.current.click()') > 0 && startFn.indexOf('fileRef.current.click()') < startFn.lastIndexOf('onPhotoSync(pid)')
  && /<input ref=\{fileRef\} type="file" accept=\{PASTE_PHOTO_ACCEPT\} multiple onChange=\{onFilesPicked\}/.test(mv) && /import \{ PASTE_PHOTO_ACCEPT \} from '\.\.\/taxCalcPaste';/.test(mv)
  && /onPhotoFiles\(photoPidRef\.current, files\)/.test(mv) && /startPhoto\(activePortfolioId\)/.test(mv) && /pickPhotoAccount = \(id\) => \{ setSheet\(''\); onOpenAccount\(id\); startPhoto\(id\); \}/.test(mv)
  && /onPhotoFiles=\{\(pid, files\) => \{ setHoldPhotoPid\(pid\); setHoldPhotoFiles\(files\); \}\}/.test(app)
  && /initialFiles=\{holdPhotoFiles\}/.test(app) && /onInitialFilesTaken=\{\(\) => setHoldPhotoFiles\(null\)\}/.test(app));
ok('#W21 사진 맞추기 창 — 고른 사진은 키 확인 뒤 한 번만 읽는다(프로그램이 못 읽으면 AI로 넘길지 정하려고)',
  /if \(!open \|\| !keyState\.loaded \|\| !initialFiles \|\| !initialFiles\.length\) return;\s*const list = initialFiles;\s*if \(onInitialFilesTaken\) onInitialFilesTaken\(\);\s*if \(ocrFilesRef\.current\) ocrFilesRef\.current\(list\);/.test(hps)
  && /ocrFilesRef\.current = ocrFiles;/.test(hps));
ok('#W22 사진 맞추기 창 — 설명·AI로 읽기는 ⓘ를 눌렀을 때만(기본 접힘) · 큰 카메라 칸 하나가 프로그램 읽기',
  /const \[more, setMore\] = useState\(false\);/.test(hps) && /\{more && \(<>/.test(hps) && /setMore\(v => !v\)/.test(hps)
  && /<Camera size=\{46\}/.test(hps) && /<input type="file" accept=\{PASTE_PHOTO_ACCEPT\} multiple disabled=\{reading\} onChange=\{readByOcr\} className="sr-only" \/>\s*<\/label>/.test(hps)
  && hps.indexOf('<Camera size={46}') < hps.indexOf('{more && (<>') && hps.indexOf('증권사 앱의') > hps.indexOf('{more && (<>'));
ok('#W23 PC — 끌어 놓기(창 전체 한 곳에서만 읽음)·붙여넣기(그림 파일만 · 키 칸 글자는 그대로)',
  (hps.match(/onDrop=\{dropFiles\}/g) || []).length === 1 && /onDragOver=\{\(e\) => e\.preventDefault\(\)\} onDrop=\{dropFiles\}/.test(hps)
  && /document\.addEventListener\('paste', onPaste\)/.test(hps) && /document\.removeEventListener\('paste', onPaste\)/.test(hps)
  && /filter\(f => \/\^image\\\/\/\.test\(\(f && f\.type\) \|\| ''\)\)/.test(hps) && /if \(!files\.length \|\| !ocrFilesRef\.current\) return;\s*e\.preventDefault\(\);/.test(hps)
  && /if \(busy \|\| run\.phase === 'ocr'\) return;/.test(hps));
ok('#W24 넓은 화면 = 가운데 한 줄(MOBILE_COL_MAX) — 아래 판(sheet)도 같은 폭', /maxWidth: MOBILE_COL_MAX, minWidth: 0, display: 'flex', flexDirection: 'column'/.test(mv) && /margin: '0 auto', maxWidth: MOBILE_COL_MAX/.test(mv));

// 화면 글은 이름만(사용자 확정 2026-11-28 「상세 설명을 꼭 넣어 달라는 것 이외에는 숨기기」)
ok('#W25 화면 배경 = 제목과 이름 넷뿐(부연 줄·「기본」 표 없음) · 휴대폰 화면에 안내 문장 없음',
  (M ? M.MOBILE_THEME_OPTIONS.every(o => !('sub' in o)) && M.MOBILE_THEME_OPTIONS.map(o => o.label).join() === '시스템 연동,블랙,밝은 베이지,남색' : true)
  && !/고르면 바로 바뀌고|o\.sub\b|>기본</.test(mv) && !/종목을 누르면 코드와|자세한 설정은 PC 화면에서|달러 종목은 지금 환율로|고른 계좌의 수량·매입금액/.test(mv));

// ── 증권사 앱 열기(사용자 요청 2026-11-28 「증권사 앱을 지정하고 열고 캡처하면 바로 넣기」 — 사이트 안에서) ──
let BA = null;
try { BA = await import(pathToFileURL(join(ROOT, 'src/brokerApps.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (!unsupported) { fail++; console.log(`  ✗ src/brokerApps.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}
if (BA) {
  ok('#BA1 앱 넷 = M-STOCK·영웅문S#·한국투자·토스증권 · App Store 번호(2026-11-28 apps.apple.com 확인값)',
    BA.BROKER_APPS.map(a => a.name).join() === 'M-STOCK,영웅문S#,한국투자,토스증권'
    && BA.BROKER_APPS.map(a => a.iosId).join() === '1248716281,1570370057,1621986905,839333328');
  ok('#BA2 기기 가리기 — 아이폰·아이패드(맥 글자+터치)=ios · 안드로이드 · PC는 빈 값(앱을 열지 않음)',
    BA.platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)') === 'ios' && BA.platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5) === 'ios'
    && BA.platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0) === '' && BA.platformOf('Mozilla/5.0 (Linux; Android 14)') === 'android' && BA.platformOf('Windows NT 10.0') === '');
  const app = (id) => BA.brokerAppById(id);
  ok('#BA3 아이폰 — 공개 스킴이 없는 앱은 App Store 화면 · 토스만 supertoss:// · PC는 빈 주소',
    BA.brokerAppUrl(app('mstock'), 'ios') === 'https://apps.apple.com/kr/app/id1248716281' && BA.brokerAppUrl(app('kiwoom'), 'ios') === 'https://apps.apple.com/kr/app/id1570370057'
    && BA.brokerAppUrl(app('toss'), 'ios') === 'supertoss://' && BA.brokerAppUrl(app('kis'), '') === '' && BA.brokerAppUrl(null, 'ios') === '');
  const ki = BA.brokerAppUrl(app('kiwoom'), 'android');
  ok('#BA4 안드로이드 — 패키지로 바로(없으면 Play 스토어) · 패키지 모르는 앱은 Play 스토어 검색',
    /^intent:\/\/#Intent;action=android\.intent\.action\.MAIN;category=android\.intent\.category\.LAUNCHER;package=com\.kiwoom\.heromts;S\.browser_fallback_url=https%3A%2F%2Fplay\.google\.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom\.kiwoom\.heromts;end$/.test(ki)
    && BA.brokerAppUrl(app('mstock'), 'android') === 'https://play.google.com/store/search?q=' + encodeURIComponent('미래에셋증권 M-STOCK') + '&c=apps');
  const st = mem();
  BA.writeBrokerApp(st, 'acctA', 'kiwoom'); BA.writeBrokerApp(st, 'acctB', 'toss');
  ok('#BA5 계좌마다 하나 — 이 기기 저장소 한 칸에 계좌 id → 앱 id', BA.brokerAppOf(st, 'acctA').id === 'kiwoom' && BA.brokerAppOf(st, 'acctB').id === 'toss' && BA.brokerAppOf(st, 'acctC') === null && BA.brokerAppOf(st, '') === null);
  BA.writeBrokerApp(st, 'acctA', 'nope'); BA.writeBrokerApp(st, 'acctB', null);
  ok('#BA6 모르는 앱·빈 값 = 그 계좌 칸 지움 · 다 지우면 저장 칸도 지움', BA.brokerAppOf(st, 'acctA') === null && !st.m.has(BA.BROKER_KEY));
  st.setItem(BA.BROKER_KEY, '{bad json'); const st2 = mem(); st2.setItem(BA.BROKER_KEY, JSON.stringify({ x: 'kiwoom', y: 'evil' }));
  ok('#BA7 깨진 값·모르는 앱 id는 무시', BA.brokerAppOf(st, 'x') === null && BA.brokerAppOf(st2, 'x').id === 'kiwoom' && BA.brokerAppOf(st2, 'y') === null);
  const st3 = mem(); for (let i = 0; i < 70; i++) BA.writeBrokerApp(st3, 'a' + i, 'kis');
  ok('#BA8 계좌가 많아도 최근 60개까지만', Object.keys(JSON.parse(st3.getItem(BA.BROKER_KEY))).length === 60 && BA.brokerAppOf(st3, 'a69').id === 'kis' && BA.brokerAppOf(st3, 'a0') === null);
  const w = { location: { href: '' } };
  ok('#BA9 열기 = 그 주소로 이동(누름 안) · PC는 아무것도 안 함', BA.openBrokerApp(app('toss'), 'ios', w) === true && w.location.href === 'supertoss://' && BA.openBrokerApp(app('toss'), '', { location: { href: 'x' } }) === false);
}
if (BA) {
  const sh = BA.parseAppLink('토스 - App Store https://apps.apple.com/kr/app/%ED%86%A0%EC%8A%A4/id839333328');
  const pl = BA.parseAppLink('https://play.google.com/store/apps/details?id=com.kiwoom.heromts&hl=ko');
  ok('#BA10 앱 링크 읽기 — App Store 공유 글(이름 짐작)·번호만·Play 스토어·앱 주소 · http·javascript·빈 글은 거절',
    sh && sh.iosId === '839333328' && sh.guessName === '토스' && BA.parseAppLink('839333328').iosId === '839333328' && BA.parseAppLink('id1570370057').iosId === '1570370057'
    && pl && pl.android === 'com.kiwoom.heromts' && BA.parseAppLink('kakaotalk://').scheme === 'kakaotalk://' && BA.parseAppLink('supertoss://securities').guessName === 'supertoss'
    && BA.parseAppLink('javascript://alert(1)') === null && BA.parseAppLink('https://example.com/a') === null && BA.parseAppLink('') === null && BA.parseAppLink('안녕') === null);
  const cs2 = mem();
  const r1 = BA.addCustomApp(cs2, '', 'https://apps.apple.com/kr/app/%ED%95%9C%ED%88%AC-%ED%95%9C%EA%B5%AD%ED%88%AC%EC%9E%90%EC%A6%9D%EA%B6%8C/id1621986905', 'c_a1');
  const r2 = BA.addCustomApp(cs2, '카톡', 'kakaotalk://', 'c_a2');
  const r3 = BA.addCustomApp(cs2, 'x', 'http://evil', 'c_a3');
  const r4 = BA.addCustomApp(cs2, '', 'https://play.google.com/store/apps/details?id=com.x.y', 'c_a4');
  ok('#BA11 앱 더하기 — 이름이 비면 링크에서 짐작 · 못 읽는 링크·이름 없음은 거절 · 처음 넷 뒤에 붙는다',
    r1.app && r1.app.name === '한투' && r2.app && r2.app.scheme === 'kakaotalk://' && r3.error === 'link' && r4.error === 'name'
    && BA.allBrokerApps(cs2).map(a => a.id).join() === 'mstock,kiwoom,kis,toss,c_a1,c_a2');
  BA.writeBrokerApp(cs2, 'acct1', 'c_a2');
  ok('#BA12 더한 앱도 계좌 앱으로 기억 · 주소 = 앱 주소(아이폰·안드로이드 같음) · PC는 열지 않음',
    BA.brokerAppOf(cs2, 'acct1').id === 'c_a2' && BA.brokerAppUrl(BA.brokerAppOf(cs2, 'acct1'), 'ios') === 'kakaotalk://' && BA.brokerAppUrl(r2.app, 'android') === 'kakaotalk://' && BA.brokerAppUrl(r2.app, '') === '');
  const andOnly = BA.addCustomApp(cs2, '안드', 'https://play.google.com/store/apps/details?id=com.only.android', 'c_a5').app;
  ok('#BA13 이 기기에서 열 수 없는 앱은 목록에서 뺀다(아이폰에 Play 링크만 넣은 앱)', !BA.appsForPlatform(BA.allBrokerApps(cs2), 'ios').some(a => a.id === andOnly.id) && BA.appsForPlatform(BA.allBrokerApps(cs2), 'android').some(a => a.id === andOnly.id));
  BA.removeCustomApp(cs2, 'c_a2'); BA.removeCustomApp(cs2, 'toss');
  ok('#BA14 더한 앱 지우기 — 그 앱을 고른 계좌 칸도 지움 · 처음 넷은 지우지 않음', BA.brokerAppOf(cs2, 'acct1') === null && BA.allBrokerApps(cs2).some(a => a.id === 'toss') && !BA.allBrokerApps(cs2).some(a => a.id === 'c_a2'));
  const cs3 = mem(); for (let i = 0; i < 15; i++) BA.addCustomApp(cs3, 'a' + i, 'app' + i + '://', 'c_x' + i);
  cs3.setItem(BA.BROKER_CUSTOM_KEY, JSON.stringify([...JSON.parse(cs3.getItem(BA.BROKER_CUSTOM_KEY)), { id: 'c_bad', name: 'b', scheme: 'javascript://x' }, { id: 'nope', name: 'n', iosId: '123456' }]));
  ok('#BA15 더한 앱은 12개까지 · 저장 칸에 끼워 넣은 나쁜 주소·이름 꼴은 버린다', BA.readCustomApps(cs3).length === 12 && !BA.readCustomApps(cs3).some(a => a.id === 'c_bad' || a.id === 'nope'));
}
ok('#BA16 사진 맞추기 창(휴대폰·태블릿) — 이 계좌 앱 큰 단추 · 다른 앱·더한 앱 단추 · + 더하기(이름·링크) · 연필 = 더한 앱 지우기 · 누른 앱이 이 계좌 앱 · 다녀오면 카메라 칸이 빛남',
  /import \{ platformOf, brokerAppOf, writeBrokerApp, openBrokerApp, localStore, allBrokerApps, appsForPlatform, addCustomApp, removeCustomApp, BROKER_NAME_MAX \} from '\.\.\/brokerApps';/.test(hps)
  && /\{platform && accountId && \(/.test(hps) && /\{app && !editApps && \(/.test(hps) && /apps\.filter\(a => editApps \? a\.custom : !\(app && a\.id === app\.id\)\)/.test(hps)
  && /writeBrokerApp\(localStore\(\), accountId, a\.id\)/.test(hps) && /openBrokerApp\(a, platform\);/.test(hps)
  && /addCustomApp\(st, addName, addLink, `c_\$\{generateId\(\)\}`\)/.test(hps) && /removeCustomApp\(st, a\.id\)/.test(hps)
  && /if \(document\.visibilityState === 'hidden'\) away = true;\s*else if \(away\) \{ away = false; setGlow\(true\); \}/.test(hps)
  && /glow \? 'border-sky-300 bg-sky-900\/40 ring-4/.test(hps) && /if \(busy \|\| run\.phase === 'ocr'\) return;\s*setGlow\(false\);/.test(hps)
  && /accountId=\{holdPhotoPid \|\| ''\}/.test(app));
ok('#BA17 휴대폰 화면 위 카메라 — 휴대폰·태블릿은 창을 연다(앱·카메라 칸을 고름) · PC는 바로 사진 고르기',
  /const plat = typeof navigator !== 'undefined' \? platformOf\(navigator\.userAgent, navigator\.maxTouchPoints\) : '';\s*if \(plat\) \{ onPhotoSync\(pid\); return; \}/.test(mv)
  && /import \{ platformOf \} from '\.\.\/brokerApps';/.test(mv));

// ── 파트⑦ 안드로이드 「공유」로 캡처 받기(사용자 요청 2026-11-28) — src/shareTarget.ts + public/sw.js + manifest ──
console.log('\n── 파트⑦ 공유로 캡처 받기(안드로이드) ──');
let ST = null;
try { ST = await import(pathToFileURL(join(ROOT, 'src/shareTarget.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 공유 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/shareTarget.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}
const swSrc = read('public/sw.js');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const pngSize = (rel) => { const b = readFileSync(join(ROOT, rel)); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
const fakeCaches = () => {
  const stores = new Map();
  const mk = () => { const m = new Map(); return {
    m,
    put: async (req, res) => { m.set(typeof req === 'string' ? req : req.url, res); },
    keys: async () => [...m.keys()].map(u => new Request(u)),
    match: async (req) => { const r = m.get(typeof req === 'string' ? req : req.url); return r ? r.clone() : undefined; },
  }; };
  return { stores, open: async (n) => { if (!stores.has(n)) stores.set(n, mk()); return stores.get(n); }, has: async (n) => stores.has(n), delete: async (n) => stores.delete(n) };
};
if (ST) {
  ok('#SH1 안드로이드에서만 등록 대상', ST.isAndroidUA('Mozilla/5.0 (Linux; Android 14; SM-S928N) Chrome/131') && !ST.isAndroidUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') && !ST.isAndroidUA('Mozilla/5.0 (Macintosh)'));
  const now = Date.UTC(2026, 10, 28, 6, 0, 0);
  ok('#SH2 받은 지 30분 안만 쓴다(시계 1분 앞섬 허용)', ST.shareFresh(now - 60000, now) && ST.shareFresh(now + 30000, now) && !ST.shareFresh(now - 31 * 60000, now) && !ST.shareFresh(now + 5 * 60000, now) && !ST.shareFresh('', now) && !ST.shareFresh(null, now));
  ok('#SH3 저장 칸 차례 읽기', ST.shareIndexOf('https://a.test/__share/3') === 3 && ST.shareIndexOf('https://a.test/__share/x') === -1 && ST.shareIndexOf('https://a.test/other') === -1);
  ok('#SH4 주소에서 shared만 뺀다(다른 값은 그대로)', ST.withoutShareParam('https://a.test/?shared=2') === '/' && ST.withoutShareParam('https://a.test/?a=1&shared=2#h') === '/?a=1#h' && ST.withoutShareParam('https://a.test/?a=1') === null);
  const regs = [];
  const navA = { userAgent: 'Linux; Android 14', serviceWorker: { register: (u, o) => { regs.push([u, o && o.scope]); return Promise.resolve(); } } };
  let loadFn = null;
  const r1 = ST.registerShareWorker(navA, { readyState: 'loading' }, { addEventListener: (t, f) => { if (t === 'load') loadFn = f; } });
  const before = regs.length; if (loadFn) loadFn();
  const r2 = ST.registerShareWorker({ userAgent: 'iPhone', serviceWorker: { register: () => { regs.push(['ios']); return Promise.resolve(); } } }, { readyState: 'complete' }, null);
  ok('#SH5 서비스 워커는 안드로이드만 · 화면이 다 뜬 뒤(load) 등록 · /sw.js 범위 /', r1 === true && before === 0 && regs.length === 1 && regs[0][0] === '/sw.js' && regs[0][1] === '/' && r2 === false);

  // sw.js 를 그대로 돌린다 — 가짜 브라우저 저장소에 공유 2장(+ 글 파일 1개) → /?shared=2 → 앱이 2장을 꺼내고 저장소를 지운다
  const vm = await import('node:vm');
  const handlers = {};
  const cs = fakeCaches();
  const ctx = { caches: cs, URL, Response, Request, URLPattern: globalThis.URLPattern, console, encodeURIComponent };
  ctx.self = { addEventListener: (t, f) => { handlers[t] = f; }, location: new URL('https://app.test/sw.js'), skipWaiting: () => {}, clients: { claim: async () => {} } };
  vm.createContext(ctx);
  vm.runInContext(swSrc, ctx);
  let routes = null; const waits = [];
  handlers.install({ addRoutes: async (r) => { routes = r; }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  if (globalThis.URLPattern) {
    ok('#SH6 크롬 길 규칙 — 공유 주소만 서비스 워커, 나머지는 곧장 네트워크(화면·시세가 느려지지 않게)', Array.isArray(routes) && routes.length === 2
      && routes[0].source === 'fetch-event' && routes[0].condition.urlPattern.test('https://app.test/share-target') && !routes[0].condition.urlPattern.test('https://app.test/')
      && routes[1].source === 'network' && routes[1].condition.urlPattern.test('https://app.test/assets/x.js') && routes[1].condition.urlPattern.test('https://query1.finance.yahoo.com/v8/a?b=1'));
  } else console.log('  ⓘ 이 런타임에 URLPattern이 없어 #SH6(길 규칙)을 건너뜁니다.');
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const fd = new FormData();
  fd.append('photos', new File([png], 'Screenshot_20261128.png', { type: 'image/png' }));
  fd.append('photos', new File([new Uint8Array([255, 216, 255, 1])], '캡처 2.jpg', { type: 'image/jpeg' }));
  fd.append('photos', new File(['hello'], 'note.txt', { type: 'text/plain' }));
  let responded = null;
  handlers.fetch({ request: new Request('https://app.test/share-target', { method: 'POST', body: fd }), respondWith: (p) => { responded = p; } });
  const res = responded ? await responded : null;
  let other = 0;
  handlers.fetch({ request: new Request('https://app.test/'), respondWith: () => { other++; } });
  handlers.fetch({ request: new Request('https://app.test/api/x', { method: 'POST', body: 'a' }), respondWith: () => { other++; } });
  ok('#SH7 공유(POST /share-target) → 사진 2장만 저장 → 303 /?shared=2 · 다른 요청(GET·다른 POST)은 손대지 않음',
    !!res && res.status === 303 && res.headers.get('location') === 'https://app.test/?shared=2' && other === 0 && (await cs.has(ST.SHARE_CACHE)));
  const got = await ST.takeSharedPhotos(cs);
  ok('#SH8 앱이 꺼낸 사진 = 같은 이름·종류·내용 · 꺼내면 저장소를 지운다', got.length === 2 && got[0].name === 'Screenshot_20261128.png' && got[0].type === 'image/png'
    && got[1].name === '캡처 2.jpg' && got[1].type === 'image/jpeg' && (await got[0].arrayBuffer()).byteLength === png.length && !(await cs.has(ST.SHARE_CACHE)));
  ok('#SH9 받은 것이 없으면 빈 목록(저장소를 만들지 않는다)', (await ST.takeSharedPhotos(cs)).length === 0 && !cs.stores.has(ST.SHARE_CACHE));
  const old = await cs.open(ST.SHARE_CACHE);
  await old.put('https://app.test/__share/0', new Response(new Blob([png], { type: 'image/png' }), { headers: { 'Content-Type': 'image/png', 'X-Share-At': String(Date.now() - 31 * 60000) } }));
  ok('#SH10 30분 넘은 캡처는 버린다(다른 계정이 나중에 로그인해도 남의 사진을 묻지 않게)', (await ST.takeSharedPhotos(cs)).length === 0 && !(await cs.has(ST.SHARE_CACHE)));
  responded = null;
  const fd2 = new FormData(); fd2.append('photos', new File(['x'], 'a.txt', { type: 'text/plain' }));
  handlers.fetch({ request: new Request('https://app.test/share-target', { method: 'POST', body: fd2 }), respondWith: (p) => { responded = p; } });
  const res2 = await responded;
  ok('#SH11 사진이 없는 공유 → /?shared=0 · 저장 안 함', res2.status === 303 && res2.headers.get('location') === 'https://app.test/?shared=0' && !(await cs.has(ST.SHARE_CACHE)));
  ok('#SH12 이름·주소가 세 곳(shareTarget.ts·sw.js·manifest)에서 같다', manifest.share_target.action === ST.SHARE_PATH && manifest.share_target.params.files[0].name === ST.SHARE_FIELD
    && swSrc.includes(`const SHARE_PATH = '${ST.SHARE_PATH}';`) && swSrc.includes(`const SHARE_CACHE = '${ST.SHARE_CACHE}';`) && swSrc.includes(`const SHARE_FIELD = '${ST.SHARE_FIELD}';`) && swSrc.includes(`const SHARE_MAX = ${ST.SHARE_MAX};`)
    && swSrc.includes("`/?shared=${n}`") && ST.SHARE_PARAM === 'shared');
}
ok('#SH13 manifest — 설치할 수 있는 앱(이름·standalone·시작 주소·아이콘 192/512 PNG·maskable) + 공유 받기(POST·multipart·사진)',
  manifest.name && manifest.short_name && manifest.display === 'standalone' && manifest.start_url === '/' && manifest.scope === '/'
  && manifest.icons.every(i => { const d = pngSize(join('public', i.src)); return d && `${d[0]}x${d[1]}` === i.sizes && i.type === 'image/png'; })
  && manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable')
  && manifest.share_target.method === 'POST' && manifest.share_target.enctype === 'multipart/form-data' && manifest.share_target.params.files[0].accept.includes('image/*'));
ok('#SH14 서비스 워커는 캐시하지 않는다(사진 칸 말고는 caches를 쓰지 않음) · 화면이 아니라 공유 주소만 응답', !/caches\.match|cache\.match|addAll\(/.test(swSrc) && (swSrc.match(/respondWith\(/g) || []).length === 1
  && /if \(req\.method !== 'POST'\) return;/.test(swSrc) && /url\.pathname !== SHARE_PATH\) return;/.test(swSrc));
const idx = read('index.html'); const mainSrc = read('src/main.tsx');
ok('#SH15 index.html이 manifest를 잇고 · 앱 탭에서만 서비스 워커 등록(별도 창은 안 함)', /<link rel="manifest" href="\/manifest\.webmanifest" \/>/.test(idx)
  && /import \{ registerShareWorker \} from '\.\/shareTarget'/.test(mainSrc) && /if \(!SEPARATE_WINDOW_BOOT\) registerShareWorker\(\)/.test(mainSrc));
ok('#SH16 App — 부팅 정착 뒤 · 관리자 접속 아닐 때 한 번 꺼내 휴대폰 화면에 넘긴다(PC 보기였으면 휴대폰 화면으로)',
  /import \{ takeSharedPhotos, withoutShareParam \} from '\.\/shareTarget';/.test(app)
  && /if \(histPhase !== 'settled' \|\| sharedTakenRef\.current \|\| ADMIN_VIEW_EMAIL \|\| adminViewingAsRef\.current\) return;/.test(app)
  && /takeSharedPhotos\(\)\.then\(\(files\) => \{\s*if \(!files\.length\) return;\s*if \(mobile\.pcView\) mobile\.setPcView\(false\);\s*setSharedPhotos\(files\);/.test(app)
  && /sharedFiles=\{sharedPhotos\}\s*onSharedTaken=\{\(\) => setSharedPhotos\(null\)\}/.test(app));
ok('#SH17 휴대폰 화면 — 계좌가 하나면 바로 · 여럿이면 미리보기와 함께 묻고 → 고르면 그 계좌로 바로 읽기 · 닫으면 버림',
  /if \(photoAccounts\.length === 1\) \{ const id = photoAccounts\[0\]\.id; onOpenAccount\(id\); onPhotoFiles\(id, files\); return; \}/.test(mv)
  && /setShared\(files\);\s*setSheet\('shareAcct'\);/.test(mv) && /if \(sheet !== 'shareAcct' && shared\) setShared\(null\);/.test(mv)
  && /sheet === 'shareAcct' \? pickShareAccount\(a\.id\)/.test(mv) && /if \(files && files\.length && onPhotoFiles\) onPhotoFiles\(id, files\);/.test(mv)
  && /URL\.revokeObjectURL\(u\)/.test(mv));

console.log(`\n${fail ? '❌' : '✅'} verify:mobile-view — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
