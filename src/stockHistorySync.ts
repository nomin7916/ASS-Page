// 종목 종가 캐시(stockHistoryMap) 동기화 — 순수 함수만.
//
// ⚠️ 이 파일은 import 0건·`@ts-nocheck` 금지·`enum`/`namespace` 금지를 유지한다 — scripts/verify-boot.mjs가
//    Node 타입 스트리핑으로 **직접 import**해 테스트한다(미러 금지). 상대 import를 추가한다면 `.ts` 확장자 필수.
//
// 배경(부팅 흔들림·전량 재조회의 원인): 옛 `trendMigratedInSession`(세션 ref)은 국내 **전 코드**를 매 세션
// KIS 전체 이력(fromYear=2000, 최대 13청크) 재조회 대상으로 만들었고, 코드마다 응답 즉시 setStockHistoryMap을
// 불러 코드 수만큼 전역 재계산이 돌았다. 여기서는 마커를 **STOCK 파일 안에 영속**(`meta.realClose`)해
// 두 번째 세션부터 "마지막 저장일 이후 증분"만 조회하게 하고(Phase 2), 스트림 결과를 **스테이징**에 모아
// 패스 단위로 한 번에 커밋한다(Phase 3 — applyStagedMerges).

// ─────────────────────────────────────────────────────────────────────────────
// 종목별 종가 병합 — 가격 기준(基準)이 다른 두 소스를 한 번에 안전하게 합친다. (useStockData에서 이전 — 본문 무수정)
//
// ⚠️ 회귀 주의 — 이 앱의 종가 소스는 두 종류이고 **같은 날짜에 다른 숫자**를 준다.
//   · 실제종가(KIS FID_ORG_ADJ_PRC=1 / 네이버 trend): 그날 실제로 찍힌 가격 → `overwrite`
//   · 수정종가(네이버 fchart / Yahoo): 이후 배당·분할을 소급 반영해 과거를 낮춘 가격 → `gapFill`
//   실측 예: 490590(월배당 커버드콜) 2026-03-09 실제 12,380원 vs 수정 11,222원(배당 5회 소급, -9.4%).
//   두 기준이 한 종목 안에 섞이면 그 경계에서 차트에 인공적인 급등이 생기고, 누적 수익률은
//   곱셈 체인이라 그 하루가 이후 전 구간을 영구히 어긋나게 만든다.
//
// 규칙: gapFill은 **캐시에 그 날짜가 없을 때만** 채우고, overwrite는 무조건 덮어쓴다.
// ⚠️ 적용 순서를 바꾸지 말 것 — gapFill을 먼저, overwrite를 나중에 적용해야
//    같은 날짜가 양쪽에 있을 때 최종값이 항상 실제종가가 된다.
// 입력은 변형하지 않고 항상 새 객체를 반환한다.
export const mergeCodeHistory = (
  base: Record<string, number>,
  sources: { overwrite?: Record<string, number> | null; gapFill?: Record<string, number> | null }
): Record<string, number> => {
  const merged: Record<string, number> = { ...(base || {}) };
  const { overwrite, gapFill } = sources || {};
  if (gapFill) {
    for (const [d, price] of Object.entries(gapFill)) {
      if (merged[d] === undefined) merged[d] = price as number;
    }
  }
  if (overwrite) {
    for (const [d, price] of Object.entries(overwrite)) {
      merged[d] = price as number;
    }
  }
  return merged;
};

// ─────────────────────────────────────────────────────────────────────────────
// 스테이징 — 이력 스트림(KIS·trend·fchart·US·펀드 NAV)의 결과를 코드별로 모아 두었다가 한 번에 커밋한다.
//  overwrite  — 실제종가(무조건 덮어쓰기)          gapFill — 수정종가(캐시에 없는 날짜만)
//  replace    — 펀드 NAV(Object.assign 의미)        deleteKeys — 펀드 캐시의 비거래일 stale 키 제거
// 코드별 적용 순서: deleteKeys → replace → mergeCodeHistory(base, { gapFill, overwrite }).
export interface StagedCodeMerge {
  overwrite?: Record<string, number> | null;
  gapFill?: Record<string, number> | null;
  replace?: Record<string, number> | null;
  deleteKeys?: string[] | null;
}

// 같은 코드에 패치가 두 번 쌓일 때(겹친 갱신 패스) 합친다 — 뒤 패치가 같은 키를 이긴다. 입력 불변.
export const mergeStagedPatch = (a: StagedCodeMerge, b: StagedCodeMerge): StagedCodeMerge => {
  const out: StagedCodeMerge = {};
  if (a.overwrite || b.overwrite) out.overwrite = { ...(a.overwrite || {}), ...(b.overwrite || {}) };
  if (a.gapFill || b.gapFill) out.gapFill = { ...(a.gapFill || {}), ...(b.gapFill || {}) };
  if (a.replace || b.replace) out.replace = { ...(a.replace || {}), ...(b.replace || {}) };
  if (a.deleteKeys?.length || b.deleteKeys?.length) out.deleteKeys = [...new Set([...(a.deleteKeys || []), ...(b.deleteKeys || [])])];
  return out;
};

// 스테이징을 prev 맵에 적용해 새 맵을 돌려준다.
//  · staged가 비면 **prev 참조 그대로**(호출부의 참조 비교 dirty·불필요 렌더 방지).
//  · 건드리지 않은 코드의 내부 객체 참조는 보존한다.
//  · 결과는 같은 패치들을 코드별로 순차 setState했을 때와 값이 동일하다(verify:boot가 20순열로 단언) —
//    차이는 오직 '커밋 횟수'(코드 수 → 1)뿐이다.
export const applyStagedMerges = (
  prev: Record<string, Record<string, number>> | null | undefined,
  staged: Record<string, StagedCodeMerge> | null | undefined,
): Record<string, Record<string, number>> => {
  const codes = Object.keys(staged || {});
  const base = prev || {};
  if (codes.length === 0) return base as Record<string, Record<string, number>>;
  const next: Record<string, Record<string, number>> = { ...base };
  for (const code of codes) {
    const s = staged![code];
    if (!s) continue;
    const cur: Record<string, number> = { ...(next[code] || {}) };
    for (const k of s.deleteKeys || []) delete cur[k];
    if (s.replace) Object.assign(cur, s.replace);
    next[code] = mergeCodeHistory(cur, { gapFill: s.gapFill, overwrite: s.overwrite });
  }
  return next;
};

// ─────────────────────────────────────────────────────────────────────────────
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
