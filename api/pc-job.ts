// Vercel Edge Function — 「내 PC가 구독 AI에 묻기」 PC 쪽 길(2026-11-26). 흐름·열쇠는 api/_pcAsk.ts 머리 주석.
// ⚠️ 구글 로그인 토큰이 아니라 PC 열쇠로 연다(requirePcKey) — verify:api-auth의 JOB_GUARDS 목록에 있다. PC는 curl로 부른다(CORS 없음).
//   POST ?op=take                         맡겨 둔 질문 하나 {id, target, label, url, prompt, at, imgs, (사진이 있으면) imgUrls, imgHow} | {none:true}
//   POST ?op=done&id=…&model=…  (본문 = 답 글 그대로, text/plain)
//   POST ?op=fail&id=…          (본문 = 까닭 한 줄)
//   GET  ?op=ping                         연결 시험 {ok:true}
//   GET  ?op=img&id=…&n=…                 질문에 든 사진 n번째(그림 자체 · take가 알려 준 imgs 수만큼)
export const config = { runtime: 'edge' };
import { requirePcKey, pcUserOf, json, takeJob, finishJob, touchSeen, pcTarget, cleanAnswer, cleanModel, cleanFail, jobImage, takeImgInfo, ANSWER_MAX } from './_pcAsk.js';

export default async function handler(request: Request): Promise<Response> {
  const denied = await requirePcKey(request);
  if (denied) return denied;
  const u = pcUserOf(request);
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  const now = Date.now();

  if (op === 'ping') {
    await touchSeen(u, now);
    return json(200, { ok: true });
  }
  if (op === 'img' && request.method === 'GET') {
    const got = await jobImage(u, url.searchParams.get('id') || '', Number(url.searchParams.get('n') || 0));
    if (got === undefined) return json(503, { error: 'store' });
    if (!got) return json(404, { error: 'no image' });
    let bytes: Uint8Array;
    try { const bin = atob(got.b64); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
    catch { return json(500, { error: 'image' }); }
    return new Response(bytes, { status: 200, headers: { 'Content-Type': got.mime, 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST') return json(405, { error: 'POST' });

  if (op === 'take') {
    await touchSeen(u, now);
    const job = await takeJob(u, now);
    if (job === undefined) return json(503, { error: 'store' });
    if (!job) return json(200, { none: true });
    const t = pcTarget(job.t);
    // 사진이 든 질문 = 받는 주소·받는 법을 함께 싣는다(사진 규칙 전에 연결한 PC 대화도 받게 — _pcAsk.takeImgInfo 주석).
    const img = takeImgInfo(url.origin, job.id, Number(job.ni) || 0);
    return json(200, { id: job.id, target: job.t, label: t ? t.label : job.t, url: t ? t.url : '', prompt: job.p, at: job.at, imgs: Number(job.ni) || 0, ...(img || {}) });
  }

  if (op === 'done' || op === 'fail') {
    const id = url.searchParams.get('id') || '';
    const text = await request.text();
    if (text.length > ANSWER_MAX * 2) return json(413, { error: 'too big' });
    const patch = op === 'done'
      ? { a: cleanAnswer(text), m: cleanModel(url.searchParams.get('model')) }
      : { e: cleanFail(text) };
    if (op === 'done' && !patch.a) return json(400, { error: 'empty answer' });
    const r = await finishJob(u, id, patch, now);
    if (r === 'ok') return json(200, { ok: true });
    if (r === 'store') return json(503, { error: 'store' });
    return json(409, { error: r });
  }

  return json(400, { error: 'op' });
}
