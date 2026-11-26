// Vercel Edge Function — 펀드 기준가 우편함, 앱 쪽 길(2026-11-26). 흐름·열쇠는 api/_fundFeed.ts 머리 주석.
//   GET  ?codes=MA:53663O,…[&from=YYYY-MM-DD]  받아 둔 기준가 {feed:{code:{rows,at,src}}} (코드 20개까지)
//   POST {op:'want', items:[{code,from}]}       직접 조회가 막힌 코드를 목록에 올린다(승인된 사용자 누구나 — 기준가는 공개 자료)
//   POST {op:'key'}                              관리자만 — 예약 작업 열쇠를 새로 받는다(앱이 관리자 Drive에만 둔다)
//   GET  ?op=status                              관리자만 — 목록·받아 둔 범위·열쇠 받은 때(열쇠는 싣지 않는다)
export const config = { runtime: 'edge' };
import { requireAuth, callerEmail, ADMIN_EMAIL } from './_auth.js';
import {
  json, storeOn, normCode, validDate, getNavMany, addWant, getWant, jobItems, mintKey, getKeyRec, rowsSummary,
  CODES_MAX, JOB_SITE,
} from './_fundFeed.js';

export default async function handler(request: Request): Promise<Response> {
  const denied = await requireAuth(request);
  if (denied) return denied;
  if (!storeOn()) return json(503, { error: 'store' });
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  const post = request.method === 'POST';
  const now = Date.now();

  if (!post && op === 'status') {
    if ((await callerEmail(request)) !== ADMIN_EMAIL) return json(403, { error: 'admin only' });
    const want = await getWant();
    const have = await getNavMany(Object.keys(want.items));
    const k = await getKeyRec();
    return json(200, { items: jobItems(want, have, now), keyAt: k?.at || 0 });
  }

  if (!post) {
    const codes = [...new Set((url.searchParams.get('codes') || '').split(',').map(normCode).filter(Boolean))].slice(0, CODES_MAX);
    if (!codes.length) return json(400, { error: 'codes' });
    const from = url.searchParams.get('from') || '';
    const recs = await getNavMany(codes);
    const feed: Record<string, unknown> = {};
    for (const [c, r] of Object.entries(recs)) {
      const rows = validDate(from)
        ? Object.fromEntries(Object.entries(r.rows).filter(([d]) => d >= from))
        : r.rows;
      feed[c] = { rows, at: r.at, src: r.src, have: rowsSummary(r.rows) };
    }
    return json(200, { feed });
  }

  let b: any = {};
  try { b = await request.json(); } catch { b = {}; }

  if (b?.op === 'want') {
    const ok = await addWant(b?.items, now);
    return ok ? json(200, { ok: true }) : json(503, { error: 'store' });
  }

  if (b?.op === 'key') {
    if ((await callerEmail(request)) !== ADMIN_EMAIL) return json(403, { error: 'admin only' });
    const key = await mintKey(now);
    return key ? json(200, { key, site: JOB_SITE, at: now }) : json(503, { error: 'store' });
  }

  return json(400, { error: 'op' });
}
