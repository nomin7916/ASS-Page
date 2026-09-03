// 종목 종가 캐시(stockHistoryMap) 동기화 — 순수 함수만.
//
// ⚠️ 이 파일은 import 0건·`@ts-nocheck` 금지·`enum`/`namespace` 금지를 유지한다 — scripts/verify-boot.mjs가
//    Node 타입 스트리핑으로 **직접 import**해 테스트한다(미러 금지). 상대 import를 추가한다면 `.ts` 확장자 필수.
//
// 배경(부팅 흔들림·전량 재조회의 원인): 옛 `trendMigratedInSession`(세션 ref)은 국내 **전 코드**를 매 세션
// KIS 전체 이력(fromYear=2000, 최대 13청크) 재조회 대상으로 만들었고, 코드마다 응답 즉시 setStockHistoryMap을
// 불러 코드 수만큼 전역 재계산이 돌았다. 여기서는 마커를 **STOCK 파일 안에 영속**(`meta.realClose`)해
// 두 번째 세션부터 "마지막 저장일 이후 증분"만 조회하게 한다(사용자 의도 — "접속 시점의 최신 데이터만").

// 코드별 실제종가 마이그레이션 마커.
//  at       — 마지막 **전체**(full) KIS 조회를 완료한 KST 날짜. 30일이 지나면 다시 전체 조회해 과거 정정을 흡수한다.
//  lastDate — 마커가 보증하는 마지막 실제종가 날짜(응답 최대 날짜 중 오늘 미만; 21:00 이후엔 오늘 허용).
export interface RealCloseMarker { at: string; lastDate: string }
export interface StockMeta { realClose: Record<string, RealCloseMarker> }

// 마커의 at이 이 일수보다 오래됐으면 증분이 아니라 전체 조회로 되돌린다(배당·분할 소급 정정, 부분 응답 잔재 흡수).
export const MARKER_FULL_REFRESH_DAYS = 30;
// '마커 있음'이어도 캐시 키가 이 수 이하면 전체 조회 — 단일 stamp만 남은 코드를 증분으로 오판하지 않기 위함.
export const MIN_CACHED_KEYS_FOR_INCREMENTAL = 3;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// 저장된 meta를 정규화한다. 손상 항목(날짜 형식 불량·필드 누락)은 **버린다** = 그 코드는 미마이그로 강등(전체 조회).
// 구버전 클라이언트가 meta 없이 저장하면 전부 사라져 전량 재조회로 강등된다(fail-safe — 롤백 안전).
export const normalizeStockMeta = (raw: unknown): StockMeta => {
  const out: Record<string, RealCloseMarker> = {};
  const rc = isPlainObject(raw) ? (raw as any).realClose : null;
  if (isPlainObject(rc)) {
    for (const [code, m] of Object.entries(rc)) {
      if (!code || !isPlainObject(m)) continue;
      const at = (m as any).at, lastDate = (m as any).lastDate;
      if (!isIsoDate(at) || !isIsoDate(lastDate)) continue;
      out[code] = { at, lastDate };
    }
  }
  return { realClose: out };
};

// 두 마커 집합 병합 — 같은 코드는 lastDate가 더 늦은 쪽(동률이면 at이 더 늦은 쪽) 채택. 입력은 변형하지 않는다.
export const mergeStockMeta = (
  base: Record<string, RealCloseMarker> | null | undefined,
  incoming: Record<string, RealCloseMarker> | null | undefined,
): Record<string, RealCloseMarker> => {
  const out: Record<string, RealCloseMarker> = { ...(base || {}) };
  for (const [code, m] of Object.entries(incoming || {})) {
    const cur = out[code];
    if (!cur || m.lastDate > cur.lastDate || (m.lastDate === cur.lastDate && m.at > cur.at)) out[code] = m;
  }
  return out;
};

// YYYY-MM-DD를 n일 이동(UTC 정오 기준 — 타임존과 무관한 달력 일자 산술).
export const shiftIsoDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

// 두 ISO 날짜 사이 일수(b − a).
export const daysBetweenIso = (a: string, b: string): number => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

export interface KorHistoryPlan { full: string[]; incremental: string[]; skip: string[] }

// 국내 코드별 이력 조회 계획. 결과 세 집합은 **서로소**이고 합집합 = 입력 codes(중복 제거).
//  force              → 전부 full(HistoryPanel의 강제 재조회 — 마커 무시).
//  마커 없음 / 캐시 키 ≤ 3 → full.
//  마커 at이 MARKER_FULL_REFRESH_DAYS보다 오래됨 → full(과거 정정 흡수).
//  lastDate >= lastTradingDay → skip(이미 최신).
//  그 외 → incremental(lastDate 이후만).
export const planKorHistoryFetch = (
  codes: string[],
  map: Record<string, Record<string, number>> | null | undefined,
  meta: Record<string, RealCloseMarker> | null | undefined,
  opts: { force?: boolean; todayKST: string; lastTradingDay: string },
): KorHistoryPlan => {
  const plan: KorHistoryPlan = { full: [], incremental: [], skip: [] };
  const seen = new Set<string>();
  for (const code of codes || []) {
    if (!code || seen.has(code)) continue;
    seen.add(code);
    if (opts.force) { plan.full.push(code); continue; }
    const m = meta?.[code];
    const keyCount = Object.keys(map?.[code] || {}).length;
    if (!m || keyCount <= MIN_CACHED_KEYS_FOR_INCREMENTAL) { plan.full.push(code); continue; }
    if (daysBetweenIso(m.at, opts.todayKST) > MARKER_FULL_REFRESH_DAYS) { plan.full.push(code); continue; }
    if (m.lastDate >= opts.lastTradingDay) { plan.skip.push(code); continue; }
    plan.incremental.push(code);
  }
  return plan;
};

// 완전한 실제종가 응답에서 마커의 lastDate를 정한다: 응답 최대 날짜 중 **오늘 미만**, 단 KR 종가가 정산된
// 뒤(settledToday = 오늘, 21:00 이후)라면 오늘 허용. 장중 당일 행을 '종가 확정'으로 굳히지 않기 위함.
// 채택할 날짜가 없으면 null(마커 갱신 안 함).
export const markerLastDateOf = (
  data: Record<string, number> | null | undefined,
  todayKST: string,
  settledToday: string | null,
): string | null => {
  let best: string | null = null;
  for (const d of Object.keys(data || {})) {
    if (!isIsoDate(d)) continue;
    if (d > todayKST) continue;
    if (d === todayKST && settledToday !== todayKST) continue;
    if (best === null || d > best) best = d;
  }
  return best;
};
