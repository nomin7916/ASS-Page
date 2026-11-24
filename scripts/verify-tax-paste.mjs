#!/usr/bin/env node
// 평균 과표 계산기 '사진으로 넣기·붙여넣기' — src/taxCalcPaste.ts · api/_taxPhoto.ts 를 **직접 import**한다(미러 금지).
//   사용자 요청(2026-11-24 둘째): 사진만 올리면 AI가 읽고 평균 단가·수량을 바로 넣는다(붙여넣는 과정 없이)
//   → /api/tax-photo(구글 Gemini)가 사진을 읽고, 화면이 바로 넣는다. #G = 그 길(서버 처리부를 가짜 Gemini로 끝까지 돌린다).
//   사용자 요청(2026-11-24): 주문내역 사진을 Claude에게 주면 날짜별 매수·매도 수량·평균단가와 그날 과표기준가가 계산기에 들어가게.
//   Claude는 사이트 데이터(Drive 파일)를 직접 고칠 수 없으므로 → Claude가 옮긴 글을 계산기에 붙여넣는다.
// 런타임이 .ts를 못 읽으면 단위 검사만 건너뛰고 소스 가드는 돈다.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let T = null;
try { T = await import(pathToFileURL(join(ROOT, 'src/taxCalcPaste.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log('  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 단위 검사를 건너뜁니다.');
  else { fail++; console.log(`  ✗ src/taxCalcPaste.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (T) {
  const { parseTaxCalcPaste, planTaxCalcPaste, applyTaxCalcPaste, pasteCounts } = T;
  const TODAY = '2026-11-24';
  const brief = (trades) => trades.map(t => [t.date, t.side, t.qty, t.price, t.fills, t.taxBase]);

  // #P1 미래에셋 주문내역(사용자 사진 2026-11-24) 그대로 — 머리 줄·계좌 줄은 조용히 건너뛴다
  const photo = [
    '주문내역 (최근 1개월)',
    '[종합_주식] AI',
    '주문날짜 구분 주문단가 체결수량 평균체결가',
    '11.24 매도 7,485 50 7,490',
    '11.23 매수 6,965 5 6,960',
    '11.17 매수 7,100 30 7,090',
    '11.17 매수 7,150 20 7,150',
    '11.17 매수 7,200 10 7,200',
  ].join('\n');
  const p1 = parseTaxCalcPaste(photo, TODAY);
  eq('#P1 사진 표: 날짜·구분별 합침, 단가 = 수량 가중평균(소수 2자리)', brief(p1.trades), [
    ['2026-11-17', 'buy', 60, 7128.33, 3, 0],
    ['2026-11-23', 'buy', 5, 6960, 1, 0],
    ['2026-11-24', 'sell', 50, 7490, 1, 0],
  ]);
  eq('#P1 머리 줄·계좌 줄은 읽지 못한 줄로 세지 않는다', p1.skipped.length, 0);

  // #P2 Claude가 옮긴 글 형식 — 단위(주·원) + 과표
  const p2 = parseTaxCalcPaste('2026-11-23 매수 5주 6,960원\n2026-11-24 매도 50주 7,490원 과표 10,385.80\n2026.11.24 과표기준가: 10,385.80', TODAY);
  eq('#P2 단위 붙은 글 + 행 과표', brief(p2.trades), [
    ['2026-11-23', 'buy', 5, 6960, 1, 0],
    ['2026-11-24', 'sell', 50, 7490, 1, 10385.8],
  ]);
  eq('#P2 과표만 있는 줄은 날짜별 과표로', p2.taxBaseByDate, { '2026-11-24': 10385.8 });

  // #P3 날짜 해석 — 연도 없으면 올해, 오늘보다 뒤면 작년 · 없는 날짜 거부
  eq('#P3 연말 넘김: 1월에 12.30 → 작년', brief(parseTaxCalcPaste('12.30 매수 10 100', '2026-01-05').trades), [['2025-12-30', 'buy', 10, 100, 1, 0]]);
  const bad = parseTaxCalcPaste('02.30 매수 10 100\n2026-11-02 매수 0주 100원\n매도 50 7490\n2026-11-02 매수 매도 1 2\n2026-11-02 매수 1.5주 100원', TODAY);
  eq('#P3 잘못된 줄은 넣지 않고 이유를 남긴다', bad.skipped.map(s => s.reason), ['없는 날짜', '체결 수량 없음', '날짜 없음', '매수·매도가 한 줄에 함께 있음', '수량이 정수가 아님']);
  eq('#P3 잘못된 줄로 만든 매매 0건', bad.trades.length, 0);
  eq('#P3 같은 날 매수·매도면 매수가 먼저(compareTaxEvents와 같은 순서)', brief(parseTaxCalcPaste('2026-11-05 매도 3주 10원\n2026-11-05 매수 4주 9원', TODAY).trades).map(r => r[1]), ['buy', 'sell']);

  // #P4 기존 행과 대조 — 사진은 최근 1개월이라 이미 넣은 날과 겹친다(사용자 화면: 11-17 60주 @7,128 이미 있음)
  const existing = [
    { id: 'e17', date: '2026-11-17', prevQty: 10820, change: '60', purchasePrice: '7128', taxBasePrice: 0 },
    { id: 'e06', date: '2026-11-06', prevQty: 6295, change: '333', purchasePrice: '7664', taxBasePrice: 0 },
    { id: 'e05', date: '2026-11-05', prevQty: 5892, change: '403', purchasePrice: '8136', taxBasePrice: '4000' },
  ];
  const plan1 = planTaxCalcPaste(p1, existing);
  eq('#P4 겹치는 날은 이미 있음, 새 날만 추가', plan1.map(r => [r.date, r.status]), [
    ['2026-11-17', 'same'], ['2026-11-23', 'add'], ['2026-11-24', 'add'],
  ]);
  eq('#P4 반올림 차이(7,128 vs 7,128.33)는 메모하지 않는다', plan1[0].note, '');
  eq('#P4 넣기 버튼 숫자', pasteCounts(plan1), { add: 2, fill: 0 });

  // #P5 과표만 있는 줄 → 그날 행의 **빈** 과표기준가만 채운다(입력된 값은 덮지 않는다)
  const plan2 = planTaxCalcPaste(parseTaxCalcPaste('2026-11-06 과표 3,900.12\n2026-11-05 과표 3,950\n2026-11-09 과표 1', TODAY), existing);
  eq('#P5 빈칸만 채움 · 다른 값은 메모 · 행 없는 날은 표시만', plan2.map(r => [r.date, r.status, r.patch || null, r.note]), [
    ['2026-11-05', 'same', null, '입력된 과표 4,000'],
    ['2026-11-06', 'fill', { taxBasePrice: 3900.12 }, ''],
    ['2026-11-09', 'same', null, '그날 매매 행 없음'],
  ]);

  // #P6 겹치는 행의 빈 단가 채움 · 이미 매매가 있는 날은 수량이 달라도 넣지 않는다(없는 날만 — 사용자 확정 2026-11-25)
  const plan3 = planTaxCalcPaste(parseTaxCalcPaste('2026-11-10 매도 5주 7,000원 과표 10\n2026-11-10 매수 7주 6,000원', TODAY),
    [{ id: 'x', date: '2026-11-10', change: '-5', sellPrice: '', taxBasePrice: '' }, { id: 'y', date: '2026-11-10', change: '3', purchasePrice: '6000' }]);
  eq('#P6 빈 매도단가·과표 채움 + 그날 매매가 있으면 수량 다른 매수는 넣지 않음', plan3.map(r => [r.side, r.status, r.patch || null, r.note]), [
    ['buy', 'same', null, '그날 매매가 이미 있어 넣지 않음'],
    ['sell', 'fill', { sellPrice: 7000, taxBasePrice: 10 }, ''],
  ]);
  const plan3b = planTaxCalcPaste(parseTaxCalcPaste('2026-11-17 매도 7주 7,300원\n2026-11-17 매수 30주 7,090원\n2026-11-18 매수 4주 7,000원', TODAY), existing);
  eq('#P6 11-17처럼 매수가 있는 날은 사진의 매도·다른 수량 매수도 넣지 않고, 없는 날(11-18)만 추가',
    plan3b.map(r => [r.date, r.side, r.status]), [['2026-11-17', 'buy', 'same'], ['2026-11-17', 'sell', 'same'], ['2026-11-18', 'buy', 'add']]);
  eq('#P6 그 경우 넣기 버튼 숫자', pasteCounts(plan3b), { add: 1, fill: 0 });

  // #P7 적용 — '행 추가'와 같은 모양(매도는 음수·sellPrice), 전일 수량은 주입 함수, 기존 행 id 유지
  let n = 0;
  const next = applyTaxCalcPaste(existing, plan1, { newId: () => `n${++n}`, prevQtyOf: d => (d === '2026-11-23' ? 10880 : 10885) });
  eq('#P7 새 행 2개', next.slice(3), [
    { id: 'n1', date: '2026-11-23', prevQty: 10880, change: 5, purchasePrice: 6960, taxBasePrice: 0 },
    { id: 'n2', date: '2026-11-24', prevQty: 10885, change: -50, sellPrice: 7490, taxBasePrice: 0 },
  ]);
  ok('#P7 기존 행은 그대로(같은 객체)', next[0] === existing[0] && next[1] === existing[1] && next[2] === existing[2]);
  eq('#P7 같은 글을 다시 넣으면 추가 0행(두 번 눌러도 중복 없음)', pasteCounts(planTaxCalcPaste(p1, next)), { add: 0, fill: 0 });
  const filled = applyTaxCalcPaste(existing, plan2, { newId: () => 'z', prevQtyOf: () => 0 });
  eq('#P7 빈칸 채움은 그 행만 바꾼다', filled.map(e => e.taxBasePrice), [0, 3900.12, '4000']);

  // #P8 AI 부탁 문장(각자 쓰는 AI에 사진과 함께) — 예시 줄은 이 해석기가 그대로 읽는 형식이어야 한다
  const { buildPastePrompt } = T;
  const prompt = buildPastePrompt({ name: 'TIGER 반도체TOP10커버드콜액티브', code: '0177R0', year: 2026 });
  ok('#P8 종목 이름·코드가 문장에 들어간다', prompt.includes('TIGER 반도체TOP10커버드콜액티브 (0177R0)'));
  ok('#P8 연도 규칙(올해·오늘보다 뒤면 작년)', prompt.includes('2026년으로') && prompt.includes('2025년'));
  const exampleLines = prompt.split('\n').slice(prompt.split('\n').indexOf('예)') + 1).join('\n');
  const ex = parseTaxCalcPaste(exampleLines, TODAY);
  eq('#P8 예시 줄 = 해석기 형식', [brief(ex.trades), ex.taxBaseByDate, ex.skipped.length], [
    [['2026-11-23', 'buy', 5, 6960, 1, 0], ['2026-11-24', 'sell', 50, 7490, 1, 1234.56]], { '2026-11-24': 1234.56 }, 0,
  ]);
  const decorated = parseTaxCalcPaste('```\n- 2026-11-23 매수 5주 6,960원\n• `2026-11-24 매도 50주 7,490원`\n2) **2026-11-24 과표 1,234.56**\n```', TODAY);
  eq('#P8 AI 답 꾸밈(글머리표·백틱·굵게·번호) 걷어 냄', [brief(decorated.trades), decorated.taxBaseByDate, decorated.skipped.length], [
    [['2026-11-23', 'buy', 5, 6960, 1, 0], ['2026-11-24', 'sell', 50, 7490, 1, 1234.56]], { '2026-11-24': 1234.56 }, 0,
  ]);
  const whole = parseTaxCalcPaste(prompt, TODAY);
  eq('#P8 부탁 문장을 통째로 붙이면 아무것도 넣지 않는다(예시가 진짜 매매로 들어가지 않게)', [whole.trades.length, Object.keys(whole.taxBaseByDate).length, whole.skipped.length], [0, 0, 1]);

  // #P9 사진 고르기(사용자 요청 2026-11-24 — 휴대폰 사진첩의 주문내역 사진) — 사진만·같은 사진 한 번·10장까지
  const { mergePastePhotos, photoShareData, isPastePhoto, PASTE_PHOTO_MAX, PASTE_PHOTO_ACCEPT } = T;
  eq('#P9 사진 칸 accept = 모든 사진(아이폰 HEIC→JPEG 변환)', PASTE_PHOTO_ACCEPT, ['image', '*'].join('/'));
  const ph = (name, type, size = 100, lastModified = 1) => ({ name, type, size, lastModified });
  eq('#P9 사진 판별 — 종류 또는 확장자(안드로이드는 종류가 빈 파일이 있다)', [
    isPastePhoto(ph('a.jpg', 'image/jpeg')), isPastePhoto(ph('IMG_1.HEIC', '')), isPastePhoto(ph('b.png', '')),
    isPastePhoto(ph('c.pdf', 'application/pdf')), isPastePhoto(ph('d.txt', 'text/plain')), isPastePhoto(null),
  ], [true, true, true, false, false, false]);
  const m1 = mergePastePhotos([], [ph('a.jpg', 'image/jpeg'), ph('x.pdf', 'application/pdf'), ph('b.png', 'image/png')]);
  eq('#P9 처음 고르기 — 사진 2장 넣고 PDF 1개 뺌', [m1.add.map(f => f.name), m1.notImage, m1.dup, m1.over], [['a.jpg', 'b.png'], 1, 0, 0]);
  const m2 = mergePastePhotos(m1.add, [ph('a.jpg', 'image/jpeg'), ph('a.jpg', 'image/jpeg', 200)]);
  eq('#P9 같은 사진(이름·크기·날짜)은 빼고 이름만 같은 다른 사진은 넣는다', [m2.add.map(f => f.size), m2.dup], [[200], 1]);
  const many = Array.from({ length: 12 }, (_, i) => ph(`p${i}.jpg`, 'image/jpeg', 100 + i));
  const m3 = mergePastePhotos([ph('z.jpg', 'image/jpeg')], many);
  eq(`#P9 ${PASTE_PHOTO_MAX}장까지 — 이미 1장이면 9장만 더하고 3장은 뺀다`, [m3.add.length, m3.over], [PASTE_PHOTO_MAX - 1, 3]);

  // #P10 공유 창에 넘길 것 — 사진+문장 → 사진만(문장은 클립보드) → 못 보냄(null, 직접 올리기 안내)
  const files = [ph('a.jpg', 'image/jpeg')];
  const navAll = { share() {}, canShare: () => true };
  const navFilesOnly = { share() {}, canShare: (d) => !('text' in d) };
  const navNoFiles = { share() {}, canShare: () => false };
  const navOld = { share() {} };   // canShare 없는 옛 브라우저 — 파일 공유를 못 한다고 본다
  const navThrow = { share() {}, canShare: () => { throw new Error('x'); } };
  eq('#P10 사진+부탁 문장을 함께', [photoShareData(navAll, files, 'P')?.withText, photoShareData(navAll, files, 'P')?.data.text], [true, 'P']);
  eq('#P10 문장을 못 받는 곳은 사진만', [photoShareData(navFilesOnly, files, 'P')?.withText, 'text' in (photoShareData(navFilesOnly, files, 'P')?.data || {})], [false, false]);
  eq('#P10 파일 공유가 안 되는 브라우저·옛 브라우저·오류·사진 없음 → null', [
    photoShareData(navNoFiles, files, 'P'), photoShareData(navOld, files, 'P'), photoShareData(navThrow, files, 'P'),
    photoShareData(navAll, [], 'P'), photoShareData(undefined, files, 'P'),
  ], [null, null, null, null, null]);
}

// ── #G 사진으로 넣기(사이트가 AI로 읽고 바로 넣는다) ──
let P = null;
try { P = await import(pathToFileURL(join(ROOT, 'api/_taxPhoto.ts')).href); }
catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (!unsupported) { fail++; console.log(`  ✗ api/_taxPhoto.ts 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}
if (T && P) {
  const { parseTaxCalcPaste, planTaxCalcPaste, photoBudget, photoFitSize, PHOTO_BODY_BUDGET, PHOTO_ONE_MAX, PHOTO_TRIES,
    photoReadInit, photoReadStep, photoErrorText, photoOutcome } = T;
  const TODAY = '2026-11-24';
  const brief = (trades) => trades.map(t => [t.date, t.side, t.qty, t.price, t.fills, t.taxBase]);

  // #G1 사진 줄이기 몫 — 한 장이면 넉넉히, 10장이면 합계가 서버 상한 안
  eq('#G1 사진 한 장 몫(1장·3장·10장)', [photoBudget(1), photoBudget(3), photoBudget(10)], [PHOTO_ONE_MAX, PHOTO_ONE_MAX, 300000]);
  ok('#G1 10장 합계 ≤ 서버 상한(본문 여유 포함)', photoBudget(10) * 10 <= PHOTO_BODY_BUDGET && PHOTO_BODY_BUDGET + 2000 < P.BODY_MAX);
  eq('#G1 휴대폰 화면 캡처(1179×2556) → 긴 변 2400 · 키우지 않음 · 가로 사진', [photoFitSize(1179, 2556), photoFitSize(800, 600), photoFitSize(4032, 3024)],
    [{ w: 1107, h: 2400 }, { w: 800, h: 600 }, { w: 1867, h: 1400 }]);
  ok('#G1 줄이는 차례는 점점 작게(마지막은 절반 아래)', PHOTO_TRIES.every((t, i) => i === 0 || (t.scale <= PHOTO_TRIES[i - 1].scale && t.q <= PHOTO_TRIES[i - 1].q)) && PHOTO_TRIES[PHOTO_TRIES.length - 1].scale < 0.5);

  // #G2 서버의 부탁 문장 — 예시 줄을 이 해석기가 그대로 읽는다(형식이 어긋나면 AI 답이 통째로 '읽지 못한 줄'이 된다)
  const sp = P.buildPhotoPrompt({ name: 'TIGER 반도체TOP10커버드콜액티브', code: '0177R0', year: 2026 });
  ok('#G2 종목 이름·코드·연도 규칙·체결수량 규칙·겹친 사진 규칙', sp.includes('TIGER 반도체TOP10커버드콜액티브 (0177R0)') && sp.includes('2026년으로') && sp.includes('2025년')
    && sp.includes('체결수량') && sp.includes('한 번만'));
  const spEx = parseTaxCalcPaste(sp.split('\n').slice(sp.split('\n').indexOf('예)') + 1).join('\n'), TODAY);
  eq('#G2 서버 부탁 문장의 예시 줄 = 해석기 형식', [brief(spEx.trades), spEx.taxBaseByDate, spEx.skipped.length], [
    [['2026-11-23', 'buy', 5, 6960, 1, 0], ['2026-11-24', 'sell', 50, 7490, 1, 1234.56]], { '2026-11-24': 1234.56 }, 0,
  ]);
  const none = parseTaxCalcPaste('없음', TODAY);
  eq("#G2 '없음' 답 = 넣을 것 없음 · 읽지 못한 줄 0", [photoOutcome(none, planTaxCalcPaste(none, [])), none.skipped.length], ['none', 0]);

  // #G3 요청 검사
  const img = { mime: 'image/jpeg', data: 'A'.repeat(200) };
  const good = P.checkPhotoReq({ name: 'TIGER\n반도체', code: '0177R0', year: 2026, images: [img] }, 2026);
  eq('#G3 통과(이름의 줄바꿈은 빈칸)', [good.name, good.code, good.images.length], ['TIGER 반도체', '0177R0', 1]);
  eq('#G3 거절 — 코드·연도·사진 없음·11장·형식·깨진 자료', [
    P.checkPhotoReq({ code: '../x', year: 2026, images: [img] }, 2026).error,
    P.checkPhotoReq({ code: '0177R0', year: 2020, images: [img] }, 2026).error,
    P.checkPhotoReq({ code: '0177R0', year: 2026, images: [] }, 2026).error,
    P.checkPhotoReq({ code: '0177R0', year: 2026, images: Array(11).fill(img) }, 2026).error,
    P.checkPhotoReq({ code: '0177R0', year: 2026, images: [{ mime: 'text/html', data: img.data }] }, 2026).error,
    P.checkPhotoReq({ code: '0177R0', year: 2026, images: [{ mime: 'image/png', data: 'A'.repeat(150) + '<' }] }, 2026).error,
  ].map(Boolean), [true, true, true, true, true, true]);
  eq('#G3 키 목록(GEMINI_API_KEY + 2~9, 빈 값 건너뜀)', P.geminiKeys({ GEMINI_API_KEY: ' a ', GEMINI_API_KEY2: '', GEMINI_API_KEY3: 'c' }), ['a', 'c']);
  const gb = JSON.parse(P.geminiBody(good));
  ok('#G3 Gemini 본문 = 사진 inline_data + 부탁 문장 · temperature 0', gb.contents[0].parts[0].inline_data.mime_type === 'image/jpeg'
    && gb.contents[0].parts[1].text.includes('(0177R0)') && gb.generationConfig.temperature === 0);

  // #G4 Gemini SSE → 답 글(생각 조각 빼기 · 다 안 온 줄은 남김 · 차단 사유)
  const ev = (o) => 'data: ' + JSON.stringify(o) + '\r\n\r\n';
  const sse = ev({ candidates: [{ content: { parts: [{ text: '생각', thought: true }, { text: '2026-11-24 매도 ' }] } }] })
    + ev({ candidates: [{ content: { parts: [{ text: '50주 7,490원' }] }, finishReason: 'STOP' }] }) + 'data: {"cand';
  const s1 = P.sseTexts(sse);
  eq('#G4 SSE 글만 · 남은 줄', [s1.texts, s1.rest, s1.block], [['2026-11-24 매도 ', '50주 7,490원'], 'data: {"cand', '']);
  eq('#G4 차단(promptFeedback·SAFETY)', [P.sseTexts(ev({ promptFeedback: { blockReason: 'OTHER' } })).block, P.sseTexts(ev({ candidates: [{ finishReason: 'SAFETY' }] })).block], ['OTHER', 'SAFETY']);

  // #G5 화면이 받는 줄(NDJSON) 모으기 — 조각이 줄 가운데서 끊겨도 · 끝 표시 · 오류
  let st = photoReadInit();
  const wire = '{"s":1}\n{"m":"gemini-flash-latest"}\n{"t":"2026-11-24 매도 50"}\n{"k":1}\n{"t":"주 7,490원\\n"}\n{"d":1}\n';
  for (let i = 0; i < wire.length; i += 7) st = photoReadStep(st, wire.slice(i, i + 7));
  st = photoReadStep(st, '', true);
  eq('#G5 7글자씩 끊어 받아도 같은 글', [st.text, st.done, st.error, st.model], ['2026-11-24 매도 50주 7,490원\n', true, '', 'gemini-flash-latest']);
  const cut = photoReadStep(photoReadInit(), '{"s":1}\n{"t":"2026-11-24 매도 50주"}\n', true);
  eq('#G5 끝 표시 없이 끊김 = done false(넣지 않는다)', [cut.done, cut.error], [false, '']);
  const er = photoReadStep(photoReadInit(), '{"s":1}\n{"e":"rate","msg":"429"}\n{"e":"gemini"}\n', true);
  eq('#G5 첫 오류만', [er.error, er.msg], ['rate', '429']);
  ok('#G5 오류 글(키 없음·한도·끊김·사진 못 엶·로그인)', ['nokey', 'rate', 'cut', 'decode', 'auth', 'block', 'net', 'big', 'gemini'].every(c => photoErrorText(c).length > 10)
    && photoErrorText('nokey').includes('GEMINI_API_KEY') && photoErrorText('xx') === photoErrorText('gemini'));

  // #G6 서버 처리부를 끝까지 — 가짜 Gemini(한도→다음 키, 없는 모델→다음 모델, 성공은 SSE를 조각으로) · 로그인 확인은 통과로 바꿔 끼운다
  const dir = mkdtempSync(join(tmpdir(), 'taxphoto-'));
  let H = null;
  try {
    const src = read('api/tax-photo.ts')
      .replace("import { requireAuth } from './_auth.js';", 'const requireAuth = async (r) => (r.headers.get("x-test-deny") ? new Response("no", { status: 401 }) : null);')
      .replace("from './_taxPhoto.js';", `from ${JSON.stringify(pathToFileURL(join(ROOT, 'api/_taxPhoto.ts')).href)};`);
    ok('#G6 처리부 시험본을 만들었다(import 두 줄 바꿔 끼움)', !/_auth\.js|'\.\/_taxPhoto\.js'/.test(src));
    writeFileSync(join(dir, 'h.ts'), src);
    H = (await import(pathToFileURL(join(dir, 'h.ts')).href)).default;
  } catch (e) { fail++; console.log(`  ✗ #G6 처리부를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
  if (H) {
    const realFetch = globalThis.fetch;
    const calls = [];
    let script = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      calls.push({ model: (u.match(/models\/([^:]+):/) || [])[1], key: init?.headers?.['x-goog-api-key'], body: init?.body });
      const step = script.shift() || { status: 500, body: 'no script' };
      if (step.status !== 200) return new Response(step.body || '', { status: step.status });
      const enc = new TextEncoder();
      const chunks = step.chunks;
      return new Response(new ReadableStream({ start(c) { for (const k of chunks) c.enqueue(enc.encode(k)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const env0 = { ...process.env };
    const call = async (body, headers = {}) => {
      const res = await H(new Request('https://site.example/api/tax-photo', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
      if (!(res.headers.get('content-type') || '').includes('ndjson')) return { status: res.status, json: await res.json().catch(() => null) };
      let st = photoReadInit();
      const reader = res.body.getReader(); const dec = new TextDecoder();
      for (;;) { const { value, done } = await reader.read(); if (done) break; st = photoReadStep(st, dec.decode(value, { stream: true })); }
      return { status: res.status, st: photoReadStep(st, '', true) };
    };
    const reqBody = { name: 'TIGER 반도체', code: '0177R0', year: Number(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 4)), images: [img] };
    try {
      delete process.env.GEMINI_API_KEY;
      for (let i = 2; i <= 9; i++) delete process.env['GEMINI_API_KEY' + i];
      const r0 = await call(reqBody);
      eq('#G6 키 없음 → nokey(Gemini를 부르지 않음)', [r0.status, r0.st.error, calls.length], [200, 'nokey', 0]);
      process.env.GEMINI_API_KEY = 'k1';
      process.env.GEMINI_API_KEY2 = 'k2';
      const answer = '2026-11-17 매수 30주 7,090원\n2026-11-17 매수 20주 7,150원\n2026-11-24 매도 50주 7,490원\n';
      const half = Math.floor(answer.length / 2);
      script = [
        { status: 429, body: '{"error":{"code":429}}' },                       // 첫 모델 · k1 한도
        { status: 404, body: 'model not found' },                               // 첫 모델 · k2 → 없는 모델
        { status: 200, chunks: [ev({ candidates: [{ content: { parts: [{ text: answer.slice(0, half) }] } }] }).slice(0, 30),
          ev({ candidates: [{ content: { parts: [{ text: answer.slice(0, half) }] } }] }).slice(30),
          ev({ candidates: [{ content: { parts: [{ text: answer.slice(half) }] }, finishReason: 'STOP' }] })] },
      ];
      const r1 = await call(reqBody);
      eq('#G6 한도 → 다음 키, 없는 모델 → 다음 모델, 성공 글을 끝까지', [r1.st.done, r1.st.error, r1.st.text, r1.st.model, calls.map(c => [c.model, c.key])], [
        true, '', answer, 'gemini-2.5-flash', [['gemini-flash-latest', 'k1'], ['gemini-flash-latest', 'k2'], ['gemini-2.5-flash', 'k1']],
      ]);
      const sent = JSON.parse(calls[2].body);
      ok('#G6 Gemini로 간 본문 = 사진 그대로 + 서버가 만든 부탁 문장(화면이 보낸 글이 아님)', sent.contents[0].parts[0].inline_data.data === img.data && sent.contents[0].parts[1].text === P.buildPhotoPrompt(P.checkPhotoReq(reqBody, reqBody.year)));
      const got = parseTaxCalcPaste(r1.st.text, TODAY);
      eq('#G6 받은 글 → 날짜별 합침(평균 단가)', brief(got.trades), [['2026-11-17', 'buy', 50, 7114, 2, 0], ['2026-11-24', 'sell', 50, 7490, 1, 0]]);
      calls.length = 0;
      script = [{ status: 429, body: 'q' }, { status: 429, body: 'q' }, { status: 429, body: 'q' }, { status: 429, body: 'q' }, { status: 429, body: 'q' }, { status: 429, body: 'q' }];
      const r2 = await call(reqBody);
      eq('#G6 모든 모델·키가 한도 → rate(모델마다 한 번씩 다 물어봄)', [r2.st.error, r2.st.done, calls.length], ['rate', false, 6]);
      calls.length = 0;
      script = [{ status: 400, body: '{"error":{"message":"bad image"}}' }];
      const r3 = await call(reqBody);
      eq('#G6 요청이 틀림(400, 키 문제 아님) → 다른 키로 되풀이하지 않음', [r3.st.error, calls.length], ['gemini', 1]);
      calls.length = 0;
      script = [{ status: 400, body: '{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}' },
        { status: 200, chunks: [ev({ promptFeedback: { blockReason: 'OTHER' } })] }];
      const r4 = await call(reqBody);
      eq('#G6 틀린 키 → 다음 키 · 차단 답 → block', [r4.st.error, r4.st.text, calls.map(c => c.key)], ['block', '', ['k1', 'k2']]);
      calls.length = 0;
      const bad = await Promise.all([
        call({ ...reqBody, code: '<x>' }),
        call('not json'),
        call({ ...reqBody, images: [{ mime: 'image/jpeg', data: 'A'.repeat(4_100_000) }] }),
        call(reqBody, { 'x-test-deny': '1' }),
        H(new Request('https://site.example/api/tax-photo', { method: 'GET' })).then(r => ({ status: r.status })),
        call(reqBody, { 'sec-fetch-site': 'cross-site' }).catch(() => ({ status: 403 })),
      ]);
      eq('#G6 거절 — 코드·글 아님·너무 큼·로그인 없음·GET·다른 사이트 (Gemini 0번)', [bad.map(b => b.status), calls.length], [[400, 400, 413, 401, 405, 403], 0]);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of Object.keys(process.env)) if (/^GEMINI_API_KEY/.test(k)) delete process.env[k];
      for (const [k, v] of Object.entries(env0)) if (/^GEMINI_API_KEY/.test(k)) process.env[k] = v;
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 소스 가드: 계산기가 이 모듈을 실제로 쓰는가 ──
const mod = read('src/taxCalcPaste.ts');
ok('#S1 taxCalcPaste.ts에 import 0줄(Node가 직접 실행)', !/^\s*import\s/m.test(stripComments(mod)));
const mx = stripComments(read('src/components/KrEtfTaxMatrix.tsx'));
ok('#S2 KrEtfTaxMatrix가 다섯 함수 + 사진 함수·값 + 사진으로 넣기 함수를 import', /import\s*\{\s*parseTaxCalcPaste,\s*planTaxCalcPaste,\s*applyTaxCalcPaste,\s*pasteCounts,\s*buildPastePrompt,\s*mergePastePhotos,\s*photoShareData,\s*PASTE_PHOTO_MAX,\s*PASTE_PHOTO_ACCEPT,\s*photoBudget,\s*photoFitSize,\s*PHOTO_TRIES,\s*photoReadInit,\s*photoReadStep,\s*photoErrorText,\s*photoOutcome\s*\}\s*from\s*'\.\.\/taxCalcPaste'/.test(mx));
ok('#S6 부탁 문장 = 종목 이름·코드·올해로 만들고 클립보드 복사(실패하면 직접 복사 칸)', /buildPastePrompt\(\{ name: stock\.name \|\| '', code: stock\.code, year: Number\(getTodayKST\(\)\.slice\(0, 4\)\) \}\)/.test(mx)
  && /navigator\.clipboard\.writeText\(prompt\)/.test(mx) && /promptCopy === 'manual'/.test(mx));
ok('#S7 화면은 AI를 직접 부르지 않는다 — 사진은 /api/tax-photo로만(키는 서버 환경 변수에만)', !/fetch\(/.test(stripComments(mod)) && !/anthropic|openai|generativelanguage|GEMINI_API_KEY|x-goog-api-key/i.test(mx)
  && (mx.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/tax-photo', \{/.test(mx));
ok('#S3 ClipboardPaste 아이콘 import + 사용', /import\s*\{[^}]*\bClipboardPaste\b[^}]*\}\s*from\s*'lucide-react'/.test(mx) && /<ClipboardPaste\b/.test(mx));
ok('#S4 적용은 persistEvents(=updateTaxBaseEvents) 경유 + 전일 수량은 자산검증 조회', /const commitPastePlan = [\s\S]{0,200}persistEvents\(stock\.code, applyTaxCalcPaste\(events, plan,[\s\S]{0,120}lookupPrevQty\(date, stock\.code\)/.test(mx)
  && /const applyPaste = \(stock, events, plan\) => \{\n\s*commitPastePlan\(stock, events, plan\);/.test(mx));
ok('#S5 미리보기는 오늘(KST) 기준 해석', /parseTaxCalcPaste\(pasteText, getTodayKST\(\)\)/.test(mx));
// 사진 고르기 → AI 앱으로 보내기 → AI 답 붙여넣기(휴대폰)
ok('#S8 사진 올리기 = 사진 파일 칸(여러 장) → 고르자마자 읽기(버튼 더 누르지 않음) + 미리보기', /<input type="file" accept=\{PASTE_PHOTO_ACCEPT\} multiple disabled=\{busy\} onChange=\{e => pickAndReadPhotos\(stock, e\)\}/.test(mx)
  && /const pickAndReadPhotos = [\s\S]{0,900}readPhotosAndApply\(stock, photos\.map\(p => p\.file\)\);/.test(mx) && /URL\.createObjectURL\(f\)/.test(mx) && /<img src=\{p\.url\}/.test(mx));
const sendFn = (mx.match(/const sendPhotosToAI = async \(prompt\) => \{[\s\S]*?\n  \};/) || [''])[0];
ok('#S9 ② 공유 창은 누른 순간에 연다 — navigator.share 가 첫 await 보다 앞', /navigator\.share\(share\.data\)/.test(sendFn)
  && sendFn.indexOf('navigator.share(') >= 0 && sendFn.indexOf('navigator.share(') < sendFn.indexOf('await'));
ok('#S10 ③ AI 답은 클립보드에서 바로 칸에(막히면 칸에 초점·직접 붙여넣기 안내)', /navigator\.clipboard\.readText\(\)/.test(mx) && /pasteBoxRef\.current\.focus\(\)/.test(mx) && /ref=\{pasteBoxRef\}/.test(mx));
const readFn = (mx.match(/const readPhotosAndApply = async \(stock, files\) => \{[\s\S]*?\n  \};/) || [''])[0];
ok('#S11 사진은 저장하지 않는다(보내기·읽기에 Drive·FormData 없음) + 닫을 때 읽기를 멈추고 미리보기 주소 돌려줌', sendFn && readFn
  && !/fetch\(|FormData|saveDriveFile|uploadDrive/.test(sendFn) && !/FormData|saveDriveFile|uploadDrive|localStorage|sessionStorage|indexedDB/.test(readFn)
  && /const resetPaste = [\s\S]{0,400}photoAbort\.current\.abort\(\)[\s\S]{0,200}URL\.revokeObjectURL\(p\.url\)/.test(mx));
ok('#S14 끝까지 받은 답만 넣는다 · 넣을 때 그 순간의 이벤트로 다시 계획 · 되돌리기 = 넣기 전 이벤트', readFn
  && /if \(st\.error \|\| !st\.done\) \{[\s\S]{0,160}return;/.test(readFn)
  && readFn.indexOf('!st.done') < readFn.indexOf('commitPastePlan(')
  && /const before = getCodeTaxBase\(portfolioRef\.current, stock\.code\)\.events \|\| \[\];/.test(readFn)
  && /planTaxCalcPaste\(parsed, before\)/.test(readFn) && /undo: kind === 'apply' \? \{ code: stock\.code, prev: before \}/.test(readFn)
  && /const undoPhotoApply = [\s\S]{0,160}persistEvents\(u\.code, u\.prev\)/.test(mx) && /onClick=\{undoPhotoApply\}/.test(mx));
ok('#S15 닫거나 다른 사진을 고르면 앞의 읽기 결과는 버린다(실행 번호)', /const live = \(\) => photoRunId\.current === id;/.test(readFn)
  && (readFn.match(/if \(!live\(\)\) return;/g) || []).length >= 3 && /photoRunId\.current \+= 1;/.test(mx));
const api = stripComments(read('api/tax-photo.ts'));
ok('#S16 서버: 처리부 첫 줄 requireAuth · POST만 · 다른 사이트 거절 · 응답을 바로 흘려보냄(Edge 25초)', /export default async function handler\(request: Request\): Promise<Response> \{\n\s*const denied = await requireAuth\(request\);\n\s*if \(denied\) return denied;/.test(api)
  && /request\.method !== 'POST'/.test(api) && /sfs === 'cross-site'/.test(api) && /send\(\{ s: 1 \}\)/.test(api) && /new Response\(stream,/.test(api));
ok('#S17 서버: 사진·글을 저장하거나 기록하지 않는다(Drive·Redis·console 없음)', !/saveDrive|redis|console\.|kv\.|put\(/i.test(api) && !/console\./.test(stripComments(read('api/_taxPhoto.ts'))));
ok('#S12 열기·닫기·넣기 모두 resetPaste 경유(사진이 다른 종목 패널에 남지 않게)', /onClick=\{\(\) => resetPaste\(pasteFor === stock\.code \? null : stock\.code\)\}/.test(mx)
  && /onClick=\{\(\) => resetPaste\(null\)\}/.test(mx) && /const applyPaste = [\s\S]{0,600}resetPaste\(null\)/.test(mx));
ok('#S13 아이콘 import(ImagePlus·Share2·X) + 사용', /import\s*\{[^}]*\bImagePlus\b[^}]*\bShare2\b[^}]*\bX\b[^}]*\}\s*from\s*'lucide-react'/.test(mx) && /<ImagePlus\b/.test(mx) && /<Share2\b/.test(mx) && /<X\b/.test(mx));

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:tax-paste — ${pass} 통과, ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
