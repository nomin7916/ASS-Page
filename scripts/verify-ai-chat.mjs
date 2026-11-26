#!/usr/bin/env node
// 「AI 검색」 채팅창의 여러 AI 연결(사용자 요청 2026-11-26: "재미나이든, 그록이든, 젠스파크, 클로드 … 각 사용자가 개인 계정으로 · 무료 모델 · 구독 모델 · API가 아니어도")
// src/aiProviders.ts · api/_aiChat.ts 를 **직접 import**한다(미러 금지).
//   #P = 회사 표·키·고른 AI·모델 고르기 · #H = 내 구독으로 묻기(넘길 글·주소·붙여넣기) · #C = 서버 요청 검사·보낼 본문·답 읽기·실패 가리기
//   #E = 서버 처리부를 가짜 회사 서버로 끝까지 · #S = 배선(소스 가드)
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
const V = await load('src/aiProviders.ts');
const C = await load('api/_aiChat.ts');
const A = await load('src/aiSearch.ts');

// 보낼 수 있는 곳(회사 API 주소) — 표가 바뀌면 여기도 함께 고친다(사람이 한 번 더 보게).
const HOSTS = ['openrouter.ai', 'api.groq.com', 'models.github.ai', 'api.cerebras.ai', 'api.mistral.ai', 'api.poe.com', 'api.anthropic.com', 'api.openai.com', 'api.x.ai', 'api.deepseek.com'];

if (V && C) {
  // ── #P 회사 표·키·고른 AI ──
  const ids = V.AI_PROVIDERS.map(p => p.id);
  eq('#P1 화면의 회사 표와 서버의 표는 같은 회사들이다', [...ids].sort(), Object.keys(C.CHAT_PROVIDERS).sort());
  ok('#P2 회사 10곳 · id 겹침 없음 · 무료가 먼저', ids.length === 10 && new Set(ids).size === 10 && V.AI_PROVIDERS[0].cost === 'free' && V.AI_PROVIDERS.filter(p => p.cost === 'free').length >= 4);
  ok('#P3 키 만드는 곳은 https · 기본 모델은 모델 이름 모양 · 권하는 차례는 정규식으로 읽힌다',
    V.AI_PROVIDERS.every(p => /^https:\/\/[a-z0-9.-]+\//.test(p.keyPage) && V.looksLikeModelId(p.model) && p.prefer.every(s => { try { new RegExp(s); return true; } catch { return false; } })));
  ok('#P4 웹 검색 표시 = 서버가 할 수 있는 회사와 같다', V.AI_PROVIDERS.every(p => !!p.web === !!C.CHAT_PROVIDERS[p.id].web));
  eq('#P5 서버가 보내는 곳 = 정해 둔 회사 주소뿐(https)', [...new Set(Object.values(C.CHAT_PROVIDERS).flatMap(p => [p.chat, p.models]).map(u => { const x = new URL(u); return x.protocol === 'https:' ? x.hostname : 'http!'; }))].sort(), [...HOSTS].sort());
  eq('#P6 키 모양 — 빈칸·한글·짧은 글은 키가 아니다', ['gsk_abcdefghijklmnop1234', 'sk-or-v1-0123456789abcdef', 'short', '키입니다 키입니다 키입니다', 'a b c d e f g h i j k l m n o p'].map(V.looksLikeAiKey), [true, true, false, false, false]);
  ok('#P7 다른 회사 키 같으면 알려 준다(막지는 않는다)', /Gemini 키/.test(V.aiKeyWarning('groq', 'AIzaSyABCDEFGHIJKLMNOP')) && /gsk_/.test(V.aiKeyWarning('groq', 'sk-or-v1-abcdefghijklmnop')) && V.aiKeyWarning('groq', 'gsk_abcdefghijklmnop') === '' && V.aiKeyWarning('mistral', 'anything-goes-here-1234') === '');
  eq('#P8 저장할 키 — 아는 회사 · 키 모양만', V.normalizeAiKeys({ groq: ' gsk_abcdefghijklmnop1234 ', evil: 'sk-zzzzzzzzzzzzzzzzzzzz', openai: 'no', xai: 42, __proto__: { poe: 'x' } }), { groq: 'gsk_abcdefghijklmnop1234' });
  eq('#P9 키 가리기', [V.maskAiKey('gsk_abcdefghijklmnop1234'), V.maskAiKey('short')], ['gsk_ab…1234', '']);
  const pf0 = V.aiPrefsOf(null);
  eq('#P10 처음 = Gemini 검색 · Claude 는 웹 검색 켬 · OpenRouter 는 끔(유료)', [pf0.pick, pf0.web.anthropic, pf0.web.openrouter, pf0.ctx, Object.keys(pf0.models).length], ['gemini', true, false, false, 0]);
  const pf1 = V.aiPrefsOf({ pick: 'groq', models: { groq: 'llama-3.3-70b-versatile', evil: 'x', openai: 'bad model name' }, web: { openrouter: true, groq: true }, ctx: 1 });
  eq('#P11 고른 AI — 아는 회사 · 모델 이름 모양만', [pf1.pick, pf1.models, pf1.web.openrouter, 'groq' in pf1.web, pf1.ctx], ['groq', { groq: 'llama-3.3-70b-versatile' }, true, false, true]);
  eq('#P12 모르는 회사를 골라 두었으면 Gemini 로', V.aiPrefsOf({ pick: 'evil' }).pick, 'gemini');
  const list = V.cleanModels([{ id: 'meta/llama:free', name: 'Llama', free: true }, { id: 'openai/gpt-4.1-mini' }, { id: 'bad id' }, { id: 'openai/gpt-4.1-mini' }, null]);
  eq('#P13 모델 목록 다듬기 — 이름 모양 · 겹침 없음', list.map(m => [m.id, m.free]), [['meta/llama:free', true], ['openai/gpt-4.1-mini', false]]);
  eq('#P14 모델 고르기 — 지금 것이 있으면 그대로 · 없으면 권하는 차례 · 그다음 무료 · 그다음 첫째',
    [V.pickModel('github', list, 'meta/llama:free'), V.pickModel('github', list, 'gone'), V.pickModel('openrouter', list, 'gone'), V.pickModel('xai', list, 'gone'), V.pickModel('xai', [{ id: 'z', name: '', free: false }], 'gone'), V.pickModel('xai', [], 'keep')],
    ['meta/llama:free', 'openai/gpt-4.1-mini', 'meta/llama:free', 'meta/llama:free', 'z', 'keep']);
  ok('#P15 오류 글 — 회사 이름이 들어가고 고칠 길을 말한다', /Groq 키가 필요/.test(V.aiErrorText('needkey', 'Groq')) && /내 구독으로 묻기/.test(V.aiErrorText('needkey', 'Groq')) && /충전/.test(V.aiErrorText('credit', 'Claude')) && /모델 불러오기/.test(V.aiErrorText('nomodel', 'Poe')) && /다른 AI/.test(V.aiErrorText('zzz', 'Poe')));

  // ── #H 내 구독으로 묻기 ──
  ok('#H1 넘길 곳 — ChatGPT·Claude·Gemini·Grok·Perplexity·Genspark·Copilot 포함 · 모두 https · id 겹침 없음',
    ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'genspark', 'copilot'].every(id => !!V.aiHandById(id)) && V.AI_HANDS.every(h => /^https:\/\/[a-z0-9.-]+\//.test(h.open)) && new Set(V.AI_HANDS.map(h => h.id)).size === V.AI_HANDS.length);
  const pr = V.handPrompt({ question: '  오늘 코스피 마감\r\n이유도 ', holdings: [{ code: '069500', name: 'KODEX 200' }, { code: 'AAPL', name: '' }] });
  eq('#H2 넘길 글 = 보유 종목 이름 + 질문 + 부탁 한 줄', pr, `내 보유 종목: KODEX 200, AAPL\n오늘 코스피 마감\n이유도\n\n${V.HAND_TAIL}`);
  const hist = [{ role: 'user', text: '첫 질문' }, { role: 'model', text: 'ㄱ'.repeat(2000) }];
  const prH = V.handPrompt({ question: '이어서', history: hist, withHistory: true });
  ok('#H3 앞 대화는 켰을 때만 · 긴 답은 줄인다', prH.startsWith('[앞에서 나눈 대화]\n질문: 첫 질문\n답: ') && prH.includes('…\n\n[이어서 묻는 질문]\n이어서') && prH.length < 1500
    && !V.handPrompt({ question: '이어서', history: hist }).includes('앞에서 나눈 대화'));
  const u1 = V.handUrl('chatgpt', '오늘 코스피 & 금리?');
  eq('#H4 ChatGPT — 질문을 주소에 싣는다(인코딩)', [u1.url, u1.prefilled], ['https://chatgpt.com/?q=%EC%98%A4%EB%8A%98%20%EC%BD%94%EC%8A%A4%ED%94%BC%20%26%20%EA%B8%88%EB%A6%AC%3F', true]);
  eq('#H5 Genspark(query=) · 구글 AI 모드(udm=50) · Perplexity', [V.handUrl('genspark', 'a b').url, V.handUrl('googleai', 'a b').url, V.handUrl('perplexity', 'a').url],
    ['https://www.genspark.ai/search?query=a%20b', 'https://www.google.com/search?udm=50&q=a%20b', 'https://www.perplexity.ai/search?q=a']);
  eq('#H6 주소 칸이 없는 곳(Gemini)은 사이트만 연다', V.handUrl('gemini', '질문'), { url: 'https://gemini.google.com/app', prefilled: false });
  const long = V.handUrl('chatgpt', '가'.repeat(700));
  eq('#H7 너무 긴 글은 주소에 싣지 않는다(복사한 것을 붙여넣는다)', [long.url, long.prefilled], ['https://chatgpt.com/', false]);
  eq('#H8 모르는 곳 → 주소 없음', V.handUrl('evil', 'x'), { url: '', prefilled: false });
  ok('#H9 여는 주소는 그 회사 주소로만 시작한다(질문 글이 주소를 바꾸지 못한다)', V.AI_HANDS.every(h => V.handUrl(h.id, 'https://evil.example/?q=1&x=#y').url.startsWith(h.open)));
  eq('#H10 붙여넣은 글 다듬기 — 줄바꿈 정리 · 한도', [V.cleanPaste('  답\r\n\r\n\r\n\r\n\r\n끝  '), V.cleanPaste('가'.repeat(30000)).length], ['답\n\n\n끝', V.PASTE_MAX]);
  eq('#H11 복사해 둔 질문을 그대로 붙여넣은 것은 답이 아니다', [V.pasteIsQuestion(pr, '오늘 코스피 마감\n이유도', pr), V.pasteIsQuestion(' 오늘   코스피 마감 이유도 ', '오늘 코스피 마감\n이유도', pr), V.pasteIsQuestion('코스피는 2,650 입니다', '오늘 코스피 마감\n이유도', pr), V.pasteIsQuestion('', 'q', 'p')], [true, true, false, false]);
  eq('#H12 붙여넣은 답의 꼬리표', [V.handModelLabel('chatgpt'), V.handModelLabel('share'), V.handModelLabel('evil')], ['ChatGPT · 내 계정에서 붙여넣음', '공유한 AI 앱 · 내 계정에서 붙여넣음', '다른 AI · 내 계정에서 붙여넣음']);

  // ── #C 서버 순수 로직 ──
  eq('#C1 내 키는 헤더에서만 · 모양이 아니면 없는 것으로', [C.userAiKey(' gsk_abcdefghijklmnop1234 '), C.userAiKey('짧음'), C.userAiKey(null), C.userAiKey('a'.repeat(401))], ['gsk_abcdefghijklmnop1234', '', '', '']);
  eq('#C2 요청 검사 — 모르는 회사 · 종류 · 모델 이름', [C.checkChatSel({ op: 'chat', provider: 'evil', model: 'x' }).error, C.checkChatSel({ op: 'zzz', provider: 'groq' }).error, C.checkChatSel({ op: 'chat', provider: 'groq', model: 'bad model' }).error, C.checkChatSel({ op: 'chat', provider: '__proto__', model: 'x' }).error, C.checkChatSel(null).error],
    ['모르는 AI입니다', '요청 종류가 틀렸습니다', '모델 이름이 틀렸습니다 — 설정에서 모델을 다시 골라 주세요', '모르는 AI입니다', '요청 형식이 틀렸습니다']);
  eq('#C3 웹 검색은 할 수 있는 회사에서만 켜진다 · 목록 요청은 모델 없이', [C.checkChatSel({ op: 'chat', provider: 'groq', model: 'm', web: true }), C.checkChatSel({ op: 'chat', provider: 'anthropic', model: 'claude-opus-5-5', web: true }).web, C.checkChatSel({ op: 'models', provider: 'poe', model: 'zz zz' })],
    [{ op: 'chat', provider: 'groq', model: 'm', web: false }, true, { op: 'models', provider: 'poe', model: '', web: false }]);
  const req = { messages: [{ role: 'user', text: '첫 질문' }, { role: 'model', text: '첫 답' }, { role: 'user', text: '이어서' }], holdings: [{ code: '069500', name: 'KODEX 200' }] };
  const sysOff = C.chatSystem({ today: '2026-11-26', holdings: req.holdings, web: false });
  ok('#C4 부탁 문장 — 오늘 날짜 · 보유 종목 · 검색이 없으면 "지어내지 말라"', sysOff.includes('오늘은 2026-11-26') && sysOff.includes('069500 KODEX 200') && /실시간 검색을 할 수 없습니다/.test(sysOff) && /웹 검색으로 최신 자료/.test(C.chatSystem({ today: 'd', holdings: [], web: true })));
  const selG = { op: 'chat', provider: 'groq', model: 'llama-3.3-70b-versatile', web: false };
  const ob = JSON.parse(C.oaiBody(C.CHAT_PROVIDERS.groq, selG, req, '2026-11-26', false));
  eq('#C5 OpenAI 꼴 본문 — 모델 · 흘려 받기 · system + 번갈아(model → assistant)', [ob.model, ob.stream, ob.messages.map(m => m.role), ob.messages[3].content, 'plugins' in ob], ['llama-3.3-70b-versatile', true, ['system', 'user', 'assistant', 'user'], '이어서', false]);
  eq('#C6 OpenRouter 웹 검색 = 플러그인', JSON.parse(C.oaiBody(C.CHAT_PROVIDERS.openrouter, { ...selG, provider: 'openrouter', web: true }, req, 'd', true)).plugins, [{ id: 'web', max_results: 5 }]);
  const oh = C.oaiHeaders(C.CHAT_PROVIDERS.github, 'github_pat_abcdefghijklmnop');
  ok('#C7 헤더 — 키는 Authorization 으로만 · 사이트를 알리는 헤더 없음', oh.Authorization === 'Bearer github_pat_abcdefghijklmnop' && oh['X-GitHub-Api-Version'] === '2022-11-28' && !Object.keys(oh).some(k => /referer|x-title|origin/i.test(k)));
  const s1 = C.sseOai('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\ndata: {"choices":[{"delta":{"content":"안녕"}}]}\ndata: {"choices":[{"delta":{"reasoning":"생각","content":"하세요","annotations":[{"type":"url_citation","url_citation":{"url":"https://a.example/x","title":"A"}}]}}],"citations":["https://b.example/y","http://insecure.example"]}\ndata: [DONE]\ndata: {"cho', { sources: [], queries: [], html: '' });
  eq('#C8 OpenAI 꼴 답 읽기 — 글(생각 제외) · 출처(https만) · 끝 · 남는 끝줄', [s1.texts, s1.ground.sources, s1.done, s1.err, s1.rest], [['안녕', '하세요'], [{ uri: 'https://a.example/x', title: 'A' }, { uri: 'https://b.example/y', title: '' }], true, '', 'data: {"cho']);
  eq('#C9 흘러오다 난 오류 · 막힘', [C.sseOai('data: {"error":{"message":"Rate limit","code":429}}\n', s1.ground).err, C.sseOai('data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n', s1.ground).err], ['Rate limit', 'content_filter']);
  const a0 = C.antStart('claude-opus-5-5', true);
  const ah = C.antHeaders('sk-ant-abcdefghijklmnop', a0);
  eq('#C10 Claude 헤더 — x-api-key · 버전 · 거절 대비(이 모델들만)', [ah['x-api-key'], ah['anthropic-version'], ah['anthropic-beta'], 'anthropic-beta' in C.antHeaders('k', C.antStart('claude-haiku-5-5', false)), 'Authorization' in ah], ['sk-ant-abcdefghijklmnop', '2026-10-21', 'server-side-fallback-2026-07-01', false, false]);
  const ab = JSON.parse(C.antBody({ op: 'chat', provider: 'anthropic', model: 'claude-opus-5-5', web: true }, req, '2026-11-26', a0));
  eq('#C11 Claude 본문 — max_tokens · 흘려 받기 · system 따로 · 웹 검색 도구 · temperature 없음', [ab.model, ab.max_tokens, ab.stream, ab.messages.map(m => m.role), ab.tools, ab.fallbacks, 'temperature' in ab, typeof ab.system],
    ['claude-opus-5-5', 64000, true, ['user', 'assistant', 'user'], [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }], 'default', false, 'string']);
  eq('#C12 Claude 400 → 한 가지씩 물러서 다시(거절 선택 → 답 길이 → 검색 도구 낮춤 → 뺌) · 그 밖은 그만',
    [C.antNext(a0, 400, 'fallbacks: Extra inputs are not permitted'), C.antNext({ ...a0, fb: false }, 400, 'max_tokens: 64000 > 32000'), C.antNext({ maxTokens: 4096, tool: 'web_search_20260209', fb: false }, 400, "tools.0: Input tag 'web_search_20260209' not valid"),
      C.antNext({ maxTokens: 4096, tool: 'web_search_20250305', fb: false }, 400, 'tool web_search is not supported'), C.antNext({ maxTokens: 4096, tool: '', fb: false }, 400, 'messages: bad'), C.antNext(a0, 403, 'Web search is not enabled for this organization'), C.antNext(a0, 401, 'x'), C.antNext(a0, 403, 'forbidden')],
    [{ ...a0, fb: false }, { maxTokens: 16000, tool: 'web_search_20260209', fb: false }, { maxTokens: 4096, tool: 'web_search_20250305', fb: false }, { maxTokens: 4096, tool: '', fb: false }, null, { ...a0, tool: '' }, null, null]);
  const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const antStream = ev({ type: 'message_start', message: {} }) + ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '찾아보겠습니다.' } })
    + ev({ type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', name: 'web_search' } }) + ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"코스피"}' } })
    + ev({ type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://news.example/a', title: '뉴스' }] } })
    + ev({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }) + ev({ type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { url: 'https://news.example/b', title: '둘' } } })
    + ev({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: '코스피는 2,650입니다.' } }) + ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + ev({ type: 'message_stop' });
  const sa = C.sseAnt(antStream, C.antInit());
  eq('#C13 Claude 답 읽기 — 글(도구 뒤에는 문단 띄움) · 출처(검색 결과 + 인용) · 끝', [sa.texts, sa.st.ground.sources.map(s => s.uri), sa.done, sa.st.stop, sa.err], [['찾아보겠습니다.', '\n\n코스피는 2,650입니다.'], ['https://news.example/a', 'https://news.example/b'], true, 'end_turn', '']);
  const sr = C.sseAnt(ev({ type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { category: 'cyber' } } }) + ev({ type: 'message_stop' }), C.antInit());
  const se = C.sseAnt(ev({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), C.antInit());
  eq('#C14 Claude 거절 · 바쁨', [sr.st.block, sr.done, se.err, se.busy], ['cyber', true, 'Overloaded', true]);
  eq('#C15 실패 가리기 — 틀린 키·충전금·한도·없는 모델·바쁨',
    [[401, '{"error":{"message":"Invalid API key"}}'], [402, 'x'], [429, '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","code":"insufficient_quota"}}'], [429, '{"error":{"message":"Rate limit reached"}}'],
      [404, '{"error":{"message":"The model `x` does not exist"}}'], [400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'], [400, '{"error":{"message":"No endpoints found for meta/zzz."}}'], [400, '{"error":"bad"}'], [403, '{"error":{"message":"Country not supported"}}'], [403, 'no'], [529, 'x'], [503, '<html>']].map(([s, b]) => C.chatFail(s, b).e),
    ['badkey', 'credit', 'credit', 'rate', 'nomodel', 'credit', 'nomodel', 'fail', 'fail', 'badkey', 'busy', 'busy']);
  const leak = C.chatFail(401, '{"error":{"message":"Incorrect API key provided: sk-abcdefghijklmnop1234"}}', 'sk-abcdefghijklmnop1234');
  ok('#C16 오류 글에 내 키가 되돌아와도 가린다 · HTML 본문은 싣지 않는다', !leak.msg.includes('sk-abcdefghijklmnop1234') && leak.msg.includes('***') && C.chatFail(503, '<html><body>big</body></html>').msg === '503');
  const mo = C.modelsFrom('openrouter', { data: [{ id: 'openai/gpt-5', name: 'GPT-5', pricing: { prompt: '0.000001', completion: '0.00001' } }, { id: 'meta/llama-3.3:free', name: 'Llama', pricing: { prompt: '0', completion: '0' } }, { id: 'img/gen', architecture: { output_modalities: ['image'] } }, { id: 'bad id' }] });
  eq('#C17 모델 목록 — OpenRouter: 무료 먼저 · 글이 안 나오는 모델 제외', mo, [{ id: 'meta/llama-3.3:free', name: 'Llama', free: true }, { id: 'openai/gpt-5', name: 'GPT-5', free: false }]);
  eq('#C18 모델 목록 — 다른 회사: 대화용이 아닌 것 제외 · 배열 그대로 오는 꼴(GitHub)도', [C.modelsFrom('groq', { data: [{ id: 'whisper-large-v3' }, { id: 'llama-3.3-70b-versatile' }, { id: 'old', active: false }] }).map(m => m.id), C.modelsFrom('github', [{ id: 'openai/gpt-4.1-mini', name: 'OpenAI GPT-4.1-mini' }, { id: 'openai/text-embedding-3-small' }]),
    C.modelsFrom('anthropic', { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }] })],
    [['llama-3.3-70b-versatile'], [{ id: 'openai/gpt-4.1-mini', name: 'OpenAI GPT-4.1-mini', free: false }], [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', free: false }]]);
}

// ── #T 대화 묶음 — 받은 길(via)·고른 AI ──
if (A) {
  const st = A.normalizeSearchStore({ chats: [{ id: 'c1', title: 't', updatedAt: '2026-11-26T01:00:00.000Z', msgs: [
    { id: 'u1', role: 'user', text: '질문', at: '2026-11-26T01:00:00.000Z' }, { id: 'a1', role: 'model', text: '', err: 'hand', via: 'hand:chatgpt', at: '2026-11-26T01:00:00.000Z' },
    { id: 'u2', role: 'user', text: '둘', at: '2026-11-26T01:00:00.000Z' }, { id: 'a2', role: 'model', text: '답', via: 'api:groq', model: 'Groq · llama-3.3-70b-versatile', at: '2026-11-26T01:00:00.000Z' },
    { id: 'u3', role: 'user', text: '셋', at: '2026-11-26T01:00:00.000Z' }, { id: 'a3', role: 'model', text: '답3', via: 'javascript:alert(1)', at: '2026-11-26T01:00:00.000Z' }] }],
    ai: { pick: 'groq', models: { groq: 'llama-3.3-70b-versatile', 'bad id': 'x', poe: 'bad model' }, web: { anthropic: false, x: 'yes' }, ctx: true, key: 'gsk_secret_should_not_be_here' } });
  const ms = st.chats[0].msgs;
  eq('#T1 저장 모양 — 넘겨 둔 자리(답 없음 + hand)는 남는다 · via 는 정한 꼴만', [ms.length, ms[1].err, ms[1].via, ms[3].via, ms[3].model, 'via' in ms[5]], [6, 'hand', 'hand:chatgpt', 'api:groq', 'Groq · llama-3.3-70b-versatile', false]);
  eq('#T2 고른 AI·모델·웹 검색·앞 대화 넘기기 — 키 칸은 없다', st.ai, { pick: 'groq', models: { groq: 'llama-3.3-70b-versatile' }, web: { anthropic: false }, ctx: true });
  eq('#T3 처음 = Gemini', A.normalizeSearchStore(null).ai, { pick: 'gemini', models: {}, web: {}, ctx: false });
  eq('#T4 보낼 대화 — 넘겨 두고 답을 못 받은 자리는 뺀다 · 붙여넣은 답은 맥락으로 넘긴다', A.requestMessages(ms).map(m => m.role + ':' + m.text), ['user:질문', 'user:둘', 'model:답', 'user:셋', 'model:답3']);
}

// ── #E 서버 처리부를 가짜 회사 서버로 끝까지 ──
if (C && A) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-ai-chat-'));
  let handler = null;
  try {
    const src = read('api/ai-chat.ts')
      .replace("import { requireAuth } from './_auth.js';", "const requireAuth = async (r) => (r.headers.get('x-test-deny') ? new Response('no', { status: 401 }) : null);")
      .replace("from './_aiSearch.js';", `from ${JSON.stringify(pathToFileURL(join(ROOT, 'api/_aiSearch.ts')).href)};`)
      .replace("from './_aiChat.js';", `from ${JSON.stringify(pathToFileURL(join(ROOT, 'api/_aiChat.ts')).href)};`);
    ok('#E0 처리부 시험본을 만들었다(import 세 줄 바꿔 끼움)', !/_auth\.js|'\.\/_aiSearch\.js'|'\.\/_aiChat\.js'/.test(src));
    writeFileSync(join(dir, 'h.ts'), src);
    handler = (await import(pathToFileURL(join(dir, 'h.ts')).href)).default;
  } catch (e) { fail++; console.log(`  ✗ #E0 처리부를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
  if (handler) {
    const realFetch = globalThis.fetch;
    const calls = [];
    let script = [];
    const enc = new TextEncoder();
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method, headers: { ...(init?.headers || {}) }, body: init?.body ? JSON.parse(init.body) : null, redirect: init?.redirect });
      const step = script.shift() || { status: 500, body: 'no script' };
      if (step.json) return new Response(JSON.stringify(step.json), { status: step.status || 200, headers: { 'content-type': 'application/json' } });
      if (step.status !== 200) return new Response(step.body || '', { status: step.status });
      return new Response(new ReadableStream({ start(c) { for (const k of step.chunks) c.enqueue(enc.encode(k)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const call = async (body, headers = {}, method = 'POST') => {
      const res = await handler(new Request('https://site.example/api/ai-chat', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined }));
      if (!(res.headers.get('content-type') || '').includes('ndjson')) return { status: res.status, json: await res.json().catch(() => null) };
      let st = A.searchReadInit();
      const reader = res.body.getReader(); const dec = new TextDecoder();
      for (;;) { const { value, done } = await reader.read(); if (done) break; st = A.searchReadStep(st, dec.decode(value, { stream: true })); }
      return { status: res.status, st: A.searchReadStep(st, '', true) };
    };
    const msgs = [{ role: 'user', text: '오늘 코스피 마감' }];
    const GK = 'gsk_userkey_abcdefghijklmnop1234';
    const AK = 'sk-ant-userkey-abcdefghijklmnop1234';
    const oai = (...parts) => ({ status: 200, chunks: [...parts.map(t => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`), 'data: [DONE]\n\n'] });
    const aev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    const ant = (text, extra = []) => ({ status: 200, chunks: [aev({ type: 'message_start', message: {} }), aev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }), aev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }), ...extra, aev({ type: 'message_stop' })] });
    const env0 = { ...process.env };
    try {
      process.env.GEMINI_API_KEY = 'site-gemini-key-must-not-be-used';
      process.env.OPENAI_API_KEY = 'site-openai-key-must-not-be-used';
      eq('#E1 로그인 확인 실패 → 그대로 401 · GET → 405', [(await call({}, { 'x-test-deny': '1' })).status, (await call(null, {}, 'GET')).status], [401, 405]);
      eq('#E2 다른 사이트에서 온 요청 → 403', (await handler(new Request('https://site.example/api/ai-chat', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' }))).status, 403);
      const b1 = await call({ op: 'chat', provider: 'https://evil.example', model: 'm', messages: msgs }, { 'X-AI-Key': GK });
      eq('#E3 모르는 회사(주소를 넣어도) → 400 · 아무 데도 보내지 않는다', [b1.status, b1.json && b1.json.error, calls.length], [400, '모르는 AI입니다', 0]);
      const b2 = await call({ op: 'chat', provider: 'groq', model: 'llama-3.3-70b-versatile', messages: msgs });
      eq('#E4 내 키 없음 → needkey · 사이트 키로 부르지 않는다', [b2.status, b2.st.error, b2.st.done, calls.length], [200, 'needkey', false, 0]);
      eq('#E5 질문 없음 → 400', [(await call({ op: 'chat', provider: 'groq', model: 'm', messages: [] }, { 'X-AI-Key': GK })).json.error, calls.length], ['질문이 없습니다', 0]);
      script = [oai('코스피는 ', '2,650입니다.')];
      const r1 = await call({ op: 'chat', provider: 'groq', model: 'llama-3.3-70b-versatile', web: true, messages: msgs, holdings: [{ code: '069500', name: 'KODEX 200' }] }, { 'X-AI-Key': GK });
      eq('#E6 Groq — 내 키로 그 회사 주소에 · 답 끝까지 · 모델 꼬리표', [r1.st.done, r1.st.error, r1.st.text, r1.st.model, calls.length, calls[0].url, calls[0].headers.Authorization, calls[0].redirect],
        [true, '', '코스피는 2,650입니다.', 'llama-3.3-70b-versatile', 1, 'https://api.groq.com/openai/v1/chat/completions', `Bearer ${GK}`, 'error']);
      ok('#E6 보낸 본문 — 부탁 문장(오늘 날짜·보유 종목·검색 못 함) + 질문 · 키는 본문·주소에 없다', calls[0].body.messages[0].role === 'system' && calls[0].body.messages[0].content.includes('069500 KODEX 200') && /실시간 검색을 할 수 없습니다/.test(calls[0].body.messages[0].content)
        && calls[0].body.messages[1].content === '오늘 코스피 마감' && !JSON.stringify(calls[0].body).includes(GK) && !calls[0].url.includes(GK) && !('plugins' in calls[0].body));
      calls.length = 0;
      script = [{ status: 200, chunks: [`data: ${JSON.stringify({ choices: [{ delta: { content: '답', annotations: [{ type: 'url_citation', url_citation: { url: 'https://src.example/1', title: '출처1' } }] } }] })}\n\n`, 'data: [DONE]\n\n'] }];
      const r2 = await call({ op: 'chat', provider: 'openrouter', model: 'openrouter/free', web: true, messages: msgs }, { 'X-AI-Key': 'sk-or-v1-abcdefghijklmnop1234' });
      eq('#E7 OpenRouter 웹 검색 켬 → 플러그인 + 출처 · 꼬리표에 웹 검색', [r2.st.done, r2.st.ground && r2.st.ground.sources, r2.st.model, calls[0].body.plugins, calls[0].url], [true, [{ uri: 'https://src.example/1', title: '출처1' }], 'openrouter/free + 웹 검색', [{ id: 'web', max_results: 5 }], 'https://openrouter.ai/api/v1/chat/completions']);
      const fails = [];
      for (const [status, body] of [[401, '{"error":{"message":"Invalid API Key"}}'], [402, '{"error":{"message":"Insufficient credits"}}'], [429, '{"error":{"message":"Rate limit reached for model"}}'], [404, '{"error":{"message":"model not found"}}'], [503, 'busy']]) {
        calls.length = 0; script = [{ status, body }];
        const r = await call({ op: 'chat', provider: 'groq', model: 'm', messages: msgs }, { 'X-AI-Key': GK });
        fails.push([r.st.error, r.st.done, calls.length]);
      }
      eq('#E8 회사가 거절 → 까닭별 오류(되풀이해 부르지 않는다)', fails, [['badkey', false, 1], ['credit', false, 1], ['rate', false, 1], ['nomodel', false, 1], ['busy', false, 1]]);
      calls.length = 0; script = [{ status: 401, body: `{"error":{"message":"Incorrect API key provided: ${GK}"}}` }];
      const r3 = await call({ op: 'chat', provider: 'groq', model: 'm', messages: msgs }, { 'X-AI-Key': GK });
      ok('#E9 회사 오류 글에 키가 되돌아와도 화면으로 보내지 않는다', r3.st.error === 'badkey' && !r3.st.msg.includes(GK));
      calls.length = 0; script = [{ status: 200, chunks: [`data: ${JSON.stringify({ choices: [{ delta: { content: '반쯤' } }] })}\n\n`, `data: ${JSON.stringify({ error: { message: 'upstream died' } })}\n\n`] }];
      const r4 = await call({ op: 'chat', provider: 'xai', model: 'grok-4', messages: msgs }, { 'X-AI-Key': 'xai-abcdefghijklmnop1234' });
      eq('#E10 흘러오다 끊김 → 받은 데까지 + 오류 · 끝 표시 없음', [r4.st.text, r4.st.error, r4.st.done, calls[0].url], ['반쯤', 'fail', false, 'https://api.x.ai/v1/chat/completions']);
      calls.length = 0; script = [{ status: 200, chunks: [`data: ${JSON.stringify({ error: { message: `key ${GK} is over limit` } })}\n\n`] }];
      const r4b = await call({ op: 'chat', provider: 'groq', model: 'm', messages: msgs }, { 'X-AI-Key': GK });
      ok('#E10 흘러오다 난 오류 글에 키가 있어도 가린다', r4b.st.error === 'fail' && !r4b.st.msg.includes(GK) && r4b.st.msg.includes('***'));
      // Claude
      calls.length = 0;
      script = [{ status: 400, body: '{"type":"error","error":{"type":"invalid_request_error","message":"fallbacks: Extra inputs are not permitted"}}' }, { status: 400, body: '{"type":"error","error":{"message":"max_tokens: 64000 > 32000, which is the maximum allowed"}}' },
        ant('찾아봤습니다.', [aev({ type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://news.example/a', title: '뉴스' }] } }), aev({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } }), aev({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '2,650입니다.' } }), aev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })])];
      const r5 = await call({ op: 'chat', provider: 'anthropic', model: 'claude-opus-5-5', web: true, messages: [{ role: 'user', text: '첫' }, { role: 'model', text: '답' }, { role: 'user', text: '이어서' }] }, { 'X-AI-Key': AK });
      eq('#E11 Claude — 400 을 보고 한 가지씩 물러서 다시 → 답 · 출처 · 웹 검색 꼬리표', [r5.st.done, r5.st.error, r5.st.text, r5.st.ground && r5.st.ground.sources.map(s => s.uri), r5.st.model, calls.length],
        [true, '', '찾아봤습니다.\n\n2,650입니다.', ['https://news.example/a'], 'claude-opus-5-5 + 웹 검색', 3]);
      ok('#E11 Claude 로 간 것 — 주소 · x-api-key · 버전 · 본문(시도마다 한 가지씩 바뀜)', calls.every(c => c.url === 'https://api.anthropic.com/v1/messages' && c.headers['x-api-key'] === AK && c.headers['anthropic-version'] === '2026-10-21' && !('Authorization' in c.headers) && c.redirect === 'error')
        && calls[0].body.fallbacks === 'default' && calls[0].headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && !('fallbacks' in calls[1].body) && !('anthropic-beta' in calls[1].headers) && calls[1].body.max_tokens === 64000 && calls[2].body.max_tokens === 16000
        && calls[2].body.tools[0].type === 'web_search_20260209' && calls[2].body.messages.map(m => m.role).join() === 'user,assistant,user' && typeof calls[2].body.system === 'string' && !('temperature' in calls[2].body));
      calls.length = 0; script = [ant('', [aev({ type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { category: 'cyber' } } })])];
      const r6 = await call({ op: 'chat', provider: 'anthropic', model: 'claude-haiku-5-5', messages: msgs }, { 'X-AI-Key': AK });
      eq('#E12 Claude 거절 → block · 검색을 안 켰으면 도구 없음', [r6.st.error, r6.st.done, 'tools' in calls[0].body, 'fallbacks' in calls[0].body], ['block', false, false, false]);
      calls.length = 0; script = [ant('검색하다 쉼', [aev({ type: 'message_delta', delta: { stop_reason: 'pause_turn' } })])];
      const r7 = await call({ op: 'chat', provider: 'anthropic', model: 'claude-haiku-5-5', web: true, messages: msgs }, { 'X-AI-Key': AK });
      eq('#E13 Claude 가 쉬어 가기로 멈춤 → 끝 표시 없음(화면이 끊긴 답으로 보인다)', [r7.st.text, r7.st.done, r7.st.error], ['검색하다 쉼', false, '']);
      calls.length = 0; script = [{ status: 400, body: '{"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing"}}' }];
      const r8 = await call({ op: 'chat', provider: 'anthropic', model: 'claude-opus-5-5', messages: msgs }, { 'X-AI-Key': AK });
      eq('#E14 Claude 충전금 없음(400) → credit · 한 번만', [r8.st.error, calls.length], ['credit', 1]);
      calls.length = 0; script = [{ status: 200, chunks: [aev({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })] }];
      eq('#E15 Claude 흘러오다 바쁨 → busy', (await call({ op: 'chat', provider: 'anthropic', model: 'claude-opus-5-5', messages: msgs }, { 'X-AI-Key': AK })).st.error, 'busy');
      // 모델 목록(= 키 시험)
      calls.length = 0; script = [{ json: { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }] } }];
      const m1 = await call({ op: 'models', provider: 'groq' }, { 'X-AI-Key': GK });
      eq('#E16 모델 목록 — GET 으로 그 회사 목록 주소에 · 내 키', [m1.status, m1.json, calls[0].url, calls[0].method, calls[0].headers.Authorization, calls[0].body], [200, { models: [{ id: 'llama-3.3-70b-versatile', name: '', free: false }] }, 'https://api.groq.com/openai/v1/models', 'GET', `Bearer ${GK}`, null]);
      calls.length = 0; script = [{ json: { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }] } }];
      const m2 = await call({ op: 'models', provider: 'anthropic' }, { 'X-AI-Key': AK });
      eq('#E17 Claude 모델 목록 — x-api-key', [m2.json.models[0].name, calls[0].url, calls[0].headers['x-api-key'], 'Authorization' in calls[0].headers], ['Claude Opus 5.5', 'https://api.anthropic.com/v1/models?limit=100', AK, false]);
      calls.length = 0; script = [{ status: 401, body: '{"error":{"message":"bad key"}}' }];
      eq('#E18 모델 목록 — 틀린 키 → badkey · 키 없음 → needkey(부르지 않음)', [(await call({ op: 'models', provider: 'groq' }, { 'X-AI-Key': GK })).json.error, (await call({ op: 'models', provider: 'groq' })).json.error, calls.length], ['badkey', 'needkey', 1]);
      // 열 곳 모두 — 보낸 곳은 그 회사 주소뿐
      const seen = [];
      for (const id of Object.keys(C.CHAT_PROVIDERS)) {
        calls.length = 0;
        script = [C.CHAT_PROVIDERS[id].kind === 'anthropic' ? ant('ㅇ') : oai('ㅇ')];
        const r = await call({ op: 'chat', provider: id, model: 'some-model', messages: msgs }, { 'X-AI-Key': 'key_abcdefghijklmnop1234' });
        seen.push([id, r.st.done && r.st.text === 'ㅇ', calls.length === 1 && calls[0].url === C.CHAT_PROVIDERS[id].chat && HOSTS.includes(new URL(calls[0].url).hostname)]);
      }
      ok(`#E19 회사 열 곳 모두 — 답을 끝까지 받고, 보낸 곳은 표의 그 회사 주소 하나 (${seen.filter(s => !s[1] || !s[2]).map(s => s[0]).join(',') || '모두 통과'})`, seen.length === 10 && seen.every(s => s[1] && s[2]));
    } catch (e) {
      fail++; console.log(`  ✗ #E 처리부 실행 중 오류 — ${e && (e.stack || e.message)}`);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of ['GEMINI_API_KEY', 'OPENAI_API_KEY']) { if (k in env0) process.env[k] = env0[k]; else delete process.env[k]; }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ }
    }
  }
}

// ── #S 배선 — 소스 가드 ──
const app = stripComments(read('src/App.tsx'));
const chat = stripComments(read('src/components/AiSearchChat.tsx'));
const srv = stripComments(read('api/ai-chat.ts'));
const lib = stripComments(read('api/_aiChat.ts'));
const prov = stripComments(read('src/aiProviders.ts'));
ok('#S1 서버 — 처리부 첫 줄 requireAuth · 내 키는 헤더에서만 · 사이트 키(환경 변수)를 읽지 않는다',
  /export default async function handler\(request: Request\): Promise<Response> \{\s*const denied = await requireAuth\(request\);\s*if \(denied\) return denied;/.test(srv)
  && /const key = userAiKey\(request\.headers\.get\(AI_KEY_HEADER\)\);/.test(srv) && !/process\.env/.test(srv) && !/process\.env/.test(lib));
const fetchUrls = [...srv.matchAll(/fetch\(([^,]+),/g)].map(m => m[1].trim());
ok(`#S2 서버가 부르는 곳은 표의 주소(p.chat·p.models)뿐 · 넘겨주기(redirect)를 따라가지 않는다 — ${fetchUrls.join(' | ')}`, fetchUrls.length === 3 && fetchUrls.every(u => u === 'p.chat' || u === 'p.models')
  && (srv.match(/redirect: 'error'/g) || []).length === 3 && !/console\.(log|error|warn|info)/.test(srv) && !/console\.(log|error|warn|info)/.test(lib));
ok('#S3 api 상대 import는 .js 확장자(Vercel ESM)', [...srv.matchAll(/from '(\.\/[^']+)'/g)].every(m => m[1].endsWith('.js')) && [...srv.matchAll(/from '(\.\/[^']+)'/g)].length === 3);
ok('#S4 src/aiProviders.ts·api/_aiChat.ts — import 0 · 뒤보기 정규식 없음(옛 사파리 멈춤)', !/^\s*import\s/m.test(prov) && !/^\s*import\s/m.test(lib) && !/\(\?<[=!]/.test(prov));
ok('#S5 화면에 사이트를 알리는 헤더를 회사로 보내지 않는다(HTTP-Referer·X-Title 없음)', !/HTTP-Referer|X-Title|Referer/i.test(lib) && !/HTTP-Referer|X-Title/i.test(srv));
const cFetch = [...chat.matchAll(/fetch\(([^,]+),/g)].map(m => m[1].trim());
ok(`#S6 화면이 부르는 곳은 같은 출처의 /api/ai-search·/api/ai-chat·/api/pc-ask(내 PC 우편함 — verify:pc-ask) 뿐(AI 회사를 직접 부르지 않는다) — ${cFetch.join(' | ')}`,
  cFetch.length === 3 && cFetch.includes("pickP ? '/api/ai-chat' : '/api/ai-search'") && cFetch.includes("'/api/ai-chat'") && cFetch.includes("'/api/pc-ask'") && (chat.match(/fetch\(/g) || []).length === 3
  && !HOSTS.some(h => chat.includes(h)) && !/generativelanguage/.test(chat));
ok('#S7 내 키는 헤더로만(X-AI-Key) · 본문에 키 없음 · 브라우저 저장소 금지', /headers\['X-AI-Key'\] = pickKey;/.test(chat) && /headers: \{ 'Content-Type': 'application\/json', 'X-AI-Key': key \}/.test(chat)
  && /body = \{ op: 'chat', provider: pickP\.id, model: pickModelId, web: !!prefs\.web\[pickP\.id\], messages: sendMsgs, holdings \};/.test(chat) && /body: JSON\.stringify\(\{ op: 'models', provider: pid \}\)/.test(chat)
  && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(chat) && !/localStorage|sessionStorage|document\.cookie/.test(prov));
ok('#S8 관리자 접속 중에는 다른 AI를 쓰지 않는다(사용자 키를 읽지 않으므로 Gemini 고정)', /const pickP = viewingAs \? null : aiProviderById\(prefs\.pick\);/.test(chat) && /if \(!p \|\| !key \|\| viewingAs\) return;/.test(chat));
ok('#S9 내 구독으로 묻기 — 새 창은 noopener·noreferrer(사이트 주소를 넘기지 않는다) · 여는 주소는 handUrl 이 만든 것만 · 누른 그 순간 복사',
  /window\.open\(link\.url, '_blank', 'noopener,noreferrer'\)/.test(chat) && (chat.match(/window\.open\(/g) || []).length === 1 && /const link = handUrl\(hid, prompt\);/.test(chat)
  && /const copiedOk = copyNow\(prompt\);\s*try \{ window\.open\(/.test(chat) && [...chat.matchAll(/target="_blank" rel="([^"]*)"/g)].every(m => m[1] === 'noopener noreferrer'));
ok('#S10 답 붙여넣기 — 다듬고(cleanPaste) 질문 그대로면 넣지 않는다 · 꼬리표는 붙여넣은 답임을 밝힌다',
  /const text = cleanPaste\(raw\);/.test(chat) && /if \(pasteIsQuestion\(text, question, prompt\)\) return /.test(chat) && /model: handModelLabel\(hid\)/.test(chat));
ok('#S11 키 입력 칸은 가려진 칸(password) · 화면에는 가린 키만', (chat.match(/type="password"/g) || []).length === 2 && /maskAiKey\(k\)/.test(chat) && !/\{k\}<\/span>/.test(chat));
const keysApi = app.slice(app.indexOf('const aiKeysApi = useMemo('), app.indexOf('}), []);', app.indexOf('const aiKeysApi = useMemo(')));
const gemApi = app.slice(app.indexOf('const geminiKeyApi = useMemo('), app.indexOf('}), []);', app.indexOf('const geminiKeyApi = useMemo(')));
ok('#S12 다른 AI 키 = 내 Drive ai_settings.json(saveDriveFile만 · 버전 백업·브라우저 저장소 금지 · 관리자 접속 중 읽기/쓰기 안 함)',
  keysApi.length > 200 && /saveDriveFile\(token, folderId, DRIVE_FILES\.AI_SETTINGS,/.test(keysApi) && /loadDriveFile\(token, folderId, DRIVE_FILES\.AI_SETTINGS\)/.test(keysApi)
  && !/saveVersionedBackup|localStorage|sessionStorage/.test(keysApi) && (keysApi.match(/adminViewingAsRef\.current \|\| ADMIN_VIEW_EMAIL/g) || []).length === 2 && /normalizeAiKeys\(keys\)/.test(keysApi));
ok('#S13 같은 파일의 두 칸이 서로를 지우지 않는다 — Gemini 키 저장은 aiKeys 를, 다른 AI 키 저장은 geminiKey 를 함께 쓴다(아직 안 읽었으면 먼저 읽는다)',
  /\{ geminiKey: k, aiKeys: c\.aiKeys, updatedAt: /.test(gemApi) && /\{ geminiKey: c\.key, aiKeys, updatedAt: /.test(keysApi)
  && /if \(!c\.loaded \|\| c\.email !== email\) \{\s*const cur = await loadDriveFile\(/.test(gemApi) && /if \(!c\.loaded \|\| c\.email !== email\) \{\s*const cur = await loadDriveFile\(/.test(keysApi));
ok('#S14 App — 창에 다른 AI 키 길을 넘긴다 · normalizeAiKeys import', /<AiSearchChat[\s\S]*?aiApi=\{aiKeysApi\}/.test(app) && /import \{ normalizeAiKeys \} from '\.\/aiProviders';/.test(read('src/App.tsx')));
ok('#S15 구독 로그인(쿠키·세션)을 받아 대신 쓰는 길은 없다 — 화면·서버 어디에도 쿠키·세션 토큰 칸이 없다', !/sessionKey|session_token|__Secure-|cf_clearance|oauth_token|refresh_token/i.test(chat + prov + srv + lib) && !/[^-]cookie/i.test(srv + lib));
const authSrc = read('scripts/verify-api-auth.mjs');
ok('#S16 package.json 에 verify:ai-chat 이 있다(gate 가 함께 돌린다)', /"verify:ai-chat": "node scripts\/verify-ai-chat\.mjs"/.test(read('package.json')) && authSrc.length > 0);

console.log(`\nverify:ai-chat — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
