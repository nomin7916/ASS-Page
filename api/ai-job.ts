// Vercel Edge Function — Claude 예약 작업 "[ASS-PAGE-과표 사진 읽기 · API]" 전용 길(2026-11-24). 흐름은 api/_aiTax.ts 머리 주석.
// ⚠️ 구글 로그인 토큰이 아니라 일마다의 열쇠로 연다(requireJobKey) — verify:api-auth의 JOB_ROUTES 목록에 있는 유일한 경로.
//   열쇠는 예약 작업을 부를 때 본문에만 실리고 Redis에는 해시만 있다. 이 경로는 그 일의 사진을 주고 글을 받는 일만 한다
//   (사용자 데이터·Drive·다른 키에 닿지 않는다).
//   GET  ?op=take&rid=   사진(base64)·종목·연도·오늘(KST) — 읽는 중으로 바뀐다
//   POST ?op=put&rid=  {text,note}  읽은 글(과표 계산기 '붙여넣기' 형식)·메모 — 끝, 사진 지움
//   POST ?op=fail&rid= {why}        못 함 — 끝, 사진 지움
export const config = { runtime: 'edge' };
import { requireJobKey, json, getJob, putJob, getImg, delImg, imgMime, cleanText, tickerToIsin, kstToday, TEXT_MAX, NOTE_MAX } from './_aiTax.js';

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireJobKey(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  const j = await getJob(url.searchParams.get('rid') || '');
  if (!j) return json(404, { error: 'no job' });
  const now = Date.now();
  const post = request.method === 'POST';
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  if (op === 'take' && !post) {
    const img = await getImg(j.rid);
    if (!img) return json(410, { error: 'photo gone' });
    j.st = 'run';
    j.ta = now;
    if (!(await putJob(j))) return json(503, { error: 'store' });
    return json(200, {
      rid: j.rid, code: j.code, isin: tickerToIsin(j.code), name: j.name, year: j.year, today: kstToday(now),
      mime: imgMime(img), img,
    });
  }

  if (op === 'put' && post) {
    const b: any = await body();
    const text = cleanText(b?.text, TEXT_MAX);
    if (!text) return json(400, { error: 'text' });
    j.st = 'done';
    j.da = now;
    j.text = text;
    j.note = cleanText(b?.note, NOTE_MAX);
    if (!(await putJob(j))) return json(503, { error: 'store' });
    await delImg(j.rid);
    return json(200, { ok: true });
  }

  if (op === 'fail' && post) {
    const b: any = await body();
    j.st = 'err';
    j.da = now;
    j.why = cleanText(b?.why, NOTE_MAX) || '까닭 없음';
    if (!(await putJob(j))) return json(503, { error: 'store' });
    await delImg(j.rid);
    return json(200, { ok: true });
  }

  return json(400, { error: 'op' });
}
