// @ts-nocheck
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { X, Plus, Trash2, Pencil } from 'lucide-react';
import {
  cleanNum,
  formatCurrency,
  formatShortDate,
  formatFundPrice,
  calcPortfolioEvalDetail,
  resolveHoldings,
  snapshotItemsFromPortfolio,
} from '../utils';
import { BG, BORDER, Z } from '../design';

// 종목의 수동종가 오버라이드 키 (gold는 code가 없으므로 'GOLD')
const overrideKeyFor = (item, isGold) =>
  item?.code || (isGold && item?.type !== 'deposit' ? 'GOLD' : '');

// 특정 날짜의 보유종목을 해결해 manual 스냅샷을 생성/갱신한 새 포트폴리오 객체 반환.
// baseline 이전 날짜를 편집하면 split(편집일=baseline 하향, 이전=추정) + preBaselineVerified 해제.
const withManualSnapshot = (p, date, mutate) => {
  const resolved = resolveHoldings(p, date);
  const base = snapshotItemsFromPortfolio(resolved.items);
  const nextItems = mutate(base);
  const snaps = Array.isArray(p.holdingSnapshots) ? p.holdingSnapshots.slice() : [];
  const idx = snaps.findIndex(s => s.date === date);
  if (idx >= 0) snaps[idx] = { ...snaps[idx], kind: 'manual', items: nextItems };
  else snaps.push({ date, kind: 'manual', items: nextItems });
  const next = { ...p, holdingSnapshots: snaps };
  const bDate = p.baselineDate || '';
  if (bDate && date < bDate) {
    next.baselineDate = date;
    next.preBaselineVerified = false;
  }
  return next;
};

const SOURCE_BADGE = {
  history: { label: '🟢 API', cls: 'text-green-400' },
  manual: { label: '🔴 수동입력', cls: 'text-red-400' },
  none: { label: '⚪ 데이터없음', cls: 'text-gray-500' },
  deposit: { label: '예수금', cls: 'text-sky-300' },
  currentPrice: { label: '⚪ 폴백', cls: 'text-gray-500' },
  evalAmount: { label: '⚪ 폴백', cls: 'text-gray-500' },
};

export default function VerifyEvalModal({
  record,
  portfolio,
  accountType,
  stockHistoryMap,
  indicatorHistoryMap,
  marketIndicators,
  effectiveDateKey,
  patchActivePortfolio,
  setHistory,
  notify,
  onClose,
  depositHistory,
  depositHistory2,
}) {
  const date = record.date;
  const isGold = accountType === 'gold';
  const fx = marketIndicators?.usdkrw || 1;
  const mpo = portfolio?.manualPriceOverrides || {};

  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const isMobile = vp.w < 640;
  const modalWidth = isMobile ? Math.max(280, vp.w - 16) : 560;

  const [pos, setPos] = useState(() => {
    const w = window.innerWidth, h = window.innerHeight;
    const mw = w < 640 ? Math.max(280, w - 16) : 560;
    return { x: Math.max(8, (w - mw) / 2), y: Math.max(12, h / 2 - 260) };
  });
  useEffect(() => {
    setPos(p => ({
      x: isMobile ? Math.max(8, (vp.w - modalWidth) / 2) : Math.max(0, Math.min(Math.max(0, vp.w - modalWidth), p.x)),
      y: Math.max(8, Math.min(Math.max(8, vp.h - 80), p.y)),
    }));
  }, [vp.w, vp.h, modalWidth, isMobile]);
  const dragRef = useRef({ active: false, ox: 0, oy: 0 });
  const [editQtyIdx, setEditQtyIdx] = useState(-1);
  const [editQtyRaw, setEditQtyRaw] = useState('');
  const [editPriceIdx, setEditPriceIdx] = useState(-1);
  const [editPriceRaw, setEditPriceRaw] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    code: '', name: '', type: 'stock', quantity: '', start: date, end: '',
  });

  const handleDragStart = (e) => {
    if (e.button !== 0 || isMobile) return;
    e.preventDefault();
    dragRef.current = { active: true, ox: e.clientX - pos.x, oy: e.clientY - pos.y };
    const onMove = (ev) => {
      if (!dragRef.current.active) return;
      const nx = ev.clientX - dragRef.current.ox;
      const ny = ev.clientY - dragRef.current.oy;
      setPos({
        x: Math.max(0, Math.min(Math.max(0, window.innerWidth - modalWidth), nx)),
        y: Math.max(0, Math.min(Math.max(0, window.innerHeight - 80), ny)),
      });
    };
    const onUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const resolved = useMemo(() => resolveHoldings(portfolio, date), [portfolio, date]);

  // 행별 표시값: 원본 보유항목 순서 = withManualSnapshot 내부 정규화 순서와 동일(인덱스 정합).
  // 종가/출처는 수량1 프로브, 평가금은 실제 수량 계산(펀드 currentPrice/evalAmount 폴백 보존).
  const rows = useMemo(() => (resolved.items || []).map((item) => {
    const realQty = cleanNum(item.quantity);
    const probe = calcPortfolioEvalDetail(
      [{ ...item, quantity: realQty || 1 }],
      accountType, date, stockHistoryMap, indicatorHistoryMap || {}, fx, mpo,
    );
    const pd = probe.items[0] || {};
    const real = calcPortfolioEvalDetail(
      [item], accountType, date, stockHistoryMap, indicatorHistoryMap || {}, fx, mpo,
    );
    const rd = real.items[0];
    return {
      item,
      isDeposit: item.type === 'deposit',
      isFund: item.type === 'fund',
      name: item.type === 'deposit' ? '예수금' : (() => {
        const code = item.code || '';
        const codeStripped = code.replace(/^MA:/i, '');
        const snapName = item.name;
        // 스냅샷 항목 이름이 비어있거나 코드와 같은 경우 현재 포트폴리오에서 최신 이름 보완
        if (!snapName || snapName === code || snapName === codeStripped) {
          const liveItem = (portfolio?.portfolio || []).find((pi: any) => pi.code === code && pi.type === item.type);
          const liveName = liveItem?.name;
          if (liveName && liveName !== code && liveName !== codeStripped) return liveName;
        }
        return snapName || (isGold ? 'KRX 금현물' : (code ? codeStripped : '—'));
      })(),
      quantity: realQty,
      price: pd.price ?? null,
      source: pd.source || 'none',
      evalAmt: rd ? rd.eval : 0,
    };
  }), [resolved, accountType, date, stockHistoryMap, indicatorHistoryMap, fx, mpo, isGold]);

  const recomputed = useMemo(
    () => calcPortfolioEvalDetail(resolved.items, accountType, date, stockHistoryMap, indicatorHistoryMap || {}, fx, mpo).total,
    [resolved, accountType, date, stockHistoryMap, indicatorHistoryMap, fx, mpo],
  );

  const stored = cleanNum(record.evalAmount);
  const diffRatio = stored > 0 ? Math.abs(recomputed - stored) / stored : (recomputed > 0 ? 1 : 0);
  const matched = recomputed > 0 && diffRatio < 0.001;

  const isOverseas = accountType === 'overseas';

  const depositsOnDate = useMemo(
    () => (depositHistory || []).filter(d => d.date === date),
    [depositHistory, date],
  );
  const withdrawalsOnDate = useMemo(
    () => (depositHistory2 || []).filter(w => w.date === date),
    [depositHistory2, date],
  );

  const cumPrincipalOnDate = useMemo(() => {
    const deps = [...(depositHistory || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const wds = [...(depositHistory2 || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let cum = 0;
    for (const d of deps) {
      if ((d.date || '') > date) break;
      if (!d.noPrincipal) cum += cleanNum(d.amount) * (isOverseas ? (cleanNum(d.fxRate) || 1) : 1);
    }
    for (const w of wds) {
      if ((w.date || '') > date) break;
      if (!w.noPrincipal) {
        const deducted = w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount);
        cum -= deducted * (isOverseas ? (cleanNum(w.fxRate) || 1) : 1);
      }
    }
    return Math.max(0, cum);
  }, [depositHistory, depositHistory2, date, isOverseas]);

  const hasCashFlow = depositsOnDate.length > 0 || withdrawalsOnDate.length > 0;
  const principalOnDate = cumPrincipalOnDate > 0 ? cumPrincipalOnDate : cleanNum(record.principal ?? portfolio?.principal ?? 0);

  const commitQty = (idx) => {
    const v = cleanNum(editQtyRaw);
    setEditQtyIdx(-1);
    if (v < 0) return;
    patchActivePortfolio(p => withManualSnapshot(p, date, items =>
      items.map((it, i) => i === idx ? { ...it, quantity: v } : it)));
    notify(`${formatShortDate(date)} 보유수량 수정 완료 (이후 스냅샷까지 적용)`, 'success');
  };

  const commitPrice = (idx) => {
    const row = rows[idx];
    const key = overrideKeyFor(row.item, isGold);
    setEditPriceIdx(-1);
    if (!key) { notify('이 종목은 종가를 수동입력할 수 없습니다 (코드 없음)', 'warning'); return; }
    const v = cleanNum(editPriceRaw);
    patchActivePortfolio(p => {
      const cur = p.manualPriceOverrides || {};
      const forKey = { ...(cur[key] || {}) };
      if (v > 0) forKey[date] = v;
      else delete forKey[date];
      return { ...p, manualPriceOverrides: { ...cur, [key]: forKey } };
    });
    notify(v > 0
      ? `${row.name} ${formatShortDate(date)} 수동종가 ${v.toLocaleString()} 저장`
      : `${row.name} ${formatShortDate(date)} 수동종가 해제`, 'success');
  };

  const removeRow = (idx) => {
    patchActivePortfolio(p => withManualSnapshot(p, date, items => items.filter((_, i) => i !== idx)));
    notify(`${formatShortDate(date)} 종목 제거 (manual 스냅샷)`, 'success');
  };

  const submitAdd = () => {
    const qty = cleanNum(addForm.quantity);
    const code = addForm.code.trim();
    const name = addForm.name.trim();
    const start = addForm.start;
    const end = addForm.end;
    if (qty <= 0) { notify('보유수량을 입력하세요', 'warning'); return; }
    if (!code && !name) { notify('종목코드 또는 종목명을 입력하세요', 'warning'); return; }
    if (!start) { notify('보유시작일을 입력하세요', 'warning'); return; }
    if (end && end < start) { notify('보유종료일은 시작일 이후여야 합니다', 'warning'); return; }
    const newItem = { code, name, type: addForm.type, quantity: qty, investAmount: 0, depositAmount: 0 };
    const sameAs = (i) => i.code === code && i.type === addForm.type && i.name === name;
    patchActivePortfolio(p => {
      let np = withManualSnapshot(p, start, items => {
        const without = items.filter(i => !sameAs(i));
        return [...without, newItem];
      });
      if (end) {
        np = withManualSnapshot(np, end, items => items.filter(i => !sameAs(i)));
      }
      return np;
    });
    notify(`${name || code} 추가 (${formatShortDate(start)}${end ? ` ~ ${formatShortDate(end)}` : ' ~'})`, 'success');
    setShowAdd(false);
    setAddForm({ code: '', name: '', type: 'stock', quantity: '', start: date, end: '' });
  };

  const isToday = date === effectiveDateKey;

  const confirm = () => {
    if (recomputed <= 0) { notify('재계산 합계가 0원입니다 — 종가/수량을 확인하세요', 'warning'); return; }
    const v = Math.round(recomputed);
    setHistory(hist => hist.map(item =>
      (item.id ? item.id === record.id : item.date === date)
        ? { ...item, evalAmount: v, adjustedAmount: v, isFixed: true }
        : item));
    notify(`${formatShortDate(date)} 평가액 ${v.toLocaleString()}원으로 확정`, 'success');
    onClose();
  };

  const unconfirm = () => {
    setHistory(hist => hist.map(item => {
      if (!(item.id ? item.id === record.id : item.date === date)) return item;
      const next = { ...item, isFixed: false };
      delete next.adjustedAmount;
      return next;
    }));
    notify(`${formatShortDate(date)} 확정 취소 — 자동 업데이트 허용`, 'info');
    onClose();
  };

  const fmtPrice = (n) => (n == null ? '—' : Math.round(n).toLocaleString());

  return (
    <div className="fixed inset-0" style={{ zIndex: Z.dialog }} onMouseDown={onClose} onTouchStart={onClose}>
      <div
        className="fixed border rounded-xl shadow-2xl flex flex-col"
        style={{ width: modalWidth, top: pos.y, left: pos.x, backgroundColor: BG.card, borderColor: '#4b5563', maxHeight: `calc(100vh - ${pos.y + 16}px)` }}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
      >
        <div
          className={`flex items-center justify-between px-3 py-2 border-b ${BORDER.default} ${isMobile ? '' : 'cursor-move'} select-none`}
          onMouseDown={handleDragStart}
        >
          <button onClick={onClose} className="text-pink-500 hover:text-pink-300"><X size={14} /></button>
          <span className="text-xs text-gray-300 font-bold">자산 검증 · {formatShortDate(date)}</span>
          <div style={{ width: 14 }} />
        </div>

        <div className={`${isMobile ? 'p-3' : 'p-4'} space-y-3 text-[11px] leading-relaxed overflow-y-auto flex-1 min-h-0`}>

          {resolved.estimated && (
            <div className="bg-amber-900/30 border border-amber-700/50 rounded px-3 py-1.5 text-amber-300 font-bold">
              🟡 추정 (보유수량 미확정) — 이 날짜의 구성을 확정하려면 수량을 검토·편집하세요.
            </div>
          )}

          <div className="rounded border border-gray-700/60 overflow-x-auto -mx-1 sm:mx-0">
            <table className={`w-full text-right ${isMobile ? 'text-[10px] min-w-[440px]' : 'text-[11px]'} border-collapse`}>
              <thead className="bg-gray-800 text-gray-400">
                <tr>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} text-left font-normal border-r border-gray-700`}>종목</th>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} font-normal border-r border-gray-700`}>보유수량</th>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} font-normal border-r border-gray-700`}>종가</th>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} text-center font-normal border-r border-gray-700`}>출처</th>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} font-normal border-r border-gray-700`}>평가금</th>
                  <th className="py-1.5 px-1 font-normal w-[28px]" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-gray-500">보유 종목이 없습니다.</td></tr>
                )}
                {rows.map((r, idx) => {
                  const badge = SOURCE_BADGE[r.source] || SOURCE_BADGE.none;
                  const cellPad = isMobile ? 'px-1.5' : 'px-2';
                  return (
                    <tr key={idx} className="border-t border-gray-700/60 hover:bg-gray-800/40">
                      <td className={`py-1.5 ${cellPad} text-left text-gray-200`}>{r.name}</td>
                      <td className={`py-1.5 ${cellPad} text-gray-300`}>
                        {r.isDeposit ? '—' : editQtyIdx === idx ? (
                          <input
                            autoFocus
                            className="w-[72px] bg-gray-900 border border-blue-500 rounded px-1 py-0.5 text-right text-gray-100 outline-none"
                            value={editQtyRaw}
                            onChange={e => setEditQtyRaw(e.target.value)}
                            onBlur={() => commitQty(idx)}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditQtyIdx(-1); }}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1 justify-end">
                            {r.quantity.toLocaleString()}
                            <button
                              className="text-gray-500 hover:text-blue-400"
                              title="보유수량 편집"
                              onClick={() => { setEditQtyIdx(idx); setEditQtyRaw(String(r.quantity)); }}
                            ><Pencil size={11} /></button>
                          </span>
                        )}
                      </td>
                      <td className={`py-1.5 ${cellPad} text-gray-300`}>
                        {r.isDeposit ? '—' : editPriceIdx === idx ? (
                          <input
                            autoFocus
                            className="w-[84px] bg-gray-900 border border-blue-500 rounded px-1 py-0.5 text-right text-gray-100 outline-none"
                            value={editPriceRaw}
                            placeholder="0=해제"
                            onChange={e => setEditPriceRaw(e.target.value)}
                            onBlur={() => commitPrice(idx)}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditPriceIdx(-1); }}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1 justify-end">
                            {r.isFund ? (r.price == null ? '—' : formatFundPrice(r.price)) : fmtPrice(r.price)}
                            <button
                              className="text-gray-500 hover:text-blue-400"
                              title="종가 수동입력 (manualPriceOverrides)"
                              onClick={() => { setEditPriceIdx(idx); setEditPriceRaw(r.price != null ? String(Math.round(r.price)) : ''); }}
                            ><Pencil size={11} /></button>
                          </span>
                        )}
                      </td>
                      <td className={`py-1.5 ${cellPad} text-center font-bold whitespace-nowrap ${badge.cls}`}>{badge.label}</td>
                      <td className={`py-1.5 ${cellPad} text-gray-200 font-bold whitespace-nowrap`}>{formatCurrency(r.evalAmt)}</td>
                      <td className="py-1.5 px-1 text-center">
                        {!r.isDeposit && (
                          <button className="text-gray-600 hover:text-red-400" title="이 날짜에서 종목 제거" onClick={() => removeRow(idx)}>
                            <Trash2 size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <button
              className="text-[11px] text-gray-400 hover:text-sky-400 font-bold inline-flex items-center gap-1"
              onClick={() => setShowAdd(s => !s)}
            >
              <Plus size={12} /> 종목 추가 {showAdd ? '▲' : '▼'}
            </button>
            {showAdd && (
              <div className="mt-2 bg-gray-800/40 border border-gray-700/60 rounded p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" placeholder="종목코드" value={addForm.code} onChange={e => setAddForm(f => ({ ...f, code: e.target.value }))} />
                  <input className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" placeholder="종목명" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
                  <select className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="stock">주식/ETF</option>
                    <option value="fund">펀드</option>
                  </select>
                  <input className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-right text-gray-200 outline-none" placeholder="보유수량" value={addForm.quantity} onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-0.5 text-gray-500">보유시작일
                    <input type="date" className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" value={addForm.start} onChange={e => setAddForm(f => ({ ...f, start: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-0.5 text-gray-500">보유종료일 (선택)
                    <input type="date" className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" value={addForm.end} onChange={e => setAddForm(f => ({ ...f, end: e.target.value }))} />
                  </label>
                </div>
                <button className="w-full py-1.5 bg-sky-700/60 hover:bg-sky-600/60 text-sky-100 rounded font-bold" onClick={submitAdd}>추가</button>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-1 border-t border-gray-700/60">
            <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
              <div className="text-gray-500 text-[10px] font-bold mb-1">검증</div>
              <div className="text-gray-400 flex justify-between"><span>재계산 합계 (수량 × 종가)</span><span className="text-gray-200 font-bold">{formatCurrency(recomputed)}</span></div>
              <div className="text-gray-400 flex justify-between"><span>저장된 평가자산</span><span className="text-gray-300 font-bold">{formatCurrency(stored)}</span></div>
              <div className="flex justify-between pt-0.5">
                <span className="text-gray-500">상태</span>
                <span className={`font-bold ${matched ? 'text-green-400' : 'text-amber-400'}`}>
                  {recomputed <= 0 ? '⚪ 데이터없음' : matched ? '✅ 일치' : `🔺 불일치 (차이 ${formatCurrency(Math.round(recomputed - stored))})`}
                </span>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
              <div className="text-gray-500 text-[10px] font-bold mb-1">자금 현황</div>
              {!hasCashFlow && (
                <div className="text-gray-600 text-[10px] text-center py-0.5">이 날 입출금 없음</div>
              )}
              {depositsOnDate.map((d, i) => (
                <div key={d.id ?? i} className="flex justify-between items-center">
                  <span className="flex items-center gap-1">
                    <span className="text-emerald-400 font-bold text-[10px]">입금</span>
                    {d.noPrincipal && <span className="text-sky-400 text-[9px]">원금제외</span>}
                    {d.memo && <span className="text-gray-500 text-[9px] truncate max-w-[80px]">{d.memo}</span>}
                  </span>
                  <span className="text-emerald-300 font-bold">
                    +{isOverseas ? `$${cleanNum(d.amount).toLocaleString()}` : formatCurrency(cleanNum(d.amount))}
                  </span>
                </div>
              ))}
              {withdrawalsOnDate.map((w, i) => {
                const deducted = w.principalDeducted != null ? cleanNum(w.principalDeducted) : null;
                return (
                  <div key={w.id ?? i} className="flex justify-between items-center">
                    <span className="flex items-center gap-1">
                      <span className="text-red-400 font-bold text-[10px]">출금</span>
                      {w.noPrincipal
                        ? <span className="text-sky-400 text-[9px]">원금무영향</span>
                        : deducted != null && deducted !== cleanNum(w.amount)
                          ? <span className="text-amber-400 text-[9px]">원금차감 {isOverseas ? `$${deducted.toLocaleString()}` : formatCurrency(deducted)}</span>
                          : <span className="text-amber-400 text-[9px]">원금차감</span>
                      }
                      {w.memo && <span className="text-gray-500 text-[9px] truncate max-w-[60px]">{w.memo}</span>}
                    </span>
                    <span className="text-red-300 font-bold">
                      -{isOverseas ? `$${cleanNum(w.amount).toLocaleString()}` : formatCurrency(cleanNum(w.amount))}
                    </span>
                  </div>
                );
              })}
              {(hasCashFlow || principalOnDate > 0) && (
                <div className="border-t border-gray-700/50 mt-1 pt-1 space-y-0.5">
                  {principalOnDate > 0 && (
                    <div className="text-gray-400 flex justify-between">
                      <span>이 날 투자원금</span>
                      <span className="text-sky-200 font-bold">{isOverseas ? `$${Math.round(principalOnDate).toLocaleString()}` : formatCurrency(principalOnDate)}</span>
                    </div>
                  )}
                  {stored > 0 && (
                    <div className="text-gray-400 flex justify-between">
                      <span>저장 평가자산</span>
                      <span className="text-gray-200 font-bold">{formatCurrency(stored)}</span>
                    </div>
                  )}
                  {principalOnDate > 0 && stored > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">평가손익</span>
                      <span className={`font-bold ${stored - principalOnDate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {stored - principalOnDate >= 0 ? '+' : ''}{formatCurrency(Math.round(stored - principalOnDate))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                className="flex-1 py-2 bg-emerald-700/70 hover:bg-emerald-600/70 disabled:bg-gray-700/50 disabled:text-gray-500 text-emerald-50 rounded font-bold tracking-wide"
                disabled={recomputed <= 0 || isToday}
                onClick={confirm}
              >
                수량*종가로 확정
              </button>
              {record.isFixed && (
                <button
                  className="px-3 py-2 bg-gray-700/70 hover:bg-amber-800/60 text-gray-300 hover:text-amber-200 rounded font-bold tracking-wide text-[11px] whitespace-nowrap"
                  onClick={unconfirm}
                >
                  확정 취소
                </button>
              )}
            </div>
            {isToday
              ? <div className="text-[10px] text-amber-600 text-center">오늘 날짜는 종가 미확정 — 장 마감 후 자동 고정됩니다</div>
              : <div className="text-[10px] text-gray-600 text-center">확정 시에만 평가자산 기록이 갱신됩니다 — 자동 덮어쓰기 없음</div>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
