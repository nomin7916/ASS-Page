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
