// Vercel Edge Function — AI 검색 「클라우드 Claude」 길(2026-11-26). 흐름·열쇠는 api/_pcAsk.ts 의 '클라우드 Claude' 주석.
// ⚠️ 구글 로그인 토큰이 아니라 일마다의 열쇠로 연다(requireCloudKey) — verify:api-auth의 JOB_GUARDS 목록에 있다.
//   열쇠는 예약 작업을 부를 때 본문에만 실리고 Redis에는 해시만 있다. 이 경로는 그 질문 하나를 주고 답 하나를 받는 일만 한다.
//   GET  ?op=take&rid=<사용자>.<번호>   {id, q(질문 — 앞 대화 포함), today(KST), at}
//   POST ?op=done&rid=…  {a, m}         답(마크다운)·모델 이름 — 끝(열쇠 닫힘)
//   POST ?op=fail&rid=…  {e}            못 함 — 끝
export const config = { runtime: 'edge' };
import { requireCloudKey, cloudRidOf, cloudTake, finishJob, cleanAnswer, cleanModel, cleanFail, json, ANSWER_MAX } from './_pcAsk.js';

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireCloudKey(request);
  if (denied) return denied;
  const rid = cloudRidOf(request);
  if (!rid) return json(401, { error: 'job key required' });
  const op = new URL(request.url).searchParams.get('op') || '';
  const post = request.method === 'POST';

  if (op === 'take' && !post) {
    const t = await cloudTake(rid.u, rid.id);
    return t ? json(200, t) : json(503, { error: 'store' });
  }
  if ((op === 'done' || op === 'fail') && post) {
    if (Number(request.headers.get('content-length') || 0) > ANSWER_MAX * 4) return json(413, { error: 'too large' });
    let b: any = {};
    try { b = await request.json(); } catch { b = {}; }
    const patch = op === 'done' ? { a: cleanAnswer(b?.a), m: cleanModel(b?.m) } : { e: cleanFail(b?.e) || '까닭 없음' };
    if (op === 'done' && !patch.a) return json(400, { error: 'answer' });
    const r = await finishJob(rid.u, rid.id, patch);
    return r === 'ok' ? json(200, { ok: true }) : json(r === 'store' ? 503 : 409, { error: r });
  }
  return json(400, { error: 'op' });
}
