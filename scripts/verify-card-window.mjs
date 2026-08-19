#!/usr/bin/env node
// 계좌 카드 '별도 브라우저 창' 검증.
//
// 구성 ①  src/cardWindow.ts 를 **직접 import** 해 순수 함수를 테스트한다(미러 금지 — 미러는
//        src에만 넣은 변경/미러에만 넣은 변경이 둘 다 통과하는 구멍을 만든다). 이 파일은 import가
//        하나도 없어 Node가 타입만 벗겨 실행할 수 있다(verify:cal-detail #D1의 선례).
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

// 금지 토큰 검사는 **주석을 걷어낸 뒤** 한다 — 이 저장소는 금지 이유를 바로 그 자리 주석에
// 적으므로, 원문으로 재면 주석 속 토큰이 유령 사용으로 잡혀 가드가 영구히 실패한다.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\n── 파트① 순수 함수 (src/cardWindow.ts 직접 import) ──');

let CW = null;
try {
  CW = await import(pathToFileURL(join(ROOT, 'src/cardWindow.ts')).href);
} catch (e) {
  console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code || e.message}).`);
}

if (CW) {
  // #1 제목 — 사용자 요구 문구 그대로 "COVERD 4 - 분배금 현황"
  eq('#1 창 제목', CW.cardWindowTitle('COVERD 4', 'dividend'), 'COVERD 4 - 분배금 현황');
  eq('#1b 계좌명이 비면 카드 이름만', CW.cardWindowTitle('   ', 'rebalancing'), '리밸런싱');
  eq('#1c 모르는 카드도 죽지 않는다', CW.cardWindowTitle('A', 'nope'), 'A - 카드');

  // #2 window.open name — 같은 (계좌,카드)는 같은 이름 → 재클릭이 새 창을 열지 않고 포커스한다
  eq('#2 창 이름은 (계좌,카드)로 결정적', CW.cardWindowName('abc123', 'summary'), 'ass-card-abc123-summary');
  ok('#2b 안전 문자만 남긴다', CW.cardWindowName('a b/c#1', 'summary') === 'ass-card-abc1-summary');
  ok('#2c 다른 카드는 다른 창', CW.cardWindowName('p', 'summary') !== CW.cardWindowName('p', 'dividend'));

  // #3 URL — 파라미터 인코딩
  ok('#3 URL에 card·pid가 실린다', CW.cardWindowUrl('p1', 'dividend') === '/?cardWindow=1&card=dividend&pid=p1');
  ok('#3b pid 인코딩', CW.cardWindowUrl('a b', 'summary').includes('pid=a%20b'));

  // #4 ⚠️ 종가 부분집합의 코드 집합 = 현재 보유 ∪ 과거 스냅샷 ∪ 수동종가 키.
  //    현재 보유만 쓰면 매도·이관한 종목의 종가가 빠져 그 구간이 carry-forward로 그려지고
  //    창의 '자산 평가액 추이'가 앱 탭과 갈린다(설계 검증 확정 결함).
  const acct = {
    portfolio: [{ code: 'AAA' }, { code: '' }, { type: 'deposit' }],
    holdingSnapshots: [
      { items: [{ code: 'AAA' }, { code: 'SOLD1' }] },
      { items: [{ code: 'SOLD2' }] },
    ],
    manualPriceOverrides: { 'MAN1|2026-01-02': 100, 'MAN2': 5 },
  };
  const codes = CW.historicalCodesOf(acct).sort();
  eq('#4 과거 보유·수동종가 코드까지 합집합', codes, ['AAA', 'MAN1', 'MAN2', 'SOLD1', 'SOLD2']);
  ok('#4b 빈 코드는 제외', !codes.includes(''));
  eq('#4c 손상 입력에도 던지지 않는다', CW.historicalCodesOf(null), []);

  // #5 부분집합 투영 — 참조 재사용, 없는 코드는 키 자체가 없다
  const map = { AAA: { '2026-01-02': 1 }, ZZZ: { '2026-01-02': 2 } };
  const sub = CW.pickStockHistorySubset(map, ['AAA', 'NOPE']);
  ok('#5 필요한 코드만 담는다', Object.keys(sub).length === 1 && sub.AAA === map.AAA);
  eq('#5b 손상 입력 안전', CW.pickStockHistorySubset(null, ['A']), {});

  // #6 카드 키 / 지원 목록
  ok('#6 카드 키 판정', CW.isCardKey('rebalancing') && !CW.isCardKey('chart') && !CW.isCardKey(null));
  ok('#6b 지원 목록은 카드 키의 부분집합', CW.CARD_WINDOW_SUPPORTED.every(k => CW.isCardKey(k)));
  ok('#6c 지원하지 않는 카드는 확장 버튼을 만들지 않는다', !CW.isCardWindowSupported('nope'));

  // #7 CARD_NEEDS는 모든 카드 키를 덮는다 — 빠지면 그 카드가 필요한 데이터를 영원히 못 받는다
  ok('#7 CARD_NEEDS가 전 카드를 덮는다', CW.CARD_DEFS.every(d => CW.CARD_NEEDS[d.key] !== undefined));

  // #8 baseKey는 절대 던지지 않는다(순환 참조로 커맨드가 통째로 막히면 안 된다)
  const cyc = {}; cyc.self = cyc;
  ok('#8 순환 참조에도 던지지 않는다', typeof CW.baseKeyOf(cyc) === 'string');
  ok('#8b 같은 내용은 같은 지문', CW.baseKeyOf([1, 2]) === CW.baseKeyOf([1, 2]));
  ok('#8c 다른 내용은 다른 지문', CW.baseKeyOf([1, 2]) !== CW.baseKeyOf([1, 3]));

  // #9 op allow-list
  ok('#9 알 수 없는 op은 거부 대상', !CW.isCardOp('evilOp') && CW.isCardOp('dividendCall'));
}

console.log('\n── 파트② 소스 텍스트 가드(배선) ──');

const main = read('src/main.tsx');
const win = read('src/components/CardWindow.tsx');
const feed = read('src/components/CardWinFeed.tsx');
const app = read('src/App.tsx');
const ups = read('src/hooks/usePortfolioState.ts');
const usd = read('src/hooks/useStockData.ts');
const panel = read('src/components/RebalancingPanel.tsx');
const btn = read('src/components/CardExpandButton.tsx');

// ── INV-1: 창은 App을 마운트하지 않는다 ──
ok('#G1 main.tsx가 cardWindow 파라미터로 CardWindow를 렌더한다',
  /const CARD_WINDOW_BOOT = _params\.get\('cardWindow'\) === '1'/.test(main)
  && /CARD_WINDOW_BOOT \? <CardWindow \/>/.test(main));
ok('#G1b ⚠️ 창은 App을 import하지 않는다 (두 번째 Drive writer 금지)',
  !/from '\.\.\/App'/.test(win) && !/import App /.test(win));

// ── INV-6: 양쪽 모두 접두사 검사(열거형 금지) ──
ok('#G2 창의 수신은 접두사 검사다',
  /d\.type\.startsWith\('card:'\)/.test(win));
ok('#G2b 앱의 수신도 접두사 검사다',
  /d\.type\.startsWith\('card:'\)/.test(app));
ok('#G2c 창은 origin과 opener를 검사한다',
  /e\.origin !== window\.location\.origin/.test(win) && /e\.source !== window\.opener/.test(win));

// ── INV-3 + fail-closed: 창은 자기 계좌 외에 쓰지 못한다 ──
{
  const s = stripComments(app);
  const i = s.indexOf('runCardCmdRef.current = (entry, op, args)');
  // ⚠️ 핸들러 **전체**를 잡는다 — 고정 길이로 자르면 op이 늘 때마다 뒷부분이 잘려 나가
  //    '기본 거부' 단언이 조용히 죽는다(실제로 그렇게 실패했다).
  const jEnd = i >= 0 ? s.indexOf('useEffect(() => {', i) : -1;
  const body = i >= 0 ? s.slice(i, jEnd > 0 ? jEnd : i + 8000) : '';
  ok('#G3 커맨드 핸들러가 존재한다', body.length > 200);
  ok('#G3b ⚠️ by-id 쓰기는 pid === entry.pid를 재확인한다 (타 계좌 오적용 차단)',
    /const pidOk = \(pid\) => pid === entry\.pid;/.test(body) && /if \(!pidOk\(list\[0\]\)\) return \{ ok: false/.test(body));
  ok('#G3c ⚠️ allow-list(default deny) — 모르는 op은 사유와 함께 거부한다',
    /default:[\s\S]{0,60}?return \{ ok: false, reason: `지원하지 않는 동작입니다 \(\$\{op\}\)\.` \};/.test(body));
  ok('#G3e ⚠️ 계좌 스코프 커맨드는 switch 진입 **전에** pid를 검사한다 (개별 case가 빠뜨려도 새지 않게)',
    /if \(!pidOk\(a\.pid\)\) return \{ ok: false, reason: '이 창은 다른 계좌를 수정할 수 없습니다\.' \};[\s\S]{0,40}?switch \(op\)/.test(body));
  ok('#G3f ⚠️ 달력 스냅샷은 **창이 만든 엔트리**를 그대로 upsert한다 (앱이 활성 계좌로 재빌드 금지)',
    /built\.entry\.portfolioId !== a\.pid/.test(body)
    && /upsertRebalTargetMemo\(calendarMemosRef\.current, built\.dayKey, built\.entry/.test(body)
    && !/buildRebalTargetEntry\(/.test(body));
  ok('#G3d ⚠️ patchActive 계열을 프록시하지 않는다',
    !/\bpatchActive\(/.test(body) && !/\bsetPortfolio\(/.test(body));
}
ok('#G4 ⚠️ 쓰기 커맨드는 입양된 창만 (ping만 그 앞의 의도된 예외)',
  /const entry = d\.winId \? cardWinsRef\.current\.get\(d\.winId\) : null;[\s\S]{0,120}?if \(!entry \|\| entry\.win !== e\.source\) return;/.test(stripComments(app)));
{
  const s = stripComments(app);
  ok('#G4b ping 분기는 입양 게이트보다 앞이다',
    s.indexOf("d.type === 'card:ping'") >= 0
    && s.indexOf("d.type === 'card:ping'") < s.indexOf('if (!entry || entry.win !== e.source) return;'));
}

// ── 다중 창 레지스트리 ──
ok('#G5 ⚠️ 단일 ref가 아니라 Map 레지스트리다 (창 2개 이상에서 앞 창이 낡지 않게)',
  /const cardWinsRef = useRef\(new Map\(\)\);/.test(app));
ok('#G5b 닫힌 창을 주기적으로 정리한다',
  /const sweepCardWins = useCallback/.test(app) && /setInterval\(sweepCardWins, \d+\)/.test(app));
ok('#G5c 창마다 피더를 하나씩 마운트한다 (가변 훅 호출 회피)',
  /cardWinKeys\.map\(k => \{[\s\S]{0,600}?<CardWinFeed/.test(app));

// ── 창 열기 ──
{
  const s = stripComments(app);
  const i = s.indexOf('const openCardWindow = useCallback');
  const body = i >= 0 ? s.slice(i, i + 1200) : '';
  ok('#G6 ⚠️ noopener 금지 (opener 브릿지가 기능의 전부)', body.length > 100 && !/noopener/.test(body));
  ok('#G6b 같은 (계좌,카드) 재클릭은 기존 창을 포커스한다',
    /existing\?\.win && !existing\.win\.closed/.test(body) && /existing\.win\.focus\(\)/.test(body));
  ok('#G6c 지원 카드만 연다 (죽은 버튼 금지)', /if \(!isCardWindowSupported\(card\) \|\| !pid\) return;/.test(body));
  ok('#G6d 팝업 차단을 감지한다', /if \(!w\) \{ setCardWinBlocked\(true\); return; \}/.test(body));
}

// ── INV-7: 비활동 ──
ok('#G7 ⚠️ 경고가 이미 떴으면 resetActivity로는 못 막는다 — handleInactivityContinue를 부른다',
  /if \(showInactivityWarning\) handleInactivityContinue\(\); else resetActivity\(\);/.test(app));
ok('#G7b 창이 활동 신호를 보낸다',
  /type: 'card:activity'/.test(win));

// ── 세션 정리(다중 계정 오염 방지) ──
{
  const s = stripComments(app);
  const forceIdx = s.indexOf('onForceLogout: () => {');
  const forceBody = forceIdx >= 0 ? s.slice(forceIdx, forceIdx + 600) : '';
  ok('#G8 ⚠️ 강제 로그아웃이 카드 창을 정리한다 — ADMIN_VIEW_EMAIL 가드보다 **앞**',
    /teardownCardWinsRef\.current\?\.\(\)/.test(forceBody)
    && forceBody.indexOf('teardownCardWinsRef') < forceBody.indexOf('ADMIN_VIEW_EMAIL'));
  const logoutIdx = s.indexOf('onLogout={() => {');
  const logoutBody = logoutIdx >= 0 ? s.slice(logoutIdx, logoutIdx + 600) : '';
  ok('#G8b 수동 로그아웃도 정리한다 — 같은 순서',
    /teardownCardWinsRef\.current\?\.\(\)/.test(logoutBody)
    && logoutBody.indexOf('teardownCardWinsRef') < logoutBody.indexOf('ADMIN_VIEW_EMAIL'));
}
ok('#G8c 창은 teardown에서 **화면 내용을 지운다** (읽기 전용만으로는 데이터가 남는다)',
  /d\.type === 'card:teardown'[\s\S]{0,400}?setAccount\(null\); setTornDown\(true\)/.test(win));
ok('#G8d ⚠️ authEpoch 불일치면 창을 비운다 (앱 탭이 다른 사용자로 재로그인한 경우)',
  /authEpochRef\.current !== null|authEpochRef\.current != null/.test(win)
  && /d\.authEpoch !== authEpochRef\.current/.test(win)
  && /setAccount\(null\); setTornDown\(true\); return;/.test(win));
ok('#G8e 앱이 authEpoch를 실어 보낸다', /authEpoch,/.test(feed) && /const cardAuthEpoch = /.test(app));

// ── INV-2: 파생은 창에서, 원자재만 push ──
ok('#G9 창이 usePortfolioData로 직접 파생을 계산한다',
  /import \{ usePortfolioData \} from '\.\.\/hooks\/usePortfolioData'/.test(win)
  && /const data = usePortfolioData\(\{/.test(win));
ok('#G9b ⚠️ 피더는 파생값을 보내지 않는다 (totals·rebalanceData 등)',
  !/totals|rebalanceData|allPortfoliosForDividend/.test(stripComments(feed)));
ok('#G10 ⚠️ 종가 부분집합은 historicalCodesOf(합집합)로 만든다',
  /pickStockHistorySubset\(stockHistoryMap, historicalCodesOf\(account\)\)/.test(feed));

// ── INV-5: 창은 자기 확인창·토스트·경계를 갖는다 ──
ok('#G11 창이 자체 ConfirmDialog를 렌더한다',
  /<ConfirmDialog state=\{confirmState\} onResolve=\{resolveConfirm\} \/>/.test(win));
ok('#G11b 창의 confirm은 창 안에서 resolve한다 (앱 프록시 금지)',
  /new Promise\(resolve => setConfirmState\(\{ message, confirmLabel, resolve \}\)\)/.test(win));
ok('#G11c 창이 자체 인라인 토스트를 그린다 (notify는 벨 로그만이라 창에선 피드백 0)',
  /toasts\.map\(t => \(/.test(win));
ok('#G11d ⚠️ ErrorBoundary label 필수 (루트 경계는 label이 없어 전면 오류 페이지가 된다)',
  /<ErrorBoundary label=\{CARD_LABELS\[CARD\] \|\| '카드'\}>/.test(win));

// ── 끊김 = 읽기 전용 ──
ok('#G12 끊김·미수신이면 writable이 false다',
  /const writable = linked && gotData && !tornDown && !!account;/.test(win));
ok('#G12b ping의 need가 초기 전송의 유일한 트리거다',
  /need: !gotDataRef\.current/.test(win) && /if \(d\.need \|\| !cur \|\| cur\.win !== e\.source\)/.test(app));

// ── 요청/응답 상관 ──
ok('#G13 커맨드는 reqId로 응답을 상관시킨다',
  /type: 'card:cmd', winId: WIN_ID, reqId, op, args/.test(win)
  && /d\.type === 'card:ack'/.test(win)
  && /type: 'card:ack', winId: d\.winId, reqId: d\.reqId/.test(app));
ok('#G13b 무응답 타임아웃이 있다 (스피너 영구 회전 방지)',
  /setTimeout\(\(\) => done\(\{ ok: false, reason: '앱 창이 응답하지 않습니다\.' \}\), CMD_TIMEOUT_MS\)/.test(win));

// ── 확장 버튼 ──
ok('#G14 확장 버튼은 onExpand가 없으면 렌더하지 않는다 (죽은 버튼 금지)',
  /if \(!onExpand\) return null;/.test(btn));
ok('#G14b 분배금 카드 헤더에 확장 버튼이 붙어 있다',
  /<CardExpandButton onExpand=\{onExpand\} opened=\{cardWindowOpen\} label="분배금 현황" \/>/.test(read('src/components/DividendSummaryTable.tsx')));
ok('#G14c 요약 카드 헤더에 확장 버튼이 붙어 있다',
  /<CardExpandButton onExpand=\{onExpand\} opened=\{cardWindowOpen\} label="포트폴리오 요약" \/>/.test(read('src/components/PortfolioSummaryPanel.tsx')));
ok('#G14d App이 카드마다 onExpand를 실제로 넘긴다',
  /onExpand=\{\(\) => openCardWindow\('summary', activePortfolioId\)\}/.test(app)
  && /onExpand=\{\(\) => openCardWindow\('dividend', activePortfolioId\)\}/.test(app)
  // 리밸런싱·자산비중비교는 한 컴포넌트의 두 카드 → 진입점도 둘이다(사용자 확정: 각각 별도 창).
  && /onExpandTable=\{\(\) => openCardWindow\('rebalancing', activePortfolioId\)\}/.test(app)
  && /onExpandDonut=\{\(\) => openCardWindow\('donut', activePortfolioId\)\}/.test(app));
ok('#G14e 리밸런싱·도넛 카드 헤더에 확장 버튼이 붙어 있다',
  /<CardExpandButton onExpand=\{onExpandTable\} opened=\{tableWindowOpen\} label="리밸런싱" \/>/.test(panel)
  && /<CardExpandButton onExpand=\{onExpandDonut\} opened=\{donutWindowOpen\} label="자산비중비교" \/>/.test(panel));
ok('#G14f 지원 카드 목록에 4종이 들어 있다 (CardWindow 분기와 짝)',
  /CARD_WINDOW_SUPPORTED: string\[\] = \['summary', 'dividend', 'rebalancing', 'donut'\]/.test(read('src/cardWindow.ts')));

// ── by-id 라이터 계층 ──
ok('#G15 patchActive는 patchById 위임이다 (활성 경로 동작 불변)',
  /const patchActive = \(patch\) => patchById\(activePortfolioId, patch\);/.test(ups));
ok('#G15b handleUpdate는 handleUpdateFor에 pid를 넘긴다',
  /const handleUpdate = \(id, field, value\) => handleUpdateFor\(activePortfolioId, id, field, value\);/.test(ups));
ok('#G15c ⚠️ updateSettingsForTypeOf는 accountType을 **pid**에서 해석한다',
  /const updateSettingsForTypeOf = \(pid, newSettings\) => \{[\s\S]{0,400}?const t = prev\.find\(p => p\.id === pid\);[\s\S]{0,300}?p\.accountType === t\.accountType/.test(ups));
{
  // ⚠️ 함수 본문만 정확히 잘라낸다 — 넉넉한 고정 길이로 자르면 뒤 함수의 setPortfolios가
  //    섞여 들어와 '원자성' 단언이 무의미해진다(처음에 그렇게 실패했다).
  const s = stripComments(ups);
  const i = s.indexOf('const applyCardWriteFor = (pid, ops)');
  const rest = i >= 0 ? s.slice(i + 10) : '';
  const j = rest.indexOf('\n  const ');
  const body = i >= 0 ? rest.slice(0, j >= 0 ? j : rest.length) : '';
  ok('#G15d 복합 쓰기는 단일 setPortfolios로 원자적이다 (미러 반쪽 적용 방지)',
    body.length > 300
    && (body.match(/setPortfolios\(/g) || []).length === 1
    && /if \(!t\) return prev;/.test(body)          // 없는 계좌엔 구조적 no-op
    && /p\.accountType === t\.accountType/.test(body));  // settings 전파는 pid의 타입 기준
}
ok('#G16 ⚠️ 시세 재조회는 pid의 accountType으로 라우팅·스탬프한다',
  /const handleSingleStockRefreshFor = async \(pid, id, code\) => \{/.test(usd)
  && /const acctType = acct\.accountType \|\| 'portfolio';/.test(usd)
  && /const isOverseas = acctType === 'overseas';/.test(usd)
  && /const stampD = stampDateFor\(acctType\);/.test(usd));
ok('#G16b 활성 경로는 위임이라 App 배선이 그대로다 (verify:ladder #109 유지)',
  /const handleSingleStockRefresh = \(id, code\) => handleSingleStockRefreshFor\(activePortfolioIdRef\.current, id, code\);/.test(usd)
  && /onRefreshPrice=\{handleSingleStockRefresh\}/.test(app));

// ── 리밸런싱 카드 이식 ──
{
  const s = stripComments(panel);
  ok('#G18 ⚠️ 항목 쓰기는 writeTargets 하나로 모인다 — 함수형 setPortfolio 잔재 0건',
    /const writeTargets = \(itemPatches, settingsFields\) => \{/.test(s)
    // 남아 있어도 되는 setPortfolio는 둘뿐: writeTargets 내부(인앱 경로)와 복원 센티넬 구간.
    && (s.match(/setPortfolio\(prev =>/g) || []).length === 2);
  ok('#G18b ⚠️ cardWrite가 있으면 그쪽으로만 보낸다 (항목+settings 원자적)',
    /if \(cardWrite\) \{[\s\S]{0,220}?cardWrite\(\{ itemPatches: patches, settingsFields: settingsFields \|\| null \}\);[\s\S]{0,40}?return;/.test(s));
  ok('#G18c ⚠️ readOnly면 아무것도 쓰지 않는다 (끊긴 창에서 편집이 조용히 증발하지 않게)',
    /const writeTargets = \(itemPatches, settingsFields\) => \{\s*\n\s*if \(readOnly\) return;/.test(s));
  // ⚠️ 미러 사이클은 '항목 patch + 미러 상태'를 반드시 **한 번의 writeTargets**로 써야 한다.
  //    쪼개면 별도 창에서 한쪽만 적용된 반쪽 상태가 남고, 사용자가 다시 누르면 같은 전이를 또 타서
  //    목표값이 두 번 덮인다(undo 없음).
  //    ⚠️ 갭 정규식(`[\s\S]{0,700}`)으로 '호출 + settings 인자'를 재려 했더니 **문장 경계를 넘어**
  //    다음 호출의 인자를 집어, 쪼개는 변이가 그대로 통과하는 죽은 단언이 됐다(변이 R1로 실증).
  //    사이클 함수 본문을 잘라 **호출 횟수 = 전이 수(3)** 로 세는 편이 정확하다.
  const cycleBody = (startMark) => {
    const a = s.indexOf(startMark);
    if (a < 0) return '';
    const b = s.indexOf('reportAdminChange();', a);
    return b > a ? s.slice(a, b) : '';
  };
  const pctBody = cycleBody('const cycleMirror = () => {');
  const amtBody = cycleBody('const cycleAmtMirror = () => {');
  ok('#G18d ⚠️ (%) 미러 3전이 = writeTargets 3회 (항목 patch와 미러 상태를 한 번에)',
    pctBody.length > 300
    && (pctBody.match(/writeTargets\(/g) || []).length === 3
    && (pctBody.match(/\[mirrorField\]: '(?:seeded|on|off)'/g) || []).length === 3
    && !/updateSettingsForType\(/.test(pctBody));
  ok('#G18d2 ⚠️ (₩) 미러 3전이 = writeTargets 3회',
    amtBody.length > 300
    && (amtBody.match(/writeTargets\(/g) || []).length === 3
    && (amtBody.match(/targetAmountMirror: '(?:seeded|on|off)'/g) || []).length === 3
    && !/updateSettingsForType\(/.test(amtBody));
  ok('#G18d3 ⚠️ 잔액→예수금도 예수금 행 patch와 settings 해제를 한 번에 쓴다',
    /writeTargets\(\s*\n\s*mirrorRows\(\['deposit'\]\)\.map\(p => \(\{ id: p\.id, fields: \{ depositAmount: newDeposit \} \}\)\),\s*\n\s*\(!isLevelMode && settings\.useDepositAmount != null\) \? \{ useDepositAmount: null \} : null\);/.test(s));
  ok('#G18e 목표 날짜 즉시 기록은 Promise 반환도 받는다 (창은 ack를 기다려야 결과를 안다)',
    /if \(r && typeof r\.then === 'function'\) \{ r\.then\(flashSaveResult, \(\) => flashSaveResult\('fail'\)\); return; \}/.test(s));
  ok('#G18f 복원은 setPortfolio가 없으면 구조적 no-op (창에서 타 계좌 오적용 원천 차단)',
    /const applyRestoredTargets = \(dayKey, memo, matched\) => \{\s*\n\s*if \(!setPortfolio\) return;/.test(s));
}
{
  const s = stripComments(win);
  ok('#G19 ⚠️ 창은 setPortfolio를 넘기지 않는다 (함수형 updater는 직렬화 불가)',
    /<RebalancingPanel/.test(s) && !/setPortfolio=\{/.test(s));
  ok('#G19b 창은 cardWrite로 쓴다', /cardWrite=\{\(ops\) => fire\('cardWrite', \{ pid: PID, ops \}\)\}/.test(s));
  ok('#G19c ⚠️ settings는 **바뀐 필드만** 보낸다 (통째 교체는 형제 계좌·앱 탭 최신값을 되감는다)',
    /const settingsDiff = useCallback\(\(next\) => \{/.test(s)
    && /updateSettingsForType=\{\(next\) => fire\('patchSettings', \{ pid: PID, fields: settingsDiff\(next\) \}\)\}/.test(s));
  ok('#G19d ⚠️ 달력 스냅샷은 창이 **자기 화면 값**으로 만든다 (앱이 활성 계좌로 빌드하면 기록이 거짓이 된다)',
    /buildRebalTargetEntryFrom\(\{/.test(s)
    && /rebalanceData: data\.rebalanceData,/.test(s)
    && /rebalExtraQty,/.test(s)
    && /send\('saveTargetSnapshot', \{ pid: PID, built \}\)/.test(s));
  ok('#G19e 창을 닫을 때 미커밋 기록을 한 번 커밋한다 (앱의 종료 커밋 체인이 창엔 없다)',
    /window\.addEventListener\('pagehide', onHide\)/.test(s) && /snapshotDirtyRef\.current/.test(s));
  ok('#G19f ⚠️ PIN 검증은 앱 탭에 위임한다 (창 sessionStorage는 열린 시점 사본이라 낡는다)',
    /pinVerify=\{async \(pin\) => \{ const r = await send\('verifyPin', \{ pid: PID, pin \}\); return !!\(r && r\.ok && r\.result\); \}\}/.test(s));
  ok('#G19g 끊기면 편집을 막는다', /readOnly=\{!writable\}/.test(s));
}
ok('#G20 App의 스냅샷 빌더는 공유 순수 함수 위임이다 (창과 값·행 순서가 갈리지 않게)',
  /const buildRebalTargetEntry = \(overrideDate\) => buildRebalTargetEntryFrom\(\{/.test(app)
  && /const sameRebalEntry = sameRebalTargetEntry;/.test(app));
ok('#G20b PIN 모달은 비동기 검증기를 받는다 (인앱은 종전대로 로컬 verifyPin)',
  /const okResult = verify \? await verify\(pin\) : verifyPin\(pin, authUser\?\.email\);/.test(read('src/components/RebalanceTargetPinModal.tsx')));

// ── 영속화(선행 결함) ──
ok('#G17 ⚠️ 지문에 actualDividendQty·dividendTaxAmounts가 있다 (분배금 전용 창의 무음 유실 방지)',
  /actualDividendQty: p\.actualDividendQty,/.test(app) && /dividendTaxAmounts: p\.dividendTaxAmounts,/.test(app));

console.log(`\n${fail ? '❌' : '✅'} verify:card-window — ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
