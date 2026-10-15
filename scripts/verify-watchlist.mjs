#!/usr/bin/env node
// 관심종목(watchlistGroups) 검증 — 그룹 사이드바 · 순서 드래그 · 별도 브라우저 창.
//
// 이 파일이 고정하는 것은 "조용히 원복되거나, 조용히 데이터가 사라지는" 결함들이다.
//   파트① `src/watchlistGroups.ts` **직접 import** (#1~#20)
//     ⚠️ 미러 금지 — 미러를 두면 src/미러 한쪽만 고친 변경이 둘 다 통과한다.
//     #1~#5   isAutoWatchGroup / manualWatchGroupIds — 자동 그룹 게이트와 좌표계
//     #6~#16  reorderManualWatchGroups — 자동 그룹 자리 고정 · 변화 없으면 같은 참조 ·
//             recordRecent(최근조회를 항상 맨 앞으로) 이후에도 사용자 순서가 살아남는가
//     #17~#20 손상 입력 방어(throw 금지 — 렌더 중 예외는 루트 ErrorBoundary까지 올라간다)
//     #21~#32 normalizeWatchView / sameWatchView — 보기 상태(기간·직접 선택 날짜·정렬) 저장값 정규화
//     #33~#50 normalizeWatchSize / sameWatchSize / resizeWatchRect / watchSizeAfterResize — 팝업 크기 조절
//   파트② 소스 텍스트 가드 (#G1~#G62)
//     미러로는 표현할 수 없는 **배선**을 단언한다(브릿지·읽기 전용·좌표계·부팅 분기).
//     ⚠️ 실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.
//     ⚠️ 가드는 '선언'이 아니라 **사용부**를 단언한다.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};
const eq = (name, got, want) => {
  if (Object.is(got, want)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want}`); }
};
// ⚠️ 예외를 '그 케이스의 실패'로 바꾸는 래퍼 — 직접 호출하면 던지는 구현이 스크립트를 통째로
//    중단시켜 어느 계약이 깨졌는지 알 수 없고, 변이 테스트에서 '검출됨'과 '죽은 단언'을 구분할 수 없다.
const S = (label, fn, check) => {
  try { const v = fn(); ok(label, check ? check(v) : true); return v; }
  catch (e) { fail++; console.log(`  ✗ ${label} — threw ${e && e.message}`); return undefined; }
};
const src = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
// 이 저장소는 금지 이유를 바로 그 자리 주석에 적으므로, '부재' 단언은 반드시 주석을 걷어낸 뒤 잰다.
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트① 그룹 순수 로직 (src/watchlistGroups.ts 직접 import) ──');

let W = null;
try {
  W = await import(pathToFileURL(join(ROOT, 'src/watchlistGroups.ts')).href);
} catch (e) {
  // ⚠️ '런타임이 .ts를 못 읽는다'와 '모듈이 깨졌다'를 반드시 구분한다 — 뭉뚱그려 건너뛰면
  //    import 경로에서 `.ts`를 떼는 것만으로 파트①이 조용히 사라지고도 종료코드 0이 나온다.
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①을 건너뜁니다 (${e.code}).`);
  else { fail++; console.log(`  ✗ 파트① 모듈을 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (W) {
  const { WATCH_RECENT_ID, isAutoWatchGroup, manualWatchGroupIds, reorderManualWatchGroups } = W;

  const R = { id: WATCH_RECENT_ID, name: '최근조회', auto: true };
  const base = [R, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const names = (arr) => (Array.isArray(arr) ? arr.map((g) => g && g.name).join(',') : String(arr));

  // `recordRecent`(WatchlistPopup) 미러 — 최근조회를 **항상 배열 맨 앞**에 다시 붙인다.
  // 이 절이 존재하는 이유 자체이므로 여기에만 미러를 둔다(순수 모듈 밖의 동작이라 import 불가).
  const recordRecent = (arr) => {
    const recent = arr.find((g) => g.id === WATCH_RECENT_ID);
    const others = arr.filter((g) => g.id !== WATCH_RECENT_ID);
    return [{ id: WATCH_RECENT_ID, name: '최근조회', auto: true, createdAt: recent?.createdAt }, ...others];
  };

  // ── 자동 그룹 게이트 ──
  ok('#1 예약 id로 자동 그룹 판정', isAutoWatchGroup(R) === true);
  ok('#2 auto 플래그로도 자동 그룹 판정(id가 달라도)', isAutoWatchGroup({ id: 'x', auto: true }) === true);
  ok('#3 일반 그룹은 자동 아님', isAutoWatchGroup({ id: 'a' }) === false);
  ok('#4 null/undefined 방어', isAutoWatchGroup(null) === false && isAutoWatchGroup(undefined) === false);
  eq('#5 manualWatchGroupIds는 자동 그룹을 뺀 순서 그대로', manualWatchGroupIds(base).join(','), 'a,b,c');

  // ── 재정렬 ──
  eq('#6 C를 맨 앞(수동 슬롯 0)으로', names(reorderManualWatchGroups(base, 'c', 0)), '최근조회,C,A,B');
  eq('#7 A를 맨 뒤(수동 슬롯 3)로', names(reorderManualWatchGroups(base, 'a', 3)), '최근조회,B,C,A');
  eq('#8 A를 B 뒤(수동 슬롯 2)로', names(reorderManualWatchGroups(base, 'a', 2)), '최근조회,B,A,C');
  ok('#9 자동 그룹은 항상 원래 인덱스에 남는다',
    reorderManualWatchGroups(base, 'c', 0)[0].id === WATCH_RECENT_ID);

  // ⚠️ 이 절의 존재 이유 — recordRecent가 최근조회를 맨 앞으로 되돌려도 사용자가 정한
  //    수동 그룹 순서는 살아남아야 한다. 살아남지 못하면 '드래그가 안 먹는' 것으로 보인다.
  eq('#10 recordRecent 이후에도 사용자 순서 보존',
    names(recordRecent(reorderManualWatchGroups(base, 'c', 0))), '최근조회,C,A,B');

  // ⚠️ 변화가 없으면 **같은 참조** — 새 배열을 만들면 지문(JSON.stringify)이 그대로여도
  //    setState가 돌아 제스처마다 헛된 렌더·Drive 저장이 나간다.
  ok('#11 제자리 드롭 → 같은 참조', reorderManualWatchGroups(base, 'b', 1) === base);
  ok('#12 뒤에서 제자리 드롭 → 같은 참조', reorderManualWatchGroups(base, 'b', 2) === base);
  ok('#13 없는 id → 같은 참조', reorderManualWatchGroups(base, 'zz', 0) === base);
  ok('#14 자동 그룹 id로는 이동 불가(같은 참조)', reorderManualWatchGroups(base, WATCH_RECENT_ID, 2) === base);

  // 자동 그룹이 중간/없는 손상·변형 배열에서도 자리 고정이 산술이 아니라 구조로 성립하는가
  const odd = [{ id: 'a', name: 'A' }, R, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  eq('#15 자동 그룹이 중간에 있어도 그 인덱스 고정', names(reorderManualWatchGroups(odd, 'c', 0)), 'C,최근조회,A,B');
  eq('#16 그 결과에서 자동 그룹 인덱스', reorderManualWatchGroups(odd, 'c', 0).findIndex((g) => g.id === WATCH_RECENT_ID), 1);

  const one = [R, { id: 'a', name: 'A' }];
  ok('#17 수동 1개면 어디로 끌어도 같은 참조',
    reorderManualWatchGroups(one, 'a', 0) === one && reorderManualWatchGroups(one, 'a', 1) === one);

  // ── 손상 입력 방어 (throw 금지) ──
  S('#18 배열이 아니면 그대로 반환', () => reorderManualWatchGroups(null, 'a', 0), (v) => v === null);
  S('#19 to가 정수가 아니면 같은 참조', () => reorderManualWatchGroups(base, 'a', 'x'), (v) => v === base);
  S('#20 항목에 id가 없어도 던지지 않는다', () => reorderManualWatchGroups([R, {}, { id: 'a' }], 'a', 0),
    (v) => Array.isArray(v));

  // ── 보기 상태(조회 기간 · 직접 선택 시작/종료일 · 등락율 정렬) ──
  const { normalizeWatchView: N, sameWatchView: SAME, DEFAULT_WATCH_VIEW: DEF, WATCH_PERIODS } = W;
  const nv = (v) => S('(normalize)', () => N(v)) || {};
  // ⚠️ 기본값 = 종전 화면 기본값('1개월', 정렬 없음) — 저장값이 없는 사용자는 종전과 똑같이 보여야 한다.
  ok('#21 기본값은 1개월·정렬 없음(하위호환)', DEF.period === '1개월' && DEF.sortDir === null && DEF.customStart === '' && DEF.customEnd === '');
  eq('#22 기간 목록 = 화면 버튼 6종(직접 포함)', (WATCH_PERIODS || []).join(','), '1일,1주,1개월,3개월,1년,직접');
  eq('#23 정상 값은 그대로', JSON.stringify(nv({ period: '1년', customStart: '', customEnd: '', sortDir: 'asc' })),
    JSON.stringify({ period: '1년', customStart: '', customEnd: '', sortDir: 'asc' }));
  eq('#24 화이트리스트 밖 기간은 기본값', nv({ period: 'weke' }).period, '1개월');
  eq('#25 직접 선택 + 시작일 보존', JSON.stringify(nv({ period: '직접', customStart: '2025-01-02', customEnd: '2025-06-30' })),
    JSON.stringify({ period: '직접', customStart: '2025-01-02', customEnd: '2025-06-30', sortDir: null }));
  eq('#26 직접 선택인데 시작일이 없으면 기본 기간(결과를 낼 수 없다)', nv({ period: '직접', customStart: '' }).period, '1개월');
  eq('#27 달력에 없는 날짜는 버린다(2026-02-31)', nv({ period: '직접', customStart: '2026-02-31' }).customStart, '');
  eq('#28 종료일이 시작일보다 앞이면 비운다(현재까지)', nv({ period: '직접', customStart: '2025-05-01', customEnd: '2025-04-01' }).customEnd, '');
  eq('#29 정렬은 desc/asc만, 그 외는 null', [nv({ sortDir: 'desc' }).sortDir, nv({ sortDir: 'up' }).sortDir, nv({ sortDir: 1 }).sortDir].join(','), 'desc,,');
  S('#30 null·문자열·배열 입력도 던지지 않고 기본값', () => [N(null), N('x'), N([1])],
    (arr) => arr.every((v) => v.period === '1개월' && v.sortDir === null));
  ok('#31 sameWatchView — 같은 내용이면 true(손상 키는 정규화 후 비교)',
    SAME({ period: '1주', sortDir: 'desc' }, { period: '1주', customStart: '', customEnd: '', sortDir: 'desc', extra: 1 }));
  ok('#32 sameWatchView — 정렬만 달라도 false', !SAME({ period: '1주', sortDir: 'desc' }, { period: '1주', sortDir: 'asc' }));

  // ── 팝업 크기(모서리·가장자리 끌기) ──
  const { normalizeWatchSize: NS, sameWatchSize: SS, resizeWatchRect: RR, watchSizeAfterResize: AFTER,
    WATCH_SIZE_FLOOR: FLOOR, WATCH_SIZE_CEIL: CEIL } = W;
  const ns = (v) => S('(normalizeSize)', () => NS(v));
  const js = (v) => JSON.stringify(v);
  // ⚠️ 기본 크기는 한 가지 모양(null)만 — 객체 {w:null,h:null}이 섞이면 같은 상태가 두 저장값을 갖는다.
  ok('#33 손상·빈 입력은 null(= 기본 크기)', [null, undefined, 'x', 3, [], {}].every((v) => ns(v) === null));
  eq('#34 정상 값은 반올림해 보존(높이 자동은 null)', js(ns({ w: 900.4, h: null })), js({ w: 900, h: null }));
  eq('#35 두 축이 모두 자동이면 null', ns({ w: null, h: null }), null);
  eq('#36 하한·상한으로 묶는다', js(ns({ w: 10, h: 99999 })), js({ w: FLOOR, h: CEIL }));
  eq('#37 NaN·Infinity·문자는 그 축만 자동', js(ns({ w: NaN, h: '500' })), js(null));
  eq('#37b 한 축만 손상이면 다른 축은 산다', js(ns({ w: Infinity, h: 480 })), js({ w: null, h: 480 }));
  ok('#38 sameWatchSize — 기본끼리 true · 같은 값 true · 1px 달라도 false',
    SS(null, {}) && SS({ w: 900 }, { w: 900, h: null }) && !SS({ w: 900 }, { w: 901 }) && !SS(null, { w: 900 }));

  const st = (dir, extra) => ({ dir, x: 100, y: 80, w: 800, h: 500, minW: 500, minH: 260, ...extra });
  const rr = (dir, dx, dy, extra, vw = 1600, vh = 1000) => S(`(resize ${dir})`, () => RR(st(dir, extra), dx, dy, vw, vh)) || {};
  // ⚠️ 반대편 가장자리는 제자리여야 한다(창 크기 조절의 감각) — 왼쪽을 끌었는데 오른쪽 끝이 움직이면 패널이 미끄러진다.
  eq('#39 오른쪽(e) +100 → 폭만 늘고 위치·높이는 그대로', js(rr('e', 100, 50)), js({ x: 100, y: 80, w: 900, h: 500 }));
  eq('#40 왼쪽(w) −100 → 왼쪽으로 넓어지고 오른쪽 끝 고정', js(rr('w', -100, 0)), js({ x: 0, y: 80, w: 900, h: 500 }));
  { const r = rr('w', 600, 0); eq('#41 왼쪽을 최소 폭 너머로 끌어도 오른쪽 끝 고정 + 최소 폭', `${r.w},${r.x + r.w}`, '500,900'); }
  { const r = rr('e', 5000, 0); ok('#42 오른쪽은 화면 밖으로 넓어지지 않는다(화면 끝·여백 20px)', r.x + r.w <= 1600 && r.w <= 1600 - 20); }
  eq('#43 아래(s)는 최소 높이 아래로 줄지 않는다', rr('s', 0, -900).h, 260);
  { const r = rr('n', 0, -40); eq('#44 위(n)를 끌면 아래 끝 고정', `${r.y},${r.h},${r.y + r.h}`, '40,540,580'); }
  { const r = rr('n', 0, -500); ok('#44b 위(n)는 화면 위로 넘어가지 않는다', r.y === 0 && r.y + r.h === 580); }
  eq('#45 모서리(se)는 두 축을 함께', js(rr('se', 40, 30)), js({ x: 100, y: 80, w: 840, h: 530 }));
  eq('#45b 모서리(nw)는 위·왼쪽을 옮기고 오른쪽 아래 고정', js(rr('nw', -50, -30)), js({ x: 50, y: 50, w: 850, h: 530 }));
  S('#46 손상 입력에도 던지지 않고 유한한 숫자', () => RR(null, NaN, undefined, 'x', null),
    (v) => v && [v.x, v.y, v.w, v.h].every(Number.isFinite));
  { const r = rr('s', 0, 5000, {}, 1600, 700); ok('#46b 아래는 화면 높이(여백 10px)를 넘지 않는다', r.y + r.h <= 700 && r.h <= 700 - 10); }

  // ⚠️ 끈 축만 저장한다 — 오른쪽만 끌었는데 그 순간의 실측 높이까지 박으면 내용에 맞춰 자라던 높이가 고정된다.
  eq('#47 오른쪽만 끌면 폭만 저장(높이는 자동 유지)', js(AFTER('e', { w: 950, h: 612 }, null)), js({ w: 950, h: null }));
  eq('#48 아래만 끌면 높이만 저장(폭은 이전 값)', js(AFTER('s', { w: 777, h: 640 }, { w: 900, h: null })), js({ w: 900, h: 640 }));
  eq('#49 모서리는 두 축 모두', js(AFTER('sw', { w: 700, h: 600 }, null)), js({ w: 700, h: 600 }));
  eq('#50 가로만 끌어도 이미 고정한 높이는 보존', js(AFTER('w', { w: 820, h: 300 }, { w: 900, h: 480 })), js({ w: 820, h: 480 }));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트② 배선 가드 (소스 텍스트) ──');

const POPUP = src('src/components/WatchlistPopup.tsx');
const WIN = src('src/components/WatchlistWindow.tsx');
const APP = src('src/App.tsx');
const MAIN = src('src/main.tsx');
const MOD = src('src/watchlistGroups.ts');

ok('#G0 소스 4종을 읽었다', !!POPUP && !!WIN && !!APP && !!MAIN && !!MOD);

// ── 순수 모듈 ──
// ⚠️ import가 하나라도 생기면 Node 직접 import(파트①)가 깨진다.
ok('#G1 watchlistGroups.ts 는 import 0건(타입 스트리핑으로 직접 실행 가능)',
  !/^\s*import\s/m.test(stripComments(MOD)));
ok('#G2 enum/namespace 금지(Node 타입 스트리핑 미지원)',
  !/\b(enum|namespace)\s+\w/.test(stripComments(MOD)));

// ── 그룹 사이드바(가로 스크롤 칩 행으로 되돌리지 말 것) ──
ok('#G3 그룹 목록은 세로 사이드바(aside + 자체 세로 스크롤)',
  /<aside[^>]*style=\{\{\s*width:\s*SIDEBAR_W\s*\}\}/.test(POPUP)
  && /ref=\{sidebarListRef\}[^>]*overflow-y-auto/.test(POPUP));
ok('#G4 옛 가로 스크롤 칩 행이 없다(overflow-x-auto + whitespace-nowrap)',
  !/overflow-x-auto[^"]*whitespace-nowrap/.test(stripComments(POPUP)));
ok('#G5 패널 폭은 리스트 640 + 사이드바 폭의 합(둘은 한 세트)',
  /const\s+PANEL_W\s*=\s*640\s*\+\s*SIDEBAR_W\s*;/.test(POPUP));
ok('#G6 사이드바 접기/펼치기 두 방향이 모두 있다(펼치기가 유일한 복귀 경로)',
  /setSidebarOpen\(false\)/.test(POPUP) && /setSidebarOpen\(true\)/.test(POPUP)
  && /<PanelLeftClose\s/.test(POPUP) && /<PanelLeft\s/.test(POPUP));

// ── 그룹 순서 드래그 ──
// ⚠️ 좌표계 일치: 드롭 인덱스는 `[data-watch-group]` 행 수로 재고, 그 속성은 **수동 그룹에만**
//    붙는다. 자동 그룹에 붙이면 두 좌표계가 1만큼 어긋나 드롭이 한 칸씩 빗나간다.
ok('#G7 드롭 인덱스를 data-watch-group 행으로 계산',
  /querySelectorAll\('\[data-watch-group\]'\)/.test(POPUP));
ok('#G8 data-watch-group 은 수동 그룹에만 붙는다(자동 그룹은 undefined)',
  /data-watch-group=\{isAuto \? undefined : ''\}/.test(POPUP));
ok('#G9 재정렬 산술은 공유 모듈이 정본(컴포넌트에서 손계산 금지)',
  /updateGroups\(\(prev\) => reorderManualWatchGroups\(/.test(POPUP)
  && !/const\s+manual\s*=\s*\[\]\s*;/.test(stripComments(POPUP)));
ok('#G10 manualIds 도 공유 모듈에서 얻는다(좌표계 손복제 금지)',
  /const\s+manualIds\s*=\s*manualWatchGroupIds\(list\)\s*;/.test(POPUP));
ok('#G11 자동 그룹 판정도 공유 모듈(손복제 시 그 경로만 조용히 원복)',
  /const\s+isAutoGroupOf\s*=\s*isAutoWatchGroup\s*;/.test(POPUP));

// ── 읽기 전용(별도 창 로드 대기·연결 끊김·impersonation) ──
// ⚠️ 쓰기 호출부가 10곳이라 **단일 통로**가 아니면 하나만 빠뜨려도 그 경로만 저장을 흘려보낸다.
ok('#G12 그룹 쓰기는 updateGroups 단일 통로 + readOnly 게이트',
  /const\s+updateGroups\s*=\s*useCallback\(\(updater\)\s*=>\s*\{\s*\n\s*if \(readOnly\) return;\s*\n\s*onUpdateGroups\?\.\(updater\);/.test(POPUP));
{
  // 통로 밖에서 prop을 직접 부르는 곳이 없어야 한다(선언·통로 본문 1회만 허용).
  const direct = (stripComments(POPUP).match(/onUpdateGroups\?\.\(/g) || []).length;
  eq('#G13 onUpdateGroups 직접 호출은 단일 통로 안 1회뿐', direct, 1);
}
ok('#G14 드래그 2종이 readOnly에서 꺼진다',
  /const\s+canReorder\s*=\s*!readOnly\s*&&/.test(POPUP)
  && /const\s+canReorderGroups\s*=\s*!readOnly\s*&&/.test(POPUP));
ok('#G15 읽기 전용이면 그룹 추가·이름변경/삭제 UI를 감춘다',
  /\{!readOnly && \(creating \?/.test(POPUP) && /\{!isAuto && !readOnly && \(/.test(POPUP));
ok('#G16 읽기 전용 빈 목록에서 "만들어 보세요"라고 하지 않는다',
  /readOnly \? '표시할 관심 그룹이 없습니다'/.test(POPUP));

// ── 별도 창 부팅 ──
ok('#G17 main.tsx 가 URL 파라미터로 App 대신 창을 렌더한다',
  /const\s+WATCHLIST_WINDOW_BOOT\s*=\s*_params\.get\('watchlistWindow'\)\s*===\s*'1'/.test(MAIN)
  && /WATCHLIST_WINDOW_BOOT \? <WatchlistWindow \/>/.test(MAIN));

// ── 브릿지: 데이터 유실 방지 ──
// ⚠️ watchlistGroups 는 백업 복원 sticky(_preserveStickyPersonalData)라, 로드 전 빈 배열이
//    한 번 덮으면 백업으로도 되돌릴 수 없다(가계부 2026-08-30 사고와 같은 부류).
ok('#G18 앱이 dataState를 함께 보내고 deps에도 넣는다',
  /type: 'watchlist:live'[^}]*dataState: ledgerDataState/.test(APP)
  && /\}, \[watchlistGroups, watchlistView, adminViewingAs, ledgerDataState, watchlistWinNonce\]\);/.test(APP));
ok('#G19 창은 dataState==="ready" 일 때만 쓰기를 연다(gotData·linked·readOnly 포함)',
  /const\s+writable\s*=\s*linked\s*&&\s*gotData\s*&&\s*!appReadOnly\s*&&\s*appDataState === 'ready'\s*;/.test(WIN));
ok('#G20 창의 dataState 채택은 화이트리스트(fail-closed — 모르는 값은 loading)',
  /setAppDataState\(d\.dataState === 'ready' \|\| d\.dataState === 'error' \? d\.dataState : 'loading'\)/.test(WIN)
  && /useState\('loading'\)/.test(WIN));
ok('#G21 창의 수신 화이트리스트에 live·pong 두 타입이 모두 있다',
  /d\.type !== 'watchlist:live' && d\.type !== 'watchlist:pong'/.test(WIN));
ok('#G22 앱의 쓰기 핸들러가 impersonation을 재확인한다(fail-closed 정본)',
  /d\.type === 'watchlist:groups'[\s\S]{0,400}?if \(adminViewingAsRef\.current\) return;/.test(APP));

// ── 브릿지: 연결 ──
ok('#G23 ping.need 가 초기 전송의 유일한 트리거 + 재입양',
  /type: 'watchlist:ping', need: !gotDataRef\.current/.test(WIN)
  && /if \(d\.need \|\| watchlistWinRef\.current !== e\.source\)/.test(APP));
ok('#G24 origin 검사 양쪽 모두',
  /e\.origin !== window\.location\.origin/.test(WIN) && /e\.origin !== window\.location\.origin/.test(APP));
{
  // ⚠️ noopener 금지(opener 브릿지가 기능의 전부) · features 인자 금지(크롬이 '팝업'으로 열어
  //    주소창·확장 아이콘이 사라진다) · 이름은 유지(같은 탭 재사용이 중복 열기를 막는 유일한 장치).
  const m = APP.match(/window\.open\('\/\?watchlistWindow=1'[^)]*\)/);
  ok('#G25 window.open 은 URL+이름 2인자(noopener·features 없음)',
    !!m && m[0] === "window.open('/?watchlistWindow=1', 'ass-watchlist')");
}
ok('#G26 팝업 차단 시 인앱 폴백(최악의 경우가 기존 동작)',
  /setWatchlistWinBlocked\(true\);\s*\n\s*setShowWatchlist\(true\);/.test(APP));
ok('#G27 인앱 팝업에 확장 버튼과 readOnly가 배선돼 있다',
  /onOpenWindow=\{openWatchlistWindow\}/.test(APP) && /readOnly=\{!!adminViewingAs\}/.test(APP));
ok('#G28 확장 버튼은 창 자신에는 렌더하지 않는다(onOpenWindow && !isPage)',
  /\{onOpenWindow && !isPage && \(/.test(POPUP));
// ⚠️ 타이틀 바가 드래그 핸들이라 stopPropagation 이 없으면 버튼을 누르는 순간 패널 드래그가 시작된다.
ok('#G29 확장 버튼이 타이틀바 드래그를 막는다',
  /onMouseDown=\{\(e\) => e\.stopPropagation\(\)\}\s*\n\s*onClick=\{onOpenWindow\}/.test(POPUP));
ok('#G30 창은 자체 ErrorBoundary label 을 갖는다(루트 경계는 label이 없어 전체가 오류 페이지가 된다)',
  /<ErrorBoundary label="관심종목">/.test(WIN));

// ⚠️ 시세를 공유 stockHistoryMap 에 병합하면 보유종목 과거 평가액이 영구히 오염된다.
// ⚠️ 반드시 **주석을 걷어낸 뒤** 잰다 — 이 저장소는 금지 이유를 바로 그 자리 주석에 적으므로
//    원문으로 재면 그 설명 주석에 걸려 가드가 영구히 실패한다(실측: WatchlistPopup:223).
ok('#G31 관심종목 경로는 stockHistoryMap 을 건드리지 않는다',
  !/stockHistoryMap/.test(stripComments(POPUP)) && !/stockHistoryMap/.test(stripComments(WIN)));

// ── 보기 상태 저장(조회 기간 · 직접 선택 날짜 · 등락율 정렬 — chartPrefs.watchlistView) ──
// ⚠️ chartPrefs 영속화는 5지점이 한 세트다. 하나만 빠져도 조용히 유실된다
//    (deps 누락 → 저장 미예약 / chartPrefsUpdatedAt 누락 → STATE write 스킵 / 로드 누락 → 다음 실행에 초기화).
{
  const literal = APP.match(/chartPrefs: \{[^}]*\}, intHistory,/);
  ok('#G32 STATE 저장 payload 의 chartPrefs 리터럴에 watchlistView', !!literal && /\bwatchlistView\b/.test(literal[0]));
  ok('#G33 chartPrefsUpdatedAt effect deps 에 watchlistView',
    /fxCurrencies, fxSlotCount, watchlistView, watchlistSize, compStocks\]\);/.test(APP));
  ok('#G34 STATE 저장 effect deps 에 watchlistView',
    /fxCurrencies, fxSlotCount, watchlistView, watchlistSize, calendarMemos, watchlistGroups,/.test(APP));
  eq('#G35 로드 2경로(applyStateData·applyBackupData)가 watchlistView 를 복원',
    (APP.match(/if \(stateData\.chartPrefs\.watchlistView !== undefined\) setWatchlistView\(stateData\.chartPrefs\.watchlistView\);/g) || []).length, 2);
  ok('#G36 App setter 는 정규화 + 같은 값이면 같은 참조(헛된 Drive 저장 방지)',
    /const next = normalizeWatchView\(v\);\s*\n\s*setWatchlistViewRaw\(prev => \(sameWatchView\(prev, next\) \? prev : next\)\);/.test(APP));
  ok('#G37 인앱 팝업에 view·onViewChange 배선(관리자 열람 중엔 미전달 = 로컬)',
    /view=\{watchlistView\}/.test(APP) && /onViewChange=\{adminViewingAs \? null : setWatchlistView\}/.test(APP));
  // ⚠️ 네 값을 따로 setState하면 한 클릭에서 두 값을 바꿀 때(📅 기간) 뒤 호출이 낡은 값 위에 덮어 시작일이 사라진다.
  ok('#G38 팝업은 보기 상태를 한 객체(patchView)로만 바꾼다 — 개별 setter 부재',
    !/\bset(Period|SortDir|CustomStart|CustomEnd)\(/.test(stripComments(POPUP))
    && /const\s+patchView\s*=\s*useCallback\(/.test(POPUP));
  ok('#G39 patchView 는 같은 값이면 아무것도 쓰지 않고, 제어 모드면 onViewChange 로 보낸다',
    /if \(sameWatchView\(next, base\)\) return;/.test(POPUP)
    && /if \(viewControlled\) onViewChange\(next\);\s*\n\s*else setLocalView\(next\);/.test(POPUP));
  ok('#G40 📅 기간 버튼은 시작일 채우기 + 기간 전환을 한 번에(patchView 1회)',
    /patchView\(\(v\) => \(\{ period: CUSTOM, customStart: v\.customStart \|\| cutoffFor\('1개월'\) \}\)\)/.test(POPUP));
  ok('#G41 등락율 정렬도 patchView 경유(저장 대상)',
    /const cycleSort = \(\) => patchView\(/.test(POPUP));
  // ⚠️ 창은 앱 값을 'ready' 첫 메시지에서 한 번만 채택한다 — 매번 채택하면 메아리가 방금 누른 값을 되돌리고,
  //    로드 전 메시지(기본값)를 채택하면 저장값을 영영 못 받는다.
  ok('#G42 창은 dataState==="ready" 첫 메시지에서 한 번만 view 채택',
    /if \(d\.dataState === 'ready' && !viewSeededRef\.current\) \{\s*\n\s*viewSeededRef\.current = true;\s*\n\s*setView\(normalizeWatchView\(d\.view\)\);/.test(WIN));
  ok('#G43 창은 쓰기가 열려 있을 때만 view 를 앱으로 보낸다',
    /if \(writableRef\.current\) post\(\{ type: 'watchlist:view', view: v \}\);/.test(WIN)
    && /view=\{view\}\s*\n\s*onViewChange=\{onViewChange\}/.test(WIN));
  ok('#G44 앱이 live 에 view 를 싣는다',
    /type: 'watchlist:live', groups: watchlistGroups, view: watchlistView,/.test(APP));
  ok('#G45 앱의 watchlist:view 핸들러가 impersonation 을 재확인하고 정규화 setter 를 쓴다',
    /d\.type === 'watchlist:view'[\s\S]{0,300}?if \(adminViewingAsRef\.current\) return;\s*\n\s*setWatchlistView\(d\.view\);/.test(APP));
}

// ── 팝업 크기(모서리·가장자리 끌기 — chartPrefs.watchlistSize) ──
// ⚠️ 영속화 5지점은 watchlistView와 같은 세트다. 하나만 빠져도 조용히 유실된다.
{
  const literal = APP.match(/chartPrefs: \{[^}]*\}, intHistory,/);
  ok('#G46 STATE 저장 payload 의 chartPrefs 리터럴에 watchlistSize', !!literal && /\bwatchlistSize\b/.test(literal[0]));
  ok('#G47 chartPrefsUpdatedAt effect deps 에 watchlistSize', /watchlistSize, compStocks\]\);/.test(APP));
  ok('#G48 STATE 저장 effect deps 에 watchlistSize', /watchlistSize, calendarMemos, watchlistGroups,/.test(APP));
  eq('#G49 로드 2경로가 watchlistSize 를 복원',
    (APP.match(/if \(stateData\.chartPrefs\.watchlistSize !== undefined\) setWatchlistSize\(stateData\.chartPrefs\.watchlistSize\);/g) || []).length, 2);
  ok('#G50 App setter 는 정규화 + 같은 값이면 같은 참조',
    /const next = normalizeWatchSize\(v\);\s*\n\s*setWatchlistSizeRaw\(prev => \(sameWatchSize\(prev, next\) \? prev : next\)\);/.test(APP));
  ok('#G51 인앱 팝업에 size·onSizeChange 배선(관리자 열람 중엔 미전달 = 로컬)',
    /size=\{watchlistSize\}/.test(APP) && /onSizeChange=\{adminViewingAs \? null : setWatchlistSize\}/.test(APP));
  // 별도 창은 브라우저가 창 크기를 정한다 — 크기 저장값을 주고받지 않는다.
  ok('#G52 별도 창 경로에는 크기 배선이 없다', !/onSizeChange|watchlistSize/.test(stripComments(WIN)));

  const P = stripComments(POPUP);
  const body = (start, end) => { const i = P.indexOf(start); const j = i < 0 ? -1 : P.indexOf(end, i + start.length); return i < 0 || j < 0 ? '' : P.slice(i, j); };
  const moveBody = body('const onResizeMove = (e) => {', 'const endResize = () => {');
  const endBody = body('const endResize = () => {', 'const resetSize = () => {');
  // ⚠️ 포인터가 움직일 때마다 저장하면 프레임마다 chartPrefs가 바뀌어 Drive 저장이 폭주한다 → 놓을 때 한 번만.
  ok('#G53 끄는 중(onResizeMove)에는 저장하지 않는다', moveBody.length > 0 && !/commitSize|onSizeChange/.test(moveBody));
  ok('#G54 화면 갱신은 프레임당 한 번(requestAnimationFrame)', /requestAnimationFrame\(/.test(moveBody));
  ok('#G55 놓을 때 끈 축만 저장한다(watchSizeAfterResize)',
    /commitSize\(watchSizeAfterResize\(st\.dir, r, sizeRef\.current\)\)/.test(endBody));
  // ⚠️ 누르기만 하고 놓은 클릭이 '자동 높이'를 그 순간의 실측값으로 박지 않게 한다.
  ok('#G56 움직이지 않은 클릭은 저장하지 않는다', /if \(!st\.moved \|\| !r\) return;[\s\S]*commitSize\(/.test(endBody));
  ok('#G57 commitSize 는 같은 값이면 아무것도 쓰지 않고, 제어 모드면 onSizeChange 로 보낸다',
    /if \(sameWatchSize\(next, sizeRef\.current\)\) return;/.test(P)
    && /if \(sizeControlled\) onSizeChange\(next\);\s*\n\s*else setLocalSize\(next\);/.test(P));
  // ⚠️ 패널은 overflow-hidden이라 테두리에 걸친 손잡이는 패널 **밖**(래퍼)에 있어야 잘리지 않는다.
  //    별도 창(page)은 손잡이 없이 패널만 — 브라우저가 창 크기를 정한다.
  const iPage = P.indexOf('if (isPage) return panel;');
  const iPanel = P.indexOf('{panel}', iPage);
  const iMap = P.indexOf('RESIZE_HANDLES.map(', iPage);
  ok('#G58 손잡이는 패널 밖 래퍼에서 렌더(별도 창 제외)', iPage > 0 && iPanel > iPage && iMap > iPanel);
  const dirs = (POPUP.match(/\{ dir: '(n|s|e|w|ne|nw|se|sw)', cursor:/g) || []).map((m) => m.match(/'(\w+)'/)[1]).sort().join(',');
  eq('#G59 손잡이 8개(모서리 4 + 가장자리 4)', dirs, 'e,n,ne,nw,s,se,sw,w');
  const mapBody = body('RESIZE_HANDLES.map(', '))}');
  ok('#G60 손잡이가 포인터 이벤트를 다 받는다(누르기·이동·놓기·취소·더블클릭 초기화)',
    ['onPointerDown={(e) => onResizeDown(e, hd.dir)}', 'onPointerMove={onResizeMove}', 'onPointerUp={endResize}',
      'onPointerCancel={endResize}', 'onLostPointerCapture={endResize}', 'onDoubleClick={resetSize}']
      .every((t) => mapBody.includes(t)));
  ok('#G60b 더블클릭 = 기본 크기로(유일한 되돌리기 경로)', /const resetSize = \(\) => \{\s*\n\s*commitSize\(null\);/.test(P));
  // ⚠️ CSS 상한과 계산 여백이 다르면 놓는 순간 크기가 튄다 — 관계를 단언한다(리터럴 하나만 박지 말 것).
  ok('#G61 CSS 상한 = 계산 여백(가로·세로)',
    POPUP.includes(`maxWidth: 'calc(100vw - ${W?.WATCH_VIEW_MARGIN_X ?? 'X'}px)'`)
    && POPUP.includes(`maxHeight: 'calc(100vh - ${W?.WATCH_VIEW_MARGIN_Y ?? 'Y'}px)'`));
  // 저장값이 좁아도 사이드바를 펼치면 리스트가 겹치지 않게 표시 시점에 최소 폭으로 넓힌다.
  ok('#G62 표시 폭은 최소 폭 이상(사이드바 펼침 반영)',
    /const minW = sidebarOpen \? SIDEBAR_W \+ LIST_MIN_W : /.test(P)
    && /Math\.max\(minW, curSize\?\.w \?\? PANEL_W\)/.test(P));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:watchlist — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
