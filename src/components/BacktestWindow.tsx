// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import BacktestPage from './BacktestPage';
import ErrorBoundary from './ErrorBoundary';

/**
 * 백테스트 **별도 브라우저 창** (`/?backtestWindow=1`).
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다 — 절대 '앱 통째 부팅'으로 바꾸지 말 것.
 *    앱을 부팅하면 ① saveAllToDrive가 STATE 파일을 **통째로 덮어쓰므로** 두 창이 서로의 편집을
 *    지우고 ② window.open에 noopener를 안 쓰면 sessionStorage가 복제돼 새 창이 자동 재인증 →
 *    **두 번째 writer**가 되며 세션 충돌 감지에도 걸린다. **writer는 끝까지 앱 탭 하나**다.
 *    (FlowWindow.tsx·CalendarWindow.tsx와 동일 규약.)
 *
 * ⚠️ 렌더는 인앱 오버레이와 **같은 BacktestPage 컴포넌트**를 공유한다. 새 창용으로 표를
 *    복제하면 두 화면이 갈라진다.
 *
 * ⚠️ 끊김(opener 소멸·무응답) = 읽기 전용. BacktestPage에 readOnly를 넘겨 편집 자체를 막는다 —
 *    저장 버튼만 숨기면 사용자가 한참 설정한 뒤 아무 데도 저장되지 않고 사라진다.
 */

const PING_MS = 3000;
const LINK_TIMEOUT_MS = 12000;

export default function BacktestWindow() {
  const [scenarios, setScenarios] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [prices, setPrices] = useState({});
  const [dividends, setDividends] = useState({});
  const [holidays, setHolidays] = useState([]);
  const [fetchingCodes, setFetchingCodes] = useState([]);
  const [gotData, setGotData] = useState(false);
  const [linked, setLinked] = useState(true);

  const lastMsgRef = useRef(0);
  // ⚠️ 핑 타이머는 마운트 시 한 번만 만들어져 gotData state를 못 본다 → ref 미러 필수.
  const gotDataRef = useRef(false);
  const scenRef = useRef(scenarios);
  scenRef.current = scenarios;

  const post = useCallback((msg) => {
    const op = window.opener;
    if (!op || op.closed) return false;
    try { op.postMessage(msg, window.location.origin); return true; } catch { return false; }
  }, []);

  useEffect(() => { document.title = '백테스트'; }, []);

  // 수신 — ⚠️ origin 검사 필수.
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (window.opener && e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type !== 'backtest:data' && d.type !== 'backtest:live' && d.type !== 'backtest:pong') return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      if (d.type === 'backtest:data') {
        if (Array.isArray(d.catalog)) setCatalog(d.catalog);
        if (d.dividends && typeof d.dividends === 'object') setDividends(d.dividends);
        if (Array.isArray(d.holidays)) setHolidays(d.holidays);
        gotDataRef.current = true; setGotData(true);
      } else if (d.type === 'backtest:live') {
        if (Array.isArray(d.scenarios)) setScenarios(d.scenarios);
        // ⚠️ 시세는 교체가 아니라 **병합** — 지문 게이팅 때문에 부분 전송이 정상 경로다.
        if (d.prices && typeof d.prices === 'object') setPrices((prev) => ({ ...prev, ...d.prices }));
        if (Array.isArray(d.fetchingCodes)) setFetchingCodes(d.fetchingCodes);
        gotDataRef.current = true; setGotData(true);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 핑 + 연결 판정. 앱 탭이 새로고침되면 그쪽 창 참조가 사라지는데, 이 핑을 받고 다시 입양해
  // 전체 데이터를 재전송한다(핑이 없으면 새 창은 영영 낡은 데이터를 들고 있게 된다).
  useEffect(() => {
    const tick = () => {
      const alive = post({ type: 'backtest:ping', need: !gotDataRef.current });
      if (!alive) { setLinked(false); return; }
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post]);

  const writable = linked && gotData;

  // 낙관적 반영 후 앱 탭으로 보낸다(왕복을 기다리지 않는다).
  const onUpdateScenarios = useCallback((next) => {
    scenRef.current = next;
    setScenarios(next);
    post({ type: 'backtest:scenarios', scenarios: next });
  }, [post]);

  /** 종목 조회 요청 — 붙여넣기 주입(data)도 같은 채널로 앱 탭에 위임한다. */
  const onFetchCode = useCallback((code, data, force) => {
    if (!code) return;
    if (data && typeof data === 'object') setPrices((prev) => ({ ...prev, [code]: { ...(prev[code] || {}), ...data } }));
    post({ type: 'backtest:want', code, data: data || null, force: !!force });
  }, [post]);

  const notice = !linked
    ? '앱 탭과 연결이 끊겨 읽기 전용입니다. 앱 탭을 다시 열면 자동으로 이어집니다.'
    : !gotData
      ? '앱 탭에서 데이터를 불러오는 중입니다…'
      : '';

  // ⚠️ 별도 창은 App을 마운트하지 않아 `main.tsx`의 **루트** ErrorBoundary가 유일한 그물이다 —
  //    BacktestPage의 렌더 예외 하나가 창 전체를 "일시적인 오류가 발생했습니다"로 바꾸고
  //    **원인 메시지도 안 보인다**(루트 모드). App.tsx는 이미 `label="백테스트"`로 감싸 두었는데
  //    이 창만 빠져 있었다(계산기·자금 흐름도와 동일한 2차 방어).
  return (
    <ErrorBoundary label="백테스트">
      <BacktestPage
        open
        variant="page"
        scenarios={scenarios}
        onUpdateScenarios={onUpdateScenarios}
        catalog={catalog}
        prices={prices}
        dividends={dividends}
        holidays={holidays}
        fetchingCodes={fetchingCodes}
        onFetchCode={writable ? onFetchCode : undefined}
        readOnly={!writable}
        notice={notice}
        onClose={() => { try { window.close(); } catch { /* 브라우저가 막으면 그대로 둔다 */ } }}
      />
    </ErrorBoundary>
  );
}
