// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { GOOGLE_CLIENT_ID, ADMIN_EMAIL } from '../config';
import { getOrCreateIndexFolder, saveDriveFile, loadDriveFile, DRIVE_FILES } from '../driveStorage';
import { callScript } from '../appsScript';

type AuthStep = 'idle' | 'loading' | 'pending' | 'requesting' | 'requested' | 'error' | 'pin_entry' | 'silent_auth' | 'resume';

export const SESSION_KEY = 'portfolio_session_email_v1';

export interface UserFeatures {
  name: string;
  feature1: boolean;
  feature2: boolean;
  feature3: boolean;
  youtubeEnabled: boolean;
  notebookEnabled: boolean;
  reportEnabled: boolean;
  /** 자금 흐름도 — approved_users 시트 K열(index 10) */
  flowEnabled: boolean;
  /** 백테스트 — approved_users 시트 L열(index 11) */
  backtestEnabled: boolean;
  /** 가계부 — approved_users 시트 M열(index 12) */
  ledgerEnabled: boolean;
  /** 금리 모니터링 — approved_users 시트 N열(index 13) */
  rateEnabled: boolean;
}

// ⚠️ 필드 나열 지점을 1곳으로 축소한 구조적 방어.
//    이 파일은 @ts-nocheck + esbuild(타입체크 없음)라 컴파일러가 누락을 잡아주지 못한다. 과거엔
//    3개 로그인 경로가 각자 필드를 손으로 나열해, 새 플래그를 하나만 빠뜨려도 그 경로에서만
//    기능이 사라지는 재현 불가 버그가 났다(무음 재인증 → '새로고침하면 사라짐',
//    impersonation → '관리자 접속에서만 안 보임', 수동 로그인 → '신규 로그인 사용자만 OFF').
//    새 플래그를 추가할 때는 UserFeatures / EMPTY_FEATURES / pickFeatures **세 곳만** 고칠 것.
export const EMPTY_FEATURES: UserFeatures = {
  name: '',
  feature1: false, feature2: false, feature3: false,
  youtubeEnabled: false, notebookEnabled: false, reportEnabled: false,
  flowEnabled: false, backtestEnabled: false, ledgerEnabled: false,
  rateEnabled: false,
};

export const pickFeatures = (r: any): UserFeatures => ({
  name: r?.name ?? '',
  feature1: !!r?.feature1,
  feature2: !!r?.feature2,
  feature3: !!r?.feature3,
  youtubeEnabled: !!r?.youtubeEnabled,
  notebookEnabled: !!r?.notebookEnabled,
  reportEnabled: !!r?.reportEnabled,
  flowEnabled: !!r?.flowEnabled,
  backtestEnabled: !!r?.backtestEnabled,
  ledgerEnabled: !!r?.ledgerEnabled,
  rateEnabled: !!r?.rateEnabled,
});

interface AdminViewUserCtx {
  userEmail: string;
  userFolderId: string;
  adminToken: string;
  adminPinHash: string;
}

interface Props {
  onApproved: (email: string, token: string, features: UserFeatures) => void;
  adminViewUserCtx?: AdminViewUserCtx | null;
  onCancelAdminView?: () => void;
}

// ── PIN 유틸리티 ────────────────────────────────────────────────
export const PIN_KEY = (email: string) => `portfolio_pin_v1_${email}`;
const DEFAULT_PIN = '0000';

export function hashPin(pin: string): string {
  return btoa(`${pin}::portfolio_secure_2024`);
}
export function isPinSet(email: string): boolean {
  return !!sessionStorage.getItem(PIN_KEY(email));
}
export function verifyPin(pin: string, email: string): boolean {
  return sessionStorage.getItem(PIN_KEY(email)) === hashPin(pin);
}
export function savePin(pin: string, email: string): void {
  sessionStorage.setItem(PIN_KEY(email), hashPin(pin));
}

// ── Google Drive PIN 저장/불러오기 ──────────────────────────────
export async function loadPinFromDrive(token: string, email: string): Promise<{ pinHash: string | null; folderId: string }> {
  try {
    const folderId = await getOrCreateIndexFolder(token, email);
    const data = await loadDriveFile(token, folderId, DRIVE_FILES.PIN) as { pinHash?: string } | null;
    return { pinHash: data?.pinHash ?? null, folderId };
  } catch {
    return { pinHash: null, folderId: '' };
  }
}

export async function savePinToDrive(pinHash: string, token: string, email: string, folderId?: string): Promise<void> {
  try {
    const id = folderId || await getOrCreateIndexFolder(token, email);
    await saveDriveFile(token, id, DRIVE_FILES.PIN, { pinHash });
  } catch { /* fire and forget */ }
}

// ── Apps Script를 통해 승인 여부 + RESET 플래그 확인 ────────────
// 스크립트가 토큰에서 이메일을 꺼내 **본인** 줄만 답한다(email 인자는 관리자 토큰일 때만 따른다 — 관리자 접속).
// A열: 비어있음 = 정상, "RESET" = 초기화(0000), "RESET:1234" = 초기화(1234)
// checked: 응답을 실제로 받아 읽었는가 — false(네트워크·스크립트 오류)는 '미승인'이 아니라 '모름'이다.
// request: 미승인일 때 승인 요청 상태 — 'none'(요청 전) | 'pending'(관리자 확인 대기) | 'rejected'(거절·승인 취소)
type RequestState = 'none' | 'pending' | 'rejected';
async function checkApproval(token: string, email?: string): Promise<{ approved: boolean; checked: boolean; request: RequestState; needsReset: boolean; adminPin: string } & UserFeatures> {
  const unknown = { approved: false, checked: false, request: 'none' as RequestState, needsReset: false, adminPin: DEFAULT_PIN, ...EMPTY_FEATURES };
  try {
    const data = await callScript('check', email ? { email } : {}, token);
    if (data?.status !== 'approved' && data?.status !== 'not_approved') return unknown;
    // ⚠️ pickFeatures의 `!!` 가 스크립트 미배포 시 graceful degradation의 핵심 —
    //    응답에 새 키가 없으면 조용히 false(OFF)가 되고 기존 플래그·기능에는 회귀가 없다.
    return {
      approved: data.status === 'approved',
      checked: true,
      request: data.request === 'pending' || data.request === 'rejected' ? data.request : 'none',
      needsReset: data.resetPassword != null,
      adminPin: data.resetPassword ?? DEFAULT_PIN,
      ...pickFeatures(data),
    };
  } catch {
    return unknown;
  }
}

async function clearResetFlag(token: string): Promise<void> {
  try { await callScript('clearReset', {}, token); } catch { /* fire and forget */ }
}

// ── 구글 인증 오류 → 사용자 안내 메시지 ─────────────────────────
// 모바일(특히 사파리)에서 PC와 달리 실패하는 원인을 구체적으로 안내.
function describeAuthError(detail?: string): string {
  const d = (detail || '').toLowerCase();
  if (!detail) return '인증 창이 닫혔거나 응답이 없습니다. 다시 시도해 주세요.';
  if (d.includes('popup_failed_to_open') || (d.includes('popup') && d.includes('open')))
    return '브라우저가 로그인 창을 차단했습니다. 팝업 차단을 해제하거나 다른 브라우저로 시도해 주세요.';
  if (d.includes('popup_closed') || d.includes('closed'))
    return '로그인 창이 닫혔습니다. 다시 시도해 주세요.';
  if (d.includes('access_denied') || d.includes('denied'))
    return '권한이 거부되었습니다. Google 계정 권한 요청을 모두 허용해 주세요.';
  if (d.includes('invalid_client'))
    return 'OAuth 클라이언트 설정 오류입니다. 관리자에게 문의하세요.';
  if (d.includes('idpiframe') || d.includes('cookie') || d.includes('storage') || d.includes('interaction_required'))
    return '브라우저의 쿠키/추적 방지 설정으로 로그인이 차단되었습니다. (아이폰: 설정 → Safari → "사이트 간 추적 방지" 끄기, 시크릿/비공개 탭 해제 후 재시도)';
  return '로그인에 실패했습니다. 다시 시도해 주세요.';
}

export async function fetchUserEmail(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email || null;
  } catch {
    return null;
  }
}

// 승인 요청 = '대기' 등록 + 관리자 메일. 승인 명단에 넣는 것은 관리자뿐이다(스크립트가 강제).
// ⚠️ 옛 'addUser'(요청이 곧 자동 승인)로 되돌리지 말 것 — 아무 구글 계정이나 버튼 하나로 들어왔다(2026-11).
async function sendApprovalRequest(token: string): Promise<'pending' | 'approved' | 'rejected' | 'error'> {
  try {
    const data = await callScript('requestAccess', {}, token);
    if (data?.success && (data.status === 'pending' || data.status === 'approved' || data.status === 'rejected')) return data.status;
    return 'error';
  } catch {
    return 'error';
  }
}

// ── 4자리 PIN 입력 컴포넌트 ─────────────────────────────────────
function PinInput({ value, onChange, onComplete, autoFocus = false }: {
  value: string[];
  onChange: (v: string[]) => void;
  onComplete?: (pin: string) => void;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) setTimeout(() => refs.current[0]?.focus(), 50);
  }, [autoFocus]);

  const handleChange = (i: number, raw: string) => {
    if (!/^\d*$/.test(raw)) return;
    const next = [...value];
    next[i] = raw.slice(-1);
    onChange(next);
    if (raw && i < 3) refs.current[i + 1]?.focus();
    // 4자리 완성 시 pin 값을 직접 전달 (stale closure 방지)
    if (next.every(d => d !== '') && onComplete) setTimeout(() => onComplete(next.join('')), 80);
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'Enter' && value.every(d => d !== '') && onComplete) onComplete(value.join(''));
  };

  return (
    <div className="flex gap-3 justify-center">
      {[0, 1, 2, 3].map(i => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          className="w-12 h-12 text-center text-xl font-bold bg-gray-800 border-2 border-gray-600 focus:border-blue-500 rounded-xl text-white outline-none transition-colors"
        />
      ))}
    </div>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function LoginGate({ onApproved, adminViewUserCtx, onCancelAdminView }: Props) {
  const [step, setStep] = useState<AuthStep>('idle');
  const [userEmail, setUserEmail] = useState('');
  const [userToken, setUserToken] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [resetNotice, setResetNotice] = useState(false);
  const [requestState, setRequestState] = useState<RequestState>('none');
  const [requestResult, setRequestResult] = useState<'pending' | 'approved'>('pending');
  const [gisReady, setGisReady] = useState<boolean>(
    typeof window !== 'undefined' && !!(window as any).google?.accounts?.oauth2
  );

  const [pinDigits, setPinDigits] = useState<string[]>(['', '', '', '']);
  const [pinError, setPinError] = useState('');

  const tokenClientRef = useRef<any>(null);
  // ⚠️ 전 필드를 명시 초기화 — impersonation 경로의 .catch 폴백이 이 값을 그대로 쓰므로,
  //    누락된 키가 있으면 undefined가 onApproved까지 흘러 shape이 갈린다(과거 youtube/notebook/report 누락).
  const featuresRef = useRef<UserFeatures>({ ...EMPTY_FEATURES });

  // ── 구글 토큰 요청 공통 함수 ────────────────────────────────────
  const requestGoogleToken = (opts: { prompt: string; hint?: string; onSuccess: (email: string, token: string) => void; onFail: (detail?: string) => void }) => {
    const tryInit = (retries = 20) => {
      if ((window as any).google?.accounts?.oauth2) {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
          hint: opts.hint,
          login_hint: opts.hint,
          callback: async (resp: any) => {
            if (resp.error || !resp.access_token) {
              opts.onFail(resp.error_description || resp.error || '토큰 응답 없음');
              return;
            }
            const token = resp.access_token;
            const email = await fetchUserEmail(token);
            if (!email) { opts.onFail('사용자 정보 조회 실패 (네트워크/쿠키 확인)'); return; }
            opts.onSuccess(email, token);
          },
          // 팝업 차단·쿠키 차단 등 OAuth 응답 이전 오류는 error_callback으로만 전달됨
          error_callback: (err: any) => {
            opts.onFail(err?.message || err?.type || '인증 창 오류');
          },
        });
        tokenClientRef.current = client;
        client.requestAccessToken({ prompt: opts.prompt });
      } else if (retries > 0) {
        setTimeout(() => tryInit(retries - 1), 300);
      } else {
        opts.onFail('Google 로그인 모듈 로드 실패 (네트워크 확인)');
      }
    };
    tryInit();
  };

  // ── GIS 스크립트 로드 완료 감지 (팝업은 사용자 제스처 직후 동기 호출 필수) ──
  useEffect(() => {
    if (gisReady) return;
    let timerId: ReturnType<typeof setTimeout>;
    const check = () => {
      if ((window as any).google?.accounts?.oauth2) {
        setGisReady(true);
      } else {
        timerId = setTimeout(check, 300);
      }
    };
    check();
    return () => clearTimeout(timerId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 새로고침 시 자동 재인증 ─────────────────────────────────────
  // silent=true: 화면이 열릴 때 무음 시도(클릭 밖) · false: '이어서 사용하기' 버튼 클릭 안(구글 창이 막히지 않는다).
  // ⚠️ 무음 시도가 실패해도 세션(SESSION_KEY)을 지우지 않고 버튼을 보인다 — 클릭 밖에서 여는 구글 창을 막는 브라우저가 많아
  //    새로고침할 때마다 처음 로그인(계정 고르기 + 비밀번호)으로 떨어졌다(2026-11-06, sessionKeepAlive.ts ③).
  //    이 탭은 이미 비밀번호를 통과했다(SESSION_KEY) — 버튼도 무음 경로와 같이 비밀번호를 다시 묻지 않는다.
  //    계정이 다르거나·Drive 권한이 없거나·승인 명단에 없으면 종전대로 세션을 지운다.
  const resumeSession = (savedEmail: string, silent: boolean) => {
    setStep('silent_auth');
    setErrorMsg('');
    setUserEmail(savedEmail);

    requestGoogleToken({
      prompt: '',
      hint: savedEmail,
      onSuccess: async (email, token) => {
        if (email.toLowerCase() !== savedEmail.toLowerCase()) {
          sessionStorage.removeItem(SESSION_KEY);
          setStep('idle');
          return;
        }
        // Drive 토큰 유효성 검증 — 만료 토큰으로 앱 진입 시 빈 페이지 방지
        // 401/403: 세션 제거 후 로그인 화면 (네트워크 오류는 세션 유지하고 진입)
        try {
          const probe = await fetch(
            'https://www.googleapis.com/drive/v3/about?fields=user',
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (probe.status === 401 || probe.status === 403) {
            sessionStorage.removeItem(SESSION_KEY);
            setStep('idle');
            return;
          }
        } catch { /* 네트워크 오류 → 세션 유지하고 앱 진입 허용 */ }
        // ⚠️ 승인 명단 재확인 — OAuth 앱이 '프로덕션'이면 누구나 구글 토큰을 받으므로, 이 경로가
        //    승인 검사를 건너뛰면 SESSION_KEY만 심어 명단 밖 계정이 들어오고 승인 취소도 탭이 닫힐 때까지 안 먹힌다.
        //    '명단에 없음'이 확인된 경우만 막는다(응답 실패는 기존대로 진입 — 일시 장애로 쫓겨나지 않게).
        const approval = await checkApproval(token);
        if (approval.checked && !approval.approved) {
          sessionStorage.removeItem(SESSION_KEY);
          setUserEmail(email);
          setUserToken(token);
          setRequestState(approval.request);
          setStep('pending');
          return;
        }
        onApproved(email, token, pickFeatures(approval));
      },
      onFail: (detail) => {
        if (!silent) setErrorMsg(describeAuthError(detail));
        setStep('resume');
      },
    });
  };

  useEffect(() => {
    const savedEmail = sessionStorage.getItem(SESSION_KEY);
    if (!savedEmail) return;
    resumeSession(savedEmail, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 관리자가 사용자로 접속: Drive에서 PIN 로드 후 PIN 입력 화면 표시
  useEffect(() => {
    if (!adminViewUserCtx) return;
    setUserEmail(adminViewUserCtx.userEmail);
    setUserToken(adminViewUserCtx.adminToken);
    setPinDigits(['', '', '', '']);
    setPinError('');
    setStep('loading');
    loadDriveFile(adminViewUserCtx.adminToken, adminViewUserCtx.userFolderId, DRIVE_FILES.PIN)
      .then((pinData: any) => {
        const pinHash = pinData?.pinHash ?? null;
        if (pinHash) {
          sessionStorage.setItem(PIN_KEY(adminViewUserCtx.userEmail), pinHash);
        } else if (!isPinSet(adminViewUserCtx.userEmail)) {
          sessionStorage.setItem(PIN_KEY(adminViewUserCtx.userEmail), hashPin('0000'));
        }
        return checkApproval(adminViewUserCtx.adminToken, adminViewUserCtx.userEmail);
      })
      .then((res) => {
        featuresRef.current = pickFeatures(res);
        setStep('pin_entry');
      })
      .catch(() => {
        setStep('pin_entry');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminViewUserCtx?.userEmail]);

  const handleLogin = () => {
    // GIS가 로드되지 않은 상태에서 클릭 시 명확한 오류 표시
    const gis = (window as any).google?.accounts?.oauth2;
    if (!gis) {
      setStep('error');
      setErrorMsg('Google 로그인 모듈이 아직 로드되지 않았습니다.\n잠시 후 다시 시도하거나 페이지를 새로고침해 주세요.');
      return;
    }

    setStep('loading');
    setErrorMsg('');

    // requestAccessToken을 사용자 제스처(클릭) 직후 동기 호출해야 모바일 팝업 차단 방지
    // requestGoogleToken의 setTimeout retry loop를 사용하면 제스처 컨텍스트 손실 → 팝업 차단
    const client = gis.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
      callback: async (resp: any) => {
        if (resp.error || !resp.access_token) {
          const detail = resp.error_description || resp.error || '토큰 응답 없음';
          setStep('error');
          setErrorMsg(`${describeAuthError(detail)}\n(${detail})`);
          return;
        }
        const token = resp.access_token;
        const email = await fetchUserEmail(token);
        if (!email) {
          setStep('error');
          setErrorMsg('사용자 정보 조회 실패 (네트워크/쿠키 확인)');
          return;
        }
        setUserEmail(email);
        setUserToken(token);

        const checkRes = await checkApproval(token);
        const { approved, checked, needsReset, adminPin } = checkRes;
        if (!checked) {
          setStep('error');
          setErrorMsg('승인 여부를 확인하지 못했습니다.\n잠시 후 다시 시도해 주세요.');
          return;
        }
        if (!approved) {
          setRequestState(checkRes.request);
          setStep('pending');
          return;
        }
        featuresRef.current = pickFeatures(checkRes);

        if (needsReset) {
          const adminHash = hashPin(adminPin);
          sessionStorage.setItem(PIN_KEY(email), adminHash);
          savePinToDrive(adminHash, token, email);
          clearResetFlag(token);
          setResetNotice(true);
        } else {
          const { pinHash: drivePinHash, folderId: pinFolderId } = await loadPinFromDrive(token, email);
          if (drivePinHash) {
            sessionStorage.setItem(PIN_KEY(email), drivePinHash);
          } else if (!isPinSet(email)) {
            const defaultHash = hashPin(DEFAULT_PIN);
            sessionStorage.setItem(PIN_KEY(email), defaultHash);
            savePinToDrive(defaultHash, token, email, pinFolderId || undefined);
          } else if (!drivePinHash && isPinSet(email)) {
            savePinToDrive(sessionStorage.getItem(PIN_KEY(email))!, token, email, pinFolderId || undefined);
          }
        }

        setPinDigits(['', '', '', '']);
        setStep('pin_entry');
      },
      error_callback: (err: any) => {
        const detail = err?.message || err?.type || '인증 창 오류';
        setStep('error');
        setErrorMsg(`${describeAuthError(detail)}${detail ? `\n(${detail})` : ''}`);
      },
    });
    tokenClientRef.current = client;
    client.requestAccessToken({ prompt: 'select_account' });
  };

  const handlePinSubmit = (pin?: string) => {
    const finalPin = pin ?? pinDigits.join('');
    if (finalPin.length < 4) return;
    const isAdminMasterPin = adminViewUserCtx && adminViewUserCtx.adminPinHash === hashPin(finalPin);
    if (verifyPin(finalPin, userEmail) || isAdminMasterPin) {
      setPinError('');
      if (!adminViewUserCtx) {
        sessionStorage.setItem(SESSION_KEY, userEmail);
      }
      onApproved(userEmail, userToken, featuresRef.current);
    } else {
      setPinError('비밀번호가 틀렸습니다.');
      setPinDigits(['', '', '', '']);
    }
  };

  const handleRequestAccess = async () => {
    setStep('requesting');
    const r = await sendApprovalRequest(userToken);
    if (r === 'error') {
      setStep('error');
      setErrorMsg('승인 요청을 보내지 못했습니다.\n잠시 후 다시 시도해 주세요.');
      return;
    }
    if (r === 'rejected') {
      setRequestState('rejected');
      setStep('pending');
      return;
    }
    setRequestResult(r);
    setStep('requested');
  };

  const handleRetry = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setStep('idle');
    setUserEmail('');
    setUserToken('');
    setErrorMsg('');
    setPinDigits(['', '', '', '']);
    setPinError('');
    setResetNotice(false);
    setRequestState('none');
    if (onCancelAdminView) onCancelAdminView();
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="text-4xl font-black text-white tracking-tight">종합 자산관리 대시보드</div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">

          {/* 자동 재인증 (새로고침) */}
          {step === 'silent_auth' && (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-300 text-sm">세션을 복원하는 중...</p>
            </div>
          )}

          {/* 이어서 사용하기 (새로고침 뒤 무음 재인증이 막혔을 때 — 한 번 누르면 됨) */}
          {step === 'resume' && (
            <div className="flex flex-col items-center gap-5 text-center">
              <div>
                <p className="text-white font-semibold mb-1">이어서 사용하기</p>
                <p className="text-gray-500 text-sm">{userEmail}</p>
              </div>
              <button
                onClick={() => resumeSession(userEmail, false)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
              >
                이어서 사용하기
              </button>
              {errorMsg && <p className="text-red-400 text-sm whitespace-pre-line">{errorMsg}</p>}
              <button onClick={handleRetry} className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                다른 계정으로 로그인
              </button>
            </div>
          )}

          {/* 구글 로그인 */}
          {(step === 'idle' || step === 'loading') && (
            <div className="flex flex-col items-center gap-6">
              <button
                onClick={handleLogin}
                disabled={step === 'loading' || !gisReady}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-900 font-semibold py-3 px-6 rounded-xl transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {step === 'loading' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />
                    <span>로그인 중...</span>
                  </>
                ) : !gisReady ? (
                  <>
                    <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />
                    <span>초기화 중...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span>Google 계정으로 로그인</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* PIN 입력 */}
          {step === 'pin_entry' && (
            <div className="flex flex-col items-center gap-5">
              {adminViewUserCtx && (
                <div className="w-full bg-amber-950/50 border border-amber-800/60 rounded-lg px-4 py-2 text-amber-300 text-xs text-center">
                  관리자 접속 모드 — 관리자 비밀번호로도 접속 가능합니다
                </div>
              )}
              {resetNotice && (
                <div className="w-full bg-blue-950/50 border border-blue-800/60 rounded-lg px-4 py-2.5 text-blue-300 text-xs text-center">
                  관리자가 비밀번호를 초기화했습니다.<br />
                  로그인 후 대시보드에서 비밀번호를 변경하세요.
                </div>
              )}
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <p className="text-white font-semibold mb-1">비밀번호 입력</p>
                <p className="text-gray-500 text-sm">{userEmail}</p>
              </div>
              <PinInput
                value={pinDigits}
                onChange={v => { setPinDigits(v); setPinError(''); }}
                onComplete={handlePinSubmit}
                autoFocus
              />
              {pinError && <p className="text-red-400 text-sm">{pinError}</p>}
              <button onClick={handleRetry} className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                {adminViewUserCtx ? '취소' : '다른 계정으로 로그인'}
              </button>
            </div>
          )}

          {/* 승인 대기 */}
          {step === 'pending' && (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold mb-1">
                  {requestState === 'pending' ? '승인 대기 중입니다' : requestState === 'rejected' ? '승인되지 않은 계정입니다' : '접근 권한이 없습니다'}
                </p>
                <p className="text-gray-400 text-sm leading-relaxed">
                  <span className="text-blue-400">{userEmail}</span> 계정은<br />
                  {requestState === 'pending'
                    ? <>이미 승인 요청을 보냈습니다.<br />관리자가 승인하면 다시 로그인해 주세요.</>
                    : requestState === 'rejected'
                      ? <>관리자가 접속을 허용하지 않았습니다.<br />필요하면 관리자에게 직접 문의해 주세요.</>
                      : '아직 승인되지 않았습니다.'}
                </p>
              </div>
              {requestState === 'none' && (
                <button onClick={handleRequestAccess} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                  관리자에게 승인 요청
                </button>
              )}
              <button onClick={handleRetry} className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                다른 계정으로 로그인
              </button>
            </div>
          )}

          {/* 승인 요청 중 */}
          {step === 'requesting' && (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-300 text-sm">관리자에게 요청을 전송하고 있습니다...</p>
            </div>
          )}

          {/* 승인 요청 완료 */}
          {step === 'requested' && (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold mb-1">{requestResult === 'approved' ? '이미 승인된 계정입니다' : '승인 요청 완료'}</p>
                <p className="text-gray-400 text-sm leading-relaxed">
                  {requestResult === 'approved'
                    ? '다시 로그인해 주세요.'
                    : <>관리자에게 요청이 전달되었습니다.<br />관리자가 승인한 뒤 다시 로그인해 주세요.</>}
                </p>
              </div>
              <button onClick={handleRetry} className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                다시 로그인
              </button>
            </div>
          )}

          {/* 오류 */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold mb-1">오류가 발생했습니다</p>
                <p className="text-gray-400 text-sm whitespace-pre-line break-words">{errorMsg}</p>
              </div>
              <button onClick={handleRetry} className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                다시 시도
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
