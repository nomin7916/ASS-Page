// @ts-nocheck
import React from 'react';
import { RefreshCw, Plus, X, ExternalLink } from 'lucide-react';

const getStockUrl = (code: string) => {
  if (!code) return null;
  if (/^\d/.test(code)) return `https://m.stock.naver.com/domestic/stock/${code}/total`;
  if (/^[A-Za-z]+$/.test(code)) return `https://finance.yahoo.com/quote/${code.toUpperCase()}`;
  return null;
};

export default function CompStockChips({
  compStocks,
  setCompStocks,
  stockHistoryMap,
  stockListingDates,
  setStockListingDates,
  appliedRange,
  autoFetchedCodes,
  stockFetchStatus,
  handleAddCompStock,
  handleToggleComp,
  handleCompStockBlur,
  handleFetchCompHistory,
  handleForceRefetchComp,
  handleRemoveCompStock,
}) {
  const CompStockDot = ({ code }) => {
    const st = stockFetchStatus?.[code];
    if (!st) return null;
    if (st === 'success') return <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block ml-0.5" title="갱신 완료" />;
    if (st === 'fail') return <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block ml-0.5" title="갱신 실패" />;
    if (st === 'loading') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-0.5 animate-pulse" title="갱신 중" />;
    return null;
  };

  return (
    <>
      {compStocks.map((comp, idx) => {
        const histKeys = comp.active && stockHistoryMap?.[comp.code] ? Object.keys(stockHistoryMap[comp.code]).sort() : [];
        const isFallback = comp.active && histKeys.length === 1;
        const listingDate = stockListingDates?.[comp.code];
        const needsCoverage = comp.active && histKeys.length > 1 && !!appliedRange?.start && histKeys[0] > appliedRange.start && !listingDate;
        const hasIssue = isFallback || needsCoverage;
        const color = comp.color || '#10b981';
        const borderColor = comp.active ? (hasIssue ? '#f97316' : color) : '#4b5563';
        const bgColor = comp.active ? (hasIssue ? 'rgba(249,115,22,0.1)' : `${color}22`) : '#1f2937';
        const textColor = comp.active ? (hasIssue ? '#fb923c' : color) : '#6b7280';
        const refreshTitle = isFallback ? '조회기간 전체 이력 불러오기' : needsCoverage ? `조회기간(${appliedRange?.start}) 이전 데이터 없음 — 전체 이력 재조회` : '데이터 장애 시 강제 재조회';
        return (
          <div key={idx} className="flex items-center gap-0 rounded-md overflow-hidden shrink-0 transition-colors border" style={{ borderColor, backgroundColor: bgColor }}>
            <div className="relative flex items-center justify-center w-5 self-stretch border-r border-gray-700/50 hover:bg-gray-700/30 transition-colors" title="선 색상 변경">
              <div className="w-2.5 h-2.5 rounded-full shadow-sm pointer-events-none" style={{ backgroundColor: color }} />
              <input
                type="color"
                value={color}
                onChange={e => { const n = [...compStocks]; n[idx] = { ...n[idx], color: e.target.value }; setCompStocks(n); }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <input
              type="text"
              className="bg-transparent text-[10px] px-2 py-1.5 outline-none text-center font-mono placeholder-gray-500 border-r transition-colors"
              style={{ width: '50px', borderColor, color: comp.active ? textColor : '#93c5fd' }}
              placeholder="코드"
              value={comp.code}
              onChange={e => { const n = [...compStocks]; n[idx] = { ...n[idx], code: e.target.value.trim().toUpperCase() }; setCompStocks(n); }}
              onBlur={e => handleCompStockBlur(idx, e.target.value)}
            />
            <button
              onClick={() => handleToggleComp(idx)}
              className="px-3 py-1.5 text-[10px] font-bold transition-colors min-w-[65px] max-w-[100px] truncate flex justify-center items-center gap-0.5"
              style={{ color: comp.loading ? '#9ca3af' : textColor, backgroundColor: comp.loading ? '#374151' : 'transparent', cursor: comp.loading ? 'wait' : 'pointer' }}
            >
              {comp.loading ? <RefreshCw size={12} className="animate-spin" /> : (comp.name || `종목${idx + 1}`)}
              <CompStockDot code={comp.code} />
            </button>
            {comp.active && getStockUrl(comp.code) && (
              <button
                onClick={() => window.open(getStockUrl(comp.code), '_blank')}
                className="px-1.5 py-1.5 text-gray-600 hover:text-blue-300 hover:bg-blue-900/20 transition-colors border-l border-gray-700/40"
                title="네이버 증권 상세 페이지"
              >
                <ExternalLink size={10} />
              </button>
            )}
            {comp.active && (
              <button
                onClick={() => handleForceRefetchComp(idx)}
                className={`px-1.5 py-1.5 transition-colors border-l ${hasIssue ? 'text-orange-400 hover:text-orange-200 hover:bg-orange-900/30 border-orange-700/40' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-700/40 border-gray-700/40'}`}
                title="종가 재조회 (캐시 초기화 후 전체 이력 새로 수집, Drive 저장)"
              >
                <RefreshCw size={10} />
              </button>
            )}
            {compStocks.length > 1 && (
              <button
                onClick={() => handleRemoveCompStock(idx)}
                className="px-1.5 py-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors border-l border-gray-700/40"
                title="종목 제거"
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
      {compStocks.length < 8 && (
        <button
          onClick={handleAddCompStock}
          className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-bold text-gray-500 hover:text-green-400 hover:bg-green-900/20 border border-gray-700 hover:border-green-700/50 transition-colors"
          title="비교 종목 추가"
        >
          <Plus size={11} />
          <span>추가</span>
        </button>
      )}
    </>
  );
}
