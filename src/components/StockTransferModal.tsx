// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatCurrency, formatNumber, cleanNum } from '../utils';

// 종목 계좌 간 이관 — '미리보기 후 적용' 모달.
// ⚠️ 원클릭 실행 금지: undo가 없고 확정 즉시 Drive에 영속된다(RebalanceTargetRestoreModal과 동일 등급).
// ⚠️ z 1070 — 메모 달력(1050)·메모 패드(1060)·관심종목/계산기(1050)보다 **위**여야 한다. 그 창들은
//    비차단이라 계좌 전환에도 열린 채 남으므로, 아래에 두면 버튼을 눌러도 "아무 일도 안 일어난다".
//    LoadingOverlay(1100) 아래는 유지.
const Z = 1070;

const fmtAmt = (n, currency) => (currency === 'USD'
  ? `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cleanNum(n))}`
  : formatCurrency(n));

const StockTransferModal = ({
  item, sourceName, currency = 'KRW', targets = [], getPlan, moves,
  onConfirm, onClose,
}) => {
  const panelRef = useRef(null);
  const prevFocusRef = useRef(null);
  const [targetId, setTargetId] = useState(() => {
    const first = targets.find(t => !t.blocked);
    return first ? first.id : '';
  });
  const [busy, setBusy] = useState(false);

  // 열 때 패널로 포커스를 옮기고 닫을 때 되돌린다 — 안 하면 Tab이 백드롭 뒤의 표 입력으로 들어간다.
  useEffect(() => {
    prevFocusRef.current = document.activeElement;
    panelRef.current?.focus();
    return () => { try { prevFocusRef.current?.focus?.(); } catch {} };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const target = targets.find(t => t.id === targetId) || null;
  const plan = useMemo(
    () => (target && !target.blocked && typeof getPlan === 'function' ? getPlan(target.id) : null),
    [target, getPlan]
  );

  if (!item) return null;

  const qty = cleanNum(item.quantity);
  const unit = item.type === 'fund' ? '좌' : item.type === 'savings' ? '' : '주';
  const gain = plan ? plan.market - plan.cost : 0;
  const canRun = !!(plan && target && !target.blocked && !busy);

  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    try { await onConfirm(target.id, plan); } finally { setBusy(false); }
  };

  const Row = ({ label, value, tone = 'text-gray-200', sub = null }) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className="text-right min-w-0">
        <span className={`text-[13px] font-bold tabular-nums ${tone}`}>{value}</span>
        {sub && <span className="block text-[10px] text-gray-600 mt-[1px]">{sub}</span>}
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: Z, background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[460px] max-h-[88vh] overflow-y-auto bg-[#0f1623] border border-gray-700 rounded-xl shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-gray-100 truncate">종목 이관</div>
            <div className="text-[11px] text-gray-500 truncate">{sourceName} 에서 다른 계좌로</div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors shrink-0 ml-2" title="닫기 (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="bg-black/40 border border-gray-800 rounded-lg px-3 py-2">
            <div className="text-[13px] font-bold text-gray-100 truncate">
              {item.name || <span className="text-gray-500 italic">이름 없음</span>}
              {item.code ? <span className="ml-1.5 text-[10px] text-gray-600 font-mono">{item.code}</span> : null}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {item.type === 'savings'
                ? `적립 ${fmtAmt(item.investAmount, currency)}`
                : qty > 0 ? `${formatNumber(qty)}${unit}` : '수량 없음'}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-gray-500 mb-1">이관 대상 계좌</div>
            {targets.length === 0 ? (
              <div className="text-[12px] text-amber-300/90 bg-amber-500/10 border border-amber-700/40 rounded px-3 py-2">
                이관할 수 있는 계좌가 없습니다. 같은 통화·같은 시장의 계좌만 대상이 됩니다.
              </div>
            ) : (
              <div className="space-y-1 max-h-[168px] overflow-y-auto pr-0.5">
                {targets.map(t => (
                  <button
                    key={t.id}
                    disabled={t.blocked}
                    onClick={() => setTargetId(t.id)}
                    className={`w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded border transition-colors ${
                      t.blocked
                        ? 'border-gray-800 bg-gray-900/40 cursor-not-allowed'
                        : t.id === targetId
                          ? 'border-sky-500/70 bg-sky-500/15'
                          : 'border-gray-800 hover:bg-gray-800/60'
                    }`}
                  >
                    <span className={`text-[12px] truncate ${t.blocked ? 'text-gray-600' : 'text-gray-200'}`}>
                      {t.name || '계좌'}
                      {t.isTest && <span className="ml-1 text-[10px] text-emerald-400 italic">TEST</span>}
                    </span>
                    <span className="text-[10px] text-gray-500 shrink-0">{t.blocked ? t.reason : t.typeLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {plan && (
            <div className="bg-black/40 border border-gray-800 rounded-lg px-3 py-2">
              <Row label="기록일" value={plan.dateSrc === plan.dateTgt ? plan.dateSrc : `${plan.dateSrc} → ${plan.dateTgt}`} tone="text-gray-300" />
              <Row
                label="이관 금액"
                value={fmtAmt(plan.market, currency)}
                sub={plan.prevDate ? `${plan.prevDate} 종가 기준${plan.exact ? '' : ' (근사)'}` : '실시간 현재가 기준 (종가 미확보)'}
              />
              <Row label="매입원가" value={fmtAmt(plan.cost, currency)} sub="원금 이동액" />
              <Row
                label="평가차익"
                value={`${gain > 0 ? '+' : ''}${fmtAmt(gain, currency)}`}
                tone={gain > 0 ? 'text-red-400' : gain < 0 ? 'text-blue-400' : 'text-gray-400'}
              />
            </div>
          )}

          {plan && moves && (
            <div className="text-[11px] text-gray-400 leading-relaxed bg-black/30 border border-gray-800/70 rounded-lg px-3 py-2">
              <div className="text-gray-500 mb-1">함께 이동하는 기록</div>
              <div>· 분배금 실지급·이력 {moves.dividend}건</div>
              <div>· 과표 이력 {moves.tax}건</div>
              <div>· 수동 종가 {moves.price}건 <span className="text-gray-600">(원계좌에도 유지)</span></div>
            </div>
          )}

          {plan && target && !target.blocked && (
            <div className="text-[10px] text-gray-500 leading-relaxed">
              원계좌에 <span className="text-gray-400">출금 {fmtAmt(plan.market, currency)}</span>, 대상계좌에 같은 금액의
              <span className="text-gray-400"> 입금</span>이 기록됩니다. 이관일 손익은 0이 되고 과거 기록은 그대로 유지됩니다.
              {target.isTest && (
                <span className="block mt-1 text-amber-300/90">
                  ⚠️ TEST 계좌는 통합 대시보드 합산에서 제외되므로 이관하면 통합 총자산이 그만큼 줄어듭니다.
                </span>
              )}
              <span className="block mt-1 text-amber-300/80">⚠️ 되돌리기(undo)는 제공되지 않습니다.</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-gray-400 hover:text-gray-200 transition-colors">취소</button>
          <button
            onClick={run}
            disabled={!canRun}
            className={`px-4 py-1.5 text-[12px] font-bold rounded transition-colors ${
              canRun ? 'bg-sky-600 hover:bg-sky-500 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
          >
            이관
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockTransferModal;
