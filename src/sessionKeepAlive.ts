// 로그인 유지(사용 중 재로그인 없애기) — 숫자·판정은 여기 한 곳. ⚠️ import 0 — verify:session이 직접 import한다.
// 사용자 요청(2026-11-06): 꼭 필요한 경우가 아니면 다시 로그인하지 않게 한다.
// 재로그인이 생기던 길 셋:
//  ① 비활동 자동 로그아웃(옛 50분) — 클릭·키만 세어 스크롤·읽기만 하는 사용, 별도 창(금리·흐름도·관심종목 등)에서 하는
//     작업이 '비활동'으로 잡혔다 → 로그아웃 → 구글 로그인 + 비밀번호.
//  ② 구글 로그인 토큰(1시간) 만료 — 재발급은 구글 작은 창(팝업)을 잠깐 여는데, 저장 실패·타이머 같은 클릭 밖에서 열면
//     브라우저가 막는다 → 'Drive 인증 만료'. 그래서 토큰이 낡으면 **사용자가 누른 클릭 안에서** 미리 받는다
//     (앱 탭은 useDriveSync, 별도 창은 아래 installActivityRelay가 받아 앱 탭에 넘긴다).
//  ③ 새로고침 뒤 자동 재인증도 클릭 밖이라 막히면 처음 로그인(계정 고르기 + 비밀번호)으로 떨어졌다
//     → LoginGate가 '이어서 사용하기' 버튼(한 번 누름)을 보여 준다.

// 이만큼 아무 조작이 없으면 자동 로그아웃 안내(60초 뒤 로그아웃). 탭을 열어 둔 채 자리를 비운 경우의 안전장치만 남긴다.
export const IDLE_LOGOUT_MS = 4 * 60 * 60 * 1000;

export function idleLogoutLabel(ms: number = IDLE_LOGOUT_MS): string {
  const min = Math.round(ms / 60000);
  return min % 60 === 0 ? `${min / 60}시간` : `${min}분`;
}

// 앱 탭 로그인 토큰의 권한 범위 — 별도 창이 대신 받을 때도 같아야 한다(LoginGate 두 곳의 글자와 같다 — verify:session이 대조).
export const LOGIN_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly';

// 구글 로그인 토큰은 1시간짜리다. 받은 지 이만큼 지나면 다음 클릭에서 새로 받는다(만료 20분 전부터).
export const TOKEN_REFRESH_AGE_MS = 40 * 60 * 1000;
// 미리 받기를 시도한 뒤 이만큼은 다시 시도하지 않는다 — 막히거나 닫혀도 클릭마다 창이 뜨지 않게.
export const TOKEN_RETRY_GAP_MS = 60 * 1000;
// 401로 '이미 끝난 토큰'이 확인됐을 때 받은 시각을 이 값으로 둔다 — 나이와 상관없이 다음 클릭에서 바로 받는다.
export const TOKEN_DEAD = 1;

export function isTokenStale(now: number, issuedAt: number): boolean {
  return issuedAt > 0 && now - issuedAt >= TOKEN_REFRESH_AGE_MS;
}

export function shouldRefreshToken(now: number, issuedAt: number, lastTryAt: number): boolean {
  return isTokenStale(now, issuedAt) && now - (lastTryAt || 0) >= TOKEN_RETRY_GAP_MS;
}

// 사용 중으로 셀 조작 — 앱 탭(document 캡처 단계)과 별도 창이 같은 목록을 쓴다.
// scroll·wheel·mousemove: 화면을 읽기만 하는 사용도 '사용 중'이다(옛 목록은 클릭·키·터치뿐).
export const ACTIVITY_EVENTS = ['mousedown', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'mousemove'];

// 별도 창 ↔ 앱 탭 메시지(같은 출처만).
//  app:activity    창 → opener   조작 신호(10초에 한 번). 창이 연 창(관심종목 → 종목 차트)은 중간 창이 위로 전달한다.
//  app:tokenWanted 앱 탭 → 창    '토큰이 낡았다 — 네 다음 클릭에서 받아 달라'(활동 신호의 답, 계정·범위를 함께 보낸다)
//  app:tokenFresh  창 → 앱 탭    창이 자기 클릭 안에서 받은 토큰. 앱 탭은 계정을 확인한 뒤에만 쓴다.
export const ACTIVITY_MSG = 'app:activity';
export const TOKEN_WANTED_MSG = 'app:tokenWanted';
export const TOKEN_FRESH_MSG = 'app:tokenFresh';
export const ACTIVITY_THROTTLE_MS = 10 * 1000;

const typeOf = (data: unknown): unknown => (data && typeof data === 'object' ? (data as { type?: unknown }).type : undefined);

export function isActivityMessage(data: unknown): boolean {
  return typeOf(data) === ACTIVITY_MSG;
}

export type TokenWanted = { hint: string; clientId: string; scope: string };

export function parseTokenWanted(data: unknown): TokenWanted | null {
  if (typeOf(data) !== TOKEN_WANTED_MSG) return null;
  const d = data as Record<string, unknown>;
  const ok = (v: unknown) => typeof v === 'string' && v.length > 0;
  if (!ok(d.hint) || !ok(d.clientId) || !ok(d.scope)) return null;
  return { hint: d.hint as string, clientId: d.clientId as string, scope: d.scope as string };
}

export function freshTokenOf(data: unknown): string {
  if (typeOf(data) !== TOKEN_FRESH_MSG) return '';
  const t = (data as { token?: unknown }).token;
  return typeof t === 'string' ? t : '';
}

// 별도 창에서 부른다(main.tsx). ① 창의 조작과 자식 창의 신호를 10초에 한 번만 opener에게 보낸다.
// ② opener가 tokenWanted로 답하면 **이 창의 다음 클릭 안에서** 구글 토큰을 받아 opener에게 넘긴다 —
//    창에서만 1시간 넘게 일할 때(앱 탭을 누르지 않음) 앱 탭 토큰이 끝나 저장·조회가 멈추던 것.
//    클릭 권한은 창마다 따로라 앱 탭이 대신 열 수 없다. 창이 클릭 처리에서 이미 창을 열었으면(isActive=false) 미룬다.
export function installActivityRelay(win: any, now: () => number = Date.now): () => void {
  let last = -Infinity;
  let lastTry = -Infinity;
  let wanted: TokenWanted | null = null;
  const send = () => {
    const t = now();
    if (t - last < ACTIVITY_THROTTLE_MS) return;
    const op = win.opener;
    if (!op || op.closed) return;
    last = t;
    try { op.postMessage({ type: ACTIVITY_MSG }, win.location.origin); } catch { /* opener 닫힘 */ }
  };
  const onMsg = (e: any) => {
    if (e.origin !== win.location.origin) return;
    if (e.source === win.opener) {
      const w = parseTokenWanted(e.data);
      if (w) wanted = w;
      return;
    }
    if (isActivityMessage(e.data)) send();
  };
  const onClick = () => {
    if (!wanted) return;
    const t = now();
    if (t - lastTry < TOKEN_RETRY_GAP_MS) return;
    const ua = win.navigator?.userActivation;
    if (ua && !ua.isActive) return;
    const oauth = win.google?.accounts?.oauth2;
    const op = win.opener;
    if (!oauth || !op || op.closed) return;
    const w = wanted;
    wanted = null;
    lastTry = t;
    try {
      const client = oauth.initTokenClient({
        client_id: w.clientId,
        scope: w.scope,
        login_hint: w.hint,
        hint: w.hint,
        callback: (resp: any) => {
          const tok = resp && !resp.error && typeof resp.access_token === 'string' ? resp.access_token : '';
          if (!tok) return;
          try { op.postMessage({ type: TOKEN_FRESH_MSG, token: tok }, win.location.origin); } catch { /* opener 닫힘 */ }
        },
        error_callback: () => { /* 막힘·닫힘 — 앱 탭이 다음 활동 신호에 다시 묻는다 */ },
      });
      client.requestAccessToken({ prompt: '' });
    } catch { /* GIS 오류 — 다음 기회에 */ }
  };
  ACTIVITY_EVENTS.forEach(ev => win.addEventListener(ev, send, true));
  win.addEventListener('message', onMsg);
  win.addEventListener('click', onClick);
  return () => {
    ACTIVITY_EVENTS.forEach(ev => win.removeEventListener(ev, send, true));
    win.removeEventListener('message', onMsg);
    win.removeEventListener('click', onClick);
  };
}
