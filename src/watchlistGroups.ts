// 관심종목 **그룹 순수 로직** — 컴포넌트에서 분리해 `verify:watchlist`가 미러 없이 **직접 import**한다.
//
// ⚠️ 이 파일에는 import를 두지 말 것. 그래야 Node가 타입만 벗겨 그대로 실행할 수 있고
//    (`utils.ts`·`xlsxWriter.ts`와 같은 규약) 검증이 참조 구현 미러 없이 돌아간다 —
//    미러를 두면 src/미러 한쪽만 고친 변경이 둘 다 통과하는 구멍이 생긴다.
// ⚠️ `enum`/`namespace` 금지(Node 타입 스트리핑 미지원).

/** 자동 '최근조회' 그룹의 예약 id. */
export const WATCH_RECENT_ID = '__recent__';

/**
 * 그룹이 '자동 그룹(최근조회)'인가 — 이름 변경·삭제·순서 드래그의 공통 게이트.
 *
 * ⚠️ 이 판정을 손복제하지 말 것: `recordRecent`가 최근조회를 **항상 배열 맨 앞**에 다시 붙이므로
 *    (`[{최근조회}, ...others]`) 한 곳이라도 게이트를 빠뜨리면 그 경로만 조용히 원복된다
 *    (사용자에겐 '드래그가 안 먹는' 것으로 보인다).
 */
export function isAutoWatchGroup(g: any): boolean {
  return !!g && (g.id === WATCH_RECENT_ID || !!g.auto);
}

/**
 * 드래그 가능한 **수동 그룹**의 id 목록(배열 순서 그대로).
 * 화면의 삽입 슬롯 계산(`[data-watch-group]` 행 수)과 **같은 좌표계**를 만든다 —
 * ⚠️ 자동 그룹에 `data-watch-group`을 달면 두 좌표계가 1만큼 어긋나 드롭이 한 칸씩 빗나간다.
 */
export function manualWatchGroupIds(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const g of arr) if (!isAutoWatchGroup(g)) out.push(g?.id);
  return out;
}

/**
 * 수동 그룹 `id`를 **수동 그룹 기준** 삽입 슬롯 `to`(0..N)로 옮긴 새 배열.
 *
 * ⚠️ 자동 그룹이 있던 인덱스는 **그대로 두고** 수동 그룹만 그 사이 슬롯에 다시 깐다 —
 *    최근조회가 맨 앞에 고정되는 것을 산술이 아니라 **구조**로 보장한다.
 * ⚠️ 순서 변화가 없거나 입력이 어긋나면 **같은 참조**를 반환한다. 관심종목 순서는
 *    `watchlistGroups` 배열 자체를 재정렬해 기존 지문(`JSON.stringify`)으로 저장이 트리거되므로,
 *    새 배열을 항상 만들면 제스처마다 헛된 Drive 저장이 나간다.
 * ⚠️ `order` 필드를 새로 만들지 말 것 — 정규화·지문·복원 등록 지점이 늘고 하나만 빠지면
 *    조용히 유실된다(종목 순서 드래그와 같은 규약).
 */
export function reorderManualWatchGroups(arr: any, id: any, to: any): any {
  if (!Array.isArray(arr)) return arr;
  if (id == null || typeof to !== 'number' || !Number.isInteger(to)) return arr;
  const slots: number[] = [];
  const manual: any[] = [];
  arr.forEach((g: any, i: number) => {
    if (!isAutoWatchGroup(g)) { slots.push(i); manual.push(g); }
  });
  const from = manual.findIndex((g: any) => g?.id === id);
  if (from < 0) return arr;                        // prev 스냅샷 불일치 방어
  const insertAt = to > from ? to - 1 : to;         // splice로 앞에서 하나 제거되므로 뒤로 갈 땐 -1
  if (insertAt === from || insertAt < 0 || insertAt >= manual.length) return arr;
  const next = manual.slice();
  const [item] = next.splice(from, 1);
  next.splice(insertAt, 0, item);
  const out = arr.slice();
  slots.forEach((idx: number, k: number) => { out[idx] = next[k]; });
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 보기 상태(조회 기간 · 직접 선택 시작/종료일 · 등락율 정렬) — 사용자가 마지막으로 고른 상태를
// `chartPrefs.watchlistView`에 저장해 팝업을 다시 열거나 앱을 새로고침해도 그대로 돌아오게 한다.
// ⚠️ 저장값은 Drive·백업·별도 창 메시지로 들어오므로 **반드시 이 정규화를 통과**시킬 것 —
//    손상값('weke' 같은 기간)이 state에 들어가면 기간 버튼 어느 것도 눌린 것으로 보이지 않는다.

/** 기간 토글 값(화면 버튼 순서 그대로). `'직접'`은 시작일·종료일을 고르는 기간이다. */
export const WATCH_PERIODS = ['1일', '1주', '1개월', '3개월', '1년', '직접'];
export const WATCH_CUSTOM_PERIOD = '직접';

/** 처음 쓰는 사용자의 보기 상태 — 종전 화면 기본값과 같다(하위호환의 축). */
export const DEFAULT_WATCH_VIEW = Object.freeze({ period: '1개월', customStart: '', customEnd: '', sortDir: null });

// 실제 달력에 있는 YYYY-MM-DD만 — 패턴만 보면 '2026-02-31'이 통과한다(utils.isValidIsoDate와 같은 판정).
const isIsoDay = (s: any): boolean => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1900 || y > 2999) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * 손상값을 걸러 낸 보기 상태. **절대 던지지 않는다**(렌더 중 예외는 루트 ErrorBoundary까지 올라간다).
 * - period: 화이트리스트 밖이면 기본값. `'직접'`인데 시작일이 없으면 결과를 낼 수 없으므로 기본값.
 * - customEnd: 시작일보다 앞이면 비운다('' = 현재까지 실시간).
 * - sortDir: `'desc'|'asc'`만, 그 외는 null(원래 순서).
 */
export function normalizeWatchView(v: any): { period: string; customStart: string; customEnd: string; sortDir: string | null } {
  const o = v && typeof v === 'object' ? v : {};
  const customStart = isIsoDay(o.customStart) ? o.customStart : '';
  let customEnd = isIsoDay(o.customEnd) ? o.customEnd : '';
  if (customEnd && customStart && customEnd < customStart) customEnd = '';
  let period = WATCH_PERIODS.includes(o.period) ? o.period : DEFAULT_WATCH_VIEW.period;
  if (period === WATCH_CUSTOM_PERIOD && !customStart) period = DEFAULT_WATCH_VIEW.period;
  const sortDir = o.sortDir === 'desc' || o.sortDir === 'asc' ? o.sortDir : null;
  return { period, customStart, customEnd, sortDir };
}

/** 두 보기 상태가 같은가 — 같으면 저장·전송을 건너뛴다(헛된 Drive 저장 방지). */
export function sameWatchView(a: any, b: any): boolean {
  const x = normalizeWatchView(a);
  const y = normalizeWatchView(b);
  return x.period === y.period && x.customStart === y.customStart && x.customEnd === y.customEnd && x.sortDir === y.sortDir;
}
