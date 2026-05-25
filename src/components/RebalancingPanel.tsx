// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Lock, HelpCircle, X, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { UI_CONFIG } from '../config';
import { MARK_ROW_BG, MARK_STICKY_BG } from '../constants';
import { cleanNum, formatCurrency, formatNumber, formatChangeRate, handleTableKeyDown, handleReadonlyCellNav } from '../utils';
import { PieLabelOutside } from '../chartUtils';
import RebalanceTargetPinModal from './RebalanceTargetPinModal';

const SAFE_CATEGORIES = ['채권', '현금', '예수금'];
const getItemUrl = (item) => {
  if (!item.code) return null;
  if (item.type === 'fund') return `https://www.funetf.co.kr/product/fund/view/${item.code}`;
  if (/^\d/.test(item.code)) return `https://m.stock.naver.com/domestic/stock/${item.code}/total`;
  if (/^[A-Za-z]+$/.test(item.code)) return `https://finance.yahoo.com/quote/${item.code.toUpperCase()}`;
  return null;
};
const getAssetClass = (item) => item.type === 'fund'
  ? (item.assetClass ?? 'S')
  : (item.assetClass ?? (SAFE_CATEGORIES.includes(item.category) ? 'S' : 'D'));

const RB_COLS = [
  { key: 'category', label: '구분' },
  { key: 'changeRate', label: '등락률' },
  { key: 'name', label: '종목명' },
  { key: 'code', label: '코드' },
  { key: 'curEval', label: '평가금' },
  { key: 'currentPrice', label: '현재가' },
  { key: 'targetRatio', label: '목표비중' },
  { key: 'curRatio', label: '현재비중' },
  { key: 'action', label: '수량' },
  { key: 'extraQty', label: '추가' },
  { key: 'maxAdd', label: '추가가능' },
  { key: 'cost', label: '실구매비용' },
  { key: 'expEval', label: '예상평가금' },
  { key: 'expRatio', label: '예상비중' },
];

export default function RebalancingPanel({
  activePortfolioAccountType,
  portfolio,
  settings,
  updateSettingsForType,
  rebalanceData,
  rebalanceSortConfig,
  handleRebalanceSort,
  rebalExtraQty,
  setRebalExtraQty,
  rebalCatDonutData,
  curCatDonutData,
  marketIndicators,
  hideAmounts,
  hoveredRebalCatSlice,
  setHoveredRebalCatSlice,
  hoveredCurCatSlice,
  setHoveredCurCatSlice,
  totals,
  handleUpdate,
  setPortfolio,
  showTable = true,
  showDonut = true,
  isRetirement = false,
  showRetirementStats = false,
  hiddenColumns = [],
  onToggleColumn = () => {},
  authUser = null,
  isAdmin = false,
  targetEditAuthorized = false,
  setTargetEditAuthorized = () => {},
  onAdminTargetChange = null,
  markedRebalRows = {},
  onToggleMarkedRebalRow = () => {},
  onManualSave = null,
  driveStatus = '',
}) {
  const [editingRatio, setEditingRatio] = useState({});
  const [dateEditMode, setDateEditMode] = useState(false);
  const [pinModal, setPinModal] = useState(null); // { onAuthorized: () => void } | null
  const [hoveredCurDSSlice, setHoveredCurDSSlice] = useState(null);
  const [hoveredProjDSSlice, setHoveredProjDSSlice] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showCostFormula, setShowCostFormula] = useState(false);
  const [helpPos, setHelpPos] = useState({ x: 0, y: 0 });
  const helpDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const datePickerRef = useRef(null);
  const openHelp = () => {
    setHelpPos({ x: Math.max(8, window.innerWidth / 2 - 220), y: Math.max(8, window.innerHeight / 2 - 280) });
    setHelpOpen(true);
  };
  const handleHelpDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    helpDrag.current = { active: true, offsetX: e.clientX - helpPos.x, offsetY: e.clientY - helpPos.y };
    const onMove = (ev) => {
      if (!helpDrag.current.active) return;
      setHelpPos({ x: ev.clientX - helpDrag.current.offsetX, y: ev.clientY - helpDrag.current.offsetY });
    };
    const onUp = () => {
      helpDrag.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const formatDisplayDate = (iso) => {
    if (!iso) return '날짜';
    const p = iso.split('-');
    return p.length === 3 ? `${p[0].slice(2)}/${p[1]}/${p[2]}` : iso;
  };
  const parseDisplayDate = (text) => {
    const p = text.replace(/[.\-]/g, '/').split('/');
    if (p.length === 3) {
      const y = p[0].length === 2 ? `20${p[0]}` : p[0];
      return `${y}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;
    }
    return null;
  };

  const H = (k) => hiddenColumns.includes(k);

  // 고정 모드 + 미인증 + 비관리자 → PIN 잠금
  const isFixedLocked = settings.targetMode !== 'variable' && !targetEditAuthorized && !isAdmin;
  const reportAdminChange = () => { if (onAdminTargetChange) onAdminTargetChange(); };

  const CAT_W = 80;
  const CHRATE_W = 65;
  const changeRateLeft = H('category') ? 0 : CAT_W;
  const nameLeft = changeRateLeft + (H('changeRate') ? 0 : CHRATE_W);

  const stickySpanKeys = ['category', 'changeRate', 'name'];
  const stickySpanCount = stickySpanKeys.filter(k => !H(k)).length;
  const retirementColSpan = 14 - hiddenColumns.length;

  const hideStrip = (key) => (
    <div
      className="absolute top-0 left-0 right-0 h-3 cursor-pointer z-10 hover:bg-indigo-400/25 transition-colors"
      onClick={e => { e.stopPropagation(); onToggleColumn(key); }}
      title="클릭하여 열 숨기기"
    />
  );

  const renderCompactPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
    if (percent < 0.07) return null;
    const RADIAN = Math.PI / 180;
    const radius = (innerRadius + outerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    const label = name.length > 3 ? name.slice(0, 3) : name;
    return (
      <text x={x} y={y} fill="black" textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight="bold" style={{ pointerEvents: 'none' }}>
        {label}
      </text>
    );
  };

  const isOverseasHeader = activePortfolioAccountType === 'overseas';
  const headerFx = marketIndicators.usdkrw || 1;
  const headerNativeTotalEval = isOverseasHeader ? totals.totalEval / headerFx : totals.totalEval;
  const headerDepositAmount = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
  const headerAmount = cleanNum(settings.amount);
  const headerUseDeposit = settings.useDepositAmount != null
    ? Math.min(Math.max(0, cleanNum(settings.useDepositAmount)), headerDepositAmount)
    : headerDepositAmount;
  const headerBaseCost = rebalanceData.reduce((s, d) => s + d.cost, 0);
  const headerExtraCost = rebalanceData.reduce((s, d) => s + (rebalExtraQty[d.id] || 0) * cleanNum(d.currentPrice), 0);
  const headerInvestable = settings.mode === 'rebalance' ? headerAmount : (headerUseDeposit + headerAmount);
  const headerTotalBuy = rebalanceData.reduce((s, d) => {
    const q = d.action + (rebalExtraQty[d.id] || 0);
    return s + (q > 0 ? q * cleanNum(d.currentPrice) : 0);
  }, 0);
  const headerTotalSell = rebalanceData.reduce((s, d) => {
    const q = d.action + (rebalExtraQty[d.id] || 0);
    return s + (q < 0 ? -q * cleanNum(d.currentPrice) : 0);
  }, 0);
  const headerDepositForBuy = settings.mode === 'rebalance' ? headerDepositAmount : headerUseDeposit;
  const rebalTotalAvailable = headerDepositForBuy + headerAmount + headerTotalSell;
  const rebalBalance = rebalTotalAvailable - headerTotalBuy;
  const rebalRemaining = Math.max(0, rebalBalance);

  useEffect(() => {
    if (settings.mode === 'deposit-only') {
      updateSettingsForType({ ...settings, mode: 'accumulate', amount: 0 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyRemainingToDeposit = () => {
    if (rebalRemaining <= 0) return;
    const isRebalance = settings.mode === 'rebalance';
    const newDeposit = isRebalance
      ? Math.round(rebalRemaining)
      : Math.round(headerDepositAmount - headerUseDeposit + rebalRemaining);
    setPortfolio(prev => prev.map(p => p.type === 'deposit' ? { ...p, depositAmount: newDeposit } : p));
    if (!isRebalance && settings.useDepositAmount != null) {
      updateSettingsForType({ ...settings, useDepositAmount: null });
    }
  };

  const formatRemaining = (n) => activePortfolioAccountType === 'overseas'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n))
    : formatNumber(Math.round(n));

  const makeCompactPieTooltip = (data) => ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const item = payload[0];
    const total = data.reduce((s, x) => s + x.value, 0);
    const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0.0';
    return (
      <div style={{ background: 'rgba(15,23,42,0.95)', border: '1px solid #374151', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 'bold', color: item.fill, whiteSpace: 'nowrap' }}>
        {item.name} {pct}%
      </div>
    );
  };

  return (
    <>
        {showTable && <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg w-full flex flex-col mb-6">
          <div className="px-5 py-3 bg-[#0f172a] border-b border-gray-700 flex flex-col xl:flex-row xl:items-start gap-4">
            <div className="flex items-center gap-1.5 shrink-0 pt-1">
              <span className="text-green-400 text-xl font-bold">리밸런싱</span>
              <button onClick={openHelp} className="text-gray-500 hover:text-sky-400 transition-colors" title="계산식 보기"><HelpCircle size={14} /></button>
            </div>
            <div className="flex-1 flex justify-end items-start gap-6">
              {(curCatDonutData.length > 0 || rebalCatDonutData.length > 0) && (
                <>
                  <div className="flex flex-col items-center">
                    <div className="text-gray-500 text-[10px] font-semibold mb-0">현재 비중</div>
                    <div style={{ height: 120, width: 120 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip content={makeCompactPieTooltip(curCatDonutData)} />
                          <Pie data={curCatDonutData} outerRadius="72%" dataKey="value" label={renderCompactPieLabel} labelLine={false} onMouseEnter={(data) => setHoveredCurCatSlice(data)} onMouseLeave={() => setHoveredCurCatSlice(null)}>
                            {curCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="text-gray-500 text-[10px] font-semibold mb-0">리밸런싱 후 비중</div>
                    <div style={{ height: 120, width: 120 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip content={makeCompactPieTooltip(rebalCatDonutData)} />
                          <Pie data={rebalCatDonutData} outerRadius="72%" dataKey="value" label={renderCompactPieLabel} labelLine={false} onMouseEnter={(data) => setHoveredRebalCatSlice(data)} onMouseLeave={() => setHoveredRebalCatSlice(null)}>
                            {rebalCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {(() => {
                    if (activePortfolioAccountType !== 'dc-irp') return null;
                    const depositEval = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
                    const projD = rebalanceData.filter(d => getAssetClass(d) === 'D').reduce((s, d) => s + d.expEval, 0);
                    const projS = rebalanceData.filter(d => getAssetClass(d) === 'S').reduce((s, d) => s + d.expEval, 0) + depositEval;
                    const projTotal = projD + projS;
                    if (projTotal <= 0) return null;
                    const projDSData = [{ name: '위험', value: projD }, { name: '안전', value: projS }];
                    const DS_COLORS = ['#ef4444', '#10b981'];
                    return (
                      <div className="flex flex-col items-center">
                        <div className="text-gray-500 text-[10px] font-semibold mb-0">리밸런싱 후 위험/안전</div>
                        <div style={{ height: 120, width: 120 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Tooltip content={makeCompactPieTooltip(projDSData)} />
                              <Pie data={projDSData} innerRadius="35%" outerRadius="72%" dataKey="value" label={renderCompactPieLabel} labelLine={false} onMouseEnter={(data) => setHoveredProjDSSlice(data)} onMouseLeave={() => setHoveredProjDSSlice(null)}>
                                {projDSData.map((_, i) => <Cell key={i} fill={DS_COLORS[i]} />)}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
            <div className="w-full xl:w-[560px] shrink-0">
              {(() => {
                const fmtUSD = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));
                const fmtAmount = (n) => isOverseasHeader ? fmtUSD(n) : formatCurrency(n);
                const fmtPlain = (n) => isOverseasHeader
                  ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cleanNum(n))
                  : formatNumber(Math.round(cleanNum(n)));
                const isRebalance = settings.mode === 'rebalance';
                const leftLabel = isRebalance ? '총평가금액' : '예수금';
                const leftVal = isRebalance ? headerNativeTotalEval : headerDepositAmount;
                const useDepositLabel = '사용할 예수금';
                const isUseDepositExplicit = settings.useDepositAmount != null;
                const investable = isRebalance ? (leftVal + headerAmount) : (headerUseDeposit + headerAmount);
                const totalCost = headerBaseCost + headerExtraCost;
                const displayCost = -totalCost;
                const modeOptions = [
                  { value: 'accumulate', label: '적립식', color: '#facc15' },
                  { value: 'rebalance', label: '리밸런싱', color: '#22c55e' },
                ];
                const currentOpt = modeOptions.find(o => o.value === settings.mode) || modeOptions[0];
                const investableSourceLabel = isRebalance ? leftLabel : useDepositLabel;
                const investableSourceVal = isRebalance ? leftVal : headerUseDeposit;
                const inputBlockWidth = 'w-[184px]';
                return (
                  <div className="bg-gray-800/80 px-4 py-3 rounded-lg border border-gray-700 shadow-inner flex flex-col gap-1.5 text-[12px] min-w-0">
                    <div className="flex items-center justify-between gap-3 pb-1.5 border-b border-gray-700/60">
                      <span className="text-gray-300 font-bold shrink-0">투자선택</span>
                      <div className="relative inline-flex items-center gap-1.5 px-2 py-0.5 bg-gray-900/60 border border-gray-600 rounded hover:border-gray-400 transition-colors cursor-pointer">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: currentOpt.color }} />
                        <span className="text-gray-200 text-[12px] font-bold">{currentOpt.label}</span>
                        <span className="text-gray-500 text-[9px] leading-none">▼</span>
                        <select
                          className="absolute inset-0 w-full h-full bg-transparent text-transparent cursor-pointer outline-none appearance-none"
                          value={settings.mode}
                          onChange={e => updateSettingsForType({ ...settings, mode: e.target.value })}
                          title="투자 선택"
                        >
                          {modeOptions.map(o => (
                            <option key={o.value} value={o.value} className="bg-gray-800 text-gray-200">{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {isRebalance ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-400 shrink-0">{leftLabel}</span>
                        <span className="text-gray-200 font-bold text-right truncate">{fmtAmount(leftVal)}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-gray-400">{leftLabel}</span>
                          <span className="text-gray-200 font-bold">{fmtAmount(leftVal)}</span>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-gray-400 shrink-0">{useDepositLabel}</span>
                          <div className={`flex items-center gap-1 ${inputBlockWidth}`}>
                            {isOverseasHeader && <span className="text-sky-400 font-bold shrink-0">$</span>}
                            <input
                              type="text"
                              className={`bg-gray-900/60 border rounded px-2 py-0.5 text-right font-bold outline-none flex-1 min-w-0 text-[12px] ${isUseDepositExplicit ? 'text-cyan-300 border-gray-700 focus:border-cyan-500' : 'text-gray-500 border-gray-700 focus:border-cyan-500'}`}
                              value={isUseDepositExplicit
                                ? (isOverseasHeader ? settings.useDepositAmount : formatNumber(settings.useDepositAmount))
                                : ''}
                              placeholder={isOverseasHeader ? `전액 ${fmtUSD(headerDepositAmount)}` : `전액 ${formatNumber(headerDepositAmount)}`}
                              onChange={e => {
                                const raw = e.target.value;
                                if (raw === '') {
                                  updateSettingsForType({ ...settings, useDepositAmount: null });
                                } else {
                                  const v = Math.min(Math.max(0, cleanNum(raw)), headerDepositAmount);
                                  updateSettingsForType({ ...settings, useDepositAmount: v });
                                }
                              }}
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                              disabled={headerDepositAmount <= 0}
                            />
                            <button
                              type="button"
                              onClick={() => updateSettingsForType({ ...settings, useDepositAmount: headerDepositAmount })}
                              disabled={headerDepositAmount <= 0}
                              className="px-2 py-0.5 text-[10px] font-bold rounded bg-cyan-900/40 hover:bg-cyan-700/60 text-cyan-300 hover:text-cyan-100 border border-cyan-700/40 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="예수금 전액을 사용할 예수금에 채우기"
                            >
                              전액
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-400 shrink-0">적립금</span>
                      <div className={`flex items-center gap-1 ${inputBlockWidth}`}>
                        {isOverseasHeader && <span className="text-sky-400 font-bold shrink-0">$</span>}
                        <input
                          type="text"
                          className="bg-gray-900/60 border border-gray-700 rounded px-2 py-0.5 text-right text-orange-300 font-bold outline-none focus:border-orange-500 flex-1 min-w-0 text-[12px]"
                          value={isOverseasHeader ? (headerAmount > 0 ? headerAmount : '') : formatNumber(settings.amount)}
                          placeholder="0"
                          onChange={e => updateSettingsForType({ ...settings, amount: cleanNum(e.target.value) })}
                          onFocus={e => e.target.select()}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                        />
                      </div>
                    </div>
                    {isOverseasHeader && headerAmount > 0 && (
                      <div className="text-right text-[10px] text-gray-500 -mt-1">≈ {formatCurrency(headerAmount * headerFx)}</div>
                    )}
                    <div className="flex flex-col border-t border-gray-700/60 pt-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-300 font-bold shrink-0">투자가능금</span>
                        <span className="text-green-400 font-bold text-right truncate text-[13px]">
                          {headerAmount > 0
                            ? <>{fmtPlain(investableSourceVal)} + {fmtPlain(headerAmount)} = {fmtAmount(investable)}</>
                            : fmtAmount(investable)}
                        </span>
                      </div>
                      <div className="text-right text-[10px] text-gray-500 leading-tight">
                        ({headerAmount > 0
                          ? `${investableSourceLabel} + 적립금 = 투자가능금`
                          : `${investableSourceLabel} = 투자가능금`})
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-400 shrink-0">실구매비용</span>
                        <span className={`font-bold text-right truncate ${displayCost > 0 ? 'text-sky-300' : displayCost < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {fmtAmount(displayCost)}
                        </span>
                      </div>
                      <div className="text-right text-[10px] text-gray-500 leading-tight">
                        (매도총합 − 매수총합)
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-400 shrink-0">잔액</span>
                        <span className={`font-bold text-right truncate ${rebalBalance > 0 ? 'text-sky-300' : rebalBalance < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {fmtAmount(rebalBalance)}
                        </span>
                      </div>
                      <div className="text-right text-[10px] text-gray-500 leading-tight">
                        ({isRebalance ? '예수금' : '사용예수금'} + 적립금 + 매도 − 매수 = 잔액)
                      </div>
                    </div>
                    {rebalRemaining > 0 && (
                      <button
                        type="button"
                        onClick={applyRemainingToDeposit}
                        className="flex items-center justify-between gap-3 text-[11px] text-gray-400 hover:text-green-300 transition-colors group"
                        title="잔액을 현재 예수금에 적용"
                      >
                        <span className="shrink-0">리밸런싱 잔액</span>
                        <span className="text-right truncate"><span className="text-gray-300">{formatRemaining(rebalRemaining)}</span> <span className="text-green-400 group-hover:text-green-200">→ 예수금에 적용</span></span>
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
          {(hiddenColumns.length > 0 || onManualSave) && (
            <div className="flex items-end justify-between gap-2 px-3 pt-2 pb-0 bg-[#080e1c]">
              <div className="flex items-end gap-1 flex-wrap min-w-0">
                {RB_COLS.filter(c => hiddenColumns.includes(c.key)).map(col => (
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
              {onManualSave && (() => {
                const saveBtnColor = driveStatus === 'saving'
                  ? 'text-sky-400'
                  : driveStatus === 'saved'
                    ? 'text-green-300'
                    : driveStatus === 'error' || driveStatus === 'auth_needed'
                      ? 'text-red-400'
                      : 'text-green-400 hover:text-green-300';
                const saveTitle = driveStatus === 'saving'
                  ? 'Drive에 저장 중...'
                  : driveStatus === 'saved'
                    ? '저장 완료 — 클릭 시 다시 저장'
                    : driveStatus === 'error'
                      ? '저장 실패 — 클릭하여 재시도'
                      : driveStatus === 'auth_needed'
                        ? 'Drive 인증 필요'
                        : 'Drive에 저장 + 백업 생성';
                return (
                  <button
                    type="button"
                    onClick={onManualSave}
                    disabled={driveStatus === 'saving'}
                    className={`shrink-0 inline-flex items-center justify-center p-1 mb-1 bg-transparent border-0 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100 ${saveBtnColor}`}
                    title={saveTitle}
                  >
                    <Save size={20} className={driveStatus === 'saving' ? 'animate-pulse' : ''} />
                  </button>
                );
              })()}
            </div>
          )}
          <div className="overflow-x-auto bg-[#0f172a]">
            <table className="w-full text-right text-[13px]">
              <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600 font-bold text-center">
                {(() => {
                  const sk = rebalanceSortConfig.key, sd = rebalanceSortConfig.direction;
                  const arr = (k) => <span className={`ml-0.5 text-[9px] ${sk === k ? 'text-gray-300' : 'invisible'}`}>{sk === k && sd === -1 ? '▼' : '▲'}</span>;
                  return (
                    <tr>
                      {!H('category') && (
                        <th className="py-3 px-3 min-w-[80px] text-center cursor-pointer hover:bg-gray-700 border-r border-gray-600 sticky top-0 left-0 z-30 bg-[#1e293b] relative" onClick={() => handleRebalanceSort(null)} title="클릭하여 정렬 초기화">
                          {hideStrip('category')}
                          구분
                        </th>
                      )}
                      {!H('changeRate') && (
                        <th className="py-3 px-2 min-w-[65px] text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-30 bg-[#1e293b] relative" style={{ left: changeRateLeft }} onClick={() => handleRebalanceSort('changeRate')}>
                          {hideStrip('changeRate')}
                          등락률{arr('changeRate')}
                        </th>
                      )}
                      {!H('name') && (
                        <th className="py-3 px-3 min-w-[110px] text-center text-gray-300 cursor-pointer hover:bg-gray-700 sticky top-0 z-30 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] relative" style={{ left: nameLeft }} onClick={() => handleRebalanceSort('name')}>
                          {hideStrip('name')}
                          종목명{arr('name')}
                        </th>
                      )}
                      {!H('code') && (
                        <th className={`py-3 px-3 min-w-[90px] text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative ${sk === 'code-global' ? 'text-gray-200' : 'text-gray-500'}`} title="왼쪽: 구분별 재배치  |  오른쪽: 코드순 전체 정렬" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); e.clientX < r.left + r.width / 2 ? handleRebalanceSort(null) : handleRebalanceSort('code-global'); }}>
                          {hideStrip('code')}
                          코드
                        </th>
                      )}
                      {!H('curEval') && (
                        <th className="py-3 px-3 min-w-[120px] text-gray-400 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative" onClick={() => handleRebalanceSort('curEval')}>
                          {hideStrip('curEval')}
                          평가금{arr('curEval')}
                        </th>
                      )}
                      {!H('currentPrice') && (
                        <th className="py-3 px-3 min-w-[100px] text-gray-500 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative" onClick={() => handleRebalanceSort('currentPrice')}>
                          {hideStrip('currentPrice')}
                          현재가{arr('currentPrice')}
                        </th>
                      )}
                      {!H('targetRatio') && (() => {
                        const targetMode = settings.targetMode === 'variable' ? 'variable' : 'fixed';
                        const isTargetSorted = sk === 'targetRatio';
                        return (
                        <th className="py-2 px-3 min-w-[120px] text-green-400 font-bold text-center sticky top-0 z-20 bg-[#1e293b] relative">
                          {hideStrip('targetRatio')}
                          <div className="flex flex-col items-center gap-1">
                            <div className="relative w-full">
                              <input
                                ref={datePickerRef}
                                type="date"
                                className="absolute opacity-0 w-0 h-0 pointer-events-none"
                                value={settings.targetDate || ''}
                                onChange={e => { updateSettingsForType({ ...settings, targetDate: e.target.value }); reportAdminChange(); }}
                                tabIndex={-1}
                              />
                              {dateEditMode ? (
                                <input
                                  type="text"
                                  autoFocus
                                  className="bg-gray-800 text-gray-400 text-[9px] outline-none border border-green-500 rounded px-1 py-0.5 w-full text-center"
                                  defaultValue={formatDisplayDate(settings.targetDate)}
                                  onBlur={e => { const parsed = parseDisplayDate(e.target.value); if (parsed) { updateSettingsForType({ ...settings, targetDate: parsed }); reportAdminChange(); } setDateEditMode(false); }}
                                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); e.stopPropagation(); }}
                                  onClick={e => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className="block text-gray-400 text-[9px] border border-gray-600 rounded px-1 py-0.5 w-full text-center cursor-pointer hover:border-gray-500 bg-gray-800 select-none"
                                  onClick={e => { e.stopPropagation(); datePickerRef.current?.showPicker?.(); }}
                                  onDoubleClick={e => { e.stopPropagation(); setDateEditMode(true); }}
                                  title="클릭: 달력 | 더블클릭: 직접 입력"
                                >{formatDisplayDate(settings.targetDate)}</span>
                              )}
                            </div>
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="flex flex-col items-center leading-none select-none">
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); handleRebalanceSort('targetRatio', 1); }}
                                  className={`text-[10px] leading-none transition-colors hover:text-green-300 ${isTargetSorted && sd === 1 ? 'text-green-400' : 'text-gray-500'}`}
                                  title="오름차순 정렬"
                                >▲</button>
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); handleRebalanceSort('targetRatio', -1); }}
                                  className={`text-[10px] leading-none transition-colors hover:text-green-300 ${isTargetSorted && sd === -1 ? 'text-green-400' : 'text-gray-500'}`}
                                  title="내림차순 정렬"
                                >▼</button>
                              </div>
                              <div className="relative inline-flex items-center gap-1">
                                {isFixedLocked && <Lock size={10} className="text-amber-400" />}
                                <span className={`cursor-pointer font-bold ${targetMode === 'variable' ? 'text-amber-300' : 'text-green-400'} hover:opacity-80`} title="클릭: 고정/수시변경 선택">
                                  목표
                                </span>
                                <select
                                  className="absolute inset-0 w-full h-full bg-transparent text-transparent cursor-pointer outline-none appearance-none"
                                  value={targetMode}
                                  onChange={e => { updateSettingsForType({ ...settings, targetMode: e.target.value }); reportAdminChange(); }}
                                  title="고정 / 수시변경"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <option value="fixed" className="bg-gray-800 text-gray-200">고정</option>
                                  <option value="variable" className="bg-gray-800 text-gray-200">수시변경</option>
                                </select>
                              </div>
                              {(() => {
                                const mirrorField = targetMode === 'variable' ? 'targetMirrorVar' : 'targetMirrorFixed';
                                const slotField = targetMode === 'variable' ? 'targetRatioVar' : 'targetRatio';
                                const overrideField = targetMode === 'variable' ? 'targetRatioVarOverride' : 'targetRatioOverride';
                                const mirrorState = settings[mirrorField] || 'off';
                                const cycleMirror = () => {
                                  const rebalFx = activePortfolioAccountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
                                  if (mirrorState === 'off') {
                                    setPortfolio(prev => prev.map(p => {
                                      if (p.type !== 'stock' && p.type !== 'fund') return p;
                                      const qty = cleanNum(p.quantity);
                                      const price = cleanNum(p.currentPrice);
                                      const curEval = p.type === 'fund' && !(qty > 0 && price > 0) ? cleanNum(p.evalAmount) : price * qty;
                                      const curRatio = totals.totalEval > 0 ? (curEval * rebalFx / totals.totalEval * 100) : 0;
                                      return { ...p, [slotField]: curRatio, [overrideField]: false };
                                    }));
                                    updateSettingsForType({ ...settings, [mirrorField]: 'seeded' });
                                  } else if (mirrorState === 'seeded') {
                                    setPortfolio(prev => prev.map(p => {
                                      if (p.type !== 'stock' && p.type !== 'fund') return p;
                                      return { ...p, [overrideField]: false };
                                    }));
                                    updateSettingsForType({ ...settings, [mirrorField]: 'on' });
                                  } else {
                                    setPortfolio(prev => prev.map(p => {
                                      if (p.type !== 'stock' && p.type !== 'fund') return p;
                                      if (p[overrideField]) return { ...p, [overrideField]: false };
                                      const qty = cleanNum(p.quantity);
                                      const price = cleanNum(p.currentPrice);
                                      const curEval = p.type === 'fund' && !(qty > 0 && price > 0) ? cleanNum(p.evalAmount) : price * qty;
                                      const curRatio = totals.totalEval > 0 ? (curEval * rebalFx / totals.totalEval * 100) : 0;
                                      return { ...p, [slotField]: curRatio, [overrideField]: false };
                                    }));
                                    updateSettingsForType({ ...settings, [mirrorField]: 'off' });
                                  }
                                  reportAdminChange();
                                };
                                const btnColor = isFixedLocked
                                  ? 'text-gray-600 hover:text-amber-400'
                                  : mirrorState === 'on'
                                    ? 'text-green-400 hover:text-green-300 drop-shadow-[0_0_4px_rgba(34,197,94,0.6)]'
                                    : mirrorState === 'seeded'
                                      ? 'text-emerald-300/70 hover:text-green-400'
                                      : 'text-gray-500 hover:text-green-400';
                                const btnTitle = isFixedLocked
                                  ? '잠금 — 클릭하여 비밀번호 입력'
                                  : mirrorState === 'on'
                                    ? '라이브 미러 ON — 클릭하여 해제 (현재 비중 박제)'
                                    : mirrorState === 'seeded'
                                      ? '시드 완료 — 클릭하여 라이브 미러 시작'
                                      : `클릭 1: 현재 비중을 ${targetMode === 'variable' ? '수시변경' : '고정'} 목표값에 복사 | 다음 클릭: 라이브 미러`;
                                return (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      if (totals.totalEval <= 0) return;
                                      if (targetMode !== 'variable' && !targetEditAuthorized && !isAdmin) {
                                        setPinModal({ onAuthorized: cycleMirror });
                                      } else {
                                        cycleMirror();
                                      }
                                    }}
                                    className={`text-[11px] font-bold leading-none transition-colors select-none ${btnColor}`}
                                    title={btnTitle}
                                  >{isFixedLocked ? '🔒(%)' : '(%)'}</button>
                                );
                              })()}
                            </div>
                          </div>
                        </th>
                        );
                      })()}
                      {!H('curRatio') && (
                        <th className="py-3 px-3 min-w-[80px] text-gray-400 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative" onClick={() => handleRebalanceSort('curEval')}>
                          {hideStrip('curRatio')}
                          현재비중{arr('curEval')}
                        </th>
                      )}
                      {!H('action') && (
                        <th className="py-3 px-3 min-w-[75px] text-blue-300 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative" onClick={() => handleRebalanceSort('action')}>
                          {hideStrip('action')}
                          수량{arr('action')}
                        </th>
                      )}
                      {!H('extraQty') && (
                        <th className="py-3 px-3 min-w-[65px] text-orange-300 text-center sticky top-0 z-20 bg-[#1e293b] relative">
                          {hideStrip('extraQty')}
                          추가
                        </th>
                      )}
                      {!H('maxAdd') && (
                        <th className="py-3 px-3 min-w-[85px] text-cyan-400 text-center sticky top-0 z-20 bg-[#1e293b] relative">
                          {hideStrip('maxAdd')}
                          추가 가능
                        </th>
                      )}
                      {!H('cost') && (
                        <th className="py-3 px-3 min-w-[120px] text-blue-300 text-center font-normal cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative" onClick={() => handleRebalanceSort('cost')}>
                          {hideStrip('cost')}
                          실 구매비용{arr('cost')}
                        </th>
                      )}
                      {!H('expEval') && (
                        <th className="py-3 px-3 min-w-[120px] text-yellow-500 text-center font-bold cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative" onClick={() => handleRebalanceSort('expEval')}>
                          {hideStrip('expEval')}
                          예상평가금{arr('expEval')}
                        </th>
                      )}
                      {!H('expRatio') && (
                        <th className="py-3 px-3 min-w-[85px] text-yellow-500 font-bold text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative" onClick={() => handleRebalanceSort('expRatio')}>
                          {hideStrip('expRatio')}
                          예상비중{arr('expRatio')}
                        </th>
                      )}
                    </tr>
                  );
                })()}
              </thead>
              <tbody>
                {(() => {
                  const baseTotalCost = rebalanceData.reduce((s, d) => s + d.cost, 0);
                  const totalExtraAllocated = rebalanceData.reduce((s, d) => s + (rebalExtraQty[d.id] || 0) * cleanNum(d.currentPrice), 0);
                  const tableDepositAmount = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
                  const tableUseDeposit = settings.useDepositAmount != null
                    ? Math.min(Math.max(0, cleanNum(settings.useDepositAmount)), tableDepositAmount)
                    : tableDepositAmount;
                  const tableCashInvestable = settings.mode === 'rebalance'
                    ? cleanNum(settings.amount)
                    : (tableUseDeposit + cleanNum(settings.amount));
                  const effectiveRemaining = tableCashInvestable - baseTotalCost - totalExtraAllocated;
                  const isOverseas = activePortfolioAccountType === 'overseas';
                  const usdkrw = marketIndicators.usdkrw || 1;
                  const fmtUSD = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));
                  const catOrder = [];
                  const grouped = {};
                  rebalanceData.forEach(item => {
                    const cat = item.category || '기타';
                    if (!grouped[cat]) { grouped[cat] = []; catOrder.push(cat); }
                    grouped[cat].push(item);
                  });
                  const parseHex = (hex) => {
                    const m = hex.replace('#', '').match(/.{2}/g);
                    if (!m) return null;
                    const [r, g, b] = m.map(x => parseInt(x, 16) / 255);
                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                    const l = (max + min) / 2;
                    if (max === min) return [0, 0, l * 100];
                    const d = max - min;
                    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                    let h;
                    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                    else if (max === g) h = ((b - r) / d + 2) / 6;
                    else h = ((r - g) / d + 4) / 6;
                    return [h * 360, s * 100, l * 100];
                  };
                  const genShades = (baseHex, count) => {
                    const hsl = parseHex(baseHex);
                    if (!hsl || count === 1) return Array(count).fill(baseHex);
                    const [h, s, l] = hsl;
                    return Array.from({ length: count }, (_, i) => {
                      const t = i / (count - 1);
                      const shade = Math.min(78, Math.max(28, l + 18 - t * 36));
                      return `hsl(${h.toFixed(0)},${Math.min(100, s + 5).toFixed(0)}%,${shade.toFixed(0)}%)`;
                    });
                  };
                  const itemColorMap = {};
                  catOrder.forEach(cat => {
                    const baseHex = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const shades = genShades(baseHex, grouped[cat].length);
                    grouped[cat].forEach((item, j) => { itemColorMap[`${cat}::${item.id}`] = shades[j]; });
                  });
                  let rowNum = 0;
                  const renderRow = (item, catTd) => {
                    rowNum += 1;
                    const num = rowNum;
                    const cat = item.category || '기타';
                    const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const itemColor = itemColorMap[`${cat}::${item.id}`] || catColor;
                    const extraQty = rebalExtraQty[item.id] || 0;
                    const totalAction = item.action + extraQty;
                    const itemPrice = cleanNum(item.currentPrice);
                    const adjustedCost = totalAction * itemPrice;
                    const displayAdjustedCost = -adjustedCost;
                    const maxAdd = itemPrice > 0 ? effectiveRemaining / itemPrice : 0;
                    const markColor = markedRebalRows[item.id];
                    const rowMarkClass = markColor ? MARK_ROW_BG[markColor] : 'hover:bg-gray-800';
                    const stickyCellClass = markColor ? MARK_STICKY_BG[markColor] : 'bg-[#0f172a] group-hover:bg-gray-800';
                    return (
                      <tr key={item.id} className={`group border-b border-gray-700 ${rowMarkClass} transition-colors`}>
                        {catTd}
                        {!H('changeRate') && (
                          <td className={`py-3 px-2 text-center ${stickyCellClass} transition-colors focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none`} style={{ position: 'sticky', left: changeRateLeft, zIndex: 5 }} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                            <span className={`text-xs font-bold ${(item.changeRate || 0) > 0 ? 'text-red-400' : (item.changeRate || 0) < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{item.changeRate != null ? formatChangeRate(item.changeRate) : '-'}</span>
                          </td>
                        )}
                        {!H('name') && (
                          <td className={`py-3 px-4 text-center font-bold ${stickyCellClass} transition-colors [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none`} style={{ position: 'sticky', left: nameLeft, zIndex: 5, color: itemColor }} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                            {(() => { const url = getItemUrl(item); return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 hover:underline" style={{ color: itemColor }}>{num}. {item.name}</a> : <div className="line-clamp-2">{num}. {item.name}</div>; })()}
                          </td>
                        )}
                        {!H('code') && (
                          <td className="py-3 px-3 text-center text-gray-500 font-mono text-xs focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{item.code}</td>
                        )}
                        {!H('curEval') && (
                          <td className="py-3 px-3 text-gray-400 text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.curEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.curEval * usdkrw)}</span></div> : formatCurrency(item.curEval)}</td>
                        )}
                        {!H('currentPrice') && (
                          <td className="py-3 px-3 text-gray-500 font-mono text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.currentPrice)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.currentPrice * usdkrw)}</span></div> : formatNumber(item.currentPrice)}</td>
                        )}
                        {!H('targetRatio') && (() => {
                          const itemCurRatio = totals.totalEval > 0 ? (isOverseas ? item.curEval * usdkrw : item.curEval) / totals.totalEval * 100 : 0;
                          const threshold = isOverseas ? 0.005 : 0.05;
                          const isDifferent = Math.abs((item.effectiveTargetRatio || 0) - itemCurRatio) > threshold;
                          const targetMode = settings.targetMode === 'variable' ? 'variable' : 'fixed';
                          const slotField = targetMode === 'variable' ? 'targetRatioVar' : 'targetRatio';
                          const overrideField = targetMode === 'variable' ? 'targetRatioVarOverride' : 'targetRatioOverride';
                          const mirrorField = targetMode === 'variable' ? 'targetMirrorVar' : 'targetMirrorFixed';
                          const mirrorState = settings[mirrorField] || 'off';
                          const isLiveMirror = mirrorState === 'on' && !item[overrideField];
                          const slotVal = cleanNum(item[slotField]) || 0;
                          const baseVal = isLiveMirror ? itemCurRatio : slotVal;
                          const displayVal = editingRatio[item.id] !== undefined
                            ? editingRatio[item.id]
                            : baseVal.toFixed(2);
                          const textColor = isLiveMirror
                            ? 'text-emerald-300/80 italic'
                            : targetMode === 'variable'
                              ? (isDifferent ? 'text-red-400' : 'text-amber-300')
                              : (isDifferent ? 'text-red-400' : 'text-green-400');
                          const cellLocked = targetMode !== 'variable' && !targetEditAuthorized && !isAdmin;
                          return (
                            <td className={`p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 ${cellLocked ? 'cursor-pointer' : ''}`}
                              onClick={cellLocked ? (e => {
                                e.preventDefault();
                                const tr = e.currentTarget.closest('tr');
                                const focusBack = () => {
                                  const ip = tr?.querySelector(`input[data-col="targetRatio"][data-item-id="${item.id}"]`);
                                  if (ip) { ip.focus(); ip.select?.(); }
                                };
                                setPinModal({ onAuthorized: () => setTimeout(focusBack, 80) });
                              }) : undefined}
                            >
                              <input type="text" data-col="targetRatio" data-item-id={item.id} className={`w-full h-full bg-transparent text-center font-bold outline-none py-3 caret-blue-400 ${textColor} ${cellLocked ? 'cursor-pointer focus:bg-amber-900/10' : 'focus:bg-blue-900/20'}`}
                                value={displayVal}
                                readOnly={cellLocked}
                                onChange={e => { if (!cellLocked) setEditingRatio(prev => ({ ...prev, [item.id]: e.target.value })); }}
                                onBlur={e => {
                                  if (cellLocked) return;
                                  handleUpdate(item.id, slotField, e.target.value);
                                  if (mirrorState === 'on') {
                                    setPortfolio(prev => prev.map(p => p.id === item.id ? { ...p, [overrideField]: true } : p));
                                  }
                                  setEditingRatio(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                  reportAdminChange();
                                }}
                                onFocus={e => {
                                  if (cellLocked) {
                                    e.target.blur();
                                    return;
                                  }
                                  setEditingRatio(prev => ({ ...prev, [item.id]: e.target.value }));
                                  e.target.select();
                                }}
                                onKeyDown={e => {
                                  if (cellLocked) { e.preventDefault(); return; }
                                  if (e.key === 'Enter') e.target.blur();
                                  handleTableKeyDown(e, 'targetRatio');
                                }}
                                title={cellLocked ? '잠금 — 클릭하여 비밀번호 입력' : isLiveMirror ? '라이브 미러 추종 중 — 편집 시 이 종목만 수동 고정' : undefined}
                              />
                            </td>
                          );
                        })()}
                        {!H('curRatio') && (
                          <td className="py-3 px-3 text-center text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{(totals.totalEval > 0 ? (isOverseas ? item.curEval * usdkrw : item.curEval) / totals.totalEval * 100 : 0).toFixed(isOverseas ? 2 : 1)}%</td>
                        )}
                        {!H('action') && (
                          <td className={`py-3 px-3 text-center font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${totalAction > 0 ? 'text-green-400' : totalAction < 0 ? 'text-red-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{(totalAction > 0 ? '+' : '') + totalAction}</td>
                        )}
                        {!H('extraQty') && (
                          <td className="p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-orange-500">
                            <input type="text" className="w-full h-full bg-transparent text-center text-orange-300 font-bold outline-none py-3 focus:bg-orange-900/20 caret-orange-400 min-w-[65px]" value={extraQty !== 0 ? extraQty : ''} placeholder="0" onChange={e => { const val = parseInt(e.target.value.replace(/[^\-\d]/g, '')) || 0; setRebalExtraQty(prev => ({ ...prev, [item.id]: val })); }} onFocus={e => e.target.select()} />
                          </td>
                        )}
                        {!H('maxAdd') && (
                          <td className={`py-3 px-3 text-center font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${maxAdd > 0 ? 'text-cyan-400' : maxAdd < 0 ? 'text-red-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{maxAdd === 0 ? '0' : (maxAdd > 0 ? '+' : '') + maxAdd.toFixed(1)}</td>
                        )}
                        {!H('cost') && (
                          <td className={`py-3 px-3 font-bold text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${displayAdjustedCost > 0 ? 'text-sky-300' : displayAdjustedCost < 0 ? 'text-red-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(displayAdjustedCost)}</span><span className="text-[11px] opacity-70">{formatCurrency(displayAdjustedCost * usdkrw)}</span></div> : formatCurrency(displayAdjustedCost)}</td>
                        )}
                        {!H('expEval') && (
                          <td className="py-3 px-3 font-bold text-yellow-500 text-right focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUSD(item.expEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.expEval * usdkrw)}</span></div> : formatCurrency(item.expEval)}</td>
                        )}
                        {!H('expRatio') && (
                          <td className="py-3 px-3 text-center text-yellow-600 font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{item.expRatio.toFixed(isOverseas ? 2 : 1)}%</td>
                        )}
                      </tr>
                    );
                  };
                  if (rebalanceSortConfig.key === 'code-global') {
                    return rebalanceData.map(item => {
                      const cat = item.category || '기타';
                      const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                      const mc = markedRebalRows[item.id];
                      const bgClass = mc ? MARK_STICKY_BG[mc] : 'bg-[#0f172a] group-hover:bg-gray-800';
                      const catTd = H('category') ? null : (
                        <td
                          className={`py-3 px-3 text-center font-bold border-r border-gray-700 align-middle ${bgClass} sticky left-0 z-[5] cursor-pointer transition-colors`}
                          onClick={() => onToggleMarkedRebalRow(item.id)}
                          title="클릭하여 매도/매수 표시 토글 (노랑→슬레이트→로즈→갈색→해제)"
                        >
                          <div style={{ color: catColor }} className="text-xs">{cat}</div>
                        </td>
                      );
                      return renderRow(item, catTd);
                    });
                  }
                  return catOrder.flatMap(cat => {
                    const items = grouped[cat];
                    const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const catTotalEval = items.reduce((sum, item) => sum + item.curEval, 0);
                    const catRatio = totals.totalEval > 0 ? catTotalEval / totals.totalEval * 100 : 0;
                    return items.map((item, j) => {
                      const catTd = H('category') ? null : (j === 0
                        ? <td rowSpan={items.length} className="py-3 px-3 text-center font-bold border-r border-gray-700 align-middle bg-[#0f172a] sticky left-0 z-[5]"><div style={{ color: catColor }}>{cat}</div><div className="text-gray-400 text-[10px] font-normal mt-0.5">{isOverseas ? <>{fmtUSD(catTotalEval)}<br/><span className="text-gray-600">{formatCurrency(catTotalEval * usdkrw)}</span></> : formatCurrency(catTotalEval)}</div><div className="text-gray-400 text-[10px] font-normal">{catRatio.toFixed(1)}%</div></td>
                        : null);
                      return renderRow(item, catTd);
                    });
                  });
                })()}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  {stickySpanCount > 0 && (
                    <td colSpan={stickySpanCount} className="py-3 px-3 text-center uppercase tracking-widest text-gray-500 text-xs sticky left-0 z-[5] bg-[#1e293b]">TOTAL</td>
                  )}
                  {!H('code') && <td className="py-3 px-3"></td>}
                  {!H('curEval') && (() => { const totCurEval = rebalanceData.reduce((s, d) => s + d.curEval, 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className="py-3 px-3 text-gray-300 font-bold text-right">{isOv ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUS(totCurEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(totCurEval * fxRate)}</span></div> : formatCurrency(totCurEval)}</td>; })()}
                  {!H('currentPrice') && <td className="py-3 px-3"></td>}
                  {!H('targetRatio') && (() => {
                    const targetSum = rebalanceData.reduce((s, d) => s + (d.effectiveTargetRatio || 0), 0);
                    const diff = 100 - targetSum;
                    const isMatch = Math.abs(diff) < 0.005;
                    return (
                      <td className="py-3 px-3 text-center font-bold text-green-400">
                        <div>{targetSum.toFixed(2)}%</div>
                        <div className={`text-[10px] font-normal mt-0.5 ${isMatch ? 'text-green-300' : 'text-amber-300'}`}>
                          {diff >= 0 ? '+' : ''}{diff.toFixed(2)}%
                        </div>
                      </td>
                    );
                  })()}
                  {!H('curRatio') && <td className="py-3 px-3 text-center font-bold text-gray-400">100%</td>}
                  {!H('action') && <td className="py-3 px-3"></td>}
                  {!H('extraQty') && <td className="py-3 px-3"></td>}
                  {!H('maxAdd') && <td className="py-3 px-3"></td>}
                  {!H('cost') && (() => {
                    const isOv = activePortfolioAccountType === 'overseas';
                    const fxRate = marketIndicators.usdkrw || 1;
                    const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));
                    const fmtAmt = (n) => isOv ? fmtUS(n) : formatCurrency(n);
                    const isRebalance = settings.mode === 'rebalance';
                    const depositLabel = isRebalance ? '예수금' : '사용예수금';
                    const balanceColor = rebalBalance > 0 ? 'text-sky-300' : rebalBalance < 0 ? 'text-red-400' : 'text-gray-500';
                    return (
                      <td className="py-3 px-3 text-right align-top">
                        <div className="flex justify-end mb-1.5">
                          <button
                            type="button"
                            onClick={() => setShowCostFormula(v => !v)}
                            className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors font-normal"
                            title={showCostFormula ? '계산식 숨기기' : '계산식 보기'}
                          >
                            계산식
                            {showCostFormula ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          </button>
                        </div>
                        {showCostFormula ? (
                          <div className="flex flex-col items-end gap-1 font-normal">
                            <div className="text-[10px] text-gray-400 font-bold w-full text-right">총 구매 가능 금액</div>
                            <div className="flex items-center justify-end gap-2 w-full">
                              <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">매도</span>
                              <span className="font-bold text-sky-300 text-[12px]">{fmtAmt(headerTotalSell)}</span>
                            </div>
                            <div className="flex items-center justify-end gap-2 w-full">
                              <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">+ {depositLabel}</span>
                              <span className="font-bold text-gray-300 text-[12px]">{fmtAmt(headerDepositForBuy)}</span>
                            </div>
                            <div className="flex items-center justify-end gap-2 w-full">
                              <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">+ 적립금</span>
                              <span className="font-bold text-orange-300 text-[12px]">{fmtAmt(headerAmount)}</span>
                            </div>
                            <div className="flex items-center justify-end gap-2 w-full border-t border-gray-700/40 pt-1">
                              <span className="text-[10px] text-gray-400 leading-tight whitespace-nowrap font-bold">= 총 구매 가능 금액</span>
                              <span className="font-bold text-green-300 text-[12px]">{fmtAmt(rebalTotalAvailable)}</span>
                            </div>
                            <div className="flex items-center justify-end gap-2 w-full mt-1">
                              <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">− 매수금액</span>
                              <span className="font-bold text-red-300 text-[12px]">{fmtAmt(headerTotalBuy)}</span>
                            </div>
                            <div className="flex items-center justify-end gap-2 w-full border-t border-gray-700/60 pt-1.5 mt-0.5">
                              <span className="text-[10px] text-gray-400 leading-tight whitespace-nowrap font-bold">= 잔액</span>
                              <span className={`font-bold text-[13px] ${balanceColor}`}>{fmtAmt(rebalBalance)}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-baseline justify-end gap-1.5 flex-wrap font-bold">
                            <span className="text-green-300 text-[13px]">{fmtAmt(rebalTotalAvailable)}</span>
                            <span className="text-gray-500 text-[11px]">−</span>
                            <span className="text-red-300 text-[13px]">{fmtAmt(headerTotalBuy)}</span>
                            <span className="text-gray-500 text-[11px]">=</span>
                            <span className={`text-[14px] ${balanceColor}`}>{fmtAmt(rebalBalance)}</span>
                          </div>
                        )}
                      </td>
                    );
                  })()}
                  {!H('expEval') && (() => { const totExpEval = rebalanceData.reduce((s, d) => s + d.expEval, 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className="py-3 px-3 font-bold text-yellow-400 text-right">{isOv ? <div className="flex flex-col items-end gap-0.5"><span>{fmtUS(totExpEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(totExpEval * fxRate)}</span></div> : formatCurrency(totExpEval)}</td>; })()}
                  {!H('expRatio') && <td className="py-3 px-3 text-center font-bold text-yellow-500">100%</td>}
                </tr>
                {showRetirementStats && (() => {
                  const depositEval = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
                  const projD = rebalanceData.filter(d => getAssetClass(d) === 'D').reduce((s, d) => s + d.expEval, 0);
                  const projS = rebalanceData.filter(d => getAssetClass(d) === 'S').reduce((s, d) => s + d.expEval, 0) + depositEval;
                  const projTotal = projD + projS;
                  const projDRatio = projTotal > 0 ? projD / projTotal * 100 : 0;
                  const projSRatio = projTotal > 0 ? projS / projTotal * 100 : 0;
                  const onTarget = Math.abs(projDRatio - 70) <= 5;
                  return (
                    <tr className="border-t border-amber-600/30 bg-amber-950/20">
                      <td colSpan={retirementColSpan} className="py-2.5 px-4">
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className="text-amber-400 font-bold text-xs tracking-wide">퇴직연금 예상 자산 비율</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-red-400 font-bold text-xs">위험 D</span>
                            <span className={`font-bold text-sm ${onTarget ? 'text-red-400' : 'text-red-300'}`}>{projDRatio.toFixed(1)}%</span>
                            <span className="text-gray-600 text-[11px]">(목표 70%)</span>
                            {!onTarget && (
                              <span className="text-orange-400 text-[11px]">
                                {projDRatio > 70 ? `+${(projDRatio - 70).toFixed(1)}%` : `${(projDRatio - 70).toFixed(1)}%`}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-emerald-400 font-bold text-xs">안전 S</span>
                            <span className={`font-bold text-sm ${Math.abs(projSRatio - 30) <= 5 ? 'text-emerald-400' : 'text-emerald-300'}`}>{projSRatio.toFixed(1)}%</span>
                            <span className="text-gray-600 text-[11px]">(목표 30%)</span>
                          </div>
                          <div className="flex-1 flex items-center gap-1 min-w-[120px]">
                            <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${Math.min(projDRatio, 100)}%`,
                                  background: onTarget
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
                  );
                })()}
              </tfoot>
            </table>
          </div>
        </div>}

        {/* 리밸런싱 자산 비중 도넛 차트 */}
        {showDonut && <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden mb-6">
          <div className="p-3 bg-[#0f172a] border-b border-gray-700">
            <span className="text-white font-bold text-sm">🍩 자산 비중 비교</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-700">
            {/* 왼쪽: 리밸런싱 후 예상 자산 비중 */}
            <div className="p-4">
              <div className="text-gray-400 text-xs text-center mb-2 font-semibold">리밸런싱 후 예상 자산 비중</div>
              {rebalCatDonutData.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs">데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                    {hoveredRebalCatSlice ? (
                      <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredRebalCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredRebalCatSlice.fill }}>{hoveredRebalCatSlice.name} {(hoveredRebalCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{activePortfolioAccountType === 'overseas' ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(hoveredRebalCatSlice.value) : formatCurrency(hoveredRebalCatSlice.value)}</span>}</>
                    ) : (
                      <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                    )}
                  </div>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={rebalCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredRebalCatSlice(data)} onMouseLeave={() => setHoveredRebalCatSlice(null)}>
                          {rebalCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="w-full text-xs mt-3">
                    <thead className="text-gray-400 border-b border-gray-700">
                      <tr className="text-center">
                        <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                        <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">예상평가금</th>
                        <th className="pb-2 px-3">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = rebalCatDonutData.reduce((s, x) => s + x.value, 0);
                        return rebalCatDonutData.map(({ name, value }, i) => (
                          <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                            <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                              <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                            </td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value)}</span><span className="text-[11px] text-gray-500">{formatCurrency(value * (marketIndicators.usdkrw || 1))}</span></div> : formatCurrency(value)}</td>
                            <td className="py-1.5 px-3 text-gray-400 text-right">{total > 0 ? ((value / total) * 100).toFixed(1) : 0}%</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const total = rebalCatDonutData.reduce((s, x) => s + x.value, 0);
                        return (
                          <tr className="border-t-2 border-gray-600 bg-gray-800/40">
                            <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700 text-gray-300">합계</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-white font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(total)}</span><span className="text-[11px] text-gray-400">{formatCurrency(total * (marketIndicators.usdkrw || 1))}</span></div> : formatCurrency(total)}</td>
                            <td className="py-1.5 px-3 text-white font-bold text-right">100%</td>
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </table>
                </>
              )}
            </div>
            {/* 오른쪽: 현재 포트폴리오 자산 비중 */}
            <div className="p-4">
              <div className="text-gray-400 text-xs text-center mb-2 font-semibold">현재 자산 비중</div>
              {curCatDonutData.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs">데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                    {hoveredCurCatSlice ? (
                      <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredCurCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredCurCatSlice.fill }}>{hoveredCurCatSlice.name} {(hoveredCurCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{activePortfolioAccountType === 'overseas' ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(hoveredCurCatSlice.value / (marketIndicators.usdkrw || 1)) : formatCurrency(hoveredCurCatSlice.value)}</span>}</>
                    ) : (
                      <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                    )}
                  </div>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={curCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredCurCatSlice(data)} onMouseLeave={() => setHoveredCurCatSlice(null)}>
                          {curCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="w-full text-xs mt-3">
                    <thead className="text-gray-400 border-b border-gray-700">
                      <tr className="text-center">
                        <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                        <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">평가금액</th>
                        <th className="pb-2 px-3">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {curCatDonutData.map(({ name, value }, i) => (
                        <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                          <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                            <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                          </td>
                          <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value / (marketIndicators.usdkrw || 1))}</span><span className="text-[11px] text-gray-500">{formatCurrency(value)}</span></div> : formatCurrency(value)}</td>
                          <td className="py-1.5 px-3 text-gray-400 text-right">{totals.totalEval > 0 ? ((value / totals.totalEval) * 100).toFixed(1) : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const total = curCatDonutData.reduce((s, x) => s + x.value, 0);
                        return (
                          <tr className="border-t-2 border-gray-600 bg-gray-800/40">
                            <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700 text-gray-300">합계</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-white font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(total / (marketIndicators.usdkrw || 1))}</span><span className="text-[11px] text-gray-400">{formatCurrency(total)}</span></div> : formatCurrency(total)}</td>
                            <td className="py-1.5 px-3 text-white font-bold text-right">100%</td>
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>}
        <RebalanceTargetPinModal
          open={!!pinModal}
          authUser={authUser}
          onAuthorized={() => {
            setTargetEditAuthorized(true);
            const cb = pinModal?.onAuthorized;
            setPinModal(null);
            if (cb) cb();
          }}
          onClose={() => setPinModal(null)}
        />
        {helpOpen && (
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setHelpOpen(false)}>
            <div className="absolute w-[440px] shadow-2xl overflow-hidden" style={{ left: helpPos.x, top: helpPos.y }} onClick={e => e.stopPropagation()}>
              <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none" onMouseDown={handleHelpDragStart}>
                <button onClick={() => setHelpOpen(false)} className="w-3 h-3 rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all" title="닫기"><X size={7} className="text-white" /></button>
                <span className="text-[11px] font-bold tracking-[0.18em] bg-gradient-to-r from-green-400 via-emerald-400 to-sky-400 bg-clip-text text-transparent select-none">리밸런싱 계산식 안내</span>
                <div className="w-3" />
              </div>
              <div className="overflow-y-auto max-h-[78vh]" style={{
                backgroundColor: '#000',
                backgroundImage: 'repeating-linear-gradient(transparent 0px, transparent 23px, rgba(99,130,255,0.25) 23px, rgba(99,130,255,0.25) 24px)',
                backgroundSize: '100% 24px',
                backgroundPosition: '0 8px',
                lineHeight: '24px',
                padding: '8px 12px',
              }}>
                {[
                  { icon: '💰', color: 'text-amber-300', title: '투자가능금 (기준 금액)', lines: [
                    '투자가능금 = 종목/펀드 평가금 + 예수금 + 적립금',
                    '리밸런싱의 분모. 종목 비중 계산의 기준.',
                    '모든 자금(예수금·적립금·매도·매수)은 투자가능금 안에서 정의됨.',
                  ] },
                  { icon: '🎯', color: 'text-green-300', title: '각 종목의 목표 평가금', lines: [
                    '목표 평가금 = 투자가능금 × 목표비중(%)',
                    '액션(수량) = ⌊ (목표 평가금 − 현재 평가금) ÷ 종목가격 ⌋',
                    '액션 + 이면 매수, − 이면 매도.',
                  ] },
                  { icon: '💸', color: 'text-sky-300', title: '실 구매비용 (행별 / TOTAL)', lines: [
                    '행별 = −(액션 × 종목가격)',
                    '매도 행: + (자금 회수)',
                    '매수 행: − (자금 지출)',
                    'TOTAL = 매도총합 − 매수총합',
                  ] },
                  { icon: '⚖', color: 'text-cyan-300', title: '잔액 (리밸런싱 자금 차익)', lines: [
                    '총 구매 가능 금액 = 매도 금액 + (사용)예수금 + 적립금',
                    '잔액 = 총 구매 가능 금액 − 매수 금액',
                    '리밸런싱 모드: 예수금 전액 포함 (수량 계산이 totals.totalEval = 종목+예수금 기준)',
                    '적립식 모드: 사용예수금만 포함 (수량 계산이 사용예수금+적립금 기준)',
                    '트런케이션 오차 및 목표비중 합≠100%에서 비롯되는 차액이 잔액에 나타남.',
                  ] },
                  { icon: '➕', color: 'text-emerald-300', title: '추가 가능 수량 (행별)', lines: [
                    '추가 가능 = ⌊ 잔액 ÷ 종목가격 ⌋',
                    '+ 값: 그만큼 더 매수 가능 (매도 차익을 추가 매수에 활용)',
                    '− 값: 그만큼 매도 더 필요 (매수가 과다하다는 신호)',
                    '"추가" 컬럼에 음수 입력 가능 — 사용자가 직접 매도 수량 조절',
                  ] },
                  { icon: '🏦', color: 'text-amber-300', title: '예수금에 적용', lines: [
                    '잔액이 + 이면 "→ 예수금에 적용" 버튼이 나타남',
                    '클릭 시: 새 예수금 = 기존 예수금 + 잔액',
                    '자동 적용 안 함 — 사용자가 직접 적용해야 다음 리밸런싱 자금이 됨',
                  ] },
                  { icon: '📊', color: 'text-purple-300', title: '계산 예시', lines: [
                    '투자가능금 100,000 (종목 99,000 + 예수금 1,000 + 적립금 0)',
                    '목표 비중 합 98.9% → 매도 약간 더 발생 가정',
                    '매수 = 50,000, 매도 = 50,500',
                    '실구매비용 TOTAL = 50,500 − 50,000 = +500',
                    '잔액 = +500 → 표시 500',
                    '추가가능 (가격 100원 종목) = ⌊500 ÷ 100⌋ = 5개',
                  ] },
                ].map(({ icon, color, title, lines }) => (
                  <div key={title} className="mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`${color} font-bold text-[11px] w-4 text-center shrink-0`}>{icon}</span>
                      <span className="text-white font-bold text-[11px]">{title}</span>
                    </div>
                    {lines.map((line, i) => (
                      <div key={i} className="flex items-start gap-1.5 pl-1">
                        <span className="text-gray-600 text-[10px] shrink-0 mt-0.5">·</span>
                        <span className="text-[10px] leading-6 text-gray-400">{line}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
    </>
  );
}
