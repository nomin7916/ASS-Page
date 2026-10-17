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

// 응답 캐시 — 종료일이 최근 2일 이내면 '최신 꼬리를 포함한 요청'이라 짧게 캐시한다.
export function isRecentRangeEnd(d2Ymd: string, todayYmd: string): boolean {
  if (!/^\d{8}$/.test(d2Ymd || '') || !/^\d{8}$/.test(todayYmd || '')) return true;
  const toNum = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 86400000;
  return toNum(todayYmd) - toNum(d2Ymd) <= 2;
}
