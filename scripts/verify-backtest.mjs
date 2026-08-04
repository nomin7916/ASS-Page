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
function makeBtAsset(partial = {}, idx = 0) {
  const cycle = partial.payCycle;
  return {
    id: partial.id || generateId(),
    code: asStr(partial.code).trim().toUpperCase(),
    name: asStr(partial.name),
    payCycle: cycle === 'mid' || cycle === 'eom' || cycle === 'none' ? cycle : 'eom',
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
    ym, group: g === 'mid' || g === 'all' ? g : g === 'eom' ? 'eom' : 'all', date: raw.date,
  };
}
function makeBtConfig(partial = {}) {
  const ts = 1000;
  const policy = partial.policy, mode = partial.targetMode, base = partial.ratioBase, rounding = partial.rounding;
  return {
    id: partial.id || generateId(),
    name: asStr(partial.name) || '백테스트',
    startDate: isIsoDate(partial.startDate) ? partial.startDate : '',
    endDate: isIsoDate(partial.endDate) ? partial.endDate : '',
    initialCapital: Math.max(0, asNum(partial.initialCapital, 0)),
    extraCash: Math.max(0, asNum(partial.extraCash, 0)),
    targetMode: mode === 'ratio' ? 'ratio' : 'amount',
    ratioBase: base === 'total' || base === 'initial' ? base : 'equity',
    rounding: rounding === 'round' || rounding === 'exact' ? rounding : 'floor',
    policy: policy === 'allMid' || policy === 'allEom' || policy === 'fixedDay' ? policy : 'perCycle',
    fixedDay: clampInt(asNum(partial.fixedDay, 15), 1, 31),
    exDivOffset: clampInt(asNum(partial.exDivOffset, -1), -10, 0),
    rebalOffset: clampInt(asNum(partial.rebalOffset, -1), -10, 0),
    payOffset: clampInt(asNum(partial.payOffset, 2), 0, 10),
    allowNegativeCash: !!partial.allowNegativeCash,
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
          s?.targetMode ?? '', s?.ratioBase ?? '', s?.rounding ?? '', s?.policy ?? '',
          s?.fixedDay ?? 0, s?.exDivOffset ?? 0, s?.rebalOffset ?? 0, s?.payOffset ?? 0,
          s?.allowNegativeCash ? 1 : 0],
      a: asArr(s?.assets).map((a) => [
        a?.id ?? '', a?.code ?? '', a?.name ?? '', a?.payCycle ?? '',
        a?.targetAmount ?? null, a?.targetRatio ?? null, a?.startDate ?? '', a?.endDate ?? '', a?.color ?? '',
        Object.keys(a?.divOverride ?? {}).sort().map((k) => `${k}:${a.divOverride[k]}`).join(','),
      ]),
      e: asArr(s?.events).map((e) => [
        e?.id ?? '', e?.date ?? '', e?.label ?? '', e?.funding ?? '',
        asArr(e?.addAssets).join(','), asArr(e?.removeAssets).join(','),
        asArr(e?.targets).map((t) => `${t?.assetId ?? ''}:${t?.amount ?? ''}:${t?.ratio ?? ''}`).join('|'),
      ]),
      o: asArr(s?.overrides).map((o) => [o?.id ?? '', o?.ym ?? '', o?.group ?? '', o?.date ?? '']),
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

function groupsForPolicy(policy) { return policy === 'perCycle' ? ['mid', 'eom'] : ['all']; }
function assetsInGroup(assets, group) {
  if (group === 'all') return assets.map((a) => a.id);
  if (group === 'mid') return assets.filter((a) => a.payCycle === 'mid').map((a) => a.id);
  return assets.filter((a) => a.payCycle === 'eom' || a.payCycle === 'none').map((a) => a.id);
}

function buildSlots(config, holidays) {
  const out = [];
  if (!isIsoDate(config.startDate) || !isIsoDate(config.endDate)) return out;
  const ovMap = new Map();
  for (const o of config.overrides) ovMap.set(`${o.ym}|${o.group}`, o);
  for (const ym of monthsBetween(config.startDate, config.endDate)) {
    for (const group of groupsForPolicy(config.policy)) {
      const cycle = group === 'mid' ? 'mid' : group === 'eom' ? 'eom' : config.policy === 'allMid' ? 'mid' : 'eom';
      const recordDate = recordDateFor(ym, cycle, holidays);
      if (!recordDate) continue;
      const exDate = shiftBusinessDays(recordDate, config.exDivOffset, holidays);
      const payDate = shiftBusinessDays(recordDate, config.payOffset, holidays);
      let rebalDate;
      if (config.policy === 'fixedDay') {
        const raw = `${ym}-${pad2(clampInt(config.fixedDay, 1, 31))}`;
        const capped = isIsoDate(raw) ? raw : lastDayOfMonth(ym);
        rebalDate = onOrBeforeBusinessDay(capped, holidays);
      } else {
        rebalDate = shiftBusinessDays(exDate, config.rebalOffset, holidays);
      }
      const ov = ovMap.get(`${ym}|${group}`);
      const overridden = !!ov;
      if (ov) rebalDate = onOrBeforeBusinessDay(ov.date, holidays);
      if (rebalDate < config.startDate || rebalDate > config.endDate) continue;
      out.push({ ym, group, recordDate, exDate, payDate, rebalDate, overridden, assetIds: assetsInGroup(config.assets, group) });
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
      cumTradeNet: 0, cumStructuralNet: 0, cumDivAccrued: 0, cumDivPaid: 0, maxDrawdown: 0, months: 0 },
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
    positions.push({ asset: a, qty: 0, active: false, targetAmount: a.targetAmount, targetRatio: a.targetRatio, effectiveStart, effectiveEnd });
  }
  const posById = new Map(positions.map((p) => [p.asset.id, p]));
  const usable = positions.filter((p) => !!prices[p.asset.code] && seriesRange(prices[p.asset.code]).count > 0);
  if (!usable.length) return empty('선택한 종목 중 종가 데이터가 있는 종목이 없습니다. 종목을 조회하거나 데이터를 붙여넣어 주세요.');

  let cash = config.initialCapital + config.extraCash;
  const totalEvalAt = (date) => {
    let s = 0;
    for (const p of positions) { if (p.qty > QTY_EPS) { const h = priceAt(prices[p.asset.code], date); if (!h.missing) s += p.qty * h.price; } }
    return s;
  };
  const ratioBaseAt = (date) => {
    if (config.ratioBase === 'initial') return config.initialCapital + config.extraCash;
    const eq = totalEvalAt(date);
    return config.ratioBase === 'total' ? eq + cash : eq;
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
    cash += cashDelta;
    const qtyBefore = p.qty;
    p.qty += qty;
    return { date, assetId: p.asset.id, code: p.asset.code, name: p.asset.name, price: hit.price,
      priceExact: hit.exact, qtyBefore, evalBefore, target, qty, cashDelta,
      qtyAfter: p.qty, evalAfter: p.qty * hit.price, structural, note };
  };

  const initialTrades = [];
  for (const p of positions) {
    if (p.effectiveStart > startBiz) continue;
    if (p.effectiveEnd < startBiz) continue;
    p.active = true;
  }
  {
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
  const steps = [];
  for (const s of slots) steps.push({ date: s.rebalDate, kind: 'rebal', slot: s });
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
  const KIND_ORDER = { exdiv: 0, pay: 1, event: 2, rebal: 3 };
  steps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));

  const pendingDiv = new Map();
  const monthMap = new Map();
  const monthOf = (ym) => {
    let m = monthMap.get(ym);
    if (!m) {
      m = { ym, trades: [], dividends: [], tradeNet: 0, structuralNet: 0, cumTradeNet: 0,
        divAccrued: 0, cumDivAccrued: 0, divPaid: 0, cumDivPaid: 0,
        cashDelta: 0, cashEnd: 0, evalEnd: 0, totalEnd: 0, evalBeforeSum: 0,
        lastDate: '', holdings: [] };
      monthMap.set(ym, m);
    }
    return m;
  };
  for (const ym of monthsBetween(startBiz, endBiz)) monthOf(ym);
  const pushTrade = (t) => {
    const m = monthOf(ymOf(t.date));
    m.trades.push(t);
    if (t.structural) m.structuralNet += t.cashDelta; else m.tradeNet += t.cashDelta;
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
      for (const r of rows) { m.divPaid += r.amount; cash += r.amount; }
      continue;
    }
    if (step.kind === 'event') {
      const e = step.event;
      for (const aid of e.removeAssets) {
        const p = posById.get(aid);
        if (!p || !p.active) continue;
        if (p.qty > 0) { const t = adjustTo(p, e.date, 0, true); if (t) pushTrade(t); }
        p.active = false;
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
      }
      if (e.funding === 'reallocate') {
        const base = ratioBaseAt(e.date);
        const acts = positions.filter((p) => p.active);
        const plans = acts.map((p) => {
          const hit = priceAt(prices[p.asset.code], e.date);
          const target = targetOf(p, config, base);
          return { p, target, delta: hit.missing ? 0 : target - p.qty * hit.price };
        });
        for (const pl of plans.filter((x) => x.delta < 0)) { const t = adjustTo(pl.p, e.date, pl.target, true); if (t) pushTrade(t); }
        for (const pl of plans.filter((x) => x.delta > 0)) { const t = adjustTo(pl.p, e.date, pl.target, true); if (t) pushTrade(t); }
      } else if (e.funding === 'cash') {
        const base = ratioBaseAt(e.date);
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
      const base = ratioBaseAt(s.rebalDate);
      const eligible = [];
      for (const aid of s.assetIds) {
        const p = posById.get(aid);
        if (!p) continue;
        if (s.rebalDate < p.effectiveStart || s.rebalDate > p.effectiveEnd) continue;
        if (!p.active) p.active = true;
        eligible.push(p);
      }
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
  let cumTrade = 0, cumDivAccrued = 0, cumDivPaid = 0, cumStructural = 0;
  let runCash = config.initialCapital + config.extraCash;
  for (const t of initialTrades) runCash += t.cashDelta;
  const runQty = new Map();
  for (const p of positions) runQty.set(p.asset.id, 0);
  for (const t of initialTrades) runQty.set(t.assetId, (runQty.get(t.assetId) ?? 0) + t.qty);
  for (const m of months) {
    m.trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    m.dividends.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
    cumTrade += m.tradeNet; cumStructural += m.structuralNet;
    cumDivAccrued += m.divAccrued; cumDivPaid += m.divPaid;
    m.cumTradeNet = cumTrade; m.cumDivAccrued = cumDivAccrued; m.cumDivPaid = cumDivPaid;
    m.cashDelta = m.tradeNet + m.structuralNet + m.divPaid;
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
      cumTradeNet: cumTrade, cumStructuralNet: cumStructural, cumDivAccrued, cumDivPaid,
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
      targetMode: 'ratio', ratioBase: 'equity', rounding: 'floor',
      assets: [{ id: 'b1', code: K200, name: 'K', payCycle: 'mid', targetRatio: 50 },
               { id: 'b2', code: KFIN, name: 'F', payCycle: 'eom', targetRatio: 50 }],
    }),
    prices: PRICES, dividends: DIVS, holidays: KR26,
  });
  ok('#43 ⚠️ 비중 모드 초기매수 — ratioBase=equity라도 투입자본을 분모로 써야 한다(0원 붕괴 방지)',
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
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
