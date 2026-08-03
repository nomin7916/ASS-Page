// @ts-nocheck
// 과거 목표비중 복원 — 메모 달력의 rebalTarget 스냅샷을 골라 현재 리밸런싱 표에 적용한다.
// ⚠️ 이 컴포넌트는 calendarMemos를 **읽기만** 한다(쓰기 prop을 일부러 받지 않는다 — INV-1).
//    상세 규약은 CLAUDE.md "과거 목표비중 복원" 섹션 참조.
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, CalendarClock } from 'lucide-react';
import { matchRebalTargetRows } from '../utils';
import { getTodayKST } from '../hooks/useMarketCalendar';

const pad2 = (n) => String(n).padStart(2, '0');
// ⚠️ 날짜 키는 직접 조립 — `new Date('YYYY-MM-DD')`는 UTC 파싱이라 한국 시간대에서 하루 밀린다.
const dayKeyOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const fmtShort = (k) => (typeof k === 'string' && k.length === 10 ? `${k.slice(2, 4)}/${k.slice(5, 7)}/${k.slice(8, 10)}` : (k || ''));
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const SKIP_LABEL = {
  missing: '현재 표에 없음',
  ambiguous: '같은 코드·이름이 둘 이상',
  'blank-key': '이름·코드 없음',
  'bad-value': '값 손상',
  'bad-row': '행 손상',
};

export default function RebalanceTargetRestoreModal({
  open,
  onClose,
  snapshots = [],        // [{ dayKey, memo }] — 날짜 내림차순
  currentRows = [],      // rebalanceData (현재 리밸런싱 표)
  amountModeActive = false, // 투자선택이 '목표금액'인가 — 그때만 금액이 비중을 무력화한다
  targetMode = 'fixed',  // 현재 settings.targetMode
  targetDate = '',       // 현재 settings.targetDate — 소스와 같으면 경고
  locked = false,        // isFixedLocked
  pinPending = false,    // PIN 모달이 이 창 위에 떠 있는가
  onRequestPin = null,   // (cb) => void
  onApply = null,        // (dayKey, memo, matched) => void
}) {
  const [selDayKey, setSelDayKey] = useState(null);
  // ⚠️ 보고 있는 달은 **파생값 + 덮어쓰기(viewOv)** 로 둔다. state 초기값을 상수로 두고 effect에서
  //    고치면 열 때마다 엉뚱한 달이 한 프레임 번쩍인다(이 컴포넌트는 open 토글만 되고 언마운트되지
  //    않으므로 첫 렌더가 옛 값으로 커밋된다). ⚠️ 폴백에 `new Date()` 로컬 TZ 금지 — getTodayKST.
  const [viewOv, setViewOv] = useState(null);
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

  const byDay = useMemo(() => {
    const m = new Map();
    (snapshots || []).forEach(s => { if (s && s.dayKey) m.set(s.dayKey, s); });
    return m;
  }, [snapshots]);

  const view = useMemo(() => {
    if (viewOv) return viewOv;
    const base = selDayKey || (snapshots || [])[0]?.dayKey || getTodayKST();
    return (typeof base === 'string' && base.length === 10)
      ? { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 }
      : { y: 2000, m: 0 };
  }, [viewOv, selDayKey, snapshots]);

  // 열 때마다 최신 스냅샷을 자동 선택 — 첫 화면에서 바로 미리보기가 보인다(달은 위에서 따라온다).
  // ⚠️ 포커스도 창 안으로 옮긴다 — 안 그러면 Tab이 백드롭 뒤에 가려진 목표비중 입력·모드 select로
  //    들어가, 수시변경 모드(잠금 없음)에서 보이지 않는 셀을 편집하게 된다.
  useEffect(() => {
    if (!open) return;
    setSelDayKey((snapshots || [])[0]?.dayKey ?? null);
    setViewOv(null);
    returnFocusRef.current = document.activeElement;
    const t = setTimeout(() => panelRef.current?.focus?.(), 0);
    return () => {
      clearTimeout(t);
      const back = returnFocusRef.current;
      returnFocusRef.current = null;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ⚠️ PIN 모달이 위에 떠 있는 동안에는 Esc·백드롭으로 닫지 않는다 — PIN 모달에는 Esc 핸들러가
  //    없어서, 이 창만 닫히고 PIN은 남는다. 그 상태로 비밀번호를 입력하면 사용자가 취소했다고
  //    믿은 복원이 그대로 적용된다(적용 콜백은 이미 PIN에 넘어가 있다).
  const requestClose = () => { if (!pinPending) onClose?.(); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); requestClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, pinPending]);

  const sel = selDayKey ? byDay.get(selDayKey) : null;
  const result = useMemo(
    () => (sel ? matchRebalTargetRows(sel.memo?.rows, currentRows) : null),
    [sel, currentRows],
  );

  const curSum = useMemo(
    () => (currentRows || []).reduce((s, it) => s + (Number(it?.effectiveTargetRatio) || 0), 0),
    [currentRows],
  );

  // ⚠️ 투자선택이 '목표금액'일 때, 금액이 지정된 행은 비중을 복원해도 수량이 1주도 바뀌지 않는다.
  //    이 기능은 undo가 없고 미리보기가 유일한 안전망이라, '적용됨'으로만 보이면 사용자가
  //    아무 일도 안 일어난 이유를 알 길이 없다 → 해당 행에 배지로 고지한다.
  //    ⚠️ 리밸런싱·적립식에서는 금액이 무시되고 비중이 그대로 적용되므로 배지를 띄우면 거짓말이 된다.
  //    ⚠️ matchRebalTargetRows(utils.ts)를 고쳐 플래그를 실어 보내지 말 것 — 그 함수는
  //    verify:rebal-restore가 참조 구현으로 미러링하므로 본문을 바꾸면 스크립트도 함께 고쳐야 한다.
  const amtOverrideIds = useMemo(
    () => (amountModeActive
      ? new Set((currentRows || []).filter(it => it?.hasTargetAmount).map(it => it.id))
      : new Set()),
    [currentRows, amountModeActive],
  );

  if (!open) return null;

  const shiftMonth = (d) => {
    const t = view.m + d;
    setViewOv({ y: view.y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 });
  };
  const selectDay = (key) => { setSelDayKey(key); setViewOv(null); };

  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const modeMismatch = !!sel && (sel.memo?.targetMode === 'variable' ? 'variable' : 'fixed') !== targetMode;
  const sameAsTargetDate = !!sel && !!targetDate && targetDate === sel.dayKey;
  // 헤더 날짜에 이미 기록이 있으면 이 복원은 달력에 기록되지 않는다(App handleTargetRestored가
  // 그 원본을 덮어쓰지 않으려고 dirty를 세우지 않는다). 표만 바뀐다는 사실을 **적용 전에** 알린다.
  const headerHasRecord = !!targetDate && byDay.has(targetDate);
  const canApply = !!result && result.matched.length > 0;

  const doApply = () => {
    if (!canApply || !onApply) return;
    onApply(sel.dayKey, sel.memo, result.matched);
    onClose?.();
  };
  // ⚠️ fail-closed — locked인데 PIN 핸들러가 없으면 **아무 일도 하지 않는다**.
  //    `locked && onRequestPin`으로 묶으면 prop 하나만 빠져도 잠금이 통째로 열린다.
  const handleApplyClick = () => {
    if (!canApply) return;
    if (locked) { if (onRequestPin) onRequestPin(doApply); return; }
    doApply();
  };

  const afterSum = result ? result.appliedSum + result.untouchedSum : curSum;

  return (
    // ⚠️ z는 비차단 플로팅 창들(메모 달력 1050·메모 패드 1060·관심종목/계산기 1050·투자기록 패드
    //    1000/1010) **위**, LoadingOverlay(1100) 아래여야 한다. 560으로 두면 폭 1200px짜리 메모
    //    달력이 열려 있을 때 이 창이 통째로 가려져 "아이콘을 눌러도 아무 일이 없다"가 된다.
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 1070 }}>
      <div className="absolute inset-0 bg-black/70" onClick={requestClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative bg-[#0f1623] border border-gray-700 rounded-lg shadow-2xl w-full max-w-[860px] max-h-[88vh] flex flex-col outline-none"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarClock size={15} className="text-emerald-400 shrink-0" />
            <span className="text-[13px] font-bold text-gray-100 truncate">과거 목표비중 불러오기</span>
            {snapshots[0]?.memo?.accountName && (
              <span className="text-[11px] text-gray-500 truncate">— {snapshots[0].memo.accountName}</span>
            )}
          </div>
          <button type="button" onClick={requestClose} className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700/50 shrink-0">
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto grow">
          {/* 날짜 선택: 미니 달력 + 기록 목록 */}
          <div className="flex flex-col sm:flex-row gap-3 p-3 border-b border-gray-800">
            <div className="shrink-0 w-full sm:w-[248px] select-none">
              <div className="flex items-center justify-between mb-1.5">
                <button type="button" onClick={() => shiftMonth(-1)} className="p-1 rounded text-gray-500 hover:text-emerald-300 hover:bg-gray-700/50"><ChevronLeft size={14} /></button>
                <span className="text-[12px] font-bold text-gray-200 tabular-nums">{view.y}년 {view.m + 1}월</span>
                <button type="button" onClick={() => shiftMonth(1)} className="p-1 rounded text-gray-500 hover:text-emerald-300 hover:bg-gray-700/50"><ChevronRight size={14} /></button>
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {WD.map((w, i) => (
                  <div key={w} className={`text-center text-[9px] py-0.5 ${i === 0 ? 'text-red-400/70' : i === 6 ? 'text-blue-400/70' : 'text-gray-600'}`}>{w}</div>
                ))}
                {cells.map((d, i) => {
                  if (d == null) return <div key={`e${i}`} />;
                  const key = dayKeyOf(view.y, view.m, d);
                  const has = byDay.has(key);
                  const isSel = key === selDayKey;
                  const dow = (firstDow + d - 1) % 7;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!has}
                      onClick={() => selectDay(key)}
                      className={`relative h-7 rounded text-[11px] tabular-nums transition-colors ${
                        isSel ? 'bg-emerald-500/25 text-emerald-200 font-bold ring-1 ring-emerald-400/60'
                        : has ? 'text-gray-200 hover:bg-emerald-500/15'
                        : dow === 0 ? 'text-red-400/25 cursor-default' : dow === 6 ? 'text-blue-400/25 cursor-default' : 'text-gray-700 cursor-default'
                      }`}
                      title={has ? `${key} 기록 보기` : undefined}
                    >
                      {d}
                      {has && !isSel && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grow min-w-0 max-h-[210px] overflow-y-auto border border-gray-800 rounded">
              {snapshots.length === 0 ? (
                <div className="p-4 text-[11px] text-gray-600 text-center">기록된 목표비중이 없습니다.</div>
              ) : snapshots.map(s => {
                const isSel = s.dayKey === selDayKey;
                return (
                  <button
                    key={s.dayKey}
                    type="button"
                    onClick={() => selectDay(s.dayKey)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left border-b border-gray-800/70 last:border-b-0 transition-colors ${
                      isSel ? 'bg-emerald-500/15' : 'hover:bg-gray-800/50'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSel ? 'bg-emerald-400' : 'bg-gray-700'}`} />
                    <span className={`text-[11px] font-mono tabular-nums shrink-0 ${isSel ? 'text-emerald-200' : 'text-gray-300'}`}>{fmtShort(s.dayKey)}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{(s.memo?.rows || []).length}종목</span>
                    <span className="text-[10px] text-gray-500 ml-auto shrink-0 tabular-nums">합계 {Number(s.memo?.totalTargetRatio || 0).toFixed(2)}%</span>
                    <span className="text-[9px] text-gray-600 shrink-0">{s.memo?.targetMode === 'variable' ? '수시변경' : '고정'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 경고 */}
          {(modeMismatch || headerHasRecord || !targetDate) && !!sel && (
            <div className="px-3 py-2 space-y-1 border-b border-gray-800">
              {modeMismatch && (
                <div className="text-[10.5px] text-amber-300/90">
                  ⚠️ 이 기록은 <b>{sel.memo?.targetMode === 'variable' ? '수시변경' : '고정'}</b> 목표입니다 —
                  현재 화면의 <b>{targetMode === 'variable' ? '수시변경' : '고정'}</b> 목표 열에 적용됩니다.
                </div>
              )}
              {headerHasRecord && (
                <div className="text-[10.5px] text-amber-300/90">
                  ⚠️ 목표 날짜(헤더 <b>{fmtShort(targetDate)}</b>)에 이미 기록이 있어 <b>이 복원은 달력에
                  기록되지 않습니다</b> — 그 기록을 덮어쓰지 않기 위해서입니다(표의 목표비중은 정상 적용).
                  이력으로 남기려면 헤더 날짜를 기록이 없는 날로 바꾼 뒤 적용하세요.
                  {sameAsTargetDate && ' 또한 이후 목표를 직접 수정하면 이 기록의 수량·평가금이 오늘 값으로 갱신됩니다.'}
                </div>
              )}
              {!targetDate && (
                <div className="text-[10.5px] text-gray-500">
                  목표 날짜(헤더)가 비어 있어 이 복원은 달력에 기록되지 않습니다 — 표의 목표비중만 바뀝니다.
                </div>
              )}
            </div>
          )}

          {/* 미리보기 */}
          {!result ? (
            <div className="p-6 text-[11px] text-gray-600 text-center">날짜를 선택하세요.</div>
          ) : (
            <div className="p-3 space-y-3">
              <div>
                <div className="text-[10px] text-emerald-300/80 mb-1">적용 ({result.matched.length})</div>
                {result.matched.length === 0 ? (
                  <div className="text-[11px] text-gray-600 py-1">일치하는 종목이 없습니다.</div>
                ) : (
                  <table className="w-full text-[11px] tabular-nums">
                    <thead>
                      <tr className="text-gray-600 border-b border-gray-800">
                        <th className="text-left font-normal py-1 pr-1">종목명</th>
                        <th className="text-right font-normal py-1 px-1">현재</th>
                        <th className="text-center font-normal py-1 px-1 w-5" />
                        <th className="text-right font-normal py-1 px-1">복원</th>
                        <th className="text-right font-normal py-1 pl-1">변화</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.matched.map(m => {
                        const diff = m.value - m.prevRatio;
                        return (
                          <tr key={m.id} className="border-b border-gray-900/80">
                            <td className="text-left text-gray-200 py-1 pr-1">
                              {m.curName || <span className="text-gray-600">(이름 없음)</span>}
                              {m.code ? <span className="ml-1 text-[9px] text-gray-600 font-mono">{m.code}</span> : null}
                              {m.snapName && m.snapName !== m.curName && (
                                <span className="ml-1 text-[9px] text-gray-600">(기록: {m.snapName})</span>
                              )}
                              {m.by === 'name' && <span className="ml-1 text-[9px] text-amber-400/70">이름 대조</span>}
                              {amtOverrideIds.has(m.id) && <span className="ml-1 text-[9px] text-amber-400/90" title="이 종목은 목표금액이 지정돼 있어, 비중을 복원해도 수량이 바뀌지 않습니다 (표에서 목표금액 칸을 비우면 적용)">목표금액 우선</span>}
                            </td>
                            <td className="text-right text-gray-500 py-1 px-1">{m.prevRatio.toFixed(2)}</td>
                            <td className="text-center text-gray-700 py-1 px-1">→</td>
                            <td className="text-right text-green-400 py-1 px-1 font-bold">{m.value.toFixed(2)}</td>
                            <td className={`text-right py-1 pl-1 ${Math.abs(diff) < 0.005 ? 'text-gray-600' : diff > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                              {Math.abs(diff) < 0.005 ? '0.00' : `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ⚠️ 헤더를 '기록에만 있는 종목'으로 단언하지 말 것 — ambiguous(같은 코드·이름 2행)는
                  현재 표에 **있는데도** 보류된 것이라, 그렇게 쓰면 사용자가 미적용을 놓친다.
                  미리보기가 유일한 안전망이므로 사유를 항목마다 노출하고 missing 외에는 앰버로 강조. */}
              {result.skipped.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">미적용 ({result.skipped.length}) · 기록에 있으나 적용하지 못한 행</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {result.skipped.map((s, i) => {
                      const notMissing = s.why !== 'missing';
                      return (
                        <span key={i} className={`text-[10.5px] ${notMissing ? 'text-amber-300/80' : 'text-gray-500'}`}>
                          {s.name || s.code || '(이름 없음)'}{' '}
                          <span className={notMissing ? 'text-amber-400/60' : 'text-gray-700'}>
                            {Number(s.value || 0).toFixed(2)}% · {SKIP_LABEL[s.why] || s.why}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {result.untouched.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">유지 ({result.untouched.length}) · 현재 목표비중 그대로</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {result.untouched.map(it => (
                      <span key={it.id} className="text-[10.5px] text-gray-500">
                        {it.name || it.code || '(이름 없음)'} <span className="text-gray-700">{(Number(it.effectiveTargetRatio) || 0).toFixed(2)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1 border-t border-gray-800 text-[11px] tabular-nums">
                <span className="text-gray-500">목표 합계</span>
                <span className="text-gray-400">{curSum.toFixed(2)}%</span>
                <span className="text-gray-700">→</span>
                <span className="text-green-400 font-bold">{afterSum.toFixed(2)}%</span>
                <span className="text-[9.5px] text-gray-600 ml-1">※ 합계는 100%로 보정하지 않습니다</span>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-gray-700 shrink-0">
          {result && result.matched.length === 0 && (
            <span className="text-[10.5px] text-gray-500 mr-auto">적용할 종목이 없습니다.</span>
          )}
          <button type="button" onClick={requestClose} className="px-3 py-1.5 rounded text-[11px] text-gray-400 hover:text-gray-200 hover:bg-gray-700/50">닫기</button>
          <button
            type="button"
            disabled={!canApply}
            onClick={handleApplyClick}
            className={`px-3 py-1.5 rounded text-[11px] font-bold transition-colors ${
              canApply ? 'bg-emerald-600/80 text-white hover:bg-emerald-500' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
          >
            {locked ? '🔒 ' : ''}적용{canApply ? ` (${result.matched.length}종목)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
