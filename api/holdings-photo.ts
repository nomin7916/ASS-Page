// Vercel Edge Function — 계좌 표 「📷 사진으로 보유 맞추기」(사용자 요청 2026-11-26)
// POST { kind?, account, cands:[{code,name}], images:[{mime,data(base64)}] } (+ 헤더 X-Gemini-Key = 내 키, 선택)
//   kind 'trades' = 주문·체결내역 사진(자산 평가액 추이 「주문내역 사진으로 매매 넣기」 — src/tradePhoto.ts parseTradeText 형식으로 답한다).
//   → 구글 Gemini가 잔고 사진을 읽어 parseHoldingsText(src/holdingsPhoto.ts) 형식의 줄로 답한다.
// 응답 = 줄마다 JSON 하나(NDJSON, /api/tax-photo 와 같은 모양): {"s":1} · {"k":1} · {"t":"글"} · {"m":"모델"} ·
//        {"e":"needkey"|"badkey"|"credit"|"nokey"|"rate"|"block"|"gemini","msg"} · {"d":1}. 요청 검사에서 걸리면 JSON {error} + 400/413.
// 키: 관리자 = 내 키 → 사이트 키 · 다른 사용자 = 내 키만(api/_holdingsPhoto.ts pickHoldKeys). 내 키·사진은 저장·기록하지 않는다.
export const config = { runtime: 'edge' };
import { requireAuth, callerEmail, ADMIN_EMAIL } from './_auth.js';
import { BODY_MAX, geminiKeys, sseTexts, gFirstOk, gKeyLabels } from './_taxPhoto.js';
import { USER_KEY_HEADER, userGeminiKey, pickHoldKeys, checkHoldReq, holdGeminiBody } from './_holdingsPhoto.js';

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
  if (len > BODY_MAX) return jsonRes({ error: '사진이 너무 큽니다' }, 413);
  let raw = '';
  try { raw = await request.text(); } catch { return jsonRes({ error: '요청을 읽지 못했습니다' }, 400); }
  if (raw.length > BODY_MAX) return jsonRes({ error: '사진이 너무 큽니다' }, 413);
  let body: any = null;
  try { body = JSON.parse(raw); } catch { return jsonRes({ error: '요청 형식이 틀렸습니다' }, 400); }
  raw = '';
  const req = checkHoldReq(body);
  body = null;
  if ('error' in req) return jsonRes({ error: req.error }, 400);
  const isAdmin = (await callerEmail(request)).toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const userKey = userGeminiKey(request.headers.get(USER_KEY_HEADER));
  const keys = pickHoldKeys(isAdmin, userKey, geminiKeys(process.env as Record<string, string | undefined>));
  const labels = gKeyLabels(keys, userKey);
  const gBody = holdGeminiBody(req, new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));

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
        const got = await gFirstOk({ keys, labels, body: gBody, stopOnBadRequest: true });
        if (!got.ok) { send({ e: got.e, msg: got.msg }); finish(); return; }
        send({ m: got.model });
        const reader = (got.r.body as ReadableStream<Uint8Array>).getReader();
        const dec = new TextDecoder();
        let buf = '', block = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const part = sseTexts(buf);
          buf = part.rest;
          if (part.block) block = part.block;
          for (const t of part.texts) send({ t });
        }
        const tail = sseTexts(buf + '\n');
        for (const t of tail.texts) send({ t });
        if (tail.block) block = tail.block;
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
