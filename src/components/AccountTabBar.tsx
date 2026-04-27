// @ts-nocheck
import React from 'react';
import { RefreshCw, CloudDownload, Save, History, FileUp } from 'lucide-react';
import { ACCOUNT_TYPE_CONFIG } from '../constants';

export default function AccountTabBar({
  portfolios,
  showIntegratedDashboard,
  setShowIntegratedDashboard,
  activePortfolioId,
  title,
  switchToPortfolio,
  hideAmounts,
  setHideAmounts,
  setUnlockPinDigits,
  setUnlockPinError,
  setShowUnlockPinModal,
  refreshPrices,
  isLoading,
  handleDriveLoadOnly,
  driveStatus,
  handleDriveSave,
  handleOpenBackupModal,
  historyInputRef,
  handleImportHistoryJSON,
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-700/50 flex-wrap gap-y-1 py-1.5">
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => setShowIntegratedDashboard(true)}
          style={{ boxShadow: `inset 3px 0 0 0 #60a5fa${showIntegratedDashboard ? 'CC' : '66'}` }}
          className={`w-[96px] py-2 text-xs font-bold rounded-md border transition-all duration-200 truncate ${showIntegratedDashboard ? 'bg-slate-800 text-white border-slate-500' : 'text-gray-400 border-slate-700 hover:bg-slate-800 hover:text-white hover:border-slate-500'}`}
        >총 자산 현황</button>
        {portfolios.filter(p => p.accountType !== 'simple').map(p => {
          const typeConf = ACCOUNT_TYPE_CONFIG[p.accountType] || ACCOUNT_TYPE_CONFIG['portfolio'];
          const isActive = !showIntegratedDashboard && activePortfolioId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => switchToPortfolio(p.id)}
              style={{ boxShadow: `inset 3px 0 0 0 ${typeConf.color}${isActive ? 'CC' : '66'}` }}
              className={`w-[96px] py-2 text-xs font-bold rounded-md border transition-all duration-200 truncate ${isActive ? 'bg-slate-800 text-white border-slate-500' : 'text-gray-400 border-slate-700 hover:bg-slate-800 hover:text-white hover:border-slate-500'}`}
            >{(p.id === activePortfolioId ? title : p.name) || '계좌'}</button>
          );
        })}
      </div>
      {showIntegratedDashboard && (
        <div className="flex items-center gap-1 pr-1">
          <button
            onClick={() => {
              if (hideAmounts) {
                setUnlockPinDigits(['', '', '', '']);
                setUnlockPinError('');
                setShowUnlockPinModal(true);
              } else {
                setHideAmounts(true);
              }
            }}
            title={hideAmounts ? '금액 보이기' : '금액 숨기기'}
            className={`p-1.5 hover:bg-gray-800 rounded transition ${hideAmounts ? 'text-gray-300 hover:text-white' : 'text-gray-500 hover:text-gray-200'}`}
          >
            <span className="text-[13px] font-bold leading-none">₩</span>
          </button>
          <button
            onClick={refreshPrices}
            title="새로고침 — 모든 계좌 종목가격·지수 데이터 갱신"
            className="p-1.5 hover:bg-gray-800 rounded transition text-teal-400 hover:text-teal-300"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleDriveLoadOnly}
            title={driveStatus === 'loading' ? 'Drive 불러오는 중...' : driveStatus === 'saved' ? 'Drive 동기화 완료 — 다시 불러오기' : driveStatus === 'auth_needed' ? 'Drive 로그인 필요' : 'Google Drive에서 최신 데이터 불러오기'}
            className={`p-1.5 hover:bg-gray-800 rounded transition ${
              driveStatus === 'loading'
                ? 'text-blue-300 animate-pulse'
                : driveStatus === 'saved'
                ? 'text-blue-400 hover:text-blue-300'
                : driveStatus === 'error' || driveStatus === 'auth_needed'
                ? 'text-blue-800/60 hover:text-blue-500'
                : 'text-blue-500/70 hover:text-blue-400'
            }`}
          >
            <CloudDownload size={14} />
          </button>
          <button
            onClick={handleDriveSave}
            title={driveStatus === 'saving' ? 'Drive 저장 중...' : driveStatus === 'saved' ? 'Drive 저장 완료 — 다시 저장' : driveStatus === 'auth_needed' ? 'Drive 로그인 필요' : 'Google Drive에 전체 데이터 백업'}
            className={`p-1.5 hover:bg-gray-800 rounded transition ${
              driveStatus === 'saving'
                ? 'text-indigo-300 animate-pulse'
                : driveStatus === 'saved'
                ? 'text-indigo-400 hover:text-indigo-300'
                : driveStatus === 'error' || driveStatus === 'auth_needed'
                ? 'text-indigo-800/60 hover:text-indigo-500'
                : 'text-indigo-500/70 hover:text-indigo-400'
            }`}
          >
            <Save size={14} />
          </button>
          <button
            onClick={handleOpenBackupModal}
            title="Drive 백업 이력 보기 — 시간대별 백업 선택 적용"
            className="p-1.5 hover:bg-gray-800 rounded transition text-purple-500/70 hover:text-purple-400"
          >
            <History size={14} />
          </button>
          <button
            onClick={() => historyInputRef.current?.click()}
            title="지수/종목 히스토리 주입 (JSON 또는 CSV)"
            className="p-1.5 hover:bg-gray-800 rounded transition text-orange-400 hover:text-orange-300"
          >
            <FileUp size={14} />
          </button>
          <input type="file" ref={historyInputRef} onChange={handleImportHistoryJSON} className="hidden" accept=".json,.csv" multiple />
        </div>
      )}
    </div>
  );
}
