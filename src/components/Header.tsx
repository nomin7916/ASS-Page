// @ts-nocheck
import React from 'react';
import {
  Settings, RefreshCw, Save, ClipboardPaste,
  X, Download, FolderOpen, FileUp, CloudDownload
} from 'lucide-react';
import { UI_CONFIG } from '../config';

const COLAB_URL = 'https://colab.research.google.com/drive/1hjCwtVjyKzooWly4AU_ufrMSV87FApzi#scrollTo=fe7b764e';
const COLAB_PASSWORD = '0000';

const Header = ({ title, setTitle, isLoading, driveStatus, customLinks, setCustomLinks, onRefresh, onSave, onDriveSave, onLoad, onPaste, onImportHistory, isLinkSettingsOpen, setIsLinkSettingsOpen, fileInputRef, historyInputRef, onDriveConnect, onDriveLoad, onDriveLoadOnly }) => (
  <div className="bg-[#0f172a] rounded-xl shadow-lg border border-gray-700 overflow-hidden w-full mt-2 relative">
    <div className="p-4 md:p-5 border-b border-gray-700 flex flex-col md:flex-row justify-between items-center bg-[#1e293b] gap-4">
      <div className="absolute top-3 right-4 text-[10px] text-gray-500 font-mono md:hidden"><span className="text-gray-400">{UI_CONFIG.VERSION}</span></div>
      <div className="flex items-center gap-3 flex-1 min-w-[250px] w-full md:w-auto mt-2 md:mt-0">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="text-2xl md:text-3xl font-bold bg-transparent outline-none hover:border-b hover:border-gray-500 focus:border-b focus:border-blue-500 w-full max-w-xl text-white truncate transition-colors" />
      </div>
      <div className="flex flex-col items-end gap-2.5 w-full md:w-auto">
        {/* 버전 + 상태 표시 */}
        <div className="hidden md:flex text-[10px] text-gray-500 font-mono w-full justify-end items-center gap-2 pr-1">
          <span className="text-gray-400">{UI_CONFIG.VERSION}</span>
          {isLoading && <span className="text-[10px] text-yellow-400 font-bold animate-pulse whitespace-nowrap">🔄 갱신중...</span>}
          {!isLoading && driveStatus === 'loading' && <span className="text-[10px] text-blue-400 font-bold animate-cloud-glow whitespace-nowrap">☁️ Drive 불러오는 중...</span>}
          {!isLoading && driveStatus === 'auth_needed' && (
            <button onClick={onDriveConnect} className="text-[10px] text-orange-400 font-bold whitespace-nowrap hover:text-orange-200 transition-colors">☁️ Drive 연결 필요 — 클릭하여 로그인</button>
          )}
        </div>

        {/* 행 1 (상단): 액션 버튼들 (이모티콘 버튼) */}
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
          <button onClick={() => historyInputRef.current.click()} title="지수/종목 히스토리 주입 (JSON 또는 CSV)" className="bg-orange-600 hover:bg-orange-500 text-white p-2 rounded shadow transition border border-orange-500/30 flex items-center justify-center"><FileUp size={16} /></button>
          <input type="file" ref={historyInputRef} onChange={onImportHistory} className="hidden" accept=".json,.csv" multiple />
          <button onClick={onDriveLoadOnly} title="Google Drive에서만 데이터 불러오기" className="bg-blue-700 hover:bg-blue-600 text-white p-2 rounded shadow transition border border-blue-500/30 flex items-center justify-center"><CloudDownload size={16} /></button>
          <button onClick={onDriveLoad} title="Drive에서 최신 데이터 불러오기 (미연결 시 PC 파일 선택)" className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded shadow transition border border-gray-500/30 flex items-center justify-center"><FolderOpen size={16} /></button>
          <input type="file" ref={fileInputRef} onChange={onLoad} className="hidden" accept=".json" />
          {/* 디스크 버튼: Drive에만 백업 */}
          <button onClick={onDriveSave} title="Google Drive에만 백업 저장" className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded shadow transition border border-indigo-500/30 flex items-center justify-center"><Save size={16} /></button>
          <div className="w-[1px] h-5 bg-gray-600 mx-0.5"></div>
          <button onClick={onPaste} title="엑셀 붙여넣기" className="bg-green-600 hover:bg-green-500 text-white p-2 rounded shadow transition border border-green-500/30 flex items-center justify-center"><ClipboardPaste size={16} /></button>
          <div className="w-[1px] h-5 bg-gray-600 mx-1"></div>
          {/* 숨겨진 Colab 버튼: 비밀번호 0000 입력 후 열림 */}
          <button
            onClick={() => {
              const pw = window.prompt('비밀번호를 입력하세요');
              if (pw === COLAB_PASSWORD) window.open(COLAB_URL, '_blank');
            }}
            title=""
            className="bg-[#1e293b] hover:bg-[#2d3748] text-[#1e293b] hover:text-gray-500 p-2 rounded shadow-sm transition-all border border-gray-700/40 flex items-center justify-center w-[34px] h-[34px]"
          >
            <span className="text-[8px] select-none opacity-20">···</span>
          </button>
        </div>

        {/* 행 2 (하단): 링크 버튼들 */}
        <div className="flex items-center gap-1.5 w-full justify-end pr-1">
          {customLinks.map((link, i) => (
            <button key={i} onClick={() => link.url && window.open(link.url.startsWith('http') ? link.url : 'https://' + link.url, '_blank')} className="bg-gray-800 hover:bg-gray-700 text-blue-300 w-[34px] h-[34px] rounded shadow transition border border-gray-600 flex items-center justify-center text-xs font-bold" title={link.url ? `[버튼 ${i + 1}]\n${link.url}` : `버튼 ${i + 1} 설정 필요`}>{i + 1}</button>
          ))}
          <button onClick={() => setIsLinkSettingsOpen(!isLinkSettingsOpen)} className="bg-gray-800 hover:bg-gray-700 text-gray-400 w-[34px] h-[34px] rounded shadow transition border border-gray-600 flex items-center justify-center" title="퀵 링크 설정"><Settings size={16} /></button>
          <button onClick={onSave} className="bg-gray-800 hover:bg-gray-700 text-blue-400 w-[34px] h-[34px] rounded shadow transition border border-gray-600 flex items-center justify-center" title="JSON 파일로 다운로드 (PC 백업)"><Download size={16} /></button>
        </div>
      </div>
    </div>
    {isLinkSettingsOpen && (
      <div className="bg-[#1e293b] p-4 flex flex-wrap gap-4 border-b border-gray-700 animate-in fade-in slide-in-from-top-1">
        {customLinks.map((l, i) => (
          <div key={i} className="flex flex-col gap-1 w-full sm:w-auto flex-1 max-w-[220px]">
            <span className="text-[10px] text-gray-500 font-bold ml-1">버튼 {i + 1} 연결 (URL)</span>
            <input type="text" className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-500 shadow-inner" value={l.url} onChange={(e) => { const n = [...customLinks]; n[i].url = e.target.value; setCustomLinks(n); }} placeholder="https://..." />
          </div>
        ))}
        <button onClick={() => setIsLinkSettingsOpen(false)} className="self-end bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded text-xs font-bold shadow transition mt-1">완료</button>
      </div>
    )}
  </div>
);

export default Header;
