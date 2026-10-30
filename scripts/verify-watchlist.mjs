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
//     #51~#69 종목 하이라이트 — 팔레트 · 다음 색(칠할 때마다 다른 색) · 켜고 끄기 · 모두 해제
//   파트①-b `src/watchlistChart.ts` **직접 import** (#80~#98b)
//     #80~#83 기간 구간·등락율 — 옛 팝업 본문(legacy*)과 무작위 대조(팝업 숫자가 한 글자도 안 바뀌었는가)
//     #84~#92 종목 비교 차트 창 — 행·직전 종가·구간 수익률·날짜 라벨·주소·창 이름
//     #93~#95 최근 분배금 — 네이버 ETF 이력 · 일반 주식 연간 요약 · 야후(직전 종가 대비 분배율)
//     #96~#96m 차트 구간 선택 상태 전이 — 드래그 · 더블클릭 시작점 고정 → 끝점 클릭(수익률 차트와 같은 제스처)
//     #97a~#97o 보유 종목 매입가 — 표의 구매단가와 같은 식 · 계좌별 · 통화 맞춤 · 눈금 넓히기/가장자리 판정
//     #98a~#98b 앞자리 0이 빠진 국내 코드 복원 후보(241D0 → 0241D0)
//     #99a~#99i 자동 '보유종목' 그룹 — 전체 계좌 종목 · 같은 종목은 계좌마다 한 줄(붙어서) · 그 계좌/다른 계좌 구분
//   파트② 소스 텍스트 가드 (#G1~#G107)
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
    JSON.stringify({ period: '1년', customStart: '', customEnd: '', sortDir: 'asc', showDiv: false }));
  eq('#24 화이트리스트 밖 기간은 기본값', nv({ period: 'weke' }).period, '1개월');
  eq('#25 직접 선택 + 시작일 보존', JSON.stringify(nv({ period: '직접', customStart: '2025-01-02', customEnd: '2025-06-30' })),
    JSON.stringify({ period: '직접', customStart: '2025-01-02', customEnd: '2025-06-30', sortDir: null, showDiv: false }));
  // ── 분배금 열 펼침(showDiv) — 기본 숨김(사용자 요청), 옛 저장값·손상값도 숨김 ──
  ok('#25b showDiv 기본값은 false(기본 숨김)', DEF.showDiv === false && nv({}).showDiv === false);
  eq('#25c showDiv는 === true 일 때만 펼침(문자열·1·"true"는 숨김)',
    [nv({ showDiv: true }).showDiv, nv({ showDiv: 'true' }).showDiv, nv({ showDiv: 1 }).showDiv, nv({ showDiv: null }).showDiv].join(','),
    'true,false,false,false');
  // ⚠️ 비교에서 빠지면 '분배금 열만 펼친 클릭'이 같은 값으로 오판돼 저장되지 않는다.
  ok('#25d sameWatchView 가 showDiv 차이를 잡는다', !SAME({ showDiv: true }, { showDiv: false }) && SAME({ showDiv: false }, {}));
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

  // ── 종목 하이라이트(행 왼쪽 끝 클릭 — 칠할 때마다 다른 색) ──
  const { WATCH_HIGHLIGHT_COLORS: PAL, watchHighlightOf: HOF, nextWatchHighlight: NEXT,
    toggleWatchHighlight: TOG, clearWatchHighlights: CLR } = W;
  const keys = (PAL || []).map((c) => c.key);
  ok('#51 팔레트 8색 · key/hex 중복 없음', keys.length === 8 && new Set(keys).size === 8
    && new Set((PAL || []).map((c) => c.hex)).size === 8);
  // ⚠️ 옆 칸 등락율이 상승=빨강 / 하락=파랑이라 그 계열을 쓰면 하이라이트가 등락으로 읽힌다.
  const hueOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.15) return null;   // 무채색에 가까움(흰색 칸) — 색상각이 의미 없다
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  ok('#52 빨강·파랑 계열 없음(등락율 색과 혼동 금지)', (PAL || []).every((c) => {
    const h = hueOf(c.hex);
    return h == null || !(h < 15 || h >= 345 || (h >= 200 && h <= 245));
  }));
  ok('#53 watchHighlightOf — 팔레트 key만 인정(손상·옛 값은 null)',
    HOF('amber')?.hex === PAL[0].hex && [null, undefined, 'red', 3, {}, ''].every((v) => HOF(v) === null));
  eq('#54 아무도 안 칠했으면 첫 색', NEXT([]), keys[0]);
  eq('#55 이미 쓴 색은 건너뛴다', NEXT([{ highlight: keys[0] }, { highlight: keys[2] }]), keys[1]);
  eq('#56 손상값은 쓴 색으로 세지 않는다', NEXT([{ highlight: 'red' }, { highlight: null }]), keys[0]);
  eq('#57 다 쓰면 가장 적게 쓴 색(팔레트 순서)', NEXT([...keys.map((k) => ({ highlight: k })), { highlight: keys[0] }]), keys[1]);
  S('#57b 배열이 아니어도 던지지 않고 첫 색', () => NEXT(null), (v) => v === keys[0]);

  const mk = () => [
    { id: 'g1', name: 'G1', stocks: [{ id: 's1', code: 'A' }, { id: 's2', code: 'B' }, { id: 's3', code: 'C' }, { id: 's4', code: 'D' }] },
    { id: 'g2', name: 'G2', stocks: [{ id: 't1', code: 'A', highlight: keys[0] }] },
  ];
  const hlOf = (gs, gid, sid) => gs.find((g) => g.id === gid).stocks.find((s) => s.id === sid).highlight;
  {
    const g0 = mk();
    const a = S('(toggle)', () => TOG(g0, 'g1', 's1'));
    eq('#58 켜면 그 그룹의 다음 색', a && hlOf(a, 'g1', 's1'), keys[0]);
    ok('#59 다른 그룹·다른 종목은 같은 참조(불변 갱신)', a && a[1] === g0[1] && a[0].stocks[1] === g0[0].stocks[1] && a !== g0);
    // ⚠️ 그룹마다 따로 센다 — 다른 그룹(g2)이 amber를 써도 g1의 첫 색은 amber다.
    const b = TOG(TOG(a, 'g1', 's2'), 'g1', 's3');
    eq('#60 칠할 때마다 다른 색', ['s1', 's2', 's3'].map((id) => hlOf(b, 'g1', id)).join(','), keys.slice(0, 3).join(','));
    const c = TOG(b, 'g1', 's2');
    ok('#61 다시 누르면 해제 — 필드 자체를 지운다(null을 남기지 않는다)',
      !Object.prototype.hasOwnProperty.call(c[0].stocks[1], 'highlight') && !JSON.stringify(c[0].stocks[1]).includes('highlight'));
    // 가운데 색을 지운 뒤 새로 칠하면 비어 있는 그 색 — '마지막 색의 다음'이면 이미 쓰는 색과 겹친다.
    const d = TOG(c, 'g1', 's4');
    eq('#62 지운 자리의 색을 다시 쓴다(현재 칠한 색과 겹치지 않음)', hlOf(d, 'g1', 's4'), keys[1]);
    ok('#63 칠한 색이 서로 다르다', new Set(['s1', 's3', 's4'].map((id) => hlOf(d, 'g1', id))).size === 3);
  }
  {
    const g0 = mk();
    ok('#64 없는 그룹·없는 종목·배열 아님 → 같은 참조',
      TOG(g0, 'zz', 's1') === g0 && TOG(g0, 'g1', 'zz') === g0 && TOG(null, 'g1', 's1') === null);
    const bad = [{ id: 'g1', stocks: [{ id: 's1', highlight: 'red' }] }];
    eq('#65 손상값이 있던 종목을 누르면 정상 색으로 칠한다', TOG(bad, 'g1', 's1')[0].stocks[0].highlight, keys[0]);
    const frozen = JSON.parse(JSON.stringify(g0));
    const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
    S('#66 입력을 제자리에서 바꾸지 않는다(얼린 입력에도 던지지 않음)', () => TOG(deepFreeze(frozen), 'g2', 't1'),
      (v) => Array.isArray(v) && frozen[1].stocks[0].highlight === keys[0]);
    S('#66b stocks가 없는 그룹도 던지지 않는다', () => TOG([{ id: 'g1' }], 'g1', 's1'), (v) => Array.isArray(v));
  }
  {
    const g0 = mk();
    const lit = TOG(TOG(g0, 'g1', 's1'), 'g1', 's2');
    const cl = S('(clear)', () => CLR(lit, 'g1'));
    ok('#67 모두 해제 — 그 그룹의 highlight 필드를 전부 지운다',
      cl && cl[0].stocks.every((s) => !Object.prototype.hasOwnProperty.call(s, 'highlight')));
    ok('#68 다른 그룹은 건드리지 않는다(같은 참조)', cl && cl[1] === lit[1]);
    ok('#69 지울 것이 없으면 같은 참조(헛된 저장 방지)', CLR(g0, 'g1') === g0 && CLR(g0, 'zz') === g0 && CLR(null, 'g1') === null);
    const withNull = [{ id: 'g1', stocks: [{ id: 's1', highlight: null }] }];
    ok('#69b 손상값(null)도 지울 대상', CLR(withNull, 'g1') !== withNull);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 파트①-b 기간 구간 · 종목 비교 차트 · 최근 분배금 (src/watchlistChart.ts 직접 import) ──');

let C = null;
try {
  C = await import(pathToFileURL(join(ROOT, 'src/watchlistChart.ts')).href);
} catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) console.log(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 파트①-b를 건너뜁니다 (${e.code}).`);
  else { fail++; console.log(`  ✗ 파트①-b 모듈을 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

if (C) {
  const { periodCutoff, watchPeriodWindow, windowRate, buildChartRows, closeOnOrBefore, rangeRate, chartDateLabel,
    normalizeChartComps, normalizeChartView, chartPeriodFromWatch, stockChartUrl, stockChartWindowName, stockDetailUrl,
    pickNaverDividend, pickNaverAnnualDividend, pickYahooDividend, CHART_PERIODS, MAX_CHART_COMPS } = C;

  // ── 하위호환의 축: 팝업이 공용 함수로 옮겨 가기 **이전** 본문(커밋 bb637fe 시점) ──
  // ⚠️ 이 두 함수는 src를 고칠 때 **따라 고치지 말 것** — 따라 고치면 '팝업 등락율이 한 글자도 안 바뀌었다'는
  //    단언이 통째로 죽는다(verify:flow #103과 같은 규약).
  const legacyCutoff = (period, today) => {
    const [y, m, dd] = today.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, dd));
    if (period === '1주') d.setUTCDate(d.getUTCDate() - 7);
    else if (period === '1개월') d.setUTCMonth(d.getUTCMonth() - 1);
    else if (period === '3개월') d.setUTCMonth(d.getUTCMonth() - 3);
    else if (period === '1년') d.setUTCFullYear(d.getUTCFullYear() - 1);
    else return '';
    return d.toISOString().split('T')[0];
  };
  const legacyView = (dailyIn, period, customStart, customEnd, q, today, cut) => {
    const daily = dailyIn || [];
    let win;
    let liveTail = false;
    if (period === '직접') {
      win = customStart ? daily.filter(([dt]) => dt >= customStart && (!customEnd || dt <= customEnd)) : [];
      const livePx = q ? Number(q.price) : 0;
      if (!customEnd && win.length && livePx > 0) {
        const lastD = win[win.length - 1][0];
        win = lastD >= today ? [...win.slice(0, -1), [lastD, livePx]] : [...win, [today, livePx]];
        liveTail = true;
      }
    } else {
      win = cut ? daily.filter(([dt]) => dt >= cut) : daily;
    }
    const first = win[0];
    const last = win[win.length - 1];
    const ok = win.length >= 2 && first[1] > 0;
    return { points: win.map(([, c]) => c), rate: ok ? (last[1] / first[1] - 1) * 100 : null, liveTail, base: ok ? first : null };
  };
  const newView = (daily, period, customStart, customEnd, q, today, cut) => {
    const { win, liveTail } = watchPeriodWindow(daily, { period, cutoff: cut, customStart, customEnd, livePrice: q ? Number(q.price) : 0, today });
    const { rate, first } = windowRate(win);
    return { points: win.map(([, c]) => c), rate, liveTail, base: rate != null ? first : null };
  };

  // ── periodCutoff ──
  {
    const days = ['2026-01-31', '2026-03-31', '2026-02-28', '2024-02-29', '2026-10-16', '2025-12-31'];
    let diff = 0;
    for (const t of days) for (const p of ['1일', '1주', '1개월', '3개월', '1년', '직접', 'x']) {
      if (periodCutoff(p, t) !== legacyCutoff(p, t)) diff++;
    }
    eq('#80 periodCutoff = 옛 팝업 cutoffFor(공유 기간 4종·월 넘침 규칙 포함) 차이 0건', diff, 0);
  }
  eq('#80b 월 넘침 규칙 보존(3/31 − 1개월 = 3/3)', periodCutoff('1개월', '2026-03-31'), '2026-03-03');
  eq('#80c 차트 창 전용 기간(6개월·3년·5년)', [periodCutoff('6개월', '2026-10-16'), periodCutoff('3년', '2026-10-16'), periodCutoff('5년', '2026-10-16')].join(','),
    '2026-04-16,2023-10-16,2021-10-16');
  eq('#80d 잘못된 today·모르는 기간은 빈 문자열(던지지 않는다)', [periodCutoff('1주', 'bad'), periodCutoff('1주', null), periodCutoff('1일', '2026-10-16')].join('|'), '||');

  // ── watchPeriodWindow / windowRate — 옛 팝업 본문과 결과가 같아야 한다(무작위 대조) ──
  {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const day = (n) => new Date(Date.UTC(2025, 0, 1) + n * 86400000).toISOString().slice(0, 10);
    let diff = 0, cases = 0, tails = 0, nulls = 0;
    for (let k = 0; k < 400; k++) {
      const n = Math.floor(rnd() * 12);
      const start0 = Math.floor(rnd() * 30);
      const daily = [];
      for (let i = 0; i < n; i++) daily.push([day(start0 + i * (1 + Math.floor(rnd() * 3))), Math.round((50 + rnd() * 100) * 100) / 100]);
      const period = ['1주', '1개월', '직접', '직접', '1년'][Math.floor(rnd() * 5)];
      const today = day(start0 + Math.floor(rnd() * 40));
      const cut = period === '직접' ? '' : (rnd() < 0.2 ? '' : day(Math.floor(rnd() * 40)));
      const cs = rnd() < 0.15 ? '' : day(Math.floor(rnd() * 35));
      const ce = rnd() < 0.5 ? '' : day(Math.floor(rnd() * 45));
      const csx = ce && cs && ce < cs ? '' : ce;   // 팝업은 normalizeWatchView를 거친 값만 받는다
      const q = rnd() < 0.3 ? null : { price: rnd() < 0.15 ? 0 : Math.round((50 + rnd() * 100) * 100) / 100 };
      const dIn = rnd() < 0.05 ? undefined : daily;
      const a = legacyView(dIn, period, cs, csx, q, today, cut);
      const b = newView(dIn, period, cs, csx, q, today, cut);
      cases++;
      if (a.liveTail) tails++;
      if (a.rate == null) nulls++;
      if (JSON.stringify(a) !== JSON.stringify(b)) diff++;
    }
    eq(`#81 팝업 등락율·미니차트·기준가가 옛 본문과 같다(${cases}건 · 현재가 꼬리 ${tails} · null ${nulls})`, diff, 0);
    ok('#81b 무작위 표본이 현재가 꼬리·null 분기를 실제로 밟았다(죽은 대조 방지)', tails > 10 && nulls > 10);
  }
  {
    const d = [['2026-10-12', 100], ['2026-10-13', 102], ['2026-10-14', 101]];
    const custom = (o) => watchPeriodWindow(d, { period: '직접', ...o });
    eq('#82 직접 선택 + 시작일 없음 → 빈 구간(null 계약)', custom({ customStart: '', livePrice: 105, today: '2026-10-16' }).win.length, 0);
    eq('#82b 종료일 비움 + 오늘 일봉 없음 → 현재가를 덧붙인다',
      JSON.stringify(custom({ customStart: '2026-10-13', livePrice: 105, today: '2026-10-16' })),
      JSON.stringify({ win: [['2026-10-13', 102], ['2026-10-14', 101], ['2026-10-16', 105]], liveTail: true }));
    eq('#82c 오늘 일봉이 있으면 그 값을 현재가로 대체',
      JSON.stringify(custom({ customStart: '2026-10-12', livePrice: 99, today: '2026-10-14' }).win[2]), JSON.stringify(['2026-10-14', 99]));
    ok('#82d 종료일이 있거나 현재가가 없으면 꼬리 없음',
      custom({ customStart: '2026-10-12', customEnd: '2026-10-13', livePrice: 105, today: '2026-10-16' }).liveTail === false
      && custom({ customStart: '2026-10-12', livePrice: 0, today: '2026-10-16' }).liveTail === false);
    eq('#83 windowRate — 2점 미만은 null(0.00% 단언 금지)', windowRate([['2026-10-12', 100]]).rate, null);
    eq('#83b windowRate — 마지막 ÷ 첫 종가 − 1', Math.round(windowRate(d).rate * 1e6) / 1e6, 1);
    S('#83c 손상 입력에도 던지지 않는다', () => [watchPeriodWindow(null, null), windowRate('x'), watchPeriodWindow([[1, 2], ['a']], { period: '1주', cutoff: '' })],
      (v) => v[0].win.length === 0 && v[1].rate === null && v[2].win.length === 0);
  }

  // ── 비교 차트 행 ──
  {
    const a = [['2026-10-01', 100], ['2026-10-02', 110], ['2026-10-05', 120]];
    const b = [['2026-10-02', 50], ['2026-10-03', 40], ['2026-10-05', 55]];
    const rows = S('(rows)', () => buildChartRows([{ key: 's0', win: a }, { key: 's1', win: b }])) || [];
    eq('#84 날짜 합집합 · 오름차순', rows.map((r) => r.date).join(','), '2026-10-01,2026-10-02,2026-10-03,2026-10-05');
    ok('#84b 각 종목은 **자기 구간 첫 종가**로 0% (늦게 시작한 종목도 0%에서 출발)', rows[0].s0 === 0 && rows[1].s1 === 0);
    ok('#84c 그 날 종가가 없으면 null(0으로 단언 금지) · 종가 키도 함께', rows[0].s1 === null && rows[2].s0 === null && rows[2]['px:s1'] === 40);
    // ⚠️ 차트 끝점 = 화면의 '기간 수익률'(windowRate) — 갈리면 선 끝과 칩 숫자가 다르게 보인다.
    ok('#84d 마지막 행 값 = windowRate(win).rate', Math.abs(rows[3].s0 - windowRate(a).rate) < 1e-9 && Math.abs(rows[3].s1 - windowRate(b).rate) < 1e-9);
    S('#84e 손상 입력에도 던지지 않는다', () => buildChartRows([null, { key: 's0', win: null }, { key: 1 }]), (v) => Array.isArray(v) && v.length === 0);
    eq('#85 closeOnOrBefore — 휴장일이면 직전 거래일 종가', JSON.stringify(closeOnOrBefore(b, '2026-10-04')), JSON.stringify(['2026-10-03', 40]));
    eq('#85b closeOnOrBefore — 첫 종가보다 앞이면 null', closeOnOrBefore(b, '2026-10-01'), null);
    ok('#85c rangeRate — 순서를 바꿔 골라도 같은 값', rangeRate(a, '2026-10-05', '2026-10-02').rate === rangeRate(a, '2026-10-02', '2026-10-05').rate
      && Math.abs(rangeRate(a, '2026-10-02', '2026-10-05').rate - (120 / 110 - 1) * 100) < 1e-9);
    eq('#86 날짜 라벨 = YY/MM/DD (요일) — 요일은 UTC로(사진2: 26/10/16 (금))', chartDateLabel('2026-10-16'), '26/10/16 (금)');
  }

  // ── 차트 창 주소·이름·기간 ──
  eq('#87 팝업 기간 → 차트 기간(1일은 장중이라 1개월)', ['1일', '1주', '1개월', '3개월', '1년', '직접', 'x'].map(chartPeriodFromWatch).join(','),
    '1개월,1주,1개월,3개월,1년,직접,1년');
  ok('#87b 차트 기간 목록에 팝업 기간(1일 제외)이 전부 있다', ['1주', '1개월', '3개월', '1년', '직접'].every((p) => CHART_PERIODS.includes(p)));
  eq('#88 비교 종목 정리 — 중복(대소문자 무시)·기준 종목·잘못된 값 제외',
    normalizeChartComps(['aapl', 'AAPL', ' 441640 ', '005930', 'bad code', '', null], '005930').join(','), 'aapl,441640');
  eq('#88b 비교 종목 상한', normalizeChartComps(Array.from({ length: 12 }, (_, i) => `C${i}`), 'X').length, MAX_CHART_COMPS);
  eq('#88c 문자열 입력(A,B)', normalizeChartComps('A,B,a', '').join(','), 'A,B');
  eq('#89 차트 보기 상태 — 직접인데 시작일 없으면 기본 기간 · 종료일 < 시작일이면 비움',
    JSON.stringify([normalizeChartView({ period: '직접' }), normalizeChartView({ period: '직접', customStart: '2026-05-01', customEnd: '2026-04-01' })]),
    JSON.stringify([{ period: '1년', customStart: '', customEnd: '' }, { period: '직접', customStart: '2026-05-01', customEnd: '' }]));
  {
    const u = new URL('http://x' + stockChartUrl({ code: '441640', market: 'kr', name: ' KODEX 미국배당 ', period: '3개월', customStart: '2026-01-01', comps: ['AAPL', '441640'] }));
    ok('#90 주소 — 창 부팅 플래그·코드·시장·기간·이름·비교 종목(기준 종목 제외)',
      u.searchParams.get('stockChartWindow') === '1' && u.searchParams.get('code') === '441640' && u.searchParams.get('market') === 'kr'
      && u.searchParams.get('period') === '3개월' && u.searchParams.get('name') === 'KODEX 미국배당' && u.searchParams.get('comp') === 'AAPL');
    ok('#90b 프리셋 기간이면 from/to를 싣지 않는다', !u.searchParams.has('from') && !u.searchParams.has('to'));
    const c = new URL('http://x' + stockChartUrl({ code: 'MA:ABC12', market: 'zz', period: '직접', customStart: '2026-01-02' }));
    ok('#90c 직접 선택이면 from(필수)·to(있을 때만) · 모르는 시장은 생략',
      c.searchParams.get('from') === '2026-01-02' && !c.searchParams.has('to') && !c.searchParams.has('market'));
  }
  ok('#91 창 이름 — 종목마다 하나(대소문자 무시)·창 이름에 못 쓰는 문자 치환',
    stockChartWindowName('aapl') === stockChartWindowName('AAPL') && stockChartWindowName('441640') !== stockChartWindowName('AAPL')
    && /^ass-stockchart-[A-Z0-9_]+$/.test(stockChartWindowName('https://www.funetf.co.kr/x')));
  eq('#92 상세페이지 URL(옛 팝업 detailUrl과 같은 규칙)',
    [stockDetailUrl('kr', '0043y0'), stockDetailUrl('us', 'jepi'), stockDetailUrl('fund', 'MA:ABC12'), stockDetailUrl('fund', 'K55105BU1234')].join(' '),
    'https://m.stock.naver.com/domestic/stock/0043Y0/total https://finance.yahoo.com/quote/JEPI '
    + 'https://investments.miraeasset.com/magi/fund/view.do?fundGb=2&fundCd=ABC12 https://www.funetf.co.kr/product/fund/view/K55105BU1234');

  // ── 최근 분배금 — 실측 응답 형태(네이버 2026-10-16 / 야후) ──
  {
    // 네이버 ETF 분배 이력(441640 실측 — 정렬이 뒤섞여도 가장 최근 배당락을 고른다)
    const nav = { totalCount: 49, result: [
      { dividendAmount: 96, exDividendAt: '2026.09.14', dividendYield: 0.79 },
      { dividendAmount: 94, exDividendAt: '2026.10.14', dividendYield: 0.77 },
      { dividendAmount: 102, exDividendAt: '2026.08.13', dividendYield: 0.83 },
      { dividendAmount: 103, exDividendAt: '2026.07.14', dividendYield: 0.79 },
    ] };
    const r = S('(naver)', () => pickNaverDividend(nav)) || {};
    ok('#93 네이버 — 가장 최근 1회(94 · 0.77% · 2026-10-14), 최근 3회 내림차순',
      r.status === 'ok' && r.kind === 'last' && r.amount === 94 && r.rate === 0.77 && r.exDate === '2026-10-14'
      && (r.recent || []).map((x) => x.exDate).join(',') === '2026-10-14,2026-09-14,2026-08-13');
    // ⚠️ '기록 없음'과 '조회 실패'를 구분한다 — 사용자가 할 일이 다르다(실패는 다시 조회).
    eq('#93b 빈 결과 = 기록 없음(none)', pickNaverDividend({ totalCount: 0, result: [] })?.status, 'none');
    ok('#93c 모양이 틀리면 null(조회 실패로 보고 다음 경로)', pickNaverDividend('<html>') === null && pickNaverDividend({ result: 'x' }) === null && pickNaverDividend(null) === null);
    eq('#93d 항목이 있는데 전부 손상이면 null(기록 없음으로 단언하지 않는다)', pickNaverDividend({ result: [{ dividendAmount: 0, exDividendAt: 'x' }] }), null);
    // 일반 주식(005930 실측 요약) — 회차 이력이 없어 연간 값을 쓴다
    const integ = { totalInfos: [{ code: 'per', value: '9.71배' }, { code: 'dividendYieldRatio', value: '0.77%' }, { code: 'dividend', value: '1,668원' }] };
    const a = pickNaverAnnualDividend(integ) || {};
    ok('#94 네이버 요약 — 연간 주당배당금 1,668 · 배당수익률 0.77% (kind annual)', a.status === 'ok' && a.kind === 'annual' && a.amount === 1668 && a.rate === 0.77);
    eq('#94b 배당 칸이 비거나 "-"면 none', [pickNaverAnnualDividend({ totalInfos: [] })?.status, pickNaverAnnualDividend({ totalInfos: [{ code: 'dividend', value: '-' }] })?.status].join(','), 'none,none');
    eq('#94c 모양이 틀리면 null', pickNaverAnnualDividend({ foo: 1 }), null);
    // 야후 — 분배율 = 분배금 ÷ 배당락 직전 거래일 종가(같은 응답의 일봉)
    const T = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 13, 30) / 1000;
    const y = { chart: { result: [{
      meta: { currency: 'USD' },
      timestamp: [T('2026-09-29'), T('2026-09-30'), T('2026-10-01'), T('2026-10-02')],
      indicators: { quote: [{ close: [57.1, 56.8, 57.0, null] }] },
      events: { dividends: { a: { amount: 0.371, date: T('2026-09-01') }, b: { amount: 0.341, date: T('2026-10-01') } } },
    }] } };
    const u = pickYahooDividend(y) || {};
    ok('#95 야후 — 가장 최근 분배(0.341 · 2026-10-01) · 분배율 = 0.341 ÷ 직전 거래일 종가 56.8',
      u.status === 'ok' && u.amount === 0.341 && u.exDate === '2026-10-01' && u.rateBasis === 'close'
      && Math.abs(u.rate - (0.341 / 56.8) * 100) < 1e-9);
    ok('#95b 직전 종가가 응답 구간 밖이면 분배율 null(지어내지 않는다)', u.recent?.[1]?.exDate === '2026-09-01' && u.recent[1].rate === null);
    eq('#95c 분배 이벤트가 없으면 none', pickYahooDividend({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } })?.status, 'none');
    eq('#95d 모양이 틀리면 null', pickYahooDividend({ chart: { result: [] } }), null);
  }

  // ── 구간 선택 상태 전이(드래그 · 더블클릭 시작점 고정 → 끝점 클릭) ──
  {
    const { chartSelStep: ST, EMPTY_CHART_SEL: E0 } = C;
    const run = (evs, s0 = E0) => evs.reduce((s, e) => ST(s, e), s0);
    const js = (s) => JSON.stringify(s && { l: s.left, r: s.right, a: s.anchor, d: s.dragging });
    const A = '2026-09-29', B = '2026-10-06', D = '2026-10-14';
    eq('#96 드래그 = 시작~끝 확정', js(run([{ type: 'down', label: A }, { type: 'move', label: B, buttons: 1 }, { type: 'up' }])),
      js({ left: A, right: B, anchor: '', dragging: false }));
    eq('#96b 움직이지 않은 단순 클릭 = 해제', js(run([{ type: 'down', label: A }, { type: 'up' }])), js(E0));
    // 더블클릭의 실제 이벤트 순서: down(1) → up(1) → down(2) → up(2) → dblclick
    const anchored = run([{ type: 'down', label: A }, { type: 'up' }, { type: 'down', label: A, second: true }, { type: 'up', second: true }, { type: 'dbl', label: A }]);
    eq('#96c 더블클릭 = 시작점 고정(끝점 대기)', js(anchored), js({ left: A, right: '', anchor: A, dragging: false }));
    // ⚠️ 시작점 대기 중의 미리보기는 버튼 없이 따라온다 — 자가치유(buttons === 0)가 드래그 아닐 때 발동하면 이 기능이 죽는다.
    eq('#96d 시작점 고정 후 버튼 없이 움직이면 끝점이 따라온다(미리보기 — 확정 아님)',
      js(ST(anchored, { type: 'move', label: B, buttons: 0 })), js({ left: A, right: B, anchor: A, dragging: false }));
    eq('#96e 끝점 클릭 = 확정(시작점 해제)', js(run([{ type: 'move', label: B, buttons: 0 }, { type: 'down', label: D }, { type: 'up' }], anchored)),
      js({ left: A, right: D, anchor: '', dragging: false }));
    eq('#96f 시작점 위를 누르면 시작점을 유지하고 계속 대기', js(run([{ type: 'down', label: A }, { type: 'up' }], anchored)),
      js({ left: A, right: '', anchor: A, dragging: false }));
    eq('#96g 시작점은 끝점 클릭으로 덮어쓰지 않는다(드래그로 끝점을 골라도 시작점 그대로)',
      js(run([{ type: 'down', label: B }, { type: 'move', label: D, buttons: 1 }, { type: 'up' }], anchored)), js({ left: A, right: D, anchor: '', dragging: false }));
    eq('#96h 드래그 중 버튼을 놓친 채 돌아오면(buttons 0) 그 자리에서 확정',
      js(run([{ type: 'down', label: A }, { type: 'move', label: B, buttons: 1 }, { type: 'move', label: D, buttons: 0 }])),
      js({ left: A, right: B, anchor: '', dragging: false }));
    eq('#96i 플롯 밖 클릭 = 선택·시작점 해제', js(ST(anchored, { type: 'down', label: '' })), js(E0));
    ok('#96j 더블클릭의 두 번째 클릭은 down·up 모두 무시(같은 참조)',
      ST(anchored, { type: 'down', label: D, second: true }) === anchored && ST(anchored, { type: 'up', second: true }) === anchored);
    const done = run([{ type: 'down', label: A }, { type: 'move', label: B, buttons: 1 }, { type: 'up' }]);
    ok('#96k 바뀐 게 없으면 같은 참조(이동마다 렌더 방지)',
      ST(done, { type: 'move', label: D, buttons: 0 }) === done && ST(done, { type: 'up' }) === done
      && ST(E0, { type: 'clear' }) === E0 && ST(anchored, { type: 'dbl', label: '' }) === anchored
      && ((m) => ST(m, { type: 'move', label: B }) === m)(ST(anchored, { type: 'move', label: B })));
    eq('#96l Esc(clear) = 해제', js(ST(anchored, { type: 'clear' })), js(E0));
    S('#96m 손상 입력에도 던지지 않는다', () => [ST(null, null), ST(undefined, { type: 'down', label: 3 }), ST('x', { type: 'move' })],
      (v) => v.every((s) => s && typeof s.left === 'string'));
  }

  // ── 보유 종목 매입가 가로선(사용자 요청 2026-10-30) ──
  // ⚠️ 매입가는 포트폴리오 테이블 '구매단가' 칸과 같은 식이어야 한다 — 표와 선이 갈리면 사용자가 어느 쪽도 믿지 못한다.
  {
    const { buildHoldings, holdingsFor, pickHoldings, normalizeHoldings, holdingAvg, holdingPct, holdingLayout, holdingKey } = C;
    const PF = [
      { id: 'a', name: '일반', accountType: 'portfolio', portfolio: [
        { type: 'stock', code: '005930', quantity: 3, investAmount: 200000 },
        { type: 'stock', code: '005930', quantity: '2', investAmount: '150,000' },        // 같은 계좌 같은 종목 = 합산
        { type: 'stock', code: '069500', quantity: 10, investAmount: 0, purchasePrice: 35000 }, // 투자금액 없는 옛 행
        { type: 'stock', code: '000660', quantity: 0, investAmount: 100000 },            // 수량 0 = 보유 아님
        { type: 'stock', code: '035720', quantity: 5, investAmount: 0 },                  // 원가 0 = 매입가 없음
        { type: 'deposit', code: '', depositAmount: 1000 },
        null, 'x',
      ] },
      { id: 'b', name: 'ISA', accountType: 'isa', portfolio: [{ type: 'stock', code: '005930', quantity: 1, investAmount: 60000 }] },
      { id: 'c', name: '해외', accountType: 'overseas', portfolio: [
        { type: 'stock', code: 'goog', quantity: 4, investAmountUsd: 1310.6664, purchasePrice: 999 },  // 입력값 우선
        { type: 'stock', code: 'SCHD', quantity: 10, investAmountUsd: '', purchasePrice: 27.5 },     // 입력 없는 옛 행
      ] },
      { id: 'd', name: '퇴직', accountType: 'dc-irp', portfolio: [{ type: 'fund', code: 'MA:ab123', quantity: 1000, investAmount: 1234560 }] },
      { id: 'e', name: '삭제됨', accountType: 'portfolio', deletedAt: '2026-10-01', portfolio: [{ type: 'stock', code: '005930', quantity: 1, investAmount: 1 }] },
      { id: 'f', name: '테스트', accountType: 'portfolio', isTest: true, portfolio: [{ type: 'stock', code: '005930', quantity: 1, investAmount: 1 }] },
      { id: 'g', name: '금', accountType: 'gold', portfolio: [{ type: 'stock', code: 'M04020000', quantity: 1, purchasePrice: 150000 }] },
      { id: 'h', name: '코인', accountType: 'crypto', portfolio: [{ type: 'stock', code: 'BTC', quantity: 1, purchasePrice: 1 }] },
      { id: 'i', name: '직접', accountType: 'simple', evalAmount: 100 },
    ];
    const H = buildHoldings(PF);
    const sam = H['005930'] || [];
    eq('#97a 국내: 같은 계좌의 같은 종목 행은 합산(총 투자금액 ÷ 총 수량)', sam[0] && sam[0].avg, 70000);
    eq('#97a2 계좌가 다르면 계좌마다 한 줄(탭 순서) — 삭제·TEST 계좌는 빠진다', JSON.stringify(sam.map((h) => [h.acct, h.avg, h.qty, h.cur])),
      JSON.stringify([['일반', 70000, 5, 'KRW'], ['ISA', 60000, 1, 'KRW']]));
    eq('#97b 투자금액이 빈 옛 국내 행은 저장된 purchasePrice', H['069500'] && H['069500'][0].avg, 35000);
    ok('#97c 수량 0 · 원가 0 · 예수금 · 손상 행은 매입가 없음', !H['000660'] && !H['035720'] && !H[''] && Object.keys(H).every((k) => k));
    eq('#97d 해외: 투자금액(USD) 입력 ÷ 수량(purchasePrice 미러보다 우선) · 키는 대문자', H.GOOG && H.GOOG[0].avg, 1310.6664 / 4);
    eq('#97d2 해외 입력 없는 옛 행 = purchasePrice · 통화 USD', JSON.stringify(H.SCHD && H.SCHD.map((h) => [h.avg, h.cur])), JSON.stringify([[27.5, 'USD']]));
    eq('#97e 펀드 = 투자금액 ÷ 좌수 · MA: 접두어를 뗀 키', H.AB123 && H.AB123[0].avg, 1234.56);
    ok('#97f 금현물·CRYPTO·직접입력 계좌는 긋지 않는다(시세 단위가 다르다)', !H.M04020000 && !H.BTC);
    // ⚠️ 표의 국내 구매단가 칸 = Math.round(투자금액 ÷ 수량) — 선 높이는 반올림 전, 표기는 같은 반올림.
    eq('#97g 표의 구매단가 식과 같은 값(국내 1,000,000원 ÷ 3주)', Math.round(buildHoldings([{ name: 'x', portfolio: [{ type: 'stock', code: 'A', quantity: 3, investAmount: 1000000 }] }]).A[0].avg),
      Math.round(1000000 / 3));
    eq('#97h holdingKey — 공백·대소문자·MA: 무시, 비문자열은 빈 키', [holdingKey(' ma:Ab1 '), holdingKey('brk.b'), holdingKey(5), holdingKey(null)].join('|'), 'AB1|BRK.B||');
    eq('#97i holdingsFor — 통화가 시장과 맞는 것만(원화 매입가를 달러 차트에 긋지 않는다)',
      [holdingsFor(H, '005930', 'kr').length, holdingsFor(H, '005930', 'us').length, holdingsFor(H, 'goog', 'us').length, holdingsFor(H, 'GOOG', 'kr').length,
        holdingsFor(H, 'ab123', 'fund').length, holdingsFor(H, 'MA:AB123', 'fund').length, holdingsFor(null, 'x', 'kr').length].join(','), '2,0,1,0,1,1,0');
    eq('#97j pickHoldings — 물어본 종목 몫만(계좌 전체를 보내지 않는다)', JSON.stringify(Object.keys(pickHoldings(H, ['goog', '005930', 'ZZZ', 7]))), JSON.stringify(['GOOG', '005930']));
    ok('#97j2 pickHoldings 손상 입력 → 빈 객체', JSON.stringify(pickHoldings(null, ['A'])) === '{}' && JSON.stringify(pickHoldings(H, 'A')) === '{}');
    // ⚠️ null('모른다')과 {}('보유 없음')을 구분해야 받는 창이 로드 전 메시지로 선을 지우지 않는다.
    ok('#97k normalizeHoldings — null·배열·원시값은 null(모름), {}는 {}(보유 없음)',
      normalizeHoldings(null) === null && normalizeHoldings([]) === null && normalizeHoldings('x') === null && JSON.stringify(normalizeHoldings({})) === '{}');
    eq('#97k2 normalizeHoldings — 모양이 틀린 항목은 버리고 계좌 이름은 자른다',
      JSON.stringify(normalizeHoldings({ a: [{ acct: 'x'.repeat(60), avg: 10, qty: 2, cur: 'KRW' }, { avg: -1, qty: 1, cur: 'KRW' }, { avg: 1, qty: 1, cur: 'EUR' }, { avg: NaN, qty: 1, cur: 'USD' }, 3], b: 'no', c: [] })),
      JSON.stringify({ A: [{ acct: 'x'.repeat(40), avg: 10, qty: 2, cur: 'KRW' }] }));
    ok('#97k3 normalizeHoldings(buildHoldings) 왕복은 그대로', JSON.stringify(normalizeHoldings(JSON.parse(JSON.stringify(H)))) === JSON.stringify(H));
    eq('#97l holdingAvg — 여러 계좌 합산(70,000×5 + 60,000×1) ÷ 6', JSON.stringify(holdingAvg(sam)), JSON.stringify({ avg: 410000 / 6, qty: 6, n: 2 }));
    ok('#97l2 holdingAvg 손상·빈 입력 → null', holdingAvg([]) === null && holdingAvg(null) === null && holdingAvg([{ avg: 0, qty: 1 }]) === null);
    eq('#97m holdingPct — 구간 첫 종가 0% 눈금(매입 90 / 기준 100 = -10%)', holdingPct(90, 100), (90 / 100 - 1) * 100);
    ok('#97m2 holdingPct — 기준가 없음·0·문자열 → null', holdingPct(90, 0) === null && holdingPct(0, 100) === null && holdingPct('90', 100) === null);
    // holdingLayout: 시세 100~110(span 10). minShare 0.25 → 눈금을 40까지만 넓힐 수 있다.
    const L1 = holdingLayout(100, 110, [105, 95, 140, 60], 0.25);
    eq('#97n 범위 안 · 가까운 바깥은 눈금 안(넓힘), 먼 바깥은 위·아래 가장자리', JSON.stringify(L1.pins), JSON.stringify(['', '', 'top', 'bottom']));
    eq('#97n2 넓힌 눈금 = 받아들인 매입가까지', `${L1.lo}~${L1.hi}`, '95~110');
    // 가까운 것부터 받아들인다 — 먼 것(입력 순서 앞)이 가까운 것까지 밀어내지 않게.
    eq('#97n3 가까운 매입가부터 받아들인다(입력 순서 무관)', JSON.stringify(holdingLayout(100, 110, [145, 128], 0.25).pins), JSON.stringify(['top', '']));
    eq('#97n4 시세가 한 값뿐이면 넓힌다(눌릴 모양이 없다)', JSON.stringify(holdingLayout(100, 100, [300], 0.25)), JSON.stringify({ pins: [''], lo: 100, hi: 300 }));
    eq('#97n5 미니차트 기준(40%) — 같은 거리라도 더 일찍 가장자리', JSON.stringify([holdingLayout(100, 110, [127], 0.4).pins[0], holdingLayout(100, 110, [127], 0.25).pins[0]]), JSON.stringify(['top', '']));
    // ── 앞자리 0이 빠진 국내 코드 복원 후보(사용자 신고 2026-10-30: 0241D0 → 241D0 조회 실패) ──
    const { krCodeWithZeros } = C;
    eq('#98a krCodeWithZeros — 숫자가 든 1~5자 영숫자만 6자로(대문자)',
      ['241D0', '5930', '660', ' 241d0 ', '1'].map(krCodeWithZeros).join(','), '0241D0,005930,000660,0241D0,000001');
    eq('#98b 후보 없음 — 이미 6자 · 순수 알파벳(해외) · 7자 이상 · MA:/점 · 비문자열',
      ['0241D0', '005930', 'AAPL', 'QQQM', '1234567', 'MA:12345', 'BRK.B', '', null, 241].map(krCodeWithZeros).join('|'), '|||||||||');
    // ── 자동 '보유종목' 그룹(사용자 요청 2026-10-30 — 전체 계좌 종목 · 같은 종목은 계좌마다 따로) ──
    const { holdingWatchStocks, isRowHolding } = C;
    eq('#99a buildHoldings — 관심종목 행으로 조회할 시장·원래 코드(대문자)를 함께 싣는다',
      JSON.stringify([H['005930'][0].mk, H['005930'][0].code, H.GOOG[0].mk, H.GOOG[0].code, H.AB123[0].mk, H.AB123[0].code]),
      JSON.stringify(['kr', '005930', 'us', 'GOOG', 'fund', 'MA:AB123']));
    eq('#99b ord = 계좌 탭 순서 → 행 순서(보유 아닌 행은 번호를 먹지 않는다)',
      [H['005930'].map((h) => h.ord).join(','), H['069500'][0].ord, H.GOOG[0].ord, H.SCHD[0].ord, H.AB123[0].ord].join('|'), '0,2|1|3|4|5');
    const PF2 = [
      { id: 'a', name: 'A', accountType: 'overseas', portfolio: [{ type: 'stock', code: 'qqqm', name: 'Invesco QQQM', quantity: 1, investAmountUsd: 100 }] },
      { id: 'b', name: 'B', accountType: 'portfolio', portfolio: [
        { type: 'stock', code: '498410', name: ' KODEX 금융고배당 ', quantity: 10, investAmount: 100000 },
        { type: 'stock', code: '005930', name: '삼성전자', quantity: 1, investAmount: 70000 },
      ] },
      { id: 'c', name: 'C', accountType: 'isa', portfolio: [
        { type: 'stock', code: '005930', quantity: 2, investAmount: 120000 },
        { type: 'stock', code: '498410', quantity: 5, investAmount: 60000 },
      ] },
    ];
    const H2 = buildHoldings(PF2);
    const R2 = holdingWatchStocks(H2);
    // ⚠️ 객체 키 순서는 정수 모양 코드('498410')가 맨 앞으로 섞인다 — 줄 순서는 ord로만 정한다.
    eq('#99c 줄 순서 = 종목이 처음 나온 순서(계좌 탭 → 행) · 같은 종목은 계좌마다 한 줄씩 붙어서',
      R2.map((r) => `${r.code}@${r.acct}`).join(','), 'QQQM@A,498410@B,498410@C,005930@B,005930@C');
    ok('#99c2 (전제) 객체 키 순서는 실제로 섞인다 — ord 없이 키 순서를 쓰면 위 순서가 깨진다', Object.keys(H2)[0] === '498410');
    eq('#99d 줄마다 그 계좌의 매입가·수량·시장 · 종목명은 포트폴리오 행 그대로(공백 정리)',
      JSON.stringify(R2.map((r) => [r.market, r.avg, r.qty, r.name])),
      JSON.stringify([['us', 100, 1, 'Invesco QQQM'], ['kr', 10000, 10, 'KODEX 금융고배당'], ['kr', 12000, 5, ''], ['kr', 70000, 1, '삼성전자'], ['kr', 60000, 2, '']]));
    ok('#99d2 줄 id는 겹치지 않고, 모두 가상 줄(virtual)', new Set(R2.map((r) => r.id)).size === R2.length && R2.every((r) => r.virtual === true));
    eq('#99e 창 사이 왕복(JSON → normalizeHoldings) 뒤에도 같은 줄·같은 순서',
      JSON.stringify(holdingWatchStocks(normalizeHoldings(JSON.parse(JSON.stringify(H2))))), JSON.stringify(R2));
    eq('#99f 옛 모양(ord·mk·code 없음) — 통화·키로 시장 추정(USD=해외 · 6자 숫자 포함=국내 · 그 외=펀드), 코드 = 키',
      holdingWatchStocks({ AAPL: [{ acct: 'x', avg: 1, qty: 1, cur: 'USD' }], AB123: [{ acct: 'x', avg: 1, qty: 1, cur: 'KRW' }], '0241D0': [{ acct: 'x', avg: 1, qty: 1, cur: 'KRW' }] })
        .map((r) => `${r.code}:${r.market}`).join(','), 'AAPL:us,AB123:fund,0241D0:kr');
    eq('#99g normalizeHoldings — 맞는 덧붙임(ord·mk·code·name)만 남기고 틀린 것은 버린다(줄 자체는 살린다)',
      JSON.stringify(normalizeHoldings({ a: [
        { acct: 'x', avg: 1, qty: 1, cur: 'KRW', ord: 3, mk: 'kr', code: ' a ', name: ' 삼성 ' },
        { acct: 'y', avg: 1, qty: 1, cur: 'KRW', ord: -1, mk: 'jp', code: 'B', name: 5 },
        { acct: 'z', avg: 1, qty: 1, cur: 'KRW', ord: 1.5, code: 'ma:a' },
      ] })),
      JSON.stringify({ A: [
        { acct: 'x', avg: 1, qty: 1, cur: 'KRW', ord: 3, mk: 'kr', code: 'a', name: '삼성' },
        { acct: 'y', avg: 1, qty: 1, cur: 'KRW' },
        { acct: 'z', avg: 1, qty: 1, cur: 'KRW', code: 'ma:a' },
      ] }));
    {
      const row = R2.find((r) => r.code === '005930' && r.acct === 'B');
      const hold = holdingsFor(H2, row.code, row.market);
      eq('#99h isRowHolding — 그 줄의 계좌 1 · 같은 종목의 다른 계좌 1(미니차트 호박/보라)',
        [hold.filter((h) => isRowHolding(h, row)).length, hold.filter((h) => !isRowHolding(h, row)).length].join(','), '1,1');
      ok('#99h2 isRowHolding 손상 입력 → false', !isRowHolding(null, row) && !isRowHolding(hold[0], null) && !isRowHolding({ acct: 'B', avg: 70000, qty: 2 }, row));
    }
    S('#99i 손상 입력에도 던지지 않는다(빈 목록)',
      () => [holdingWatchStocks(null), holdingWatchStocks([]), holdingWatchStocks('x'), holdingWatchStocks({ a: 'no' }), holdingWatchStocks({ a: [null, { avg: -1, qty: 1, cur: 'KRW' }, { avg: 1, qty: 1, cur: 'EUR' }] })],
      (v) => v.every((x) => Array.isArray(x) && x.length === 0));
    S('#97o 손상 입력에도 던지지 않는다(시세 범위가 없으면 lo·hi = NaN, 잘못된 매입가 = none)',
      () => [holdingLayout(NaN, 1, [1]), holdingLayout(5, 1, [1]), holdingLayout(1, 2, [NaN, 'x', 1.5]), holdingLayout(1, 2, null), buildHoldings(null), buildHoldings([{ portfolio: 'x' }])],
      (v) => Number.isNaN(v[0].lo) && Number.isNaN(v[1].hi) && v[2].pins.join(',') === 'none,none,' && v[3].pins.length === 0
        && JSON.stringify(v[4]) === '{}' && JSON.stringify(v[5]) === '{}');
  }
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
ok('#G5 패널 폭은 리스트 640 + 분배 접힘 칸 + 사이드바 폭의 합(셋은 한 세트)',
  /const\s+PANEL_W\s*=\s*640\s*\+\s*DIV_TOGGLE_W\s*\+\s*SIDEBAR_W\s*;/.test(POPUP));
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
  && /\}, \[watchlistGroups, watchlistView, adminViewingAs, ledgerDataState, watchlistWinNonce, watchHoldings\]\);/.test(APP));
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
  ok('#G62 표시 폭은 최소 폭 이상(사이드바·분배금 열 펼침 반영)',
    /const minW = \(sidebarOpen \? SIDEBAR_W \+ LIST_MIN_W : LIST_MIN_W \+ 32\) \+ divExtraW;/.test(P)
    && /const divExtraW = showDiv \? DIV_COL_W : 0;/.test(P)
    && /Math\.max\(minW, curSize\?\.w \?\? PANEL_W \+ divExtraW\)/.test(P));
}

// ── 종목 하이라이트(행 왼쪽 끝 클릭) ──
// ⚠️ 저장값은 종목 항목의 `highlight` — watchlistGroups 안이라 영속화 신규 지점이 0곳이다.
//    그 전제(지문·sticky·브릿지가 배열을 통째로 나른다)가 깨지면 칠한 색이 조용히 사라진다.
{
  const P = stripComments(POPUP);
  ok('#G63 팝업이 순수 모듈의 하이라이트 함수를 쓴다(손복제 금지)',
    /watchHighlightOf, nextWatchHighlight, toggleWatchHighlight, clearWatchHighlights \} from '\.\.\/watchlistGroups'/.test(POPUP));
  // 팝업 안에 팔레트를 다시 만들면 '칠할 때마다 다른 색' 규칙과 화면 색이 갈린다(amber는 드롭 표시와 같은 색이라 제외).
  ok('#G64 팝업에 팔레트 손복제 없음',
    (W?.WATCH_HIGHLIGHT_COLORS || [{ hex: '#__' }]).slice(1).every((c) => !POPUP.toLowerCase().includes(c.hex.toLowerCase())));
  ok('#G65 켜고 끄기는 updateGroups 단일 통로 + 순수 함수',
    /updateGroups\(\(prev\) => toggleWatchHighlight\(prev, gid, stockId\)\)/.test(P));
  ok('#G66 모두 해제도 같은 통로',
    /updateGroups\(\(prev\) => clearWatchHighlights\(prev, gid\)\)/.test(P));
  // ⚠️ 읽기 전용(관리자 열람·창 연결 끊김)에서는 누를 수 없고, 이미 칠한 색은 보인다.
  // 보유종목(가상) 줄도 표시만 — 칠할 저장 행이 없다(updateGroups는 저장된 그룹만 본다).
  const strip = (() => { const i = P.indexOf('{readOnly || s.virtual ? ('); const j = P.indexOf('data-watch-row', i); return i < 0 || j < 0 ? '' : P.slice(i, j); })();
  ok('#G67 읽기 전용·보유종목 줄이면 띠는 표시만(클릭 없음), 아니면 toggleHighlight(s.id)',
    /\{readOnly \|\| s\.virtual \? \(\s*hl && <span className="absolute left-0 top-0 bottom-0 w-2\.5" style=\{\{ backgroundColor: hl\.hex \}\} \/>/.test(strip)
    && /onClick=\{\(\) => toggleHighlight\(s\.id\)\}/.test(strip));
  ok('#G68 칠한 행은 행 전체를 그 색으로(정렬을 바꿔도 눈이 따라간다)',
    /const hl = watchHighlightOf\(s\.highlight\);/.test(P)
    && /data-watch-id=\{s\.id\}/.test(P)
    && /style=\{hl \? \{ backgroundColor: `\$\{hl\.hex\}24` \} : undefined\}/.test(P));
  // ⚠️ 띠는 행 왼쪽 여백(pl-3) 안에 둔다 — 헤더도 같은 여백이어야 열이 맞는다.
  ok('#G69 헤더·행 왼쪽 여백이 같다(pl-3)',
    /flex items-center gap-2 pl-3 pr-1 py-1 border-b border-gray-700\/60/.test(P)
    && /flex items-center gap-2 pl-3 pr-1 py-1\.5 border-b border-gray-800\/50/.test(P)
    && !/flex items-center gap-2 px-1 py-1/.test(P));
  // 칩 순서 = 리스트 안 순서여야 '어디에 있는지'가 된다 — 저장 순서(activeStocks)로 만들면 정렬과 어긋난다.
  ok('#G70 위치 요약은 화면 순서(sortedStocks)에서 만든다',
    /const highlighted = sortedStocks\s*\n\s*\.map\(\(s, i\) => \(\{ s, i, c: watchHighlightOf\(s\.highlight\) \}\)\)/.test(P)
    && /onClick=\{\(\) => scrollToStock\(s\.id\)\}/.test(P)
    && /querySelectorAll\('\[data-watch-id\]'\)/.test(P));
  ok('#G71 다음 색 = 활성 그룹 기준', /const nextHl = watchHighlightOf\(nextWatchHighlight\(activeStocks\)\);/.test(P));
  // 최근조회는 다시 본 종목을 새 항목으로 맨 앞에 붙인다 — 칠한 색을 옮기지 않으면 등락율 한 번에 사라진다.
  ok('#G72 recordRecent 가 하이라이트를 함께 옮긴다',
    /\.\.\.\(watchHighlightOf\(old\?\.highlight\) \? \{ highlight: old\.highlight \} : \{\}\)/.test(P));
  ok('#G73 하이라이트는 watchlistGroups 지문에 실려 저장된다(영속화 신규 지점 0곳)',
    /JSON\.stringify\(watchlistGroups\),/.test(APP) && !/watchlistHighlight/.test(APP));
}

// ── 미니차트 클릭 → 종목 비교 차트 창 · 분배금 열(사용자 요청 2026-10) ──
{
  const CMOD = src('src/watchlistChart.ts');
  const CHART = src('src/components/StockChartWindow.tsx');
  const QUOTE = src('src/watchlistQuote.ts');
  const P = stripComments(POPUP);
  const CW = stripComments(CHART);
  ok('#G74 소스 3종을 읽었다(watchlistChart · StockChartWindow · watchlistQuote)', !!CMOD && !!CHART && !!QUOTE);
  ok('#G75 watchlistChart.ts 는 import 0건 · enum/namespace 없음(직접 import 검증)',
    !/^\s*import\s/m.test(stripComments(CMOD)) && !/\b(enum|namespace)\s+\w/.test(stripComments(CMOD)));

  // ⚠️ 팝업 등락율과 차트 창 '기간 수익률'의 단일 소스 — 한쪽이라도 손계산으로 돌아가면 같은 기간에 두 숫자가 갈린다.
  ok('#G76 팝업 cutoffFor 는 periodCutoff 위임', /const cutoffFor = \(period\) => periodCutoff\(period, todayKST\(\)\);/.test(P));
  ok('#G77 팝업 기간 구간·등락율은 공용 함수(watchPeriodWindow + windowRate) — 옛 인라인 필터 부재',
    /watchPeriodWindow\(dailyMap\[s\.code\], \{/.test(P) && /const \{ rate, first, last \} = windowRate\(win\);/.test(P)
    && !/daily\.filter\(\(\[dt\]\) => dt >= customStart/.test(P));
  ok('#G78 차트 창도 같은 함수 + 같은 종가 소스(fetchWatchDaily)',
    /watchPeriodWindow\(dailyMap\[s\.code\], \{/.test(CW) && /stat: windowRate\(win\)/.test(CW)
    && /fetchWatchDaily\(s\.market, s\.code, from \|\| undefined\)/.test(CW) && /periodCutoff\(view\.period, today\)/.test(CW));

  // ── 창 부팅·격리 ──
  ok('#G79 main.tsx 가 URL 파라미터로 App 대신 차트 창을 렌더한다',
    /const\s+STOCK_CHART_WINDOW_BOOT\s*=\s*_params\.get\('stockChartWindow'\)\s*===\s*'1'/.test(MAIN)
    && /STOCK_CHART_WINDOW_BOOT \? <StockChartWindow \/>/.test(MAIN));
  ok('#G80 차트 창은 자체 ErrorBoundary label 을 갖는다', /<ErrorBoundary label="종목 차트">/.test(CHART));
  // ⚠️ 이 창은 쓰기가 0이다 — 브라우저 저장소·공유 종가 맵에 닿거나 opener에 쓰기 메시지를 보내는 순간
  //    '두 번째 writer'나 평가액 오염이 된다. opener와는 **읽기 전용 물음 하나**(stockchart:ping)만 허용한다
  //    (보유 매입가 가로선 — 2026-10-30). 보내는 메시지가 늘면 이 가드가 잡는다.
  ok('#G81 차트 창은 저장소·stockHistoryMap 을 쓰지 않고, opener에는 stockchart:ping 하나만 보낸다',
    !/localStorage|sessionStorage|stockHistoryMap|saveDriveFile/.test(CW)
    && (CW.match(/postMessage\(/g) || []).length === 1
    && /op\.postMessage\(\{ type: 'stockchart:ping', codes \}, window\.location\.origin\);/.test(CW));
  ok('#G81b 차트 창은 같은 출처 · opener의 답(stockchart:holdings)만 받고, null(모름)이면 기존 선을 지우지 않는다',
    /if \(e\.origin !== window\.location\.origin\) return;/.test(CW) && /if \(!window\.opener \|\| e\.source !== window\.opener\) return;/.test(CW)
    && /d\.type !== 'stockchart:holdings'/.test(CW) && /const h = normalizeHoldings\(d\.holdings\);\s*\n\s*if \(!h\) return;/.test(CW));
  // ⚠️ 매입가는 사용자 데이터다 — 주소창·방문 기록에 남는 URL에 실으면 안 된다.
  ok('#G81c 매입가는 주소(stockChartUrl)에 싣지 않는다', !/holding|avg/i.test(stripComments(CMOD.slice(CMOD.indexOf('export function stockChartUrl'), CMOD.indexOf('export function chartPeriodFromWatch')))));
  ok('#G82 비교 종목·기간은 주소에만 남긴다(replaceState + 공용 URL 함수)',
    /window\.history\.replaceState\(null, '', stockChartUrl\(\{/.test(CW));

  // ── 미니차트 클릭 배선 ──
  ok('#G83 미니차트는 버튼 안에 있고 클릭하면 openChartWindow(s, q)',
    /onClick=\{\(\) => openChartWindow\(s, q\)\}[\s\S]{0,700}?<Sparkline points=\{v\.points \|\| \[\]\} rate=\{v\.rate\} avgs=\{holdAvgs\(hv\)\} \/>\s*\n\s*<\/button>/.test(P));
  {
    const m = P.match(/const openChartWindow = \(s, q\) => \{[\s\S]*?\n  \};/);
    const body = m ? m[0] : '';
    // ⚠️ features 인자 금지(크롬이 '팝업'으로 열어 주소창이 사라진다) · 이름 = 종목마다 하나.
    ok('#G84 window.open(공용 URL, 종목별 이름) 2인자 · 이미 열렸으면 앞으로만 · 차단은 패널 안에 알린다',
      /const name = stockChartWindowName\(s\.code\);/.test(body)
      && /window\.open\(stockChartUrl\(\{[\s\S]*?\}\), name\);/.test(body)
      && /if \(existing && !existing\.closed\) \{ try \{ existing\.focus\(\); \} catch \{\} return; \}/.test(body)
      && /if \(!w\) \{ setChartBlocked\(true\); return; \}/.test(body)
      && /\{chartBlocked && \(/.test(P));
    ok('#G84b 팝업 기간을 차트 기간으로 넘긴다(1일 → 1개월)', /period: chartPeriodFromWatch\(period\), customStart, customEnd,/.test(body));
  }

  // ── 차트 렌더 ──
  // ⚠️ 종목 코드를 선 dataKey로 쓰면 'BRK.B'의 점이 recharts 경로로 해석돼 선이 사라진다.
  ok('#G85b 마우스 위치 값마다 가로줄 + 점 + 눈금 쪽 값 표시(수익률·종가 모드 모두) · 구간 선택 중엔 끔',
    /const hoverLevels = !hover \|\| dim \? \[\] : shown\.flatMap\(/.test(CW) && /row\[mode === 'pct' \? s\.key : `px:\$\{s\.key\}`\]/.test(CW)
    && /<ReferenceLine key=\{`hl-\$\{h\.key\}`\} y=\{h\.v\} yAxisId=\{h\.axisId\}/.test(CW) && /<ReferenceDot key=\{`hd-\$\{h\.key\}`\} x=\{hover\} y=\{h\.v\} yAxisId=\{h\.axisId\}/.test(CW)
    && /position: h\.axisId === RIGHT_AXIS \? 'right' : 'left'/.test(CW) && /ReferenceLine, ReferenceDot, Tooltip as RechartsTooltip \} from 'recharts';/.test(CW));
  // ⚠️ 종가 보기도 비교 종목을 함께 그린다(사용자 요청 2026-10-30 — 옛 '기준 종목만'(series.slice(0, 1)) 금지).
  //    통화가 다른 종목(원화 ↔ 달러)은 오른쪽 눈금 — 선·매입가 선·호버 선/점이 모두 자기 시리즈의 yAxisId를 따라가야
  //    한 종목의 점선·호버 점이 남의 눈금 높이에 찍히지 않는다.
  ok('#G85c 종가 보기도 모든 종목 · 통화 다르면 오른쪽 눈금(RIGHT_AXIS) · 선·매입가 선이 시리즈 눈금을 따른다',
    !/series\.slice\(0, 1\)/.test(CW)
    && /const shown = series\.map\(\(s\) => \(\{ \.\.\.s, axisId: mode === 'price' && isUsd\(s\.market\) !== isUsd\(main\.market\) \? RIGHT_AXIS : 0 \}\)\);/.test(CW)
    && /\{rightS && \(\s*\n\s*<YAxis yAxisId=\{RIGHT_AXIS\} orientation="right"[^\n]*fmtWatchPrice\(rightS\.market, v\)/.test(CW)
    && /dataKey=\{mode === 'pct' \? s\.key : `px:\$\{s\.key\}`\}\s*\n\s*yAxisId=\{s\.axisId\}/.test(CW)
    && /<ReferenceLine key=\{l\.key\} y=\{l\.v\} yAxisId=\{l\.s\.axisId\}/.test(CW));
  ok('#G85 선 dataKey 는 시리즈 키(s0…) — 종목 코드 금지', /const seriesKey = \(i\) => `s\$\{i\}`;/.test(CW)
    && /dataKey=\{mode === 'pct' \? s\.key : `px:\$\{s\.key\}`\}/.test(CW));
  {
    const iLine = CW.indexOf('<Line');
    const iDim = CW.indexOf('dim?.before && <ReferenceArea');
    ok('#G86 딤 3밴드는 선보다 뒤에 선언 · ifOverflow="hidden" · CHART_SELECTION 토큰',
      iLine > 0 && iDim > iLine
      && (CW.match(/<ReferenceArea [^>]*ifOverflow="hidden"/g) || []).length === 3
      && /fill=\{CHART_SELECTION\.dimFill\}/.test(CW) && /stroke=\{CHART_SELECTION\.windowStroke\}/.test(CW));
  }
  ok('#G87 구간 선택은 ref 정본 + 공용 상태 전이(chartSelStep) + window mouseup/blur 마무리',
    /const selRef = useRef\(EMPTY_CHART_SEL\);/.test(CW)
    && /const next = chartSelStep\(selRef\.current, ev\);\s*\n\s*if \(next === selRef\.current\) return;/.test(CW)
    && /window\.addEventListener\('mouseup', up\);/.test(CW) && /window\.addEventListener\('blur', blur\);/.test(CW)
    && /const up = \(e\) => step\(\{ type: 'up', second: isSecond\(e\) \}\);/.test(CW));
  ok('#G87b 기간을 바꾸면 선택 구간·시작점을 지운다(낡은 구간 잔존 방지)',
    /step\(\{ type: 'clear' \}\);\s*\n\s*\}, \[view\.period, view\.customStart, view\.customEnd\]\);/.test(CW));
  // ── 더블클릭 시작점 고정(사용자 요청 2026-10 — 수익률 차트와 같은 제스처) ──
  ok('#G87c 차트에 더블클릭·mouseup 배선(onDoubleClick은 툴팁이 있어야 바인딩된다)',
    /onMouseUp=\{onUp\} onDoubleClick=\{onDouble\}/.test(CW) && /<RechartsTooltip content=\{\(\) => null\}/.test(CW)
    && /const onDouble = \(e\) => step\(\{ type: 'dbl', label: e\?\.activeLabel \|\| '' \}\);/.test(CW));
  ok('#G87d 더블클릭의 두 번째 클릭은 down·up 모두 무시(detail ≥ 2)',
    /const isSecond = \(ev\) => !!ev && ev\.detail >= 2;/.test(CW)
    && /const onDown = \(e, ev\) => step\(\{ type: 'down', label: e\?\.activeLabel \|\| '', second: isSecond\(ev\) \}\);/.test(CW)
    && /const onUp = \(e, ev\) => step\(\{ type: 'up', second: isSecond\(ev\) \}\);/.test(CW));
  ok('#G87e 이동은 버튼 상태를 넘겨 공용 전이에 맡긴다(자가치유·미리보기 판정은 chartSelStep)',
    /step\(\{ type: 'move', label, buttons: ev \? ev\.buttons : undefined \}\);/.test(CW));
  {
    const iWin = CW.indexOf('{dim && <ReferenceArea x1={dim.start}');
    const iAnc = CW.indexOf('x={sel.anchor}');
    const anc = iAnc > 0 ? CW.slice(iAnc, CW.indexOf('/>', iAnc)) : '';
    ok('#G87f 시작점 선 — 딤·선택창보다 뒤 · ifOverflow="hidden" · CHART_SELECTION 앵커 토큰',
      iWin > 0 && iAnc > iWin && /ifOverflow="hidden"/.test(anc)
      && /stroke=\{CHART_SELECTION\.anchorStroke\}/.test(anc) && /strokeDasharray=\{CHART_SELECTION\.anchorDash\}/.test(anc));
  }
  ok('#G87g 사용법 안내는 호버 중에도 보인다(드래그·더블클릭 둘 다 안내)',
    /\{rows\.length > 1 && \(\s*\n\s*<span className="ml-auto/.test(CW) && CW.includes('더블클릭으로 시작점 고정 후 끝점 클릭'));
  ok('#G88 가격 표기는 팝업과 공유(fmtWatchPrice)', /const fmtPrice = fmtWatchPrice;/.test(P) && /fmtWatchPrice\(/.test(CW)
    && /export const fmtWatchPrice = /.test(QUOTE));

  // ── 분배금 열 ──
  // ⚠️ 접힌 칸도 헤더·행 **양쪽**에 같은 폭으로 — 한쪽만 있으면 현재가 열이 어긋난다.
  eq('#G89 접힌 칸(DIV_TOGGLE_W)은 헤더·행 2곳', (P.match(/style=\{\{ width: DIV_TOGGLE_W \}\}/g) || []).length, 2);
  eq('#G89b 펼친 칸(DIV_COL_W)도 헤더·행 2곳', (P.match(/style=\{\{ width: DIV_COL_W \}\}/g) || []).length, 2);
  ok('#G90 펼치기/접기는 보기 상태(patchView)로 — Drive 저장 대상', /const toggleDiv = \(\) => patchView\(\(v\) => \(\{ showDiv: !v\.showDiv \}\)\);/.test(P)
    && (P.match(/onClick=\{toggleDiv\}/g) || []).length === 3);
  ok('#G91 분배금 조회는 열을 펼쳤을 때만(effect 게이트)', /if \(!open \|\| !activeGroup \|\| !showDiv\) return;\s*\n\s*uniqueStocks\(activeGroup\.stocks\)\.forEach\(\(s\) => loadDividend\(s\)\);/.test(P));
  ok('#G92 분배금 결과는 팝업 로컬(divMap)에만 — 계좌 분배 이력에 쓰지 않는다', /setDivMap\(\(p\) => \(\{ \.\.\.p, \[stock\.code\]: r \}\)\);/.test(P)
    && !/dividendHistory|actualDividend/.test(P));
  ok('#G93 헤더는 종목 1개부터(분배금 토글이 헤더에 있다)', /\{activeStocks\.length >= 1 && \(/.test(P));
  // ⚠️ 상태를 뭉뚱그리지 않는다 — '기록 없음'·'조회 실패'·'펀드 미지원'은 사용자가 할 일이 다르다.
  ok('#G94 분배금 칸 상태 구분(조회 중 · 실패 · 펀드 · 없음 · 연간 · 최근 1회)',
    ["line1: '…'", "line2: '조회 실패'", "d.status === 'unsupported'", "line1: '없음'", "d.kind === 'annual'", '연환산 아님'].every((t) => P.includes(t)));
  ok('#G95 분배금 조회 경로: 펀드 미지원 · 국내 ETF 이력 → 일반 주식 연간 요약 · 해외 야후(공용 파서)',
    /if \(market === 'fund'\) return \{ status: 'unsupported' \};/.test(QUOTE)
    && /pickYahooDividend, 10000\)/.test(QUOTE)
    && QUOTE.indexOf('pickNaverDividend);') > 0 && QUOTE.indexOf('pickNaverDividend);') < QUOTE.indexOf('pickNaverAnnualDividend);'));
}

// ── 보유 종목 매입가 가로선(사용자 요청 2026-10-30) — 앱 탭 → 관심종목(팝업·창) → 종목 차트 창, 읽기만 ──
{
  const CHART = src('src/components/StockChartWindow.tsx');
  const P = stripComments(POPUP);
  const CW = stripComments(CHART);
  const A = stripComments(APP);
  const WN = stripComments(WIN);
  // ⚠️ 매입가 계산은 buildHoldings 한 곳 — 화면마다 따로 나누면 표의 구매단가와 선이 갈린다.
  ok('#G96 앱은 portfolios 로 buildHoldings 를 한 번 계산하고, STATE 로드 전에는 null(모름)',
    /import \{ buildHoldings \} from '\.\/watchlistChart';/.test(APP)
    && /\(ledgerDataState === 'ready' \? JSON\.stringify\(buildHoldings\(portfolios\)\) : ''\)/.test(A)
    && /\[portfolios, ledgerDataState\]/.test(A));
  ok('#G96b 인앱 팝업에 holdings 를 넘기고, 관심종목 창 live 메시지에도 싣는다',
    /holdings=\{watchHoldings\}/.test(A) && /type: 'watchlist:live'[^}]*holdings: watchHoldings \}\);/.test(A));
  ok('#G96c 관심종목 창은 받은 holdings 를 정규화해 팝업에 넘기고, null 이면 기존 값을 지킨다',
    /const h = normalizeHoldings\(d\.holdings\);\s*\n\s*if \(h\) setHoldings\(h\);/.test(WN) && /holdings=\{holdings\}/.test(WN)
    && /import \{ normalizeHoldings \} from '\.\.\/watchlistChart';/.test(WIN));
  // ⚠️ 응답자는 팝업 컴포넌트 하나 — 앱 탭(인앱 팝업)과 관심종목 창 어느 쪽에서 연 차트 창이든 그 opener가 답한다.
  //    if (!open) return null 보다 **앞**의 effect라 팝업을 닫아도 살아 있어야 한다.
  {
    const iResp = P.indexOf("d.type !== 'stockchart:ping'");
    const iNull = P.indexOf('if (!open) return null;');
    ok('#G97 팝업이 stockchart:ping 에 같은 출처 검사 후 물어본 종목 몫만(pickHoldings) 답한다 · 모르면 null',
      iResp > 0 && iNull > iResp
      && /e\.source\.postMessage\(\{ type: 'stockchart:holdings', holdings: h \? pickHoldings\(h, d\.codes\) : null \}, window\.location\.origin\);/.test(P)
      && /const onMsg = \(e\) => \{\s*\n\s*if \(e\.origin !== window\.location\.origin\) return;\s*\n\s*const d = e\.data;\s*\n\s*if \(!d \|\| typeof d !== 'object' \|\| d\.type !== 'stockchart:ping'/.test(P));
  }
  // ⚠️ 계좌마다 한 줄(사용자 요청 2026-10-30) — 합산 매입가 하나로 긋던 옛 방식(avg=)으로 되돌리지 말 것.
  ok('#G98 미니차트 매입가 = 계좌마다 한 줄(holdView → holdAvgs) · 전 계좌 매입가로 holdingLayout(40%) 눈금/가장자리 결정',
    /const hold = holdingsFor\(holdings, s\.code, s\.market\);/.test(P) && /const hv = holdView\(s\);/.test(P)
    && /\.\.\.hv\.others\.map\(\(h\) => \(\{ v: h\.avg, color: HOLD_OTHER_COLOR \}\)\),\s*\n\s*\.\.\.hv\.own\.map\(\(h\) => \(\{ v: h\.avg, color: HOLD_COLOR \}\)\),/.test(P)
    && /holdingLayout\(min, max, lv\.map\(\(a\) => a\.v\), 0\.4\)/.test(P)
    && !/<Sparkline[^>]*\savg=/.test(P));
  ok('#G99 차트 창 매입가 선 — 계좌마다(holdingsFor) · 수익률 보기는 holdingPct · 눈금마다 holdingLayout(40% — 미니차트와 같은 규칙)',
    /hold: holdingsFor\(holdings, s\.code, s\.market\),/.test(CW)
    && /const v = mode === 'pct' \? holdingPct\(h\.avg, base\) : h\.avg;/.test(CW)
    && /if \(s\.axisId !== ax\) continue;/.test(CW)
    && /holdingLayout\([^;]*avgLines\.map\(\(l\) => \(l\.s\.axisId === ax \? l\.v : NaN\)\), 0\.4\)/.test(CW)
    && /avgLines\.forEach\(\(l, i\) => \{ if \(l\.s\.axisId === ax\) pins\[i\] = lay\.pins\[i\]; \}\);/.test(CW));
  // ⚠️ 눈금을 넓히는 선(extendDomain)은 holdingLayout이 받아들인 것만 — 먼 매입가까지 넓히면 시세가 납작해진다.
  ok('#G99b 눈금 안 선만 ReferenceLine(extendDomain), 범위 밖은 가장자리 표시',
    /\{avgLines\.map\(\(l, i\) => avgLayout\.pins\[i\] === '' && \(\s*\n\s*<ReferenceLine key=\{l\.key\} y=\{l\.v\}[^>]*ifOverflow="extendDomain"/.test(CW)
    && /avgLines\.some\(\(l, i\) => avgLayout\.pins\[i\] === pin\)/.test(CW));
  {
    const iLine = CW.indexOf('<Line');
    const iAvg = CW.indexOf('avgLines.map((l, i) => avgLayout.pins[i]');
    ok('#G99c 매입가 선은 시세 선보다 뒤에 선언(태그가 위에 보인다)', iLine > 0 && iAvg > iLine);
  }
  // ── 자동 '보유종목' 그룹(사용자 요청 2026-10-30) — 전체 계좌 종목, 같은 종목은 계좌마다 한 줄 ──
  // ⚠️ 가상 그룹은 **화면에만** — 저장 그룹(watchlistGroups)에 들어가면 판 종목이 관심종목에 낡은 사본으로 남는다.
  ok('#G104 보유종목 = holdingWatchStocks(holdings)로 화면에만 끼운 auto·virtual 그룹 · 사이드바/빈 화면 판정은 shownGroups',
    /const holdStocks = useMemo\(\(\) => holdingWatchStocks\(holdings\), \[holdings\]\);/.test(P)
    && /const real = list\.filter\(\(g\) => g && g\.id !== HOLD_ID\);/.test(P)
    && /const vg = \{ id: HOLD_ID, name: HOLD_NAME, auto: true, virtual: true, stocks: holdStocks \};/.test(P)
    && /const activeGroup = shownGroups\.find\(/.test(P)
    && /\{shownGroups\.map\(\(g\) => \{/.test(P) && /\{shownGroups\.length === 0 \? \(/.test(P)
    && /const HOLD_ID = WATCH_HOLD_ID;/.test(P)
    && !/updateGroups\([^;]*(shownGroups|holdStocks|HOLD_ID)/.test(P));
  // 같은 종목이 계좌마다 줄이 있어 그대로 돌리면 같은 시세를 줄 수만큼 받는다 — 네 조회 effect 모두 코드:시장 한 번씩.
  ok('#G105 조회 effect 4곳 = uniqueStocks(코드:시장 한 번씩) · 보유종목은 코드 목록이 바뀌면 다시 조회(activeCodesKey)',
    (P.match(/uniqueStocks\(activeGroup\.stocks\)\.forEach/g) || []).length === 4
    && /const activeCodesKey = isHoldGroup \? activeGroup\.stocks\.map\(\(s\) => `\$\{s\.code\}:\$\{s\.market\}`\)\.join\(','\) : '';/.test(P)
    && /\}, \[open, activeGroup\?\.id, activeCodesKey\]\);/.test(P));
  ok('#G106 보유종목 줄은 쓰기 경로 없음 — 삭제·시장 보정 숨김 · 종목명 캐시·코드 복원 안 함',
    /\{!readOnly && !s\.virtual && \(\s*\n\s*<button\s*\n\s*onClick=\{\(\) => removeStock\(s\.id\)\}/.test(P)
    && /\{!readOnly && !s\.virtual && \(\['kr', 'us', 'fund'\]\)\.map/.test(P)
    && /if \(d\.name && d\.name !== stock\.name && !stock\.virtual\) \{/.test(P));
  ok('#G107 차트 창 — 머리글·칩은 계좌마다 매입가(합산 표기 없음) · 점선 무늬가 계좌마다 다르다',
    !/개 계좌 합산/.test(CW) && /\{mainS\.hold\.map\(\(h, j\) => \{/.test(CW)
    && /s\.hold\.slice\(0, 3\)\.map\(\(h\) => fmtAvg\(s\.market, h\.avg\)\)\.join\(' \/ '\)/.test(CW)
    && /dash: AVG_DASHES\[j % AVG_DASHES\.length\]/.test(CW) && /strokeDasharray=\{l\.dash\}/.test(CW));
}

// ── 앞자리 0이 빠진 국내 코드 복원(사용자 신고 2026-10-30 — 0241D0 이 241D0 으로 들어가 조회 실패) ──
// 네 입구(관심종목 · 종목 차트 창 · 포트폴리오 테이블 · 수익률 차트 비교종목)가 같은 후보 함수로 국내 6자리를 다시 묻고,
// **조회가 맞을 때만** 코드를 고친다(5자 미래에셋 펀드 코드가 있어 확인 없이 바꾸면 안 된다).
{
  const CHART = src('src/components/StockChartWindow.tsx');
  const SD = src('src/hooks/useStockData.ts');
  const P = stripComments(POPUP);
  const CW = stripComments(CHART);
  const SDc = stripComments(SD);
  ok('#G100 관심종목: 조회 실패 시 krCodeWithZeros 후보를 국내로 다시 묻고 맞으면 행을 고친다(해외 판정은 후보 먼저)',
    /krCodeWithZeros, holdingWatchStocks, isRowHolding,\n\} from '\.\.\/watchlistChart';/.test(POPUP)
    && /const zero = readOnly \|\| stock\.virtual \? '' : krCodeWithZeros\(stock\.code\);/.test(P)
    && /if \(zero && stock\.market === 'us'\) \{\s*\n\s*const dz = await fetchWatchQuote\('kr', zero\);\s*\n\s*if \(dz\) \{ repairStockCode\(stock, zero, dz\); return; \}/.test(P)
    && /if \(!d && zero && stock\.market !== 'us'\) \{\s*\n\s*const dz = await fetchWatchQuote\('kr', zero\);\s*\n\s*if \(dz\) \{ repairStockCode\(stock, zero, dz\); return; \}/.test(P));
  ok('#G100b 관심종목: 고친 코드가 그룹에 이미 있으면 고장 난 행을 지운다 · 시장은 국내로',
    /const dup = arr\.some\(\(s\) => s\.id !== stock\.id && \(s\.code \|\| ''\)\.toUpperCase\(\) === code\);/.test(P)
    && /stocks: dup \? arr\.filter\(\(s\) => s\.id !== stock\.id\)/.test(P) && /\{ \.\.\.s, code, market: 'kr', name: fixed\.name \}/.test(P));
  ok('#G100c 관심종목·차트 창: 국내 코드는 대문자로 추가한다',
    /const code = detectMarket\(raw\) === 'kr' \? raw\.toUpperCase\(\) : raw;/.test(P)
    && /const c = detectMarket\(c0\) === 'kr' \? c0\.toUpperCase\(\) : c0;/.test(CW));
  ok('#G101 종목 차트 창: 종가 이력 조회 실패 시 국내 6자리로 다시 받고 맞으면 종목 코드를 고친다(겹치면 비교 종목을 뺀다)',
    /krCodeWithZeros,\n\} from '\.\.\/watchlistChart';/.test(CHART)
    && /const zero = krCodeWithZeros\(s\.code\);/.test(CW) && /const p2 = await fetchWatchDaily\('kr', zero, from \|\| undefined\);/.test(CW)
    && /if \(isMain\) setMain\(\(m\) => \(m\.code === s\.code \? \{ \.\.\.m, code: zero, market: 'kr' \} : m\)\);/.test(CW)
    && /setComps\(\(p\) => p\.filter\(\(c\) => c\.code !== s\.code\)\);/.test(CW));
  ok('#G102 포트폴리오 테이블(국내): 6자 미만·소문자 코드는 6자·대문자로 조회하고 맞으면 칸의 코드를 고친다',
    /import \{ krCodeWithZeros \} from '\.\.\/watchlistChart';/.test(SD)
    && /const fixed = zero \|\| \(isKoreanCode\(upper\) \? upper : ''\);/.test(SDc)
    && /\{ \.\.\.p, code: fixed, name: dz\.name, currentPrice: dz\.price, changeRate: dz\.changeRate \}/.test(SDc));
  ok('#G103 수익률 차트 비교종목: 후보를 국내로 먼저 묻고 맞으면 칩 코드를 고쳐 같은 함수를 다시 탄다',
    /patchComp\(index, code, \{ code: zero, name: dz\.name \|\| zero \}\);\s*\n\s*return handleCompStockBlur\(index, zero\);/.test(SDc));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:watchlist — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
