// @ts-nocheck
import React from 'react';
import { Settings, LayoutDashboard } from 'lucide-react';

interface Props {
  onSelectPortfolio: () => void;
  onSelectAdmin: () => void;
  adminEmail: string;
}

export default function AdminChoiceModal({ onSelectPortfolio, onSelectAdmin, adminEmail }: Props) {
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.88)' }}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm mx-4 shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-violet-900/50 border border-violet-700/60 flex items-center justify-center mx-auto mb-3">
            <Settings size={22} className="text-violet-300" />
          </div>
          <h2 className="text-white text-lg font-bold mb-1">관리자 계정</h2>
          <p className="text-gray-500 text-xs font-mono">{adminEmail}</p>
          <p className="text-gray-400 text-sm mt-2">이동할 페이지를 선택하세요</p>
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={onSelectPortfolio}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 px-4 rounded-xl transition-colors text-sm"
          >
            <LayoutDashboard size={16} />
            자산관리 페이지
          </button>
          <button
            onClick={onSelectAdmin}
            className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-100 font-semibold py-3.5 px-4 rounded-xl transition-colors text-sm"
          >
            <Settings size={16} />
            관리자 페이지
          </button>
        </div>
      </div>
    </div>
  );
}
