// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Trash2 } from 'lucide-react';

const CALC_Z = 1050;

const fmt = (n) => {
  if (!isFinite(n)) return '오류';
  return String(parseFloat(n.toPrecision(10)));
};

const fmtDisplay = (s) => {
  if (s === '오류') return s;
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  if (s.endsWith('.') || (s.includes('.') && s.endsWith('0'))) return s;
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 10 });
};

const compute = (a, b, op) => {
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return a * b;
  if (op === '÷') return b !== 0 ? a / b : NaN;
  return b;
};

export default function FloatingCalculator({ isOpen, onClose }) {
  const [display, setDisplay] = useState('0');
  const [pendingOp, setPendingOp] = useState(null);
  const [pendingVal, setPendingVal] = useState(null);
  const [justEvaled, setJustEvaled] = useState(false);
  const [history, setHistory] = useState([]);
  const [pos, setPos] = useState({ x: Math.max(10, window.innerWidth - 330), y: 90 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

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

  const applyOp = (op) => {
    if (display === '오류') return;
    const val = parseFloat(display);
    if (pendingOp && !justEvaled) {
      const res = compute(pendingVal, val, pendingOp);
      setDisplay(fmt(res));
      setPendingVal(isFinite(res) ? res : val);
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

  if (!isOpen) return null;

  const btnCls = (extra) =>
    `flex items-center justify-center rounded-full h-[62px] text-[22px] font-medium select-none transition-all active:scale-95 focus:outline-none ${extra}`;

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: CALC_Z, width: 296, touchAction: 'none' }}
      className="rounded-2xl shadow-2xl overflow-hidden border border-gray-600/60"
    >
      {/* 타이틀 바 (드래그 핸들) */}
      <div
        className="flex items-center justify-between bg-gray-900 px-3 py-2 cursor-move border-b border-gray-700/40 select-none"
        onMouseDown={(e) => { onDragStart(e.clientX, e.clientY); e.preventDefault(); }}
        onTouchStart={(e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
      >
        <span className="text-gray-200 text-sm font-semibold">🧮 계산기</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* 디스플레이 */}
      <div className="bg-black px-4 pt-2 pb-3">
        <div className="text-gray-500 text-xs h-5 text-right truncate">
          {pendingOp != null ? `${fmtDisplay(fmt(pendingVal))} ${pendingOp}` : ' '}
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

      {/* 버튼 영역 */}
      <div className="bg-black px-3 pb-3 space-y-2">
        {/* Row 1 */}
        <div className="grid grid-cols-4 gap-2">
          <button onClick={clear} className={btnCls('bg-gray-400 hover:bg-gray-300 text-black')}>AC</button>
          <button onClick={toggleSign} className={btnCls('bg-gray-400 hover:bg-gray-300 text-black')}>+/-</button>
          <button onClick={percent} className={btnCls('bg-gray-400 hover:bg-gray-300 text-black')}>%</button>
          <button onClick={() => applyOp('÷')} className={btnCls(`bg-orange-500 hover:bg-orange-400 text-white ${pendingOp === '÷' && justEvaled ? 'ring-2 ring-white/50' : ''}`)}>÷</button>
        </div>
        {/* Row 2 */}
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => inputDigit('7')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>7</button>
          <button onClick={() => inputDigit('8')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>8</button>
          <button onClick={() => inputDigit('9')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>9</button>
          <button onClick={() => applyOp('×')} className={btnCls(`bg-orange-500 hover:bg-orange-400 text-white ${pendingOp === '×' && justEvaled ? 'ring-2 ring-white/50' : ''}`)}>×</button>
        </div>
        {/* Row 3 */}
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => inputDigit('4')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>4</button>
          <button onClick={() => inputDigit('5')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>5</button>
          <button onClick={() => inputDigit('6')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>6</button>
          <button onClick={() => applyOp('−')} className={btnCls(`bg-orange-500 hover:bg-orange-400 text-white ${pendingOp === '−' && justEvaled ? 'ring-2 ring-white/50' : ''}`)}>−</button>
        </div>
        {/* Row 4 */}
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => inputDigit('1')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>1</button>
          <button onClick={() => inputDigit('2')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>2</button>
          <button onClick={() => inputDigit('3')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>3</button>
          <button onClick={() => applyOp('+')} className={btnCls(`bg-orange-500 hover:bg-orange-400 text-white ${pendingOp === '+' && justEvaled ? 'ring-2 ring-white/50' : ''}`)}>+</button>
        </div>
        {/* Row 5 — 0 버튼 넓게 */}
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
