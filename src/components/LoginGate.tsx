// @ts-nocheck
import React, { useState, useRef } from 'react';
import { GOOGLE_CLIENT_ID, ADMIN_EMAIL, APPS_SCRIPT_URL, APPROVED_SHEET_ID, APPROVED_SHEET_NAME } from '../config';

type AuthStep = 'idle' | 'loading' | 'pending' | 'requesting' | 'requested' | 'error';

interface Props {
  onApproved: (email: string, token: string) => void;
}

// 공개 구글 시트 CSV에서 승인 이메일 목록 확인
async function checkApproval(email: string): Promise<boolean> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${APPROVED_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${APPROVED_SHEET_NAME}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const text = await res.text();
    const lines = text.split('\n').slice(1); // 헤더 제거
    const approvedEmails = lines
      .map(line => line.replace(/"/g, '').trim().toLowerCase())
      .filter(Boolean);
    return approvedEmails.includes(email.toLowerCase().trim());
  } catch {
    return false;
  }
}

// 구글 userinfo API로 이메일 가져오기
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

// Apps Script에 승인 요청 이메일 발송
async function sendApprovalRequest(email: string): Promise<boolean> {
  try {
    // no-cors로 시도 (Apps Script CORS 이슈 우회)
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

export default function LoginGate({ onApproved }: Props) {
  const [step, setStep] = useState<AuthStep>('idle');
  const [userEmail, setUserEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const tokenClientRef = useRef<any>(null);

  const handleLogin = () => {
    setStep('loading');
    setErrorMsg('');

    // GIS 로드 대기 후 OAuth 실행
    const tryInit = (retries = 20) => {
      if ((window as any).google?.accounts?.oauth2) {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          callback: async (resp: any) => {
            if (resp.error || !resp.access_token) {
              setStep('error');
              setErrorMsg('로그인이 취소되었습니다. 다시 시도해 주세요.');
              return;
            }
            const token = resp.access_token;

            // 이메일 가져오기
            const email = await fetchUserEmail(token);
            if (!email) {
              setStep('error');
              setErrorMsg('이메일 정보를 가져오지 못했습니다.');
              return;
            }
            setUserEmail(email);

            // 승인 여부 확인
            const approved = await checkApproval(email);
            if (approved) {
              onApproved(email, token);
            } else {
              setStep('pending');
            }
          },
        });
        tokenClientRef.current = client;
        client.requestAccessToken({ prompt: 'select_account' });
      } else if (retries > 0) {
        setTimeout(() => tryInit(retries - 1), 300);
      } else {
        setStep('error');
        setErrorMsg('구글 로그인 스크립트를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
      }
    };
    tryInit();
  };

  const handleRequestAccess = async () => {
    setStep('requesting');
    await sendApprovalRequest(userEmail);
    setStep('requested');
  };

  const handleRetry = () => {
    setStep('idle');
    setUserEmail('');
    setErrorMsg('');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 로고/타이틀 */}
        <div className="text-center mb-10">
          <div className="text-4xl font-black text-white tracking-tight mb-2">
            포트폴리오 대시보드
          </div>
          <div className="text-gray-400 text-sm">투자 포트폴리오 관리 시스템</div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">

          {/* 기본 로그인 화면 */}
          {(step === 'idle' || step === 'loading') && (
            <div className="flex flex-col items-center gap-6">
              <div className="text-center">
                <p className="text-gray-300 text-sm leading-relaxed">
                  구글 계정으로 로그인하면<br />
                  관리자가 승인 후 이용 가능합니다.
                </p>
              </div>
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

          {/* 승인 대기 화면 */}
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
                  <span className="text-blue-400">{userEmail}</span> 계정은<br />
                  아직 승인되지 않았습니다.
                </p>
              </div>
              <button
                onClick={handleRequestAccess}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
              >
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
                  관리자에게 요청이 전달되었습니다.<br />
                  승인 후 다시 로그인해 주세요.
                </p>
              </div>
              <button
                onClick={handleRetry}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
              >
                다시 로그인
              </button>
            </div>
          )}

          {/* 오류 화면 */}
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
              <button
                onClick={handleRetry}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>

        {/* 관리자 안내 */}
        <p className="text-center text-gray-700 text-xs mt-6">
          관리자 문의: {ADMIN_EMAIL}
        </p>
      </div>
    </div>
  );
}
