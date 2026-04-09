// @ts-nocheck
import React from 'react';
import {
  Settings, RefreshCw, Save, ClipboardPaste, Plus,
  X, Download, FolderOpen, FileUp
} from 'lucide-react';
import { UI_CONFIG } from '../config';

const Header = ({ title, setTitle, isLoading, gsheetStatus, customLinks, setCustomLinks, onRefresh, onSave, onLoad, onPaste, onAddStock, onImportHistory, isLinkSettingsOpen, setIsLinkSettingsOpen, fileInputRef, historyInputRef }) => (
  <div className="bg-[#0f172a] rounded-xl shadow-lg border border-gray-700 overflow-hidden w-full mt-2 relative">
    <div className="p-4 md:p-5 border-b border-gray-700 flex flex-col md:flex-row justify-between items-center bg-[#1e293b] gap-4">
      <div className="absolute top-3 right-4 text-[10px] text-gray-500 font-mono md:hidden"><span className="text-gray-400">{UI_CONFIG.VERSION}</span></div>
      <div className="flex items-center gap-3 flex-1 min-w-[250px] w-full md:w-auto mt-2 md:mt-0">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="text-2xl md:text-3xl font-bold bg-transparent outline-none hover:border-b hover:border-gray-500 focus:border-b focus:border-blue-500 w-full max-w-xl text-white truncate transition-colors" />
      </div>
      <div className="flex flex-col items-end gap-2.5 w-full md:w-auto">
        <div className="hidden md:flex text-[10px] text-gray-500 font-mono w-full justify-end items-center gap-2 pr-1">
          <span className="text-gray-400">{UI_CONFIG.VERSION}</span>
          {isLoading && <span className="text-[10px] text-yellow-400 font-bold animate-pulse whitespace-nowrap">🔄 갱신중...</span>}
          {!isLoading && gsheetStatus === 'loading' && <span className="text-[10px] text-blue-400 font-bold animate-pulse whitespace-nowrap">☁️ 불러오는 중...</span>}
        </div>
        <div className="flex items-center gap-1.5 w-full justify-end pr-1">
          {customLinks.map((link, i) => (
            <button key={i} onClick={() => link.url && window.open(link.url.startsWith('http') ? link.url : 'https://' + link.url, '_blank')} className="bg-gray-800 hover:bg-gray-700 text-blue-300 w-[34px] h-[34px] rounded shadow transition border border-gray-600 flex items-center justify-center text-xs font-bold" title={link.url ? `[버튼 ${i + 1}]\n${link.url}` : `버튼 ${i + 1} 설정 필요`}>{i + 1}</button>
          ))}
          <button onClick={() => setIsLinkSettingsOpen(!isLinkSettingsOpen)} className="bg-gray-800 hover:bg-gray-700 text-gray-400 w-[34px] h-[34px] rounded shadow transition border border-gray-600 flex items-center justify-center" title="퀵 링크 설정"><Settings size={16} /></button>
          <button onClick={onSave} className="bg-gray-800 hover:bg-gray-700 text-blue-400 w-[34px] h-[34px] rounded shadow transition border border-gray-600 flex items-center justify-center" title="JSON 파일로 다운로드 (백업)"><Download size={16} /></button>
        </div>
        <div className="flex gap-2.5 flex-wrap justify-end items-center w-full mt-0.5">
          <div className="relative">
            {(gsheetStatus === 'saving' || gsheetStatus === 'loading' || isLoading) && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[14px] animate-pulse pointer-events-none select-none z-10" title={gsheetStatus === 'saving' ? '저장 중...' : gsheetStatus === 'loading' ? '불러오는 중...' : '갱신 중...'}>☁️</span>
            )}
            {gsheetStatus === 'saved' && !isLoading && gsheetStatus !== 'saving' && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[14px] pointer-events-none select-none z-10" title="동기화 완료">☁️</span>
            )}
            {gsheetStatus === 'error' && !isLoading && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[14px] pointer-events-none select-none z-10" title="동기화 실패">❌</span>
            )}
            <button onClick={onRefresh} title="새로고침 (종목가격 + 지수 데이터 수집)" className="bg-teal-600 hover:bg-teal-500 text-white p-2 rounded shadow transition border border-teal-500/30 flex items-center justify-center">
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <button onClick={() => historyInputRef.current.click()} title="지수/종목 히스토리 주입 (JSON 또는 CSV)" className="bg-orange-600 hover:bg-orange-500 text-white p-2 rounded shadow transition border border-orange-500/30 flex items-center justify-center"><FileUp size={16} /></button>
          <input type="file" ref={historyInputRef} onChange={onImportHistory} className="hidden" accept=".json,.csv" multiple />
          <button onClick={() => fileInputRef.current.click()} title="전체 데이터 불러오기" className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded shadow transition border border-gray-500/30 flex items-center justify-center"><FolderOpen size={16} /></button>
          <input type="file" ref={fileInputRef} onChange={onLoad} className="hidden" accept=".json" />
          <button onClick={onSave} title="파일 백업 (지수 데이터 포함 저장)" className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded shadow transition border border-indigo-500/30 flex items-center justify-center"><Save size={16} /></button>
          <div className="w-[1px] h-5 bg-gray-600 mx-0.5"></div>
          <button onClick={onPaste} title="엑셀 붙여넣기" className="bg-green-600 hover:bg-green-500 text-white p-2 rounded shadow transition border border-green-500/30 flex items-center justify-center"><ClipboardPaste size={16} /></button>
          <button onClick={onAddStock} title="종목 추가" className="bg-purple-600 hover:bg-purple-500 text-white p-2 rounded shadow transition border border-purple-500/30 flex items-center justify-center"><Plus size={16} /></button>
          <div className="w-[1px] h-5 bg-gray-600 mx-1"></div>
          <button onClick={() => window.open('https://colab.research.google.com/drive/1hjCwtVjyKzooWly4AU_ufrMSV87FApzi#scrollTo=fe7b764e', '_blank')} title="Colab 데이터 추출기 열기" className="bg-[#2d333b] hover:bg-[#3d4450] text-gray-200 p-2 rounded shadow-md transition-all border border-gray-600 flex items-center justify-center group">
            <svg width="16" height="16" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg" className="group-hover:scale-110 transition-transform">
              <path d="M22.5 21a6.6 6.6 0 1 1-13.2 0 6.6 6.6 0 0 1 13.2 0z" fill="#f9ab00" />
              <path d="M15.9 33A12 12 0 1 1 27.9 21h5.4A17.4 17.4 0 1 0 15.9 38.4v-5.4z" fill="#f9ab00" />
              <path d="M33.3 21A17.4 17.4 0 0 1 15.9 38.4v-5.4A12 12 0 0 0 27.9 21h5.4z" fill="#e8710a" />
            </svg>
          </button>
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
