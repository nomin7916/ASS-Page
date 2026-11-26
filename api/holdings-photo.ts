// Vercel Edge Function — 계좌 표 「📷 사진으로 보유 맞추기」(사용자 요청 2026-11-26)
// POST { account, cands:[{code,name}], images:[{mime,data(base64)}] } (+ 헤더 X-Gemini-Key = 내 키, 선택)
//   → 구글 Gemini가 잔고 사진을 읽어 parseHoldingsText(src/holdingsPhoto.ts) 형식의 줄로 답한다.
// 응답 = 줄마다 JSON 하나(NDJSON, /api/tax-photo 와 같은 모양): {"s":1} · {"k":1} · {"t":"글"} · {"m":"모델"} ·
//        {"e":"needkey"|"badkey"|"nokey"|"rate"|"block"|"gemini","msg"} · {"d":1}. 요청 검사에서 걸리면 JSON {error} + 400/413.
// 키: 관리자 = 내 키 → 사이트 키 · 다른 사용자 = 내 키만(api/_holdingsPhoto.ts pickHoldKeys). 내 키·사진은 저장·기록하지 않는다.
export const config = { runtime: 'edge' };
import { requireAuth, callerEmail, ADMIN_EMAIL } from './_auth.js';
import { GAPI, GMODELS, GKEYBAD, BODY_MAX, geminiKeys, sseTexts } from './_taxPhoto.js';
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
  const gBody = holdGeminiBody(req);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let closed = false;
      const send = (o: unknown) => { if (!closed) { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { closed = true; } } };
      const tick = setInterval(() => send({ k: 1 }), 8000);
      const finish = () => { clearInterval(tick); if (!closed) { closed = true; try { ctrl.close(); } catch { /* 이미 닫힘 */ } } };
      send({ s: 1 });
      if (keys.length === 0) { send({ e: isAdmin ? 'nokey' : 'needkey' }); finish(); return; }
      const badKeys = new Set<string>();
      let last = { status: 0, msg: '' };
      try {
        for (const model of GMODELS) {
          for (const key of keys) {
            if (badKeys.has(key)) continue;
            let r: Response;
            try {
              r = await fetch(`${GAPI}/models/${model}:streamGenerateContent?alt=sse`, {
                method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: gBody,
              });
            } catch { last = { status: 0, msg: 'net' }; continue; }
            if (r.ok && r.body) {
              send({ m: model });
              const reader = r.body.getReader();
              const dec = new TextDecoder();
              let buf = '', block = '';
              for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                const got = sseTexts(buf);
                buf = got.rest;
                if (got.block) block = got.block;
                for (const t of got.texts) send({ t });
              }
              const tail = sseTexts(buf + '\n');
              for (const t of tail.texts) send({ t });
              if (tail.block) block = tail.block;
              if (block) send({ e: 'block', msg: block });
              send({ d: 1 });
              finish();
              return;
            }
            const t = (await r.text().catch(() => '')).slice(0, 600);
            last = { status: r.status, msg: t.replace(/\s+/g, ' ').slice(0, 300) };
            if ((r.status === 400 || r.status === 403) && GKEYBAD.test(t)) { badKeys.add(key); continue; }   // 틀린 키 — 다른 모델로도 다시 쓰지 않는다
            if (r.status === 429) continue;
            if (r.status === 404 || r.status >= 500) break;   // 없는 모델·잠깐 안 됨 → 다음 모델
            send({ e: 'gemini', msg: `${r.status} ${last.msg}` });   // 400 등 — 요청이 틀렸다(다른 키로도 같다)
            finish();
            return;
          }
          if (keys.every(k => badKeys.has(k))) break;
          // 모든 키가 한도(429)여도 다음 모델로 — 무료 한도는 모델마다 따로다
        }
        const allBad = keys.every(k => badKeys.has(k));
        send({ e: allBad ? 'badkey' : (last.status === 429 ? 'rate' : 'gemini'), msg: `${last.status} ${last.msg}`.trim() });
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
