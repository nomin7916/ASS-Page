// @ts-nocheck
import React from 'react';

const DAYS = ['일','월','화','수','목','금','토'];
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

export default function CustomDatePicker({ value, onChange, placeholder = '--/--/--', trigger = null, align = 'center' }) {
  const [open, setOpen] = React.useState(false);
  const [viewYear, setViewYear] = React.useState(() => value ? parseInt(value.slice(0,4)) : new Date().getFullYear());
  const [viewMonth, setViewMonth] = React.useState(() => value ? parseInt(value.slice(5,7)) - 1 : new Date().getMonth());
  const [yearPickMode, setYearPickMode] = React.useState(false);
  const [monthPickMode, setMonthPickMode] = React.useState(false);
  const [yearRangeStart, setYearRangeStart] = React.useState(() => {
    const y = value ? parseInt(value.slice(0,4)) : new Date().getFullYear();
    return Math.floor(y / 12) * 12;
  });
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const openPicker = () => {
    const y = value ? parseInt(value.slice(0,4)) : new Date().getFullYear();
    const m = value ? parseInt(value.slice(5,7)) - 1 : new Date().getMonth();
    setViewYear(y); setViewMonth(m);
    setYearRangeStart(Math.floor(y / 12) * 12);
    setYearPickMode(false);
    setMonthPickMode(false);
    setOpen(true);
  };

  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const firstDow = (y, m) => new Date(y, m, 1).getDay();

  const selectDay = (d) => {
    const mm = String(viewMonth + 1).padStart(2,'0');
    const dd = String(d).padStart(2,'0');
    onChange(`${viewYear}-${mm}-${dd}`);
    setOpen(false);
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

  const popupAlign = align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';

  return (
    <div className="relative" ref={ref}>
      {trigger
        ? React.cloneElement(trigger, { onClick: openPicker })
        : (
          <span
            onClick={openPicker}
            className="text-gray-300 text-xs font-bold font-mono px-1 w-[68px] text-center cursor-pointer hover:text-white select-none block"
          >
            {displayText}
          </span>
        )
      }
      {open && (
        <div className={`absolute top-8 z-50 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl p-3 w-[220px] ${popupAlign}`}
          onMouseDown={e => e.stopPropagation()}>
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
              {Array.from({length:12}, (_,i) => yearRangeStart + i).map(y => (
                <button key={y}
                  onClick={() => { setViewYear(y); setYearPickMode(false); setMonthPickMode(true); }}
                  className={`py-1.5 rounded text-xs font-bold transition-colors
                    ${y === viewYear ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}>
                  {y}
                </button>
              ))}
            </div>
          ) : monthPickMode ? (
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((name, mi) => (
                <button key={mi}
                  onClick={() => { setViewMonth(mi); setMonthPickMode(false); }}
                  className={`py-1.5 rounded text-xs font-bold transition-colors
                    ${mi === viewMonth && viewYear === selYear ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}>
                  {name}
                </button>
              ))}
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
                  return (
                    <button key={i}
                      onClick={() => valid && selectDay(dayNum)}
                      className={`text-center text-[11px] py-1 rounded transition-colors
                        ${!valid ? 'invisible' : ''}
                        ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                        ${valid && !isSelected ? (dow===0?'text-red-400':dow===6?'text-blue-400':'text-gray-300') : ''}
                        ${valid && !isSelected ? 'hover:bg-gray-700' : ''}`}>
                      {valid ? dayNum : ''}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
