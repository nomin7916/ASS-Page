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
  startFn.indexOf('fileRef.current.click()') > 0 && startFn.indexOf('fileRef.current.click()') < startFn.indexOf('onPhotoSync(pid)')
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

console.log(`\n${fail ? '❌' : '✅'} verify:mobile-view — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
