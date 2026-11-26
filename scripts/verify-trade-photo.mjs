#!/usr/bin/env node
// 자산 평가액 추이 「📷 주문내역 사진으로 매매 넣기」 검증.   실행: npm run verify:trade-photo
//
// 발단(사용자 요청 2026-11-26): 미래에셋 MY주식 → 주문내역(최근 1개월) 사진을 올리면 그날의 수량을 바꾸고 싶다.
//   사진: 종목명은 화면 위 제목에만 · 날짜 '11.17'(연도 없음) · 열 = 주문날짜·구분·주문단가·체결수량·평균체결가
//   11.24 매도 50 @7,490 · 11.23 매수 5 @6,960 · 11.17 매수 30 @7,090 / 20 @7,150 / 10 @7,200
// 구성 ①  src/tradePhoto.ts·src/backdatedTrade.ts·src/utils.ts·api/_holdingsPhoto.ts 직접 import — 해석·합치기·넣기·두 번 막기·옮기기·되돌리기.
// 구성 ②  소스 텍스트 가드 — 버튼(추이 머리줄) → 창 → /api/holdings-photo(kind 'trades') → 끝까지 받은 답만 → 같은 함수로 넣기.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\n── 파트① 해석·넣기 (src/tradePhoto.ts 직접 import) ──');
let T = null, U = null, S = null;
try {
  T = await import(pathToFileURL(join(ROOT, 'src/tradePhoto.ts')).href);
  U = await import(pathToFileURL(join(ROOT, 'src/utils.ts')).href);
  S = await import(pathToFileURL(join(ROOT, 'api/_holdingsPhoto.ts')).href);
} catch (e) {
  if (e && e.code === 'ERR_UNKNOWN_FILE_EXTENSION') console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  else { fail++; console.log(`  ✗ 모듈 로드 실패 — ${e && (e.code || e.message)}`); }
}

const TODAY = '2026-11-26';
const NAME = 'TIGER 반도체TOP10커버드콜액티브';
// 사용자 사진을 AI가 읽은 답(서버 부탁 문장의 형식)
const PHOTO = [
  `매매 | 11-24 | 0177R0 | ${NAME} | 매도 | 50 | 7,490`,
  `매매 | 11-23 | 0177R0 | ${NAME} | 매수 | 5 | 6,960`,
  `매매 | 11-17 | 0177R0 | ${NAME} | 매수 | 30 | 7,090`,
  `매매 | 11-17 | 0177R0 | ${NAME} | 매수 | 20 | 7,150`,
  `매매 | 11-17 | 0177R0 | ${NAME} | 매수 | 10 | 7,200`,
].join('\n');

const mkLive = (o = {}) => [
  { id: 'd', type: 'deposit', depositAmount: o.cash ?? 2534 },
  { id: 't', type: 'stock', code: '0177R0', name: NAME, quantity: o.tq ?? 10885, investAmount: o.ti ?? 113049394, purchasePrice: 0, currentPrice: 6750 },
  { id: 'k', type: 'stock', code: '0190G0', name: 'KODEX 반도체', quantity: 10527, investAmount: 82781906, purchasePrice: 0, currentPrice: 5695 },
];
const mkAcct = (snapsSpec, liveSpec = {}) => ({
  id: 'p1', name: 'AI일반 증권', accountType: 'portfolio', baselineDate: '2026-10-28', preBaselineVerified: false,
  holdingSnapshots: snapsSpec.map(([date, kind, o]) => ({ date, kind, items: U.snapshotItemsFromPortfolio(mkLive(o)) })),
  portfolio: mkLive(liveSpec),
});
const itemAt = (p, date, code = '0177R0') => (U.resolveHoldings(p, date).items || []).find(i => i.code === code);
const live = (p, code = '0177R0') => p.portfolio.find(i => i.code === code);
const wouldAddSnapshot = (p) => {
  const snaps = [...(p.holdingSnapshots || [])].sort((a, b) => a.date.localeCompare(b.date));
  return U.snapshotCompositionKey(snaps[snaps.length - 1].items || []) !== U.snapshotCompositionKey(p.portfolio || []);
};
const run = (p, text = PHOTO, opts = {}) => {
  const parsed = T.parseTradeText(text, TODAY);
  return T.runTradePhoto(p, T.groupTrades(parsed.rows), { accountType: p.accountType, cashOn: !!opts.cashOn, today: TODAY });
};

if (T && U && S) {
  // ── #P 해석·합치기 ──
  {
    const ps = T.parseTradeText(PHOTO, TODAY);
    const g = T.groupTrades(ps.rows);
    eq('#P1 다섯 줄 → 세 건(11/17 세 번 체결 = 한 건)', g.map(x => [x.date, x.side, x.qty, x.fills]), [['2026-11-24', 'sell', 50, 1], ['2026-11-23', 'buy', 5, 1], ['2026-11-17', 'buy', 60, 3]]);
    ok('#P2 11/17 단가 = 수량 가중평균 7,128.33(평균체결가)', Math.abs(g[2].price - 427700 / 60) < 1e-6);
    eq('#P3 연도 없는 날짜 = 오늘 이전의 가장 가까운 날', [T.normTradeDate('11.17', TODAY), T.normTradeDate('12.30', TODAY), T.normTradeDate('11/26', TODAY), T.normTradeDate('2026.11.17', TODAY), T.normTradeDate('26.11.17', TODAY), T.normTradeDate('2/30', TODAY), T.normTradeDate('', TODAY)],
      ['2026-11-17', '2025-12-30', '2026-11-26', '2026-11-17', '2026-11-17', '', '']);
    const bad = T.parseTradeText('매매 | 11-17 | - | A | 정정 | 3 | 100\n매매 | 11-17 | - | A | 매수 | 0 | 100\n매매 | 11-17 | 0177R0\n없음', TODAY);
    eq('#P4 못 읽는 줄은 까닭과 함께 빼기(구분·체결 0·칸 부족)', bad.skipped.map(s => s.reason), ['매수·매도를 못 읽음', '체결수량 없음', '칸이 모자람']);
    eq('#P5 「없음」 한 줄 = none', T.parseTradeText('없음', TODAY).none, true);
    const pr = S.buildTradePrompt({ account: 'AI', cands: [{ code: '0177R0', name: NAME }], today: TODAY });
    const ex = pr.split('\n').slice(pr.split('\n').indexOf('예)') + 1).join('\n');
    eq('#P6 서버 부탁 문장의 예시 줄 = 해석기 형식', T.parseTradeText(ex, TODAY).rows.map(r => [r.date, r.side, r.qty, r.price]), [['2026-11-24', 'sell', 50, 103920], ['2026-11-17', 'buy', 30, 13050]]);
    ok('#P7 부탁 문장 — 오늘 날짜 · 제목의 종목명 · 체결수량≠주문수량 · 평균체결가≠주문단가 · 계좌번호 안 씀 · 목록',
      pr.includes(`오늘은 ${TODAY}`) && pr.includes('화면 위(제목)') && pr.includes("'주문수량'이 아닙니다") && pr.includes("'주문단가'") && pr.includes('계좌번호') && pr.includes(`0177R0 ${NAME}`));
    const img = { mime: 'image/jpeg', data: 'A'.repeat(200) };
    const req = S.checkHoldReq({ kind: 'trades', account: 'AI', cands: [], images: [img] });
    const gb = JSON.parse(S.holdGeminiBody(req, TODAY));
    eq('#P8 kind trades → 주문내역 부탁 문장 · 없으면 잔고(hold)', [req.kind, gb.contents[0].parts[1].text === S.buildTradePrompt({ account: 'AI', cands: [], today: TODAY }), S.checkHoldReq({ images: [img] }).kind], ['trades', true, 'hold']);
    // #P10 구독 AI(Gemini·Claude 앱)에 줄 부탁 글 — 답 줄 형식이 서버 부탁 문장과 같고, 예시 줄이 해석된다
    const ask = T.tradeAskPrompt({ cands: [{ code: '0177R0', name: NAME }], today: TODAY });
    const fmtLine = (t) => t.split('\n').find(l => l.startsWith('매매 |'));
    eq('#P10 답 줄 형식 = 서버 부탁 문장 · 예시 줄 해석', [fmtLine(ask), fmtLine(pr) === T.TRADE_LINE_FORMAT, T.parseTradeText(ask.split('예)')[1], TODAY).rows.map(r => [r.date, r.side, r.qty])],
      [T.TRADE_LINE_FORMAT, true, [['2026-11-24', 'sell', 50]]]);
    ok('#P10 부탁 글 — 오늘 날짜 · 종목 목록 · 체결수량·평균체결가 · 개인정보 안 씀', ask.includes(TODAY) && ask.includes(`0177R0 ${NAME}`) && ask.includes("'주문수량'이 아닙니다") && ask.includes("'주문단가'가 아닙니다") && ask.includes('계좌번호'));
    // #P12 사진을 읽힐 무료 AI 목록 = 화면 AI_HANDS에 있는 id(주소는 그 표 하나)
    const PV = await import(pathToFileURL(join(ROOT, 'src/aiProviders.ts')).href);
    ok('#P12 PHOTO_AI_IDS 전부 AI_HANDS에 있음 · Gemini가 맨 앞', T.PHOTO_AI_IDS.length >= 5 && T.PHOTO_AI_IDS.every(id => !!PV.aiHandById(id)) && T.PHOTO_AI_IDS[0] === 'gemini');
    // #P11 채팅 AI가 표·코드블록·글머리로 감싸 답해도 읽는다
    const chat = ['```', `| 매매 | 2026-11-24 | 0177R0 | ${NAME} | 매도 | 50 | 7,490 |`, `- 매매 | 2026-11-23 | 0177R0 | ${NAME} | 매수 | 5 | 6,960`, '```', '위와 같이 정리했습니다.'].join('\n');
    eq('#P11 표(|…|)·글머리(-)·코드블록 안의 줄도 읽음, 설명 글은 무시', T.parseTradeText(chat, TODAY).rows.map(r => [r.date, r.side, r.qty, r.price]), [['2026-11-24', 'sell', 50, 7490], ['2026-11-23', 'buy', 5, 6960]]);
    eq('#P9 잘린 이름도 하나뿐이면 맞춤 · 겹치면 안 맞춤', [
      T.matchTradeIndex({ code: '', name: 'TIGER 반도체T' }, mkLive()), T.matchTradeIndex({ code: '', name: 'TIGER 반도체TOP10' }, mkLive()),
      T.matchTradeIndex({ code: '', name: '반도체' }, mkLive()), T.matchTradeIndex({ code: '0190G0', name: '?' }, mkLive()),
    ], [1, 1, -1, 2]);
  }
  // ── #R 사용자 사례 — 세 건을 날짜에 넣고 계좌 표까지 ──
  {
    const p0 = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}]]);
    const out = run(p0);
    const n = out.next;
    eq('#R1 세 건 모두 넣음', [out.applied, out.results.map(r => r.status)], [3, ['ok', 'ok', 'ok']]);
    eq('#R2 날짜별 보유: 11/16 10,885 · 11/17 10,945 · 11/23 10,950 · 11/24 10,900', [itemAt(n, '2026-11-16').quantity, itemAt(n, '2026-11-17').quantity, itemAt(n, '2026-11-23').quantity, itemAt(n, '2026-11-24').quantity], [10885, 10945, 10950, 10900]);
    const inv17 = 113049394 + 427700, inv23 = inv17 + 34800, inv24 = Math.round(inv23 * 10900 / 10950);
    eq('#R3 투자금액: 매수 + 체결 금액 · 매도 × 남은÷원래', [itemAt(n, '2026-11-17').investAmount, itemAt(n, '2026-11-23').investAmount, itemAt(n, '2026-11-24').investAmount], [inv17, inv23, inv24]);
    eq('#R4 계좌 표 = 10,900주 · 마지막 투자금액', [live(n).quantity, live(n).investAmount, out.live[0].qtyBefore, out.live[0].qtyAfter], [10900, inv24, 10885, 10900]);
    ok('#R5 ⚠️ 되돌림 기록 없음(마지막 기록 = 계좌 표)', !wouldAddSnapshot(n));
    eq('#R6 그날 기록마다 매매 한 건이 남는다(src photo)', n.holdingSnapshots.filter(s => s.trades).map(s => [s.date, s.trades.map(t => [t.side, t.qty, t.src])]).sort(),
      [['2026-11-17', [['buy', 60, 'photo']]], ['2026-11-23', [['buy', 5, 'photo']]], ['2026-11-24', [['sell', 50, 'photo']]]]);
    eq('#R7 예수금은 안 건드림(체크 안 함)', [live(n).quantity && n.portfolio[0].depositAmount, out.cash], [2534, null]);
    ok('#R8 원본은 그대로(불변)', p0.portfolio[1].quantity === 10885 && p0.holdingSnapshots.length === 2);
    // 같은 사진을 또 올림 → 전부 건너뜀
    const again = run(n);
    eq('#R9 같은 사진 다시 = 모두 「이미 넣은 매매」 · 바꾸지 않음', [again.applied, again.results.map(r => r.status), again.next === n], [0, ['dup', 'dup', 'dup'], true]);
    // 예수금 체크
    const c = run(p0, PHOTO, { cashOn: true });
    eq('#R10 예수금 체크: 2,534 − 427,700 − 34,800 + 374,500', [c.next.portfolio[0].depositAmount, c.cash], [2534 - 427700 - 34800 + 374500, { before: 2534, after: 2534 - 427700 - 34800 + 374500 }]);
  }
  // ── #M 옮기기 — 오늘 표에서 이미 10,900으로 고쳤으면 그 변경을 매매 날짜로 ──
  {
    const p0 = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}], ['2026-11-26', 'auto', { tq: 10900 }]], { tq: 10900 });
    const out = run(p0);
    const n = out.next;
    const inv24 = Math.round((113049394 + 427700 + 34800) * 10900 / 10950);
    eq('#M1 옮김 · 표 수량 그대로 10,900', [out.applied, out.moved, live(n).quantity], [3, [NAME], 10900]);
    eq('#M2 매매 날짜 사이: 11/20 10,945 · 11/25 10,900 · 11/26 기록 10,900', [itemAt(n, '2026-11-20').quantity, itemAt(n, '2026-11-25').quantity, itemAt(n, '2026-11-26').quantity], [10945, 10900, 10900]);
    eq('#M3 투자금액은 표·11/26 기록까지 맞춤(표에서 손대지 않았으므로)', [live(n).investAmount, itemAt(n, '2026-11-26').investAmount], [inv24, inv24]);
    ok('#M4 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(n));
    // 표 수량이 사진 순매매와 다르면 옮기지 않고 더한다
    const p1 = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}], ['2026-11-26', 'auto', { tq: 11000 }]], { tq: 11000 });
    eq('#M5 표가 사진과 안 맞으면(11,000) 더하기 → 11,015', [run(p1).moved, live(run(p1).next).quantity], [[], 11015]);
  }
  // ── #D 그날 표에서 이미 고친 날 ──
  {
    const p0 = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}], ['2026-11-17', 'auto', { tq: 10945 }]], { tq: 10945 });
    const out = run(p0);
    eq('#D1 11/17은 「그날 표에서 이미 고침」, 나머지 두 건만', [out.results.map(r => [r.date, r.status]), out.applied, live(out.next).quantity], [[['2026-11-17', 'dayedit'], ['2026-11-23', 'ok'], ['2026-11-24', 'ok']], 2, 10900]);
    ok('#D2 ⚠️ 되돌림 기록 없음', !wouldAddSnapshot(out.next));
  }
  // ── #X 넣지 않는 경우 ──
  {
    const p0 = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}]]);
    const txt = [
      '매매 | 11-20 | - | 없는종목ETF | 매수 | 3 | 1,000',
      '매매 | 11-20 | 0177R0 | x | 매도 | 99999 | 7,000',
      '매매 | 11-21 | 0177R0 | x | 매수 | 3 | -',
      '매매 | 어제 | 0177R0 | x | 매수 | 3 | 7,000',
      '매매 | 2026-12-01 | 0177R0 | x | 매수 | 3 | 7,000',
    ].join('\n');
    const out = run(p0, txt);
    const st = Object.fromEntries(out.results.map(r => [`${r.rawDate}|${r.qty}`, r.status]));
    eq('#X1 계좌에 없는 종목 · 보유보다 많이 판 기록 · 매수 체결가 없음 · 날짜 못 읽음 · 오늘 이후', [st['11-20|3'], st['11-20|99999'], st['11-21|3'], st['어제|3'], st['2026-12-01|3']], ['noitem', 'short', 'noprice', 'nodate', 'future']);
    eq('#X2 하나도 못 넣으면 계좌 그대로', [out.applied, out.next === p0], [0, true]);
    // 그날엔 없던 종목(나중에 산 종목)
    const p2 = mkAcct([['2026-10-28', 'baseline', { cash: 0 }]]);
    p2.holdingSnapshots[0].items = p2.holdingSnapshots[0].items.filter(i => i.code !== '0190G0');
    p2.holdingSnapshots.push({ date: '2026-11-20', kind: 'auto', items: U.snapshotItemsFromPortfolio(mkLive()) });
    eq('#X3 그날엔 이 계좌에 없던 종목', run(p2, '매매 | 11-10 | 0190G0 | KODEX 반도체 | 매수 | 3 | 5,000').results[0].status, 'notyet');
  }
  // ── #U 되돌리기 — 보유 기록·계좌 표 수량·원가를 돌려놓고 그사이 바뀐 시세는 그대로 ──
  {
    const p0 = mkAcct([['2026-10-28', 'baseline', { cash: 0 }], ['2026-11-06', 'auto', {}]]);
    const u = T.tradePhotoUndo(p0);
    const out = run(p0, PHOTO, { cashOn: true });
    const moved = { ...out.next, portfolio: out.next.portfolio.map(i => (i.id === 't' ? { ...i, currentPrice: 7000 } : i)) };
    const back = T.undoTradePhoto(moved, u);
    eq('#U1 보유 기록·수량·투자금액·예수금 원래대로', [back.holdingSnapshots === p0.holdingSnapshots, live(back).quantity, live(back).investAmount, back.portfolio[0].depositAmount], [true, 10885, 113049394, 2534]);
    eq('#U2 그사이 바뀐 현재가는 그대로', live(back).currentPrice, 7000);
    ok('#U3 ⚠️ 되돌린 뒤도 되돌림 기록 없음', !wouldAddSnapshot(back));
  }
}

console.log('\n── 파트② 배선 (소스 텍스트 가드) ──');
const tp = stripComments(read('src/tradePhoto.ts'));
const win = stripComments(read('src/components/TradePhotoSync.tsx'));
const hp = stripComments(read('src/components/HistoryPanel.tsx'));
const app = stripComments(read('src/App.tsx'));
const bt = stripComments(read('src/backdatedTrade.ts'));
const cw = read('src/components/CardWindow.tsx');
const pkg = JSON.parse(read('package.json'));
const importsOf = (s) => [...s.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)].map(m => m[1]);
eq('#W1 tradePhoto.ts는 import 없는 세 모듈만(.ts 확장자 — 검증이 직접 import)', importsOf(tp), ['./utils.ts', './backdatedTrade.ts', './holdingsPhoto.ts']);
ok('#W2 넣기는 자산검증과 같은 함수(planBackdatedTrade → applyBackdatedTrade, src photo)', /planBackdatedTrade\(p,/.test(tp) && /applyBackdatedTrade\(p, plan, base\)/.test(tp) && /src: 'photo'/.test(tp));
ok('#W3 그날 기록에 매매를 남긴다(trades — 두 번 넣기 막기)', /trades: \[\.\.\.prevTrades, rec\]/.test(bt) && /trades: \[rec\]/.test(bt));
ok('#W4 창이 tradePhoto 함수를 import', /import\s*\{[^}]*parseTradeText[^}]*groupTrades[^}]*runTradePhoto[^}]*tradePhotoUndo[^}]*undoTradePhoto[^}]*\}\s*from\s*'\.\.\/tradePhoto'/.test(win));
ok('#W5 /api/holdings-photo 에 kind trades로 보낸다 · 그 밖의 fetch는 PC 우편함(/api/pc-ask)뿐(화면은 AI를 직접 부르지 않는다)', /fetch\('\/api\/holdings-photo'/.test(win) && /kind: 'trades'/.test(win)
  && (win.match(/fetch\(/g) || []).length === (win.match(/fetch\('\/api\/holdings-photo'/g) || []).length + (win.match(/fetch\('\/api\/pc-ask'/g) || []).length);
ok('#W6 끝까지 받은 답만 넣는다(st.done)', /if \(st\.error \|\| !st\.done\)/.test(win) && win.indexOf('!st.done') < win.indexOf('runTradePhoto(acct'));
ok('#W7 적용은 앱 탭의 최신 계좌 위에서 다시 계산(patchAccount 안에서 runTradePhoto)', /patchAccount\(p => runTradePhoto\(p, groups,/.test(win));
ok('#W8 추이 머리줄 카메라 버튼(prop이 있을 때만)', /import \{[^}]*Camera[^}]*\} from 'lucide-react'/.test(hp) && /\{onOpenTradePhoto && \(/.test(hp) && /onClick=\{onOpenTradePhoto\}/.test(hp));
ok('#W9 App이 창을 붙이고 버튼을 넘긴다(간편·마통 계좌 제외)', /import TradePhotoSync from '\.\/components\/TradePhotoSync'/.test(app) && /<TradePhotoSync[\s\S]{0,400}patchAccount=/.test(app) && /onOpenTradePhoto=\{\['simple', 'matong'\]\.includes\(activePortfolioAccountType\) \? undefined : \(\) => setTradePhotoPid\(activePortfolioId\)\}/.test(app));
ok('#W10 카드 별도 창에는 버튼 없음(onOpenTradePhoto 미전달)', !/onOpenTradePhoto/.test(cw));
ok('#W12 관리자도 내 키 칸이 보이고 내 키를 먼저 보낸다(사이트 키가 없을 때 막히지 않게) — 관리자 접속 중만 숨김',
  /if \(!keyApi \|\| viewingAs\) \{/.test(win) && /\{viewingAs \? \(/.test(win) && /if \(keyState\.key\) headers\['X-Gemini-Key'\] = keyState\.key/.test(win));
ok('#W13 구독 AI 길 = 부탁 글 복사(tradeAskPrompt) + Gemini·Claude 열기(aiHandById) + 붙여넣기 → 같은 applyText → runTradePhoto',
  /import \{[^}]*tradeAskPrompt[^}]*\} from '\.\.\/tradePhoto'/.test(win) && /import \{ aiHandById \} from '\.\.\/aiProviders'/.test(win)
  && /applyText\(pasteText,/.test(win) && /applyText\(st\.text,/.test(win) && /const applyText = [\s\S]{0,400}runTradePhoto\(acct, groups/.test(win));
ok('#W14 키·한도 오류에서 무료 키 받는 법과 구독 AI 길을 함께 보여 준다(nokey 포함)', /\['needkey', 'nokey', 'badkey', 'credit', 'quota0', 'rate', 'rate1m'\]\.includes\(run\.code\)/.test(win) && /setShowSub\(true\)/.test(win));
ok('#W15 내 PC의 Claude로 읽기 — pcAsk 도구 import · 사진은 target claude + imgs · 한도 PC_PHOTO_N/CHARS · 답은 같은 applyText · 관리자 접속 중 숨김',
  /import \{[^}]*pcWaitText[^}]*pcPhotoAddendum[^}]*PC_PHOTO_N[^}]*PC_PHOTO_CHARS[^}]*\} from '\.\.\/pcAsk'/.test(win)
  && /op: 'ask', target: 'claude', prompt, imgs/.test(win) && /Math\.min\(photoBudget\(files\.length\), PC_PHOTO_CHARS\)/.test(win)
  && /applyText\(text, job0\.n,/.test(win) && /\{isAdmin && !viewingAs && \(\s*<div className="rounded-lg border border-emerald/.test(win));
ok('#W16 PC 읽기는 관리자만 — 칸(isAdmin) · 상태 조회도 관리자만 · 서버도 403(사진 든 질문)',
  /if \(!open \|\| viewingAs \|\| !isAdmin\) return;\s*let alive = true;\s*fetch\('\/api\/pc-ask'/.test(win)
  && /const isAdmin = email\.toLowerCase\(\) === ADMIN_EMAIL\.toLowerCase\(\);/.test(stripComments(read('api/pc-ask.ts')))
  && /c\.imgs\.length > 0 && !isAdmin\) return json\(403/.test(stripComments(read('api/pc-ask.ts'))));
ok('#W17 맨 위 = 프로그램 읽기(사진 올리기) · AI 방법(내 AI·Gemini 키·내 PC)은 「AI로 읽기·검수」 접힘 안 — 무료 AI 목록(PHOTO_AI_IDS) · 휴대폰 공유(share는 await 전)',
  /const \[showAi, setShowAi\] = useState\(false\)/.test(win) && /\{showAi && \(\s*<div[^>]*>\s*\{subSection\}/.test(win)
  && win.indexOf('onChange={readByOcr}') < win.indexOf('{showAi && (') && /PHOTO_AI_IDS\.map\(id =>/.test(win)
  && /const share = photoShareData\(navigator, sharePhotos, prompt\);\s*let sharing = null;\s*if \(share\) \{ try \{ sharing = navigator\.share\(share\.data\)/.test(win));
ok('#W11 package.json에 verify:trade-photo 등록', pkg.scripts['verify:trade-photo'] === 'node scripts/verify-trade-photo.mjs');

console.log(`\n  총 ${pass + fail}건 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
