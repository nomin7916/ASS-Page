// Vercel Edge Function — 평균 과표 계산기 '사진으로 넣기'(사용자 요청 2026-11-24)
// POST { name, code, year, images:[{mime,data(base64)}] } → 구글 Gemini가 사진을 읽어 parseTaxCalcPaste 형식의 줄로 답한다.
// 응답 = 줄마다 JSON 하나(NDJSON): {"s":1} 시작 · {"k":1} 기다리는 중 · {"t":"글"} 받은 글 · {"m":"모델"} ·
//        {"e":"nokey"|"badkey"|"credit"|"rate"|"block"|"gemini","msg"} 실패 · {"d":1} 끝. 요청 검사에서 걸리면 JSON {error} + 400/413.
// ⚠️ 사진은 저장하지 않는다(서버 메모리에서 Gemini로 넘길 뿐 — 서버·Drive·기록 0). 키는 Vercel 환경 변수
//    GEMINI_API_KEY(2~9 더 넣으면 한도·틀린 키일 때 다음 키). 응답은 바로 흘려보낸다(Edge는 25초 안에 응답을 시작해야 한다).

export const config = { runtime: 'edge' };
import { requireAuth } from './_auth.js';
import { GAPI, GMODELS, BODY_MAX, geminiKeys, checkPhotoReq, geminiBody, sseTexts, gKeyDead, gErrBrief, gFailCode } from './_taxPhoto.js';

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
  const thisYear = Number(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 4));
  const req = checkPhotoReq(body, thisYear);
  body = null;
  if ('error' in req) return jsonRes({ error: req.error }, 400);
  const keys = geminiKeys(process.env as Record<string, string | undefined>);
  const gBody = geminiBody(req);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let closed = false;
      const send = (o: unknown) => { if (!closed) { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { closed = true; } } };
      const tick = setInterval(() => send({ k: 1 }), 8000);
      const finish = () => { clearInterval(tick); if (!closed) { closed = true; try { ctrl.close(); } catch { /* 이미 닫힘 */ } } };
      send({ s: 1 });
      if (keys.length === 0) { send({ e: 'nokey' }); finish(); return; }
      const dead = new Map<string, string>();   // 죽은 키 → 'bad'(틀림)·'credit'(선불 크레딧 소진) — 다른 모델로도 다시 쓰지 않는다
      let last = { status: 0, msg: '' };
      try {
        for (const model of GMODELS) {
          for (const key of keys) {
            if (dead.has(key)) continue;
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
            last = { status: r.status, msg: gErrBrief(t) };
            const why = gKeyDead(r.status, t);
            if (why) { dead.set(key, why); continue; }   // 틀린 키·선불 크레딧 소진(402) → 다음 키
            if (r.status === 429) continue;
            if (r.status === 404 || r.status >= 500) break;   // 없는 모델·잠깐 안 됨 → 다음 모델
            send({ e: 'gemini', msg: `${r.status} ${last.msg}` });   // 400 등 — 요청이 틀렸다(다른 키로도 같다)
            finish();
            return;
          }
          if (keys.every(k => dead.has(k))) break;
          // 모든 키가 한도(429)여도 다음 모델로 — 무료 한도는 모델마다 따로다
        }
        send({ e: gFailCode(keys, dead, last.status), msg: `${last.status} ${last.msg}`.trim() });
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
