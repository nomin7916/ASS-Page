// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Star, Plus, Pencil, Trash2, Check, RefreshCw, Clock, GripVertical, PanelLeft, PanelLeftClose, ExternalLink } from 'lucide-react';
import { generateId, formatNumber, formatFundPrice, formatChangeRate } from '../utils';
import { detectMarket, fetchWatchQuote, fetchWatchDaily, fetchWatchIntraday } from '../watchlistQuote';

// FloatingCalculator와 동일 규칙의 비차단·이동 가능 플로팅 패널.
// - 단일 position:fixed div (백드롭/오버레이 없음 → 아래 앱 클릭·스크롤 통과)
// - z 1050 (dialog 1000 < 여기 < LoadingOverlay 1100)
// - 타이틀 바만 드래그 핸들, window mousemove/touchmove 리스너로 이동, 뷰포트 클램프
const WATCHLIST_Z = 1050;
// 종목명 열은 고정폭 열(그립16+점6+미니차트56+등락율64+현재가96+삭제12+여백/gap 80 ≈ 330px)을 뺀 나머지라,
// 폭이 좁으면 국내 ETF 풀네임(예: "KODEX 금융고배당TOP10타겟위클리커버드콜")이 대부분 잘린다.
// 종목 리스트에 640px = 종목명 약 310px 확보 → 긴 ETF명도 한 줄에 그대로 보인다.
// ⚠️ PANEL_W = 640(리스트) + SIDEBAR_W(그룹 사이드바). 사이드바를 넣으면서 폭을 안 늘리면 종목명이
//    그만큼 쪼그라들어 위 640px의 존재 이유가 통째로 무너진다 — 둘은 한 세트다. (좁은 화면은 maxWidth로 클램프)
const SIDEBAR_W = 180;
const PANEL_W = 640 + SIDEBAR_W;
const MARKET_LABEL = { kr: '국내', us: '해외', fund: '펀드' };
const RECENT_ID = '__recent__';   // 자동 '최근조회' 그룹의 예약 id
const RECENT_NAME = '최근조회';
const RECENT_CAP = 20;            // 최근조회 보관 개수
const MAX_GROUPS = 30;           // 수동 그룹 소프트 상한(최근조회 제외)
const MAX_STOCKS = 100;          // 그룹당 종목 소프트 상한

// 그룹이 '자동 그룹(최근조회)'인가 — 이름 변경·삭제·순서 드래그의 공통 게이트.
// ⚠️ 이 판정을 손복제하지 말 것: recordRecent가 최근조회를 **항상 배열 맨 앞**에 다시 붙이므로
//    (`[{최근조회}, ...others]`) 한 곳이라도 게이트를 빠뜨리면 그 경로만 조용히 원복된다.
const isAutoGroupOf = (g) => !!g && (g.id === RECENT_ID || !!g.auto);

const fmtPrice = (market, price) => {
  if (market === 'us') return '$' + Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (market === 'fund') return formatFundPrice(price);
  return formatNumber(price);
};
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
// 일별 기간의 시작 컷오프 날짜(YYYY-MM-DD). '1일'은 인트라데이라 미사용.
// ⚠️ 반드시 KST 달력일에 앵커할 것. 과거엔 `new Date()`를 그대로 `toISOString()`(UTC)으로 잘라
//    KST 00:00~09:00에는 컷오프가 하루 앞당겨졌다 — 구간 첫 종가가 하루 더 이른 거래일이 되어
//    **같은 데이터인데 시각에 따라 등락율·정렬 순서·툴팁 기준일이 달라진다**(등락율이 이 창에서
//    파생되기 시작한 2026-08부터는 차트 외관이 아니라 화면 숫자가 흔들린다).
//    시프트도 UTC 메서드로 해야 뷰어 로컬 타임존이 결과를 흔들지 않는다.
const cutoffFor = (period) => {
  const [y, m, dd] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd));
  if (period === '1주') d.setUTCDate(d.getUTCDate() - 7);
  else if (period === '1개월') d.setUTCMonth(d.getUTCMonth() - 1);
  else if (period === '3개월') d.setUTCMonth(d.getUTCMonth() - 3);
  else if (period === '1년') d.setUTCFullYear(d.getUTCFullYear() - 1);
  else return '';
  return d.toISOString().split('T')[0];
};

// 등락율 클릭 시 여는 종목 상세페이지 URL (PortfolioTable과 동일 규칙)
const detailUrl = (market, code) => {
  if (market === 'fund') {
    return /^MA:/i.test(code)
      ? `https://investments.miraeasset.com/magi/fund/view.do?fundGb=2&fundCd=${code.replace(/^MA:/i, '')}`
      : `https://www.funetf.co.kr/product/fund/view/${code}`;
  }
  if (market === 'us') return `https://finance.yahoo.com/quote/${code.toUpperCase()}`;
  return `https://m.stock.naver.com/domestic/stock/${code.toUpperCase()}/total`;
};

// 최근 종가 미니 라인차트(인라인 SVG — 행마다 recharts 컨테이너를 쓰지 않아 가벼움).
// 상승 red / 하락 blue (한국식). 데이터 2점 미만이면 빈칸.
// ⚠️ 선 색은 옆 칸 등락율과 **같은 값**(rate)으로 칠한다 — 점 비교로 되돌리면 등락률이 정확히 0이거나
//    1일 탭(전일 종가 대비 실시간)에서 "선은 빨강인데 숫자는 파랑"이 다시 난다. rate 미제공 시에만 점 비교로 폴백.
function Sparkline({ points, rate, width = 56, height = 20 }) {
  if (!Array.isArray(points) || points.length < 2) return <div style={{ width, height }} className="shrink-0" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
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
  return (
    <svg width={width} height={height} className="shrink-0" style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function WatchlistPopup({
  open, onClose, groups = [], onUpdateGroups,
  // 'popup' = 인앱 플로팅 패널 / 'page' = 별도 브라우저 창(`/?watchlistWindow=1`).
  // ⚠️ 창용으로 화면을 복제하지 말 것 — 두 화면이 갈라진다(LedgerPage·CalendarModal과 같은 규약).
  variant = 'popup',
  readOnly = false,
  notice = '',
  onOpenWindow = null,
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
  const [period, setPeriod] = useState('1개월');       // 미니차트 기간
  const [sortDir, setSortDir] = useState(null);        // 등락율 정렬: null(원래순서)|'desc'|'asc'
  const [dragId, setDragId] = useState(null);          // 순서 드래그 중인 종목 id (원래순서 모드에서만)
  const [dragOverIndex, setDragOverIndex] = useState(null); // 삽입 슬롯 인덱스(0..N)
  const listRef = useRef(null);                        // 종목 리스트 컨테이너(행 geometry 측정)
  const loadedDailyRef = useRef(new Set());            // 일별 조회 완료/진행 코드:market
  const loadedIntradayRef = useRef(new Set());         // 인트라데이 조회 완료/진행 코드:market

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
      setPos({
        x: Math.max(10, Math.round((window.innerWidth - w) / 2)),
        y: Math.max(20, Math.round(window.innerHeight * 0.12)),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // ───────── 시세 조회 ─────────
  const loadQuote = async (stock) => {
    const key = stock.code;
    setStatus((p) => ({ ...p, [key]: 'loading' }));
    const d = await fetchWatchQuote(stock.market, stock.code);
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

  // 미니차트 일별 종가(~1년) — 팝업 로컬 dailyMap에만 저장(공유 stockHistoryMap 미접촉으로 보유종목 평가 불변식 보호)
  const loadDaily = async (stock) => {
    const key = stock.code + ':' + stock.market;
    if (loadedDailyRef.current.has(key)) return;
    loadedDailyRef.current.add(key);
    const pairs = await fetchWatchDaily(stock.market, stock.code);
    if (pairs && pairs.length >= 2) setDailyMap((p) => ({ ...p, [stock.code]: pairs }));
    else {
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

  // 한 행 통째 새로고침(현재가 셀 클릭) — 시세 + 일별 종가 + (1일 탭이면) 인트라데이.
  // ⚠️ 캐시 ref를 먼저 비우고 재조회하는 것이 핵심. 등락율이 기간 시계열에서 파생되면서
  //    "조회 한 번 실패하면 그 종목 등락율이 영영 '-'"(시장 보정 버튼은 시세 실패 때만 뜬다),
  //    "앱을 하루 이상 열어두면 현재가는 오늘인데 기간 등락율은 며칠 전까지만",
  //    "장 전에 받은 어제 분봉에 오늘 현재가가 붙는다" 세 경우의 유일한 탈출구가 됐다.
  const refreshRow = (stock) => {
    const key = stock.code + ':' + stock.market;
    loadQuote(stock);
    loadedDailyRef.current.delete(key);
    loadDaily(stock);
    if (period === '1일') {
      loadedIntradayRef.current.delete(key);
      loadIntraday(stock);
    }
  };

  // 팝업 열 때 + 그룹 전환 시 활성 그룹 종목만 조회(전체 그룹 동시 조회 금지)
  useEffect(() => {
    if (!open || !activeGroup) return;
    (activeGroup.stocks || []).forEach((s) => { loadQuote(s); loadDaily(s); });
  }, [open, activeGroup?.id]);

  // 기간이 '1일'이면(1일 상태로 열림/그룹전환/토글) 활성 그룹 인트라데이 조회
  useEffect(() => {
    if (!open || !activeGroup || period !== '1일') return;
    (activeGroup.stocks || []).forEach((s) => loadIntraday(s));
  }, [open, activeGroup?.id, period]);

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
    const code = codeInput.trim();
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
    loadDaily(stock);
    if (period === '1일') loadIntraday(stock);
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
    loadDaily({ ...stock, market });
    if (period === '1일') loadIntraday({ ...stock, market });
  };

  // 상세페이지를 연 종목을 '최근조회' 자동 그룹에 기록(최근 우선, 코드 dedup, RECENT_CAP 상한).
  const recordRecent = (stock) => {
    updateGroups((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      const entry = { id: generateId(), code: stock.code, market: stock.market, name: stock.name || '', addedAt: Date.now() };
      const recent = arr.find((g) => g.id === RECENT_ID);
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

  // 등락율 정렬 토글: 원래순서 → 내림차순 → 오름차순 → 원래순서
  const cycleSort = () => setSortDir((d) => (d === null ? 'desc' : d === 'desc' ? 'asc' : null));
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
      const daily = dailyMap[s.code] || [];
      const win = cut ? daily.filter(([dt]) => dt >= cut) : daily;
      const first = win[0];
      const last = win[win.length - 1];
      // ⚠️ 등락율과 기준가는 **같은 게이트**를 쓴다 — 갈리면 화면에 분모 없는 %(또는 %없는 분모)가 떠서
      //    사용자가 검산할 수 없다(이 두 번째 줄의 존재 이유가 검산이다).
      const ok = win.length >= 2 && first[1] > 0;
      out[s.code] = {
        points: win.map(([, c]) => c),
        // 2점 미만이면 '데이터 부족' → null. 0.00%로 단언하지 않는다(변동 없음과 구분 불가해짐).
        rate: ok ? (last[1] / first[1] - 1) * 100 : null,
        from: first || null,
        to: last || null,
        // 기준가 = 등락율의 분모(구간 첫 종가)와 **같은 값**. 화면의 %를 그대로 검산할 수 있다.
        // ⚠️ '정확히 N일 전 날짜의 종가'로 되돌리지 말 것 — 휴장·상장일 때문에 분모와 달라져 검산이 안 맞는다.
        //    실제 기준일을 그대로 노출하는 것이 그 어긋남을 사용자에게 알리는 방법이다.
        base: ok ? { date: first[0], price: first[1], approx: false } : null,
        live: false,
        loaded: s.code in dailyMap,          // 조회 완료(실패 포함) 여부 — '조회 중'과 '데이터 부족'을 구분
        hasDaily: Array.isArray(dailyMap[s.code]), // 이력을 실제로 받았는가 — '조회 실패'와 '구간 종가 부족'을 구분
      };
    }
    return out;
  }, [activeStocks, quotes, dailyMap, intradayMap, period]);

  // 등락율 셀 툴팁 — 이 숫자가 '무엇 대비 몇 %'인지(기준일·기준가 → 종점)를 그대로 밝힌다.
  const rateTitle = (s, v) => {
    if (!v) return '종목 상세 보기';
    if (v.live) return `1일 등락율 · 전일 종가 대비 실시간 — 클릭하면 종목 상세 보기`;
    // ⚠️ null 사유 3종을 뭉뚱그리지 말 것 — '조회 중'과 '조회 실패'는 사용자가 할 일이 다르다.
    if (v.rate == null) {
      const why = !v.loaded ? '종가 이력 조회 중'
        : !v.hasDaily ? '종가 이력을 받지 못함 — 현재가를 클릭하면 다시 조회합니다'
        : '이 구간에 종가가 1개뿐';
      return `${period} 등락율 · ${why} — 클릭하면 종목 상세 보기`;
    }
    return `${period} 등락율 · ${v.from[0]} ${fmtPrice(s.market, v.from[1])} → ${v.to[0]} ${fmtPrice(s.market, v.to[1])} — 클릭하면 종목 상세 보기`;
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
      : `${period} 등락율 기준가 · ${b.date} 종가 ${fmtPrice(s.market, b.price)} → 현재가 ${now}\n(휴장·상장일 때문에 정확히 ${period} 전이 아닐 수 있어 실제 기준일을 표시합니다)\n${REFRESH_HINT}`;
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
  const manualIds = list.filter((g) => !isAutoGroupOf(g)).map((g) => g.id);
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
    updateGroups((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      // 자동 그룹이 있던 인덱스는 **그대로 두고** 수동 그룹만 그 사이 슬롯에 다시 깐다
      // (최근조회가 맨 앞에 고정되는 것을 산술이 아니라 구조로 보장).
      const slots = [];
      const manual = [];
      arr.forEach((g, i) => { if (!isAutoGroupOf(g)) { slots.push(i); manual.push(g); } });
      const from = manual.findIndex((g) => g.id === id);
      if (from < 0) return arr;                       // prev 스냅샷 불일치 방어(같은 참조 = 저장 무트리거)
      const insertAt = to > from ? to - 1 : to;        // splice로 앞에서 하나 제거되므로 뒤로 갈 땐 -1
      if (insertAt === from || insertAt < 0 || insertAt >= manual.length) return arr;  // 순서 변화 없음
      const next = [...manual];
      const [item] = next.splice(from, 1);
      next.splice(insertAt, 0, item);
      const out = [...arr];
      slots.forEach((idx, k) => { out[idx] = next[k]; });
      return out;
    });
  };
  const cancelGroupReorder = () => { setGDragId(null); setGDragOverIndex(null); };

  if (!open) return null;

  const sidebarInput = 'w-full bg-gray-900 border border-amber-500/50 rounded px-2 py-1 text-xs text-white outline-none';

  return (
    <div
      ref={rootRef}
      style={isPage
        ? { position: 'fixed', inset: 0 }
        : { position: 'fixed', left: pos.x, top: pos.y, zIndex: WATCHLIST_Z, width: PANEL_W, maxWidth: 'calc(100vw - 20px)', maxHeight: '82vh' }}
      className={isPage
        ? 'bg-[#0b1120] flex flex-col'
        : 'rounded-2xl shadow-2xl overflow-hidden border border-gray-600/60 bg-[#0b1120] flex flex-col'}
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
                  onClick={() => setPeriod(pd)}
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
            </div>

            {/* 종목 리스트 */}
            {activeStocks.length === 0 ? (
              <div className="text-center text-gray-600 text-xs py-8">코드를 입력해 종목을 추가하세요.</div>
            ) : (
              <div className={`flex flex-col ${dragId != null ? 'select-none' : ''}`} ref={listRef}>
                {/* 정렬 헤더 (종목 2개 이상일 때 — 등락율 클릭으로 오름/내림 토글) */}
                {activeStocks.length >= 2 && (
                  <div className="flex items-center gap-2 px-1 py-1 border-b border-gray-700/60 text-[10px] text-gray-500 select-none">
                    {canReorder && <span className="w-4 shrink-0" />}
                    <span className="w-1.5 shrink-0" />
                    <span className="flex-1">종목</span>
                    <span className="w-14 shrink-0" />
                    {/* ⚠️ 헤더·행 모두 w-16 shrink-0 — 헤더만 2줄이 되면 min-content가 달라져 좁은 화면에서
                        축소 폭이 행과 갈리고 열이 어긋난다. 폭을 바꿀 땐 행의 등락율 셀도 같이 바꿀 것. */}
                    <button
                      onClick={cycleSort}
                      title={`${period} 등락율 정렬 — 클릭하여 내림/오름/원래순서`}
                      className="w-16 shrink-0 text-right cursor-pointer transition-colors hover:text-gray-300 leading-tight"
                    >
                      <span className="block">등락율</span>
                      <span className="block text-[9px] text-amber-400/70">{period}</span>
                    </button>
                    {/* ⚠️ 헤더·행 모두 w-24 shrink-0 — 행이 2줄(현재가 + 기준가)이라 min-content가 헤더와
                        달라졌다. shrink를 허용하면 좁은 화면에서 두 칸이 서로 다른 폭으로 줄어 열이 어긋난다
                        (등락율 칸이 w-16 shrink-0인 것과 같은 이유). 폭을 바꿀 땐 행의 현재가 셀도 같이 바꿀 것. */}
                    <span className="w-24 shrink-0 text-right">현재가</span>
                    <span className="w-3 shrink-0" />
                  </div>
                )}
                {sortedStocks.map((s, idx) => {
                  const q = quotes[s.code];
                  const v = viewByCode[s.code] || {};   // 차트·등락율·툴팁 공용(단일 소스)
                  const st = status[s.code];
                  const isDragging = dragId === s.id;
                  const dropTop = canReorder && dragId != null && !isDragging && dragOverIndex === idx;
                  const dropBottom = canReorder && dragId != null && !isDragging && idx === sortedStocks.length - 1 && dragOverIndex === sortedStocks.length;
                  return (
                    <div key={s.id}>
                      <div
                        data-watch-row
                        className={`flex items-center gap-2 px-1 py-1.5 border-b border-gray-800/50 hover:bg-white/[0.02] group ${isDragging ? 'opacity-40' : ''}`}
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
                          </div>
                        </div>
                        <Sparkline points={v.points || []} rate={v.rate} />
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
}
