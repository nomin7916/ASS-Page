// 시장지표 이력 커버리지 — 조회기간 대비 '비어 있는 구간'을 계산하는 순수 모듈.
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-indicators.mjs가 미러 없이 직접 import한다.
//
// 발단(사용자 보고 2026-10): 조회기간이 2004년부터인데 VIX 등 시장지표가 2015년 이후만 있어 차트 앞쪽이 비었다.
//   옛 자동 수집은 "데이터 없음 또는 최신일이 3일 이상 지남"만 봐서, 이미 일부라도 있는 지표의 **앞쪽·중간
//   공백**은 영영 채우지 않았다. 이 모듈은 머리(조회 시작~보유 최초일) · 내부 공백 · 꼬리(보유 최신일~오늘)
//   세 종류의 빈 구간을 날짜로 돌려주고, 훅이 그 구간만 서버에서 받아 병합한다(전량 재조회 아님).

export const INDICATOR_HEAD_TOL_DAYS = 7;     // 조회 시작일이 주말·휴장일이어도 '부족'으로 보지 않는 여유
export const INDICATOR_GAP_DAYS = 45;         // 이보다 긴 내부 공백만 구멍 — 월별 시계열(FRED 월간)은 건드리지 않는다
export const INDICATOR_TAIL_STALE_DAYS = 4;   // 주말·하루 늦게 나오는 FRED 시계열은 '오래됨'으로 보지 않는다
export const INDICATOR_TAIL_OVERLAP_DAYS = 5; // 꼬리 재조회는 며칠 겹쳐서 받는다(장중 잠정값 보정)
export const MAX_GAP_SEGMENTS = 4;            // 한 번에 채우는 내부 공백 수 상한(큰 것부터)

// 소스가 원리적으로 그보다 과거 값을 줄 수 없는 날짜 — 그 앞을 '부족'으로 보면 매 세션 헛조회가 난다.
export const INDICATOR_SOURCE_FLOOR: Record<string, string> = {
  btc: '2014-09-17',      // Yahoo BTC-USD 최초일
  eth: '2017-11-09',      // Yahoo ETH-USD 최초일
  goldIntl: '2000-08-30', // Yahoo GC=F 최초일
  vix: '1990-01-02',
  fedRate: '1982-09-27',  // FRED DFEDTAR 최초일
  goldKr: '2008-01-02',   // 네이버 국내 금시세 일별(근사) — 그 이전은 조회하지 않는다
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && ISO.test(s);

const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const fromDayNum = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

export function addDaysIso(iso: string, n: number): string {
  return fromDayNum(dayNum(iso) + n);
}
export function daysBetweenIso(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}

export interface IndicatorSegment { from: string; to: string; kind: 'all' | 'head' | 'gap' | 'tail' }

// 유효한(날짜 키 + 유한 양수 값) 날짜만 오름차순으로
export function indicatorDates(hist: Record<string, unknown> | null | undefined): string[] {
  if (!hist || typeof hist !== 'object') return [];
  return Object.keys(hist)
    .filter(d => isIsoDate(d) && Number.isFinite(Number(hist[d])) && Number(hist[d]) > 0)
    .sort();
}

// hist: { 'YYYY-MM-DD': value } · start/end: 조회기간(ISO, 없으면 빈 문자열) · today: 오늘(ISO)
// 반환: 서버에서 받아야 할 구간 목록(날짜 오름차순). 아무것도 없으면 [].
export function indicatorMissingSegments(
  hist: Record<string, unknown> | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
  today: string,
  floor?: string | null,
): IndicatorSegment[] {
  if (!isIsoDate(today)) return [];
  let s = isIsoDate(start) ? start : '';
  if (s && isIsoDate(floor) && s < floor) s = floor;
  const e = isIsoDate(end) && end < today ? end : today;
  if (s && s > e) return [];

  const dates = indicatorDates(hist);
  if (dates.length === 0) {
    return s ? [{ from: s, to: e, kind: 'all' }] : [];
  }
  const earliest = dates[0];
  const latest = dates[dates.length - 1];
  const out: IndicatorSegment[] = [];

  // ① 머리 — 조회 시작일보다 보유 최초일이 늦다
  if (s && earliest > addDaysIso(s, INDICATOR_HEAD_TOL_DAYS)) {
    out.push({ from: s, to: addDaysIso(earliest, -1), kind: 'head' });
  }

  // ② 내부 공백 — 조회기간 안쪽만, 큰 것부터 상한 개수
  const lo = s && s > earliest ? s : earliest;
  const hi = e < latest ? e : latest;
  const gaps: IndicatorSegment[] = [];
  for (let i = 1; i < dates.length; i++) {
    const a = dates[i - 1], b = dates[i];
    if (b <= lo || a >= hi) continue;
    if (daysBetweenIso(a, b) > INDICATOR_GAP_DAYS) {
      gaps.push({ from: addDaysIso(a, 1), to: addDaysIso(b, -1), kind: 'gap' });
    }
  }
  gaps
    .sort((x, y) => daysBetweenIso(y.from, y.to) - daysBetweenIso(x.from, x.to))
    .slice(0, MAX_GAP_SEGMENTS)
    .forEach(g => out.push(g));

  // ③ 꼬리 — 보유 최신일이 조회 종료일(오늘 상한)보다 며칠 이상 오래됐다
  if (latest < addDaysIso(e, -INDICATOR_TAIL_STALE_DAYS)) {
    const from = addDaysIso(latest, -INDICATOR_TAIL_OVERLAP_DAYS);
    out.push({ from: s && from < s ? s : from, to: e, kind: 'tail' });
  }

  return out.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0));
}

// 서버 응답 병합 — 기존 값 위에 새 값을 덮는다(서버가 정정한 값이 이긴다). 유효하지 않은 값은 버린다.
// 바뀐 게 없으면 원본 참조를 그대로 돌려준다(헛된 Drive 저장 방지).
export function mergeIndicatorHistory(
  prev: Record<string, number> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const base = prev && typeof prev === 'object' ? prev : {};
  if (!incoming || typeof incoming !== 'object') return base as Record<string, number>;
  let next: Record<string, number> | null = null;
  for (const [d, raw] of Object.entries(incoming)) {
    const v = Number(raw);
    if (!isIsoDate(d) || !Number.isFinite(v) || v <= 0) continue;
    if (base[d] === v) continue;
    if (!next) next = { ...base };
    next[d] = v;
  }
  return next || (base as Record<string, number>);
}
