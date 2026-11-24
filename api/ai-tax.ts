// Vercel Edge Function — 과표 계산기 「📷 사진 맡기기」(관리자 전용, 2026-11-24). 공용 도구·흐름은 api/_aiTax.ts 머리 주석.
//   GET  ?op=status            연결 여부 · 최근 일 목록(글 없이)
//   GET  ?op=job&rid=          일 하나(끝났으면 Claude가 돌려준 글·메모 포함)
//   POST ?op=job   {code,name,year,img}  사진 맡기기 → 예약 작업 부르기
//   POST ?op=fire&rid=         다시 부르기(새 열쇠)
//   POST ?op=del&rid=          일 지우기(사진 포함)
//   POST ?op=connect {url,token}  예약 작업 연결 — 시험으로 한 번 불러 통한 것만 암호화해 둔다
//   POST ?op=disconnect
// ⚠️ 관리자(ADMIN_EMAIL)만 — 다른 사용자는 '붙여넣기'(각자 쓰는 AI)를 쓴다. 이 경로는 사용자 데이터에 쓰지 않는다.
export const config = { runtime: 'edge' };
import { requireAuth, callerEmail, ADMIN_EMAIL } from './_auth.js';
import {
  json, storeOn, CODE_RE, cleanText, imgOk, newRid, putJob, putImg, addToList, getJob, delJob, listJobs,
  summaryOf, refireBlock, activeCount, dayOk, fireJob, routineOf, trigOf, ROUTINE_TOKEN_RE, saveRoutine,
  dropRoutine, fireRoutine, testText, ACTIVE_MAX, DAY_MAX, JOB_SITE, type Job,
} from './_aiTax.js';

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireAuth(request);
  if (denied) return denied;
  if ((await callerEmail(request)) !== ADMIN_EMAIL) return json(403, { error: 'admin only' });
  if (!storeOn()) return json(503, { error: 'store' });

  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  const rid = url.searchParams.get('rid') || '';
  const origin = JOB_SITE;
  const now = Date.now();
  const post = request.method === 'POST';
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  if (op === 'status' && !post) {
    const r = await routineOf();
    const jobs = await listJobs();
    return json(200, { connected: !!r, src: r?.src || '', at: r?.at || 0, jobs: jobs.map(j => summaryOf(j, now)) });
  }

  if (op === 'job' && !post) {
    const j = await getJob(rid);
    if (!j) return json(404, { error: 'no job' });
    return json(200, { job: summaryOf(j, now), text: j.text || '' });
  }

  if (op === 'job' && post) {
    const b: any = await body();
    const code = String(b?.code || '').toUpperCase();
    const name = cleanText(b?.name, 60).replace(/\n/g, ' ');
    const year = Number(b?.year);
    const img = String(b?.img || '');
    if (!CODE_RE.test(code)) return json(400, { error: 'code' });
    if (!(year >= 2000 && year <= 2100)) return json(400, { error: 'year' });
    if (!imgOk(img)) return json(400, { error: 'img' });
    if (!(await routineOf())) return json(409, { error: 'noconn' });
    if (activeCount(await listJobs(), now) >= ACTIVE_MAX) return json(429, { error: 'busy', max: ACTIVE_MAX });
    if (!(await dayOk(now))) return json(429, { error: 'day', max: DAY_MAX });
    const j: Job = {
      v: 1, rid: newRid(now), code, name, year, kh: '', st: 'ask', at: now, fa: 0, fn: 0, fe: '', ses: '', ta: 0, da: 0,
      text: '', note: '', why: '',
    };
    if (!(await putImg(j.rid, img)) || !(await putJob(j))) return json(503, { error: 'store' });
    await addToList(j.rid);
    const f = await fireJob(j, origin, now);
    return json(200, { job: summaryOf(j, now), fired: f.ok, err: f.err });
  }

  if (op === 'fire' && post) {
    const j = await getJob(rid);
    if (!j) return json(404, { error: 'no job' });
    const why = refireBlock(j, now);
    if (why) return json(409, { error: why, job: summaryOf(j, now) });
    const f = await fireJob(j, origin, now);
    return json(200, { job: summaryOf(j, now), fired: f.ok, err: f.err });
  }

  if (op === 'del' && post) {
    await delJob(rid);
    return json(200, { ok: true });
  }

  if (op === 'connect' && post) {
    const b: any = await body();
    const id = trigOf(b?.url);
    const tok = String(b?.token || '').trim();
    if (!id) return json(400, { error: 'url' });
    if (!ROUTINE_TOKEN_RE.test(tok)) return json(400, { error: 'token' });
    const f = await fireRoutine({ id, tok, at: now, src: 'store' }, testText(origin));
    if (!f.ok) return json(200, { ok: false, err: f.err, status: f.status });
    if (!(await saveRoutine(id, tok))) return json(503, { error: 'seal' });
    return json(200, { ok: true, url: f.url });
  }

  if (op === 'disconnect' && post) {
    if (!(await dropRoutine())) return json(503, { error: 'store' });
    return json(200, { ok: true });
  }

  return json(400, { error: 'op' });
}
