// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { Trash2, RefreshCw, Plus, Calendar } from 'lucide-react';
import { UI_CONFIG } from '../config';
import { MARK_ROW_BG, MARK_STICKY_BG, MARK_STRIP_BG } from '../constants';
import {
  cleanNum, formatCurrency, formatPercent, formatNumber, formatFundPrice,
  formatChangeRate, formatSavingsDailyRate, formatSavingsPeriod, savingsMaturity, savingsDepositEval,
  handleTableKeyDown, handleReadonlyCellNav, handleRowArrowNav
} from '../utils';
import CustomDatePicker from './CustomDatePicker';

const formatUSD = (n) => {
  const v = cleanNum(n);
  if (v === 0) return '$0.00';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const SAFE_CATEGORIES = ['채권', '현금', '예수금'];
const getAssetClass = (cat) => SAFE_CATEGORIES.includes(cat) ? 'S' : 'D';

const CELL_FOCUS = 'focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500';
const RO_FOCUS = 'focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none';

const PT_COLS = [
  { key: 'category', label: '구분' },
  { key: 'name', label: '종목명' },
  { key: 'code', label: '코드' },
  { key: 'changeRate', label: '등락률' },
  { key: 'currentPrice', label: '현재가' },
  { key: 'purchasePrice', label: '구매단가' },
  { key: 'quantity', label: '보유수량' },
  { key: 'investAmount', label: '투자금액' },
  { key: 'investRatio', label: '투자비중' },
  { key: 'evalAmount', label: '평가금액' },
  { key: 'evalRatio', label: '평가비중' },
  { key: 'returnRate', label: '수익률' },
  { key: 'profit', label: '차익' },
];

const CategoryCell = ({ item, portfolio, showAssetClass, onUpdate }) => {
  const [mode, setMode] = useState('idle');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const dropRef = useRef(null);
  const editRef = useRef(null);
  const validCats = Object.keys(UI_CONFIG.COLORS.CATEGORIES);
  const normalize = s => s.replace(/\s/g, '').replace('α', 'a').replace('A', 'a');
  const matchCat = s =>
    validCats.find(c => normalize(c) === normalize(s)) ||
    validCats.find(c => normalize(s).includes(normalize(c)));
  const colorClass = UI_CONFIG.COLORS.CATEGORIES[item.category] || 'text-white';

  useEffect(() => {
    if (mode !== 'dropdown') return;
    const close = e => {
      if (!wrapRef.current?.contains(e.target) && !dropRef.current?.contains(e.target))
        setMode('idle');
    };
    const closeOnScroll = () => setMode('idle');
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [mode]);

  useEffect(() => {
    if (mode === 'edit' && editRef.current) { editRef.current.focus(); editRef.current.select(); }
  }, [mode]);

  const openDropdown = () => {
    if (wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 2, left: rect.left });
    }
    setMode('dropdown');
  };

  const applyCategory = cat => {
    onUpdate(item.id, 'category', cat);
    if (showAssetClass) onUpdate(item.id, 'assetClass', getAssetClass(cat));
    setMode('idle');
  };

  const handlePaste = e => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      const match = matchCat(lines[0] || '');
      if (match) applyCategory(match);
    } else {
      const allStockItems = portfolio.filter(p => p.type === 'stock');
      const startIdx = allStockItems.findIndex(p => p.id === item.id);
      lines.forEach((line, i) => {
        const target = allStockItems[startIdx + i];
        if (!target) return;
        const match = matchCat(line);
        if (match) {
          onUpdate(target.id, 'category', match);
          if (showAssetClass) onUpdate(target.id, 'assetClass', getAssetClass(match));
        }
      });
    }
    setMode('idle');
  };

  return (
    <div ref={wrapRef} className="flex-1 min-w-0">
      {mode !== 'edit' ? (
        <div
          tabIndex={0}
          className={`w-full text-center text-xs font-bold cursor-pointer px-1 py-3 outline-none select-none ${colorClass} ${mode === 'dropdown' ? 'bg-blue-900/30' : ''}`}
          onClick={e => {
            if (e.detail === 2) return;
            if (mode === 'dropdown') setMode('idle');
            else openDropdown();
          }}
          onDoubleClick={() => setMode('edit')}
          onPaste={handlePaste}
          onKeyDown={handleRowArrowNav}
        >
          {item.category}
        </div>
      ) : (
        <input
          ref={editRef}
          className={`w-full bg-blue-900/30 text-center text-xs outline-none font-bold px-1 py-3 ${colorClass} caret-blue-400`}
          value={item.category}
          onChange={e => onUpdate(item.id, 'category', e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' || e.key === 'Enter') setMode('idle');
            else handleRowArrowNav(e);
          }}
          onBlur={e => {
            const val = e.target.value;
            if (!validCats.includes(val)) {
              const match = validCats.find(c => normalize(c) === normalize(val));
              if (match) {
                onUpdate(item.id, 'category', match);
                if (showAssetClass) onUpdate(item.id, 'assetClass', getAssetClass(match));
              }
            } else if (showAssetClass) {
              onUpdate(item.id, 'assetClass', getAssetClass(val));
            }
            setMode('idle');
          }}
          onPaste={handlePaste}
        />
      )}
      {mode === 'dropdown' && (
        <div
          ref={dropRef}
          className="fixed z-[100] bg-[#1e293b] border border-gray-600 rounded-lg shadow-2xl overflow-hidden py-1"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: 96 }}
        >
          {validCats.map(cat => (
            <button
              key={cat}
              className={`block w-full text-center px-4 py-1.5 text-xs font-bold hover:bg-gray-700/60 transition-colors ${UI_CONFIG.COLORS.CATEGORIES[cat]} ${cat === item.category ? 'bg-gray-700/40' : ''}`}
              onMouseDown={e => { e.preventDefault(); applyCategory(cat); }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// 계좌 타입별 기능 게이팅 (혼동/회귀 방지 — CLAUDE.md "계좌 타입별 D/S·펀드 게이팅" 참조)
//  · isRetirement   : 펀드 행 + "펀드 추가" 버튼 — 퇴직연금(DC/IRP) + 개인연금(pension)
//  · showAssetClass : 위험/안전(D/S) 자산 구분 배지 — 퇴직연금(DC/IRP) 전용 (개인연금 제외)
const PortfolioTable = ({ portfolio, totals, sortConfig, onSort, onUpdate, onBlur, onDelete, onAddStock, onAddFund, onAddSavings = () => {}, onUpdateSavingsField = () => {}, onAddSavingsDeposit = () => {}, onRemoveSavingsDeposit = () => {}, showSavings = false, stockFetchStatus, onSingleRefresh, isOverseas = false, usdkrw = 1, isRetirement = false, showAssetClass = false, showRetirementStats = false, hiddenColumns = [], onToggleColumn = () => {}, markedPortfolioRows = {}, onToggleMarkedPortfolioRow = () => {}, onResetAllMarkedPortfolioRows = () => {} }) => {
  const td = "py-3 px-3 border-r border-gray-600 align-middle text-[13px] whitespace-nowrap";
  const inp = "w-full bg-transparent outline-none font-bold focus:bg-blue-900/30 transition-colors";

  const [fundModal, setFundModal] = useState(null);
  const [modalAddInvest, setModalAddInvest] = useState('');
  const [modalEvalAfter, setModalEvalAfter] = useState('');
  const [savingsModalId, setSavingsModalId] = useState(null); // 예적금 적립 모달 대상 id
  const [savingsAddDate, setSavingsAddDate] = useState('');
  const [savingsAddAmount, setSavingsAddAmount] = useState('');
  const todayStr = new Date().toISOString().split('T')[0];
  const openSavingsModal = (item) => {
    setSavingsModalId(item.id);
    setSavingsAddDate(todayStr); // 입금일 기본값=오늘(미래 가입일에 묶여 평가금 0이 되는 것 방지)
    setSavingsAddAmount('');
  };
  const closeSavingsModal = () => { setSavingsModalId(null); setSavingsAddDate(''); setSavingsAddAmount(''); };
  const [editingInvestId, setEditingInvestId] = useState(null);
  const [editingInvestVal, setEditingInvestVal] = useState('');
  const [editingCell, setEditingCell] = useState(null);
  const numericVal = (id, col, fmt) =>
    editingCell?.id === id && editingCell?.col === col ? editingCell.val : fmt;
  const numericFocus = (id, col, raw) => e => {
    const n = cleanNum(raw);
    setEditingCell({ id, col, val: n ? String(n) : '' });
    e.target.select();
  };
  const numericChange = val => setEditingCell(prev => prev ? { ...prev, val } : null);
  const numericBlur = (id, col) => () => {
    if (editingCell?.id === id && editingCell?.col === col)
      onUpdate(id, col, editingCell.val);
    setEditingCell(null);
  };

  if (!totals) return null;

  const H = (k) => hiddenColumns.includes(k);

  const fmtDual = (krwAmount: number) => (
    <div className="flex flex-col items-end gap-0.5">
      <span>{formatUSD(krwAmount / usdkrw)}</span>
      <span className="text-[11px] text-gray-500">{formatCurrency(krwAmount)}</span>
    </div>
  );

  const stockItems = portfolio.filter(p => p.type === 'stock');
  const depositItems = portfolio.filter(p => p.type === 'deposit');
  const fundItems = portfolio.filter(p => p.type === 'fund');
  const savingsItems = portfolio.filter(p => p.type === 'savings');

  const retirementStats = showRetirementStats ? (() => {
    const dangerEval = stockItems
      .filter(p => (p.assetClass ?? getAssetClass(p.category)) === 'D')
      .reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const safeStockEval = stockItems
      .filter(p => (p.assetClass ?? getAssetClass(p.category)) === 'S')
      .reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const depositEval = depositItems.reduce((sum, p) => sum + (cleanNum(p.evalAmount) || cleanNum(p.depositAmount) || 0), 0);
    const fundDangerEval = fundItems.filter(p => (p.assetClass ?? 'S') === 'D').reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const fundSafeEval = fundItems.filter(p => (p.assetClass ?? 'S') === 'S').reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const savingsDangerEval = savingsItems.filter(p => (p.assetClass ?? 'S') === 'D').reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const savingsSafeEval = savingsItems.filter(p => (p.assetClass ?? 'S') === 'S').reduce((sum, p) => sum + cleanNum(p.evalAmount), 0);
    const totalEval = dangerEval + fundDangerEval + savingsDangerEval + safeStockEval + fundSafeEval + savingsSafeEval + depositEval;
    const dRatio = totalEval > 0 ? (dangerEval + fundDangerEval + savingsDangerEval) / totalEval * 100 : 0;
    const sRatio = totalEval > 0 ? (safeStockEval + fundSafeEval + savingsSafeEval + depositEval) / totalEval * 100 : 0;
    return { dRatio, sRatio, totalEval };
  })() : null;

  const savingsModalItem = savingsModalId ? portfolio.find(p => p.id === savingsModalId && p.type === 'savings') : null;

  const modalAddInvestNum = cleanNum(modalAddInvest);
  const modalEvalAfterNum = cleanNum(modalEvalAfter);
  const modalMode = modalEvalAfterNum > 0
    ? (modalAddInvestNum > 0 ? 'confirmed' : 'correction')
    : (modalAddInvestNum > 0 ? 'projected' : 'idle');
  const modalNewQty = (() => {
    if (!fundModal || fundModal.currentPrice <= 0) return fundModal?.currentQty ?? 0;
    if (modalEvalAfterNum > 0) return modalEvalAfterNum / fundModal.currentPrice;
    if (modalAddInvestNum > 0) return fundModal.currentQty + (modalAddInvestNum / fundModal.currentPrice);
    return fundModal.currentQty;
  })();
  const modalQtyDelta = fundModal ? modalNewQty - fundModal.currentQty : 0;
  const modalNewInvest = fundModal ? fundModal.currentInvest + modalAddInvestNum : 0;
  const modalAvgPrice = modalNewQty > 0 ? modalNewInvest / modalNewQty : 0;

  const projAddQty = fundModal && fundModal.currentPrice > 0 && modalAddInvestNum > 0
    ? modalAddInvestNum / fundModal.currentPrice : 0;
  const projTotalQty = fundModal ? fundModal.currentQty + projAddQty : 0;
  const projTotalInvest = fundModal ? fundModal.currentInvest + modalAddInvestNum : 0;
  const projTotalEval = projTotalQty * (fundModal?.currentPrice ?? 0);
  const projReturnRate = projTotalInvest > 0
    ? (projTotalEval - projTotalInvest) / projTotalInvest * 100 : 0;

  const spanColKeys = ['category', 'name', 'code', 'changeRate', 'currentPrice', 'purchasePrice', 'quantity'];
  const depositColSpan = spanColKeys.filter(k => !H(k)).length;
  const totalColCount = 15 - hiddenColumns.length;

  const hideStrip = (key) => (
    <div
      className="absolute top-0 left-0 right-0 h-3 cursor-pointer z-10 hover:bg-indigo-400/25 transition-colors"
      onClick={e => { e.stopPropagation(); onToggleColumn(key); }}
      title="클릭하여 열 숨기기"
    />
  );

  return (
    <>
    {fundModal && (
      <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center" onClick={() => setFundModal(null)}>
        <div className="bg-[#1e293b] rounded-xl border border-indigo-600/50 shadow-2xl p-5 w-[360px] max-w-[92vw]" onClick={e => e.stopPropagation()}>
          <h3 className="text-indigo-300 font-bold text-sm mb-3 flex items-center gap-2">
            📊 펀드 매수 수량 계산
            {fundModal.currentQty > 0 && <span className="text-[11px] text-gray-500 font-normal">(추가 적립)</span>}
          </h3>
          <div className="text-[12px] text-gray-400 bg-gray-900/60 rounded-lg px-3 py-2.5 mb-3 space-y-1">
            <div className="flex justify-between"><span>현재 기준가</span><span className="text-indigo-200 font-bold">{formatFundPrice(fundModal.currentPrice)}원</span></div>
            {fundModal.currentQty > 0 && <>
              <div className="flex justify-between"><span>현재 보유수량</span><span className="text-indigo-300">{fundModal.currentQty.toFixed(3)}</span></div>
              <div className="flex justify-between"><span>현재 투자금액</span><span className="text-blue-300">{formatCurrency(fundModal.currentInvest)}</span></div>
            </>}
          </div>
          <div className="space-y-2.5 mb-3">
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">{fundModal.currentQty > 0 ? '추가' : ''}투자금액</label>
              <input type="text" className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-blue-200 font-bold text-sm outline-none focus:border-indigo-500 caret-blue-400" value={modalAddInvest} placeholder="예: 1,000,000" onFocus={e => e.target.select()} onChange={e => setModalAddInvest(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">매수 후 평가금액 <span className="text-gray-600">(결제 후 계좌에서 확인)</span></label>
              <input type="text" className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white font-bold text-sm outline-none focus:border-indigo-500 caret-blue-400" value={modalEvalAfter} placeholder="예: 1,005,000" onFocus={e => e.target.select()} onChange={e => setModalEvalAfter(e.target.value)} />
            </div>
          </div>
          {modalMode !== 'idle' && modalNewQty > 0 && (
            <div className={`text-[12px] rounded-lg px-3 py-2.5 space-y-1.5 mb-3 border ${
              modalMode === 'projected'
                ? 'bg-amber-950/30 border-amber-700/40'
                : 'bg-indigo-950/60 border-indigo-800/40'
            }`}>
              <div className={`font-bold text-[11px] mb-1 ${
                modalMode === 'projected' ? 'text-amber-300' : 'text-indigo-200'
              }`}>
                {modalMode === 'projected' && '📊 예상치로 적용 (현재 기준가 기준)'}
                {modalMode === 'correction' && '🔧 수량 보정 (투자금액 유지)'}
                {modalMode === 'confirmed' && '✅ 확정 계산 (계좌 평가금액 기준)'}
              </div>
              {Math.abs(modalQtyDelta) > 0.0005 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    {modalMode === 'correction' ? '수량 보정' : '추가 수량'}
                    {modalMode === 'projected' && <span className="text-gray-600 ml-1">(예상)</span>}
                  </span>
                  <span className={`font-bold ${modalQtyDelta >= 0 ? 'text-indigo-300' : 'text-orange-300'}`}>
                    {modalQtyDelta >= 0 ? '+' : ''}{modalQtyDelta.toFixed(3)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-indigo-800/30 pt-1.5">
                <span className="text-gray-300 font-bold">총 보유수량</span>
                <span className={`font-bold ${modalMode === 'projected' ? 'text-amber-200' : 'text-indigo-200'}`}>
                  {modalNewQty.toFixed(3)}
                </span>
              </div>
              {modalNewInvest > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    총 투자금액
                    {modalMode === 'correction' && <span className="text-gray-600 text-[10px] ml-1">(변경 없음)</span>}
                  </span>
                  <span className="text-blue-300 font-bold">{formatCurrency(modalNewInvest)}</span>
                </div>
              )}
              {modalAvgPrice > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">평균 구매단가</span>
                  <span className="text-yellow-300 font-bold">{formatNumber(Math.round(modalAvgPrice))}원</span>
                </div>
              )}
              {modalMode === 'projected' && (
                <div className="text-[10px] text-amber-200/70 leading-snug pt-1.5 border-t border-amber-700/20">
                  지금 적용 시 수량은 예상치로 저장됩니다.<br/>
                  며칠 뒤 "매수 후 평가금액"만 입력해서 수량 보정 가능합니다.
                </div>
              )}
            </div>
          )}
          {modalAddInvestNum > 0 && fundModal.currentPrice > 0 && (
            <div className="text-[11px] bg-gray-900/40 border border-amber-700/30 rounded-lg px-3 py-2.5 mb-3 space-y-1.5">
              <div className="text-amber-300 font-bold text-[11px] flex items-center gap-1">
                📐 계산 과정 {modalMode === 'confirmed' ? '(검증용)' : '(예상치 산출)'}
              </div>
              <div className="text-[10px] text-gray-500 leading-snug pb-1">
                {modalMode === 'confirmed'
                  ? '위 ✅ 확정 계산과 일치하는지 확인하세요.'
                  : '결제까지 며칠 걸리므로 실제 매수가는 다를 수 있습니다.'}
              </div>
              <div className="space-y-1 border-t border-amber-700/20 pt-1.5">
                <div className="text-[10px] text-gray-400">① 매수 가능 수량 = 추가금액 ÷ 기준가</div>
                <div className="text-[10px] text-gray-500 pl-3">
                  = {formatNumber(modalAddInvestNum)} ÷ {formatFundPrice(fundModal.currentPrice)}
                  <span className="text-amber-200 font-bold ml-1">= {projAddQty.toFixed(3)}</span>
                </div>
              </div>
              {fundModal.currentQty > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-400">② 예상 총 보유수량 = 현재 보유 + 매수</div>
                  <div className="text-[10px] text-gray-500 pl-3">
                    = {fundModal.currentQty.toFixed(3)} + {projAddQty.toFixed(3)}
                    <span className="text-amber-200 font-bold ml-1">= {projTotalQty.toFixed(3)}</span>
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <div className="text-[10px] text-gray-400">③ 예상 총 투자금액 = 현재 투자 + 추가금액</div>
                <div className="text-[10px] text-gray-500 pl-3">
                  = {formatCurrency(fundModal.currentInvest)} + {formatCurrency(modalAddInvestNum)}
                  <span className="text-blue-300 font-bold ml-1">= {formatCurrency(projTotalInvest)}</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-gray-400">④ 예상 총 평가금액 = 총 수량 × 기준가</div>
                <div className="text-[10px] text-gray-500 pl-3">
                  = {projTotalQty.toFixed(3)} × {formatFundPrice(fundModal.currentPrice)}
                  <span className="text-indigo-200 font-bold ml-1">= {formatCurrency(Math.round(projTotalEval))}</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-gray-400">⑤ 예상 수익률 = (평가 − 투자) ÷ 투자</div>
                <div className="text-[10px] text-gray-500 pl-3">
                  = ({formatCurrency(Math.round(projTotalEval))} − {formatCurrency(projTotalInvest)}) ÷ {formatCurrency(projTotalInvest)}
                  <span className={`font-bold ml-1 ${projReturnRate >= 0 ? 'text-red-300' : 'text-blue-300'}`}>
                    = {projReturnRate >= 0 ? '+' : ''}{projReturnRate.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setFundModal(null); setModalAddInvest(''); setModalEvalAfter(''); }} className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors">취소</button>
            <button disabled={modalMode === 'idle' || modalNewQty <= 0} onClick={() => {
              onUpdate(fundModal.id, 'quantity', modalNewQty);
              onUpdate(fundModal.id, 'investAmount', modalNewInvest);
              setFundModal(null); setModalAddInvest(''); setModalEvalAfter('');
            }} className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold transition-colors" title={modalMode === 'idle' ? '추가투자금액 또는 평가금액을 입력하세요' : ''}>적용</button>
          </div>
        </div>
      </div>
    )}
    {savingsModalItem && (
      <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center" onClick={closeSavingsModal}>
        <div className="bg-[#1e293b] rounded-xl border border-emerald-600/50 shadow-2xl p-5 w-[420px] max-w-[94vw]" onClick={e => e.stopPropagation()}>
          <h3 className="text-emerald-300 font-bold text-sm mb-3 flex items-center gap-2">
            🏦 예적금 적립{savingsModalItem.name && <span className="text-gray-400 font-normal">— {savingsModalItem.name}</span>}
          </h3>
          {/* 요약 */}
          <div className="text-[12px] text-gray-400 bg-gray-900/60 rounded-lg px-3 py-2.5 mb-3 space-y-1">
            <div className="flex justify-between"><span>연이율</span><span className="text-emerald-200 font-bold">{cleanNum(savingsModalItem.annualRate)}%</span></div>
            {(savingsModalItem.startDate || savingsModalItem.endDate) && (
              <div className="flex justify-between"><span>투자기간</span><span className="text-emerald-200">{formatSavingsPeriod(savingsModalItem.startDate, savingsModalItem.endDate)}</span></div>
            )}
            {savingsMaturity(savingsModalItem) > 0 && (
              <div className="flex justify-between"><span>만기금액</span><span className="text-emerald-300 font-bold">{formatCurrency(savingsMaturity(savingsModalItem))}</span></div>
            )}
            <div className="flex justify-between border-t border-gray-700/50 pt-1"><span>총 투자금액</span><span className="text-blue-300 font-bold">{formatCurrency(savingsModalItem.investAmount)}</span></div>
            <div className="flex justify-between"><span>예상 평가금액(현재)</span><span className="text-white font-bold">{formatCurrency(savingsModalItem.evalAmount)}</span></div>
            <div className="flex justify-between"><span>차익</span><span className={`font-bold ${cleanNum(savingsModalItem.profit) >= 0 ? 'text-red-300' : 'text-blue-300'}`}>{formatCurrency(savingsModalItem.profit)}</span></div>
          </div>
          {/* 적립 내역 */}
          {(savingsModalItem.deposits || []).length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-gray-400 mb-1">적립 내역 ({savingsModalItem.deposits.length}건) · 입금액 <span className="text-emerald-300/80">(현재 평가금)</span></div>
              <div className="max-h-[150px] overflow-y-auto space-y-1 pr-0.5">
                {savingsModalItem.deposits.map(d => {
                  const depEval = savingsDepositEval(savingsModalItem, d);
                  return (
                  <div key={d.id} className="flex items-center justify-between bg-gray-900/40 rounded px-2.5 py-1.5 text-[12px]">
                    <span className="text-gray-300 font-mono">{d.date || '날짜미정'}</span>
                    <span className="text-right">
                      <span className="text-blue-200 font-bold">{formatCurrency(d.amount)}</span>
                      <span className="text-emerald-300/80 ml-1">({depEval > 0 ? formatCurrency(depEval) : '예정'})</span>
                    </span>
                    <button onClick={() => onRemoveSavingsDeposit(savingsModalItem.id, d.id)} className="text-gray-500 hover:text-red-300 transition-colors ml-1 shrink-0" title="이 적립 삭제"><Trash2 size={12} /></button>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* 적립 추가 폼 */}
          <div className="bg-gray-900/40 border border-emerald-700/30 rounded-lg px-3 py-2.5 mb-3 space-y-2">
            <div className="text-emerald-300 font-bold text-[11px]">적립 입금 추가</div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-900 border border-gray-600 rounded-lg px-2 py-2 shrink-0">
                <Calendar size={12} className="text-gray-400" />
                <CustomDatePicker value={savingsAddDate} onChange={setSavingsAddDate} placeholder="입금일" />
              </div>
              <input type="text" inputMode="numeric" className="flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-blue-200 font-bold text-sm outline-none focus:border-emerald-500 caret-blue-400" value={savingsAddAmount} placeholder="예: 1,000,000" onFocus={e => e.target.select()}
                onChange={e => setSavingsAddAmount(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && cleanNum(savingsAddAmount) > 0) { onAddSavingsDeposit(savingsModalItem.id, savingsAddDate || todayStr, savingsAddAmount); setSavingsAddAmount(''); } }} />
              <button disabled={cleanNum(savingsAddAmount) <= 0} onClick={() => { onAddSavingsDeposit(savingsModalItem.id, savingsAddDate || todayStr, savingsAddAmount); setSavingsAddAmount(''); }} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold transition-colors shrink-0">추가</button>
            </div>
            {cleanNum(savingsAddAmount) > 0 && (
              <div className="text-[10px] text-gray-500">{savingsAddDate || todayStr} 에 {formatCurrency(cleanNum(savingsAddAmount))} 적립 → 가입일부터 연이율 단리 누적</div>
            )}
          </div>
          <button onClick={closeSavingsModal} className="w-full py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors">닫기</button>
        </div>
      </div>
    )}
    <div className="bg-[#0f172a] rounded-xl shadow-lg border border-gray-700 overflow-hidden w-full">
      {hiddenColumns.length > 0 && (
        <div className="flex items-end gap-1 px-3 pt-2 pb-0 flex-wrap bg-[#080e1c]">
          {PT_COLS.filter(c => hiddenColumns.includes(c.key)).map(col => (
            <button
              key={col.key}
              onClick={() => onToggleColumn(col.key)}
              className="px-2.5 py-1 text-[10px] font-bold text-gray-400 border border-gray-600 border-b-0 rounded-t-md bg-gray-800/80 hover:bg-gray-700 hover:text-gray-200 transition-colors"
              title={`${col.label} 열 표시`}
            >
              {col.label}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto w-full">
        <table className="w-full text-right">
          <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600 font-bold">
            <tr className="text-center">
              <th className="p-0 border-r border-gray-600 cursor-pointer hover:bg-red-400/15 transition-colors" style={{width:'10px',minWidth:'10px'}} onClick={() => onResetAllMarkedPortfolioRows()} title="클릭하여 전체 행 색상 초기화"></th>
              {!H('category') && (
                <th className="py-2 min-w-[60px] cursor-pointer hover:bg-gray-700 relative" onClick={() => onSort(null)} title="클릭하여 자산군 순서로 정렬 (주식→주식-a→채권→금→배당주식→리츠→현금→예수금→FUND)">
                  {hideStrip('category')}
                  구분
                </th>
              )}
              {!H('name') && (
                <th className="py-2 min-w-[130px] text-center px-2 text-gray-300 cursor-pointer hover:bg-gray-700 sticky left-0 z-20 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.6)] relative" onClick={() => onSort('name')}>
                  {hideStrip('name')}
                  종목명
                </th>
              )}
              {!H('code') && (
                <th className="py-2 min-w-[65px] cursor-pointer hover:bg-gray-700 relative" onClick={() => onSort('code')}>
                  {hideStrip('code')}
                  코드
                </th>
              )}
              {!H('changeRate') && (
                <th className="py-2 min-w-[65px] cursor-pointer hover:bg-gray-700 relative" onClick={() => onSort('changeRate')}>
                  {hideStrip('changeRate')}
                  등락률
                </th>
              )}
              {!H('currentPrice') && (
                <th className="py-2 min-w-[85px] text-center cursor-pointer hover:bg-gray-700 relative" onClick={() => onSort('currentPrice')}>
                  {hideStrip('currentPrice')}
                  {isOverseas ? '현재가(USD)' : '현재가'}
                </th>
              )}
              {!H('purchasePrice') && (
                <th className="py-2 min-w-[85px] text-center cursor-pointer hover:bg-gray-700 relative" onClick={() => onSort('purchasePrice')}>
                  {hideStrip('purchasePrice')}
                  {isOverseas ? '구매단가(USD)' : '구매단가'}
                </th>
              )}
              {!H('quantity') && (
                <th className="py-2 min-w-[75px] bg-blue-900/20 text-blue-200 cursor-pointer hover:bg-blue-800/50 relative" onClick={() => onSort('quantity')}>
                  {hideStrip('quantity')}
                  보유수량
                </th>
              )}
              {!H('investAmount') && (
                <th className="py-2 min-w-[90px] bg-blue-900/20 text-blue-200 cursor-pointer hover:bg-blue-800/50 relative" onClick={() => onSort('investAmount')}>
                  {hideStrip('investAmount')}
                  투자금액
                </th>
              )}
              {!H('investRatio') && (
                <th className="py-2 min-w-[60px] bg-blue-900/20 text-blue-200 cursor-pointer hover:bg-blue-800/50 relative" onClick={() => onSort('investRatio')}>
                  {hideStrip('investRatio')}
                  비중
                </th>
              )}
              {!H('evalAmount') && (
                <th className="py-2 min-w-[90px] bg-yellow-900/20 text-yellow-500 cursor-pointer hover:bg-yellow-800/50 relative" onClick={() => onSort('evalAmount')}>
                  {hideStrip('evalAmount')}
                  평가금액
                </th>
              )}
              {!H('evalRatio') && (
                <th className="py-2 min-w-[60px] bg-yellow-900/20 text-yellow-500 cursor-pointer hover:bg-yellow-800/50 relative" onClick={() => onSort('evalRatio')}>
                  {hideStrip('evalRatio')}
                  비중
                </th>
              )}
              {!H('returnRate') && (
                <th className="py-2 min-w-[65px] cursor-pointer hover:bg-gray-700 relative" onClick={() => onSort('returnRate')}>
                  {hideStrip('returnRate')}
                  수익률
                </th>
              )}
              {!H('profit') && (
                <th className="py-2 min-w-[80px] cursor-pointer hover:bg-gray-700 relative" onClick={() => onSort('profit')}>
                  {hideStrip('profit')}
                  차익
                </th>
              )}
              <th className={`py-2 text-center ${isRetirement ? 'w-[64px] min-w-[64px]' : 'w-[36px] min-w-[36px]'}`}><button onClick={onAddStock} title="종목 추가" className="text-gray-400 hover:text-purple-400 transition-colors p-1"><Plus size={14} /></button></th>
            </tr>
          </thead>
          <tbody>
            {stockItems.map((item) => {
              const fStatus = stockFetchStatus?.[item.code];
              const isRefreshing = fStatus === 'loading';
              const assetClass = item.assetClass ?? getAssetClass(item.category);
              const markColor = markedPortfolioRows[item.id];
              const rowMarkClass = markColor ? MARK_ROW_BG[markColor] : 'hover:bg-gray-800/40';
              const stickyMarkClass = markColor ? MARK_STICKY_BG[markColor] : 'bg-[#0f172a] group-hover:bg-[#1a2535]';
              return (
                <tr key={item.id} className={`group transition-colors border-b border-gray-700 ${rowMarkClass}`}>
                  {/* 색상 스트립 — 클릭 시 yellow→slate→rose→brown→해제 사이클 */}
                  <td className="p-0 border-r border-gray-600" style={{width:'10px',minWidth:'10px'}}>
                    <button
                      title="클릭하여 행 색상 토글 (노랑→슬레이트→로즈→갈색→해제)"
                      className="block w-full cursor-pointer border-0 outline-none rounded"
                      style={{margin:'6px 0', minHeight:'24px', backgroundColor: markColor ? MARK_STRIP_BG[markColor] : 'transparent'}}
                      onClick={() => onToggleMarkedPortfolioRow(item.id)}
                    />
                  </td>
                  {/* 구분 */}
                  {!H('category') && (
                    <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                      <div className="flex flex-row h-full">
                        <CategoryCell item={item} portfolio={portfolio} showAssetClass={showAssetClass} onUpdate={onUpdate} />
                        {showAssetClass && (
                          <>
                            <div className="w-px bg-gray-600/60 self-stretch" />
                            <span
                              className="w-5 shrink-0 flex items-center justify-center text-[10px] font-bold cursor-pointer select-none text-gray-500 hover:text-gray-400 transition-colors"
                              onClick={() => onUpdate(item.id, 'assetClass', assetClass === 'D' ? 'S' : 'D')}
                              title={`클릭: ${assetClass === 'D' ? '안전(S)' : '위험(D)'}으로 변경`}
                            >{assetClass}</span>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                  {/* 종목명 */}
                  {!H('name') && (
                    <td className={`p-0 border-r border-gray-600 sticky left-0 z-10 ${stickyMarkClass} [box-shadow:2px_0_6px_rgba(0,0,0,0.6)] ${CELL_FOCUS}`}>
                      <div className="flex items-center gap-1 px-1">
                        <input type="text" data-col="name" className={`${inp} text-center flex-1 px-2 text-gray-300 caret-blue-400`} value={item.name} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'name', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'name')} />
                        {fStatus === 'success' && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="갱신 완료" />}
                        {fStatus === 'fail' && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="갱신 실패" />}
                        {fStatus === 'loading' && <RefreshCw size={10} className="animate-spin text-yellow-400 shrink-0" title="갱신 중..." />}
                        {!fStatus && item.code && <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0" title="미갱신" />}
                      </div>
                    </td>
                  )}
                  {/* 코드 */}
                  {!H('code') && (
                    <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                      <input type="text" data-col="code" className={`${inp} text-center text-gray-400 text-xs font-mono caret-blue-400`} value={item.code} onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'code', e.target.value)} onBlur={e => onBlur(item.id, e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'code')} />
                    </td>
                  )}
                  {/* 등락률 */}
                  {!H('changeRate') && (
                    <td className={`p-0 border-r border-gray-600 align-middle text-[13px] whitespace-nowrap ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                      <div className={`w-full h-full py-3 px-3 flex items-center justify-center cursor-pointer hover:bg-gray-700/50 transition-colors font-bold ${item.changeRate > 0 ? 'text-red-400' : item.changeRate < 0 ? 'text-blue-400' : 'text-gray-500'}`} onClick={() => item.code && window.open((isOverseas || /^[A-Za-z]+$/.test(item.code)) ? `https://finance.yahoo.com/quote/${item.code.toUpperCase()}` : `https://m.stock.naver.com/domestic/stock/${item.code.toUpperCase()}/total`, '_blank')} title="상세">{formatChangeRate(item.changeRate)}</div>
                    </td>
                  )}
                  {/* 현재가 */}
                  {!H('currentPrice') && (
                    <td className={`p-0 border-r border-gray-600 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                      <div className={`w-full h-full py-3 px-3 text-right text-gray-300 font-bold cursor-pointer hover:bg-teal-900/30 transition-colors flex items-center justify-end gap-1 ${isRefreshing ? 'animate-pulse' : ''}`} onClick={() => item.code && onSingleRefresh(item.id, item.code)} title={item.code ? (isOverseas ? `클릭하여 현재가 새로고침 (≈${formatNumber(Math.round(cleanNum(item.currentPrice) * usdkrw))}원)` : "클릭하여 현재가 새로고침") : "종목코드를 먼저 입력하세요"}>
                        {isRefreshing && <RefreshCw size={11} className="text-teal-400 animate-spin shrink-0" />}
                        <span>{isOverseas ? formatUSD(item.currentPrice) : formatNumber(item.currentPrice)}</span>
                      </div>
                    </td>
                  )}
                  {/* 구매단가 */}
                  {!H('purchasePrice') && (
                    <td className={`${td} text-right text-gray-400 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                      {isOverseas
                        ? (cleanNum(item.purchasePrice) > 0 ? formatUSD(item.purchasePrice) : <span className="text-gray-600">-</span>)
                        : (cleanNum(item.quantity) > 0 ? formatNumber(Math.round(cleanNum(item.investAmount) / cleanNum(item.quantity))) : <span className="text-gray-600">-</span>)
                      }
                    </td>
                  )}
                  {/* 보유수량 */}
                  {!H('quantity') && (
                    <td className={`p-0 border-r border-gray-600 bg-blue-900/10 ${CELL_FOCUS}`}>
                      <input type="text" data-col="quantity" className={`${inp} text-center text-blue-200 caret-blue-400`} value={numericVal(item.id, 'quantity', formatNumber(item.quantity))} onFocus={numericFocus(item.id, 'quantity', item.quantity)} onChange={e => numericChange(e.target.value)} onBlur={numericBlur(item.id, 'quantity')} onKeyDown={e => handleTableKeyDown(e, 'quantity')} />
                    </td>
                  )}
                  {/* 투자금액 */}
                  {!H('investAmount') && (
                    <td className={`p-0 border-r border-gray-600 bg-blue-900/10 ${CELL_FOCUS}`}>
                      {isOverseas
                        ? <input type="text" data-col="investAmountUSD" className={`${inp} text-right text-blue-200 px-3 caret-blue-400`} value={editingInvestId === item.id ? editingInvestVal : formatUSD(cleanNum(item.purchasePrice) * cleanNum(item.quantity))} onFocus={e => { const usd = cleanNum(item.purchasePrice) * cleanNum(item.quantity); setEditingInvestId(item.id); setEditingInvestVal(usd > 0 ? String(usd) : ''); e.target.select(); }} onChange={e => setEditingInvestVal(e.target.value)} onBlur={() => { const usd = cleanNum(editingInvestVal); const qty = cleanNum(item.quantity); onUpdate(item.id, 'purchasePrice', qty > 0 ? usd / qty : 0); setEditingInvestId(null); }} onKeyDown={e => handleTableKeyDown(e, 'investAmountUSD')} />
                        : <input type="text" data-col="investAmount" className={`${inp} text-right text-blue-200 px-3 caret-blue-400`} value={numericVal(item.id, 'investAmount', formatNumber(item.investAmount))} onFocus={numericFocus(item.id, 'investAmount', item.investAmount)} onChange={e => numericChange(e.target.value)} onBlur={numericBlur(item.id, 'investAmount')} onKeyDown={e => handleTableKeyDown(e, 'investAmount')} />
                      }
                    </td>
                  )}
                  {/* 비중(투자) */}
                  {!H('investRatio') && (
                    <td className={`${td} text-blue-300 bg-blue-900/10 text-center ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.investRatio)}</td>
                  )}
                  {/* 평가금액 */}
                  {!H('evalAmount') && (
                    <td className={`${td} text-white font-bold text-right bg-[rgba(113,63,18,0.2)] ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? fmtDual(item.evalAmount) : formatCurrency(item.evalAmount)}</td>
                  )}
                  {/* 비중(평가) */}
                  {!H('evalRatio') && (
                    <td className={`${td} text-yellow-600 bg-yellow-900/10 text-center ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.evalRatio)}</td>
                  )}
                  {/* 수익률 */}
                  {!H('returnRate') && (
                    <td className={`${td} text-center font-bold ${item.returnRate > 0 ? 'text-red-400' : 'text-blue-400'} ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.returnRate)}</td>
                  )}
                  {/* 차익 */}
                  {!H('profit') && (
                    <td className={`${td} font-bold text-right ${item.profit > 0 ? 'text-red-400' : 'text-blue-400'} ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? fmtDual(item.profit) : formatCurrency(item.profit)}</td>
                  )}
                  <td className="text-center py-2.5"><button onClick={() => onDelete(item.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1"><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
            {depositItems.map((item) => (
              <tr key={item.id} className="bg-gray-800/80 font-bold border-t-2 border-b border-gray-600">
                <td className="p-0 border-r border-gray-600" style={{width:'10px',minWidth:'10px'}}></td>
                {depositColSpan > 0 && (
                  <td className="py-3 px-3 border-r border-gray-600 text-center text-yellow-500 tracking-[0.2em] text-[14px]" colSpan={depositColSpan}>{isOverseas ? '예수금 (USD CASH)' : '예수금 (CASH)'}</td>
                )}
                {!H('investAmount') && (
                  <td className={`p-0 border-r border-gray-600 bg-blue-900/20 ${CELL_FOCUS}`}><input type="text" className="w-full h-full bg-transparent outline-none font-bold text-right text-blue-300 px-3 py-3 focus:bg-blue-800/50 transition-colors text-[14px] caret-blue-400" value={numericVal(item.id, 'depositAmount', formatNumber(item.depositAmount))} onFocus={numericFocus(item.id, 'depositAmount', item.depositAmount)} onChange={e => numericChange(e.target.value)} onBlur={numericBlur(item.id, 'depositAmount')} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} /></td>
                )}
                {!H('investRatio') && (
                  <td className="py-3 px-3 border-r border-gray-600 text-blue-300 bg-blue-900/20 text-right">{formatPercent(item.investRatio)}</td>
                )}
                {!H('evalAmount') && (
                  <td className="py-3 px-3 border-r border-gray-600 text-white font-bold text-right bg-yellow-900/20 text-[14px]">{isOverseas ? fmtDual(item.evalAmount) : formatCurrency(item.evalAmount)}</td>
                )}
                {!H('evalRatio') && (
                  <td className="py-3 px-3 border-r border-gray-600 text-yellow-500 bg-yellow-900/20 text-right">{formatPercent(item.evalRatio)}</td>
                )}
                {!H('returnRate') && (
                  <td className="py-3 px-3 border-r border-gray-600 text-center text-gray-500">-</td>
                )}
                {!H('profit') && (
                  <td className="py-3 px-3 border-r border-gray-600 text-right text-gray-500">{isOverseas ? '$0.00' : '₩0'}</td>
                )}
                <td className="text-center py-2.5 bg-gray-800/50">🔒</td>
              </tr>
            ))}
            {isRetirement && fundItems.map((item) => {
              const fStatus = stockFetchStatus?.[item.code];
              const isRefreshing = fStatus === 'loading';
              const assetClass = item.assetClass ?? 'S';
              const storedQty = cleanNum(item.quantity);
              const purchasePriceCalc = storedQty > 0 ? Math.round(cleanNum(item.investAmount) / storedQty) : 0;
              const markColor = markedPortfolioRows[item.id];
              const rowMarkClass = markColor ? MARK_ROW_BG[markColor] : 'bg-indigo-950/30 hover:bg-indigo-900/20';
              const stickyMarkClass = markColor ? MARK_STICKY_BG[markColor] : 'bg-indigo-950/60 group-hover:bg-indigo-900/30';
              return (
                <tr key={item.id} className={`group transition-colors border-b border-indigo-800/30 ${rowMarkClass}`}>
                  {/* 색상 스트립 — 클릭 시 yellow→slate→rose→brown→해제 사이클 */}
                  <td className="p-0 border-r border-gray-600" style={{width:'10px',minWidth:'10px'}}>
                    <button
                      title="클릭하여 행 색상 토글 (노랑→슬레이트→로즈→갈색→해제)"
                      className="block w-full cursor-pointer border-0 outline-none rounded"
                      style={{margin:'6px 0', minHeight:'24px', backgroundColor: markColor ? MARK_STRIP_BG[markColor] : 'transparent'}}
                      onClick={() => onToggleMarkedPortfolioRow(item.id)}
                    />
                  </td>
                  {/* 구분: FUND 링크 + S/D 텍스트 토글 */}
                  {!H('category') && (
                    <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                      <div className="flex flex-row h-full items-stretch">
                        <a href={item.code?.startsWith('MA:') ? 'https://investments.miraeasset.com' : 'https://www.funetf.co.kr/'} target="_blank" rel="noopener noreferrer"
                           className="flex-1 py-3 px-1 text-center text-xs font-bold text-indigo-300 hover:text-indigo-100 hover:underline transition-colors"
                           title={item.code?.startsWith('MA:') ? '미래에셋자산운용' : 'funetf'}>
                          {item.code?.startsWith('MA:') ? 'MIRAE' : 'FUND'}
                        </a>
                        {showAssetClass && (
                          <>
                            <div className="w-px bg-gray-600/60 self-stretch" />
                            <span
                              className={`w-5 shrink-0 flex items-center justify-center text-[10px] font-bold cursor-pointer select-none transition-colors ${assetClass === 'D' ? 'text-red-400 hover:text-red-300' : 'text-emerald-400 hover:text-emerald-300'}`}
                              onClick={() => onUpdate(item.id, 'assetClass', assetClass === 'D' ? 'S' : 'D')}
                              title={`클릭: ${assetClass === 'D' ? '안전(S)' : '위험(D)'}으로 변경`}
                            >{assetClass}</span>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                  {/* 종목명 */}
                  {!H('name') && (
                    <td className={`p-0 border-r border-gray-600 sticky left-0 z-10 ${stickyMarkClass} [box-shadow:2px_0_6px_rgba(0,0,0,0.6)] ${CELL_FOCUS}`}>
                      <div className="flex items-center gap-1 px-1">
                        <input type="text" data-col="name" className={`${inp} text-center flex-1 px-2 text-indigo-200 caret-blue-400`} value={item.name} placeholder="펀드명" onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'name', e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'name')} />
                        {fStatus === 'success' && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="갱신 완료" />}
                        {fStatus === 'fail' && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="갱신 실패" />}
                        {fStatus === 'loading' && <RefreshCw size={10} className="animate-spin text-yellow-400 shrink-0" title="갱신 중..." />}
                      </div>
                    </td>
                  )}
                  {/* 코드 */}
                  {!H('code') && (
                    <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                      <input type="text" data-col="code" className={`${inp} text-center text-indigo-400 text-[11px] font-mono caret-blue-400`} value={item.code} placeholder="K55301DW8222" onFocus={e => e.target.select()} onChange={e => onUpdate(item.id, 'code', e.target.value)} onBlur={e => onBlur(item.id, e.target.value)} onKeyDown={e => handleTableKeyDown(e, 'code')} />
                    </td>
                  )}
                  {/* 등락률 / 등락액 */}
                  {!H('changeRate') && (
                    <td className={`p-0 border-r border-gray-600 align-middle ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                      {(() => {
                        const isMirae = item.code?.startsWith('MA:');
                        const changeVal = item.changeRate ?? 0;
                        const display = formatChangeRate(changeVal);
                        const url = isMirae
                          ? `https://investments.miraeasset.com/magi/fund/view.do?fundGb=2&fundCd=${item.code.replace('MA:', '')}`
                          : `https://www.funetf.co.kr/product/fund/view/${item.code}`;
                        const linkTitle = isMirae ? '미래에셋에서 상세보기' : 'funetf에서 상세보기';
                        return (
                          <div className={`w-full h-full py-3 px-3 flex items-center justify-center font-bold text-[13px] cursor-pointer hover:bg-indigo-900/30 transition-colors ${changeVal > 0 ? 'text-red-400' : changeVal < 0 ? 'text-blue-400' : 'text-gray-500'}`}
                               onClick={() => item.code && window.open(url, '_blank')}
                               title={item.code ? linkTitle : ''}>
                            {display}
                          </div>
                        );
                      })()}
                    </td>
                  )}
                  {/* 현재가(기준가) */}
                  {!H('currentPrice') && (
                    <td className={`p-0 border-r border-gray-600 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                      <div className={`w-full h-full py-3 px-3 text-right text-indigo-200 font-bold cursor-pointer hover:bg-indigo-900/30 transition-colors flex items-center justify-end gap-1 ${isRefreshing ? 'animate-pulse' : ''}`}
                           onClick={() => item.code && onSingleRefresh(item.id, item.code)}
                           title={item.code ? '클릭하여 기준가 새로고침' : '펀드코드를 먼저 입력하세요'}>
                        {isRefreshing && <RefreshCw size={11} className="text-indigo-400 animate-spin shrink-0" />}
                        <span>{formatFundPrice(item.currentPrice)}</span>
                      </div>
                    </td>
                  )}
                  {/* 구매단가 - 자동계산 */}
                  {!H('purchasePrice') && (
                    <td className={`${td} text-right text-gray-400 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                      {purchasePriceCalc > 0 ? formatNumber(purchasePriceCalc) : <span className="text-gray-600">-</span>}
                    </td>
                  )}
                  {/* 보유수량 */}
                  {!H('quantity') && (
                    <td className={`${td} text-center bg-blue-900/10 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                      {storedQty > 0
                        ? <span className="text-indigo-300 font-bold">{formatNumber(Math.round(storedQty))}</span>
                        : <span className="text-orange-400 text-[11px] cursor-pointer hover:text-orange-300" onClick={() => { setFundModal({ id: item.id, currentPrice: cleanNum(item.currentPrice), currentQty: 0, currentInvest: 0 }); setModalAddInvest(''); setModalEvalAfter(''); }} title="클릭하여 수량 설정">미설정</span>
                      }
                    </td>
                  )}
                  {/* 투자금액 */}
                  {!H('investAmount') && (
                    <td className={`p-0 border-r border-gray-600 bg-blue-900/10 ${CELL_FOCUS}`}>
                      <input type="text" data-col="investAmount" className={`${inp} text-right text-blue-200 px-3 caret-blue-400`} value={numericVal(item.id, 'investAmount', formatNumber(item.investAmount))} onFocus={numericFocus(item.id, 'investAmount', item.investAmount)} onChange={e => numericChange(e.target.value)} onBlur={numericBlur(item.id, 'investAmount')} onKeyDown={e => handleTableKeyDown(e, 'investAmount')} />
                    </td>
                  )}
                  {/* 비중(투자) */}
                  {!H('investRatio') && (
                    <td className={`${td} text-blue-300 bg-blue-900/10 text-center ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.investRatio)}</td>
                  )}
                  {/* 평가금액 */}
                  {!H('evalAmount') && (
                    <td className={`${td} text-white font-bold text-right bg-yellow-900/20 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatCurrency(item.evalAmount)}</td>
                  )}
                  {/* 비중(평가) */}
                  {!H('evalRatio') && (
                    <td className={`${td} text-yellow-600 bg-yellow-900/10 text-center ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.evalRatio)}</td>
                  )}
                  {/* 수익률 */}
                  {!H('returnRate') && (
                    <td className={`${td} text-center font-bold ${item.returnRate > 0 ? 'text-red-400' : 'text-blue-400'} ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.returnRate)}</td>
                  )}
                  {/* 차익 */}
                  {!H('profit') && (
                    <td className={`${td} font-bold text-right ${item.profit > 0 ? 'text-red-400' : 'text-blue-400'} ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatCurrency(item.profit)}</td>
                  )}
                  <td className="p-0 align-middle">
                    <div className="flex items-stretch justify-center h-full min-h-[36px]">
                      <button
                        onClick={() => { setFundModal({ id: item.id, currentPrice: cleanNum(item.currentPrice), currentQty: storedQty, currentInvest: cleanNum(item.investAmount) }); setModalAddInvest(''); setModalEvalAfter(''); }}
                        className="flex-1 flex items-center justify-center text-indigo-400 hover:text-indigo-100 hover:bg-indigo-600/40 border-r border-gray-600/60 transition-colors"
                        title="매수/적립 수량 계산"
                      ><Plus size={14} /></button>
                      <button
                        onClick={() => onDelete(item.id)}
                        className="flex-1 flex items-center justify-center text-gray-500 hover:text-red-200 hover:bg-red-600/40 transition-colors"
                        title="펀드 삭제"
                      ><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {isRetirement && (
              <tr className="border-b border-indigo-800/20 bg-indigo-950/10">
                <td colSpan={totalColCount} className="py-1.5 text-center">
                  <button onClick={onAddFund} className="text-indigo-500 hover:text-indigo-300 text-xs flex items-center gap-1 mx-auto transition-colors px-3 py-1 rounded hover:bg-indigo-900/30">
                    <Plus size={12} /> 펀드 추가
                  </button>
                </td>
              </tr>
            )}
            {/* ── 예적금(savings) 행 — 퇴직연금(dc-irp) 전용 ── */}
            {showSavings && savingsItems.map((item) => {
              const assetClass = item.assetClass ?? 'S';
              const markColor = markedPortfolioRows[item.id];
              const rowMarkClass = markColor ? MARK_ROW_BG[markColor] : 'bg-emerald-950/20 hover:bg-emerald-900/20';
              const stickyMarkClass = markColor ? MARK_STICKY_BG[markColor] : 'bg-emerald-950/50 group-hover:bg-emerald-900/30';
              const investAmt = cleanNum(item.investAmount);
              const periodLabel = formatSavingsPeriod(item.startDate, item.endDate);
              const maturityAmt = savingsMaturity(item);
              return (
                <tr key={item.id} className={`group transition-colors border-b border-emerald-800/30 ${rowMarkClass}`}>
                  {/* 색상 스트립 */}
                  <td className="p-0 border-r border-gray-600" style={{width:'10px',minWidth:'10px'}}>
                    <button
                      title="클릭하여 행 색상 토글 (노랑→슬레이트→로즈→갈색→해제)"
                      className="block w-full cursor-pointer border-0 outline-none rounded"
                      style={{margin:'6px 0', minHeight:'24px', backgroundColor: markColor ? MARK_STRIP_BG[markColor] : 'transparent'}}
                      onClick={() => onToggleMarkedPortfolioRow(item.id)}
                    />
                  </td>
                  {/* 구분: 예적금 배지 + S/D 토글 */}
                  {!H('category') && (
                    <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                      <div className="flex flex-row h-full items-stretch">
                        <span className="flex-1 py-3 px-1 text-center text-xs font-bold text-emerald-300">예적금</span>
                        {showAssetClass && (
                          <>
                            <div className="w-px bg-gray-600/60 self-stretch" />
                            <span
                              className={`w-5 shrink-0 flex items-center justify-center text-[10px] font-bold cursor-pointer select-none transition-colors ${assetClass === 'D' ? 'text-red-400 hover:text-red-300' : 'text-emerald-400 hover:text-emerald-300'}`}
                              onClick={() => onUpdateSavingsField(item.id, 'assetClass', assetClass === 'D' ? 'S' : 'D')}
                              title={`클릭: ${assetClass === 'D' ? '안전(S)' : '위험(D)'}으로 변경`}
                            >{assetClass}</span>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                  {/* 종목명 */}
                  {!H('name') && (
                    <td className={`p-0 border-r border-gray-600 sticky left-0 z-10 ${stickyMarkClass} [box-shadow:2px_0_6px_rgba(0,0,0,0.6)] ${CELL_FOCUS}`}>
                      <input type="text" className={`${inp} text-center w-full px-2 text-emerald-200 caret-blue-400`} value={item.name} placeholder="예적금명" onFocus={e => e.target.select()} onChange={e => onUpdateSavingsField(item.id, 'name', e.target.value)} />
                    </td>
                  )}
                  {/* 코드 칸 → 연이율 */}
                  {!H('code') && (
                    <td className={`p-0 border-r border-gray-600 ${CELL_FOCUS}`}>
                      <div className="flex items-center justify-center gap-0.5 px-1">
                        <span className="text-emerald-400 text-[11px]">연</span>
                        <input type="text" inputMode="decimal" className={`${inp} text-right text-emerald-300 text-[12px] w-[40px] caret-blue-400`} value={item.annualRate ? String(item.annualRate) : ''} placeholder="0" onFocus={e => e.target.select()} onChange={e => { const v = e.target.value; if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) onUpdateSavingsField(item.id, 'annualRate', v); }} />
                        <span className="text-emerald-400 text-[11px]">%</span>
                      </div>
                    </td>
                  )}
                  {/* 등락률 칸 → 연이율 1일 환산 */}
                  {!H('changeRate') && (
                    <td className={`${td} text-center font-bold text-red-400 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav} title="연이율 1일 환산 수익률">
                      {formatSavingsDailyRate(item.annualRate)}
                    </td>
                  )}
                  {/* 현재가 칸 → 투자기간 (달력) */}
                  {!H('currentPrice') && (
                    <td className="p-0 border-r border-gray-600">
                      <div className="flex flex-col items-center justify-center gap-0.5 py-2 px-1.5 min-w-[120px]">
                        <span className="text-emerald-200 text-[11px] font-bold text-center leading-tight">
                          {periodLabel || <span className="text-gray-600">기간 미설정</span>}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <CustomDatePicker value={item.startDate} onChange={v => onUpdateSavingsField(item.id, 'startDate', v)}
                            trigger={<button className="flex items-center gap-0.5 text-gray-400 hover:text-emerald-300 transition-colors" title="시작일 선택"><Calendar size={11} />{!item.startDate && '시작'}</button>} />
                          <span className="text-gray-600">~</span>
                          <CustomDatePicker value={item.endDate} onChange={v => onUpdateSavingsField(item.id, 'endDate', v)} align="right"
                            trigger={<button className="flex items-center gap-0.5 text-gray-400 hover:text-emerald-300 transition-colors" title="종료일 선택"><Calendar size={11} />{!item.endDate && '종료'}</button>} />
                        </div>
                      </div>
                    </td>
                  )}
                  {/* 구매단가 칸 → 미사용 */}
                  {!H('purchasePrice') && (
                    <td className={`${td} text-center text-gray-600 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>-</td>
                  )}
                  {/* 보유수량 칸 → 미사용 */}
                  {!H('quantity') && (
                    <td className={`${td} text-center text-gray-600 bg-blue-900/10 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>-</td>
                  )}
                  {/* 투자금액 → 적립 모달 */}
                  {!H('investAmount') && (
                    <td className={`${td} bg-blue-900/10 text-right ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                      {investAmt > 0
                        ? <button className="text-blue-200 font-bold hover:text-blue-100 hover:underline" onClick={() => openSavingsModal(item)} title="클릭하여 적립 내역 관리">{formatCurrency(investAmt)}</button>
                        : <span className="text-orange-400 text-[11px] cursor-pointer hover:text-orange-300" onClick={() => openSavingsModal(item)} title="클릭하여 적립 입력">미설정</span>}
                    </td>
                  )}
                  {/* 투자비중 */}
                  {!H('investRatio') && (
                    <td className={`${td} text-blue-300 bg-blue-900/10 text-center ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.investRatio)}</td>
                  )}
                  {/* 평가금액 (+ 만기금액 작은 글씨) */}
                  {!H('evalAmount') && (
                    <td className={`${td} text-right bg-yellow-900/20 ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav} title={maturityAmt > 0 ? `만기금액 ${formatCurrency(maturityAmt)}` : undefined}>
                      <div className="leading-tight">
                        <div className="text-white font-bold">{formatCurrency(item.evalAmount)}</div>
                        {maturityAmt > 0 && (
                          <div className="text-[10px] text-emerald-400/70 font-normal mt-0.5">만기 {formatCurrency(maturityAmt)}</div>
                        )}
                      </div>
                    </td>
                  )}
                  {/* 평가비중 */}
                  {!H('evalRatio') && (
                    <td className={`${td} text-yellow-600 bg-yellow-900/10 text-center ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.evalRatio)}</td>
                  )}
                  {/* 수익률 */}
                  {!H('returnRate') && (
                    <td className={`${td} text-center font-bold ${item.returnRate > 0 ? 'text-red-400' : item.returnRate < 0 ? 'text-blue-400' : 'text-gray-500'} ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatPercent(item.returnRate)}</td>
                  )}
                  {/* 차익 */}
                  {!H('profit') && (
                    <td className={`${td} font-bold text-right ${item.profit > 0 ? 'text-red-400' : item.profit < 0 ? 'text-blue-400' : 'text-gray-500'} ${RO_FOCUS}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{formatCurrency(item.profit)}</td>
                  )}
                  {/* 액션: 적립 + 삭제 */}
                  <td className="p-0 align-middle">
                    <div className="flex items-stretch justify-center h-full min-h-[36px]">
                      <button
                        onClick={() => openSavingsModal(item)}
                        className="flex-1 flex items-center justify-center text-emerald-400 hover:text-emerald-100 hover:bg-emerald-600/40 border-r border-gray-600/60 transition-colors"
                        title="적립 입금"
                      ><Plus size={14} /></button>
                      <button
                        onClick={() => onDelete(item.id)}
                        className="flex-1 flex items-center justify-center text-gray-500 hover:text-red-200 hover:bg-red-600/40 transition-colors"
                        title="예적금 삭제"
                      ><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {showSavings && (
              <tr className="border-b border-emerald-800/20 bg-emerald-950/10">
                <td colSpan={totalColCount} className="py-1.5 text-center">
                  <button onClick={onAddSavings} className="text-emerald-500 hover:text-emerald-300 text-xs flex items-center gap-1 mx-auto transition-colors px-3 py-1 rounded hover:bg-emerald-900/30">
                    <Plus size={12} /> 예적금 추가
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-[#1e293b] font-bold border-t-2 border-gray-500">
            {showRetirementStats && retirementStats && (
              <tr className="border-b border-amber-600/30 bg-amber-950/20">
                <td colSpan={totalColCount} className="py-2.5 px-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-amber-400 font-bold text-xs tracking-wide">퇴직연금 자산 비율</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-red-400 font-bold text-xs">위험 D</span>
                      <span className={`font-bold text-sm ${Math.abs(retirementStats.dRatio - 70) <= 5 ? 'text-red-400' : 'text-red-300'}`}>
                        {retirementStats.dRatio.toFixed(1)}%
                      </span>
                      <span className="text-gray-600 text-[11px]">(목표 70%)</span>
                      {Math.abs(retirementStats.dRatio - 70) > 5 && (
                        <span className="text-orange-400 text-[11px]">
                          {retirementStats.dRatio > 70 ? `+${(retirementStats.dRatio - 70).toFixed(1)}%` : `${(retirementStats.dRatio - 70).toFixed(1)}%`}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-400 font-bold text-xs">안전 S</span>
                      <span className={`font-bold text-sm ${Math.abs(retirementStats.sRatio - 30) <= 5 ? 'text-emerald-400' : 'text-emerald-300'}`}>
                        {retirementStats.sRatio.toFixed(1)}%
                      </span>
                      <span className="text-gray-600 text-[11px]">(목표 30%)</span>
                    </div>
                    <div className="flex-1 flex items-center gap-1 min-w-[120px]">
                      <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(retirementStats.dRatio, 100)}%`,
                            background: Math.abs(retirementStats.dRatio - 70) <= 5
                              ? 'linear-gradient(90deg, #ef4444 0%, #f97316 100%)'
                              : 'linear-gradient(90deg, #dc2626 0%, #ea580c 100%)',
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 shrink-0">D70/S30</span>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            <tr>
              <td className="p-0 border-r border-gray-600" style={{width:'10px',minWidth:'10px'}}></td>
              {depositColSpan > 0 && (
                <td colSpan={depositColSpan} className="py-3 text-center border-r border-gray-600 uppercase tracking-widest text-gray-500">Total Calculation</td>
              )}
              {!H('investAmount') && (
                <td className="py-3 px-2 text-blue-200 bg-blue-900/10 border-r border-gray-600">{isOverseas ? fmtDual(totals.totalInvest) : formatCurrency(totals.totalInvest)}</td>
              )}
              {!H('investRatio') && (
                <td className="py-3 text-center text-gray-400 bg-blue-900/10 border-r border-gray-600">100%</td>
              )}
              {!H('evalAmount') && (
                <td className="py-3 px-2 text-white bg-yellow-900/10 border-r border-gray-600">{isOverseas ? fmtDual(totals.totalEval) : formatCurrency(totals.totalEval)}</td>
              )}
              {!H('evalRatio') && (
                <td className="py-3 text-center text-yellow-500 bg-yellow-900/10 border-r border-gray-600">100%</td>
              )}
              {!H('returnRate') && (
                <td className={`py-3 text-center border-r border-gray-600 ${totals.totalProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatPercent(totals.totalInvest > 0 ? totals.totalProfit / totals.totalInvest * 100 : 0)}</td>
              )}
              {!H('profit') && (
                <td className={`py-3 px-2 border-r border-gray-600 ${totals.totalProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{isOverseas ? fmtDual(totals.totalProfit) : formatCurrency(totals.totalProfit)}</td>
              )}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    </>
  );
};

export default PortfolioTable;
