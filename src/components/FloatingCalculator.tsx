// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Trash2 } from 'lucide-react';

const CALC_Z = 1050;

const fmt = (n) => {
  if (isNaN(n) || !isFinite(n)) return '오류';
  return String(parseFloat(n.toPrecision(10)));
};

const fmtDisplay = (s) => {
  if (s === '오류') return s;
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  if (s.endsWith('.') || (s.includes('.') && s.endsWith('0'))) return s;
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 10 });
};

const factorial = (n) => {
  const ni = Math.round(n);
  if (ni < 0 || ni > 170 || !Number.isFinite(ni)) return NaN;
  if (ni <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= ni; i++) r *= i;
  return r;
};

const compute = (a, b, op) => {
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return a * b;
  if (op === '÷') return b !== 0 ? a / b : NaN;
  if (op === 'xⁿ') return Math.pow(a, b);
  return b;
};

export default function FloatingCalculator({ isOpen, onClose }) {
  const [display, setDisplay] = useState('0');
  const [pendingOp, setPendingOp] = useState(null);
  const [pendingVal, setPendingVal] = useState(null);
  const [justEvaled, setJustEvaled] = useState(false);
  const [history, setHistory] = useState([]);
  const [pos, setPos] = useState({ x: Math.max(10, window.innerWidth - 330), y: 90 });
  const [isScientific, setIsScientific] = useState(false);
  const [isDeg, setIsDeg] = useState(true);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const toRad = (n) => isDeg ? n * Math.PI / 180 : n;
  const fromRad = (n) => isDeg ? n * 180 / Math.PI : n;

  const onDragStart = useCallback((cx, cy) => {
    dragging.current = true;
    dragOffset.current = { x: cx - pos.x, y: cy - pos.y };
  }, [pos]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 296, cx - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 80, cy - dragOffset.current.y)),
      });
    };
    const onEnd = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  const inputDigit = (d) => {
    if (display === '오류') { setDisplay(String(d)); setJustEvaled(false); return; }
    if (justEvaled) { setDisplay(String(d)); setJustEvaled(false); }
    else setDisplay(prev => prev === '0' ? String(d) : prev.length < 15 ? prev + d : prev);
  };

  const inputDot = () => {
    if (display === '오류') { setDisplay('0.'); setJustEvaled(false); return; }
    if (justEvaled) { setDisplay('0.'); setJustEvaled(false); return; }
    if (!display.includes('.')) setDisplay(prev => prev + '.');
  };

  const handleBackspace = () => {
    if (display === '오류' || justEvaled) { setDisplay('0'); setJustEvaled(false); return; }
    setDisplay(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
  };

  const clear = () => {
    setDisplay('0'); setPendingOp(null); setPendingVal(null); setJustEvaled(false);
  };

  const toggleSign = () => {
    const n = parseFloat(display);
    if (!isNaN(n)) setDisplay(fmt(-n));
  };

  const percent = () => {
    const n = parseFloat(display);
    if (!isNaN(n)) setDisplay(fmt(n / 100));
  };

  const applyUnary = (fn) => {
    if (display === '오류') return;
    const n = parseFloat(display);
    if (isNaN(n)) return;
    let result;
    try { result = fn(n); } catch { result = NaN; }
    setDisplay(isFinite(result) && !isNaN(result) ? fmt(result) : '오류');
    setJustEvaled(true);
  };

  const applyOp = (op) => {
    if (display === '오류') return;
    const val = parseFloat(display);
    if (pendingOp && !justEvaled) {
      const res = compute(pendingVal, val, pendingOp);
      setDisplay(fmt(res));
      setPendingVal(isFinite(res) && !isNaN(res) ? res : val);
    } else {
      setPendingVal(val);
    }
    setPendingOp(op);
    setJustEvaled(true);
  };

  const evaluate = () => {
    if (pendingOp === null || display === '오류') return;
    const b = parseFloat(display);
    const res = compute(pendingVal, b, pendingOp);
    const resStr = fmt(res);
    const exprStr = `${fmt(pendingVal)} ${pendingOp} ${fmt(b)}`;
    setHistory(prev => [{ expr: exprStr, result: resStr }, ...prev].slice(0, 50));
    setDisplay(resStr);
    setPendingOp(null);
    setPendingVal(null);
    setJustEvaled(true);
  };

  const insertConstant = (val) => {
    setDisplay(fmt(val));
    setJustEvaled(true);
  };

  // 키보드 입력 핸들러
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      // 텍스트 입력 중일 때는 무시
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;

      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); inputDigit(e.key); }
      else if (e.key === '.' || e.key === ',') { e.preventDefault(); inputDot(); }
      else if (e.key === '+') { e.preventDefault(); applyOp('+'); }
      else if (e.key === '-') { e.preventDefault(); applyOp('−'); }
      else if (e.key === '*') { e.preventDefault(); applyOp('×'); }
      else if (e.key === '/') { e.preventDefault(); applyOp('÷'); }
      else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); evaluate(); }
      else if (e.key === 'Backspace') { e.preventDefault(); handleBackspace(); }
      else if (e.key === 'Escape') { e.preventDefault(); clear(); }
      else if (e.key === '%') { e.preventDefault(); percent(); }
      else if (e.key === '^') { e.preventDefault(); if (isScientific) applyOp('xⁿ'); }
      // 공학용 단축키 (Ctrl/Meta 없을 때만)
      else if (isScientific && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 's') { e.preventDefault(); applyUnary(n => Math.sin(toRad(n))); }
        else if (e.key === 'c') { e.preventDefault(); applyUnary(n => Math.cos(toRad(n))); }
        else if (e.key === 't') { e.preventDefault(); applyUnary(n => Math.tan(toRad(n))); }
        else if (e.key === 'l') { e.preventDefault(); applyUnary(Math.log); }
        else if (e.key === 'L') { e.preventDefault(); applyUnary(Math.log10); }
        else if (e.key === 'r') { e.preventDefault(); applyUnary(Math.sqrt); }
        else if (e.key === 'p') { e.preventDefault(); insertConstant(Math.PI); }
        else if (e.key === 'q') { e.preventDefault(); applyUnary(n => n * n); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, display, pendingOp, pendingVal, justEvaled, isScientific, isDeg]);

  if (!isOpen) return null;

  const btnCls = (extra) =>
    `flex items-center justify-center rounded-full h-[62px] text-[22px] font-medium select-none transition-all active:scale-95 focus:outline-none ${extra}`;

  const sciBtnCls = (extra) =>
    `flex items-center justify-center rounded-lg h-9 text-[11px] font-medium select-none transition-all active:scale-90 focus:outline-none ${extra}`;

  const sciRows = [
    [
      { label: 'sin', title: 's', action: () => applyUnary(n => Math.sin(toRad(n))) },
      { label: 'cos', title: 'c', action: () => applyUnary(n => Math.cos(toRad(n))) },
      { label: 'tan', title: 't', action: () => applyUnary(n => Math.tan(toRad(n))) },
      { label: 'asin', action: () => applyUnary(n => fromRad(Math.asin(n))) },
      { label: 'acos', action: () => applyUnary(n => fromRad(Math.acos(n))) },
    ],
    [
      { label: 'atan', action: () => applyUnary(n => fromRad(Math.atan(n))) },
      { label: 'log', title: 'L', action: () => applyUnary(Math.log10) },
      { label: 'ln', title: 'l', action: () => applyUnary(Math.log) },
      { label: '√', title: 'r', action: () => applyUnary(Math.sqrt) },
      { label: 'x²', title: 'q', action: () => applyUnary(n => n * n) },
    ],
    [
      { label: 'xⁿ', title: '^', action: () => applyOp('xⁿ'), isOp: true },
      { label: 'π', title: 'p', action: () => insertConstant(Math.PI) },
      { label: 'e', action: () => insertConstant(Math.E) },
      { label: '1/x', action: () => applyUnary(n => 1 / n) },
      { label: 'n!', action: () => applyUnary(factorial) },
    ],
  ];

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: CALC_Z, width: 296, touchAction: 'none' }}
      className="rounded-2xl shadow-2xl overflow-hidden border border-gray-600/60"
    >
      {/* 타이틀 바 */}
      <div
        className="flex items-center justify-between bg-gray-900 px-3 py-2 cursor-move border-b border-gray-700/40 select-none"
        onMouseDown={(e) => { onDragStart(e.clientX, e.clientY); e.preventDefault(); }}
        onTouchStart={(e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
      >
        <span className="text-gray-200 text-sm font-semibold">🧮 계산기</span>
        <div className="flex items-center gap-1.5">
          {isScientific && (
            <button
              onClick={() => setIsDeg(v => !v)}
              title="각도 단위 전환 (DEG=도 / RAD=라디안)"
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                isDeg
                  ? 'text-sky-300 border-sky-600/50 bg-sky-900/20 hover:bg-sky-900/40'
                  : 'text-violet-300 border-violet-600/50 bg-violet-900/20 hover:bg-violet-900/40'
              }`}
            >
              {isDeg ? 'DEG' : 'RAD'}
            </button>
          )}
          <button
            onClick={() => setIsScientific(v => !v)}
            title="공학용 계산기 전환"
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
              isScientific
                ? 'text-orange-300 border-orange-600/50 bg-orange-900/20 hover:bg-orange-900/40'
                : 'text-gray-400 border-gray-600/50 hover:text-gray-200 hover:border-gray-500 hover:bg-gray-800/50'
            }`}
          >
            공학
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 디스플레이 */}
      <div className="bg-black px-4 pt-2 pb-3">
        <div className="text-gray-500 text-xs h-5 text-right truncate">
          {pendingOp != null ? `${fmtDisplay(fmt(pendingVal))} ${pendingOp}` : ' '}
        </div>
        <div
          className="text-white text-right font-light select-none overflow-hidden"
          style={{
            fontSize: display.length > 12 ? '1.35rem' : display.length > 9 ? '1.9rem' : '2.6rem',
            lineHeight: 1.1,
          }}
        >
          {fmtDisplay(display)}
        </div>
      </div>

      {/* 공학용 버튼 */}
      {isScientific && (
        <div className="bg-gray-950 px-3 pb-2 pt-1.5 border-b border-gray-800/60 space-y-1.5">
          {sciRows.map((row, ri) => (
            <div key={ri} className="grid grid-cols-5 gap-1.5">
              {row.map((btn, bi) => (
                <button
                  key={bi}
                  onClick={btn.action}
                  title={btn.title ? `단축키: ${btn.title}` : undefined}
                  className={sciBtnCls(
                    btn.isOp && pendingOp === 'xⁿ' && justEvaled
                      ? 'bg-orange-900/60 hover:bg-orange-800/60 text-orange-200 ring-1 ring-orange-500/50'
                      : 'bg-gray-800 hover:bg-gray-700 text-sky-200 hover:text-white'
                  )}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          ))}
          {/* 키보드 단축키 힌트 */}
          <div className="text-[9px] text-gray-600 text-right pt-0.5">
            s·c·t·l·L·r·q·p·^ 키 사용 가능
          </div>
        </div>
      )}

      {/* 기본 버튼 */}
      <div className="bg-black px-3 pb-3 pt-3 space-y-2">
        <div className="grid grid-cols-4 gap-2">
          <button onClick={clear} className={btnCls('bg-gray-400 hover:bg-gray-300 text-black')}>AC</button>
          <button onClick={toggleSign} className={btnCls('bg-gray-400 hover:bg-gray-300 text-black')}>+/-</button>
          <button onClick={percent} className={btnCls('bg-gray-400 hover:bg-gray-300 text-black')}>%</button>
          <button onClick={() => applyOp('÷')} className={btnCls(`bg-orange-500 hover:bg-orange-400 text-white ${pendingOp === '÷' && justEvaled ? 'ring-2 ring-white/40' : ''}`)}>÷</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => inputDigit('7')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>7</button>
          <button onClick={() => inputDigit('8')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>8</button>
          <button onClick={() => inputDigit('9')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>9</button>
          <button onClick={() => applyOp('×')} className={btnCls(`bg-orange-500 hover:bg-orange-400 text-white ${pendingOp === '×' && justEvaled ? 'ring-2 ring-white/40' : ''}`)}>×</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => inputDigit('4')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>4</button>
          <button onClick={() => inputDigit('5')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>5</button>
          <button onClick={() => inputDigit('6')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>6</button>
          <button onClick={() => applyOp('−')} className={btnCls(`bg-orange-500 hover:bg-orange-400 text-white ${pendingOp === '−' && justEvaled ? 'ring-2 ring-white/40' : ''}`)}>−</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => inputDigit('1')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>1</button>
          <button onClick={() => inputDigit('2')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>2</button>
          <button onClick={() => inputDigit('3')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>3</button>
          <button onClick={() => applyOp('+')} className={btnCls(`bg-orange-500 hover:bg-orange-400 text-white ${pendingOp === '+' && justEvaled ? 'ring-2 ring-white/40' : ''}`)}>+</button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => inputDigit('0')}
            className="flex items-center justify-start pl-[22px] rounded-full h-[62px] text-[22px] font-medium text-white bg-gray-700 hover:bg-gray-600 select-none transition-all active:scale-95 focus:outline-none flex-1"
          >
            0
          </button>
          <button onClick={inputDot} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white w-[62px] shrink-0')}>.</button>
          <button onClick={evaluate} className={btnCls('bg-orange-500 hover:bg-orange-400 text-white w-[62px] shrink-0')}>=</button>
        </div>
      </div>

      {/* 계산 이력 */}
      {history.length > 0 && (
        <div className="bg-gray-900 border-t border-gray-700/50">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-gray-400 text-xs font-medium">계산 이력</span>
            <button
              onClick={() => setHistory([])}
              className="text-gray-500 hover:text-red-400 transition-colors flex items-center gap-1 text-xs"
            >
              <Trash2 size={11} />
              전체 삭제
            </button>
          </div>
          <div className="max-h-36 overflow-y-auto px-3 pb-2 space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex justify-between items-center gap-2 text-xs">
                <span className="text-gray-500 truncate shrink">{h.expr} =</span>
                <span
                  className="text-white font-mono shrink-0 cursor-pointer hover:text-orange-300 transition-colors"
                  onClick={() => { setDisplay(h.result); setJustEvaled(true); }}
                  title="클릭하면 계산기에 값 입력"
                >
                  {h.result === '오류' ? '오류' : parseFloat(h.result).toLocaleString('ko-KR', { maximumFractionDigits: 10 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
