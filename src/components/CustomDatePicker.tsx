// @ts-nocheck
import React from 'react';
import { createPortal } from 'react-dom';

const DAYS = ['일','월','화','수','목','금','토'];
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const POPUP_W = 220;

/**
 * 날짜 선택기.
 *
 * ⚠️ `allowedDates`·`zIndex`·`followScroll`은 **선택 인자**다. 넘기지 않으면 렌더 결과·좌표·
 *    이벤트가 종전과 같다(기존 사용처 6곳의 하위호환 축). 배열을 넘기면 **그 목록의 날짜만**
 *    고를 수 있고 나머지 날짜·달·연도는 흐리게 잠긴다.
 * ⚠️ 빈 배열은 '전부 잠금'이다(제약 없음 아님) — 조용한 오적용보다 명시적 미적용.
 *
 * ⚠️ **포털은 z 문제를 자동으로 해결해 주지 않는다 — 오히려 호스트가 높으면 뒤집는다.**
 *    포털 전에는 팝업이 호스트의 **자손**이라 호스트가 만든 스태킹 컨텍스트 *안에서* 위로 떴다
 *    (호스트 z가 아무리 높아도 항상 그 위). 포털 후에는 `document.body`의 **형제**가 되어
 *    호스트와 직접 z를 겨룬다 → `zIndex`가 호스트보다 낮으면 **호스트 패널이 그대로 덮어
 *    "클릭해도 아무 일도 안 일어난다"** 가 된다(실제 사고: `Z.dialog`(1000) 모달 안에서 기본값
 *    999로 떠 자산검증 비교일이 통째로 선택 불가). **z ≥ 999인 컨테이너 안에서 쓰면 `zIndex`를
 *    반드시 그보다 크게 넘길 것**(모달이면 `Z.dialogPopover`). `verify:compare #G34`가 강제한다.
 *
 * 아래 셋은 **인자와 무관하게** 고쳐진 결함이라 6곳 모두에 적용된다(전부 '없던 게 생기거나
 * 틀린 게 맞아지는' 방향이다):
 *  1. 팝업을 `document.body`로 **포털**한다 — 그러지 않으면 조상의 `overflow`·`isolate`·스태킹
 *     컨텍스트에 갇혀 잘리거나 페이지 콘텐츠 아래로 깔린다(표 래퍼의 `isolate`가 그 예).
 *     옛 네이티브 `<select>` 드롭다운은 브라우저 top layer라 이런 제약이 없었다.
 *  2. 아래로 펼치면 화면을 넘치는 자리에서 **위로 뒤집는다**(높이는 하드코딩이 아니라 실측).
 *     종전에는 무조건 아래로 펼쳐 통째로 잘렸다.
 *  3. 위젯 안의 키 입력이 `window`로 새지 않게 막는다 — 열려 있는 계산기의 전역 keydown이
 *     Enter를 `preventDefault`로 삼켜 **버튼이 활성화되지 않는다**(그 가드는 input/textarea/
 *     select만 통과시키므로 `<button>`은 무방비다). Escape로 닫기도 여기서 처리한다.
 */
export default function CustomDatePicker({
  value, onChange, placeholder = '--/--/--', trigger = null, align = 'center',
  allowedDates = null, zIndex = 999, followScroll = false,
}) {
  const [open, setOpen] = React.useState(false);
  const [viewYear, setViewYear] = React.useState(() => value ? parseInt(value.slice(0,4)) : new Date().getFullYear());
  const [viewMonth, setViewMonth] = React.useState(() => value ? parseInt(value.slice(5,7)) - 1 : new Date().getMonth());
  const [yearPickMode, setYearPickMode] = React.useState(false);
  const [monthPickMode, setMonthPickMode] = React.useState(false);
  const [yearRangeStart, setYearRangeStart] = React.useState(() => {
    const y = value ? parseInt(value.slice(0,4)) : new Date().getFullYear();
    return Math.floor(y / 12) * 12;
  });
  const [popupPos, setPopupPos] = React.useState({ top: 0, left: 0 });
  const ref = React.useRef(null);       // 트리거(앵커)
  const popupRef = React.useRef(null);  // 포털된 팝업 — ref의 자손이 **아니다**

  // 선택 가능 집합. `null`이면 제약 없음(= 기존 동작).
  const allowed = React.useMemo(
    () => (Array.isArray(allowedDates) ? new Set(allowedDates.filter(Boolean)) : null),
    [allowedDates],
  );
  const pad2 = (n) => String(n).padStart(2, '0');
  // ⚠️ 날짜 키는 직접 조립한다 — `new Date(y,m,d).toISOString()`은 UTC로 변환돼 하루 밀린다.
  const keyOf = (y, m0, d) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
  const dayAllowed = (y, m0, d) => !allowed || allowed.has(keyOf(y, m0, d));
  const monthAllowed = (y, m0) => {
    if (!allowed) return true;
    const p = `${y}-${pad2(m0 + 1)}`;
    for (const s of allowed) if (s.slice(0, 7) === p) return true;
    return false;
  };
  const yearAllowed = (y) => {
    if (!allowed) return true;
    const p = String(y);
    for (const s of allowed) if (s.slice(0, 4) === p) return true;
    return false;
  };

  /**
   * 앵커 rect → 팝업 좌표. 세로는 **실측한 팝업 높이**로만 뒤집는다(측정 전에는 종전대로 아래).
   * 하드코딩 높이를 쓰면 실제로는 들어가는 자리에서도 위로 뒤집혀 기존 사용처가 달라진다.
   */
  const placeAt = React.useCallback((rect) => {
    let left = align === 'right' ? rect.right - POPUP_W
      : align === 'left' ? rect.left
        : rect.left + rect.width / 2 - POPUP_W / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - POPUP_W - 4));
    const h = popupRef.current ? popupRef.current.offsetHeight : 0;
    let top = rect.bottom + 4;
    if (h && top + h > window.innerHeight - 4) {
      const above = rect.top - 4 - h;
      top = above >= 4 ? above : Math.max(4, window.innerHeight - h - 4);
    }
    return { top, left };
  }, [align]);

  const focusTrigger = () => {
    const el = ref.current && ref.current.querySelector('button, [tabindex]');
    if (el && el.focus) el.focus();
  };
  // ⚠️ 포커스 되돌리기는 **키보드로 닫을 때만**(Escape·날짜 선택) — 바깥을 클릭해 닫는 경우까지
  //    포커스를 뺏으면 사용자가 방금 누른 곳에서 포커스가 달아난다.
  const closePicker = (restoreFocus) => { setOpen(false); if (restoreFocus) focusTrigger(); };

  // 바깥 클릭으로 닫기. ⚠️ 팝업은 포털이라 `ref.contains`로는 '안'으로 판정되지 않는다 —
  //    `popupRef`를 함께 보지 않으면 팝업을 클릭하는 순간 닫힌다.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const t = e.target;
      if (ref.current && ref.current.contains(t)) return;
      if (popupRef.current && popupRef.current.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 팝업은 `position: fixed`라 여는 순간의 좌표에 고정된다 — 스크롤되는 컨테이너(모달 본문 등)
  // 안에서 열면 배경만 움직여 팝업이 엉뚱한 자리에 떠 있게 된다.
  // ⚠️ **닫지 말고 다시 붙인다** — 팝업에는 자체 스크롤 영역이 없어 그 위에서 굴린 휠이 그대로
  //    배경으로 체이닝되므로, 닫아 버리면 '보면서 살짝 스크롤'하는 흔한 동작에 매번 사라진다.
  //    앵커가 화면 밖으로 나갔을 때만 닫는다(따라갈 곳이 없다).
  // ⚠️ capture=true 필수: scroll 이벤트는 버블하지 않아 내부 스크롤 컨테이너를 놓친다.
  React.useEffect(() => {
    if (!open || !followScroll) return;
    const onMove = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }
      const next = placeAt(rect);
      setPopupPos(p => (Math.abs(p.top - next.top) < 0.5 && Math.abs(p.left - next.left) < 0.5 ? p : next));
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, followScroll, placeAt]);

  // 실측 보정 — 그리드 모드가 바뀌면 높이도 바뀌므로 그때마다 다시 잰다.
  // ⚠️ 값이 실제로 달라질 때만 setState(무한 루프 방지).
  React.useLayoutEffect(() => {
    if (!open || !popupRef.current || !ref.current) return;
    const next = placeAt(ref.current.getBoundingClientRect());
    setPopupPos(p => (Math.abs(p.top - next.top) < 0.5 && Math.abs(p.left - next.left) < 0.5 ? p : next));
  }, [open, yearPickMode, monthPickMode, viewYear, viewMonth, placeAt]);

  const openPicker = () => {
    // 값이 없을 때 제약이 있으면 **선택 가능한 가장 최근 날짜**의 달에서 시작한다(빈 달이 열려
    // "고를 수 있는 날이 하나도 없네"로 보이는 것 방지).
    // ⚠️ 현재 유일한 `allowedDates` 호출부는 값이 항상 채워져 있어 이 분기를 밟지 않는다 —
    //    새 호출부를 붙일 때 처음 실행되는 코드라는 뜻이니 그때 직접 확인할 것.
    const src = value || (allowed && allowed.size ? [...allowed].sort().slice(-1)[0] : '');
    const y = src ? parseInt(src.slice(0,4)) : new Date().getFullYear();
    const m = src ? parseInt(src.slice(5,7)) - 1 : new Date().getMonth();
    setViewYear(y); setViewMonth(m);
    setYearRangeStart(Math.floor(y / 12) * 12);
    setYearPickMode(false);
    setMonthPickMode(false);
    if (ref.current) setPopupPos(placeAt(ref.current.getBoundingClientRect()));
    setOpen(true);
  };

  // ⚠️ 토글이어야 한다 — 항상 `setOpen(true)`면 키보드로는 닫을 방법이 없다(옛 `<select>`는
  //    Escape로 닫혔다). 마우스는 백드롭이 받으므로 이 경로는 키보드 전용이다.
  const togglePicker = () => { if (open) closePicker(true); else openPicker(); };

  /**
   * ⚠️ 위젯 밖으로 키 입력을 흘리지 않는다. 열려 있는 `FloatingCalculator`의 window keydown이
   *    `input|textarea|select`만 통과시키므로 `<button>`인 트리거·일자 셀은 Enter를 통째로
   *    빼앗긴다(preventDefault → 버튼이 활성화되지 않고 계산기 수식만 평가된다).
   *    `stopPropagation`은 기본 동작(Enter→click)을 막지 않으므로 버튼은 정상 동작한다.
   */
  const handleKeyDownCapture = (e) => {
    if (open && e.key === 'Escape') { e.preventDefault(); closePicker(true); }
    e.stopPropagation();
  };

  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const firstDow = (y, m) => new Date(y, m, 1).getDay();

  const selectDay = (d) => {
    if (!dayAllowed(viewYear, viewMonth, d)) return; // 잠긴 날짜는 커밋하지 않는다
    onChange(keyOf(viewYear, viewMonth, d));
    closePicker(true);
  };

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11); } else setViewMonth(m => m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0); } else setViewMonth(m => m+1); };

  const selDay = value ? parseInt(value.slice(8,10)) : null;
  const selMonth = value ? parseInt(value.slice(5,7)) - 1 : null;
  const selYear = value ? parseInt(value.slice(0,4)) : null;

  const totalCells = Math.ceil((firstDow(viewYear, viewMonth) + daysInMonth(viewYear, viewMonth)) / 7) * 7;

  const displayText = value ? value.substring(2).replace(/-/g, '/') : placeholder;

  const handleLeftArrow = () => {
    if (yearPickMode) setYearRangeStart(s => s - 12);
    else if (monthPickMode) setViewYear(y => y - 1);
    else prevMonth();
  };

  const handleRightArrow = () => {
    if (yearPickMode) setYearRangeStart(s => s + 12);
    else if (monthPickMode) setViewYear(y => y + 1);
    else nextMonth();
  };

  /**
   * ⚠️ 포털된 팝업도 이벤트는 **React 트리**를 따라 올라간다(DOM 트리가 아니다) — 호스트 모달의
   *    닫기 핸들러가 그대로 발화한다. 백드롭·본체가 **세 제스처를 전부** 흡수하지 않으면 날짜를
   *    고르거나 달력을 닫으려는 동작이 **호스트를 통째로 닫아** 버린다. 셋 다 실재하는 경로다:
   *      · `VerifyEvalModal` 루트 = `onMouseDown`/`onTouchStart`로 닫는다 → 마우스로 날짜 밖을
   *        누르면 자산검증 모달이 사라지고, 터치로는 날짜를 **누르는 순간** 사라진다.
   *      · `PortfolioTable` 적립 모달 루트 = `onClick`으로 닫는다 → 달력을 닫으려다 모달째 닫힌다.
   *    하나라도 빼면 그 제스처만 조용히 새어 나간다.
   */
  const swallow = (e) => e.stopPropagation();
  const popup = !open ? null : (
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: zIndex - 1 }}
        onMouseDown={swallow}
        onTouchStart={swallow}
        onClick={e => { e.stopPropagation(); setOpen(false); }}
      />
      <div
        ref={popupRef}
        className="fixed bg-gray-900 border border-gray-600 rounded-lg shadow-2xl p-3 w-[220px]"
        style={{ top: popupPos.top, left: popupPos.left, zIndex }}
        onMouseDown={swallow}
        onTouchStart={swallow}
        onClick={swallow}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <button onClick={handleLeftArrow}
            className="text-gray-400 hover:text-white hover:bg-gray-700 rounded px-1.5 py-0.5 text-sm transition-colors">‹</button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (yearPickMode) {
                  setYearPickMode(false);
                  setMonthPickMode(false);
                } else {
                  setYearPickMode(true);
                  setMonthPickMode(false);
                  setYearRangeStart(Math.floor(viewYear/12)*12);
                }
              }}
              className="text-blue-300 hover:text-blue-100 font-bold text-sm px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors"
            >{viewYear}년</button>
            {!yearPickMode && (
              <button
                onClick={() => {
                  if (monthPickMode) {
                    setMonthPickMode(false);
                  } else {
                    setMonthPickMode(true);
                    setYearPickMode(false);
                  }
                }}
                className="text-gray-300 hover:text-white text-xs font-bold px-1 py-0.5 rounded hover:bg-gray-700 transition-colors"
              >{MONTHS[viewMonth]}</button>
            )}
          </div>
          <button onClick={handleRightArrow}
            className="text-gray-400 hover:text-white hover:bg-gray-700 rounded px-1.5 py-0.5 text-sm transition-colors">›</button>
        </div>

        {yearPickMode ? (
          <div className="grid grid-cols-3 gap-1">
            {Array.from({length:12}, (_,i) => yearRangeStart + i).map(y => {
              const okY = yearAllowed(y);
              // ⚠️ 파란 칩은 **고른 연도**(selYear)다 — 종전처럼 `viewYear`를 칠하면 탐색만 해도
              //    '선택됨'으로 보여 거짓 표시가 된다. 보고 있는 연도는 링으로만 표시한다.
              return (
                <button key={y} disabled={!okY}
                  onClick={() => { if (!okY) return; setViewYear(y); setYearPickMode(false); setMonthPickMode(true); }}
                  className={`py-1.5 rounded text-xs font-bold transition-colors
                    ${!okY ? 'text-gray-600 cursor-not-allowed'
                      : y === selYear ? 'bg-blue-600 text-white'
                        : y === viewYear ? 'ring-1 ring-blue-500/60 text-gray-200 hover:bg-gray-700'
                          : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}>
                  {y}
                </button>
              );
            })}
          </div>
        ) : monthPickMode ? (
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((name, mi) => {
              const okM = monthAllowed(viewYear, mi);
              return (
                <button key={mi} disabled={!okM}
                  onClick={() => { if (!okM) return; setViewMonth(mi); setMonthPickMode(false); }}
                  className={`py-1.5 rounded text-xs font-bold transition-colors
                    ${!okM ? 'text-gray-600 cursor-not-allowed'
                      : mi === selMonth && viewYear === selYear ? 'bg-blue-600 text-white'
                        : mi === viewMonth ? 'ring-1 ring-blue-500/60 text-gray-200 hover:bg-gray-700'
                          : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}>
                  {name}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map((d,i) => (
                <span key={d} className={`text-center text-[10px] font-bold py-0.5
                  ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-500'}`}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {Array.from({length: totalCells}, (_,i) => {
                const dayNum = i - firstDow(viewYear, viewMonth) + 1;
                const valid = dayNum >= 1 && dayNum <= daysInMonth(viewYear, viewMonth);
                const isSelected = valid && dayNum === selDay && viewMonth === selMonth && viewYear === selYear;
                const dow = i % 7;
                // 제약이 있으면 목록에 없는 날짜는 흐리게 잠근다(클릭·커밋 모두 무시).
                // ⚠️ 강조(`font-bold`)는 **제약이 있을 때만** — 없을 때 붙이면 기존 사용처에서
                //    모든 날짜가 굵어져 선택일과 구분이 흐려진다.
                const pick = valid && dayAllowed(viewYear, viewMonth, dayNum);
                return (
                  <button key={i} disabled={!pick}
                    onClick={() => pick && selectDay(dayNum)}
                    className={`text-center text-[11px] py-1 rounded transition-colors
                      ${!valid ? 'invisible' : ''}
                      ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                      ${valid && !isSelected && !pick ? 'text-gray-600 cursor-not-allowed' : ''}
                      ${pick && !isSelected ? (dow===0?'text-red-400':dow===6?'text-blue-400':'text-gray-300') : ''}
                      ${pick && !isSelected ? (allowed ? 'hover:bg-gray-700 font-bold' : 'hover:bg-gray-700') : ''}`}>
                    {valid ? dayNum : ''}
                  </button>
                );
              })}
            </div>
            {/* ⚠️ 잠금 사유는 여기 **상시 문구**로만 알린다 — `disabled` 버튼의 `title`은
                Chromium·WebKit이 툴팁을 띄우지 않아(마우스 이벤트를 안 받는다) 죽은 안내가 된다. */}
            {allowed && (
              <div className="mt-2 pt-1.5 border-t border-gray-700/60 text-[9px] text-gray-500 leading-snug">
                {monthAllowed(viewYear, viewMonth)
                  ? '진하게 표시된 날짜만 고를 수 있습니다.'
                  : '이 달에는 고를 수 있는 날짜가 없습니다 — 위의 연/월 버튼으로 이동하세요.'}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="relative" ref={ref} onKeyDownCapture={handleKeyDownCapture}>
      {trigger
        ? React.cloneElement(trigger, { onClick: togglePicker })
        : (
          <span
            onClick={togglePicker}
            className="text-gray-300 text-xs font-bold font-mono px-1 w-[68px] text-center cursor-pointer hover:text-white select-none block"
          >
            {displayText}
          </span>
        )
      }
      {/* ⚠️ 포털해도 React 이벤트는 **컴포넌트 트리**를 따라 전파되므로 위의 keydown 가드와
          상위 모달의 `stopPropagation`이 그대로 적용된다(DOM 트리 기준이 아니다). */}
      {open && typeof document !== 'undefined' && createPortal(popup, document.body)}
    </div>
  );
}
