// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ComposedChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Line, ReferenceArea, ReferenceLine, ReferenceDot, Tooltip as RechartsTooltip } from 'recharts';
import { X, Plus, RefreshCw, ExternalLink, Calendar, Percent, TrendingUp, Wallet } from 'lucide-react';
import ErrorBoundary from './ErrorBoundary';
import CustomDatePicker from './CustomDatePicker';
import { formatChangeRate, selectionDimBands } from '../utils';
import { CHART_SELECTION } from '../design';
import { detectMarket, fetchWatchQuote, fetchWatchDaily, fmtWatchPrice } from '../watchlistQuote';
import {
  CHART_PERIODS, CHART_CUSTOM_PERIOD, CHART_SERIES_COLORS, MAX_CHART_COMPS,
  periodCutoff, watchPeriodWindow, windowRate, buildChartRows, closeOnOrBefore, rangeRate, chartDateLabel,
  normalizeChartCode, normalizeChartComps, normalizeChartView, stockDetailUrl, stockChartUrl,
  EMPTY_CHART_SEL, chartSelStep,
  holdingsFor, holdingAvg, holdingPct, holdingLayout, normalizeHoldings, krCodeWithZeros,
} from '../watchlistChart';

/**
 * 종목 비교 차트 **별도 브라우저 창** (`/?stockChartWindow=1&code=…&market=…&period=…`).
 * 관심종목의 미니차트를 누르면 열린다(사용자 요청 2026-10 — 사진2의 수익률 비교 차트를 종목 하나에 대해).
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다 — 시세·종가를 **스스로** 조회하고(공개 프록시/Edge 함수, 인증 불필요)
 *    아무것도 저장하지 않는다(쓰기 0 — writer는 끝까지 앱 탭 하나).
 *    비교 종목·기간은 이 창의 주소(URL)에만 남긴다(새로고침해도 유지 — localStorage·Drive 금지).
 * ⚠️ opener와는 **읽기 전용 물음 하나**만 주고받는다(사용자 요청 2026-10-30 — 보유 종목 매입가 가로선):
 *    창 → opener `stockchart:ping { codes }` / opener(관심종목 팝업 — 앱 탭 또는 관심종목 창) →
 *    `stockchart:holdings { holdings }`. 받은 값은 이 창 메모리에만 두고, 이 창이 보내는 메시지는 ping 하나뿐이다
 *    (쓰기 메시지를 늘리면 '두 번째 writer'가 된다). 매입가를 주소에 싣지 말 것 — 주소창·방문 기록에 남는다.
 * ⚠️ 구간 자르기·기간 수익률은 관심종목 팝업과 **같은 함수**(watchlistChart.watchPeriodWindow·windowRate)를
 *    쓰고 종가도 같은 소스(fetchWatchDaily)라, 같은 기간이면 팝업 등락율과 차트 끝점이 한 글자도 다르지 않다.
 * ⚠️ 조회 결과를 공유 stockHistoryMap에 병합하지 말 것 — 이 창은 그 맵에 닿을 수조차 없고(App 미마운트),
 *    닿게 만들면 보유종목 과거 평가액이 영구히 오염된다(관심종목·백테스트와 같은 불변식).
 * ⚠️ 자체 `ErrorBoundary label`이 필요하다(main.tsx 루트 경계는 label이 없어 창 전체가 오류 페이지가 된다).
 */

const MARKETS = ['kr', 'us', 'fund'];
const MARKET_LABEL = { kr: '국내', us: '해외', fund: '펀드' };
const todayKST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const fmtShort = (d) => (typeof d === 'string' && d.length >= 10 ? d.slice(2).replace(/-/g, '/') : '');
const rateCls = (r) => (r == null ? 'text-gray-500' : r > 0 ? 'text-red-400' : r < 0 ? 'text-blue-400' : 'text-gray-400');
const fmtPct = (r) => (r == null || !Number.isFinite(r) ? '-' : `${r > 0 ? '+' : ''}${r.toFixed(2)}%`);
// 선 데이터 키는 's0'…'s8' — 종목 코드를 그대로 쓰면 'BRK.B' 같은 점이 recharts 경로로 해석된다.
const seriesKey = (i) => `s${i}`;
// 종가 보기의 오른쪽 눈금 id — 왼쪽은 recharts 기본(0)이라 딤·시작점·0% 선은 yAxisId 없이 그대로 왼쪽을 쓴다.
const RIGHT_AXIS = 'R';
const isUsd = (market) => market === 'us';
// 보유 매입가 물음 주기 — 앱에서 종목을 사고팔거나 계좌를 고치면 이 주기 안에 선이 따라온다.
const HOLD_PING_MS = 4000;
// 국내 원화 매입가는 포트폴리오 테이블처럼 원 단위로 반올림해 보인다(선 높이는 반올림 전 값).
const fmtAvg = (market, v) => fmtWatchPrice(market, market === 'kr' ? Math.round(v) : v);
// 매입가 점선 무늬 — 같은 종목을 여러 계좌에 보유하면 계좌마다 무늬가 달라 선끼리 구분된다(색은 그 종목 색 그대로).
const AVG_DASHES = ['6 4', '2 3', '10 3 2 3', '1 4'];
// 매입가 태그 폭 어림(SVG 글자 폭 — 한글·기호는 넓게).
const tagWidth = (t) => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2000 ? 10.5 : 6.2), 10);

// 매입가 가로선 오른쪽 끝의 태그(증권사 차트의 '매입가' 표시처럼) — 선 높이에 그 종목 색 테두리 상자.
// 높이가 비슷한 선의 태그끼리 겹치면 렌더 뒤 stackAvgTags가 위아래로 벌린다(data-avg-y = 선의 실제 높이).
const TAG_H = 17;
function AvgTag({ viewBox, text, color }) {
  if (!viewBox || !Number.isFinite(viewBox.y) || !Number.isFinite(viewBox.x) || !Number.isFinite(viewBox.width)) return null;
  const w = tagWidth(text);
  const x0 = viewBox.x + viewBox.width - w - 4;
  return (
    <g pointerEvents="none" data-avg-tag="" data-avg-y={viewBox.y}>
      <rect x={x0} y={viewBox.y - 9} width={w} height={17} rx={3} fill="#0b1120" fillOpacity={0.88} stroke={color} strokeWidth={1} />
      <text x={x0 + 5} y={viewBox.y + 3.5} fill={color} fontSize={10.5} fontWeight={700}>{text}</text>
    </g>
  );
}

// 매입가 태그 겹침 풀기 — 렌더된 태그를 선 높이(data-avg-y) 순으로 훑어 위에서부터 태그 높이만큼 띄우고,
// 플롯 아래로 넘치면 위로 민다. 선 자체는 제자리이고 태그만 옮긴다(transform — React가 관리하지 않는 속성).
// ⚠️ ResponsiveContainer는 크기가 바뀌면 **자기만** 다시 그린다 → 부모 effect가 아니라 MutationObserver로 따라간다.
//    관찰은 태그 추가·삭제(childList)와 data-avg-y 변화뿐 — 여기서 쓰는 transform은 관찰 대상이 아니라 되먹임이 없다.
function stackAvgTags(root) {
  if (!root) return;
  const tags = [...root.querySelectorAll('g[data-avg-tag]')]
    .map((g) => ({ g, y: Number(g.getAttribute('data-avg-y')) }))
    .filter((t) => Number.isFinite(t.y))
    .sort((a, b) => a.y - b.y);
  if (!tags.length) return;
  const axis = root.querySelector('.recharts-yAxis .recharts-cartesian-axis-line');
  const ay1 = axis ? Number(axis.getAttribute('y1')) : NaN;
  const ay2 = axis ? Number(axis.getAttribute('y2')) : NaN;
  const top = Number.isFinite(ay1) && Number.isFinite(ay2) ? Math.min(ay1, ay2) + TAG_H / 2 : -Infinity;
  const bottom = Number.isFinite(ay1) && Number.isFinite(ay2) ? Math.max(ay1, ay2) - TAG_H / 2 : Infinity;
  const gap = TAG_H + 2;
  const pos = tags.map((t) => t.y);
  for (let i = 0; i < pos.length; i++) pos[i] = Math.max(pos[i], i ? pos[i - 1] + gap : top);
  for (let i = pos.length - 1; i >= 0; i--) pos[i] = Math.min(pos[i], i === pos.length - 1 ? bottom : pos[i + 1] - gap);
  tags.forEach((t, i) => {
    const dy = pos[i] - t.y;
    if (Math.abs(dy) < 0.5) t.g.removeAttribute('transform');
    else t.g.setAttribute('transform', `translate(0 ${dy.toFixed(1)})`);
  });
}

function readInitial() {
  const p = new URLSearchParams(window.location.search);
  const code0 = normalizeChartCode(p.get('code') || '');
  const code = detectMarket(code0) === 'kr' ? code0.toUpperCase() : code0;
  const mk = p.get('market');
  const market = MARKETS.includes(mk) ? mk : detectMarket(code);
  const view = normalizeChartView({ period: p.get('period'), customStart: p.get('from') || '', customEnd: p.get('to') || '' });
  const comps = normalizeChartComps(p.get('comp') || '', code).map((c) => ({ code: c, market: detectMarket(c) }));
  return { main: { code, market, name: (p.get('name') || '').slice(0, 80) }, view, comps };
}

function StockChartPage() {
  const init = useMemo(readInitial, []);
  const [main, setMain] = useState(init.main);
  const [comps, setComps] = useState(init.comps);
  const [view, setView] = useState(init.view);
  const [mode, setMode] = useState('pct');            // 'pct' = 수익률(%) · 'price' = 종가
  const [quotes, setQuotes] = useState({});            // { [code]: { name, price, changeRate } }
  const [dailyMap, setDailyMap] = useState({});        // { [code]: [date, close][] | null(실패) }
  const [status, setStatus] = useState({});            // { [code]: 'loading' | 'ok' | 'fail' }
  const [input, setInput] = useState('');
  const [inputMsg, setInputMsg] = useState('');
  const [hover, setHover] = useState('');
  const [sel, setSel] = useState(EMPTY_CHART_SEL);
  const selRef = useRef(EMPTY_CHART_SEL);
  // 보유 종목 매입가 `{ [holdingKey]: [{ acct, avg, qty, cur }] }` — opener가 답해 준 값(메모리 전용).
  const [holdings, setHoldings] = useState({});
  const [showAvg, setShowAvg] = useState(true);       // 매입가 선 보이기(이 창 안에서만 — 저장하지 않는다)
  const dailyFromRef = useRef({});                     // code:market → 받은 이력의 시작일
  const dailySeqRef = useRef({});                      // code:market → 조회 세대(늦게 온 응답 폐기)
  const today = todayKST();

  const all = useMemo(() => [main, ...comps].filter((s) => s.code), [main, comps]);
  const cutoff = view.period === CHART_CUSTOM_PERIOD ? '' : periodCutoff(view.period, today);
  const needFrom = view.period === CHART_CUSTOM_PERIOD ? view.customStart : cutoff;

  useEffect(() => {
    const nm = quotes[main.code]?.name || main.name || main.code;
    document.title = nm ? `${nm} — 종목 차트` : '종목 차트';
  }, [quotes, main]);

  // 주소에 현재 상태를 남긴다(새로고침·북마크해도 같은 차트) — 종목·기간만(사용자 데이터 없음).
  useEffect(() => {
    if (!main.code) return;
    try {
      window.history.replaceState(null, '', stockChartUrl({
        code: main.code, market: main.market, name: main.name, period: view.period,
        customStart: view.customStart, customEnd: view.customEnd, comps: comps.map((c) => c.code),
      }));
    } catch { /* 주소 갱신 실패는 무해 */ }
  }, [main, comps, view]);

  const loadQuote = useCallback(async (s) => {
    const d = await fetchWatchQuote(s.market, s.code);
    if (d) setQuotes((p) => ({ ...p, [s.code]: d }));
    return !!d;
  }, []);

  // 일별 종가 — 이미 받은 이력이 needFrom보다 늦게 시작하면 더 길게 다시 받는다(관심종목 loadDaily와 같은 규칙).
  const loadDaily = useCallback(async (s, from, force = false) => {
    const key = s.code + ':' + s.market;
    const have = dailyFromRef.current[key];
    if (!force && have && (!from || have <= from)) return;
    const seq = (dailySeqRef.current[key] || 0) + 1;
    dailySeqRef.current[key] = seq;
    setStatus((p) => ({ ...p, [s.code]: 'loading' }));
    const [pairs] = await Promise.all([fetchWatchDaily(s.market, s.code, from || undefined), loadQuote(s)]);
    if (dailySeqRef.current[key] !== seq) return;
    if (pairs && pairs.length >= 2) {
      const oneYear = periodCutoff('1년', todayKST());
      dailyFromRef.current[key] = from && from < oneYear ? from : oneYear;
      setDailyMap((p) => ({ ...p, [s.code]: pairs }));
      setStatus((p) => ({ ...p, [s.code]: 'ok' }));
    } else {
      // 앞자리 0이 빠진 국내 코드('241D0' → '0241D0') — 국내 6자리로 다시 받아 보고 맞으면 그 종목의 코드를 고친다.
      // 받은 이력을 새 코드로 먼저 실어 두므로, 코드가 바뀐 뒤의 loadDaily는 다시 받지 않는다(시세만 새로 묻는다).
      const zero = krCodeWithZeros(s.code);
      const isMain = !!all[0] && all[0].code === s.code;
      if (zero && !isMain && all.some((x) => x.code.toUpperCase() === zero)) {
        setComps((p) => p.filter((c) => c.code !== s.code));   // 고친 코드가 이미 차트에 있다 — 겹친 비교 종목을 뺀다
        return;
      }
      if (zero && !all.some((x) => x.code.toUpperCase() === zero)) {
        const p2 = await fetchWatchDaily('kr', zero, from || undefined);
        if (dailySeqRef.current[key] !== seq) return;
        if (p2 && p2.length >= 2) {
          const oneYear = periodCutoff('1년', todayKST());
          dailyFromRef.current[zero + ':kr'] = from && from < oneYear ? from : oneYear;
          setDailyMap((p) => ({ ...p, [zero]: p2 }));
          setStatus((p) => ({ ...p, [zero]: 'ok' }));
          loadQuote({ code: zero, market: 'kr' });
          if (isMain) setMain((m) => (m.code === s.code ? { ...m, code: zero, market: 'kr' } : m));
          else setComps((p) => p.map((c) => (c.code === s.code ? { ...c, code: zero, market: 'kr' } : c)));
          return;
        }
      }
      setDailyMap((p) => (Array.isArray(p[s.code]) ? p : { ...p, [s.code]: null }));
      setStatus((p) => ({ ...p, [s.code]: 'fail' }));
      delete dailyFromRef.current[key];
    }
  }, [loadQuote, all]);

  useEffect(() => {
    all.forEach((s) => loadDaily(s, needFrom));
  }, [all, needFrom, loadDaily]);

  // ── 보유 매입가: opener에 묻고(ping) 답(holdings)만 받는다 — 읽기 전용 ──
  const codesKey = all.map((s) => s.code).join(',');
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;           // ⚠️ 필수 — 교차 출처 무시
      if (!window.opener || e.source !== window.opener) return;   // opener의 답만
      const d = e.data;
      if (!d || typeof d !== 'object' || d.type !== 'stockchart:holdings') return;
      const h = normalizeHoldings(d.holdings);
      if (!h) return;   // null = opener가 아직 계좌를 다 읽지 못했다 → 기존 선을 지우지 않는다
      setHoldings((prev) => (JSON.stringify(prev) === JSON.stringify(h) ? prev : h));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => {
    const codes = codesKey ? codesKey.split(',') : [];
    const ping = () => {
      const op = window.opener;
      if (!op || op.closed) return;
      try { op.postMessage({ type: 'stockchart:ping', codes }, window.location.origin); } catch { /* 닫히는 중 */ }
    };
    ping();
    const id = setInterval(ping, HOLD_PING_MS);
    return () => clearInterval(id);
  }, [codesKey]);

  const refreshAll = () => {
    dailyFromRef.current = {};
    all.forEach((s) => loadDaily(s, needFrom, true));
  };

  // ── 시리즈: 화면의 '기간 수익률'과 같은 구간(watchPeriodWindow) ──
  const series = useMemo(() => all.map((s, i) => {
    const q = quotes[s.code];
    const { win, liveTail } = watchPeriodWindow(dailyMap[s.code], {
      period: view.period, cutoff, customStart: view.customStart, customEnd: view.customEnd,
      livePrice: q ? Number(q.price) : 0, today,
    });
    return {
      ...s, i, key: seriesKey(i), win, liveTail,
      name: q?.name || s.name || s.code,
      color: CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length],
      stat: windowRate(win),
      hold: holdingsFor(holdings, s.code, s.market),   // 포트폴리오 테이블에 있는 종목이면 계좌별 매입가
    };
  }), [all, quotes, dailyMap, view, cutoff, today, holdings]);

  const rows = useMemo(() => buildChartRows(series.map((s) => ({ key: s.key, win: s.win }))), [series]);
  // 종가 보기도 모든 종목을 겹쳐 그린다 — 통화가 같은 종목끼리 한 눈금(실제 가격 그대로 비교),
  // 기준 종목과 통화가 다른 종목(원화 ↔ 달러)만 오른쪽 눈금. 수익률 보기는 전부 왼쪽(%) 하나.
  const shown = series.map((s) => ({ ...s, axisId: mode === 'price' && isUsd(s.market) !== isUsd(main.market) ? RIGHT_AXIS : 0 }));
  const rightS = shown.find((s) => s.axisId === RIGHT_AXIS);
  const dim = sel.left && sel.right ? selectionDimBands(rows, sel.left, sel.right) : null;
  // 마우스가 가리키는 날짜의 값마다 가로줄(수익률 차트와 같은 방식) — 그 값이 차트 전체에서 어느 시기와 같은 높이인지 보이게.
  //   구간 선택(딤) 중에는 끄고, 그날 값이 없는 시리즈(휴장 등)는 건너뛴다
  const hoverLevels = !hover || dim ? [] : shown.flatMap((s) => {
    const row = rows.find((x) => x.date === hover);
    const v = row ? row[mode === 'pct' ? s.key : `px:${s.key}`] : null;
    return v == null || !Number.isFinite(v) ? [] : [{ key: s.key, axisId: s.axisId, color: s.color, v, text: mode === 'pct' ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : fmtWatchPrice(s.market, v) }];
  });
  // ── 보유 매입가 가로선(계좌마다 한 줄, 그 종목 선 색 점선) ──
  // 수익률 보기: 그 종목 구간 첫 종가(= buildChartRows의 0% 기준)로 환산한 높이 · 종가 보기: 매입가 그대로.
  // 매입가가 시세와 멀어 눈금을 넓히면 시세 선이 높이의 40% 미만으로 눌리는 경우엔 넓히지 않고
  // 차트 위·아래 가장자리에 '범위 밖' 표시만 한다(holdingLayout — 미니차트와 같은 규칙).
  const avgLines = !showAvg ? [] : shown.flatMap((s) => {
    const base = s.stat.first ? s.stat.first[1] : 0;
    const px = Number(quotes[s.code]?.price) > 0 ? Number(quotes[s.code].price) : (s.stat.last ? s.stat.last[1] : 0);
    return s.hold.map((h, j) => {
      const v = mode === 'pct' ? holdingPct(h.avg, base) : h.avg;
      const ret = px > 0 ? (px / h.avg - 1) * 100 : null;
      return { key: `avg-${s.key}-${j}`, s, h, v, ret, dash: AVG_DASHES[j % AVG_DASHES.length] };
    }).filter((l) => l.v != null && Number.isFinite(l.v));
  });
  const avgMulti = avgLines.length > 1;
  const avgText = (l) => `매입가 ${fmtAvg(l.s.market, l.h.avg)}${l.ret != null ? ` · ${fmtPct(l.ret)}` : ''}${avgMulti ? ` · ${l.h.acct}` : ''}`;
  // 눈금마다 따로 잰다(원화·달러 눈금은 서로를 넓히지 않는다) — 다른 눈금의 매입가는 NaN으로 넘겨 이번 판정에서 뺀다.
  const avgLayout = (() => {
    const pins = avgLines.map(() => '');
    for (const ax of new Set(shown.map((s) => s.axisId))) {
      let lo = Infinity, hi = -Infinity;
      for (const r of rows) for (const s of shown) {
        if (s.axisId !== ax) continue;
        const v = r[mode === 'pct' ? s.key : `px:${s.key}`];
        if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      if (mode === 'pct' && Number.isFinite(lo)) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }   // 0% 기준선도 눈금 안
      const lay = holdingLayout(Number.isFinite(lo) ? lo : NaN, Number.isFinite(hi) ? hi : NaN, avgLines.map((l) => (l.s.axisId === ax ? l.v : NaN)), 0.4);
      avgLines.forEach((l, i) => { if (l.s.axisId === ax) pins[i] = lay.pins[i]; });
    }
    return { pins };
  })();
  const holdAny = series.some((s) => s.hold.length > 0);
  const chartBoxRef = useRef(null);
  useEffect(() => {
    const box = chartBoxRef.current;
    if (!box || typeof MutationObserver === 'undefined') return;
    stackAvgTags(box);
    const mo = new MutationObserver(() => stackAvgTags(box));
    mo.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-avg-y'] });
    return () => mo.disconnect();
  }, []);
  const firstDate = rows[0]?.date || '';
  const lastDate = rows[rows.length - 1]?.date || '';

  // ── 구간 선택(드래그 · 더블클릭 시작점 고정 → 끝점 클릭) — 상태 전이는 watchlistChart.chartSelStep이 정본 ──
  // ⚠️ ref가 정본이다 — mousemove 커밋 전에 mouseup이 와도 선택이 사라지지 않게(수익률 차트와 같은 규약).
  //    React state(sel)는 딤·시작점 선을 그리기 위한 거울일 뿐이다.
  const step = useCallback((ev) => {
    const next = chartSelStep(selRef.current, ev);
    if (next === selRef.current) return;   // 바뀐 게 없으면 렌더하지 않는다
    selRef.current = next;
    setSel(next);
  }, []);
  // 더블클릭의 두 번째 클릭(detail ≥ 2)은 down·up 모두 무시한다(시작점 고정 직후 번쩍임 방지).
  const isSecond = (ev) => !!ev && ev.detail >= 2;
  useEffect(() => {
    // 차트 밖에서 버튼을 놓아도 드래그를 마무리하고, 창을 떠나면(alt-tab) 그 자리에서 확정한다.
    const up = (e) => step({ type: 'up', second: isSecond(e) });
    const blur = () => step({ type: 'up' });
    const key = (e) => { if (e.key === 'Escape') step({ type: 'clear' }); };
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('blur', blur); window.removeEventListener('keydown', key); };
  }, [step]);
  // 기간을 바꾸면 선택 구간·시작점을 지운다(수익률 차트의 '조회기간 변경 = 해제' 규약 — 낡은 구간이 남지 않게).
  useEffect(() => {
    step({ type: 'clear' });
  }, [view.period, view.customStart, view.customEnd]);
  const onDown = (e, ev) => step({ type: 'down', label: e?.activeLabel || '', second: isSecond(ev) });
  const onUp = (e, ev) => step({ type: 'up', second: isSecond(ev) });
  // recharts는 플롯 밖 더블클릭에 null을 넘긴다 → activeLabel 가드는 chartSelStep('dbl')이 진다.
  const onDouble = (e) => step({ type: 'dbl', label: e?.activeLabel || '' });
  const onMove = (e, ev) => {
    const label = e?.activeLabel || '';
    if (label !== hover) setHover(label);
    // 드래그 중이면 끝점이 따라오고, 시작점을 고정한 뒤에는 버튼을 안 눌러도 따라온다(미리보기).
    step({ type: 'move', label, buttons: ev ? ev.buttons : undefined });
  };

  // ── 종목 추가·삭제·시장 보정 ──
  const addComp = () => {
    const c0 = normalizeChartCode(input);
    const c = detectMarket(c0) === 'kr' ? c0.toUpperCase() : c0;   // 국내 코드는 대문자가 정본(관심종목 추가와 같은 규칙)
    if (!c) { setInputMsg('종목 코드를 입력하세요.'); return; }
    if (all.some((s) => s.code.toLowerCase() === c.toLowerCase())) { setInputMsg('이미 차트에 있는 종목입니다.'); setInput(''); return; }
    if (comps.length >= MAX_CHART_COMPS) { setInputMsg(`비교 종목은 ${MAX_CHART_COMPS}개까지입니다.`); return; }
    setComps((p) => [...p, { code: c, market: detectMarket(c) }]);
    setInput('');
    setInputMsg('');
  };
  const removeComp = (code) => setComps((p) => p.filter((c) => c.code !== code));
  const fixMarket = (s, market) => {
    if (s.i === 0) setMain((m) => ({ ...m, market }));
    else setComps((p) => p.map((c) => (c.code === s.code ? { ...c, market } : c)));
    delete dailyFromRef.current[s.code + ':' + market];
  };

  // ── 상단 정보 줄: 선택 구간 > 호버 날짜 > 조회기간 요약 ──
  const selFrom = dim ? dim.start : '';
  const selTo = dim ? dim.end : '';
  const infoTitle = dim
    ? (sel.anchor
      ? `선택 중 ${chartDateLabel(selFrom)} ~ ${chartDateLabel(selTo)} — 클릭하면 확정`
      : `선택 구간 ${chartDateLabel(selFrom)} ~ ${chartDateLabel(selTo)}`)
    : sel.anchor
      ? `시작점 ${chartDateLabel(sel.anchor)} 고정 — 마우스를 옮겨 끝점을 클릭하세요`
      : hover
      ? chartDateLabel(hover)
      : firstDate ? `조회기간 ${chartDateLabel(firstDate)} ~ ${chartDateLabel(lastDate)}` : '조회기간';

  const mainQ = quotes[main.code];
  const mainS = series[0];
  // 보유 매입가는 **계좌마다 따로** 보인다(사용자 요청 2026-10-30 — 같은 종목을 여러 계좌에 보유하면 계좌별 평균단가).
  // 합산 값은 툴팁의 참고 한 줄뿐이다(선·머리글·칩에 합산을 쓰지 않는다).
  const mainPx = mainQ && Number(mainQ.price) > 0 ? Number(mainQ.price) : 0;
  const fmtQty = (n) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 }).format(n);
  const holdTitle = (s) => {
    const px = Number(quotes[s.code]?.price) > 0 ? Number(quotes[s.code].price) : 0;
    const sum = s.hold.length > 1 ? holdingAvg(s.hold) : null;
    const lines = s.hold.map((h) => `${h.acct} · ${fmtQty(h.qty)}${s.market === 'fund' ? '좌' : '주'} · 매입가 ${fmtAvg(s.market, h.avg)}${px > 0 ? ` · 현재가 대비 ${fmtPct((px / h.avg - 1) * 100)}` : ''}`);
    return `보유 종목(포트폴리오 테이블 구매단가 — 계좌마다)\n${lines.join('\n')}${sum ? `\n(참고) 전체 합산 매입가 ${fmtAvg(s.market, sum.avg)}` : ''}\n차트의 점선 = 계좌마다의 매입가${s.hold.length > 1 ? '(점선 무늬로 계좌 구분)' : ''}`;
  };
  const periodLabel = view.period === CHART_CUSTOM_PERIOD
    ? `${fmtShort(view.customStart)}~${view.customEnd ? fmtShort(view.customEnd) : '현재'}`
    : view.period;

  if (!main.code) {
    return (
      <div className="fixed inset-0 bg-[#0b1120] flex items-center justify-center text-gray-400 text-sm">
        종목 코드가 없습니다 — 관심종목에서 미니차트를 눌러 여세요.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0b1120] flex flex-col text-gray-200">
      {/* 상단 바 — 기준 종목 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 bg-gray-900 border-b border-gray-700/50">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CHART_SERIES_COLORS[0] }} />
        <span className="text-base font-bold text-gray-100 truncate max-w-[50vw]" title={mainS?.name}>{mainS?.name}</span>
        <span className="text-xs text-gray-500">{main.code} · {MARKET_LABEL[main.market] || main.market}</span>
        {mainQ && (
          <span className="text-sm tabular-nums">
            <span className="text-gray-100 font-semibold">{fmtWatchPrice(main.market, mainQ.price)}</span>
            <span className={`ml-2 text-xs ${rateCls(mainQ.changeRate)}`}>{formatChangeRate(mainQ.changeRate)}</span>
            <span className="ml-1 text-[10px] text-gray-500">전일 대비</span>
          </span>
        )}
        {mainS?.hold.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums cursor-help" title={holdTitle(mainS)}>
            {mainS.hold.length > 1 && <span className="text-gray-500">보유</span>}
            {mainS.hold.map((h, j) => {
              const r = mainPx > 0 ? (mainPx / h.avg - 1) * 100 : null;
              return (
                <span key={j} className="flex items-center whitespace-nowrap">
                  {/* 여러 계좌면 그 계좌 점선 무늬 견본 — 차트의 어느 선이 어느 계좌인지 머리글에서 바로 짝짓는다 */}
                  {mainS.hold.length > 1 && (
                    <svg width={18} height={6} className="mr-1 shrink-0"><line x1={0} x2={18} y1={3} y2={3} stroke={CHART_SERIES_COLORS[0]} strokeWidth={1.5} strokeDasharray={AVG_DASHES[j % AVG_DASHES.length]} /></svg>
                  )}
                  <span className="font-semibold" style={{ color: CHART_SERIES_COLORS[0] }}>
                    {mainS.hold.length > 1 ? h.acct : '보유'} {fmtQty(h.qty)}{main.market === 'fund' ? '좌' : '주'} · 매입가 {fmtAvg(main.market, h.avg)}
                  </span>
                  {r != null && <span className={`ml-1.5 font-bold ${rateCls(r)}`}>{fmtPct(r)}</span>}
                </span>
              );
            })}
          </span>
        )}
        <button
          onClick={() => window.open(stockDetailUrl(main.market, main.code), '_blank')}
          title="종목 상세 페이지(네이버 증권·야후 등)"
          className="text-gray-500 hover:text-sky-300 p-1 rounded transition-colors"
        >
          <ExternalLink size={14} />
        </button>
        <span className="flex-1" />
        <button
          onClick={refreshAll}
          title="모든 종목 종가·현재가 다시 조회"
          className="flex items-center gap-1 px-2 py-1 rounded border border-gray-700 text-xs text-gray-400 hover:text-teal-300 hover:border-teal-700/60 transition-colors"
        >
          <RefreshCw size={12} className={Object.values(status).includes('loading') ? 'animate-spin' : ''} /> 새로고침
        </button>
        <button onClick={() => { try { window.close(); } catch {} }} title="창 닫기" className="text-gray-400 hover:text-white p-1 rounded transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* 비교 종목 칩 + 추가 */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-800/70">
        {series.map((s) => {
          const st = status[s.code];
          return (
            <div key={s.code} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: `${s.color}80`, backgroundColor: `${s.color}14` }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="font-mono text-gray-400">{s.code}</span>
              <span className="font-bold max-w-[180px] truncate" style={{ color: s.color }} title={s.name}>{s.name}</span>
              <span className={`tabular-nums font-semibold ${rateCls(s.stat.rate)}`}>{fmtPct(s.stat.rate)}</span>
              {s.hold.length > 0 && (
                <span className="tabular-nums text-gray-400 cursor-help" title={holdTitle(s)}>
                  매입 {s.hold.slice(0, 3).map((h) => fmtAvg(s.market, h.avg)).join(' / ')}{s.hold.length > 3 ? ` 외 ${s.hold.length - 3}계좌` : ''}
                </span>
              )}
              {st === 'loading' && <RefreshCw size={10} className="animate-spin text-gray-500" />}
              {st === 'fail' && (
                <span className="flex items-center gap-0.5 text-red-400/90">
                  조회 실패 · 시장
                  {MARKETS.map((m) => (
                    <button
                      key={m}
                      onClick={() => fixMarket(s, m)}
                      className={`rounded px-1 border ${s.market === m ? 'border-amber-500/50 text-amber-300' : 'border-gray-700 text-gray-400 hover:text-amber-300'}`}
                    >{MARKET_LABEL[m]}</button>
                  ))}
                </span>
              )}
              {s.i > 0 && (
                <button onClick={() => removeComp(s.code)} title="비교에서 빼기" className="text-gray-600 hover:text-red-400 transition-colors">
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
        {comps.length < MAX_CHART_COMPS && (
          <span className="flex items-center gap-1">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); if (inputMsg) setInputMsg(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') addComp(); }}
              placeholder="비교 종목 코드"
              className="w-32 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-green-600/60 placeholder:text-gray-600"
            />
            <button
              onClick={addComp}
              title="비교 종목 추가"
              className="flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-bold text-gray-500 hover:text-green-400 border border-gray-700 hover:border-green-700/50 transition-colors"
            >
              <Plus size={11} /> 추가
            </button>
          </span>
        )}
        {inputMsg && <span className="text-[11px] text-amber-300">{inputMsg}</span>}
      </div>

      {/* 기간 · 표시 방식 */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-gray-800/70">
        {CHART_PERIODS.map((pd) => (
          <button
            key={pd}
            onClick={() => setView((v) => normalizeChartView(pd === CHART_CUSTOM_PERIOD
              ? { ...v, period: pd, customStart: v.customStart || periodCutoff('1개월', todayKST()) }
              : { ...v, period: pd }))}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium border transition-colors ${
              view.period === pd ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'border-gray-700 text-gray-400 hover:text-amber-300'
            }`}
          >
            {pd === CHART_CUSTOM_PERIOD && <Calendar size={11} />}{pd === CHART_CUSTOM_PERIOD ? '기간' : pd}
          </button>
        ))}
        {view.period === CHART_CUSTOM_PERIOD && (
          <span className="flex items-center gap-1 text-[11px] text-gray-300 ml-1">
            <CustomDatePicker
              value={view.customStart}
              followScroll
              onChange={(v) => setView((cur) => normalizeChartView({ ...cur, customStart: v, customEnd: cur.customEnd && v > cur.customEnd ? '' : cur.customEnd }))}
            />
            <span className="text-gray-500">~</span>
            <CustomDatePicker
              value={view.customEnd}
              placeholder="현재"
              followScroll
              onChange={(v) => setView((cur) => normalizeChartView({ ...cur, customEnd: v >= todayKST() ? '' : v }))}
            />
            {view.customEnd && (
              <button onClick={() => setView((cur) => ({ ...cur, customEnd: '' }))} title="종료일 비우기 — 현재까지" className="text-gray-500 hover:text-red-400 p-0.5"><X size={10} /></button>
            )}
          </span>
        )}
        <span className="flex-1" />
        {holdAny && (
          <button
            onClick={() => setShowAvg((v) => !v)}
            title={showAvg ? '보유 종목 매입가 점선 숨기기' : '보유 종목 매입가 점선 보이기(포트폴리오 테이블의 구매단가)'}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] border transition-colors ${
              showAvg ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-gray-700 text-gray-500 hover:text-amber-300'
            }`}
          ><Wallet size={11} /> 매입가</button>
        )}
        <span className="flex items-center rounded border border-gray-700 overflow-hidden text-[11px]">
          <button
            onClick={() => setMode('pct')}
            title="수익률(%) — 각 종목을 조회 시작일 종가 0%로 맞춰 비교"
            className={`flex items-center gap-1 px-2 py-1 transition-colors ${mode === 'pct' ? 'bg-red-900/30 text-red-300' : 'text-gray-500 hover:text-gray-300'}`}
          ><Percent size={11} /> 수익률</button>
          <button
            onClick={() => setMode('price')}
            title="종가 — 각 종목의 실제 시세를 겹쳐 비교(같은 통화는 한 눈금 · 원화와 달러가 섞이면 기준 종목과 다른 통화는 오른쪽 눈금)"
            className={`flex items-center gap-1 px-2 py-1 border-l border-gray-700 transition-colors ${mode === 'price' ? 'bg-sky-900/30 text-sky-300' : 'text-gray-500 hover:text-gray-300'}`}
          ><TrendingUp size={11} /> 종가</button>
        </span>
      </div>

      {/* 정보 줄 — 선택 구간 · 호버 날짜 · 조회기간 요약 */}
      <div className="px-4 py-2 border-b border-gray-800/70 text-[12px] flex flex-wrap items-center gap-x-4 gap-y-1 min-h-[34px]">
        <span className="font-semibold text-gray-300">{infoTitle}</span>
        {shown.map((s) => {
          let rate = null, a = null, b = null, note = '';
          if (dim) {
            const r = rangeRate(s.win, selFrom, selTo);
            rate = r.rate; a = r.first; b = r.last;
          } else if (hover) {
            const c = closeOnOrBefore(s.win, hover);
            const row = rows.find((x) => x.date === hover);
            b = c;
            rate = row && row[s.key] != null ? row[s.key] : (c && s.stat.first ? (c[1] / s.stat.first[1] - 1) * 100 : null);
            if (c && c[0] !== hover) note = ` (${fmtShort(c[0])} 종가)`;
          } else {
            rate = s.stat.rate; a = s.stat.first; b = s.stat.last;
          }
          return (
            <span key={s.key} className="flex items-center gap-1.5 tabular-nums">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-gray-400 max-w-[140px] truncate">{s.name}</span>
              <span className={`font-bold ${rateCls(rate)}`}>{fmtPct(rate)}</span>
              {a && b && (
                <span className="text-gray-500 text-[11px]">
                  {fmtWatchPrice(s.market, a[1])} → {fmtWatchPrice(s.market, b[1])}{!dim && s.liveTail ? '(현재가)' : ''}
                </span>
              )}
              {!a && b && <span className="text-gray-500 text-[11px]">종가 {fmtWatchPrice(s.market, b[1])}{note}</span>}
            </span>
          );
        })}
        {/* 사용법 안내는 **항상** 보인다 — 호버 중에만 사라지면 마우스를 차트에 올린 사용자는 영영 못 본다. */}
        {rows.length > 1 && (
          <span className="ml-auto text-[10px] text-gray-500 whitespace-nowrap">
            {sel.anchor
              ? '끝점을 클릭하면 확정 · Esc로 취소'
              : dim
                ? '차트를 한 번 클릭하거나 Esc로 해제'
                : '구간 수익률: 차트를 드래그하거나, 더블클릭으로 시작점 고정 후 끝점 클릭'}
          </span>
        )}
      </div>

      {/* 차트 */}
      <div ref={chartBoxRef} className="relative flex-1 min-h-[300px] px-2 py-3 select-none cursor-crosshair">
        {rows.length < 2 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-500">
            {Object.values(status).includes('loading') || !(main.code in dailyMap)
              ? '종가 이력을 불러오는 중…'
              : status[main.code] === 'fail'
                ? '종가 이력을 불러오지 못했습니다 — 위 칩에서 시장을 바꾸거나 새로고침하세요.'
                : `${periodLabel} 구간에 종가가 1개 이하입니다 — 기간을 넓혀 보세요.`}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={280}>
            {/* onDoubleClick은 <RechartsTooltip>이 있어야 바인딩된다(recharts tooltipEvents) — 툴팁을 빼지 말 것. */}
            <ComposedChart data={rows} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onDoubleClick={onDouble} onMouseLeave={() => setHover('')}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="date" tickFormatter={chartDateLabel} stroke="#9ca3af" tick={{ fontSize: 10 }} minTickGap={40} />
              {mode === 'pct' ? (
                <YAxis stroke="#9ca3af" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} width={48} domain={['auto', 'auto']} />
              ) : (
                <YAxis stroke="#9ca3af" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtWatchPrice(main.market, v)} width={72} domain={['auto', 'auto']} />
              )}
              {rightS && (
                <YAxis yAxisId={RIGHT_AXIS} orientation="right" stroke="#9ca3af" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtWatchPrice(rightS.market, v)} width={72} domain={['auto', 'auto']} />
              )}
              {mode === 'pct' && <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 3" />}
              <RechartsTooltip content={() => null} cursor={{ stroke: '#e5e7eb', strokeWidth: 1 }} />
              {shown.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={mode === 'pct' ? s.key : `px:${s.key}`}
                  yAxisId={s.axisId}
                  stroke={s.color}
                  strokeWidth={s.i === 0 ? 2 : 1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
              {/* 보유 매입가 점선 — 선보다 **뒤**에 선언해 태그가 시세 선 위에 보이게(paint 순서 = 선언 순서).
                  ifOverflow="extendDomain": 눈금을 넓혀 선을 넣는다 — 시세가 납작해질 만큼 먼 매입가는
                  holdingLayout이 미리 가장자리 표시로 돌려 이 목록에서 빠진다(pins[i] !== ''). */}
              {avgLines.map((l, i) => avgLayout.pins[i] === '' && (
                <ReferenceLine key={l.key} y={l.v} yAxisId={l.s.axisId} stroke={l.s.color} strokeOpacity={0.9} strokeWidth={1.2} strokeDasharray={l.dash} ifOverflow="extendDomain"
                  label={({ viewBox }) => <AvgTag viewBox={viewBox} text={avgText(l)} color={l.s.color} />} />
              ))}
              {hoverLevels.map((h) => (
                <ReferenceLine key={`hl-${h.key}`} y={h.v} yAxisId={h.axisId} stroke={h.color} strokeOpacity={0.55} strokeWidth={1} ifOverflow="hidden"
                  label={{ value: h.text, position: h.axisId === RIGHT_AXIS ? 'right' : 'left', fill: h.color, fontSize: 10, fontWeight: 700 }} />
              ))}
              {hoverLevels.map((h) => (
                <ReferenceDot key={`hd-${h.key}`} x={hover} y={h.v} yAxisId={h.axisId} r={4} fill="#f9fafb" stroke={h.color} strokeWidth={2} ifOverflow="hidden" />
              ))}
              {/* 비선택 구간 딤 — 선보다 **뒤에** 선언해야 선 위에 덮인다(paint 순서 = 선언 순서).
                  경계 날짜에서 discard로 밴드가 사라지지 않게 ifOverflow="hidden"(수익률 차트와 같은 규약). */}
              {dim?.before && <ReferenceArea x1={dim.before.from} x2={dim.before.to} fill={CHART_SELECTION.dimFill} fillOpacity={CHART_SELECTION.dimOpacity} stroke="none" ifOverflow="hidden" />}
              {dim?.after && <ReferenceArea x1={dim.after.from} x2={dim.after.to} fill={CHART_SELECTION.dimFill} fillOpacity={CHART_SELECTION.dimOpacity} stroke="none" ifOverflow="hidden" />}
              {dim && <ReferenceArea x1={dim.start} x2={dim.end} fill={CHART_SELECTION.windowFill} fillOpacity={CHART_SELECTION.windowOpacity} stroke={CHART_SELECTION.windowStroke} strokeWidth={CHART_SELECTION.windowStrokeWidth} ifOverflow="hidden" />}
              {/* 더블클릭으로 고정한 시작점 — 딤·선택창보다 **뒤**에 그려야 위에 보인다.
                  ifOverflow="hidden" 필수(첫 날짜에 찍으면 기본값 discard가 선을 통째로 버린다 — 수익률 차트와 같은 근거). */}
              {sel.anchor && (
                <ReferenceLine
                  x={sel.anchor}
                  stroke={CHART_SELECTION.anchorStroke}
                  strokeWidth={CHART_SELECTION.anchorStrokeWidth}
                  strokeDasharray={CHART_SELECTION.anchorDash}
                  ifOverflow="hidden"
                  label={{ value: '시작', position: 'insideTopLeft', fill: CHART_SELECTION.anchorStroke, fontSize: 10 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {/* 매입가가 차트 범위 밖(눈금을 넓히면 시세 선이 납작해지는 거리) — 그 방향 가장자리에 값만 표시 */}
        {rows.length > 1 && ['top', 'bottom'].map((pin) => avgLines.some((l, i) => avgLayout.pins[i] === pin) && (
          <div key={pin} className={`absolute ${rightS ? 'right-24' : 'right-6'} ${pin === 'top' ? 'top-4' : 'bottom-12'} flex flex-col items-end gap-1 pointer-events-none`}>
            {avgLines.map((l, i) => avgLayout.pins[i] === pin && (
              <span key={l.key} className="rounded border px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums bg-[#0b1120]/90" style={{ borderColor: l.s.color, color: l.s.color }}>
                {pin === 'top' ? '▲' : '▼'} {avgText(l)} <span className="font-normal text-gray-500">— 차트 {pin === 'top' ? '위' : '아래'}쪽 범위 밖</span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="px-4 pb-2 text-[10px] text-gray-600">
        수익률 = 각 종목의 조회 시작 후 첫 종가를 0%로 둔 등락(관심종목 등락율과 같은 계산) · 종가는 관심종목 미니차트와 같은 소스
        (종가 보기: 같은 통화는 한 눈금, 원화·달러가 섞이면 기준 종목과 다른 통화는 오른쪽 눈금) ·
        직접 선택 기간에서 종료일을 비우면 마지막 값은 실시간 현재가입니다. 이 창은 아무것도 저장하지 않습니다(비교 종목·기간은 주소에만 남습니다).
        {holdAny && ' · 점선 = 포트폴리오 테이블에 있는 종목의 매입가(구매단가, 계좌마다 한 줄 · 무늬로 계좌 구분 — 앱 창에서 읽어 옵니다).'}
      </div>
    </div>
  );
}

export default function StockChartWindow() {
  return (
    <ErrorBoundary label="종목 차트">
      <StockChartPage />
    </ErrorBoundary>
  );
}
