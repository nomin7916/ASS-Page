// 관심종목 **그룹 순수 로직** — 컴포넌트에서 분리해 `verify:watchlist`가 미러 없이 **직접 import**한다.
//
// ⚠️ 이 파일에는 import를 두지 말 것. 그래야 Node가 타입만 벗겨 그대로 실행할 수 있고
//    (`utils.ts`·`xlsxWriter.ts`와 같은 규약) 검증이 참조 구현 미러 없이 돌아간다 —
//    미러를 두면 src/미러 한쪽만 고친 변경이 둘 다 통과하는 구멍이 생긴다.
// ⚠️ `enum`/`namespace` 금지(Node 타입 스트리핑 미지원).

/** 자동 '최근조회' 그룹의 예약 id. */
export const WATCH_RECENT_ID = '__recent__';

/**
 * 자동 '보유종목' 그룹의 예약 id — 포트폴리오 테이블(전체 계좌)에서 화면에만 만드는 **가상 그룹**이다.
 * ⚠️ 그룹 배열(watchlistGroups — Drive 저장)에 넣지 말 것: 정본은 portfolios이고, 저장하면 산 종목·판 종목이
 *    관심종목에 낡은 사본으로 남는다. `auto: true`라 이름 변경·삭제·순서 드래그 게이트를 그대로 탄다.
 */
export const WATCH_HOLD_ID = '__holdings__';

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

/**
 * 처음 쓰는 사용자의 보기 상태 — 종전 화면 기본값과 같다(하위호환의 축).
 * showDiv = 현재가 오른쪽 '분배금·분배율' 열을 펼쳤는가(사용자 요청 2026-10 — **기본은 숨김**).
 */
export const DEFAULT_WATCH_VIEW = Object.freeze({ period: '1개월', customStart: '', customEnd: '', sortDir: null, showDiv: false });

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
 * - showDiv: `=== true`일 때만 펼침(옛 저장값·손상값은 숨김 — 기본 숨김 계약).
 */
export function normalizeWatchView(v: any): { period: string; customStart: string; customEnd: string; sortDir: string | null; showDiv: boolean } {
  const o = v && typeof v === 'object' ? v : {};
  const customStart = isIsoDay(o.customStart) ? o.customStart : '';
  let customEnd = isIsoDay(o.customEnd) ? o.customEnd : '';
  if (customEnd && customStart && customEnd < customStart) customEnd = '';
  let period = WATCH_PERIODS.includes(o.period) ? o.period : DEFAULT_WATCH_VIEW.period;
  if (period === WATCH_CUSTOM_PERIOD && !customStart) period = DEFAULT_WATCH_VIEW.period;
  const sortDir = o.sortDir === 'desc' || o.sortDir === 'asc' ? o.sortDir : null;
  const showDiv = o.showDiv === true;
  return { period, customStart, customEnd, sortDir, showDiv };
}

/** 두 보기 상태가 같은가 — 같으면 저장·전송을 건너뛴다(헛된 Drive 저장 방지). */
export function sameWatchView(a: any, b: any): boolean {
  const x = normalizeWatchView(a);
  const y = normalizeWatchView(b);
  return x.period === y.period && x.customStart === y.customStart && x.customEnd === y.customEnd
    && x.sortDir === y.sortDir && x.showDiv === y.showDiv;
}

// ── 팝업 크기(인앱 팝업 전용 — 별도 창은 브라우저가 창 크기를 정한다) ──
// 폭·높이를 **따로** 기억한다: 오른쪽 가장자리만 끌었으면 높이는 종전처럼 내용에 맞춰 자란다(null = 자동).
// 하한은 '손상값 거르기'용 최소 바닥이다 — 실제 최소 크기(사이드바 펼침 여부에 따라 다르다)는
// 컴포넌트가 표시 시점에 다시 묶는다. 상한은 큰 모니터를 넉넉히 덮는 값.
export const WATCH_SIZE_FLOOR = 200;
export const WATCH_SIZE_CEIL = 6000;

const sizeDim = (n: any): number | null => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(WATCH_SIZE_CEIL, Math.max(WATCH_SIZE_FLOOR, Math.round(n)));
};

/**
 * 손상값을 걸러 낸 팝업 크기. `null` = 기본 크기(종전 동작). **절대 던지지 않는다.**
 * 폭·높이가 둘 다 자동이면 객체가 아니라 null을 돌려준다(저장값이 기본 상태를 한 가지 모양으로만 갖게).
 */
export function normalizeWatchSize(v: any): { w: number | null; h: number | null } | null {
  if (!v || typeof v !== 'object') return null;
  const w = sizeDim(v.w);
  const h = sizeDim(v.h);
  return w === null && h === null ? null : { w, h };
}

/** 두 팝업 크기가 같은가 — 같으면 저장을 건너뛴다(헛된 Drive 저장 방지). */
export function sameWatchSize(a: any, b: any): boolean {
  const x = normalizeWatchSize(a);
  const y = normalizeWatchSize(b);
  if (x === null || y === null) return x === y;
  return x.w === y.w && x.h === y.h;
}

// 화면 여백 — 팝업 CSS 상한(maxWidth calc(100vw - 20px) / maxHeight calc(100vh - 10px))과 **같은 값**이어야
// 끄는 동안 계산한 크기와 놓은 뒤 표시되는 크기가 같다(다르면 놓는 순간 크기가 튄다).
export const WATCH_VIEW_MARGIN_X = 20;
export const WATCH_VIEW_MARGIN_Y = 10;

/**
 * 모서리·가장자리를 끄는 중의 패널 사각형(순수 함수 — 절대 던지지 않는다).
 * st = 시작 시점 `{ dir, x, y, w, h, minW, minH }`(dir = 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'),
 * dx·dy = 포인터 이동량, vw·vh = 뷰포트 크기.
 * - **반대편 가장자리는 제자리**다(왼쪽을 끌면 오른쪽 끝이 고정 — 창 크기 조절과 같은 감각).
 * - 최소 크기 아래로 줄지 않고, 화면 밖으로 넓어지지 않는다.
 */
export function resizeWatchRect(st: any, dx: any, dy: any, vw: any, vh: any): { x: number; y: number; w: number; h: number } {
  const num = (n: any, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const o = st && typeof st === 'object' ? st : {};
  const dir = typeof o.dir === 'string' ? o.dir : '';
  const x0 = num(o.x), y0 = num(o.y), w0 = num(o.w), h0 = num(o.h);
  const ddx = num(dx), ddy = num(dy);
  const VW = num(vw, 1024), VH = num(vh, 768);
  const minW = Math.max(WATCH_SIZE_FLOOR, num(o.minW));
  const minH = Math.max(WATCH_SIZE_FLOOR, num(o.minH));
  const maxW = Math.max(minW, VW - WATCH_VIEW_MARGIN_X);
  const maxH = Math.max(minH, VH - WATCH_VIEW_MARGIN_Y);
  let x = x0, y = y0, w = w0, h = h0;
  if (dir.includes('e')) w = clamp(w0 + ddx, minW, Math.min(maxW, VW - x0));
  if (dir.includes('w')) {
    const right = x0 + w0;
    x = clamp(x0 + ddx, Math.max(0, right - maxW), right - minW);
    w = right - x;
  }
  if (dir.includes('s')) h = clamp(h0 + ddy, minH, Math.min(maxH, VH - y0));
  if (dir.includes('n')) {
    const bottom = y0 + h0;
    y = clamp(y0 + ddy, Math.max(0, bottom - maxH), bottom - minH);
    h = bottom - y;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * 놓은 뒤 저장할 크기 — **끈 축만** 바꾸고 나머지 축은 이전 저장값(자동이면 null)을 그대로 둔다.
 * 오른쪽 가장자리만 끌었는데 높이까지 그 순간의 실측값으로 박으면, 내용에 맞춰 자라던 높이가 고정돼 버린다.
 */
export function watchSizeAfterResize(dir: any, rect: any, prev: any): { w: number | null; h: number | null } | null {
  const d = typeof dir === 'string' ? dir : '';
  const p = normalizeWatchSize(prev);
  const r = rect && typeof rect === 'object' ? rect : {};
  return normalizeWatchSize({
    w: /[ew]/.test(d) ? r.w : (p ? p.w : null),
    h: /[ns]/.test(d) ? r.h : (p ? p.h : null),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 종목 하이라이트(사용자 요청 2026-10) — 행 왼쪽 끝을 눌러 종목에 색을 칠해 두면, 기간·정렬을 바꿔도
// 그 종목이 리스트 어디에 있는지 한눈에 찾는다. 여러 종목을 칠할 수 있고 **칠할 때마다 다른 색**이다.
// 저장은 종목 항목의 `highlight`(아래 팔레트의 key) — `watchlistGroups` **안**이라 기존 지문
// (`JSON.stringify(watchlistGroups)`)·백업 sticky·별도 창 브릿지를 그대로 탄다(영속화 신규 지점 0곳).
// ⚠️ 빨강·파랑 계열은 쓰지 않는다 — 옆 칸 등락율이 상승=빨강/하락=파랑이라 하이라이트 색이 등락으로 읽힌다.

/** 하이라이트 팔레트 — 칠하는 순서 그대로. key가 저장값이다(순서를 바꿔도 이미 칠한 색은 그대로). */
export const WATCH_HIGHLIGHT_COLORS = Object.freeze([
  Object.freeze({ key: 'amber', hex: '#fbbf24', label: '노랑' }),
  Object.freeze({ key: 'pink', hex: '#f472b6', label: '분홍' }),
  Object.freeze({ key: 'lime', hex: '#a3e635', label: '연두' }),
  Object.freeze({ key: 'cyan', hex: '#22d3ee', label: '하늘' }),
  Object.freeze({ key: 'violet', hex: '#a78bfa', label: '보라' }),
  Object.freeze({ key: 'orange', hex: '#fb923c', label: '주황' }),
  Object.freeze({ key: 'emerald', hex: '#34d399', label: '초록' }),
  Object.freeze({ key: 'white', hex: '#e2e8f0', label: '흰색' }),
]);

/** 저장값 → 팔레트 항목. 팔레트에 없는 값(손상·옛 값)은 null = 하이라이트 아님. */
export function watchHighlightOf(key: any): { key: string; hex: string; label: string } | null {
  if (typeof key !== 'string') return null;
  return WATCH_HIGHLIGHT_COLORS.find((c) => c.key === key) || null;
}

/**
 * 다음에 칠할 색 — 그 그룹에서 **아직 안 쓴 색**을 팔레트 순서로. 전부 쓰고 있으면 가장 적게 쓴 색.
 * ⚠️ '마지막 색의 다음'으로 고르지 말 것 — 중간 종목의 하이라이트를 지운 뒤 새로 칠하면 이미 쓰는 색과
 *    겹친다(사용자 요구는 "선택할 때마다 다른 색으로 구분").
 */
export function nextWatchHighlight(stocks: any): string {
  const count: Record<string, number> = {};
  for (const c of WATCH_HIGHLIGHT_COLORS) count[c.key] = 0;
  if (Array.isArray(stocks)) {
    for (const s of stocks) {
      const c = watchHighlightOf(s?.highlight);
      if (c) count[c.key] += 1;
    }
  }
  let best = WATCH_HIGHLIGHT_COLORS[0].key;
  for (const c of WATCH_HIGHLIGHT_COLORS) if (count[c.key] < count[best]) best = c.key;
  return best;
}

/**
 * 그룹 `groupId`의 종목 `stockId` 하이라이트를 켜고 끈 새 배열.
 * - 켜져 있으면 끈다(필드 삭제 — `highlight: null`을 남기지 않는다).
 * - 꺼져 있으면(손상값 포함) 그 그룹의 다음 색을 칠한다.
 * ⚠️ 대상이 없으면 **같은 참조** — 새 배열을 만들면 지문이 같아도 setState가 돌아 헛된 Drive 저장이 나간다.
 */
export function toggleWatchHighlight(groups: any, groupId: any, stockId: any): any {
  if (!Array.isArray(groups)) return groups;
  const gi = groups.findIndex((g: any) => g?.id === groupId);
  if (gi < 0) return groups;
  const g = groups[gi];
  const stocks = Array.isArray(g?.stocks) ? g.stocks : [];
  const si = stocks.findIndex((s: any) => s?.id === stockId);
  if (si < 0) return groups;
  const cur = stocks[si];
  const { highlight: _old, ...rest } = cur;
  const nextStock = watchHighlightOf(cur.highlight) ? rest : { ...rest, highlight: nextWatchHighlight(stocks) };
  const nextStocks = stocks.slice();
  nextStocks[si] = nextStock;
  const out = groups.slice();
  out[gi] = { ...g, stocks: nextStocks };
  return out;
}

/** 그룹의 하이라이트를 모두 지운 새 배열. 지울 것이 없으면 **같은 참조**. */
export function clearWatchHighlights(groups: any, groupId: any): any {
  if (!Array.isArray(groups)) return groups;
  const gi = groups.findIndex((g: any) => g?.id === groupId);
  if (gi < 0) return groups;
  const g = groups[gi];
  const stocks = Array.isArray(g?.stocks) ? g.stocks : [];
  if (!stocks.some((s: any) => s && Object.prototype.hasOwnProperty.call(s, 'highlight'))) return groups;
  const out = groups.slice();
  out[gi] = {
    ...g,
    stocks: stocks.map((s: any) => {
      if (!s || !Object.prototype.hasOwnProperty.call(s, 'highlight')) return s;
      const { highlight: _h, ...rest } = s;
      return rest;
    }),
  };
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 포트폴리오 표·리밸런싱 표의 행 하이라이트(사용자 요청 2026-10) — 관심종목과 **같은 팔레트·같은 규칙**.
// 저장은 계좌의 `markedPortfolioRows` / `markedRebalRows` = `{ [itemId]: 팔레트 key }`(기존 필드 그대로 —
// 지문 `markedRowsKey`·로드 스프레드가 이미 있어 영속화 신규 지점 0곳).
// ⚠️ 옛 4색 사이클 값('yellow'|'slate'|'rose'|'brown')은 **읽을 때만** 가까운 팔레트 색으로 보여 준다
//    (저장값을 조용히 바꾸지 않는다). 다음 색 고르기·해제도 그 대응을 거쳐 판정한다.
const LEGACY_ROW_MARK: Record<string, string> = Object.freeze({ yellow: 'amber', slate: 'white', rose: 'pink', brown: 'orange' }) as any;

/** 행 하이라이트 저장값 → 팔레트 항목(옛 4색 값 포함). 없거나 손상값이면 null. */
export function rowHighlightOf(key: any): { key: string; hex: string; label: string } | null {
  if (typeof key !== 'string') return null;
  return watchHighlightOf(LEGACY_ROW_MARK[key] || key);
}

/** 행 하이라이트 맵에서 다음에 칠할 색 — 관심종목과 같은 규칙(아직 안 쓴 색 → 가장 적게 쓴 색). */
export function nextRowHighlight(map: any): string {
  const vals = map && typeof map === 'object' && !Array.isArray(map) ? Object.values(map) : [];
  return nextWatchHighlight(vals.map((k) => ({ highlight: rowHighlightOf(k)?.key })));
}

/**
 * `itemId` 행의 하이라이트를 켜고 끈 새 맵. 켜져 있으면 키 삭제, 꺼져 있으면(손상값 포함) 다음 색.
 * 입력은 변형하지 않는다.
 */
export function toggleRowHighlight(map: any, itemId: any): Record<string, string> {
  const cur = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  const id = String(itemId);
  const next: Record<string, string> = { ...cur };
  if (rowHighlightOf(cur[id])) delete next[id];
  else next[id] = nextRowHighlight(cur);
  return next;
}
