// 「AI 검색」 채팅창의 '다른 AI'(사용자 요청 2026-11-26: "재미나이든, 그록이든, 클로드든 … 각 사용자가 개인 계정으로") — /api/ai-chat 이 쓰는 순수 로직.
// 사용자가 자기 계정에서 만든 API 키(X-AI-Key 헤더)로 그 회사 API에 질문을 전달하고, 답(SSE)을 /api/ai-search 와 같은 NDJSON 으로 바꾼다.
// ⚠️ 보낼 곳은 이 표(CHAT_PROVIDERS)에 적힌 주소뿐이다 — 화면이 준 주소로 보내지 않는다(남의 서버로 키가 새지 않게).
// ⚠️ 사이트 키(환경 변수)를 쓰지 않는다 — 누구든 자기 키로만. 키·대화는 저장·기록하지 않는다.
// ⚠️ Claude(Anthropic)는 SDK 없이 HTTP 로 부른다 — 이 저장소의 서버 경로는 모두 Edge + fetch 이고(가짜 fetch 로 끝까지 시험한다) 패키지를 더 넣지 않는다.
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-ai-chat.mjs 가 직접 import한다.

export const AI_KEY_HEADER = 'x-ai-key';
const KEY_RE = /^[A-Za-z0-9_\-.:=+/]{16,400}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,119}$/;
export function userAiKey(headerValue: string | null | undefined): string {
  const k = String(headerValue ?? '').trim();
  return KEY_RE.test(k) ? k : '';
}

export interface ChatProvider { kind: 'openai' | 'anthropic'; chat: string; models: string; hdr: Record<string, string>; web: '' | 'anthropic' | 'orplugin' }
export const CHAT_PROVIDERS: Record<string, ChatProvider> = {
  openrouter: { kind: 'openai', chat: 'https://openrouter.ai/api/v1/chat/completions', models: 'https://openrouter.ai/api/v1/models', hdr: {}, web: 'orplugin' },
  groq: { kind: 'openai', chat: 'https://api.groq.com/openai/v1/chat/completions', models: 'https://api.groq.com/openai/v1/models', hdr: {}, web: '' },
  github: { kind: 'openai', chat: 'https://models.github.ai/inference/chat/completions', models: 'https://models.github.ai/catalog/models', hdr: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, web: '' },
  cerebras: { kind: 'openai', chat: 'https://api.cerebras.ai/v1/chat/completions', models: 'https://api.cerebras.ai/v1/models', hdr: {}, web: '' },
  mistral: { kind: 'openai', chat: 'https://api.mistral.ai/v1/chat/completions', models: 'https://api.mistral.ai/v1/models', hdr: {}, web: '' },
  poe: { kind: 'openai', chat: 'https://api.poe.com/v1/chat/completions', models: 'https://api.poe.com/v1/models', hdr: {}, web: '' },
  anthropic: { kind: 'anthropic', chat: 'https://api.anthropic.com/v1/messages', models: 'https://api.anthropic.com/v1/models?limit=100', hdr: {}, web: 'anthropic' },
  openai: { kind: 'openai', chat: 'https://api.openai.com/v1/chat/completions', models: 'https://api.openai.com/v1/models', hdr: {}, web: '' },
  xai: { kind: 'openai', chat: 'https://api.x.ai/v1/chat/completions', models: 'https://api.x.ai/v1/models', hdr: {}, web: '' },
  deepseek: { kind: 'openai', chat: 'https://api.deepseek.com/chat/completions', models: 'https://api.deepseek.com/models', hdr: {}, web: '' },
};
export const ANTHROPIC_VERSION = '2026-10-21';
export const ANT_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// 안전 분류기가 거절하면 서버가 다른 모델로 이어 답하게 하는 선택(fallbacks) — 이 모델들에만 붙인다.
const ANT_FALLBACK_MODELS = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/;

export interface ChatSel { op: 'chat' | 'models'; provider: string; model: string; web: boolean }
export function checkChatSel(body: any): ChatSel | { error: string } {
  if (!body || typeof body !== 'object') return { error: '요청 형식이 틀렸습니다' };
  const op = body.op === 'models' ? 'models' : body.op === 'chat' ? 'chat' : '';
  if (!op) return { error: '요청 종류가 틀렸습니다' };
  const provider = String(body.provider ?? '');
  if (!Object.prototype.hasOwnProperty.call(CHAT_PROVIDERS, provider)) return { error: '모르는 AI입니다' };
  const model = String(body.model ?? '').trim();
  if (op === 'chat' && !MODEL_RE.test(model)) return { error: '모델 이름이 틀렸습니다 — 설정에서 모델을 다시 골라 주세요' };
  return { op, provider, model: op === 'chat' ? model : '', web: !!body.web && !!CHAT_PROVIDERS[provider].web };
}

export function chatSystem({ today, holdings, web }: { today: string; holdings: { code: string; name: string }[]; web: boolean }): string {
  const lines = [
    `당신은 투자·경제 자료를 한국어로 정리해 주는 도우미입니다. 오늘은 ${today}(한국 시각)입니다.`,
    web
      ? `- 답하기 전에 웹 검색으로 최신 자료를 찾아 확인하세요. 숫자·날짜·가격·비율은 검색 결과에서 확인한 것만 쓰고 지어내지 마세요. 검색 과정은 설명하지 말고 바로 답하세요.`
      : `- 지금은 실시간 검색을 할 수 없습니다. 오늘의 시세·최근 뉴스처럼 최신 내용은 모른다고 분명히 밝히고, 아는 범위의 원리·배경·확인하는 방법을 정리하세요. 숫자·날짜를 지어내지 마세요.`,
    `- 자료가 언제 기준인지(날짜)를 밝혀 주세요. 확실하지 않으면 그렇다고 말하세요.`,
    `- 한국어 높임말로, 휴대폰에서 읽기 쉽게 짧은 문단과 글머리표(- )로 씁니다. 필요하면 ## 소제목, **굵게**, 표(| 칸 | 칸 |)를 씁니다.`,
    `- 투자 권유가 아니라 자료 정리입니다. 사라·팔라고 단정하지 말고 판단에 필요한 사실과 근거를 정리하세요.`,
  ];
  if (holdings.length > 0) {
    lines.push('', `[사용자의 보유 종목] 사용자가 '내 종목·내 보유 종목'을 말하면 이 목록입니다(수량·금액은 알려 주지 않았습니다).`);
    for (const h of holdings) lines.push(`${h.code || '-'} ${h.name}`.trim());
  }
  return lines.join('\n');
}

export interface ChatMsgs { messages: { role: 'user' | 'model'; text: string }[]; holdings: { code: string; name: string }[] }

// ── OpenAI 와 같은 모양(OpenRouter·Groq·GitHub·Cerebras·Mistral·Poe·OpenAI·xAI·DeepSeek) ──
export function oaiHeaders(p: ChatProvider, key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...p.hdr, Authorization: `Bearer ${key}` };
}
export function oaiBody(p: ChatProvider, sel: ChatSel, req: ChatMsgs, today: string, web: boolean): string {
  const body: any = {
    model: sel.model,
    messages: [
      { role: 'system', content: chatSystem({ today, holdings: req.holdings, web }) },
      ...req.messages.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
    ],
    stream: true,
  };
  if (web && p.web === 'orplugin') body.plugins = [{ id: 'web', max_results: 5 }];
  return JSON.stringify(body);
}

export interface ChatGround { sources: { uri: string; title: string }[]; queries: string[]; html: string }
const addSource = (g: ChatGround, uri: unknown, title: unknown): ChatGround => {
  const u = String(uri ?? '').trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(u) || u.length > 2000 || g.sources.length >= 20 || g.sources.some(s => s.uri === u)) return g;
  return { ...g, sources: [...g.sources, { uri: u, title: String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) }] };
};
const errText = (e: any): string => String((e && typeof e === 'object' ? (e.message ?? e.code ?? e.type) : e) ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

// SSE 한 덩이 → 답 글(생각 조각 제외)·출처·오류·끝. 남는 끝줄은 rest로.
export function sseOai(buf: string, ground: ChatGround): { texts: string[]; rest: string; ground: ChatGround; err: string; done: boolean } {
  const lines = buf.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  const texts: string[] = [];
  let g = ground, err = '', done = false;
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    if (raw === '[DONE]') { done = true; continue; }
    let j: any;
    try { j = JSON.parse(raw); } catch { continue; }
    if (j?.error) { err = errText(j.error) || '오류'; continue; }
    const c = j?.choices?.[0];
    const d = c?.delta || c?.message;
    if (d && typeof d.content === 'string' && d.content) texts.push(d.content);
    for (const a of Array.isArray(d?.annotations) ? d.annotations : []) {
      const uc = a?.url_citation || a;
      if (a?.type === 'url_citation' || uc?.url) g = addSource(g, uc?.url, uc?.title);
    }
    for (const u of Array.isArray(j?.citations) ? j.citations : []) g = addSource(g, typeof u === 'string' ? u : u?.url, typeof u === 'string' ? '' : u?.title);
    for (const r of Array.isArray(j?.search_results) ? j.search_results : []) g = addSource(g, r?.url, r?.title);
    if (c?.finish_reason === 'content_filter') err = err || 'content_filter';
  }
  return { texts, rest, ground: g, err, done };
}

// ── Claude(Anthropic Messages API) ──
export interface AntOpt { maxTokens: number; tool: '' | 'web_search_20260209' | 'web_search_20250305'; fb: boolean }
export function antStart(model: string, web: boolean): AntOpt {
  return { maxTokens: 64000, tool: web ? 'web_search_20260209' : '', fb: ANT_FALLBACK_MODELS.test(model) };
}
export function antHeaders(key: string, opt: AntOpt): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
  if (opt.fb) h['anthropic-beta'] = ANT_FALLBACK_BETA;
  return h;
}
export function antBody(sel: ChatSel, req: ChatMsgs, today: string, opt: AntOpt): string {
  const body: any = {
    model: sel.model,
    max_tokens: opt.maxTokens,
    stream: true,
    system: chatSystem({ today, holdings: req.holdings, web: !!opt.tool }),
    messages: req.messages.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
  };
  if (opt.tool) body.tools = [{ type: opt.tool, name: 'web_search', max_uses: 5 }];
  if (opt.fb) body.fallbacks = 'default';
  return JSON.stringify(body);
}
// 400(또는 검색 권한 없음 403)을 보고 다음 시도를 정한다 — 거절 선택 빼기 → 답 길이 한도 줄이기 → 검색 도구 낮추기·빼기. 더 없으면 null.
export function antNext(opt: AntOpt, status: number, body: string): AntOpt | null {
  const t = String(body || '').toLowerCase();
  if (status === 403) return opt.tool && /web.?search/.test(t) ? { ...opt, tool: '' } : null;
  if (status !== 400) return null;
  if (opt.fb && /fallback|anthropic-beta/.test(t)) return { ...opt, fb: false };
  if (/max_tokens/.test(t) && opt.maxTokens > 4096) return { ...opt, maxTokens: opt.maxTokens > 16000 ? 16000 : opt.maxTokens > 8192 ? 8192 : 4096 };
  if (opt.tool === 'web_search_20260209' && /web_search|tool|code.?execution/.test(t)) return { ...opt, tool: 'web_search_20250305' };
  if (opt.tool && /web_search|tool/.test(t)) return { ...opt, tool: '' };
  return null;
}

export interface AntState { ground: ChatGround; block: string; stop: string; gap: boolean; any: boolean }
export const antInit = (): AntState => ({ ground: { sources: [], queries: [], html: '' }, block: '', stop: '', gap: false, any: false });
export function sseAnt(buf: string, st0: AntState): { texts: string[]; rest: string; st: AntState; err: string; busy: boolean; done: boolean } {
  const lines = buf.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  const texts: string[] = [];
  let st = st0, err = '', busy = false, done = false;
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    let j: any;
    try { j = JSON.parse(raw); } catch { continue; }
    const type = j?.type;
    if (type === 'content_block_start') {
      const b = j.content_block || {};
      if (b.type === 'web_search_tool_result') {
        let g = st.ground;
        for (const r of Array.isArray(b.content) ? b.content : []) if (r?.type === 'web_search_result') g = addSource(g, r.url, r.title);
        st = { ...st, ground: g, gap: st.any };
      } else if (b.type === 'server_tool_use') st = { ...st, gap: st.any };
      else if (b.type === 'text' && typeof b.text === 'string' && b.text) { texts.push((st.gap ? '\n\n' : '') + b.text); st = { ...st, gap: false, any: true }; }
    } else if (type === 'content_block_delta') {
      const d = j.delta || {};
      if (d.type === 'text_delta' && typeof d.text === 'string' && d.text) { texts.push((st.gap ? '\n\n' : '') + d.text); st = { ...st, gap: false, any: true }; }
      else if (d.type === 'citations_delta' && d.citation) st = { ...st, ground: addSource(st.ground, d.citation.url, d.citation.title) };
    } else if (type === 'message_delta') {
      const sr = String(j.delta?.stop_reason ?? '');
      if (sr) st = { ...st, stop: sr };
      if (sr === 'refusal') st = { ...st, block: String(j.delta?.stop_details?.category || 'refusal') };
    } else if (type === 'message_stop') done = true;
    else if (type === 'error') { err = errText(j.error) || '오류'; busy = j.error?.type === 'overloaded_error'; }
  }
  return { texts, rest, st, err, busy, done };
}

// ── 실패 가리기 ──
export function chatErrBrief(body: string, key = ''): string {
  const t = String(body || '').trim();
  let s = '';
  try {
    const j = JSON.parse(t);
    const o = Array.isArray(j) ? j[0] : j;
    const e = o?.error ?? o;
    s = errText(typeof e === 'string' ? e : (e?.message ?? e?.detail ?? o?.message ?? o?.detail ?? ''));
  } catch { /* JSON 아님 */ }
  if (!s) s = /^\s*</.test(t) ? '' : t.replace(/\s+/g, ' ').slice(0, 300);
  if (key && key.length >= 8) s = s.split(key).join('***');
  return s;
}
const PAY = /insufficient[_ ](quota|credits?|balance|funds)|exceeded your current quota|credit balance|billing|payment required|spend(ing)? (cap|limit)|no credits|doesn't have any credits|negative balance|top up|purchase credits/i;
const NOMODEL = /(model|deployment|bot)[^.]{0,80}(not found|not exist|does not exist|doesn't exist|invalid|unknown|not a valid|unsupported|not supported|decommission|deprecated|no endpoints|unavailable|no access|not available)|(no endpoints found|unknown model|invalid model|model_not_found)/i;
export function chatFail(status: number, body: string, key = ''): { e: string; msg: string } {
  const low = String(body || '').slice(0, 4000);
  let e = 'fail';
  if (status === 401) e = 'badkey';
  else if (status === 402) e = 'credit';
  else if (status === 403) e = PAY.test(low) ? 'credit' : /region|country|territory/i.test(low) ? 'fail' : 'badkey';
  else if (status === 429) e = PAY.test(low) ? 'credit' : 'rate';
  else if (status === 404) e = 'nomodel';
  else if (status === 400 || status === 422) e = PAY.test(low) ? 'credit' : NOMODEL.test(low) ? 'nomodel' : 'fail';
  else if (status === 408 || status === 409 || status >= 500) e = 'busy';
  return { e, msg: `${status} ${chatErrBrief(body, key)}`.trim().slice(0, 300) };
}

// ── 모델 목록 ──
const NOT_CHAT = /(embed|whisper|tts|speech|transcri|audio|dall-?e|image|imagen|moderation|rerank|guard|realtime|sora|veo|flux|diffusion|video|music|ocr)/i;
export function modelsFrom(provider: string, json: any): { id: string; name: string; free: boolean }[] {
  const arr: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const out: { id: string; name: string; free: boolean }[] = [];
  const seen = new Set<string>();
  for (const m of arr) {
    const id = String(m?.id ?? '').trim();
    if (!MODEL_RE.test(id) || seen.has(id)) continue;
    if (provider === 'openrouter') {
      const om = m?.architecture?.output_modalities;
      if (Array.isArray(om) && !om.includes('text')) continue;
    } else {
      const om = m?.supported_output_modalities;
      if (Array.isArray(om) && !om.includes('text')) continue;
      if (m?.active === false || m?.capabilities?.completion_chat === false) continue;
      if (NOT_CHAT.test(id)) continue;
    }
    seen.add(id);
    const nm = String(m?.display_name ?? (provider === 'openrouter' || provider === 'github' ? m?.name : '') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const pr = m?.pricing;
    const free = provider === 'openrouter' && (/:free$/.test(id) || id === 'openrouter/free' || (!!pr && Number(pr.prompt) === 0 && Number(pr.completion) === 0));
    out.push({ id, name: nm && nm !== id ? nm : '', free });
  }
  out.sort((a, b) => (a.free === b.free ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.free ? -1 : 1));
  return out.slice(0, 600);
}
