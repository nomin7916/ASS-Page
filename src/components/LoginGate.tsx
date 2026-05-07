// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { GOOGLE_CLIENT_ID, ADMIN_EMAIL, APPS_SCRIPT_URL } from '../config';
import { getOrCreateIndexFolder, saveDriveFile, loadDriveFile, DRIVE_FILES } from '../driveStorage';

type AuthStep = 'idle' | 'loading' | 'pending' | 'requesting' | 'requested' | 'error' | 'pin_entry' | 'silent_auth';

export const SESSION_KEY = 'portfolio_session_email_v1';

export interface UserFeatures {
  name: string;
  feature1: boolean;
  feature2: boolean;
  feature3: boolean;
}

interface Props {
  onApproved: (email: string, token: string, features: UserFeatures) => void;
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
// 구글 시트를 비공개로 유지하고 Apps Script가 대신 조회 (보안 정책 준수)
// B열: 비어있음 = 정상, "RESET" = 초기화(0000), "RESET:1234" = 초기화(1234)
async function checkApproval(email: string): Promise<{ approved: boolean; needsReset: boolean; adminPin: string } & UserFeatures> {
  try {
    const url = `${APPS_SCRIPT_URL}?action=check&email=${encodeURIComponent(email)}&cacheBust=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return { approved: false, needsReset: false, adminPin: DEFAULT_PIN, name: '', feature1: false, feature2: false, feature3: false };
    const data = await res.json();
    // Apps Script returns { status: 'approved'/'not_approved', resetPassword: string|null, name, feature1, ... }
    return {
      approved: data.status === 'approved',
      needsReset: data.resetPassword != null,
      adminPin: data.resetPassword ?? DEFAULT_PIN,
      name: data.name ?? '',
      feature1: data.feature1 ?? false,
      feature2: data.feature2 ?? false,
      feature3: data.feature3 ?? false,
    };
  } catch {
    return { approved: false, needsReset: false, adminPin: DEFAULT_PIN, name: '', feature1: false, feature2: false, feature3: false };
  }
}

async function clearResetFlag(email: string): Promise<void> {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_reset', email }),
    });
  } catch { /* fire and forget */ }
}

async function fetchUserEmail(token: string): Promise<string | null> {
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

async function sendApprovalRequest(email: string): Promise<boolean> {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: email.split('@')[0] }),
    });
    return true;
  } catch {
    return false;
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
export default function LoginGate({ onApproved }: Props) {
  const [step, setStep] = useState<AuthStep>('idle');
  const [userEmail, setUserEmail] = useState('');
  const [userToken, setUserToken] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [resetNotice, setResetNotice] = useState(false);

  const [pinDigits, setPinDigits] = useState<string[]>(['', '', '', '']);
  const [pinError, setPinError] = useState('');

  const tokenClientRef = useRef<any>(null);
  const featuresRef = useRef<UserFeatures>({ name: '', feature1: false, feature2: false, feature3: false });

  // ── 구글 토큰 요청 공통 함수 ────────────────────────────────────
  const requestGoogleToken = (opts: { prompt: string; hint?: string; onSuccess: (email: string, token: string) => void; onFail: () => void }) => {
    const tryInit = (retries = 20) => {
      if ((window as any).google?.accounts?.oauth2) {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          hint: opts.hint,
          callback: async (resp: any) => {
            if (resp.error || !resp.access_token) {
              opts.onFail();
              return;
            }
            const token = resp.access_token;
            const email = await fetchUserEmail(token);
            if (!email) { opts.onFail(); return; }
            opts.onSuccess(email, token);
          },
        });
        tokenClientRef.current = client;
        client.requestAccessToken({ prompt: opts.prompt });
      } else if (retries > 0) {
        setTimeout(() => tryInit(retries - 1), 300);
      } else {
        opts.onFail();
      }
    };
    tryInit();
  };

  // ── 새로고침 시 자동 재인증 ─────────────────────────────────────
  useEffect(() => {
    const savedEmail = sessionStorage.getItem(SESSION_KEY);
    if (!savedEmail) return;

    setStep('silent_auth');

    requestGoogleToken({
      prompt: '',
      hint: savedEmail,
      onSuccess: async (email, token) => {
        if (email.toLowerCase() !== savedEmail.toLowerCase()) {
          sessionStorage.removeItem(SESSION_KEY);
          setStep('idle');
          return;
        }
        const { name, feature1, feature2, feature3 } = await checkApproval(email);
        onApproved(email, token, { name, feature1, feature2, feature3 });
      },
      onFail: () => {
        sessionStorage.removeItem(SESSION_KEY);
        setStep('idle');
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = () => {
    setStep('loading');
    setErrorMsg('');

    requestGoogleToken({
      prompt: 'select_account',
      onSuccess: async (email, token) => {
        setUserEmail(email);
        setUserToken(token);

        const { approved, needsReset, adminPin, name, feature1, feature2, feature3 } = await checkApproval(email);
        if (!approved) {
          setStep('pending');
          return;
        }
        featuresRef.current = { name, feature1, feature2, feature3 };

        if (needsReset) {
          const adminHash = hashPin(adminPin);
          sessionStorage.setItem(PIN_KEY(email), adminHash);
          savePinToDrive(adminHash, token, email);
          clearResetFlag(email);
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
      onFail: () => {
        setStep('error');
        setErrorMsg('로그인이 취소되었습니다. 다시 시도해 주세요.');
      },
    });
  };

  const handlePinSubmit = (pin?: string) => {
    const finalPin = pin ?? pinDigits.join('');
    if (finalPin.length < 4) return;
    if (verifyPin(finalPin, userEmail)) {
      setPinError('');
      sessionStorage.setItem(SESSION_KEY, userEmail);
      onApproved(userEmail, userToken, featuresRef.current);
    } else {
      setPinError('비밀번호가 틀렸습니다.');
      setPinDigits(['', '', '', '']);
    }
  };

  const handleRequestAccess = async () => {
    setStep('requesting');
    await sendApprovalRequest(userEmail);
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
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="text-4xl font-black text-white tracking-tight mb-2">포트폴리오 대시보드</div>
          <div className="text-gray-400 text-sm">투자 포트폴리오 관리 시스템</div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">

          {/* 자동 재인증 (새로고침) */}
          {step === 'silent_auth' && (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-300 text-sm">세션을 복원하는 중...</p>
            </div>
          )}

          {/* 구글 로그인 */}
          {(step === 'idle' || step === 'loading') && (
            <div className="flex flex-col items-center gap-6">
              <p className="text-gray-300 text-sm text-center leading-relaxed">
                구글 계정으로 로그인하면<br />관리자가 승인 후 이용 가능합니다.
              </p>
              <button
                onClick={handleLogin}
                disabled={step === 'loading'}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-900 font-semibold py-3 px-6 rounded-xl transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {step === 'loading' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />
                    <span>로그인 중...</span>
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
              {step === 'idle' && (
                <p className="text-gray-600 text-xs text-center">
                  로그인 시 구글 드라이브 접근 권한이 요청됩니다.
                </p>
              )}
            </div>
          )}

          {/* PIN 입력 */}
          {step === 'pin_entry' && (
            <div className="flex flex-col items-center gap-5">
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
                다른 계정으로 로그인
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
                <p className="text-white font-semibold mb-1">접근 권한이 없습니다</p>
                <p className="text-gray-400 text-sm">
                  <span className="text-blue-400">{userEmail}</span> 계정은<br />아직 승인되지 않았습니다.
                </p>
              </div>
              <button onClick={handleRequestAccess} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                관리자에게 승인 요청
              </button>
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
                <p className="text-white font-semibold mb-1">승인 요청 완료</p>
                <p className="text-gray-400 text-sm leading-relaxed">
                  관리자에게 요청이 전달되었습니다.<br />승인 후 다시 로그인해 주세요.
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
                <p className="text-gray-400 text-sm">{errorMsg}</p>
              </div>
              <button onClick={handleRetry} className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                다시 시도
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-gray-700 text-xs mt-6">
          관리자 문의: {ADMIN_EMAIL}
        </p>
      </div>
    </div>
  );
}
