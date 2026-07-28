// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Check, Calendar as CalIcon, Trash2 } from 'lucide-react';
import { BG } from '../design';
import { generateId, formatNumber } from '../utils';
import { getTodayKST } from '../hooks/useMarketCalendar';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

// 비차단·이동 가능 플로팅 창 (FloatingCalculator/WatchlistPopup과 동일 규칙).
// - 단일 position:fixed div (백드롭/오버레이 없음 → 아래 앱 클릭·스크롤 통과 → 탭 전환·이동 가능)
// - z 1050(달력 창) / 1060(메모 패드): dialog 1000 < 여기 < LoadingOverlay 1100
// - 타이틀 바만 드래그 핸들, window mousemove/touchmove 리스너로 이동, 뷰포트 클램프
const CAL_Z = 1050;
const PAD_Z = 1060;
const CAL_W = 920;   // 달력 창 폭(px). 좁은 화면은 maxWidth로 클램프
const PAD_W = 576;   // 메모 패드 폭(px)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const pad2 = (n) => String(n).padStart(2, '0');
const dayKeyOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const firstLine = (s) => {
  const t = (s || '').trim();
  const i = t.indexOf('\n');
  return i === -1 ? t : t.slice(0, i);
};

// 포트폴리오 스냅샷 표시용 포맷터 (달력 칸 = 억/만 축약, 메모장 = 풀 숫자).
const nfmt = (n) => Math.round(n).toLocaleString('en-US');
const fmtAbbrev = (n) => {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e8) return `${sign}₩${(a / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${sign}₩${nfmt(a / 1e4)}만`;
  return `${sign}₩${nfmt(a)}`;
};
const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
// 목표비중 기록용 — 수량은 소수(펀드 좌수) 가능, 금액은 계좌 통화(overseas=USD) 따라 표기.
// ⚠️ 원화 환산 금지(환율 시점이 섞여 가짜 손익이 생긴다 — CLAUDE.md 해외계좌 규약).
// ⚠️ 수량은 리밸런싱 표와 **같은 포매터**를 써야 한다 — 자체 포매터를 두면 펀드 좌수처럼 소수
// 수량에서 자릿수가 갈려(4자리 vs 3자리) 사용자가 "기록이 화면과 다르다"고 오인한다.
const qfmt = (n) => formatNumber(n);
const fmtMoney = (n, currency) => currency === 'USD'
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
  : `₩${nfmt(Number(n) || 0)}`;
// 한국식 손익 색상: 이익=빨강, 손실=파랑, 0=회색.
const pnlColor = (v) => (v > 0 ? 'text-red-400' : v < 0 ? 'text-blue-400' : 'text-gray-400');

// 달력 메모 창 — 헤더의 달력 아이콘으로 진입.
// 데이터: { [YYYY-MM-DD]: { id, content, createdAt }[] } (앱 레벨, Drive STATE에 영속).
// 하루 배열은 append 순(오래된 메모 위 / 새 메모 아래)으로 표시.
export default function CalendarModal({ open, onClose, memos = {}, onUpdateMemos, holidays = { kr: [], us: [] }, notify, confirm, metricsHistory = [], todayReturnRate = null, fxHistory = null, us10yHistory = null, liveFx = null, liveUs10y = null }) {
  const todayStr = getTodayKST();
  const tp = todayStr.split('-');
  const ty = parseInt(tp[0], 10);
  const tm = parseInt(tp[1], 10) - 1;

  const [viewYear, setViewYear] = useState(ty);
  const [viewMonth, setViewMonth] = useState(tm);
  // pad: null | { dayKey, mode: 'new'|'edit', memoId, val }
  const [pad, setPad] = useState(null);

  // 플로팅 창 위치 (달력 창 / 메모 패드 각각 독립 이동)
  const [winPos, setWinPos] = useState(() => ({ x: 60, y: 40 }));
  const [padPos, setPadPos] = useState(() => ({ x: 200, y: 120 }));
  // 패드가 열릴 때마다 증가 — 실제 높이 측정 후 중앙 배치 효과의 트리거
  const [padSeq, setPadSeq] = useState(0);
  const winRef = useRef(null);
  const padRef = useRef(null);
  // 드래그 대상('win'|'pad'|null) + 커서-창 오프셋. 창 하나의 window 리스너로 둘 다 처리.
  const dragRef = useRef({ target: null, offX: 0, offY: 0 });

  // 재오픈 시 이번 달로 리셋 + 패드 닫기 (열려 있는 동안 탭 전환에는 open이 그대로라 재실행 안 됨)
  useEffect(() => {
    if (open) {
      setViewYear(ty);
      setViewMonth(tm);
      setPad(null);
    }
  }, [open]);

  // 열 때마다 달력 창을 화면 중앙으로 재배치 (측정 후 클램프 — FloatingCalculator와 동일 패턴)
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const w = winRef.current?.offsetWidth || CAL_W;
      const h = winRef.current?.offsetHeight || 620;
      setWinPos({
        x: Math.max(12, Math.round((window.innerWidth - w) / 2)),
        y: Math.max(12, Math.round((window.innerHeight - h) / 2)),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // 패드가 열릴 때마다 실제 높이를 측정해 화면 중앙 배치 + 뷰포트 클램프.
  // 세로를 크게 키웠으므로(rows 28) 고정 오프셋으로 배치하면 아래가 화면 밖으로 잘릴 수 있다.
  useEffect(() => {
    if (!padSeq) return;
    const id = requestAnimationFrame(() => {
      const el = padRef.current;
      if (!el) return;
      const w = el.offsetWidth || PAD_W;
      const h = el.offsetHeight || 400;
      setPadPos({
        x: clamp(Math.round((window.innerWidth - w) / 2), 0, Math.max(0, window.innerWidth - w)),
        y: clamp(Math.round((window.innerHeight - h) / 2), 0, Math.max(0, window.innerHeight - 40)),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [padSeq]);

  // 드래그 이동 (window 리스너 — 커서가 창 밖으로 나가도 추적, 뷰포트 클램프)
  useEffect(() => {
    const onMove = (e) => {
      const t = dragRef.current.target;
      if (!t) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const nx = cx - dragRef.current.offX;
      const ny = cy - dragRef.current.offY;
      if (t === 'win') {
        const w = winRef.current?.offsetWidth || CAL_W;
        setWinPos({ x: clamp(nx, 0, window.innerWidth - w), y: clamp(ny, 0, window.innerHeight - 40) });
      } else {
        const w = padRef.current?.offsetWidth || PAD_W;
        // 패드 전체를 화면 안에 유지 — 좌측 정렬된 취소/저장 버튼이 화면 밖으로 밀려나지 않도록
        // (달력 창·WatchlistPopup과 동일한 [0, innerWidth-w] 클램프). 타이틀 바(상단 40px)도 항상 노출.
        setPadPos({ x: clamp(nx, 0, Math.max(0, window.innerWidth - w)), y: clamp(ny, 0, window.innerHeight - 40) });
      }
    };
    const onEnd = () => { dragRef.current.target = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  // Esc: 패드가 열려 있으면 패드만 닫는다 (비차단 배경 창을 전역 Esc로 통째 닫지 않음).
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape' && pad) setPad(null); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, pad]);

  // 날짜별 포트폴리오 스냅샷 (그 날짜의 실제 기록) — 통합 대시보드 intMonthlyHistory 기반.
  const metricsByDate = useMemo(() => {
    const m = {};
    (metricsHistory || []).forEach((h) => { if (h && h.date) m[h.date] = h; });
    return m;
  }, [metricsHistory]);
  // 헤더 카드가 대표하는 '오늘' 기록의 날짜 = 최신 기록일(effectiveDate 기준, getTodayKST()와
  // 00:00~07:30 KST엔 다를 수 있음). 헤더값 오버라이드(todayReturnRate)·라이브 지표는 이 셀에 적용.
  const latestRecDate = useMemo(() => {
    let latest = null;
    (metricsHistory || []).forEach((h) => { if (h && h.date && (!latest || h.date > latest)) latest = h.date; });
    return latest;
  }, [metricsHistory]);
  // 환율·US10Y 과거값 carry-forward용 정렬 키(문자열 YYYY-MM-DD = 시간순).
  const fxKeys = useMemo(() => (fxHistory ? Object.keys(fxHistory).sort() : []), [fxHistory]);
  const us10yKeys = useMemo(() => (us10yHistory ? Object.keys(us10yHistory).sort() : []), [us10yHistory]);

  // 목표비중 기록 패드는 memoId 앵커 + 라이브 재조회(기존 편집 패드와 같은 계약)라 원본이 삭제되면
  // 스스로 닫힌다. upsert는 id를 승계하므로 내용이 교체돼도 닫히지 않고 새 스냅샷으로 갱신된다.
  // ⚠️ 아래 `if (!open) return null`은 모든 훅 뒤에 있어야 하므로 이 effect는 반드시 그 위에 둔다.
  useEffect(() => {
    if (!pad || pad.kind !== 'rebalTarget') return;
    const list = memos[pad.dayKey];
    if (!Array.isArray(list) || !list.some((m) => m && m.id === pad.memoId)) setPad(null);
  }, [memos, pad]);

  if (!open) return null;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const krHol = holidays?.kr || [];

  // 드래그 시작 — 현재 렌더의 winPos/padPos를 읽어 오프셋 고정
  const startDrag = (target, cx, cy) => {
    const p = target === 'win' ? winPos : padPos;
    dragRef.current = { target, offX: cx - p.x, offY: cy - p.y };
  };

  const gotoPrev = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); } else setViewMonth(viewMonth - 1);
  };
  const gotoNext = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); } else setViewMonth(viewMonth + 1);
  };
  const gotoToday = () => { setViewYear(ty); setViewMonth(tm); };

  // 패드 배치는 padSeq 효과가 실제 높이를 측정해 중앙 정렬 + 클램프한다(고정 오프셋 금지 — 세로가 길어 잘림).
  const openNew = (dayKey) => { setPad({ dayKey, mode: 'new', memoId: null, val: '' }); setPadSeq((s) => s + 1); };
  const openEdit = (dayKey, memo) => { setPad({ dayKey, mode: 'edit', memoId: memo.id, val: memo.content || '' }); setPadSeq((s) => s + 1); };
  // 리밸런싱 목표비중 기록(읽기 전용) — 값 복사가 아니라 memoId만 들고 매 렌더 재조회한다.
  const openRebal = (dayKey, memo) => { setPad({ kind: 'rebalTarget', dayKey, memoId: memo.id }); setPadSeq((s) => s + 1); };
  const closePad = () => setPad(null);
  // 현재 패드가 가리키는 목표비중 기록(라이브 조회) — 없으면 위 effect가 패드를 닫는다.
  const padRec = pad && pad.kind === 'rebalTarget'
    ? (Array.isArray(memos[pad.dayKey]) ? memos[pad.dayKey] : []).find((m) => m && m.id === pad.memoId)
    : null;

  const savePad = () => {
    // 목표비중 기록은 읽기 전용 — 저장 경로에 진입시키지 않는다(pad.val 자체가 없음).
    if (!pad || pad.kind === 'rebalTarget' || !onUpdateMemos) { setPad(null); return; }
    const { dayKey, mode, memoId, val } = pad;
    const next = { ...memos };
    // ⚠️ Array.isArray 가드 — 손상된 Drive 값이 비순회 truthy면 `[...x]`가 TypeError를 던진다
    const arr = Array.isArray(next[dayKey]) ? [...next[dayKey]] : [];
    if (mode === 'new') {
      if (!val.trim()) { setPad(null); return; } // 빈 메모는 생성 안 함
      arr.push({ id: generateId(), content: val, createdAt: Date.now() });
    } else {
      const idx = arr.findIndex((m) => m.id === memoId);
      if (idx === -1) { setPad(null); return; }
      if (!val.trim()) arr.splice(idx, 1); // 편집 후 비면 삭제
      else arr[idx] = { ...arr[idx], content: val };
    }
    if (arr.length) next[dayKey] = arr; else delete next[dayKey];
    onUpdateMemos(next);
    setPad(null);
  };

  // 즉시 삭제 — 셀에서 바로 사라지는 것이 피드백(RebalancingPanel deleteNote와 동일 패턴).
  const deleteMemo = (dayKey, memoId) => {
    if (!onUpdateMemos) return;
    const next = { ...memos };
    const arr = (Array.isArray(next[dayKey]) ? next[dayKey] : []).filter((m) => m && m.id !== memoId);
    if (arr.length) next[dayKey] = arr; else delete next[dayKey];
    onUpdateMemos(next);
  };

  // 해당 날짜 이전(포함) 가장 최근 지표값 (비거래일은 직전 거래일 값 이월).
  const resolveOnOrBefore = (map, keys, dateKey) => {
    if (!map) return null;
    if (map[dateKey] != null) return map[dateKey];
    let res = null;
    for (let j = 0; j < keys.length; j++) {
      if (keys[j] <= dateKey) res = map[keys[j]]; else break;
    }
    return res;
  };

  return (
    <>
      {/* 달력 창 (비차단·이동 가능 플로팅) */}
      <div
        ref={winRef}
        style={{ position: 'fixed', left: winPos.x, top: winPos.y, zIndex: CAL_Z, width: CAL_W, maxWidth: 'calc(100vw - 24px)', maxHeight: '92vh', background: BG.card }}
        className="rounded-2xl shadow-2xl border border-gray-600/60 flex flex-col overflow-hidden"
      >
        {/* 헤더 (드래그 핸들) */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0 cursor-move select-none"
          style={{ touchAction: 'none' }}
          onMouseDown={(e) => startDrag('win', e.clientX, e.clientY)}
          onTouchStart={(e) => startDrag('win', e.touches[0].clientX, e.touches[0].clientY)}
        >
          <div className="flex items-center gap-2">
            <CalIcon size={16} className="text-sky-400" />
            <span className="text-gray-200 font-semibold text-sm">메모 달력</span>
          </div>
          <div className="flex items-center gap-1">
            <button onMouseDown={(e) => e.stopPropagation()} onClick={gotoPrev} title="이전 달" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition">
              <ChevronLeft size={18} />
            </button>
            <span className="text-gray-200 font-semibold text-sm w-[104px] text-center tabular-nums select-none">
              {viewYear}년 {viewMonth + 1}월
            </span>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={gotoNext} title="다음 달" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition">
              <ChevronRight size={18} />
            </button>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={gotoToday} className="ml-2 px-2.5 py-1 rounded-md text-[12px] border border-gray-700 text-gray-300 hover:bg-gray-800 transition">
              오늘
            </button>
          </div>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} title="닫기" className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition">
            <X size={16} />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-3 overflow-y-auto">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-l border-t border-gray-800/60">
            {WD.map((w, i) => (
              <div
                key={w}
                className={`text-center text-[11px] font-semibold py-1.5 border-r border-b border-gray-800/60 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`}
              >
                {w}
              </div>
            ))}
          </div>
          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 border-l border-gray-800/60">
            {Array.from({ length: totalCells }).map((_, i) => {
              const dayNum = i - firstDow + 1;
              const valid = dayNum >= 1 && dayNum <= daysInMonth;
              const dow = i % 7;
              if (!valid) {
                return <div key={i} className="border-r border-b border-gray-800/60 bg-black/20" style={{ minHeight: '130px' }} />;
              }
              const key = dayKeyOf(viewYear, viewMonth, dayNum);
              const isToday = key === todayStr;
              const isHol = krHol.includes(key);
              // 목표비중 자동 기록은 **사용자 메모 목록(50px)과 분리**해 전용 행에 렌더한다.
              // 같은 accountType 계좌끼리 settings.targetDate를 공유하므로 하루에 계좌별 기록이
              // 여러 건 쌓이는 것이 기본 시나리오인데, 50px에는 칩이 2.5개만 보여 사용자 메모가
              // 밀려난다. 칸 크기를 키우는 것은 규약상 금지(CLAUDE.md)이므로 분리로 해결.
              const dayAll = Array.isArray(memos[key]) ? memos[key] : [];
              const dayRebals = dayAll.filter((m) => m && m.kind === 'rebalTarget');
              const dayMemos = dayAll.filter((m) => m && m.kind !== 'rebalTarget');
              const numColor = isHol || dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-300';
              const rawMetric = metricsByDate[key];
              const metricCum = rawMetric ? ((key === latestRecDate && todayReturnRate != null) ? todayReturnRate : rawMetric.monthlyChange) : null;
              return (
                <div
                  key={i}
                  onClick={() => openNew(key)}
                  title="클릭하여 메모 추가"
                  className="border-r border-b border-gray-800/60 p-1 flex flex-col gap-0.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
                  style={{ minHeight: '130px' }}
                >
                  <div className="flex items-center justify-between shrink-0 px-0.5">
                    <span
                      className={`text-[12px] font-semibold leading-none ${isToday ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center' : numColor}`}
                    >
                      {dayNum}
                    </span>
                    {dayMemos.length > 0 && <span className="text-[9px] text-gray-600 tabular-nums">{dayMemos.length}</span>}
                  </div>
                  {rawMetric && (
                    <div className="shrink-0 px-0.5 leading-none">
                      <div className="text-[10px] font-semibold text-gray-200 tabular-nums truncate">{fmtAbbrev(rawMetric.evalAmount)}</div>
                      {rawMetric.dodAbsChange != null && (
                        <div className={`text-[9px] tabular-nums truncate mt-[1px] ${pnlColor(rawMetric.dodAbsChange)}`}>
                          {fmtAbbrev(rawMetric.dodAbsChange)} {fmtPct(rawMetric.dodChange)}
                        </div>
                      )}
                      <div className={`text-[9px] tabular-nums truncate mt-[1px] ${pnlColor(metricCum)}`}>
                        누적 {fmtPct(metricCum)}
                      </div>
                    </div>
                  )}
                  {dayRebals.length > 0 && (
                    <div className="flex gap-0.5 shrink-0 overflow-x-auto">
                      {dayRebals.map((m) => (
                        <button
                          key={m.id}
                          onClick={(e) => { e.stopPropagation(); openRebal(key, m); }}
                          title={m.content}
                          className="flex items-center rounded px-1 py-0.5 bg-emerald-500/15 hover:bg-emerald-500/30 transition-colors shrink-0 max-w-full"
                        >
                          {/* ⚠️ 상수 접두('목표비중 ·') 금지 — 셀 텍스트 가용폭이 ≈100px(한글 10자)뿐이라
                              유일한 식별 정보인 계좌명이 truncate로 사라진다. 종류는 색+아이콘으로 인코딩. */}
                          <span className="text-[10px] text-emerald-200 truncate leading-tight">📊 {m.accountName || '계좌'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: '50px' }}>
                    {dayMemos.map((m) => (
                      <div
                        key={m.id}
                        onClick={(e) => { e.stopPropagation(); openEdit(key, m); }}
                        title={m.content}
                        className="group/memo flex items-center gap-1 rounded px-1 py-0.5 bg-sky-500/15 hover:bg-sky-500/25 transition-colors"
                      >
                        <span className="flex-1 text-[10px] text-sky-200 truncate leading-tight">
                          {firstLine(m.content) || <span className="text-gray-500 italic">내용 없음</span>}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMemo(key, m.id); }}
                          title="삭제"
                          className="opacity-0 group-hover/memo:opacity-100 text-gray-500 hover:text-red-400 shrink-0 transition-opacity"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 메모 패드 (비차단·이동 가능 플로팅 — 사진 형식) */}
      {pad && (
        <div
          ref={padRef}
          className="fixed shadow-2xl overflow-hidden rounded-lg"
          style={{ left: padPos.x, top: padPos.y, zIndex: PAD_Z, width: PAD_W, maxWidth: 'calc(100vw - 16px)' }}
        >
          {/* 헤더 (드래그 핸들) */}
          <div
            className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none"
            style={{ touchAction: 'none' }}
            onMouseDown={(e) => startDrag('pad', e.clientX, e.clientY)}
            onTouchStart={(e) => startDrag('pad', e.touches[0].clientX, e.touches[0].clientY)}
          >
            <div className="flex items-center gap-3">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={closePad}
                className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all"
                title="취소 (Esc)"
              >
                <X size={10} className="text-white" />
              </button>
              {pad.kind !== 'rebalTarget' && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={savePad}
                  className="w-[18px] h-[18px] rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center transition-all"
                  title="저장 (Ctrl+Enter)"
                >
                  <Check size={10} className="text-white" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <CalIcon size={13} className="text-gray-500" />
              <span className="text-[13px] text-gray-400 font-mono">{pad.dayKey}</span>
              <span className="text-[15px] font-bold tracking-[0.25em] bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-400 bg-clip-text text-transparent select-none">
                {pad.kind === 'rebalTarget' ? 'TARGET' : 'MEMO'}
              </span>
            </div>
            <div className="w-10" />
          </div>
          {/* 포트폴리오 스냅샷 (그 날짜 기준) — 기록 있는 날만 표시 */}
          {(() => {
            const raw = metricsByDate[pad.dayKey];
            if (!raw) return null;
            const isT = pad.dayKey === latestRecDate;
            const cum = (isT && todayReturnRate != null) ? todayReturnRate : raw.monthlyChange;
            const fx = (isT && liveFx != null) ? liveFx : resolveOnOrBefore(fxHistory, fxKeys, pad.dayKey);
            const y10 = (isT && liveUs10y != null) ? liveUs10y : resolveOnOrBefore(us10yHistory, us10yKeys, pad.dayKey);
            return (
              <div className="bg-black px-3 py-1.5 border-b border-gray-900 text-center select-none leading-snug">
                <span className="text-[11px] font-semibold tabular-nums text-gray-300">
                  총자산: <span className="text-gray-100">{nfmt(raw.evalAmount)}</span>
                  {' / '}수익: {raw.dodAbsChange != null
                    ? <span className={pnlColor(raw.dodAbsChange)}>{raw.dodAbsChange < 0 ? '-' : ''}₩{nfmt(Math.abs(raw.dodAbsChange))}({fmtPct(raw.dodChange)})</span>
                    : <span className="text-gray-500">-</span>}
                  {' / '}수익율: <span className={pnlColor(cum)}>{fmtPct(cum)}</span>
                  {' / '}환율 :<span className="text-gray-100">{fx != null ? String(Math.round(fx)) : '-'}</span>
                  {' / '}US10Y : <span className="text-gray-100">{y10 != null ? y10.toFixed(2) + '%' : '-'}</span>
                </span>
              </div>
            );
          })()}
          {/* 목표비중 기록 = 읽기 전용 표 (리밸런싱 표의 목표비중·예상 주식수·예상평가금 스냅샷) */}
          {pad.kind === 'rebalTarget' ? (padRec ? (
            <div className="bg-black px-3 py-2 overflow-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-emerald-300 text-[13px] font-bold truncate">📊 {padRec.accountName || '계좌'}</span>
                <span className="text-[10px] text-gray-500 shrink-0">
                  {padRec.targetMode === 'variable' ? '수시변경' : '고정'} · {padRec.investMode === 'rebalance' ? '리밸런싱' : '적립식'}
                  {/* 기록 시각 — 이 기록이 걸린 날짜(목표 날짜)와 실제 기록 시점은 다를 수 있다 */}
                  {padRec.updatedAt ? ` · ${new Date(padRec.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 기록` : ''}
                </span>
              </div>
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left font-normal py-1 pr-1">종목명</th>
                    <th className="text-right font-normal py-1 px-1">목표</th>
                    <th className="text-right font-normal py-1 px-1">현재수량</th>
                    <th className="text-right font-normal py-1 px-1">이후수량</th>
                    <th className="text-right font-normal py-1 pl-1">리밸런싱 후 평가금액</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(padRec.rows) ? padRec.rows : []).map((r, i) => (
                    <tr key={i} className="border-b border-gray-900/80">
                      <td className="text-left text-gray-200 py-1 pr-1">
                        {i + 1}. {r.name}
                        {r.code ? <span className="ml-1 text-[9px] text-gray-600 font-mono">{r.code}</span> : null}
                      </td>
                      <td className="text-right text-green-400 py-1 px-1">{Number(r.targetRatio || 0).toFixed(2)}%</td>
                      <td className="text-right text-gray-400 py-1 px-1">{r.curQty == null ? '-' : qfmt(r.curQty)}</td>
                      <td className="text-right text-blue-300 py-1 px-1">{r.expQty == null ? '-' : qfmt(r.expQty)}</td>
                      <td className="text-right text-yellow-500 py-1 pl-1">{fmtMoney(r.expEval, padRec.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t border-gray-700">
                    <td className="text-left text-gray-400 py-1.5 pr-1">합계</td>
                    <td className="text-right text-green-400 py-1.5 px-1">{Number(padRec.totalTargetRatio || 0).toFixed(2)}%</td>
                    <td className="py-1.5 px-1" />
                    <td className="py-1.5 px-1" />
                    <td className="text-right text-yellow-500 py-1.5 pl-1">{fmtMoney(padRec.totalExpEval, padRec.currency)}</td>
                  </tr>
                </tfoot>
              </table>
              <div className="flex justify-end pt-2">
                {/* 칩에 휴지통을 넣을 폭이 없어 삭제는 여기로 — 즉시 삭제(창 위에선 confirm이 가려진다) */}
                <button
                  onClick={() => deleteMemo(pad.dayKey, pad.memoId)}
                  className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-red-400 transition-colors"
                  title="이 기록 삭제"
                >
                  <Trash2 size={11} /> 기록 삭제
                </button>
              </div>
            </div>
          ) : null) : (
          /* 줄선 메모 입력 */
          <textarea
            className="w-full text-gray-200 text-[15px] outline-none resize-none caret-sky-400 placeholder-gray-700"
            style={{
              backgroundColor: '#000',
              backgroundImage: `repeating-linear-gradient(transparent 0px, transparent 31px, rgba(99,130,255,0.3) 31px, rgba(99,130,255,0.3) 32px)`,
              backgroundSize: '100% 32px',
              backgroundPosition: '0 8px',
              lineHeight: '32px',
              padding: '8px 10px',
              // 세로 2배(rows 28)라도 패드 전체가 화면을 넘지 않도록 상한 — 초과분은 내부 스크롤
              maxHeight: 'calc(100vh - 160px)',
            }}
            rows={28}
            autoFocus
            placeholder="메모를 입력하세요..."
            value={pad.val ?? ''}
            onChange={(e) => setPad((prev) => ({ ...prev, val: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); closePad(); }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') savePad();
            }}
          />
          )}
        </div>
      )}
    </>
  );
}
