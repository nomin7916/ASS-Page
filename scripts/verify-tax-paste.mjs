#!/usr/bin/env node
// 평균 과표 계산기 '붙여넣기' — src/taxCalcPaste.ts 를 **직접 import**한다(미러 금지).
//   사용자 요청(2026-11-24): 주문내역 사진을 Claude에게 주면 날짜별 매수·매도 수량·평균단가와 그날 과표기준가가 계산기에 들어가게.
//   Claude는 사이트 데이터(Drive 파일)를 직접 고칠 수 없으므로 → Claude가 옮긴 글을 계산기에 붙여넣는다.
// 런타임이 .ts를 못 읽으면 단위 검사만 건너뛰고 소스 가드는 돈다.
import { readFileSync } from 'node:fs';
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

  // #P6 겹치는 행의 빈 단가 채움 · 같은 날 다른 수량은 추가하되 경고
  const plan3 = planTaxCalcPaste(parseTaxCalcPaste('2026-11-10 매도 5주 7,000원 과표 10\n2026-11-10 매수 7주 6,000원', TODAY),
    [{ id: 'x', date: '2026-11-10', change: '-5', sellPrice: '', taxBasePrice: '' }, { id: 'y', date: '2026-11-10', change: '3', purchasePrice: '6000' }]);
  eq('#P6 빈 매도단가·과표 채움 + 수량 다른 매수는 추가(경고)', plan3.map(r => [r.side, r.status, r.patch || null, r.note]), [
    ['buy', 'add', null, '같은 날 수량이 다른 행이 있음 — 겹치지 않는지 확인'],
    ['sell', 'fill', { sellPrice: 7000, taxBasePrice: 10 }, ''],
  ]);

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
}

// ── 소스 가드: 계산기가 이 모듈을 실제로 쓰는가 ──
const mod = read('src/taxCalcPaste.ts');
ok('#S1 taxCalcPaste.ts에 import 0줄(Node가 직접 실행)', !/^\s*import\s/m.test(stripComments(mod)));
const mx = stripComments(read('src/components/KrEtfTaxMatrix.tsx'));
ok('#S2 KrEtfTaxMatrix가 다섯 함수를 import', /import\s*\{\s*parseTaxCalcPaste,\s*planTaxCalcPaste,\s*applyTaxCalcPaste,\s*pasteCounts,\s*buildPastePrompt\s*\}\s*from\s*'\.\.\/taxCalcPaste'/.test(mx));
ok('#S6 부탁 문장 = 종목 이름·코드·올해로 만들고 클립보드 복사(실패하면 직접 복사 칸)', /buildPastePrompt\(\{ name: stock\.name \|\| '', code: stock\.code, year: Number\(getTodayKST\(\)\.slice\(0, 4\)\) \}\)/.test(mx)
  && /navigator\.clipboard\.writeText\(prompt\)/.test(mx) && /promptCopy === 'manual'/.test(mx));
ok('#S7 사이트는 AI를 부르지 않는다(키·요금 0 — 각자 쓰는 AI에 사진을 준다)', !/fetch\(/.test(stripComments(mod)) && !/anthropic|openai|generativelanguage/i.test(mx));
ok('#S3 ClipboardPaste 아이콘 import + 사용', /import\s*\{[^}]*\bClipboardPaste\b[^}]*\}\s*from\s*'lucide-react'/.test(mx) && /<ClipboardPaste\b/.test(mx));
ok('#S4 적용은 persistEvents(=updateTaxBaseEvents) 경유 + 전일 수량은 자산검증 조회', /const applyPaste = [\s\S]{0,200}persistEvents\(stock\.code, applyTaxCalcPaste\(events, plan,[\s\S]{0,120}lookupPrevQty\(date, stock\.code\)/.test(mx));
ok('#S5 미리보기는 오늘(KST) 기준 해석', /parseTaxCalcPaste\(pasteText, getTodayKST\(\)\)/.test(mx));

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:tax-paste — ${pass} 통과, ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
