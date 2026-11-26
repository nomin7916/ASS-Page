// 펀드 기준가 우편함 — 앱 쪽(2026-11-26). 서버·흐름은 api/_fundFeed.ts 머리 주석, 예약 작업 지침은 docs/fund-nav-task/.
// 직접 조회(미래에셋·funetf — 직접 · 서울 중계 · /api/proxy)가 모두 막히면 api.ts가 여기서 기준가를 받는다.
// 받은 것은 다른 출처와 똑같이 {date: nav}로 돌려줄 뿐이다 — 저장(stockHistoryMap stage)은 부르는 쪽(useStockData) 그대로.
// ⚠️ 우편함 응답은 이 탭 메모리에 2분만 둔다(브라우저 저장소 금지 — 같은 기기에서 여러 계정이 번갈아 로그인한다).
// ⚠️ 열쇠 파일(fund_nav_job.json)은 관리자 본인 Drive에만 — 관리자 접속(impersonation) 중에는 만들지 않는다(App.tsx).
// ⚠️ import 0건 — scripts/verify-fund-feed.mjs가 Node 타입 스트리핑으로 직접 import한다.

// api/_fundFeed.ts CODE_RE와 같아야 한다(verify:fund-feed가 대조).
export const FUND_FEED_CODE_RE = /^(MA:[0-9A-Z]{4,8}|K[0-9A-Z]{8,13})$/;
export const FUND_JOB_FILE = 'fund_nav_job.json';
export const FUND_JOB_SITE = 'https://14ass-page-eea5.vercel.app';
export const FUND_JOB_RENEW_MS = 20 * 86_400_000; // api/_fundFeed.ts KEY_RENEW와 같다
const MEMO_MS = 120_000;
const WANT_GAP_MS = 10 * 60_000;

export const fundFeedCode = (raw: string, mirae: boolean): string => {
  const c = String(raw || '').trim().toUpperCase().replace(/^MA:/, '');
  const code = mirae ? `MA:${c}` : c;
  return FUND_FEED_CODE_RE.test(code) ? code : '';
};

// [start, end] 안의 날짜만(둘 다 'YYYY-MM-DD') — 없으면 null
export function feedSlice(rows: Record<string, number> | null | undefined, start: string, end: string): Record<string, number> | null {
  if (!rows) return null;
  const out: Record<string, number> = {};
  for (const [d, v] of Object.entries(rows)) {
    if (d >= start && d <= end && typeof v === 'number' && v > 0) out[d] = v;
  }
  return Object.keys(out).length ? out : null;
}

// 최근 날짜부터 [{date, price}] — fetchMiraeFundInfo의 basePrices 최신 2행과 같은 모양
export function feedLatest(rows: Record<string, number> | null | undefined, today: string): Array<{ date: string; price: number }> {
  if (!rows) return [];
  return Object.entries(rows)
    .filter(([d, v]) => d <= today && typeof v === 'number' && v > 0)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, price]) => ({ date, price }));
}

const memo = new Map<string, { at: number; p: Promise<Record<string, number> | null> }>();
export function fundFeedRows(code: string, now = Date.now()): Promise<Record<string, number> | null> {
  if (!FUND_FEED_CODE_RE.test(code)) return Promise.resolve(null);
  const m = memo.get(code);
  if (m && now - m.at < MEMO_MS) return m.p;
  const p = (async () => {
    try {
      const res = await fetch(`/api/fund-feed?codes=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const j = await res.json();
      const rows = j?.feed?.[code]?.rows;
      return rows && typeof rows === 'object' && Object.keys(rows).length ? rows as Record<string, number> : null;
    } catch {
      return null;
    }
  })();
  memo.set(code, { at: now, p });
  return p;
}

// 직접 조회가 막힌 코드를 우편함 목록에 올린다 — 예약 작업이 이 목록을 크롬에서 읽는다. 코드마다 10분에 한 번.
// 앱은 이 요청을 기다리지 않는다(기준가 받기를 늦추지 않으려고). 보낸 요청은 wantBusy에 두어 시험이 끝을 기다린다.
const wantAt = new Map<string, number>();
const wantBusy = new Set<Promise<void>>();
export function fundFeedWant(code: string, from: string, now = Date.now()): void {
  if (!FUND_FEED_CODE_RE.test(code)) return;
  if (now - (wantAt.get(code) || 0) < WANT_GAP_MS) return;
  wantAt.set(code, now);
  const p: Promise<void> = fetch('/api/fund-feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'want', items: [{ code, from }] }),
    signal: AbortSignal.timeout(8000),
  }).then(() => {}, () => {}).finally(() => { wantBusy.delete(p); });
  wantBusy.add(p);
}

// 시험용 — 보낸 목록 올리기가 모두 끝날 때까지(서버가 목록을 다 쓴 뒤) 기다린다
export async function _fundFeedWantSettled(): Promise<void> {
  while (wantBusy.size) await Promise.all([...wantBusy]);
}

// 시험용 — 메모리 비우기
export function _resetFundFeedMemo(): void { memo.clear(); wantAt.clear(); }

// 관리자 Drive의 열쇠 파일이 낡았는지(순수) — 없거나 · 모양이 틀리거나 · 20일 지났거나 · 사이트가 다르면 새로 받는다
export function fundJobFileStale(data: any, now = Date.now()): boolean {
  if (!data || typeof data !== 'object') return true;
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(data.key || ''))) return true;
  if (data.site !== FUND_JOB_SITE) return true;
  const at = Number(data.atMs) || 0;
  return !(at > 0 && now - at < FUND_JOB_RENEW_MS && at <= now + 60_000);
}

// 관리자 앱이 세션마다 한 번 — 열쇠 파일이 낡았으면 서버에서 새 열쇠를 받아 Drive에 쓴다.
// io.load/io.save는 App.tsx가 loadDriveFile/saveDriveFile(관리자 Index_Data 폴더)로 넣는다.
export async function ensureFundJobKeyFile(
  io: { load: () => Promise<any>; save: (data: any) => Promise<void> },
  now = Date.now(),
): Promise<'ok' | 'minted' | 'fail'> {
  let cur: any = null;
  try { cur = await io.load(); } catch { return 'fail'; } // 읽기 실패면 덮어쓰지 않는다
  if (!fundJobFileStale(cur, now)) return 'ok';
  try {
    const res = await fetch('/api/fund-feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'key' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return 'fail';
    const j = await res.json();
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(j?.key || ''))) return 'fail';
    await io.save({
      v: 1,
      key: j.key,
      site: FUND_JOB_SITE,
      atMs: now,
      at: new Date(now).toISOString(),
      note: '펀드 기준가 예약 작업 전용 열쇠(목록 읽기·기준가 넣기만). 지우거나 나누지 마세요 — 앱이 20일마다 새로 씁니다.',
    });
    return 'minted';
  } catch {
    return 'fail';
  }
}
