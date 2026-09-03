// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolioData } from '../hooks/usePortfolioData';
import ErrorBoundary from './ErrorBoundary';
import ConfirmDialog from './ConfirmDialog';
import PortfolioSummaryPanel from './PortfolioSummaryPanel';
import RebalancingPanel from './RebalancingPanel';
import PortfolioStatsPanel from './PortfolioStatsPanel';
import HistoryPanel from './HistoryPanel';
import DepositPanel from './DepositPanel';
import DividendSummaryTable from './DividendSummaryTable';
import { CARD_LABELS, cardWindowTitle, isCardKey, isCardWindowSupported, baseKeyOf } from '../cardWindow';
import { buildRebalTargetEntryFrom, buildBookCostSeries, cleanNum, normalizeHistPeriod } from '../utils';

/**
 * 계좌 카드 **별도 브라우저 창** (`/?cardWindow=1&card=<키>&pid=<계좌id>`).
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다 — 절대 '앱 통째 부팅'으로 바꾸지 말 것.
 *    Drive STATE는 통째 덮어쓰기라 writer가 둘이면 서로의 편집을 지운다(메모 달력·흐름도·
 *    백테스트 창과 **완전히 같은 규약**). writer는 끝까지 앱 탭 하나다.
 *
 * ⚠️ 렌더는 인앱 카드와 **같은 컴포넌트**를 공유한다(PortfolioSummaryPanel·RebalancingPanel·
 *    DividendSummaryTable…). 창용으로 복제하면 두 화면이 갈린다.
 *
 * ⚠️ 파생(totals·rebalanceData·도넛)은 앱이 push하지 않고 **창이 usePortfolioData로 직접 계산**한다.
 *    파생값을 실어 보내면 페이로드가 커지는 것보다 나쁘게, 창 로컬 상태(정렬·'추가' 수량)를
 *    반영할 수 없어 화면과 계산이 갈린다.
 *
 * ⚠️ 쓰기는 전부 `card:cmd`(by-id 커맨드)로 앱 탭에 보낸다. 창이 배열을 통째로 돌려보내면
 *    그 사이 앱 탭이 쓴 시세·history·스냅샷이 되감긴다(복구 불가).
 *
 * ⚠️ 확인창·알림은 **창 안에서** 띄운다. App의 ConfirmDialog·알림 벨은 이 문서에 존재하지 않고,
 *    notify()는 애초에 토스트를 그리지 않는다(벨 로그만) → 프록시해도 피드백이 0이다.
 */

const PING_MS = 3000;
// ⚠️ 끊김 판정(LINK)이 커맨드 타임아웃(CMD)보다 **빨라야** 한다 — 반대면 '읽기 전용' 배지가 뜨기 전
//    12초 동안 UI가 편집을 정상처럼 받아들이고, 9초 뒤에야 실패 토스트만 뜬다.
const LINK_TIMEOUT_MS = 8000;
const CMD_TIMEOUT_MS = 9000;

const params = new URLSearchParams(window.location.search);
const CARD = params.get('card') || '';
const PID = params.get('pid') || '';
// 창 id는 (카드, 계좌) 조합 — window.open의 name과 1:1이라 같은 조합의 창은 하나뿐이다.
// 앱 탭이 새로고침돼도 같은 id로 재입양되므로 별도 난수가 필요 없다.
const WIN_ID = `${CARD}:${PID}`;

// ⚠️ settings 폴백은 **한 곳**에서만 만든다 — 계산(usePortfolioData)과 화면(RebalancingPanel)이
//    다른 기본값을 쓰면 settings가 없는 레거시 계좌에서 표의 투자선택과 수량 계산이 어긋난다.
const DEFAULT_SETTINGS = { mode: 'rebalance', amount: 1000000 };
const EMPTY_ACCOUNT = { id: PID, name: '', accountType: 'portfolio', portfolio: [], history: [], depositHistory: [], depositHistory2: [], settings: DEFAULT_SETTINGS };

export default function CardWindow() {
  const [account, setAccount] = useState(null);
  const [marketIndicators, setMarketIndicators] = useState({});
  const [marketHolidays, setMarketHolidays] = useState({ kr: [], us: [] });
  const [dividendTaxHistory, setDividendTaxHistory] = useState({});
  const [dividendLinks, setDividendLinks] = useState([]);
  const [stockFetchStatus, setStockFetchStatus] = useState({});
  const [stockHistoryMap, setStockHistoryMap] = useState({});
  const [indicatorHistoryMap, setIndicatorHistoryMap] = useState({});
  // ⚠️ 기록 확정일은 앱 탭이 계산해 보낸다 — 계좌 타입별(KR 21:00 / 글로벌 07:30) 경계를 창에서
  //    다시 계산하면 타이머·자정 경계에서 두 화면이 갈린다.
  const [effectiveDateKey, setEffectiveDateKey] = useState('');
  const [hideAmounts, setHideAmounts] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(null);
  const [gotData, setGotData] = useState(false);
  const [linked, setLinked] = useState(true);
  const [tornDown, setTornDown] = useState(false);

  // 창 로컬(앱과 공유하지 않는다 — 전부 세션 스크래치)
  const [rebalExtraQty, setRebalExtraQty] = useState({});
  // 평가액 추이 표 기간 단위 — **창 로컬**(rebalanceSortConfig와 같은 등급, 저장 지점 0곳).
  // 앱의 값은 card:data로 **1회만** 시드된다(아래 수신부). 창의 변경은 앱으로 역전파되지 않는다.
  const [histPeriod, setHistPeriod] = useState('day');
  const [rebalanceSortConfig, setRebalanceSortConfig] = useState({ key: null, direction: 1 });
  const [hoveredPortCatSlice, setHoveredPortCatSlice] = useState(null);
  const [hoveredPortStkSlice, setHoveredPortStkSlice] = useState(null);
  const [hoveredRebalCatSlice, setHoveredRebalCatSlice] = useState(null);
  const [hoveredCurCatSlice, setHoveredCurCatSlice] = useState(null);
  // PIN 인증은 창 세션 단위(앱 탭과 별개) — 검증 자체는 앱 탭에 위임한다.
  const [targetEditAuthorized, setTargetEditAuthorized] = useState(false);
  const [depositSortConfig, setDepositSortConfig] = useState({ key: null, direction: 1 });
  const [depositSortConfig2, setDepositSortConfig2] = useState({ key: null, direction: 1 });

  // 창 자체 알림/확인창 (INV-5)
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const toastSeq = useRef(0);

  const lastMsgRef = useRef(0);
  const gotDataRef = useRef(false);
  const authEpochRef = useRef(null);
  const reqSeq = useRef(0);
  const pendingRef = useRef(new Map());

  const validCard = isCardKey(CARD);

  const post = useCallback((msg) => {
    const op = window.opener;
    if (!op || op.closed) return false;
    try { op.postMessage(msg, window.location.origin); return true; } catch { return false; }
  }, []);

  const notify = useCallback((text, type = 'info') => {
    const id = ++toastSeq.current;
    setToasts(prev => [...prev.slice(-3), { id, text: String(text || ''), type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4200);
  }, []);

  // ⚠️ 창 안에서 resolve한다. App의 confirm은 App이 렌더하는 <ConfirmDialog>가 resolve하므로
  //    프록시가 원리적으로 불가능하고, 프록시해도 다이얼로그가 앱 탭에 떠서 보이지 않는다.
  const confirm = useCallback((message, confirmLabel = '확인') =>
    new Promise(resolve => setConfirmState({ message, confirmLabel, resolve })), []);
  const resolveConfirm = useCallback((r) => {
    setConfirmState(prev => { try { prev?.resolve?.(r); } catch { /* 무시 */ } return null; });
  }, []);

  // ── 커맨드 전송(요청/응답 상관) ─────────────────────────────────────────────
  // ⚠️ 응답이 필요한 op(저장 결과·PIN 검증·종가 재조회)는 반드시 await할 것. postMessage는
  //    fire-and-forget이라 반환값 계약을 그대로 쓰면 항상 undefined가 되어, 성공해도 실패로 표시된다.
  const send = useCallback((op, args) => new Promise(resolve => {
    const reqId = ++reqSeq.current;
    const done = (r) => { if (pendingRef.current.has(reqId)) { pendingRef.current.delete(reqId); resolve(r); } };
    pendingRef.current.set(reqId, done);
    if (!post({ type: 'card:cmd', winId: WIN_ID, reqId, op, args })) {
      done({ ok: false, reason: '앱 창과 연결이 끊겼습니다.' });
      return;
    }
    setTimeout(() => done({ ok: false, reason: '앱 창이 응답하지 않습니다.' }), CMD_TIMEOUT_MS);
  }), [post]);

  // 결과를 기다리지 않는 쓰기 — 실패만 인라인으로 알린다(성공은 화면 변화가 피드백).
  // ⚠️ INV-8은 **전송 단계에서** 막아야 실효가 있다 — 카드마다 입력을 잠그는 방식으로는 투자기록·
  //    settings·열 숨김·분배금 셀처럼 잠그지 못한 경로가 반드시 남고, 사용자는 한참 편집한 뒤에야
  //    실패를 안다. 여기 한 곳이 창의 모든 쓰기가 지나는 관문이다.
  const writableRef = useRef(false);
  const fire = useCallback((op, args) => {
    if (!writableRef.current) {
      notify('앱 창과 연결이 끊겨 저장할 수 없습니다. 앱 창을 다시 열면 이어집니다.', 'error');
      return;
    }
    send(op, args).then(r => { if (r && r.ok === false && r.reason) notify(r.reason, 'error'); });
  }, [send, notify]);

  useEffect(() => {
    document.title = validCard ? cardWindowTitle(account?.name, CARD) : '카드';
  }, [account?.name, validCard]);

  // ── 수신 ─────────────────────────────────────────────────────────────────
  // ⚠️ 접두사 검사(INV-6). 열거형으로 두면 새 메시지 타입을 빠뜨렸을 때 조용히 폐기된다.
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (window.opener && e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith('card:')) return;
      if (d.winId && d.winId !== WIN_ID) return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      if (d.type === 'card:teardown') {
        // 로그아웃·세션 충돌 — 이전 사용자의 금융 데이터를 화면에 남기지 않는다.
        pendingRef.current.forEach(fn => { try { fn({ ok: false, reason: '세션이 종료되었습니다.' }); } catch {} });
        pendingRef.current.clear();
        setAccount(null); setTornDown(true); setGotData(false); gotDataRef.current = false;
        try { window.close(); } catch { /* 브라우저가 막으면 안내만 남는다 */ }
        return;
      }
      if (d.type === 'card:ack') {
        const fn = pendingRef.current.get(d.reqId);
        if (fn) fn({ ok: !!d.ok, result: d.result, reason: d.reason });
        return;
      }
      if (d.type === 'card:data') {
        // ⚠️ authEpoch 불일치 = 다른 로그인 세션. 화면을 비운다(단순 readOnly로는 데이터가 남는다).
        if (authEpochRef.current != null && d.authEpoch != null && d.authEpoch !== authEpochRef.current) {
          setAccount(null); setTornDown(true); return;
        }
        if (d.authEpoch != null) { authEpochRef.current = d.authEpoch; setAuthEpoch(d.authEpoch); }
        if (d.account !== undefined) setAccount(d.account);
        if (d.marketIndicators) setMarketIndicators(d.marketIndicators);
        if (d.marketHolidays) setMarketHolidays(d.marketHolidays);
        if (d.dividendTaxHistory) setDividendTaxHistory(d.dividendTaxHistory);
        if (d.dividendLinks) setDividendLinks(d.dividendLinks);
        if (d.stockFetchStatus) setStockFetchStatus(d.stockFetchStatus);
        if (d.stockHistoryMap) setStockHistoryMap(d.stockHistoryMap);
        if (d.indicatorHistoryMap) setIndicatorHistoryMap(d.indicatorHistoryMap);
        if (d.effectiveDateKey !== undefined) setEffectiveDateKey(d.effectiveDateKey);
        if (d.hideAmounts !== undefined) setHideAmounts(!!d.hideAmounts);
        // ⚠️ **최초 1회만** 적용한다. card:data는 계좌 객체가 바뀔 때마다 다시 오는 반복 푸시라,
        //    매번 적용하면 창에서 고른 기간 단위가 (같은 창에서 메모 한 글자만 고쳐도 계좌 identity가
        //    바뀌어 재전송되므로) 앱 값으로 조용히 되돌아간다. hideAmounts처럼 다루면 안 된다.
        if (!gotDataRef.current && d.histPeriod !== undefined) setHistPeriod(normalizeHistPeriod(d.histPeriod));
        if (d.isAdmin !== undefined) setIsAdmin(!!d.isAdmin);
        setTornDown(false);
        gotDataRef.current = true; setGotData(true);
        return;
      }
      // card:pong 등 — 연결 갱신만
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ── 핑 + 재입양 ───────────────────────────────────────────────────────────
  // `need`가 초기 전송의 유일한 트리거다(window.open 직후 보내면 about:blank라 버려진다).
  // 앱 탭이 새로고침되면 그쪽 레지스트리가 비는데, 이 핑을 받아 다시 입양하고 전량 재전송한다.
  useEffect(() => {
    if (!validCard || !PID) return;
    const tick = () => {
      const alive = post({ type: 'card:ping', winId: WIN_ID, card: CARD, pid: PID, need: !gotDataRef.current });
      if (!alive) { setLinked(false); return; }
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post, validCard]);

  // ── 활동 신호(INV-7) ──────────────────────────────────────────────────────
  // ⚠️ 없으면 창에서만 작업하는 세션이 앱 탭의 50분 비활동 로그아웃을 맞고, 창은 opener 소멸로
  //    읽기 전용이 되어 미커밋 편집이 사라진다. 스로틀 10초.
  useEffect(() => {
    let last = 0;
    const onAct = () => {
      const now = Date.now();
      if (now - last < 10000) return;
      last = now;
      post({ type: 'card:activity', winId: WIN_ID });
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach(ev => window.addEventListener(ev, onAct, true));
    return () => evs.forEach(ev => window.removeEventListener(ev, onAct, true));
  }, [post]);

  const acct = account || EMPTY_ACCOUNT;
  const accountType = acct.accountType || 'portfolio';
  // ⚠️ 삭제된(소프트) 계좌는 읽기 전용 — 앱 탭에서는 탭바·표에서 숨겨져 편집 진입점이 없는데,
  //    창만 그 계좌를 계속 편집할 수 있으면 사용자가 '지웠다고 믿는 계좌'가 조용히 바뀐다.
  //    (달력 스냅샷은 buildRebalTargetEntryFrom이 이미 deletedAt에서 null을 반환해 막고 있다.)
  const accountDeleted = !!acct.deletedAt;
  const writable = linked && gotData && !tornDown && !!account && !accountDeleted;
  writableRef.current = writable;

  // ── 파생 — 앱과 **같은 훅**으로 창에서 계산(INV-2) ─────────────────────────
  const data = usePortfolioData({
    portfolio: acct.portfolio || [],
    activePortfolioAccountType: accountType,
    marketIndicators: marketIndicators || {},
    principal: acct.principal ?? 0,
    avgExchangeRate: acct.avgExchangeRate ?? 0,
    portfolioStartDate: acct.portfolioStartDate || acct.startDate || '',
    settings: acct.settings ?? DEFAULT_SETTINGS,
    depositHistory: acct.depositHistory ?? [],
    depositHistory2: acct.depositHistory2 ?? [],
    portfolios: [acct],
    activePortfolioId: acct.id,
    history: acct.history ?? [],
    historyLimit: 100000,
    rebalanceSortConfig,
    // ⚠️ 창 로컬 정렬 state를 그대로 넘긴다 — 리터럴을 넘기면 헤더를 눌러도 행 순서가 절대
    //    바뀌지 않는다(파생을 만드는 곳은 usePortfolioData 하나뿐이다).
    depositSortConfig,
    depositSortConfig2,
    rebalExtraQty,
  });

  // ⚠️ 패널은 `updateSettingsForType({ ...settings, x })`(통째 교체)로 부른다. 그대로 보내면
  //    창의 settings 스냅샷이 낡은 만큼 형제 계좌·앱 탭의 최신 설정을 되감으므로(settings는 같은
  //    accountType 전 계좌 공유) **바뀐 필드만 뽑아** 병합 패치로 보낸다.
  const settingsDiff = useCallback((next) => {
    const cur = acct.settings || {};
    const out = {};
    Object.keys(next || {}).forEach(k => { if (next[k] !== cur[k]) out[k] = next[k]; });
    Object.keys(cur).forEach(k => { if (!(k in (next || {}))) out[k] = undefined; });
    return out;
  }, [acct.settings]);

  // 목표비중 달력 스냅샷 — **창이 자기 화면 값으로** 엔트리를 만들어 보낸다.
  // ⚠️ 앱 탭이 활성 계좌 스코프로 다시 빌드하면 '기록 = 화면 표 1:1'이 깨지고, 앱 탭이 다른
  //    계좌를 보고 있으면 그 계좌의 기존 기록을 거짓 내용으로 교체한다(복구 불가).
  const buildSnapshot = useCallback((overrideDate) => buildRebalTargetEntryFrom({
    portfolioId: acct.id,
    accountName: acct.name,
    accountType,
    deletedAt: acct.deletedAt,
    settings: acct.settings,
    rebalanceData: data.rebalanceData,
    rebalanceSortConfig,
    rebalExtraQty,
    overrideDate,
  }), [acct, accountType, data.rebalanceData, rebalanceSortConfig, rebalExtraQty]);

  const saveSnapshotNow = useCallback(async (overrideDate) => {
    if (!writableRef.current) return 'fail';
    const built = buildSnapshot(overrideDate);
    if (!built) return 'nodate';
    const r = await send('saveTargetSnapshot', { pid: PID, built });
    if (!r || r.ok === false) return 'fail';
    return r.result === 'nochange' ? 'nochange' : 'saved';
  }, [buildSnapshot, send]);

  // 편집이 있었으면 창을 닫을 때 한 번 커밋한다(앱 탭의 종료 커밋 체인이 창에는 없다).
  const snapshotDirtyRef = useRef(false);
  const saveSnapshotRef = useRef(saveSnapshotNow);
  saveSnapshotRef.current = saveSnapshotNow;
  useEffect(() => {
    const onHide = () => { if (snapshotDirtyRef.current) { snapshotDirtyRef.current = false; saveSnapshotRef.current(); } };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // ── 계좌 필드 쓰기 배칭 ────────────────────────────────────────────────────
  // ⚠️ DepositPanel은 한 클릭에서 `setDepositHistory(...)`와 `setPrincipal(...)`을 **따로** 부른다.
  //    두 커맨드로 나가면 원장은 지워졌는데 원금은 그대로인 중간 상태가 Drive에 저장될 수 있다.
  //    같은 동기 핸들러의 쓰기를 마이크로태스크로 모아 **하나의 원자적 cardWrite**로 보낸다.
  // ⚠️ 원금은 절대값 write가 실재한다(원금 직접 입력 · 원장 편집의 프로라타 보정). 창의 스냅샷이
  //    낡은 채 절대값을 보내면 그 사이 앱 탭이 만든 이관·입금이 조용히 사라지므로, 기대값
  //    (expect.principal)을 함께 보내 앱이 다르면 **거부**하게 한다.
  const acctBatchRef = useRef(null);
  // ⚠️ 계좌 필드 배치에는 **언제나** 원금 기대값을 싣는다(원금을 안 건드리는 배치라도).
  //    원장(depositHistory)은 배열 통째 교체인데, 앱 탭의 `transferStockToPortfolio`가 이관 행을
  //    prepend하면서 **원금도 함께** 바꾼다. 원금 기대값이 그 이관을 감지해 배치를 거부하므로,
  //    메모만 고치는 편집도 이관 행을 조용히 지우지 못한다(원금 write가 없는 경로의 유일한 방어선).
  const acctPrincipalRef = useRef(0);
  acctPrincipalRef.current = cleanNum(acct.principal);
  const queueAccountWrite = useCallback((fields, opts) => {
    if (!acctBatchRef.current) {
      acctBatchRef.current = { fields: {}, expect: { principal: acctPrincipalRef.current } };
      Promise.resolve().then(() => {
        const b = acctBatchRef.current;
        acctBatchRef.current = null;
        if (!b || !Object.keys(b.fields).length) return;
        fire('cardWrite', { pid: PID, ops: { accountFields: b.fields, expect: b.expect } });
      });
    }
    Object.assign(acctBatchRef.current.fields, fields);
    if (opts && opts.expect) acctBatchRef.current.expect = { ...(acctBatchRef.current.expect || {}), ...opts.expect };
  }, [fire]);

  // 함수형 updater는 창의 스냅샷으로 즉시 풀어 값으로 만든다(직렬화 불가).
  const resolveArr = useCallback((v, cur) => (typeof v === 'function' ? v(cur || []) : v), []);
  // ⚠️ 원금은 언제나 **기대값(expect)** 과 함께 보낸다 — 창이 자기 스냅샷으로 계산한 절대값을
  //    그대로 쓰면, 그 사이 앱 탭이 만든 이관·입금이 조용히 사라진다. 앱은 현재 원금이 기대값과
  //    다르면 그 배치를 통째로 거부하고 창이 사유를 인라인으로 알린다.
  const principalSetter = useCallback((v) => {
    const cur = cleanNum(acct.principal);
    const next = cleanNum(typeof v === 'function' ? v(cur) : v);
    queueAccountWrite({ principal: next }, { expect: { principal: cur } });
  }, [acct.principal, queueAccountWrite]);

  const handleRebalanceSort = useCallback((key, forcedDir) => {
    setRebalanceSortConfig(prev => {
      if (forcedDir != null) return { key, direction: forcedDir };
      if (prev.key !== key) return { key, direction: 1 };
      if (prev.direction === 1) return { key, direction: -1 };
      return { key: null, direction: 1 };
    });
  }, []);

  // ── 카드 렌더 ─────────────────────────────────────────────────────────────
  const body = useMemo(() => {
    if (!validCard) return <Notice text={`알 수 없는 카드입니다 (card=${CARD}).`} />;
    if (!PID) return <Notice text="계좌가 지정되지 않았습니다." />;
    if (tornDown) return <Notice text="세션이 종료되어 내용을 지웠습니다. 앱 창에서 다시 열어 주세요." />;
    // ⚠️ '아직 안 왔다'와 '와 봤더니 없다'를 구분한다 — 영구삭제(purge)된 계좌를 가리키는 창이
    //    영원히 '불러오는 중'으로 남으면 사용자는 연결이 끊긴 줄로 안다.
    if (!account) return <Notice text={gotData
      ? '계좌를 찾을 수 없습니다. 앱 창에서 영구 삭제되었을 수 있습니다.'
      : '앱 창에서 데이터를 불러오는 중입니다…'} />;

    if (CARD === 'summary') {
      return (
        <PortfolioSummaryPanel
          totals={data.totals}
          hoveredPortCatSlice={hoveredPortCatSlice}
          setHoveredPortCatSlice={setHoveredPortCatSlice}
          hoveredPortStkSlice={hoveredPortStkSlice}
          setHoveredPortStkSlice={setHoveredPortStkSlice}
          hideAmounts={hideAmounts}
        />
      );
    }

    if (!isCardWindowSupported(CARD)) return <Notice text="이 카드는 아직 별도 창을 지원하지 않습니다." />;

    if (CARD === 'dividend') {
      // ⚠️ DividendSummaryTable은 gold·삭제 계좌를 걸러 `return null`한다 — 창에서는 이유 없는
      //    빈 화면이 되므로 여기서 먼저 사유를 밝힌다(무음 조기 반환 금지).
      if (accountType === 'gold') return <Notice text="금현물 계좌는 분배금 현황을 표시하지 않습니다." />;
      if (acct.deletedAt) return <Notice text="삭제된 계좌입니다. 앱 창에서 복원한 뒤 다시 열어 주세요." />;
      // ⚠️ 라이터 20종은 이미 전부 첫 인자가 portfolioId라 그대로 프록시한다(by-id 준비 완료).
      //    App은 `allPortfoliosForDividend.filter(p => p.id === activePortfolioId)`를 넘기는데,
      //    창은 portfolios가 [자기 계좌] 하나뿐이라 같은 배열이 나온다.
      const call = (fn) => (...args) => fire('dividendCall', { fn, args });
      return (
        <DividendSummaryTable
          portfolios={data.allPortfoliosForDividend}
          updatePortfolioDividendHistory={call('updatePortfolioDividendHistory')}
          updatePortfolioActualDividend={call('updatePortfolioActualDividend')}
          updatePortfolioActualDividendUsd={call('updatePortfolioActualDividendUsd')}
          updatePortfolioActualDividendQty={call('updatePortfolioActualDividendQty')}
          updatePortfolioDividendTaxRate={call('updatePortfolioDividendTaxRate')}
          updatePortfolioDividendSeparateTax={call('updatePortfolioDividendSeparateTax')}
          updatePortfolioDividendTaxAmount={call('updatePortfolioDividendTaxAmount')}
          updatePortfolioActualAfterTaxUsd={call('updatePortfolioActualAfterTaxUsd')}
          updatePortfolioActualAfterTaxKrw={call('updatePortfolioActualAfterTaxKrw')}
          addPortfolioExtraRow={call('addPortfolioExtraRow')}
          updatePortfolioExtraRowCode={call('updatePortfolioExtraRowCode')}
          deletePortfolioExtraRow={call('deletePortfolioExtraRow')}
          updatePortfolioExtraRowMonth={call('updatePortfolioExtraRowMonth')}
          updateTaxBaseEvents={call('updateTaxBaseEvents')}
          updateTaxBasePurchases={call('updateTaxBasePurchases')}
          updateTaxBaseSales={call('updateTaxBaseSales')}
          updateTaxBaseExPrice={call('updateTaxBaseExPrice')}
          updateTaxBaseAvgPrice={call('updateTaxBaseAvgPrice')}
          updateTaxBaseAvgAdj={call('updateTaxBaseAvgAdj')}
          onToggleTaxMonth={call('toggleHiddenTaxMonth')}
          hiddenMonths={{
            expected: Array.isArray(acct.hiddenDivMonthsExpected) ? acct.hiddenDivMonthsExpected : [],
            actual: Array.isArray(acct.hiddenDivMonthsActual) ? acct.hiddenDivMonthsActual : [],
          }}
          // ⚠️ 시그니처는 (tab, monthIndex) 그대로 두고 pid는 여기서 바인딩한다.
          //    prop 시그니처를 넓히면 통합 대시보드 compact 경로(앱 레벨 저장, pid 없음)가 깨진다.
          onToggleHiddenMonth={(tab, monthIndex) => fire('dividendCall', { fn: 'toggleHiddenDividendMonth', args: [PID, tab, monthIndex] })}
          deletePortfolioDividendData={call('deletePortfolioDividendData')}
          deletePortfolioTaxData={call('deletePortfolioTaxData')}
          confirmDialog={confirm}
          notify={notify}
          usdkrw={marketIndicators.usdkrw || 1300}
          holidays={marketHolidays}
          dividendTaxHistory={dividendTaxHistory}
          onDividendTaxHistoryUpdate={setDividendTaxHistory}
          dividendLinks={dividendLinks}
          setDividendLinks={(links) => { setDividendLinks(links); fire('dividendCall', { fn: 'setDividendLinks', args: [links] }); }}
        />
      );
    }

    if (CARD === 'rebalancing' || CARD === 'donut') {
      if (accountType === 'gold') return <Notice text="금현물 계좌는 리밸런싱 표를 표시하지 않습니다." />;
      return (
        <RebalancingPanel
          activePortfolioAccountType={accountType}
          portfolio={acct.portfolio || []}
          settings={acct.settings ?? DEFAULT_SETTINGS}
          updateSettingsForType={(next) => fire('patchSettings', { pid: PID, fields: settingsDiff(next) })}
          rebalanceData={data.rebalanceData}
          rebalanceSortConfig={rebalanceSortConfig}
          handleRebalanceSort={handleRebalanceSort}
          rebalExtraQty={rebalExtraQty}
          setRebalExtraQty={setRebalExtraQty}
          rebalCatDonutData={data.rebalCatDonutData}
          curCatDonutData={data.curCatDonutData}
          marketIndicators={marketIndicators}
          hideAmounts={hideAmounts}
          hoveredRebalCatSlice={hoveredRebalCatSlice}
          setHoveredRebalCatSlice={setHoveredRebalCatSlice}
          hoveredCurCatSlice={hoveredCurCatSlice}
          setHoveredCurCatSlice={setHoveredCurCatSlice}
          totals={data.totals}
          handleUpdate={(id, field, value) => fire('updateItem', { pid: PID, id, field, value })}
          // ⚠️ setPortfolio는 **넘기지 않는다** — 함수형 updater는 직렬화할 수 없다. 항목 쓰기는
          //    전부 cardWrite(항목 patch + settings 병합)를 지난다. 과거 목표비중 복원은
          //    setPortfolio가 없으면 구조적으로 no-op이고, rebalTargetSnapshots=[]라 버튼도 잠긴다
          //    (CLAUDE.md '복원' INV-5: id 불일치 시 no-op이 곧 타 계좌 오적용 방어다).
          cardWrite={(ops) => fire('cardWrite', { pid: PID, ops })}
          showTable={CARD === 'rebalancing'}
          showDonut={CARD === 'donut'}
          showRetirementStats={accountType === 'dc-irp'}
          hiddenColumns={acct.hiddenColumnsRebalancing || []}
          onToggleColumn={(key) => fire('toggleColumn', { pid: PID, table: 'rebalancing', key })}
          markedRebalRows={acct.markedRebalRows || {}}
          onToggleMarkedRebalRow={(itemId) => fire('toggleMarkedRow', { pid: PID, table: 'rebalancing', itemId })}
          onResetAllMarkedRebalRows={() => fire('resetMarkedRows', { pid: PID, table: 'rebalancing' })}
          authUser={null}
          isAdmin={isAdmin}
          targetEditAuthorized={targetEditAuthorized}
          setTargetEditAuthorized={setTargetEditAuthorized}
          // PIN 검증은 앱 탭에 위임한다(창의 sessionStorage는 열린 시점 사본이라 낡는다).
          // ⚠️ 연결 실패를 '비밀번호가 틀렸습니다'로 뭉뚱그리지 않는다 — 사유를 토스트로 밝힌다.
          pinVerify={async (pin) => {
            const r = await send('verifyPin', { pid: PID, pin });
            if (!r || r.ok === false) { notify(r?.reason || '앱 창과 통신하지 못했습니다.', 'error'); return false; }
            return !!r.result;
          }}
          // ⚠️ 관리자 접속(impersonation) 중 목표 변경은 인앱과 **같은 등급**으로 사용자에게 알린다.
          //    null로 두면 창이 인앱보다 '조용한' 편집 통로가 된다(세션당 1회 래치는 앱 탭이 담당).
          onAdminTargetChange={isAdmin ? () => fire('adminTargetChange', { pid: PID }) : null}
          onTargetEdited={() => { snapshotDirtyRef.current = true; }}
          onTargetSaveNow={() => { snapshotDirtyRef.current = false; return saveSnapshotNow(); }}
          rebalTargetSnapshots={[]}
          activePortfolioId={PID}
          onTargetRestored={null}
          onManualSave={null}
          driveStatus={null}
          showCalculator={false}
          onToggleCalculator={null}
          investmentNotes={acct.investmentNotes || []}
          // ⚠️ 투자기록은 배열 통째 교체인데 앱 탭의 **메모 달력 NOTE 패드**가 같은 배열을
          //    updateInvestmentNotesFor로 동시에 편집한다(CLAUDE.md 명시) → base 지문을 함께
          //    보내고 앱이 불일치를 감지하면 거부한다(INV-4).
          onUpdateInvestmentNotes={(notes) => fire('updateInvestmentNotes', { pid: PID, notes, base: baseKeyOf(acct.investmentNotes || []) })}
          onRefreshPrice={(id, code) => fire('refreshPrice', { pid: PID, id, code })}
          stockFetchStatus={stockFetchStatus}
          readOnly={!writable}
        />
      );
    }

    if (CARD === 'stats') {
      // ⚠️ activeBookByDate는 앱과 **같은 정책**으로 창이 직접 만든다(해외·현금성은 null).
      //    App이 계산해 push하면 Map 직렬화가 필요하고, 정책이 갈리면 같은 날짜의 일간 수익률이
      //    표와 차트에서 달라진다(CLAUDE.md: 3소비자가 하나의 Map을 공유해야 한다).
      const bookByDate = ['overseas', 'simple', 'matong'].includes(accountType)
        ? null
        : buildBookCostSeries(acct, (acct.history || []).map(h => h?.date));
      const blocked = (msg) => () => notify(msg, 'info');
      return (
        <div className="flex flex-col xl:flex-row gap-4 w-full items-stretch">
          <PortfolioStatsPanel
            totals={data.totals}
            marketIndicators={marketIndicators}
            activePortfolioAccountType={accountType}
            portfolioStartDate={acct.portfolioStartDate || acct.startDate || ''}
            setPortfolioStartDate={(v) => queueAccountWrite({ portfolioStartDate: v, startDate: v })}
            principal={acct.principal ?? 0}
            setPrincipal={principalSetter}
            avgExchangeRate={acct.avgExchangeRate ?? 0}
            setAvgExchangeRate={(v) => queueAccountWrite({ avgExchangeRate: cleanNum(v) })}
            depositHistory={acct.depositHistory || []}
            setDepositHistory={(v) => queueAccountWrite({ depositHistory: resolveArr(v, acct.depositHistory) })}
            depositHistory2={acct.depositHistory2 || []}
            cagr={data.cagr}
          />
          <HistoryPanel
            history={acct.history || []}
            // ⚠️ history 편집(자산검증 확정·수량/종가 수정)은 창에서 미지원 — 앱 탭이 백필·자동확정·
            //    today-effect로 **동시에** 쓰는 배열이라 창의 스냅샷을 통째로 되보내면 그 사이 생긴
            //    기록이 소실된다. 조용히 무시하지 않고 사유를 인라인으로 알린다.
            setHistory={blocked('자산검증 확정은 앱 창에서만 가능합니다.')}
            patchActivePortfolio={blocked('보유 수량·종가 수정은 앱 창에서만 가능합니다.')}
            totals={data.totals}
            principal={acct.principal ?? 0}
            activePortfolioAccountType={accountType}
            marketIndicators={marketIndicators}
            sortedHistoryDesc={data.sortedHistoryDesc}
            handleDownloadCSV={null}
            stockHistoryMap={stockHistoryMap}
            indicatorHistoryMap={indicatorHistoryMap}
            activePortfolio={acct}
            notify={notify}
            effectiveDateKey={effectiveDateKey}
            refreshPrices={blocked('전체 시세 새로고침은 앱 창에서만 가능합니다.')}
            isLoading={false}
            depositHistory={acct.depositHistory || []}
            depositHistory2={acct.depositHistory2 || []}
            portfolioStartDate={acct.portfolioStartDate || acct.startDate || ''}
            activeBookByDate={bookByDate}
            refetchStockHistory={async () => { notify('종가 재조회는 앱 창에서만 가능합니다.', 'info'); return false; }}
            histPeriod={histPeriod}
            setHistPeriod={setHistPeriod}
            histPeriodNote="이 창의 기간 설정은 저장되지 않습니다 (앱 창에서 바꾸면 유지됩니다)"
          />
          <DepositPanel
            depositHistory={acct.depositHistory || []}
            setDepositHistory={(v) => queueAccountWrite({ depositHistory: resolveArr(v, acct.depositHistory) })}
            depositHistory2={acct.depositHistory2 || []}
            setDepositHistory2={(v) => queueAccountWrite({ depositHistory2: resolveArr(v, acct.depositHistory2) })}
            depositWithSumSorted={data.depositWithSumSorted}
            depositWithSum2Sorted={data.depositWithSum2Sorted}
            depositSortConfig={depositSortConfig}
            depositSortConfig2={depositSortConfig2}
            handleDepositSort={(key) => setDepositSortConfig(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }))}
            handleDepositSort2={(key) => setDepositSortConfig2(prev => ({ key, direction: prev.key === key ? -prev.direction : 1 }))}
            handleDepositDownloadCSV={blocked('CSV 내려받기는 앱 창에서만 가능합니다.')}
            handleWithdrawDownloadCSV={blocked('CSV 내려받기는 앱 창에서만 가능합니다.')}
            activePortfolioAccountType={accountType}
            marketIndicators={marketIndicators}
            setPrincipal={principalSetter}
            principal={acct.principal ?? 0}
            evalAmount={data.totals.totalEval}
          />
        </div>
      );
    }

    return <Notice text="이 카드는 아직 별도 창을 지원하지 않습니다." />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validCard, tornDown, gotData, accountDeleted, account, acct, data, hideAmounts, hoveredPortCatSlice, hoveredPortStkSlice,
      hoveredRebalCatSlice, hoveredCurCatSlice, rebalExtraQty, rebalanceSortConfig, marketIndicators,
      marketHolidays, dividendTaxHistory, dividendLinks, stockFetchStatus, isAdmin, writable,
      confirm, notify, fire, send, handleRebalanceSort, accountType, settingsDiff, saveSnapshotNow,
      targetEditAuthorized, stockHistoryMap, indicatorHistoryMap, effectiveDateKey,
      depositSortConfig, depositSortConfig2, queueAccountWrite, principalSetter]);

  const notice = tornDown
    ? '세션이 종료되었습니다.'
    : accountDeleted
      ? '앱 창에서 삭제된 계좌입니다 — 읽기 전용입니다. 복원 후 다시 열어 주세요.'
    : !linked
      ? '앱 창과 연결이 끊겨 읽기 전용입니다. 앱 창을 다시 열면 자동으로 이어집니다.'
      : !gotData
        ? '앱 창에서 데이터를 불러오는 중입니다…'
        : '';

  return (
    <div className="fixed inset-0 overflow-auto bg-[#0b1120] text-white">
      <div className="sticky top-0 z-30 flex items-center gap-3 px-4 py-2 bg-[#0f172a] border-b border-gray-700">
        <span className="text-sm font-bold truncate">{account?.name || '(계좌)'}</span>
        <span className="text-gray-500">·</span>
        <span className="text-sm text-gray-300">{CARD_LABELS[CARD] || CARD}</span>
        {!writable && <span className="ml-auto text-[11px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800/60">읽기 전용</span>}
      </div>
      {notice && (
        <div className="px-4 py-1.5 text-[11px] text-amber-300 bg-amber-900/30 border-b border-amber-800/50">{notice}</div>
      )}
      <div className="p-4">
        {/* ⚠️ label 필수 — main.tsx의 루트 경계는 label이 없어(isSection=false) 렌더 예외 하나가
            창 전체를 오류 페이지로 바꾼다. */}
        <ErrorBoundary label={CARD_LABELS[CARD] || '카드'}>
          {body}
        </ErrorBoundary>
      </div>

      {/* 창 자체 알림 — notify()는 이 문서에 존재하지 않으므로 인라인이 유일한 피드백이다. */}
      {toasts.length > 0 && (
        <div className="fixed bottom-3 right-3 z-[1200] flex flex-col gap-1.5 items-end">
          {toasts.map(t => (
            <div key={t.id} className={`px-3 py-1.5 rounded text-[12px] border shadow-lg ${t.type === 'error' ? 'bg-red-950/90 text-red-200 border-red-800' : 'bg-gray-900/95 text-gray-200 border-gray-700'}`}>
              {t.text}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog state={confirmState} onResolve={resolveConfirm} />
    </div>
  );
}

function Notice({ text }) {
  return <div className="p-6 text-sm text-gray-400">{text}</div>;
}
