// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatCurrency, cleanNum } from '../utils';

// 현금(예수금) 계좌 간 이관 — '미리보기 후 적용' 모달.
// ⚠️ 원클릭 실행 금지: undo가 없고 확정 즉시 Drive에 영속된다(StockTransferModal과 동일 등급).
// ⚠️ z 1070 — 메모 달력(1050)·메모 패드(1060)·관심종목/계산기(1050)보다 **위**여야 한다. 그 창들은
//    비차단이라 계좌 전환에도 열린 채 남으므로, 아래에 두면 버튼을 눌러도 "아무 일도 안 일어난다".
//    LoadingOverlay(1100) 아래는 유지.
const Z = 1070;

const fmtAmt = (n, currency) => (currency === 'USD'
  ? `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cleanNum(n))}`
  : formatCurrency(n));

const CashTransferModal = ({
  sourceName, sourceCash = 0, sourcePrincipal = 0, currency = 'KRW',
  targets = [], recordDate = '', onConfirm, onClose,
}) => {
  const panelRef = useRef(null);
  const prevFocusRef = useRef(null);
  const [targetId, setTargetId] = useState(() => {
    const first = targets.find(t => !t.blocked);
    return first ? first.id : '';
  });
  // ⚠️ 금액은 **원시 문자열 draft**로 들고 있는다 — onChange마다 cleanNum을 태우면 소수점('0.')이
  //    지워지고, 콤마 포맷을 다시 편집할 때 parseFloat가 앞자리만 읽는다(환율 계산기 규약).
  const [amtText, setAmtText] = useState('');
  const [movePrincipal, setMovePrincipal] = useState(true);
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
  const avail = cleanNum(sourceCash);
  const amount = cleanNum(amtText);
  const isUsd = currency === 'USD';
  // 표시 정밀도에 맞춰 정리한다 — 원화는 1원, 외화는 1센트. 안 하면 붙여넣은 실수가 그대로 원장에
  // 박혀 화면(2자리 표시)과 저장값이 갈린다.
  const M = useMemo(() => {
    if (!(amount > 0)) return 0;
    return isUsd ? Math.round(amount * 100) / 100 : Math.round(amount);
  }, [amount, isUsd]);

  const over = M > avail;
  const canRun = !!(target && !target.blocked && M > 0 && !over && !busy);

  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    try { await onConfirm(target.id, { amount: M, movePrincipal }); } finally { setBusy(false); }
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

  const OptBtn = ({ on, onClick, title, desc }) => (
    <button
      onClick={onClick}
      className={`w-full text-left px-2.5 py-2 rounded border transition-colors ${
        on ? 'border-sky-500/70 bg-sky-500/15' : 'border-gray-800 hover:bg-gray-800/60'
      }`}
    >
      <div className={`text-[12px] font-bold ${on ? 'text-sky-200' : 'text-gray-300'}`}>{title}</div>
      <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{desc}</div>
    </button>
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
            <div className="text-[14px] font-bold text-gray-100 truncate">현금 이관</div>
            <div className="text-[11px] text-gray-500 truncate">{sourceName} 예수금을 다른 계좌로</div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors shrink-0 ml-2" title="닫기 (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* 이관 금액 */}
          <div className="bg-black/40 border border-gray-800 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-gray-500">이관 금액</span>
              <button
                onClick={() => setAmtText(String(avail))}
                className="text-[10px] text-sky-400 hover:text-sky-200 transition-colors"
                title="예수금 전액"
              >전액 {fmtAmt(avail, currency)}</button>
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={amtText}
              onChange={e => setAmtText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              placeholder="0"
              className="w-full bg-transparent outline-none text-right text-[18px] font-bold tabular-nums text-yellow-200 placeholder:text-gray-700 border-b border-gray-800 focus:border-sky-600 pb-1 transition-colors"
            />
            <div className="mt-1 text-[10px] text-right">
              {over
                ? <span className="text-amber-300">예수금 {fmtAmt(avail, currency)}을 넘습니다</span>
                : <span className="text-gray-600">이관 후 예수금 {fmtAmt(avail - M, currency)}</span>}
            </div>
          </div>

          {/* 대상 계좌 */}
          <div>
            <div className="text-[11px] text-gray-500 mb-1">이관 대상 계좌</div>
            {targets.length === 0 ? (
              <div className="text-[12px] text-amber-300/90 bg-amber-500/10 border border-amber-700/40 rounded px-3 py-2">
                이관할 수 있는 계좌가 없습니다. 같은 통화의 계좌만 대상이 됩니다.
              </div>
            ) : (
              <div className="space-y-1 max-h-[152px] overflow-y-auto pr-0.5">
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
                    <span className="text-[10px] shrink-0 text-gray-500">
                      {t.blocked ? t.reason : `${t.typeLabel} · ${fmtAmt(t.cash, currency)}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 원금 반영 여부 — 사용자 확정 규약(2026-09): 금액과 별개로 매번 고른다. */}
          <div>
            <div className="text-[11px] text-gray-500 mb-1">투자원금 반영</div>
            <div className="space-y-1">
              <OptBtn
                on={movePrincipal}
                onClick={() => setMovePrincipal(true)}
                title="원금도 함께 이동"
                desc="원계좌 원금이 줄고 대상계좌 원금이 같은 금액만큼 늘어납니다. 두 계좌의 수익금은 그대로."
              />
              <OptBtn
                on={!movePrincipal}
                onClick={() => setMovePrincipal(false)}
                title="원금은 그대로 (수익만 이동)"
                desc="양쪽 원금이 변하지 않습니다. 이관 금액만큼 원계좌 수익금이 줄고 대상계좌 수익금이 늘어납니다."
              />
            </div>
          </div>

          {/* 미리보기 */}
          {M > 0 && target && !target.blocked && (
            <div className="bg-black/40 border border-gray-800 rounded-lg px-3 py-2">
              <Row label="기록일" value={recordDate || '-'} tone="text-gray-300" />
              <Row label="이관 금액" value={fmtAmt(M, currency)} />
              <Row
                label="원계좌 예수금"
                value={`${fmtAmt(avail, currency)} → ${fmtAmt(avail - M, currency)}`}
                tone="text-gray-300"
              />
              <Row
                label="대상 예수금"
                value={`${fmtAmt(target.cash, currency)} → ${fmtAmt(cleanNum(target.cash) + M, currency)}`}
                tone="text-gray-300"
              />
              <Row
                label="원계좌 투자원금"
                value={movePrincipal
                  ? `${fmtAmt(sourcePrincipal, currency)} → ${fmtAmt(Math.max(0, cleanNum(sourcePrincipal) - M), currency)}`
                  : '변동 없음'}
                tone={movePrincipal ? 'text-gray-300' : 'text-gray-500'}
                sub={movePrincipal ? '수익금은 그대로 유지됩니다' : `수익금이 ${fmtAmt(M, currency)} 줄어듭니다`}
              />
            </div>
          )}

          {M > 0 && target && !target.blocked && (
            <div className="text-[10px] text-gray-500 leading-relaxed">
              원계좌에 <span className="text-gray-400">출금 {fmtAmt(M, currency)}</span>, 대상계좌에 같은 금액의
              <span className="text-gray-400"> 입금</span>이 기록되고 양쪽 예수금이 함께 움직입니다.
              이관일 손익은 0이 되고 과거 기록은 그대로 유지됩니다.
              {target.isTest && (
                <span className="block mt-1 text-amber-300/90">
                  ⚠️ TEST 계좌는 통합 대시보드 합산에서 제외되므로 이관하면 통합 총자산이 그만큼 줄어듭니다.
                </span>
              )}
              {target.isCash && (
                <span className="block mt-1 text-gray-600">
                  직접입력 계좌는 예수금 행이 없어 평가금액이 같은 금액만큼 늘어납니다.
                </span>
              )}
              {/* 원계좌 원금이 이관 금액보다 작으면 0으로 클램프된다 — 과거 원금 역산이 그만큼
                  어긋나므로(종목 이관과 같은 한계) 조용히 넘기지 않고 미리 알린다. */}
              {movePrincipal && M > cleanNum(sourcePrincipal) && (
                <span className="block mt-1 text-amber-300/90">
                  ⚠️ 이관 금액이 원계좌 투자원금({fmtAmt(sourcePrincipal, currency)})보다 큽니다.
                  원금은 0으로 내려가고 그만큼은 이동하지 않습니다 — '원금은 그대로'를 고려하세요.
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

export default CashTransferModal;
