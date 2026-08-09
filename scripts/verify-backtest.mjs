#!/usr/bin/env node
// 리밸런싱 백테스트 엔진 검증 — src/backtest.ts 의 참조 구현과 1:1 동기화할 것.
//
//   파트① 영업일/일정 (#1~#14)
//     날짜 산술이 로컬 타임존에서 하루 밀리지 않는가, 분배락·리밸런싱·지급일 역산이
//     2026 KRX 캘린더에서 정확한가. 이 규칙은 "커버드콜 백테스트 PDF"에서 역산했고
//     PDF의 리밸런싱일 14개 중 12개와 일치한다(불일치 2개는 PDF가 **일요일**을 쓴 오류).
//   파트② 수량/현금 규약 (#15~#22)
//     ⚠️ floor = Math.trunc(0 방향)이지 Math.floor가 아니다. 매도(음수)에 Math.floor를 쓰면
//        매도량이 1주 늘어 이후 전 구간 수량이 어긋난다.
//   파트③ PDF 전체 재현 (#23~#38)
//     초기매수·월별 매매금액·조정후수량·분배금을 PDF와 대조. 여기서 고정하는 최대 발견은
//     **구조 변경(종목 재편) 매매는 리밸런싱 차익에 계상하지 않는다**는 규칙이다
//     (PDF 4월 합계 25,859,200 = 정기 3건만. 회색 음영 3행 제외).
//   파트④ 회귀 가드 (#39~#48) / 정규화·지문·sticky (#49~#56) / 데이터 수집 (#57~#58)
//     비중 모드 초기매수 0원 붕괴 / 분배 일정이 리밸런싱 정책에 끌려가는 결함 /
//     매도·매수 순서 / 지급월 vs 분배락월 / 정규화·지문·sticky 판정.
//   파트④-d 월말 보유 (#69~#74) — 무거래 종목 포함·Σholdings=evalEnd·비중 100%·lastDate 캡
//   파트④-j 평가금 고정 보조 규칙 (#157~#226)
//     리밸런싱 밴드 / 평시 매수 재원 제한 / 급락 분할투입 / 현금 바닥선 /
//     연간 가드레일 증액 / 분배금 원천징수. ⚠️ 기능마다 **'동작'과 '기본값 무영향'을 쌍으로** 둔다 —
//     무영향 케이스가 없으면 "새 옵션 기본값에서 기존 시나리오 결과가 1원도 달라지지 않는다"는
//     하위호환 계약이 무방비다. 원천징수는 divPaid를 **세후**로 정의했으므로 기말 예수금 분해
//     항등식(#125)이 그대로 성립해야 한다(#204).
//   파트⑤ 소스 텍스트 가드 (#59~#68, #227~#234)
//     미러 테스트는 함수 본문 회귀만 잡는다. 영속화 배선(호출부)은 미러로 표현할 수 없어
//     App.tsx·useDriveSync.ts·backtest.ts 를 직접 읽어 계약을 단언한다
//     (verify-flow.mjs #27~#36 · verify-twr.mjs #30d 선례).
//     ⚠️ 실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const okv = Object.is(got, want) || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-6);
  if (okv) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want}`); }
};
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};
const deep = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));

// ═══════════ 참조 구현 (src/backtest.ts 미러) ═══════════

let idSeq = 0;
const generateId = () => `gen${++idSeq}`;

const DAY_MS = 86400000;
const MAX_BT_SCENARIOS = 10, MAX_BT_ASSETS = 20, MAX_BT_EVENTS = 40, MAX_BT_OVERRIDES = 120;
const BT_COLORS = ['#60A5FA', '#F472B6', '#34D399', '#FBBF24', '#A78BFA', '#22D3EE', '#FB923C', '#4ADE80', '#F87171', '#2DD4BF'];

const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const pad2 = (n) => String(n).padStart(2, '0');

function msToDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function dateToMs(s) {
  if (!isIsoDate(s)) return NaN;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return NaN;
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  return msToDate(ms) === s ? ms : NaN;
}
function addDays(s, n) {
  const ms = dateToMs(s);
  if (!Number.isFinite(ms)) return s;
  return msToDate(ms + n * DAY_MS);
}
function weekdayOf(s) {
  const ms = dateToMs(s);
  if (!Number.isFinite(ms)) return -1;
  return new Date(ms).getUTCDay();
}
function isBusinessDay(s, holidays) {
  const wd = weekdayOf(s);
  if (wd < 0 || wd === 0 || wd === 6) return false;
  const has = holidays instanceof Set ? holidays.has(s) : holidays.includes(s);
  return !has;
}
function onOrBeforeBusinessDay(s, holidays) {
  let cur = s;
  for (let i = 0; i < 400; i++) {
    if (!isIsoDate(cur)) return s;
    if (isBusinessDay(cur, holidays)) return cur;
    cur = addDays(cur, -1);
  }
  return s;
}
function onOrAfterBusinessDay(s, holidays) {
  let cur = s;
  for (let i = 0; i < 400; i++) {
    if (!isIsoDate(cur)) return s;
    if (isBusinessDay(cur, holidays)) return cur;
    cur = addDays(cur, 1);
  }
  return s;
}
function shiftBusinessDays(s, n, holidays) {
  if (!isIsoDate(s)) return s;
  let cur = n > 0 ? onOrAfterBusinessDay(s, holidays) : onOrBeforeBusinessDay(s, holidays);
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(n), guard = 0;
  while (left > 0 && guard < 4000) {
    cur = addDays(cur, step); guard++;
    if (isBusinessDay(cur, holidays)) left--;
  }
  return cur;
}
function businessDaysBetween(from, to, holidays) {
  const out = [];
  const endMs = dateToMs(to);
  if (!Number.isFinite(dateToMs(from)) || !Number.isFinite(endMs)) return out;
  let cur = from, guard = 0;
  while (dateToMs(cur) <= endMs && guard < 20000) {
    if (isBusinessDay(cur, holidays)) out.push(cur);
    cur = addDays(cur, 1); guard++;
  }
  return out;
}
const ymOf = (s) => (isIsoDate(s) ? s.slice(0, 7) : '');
function addMonthsToYm(ym, n) {
  if (!/^\d{4}-\d{2}$/.test(ym) || !Number.isFinite(n)) return '';
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7) + Math.trunc(n);
  const ny = y + Math.floor((m - 1) / 12);
  const nm = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${ny}-${pad2(nm)}`;
}
function lastDayOfMonth(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return '';
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  const d = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  return `${ym}-${pad2(d)}`;
}
function monthsBetween(startDate, endDate) {
  const out = [];
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return out;
  let y = +startDate.slice(0, 4), m = +startDate.slice(5, 7);
  const ey = +endDate.slice(0, 4), em = +endDate.slice(5, 7);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 1200) {
    out.push(`${y}-${pad2(m)}`);
    m++; if (m > 12) { m = 1; y++; }
    guard++;
  }
  return out;
}
function recordDateFor(ym, cycle, holidays) {
  const raw = cycle === 'mid' ? `${ym}-15` : lastDayOfMonth(ym);
  if (!isIsoDate(raw)) return '';
  return onOrBeforeBusinessDay(raw, holidays);
}

const NO_PRICE = { price: 0, exact: false, missing: true, usedDate: '' };
function priceAt(series, date) {
  if (!series || !isIsoDate(date)) return NO_PRICE;
  const exactVal = series[date];
  if (typeof exactVal === 'number' && Number.isFinite(exactVal) && exactVal > 0) {
    return { price: exactVal, exact: true, missing: false, usedDate: date };
  }
  let best = '';
  for (const d in series) {
    if (d > date) continue;
    if (d > best) {
      const v = series[d];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) best = d;
    }
  }
  if (!best) return NO_PRICE;
  return { price: series[best], exact: false, missing: false, usedDate: best };
}
function seriesRange(series) {
  let first = '', last = '', count = 0;
  if (!series) return { first, last, count };
  for (const d in series) {
    const v = series[d];
    if (!isIsoDate(d) || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    count++;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  return { first, last, count };
}
const QTY_EPS = 1e-9;
function roundQty(raw, mode) {
  if (!Number.isFinite(raw)) return 0;
  if (mode === 'exact') return raw;
  if (mode === 'round') return Math.round(raw);
  return Math.trunc(raw);
}

const asStr = (v) => (typeof v === 'string' ? v : '');
const asNum = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const asNumOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asArr = (v) => (Array.isArray(v) ? v : []);
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));

function normalizeDivOverride(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) {
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}
const REBAL_MODES = ['follow', 'mid', 'eom', 'day', 'dates', 'none'];
const CONTRIB_MODES = ['none', 'pctOfCash', 'amount'];
const MAX_BT_CONTRIB_OVERRIDES = 120, MAX_BT_REBAL_DATES = 120, MAX_BT_DIP_LEVELS = 5, MAX_BT_SELL_LEVELS = 5;
const MAX_BT_ANCHOR_LEVELS = 5;
const MAX_BT_NOTES = 12, MAX_BT_NOTE_LEN = 8000, MAX_BT_NOTE_TITLE_LEN = 80, MAX_BT_VERDICT_LEN = 200;
const DEFAULT_DIP_LEVELS = [{ drop: 10, buyPct: 34 }, { drop: 20, buyPct: 33 }, { drop: 30, buyPct: 33 }];
const DEFAULT_SELL_LEVELS = [{ rise: 10, sellPct: null }, { rise: 20, sellPct: null }];
const asPctOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = asNum(v, NaN);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
};
function normalizeDipLevels(raw) {
  const arr = asArr(raw)
    .map((l) => ({
      drop: asNum(l?.drop, NaN),
      buyPct: l?.buyPct !== undefined ? asPctOrNull(l.buyPct) : (asPctOrNull(l?.unlockPct) || null),
    }))
    .filter((l) => Number.isFinite(l.drop) && l.drop > 0 && l.drop <= 100);
  if (!arr.length) return DEFAULT_DIP_LEVELS.map((l) => ({ ...l }));
  arr.sort((a, b) => a.drop - b.drop);
  const seen = new Set();
  const out = [];
  for (const l of arr) {
    if (seen.has(l.drop)) continue;
    seen.add(l.drop);
    out.push(l);
    if (out.length >= MAX_BT_DIP_LEVELS) break;
  }
  return out;
}
function normalizeSellLevels(raw) {
  const arr = asArr(raw)
    .map((l) => ({ rise: asNum(l?.rise, NaN), sellPct: asPctOrNull(l?.sellPct) }))
    .filter((l) => Number.isFinite(l.rise) && l.rise > 0 && l.rise <= 1000);
  arr.sort((a, b) => a.rise - b.rise);
  const seen = new Set();
  const out = [];
  for (const l of arr) {
    if (seen.has(l.rise)) continue;
    seen.add(l.rise);
    out.push(l);
    if (out.length >= MAX_BT_SELL_LEVELS) break;
  }
  return out;
}
/** 앵커 축 단계 정규화 — 빈 배열 보존(기본값 복원 금지) + 오름차순 + 중복 제거 + 상한. */
function normalizeAnchorLevels(raw) {
  const arr = asArr(raw).map((l) => ({ move: asNum(l?.move, NaN) }))
    .filter((l) => Number.isFinite(l.move) && l.move > 0 && l.move <= 1000);
  arr.sort((a, b) => a.move - b.move);
  const seen = new Set(); const out = [];
  for (const l of arr) { if (seen.has(l.move)) continue; seen.add(l.move); out.push(l); if (out.length >= MAX_BT_ANCHOR_LEVELS) break; }
  return out;
}
function normalizeDip(raw) {
  return {
    enabled: !!raw?.enabled,
    levels: normalizeDipLevels(raw?.levels),
    sellLevels: normalizeSellLevels(raw?.sellLevels),
    reallocate: raw?.reallocate !== false,
    extremeOn: raw?.extremeOn !== false,
    anchorLevels: normalizeAnchorLevels(raw?.anchorLevels),
    anchorSellLevels: normalizeAnchorLevels(raw?.anchorSellLevels),
    anchorSource: raw?.anchorSource === 'lastRebal' ? 'lastRebal' : 'lastFill',
  };
}
function normalizeAnnualReview(raw) {
  const m = raw?.mode, s = raw?.split;
  return {
    mode: m === 'pctOfSurplus' ? 'pctOfSurplus' : 'none',
    value: Math.max(0, asNum(raw?.value, 0)),
    reserve: Math.max(0, asNum(raw?.reserve, 0)),
    everyMonths: clampInt(asNum(raw?.everyMonths, 12), 1, 120),
    split: s === 'even' ? 'even' : 'ratio',
  };
}
function normalizeContribution(raw) {
  const m = raw?.mode, sp = raw?.split;
  return { mode: CONTRIB_MODES.includes(m) ? m : 'none', value: Math.max(0, asNum(raw?.value, 0)), split: sp === 'even' ? 'even' : 'ratio' };
}
function normalizeContribOverride(raw) {
  const ym = asStr(raw?.ym);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const m = raw?.mode;
  return { id: asStr(raw?.id) || generateId(), ym, mode: CONTRIB_MODES.includes(m) ? m : 'none', value: Math.max(0, asNum(raw?.value, 0)) };
}
const RATINGS = ['good', 'watch', 'bad', 'none'];
const cut = (v, max) => { const s = asStr(v); return s.length > max ? s.slice(0, max) : s; };
function normalizeReview(raw) {
  const r = raw?.rating;
  return {
    rating: RATINGS.includes(r) ? r : 'none',
    verdict: cut(raw?.verdict, MAX_BT_VERDICT_LEN),
    updatedAt: asNum(raw?.updatedAt, 0),
  };
}
function normalizeNoteSnapshot(raw) {
  return {
    conditions: cut(raw?.conditions, 400),
    fp: asStr(raw?.fp),
    finalTotal: asNumOrNull(raw?.finalTotal),
    profit: asNumOrNull(raw?.profit),
    profitRate: asNumOrNull(raw?.profitRate),
    period: cut(raw?.period, 40),
  };
}
function normalizeNote(raw) {
  const k = raw?.kind;
  const ts = asNum(raw?.createdAt, 0);
  return {
    id: asStr(raw?.id) || generateId(),
    kind: k === 'user' ? 'user' : 'ai',
    title: cut(raw?.title, MAX_BT_NOTE_TITLE_LEN),
    body: cut(raw?.body, MAX_BT_NOTE_LEN),
    snapshot: normalizeNoteSnapshot(raw?.snapshot),
    createdAt: ts,
    updatedAt: asNum(raw?.updatedAt, ts),
  };
}
function makeBtAsset(partial = {}, idx = 0) {
  const cycle = partial.payCycle;
  const rm = partial.rebalMode;
  return {
    id: partial.id || generateId(),
    code: asStr(partial.code).trim().toUpperCase(),
    name: asStr(partial.name),
    payCycle: cycle === 'mid' || cycle === 'eom' || cycle === 'none' ? cycle : 'eom',
    rebalMode: REBAL_MODES.includes(rm) ? rm : 'follow',
    rebalDay: clampInt(asNum(partial.rebalDay, 15), 1, 31),
    rebalDates: Array.from(new Set(asArr(partial.rebalDates).filter(isIsoDate))).sort().slice(0, MAX_BT_REBAL_DATES),
    targetAmount: asNumOrNull(partial.targetAmount),
    targetRatio: asNumOrNull(partial.targetRatio),
    startDate: isIsoDate(partial.startDate) ? partial.startDate : '',
    endDate: isIsoDate(partial.endDate) ? partial.endDate : '',
    divOverride: normalizeDivOverride(partial.divOverride),
    color: asStr(partial.color) || BT_COLORS[idx % BT_COLORS.length],
  };
}
function normalizeEvent(raw) {
  const f = raw?.funding;
  return {
    id: asStr(raw?.id) || generateId(),
    date: isIsoDate(raw?.date) ? raw.date : '',
    label: asStr(raw?.label),
    funding: f === 'cash' || f === 'defer' ? f : 'reallocate',
    addAssets: asArr(raw?.addAssets).map(asStr).filter(Boolean),
    removeAssets: asArr(raw?.removeAssets).map(asStr).filter(Boolean),
    targets: asArr(raw?.targets)
      .map((t) => ({ assetId: asStr(t?.assetId), amount: asNumOrNull(t?.amount), ratio: asNumOrNull(t?.ratio) }))
      .filter((t) => !!t.assetId),
  };
}
function normalizeOverride(raw) {
  const ym = asStr(raw?.ym);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  if (!isIsoDate(raw?.date)) return null;
  const g = raw?.group;
  return {
    id: asStr(raw?.id) || generateId(),
    ym, group: g === 'mid' || g === 'all' ? g : g === 'eom' ? 'eom' : 'all', date: raw.date, assetId: asStr(raw?.assetId),
  };
}
/** 전역 지정일 정규화 — 빈 배열 보존(기본값 복원 금지) + dedupe + 정렬 + 상한. */
function normalizeRebalDates(raw) {
  return Array.from(new Set(asArr(raw).filter(isIsoDate))).sort().slice(0, MAX_BT_REBAL_DATES);
}

function makeBtConfig(partial = {}) {
  const ts = 1000;
  const policy = partial.policy, mode = partial.targetMode, rounding = partial.rounding;
  const reinv = partial.divReinvest, divSplit = partial.divReinvestSplit;
  return {
    id: partial.id || generateId(),
    name: asStr(partial.name) || '백테스트',
    startDate: isIsoDate(partial.startDate) ? partial.startDate : '',
    endDate: isIsoDate(partial.endDate) ? partial.endDate : '',
    initialCapital: Math.max(0, asNum(partial.initialCapital, 0)),
    extraCash: Math.max(0, asNum(partial.extraCash, 0)),
    targetMode: mode === 'ratio' ? 'ratio' : 'amount',
    rounding: rounding === 'round' || rounding === 'exact' ? rounding : 'floor',
    regularOn: partial.regularOn !== false,
    policy: policy === 'allMid' || policy === 'allEom' || policy === 'fixedDay' || policy === 'none' ? policy : 'perCycle',
    fixedDay: clampInt(asNum(partial.fixedDay, 15), 1, 31),
    rebalDates: normalizeRebalDates(partial.rebalDates),
    exDivOffset: clampInt(asNum(partial.exDivOffset, -1), -10, 0),
    rebalOffset: clampInt(asNum(partial.rebalOffset, -1), -10, 0),
    payOffset: clampInt(asNum(partial.payOffset, 2), 0, 10),
    allowNegativeCash: !!partial.allowNegativeCash,
    divReinvest: reinv === 'payDate' || reinv === 'mid' || reinv === 'eom' ? reinv : 'hold',
    divReinvestSplit: divSplit === 'source' || divSplit === 'even' ? divSplit : 'target',
    compareOn: partial.compareOn !== false,
    contribution: normalizeContribution(partial.contribution),
    contribOverrides: asArr(partial.contribOverrides).slice(0, MAX_BT_CONTRIB_OVERRIDES).map(normalizeContribOverride).filter(Boolean),
    band: Math.max(0, asNum(partial.band, 0)),
    buyFunding: partial.buyFunding === 'tradeOnly' ? 'tradeOnly' : 'both',
    dip: normalizeDip(partial.dip),
    cashFloorPct: Math.max(0, asNum(partial.cashFloorPct, 0)),
    annualReview: normalizeAnnualReview(partial.annualReview),
    divTaxPct: Math.min(100, Math.max(0, asNum(partial.divTaxPct, 0))),
    review: normalizeReview(partial.review),
    notes: asArr(partial.notes).slice(0, MAX_BT_NOTES).map(normalizeNote),
    assets: asArr(partial.assets).slice(0, MAX_BT_ASSETS).map((a, i) => makeBtAsset(a, i)),
    events: asArr(partial.events).slice(0, MAX_BT_EVENTS).map(normalizeEvent),
    overrides: asArr(partial.overrides).slice(0, MAX_BT_OVERRIDES).map(normalizeOverride).filter(Boolean),
    createdAt: asNum(partial.createdAt, ts),
    updatedAt: asNum(partial.updatedAt, ts),
  };
}

function backtestScenariosHaveContent(scenarios) {
  if (!Array.isArray(scenarios)) return false;
  return scenarios.some((s) => !!s && (
    asArr(s.assets).length > 0 || asArr(s.events).length > 0 || asArr(s.overrides).length > 0
    || !!asStr(s.review?.verdict).trim()
    || (s.review?.rating && s.review.rating !== 'none')
    || asArr(s.notes).some((n) => !!(asStr(n?.title).trim() || asStr(n?.body).trim()))
  ));
}

// ⚠️ '같은 저장값의 뜻이 바뀐' 릴리스에서만 올린다(src/backtest.ts 주석 참조).
const SETTINGS_FP_SCHEMA = 2;
function backtestSettingsFingerprint(cfg) {
  try {
    const s = cfg;
    if (!s || typeof s !== 'object') return '';
    return JSON.stringify({
      v: SETTINGS_FP_SCHEMA,
      p: [s.startDate ?? '', s.endDate ?? '', s.initialCapital ?? 0, s.extraCash ?? 0,
          s.targetMode ?? '', s.rounding ?? '', s.policy ?? '', s.regularOn === false ? 0 : 1,
          s.fixedDay ?? 0, s.exDivOffset ?? 0, s.rebalOffset ?? 0, s.payOffset ?? 0,
          asArr(s.rebalDates).join(','),
          s.allowNegativeCash ? 1 : 0,
          s.divReinvest ?? '', s.divReinvestSplit ?? '',
          s.contribution?.mode ?? '', s.contribution?.value ?? 0, s.contribution?.split ?? '',
          s.band ?? 0, s.buyFunding ?? '', s.cashFloorPct ?? 0, s.divTaxPct ?? 0,
          s.dip?.enabled ? 1 : 0,
          asArr(s.dip?.levels).map((l) => `${l?.drop ?? ''}:${l?.buyPct ?? ''}`).join(','),
          asArr(s.dip?.sellLevels).map((l) => `${l?.rise ?? ''}:${l?.sellPct ?? ''}`).join(','),
          s.dip?.reallocate === false ? 0 : 1,
          s.dip?.extremeOn === false ? 0 : 1, s.dip?.anchorSource ?? '',
          asArr(s.dip?.anchorLevels).map((l) => `${l?.move ?? ''}`).join(','),
          asArr(s.dip?.anchorSellLevels).map((l) => `${l?.move ?? ''}`).join(','),
          s.annualReview?.mode ?? '', s.annualReview?.value ?? 0, s.annualReview?.reserve ?? 0,
          s.annualReview?.everyMonths ?? 0, s.annualReview?.split ?? ''],
      c: asArr(s.contribOverrides).map((o) => [o?.ym ?? '', o?.mode ?? '', o?.value ?? 0]),
      a: asArr(s.assets).map((a) => [
        a?.id ?? '', a?.code ?? '', a?.payCycle ?? '',
        a?.targetAmount ?? null, a?.targetRatio ?? null, a?.startDate ?? '', a?.endDate ?? '',
        a?.rebalMode ?? '', a?.rebalDay ?? 0, asArr(a?.rebalDates).join(','),
        Object.keys(a?.divOverride ?? {}).sort().map((k) => `${k}:${a.divOverride[k]}`).join(','),
      ]),
      e: asArr(s.events).map((e) => [
        e?.date ?? '', e?.funding ?? '',
        asArr(e?.addAssets).join(','), asArr(e?.removeAssets).join(','),
        asArr(e?.targets).map((t) => `${t?.assetId ?? ''}:${t?.amount ?? ''}:${t?.ratio ?? ''}`).join('|'),
      ]),
      o: asArr(s.overrides).map((o) => [o?.ym ?? '', o?.group ?? '', o?.date ?? '', o?.assetId ?? '']),
    });
  } catch { return 'ERR'; }
}

function backtestFingerprint(scenarios) {
  try {
    if (!Array.isArray(scenarios)) return '';
    return JSON.stringify(scenarios.map((s) => ({
      i: s?.id ?? '', n: s?.name ?? '',
      p: [s?.startDate ?? '', s?.endDate ?? '', s?.initialCapital ?? 0, s?.extraCash ?? 0,
          s?.targetMode ?? '', s?.rounding ?? '', s?.policy ?? '', s?.regularOn === false ? 0 : 1,
          s?.fixedDay ?? 0, s?.exDivOffset ?? 0, s?.rebalOffset ?? 0, s?.payOffset ?? 0,
          asArr(s?.rebalDates).join(','),
          s?.allowNegativeCash ? 1 : 0,
          s?.divReinvest ?? '', s?.divReinvestSplit ?? '',
          s?.compareOn === false ? 0 : 1,
          s?.contribution?.mode ?? '', s?.contribution?.value ?? 0, s?.contribution?.split ?? '',
          s?.band ?? 0, s?.buyFunding ?? '', s?.cashFloorPct ?? 0, s?.divTaxPct ?? 0,
          s?.dip?.enabled ? 1 : 0,
          asArr(s?.dip?.levels).map((l) => `${l?.drop ?? ''}:${l?.buyPct ?? ''}`).join(','),
          asArr(s?.dip?.sellLevels).map((l) => `${l?.rise ?? ''}:${l?.sellPct ?? ''}`).join(','),
          s?.dip?.reallocate === false ? 0 : 1,
          s?.dip?.extremeOn === false ? 0 : 1, s?.dip?.anchorSource ?? '',
          asArr(s?.dip?.anchorLevels).map((l) => `${l?.move ?? ''}`).join(','),
          asArr(s?.dip?.anchorSellLevels).map((l) => `${l?.move ?? ''}`).join(','),
          s?.annualReview?.mode ?? '', s?.annualReview?.value ?? 0, s?.annualReview?.reserve ?? 0,
          s?.annualReview?.everyMonths ?? 0, s?.annualReview?.split ?? '',
          s?.review?.rating ?? '', s?.review?.verdict ?? ''],
      m: asArr(s?.notes).map((n) => [
        n?.id ?? '', n?.kind ?? '', n?.title ?? '', n?.body ?? '', n?.snapshot?.fp ?? '',
        n?.snapshot?.conditions ?? '', n?.snapshot?.period ?? '',
        n?.snapshot?.finalTotal ?? null, n?.snapshot?.profit ?? null, n?.snapshot?.profitRate ?? null,
      ]),
      c: asArr(s?.contribOverrides).map((o) => [o?.id ?? '', o?.ym ?? '', o?.mode ?? '', o?.value ?? 0]),
      a: asArr(s?.assets).map((a) => [
        a?.id ?? '', a?.code ?? '', a?.name ?? '', a?.payCycle ?? '',
        a?.targetAmount ?? null, a?.targetRatio ?? null, a?.startDate ?? '', a?.endDate ?? '', a?.color ?? '',
        a?.rebalMode ?? '', a?.rebalDay ?? 0, asArr(a?.rebalDates).join(','),
        Object.keys(a?.divOverride ?? {}).sort().map((k) => `${k}:${a.divOverride[k]}`).join(','),
      ]),
      e: asArr(s?.events).map((e) => [
        e?.id ?? '', e?.date ?? '', e?.label ?? '', e?.funding ?? '',
        asArr(e?.addAssets).join(','), asArr(e?.removeAssets).join(','),
        asArr(e?.targets).map((t) => `${t?.assetId ?? ''}:${t?.amount ?? ''}:${t?.ratio ?? ''}`).join('|'),
      ]),
      o: asArr(s?.overrides).map((o) => [o?.id ?? '', o?.ym ?? '', o?.group ?? '', o?.date ?? '', o?.assetId ?? '']),
    })));
  } catch { return 'ERR'; }
}

function normalizeBacktestScenarios(raw) {
  if (!Array.isArray(raw)) return [];
  const sliced = raw.length > MAX_BT_SCENARIOS ? raw.slice(0, MAX_BT_SCENARIOS) : raw;
  let changed = sliced !== raw;
  const seen = new Set();
  const out = [];
  for (const s of sliced) {
    if (!s || typeof s !== 'object') { changed = true; continue; }
    const fixed = makeBtConfig(s);
    if (!fixed.id || seen.has(fixed.id)) { fixed.id = generateId(); changed = true; }
    seen.add(fixed.id);
    if (backtestFingerprint([s]) !== backtestFingerprint([fixed])) changed = true;
    out.push(fixed);
  }
  return changed ? out : raw;
}

function resolveAssetRebal(asset, config) {
  const rm = asset.rebalMode || 'follow';
  if (rm !== 'follow') return { mode: rm, day: clampInt(asNum(asset.rebalDay, 15), 1, 31), follows: false };
  // ⚠️ 정기 스위치가 꺼지면 policy를 보존한 채 정기 일정만 멈춘다(policy:'none'과 동치).
  if (config.regularOn === false) return { mode: 'none', day: 0, follows: true };
  switch (config.policy) {
    case 'allMid': return { mode: 'mid', day: 0, follows: true };
    case 'allEom': return { mode: 'eom', day: 0, follows: true };
    case 'fixedDay': return { mode: 'day', day: clampInt(config.fixedDay, 1, 31), follows: true };
    case 'none': return { mode: 'none', day: 0, follows: true };
    default: return { mode: asset.payCycle === 'mid' ? 'mid' : 'eom', day: 0, follows: true };
  }
}
function groupOfFollow(config, asset) {
  if (config.policy !== 'perCycle') return 'all';
  return asset.payCycle === 'mid' ? 'mid' : 'eom';
}

function buildSlots(config, holidays) {
  const out = [];
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return out;
  const groupOv = new Map();
  const assetOv = new Map();
  for (const o of config.overrides) {
    if (o.assetId) assetOv.set(`${o.ym}|${o.assetId}`, o);
    else groupOv.set(`${o.ym}|${o.group}`, o);
  }
  for (const ym of monthsBetween(config.startDate, config.endDate)) {
    const byKey = new Map();
    const add = (date, group, cycle, overridden, assetId) => {
      if (!isIsoDate(date)) return;
      const cur = byKey.get(date);
      if (cur) {
        if (!cur.assetIds.includes(assetId)) cur.assetIds.push(assetId);
        if (cycle && !cur.cycle) cur.cycle = cycle;
        if (overridden) cur.overridden = true;
        cur.groups.add(group);
      } else {
        byKey.set(date, { date, group, cycle, overridden, assetIds: [assetId], groups: new Set([group]) });
      }
    };
    for (const a of config.assets) {
      const r = resolveAssetRebal(a, config);
      const group = r.follows ? groupOfFollow(config, a) : 'all';
      const labelCycle = a.payCycle === 'mid' ? 'mid' : 'eom';
      // 전역 지정일 — 정기 정책에 **추가**되는 축이라 아래 두 continue보다 앞. follow 종목에만.
      if (r.follows) {
        for (const raw of config.rebalDates) {
          if (ymOf(raw) !== ym) continue;
          add(onOrBeforeBusinessDay(raw, holidays), group, labelCycle, false, a.id);
        }
      }
      const ao = assetOv.get(`${ym}|${a.id}`);
      if (ao) { add(onOrBeforeBusinessDay(ao.date, holidays), group, labelCycle, true, a.id); continue; }
      if (r.mode === 'none') continue;
      if (r.mode === 'dates') {
        for (const raw of a.rebalDates) {
          if (ymOf(raw) !== ym) continue;
          add(onOrBeforeBusinessDay(raw, holidays), group, labelCycle, false, a.id);
        }
        continue;
      }
      const go = r.follows ? groupOv.get(`${ym}|${group}`) : undefined;
      if (r.mode === 'day') {
        const raw = `${ym}-${pad2(clampInt(r.day, 1, 31))}`;
        const capped = isIsoDate(raw) ? raw : lastDayOfMonth(ym);
        const d = go ? onOrBeforeBusinessDay(go.date, holidays) : onOrBeforeBusinessDay(capped, holidays);
        add(d, group, labelCycle, !!go, a.id);
        continue;
      }
      const cycle = r.mode;
      const recordDate = recordDateFor(ym, cycle, holidays);
      if (!recordDate) continue;
      const exDate = shiftBusinessDays(recordDate, config.exDivOffset, holidays);
      const d = go ? onOrBeforeBusinessDay(go.date, holidays) : shiftBusinessDays(exDate, config.rebalOffset, holidays);
      add(d, group, cycle, !!go, a.id);
    }
    for (const v of byKey.values()) {
      if (v.date < config.startDate || v.date > config.endDate) continue;
      const cycle = v.cycle ?? 'eom';
      const recordDate = recordDateFor(ym, cycle, holidays);
      out.push({
        ym, group: v.groups.size > 1 ? 'all' : v.group, recordDate,
        exDate: shiftBusinessDays(recordDate, config.exDivOffset, holidays),
        payDate: shiftBusinessDays(recordDate, config.payOffset, holidays),
        rebalDate: v.date, overridden: v.overridden, assetIds: v.assetIds,
      });
    }
  }
  out.sort((a, b) => (a.rebalDate < b.rebalDate ? -1 : a.rebalDate > b.rebalDate ? 1 : 0));
  return out;
}

function buildDividendSlots(config, holidays) {
  const out = [];
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return out;
  const byCycle = {
    mid: config.assets.filter((a) => a.payCycle === 'mid').map((a) => a.id),
    eom: config.assets.filter((a) => a.payCycle === 'eom').map((a) => a.id),
  };
  for (const ym of monthsBetween(config.startDate, config.endDate)) {
    for (const cycle of ['mid', 'eom']) {
      if (!byCycle[cycle].length) continue;
      const recordDate = recordDateFor(ym, cycle, holidays);
      if (!recordDate) continue;
      const exDate = shiftBusinessDays(recordDate, config.exDivOffset, holidays);
      const payDate = shiftBusinessDays(recordDate, config.payOffset, holidays);
      if (exDate < config.startDate || exDate > config.endDate) continue;
      out.push({ ym, cycle, recordDate, exDate, payDate, assetIds: byCycle[cycle] });
    }
  }
  out.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
  return out;
}

function buildReinvestSlots(config, holidays) {
  const out = [];
  const mode = config.divReinvest;
  if (mode !== 'payDate' && mode !== 'mid' && mode !== 'eom') return out;
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return out;
  const seen = new Set();
  const add = (ym, date, label) => {
    if (!isIsoDate(date)) return;
    if (date < config.startDate || date > config.endDate) return;
    if (seen.has(date)) return;
    seen.add(date);
    out.push({ ym, date, label });
  };
  if (mode === 'payDate') {
    for (const d of buildDividendSlots(config, holidays)) add(ymOf(d.payDate), d.payDate, 'pay');
  } else {
    const cycle = mode === 'mid' ? 'mid' : 'eom';
    for (const ym of monthsBetween(config.startDate, config.endDate)) {
      const recordDate = recordDateFor(ym, cycle, holidays);
      if (!recordDate) continue;
      const exDate = shiftBusinessDays(recordDate, config.exDivOffset, holidays);
      add(ym, shiftBusinessDays(exDate, config.rebalOffset, holidays), cycle);
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

function joinTradeDividends(trades, dividends) {
  const used = new Set();
  const rows = trades.map((trade) => {
    let best = null;
    for (const d of dividends) {
      if (used.has(d)) continue;
      if (d.assetId !== trade.assetId) continue;
      if (d.exDate < trade.date) continue;
      if (!best || d.exDate < best.exDate) best = d;
    }
    if (best) used.add(best);
    return { trade, dividend: best };
  });
  return { rows, orphans: dividends.filter((d) => !used.has(d)) };
}

function targetOf(pos, config, base) {
  if (config.targetMode === 'amount') return Math.max(0, pos.targetAmount ?? 0);
  const r = pos.targetRatio ?? 0;
  return Math.max(0, (base * r) / 100);
}

function runBacktest(input) {
  const { config, prices, dividends } = input;
  const holidays = new Set(Array.isArray(input.holidays) ? input.holidays : []);
  const warnings = [];
  const empty = (fatal) => ({
    ok: false, fatal, warnings, slots: [], assetMeta: [], initialDate: '', initialTrades: [],
    initialCashAfter: 0, months: [], curve: [], finalHoldings: [],
    annualRows: [],
    summary: { startDate: config.startDate, endDate: config.endDate, initialCapital: config.initialCapital,
      finalEval: 0, finalCash: 0, finalTotal: 0, profit: 0, profitRate: 0,
      cumTradeNet: 0, cumStructuralNet: 0, cumReinvestNet: 0, cumDivAccrued: 0, cumDivPaid: 0, cumDivTax: 0,
      cumContribution: 0, cumAnnualReview: 0, finalCashTrade: 0, finalCashDiv: 0, finalCashReserve: 0, cumDivDrawn: 0, cumReserveDrawn: 0, maxDrawdown: 0, months: 0,
      minCash: { value: 0, date: '' }, minCashDiv: { value: 0, date: '' },
      divMonthlyAvg: 0, divMonthlyStdev: 0,
      bandSkipCount: 0, bandSkipAmount: 0, signalEvents: [], shortfallMonths: 0 },
  });
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return empty('기간(시작일·종료일)을 선택해 주세요.');
  if (config.startDate > config.endDate) return empty('시작일이 종료일보다 늦습니다.');
  if (!config.assets.length) return empty('백테스트할 종목을 1개 이상 추가해 주세요.');
  if (config.initialCapital <= 0) return empty('초기 투자금을 입력해 주세요.');

  const startBiz = onOrAfterBusinessDay(config.startDate, holidays);
  const endBiz = onOrBeforeBusinessDay(config.endDate, holidays);
  if (startBiz > endBiz) return empty('선택한 기간에 영업일이 없습니다.');
  const allBiz = businessDaysBetween(startBiz, endBiz, holidays);
  if (!allBiz.length) return empty('선택한 기간에 영업일이 없습니다.');

  const assetMeta = [];
  const positions = [];
  for (const a of config.assets) {
    const series = prices[a.code];
    const { first, last } = seriesRange(series);
    let daysInRange = 0, gapCount = 0, inGap = false;
    for (const d of allBiz) {
      const v = series?.[d];
      const has = typeof v === 'number' && Number.isFinite(v) && v > 0;
      if (has) { daysInRange++; inGap = false; }
      else if (first && d >= first && d <= last) { if (!inGap) gapCount++; inGap = true; }
    }
    const userStart = a.startDate && a.startDate > startBiz ? a.startDate : '';
    const dataStart = first && first > startBiz ? first : '';
    const rawStart = userStart && dataStart ? (userStart > dataStart ? userStart : dataStart) : (userStart || dataStart || startBiz);
    const effectiveStart = onOrAfterBusinessDay(rawStart, holidays);
    const effectiveEnd = a.endDate && a.endDate < endBiz ? onOrBeforeBusinessDay(a.endDate, holidays) : endBiz;
    assetMeta.push({ assetId: a.id, code: a.code, name: a.name, firstDate: first, lastDate: last,
      daysInRange, businessDaysInRange: allBiz.length, lateStart: !!first && first > startBiz,
      earlyEnd: !!last && last < endBiz, effectiveStart, gapCount });
    if (!first) warnings.push(`${a.name || a.code}: 종가 데이터가 없어 백테스트에서 제외됩니다.`);
    else if (first > startBiz) warnings.push(`${a.name || a.code}: 종가 기록이 ${first}부터 있어 그날부터 편입됩니다.`);
    if (last && last < endBiz) warnings.push(`${a.name || a.code}: 종가 기록이 ${last}에서 끊겨 이후는 마지막 종가로 이월됩니다.`);
    if (gapCount > 0) warnings.push(`${a.name || a.code}: 기간 안에 종가 결측 구간이 ${gapCount}곳 있어 직전 종가로 이월됩니다.`);
    positions.push({ asset: a, qty: 0, active: false, removed: false, targetAmount: a.targetAmount, targetRatio: a.targetRatio, effectiveStart, effectiveEnd });
  }
  const posById = new Map(positions.map((p) => [p.asset.id, p]));
  const usable = positions.filter((p) => !!prices[p.asset.code] && seriesRange(prices[p.asset.code]).count > 0);
  if (!usable.length) return empty('선택한 종목 중 종가 데이터가 있는 종목이 없습니다. 종목을 조회하거나 데이터를 붙여넣어 주세요.');

  const divTaxRate = Math.min(1, Math.max(0, config.divTaxPct / 100)) || 0;

  let cash = config.initialCapital + config.extraCash;
  let cashTrade = config.initialCapital;
  let cashReserve = config.extraCash;
  let cashDiv = 0;
  const bucketLog = [];
  const logBuckets = (date) => {
    const last = bucketLog[bucketLog.length - 1];
    if (last && last.date === date) { last.t = cashTrade; last.d = cashDiv; last.r = cashReserve; return; }
    bucketLog.push({ date, t: cashTrade, d: cashDiv, r: cashReserve });
  };
  const drawByYm = new Map();
  const divPocket = new Map();
  const drainPocket = (x) => {
    if (!(x > 0)) return;
    let total = 0;
    for (const v of divPocket.values()) total += v;
    if (!(total > 0)) { divPocket.clear(); return; }
    const keep = Math.max(0, 1 - x / total);
    if (keep <= 0) { divPocket.clear(); return; }
    for (const [k, v] of divPocket) divPocket.set(k, v * keep);
  };
  let lastDraw = { fromTrade: 0, fromDiv: 0, fromReserve: 0 };
  const applyCash = (delta, date, prefer = 'trade', divCap = Infinity, reserveCap = 0) => {
    cash += delta;
    if (delta >= 0) { cashTrade += delta; lastDraw = { fromTrade: 0, fromDiv: 0, fromReserve: 0 }; logBuckets(date); return; }
    let need = -delta;
    let fromTrade = 0;
    let fromDiv = 0;
    let fromReserve = 0;
    const divRoom = Math.max(0, Math.min(cashDiv, divCap));
    const reserveRoom = Math.max(0, Math.min(cashReserve, reserveCap));
    const takeTrade = () => { const x = Math.max(0, Math.min(cashTrade, need)); if (x > 0) { fromTrade += x; cashTrade -= x; need -= x; } };
    const takeDiv = () => { const x = Math.max(0, Math.min(divRoom, need)); if (x > 0) { fromDiv += x; cashDiv -= x; drainPocket(x); need -= x; } };
    const takeReserve = () => { const x = Math.max(0, Math.min(reserveRoom, need)); if (x > 0) { fromReserve += x; cashReserve -= x; need -= x; } };
    // ⚠️ 인출 순서는 매매 → 예비금 → 분배금. 재투자 경로(prefer==='div')는 예비금에 닿지 않는다.
    if (prefer === 'div') { takeDiv(); takeTrade(); }
    else { takeTrade(); takeReserve(); takeDiv(); }
    if (need > 0) cashTrade -= need;
    lastDraw = { fromTrade: fromTrade + need, fromDiv, fromReserve };
    const ym = ymOf(date);
    if (ym) {
      const cur = drawByYm.get(ym);
      if (cur) { cur.fromTrade += fromTrade + need; cur.fromDiv += fromDiv; cur.fromReserve += fromReserve; }
      else drawByYm.set(ym, { fromTrade: fromTrade + need, fromDiv, fromReserve });
    }
    logBuckets(date);
  };
  let firstDivDate = '';
  const applyDividend = (amount, date, assetId) => {
    cash += amount;
    cashDiv += amount;
    if (amount > 0 && !firstDivDate) firstDivDate = date;
    if (assetId && amount > 0) divPocket.set(assetId, (divPocket.get(assetId) ?? 0) + amount);
    logBuckets(date);
  };
  const totalEvalAt = (date) => {
    let s = 0;
    for (const p of positions) { if (p.qty > QTY_EPS) { const h = priceAt(prices[p.asset.code], date); if (!h.missing) s += p.qty * h.price; } }
    return s;
  };
  const targetBaseAt = (date) => {
    const eq = totalEvalAt(date);
    return eq > 0 ? eq : Math.max(0, cash - cashReserve);
  };
  const activeTargetSum = (date, base) => {
    let s = 0;
    for (const p of positions) {
      if (!p.active || p.removed) continue;
      if (date < p.effectiveStart || date > p.effectiveEnd) continue;
      s += targetOf(p, config, base);
    }
    return s;
  };
  // 시그널 리밸런싱은 발동일 종가로 즉시 체결하므로 회차를 넘겨 들고 다니는 상태가 없다.
  const signalEvents = [];
  const anchorLevels = config.dip.enabled ? normalizeAnchorLevels(config.dip.anchorLevels) : [];
  const anchorSellLevels = config.dip.enabled ? normalizeAnchorLevels(config.dip.anchorSellLevels) : [];
  const anchorOn = anchorLevels.length > 0 || anchorSellLevels.length > 0;
  const anchorSrc = config.dip.anchorSource === 'lastRebal' ? 'lastRebal' : 'lastFill';
  const anchorPx = new Map();
  const anchorDateOf = new Map();
  const firedAnchorBuy = new Map();
  const firedAnchorSell = new Map();
  // ⚠️ 재투자·재조정·구조변경은 앵커를 옮기지 않는다(사용자가 지명한 사건은 리밸런싱·시그널 둘뿐).
  const touchAnchor = (t) => {
    if (!anchorOn) return;
    if (t.reinvest || t.structural) return;
    if (t.signal === 'realloc') return;
    if (anchorSrc === 'lastRebal' && (t.signal === 'buy' || t.signal === 'sell')) return;
    if (!(t.price > 0)) return;
    if (anchorPx.get(t.assetId) === t.price) return;
    anchorPx.set(t.assetId, t.price);
    anchorDateOf.set(t.assetId, t.date);
    firedAnchorBuy.get(t.assetId)?.clear();
    firedAnchorSell.get(t.assetId)?.clear();
  };
  const deployableCash = (date) => {
    let cap = config.buyFunding === 'tradeOnly' ? Math.max(0, cashTrade) : Math.max(0, cash - cashReserve);
    if (config.cashFloorPct > 0) {
      const fl = (activeTargetSum(date, targetBaseAt(date)) * config.cashFloorPct) / 100;
      cap = Math.min(cap, Math.max(0, cash - cashReserve - fl));
    }
    return cap;
  };
  const shortfallByYm = new Map();
  const RATIO_SUM_TOL = 0.05;
  let ratioSumWarned = false;
  const checkRatioSum = (date) => {
    if (config.targetMode !== 'ratio' || ratioSumWarned) return;
    const live = positions.filter(
      (p) => p.active && !p.removed && date >= p.effectiveStart && date <= p.effectiveEnd,
    );
    if (!live.length) return;
    const sum = live.reduce((s, p) => s + Math.max(0, p.targetRatio ?? 0), 0);
    if (!(sum > 0)) {
      ratioSumWarned = true;
      warnings.push(
        '목표 비중이 전부 0%라 아무것도 사지 않습니다 — ⑥ 종목에서 종목별 목표 비중을 입력하세요'
        + '(목표 금액 모드에서 전환했다면 비중 칸이 비어 있습니다).',
      );
      return;
    }
    if (Math.abs(sum - 100) > RATIO_SUM_TOL) {
      ratioSumWarned = true;
      const scope = live.length < positions.length ? ` ${date} 기준 편입된 ${live.length}/${positions.length}종목의 합입니다.` : '';
      warnings.push(
        `목표 비중 합이 ${Math.round(sum * 100) / 100}%입니다(100% 아님).${scope} 분모가 ‘종목 평가액 합계’라 `
        + '리밸런싱마다 그 차이만큼 사고팝니다 — 100%보다 작으면 매번 팔아 현금이 쌓이고(평가액이 계속 줄어듭니다), '
        + '크면 예수금을 헐어 더 삽니다.',
      );
    }
  };
  const adjustTo = (p, date, target, structural, opts) => {
    const hit = priceAt(prices[p.asset.code], date);
    if (hit.missing || hit.price <= 0) return null;
    const evalBefore = p.qty * hit.price;
    let qty = roundQty((target - evalBefore) / hit.price, config.rounding);
    let note = '';
    if (qty < 0 && -qty > p.qty) { qty = -p.qty; note = '보유수량 한도'; }
    if (qty > 0) {
      const rawBudget = opts?.budget ?? (cash - cashReserve);
      const floorCap = opts?.floorCap ?? Infinity;
      const budget = Math.min(rawBudget, floorCap);
      const limited = !config.allowNegativeCash || floorCap < Infinity;
      if (limited) {
        const cost = qty * hit.price;
        if (cost > budget) {
          const afford = roundQty(budget / hit.price, config.rounding === 'exact' ? 'exact' : 'floor');
          if (afford < qty) {
            qty = Math.max(0, afford);
            note = budget === floorCap && floorCap < rawBudget ? '바닥선' : '예수금 부족';
            const sym = ymOf(date);
            if (sym) shortfallByYm.set(sym, (shortfallByYm.get(sym) ?? 0) + 1);
          }
        }
      }
    }
    if (p.qty + qty !== 0 && Math.abs(p.qty + qty) < QTY_EPS) qty = -p.qty;
    if (qty === 0) return null;
    const cashDelta = -qty * hit.price;
    applyCash(cashDelta, date, 'trade', opts?.divCap ?? Infinity, opts?.reserveCap ?? 0);
    const qtyBefore = p.qty;
    p.qty += qty;
    return { date, assetId: p.asset.id, code: p.asset.code, name: p.asset.name, price: hit.price,
      priceExact: hit.exact, qtyBefore, evalBefore, target, qty, cashDelta,
      qtyAfter: p.qty, evalAfter: p.qty * hit.price, structural, reinvest: false, note };
  };

  const buyWithBudget = (p, date, budget) => {
    if (!(budget > 0)) return null;
    const hit = priceAt(prices[p.asset.code], date);
    if (hit.missing || hit.price <= 0) return null;
    const floorMode = config.rounding === 'exact' ? 'exact' : 'floor';
    let qty = roundQty(budget / hit.price, floorMode);
    if (!(qty > 0)) return null;
    if (!config.allowNegativeCash && qty * hit.price > cash - cashReserve) {
      qty = roundQty((cash - cashReserve) / hit.price, floorMode);
      if (!(qty > 0)) return null;
    }
    const evalBefore = p.qty * hit.price;
    const cashDelta = -qty * hit.price;
    applyCash(cashDelta, date, 'div');
    const qtyBefore = p.qty;
    p.qty += qty;
    return { date, assetId: p.asset.id, code: p.asset.code, name: p.asset.name, price: hit.price,
      priceExact: hit.exact, qtyBefore, evalBefore, target: evalBefore + budget, qty, cashDelta,
      qtyAfter: p.qty, evalAfter: p.qty * hit.price, structural: false, reinvest: true, note: '' };
  };

  const runReinvest = (date) => {
    const done = [];
    const budget = cashDiv;
    if (!(budget > 0)) return done;
    const live = positions.filter(
      (p) => !p.removed && date >= p.effectiveStart && date <= p.effectiveEnd && !priceAt(prices[p.asset.code], date).missing,
    );
    if (!live.length) return done;
    const weightOf = (p) => {
      if (config.divReinvestSplit === 'even') return 1;
      if (config.divReinvestSplit === 'source') return Math.max(0, divPocket.get(p.asset.id) ?? 0);
      return config.targetMode === 'amount'
        ? Math.max(0, p.targetAmount ?? 0)
        : Math.max(0, p.targetRatio ?? 0);
    };
    let ws = live.map(weightOf);
    let totalW = ws.reduce((s, x) => s + x, 0);
    if (!(totalW > 0)) { ws = live.map(() => 1); totalW = live.length; }
    for (let i = 0; i < live.length; i++) {
      if (!(ws[i] > 0)) continue;
      const t = buyWithBudget(live[i], date, (budget * ws[i]) / totalW);
      if (!t) continue;
      live[i].active = true;
      done.push(t);
    }
    return done;
  };

  const initialTrades = [];
  for (const p of positions) {
    if (p.effectiveStart > startBiz) continue;
    if (p.effectiveEnd < startBiz) continue;
    p.active = true;
  }
  {
    checkRatioSum(startBiz);
    const base = config.initialCapital;
    let initRemain = config.initialCapital;
    for (const p of positions) {
      if (!p.active) continue;
      const t = adjustTo(p, startBiz, targetOf(p, config, base), false, { budget: Math.max(0, initRemain) });
      if (t) { touchAnchor(t); initialTrades.push(t); initRemain += t.cashDelta; }
    }
  }
  const initialCashAfter = cash;

  const slots = buildSlots(config, holidays);
  const divSlots = buildDividendSlots(config, holidays);
  const reinvestSlots = buildReinvestSlots(config, holidays);
  {
    const slotted = new Set();
    for (const s of slots) for (const id of s.assetIds) slotted.add(id);
    const reinvestOn = reinvestSlots.length > 0;
    const sourceSplit = config.divReinvestSplit === 'source';
    for (const p of positions) {
      if (slotted.has(p.asset.id)) continue;
      const nm = p.asset.name || p.asset.code;
      if (p.effectiveStart > startBiz) {
        warnings.push(
          !reinvestOn
            ? `${nm}: 리밸런싱 일정이 없어(‘리밸런싱 안 함’ 또는 지정 날짜 없음) 기간 중간 편입이 실행되지 않습니다 — 매수가 한 번도 일어나지 않습니다.`
            : sourceSplit
              ? `${nm}: 리밸런싱 일정이 없고 분배금 배분 기준이 ‘분배금 준 종목(DRIP)’이라 이 종목은 매수되지 않습니다 — 자기 분배 이력이 없으면 배분 몫이 0입니다(배분 기준을 ‘목표 비중’이나 ‘균등’으로 바꾸세요).`
              : `${nm}: 리밸런싱 일정이 없어 기간 중간 편입은 분배금 재투자 매수 시점에만 일어납니다(재투자할 분배금이 없으면 매수되지 않습니다).`,
        );
      } else if (config.policy !== 'none' && config.regularOn !== false) {
        warnings.push(`${nm}: 리밸런싱 일정이 없어 최초 매수 후 수량이 고정됩니다(의도한 설정이면 무시하세요).`);
      }
    }
    if (reinvestOn && slots.length > 0 && config.targetMode === 'amount') {
      warnings.push(
        '목표 금액 모드에서는 분배금 재투자로 산 수량을 다음 리밸런싱이 목표 금액에 맞춰 되팝니다 — '
        + '재투자 효과가 거의 없고, 되판 대금이 ‘누적 매매차익’에 잡혀 실제보다 커 보입니다. '
        + '재투자를 살리려면 리밸런싱을 끄거나(‘리밸런싱 안 함’) 목표를 ‘목표 비중 %’로 바꾸세요.',
      );
    }
  }
  const sigTrigByDate = new Map();
  const dipLevels = config.dip.enabled ? normalizeDipLevels(config.dip.levels) : [];
  const sellLevels = config.dip.enabled ? normalizeSellLevels(config.dip.sellLevels) : [];
  if (config.dip.extremeOn !== false && (dipLevels.length > 0 || sellLevels.length > 0)) {
    for (const p of positions) {
      const series = prices[p.asset.code];
      if (!series) continue;
      let peak = 0;
      let trough = Infinity;
      const firedBuy = new Set();
      const firedSell = new Set();
      for (const d of allBiz) {
        const hit = priceAt(series, d);
        if (hit.missing) continue;
        const px = hit.price;
        const newPeak = px > peak;
        const newTrough = px < trough;
        if (newPeak) { peak = px; firedBuy.clear(); }
        if (newTrough) { trough = px; firedSell.clear(); }
        const push = (rec) => {
          const arr = sigTrigByDate.get(d);
          if (arr) arr.push(rec); else sigTrigByDate.set(d, [rec]);
        };
        if (!newPeak && peak > 0) {
          const dropPct = ((peak - px) / peak) * 100;
          for (let i = 0; i < dipLevels.length; i++) {
            const lv = dipLevels[i];
            if (firedBuy.has(i)) continue;
            if (dropPct < lv.drop) continue;
            firedBuy.add(i);
            push({ assetId: p.asset.id, kind: 'buy', step: i + 1, level: lv.drop, pct: lv.buyPct, ref: peak, price: px, axis: 'extreme', anchorDate: '' });
          }
        }
        if (!newTrough && trough > 0 && Number.isFinite(trough)) {
          const risePct = ((px - trough) / trough) * 100;
          for (let i = 0; i < sellLevels.length; i++) {
            const lv = sellLevels[i];
            if (firedSell.has(i)) continue;
            if (risePct < lv.rise) continue;
            firedSell.add(i);
            push({ assetId: p.asset.id, kind: 'sell', step: i + 1, level: lv.rise, pct: lv.sellPct, ref: trough, price: px, axis: 'extreme', anchorDate: '' });
          }
        }
      }
    }
  }
  if (config.dip.enabled && dipLevels.length === 0 && sellLevels.length === 0) {
    warnings.push('시그널 리밸런싱을 켰지만 매수·매도 단계가 하나도 없어 아무 일도 일어나지 않습니다.');
  }
  if (config.dip.enabled && config.dip.extremeOn === false && !anchorOn) {
    warnings.push('시그널 리밸런싱을 켰지만 고점/저점 축을 끄고 직전 체결가 축 단계도 비어 있어 아무 일도 일어나지 않습니다.');
  }
  if (config.extraCash > 0 && !config.dip.enabled) {
    warnings.push(`추가 예수금 ${Math.round(config.extraCash).toLocaleString('ko-KR')}원은 **매매 시그널 발동 시에만** 쓰입니다 — ⑤-b 시그널 리밸런싱이 꺼져 있어 이 돈은 한 번도 쓰이지 않습니다(초기 매수·정기 리밸런싱은 초기 투자금만 씁니다).`);
  }

  const steps = [];
  const anchorTrigsAt = (date) => {
    if (!anchorOn) return [];
    const out = [];
    for (const p of positions) {
      if (p.removed) continue;
      if (date < p.effectiveStart || date > p.effectiveEnd) continue;
      const anchor = anchorPx.get(p.asset.id);
      if (!(anchor > 0)) continue;
      const hit = priceAt(prices[p.asset.code], date);
      if (hit.missing || hit.price <= 0) continue;
      const chgPct = ((hit.price - anchor) / anchor) * 100;
      const aDate = anchorDateOf.get(p.asset.id) ?? '';
      const fire = (levels, mag, kind, firedMap) => {
        if (!levels.length || !(mag > 0)) return;
        let deepest = -1;
        for (let i = 0; i < levels.length; i++) if (mag >= levels[i].move) deepest = i;
        if (deepest < 0) return;
        let fired = firedMap.get(p.asset.id);
        if (!fired) { fired = new Set(); firedMap.set(p.asset.id, fired); }
        if (fired.has(deepest)) return;
        for (let i = 0; i <= deepest; i++) fired.add(i);
        out.push({ assetId: p.asset.id, kind, step: deepest + 1, level: levels[deepest].move,
          pct: null, ref: anchor, price: hit.price, axis: 'anchor', anchorDate: aDate });
      };
      fire(anchorLevels, -chgPct, 'buy', firedAnchorBuy);
      fire(anchorSellLevels, chgPct, 'sell', firedAnchorSell);
    }
    return out;
  };
  if (anchorOn) {
    for (const d of allBiz) steps.push({ date: d, kind: 'signal', trigs: sigTrigByDate.get(d) ?? [] });
  } else {
    for (const [d, trigs] of sigTrigByDate) steps.push({ date: d, kind: 'signal', trigs });
  }
  for (const s of slots) steps.push({ date: s.rebalDate, kind: 'rebal', slot: s });
  for (const rs of reinvestSlots) {
    if (rs.date < startBiz || rs.date > endBiz) continue;
    steps.push({ date: rs.date, kind: 'reinvest', slot: rs });
  }
  const contribOvByYm = new Map();
  for (const o of config.contribOverrides) {
    if (contribOvByYm.has(o.ym)) warnings.push(`증액 예외 규칙에 ${o.ym}이(가) 중복 지정돼 마지막 것만 적용됩니다.`);
    contribOvByYm.set(o.ym, o);
  }
  const contribAssetsByYm = new Map();
  {
    const firstRebalOfYm = new Map();
    for (const s of slots) {
      const ym = ymOf(s.rebalDate);
      if (!ym) continue;
      const cur = firstRebalOfYm.get(ym);
      if (!cur || s.rebalDate < cur) firstRebalOfYm.set(ym, s.rebalDate);
      let set = contribAssetsByYm.get(ym);
      if (!set) { set = new Set(); contribAssetsByYm.set(ym, set); }
      for (const id of s.assetIds) set.add(id);
    }
    if (config.contribution.mode !== 'none' || contribOvByYm.size > 0) {
      for (const [ym, d] of firstRebalOfYm) steps.push({ date: d, kind: 'contrib', ym });
    }
    if (config.contribution.mode !== 'none' && config.contribution.value > 0 && firstRebalOfYm.size === 0) {
      warnings.push('리밸런싱이 한 번도 없어 매월 목표 증액이 전혀 집행되지 않습니다(증액은 그 달 첫 리밸런싱 직전에만 걸립니다).');
    }
    const anyContrib = (config.contribution.mode !== 'none' && config.contribution.value > 0)
      || config.contribOverrides.some(o => o.mode !== 'none' && o.value > 0);
    if (anyContrib && config.targetMode === 'ratio') {
      warnings.push(
        '비중 모드에서는 매월 목표 증액이 반영되지 않습니다 — 목표가 “종목 평가액 합계 × 비중”이라 '
        + '늘릴 대상이 없습니다. 쌓인 현금을 다시 투입하려면 목표 금액 모드를 쓰거나, '
        + '④ 분배금 처리를 재투자로 두거나, 목표 비중 합을 100%보다 크게 잡으세요.',
      );
    }
    for (const o of config.contribOverrides) {
      if (o.mode !== 'none' && o.value > 0 && !firstRebalOfYm.has(o.ym)) {
        warnings.push(`${o.ym}의 증액 예외 규칙은 그 달에 리밸런싱이 없어 적용되지 않습니다.`);
      }
    }
    const ar = config.annualReview;
    if (ar.mode === 'pctOfSurplus' && ar.value > 0) {
      if (config.targetMode === 'ratio') {
        warnings.push(
          '비중 모드에서는 연간 가드레일 증액이 반영되지 않습니다 — 목표가 “종목 평가액 합계 × 비중”이라 '
          + '올릴 대상이 없습니다(매월 목표 증액과 같은 이유). 목표 금액 모드에서 사용하세요.',
        );
      } else if (firstRebalOfYm.size === 0) {
        warnings.push('리밸런싱이 한 번도 없어 연간 가드레일 증액이 전혀 집행되지 않습니다.');
      } else {
        const endYm = ymOf(endBiz);
        let k = 1;
        while (k < 2000) {
          const ym = addMonthsToYm(ymOf(startBiz), ar.everyMonths * k);
          if (!ym || ym > endYm) break;
          const d = firstRebalOfYm.get(ym);
          if (d) steps.push({ date: d, kind: 'annual', ym });
          else warnings.push(`${ym}: 연간 가드레일 증액 시점이지만 그 달에 리밸런싱이 없어 집행되지 않습니다.`);
          k++;
        }
      }
    }
  }
  for (const d of divSlots) {
    steps.push({ date: d.exDate, kind: 'exdiv', div: d });
    if (d.payDate >= startBiz && d.payDate <= endBiz) steps.push({ date: d.payDate, kind: 'pay', div: d });
  }
  for (const e of config.events) {
    if (!isIsoDate(e.date)) continue;
    const d = onOrBeforeBusinessDay(e.date, holidays);
    if (d < startBiz || d > endBiz) { warnings.push(`이벤트 "${e.label || e.date}"의 날짜가 백테스트 기간 밖이라 무시됩니다.`); continue; }
    steps.push({ date: d, kind: 'event', event: { ...e, date: d } });
  }
  const KIND_ORDER = { exdiv: 0, pay: 1, event: 2, contrib: 3, annual: 4, signal: 5, rebal: 6, reinvest: 7 };
  steps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));

  const pendingDiv = new Map();
  const annualRows = [];
  const monthMap = new Map();
  const monthOf = (ym) => {
    let m = monthMap.get(ym);
    if (!m) {
      m = { ym, trades: [], dividends: [], tradeNet: 0, structuralNet: 0, reinvestNet: 0, cumTradeNet: 0,
        divAccrued: 0, cumDivAccrued: 0, divPaid: 0, cumDivPaid: 0, divTax: 0, cumDivTax: 0, cumReinvestNet: 0,
        cashDelta: 0, cashEnd: 0, cashTradeEnd: 0, cashDivEnd: 0, cashReserveEnd: 0, cashUsedTrade: 0, cashUsedDiv: 0, cashUsedReserve: 0, evalEnd: 0, totalEnd: 0, evalBeforeSum: 0,
        lastDate: '', holdings: [], contribution: null, cumContribution: 0,
        annualReview: null, cumAnnualReview: 0,
        bandSkipCount: 0, bandSkipAmount: 0, shortfallCount: 0 };
      monthMap.set(ym, m);
    }
    return m;
  };
  for (const ym of monthsBetween(startBiz, endBiz)) monthOf(ym);
  const pushTrade = (t) => {
    touchAnchor(t);
    const m = monthOf(ymOf(t.date));
    m.trades.push(t);
    if (t.reinvest) m.reinvestNet += t.cashDelta;
    else if (t.structural) m.structuralNet += t.cashDelta;
    else m.tradeNet += t.cashDelta;
    m.evalBeforeSum += t.evalBefore;
  };

  for (const step of steps) {
    if (step.kind === 'exdiv') {
      const rows = [];
      for (const aid of step.div.assetIds) {
        const p = posById.get(aid);
        if (!p || p.qty <= 0) continue;
        const ym = ymOf(step.div.exDate);
        const manual = p.asset.divOverride[ym];
        const hist = dividends[p.asset.code]?.[ym];
        const perShare = typeof manual === 'number' && Number.isFinite(manual) ? manual
          : typeof hist === 'number' && Number.isFinite(hist) ? hist : 0;
        const source = typeof manual === 'number' && Number.isFinite(manual) ? 'manual'
          : typeof hist === 'number' && Number.isFinite(hist) ? 'history' : 'none';
        rows.push({ ym, recordDate: step.div.recordDate, exDate: step.div.exDate, payDate: step.div.payDate,
          assetId: p.asset.id, code: p.asset.code, name: p.asset.name, perShare, qty: p.qty, amount: perShare * p.qty, source });
      }
      if (!rows.length) continue;
      pendingDiv.set(`${step.div.ym}|${step.div.cycle}`, rows);
      const am = monthOf(ymOf(step.div.exDate));
      for (const r of rows) {
        am.dividends.push(r);
        am.divAccrued += r.amount;
        if (r.source === 'none' && r.qty > 0) warnings.push(`${r.name || r.code} ${r.ym}: 주당 분배금 이력이 없어 0원으로 계산했습니다(표에서 직접 입력 가능).`);
      }
      continue;
    }
    if (step.kind === 'pay') {
      const rows = pendingDiv.get(`${step.div.ym}|${step.div.cycle}`);
      if (!rows) continue;
      pendingDiv.delete(`${step.div.ym}|${step.div.cycle}`);
      const m = monthOf(ymOf(step.date));
      for (const r of rows) {
        const net = r.amount * (1 - divTaxRate);
        m.divPaid += net;
        m.divTax += r.amount - net;
        applyDividend(net, step.date, r.assetId);
      }
      continue;
    }
    if (step.kind === 'signal') {
      const date = step.date;
      const trigs = anchorOn ? [...step.trigs, ...anchorTrigsAt(date)] : step.trigs;
      if (!trigs.length) continue;
      const liveOf = (assetId) => {
        const p = posById.get(assetId);
        if (!p || p.removed) return null;
        if (date < p.effectiveStart || date > p.effectiveEnd) return null;
        return p;
      };
      const pocket = Math.max(0, cashDiv);
      const tradeOnly = config.buyFunding === 'tradeOnly';
      checkRatioSum(date);
      const base = targetBaseAt(date);
      const mkEvent = (t, p) => {
        const ev = {
          date, assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
          kind: t.kind, step: t.step, level: t.level,
          axis: t.axis, anchorDate: t.anchorDate,
          pct: t.pct, pctSum: null, carrier: false,
          poolAt: 0, excessAt: 0, planned: 0,
          divPocketAt: pocket, cashTradeAt: cashTrade,
          used: 0, ref: t.ref, price: t.price,
          tradeQty: 0, tradeAmount: 0, fromTrade: 0, fromReserve: 0, reallocAmount: 0, note: '',
        };
        signalEvents.push(ev);
        return ev;
      };
      const sumPct = (list) => {
        let s = 0;
        for (const ev of list) {
          if (ev.pct === null) return null;
          s += ev.pct;
        }
        return s;
      };

      {
        const sellEvs = new Map();
        const sellPos = [];
        for (const t of trigs) {
          if (t.kind !== 'sell') continue;
          const p = liveOf(t.assetId);
          if (!p) continue;
          const ev = mkEvent(t, p);
          const list = sellEvs.get(p.asset.id);
          if (list) list.push(ev);
          else { sellEvs.set(p.asset.id, [ev]); sellPos.push(p); }
        }
        for (const p of sellPos) {
          const list = sellEvs.get(p.asset.id);
          const carrier = list[0];
          for (let i = 1; i < list.length; i++) {
            list[i].note = `동시 발동 — 체결은 ${carrier.step}단계 행에 합산`;
          }
          if (!p.active || p.qty <= QTY_EPS) { carrier.note = '보유 없음'; continue; }
          const hit = priceAt(prices[p.asset.code], date);
          if (hit.missing || hit.price <= 0) { carrier.note = '종가 없음'; continue; }
          carrier.carrier = true;
          const target = targetOf(p, config, base);
          const evalBefore = p.qty * hit.price;
          const excess = evalBefore - target;
          carrier.excessAt = Math.max(0, excess);
          carrier.pctSum = sumPct(list);
          if (excess <= 0) { carrier.note = '목표 이하 — 팔 것 없음'; continue; }
          const pctSum = carrier.pctSum;
          const sellAmount = pctSum === null ? excess : Math.min(excess, (excess * pctSum) / 100);
          carrier.planned = sellAmount;
          if (!(sellAmount > 0)) { carrier.note = '매도 비율 0% — 팔지 않음'; continue; }
          const tr = adjustTo(p, date, evalBefore - sellAmount, false);
          if (!tr || tr.qty >= 0) { carrier.note = '매도 수량 0(반올림)'; continue; }
          tr.signal = 'sell';
          pushTrade(tr);
          carrier.tradeQty = tr.qty;
          carrier.tradeAmount = Math.abs(tr.cashDelta);
          if (tr.note) carrier.note = tr.note;
        }
      }

      const buyTrigs = trigs.filter((t) => t.kind === 'buy');
      if (!buyTrigs.length) continue;

      const evsByAsset = new Map();
      const buyPos = [];
      for (const t of buyTrigs) {
        const p = liveOf(t.assetId);
        if (!p) continue;
        const ev = mkEvent(t, p);
        const list = evsByAsset.get(p.asset.id);
        if (list) list.push(ev);
        else { evsByAsset.set(p.asset.id, [ev]); buyPos.push(p); }
        if (!p.active) p.active = true;
      }
      if (!buyPos.length) continue;
      for (const list of evsByAsset.values()) {
        for (let i = 1; i < list.length; i++) {
          list[i].note = `동시 발동 — 체결은 ${list[0].step}단계 행에 합산`;
        }
      }

      const planOf = (p) => {
        const hit = priceAt(prices[p.asset.code], date);
        const target = targetOf(p, config, base);
        return { p, hit, evalBefore: hit.missing ? 0 : p.qty * hit.price, target };
      };
      const buyPlans = [];
      for (const p of buyPos) {
        const pl = planOf(p);
        if (pl.hit.missing || pl.hit.price <= 0) {
          const list = evsByAsset.get(p.asset.id);
          if (list) list[0].note = '종가 없음';
          continue;
        }
        buyPlans.push(pl);
      }
      const floorAmount = config.cashFloorPct > 0
        ? (activeTargetSum(date, base) * config.cashFloorPct) / 100
        : 0;

      const poolAt = tradeOnly ? Math.max(0, cashTrade) + Math.max(0, cashReserve) : Math.max(0, cash);
      let needTotal = 0;
      for (const b of buyPlans) {
        const list = evsByAsset.get(b.p.asset.id);
        if (!list) continue;
        const carrier = list[0];
        const need = Math.max(0, b.target - b.evalBefore);
        const pctSum = sumPct(list);
        carrier.carrier = true;
        carrier.pctSum = pctSum;
        carrier.poolAt = poolAt;
        carrier.planned = pctSum === null ? need : Math.min(need, (poolAt * pctSum) / 100);
        for (let i = 1; i < list.length; i++) {
          list[i].pctSum = null; list[i].poolAt = 0; list[i].planned = 0;
        }
        if (pctSum === null) needTotal += need;
      }

      const usableFor = (extra) => {
        const avail = tradeOnly ? Math.max(0, cashTrade) + Math.max(0, cashReserve) : Math.max(0, cash);
        const withExtra = avail + extra;
        if (floorAmount <= 0) return withExtra;
        return Math.min(withExtra, Math.max(0, cash + extra - floorAmount));
      };

      let realloc = 0;
      if (needTotal > 0 && config.dip.reallocate !== false && usableFor(0) < needTotal) {
        const buyIds = new Set(buyPos.map((p) => p.asset.id));
        const donors = positions
          .filter((p) => p.active && !p.removed && !buyIds.has(p.asset.id)
            && date >= p.effectiveStart && date <= p.effectiveEnd && p.qty > QTY_EPS)
          .map(planOf)
          .filter((x) => !x.hit.missing && x.hit.price > 0 && x.evalBefore - x.target > 0)
          .sort((a, b) => (b.evalBefore - b.target) - (a.evalBefore - a.target));
        let totalExcess = 0;
        for (const dp of donors) totalExcess += dp.evalBefore - dp.target;
        if (usableFor(totalExcess) > usableFor(0)) {
          for (const dp of donors) {
            if (usableFor(0) >= needTotal) break;
            const tr = adjustTo(dp.p, date, dp.target, false);
            if (!tr || tr.qty >= 0) continue;
            tr.signal = 'realloc';
            pushTrade(tr);
            realloc += tr.cashDelta;
          }
        }
      }
      {
        const first = evsByAsset.get(buyPos[0].asset.id);
        if (first) first[0].reallocAmount = realloc;
      }
      const ordered = [...buyPlans].sort((x, y) => {
        const px = evsByAsset.get(x.p.asset.id)?.[0].planned ?? 0;
        const py = evsByAsset.get(y.p.asset.id)?.[0].planned ?? 0;
        return py - px;
      });
      for (const b of ordered) {
        const list = evsByAsset.get(b.p.asset.id);
        if (!list) continue;
        const carrier = list[0];
        if (b.target - b.evalBefore <= 0) {
          if (!carrier.note) carrier.note = '목표 이상 — 살 것 없음';
          continue;
        }
        if (!(carrier.planned > 0)) {
          if (!carrier.note) {
            carrier.note = carrier.pctSum === 0 ? '매수 비율 0% — 사지 않음'
              : poolAt <= 0 ? '재원 없음' : '매수 수량 0';
          }
          continue;
        }
        const divCap = tradeOnly ? 0 : Infinity;
        // ⚠️ 예비금은 시그널 매수에서만 열린다(재원 사다리 ② 단계).
        const reserveCap = Math.max(0, cashReserve);
        const budget = (tradeOnly ? Math.max(0, cashTrade) : cash - cashReserve) + reserveCap;
        const floorCap = floorAmount > 0 ? Math.max(0, cash - floorAmount) : Infinity;
        const tr = adjustTo(b.p, date, b.evalBefore + carrier.planned, false, { budget, divCap, floorCap, reserveCap });
        if (!tr) {
          if (!carrier.note) carrier.note = budget <= 0 ? '재원 없음' : '매수 수량 0';
          continue;
        }
        tr.signal = 'buy';
        pushTrade(tr);
        carrier.tradeQty += tr.qty;
        carrier.tradeAmount += Math.abs(tr.cashDelta);
        if (tr.qty > 0) {
          carrier.used += lastDraw.fromDiv;
          carrier.fromTrade += lastDraw.fromTrade;
          carrier.fromReserve += lastDraw.fromReserve;
        }
        if (tr.note) carrier.note = tr.note;
      }
      continue;
    }
    if (step.kind === 'reinvest') {
      for (const t of runReinvest(step.date)) pushTrade(t);
      continue;
    }
    if (step.kind === 'contrib') {
      const rule = contribOvByYm.get(step.ym) ?? config.contribution;
      if (rule.mode === 'none' || !(rule.value > 0)) continue;
      if (config.targetMode === 'ratio') continue;
      const cashBefore = cash;
      const requested = rule.mode === 'pctOfCash' ? (cashBefore * rule.value) / 100 : rule.value;
      let amount = requested;
      let note = '';
      const deployable = deployableCash(step.date);
      if ((!config.allowNegativeCash || config.cashFloorPct > 0) && amount > deployable) {
        amount = Math.max(0, deployable);
        note = config.buyFunding === 'tradeOnly' || config.cashFloorPct > 0 ? '가용 재원 한도' : '예수금 한도';
      }
      amount = Math.floor(amount);
      if (!(amount > 0)) continue;
      const slotAssets = contribAssetsByYm.get(step.ym) ?? new Set();
      const live = positions.filter((p) => p.active && step.date >= p.effectiveStart && step.date <= p.effectiveEnd);
      const elig = live.filter((p) => slotAssets.has(p.asset.id));
      if (!elig.length) continue;
      if (elig.length < live.length) {
        warnings.push(`${step.ym}: 리밸런싱 일정이 없는 종목은 증액 대상에서 제외했습니다(목표만 오르고 매수되지 않기 때문).`);
      }
      const perAsset = [];
      const ws = elig.map((p) => (config.contribution.split === 'even' ? 1 : Math.max(0, p.targetAmount ?? 0)));
      let totalW = ws.reduce((s, x) => s + x, 0);
      if (!(totalW > 0)) { ws.fill(1); totalW = elig.length; }
      let left = amount;
      elig.forEach((p, i) => {
        const share = i === elig.length - 1 ? left : Math.floor((amount * ws[i]) / totalW);
        left -= share;
        p.targetAmount = (p.targetAmount ?? 0) + share;
        perAsset.push({ assetId: p.asset.id, code: p.asset.code, name: p.asset.name, added: share, targetAfter: p.targetAmount });
      });
      const m = monthOf(step.ym);
      m.contribution = { ym: step.ym, date: step.date, cashBefore, requested, amount,
        mode: rule.mode, value: rule.value, overridden: contribOvByYm.has(step.ym), perAsset, note };
      continue;
    }

    if (step.kind === 'annual') {
      const ar = config.annualReview;
      if (ar.mode !== 'pctOfSurplus' || !(ar.value > 0)) continue;
      if (config.targetMode === 'ratio') continue;
      const cashBefore = cash;
      const surplus = Math.max(0, cashBefore - cashReserve - Math.max(0, ar.reserve));
      const requested = (surplus * ar.value) / 100;
      let amount = Math.min(requested, surplus);
      let note = amount < requested ? '예약금 한도' : '';
      const deployableA = deployableCash(step.date);
      if ((!config.allowNegativeCash || config.cashFloorPct > 0) && amount > deployableA) {
        amount = Math.max(0, deployableA);
        note = config.buyFunding === 'tradeOnly' || config.cashFloorPct > 0 ? '가용 재원 한도' : '예수금 한도';
      }
      amount = Math.floor(amount);
      if (!(amount > 0)) continue;
      const slotAssets = contribAssetsByYm.get(step.ym) ?? new Set();
      const live = positions.filter((p) => p.active && !p.removed && step.date >= p.effectiveStart && step.date <= p.effectiveEnd);
      const elig = live.filter((p) => slotAssets.has(p.asset.id));
      if (!elig.length) continue;
      const perAsset = [];
      const ws = elig.map((p) => (ar.split === 'even' ? 1 : Math.max(0, p.targetAmount ?? 0)));
      let totalW = ws.reduce((s, x) => s + x, 0);
      if (!(totalW > 0)) { ws.fill(1); totalW = elig.length; }
      let left = amount;
      elig.forEach((p, i) => {
        const share = i === elig.length - 1 ? left : Math.floor((amount * ws[i]) / totalW);
        left -= share;
        p.targetAmount = (p.targetAmount ?? 0) + share;
        perAsset.push({ assetId: p.asset.id, code: p.asset.code, name: p.asset.name, added: share, targetAfter: p.targetAmount });
      });
      const row = { ym: step.ym, date: step.date, cashBefore, requested, amount,
        mode: 'pctOfSurplus', value: ar.value, overridden: false, perAsset, note, reserve: Math.max(0, ar.reserve) };
      monthOf(step.ym).annualReview = row;
      annualRows.push(row);
      continue;
    }

    if (step.kind === 'event') {
      const e = step.event;
      for (const aid of e.removeAssets) {
        const p = posById.get(aid);
        if (!p) continue;
        if (p.active && p.qty > 0) { const t = adjustTo(p, e.date, 0, true); if (t) pushTrade(t); }
        p.active = false;
        p.removed = true;
      }
      for (const t of e.targets) {
        const p = posById.get(t.assetId);
        if (!p) continue;
        if (t.amount !== null) p.targetAmount = t.amount;
        if (t.ratio !== null) p.targetRatio = t.ratio;
      }
      for (const aid of e.addAssets) {
        const p = posById.get(aid);
        if (!p) continue;
        if (e.date < p.effectiveStart) { warnings.push(`${p.asset.name || p.asset.code}: ${e.date}에는 종가 기록이 없어 ${p.effectiveStart}부터 편입됩니다.`); continue; }
        p.active = true;
        p.removed = false;
      }
      if (e.funding === 'reallocate') {
        const base = targetBaseAt(e.date);
        const acts = positions.filter((p) => p.active);
        const plans = acts.map((p) => {
          const hit = priceAt(prices[p.asset.code], e.date);
          const target = targetOf(p, config, base);
          return { p, target, delta: hit.missing ? 0 : target - p.qty * hit.price };
        });
        for (const pl of plans.filter((x) => x.delta < 0)) { const t = adjustTo(pl.p, e.date, pl.target, true); if (t) pushTrade(t); }
        for (const pl of plans.filter((x) => x.delta > 0)) { const t = adjustTo(pl.p, e.date, pl.target, true); if (t) pushTrade(t); }
      } else if (e.funding === 'cash') {
        const base = targetBaseAt(e.date);
        for (const aid of e.addAssets) {
          const p = posById.get(aid);
          if (!p || !p.active) continue;
          const t = adjustTo(p, e.date, targetOf(p, config, base), true);
          if (t) pushTrade(t);
        }
      }
      continue;
    }
    {
      const s = step.slot;
      const base = targetBaseAt(s.rebalDate);
      const eligible = [];
      for (const aid of s.assetIds) {
        const p = posById.get(aid);
        if (!p) continue;
        if (p.removed) continue;
        if (s.rebalDate < p.effectiveStart || s.rebalDate > p.effectiveEnd) continue;
        if (!p.active) p.active = true;
        eligible.push(p);
      }
      checkRatioSum(s.rebalDate);
      const floorAmount = config.cashFloorPct > 0 ? (activeTargetSum(s.rebalDate, base) * config.cashFloorPct) / 100 : 0;
      const bandPct = Math.max(0, config.band);
      const tradeOnly = config.buyFunding === 'tradeOnly';
      const plans = eligible.map((p) => {
        const hit = priceAt(prices[p.asset.code], s.rebalDate);
        const evalBefore = hit.missing ? 0 : p.qty * hit.price;
        const target = targetOf(p, config, base);
        return { p, hit, evalBefore, target, delta: hit.missing ? 0 : target - evalBefore };
      });
      const banded = new Set();
      if (bandPct > 0) {
        for (const pl of plans) {
          if (pl.hit.missing || pl.hit.price <= 0) continue;
          if (!(pl.target > 0)) continue;
          if (Math.abs(pl.evalBefore - pl.target) > (pl.target * bandPct) / 100) continue;
          banded.add(pl.p.asset.id);
          const wouldQty = roundQty(pl.delta / pl.hit.price, config.rounding);
          if (wouldQty !== 0) {
            const bm = monthOf(ymOf(s.rebalDate));
            bm.bandSkipCount++;
            bm.bandSkipAmount += Math.abs(wouldQty * pl.hit.price);
          }
        }
      }
      const runPlan = (pl) => {
        const id = pl.p.asset.id;
        if (banded.has(id)) return;
        const budget = tradeOnly ? Math.max(0, cashTrade) : cash - cashReserve;
        const divCap = tradeOnly ? 0 : Infinity;
        const floorCap = floorAmount > 0 ? Math.max(0, cash - floorAmount) : Infinity;
        const t = adjustTo(pl.p, s.rebalDate, pl.target, false, { budget, divCap, floorCap });
        if (t) pushTrade(t);
      };
      for (const pl of plans.filter((x) => x.delta < 0)) runPlan(pl);
      for (const pl of plans.filter((x) => x.delta > 0)) runPlan(pl);
    }
  }

  for (const rows of pendingDiv.values()) {
    for (const r of rows) if (r.amount > 0) warnings.push(`${r.name || r.code} ${r.ym}: 지급일(${r.payDate})이 종료일 이후라 현금에 반영되지 않았습니다.`);
  }

  const months = monthsBetween(startBiz, endBiz).map((ym) => monthOf(ym));
  let cumTrade = 0, cumDivAccrued = 0, cumDivPaid = 0, cumStructural = 0, cumReinvest = 0, cumContrib = 0;
  let cumAnnual = 0, cumDivTax = 0;
  let runCash = config.initialCapital + config.extraCash;
  for (const t of initialTrades) runCash += t.cashDelta;
  const runQty = new Map();
  for (const p of positions) runQty.set(p.asset.id, 0);
  for (const t of initialTrades) runQty.set(t.assetId, (runQty.get(t.assetId) ?? 0) + t.qty);
  for (const m of months) {
    m.trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    m.dividends.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
    cumTrade += m.tradeNet; cumStructural += m.structuralNet; cumReinvest += m.reinvestNet;
    cumDivAccrued += m.divAccrued; cumDivPaid += m.divPaid; cumDivTax += m.divTax;
    cumContrib += m.contribution ? m.contribution.amount : 0;
    cumAnnual += m.annualReview ? m.annualReview.amount : 0;
    m.cumTradeNet = cumTrade; m.cumReinvestNet = cumReinvest;
    m.cumDivAccrued = cumDivAccrued; m.cumDivPaid = cumDivPaid; m.cumDivTax = cumDivTax;
    m.cumContribution = cumContrib; m.cumAnnualReview = cumAnnual;
    m.shortfallCount = shortfallByYm.get(m.ym) ?? 0;
    m.cashDelta = m.tradeNet + m.structuralNet + m.reinvestNet + m.divPaid;
    runCash += m.cashDelta;
    m.cashEnd = runCash;
    const lastBiz = onOrBeforeBusinessDay(lastDayOfMonth(m.ym) > endBiz ? endBiz : lastDayOfMonth(m.ym), holidays);
    for (const t of m.trades) runQty.set(t.assetId, (runQty.get(t.assetId) ?? 0) + t.qty);
    const hold = [];
    let ev = 0;
    for (const p of positions) {
      const q = runQty.get(p.asset.id) ?? 0;
      if (q <= QTY_EPS) continue;
      const hit = priceAt(prices[p.asset.code], lastBiz);
      const amount = hit.missing ? 0 : q * hit.price;
      ev += amount;
      hold.push({ assetId: p.asset.id, code: p.asset.code, name: p.asset.name,
        qty: q, price: hit.price, priceExact: hit.exact, evalAmount: amount, weight: 0 });
    }
    for (const h of hold) h.weight = ev > 0 ? (h.evalAmount / ev) * 100 : 0;
    {
      let t = config.initialCapital;
      let d = 0;
      let rr = config.extraCash;
      for (const bkt of bucketLog) { if (bkt.date > lastBiz) break; t = bkt.t; d = bkt.d; rr = bkt.r; }
      m.cashTradeEnd = t; m.cashDivEnd = d; m.cashReserveEnd = rr;
    }
    {
      const dr = drawByYm.get(m.ym);
      m.cashUsedTrade = dr ? dr.fromTrade : 0;
      m.cashUsedDiv = dr ? dr.fromDiv : 0;
      m.cashUsedReserve = dr ? dr.fromReserve : 0;
    }
    m.lastDate = lastBiz;
    m.holdings = hold;
    m.evalEnd = ev;
    m.totalEnd = ev + runCash;
  }

  const curve = [];
  {
    const qty = new Map();
    for (const p of positions) qty.set(p.asset.id, 0);
    const tradesByDate = new Map(), divByDate = new Map();
    const push = (map, d, t) => { const arr = map.get(d); if (arr) arr.push(t); else map.set(d, [t]); };
    for (const t of initialTrades) push(tradesByDate, t.date, t);
    for (const m of months) {
      for (const t of m.trades) push(tradesByDate, t.date, t);
      for (const d of m.dividends) divByDate.set(d.payDate, (divByDate.get(d.payDate) ?? 0) + d.amount * (1 - divTaxRate));
    }
    let c = config.initialCapital + config.extraCash;
    for (const d of allBiz) {
      for (const t of tradesByDate.get(d) ?? []) { qty.set(t.assetId, (qty.get(t.assetId) ?? 0) + t.qty); c += t.cashDelta; }
      c += divByDate.get(d) ?? 0;
      let ev = 0;
      for (const p of positions) {
        const q = qty.get(p.asset.id) ?? 0;
        if (q <= QTY_EPS) continue;
        const hit = priceAt(prices[p.asset.code], d);
        if (!hit.missing) ev += q * hit.price;
      }
      curve.push({ date: d, evalAmount: ev, cash: c, total: ev + c });
    }
  }

  const finalEval = totalEvalAt(endBiz);
  const finalHoldings = positions.filter((p) => p.qty > QTY_EPS).map((p) => {
    const hit = priceAt(prices[p.asset.code], endBiz);
    const amount = hit.missing ? 0 : p.qty * hit.price;
    return { assetId: p.asset.id, code: p.asset.code, name: p.asset.name, qty: p.qty, price: hit.price,
      priceExact: hit.exact, evalAmount: amount, weight: finalEval > 0 ? (amount / finalEval) * 100 : 0 };
  });
  let peak = 0, maxDd = 0;
  for (const c of curve) { if (c.total > peak) peak = c.total; if (peak > 0) { const dd = ((peak - c.total) / peak) * 100; if (dd > maxDd) maxDd = dd; } }
  const invested = config.initialCapital + config.extraCash;
  const finalTotal = finalEval + cash;

  let minCash = { value: 0, date: '' };
  for (const c of curve) { if (!minCash.date || c.cash < minCash.value) minCash = { value: c.cash, date: c.date }; }
  let minCashDiv = { value: 0, date: '' };
  if (firstDivDate) {
    for (const b of bucketLog) {
      if (b.date < firstDivDate) continue;
      if (!minCashDiv.date || b.d < minCashDiv.value) minCashDiv = { value: b.d, date: b.date };
    }
  }
  let divMonthlyAvg = 0, divMonthlyStdev = 0;
  {
    let firstIdx = -1;
    for (let i = 0; i < months.length; i++) { if (months[i].divAccrued > 0) { firstIdx = i; break; } }
    if (firstIdx >= 0) {
      const vals = months.slice(firstIdx).map((m) => m.divAccrued);
      divMonthlyAvg = vals.reduce((s, x) => s + x, 0) / vals.length;
      divMonthlyStdev = Math.sqrt(vals.reduce((s, x) => s + (x - divMonthlyAvg) * (x - divMonthlyAvg), 0) / vals.length);
    }
  }
  let bandSkipCount = 0, bandSkipAmount = 0, shortfallMonths = 0, cumDivDrawn = 0, cumReserveDrawn = 0;
  for (const m of months) {
    bandSkipCount += m.bandSkipCount;
    bandSkipAmount += m.bandSkipAmount;
    cumDivDrawn += m.cashUsedDiv;
    cumReserveDrawn += m.cashUsedReserve;
    if (m.shortfallCount > 0) shortfallMonths++;
  }

  return {
    ok: true, fatal: '', warnings: Array.from(new Set(warnings)), slots, assetMeta,
    initialDate: startBiz, initialTrades, initialCashAfter, months, curve, finalHoldings, annualRows,
    summary: { startDate: startBiz, endDate: endBiz, initialCapital: config.initialCapital,
      finalEval, finalCash: cash, finalTotal, profit: finalTotal - invested,
      profitRate: invested > 0 ? ((finalTotal - invested) / invested) * 100 : 0,
      cumTradeNet: cumTrade, cumStructuralNet: cumStructural, cumReinvestNet: cumReinvest,
      cumDivAccrued, cumDivPaid, cumDivTax, cumContribution: cumContrib, cumAnnualReview: cumAnnual,
      finalCashTrade: cashTrade, finalCashDiv: cashDiv, finalCashReserve: cashReserve, cumDivDrawn, cumReserveDrawn,
      maxDrawdown: maxDd, months: months.length,
      minCash, minCashDiv, divMonthlyAvg, divMonthlyStdev,
      bandSkipCount, bandSkipAmount, signalEvents, shortfallMonths },
  };
}

function parsePastedSeries(text) {
  const data = {};
  let okc = 0, bad = 0;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/[,\t;]+|\s{1,}/).filter(Boolean);
    if (parts.length < 2) { bad++; continue; }
    let d = parts[0].trim();
    if (/^\d{8}$/.test(d)) d = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    d = d.replace(/[./]/g, '-');
    const v = Number(parts[1].replace(/[^0-9.\-]/g, ''));
    if (!isIsoDate(d) || !Number.isFinite(v) || v <= 0) { bad++; continue; }
    data[d] = v; okc++;
  }
  return { data, ok: okc, bad };
}

function collectDividendHistory(portfolios) {
  const out = {};
  for (const p of Array.isArray(portfolios) ? portfolios : []) {
    const dh = p?.dividendHistory;
    if (!dh || typeof dh !== 'object') continue;
    for (const code of Object.keys(dh)) {
      const byYm = dh[code];
      if (!byYm || typeof byYm !== 'object') continue;
      if (!out[code]) out[code] = {};
      for (const ym of Object.keys(byYm)) {
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;
        const v = byYm[ym];
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
        if (out[code][ym] === undefined) out[code][ym] = v;
      }
    }
  }
  return out;
}

// ═══════════ 픽스처: 2026 KRX 휴장일 + PDF 백테스트 ═══════════

// api/_marketCalendarData.ts CURATED_KR[2026] + 연말 휴장(12/31)
const KR26 = ['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-02','2026-05-01','2026-05-05',
  '2026-05-24','2026-05-25','2026-06-06','2026-08-17','2026-09-24','2026-09-25','2026-09-26',
  '2026-10-05','2026-10-09','2026-12-25','2026-12-31'];
const HOL = new Set(KR26);

const K200 = 'A498400', KFIN = 'A498410', TIGER = 'A0177R0';
const PRICES = {
  [K200]: { '2026-01-02': 19500, '2026-01-13': 20200, '2026-02-11': 21000, '2026-03-11': 21800,
            '2026-04-13': 22000, '2026-04-21': 22100, '2026-05-13': 22500, '2026-06-11': 23500, '2026-07-13': 21500 },
  [KFIN]: { '2026-01-02': 10500, '2026-01-28': 10800, '2026-02-25': 11300, '2026-03-27': 11600,
            '2026-04-21': 11700, '2026-04-28': 11800, '2026-05-27': 12000, '2026-06-26': 12500, '2026-07-29': 11800 },
  [TIGER]: { '2026-04-21': 10000, '2026-04-28': 11500, '2026-05-27': 11500, '2026-06-26': 13500, '2026-07-29': 10500 },
};
const DIVS = {
  [K200]: { '2026-01': 213, '2026-02': 244, '2026-03': 252, '2026-04': 262, '2026-05': 348, '2026-06': 350, '2026-07': 323 },
  [KFIN]: { '2026-01': 155, '2026-02': 189, '2026-03': 162, '2026-04': 165, '2026-05': 155, '2026-06': 140, '2026-07': 154 },
  [TIGER]: { '2026-04': 0, '2026-05': 170, '2026-06': 215, '2026-07': 205 },
};

const mkPdfConfig = (over = {}) => makeBtConfig({
  id: 'pdf', name: '커버드콜 백테스트',
  startDate: '2026-01-02', endDate: '2026-07-31',
  initialCapital: 450000000, targetMode: 'amount', rounding: 'floor', policy: 'perCycle',
  assets: [
    { id: 'a1', code: K200, name: 'KODEX 200', payCycle: 'mid', targetAmount: 225000000 },
    { id: 'a2', code: KFIN, name: 'KODEX 금융', payCycle: 'eom', targetAmount: 225000000 },
    { id: 'a3', code: TIGER, name: 'TIGER 반도체', payCycle: 'eom', targetAmount: 225000000, startDate: '2026-04-21' },
  ],
  events: [{
    id: 'e1', date: '2026-04-21', label: '반도체 편입 · 3종목 재편', funding: 'reallocate',
    addAssets: ['a3'], removeAssets: [],
    targets: [{ assetId: 'a1', amount: 150000000 }, { assetId: 'a2', amount: 150000000 }, { assetId: 'a3', amount: 150000000 }],
  }],
  ...over,
});
const runPdf = (over) => runBacktest({ config: mkPdfConfig(over), prices: PRICES, dividends: DIVS, holidays: KR26 });

// ═══════════ 테스트 ═══════════

console.log('\n── 파트① 영업일 / 일정 역산 ──');

eq('#1  addDays — 월 경계', addDays('2026-01-31', 1), '2026-02-01');
eq('#2  addDays — 윤년 아닌 2월', addDays('2026-02-28', 1), '2026-03-01');
eq('#3  dateToMs — 존재하지 않는 날짜는 NaN', Number.isNaN(dateToMs('2026-02-31')), true);
ok('#4  weekdayOf — 2026-01-01은 목요일(4)', weekdayOf('2026-01-01') === 4);
ok('#5  isBusinessDay — 토요일 false / 설 연휴 false / 평일 true',
  !isBusinessDay('2026-01-03', HOL) && !isBusinessDay('2026-02-17', HOL) && isBusinessDay('2026-01-13', HOL));
eq('#6  onOrBeforeBusinessDay — 일요일 2026-02-15 → 금요일', onOrBeforeBusinessDay('2026-02-15', HOL), '2026-02-13');
eq('#7  shiftBusinessDays — 연휴를 건너뛴다(2026-02-19 −1 → 02-13)', shiftBusinessDays('2026-02-19', -1, HOL), '2026-02-13');
// ⚠️ n=0은 직전 영업일로 스냅한다 — onOrAfter로 되돌리면 오프셋 0 설정에서 백테스트가
//    미래 종가를 당겨 쓰게 된다(2026-02-15 → 연휴 건너 02-19).
eq('#8  shiftBusinessDays(0)은 미래가 아니라 직전 영업일로 스냅', shiftBusinessDays('2026-02-15', 0, HOL), '2026-02-13');
eq('#9  recordDateFor mid — 2026-06은 15일이 월요일', recordDateFor('2026-06', 'mid', HOL), '2026-06-15');
eq('#10 recordDateFor eom — 2026-01 말일이 토요일 → 01-30', recordDateFor('2026-01', 'eom', HOL), '2026-01-30');

{
  const slots = buildSlots(mkPdfConfig(), HOL);
  const mid = slots.filter((s) => s.group === 'mid').map((s) => s.rebalDate);
  const eom = slots.filter((s) => s.group === 'eom').map((s) => s.rebalDate);
  // PDF의 월중 리밸런싱일 7개 — 전부 일치해야 한다.
  deep('#11 월중 리밸런싱일 = PDF 7개 전부 일치', mid,
    ['2026-01-13', '2026-02-11', '2026-03-11', '2026-04-13', '2026-05-13', '2026-06-11', '2026-07-13']);
  // PDF의 월말 5개 일치 + 2개는 PDF가 **일요일**을 써서 어긋난다(3/29·6/28 → 3/27·6/26).
  deep('#12 월말 리밸런싱일 (PDF 3/29·6/28은 일요일 오류 → 3/27·6/26)', eom,
    ['2026-01-28', '2026-02-25', '2026-03-27', '2026-04-28', '2026-05-27', '2026-06-26', '2026-07-29']);
  ok('#13 PDF 오류 2건은 실제로 일요일이었다', weekdayOf('2026-03-29') === 0 && weekdayOf('2026-06-28') === 0);
  const jan = slots.find((s) => s.ym === '2026-01' && s.group === 'mid');
  deep('#14 1월 월중: 기준일 −1=분배락, −2=리밸런싱, +2=지급',
    [jan.recordDate, jan.exDate, jan.rebalDate, jan.payDate],
    ['2026-01-15', '2026-01-14', '2026-01-13', '2026-01-19']);
}

console.log('\n── 파트② 수량 / 현금 규약 ──');

eq('#15 roundQty floor는 Math.trunc — 매수 11538.46 → 11538', roundQty(11538.46, 'floor'), 11538);
eq('#16 ⚠️ roundQty floor는 매도(음수)도 0 방향 — −594.66 → −594', roundQty(-594.66, 'floor'), -594);
ok('#17 ⚠️ Math.floor였다면 −595가 되어 매도량이 1주 늘어난다', Math.floor(-594.66) === -595 && roundQty(-594.66, 'floor') === -594);
eq('#18 roundQty round — PDF 4/28 TIGER의 유일한 반올림 −1956.52 → −1957', roundQty(-1956.52, 'round'), -1957);
eq('#19 roundQty exact — 소수 좌수 보존', roundQty(1234.5678, 'exact'), 1234.5678);

{
  const r = runPdf();
  const buyTotal = r.initialTrades.reduce((s, t) => s + Math.abs(t.cashDelta), 0);
  eq('#20 초기 매수 합계 = PDF 449,985,000', buyTotal, 449985000);
  eq('#21 초기 잔여 예수금 = PDF 15,000원', r.initialCashAfter, 15000);
  eq('#22 현금 항등식: 초기자본 = 매수금 + 잔여예수금', buyTotal + r.initialCashAfter, 450000000);
}

console.log('\n── 파트③ PDF 전체 재현 ──');

{
  const r = runPdf();
  const M = Object.fromEntries(r.months.map((m) => [m.ym, m]));
  const t0 = r.initialTrades;
  eq('#23 Phase0 KODEX 200 — 11,538주', t0[0].qty, 11538);
  eq('#24 Phase0 KODEX 금융 — 21,428주', t0[1].qty, 21428);
  ok('#25 Phase0에 TIGER는 없다(4/21 상장)', t0.length === 2);

  const jan = M['2026-01'];
  eq('#26 1월 리밸런싱 전 평가액 합 = PDF 464,490,000', jan.evalBeforeSum, 464490000);
  eq('#27 1월 매매금액 합 = PDF +14,475,000', jan.tradeNet, 14475000);
  eq('#28 1월 분배금(분배락 기준) = PDF 5,601,877', jan.divAccrued, 5601877);
  eq('#29 1/13 KODEX200 조정 후 수량 = PDF 11,139주', jan.trades[0].qtyAfter, 11139);
  eq('#30 1/28 KODEX금융 조정 후 수량 = PDF 20,834주', jan.trades[1].qtyAfter, 20834);

  eq('#31 2월 매매금액 = PDF +19,322,600', M['2026-02'].tradeNet, 19322600);
  eq('#32 2월 분배금 = PDF 6,377,828', M['2026-02'].divAccrued, 6377828);
  eq('#33 ⚠️ 2월 누적 분배금 — PDF는 1월분을 빠뜨려 6,377,828로 적었다(정답 11,979,705)',
    M['2026-02'].cumDivAccrued, 11979705);
  eq('#34 3월 매매금액 = PDF +14,541,400', M['2026-03'].tradeNet, 14541400);
  eq('#35 5월 매매금액 = PDF +5,266,500', M['2026-05'].tradeNet, 5266500);
  eq('#36 6월 매매금액 = PDF +39,006,000', M['2026-06'].tradeNet, 39006000);
  eq('#37 7월 매매금액(하락장 매수) = PDF −54,455,800', M['2026-07'].tradeNet, -54455800);
  eq('#38 7월 분배금 = PDF 7,138,962와 3주 차(TIGER 수량 반올림 차이)',
    Math.round(M['2026-07'].divAccrued), 2253248 + 1957494 + 14285 * 205);
}

console.log('\n── 파트④ 회귀 가드 ──');

{
  // ⚠️ 이 기능 최대의 발견: 종목 재편 매매는 '리밸런싱 차익'에 계상하지 않는다.
  const r = runPdf();
  const apr = r.months.find((m) => m.ym === '2026-04');
  const structural = apr.trades.filter((t) => t.structural);
  eq('#39 4/21 재편 3건은 전부 structural', structural.length, 3);
  eq('#40 ⚠️ 4월 정기 차익은 재편을 제외한 3건만 — PDF 25,859,200과 같은 정의',
    apr.tradeNet, 2068000 + 1286200 + 22494000);
  eq('#41 재편 순현금 = 매도 152,963,200 − 신규매수 150,000,000 = 잔돈 2,963,200',
    apr.structuralNet, 2963200);
  ok('#42 PDF 합계는 정기 3건만 더한 값과 일치(반올림 1주 차만 남는다)',
    Math.abs(apr.tradeNet - 25859200) === 11000);

  // 비중 모드 초기매수 붕괴 방지
  const ratio = runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-01-31', initialCapital: 450000000,
      targetMode: 'ratio', rounding: 'floor',
      assets: [{ id: 'b1', code: K200, name: 'K', payCycle: 'mid', targetRatio: 50 },
               { id: 'b2', code: KFIN, name: 'F', payCycle: 'eom', targetRatio: 50 }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  ok('#43 ⚠️ 비중 모드 초기매수 — 분모가 평가액 합계(=0)여도 투입자본을 써야 한다(0원 붕괴 방지)',
    ratio.initialTrades.length === 2 && ratio.initialTrades[0].qty === 11538);

  // 분배 일정이 리밸런싱 정책에 끌려가지 않는가
  const allEom = mkPdfConfig({ policy: 'allEom' });
  const ds = buildDividendSlots(allEom, HOL);
  const midEx = ds.filter((d) => d.cycle === 'mid').map((d) => d.exDate);
  ok('#44 ⚠️ 정책을 allEom으로 바꿔도 월중 종목의 분배락은 그대로 15일 기준이다',
    midEx[0] === '2026-01-14' && midEx.length === 7);
  const allEomSlots = buildSlots(allEom, HOL);
  ok('#45 allEom 정책은 그룹이 all 하나뿐이고 전 종목을 함께 리밸런싱한다',
    allEomSlots.every((s) => s.group === 'all' && s.assetIds.length === 3));

  // 월별 오버라이드는 리밸런싱일만 옮긴다
  const ov = mkPdfConfig({ overrides: [{ id: 'o1', ym: '2026-05', group: 'mid', date: '2026-05-20' }] });
  const s5 = buildSlots(ov, HOL).find((s) => s.ym === '2026-05' && s.group === 'mid');
  deep('#46 ⚠️ 오버라이드는 rebalDate만 옮기고 분배락·지급일은 불변',
    [s5.rebalDate, s5.exDate, s5.payDate, s5.overridden],
    ['2026-05-20', '2026-05-14', '2026-05-19', true]);

  // 지급월 vs 분배락월
  const r2 = runPdf();
  const jan2 = r2.months.find((m) => m.ym === '2026-01');
  const feb2 = r2.months.find((m) => m.ym === '2026-02');
  ok('#47 ⚠️ 월말 분배는 분배락월(1월)에 표시되고 현금은 지급월(2월)에 들어온다',
    jan2.divAccrued === 5601877 && Math.round(jan2.divPaid) === 2372607 && Math.round(feb2.divPaid) > 3229269);
  const cashCheck = r2.months[r2.months.length - 1].cashEnd;
  eq('#48 월별 cashEnd 누적 = 시뮬레이션 최종 예수금', Math.round(cashCheck), Math.round(r2.summary.finalCash));
}

console.log('\n── 파트④-d 월말 보유(수량·평가금액) ──');

{
  const r = runPdf();
  const M = Object.fromEntries(r.months.map((m) => [m.ym, m]));

  // ⚠️ 그 달에 **거래가 없던 종목도** 월말 보유에 잡혀야 한다 — 리밸런싱 표에는 행이 안 생기므로
  //    이 블록이 없으면 "이번 달에 안 건드린 종목이 몇 주인지" 확인할 길이 없다.
  const may = M['2026-05'];
  const tradedInMay = new Set(may.trades.map((t) => t.assetId));
  ok('#69 5월에 매매가 0주였던 TIGER도 월말 보유에 포함된다',
    !tradedInMay.has('a3') && may.holdings.some((h) => h.assetId === 'a3' && h.qty > 0));

  // 월말 보유 평가액 합 = evalEnd (총자산 정합의 근거)
  let allMatch = true;
  for (const m of r.months) {
    const sum = m.holdings.reduce((s, h) => s + h.evalAmount, 0);
    if (Math.abs(sum - m.evalEnd) > 1e-6) allMatch = false;
    if (Math.abs((m.evalEnd + m.cashEnd) - m.totalEnd) > 1e-6) allMatch = false;
  }
  ok('#70 Σ월말보유 평가금액 = evalEnd 이고 evalEnd + cashEnd = totalEnd (전 월)', allMatch);

  // 비중은 종목 평가액 합(예수금 제외) 기준 — 기말 보유 현황 표와 같은 정의
  const jul = M['2026-07'];
  const wsum = jul.holdings.reduce((s, h) => s + h.weight, 0);
  ok('#71 월말 보유 비중 합 = 100% (분모는 종목 평가액, 예수금 제외)', Math.abs(wsum - 100) < 1e-6);

  // 러닝 누적으로 바꾼 뒤에도 "그 달까지의 매매 누적"이어야 한다(종료 상태 스냅샷이 아님)
  const janQty = Object.fromEntries(M['2026-01'].holdings.map((h) => [h.assetId, h.qty]));
  deep('#72 ⚠️ 1월 말 보유수량은 1월까지의 누적 — 시뮬레이션 종료 상태가 아니다',
    [janQty.a1, janQty.a2, janQty.a3 ?? null], [11139, 20834, null]);

  // 월말 종가는 그 달 마지막 영업일 기준 (1월 말일 토요일 → 01-30, 5월 말일 일요일 → 05-29,
  // 7월 말일 2026-07-31은 금요일이라 그대로)
  deep('#73 lastDate = 그 달 마지막 영업일',
    [M['2026-01'].lastDate, M['2026-05'].lastDate, M['2026-07'].lastDate],
    ['2026-01-30', '2026-05-29', '2026-07-31']);
  // ⚠️ 마지막 달은 **기간 끝을 넘지 않아야** 한다 — 넘으면 조회기간 밖 종가로 평가하게 된다.
  const capped = runPdf({ endDate: '2026-07-15' });
  const cm = capped.months[capped.months.length - 1];
  deep('#73b 마지막 달 lastDate는 종료일로 캡된다', [cm.ym, cm.lastDate], ['2026-07', '2026-07-15']);

  // 표의 '조정 후 평가액' 원자재
  const t0 = M['2026-01'].trades[0];
  eq('#74 조정 후 평가액 = 조정 후 수량 × 그날 종가', t0.evalAfter, t0.qtyAfter * t0.price);

  // ⚠️ #75 — 화면 tfoot 합계가 '거래 단위 Σ'면 안 되는 이유를 수치로 고정한다.
  //    evalBefore/evalAfter는 '포지션 전체 평가액'이라 한 종목이 그 달에 두 번 거래되면
  //    중복 계상된다(재편 + 정기 리밸런싱이 겹친 4월). 화면·CSV는 그런 달의 합계를 비운다.
  const apr = M['2026-04'];
  const seen = new Set();
  let dup = false;
  for (const t of apr.trades) { if (seen.has(t.assetId)) { dup = true; break; } seen.add(t.assetId); }
  const naiveAfter = apr.trades.reduce((s, t) => s + t.evalAfter, 0);
  ok('#75 ⚠️ 같은 종목 2회 거래된 달의 거래단위 Σ는 실제 월말 평가액과 2배 이상 벌어진다 → 합계 비우기',
    dup && naiveAfter > apr.evalEnd * 2 && Math.round(apr.evalEnd) === 450022400);
  const jan = M['2026-01'];
  const janSeen = new Set();
  let janDup = false;
  for (const t of jan.trades) { if (janSeen.has(t.assetId)) { janDup = true; break; } janSeen.add(t.assetId); }
  ok('#75b 중복이 없는 달은 합계를 그대로 쓸 수 있다(1월)', !janDup);

  // ⚠️ #76 — rounding:'exact' 전량 매도 후 부동소수 잔여가 '유령 보유'로 남지 않아야 한다.
  //    잔여가 남으면 그 종목이 유일 보유일 때 `0주 · ₩0 (100.0%)`가 매달 렌더된다.
  {
    const P = { FX: {} };
    // 나누어떨어지지 않는 가격으로 소수 좌수를 만든다
    for (const d of ['2026-01-02', '2026-01-30', '2026-02-13', '2026-02-27', '2026-03-13', '2026-03-31']) P.FX[d] = 1234.56;
    P.FX['2026-02-27'] = 43210.5;
    const cfg = makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-03-31', initialCapital: 1000003,
      targetMode: 'amount', rounding: 'exact', policy: 'perCycle',
      assets: [{ id: 'f1', code: 'FX', name: '펀드', payCycle: 'none', targetAmount: 1000003 }],
      events: [{ id: 'ev', date: '2026-02-27', label: '전량 매도', funding: 'reallocate',
        addAssets: [], removeAssets: ['f1'], targets: [] }],
    });
    const rr = runBacktest({ config: cfg, prices: P, dividends: {}, holidays: KR26 });
    const ghosts = rr.months.flatMap((m) => m.holdings).filter((h) => h.qty > 0 && h.qty < 1e-6);
    ok('#76 ⚠️ 전량 매도 후 1e-13 규모 잔여가 월말 보유에 유령 행으로 남지 않는다', ghosts.length === 0);
  }

  // ⚠️ #77 — 거래·분배가 없어도 보유가 있으면 그 달을 렌더해야 한다(화면/CSV 일관).
  //    엔진이 그런 달에도 holdings 를 채우는지 확인(렌더 조건은 소스 가드 #79가 본다).
  {
    const quiet = runBacktest({
      config: makeBtConfig({
        startDate: '2026-01-02', endDate: '2026-03-31', initialCapital: 100000000,
        targetMode: 'amount', rounding: 'floor', policy: 'fixedDay', fixedDay: 5,
        assets: [{ id: 'q1', code: K200, name: 'K', payCycle: 'none', targetAmount: 100000000 }],
      }),
      prices: PRICES, dividends: {}, holidays: KR26,
    });
    const noTradeMonths = quiet.months.filter((m) => m.trades.length === 0 && m.dividends.length === 0);
    ok('#77 매매·분배가 없는 달에도 엔진은 월말 보유를 채운다',
      noTradeMonths.length > 0 && noTradeMonths.every((m) => m.holdings.length > 0 && m.lastDate));
  }
}

console.log('\n── 파트④-e 매월 목표 증액(현금 재투자) ──');

{
  // 증액 없음이 기본이고, 기존 결과와 완전히 동일해야 한다(하위호환).
  const base = runPdf();
  const same = runPdf({ contribution: { mode: 'none', value: 0, split: 'ratio' } });
  eq('#81 증액 기본값(none)은 기존 결과와 완전히 동일', JSON.stringify(base.months.map((m) => m.tradeNet)),
    JSON.stringify(same.months.map((m) => m.tradeNet)));

  const pct = runPdf({ contribution: { mode: 'pctOfCash', value: 50, split: 'ratio' } });
  const feb = pct.months.find((m) => m.ym === '2026-02');
  ok('#82 예수금 % 증액이 그 달 첫 리밸런싱일에 걸린다',
    !!feb.contribution && feb.contribution.date === '2026-02-11' && feb.contribution.mode === 'pctOfCash');
  ok('#83 증액액 = 그 시점 예수금 × 비율 (내림)',
    Math.abs(feb.contribution.amount - Math.floor(feb.contribution.cashBefore * 0.5)) < 1);
  eq('#84 종목별 배분 합 = 증액 총액 (원 단위 오차 없음)',
    feb.contribution.perAsset.reduce((s, x) => s + x.added, 0), feb.contribution.amount);
  ok('#85 ⚠️ 증액은 현금을 움직이지 않고 목표만 올린다 → 그 직후 리밸런싱이 실제로 매수한다',
    pct.months.find((m) => m.ym === '2026-02').tradeNet < base.months.find((m) => m.ym === '2026-02').tradeNet);
  ok('#86 증액 후 기말 예수금이 줄고 종목 평가액이 는다(현금 재투자)',
    pct.summary.finalCash < base.summary.finalCash && pct.summary.finalEval > base.summary.finalEval);

  // ⚠️ 예수금 한도 — 넘겨 증액하면 곧바로 '예수금 부족'이 되므로 미리 자른다.
  // ⚠️ `om.amount !== undefined ||` 같은 단락을 두지 말 것 — BtMonth 에 amount 필드가 없어
  //    영구히 false 인 죽은 항이고, 언젠가 필드가 생기면 어서션을 통째로 무력화한다.
  const over = runPdf({ contribution: { mode: 'amount', value: 999999999999, split: 'even' } });
  const oms = over.months.filter((m) => !!m.contribution);
  ok('#87 ⚠️ 증액은 보유 예수금을 넘지 않게 잘린다 (전 월)',
    oms.length > 0 && oms.every((m) => m.contribution.amount <= m.contribution.cashBefore && m.contribution.note === '예수금 한도'));

  // 월별 오버라이드
  const ovc = runPdf({
    contribution: { mode: 'none', value: 0, split: 'ratio' },
    contribOverrides: [{ id: 'c1', ym: '2026-03', mode: 'amount', value: 5000000 }],
  });
  const withC = ovc.months.filter((m) => !!m.contribution);
  ok('#88 특정 월 오버라이드만 증액된다(기본이 none이어도)',
    withC.length === 1 && withC[0].ym === '2026-03' && withC[0].contribution.amount === 5000000
      && withC[0].contribution.overridden === true);
  eq('#89 누적 증액이 월별로 누적된다', ovc.months[ovc.months.length - 1].cumContribution, 5000000);

  // ⚠️ 비중 모드 — 증액은 **집행되지 않는다**(2026-08). 목표가 '종목 평가액 합계 × 비중'이라
  //    분모를 키울 수단이 없다(그걸 유일하게 반영하던 분모 'initial' 선택지가 제거됐다).
  //    실행한 척(행·누적 카드는 찍고 매수는 0)하면 사용자가 결과를 정반대로 읽는다.
  const mkRatioContrib = (contribution) => makeBtConfig({
    startDate: '2026-01-02', endDate: '2026-03-31', initialCapital: 450000000,
    targetMode: 'ratio', rounding: 'floor', contribution,
    assets: [{ id: 'r1', code: K200, name: 'K', payCycle: 'mid', targetRatio: 50 },
             { id: 'r2', code: KFIN, name: 'F', payCycle: 'eom', targetRatio: 50 }],
  });
  const runRC = (contribution) => runBacktest({
    config: mkRatioContrib(contribution), prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  const rContrib = runRC({ mode: 'amount', value: 10000000, split: 'ratio' });
  const rNoContrib = runRC({ mode: 'none', value: 0, split: 'ratio' });
  ok('#90 ⚠️ 비중 모드에서 증액은 집행되지 않는다 — 결과가 증액 없음과 1원도 다르지 않다',
    rContrib.summary.cumContribution === 0
      && rContrib.months.every((m) => !m.contribution)
      && rContrib.summary.finalEval === rNoContrib.summary.finalEval
      && rContrib.summary.finalCash === rNoContrib.summary.finalCash);
  ok('#91 ⚠️ 그 사실을 경고로 알린다(조용히 무시 금지)',
    rContrib.warnings.some((w) => w.includes('비중 모드에서는 매월 목표 증액이 반영되지 않습니다')));
  ok('#91b 리밸런싱이 없는 비중 시나리오에서도 같은 경고가 뜬다(증액 스텝이 아예 안 생기므로)',
    (() => {
      const r = runBacktest({
        config: makeBtConfig({
          startDate: '2026-01-02', endDate: '2026-03-31', initialCapital: 450000000,
          targetMode: 'ratio', rounding: 'floor', policy: 'none',
          contribution: { mode: 'amount', value: 10000000, split: 'ratio' },
          assets: [{ id: 'r1', code: K200, name: 'K', payCycle: 'mid', targetRatio: 100 }],
        }),
        prices: PRICES, dividends: DIVS, holidays: KR26,
      });
      return r.warnings.some((w) => w.includes('비중 모드에서는 매월 목표 증액이 반영되지 않습니다'));
    })());
}

console.log('\n── 파트④-f 종목별 리밸런싱 일정 ──');

{
  // 종목별 개별 지정: TIGER만 매월 20일
  const perAsset = mkPdfConfig();
  perAsset.assets[2].rebalMode = 'day';
  perAsset.assets[2].rebalDay = 20;
  const slots = buildSlots(perAsset, HOL);
  const tigerDates = slots.filter((s) => s.assetIds.includes('a3')).map((s) => s.rebalDate).sort();
  ok('#92 종목별 지정일 — TIGER만 매월 20일(휴장이면 직전 영업일)로 분리된다',
    tigerDates.length === 7 && tigerDates.every((d) => +d.slice(8) <= 20 && +d.slice(8) >= 16));
  const otherDates = slots.filter((s) => s.assetIds.includes('a2')).map((s) => s.rebalDate);
  ok('#93 다른 종목은 전역 정책(월말 분배락 전)을 그대로 유지한다',
    otherDates.includes('2026-01-28') && otherDates.includes('2026-07-29'));

  // ⚠️ 일괄 오버라이드는 개별 지정 종목을 끌고 가지 않는다
  const mix = mkPdfConfig({ overrides: [{ id: 'o1', ym: '2026-06', group: 'eom', date: '2026-06-10' }] });
  mix.assets[2].rebalMode = 'day';
  mix.assets[2].rebalDay = 20;
  const ms = buildSlots(mix, HOL).filter((s) => s.ym === '2026-06');
  const kfinJun = ms.find((s) => s.assetIds.includes('a2'));
  const tigerJun = ms.find((s) => s.assetIds.includes('a3'));
  ok('#94 ⚠️ 월별 일괄 오버라이드는 follow 종목만 옮기고 개별 지정 종목은 건드리지 않는다',
    kfinJun.rebalDate === '2026-06-10' && tigerJun.rebalDate === '2026-06-19');

  // 종목 지정 오버라이드는 개별 지정 종목도 옮긴다
  const aov = mkPdfConfig({ overrides: [{ id: 'o2', ym: '2026-06', group: 'all', date: '2026-06-05', assetId: 'a3' }] });
  aov.assets[2].rebalMode = 'day';
  aov.assets[2].rebalDay = 20;
  const aslots = buildSlots(aov, HOL).filter((s) => s.ym === '2026-06' && s.assetIds.includes('a3'));
  deep('#95 종목 지정 오버라이드는 그 달 그 종목 일정을 통째로 대체한다',
    aslots.map((s) => s.rebalDate), ['2026-06-05']);

  // 'dates' 모드
  const dts = mkPdfConfig();
  dts.assets[2].rebalMode = 'dates';
  dts.assets[2].rebalDates = ['2026-05-11', '2026-07-06'];
  const dslots = buildSlots(dts, HOL).filter((s) => s.assetIds.includes('a3'));
  deep('#96 지정 날짜 모드 — 그 날짜에만 리밸런싱한다',
    dslots.map((s) => s.rebalDate).sort(), ['2026-05-11', '2026-07-06']);

  // 'none' 모드
  const nn = mkPdfConfig();
  nn.assets[2].rebalMode = 'none';
  ok('#97 none 모드 종목은 리밸런싱 슬롯에 아예 들어가지 않는다',
    buildSlots(nn, HOL).every((s) => !s.assetIds.includes('a3')));

  // ⚠️ 분배 일정은 리밸런싱 방식과 독립 — payCycle 만 따른다
  const dv = buildDividendSlots(nn, HOL).filter((d) => d.assetIds.includes('a3'));
  ok('#98 ⚠️ 리밸런싱을 끄거나 옮겨도 분배락 일정은 payCycle 그대로다',
    dv.length === 7 && dv.every((d) => d.cycle === 'eom'));

  // follow 기본값은 기존과 완전히 동일해야 한다(하위호환)
  const legacy = mkPdfConfig();
  for (const a of legacy.assets) { delete a.rebalMode; delete a.rebalDay; delete a.rebalDates; }
  const relegacy = makeBtConfig(legacy);
  deep('#99 rebalMode 미지정(레거시 시나리오)은 follow로 정규화돼 기존 일정과 동일',
    buildSlots(relegacy, HOL).map((s) => s.rebalDate),
    buildSlots(mkPdfConfig(), HOL).map((s) => s.rebalDate));
}

console.log('\n── 파트④-f2 전역 지정일 리밸런싱 ──');

{
  const DATES = ['2026-03-20', '2026-06-10'];
  const want = DATES.map((d) => onOrBeforeBusinessDay(d, HOL));

  const g = mkPdfConfig({ rebalDates: DATES });
  const hit = buildSlots(g, HOL).filter((s) => want.includes(s.rebalDate));
  ok('#330 전역 지정일이 정기 일정에 **추가**된다(follow 전 종목이 한 슬롯에)',
    hit.length === 2 && hit.every((s) => s.assetIds.length === 3));

  // ⚠️ buildSlots에서 `r.mode==='none'` continue보다 **앞**이어야 성립한다.
  //    '정기는 끄고 지정일만'이 이 기능의 주 사용 시나리오다.
  const gn = mkPdfConfig({ rebalDates: DATES, policy: 'none' });
  deep('#331 ⚠️ 정기 리밸런싱을 꺼도(policy:none) 지정일 슬롯은 그대로 생긴다',
    buildSlots(gn, HOL).map((s) => s.rebalDate).sort(), want.slice().sort());

  // ⚠️ 종목 지정 오버라이드 continue보다 **앞**이어야 성립한다.
  const gov = mkPdfConfig({
    rebalDates: ['2026-06-10'],
    overrides: [{ id: 'o9', ym: '2026-06', group: 'all', date: '2026-06-05', assetId: 'a2' }],
  });
  const jun = buildSlots(gov, HOL).filter((s) => s.ym === '2026-06' && s.assetIds.includes('a2'));
  ok('#332 ⚠️ 종목 오버라이드가 있는 달에도 그 종목이 전역 지정일 슬롯에 남는다',
    jun.some((s) => s.rebalDate === onOrBeforeBusinessDay('2026-06-10', HOL))
      && jun.some((s) => s.rebalDate === '2026-06-05'));

  const gi = mkPdfConfig({ rebalDates: ['2026-06-10'] });
  gi.assets[2].rebalMode = 'day';
  gi.assets[2].rebalDay = 20;
  const giSlot = buildSlots(gi, HOL).find((s) => s.rebalDate === onOrBeforeBusinessDay('2026-06-10', HOL));
  ok('#333 ⚠️ 전역 지정일은 follow 종목에만 — 개별 지정 종목은 끌려가지 않는다',
    !!giSlot && !giSlot.assetIds.includes('a3') && giSlot.assetIds.includes('a1'));

  const gh = mkPdfConfig({ rebalDates: ['2026-02-15', '2025-12-20', '2027-01-05'] });
  const ghs = buildSlots(gh, HOL).map((s) => s.rebalDate);
  ok('#334 휴장일은 직전 영업일로 스냅되고 기간 밖 지정일은 무시된다',
    ghs.includes('2026-02-13') && !ghs.some((d) => d < '2026-01-02' || d > '2026-07-31'));

  deep('#335 ⚠️ 지정일 기본값([])이면 슬롯이 종전과 완전히 동일하다',
    buildSlots(mkPdfConfig({ rebalDates: [] }), HOL).map((s) => s.rebalDate),
    buildSlots(mkPdfConfig(), HOL).map((s) => s.rebalDate));

  const n1 = makeBtConfig({ rebalDates: ['2026-06-10', '2026-03-20', '2026-06-10', 'x', null, 5] });
  deep('#336 정규화 — 유효 날짜만 + 중복 제거 + 정렬', n1.rebalDates, ['2026-03-20', '2026-06-10']);
  deep('#336b ⚠️ 빈 배열은 보존한다(기본값 복원 금지 — 없던 리밸런싱이 생기면 안 된다)',
    makeBtConfig({}).rebalDates, []);
  deep('#336c 정규화는 멱등이다(#237 — 폴링마다 재저장/편집 소실 방지)',
    makeBtConfig(n1).rebalDates, n1.rebalDates);

  const base = mkPdfConfig();
  const withD = mkPdfConfig({ rebalDates: ['2026-06-10'] });
  ok('#337 ⚠️ 전역 지정일은 저장 지문·설정 지문에 모두 들어간다(지정일만 고친 세션이 저장돼야 한다)',
    backtestFingerprint([base]) !== backtestFingerprint([withD])
      && backtestSettingsFingerprint(base) !== backtestSettingsFingerprint(withD));

  deep('#338 ⚠️ 전역 지정일은 분배락·지급 일정을 건드리지 않는다(분배는 payCycle만 따른다)',
    buildDividendSlots(withD, HOL).map((d) => d.exDate),
    buildDividendSlots(base, HOL).map((d) => d.exDate));
}

console.log('\n── 파트④-f3 정기 리밸런싱 스위치(regularOn) ──');

{
  const gNone = mkPdfConfig({ policy: 'none' });
  const gOff = mkPdfConfig({ policy: 'allEom', regularOn: false });
  const gOn = mkPdfConfig({ policy: 'allEom' });

  ok('#340 정기 체크를 끄면 정기 슬롯이 사라지고 policy 값은 보존된다',
    buildSlots(gOff, HOL).length === 0 && buildSlots(gOn, HOL).length > 0 && gOff.policy === 'allEom');

  // ⚠️ 같은 뜻의 두 설정이 경고 개수가 다르면 안 된다(#116 계약) — 설계 검증이 잡은 결함.
  const rNone = runBacktest({ config: gNone, prices: PRICES, dividends: DIVS, holidays: KR26 });
  const rOff = runBacktest({ config: gOff, prices: PRICES, dividends: DIVS, holidays: KR26 });
  deep('#341 ⚠️ 정기 체크 해제와 policy:none은 경고까지 완전히 같다(#116 계약)',
    rOff.warnings, rNone.warnings);

  const gBack = makeBtConfig({ ...gOff, regularOn: true });
  deep('#342 ⚠️ 정기를 껐다 켜면 원래 방식(월말 일괄)이 그대로 돌아온다(policy 미파괴)',
    buildSlots(gBack, HOL).map((s) => s.rebalDate),
    buildSlots(gOn, HOL).map((s) => s.rebalDate));

  const gInd = mkPdfConfig({ policy: 'allEom', regularOn: false });
  gInd.assets[2].rebalMode = 'day';
  gInd.assets[2].rebalDay = 20;
  const indSlots = buildSlots(gInd, HOL);
  ok('#343 ⚠️ 정기를 꺼도 종목별로 지정한 일정은 그대로 실행된다',
    indSlots.length > 0 && indSlots.every((s) => s.assetIds.length === 1 && s.assetIds[0] === 'a3'));

  const gBoth = mkPdfConfig({ policy: 'allEom', regularOn: false, rebalDates: ['2026-06-10'] });
  deep('#344 ⚠️ 정기를 꺼도 전역 지정일은 그대로 돈다(두 축은 독립)',
    buildSlots(gBoth, HOL).map((s) => s.rebalDate), [onOrBeforeBusinessDay('2026-06-10', HOL)]);

  const legacy = { ...mkPdfConfig() };
  delete legacy.regularOn;
  const legacySlots = buildSlots(makeBtConfig(legacy), HOL).map((s) => s.rebalDate);
  // ⚠️ 기대값을 `mkPdfConfig()`로 두면 **양쪽이 같은 정규화를 거쳐** 정규화가 깨져도 둘 다 빈
  //    배열이 되어 통과한다(변이 테스트로 실제 확인한 죽은 단언). 기대값은 `regularOn: true`를
  //    명시해 독립적으로 고정하고, 결과가 비어 있지 않은지도 함께 단언한다.
  deep('#345 ⚠️ regularOn 미지정(레거시)은 true로 정규화돼 기존 일정과 완전히 동일',
    legacySlots, buildSlots(mkPdfConfig({ regularOn: true }), HOL).map((s) => s.rebalDate));
  ok('#345b ⚠️ 그 기존 일정이 실제로 비어 있지 않다(둘 다 빈 배열이라 통과하는 것 방지)',
    legacySlots.length > 0);
  // ⚠️ 슬롯 비교만으로는 부족하다 — 정규화 계약을 **직접** 단언한다(구조상 공허할 수 없다).
  //    레거시 기본값을 깨는 변이는 mkPdfConfig가 regularOn을 넘기지 않아 전 픽스처를 무너뜨리므로
  //    스위트 전체 붕괴로 검출되지만, 이 줄은 그 계약이 무엇인지 코드로 남긴다.
  ok('#345c ⚠️ 정규화 계약 — 미지정은 true, 명시 false만 정기를 끈다',
    makeBtConfig({}).regularOn === true && makeBtConfig({ regularOn: false }).regularOn === false);

  ok('#346 ⚠️ regularOn은 저장 지문·설정 지문에 모두 들어간다(체크만 고친 세션이 저장돼야 한다)',
    backtestFingerprint([mkPdfConfig()]) !== backtestFingerprint([mkPdfConfig({ regularOn: false })])
      && backtestSettingsFingerprint(mkPdfConfig())
         !== backtestSettingsFingerprint(mkPdfConfig({ regularOn: false })));
}

console.log('\n── 파트④-h 앵커 시그널 축(직전 체결 종가 기준) ──');

{
  // 합성 픽스처 — 앵커 이동을 통제하려면 종가를 직접 만들어야 한다.
  //   bd[0..9] 10,000 (초기 매수 · 앵커 10,000)
  //   bd[10..29] 9,000  (−10%)      ← 여기서 1단계 발동
  //   bd[30..]  7,900  (초기 대비 −21% / 9,000 대비 −12.2%)
  const CODE = 'ANCH';
  const BD = businessDaysBetween('2026-01-02', '2026-03-31', HOL);
  const series = {};
  BD.forEach((d, i) => { series[d] = i < 10 ? 10000 : i < 30 ? 9000 : 7900; });
  const P = { [CODE]: series };

  const mkAnchor = (dip, over = {}) => makeBtConfig({
    id: 'anch', name: '앵커', startDate: '2026-01-02', endDate: '2026-03-31',
    initialCapital: 12000000, targetMode: 'amount', rounding: 'floor',
    policy: 'none', regularOn: false,
    assets: [{ id: 'x1', code: CODE, name: '앵커종목', payCycle: 'eom', targetAmount: 10000000 }],
    dip: { enabled: true, extremeOn: false, levels: [], sellLevels: [], reallocate: true, ...dip },
    ...over,
  });
  const runAnchor = (dip, over = {}, divs = {}) =>
    runBacktest({ config: mkAnchor(dip, over), prices: P, dividends: divs, holidays: KR26 });

  const LV2 = [{ move: 10 }, { move: 20 }];

  // ① lastFill(기본) — 시그널 체결이 앵커를 옮겨 **1단계가 재무장**된다(트레일링).
  const rFill = runAnchor({ anchorLevels: LV2, anchorSource: 'lastFill' });
  const evFill = rFill.summary.signalEvents.filter((e) => e.axis === 'anchor');
  deep('#350 lastFill — 시그널 체결이 앵커를 옮겨 같은 단계가 다시 발동한다(트레일링)',
    evFill.map((e) => e.step), [1, 1]);

  // ② lastRebal — 시그널 체결은 앵커를 **옮기지 않아** 한 기준에서 10% → 20%가 순차 발동한다.
  //    (사용자 요청문의 "리밸런싱 이후 10%, 20%"가 정확히 이 의미다.)
  const rReb = runAnchor({ anchorLevels: LV2, anchorSource: 'lastRebal' });
  const evReb = rReb.summary.signalEvents.filter((e) => e.axis === 'anchor');
  deep('#351 ⚠️ lastRebal — 한 기준에서 10% → 20%가 순차 발동한다(시그널 체결은 앵커 불변)',
    evReb.map((e) => e.step), [1, 2]);

  ok('#352 앵커 이벤트는 축과 기준 체결일을 함께 실어 보낸다(화면이 거짓 기준을 찍지 않게)',
    evReb.length > 0 && evReb.every((e) => e.axis === 'anchor' && isIsoDate(e.anchorDate))
      && evReb[0].ref === 10000);

  // ③ ⚠️ 분배금 재투자 체결은 앵커를 옮기지 않는다 — 설계 검증이 잡은 확정 결함.
  //    옮기면 재투자가 일어난 9,000이 새 기준이 되어 7,900이 −12.2%가 되고 2단계가 영영 안 뜬다.
  const rDiv = runAnchor(
    { anchorLevels: LV2, anchorSource: 'lastRebal' },
    { divReinvest: 'payDate' },
    { [CODE]: { '2026-01': 500 } },
  );
  const evDiv = rDiv.summary.signalEvents.filter((e) => e.axis === 'anchor');
  ok('#353 ⚠️ 분배금 재투자 체결은 앵커를 옮기지 않는다(재투자를 켜도 2단계가 그대로 발동)',
    rDiv.summary.cumDivPaid > 0 && evDiv.map((e) => e.step).join(',') === '1,2');

  // ④ 체결이 0인 날에도 이벤트가 매일 쌓이지 않는다(fired Set).
  ok('#354 ⚠️ 같은 앵커 아래에서 한 단계는 1회만 발동한다(이벤트 폭주 방지)',
    evFill.length === 2 && evReb.length === 2);

  // ⑤ 매도 축 — 저가 구간에서 반등하면 목표 초과분을 판다.
  const upSeries = {};
  BD.forEach((d, i) => { upSeries[d] = i < 10 ? 10000 : 12000; });
  const rSell = runBacktest({
    config: mkAnchor({ anchorSellLevels: [{ move: 15 }], anchorSource: 'lastRebal' }),
    prices: { [CODE]: upSeries }, dividends: {}, holidays: KR26,
  });
  const evSell = rSell.summary.signalEvents.filter((e) => e.axis === 'anchor');
  ok('#355 앵커 매도 축 — 직전 체결가 대비 +N%에서 목표 초과분을 판다',
    evSell.length === 1 && evSell[0].kind === 'sell' && evSell[0].tradeQty < 0);

  // ⑥ 하위호환 — 앵커 배열이 비면 결과가 종전과 완전히 동일하다.
  // ⚠️ 레거시 시나리오의 dip에는 앵커 필드가 **아예 없다** — 그 모양 그대로 넣어 결과가
  //    1바이트도 다르지 않은지 본다(길이 비교가 아니라 전체 JSON 동등).
  const b0 = mkPdfConfig();
  const legacyDip = {
    enabled: b0.dip.enabled, levels: b0.dip.levels,
    sellLevels: b0.dip.sellLevels, reallocate: b0.dip.reallocate,
  };
  deep('#356 ⚠️ 앵커 필드가 없는 레거시 dip은 PDF 시나리오 결과가 완전히 동일하다',
    runBacktest({ config: mkPdfConfig({ dip: legacyDip }), prices: PRICES, dividends: DIVS, holidays: KR26 }),
    runPdf());
  ok('#356b ⚠️ 앵커가 꺼져 있으면 signal 스텝을 매 영업일 만들지 않는다(고점 축 이벤트 수 불변)',
    runPdf({ dip: { enabled: true, levels: [{ drop: 10, buyPct: null }], sellLevels: [], reallocate: true } })
      .summary.signalEvents.every((e) => e.axis === 'extreme'));

  // ⑦ extremeOn — 고점/저점 축만 끄고 앵커만 쓸 수 있다.
  ok('#357 ⚠️ extremeOn:false면 고점/저점 축이 돌지 않는다(앵커 전용 구성)',
    rFill.summary.signalEvents.every((e) => e.axis === 'anchor'));

  // ⑧ 정규화 · 지문
  const n = normalizeDip({ enabled: true, anchorLevels: [{ move: 20 }, { move: 10 }, { move: 20 }, { move: 0 }, 'x'] });
  deep('#358 앵커 단계 정규화 — 유효값만 + 중복 제거 + 오름차순', n.anchorLevels, [{ move: 10 }, { move: 20 }]);
  deep('#358b ⚠️ 빈 배열은 보존한다(기본값 복원 금지 — 레거시에서 앵커가 저절로 켜지면 안 된다)',
    normalizeDip({ enabled: true }).anchorLevels, []);
  deep('#358c 레거시 기본값 — extremeOn:true · anchorSource:lastFill',
    [normalizeDip({}).extremeOn, normalizeDip({}).anchorSource], [true, 'lastFill']);
  deep('#358d 정규화는 멱등이다', normalizeDip(n).anchorLevels, n.anchorLevels);

  const fpA = mkPdfConfig();
  const fpB = mkPdfConfig({ dip: { ...fpA.dip, anchorLevels: [{ move: 10 }] } });
  const fpC = mkPdfConfig({ dip: { ...fpA.dip, anchorSource: 'lastRebal' } });
  const fpD = mkPdfConfig({ dip: { ...fpA.dip, extremeOn: false } });
  ok('#359 ⚠️ 앵커 단계·기준·축 on/off가 저장 지문·설정 지문에 모두 들어간다',
    backtestFingerprint([fpA]) !== backtestFingerprint([fpB])
      && backtestFingerprint([fpA]) !== backtestFingerprint([fpC])
      && backtestFingerprint([fpA]) !== backtestFingerprint([fpD])
      && backtestSettingsFingerprint(fpA) !== backtestSettingsFingerprint(fpB)
      && backtestSettingsFingerprint(fpA) !== backtestSettingsFingerprint(fpC)
      && backtestSettingsFingerprint(fpA) !== backtestSettingsFingerprint(fpD));
}

console.log('\n── 파트④-i 예비금 주머니(추가 예수금 = 시그널 전용) ──');

{
  // ⚠️ 이 파트가 생기기 전까지 전 픽스처가 `extraCash: 0`이라 예비금 로직이 스위트에
  //    **원리적으로 보이지 않았다**. 픽스처를 먼저 세우고 변이로 검출을 확인한 뒤 구현했다.
  const CODE = 'RSV';
  const BD = businessDaysBetween('2026-01-02', '2026-03-31', HOL);
  const flat = {}; BD.forEach((d) => { flat[d] = 10000; });
  const drop = {}; BD.forEach((d, i) => { drop[d] = i < 30 ? 10000 : 8000; });

  const mkR = (over = {}, dip = {}) => makeBtConfig({
    id: 'rsv', name: '예비금', startDate: '2026-01-02', endDate: '2026-03-31',
    initialCapital: 10000000, extraCash: 5000000,
    targetMode: 'amount', rounding: 'floor', policy: 'none', regularOn: false,
    assets: [{ id: 'r1', code: CODE, name: '알에스브이', payCycle: 'eom', targetAmount: 12000000 }],
    dip: { enabled: false, extremeOn: true, levels: [], sellLevels: [], reallocate: true, ...dip },
    ...over,
  });
  const runR = (prices, over = {}, dip = {}) =>
    runBacktest({ config: mkR(over, dip), prices: { [CODE]: prices }, dividends: {}, holidays: KR26 });

  // ① 시그널이 없으면 예비금은 한 푼도 쓰이지 않는다.
  const rIdle = runR(flat);
  eq('#370 시그널이 없으면 예비금은 그대로 남는다', rIdle.summary.finalCashReserve, 5000000);
  eq('#370b 초기 매수 잔돈은 매매 주머니 몫이다(초기 투자금 10,000,000 전액 매수)',
    rIdle.summary.finalCashTrade, 0);

  // ② 주머니 3분할 항등식 — 어느 것 하나라도 어긋나면 화면 소계가 예수금과 안 맞는다.
  ok('#371 ⚠️ 기말 항등식: 매매 + 분배금 + 예비금 = 기말 예수금',
    Math.abs((rIdle.summary.finalCashTrade + rIdle.summary.finalCashDiv
      + rIdle.summary.finalCashReserve) - rIdle.summary.finalCash) < 1e-6);
  const monthIdOk = (r) => r.months.every((m) => Math.abs((m.cashTradeEnd + m.cashDivEnd + m.cashReserveEnd) - m.cashEnd) < 1e-6);
  ok('#371b ⚠️ 월말 항등식: cashTradeEnd + cashDivEnd + cashReserveEnd = cashEnd',
    monthIdOk(rIdle));

  // ③ 예비금은 **시그널 발동 시에만** 쓰인다.
  const rSig = runBacktest({
    config: mkR({}, { enabled: true, levels: [{ drop: 10, buyPct: null }] }),
    prices: { [CODE]: drop }, dividends: { [CODE]: { '2026-01': 300 } }, holidays: KR26,
  });
  ok('#371c ⚠️ 예비금이 실제로 줄어드는 실행에서도 월말 항등식이 성립한다', monthIdOk(rSig));
  ok('#372 ⚠️ 시그널이 발동하면 예비금에서 매수 대금이 나간다',
    rSig.summary.finalCashReserve < 5000000
      && rSig.summary.signalEvents.some((e) => e.fromReserve > 0));

  // ④ 정기 리밸런싱은 예비금을 건드리지 못한다(시그널 없이 목표만 큰 구성).
  const rReg = runR(flat, { policy: 'allEom', regularOn: true });
  eq('#373 ⚠️ 정기 리밸런싱은 예비금을 쓰지 않는다', rReg.summary.finalCashReserve, 5000000);
  // ⚠️ 잔액만 보면 예산 변이가 안 잡힌다 — 예비금을 못 쓰면 **매수 자체가 일어나지 않아야** 한다
  //    (목표 12,000,000 > 초기 투자금 10,000,000이라 정기 회차마다 매수를 시도한다).
  ok('#373b ⚠️ 예비금을 못 쓰므로 정기 회차에서 매수가 한 건도 일어나지 않는다',
    rReg.months.every((m) => m.trades.length === 0) && rReg.summary.finalCashTrade >= 0);

  // ⑤ allowNegativeCash:true여도 예비금은 시그널 외 경로로 줄지 않는다.
  //    (adjustTo의 `limited`가 false라 예산 검사가 꺼지므로, 보호는 **인출 한도**가 담당한다.)
  const rNeg = runR(flat, { allowNegativeCash: true, policy: 'allEom', regularOn: true });
  eq('#374 ⚠️ allowNegativeCash에서도 예비금은 시그널 외 경로로 줄지 않는다',
    rNeg.summary.finalCashReserve, 5000000);

  // ⑥ 기말 예수금 분해 항등식(#125)은 **항이 늘지 않는다** — A는 cash 총액을 바꾸지 않고 분해만 한다.
  for (const [nm, r] of [['유휴', rIdle], ['시그널', rSig], ['정기', rReg]]) {
    ok(`#375 ⚠️ 기말 분해 항등식이 종전 그대로 성립한다(${nm})`,
      Math.abs(r.summary.finalCash - (r.initialCashAfter + r.summary.cumTradeNet
        + r.summary.cumStructuralNet + r.summary.cumReinvestNet + r.summary.cumDivPaid)) < 1e-6);
  }

  // ⑦ 매수 대금 출처 3항 합계 = 그 달 총 매수 대금.
  ok('#376 ⚠️ cashUsedTrade + cashUsedDiv + cashUsedReserve = 그 달 총 매수 대금',
    rSig.months.every((m) => {
      // ⚠️ 초기 매수는 m.trades가 아니라 result.initialTrades에 담기지만 drawByYm에는 잡힌다.
      const init = m.ym === ymOf(rSig.initialDate)
        ? rSig.initialTrades.filter((t) => t.cashDelta < 0).reduce((s, t) => s - t.cashDelta, 0) : 0;
      const buys = init + m.trades.filter((t) => t.cashDelta < 0).reduce((s, t) => s - t.cashDelta, 0);
      return Math.abs((m.cashUsedTrade + m.cashUsedDiv + m.cashUsedReserve) - buys) < 1e-6;
    }));

  // ⑧ ⚠️ 하위호환 — extraCash === 0이면 결과가 1바이트도 달라지지 않는다.
  // ⚠️ 옛 #377은 `mkPdfConfig({extraCash:0})` vs `mkPdfConfig()`를 비교했는데 픽스처에 extraCash가
  //    없어 **완전히 같은 config**였다 — 예비금 로직을 어떻게 바꿔도 통과하는 자기참조 단언이었다.
  //    '하위호환'의 실질 근거는 "extraCash가 0이면 예비금 기계장치가 **전부 무동작**"이고, 그건 falsifiable하다.
  {
    const z = runBacktest({ config: mkPdfConfig({ extraCash: 0 }), prices: PRICES, dividends: DIVS, holidays: KR26 });
    ok('#377 ⚠️ extraCash가 0이면 예비금 기계장치가 완전히 무동작이다(하위호환의 실질 근거)',
      z.summary.finalCashReserve === 0 && z.summary.cumReserveDrawn === 0
        && z.months.every((m) => m.cashReserveEnd === 0 && m.cashUsedReserve === 0)
        && z.summary.signalEvents.every((e) => !e.fromReserve)
        && !z.warnings.some((w) => w.includes('매매 시그널 발동 시에만')));
    ok('#377b ⚠️ 그 상태에서 매매 주머니 시드가 초기 투자금과 같다(예비금이 섞이지 않았다)',
      Math.abs(z.initialCashAfter - (z.summary.finalCashReserve + z.months[0].cashTradeEnd
        + z.months[0].cashDivEnd - z.months[0].cashDelta)) < 1e-6 || z.months.length === 0);
  }

  // ⑨ 예비금이 있는데 시그널이 꺼져 있으면 그 돈은 영영 안 쓰인다 → 반드시 알린다.
  // ⚠️ 종목명이 경고 문구에 섞여 들어가면 공허한 단언이 된다(실제로 '예비금종목'이라는 이름
  //    때문에 분배금 경고가 매칭돼 통과했다). 문구의 **고유 구절**로 단언한다.
  ok('#378 ⚠️ 예비금이 있는데 시그널이 꺼져 있으면 경고한다(쓰이지 않는 돈)',
    rIdle.warnings.some((w) => w.includes('매매 시그널 발동 시에만')));

  // ⑨-b ⚠️ 종목 재편(이벤트)도 예비금을 쓰지 못한다 — 이벤트는 adjustTo에 opts를 넘기지 않으므로
  //      **기본 예산(cash − cashReserve)** 이 그 경로의 유일한 보호막이다(#228이 그 줄을 못 박는다).
  const rEvent = runR(flat, {
    events: [{
      id: 'e9', date: BD[20], label: '목표 상향', funding: 'reallocate',
      addAssets: [], removeAssets: [], targets: [{ assetId: 'r1', amount: 14000000 }],
    }],
  });
  ok('#380 ⚠️ 종목 재편(이벤트)도 예비금을 쓰지 못한다(기본 예산에서 제외)',
    rEvent.summary.finalCashReserve === 5000000 && rEvent.summary.finalCashTrade >= 0);

  // ⑩ ⚠️ 인출 순서 — **매매 → 예비금 → 분배금**. 예비금을 분배금 뒤에 두면 buyFunding:'both'
  //    (기본, divCap=Infinity)에서 분배금이 먼저 소진되고, drainPocket이 divPocket을 비워
  //    이후 'source' 배분 가중치까지 소실된다(설계 검증 blocker).
  //    ⚠️ 이 단언은 **분배금 잔액이 있는 시점**에 시그널이 발동해야 판별력이 있다 —
  //       앞선 픽스처는 cashDiv가 0이라 순서를 구분하지 못한다.
  const rOrder = rSig;
  const evOrder = rOrder.summary.signalEvents.filter((e) => e.kind === 'buy' && e.carrier);
  ok('#379 ⚠️ 시그널 매수는 분배금보다 **예비금을 먼저** 쓴다(분배금 주머니 보존)',
    rOrder.summary.cumDivPaid > 0
      && evOrder.some((e) => e.fromReserve > 0)
      && evOrder.every((e) => e.used === 0));
}

console.log('\n── 파트④-g 적대적 리뷰 확정 결함 회귀 ──');

{
  // ⚠️ #100 — 같은 날짜는 **한 슬롯**이어야 한다. 그룹별로 쪼개면 그 날 리밸런싱이 2패스로 돌아
  //    '전 종목 매도 → 그 다음 매수' 불변식이 깨진다(1패스 매수가 2패스 매도 대금을 못 쓴다).
  const sameDay = mkPdfConfig();
  sameDay.assets[0].rebalMode = 'day';   // KODEX 200(mid, follow였음) → 개별 지정
  sameDay.assets[0].rebalDay = 28;
  sameDay.assets[1].rebalMode = 'day';
  sameDay.assets[1].rebalDay = 28;
  const sdSlots = buildSlots(sameDay, HOL).filter((s) => s.ym === '2026-01');
  ok('#100 ⚠️ 같은 날짜에 걸린 종목은 그룹이 달라도 한 슬롯으로 합쳐진다(매도 후 매수 불변식)',
    sdSlots.length === 1 && sdSlots[0].assetIds.length >= 2);

  const mixGroup = mkPdfConfig();
  mixGroup.assets[2].rebalMode = 'eom';   // follow(all 아님) → group 'all', 나머지는 'eom'
  const mg = buildSlots(mixGroup, HOL).filter((s) => s.ym === '2026-01' && s.rebalDate === '2026-01-28');
  ok('#100b 그룹이 섞인 날짜는 슬롯 1개로 합쳐지고 라벨만 all 이 된다',
    mg.length === 1 && mg[0].group === 'all');

  // ⚠️ #101 — 증액 월 귀속은 슬롯 라벨(ym)이 아니라 **실제 집행일의 달**이어야 한다.
  //    fixedDay 1 이면 rebalDate 가 전월로 스냅돼 라벨과 달이 갈린다.
  const shifted = runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-04-30', initialCapital: 450000000,
      targetMode: 'amount', rounding: 'floor', policy: 'fixedDay', fixedDay: 1,
      contribution: { mode: 'amount', value: 5000000, split: 'ratio' },
      assets: [{ id: 's1', code: K200, name: 'K', payCycle: 'mid', targetAmount: 225000000 },
               { id: 's2', code: KFIN, name: 'F', payCycle: 'eom', targetAmount: 225000000 }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  const badMonth = shifted.months.find((m) => m.contribution && ymOf(m.contribution.date) !== m.ym);
  ok('#101 ⚠️ 증액 행의 달과 실제 집행일의 달이 항상 일치한다', !badMonth);
  const noTradeButContrib = shifted.months.find((m) => m.contribution && m.contribution.amount > 0 && m.trades.length === 0);
  ok('#101b 거래가 없는 달에 증액 행만 뜨는 일이 없다', !noTradeButContrib);

  // ⚠️ #102 — 리밸런싱 슬롯이 없는 종목에 증액을 배분하면 목표만 오르고 영원히 매수되지 않는다.
  const dead = runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-07-31', initialCapital: 450000000,
      targetMode: 'amount', rounding: 'floor', policy: 'perCycle',
      contribution: { mode: 'amount', value: 20000000, split: 'ratio' },
      assets: [{ id: 'd1', code: K200, name: 'K', payCycle: 'mid', targetAmount: 225000000 },
               { id: 'd2', code: KFIN, name: 'F', payCycle: 'eom', targetAmount: 225000000, rebalMode: 'none' }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  const deadShare = dead.months.flatMap((m) => (m.contribution ? m.contribution.perAsset : []))
    .filter((x) => x.assetId === 'd2').reduce((s, x) => s + x.added, 0);
  ok('#102 ⚠️ 리밸런싱 일정이 없는 종목에는 증액을 배분하지 않는다', deadShare === 0);
  ok('#102b 그 사실을 경고로 알린다',
    dead.warnings.some((w) => w.includes('증액 대상에서 제외')) ||
    dead.warnings.some((w) => w.includes('수량이 고정')));

  // ⚠️ #103 — 목표 금액 모드의 배분 규칙(비중 모드는 집행 자체가 없으므로 이제 여기만 남는다).
  //    목표금액을 일부러 3:1로 어긋나게 두어 even/ratio가 실제로 갈리는지 본다.
  const runSplit = (split) => runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-03-31', initialCapital: 450000000,
      targetMode: 'amount', rounding: 'floor', policy: 'perCycle',
      contribution: { mode: 'amount', value: 30000000, split },
      assets: [{ id: 'q1', code: K200, name: 'K', payCycle: 'mid', targetAmount: 300000000 },
               { id: 'q2', code: KFIN, name: 'F', payCycle: 'eom', targetAmount: 100000000 }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  const firstContrib = (r) => r.months.find((m) => !!m.contribution && m.contribution.perAsset.length > 1);
  ok('#103 split=even — 대상 종목에 균등 배분한다(잔여 1원은 마지막 종목이 흡수)',
    (() => {
      const m = firstContrib(runSplit('even'));
      if (!m) return false;
      const adds = m.contribution.perAsset.map((x) => x.added);
      return Math.max(...adds) - Math.min(...adds) <= 1
        && adds.reduce((s, x) => s + x, 0) === m.contribution.amount;
    })());
  ok('#103b split=ratio — 목표금액이 큰 종목이 더 많이 받는다(3:1)',
    (() => {
      const m = firstContrib(runSplit('ratio'));
      if (!m) return false;
      const by = new Map(m.contribution.perAsset.map((x) => [x.assetId, x.added]));
      return (by.get('q1') ?? 0) === 3 * (by.get('q2') ?? 0)
        && [...by.values()].reduce((s, x) => s + x, 0) === m.contribution.amount;
    })());

  // ⚠️ #104 — 집행할 수 없는 증액 예외 규칙은 조용히 버리지 말고 경고한다.
  const orphanOv = runPdf({
    contribution: { mode: 'none', value: 0, split: 'ratio' },
    contribOverrides: [
      { id: 'x1', ym: '2029-01', mode: 'amount', value: 1000000 },
      { id: 'x2', ym: '2026-03', mode: 'amount', value: 1000000 },
      { id: 'x3', ym: '2026-03', mode: 'amount', value: 2000000 },
    ],
  });
  ok('#104 기간 밖 증액 예외는 경고한다', orphanOv.warnings.some((w) => w.includes('2029-01')));
  ok('#104b 같은 달 중복 예외는 경고한다', orphanOv.warnings.some((w) => w.includes('중복 지정')));
}

console.log('\n── 파트④-h 목표 기준(비중 분모 = 종목 평가액 합계) / 예수금 두 주머니 ──');

{
  // ⚠️ 2026-08 사용자 정의: 비중의 분모는 **종목 평가액 합계 하나**다. 예수금·매매차익·누적
  //    분배금은 분모에 들어가지 않는다(분모를 고르던 4종 선택지는 제거).
  const mkRatio = (over = {}) => makeBtConfig({
    startDate: '2026-01-02', endDate: '2026-07-31', initialCapital: 450000000,
    targetMode: 'ratio', rounding: 'floor', policy: 'perCycle',
    assets: [{ id: 'w1', code: K200, name: 'K', payCycle: 'mid', targetRatio: 50 },
             { id: 'w2', code: KFIN, name: 'F', payCycle: 'eom', targetRatio: 50 }],
    ...over,
  });
  const run = (over, dividends = DIVS) => runBacktest({
    config: mkRatio(over), prices: PRICES, dividends, holidays: KR26,
  });
  const main = run();

  // ⚠️ 불변식 — 두 주머니 합은 언제나 총 예수금과 같아야 한다(분배금을 따로 더하면 이중 계상).
  ok('#105 ⚠️ 매매 주머니 + 분배금 주머니 = 예수금 (전 월)',
    main.months.every((m) => Math.abs((m.cashTradeEnd + m.cashDivEnd) - m.cashEnd) < 1e-6));
  ok('#105b 기말도 동일', Math.abs((main.summary.finalCashTrade + main.summary.finalCashDiv) - main.summary.finalCash) < 1e-6);

  // ⚠️ #106 — 이 규약의 핵심 단언. 분배금이 아무리 쌓여도 **수량이 1주도 달라지면 안 된다**.
  //    분모에 현금이 섞이면(옛 'total'/'totalWithDiv') 목표가 커져 곧바로 수량이 갈린다.
  //    ⚠️ allowNegativeCash로 '예수금 부족' 절단을 없앤 채 비교한다 — 그게 남아 있으면 현금이
  //       많은 쪽이 덜 잘려서, 분모와 무관한 이유로 수량이 갈릴 수 있다(가짜 실패/가짜 통과).
  const freeDiv = run({ allowNegativeCash: true });
  const freeNoDiv = run({ allowNegativeCash: true }, {});
  ok('#106 ⚠️ 예수금은 분모가 아니다 — 분배금 유무가 수량·평가액을 1원도 바꾸지 않는다',
    freeDiv.summary.finalEval === freeNoDiv.summary.finalEval
      && JSON.stringify(freeDiv.months.map((m) => m.holdings.map((h) => h.qty)))
         === JSON.stringify(freeNoDiv.months.map((m) => m.holdings.map((h) => h.qty))));
  ok('#106b 차이는 예수금에만 나타난다(쌓인 분배금 = 현금 증가분)',
    freeDiv.summary.cumDivPaid > 0
      && Math.abs((freeDiv.summary.finalCash - freeNoDiv.summary.finalCash) - freeDiv.summary.cumDivPaid) < 1e-6);

  // ⚠️ #107 — 비중 합이 100%가 아닐 때의 귀결(화면 안내·엔진 경고와 같은 규약).
  //    분모가 평가액이라 합이 100%가 아니면 **리밸런싱마다** 그 차이만큼 사고판다(1회성이 아니다).
  const solo = (targetRatio) => runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-07-31', initialCapital: 450000000,
      targetMode: 'ratio', rounding: 'floor', policy: 'allEom',
      assets: [{ id: 's1', code: K200, name: 'K', payCycle: 'eom', targetRatio }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  const s100 = solo(100), s80 = solo(80), s120 = solo(120);
  ok('#107 ⚠️ 합 100%(단일 종목)면 매매가 아예 없다 — 목표가 곧 현재 평가액이다',
    s100.months.every((m) => m.trades.length === 0) && s100.summary.finalEval > 0);
  ok('#107b 합 80% — 리밸런싱마다 그 차이만큼 팔아 현금이 쌓인다(반복되면 평가액이 계속 준다)',
    s80.months.filter((m) => m.trades.some((t) => t.qty < 0)).length >= 5
      && s80.summary.finalEval < s100.summary.finalEval
      && s80.summary.finalCash > s100.summary.finalCash);
  ok('#107c 합 120% — 현금은 분모가 아니지만 매수 재원은 되므로 예수금을 헐어 더 산다',
    s120.months.filter((m) => m.trades.some((t) => t.qty > 0)).length >= 5
      && s120.summary.finalEval > s100.summary.finalEval
      && s120.summary.finalCash < s100.summary.finalCash);
  const sumWarn = (r) => r.warnings.some((w) => w.includes('목표 비중 합'));
  ok('#107d ⚠️ 비중 합이 100%가 아니면 경고한다(합계 오타를 조용히 실행하지 않게)',
    sumWarn(s80) && sumWarn(s120) && !sumWarn(s100));

  // ⚠️ #107e/#107f — 판정은 **그 시점 살아 있는 종목** 기준이다(정적 config.assets 합이 아니다).
  //    정적 합으로 재면 ①편입 기간이 갈린 정상 구성이 상시 오탐하고 ②이벤트가 런타임에 바꾼
  //    비중의 진짜 오타는 영영 미탐이다. 둘 다 실측으로 확인한 결함이었다.
  const staged = runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-07-31', initialCapital: 450000000,
      targetMode: 'ratio', rounding: 'floor', policy: 'allEom',
      assets: [{ id: 'g1', code: K200, name: 'K', payCycle: 'eom', targetRatio: 100, endDate: '2026-04-21' },
               { id: 'g2', code: KFIN, name: 'F', payCycle: 'eom', targetRatio: 100, startDate: '2026-04-21' }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  ok('#107e ⚠️ 편입 기간이 갈린 구성(정적 합 200%)은 오탐하지 않는다 — 동시 보유 시점이 없다',
    !sumWarn(staged));
  const evented = runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-07-31', initialCapital: 450000000,
      targetMode: 'ratio', rounding: 'floor', policy: 'allEom',
      assets: [{ id: 'g1', code: K200, name: 'K', payCycle: 'eom', targetRatio: 100 }],
      events: [{ id: 'ev', date: '2026-03-11', label: '비중 하향', funding: 'reallocate',
        addAssets: [], removeAssets: [], targets: [{ assetId: 'g1', ratio: 80 }] }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  ok('#107f ⚠️ ⑦ 이벤트가 런타임에 바꾼 비중(100→80%)도 잡는다 — 정적 합만 보면 미탐이다',
    sumWarn(evented));
  const zeroRatio = runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-07-31', initialCapital: 450000000,
      targetMode: 'ratio', rounding: 'floor', policy: 'allEom',
      assets: [{ id: 'z1', code: K200, name: 'K', payCycle: 'eom' },
               { id: 'z2', code: KFIN, name: 'F', payCycle: 'eom', targetRatio: 0 }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  ok('#107g ⚠️ 비중이 전부 0%(목표 금액→비중 전환 직후)면 경고한다 — 피해가 가장 큰데 조용했다',
    zeroRatio.summary.finalEval === 0
      && zeroRatio.warnings.some((w) => w.includes('목표 비중이 전부 0%')));

  // ⚠️ #108/#108d — 분모 자기잠금(base 0 → 목표 0 → 매매 0 → 보유 0) 방지.
  //    보유가 하나도 없으면 그 시점 가용 현금으로 부트스트랩한다(초기 매수와 같은 원리).
  const lateAll = runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-07-31', initialCapital: 450000000,
      targetMode: 'ratio', rounding: 'floor', policy: 'allEom',
      assets: [{ id: 'l1', code: TIGER, name: 'T', payCycle: 'eom', targetRatio: 100, startDate: '2026-04-21' }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  ok('#108 ⚠️ 전 종목이 기간 중간 편입이어도 산다(시작 시점 보유 0 → 분모 자기잠금 금지)',
    lateAll.summary.finalEval > 0
      && lateAll.months.some((m) => m.trades.some((t) => t.qty > 0)));
  const swapAll = runBacktest({
    config: makeBtConfig({
      startDate: '2026-01-02', endDate: '2026-07-31', initialCapital: 450000000,
      targetMode: 'ratio', rounding: 'floor', policy: 'allEom',
      assets: [{ id: 'x1', code: K200, name: 'K', payCycle: 'eom', targetRatio: 100 },
               { id: 'x2', code: TIGER, name: 'T', payCycle: 'eom', targetRatio: 0, startDate: '2026-04-21' }],
      events: [{ id: 'sw', date: '2026-04-28', label: '전면 교체', funding: 'reallocate',
        addAssets: ['x2'], removeAssets: ['x1'],
        targets: [{ assetId: 'x1', ratio: 0 }, { assetId: 'x2', ratio: 100 }] }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  ok('#108d ⚠️ 전면 교체 이벤트(전량 매도가 분모 산출보다 먼저)에서도 신규 종목을 산다',
    swapAll.summary.finalEval > 0
      && swapAll.months.some((m) => m.trades.some((t) => t.assetId === 'x2' && t.qty > 0)));

  // 매도 대금은 매매 주머니로만 들어간다 → 분배금 주머니는 지급으로만 늘어난다.
  ok('#108b 분배금 주머니는 지급으로만 늘어난다(매도 대금은 매매 주머니로)',
    main.months.every((m, i) => {
      const prev = i === 0 ? 0 : main.months[i - 1].cashDivEnd;
      return m.cashDivEnd <= prev + m.divPaid + 1e-6;
    }));
  ok('#108c 총액은 주머니 분해와 무관하게 유지된다',
    Math.abs((s120.summary.finalCashTrade + s120.summary.finalCashDiv) - s120.summary.finalCash) < 1e-6);

  // ⚠️ #109 — 레거시 시나리오 마이그레이션. 저장돼 있던 옛 분모 값은 조용히 버려져야 하고,
  //    결과에도 지문에도 흔적이 남으면 안 된다(남으면 같은 설정이 두 결과를 낸다).
  const legacy = makeBtConfig({ ratioBase: 'totalWithDiv', targetMode: 'ratio' });
  ok('#109 ⚠️ 옛 ratioBase 값은 정규화에서 사라진다(분모 선택 부활 금지)',
    !('ratioBase' in legacy) && legacy.targetMode === 'ratio');
  // ⚠️ 인자는 **정규화를 거치지 않은 raw 객체**여야 한다 — makeBtConfig 출력을 넣으면 필드가
  //    이미 사라진 뒤라 지문 투영이 되살아나도 통과하는 죽은 단언이 된다(#109의 동어반복).
  ok('#109b 지문 투영에도 남지 않는다(정규화 전 raw 객체로 검사)',
    backtestFingerprint([{ id: 'x', name: 'x', targetMode: 'ratio', ratioBase: 'total', assets: [] }])
      === backtestFingerprint([{ id: 'x', name: 'x', targetMode: 'ratio', ratioBase: 'initial', assets: [] }]));

  // ⚠️ #110 — 기말 예수금 **원천별 분해 항등식**. 기말 보유 표가 이 분해를 그대로 렌더하므로,
  //    항등식이 깨지면 화면의 소계가 예수금과 안 맞는다.
  //      기말 예수금 = 초기 매수 후 잔여 + 누적 매매차익 + 종목 재편 순현금 + 누적 분배금(지급 기준)
  //    ⚠️ 분배금은 **cumDivPaid**(지급 기준)를 써야 한다 — cumDivAccrued(분배락 기준)는 아직
  //       현금이 되지 않은 몫을 포함해 항등식이 깨진다.
  const idOk = (r) => Math.abs(
    (r.initialCashAfter + r.summary.cumTradeNet + r.summary.cumStructuralNet + r.summary.cumDivPaid)
    - r.summary.finalCash) < 1e-6;
  ok('#110 ⚠️ 기말 예수금 = 초기잔여 + 누적매매차익 + 재편순현금 + 누적분배금(지급)',
    [runPdf(), main, s80, s120, runPdf({ contribution: { mode: 'pctOfCash', value: 40, split: 'ratio' } })].every(idOk));
  const pdf = runPdf();
  ok('#110b ⚠️ 분배락 기준(cumDivAccrued)으로 바꾸면 항등식이 깨진다 — 지급 기준을 쓸 것',
    Math.abs(pdf.summary.cumDivAccrued - pdf.summary.cumDivPaid) > 1
      && Math.abs((pdf.initialCashAfter + pdf.summary.cumTradeNet + pdf.summary.cumStructuralNet
        + pdf.summary.cumDivAccrued) - pdf.summary.finalCash) > 1);
  // ⚠️ #111 — 매수 대금을 어느 주머니에서 꺼냈는지(화면의 '이 달 매수 대금 = 예수금 + 분배금' 줄).
  //    누적 매매차익이 마이너스인 달에 "이 돈이 어디서 나왔나"를 답하는 값이라, 합이 그 달
  //    **총 매수 대금**(매도 제외)과 정확히 같아야 한다.
  const drawOk = (r) => r.months.every((m) => {
    const buys = m.trades.filter((t) => t.cashDelta < 0).reduce((s, t) => s - t.cashDelta, 0);
    const init = m === r.months[0]
      ? r.initialTrades.filter((t) => t.cashDelta < 0).reduce((s, t) => s - t.cashDelta, 0) : 0;
    return Math.abs((m.cashUsedTrade + m.cashUsedDiv) - (buys + init)) < 1e-6;
  });
  ok('#111 ⚠️ 주머니별 사용액 합 = 그 달 총 매수 대금(초기매수 포함, 매도 제외)',
    [runPdf(), main, s120, runPdf({ contribution: { mode: 'pctOfCash', value: 60, split: 'ratio' } })].every(drawOk));

  // 실제 보고된 사례 재현: 매매 주머니가 바닥나 분배금에서 충당하는 달이 실제로 생긴다.
  // (초기 매수가 예수금을 다 쓴 뒤 비중 합 120%가 매달 분배금까지 헐어 사는 시나리오)
  const tapped = s120.months.filter((m) => m.cashUsedDiv > 0.5);
  ok('#111b 매매 주머니가 모자라면 분배금에서 꺼낸 금액이 기록된다',
    tapped.length > 0 && tapped.every((m) => m.cashTradeEnd <= m.cashUsedTrade + 1e-6));

  // ⚠️ #112 — 부족분 항등식: 분배금에서 꺼낸 누적액 = max(0, −(초기잔여 + 누적매매차익 + 재편))
  //    (사용자가 보고한 2024-09 사례: 초기잔여 7,000 + 누적매매차익 −486,791 = −479,791 →
  //     분배금에서 정확히 479,791을 헐었다.)
  const shortfallOk = (r) => {
    const used = r.months.reduce((s, m) => s + m.cashUsedDiv, 0);
    const tradePot = r.initialCashAfter + r.summary.cumTradeNet + r.summary.cumStructuralNet;
    return Math.abs(used - Math.max(0, -tradePot)) < 1e-6;
  };
  ok('#112 ⚠️ 분배금에서 헐어 쓴 누적액 = max(0, −(초기잔여 + 누적매매차익 + 재편순현금))',
    [runPdf(), main, s80, s120].every(shortfallOk));

  console.log(`      · PDF 시나리오 분해: 초기잔여 ${Math.round(pdf.initialCashAfter).toLocaleString('ko-KR')}`
    + ` + 매매차익 ${Math.round(pdf.summary.cumTradeNet).toLocaleString('ko-KR')}`
    + ` + 재편 ${Math.round(pdf.summary.cumStructuralNet).toLocaleString('ko-KR')}`
    + ` + 분배금 ${Math.round(pdf.summary.cumDivPaid).toLocaleString('ko-KR')}`
    + ` = ${Math.round(pdf.summary.finalCash).toLocaleString('ko-KR')}`);
}

console.log('\n── 파트④-i 리밸런싱 안 함 / 분배금 재투자 (#113~#133) ──');

{
  // 단일 종목 · 종가 고정(10,000, priceAt이 이후로 이월) · 매월 주당 500원 분배.
  // 재투자 효과만 분리해서 보기 위한 최소 픽스처다(가격이 안 변하므로 평가액 증가 = 수량 증가).
  const RC = 'RA', RC2 = 'RB';
  const RPRICES = { [RC]: { '2026-01-02': 10000 }, [RC2]: { '2026-01-02': 10000 } };
  const RDIVS = { [RC]: {}, [RC2]: {} };
  for (const mm of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']) {
    RDIVS[RC][`2026-${mm}`] = 500;   // RB는 분배 없음 — 'source' 배분 검증용
  }
  const mkR = (over = {}) => makeBtConfig({
    id: 'r', name: 'R', startDate: '2026-01-02', endDate: '2026-11-30',
    initialCapital: 100000000, targetMode: 'amount', rounding: 'floor', policy: 'none',
    assets: [{ id: 'r1', code: RC, name: 'R자산', payCycle: 'eom', targetAmount: 100000000 }],
    ...over,
  });
  const runR = (over) => runBacktest({ config: mkR(over), prices: RPRICES, dividends: RDIVS, holidays: KR26 });

  // ── 정규화 / 하위호환 ──
  const legacy = makeBtConfig({ id: 'x', name: 'x' });
  ok('#113 레거시(필드 부재)는 hold / target / compareOn=true 로 떨어진다',
    legacy.divReinvest === 'hold' && legacy.divReinvestSplit === 'target' && legacy.compareOn === true);
  ok('#113b 손상값도 안전한 기본값으로 폴백한다',
    makeBtConfig({ divReinvest: 'bogus', divReinvestSplit: 'bogus' }).divReinvest === 'hold'
      && makeBtConfig({ divReinvestSplit: 'bogus' }).divReinvestSplit === 'target');
  ok('#113c compareOn은 명시적 false만 제외한다(전체 비교가 빈 화면이 되지 않게)',
    makeBtConfig({ compareOn: false }).compareOn === false && makeBtConfig({ compareOn: true }).compareOn === true);
  ok('#113d policy "none"이 정규화에서 보존된다', makeBtConfig({ policy: 'none' }).policy === 'none');

  // ── 전역 '리밸런싱 안 함' ──
  const holdCfg = mkR();
  ok('#114 policy "none" — 리밸런싱 슬롯이 하나도 생기지 않는다',
    buildSlots(holdCfg, HOL).length === 0);
  const hold = runR();
  ok('#115 policy "none" — 초기 매수 이후 매매가 한 건도 없다(수량 고정)',
    hold.ok && hold.initialTrades.length === 1
      && hold.months.every((m) => m.trades.length === 0)
      && hold.finalHoldings[0].qty === hold.initialTrades[0].qty);
  ok('#116 ⚠️ 전역 "리밸런싱 안 함"은 종목마다 "수량 고정" 경고를 쏟지 않는다(진짜 경고가 묻힌다)',
    !hold.warnings.some((w) => w.includes('최초 매수 후 수량이 고정')));
  ok('#116b 종목별 지정으로 슬롯이 없는 경우에는 종전대로 경고한다',
    runBacktest({
      config: mkR({ policy: 'perCycle', assets: [{ id: 'r1', code: RC, name: 'R자산', payCycle: 'eom', targetAmount: 100000000, rebalMode: 'none' }] }),
      prices: RPRICES, dividends: RDIVS, holidays: KR26,
    }).warnings.some((w) => w.includes('최초 매수 후 수량이 고정')));

  // ── buildReinvestSlots ──
  ok('#117 hold 이면 재투자 슬롯이 없다', buildReinvestSlots(mkR(), HOL).length === 0);
  const eomSlots = buildReinvestSlots(mkR({ divReinvest: 'eom' }), HOL);
  const midSlots = buildReinvestSlots(mkR({ divReinvest: 'mid' }), HOL);
  ok('#118 ⚠️ 월중/월말 재투자일 = 리밸런싱과 같은 날짜 규칙(분배락 직전 영업일)',
    (() => {
      const rebalEom = buildSlots(mkR({ policy: 'allEom' }), HOL).map((s) => s.rebalDate);
      const rebalMid = buildSlots(mkR({ policy: 'allMid' }), HOL).map((s) => s.rebalDate);
      return JSON.stringify(eomSlots.map((s) => s.date)) === JSON.stringify(rebalEom)
        && JSON.stringify(midSlots.map((s) => s.date)) === JSON.stringify(rebalMid);
    })());
  ok('#119 ⚠️ 재투자 일정은 리밸런싱 정책에 끌려가지 않는다(완전 독립)',
    JSON.stringify(buildReinvestSlots(mkR({ divReinvest: 'eom', policy: 'allMid' }), HOL))
      === JSON.stringify(buildReinvestSlots(mkR({ divReinvest: 'eom', policy: 'none' }), HOL)));
  ok('#120 payDate 재투자일 = 분배 슬롯의 지급일(기간 안, 중복 제거)',
    (() => {
      const cfg = mkR({ divReinvest: 'payDate' });
      const want = Array.from(new Set(
        buildDividendSlots(cfg, HOL).map((d) => d.payDate)
          .filter((d) => d >= cfg.startDate && d <= cfg.endDate),
      )).sort();
      return JSON.stringify(buildReinvestSlots(cfg, HOL).map((s) => s.date)) === JSON.stringify(want);
    })());

  // ── 재투자 회계 ──
  const reEom = runR({ divReinvest: 'eom' });
  const rePay = runR({ divReinvest: 'payDate' });
  ok('#121 ⚠️ 재투자 후 분배금 주머니 = 받은 분배금 − 재투자로 쓴 금액 (정확히)',
    Math.abs(reEom.summary.finalCashDiv - (reEom.summary.cumDivPaid + reEom.summary.cumReinvestNet)) < 1e-6);
  ok('#122 ⚠️ 무한 재투자 방지 — 재투자 매수 총액은 누적 지급 분배금을 넘지 않는다',
    -reEom.summary.cumReinvestNet > 0
      && -reEom.summary.cumReinvestNet <= reEom.summary.cumDivPaid + 1e-6
      && -rePay.summary.cumReinvestNet <= rePay.summary.cumDivPaid + 1e-6);
  ok('#123 ⚠️ 재투자 매수는 누적 매매차익에 섞이지 않는다(hold와 동일)',
    Math.abs(reEom.summary.cumTradeNet - hold.summary.cumTradeNet) < 1e-6
      && reEom.months.every((m) => m.tradeNet === 0));
  ok('#123b 재투자 매매는 reinvest 플래그로만 구분되고 structural과 배타다',
    reEom.months.flatMap((m) => m.trades).every((t) => t.reinvest === true && t.structural === false)
      && reEom.months.flatMap((m) => m.trades).length > 0);
  ok('#124 재투자를 켜면 수량·평가액이 실제로 늘어난다(복리 작동)',
    reEom.summary.finalEval > hold.summary.finalEval
      && rePay.summary.finalEval > hold.summary.finalEval);
  // ⚠️ #124b — 고정가 픽스처에서는 payDate와 eom이 **정확히 같은 결과**라 부등호가 항상 참인
  //    동어반복이 된다(적대적 리뷰 지적). 값이 갈리려면 두 매수 시점 사이에 가격이 움직여야 한다.
  {
    const UP = { UPC: {} };
    // 매수 시점마다 오르는 가격 — 먼저 사는 payDate 가 더 많은 수량을 잡는다.
    const days = ['2026-01-02', '2026-02-03', '2026-02-24', '2026-03-04', '2026-03-27',
      '2026-04-02', '2026-04-28', '2026-05-06', '2026-05-27', '2026-06-03', '2026-06-26'];
    days.forEach((d, i) => { UP.UPC[d] = 10000 + i * 400; });
    const UPDIV = { UPC: {} };
    for (const mm of ['01', '02', '03', '04', '05', '06']) UPDIV.UPC[`2026-${mm}`] = 800;
    const mkUp = (over) => makeBtConfig({
      id: 'u', name: 'U', startDate: '2026-01-02', endDate: '2026-06-30',
      initialCapital: 100000000, targetMode: 'amount', rounding: 'floor', policy: 'none',
      assets: [{ id: 'u1', code: 'UPC', name: '상승주', payCycle: 'eom', targetAmount: 100000000 }],
      ...over,
    });
    const upRun = (over) => runBacktest({ config: mkUp(over), prices: UP, dividends: UPDIV, holidays: KR26 });
    const upPay = upRun({ divReinvest: 'payDate' });
    const upEom = upRun({ divReinvest: 'eom' });
    ok('#124b ⚠️ 상승장에서는 지급일 재투자가 월말 모아 사기보다 **엄격히** 유리하다(동어반복 아님)',
      upPay.summary.finalEval > upEom.summary.finalEval
        && upPay.summary.finalTotal > upEom.summary.finalTotal);
  }

  // ⚠️ #122c~#122e — 재투자 전용 픽스처(mkR)는 targetAmount === initialCapital 이라 초기 매수가
  //    자본을 전부 쓰고, policy:'none'이라 매도도 없어 **cashTrade가 항상 0**이다. 그래서
  //    buyWithBudget의 `applyCash(..., 'div')`에서 'div'를 지워도 (매매 주머니가 비어 있어
  //    어차피 분배금에서 나가므로) 164개 테스트가 전부 통과한다 — 이 기능의 핵심 가드가
  //    통째로 미검증이었다(적대적 리뷰가 변이 테스트로 입증). 매매 주머니에 잔액이 남는
  //    픽스처라야 그 변이가 잡힌다.
  const mkRCash = (over = {}) => makeBtConfig({
    id: 'rc', name: 'RC', startDate: '2026-01-02', endDate: '2026-11-30',
    initialCapital: 100000000, targetMode: 'amount', rounding: 'floor', policy: 'none',
    // 목표를 자본의 60%만 잡아 ₩40,000,000을 **매매 주머니**에 남긴다.
    assets: [{ id: 'rc1', code: RC, name: 'R자산', payCycle: 'eom', targetAmount: 60000000 }],
    ...over,
  });
  const rcHold = runBacktest({ config: mkRCash(), prices: RPRICES, dividends: RDIVS, holidays: KR26 });
  const rcEom = runBacktest({ config: mkRCash({ divReinvest: 'eom' }), prices: RPRICES, dividends: RDIVS, holidays: KR26 });
  ok('#122c 픽스처 전제 — 매매 주머니에 잔액이 실제로 남아 있다(그래야 아래 가드가 의미를 갖는다)',
    rcHold.initialCashAfter === 40000000 && rcEom.summary.finalCashTrade > 0);
  // ⚠️ 첫 달의 cashUsedTrade는 **초기 매수**라 0이 아니다 — 그래서 '전 월 0'이 아니라
  //    '보유만 했을 때와 월별로 동일'로 잰다(재투자가 매매 주머니 사용을 1원도 늘리지 않았는가).
  ok('#122d ⚠️ 재투자는 매매 주머니를 **1원도 건드리지 않는다**(prefer="div"를 지우면 여기서 깨진다)',
    Math.abs(rcEom.summary.finalCashTrade - rcHold.summary.finalCashTrade) < 1e-6
      && rcEom.months.every((m, i) => Math.abs(m.cashUsedTrade - rcHold.months[i].cashUsedTrade) < 1e-6));
  ok('#122e ⚠️ 매매 주머니가 넉넉해도 재투자 총액은 누적 지급 분배금을 넘지 않는다(무한 재투자 방지)',
    -rcEom.summary.cumReinvestNet > 0
      && -rcEom.summary.cumReinvestNet <= rcEom.summary.cumDivPaid + 1e-6
      && Math.abs(rcEom.summary.finalCashDiv - (rcEom.summary.cumDivPaid + rcEom.summary.cumReinvestNet)) < 1e-6);

  // ⚠️ #125 — 기말 예수금 원천별 분해. 재투자 항이 빠지면 화면 소계가 예수금과 안 맞는다.
  const idOk2 = (r) => Math.abs(
    (r.initialCashAfter + r.summary.cumTradeNet + r.summary.cumStructuralNet
      + r.summary.cumReinvestNet + r.summary.cumDivPaid) - r.summary.finalCash) < 1e-6;
  ok('#125 ⚠️ 기말 예수금 = 초기잔여 + 매매차익 + 재편 + 재투자매수 + 분배금(지급)',
    [hold, reEom, rePay, runR({ divReinvest: 'mid' })].every(idOk2));
  ok('#125b 재투자 항을 빼면 항등식이 실제로 깨진다(항이 필요하다는 증거)',
    Math.abs((reEom.initialCashAfter + reEom.summary.cumTradeNet + reEom.summary.cumStructuralNet
      + reEom.summary.cumDivPaid) - reEom.summary.finalCash) > 1);
  ok('#126 ⚠️ 매매 주머니 + 분배금 주머니 = 예수금 (재투자 켠 상태에서도)',
    [reEom, rePay].every((r) => r.months.every((m) => Math.abs((m.cashTradeEnd + m.cashDivEnd) - m.cashEnd) < 1e-6)
      && Math.abs((r.summary.finalCashTrade + r.summary.finalCashDiv) - r.summary.finalCash) < 1e-6));
  ok('#127 ⚠️ 주머니별 사용액 합 = 그 달 총 매수 대금(재투자 매수 포함)',
    [reEom, rePay].every((r) => r.months.every((m) => {
      const buys = m.trades.filter((t) => t.cashDelta < 0).reduce((s, t) => s - t.cashDelta, 0);
      const init = m === r.months[0]
        ? r.initialTrades.filter((t) => t.cashDelta < 0).reduce((s, t) => s - t.cashDelta, 0) : 0;
      return Math.abs((m.cashUsedTrade + m.cashUsedDiv) - (buys + init)) < 1e-6;
    })));
  ok('#127b 재투자 매수 대금은 **분배금 주머니**에서 나간다(매매 주머니를 헐지 않는다)',
    reEom.months.every((m) => m.reinvestNet === 0 || m.cashUsedDiv > 0)
      && Math.abs(reEom.months.reduce((s, m) => s + m.cashUsedDiv, 0) + reEom.summary.cumReinvestNet) < 1e-6);
  ok('#127c 월 현금 증감에 재투자가 반영된다(runCash가 실제 cash와 갈리지 않게)',
    reEom.months.every((m) => Math.abs(m.cashDelta - (m.tradeNet + m.structuralNet + m.reinvestNet + m.divPaid)) < 1e-6)
      && Math.abs(reEom.months[reEom.months.length - 1].cashEnd - reEom.summary.finalCash) < 1e-6);

  // ── 배분 기준 ──
  const two = (split) => runBacktest({
    config: mkR({
      divReinvest: 'eom', divReinvestSplit: split,
      assets: [
        { id: 'r1', code: RC, name: '분배O', payCycle: 'eom', targetAmount: 50000000 },
        { id: 'r2', code: RC2, name: '분배X', payCycle: 'eom', targetAmount: 50000000 },
      ],
    }),
    prices: RPRICES, dividends: RDIVS, holidays: KR26,
  });
  const boughtBy = (r, id) => r.months.flatMap((m) => m.trades).filter((t) => t.reinvest && t.assetId === id)
    .reduce((s, t) => s + t.qty, 0);
  const src = two('source'), tgt = two('target'), evn = two('even');
  ok('#128 ⚠️ split "source" — 분배금을 준 종목만 되산다(DRIP)',
    boughtBy(src, 'r1') > 0 && boughtBy(src, 'r2') === 0);
  // ⚠️ #128b — 위 픽스처는 분배 종목이 **1개뿐**이라 'source'가 실제로 출처 비율을 쓰는지
  //    (그냥 '분배한 종목 전부에 균등'이 아닌지) 구분하지 못한다. 분배액이 다른 두 종목이
  //    필요하다. r1:800원 / r2:200원 = 4:1 → 재투자 수량도 4:1 이어야 한다.
  {
    const D2 = { [RC]: {}, [RC2]: {} };
    for (const mm of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']) {
      D2[RC][`2026-${mm}`] = 800;
      D2[RC2][`2026-${mm}`] = 200;
    }
    const two2 = runBacktest({
      config: mkR({
        divReinvest: 'eom', divReinvestSplit: 'source',
        assets: [
          { id: 'r1', code: RC, name: '많이', payCycle: 'eom', targetAmount: 50000000 },
          { id: 'r2', code: RC2, name: '적게', payCycle: 'eom', targetAmount: 50000000 },
        ],
      }),
      prices: RPRICES, dividends: D2, holidays: KR26,
    });
    // 첫 재투자(누적 왜곡 전)만 보면 비율이 정확히 분배액 비율이다.
    const first = two2.months.flatMap((m) => m.trades).filter((t) => t.reinvest)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const d0 = first.length ? first[0].date : '';
    const q1 = first.filter((t) => t.date === d0 && t.assetId === 'r1').reduce((s, t) => s + t.qty, 0);
    const q2 = first.filter((t) => t.date === d0 && t.assetId === 'r2').reduce((s, t) => s + t.qty, 0);
    ok('#128b ⚠️ split "source"는 출처 **비율**대로 나눈다(분배 800:200 → 수량 4:1, 균등이 아니다)',
      q1 > 0 && q2 > 0 && Math.abs(q1 / q2 - 4) < 0.05);
  }
  ok('#129 split "target" — 목표 비율대로 두 종목에 나눠 산다',
    boughtBy(tgt, 'r1') > 0 && boughtBy(tgt, 'r2') > 0);
  ok('#129b split "even" — 두 종목에 균등하게 나눠 산다(같은 가격이면 수량도 같다)',
    boughtBy(evn, 'r1') > 0 && Math.abs(boughtBy(evn, 'r1') - boughtBy(evn, 'r2')) <= 1);
  // ⚠️ 가중치가 전부 0이 되는 **실제로 도달 가능한** 경로: split='source'인데 분배금을 준
  //    종목이 편입 기간에서 빠진 경우. 그 뒤로도 분배는 계속 들어오는데 그 종목은 살 수 없다
  //    → 폴백이 없으면 분배금이 영원히 현금으로 남아 사용자가 켠 재투자가 조용히 무시된다.
  const orphanSrc = runBacktest({
    config: mkR({
      divReinvest: 'eom', divReinvestSplit: 'source',
      assets: [
        { id: 'r1', code: RC, name: '분배O(3월까지)', payCycle: 'eom', targetAmount: 50000000, endDate: '2026-03-31' },
        { id: 'r2', code: RC2, name: '분배X', payCycle: 'eom', targetAmount: 50000000 },
      ],
    }),
    prices: RPRICES, dividends: RDIVS, holidays: KR26,
  });
  ok('#130 ⚠️ 배분 가중치가 전부 0이면 균등으로 폴백한다(분배금이 조용히 사장되지 않게)',
    -orphanSrc.summary.cumReinvestNet > 0
      && orphanSrc.months.flatMap((m) => m.trades)
        .some((t) => t.reinvest && t.assetId === 'r2' && t.date > '2026-04-01'));

  // ── 스텝 순서 ──
  ok('#131 ⚠️ 같은 날에는 리밸런싱이 먼저, 재투자가 나중이다(목표를 맞춘 뒤 남은 현금 투입)',
    (() => {
      const r = runBacktest({
        config: mkR({ policy: 'allEom', divReinvest: 'eom' }),
        prices: RPRICES, dividends: RDIVS, holidays: KR26,
      });
      const byDate = new Map();
      for (const m of r.months) for (const t of m.trades) {
        if (!byDate.has(t.date)) byDate.set(t.date, []);
        byDate.get(t.date).push(t);
      }
      let sawMixed = false;
      for (const arr of byDate.values()) {
        if (!arr.some((t) => t.reinvest) || !arr.some((t) => !t.reinvest)) continue;
        sawMixed = true;
        if (arr.findIndex((t) => t.reinvest) < arr.map((t) => t.reinvest).lastIndexOf(false)) return false;
      }
      return sawMixed;
    })());

  // ── 지문 / 하위호환 ──
  const base = makeBtConfig({ id: 'f2', assets: [{ id: 'a', code: 'X', name: 'A', targetAmount: 100 }] });
  const bump = (patch) => backtestFingerprint([{ ...JSON.parse(JSON.stringify(base)), ...patch }]);
  ok('#132 ⚠️ 지문이 divReinvest / divReinvestSplit / compareOn 단독 변경을 감지한다',
    bump({ divReinvest: 'eom' }) !== backtestFingerprint([base])
      && bump({ divReinvestSplit: 'source' }) !== backtestFingerprint([base])
      && bump({ compareOn: false }) !== backtestFingerprint([base]));
  ok('#133 ⚠️ 기존 시나리오는 이 기능 도입으로 1원도 달라지지 않는다(hold 기본값)',
    (() => {
      const a = runBacktest({ config: mkPdfConfig(), prices: PRICES, dividends: DIVS, holidays: KR26 });
      const b = runBacktest({ config: mkPdfConfig({ divReinvest: 'hold', divReinvestSplit: 'target' }), prices: PRICES, dividends: DIVS, holidays: KR26 });
      return Math.abs(a.summary.finalTotal - b.summary.finalTotal) < 1e-6
        && a.summary.cumReinvestNet === 0 && b.summary.cumReinvestNet === 0;
    })());

  // ── 적대적 리뷰 확정 결함 회귀 (#141~#145) ──────────────────────────────
  // ⚠️ #141~#142 — 이벤트로 뺀 종목이 되살아나던 결함. runReinvest의 live 필터가 p.active를
  //    보지 않아 재투자가 되샀고, 리밸런싱도 옛 목표로 되사고 있었다(선행 결함). `p.active`로
  //    거르면 '아직 편입 전'인 중간 상장 종목까지 빠지므로 **removed 플래그**로 구분해야 한다.
  const mkEvt = (over = {}) => makeBtConfig({
    id: 'ev', name: 'EV', startDate: '2026-01-02', endDate: '2026-08-31',
    initialCapital: 100000000, targetMode: 'amount', rounding: 'floor',
    assets: [
      { id: 'e1', code: RC, name: '분배O', payCycle: 'eom', targetAmount: 50000000 },
      { id: 'e2', code: RC2, name: '퇴출대상', payCycle: 'eom', targetAmount: 50000000 },
    ],
    // ⚠️ targets를 비워 둔다 — '목표를 0으로 내리지 않고 removeAssets만 지정'이 가장 흔한 사용법이고,
    //    바로 그 경우가 되살아났다.
    events: [{ id: 'x1', date: '2026-04-01', label: '퇴출', funding: 'defer', addAssets: [], removeAssets: ['e2'], targets: [] }],
    ...over,
  });
  const evRun = (over) => runBacktest({ config: mkEvt(over), prices: RPRICES, dividends: RDIVS, holidays: KR26 });
  const heldAfter = (r, id) => {
    const last = r.months[r.months.length - 1];
    const h = last.holdings.find((x) => x.assetId === id);
    return h ? h.qty : 0;
  };
  for (const [label, over] of [
    ['재투자 target', { policy: 'none', divReinvest: 'eom', divReinvestSplit: 'target' }],
    ['재투자 even', { policy: 'none', divReinvest: 'eom', divReinvestSplit: 'even' }],
    ['리밸런싱', { policy: 'allEom' }],
    ['리밸런싱+재투자', { policy: 'allEom', divReinvest: 'eom', divReinvestSplit: 'even' }],
  ]) {
    const r = evRun(over);
    const bought = r.months.flatMap((m) => m.trades).some((t) => t.assetId === 'e2' && t.qty > 0 && t.date > '2026-04-01');
    ok(`#141 ⚠️ 이벤트로 뺀 종목을 되사지 않는다 — ${label}`, !bought && heldAfter(r, 'e2') === 0);
  }
  ok('#142 ⚠️ 그래도 "아직 편입 전"인 중간 상장 종목은 재투자로 편입된다(removed와 active를 혼동하지 않았다)',
    (() => {
      const r = runBacktest({
        config: mkR({
          divReinvest: 'eom', divReinvestSplit: 'even', endDate: '2026-08-31',
          assets: [
            { id: 'n1', code: RC, name: '기존', payCycle: 'eom', targetAmount: 100000000 },
            { id: 'n2', code: RC2, name: '중간편입', payCycle: 'eom', targetAmount: 0, startDate: '2026-05-01' },
          ],
        }),
        prices: RPRICES, dividends: RDIVS, holidays: KR26,
      });
      return r.months.flatMap((m) => m.trades).some((t) => t.assetId === 'n2' && t.reinvest && t.qty > 0);
    })());

  // ⚠️ #143 — 기본 증액 규칙이 리밸런싱 0회에서 경고 없이 사라지던 결함.
  ok('#143 ⚠️ 리밸런싱이 없으면 매월 목표 증액이 사라진다는 사실을 경고한다',
    (() => {
      const r = runR({ contribution: { mode: 'amount', value: 1000000, split: 'ratio' } });
      return r.summary.cumContribution === 0
        && r.warnings.some((w) => w.includes('매월 목표 증액이 전혀 집행되지 않습니다'));
    })());
  ok('#143b 리밸런싱이 있으면 그 경고를 띄우지 않는다(거짓 경고 방지)',
    !runR({ policy: 'allEom', contribution: { mode: 'amount', value: 1000000, split: 'ratio' } })
      .warnings.some((w) => w.includes('매월 목표 증액이 전혀 집행되지 않습니다')));

  // ⚠️ #144 — 레벨 목표(목표 금액) + 리밸런싱 + 재투자 조합에서는 재투자분이 되팔려 실효가 없고
  //    되판 대금이 tradeNet만 부풀린다. 조용히 두면 비교 표 순위가 뒤바뀐다.
  //    ⚠️ 비중 모드는 분모가 평가액이라 재투자가 분모를 함께 키운다 → 되팔리지 않는다(경고 없음).
  const churnWarn = (r) => r.warnings.some((w) => w.includes('되팝니다'));
  ok('#144 ⚠️ 목표 금액 + 리밸런싱 + 재투자 조합을 경고한다',
    churnWarn(runR({ policy: 'allEom', divReinvest: 'eom' })));
  ok('#144b 재투자가 살아 있는 조합(비중 모드 / 리밸런싱 없음)에는 그 경고를 띄우지 않는다',
    !churnWarn(runR({ policy: 'allEom', divReinvest: 'eom', targetMode: 'ratio',
      assets: [{ id: 'r1', code: RC, name: 'R', payCycle: 'eom', targetRatio: 100 }] }))
      && !churnWarn(runR({ divReinvest: 'eom' })));

  // ⚠️ #145 — 'source'(DRIP)에서는 자기 분배 이력이 없는 신규 편입 종목이 **영원히** 매수되지
  //    않는데, 옛 경고는 '분배금이 없으면'이라고만 해서 사실과 달랐다.
  ok('#145 ⚠️ source 배분에서 신규 편입 종목이 매수되지 않는다는 사실을 정확히 경고한다',
    (() => {
      const r = runBacktest({
        config: mkR({
          divReinvest: 'eom', divReinvestSplit: 'source', endDate: '2026-08-31',
          assets: [
            { id: 's1', code: RC, name: '기존', payCycle: 'eom', targetAmount: 100000000 },
            { id: 's2', code: RC2, name: '신규', payCycle: 'eom', targetAmount: 0, startDate: '2026-05-01' },
          ],
        }),
        prices: RPRICES, dividends: RDIVS, holidays: KR26,
      });
      const bought = r.months.flatMap((m) => m.trades).some((t) => t.assetId === 's2' && t.qty > 0);
      return !bought && r.warnings.some((w) => w.includes('DRIP') && w.includes('매수되지 않습니다'));
    })());

  console.log(`      · 재투자 효과(단일종목 고정가 픽스처): 보유만 ${Math.round(hold.summary.finalTotal).toLocaleString('ko-KR')}`
    + ` / 월말 재투자 ${Math.round(reEom.summary.finalTotal).toLocaleString('ko-KR')}`
    + ` / 지급일 재투자 ${Math.round(rePay.summary.finalTotal).toLocaleString('ko-KR')}`);
}

console.log('\n── 파트④-j 평가금 고정 보조 규칙 (#157~#199) ──');
// 밴드 / 매수 재원 / 급락 분할투입 / 현금 바닥선 / 연간 가드레일 증액 / 분배금 원천징수.
// ⚠️ 각 기능마다 **'동작 케이스'와 '기본값 무영향 케이스'를 쌍으로** 둔다 — 무영향 케이스가
//    없으면 "기본값에서 기존 시나리오 결과가 1원도 달라지지 않는다"는 하위호환 계약이 무방비다.
{
  const SC = 'SS';
  const SC2X = 'TT';   // 2종목 배분 검증용(초기 매수 분모)
  const bizAll = businessDaysBetween('2026-01-02', '2027-12-31', HOL);
  const mkSeries = (fn) => Object.fromEntries(bizAll.map((d, i) => [d, fn(i, d)]));
  // 파동형 — 목표 금액 고정 리밸런싱이 매달 실제로 매매하도록.
  const WAVE = mkSeries((i) => 10000 + (i % 20) * 250);
  // 급락형 — 고점 10000 → −35% → 신고가까지 회복(급락 3단계가 순서대로 발동한다).
  const CRASH = mkSeries((i) => (i < 60 ? 10000 : i < 120 ? Math.round(10000 * (1 - (i - 60) * 0.006)) : Math.round(6500 * (1 + (i - 120) * 0.006))));
  const FLAT = mkSeries(() => 10000);
  const allYms = (() => { const o = []; for (let y = 2026; y <= 2027; y++) for (let m = 1; m <= 12; m++) o.push(`${y}-${pad2(m)}`); return o; })();
  const SDIV = { [SC]: Object.fromEntries(allYms.map((y) => [y, 100])) };

  const mkS = (over = {}) => makeBtConfig({
    id: 's', name: '보조규칙', startDate: '2026-01-02', endDate: '2026-12-31',
    initialCapital: 100000000, targetMode: 'amount', rounding: 'floor', policy: 'allEom',
    assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 50000000 }],
    ...over,
  });
  const runS = (over = {}, prices = WAVE, dividends = SDIV) =>
    runBacktest({ config: mkS(over), prices: { [SC]: prices }, dividends, holidays: KR26 });
  const nTrades = (r) => r.months.reduce((s, m) => s + m.trades.length, 0);
  // ⚠️ 예수금 두 주머니 불변식은 새 옵션 **전 조합**에서 성립해야 한다.
  const pocketOk = (r) => Math.abs(r.summary.finalCashTrade + r.summary.finalCashDiv - r.summary.finalCash) < 1e-6;

  const S0 = runS();
  ok('#157 픽스처 sanity — 기준 시나리오가 매매도 하고 분배금도 받는다',
    nTrades(S0) > 0 && S0.summary.cumDivAccrued > 0);

  // ── A. 리밸런싱 밴드 ──
  {
    const b100 = runS({ band: 100 });
    const b3 = runS({ band: 3 });
    ok('#158 ⚠️ band 기본 0 = 무영향(생략 0건 · 결과가 종전과 동일)',
      S0.summary.bandSkipCount === 0 && S0.summary.bandSkipAmount === 0
        && JSON.stringify(S0.months.map((m) => m.trades.length)) === JSON.stringify(runS({ band: 0 }).months.map((m) => m.trades.length)));
    ok('#159 band=100 → 정기 리밸런싱 매매가 전부 생략된다', nTrades(b100) === 0 && nTrades(S0) > 0);
    ok('#160 생략 집계(건수·금액)가 잡힌다', b100.summary.bandSkipCount > 0 && b100.summary.bandSkipAmount > 0);
    ok('#161 밴드 폭이 좁으면 일부만 생략된다(0 < 생략 < 전체)',
      b3.summary.bandSkipCount > 0 && nTrades(b3) > 0 && nTrades(b3) < nTrades(S0));
    eq('#162 summary 집계 = Σ 월별 집계', b100.summary.bandSkipCount,
      b100.months.reduce((s, m) => s + m.bandSkipCount, 0));
    // ⚠️ 목표 0(전량 청산)은 밴드 폭도 0이라 자동 예외다 — 청산은 반드시 완결돼야 한다.
    ok('#163 ⚠️ 목표 0(전량 청산)은 밴드와 무관하게 실행된다',
      runS({ band: 100, events: [{ id: 'e', date: '2026-06-15', label: '청산', funding: 'defer', addAssets: [], removeAssets: [], targets: [{ assetId: 's1', amount: 0 }] }] })
        .months.some((m) => m.trades.some((t) => t.qty < 0)));
    // ⚠️ 밴드는 **정기 리밸런싱 전용**이다. 이벤트(구조 변경) 매매까지 막으면 재편이 조용히 실패한다.
    ok('#164 ⚠️ 밴드는 이벤트(구조 변경) 매매를 막지 않는다',
      runS({ band: 100, events: [{ id: 'e2', date: '2026-06-15', label: '재편', funding: 'reallocate', addAssets: [], removeAssets: [], targets: [{ assetId: 's1', amount: 20000000 }] }] })
        .months.some((m) => m.trades.some((t) => t.structural)));
    ok('#165 밴드 조합에서도 주머니 불변식 유지', pocketOk(b100) && pocketOk(b3));
  }

  // ── B. 평시 매수 재원 제한 ──
  {
    const over = { contribution: { mode: 'pctOfCash', value: 100, split: 'ratio' } };
    const both = runS(over);
    const only = runS({ ...over, buyFunding: 'tradeOnly' });
    ok('#166 ⚠️ buyFunding 기본 both = 무영향(분배금 주머니를 종전대로 헐어 쓴다)',
      both.months.some((m) => m.cashUsedDiv > 0));
    ok('#167 tradeOnly → 정기 매수가 분배금 주머니를 1원도 쓰지 않는다',
      only.months.every((m) => m.cashUsedDiv === 0));
    ok('#168 tradeOnly의 기말 cashDiv = 누적 입금 분배금(한 푼도 안 썼다)',
      Math.abs(only.summary.finalCashDiv - only.summary.cumDivPaid) < 1e-6 && only.summary.cumDivPaid > 0);
    // ⚠️ 재투자 매수는 원래 'div' 출금이라 이 설정과 무관해야 한다.
    ok('#169 ⚠️ 분배금 재투자는 buyFunding과 무관하게 그대로 돈다',
      Math.abs(runS({ divReinvest: 'payDate' }).summary.cumReinvestNet
             - runS({ divReinvest: 'payDate', buyFunding: 'tradeOnly' }).summary.cumReinvestNet) < 1e-6
        && runS({ divReinvest: 'payDate' }).summary.cumReinvestNet < 0);
    // ⚠️ allowNegativeCash와 함께 쓰면 cashTrade만 음수로 진다(cashDiv는 손도 대지 않는다).
    //    ⚠️ 이 조합이 `applyCash`의 **divCap 인자가 유일하게 일하는 경로**다 — 음수 허용이면
    //       adjustTo의 예산 상한(limited)이 통째로 꺼져 출금 시점의 divCap만이 분배금 주머니를 지킨다.
    //       그래서 `finalCashDiv >= 0`(주머니가 비어도 통과)이 아니라 **한 푼도 안 줄었다**로 단언한다.
    {
      const neg = runS({ buyFunding: 'tradeOnly', allowNegativeCash: true,
        assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 300000000 }] });
      ok('#170 ⚠️ tradeOnly + 음수 허용 → cashTrade만 음수, 분배금 주머니는 그대로',
        neg.summary.finalCashTrade < 0
          && neg.summary.cumDivPaid > 0
          && Math.abs(neg.summary.finalCashDiv - neg.summary.cumDivPaid) < 1e-6
          && neg.months.every((m) => m.cashUsedDiv === 0)
          && pocketOk(neg));
    }
    ok('#171 재원 제한 조합에서도 주머니 불변식 유지', pocketOk(both) && pocketOk(only));
  }

  // ── C. 시그널 리밸런싱(매수 = 급락 분할투입 / 매도 = 반등) ──
  {
    // ⚠️ 매매 예수금에 여유가 있으면 적립 분배금을 헐 일이 없다(설계상 예수금 → 재조정 → 분배금 순).
    //    초기 투자금을 목표에 바짝 붙여 cashTrade가 마르는 상황을 만든다 → 재원은 사실상 적립 분배금.
    //    ⚠️ `buyFunding` 기본값('예수금 전부')로 둬야 그 경로가 열린다 — tradeOnly는 분배금을 통째로
    //       잠그므로(2026-08 사용자 정의) 여기서 쓰면 재원이 0에 붙어 아무것도 검증하지 못한다.
    const dipCfg = { initialCapital: 50200000,
      dip: { enabled: true, levels: DEFAULT_DIP_LEVELS } };
    const D = runS(dipCfg, CRASH);
    const DOff = runS({ ...dipCfg, dip: { enabled: false, levels: DEFAULT_DIP_LEVELS } }, CRASH);
    const buys = D.summary.signalEvents.filter((e) => e.kind === 'buy');
    ok('#172 ⚠️ dip 기본 enabled:false = 무영향(발동 0건)',
      DOff.summary.signalEvents.length === 0 && runS({}, CRASH).summary.signalEvents.length === 0);
    deep('#173 고점 대비 −10/−20/−30 3단계가 순서대로 발동한다', buys.map((e) => e.level), [10, 20, 30]);
    ok('#174 발동일 종가가 실제로 그 낙폭에 도달했다',
      buys.every((e) => ((e.ref - e.price) / e.ref) * 100 >= e.level - 1e-9));
    // ⚠️ 2026-08 재정의 — 단계 비율은 '분배금 개방 비율'이 아니라 **매수 재원의 투입 비율**이다.
    //    매수액 = min(재원 스냅샷 × 비율합, 목표 미달액) 이고 목표에서 잘린다.
    ok('#175 목표 매수액 = min(매수 재원 × 비율합, 목표 미달액)', (() => {
      const cs = buys.filter((e) => e.carrier);
      return cs.length > 0
        && cs.every((e) => e.poolAt > 0 && e.pctSum !== null
          && e.planned <= (e.poolAt * e.pctSum) / 100 + 1e-6)
        && cs.some((e) => e.planned > 0);
    })());
    ok('#176 실제 체결액 ≤ 목표 매수액(반올림은 내림 방향)',
      buys.every((e) => e.tradeAmount <= e.planned + 1e-6));
    // ⚠️ **목표 상한**(사용자 확정: "목표에서 자름") — 재원이 넉넉해 `재원 × 비율`이 목표 미달액을
    //    넘는 상황을 일부러 만든다. 이 픽스처가 없으면 `Math.min(need, ...)`를 지워도 통과한다
    //    (기본 픽스처는 재원이 얇아 언제나 비율 쪽이 작다 — 변이 M10으로 실측).
    ok('#175b ⚠️ 재원 × 비율이 목표 미달액을 넘으면 **목표에서 자른다**(초과 매수 금지)', (() => {
      const r = runS({
        policy: 'none', extraCash: 50000000,
        dip: { enabled: true, levels: [{ drop: 10, buyPct: 100 }] },
      }, CRASH);
      const cs = r.summary.signalEvents.filter((e) => e.kind === 'buy' && e.carrier);
      const ts = r.months.flatMap((m) => m.trades).filter((t) => t.signal === 'buy');
      return cs.length > 0 && ts.length > 0
        // 재원이 목표 미달액보다 훨씬 크다(= 상한이 실제로 걸리는 상황)
        && cs.some((e) => (e.poolAt * e.pctSum) / 100 > e.planned + 1)
        // 그런데도 평가액이 목표(5,000만)를 넘지 않는다(1주 반올림 여유)
        && ts.every((t) => t.evalAfter <= 50000000 + t.price);
    })());
    ok('#177 ‘예수금 전부’ 모드에서는 적립 분배금이 실제로 매수에 쓰인다',
      buys.some((e) => e.used > 0) && D.months.some((m) => m.cashUsedDiv > 0));
    // ⚠️ 사용자 정의(2026-08)의 핵심 계약 — '매매 예수금만'이면 시그널 매수도 분배금을 1원도 안 쓴다.
    //    옛 설계는 여기서 `적립 분배금 × 단계 비율`을 열어 썼다(그 동작으로 되돌리면 이 단언이 깨진다).
    // ⚠️ 픽스처는 반드시 **'목표까지'(buyPct=null)** 단계여야 이 계약이 관측된다 — 비율 단계는
    //    planned가 이미 `cashTrade × 비율` 이하라 매매 예수금만으로 늘 충당되고, 잠금을 풀어도
    //    분배금을 건드릴 일이 없어 **지워도 통과하는 죽은 단언**이 된다(변이 테스트 M1로 실측).
    ok('#177b ⚠️ ‘매매 예수금만’이면 시그널 매수도 적립 분배금을 1원도 쓰지 않는다', (() => {
      const cfg = { ...dipCfg, dip: { enabled: true, levels: [{ drop: 10, buyPct: null }] }, policy: 'none' };
      const only = runS({ ...cfg, buyFunding: 'tradeOnly' }, CRASH);
      const all = runS({ ...cfg, buyFunding: 'both' }, CRASH);
      const bs = only.summary.signalEvents.filter((e) => e.kind === 'buy');
      const bought = (r) => r.months.flatMap((m) => m.trades)
        .filter((t) => t.signal === 'buy').reduce((s, t) => s + Math.abs(t.cashDelta), 0);
      return bs.length > 0
        && bs.every((e) => e.used === 0)
        && only.months.every((m) => m.cashUsedDiv === 0)
        && Math.abs(only.summary.finalCashDiv - only.summary.cumDivPaid) < 1e-6
        && only.summary.cumDivDrawn === 0
        // 같은 조건의 '예수금 전부'는 분배금까지 써서 **더 많이 산다** — 잠금이 실제로 일한다는 증거.
        && all.summary.cumDivDrawn > 0 && bought(all) > bought(only)
        && pocketOk(only) && pocketOk(all);
    })());
    // ⚠️ 비율 칸을 비우면(null) '목표까지' — 종전 동작이자 재조정이 도는 유일한 모드다.
    // ⚠️ 적대적 리뷰 확정 결함 — '비율이 0%라 안 산다'와 '재원이 0원이라 못 산다'를 뭉뚱그리면
    //    40%를 넣은 사용자에게 화면이 "매수 비율 0%"라고 단언한다. KPI 팝오버는 이 note가 유일한 설명이다.
    ok('#175c ⚠️ 미체결 사유가 ‘비율 0%’와 ‘재원 없음’으로 갈린다', (() => {
      // (a) 재원 0원 — 초기 투자금을 목표에 딱 맞춰 예수금이 마르고, tradeOnly라 분배금도 잠겨 있다.
      const dry = runS({
        policy: 'none', buyFunding: 'tradeOnly', initialCapital: 50000000,
        dip: { enabled: true, levels: [{ drop: 10, buyPct: 40 }] },
      }, CRASH);
      const dryEv = dry.summary.signalEvents.filter((e) => e.kind === 'buy' && e.carrier);
      // (b) 비율 0% — 재원은 넉넉한데 사용자가 0%를 적었다.
      const zero = runS({
        policy: 'none', extraCash: 30000000,
        dip: { enabled: true, levels: [{ drop: 10, buyPct: 0 }] },
      }, CRASH);
      const zeroEv = zero.summary.signalEvents.filter((e) => e.kind === 'buy' && e.carrier);
      return dryEv.length > 0 && zeroEv.length > 0
        && dryEv.every((e) => e.poolAt === 0 && e.pctSum === 40 && e.note === '재원 없음')
        && zeroEv.every((e) => e.poolAt > 0 && e.pctSum === 0 && e.note === '매수 비율 0% — 사지 않음');
    })());
    ok('#177c ⚠️ 비율 칸이 비면(null) 목표까지 매수한다(재원 한도 안에서)', (() => {
      const r = runS({ ...dipCfg, dip: { enabled: true, levels: [{ drop: 10, buyPct: null }] } }, CRASH);
      const cs = r.summary.signalEvents.filter((e) => e.kind === 'buy' && e.carrier);
      return cs.length > 0 && cs.every((e) => e.pctSum === null && e.planned > 0);
    })());
    // ⚠️ 정기 리밸런싱을 켠 채로는 dip이 '며칠 앞당겨 사는 것'뿐이라 총자산 방향이 픽스처에 좌우된다.
    //    시그널이 **유일한 매수 경로**인 policy:'none'에서 비교해야 이 단언이 구조적으로 성립한다
    //    (그것이 2026-08에 시그널을 당일 체결로 바꾼 이유이기도 하다).
    ok('#178 dip이 실제로 결과를 바꾼다(리밸런싱이 없어도 바닥에서 매수한다)', (() => {
      const on = runS({ ...dipCfg, policy: 'none' }, CRASH);
      const off = runS({ ...dipCfg, policy: 'none', dip: { enabled: false, levels: DEFAULT_DIP_LEVELS } }, CRASH);
      return nTrades(on) > 0 && nTrades(off) === 0
        && Math.abs(on.summary.finalTotal - off.summary.finalTotal) > 1;
    })());
    // ⚠️ 고점 갱신 전에는 단계당 1회. 새 고점이 서면 재무장(같은 단계가 다시 발동).
    ok('#179 ⚠️ 고점 갱신 전에는 같은 단계가 두 번 발동하지 않는다',
      runS({ ...dipCfg, dip: { enabled: true, levels: [{ drop: 10, buyPct: 50 }] } }, CRASH).summary.signalEvents.length === 1);
    {
      // 고점10000 → −15% → 신고가12000 → −12.5% : −10% 단계가 재무장돼 두 번 발동해야 한다.
      const REARM = mkSeries((i) => (i < 30 ? 10000 : i < 60 ? 8500 : i < 90 ? 12000 : 10500));
      ok('#180 ⚠️ 새 고점이 서면 전 단계가 재무장돼 다시 발동한다',
        runS({ ...dipCfg, dip: { enabled: true, levels: [{ drop: 10, buyPct: 50 }] } }, REARM).summary.signalEvents.length === 2);
    }
    // ⚠️ 밴드는 **정기 리밸런싱 전용**이라 시그널 매매를 막지 못한다(시그널은 자기 발동일에 체결된다).
    ok('#181 ⚠️ band=100이어도 시그널 매수는 그대로 체결된다(밴드는 정기 리밸런싱 전용)',
      nTrades(runS({ ...dipCfg, band: 100 }, CRASH)) > 0
        && nTrades(runS({ ...dipCfg, band: 100, dip: { enabled: false, levels: DEFAULT_DIP_LEVELS } }, CRASH)) === 0);
    ok('#182 dip 조합에서도 주머니 불변식 유지', pocketOk(D));

    /* ── C-2. 시그널 당일 실행 (2026-08 전환) ────────────────────────────────
     * 옛 설계는 개방만 하고 **다음 정기 리밸런싱**에서 매수했다 — policy:'none'이면 그 회차가
     * 영영 오지 않아 "개방 ₩0 → 사용 ₩0"만 찍히고 기능이 통째로 죽었다(사용자 보고).
     * ===================================================================== */
    ok('#300 ⚠️ 체결일 = 발동일 (그날 종가로 즉시 매매한다)', (() => {
      const trades = D.months.flatMap((m) => m.trades).filter((t) => t.signal === 'buy');
      if (!trades.length) return false;
      const evDates = new Set(buys.map((e) => e.date));
      return trades.every((t) => evDates.has(t.date))
        && buys.filter((e) => e.tradeQty > 0).every((e) => e.price > 0);
    })());
    ok('#301 ⚠️ policy:"none"(리밸런싱 안 함)에서도 시그널이 실제로 매수한다', (() => {
      const r = runS({ ...dipCfg, policy: 'none' }, CRASH);
      return r.summary.signalEvents.some((e) => e.kind === 'buy' && e.tradeQty > 0)
        && r.months.flatMap((m) => m.trades).some((t) => t.signal === 'buy')
        && pocketOk(r);
    })());
    ok('#302 ⚠️ 분배락 전 리밸런싱과 시그널을 **동시에** 켤 수 있다(둘 다 체결된다)', (() => {
      const r = runS({ ...dipCfg, policy: 'allEom' }, CRASH);
      const ts = r.months.flatMap((m) => m.trades);
      return ts.some((t) => t.signal === 'buy') && ts.some((t) => !t.signal && !t.structural && !t.reinvest);
    })());
    ok('#303 ⚠️ 시그널 매매는 tradeNet에 들어간다(structural·reinvest로 새지 않는다)', (() => {
      const ts = D.months.flatMap((m) => m.trades).filter((t) => t.signal);
      return ts.length > 0 && ts.every((t) => !t.structural && !t.reinvest);
    })());
    ok('#304 ⚠️ 시그널 조합에서도 기말 예수금 분해 항등식이 성립한다', (() => {
      const s = D.summary;
      const lhs = s.finalCash;
      const rhs = D.initialCashAfter + s.cumTradeNet + s.cumStructuralNet + s.cumReinvestNet + s.cumDivPaid;
      return Math.abs(lhs - rhs) < 1e-6;
    })());
    /* ── 예수금 / 적립 분배금 분리 표기의 근거 (2026-08) ─────────────────────
     * ⚠️ 화면·CSV의 '기말 보유 현황'이 이 **두 항등식을 그대로 렌더**한다.
     *      finalCashTrade = 초기잔여(+추가예수금) + 매매차익 + 재편 + 재투자 + cumDivDrawn
     *      finalCashDiv   = cumDivPaid − cumDivDrawn
     *    두 식을 더하면 종전 #110 항등식이 그대로 복원된다(그래서 #304가 계속 성립한다).
     * ===================================================================== */
    ok('#304b ⚠️ 기말 현금 분해 항등식 2개(예수금 / 적립 분배금)가 각각 성립한다', (() => {
      // ⚠️ 예비금 주머니가 생기면서 분해가 **3개**가 됐다. cashTrade의 시드가 initialCapital로
      //    줄었고(−extraCash), 예비금이 대신 낸 매수 대금만큼 cashTrade가 덜 나갔다(+cumReserveDrawn).
      const chk = (r, extra = 0) => {
        const s = r.summary;
        return s.cumDivDrawn >= -1e-9 && s.cumReserveDrawn >= -1e-9
          && Math.abs(s.finalCashTrade
            - ((r.initialCashAfter - extra) + s.cumTradeNet + s.cumStructuralNet + s.cumReinvestNet
               + s.cumDivDrawn + s.cumReserveDrawn)) < 1e-6
          && Math.abs(s.finalCashDiv - (s.cumDivPaid - s.cumDivDrawn)) < 1e-6
          && Math.abs(s.finalCashReserve - (extra - s.cumReserveDrawn)) < 1e-6;
      };
      return chk(D)
        && chk(runS({}, WAVE))
        && chk(runS({ divReinvest: 'eom' }, WAVE))
        && chk(runS({ divTaxPct: 15.4 }, WAVE))
        && chk(runS({ buyFunding: 'tradeOnly' }, WAVE))
        && chk(runS({ extraCash: 30000000 }, WAVE), 30000000);
    })());
    // ⚠️ 이 픽스처가 없으면 cumDivDrawn이 항상 0이라 위 항등식이 **자명하게** 성립해
    //    연결 항을 지워도 통과하는 죽은 단언이 된다(변이 테스트로 확인할 것).
    ok('#304c 픽스처 sanity — 분배금에서 실제로 매수 대금을 꺼낸 조합이 포함돼 있다',
      D.summary.cumDivDrawn > 0);

    /* ── 초기 매수는 초기 투자금만 쓴다 (사용자 확정 2026-08) ────────────────── */
    // ⚠️ **비중 모드**로 확인해야 한다 — 목표 금액 모드는 `targetOf`가 base를 아예 보지 않아,
    //    분모를 옛 식(`initialCapital + extraCash`)으로 되돌려도 결과가 같다(변이 M2로 실측).
    //    금액 모드 쪽 계약(예산 캡)은 아래 #323b가 따로 잡는다.
    ok('#323 ⚠️ 추가 예수금은 초기 매수에 쓰지 않고 예수금으로 남는다(비중 분모 = 초기 투자금)', (() => {
      // ⚠️ 종목이 **2개 이상**이어야 분모 오염이 드러난다 — 1종목이면 예산 캡이 총액을 같게 만들어
      //    분모를 옛 식으로 되돌려도 결과가 같다(equivalent mutant, 변이 M2로 실측).
      //    2종목이면 분모가 부풀 때 앞 종목이 과매수하고 뒤 종목이 예산에 잘려 **배분이 기운다**.
      const ratioCfg = {
        policy: 'none', targetMode: 'ratio',
        assets: [
          { id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetRatio: 50 },
          { id: 's2', code: SC2X, name: 'TT', payCycle: 'eom', targetRatio: 50 },
        ],
      };
      const run2a = (over) => runBacktest({
        config: mkS({ ...ratioCfg, ...over }),
        prices: { [SC]: FLAT, [SC2X]: FLAT }, dividends: {}, holidays: KR26,
      });
      const qtyOf = (r) => r.initialTrades.reduce((s, t) => s + t.qty, 0);
      const spentOf = (r) => r.initialTrades.reduce((s, t) => s + Math.abs(t.cashDelta), 0);
      const perAsset = (r) => JSON.stringify(r.initialTrades.map((t) => [t.assetId, t.qty]));
      const b0 = run2a({ extraCash: 0 });
      const bx = run2a({ extraCash: 30000000 });
      return qtyOf(b0) === qtyOf(bx) && qtyOf(b0) > 0
        && Math.abs(spentOf(b0) - 100000000) < 10000        // 초기 투자금 전액(잔돈만 남음)
        && Math.abs(spentOf(b0) - spentOf(bx)) < 1e-6
        // 50/50 배분이 그대로 유지된다(분모가 부풀면 앞 종목으로 기운다)
        && perAsset(b0) === perAsset(bx)
        && JSON.stringify(b0.initialTrades.map((t) => t.qty)) === JSON.stringify([5000, 5000])
        && Math.abs(bx.initialCashAfter - b0.initialCashAfter - 30000000) < 1e-6;
    })());
    // ⚠️ 종목이 **2개 이상 + 목표 합계 > 초기 투자금**이어야 예산이 매수마다 줄어드는 것까지
    //    검증된다 — 1종목이면 잔여를 차감하지 않아도 결과가 같다(변이 M13으로 실측).
    ok('#323b ⚠️ 목표 합계가 초기 투자금을 넘어도 추가 예수금을 헐지 않는다(예산이 매수마다 줄어든다)', (() => {
      // 목표 4,000만 × 2 = 8,000만인데 초기 투자금은 5,000만 — 옛 코드는 추가 예수금까지 끌어 썼다.
      const r = runBacktest({
        config: mkS({
          policy: 'none', initialCapital: 50000000, extraCash: 50000000,
          assets: [
            { id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 40000000 },
            { id: 's2', code: SC2X, name: 'TT', payCycle: 'eom', targetAmount: 40000000 },
          ],
        }),
        prices: { [SC]: FLAT, [SC2X]: FLAT }, dividends: {}, holidays: KR26,
      });
      const spent = r.initialTrades.reduce((s, t) => s + Math.abs(t.cashDelta), 0);
      return spent > 0 && spent <= 50000000 + 1e-6
        && r.initialTrades.length === 2
        && Math.abs(r.initialCashAfter - (100000000 - spent)) < 1e-6;
    })());
    ok('#323c ⚠️ extraCash === 0이면 결과가 종전과 1원도 다르지 않다(하위호환)', (() => {
      const a = runS({}, WAVE);
      return JSON.stringify(a.initialTrades.map((t) => [t.code, t.qty, Math.round(t.cashDelta)]))
        === JSON.stringify(runS({ extraCash: 0 }, WAVE).initialTrades.map((t) => [t.code, t.qty, Math.round(t.cashDelta)]))
        && Math.abs(a.initialCashAfter - 50000000) < 1e-6;
    })());

    /* ── C-3. 매도 시그널 (가격 저점 대비 +N% 반등) ── */
    {
      // 저점 8000 → +25% 반등(10000) → 다시 하락. +10%/+20% 두 단계가 순서대로 발동한다.
      const REB = mkSeries((i) => (i < 30 ? 12000 : i < 60 ? 8000 : i < 90 ? 8000 + (i - 60) * 80 : 9000));
      const sellCfg = {
        initialCapital: 100000000,
        assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 30000000 }],
        dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10 }, { rise: 20 }] },
      };
      const S = runS(sellCfg, REB);
      const sells = S.summary.signalEvents.filter((e) => e.kind === 'sell');
      ok('#305 ⚠️ 매도 시그널 기본값은 빈 배열 = 무영향(레거시 결과 불변)', (() => {
        const off = runS({ ...sellCfg, dip: { enabled: true, levels: DEFAULT_DIP_LEVELS } }, REB);
        return off.summary.signalEvents.every((e) => e.kind === 'buy')
          && makeBtConfig({}).dip.sellLevels.length === 0;
      })());
      deep('#306 저점 대비 +10/+20% 두 단계가 순서대로 발동한다', sells.map((e) => e.level), [10, 20]);
      ok('#307 발동일 종가가 실제로 그 상승률에 도달했다(기준 = 가격 저점)',
        sells.every((e) => ((e.price - e.ref) / e.ref) * 100 >= e.level - 1e-9));
      ok('#308 ⚠️ 매도 시그널은 목표를 넘는 만큼만 판다(매수로 뒤집히지 않는다)', (() => {
        const ts = S.months.flatMap((m) => m.trades).filter((t) => t.signal === 'sell');
        return ts.length > 0 && ts.every((t) => t.qty < 0 && t.evalBefore > t.target - 1e-6);
      })());
      // ⚠️ 이 케이스가 없으면 '매도 시그널이 매수로 뒤집히지 않는다'는 가드가 **도달 불가**가 되어
      //    지워도 통과하는 죽은 단언이 된다(변이 테스트로 실측). 목표에 한참 못 미치는 보유 상태를
      //    만들어(초기 자본 < 목표) 반등 시그널이 매수 방향으로 계산되게 한 뒤, 매매가 0건임을 본다.
      ok('#308b ⚠️ 목표 미달 보유에서 반등 시그널이 떠도 **매수하지 않는다**(매도 전용)', (() => {
        const r = runS({
          ...sellCfg, policy: 'none', initialCapital: 10000000,
          assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 30000000 }],
        }, REB);
        const sellEv = r.summary.signalEvents.filter((e) => e.kind === 'sell');
        return sellEv.length > 0
          && sellEv.every((e) => e.tradeQty === 0)
          && r.months.flatMap((m) => m.trades).every((t) => t.signal !== 'sell');
      })());
      ok('#309 ⚠️ 매도 대금은 **매매 주머니**로 간다(분배금 주머니를 늘리지 않는다)', (() => {
        const ts = S.months.flatMap((m) => m.trades).filter((t) => t.signal === 'sell');
        return ts.length > 0 && pocketOk(S)
          && S.summary.finalCashDiv <= S.summary.cumDivPaid + 1e-6;
      })());
      ok('#310 ⚠️ 새 저점이 서면 매도 전 단계가 재무장된다', (() => {
        // 저점8000 → +12.5%(9000) → 새 저점 7000 → +14.3%(8000): +10% 단계가 두 번 발동.
        const RE2 = mkSeries((i) => (i < 30 ? 8000 : i < 60 ? 9000 : i < 90 ? 7000 : 8000));
        const r = runS({ ...sellCfg, dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10 }] } }, RE2);
        return r.summary.signalEvents.filter((e) => e.kind === 'sell').length === 2;
      })());
      ok('#311 ⚠️ 보유가 없으면 매도 시그널은 아무 일도 하지 않는다(빈 이벤트로 기록만)', (() => {
        const r = runS({
          ...sellCfg,
          assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 0 }],
        }, REB);
        const ts = r.months.flatMap((m) => m.trades).filter((t) => t.signal === 'sell');
        return ts.length === 0 && pocketOk(r);
      })());
      ok('#312 ⚠️ 매도 시그널 단계 정규화 — 오름차순 + 중복 제거 + 범위 밖 제외 + 빈 배열 유지', (() => {
        const c = makeBtConfig({ dip: { enabled: true, sellLevels: [{ rise: 20 }, { rise: 10 }, { rise: 20 }, { rise: 0 }, { rise: -5 }] } });
        return JSON.stringify(c.dip.sellLevels) === JSON.stringify([{ rise: 10, sellPct: null }, { rise: 20, sellPct: null }])
          && makeBtConfig({ dip: { enabled: true, sellLevels: [{ rise: 0 }] } }).dip.sellLevels.length === 0;
      })());
      /* ── 매도 비율 (사용자 확정 2026-08: "초과 평가금액에 대한 비율로 매도") ──────
       * ⚠️ 밑변은 평가액이 아니라 **초과분**이다 — 그래야 목표 아래로 절대 내려가지 않는다.
       * ===================================================================== */
      const TGT = 30000000;
      ok('#312b ⚠️ 매도 비율 = 목표 초과분 × 비율이고 목표 아래로 내려가지 않는다', (() => {
        const r = runS({ ...sellCfg, policy: 'none',
          dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10, sellPct: 30 }] } }, REB);
        const ev = r.summary.signalEvents.filter((e) => e.kind === 'sell' && e.carrier && e.excessAt > 0);
        const ts = r.months.flatMap((m) => m.trades).filter((t) => t.signal === 'sell');
        return ev.length > 0 && ts.length > 0
          && ev.every((e) => e.pctSum === 30 && Math.abs(e.planned - e.excessAt * 0.3) < 1e-6)
          // 30%만 팔았으므로 매도 후에도 목표를 넘어야 한다(1주 반올림 여유).
          && ts.every((t) => t.qty < 0 && t.evalAfter > TGT - t.price)
          && pocketOk(r);
      })());
      ok('#312c ⚠️ 매도 비율이 비면(null) 목표까지 전량 매도한다(종전 동작)', (() => {
        const part = runS({ ...sellCfg, policy: 'none',
          dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10, sellPct: 30 }] } }, REB);
        const full = runS({ ...sellCfg, policy: 'none',
          dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10, sellPct: null }] } }, REB);
        const amt = (r) => r.months.flatMap((m) => m.trades)
          .filter((t) => t.signal === 'sell').reduce((s, t) => s + Math.abs(t.cashDelta), 0);
        const fev = full.summary.signalEvents.filter((e) => e.kind === 'sell' && e.carrier && e.excessAt > 0);
        return fev.length > 0 && fev.every((e) => e.pctSum === null && Math.abs(e.planned - e.excessAt) < 1e-6)
          // 비율(30%)로 판 금액보다 전량 매도가 반드시 크다 — 비율이 실제로 일한다는 증거.
          && amt(full) > amt(part) && amt(part) > 0;
      })());
      // ⚠️ 같은 날 두 매도 단계가 함께 발동하는 경우 — 옛 코드처럼 트리거마다 독립 실행하면
      //    **연쇄 적용**(10% 판 뒤 남은 초과분의 20%)이 돼 화면 계산식과 체결이 어긋난다.
      //    carrier 플래그가 한 행에만 서야 계산식 줄도 한 번만 그려진다(변이 M8이 노리는 자리).
      ok('#312e ⚠️ 같은 날 두 매도 단계가 겹치면 carrier 한 행에만 합산 체결한다(연쇄 적용 금지)', (() => {
        // 저점 8000 → 하루 만에 12000(+50%): +10%·+20% 두 단계가 같은 날 발동한다.
        const GAPUP = mkSeries((i) => (i < 30 ? 12000 : i < 60 ? 8000 : 12000));
        const r = runS({ ...sellCfg, policy: 'none',
          dip: { enabled: true, levels: DEFAULT_DIP_LEVELS,
            sellLevels: [{ rise: 10, sellPct: 20 }, { rise: 20, sellPct: 30 }] } }, GAPUP);
        const byKey = new Map();
        for (const e of r.summary.signalEvents.filter((x) => x.kind === 'sell')) {
          const k = `${e.date}|${e.assetId}`;
          if (!byKey.has(k)) byKey.set(k, []);
          byKey.get(k).push(e);
        }
        let sawDual = false;
        for (const list of byKey.values()) {
          if (list.length < 2) continue;
          sawDual = true;
          if (list.filter((e) => e.carrier).length !== 1) return false;
          const carrier = list.find((e) => e.carrier);
          // 비율은 **합산**(20+30=50%)이고 밑변은 그 시점 초과분 하나뿐이다.
          if (carrier.pctSum !== 50) return false;
          if (Math.abs(carrier.planned - carrier.excessAt * 0.5) > 1e-6) return false;
          if (list.filter((e) => !e.carrier).some((e) => e.excessAt !== 0 || e.planned !== 0 || e.tradeQty !== 0)) return false;
        }
        // 그날 그 종목의 매도 체결은 **1건**이어야 한다(연쇄 적용이면 2건이 된다).
        const dates = r.months.flatMap((m) => m.trades).filter((t) => t.signal === 'sell').map((t) => t.date);
        return sawDual && new Set(dates).size === dates.length;
      })());
      // ⚠️ 적대적 리뷰 확정 결함 — '목표 이하'로 조기 반환한 행의 pctSum이 null로 남으면
      //    사용자가 30%를 지정했는데 화면이 '목표 초과분 ₩0 전량'(= 목표까지)이라고 설명한다.
      ok('#312f ⚠️ ‘목표 이하 — 팔 것 없음’ 행도 지정한 매도 비율을 그대로 싣는다(pctSum null 금지)', (() => {
        // 목표(1억)에 한참 못 미치는 보유(초기 1,000만) → 반등 시그널은 뜨지만 팔 초과분이 없다.
        const r = runS({
          ...sellCfg, policy: 'none', initialCapital: 10000000,
          assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 100000000 }],
          dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10, sellPct: 30 }] },
        }, REB);
        const ev = r.summary.signalEvents.filter((e) => e.kind === 'sell' && e.carrier);
        return ev.length > 0
          && ev.every((e) => e.note === '목표 이하 — 팔 것 없음' && e.pctSum === 30 && e.excessAt === 0);
      })());
      ok('#312d ⚠️ 매도 대금은 예수금으로만 간다(적립 분배금을 늘리지 않는다)', (() => {
        const r = runS({ ...sellCfg, policy: 'none',
          dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10, sellPct: 30 }] } }, REB);
        return Math.abs(r.summary.finalCashDiv - (r.summary.cumDivPaid - r.summary.cumDivDrawn)) < 1e-6
          && pocketOk(r);
      })());
    }

    /* ── C-4. 재원 조달 3단계 (매매 주머니 → 재조정 → 분배금 개방) ── */
    {
      // A는 급락, B는 급등 — A를 채우려면 목표를 초과한 B를 팔아야 한다.
      const SC2 = 'BBB';
      const DOWN = mkSeries((i) => (i < 40 ? 10000 : 6000));
      const UP = mkSeries((i) => (i < 40 ? 10000 : 20000));
      const cfg2 = makeBtConfig({
        id: 's', name: '재조정', startDate: '2026-01-02', endDate: '2026-12-31',
        initialCapital: 40000000, targetMode: 'amount', rounding: 'floor', policy: 'none',
        buyFunding: 'tradeOnly',
        assets: [
          { id: 'a1', code: SC, name: 'A', payCycle: 'eom', targetAmount: 20000000 },
          { id: 'a2', code: SC2, name: 'B', payCycle: 'eom', targetAmount: 20000000 },
        ],
        dip: { enabled: true, levels: [{ drop: 20, buyPct: null }] },
      });
      const run2 = (over) => runBacktest({
        config: { ...cfg2, ...(over || {}) },
        prices: { [SC]: DOWN, [SC2]: UP }, dividends: {}, holidays: KR26,
      });
      const R = run2();
      ok('#313 ⚠️ 예수금이 모자라면 목표 초과 종목을 팔아 재원을 만든다(재조정)', (() => {
        const ts = R.months.flatMap((m) => m.trades);
        const re = ts.filter((t) => t.signal === 'realloc');
        return re.length > 0 && re.every((t) => t.qty < 0 && t.code === SC2)
          && ts.some((t) => t.signal === 'buy' && t.code === SC && t.qty > 0);
      })());
      // ⚠️ 재조정은 '목표까지'(buyPct=null) 단계에만 돈다 — 비율 매수는 "가진 현금의 일부만
      //    투입"이 규칙이라 재원 부족이라는 개념 자체가 없다(사용자 확정 2026-08).
      ok('#313b ⚠️ 비율 매수(buyPct 지정)에는 재조정이 돌지 않는다', (() => {
        const r = run2({ dip: { ...cfg2.dip, levels: [{ drop: 20, buyPct: 50 }] } });
        return r.summary.signalEvents.some((e) => e.kind === 'buy')
          && r.months.flatMap((m) => m.trades).every((t) => t.signal !== 'realloc');
      })());
      ok('#314 ⚠️ reallocate:false면 재조정하지 않는다(기본값은 true)', (() => {
        const off = run2({ dip: { ...cfg2.dip, reallocate: false } });
        return off.months.flatMap((m) => m.trades).every((t) => t.signal !== 'realloc')
          && cfg2.dip.reallocate === true;
      })());
      ok('#315 ⚠️ 재조정 매도는 목표까지만 판다(목표 아래로 팔지 않는다)', (() => {
        const re = R.months.flatMap((m) => m.trades).filter((t) => t.signal === 'realloc');
        return re.every((t) => t.evalAfter >= t.target - t.price - 1e-6);
      })());
      ok('#316 ⚠️ 재조정 총액이 그날 첫 매수 이벤트에 기록된다', (() => {
        const ev = R.summary.signalEvents.filter((e) => e.kind === 'buy');
        return ev.some((e) => e.reallocAmount > 0);
      })());
      /* ── C-5. 비중 모드: 분모(base)는 스텝당 1회 ──────────────────────────────
       * ⚠️ 매도마다 targetBaseAt을 다시 재면 **캐스케이드**가 난다 — 같은 날 A·B에 매도
       *    시그널이 뜨면 A를 판 직후 평가액 합계가 줄어 B의 목표까지 내려가고, B는 원래보다
       *    더 팔게 된다. 아래는 두 종목이 같은 날 함께 반등하는 픽스처로 그것을 고정한다.
       * ===================================================================== */
      ok('#318 ⚠️ 비중 모드에서 같은 날 두 종목이 매도 시그널이면 서로의 목표를 끌어내리지 않는다', (() => {
        const SC3 = 'CCC';
        // 두 종목 모두 저점 8000 → 같은 날 +25% 반등. 비중 50/50.
        const UPUP = mkSeries((i) => (i < 30 ? 12000 : i < 60 ? 8000 : 10000));
        const cfg3 = makeBtConfig({
          id: 's', name: '캐스케이드', startDate: '2026-01-02', endDate: '2026-12-31',
          initialCapital: 60000000, targetMode: 'ratio', rounding: 'floor', policy: 'none',
          // ⚠️ 비중 합을 **80%**로 둔다 — 100%면 총 초과분 = 총 부족분이라 초과 종목만 팔게 되어
          //    같은 날 두 종목이 동시에 매도하는 상황(캐스케이드가 드러나는 유일한 조건)이 안 만들어진다.
          assets: [
            { id: 'a1', code: SC, name: 'A', payCycle: 'eom', targetRatio: 40 },
            { id: 'a2', code: SC3, name: 'C', payCycle: 'eom', targetRatio: 40 },
          ],
          dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10 }] },
        });
        const r3 = runBacktest({
          config: cfg3, prices: { [SC]: UPUP, [SC3]: UPUP }, dividends: {}, holidays: KR26,
        });
        const sells = r3.months.flatMap((m) => m.trades).filter((t) => t.signal === 'sell');
        if (sells.length < 2) return false;
        // 같은 날 · 같은 가격 · 같은 비중 → 두 종목의 목표가 **정확히 같아야** 한다(캐스케이드면 갈린다).
        const byDate = new Map();
        for (const t of sells) {
          if (!byDate.has(t.date)) byDate.set(t.date, []);
          byDate.get(t.date).push(t);
        }
        for (const list of byDate.values()) {
          if (list.length < 2) continue;
          const t0 = list[0].target;
          if (!list.every((t) => Math.abs(t.target - t0) < 1e-6)) return false;
        }
        return true;
      })());
      /* ── C-6. 적대적 리뷰 확정 결함 4건 회귀 (#319~#322) ──────────────────── */
      // (a) 기본 재원 모드('both')에서 재조정 게이트가 cashTrade만 봐서, 쓸 수 있는 분배금이
      //     충분한데도 **쓸 필요 없는 다른 종목을 팔아 치웠다**.
      ok('#319 ⚠️ both 모드에서 분배금이 충분하면 재조정하지 않는다(게이트가 cashTrade만 보면 안 된다)', (() => {
        const SC4 = 'DDD';
        const DOWN2 = mkSeries((i) => (i < 40 ? 10000 : 6000));
        const UP2 = mkSeries((i) => (i < 40 ? 10000 : 20000));
        const cfg4 = makeBtConfig({
          id: 's', name: 'both재원', startDate: '2026-01-02', endDate: '2026-12-31',
          initialCapital: 40000000, targetMode: 'amount', rounding: 'floor', policy: 'none',
          buyFunding: 'both',
          assets: [
            { id: 'a1', code: SC, name: 'A', payCycle: 'eom', targetAmount: 20000000,
              divOverride: { '2026-01': 5000, '2026-02': 5000 } },
            { id: 'a2', code: SC4, name: 'D', payCycle: 'eom', targetAmount: 20000000 },
          ],
          dip: { enabled: true, levels: [{ drop: 20, buyPct: null }] },
        });
        const r4 = runBacktest({
          config: cfg4, prices: { [SC]: DOWN2, [SC4]: UP2 }, dividends: {}, holidays: KR26,
        });
        // 분배금이 쌓여 매수 재원이 충분하므로 D는 한 주도 팔리지 않아야 한다.
        const sold = r4.months.flatMap((m) => m.trades).filter((t) => t.signal === 'realloc');
        return r4.summary.cumDivPaid > 0 && sold.length === 0 && pocketOk(r4);
      })());
      // (b) 현금 바닥선에 막혀 0주를 사는데도 재조정 매도만 실행되던 '나체 매도'.
      ok('#320 ⚠️ 팔아도 바닥선에 막혀 못 사면 한 주도 팔지 않는다(나체 매도 금지)', (() => {
        const SC5 = 'EEE';
        const DOWN3 = mkSeries((i) => (i < 40 ? 10000 : 9000));
        const UP3 = mkSeries((i) => (i < 40 ? 10000 : 11000));
        const cfg5 = makeBtConfig({
          id: 's', name: '바닥선', startDate: '2026-01-02', endDate: '2026-12-31',
          initialCapital: 20000000, targetMode: 'amount', rounding: 'floor', policy: 'none',
          cashFloorPct: 50,   // 바닥선 = 목표합(2,000만) × 50% = 1,000만 → 어떤 매수도 불가
          assets: [
            { id: 'a1', code: SC, name: 'A', payCycle: 'eom', targetAmount: 10000000 },
            { id: 'a2', code: SC5, name: 'E', payCycle: 'eom', targetAmount: 10000000 },
          ],
          // ⚠️ 재조정은 '목표까지'(buyPct=null) 단계에만 도므로 이 픽스처는 반드시 null이어야 한다.
          dip: { enabled: true, levels: [{ drop: 5, buyPct: null }] },
        });
        const r5 = runBacktest({
          config: cfg5, prices: { [SC]: DOWN3, [SC5]: UP3 }, dividends: {}, holidays: KR26,
        });
        const ts = r5.months.flatMap((m) => m.trades);
        // 매수가 0주면 재조정 매도도 0건이어야 한다(팔아 봐야 못 쓴다).
        const bought = ts.filter((t) => t.signal === 'buy' && t.qty > 0);
        const sold = ts.filter((t) => t.signal === 'realloc');
        return bought.length === 0 && sold.length === 0 && pocketOk(r5);
      })());
      // (c) 같은 종목 2단계 동시 발동 시 금액은 합인데 비율은 1단계 값이라 계산식이 거짓이었다.
      ok('#321 ⚠️ 같은 날 2단계 동시 발동이면 비율도 합(pctSum)으로 남고 계산식이 성립한다', (() => {
        // 하루에 −5%→−25%로 갭하락 → 10%·20% 두 단계가 같은 날 발동한다.
        const GAP = mkSeries((i, d) => (i < 40 ? 10000 : d < '2026-04-01' ? 9500 : 7500));
        const r6 = runS({
          initialCapital: 50200000,
          dip: { enabled: true, levels: [{ drop: 10, buyPct: 34 }, { drop: 20, buyPct: 33 }] },
        }, GAP);
        const byDate = new Map();
        for (const e of r6.summary.signalEvents.filter((x) => x.kind === 'buy')) {
          if (!byDate.has(e.date)) byDate.set(e.date, []);
          byDate.get(e.date).push(e);
        }
        let sawDual = false;
        for (const list of byDate.values()) {
          if (list.length < 2) continue;
          sawDual = true;
          const carrier = list.find((e) => e.carrier) || list[0];
          // 목표 매수액 = 밑변 × 비율합 이 **산술적으로 성립**해야 한다(화면 계산식의 근거).
          // 목표 미달액에서 잘릴 수 있으므로 ≤ 로 본다.
          if (carrier.pctSum === null) return false;
          if (carrier.planned > (carrier.poolAt * carrier.pctSum) / 100 + 1e-6) return false;
          if (Math.abs(carrier.pctSum - list.reduce((a, e) => a + e.pct, 0)) > 1e-9) return false;
          // 나머지 행은 계산식 줄을 렌더하지 않도록 비어 있어야 한다.
          if (list.filter((e) => e !== carrier).some((e) => e.pctSum !== null || e.planned !== 0 || e.poolAt !== 0 || e.carrier)) return false;
        }
        return sawDual;
      })());
      // (d) 재원 스냅샷은 **종목별로 같은 값**이라 여러 종목이 같은 날 발동해도 서로의 몫을 빼앗지 않는다.
      //     옛 코드가 'both'에서 종목마다 주머니 전액을 개방액으로 기록해 KPI 합계가 N배로 부풀었던 자리.
      ok('#322 ⚠️ 재원 밑변은 종목별 동일 스냅샷이고 비-carrier 행에는 싣지 않는다', (() => {
        const both = runS({ buyFunding: 'both', initialCapital: 50200000,
          dip: { enabled: true, levels: DEFAULT_DIP_LEVELS } }, CRASH);
        const ev = both.summary.signalEvents.filter((e) => e.kind === 'buy');
        if (!ev.length || !pocketOk(both)) return false;
        const byDate = new Map();
        for (const e of ev) {
          if (!byDate.has(e.date)) byDate.set(e.date, []);
          byDate.get(e.date).push(e);
        }
        for (const list of byDate.values()) {
          const carriers = list.filter((e) => e.carrier);
          if (carriers.length > 1) {
            const p0 = carriers[0].poolAt;
            if (!carriers.every((e) => Math.abs(e.poolAt - p0) < 1e-6)) return false;
          }
          if (list.filter((e) => !e.carrier).some((e) => e.poolAt !== 0)) return false;
        }
        return true;
      })());
      ok('#317 ⚠️ 재조정 조합에서도 주머니 불변식·기말 분해 항등식이 성립한다', (() => {
        const s = R.summary;
        return pocketOk(R)
          && Math.abs(s.finalCash - (R.initialCashAfter + s.cumTradeNet + s.cumStructuralNet + s.cumReinvestNet + s.cumDivPaid)) < 1e-6;
      })());
    }
  }

  // ── D. 현금 바닥선 ──
  {
    // 목표를 자본에 바짝 붙여 급락 구간의 목표 복원 매수가 현금 제약을 받게 한다.
    const fl = { initialCapital: 100000000, allowNegativeCash: true,
      assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 90000000 }] };
    const F0 = runS(fl, CRASH);
    const F5 = runS({ ...fl, cashFloorPct: 5 }, CRASH);
    ok('#183 ⚠️ cashFloorPct 기본 0 = 무영향(음수 예수금이 종전대로 허용된다)',
      Math.min(...F0.curve.map((c) => c.cash)) < 0);
    ok('#184 바닥선이 예수금 최저점을 끌어올린다', F5.summary.minCash.value > F0.summary.minCash.value);
    // ⚠️ 바닥선은 allowNegativeCash보다 **우선**한다.
    ok('#185 ⚠️ allowNegativeCash여도 바닥선이 있으면 예수금이 음수가 되지 않는다',
      Math.min(...F5.curve.map((c) => c.cash)) >= -1e-6);
    ok("#186 '바닥선' 사유가 거래 행에 기록된다",
      F5.months.some((m) => m.trades.some((t) => t.note === '바닥선')));
    ok('#187 shortfallMonths가 그 달을 센다', F5.summary.shortfallMonths > 0
      && F5.summary.shortfallMonths === F5.months.filter((m) => m.shortfallCount > 0).length);
    // ⚠️ 매도·분배금 재투자에는 적용하지 않는다.
    ok('#188 ⚠️ 매도에는 바닥선이 걸리지 않는다(매도 행에 바닥선 사유가 없다)',
      F5.months.every((m) => m.trades.every((t) => !(t.qty < 0 && t.note === '바닥선'))));
    ok('#189 ⚠️ 분배금 재투자 매수에는 바닥선이 걸리지 않는다',
      runS({ ...fl, cashFloorPct: 90, divReinvest: 'payDate' }, CRASH)
        .months.every((m) => m.trades.every((t) => !(t.reinvest && t.note))));
    ok('#190 바닥선 조합에서도 주머니 불변식 유지', pocketOk(F0) && pocketOk(F5));
  }

  // ── E. 연간 가드레일 증액 ──
  {
    const P2 = FLAT;
    const mkA = (ar, extra = {}) => runBacktest({
      config: makeBtConfig({
        id: 's', name: '연간', startDate: '2026-01-02', endDate: '2027-12-31',
        initialCapital: 100000000, targetMode: 'amount', rounding: 'floor', policy: 'allEom',
        assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 50000000 }],
        annualReview: ar, ...extra,
      }),
      prices: { [SC]: P2 }, dividends: { [SC]: Object.fromEntries(allYms.map((y) => [y, 300])) }, holidays: KR26,
    });
    const AR = mkA({ mode: 'pctOfSurplus', value: 50, reserve: 10000000, everyMonths: 6, split: 'ratio' });
    ok('#191 ⚠️ annualReview 기본 mode:"none" = 무영향(실행 0건)',
      mkA({ mode: 'none', value: 0, reserve: 0, everyMonths: 12, split: 'ratio' }).annualRows.length === 0);
    deep('#192 시작월 + everyMonths×k 의 그 달 첫 리밸런싱일에 실행된다',
      AR.annualRows.map((x) => x.ym), ['2026-07', '2027-01', '2027-07']);
    ok('#193 증액액 = floor((cash − reserve) × value/100)',
      AR.annualRows.every((x) => x.amount === Math.floor(Math.max(0, x.cashBefore - 10000000) * 0.5))
        && AR.annualRows.every((x) => x.mode === 'pctOfSurplus'));
    // ⚠️ 예약금은 절대 투자에 쓰지 않는다 — value>100%여도 surplus로 잘린다.
    ok('#194 ⚠️ value가 100%를 넘어도 예약금은 남는다(surplus 상한)',
      mkA({ mode: 'pctOfSurplus', value: 500, reserve: 10000000, everyMonths: 6, split: 'ratio' })
        .annualRows.every((x) => x.amount <= Math.max(0, x.cashBefore - 10000000) + 1e-6));
    eq('#195 cumAnnualReview = Σ annualRows.amount', AR.summary.cumAnnualReview,
      AR.annualRows.reduce((s, x) => s + x.amount, 0));
    // ⚠️ 매월 증액과 완전히 독립 — 같은 날 겹치면 contrib 먼저(KIND_ORDER contrib < annual).
    {
      const both = mkA({ mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 6, split: 'ratio' },
        { contribution: { mode: 'amount', value: 2000000, split: 'ratio' } });
      const jul = both.months.find((m) => m.ym === '2026-07');
      // ⚠️ 증액은 목표만 올리고 **현금을 움직이지 않으므로** 두 cashBefore는 같아야 한다.
      //    순서(contrib 먼저 → annual 나중)는 **목표금액 누적**으로 증명한다 —
      //    annual의 targetAfter가 contrib의 targetAfter 위에 얹혀야 한다.
      ok('#196 ⚠️ 같은 날 겹치면 contrib 먼저 → annual 나중(annual이 contrib의 목표 위에 얹힌다)',
        !!jul && !!jul.contribution && !!jul.annualReview
          && jul.annualReview.cashBefore === jul.contribution.cashBefore
          && jul.annualReview.perAsset[0].targetAfter
             === jul.contribution.perAsset[0].targetAfter + jul.annualReview.amount);
    }
    // ⚠️ 목표 금액 모드 전용 — 비중 모드는 조기 반환 + 경고(매월 증액과 같은 이유).
    ok('#197 ⚠️ 비중 모드에서는 집행하지 않고 경고한다', (() => {
      const r = mkA({ mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 6, split: 'ratio' },
        { targetMode: 'ratio', assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetRatio: 100 }] });
      return r.annualRows.length === 0 && r.warnings.some((w) => w.includes('연간 가드레일 증액이 반영되지 않습니다'));
    })());
    ok('#198 ⚠️ 리밸런싱이 하나도 없으면 조용히 버리지 않고 경고한다', (() => {
      const r = mkA({ mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 6, split: 'ratio' }, { policy: 'none' });
      return r.annualRows.length === 0 && r.warnings.some((w) => w.includes('연간 가드레일 증액이 전혀 집행되지 않습니다'));
    })());
    ok('#199 연간 증액 조합에서도 주머니 불변식 유지', pocketOk(AR));
  }

  // ── F. 분배금 원천징수 ──
  {
    const T0 = runS();
    const T = runS({ divTaxPct: 15.4 });
    ok('#200 ⚠️ divTaxPct 기본 0 = 무영향(세금 0 · 입금액이 종전과 동일)',
      T0.summary.cumDivTax === 0 && T0.summary.cumDivPaid > 0);
    ok('#201 ⚠️ divAccrued(권리 확정액)는 세전 그대로 둔다',
      Math.abs(T.summary.cumDivAccrued - T0.summary.cumDivAccrued) < 1e-6 && T.summary.cumDivAccrued > 0);
    ok('#202 divPaid는 세후(= 세전 × 84.6%)',
      Math.abs(T.summary.cumDivPaid - T0.summary.cumDivPaid * 0.846) < 1e-6);
    ok('#203 cumDivTax = 세전 입금 − 세후 입금',
      Math.abs(T.summary.cumDivTax - (T0.summary.cumDivPaid - T.summary.cumDivPaid)) < 1e-6
        && Math.abs(T.summary.cumDivTax - T.months.reduce((s, m) => s + m.divTax, 0)) < 1e-6);
    // ⚠️ divPaid를 세후로 정의했으므로 기말 예수금 분해 항등식(#125)이 **그대로** 성립해야 한다.
    ok('#204 ⚠️ 기말 예수금 분해 항등식이 세금 도입 후에도 성립한다', (() => {
      const s = T.summary;
      return Math.abs(T.initialCashAfter + s.cumTradeNet + s.cumStructuralNet + s.cumReinvestNet + s.cumDivPaid - s.finalCash) < 1e-6;
    })());
    // ⚠️ curve의 현금도 세후로 들어와야 실제 cash와 갈리지 않는다.
    ok('#205 ⚠️ 자산 곡선의 기말 현금 = finalCash',
      Math.abs(T.curve[T.curve.length - 1].cash - T.summary.finalCash) < 1e-6);
    ok('#206 세율 100%면 입금 0 · 세금 = 세전 전액',
      Math.abs(runS({ divTaxPct: 100 }).summary.cumDivPaid) < 1e-6
        && Math.abs(runS({ divTaxPct: 100 }).summary.cumDivTax - T0.summary.cumDivPaid) < 1e-6);
    ok('#207 원천징수 조합에서도 주머니 불변식 유지', pocketOk(T));
  }

  // ── 생존 판정 지표 ──
  {
    const R = runS({ divReinvest: 'payDate' });
    ok('#208 minCash = curve의 예수금 최저점(값·날짜)', (() => {
      let best = null;
      for (const c of R.curve) if (!best || c.cash < best.cash) best = c;
      return Math.abs(R.summary.minCash.value - best.cash) < 1e-6 && R.summary.minCash.date === best.date;
    })());
    // ⚠️ cashDiv는 0에서 시작하므로 첫 입금 이후 구간에서만 잰다 — 전 구간으로 재면 **항상 0**이
    //    나와 지표가 죽는다. tradeOnly는 주머니를 한 번도 헐지 않아 단조증가하므로, 최저점은
    //    **첫 지급액 그 자체**여야 한다(전 구간으로 재면 0이 되어 이 단언이 깨진다).
    {
      const mono = runS({ buyFunding: 'tradeOnly' });
      const firstPaidYm = mono.months.find((m) => m.divPaid > 0);
      ok('#209 ⚠️ minCashDiv는 첫 분배금 입금 이후 구간에서만 잰다(0으로 뭉개지지 않는다)',
        !!R.summary.minCashDiv.date
          && !!firstPaidYm
          && mono.summary.minCashDiv.value > 0
          && Math.abs(mono.summary.minCashDiv.value - firstPaidYm.divPaid) < 1e-6);
    }
    ok('#210 분배금이 아예 없으면 minCashDiv는 빈 값 · 월 분배 통계 0',
      (() => { const n = runS({}, WAVE, {}); return n.summary.minCashDiv.date === '' && n.summary.divMonthlyAvg === 0 && n.summary.divMonthlyStdev === 0; })());
    ok('#211 월 분배금이 일정하면 표준편차가 0에 가깝다',
      runS({}, FLAT).summary.divMonthlyStdev < 1 && runS({}, FLAT).summary.divMonthlyAvg > 0);
    // ⚠️ 구간은 '첫 분배 달 ~ 마지막 달' 연속이다 — 앞쪽 램프업만 제외하고 이후의 0원 달은 포함한다.
    ok('#212 ⚠️ divMonthlyAvg 구간 = 첫 분배 달부터 마지막 달까지', (() => {
      const r = runS({}, FLAT);
      let i = 0; while (i < r.months.length && !(r.months[i].divAccrued > 0)) i++;
      const vals = r.months.slice(i).map((m) => m.divAccrued);
      return Math.abs(r.summary.divMonthlyAvg - vals.reduce((s, x) => s + x, 0) / vals.length) < 1e-6;
    })());
  }

  // ── 정규화 / 지문 ──
  {
    // ⚠️ 필드가 아예 없는 레거시 시나리오는 반드시 '종전 동작' 기본값으로 떨어져야 한다.
    const legacy = makeBtConfig({});
    ok('#213 ⚠️ 레거시(필드 부재) 기본값 = 종전 동작',
      legacy.band === 0 && legacy.buyFunding === 'both' && legacy.cashFloorPct === 0
        && legacy.divTaxPct === 0 && legacy.dip.enabled === false
        && legacy.annualReview.mode === 'none' && legacy.annualReview.everyMonths === 12);
    deep('#214 dip 단계 기본값 = −10/−20/−30 (34/33/33%)', legacy.dip.levels, DEFAULT_DIP_LEVELS);
    // 정렬 · 중복 낙폭 제거 · 범위 밖 제외 · 전부 무효면 기본값 복귀
    // ⚠️ 비율은 손상돼도 **행을 버리지 않고** 0~100으로 클램프한다(빈칸만 null=목표까지).
    //    낙폭이 범위 밖인 행만 버린다.
    deep('#215 dip 단계 정규화 — 낙폭 오름차순 + 중복 제거 + 범위 밖 제외 + 비율 클램프',
      makeBtConfig({ dip: { enabled: true, levels: [
        { drop: 30, buyPct: 20 }, { drop: 10, buyPct: 50 }, { drop: 30, buyPct: 99 },
        { drop: 0, buyPct: 10 }, { drop: 101, buyPct: 10 }, { drop: 20, buyPct: 150 },
      ] } }).dip.levels,
      [{ drop: 10, buyPct: 50 }, { drop: 20, buyPct: 100 }, { drop: 30, buyPct: 20 }]);
    // ⚠️ 레거시 마이그레이션 — 옛 필드 unlockPct의 값을 승계하되 **0은 null(목표까지)로** 옮긴다
    //    (옛 '단계 추가' 버튼이 0을 넣었고, 새 의미에서 0은 '한 주도 안 삼'으로 뒤집힌다).
    deep('#215b ⚠️ 레거시 unlockPct → buyPct 마이그레이션 (0은 null=목표까지로)',
      makeBtConfig({ dip: { enabled: true, levels: [
        { drop: 10, unlockPct: 34 }, { drop: 20, unlockPct: 0 }, { drop: 30 },
      ] } }).dip.levels,
      [{ drop: 10, buyPct: 34 }, { drop: 20, buyPct: null }, { drop: 30, buyPct: null }]);
    ok('#216 ⚠️ 유효한 단계가 하나도 없으면 기본 3단계로 되돌린다(조용히 무동작 방지)',
      JSON.stringify(makeBtConfig({ dip: { enabled: true, levels: [{ drop: -1, buyPct: 5 }] } }).dip.levels)
        === JSON.stringify(DEFAULT_DIP_LEVELS));
    ok('#217 값 정규화 — band/cashFloorPct 음수 차단 · divTaxPct 0~100 · everyMonths 1~120',
      makeBtConfig({ band: -5 }).band === 0
        && makeBtConfig({ cashFloorPct: -1 }).cashFloorPct === 0
        && makeBtConfig({ divTaxPct: 500 }).divTaxPct === 100
        && makeBtConfig({ divTaxPct: -1 }).divTaxPct === 0
        && makeBtConfig({ annualReview: { mode: 'pctOfSurplus', value: 1, reserve: 0, everyMonths: 0, split: 'ratio' } }).annualReview.everyMonths === 1
        && makeBtConfig({ annualReview: { mode: 'pctOfSurplus', value: 1, reserve: 0, everyMonths: 999, split: 'ratio' } }).annualReview.everyMonths === 120);
    ok('#218 ⚠️ 알 수 없는 값은 기본값으로(buyFunding/annualReview.mode/split)',
      makeBtConfig({ buyFunding: 'weird' }).buyFunding === 'both'
        && makeBtConfig({ annualReview: { mode: 'weird', value: 1, reserve: 0, everyMonths: 12, split: 'x' } }).annualReview.mode === 'none'
        && makeBtConfig({ annualReview: { mode: 'pctOfSurplus', value: 1, reserve: 0, everyMonths: 12, split: 'x' } }).annualReview.split === 'ratio');
    // ⚠️ 결과를 바꾸는 설정은 **전부** 지문에 들어가야 한다 — 빠지면 그 설정만 고친 세션이
    //    portfolioUpdatedAt을 올리지 못해 Drive 저장이 통째로 스킵된다(contribution 선례).
    const b = makeBtConfig({ id: 'fp' });
    const fp = (o) => backtestFingerprint([makeBtConfig({ id: 'fp', ...o })]);
    const base = backtestFingerprint([b]);
    ok('#219 ⚠️ 지문에 6개 설정이 전부 포함된다(각각 바꾸면 지문이 달라진다)',
      fp({ band: 3 }) !== base
        && fp({ buyFunding: 'tradeOnly' }) !== base
        && fp({ cashFloorPct: 5 }) !== base
        && fp({ divTaxPct: 15.4 }) !== base
        && fp({ dip: { enabled: true, levels: DEFAULT_DIP_LEVELS } }) !== base
        && fp({ annualReview: { mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 12, split: 'ratio' } }) !== base);
    ok('#220 ⚠️ dip 단계 목록·annualReview 세부까지 지문에 실린다(단계만 고친 편집도 저장된다)',
      fp({ dip: { enabled: true, levels: [{ drop: 10, unlockPct: 34 }, { drop: 20, unlockPct: 33 }, { drop: 30, unlockPct: 33 }] } })
        !== fp({ dip: { enabled: true, levels: [{ drop: 15, unlockPct: 34 }, { drop: 20, unlockPct: 33 }, { drop: 30, unlockPct: 33 }] } })
        && fp({ annualReview: { mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 12, split: 'ratio' } })
          !== fp({ annualReview: { mode: 'pctOfSurplus', value: 50, reserve: 1, everyMonths: 12, split: 'ratio' } })
        && fp({ annualReview: { mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 12, split: 'ratio' } })
          !== fp({ annualReview: { mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 6, split: 'ratio' } })
        && fp({ annualReview: { mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 12, split: 'ratio' } })
          !== fp({ annualReview: { mode: 'pctOfSurplus', value: 50, reserve: 0, everyMonths: 12, split: 'even' } }));
    // ⚠️ 2026-08 — 단계 비율의 **null(목표까지)과 0(재원의 0%)은 결과가 정반대**다.
    //    지문이 둘을 같은 문자열로 접으면 '목표까지 ↔ 안 삼' 전환이 조용히 저장되지 않는다.
    ok('#220b ⚠️ 지문이 buyPct/sellPct를 반영하고 null(목표까지)과 0(안 삼)을 구분한다', (() => {
      const withBuy = (v) => fp({ dip: { enabled: true, levels: [{ drop: 10, buyPct: v }] } });
      const withSell = (v) => fp({ dip: { enabled: true, levels: DEFAULT_DIP_LEVELS, sellLevels: [{ rise: 10, sellPct: v }] } });
      return withBuy(null) !== withBuy(0)
        && withBuy(34) !== withBuy(33)
        && withSell(null) !== withSell(0)
        && withSell(30) !== withSell(50);
    })());
    eq('#221 addMonthsToYm — 연 경계를 넘는다', addMonthsToYm('2026-08', 12), '2027-08');
    eq('#222 addMonthsToYm — 12로 나누어떨어지지 않는 주기', addMonthsToYm('2026-11', 3), '2027-02');
    eq('#223 addMonthsToYm — 잘못된 입력은 빈 문자열', addMonthsToYm('2026-8', 3), '');
  }

  // ── 적대적 리뷰 확정 결함 회귀 (#250~#256) ──
  // ⚠️ 아래 4건은 리뷰어 3명 중 2명 이상이 **독립적으로** 지목한 확정 결함이다. 되돌리면 재발한다.
  {
    // (A) 옛 설계에서는 급락 '개방'이 다음 정기 리밸런싱까지 살아남아, 그 회차의 밴드 면제까지
    //     끌고 갔다(delta===0 회차는 만료 루프가 없어 그 다음 회차로도 샜다). 2026-08 전환으로
    //     시그널이 **자기 발동일에 체결**되면서 그 수명 모델 자체가 사라졌다 — 대신 "시그널이
    //     정기 리밸런싱 쪽으로 새지 않는다"를 단언한다(밴드가 정기 매매를 여전히 전부 막아야 한다).
    //     ⚠️ 가격이 완전히 고정이면 delta가 늘 0이라 **밴드가 생략할 매매 자체가 없어**
    //        이 계약이 드러나지 않는다(bandSkipCount는 반올림 수량 0인 건을 세지 않는다).
    const DIPD = mkSeries((i, d) => (d === '2026-06-02' ? 7000 : d <= '2026-06-26' ? 10000 : 10250));
    const cfgD = {
      initialCapital: 50000000, band: 100, buyFunding: 'tradeOnly', policy: 'allEom',
      assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 50000000 }],
      dip: { enabled: true, levels: [{ drop: 20, unlockPct: 100 }] },
    };
    const rD = runS(cfgD, DIPD);
    ok('#250 ⚠️ 시그널은 자기 발동일에만 체결되고 정기 리밸런싱으로 새지 않는다(밴드가 정기 매매를 전부 막는다)',
      rD.months.reduce(
        (s2, m) => s2 + m.trades.filter((t) => !t.structural && !t.reinvest && !t.signal).length, 0,
      ) === 0
        && rD.summary.bandSkipCount > 0);
    ok('#250b ⚠️ 체결액은 목표 매수액(planned)을 넘지 않는다(비율이 실제로 상한 역할을 한다)',
      rD.summary.signalEvents.every((e) => e.tradeAmount <= e.planned + 1e-6));

    // (B) 증액 상한이 총 cash라 tradeOnly·바닥선에서 무력화되던 결함 —
    //     쓸 수 없는 돈까지 목표에 얹혀 매달 복리로 부풀었다.
    const infl = (over) => {
      const r = runS({ contribution: { mode: 'pctOfCash', value: 100, split: 'ratio' }, ...over }, WAVE);
      // 마지막 달 목표금액 합계(증액 누계 + 초기 목표) 대비 실제 평가액
      return { target: 50000000 + r.summary.cumContribution, evalEnd: r.summary.finalEval, r };
    };
    {
      const a = infl({ buyFunding: 'tradeOnly' });
      ok('#251 ⚠️ tradeOnly에서 증액 상한이 매매 주머니로 잘린다(목표만 부풀지 않는다)',
        // 도달 불가 목표(= 목표 − 평가액)가 초기 목표의 3배를 넘지 않아야 한다.
        a.target - a.evalEnd < 50000000 * 3);
      const b = infl({ cashFloorPct: 20 });
      ok('#252 ⚠️ 현금 바닥선이 있어도 증액 상한이 바닥선을 반영한다',
        b.target - b.evalEnd < 50000000 * 3);
      // ⚠️ 기본값에서는 종전 컷과 **결과가 완전히 같아야** 한다(하위호환).
      const base0 = infl({});
      ok('#253 ⚠️ 기본값(both · 바닥선 0)에서는 종전 "예수금 한도" 컷과 결과가 동일하다',
        base0.r.months.every((m) => !m.contribution || m.contribution.note === '' || m.contribution.note === '예수금 한도'));
    }
    ok('#253b ⚠️ 연간 증액도 같은 상한을 쓴다(tradeOnly에서 도달 불가 목표를 만들지 않는다)', (() => {
      const P3 = mkSeries(() => 10000);
      const mkA2 = (over) => runBacktest({
        config: makeBtConfig({
          id: 's', name: '연간', startDate: '2026-01-02', endDate: '2027-12-31',
          initialCapital: 100000000, targetMode: 'amount', rounding: 'floor', policy: 'allEom',
          assets: [{ id: 's1', code: SC, name: 'SS', payCycle: 'eom', targetAmount: 50000000 }],
          annualReview: { mode: 'pctOfSurplus', value: 100, reserve: 0, everyMonths: 6, split: 'ratio' },
          ...over,
        }),
        prices: { [SC]: P3 }, dividends: { [SC]: Object.fromEntries(allYms.map((y) => [y, 300])) }, holidays: KR26,
      });
      const t = mkA2({ buyFunding: 'tradeOnly' });
      // 매매 주머니만 쓰므로 증액분은 분배금 주머니를 넘지 못한다.
      return t.annualRows.every((x) => x.amount <= Math.max(0, x.cashBefore) + 1e-6)
        && t.summary.cumAnnualReview <= mkA2({}).summary.cumAnnualReview + 1e-6;
    })());

    // (C) 같은 낙폭이 두 번 적히면 런타임에 두 번 발동해 개방액이 2배가 되고,
    //     저장·재로드 뒤에는 정규화가 dedup해 **같은 시나리오가 세션마다 다른 결과**를 냈다.
    //     ⚠️ **makeBtConfig를 태워서 테스트하면 안 된다** — 거기서 이미 정규화되므로 런타임 경로가
    //        전혀 실행되지 않는 죽은 단언이 된다(실제로 그랬다). 화면은 `patchActive`가 스프레드로
    //        만든 **정규화되지 않은 로컬 사본**을 그대로 runBacktest에 넘기므로, 그 경로를 재현한다.
    const rawDipRun = (levels, over = {}) => {
      const cfg = mkS({ buyFunding: 'tradeOnly', initialCapital: 50200000, ...over });
      cfg.dip = { enabled: true, levels };   // ← 화면의 patchActive와 같은 '정규화 없는' 주입
      return runBacktest({ config: cfg, prices: { [SC]: CRASH }, dividends: SDIV, holidays: KR26 });
    };
    ok('#254 ⚠️ 중복 낙폭 단계는 런타임에도 한 번만 발동한다(저장 전후 결과가 갈리지 않는다)', (() => {
      const dupLv = [{ drop: 20, unlockPct: 33 }, { drop: 20, unlockPct: 33 }, { drop: 30, unlockPct: 33 }];
      const raw = rawDipRun(dupLv);
      const norm = rawDipRun(normalizeDipLevels(dupLv));
      return raw.summary.signalEvents.filter((e) => e.level === 20).length === 1
        && JSON.stringify(raw.summary.signalEvents) === JSON.stringify(norm.summary.signalEvents)
        && raw.summary.finalTotal === norm.summary.finalTotal;
    })());
    ok('#255 ⚠️ 정렬되지 않은 단계 목록도 낙폭 오름차순으로 발동한다(역시 정규화 없는 주입 경로)',
      JSON.stringify(
        rawDipRun([{ drop: 30, unlockPct: 33 }, { drop: 10, unlockPct: 34 }, { drop: 20, unlockPct: 33 }])
          .summary.signalEvents.map((e) => e.level),
      ) === JSON.stringify([10, 20, 30]));
    ok('#255b ⚠️ 상한을 넘는 단계 목록도 런타임에서 잘린다(정규화 없는 주입)',
      rawDipRun([1, 2, 3, 4, 5, 6, 7].map((k) => ({ drop: k * 3, unlockPct: 10 })))
        .summary.signalEvents.length <= MAX_BT_DIP_LEVELS);

    // (D) 화면이 '아직 미지급'을 accrued − paid 로 구하면 **세금까지 미지급으로** 표시된다.
    ok('#256 ⚠️ 세전 누계 = 세후 입금 + 세금 + 미지급 (accrued − paid 를 세금으로 읽지 말 것)', (() => {
      const t = runS({ divTaxPct: 15.4 });
      const pending = t.summary.cumDivAccrued - t.summary.cumDivPaid - t.summary.cumDivTax;
      const t0 = runS({});
      // 무세금 시나리오의 미지급분과 정확히 같아야 한다(세금은 미지급이 아니다).
      return pending > 0.5
        && Math.abs(pending - (t0.summary.cumDivAccrued - t0.summary.cumDivPaid)) < 1e-6
        && t.summary.cumDivAccrued - t.summary.cumDivPaid > pending;
    })());
  }

  // ── 전 기능 동시 사용 ──
  {
    const ALL = runS({
      band: 2, buyFunding: 'tradeOnly', cashFloorPct: 5, divTaxPct: 15.4,
      dip: { enabled: true, levels: DEFAULT_DIP_LEVELS },
      contribution: { mode: 'pctOfCash', value: 30, split: 'ratio' },
      divReinvest: 'eom',
    }, CRASH);
    ok('#224 ⚠️ 6기능 동시 사용에서도 실행이 성사되고 주머니 불변식이 유지된다',
      ALL.ok && pocketOk(ALL));
    ok('#225 ⚠️ 6기능 동시 사용에서도 기말 예수금 분해 항등식이 성립한다', (() => {
      const s = ALL.summary;
      return Math.abs(ALL.initialCashAfter + s.cumTradeNet + s.cumStructuralNet + s.cumReinvestNet + s.cumDivPaid - s.finalCash) < 1e-6;
    })());
    ok('#226 ⚠️ 6기능 동시 사용에서도 월별 러닝 예수금이 실제 예수금과 갈리지 않는다',
      Math.abs(ALL.months[ALL.months.length - 1].cashEnd - ALL.summary.finalCash) < 1e-6);
  }
}

console.log('\n── 파트④-b 정규화 / 지문 / sticky ──');

{
  ok('#49 normalizeBacktestScenarios — 손상 입력에 throw하지 않는다',
    (() => { try { normalizeBacktestScenarios([null, 1, 'x', { assets: 'bad' }]); return true; } catch { return false; } })());
  const clean = [makeBtConfig({ id: 's1', name: 'A', assets: [{ id: 'a', code: 'X', name: 'x' }] })];
  ok('#50 변경이 없으면 원본 참조를 그대로 반환(불필요한 저장 트리거 방지)',
    normalizeBacktestScenarios(clean) === clean);
  ok('#51 backtestScenariosHaveContent — 빈 시나리오 1개는 "내용 없음"(백업 복원 경로 보존)',
    backtestScenariosHaveContent([makeBtConfig({ id: 'e' })]) === false);
  ok('#52 backtestScenariosHaveContent — 종목이 하나라도 있으면 true',
    backtestScenariosHaveContent([makeBtConfig({ id: 'e', assets: [{ code: 'X' }] })]) === true);
  ok('#53 backtestFingerprint — 순환 참조에도 절대 throw하지 않는다(저장 스케줄 사망 방지)',
    (() => { const a = { id: 'x', assets: [] }; a.self = a; return backtestFingerprint([a]) !== undefined; })());
  const c1 = makeBtConfig({ id: 'f', assets: [{ id: 'a', code: 'X', name: 'A', targetAmount: 100 }] });
  const c2 = JSON.parse(JSON.stringify(c1)); c2.assets[0].targetAmount = 200;
  ok('#54 ⚠️ 지문은 같은 길이 편집도 감지한다(목표금액 100→200)',
    backtestFingerprint([c1]) !== backtestFingerprint([c2]));
  const c3 = JSON.parse(JSON.stringify(c1)); c3.updatedAt = c1.updatedAt + 99999;
  ok('#55 지문에 updatedAt은 넣지 않는다(커밋 시각만 바뀌어도 저장이 재트리거되지 않게)',
    backtestFingerprint([c1]) === backtestFingerprint([c3]));
  const c4 = JSON.parse(JSON.stringify(c1)); c4.assets[0].divOverride = { '2026-05': 170 };
  ok('#56 ⚠️ 주당 분배금 수동 입력은 결과를 바꾸므로 지문에 포함된다',
    backtestFingerprint([c1]) !== backtestFingerprint([c4]));

  // ── 레거시 시나리오 로드 (전략 보조 규칙 도입 전에 저장된 STATE) ──
  // ⚠️ applyStateData는 Drive 버전 변경 폴링마다 이 함수를 다시 태운다. 첫 로드에서 **한 번만**
  //    새 배열을 돌려주고 그 뒤로는 **같은 참조**를 돌려줘야 한다 — 매번 새 배열이면
  //    ① portfolioUpdatedAt이 계속 올라 Drive 저장이 반복되고 ② BacktestPage의 시드 effect
  //    (`scenarios === localRef.current`)가 매 폴링마다 로컬 사본을 갈아엎어 **미승격 편집이 사라진다**.
  {
    // 새 필드가 하나도 없는 옛 저장본(그 시절 필드만).
    const legacyRaw = [{
      id: 'L', name: '옛 시나리오', startDate: '2026-01-02', endDate: '2026-07-31',
      initialCapital: 450000000, extraCash: 0, targetMode: 'amount', rounding: 'floor',
      policy: 'perCycle', fixedDay: 15, exDivOffset: -1, rebalOffset: -1, payOffset: 2,
      allowNegativeCash: false, divReinvest: 'hold', divReinvestSplit: 'target', compareOn: true,
      contribution: { mode: 'none', value: 0, split: 'ratio' }, contribOverrides: [],
      assets: [{ id: 'a1', code: 'A498400', name: 'KODEX 200', payCycle: 'mid', targetAmount: 225000000,
        targetRatio: null, startDate: '', endDate: '', divOverride: {}, color: '#60A5FA',
        rebalMode: 'follow', rebalDay: 15, rebalDates: [] }],
      events: [], overrides: [], createdAt: 1000, updatedAt: 1000,
    }];
    const pass1 = normalizeBacktestScenarios(legacyRaw);
    const s1 = pass1[0];
    ok('#235 ⚠️ 레거시 시나리오는 6개 보조 규칙이 전부 "종전 동작" 기본값으로 채워진다',
      s1.band === 0 && s1.buyFunding === 'both' && s1.cashFloorPct === 0 && s1.divTaxPct === 0
        && s1.dip.enabled === false && s1.dip.levels.length === 3
        && s1.annualReview.mode === 'none' && s1.annualReview.everyMonths === 12
        // 평가·메모도 같은 규약 — 레거시는 '미평가 / 메모 없음'으로 떨어져야 한다.
        && s1.review.rating === 'none' && s1.review.verdict === '' && s1.notes.length === 0);
    ok('#236 ⚠️ 레거시는 새 배열로 반환된다(첫 로드에서 지문이 바뀌어 Drive 저장이 트리거된다)',
      pass1 !== legacyRaw && backtestFingerprint(legacyRaw) !== backtestFingerprint(pass1));
    // ⚠️ 이게 이 기능의 수렴 불변식이다 — 저장된 뒤로는 정규화가 아무것도 바꾸지 않아야 한다.
    ok('#237 ⚠️ 정규화는 멱등이다 — 두 번째부터는 같은 참조를 그대로 돌려준다(무한 재저장·로컬 편집 리셋 방지)',
      normalizeBacktestScenarios(pass1) === pass1
        && backtestFingerprint(normalizeBacktestScenarios(pass1)) === backtestFingerprint(pass1));
    ok('#238 ⚠️ 레거시 시나리오의 **실행 결과**는 정규화 후에도 그대로다(하위호환의 최종 관문)', (() => {
      const before = runBacktest({ config: makeBtConfig(legacyRaw[0]), prices: PRICES, dividends: DIVS, holidays: KR26 });
      const after = runBacktest({ config: s1, prices: PRICES, dividends: DIVS, holidays: KR26 });
      return JSON.stringify(before) === JSON.stringify(after) && before.ok;
    })());
    // ⚠️ 지문은 저장 effect의 첫 블록에서 계산된다 — 여기서 던지면 그 세션의 Drive 저장이 통째로 멈춘다.
    ok('#239 ⚠️ 손상된 새 필드에도 지문이 던지지 않는다',
      backtestFingerprint([{ id: 'x', band: 'bad', dip: 'nope', annualReview: 7, buyFunding: {}, assets: [] }]) !== undefined
        && (() => { try { normalizeBacktestScenarios([{ id: 'y', dip: { enabled: 1, levels: 'x' }, annualReview: [] }]); return true; } catch { return false; } })());
    ok('#240 ⚠️ 손상된 새 필드는 기본값으로 치유된다(실행이 죽지 않는다)', (() => {
      const fixed = normalizeBacktestScenarios([{ id: 'y', dip: { enabled: 1, levels: 'x' }, annualReview: [], band: NaN, divTaxPct: 'x' }])[0];
      return fixed.dip.enabled === true && fixed.dip.levels.length === 3
        && fixed.annualReview.mode === 'none' && fixed.band === 0 && fixed.divTaxPct === 0;
    })());
  }

  // ── 시나리오 평가 · 메모 (기록 전용 저장 필드) ────────────────────────────
  // 규약: ① 결과에 1원도 영향이 없다 ② 그러나 **사용자가 쓴 글**이라 지문·sticky·정규화 전 지점에서
  //       1급 저장 데이터로 다뤄야 한다 ③ 기본값은 언제나 '미평가 / 메모 없음'.
  {
    const mkNote = (o = {}) => ({
      id: 'n1', kind: 'ai', title: '제목', body: '본문',
      snapshot: { conditions: 'c', fp: 'FP1', finalTotal: 100, profit: 10, profitRate: 1, period: 'p' },
      createdAt: 5, updatedAt: 5, ...o,
    });
    const base = makeBtConfig({ id: 'rv', assets: [{ id: 'a1', code: 'X', targetAmount: 100 }] });

    ok('#260 신규 시나리오의 기본값은 미평가 · 메모 없음',
      base.review.rating === 'none' && base.review.verdict === '' && Array.isArray(base.notes) && base.notes.length === 0);

    // ⚠️ 이게 이 기능의 1급 계약이다 — 메모를 고쳤더니 수익률이 달라지면 기록으로서 신뢰가 사라진다.
    ok('#261 ⚠️ 평가·메모는 **실행 결과에 전혀 영향을 주지 않는다**', (() => {
      const cfg = makeBtConfig({ ...JSON.parse(JSON.stringify(mkPdfConfig())) });
      const withNote = makeBtConfig({
        ...JSON.parse(JSON.stringify(cfg)),
        review: { rating: 'bad', verdict: '별로', updatedAt: 9 },
        notes: [mkNote(), mkNote({ id: 'n2', kind: 'user', body: '두 번째' })],
      });
      const a = runBacktest({ config: cfg, prices: PRICES, dividends: DIVS, holidays: KR26 });
      const b = runBacktest({ config: withNote, prices: PRICES, dividends: DIVS, holidays: KR26 });
      return a.ok && JSON.stringify(a) === JSON.stringify(b);
    })());

    // ⚠️ 지문에서 빠지면 '평가/메모만 고친 세션'이 Drive에 저장되지 않는다
    //    (historyVerifyKey·investmentNotesKey·targetAmount와 동일 버그 클래스 — 화면은 정상이고
    //     다음 로드에서만 사라지므로 재현이 극히 어렵다).
    const fp = (o) => backtestFingerprint([makeBtConfig({ id: 'rv', assets: [{ id: 'a1', code: 'X' }], ...o })]);
    const fpBase = fp({});
    ok('#262 ⚠️ 지문 — 등급만 바꿔도 감지된다', fp({ review: { rating: 'good' } }) !== fpBase);
    ok('#263 ⚠️ 지문 — 한 줄 결론만 바꿔도 감지된다', fp({ review: { verdict: '좋다' } }) !== fpBase);
    ok('#264 ⚠️ 지문 — 메모 **본문만** 고쳐도 감지된다(길이·개수 해시 절충 금지)',
      fp({ notes: [mkNote({ body: 'AAAA' })] }) !== fp({ notes: [mkNote({ body: 'BBBB' })] }));
    ok('#264b 지문 — 같은 길이 본문 편집도 감지된다',
      fp({ notes: [mkNote({ body: '가나다라' })] }) !== fp({ notes: [mkNote({ body: '가나다마' })] }));
    ok('#265 지문 — 메모 제목·종류·스냅샷 지문도 포함된다',
      fp({ notes: [mkNote({ title: 'T2' })] }) !== fpBase
        && fp({ notes: [mkNote({ kind: 'user' })] }) !== fp({ notes: [mkNote({ kind: 'ai' })] })
        && fp({ notes: [mkNote({ snapshot: { fp: 'FP2' } })] }) !== fp({ notes: [mkNote({ snapshot: { fp: 'FP3' } })] }));
    // ⚠️ #55와 같은 근거 — 커밋 시각만 바뀌어도 지문이 흔들리면 Drive 저장이 무한 재트리거된다.
    //    #55는 최상위 updatedAt만 검사하므로 하위 객체는 여기서 따로 막는다.
    ok('#266 ⚠️ 지문에 review.updatedAt / note.createdAt·updatedAt은 넣지 않는다',
      fp({ review: { rating: 'good', verdict: 'v', updatedAt: 1 } })
        === fp({ review: { rating: 'good', verdict: 'v', updatedAt: 999999 } })
        && fp({ notes: [mkNote({ createdAt: 1, updatedAt: 2 })] })
        === fp({ notes: [mkNote({ createdAt: 777, updatedAt: 888 })] }));

    // sticky 복원 — '내용이 있는가'로 재야 한다.
    ok('#267 ⚠️ 빈 시나리오 1개는 여전히 "내용 없음"이다(백업 복원 경로 보존 — #51과 같은 계약)',
      backtestScenariosHaveContent([makeBtConfig({ id: 'e' })]) === false);
    ok('#268 ⚠️ 종목이 없어도 평가·메모가 있으면 "내용 있음"(백업 복원이 AI 분석을 되돌리지 않게)',
      backtestScenariosHaveContent([makeBtConfig({ id: 'e', review: { rating: 'good' } })]) === true
        && backtestScenariosHaveContent([makeBtConfig({ id: 'e', review: { verdict: '결론' } })]) === true
        && backtestScenariosHaveContent([makeBtConfig({ id: 'e', notes: [mkNote({ title: '', body: '분석' })] })]) === true);
    ok('#268b 제목·본문이 모두 빈 메모는 "내용 없음"(껍데기만 만든 메모가 복원 경로를 막지 않게)',
      backtestScenariosHaveContent([makeBtConfig({ id: 'e', notes: [mkNote({ title: '  ', body: '' })] })]) === false);

    // 정규화 — 손상값 치유 + 상한 + 멱등.
    ok('#269 ⚠️ 손상된 평가·메모는 기본값으로 치유된다(렌더 중 TypeError → 화면 전체 오류 페이지 방지)', (() => {
      const f = makeBtConfig({ id: 'z', review: 7, notes: 'nope' });
      const g = makeBtConfig({ id: 'z', review: { rating: 'AWESOME', verdict: 5 }, notes: [null, 3, { body: 1 }] });
      return f.review.rating === 'none' && f.review.verdict === '' && f.notes.length === 0
        && g.review.rating === 'none' && g.review.verdict === ''
        && g.notes.length === 3 && g.notes.every((n) => typeof n.body === 'string' && typeof n.id === 'string' && !!n.id)
        && g.notes.every((n) => n.kind === 'ai' && n.snapshot && n.snapshot.finalTotal === null);
    })());
    ok('#270 ⚠️ 상한 — 메모 수 · 본문 · 제목 · 한 줄 결론을 자른다(STATE는 백업 22본으로 복제된다)', (() => {
      const many = Array.from({ length: MAX_BT_NOTES + 5 }, (_, i) => mkNote({ id: `n${i}` }));
      const f = makeBtConfig({
        id: 'z', notes: [...many, mkNote({ id: 'long', body: 'x'.repeat(MAX_BT_NOTE_LEN + 100), title: 'y'.repeat(200) })],
        review: { verdict: 'v'.repeat(MAX_BT_VERDICT_LEN + 50) },
      });
      const g = makeBtConfig({ id: 'z', notes: [mkNote({ body: 'x'.repeat(MAX_BT_NOTE_LEN + 100), title: 'y'.repeat(200) })] });
      return f.notes.length === MAX_BT_NOTES
        && f.review.verdict.length === MAX_BT_VERDICT_LEN
        && g.notes[0].body.length === MAX_BT_NOTE_LEN && g.notes[0].title.length === MAX_BT_NOTE_TITLE_LEN;
    })());
    // ⚠️ 비결정적 정규화(매번 새 id·시각)는 Drive 폴링마다 재저장 + 2.5초 idle 승격 전 편집 소실로 이어진다.
    ok('#271 ⚠️ 평가·메모가 있어도 정규화는 멱등이다', (() => {
      const raw = [makeBtConfig({ id: 'k', review: { rating: 'watch', verdict: 'v' }, notes: [mkNote()], assets: [{ id: 'a', code: 'X' }] })];
      const p1 = normalizeBacktestScenarios(raw);
      return p1 === raw && normalizeBacktestScenarios(p1) === p1;
    })());
    ok('#271b ⚠️ id 없는 메모는 **한 번만** 새 id를 받고 그 뒤로는 안정된다', (() => {
      const raw = [{ id: 'k', assets: [], notes: [{ kind: 'ai', title: 't', body: 'b' }] }];
      const p1 = normalizeBacktestScenarios(raw);
      if (p1 === raw || !p1[0].notes[0].id) return false;
      const p2 = normalizeBacktestScenarios(p1);
      return p2 === p1;
    })());

    // 설정 지문 — 메모 스냅샷의 '작성 이후 설정이 바뀌었는가' 판정.
    // ⚠️ 여기에 backtestFingerprint를 쓰면 그 지문에 notes 자신이 들어 있어, 메모를 추가하는 순간
    //    지문이 달라져 **모든 메모가 영구히 '설정이 바뀜'** 으로 표시된다. 그래서 별도 함수다.
    ok('#272 ⚠️ 설정 지문은 평가·메모·이름·비교체크·시각에 반응하지 않는다', (() => {
      const a = makeBtConfig({ id: 'p', assets: [{ id: 'a1', code: 'X', targetAmount: 100 }] });
      const b = makeBtConfig({
        ...JSON.parse(JSON.stringify(a)), name: '다른 이름', compareOn: false,
        review: { rating: 'bad', verdict: '나쁨' }, notes: [mkNote()], updatedAt: 999999,
      });
      return backtestSettingsFingerprint(a) === backtestSettingsFingerprint(b);
    })());
    ok('#273 설정 지문은 결과를 바꾸는 설정에는 반드시 반응한다', (() => {
      const a = makeBtConfig({ id: 'p', assets: [{ id: 'a1', code: 'X', targetAmount: 100 }] });
      const chg = (o) => backtestSettingsFingerprint(makeBtConfig({ ...JSON.parse(JSON.stringify(a)), ...o }));
      const f0 = backtestSettingsFingerprint(a);
      return chg({ band: 3 }) !== f0 && chg({ policy: 'none' }) !== f0 && chg({ divTaxPct: 15 }) !== f0
        && chg({ targetMode: 'ratio' }) !== f0 && chg({ startDate: '2026-02-02' }) !== f0
        && chg({ dip: { enabled: true, levels: DEFAULT_DIP_LEVELS } }) !== f0
        && chg({ assets: [{ id: 'a1', code: 'X', targetAmount: 200 }] }) !== f0
        && chg({ contribution: { mode: 'amount', value: 100, split: 'ratio' } }) !== f0;
    })());
    ok('#274 ⚠️ 설정 지문도 절대 던지지 않는다(카드 렌더 중 예외 = 화면 전체 오류 페이지)', (() => {
      const a = { id: 'x' }; a.self = a;
      return backtestSettingsFingerprint(a) !== undefined
        && backtestSettingsFingerprint(null) === '' && backtestSettingsFingerprint(7) === '';
    })());
  }
}

console.log('\n── 파트④-c 데이터 수집 ──');

{
  const p = parsePastedSeries('2026-01-02, 19500\n20260105\t19600\n2026.01.06 19700\nbad line\n');
  deep('#57 parsePastedSeries — YYYYMMDD·점 구분·CSV 모두 파싱', [p.ok, p.bad, p.data['2026-01-05']], [3, 1, 19600]);
  const dh = collectDividendHistory([
    { dividendHistory: { X: { '2026-01': 0, '2026-02': 100 } } },
    { dividendHistory: { X: { '2026-01': 213, '2026-02': 999 } } },
  ]);
  deep('#58 ⚠️ 같은 코드가 여러 계좌에 있으면 0이 아닌 첫 값 채택(빈 계좌가 실값을 덮지 않게)',
    [dh.X['2026-01'], dh.X['2026-02']], [213, 100]);
}

console.log('\n── 파트⑤ 소스 텍스트 가드 (영속화 배선) ──');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
// 주석을 지운 사본에서 검사 — 주석에 든 예시 문자열이 가드를 거짓 통과시키지 않게 한다.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

{
  const app = strip(read('src/App.tsx'));
  const sync = strip(read('src/hooks/useDriveSync.ts'));
  const bt = read('src/backtest.ts');

  ok('#59 App.tsx — backtestScenarios useState 존재',
    /useState[^\n]*\(\s*\[\s*\]\s*\)/.test(app) && /const \[backtestScenarios, setBacktestScenarios\]/.test(app));
  ok('#60 App.tsx — portfolioStructureKey 지문에 backtestFingerprint(backtestScenarios) 포함',
    /backtestFingerprint\(\s*backtestScenarios\s*\)/.test(app));
  ok('#61 App.tsx — STATE 저장 payload 리터럴에 backtestScenarios 포함',
    /const state = \{[^\n]*backtestScenarios[^\n]*\}/.test(app));
  ok('#62 App.tsx — 저장 effect deps에 backtestScenarios 포함',
    /\}, \[portfolios,[^\]]*backtestScenarios\]/.test(app));
  ok('#63 App.tsx — applyStateData가 normalizeBacktestScenarios로 로드',
    /stateData\.backtestScenarios[\s\S]{0,120}normalizeBacktestScenarios/.test(app));
  ok('#64 ⚠️ App.tsx applyBackupData sticky — length가 아니라 backtestScenariosHaveContent로 판정',
    /setBacktestScenarios\(\s*prev\s*=>\s*backtestScenariosHaveContent\(prev\)/.test(app));
  ok('#65 ⚠️ useDriveSync._preserveStickyPersonalData가 같은 함수를 공유(판정식 손복제 금지)',
    /backtestScenariosHaveContent/.test(sync) && /backtestScenarios:\s*keepBt/.test(sync));
  // ⚠️ 지시자로서의 `// @ts-nocheck` 줄만 잡는다 — 파일 상단의 "붙이지 말 것" 경고 주석은
  //    본문에 그 문자열을 포함하므로 단순 포함 검사로는 자기 자신에 걸린다.
  ok('#66 ⚠️ backtest.ts에 @ts-nocheck를 붙이지 않는다(이 기능의 유일한 타입 안전망)',
    !/^\s*\/\/\s*@ts-nocheck\s*$/m.test(bt));
  ok('#67 ⚠️ 백테스트 조회 결과를 stockHistoryMap에 병합하지 않는다(평가액 권위 소스 오염 금지)',
    !/setStockHistoryMap[^\n]*bt(Series|Prices)/i.test(app));
  ok('#68 App.tsx — backtestAccess = 관리자 또는 backtestEnabled',
    /const backtestAccess = isAdminUser \|\| userFeatures\.backtestEnabled/.test(app));

  const page = strip(read('src/components/BacktestPage.tsx'));
  // ⚠️ 아래 3건은 미러(순수 함수)로 표현할 수 없는 **렌더 계약**이라 소스 텍스트로 단언한다.
  ok('#78 ⚠️ 월 tfoot 평가액 합계는 같은 종목 2회 거래 시 비운다(dupTraded 분기)',
    /let dupTraded = false;/.test(page) && /dupTraded \?[^\n]*-[^\n]*: won\(m\.evalBeforeSum\)/.test(page)
      && /dupTraded \?[^\n]*-[^\n]*: won\(rows\.reduce/.test(page));
  ok('#79 ⚠️ 보유가 있으면 거래·분배가 없는 달도 렌더한다(CSV와 일관)',
    /if \(!rows\.length && !orphans\.length && !m\.holdings\.length\) return null;/.test(page));
  ok('#80 ⚠️ CSV도 화면과 같은 dupTraded 규칙을 쓴다',
    /dupTraded \? '' : Math\.round\(m\.evalBeforeSum\)/.test(page)
      && /dupTraded \? '' : Math\.round\(joined\.reduce/.test(page));

  // ── 비교 종합 / 분배금 재투자 렌더 계약 ──
  // ⚠️ 아래도 미러로 표현할 수 없는 **렌더·배선 계약**이라 소스 텍스트로 단언한다.
  ok('#134 ⚠️ 요약 카드는 단일 뷰와 비교 블록이 SummaryCards 하나를 공유한다(복제 금지)',
    /function SummaryCards\(/.test(page)
      && (page.match(/<SummaryCards\b/g) || []).length >= 2
      // 단일 뷰가 옛 인라인 카드 배열로 되돌아가지 않았는가
      && !/\['최종 자산', won\(result\.summary\.finalTotal\)/.test(page));
  ok('#135 ⚠️ 시나리오 select에 비교 종합 예약 항목이 있다(진입점)',
    /const COMPARE_ID = '__compare__'/.test(page)
      && /<option value=\{COMPARE_ID\}>/.test(page)
      && /activeId === COMPARE_ID\) return;/.test(page));
  ok('#136 ⚠️ 비교 포함 토글은 id 기준이다(patchActive는 비교 뷰에서 active가 null이라 무동작)',
    /const toggleCompare = useCallback\(\(id\) => \{[\s\S]{0,240}s\.id === id \? \{ \.\.\.s, compareOn: s\.compareOn === false/.test(page));
  ok('#137 ⚠️ 기말 예수금 분해와 CSV 모두 재투자 항(cumReinvestNet)을 포함한다(항등식 #125)',
    /label: '분배금 재투자 매수', value: result\.summary\.cumReinvestNet/.test(page)
      && /\['분배금 재투자 매수', result\.summary\.cumReinvestNet\]/.test(page));
  ok('#138 ⚠️ 비교 실행은 compareOn 필터 + 디바운스(runAll)를 거친다(체크마다 10회 재실행 방지)',
    /setRunAll\(local\), RUN_DEBOUNCE_MS/.test(page)
      && /runAll[\s\S]{0,120}\.filter\(\(s\) => s\.compareOn !== false\)/.test(page));

  // ⚠️ dipOf는 dip 쓰기 6곳의 **스프레드 베이스**다 — 빠진 필드는 옆 토글 한 번으로 dip에서
  //    삭제됐다가 재로드 시 기본값으로 되살아난다(끈 적 없는 축이 다시 켜진다, undo 없음).
  ok('#361 ⚠️ dipOf가 BtDip의 모든 필드를 채운다(스프레드 베이스 계약)',
    /extremeOn: !d \|\| d\.extremeOn !== false/.test(page)
      && /anchorLevels: \(d && Array\.isArray\(d\.anchorLevels\)\) \? d\.anchorLevels : \[\]/.test(page)
      && /anchorSellLevels: \(d && Array\.isArray\(d\.anchorSellLevels\)\) \? d\.anchorSellLevels : \[\]/.test(page)
      && /anchorSource: \(d && d\.anchorSource === 'lastRebal'\) \? 'lastRebal' : 'lastFill'/.test(page));
  ok('#361b ⚠️ 화면 문구는 kind가 아니라 axis로 기준을 고른다(앵커가 "고점"으로 표시되면 거짓말)',
    /const label = e\?\.axis === 'anchor'/.test(page)
      && /직전 체결가/.test(page)
      && /e\?\.axis === 'anchor' \?/.test(page));
  ok('#361c ⚠️ sigOn·strategyTags가 앵커 축을 반영한다(앵커만 쓰는 설정이 "일 안 함"으로 판정되면 안 된다)',
    /const anchor = d\.anchorLevels\.length > 0 \|\| d\.anchorSellLevels\.length > 0;/.test(page)
      && /직전체결 매수 \$\{dip\.anchorLevels\.length\}단계/.test(page));

  // ⚠️ 화면이 2주머니 전제로 남아 있으면 카드 소계가 예수금과 안 맞고 시그널 문장이 틀린 등식을 찍는다.
  // ⚠️ 카드 한 장만 검사하면 정작 항등식을 렌더하는 **기말 보유 현황 표**와 **CSV**의 누락을
  //    통과시킨다(적대적 리뷰 확정). 네 지점을 각각 고유 문자열로 못 박는다.
  ok('#381 ⚠️ 화면·CSV의 예수금 분해가 3주머니다(예비금 항 누락 시 소계·등식이 어긋난다)',
    // ① 최종 자산 카드  ② 기말 예수금 카드 분해
    /＋ 예비금 \(추가 예수금 중 아직 안 쓴 몫\)/.test(page)
      && /\['＋ 예비금이 대신 낸 매수 대금', won\(s\.cumReserveDrawn\)\]/.test(page)
      // ③ 기말 보유 현황 표 — 예비금 그룹 + 총자산 툴팁
      && /추가 예수금 \(초기 매수·정기 리밸런싱에는 쓰지 않음\)/.test(page)
      && /\+ 예비금 \$\{won\(result\.summary\.finalCashReserve\)\}/.test(page)
      // ④ CSV — 예수금 그룹의 예비금 항 + 예비금 그룹
      && /'예비금이 대신 낸 매수 대금', result\.summary\.cumReserveDrawn/.test(page)
      && /'예비금 내역'/.test(page)
      // ⑤ 시그널 문장 · 월말 툴팁 · 월 요약 매수 대금
      && /예비금 \$\{won\(e\.fromReserve\)\}/.test(page)
      && /won\(m\.cashReserveEnd\)/.test(page)
      && /numOf\(m\.cashUsedReserve\)/.test(page));
  // ⚠️ 숫자를 고쳐도 **설명 문구**가 옛 회계로 남아 있으면 화면이 사용자에게 거짓말을 한다
  //    (적대적 리뷰 확정: '최저 현금' 카드 값은 현금 합계인데 구성 항목이 2주머니였다).
  ok('#381c ⚠️ 옛 2주머니 정의("예수금 = … + 추가 예수금")가 화면에 한 곳도 남아 있지 않다',
    !/초기 매수 잔여 \+ 추가 예수금/.test(page)
      && /\['기말 예비금', won\(s\.finalCashReserve\)\]/.test(page)
      && /현금 합계\(예수금 \+ 적립 분배금 \+ 예비금\)/.test(page));
  ok('#381b ⚠️ 추가 예수금 칸이 의미 변경을 고지한다(사용자 행동 없이 결과가 달라지는 유일한 통로)',
    /추가 예수금 = 예비금/.test(page) && /뜻이 바뀌었습니다/.test(page));
  // ⚠️ '초기 매수 후 잔여(예비금 제외)'를 세 화면이 각자 계산하면 값이 갈린다. 그리고 실제로는
  //    표가 요약 카드의 **지역 변수**를 그대로 참조해 프로덕션에서 ReferenceError로 백테스트
  //    페이지 전체가 오류 화면이 됐다(2026-08, 커밋 eac4840). @ts-nocheck + esbuild 빌드라
  //    컴파일러도 `npm run build`도 이 부류를 잡지 못하므로 여기서 배선을 못 박는다.
  ok('#382 ⚠️ 초기 매수 후 잔여는 모듈 스코프 initTradeRestOf 하나를 카드·표·CSV가 공유한다',
    /const initTradeRestOf = \(result\)/.test(page)
      && (page.match(/initTradeRestOf\(result\)/g) || []).length >= 3
      && /value: initTradeRestOf\(result\)/.test(page)
      && /\['초기 매수 후 잔여', initTradeRestOf\(result\)\]/.test(page));

  const bt2 = strip(read('src/backtest.ts'));
  // ⚠️ 전역 지정일이 두 continue보다 **앞**에서 만들어지는지는 미러로 표현할 수 없다(미러도 같이
  //    틀리면 통과한다) — src를 직접 읽어 위치 관계를 단언한다.
  ok('#339 ⚠️ 전역 지정일은 buildSlots에서 오버라이드·none continue보다 앞에서 생성되고 등록 3곳에 들어 있다',
    (() => {
      const i = bt2.indexOf('for (const raw of config.rebalDates)');
      const j = bt2.indexOf('const ao = assetOv.get(');
      const k = bt2.indexOf("if (r.mode === 'none') continue;");
      return i > 0 && j > i && k > i;
    })()
      && /rebalDates: normalizeRebalDates\(partial\.rebalDates\)/.test(bt2)
      && /asArr\(s\.rebalDates\)\.join\(','\)/.test(bt2)
      && /asArr\(s\?\.rebalDates\)\.join\(','\)/.test(bt2));
  ok('#339b ⚠️ 전역 지정일은 follow 종목에만 걸린다(개별 지정 종목을 끌고 가지 않는다)',
    /if \(r\.follows\) \{\s*for \(const raw of config\.rebalDates\)/.test(bt2));
  ok('#360 ⚠️ 앵커 축 — 재투자·재조정·구조변경은 기준을 옮기지 않는다(사용자가 지명한 사건은 둘뿐)',
    /if \(t\.reinvest \|\| t\.structural\) return;/.test(bt2)
      && /if \(t\.signal === 'realloc'\) return;/.test(bt2)
      && /if \(anchorSrc === 'lastRebal' && \(t\.signal === 'buy' \|\| t\.signal === 'sell'\)\) return;/.test(bt2)
      && /extremeOn: raw\?\.extremeOn !== false/.test(bt2)
      && /anchorLevels: normalizeAnchorLevels\(raw\?\.anchorLevels\)/.test(bt2)
      && /anchorSellLevels: normalizeAnchorLevels\(raw\?\.anchorSellLevels\)/.test(bt2));
  // ⚠️ 조기 탈출 위치는 **성능 계약**이다 — targetBaseAt→totalEvalAt이 종목마다 priceAt을 부르고
  //    그 미스 경로는 선형 스캔이라 `영업일 × 종목 × |시계열|`로 폭발한다. 순서를 바꾸지 말 것.
  // ⚠️ #359는 **미러 사본**의 지문 함수만 호출한다 — src의 투영을 통째로 지워도 통과한다
  //    (CLAUDE.md가 기록한 rebalMode 3필드 드리프트 사고와 동일 클래스, 적대적 리뷰가 변이로 실증).
  //    src를 직접 읽어 두 지문 모두에 앵커 4필드가 들어 있는지 못 박는다.
  ok('#360c ⚠️ 앵커 4필드가 **src** 지문 2곳에 전부 투영돼 있다(미러만 고치는 드리프트 방지)',
    (bt2.match(/s\??\.dip\?\.extremeOn === false \? 0 : 1/g) || []).length === 2
      && (bt2.match(/s\??\.dip\?\.anchorSource \?\? ''/g) || []).length === 2
      && (bt2.match(/asArr\(s\??\.dip\?\.anchorLevels\)/g) || []).length === 2
      && (bt2.match(/asArr\(s\??\.dip\?\.anchorSellLevels\)/g) || []).length === 2);
  ok('#360b ⚠️ 앵커 판정·조기 탈출은 checkRatioSum·targetBaseAt보다 **앞**이다(성능 계약)',
    (() => {
      const sig = bt2.slice(bt2.indexOf("if (step.kind === 'signal')"));
      const i = sig.indexOf('const trigs = anchorOn ?');
      const j = sig.indexOf('checkRatioSum(date);');
      const k = sig.indexOf('targetBaseAt(date)');
      return i > 0 && j > i && k > i && /if \(!trigs\.length\) continue;/.test(sig.slice(0, j));
    })());
  ok('#347 ⚠️ 정기 스위치는 policy를 보존하고(조기 반환) 경고 게이트도 두 표현을 함께 본다',
    /if \(config\.regularOn === false\) return \{ mode: 'none', day: 0, follows: true \};/.test(bt2)
      && /config\.policy !== 'none' && config\.regularOn !== false/.test(bt2)
      && /regularOn: partial\.regularOn !== false/.test(bt2)
      && /s\.regularOn === false \? 0 : 1/.test(bt2)
      && /s\?\.regularOn === false \? 0 : 1/.test(bt2));
  ok('#139 ⚠️ 재투자 매수는 분배금 주머니에서 꺼낸다(prefer="div") — 무한 재투자 방지',
    /applyCash\(cashDelta, date, 'div'\)/.test(bt2));
  // ⚠️ KIND_ORDER는 보조 규칙 도입으로 **번호가 밀렸다**(dip·annual 삽입). 리터럴을 그대로 박으면
  //    스텝이 하나 늘 때마다 이 가드가 죽으므로, **계약 자체**(상대 순서)를 파싱해서 단언한다.
  //    계약: 기존 5종의 상대 순서 보존 + reinvest가 유일한 최댓값 + contrib < annual < rebal.
  ok('#140 ⚠️ KIND_ORDER — 재투자가 맨 뒤 · contrib < annual < rebal · signal은 annual 뒤/rebal 앞', (() => {
    const m = bt2.match(/const KIND_ORDER[^=]*=\s*\{([^}]*)\}/);
    if (!m) return false;
    const o = {};
    for (const part of m[1].split(',')) {
      const kv = part.split(':');
      if (kv.length !== 2) continue;
      o[kv[0].trim()] = Number(kv[1].trim());
    }
    const need = ['exdiv', 'pay', 'signal', 'event', 'contrib', 'annual', 'rebal', 'reinvest'];
    if (need.some((k) => !Number.isFinite(o[k]))) return false;
    return o.exdiv < o.pay && o.pay < o.event && o.event < o.contrib && o.contrib < o.rebal
      && o.reinvest === Math.max(...Object.values(o))
      && Object.values(o).filter((v) => v === o.reinvest).length === 1
      // ⚠️ signal은 pay 뒤(그날 받은 분배금까지 개방 밑변) · event 뒤(재편 결과 위에서 실행)
      //    · contrib/annual 뒤(올린 목표를 반영) · rebal 앞(정기 회차가 자연히 no-op이 되게).
      && o.pay < o.signal && o.event < o.signal && o.annual < o.signal && o.signal < o.rebal
      && o.contrib < o.annual && o.annual < o.rebal;
  })());

  // ── 평가금 고정 보조 규칙: 하위호환 배선 가드 ──
  // ⚠️ 미러 테스트는 '기본값이 종전 동작인가'를 함수 본문으로만 잡는다. 아래 3건은 **기본값이
  //    코드에 그렇게 적혀 있는가**를 직접 단언한다 — 하나라도 바뀌면 저장된 시나리오의 결과가
  //    사용자 행동 없이 달라진다.
  ok('#227 ⚠️ applyCash의 divCap 기본값은 Infinity다(기존 호출부가 분배금 주머니를 종전대로 쓴다)',
    /applyCash\s*=\s*\([\s\S]{0,200}?divCap\s*:?\s*(number)?\s*=\s*Infinity/.test(bt2));
  // ⚠️ 예비금 보호는 **예산이 아니라 인출 한도(reserveCap 기본 0)** 가 담당한다 —
  //    allowNegativeCash면 limited가 false라 예산 컷이 통째로 꺼지지만 예비금은 1원도 줄지 않는다.
  ok('#228 ⚠️ adjustTo 기본 한도 = 예비금을 뺀 예수금 · 예비금 인출 기본 0(시그널 매수만 연다)',
    /const rawBudget = opts\?\.budget \?\? \(cash - cashReserve\);/.test(bt2)
      && /const floorCap = opts\?\.floorCap \?\? Infinity;/.test(bt2)
      && /applyCash\(cashDelta, date, 'trade', opts\?\.divCap \?\? Infinity, opts\?\.reserveCap \?\? 0\)/.test(bt2)
      && /reserveCap: number = 0,/.test(bt2));
  ok('#229 ⚠️ 현금 바닥선은 allowNegativeCash보다 우선한다(바닥선이 있으면 음수 진입 불가)',
    /const limited = !config\.allowNegativeCash \|\| floorCap < Infinity;/.test(bt2));
  ok('#230 ⚠️ 원천징수는 지급(pay) 스텝에서만 떼고 divAccrued는 세전 그대로 둔다',
    /const net = r\.amount \* \(1 - divTaxRate\);/.test(bt2)
      && /m\.divPaid \+= net;/.test(bt2)
      && /m\.divTax \+= r\.amount - net;/.test(bt2)
      && /applyDividend\(net, step\.date, r\.assetId\)/.test(bt2)
      // 곡선의 현금도 세후여야 실제 cash와 갈리지 않는다
      && /divByDate\.set\(d\.payDate,[^\n]*d\.amount \* \(1 - divTaxRate\)\)/.test(bt2)
      // divAccrued 적재부는 세전(r.amount) 그대로
      && /am\.divAccrued \+= r\.amount;/.test(bt2));
  ok('#231 ⚠️ 밴드·재원·바닥선은 **정기 리밸런싱 전용**이다(이벤트 adjustTo는 opts 미전달)',
    // 정기 리밸런싱만 4번째 인자 뒤에 opts를 넘긴다
    /adjustTo\(pl\.p, s\.rebalDate, pl\.target, false, \{ budget, divCap, floorCap \}\)/.test(bt2)
      // 이벤트 재편/편입·제외 매도는 종전대로 opts 없이 호출(현금 전체를 쓴다)
      && /adjustTo\(pl\.p, e\.date, pl\.target, true\)/.test(bt2)
      && /adjustTo\(p, e\.date, targetOf\(p, config, base\), true\)/.test(bt2)
      && /adjustTo\(p, e\.date, 0, true\)/.test(bt2)
      // ⚠️ 초기 매수는 **초기 투자금 한도**만 넘긴다(추가 예수금을 첫날 써 버리지 않게, 2026-08).
      //    divCap·floorCap은 넘기지 않는다 — 재원 모드·바닥선은 여전히 정기 리밸런싱 전용이다.
      && /adjustTo\(p, startBiz, targetOf\(p, config, base\), false, \{\s*budget: Math\.max\(0, initRemain\),?\s*\}\)/.test(bt2)
      && /const base = config\.initialCapital;/.test(bt2)
      && /let initRemain = config\.initialCapital;/.test(bt2)
      && /initRemain \+= t\.cashDelta;/.test(bt2));
  // ⚠️ 매수는 **가격 고점** 대비 낙폭, 매도는 **가격 저점** 대비 상승률이고 극값이 갱신되면
  //    그쪽 단계만 재무장한다. 두 판정이 서로 독립이어야(newPeak/newTrough 각각) 신고가일의
  //    매도·신저가일의 매수가 정상 발동한다 — 옛 코드의 `continue`(하루를 통째로 건너뜀)로
  //    되돌리면 매도 시그널이 **가장 크게 오른 날**에 발동하지 못한다.
  ok('#232 ⚠️ 매수=가격 고점 / 매도=가격 저점 기준이고 극값이 갱신되면 그쪽 단계를 재무장한다',
    /if \(newPeak\) \{ peak = px; firedBuy\.clear\(\); \}/.test(bt2)
      && /if \(newTrough\) \{ trough = px; firedSell\.clear\(\); \}/.test(bt2)
      && /const dropPct = \(\(peak - px\) \/ peak\) \* 100;/.test(bt2)
      && /const risePct = \(\(px - trough\) \/ trough\) \* 100;/.test(bt2)
      && !/fired\.clear\(\); continue;/.test(bt2));
  // ⚠️ 2026-08 전환: 시그널은 **발동일 종가로 즉시 체결**한다. 옛 설계(개방만 하고 다음 정기
  //    리밸런싱에서 매수)로 되돌리면 `policy:'none'`에서 쓸 회차가 영영 오지 않아 기능이
  //    통째로 죽는다(사용자 보고: "개방 ₩0 → 사용 ₩0"). 미러 회귀 #300·#301.
  ok('#233 ⚠️ 시그널은 발동일에 즉시 체결한다(개방 상태를 다음 회차로 들고 가지 않는다)',
    /if \(step\.kind === 'signal'\) \{/.test(bt2)
      && /tr\.signal = 'buy';/.test(bt2) && /tr\.signal = 'sell';/.test(bt2)
      && /tr\.signal = 'realloc';/.test(bt2)
      // 옛 수명 모델의 흔적이 하나도 남아 있으면 안 된다
      && !/dipUnlock/.test(bt2) && !/dipPending/.test(bt2) && !/consumeDip/.test(bt2)
      // 정기 리밸런싱은 더 이상 급락 개방을 참조하지 않는다(tradeOnly면 평시 분배금은 잠김)
      && /const divCap = tradeOnly \? 0 : Infinity;/.test(bt2));
  // ⚠️ 2026-08 재정의 — 시그널 매수의 재원은 `buyFunding` 하나가 정하고, 그 두 줄은
  //    정기 리밸런싱(runPlan)과 **문자 그대로 같아야** 두 경로가 갈리지 않는다.
  //    '매매 예수금만'이 divCap을 0으로 두는 것이 "적립 분배금을 1원도 안 쓴다"의 구현부다.
  ok('#233b ⚠️ 시그널 매수 재원 = buyFunding 단일 규칙(tradeOnly는 분배금 완전 잠금) · 재조정 기본 ON',
    /config\.dip\.reallocate !== false/.test(bt2)
      && /tr\.signal = 'realloc'/.test(bt2)
      && (bt2.match(/const divCap = tradeOnly \? 0 : Infinity;/g) || []).length === 2
      // 재원 모드(buyFunding) 규칙은 두 경로가 같고, **예비금만 시그널에서 추가로 열린다**.
      && /const budget = tradeOnly \? Math\.max\(0, cashTrade\) : cash - cashReserve;/.test(bt2)
      && /const budget = \(tradeOnly \? Math\.max\(0, cashTrade\) : cash - cashReserve\) \+ reserveCap;/.test(bt2)
      && /const reserveCap = Math\.max\(0, cashReserve\);/.test(bt2)
      // 재조정 필요액은 '목표까지'(pctSum === null) 종목만 센다 — 비율 매수는 재원 부족 개념이 없다.
      && /if \(pctSum === null\) needTotal \+= need;/.test(bt2)
      // ⚠️ 재원 스냅샷과 재조정 발동 판정은 **같은 정의**를 써야 '나체 매도'가 막힌다.
      && /const poolAt = tradeOnly \? Math\.max\(0, cashTrade\) \+ Math\.max\(0, cashReserve\) : Math\.max\(0, cash\);/.test(bt2)
      && /const avail = tradeOnly \? Math\.max\(0, cashTrade\) \+ Math\.max\(0, cashReserve\) : Math\.max\(0, cash\);/.test(bt2));
  ok('#233c ⚠️ 시그널 사전탐지도 정규화한 단계 목록으로 돈다(매도 단계 포함)',
    /const sellLevels = config\.dip\.enabled \? normalizeSellLevels\(config\.dip\.sellLevels\) : \[\];/.test(bt2)
      && /for \(let i = 0; i < sellLevels\.length; i\+\+\)/.test(bt2)
      && !/config\.dip\.sellLevels\[i\]/.test(bt2));
  // ── 화면(BacktestPage) 렌더 계약 ──
  // ⚠️ 아래는 미러(순수 함수)로 표현할 수 없는 **렌더 계약**이라 소스 텍스트로 단언한다.
  ok('#241 ⚠️ 비교 표의 지표 열 수 = 실행 불가 행의 colSpan (열을 더하고 colSpan을 안 고치면 정렬이 깨진다)', (() => {
    // 비교 표 thead 블록만 잘라 <th> 수를 센다(시나리오 열 1개를 뺀 값이 지표 열 수).
    // ⚠️ 앵커로 JSX 주석을 쓰지 말 것 — 위 strip()이 주석을 지운 사본에서 검사하므로 못 찾는다.
    const i = page.indexOf('>시나리오</th>');
    if (i < 0) return false;
    const seg = page.slice(Math.max(0, i - 400), i + 3500);
    const head = seg.slice(seg.indexOf('<thead'), seg.indexOf('</thead>'));
    const ths = (head.match(/<th\b/g) || []).length;
    const m = seg.match(/<td colSpan=\{(\d+)\}[^>]*>[\s\S]{0,200}?실행할 수 없는 설정입니다/);
    return ths > 0 && !!m && ths - 1 === Number(m[1]);
  })());
  ok('#242 ⚠️ 전략 지표는 SummaryCard를 공유하고 단일 뷰·비교 블록 **양쪽**에 렌더된다(복제 금지)',
    /function StrategyKpis\(\{ result, cfg, compact = false \}\)/.test(page)
      && /cards\.map\(\(c\) => <SummaryCard key=\{c\.label\} \{\.\.\.c\} compact=\{compact\} \/>\)/.test(page)
      && (page.match(/<StrategyKpis\b/g) || []).length >= 2);
  // ⚠️ 엔진 경고가 '⑥ 종목에서 …'을 가리키므로 ⑥을 ⑦로 밀면 화면 번호와 안내가 갈린다.
  ok('#243 ⚠️ 새 설정 섹션은 ⑤-b이고 ⑥ 종목 번호를 밀지 않았다',
    /title="⑤-b 전략 옵션 — 매매 시그널 설정"/.test(page)
      && /title="⑥ 종목"/.test(page) && !/title="⑦ 종목"/.test(page));
  // ⚠️ @ts-nocheck 파일이라 컴파일러가 못 막는다 — 정규화를 우회한 config가 한 번이라도 들어오면
  //    렌더 중 TypeError가 루트 ErrorBoundary까지 올라가 화면이 통째로 오류 페이지가 된다.
  ok('#244 ⚠️ 화면은 dip/annualReview를 안전 접근자로만 읽는다(active.dip.enabled 직접 접근 금지)',
    /const dipOf = \(cfg\) =>/.test(page) && /const annualOf = \(cfg\) =>/.test(page)
      && !/\bactive\.dip\./.test(page) && !/\bactive\.annualReview\./.test(page)
      && !/\bcfg\.dip\./.test(page) && !/\bcfg\.annualReview\./.test(page));
  // ⚠️ 세금은 애초에 입금되지 않은 돈이라 분해 그룹에 항을 더하면 합이 예수금과 어긋난다(#204).
  // ⚠️ 2026-08 재정의 — 분해가 **두 그룹**이 됐다(예수금 / 적립 분배금). 세금은 여전히 어느 그룹에도
  //    항으로 더하지 않는다(애초에 입금되지 않은 돈이라 더하면 두 항등식이 동시에 깨진다).
  ok('#245 ⚠️ 기말 분해(예수금·적립 분배금 2그룹)에 세금 항을 더하지 않는다(분배금 항을 세후로 라벨링만)',
    /label: `누적 분배금 \(지급 기준\$\{result\.summary\.cumDivTax > 0\.5 \? ' · 세후' : ''\}\)`/.test(page)
      && /\[`누적 분배금\(지급 기준\$\{taxedCsv \? ' · 세후' : ''\}\)`, result\.summary\.cumDivPaid\]/.test(page)
      && /원천징수 세금\(참고 · 위 합계에 미포함\)/.test(page)
      // ⚠️ 연결 항(cumDivDrawn)은 화면 표와 **CSV 양쪽**에 있어야 소계가 맞는다. 문자열이 page
      //    어딘가에 있기만 하면 통과하는 형태로 두면, CSV 쪽 한 줄만 지워도 가드가 놓친다
      //    (적대적 리뷰가 변이 테스트로 실증). 두 블록을 **각각** 잘라 확인한다.
      && (() => {
        const csvI = page.indexOf('기말예수금 내역');
        // ⚠️ 표 앵커는 h3의 🏁 붙은 쪽이어야 한다 — 그냥 '기말 보유 현황'은 요약 카드 note 본문이
        //    먼저 걸려 엉뚱한 구간을 검사한다.
        const tblI = page.indexOf('🏁 기말 보유 현황');
        if (csvI < 0 || tblI < 0) return false;
        const csvSeg = page.slice(csvI - 1200, csvI + 1200);
        const tblSeg = page.slice(tblI, tblI + 4000);
        const hasLink = (seg) => /적립 분배금이 대신 낸 매수 대금/.test(seg)
          && /(result\.)?summary\.cumDivDrawn/.test(seg);
        return hasLink(csvSeg) && hasLink(tblSeg);
      })());
  // ⚠️ 월별 표는 12열 고정이라 '비고' 열이 없다 — note를 배지로 붙이지 않으면 '바닥선'·'예수금 부족'이
  //    화면 어디에도 보이지 않는다(열을 늘리면 thead·orphan·tfoot·CSV 4곳을 전부 고쳐야 한다).
  ok('#246 ⚠️ 매매 note(바닥선·예수금 부족)가 날짜 셀 배지로 보인다 + 12열 유지',
    /\{t\.note && \(/.test(page) && /t\.note === '바닥선'/.test(page)
      && (() => {
        const i = page.indexOf('min-w-[1320px]');
        if (i < 0) return false;
        const seg = page.slice(i, i + 1400);
        return (seg.slice(seg.indexOf('<thead'), seg.indexOf('</thead>')).match(/<th\b/g) || []).length === 12;
      })());
  ok('#247 ⚠️ 비교 CSV 헤더 열 수 = 데이터 행 열 수 (짧으면 엑셀에서 열이 조용히 밀린다)', (() => {
    const i = page.indexOf('const downloadCompareCsv');
    if (i < 0) return false;
    const seg = page.slice(i, i + 4200);
    const head = seg.slice(seg.indexOf('const rows = [['), seg.indexOf(']];'));
    const headCols = (head.match(/'/g) || []).length / 2;
    const body = seg.slice(seg.indexOf('rows.push(['), seg.indexOf('\n      ]);'));
    const bodyCols = body.split('\n').filter((l) => /,\s*$/.test(l.trim()) && !/^\s*(rows\.push|\/\/|\/\*)/.test(l)).length;
    // ⚠️ 30 → 32: '평가' · '한 줄 결론' 2열 추가(시나리오 평가).
    //    32 → 33: '적립 분배금' 1열 추가(예수금/분배금 분리 표기, 2026-08). 열을 바꾸면 여기도 함께 고칠 것.
    return headCols === 33 && bodyCols === 33;
  })());
  // ⚠️ <label> 안의 <button>은 label 활성화 동작이 내부 체크박스를 함께 토글한다 —
  //    ? 아이콘을 누를 때마다 그 옵션이 켜졌다 꺼진다(Section 헤더 '버튼 중첩 금지'와 같은 부류).
  ok('#249 ⚠️ <label> 안에 Hint(button)를 두지 않는다(? 클릭이 체크박스를 토글하는 사고 방지)', (() => {
    let i = 0;
    while ((i = page.indexOf('<label', i)) >= 0) {
      const e = page.indexOf('</label>', i);
      if (e < 0) break;
      if (/<Hint\b|<button\b/.test(page.slice(i, e))) return false;
      i = e + 1;
    }
    return true;
  })());
  // ── 적대적 리뷰 확정 결함의 소스 계약 (미러 테스트로는 잡히지 않는 지점) ──
  // ⚠️ #254는 **미러**의 runBacktest를 돌리므로 엔진 본문 변이를 못 본다 — 엔진이 실제로
  //    normalizeDipLevels를 태우는지는 소스로 단언해야 한다.
  ok('#257 ⚠️ 엔진의 급락 사전탐지는 정규화한 단계 목록으로 돈다(중복 낙폭 2회 발동·세션 간 결과 불일치 방지)',
    /const dipLevels = config\.dip\.enabled \? normalizeDipLevels\(config\.dip\.levels\) : \[\];/.test(bt2)
      && /for \(let i = 0; i < dipLevels\.length; i\+\+\)/.test(bt2)
      && !/config\.dip\.levels\[i\]/.test(bt2));
  // ⚠️ accrued − paid 에는 **세금**도 섞여 있다(엔진 cumDivPaid 주석 참조) — 그대로 '미지급'으로
  //    표시하면 원천징수를 켠 사용자에게 미지급액이 세금만큼 부풀어 보인다.
  ok('#258 ⚠️ 화면의 "아직 미지급"은 세금을 빼고 구한다(cumDivAccrued − cumDivPaid − cumDivTax)',
    /const divPending = s\.cumDivAccrued - s\.cumDivPaid - numOf\(s\.cumDivTax\);/.test(page));
  // ⚠️ 정규화가 중복 낙폭 행을 지운 뒤 되돌릴 UI가 없으면 그 단계가 영구히 사라진다.
  // ⚠️ 옛 화면은 `개방 ₩0 → 사용 ₩0` 한 줄이라 **왜 0인지** 알 수 없었다(사용자 보고).
  //    밑변(그 시점 적립 분배금)·비율·재원 내역·체결 결과를 문장으로 남기는 것이 계약이고,
  //    그 문장은 화면과 CSV가 **같은 함수**를 써야 갈리지 않는다.
  ok('#259b ⚠️ 시그널 규모는 계산식(밑변 × 비율 = 금액)으로 표시하고 화면·CSV가 같은 함수를 쓴다',
    /const sigSizeText = \(e, cfg\) =>/.test(page)
      // ⚠️ 반드시 pctSum(단계 합) — 단계별 pct를 쓰면 같은 종목 2단계 동시 발동에서
      //    `₩1,000,000 × 34% = ₩670,000` 같은 **거짓 계산식**이 찍힌다(적대적 리뷰 확정 결함).
      && /\$\{poolLabel\} \$\{won\(e\.poolAt\)\} × \$\{formatNumber\(pct\)\}% = /.test(page)
      && /목표 초과분 \$\{won\(e\.excessAt\)\} × \$\{formatNumber\(pct\)\}% = /.test(page)
      // ⚠️ planned는 목표 미달액(매수)·초과분 전량(매도)에서 한 번 더 잘린다 — 등호 우변에 planned를
      //    바로 찍으면 `₩60,000,000 × 100% = ₩6,000,000` 같은 거짓 계산식이 된다(적대적 리뷰 확정).
      //    잘린 경우를 `capped()`가 '→ …에서 자름 ='으로 갈라 준다.
      && /const capped = \(raw, capLabel\) => \(raw > numOf\(e\.planned\) \+ 0\.5/.test(page)
      && /에서 자름 = \$\{won\(e\.planned\)\}/.test(page)
      && /capped\(\(numOf\(e\.poolAt\) \* pct\) \/ 100, '목표 미달액'\)/.test(page)
      && /capped\(\(numOf\(e\.excessAt\) \* pct\) \/ 100, '초과분 전량'\)/.test(page)
      && !/formatNumber\(numOf\(e\.pct\)\)\}% = /.test(page)
      // ⚠️ 계산식 줄은 **엔진이 실어 보낸 carrier 플래그**로 그린다 — planned>0 같은 값으로 판정하면
      //    비율 0%·재원 0원이라 금액이 0인 대표 행(=설명이 가장 필요한 행)이 통째로 사라진다.
      && /\{e\.carrier && \(/.test(page)
      && /e\.carrier \? sigSizeText\(e, cfgNow\)/.test(page)
      && /const sigOutcomeText = \(e, cfg\) =>/.test(page)
      && /const sigLabel = \(e\) =>/.test(page)
      // 화면(월별 블록)과 CSV가 같은 포매터를 호출한다
      && (page.match(/sigOutcomeText\(/g) || []).length >= 3
      && /sigOutcomeText\(e, cfgNow\)/.test(page)
      // 미체결 사유를 그대로 보여 준다 — '왜 0원인가'가 옛 화면의 결함이었다
      && /return e\.note \|\| '체결 없음';/.test(page));
  // ⚠️ 엔진이 심는 t.signal을 아무 데서도 안 읽으면 policy:'none'에서 각주는 "정기 리밸런싱은
  //    일어나지 않습니다"라고 하는데 표는 설명 없는 매매 행으로 가득 찬다. 특히 **재조정 매도**는
  //    시그널이 뜬 적 없는 다른 종목이 팔린 것이라 출처가 화면 어디에도 없다(적대적 리뷰 확정).
  /* ⚠️ 인쇄 CSS는 JS **템플릿 리터럴**이다. 그 안(주석 포함)에 역따옴표를 하나라도 쓰면 문자열이
   *    거기서 끊기고 뒤가 JS로 파싱된다 — `.bt` 멤버접근 − `shell` 식별자가 되어 **빌드는 통과하는데**
   *    렌더에서 `shell is not defined`로 화면이 통째로 죽는다(2026-08 실측, 사용자 보고).
   * ⚠️ 이 파일의 다른 가드는 .tsx를 **텍스트로만** 읽고 jsxcheck/undefcheck도 평가를 하지 않아
   *    이 부류를 구조적으로 못 잡는다. 그래서 원본(주석 미제거)에서 직접 센다. */
  ok('#259e ⚠️ 인쇄 CSS 템플릿 리터럴 안에 역따옴표가 없다(문자열 조기 종료 → 렌더 크래시 방지)', (() => {
    const raw = read('src/components/BacktestPage.tsx');
    const i = raw.indexOf('<style>{`');
    if (i < 0) return false;
    const j = raw.indexOf('`}</style>', i);
    if (j <= i) return false;
    return !raw.slice(i + '<style>{`'.length, j).includes('`');
  })());
  ok('#259d ⚠️ 시그널·재조정 매매는 월별 표 배지와 CSV 구분 열에서 정기 리밸런싱과 구분된다',
    /t\.signal === 'buy' &&/.test(page) && /t\.signal === 'sell' &&/.test(page)
      && /t\.signal === 'realloc' &&/.test(page)
      && /재조정 매도/.test(page)
      && /t\.signal === 'buy' \? '시그널매수'/.test(page)
      && /t\.signal === 'realloc' \? '시그널재조정'/.test(page));
  ok('#259c ⚠️ 매도 시그널 단계 UI가 있고 기본값(빈 배열)을 안내한다 · 재조정 토글이 있다',
    /매도 단계 추가 \(\{dipOf\(active\)\.sellLevels\.length\}\/\{MAX_BT_SELL_LEVELS\}\)/.test(page)
      && /title="이 매도 단계 삭제"/.test(page)
      && /sellLevels: dipOf\(active\)\.sellLevels\.filter/.test(page)
      && /reallocate: e\.target\.checked/.test(page)
      // 안전 접근자가 sellLevels·reallocate까지 채운다(레거시 config에서 TypeError 방지)
      && /sellLevels: \(d && Array\.isArray\(d\.sellLevels\)\) \? d\.sellLevels : \[\]/.test(page)
      && /reallocate: !d \|\| d\.reallocate !== false/.test(page));
  /* ⚠️ 시그널 체결 팝오버는 2열 계산식 표(값 셀 whitespace-nowrap)로 그리면 안 된다 —
   *    사건 문장이 28~90자라 nowrap 열이 고유폭을 전부 요구하고 라벨 열이 최소폭으로 압축돼
   *    한글이 **글자 하나당 한 줄**로 무너진다(2026-08 사용자 보고). 전용 렌더러 + px 고정 열이
   *    계약이고, 좁은 폭에서는 표를 포기하고 블록으로 떨어져야 같은 증상이 재발하지 않는다. */
  ok('#259f ⚠️ 시그널 체결 팝오버는 popRender + table-fixed(px 열)로 그리고 좁은 폭에서는 블록으로 떨어진다',
    /function SummaryCard\(\{ label, value, cls, formula, note, compact, popWidth = 380, popRender \}\)/.test(page)
      && /popRender \? popRender\(pos\.w\) : \(/.test(page)
      // ⚠️ popRender 카드는 formula를 넘기지 않는다 — 무방비 .map은 호버 순간 렌더 크래시다
      //    (@ts-nocheck + esbuild라 컴파일러가 없고, {pos && …} 안이라 게이트도 못 잡는다).
      && /\{\(formula \|\| \[\]\)\.map\(/.test(page)
      && /function SignalPopBody\(/.test(page)
      && /const SIG_WIDE_MIN = 720;/.test(page)
      && /if \(w < SIG_WIDE_MIN\) \{/.test(page)
      && /style=\{\{ tableLayout: 'fixed' \}\}/.test(page)
      && /const dateW = 96;/.test(page) && /const stepW = 118;/.test(page)
      // ⚠️ 상수 **선언**만 보면 죽은 단언이다 — colgroup을 통째로 지우거나 `width: '10%'`로
      //    되돌려도 통과했다(적대적 리뷰가 변이 테스트로 실증). 실제 **사용부**를 단언한다.
      && /<col style=\{\{ width: dateW \}\} \/>/.test(page)
      && /<col style=\{\{ width: nameW \}\} \/>/.test(page)
      && /<col style=\{\{ width: stepW \}\} \/>/.test(page)
      && /<col style=\{\{ width: refW \}\} \/>/.test(page)
      && /<col style=\{\{ width: outW \}\} \/>/.test(page)
      // 퍼센트·문자열 폭 금지(좁아지면 날짜 열이 61px 아래로 떨어져 '2026-\n01-\n16'이 재현된다)
      && !/<col style=\{\{ width: '/.test(page)
      // 세로 스크롤바 자리를 빼지 않으면 스크롤되는 순간 마지막 열이 잘린다
      && /const POP_SCROLLBAR_RESERVE = \d+;/.test(page)
      && /w - 26 - POP_SCROLLBAR_RESERVE/.test(page)
      && /popWidth: 980,/.test(page)
      // 문구는 화면·CSV 공유 포매터 그대로(가드 #259b와 같은 근거)
      && /<SignalPopBody/.test(page)
      // 비교 뷰에는 월별 표가 없다 — 안내를 뷰별로 갈라야 거짓말이 되지 않는다
      && /moreHint=\{compact \?/.test(page));
  /* ⚠️ 팝오버는 앵커의 **형제**라 마우스를 올리는 순간 앵커 onMouseLeave가 뜬다. 아래 4가지가
   *    한 세트로 있어야 팝오버 안으로 마우스를 옮길 수 있고(=maxH 초과분을 읽을 수 있고),
   *    동시에 z-1200 패널이 화면에 고착되지 않는다. 하나라도 빠지면 정확히 그 반대가 된다. */
  ok('#259g ⚠️ 팝오버 지연 닫기 4경로(open 취소 · 팝오버 enter 취소 · 팝오버 leave 재예약 · closeNow 즉시)',
    /const POP_GRACE_MS = \d+;/.test(page)
      && /const open = useCallback\(\(\) => \{\s*cancel\(\);/.test(page)
      && /const closeNow = useCallback\(\(\) => \{ cancel\(\); setPos\(null\); \}/.test(page)
      && /timerRef\.current = setTimeout\(\(\) => \{ timerRef\.current = null; setPos\(null\); \}, POP_GRACE_MS\);/.test(page)
      // Hint · SummaryCard 두 팝오버 모두 enter=취소 / leave=재예약
      && (page.match(/onMouseEnter=\{enter\} onMouseLeave=\{leave\}/g) || []).length >= 2
      // ⚠️ blur는 **두 앵커 모두**여야 한다 — 존재만 보면 한쪽만 되돌려도 통과한다(변이 실증).
      && (page.match(/onBlur=\{blur\}/g) || []).length >= 2
      // 앵커가 포커스를 쥔 채 팝오버 안을 클릭해도 살아남는다(드래그 선택·복사)
      && /const blur = useCallback\(\(\) => \{ if \(overRef\.current\) return; closeNow\(\); \}/.test(page)
      && /if \(pos\) closeNow\(\); else open\(\);/.test(page)
      // ⚠️ scroll/resize 캡처는 **유예 없이 즉시** — 좌표가 낡은 채 140ms 남으면 안 된다.
      //    (가드가 off 본문을 안 보면 close()로 되돌려도 통과했다 — 변이 실증)
      && /closest\('\[data-bt-pop\]'\)\) return;\s*closeNow\(\);/.test(page)
      // 열린 팝오버는 하나뿐 — 인접 카드로 옮길 때 z-1200 패널 두 장이 겹치지 않는다
      && /let closeOpenPop = null;/.test(page)
      && /if \(closeOpenPop && closeOpenPop !== closeNow\) closeOpenPop\(\);/.test(page)
      && /if \(closeOpenPop === closeNow\) closeOpenPop = null;/.test(page)
      // 스크롤 체이닝 차단 — 끝까지 굴린 다음 틱이 조상으로 넘어가면 읽던 팝오버가 닫힌다
      && /overscrollBehavior: 'contain'/.test(page)
      && /return \{ ref, pos, open, close, closeNow, enter, leave, blur \};/.test(page));
  ok('#259 ⚠️ 급락 단계는 행 추가·삭제가 가능하고 중복 낙폭을 입력 즉시 경고한다',
    /title="이 단계 삭제"/.test(page)
      && /단계 추가 \(\{dipOf\(active\)\.levels\.length\}\/\{MAX_BT_DIP_LEVELS\}\)/.test(page)
      && /new Set\(ds\)\.size === ds\.length/.test(page)
      && /저장하면 하나만 남습니다/.test(page));
  ok('#248 ⚠️ 설정 배지는 태그 수를 잘라 제목을 밀지 않는다(헤더 배지 span은 truncate=nowrap)',
    /function strategyBadge\(cfg\)/.test(page)
      && /tags\.length > 3 \?/.test(page)
      && /badge=\{strategyBadge\(active\)\}/.test(page));
  ok('#234 ⚠️ 연간 증액은 목표 금액 모드 전용이고 예약금을 surplus 상한으로 보호한다',
    // ⚠️ 예비금과 예약금은 성격이 다르지만 둘 다 이 증액의 재원이 아니다 — 함께 뺀다.
    /const surplus = Math\.max\(0, cashBefore - cashReserve - Math\.max\(0, ar\.reserve\)\);/.test(bt2)
      && /let amount = Math\.min\(requested, surplus\);/.test(bt2)
      // contrib과 같은 조기 반환(비중 모드) 규약을 공유한다
      && (bt2.match(/if \(config\.targetMode === 'ratio'\) continue;/g) || []).length >= 2);

  // ── 적대적 리뷰 확정 결함의 렌더 계약 가드 ──
  ok('#146 ⚠️ 시나리오 색 스와치는 인라인 SVG다 — 인쇄 CSS가 background를 죽여 PDF에서 사라지면 안 된다',
    /function Swatch\(\{ color/.test(page)
      && /<rect [^>]*fill=\{color\}/.test(page) && /<circle [^>]*fill=\{color\}/.test(page)
      // 비교 뷰에 인라인 배경 스와치가 남아 있지 않은가(bt-noprint인 좌측 선택 패널은 예외)
      && (page.match(/style=\{\{ backgroundColor:/g) || []).length <= 1);
  // ⚠️ 예비금이 생기면서 줄 자체는 '예비금만 쓴 달'에도 뜨지만, **"매매차익이 모자라" 문구**는
  //    여전히 `otherFromDiv > 0.5`일 때만 붙어야 한다(재투자를 켠 모든 달에 거짓 설명이 붙는 것 방지).
  ok('#147 ⚠️ "매매차익이 모자라" 안내는 재투자 몫을 뺀 나머지가 분배금을 헐었을 때만 뜬다',
    /const otherFromDiv = Math\.max\(0, m\.cashUsedDiv - reinvBuy\);/.test(page)
      && /if \(otherFromDiv <= 0\.5 && fromReserve <= 0\.5\) return null;/.test(page)
      && /otherFromDiv > 0\.5\s*\?\s*' — 예수금이 모자라 적립 분배금에서 충당했습니다\.'/.test(page));
  ok('#148 ⚠️ "증액 효과 없음" 배너 조건은 policy가 아니라 **실제 슬롯 수**를 본다',
    /result\?\.ok && result\.slots\.length === 0 &&[\s\S]{0,120}매월 목표 증액은/.test(page));
  ok('#149 ⚠️ 비교 뷰 첫 진입은 디바운스 없이 즉시 계산한다(빈 화면 깜빡임 방지)',
    /if \(runAll === null\) \{ setRunAll\(local\); return; \}/.test(page));

  ok('#150 ⚠️ removed(이벤트 제외)와 active(아직 편입 전)를 구분한다 — 재투자·리밸런싱 양쪽에서 게이팅',
    /removed: boolean;/.test(bt2)
      && /p\.removed = true;/.test(bt2)
      && /if \(p\.removed\) continue;/.test(bt2)
      && /p => !p\.removed\s*$/m.test(bt2));

  // ── 목표 기준: 비중 분모 = 종목 평가액 합계 (2026-08 사용자 정의) ──
  // ⚠️ 미러 테스트는 '분모 선택지가 되살아났는가'를 못 잡는다(미러도 같이 되살리면 통과) —
  //    엔진·화면·타입에서 그 개념이 사라졌다는 사실 자체를 소스로 단언한다.
  ok('#151 ⚠️ 엔진에 분모 선택 개념이 없다(ratioBase/BtRatioBase/totalWithDiv 식별자 부재)',
    !/\bratioBase\b/.test(bt2) && !/\bBtRatioBase\b/.test(bt2)
      && !/['"]totalWithDiv['"]/.test(bt2)
      // 비중 분모는 targetBaseAt(= 평가액 합계, 보유 0이면 현금 부트스트랩)로만 산출한다
      && /const base = targetBaseAt\(s\.rebalDate\);/.test(bt2)
      // ⚠️ 부트스트랩 현금에서 **예비금을 뺀다**(시그널 전용 재원이라 비중 분모가 아니다).
      //    이 변경을 '분모 선택지 부활'로 오독하지 말 것 — 분모는 여전히 targetBaseAt 하나뿐이다.
      && /return eq > 0 \? eq : Math\.max\(0, cash - cashReserve\);/.test(bt2));
  ok('#152 ⚠️ 화면에도 분모 드롭다운이 없다(라벨·select·option 전부 제거)',
    !/RATIO_BASE_LABEL/.test(page) && !/ratioBase/.test(page)
      && !/비중을 곱할 기준/.test(page)
      && /const TARGET_MODE_LABEL = \{/.test(page));
  ok('#153 ⚠️ 비중 모드에서는 매월 목표 증액을 실행하지 않는다(조기 반환) + 화면도 그렇게 안내',
    /if \(config\.targetMode === 'ratio'\) continue;/.test(bt2)
      && /집행되지 않습니다/.test(page));
  // ⚠️ 설정 패널은 flex 컬럼 스크롤 영역이라 shrink-0이 없으면 브라우저 확대 시 섹션이 눌려 겹친다.
  ok('#154 ⚠️ Section 루트에 shrink-0 (확대 시 설정 항목 겹침 방지)',
    /function Section\(\{[\s\S]{0,300}?<div className="shrink-0 border border-gray-800 rounded-lg overflow-hidden/.test(page));
  // ⚠️ 호버 설명은 화면 밖으로 흘러 잘리면 안 되고, 내부 스크롤로 닫혀서도 안 된다.
  ok('#155 ⚠️ 호버 팝오버는 높이 상한 + 내부 스크롤(닫힘 예외)로 확대 화면에서도 읽힌다',
    /maxHeight: pos\.maxH, overflowY: 'auto'/.test(page)
      && /const maxH = Math\.max\(120,/.test(page)
      && /closest\('\[data-bt-pop\]'\)\) return;/.test(page));
  // ⚠️ 앱 자신의 버튼이 엔진 경고를 유발하면 안 된다 — 균등 분배는 잔여를 마지막 종목이 흡수해
  //    합을 정확히 100%로 맞춘다(안 그러면 3·6·7·9·12…종목에서 '비중 합 100% 아님'이 상시 뜬다).
  ok('#156 ⚠️ 종목 수 균등 분배는 반올림 잔여를 흡수해 합을 100%로 맞춘다',
    /const last = Math\.round\(\(100 - each \* \(n - 1\)\) \* 100\) \/ 100;/.test(page)
      && /targetRatio: i === n - 1 \? last : each/.test(page));

  // ── 시나리오 평가 · 메모 배선 ────────────────────────────────────────────
  // ⚠️ 미러 테스트(#260~#274)는 순수 함수만 검사한다. 아래는 **화면·브릿지 배선**이라 미러로는
  //    표현할 수 없어 소스 텍스트로 단언한다(실패하면 먼저 정규식이 낡았는지 확인할 것).
  const win = strip(read('src/components/BacktestWindow.tsx'));

  // ⚠️ 이 카드가 표제 **아래(헤더 상단)** 에 있어야 PDF 첫 장 맨 위에 결론이 실린다.
  //    key={active.id}가 없으면 시나리오를 바꿔도 카드가 리마운트되지 않아, 미커밋 draft가
  //    **새로 선택된 시나리오에 커밋**된다(FlowInspector가 겪은 '도형 A 타이핑 중 B 클릭' 사고).
  ok('#275 ⚠️ 평가 카드는 결과 표제 바로 아래에 key={active.id}로 렌더된다', (() => {
    const i = page.indexOf('리밸런싱 백테스트</h2>');
    // ⚠️ 렌더 지점이 2곳(정상/실행 불가)이라 첫 번째가 아니라 **표제 뒤의 것**을 찾아야 한다.
    const j = page.indexOf('<ScenarioReviewCard', i);
    const k = page.indexOf('<SummaryCards result={result} />');
    const cards = page.match(/<ScenarioReviewCard\s+key=\{active\.id\}/g) || [];
    return i > 0 && j > i && k > j && cards.length === 2;
  })());
  // ⚠️ 이 분기는 종목을 지운 경우만이 아니라 **저장된 시나리오를 새 세션에서 여는 흔한 경로**로도
  //    들어온다(btFetched는 메모리 전용 → 보유하지 않은 코드는 ⟳ 전까지 fatal). 카드를 빼면 상단 바
  //    칩은 '메모 N'을 광고하는데 눌러도 갈 곳이 없고, 저장된 AI 분석에 닿는 경로가 0개가 된다.
  ok('#291 ⚠️ 실행 불가(result.ok=false) 상태에서도 평가·메모 카드가 렌더된다', (() => {
    const i = page.indexOf(') : !result.ok ? (');
    const j = page.indexOf('{result.fatal}');
    if (i < 0 || j < i) return false;
    const seg = page.slice(i, j);
    return seg.includes('<ScenarioReviewCard') && /key=\{active\.id\}/.test(seg);
  })());
  // ⚠️ addNote가 만드는 메모는 title·body가 ''이라, 커밋값만 보면 붙여넣고 blur 없이 Ctrl+P를
  //    누른 순간 카드에 bt-noprint가 붙고 인쇄 CSS가 카드를 감춰 .bt-printonly 미러까지 함께
  //    사라진다(미러의 존재 이유가 통째로 무효화된다).
  ok('#292 ⚠️ 인쇄 제외 판정(empty)은 draft **전체**를 함께 본다(커밋값 단독 판정 금지)',
    /const draftHasText = Object\.keys\(draft\)\.some\(\(k\) => !!String\(draft\[k\] \?\? ''\)\.trim\(\)\);/.test(page)
      && /const empty = !hasReviewContent\(cfg\) && !draftHasText;/.test(page));
  // ⚠️ 설정 칸 편집 직후 [AI 분석]을 누르면 blur 커밋으로 active는 새 값인데 result는 220ms
  //    디바운스라 옛 실행분이다 — 섞으면 '새 조건 + 옛 숫자'가 박제되고 fp가 현재와 같아져
  //    '설정이 바뀌었습니다' 배지마저 뜨지 않는다(배지의 존재 이유가 무력화된다).
  ok('#293 ⚠️ 메모 스냅샷은 조건과 숫자를 **같은 config**에서 가져온다(runCfg 박제)',
    /const ranCfg = runCfg && runCfg\.id === active\.id \? runCfg : null;/.test(page)
      && /const s = ranCfg && result\?\.ok \? result\.summary : null;/.test(page)
      && /const src = s \? ranCfg : active;/.test(page)
      && /conditions: scenarioSubtitle\(src, s\)/.test(page)
      && /backtestSettingsFingerprint\(src\)/.test(page)
      && !/scenarioSubtitle\(active, s\)/.test(page));

  // ⚠️ 늦게 커밋하는 UI가 patchActive를 쓰면 렌더 시점 active?.id에 묶여 다른 시나리오에 기록된다.
  ok('#276 ⚠️ 평가 카드의 쓰기는 id 기준 patchScenarioById다(patchActive 금지)',
    /const patchScenarioById = useCallback\(\(id, patch\)/.test(page)
      && /onPatch=\{patchScenarioById\}/.test(page)
      && !/<ScenarioReviewCard[\s\S]{0,400}?onPatch=\{patchActive\}/.test(page));
  // ⚠️ 빈 패치에도 updatedAt을 올리면 지문이 바뀌어 Drive 4파일 write가 나간다(NumInput 조기 return).
  ok('#276b ⚠️ 값이 그대로면 아무것도 쓰지 않는다(빈 패치 조기 return)',
    /if \(!p \|\| Object\.keys\(p\)\.length === 0\) return s;/.test(page)
      && /return changed \? next : prev;/.test(page));

  // ⚠️ passive useEffect는 discrete 이벤트인 blur보다 뒤처져 오적용을 못 막는다.
  //    그리고 언마운트된 DOM에는 blur가 발화하지 않아 cleanup flush가 없으면 본문이 통째로 사라진다.
  ok('#277 ⚠️ draft flush는 useLayoutEffect(소유자 변경 + 언마운트)로 건다',
    /useLayoutEffect\(\(\) => \{\s*if \(ownerRef\.current !== cfg\.id\) \{ flush\(\); ownerRef\.current = cfg\.id; \}/.test(page)
      && /useLayoutEffect\(\(\) => \(\) => \{ flush\(\); \}, \[flush\]\);/.test(page));
  // ⚠️ promote는 localRef만 회수한다 — 커밋 훅이 없으면 앱 종료 커밋에서 draft가 통째로 유실된다.
  ok('#278 ⚠️ promote는 첫 줄에서 평가 draft를 커밋한다',
    /const promote = useCallback\(\(\) => \{[\s\S]{0,400}?flushReview\(\);[\s\S]{0,200}?if \(idleRef\.current\)/.test(page)
      && /registerFlush=\{registerReviewFlush\}/.test(page));
  // ⚠️ flushReview는 setState라 이 렌더의 active에는 반영되지 않는다 — 로컬 사본에서 다시 읽어야
  //    방금 친 메모가 CSV에 들어간다.
  ok('#279 ⚠️ CSV는 flush 후 로컬 사본에서 다시 읽는다',
    /flushReview\(\);\s*const cfgNow = \(localRef\.current \|\| \[\]\)\.find\(\(s\) => s\.id === active\.id\) \|\| active;/.test(page)
      && /reviewOf\(cfgNow\)/.test(page) && /notesOf\(cfgNow\)/.test(page));

  // ⚠️ textarea는 내부 스크롤이라 보이는 만큼만 인쇄되고, 접은 메모는 렌더조차 되지 않는다.
  //    두 줄(화면 숨김 / 인쇄 표시)이 짝이므로 한쪽만 지우면 PDF에서 본문이 사라지거나 잘린다.
  ok('#280 ⚠️ 인쇄 미러 .bt-printonly는 화면 숨김 + 인쇄 표시 두 규칙이 짝이다',
    /\.bt-shell \.bt-printonly \{ display: none; \}/.test(page)
      && /\.bt-shell \.bt-printonly \{ display: block !important; \}/.test(page)
      && /className="bt-printonly text-\[12px\] text-gray-200 whitespace-pre-wrap/.test(page));
  // ⚠️ 카드 전체에 bt-noprint를 붙이면 평가가 PDF에서 통째로 사라진다 — 편집 UI에만 붙인다.
  //    그리고 bt-month(page-break-inside: avoid)를 붙이면 긴 분석이 한 장에 욱여넣어져 뒤가 잘린다.
  ok('#281 ⚠️ 평가 카드는 내용이 있으면 인쇄된다(빈 카드만 bt-noprint, bt-month 금지)',
    /\$\{empty \? 'bt-noprint' : ''\}/.test(page)
      && !/rounded-lg bg-gray-900\/40 p-2\.5 mb-3 bt-month/.test(page));
  // ⚠️ 인쇄 CSS `.bt-shell * { background: transparent !important }`가 인라인 배경을 이긴다 —
  //    등급을 배경색으로 칠하면 PDF에서 통째로 사라진다(Swatch가 인라인 SVG인 것과 같은 근거).
  ok('#282 ⚠️ 평가 등급 색은 text-* 클래스다(인라인 backgroundColor 금지)',
    /good: 'text-emerald-300'/.test(page) && /bad: 'text-red-400'/.test(page)
      && !/RATING_CLS[\s\S]{0,200}?backgroundColor/.test(page));
  // ⚠️ 정규화를 우회한 config가 한 번이라도 들어오면 렌더 중 TypeError가 루트 ErrorBoundary까지
  //    올라가 화면이 통째로 오류 페이지가 된다(dipOf·annualOf와 같은 규약, #244의 자매 가드).
  ok('#283 ⚠️ 화면은 review/notes를 안전 접근자로만 읽는다(cfg.review.rating 직접 접근 금지)',
    /const reviewOf = \(cfg\) =>/.test(page) && /const notesOf = \(cfg\) =>/.test(page)
      && !/\bactive\.review\.rating\b/.test(page) && !/\bactive\.notes\.length\b/.test(page)
      && !/\bcfg\.review\.rating\b/.test(page));

  // ⚠️ 메모 스냅샷 지문에 backtestFingerprint를 쓰면 그 지문에 notes 자신이 들어 있어, 메모를
  //    추가하는 순간 지문이 달라져 **모든 메모가 영구히 '설정이 바뀜'** 으로 표시된다.
  ok('#284 ⚠️ 메모 스냅샷 지문은 backtestSettingsFingerprint(설정 전용)로 만든다',
    // ⚠️ 인자는 `active`가 아니라 `src`다(#293 — 조건과 숫자를 같은 config에서 가져오기 위해).
    /fp: \(\(\) => \{ try \{ return backtestSettingsFingerprint\(src\); \}/.test(page)
      && /backtestSettingsFingerprint\(cfg\)/.test(page));
  // ⚠️ 긴 분석을 오클릭으로 잃으면 복구 불가다. 이 화면은 z-1090이고 별도 창에는 App조차 없어
  //    ConfirmDialog(z-1000)도 알림 토스트도 뜨지 않는다 → 인라인 2단계 확인이 유일한 방어다.
  ok('#285 ⚠️ 메모 삭제는 인라인 2단계 확인이다(창 위에서는 ConfirmDialog가 가려진다)',
    /delId === n\.id \? \(/.test(page) && /정말 삭제/.test(page)
      && /onClick=\{\(\) => setDelId\(n\.id\)\}/.test(page));
  // ⚠️ 정규화에서만 자르면 붙여넣은 분석의 뒤가 조용히 사라진다 — 화면에서 잘림이 보여야 한다.
  ok('#286 ⚠️ 화면 maxLength는 backtest.ts 상한과 같은 상수를 쓴다',
    /maxLength=\{MAX_BT_NOTE_LEN\}/.test(page) && /maxLength=\{MAX_BT_NOTE_TITLE_LEN\}/.test(page)
      && /maxLength=\{MAX_BT_VERDICT_LEN\}/.test(page)
      && /notes\.length >= MAX_BT_NOTES/.test(page));

  // ⚠️ 별도 창에는 App의 종료 커밋 체인(backtestExitCommitRef)이 없다 — 창을 닫으면 최대 2.5초분
  //    편집이 어떤 저장 경로로도 회수되지 않는다. AI 분석을 붙여넣고 바로 닫는 것이 주 사용 시나리오다.
  ok('#287 ⚠️ 별도 창(variant=page)은 pagehide에서 승격한다',
    /if \(variant !== 'page'\) return;[\s\S]{0,200}?addEventListener\('pagehide', onHide\)/.test(page));
  // ⚠️ 별도 창의 왕복은 시나리오 객체를 통째로 실어 나른다(필드별 나열 금지) — 나열하면 새 필드가
  //    창에서만 조용히 사라진다. 앱 탭 수신은 반드시 정규화를 거친다(손상 데이터 차단).
  ok('#288 ⚠️ 별도 창 브릿지는 시나리오를 통째로 주고받는다(review/notes 자동 동행)',
    /type: 'backtest:scenarios', scenarios: next/.test(win)
      && /scenarios=\{scenarios\}/.test(win)
      && /d\.type === 'backtest:scenarios'/.test(app)
      && /setBacktestScenarios\(normalizeBacktestScenarios\(d\.scenarios\)\)/.test(app));
  // ⚠️ #260~#274는 **미러**를 검사하므로 src/backtest.ts만 고치면(또는 미러만 고치면) 통과하면서
  //    실제 저장 누락을 놓친다 — CLAUDE.md가 기록한 rebalMode 3필드 실측 사고가 정확히 그것이다.
  //    아래 두 가드가 src 쪽 등록을 텍스트로 직접 단언한다.
  ok('#290 ⚠️ src 지문·정규화에 review/notes가 등록돼 있다(미러만 고치는 드리프트 방지)',
    /review: normalizeReview\(partial\.review\)/.test(bt2)
      && /notes: asArr\(partial\.notes\)\.slice\(0, MAX_BT_NOTES\)\.map\(normalizeNote\)/.test(bt2)
      && /s\?\.review\?\.rating \?\? '', s\?\.review\?\.verdict \?\? ''/.test(bt2)
      && /m: asArr\(s\?\.notes\)\.map/.test(bt2) && /n\?\.body \?\? ''/.test(bt2));
  ok('#290b ⚠️ src sticky 판정에도 평가·메모가 들어 있다(백업 복원이 AI 분석을 되돌리지 않게)', (() => {
    const i = bt2.indexOf('export function backtestScenariosHaveContent');
    if (i < 0) return false;
    const seg = bt2.slice(i, i + 900);
    return /asStr\(s\.review\?\.verdict\)\.trim\(\)/.test(seg)
      && /s\.review\.rating !== 'none'/.test(seg)
      && /asArr\(s\.notes\)\.some/.test(seg);
  })());
  ok('#290c ⚠️ src에 backtestSettingsFingerprint가 export돼 있고 review/notes를 투영하지 않는다', (() => {
    const i = bt2.indexOf('export function backtestSettingsFingerprint');
    if (i < 0) return false;
    const seg = bt2.slice(i, bt2.indexOf('export function', i + 10));
    return !/review/.test(seg) && !/notes/.test(seg) && !/\.name/.test(seg) && !/compareOn/.test(seg);
  })());
  // ⚠️ 2026-08 재정의에서 `unlockPct: 34` → `buyPct: 34` 이관은 지문 투영이 **양쪽 다 `10:34`**라
  //    문자열이 완전히 동일했다 — 사용자가 아무것도 안 건드렸는데 결과 숫자만 달라지고 메모의
  //    '설정이 바뀌었습니다' 배지는 뜨지 않아, 옛 해석으로 쓴 AI 분석이 조용히 거짓이 된다
  //    (적대적 리뷰 확정 결함). 스키마 토큰이 그 한 줄짜리 방어선이다.
  //    ⚠️ **저장 지문(backtestFingerprint)에는 넣지 말 것** — 양변에 똑같이 붙어 무의미하고,
  //       normalizeBacktestScenarios의 멱등 판정만 흔든다.
  ok('#290d ⚠️ 설정 지문에 스키마 토큰이 있다(같은 저장값의 뜻이 바뀐 릴리스에서 메모 배지가 뜬다)', (() => {
    const i = bt2.indexOf('export function backtestSettingsFingerprint');
    if (i < 0) return false;
    const seg = bt2.slice(i, bt2.indexOf('export function', i + 10));
    const fpI = bt2.indexOf('export function backtestFingerprint');
    const fpSeg = fpI < 0 ? '' : bt2.slice(fpI, bt2.indexOf('export function', fpI + 10));
    return /const SETTINGS_FP_SCHEMA = \d+;/.test(bt2)
      && /v: SETTINGS_FP_SCHEMA,/.test(seg)
      && !/SETTINGS_FP_SCHEMA/.test(fpSeg);
  })());

  // ⚠️ 별도 창에서 readOnly면 setLocal이 조용히 무시된다 — 입력을 열어 두면 긴 분석을 다 쓰고
  //    blur해도 아무 데도 저장되지 않는다(창 위에서는 사후 경고도 불가능하다).
  ok('#289 ⚠️ 읽기 전용이면 평가·메모 입력이 전부 잠긴다',
    (() => {
      const i = page.indexOf('function ScenarioReviewCard');
      const j = page.indexOf('function CompareView');
      if (i < 0 || j < i) return false;
      const seg = page.slice(i, j);
      // ⚠️ `disabled={readOnly}` 총 개수로 재지 말 것 — 등급·추가·삭제 버튼에도 붙어 있어서
      //    입력 한 곳에서 빠져도 총합은 여유롭게 통과한다(실측으로 확인한 죽은 단언).
      //    반드시 **입력 요소별 속성 블록**을 하나씩 본다.
      const tags = seg.match(/<(?:input|textarea)\b[\s\S]{0,900}?\/>/g) || [];
      return tags.length >= 3
        && tags.every((t) => t.includes('disabled={readOnly}'))
        && /if \(readOnly\) return;/.test(seg);
    })());
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
