// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { Settings, Lock, Link2, LogOut, FileSpreadsheet, Power, LayoutDashboard, Calculator, Youtube } from 'lucide-react';
import { ADMIN_EMAIL } from '../config';

function NotebookLMIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M9 8.5a3 3 0 0 1 6 0" />
      <rect x="8.5" y="10.5" width="2" height="2.5" rx="1" />
      <rect x="13.5" y="10.5" width="2" height="2.5" rx="1" />
    </svg>
  );
}

export default function UserInfoBar({
  email,
  adminAccessAllowed,
  onOpenAdmin,
  onOpenAdminPortal,
  onOpenPinChange,
  onToggleAdminAccess,
  onLogout,
  canAccessDividendTax,
  onOpenDividendTax,
  onAppClose,
  showCalculator,
  onToggleCalculator,
  youtubeUrl,
  notebookLinks = [],
}) {
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const [notebookOpen, setNotebookOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!notebookOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setNotebookOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notebookOpen]);

  return (
    <div className="flex items-center justify-between text-xs text-gray-500 px-1">
      <span className="font-mono">{email}</span>
      <div className="flex items-center gap-1">
        {onToggleCalculator && (
          <button
            onClick={onToggleCalculator}
            title={showCalculator ? '계산기 닫기' : '계산기 열기'}
            className={`p-1.5 rounded border transition-colors flex items-center justify-center ${
              showCalculator
                ? 'text-orange-400 bg-orange-900/20 border-orange-700/40 hover:bg-orange-900/30 hover:text-orange-300'
                : 'text-gray-500 hover:text-orange-300 hover:bg-gray-800 border-transparent hover:border-gray-700'
            }`}
          >
            <Calculator size={14} />
          </button>
        )}
        {youtubeUrl ? (
          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="YouTube 채널 바로가기"
            className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
          >
            <Youtube size={14} />
          </a>
        ) : (
          <span
            title="YouTube 링크 없음"
            className="text-gray-700 p-1.5 rounded border border-transparent flex items-center justify-center cursor-default"
          >
            <Youtube size={14} />
          </span>
        )}
        {/* 노트북LM 링크 드롭다운 */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => notebookLinks.length > 0 && setNotebookOpen(v => !v)}
            title={notebookLinks.length > 0 ? '학습 자료 바로가기' : '학습 자료 없음'}
            className={`p-1.5 rounded border transition-colors flex items-center justify-center ${
              notebookLinks.length === 0
                ? 'text-gray-700 border-transparent cursor-default'
                : notebookOpen
                  ? 'text-sky-400 bg-sky-900/20 border-sky-700/40'
                  : 'text-gray-500 hover:text-sky-400 hover:bg-gray-800 border-transparent hover:border-gray-700'
            }`}
          >
            <NotebookLMIcon size={14} />
          </button>
          {notebookOpen && notebookLinks.length > 0 && (
            <div className="absolute right-0 top-full mt-1.5 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden min-w-[220px] max-w-[300px]">
              <div className="px-3 py-2 border-b border-gray-800">
                <span className="text-gray-500 text-xs font-semibold">학습 자료</span>
              </div>
              <ul className="py-1 max-h-64 overflow-y-auto">
                {notebookLinks.map((link, i) => (
                  <li key={i}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setNotebookOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-800 transition-colors group"
                    >
                      <span className="flex-shrink-0 text-sky-500 group-hover:text-sky-400 transition-colors">
                        <NotebookLMIcon size={13} />
                      </span>
                      <span className="text-gray-300 text-xs group-hover:text-white transition-colors truncate">
                        {link.title}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="w-px h-3 bg-gray-700/60 mx-0.5" />
        {isAdmin && onOpenAdminPortal && (
          <button
            onClick={onOpenAdminPortal}
            className="text-gray-500 hover:text-violet-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
            title="관리자 포털"
          >
            <LayoutDashboard size={14} />
          </button>
        )}
        {isAdmin && onOpenAdmin && (
          <button
            onClick={onOpenAdmin}
            className="text-gray-500 hover:text-violet-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
            title="관리자 설정"
          >
            <Settings size={14} />
          </button>
        )}
        {canAccessDividendTax && (
          <button
            onClick={onOpenDividendTax}
            className="text-gray-500 hover:text-green-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
            title="배당 과세 이력 관리"
          >
            <FileSpreadsheet size={14} />
          </button>
        )}
        <button
          onClick={onOpenPinChange}
          className="text-gray-500 hover:text-amber-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
          title="비밀번호 변경"
        >
          <Lock size={14} />
        </button>
        <button
          onClick={onToggleAdminAccess}
          title={adminAccessAllowed ? '관리자 접속 허용 중 — 클릭하여 차단' : '관리자 접속 차단 중 — 클릭하여 허용'}
          className={`relative p-1.5 rounded border transition-colors flex items-center justify-center ${
            adminAccessAllowed
              ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 border-emerald-700/40 hover:bg-emerald-900/30'
              : 'text-gray-600 hover:text-gray-400 hover:bg-gray-800 border-transparent hover:border-gray-700'
          }`}
        >
          <Link2 size={14} />
          {adminAccessAllowed && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
          )}
        </button>
        <div className="w-px h-3 bg-gray-700/60 mx-0.5" />
        <button
          onClick={onLogout}
          className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
          title="로그아웃"
        >
          <LogOut size={14} />
        </button>
        {onAppClose && (
          <>
            <div className="w-px h-3 bg-gray-700/60 mx-0.5" />
            <button
              onClick={onAppClose}
              className="text-gray-500 hover:text-rose-400 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
              title="앱 닫기 (백업 저장 후 종료)"
            >
              <Power size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
