// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import WatchlistPopup from './WatchlistPopup';
import ErrorBoundary from './ErrorBoundary';

/**
 * 관심종목 **별도 브라우저 창** (`/?watchlistWindow=1`).
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다 — 절대 '앱 통째 부팅'으로 바꾸지 말 것.
 *    앱을 부팅하면 ① saveAllToDrive가 STATE 파일을 **통째로 덮어쓰므로** 두 창이 서로의 편집을
 *    지우고 ② sessionStorage가 복제돼 새 창이 자동 재인증 → **두 번째 writer**가 되며 세션 충돌
 *    감지에도 걸린다. **writer는 끝까지 앱 탭 하나**다(LedgerWindow·FlowWindow와 동일 규약).
 *
 * ⚠️ 렌더는 인앱 팝업과 **같은 WatchlistPopup 컴포넌트**를 공유한다(variant='page').
 *    창용으로 화면을 복제하면 두 화면이 갈라진다.
 *
 * ✅ 다른 창들과 결정적으로 다른 점: **시세는 이 창이 스스로 조회한다.**
 *    `watchlistQuote.ts` → `api.ts`의 fetcher는 공개 프록시/Edge 함수만 쓰고 인증 토큰도
 *    Drive도 필요 없다. 그래서 브릿지는 `watchlistGroups` 배열 하나만 양방향으로 나른다
 *    (달력·가계부 창처럼 무거운 원자재 채널이 없다 → 채널도 하나뿐).
 *
 * ⚠️ 채널을 둘로 쪼개지 말 것 — 두 채널이 각각 `gotData`를 세우게 되어, 그룹이 도착하기 전에
 *    쓰기가 열리고 저장된 관심종목 전체가 빈 배열로 덮이는 경로가 생긴다(CalendarWindow 선례).
 *
 * ⚠️ 수신 화이트리스트가 **열거형**이다(앱 측은 접두사 검사 — 비대칭). 메시지 타입을 하나
 *    추가하면 여기도 반드시 같이 늘릴 것 — CalendarWindow가 `calendar:detail`을 빠뜨려 응답이
 *    조용히 폐기되고 '영원히 로딩'이 됐던 선례가 있고, 컴파일러도 undefcheck도 못 잡는다.
 *
 * ⚠️ 자체 `ErrorBoundary label`이 필요하다. main.tsx의 루트 경계는 **label이 없어**
 *    (`isSection=false`) 렌더 예외 하나가 창 전체를 오류 페이지로 바꾼다.
 */

const PING_MS = 3000;
const LINK_TIMEOUT_MS = 12000;

export default function WatchlistWindow() {
  const [groups, setGroups] = useState([]);
  // 앱이 실어 보내는 impersonation 읽기 전용 신호. ⚠️ 이건 **UI 잠금**일 뿐이고 실제 방어선은
  //    App의 watchlist:groups 핸들러다(창은 조작 가능한 URL로 열리므로 App 측 재확인이 정본).
  const [appReadOnly, setAppReadOnly] = useState(false);
  /**
   * 앱 탭의 STATE 로드 상태 — `'loading' | 'ready' | 'error'`.
   * ⚠️ **초기값과 미지정은 `'loading'`(fail-closed)**. 값이 없다고 쓰기를 열면 이 필드가 존재하는
   *    이유(로드 전 편집 차단)가 통째로 사라진다. `watchlistGroups`는 백업 복원 sticky
   *    (`_preserveStickyPersonalData`)라 빈 배열이 한 번 덮으면 **백업으로도 되돌릴 수 없다** —
   *    가계부가 2026-08-30에 정확히 이 사고를 냈다. 최악의 경우는 '창이 읽기 전용으로 남음'
   *    (새로고침으로 복구)이고, 반대편은 되돌릴 수 없는 유실이라 비대칭이 이 방향을 강제한다.
   */
  const [appDataState, setAppDataState] = useState('loading');
  const [gotData, setGotData] = useState(false);
  const [linked, setLinked] = useState(true);

  const lastMsgRef = useRef(0);
  // ⚠️ 핑 타이머는 마운트 시 한 번만 만들어져 gotData state를 못 본다 → ref 미러 필수.
  //    이 값이 false인 동안 핑에 need:true를 실어 앱 탭이 전체 데이터를 보내게 한다(초기 수신 경로).
  const gotDataRef = useRef(false);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const post = useCallback((msg) => {
    const op = window.opener;
    if (!op || op.closed) return false;
    try { op.postMessage(msg, window.location.origin); return true; } catch { return false; }
  }, []);

  useEffect(() => { document.title = '관심종목'; }, []);

  // 수신 — ⚠️ origin 검사 필수. opener 이외의 출처는 무시한다.
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (window.opener && e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type !== 'watchlist:live' && d.type !== 'watchlist:pong') return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      if (d.type === 'watchlist:live') {
        if (Array.isArray(d.groups)) {
          groupsRef.current = d.groups;
          setGroups(d.groups);
        }
        setAppReadOnly(!!d.readOnly);
        // ⚠️ 화이트리스트 — 모르는 값은 `'loading'`으로 떨어뜨린다(fail-closed).
        setAppDataState(d.dataState === 'ready' || d.dataState === 'error' ? d.dataState : 'loading');
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
      const alive = post({ type: 'watchlist:ping', need: !gotDataRef.current });
      if (!alive) { setLinked(false); return; }
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post]);

  // ⚠️ `linked`만 보고 쓰기를 열지 말 것 — lastMsgRef가 0(아직 아무 메시지도 못 받음)이면
  //    타임아웃 분기가 영원히 발동하지 않는다. gotData가 그 구멍을 덮는다.
  // ⚠️ **`gotData`만으로도 부족하다** — 그건 '메시지가 왔다'일 뿐 '앱이 Drive를 다 읽었다'가
  //    아니다. 로드 전 메시지는 `groups: []`를 실어 오므로, 이 조건이 없으면 창이 편집 가능한
  //    빈 목록을 띄우고 거기서 그룹 하나만 만들어도 **저장된 관심종목을 덮는다**.
  const writable = linked && gotData && !appReadOnly && appDataState === 'ready';

  /**
   * ⚠️ WatchlistPopup은 `onUpdateGroups`에 **functional updater**를 넘긴다(호출부 10곳).
   *    그래서 여기서 직접 적용해 결과 배열을 앱으로 보낸다.
   * ⚠️ `groupsRef`로 **동기** 합성할 것 — `addStock` 직후 `loadQuote`의 이름 캐시처럼 한 tick에
   *    연달아 두 번 부르는 경로가 있어, state만 읽으면 뒤 호출이 앞 호출을 통째로 덮는다.
   * ⚠️ setState 업데이터 **안에서** post하지 말 것 — StrictMode 이중 호출로 두 번 전송된다.
   */
  const onUpdateGroups = useCallback((updater) => {
    const prev = groupsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (!Array.isArray(next) || next === prev) return;   // 변화 없음 → 헛된 전송·저장 방지
    groupsRef.current = next;
    setGroups(next);
    post({ type: 'watchlist:groups', groups: next });
  }, [post]);

  /**
   * ⚠️ 상태마다 **다른 문구**를 낼 것 — "아직 안 불러왔다"와 "저장된 게 없다"를 구분하지 못하면
   *    사용자가 유실로 오해하고 새로 입력하는데, 그 입력이 정확히 기존 목록을 덮는 경로다.
   * ⚠️ 순서 주의 — `error`를 `loading`보다 **먼저** 판정한다(실패를 '불러오는 중'으로 감추지 않는다).
   */
  const notice = appReadOnly
    ? '관리자가 이 사용자 화면을 열람 중이라 읽기 전용입니다.'
    : !linked
      ? '앱 창과 연결이 끊겨 읽기 전용입니다. 앱 창을 다시 열면 자동으로 이어집니다.'
      : appDataState === 'error'
        ? '앱 창이 데이터를 불러오지 못했습니다 — 저장된 관심종목을 덮어쓰지 않도록 편집을 잠갔습니다. 앱 창을 새로고침한 뒤 다시 여세요.'
        : (!gotData || appDataState !== 'ready')
          ? '앱 창에서 관심종목을 불러오는 중입니다… 끝나면 편집이 자동으로 열립니다(아직 목록이 안 보여도 그룹을 다시 만들지 마세요).'
          : '';

  return (
    <ErrorBoundary label="관심종목">
      <WatchlistPopup
        open
        variant="page"
        groups={groups}
        onUpdateGroups={onUpdateGroups}
        readOnly={!writable}
        notice={notice}
        onClose={() => { try { window.close(); } catch { /* 브라우저가 막으면 그대로 둔다 */ } }}
      />
    </ErrorBoundary>
  );
}
