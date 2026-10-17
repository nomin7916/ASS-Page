// 시장지표 히스토리 소스 병합 헬퍼 — 순수 함수만(비라우트 모듈, 언더스코어 규약).
// ⚠️ import 0건 · process.env 미사용 · enum/namespace 금지 — scripts/verify-indicators.mjs가 직접 import한다.

// fredgraph.csv(키 불필요) — "observation_date,SERIES\nYYYY-MM-DD,값" (결측은 '.' 또는 빈 칸)
// signed=true: 장단기 금리차(T10Y2Y·T10Y3M)처럼 0·음수가 정상값인 시리즈 — 값 부호로 버리지 않는다.
export function parseFredGraphCsv(csv: string, signed = false): Record<string, number> {
  const record: Record<string, number> = {};
  for (const line of String(csv || '').split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2}),\s*([^,\s]*)/.exec(line.trim());
    if (!m) continue;
    const v = parseFloat(m[2]);
    if (m[2] !== '' && Number.isFinite(v) && (signed || v > 0)) record[m[1]] = v;
  }
  return record;
}

const keysOf = (r: Record<string, number>) => Object.keys(r || {}).sort();

// 주 소스(primary)가 덮지 못한 **앞쪽**만 보조 소스로 채운다 — 겹치는 날짜는 주 소스가 이긴다.
// (두 소스의 값 기준이 조금씩 달라도 한 날짜에 섞이지 않게 경계로 자른다)
export function fillBefore(primary: Record<string, number>, secondary: Record<string, number>): Record<string, number> {
  const first = keysOf(primary)[0];
  if (!first) return { ...(secondary || {}) };
  const out: Record<string, number> = { ...primary };
  for (const d of keysOf(secondary)) {
    if (d >= first) break;
    out[d] = secondary[d];
  }
  return out;
}

// 주 소스가 덮지 못한 **뒤쪽**(최신)만 보조 소스로 채운다.
export function fillAfter(primary: Record<string, number>, secondary: Record<string, number>): Record<string, number> {
  const ks = keysOf(primary);
  const last = ks[ks.length - 1];
  if (!last) return { ...(secondary || {}) };
  const out: Record<string, number> = { ...primary };
  for (const d of keysOf(secondary)) if (d > last) out[d] = secondary[d];
  return out;
}

// 연준 기준금리 — DFEDTAR(단일 목표, ~2008-12-15) + DFEDTARU(상단, 2008-12-16~)를 이어 붙인다.
// 상단 시계열이 있는 날짜는 상단이 이긴다(겹치는 날은 원래 없다).
export function joinFedRate(legacy: Record<string, number>, upper: Record<string, number>): Record<string, number> {
  return fillBefore(upper || {}, legacy || {});
}

// MBS 스프레드(%p) = 30년 모기지(MORTGAGE30US, 주간·목요일 발표) − 미국 10년(DGS10, 일별) — 2026-10.
// us10y 날짜마다 계산하고, 그날 모기지 값이 없으면 **직전** 모기지 값을 쓴다(같은 날짜면 그날 값끼리).
// 첫 모기지 발표 이전 날짜는 만들지 않는다. 0·음수가 나올 수 있다(SIGNED_INDICATOR_KEYS의 mbsSpread).
// 부동소수 잔차(6.81−4.1=2.7099999…)는 소수 4자리로 정리한다.
export function computeMbsSpread(mort30: Record<string, number>, us10y: Record<string, number>): Record<string, number> {
  const mk = keysOf(mort30);
  const out: Record<string, number> = {};
  let i = 0, cur: number | null = null;
  for (const d of keysOf(us10y)) {
    while (i < mk.length && mk[i] <= d) { cur = mort30[mk[i]]; i++; }
    const u = us10y[d];
    if (cur == null || !Number.isFinite(cur) || !Number.isFinite(u)) continue;
    out[d] = Math.round((cur - u) * 10000) / 10000;
  }
  return out;
}

// 응답 캐시 — 종료일이 최근 2일 이내면 '최신 꼬리를 포함한 요청'이라 짧게 캐시한다.
export function isRecentRangeEnd(d2Ymd: string, todayYmd: string): boolean {
  if (!/^\d{8}$/.test(d2Ymd || '') || !/^\d{8}$/.test(todayYmd || '')) return true;
  const toNum = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 86400000;
  return toNum(todayYmd) - toNum(d2Ymd) <= 2;
}
