// Vercel Edge Function — 「내 PC가 구독 AI에 묻기」 창 쪽 길(2026-11-26). 흐름·열쇠는 api/_pcAsk.ts 머리 주석.
// POST { op } — 사용자 = 로그인 토큰의 이메일(사용자마다 우편함이 따로다).
//   status → {linked, keyAt, seen} · newkey → {key}(한 번만 보여 줌 · 앞 열쇠는 바로 끝) · unlink
//   ask {target, prompt, imgs?} → {id} · get {ids:[…]} → {jobs, seen} · cancel {id}
//   imgs = [{mime, data(base64)}] 4장까지 — 사진이 든 질문은 PC의 Claude만(자산 평가액 추이 「주문내역 사진」, 2026-11-26)
//   ⚠️ 사진이 든 질문은 관리자만(사용자 확정 2026-11-26 — 다른 사용자는 각자 쓰는 AI 앱으로 읽어 답을 붙여 넣는다) → 403 code 'admin'
//   ask {target:'claude', prompt, cloud:true} = 클라우드 Claude(관리자만 · PC 없이 — 학습 사이트처럼 Claude 예약 작업을 API로 부른다)
//     → 같은 우편함 번호 · status 의 cloud = 부를 수 있는가(관리자 + 예약 작업 연결됨)
export const config = { runtime: 'edge' };
import { requireAuth, callerEmail, ADMIN_EMAIL } from './_auth.js';
import { json, storeOn, userTag, pcStatus, mintPcKey, unlinkPc, checkAsk, askJob, jobsView, cancelJob, askCloudJob, cloudFireText, finishJob, ASK_BODY_MAX } from './_pcAsk.js';
import { routineOf, fireRoutine, JOB_SITE } from './_aiTax.js';

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireAuth(request);
  if (denied) return denied;
  if (request.method !== 'POST') return json(405, { error: 'POST만 받습니다' });
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs === 'cross-site' || sfs === 'same-site') return new Response('Forbidden', { status: 403 });
  if (!storeOn()) return json(503, { error: '우편함(Redis)이 설정되지 않았습니다', code: 'store' });
  const email = await callerEmail(request);
  if (!email) return json(401, { error: '로그인이 확인되지 않았습니다' });
  const u = await userTag(email);
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (Number(request.headers.get('content-length') || 0) > ASK_BODY_MAX) return json(413, { error: '사진·질문이 너무 큽니다' });
  let b: any = null;
  try {
    const raw = await request.text();
    if (raw.length > ASK_BODY_MAX) return json(413, { error: '사진·질문이 너무 큽니다' });
    b = JSON.parse(raw);
  } catch { return json(400, { error: '요청 형식이 틀렸습니다' }); }
  const op = String(b?.op || '');

  if (op === 'status') {
    const s = await pcStatus(u);
    const cloud = isAdmin && !!(await routineOf());
    return s.store ? json(200, { linked: s.linked, keyAt: s.keyAt, seen: s.seen, cloud }) : json(503, { error: '우편함에 닿지 못했습니다', code: 'store' });
  }
  if (op === 'newkey') {
    const key = await mintPcKey(u);
    return key ? json(200, { key }) : json(503, { error: '열쇠를 만들지 못했습니다', code: 'store' });
  }
  if (op === 'unlink') return (await unlinkPc(u)) ? json(200, { ok: true }) : json(503, { error: '우편함에 닿지 못했습니다', code: 'store' });
  if (op === 'ask') {
    const c = checkAsk(b);
    if ('error' in c) return json(400, { error: c.error, code: 'bad' });
    if (b?.cloud === true) {
      if (!isAdmin) return json(403, { error: '클라우드 Claude는 관리자만 씁니다', code: 'admin' });
      if (c.t !== 'claude' || c.imgs.length > 0) return json(400, { error: '클라우드 Claude는 글 질문만 받습니다', code: 'bad' });
      const rt = await routineOf();
      if (!rt) return json(409, { error: 'Claude 예약 작업이 연결되지 않았습니다', code: 'noroutine' });
      const r = await askCloudJob(u, c.p);
      if ('error' in r) return json(r.code === 'store' ? 503 : 429, r);
      const f = await fireRoutine(rt, cloudFireText(JOB_SITE, `${u}.${r.id}`, r.key));
      if (!f.ok) {
        const code = f.err === 'rate' ? 'crate' : f.err === 'token' || f.err === 'trigger' ? 'ctoken' : 'cfire';
        await finishJob(u, r.id, { e: `Claude 예약 작업을 부르지 못했습니다(${f.err}${f.status ? ` ${f.status}` : ''})` });
        return json(502, { error: 'Claude 예약 작업을 부르지 못했습니다', code, id: r.id });
      }
      return json(200, { id: r.id, cloud: true });
    }
    if (c.imgs.length > 0 && !isAdmin) return json(403, { error: '사진 읽기(내 PC)는 관리자만 씁니다', code: 'admin' });
    const r = await askJob(u, c.t, c.p, Date.now(), c.imgs);
    if ('error' in r) return json(r.code === 'store' ? 503 : r.code === 'nopc' ? 409 : 429, r);
    return json(200, r);
  }
  if (op === 'get') {
    const v = await jobsView(u, Array.isArray(b?.ids) ? b.ids.map(String) : []);
    return v.store ? json(200, { jobs: v.jobs, seen: v.seen }) : json(503, { error: '우편함에 닿지 못했습니다', code: 'store' });
  }
  if (op === 'cancel') return json(200, { ok: await cancelJob(u, String(b?.id || '')) });
  return json(400, { error: 'op' });
}
