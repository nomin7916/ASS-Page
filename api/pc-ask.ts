// Vercel Edge Function — 「내 PC가 구독 AI에 묻기」 창 쪽 길(2026-11-26). 흐름·열쇠는 api/_pcAsk.ts 머리 주석.
// POST { op } — 사용자 = 로그인 토큰의 이메일(사용자마다 우편함이 따로다).
//   status → {linked, keyAt, seen} · newkey → {key}(한 번만 보여 줌 · 앞 열쇠는 바로 끝) · unlink
//   ask {target, prompt} → {id} · get {ids:[…]} → {jobs, seen} · cancel {id}
export const config = { runtime: 'edge' };
import { requireAuth, callerEmail } from './_auth.js';
import { json, storeOn, userTag, pcStatus, mintPcKey, unlinkPc, checkAsk, askJob, jobsView, cancelJob, PROMPT_MAX } from './_pcAsk.js';

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
  let b: any = null;
  try {
    const raw = await request.text();
    if (raw.length > PROMPT_MAX * 3) return json(413, { error: '질문이 너무 깁니다' });
    b = JSON.parse(raw);
  } catch { return json(400, { error: '요청 형식이 틀렸습니다' }); }
  const op = String(b?.op || '');

  if (op === 'status') {
    const s = await pcStatus(u);
    return s.store ? json(200, { linked: s.linked, keyAt: s.keyAt, seen: s.seen }) : json(503, { error: '우편함에 닿지 못했습니다', code: 'store' });
  }
  if (op === 'newkey') {
    const key = await mintPcKey(u);
    return key ? json(200, { key }) : json(503, { error: '열쇠를 만들지 못했습니다', code: 'store' });
  }
  if (op === 'unlink') return (await unlinkPc(u)) ? json(200, { ok: true }) : json(503, { error: '우편함에 닿지 못했습니다', code: 'store' });
  if (op === 'ask') {
    const c = checkAsk(b);
    if ('error' in c) return json(400, { error: c.error, code: 'bad' });
    const r = await askJob(u, c.t, c.p);
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
