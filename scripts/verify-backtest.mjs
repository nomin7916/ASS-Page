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
//   파트⑤ 소스 텍스트 가드 (#59~#68)
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
const MAX_BT_CONTRIB_OVERRIDES = 120, MAX_BT_REBAL_DATES = 120;
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
    policy: policy === 'allMid' || policy === 'allEom' || policy === 'fixedDay' || policy === 'none' ? policy : 'perCycle',
    fixedDay: clampInt(asNum(partial.fixedDay, 15), 1, 31),
    exDivOffset: clampInt(asNum(partial.exDivOffset, -1), -10, 0),
    rebalOffset: clampInt(asNum(partial.rebalOffset, -1), -10, 0),
    payOffset: clampInt(asNum(partial.payOffset, 2), 0, 10),
    allowNegativeCash: !!partial.allowNegativeCash,
    divReinvest: reinv === 'payDate' || reinv === 'mid' || reinv === 'eom' ? reinv : 'hold',
    divReinvestSplit: divSplit === 'source' || divSplit === 'even' ? divSplit : 'target',
    compareOn: partial.compareOn !== false,
    contribution: normalizeContribution(partial.contribution),
    contribOverrides: asArr(partial.contribOverrides).slice(0, MAX_BT_CONTRIB_OVERRIDES).map(normalizeContribOverride).filter(Boolean),
    assets: asArr(partial.assets).slice(0, MAX_BT_ASSETS).map((a, i) => makeBtAsset(a, i)),
    events: asArr(partial.events).slice(0, MAX_BT_EVENTS).map(normalizeEvent),
    overrides: asArr(partial.overrides).slice(0, MAX_BT_OVERRIDES).map(normalizeOverride).filter(Boolean),
    createdAt: asNum(partial.createdAt, ts),
    updatedAt: asNum(partial.updatedAt, ts),
  };
}

function backtestScenariosHaveContent(scenarios) {
  if (!Array.isArray(scenarios)) return false;
  return scenarios.some((s) => !!s && (asArr(s.assets).length > 0 || asArr(s.events).length > 0 || asArr(s.overrides).length > 0));
}

function backtestFingerprint(scenarios) {
  try {
    if (!Array.isArray(scenarios)) return '';
    return JSON.stringify(scenarios.map((s) => ({
      i: s?.id ?? '', n: s?.name ?? '',
      p: [s?.startDate ?? '', s?.endDate ?? '', s?.initialCapital ?? 0, s?.extraCash ?? 0,
          s?.targetMode ?? '', s?.rounding ?? '', s?.policy ?? '',
          s?.fixedDay ?? 0, s?.exDivOffset ?? 0, s?.rebalOffset ?? 0, s?.payOffset ?? 0,
          s?.allowNegativeCash ? 1 : 0,
          s?.divReinvest ?? '', s?.divReinvestSplit ?? '',
          s?.compareOn === false ? 0 : 1,
          s?.contribution?.mode ?? '', s?.contribution?.value ?? 0, s?.contribution?.split ?? ''],
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
    summary: { startDate: config.startDate, endDate: config.endDate, initialCapital: config.initialCapital,
      finalEval: 0, finalCash: 0, finalTotal: 0, profit: 0, profitRate: 0,
      cumTradeNet: 0, cumStructuralNet: 0, cumReinvestNet: 0, cumDivAccrued: 0, cumDivPaid: 0, cumContribution: 0, finalCashTrade: 0, finalCashDiv: 0, maxDrawdown: 0, months: 0 },
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

  let cash = config.initialCapital + config.extraCash;
  let cashTrade = cash;
  let cashDiv = 0;
  const bucketLog = [];
  const logBuckets = (date) => {
    const last = bucketLog[bucketLog.length - 1];
    if (last && last.date === date) { last.t = cashTrade; last.d = cashDiv; return; }
    bucketLog.push({ date, t: cashTrade, d: cashDiv });
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
  const applyCash = (delta, date, prefer = 'trade') => {
    cash += delta;
    if (delta >= 0) { cashTrade += delta; logBuckets(date); return; }
    let need = -delta;
    let fromTrade = 0;
    let fromDiv = 0;
    if (prefer === 'div') {
      fromDiv = Math.max(0, Math.min(cashDiv, need));
      cashDiv -= fromDiv;
      drainPocket(fromDiv);
      need -= fromDiv;
      if (need > 0) {
        fromTrade = Math.max(0, Math.min(cashTrade, need));
        cashTrade -= fromTrade;
        need -= fromTrade;
      }
    } else {
      fromTrade = Math.max(0, Math.min(cashTrade, need));
      cashTrade -= fromTrade;
      need -= fromTrade;
      if (need > 0) {
        fromDiv = Math.max(0, Math.min(cashDiv, need));
        cashDiv -= fromDiv;
        drainPocket(fromDiv);
        need -= fromDiv;
      }
    }
    if (need > 0) cashTrade -= need;
    const ym = ymOf(date);
    if (ym) {
      const cur = drawByYm.get(ym);
      if (cur) { cur.fromTrade += fromTrade + need; cur.fromDiv += fromDiv; }
      else drawByYm.set(ym, { fromTrade: fromTrade + need, fromDiv });
    }
    logBuckets(date);
  };
  const applyDividend = (amount, date, assetId) => {
    cash += amount;
    cashDiv += amount;
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
    return eq > 0 ? eq : Math.max(0, cash);
  };
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
  const adjustTo = (p, date, target, structural) => {
    const hit = priceAt(prices[p.asset.code], date);
    if (hit.missing || hit.price <= 0) return null;
    const evalBefore = p.qty * hit.price;
    let qty = roundQty((target - evalBefore) / hit.price, config.rounding);
    let note = '';
    if (qty < 0 && -qty > p.qty) { qty = -p.qty; note = '보유수량 한도'; }
    if (qty > 0 && !config.allowNegativeCash) {
      const cost = qty * hit.price;
      if (cost > cash) {
        const afford = roundQty(cash / hit.price, config.rounding === 'exact' ? 'exact' : 'floor');
        if (afford < qty) { qty = Math.max(0, afford); note = '예수금 부족'; }
      }
    }
    if (p.qty + qty !== 0 && Math.abs(p.qty + qty) < QTY_EPS) qty = -p.qty;
    if (qty === 0) return null;
    const cashDelta = -qty * hit.price;
    applyCash(cashDelta, date);
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
    if (!config.allowNegativeCash && qty * hit.price > cash) {
      qty = roundQty(cash / hit.price, floorMode);
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
    const base = config.initialCapital + config.extraCash;
    for (const p of positions) {
      if (!p.active) continue;
      const t = adjustTo(p, startBiz, targetOf(p, config, base), false);
      if (t) initialTrades.push(t);
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
      } else if (config.policy !== 'none') {
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
  const steps = [];
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
  const KIND_ORDER = { exdiv: 0, pay: 1, event: 2, contrib: 3, rebal: 4, reinvest: 5 };
  steps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));

  const pendingDiv = new Map();
  const monthMap = new Map();
  const monthOf = (ym) => {
    let m = monthMap.get(ym);
    if (!m) {
      m = { ym, trades: [], dividends: [], tradeNet: 0, structuralNet: 0, reinvestNet: 0, cumTradeNet: 0,
        divAccrued: 0, cumDivAccrued: 0, divPaid: 0, cumDivPaid: 0, cumReinvestNet: 0,
        cashDelta: 0, cashEnd: 0, cashTradeEnd: 0, cashDivEnd: 0, cashUsedTrade: 0, cashUsedDiv: 0, evalEnd: 0, totalEnd: 0, evalBeforeSum: 0,
        lastDate: '', holdings: [], contribution: null, cumContribution: 0 };
      monthMap.set(ym, m);
    }
    return m;
  };
  for (const ym of monthsBetween(startBiz, endBiz)) monthOf(ym);
  const pushTrade = (t) => {
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
      for (const r of rows) { m.divPaid += r.amount; applyDividend(r.amount, step.date, r.assetId); }
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
      if (!config.allowNegativeCash && amount > cashBefore) { amount = Math.max(0, cashBefore); note = '예수금 한도'; }
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
      const plans = eligible.map((p) => {
        const hit = priceAt(prices[p.asset.code], s.rebalDate);
        const target = targetOf(p, config, base);
        return { p, target, delta: hit.missing ? 0 : target - p.qty * hit.price };
      });
      for (const pl of plans.filter((x) => x.delta < 0)) { const t = adjustTo(pl.p, s.rebalDate, pl.target, false); if (t) pushTrade(t); }
      for (const pl of plans.filter((x) => x.delta > 0)) { const t = adjustTo(pl.p, s.rebalDate, pl.target, false); if (t) pushTrade(t); }
    }
  }

  for (const rows of pendingDiv.values()) {
    for (const r of rows) if (r.amount > 0) warnings.push(`${r.name || r.code} ${r.ym}: 지급일(${r.payDate})이 종료일 이후라 현금에 반영되지 않았습니다.`);
  }

  const months = monthsBetween(startBiz, endBiz).map((ym) => monthOf(ym));
  let cumTrade = 0, cumDivAccrued = 0, cumDivPaid = 0, cumStructural = 0, cumReinvest = 0, cumContrib = 0;
  let runCash = config.initialCapital + config.extraCash;
  for (const t of initialTrades) runCash += t.cashDelta;
  const runQty = new Map();
  for (const p of positions) runQty.set(p.asset.id, 0);
  for (const t of initialTrades) runQty.set(t.assetId, (runQty.get(t.assetId) ?? 0) + t.qty);
  for (const m of months) {
    m.trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    m.dividends.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
    cumTrade += m.tradeNet; cumStructural += m.structuralNet; cumReinvest += m.reinvestNet;
    cumDivAccrued += m.divAccrued; cumDivPaid += m.divPaid;
    cumContrib += m.contribution ? m.contribution.amount : 0;
    m.cumTradeNet = cumTrade; m.cumReinvestNet = cumReinvest;
    m.cumDivAccrued = cumDivAccrued; m.cumDivPaid = cumDivPaid; m.cumContribution = cumContrib;
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
      let t = config.initialCapital + config.extraCash;
      let d = 0;
      for (const bkt of bucketLog) { if (bkt.date > lastBiz) break; t = bkt.t; d = bkt.d; }
      m.cashTradeEnd = t; m.cashDivEnd = d;
    }
    {
      const dr = drawByYm.get(m.ym);
      m.cashUsedTrade = dr ? dr.fromTrade : 0;
      m.cashUsedDiv = dr ? dr.fromDiv : 0;
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
      for (const d of m.dividends) divByDate.set(d.payDate, (divByDate.get(d.payDate) ?? 0) + d.amount);
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
  return {
    ok: true, fatal: '', warnings: Array.from(new Set(warnings)), slots, assetMeta,
    initialDate: startBiz, initialTrades, initialCashAfter, months, curve, finalHoldings,
    summary: { startDate: startBiz, endDate: endBiz, initialCapital: config.initialCapital,
      finalEval, finalCash: cash, finalTotal, profit: finalTotal - invested,
      profitRate: invested > 0 ? ((finalTotal - invested) / invested) * 100 : 0,
      cumTradeNet: cumTrade, cumStructuralNet: cumStructural, cumReinvestNet: cumReinvest, cumDivAccrued, cumDivPaid, cumContribution: cumContrib, finalCashTrade: cashTrade, finalCashDiv: cashDiv,
      maxDrawdown: maxDd, months: months.length },
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

  const bt2 = strip(read('src/backtest.ts'));
  ok('#139 ⚠️ 재투자 매수는 분배금 주머니에서 꺼낸다(prefer="div") — 무한 재투자 방지',
    /applyCash\(cashDelta, date, 'div'\)/.test(bt2));
  ok('#140 ⚠️ 재투자 스텝은 KIND_ORDER 맨 뒤(rebal 뒤)에 온다',
    /exdiv: 0, pay: 1, event: 2, contrib: 3, rebal: 4, reinvest: 5/.test(bt2));

  // ── 적대적 리뷰 확정 결함의 렌더 계약 가드 ──
  ok('#146 ⚠️ 시나리오 색 스와치는 인라인 SVG다 — 인쇄 CSS가 background를 죽여 PDF에서 사라지면 안 된다',
    /function Swatch\(\{ color/.test(page)
      && /<rect [^>]*fill=\{color\}/.test(page) && /<circle [^>]*fill=\{color\}/.test(page)
      // 비교 뷰에 인라인 배경 스와치가 남아 있지 않은가(bt-noprint인 좌측 선택 패널은 예외)
      && (page.match(/style=\{\{ backgroundColor:/g) || []).length <= 1);
  ok('#147 ⚠️ "매매차익이 모자라" 안내는 재투자 몫을 뺀 나머지가 분배금을 헐었을 때만 뜬다',
    /const otherFromDiv = Math\.max\(0, m\.cashUsedDiv - reinvBuy\);/.test(page)
      && /if \(otherFromDiv <= 0\.5\) return null;/.test(page));
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
      && /return eq > 0 \? eq : Math\.max\(0, cash\);/.test(bt2));
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
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
