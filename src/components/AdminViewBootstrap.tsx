// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID, ADMIN_EMAIL } from '../config';
import { findUserIndexFolder } from '../driveStorage';
import { fetchUserEmail, loadPinFromDrive, PIN_KEY } from './LoginGate';

// 새 탭 관리자 접속(impersonation) 콜드부팅 컴포넌트.
// URL ?adminView=<email> 로 열린 새 탭에서: 관리자 GIS 무음 재인증 → 토큰 소유자가 관리자인지 검증 →
// 대상 사용자 Drive 폴더 검색 → 관리자 PIN 해시(마스터 키) 확보 → onReady(ctx) 로 LoginGate impersonation 경로에 전달.
// 관리자 포털 탭은 손대지 않으므로(별 탭) 포털의 조회 캐시가 그대로 유지된다.

interface AdminViewCtx {
  userEmail: string;
  userFolderId: string;
  adminToken: string;
  adminPinHash: string;
}

interface Props {
  targetEmail: string;
  onReady: (ctx: AdminViewCtx) => void;
}

type Status = 'loading' | 'needAuth' | 'error';

export default function AdminViewBootstrap({ targetEmail, onReady }: Props) {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  // interactive=false: prompt:'' 무음 인증(제스처 불필요). interactive=true: 'select_account' 팝업(버튼 클릭 제스처 필수).
  const run = (interactive: boolean) => {
    setStatus('loading');
    setMessage('');
    const tryInit = (retries = 20) => {
      const oauth = (window as any).google?.accounts?.oauth2;
      if (oauth) {
        const client = oauth.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          // 관리자 경로는 전체 drive 스코프(findUserIndexFolder가 소유자 기준 검색에 필요) — 기존 동일탭 경로와 동일.
          scope: 'openid email profile https://www.googleapis.com/auth/drive',
          hint: ADMIN_EMAIL,
          callback: async (resp: any) => {
            if (resp.error || !resp.access_token) {
              if (interactive) {
                setStatus('error');
                setMessage(`관리자 인증에 실패했습니다 (${resp.error || '응답 없음'}).`);
              } else {
                // 무음 실패(미인증/동의 필요) — 사용자 제스처로 재인증 유도
                setStatus('needAuth');
              }
              return;
            }
            const adminToken = resp.access_token;
            // URL 파라미터는 신뢰 불가 → OAuth 신원으로 관리자 여부 게이팅
            let email = '';
            try { email = (await fetchUserEmail(adminToken)) || ''; } catch {}
            if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
              setStatus('error');
              setMessage('관리자 계정으로 로그인되어 있지 않습니다.\n관리자 Google 계정으로 다시 인증해 주세요.');
              return;
            }
            // 대상 사용자 Drive 폴더 검색
            let userFolderId: string | null = null;
            try {
              userFolderId = await findUserIndexFolder(adminToken, targetEmail);
            } catch (e) {
              const msg = e instanceof Error ? e.message : '';
              setStatus('error');
              setMessage(
                msg === 'TOKEN_EXPIRED' ? '관리자 인증이 만료되었습니다. 다시 인증해 주세요.' :
                msg === 'PERMISSION_DENIED' ? `Drive 접근 권한 없음: ${targetEmail} 폴더에 접근할 수 없습니다.` :
                `폴더 검색 오류 (${msg || '네트워크'}). 잠시 후 다시 시도해 주세요.`
              );
              return;
            }
            if (!userFolderId) {
              setStatus('error');
              setMessage(`${targetEmail} 사용자가 아직 앱에 로그인한 적이 없습니다.\n해당 사용자가 1회 접속하면 Drive 폴더가 생성되어 접속할 수 있습니다.`);
              return;
            }
            // 관리자 PIN 해시(LoginGate 마스터 키) — 새 탭은 sessionStorage가 비어 있을 수 있어 관리자 Drive에서 로드.
            let adminPinHash = '';
            try { adminPinHash = sessionStorage.getItem(PIN_KEY(ADMIN_EMAIL)) || ''; } catch {}
            if (!adminPinHash) {
              try { const { pinHash } = await loadPinFromDrive(adminToken, ADMIN_EMAIL); adminPinHash = pinHash || ''; } catch {}
            }
            if (doneRef.current) return;
            doneRef.current = true;
            onReady({ userEmail: targetEmail, userFolderId, adminToken, adminPinHash });
          },
          error_callback: (err: any) => {
            if (interactive) {
              setStatus('error');
              setMessage(err?.message || err?.type || '인증 창 오류');
            } else {
              setStatus('needAuth');
            }
          },
        });
        client.requestAccessToken({ prompt: interactive ? 'select_account' : '' });
      } else if (retries > 0) {
        setTimeout(() => tryInit(retries - 1), 300);
      } else {
        setStatus('error');
        setMessage('Google 로그인 모듈 로드 실패 (네트워크 확인)');
      }
    };
    tryInit();
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run(false); // 무음 인증 먼저 시도
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closeTab = () => {
    window.close();
    // window.open 으로 열린 탭이 아니어서 close가 막히는 경우 → 파라미터 없는 깨끗한 루트로 이동
    setTimeout(() => { try { window.location.replace(window.location.origin + '/'); } catch {} }, 150);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="text-4xl font-black text-white tracking-tight">종합 자산관리 대시보드</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-300 text-sm leading-relaxed">
                <span className="text-gray-400">{targetEmail}</span><br />
                사용자 대시보드를 여는 중...
              </p>
            </div>
          )}
          {status === 'needAuth' && (
            <div className="flex flex-col items-center gap-5 text-center py-2">
              <p className="text-gray-300 text-sm leading-relaxed">
                관리자 인증이 필요합니다.<br />
                아래 버튼을 눌러 관리자 Google 계정으로 인증해 주세요.
              </p>
              <button
                onClick={() => run(true)}
                className="w-full bg-white hover:bg-gray-100 text-gray-900 font-semibold py-3 px-6 rounded-xl transition-colors"
              >
                관리자로 인증
              </button>
              <button onClick={closeTab} className="text-gray-500 hover:text-gray-300 text-xs">이 탭 닫기</button>
            </div>
          )}
          {status === 'error' && (
            <div className="flex flex-col items-center gap-5 text-center py-2">
              <p className="text-red-300 text-sm whitespace-pre-line leading-relaxed">{message}</p>
              <button
                onClick={() => run(true)}
                className="w-full bg-white hover:bg-gray-100 text-gray-900 font-semibold py-3 px-6 rounded-xl transition-colors"
              >
                다시 시도
              </button>
              <button onClick={closeTab} className="text-gray-500 hover:text-gray-300 text-xs">이 탭 닫기</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
