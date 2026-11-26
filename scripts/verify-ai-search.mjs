#!/usr/bin/env node
// 「AI 검색」 채팅창(사용자 요청 2026-11-26) — src/aiSearch.ts · api/_aiSearch.ts 를 **직접 import**한다(미러 금지).
//   #M = 답 글(마크다운) 조각 · #R = 답 읽기(NDJSON) · #V = 듣기용 문장 조각 · #T = 대화 묶음 저장 모양·한도 · #Q = 보낼 대화·보유 종목
//   #C = 서버 요청 검사·부탁 문장·출처 읽기 · #E = 서버 처리부를 가짜 Gemini로 끝까지 · #S = 배선(소스 가드)
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

const load = async (rel) => {
  try { return await import(pathToFileURL(join(ROOT, rel)).href); }
  catch (e) {
    const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
    if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 ${rel} 단위 검사를 건너뜁니다.`);
    else { fail++; console.log(`  ✗ ${rel} 를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
    return null;
  }
};
const A = await load('src/aiSearch.ts');
const P = await load('api/_aiSearch.ts');

const ANSWER = [
  '## 미국 증시 마감 (2026-11-25 기준)',
  '',
  '- **S&P 500**: 6,812.3 (+0.8%) — 기술주 강세',
  '- 나스닥: 23,100 → 사상 최고',
  '  - 엔비디아 +3.2%',
  '1. 금리 3~5% 구간 https://example.com/a.',
  '',
  '| 지수 | 종가 | 등락 |',
  '|---|---:|---|',
  '| S&P 500 | 6,812 | +0.8% |',
  '| 다우 | 47,000 | -0.1% |',
  '',
  '> 참고: 변동 가능 📈',
  '```',
  'code',
  '```',
  '문단 *기울임* 과 `코드` 그리고 [링크](https://x.com/y).',
].join('\n');

if (A) {
  // #M 마크다운 조각
  const bl = A.mdBlocks(ANSWER);
  eq('#M1 조각 종류 순서', bl.map(b => b.t), ['h', 'list', 'table', 'quote', 'code', 'p']);
  eq('#M1 목록 — 깊이·번호', bl[1].items.map(i => [i.depth, i.n]), [[0, null], [0, null], [1, null], [0, 1]]);
  eq('#M1 표 — 머리줄·구분 줄 뺌', [bl[2].head, bl[2].rows.length, bl[2].rows[1]], [['지수', '종가', '등락'], 2, ['다우', '47,000', '-0.1%']]);
  const inl = A.mdInline('**굵게 [링크](https://x.com/y)** *기울임* `c` https://a.b/c). 5 * 3 * 2');
  eq('#M2 줄 안 — 굵게(안에 링크)·기울임·코드·주소(끝 문장부호 뺌)·곱셈 기호는 글', inl.map(p => p.t), ['b', 'text', 'i', 'text', 'code', 'text', 'a', 'text']);
  eq('#M2 주소 끝 ")." 은 글로 남는다', [inl[6].href, inl[7].v], ['https://a.b/c', '). 5 * 3 * 2']);
  ok('#M3 링크는 http(s)만 — javascript: 는 글', A.mdInline('[x](javascript:alert(1))').every(p => p.t === 'text'));
  // #R 답 읽기
  let st = A.searchReadInit();
  st = A.searchReadStep(st, '{"s":1}\n{"m":"gemini-x"}\n{"t":"안녕"}\n{"k":1}\n{"t":"하세요"}\n{"g":{"sources":[{"uri":"https://a.com/x","title":"a.com"},{"uri":"javascript:x","title":"bad"},{"uri":"https://a.com/x"}],"queries":["q1","q1"],"html":"<div>s</div>"}}\n{"d"');
  eq('#R1 덜 온 끝줄은 다음 조각으로', [st.text, st.done, st.rest], ['안녕하세요', false, '{"d"']);
  st = A.searchReadStep(st, ':1}\n', true);
  eq('#R1 끝까지 · 출처(https만·한 번)·검색어(한 번)·제안', [st.done, st.model, st.ground.sources, st.ground.queries, st.ground.html],
    [true, 'gemini-x', [{ uri: 'https://a.com/x', title: 'a.com' }], ['q1'], '<div>s</div>']);
  const se = A.searchReadStep(A.searchReadInit(), '{"e":"needkey"}\n{"e":"rate"}\n', true);
  eq('#R2 첫 오류만', [se.error, se.done], ['needkey', false]);
  ok('#R3 오류 글 — 키 없음·틀림·한도·끊김·멈춤', ['needkey', 'badkey', 'credit', 'rate', 'cut', 'stop', 'auth', 'net'].every(c => A.searchErrorText(c) !== A.searchErrorText('zzz')));
  // #V 듣기
  const ch = A.speechChunks(ANSWER);
  ok('#V1 읽을 글에 마크다운 기호·주소·이모지·코드가 없다', ch.length > 5 && ch.every(c => !/[*#|`>]|https?:|📈/.test(c)) && !ch.some(c => c.includes('code')));
  ok('#V2 소수점(6,812.3)에서 문장을 자르지 않는다', ch.some(c => c.includes('6,812.3 (+0.8%)')));
  ok('#V3 물결(3~5)은 "3에서 5" · 화살표는 쉼표', ch.some(c => c.includes('3에서 5%')) && ch.some(c => c.includes('23,100, 사상 최고')));
  ok('#V4 표는 줄마다 칸을 쉼표로', ch.includes('다우, 47,000, -0.1%.'));
  const long = A.speechChunks('가'.repeat(50) + ', ' + '나'.repeat(100) + ' ' + '다'.repeat(30) + '.');
  ok('#V5 긴 문장은 120자 안으로 나눈다(쉼표·띄어쓰기에서)', long.length >= 2 && long.every(c => c.length <= 120));
  eq('#V6 읽을 글이 없으면 빈 목록', A.speechChunks('```\nx\n```\nhttps://a.b/c'), []);
  // #Q 보낼 대화·보유 종목
  eq('#Q1 끝까지 받은 답과 질문만 맥락으로', A.requestMessages([
    { role: 'user', text: 'q1' }, { role: 'model', text: 'a1' }, { role: 'user', text: 'q2' }, { role: 'model', text: '부분', err: 'cut' },
    { role: 'user', text: ' ' }, { role: 'model', text: 'x', pending: true }, { role: 'user', text: 'q3' },
  ]), [{ role: 'user', text: 'q1' }, { role: 'model', text: 'a1' }, { role: 'user', text: 'q2' }, { role: 'user', text: 'q3' }]);
  eq('#Q2 보유 종목 = 주식 행·수량>0·이름·코드만·같은 종목 한 번', A.searchHoldings([
    { portfolio: [{ type: 'stock', code: '069500', name: 'KODEX 200', quantity: 3, investAmount: 9 }, { type: 'stock', code: '', name: '현금', isManualCash: true, quantity: 1 }, { type: 'deposit', name: '예수금' }, { type: 'stock', code: '360750', name: 'TIGER 미국S&P500', quantity: 0 }] },
    { portfolio: [{ type: 'stock', code: '069500', name: 'KODEX 200', quantity: 1 }, { type: 'stock', code: 'aapl', name: 'Apple|Inc', quantity: 2 }] },
  ]), [{ code: '069500', name: 'KODEX 200' }, { code: 'AAPL', name: 'Apple Inc' }]);
  // #T 저장 모양·한도
  const now = '2026-11-26T01:00:00.000Z';
  const n1 = A.normalizeSearchStore({ chats: [
    { id: 'c1', title: '', createdAt: now, updatedAt: now, msgs: [{ id: 'u1', role: 'user', text: '오늘 증시', at: now }, { id: 'a1', role: 'model', text: '받는 중', at: now, pending: true, html: '<b>x</b>', sources: [{ uri: 'http://x' }, { uri: 'https://ok' }] }] },
    { id: 'c1', msgs: [{ role: 'user', text: '중복' }] },
    { id: 'bad id!', msgs: [{ role: 'user', text: 'x' }] },
    { id: 'c2', updatedAt: '2026-11-25T00:00:00.000Z', msgs: [{ id: 'u', role: 'user', text: 'q' }, { id: 'e', role: 'model', text: '', err: 'rate', msg: 'm' }, { id: 'z', role: 'model', text: '' }] },
  ], voice: { rate: 9, voiceURI: 'v1' }, holdOn: 1 });
  eq('#T1 틀린 id·중복 뺌 · 최근 순', n1.chats.map(c => c.id), ['c1', 'c2']);
  const m1 = n1.chats[0].msgs[1];
  eq('#T1 받는 중이던 답 = 끊김 · 검색 제안(html) 저장 안 함 · https 출처만', [m1.err, 'pending' in m1, 'html' in m1, m1.sources], ['cut', false, false, [{ uri: 'https://ok', title: '' }]]);
  eq('#T1 빈 제목 = 첫 질문 · 오류 답은 남고 빈 답은 뺌', [n1.chats[0].title, n1.chats[1].msgs.map(m => m.id)], ['오늘 증시', ['u', 'e']]);
  eq('#T1 듣기 빠르기는 고른 값만(틀리면 1) · 보유 종목 켬', [n1.voice, n1.holdOn], [{ rate: 1, voiceURI: 'v1' }, true]);
  const mk = (i, pinned = false, size = 10) => ({ id: `k${i}`, pinned, updatedAt: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}.000Z`, msgs: [{ id: `u${i}`, role: 'user', text: 'x'.repeat(size) }] });
  const many = A.normalizeSearchStore({ chats: [mk(0, true), ...Array.from({ length: 70 }, (_, i) => mk(i + 1))] });
  ok(`#T2 대화 ${A.CHATS_MAX}개까지 · 오래된 것부터 빼고 고정한 자료(가장 오래됨)는 남긴다`, many.chats.length === A.CHATS_MAX && many.chats.some(c => c.id === 'k0'));
  const big = A.trimSearchStore({ chats: Array.from({ length: 20 }, (_, i) => mk(i, false, 100_000)) });
  ok('#T3 전체 글자 한도 — 넘치면 오래된 것부터', JSON.stringify(big.chats).length <= A.STORE_CHARS_MAX && big.chats.length >= 1 && big.chats.length < 20);
  const longChat = A.normalizeSearchStore({ chats: [{ id: 'L', msgs: Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'model' : 'user', text: `t${i}` })) }] });
  eq(`#T4 한 대화 ${A.MSGS_MAX}개(최근)까지`, [longChat.chats[0].msgs.length, longChat.chats[0].msgs[0].text], [A.MSGS_MAX, 't20']);
  const md = A.chatToMarkdown({ title: '증시', msgs: [{ role: 'user', text: '질문', at: now }, { role: 'model', text: '답', at: now, sources: [{ uri: 'https://s', title: 's.com' }] }] });
  ok('#T5 내보내기 글 — 제목·질문·답·출처', md.startsWith('# 증시') && md.includes('## 질문') && md.includes('## 답') && md.includes('- [s.com](https://s)'));
  eq('#T5 파일 이름(쓸 수 없는 글자 뺌 · 한국 날짜)', A.chatFileName({ title: 'a/b: c?', updatedAt: '2026-11-25T20:00:00.000Z' }), 'a_b_c_2026-11-26.md');
  ok('#T6 찾기 — 제목·내용', A.chatMatches({ title: '금리', msgs: [] }, '금') && A.chatMatches({ title: 'x', msgs: [{ text: '배당' }] }, '배당') && !A.chatMatches({ title: 'x', msgs: [] }, 'y'));
}

if (P) {
  // #C 서버 요청 검사
  const r1 = P.checkSearchReq({ messages: [
    { role: 'model', text: '앞 답(첫 줄은 질문이어야 함)' }, { role: 'user', text: 'q1' }, { role: 'user', text: 'q1b' }, { role: 'model', text: 'a1' }, { role: 'x', text: 'y' }, { role: 'user', text: ' q2 ' },
  ], holdings: [{ code: '069500', name: 'KODEX|200' }, { code: '!!', name: 'x' }, { code: '', name: '' }] });
  eq('#C1 첫 줄 질문부터 · 같은 쪽 이어지면 합침 · 틀린 역할 뺌 · 다듬기', r1.messages, [{ role: 'user', text: 'q1\n\nq1b' }, { role: 'model', text: 'a1' }, { role: 'user', text: 'q2' }]);
  eq('#C1 보유 종목 다듬기', r1.holdings, [{ code: '069500', name: 'KODEX 200' }]);
  eq('#C2 거절 — 질문 없음·마지막이 답', [P.checkSearchReq({ messages: [] }).error, P.checkSearchReq({ messages: [{ role: 'user', text: 'q' }, { role: 'model', text: 'a' }] }).error, P.checkSearchReq(null).error],
    ['질문이 없습니다', '질문이 없습니다', '요청 형식이 틀렸습니다']);
  const longHist = P.checkSearchReq({ messages: Array.from({ length: 41 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 'z'.repeat(9000) })) });
  ok('#C3 앞 대화는 뒤에서부터 한도 안만 · 첫 줄은 질문', longHist.messages.length <= P.SEARCH_TURNS_MAX && longHist.messages[0].role === 'user'
    && longHist.messages.reduce((s, m) => s + m.text.length, 0) <= P.SEARCH_HIST_MAX && longHist.messages.every(m => m.text.length <= (m.role === 'user' ? P.SEARCH_Q_MAX : P.SEARCH_A_KEEP)));
  eq('#C4 한국 날짜(서버가 정함)', [P.kstDate(Date.parse('2026-11-25T15:30:00Z')), P.kstDate(Date.parse('2026-11-25T14:59:00Z'))], ['2026-11-26', '2026-11-25']);
  const sys = P.buildSearchSystem({ today: '2026-11-26', holdings: [{ code: '069500', name: 'KODEX 200' }] });
  ok('#C5 부탁 문장 — 오늘 날짜·구글 검색·지어내지 말 것·기준 날짜·높임말·출처 목록 쓰지 말 것·권유 아님·보유 종목(수량·금액 없음)',
    sys.includes('오늘은 2026-11-26') && sys.includes('구글 검색') && sys.includes('지어내지 마세요') && sys.includes('언제 기준인지') && sys.includes('높임말')
    && sys.includes('출처 목록') && sys.includes('투자 권유가 아니라') && sys.includes('069500 KODEX 200') && sys.includes('수량·금액은 알려 주지 않았습니다'));
  ok('#C5 보유 종목이 없으면 목록 절이 없다', !P.buildSearchSystem({ today: 'd', holdings: [] }).includes('[사용자의 보유 종목]'));
  const gb = JSON.parse(P.searchGeminiBody(r1, '2026-11-26'));
  ok('#C6 Gemini 본문 = 구글 검색 도구 · 시스템 문장 · 대화 그대로', JSON.stringify(gb.tools) === '[{"google_search":{}}]' && gb.system_instruction.parts[0].text.includes('2026-11-26')
    && gb.contents.length === 3 && gb.contents[0].role === 'user' && gb.contents[1].role === 'model' && gb.contents[2].parts[0].text === 'q2');
  // 출처 읽기(카멜·스네이크)
  const ev = (o) => `data: ${JSON.stringify(o)}\n`;
  const s1 = P.sseSearch(ev({ candidates: [{ content: { parts: [{ text: '생각', thought: true }, { text: '답1' }] } }] })
    + ev({ candidates: [{ content: { parts: [{ text: '답2' }] }, groundingMetadata: { webSearchQueries: ['q'], searchEntryPoint: { renderedContent: '<p>s</p>' }, groundingChunks: [{ web: { uri: 'https://r/1', title: 'a.com' } }, { web: { uri: 'ftp://x' } }] } }] })
    + 'data: {"cand', P.emptyGround());
  eq('#C7 생각 조각 뺌 · 출처·검색어·제안 · 덜 온 줄은 rest', [s1.texts, s1.ground.sources, s1.ground.queries, s1.ground.html, s1.rest],
    [['답1', '답2'], [{ uri: 'https://r/1', title: 'a.com' }], ['q'], '<p>s</p>', 'data: {"cand']);
  const s2 = P.sseSearch(ev({ candidates: [{ content: { parts: [] }, grounding_metadata: { web_search_queries: ['q', 'q2'], grounding_chunks: [{ web: { uri: 'https://r/1' } }, { web: { uri: 'https://r/2', title: 'b' } }] } }] }), s1.ground);
  eq('#C7 스네이크 이름도 · 앞 조각과 합침(같은 출처 한 번)', [s2.ground.sources.map(s => s.uri), s2.ground.queries], [['https://r/1', 'https://r/2'], ['q', 'q2']]);
  eq('#C8 막힘', P.sseSearch(ev({ promptFeedback: { blockReason: 'SAFETY' } }), P.emptyGround()).block, 'SAFETY');
}

// #E 서버 처리부를 끝까지 — 로그인 확인·관리자 판별은 바꿔 끼우고 가짜 Gemini로
if (A && P) {
  const dir = mkdtempSync(join(tmpdir(), 'aisearch-'));
  let handler = null;
  try {
    const src = read('api/ai-search.ts')
      .replace("import { requireAuth, callerEmail, ADMIN_EMAIL } from './_auth.js';",
        "const requireAuth = async (r) => (r.headers.get('x-test-deny') ? new Response('no', { status: 401 }) : null); const callerEmail = async (r) => r.headers.get('x-test-email') || ''; const ADMIN_EMAIL = 'Admin@Test';")
      .replace("from './_taxPhoto.js';", `from ${JSON.stringify(pathToFileURL(join(ROOT, 'api/_taxPhoto.ts')).href)};`)
      .replace("from './_holdingsPhoto.js';", `from ${JSON.stringify(pathToFileURL(join(ROOT, 'api/_holdingsPhoto.ts')).href)};`)
      .replace("from './_aiSearch.js';", `from ${JSON.stringify(pathToFileURL(join(ROOT, 'api/_aiSearch.ts')).href)};`);
    ok('#E0 처리부 시험본을 만들었다(import 네 줄 바꿔 끼움)', !/_auth\.js|'\.\/_taxPhoto\.js'|'\.\/_holdingsPhoto\.js'|'\.\/_aiSearch\.js'/.test(src));
    writeFileSync(join(dir, 'h.ts'), src);
    handler = (await import(pathToFileURL(join(dir, 'h.ts')).href)).default;
  } catch (e) { fail++; console.log(`  ✗ #E0 처리부를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
  if (handler) {
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
      const res = await handler(new Request('https://site.example/api/ai-search', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
      if (!(res.headers.get('content-type') || '').includes('ndjson')) return { status: res.status, json: await res.json().catch(() => null) };
      let st = A.searchReadInit();
      const reader = res.body.getReader(); const dec = new TextDecoder();
      for (;;) { const { value, done } = await reader.read(); if (done) break; st = A.searchReadStep(st, dec.decode(value, { stream: true })); }
      return { status: res.status, st: A.searchReadStep(st, '', true) };
    };
    const body = { messages: [{ role: 'user', text: '오늘 코스피 마감' }], holdings: [{ code: '069500', name: 'KODEX 200' }] };
    const UK = 'AIzaSyUSERKEY_1234567890abcdefghijklmn';
    const env0 = { ...process.env };
    const grounded = { status: 200, chunks: [
      ev({ candidates: [{ content: { parts: [{ text: '코스피는 ' }] } }] }),
      ev({ candidates: [{ content: { parts: [{ text: '2,600입니다.' }] }, finishReason: 'STOP', groundingMetadata: { webSearchQueries: ['코스피 마감'], searchEntryPoint: { renderedContent: '<div>chips</div>' }, groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'yna.co.kr' } }] } }] }),
    ] };
    try {
      process.env.GEMINI_API_KEY = 's1';
      process.env.GEMINI_API_KEY2 = 's2';
      for (let i = 3; i <= 9; i++) delete process.env['GEMINI_API_KEY' + i];
      calls.length = 0;
      const r0 = await call(body, { 'x-test-email': 'user@x' });
      eq('#E1 다른 사용자 · 내 키 없음 → needkey(사이트 키로 Gemini를 부르지 않음)', [r0.status, r0.st.error, calls.length], [200, 'needkey', 0]);
      calls.length = 0;
      script = [grounded];
      const r1 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E2 다른 사용자 · 내 키로만 · 답 끝까지 · 출처·검색어·제안', [r1.st.done, r1.st.error, r1.st.text, calls.map(c => c.key), r1.st.ground && r1.st.ground.sources[0].title, r1.st.ground && r1.st.ground.queries, r1.st.ground && r1.st.ground.html],
        [true, '', '코스피는 2,600입니다.', [UK], 'yna.co.kr', ['코스피 마감'], '<div>chips</div>']);
      const sent = JSON.parse(calls[0].body);
      ok('#E2 Gemini로 간 본문 = 구글 검색 도구 + 서버가 만든 부탁 문장(오늘 한국 날짜·보유 종목)', JSON.stringify(sent.tools) === '[{"google_search":{}}]'
        && sent.system_instruction.parts[0].text.includes(`오늘은 ${P.kstDate(Date.now())}`) && sent.system_instruction.parts[0].text.includes('069500 KODEX 200')
        && sent.contents.length === 1 && sent.contents[0].parts[0].text === '오늘 코스피 마감');
      calls.length = 0;
      script = [grounded];
      const r2 = await call(body, { 'x-test-email': 'admin@test' });
      eq('#E3 관리자 · 내 키 없음 → 사이트 키(대소문자 무시)', [r2.st.done, calls.map(c => c.key)], [true, ['s1']]);
      calls.length = 0;
      script = [{ status: 400, body: '{"error":{"message":"Search Grounding is not supported."}}' }, grounded];
      const r3 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E4 이 모델이 검색 연결을 못 함(400, 키 문제 아님) → 다음 모델로', [r3.st.done, calls.map(c => c.model)], [true, [P && 'gemini-flash-latest', 'gemini-2.5-flash']]);
      calls.length = 0;
      script = [{ status: 400, body: '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}' }];
      const r4 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E5 틀린 키 → badkey(다른 모델로 되풀이하지 않음)', [r4.st.error, r4.st.done, calls.length], ['badkey', false, 1]);
      calls.length = 0;
      script = [{ status: 429, body: 'q' }, { status: 429, body: 'q' }, { status: 429, body: 'q' }];
      const r5 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E6 내 키 한도 → 모델마다 한 번씩 물어본 뒤 rate', [r5.st.error, calls.length], ['rate', 3]);
      calls.length = 0;
      script = [{ status: 200, chunks: [ev({ promptFeedback: { blockReason: 'SAFETY' } })] }];
      const r6 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E7 막힘 → block', [r6.st.error, r6.st.text], ['block', '']);
      delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY2;
      calls.length = 0;
      const r7 = await call(body, { 'x-test-email': 'admin@test' });
      eq('#E8 관리자 · 사이트 키도 내 키도 없음 → nokey', [r7.st.error, calls.length], ['nokey', 0]);
      const r8 = await call({ messages: [] }, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E9 요청 검사 실패 → 400 JSON', [r8.status, r8.json && r8.json.error], [400, '질문이 없습니다']);
      const r9 = await call(body, { 'x-test-deny': '1' });
      eq('#E10 로그인 확인 실패 → 그대로 401', r9.status, 401);
      const r10 = await handler(new Request('https://site.example/api/ai-search', { method: 'GET' }));
      eq('#E11 GET → 405', r10.status, 405);
      // 2026-11-26 사용자 신고: 내 키의 선불 크레딧 소진(402)인데 다른 키로 넘어가지 않고 원문 JSON만 보였다
      const PAY = '{ "error": { "code": 402, "message": "Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.", "status": "RESOURCE_EXHAUSTED" } }';
      process.env.GEMINI_API_KEY = 's1';
      calls.length = 0;
      script = [{ status: 402, body: PAY }, grounded];
      const r11 = await call(body, { 'x-test-email': 'admin@test', 'X-Gemini-Key': UK });
      eq('#E12 관리자 · 내 키 선불 크레딧 소진(402) → 같은 모델로 사이트 키에 넘어가 답', [r11.st.done, r11.st.error, calls.map(c => c.key), calls.map(c => c.model)],
        [true, '', [UK, 's1'], ['gemini-flash-latest', 'gemini-flash-latest']]);
      calls.length = 0;
      script = [{ status: 402, body: PAY }];
      const r12 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E13 다른 사용자 · 내 키 402 → credit(다른 모델로 되풀이하지 않음) · 키별 까닭 한 줄', [r12.st.error, calls.length, r12.st.msg],
        ['credit', 1, '내 키: 선불 충전금 0원(402)']);
      calls.length = 0;
      script = [{ status: 402, body: PAY }, { status: 400, body: '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}' }];
      const r13 = await call(body, { 'x-test-email': 'admin@test', 'X-Gemini-Key': UK });
      eq('#E14 관리자 · 내 키 402 + 사이트 키 틀림 → credit(키마다 한 번씩만)', [r13.st.error, calls.length], ['credit', 2]);
      calls.length = 0;
      script = [{ status: 402, body: PAY }, { status: 429, body: 'q' }, { status: 429, body: 'q' }, { status: 429, body: 'q' }];
      const r14 = await call(body, { 'x-test-email': 'admin@test', 'X-Gemini-Key': UK });
      eq('#E15 관리자 · 내 키 402 + 사이트 키 한도 → 사이트 키로만 모델마다 물어본 뒤 credit(고칠 곳은 내 키) · 둘 다 까닭', [r14.st.error, calls.map(c => c.key), r14.st.msg],
        ['credit', [UK, 's1', 's1', 's1'], '내 키: 선불 충전금 0원(402) · 사이트 키 1: 사용 한도 초과(429)']);
      // 2026-11-26 사용자 신고 둘째: 429 본문이 길어 600자에서 잘려 JSON을 못 읽고 원문만 보였다 — 끝까지 읽어 하루·1분·한도 0을 가린다
      const q429 = (id, value, model, retry) => JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. ', status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.Help', links: [{ description: 'Learn more about Gemini API quotas', url: 'https://ai.google.dev/gemini-api/docs/rate-limits' }] },
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: id, quotaDimensions: { location: 'global', model }, quotaValue: value }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] } }, null, 2);
      ok('#E16 시험용 429 본문은 600자를 넘는다(전에는 잘려 깨졌다)', q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '20', 'gemini-2.5-flash', '41s').length > 600);
      calls.length = 0;
      script = [{ status: 429, body: q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '20', 'gemini-3-flash', '41s') },
        { status: 429, body: q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '20', 'gemini-2.5-flash', '41s') },
        { status: 429, body: q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '20', 'gemini-2.5-flash-lite', '41s') }];
      const r15 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E16 하루 한도 → rate · 기다리지 않음 · 몇 회·어느 모델인지', [r15.st.error, calls.length, r15.st.msg], ['rate', 3, '내 키: 하루 한도 20회 다 씀 · gemini-3-flash']);
      calls.length = 0;
      script = [{ status: 429, body: q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5', 'gemini-3-flash', '0.2s') }, grounded];
      const t0 = Date.now();
      const r16 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E17 1분 한도(짧게 기다리면 됨) → 한 번 기다렸다 같은 키·같은 모델로 다시 → 답', [r16.st.done, r16.st.error, calls.map(c => c.model)], [true, '', ['gemini-flash-latest', 'gemini-flash-latest']]);
      ok('#E17 기다린 시간 ≥ 알려 준 시간', Date.now() - t0 >= 200);
      calls.length = 0;
      script = [{ status: 429, body: q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5', 'gemini-3-flash', '0.1s') },
        { status: 429, body: q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5', 'gemini-3-flash', '0.1s') },
        { status: 429, body: q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5', 'gemini-2.5-flash', '0.1s') },
        { status: 429, body: q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5', 'gemini-2.5-flash-lite', '0.1s') }];
      const r17 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E18 1분 한도만 계속 → 한 번만 기다리고 rate1m', [r17.st.error, calls.length], ['rate1m', 4]);
      calls.length = 0;
      script = [{ status: 429, body: q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '0', 'gemini-3-flash', '0s') },
        { status: 429, body: q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '0', 'gemini-2.5-flash', '0s') },
        { status: 429, body: q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '0', 'gemini-2.5-flash-lite', '0s') }];
      const r18 = await call(body, { 'x-test-email': 'user@x', 'X-Gemini-Key': UK });
      eq('#E19 무료 등급 한도 0 → quota0', [r18.st.error, r18.st.msg], ['quota0', '내 키: 무료 등급에서 못 씀(한도 0 · gemini-3-flash)']);
      ok('#E19 화면 글 — rate1m·quota0·credit은 서로 다르고 고칠 길을 말한다', A.searchErrorText('rate1m') !== A.searchErrorText('zzz') && /결제/.test(A.searchErrorText('quota0')) && /\$5/.test(A.searchErrorText('credit')) && /AI Pro/.test(A.searchErrorText('credit')));
      delete process.env.GEMINI_API_KEY;
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
const chat = stripComments(read('src/components/AiSearchChat.tsx'));
const bar = stripComments(read('src/components/UserInfoBar.tsx'));
const sp = stripComments(read('src/hooks/useSpeech.ts'));
const ds = stripComments(read('src/driveStorage.ts'));
const srv = stripComments(read('api/ai-search.ts'));
const lib = stripComments(read('src/aiSearch.ts'));

ok('#S1 App — 늘 떠 있는 창: lazyScreen(inApp) + 쓰는 자리 전부 <KeepAfterOpen open={showAiSearch}><Suspense fallback={<WindowLoading />}> 안 · 정적 import 없음',
  /const AiSearchChat = lazyScreen\(\(\) => import\('\.\/components\/AiSearchChat'\), \{ inApp: true \}\);/.test(app) && !/^import\s+AiSearchChat\s+from/m.test(app)
  && (app.match(/<AiSearchChat\b/g) || []).length === 1
  && /<ErrorBoundary label="AI 검색">\s*\{!aiWinLive && <KeepAfterOpen open=\{showAiSearch\}>\s*<Suspense fallback=\{<WindowLoading \/>\}>\s*<AiSearchChat\b/.test(app));
ok('#S2 App — 창에 키·대화 저장·관리자 접속 여부·계좌를 넘긴다(계좌는 ref를 읽는 함수 — 다시 그리기를 부르지 않게)',
  /<AiSearchChat[\s\S]*?keyApi=\{geminiKeyApi\}[\s\S]*?storeApi=\{aiSearchStoreApi\}[\s\S]*?viewingAs=\{!!ADMIN_VIEW_EMAIL \|\| !!adminViewingAs\}[\s\S]*?getPortfolios=\{getSearchPortfolios\}/.test(app)
  && /const getSearchPortfolios = useCallback\(\(\) => portfoliosRef\.current, \[\]\);/.test(app));
const storeApi = app.slice(app.indexOf('const aiSearchStoreApi = useMemo('), app.indexOf('}), []);', app.indexOf('const aiSearchStoreApi = useMemo(')));
ok('#S3 대화 = 내 Drive ai_search_chats.json(saveDriveFile만 · 버전 백업·브라우저 저장소 금지 · 관리자 접속 중 읽기/쓰기 안 함)',
  storeApi.length > 200 && /saveDriveFile\(token, folderId, DRIVE_FILES\.AI_SEARCH, data\)/.test(storeApi) && /loadDriveFile\(token, folderId, DRIVE_FILES\.AI_SEARCH\)/.test(storeApi)
  && !/saveVersionedBackup|localStorage|sessionStorage/.test(storeApi) && (storeApi.match(/adminViewingAsRef\.current \|\| ADMIN_VIEW_EMAIL/g) || []).length === 2
  && /AI_SEARCH:\s*'ai_search_chats\.json'/.test(ds));
ok('#S4 읽기 실패 = 저장 금지(빈 목록으로 덮어 지난 대화를 지우지 않게) — 읽기 catch는 canSave: false',
  /catch \(err\) \{\s*return \{ data: null, canSave: false,/.test(storeApi) && /const doSave = \(\) => \{\s*if \(!storeApi \|\| !loadInfoRef\.current\.canSave\) return;/.test(chat)
  && /const scheduleSave = \(\) => \{\s*if \(!storeApi \|\| !loadInfoRef\.current\.canSave\) return;/.test(chat));
ok('#S5 미리 받기 목록에 창이 있다(맨 끝 — 앞 순서는 verify:split #W4)', /admin && AdminPortal,\s*AiSearchChat,\s*\]\.filter\(Boolean\)/.test(app));
// 2026-11-26 사용자 요청 "팝업 말고 별도 브라우저로" — 단추는 별도 창(openAiSearchWindow)을 열고, 막히거나 좁은 화면만 앱 안 창(verify:pc-ask #W1~3).
ok('#S6 상단 막대 — AI 검색 버튼(인라인 아이콘) · App이 연다(별도 창 · 막히면 앱 안 창)', /\{onToggleAiSearch && \(\s*<button\s*onClick=\{onToggleAiSearch\}/.test(bar) && /const AiSearchIcon = /.test(bar)
  && /onToggleAiSearch=\{openAiSearchWindow\}/.test(app) && /const \[showAiSearch, setShowAiSearch\] = useState\(false\);/.test(app));
ok('#S7 화면은 같은 출처의 /api/ai-search(Gemini 검색)·/api/ai-chat(다른 AI — verify:ai-chat)·/api/pc-ask(내 PC 우편함 — verify:pc-ask)만 부른다(AI 회사를 직접 부르지 않음) · 내 Gemini 키는 X-Gemini-Key 헤더로만',
  (chat.match(/fetch\(/g) || []).length === 3 && /fetch\('\/api\/pc-ask',/.test(chat) && /fetch\(pickP \? '\/api\/ai-chat' : '\/api\/ai-search',/.test(chat) && /fetch\('\/api\/ai-chat',/.test(chat) && !/generativelanguage|https?:\/\/api\./.test(chat)
  && /else if \(keyRef\.current && !viewingAs\) headers\['X-Gemini-Key'\] = keyRef\.current;/.test(chat) && /let body = \{ messages: sendMsgs, holdings \};/.test(chat) && /body: JSON\.stringify\(body\)/.test(chat));
ok('#S8 답 글은 React 요소로만(innerHTML 금지) · 검색 제안은 스크립트·같은 출처 없는 격리 틀', !/dangerouslySetInnerHTML|innerHTML/.test(chat)
  && /sandbox="allow-popups allow-popups-to-escape-sandbox"/.test(chat) && !/allow-scripts|allow-same-origin/.test(chat));
ok('#S9 보유 종목은 켰을 때만 · 이름·코드만(searchHoldings)', /const holdings = s\.holdOn && getPortfolios \? searchHoldings\(getPortfolios\(\)\) : \[\];/.test(chat));
ok('#S10 듣기 — speechChunks로 나눠 읽고, 창이 닫히면 멈춘다', /import \{ speechChunks \} from '\.\.\/aiSearch';/.test(sp) && /const chunks = speechChunks\(text\);/.test(sp)
  && /useEffect\(\(\) => \{ if \(!open\) \{ speech\.stop\(\); setMini\(false\); \} \}, \[open\]\);/.test(chat) && /import \{ useSpeech \} from '\.\.\/hooks\/useSpeech';/.test(chat));
ok('#S11 서버 — 처리부 첫 줄 requireAuth · 관리자 판별은 로그인 토큰의 이메일 · 내 키는 헤더에서만 · 키 없음 갈래',
  /export default async function handler\(request: Request\): Promise<Response> \{\s*const denied = await requireAuth\(request\);\s*if \(denied\) return denied;/.test(srv)
  && /const isAdmin = \(await callerEmail\(request\)\)\.toLowerCase\(\) === ADMIN_EMAIL\.toLowerCase\(\);/.test(srv)
  && /userGeminiKey\(request\.headers\.get\(USER_KEY_HEADER\)\)/.test(srv) && /send\(\{ e: isAdmin \? 'nokey' : 'needkey' \}\)/.test(srv));
ok('#S12 api 상대 import는 .js 확장자(Vercel ESM)', [...srv.matchAll(/from '(\.\/[^']+)'/g)].every(m => m[1].endsWith('.js')));
ok('#S13 src/aiSearch.ts·api/_aiSearch.ts — import 0 · 뒤보기 정규식 없음(옛 사파리 멈춤)', !/^\s*import\s/m.test(lib) && !/^\s*import\s/m.test(stripComments(read('api/_aiSearch.ts')))
  && !/\(\?<[=!]/.test(lib));
const usedIcons = (chat.match(/import \{([^}]*)\} from 'lucide-react'/) || ['', ''])[1].split(',').map(s => s.trim()).filter(Boolean);
const known = new Set();
for (const f of ['src/components/HoldingsPhotoSync.tsx', 'src/components/WatchlistPopup.tsx', 'src/components/CalendarModal.tsx', 'src/components/StockChartWindow.tsx', 'src/components/FlowBoard.tsx', 'src/components/PortfolioTable.tsx', 'src/components/AdminPage.tsx', 'src/components/LedgerPage.tsx', 'src/components/DriveBackupModal.tsx', 'src/components/KrEtfTaxMatrix.tsx', 'src/components/RebalancingPanel.tsx', 'src/components/IntegratedDashboard.tsx']) {
  try { for (const m of stripComments(read(f)).matchAll(/import \{([^}]*)\} from 'lucide-react'/g)) for (const n of m[1].split(',')) known.add(n.trim()); } catch { /* 없는 파일 */ }
}
ok(`#S14 창의 lucide 아이콘은 다른 화면이 이미 쓰는 것만(0.577.0에 있는지 확인할 수 없다) — ${usedIcons.filter(n => !known.has(n)).join(',') || '모두 확인'}`, usedIcons.length > 0 && usedIcons.every(n => known.has(n)));

console.log(`\nverify:ai-search — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
