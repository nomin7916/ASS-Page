// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from 'react';
import CalendarModal from './CalendarModal';

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
//   앱 → 창 : calendar:accounts {accounts, activePortfolioId, holidays}  — 무거움(지문 변경 시에만)
//             calendar:live {memos, metricsHistory, ...}                 — 가벼움(시세·기록 갱신 시)
//             calendar:pong                                              — 핑 응답
const PING_MS = 5000;
const LINK_TIMEOUT_MS = 13000;   // 마지막 수신 이후 이 시간이 지나면 끊긴 것으로 보고 읽기 전용

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
      if (d.type !== 'calendar:accounts' && d.type !== 'calendar:live' && d.type !== 'calendar:pong') return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      if (d.type === 'calendar:accounts') {
        setData((prev) => ({
          ...prev,
          accounts: Array.isArray(d.accounts) ? d.accounts : [],
          activePortfolioId: d.activePortfolioId ?? null,
          holidays: d.holidays || prev.holidays,
        }));
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
        }));
        markGotData();
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

  const notice = !linked
    ? '앱 창과 연결이 끊겨 읽기 전용입니다. 앱 창을 다시 열면 자동으로 이어집니다.'
    : !gotData
      ? '앱 창에서 데이터를 불러오는 중입니다…'
      : null;

  return (
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
    />
  );
}
