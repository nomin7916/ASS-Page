// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Star, Plus, Pencil, Trash2, Check, RefreshCw, Clock, GripVertical, PanelLeft, PanelLeftClose, ExternalLink, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';
import { generateId, formatNumber, formatChangeRate } from '../utils';
import { detectMarket, fetchWatchQuote, fetchWatchDaily, fetchWatchIntraday, fetchWatchDividend, fmtWatchPrice } from '../watchlistQuote';
import {
  periodCutoff, watchPeriodWindow, windowRate, stockDetailUrl, stockChartUrl, stockChartWindowName, chartPeriodFromWatch,
  holdingsFor, holdingAvg, holdingLayout, pickHoldings, krCodeWithZeros,
} from '../watchlistChart';
import { WATCH_RECENT_ID, isAutoWatchGroup, manualWatchGroupIds, reorderManualWatchGroups, WATCH_CUSTOM_PERIOD, DEFAULT_WATCH_VIEW, normalizeWatchView, sameWatchView, normalizeWatchSize, sameWatchSize, resizeWatchRect, watchSizeAfterResize, watchHighlightOf, nextWatchHighlight, toggleWatchHighlight, clearWatchHighlights } from '../watchlistGroups';

// FloatingCalculator와 동일 규칙의 비차단·이동 가능 플로팅 패널.
// - 단일 position:fixed div (백드롭/오버레이 없음 → 아래 앱 클릭·스크롤 통과)
// - z 1050 (dialog 1000 < 여기 < LoadingOverlay 1100)
// - 타이틀 바만 드래그 핸들, window mousemove/touchmove 리스너로 이동, 뷰포트 클램프
const WATCHLIST_Z = 1050;
// 현재가 오른쪽 '분배금·분배율' 열(사용자 요청 2026-10 — 기본 숨김, 클릭하면 펼침).
// ⚠️ 접힌 상태에도 같은 폭(DIV_TOGGLE_W)의 칸을 헤더·행 **양쪽**에 둔다 — 한쪽만 있으면 현재가 열이 어긋난다.
// ⚠️ 펼치면 그 폭만큼 기본 폭·최소 폭을 함께 늘린다(종목명 칸이 그만큼 쪼그라들지 않게 — PANEL_W와 같은 이유).
const DIV_COL_W = 96;
const DIV_TOGGLE_W = 24;
// 종목명 열은 고정폭 열(하이라이트 띠12+그립16+점6+미니차트56+등락율64+현재가96+분배 접힘24+삭제12+여백/gap 80
// ≈ 364px)을 뺀 나머지라, 폭이 좁으면 국내 ETF 풀네임(예: "KODEX 금융고배당TOP10타겟위클리커버드콜")이 대부분 잘린다.
// 종목 리스트에 640px + 분배 접힘 칸 = 종목명 약 310px 확보 → 긴 ETF명도 한 줄에 그대로 보인다.
// ⚠️ PANEL_W = 640(리스트) + DIV_TOGGLE_W(분배 접힘 칸) + SIDEBAR_W(그룹 사이드바). 칸을 넣으면서 폭을 안
//    늘리면 종목명이 그만큼 쪼그라들어 위 640px의 존재 이유가 통째로 무너진다 — 셋은 한 세트다.
//    (좁은 화면은 maxWidth로 클램프)
const SIDEBAR_W = 180;
const PANEL_W = 640 + DIV_TOGGLE_W + SIDEBAR_W;
// 크기 조절 하한 — 리스트 칸의 고정 열(그립·차트·등락율·현재가·분배 접힘 ≈ 314px)이 겹치지 않는 최소 폭과
// 기간 토글·리스트 몇 줄이 보이는 최소 높이. 사이드바·분배금 열을 펼치면 그 폭만큼 더 필요하다(minW 참조).
const LIST_MIN_W = 320;
const PANEL_MIN_H = 260;
// 모서리·가장자리 손잡이(사용자 요청 2026-10 — 폴더 창처럼 끌어서 크기를 바꾼다).
// ⚠️ 손잡이는 패널 테두리에 **걸쳐서**(바깥 5px · 안쪽 3px) 둔다 — 안쪽으로만 두면 오른쪽 손잡이가 리스트의
//    세로 스크롤바(6px)를 덮어 스크롤바를 잡을 수 없다. 그래서 패널(overflow-hidden) 밖의 래퍼에 둔다.
const RESIZE_HANDLES = [
  { dir: 'n', cursor: 'ns-resize', style: { top: -5, left: 14, right: 14, height: 8 } },
  { dir: 's', cursor: 'ns-resize', style: { bottom: -5, left: 14, right: 14, height: 8 } },
  { dir: 'e', cursor: 'ew-resize', style: { right: -5, top: 14, bottom: 14, width: 8 } },
  { dir: 'w', cursor: 'ew-resize', style: { left: -5, top: 14, bottom: 14, width: 8 } },
  { dir: 'nw', cursor: 'nwse-resize', style: { top: -4, left: -4, width: 18, height: 18 } },
  { dir: 'ne', cursor: 'nesw-resize', style: { top: -4, right: -4, width: 18, height: 18 } },
  { dir: 'sw', cursor: 'nesw-resize', style: { bottom: -4, left: -4, width: 18, height: 18 } },
  { dir: 'se', cursor: 'nwse-resize', style: { bottom: -4, right: -4, width: 18, height: 18 } },
];
const MARKET_LABEL = { kr: '국내', us: '해외', fund: '펀드' };
const RECENT_ID = WATCH_RECENT_ID;   // 자동 '최근조회' 그룹의 예약 id
const RECENT_NAME = '최근조회';
const RECENT_CAP = 20;            // 최근조회 보관 개수
const MAX_GROUPS = 30;           // 수동 그룹 소프트 상한(최근조회 제외)
const MAX_STOCKS = 100;          // 그룹당 종목 소프트 상한

// 자동 그룹 판정·순서 재배치는 `watchlistGroups.ts`(순수 모듈)가 정본이다 —
// verify:watchlist가 미러 없이 그 모듈을 직접 import해 검증하므로 여기서 손복제하지 말 것.
const isAutoGroupOf = isAutoWatchGroup;

// 가격 표기는 종목 차트 창과 **공유**한다(watchlistQuote.fmtWatchPrice) — 두 화면에서 같은 종목이 다르게 찍히지 않게.
const fmtPrice = fmtWatchPrice;
// 분배금 표기 — 해외는 센트 이하 분배(예 $0.341)가 흔해 소수 4자리까지 보인다.
const fmtDivAmount = (market, v) => (market === 'us'
  ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  : formatNumber(v));
const fmtDivRate = (r) => (r != null && Number.isFinite(r) ? `${r.toFixed(2)}%` : '-');
// '1일' 기준가(전일 종가)는 등락률에서 역산한 **실수**라 그대로 두면 국내 종목이 '11,249.061'처럼 찍힌다
// (formatNumber = Intl 기본 소수 3자리). 시장의 표시 정밀도로 먼저 맞춘다 — 국내는 호가가 정수다.
// ⚠️ fmtPrice(공용 포매터)를 고쳐서 해결하지 말 것: 현재가 등 다른 호출부의 표기까지 바뀐다.
const roundToMarket = (market, v) => (market === 'kr' ? Math.round(v) : Math.round(v * 100) / 100);
// 기준일 표기 — 앱의 다른 표(평가액 추이 등)와 같은 YY/MM/DD.
// ⚠️ MM/DD로 줄이지 말 것: '1년' 탭의 기준일은 작년이라 연도가 없으면 올해로 오독된다.
const fmtBaseDate = (d) => (typeof d === 'string' && d.length >= 10 ? d.slice(2).replace(/-/g, '/') : '');
const REFRESH_HINT = '클릭하여 이 종목 새로고침 (현재가 + 기간 등락율·미니차트 종가)';
const rateColor = (r) => (r > 0 ? 'text-red-400' : r < 0 ? 'text-blue-400' : 'text-gray-500');
const dotCls = (st) =>
  st === 'loading' ? 'bg-amber-400 animate-pulse' : st === 'success' ? 'bg-emerald-500' : st === 'fail' ? 'bg-red-500' : 'bg-gray-600';

const PERIODS = ['1일', '1주', '1개월', '3개월', '1년'];
// 사용자가 시작일·종료일을 직접 고르는 기간. 종료일을 비우면 '현재'까지 — 구간 마지막 점을
// 실시간 현재가로 둔다. 기간·시작/종료일·정렬은 `view` prop으로 저장된다(chartPrefs.watchlistView).
const CUSTOM = WATCH_CUSTOM_PERIOD;
// 달력 팝업은 body로 포털되므로 이 팝업(z 1050)보다 높아야 보인다(CustomDatePicker `zIndex` 규약).
const PICKER_Z = 1070;
const todayKST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
// 일별 기간의 시작 컷오프 날짜(YYYY-MM-DD). '1일'은 인트라데이라 미사용.
// ⚠️ 반드시 KST 달력일에 앵커할 것. 과거엔 `new Date()`를 그대로 `toISOString()`(UTC)으로 잘라
//    KST 00:00~09:00에는 컷오프가 하루 앞당겨졌다 — 구간 첫 종가가 하루 더 이른 거래일이 되어
//    **같은 데이터인데 시각에 따라 등락율·정렬 순서·툴팁 기준일이 달라진다**(등락율이 이 창에서
//    파생되기 시작한 2026-08부터는 차트 외관이 아니라 화면 숫자가 흔들린다).
//    시프트도 UTC 메서드로 해야 뷰어 로컬 타임존이 결과를 흔들지 않는다.
// ⚠️ 산술은 watchlistChart.periodCutoff가 정본 — 종목 차트 창이 같은 함수를 써서 팝업 등락율과
//    차트 창의 '기간 수익률'이 같은 시작일을 쓴다(손복제하면 같은 기간에 두 화면의 %가 갈린다).
const cutoffFor = (period) => periodCutoff(period, todayKST());

// 등락율 클릭 시 여는 종목 상세페이지 URL (PortfolioTable과 동일 규칙 — 차트 창과 공유)
const detailUrl = stockDetailUrl;

// 보유 종목 매입가 표시색(미니차트 점선 · '보유' 표시) — 시세 선의 빨강·파랑과 헷갈리지 않는 호박색.
const HOLD_COLOR = '#fbbf24';

// 최근 종가 미니 라인차트(인라인 SVG — 행마다 recharts 컨테이너를 쓰지 않아 가벼움).
// 상승 red / 하락 blue (한국식). 데이터 2점 미만이면 빈칸.
// ⚠️ 선 색은 옆 칸 등락율과 **같은 값**(rate)으로 칠한다 — 점 비교로 되돌리면 등락률이 정확히 0이거나
//    1일 탭(전일 종가 대비 실시간)에서 "선은 빨강인데 숫자는 파랑"이 다시 난다. rate 미제공 시에만 점 비교로 폴백.
// avg = 보유 종목의 합산 매입가(포트폴리오 테이블 구매단가) → 호박색 점선. 매입가가 시세와 멀어 눈금을
//   넓히면 시세 선이 높이의 40% 미만으로 눌리는 경우엔 넓히지 않고 위·아래 가장자리에 성긴 점선으로만
//   표시한다(holdingLayout — 종목 차트 창과 같은 40% 규칙).
function Sparkline({ points, rate, avg = null, width = 56, height = 20 }) {
  if (!Array.isArray(points) || points.length < 2) return <div style={{ width, height }} className="shrink-0" />;
  let min = Math.min(...points);
  let max = Math.max(...points);
  const avgLay = typeof avg === 'number' && avg > 0 ? holdingLayout(min, max, [avg], 0.4) : null;
  const avgPin = avgLay ? avgLay.pins[0] : 'none';
  if (avgPin === '') { min = avgLay.lo; max = avgLay.hi; }
  const range = max - min || 1;
  const up = points[points.length - 1] >= points[0];
  const stroke = (rate != null && Number.isFinite(rate))
    ? (rate > 0 ? '#f87171' : rate < 0 ? '#60a5fa' : '#9ca3af')
    : (up ? '#f87171' : '#60a5fa');
  const stepX = width / (points.length - 1);
  const pad = 2;
  const h = height - pad * 2;
  const d = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(pad + h - ((v - min) / range) * h).toFixed(1)}`)
    .join(' ');
  const avgY = avgPin === '' ? pad + h - ((avg - min) / range) * h : avgPin === 'top' ? 0.5 : avgPin === 'bottom' ? height - 0.5 : null;
  return (
    <svg width={width} height={height} className="shrink-0" style={{ display: 'block' }}>
      {avgY != null && (
        <line x1={0} x2={width} y1={avgY} y2={avgY} stroke={HOLD_COLOR} strokeWidth={1}
          strokeDasharray={avgPin === '' ? '3 2' : '1 2'} strokeOpacity={avgPin === '' ? 0.95 : 0.7} />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function WatchlistPopup({
  open, onClose, groups = [], onUpdateGroups,
  // 보유 종목 매입가 `{ [holdingKey]: [{ acct, avg, qty, cur }] }`(watchlistChart.buildHoldings) | null(아직 모름).
  // ⚠️ **읽기 전용** — 정본은 앱 탭의 portfolios. 이 팝업은 미니차트에 긋고, 여기서 연 종목 차트 창의
  //    물음(`stockchart:ping`)에 그 종목 몫만 답한다(아래 응답 effect).
  holdings = null,
  // 'popup' = 인앱 플로팅 패널 / 'page' = 별도 브라우저 창(`/?watchlistWindow=1`).
  // ⚠️ 창용으로 화면을 복제하지 말 것 — 두 화면이 갈라진다(LedgerPage·CalendarModal과 같은 규약).
  variant = 'popup',
  readOnly = false,
  notice = '',
  onOpenWindow = null,
  // 보기 상태(조회 기간 · 직접 선택 시작/종료일 · 등락율 정렬) — 사용자가 마지막으로 고른 상태.
  // `onViewChange`가 함수면 **제어 모드**(값의 정본은 호출부 — 앱 탭은 chartPrefs로 Drive 저장,
  // 별도 창은 앱 탭으로 전달), 아니면 이 컴포넌트 로컬(관리자 열람처럼 저장하지 않을 때).
  view = null,
  onViewChange = null,
  // 팝업 크기 `{ w, h }`(null = 기본 크기 · 각 축 null = 자동). `onSizeChange`가 함수면 제어 모드
  // (앱 탭이 chartPrefs로 Drive 저장), 아니면 이 컴포넌트 로컬. 별도 창(page)은 쓰지 않는다.
  size = null,
  onSizeChange = null,
}) {
  const isPage = variant === 'page';
  const [pos, setPos] = useState(() => ({
    x: Math.max(10, Math.round((window.innerWidth - PANEL_W) / 2)),
    y: 80,
  }));
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const rootRef = useRef(null);

  // 그룹 관리 로컬 상태
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [confirmDelId, setConfirmDelId] = useState(null);
  // 그룹 사이드바 접기 — 세션 로컬(뷰 선호도라 Drive 저장 지점 0곳).
  // 좁은 화면에서 사이드바가 종목명 폭을 잠식할 때의 탈출구다.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [gDragId, setGDragId] = useState(null);               // 순서 드래그 중인 그룹 id
  const [gDragOverIndex, setGDragOverIndex] = useState(null); // 삽입 슬롯(**수동 그룹 기준** 0..N)
  const sidebarListRef = useRef(null);                        // 그룹 목록 컨테이너(행 geometry 측정)

  // 종목 시세 로컬 캐시 (메모리 전용 — Drive 저장 안 함)
  const [quotes, setQuotes] = useState({});   // { [code]: { name, price, changeRate } }
  const [status, setStatus] = useState({});   // { [code]: 'loading'|'success'|'fail' }
  const [codeInput, setCodeInput] = useState('');
  const [dailyMap, setDailyMap] = useState({});       // { [code]: [date, close][] } 일별 종가(팝업 로컬 — Drive 저장 안 함)
  const [intradayMap, setIntradayMap] = useState({}); // { [code]: number[] } 오늘 인트라데이(1일)
  // 최근 분배금 — { [code]: 결과 | null(조회 실패) }. 팝업 로컬(메모리 전용 — Drive·계좌 dividendHistory에 쓰지 않는다).
  const [divMap, setDivMap] = useState({});
  const [divLoading, setDivLoading] = useState({});  // { [code]: true } 조회 중
  const loadedDivRef = useRef(new Set());            // 분배금 조회 완료/진행 코드:market
  // 종목 차트 창 — 종목마다 하나. 같은 종목을 다시 누르면 새로 열지 않고 그 창을 앞으로(추가한 비교 종목 보존).
  const chartWinsRef = useRef({});
  const [chartBlocked, setChartBlocked] = useState(false);
  // 종목 차트 창의 보유 매입가 물음에 답한다 — 이 팝업이 사는 창(앱 탭 · 관심종목 창)이 그 창의 opener다.
  // ⚠️ 답만 보낸다(읽기 전용). 차트 창은 쓰기 0 — 받은 값을 어디에도 저장하지 않는다.
  // ⚠️ 계좌 전체가 아니라 **물어본 종목 몫만**(pickHoldings). 아직 모르면(null) null로 답해 창이 기존 선을 지우지 않게 한다.
  // ⚠️ 팝업이 닫혀 있어도(open=false) 이 effect는 살아 있다 — 팝업을 닫은 뒤에도 열어 둔 차트 창에 선이 남는다.
  const holdingsRef = useRef(holdings);
  holdingsRef.current = holdings;
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;   // ⚠️ 필수 — 교차 출처 메시지는 전부 무시
      const d = e.data;
      if (!d || typeof d !== 'object' || d.type !== 'stockchart:ping' || !e.source) return;
      const h = holdingsRef.current;
      try {
        e.source.postMessage({ type: 'stockchart:holdings', holdings: h ? pickHoldings(h, d.codes) : null }, window.location.origin);
      } catch { /* 창이 닫히는 중이면 무시 */ }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  // ── 보기 상태: 기간(period) · 직접 선택 시작일/종료일('' = 현재까지 실시간) · 등락율 정렬(null|'desc'|'asc') ──
  // ⚠️ 네 값을 **한 객체**로 다룬다. 따로 setState하면 한 클릭에서 두 값을 바꿀 때(📅 기간 = 시작일 채우기 +
  //    기간 전환) 제어 모드에서 뒤 호출이 앞 호출을 낡은 값 위에 덮어 시작일이 사라진다.
  const viewControlled = typeof onViewChange === 'function';
  const [localView, setLocalView] = useState(() => normalizeWatchView(view || DEFAULT_WATCH_VIEW));
  const curView = useMemo(
    () => (viewControlled ? normalizeWatchView(view) : localView),
    [viewControlled, view, localView],
  );
  // ⚠️ 같은 이벤트에서 patchView를 연달아 부를 때 두 번째가 첫 번째 결과 위에 합성되도록 ref로 동기 추적한다.
  const viewRef = useRef(curView);
  viewRef.current = curView;
  const patchView = useCallback((patch) => {
    const base = viewRef.current;
    const next = normalizeWatchView({ ...base, ...(typeof patch === 'function' ? patch(base) : patch) });
    if (sameWatchView(next, base)) return;   // 변화 없음 → 헛된 저장 방지
    viewRef.current = next;
    if (viewControlled) onViewChange(next);
    else setLocalView(next);
  }, [viewControlled, onViewChange]);
  const { period, customStart, customEnd, sortDir, showDiv } = curView;

  // ── 팝업 크기 — 모서리·가장자리를 끌어 폭·높이를 바꾼다(인앱 팝업 전용) ──
  // ⚠️ 끄는 동안의 크기는 **로컬(liveRect)에만** 두고 손을 놓을 때 한 번만 저장한다 — 포인터가 움직일
  //    때마다 저장하면 프레임마다 chartPrefs가 바뀌어 Drive 저장이 폭주한다.
  const sizeControlled = typeof onSizeChange === 'function';
  const [localSize, setLocalSize] = useState(() => normalizeWatchSize(size));
  const curSize = useMemo(
    () => (sizeControlled ? normalizeWatchSize(size) : localSize),
    [sizeControlled, size, localSize],
  );
  const sizeRef = useRef(curSize);
  sizeRef.current = curSize;
  const commitSize = useCallback((s) => {
    const next = normalizeWatchSize(s);
    if (sameWatchSize(next, sizeRef.current)) return;   // 변화 없음 → 헛된 저장 방지
    sizeRef.current = next;
    if (sizeControlled) onSizeChange(next);
    else setLocalSize(next);
  }, [sizeControlled, onSizeChange]);
  // 표시 최소 폭 — 사이드바를 펼치면 그 폭만큼 더 필요하다(저장값이 그보다 좁으면 표시할 때 넓힌다).
  // 분배금 열을 펼치면 그 열 폭만큼 더(고정 열이 겹치지 않게).
  const divExtraW = showDiv ? DIV_COL_W : 0;
  const minW = (sidebarOpen ? SIDEBAR_W + LIST_MIN_W : LIST_MIN_W + 32) + divExtraW;
  const [liveRect, setLiveRect] = useState(null);   // 끄는 중의 { x, y, w, h, dir }
  const liveRectRef = useRef(null);
  const resizeRef = useRef(null);                   // 시작 시점 { dir, sx, sy, x, y, w, h, minW, minH, moved }
  const resizeRafRef = useRef(0);
  useEffect(() => () => { if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current); }, []);
  const onResizeDown = (e, dir) => {
    if (isPage || (e.button != null && e.button !== 0)) return;
    const el = rootRef.current;
    if (!el) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const r = el.getBoundingClientRect();
    resizeRef.current = { dir, sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, w: r.width, h: r.height, minW, minH: PANEL_MIN_H, moved: false };
  };
  const onResizeMove = (e) => {
    const st = resizeRef.current;
    if (!st) return;
    const dx = e.clientX - st.sx, dy = e.clientY - st.sy;
    if (!st.moved && dx === 0 && dy === 0) return;
    st.moved = true;
    liveRectRef.current = { ...resizeWatchRect(st, dx, dy, window.innerWidth, window.innerHeight), dir: st.dir };
    // 화면 갱신은 프레임당 한 번 — 리스트(미니차트)가 포인터 이벤트마다 다시 그려지지 않게.
    if (!resizeRafRef.current) {
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = 0;
        setLiveRect(liveRectRef.current);
      });
    }
  };
  const endResize = () => {
    const st = resizeRef.current;
    if (!st) return;
    resizeRef.current = null;
    if (resizeRafRef.current) { cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = 0; }
    const r = liveRectRef.current;
    liveRectRef.current = null;
    setLiveRect(null);
    // 누르기만 하고 움직이지 않았으면 아무것도 저장하지 않는다(클릭 한 번이 '자동 높이'를 실측값으로 박지 않게).
    if (!st.moved || !r) return;
    setPos({ x: r.x, y: r.y });
    commitSize(watchSizeAfterResize(st.dir, r, sizeRef.current));
  };
  // 손잡이 더블클릭 = 기본 크기로(유일한 되돌리기 경로). 화면 밖으로 밀리지 않게 가운데로 다시 놓는다.
  const resetSize = () => {
    commitSize(null);
    setPos((p) => ({
      x: Math.max(10, Math.round((window.innerWidth - Math.min(PANEL_W, window.innerWidth - 20)) / 2)),
      y: p.y,
    }));
  };
  const [dragId, setDragId] = useState(null);          // 순서 드래그 중인 종목 id (원래순서 모드에서만)
  const [dragOverIndex, setDragOverIndex] = useState(null); // 삽입 슬롯 인덱스(0..N)
  const listRef = useRef(null);                        // 종목 리스트 컨테이너(행 geometry 측정)
  const loadedDailyRef = useRef(new Set());            // 일별 조회 완료/진행 코드:market
  const loadedIntradayRef = useRef(new Set());         // 인트라데이 조회 완료/진행 코드:market
  const dailyFromRef = useRef({});                     // 코드:market → 받은 일별 이력의 요청 시작일
  const dailySeqRef = useRef({});                      // 코드:market → 조회 세대(늦게 온 짧은 응답이 긴 응답을 덮지 않게)

  const list = Array.isArray(groups) ? groups : [];
  const activeGroup = list.find((g) => g.id === activeGroupId) || list[0] || null;

  // ⚠️ **그룹 쓰기의 단일 통로**(fail-closed). 호출부가 10곳이라 개별 게이팅으로 두면 하나만
  //    빠뜨려도 읽기 전용에서 그 경로만 조용히 저장을 흘려보낸다(종목명 캐시·최근조회 기록처럼
  //    사용자가 '쓰기'라고 인식하지 않는 경로가 섞여 있어 특히 그렇다).
  //    별도 창은 조작 가능한 URL로 열리므로 최종 방어선은 App 측 재확인이고 이건 UI 잠금이다.
  const updateGroups = useCallback((updater) => {
    if (readOnly) return;
    onUpdateGroups?.(updater);
  }, [readOnly, onUpdateGroups]);

  const onDragStart = useCallback((cx, cy) => {
    dragging.current = true;
    dragOffset.current = { x: cx - pos.x, y: cy - pos.y };
  }, [pos]);

  // 드래그 이동 (window 리스너 — 커서가 패널 밖으로 나가도 추적)
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - (rootRef.current?.offsetWidth || PANEL_W), cx - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 40, cy - dragOffset.current.y)),
      });
    };
    const onEnd = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  // 열 때마다 화면 중앙 상단 근처로 재배치 (별도 창은 전체화면이라 좌표 자체가 없다)
  useEffect(() => {
    if (!open || isPage) return;
    const id = requestAnimationFrame(() => {
      const w = rootRef.current?.offsetWidth || PANEL_W;
      const h = rootRef.current?.offsetHeight || 0;
      setPos({
        x: Math.max(10, Math.round((window.innerWidth - w) / 2)),
        // 저장된 높이가 크면 12% 지점에서 시작할 때 아래가 화면 밖으로 잘린다 → 바닥이 들어오게 올린다.
        y: Math.max(10, Math.min(Math.round(window.innerHeight * 0.12), window.innerHeight - h - 10)),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // ───────── 시세 조회 ─────────
  // ⚠️ 앞자리 0이 빠진 국내 코드('241D0' → '0241D0', '5930' → '005930')는 국내로 다시 조회해 보고 **맞으면**
  //    그 행의 코드·시장을 고친다(repairStockCode) — 이미 저장된 행도 열 때 스스로 낫는다.
  //    해외로 판정된 코드는 숫자가 든 5자 이하 티커가 사실상 없어 복원 후보를 **먼저**, 펀드(5~7자 미래에셋)는
  //    진짜 펀드 코드일 수 있어 원래 코드를 먼저 조회한다(펀드 행마다 국내 조회가 덧붙지 않게).
  const loadQuote = async (stock) => {
    const key = stock.code;
    setStatus((p) => ({ ...p, [key]: 'loading' }));
    const zero = readOnly ? '' : krCodeWithZeros(stock.code);
    if (zero && stock.market === 'us') {
      const dz = await fetchWatchQuote('kr', zero);
      if (dz) { repairStockCode(stock, zero, dz); return; }
    }
    const d = await fetchWatchQuote(stock.market, stock.code);
    if (!d && zero && stock.market !== 'us') {
      const dz = await fetchWatchQuote('kr', zero);
      if (dz) { repairStockCode(stock, zero, dz); return; }
    }
    if (d) {
      setQuotes((p) => ({ ...p, [key]: d }));
      setStatus((p) => ({ ...p, [key]: 'success' }));
      // 종목명 캐시(STATE 저장) — 로드 직후 코드만 뜨는 깜빡임 방지. 이름 다를 때만 갱신(저장 churn 최소화)
      if (d.name && d.name !== stock.name) {
        updateGroups((prev) => (Array.isArray(prev) ? prev : []).map((g) => ({
          ...g,
          stocks: (g.stocks || []).map((s) => (s.id === stock.id ? { ...s, name: d.name } : s)),
        })));
      }
    } else {
      setStatus((p) => ({ ...p, [key]: 'fail' }));
    }
  };
  // 복원한 국내 코드로 그 행을 고친다 — 같은 그룹에 그 코드가 이미 있으면 고장 난 행을 지운다(중복 방지).
  // 시세는 이미 받았으니 그대로 싣고, 일별 종가·인트라데이·분배금만 새 코드로 받는다.
  const repairStockCode = (stock, code, d) => {
    const fixed = { ...stock, code, market: 'kr', name: d.name || stock.name || '' };
    setQuotes((p) => ({ ...p, [code]: d }));
    setStatus((p) => ({ ...p, [code]: 'success', [stock.code]: 'success' }));
    updateGroups((prev) => (Array.isArray(prev) ? prev : []).map((g) => {
      const arr = g.stocks || [];
      if (!arr.some((s) => s.id === stock.id)) return g;
      const dup = arr.some((s) => s.id !== stock.id && (s.code || '').toUpperCase() === code);
      return {
        ...g,
        stocks: dup ? arr.filter((s) => s.id !== stock.id)
          : arr.map((s) => (s.id === stock.id ? { ...s, code, market: 'kr', name: fixed.name } : s)),
      };
    }));
    loadDaily(fixed, period === CUSTOM ? customStart : '');
    if (period === '1일') loadIntraday(fixed);
    if (showDiv) loadDividend(fixed);
  };

  // 미니차트 일별 종가(~1년) — 팝업 로컬 dailyMap에만 저장(공유 stockHistoryMap 미접촉으로 보유종목 평가 불변식 보호)
  // needFrom(선택) — 직접 선택 기간의 시작일. 이미 받은 이력이 그보다 늦게 시작하면 더 길게 다시 받는다.
  const loadDaily = async (stock, needFrom = '') => {
    const key = stock.code + ':' + stock.market;
    const have = dailyFromRef.current[key];
    if (loadedDailyRef.current.has(key) && (!needFrom || (have && have <= needFrom))) return;
    loadedDailyRef.current.add(key);
    const from = needFrom && (!have || needFrom < have) ? needFrom : (have || '');
    const seq = (dailySeqRef.current[key] || 0) + 1;
    dailySeqRef.current[key] = seq;
    const pairs = await fetchWatchDaily(stock.market, stock.code, from || undefined);
    if (dailySeqRef.current[key] !== seq) return; // 더 새 조회가 있다
    if (pairs && pairs.length >= 2) {
      dailyFromRef.current[key] = from && from < cutoffFor('1년') ? from : cutoffFor('1년');
      setDailyMap((p) => ({ ...p, [stock.code]: pairs }));
    } else {
      // 실패도 '조회 완료'로 남긴다 — 안 그러면 기간 등락율이 '…'(조회 중)에서 영영 못 벗어난다.
      // 이미 받아 둔 데이터가 있으면 덮지 않는다(시장 수동 보정 재조회 실패 시 기존 이력 보존).
      setDailyMap((p) => (stock.code in p ? p : { ...p, [stock.code]: null }));
      loadedDailyRef.current.delete(key); // 데이터 없음 → 재시도 허용
    }
  };
  // '1일' 인트라데이 종가 — 팝업 로컬 intradayMap에만 저장
  const loadIntraday = async (stock) => {
    const key = stock.code + ':' + stock.market;
    if (loadedIntradayRef.current.has(key)) return;
    loadedIntradayRef.current.add(key);
    const pts = await fetchWatchIntraday(stock.market, stock.code);
    if (pts && pts.length >= 2) setIntradayMap((p) => ({ ...p, [stock.code]: pts }));
    else loadedIntradayRef.current.delete(key);
  };
  // 최근 분배금 — 분배금 열을 펼쳤을 때만 조회한다(접힌 동안 네트워크를 쓰지 않는다).
  // force = 행 새로고침·시장 보정 — 캐시를 무시하고 다시 받는다.
  const loadDividend = async (stock, force = false) => {
    const key = stock.code + ':' + stock.market;
    if (!force && loadedDivRef.current.has(key)) return;
    loadedDivRef.current.add(key);
    setDivLoading((p) => ({ ...p, [stock.code]: true }));
    const r = await fetchWatchDividend(stock.market, stock.code);
    setDivLoading((p) => { const n = { ...p }; delete n[stock.code]; return n; });
    // 실패(null)도 '조회 완료'로 남긴다 — 안 그러면 '…'(조회 중)에서 못 벗어난다. 재시도는 허용.
    setDivMap((p) => ({ ...p, [stock.code]: r }));
    if (!r) loadedDivRef.current.delete(key);
  };

  // 한 행 통째 새로고침(현재가 셀 클릭) — 시세 + 일별 종가 + (1일 탭이면) 인트라데이.
  // ⚠️ 캐시 ref를 먼저 비우고 재조회하는 것이 핵심. 등락율이 기간 시계열에서 파생되면서
  //    "조회 한 번 실패하면 그 종목 등락율이 영영 '-'"(시장 보정 버튼은 시세 실패 때만 뜬다),
  //    "앱을 하루 이상 열어두면 현재가는 오늘인데 기간 등락율은 며칠 전까지만",
  //    "장 전에 받은 어제 분봉에 오늘 현재가가 붙는다" 세 경우의 유일한 탈출구가 됐다.
  const refreshRow = (stock) => {
    const key = stock.code + ':' + stock.market;
    loadQuote(stock);
    loadedDailyRef.current.delete(key);
    loadDaily(stock, period === CUSTOM ? customStart : '');
    if (period === '1일') {
      loadedIntradayRef.current.delete(key);
      loadIntraday(stock);
    }
    if (showDiv) loadDividend(stock, true);
  };

  // 팝업 열 때 + 그룹 전환 시 활성 그룹 종목만 조회(전체 그룹 동시 조회 금지)
  useEffect(() => {
    if (!open || !activeGroup) return;
    (activeGroup.stocks || []).forEach((s) => { loadQuote(s); loadDaily(s); });
  }, [open, activeGroup?.id]);

  // 직접 선택 시작일이 1년보다 이전이면 그만큼 일별 이력을 더 받는다(활성 그룹 종목만)
  useEffect(() => {
    if (!open || !activeGroup || period !== CUSTOM || !customStart) return;
    (activeGroup.stocks || []).forEach((s) => loadDaily(s, customStart));
  }, [open, activeGroup?.id, period, customStart]);

  // 기간이 '1일'이면(1일 상태로 열림/그룹전환/토글) 활성 그룹 인트라데이 조회
  useEffect(() => {
    if (!open || !activeGroup || period !== '1일') return;
    (activeGroup.stocks || []).forEach((s) => loadIntraday(s));
  }, [open, activeGroup?.id, period]);

  // 분배금 열을 펼쳤으면(펼침/그룹 전환/열림) 활성 그룹 종목의 최근 분배금 조회
  useEffect(() => {
    if (!open || !activeGroup || !showDiv) return;
    (activeGroup.stocks || []).forEach((s) => loadDividend(s));
  }, [open, activeGroup?.id, showDiv]);

  // 활성 그룹 미지정 시 첫 그룹으로 고정 — recordRecent가 최근조회를 앞으로 재정렬해도 뷰가 튀지 않게
  useEffect(() => {
    if (open && !activeGroupId && list.length) setActiveGroupId(list[0].id);
  }, [open, list.length, activeGroupId]);

  // ───────── 그룹 CRUD ─────────
  const addGroup = () => {
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(''); return; }
    if (list.filter((g) => g.id !== RECENT_ID).length >= MAX_GROUPS) { setCreating(false); setNewName(''); return; }
    const g = { id: generateId(), name, stocks: [], createdAt: Date.now() };
    updateGroups((prev) => [...(Array.isArray(prev) ? prev : []), g]);
    setActiveGroupId(g.id);
    setCreating(false);
    setNewName('');
  };
  const renameGroup = (id) => {
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    updateGroups((prev) => (Array.isArray(prev) ? prev : []).map((g) => (g.id === id ? { ...g, name } : g)));
    setEditingId(null);
  };
  const deleteGroup = (id) => {
    updateGroups((prev) => (Array.isArray(prev) ? prev : []).filter((g) => g.id !== id));
    setConfirmDelId(null);
    if (activeGroup?.id === id) setActiveGroupId(null); // 다음 렌더에서 list[0]로 폴백
  };

  // ───────── 종목 CRUD ─────────
  const addStock = () => {
    const raw = codeInput.trim();
    // 국내 코드는 대문자가 정본이다(0241d0으로 조회하면 네이버가 0건 — api.normalizeKrCode와 같은 규칙).
    const code = detectMarket(raw) === 'kr' ? raw.toUpperCase() : raw;
    if (!code || !activeGroup) return;
    if ((activeGroup.stocks || []).length >= MAX_STOCKS) { setCodeInput(''); return; }
    if ((activeGroup.stocks || []).some((s) => (s.code || '').toLowerCase() === code.toLowerCase())) {
      setCodeInput('');
      return; // 같은 그룹 내 중복 방지
    }
    const stock = { id: generateId(), code, market: detectMarket(code), name: '', addedAt: Date.now() };
    updateGroups((prev) => (Array.isArray(prev) ? prev : []).map((g) =>
      (g.id === activeGroup.id ? { ...g, stocks: [...(g.stocks || []), stock] } : g)));
    setCodeInput('');
    loadQuote(stock);
    loadDaily(stock, period === CUSTOM ? customStart : '');
    if (period === '1일') loadIntraday(stock);
    if (showDiv) loadDividend(stock);
  };
  const removeStock = (stockId) => {
    if (!activeGroup) return;
    updateGroups((prev) => (Array.isArray(prev) ? prev : []).map((g) =>
      (g.id === activeGroup.id ? { ...g, stocks: (g.stocks || []).filter((s) => s.id !== stockId) } : g)));
  };
  // 조회 실패 행의 시장 수동 보정 → 재조회
  const setStockMarket = (stock, market) => {
    updateGroups((prev) => (Array.isArray(prev) ? prev : []).map((g) => ({
      ...g,
      stocks: (g.stocks || []).map((s) => (s.id === stock.id ? { ...s, market } : s)),
    })));
    loadQuote({ ...stock, market });
    loadDaily({ ...stock, market }, period === CUSTOM ? customStart : '');
    if (period === '1일') loadIntraday({ ...stock, market });
    if (showDiv) loadDividend({ ...stock, market }, true);
  };

  // 상세페이지를 연 종목을 '최근조회' 자동 그룹에 기록(최근 우선, 코드 dedup, RECENT_CAP 상한).
  const recordRecent = (stock) => {
    updateGroups((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      const recent = arr.find((g) => g.id === RECENT_ID);
      // 다시 본 종목은 새 항목으로 맨 앞에 붙는다 — 그 종목에 칠해 둔 하이라이트는 함께 옮긴다
      // (안 그러면 최근조회에서 칠한 색이 등락율을 한 번 누를 때마다 사라진다).
      const old = (recent?.stocks || []).find((s) => (s.code || '').toLowerCase() === (stock.code || '').toLowerCase());
      const entry = {
        id: generateId(), code: stock.code, market: stock.market, name: stock.name || '', addedAt: Date.now(),
        ...(watchHighlightOf(old?.highlight) ? { highlight: old.highlight } : {}),
      };
      const others = arr.filter((g) => g.id !== RECENT_ID);
      const prevStocks = (recent?.stocks || []).filter((s) => (s.code || '').toLowerCase() !== (stock.code || '').toLowerCase());
      const stocks = [entry, ...prevStocks].slice(0, RECENT_CAP);
      return [{ id: RECENT_ID, name: RECENT_NAME, auto: true, stocks, createdAt: recent?.createdAt || Date.now() }, ...others];
    });
  };
  // 등락율 클릭 = 상세페이지 열기 + 최근조회 기록
  const viewStock = (s, q) => {
    if (!s.code) return;
    window.open(detailUrl(s.market, s.code), '_blank');
    recordRecent({ ...s, name: q?.name || s.name || '' });
  };

  // 미니차트 클릭 = 종목 비교 차트 **별도 브라우저 창**(`/?stockChartWindow=1`, 사용자 요청 2026-10).
  // - 창은 App을 마운트하지 않고 시세를 스스로 조회한다(쓰기 0 — 브릿지가 없다).
  // - 종목마다 창 하나: 이미 열려 있으면 다시 열지 않고 앞으로만(그 창에서 추가한 비교 종목 보존).
  // ⚠️ 클릭 제스처 직후 **동기** window.open이라야 팝업 차단을 피한다. features 인자는 주지 않는다
  //    (크롬이 '팝업'으로 열어 주소창이 사라진다 — 관심종목 창과 같은 규약).
  const openChartWindow = (s, q) => {
    if (!s?.code) return;
    const name = stockChartWindowName(s.code);
    const existing = chartWinsRef.current[name];
    if (existing && !existing.closed) { try { existing.focus(); } catch {} return; }
    const w = window.open(stockChartUrl({
      code: s.code, market: s.market, name: q?.name || s.name || '',
      period: chartPeriodFromWatch(period), customStart, customEnd,
    }), name);
    // 차단되면 그 사실을 이 패널 안에 알린다(z-1050이라 토스트가 가려진다 — 인라인이 유일한 피드백).
    if (!w) { setChartBlocked(true); return; }
    chartWinsRef.current[name] = w;
    setChartBlocked(false);
    try { w.focus(); } catch {}
  };

  // 분배금 열 펼치기/접기 — 보기 상태(chartPrefs.watchlistView.showDiv)로 저장돼 다음에 열어도 그대로다.
  const toggleDiv = () => patchView((v) => ({ showDiv: !v.showDiv }));

  // 등락율 정렬 토글: 원래순서 → 내림차순 → 오름차순 → 원래순서
  const cycleSort = () => patchView((v) => ({ sortDir: v.sortDir === null ? 'desc' : v.sortDir === 'desc' ? 'asc' : null }));
  const activeStocks = activeGroup?.stocks || [];

  // ⚠️ 미니차트 배열 · 등락율 · **기준가(base)** · 정렬 · 툴팁의 **단일 소스**. 어느 하나도 떼어 따로 계산하지 말 것 —
  //    과거엔 차트만 기간을 따르고 등락율은 시세 API의 '오늘 등락률'로 고정돼 있어, 기간을 바꿔도 숫자가
  //    안 바뀌고 같은 행에서 "선은 빨강인데 숫자는 파랑"이 났다(사용자 보고 2026-08).
  //    - 1주~1년: 차트가 그리는 **바로 그 배열**의 (마지막 종가 ÷ 첫 종가) − 1 → 부호가 구조적으로 일치.
  //    - 1일: 등락율은 시세 API의 '전일 종가 대비 실시간'(표준 등락률)을 그대로 쓰고, 차트만
  //      [전일 종가, ...장중, 현재가]로 만들어 선이 전일 종가 대비 위치를 보이게 한다. 전일 종가는
  //      등락률과 같은 소스에서 역산(현재가 ÷ (1 + 등락률/100)) — 시장·타임존 무관하고 부호가 안 갈린다.
  //    - base(기준가): 그 %의 **분모**를 현재가 아래 작은 줄로 노출해 사용자가 화면에서 바로 검산하게 한다.
  //      rate와 같은 게이트·같은 값이라야 검산이 성립하므로 여기서 함께 만든다(화면 계산 금지).
  const viewByCode = useMemo(() => {
    const out = {};
    const cut = cutoffFor(period);
    for (const s of activeStocks) {
      const q = quotes[s.code];
      if (period === '1일') {
        const intra = intradayMap[s.code] || [];
        const price = q ? Number(q.price) : 0;
        const raw = q ? Number(q.changeRate) : NaN;
        const rate = Number.isFinite(raw) ? raw : null;
        let points = intra;
        // 전일 종가는 등락률과 **같은 소스에서 역산**한다(현재가 ÷ (1+등락률/100)) — 시장·타임존 무관.
        // ⚠️ dailyMap의 마지막 종가로 대체하지 말 것: 장 마감 후엔 그 값이 '오늘 종가'라 화면의
        //    등락율(전일 대비)과 짝이 맞지 않는다. 등락률이 소수 2자리로 반올림돼 오므로 근사값(approx).
        const prevClose = (price > 0 && rate != null && rate > -100) ? price / (1 + rate / 100) : NaN;
        const hasPrev = Number.isFinite(prevClose) && prevClose > 0;
        // 인트라데이가 있을 때만 보정 — 없으면 [전일종가, 현재가] 2점 직선이 '장중 흐름'인 척한다.
        if (intra.length >= 2 && hasPrev) points = [prevClose, ...intra, price];
        out[s.code] = {
          points, rate, live: true, loaded: true, from: null, to: null,
          // 기준가 = 옆 칸 등락율의 **분모 그 자체**. rate와 같은 계산에서 나온 값만 싣는다
          // (화면에서 따로 구하면 등락율과 갈린다 — 단일 소스 규약).
          // ⚠️ 1일만 **단방향**이다(base 있으면 rate도 있음, 역은 아님): 현재가 0 · 등락률 ≤ -100%인
          //    손상 데이터는 전일 종가를 역산할 수 없어 base만 null이 된다. 그때 '전일 ≈ 0'을 찍는 것이
          //    더 나쁜 거짓 단언이므로 null 계약이 우선한다 — 억지로 채워 넣지 말 것.
          base: hasPrev ? { date: null, price: roundToMarket(s.market, prevClose), approx: true } : null,
        };
        continue;
      }
      // 구간 자르기·등락율은 watchlistChart의 공용 함수 — 종목 차트 창이 **같은 함수**로 '기간 수익률'을 내므로
      // 팝업 등락율과 차트 창 숫자가 같은 기간에서 한 글자도 다르지 않다(손복제 금지).
      // - 직접 선택: 시작일 미지정이면 구간 없음(null 계약), 종료일을 비우면 마지막 점 = 실시간 현재가.
      const { win, liveTail } = watchPeriodWindow(dailyMap[s.code], {
        period, cutoff: cut, customStart, customEnd, livePrice: q ? Number(q.price) : 0, today: todayKST(),
      });
      // ⚠️ 등락율과 기준가는 **같은 게이트**를 쓴다(windowRate가 rate를 낸 경우에만 base) — 갈리면 화면에
      //    분모 없는 %(또는 %없는 분모)가 떠서 사용자가 검산할 수 없다(이 두 번째 줄의 존재 이유가 검산이다).
      const { rate, first, last } = windowRate(win);
      const ok = rate != null;
      out[s.code] = {
        points: win.map(([, c]) => c),
        // 2점 미만이면 '데이터 부족' → null. 0.00%로 단언하지 않는다(변동 없음과 구분 불가해짐).
        rate,
        from: first || null,
        to: last || null,
        // 기준가 = 등락율의 분모(구간 첫 종가)와 **같은 값**. 화면의 %를 그대로 검산할 수 있다.
        // ⚠️ '정확히 N일 전 날짜의 종가'로 되돌리지 말 것 — 휴장·상장일 때문에 분모와 달라져 검산이 안 맞는다.
        //    실제 기준일을 그대로 노출하는 것이 그 어긋남을 사용자에게 알리는 방법이다.
        base: ok ? { date: first[0], price: first[1], approx: false } : null,
        live: false,
        liveTail,                            // 직접 선택 + 종료일 비움 → 마지막 점이 실시간 현재가
        loaded: s.code in dailyMap,          // 조회 완료(실패 포함) 여부 — '조회 중'과 '데이터 부족'을 구분
        hasDaily: Array.isArray(dailyMap[s.code]), // 이력을 실제로 받았는가 — '조회 실패'와 '구간 종가 부족'을 구분
      };
    }
    return out;
  }, [activeStocks, quotes, dailyMap, intradayMap, period, customStart, customEnd]);

  // 화면 문구용 기간 이름 — 직접 선택이면 실제 구간을 쓴다(연도 포함 YY/MM/DD).
  const periodLabel = period === CUSTOM
    ? (customStart ? `${fmtBaseDate(customStart)}~${customEnd ? fmtBaseDate(customEnd) : '현재'}` : '직접 선택(시작일 미지정)')
    : period;
  // 헤더 아랫줄은 폭이 좁아(w-16) 월/일만 — 전체 구간은 툴팁(periodLabel)에 있다.
  const periodShort = period === CUSTOM
    ? (customStart ? `${customStart.slice(5).replace('-', '/')}~${customEnd ? customEnd.slice(5).replace('-', '/') : '현재'}` : '직접')
    : period;

  // 등락율 셀 툴팁 — 이 숫자가 '무엇 대비 몇 %'인지(기준일·기준가 → 종점)를 그대로 밝힌다.
  const rateTitle = (s, v) => {
    if (!v) return '종목 상세 보기';
    if (v.live) return `1일 등락율 · 전일 종가 대비 실시간 — 클릭하면 종목 상세 보기`;
    // ⚠️ null 사유 3종을 뭉뚱그리지 말 것 — '조회 중'과 '조회 실패'는 사용자가 할 일이 다르다.
    if (v.rate == null) {
      const why = !v.loaded ? '종가 이력 조회 중'
        : !v.hasDaily ? '종가 이력을 받지 못함 — 현재가를 클릭하면 다시 조회합니다'
        : period === CUSTOM && !customStart ? '시작일을 선택하세요'
        : '이 구간에 종가가 1개뿐';
      return `${periodLabel} 등락율 · ${why} — 클릭하면 종목 상세 보기`;
    }
    return `${periodLabel} 등락율 · ${v.from[0]} ${fmtPrice(s.market, v.from[1])} → ${v.liveTail ? '현재가(실시간)' : v.to[0]} ${fmtPrice(s.market, v.to[1])} — 클릭하면 종목 상세 보기`;
  };

  // 현재가 셀 툴팁 — 아래 작은 줄(기준가)이 '무엇 대비'인지 밝히고 클릭 동작(새로고침)도 함께 안내한다.
  // ⚠️ 1일 기준가는 단언이 아니라 근사 표기(≈) — 등락률이 소수 2자리로 반올림돼 오므로 역산값이 원 종가와
  //    미세하게 다를 수 있다(LadderTradeModal '전일 종가 ≈' 선례와 같은 규약).
  const priceTitle = (s, v, q) => {
    const b = v?.base;
    if (!b) return REFRESH_HINT;
    const now = q ? fmtPrice(s.market, q.price) : '-';
    return b.approx
      ? `1일 등락율 기준가 · 전일 종가 ≈ ${fmtPrice(s.market, b.price)} → 현재가 ${now}\n(현재가와 등락률에서 역산한 추정값입니다)\n${REFRESH_HINT}`
      : period === CUSTOM
        ? `${periodLabel} 등락율 기준가 · ${b.date} 종가 ${fmtPrice(s.market, b.price)} → 현재가 ${now}\n(시작일이 휴장일이거나 상장 전이면 그 뒤 첫 거래일을 기준으로 합니다)\n${REFRESH_HINT}`
        : `${period} 등락율 기준가 · ${b.date} 종가 ${fmtPrice(s.market, b.price)} → 현재가 ${now}\n(휴장·상장일 때문에 정확히 ${period} 전이 아닐 수 있어 실제 기준일을 표시합니다)\n${REFRESH_HINT}`;
  };

  // 보유 종목 툴팁 — 계좌마다 수량·매입가·현재가 대비 수익률(포트폴리오 테이블 구매단가와 같은 값).
  // 국내 원화 매입가는 표처럼 원 단위로 반올림해 보인다(선 높이는 반올림 전 값).
  const fmtAvg = (market, v) => fmtPrice(market, market === 'kr' ? Math.round(v) : v);
  const fmtQty = (n) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 }).format(n);
  const holdTitle = (s, hold, q) => {
    const px = q ? Number(q.price) : 0;
    const lines = hold.map((h) => {
      const r = px > 0 ? ` · 현재가 대비 ${formatChangeRate((px / h.avg - 1) * 100)}` : '';
      return `${h.acct} · ${fmtQty(h.qty)}${s.market === 'fund' ? '좌' : '주'} · 매입가 ${fmtAvg(s.market, h.avg)}${r}`;
    });
    const sum = hold.length > 1 ? holdingAvg(hold) : null;
    return `보유 종목(포트폴리오 테이블)\n${lines.join('\n')}${sum ? `\n합산 매입가 ${fmtAvg(s.market, sum.avg)}` : ''}\n미니차트의 호박색 점선 = 매입가${hold.length > 1 ? '(합산)' : ''}`;
  };

  // 분배금 칸 표시 — 상태 6종(조회 중 · 최근 1회 · 연간 · 기록 없음 · 펀드 미지원 · 조회 실패)을 뭉뚱그리지 않는다.
  // ⚠️ 분배율 색은 빨강/파랑을 쓰지 않는다(옆 칸 등락율의 상승/하락 색과 혼동된다).
  const divView = (s) => {
    const key = s.code;
    const d = divMap[key];
    const nm = quotes[key]?.name || s.name || s.code;
    const retry = '클릭하면 다시 조회';
    if (divLoading[key] || !(key in divMap)) return { line1: '…', line2: '', title: `${nm} — 분배금 조회 중`, muted: true };
    if (!d) return { line1: '-', line2: '조회 실패', title: `${nm} — 분배금을 불러오지 못했습니다. ${retry}`, muted: true, fail: true };
    if (d.status === 'unsupported') return { line1: '-', line2: '', title: `${nm} — 펀드는 분배 이력을 조회할 수 없습니다`, muted: true };
    if (d.status !== 'ok') return { line1: '없음', line2: '', title: `${nm} — 분배 기록이 없습니다. ${retry}`, muted: true };
    if (d.kind === 'annual') {
      return {
        line1: fmtDivAmount(s.market, d.amount),
        line2: `연 ${fmtDivRate(d.rate)}`,
        title: `${nm} — 연간 주당배당금 ${fmtDivAmount(s.market, d.amount)} · 배당수익률 ${fmtDivRate(d.rate)}\n(일반 주식은 회차별 분배 이력이 없어 네이버 종목 요약의 연간 값을 표시합니다)\n${retry}`,
      };
    }
    const basis = d.rateBasis === 'close'
      ? '분배율 = 그 회차 분배금 ÷ 배당락 직전 거래일 종가'
      : '분배율 = 그 회차 분배율(네이버 표기 — 배당락 무렵 주가 대비)';
    const recent = (d.recent || []).map((r) => `${fmtBaseDate(r.exDate)} ${fmtDivAmount(s.market, r.amount)} (${fmtDivRate(r.rate)})`).join(' · ');
    return {
      line1: fmtDivAmount(s.market, d.amount),
      line2: `${fmtDivRate(d.rate)} · ${fmtBaseDate(d.exDate)}`,
      title: `${nm} — 최근 분배(배당락 ${d.exDate}) 분배금 ${fmtDivAmount(s.market, d.amount)} · 분배율 ${fmtDivRate(d.rate)}\n${basis} · 연환산 아님\n최근 ${(d.recent || []).length}회: ${recent}\n${retry}`,
    };
  };

  // 정렬 적용된 표시 목록 (등락율 없는 종목은 원래순서로 뒤에)
  // ⚠️ 정렬 키는 화면에 보이는 기간 등락율(viewByCode.rate) — quotes.changeRate로 되돌리면 기간을 바꿨을 때
  //    보이는 숫자와 정렬 순서가 어긋난다.
  const sortedStocks = (() => {
    if (!sortDir || activeStocks.length < 2) return activeStocks;
    const scored = activeStocks.map((s, i) => ({ s, i, r: viewByCode[s.code]?.rate }));
    scored.sort((a, b) => {
      const ah = a.r == null, bh = b.r == null;
      if (ah && bh) return a.i - b.i;
      if (ah) return 1;
      if (bh) return -1;
      return sortDir === 'asc' ? a.r - b.r : b.r - a.r;
    });
    return scored.map((x) => x.s);
  })();

  // ───────── 종목 하이라이트 (행 왼쪽 끝 클릭 — 사용자 요청 2026-10) ─────────
  // 칠해 둔 종목이 기간·정렬을 바꿀 때 리스트 어디로 가는지 한눈에 찾게 한다. 칠할 때마다 다른 색이다.
  // ⚠️ 색 고르기·켜고 끄기는 watchlistGroups.ts(순수 모듈)가 정본 — 여기서 손복제하면 '다른 색' 규칙이 갈린다.
  // ⚠️ 쓰기는 updateGroups 단일 통로라 읽기 전용에서는 아무것도 쓰지 않는다(이미 칠한 색은 그대로 보인다).
  const nextHl = watchHighlightOf(nextWatchHighlight(activeStocks));
  const toggleHighlight = (stockId) => {
    if (!activeGroup) return;
    const gid = activeGroup.id;
    updateGroups((prev) => toggleWatchHighlight(prev, gid, stockId));
  };
  const clearHighlights = () => {
    if (!activeGroup) return;
    const gid = activeGroup.id;
    updateGroups((prev) => clearWatchHighlights(prev, gid));
  };
  // 위치 요약(칩) — 화면 순서(정렬 반영) 그대로라 칩의 순서가 곧 리스트 안 위치다.
  const highlighted = sortedStocks
    .map((s, i) => ({ s, i, c: watchHighlightOf(s.highlight) }))
    .filter((x) => x.c);
  // 칩을 누르면 그 행으로 — 리스트가 길면 칠한 종목이 화면 밖에 있을 수 있다.
  const scrollToStock = (id) => {
    const rows = listRef.current?.querySelectorAll('[data-watch-id]') || [];
    for (const el of rows) {
      if (el.getAttribute('data-watch-id') === id) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break; }
    }
  };

  // ───────── 순서 드래그 (원래순서 모드 + 수동 그룹 전용) ─────────
  // 정렬 중(sortDir≠null)이거나 '최근조회' 자동 그룹에선 비활성 — 보이는 순서=저장 순서일 때만 이동 허용.
  const isAutoGroup = isAutoGroupOf(activeGroup);
  const canReorder = !readOnly && !!activeGroup && !isAutoGroup && sortDir === null && activeStocks.length >= 2;
  // 포인터 Y로 삽입 슬롯(0..N) 계산 — 리스트는 드래그 중 재배열하지 않아 geometry가 안정적(깜빡임 없음).
  const computeDropIndex = (clientY) => {
    const rows = listRef.current?.querySelectorAll('[data-watch-row]');
    if (!rows || !rows.length) return 0;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return rows.length;
  };
  const onGripPointerDown = (e, stock) => {
    if (!canReorder) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    setDragId(stock.id);
    setDragOverIndex(activeStocks.findIndex((s) => s.id === stock.id));
  };
  const onGripPointerMove = (e) => {
    if (dragId == null) return;
    const idx = computeDropIndex(e.clientY);
    setDragOverIndex((prev) => (prev === idx ? prev : idx));
  };
  const commitReorder = () => {
    const id = dragId, to = dragOverIndex;
    setDragId(null);
    setDragOverIndex(null);
    if (id == null || to == null || !activeGroup) return;
    const from = (activeGroup.stocks || []).findIndex((s) => s.id === id);
    if (from < 0) return;
    const insertAt = to > from ? to - 1 : to;      // splice로 앞에서 하나 제거되므로 뒤로 갈 땐 -1
    if (insertAt === from) return;                 // 순서 변화 없음 → setState 자체를 생략(불필요 렌더 방지)
    updateGroups((prev) => (Array.isArray(prev) ? prev : []).map((g) => {
      if (g.id !== activeGroup.id) return g;
      const arr = [...(g.stocks || [])];
      if (from >= arr.length || arr[from]?.id !== id) return g;  // prev 스냅샷 불일치 방어
      const [item] = arr.splice(from, 1);
      arr.splice(insertAt, 0, item);
      return { ...g, stocks: arr };
    }));
  };
  const cancelReorder = () => { setDragId(null); setDragOverIndex(null); };

  // ───────── 그룹 순서 드래그 (수동 그룹 전용) ─────────
  // ⚠️ '최근조회'(auto)는 **드래그 대상도 아니고 자리도 고정**이다 — `recordRecent`가 그 그룹을 항상
  //    배열 맨 앞으로 다시 붙이므로(`[{최근조회}, ...others]`), 그 위로 끌어 놓아도 등락율을 한 번만
  //    클릭하면 순서가 조용히 원복된다(사용자에겐 '드래그가 안 먹는' 것으로 보인다).
  //    대신 recordRecent가 `others`의 순서는 그대로 보존하므로 수동 그룹끼리의 재정렬은 안전하다.
  // ⚠️ 순서는 `watchlistGroups` **배열 자체를 재정렬**한다 → 기존 지문(portfolioStructureKey의
  //    JSON.stringify)이 그대로 잡아 Drive 저장이 자동 트리거된다. `order` 필드를 새로 만들지 말 것
  //    (정규화·지문·복원 등록 지점이 늘고 하나만 빠지면 조용히 유실된다 — 종목 순서 드래그와 같은 규약).
  const manualIds = manualWatchGroupIds(list);
  const canReorderGroups = !readOnly && manualIds.length >= 2;
  // 포인터 Y로 삽입 슬롯(0..N) 계산 — **수동 그룹 행만** 센다(자동 그룹은 data 속성을 달지 않는다).
  const computeGroupDropIndex = (clientY) => {
    const rows = sidebarListRef.current?.querySelectorAll('[data-watch-group]');
    if (!rows || !rows.length) return 0;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return rows.length;
  };
  const onGroupGripPointerDown = (e, g) => {
    if (!canReorderGroups) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    setGDragId(g.id);
    setGDragOverIndex(manualIds.indexOf(g.id));
  };
  const onGroupGripPointerMove = (e) => {
    if (gDragId == null) return;
    const idx = computeGroupDropIndex(e.clientY);
    setGDragOverIndex((prev) => (prev === idx ? prev : idx));
  };
  const commitGroupReorder = () => {
    const id = gDragId, to = gDragOverIndex;
    setGDragId(null);
    setGDragOverIndex(null);
    if (id == null || to == null) return;
    // 산술은 `watchlistGroups.ts`가 정본(자동 그룹 자리 고정 · 변화 없으면 같은 참조).
    updateGroups((prev) => reorderManualWatchGroups(Array.isArray(prev) ? prev : [], id, to));
  };
  const cancelGroupReorder = () => { setGDragId(null); setGDragOverIndex(null); };

  if (!open) return null;

  const sidebarInput = 'w-full bg-gray-900 border border-amber-500/50 rounded px-2 py-1 text-xs text-white outline-none';

  // 표시 크기 — 끄는 중이면 그 값, 아니면 저장값(없으면 기본). 끄지 않는 축은 저장값(자동이면 내용에 맞춤).
  // ⚠️ CSS 상한(maxWidth/maxHeight)은 `resizeWatchRect`의 화면 여백과 같은 값이다 — 다르면 놓는 순간 크기가 튄다.
  const liveV = !!liveRect && /[ns]/.test(liveRect.dir);
  // 기본 폭(저장값 없음)은 분배금 열을 펼치면 그 폭만큼 넓어진다 — 종목명 칸 폭(PANEL_W의 존재 이유)을 지킨다.
  const dispW = liveRect ? liveRect.w : Math.max(minW, curSize?.w ?? PANEL_W + divExtraW);
  const dispH = liveV ? liveRect.h : (curSize?.h ?? null);
  const panelLeft = liveRect ? liveRect.x : pos.x;
  const panelTop = liveRect ? liveRect.y : pos.y;

  const panel = (
    <div
      ref={rootRef}
      style={isPage
        ? { position: 'fixed', inset: 0 }
        : (dispH != null
          ? { width: '100%', height: dispH, maxHeight: 'calc(100vh - 10px)' }
          : { width: '100%', maxHeight: '82vh' })}
      className={isPage
        ? 'bg-[#0b1120] flex flex-col'
        : `rounded-2xl shadow-2xl overflow-hidden border border-gray-600/60 bg-[#0b1120] flex flex-col ${liveRect ? 'select-none' : ''}`}
    >
      {/* 타이틀 바 — 팝업 모드에서만 드래그 핸들(별도 창은 브라우저가 창을 옮긴다) */}
      <div
        className={`flex items-center justify-between bg-gray-900 px-3 py-2 border-b border-gray-700/40 select-none ${isPage ? '' : 'cursor-move'}`}
        style={isPage ? undefined : { touchAction: 'none' }}
        onMouseDown={isPage ? undefined : (e) => { onDragStart(e.clientX, e.clientY); e.preventDefault(); }}
        onTouchStart={isPage ? undefined : (e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
      >
        <span className="text-gray-200 text-sm font-semibold flex items-center gap-1.5 min-w-0">
          <Star size={14} className="text-amber-400 shrink-0" />
          <span className="shrink-0">관심종목</span>
          {/* 사이드바를 접으면 어느 그룹을 보고 있는지 화면에서 사라지므로 제목에 함께 둔다 */}
          {activeGroup && (
            <span className="text-gray-500 font-normal text-xs truncate" title={activeGroup.name}>· {activeGroup.name}</span>
          )}
        </span>
        <span className="flex items-center gap-0.5 shrink-0">
          {/* 별도 브라우저 창으로 확장 — 클릭 제스처 직후 **동기** window.open이라야 팝업 차단을 피한다.
              ⚠️ onMouseDown stopPropagation 필수: 타이틀 바가 드래그 핸들이라 안 막으면 버튼을 누르는
                 순간 패널 드래그가 함께 시작된다(CalendarModal 선례). 창 자신에는 렌더하지 않는다. */}
          {onOpenWindow && !isPage && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onOpenWindow}
              title="별도 창으로 열기"
              className="text-gray-500 hover:text-sky-300 p-1 rounded transition-colors"
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button onClick={onClose} title="닫기" className="text-gray-400 hover:text-white p-1 rounded transition-colors">
            <X size={14} />
          </button>
        </span>
      </div>

      {/* 연결 끊김·읽기 전용 안내 — z-1050 팝업/별도 창이라 토스트·ConfirmDialog가 가려진다.
          ⚠️ 인라인이 유일한 피드백 경로다(알림 최소화 정책상 notify()도 쓰지 않는다). */}
      {notice && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
          {notice}
        </div>
      )}
      {chartBlocked && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
          <span className="flex-1">팝업이 차단돼 차트 창을 열지 못했습니다 — 주소창에서 팝업을 허용한 뒤 미니차트를 다시 누르세요.</span>
          <button onClick={() => setChartBlocked(false)} title="닫기" className="shrink-0 text-amber-300/70 hover:text-amber-100"><X size={12} /></button>
        </div>
      )}

      {/* 좌우 2단 — 좌: 그룹 사이드바 / 우: 종목 리스트.
          ⚠️ 옛 구조는 그룹을 **가로 스크롤 칩 한 줄**로 늘어놓아, 그룹이 늘수록 어떤 그룹이 있는지
             한눈에 안 보이고 끝 그룹은 스크롤해야 닿았다(활성 칩의 ✏️/🗑도 그 스크롤을 따라다녔다).
             세로 목록은 30개(MAX_GROUPS)까지 자연스러운 세로 스크롤로 받아낸다 — 가로 스크롤 칩 행으로
             되돌리지 말 것(사용자 요청 2026-09). */}
      <div className="flex-1 flex min-h-0">
        {sidebarOpen ? (
        <aside className="shrink-0 flex flex-col border-r border-gray-800/70 bg-gray-900/30" style={{ width: SIDEBAR_W }}>
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-800/70 shrink-0">
            <span className="text-[10px] font-medium text-gray-500">관심 그룹</span>
            <button onClick={() => setSidebarOpen(false)} title="그룹 목록 접기" className="p-0.5 text-gray-600 hover:text-amber-300 transition-colors">
              <PanelLeftClose size={12} />
            </button>
          </div>
          <div ref={sidebarListRef} className={`flex-1 overflow-y-auto py-1 ${gDragId != null ? 'select-none' : ''}`}>
        {list.map((g) => {
          const isActive = activeGroup?.id === g.id;
          const isAuto = isAutoGroupOf(g);
          if (!isAuto && editingId === g.id) {
            return (
              <div key={g.id} className="px-1.5 py-0.5">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') renameGroup(g.id); else if (e.key === 'Escape') setEditingId(null); }}
                  onBlur={() => renameGroup(g.id)}
                  className={sidebarInput}
                  maxLength={20}
                />
              </div>
            );
          }
          if (!isAuto && confirmDelId === g.id) {
            return (
              <div key={g.id} className="px-1.5 py-0.5">
                {/* z-1050 팝업이라 ConfirmDialog·토스트가 가려진다 → 인라인 2단계 확인(기존 규약 유지).
                    세로 목록에서는 어느 그룹을 지우는지 스스로 밝히도록 이름을 함께 보인다. */}
                <div className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-red-900/30 border border-red-600/50 text-red-300">
                  <span className="shrink-0 font-medium">삭제?</span>
                  <span className="flex-1 min-w-0 truncate" title={g.name}>{g.name}</span>
                  <button onClick={() => deleteGroup(g.id)} title="삭제 확인" className="shrink-0 hover:text-red-100"><Check size={12} /></button>
                  <button onClick={() => setConfirmDelId(null)} title="취소" className="shrink-0 hover:text-white"><X size={12} /></button>
                </div>
              </div>
            );
          }
          // 삽입 슬롯 표시는 **수동 그룹 인덱스** 기준(자동 그룹은 드래그 대상이 아니다)
          const mIdx = isAuto ? -1 : manualIds.indexOf(g.id);
          const gIsDragging = gDragId === g.id;
          const gDropTop = canReorderGroups && gDragId != null && !gIsDragging && mIdx >= 0 && gDragOverIndex === mIdx;
          const gDropBottom = canReorderGroups && gDragId != null && !gIsDragging && mIdx >= 0
            && mIdx === manualIds.length - 1 && gDragOverIndex === manualIds.length;
          return (
            <div
              key={g.id}
              data-watch-group={isAuto ? undefined : ''}
              className={`group flex items-center gap-1 pl-1.5 pr-1.5 py-1.5 text-xs border-l-2 transition-colors ${
                isActive
                  ? 'bg-amber-500/10 border-amber-400 text-amber-300'
                  : 'border-transparent text-gray-300 hover:bg-white/[0.04]'
              } ${gIsDragging ? 'opacity-40' : ''}`}
              style={{ boxShadow: gDropTop ? 'inset 0 2px 0 0 #fbbf24' : gDropBottom ? 'inset 0 -2px 0 0 #fbbf24' : undefined }}
            >
              {canReorderGroups && (isAuto ? (
                // 자동 그룹은 자리만 맞춘다(맨 위 고정 — 드래그 대상 아님)
                <span className="w-3.5 shrink-0" />
              ) : (
                <button
                  onPointerDown={(e) => onGroupGripPointerDown(e, g)}
                  onPointerMove={onGroupGripPointerMove}
                  onPointerUp={commitGroupReorder}
                  onPointerCancel={cancelGroupReorder}
                  onLostPointerCapture={cancelGroupReorder}
                  title="드래그하여 그룹 순서 이동"
                  className="w-3.5 shrink-0 flex items-center justify-center text-gray-700 hover:text-amber-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                  style={{ touchAction: 'none' }}
                >
                  <GripVertical size={12} />
                </button>
              ))}
              <button
                onClick={() => setActiveGroupId(g.id)}
                onDoubleClick={() => { if (!isAuto && !readOnly) { setEditingId(g.id); setEditName(g.name); } }}
                className="flex-1 min-w-0 flex items-center gap-1 text-left"
                title={isAuto ? g.name : `${g.name} — 더블클릭하면 이름 변경`}
              >
                {isAuto && <Clock size={11} className="shrink-0" />}
                <span className="truncate font-medium">{g.name}</span>
              </button>
              <span className="shrink-0 text-[9px] text-gray-600 tabular-nums">{(g.stocks || []).length}</span>
              {/* 세로 목록에서는 ✏️/🗑을 **행 hover**로 낸다 — 옛 칩 행은 활성 칩에만 달려 있어
                  가로 스크롤 끝까지 따라다녔다. 자동 그룹('최근조회')은 이름 변경·삭제 대상이 아니다. */}
              {!isAuto && !readOnly && (
                <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingId(g.id); setEditName(g.name); }} title="이름 변경" className="text-gray-500 hover:text-amber-300">
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => setConfirmDelId(g.id)} title="그룹 삭제" className="text-gray-500 hover:text-red-300">
                    <Trash2 size={11} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
        {!readOnly && (creating ? (
          <div className="px-1.5 py-0.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); else if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
              onBlur={addGroup}
              placeholder="그룹 이름"
              className={sidebarInput}
              maxLength={20}
            />
          </div>
        ) : (
          <div className="px-1.5 py-0.5">
            <button
              onClick={() => setCreating(true)}
              title="관심 그룹 추가"
              className="w-full flex items-center justify-center gap-0.5 rounded px-2 py-1 text-xs bg-gray-800/60 border border-dashed border-gray-600 text-gray-400 hover:text-amber-300 hover:border-amber-500/50 transition-colors"
            >
              <Plus size={12} /> 그룹
            </button>
          </div>
        ))}
          </div>
        </aside>
        ) : (
          /* 접힌 사이드바 — 펼치기 버튼만 남긴다(유일한 복귀 경로라 반드시 렌더할 것) */
          <div className="shrink-0 flex flex-col items-center px-1 pt-2 border-r border-gray-800/70">
            <button onClick={() => setSidebarOpen(true)} title="그룹 목록 펼치기" className="p-1 text-gray-600 hover:text-amber-300 transition-colors">
              <PanelLeft size={13} />
            </button>
          </div>
        )}

        {/* 종목 리스트 */}
        <div className="flex-1 min-w-0 overflow-y-auto px-3 py-3" style={{ touchAction: 'auto' }}>
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center gap-2 py-8">
            <Star size={28} className="text-gray-600" />
            {/* ⚠️ 읽기 전용(별도 창의 로드 대기·연결 끊김)에서 '만들어 보세요'라고 하면 안 된다 —
                "아직 안 불러왔다"와 "저장된 게 없다"를 구분하지 못한 채 새로 만들게 유도하고,
                그 입력이 정확히 저장된 관심종목을 덮는 경로다(가계부 2026-08-30 선례). */}
            <p className="text-gray-400 text-sm font-medium">
              {readOnly ? '표시할 관심 그룹이 없습니다' : '관심 그룹을 만들어 종목을 모아 보세요'}
            </p>
            {/* ⚠️ 이름 입력창은 사이드바 안에 있다 — 접힌 상태로 두면 눌러도 아무 일도 안 일어난 것처럼 보인다 */}
            {!readOnly && (
            <button
              onClick={() => { setSidebarOpen(true); setCreating(true); }}
              className="mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors"
            >
              <Plus size={13} /> 그룹 추가
            </button>
            )}
          </div>
        ) : activeGroup ? (
          <>
            {/* 코드 입력 (최근조회 자동 그룹은 입력창 대신 안내) */}
            {readOnly ? null : isAutoGroup ? (
              <div className="flex items-center gap-1 mb-2 text-[11px] text-gray-500">
                <Clock size={11} className="shrink-0" /> 등락율을 클릭해 상세페이지를 연 종목이 자동으로 기록됩니다.
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mb-2">
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addStock(); }}
                  placeholder="종목 코드 (예: 005930, AAPL, MA:...)"
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-amber-500/50 placeholder:text-gray-600"
                />
                <button
                  onClick={addStock}
                  className="shrink-0 rounded px-3 py-1.5 text-xs font-medium bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors"
                >
                  추가
                </button>
              </div>
            )}

            {/* 기간 토글 — 미니차트와 등락율이 함께 이 기간을 따른다 */}
            <div className="flex items-center gap-1 mb-2">
              {PERIODS.map((pd) => (
                <button
                  key={pd}
                  onClick={() => patchView({ period: pd })}
                  title={pd === '1일'
                    ? '1일 — 미니차트는 장중 흐름(전일 종가 기준선 포함), 등락율·기준가는 전일 종가 대비 실시간'
                    : `${pd} — 미니차트·등락율·현재가 아래 기준가 모두 이 기간 기준`}
                  className={`flex-1 rounded px-1 py-1 text-[11px] font-medium border transition-colors ${
                    period === pd
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'border-gray-700 text-gray-400 hover:text-amber-300'
                  }`}
                >
                  {pd}
                </button>
              ))}
              <button
                onClick={() => {
                  // 처음 열면 시작일을 1개월 전으로 채워 곧바로 결과가 보이게 한다(바꿀 수 있다)
                  patchView((v) => ({ period: CUSTOM, customStart: v.customStart || cutoffFor('1개월') }));
                }}
                title="기간 직접 선택 — 시작일·종료일을 달력에서 고릅니다(종료일을 비우면 현재까지 실시간)"
                className={`flex-1 inline-flex items-center justify-center gap-1 rounded px-1 py-1 text-[11px] font-medium border transition-colors ${
                  period === CUSTOM
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                    : 'border-gray-700 text-gray-400 hover:text-amber-300'
                }`}
              >
                <Calendar size={11} /> 기간
              </button>
            </div>
            {period === CUSTOM && (
              <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
                <div className="flex items-center gap-1 text-[11px] text-gray-300">
                  <span className="text-gray-500 mr-1">시작</span>
                  <CustomDatePicker
                    value={customStart}
                    zIndex={PICKER_Z}
                    followScroll
                    onChange={(v) => {
                      // 종료일이 시작일보다 앞이면 비운다
                      patchView((cur) => ({ customStart: v, customEnd: cur.customEnd && v > cur.customEnd ? '' : cur.customEnd }));
                    }}
                  />
                  <span className="text-gray-500 mx-1">~</span>
                  <span className="text-gray-500 mr-1">종료</span>
                  <CustomDatePicker
                    value={customEnd}
                    placeholder="현재"
                    zIndex={PICKER_Z}
                    followScroll
                    onChange={(v) => {
                      if (customStart && v < customStart) { patchView({ customEnd: customStart }); return; }
                      patchView({ customEnd: v >= todayKST() ? '' : v }); // 오늘 이후는 '현재까지'와 같다
                    }}
                  />
                  {customEnd && (
                    <button
                      onClick={() => patchView({ customEnd: '' })}
                      className="text-gray-500 hover:text-red-400 p-0.5 transition-colors"
                      title="종료일 비우기 — 현재까지 실시간으로 조회"
                    ><X size={10} /></button>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-gray-500">
                  {customStart
                    ? (customEnd ? '선택한 종료일 종가까지의 등락율입니다.' : '종료일을 비우면 현재까지 — 마지막 값은 실시간 현재가입니다.')
                    : '시작일을 선택하세요.'}
                </div>
              </div>
            )}

            {/* 하이라이트 위치 요약 — 칩 순서 = 리스트 안 순서. 등락율로 정렬 중이면 순위(N/M)도 함께 */}
            {highlighted.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mb-2 text-[11px]">
                <span className="text-gray-500 mr-0.5">하이라이트</span>
                {highlighted.map(({ s, i, c }) => {
                  const r = viewByCode[s.code]?.rate;
                  const nm = quotes[s.code]?.name || s.name || s.code;
                  return (
                    <button
                      key={s.id}
                      onClick={() => scrollToStock(s.id)}
                      title={`${nm} — ${sortDir ? `${periodLabel} 등락율 ${i + 1}위 / ${sortedStocks.length}종목` : `리스트 ${i + 1}번째`} · 클릭하면 그 행으로 이동`}
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 hover:brightness-125 transition"
                      style={{ borderColor: `${c.hex}80`, backgroundColor: `${c.hex}1f` }}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.hex }} />
                      <span className="max-w-[110px] truncate text-gray-200">{nm}</span>
                      {sortDir && <span className="text-gray-400 tabular-nums">{i + 1}/{sortedStocks.length}</span>}
                      {r != null && <span className={`tabular-nums ${rateColor(r)}`}>{formatChangeRate(r)}</span>}
                    </button>
                  );
                })}
                {!readOnly && (
                  <button onClick={clearHighlights} title="이 그룹의 하이라이트를 모두 지웁니다" className="ml-1 text-gray-500 hover:text-red-400 transition-colors">
                    모두 해제
                  </button>
                )}
              </div>
            )}

            {/* 종목 리스트 */}
            {activeStocks.length === 0 ? (
              <div className="text-center text-gray-600 text-xs py-8">코드를 입력해 종목을 추가하세요.</div>
            ) : (
              <div className={`flex flex-col ${dragId != null ? 'select-none' : ''}`} ref={listRef}>
                {/* 열 헤더 — 등락율 클릭 = 정렬 토글(2개 이상일 때 의미), 분배 = 분배금 열 펼치기/접기.
                    분배금 열 토글이 여기 있으므로 종목이 1개여도 헤더를 그린다. */}
                {activeStocks.length >= 1 && (
                  <div className="flex items-center gap-2 pl-3 pr-1 py-1 border-b border-gray-700/60 text-[10px] text-gray-500 select-none">
                    {canReorder && <span className="w-4 shrink-0" />}
                    <span className="w-1.5 shrink-0" />
                    <span className="flex-1">종목</span>
                    <span className="w-14 shrink-0" />
                    {/* ⚠️ 헤더·행 모두 w-16 shrink-0 — 헤더만 2줄이 되면 min-content가 달라져 좁은 화면에서
                        축소 폭이 행과 갈리고 열이 어긋난다. 폭을 바꿀 땐 행의 등락율 셀도 같이 바꿀 것. */}
                    <button
                      onClick={cycleSort}
                      title={`${periodLabel} 등락율 정렬 — 클릭하여 내림/오름/원래순서`}
                      className="w-16 shrink-0 text-right cursor-pointer transition-colors hover:text-gray-300 leading-tight"
                    >
                      <span className="block">등락율</span>
                      <span className="block text-[9px] text-amber-400/70 whitespace-nowrap">{periodShort}</span>
                    </button>
                    {/* ⚠️ 헤더·행 모두 w-24 shrink-0 — 행이 2줄(현재가 + 기준가)이라 min-content가 헤더와
                        달라졌다. shrink를 허용하면 좁은 화면에서 두 칸이 서로 다른 폭으로 줄어 열이 어긋난다
                        (등락율 칸이 w-16 shrink-0인 것과 같은 이유). 폭을 바꿀 땐 행의 현재가 셀도 같이 바꿀 것. */}
                    <span className="w-24 shrink-0 text-right">현재가</span>
                    {/* 분배금·분배율 열 — 기본 숨김. 접힌 칸(DIV_TOGGLE_W)을 누르면 펼치고, 펼친 머리글을 누르면 접는다.
                        ⚠️ 행에도 **같은 폭**의 칸이 있어야 한다(현재가 열 정렬) — 폭은 상수에서만 읽는다. */}
                    {showDiv ? (
                      <button
                        onClick={toggleDiv}
                        title="분배금 열 접기 — 최근 1회 분배금과 그 회차 분배율(일반 주식은 연간 주당배당금·배당수익률)"
                        className="shrink-0 text-right cursor-pointer transition-colors hover:text-gray-300 leading-tight flex items-center justify-end gap-0.5"
                        style={{ width: DIV_COL_W }}
                      >
                        <ChevronRight size={10} className="text-gray-600 shrink-0" />
                        <span>
                          <span className="block">분배금</span>
                          <span className="block text-[9px] text-teal-400/70 whitespace-nowrap">분배율 · 배당락</span>
                        </span>
                      </button>
                    ) : (
                      <button
                        onClick={toggleDiv}
                        title="분배금·분배율 보기 — 가장 최근 분배일의 분배금과 분배율을 펼칩니다"
                        className="shrink-0 flex flex-col items-center justify-center leading-none text-gray-500 hover:text-teal-300 transition-colors cursor-pointer"
                        style={{ width: DIV_TOGGLE_W }}
                      >
                        <span className="text-[9px]">분배</span>
                        <ChevronLeft size={10} />
                      </button>
                    )}
                    <span className="w-3 shrink-0" />
                  </div>
                )}
                {sortedStocks.map((s, idx) => {
                  const q = quotes[s.code];
                  const v = viewByCode[s.code] || {};   // 차트·등락율·툴팁 공용(단일 소스)
                  const hold = holdingsFor(holdings, s.code, s.market);   // 포트폴리오 테이블에 있는 종목(계좌별)
                  const holdSum = holdingAvg(hold);
                  const st = status[s.code];
                  const isDragging = dragId === s.id;
                  const dropTop = canReorder && dragId != null && !isDragging && dragOverIndex === idx;
                  const dropBottom = canReorder && dragId != null && !isDragging && idx === sortedStocks.length - 1 && dragOverIndex === sortedStocks.length;
                  const hl = watchHighlightOf(s.highlight);
                  return (
                    <div
                      key={s.id}
                      data-watch-id={s.id}
                      className="relative group"
                      // 칠한 종목은 행 전체(조회 실패 줄 포함)를 그 색으로 옅게 — 정렬을 바꿔도 눈이 따라간다.
                      style={hl ? { backgroundColor: `${hl.hex}24` } : undefined}
                    >
                      {/* 하이라이트 띠 = 행 왼쪽 끝. 누르면 칠하고 다시 누르면 지운다(칠할 때마다 다른 색).
                          ⚠️ 행 안의 다른 칸(그립·등락율·현재가)과 겹치지 않게 왼쪽 여백(pl-3) 안에만 둔다. */}
                      {readOnly ? (
                        hl && <span className="absolute left-0 top-0 bottom-0 w-2.5" style={{ backgroundColor: hl.hex }} />
                      ) : (
                        <button
                          onClick={() => toggleHighlight(s.id)}
                          aria-label={hl ? '하이라이트 해제' : '하이라이트'}
                          title={hl
                            ? `하이라이트(${hl.label}) — 다시 누르면 해제`
                            : `클릭하여 하이라이트${nextHl ? `(${nextHl.label})` : ''} — 기간·정렬을 바꿔도 이 색으로 위치를 찾을 수 있습니다`}
                          className={`absolute left-0 top-0 bottom-0 w-2.5 cursor-pointer transition-opacity ${hl ? '' : 'opacity-0 group-hover:opacity-30 hover:!opacity-70'}`}
                          style={{ backgroundColor: hl ? hl.hex : nextHl?.hex }}
                        />
                      )}
                      <div
                        data-watch-row
                        className={`flex items-center gap-2 pl-3 pr-1 py-1.5 border-b border-gray-800/50 hover:bg-white/[0.02] ${isDragging ? 'opacity-40' : ''}`}
                        style={{ boxShadow: dropTop ? 'inset 0 2px 0 0 #fbbf24' : dropBottom ? 'inset 0 -2px 0 0 #fbbf24' : undefined }}
                      >
                        {canReorder && (
                          <button
                            onPointerDown={(e) => onGripPointerDown(e, s)}
                            onPointerMove={onGripPointerMove}
                            onPointerUp={commitReorder}
                            onPointerCancel={cancelReorder}
                            onLostPointerCapture={cancelReorder}
                            title="드래그하여 순서 이동"
                            className="w-4 shrink-0 flex items-center justify-center text-gray-600 hover:text-amber-300 cursor-grab active:cursor-grabbing"
                            style={{ touchAction: 'none' }}
                          >
                            <GripVertical size={13} />
                          </button>
                        )}
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls(st)}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-gray-100 text-[13px] font-medium truncate" title={q?.name || s.name || s.code}>
                            {q?.name || s.name || s.code}
                          </div>
                          <div className="text-gray-500 text-[10px] flex items-center gap-1">
                            <span>{s.code}</span>
                            <span className="text-gray-600">· {MARKET_LABEL[s.market] || s.market}</span>
                            {holdSum && (
                              <span className="font-semibold cursor-help" style={{ color: HOLD_COLOR }} title={holdTitle(s, hold, q)}>
                                · 보유 {fmtAvg(s.market, holdSum.avg)}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* 미니차트 클릭 = 이 종목의 비교 차트를 별도 브라우저 창으로(시세 반영 수익률 차트) */}
                        <button
                          onClick={() => openChartWindow(s, q)}
                          title={`${q?.name || s.name || s.code} — 클릭하면 종목 비교 차트를 새 창으로 엽니다${holdSum ? `\n호박색 점선 = 보유 매입가 ${fmtAvg(s.market, holdSum.avg)}${hold.length > 1 ? `(${hold.length}개 계좌 합산)` : ''}` : ''}`}
                          className="shrink-0 rounded cursor-pointer hover:bg-white/[0.07] hover:ring-1 hover:ring-gray-600 transition"
                        >
                          <Sparkline points={v.points || []} rate={v.rate} avg={holdSum ? holdSum.avg : null} />
                        </button>
                        <button
                          onClick={() => viewStock(s, q)}
                          title={rateTitle(s, v)}
                          className={`w-16 shrink-0 text-right text-xs font-medium cursor-pointer hover:underline ${v.rate != null ? rateColor(v.rate) : 'text-gray-600'}`}
                        >
                          {v.rate != null
                            ? formatChangeRate(v.rate)
                            : (!v.loaded || st === 'loading') ? '…' : '-'}
                        </button>
                        <button
                          onClick={() => refreshRow(s)}
                          title={priceTitle(s, v, q)}
                          className="w-24 shrink-0 text-right leading-tight text-[13px] text-gray-200 tabular-nums cursor-pointer hover:text-teal-300 transition-colors"
                        >
                          <span className="flex items-center justify-end gap-1">
                            {st === 'loading' && <RefreshCw size={10} className="text-teal-400 animate-spin shrink-0" />}
                            <span>{q ? fmtPrice(s.market, q.price) : '-'}</span>
                          </span>
                          {/* 기준가 = 옆 칸 등락율의 분모(1주~1년은 구간 첫 종가 · 1일은 전일 종가).
                              ⚠️ 반드시 viewByCode.base만 읽을 것 — 여기서 따로 계산하면 등락율과 갈린다.
                              ⚠️ base가 null이면 줄 자체를 만들지 않는다(0이나 현재가로 대신 채우면 거짓 기준가). */}
                          {v.base && (
                            <span className="block text-[9px] text-gray-500 whitespace-nowrap">
                              {v.base.approx ? '전일 ≈' : `${fmtBaseDate(v.base.date)} ·`} {fmtPrice(s.market, v.base.price)}
                            </span>
                          )}
                        </button>
                        {/* 분배금·분배율 — 접혀 있으면 헤더와 같은 폭의 펼치기 칸, 펼치면 최근 1회 분배(클릭 = 다시 조회) */}
                        {showDiv ? (() => {
                          const dv = divView(s);
                          return (
                            <button
                              onClick={() => loadDividend(s, true)}
                              title={dv.title}
                              className="shrink-0 text-right leading-tight cursor-pointer hover:brightness-125 transition"
                              style={{ width: DIV_COL_W }}
                            >
                              <span className={`block text-[12px] tabular-nums whitespace-nowrap ${dv.muted ? 'text-gray-600' : 'text-gray-200'}`}>{dv.line1}</span>
                              {dv.line2 && (
                                <span className={`block text-[9px] tabular-nums whitespace-nowrap ${dv.fail ? 'text-red-400/80' : dv.muted ? 'text-gray-600' : 'text-teal-300/90'}`}>{dv.line2}</span>
                              )}
                            </button>
                          );
                        })() : (
                          <button
                            onClick={toggleDiv}
                            title="분배금·분배율 보기"
                            aria-label="분배금·분배율 보기"
                            className="shrink-0 self-stretch flex items-center justify-center text-gray-700 opacity-0 group-hover:opacity-100 hover:text-teal-300 transition"
                            style={{ width: DIV_TOGGLE_W }}
                          >
                            <ChevronLeft size={11} />
                          </button>
                        )}
                        {!readOnly && (
                          <button
                            onClick={() => removeStock(s.id)}
                            title="종목 삭제"
                            className="shrink-0 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      {st === 'fail' && (
                        <div className="flex items-center gap-1 px-3 pb-1.5 pt-0.5 text-[10px] text-red-400/80">
                          <span>{readOnly ? '조회 실패' : '조회 실패 — 시장 선택:'}</span>
                          {!readOnly && (['kr', 'us', 'fund']).map((m) => (
                            <button
                              key={m}
                              onClick={() => setStockMarket(s, m)}
                              className={`rounded px-1.5 py-0.5 border transition-colors ${
                                s.market === m
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                  : 'border-gray-700 text-gray-400 hover:text-amber-300'
                              }`}
                            >
                              {MARKET_LABEL[m]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
        </div>
      </div>
    </div>
  );

  // 별도 창은 브라우저가 창 크기를 정한다 — 손잡이 없이 패널만.
  if (isPage) return panel;

  // 인앱 팝업 — 래퍼(위치·폭)가 패널과 크기 조절 손잡이를 함께 담는다. 패널이 overflow-hidden이라
  // 테두리에 걸치는 손잡이는 그 바깥(래퍼)에 둬야 잘리지 않는다.
  return (
    <div style={{ position: 'fixed', left: panelLeft, top: panelTop, zIndex: WATCHLIST_Z, width: dispW, maxWidth: 'calc(100vw - 20px)' }}>
      {panel}
      {RESIZE_HANDLES.map((hd) => (
        <div
          key={hd.dir}
          onPointerDown={(e) => onResizeDown(e, hd.dir)}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={endResize}
          onDoubleClick={resetSize}
          title="끌어서 크기 조절 · 더블클릭하면 기본 크기로"
          style={{ position: 'absolute', zIndex: 2, cursor: hd.cursor, touchAction: 'none', ...hd.style }}
        />
      ))}
      {/* 오른쪽 아래 모서리 표시 — 크기를 바꿀 수 있다는 단서(클릭은 위 'se' 손잡이가 받는다) */}
      <svg
        width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
        style={{ position: 'absolute', right: 4, bottom: 4, pointerEvents: 'none', zIndex: 1 }}
        className="text-gray-500"
      >
        <path d="M9 2 L2 9 M9 6 L6 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
