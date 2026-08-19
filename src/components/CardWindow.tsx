// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolioData } from '../hooks/usePortfolioData';
import ErrorBoundary from './ErrorBoundary';
import ConfirmDialog from './ConfirmDialog';
import PortfolioSummaryPanel from './PortfolioSummaryPanel';
import DividendSummaryTable from './DividendSummaryTable';
import { CARD_LABELS, cardWindowTitle, isCardKey, isCardWindowSupported } from '../cardWindow';

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
const LINK_TIMEOUT_MS = 12000;
const CMD_TIMEOUT_MS = 9000;

const params = new URLSearchParams(window.location.search);
const CARD = params.get('card') || '';
const PID = params.get('pid') || '';
// 창 id는 (카드, 계좌) 조합 — window.open의 name과 1:1이라 같은 조합의 창은 하나뿐이다.
// 앱 탭이 새로고침돼도 같은 id로 재입양되므로 별도 난수가 필요 없다.
const WIN_ID = `${CARD}:${PID}`;

const EMPTY_ACCOUNT = { id: PID, name: '', accountType: 'portfolio', portfolio: [], history: [], depositHistory: [], depositHistory2: [], settings: { mode: 'rebalance', amount: 1000000 } };

export default function CardWindow() {
  const [account, setAccount] = useState(null);
  const [marketIndicators, setMarketIndicators] = useState({});
  const [marketHolidays, setMarketHolidays] = useState({ kr: [], us: [] });
  const [dividendTaxHistory, setDividendTaxHistory] = useState({});
  const [dividendLinks, setDividendLinks] = useState([]);
  const [stockFetchStatus, setStockFetchStatus] = useState({});
  const [hideAmounts, setHideAmounts] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(null);
  const [gotData, setGotData] = useState(false);
  const [linked, setLinked] = useState(true);
  const [tornDown, setTornDown] = useState(false);

  // 창 로컬(앱과 공유하지 않는다 — 전부 세션 스크래치)
  const [rebalExtraQty, setRebalExtraQty] = useState({});
  const [rebalanceSortConfig, setRebalanceSortConfig] = useState({ key: null, direction: 1 });
  const [hoveredPortCatSlice, setHoveredPortCatSlice] = useState(null);
  const [hoveredPortStkSlice, setHoveredPortStkSlice] = useState(null);
  const [hoveredRebalCatSlice, setHoveredRebalCatSlice] = useState(null);
  const [hoveredCurCatSlice, setHoveredCurCatSlice] = useState(null);

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
  const fire = useCallback((op, args) => {
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
        if (d.hideAmounts !== undefined) setHideAmounts(!!d.hideAmounts);
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
  const writable = linked && gotData && !tornDown && !!account;

  // ── 파생 — 앱과 **같은 훅**으로 창에서 계산(INV-2) ─────────────────────────
  const data = usePortfolioData({
    portfolio: acct.portfolio || [],
    activePortfolioAccountType: accountType,
    marketIndicators: marketIndicators || {},
    principal: acct.principal ?? 0,
    avgExchangeRate: acct.avgExchangeRate ?? 0,
    portfolioStartDate: acct.portfolioStartDate || acct.startDate || '',
    settings: acct.settings ?? { mode: 'rebalance', amount: 1000000 },
    depositHistory: acct.depositHistory ?? [],
    depositHistory2: acct.depositHistory2 ?? [],
    portfolios: [acct],
    activePortfolioId: acct.id,
    history: acct.history ?? [],
    historyLimit: 100000,
    rebalanceSortConfig,
    depositSortConfig: { key: null, direction: 1 },
    depositSortConfig2: { key: null, direction: 1 },
    rebalExtraQty,
  });

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
    if (!account) return <Notice text="앱 창에서 데이터를 불러오는 중입니다…" />;

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

    return <Notice text="이 카드는 아직 별도 창을 지원하지 않습니다." />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validCard, tornDown, account, acct, data, hideAmounts, hoveredPortCatSlice, hoveredPortStkSlice,
      hoveredRebalCatSlice, hoveredCurCatSlice, rebalExtraQty, rebalanceSortConfig, marketIndicators,
      marketHolidays, dividendTaxHistory, dividendLinks, stockFetchStatus, isAdmin, writable,
      confirm, notify, fire, handleRebalanceSort, accountType]);

  const notice = tornDown
    ? '세션이 종료되었습니다.'
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
