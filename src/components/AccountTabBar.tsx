// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, CloudDownload, Save, History, FileUp, ArchiveRestore, HardDriveDownload, Cloud, CloudSun, CloudOff, Lock, ClipboardPaste, ChevronDown, Settings } from 'lucide-react';
import { ACCOUNT_TYPE_CONFIG } from '../constants';
import HeaderMarketChips from './HeaderMarketChips';

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
  handleImportStateFile,
  handleDownloadStateFile,
  isAdmin,
  onPaste,
  activePortfolioAccountType,
  fetchMarketIndicators,
  activeLinks = [],
  setActiveLinks,
  marketIndicators,
}) {
  const stateFileInputRef = React.useRef(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [linkEditOpen, setLinkEditOpen] = useState(false);
  const linkEditRef = useRef(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!linkEditOpen) return;
    const handler = (e) => {
      if (linkEditRef.current && !linkEditRef.current.contains(e.target)) {
        setLinkEditOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [linkEditOpen]);

  const isOverseasLinks = activePortfolioAccountType === 'overseas';

  const handleRefresh = !showIntegratedDashboard && activePortfolioAccountType === 'gold'
    ? fetchMarketIndicators
    : refreshPrices;

  const visiblePortfolios = portfolios.filter(p => p.accountType !== 'simple' && p.accountType !== 'matong');

  const activePortfolio = visiblePortfolios.find(p => p.id === activePortfolioId);
  const activeTypeConf = activePortfolio
    ? (ACCOUNT_TYPE_CONFIG[activePortfolio.accountType] || ACCOUNT_TYPE_CONFIG['portfolio'])
    : null;
  const activeAccountName = showIntegratedDashboard
    ? '총 자산 현황'
    : (title || activePortfolio?.name || '계좌');
  const activeAccountColor = showIntegratedDashboard ? '#60a5fa' : (activeTypeConf?.color || '#60a5fa');
  const showLinksOnNarrow = !showIntegratedDashboard && Array.isArray(activeLinks) && activeLinks.length > 0;

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-gray-700/50 md:flex-wrap gap-y-1 py-1.5">
      {/* 좁은 화면: 드롭다운 + 시장지표 칩 + 우측 링크 */}
      <div className="md:hidden flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <div className="relative flex-shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(v => !v)}
            style={{ boxShadow: `inset 3px 0 0 0 ${activeAccountColor}CC` }}
            className="min-w-[120px] max-w-[200px] py-2 pl-3 pr-2 text-xs font-bold rounded-md border bg-slate-800 text-white border-slate-500 transition-all duration-200 flex items-center justify-between gap-1.5"
            title="계좌 전환"
          >
            <span className="truncate">{activeAccountName}</span>
            <ChevronDown size={12} className={`flex-shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {dropdownOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-gray-900 border border-gray-700 rounded-md shadow-2xl overflow-hidden min-w-[180px] max-h-72 overflow-y-auto">
              <button
                onClick={() => { setShowIntegratedDashboard(true); setDropdownOpen(false); }}
                style={{ boxShadow: `inset 3px 0 0 0 #60a5fa${showIntegratedDashboard ? 'CC' : '66'}` }}
                className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors ${showIntegratedDashboard ? 'bg-slate-800 text-white' : 'text-gray-300 hover:bg-slate-800 hover:text-white'}`}
              >총 자산 현황</button>
              {visiblePortfolios.map(p => {
                const typeConf = ACCOUNT_TYPE_CONFIG[p.accountType] || ACCOUNT_TYPE_CONFIG['portfolio'];
                const isActive = !showIntegratedDashboard && activePortfolioId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => { switchToPortfolio(p.id); setDropdownOpen(false); }}
                    style={{ boxShadow: `inset 3px 0 0 0 ${typeConf.color}${isActive ? 'CC' : '66'}` }}
                    className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors ${isActive ? 'bg-slate-800 text-white' : 'text-gray-300 hover:bg-slate-800 hover:text-white'}`}
                  >{(p.id === activePortfolioId ? title : p.name) || '계좌'}</button>
                );
              })}
            </div>
          )}
        </div>
        {marketIndicators && <HeaderMarketChips marketIndicators={marketIndicators} />}
        </div>
        {showLinksOnNarrow && (
          <div className="flex items-center gap-1 relative" ref={linkEditRef}>
            {activeLinks.slice(0, 3).map((link, i) => {
              const tip = link.url
                ? (link.name?.trim() ? `링크${i + 1} · ${link.name.trim()} — ${link.url}` : `링크${i + 1} — ${link.url}`)
                : `링크${i + 1} 설정 필요`;
              return (
                <button
                  key={i}
                  onClick={() => link.url && window.open(link.url.startsWith('http') ? link.url : 'https://' + link.url, '_blank')}
                  className="bg-gray-800/60 hover:bg-gray-700 text-blue-300 w-[22px] h-[22px] rounded border border-gray-600/60 flex items-center justify-center text-[11px] font-bold transition"
                  title={tip}
                >{i + 1}</button>
              );
            })}
            {typeof setActiveLinks === 'function' && (
              <button
                onClick={() => setLinkEditOpen(v => !v)}
                title="퀵 링크 설정"
                className={`w-[22px] h-[22px] rounded border flex items-center justify-center transition ${
                  linkEditOpen
                    ? 'text-sky-400 bg-sky-900/20 border-sky-700/40'
                    : 'bg-gray-800/60 hover:bg-gray-700 text-gray-400 border-gray-600/60'
                }`}
              ><Settings size={11} /></button>
            )}
            {linkEditOpen && typeof setActiveLinks === 'function' && (
              <div className="absolute right-0 top-full mt-1.5 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 w-[260px] max-w-[calc(100vw-24px)] flex flex-col gap-3 cursor-default">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300 text-xs font-bold">퀵 링크 설정</span>
                  {isOverseasLinks && <span className="text-[10px] text-sky-400/70 font-bold">🌐 해외계좌 전용</span>}
                </div>
                {activeLinks.slice(0, 3).map((l, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-500 font-bold ml-0.5">버튼 {i + 1} 이름 <span className="text-gray-600 font-normal">(최대 7자)</span></span>
                      <input
                        type="text"
                        maxLength={7}
                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-400 shadow-inner font-normal"
                        value={l.name || ''}
                        onChange={(e) => { const n = [...activeLinks]; n[i] = { ...n[i], name: e.target.value }; setActiveLinks(n); }}
                        placeholder="비워두면 URL에서 자동 추출"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-500 font-bold ml-0.5">버튼 {i + 1} 연결 (URL)</span>
                      <input
                        type="text"
                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-500 shadow-inner font-normal"
                        value={l.url || ''}
                        onChange={(e) => { const n = [...activeLinks]; n[i] = { ...n[i], url: e.target.value }; setActiveLinks(n); }}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                ))}
                <button onClick={() => setLinkEditOpen(false)} className="self-end bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition">완료</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 넓은 화면: 기존 탭 리스트 */}
      <div className="hidden md:flex gap-2 flex-wrap items-center">
        <button
          onClick={() => setShowIntegratedDashboard(true)}
          style={{ boxShadow: `inset 3px 0 0 0 #60a5fa${showIntegratedDashboard ? 'CC' : '66'}` }}
          className={`w-[96px] py-2 text-xs font-bold rounded-md border transition-all duration-200 truncate ${showIntegratedDashboard ? 'bg-slate-800 text-white border-slate-500' : 'text-gray-400 border-slate-700 hover:bg-slate-800 hover:text-white hover:border-slate-500'}`}
        >총 자산 현황</button>
        {visiblePortfolios.map(p => {
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

      {/* 액션 아이콘 (항상 표시) */}
      <div className="flex items-center gap-1 pr-1 flex-wrap">
        {(driveStatus === 'saving' || driveStatus === 'loading' || isLoading) && (
          <span className="p-1.5 inline-flex items-center justify-center text-sky-300 animate-cloud-glow" title={driveStatus === 'saving' ? 'Drive 저장 중...' : driveStatus === 'loading' ? 'Drive 불러오는 중...' : '갱신 중...'}>
            <Cloud size={14} strokeWidth={2.4} />
          </span>
        )}
        {driveStatus === 'saved' && !isLoading && (
          <span className="p-1.5 inline-flex items-center justify-center text-amber-300" title="Drive 동기화 완료">
            <CloudSun size={14} strokeWidth={2.4} />
          </span>
        )}
        {driveStatus === 'error' && !isLoading && (
          <span className="p-1.5 inline-flex items-center justify-center text-gray-500" title="Drive 동기화 실패">
            <CloudOff size={14} strokeWidth={2.4} />
          </span>
        )}
        {driveStatus === 'auth_needed' && !isLoading && (
          <span className="p-1.5 inline-flex items-center justify-center text-orange-400" title="Drive 로그인 필요">
            <Lock size={14} strokeWidth={2.4} />
          </span>
        )}
        {showIntegratedDashboard && (
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
        )}
        <button
          onClick={handleRefresh}
          title={showIntegratedDashboard ? '새로고침 — 모든 계좌 종목가격·지수 데이터 갱신' : '새로고침 (종목가격 + 지수 데이터 수집)'}
          className="p-1.5 hover:bg-gray-800 rounded transition text-teal-400 hover:text-teal-300"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
        {showIntegratedDashboard && (
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
        )}
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
        {!showIntegratedDashboard && onPaste && (
          <button
            onClick={onPaste}
            title="엑셀 붙여넣기"
            className="p-1.5 hover:bg-gray-800 rounded transition text-green-500/80 hover:text-green-400"
          >
            <ClipboardPaste size={14} />
          </button>
        )}
        {showIntegratedDashboard && isAdmin && (
          <>
            <button
              onClick={() => historyInputRef.current?.click()}
              title="지수/종목 히스토리 주입 (JSON 또는 CSV)"
              className="p-1.5 hover:bg-gray-800 rounded transition text-orange-400 hover:text-orange-300"
            >
              <FileUp size={14} />
            </button>
            <input type="file" ref={historyInputRef} onChange={handleImportHistoryJSON} className="hidden" accept=".json,.csv" multiple />
          </>
        )}
        {showIntegratedDashboard && (
          <>
            <button
              onClick={handleDownloadStateFile}
              title="PC에 데이터 저장 (portfolio_state.json 다운로드)"
              className="p-1.5 hover:bg-gray-800 rounded transition text-emerald-400 hover:text-emerald-300"
            >
              <HardDriveDownload size={14} />
            </button>
            <button
              onClick={() => stateFileInputRef.current?.click()}
              title="파일에서 데이터 복원 (portfolio_state.json)"
              className="p-1.5 hover:bg-gray-800 rounded transition text-green-400 hover:text-green-300"
            >
              <ArchiveRestore size={14} />
            </button>
            <input type="file" ref={stateFileInputRef} onChange={handleImportStateFile} className="hidden" accept=".json" />
          </>
        )}
      </div>
    </div>
  );
}
