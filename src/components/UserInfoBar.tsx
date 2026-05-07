// @ts-nocheck
import React from 'react';
import { Settings, Lock, Link2, LogOut, FileSpreadsheet, Power, LayoutDashboard } from 'lucide-react';
import { ADMIN_EMAIL } from '../config';

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
}) {
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  return (
    <div className="flex items-center justify-between text-xs text-gray-500 px-1">
      <span className="font-mono">{email}</span>
      <div className="flex items-center gap-1">
        {isAdmin && (
          <>
            <button
              onClick={onOpenAdminPortal}
              className="text-gray-500 hover:text-violet-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
              title="관리자 포털"
            >
              <LayoutDashboard size={14} />
            </button>
            <button
              onClick={onOpenAdmin}
              className="text-gray-500 hover:text-violet-300 transition-colors p-1.5 rounded hover:bg-gray-800 border border-transparent hover:border-gray-700 flex items-center justify-center"
              title="관리자 설정"
            >
              <Settings size={14} />
            </button>
          </>
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
