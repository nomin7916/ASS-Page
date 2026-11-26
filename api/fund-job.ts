// Vercel Edge Function — 펀드 기준가 우편함, 예약 작업 쪽 길(2026-11-26). 흐름·열쇠는 api/_fundFeed.ts 머리 주석.
// ⚠️ 구글 로그인 토큰이 아니라 예약 작업 열쇠로 연다(requireFundJobKey) — verify:api-auth의 JOB_ROUTES 목록에 있다.
//   크롬 예약 작업이 미래에셋·funetf 화면에서 바로 부를 수 있게 그 두 사이트에만 CORS를 연다(열쇠는 그대로 필요).
//   GET  ?op=want                          읽어야 할 목록 {today, items:[{code,from,start,end,have}]}
//   POST ?op=put {src, rows:{code:{date:nav}}}  읽은 기준가 — 목록에 있는 코드만 받는다
export const config = { runtime: 'edge' };
import { requireFundJobKey, json, corsHeaders, getWant, getNavMany, jobItems, cleanRows, putNav, normCode, kstToday, BODY_MAX } from './_fundFeed.js';

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireFundJobKey(request);
  if (denied) return denied;
  const cors = corsHeaders(request);
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  const now = Date.now();

  if (op === 'want' && request.method === 'GET') {
    const want = await getWant();
    const have = await getNavMany(Object.keys(want.items));
    return json(200, { today: kstToday(now), items: jobItems(want, have, now) }, cors);
  }

  if (op === 'put' && request.method === 'POST') {
    const text = await request.text();
    if (text.length > BODY_MAX) return json(413, { error: 'too big' }, cors);
    let b: any = {};
    try { b = JSON.parse(text); } catch { return json(400, { error: 'json' }, cors); }
    const want = await getWant();
    const src = String(b?.src || 'chrome').replace(/[^\w.:-]/g, '').slice(0, 40) || 'chrome';
    const res: Record<string, unknown> = {};
    for (const [raw, rows] of Object.entries(b?.rows && typeof b.rows === 'object' ? b.rows : {})) {
      const code = normCode(raw);
      if (!code) { res[String(raw).slice(0, 20)] = { error: 'code' }; continue; }
      if (!want.items[code]) { res[code] = { error: 'not wanted' }; continue; }
      const clean = cleanRows(rows, now);
      if (!Object.keys(clean).length) { res[code] = { error: 'no rows' }; continue; }
      const r = await putNav(code, clean, src, now);
      res[code] = r.ok ? { got: Object.keys(clean).length, added: r.added, total: r.total, last: r.last } : { error: 'store' };
    }
    return json(200, { ok: true, res }, cors);
  }

  return json(400, { error: 'op' }, cors);
}
