// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import LedgerPage from './LedgerPage';
import ErrorBoundary from './ErrorBoundary';
import { normalizeLedgerBooks } from '../ledger';

/**
 * 가계부 **별도 브라우저 창** (`/?ledgerWindow=1`).
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다 — 절대 '앱 통째 부팅'으로 바꾸지 말 것.
 *    앱을 부팅하면 ① saveAllToDrive가 STATE 파일을 **통째로 덮어쓰므로** 두 창이 서로의 편집을
 *    지우고 ② sessionStorage가 복제돼 새 창이 자동 재인증 → **두 번째 writer**가 되며 세션 충돌
 *    감지에도 걸린다. **writer는 끝까지 앱 탭 하나**다(FlowWindow·BacktestWindow와 동일 규약).
 *
 * ⚠️ 렌더는 인앱 폴백과 **같은 LedgerPage 컴포넌트**를 공유한다. 창용으로 화면을 복제하면
 *    두 화면이 갈라진다.
 *
 * ⚠️ 수신 화이트리스트가 **열거형**이다(앱 측은 접두사 검사 — 비대칭). 나중에 메시지 타입을
 *    하나 추가하면 여기도 반드시 같이 늘릴 것 — CalendarWindow가 `calendar:detail`을 빠뜨려
 *    응답이 조용히 폐기되고 '영원히 로딩'이 됐던 선례가 있고, 컴파일러도 undefcheck도 못 잡는다.
 *
 * ⚠️ 자체 `ErrorBoundary label`이 필요하다. main.tsx의 루트 경계는 **label이 없어**
 *    (`isSection=false`) 렌더 예외 하나가 창 전체를 오류 페이지로 바꾼다.
 */

const PING_MS = 3000;
const LINK_TIMEOUT_MS = 12000;

export default function LedgerWindow() {
  const [books, setBooks] = useState([]);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [today, setToday] = useState('');
  // 앱이 실어 보내는 impersonation 읽기 전용 신호. ⚠️ 이건 **UI 잠금**일 뿐이고 실제 방어선은
  //    App의 ledger:books 핸들러다(창은 조작 가능한 URL로 열리므로 App 측 재확인이 정본).
  const [appReadOnly, setAppReadOnly] = useState(false);
  const [gotData, setGotData] = useState(false);
  const [linked, setLinked] = useState(true);

  const lastMsgRef = useRef(0);
  // ⚠️ 핑 타이머는 마운트 시 한 번만 만들어져 gotData state를 못 본다 → ref 미러 필수.
  //    이 값이 false인 동안 핑에 need:true를 실어 앱 탭이 전체 데이터를 보내게 한다(초기 수신 경로).
  const gotDataRef = useRef(false);
  const booksRef = useRef(books);
  booksRef.current = books;

  const post = useCallback((msg) => {
    const op = window.opener;
    if (!op || op.closed) return false;
    try { op.postMessage(msg, window.location.origin); return true; } catch { return false; }
  }, []);

  useEffect(() => { document.title = '가계부'; }, []);

  // 수신 — ⚠️ origin 검사 필수. opener 이외의 출처는 무시한다.
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (window.opener && e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type !== 'ledger:live' && d.type !== 'ledger:pong') return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      if (d.type === 'ledger:live') {
        // ⚠️ 창이 받은 것도 정규화해 채택한다(손상된 STATE가 렌더 중 던지는 것을 막는다).
        if (Array.isArray(d.books)) setBooks(normalizeLedgerBooks(d.books));
        setHideAmounts(!!d.hideAmounts);
        if (typeof d.today === 'string') setToday(d.today);
        setAppReadOnly(!!d.readOnly);
        gotDataRef.current = true; setGotData(true);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 핑 + 연결 판정. 앱 탭이 새로고침되면 그쪽 창 참조가 사라지는데, 이 핑을 받고 다시 입양해
  // 전체 데이터를 재전송한다(핑이 없으면 이 창은 영영 낡은 데이터를 들고 있게 된다).
  useEffect(() => {
    const tick = () => {
      const alive = post({ type: 'ledger:ping', need: !gotDataRef.current });
      if (!alive) { setLinked(false); return; }
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post]);

  // ⚠️ `linked`만 보고 쓰기를 열지 말 것 — lastMsgRef가 0(아직 아무 메시지도 못 받음)이면
  //    타임아웃 분기가 영원히 발동하지 않는다. gotData가 그 구멍을 덮는다.
  const writable = linked && gotData && !appReadOnly;

  // 낙관적 반영 후 앱 탭으로 보낸다(앱이 적용하고 ledger:live로 되돌려 보내지만 왕복을 기다리지 않는다).
  const onUpdateBooks = useCallback((next) => {
    if (!Array.isArray(next) || next === booksRef.current) return;
    booksRef.current = next;
    setBooks(next);
    post({ type: 'ledger:books', books: next });
  }, [post]);

  const notice = appReadOnly
    ? '관리자가 이 사용자 화면을 열람 중이라 읽기 전용입니다.'
    : !linked
    ? '앱 창과 연결이 끊겨 읽기 전용입니다. 앱 창을 다시 열면 자동으로 이어집니다.'
    : !gotData
      ? '앱 창에서 데이터를 불러오는 중입니다…'
      : '';

  return (
    <ErrorBoundary label="가계부">
      <LedgerPage
        open
        variant="page"
        books={books}
        onUpdateBooks={onUpdateBooks}
        readOnly={!writable}
        notice={notice}
        hideAmounts={hideAmounts}
        today={today}
        onClose={() => { try { window.close(); } catch { /* 브라우저가 막으면 그대로 둔다 */ } }}
      />
    </ErrorBoundary>
  );
}
