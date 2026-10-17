// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, Legend,
} from 'recharts';
import ErrorBoundary from './ErrorBoundary';
import { BG, BORDER } from '../design';
import {
  computeRateMetrics, parseHistoryText, mergeSeries, withLive, buildRateChartRows, shiftIsoDays,
} from '../rateMetrics';
import { changeOverDays, roseWithinDays } from '../rateMetrics';
import { readBrazilNotes } from '../brazilNotes';
import { applySettingsFile, appendStateChanges, manualToSave } from '../rateSettings';
import {
  HIST_GROUPS, HIST_KEYS, HIST_BATCH_KEYS, groupOfKey, splitFileName, encodeSeries, decodeSeries, mergeHist,
  resumeFrom, coversFloor, chunkRanges, planGroupFiles, readHistFiles,
} from '../rateHistStore';
import { INDICATOR_SOURCE_FLOOR, isSignedIndicator } from '../indicatorCoverage';
import RateSettingsPanel from './RateSettingsPanel';
import { computeBrlBond, BRL_BOND_FACE, BRL_BOND_COUPON, BRL_BOND_YEARS } from '../brlBond';
import { evaluateRateSignals, evaluateOne, SIGNAL_STATE_LABEL, RATE_RULES } from '../rateSignals';
import { RATE_BT_ASSETS, BT_HORIZONS, historyStates, extractSignals, performanceAfter, changeAfter, summarizeSignals, pointsOf } from '../rateBacktest';
import { RATE_GLOSSARY_INDICATORS, RATE_GLOSSARY_ASSETS } from '../rateGlossary';
import { fetchWatchQuote, fetchWatchDaily, fetchUsDividendEvents } from '../watchlistQuote';
import {
  RATE_ASSET_GROUPS, RATE_ANCHOR_TICKERS, MANUAL_INPUTS, buildRateAssetRow, orderRateAssetRows, DIV_CYCLE_LABEL, DIV_CHANGE_LABEL,
} from '../rateAssets';

/**
 * 금리 모니터링 **별도 브라우저 창** (`/?rateWindow=1`).
 * 3단계: 뼈대 / 4단계(2026-10): ② 현재 금리 보드 + ④ 금리 차트 / 5단계: ③ 지금 적정 자산(판정은 src/rateSignals.ts)
 * / 6단계: ⑤ 자산군별 종목(계산은 src/rateAssets.ts) — 종목 시세·배당은 탭을 처음 열 때만, 동시에 4건씩 받아 창 메모리에만 둔다.
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다(LedgerWindow와 같은 규약). 로그인·권한은 opener(앱 탭)에 묻는다:
 *    창 → `rate:ping` / 앱 → `rate:pong { allowed, today }`. 권한 판정의 정본은 앱 탭(rateAccess)이다 —
 *    이 창은 조작 가능한 URL로 열리므로 창 스스로 권한을 판단하지 않는다(fail-closed: 답을 받기 전엔 닫혀 있다).
 * ⚠️ 데이터는 서버 경로를 **직접** 부른다(현재값 /api/indicators · 과거치 /api/history). useMarketData 훅은 쓰지 않는다
 *    (App 상태·Drive 저장과 엮여 있다). 받은 기록은 **창 메모리에만** 둔다 — 브라우저 저장소·Drive 저장 금지.
 * ⚠️ 계산은 전부 src/rateMetrics.ts(순수 함수, verify:rate-metrics가 직접 검사). 화면에서 손계산하지 말 것.
 * ⚠️ 수신 화이트리스트는 열거형이다 — 메시지 타입을 늘리면 App 핸들러와 여기 둘 다 등록할 것.
 * ⚠️ 자체 `ErrorBoundary label`이 필요하다(main.tsx 루트 경계는 label이 없어 창 전체가 오류 페이지가 된다).
 */

const PING_MS = 3000;
const LINK_TIMEOUT_MS = 12000;

// 배경 3종 — 기본 블랙. 시스템은 OS 다크/라이트 설정을 따른다. 세션 로컬(저장하지 않는다).
const THEMES = {
  black: { page: BG.primary, card: BG.card, text: 'text-gray-100', sub: 'text-gray-400', border: BORDER.default, grid: '#1f2937', axis: '#9ca3af', track: '#1f2937' },
  white: { page: '#f8fafc', card: '#ffffff', text: 'text-gray-900', sub: 'text-gray-500', border: 'border-gray-300', grid: '#e5e7eb', axis: '#6b7280', track: '#e5e7eb' },
};
const BG_OPTIONS = [
  { key: 'system', label: '시스템' },
  { key: 'black', label: '블랙' },
  { key: 'white', label: '백색' },
];

// 사용 키 22개 — unit: '%'(금리) · '%p'(금리차·스프레드) · ''(MOVE)
const RATE_DEFS = {
  fedRate:   { label: '기준금리',        unit: '%',  hint: '연준이 정한 정책금리(상단)' },
  us3m:      { label: '미국 3개월',      unit: '%',  hint: '기준금리를 바로 따라가는 단기 금리' },
  us2y:      { label: '미국 2년',        unit: '%',  hint: '앞으로 2년 금리 인하·인상 기대' },
  us10y:     { label: '미국 10년',       unit: '%',  hint: '대출·주택담보 금리의 기준' },
  us30y:     { label: '미국 30년',       unit: '%',  hint: '아주 긴 기간 물가·재정 걱정' },
  t10y2y:    { label: '10년−2년',        unit: '%p', hint: '0 아래면 역전 — 경기 둔화 신호로 읽힌다' },
  t10y3m:    { label: '10년−3개월',      unit: '%p', hint: '0 아래면 역전 — 연준이 가장 주목하는 금리차' },
  hyYield:   { label: '하이일드 금리',   unit: '%',  hint: '신용이 낮은 회사가 돈을 빌리는 금리' },
  hySpread:  { label: '하이일드 스프레드', unit: '%p', hint: '부도 걱정이 클수록 커지는 가산금리' },
  mort30:    { label: '30년 모기지',     unit: '%',  hint: '미국 주택담보대출 금리(주간 발표)', weekly: true },
  mbsSpread: { label: 'MBS 스프레드',    unit: '%p', hint: '모기지 − 10년 금리, 커지면 주택 자금이 빡빡하다' },
  move:      { label: 'MOVE',            unit: '',   hint: '금리가 얼마나 요동치는지' },
  krBase:    { label: '한국 기준금리',   unit: '%',  hint: '한국은행이 정한 정책금리(ECOS)' },
  kr3y:      { label: '국고채 3년',      unit: '%',  hint: '국내 단기 국채 금리 — 기준금리 기대를 따라간다' },
  kr10y:     { label: '한국 10년',       unit: '%',  hint: '국내 장기 금리의 기준' },
  krUs10y:   { label: '한미 10년 금리차', unit: '%p', hint: '음수면 미국 금리가 더 높음 — 원화 약세 압력' },
  // 브라질(8-B) — 물가는 월간, 기대물가는 영업일 발표라 카드에 '○월 ○일 값'
  brSelic:   { label: '브라질 Selic',    unit: '%',  hint: '브라질 중앙은행 기준금리 목표' },
  brIpca:    { label: '물가(12개월)',    unit: '%',  hint: '최근 12개월 물가상승률(IPCA, 월간 발표)', weekly: true },
  brExp12:   { label: '기대물가(12개월 후)', unit: '%', hint: '시장 전문가들이 예상하는 1년 뒤 물가', weekly: true },
  br10y:     { label: '브라질 10년',     unit: '%',  hint: '브라질 국채 10년 금리' },
  brReal:    { label: '실질금리',        unit: '%p', hint: '물가를 뺀 진짜 이자(10년 − 기대물가)' },
  brlkrw:    { label: '헤알·원',         unit: '',   hint: '1헤알이 몇 원인지 — 낮을수록 원화로 사기 유리' },
};
const RATE_KEYS = Object.keys(RATE_DEFS);
// 자료가 짧은 지표 — FRED ICE BofA 2종은 2023-10-17부터만 제공된다(3년 백분위 옆에 '자료 3년' 표시)
const SHORT_DATA_KEYS = ['hyYield', 'hySpread', 'br10y', 'brReal']; // 브라질 10년(네이버)은 2023-10-17부터

const BOARD_ROWS = [
  { title: '미국 금리', keys: ['fedRate', 'us3m', 'us2y', 'us10y', 'us30y'] },
  { title: '금리차', keys: ['t10y2y', 't10y3m'] },
  { title: '신용·모기지', keys: ['hyYield', 'hySpread', 'mort30', 'mbsSpread', 'move'] },
  { title: '한국', keys: ['krBase', 'kr3y', 'kr10y', 'krUs10y'] },
  { title: '브라질', keys: ['brSelic', 'brIpca', 'brExp12', 'br10y', 'brReal', 'brlkrw'] },
];

const PERIODS = [
  { key: '1y', label: '1년', years: 1 },
  { key: '3y', label: '3년', years: 3 },
  { key: '10y', label: '10년', years: 10 },
];

// 블랙 배경에서 잘 보이는 색(백색에서도 대비가 남는 400 계열)
const COLORS = {
  fedRate: '#f472b6', us2y: '#38bdf8', us10y: '#fbbf24', us30y: '#a78bfa',
  t10y2y: '#2dd4bf', t10y3m: '#fb923c',
  hyYield: '#f472b6', hySpread: '#38bdf8',
  mbsSpread: '#fb923c', move: '#a78bfa',
  krBase: '#f472b6', kr3y: '#38bdf8', kr10y: '#fbbf24',
  br10y: '#4ade80', brSelic: '#f472b6', brIpca: '#fbbf24', brExp12: '#38bdf8', brlkrw: '#a78bfa',
};
// ③ 상태 색 — 대기 회색 · 관심 하늘 · 적기 녹색 · 경고 빨강
const SIGNAL_COLOR = { wait: '#9ca3af', watch: '#38bdf8', buy: '#4ade80', warn: '#f87171' };
// 지금 브라질 10년 금리를 만기수익률로 보는 '액면 1,000헤알 · 표면 10% · 10년' 채권의 이론 가격(헤알).
// computeBrlBond(계산기, 무수정)의 YTM이 그 금리와 같아지는 가격을 이분법으로 찾는다. 못 구하면 null(화면은 줄 생략).
function brlBondPriceAt(ytmPct) {
  if (!Number.isFinite(ytmPct) || ytmPct <= 0) return null;
  const ytmOf = (p) => computeBrlBond({ price: p, face: BRL_BOND_FACE, couponRate: BRL_BOND_COUPON, years: BRL_BOND_YEARS })?.ytmAnnual;
  let lo = 1, hi = BRL_BOND_FACE * 1.99;
  const yl = ytmOf(lo), yh = ytmOf(hi);
  if (yl == null || yh == null || ytmPct > yl || ytmPct < yh) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const y = ytmOf(mid);
    if (y == null) return null;
    if (y > ytmPct) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const ASSET_CONCURRENCY = 4; // ⑤ 종목 조회 동시 요청 수 상한
const yahooQuoteUrl = (t) => `https://finance.yahoo.com/quote/${encodeURIComponent(t)}`;
const fmtPctCell = (v) => (v == null || !Number.isFinite(v) ? '-' : `${v.toFixed(2)}%`);
const BAND = {
  low:  { label: '낮음', color: '#60a5fa' },
  mid:  { label: '보통', color: '#9ca3af' },
  high: { label: '높음', color: '#fb923c' },
};

const fmtVal = (v, unit) => (v == null || !Number.isFinite(v) ? '-'
  : unit === '' ? v.toFixed(2)
  : `${unit === '%p' && v > 0 ? '+' : ''}${v.toFixed(2)}${unit}`);
const fmtChg = (v, unit) => (v == null || !Number.isFinite(v) ? '-'
  : `${v > 0 ? '▲' : v < 0 ? '▼' : ''}${Math.abs(v).toFixed(2)}${unit === '' ? '' : '%p'}`);
const isoYmd = (iso) => iso.replace(/-/g, '');
const asOfLabel = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 값` : '');
const shortDate = (iso) => (iso ? `${iso.slice(2, 4)}/${iso.slice(5, 7)}` : '');

// 과거치 1건 — 실패하면 null(그 키만 빈 카드). /api/history는 일반 키 CSV · 금리차·MBS는 JSON을 준다.
async function fetchHistory(key, fromIso, toIso) {
  try {
    const res = await fetch(`/api/history?key=${key}&start=${isoYmd(fromIso)}&end=${isoYmd(toIso)}`, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return null;
    const rec = parseHistoryText(await res.text());
    return Object.keys(rec).length ? rec : null;
  } catch { return null; }
}

function RateCard({ k, m, t, emptyText = null }) {
  const def = RATE_DEFS[k];
  const band = m.band ? BAND[m.band] : null;
  const pos = m.position52 == null ? null : Math.max(0, Math.min(100, m.position52));
  return (
    <div className={`rounded-lg border ${t.border} p-2.5 min-w-0`} style={{ background: t.card }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold truncate">{def.label}</span>
        {band && (
          <span className="text-[10px] font-bold px-1.5 rounded shrink-0" style={{ color: band.color, border: `1px solid ${band.color}66` }}
            title={`최근 3년 중 현재 위치(백분위) ${m.pct3y.toFixed(0)}`}>
            {band.label} {m.pct3y.toFixed(0)}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-[18px] font-extrabold tabular-nums">{m.current == null && emptyText ? <span className="text-[13px] text-amber-400">{emptyText}</span> : fmtVal(m.current, def.unit)}</span>
        <span className={`text-[11px] font-bold tabular-nums ${m.change1m > 0 ? 'text-red-400' : m.change1m < 0 ? 'text-blue-400' : t.sub}`}
          title="1개월 변화">1M {fmtChg(m.change1m, def.unit)}</span>
      </div>
      {/* 연중 위치(52주 최저 0% ~ 최고 100%) */}
      <div className="mt-1.5" title={pos == null ? '52주 자료 부족' : `52주 최저 ${fmtVal(m.low52, def.unit)} ~ 최고 ${fmtVal(m.high52, def.unit)} 중 ${pos.toFixed(0)}% 위치`}>
        <div className="h-1.5 rounded-full relative" style={{ background: t.track }}>
          {pos != null && <div className="absolute top-0 left-0 h-1.5 rounded-full" style={{ width: `${pos}%`, background: band ? band.color : '#9ca3af' }} />}
        </div>
        <div className={`flex justify-between text-[9px] mt-0.5 tabular-nums ${t.sub}`}>
          <span>{fmtVal(m.low52, def.unit)}</span>
          <span>연중 {pos == null ? '-' : `${pos.toFixed(0)}%`}{m.turnedDown ? ' · 20일 고점 대비 꺾임' : ''}</span>
          <span>{fmtVal(m.high52, def.unit)}</span>
        </div>
      </div>
      <div className={`text-[10px] mt-1 leading-snug ${t.sub}`}>
        {def.hint}
        {def.weekly && m.asOf && <span className="ml-1 text-amber-400/90">· {asOfLabel(m.asOf)}</span>}
        {SHORT_DATA_KEYS.includes(k) && <span className="ml-1 text-amber-400/90">· 자료 3년</span>}
      </div>
    </div>
  );
}

function ChartBox({ title, rows, t, children, height = 220 }) {
  return (
    <div className={`rounded-lg border ${t.border} p-2`} style={{ background: t.card }}>
      <div className="text-[12px] font-bold mb-1">{title}</div>
      {rows.length === 0
        ? <div className={`text-[11px] ${t.sub} py-8 text-center`}>자료를 불러오는 중이거나 받지 못했습니다</div>
        : (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        )}
    </div>
  );
}

export default function RateWindow() {
  // 'pending'(앱 응답 대기) | 'allowed' | 'denied' — 응답 전엔 내용을 그리지 않는다(fail-closed)
  const [access, setAccess] = useState('pending');
  const [today, setToday] = useState('');
  const [linked, setLinked] = useState(true);
  // ⑥ 설정(9-A) — 앱 탭이 Drive에서 읽어 준 파일. 창 메모리에만 두고 저장은 앱 탭에 맡긴다
  const [canWrite, setCanWrite] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // 지표 과거 기록(10-A) — 'pending'(앱 탭 응답 대기) → 'drive'(Drive 기록 + 이어받기·저장) | 'memory'(서버에서 받아 메모리만)
  const [storeMode, setStoreMode] = useState('pending');
  const [collect, setCollect] = useState({ active: false, done: 0, total: 0 });
  const [histSaveError, setHistSaveError] = useState('');
  const [redoConfirm, setRedoConfirm] = useState(false);
  const storedRef = useRef({});              // 키 → 저장 형식 항목(rateHistStore.HistEntry)
  const storedFilesRef = useRef(new Set());   // Drive에 실제로 있던 파일 이름(분할 '_2' 파일 정리용)
  const collectingRef = useRef(false);
  const [settingsFile, setSettingsFile] = useState(null);
  const [settingsState, setSettingsState] = useState('loading');   // loading | ready | error
  const [settingsError, setSettingsError] = useState('');
  const [settingsSeq, setSettingsSeq] = useState(0);                // 불러오기·저장 완료마다 올려 설정 패널 초안을 새로 잡는다
  const reqSeqRef = useRef(0);
  const pendingRef = useRef(new Map());
  const [bgMode, setBgMode] = useState('black');
  const [systemDark, setSystemDark] = useState(() => {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return true; }
  });
  const [period, setPeriod] = useState('1y');
  const [hist, setHist] = useState({});         // key → { date: value } (창 메모리 전용)
  const [live, setLive] = useState({});         // /api/indicators 응답
  const [loading, setLoading] = useState(false);
  const [failedKeys, setFailedKeys] = useState([]);
  const lastMsgRef = useRef(0);
  // 키별로 받아 둔 가장 이른 날짜 — 기간을 늘릴 때 **모자란 앞쪽만** 더 받는다
  const loadedFromRef = useRef({});
  const loadSeqRef = useRef(0);

  const post = useCallback((msg) => {
    const op = window.opener;
    if (!op || op.closed) return false;
    try { op.postMessage(msg, window.location.origin); return true; } catch { return false; }
  }, []);

  useEffect(() => { document.title = '금리 모니터링'; }, []);

  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch { return undefined; }
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  // 수신 — origin·opener 검사 필수
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (window.opener && e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
      if (d.type === 'rate:settings' || d.type === 'rate:settingsSaved' || d.type === 'rate:hist' || d.type === 'rate:histSaved') {
        const cb = pendingRef.current.get(d.reqId);
        if (cb) { pendingRef.current.delete(d.reqId); cb(d); }
        return;
      }
      if (d.type !== 'rate:pong') return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      setAccess(d.allowed === true ? 'allowed' : 'denied');
      setCanWrite(d.canWrite === true);
      setIsAdmin(d.isAdmin === true);
      if (typeof d.today === 'string') setToday(d.today);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 앱 탭에 요청 1건 — 응답(reqId 일치) 또는 20초 시한
  const request = useCallback((msg) => new Promise((resolve) => {
    const reqId = ++reqSeqRef.current;
    const timer = setTimeout(() => { pendingRef.current.delete(reqId); resolve({ ok: false, error: '앱 탭이 응답하지 않습니다' }); }, 20000);
    pendingRef.current.set(reqId, (d) => { clearTimeout(timer); resolve(d); });
    if (!post({ ...msg, reqId })) { clearTimeout(timer); pendingRef.current.delete(reqId); resolve({ ok: false, error: '앱 탭이 열려 있어야 합니다' }); }
  }), [post]);

  // 설정 불러오기 — 권한이 확인되면 한 번(실패하면 연결이 돌아올 때 다시)
  useEffect(() => {
    if (access !== 'allowed' || !linked || settingsState === 'ready') return;
    let alive = true;
    request({ type: 'rate:settingsLoad' }).then(d => {
      if (!alive) return;
      if (d?.ok) { setSettingsFile(d.data || null); setSettingsState('ready'); setSettingsError(''); setSettingsSeq(n => n + 1); }
      else { setSettingsState('error'); setSettingsError(d?.error || '설정을 불러오지 못했습니다'); }
    });
    return () => { alive = false; };
  }, [access, linked, settingsState, request]);

  const effRef = useRef(null);
  // 설정 패널의 저장에는 상태 변경 기록(history)이 없다 — 지금 기록을 함께 실어 보내야 파일에서 지워지지 않는다
  const saveSettings = useCallback(async (data) => {
    const d = await request({ type: 'rate:settingsSave', data: { ...data, history: data?.history ?? effRef.current?.history ?? [] } });
    if (d?.ok) { setSettingsFile(d.data); setSettingsSeq(n => n + 1); }
    return d;
  }, [request]);

  // 코드 기본값 위에 저장된 설정을 덮은 값 — ③ 판정·⑤ 표가 이것을 쓴다(파일이 없으면 기본값 그대로)
  const eff = useMemo(() => applySettingsFile(settingsFile, RATE_RULES, MANUAL_INPUTS), [settingsFile]);
  const effRules = eff.rules;
  effRef.current = eff;

  useEffect(() => {
    const tick = () => {
      const alive = post({ type: 'rate:ping' });
      if (!alive) { setLinked(false); return; }
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post]);

  // 기간에 필요한 시작일 — 3년 백분위가 늘 계산되도록 최소 3년(+여유 45일)은 받는다
  const needFrom = useCallback((years) => (today ? shiftIsoDays(today, -Math.max(3, years) * 365 - 45) : ''), [today]);

  // 과거치 — 키별로 '아직 안 받은 앞쪽'만 받는다(처음엔 3년, 10년을 누르면 그 앞 7년만 더)
  const ensureHistory = useCallback(async (years) => {
    const from = needFrom(years);
    if (!from || !today) return;
    const seq = ++loadSeqRef.current;
    const jobs = RATE_KEYS.map(async (k) => {
      const have = loadedFromRef.current[k];
      if (have && have <= from) return [k, null, true];
      const to = have ? shiftIsoDays(have, -1) : today;
      const rec = await fetchHistory(k, from, to);
      if (rec) loadedFromRef.current[k] = from;
      return [k, rec, !!rec || !!have];
    });
    setLoading(true);
    const results = await Promise.all(jobs);
    if (seq === loadSeqRef.current) setLoading(false);
    setHist(prev => {
      let next = prev;
      for (const [k, rec] of results) {
        if (!rec) continue;
        const merged = mergeSeries(prev[k], rec);
        if (merged !== prev[k]) { if (next === prev) next = { ...prev }; next[k] = merged; }
      }
      return next;
    });
    setFailedKeys(results.filter(([, , ok]) => !ok).map(([k]) => k));
  }, [needFrom, today]);

  // 현재값 — 권한이 확인된 뒤 한 번
  useEffect(() => {
    if (access !== 'allowed') return;
    let alive = true;
    fetch('/api/indicators', { signal: AbortSignal.timeout(20000) })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j && typeof j === 'object') setLive(j); })
      .catch(() => {});
    return () => { alive = false; };
  }, [access]);

  // 메모리 모드(앱 탭 없음·Drive 불가)일 때만 — 지금처럼 기간만큼 서버에서 받아 메모리로만 쓴다
  useEffect(() => {
    if (access !== 'allowed' || !today || storeMode !== 'memory') return;
    const y = PERIODS.find(p => p.key === period)?.years || 1;
    ensureHistory(y);
  }, [access, today, period, ensureHistory, storeMode]);

  // ── 지표 과거 기록 Drive 저장(10-A) ──
  // 묶음(파일) 하나 저장 — 4MB를 넘으면 둘로 나눈다. 나눔이 풀리면 예전 '_2' 파일은 빈 본문으로 덮어 오래된 값이 남지 않게 한다
  const saveGroup = useCallback(async (group) => {
    for (const f of planGroupFiles(group, storedRef.current)) {
      const body = f.body || (storedFilesRef.current.has(f.file) ? { v: 1, keys: {} } : null);
      if (!body) continue;
      const r = await request({ type: 'rate:histSave', name: f.file, body });
      if (r?.ok) { storedFilesRef.current.add(f.file); setHistSaveError(''); }
      else setHistSaveError(r?.error || '기록을 저장하지 못했습니다');
    }
  }, [request]);
  // 수집 — 키마다 저장된 마지막 날짜 이후(없으면 출처 첫 날짜부터)를 10년 단위로, 한 번에 4개 키씩. 묶음이 끝날 때마다 해당 파일 저장
  const runCollection = useCallback(async (force) => {
    if (collectingRef.current || !today) return;
    collectingRef.current = true;
    const jobs = HIST_KEYS.map(k => {
      const signed = isSignedIndicator(k), floor = INDICATOR_SOURCE_FLOOR[k] || '';
      const entry = force ? null : storedRef.current[k];
      const from = entry && coversFloor(entry, floor) ? resumeFrom(entry, floor, today) : resumeFrom(null, floor, today);
      return { k, signed, from, base: entry ? decodeSeries(entry, signed) : {} };
    });
    const total = jobs.length;
    let done = jobs.filter(j => !j.from).length;
    setCollect({ active: true, done, total });
    const failed = [];
    const todo = jobs.filter(j => j.from);
    for (let i = 0; i < todo.length; i += HIST_BATCH_KEYS) {
      const batch = todo.slice(i, i + HIST_BATCH_KEYS);
      const results = await Promise.all(batch.map(async (j) => {
        let series = j.base, ok = true;
        for (const [s, e] of chunkRanges(j.from, today)) {
          const rec = await fetchHistory(j.k, s, e);
          if (!rec) { ok = false; break; }   // 실패하면 거기서 멈춘다 — 다음에 저장된 마지막 날짜부터 이어 받는다
          series = mergeHist(series, rec, j.signed);
        }
        const entry = encodeSeries(series, j.signed, 'api/history', new Date().toISOString());
        if (entry) storedRef.current = { ...storedRef.current, [j.k]: entry };
        if (!ok) failed.push(j.k);
        return [j.k, series];
      }));
      setHist(prev => {
        let next = prev;
        for (const [k, series] of results) { if (series !== prev[k] && Object.keys(series).length) { if (next === prev) next = { ...prev }; next[k] = series; } }
        return next;
      });
      const groups = [...new Set(batch.map(j => groupOfKey(j.k)).filter(Boolean))];
      for (const g of groups) await saveGroup(g);
      done += batch.length;
      setCollect({ active: true, done, total });
    }
    setFailedKeys(failed.filter(k => RATE_KEYS.includes(k)));
    setCollect({ active: false, done: total, total });
    collectingRef.current = false;
  }, [today, saveGroup]);
  // 모드 결정 — 앱 탭이 쓰기 가능하다고 답하면 Drive 기록을 읽고 이어받기, 4초 안에 그렇지 않으면 메모리 모드
  useEffect(() => {
    if (storeMode !== 'pending' || access !== 'allowed' || !today) return;
    if (linked && canWrite) {
      setStoreMode('loading');
      request({ type: 'rate:histLoad' }).then(d => {
        if (!d?.ok) { setStoreMode('memory'); return; }
        for (const [name, body] of Object.entries(d.files || {})) if (body) storedFilesRef.current.add(name);
        storedRef.current = readHistFiles(d.files || {});
        const fromStore = {};
        for (const [k, e] of Object.entries(storedRef.current)) fromStore[k] = decodeSeries(e, isSignedIndicator(k));
        setHist(prev => ({ ...prev, ...fromStore }));
        setStoreMode('drive');
        runCollection(false);
      });
      return;
    }
    const id = setTimeout(() => setStoreMode(m => (m === 'pending' ? 'memory' : m)), 4000);
    return () => clearTimeout(id);
  }, [storeMode, access, today, linked, canWrite, request, runCollection]);

  // 과거치 + 현재값(현재값의 날짜가 기록 최신일 이후일 때만 끝에 붙인다 — 날짜가 없으면 기준일)
  const seriesByKey = useMemo(() => {
    const out = {};
    for (const k of RATE_KEYS) {
      const lv = live?.[k];
      out[k] = withLive(hist[k], lv?.price, lv?.date || today);
    }
    return out;
  }, [hist, live, today]);

  const metrics = useMemo(() => {
    const out = {};
    for (const k of RATE_KEYS) out[k] = computeRateMetrics(seriesByKey[k]);
    return out;
  }, [seriesByKey]);

  // ⑤ 종목 자료 — ticker → { status:'loading'|'ok'|'fail', quote, daily, divs } (창 메모리 전용)
  const [assetTab, setAssetTab] = useState(RATE_ASSET_GROUPS[0].key);
  const [assetData, setAssetData] = useState({});
  const assetQueueRef = useRef([]);
  const assetActiveRef = useRef(0);
  const assetRequestedRef = useRef(new Set());
  const pumpAssets = useCallback(() => {
    while (assetActiveRef.current < ASSET_CONCURRENCY && assetQueueRef.current.length) {
      const tk = assetQueueRef.current.shift();
      assetActiveRef.current++;
      (async () => {
        // 한 종목의 세 요청은 차례로 — 동시에 나가는 요청이 ASSET_CONCURRENCY를 넘지 않게
        const quote = await fetchWatchQuote('us', tk);
        const daily = await fetchWatchDaily('us', tk);
        const divs = await fetchUsDividendEvents(tk);
        setAssetData(prev => ({ ...prev, [tk]: { status: quote ? 'ok' : 'fail', quote, daily, divs } }));
      })().catch(() => {
        setAssetData(prev => ({ ...prev, [tk]: { status: 'fail' } }));
      }).finally(() => {
        assetActiveRef.current--;
        pumpAssets();
      });
    }
  }, []);
  const loadAssets = useCallback((tickers) => {
    const todo = tickers.filter(tk => !assetRequestedRef.current.has(tk));
    if (!todo.length) return;
    todo.forEach(tk => assetRequestedRef.current.add(tk));
    setAssetData(prev => {
      const n = { ...prev };
      todo.forEach(tk => { n[tk] = { status: 'loading' }; });
      return n;
    });
    assetQueueRef.current.push(...todo);
    pumpAssets();
  }, [pumpAssets]);
  // ③ 판정용 대표 종목은 창을 열 때, 탭 종목은 그 탭을 처음 열 때
  useEffect(() => {
    if (access !== 'allowed' || !today) return;
    loadAssets(RATE_ANCHOR_TICKERS);
    loadAssets(RATE_ASSET_GROUPS.find(g => g.key === assetTab)?.tickers || []);
  }, [access, today, assetTab, loadAssets]);

  const us10yNow = metrics.us10y?.current;
  const assetRows = useMemo(() => {
    const out = {};
    for (const g of RATE_ASSET_GROUPS) {
      for (const tk of g.tickers) {
        const row = buildRateAssetRow(tk, assetData[tk], today, us10yNow, g.etfs.includes(tk), eff.manual);
        // 세후는 설정의 원천징수율로 다시 계산한다(⑥에서 바꾸면 ⑤ 표도 따라온다)
        out[tk] = { ...row, yieldPost: row.yield12 == null ? null : row.yield12 * (1 - effRules.withholdingPct / 100) };
      }
    }
    return out;
  }, [assetData, today, us10yNow, eff, effRules]);
  const failedTickers = useMemo(() => Object.keys(assetData).filter(tk => assetData[tk]?.status === 'fail'), [assetData]);

  // ③ 판정 — 충족 비율 내림차순으로 이미 정렬돼 온다(대표 종목 행을 함께 넘긴다)
  // 브라질 국채 판정의 추가 입력 — 기대물가 3개월 변화 · 최근 60일 Selic 인상 · 정치 메모(readBrazilNotes 하나로만 읽는다)
  const brazilNotes = useMemo(() => readBrazilNotes(eff.notes), [eff]);
  const brazilExtras = useMemo(() => ({
    exp12Change3m: changeOverDays(seriesByKey.brExp12, 90),
    selicRose60d: roseWithinDays(seriesByKey.brSelic, effRules.brBond.selicCalmDays),
    notes: brazilNotes, today,
  }), [seriesByKey, brazilNotes, today, effRules]);
  const signals = useMemo(() => evaluateRateSignals(metrics, assetRows, brazilExtras, effRules), [metrics, assetRows, brazilExtras, effRules]);

  // ── 상태 변경 기록(9-B) — 벨 알림 대신. 창을 열고 자료가 다 모이면 한 번, 바뀐 자산군만 기록해 설정 파일에 저장 ──
  const historyDoneRef = useRef(false);
  const anchorsReady = RATE_ANCHOR_TICKERS.every(tk => assetData[tk]?.status === 'ok' || assetData[tk]?.status === 'fail');
  // 과거치가 다 모인 뒤에만(메모리 모드 받기 끝 / Drive 모드 이어받기 끝) — 중간값으로 상태를 기록하지 않는다
  const histReady = !loading && !collect.active && (storeMode === 'memory' || storeMode === 'drive') && Object.keys(hist).length > 0;
  useEffect(() => {
    if (historyDoneRef.current || settingsState !== 'ready' || !canWrite || !linked || !anchorsReady || !histReady || !today) return;
    historyDoneRef.current = true;
    const { history, changed } = appendStateChanges(eff.history, signals, today);
    if (changed) saveSettings({ rules: effRules, manual: manualToSave(eff.manual), brazilNotes: eff.notes, history });
  }, [settingsState, canWrite, linked, anchorsReady, histReady, today, eff, signals, effRules, saveSettings]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const stateText = (tok) => (tok == null ? '첫 기록' : `${tok.endsWith(':warn') ? '경고 · ' : ''}${SIGNAL_STATE_LABEL[tok.replace(':warn', '')] || tok}`);

  // ── 과거 신호 검증(9-B) — 금리 지표 조건만(종목·수동값·정치 메모 제외)으로 날짜별 판정을 다시 계산 ──
  const evalRateOnly = useCallback((key, all, extras) => evaluateOne(key, all, extras, effRules, { rateOnly: true }), [effRules]);
  const btSignals = useMemo(() => {
    const out = {};
    for (const def of RATE_BT_ASSETS) out[def.key] = extractSignals(historyStates(def, seriesByKey, evalRateOnly));
    return out;
  }, [seriesByKey, evalRateOnly]);
  const [btOpen, setBtOpen] = useState(false);
  const [btPrices, setBtPrices] = useState({});      // 대표 종목 → { status, pts, divs } (창 메모리 전용)
  const btRequestedRef = useRef(new Set());
  useEffect(() => {
    if (!btOpen) return;
    for (const def of RATE_BT_ASSETS) {
      const sigs = btSignals[def.key] || [];
      if (!def.rep || !sigs.length || btRequestedRef.current.has(def.rep)) continue;
      const tk = def.rep;
      btRequestedRef.current.add(tk);
      setBtPrices(prev => ({ ...prev, [tk]: { status: 'loading' } }));
      const from = shiftIsoDays(sigs[0].date, -10);
      (async () => {
        const daily = await fetchWatchDaily('us', tk, from);
        const divs = await fetchUsDividendEvents(tk, '10y');
        setBtPrices(prev => ({ ...prev, [tk]: { status: daily ? 'ok' : 'fail', pts: daily || [], divs: divs?.status === 'ok' ? divs.events : [] } }));
      })().catch(() => setBtPrices(prev => ({ ...prev, [tk]: { status: 'fail', pts: [], divs: [] } })));
    }
  }, [btOpen, btSignals]);
  const btTable = useMemo(() => {
    if (!btOpen) return null;
    const rows = [], summary = [];
    for (const def of RATE_BT_ASSETS) {
      const sigs = btSignals[def.key] || [];
      const twelve = [];
      for (const sg of sigs) {
        const cells = BT_HORIZONS.map(mo => {
          if (def.rep) {
            const pr = btPrices[def.rep];
            if (!pr || pr.status === 'loading') return { text: '…' };
            const r = performanceAfter(pr.pts, pr.divs, sg.date, mo, today);
            if (!r) return { text: '-' };
            if (r.pending) return { text: '진행 중' };
            if (mo === 12) twelve.push(r.total);
            return { text: `주가 ${r.price >= 0 ? '+' : ''}${r.price.toFixed(1)}% · 총 ${r.total >= 0 ? '+' : ''}${r.total.toFixed(1)}%`, v: r.total };
          }
          // 대표 종목 없음 — 브라질은 헤알·원 변화와 10년 금리 변화, 한국 채권은 10년 금리 변화
          const fxKey = def.key === 'brBond' ? 'brlkrw' : null, rateKey = def.key === 'brBond' ? 'br10y' : 'kr10y';
          const rr = changeAfter(pointsOf(seriesByKey[rateKey]), sg.date, mo, today, 'pp');
          const fx = fxKey ? changeAfter(pointsOf(seriesByKey[fxKey]), sg.date, mo, today, 'pct') : null;
          if (!rr || rr.pending || (fx && fx.pending)) return { text: rr?.pending || fx?.pending ? '진행 중' : '-' };
          if (mo === 12) twelve.push(fx && !fx.pending ? fx.value : null);
          return { text: `${fx && !fx.pending ? `헤알·원 ${fx.value >= 0 ? '+' : ''}${fx.value.toFixed(1)}% · ` : ''}10년 ${rr.value >= 0 ? '+' : ''}${rr.value.toFixed(2)}%p`, v: fx && !fx.pending ? fx.value : null };
        });
        rows.push({ def, sg, cells });
      }
      summary.push({ def, ...summarizeSignals(twelve), unit: def.rep ? '12개월 총수익' : def.key === 'brBond' ? '12개월 헤알·원' : null });
    }
    rows.sort((a, b) => (a.sg.date < b.sg.date ? 1 : -1));
    return { rows, summary };
  }, [btOpen, btSignals, btPrices, seriesByKey, today]);
  // 차트 세로 점선 — 그 차트에 해당하는 자산군의 과거 '매수 적기' 신호일(마우스를 올리면 이름)
  const signalLines = (keys, yAxisId, fromDate) => keys.flatMap(k => {
    const def = RATE_BT_ASSETS.find(d => d.key === k);
    return (btSignals[k] || []).filter(sg => !fromDate || sg.date >= fromDate).map(sg => (
      <ReferenceLine key={`sig-${k}-${sg.date}`} x={sg.date} {...(yAxisId ? { yAxisId } : {})} ifOverflow="hidden"
        shape={(p) => (
          <g>
            <title>{`${def.label} 매수 적기 신호 (${sg.date})`}</title>
            <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={def.color} strokeDasharray="3 3" strokeOpacity={0.85} />
            <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="transparent" strokeWidth={8} />
          </g>
        )} />
    ));
  });
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const brBondPrice = brlBondPriceAt(metrics.br10y?.current);
  const brBondKrw = brBondPrice != null && Number.isFinite(metrics.brlkrw?.current) ? brBondPrice * metrics.brlkrw.current : null;
  const [openSignal, setOpenSignal] = useState(null);

  const fromChart = today ? shiftIsoDays(today, -(PERIODS.find(p => p.key === period)?.years || 1) * 365) : '';
  const rowsUs = useMemo(() => buildRateChartRows(seriesByKey, ['fedRate', 'us2y', 'us10y', 'us30y'], fromChart), [seriesByKey, fromChart]);
  const rowsSpread = useMemo(() => buildRateChartRows(seriesByKey, ['t10y2y', 't10y3m'], fromChart), [seriesByKey, fromChart]);
  const rowsHy = useMemo(() => buildRateChartRows(seriesByKey, ['hyYield', 'hySpread'], fromChart), [seriesByKey, fromChart]);
  const rowsMbs = useMemo(() => buildRateChartRows(seriesByKey, ['mbsSpread', 'move'], fromChart), [seriesByKey, fromChart]);
  const rowsBr = useMemo(() => buildRateChartRows(seriesByKey, ['br10y', 'brSelic', 'brIpca', 'brExp12', 'brlkrw'], fromChart), [seriesByKey, fromChart]);
  const rowsKr = useMemo(() => buildRateChartRows(seriesByKey, ['krBase', 'kr3y', 'kr10y', 'us10y'], fromChart), [seriesByKey, fromChart]);
  // 한국 기준금리 — 서버에 ECOS 인증키가 없으면 값 대신 needKey가 온다(값을 지어내지 않는다)
  const krBaseNeedKey = live?.krBase?.needKey === true;

  const themeKey = bgMode === 'system' ? (systemDark ? 'black' : 'white') : bgMode;
  const t = THEMES[themeKey];

  // 권한 없음 — 한 줄만
  if (access === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-300" style={{ background: BG.primary }}>
        이 페이지를 사용할 권한이 없습니다
      </div>
    );
  }
  // 앱 탭의 응답을 기다리는 중(또는 앱 탭 없이 열림) — 권한을 확인하기 전에는 내용을 그리지 않는다
  if (access === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400" style={{ background: BG.primary }}>
        {linked ? '앱 창에서 권한을 확인하는 중입니다…' : '앱 창에서 금리 모니터링 버튼으로 열어 주세요.'}
      </div>
    );
  }

  const axisTick = { fontSize: 10, fill: t.axis };
  const tooltipStyle = { background: t.card, border: '1px solid #64748b', borderRadius: 6, fontSize: 11 };
  const tip = (unit) => (v, name) => [fmtVal(Number(v), unit), name];
  const hy = metrics.hyYield, hs = metrics.hySpread;
  const spreadMin = Math.min(0, ...rowsSpread.flatMap(r => [r.t10y2y, r.t10y3m]).filter(v => v != null));

  return (
    <ErrorBoundary label="금리 모니터링">
      <div className={`min-h-screen flex flex-col ${t.text}`} style={{ background: t.page }}>
        {/* ① 상단 바 */}
        <header className={`flex flex-wrap items-center gap-3 px-4 py-3 border-b ${t.border}`}>
          <h1 className="text-[16px] font-bold">금리 모니터링</h1>
          <span className={`text-[12px] ${t.sub}`}>기준일 {today || '-'}</span>
          {loading && <span className={`text-[11px] ${t.sub}`}>자료 받는 중…</span>}
          {collect.active && (
            <span className="flex items-center gap-1.5 text-[11px] text-sky-400" title="지표 과거 기록을 처음부터 받아 Drive에 저장하는 중">
              과거 기록 수집 중 {collect.done}/{collect.total}
              <span className="inline-block w-24 h-1.5 rounded-full overflow-hidden" style={{ background: t.track }}>
                <span className="block h-full bg-sky-500" style={{ width: `${collect.total ? (collect.done / collect.total) * 100 : 0}%` }} />
              </span>
            </span>
          )}
          {storeMode === 'memory' && <span className="text-[11px] text-amber-400">기록 저장 안 됨(앱 탭 필요)</span>}
          {histSaveError && <span className="text-[11px] text-red-400">{histSaveError}</span>}
          {!linked && <span className="text-[11px] text-amber-400">앱 창과 연결이 끊겼습니다</span>}
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="배경">
            <span className={`text-[11px] mr-1 ${t.sub}`}>배경</span>
            {BG_OPTIONS.map(o => (
              <button
                key={o.key}
                onClick={() => setBgMode(o.key)}
                className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                  bgMode === o.key ? 'border-sky-500 text-sky-400' : `${t.border} ${t.sub} hover:text-sky-400`
                }`}
              >{o.label}</button>
            ))}
          </div>
        </header>

        <main className="flex-1 flex flex-col gap-3 p-4 pb-16">
          {/* ② 현재 금리 보드 */}
          <section className={`rounded-lg border ${t.border} p-3`} style={{ background: t.card }}>
            <div className="flex items-baseline gap-2 mb-2">
              <h2 className="text-[13px] font-bold">현재 금리 보드</h2>
              <span className={`text-[10px] ${t.sub}`}>색 = 최근 3년 중 위치(낮음 0~30 · 보통 30~70 · 높음 70~100) · 막대 = 52주 범위 안 위치</span>
            </div>
            {failedKeys.length > 0 && (
              <div className="text-[11px] text-amber-400 mb-2">
                받지 못한 자료: {failedKeys.map(k => (k === 'krBase' && krBaseNeedKey ? `${RATE_DEFS[k].label}(인증키 필요)` : RATE_DEFS[k].label)).join(', ')}
              </div>
            )}
            <div className="flex flex-col gap-3">
              {BOARD_ROWS.map(row => (
                <div key={row.title}>
                  <div className={`text-[11px] font-bold mb-1 ${t.sub}`}>{row.title}</div>
                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                    {row.keys.map(k => <RateCard key={k} k={k} m={metrics[k]} t={t} emptyText={k === 'krBase' && krBaseNeedKey ? '인증키 필요' : k === 'br10y' ? '자료 없음' : null} />)}
                  </div>
                  {row.title === '브라질' && (
                    <div className={`mt-2 rounded border ${t.border} p-2 text-[11px]`}>
                      <div className="font-bold mb-1">정치·정책 메모 (최근 5건)</div>
                      {brazilNotes.length === 0
                        ? <div className={t.sub}>등록된 메모 없음 — 9단계 설정 화면에서 입력</div>
                        : brazilNotes.slice(0, 5).map((n, i) => (
                          <div key={`${n.date}-${i}`} className="flex gap-2">
                            <span className={`tabular-nums ${t.sub}`}>{n.date}</span>
                            <span className={n.impact === '유리' ? 'text-green-400' : n.impact === '불리' ? 'text-red-400' : t.sub}>{n.impact}</span>
                            {n.source ? <a href={n.source} target="_blank" rel="noopener noreferrer" className="hover:text-sky-400 hover:underline">{n.text}</a> : <span>{n.text}</span>}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ③ 지금 적정 자산 — 금리 지표만으로 판정(주가 조건은 6단계) */}
          <section className={`rounded-lg border ${t.border} p-3`} style={{ background: t.card }}>
            <div className="flex flex-wrap items-baseline gap-2 mb-2">
              <h2 className="text-[13px] font-bold">지금 적정 자산</h2>
              <span className={`text-[10px] ${t.sub}`}>금리 지표 조건 충족 순 · 행을 누르면 조건별 ○× · 세후 = 미국 원천징수 {effRules.withholdingPct}% 차감(한국 채권은 이자소득세 {effRules.krInterestTaxPct}%)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className={`text-[11px] ${t.sub} border-b ${t.border}`}>
                    <th className="text-left font-normal py-1 pr-2">자산군</th>
                    <th className="text-left font-normal py-1 pr-2">상태</th>
                    <th className="text-right font-normal py-1 pr-2">조건</th>
                    <th className="text-right font-normal py-1 pr-2 whitespace-nowrap">지금 투자 시 수익률 (세전 / 세후)</th>
                    <th className="text-left font-normal py-1">근거</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map(sg => {
                    const color = sg.warning ? SIGNAL_COLOR.warn : SIGNAL_COLOR[sg.state];
                    const open = openSignal === sg.key;
                    return (
                      <React.Fragment key={sg.key}>
                        <tr className={`border-b ${t.border} cursor-pointer hover:bg-sky-500/5`} onClick={() => setOpenSignal(open ? null : sg.key)}>
                          <td className="py-1.5 pr-2 whitespace-nowrap">
                            <span className="font-bold">{sg.label}</span> <span className={`text-[10px] ${t.sub}`}>{sg.sample}</span>
                          </td>
                          <td className="py-1.5 pr-2 whitespace-nowrap">
                            <span className="text-[11px] font-bold px-1.5 rounded" style={{ color, border: `1px solid ${color}66` }}>
                              {sg.warning ? `경고 · ${SIGNAL_STATE_LABEL[sg.state]}` : SIGNAL_STATE_LABEL[sg.state]}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">{sg.met}/{sg.total}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">
                            {sg.yields.length
                              ? sg.yields.map(y => <div key={y.label}><span className={`text-[10px] ${t.sub}`}>{y.label}</span> {y.pre.toFixed(2)}% / {y.post == null ? '—' : `${y.post.toFixed(2)}%`}</div>)
                              : <span className={t.sub} title="종목 배당률은 6단계에서 추가">-</span>}
                          </td>
                          <td className="py-1.5">
                            {sg.warning && <span className="text-red-400 font-bold mr-1">{sg.warning} ·</span>}
                            <span className={t.sub}>{sg.rationale}</span>
                            {sg.note && <div className="text-[11px] text-amber-400">{sg.note}</div>}
                            {sg.key === 'brBond' && brBondPrice != null && (
                              <div className={`text-[11px] ${t.sub}`}>
                                지금 10년 금리 기준 액면 1,000헤알·표면 {BRL_BOND_COUPON}% 채권 이론 가격 R$ {brBondPrice.toFixed(2)}{brBondKrw != null ? ` ≈ ₩${Math.round(brBondKrw).toLocaleString('ko-KR')}` : ''}
                              </div>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className={`border-b ${t.border}`}>
                            <td colSpan={5} className="py-1.5 pl-3">
                              <ul className="flex flex-col gap-0.5 text-[11px]">
                                {sg.conditions.map(c => (
                                  <li key={c.label} className={c.pending ? t.sub : ''}>
                                    <span className={`inline-block w-4 font-bold ${c.pending ? '' : c.met ? 'text-green-400' : 'text-gray-500'}`}>{c.pending ? '…' : c.met ? '○' : '×'}</span>
                                    {c.label} <span className={t.sub}>— {c.detail}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 상태 변경 기록 — 벨 알림 대신(알림 최소화 정책). 창을 열 때 바뀐 자산군만 남는다 */}
            <div className={`mt-2 rounded border ${t.border} px-2`}>
              <button onClick={() => setHistoryOpen(o => !o)} className="w-full flex items-baseline gap-2 py-1.5 text-left">
                <span className="text-[12px] font-bold">{historyOpen ? '▾' : '▸'} 상태 변경 기록</span>
                <span className={`text-[10px] ${t.sub}`}>최근 20건 · 전체 {eff.history.length}건(최대 200)</span>
              </button>
              {historyOpen && (
                <div className="pb-2 text-[11px] flex flex-col gap-0.5">
                  {eff.history.length === 0 && <div className={t.sub}>아직 기록이 없습니다 — 창을 열 때 상태가 바뀐 자산군이 기록됩니다</div>}
                  {eff.history.slice(-20).reverse().map((e, i) => (
                    <div key={`${e.date}-${e.key}-${i}`} className="flex flex-wrap gap-x-2">
                      <span className={`tabular-nums ${t.sub}`}>{e.date}</span>
                      <span className="font-bold">{e.label}</span>
                      <span className={e.to.endsWith(':warn') ? 'text-red-400' : ''}>{stateText(e.from)} → {stateText(e.to)}</span>
                      <span className={t.sub}>{e.rationale}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 과거 신호 검증 — 펼칠 때만 대표 종목 종가·배당을 받아 성과를 계산한다 */}
          <section className={`rounded-lg border ${t.border} p-3`} style={{ background: t.card }}>
            <button onClick={() => setBtOpen(o => !o)} className="w-full flex flex-wrap items-baseline gap-2 text-left">
              <span className="text-[13px] font-bold">{btOpen ? '▾' : '▸'} 과거 신호 검증</span>
              <span className={`text-[10px] ${t.sub}`}>'매수 적기'에 새로 들어간 날 · 같은 자산군은 20거래일 간격</span>
            </button>
            {btOpen && btTable && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="text-[11px] text-amber-400">과거 성과는 미래를 보장하지 않습니다. 신호 수가 적으면 우연일 수 있습니다.</div>
                <div className={`text-[11px] ${t.sub}`}>
                  금리 지표 조건만으로 다시 계산했습니다(종목 배당률·주당 장부가/순자산·정치 메모 조건은 빼고 계산). 지금 받아 둔 과거치 범위 안에서만 계산하며, 차트 기간을 10년으로 늘리면 더 길게 봅니다.
                  총수익 = 주가 변화 + 그 기간 배당 합계(재투자 없음).
                </div>
                <div className="flex flex-col gap-0.5 text-[11px]">
                  {btTable.summary.map(sm => (
                    <div key={sm.def.key}>
                      <span className="font-bold" style={{ color: sm.def.color }}>{sm.def.label}</span>
                      <span className={t.sub}> — 신호 {sm.count}건{sm.unit ? ` · ${sm.unit} 평균 ${sm.avg == null ? '-' : `${sm.avg >= 0 ? '+' : ''}${sm.avg.toFixed(1)}%`} · 플러스 ${sm.winRate == null ? '-' : `${sm.winRate.toFixed(0)}%`}(끝난 ${sm.done}건)` : ' · 대표 종목 없음(10년 금리 변화만)'}</span>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] border-collapse">
                    <thead>
                      <tr className={`text-[11px] ${t.sub} border-b ${t.border}`}>
                        <th className="text-left font-normal py-1 pr-2">신호일</th>
                        <th className="text-left font-normal py-1 pr-2">자산군</th>
                        <th className="text-left font-normal py-1 pr-2">그날 핵심 지표</th>
                        {BT_HORIZONS.map(mo => <th key={mo} className="text-right font-normal py-1 pr-2">{mo}개월</th>)}
                        <th className="text-left font-normal py-1">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {btTable.rows.length === 0 && (
                        <tr><td colSpan={4 + BT_HORIZONS.length} className={`py-2 ${t.sub}`}>받아 둔 과거치 안에서 '매수 적기' 신호가 없습니다</td></tr>
                      )}
                      {btTable.rows.map(({ def, sg, cells }) => (
                        <tr key={`${def.key}-${sg.date}`} className={`border-b ${t.border}`}>
                          <td className="py-1 pr-2 tabular-nums whitespace-nowrap">{sg.date}</td>
                          <td className="py-1 pr-2 whitespace-nowrap" style={{ color: def.color }}>{def.label}{def.rep ? <span className={`ml-1 text-[10px] ${t.sub}`}>{def.rep}</span> : null}</td>
                          <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{def.core.map(k => `${RATE_DEFS[k]?.label || k} ${fmtVal(sg.core[k], RATE_DEFS[k]?.unit ?? '%')}`).join(' · ')}</td>
                          {cells.map((c, i) => (
                            <td key={i} className={`py-1 pr-2 text-right whitespace-nowrap tabular-nums ${c.v == null ? t.sub : c.v >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{c.text}</td>
                          ))}
                          <td className={`py-1 text-[11px] ${t.sub}`}>{def.keys.some(k => SHORT_DATA_KEYS.includes(k)) ? '자료 3년' : ''}{def.rep && btPrices[def.rep]?.status === 'fail' ? ' 종가를 받지 못함' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ④ 금리 차트 */}
          <section className={`rounded-lg border ${t.border} p-3`} style={{ background: t.card }}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-[13px] font-bold">금리 차트</h2>
              <div className="ml-auto flex gap-1" role="group" aria-label="기간">
                {PERIODS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                      period === p.key ? 'border-sky-500 text-sky-400' : `${t.border} ${t.sub} hover:text-sky-400`
                    }`}
                  >{p.label}</button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
              <ChartBox title="미국 금리 — 기준·2년·10년·30년 (%)" rows={rowsUs} t={t}>
                <ComposedChart data={rowsUs} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={t.grid} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={shortDate} minTickGap={40} stroke={t.axis} />
                  <YAxis tick={axisTick} stroke={t.axis} width={36} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} formatter={tip('%')} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {['fedRate', 'us2y', 'us10y', 'us30y'].map(k => (
                    <Line key={k} isAnimationActive={false} type="monotone" dataKey={k} name={RATE_DEFS[k].label} stroke={COLORS[k]} dot={false} strokeWidth={1.5} connectNulls />
                  ))}
                  {signalLines(['longBond', 'equityReit'], null, fromChart)}
                </ComposedChart>
              </ChartBox>

              <ChartBox title="금리차 — 10년−2년·10년−3개월 (%p, 0 아래 = 역전)" rows={rowsSpread} t={t}>
                <ComposedChart data={rowsSpread} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={t.grid} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={shortDate} minTickGap={40} stroke={t.axis} />
                  <YAxis tick={axisTick} stroke={t.axis} width={36} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} formatter={tip('%p')} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {spreadMin < 0 && <ReferenceArea y1={spreadMin} y2={0} fill="#ef4444" fillOpacity={0.08} stroke="none" ifOverflow="hidden" />}
                  <ReferenceLine y={0} stroke={t.axis} strokeDasharray="3 3" />
                  {['t10y2y', 't10y3m'].map(k => (
                    <Line key={k} isAnimationActive={false} type="monotone" dataKey={k} name={RATE_DEFS[k].label} stroke={COLORS[k]} dot={false} strokeWidth={1.5} connectNulls />
                  ))}
                </ComposedChart>
              </ChartBox>

              <ChartBox title="하이일드 — 금리(왼쪽 %)·스프레드(오른쪽 %p), 점선 = 52주 최고·최저" rows={rowsHy} t={t}>
                <ComposedChart data={rowsHy} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={t.grid} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={shortDate} minTickGap={40} stroke={t.axis} />
                  <YAxis yAxisId="left" tick={axisTick} stroke={COLORS.hyYield} width={36} domain={['auto', 'auto']} />
                  <YAxis yAxisId="right" orientation="right" tick={axisTick} stroke={COLORS.hySpread} width={36} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [fmtVal(Number(v), name === RATE_DEFS.hyYield.label ? '%' : '%p'), name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {hy.high52 != null && <ReferenceLine yAxisId="left" y={hy.high52} stroke={COLORS.hyYield} strokeOpacity={0.6} strokeDasharray="4 4" ifOverflow="extendDomain" />}
                  {hy.low52 != null && <ReferenceLine yAxisId="left" y={hy.low52} stroke={COLORS.hyYield} strokeOpacity={0.6} strokeDasharray="4 4" ifOverflow="extendDomain" />}
                  {hs.high52 != null && <ReferenceLine yAxisId="right" y={hs.high52} stroke={COLORS.hySpread} strokeOpacity={0.6} strokeDasharray="4 4" ifOverflow="extendDomain" />}
                  {hs.low52 != null && <ReferenceLine yAxisId="right" y={hs.low52} stroke={COLORS.hySpread} strokeOpacity={0.6} strokeDasharray="4 4" ifOverflow="extendDomain" />}
                  <Line yAxisId="left" isAnimationActive={false} type="monotone" dataKey="hyYield" name={RATE_DEFS.hyYield.label} stroke={COLORS.hyYield} dot={false} strokeWidth={1.5} connectNulls />
                  <Line yAxisId="right" isAnimationActive={false} type="monotone" dataKey="hySpread" name={RATE_DEFS.hySpread.label} stroke={COLORS.hySpread} dot={false} strokeWidth={1.5} connectNulls />
                  {signalLines(['highYield', 'bdc'], 'left', fromChart)}
                </ComposedChart>
              </ChartBox>

              <ChartBox title="MBS — 스프레드(왼쪽 %p)·MOVE(오른쪽)" rows={rowsMbs} t={t}>
                <ComposedChart data={rowsMbs} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={t.grid} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={shortDate} minTickGap={40} stroke={t.axis} />
                  <YAxis yAxisId="left" tick={axisTick} stroke={COLORS.mbsSpread} width={36} domain={['auto', 'auto']} />
                  <YAxis yAxisId="right" orientation="right" tick={axisTick} stroke={COLORS.move} width={36} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [fmtVal(Number(v), name === RATE_DEFS.move.label ? '' : '%p'), name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line yAxisId="left" isAnimationActive={false} type="monotone" dataKey="mbsSpread" name={RATE_DEFS.mbsSpread.label} stroke={COLORS.mbsSpread} dot={false} strokeWidth={1.5} connectNulls />
                  <Line yAxisId="right" isAnimationActive={false} type="monotone" dataKey="move" name={RATE_DEFS.move.label} stroke={COLORS.move} dot={false} strokeWidth={1.5} connectNulls />
                  {signalLines(['mortgageReit'], 'left', fromChart)}
                </ComposedChart>
              </ChartBox>

              <ChartBox title="브라질 — 10년·Selic·물가·기대물가(왼쪽 %) · 헤알·원(오른쪽, 점선)" rows={rowsBr} t={t}>
                <ComposedChart data={rowsBr} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={t.grid} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={shortDate} minTickGap={40} stroke={t.axis} />
                  <YAxis yAxisId="left" tick={axisTick} stroke={t.axis} width={36} domain={['auto', 'auto']} />
                  <YAxis yAxisId="right" orientation="right" tick={axisTick} stroke={COLORS.brlkrw} width={40} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [fmtVal(Number(v), name === RATE_DEFS.brlkrw.label ? '' : '%'), name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {['br10y', 'brSelic', 'brIpca', 'brExp12'].map(k => (
                    <Line key={k} yAxisId="left" isAnimationActive={false} type="monotone" dataKey={k} name={RATE_DEFS[k].label} stroke={COLORS[k]} dot={false} strokeWidth={1.5} connectNulls />
                  ))}
                  <Line yAxisId="right" isAnimationActive={false} type="monotone" dataKey="brlkrw" name={RATE_DEFS.brlkrw.label} stroke={COLORS.brlkrw} strokeDasharray="4 3" dot={false} strokeWidth={1.2} connectNulls />
                  {signalLines(['brBond'], 'left', fromChart)}
                </ComposedChart>
              </ChartBox>

              <ChartBox title="한국 금리 — 기준금리·국고채 3년·10년 + 미국 10년(점선)" rows={rowsKr} t={t}>
                <ComposedChart data={rowsKr} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={t.grid} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={shortDate} minTickGap={40} stroke={t.axis} />
                  <YAxis tick={axisTick} stroke={t.axis} width={36} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} formatter={tip('%')} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {['krBase', 'kr3y', 'kr10y'].map(k => (
                    <Line key={k} isAnimationActive={false} type="monotone" dataKey={k} name={RATE_DEFS[k].label} stroke={COLORS[k]} dot={false} strokeWidth={1.5} connectNulls />
                  ))}
                  <Line isAnimationActive={false} type="monotone" dataKey="us10y" name={RATE_DEFS.us10y.label} stroke={t.axis} strokeDasharray="4 3" dot={false} strokeWidth={1.2} connectNulls />
                  {signalLines(['krBond'], null, fromChart)}
                </ComposedChart>
              </ChartBox>
            </div>
          </section>

          {/* ⑤ 자산군별 종목 */}
          <section className={`rounded-lg border ${t.border} p-3`} style={{ background: t.card }}>
            <div className="flex flex-wrap items-baseline gap-2 mb-2">
              <h2 className="text-[13px] font-bold">자산군별 종목</h2>
              <span className={`text-[10px] ${t.sub}`}>배당률 = 최근 12개월 배당 합계 ÷ 현재가 · 세후 = 원천징수 {effRules.withholdingPct}% 차감 · 티커를 누르면 Yahoo Finance</span>
            </div>
            <div className="flex flex-wrap gap-1 mb-2" role="tablist">
              {RATE_ASSET_GROUPS.map(g => (
                <button
                  key={g.key}
                  role="tab"
                  aria-selected={assetTab === g.key}
                  onClick={() => setAssetTab(g.key)}
                  className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                    assetTab === g.key ? 'border-sky-500 text-sky-400' : `${t.border} ${t.sub} hover:text-sky-400`
                  }`}
                >{g.label}</button>
              ))}
            </div>
            {failedTickers.length > 0 && (
              <div className="text-[11px] text-amber-400 mb-2">받지 못한 종목: {failedTickers.join(', ')}</div>
            )}
            {(() => {
              const g = RATE_ASSET_GROUPS.find(x => x.key === assetTab) || RATE_ASSET_GROUPS[0];
              const rows = orderRateAssetRows(g, g.tickers.map(tk => assetRows[tk]));
              const extraHead = g.extra === 'pb' ? '주가÷장부가' : g.extra === 'spread10y' ? '배당률−미국 10년' : g.extra === 'pnav' ? '주가÷순자산' : null;
              return (
                <>
                  {g.note && <div className={`text-[11px] mb-1 ${t.sub}`}>{g.note}</div>}
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px] border-collapse">
                      <thead>
                        <tr className={`text-[11px] ${t.sub} border-b ${t.border}`}>
                          <th className="text-left font-normal py-1 pr-2">티커</th>
                          <th className="text-right font-normal py-1 pr-2">현재가</th>
                          <th className="text-right font-normal py-1 pr-2">12개월 배당률</th>
                          <th className="text-right font-normal py-1 pr-2">세후</th>
                          <th className="text-right font-normal py-1 pr-2">52주 최고 대비</th>
                          <th className="text-right font-normal py-1 pr-2">최근 배당 변화</th>
                          <th className="text-right font-normal py-1 pr-2">배당 주기</th>
                          {extraHead && <th className="text-right font-normal py-1">{extraHead}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => {
                          const st = assetData[r.ticker]?.status;
                          const wait = !st || st === 'loading';
                          const cell = (txt) => (wait ? '…' : txt);
                          let extra = null;
                          if (g.extra === 'pb' || g.extra === 'pnav') {
                            const v = g.extra === 'pb' ? r.pb : r.pnav;
                            if (!r.manualKind) extra = <span className={t.sub}>-</span>;
                            else if (!r.manualSet) extra = <span className="text-amber-400">입력 필요</span>;
                            else if (v == null) extra = cell('-');
                            else if (g.extra === 'pb' && v >= effRules.mreit.pbWarn) extra = <span className="text-red-400 font-bold">{v.toFixed(2)}배 유상증자 위험</span>;
                            else if (g.extra === 'pb' && v <= effRules.mreit.pbMax) extra = <span className="text-green-400 font-bold">{v.toFixed(2)}배</span>;
                            else extra = `${v.toFixed(2)}배`;
                          } else if (g.extra === 'spread10y') {
                            extra = cell(r.spread10y == null ? '-' : fmtVal(r.spread10y, '%p'));
                          }
                          const chg = r.change ? DIV_CHANGE_LABEL[r.change] : '-';
                          const chgColor = r.change === 'up' ? 'text-green-400' : r.change === 'down' ? 'text-red-400' : '';
                          return (
                            <tr key={r.ticker} className={`border-b ${t.border}`}>
                              <td className="py-1.5 pr-2 whitespace-nowrap">
                                <a href={yahooQuoteUrl(r.ticker)} target="_blank" rel="noopener noreferrer" className="font-bold hover:text-sky-400 hover:underline">{r.ticker}</a>
                                {r.isEtf && <span className={`ml-1 text-[10px] ${t.sub}`}>ETF</span>}
                                {g.pin === r.ticker && <span className="ml-1 text-[10px] text-sky-400">대표</span>}
                              </td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{cell(r.price == null ? '-' : `$${r.price.toFixed(2)}`)}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums font-bold">{cell(r.noDividend ? '배당 없음' : fmtPctCell(r.yield12))}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{cell(fmtPctCell(r.yieldPost))}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{cell(r.drawdown52 == null ? '-' : `${r.drawdown52.toFixed(1)}%`)}</td>
                              <td className={`py-1.5 pr-2 text-right ${chgColor}`}>{cell(chg)}</td>
                              <td className="py-1.5 pr-2 text-right">{cell(r.cycle ? DIV_CYCLE_LABEL[r.cycle] : '-')}</td>
                              {extraHead && <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{extra}</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </section>
        </main>

        {/* ⑥ 설정 — 기준치·수동값·브라질 메모(앱 탭이 Drive에 저장) */}
        <section className={`mx-4 mb-3 rounded-lg border ${t.border} p-3`} style={{ background: t.card }}>
          <div className="flex flex-wrap items-baseline gap-2 mb-1">
            <h2 className="text-[13px] font-bold">설정</h2>
            <span className={`text-[10px] ${t.sub}`}>저장하면 ③ 판정과 ⑤ 표가 바로 다시 계산됩니다</span>
            {isAdmin && storeMode === 'drive' && (
              <span className="ml-auto flex items-center gap-1 text-[11px]">
                {!redoConfirm
                  ? <button disabled={collect.active} onClick={() => setRedoConfirm(true)} className={`px-2 py-0.5 rounded border ${t.border} hover:text-sky-400 disabled:opacity-40`}>과거 기록 전체 다시 받기</button>
                  : (<>
                    <span className="text-amber-400">저장된 과거 기록을 처음부터 다시 받습니다. 진행할까요?</span>
                    <button onClick={() => { setRedoConfirm(false); runCollection(true); }} className="px-2 py-0.5 rounded border border-sky-500 text-sky-400">예</button>
                    <button onClick={() => setRedoConfirm(false)} className={`px-2 py-0.5 rounded border ${t.border}`}>아니오</button>
                  </>)}
              </span>
            )}
          </div>
          {settingsState === 'error' && <div className="text-[11px] text-red-400 mb-1">{settingsError}</div>}
          {settingsState === 'loading'
            ? <div className={`text-[11px] ${t.sub}`}>설정을 불러오는 중…</div>
            : (
              <RateSettingsPanel
                key={settingsSeq}
                t={t}
                defaults={RATE_RULES}
                rules={effRules}
                manual={eff.manual}
                notes={eff.notes}
                today={today}
                writable={linked && canWrite && settingsState === 'ready'}
                lockReason={!linked ? '앱 탭이 열려 있어야 저장됩니다' : !canWrite ? '저장할 수 없습니다(관리자 접속 중이거나 Drive 연결 전)' : '설정을 불러오지 못해 수정할 수 없습니다'}
                onSave={saveSettings}
              />
            )}
        </section>

        {/* 용어 풀이 — 지표 33개 · 자산군 7개 */}
        <section className={`mx-4 mb-16 rounded-lg border ${t.border} p-3`} style={{ background: t.card }}>
          <button onClick={() => setGlossaryOpen(o => !o)} className="w-full text-left">
            <span className="text-[13px] font-bold">{glossaryOpen ? '▾' : '▸'} 용어 풀이</span>
          </button>
          {glossaryOpen && (
            <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 text-[11px]">
              <div className="sm:col-span-2 font-bold mt-1">자산군</div>
              {RATE_GLOSSARY_ASSETS.map(g => <div key={g.key}><span className="font-bold">{g.label}</span> <span className={t.sub}>— {g.text}</span></div>)}
              <div className="sm:col-span-2 font-bold mt-2">지표</div>
              {RATE_GLOSSARY_INDICATORS.map(g => <div key={g.key}><span className="font-bold">{g.label}</span> <span className={t.sub}>— {g.text}</span></div>)}
            </div>
          )}
        </section>

        {/* ⑥ 하단 고정 문구 */}
        <footer className={`fixed bottom-0 inset-x-0 px-4 py-2 border-t ${t.border} text-[11px] ${t.sub} text-center`} style={{ background: t.page }}>
          판정은 과거 수치로 만든 참고 신호이며 투자 권유가 아닙니다.
        </footer>
      </div>
    </ErrorBoundary>
  );
}
