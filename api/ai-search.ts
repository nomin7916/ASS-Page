// Vercel Edge Function — 「AI 검색」 채팅창(사용자 요청 2026-11-26)
// POST { messages:[{role:'user'|'model', text}], holdings?:[{code,name}] } (+ 헤더 X-Gemini-Key = 내 키)
//   → 구글 Gemini + 구글 검색 연결(google_search)로 최신 자료를 찾아 한국어로 답한다.
// 응답 = 줄마다 JSON 하나(NDJSON, /api/holdings-photo 와 같은 모양): {"s":1} · {"k":1} · {"t":"글"} · {"m":"모델"} ·
//        {"g":{sources,queries,html}} · {"e":"needkey"|"badkey"|"credit"|"nokey"|"rate"|"block"|"gemini","msg"} · {"d":1}.
//        요청 검사에서 걸리면 JSON {error} + 400/413.
// 키: 관리자 = 내 키 → 사이트 키 · 다른 사용자 = 내 키만(api/_holdingsPhoto.ts pickHoldKeys). 내 키·대화는 저장·기록하지 않는다.
export const config = { runtime: 'edge' };
import { requireAuth, callerEmail, ADMIN_EMAIL } from './_auth.js';
import { geminiKeys, gFirstOk, gKeyLabels } from './_taxPhoto.js';
import { USER_KEY_HEADER, userGeminiKey, pickHoldKeys } from './_holdingsPhoto.js';
import { SEARCH_BODY_MAX, checkSearchReq, kstDate, searchGeminiBody, sseSearch, emptyGround } from './_aiSearch.js';

const jsonRes = (o: unknown, status: number) => new Response(JSON.stringify(o), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

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
  const req = checkSearchReq(body);
  body = null;
  if ('error' in req) return jsonRes({ error: req.error }, 400);
  const isAdmin = (await callerEmail(request)).toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const userKey = userGeminiKey(request.headers.get(USER_KEY_HEADER));
  const keys = pickHoldKeys(isAdmin, userKey, geminiKeys(process.env as Record<string, string | undefined>));
  const labels = gKeyLabels(keys, userKey);
  const gBody = searchGeminiBody(req, kstDate(Date.now()));

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let closed = false;
      const send = (o: unknown) => { if (!closed) { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { closed = true; } } };
      const tick = setInterval(() => send({ k: 1 }), 8000);
      const finish = () => { clearInterval(tick); if (!closed) { closed = true; try { ctrl.close(); } catch { /* 이미 닫힘 */ } } };
      send({ s: 1 });
      if (keys.length === 0) { send({ e: isAdmin ? 'nokey' : 'needkey' }); finish(); return; }
      try {
        const got = await gFirstOk({ keys, labels, body: gBody, stopOnBadRequest: false });   // 이 모델이 검색 연결을 못 함(400)도 다음 모델로
        if (!got.ok) { send({ e: got.e, msg: got.msg }); finish(); return; }
        send({ m: got.model });
        const reader = (got.r.body as ReadableStream<Uint8Array>).getReader();
        const dec = new TextDecoder();
        let buf = '', block = '', ground = emptyGround();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const part = sseSearch(buf, ground);
          buf = part.rest;
          ground = part.ground;
          if (part.block) block = part.block;
          for (const t of part.texts) send({ t });
        }
        const tail = sseSearch(buf + '\n', ground);
        for (const t of tail.texts) send({ t });
        ground = tail.ground;
        if (tail.block) block = tail.block;
        if (ground.sources.length || ground.queries.length || ground.html) send({ g: ground });
        if (block) send({ e: 'block', msg: block });
        send({ d: 1 });
      } catch (err) {
        send({ e: 'gemini', msg: String((err as Error)?.message || err).slice(0, 200) });
      }
      finish();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
