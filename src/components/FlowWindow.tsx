// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import FlowBoard from './FlowBoard';

/**
 * 자금 흐름도 **별도 브라우저 창** (`/?flowWindow=1`).
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다 — 절대 '앱 통째 부팅'으로 바꾸지 말 것.
 *    앱을 부팅하면 ① saveAllToDrive가 STATE 파일을 **통째로 덮어쓰므로** 두 창이 서로의 편집을
 *    지우고 ② window.open에 noopener를 안 쓰면 sessionStorage가 복제돼 새 창이 자동 재인증 →
 *    **두 번째 writer**가 되며 세션 충돌 감지에도 걸린다. **writer는 끝까지 앱 탭 하나**다.
 *    (메모 달력 별도 창 CalendarWindow.tsx와 동일 규약 — 그쪽 상단 주석 참조.)
 *
 * ⚠️ 렌더는 인앱 보드와 **같은 FlowBoard 컴포넌트**를 공유한다. 새 창용으로 캔버스를 복제하면
 *    두 화면이 갈라진다.
 *
 * ⚠️ 끊김(opener 소멸·무응답) = 읽기 전용. FlowBoard에 readOnly를 넘겨 편집 자체를 막는다 —
 *    저장 버튼만 숨기면 사용자가 한참 그린 뒤 아무 데도 저장되지 않고 사라진다.
 */

const PING_MS = 3000;
const LINK_TIMEOUT_MS = 12000;

export default function FlowWindow() {
  const [maps, setMaps] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [gotData, setGotData] = useState(false);
  const [linked, setLinked] = useState(true);

  const lastMsgRef = useRef(0);
  // ⚠️ 핑 타이머는 마운트 시 한 번만 만들어져 gotData state를 못 본다 → ref 미러 필수.
  //    이 값이 false인 동안 핑에 need:true를 실어 앱 탭이 전체 데이터를 보내게 한다(초기 수신 경로).
  const gotDataRef = useRef(false);
  const mapsRef = useRef(maps);
  mapsRef.current = maps;

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

  useEffect(() => { document.title = '자금 흐름도'; }, []);

  // 수신 — ⚠️ origin 검사 필수. opener 이외의 출처는 무시한다.
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (window.opener && e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type !== 'flow:accounts' && d.type !== 'flow:live' && d.type !== 'flow:pong') return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      if (d.type === 'flow:accounts') {
        setAccounts(Array.isArray(d.accounts) ? d.accounts : []);
        gotDataRef.current = true; setGotData(true);
      } else if (d.type === 'flow:live') {
        if (Array.isArray(d.maps)) setMaps(d.maps);
        if (Array.isArray(d.summaries)) setSummaries(d.summaries);
        setHideAmounts(!!d.hideAmounts);
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
      const alive = post({ type: 'flow:ping', need: !gotDataRef.current });
      if (!alive) { setLinked(false); return; }
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post]);

  const writable = linked && gotData;

  // FlowBoard는 functional updater 계약을 쓴다. 낙관적 반영 후 앱 탭으로 보낸다
  // (앱 탭이 적용하고 flow:live로 되돌려 보내지만 왕복을 기다리지 않는다).
  const onUpdateMaps = useCallback((updater) => {
    const prev = mapsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    mapsRef.current = next;
    setMaps(next);
    post({ type: 'flow:maps', maps: next });
  }, [post]);

  const notice = !linked
    ? '앱 창과 연결이 끊겨 읽기 전용입니다. 앱 창을 다시 열면 자동으로 이어집니다.'
    : !gotData
      ? '앱 창에서 데이터를 불러오는 중입니다…'
      : '';

  return (
    <div className="fixed inset-0 bg-[#0b1120]">
      {notice && (
        <div className="absolute top-0 left-0 right-0 z-10 px-3 py-1.5 text-[11px] text-amber-300 bg-amber-900/30 border-b border-amber-800/50">
          {notice}
        </div>
      )}
      <FlowBoard
        open
        variant="page"
        onClose={() => { try { window.close(); } catch { /* 브라우저가 막으면 그대로 둔다 */ } }}
        maps={maps}
        onUpdateMaps={onUpdateMaps}
        portfolios={accounts}
        portfolioSummaries={summaries}
        hideAmounts={hideAmounts}
        readOnly={!writable}
      />
    </div>
  );
}
