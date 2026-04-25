// @ts-nocheck
import React from 'react';
import {
  RefreshCw, Save, ClipboardPaste, CloudDownload
} from 'lucide-react';

const Header = ({ title, setTitle, isLoading, driveStatus, onRefresh, onDriveSave, onPaste, onDriveConnect, onDriveLoadOnly }) => (
  <div className="bg-[#0f172a] rounded-xl shadow-lg border border-gray-700 overflow-hidden w-full mt-2 relative">
    <div className="p-4 md:p-5 border-b border-gray-700 flex flex-col md:flex-row justify-between items-center bg-[#1e293b] gap-4">
      <div className="flex items-center gap-3 flex-1 min-w-[250px] w-full md:w-auto mt-2 md:mt-0">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="text-2xl md:text-3xl font-bold bg-transparent outline-none hover:border-b hover:border-gray-500 focus:border-b focus:border-blue-500 w-full max-w-xl text-white truncate transition-colors caret-transparent cursor-pointer" />
      </div>
      <div className="flex flex-col items-end gap-2.5 w-full md:w-auto">
        {/* 상태 표시 */}
        <div className="hidden md:flex text-[10px] text-gray-500 font-mono w-full justify-end items-center gap-2 pr-1">
          {isLoading && <span className="text-[10px] text-yellow-400 font-bold animate-pulse whitespace-nowrap">🔄 갱신중...</span>}
          {!isLoading && driveStatus === 'loading' && <span className="text-[10px] text-blue-400 font-bold animate-cloud-glow whitespace-nowrap">☁️ Drive 불러오는 중...</span>}
          {!isLoading && driveStatus === 'auth_needed' && (
            <button onClick={onDriveConnect} className="text-[10px] text-orange-400 font-bold whitespace-nowrap hover:text-orange-200 transition-colors">☁️ Drive 연결 필요 — 클릭하여 로그인</button>
          )}
        </div>

        {/* 액션 버튼들 */}
        <div className="flex gap-2.5 flex-wrap justify-end items-center w-full mt-0.5">
          <div className="relative">
            {(driveStatus === 'saving' || driveStatus === 'loading' || isLoading) && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[14px] animate-cloud-glow pointer-events-none select-none z-10" title={driveStatus === 'saving' ? 'Drive 저장 중...' : driveStatus === 'loading' ? 'Drive 불러오는 중...' : '갱신 중...'}>☁️</span>
            )}
            {driveStatus === 'saved' && !isLoading && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[14px] pointer-events-none select-none z-10" title="Drive 동기화 완료">⛅</span>
            )}
            {driveStatus === 'error' && !isLoading && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[14px] pointer-events-none select-none z-10" title="Drive 동기화 실패" style={{ filter: 'brightness(0.45) grayscale(0.6)' }}>☁️</span>
            )}
            {driveStatus === 'auth_needed' && !isLoading && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[14px] pointer-events-none select-none z-10" title="Drive 로그인 필요">🔐</span>
            )}
            <button onClick={onRefresh} title="새로고침 (종목가격 + 지수 데이터 수집)" className="bg-teal-600 hover:bg-teal-500 text-white p-2 rounded shadow transition border border-teal-500/30 flex items-center justify-center">
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <button onClick={onDriveLoadOnly} title="Google Drive에서 최신 데이터 불러오기" className="bg-blue-700 hover:bg-blue-600 text-white p-2 rounded shadow transition border border-blue-500/30 flex items-center justify-center"><CloudDownload size={16} /></button>
          <button onClick={onDriveSave} title="Google Drive에만 백업 저장" className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded shadow transition border border-indigo-500/30 flex items-center justify-center"><Save size={16} /></button>
          <div className="w-[1px] h-5 bg-gray-600 mx-0.5"></div>
          <button onClick={onPaste} title="엑셀 붙여넣기" className="bg-green-600 hover:bg-green-500 text-white p-2 rounded shadow transition border border-green-500/30 flex items-center justify-center"><ClipboardPaste size={16} /></button>
        </div>
      </div>
    </div>
  </div>
);

export default Header;
