// Vercel Edge Function — 「내 PC가 구독 AI에 묻기」 PC 쪽 길(2026-11-26). 흐름·열쇠는 api/_pcAsk.ts 머리 주석.
// ⚠️ 구글 로그인 토큰이 아니라 PC 열쇠로 연다(requirePcKey) — verify:api-auth의 JOB_GUARDS 목록에 있다. PC는 curl로 부른다(CORS 없음).
//   POST ?op=take                         맡겨 둔 질문 하나 {id, target, label, url, prompt, at} | {none:true}
//   POST ?op=done&id=…&model=…  (본문 = 답 글 그대로, text/plain)
//   POST ?op=fail&id=…          (본문 = 까닭 한 줄)
//   GET  ?op=ping                         연결 시험 {ok:true}
export const config = { runtime: 'edge' };
import { requirePcKey, pcUserOf, json, takeJob, finishJob, touchSeen, pcTarget, cleanAnswer, cleanModel, cleanFail, ANSWER_MAX } from './_pcAsk.js';

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
  if (request.method !== 'POST') return json(405, { error: 'POST' });

  if (op === 'take') {
    await touchSeen(u, now);
    const job = await takeJob(u, now);
    if (job === undefined) return json(503, { error: 'store' });
    if (!job) return json(200, { none: true });
    const t = pcTarget(job.t);
    return json(200, { id: job.id, target: job.t, label: t ? t.label : job.t, url: t ? t.url : '', prompt: job.p, at: job.at });
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
