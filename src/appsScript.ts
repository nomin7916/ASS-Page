import { APPS_SCRIPT_URL } from './config';

// ── 승인 스크립트(Apps Script) 호출 단일 관문 (⚠️ 회귀 주의 — CLAUDE.md '접속 승인·스크립트 권한' 절) ──
// 스크립트 주소는 사이트 코드에 들어 있어 누구나 알 수 있다 → 문을 지키는 곳은 스크립트다.
// 스크립트는 본문의 token(구글 로그인 액세스 토큰)으로 호출자 이메일을 확인하고 본인·승인 사용자·관리자로 권한을 가른다.
// ⚠️ 이 파일 밖에서 APPS_SCRIPT_URL로 직접 fetch하지 말 것(verify:access가 막는다) — 토큰이 빠지면 전부 거부된다.
// POST + text/plain: 사전 요청(OPTIONS) 없이 응답을 읽을 수 있는 형태다(Apps Script는 OPTIONS를 받지 않는다).

type TokenGetter = () => string | null | undefined;
type TokenRefresher = () => Promise<string | null>;

let getToken: TokenGetter = () => '';
let refreshToken: TokenRefresher | null = null;
let refreshing: Promise<string | null> | null = null;

export function registerScriptAuth(getter: TokenGetter, refresher: TokenRefresher | null): void {
  getToken = getter;
  refreshToken = refresher;
}

async function post(action: string, params: Record<string, unknown>, token: string): Promise<any> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ...params, action, token }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 토큰을 넘기면(로그인 화면 — 방금 받은 토큰) 그대로 쓰고, 생략하면 앱의 로그인 토큰을 쓴다.
// 앱 토큰이 만료(1시간)돼 authError가 오면 무음 재발급 1회 뒤 다시 보낸다(15초 안에 못 받으면 원래 응답을 돌려준다).
// 네트워크 오류·HTTP 오류·본문 해석 실패는 던진다 — 호출부가 실패로 처리한다.
export async function callScript(action: string, params: Record<string, unknown> = {}, token?: string): Promise<any> {
  const data = await post(action, params, token || getToken() || '');
  if (!data?.authError || token || !refreshToken) return data;
  if (!refreshing) {
    refreshing = Promise.race([
      refreshToken().catch(() => null),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 15000)),
    ]).finally(() => { refreshing = null; });
  }
  const fresh = await refreshing;
  return fresh ? post(action, params, fresh) : data;
}
