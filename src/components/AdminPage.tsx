// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { APPROVED_SHEET_ID, APPROVED_SHEET_NAME, ADMIN_EMAIL } from '../config';

interface Props {
  adminEmail: string;
  onClose: () => void;
}

async function fetchApprovedEmails(): Promise<string[]> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${APPROVED_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${APPROVED_SHEET_NAME}&cacheBust=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const text = await res.text();
    return text
      .split('\n')
      .slice(1)
      .map(line => line.replace(/"/g, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export default function AdminPage({ adminEmail, onClose }: Props) {
  const [approvedEmails, setApprovedEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApprovedEmails().then(emails => {
      setApprovedEmails(emails);
      setLoading(false);
    });
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    const emails = await fetchApprovedEmails();
    setApprovedEmails(emails);
    setLoading(false);
  };

  const handleOpenSheet = () => {
    window.open(
      `https://docs.google.com/spreadsheets/d/${APPROVED_SHEET_ID}/edit`,
      '_blank'
    );
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
                {!loading && `(${approvedEmails.length}명)`}
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
          ) : approvedEmails.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-6">승인된 사용자가 없습니다.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {approvedEmails.map((email, i) => (
                <li key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="text-gray-200 text-sm">{email}</span>
                  {email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && (
                    <span className="ml-auto text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">관리자</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* 사용자 추가 안내 */}
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
          </div>
        </div>

        {/* 안내 */}
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
