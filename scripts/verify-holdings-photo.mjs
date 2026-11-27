#!/usr/bin/env node
// 계좌 표 「📷 사진으로 보유 맞추기」(사용자 요청 2026-11-26) — src/holdingsPhoto.ts · api/_holdingsPhoto.ts 를 **직접 import**한다(미러 금지).
//   #H = 답 해석·종목 맞추기·계획·적용·되돌리기 · #K = 키 고르기(관리자=사이트 키 / 다른 사용자=내 키만) · #E = 서버 처리부를 가짜 Gemini로 끝까지
//   #S = 배선(Drive 저장 지문·쓰기 경로·표 버튼·메모·키 파일·메모 달력 사용법 그림)
// 런타임이 .ts를 못 읽으면 단위 검사만 건너뛰고 소스 가드는 돈다.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const load = async (rel) => {
  try { return await import(pathToFileURL(join(ROOT, rel)).href); }
  catch (e) {
    const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
    if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 ${rel} 단위 검사를 건너뜁니다.`);
    else { fail++; console.log(`  ✗ ${rel} 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
    return null;
  }
};
const H = await load('src/holdingsPhoto.ts');
const P = await load('api/_holdingsPhoto.ts');
const T = await load('src/taxCalcPaste.ts');

const TODAY = '2026-11-26';
// 사용자 사진(2026-11-26 DC 계좌 잔고) 그대로 — 맨 아래 종목은 잘려 있다
const PHOTO1 = [
  '보유 | 0091P0 | TIGER 머니마켓액티브 | 9 | 935,273 | 103,919',
  '보유 | - | SOL 미국원자력SMR | 113 | 1,474,670 | 13,050',
  '보유 | 411060 | SOL 국제금 | 348 | 4,329,190 | 12,440',
  '보유 | - | TIGER 코리아원자력 | 93 | 1,380,975 | 14,849',
  '보유 | - | RISE 삼성전자SK하이 | 1,342 | 17,090,157 | 12,735',
  '보유 | - | ACE K휴머노이드로봇 | 잘림',
].join('\n');
const ITEMS = () => [
  { id: 'a1', type: 'stock', code: '0091P0', name: 'TIGER 머니마켓액티브', quantity: 5, investAmount: 500000, currentPrice: 104462, syncNote: '옛 메모' },
  { id: 'a2', type: 'stock', code: '0183J0', name: 'SOL 미국원자력SMR', quantity: 113, investAmount: 1474670 },
  { id: 'a3', type: 'stock', code: '411060', name: 'SOL 국제금', quantity: 300, investAmount: 3700000 },
  { id: 'a4', type: 'stock', code: '0100X0', name: 'TIGER 코리아원자력', quantity: 93, investAmount: 1380975 },
  { id: 'a5', type: 'stock', code: '0047A0', name: 'RISE 삼성전자SK하이닉스채권혼합50', quantity: 1000, investAmount: 12000000 },
  { id: 'a6', type: 'stock', code: '0005A0', name: 'ACE K휴머노이드로봇', quantity: 172, investAmount: 1420000 },
  { id: 'a7', type: 'stock', code: '069500', name: 'KODEX 200', quantity: 10, investAmount: 300000 },
  { id: 'a8', type: 'stock', code: '360750', name: 'TIGER 미국S&P500', quantity: 0, investAmount: 0 },
  { id: 'c1', type: 'stock', code: '', name: '현금', isManualCash: true, quantity: 1, investAmount: 50000 },
  { id: 'd1', type: 'deposit', name: '예수금', depositAmount: 10000 },
  { id: 'f1', type: 'fund', code: 'K55301', name: '어떤 펀드', investAmount: 100000, evalAmount: 120000 },
];
const kinds = (plan) => Object.fromEntries(plan.rows.filter(r => r.itemId).map(r => [r.itemId, r.kind]));

if (H) {
  const { parseHoldingsText, planHoldingsSync, applyHoldingsPlan, undoHoldingsPlan, holdCounts, syncCandidates, matchHolding, normName, zeroNote, holdErrorText, looksLikeGeminiKey, maskKey } = H;

  // #H1 사용자 사진 한 장(맨 아래 잘림) — 바뀐 것만 바꾸고, 안 보이는 종목은 0으로 하지 않는다
  const p1 = parseHoldingsText(PHOTO1);
  eq('#H1 여섯 줄 · 잘림 1 · 읽지 못한 줄 0', [p1.rows.length, p1.rows.filter(r => r.cut).length, p1.skipped.length], [6, 1, 0]);
  eq('#H1 숫자(쉼표) · 없는 코드(-)는 빈 코드', [p1.rows[4].qty, p1.rows[4].invest, p1.rows[1].code, p1.rows[0].code], [1342, 17090157, '', '0091P0']);
  const plan1 = planHoldingsSync(p1, ITEMS());
  eq('#H1 계획 — 바꿈·같음·잘림·안 보여 그대로(0으로 안 함) · 0주 행·현금·예수금·펀드는 손대지 않음', kinds(plan1),
    { a1: 'update', a2: 'same', a3: 'update', a4: 'same', a5: 'update', a6: 'cut', a7: 'keep' });
  eq('#H1 outcome = apply', plan1.outcome, 'apply');
  const r1 = applyHoldingsPlan(ITEMS(), plan1, { newId: () => 'NEW', today: TODAY });
  const by1 = Object.fromEntries(r1.next.map(it => [it.id, it]));
  eq('#H1 적용 — 잘린 이름(RISE 삼성전자SK하이)도 앞부분으로 맞춤 · 시세 칸은 그대로', [by1.a5.quantity, by1.a5.investAmount, by1.a1.quantity, by1.a1.investAmount, by1.a1.currentPrice], [1342, 17090157, 9, 935273, 104462]);
  ok('#H1 다시 보유 중인 종목의 옛 메모는 지운다', !('syncNote' in by1.a1));
  eq('#H1 안 보인 KODEX 200 · 잘린 ACE는 그대로', [by1.a7.quantity, by1.a6.quantity], [10, 172]);

  // #H2 맨 아래까지 찍은 사진을 함께 — 겹친 잘림 줄은 다 보이는 줄로 · 사진에 없는 종목 = 0 + 메모 · 새 종목 = 새 행
  const both = PHOTO1 + '\n보유 | - | ACE K휴머노이드로봇 | 172 | 1,420,000 | 8,256\n보유 | - | KODEX 미국나스닥100 | 20 | 400,000 | 20,000\n보유 | - | TIGER 코리아원자력 | 93 | 1,380,975 | 14,849';
  const p2 = parseHoldingsText(both);
  eq('#H2 겹친 종목은 한 번 · 잘림이 사라짐', [p2.rows.length, p2.rows.some(r => r.cut), p2.skipped.length], [7, false, 0]);
  const plan2 = planHoldingsSync(p2, ITEMS());
  eq('#H2 계획 — 사진에 없는 KODEX 200 = 0으로 · ACE 같음', kinds(plan2), { a1: 'update', a2: 'same', a3: 'update', a4: 'same', a5: 'update', a6: 'same', a7: 'zero' });
  eq('#H2 개수', holdCounts(plan2), { update: 3, same: 3, zero: 1, keep: 0, add: 1, cut: 0, bad: 0, pick: 0 });
  let n = 0;
  const r2 = applyHoldingsPlan(ITEMS(), plan2, { newId: () => `N${++n}`, today: TODAY });
  const by2 = Object.fromEntries(r2.next.map(it => [it.id, it]));
  eq('#H2 0으로 · 메모에 이전 수량·투자금액', [by2.a7.quantity, by2.a7.investAmount, by2.a7.syncNote], [0, 0, zeroNote(TODAY, { qty: 10, invest: 300000 })]);
  ok('#H2 메모 글 = 날짜 · 이전 10주 · 300,000원', /^11\/26 사진 맞추기 — .*이전 10주 · 300,000원/.test(by2.a7.syncNote));
  eq('#H2 새 종목 = 맨 위 새 행(코드 비움 · 메모 = 코드 찾기 대상 표시)', [r2.next[0].id, r2.next[0].type, r2.next[0].code, r2.next[0].name, r2.next[0].quantity, r2.next[0].investAmount, /사진에서 새로 추가한 종목.*종목코드를 찾는 중/.test(r2.next[0].syncNote)],
    ['N1', 'stock', '', 'KODEX 미국나스닥100', 20, 400000, true]);
  eq('#H2 예수금·펀드·현금·0주 행은 그대로', [by2.d1.depositAmount, by2.f1.investAmount, by2.c1.investAmount, by2.a8.quantity], [10000, 100000, 50000, 0]);
  // 되돌리기 — 바꾼 칸만 이전으로, 새 행은 빼고, 그 사이 들어온 시세는 그대로
  const moved = r2.next.map(it => (it.id === 'a1' ? { ...it, currentPrice: 999 } : it));
  const back = undoHoldingsPlan(moved, r2.undo);
  const byB = Object.fromEntries(back.map(it => [it.id, it]));
  eq('#H2 되돌리기 — 수량·투자금액·메모 복원 · 새 행 제거 · 시세 유지', [back.length, byB.a1.quantity, byB.a1.investAmount, byB.a1.syncNote, byB.a1.currentPrice, byB.a7.quantity, 'syncNote' in byB.a7, byB.N1 === undefined],
    [ITEMS().length, 5, 500000, '옛 메모', 999, 10, false, true]);

  // #H3 다른 계좌 사진 — 하나도 맞지 않으면 아무것도 바꾸지 않는다
  const p3 = parseHoldingsText('보유 | - | 삼성전자 | 10 | 700,000 | 70,000\n보유 | - | 카카오 | 5 | 250,000 | 50,000');
  const plan3 = planHoldingsSync(p3, ITEMS());
  eq('#H3 하나도 안 맞음 → mismatch · 적용 없음', [plan3.outcome, applyHoldingsPlan(ITEMS(), plan3, { newId: () => 'X', today: TODAY }).next.length], ['mismatch', ITEMS().length]);
  // 빈 계좌(주식 행 없음)에 새로 넣는 것은 된다
  const plan3b = planHoldingsSync(p3, [{ id: 'd1', type: 'deposit', name: '예수금' }]);
  eq('#H3 빈 계좌는 새 종목 추가', [plan3b.outcome, holdCounts(plan3b).add], ['apply', 2]);

  // #H4 '없음' · 머리말·꾸밈
  const p4 = parseHoldingsText('없음');
  eq("#H4 '없음' = none", [p4.none, planHoldingsSync(p4, ITEMS()).outcome], [true, 'none']);
  const p4b = parseHoldingsText('다음은 결과입니다\n```\n- **보유 | 069500 | KODEX 200 | 10 | 300,000 | 30,000**\n```');
  eq('#H4 꾸밈(글머리표·굵게·코드블록)을 걷고 읽음', [p4b.rows.length, p4b.rows[0] && p4b.rows[0].qty], [1, 10]);

  // #H5 겹친 사진에서 같은 종목이 다른 숫자 — 앞의 것 · 읽지 못한 줄로 알림
  const p5 = parseHoldingsText('보유 | 069500 | KODEX 200 | 10 | 300,000 | 30,000\n보유 | 069500 | KODEX 200 | 11 | 330,000 | 30,000');
  eq('#H5 다른 숫자 두 번 → 앞의 것 · 알림 1', [p5.rows.length, p5.rows[0].qty, p5.skipped.length], [1, 10, 1]);

  // #H6 숫자를 믿을 수 없는 줄 — 그 종목은 바꾸지도 0으로 하지도 않는다(빼 버리면 '사진에 없음'으로 0이 된다)
  const p6 = parseHoldingsText([
    '보유 | 0091P0 | TIGER 머니마켓액티브 | 9 | 940,158 | 103,919',   // 평가금액을 매입금액 칸에 — 수량×평균단가와 안 맞음
    '보유 | - | SOL 국제금 | 348 | 4,329,190 | 12,440',
    '보유 | - | 모르는 종목 | 3.5 | 1,000 | -',
  ].join('\n'));
  eq('#H6 믿을 수 없는 줄 = unread(잘림 아님) · 알림 2', [p6.rows.map(r => !!r.unread), p6.rows.some(r => r.cut), p6.skipped.length], [[true, false, true], false, 2]);
  const plan6 = planHoldingsSync(p6, ITEMS());
  const k6 = kinds(plan6);
  eq('#H6 읽지 못한 a1 = 그대로(cut) · 나머지 안 보인 종목은 0으로(잘림이 없으니)', [k6.a1, k6.a3, k6.a2, k6.a7], ['cut', 'update', 'zero', 'zero']);
  eq('#H6 이 계좌에 없는 종목의 못 읽은 줄 = bad(넣지 않음)', plan6.rows.filter(r => r.kind === 'bad').map(r => r.name), ['모르는 종목']);

  // #H7 맞추기 규칙
  const items7 = [
    { id: 'x1', type: 'stock', code: '111111', name: 'TIGER 미국배당다우존스', quantity: 1, investAmount: 1 },
    { id: 'x2', type: 'stock', code: '222222', name: 'TIGER 미국배당다우존스타겟커버드콜', quantity: 1, investAmount: 1 },
    { id: 'x3', type: 'stock', code: '333333', name: 'KODEX 200', quantity: 1, investAmount: 1 },
  ];
  const row = (name, code = '') => ({ code, name, qty: 1, invest: 1, avg: 0, cut: false, unread: '', line: '' });
  eq('#H7 이름이 같으면 같은 종목(띄어쓰기 무시)', matchHolding(row('TIGER미국배당다우존스'), items7, new Set())?.id, 'x1');
  eq('#H7 잘린 앞부분이 두 종목에 걸리면 맞추지 않음', matchHolding(row('TIGER 미국배당다우'), items7, new Set()), null);
  eq('#H7 잘린 앞부분이 한 종목뿐이면 맞춤', matchHolding(row('TIGER 미국배당다우존스타겟'), items7, new Set())?.id, 'x2');
  eq('#H7 AI가 준 코드가 이 계좌에 있으면 코드로', matchHolding(row('전혀 다른 이름', '333333'), items7, new Set())?.id, 'x3');
  eq('#H7 이미 맞춘 행은 다시 쓰지 않음', matchHolding(row('KODEX 200'), items7, new Set(['x3'])), null);
  eq('#H7 3글자 앞부분은 맞추지 않음', matchHolding(row('KOD'), items7, new Set()), null);
  eq('#H7 normName', normName(' Tiger 미국·배당(다우) '), 'TIGER미국배당다우');

  // #H8 서버에 보내는 종목 목록 — 주식 행만 · 겹침 없음
  eq('#H8 목록 = 주식 행(현금·예수금·펀드 제외)', syncCandidates(ITEMS()).map(c => c.code), ['0091P0', '0183J0', '411060', '0100X0', '0047A0', '0005A0', '069500', '360750']);

  // #H9 화면 글
  ok('#H9 오류 글(needkey·badkey·credit·nokey·rate·block·cut·auth·net·decode·big·gemini)', ['needkey', 'badkey', 'credit', 'nokey', 'rate', 'block', 'cut', 'auth', 'net', 'decode', 'big', 'gemini'].every(c => holdErrorText(c).length > 10)
    && holdErrorText('needkey') !== holdErrorText('gemini') && /메모 달력 → AI 연동/.test(holdErrorText('needkey')));
  eq('#H9 키 모양·가리기', [looksLikeGeminiKey('AIzaSyA1234567890abcdefghijklmnopqrstuv'), looksLikeGeminiKey('짧음'), looksLikeGeminiKey('AIza 1234'), maskKey('AIzaSyA1234567890abcdefghijklmnopqrstuv')], [true, false, false, 'AIza…stuv']);
}

if (H && P) {
  // #G 서버 부탁 문장의 예시 줄 = 해석기 형식
  const sp = P.buildHoldPrompt({ account: 'DC', cands: [{ code: '0091P0', name: 'TIGER 머니마켓액티브' }, { code: '', name: '이름만' }] });
  const ex = sp.split('\n').slice(sp.split('\n').indexOf('예)') + 1).join('\n');
  const pe = H.parseHoldingsText(ex);
  eq('#G1 예시 네 줄 = 해석기 형식(셋째는 펀드 줄 · 마지막은 잘림)', [pe.rows.length, pe.rows.map(r => r.cut), pe.rows.map(r => !!r.fund), pe.skipped.length, pe.rows[0].invest, pe.rows[2].invest, pe.rows[2].eval], [4, [false, false, false, true], [false, false, true, false], 0, 935273, 6000000, 5400000]);
  ok('#G1b 부탁 문장 — 카드형 화면(보유수량/매입단가) · 펀드 줄(보유수량 -, 7번째 칸 평가금액)', sp.includes("'보유수량/매입단가'의 앞 숫자(주)가 보유수량") && sp.includes("'보유 | - | 상품명 | - | 매입금액 | - | 평가금액'"));
  ok('#G1 부탁 문장 — 목록 코드·이름 · 보유수량≠주문가능 · 매입금액≠평가금액 · 잘림 · 겹침 · 없음',
    sp.includes('0091P0 TIGER 머니마켓액티브') && sp.includes('- 이름만') && sp.includes("'주문가능' 수량이 아닙니다") && sp.includes("'평가금액'이 아닙니다")
    && sp.includes("'보유 | 코드 | 종목명 | 잘림'") && sp.includes('한 번만') && sp.includes("'없음'"));
  // #G2 요청 검사
  const img = { mime: 'image/jpeg', data: 'A'.repeat(200) };
  const good = P.checkHoldReq({ account: 'DC\n계좌', cands: [{ code: '0091p0', name: 'A|B' }, { code: '!!', name: 'x' }, { code: '', name: '' }], images: [img] });
  eq('#G2 통과(코드 대문자·이름의 | 제거·틀린 코드·빈 항목 뺌)', [good.account, good.cands], ['DC 계좌', [{ code: '0091P0', name: 'A B' }]]);
  eq('#G2 거절 — 사진 없음·11장·형식·깨진 자료', [
    P.checkHoldReq({ images: [] }).error, P.checkHoldReq({ images: Array(11).fill(img) }).error,
    P.checkHoldReq({ images: [{ mime: 'image/gif', data: img.data }] }).error, P.checkHoldReq({ images: [{ mime: 'image/jpeg', data: '!!' }] }).error,
  ], ['사진이 없습니다', '사진은 한 번에 10장까지입니다', '사진 형식이 틀렸습니다', '사진 자료가 깨졌습니다']);
  const gb = JSON.parse(P.holdGeminiBody(good));
  ok('#G2 Gemini 본문 = 사진 + 부탁 문장 · temperature 0', gb.contents[0].parts[0].inline_data.mime_type === 'image/jpeg' && gb.contents[0].parts[1].text === P.buildHoldPrompt(good) && gb.generationConfig.temperature === 0);
  // #K 키 고르기
  const UK = 'AIzaSyUSERKEY_1234567890abcdefghijklmn';
  eq('#K1 내 키 모양 검사(헤더)', [P.userGeminiKey(` ${UK} `), P.userGeminiKey('bad key'), P.userGeminiKey(null)], [UK, '', '']);
  eq('#K2 관리자 = 내 키 → 사이트 키 · 다른 사용자 = 내 키만(사이트 키 안 씀)', [
    P.pickHoldKeys(true, UK, ['s1', 's2']), P.pickHoldKeys(true, '', ['s1']), P.pickHoldKeys(false, UK, ['s1']), P.pickHoldKeys(false, '', ['s1', 's2']),
  ], [[UK, 's1', 's2'], ['s1'], [UK], []]);
}

// #C 새로 넣은 종목의 종목코드를 이름으로 찾기(사용자 신고 2026-11-26: 새 계좌를 사진으로 맞췄더니 현재가 0·수익률 -100%)
if (H) {
  const { nameFits, cleanPhotoName, jsonFromBytes, codeCandsFrom, pickCodeCands, findCodeByName, photoCodeTodo, fillPhotoCode, markPhotoCodeMiss, PHOTO_ADD_MARK, parseHoldingsText, planHoldingsSync, applyHoldingsPlan } = H;
  eq('#C1 이름 맞춤 — 같음 · 사진이 잘림(앞 4자 이상) · …뗌 · 짧은 앞부분·공식이 더 짧음은 아님', [
    nameFits('KODEX 200', 'KODEX 200'), nameFits('RISE 삼성전자SK하이', 'RISE 삼성전자SK하이닉스채권혼합50'), nameFits('RISE 삼성전자SK…', 'RISE 삼성전자SK하이닉스채권혼합50'),
    nameFits('KOD', 'KODEX 200'), nameFits('KODEX 200선물인버스2X', 'KODEX 200'), cleanPhotoName('TIGER 미국S&P5... '),
  ], [true, true, true, false, false, 'TIGER 미국S&P5']);
  const ascii = (s) => [...s].map(ch => ch.charCodeAt(0));
  const euc = new Uint8Array([...ascii('{"itemname":"'), 0xB0, 0xA1, ...ascii('"}')]);
  eq('#C2 바이트 → JSON(UTF-8 · EUC-KR · 감싼 글 · 못 읽음 null)', [
    jsonFromBytes(new TextEncoder().encode('{"a":"가"}')), jsonFromBytes(euc), jsonFromBytes(new TextEncoder().encode('cb({"a":1});')), jsonFromBytes(new TextEncoder().encode('<html>')),
  ], [{ a: '가' }, { itemname: '가' }, { a: 1 }, null]);
  const AC = { query: 'KODEX', items: [
    { code: '069500', name: '<b>KODEX</b> 200', typeCode: 'KOSPI', nationCode: 'KOR' },
    { code: 'AAPL', name: '애플', nationCode: 'USA' },
    { code: '252670', name: 'KODEX 200선물인버스2X', nationCode: 'KOR' },
    { reutersCode: '005930', name: '삼성전자', nationCode: 'USA' },
  ] };
  const OLD = { items: [[[['KODEX 200'], ['069500'], ['코스피']], [['KODEX 레버리지'], ['122630'], ['코스피']]]] };
  const ETF = { resultCode: 'success', result: { etfItemList: [{ itemcode: '069500', itemname: 'KODEX 200' }, { itemcode: '0047A0', itemname: 'RISE 삼성전자SK하이닉스채권혼합50' }, { itemcode: '0091P0', itemname: 'TIGER 머니마켓액티브' }] } };
  eq('#C3 검색 답 읽기 — 지금 모양(국내만·태그 뗌) · 옛 자동완성 줄 · ETF 전체 목록(맞는 이름만)', [
    codeCandsFrom(AC), codeCandsFrom(OLD), codeCandsFrom(ETF, 'RISE 삼성전자SK하이'), codeCandsFrom('없음'), codeCandsFrom(null),
  ], [
    [{ code: '069500', name: 'KODEX 200' }, { code: '252670', name: 'KODEX 200선물인버스2X' }],
    [{ code: '069500', name: 'KODEX 200' }, { code: '122630', name: 'KODEX 레버리지' }],
    [{ code: '0047A0', name: 'RISE 삼성전자SK하이닉스채권혼합50' }], [], [],
  ]);
  const C = [{ code: '069500', name: 'KODEX 200' }, { code: '252670', name: 'KODEX 200선물인버스2X' }, { code: '102110', name: 'TIGER 200' }];
  eq('#C4 후보 고르기 — 같은 이름 먼저 · 잘린 이름은 하나뿐일 때만 · 여럿이면 고르지 않음', [
    pickCodeCands('KODEX 200', C), pickCodeCands('KODEX 200선물', C), pickCodeCands('KODEX', C), pickCodeCands('ACE 반도체', C),
  ], [
    { list: [C[0]], exact: true, why: '' }, { list: [C[1]], exact: false, why: '' }, { list: [], exact: false, why: 'many' }, { list: [], exact: false, why: 'none' },
  ]);

  const BOOK = { '069500': { name: 'KODEX 200', price: 41230, changeRate: -1.2 }, '0047A0': { name: 'RISE 삼성전자SK하이닉스채권혼합50', price: 12880, changeRate: 0.4 }, '999990': { name: '엉뚱한종목', price: 1000, changeRate: 0 }, '0000Z0': { name: 'KODEX 반도체', price: 0, changeRate: 0 } };
  const deps = (cands, { reached = true, down = false } = {}) => {
    const calls = { search: 0, info: [] };
    return { calls, search: async () => { calls.search++; return { reached, cands }; }, info: async (code) => { calls.info.push(code); return down ? null : (BOOK[code] || null); } };
  };
  const d1 = deps([{ code: '069500', name: 'KODEX 200' }]);
  const r1 = await findCodeByName('KODEX 200', d1);
  eq('#C5 이름이 같은 종목 → 시세 조회의 공식 이름으로 확인하고 코드·현재가', [r1, d1.calls.info], [{ found: { code: '069500', name: 'KODEX 200', price: 41230, changeRate: -1.2, from: 'search' }, why: '' }, ['069500']]);
  const r2 = await findCodeByName('RISE 삼성전자SK하이', deps([{ code: '0047A0', name: 'RISE 삼성전자SK하이닉스채권혼합50' }]));
  eq('#C6 잘린 이름 · 후보 하나 → 공식 이름(전체)으로 채움', r2.found && [r2.found.code, r2.found.name], ['0047A0', 'RISE 삼성전자SK하이닉스채권혼합50']);
  const r3 = await findCodeByName('KODEX 200', deps([{ code: '999990', name: 'KODEX 200' }]));
  eq('#C7 검색이 준 코드의 공식 이름이 다르면(틀린 코드) 넣지 않는다', r3, { found: null, why: 'none' });
  eq('#C8 연결 실패 — 검색이 닿지 않음 = net(메모를 고치지 않고 다음에 다시) · 시세만 닿지 않음 + 이름이 똑같은 후보 하나 = 코드만 넣음(현재가 0 → 다음 갱신)', [
    await findCodeByName('KODEX 200', deps([], { reached: false })), await findCodeByName('KODEX 200', deps([{ code: '069500', name: 'KODEX 200' }], { down: true })),
    await findCodeByName('RISE 삼성전자SK하이', deps([{ code: '0047A0', name: 'RISE 삼성전자SK하이닉스채권혼합50' }], { down: true })),
    await findCodeByName('KODEX 200', { search: async () => { throw new Error('x'); }, info: async () => null }),
  ], [{ found: null, why: 'net' }, { found: { code: '069500', name: 'KODEX 200', price: 0, changeRate: 0, from: 'search' }, why: '' }, { found: null, why: 'net' }, { found: null, why: 'net' }]);
  eq('#C9 못 찾음 — 후보 없음 · 여럿 · 현재가 0 은 넣지 않음', [
    await findCodeByName('ACE 반도체', deps([])), await findCodeByName('KODEX', deps(C)), await findCodeByName('KODEX 반도체', deps([{ code: '0000Z0', name: 'KODEX 반도체' }])),
  ], [{ found: null, why: 'none' }, { found: null, why: 'many' }, { found: null, why: 'none' }]);

  // 사용자 상황 그대로 — 새 계좌(빈 계좌)를 사진으로 맞춤 → 새 행은 코드가 비어 있다 → 찾을 목록에 든다
  const plan = planHoldingsSync(parseHoldingsText(PHOTO1), []);
  let n = 0;
  const added = applyHoldingsPlan([], plan, { newId: () => `n${++n}`, today: TODAY }).next;
  const accts = [
    { id: 'p1', accountType: 'portfolio', portfolio: added },
    { id: 'p2', accountType: 'overseas', portfolio: [{ id: 'o1', type: 'stock', code: '', name: 'Apple', syncNote: `11/26 사진 맞추기 — ${PHOTO_ADD_MARK}입니다` }] },
    { id: 'p3', accountType: 'portfolio', deletedAt: '2026-11-01', portfolio: [{ id: 'z1', type: 'stock', code: '', name: 'KODEX 200', syncNote: PHOTO_ADD_MARK }] },
    { id: 'p4', portfolio: [{ id: 'm1', type: 'stock', code: '', name: 'KODEX 200', syncNote: '' }, { id: 'm2', type: 'stock', code: '069500', name: 'KODEX 200', syncNote: PHOTO_ADD_MARK }] },
  ];
  eq('#C10 찾을 행 — 사진으로 새로 넣고 코드가 빈 주식 행만(해외·삭제 계좌·메모 없음·코드 있음 제외)', photoCodeTodo(accts).map(t => `${t.pid}:${t.name}`),
    added.filter(it => it.type === 'stock' && !it.code).map(it => `p1:${it.name}`));
  ok('#C10b 사용자 사진(빈 계좌) — 새로 넣은 행이 모두 코드 빈칸 · 찾을 목록 5개', photoCodeTodo(accts).length === 5 && added.every(it => it.code === ''));
  const f = { code: '0047A0', name: 'RISE 삼성전자SK하이닉스채권혼합50', price: 12880, changeRate: 0.4 };
  const target = added.find(it => it.name.startsWith('RISE'));
  const filled = fillPhotoCode(added, target.id, f, TODAY).find(it => it.id === target.id);
  ok('#C11 채우기 — 코드·공식 이름·현재가·등락률 · 메모에 찾은 코드 · 수량·투자금액은 그대로', filled.code === '0047A0' && filled.name === f.name && filled.currentPrice === 12880 && filled.changeRate === 0.4
    && filled.syncNote.includes('0047A0') && filled.quantity === target.quantity && filled.investAmount === target.investAmount && photoCodeTodo([{ id: 'p1', portfolio: [filled] }]).length === 0);
  const typed = fillPhotoCode([{ ...target, code: '123456' }], target.id, f, TODAY)[0];
  ok('#C12 그사이 사용자가 코드를 넣은 행은 건드리지 않는다', typed.code === '123456' && typed.name === target.name);
  const missed = markPhotoCodeMiss(added, target.id, 'many', TODAY).find(it => it.id === target.id);
  ok('#C13 못 찾음 메모 — 까닭 · 코드 넣어 달라 · 표시 그대로(다음 실행에 다시 찾음)', missed.syncNote.includes('여럿') && missed.syncNote.includes('종목코드를 넣어') && missed.syncNote.includes(PHOTO_ADD_MARK) && missed.code === '');

  // #C14~ 사용자 요청(2026-11-26 둘째): 다른 계좌에 이름이 같은 종목이 있으면 그 코드 → 없으면 검색 → 못 찾으면 칸을 눈에 띄게(사용자가 넣는다)
  const { knownCodeFor, photoCodeState, codeTypedNote } = H;
  const book = [
    { id: 'x1', accountType: 'portfolio', portfolio: [{ id: 'k1', type: 'stock', code: '0047a0', name: 'RISE 삼성전자SK하이닉스채권혼합50' }, { id: 'k2', type: 'stock', code: '069500', name: 'KODEX 200' }, { id: 'k3', type: 'stock', code: '', name: 'SOL 국제금' }] },
    { id: 'x2', accountType: 'isa', portfolio: [{ id: 'k4', type: 'stock', code: '411060', name: 'SOL 국제금' }, { id: 'k5', type: 'stock', code: '102110', name: 'TIGER 200' }, { id: 'k6', type: 'stock', code: '139260', name: 'TIGER 200 IT' }] },
    { id: 'x3', accountType: 'overseas', portfolio: [{ id: 'k7', type: 'stock', code: '360750', name: 'TIGER 미국S&P500' }] },
    { id: 'x4', accountType: 'portfolio', portfolio: [{ id: 'k8', type: 'stock', code: '0005A0', name: 'ACE K휴머노이드로봇' }, { id: 'k9', type: 'stock', code: '0006B0', name: 'ACE K휴머노이드로봇' }] },
  ];
  eq('#C14 다른 계좌의 같은 이름 — 똑같은 이름 · 잘린 이름(하나뿐) · 코드 없는 행은 건너뜀 · 해외 계좌 안 봄 · 같은 이름 코드가 둘이면 안 씀 · 비슷하기만 하면 안 씀', [
    knownCodeFor('KODEX 200', book), knownCodeFor('RISE 삼성전자SK하이', book), knownCodeFor('SOL 국제금', book), knownCodeFor('TIGER 미국S&P500', book),
    knownCodeFor('ACE K휴머노이드로봇', book), knownCodeFor('TIGER 200', book), knownCodeFor('TIGER', book), knownCodeFor('KOD', book),
  ], [
    { code: '069500', name: 'KODEX 200' }, { code: '0047A0', name: 'RISE 삼성전자SK하이닉스채권혼합50' }, { code: '411060', name: 'SOL 국제금' }, null,
    null, { code: '102110', name: 'TIGER 200' }, null, null,
  ]);
  const fa = fillPhotoCode([{ id: 'q', type: 'stock', code: '', name: 'SOL 국제금', currentPrice: 0, changeRate: 0, syncNote: PHOTO_ADD_MARK }], 'q', { code: '411060', name: 'SOL 국제금', price: 0, changeRate: 0, from: 'acct' }, TODAY)[0];
  ok('#C15 다른 계좌에서 가져온 코드 — 코드만 넣고(현재가는 단일 갱신이 부름) 메모에 「다른 계좌」', fa.code === '411060' && fa.currentPrice === 0 && fa.syncNote.includes('다른 계좌') && !('changeRate' in fa && fa.changeRate !== 0));
  const wait = added[0], miss2 = markPhotoCodeMiss(added, added[0].id, 'none', TODAY)[0];
  eq('#C16 표의 코드 칸 — 찾는 중 · 찾지 못함(눈에 띄게) · 코드가 들어오면 · 사진으로 넣은 행이 아니면 해당 없음', [
    photoCodeState(wait), photoCodeState(miss2), photoCodeState({ ...miss2, code: '069500' }), photoCodeState({ type: 'stock', code: '', name: 'A', syncNote: '' }), photoCodeState({ ...miss2, type: 'fund' }),
  ], ['wait', 'miss', '', '', '']);
  const typedNote = codeTypedNote(TODAY);
  ok('#C17 직접 넣은 코드의 메모 — 표시는 남되(코드가 있어 다시 찾지 않음) 「직접 넣었습니다」', typedNote.includes(PHOTO_ADD_MARK) && typedNote.includes('직접 넣었') && photoCodeTodo([{ id: 'p', portfolio: [{ id: 'r', type: 'stock', code: '069500', name: 'KODEX 200', syncNote: typedNote }] }]).length === 0);
}

// #F·#M·#P 사용자 요청(2026-11-27): 퇴직계좌 「연금계좌현황」 사진 → 표에 이미 있는 종목을 이름으로 찾아 수량·매입금액 · 펀드(디폴트옵션)는 매입·평가금액
//   · 못 찾으면 사용자가 고른다(이 계좌의 다른 이름 종목 · 이름이 비슷한 종목코드 추천 · 직접 입력)
if (H) {
  const { parseHoldingsText, planHoldingsSync, applyHoldingsPlan, undoHoldingsPlan, holdCounts, matchHoldingHow, namesToResolve, photoKey, planUsedIds, pickTargets,
    applyHoldingPick, mergeHoldUndo, nameScore, rankCodeSuggestions, mergeCodeSuggestions, acctCodeCands, suggestQueries, photoCodeTodo, codeCandsFrom } = H;
  // 사용자 사진(미래에셋 연금계좌현황 카드 3장)을 프로그램이 읽은 줄 그대로(scripts/verify-trade-ocr.mjs FX5 → ocrHoldLine)
  const CARDS = [
    '보유 | 0047A0 | RISE 삼성전자SK하이닉스채권혼합50 | 1342 | 17090157 | 12734',
    '보유 | - | ACEK휴머노이드로봇산업TOP2+ | 172 | 1486555 | 8642',
    '보유 | - | RISE 현대차고정피지컬AI | 잘림',
    '보유 | - | KODEX 200TR | 227 | 8588873 | 37836',
    '보유 | - | TIGER 미국S&P500 | 419 | 10074759 | 24044',
    '보유 | - | KODEX 신재생에너지액티브 | 잘림',
    '보유 | - | 미래에셋증권 디폴트옵션 적극투자형 BF1 | - | 6067250 | - | 5346116',
  ].join('\n');
  const RET = () => [
    { id: 'r1', type: 'stock', code: '0047A0', name: 'RISE 삼성전자SK하이닉스채권혼합50', quantity: 1000, investAmount: 12000000 },
    { id: 'r2', type: 'stock', code: '0005A0', name: 'ACE K휴머노이드로봇', quantity: 150, investAmount: 1300000 },
    { id: 'r3', type: 'stock', code: '278530', name: '코덱스200TR', quantity: 200, investAmount: 7000000 },
    { id: 'r4', type: 'stock', code: '0153K0', name: 'RISE 현대차고정피지컬AI', quantity: 50, investAmount: 600000 },
    { id: 'r5', type: 'stock', code: '', name: '미국S&P500 타이거', quantity: 400, investAmount: 9000000 },
    { id: 'r6', type: 'stock', code: '069500', name: 'KODEX 200', quantity: 10, investAmount: 300000 },
    { id: 'f1', type: 'fund', code: '', name: '디폴트옵션 적극투자형 BF1', investAmount: 5000000, evalAmount: 4800000 },
    { id: 'd1', type: 'deposit', name: '예수금', depositAmount: 10000 },
  ];
  const pc = parseHoldingsText(CARDS);
  eq('#F1 펀드 줄 = 보유수량 - · 7번째 칸 평가금액 → fund · 잘림 줄은 그대로 잘림', [pc.rows.length, pc.rows.map(r => !!r.fund), pc.rows[6].invest, pc.rows[6].eval, pc.rows.filter(r => r.cut).length, pc.skipped.length],
    [7, [false, false, false, false, false, false, true], 6067250, 5346116, 2, 0]);
  eq('#F1b 평가금액이 없는 「-」 줄은 펀드가 아니라 잘림(예전 그대로)', parseHoldingsText('보유 | - | 어떤 펀드 | - | 6,067,250 | -').rows.map(r => [r.cut, !!r.fund]), [[true, false]]);

  // 이름으로 확인한 코드(화면이 미리 찾는다) — KODEX 200TR = 278530 · TIGER 미국S&P500은 못 찾음
  const RES = { [photoKey('KODEX 200TR')]: { code: '278530', name: 'KODEX 200TR', price: 27800, changeRate: 0.1, from: 'search' } };
  const pre = planHoldingsSync(pc, RET(), { keepUnseen: true, pick: true });
  const preK = Object.fromEntries(pre.rows.filter(r => r.itemId).map(r => [r.itemId, `${r.kind}:${r.match || ''}`]));
  eq('#M1 확인 전 — 코드·이름·잘린 이름으로 잇기 · 「KODEX 200TR」은 앞부분이 같은 「KODEX 200」에 잠정으로(loose) · 펀드는 펀드 행에(증권사 이름이 앞에 붙어도)',
    [preK.r1, preK.r2, preK.r4, preK.r6, preK.f1], ['update:code', 'update:loose', 'cut:name', 'update:loose', 'update:loose']);
  eq('#M2 확인할 이름 — 잘린·짧은 이름으로 이은 것 + 못 찾은 것(펀드·정확히 맞은 것 빼고)', namesToResolve(pre), ['ACEK휴머노이드로봇산업TOP2+', 'KODEX 200TR', 'TIGER 미국S&P500']);
  const plan = planHoldingsSync(pc, RET(), { keepUnseen: true, pick: true, resolved: RES });
  const K = Object.fromEntries(plan.rows.filter(r => r.itemId).map(r => [r.itemId, `${r.kind}:${r.match || ''}`]));
  eq('#M3 확인 뒤 — 「KODEX 200TR」(278530)은 이름이 다른 표의 「코덱스200TR」(278530)에 · 「KODEX 200」(069500)은 잇지 않음(그대로)',
    [K.r3, K.r6, K.r1, K.r2, K.f1], ['update:resolved', 'keep:', 'update:code', 'update:loose', 'update:loose']);
  const pk = plan.rows.filter(r => r.kind === 'pick');
  eq('#P1 못 찾은 종목 = 골라 주세요(넣지 않고 기다림) · 잘린 새 종목 = 넣지 않음 · 개수', [pk.map(r => [r.photo, r.after.qty, r.after.invest]), plan.rows.filter(r => r.kind === 'bad').map(r => r.name), holdCounts(plan).pick, plan.outcome],
    [[['TIGER 미국S&P500', 419, 10074759]], ['KODEX 신재생에너지액티브'], 1, 'apply']);
  let n = 0;
  const ap = applyHoldingsPlan(RET(), plan, { newId: () => `N${++n}`, today: TODAY });
  const by = Object.fromEntries(ap.next.map(it => [it.id, it]));
  eq('#P2 적용 — 수량·매입금액 · 펀드는 매입·평가금액(수량 칸 없음) · 고르기 종목은 아직 안 넣음 · 이름이 다른 행도 이름은 그대로',
    [[by.r1.quantity, by.r1.investAmount], [by.r2.quantity, by.r2.investAmount], [by.r3.quantity, by.r3.investAmount, by.r3.name], [by.f1.investAmount, by.f1.evalAmount, 'quantity' in by.f1], by.r5.quantity, by.r6.quantity, ap.next.length],
    [[1342, 17090157], [172, 1486555], [227, 8588873, '코덱스200TR'], [6067250, 5346116, false], 400, 10, RET().length]);
  const usedIds = planUsedIds(plan);
  const tg = pickTargets(pk[0], ap.next, usedIds);
  eq('#P3 이 계좌에서 고를 행 — 같은 종류(주식)·아직 안 이은 행(잘려 보인 r4도 사진에 있음) · 이름이 비슷한 순(「미국S&P500 타이거」가 맨 위)', [tg[0].id, tg.map(t => t.id).sort(), tg.some(t => t.id === 'f1' || t.id === 'r1' || t.id === 'r4')], ['r5', ['r5', 'r6'], false]);
  // 고르기 — 이 계좌 행에 · 추천 코드로 새 행 · 이 계좌에 그 코드가 있으면 그 행에 · 직접 입력 · 코드 없이 · 잘못된 코드
  const toItem = applyHoldingPick(ap.next, pk[0], { to: 'item', itemId: 'r5' }, { newId: () => 'X', today: TODAY });
  const r5 = toItem.next.find(it => it.id === 'r5');
  eq('#P4 이 계좌 행에 넣기 — 수량·매입금액 · 시세 부를 코드 없음 · 되돌리기 정보', [r5.quantity, r5.investAmount, toItem.id, toItem.code, Object.keys(toItem.undo.restore), toItem.next.length], [419, 10074759, 'r5', '', ['r5'], ap.next.length]);
  const toCode = applyHoldingPick(ap.next, pk[0], { to: 'code', code: '360750', name: 'TIGER 미국S&P500', how: 'pick' }, { newId: () => 'X1', today: TODAY });
  const x1 = toCode.next[0];
  eq('#P5 추천 코드로 새 행 — 맨 위 · 코드·이름·수량·매입금액 · 메모 「추천에서 골랐습니다」 · 시세 부를 코드', [x1.id, x1.code, x1.name, x1.quantity, x1.investAmount, /추천에서 골랐습니다/.test(x1.syncNote), toCode.id, toCode.code, photoCodeTodo([{ id: 'p', portfolio: toCode.next }]).length],
    ['X1', '360750', 'TIGER 미국S&P500', 419, 10074759, true, 'X1', '360750', 0]);
  const toDup = applyHoldingPick(ap.next, pk[0], { to: 'code', code: '069500', how: 'typed' }, { newId: () => 'X2', today: TODAY });
  eq('#P6 고른 코드가 이 계좌에 이미 있으면 새 행 대신 그 행에', [toDup.id, toDup.next.length, toDup.next.find(it => it.id === 'r6').quantity], ['r6', ap.next.length, 419]);
  const toTyped = applyHoldingPick(ap.next, pk[0], { to: 'code', code: '0091p0', how: 'typed' }, { newId: () => 'X3', today: TODAY });
  const toNew = applyHoldingPick(ap.next, pk[0], { to: 'new' }, { newId: () => 'X4', today: TODAY });
  const bad = applyHoldingPick(ap.next, pk[0], { to: 'code', code: '12345' }, { newId: () => 'X5', today: TODAY });
  eq('#P7 직접 입력(대문자로) · 코드 없이 추가(다시 이름으로 찾을 대상) · 잘못된 코드는 아무것도 안 함', [toTyped.next[0].code, /직접 넣었습니다/.test(toTyped.next[0].syncNote), toNew.next[0].code, photoCodeTodo([{ id: 'p', portfolio: toNew.next }]).length, bad.id, bad.next === ap.next],
    ['0091P0', true, '', 1, '', true]);
  const all = mergeHoldUndo(ap.undo, toCode.undo);
  const back = undoHoldingsPlan(toCode.next, all);
  eq('#P8 되돌리기 합치기 — 맞추기 + 고르기를 한 번에 처음으로(새 행 빼고 · 펀드 평가금액도)', back.map(it => [it.id, it.quantity, it.investAmount, it.evalAmount]), RET().map(it => [it.id, it.quantity, it.investAmount, it.evalAmount]));
  // 펀드 고르기 — 펀드 행이 없으면 새 펀드 행
  const fundOnly = parseHoldingsText('보유 | - | 미래에셋증권 디폴트옵션 적극투자형 BF1 | - | 6067250 | - | 5346116');
  const fp = planHoldingsSync(fundOnly, RET().filter(it => it.type !== 'fund'), { pick: true });
  eq('#P9 펀드만 찍은 사진 — 주식 행은 건드리지 않음(0으로·그대로 줄도 없음) · 펀드 행이 없으면 골라 주세요', [fp.rows.map(r => r.kind), fp.outcome], [['pick'], 'same']);
  const fNew = applyHoldingPick([], fp.rows[0], { to: 'new' }, { newId: () => 'F9', today: TODAY }).next[0];
  eq('#P9b 새 펀드 행 — 펀드 추가 행 모양 + 매입·평가금액', [fNew.type, fNew.category, fNew.code, fNew.investAmount, fNew.evalAmount], ['fund', 'FUND', '', 6067250, 5346116]);
  const fp2 = planHoldingsSync(fundOnly, RET());
  eq('#P9c 고르기 모드가 아니어도 펀드만 찍은 사진은 주식 행을 0으로 하지 않는다', [fp2.rows.map(r => `${r.itemId}:${r.kind}`), fp2.outcome], [['f1:update'], 'apply']);
  // AI(잘림 없음) 사진에서 고르기가 남으면, 안 보인 주식 행을 0으로 하지 않는다(그 종목일 수 있다)
  const ai = parseHoldingsText('보유 | 0047A0 | RISE 삼성전자SK하이닉스채권혼합50 | 1342 | 17090157 | 12734\n보유 | - | 처음 보는 종목 | 10 | 100,000 | 10,000');
  const aiPlan = planHoldingsSync(ai, RET(), { pick: true });
  eq('#P10 고르기가 남으면 안 보인 종목은 0 대신 그대로', [aiPlan.rows.filter(r => r.kind === 'zero').length, aiPlan.rows.filter(r => r.kind === 'keep').length > 0, String((aiPlan.rows.find(r => r.kind === 'keep') || {}).note || '').includes('골라 주세요')], [0, true, true]);
  const aiPlan2 = planHoldingsSync(ai, RET());
  eq('#P10b 예전 방식(고르기 아님) — 새 종목은 코드 빈 새 행 · 안 보인 종목은 0으로(그대로)', [holdCounts(aiPlan2).add, holdCounts(aiPlan2).zero > 0], [1, true]);
  // 다른 계좌 사진 + 고르기 모드 — 아무것도 넣지 않고 새 종목(코드 확인된 것 포함)은 골라 주세요로
  const other = parseHoldingsText('보유 | - | 삼성전자 | 10 | 700,000 | 70,000\n보유 | - | 카카오 | 5 | 250,000 | 50,000');
  const op = planHoldingsSync(other, RET(), { pick: true, resolved: { [photoKey('삼성전자')]: { code: '005930', name: '삼성전자', price: 70000, changeRate: 0, from: 'search' } } });
  eq('#P11 다른 계좌 사진 — mismatch · 모두 골라 주세요(코드 확인된 것은 첫 추천) · 적용 없음', [op.outcome, op.rows.filter(r => r.kind === 'pick').map(r => [r.photo, r.found ? r.found.code : '']), applyHoldingsPlan(RET(), op, { newId: () => 'Z', today: TODAY }).next.length],
    ['mismatch', [['삼성전자', '005930'], ['카카오', '']], RET().length]);
  // 확인된 새 종목 — 그 코드로 바로 새 행(공식 이름·현재가·메모)
  const np = planHoldingsSync(parseHoldingsText('보유 | - | KODEX 200TR | 227 | 8588873 | 37836'), [], { pick: true, resolved: RES });
  const nr = applyHoldingsPlan([], np, { newId: () => 'A1', today: TODAY }).next[0];
  eq('#P12 이름으로 확인한 새 종목 = 그 코드로 새 행(현재가 함께 · 다시 찾을 대상 아님)', [np.rows[0].kind, nr.code, nr.name, nr.currentPrice, /이름으로 찾아 넣었습니다/.test(nr.syncNote), photoCodeTodo([{ id: 'p', portfolio: [nr] }]).length], ['add', '278530', 'KODEX 200TR', 27800, true, 0]);
  // 잠정(loose) 잇기의 보호 — 확인한 코드가 그 행 코드와 다르면 끊고, 같으면 잇는다
  const row = (name, fund = false) => ({ code: '', name, qty: 1, invest: 1, avg: 0, cut: false, unread: '', line: '', ...(fund ? { fund: true, eval: 1 } : {}) });
  const items8 = [{ id: 's1', type: 'stock', code: '005935', name: '삼성전자우' }, { id: 's2', type: 'stock', code: '', name: 'TIGER 미국배당' }];
  eq('#M4 「삼성전자」 → 「삼성전자우」 잠정 잇기는 확인 코드(005930)가 다르면 끊음 · 확인이 없으면 예전처럼 · 코드 없는 행은 막지 않음', [
    matchHoldingHow(row('삼성전자'), items8, new Set())?.it.id, matchHoldingHow(row('삼성전자'), items8, new Set(), { [photoKey('삼성전자')]: { code: '005930', name: '삼성전자', price: 1, changeRate: 0 } }),
    matchHoldingHow(row('TIGER 미국배당다우존스'), items8, new Set(), { [photoKey('TIGER 미국배당다우존스')]: { code: '458730', name: 'TIGER 미국배당다우존스', price: 1, changeRate: 0 } })?.it.id,
  ], ['s1', null, 's2']);
  eq('#M5 펀드 줄은 펀드 행에만 · 주식 줄은 주식 행에만', [matchHoldingHow(row('KODEX 200', true), [{ id: 'k', type: 'stock', code: '069500', name: 'KODEX 200' }], new Set()), matchHoldingHow(row('어떤 펀드'), [{ id: 'f', type: 'fund', code: '', name: '어떤 펀드' }], new Set())], [null, null]);
  // 추천 순위
  const SUG = [{ code: '360750', name: 'TIGER 미국S&P500' }, { code: '448290', name: 'TIGER 미국S&P500(H)' }, { code: '379800', name: 'KODEX 미국S&P500' }, { code: '069500', name: 'KODEX 200' }, { code: '005930', name: '삼성전자' }];
  const rk = rankCodeSuggestions('TIGER 미국S&P500', SUG, 'search');
  eq('#P13 추천 — 같은 이름 맨 위(이름 같음) · 비슷한 순 · 동떨어진 이름은 뺌', [rk.map(s => s.code), rk[0].exact, rk.some(s => s.code === '005930' || s.code === '069500')], [['360750', '448290', '379800'], true, false]);
  eq('#P14 닮음 — 같음 1 · 띄어쓰기·&·… 무시 · 앞부분 · 동떨어짐 0에 가까움', [nameScore('TIGER 미국S&P500', 'TIGER미국S&P500'), nameScore('KODEX 200TR', 'KODEX 200') > 0.7, nameScore('삼성전자', 'TIGER 미국S&P500') < 0.2, nameScore('', 'A')], [1, true, true, 0]);
  const mg = mergeCodeSuggestions([[{ code: '379800', name: 'KODEX 미국S&P500', score: 0.6, exact: false, from: 'acct' }], rk]);
  eq('#P15 출처 합치기 — 코드 겹침 없음 · 닮음 순 · 같은 점수면 다른 계좌 것', [mg.map(s => s.code), mg.find(s => s.code === '379800').from], [['360750', '448290', '379800'], 'acct']);
  eq('#P16 다른 계좌 코드 후보 — 국내 계좌의 코드 있는 주식 행만(해외·삭제·현금 빼고 · 겹침 없음)', acctCodeCands([
    { id: 'a', accountType: 'dc-irp', portfolio: [{ type: 'stock', code: '360750', name: 'TIGER 미국S&P500' }, { type: 'stock', code: '', name: '코드 없음' }, { type: 'fund', code: 'K55301', name: '펀드' }] },
    { id: 'b', accountType: 'overseas', portfolio: [{ type: 'stock', code: '360750', name: 'X' }, { type: 'stock', code: 'QQQM', name: 'Q' }] },
    { id: 'c', deletedAt: 1, portfolio: [{ type: 'stock', code: '005930', name: '삼성전자' }] },
    { id: 'd', portfolio: [{ type: 'stock', code: '360750', name: '다른 이름' }, { type: 'stock', code: '069500', name: 'KODEX 200', isManualCash: true }] },
  ]), [{ code: '360750', name: 'TIGER 미국S&P500' }]);
  eq('#P17 추천 검색어 — 사진 이름 · 가장 긴 한글 덩어리 · 영문 머리+한글 앞', [suggestQueries('ACEK휴머노이드로봇산업TOP2+'), suggestQueries('TIGER 미국S&P500'), suggestQueries('')],
    [['ACEK휴머노이드로봇산업TOP2+', '휴머노이드로봇산업', 'ACEK 휴머노이'], ['TIGER 미국S&P500', 'TIGER 미국'], []]);
  const big = { result: { etfItemList: Array.from({ length: 120 }, (_, i) => ({ itemcode: String(100000 + i), itemname: `ETF ${i}` })) } };
  eq('#P18 ETF 전체 목록은 다 읽는다(추천 순위용 max) · 기본은 40개', [codeCandsFrom(big, undefined, 3000).length, codeCandsFrom(big).length], [120, 40]);
}

// #E 서버 처리부를 끝까지 — 로그인 확인·관리자 판별은 바꿔 끼우고 가짜 Gemini로
if (P && T) {
  const dir = mkdtempSync(join(tmpdir(), 'holdphoto-'));
  let handler = null;
  try {
    const src = read('api/holdings-photo.ts')
      .replace("import { requireAuth, callerEmail, ADMIN_EMAIL } from './_auth.js';",
        "const requireAuth = async (r) => (r.headers.get('x-test-deny') ? new Response('no', { status: 401 }) : null); const callerEmail = async (r) => r.headers.get('x-test-email') || ''; const ADMIN_EMAIL = 'Admin@Test';")
      .replace("from './_taxPhoto.js';", `from ${JSON.stringify(pathToFileURL(join(ROOT, 'api/_taxPhoto.ts')).href)};`)
      .replace("from './_holdingsPhoto.js';", `from ${JSON.stringify(pathToFileURL(join(ROOT, 'api/_holdingsPhoto.ts')).href)};`);
    ok('#E0 처리부 시험본을 만들었다(import 세 줄 바꿔 끼움)', !/_auth\.js|'\.\/_taxPhoto\.js'|'\.\/_holdingsPhoto\.js'/.test(src));
    writeFileSync(join(dir, 'h.ts'), src);
    handler = (await import(pathToFileURL(join(dir, 'h.ts')).href)).default;
  } catch (e) { fail++; console.log(`  ✗ #E0 처리부를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
  if (handler) {
    const { photoReadInit, photoReadStep } = T;
    const realFetch = globalThis.fetch;
    const calls = [];
    let script = [];
    const ev = (o) => `data: ${JSON.stringify(o)}\n\n`;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      calls.push({ model: (u.match(/models\/([^:]+):/) || [])[1], key: init?.headers?.['x-goog-api-key'], body: init?.body });
      const step = script.shift() || { status: 500, body: 'no script' };
      if (step.status !== 200) return new Response(step.body || '', { status: step.status });
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ start(c) { for (const k of step.chunks) c.enqueue(enc.encode(k)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const call = async (body, headers = {}) => {
      const res = await handler(new Request('https://site.example/api/holdings-photo', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
      if (!(res.headers.get('content-type') || '').includes('ndjson')) return { status: res.status, json: await res.json().catch(() => null) };
      let st = photoReadInit();
      const reader = res.body.getReader(); const dec = new TextDecoder();
      for (;;) { const { value, done } = await reader.read(); if (done) break; st = photoReadStep(st, dec.decode(value, { stream: true })); }
      return { status: res.status, st: photoReadStep(st, '', true) };
    };
    const img = { mime: 'image/jpeg', data: 'B'.repeat(300) };
    const body = { account: 'DC', cands: [{ code: '0091P0', name: 'TIGER 머니마켓액티브' }], images: [img] };
    const UK = 'AIzaSyUSERKEY_1234567890abcdefghijklmn';
    const env0 = { ...process.env };
    const okAnswer = (text) => ({ status: 200, chunks: [ev({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })] });
    try {
      process.env.GEMINI_API_KEY = 's1';
      process.env.GEMINI_API_KEY2 = 's2';
      for (let i = 3; i <= 9; i++) delete process.env['GEMINI_API_KEY' + i];
      calls.length = 0;
      const r0 = await call(body, { 'x-test-email': 'user@x' });
      eq('#E1 다른 사용자 · 내 키 없음 → needkey(사이트 키로 Gemini를 부르지 않음)', [r0.status, r0.st.error, calls.length], [200, 'needkey', 0]);
      calls.length = 0;
      script = [okAnswer(PHOTO1)];
      const r1 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E2 다른 사용자 · 내 키 → 내 키로만 · 답 끝까지', [r1.st.done, r1.st.error, r1.st.text, calls.map(c => c.key)], [true, '', PHOTO1, [UK]]);
      const sent = JSON.parse(calls[0].body);
      ok('#E2 Gemini로 간 본문 = 사진 그대로 + 서버가 만든 부탁 문장', sent.contents[0].parts[0].inline_data.data === img.data && sent.contents[0].parts[1].text === P.buildHoldPrompt(P.checkHoldReq(body)));
      calls.length = 0;
      script = [okAnswer('없음')];
      const r2 = await call(body, { 'x-test-email': 'admin@test' });
      eq('#E3 관리자 · 내 키 없음 → 사이트 키(대소문자 무시)', [r2.st.done, calls.map(c => c.key)], [true, ['s1']]);
      calls.length = 0;
      script = [{ status: 400, body: '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}' }, okAnswer(PHOTO1)];
      const r3 = await call(body, { 'x-test-email': 'admin@test', 'X-Gemini-Key': UK });
      eq('#E4 관리자 · 내 키가 틀림 → 사이트 키로 이어서', [r3.st.done, r3.st.error, calls.map(c => c.key)], [true, '', [UK, 's1']]);
      calls.length = 0;
      script = [{ status: 400, body: '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}' }];
      const r4 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E5 다른 사용자 · 틀린 키 → badkey(다른 모델로 되풀이하지 않음)', [r4.st.error, r4.st.done, calls.length], ['badkey', false, 1]);
      calls.length = 0;
      script = [{ status: 429, body: 'q' }, { status: 429, body: 'q' }, { status: 429, body: 'q' }];
      const r5 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E6 내 키 한도 → 모델마다 한 번씩 물어본 뒤 rate', [r5.st.error, calls.length], ['rate', 3]);
      const PAY = '{"error":{"code":402,"message":"Your prepayment credits are depleted.","status":"RESOURCE_EXHAUSTED"}}';
      calls.length = 0;
      script = [{ status: 402, body: PAY }, okAnswer(PHOTO1)];
      const r5b = await call(body, { 'x-test-email': 'admin@test', 'X-Gemini-Key': UK });
      eq('#E6b 관리자 · 내 키 선불 크레딧 소진(402) → 사이트 키로 이어서', [r5b.st.done, r5b.st.error, calls.map(c => c.key)], [true, '', [UK, 's1']]);
      calls.length = 0;
      script = [{ status: 402, body: PAY }];
      const r5c = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E6c 다른 사용자 · 내 키 402 → credit(다른 모델로 되풀이하지 않음)', [r5c.st.error, r5c.st.msg, calls.length], ['credit', '내 키: 선불 충전금 0원(402)', 1]);
      delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY2;
      calls.length = 0;
      const r6 = await call(body, { 'x-test-email': 'admin@test' });
      eq('#E7 관리자 · 사이트 키도 내 키도 없음 → nokey', [r6.st.error, calls.length], ['nokey', 0]);
      const r7 = await call({ images: [] }, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E8 요청 검사 실패 → 400 JSON', [r7.status, r7.json && r7.json.error], [400, '사진이 없습니다']);
      const r8 = await call(body, { 'x-test-deny': '1' });
      eq('#E9 로그인 확인 실패 → 그대로 401', r8.status, 401);
    } catch (e) {
      fail++; console.log(`  ✗ #E 처리부 실행 중 오류 — ${e && (e.stack || e.message)}`);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of Object.keys(process.env)) if (/^GEMINI_API_KEY/.test(k)) delete process.env[k];
      for (const [k, v] of Object.entries(env0)) if (/^GEMINI_API_KEY/.test(k)) process.env[k] = v;
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ }
    }
  }
}

// #S 배선 — 소스 가드
const app = stripComments(read('src/App.tsx'));
const ups = stripComments(read('src/hooks/usePortfolioState.ts'));
const pt = stripComments(read('src/components/PortfolioTable.tsx'));
const hp = stripComments(read('src/components/HoldingsPhotoSync.tsx'));
const cal = stripComments(read('src/components/CalendarModal.tsx'));
const guide = stripComments(read('src/components/AiApiGuide.tsx'));
const ds = stripComments(read('src/driveStorage.ts'));
const srv = stripComments(read('api/holdings-photo.ts'));

ok('#S1 Drive 저장 지문에 syncNote(메모만 지워도 저장된다)', /portfolioStructureKey = JSON\.stringify\(\[[\s\S]*?syncNote: item\.syncNote \|\| ''/.test(app));
ok("#S2 쓰기 경로 — syncNote는 글(빈 글 = 필드 삭제), cleanNum으로 가지 않음", /if \(field === 'syncNote'\) \{[^\n]*return value \? \{ \.\.\.rest, syncNote: String\(value\) \} : rest; \}/.test(ups)
  && ups.indexOf("if (field === 'syncNote')") < ups.indexOf('const num = cleanNum(value);'));
ok('#S3 표 — 📷 버튼(onPhotoSync)과 종목명 칸 📝 메모(마우스 올림 title + 눌러 보기·지우기)', /onPhotoSync = null \}\) => \{/.test(pt) && /\{onPhotoSync && <button onClick=\{onPhotoSync\}/.test(pt)
  && /\{item\.syncNote && \(/.test(pt) && /title=\{`\$\{item\.syncNote\}/.test(pt) && /onUpdate\(notePop\.id, 'syncNote', ''\)/.test(pt) && /import \{[^}]*\bCamera\b[^}]*\} from 'lucide-react'/.test(pt) && /<Camera size=\{14\} \/><\/button>\}/.test(pt));
ok('#S4 App — 해외계좌도(2026-11-26 — 달러 원가 usd 모드) · 연 계좌 id에만 쓴다 · 창과 키 API 연결', /onPhotoSync=\{\(\) => setHoldPhotoPid\(activePortfolioId\)\}/.test(app)
  && /usd=\{\(portfolios\.find\(p => p\.id === holdPhotoPid\)\?\.accountType\) === 'overseas'\}/.test(app)
  && /<HoldingsPhotoSync[\s\S]*?applyItems=\{\(fn\) => \{ const pid = holdPhotoPid;/.test(app) && /keyApi=\{geminiKeyApi\}/.test(app)
  && /import HoldingsPhotoSync from '\.\/components\/HoldingsPhotoSync';/.test(app));
const keyApi = app.slice(app.indexOf('const geminiKeyApi = useMemo('), app.indexOf('}), []);', app.indexOf('const geminiKeyApi = useMemo(')));
ok('#S5 키 = 내 Drive ai_settings.json(saveDriveFile만 · 버전 백업·브라우저 저장소 금지 · 관리자 접속 중 읽기/쓰기 안 함)',
  keyApi.length > 200 && /saveDriveFile\(token, folderId, DRIVE_FILES\.AI_SETTINGS,/.test(keyApi) && /loadDriveFile\(token, folderId, DRIVE_FILES\.AI_SETTINGS\)/.test(keyApi)
  && !/saveVersionedBackup|localStorage|sessionStorage/.test(keyApi) && (keyApi.match(/adminViewingAsRef\.current \|\| ADMIN_VIEW_EMAIL/g) || []).length === 2
  && /AI_SETTINGS:\s*'ai_settings\.json'/.test(ds));
ok('#S6 화면은 /api/holdings-photo 하나만 부른다(구글을 직접 부르지 않음) · 내 키는 X-Gemini-Key 헤더로만',
  (hp.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/holdings-photo'/.test(hp) && !/generativelanguage/.test(hp) && /headers\['X-Gemini-Key'\] = keyState\.key/.test(hp)
  && !/geminiKey|X-Gemini-Key/.test(hp.slice(hp.indexOf("body: JSON.stringify({ account"), hp.indexOf("body: JSON.stringify({ account") + 160)));
ok('#S7 끝까지 받은 답만 맞춘다(끊긴 글로 맞추면 뒤쪽 종목이 0이 된다)', /if \(st\.error \|\| !st\.done\) \{[\s\S]{0,140}return;\s*\}[\s\S]*?planHoldingsSync\(/.test(hp));
ok('#S8 적용·되돌리기는 applyItems(최신 prev 위) — 새 행 id는 두 번 계산해도 같게', /applyItems\(prev => applyHoldingsPlan\(prev, plan, \{ newId: idGen\(\), today, usd \}\)\.next\)/.test(hp) && /applyItems\(prev => undoHoldingsPlan\(prev, u\)\)/.test(hp));
ok('#S9 서버 — 관리자 판별은 로그인 토큰의 이메일 · 내 키는 헤더에서만', /const isAdmin = \(await callerEmail\(request\)\)\.toLowerCase\(\) === ADMIN_EMAIL\.toLowerCase\(\);/.test(srv)
  && /userGeminiKey\(request\.headers\.get\(USER_KEY_HEADER\)\)/.test(srv) && /send\(\{ e: isAdmin \? 'nokey' : 'needkey' \}\)/.test(srv));
ok('#S10 메모 달력 — ✨ AI 연동 버튼이 사용법 창을 연다', /import AiApiGuide from '\.\/AiApiGuide';/.test(cal) && /setAiGuideOpen\(o => !o\)/.test(cal) && /\{aiGuideOpen && <AiApiGuide onClose=\{\(\) => setAiGuideOpen\(false\)\} \/>\}/.test(cal));
const imgs = [...guide.matchAll(/img: '(\/ai-guide\/[^']+\.svg)'/g)].map(m => m[1]);
ok('#S11 사용법 그림 다섯 장 — 파일이 있고 SVG다', imgs.length === 5 && imgs.every(p => existsSync(join(ROOT, 'public', p)) && /^<svg[\s\S]*<\/svg>\s*$/.test(read(join('public', p)))));
ok('#S12 사용법 — 키 받는 곳 주소 · 무료 한도 초기화 시각 · 사진 저장 안 함 · 구글 약관 안내', /AI_KEY_PAGE = 'https:\/\/aistudio\.google\.com\/apikey'/.test(guide)
  && guide.includes('오후 4~5시') && guide.includes('사진을 저장하지 않습니다') && guide.includes('구글 서비스 개선'));
const fillHook = stripComments(read('src/hooks/usePhotoCodeFill.ts'));
const apiSrc = stripComments(read('src/api.ts'));
const search = apiSrc.slice(apiSrc.indexOf('export const searchKrStockCodes'), apiSrc.indexOf('export const fetchUsStockInfo'));
ok('#S13 App — 코드 찾기는 부팅 정착 뒤 · 관리자 접속이 아닐 때만 · 찾으면 구분 물려받기 + 그 계좌 id로 단일 갱신(이력 스탬프)',
  /usePhotoCodeFill\(\{[\s\S]*?ready: histPhase === 'settled',[\s\S]*?canWrite: \(\) => !ADMIN_VIEW_EMAIL && !adminViewingAsRef\.current,[\s\S]*?onFilled: \(pid, id, code\) => \{ inheritSharedCategoryFor\(pid, id\); handleSingleStockRefreshFor\(pid, id, code\); \}/.test(app)
  && /import \{ usePhotoCodeFill \} from '\.\/hooks\/usePhotoCodeFill';/.test(app));
ok('#S14 코드 찾기 훅 — ① 다른 계좌의 같은 이름(knownCodeFor) ② 없으면 검색(findCodeByName · 공식 이름 확인 fetchStockInfo) ③ 못 찾으면 메모 · 한 세션에 한 번',
  /const known = knownCodeFor\(t\.name, latest\.current\);\s*const r = known\s*\? \{ found: \{ \.\.\.known, price: 0, changeRate: 0, from: 'acct' as const \}[\s\S]*?: await findCodeByName\(t\.name, \{ search: searchKrStockCodes, info: fetchStockInfo \}\)/.test(fillHook)
  && /write\(items => markPhotoCodeMiss\(items, t\.id, r\.why, today\)\)/.test(fillHook) && /tried\.current\.add\(/.test(fillHook) && !/fetch\(/.test(fillHook));
ok('#S16 표 — 찾지 못한 코드 칸은 노란 칸 + 「코드 입력」 · 직접 넣으면 메모를 「직접 넣었습니다」로', /const codeState = photoCodeState\(item\);/.test(pt)
  && /codeState === 'miss' \? 'bg-amber-500\/20 ring-1 ring-inset ring-amber-400' : ''/.test(pt) && /placeholder=\{codeState === 'miss' \? '코드 입력'/.test(pt)
  && /photoCodeState\(\{ \.\.\.item, code: '' \}\)\) onUpdate\(item\.id, 'syncNote', codeTypedNote\(getTodayKST\(\)\)\)/.test(pt)
  && /import \{ photoCodeState, codeTypedNote(, codeFoundNote)? \} from '\.\.\/holdingsPhoto';/.test(pt));
const app2 = app;
ok('#S17 사진 창 — 국내는 넣기 전에 이름으로 코드 확인(다른 계좌의 같은 이름 → 검색·공식 이름) → 고르기 모드로 계획 · 코드로 넣은 새 행은 현재가 부르기',
  /const names = namesToResolve\(planHoldingsSync\(parsed, itemsRef\.current, \{ keepUnseen: !!ocr, pick: true \}\)\);/.test(hp)
  && /const known = knownCodeFor\(names\[i\], portfoliosRef\.current\);/.test(hp) && /await findCodeByName\(names\[i\], \{ search: searchKrStockCodes, info: fetchStockInfo \}\)/.test(hp)
  && /if \(!live\(\)\) return;\s*if \(f\) resolved\[photoKey\(names\[i\]\)\] = f;/.test(hp)
  && /planHoldingsSync\(parsed, itemsRef\.current, usd \? \{ keepUnseen: !!ocr, usd \} : \{ keepUnseen: !!ocr, resolved, pick: true \}\)/.test(hp)
  && /plan\.rows\.filter\(r => r\.kind === 'add'\)\.forEach\(\(r, i\) => \{ if \(r\.code\) onCodeSet\(ids\[i\], r\.code\); \}\)/.test(hp)
  && /import \{ searchKrStockCodes, fetchStockInfo \} from '\.\.\/api';/.test(hp));
ok('#S18 고르기 — 고른 것만 applyItems(최신 prev)로 · 되돌리기는 맞추기와 합침 · 추천 목록(CodeSuggestList) · 이 계좌 행(pickTargets)',
  /applyItems\(prev => applyHoldingPick\(prev, p\.row, choice, \{ newId: \(\) => nid, today \}\)\.next\);/.test(hp) && /undo: mergeHoldUndo\(r\.undo, res\.undo\)/.test(hp)
  && /if \(res\.code && onCodeSet\) onCodeSet\(res\.id, res\.code\);/.test(hp) && /<CodeSuggestList name=\{title\}/.test(hp) && /targets=\{pickTargets\(p\.row, items, usedNow\)\}/.test(hp)
  && /import CodeSuggestList from '\.\/CodeSuggestList';/.test(hp)
  && /portfolios=\{portfolios\}\s*onCodeSet=\{\(id, code\) => \{ const pid = holdPhotoPid; if \(pid\) \{ inheritSharedCategoryFor\(pid, id\); handleSingleStockRefreshFor\(pid, id, code\); \} \}\}/.test(app2));
const sugList = stripComments(read('src/components/CodeSuggestList.tsx'));
ok('#S19 표의 노란 코드 칸 — 추천(돋보기) → 고르면 코드 넣기·조회(onBlur)·구분 물려받기·메모 「추천에서 골랐습니다」 · 추천은 api.suggestKrStockCodes(/api/proxy)만',
  /\{codeState === 'miss' && \(\s*<button type="button" onClick=\{e => \{ const r = e\.currentTarget\.getBoundingClientRect\(\); setCodePop\(/.test(pt)
  && /onUpdate\(id, 'code', s\.code\);\s*onBlur\(id, s\.code\);\s*if \(onCodeChanged\) onCodeChanged\(id\);\s*onUpdate\(id, 'syncNote', codeFoundNote\(getTodayKST\(\), s\.code, s\.name, 'pick'\)\);/.test(pt)
  && /<CodeSuggestList name=\{codePop\.name\} onPick=\{s => pickSuggestedCode\(codePop\.id, s\)\} \/>/.test(pt) && /import CodeSuggestList from '\.\/CodeSuggestList';/.test(pt)
  && /suggestKrStockCodes\(name\)/.test(sugList) && !/fetch\(/.test(sugList) && /export const suggestKrStockCodes = async/.test(search) && /proxyJson\(`https:\/\/ac\.stock\.naver\.com/.test(search));
ok('#S15 이름 검색은 /api/proxy(로그인 확인)만 — 바깥 공용 프록시로 보내지 않음', search.length > 200 && (search.match(/fetch\(/g) || []).length === 0
  && /fetch\(`\/api\/proxy\?url=\$\{encodeURIComponent\(url\)\}`/.test(apiSrc) && !/allorigins|codetabs/.test(search));

console.log(`\nverify:holdings-photo — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
