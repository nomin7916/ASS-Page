// 「AI 검색」 채팅창(사용자 요청 2026-11-26: "각 사용자가 자기 구글 Gemini API로 검색해 채팅창에 자료를 만들고 활용 · 듣기") —
// /api/ai-search 가 쓰는 순수 로직. 질문(앞 대화 포함)을 구글 Gemini의 '구글 검색 연결(google_search 도구)'로 보내
// 최신 자료를 찾아 한국어로 답하게 하고, 답 글 + 출처(groundingMetadata)를 돌려준다.
// 키 고르기는 사진으로 보유 맞추기와 같다(api/_holdingsPhoto.ts pickHoldKeys — 관리자 = 내 키 → 사이트 키 · 다른 사용자 = 내 키만).
// ⚠️ 대화는 서버에 저장·기록하지 않는다(저장은 화면이 사용자 Drive ai_search_chats.json 에만).
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-ai-search.mjs가 직접 import한다.

export const SEARCH_BODY_MAX = 300_000;
export const SEARCH_Q_MAX = 4000;          // 질문 한 개(글자)
export const SEARCH_A_KEEP = 6000;         // 앞 답은 이만큼만 앞에서부터 넘긴다(맥락용 — 길면 비용만 는다)
export const SEARCH_HIST_MAX = 60_000;     // 넘기는 앞 대화 전체(글자)
export const SEARCH_TURNS_MAX = 24;        // 넘기는 앞 대화 수(질문+답)
export const SEARCH_HOLD_MAX = 60;
const CODE_RE = /^[0-9A-Za-z]{4,12}$/;
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

export interface SearchMsg { role: 'user' | 'model'; text: string }
export interface SearchReq { messages: SearchMsg[]; holdings: { code: string; name: string }[] }

// 요청 검사 — 마지막은 질문(user)이어야 한다. 앞 대화는 뒤에서부터 한도 안만 남기고, 첫 줄은 질문으로 시작하게 자른다.
export function checkSearchReq(body: any): SearchReq | { error: string } {
  if (!body || typeof body !== 'object') return { error: '요청 형식이 틀렸습니다' };
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const msgs: SearchMsg[] = [];
  for (const m of raw.slice(-200)) {
    const role = m?.role === 'model' ? 'model' : m?.role === 'user' ? 'user' : '';
    if (!role) continue;
    const text = clean(m?.text, role === 'user' ? SEARCH_Q_MAX : SEARCH_A_KEEP);
    if (!text) continue;
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.text = clean(`${last.text}\n\n${text}`, role === 'user' ? SEARCH_Q_MAX : SEARCH_A_KEEP);   // 같은 쪽이 이어지면 합친다(Gemini는 번갈아야 한다)
    else msgs.push({ role, text });
  }
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') return { error: '질문이 없습니다' };
  const kept: SearchMsg[] = [];
  let total = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (kept.length >= SEARCH_TURNS_MAX || total + msgs[i].text.length > SEARCH_HIST_MAX) break;
    kept.unshift(msgs[i]);
    total += msgs[i].text.length;
  }
  while (kept.length > 0 && kept[0].role !== 'user') kept.shift();
  const holdings: { code: string; name: string }[] = [];
  for (const h of (Array.isArray(body.holdings) ? body.holdings : []).slice(0, SEARCH_HOLD_MAX)) {
    const code = String(h?.code ?? '').trim().toUpperCase();
    const name = String(h?.name ?? '').replace(/[\r\n\t|]+/g, ' ').trim().slice(0, 60);
    if (code && !CODE_RE.test(code)) continue;
    if (!code && !name) continue;
    holdings.push({ code, name });
  }
  return { messages: kept, holdings };
}

// 한국 날짜(YYYY-MM-DD) — '오늘'을 서버가 정한다(화면 시계를 믿지 않는다).
export function kstDate(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
}

export function buildSearchSystem({ today, holdings }: { today: string; holdings: { code: string; name: string }[] }): string {
  const lines = [
    `당신은 투자·경제 자료를 찾아 한국어로 정리해 주는 검색 도우미입니다. 오늘은 ${today}(한국 시각)입니다.`,
    `- 답하기 전에 구글 검색으로 최신 자료를 찾아 확인하세요. 숫자·날짜·가격·비율은 검색 결과에서 확인한 것만 쓰고 지어내지 마세요.`,
    `- 자료가 언제 기준인지(날짜)를 밝혀 주세요. 찾지 못했거나 확실하지 않으면 그렇다고 말하세요.`,
    `- 한국어 높임말로, 휴대폰에서 읽기 쉽게 짧은 문단과 글머리표(- )로 씁니다. 필요하면 ## 소제목, **굵게**, 표(| 칸 | 칸 |)를 씁니다.`,
    `- 답 끝에 출처 목록·링크 목록은 쓰지 마세요(화면이 출처를 따로 보여 줍니다).`,
    `- 투자 권유가 아니라 자료 정리입니다. 사라·팔라고 단정하지 말고 판단에 필요한 사실과 근거를 정리하세요.`,
  ];
  if (holdings.length > 0) {
    lines.push('', `[사용자의 보유 종목] 사용자가 '내 종목·내 보유 종목'을 말하면 이 목록입니다(수량·금액은 알려 주지 않았습니다).`);
    for (const h of holdings) lines.push(`${h.code || '-'} ${h.name}`.trim());
  }
  return lines.join('\n');
}

export function searchGeminiBody(req: SearchReq, today: string): string {
  return JSON.stringify({
    system_instruction: { parts: [{ text: buildSearchSystem({ today, holdings: req.holdings }) }] },
    contents: req.messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
  });
}

export interface SearchGround { sources: { uri: string; title: string }[]; queries: string[]; html: string }
export const emptyGround = (): SearchGround => ({ sources: [], queries: [], html: '' });
const HTML_MAX = 40_000;

// 응답 조각의 groundingMetadata(카멜·스네이크 둘 다) → 출처·검색어·검색 제안(renderedContent). 앞 조각과 합친다.
export function mergeGround(acc: SearchGround, gm: any): SearchGround {
  if (!gm || typeof gm !== 'object') return acc;
  const out: SearchGround = { sources: [...acc.sources], queries: [...acc.queries], html: acc.html };
  const chunks = gm.groundingChunks || gm.grounding_chunks || [];
  for (const c of Array.isArray(chunks) ? chunks : []) {
    const w = c?.web || c?.retrievedContext || {};
    const uri = String(w?.uri ?? '').trim();
    if (!/^https:\/\/[^\s"'<>]+$/.test(uri) || uri.length > 2000) continue;
    if (out.sources.some(s => s.uri === uri) || out.sources.length >= 20) continue;
    out.sources.push({ uri, title: String(w?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) });
  }
  const qs = gm.webSearchQueries || gm.web_search_queries || [];
  for (const q of Array.isArray(qs) ? qs : []) {
    const s = String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (s && !out.queries.includes(s) && out.queries.length < 10) out.queries.push(s);
  }
  const se = gm.searchEntryPoint || gm.search_entry_point;
  const html = String(se?.renderedContent ?? se?.rendered_content ?? '');
  if (html && html.length <= HTML_MAX) out.html = html;
  return out;
}

// Gemini SSE 한 덩이에서 답 글(생각 조각 제외)·막힘·출처를 꺼낸다. 남는 끝줄은 rest로.
export function sseSearch(buf: string, ground: SearchGround): { texts: string[]; rest: string; block: string; ground: SearchGround } {
  const lines = buf.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  const texts: string[] = [];
  let block = '';
  let g = ground;
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    let j: any;
    try { j = JSON.parse(raw); } catch { continue; }
    const c = j?.candidates?.[0];
    for (const p of c?.content?.parts || []) {
      if (p && typeof p.text === 'string' && !p.thought) texts.push(p.text);
    }
    g = mergeGround(g, c?.groundingMetadata || c?.grounding_metadata);
    const br = j?.promptFeedback?.blockReason || (c?.finishReason === 'SAFETY' ? 'SAFETY' : '');
    if (br) block = String(br);
  }
  return { texts, rest, block, ground: g };
}
