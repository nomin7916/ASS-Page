// Vercel Edge Function — 「AI 검색」 채팅창의 '다른 AI'(사용자 요청 2026-11-26: 여러 AI를 각 사용자가 자기 계정으로)
// POST { op:'chat', provider, model, web?, messages:[{role:'user'|'model', text}], holdings?:[{code,name}] } (+ 헤더 X-AI-Key = 내 키)
//   → 그 회사 API(OpenRouter·Groq·GitHub Models·Cerebras·Mistral·Poe·Claude·OpenAI·xAI·DeepSeek)로 전달하고 답을 받는 대로 흘려 준다.
// POST { op:'models', provider } (+ X-AI-Key) → 그 키로 쓸 수 있는 모델 목록 JSON { models:[{id,name,free}] } 또는 { error, msg }(키 시험을 겸한다).
// 응답(chat) = NDJSON(/api/ai-search 와 같은 모양): {"s":1} · {"k":1} · {"t":"글"} · {"m":"모델"} · {"g":{sources}} ·
//        {"e":"needkey"|"badkey"|"credit"|"rate"|"nomodel"|"busy"|"block"|"fail","msg"} · {"d":1}. 요청 검사에서 걸리면 JSON {error} + 400/413.
// ⚠️ 보낼 곳은 api/_aiChat.ts CHAT_PROVIDERS 표의 주소뿐 · 사이트 키 없음(누구든 자기 키) · 키·대화를 저장·기록하지 않는다.
export const config = { runtime: 'edge' };
import { requireAuth } from './_auth.js';
import { SEARCH_BODY_MAX, checkSearchReq, kstDate } from './_aiSearch.js';
import {
  AI_KEY_HEADER, userAiKey, CHAT_PROVIDERS, checkChatSel, oaiHeaders, oaiBody, sseOai,
  antStart, antHeaders, antBody, antNext, antInit, sseAnt, chatFail, modelsFrom,
} from './_aiChat.js';

const jsonRes = (o: unknown, status: number) => new Response(JSON.stringify(o), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const ERR_BODY_MAX = 20_000;
const readErr = async (r: Response) => { try { return (await r.text()).slice(0, ERR_BODY_MAX); } catch { return ''; } };

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireAuth(request);
  if (denied) return denied;
  if (request.method !== 'POST') return jsonRes({ error: 'POST만 받습니다' }, 405);
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs === 'cross-site' || sfs === 'same-site') return new Response('Forbidden', { status: 403 });

  const len = Number(request.headers.get('content-length') || 0);
  if (len > SEARCH_BODY_MAX) return jsonRes({ error: '대화가 너무 깁니다 — 새 대화로 물어봐 주세요' }, 413);
  let raw = '';
  try { raw = await request.text(); } catch { return jsonRes({ error: '요청을 읽지 못했습니다' }, 400); }
  if (raw.length > SEARCH_BODY_MAX) return jsonRes({ error: '대화가 너무 깁니다 — 새 대화로 물어봐 주세요' }, 413);
  let body: any = null;
  try { body = JSON.parse(raw); } catch { return jsonRes({ error: '요청 형식이 틀렸습니다' }, 400); }
  raw = '';
  const sel = checkChatSel(body);
  if ('error' in sel) return jsonRes({ error: sel.error }, 400);
  const p = CHAT_PROVIDERS[sel.provider];
  const key = userAiKey(request.headers.get(AI_KEY_HEADER));
  // 화면으로 보내는 오류 글 — 회사가 내 키를 되돌려 적어도 가린다
  const hide = (v: unknown) => { const t = String(v ?? ''); return (key ? t.split(key).join('***') : t).slice(0, 300); };

  if (sel.op === 'models') {
    if (!key) return jsonRes({ error: 'needkey' }, 200);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    try {
      const headers = p.kind === 'anthropic' ? antHeaders(key, { maxTokens: 0, tool: '', fb: false }) : { ...oaiHeaders(p, key), Accept: p.hdr.Accept || 'application/json' };
      const r = await fetch(p.models, { method: 'GET', headers, redirect: 'error', signal: ac.signal });
      if (!r.ok) { const f = chatFail(r.status, await readErr(r), key); return jsonRes({ error: f.e === 'nomodel' ? 'fail' : f.e, msg: f.msg }, 200); }
      let j: any = null;
      try { j = await r.json(); } catch { return jsonRes({ error: 'fail', msg: '모델 목록을 읽지 못했습니다' }, 200); }
      return jsonRes({ models: modelsFrom(sel.provider, j) }, 200);
    } catch (err) {
      return jsonRes({ error: 'busy', msg: hide((err as Error)?.message || err) }, 200);
    } finally { clearTimeout(timer); }
  }

  const req = checkSearchReq(body);
  body = null;
  if ('error' in req) return jsonRes({ error: req.error }, 400);
  const today = kstDate(Date.now());

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let closed = false;
      const send = (o: unknown) => { if (!closed) { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { closed = true; } } };
      const tick = setInterval(() => send({ k: 1 }), 8000);
      const finish = () => { clearInterval(tick); if (!closed) { closed = true; try { ctrl.close(); } catch { /* 이미 닫힘 */ } } };
      send({ s: 1 });
      if (!key) { send({ e: 'needkey' }); finish(); return; }
      try {
        let r: Response;
        let webOn = false;
        if (p.kind === 'anthropic') {
          let opt = antStart(sel.model, sel.web);
          for (let i = 0; ; i++) {
            r = await fetch(p.chat, { method: 'POST', headers: antHeaders(key, opt), body: antBody(sel, req, today, opt), redirect: 'error', signal: request.signal });
            if (r.ok && r.body) break;
            const text = await readErr(r);
            const next = i < 6 ? antNext(opt, r.status, text) : null;
            if (!next) { const f = chatFail(r.status, text, key); send({ e: f.e, msg: f.msg }); finish(); return; }
            opt = next;
          }
          webOn = !!opt.tool;
        } else {
          webOn = sel.web && p.web === 'orplugin';
          r = await fetch(p.chat, { method: 'POST', headers: oaiHeaders(p, key), body: oaiBody(p, sel, req, today, webOn), redirect: 'error', signal: request.signal });
          if (!r.ok || !r.body) { const f = chatFail(r.status, await readErr(r), key); send({ e: f.e, msg: f.msg }); finish(); return; }
        }
        send({ m: webOn ? `${sel.model} + 웹 검색` : sel.model });
        const reader = (r.body as ReadableStream<Uint8Array>).getReader();
        const dec = new TextDecoder();
        let buf = '', err = '', busy = false, done = false, got = false;
        let ground = antInit().ground;
        let ast = antInit();
        const step = (chunk: string) => {
          if (p.kind === 'anthropic') {
            const part = sseAnt(chunk, ast);
            ast = part.st; ground = ast.ground;
            if (part.err) { err = part.err; busy = part.busy; }
            if (part.done) done = true;
            for (const t of part.texts) { got = true; send({ t }); }
            return part.rest;
          }
          const part = sseOai(chunk, ground);
          ground = part.ground;
          if (part.err) err = part.err;
          if (part.done) done = true;
          for (const t of part.texts) { got = true; send({ t }); }
          return part.rest;
        };
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf = step(buf + dec.decode(value, { stream: true }));
        }
        step(buf + '\n');
        if (ground.sources.length) send({ g: ground });
        if (ast.block) send({ e: 'block', msg: hide(ast.block) });
        else if (err) send({ e: err === 'content_filter' ? 'block' : busy ? 'busy' : 'fail', msg: hide(err) });
        // 끝 표시({d}) — 오류 없이 끝까지 왔을 때만. Claude 가 쉬어 가기(pause_turn)로 멈췄으면 끊긴 답으로 둔다.
        const fin = p.kind === 'anthropic' ? done : (done || got);
        if (!err && !ast.block && ast.stop !== 'pause_turn' && fin) send({ d: 1 });
      } catch (err) {
        send({ e: 'fail', msg: hide((err as Error)?.message || err) });
      }
      finish();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
