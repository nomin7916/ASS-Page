// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from 'react';
import CalendarModal from './CalendarModal';
import ErrorBoundary from './ErrorBoundary';

// ── 메모 달력 '별도 브라우저 창' (`/?calendarWindow=1`) ──────────────────────────────────────
//
// ⚠️ 이 창은 **로그인하지 않고 Drive에도 접근하지 않는다.** 앱 탭이 `postMessage`로 데이터를
//    밀어주고, 여기서 저장하면 앱 탭이 받아 자기 state에 반영한다 → 기존 Drive STATE 저장 경로가
//    그대로 돈다. 즉 **진실의 원본은 앱 탭 하나**다.
//
// ⚠️ 이 설계를 "새 창에서 앱을 통째로 다시 부팅"으로 바꾸지 말 것 —
//    ① `saveAllToDrive`는 STATE 파일을 **통째로 덮어쓴다**. 두 창이 각자 저장하면 나중에 쓴 쪽이
//       상대 편집을 조용히 지운다(payload 스프레드 규약이 막아주는 범위 밖 — 창이 둘이면 무력).
//    ② `window.open`은 noopener를 안 쓰면 sessionStorage가 복제돼(`?adminPortal=1`이 동작하는 원리)
//       새 창이 자동 재인증 → 두 번째 writer가 되고 세션 충돌 감지에도 걸릴 수 있다.
//    ③ 토큰이 이 창으로 넘어가지 않으므로 보안 경계도 현행 유지된다.
//
// ⚠️ `main.tsx`가 URL 파라미터로 App 대신 이 컴포넌트를 렌더한다(App은 마운트조차 하지 않는다) —
//    App 안에서 분기하면 Drive 로드·타이머·인증이 전부 돌아 이 창의 존재 이유가 사라진다.
//
// 브릿지 프로토콜 (전부 same-origin 검사 통과분만 처리):
//   창 → 앱 : calendar:ping (5초, 생존 신고 + 앱 재시작 시 재입양 트리거)
//             calendar:memos {memos}                  — 사용자 메모/목표비중 기록 쓰기
//             calendar:notes {portfolioId, notes}     — 투자기록 쓰기
//             calendar:wantDetail {date|null}         — 계좌별 현황 구독 등록/해제(날짜 1개)
//             calendar:openLedger                     — 가계부 창 열기 **위임**
//               ⚠️ 이 창에서 직접 window.open을 부르면 새 창의 opener가 **이 창**이 되어,
//                  가계부 창이 앱 탭과 영원히 연결되지 못하고 읽기 전용으로 굳는다.
//                  반드시 앱 탭에 위임해 앱이 열게 한다.
//   앱 → 창 : calendar:accounts {accounts, activePortfolioId, holidays}  — 무거움(지문 변경 시에만)
//             calendar:live {memos, metricsHistory, ...}                 — 가벼움(시세·기록 갱신 시)
//             calendar:detail {date, rows, totalEval, ...}               — 구독 중인 날짜의 계좌별 현황
//             calendar:pong                                              — 핑 응답
const PING_MS = 5000;
const LINK_TIMEOUT_MS = 13000;   // 마지막 수신 이후 이 시간이 지나면 끊긴 것으로 보고 읽기 전용
const DETAIL_TIMEOUT_MS = 4000;  // 계좌별 현황 요청이 이 시간 안에 안 오면 '응답 없음'으로 안내

const EMPTY = {
  memos: {},
  accounts: [],
  activePortfolioId: null,
  holidays: { kr: [], us: [] },
  metricsHistory: [],
  todayReturnRate: null,
  fxHistory: null,
  us10yHistory: null,
  liveFx: null,
  liveUs10y: null,
  hideAmounts: false,
  // ⚠️ 여기에 빠뜨리면 첫 렌더에서 undefined가 흘러 CalendarModal의 기본값에 의존하게 된다
  //    (기본값이 있어 지금은 무해하지만, 열거형 화이트리스트와 같은 부류의 '조용한 누락'이다).
  ledgerBooks: [],
};

export default function CalendarWindow() {
  const [data, setData] = useState(EMPTY);
  const [gotData, setGotData] = useState(false);
  const [linked, setLinked] = useState(true);
  // 마지막 수신 시각 — state로 두면 수신마다 리렌더가 나므로 ref + 별도 판정 타이머로 처리
  const lastMsgRef = useRef(0);
  // ⚠️ 핑 타이머는 마운트 시 한 번만 만들어져 gotData state를 못 본다 → ref 미러 필수.
  //    이 값이 false인 동안 핑에 need:true를 실어 앱 탭이 전체 데이터를 보내게 한다(초기 수신 경로).
  const gotDataRef = useRef(false);
  const markGotData = () => { gotDataRef.current = true; setGotData(true); };

  // 계좌별 현황(ASSET 패드) — 이 창은 잘린 원장만 받아 스스로 계산할 수 없으므로 앱 탭에 구독한다.
  // ⚠️ data가 아니라 **별도 state**로 둔다: data에 섞으면 상세 응답 하나가 memos/accounts 참조까지
  //    새로 만들어 달력 전체가 리렌더된다.
  const [detail, setDetail] = useState(null);
  const detailDateRef = useRef(null);   // 구독 중인 날짜 — 늦게 온 옛 응답의 폐기 기준
  const detailTimerRef = useRef(null);
  const prevLinkedRef = useRef(true);
  // calendar:accounts 수신 횟수 — 재입양·계좌 지문 변경 시점을 재구독 트리거로 쓴다(아래 effect).
  const [accountsSeq, setAccountsSeq] = useState(0);

  // 앱 탭으로 보내기. opener가 사라졌으면 조용히 무시(호출부는 이미 readOnly로 막혀 있다).
  const post = useCallback((msg) => {
    const op = window.opener;
    if (!op || op.closed) return false;
    try {
      op.postMessage(msg, window.location.origin);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    document.title = '메모 달력';
  }, []);

  // 수신 — ⚠️ origin 검사 필수. opener 이외의 출처는 무시한다.
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (window.opener && e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      // ⚠️ 이 화이트리스트는 **열거형**이다(앱 쪽은 'calendar:' 접두사 검사라 비대칭) — 새 메시지를
      //    추가할 때 여기를 빠뜨리면 앱 코드가 완벽해도 응답이 조용히 폐기돼 '영원히 로딩'이 된다.
      if (d.type !== 'calendar:accounts' && d.type !== 'calendar:live' && d.type !== 'calendar:pong' && d.type !== 'calendar:detail') return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      if (d.type === 'calendar:accounts') {
        setData((prev) => ({
          ...prev,
          accounts: Array.isArray(d.accounts) ? d.accounts : [],
          activePortfolioId: d.activePortfolioId ?? null,
          holidays: d.holidays || prev.holidays,
        }));
        setAccountsSeq((s) => s + 1);   // 재입양·지문 변경 → 열려 있는 계좌별 현황 재구독(아래 effect)
        markGotData();
      } else if (d.type === 'calendar:live') {
        setData((prev) => ({
          ...prev,
          memos: d.memos && typeof d.memos === 'object' ? d.memos : {},
          metricsHistory: Array.isArray(d.metricsHistory) ? d.metricsHistory : [],
          todayReturnRate: d.todayReturnRate ?? null,
          fxHistory: d.fxHistory || null,
          us10yHistory: d.us10yHistory || null,
          liveFx: d.liveFx ?? null,
          liveUs10y: d.liveUs10y ?? null,
          hideAmounts: !!d.hideAmounts,
          ledgerBooks: Array.isArray(d.ledgerBooks) ? d.ledgerBooks : [],
        }));
        markGotData();
      } else if (d.type === 'calendar:detail') {
        // ⚠️ markGotData()를 **절대 부르지 말 것**. writable = linked && gotData 이므로 accounts/live
        //    도착 전에 쓰기가 열리면 그 시점 memos는 EMPTY의 {}이고, 저장 한 번이 앱의
        //    setCalendarMemos({})로 흘러 저장된 메모 전체를 통째로 지운다(calendarMemos는 백업
        //    복원 sticky라 복구 불가). 다른 분기와 '통일'하려는 리팩토링이 정확히 이걸 되돌린다.
        // 날짜가 곧 상관 키다 — 날짜를 연속 클릭했을 때 늦게 온 옛 응답은 여기서 폐기된다.
        if (d.date !== detailDateRef.current) return;
        if (detailTimerRef.current) { clearTimeout(detailTimerRef.current); detailTimerRef.current = null; }
        setDetail({
          date: d.date, status: 'ready',
          rows: Array.isArray(d.rows) ? d.rows : [],
          totalEval: d.totalEval || 0,
          totalPrincipal: d.totalPrincipal || 0,
          totalDeposit: d.totalDeposit || 0,
          totalProfit: d.totalProfit || 0,
          totalReturnRate: d.totalReturnRate ?? null,
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 핑 + 연결 판정. 앱 탭이 새로고침되면 그쪽 창 참조가 사라지는데, 이 핑을 받고 다시 입양해
  // 전체 데이터를 재전송한다(핑이 없으면 새 창은 영영 낡은 데이터를 들고 있게 된다).
  useEffect(() => {
    const tick = () => {
      const alive = post({ type: 'calendar:ping', need: !gotDataRef.current });
      if (!alive) { setLinked(false); return; }
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post]);

  const writable = linked && gotData;

  const updateMemos = useCallback((next) => {
    // 낙관적 반영 — 앱 탭이 적용 후 calendar:live로 되돌려 보내지만 왕복을 기다리지 않는다.
    setData((prev) => ({ ...prev, memos: next }));
    post({ type: 'calendar:memos', memos: next });
  }, [post]);

  const updateNotes = useCallback((portfolioId, notes) => {
    setData((prev) => ({
      ...prev,
      accounts: (prev.accounts || []).map((p) => (p && p.id === portfolioId ? { ...p, investmentNotes: notes } : p)),
    }));
    post({ type: 'calendar:notes', portfolioId, notes });
  }, [post]);

  // 계좌별 현황 구독 — date가 null이면 해제(패드 닫힘). 앱은 구독 중인 날짜를 데이터 변경마다
  // 다시 밀어 주므로, 여기서는 등록/해제와 첫 응답 대기(타임아웃)만 관리한다.
  // ⚠️ 조회는 쓰기가 아니므로 writable로 게이팅하지 않는다 — 끊긴 상태에서도 '왜 안 뜨는지'를 보여줘야 한다.
  const requestDetail = useCallback((date) => {
    detailDateRef.current = date || null;
    if (detailTimerRef.current) { clearTimeout(detailTimerRef.current); detailTimerRef.current = null; }
    // ⚠️ 해제(date=null)도 **반드시 앱에 알린다** — post를 건너뛰고 조기 반환하면 앱의
    //    calWinDetailDateRef가 마지막 날짜를 든 채 남아, 패드를 닫아도(창을 닫아도) 앱이 시세
    //    갱신마다 전 계좌 시계열을 재계산하고 아무도 읽지 않는 행을 계속 보낸다. App의 null 처리
    //    분기가 죽은 코드가 되지 않게 하는 유일한 발신 지점이다.
    if (!date) { post({ type: 'calendar:wantDetail', date: null }); setDetail(null); return; }
    if (!post({ type: 'calendar:wantDetail', date })) { setDetail({ date, status: 'offline', rows: [] }); return; }
    setDetail({ date, status: 'loading', rows: [] });
    detailTimerRef.current = setTimeout(() => {
      setDetail((p) => (p && p.date === date && p.status === 'loading' ? { ...p, status: 'timeout' } : p));
    }, DETAIL_TIMEOUT_MS);
  }, [post]);

  // 앱 탭이 새로고침되면 그쪽 구독 ref가 비므로(App은 푸시하지 않는다) 재연결 시 다시 등록한다.
  // ⚠️ 'ready면 건너뛴다'는 조건을 넣지 말 것 — 계좌·시세가 전부 갱신됐는데 이미 ready인 표만
  //    옛 값으로 영영 남는다.
  useEffect(() => {
    const was = prevLinkedRef.current;
    prevLinkedRef.current = linked;
    if (!was && linked && detailDateRef.current) requestDetail(detailDateRef.current);
  }, [linked, requestDetail]);

  // ⚠️ 위 `linked` 엣지만으로는 **앱 탭 새로고침을 잡지 못한다** — 리로드 중에도 opener는 살아
  //    있어 post가 성공하고, 리로드가 LINK_TIMEOUT_MS(13초) 안에 끝나면 linked가 한 번도 false로
  //    떨어지지 않는다. 그런데 앱의 구독 ref는 리로드로 비어 있어, 밴드(calendar:live)만 갱신되고
  //    표는 옛 값에 영구히 얼어붙는다. `calendar:accounts`는 **재입양 시점**(nonce 증가)과 계좌
  //    지문 변경 시에만 오므로 — 둘 다 표가 낡을 수 있는 순간이다 — 그 수신을 재구독 트리거로 쓴다.
  // ⚠️ 메시지 핸들러 안에서 requestDetail을 직접 부르지 말 것(그 effect는 deps []라 선언보다 위에
  //    있다). 카운터를 올려 이 effect로 넘긴다. 앱의 nonce 값을 비교하지 않는 이유: 앱이 새로고침
  //    되면 그 카운터도 0부터 다시 시작해 같은 값이 재사용되므로 '변했는지'로는 판별할 수 없다.
  useEffect(() => {
    if (accountsSeq > 0 && detailDateRef.current) requestDetail(detailDateRef.current);
  }, [accountsSeq, requestDetail]);

  useEffect(() => () => { if (detailTimerRef.current) clearTimeout(detailTimerRef.current); }, []);

  const notice = !linked
    ? '앱 창과 연결이 끊겨 읽기 전용입니다. 앱 창을 다시 열면 자동으로 이어집니다.'
    : !gotData
      ? '앱 창에서 데이터를 불러오는 중입니다…'
      : null;

  // ⚠️ 이 창은 App을 마운트하지 않아 `main.tsx`의 **루트** ErrorBoundary가 유일한 그물인데, 그쪽은
  //    label이 없어 `isSection`이 false → 렌더 예외 하나가 **창 전체를 오류 페이지로** 대체한다.
  //    label을 주면 섹션 모드로 격리된다(BacktestWindow와 동일 근거).
  return (
    <ErrorBoundary label="메모 달력">
    <CalendarModal
      variant="page"
      open
      onClose={() => window.close()}
      readOnly={!writable}
      headerNotice={notice}
      memos={data.memos}
      onUpdateMemos={writable ? updateMemos : null}
      holidays={data.holidays}
      portfolios={data.accounts}
      activePortfolioId={data.activePortfolioId}
      onUpdateInvestmentNotes={writable ? updateNotes : null}
      metricsHistory={data.metricsHistory}
      todayReturnRate={data.todayReturnRate}
      fxHistory={data.fxHistory}
      us10yHistory={data.us10yHistory}
      liveFx={data.liveFx}
      liveUs10y={data.liveUs10y}
      hideAmounts={data.hideAmounts}
      accountDetail={detail}
      onRequestAccountDetail={requestDetail}
      ledgerBooks={data.ledgerBooks}
      // ⚠️ 이 창에서 window.open을 직접 부르지 말 것 — opener가 이 창이 되어 가계부 창이
      //    영구 읽기 전용으로 굳는다. 앱 탭에 위임한다(연결이 끊겼으면 진입점을 없앤다).
      onOpenLedger={linked ? (() => post({ type: 'calendar:openLedger' })) : null}
    />
    </ErrorBoundary>
  );
}
