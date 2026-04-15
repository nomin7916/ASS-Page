// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { APPROVED_SHEET_ID, APPS_SCRIPT_URL, ADMIN_EMAIL } from '../config';

interface ApprovedUser {
  email: string;
  resetFlag: boolean; // 구글 시트 B열 = 'RESET'이면 true
}

interface Props {
  adminEmail: string;
  onClose: () => void;
}

// Apps Script를 통해 사용자 목록 조회 (시트 비공개 유지)
async function fetchApprovedUsers(): Promise<ApprovedUser[]> {
  try {
    const url = `${APPS_SCRIPT_URL}?action=listUsers&cacheBust=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.users || []).filter((u: ApprovedUser) => u.email);
  } catch {
    return [];
  }
}

export default function AdminPage({ adminEmail, onClose }: Props) {
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApprovedUsers().then(u => {
      setUsers(u);
      setLoading(false);
    });
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    const u = await fetchApprovedUsers();
    setUsers(u);
    setLoading(false);
  };

  const handleOpenSheet = () => {
    window.open(`https://docs.google.com/spreadsheets/d/${APPROVED_SHEET_ID}/edit`, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">관리자 페이지</h1>
            <p className="text-gray-500 text-sm mt-0.5">{adminEmail}</p>
          </div>
          <button
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            대시보드로 이동
          </button>
        </div>

        {/* 승인 사용자 목록 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">
              승인된 사용자
              <span className="ml-2 text-gray-500 text-sm font-normal">
                {!loading && `(${users.length}명)`}
              </span>
            </h2>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="text-gray-400 hover:text-white text-sm transition-colors disabled:opacity-50"
            >
              새로고침
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
              <div className="w-4 h-4 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
              <span className="text-sm">불러오는 중...</span>
            </div>
          ) : users.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-6">승인된 사용자가 없습니다.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {users.map((u, i) => (
                <li key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-2.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${u.resetFlag ? 'bg-yellow-400' : 'bg-green-400'}`} />
                  <span className="text-gray-200 text-sm flex-1">{u.email}</span>
                  <div className="flex items-center gap-2 ml-auto">
                    {u.resetFlag && (
                      <span className="text-xs bg-yellow-900/60 text-yellow-300 border border-yellow-700/50 px-2 py-0.5 rounded-full">
                        PIN 초기화됨
                      </span>
                    )}
                    {u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && (
                      <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">관리자</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* 사용자 추가/시트 버튼 */}
          <div className="mt-5 pt-5 border-t border-gray-800">
            <p className="text-gray-500 text-sm mb-3">
              사용자 추가/제거는 구글 시트에서 직접 관리합니다.
            </p>
            <button
              onClick={handleOpenSheet}
              className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
              </svg>
              구글 시트에서 사용자 관리
            </button>
            <p className="text-gray-600 text-xs mt-2 text-center">
              A열에 이메일 주소를 한 줄씩 입력하세요
            </p>

            <a
              href="https://console.cloud.google.com/auth/audience?project=useful-maxim-493212-r8"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors border border-gray-700"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              Google Cloud Console (테스트 사용자 관리)
            </a>
          </div>
        </div>

        {/* PIN 관리 안내 */}
        <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider">비밀번호(PIN) 관리</p>
          <div className="text-gray-400 text-xs leading-relaxed space-y-2">
            <p>
              <span className="text-gray-200 font-medium">초기 비밀번호:</span>{' '}
              모든 사용자의 기본 비밀번호는 <span className="text-yellow-300 font-bold font-mono">0000</span>입니다.
              로그인 후 상단 <span className="text-blue-300">비번 변경</span> 버튼으로 언제든지 변경할 수 있습니다.
            </p>
            <p>
              <span className="text-gray-200 font-medium">PIN 저장 위치:</span>{' '}
              각 사용자의 PIN은 <span className="text-green-400">본인의 구글 드라이브</span>{' '}
              (Index_Data/portfolio_pin.json)에 저장됩니다.
              어느 기기/브라우저에서 로그인해도 동일한 PIN이 적용됩니다.
            </p>
            <p>
              <span className="text-gray-200 font-medium">비밀번호 초기화 (요청 시):</span>{' '}
              구글 시트 <span className="text-green-400">B열</span>에{' '}
              <span className="text-yellow-300 font-mono">RESET</span>{' '}입력 →
              해당 사용자 다음 로그인 시 <span className="text-yellow-300 font-bold">0000</span>으로 초기화됩니다.
              특정 비밀번호로 초기화하려면 <span className="text-yellow-300 font-mono">RESET:1234</span> 형식으로 입력하세요.
            </p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 font-mono text-xs text-gray-400">
            <div className="text-gray-500 mb-1">시트 B열 사용 예시</div>
            <div><span className="text-blue-400">A열(이메일)</span>{'            '}<span className="text-green-400">B열(초기화)</span></div>
            <div>arui114501@gmail.com</div>
            <div>nomin1fi@gmail.com{'    '}<span className="text-yellow-300">RESET</span><span className="text-gray-600">{'       '}← 0000으로 초기화</span></div>
            <div>user@gmail.com{'        '}<span className="text-yellow-300">RESET:5678</span><span className="text-gray-600">{'  '}← 5678로 초기화</span></div>
          </div>
        </div>

        {/* 승인 요청 안내 */}
        <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-500 text-xs leading-relaxed">
            <span className="text-yellow-400 font-semibold">승인 요청 수신:</span>{' '}
            새 사용자가 접근을 요청하면 <span className="text-gray-300">{ADMIN_EMAIL}</span>로 이메일이 자동 발송됩니다.
            이메일을 확인 후 구글 시트에 해당 이메일을 추가하면 즉시 접근이 허용됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
