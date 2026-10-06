#!/usr/bin/env node
// 수동 현금 행 = '투자금액을 그대로 평가금액으로' 검증.   실행: npm run verify:cash-row
//
// 발단(사용자 요청 2026-10): 시세가 없는 현금성 자산을 종목 표에 한 줄로 적어 두는데(구분 '현금',
//   종목코드 없음, 보유수량 1, 투자금액 18,418,888) 현재가가 0이라 평가금액 ₩0 · 수익률 −100%로 떴다.
//   아주 이례적인 용도라 **네 조건을 전부** 만족할 때만 투자금액을 평가금액으로 쓴다.
//
// 구성 ①  src/utils.ts 를 **직접 import** 해 순수 함수를 테스트한다(미러 금지).
// 구성 ②  소스 텍스트 가드 — 평가액을 만드는 경로가 10곳이 넘어 한 곳만 빠져도 화면끼리 총자산이
//        갈린다. **선언이 아니라 사용부**를 단언한다. 실패 시 먼저 정규식이 낡았는지 확인할 것.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
// 단언이 던지면 스크립트가 죽어 요약 줄이 안 나오고, 변이 하네스가 그것을 '검출'로 위장한다 → 예외는 그 케이스의 실패로.
const S = (fn) => { try { return fn(); } catch (e) { return { __threw: String(e && e.message || e) }; } };

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? '' : s.slice(i, j);
};

console.log('\n── 파트① 순수 함수 (src/utils.ts 직접 import) ──');

let U = null;
try {
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
} catch (e) {
  if (e && e.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
    console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  } else {
    fail++;
    console.log(`  ✗ src/utils.ts 로드 실패 — ${e && (e.code || e.message)}`);
  }
}

// 사용자 화면 그대로의 현금 행
const CASH = { id: 'c', type: 'stock', category: '현금', code: '', name: '', quantity: 1, investAmount: 18418888, currentPrice: 0, purchasePrice: 0 };
const STOCK = { id: 's', type: 'stock', category: '주식', code: '005930', name: '삼성', quantity: 10, investAmount: 9000, currentPrice: 1100, purchasePrice: 900 };
const DEP = { id: 'd', type: 'deposit', depositAmount: 500 };
const SHM = { '005930': { '2026-10-01': 1000, '2026-10-02': 1100 } };
const D1 = '2026-10-01', D2 = '2026-10-02', EDK = '2026-10-03';

if (U) {
  const { isManualCashShape: shape, isManualCashRow: row, manualCashEval, calcPortfolioEvalDetail: calc,
    buildCloseEvalSeries, resolveHoldings, snapshotItemsFromPortfolio, snapshotCompositionKey, bookCostOf } = U;

  // ── 조건 4종 ──
  ok('#1 사용자 화면의 행(구분 현금·코드 없음·수량 1·투자금액 18,418,888)은 현금 행', S(() => shape(CASH)) === true);
  ok('#1b 투자금액이 곧 평가액', S(() => manualCashEval(CASH)) === 18418888);
  ok('#2 구분이 현금이 아니면 아니다', S(() => shape({ ...CASH, category: '주식' })) === false);
  ok('#2b 종목코드가 있으면 아니다', S(() => shape({ ...CASH, code: '456610' })) === false);
  ok('#2c 보유수량이 2면 아니다', S(() => shape({ ...CASH, quantity: 2 })) === false);
  ok('#2d 보유수량이 0이면 아니다', S(() => shape({ ...CASH, quantity: 0 })) === false);
  ok('#2e 투자금액이 0이면 아니다', S(() => shape({ ...CASH, investAmount: 0 })) === false);
  ok('#2f 투자금액이 비면 아니다', S(() => shape({ ...CASH, investAmount: '' })) === false);
  ok('#2g 펀드·예수금·예적금 행은 아니다',
    ['fund', 'deposit', 'savings'].every(t => S(() => shape({ ...CASH, type: t })) === false));
  ok('#2h 레거시(type 미설정)는 주식으로 본다', S(() => shape({ ...CASH, type: undefined })) === true);
  ok('#2i 문자열 수량 "1"·앞뒤 공백 구분/코드도 인정', S(() => shape({ ...CASH, quantity: '1', category: ' 현금 ', code: '  ' })) === true);
  ok('#2j 소수 수량 1.5는 아니다', S(() => shape({ ...CASH, quantity: 1.5 })) === false);
  ok('#3 해외·금현물 계좌는 대상이 아니다 (해외 investAmount는 원화 잔존값일 수 있다)',
    S(() => row(CASH, 'overseas')) === false && S(() => row(CASH, 'gold')) === false);
  ok('#3b 국내·연금·퇴직·레거시 계좌는 대상', ['portfolio', 'dc-irp', 'pension', 'isa', 'crypto', undefined]
    .every(t => S(() => row(CASH, t)) === true));

  // ── calcPortfolioEvalDetail ──
  const r = S(() => calc([STOCK, CASH, DEP], 'portfolio', D2, SHM, {}, 1, {}));
  eq('#4 그날 평가액 = 주식 11,000 + 현금 18,418,888 + 예수금 500', r?.total, 11000 + 18418888 + 500);
  const cd = (r?.items || []).find(it => it.id === 'c');
  ok('#4b 현금 행 detail: source cash · 단가 = 평가액 = 투자금액', cd?.source === 'cash' && cd?.eval === 18418888 && cd?.price === 18418888);
  ok('#4c 현금 행이 있어도 정확값(allExact) — 이월에 갇히지 않는다', r?.allExact === true);
  const rOld = S(() => calc([STOCK, { ...CASH, category: '주식' }, DEP], 'portfolio', D2, SHM, {}, 1, {}));
  ok('#4d 대조: 조건이 하나라도 빠지면 종전대로 0원·데이터 없음(이 대조가 있어야 #4가 의미를 갖는다)',
    rOld?.total === 11500 && rOld?.allExact === false);
  const rOv = S(() => calc([CASH], 'overseas', D2, {}, {}, 1400, {}));
  ok('#4e 해외계좌에서는 적용하지 않는다', rOv?.total === 0);

  // ── 과거 날짜: 스냅샷 기반 재계산 ──
  const mkP = (snapItems, live = [STOCK, CASH, DEP]) => ({
    accountType: 'portfolio', portfolio: live, baselineDate: D1, preBaselineVerified: true,
    holdingSnapshots: [{ date: D1, kind: 'baseline', items: snapItems }],
  });
  const snapNew = S(() => snapshotItemsFromPortfolio([STOCK, CASH, DEP]));
  ok('#5 스냅샷이 구분(category)을 보존한다', Array.isArray(snapNew) && snapNew.find(it => it.type === 'stock' && !it.code)?.category === '현금');
  const ser = S(() => buildCloseEvalSeries(mkP(snapNew), [D1, D2], 'portfolio', SHM, {}, EDK));
  ok('#5b 과거 날짜도 현금이 정확값으로 들어간다',
    ser instanceof Map && ser.get(D1) === 10000 + 18418888 + 500 && ser.get(D2) === 11000 + 18418888 + 500);

  // 구분 보존 **전**에 찍힌 레거시 스냅샷(category 키 자체가 없다)
  const snapLegacy = Array.isArray(snapNew) ? snapNew.map(({ category, ...rest }) => rest) : [];
  const serL = S(() => buildCloseEvalSeries(mkP(snapLegacy), [D1, D2], 'portfolio', SHM, {}, EDK));
  ok('#6 레거시 스냅샷 + 지금 계좌에 현금 행 있음 → 과거 날짜도 복원',
    serL instanceof Map && serL.get(D2) === 11000 + 18418888 + 500);
  const serL2 = S(() => buildCloseEvalSeries(mkP(snapLegacy, [STOCK, { ...CASH, category: '주식' }, DEP]), [D1, D2], 'portfolio', SHM, {}, EDK));
  ok('#6b 레거시 스냅샷인데 지금 계좌에 현금 행이 없으면 복원하지 않는다(코드 미입력 일반 종목 오인 방지)',
    serL2 instanceof Map && serL2.get(D2) === undefined);
  const pPlain = mkP(S(() => snapshotItemsFromPortfolio([STOCK, DEP])));
  ok('#6c 후보가 없으면 스냅샷 배열을 그대로 돌려준다(참조 보존)',
    S(() => resolveHoldings(pPlain, D2).items === pPlain.holdingSnapshots[0].items) === true);
  const pNew = mkP(snapNew);
  ok('#6d 새 형식 스냅샷도 참조 그대로', S(() => resolveHoldings(pNew, D2).items === pNew.holdingSnapshots[0].items) === true);
  const pLegacy = mkP(snapLegacy);
  ok('#6e 레거시 복원은 읽기 전용 — 저장된 스냅샷을 바꾸지 않는다',
    S(() => { resolveHoldings(pLegacy, D2); return !('category' in pLegacy.holdingSnapshots[0].items.find(it => it.type === 'stock' && !it.code)); }) === true);

  // ── 구성 지문 ──
  eq('#7 현금 행이 없으면 지문은 종전 형식 그대로(배포만으로 새 스냅샷이 쌓이지 않는다)',
    S(() => snapshotCompositionKey([STOCK])), JSON.stringify(['stock:005930:10:0:9000']));
  ok('#7b 현금 행에는 :cash 토큰', /:cash"/.test(String(S(() => snapshotCompositionKey([CASH])))));
  ok('#7c 레거시 스냅샷 지문 ≠ 지금 구성 지문 → 구분을 담은 새 스냅샷이 1회 생긴다',
    S(() => snapshotCompositionKey(snapLegacy) !== snapshotCompositionKey([STOCK, CASH, DEP])) === true);
  ok('#7d 새 스냅샷이 생긴 뒤에는 지문이 같아 더 쌓이지 않는다',
    S(() => snapshotCompositionKey(snapNew) === snapshotCompositionKey([STOCK, CASH, DEP])) === true);
  ok('#7e 일반 종목의 구분만 바꾸면 지문이 바뀌지 않는다(평가에 영향 없음)',
    S(() => snapshotCompositionKey([STOCK]) === snapshotCompositionKey([{ ...STOCK, category: '채권' }])) === true);

  // ── 장부액 = 평가액 (그날 수익 0, 흡수 판정 정합) ──
  ok('#8 장부액에도 투자금액이 그대로 들어간다(평가 − 장부 = 0)', S(() => bookCostOf([CASH])) === 18418888);
}

console.log('\n── 파트② 배선 가드 (소스 텍스트) ──');

const utilsNC = stripComments(read('src/utils.ts'));
const pdRaw = read('src/hooks/usePortfolioData.ts');
const pd = stripComments(pdRaw);
const idRaw = read('src/hooks/useIntegratedData.ts');
const idNC = stripComments(idRaw);
const sdRaw = read('src/hooks/useStockData.ts');
const sdNC = stripComments(sdRaw);
const appRaw = read('src/App.tsx');
const appNC = stripComments(appRaw);
const acNC = stripComments(read('src/hooks/useAutoConfirmHistory.ts'));
const rpRaw = read('src/components/RebalancingPanel.tsx');
const rpNC = stripComments(rpRaw);
const ptNC = stripComments(read('src/components/PortfolioTable.tsx'));
const vmNC = stripComments(read('src/components/VerifyEvalModal.tsx'));
const xlNC = stripComments(read('src/portfolioExcel.ts'));

const imports = (raw, rel, names) => names.every(n => new RegExp(`import \\{[^}]*\\b${n}\\b[^}]*\\} from '${rel}';`).test(raw));

ok('#G1 판정은 utils 한 곳 — 네 조건 + 해외·금 제외',
  /export const isManualCashShape = /.test(utilsNC)
  && /export const isManualCashRow = \(item, accountType\?\) =>\s*accountType !== 'overseas' && accountType !== 'gold' && isManualCashShape\(item\);/.test(utilsNC));
ok('#G1b 판정식을 다른 곳에 손복제하지 않았다 (category === \'현금\' 비교는 utils에만)',
  ['src/hooks/usePortfolioData.ts', 'src/hooks/useIntegratedData.ts', 'src/hooks/useStockData.ts', 'src/App.tsx',
    'src/components/RebalancingPanel.tsx', 'src/components/PortfolioTable.tsx', 'src/components/VerifyEvalModal.tsx', 'src/portfolioExcel.ts']
    .every(f => !/category\)?\s*===\s*'현금'/.test(stripComments(read(f)))));
ok('#G2 calcPortfolioEvalDetail 주식 분기가 현금 행을 투자금액으로 평가한다(과거·통합·자산검증·백필 공통)',
  /if \(isManualCashRow\(item, accountType\)\) \{\s*const evl = manualCashEval\(item\);[\s\S]{0,200}source: 'cash'/.test(between(utilsNC, 'export const calcPortfolioEvalDetail', 'export const depositEvalOf')));
ok('#G2b 정확값 판정이 cash를 인정한다 (utils · 자동확정 둘 다 — 한쪽만이면 과거 날짜가 이월에 갇히거나 자동확정이 영구 보류)',
  /it\.source === 'manual' \|\| it\.source === 'cash'\) return true;/.test(between(utilsNC, 'export const calcPortfolioEvalDetail', 'export const depositEvalOf'))
  && /it\.source === 'manual' \|\| it\.source === 'cash'\) return true;/.test(acNC));
ok('#G2c 스냅샷이 구분을 보존하고 지문은 현금 행에만 토큰을 붙인다',
  /category: it\.category \|\| '',/.test(between(utilsNC, 'export const snapshotItemsFromPortfolio', 'export const buildHeldNameMap'))
  && /\$\{isManualCashShape\(it\) \? ':cash' : ''\}/.test(between(utilsNC, 'export const snapshotCompositionKey', 'export const ensurePortfolioVerificationFields')));
ok('#G2d resolveHoldings 두 반환 경로(baseline·일반)가 레거시 복원을 거친다',
  (between(utilsNC, 'export const resolveHoldings', 'const withLegacyCashCategory').match(/withLegacyCashCategory\(/g) || []).length === 2);
ok('#G2e 레거시 복원은 지금 계좌에 현금 행이 있을 때만',
  /if \(!\(p\?\.portfolio \|\| \[\]\)\.some\(\(it: any\) => isManualCashShape\(it\)\)\) return items;/.test(between(utilsNC, 'const withLegacyCashCategory', 'export const depositAmountAt')));

ok('#G3 표 합계(usePortfolioData totals)가 현금 행을 투자금액으로 — 투자 = 평가(수익 0)',
  /else if \(isManualCashRow\(item, activePortfolioAccountType\)\) \{\s*inv = evl = manualCashEval\(item\);/.test(between(pd, 'const totals = useMemo', 'const cagr = useMemo'))
  && imports(pdRaw, '\\.\\./utils', ['isManualCashRow', 'manualCashEval', 'MANUAL_CASH_CATEGORY']));
ok('#G3b 리밸런싱: 현금 행은 매매 0 · 예상평가금 = 현재 평가금(가격 0이라 일반 분기면 예상평가금이 0이 된다)',
  /if \(isManualCashRow\(item, activePortfolioAccountType\)\) \{\s*const curEval = manualCashEval\(item\);[\s\S]{0,600}action: 0, cost: 0, expEval: curEval,[\s\S]{0,200}isManualCash: true/.test(between(pd, 'const rebalanceData = useMemo', 'const allPortfoliosForDividend')));
ok('#G3c 화면용 표시 플래그(isManualCash)를 calc 행에 싣는다',
  /\.\.\.\(isCash \? \{ isManualCash: true \} : \{\}\)/.test(between(pd, 'const totals = useMemo', 'const cagr = useMemo')));

ok('#G4 통합 대시보드 계좌 합계 + 종목별 비중 둘 다',
  /const evl = isManualCashRow\(item, p\.accountType\) \? manualCashEval\(item\) : cleanNum\(item\.currentPrice\) \* cleanNum\(item\.quantity\) \* summaryFxRate;/.test(idNC)
  && /const isCash = isManualCashRow\(item, p\.accountType\);\s*const evl = isCash \? manualCashEval\(item\) : cleanNum\(item\.currentPrice\) \* qty \* fxRate;/.test(idNC)
  && imports(idRaw, '\\.\\./utils', ['isManualCashRow', 'manualCashEval', 'MANUAL_CASH_CATEGORY']));
ok('#G5 비활성 계좌 기록(useStockData) 두 합산 모두',
  (sdNC.match(/\} else if \(isManualCashRow\(item, p\.accountType\)\) \{/g) || []).length === 2
  && imports(sdRaw, '\\.\\./utils', ['isManualCashRow', 'manualCashEval']));
ok('#G6 App: 펀드 자동기록 합산 + 종목 정렬 + import',
  /\} else if \(isManualCashRow\(item, activePortfolioAccountType\)\) \{\s*targetEval \+= manualCashEval\(item\);/.test(appNC)
  && /const cP = isManualCashRow\(item, activePortfolioAccountType\) \? manualCashEval\(item\) : cleanNum\(item\.currentPrice\)/.test(appNC)
  && /isManualCashRow, manualCashEval,\n\} from '\.\/utils';/.test(appRaw));

ok('#G7 리밸런싱 표: 현금 행은 예적금처럼 매매 칸이 \'-\'(고정 참고 행)',
  /const isSavings = item\.type === 'savings' \|\| !!item\.isManualCash;/.test(rpNC));
ok('#G7b (%) 미러 시드가 현금 행의 현재 비중을 투자금액으로 잡는다(0%로 시드되면 매도 지시)',
  /isManualCashRow\(p, activePortfolioAccountType\) \? manualCashEval\(p\)/.test(between(rpNC, 'const curRatioOf', 'const rows = mirrorRows'))
  && imports(rpRaw, '\\.\\./utils', ['isManualCashRow', 'manualCashEval']));
ok('#G8 포트폴리오 표: 현재가 칸은 \'-\'(0을 찍으면 평가금액과 모순)',
  /\{item\.isManualCash\s*\? <span[^>]*>-<\/span>\s*: <span>\{isOverseas \? formatUSD\(item\.currentPrice\) : formatNumber\(item\.currentPrice\)\}<\/span>\}/.test(ptNC));
ok('#G8b 엑셀도 현재가 \'-\'', /currentPrice: item\.isManualCash \? DASH :/.test(xlNC));
ok('#G9 자산검증 모달: 현금 배지 + 종가 수동입력 비활성',
  /cash: \{ label: '💵 현금'/.test(vmNC) && /isCash: pd\.source === 'cash',/.test(vmNC)
  && /r\.isDeposit \|\| r\.isSavings \? '—' : r\.isCash \?/.test(vmNC));

console.log(`\n  총 ${pass + fail}건 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
