// 과거 목표비중 복원(listRebalTargetSnapshots / matchRebalTargetRows / applyRebalTargetRatios) 단위 테스트.
// 실행: npm run verify:rebal-restore  (불일치 시 종료코드 1)
//
// utils.ts는 TS라 직접 import 불가 → 함수 본문을 그대로 미러(참조 구현)하고 검증.
// ⚠️ 본 파일의 미러와 src/utils.ts의 함수 본문은 **항상 1:1 동기화**할 것.
// ⚠️ #1~#24는 미러 테스트라 소스를 되돌려도 통과한다 — 호출부 계약(복원이 달력을 쓰지 않는가,
//    dirty를 지우지 않는가, 헤더 날짜의 기존 기록을 파괴하지 않는가)은 미러로 표현할 수 없어
//    #25~#31이 readFileSync로 직접 단언한다 (verify-twr.mjs #30d, verify-market-calendar.mjs 선례).
import { readFileSync } from 'fs';

let failed = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`  ✓ ${label}`);
  else { failed++; console.error(`  ✗ ${label}\n      기대: ${JSON.stringify(want)}\n      실제: ${JSON.stringify(got)}`); }
};
const ok = (label, cond) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failed++; console.error(`  ✗ ${label}`); }
};

// ─── 참조 구현 (src/utils.ts 미러) ─────────────────────────────────────────────
const isValidIsoDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
};
const cleanNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
  return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
};

const listRebalTargetSnapshots = (calendarMemos, portfolioId) => {
  if (!calendarMemos || typeof calendarMemos !== 'object' || Array.isArray(calendarMemos) || !portfolioId) return [];
  const out = [];
  for (const dayKey of Object.keys(calendarMemos)) {
    if (!isValidIsoDate(dayKey)) continue;
    const arr = calendarMemos[dayKey];
    if (!Array.isArray(arr)) continue;
    const memo = arr.find(m => m && m.kind === 'rebalTarget' && m.portfolioId === portfolioId
      && Array.isArray(m.rows) && m.rows.length > 0);
    if (memo) out.push({ dayKey, memo });
  }
  out.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0));
  return out;
};

const rbCodeKey = (s) => String(s ?? '').trim().toUpperCase();
const rbNameKey = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

const matchRebalTargetRows = (rows, items) => {
  const src = Array.isArray(rows) ? rows : [];
  const cur = (Array.isArray(items) ? items : []).filter(it => it && it.id != null);
  const byCode = new Map(), byName = new Map();
  const push = (map, key, v) => { if (!key) return; const a = map.get(key); if (a) a.push(v); else map.set(key, [v]); };
  cur.forEach(it => { push(byCode, rbCodeKey(it.code), it); push(byName, rbNameKey(it.name), it); });

  const used = new Set();
  const matched = [], skipped = [], pending = [];
  const freeOf = (a) => (a || []).filter(it => !used.has(it.id));
  const take = (row, it, value, by) => {
    used.add(it.id);
    matched.push({
      id: it.id, value, by,
      code: it.code || '', curName: it.name || '', snapName: row.name || '',
      prevRatio: cleanNum(it.effectiveTargetRatio), isSavings: it.type === 'savings',
    });
  };

  for (const row of src) {
    if (!row || typeof row !== 'object') { skipped.push({ name: '', code: '', value: 0, why: 'bad-row' }); continue; }
    const value = row.targetRatio;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) {
      skipped.push({ name: row.name || '', code: row.code || '', value: 0, why: 'bad-value' });
      continue;
    }
    const ck = rbCodeKey(row.code);
    if (!ck) { pending.push({ row, value }); continue; }
    const cand = freeOf(byCode.get(ck));
    if (cand.length === 1) { take(row, cand[0], value, 'code'); continue; }
    if (cand.length > 1) {
      const nk = rbNameKey(row.name);
      const narrow = nk ? cand.filter(it => rbNameKey(it.name) === nk) : [];
      if (narrow.length === 1) take(row, narrow[0], value, 'code+name');
      else skipped.push({ name: row.name || '', code: row.code || '', value, why: 'ambiguous' });
      continue;
    }
    pending.push({ row, value });
  }

  for (const { row, value } of pending) {
    const nk = rbNameKey(row.name);
    if (!nk) { skipped.push({ name: '', code: row.code || '', value, why: 'blank-key' }); continue; }
    const wantSavings = row.curQty === null;
    const cand = freeOf(byName.get(nk)).filter(it => (it.type === 'savings') === wantSavings);
    if (cand.length === 1) take(row, cand[0], value, 'name');
    else skipped.push({ name: row.name || '', code: row.code || '', value, why: cand.length ? 'ambiguous' : 'missing' });
  }

  const mid = new Set(matched.map(m => m.id));
  const untouched = cur.filter(it => !mid.has(it.id));
  return {
    matched, skipped, untouched,
    appliedSum: matched.reduce((s, m) => s + m.value, 0),
    untouchedSum: untouched.reduce((s, it) => s + cleanNum(it.effectiveTargetRatio), 0),
  };
};

const applyRebalTargetRatios = (items, ratioById, opts) => {
  const slotField = opts?.slotField;
  const overrideField = opts?.overrideField;
  if (!Array.isArray(items) || !ratioById || !slotField) return items;
  let changed = false;
  const next = items.map(it => {
    if (!it || it.id == null || !Object.prototype.hasOwnProperty.call(ratioById, it.id)) return it;
    changed = true;
    const patched = { ...it, [slotField]: ratioById[it.id] };
    if (overrideField) patched[overrideField] = true;
    return patched;
  });
  return changed ? next : items;
};

// ─── 픽스처 ────────────────────────────────────────────────────────────────────
const snapRow = (name, code, targetRatio, curQty = 10) => ({ name, code, targetRatio, curQty, expQty: curQty, expEval: 0 });
const item = (id, name, code, effectiveTargetRatio, type = 'stock') => ({ id, name, code, effectiveTargetRatio, type });
const ids = (r) => r.matched.map(m => `${m.id}=${m.value}`);
const whys = (r) => r.skipped.map(s => s.why);

console.log('\n── 스냅샷 열거 ──');

// #1 계좌별 필터 + 날짜 내림차순
{
  const memos = {
    '2026-06-02': [{ kind: 'rebalTarget', portfolioId: 'A', rows: [snapRow('x', '1', 1)] }],
    '2026-07-31': [{ kind: 'note' }, { kind: 'rebalTarget', portfolioId: 'A', rows: [snapRow('x', '1', 2)] }],
    '2026-07-14': [{ kind: 'rebalTarget', portfolioId: 'B', rows: [snapRow('x', '1', 3)] }],
  };
  eq('#1 계좌 A만, 최신 우선', listRebalTargetSnapshots(memos, 'A').map(s => s.dayKey), ['2026-07-31', '2026-06-02']);
  eq('#1b 계좌 B', listRebalTargetSnapshots(memos, 'B').map(s => s.dayKey), ['2026-07-14']);
}

// #2 손상 데이터 방어 — rows 비배열·빈배열·유효하지 않은 날짜 키·비배열 값
{
  const memos = {
    '2026-13-45': [{ kind: 'rebalTarget', portfolioId: 'A', rows: [snapRow('x', '1', 1)] }],
    '2026-08-01': [{ kind: 'rebalTarget', portfolioId: 'A', rows: 'oops' }],
    '2026-08-02': [{ kind: 'rebalTarget', portfolioId: 'A', rows: [] }],
    '2026-08-03': { kind: 'rebalTarget' },
    '2026-08-04': [{ kind: 'rebalTarget', portfolioId: 'A', rows: [snapRow('x', '1', 1)] }],
  };
  eq('#2 손상 항목 전부 제외', listRebalTargetSnapshots(memos, 'A').map(s => s.dayKey), ['2026-08-04']);
  eq('#2b null/포트폴리오 미지정 → []', listRebalTargetSnapshots(null, 'A').concat(listRebalTargetSnapshots(memos, '')), []);
}

console.log('\n── 매칭 ──');

// #3 코드 정확 일치
{
  const r = matchRebalTargetRows([snapRow('TIGER', '360750', 30)], [item('i1', 'TIGER', '360750', 25)]);
  eq('#3 코드 일치', ids(r), ['i1=30']);
  eq('#3b by=code', r.matched[0].by, 'code');
  eq('#3c prevRatio 보존', r.matched[0].prevRatio, 25);
}

// #4 기록에만 있는 종목 → missing skip (사용자 요구: 무시)
{
  const r = matchRebalTargetRows([snapRow('삼성전자', '005930', 12)], [item('i1', 'TIGER', '360750', 25)]);
  eq('#4 기록에만 있음 → skip', ids(r), []);
  eq('#4b why=missing', whys(r), ['missing']);
}

// #5 현재 표에만 있는 종목 → untouched (사용자 요구: 현재 값 유지)
{
  const r = matchRebalTargetRows([snapRow('TIGER', '360750', 30)],
    [item('i1', 'TIGER', '360750', 25), item('i2', '신규ETF', '999999', 15)]);
  eq('#5 표에만 있음 → untouched', r.untouched.map(u => u.id), ['i2']);
  eq('#5b untouchedSum = 현재 값 유지', r.untouchedSum, 15);
  eq('#5c appliedSum', r.appliedSum, 30);
}

// #6 코드 대소문자/공백 정규화
{
  const r = matchRebalTargetRows([snapRow('f', ' ma:abc ', 10)], [item('i1', 'f', 'MA:ABC', 5, 'fund')]);
  eq('#6 코드 trim+대문자', ids(r), ['i1=10']);
}

// #7 코드 중복 → 이름으로 좁힘
{
  const r = matchRebalTargetRows([snapRow('둘째', '005930', 20)],
    [item('i1', '첫째', '005930', 5), item('i2', '둘째', '005930', 7)]);
  eq('#7 코드 중복 → 이름으로 유일화', ids(r), ['i2=20']);
  eq('#7b by=code+name', r.matched[0].by, 'code+name');
}

// #8 코드·이름 모두 중복 → ambiguous 보류 (임의 선택 금지)
{
  const r = matchRebalTargetRows([snapRow('같은이름', '005930', 20)],
    [item('i1', '같은이름', '005930', 5), item('i2', '같은이름', '005930', 7)]);
  eq('#8 완전 중복 → 보류', ids(r), []);
  eq('#8b why=ambiguous', whys(r), ['ambiguous']);
}

// #9 코드 표기 변경 → 이름 폴백
{
  const r = matchRebalTargetRows([snapRow('미래에셋펀드', 'OLDCODE', 40)],
    [item('i1', '미래에셋펀드', 'MA:NEW', 10, 'fund')]);
  eq('#9 코드 실패 → 이름 폴백', ids(r), ['i1=40']);
  eq('#9b by=name', r.matched[0].by, 'name');
}

// #10 ETF 개명(코드 동일, 이름 다름) → 코드로 매칭 + 옛 이름 보존
{
  const r = matchRebalTargetRows([snapRow('구 TIGER', '360750', 30)], [item('i1', '신 TIGER', '360750', 25)]);
  eq('#10 개명해도 코드로 매칭', ids(r), ['i1=30']);
  eq('#10b 기록 이름 노출', r.matched[0].snapName, '구 TIGER');
  eq('#10c 현재 이름 노출', r.matched[0].curName, '신 TIGER');
}

// #11 예적금(savings) — code 없음, curQty === null 타입 힌트
{
  const rows = [{ name: '교보 3년', code: '', targetRatio: 12, curQty: null, expQty: null, expEval: 0 }];
  const r = matchRebalTargetRows(rows, [item('s1', '교보 3년', '', 0, 'savings')]);
  eq('#11 예적금 이름 매칭', ids(r), ['s1=12']);
  eq('#11b isSavings 플래그', r.matched[0].isSavings, true);
}

// #12 savings ↔ stock 이름 충돌 → 타입 힌트로 분리
{
  const rows = [{ name: '동명', code: '', targetRatio: 12, curQty: null }];
  const r = matchRebalTargetRows(rows, [item('k1', '동명', '', 1, 'stock'), item('s1', '동명', '', 2, 'savings')]);
  eq('#12 curQty:null → savings 선택', ids(r), ['s1=12']);
  const rows2 = [{ name: '동명', code: '', targetRatio: 9, curQty: 5 }];
  const r2 = matchRebalTargetRows(rows2, [item('k1', '동명', '', 1, 'stock'), item('s1', '동명', '', 2, 'savings')]);
  eq('#12b curQty:숫자 → stock 선택', ids(r2), ['k1=9']);
}

// #13 이름·코드 둘 다 빈 행 → blank-key (빈 키끼리 매칭 금지)
{
  const r = matchRebalTargetRows([{ name: '', code: '', targetRatio: 5, curQty: 0 }],
    [item('i1', '', '', 0)]);
  eq('#13 빈 키 → 보류', ids(r), []);
  eq('#13b why=blank-key', whys(r), ['blank-key']);
}

// #14 값 검증 — null/''/false/[]가 0으로 통과하면 안 된다 (Number() 사용 금지 회귀)
{
  const bad = [
    { name: 'a', code: 'A', targetRatio: null, curQty: 1 },
    { name: 'b', code: 'B', targetRatio: '', curQty: 1 },
    { name: 'c', code: 'C', targetRatio: false, curQty: 1 },
    { name: 'd', code: 'D', targetRatio: [], curQty: 1 },
    { name: 'e', code: 'E', targetRatio: '30', curQty: 1 },
    { name: 'f', code: 'F', targetRatio: NaN, curQty: 1 },
    { name: 'g', code: 'G', targetRatio: -1, curQty: 1 },
    { name: 'h', code: 'H', targetRatio: 1001, curQty: 1 },
    { name: 'i', code: 'I', targetRatio: Infinity, curQty: 1 },
  ];
  const cur = 'ABCDEFGHI'.split('').map((c, i) => item(`i${i}`, c.toLowerCase(), c, 0));
  const r = matchRebalTargetRows(bad, cur);
  eq('#14 손상 값 전부 skip', ids(r), []);
  eq('#14b 사유 전부 bad-value', whys(r), Array(9).fill('bad-value'));
}

// #15 행 자체가 손상(null/문자열/숫자)
{
  const r = matchRebalTargetRows([null, 'oops', 42, snapRow('ok', 'OK', 10)], [item('i1', 'ok', 'OK', 0)]);
  eq('#15 손상 행 skip + 정상 행 적용', ids(r), ['i1=10']);
  eq('#15b why=bad-row ×3', whys(r), ['bad-row', 'bad-row', 'bad-row']);
}

// #16 rows 비배열 / items 비배열
{
  eq('#16 rows 비배열 → 전부 untouched', matchRebalTargetRows('nope', [item('i1', 'a', 'A', 3)]).untouched.length, 1);
  eq('#16b items 비배열 → 전부 missing', whys(matchRebalTargetRows([snapRow('a', 'A', 3)], null)), ['missing']);
}

// #17 ⚠️ 순서 무의존 — rows를 뒤집어도 결과 동일(인덱스 폴백이 없다는 증거)
{
  const rows = [snapRow('A', 'AAA', 10), snapRow('B', 'BBB', 20), snapRow('C', 'CCC', 30)];
  const cur = [item('i3', 'C', 'CCC', 0), item('i1', 'A', 'AAA', 0), item('i2', 'B', 'BBB', 0)];
  const fwd = matchRebalTargetRows(rows, cur).matched.map(m => `${m.id}=${m.value}`).sort();
  const rev = matchRebalTargetRows([...rows].reverse(), cur).matched.map(m => `${m.id}=${m.value}`).sort();
  eq('#17 rows 순서 무관', fwd, rev);
  eq('#17b 올바른 대응', fwd, ['i1=10', 'i2=20', 'i3=30']);
}

// #18 NFC/NFD 및 공백 정규화
{
  const nfd = '한글펀드'.normalize('NFD');
  const r = matchRebalTargetRows([{ name: nfd, code: '', targetRatio: 7, curQty: 1 }],
    [item('i1', '한글펀드'.normalize('NFC'), '', 0, 'fund')]);
  eq('#18 NFD↔NFC 매칭', ids(r), ['i1=7']);
  const r2 = matchRebalTargetRows([{ name: ' TIGER   미국  ', code: '', targetRatio: 7, curQty: 1 }],
    [item('i1', 'TIGER 미국', '', 0, 'fund')]);
  eq('#18b 공백 축약 매칭', ids(r2), ['i1=7']);
}

// #19 합계는 보정하지 않는다 — 교집합만 적용해 100%가 아니어도 원값 그대로
{
  const r = matchRebalTargetRows([snapRow('A', 'AAA', 42), snapRow('B', 'BBB', 26)],
    [item('i1', 'A', 'AAA', 50), item('i2', 'B', 'BBB', 30), item('i3', 'C', 'CCC', 15)]);
  eq('#19 적용 합계 원값', r.appliedSum, 68);
  eq('#19b 유지 합계', r.untouchedSum, 15);
  eq('#19c 스케일링 없음(83 ≠ 100)', r.appliedSum + r.untouchedSum, 83);
}

console.log('\n── 적용 ──');

// #20 override는 미러 상태와 무관하게 항상 true
{
  const items = [item('i1', 'A', 'AAA', 0), item('i2', 'B', 'BBB', 0)];
  const out = applyRebalTargetRatios(items, { i1: 30 }, { slotField: 'targetRatio', overrideField: 'targetRatioOverride' });
  eq('#20 슬롯 기록', out[0].targetRatio, 30);
  eq('#20b override 항상 true', out[0].targetRatioOverride, true);
  eq('#20c 미매칭 항목 무접촉(참조 동일)', out[1] === items[1], true);
}

// #21 수시변경 슬롯
{
  const out = applyRebalTargetRatios([item('i1', 'A', 'AAA', 0)], { i1: 12.34 },
    { slotField: 'targetRatioVar', overrideField: 'targetRatioVarOverride' });
  eq('#21 variable 슬롯', out[0].targetRatioVar, 12.34);
  eq('#21b variable override', out[0].targetRatioVarOverride, true);
  eq('#21c fixed 슬롯 무접촉', out[0].targetRatio, undefined);
}

// #22 변경 없음 → 같은 참조 반환(불필요한 Drive 저장 트리거 방지)
{
  const items = [item('i1', 'A', 'AAA', 0)];
  eq('#22 매칭 0건 → 동일 참조', applyRebalTargetRatios(items, {}, { slotField: 'targetRatio' }) === items, true);
  eq('#22b 잘못된 인자 → 동일 참조', applyRebalTargetRatios(items, null, { slotField: 'targetRatio' }) === items, true);
}

// #23 프로토타입 오염 방지 — __proto__/toString 키가 있어도 항목이 오염되지 않는다
{
  const items = [item('i1', 'A', 'AAA', 0)];
  const poisoned = JSON.parse('{"__proto__":{"targetRatio":999},"toString":50}');
  const out = applyRebalTargetRatios(items, poisoned, { slotField: 'targetRatio', overrideField: 'targetRatioOverride' });
  eq('#23 오염 키 무시 → 동일 참조', out === items, true);
  eq('#23b Object.prototype 무오염', ({}).targetRatio, undefined);
}

// #24 값 정밀도 보존(2dp 반올림 금지 — 표 tfoot 합계와 어긋난다)
{
  const out = applyRebalTargetRatios([item('i1', 'A', 'AAA', 0)], { i1: 33.333333333 }, { slotField: 'targetRatio' });
  eq('#24 원값 보존', out[0].targetRatio, 33.333333333);
}

console.log('\n── 소스 텍스트 가드 (호출부 계약) ──');
{
  const stripComments = (s) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const readSrc = (rel) => {
    try { return stripComments(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')); }
    catch { return null; }
  };
  // ⚠️ 패널만 주석을 남긴 원본으로 읽는다 — 구간 경계가 `// #verify:` **주석**이라 stripComments가
  //    지우면 구간 자체를 못 찾는다. 대신 구간 **안**에는 금지 토큰을 언급하는 주석을 두지 말 것
  //    (설명 주석은 시작 센티넬 **위**에 둔다).
  const readRaw = (rel) => {
    try { return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'); } catch { return null; }
  };
  const app = readSrc('src/App.tsx');
  const panel = readRaw('src/components/RebalancingPanel.tsx');
  const modal = readSrc('src/components/RebalanceTargetRestoreModal.tsx');
  const utl = readSrc('src/utils.ts');
  const pin = readSrc('src/components/RebalanceTargetPinModal.tsx');
  if (!app || !panel || !modal || !utl || !pin) {
    failed++; console.error('  ✗ #25-read 소스 파일을 읽지 못했습니다(경로/파일명 변경?)');
  } else {
    // 복원 적용 구간이 달력 쓰기·dirty 세팅 경로에 손대지 않는지 (INV-1·INV-2)
    const seg = panel.match(/#verify:restore-apply-start[\s\S]*?#verify:restore-apply-end/);
    ok('#25 복원 적용 구간(센티넬 주석)이 존재한다', !!seg);
    if (seg) {
      const body = seg[0];
      ok('#25a 복원이 onTargetEdited를 호출하지 않는다', !/onTargetEdited/.test(body));
      ok('#25b 복원이 reportAdminChange를 재사용하지 않는다', !/reportAdminChange/.test(body));
      ok('#25c 복원이 updateSettingsForType을 호출하지 않는다', !/updateSettingsForType/.test(body));
      ok('#25d 복원이 달력 메모를 쓰지 않는다', !/setCalendarMemos|onUpdateMemos/.test(body));
      ok('#25e 관리자 공지는 직접 발화한다', /onAdminTargetChange\s*\(\s*\)/.test(body));
      ok('#25f override 필드를 함께 넘긴다', /overrideField/.test(body));
    }
    // 복원 모달은 달력 쓰기 인터페이스를 아예 갖지 않는다
    ok('#26 복원 모달에 달력 쓰기 prop이 없다', !/setCalendarMemos|onUpdateMemos|calendarMemos/.test(modal));
    // App: dirty는 '헤더 날짜 ≠ 소스 날짜'일 때만 세우고, 기존 dirty를 지우지 않는다
    const h = app.match(/const handleTargetRestored[\s\S]*?\n  \};/);
    ok('#27 handleTargetRestored가 존재한다', !!h);
    if (h) {
      ok('#27a 헤더 날짜 = 소스 날짜면 기록하지 않는다', /headerDate === opts\.dayKey/.test(h[0]));
      ok('#27b 기존 dirty를 지우지 않는다', !/delete rebalTargetDirtyRef/.test(h[0]));
      ok('#27c 대기 타이머를 폐기하지 않는다', !/rebalDateTimerRef/.test(h[0]));
      // ⚠️ 최중요 — 커밋은 소스 날짜가 아니라 **헤더 날짜**에 쓰이고 (kind,pid)만 보고 전면 교체한다.
      //    헤더 날짜에 이미 기록이 있는데 dirty를 세우면 그 원본이 복원값+오늘 수량으로 덮여
      //    거짓 이력이 되고 백업 복원 sticky라 복구 불가하다.
      ok('#27d 헤더 날짜에 기존 기록이 있으면 기록하지 않는다',
        /calendarMemosRef\.current\?\.\[headerDate\]/.test(h[0])
        && /kind === 'rebalTarget' && m\.portfolioId === pid/.test(h[0]));
    }
    // 지문에 목표비중 4필드가 남아 있어야 복원 결과가 Drive에 저장된다
    ok('#28 portfolioStructureKey에 targetRatio 4필드 유지',
      /targetRatio: item\.targetRatio/.test(app) && /targetRatioVar: item\.targetRatioVar/.test(app)
      && /targetRatioOverride: item\.targetRatioOverride/.test(app)
      && /targetRatioVarOverride: item\.targetRatioVarOverride/.test(app));
    // 값 파싱이 Number()로 되돌아가지 않았는지
    ok('#29 matchRebalTargetRows가 typeof 숫자 검사를 한다',
      /typeof value !== 'number' \|\| !Number\.isFinite\(value\)/.test(utl));
    // PIN 모달이 복원 모달보다 위에 있는지 (잠금 우회 방지)
    // ⚠️ 루트 컨테이너로 앵커 — 파일 앞쪽에 더 작은 z-[N]이 추가돼도 엉뚱한 값을 집지 않는다.
    const pinZ = pin.match(/fixed inset-0[\s\S]*?z-\[(\d+)\]/);
    const modZ = modal.match(/zIndex:\s*(\d+)/);
    ok('#30 PIN 모달 z > 복원 모달 z (잠금 우회 방지)',
      !!pinZ && !!modZ && Number(pinZ[1]) > Number(modZ[1]));
    // ⚠️ 두 모달 모두 비차단 플로팅 창(메모 달력 1050 · 메모 패드 1060) 위에 있어야 한다 —
    //    아래에 두면 폭 1200px 달력이 열려 있을 때 창이 통째로 가려진다.
    ok('#31 복원·PIN 모달이 플로팅 창(1060)보다 위, LoadingOverlay(1100)보다 아래',
      !!pinZ && !!modZ && Number(modZ[1]) > 1060 && Number(pinZ[1]) < 1100);
    // 잠금 fail-closed — locked인데 onRequestPin이 없으면 doApply로 흘러선 안 된다
    ok('#32 PIN 게이트가 fail-closed다', /if \(locked\) \{ if \(onRequestPin\) onRequestPin\(doApply\); return; \}/.test(modal));
  }
}

console.log('');
if (failed > 0) {
  console.error(`❌ 실패 ${failed}건 — 과거 목표비중 복원 로직이 참조 구현/계약과 어긋납니다.`);
  process.exit(1);
}
console.log('✅ 과거 목표비중 복원 테스트 전부 통과.');
