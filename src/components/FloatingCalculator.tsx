// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Trash2, Delete, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';

const CALC_Z = 1050;

const fmt = (n) => {
  if (isNaN(n) || !isFinite(n)) return '오류';
  return String(parseFloat(n.toPrecision(12)));
};

const fmtDisplay = (s) => {
  if (s === '오류') return s;
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 12 });
};

const factorial = (n) => {
  const ni = Math.round(n);
  if (ni < 0 || ni > 170 || Math.abs(ni - n) > 1e-9) return NaN;
  let r = 1;
  for (let i = 2; i <= ni; i++) r *= i;
  return r;
};

// ───────── 수식 평가 (수식 트리 → 숫자) ─────────
const isContainer = (a) => a.t === 'frac' || a.t === 'sqrt' || a.t === 'func' || a.t === 'pow';
const fieldOrder = (a) =>
  a.t === 'frac' ? ['num', 'den'] : a.t === 'sqrt' ? ['rad'] : a.t === 'func' ? ['arg'] : a.t === 'pow' ? ['exp'] : [];
const isEmptyContainer = (a) => isContainer(a) && fieldOrder(a).every((f) => a[f].length === 0);

const FUNCS = {
  sin: (x, deg) => Math.sin(deg ? (x * Math.PI) / 180 : x),
  cos: (x, deg) => Math.cos(deg ? (x * Math.PI) / 180 : x),
  tan: (x, deg) => Math.tan(deg ? (x * Math.PI) / 180 : x),
  asin: (x, deg) => { const r = Math.asin(x); return deg ? (r * 180) / Math.PI : r; },
  acos: (x, deg) => { const r = Math.acos(x); return deg ? (r * 180) / Math.PI : r; },
  atan: (x, deg) => { const r = Math.atan(x); return deg ? (r * 180) / Math.PI : r; },
  log: (x) => Math.log10(x),
  ln: (x) => Math.log(x),
  fact: (x) => factorial(x),
};

const PREC = { '^': 4, '×': 3, '÷': 3, '+': 2, '−': 2 };
const RIGHT_ASSOC = { '^': true };

const binop = (a, b, op) => {
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return a * b;
  if (op === '÷') { if (b === 0) throw new Error('div0'); return a / b; }
  if (op === '^') return Math.pow(a, b);
  throw new Error('op');
};

// seq(원자 배열) 평가. 실패 시 throw → 호출부에서 '오류' 처리
function evalSeq(seq, ctx) {
  const tokens = [];
  let numStr = '';
  const flush = () => {
    if (numStr !== '') {
      const v = parseFloat(numStr);
      if (isNaN(v)) throw new Error('num');
      tokens.push({ k: 'num', v });
      numStr = '';
    }
  };
  for (const a of seq) {
    if (a.t === 'd') { numStr += a.v; continue; }
    flush();
    if (a.t === 'op') tokens.push({ k: 'op', op: a.v });
    else if (a.t === 'lp') tokens.push({ k: 'lp' });
    else if (a.t === 'rp') tokens.push({ k: 'rp' });
    else if (a.t === 'const') tokens.push({ k: 'num', v: a.v === 'π' ? Math.PI : Math.E });
    else if (a.t === 'ans') { if (ctx.ans == null) throw new Error('ans'); tokens.push({ k: 'num', v: ctx.ans }); }
    else if (a.t === 'frac') tokens.push({ k: 'num', v: binop(evalSeq(a.num, ctx), evalSeq(a.den, ctx), '÷') });
    else if (a.t === 'sqrt') tokens.push({ k: 'num', v: Math.sqrt(evalSeq(a.rad, ctx)) });
    else if (a.t === 'func') tokens.push({ k: 'num', v: FUNCS[a.name](evalSeq(a.arg, ctx), ctx.deg) });
    else if (a.t === 'pow') { tokens.push({ k: 'op', op: '^' }); tokens.push({ k: 'num', v: evalSeq(a.exp, ctx) }); }
  }
  flush();
  if (tokens.length === 0) throw new Error('empty');

  // 암묵적 곱셈 + 단항 마이너스(0 − x)
  const t2 = [];
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i];
    const prev = t2[t2.length - 1];
    if (prev && (prev.k === 'num' || prev.k === 'rp') && (cur.k === 'num' || cur.k === 'lp')) t2.push({ k: 'op', op: '×' });
    if (cur.k === 'op' && cur.op === '−' && (!prev || prev.k === 'op' || prev.k === 'lp')) t2.push({ k: 'num', v: 0 });
    t2.push(cur);
  }

  // 션팅야드 → RPN
  const out = [], ops = [];
  for (const tk of t2) {
    if (tk.k === 'num') { if (isNaN(tk.v) || !isFinite(tk.v)) throw new Error('nan'); out.push(tk.v); }
    else if (tk.k === 'op') {
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top === '(') break;
        if (PREC[top] > PREC[tk.op] || (PREC[top] === PREC[tk.op] && !RIGHT_ASSOC[tk.op])) out.push(ops.pop());
        else break;
      }
      ops.push(tk.op);
    } else if (tk.k === 'lp') ops.push('(');
    else if (tk.k === 'rp') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
      if (ops[ops.length - 1] !== '(') throw new Error('paren');
      ops.pop();
    }
  }
  while (ops.length) { const o = ops.pop(); if (o === '(') throw new Error('paren'); out.push(o); }

  const st = [];
  for (const x of out) {
    if (typeof x === 'number') st.push(x);
    else { const b = st.pop(), a = st.pop(); if (a === undefined || b === undefined) throw new Error('rpn'); st.push(binop(a, b, x)); }
  }
  if (st.length !== 1) throw new Error('rpn2');
  const r = st[0];
  if (isNaN(r) || !isFinite(r)) throw new Error('result');
  return r;
}

// 이력 표시용 1차원 문자열
const serializeSeq = (seq) => seq.map(serializeAtom).join('');
const serializeAtom = (a) => {
  if (a.t === 'd' || a.t === 'op' || a.t === 'const') return a.v;
  if (a.t === 'lp') return '(';
  if (a.t === 'rp') return ')';
  if (a.t === 'ans') return 'Ans';
  if (a.t === 'frac') return `(${serializeSeq(a.num)})/(${serializeSeq(a.den)})`;
  if (a.t === 'sqrt') return `√(${serializeSeq(a.rad)})`;
  if (a.t === 'pow') return `^(${serializeSeq(a.exp)})`;
  if (a.t === 'func') return `${a.name === 'fact' ? '!' : a.name}(${serializeSeq(a.arg)})`;
  return '';
};

// 결과 숫자 문자열 → 입력 원자 배열 (이력 클릭 시 재삽입용)
const strToAtoms = (s) => s.split('').map((c) => (c === '-' ? { t: 'op', v: '−' } : { t: 'd', v: c }));

// ───────── 트리 경로 헬퍼 ─────────
const pathKey = (p) => p.map((s) => s.i + s.f).join('/');
const getSeq = (root, path) => {
  let seq = root;
  for (const s of path) {
    if (!seq || !seq[s.i] || !(s.f in seq[s.i])) return null;
    seq = seq[s.i][s.f];
  }
  return seq;
};
const setSeq = (root, path, newSeq) => {
  if (path.length === 0) return newSeq;
  const [step, ...rest] = path;
  const copy = root.slice();
  copy[step.i] = { ...copy[step.i], [step.f]: setSeq(copy[step.i][step.f], rest, newSeq) };
  return copy;
};

const Caret = () => (
  <span className="inline-block w-[2px] self-stretch bg-orange-400 animate-pulse mx-[1px]" style={{ minHeight: '1.05em' }} />
);

export default function FloatingCalculator({ isOpen, onClose }) {
  const [root, setRoot] = useState([]);                       // 수식 트리(원자 배열)
  const [cursor, setCursor] = useState({ path: [], idx: 0 }); // 커서 위치
  const [result, setResult] = useState(null);                 // '=' 결과 문자열 | null
  const [history, setHistory] = useState([]);
  const [lastAns, setLastAns] = useState(null);
  const [pos, setPos] = useState(() => ({
    x: Math.max(10, Math.round((window.innerWidth - 300) / 2)),
    y: 70,
  }));
  const [isScientific, setIsScientific] = useState(false);
  const [isDeg, setIsDeg] = useState(true);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const rootRef = useRef(null);

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
        x: Math.max(0, Math.min(window.innerWidth - (rootRef.current?.offsetWidth || 300), cx - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - (rootRef.current?.offsetHeight || 330), cy - dragOffset.current.y)),
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

  // 열 때마다 화면 중앙으로 재배치
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => {
      const w = rootRef.current?.offsetWidth || 300;
      const h = rootRef.current?.offsetHeight || 480;
      setPos({
        x: Math.max(10, Math.round((window.innerWidth - w) / 2)),
        y: Math.max(20, Math.round((window.innerHeight - h) / 2)),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // 높이 변경 시 화면 안으로 위치 보정
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => {
      const w = rootRef.current?.offsetWidth || 300;
      const h = rootRef.current?.offsetHeight || 330;
      setPos((p) => ({
        x: Math.max(0, Math.min(window.innerWidth - w, p.x)),
        y: Math.max(0, Math.min(window.innerHeight - h, p.y)),
      }));
    });
    return () => cancelAnimationFrame(id);
  }, [isScientific, history.length === 0, result == null]);

  // 트리 변경으로 커서 경로가 무효화되면 안전 위치로 복구 (UI 크래시 방지)
  useEffect(() => {
    let seq = root, ok = true;
    for (const s of cursor.path) {
      if (!seq || !seq[s.i] || !(s.f in seq[s.i])) { ok = false; break; }
      seq = seq[s.i][s.f];
    }
    if (ok && (cursor.idx < 0 || cursor.idx > seq.length)) ok = false;
    if (!ok) setCursor({ path: [], idx: root.length });
  }, [root, cursor]);

  // ───────── 편집 동작 ─────────
  const insertAtom = (atom, descend) => {
    setResult(null);
    const seq = getSeq(root, cursor.path);
    if (seq == null) { setCursor({ path: [], idx: root.length }); return; }
    const newSeq = [...seq.slice(0, cursor.idx), atom, ...seq.slice(cursor.idx)];
    setRoot(setSeq(root, cursor.path, newSeq));
    if (descend) setCursor({ path: [...cursor.path, { i: cursor.idx, f: descend }], idx: 0 });
    else setCursor({ path: cursor.path, idx: cursor.idx + 1 });
  };

  const insertChar = (ch) => {
    if (ch === '.') {
      // 같은 숫자 런에 소수점이 이미 있으면 무시 (1.5.2 같은 중복 방지)
      const seq = getSeq(root, cursor.path);
      if (seq) {
        for (let l = cursor.idx - 1; l >= 0 && seq[l].t === 'd'; l--) if (seq[l].v === '.') return;
        for (let r = cursor.idx; r < seq.length && seq[r].t === 'd'; r++) if (seq[r].v === '.') return;
      }
    }
    insertAtom({ t: 'd', v: ch });
  };
  const insertOp = (op) => insertAtom({ t: 'op', v: op });
  const insertFrac = () => insertAtom({ t: 'frac', num: [], den: [] }, 'num');
  const insertSqrt = () => insertAtom({ t: 'sqrt', rad: [] }, 'rad');
  const insertPow = () => insertAtom({ t: 'pow', exp: [] }, 'exp');
  const insertSquare = () => insertAtom({ t: 'pow', exp: [{ t: 'd', v: '2' }] });
  const insertCube = () => insertAtom({ t: 'pow', exp: [{ t: 'd', v: '3' }] });
  const insertRecip = () => insertAtom({ t: 'frac', num: [{ t: 'd', v: '1' }], den: [] }, 'den');
  const insertFunc = (name) => insertAtom({ t: 'func', name, arg: [] }, 'arg');
  const insertConst = (v) => insertAtom({ t: 'const', v });
  const insertAns = () => { if (lastAns != null) insertAtom({ t: 'ans' }); };

  const del = () => {
    setResult(null);
    const seq = getSeq(root, cursor.path);
    if (seq == null) { setCursor({ path: [], idx: root.length }); return; }
    if (cursor.idx > 0) {
      const prev = seq[cursor.idx - 1];
      if (isContainer(prev) && !isEmptyContainer(prev)) {
        const order = fieldOrder(prev);
        const f = order[order.length - 1];
        setCursor({ path: [...cursor.path, { i: cursor.idx - 1, f }], idx: prev[f].length });
        return;
      }
      const newSeq = [...seq.slice(0, cursor.idx - 1), ...seq.slice(cursor.idx)];
      setRoot(setSeq(root, cursor.path, newSeq));
      setCursor({ path: cursor.path, idx: cursor.idx - 1 });
      return;
    }
    if (cursor.path.length > 0) {
      const parentPath = cursor.path.slice(0, -1);
      const last = cursor.path[cursor.path.length - 1];
      const ps = getSeq(root, parentPath);
      const container = ps && ps[last.i];
      if (!container) { setCursor({ path: [], idx: root.length }); return; }
      if (isEmptyContainer(container)) {
        const newSeq = [...ps.slice(0, last.i), ...ps.slice(last.i + 1)];
        setRoot(setSeq(root, parentPath, newSeq));
        setCursor({ path: parentPath, idx: last.i });
      } else {
        setCursor({ path: parentPath, idx: last.i });
      }
    }
  };

  const clearAll = () => { setRoot([]); setCursor({ path: [], idx: 0 }); setResult(null); };

  const moveRight = () => {
    const seq = getSeq(root, cursor.path);
    if (seq == null) { setCursor({ path: [], idx: root.length }); return; }
    if (cursor.idx < seq.length) {
      const atom = seq[cursor.idx];
      if (isContainer(atom)) { setCursor({ path: [...cursor.path, { i: cursor.idx, f: fieldOrder(atom)[0] }], idx: 0 }); return; }
      setCursor({ path: cursor.path, idx: cursor.idx + 1 });
      return;
    }
    if (cursor.path.length > 0) {
      const last = cursor.path[cursor.path.length - 1];
      const parentPath = cursor.path.slice(0, -1);
      const ps = getSeq(root, parentPath);
      const container = ps && ps[last.i];
      if (!container) { setCursor({ path: parentPath, idx: 0 }); return; }
      const order = fieldOrder(container);
      const fi = order.indexOf(last.f);
      if (fi < order.length - 1) setCursor({ path: [...parentPath, { i: last.i, f: order[fi + 1] }], idx: 0 });
      else setCursor({ path: parentPath, idx: last.i + 1 });
    }
  };

  const moveLeft = () => {
    const seq = getSeq(root, cursor.path);
    if (seq == null) { setCursor({ path: [], idx: root.length }); return; }
    if (cursor.idx > 0) {
      const atom = seq[cursor.idx - 1];
      if (isContainer(atom)) { const order = fieldOrder(atom); const f = order[order.length - 1]; setCursor({ path: [...cursor.path, { i: cursor.idx - 1, f }], idx: atom[f].length }); return; }
      setCursor({ path: cursor.path, idx: cursor.idx - 1 });
      return;
    }
    if (cursor.path.length > 0) {
      const last = cursor.path[cursor.path.length - 1];
      const parentPath = cursor.path.slice(0, -1);
      const ps = getSeq(root, parentPath);
      const container = ps && ps[last.i];
      if (!container) { setCursor({ path: parentPath, idx: 0 }); return; }
      const order = fieldOrder(container);
      const fi = order.indexOf(last.f);
      if (fi > 0) { const pf = order[fi - 1]; setCursor({ path: [...parentPath, { i: last.i, f: pf }], idx: container[pf].length }); }
      else setCursor({ path: parentPath, idx: last.i });
    }
  };

  const moveUp = () => {
    if (cursor.path.length === 0) return;
    const last = cursor.path[cursor.path.length - 1];
    if (last.f !== 'den') return;
    const parentPath = cursor.path.slice(0, -1);
    const ps = getSeq(root, parentPath);
    const container = ps && ps[last.i];
    if (!container) return;
    setCursor({ path: [...parentPath, { i: last.i, f: 'num' }], idx: Math.min(cursor.idx, container.num.length) });
  };

  const moveDown = () => {
    if (cursor.path.length === 0) return;
    const last = cursor.path[cursor.path.length - 1];
    if (last.f !== 'num') return;
    const parentPath = cursor.path.slice(0, -1);
    const ps = getSeq(root, parentPath);
    const container = ps && ps[last.i];
    if (!container) return;
    setCursor({ path: [...parentPath, { i: last.i, f: 'den' }], idx: Math.min(cursor.idx, container.den.length) });
  };

  const onEquals = () => {
    let val;
    try { val = evalSeq(root, { deg: isDeg, ans: lastAns }); }
    catch { setResult('오류'); return; }
    const resStr = fmt(val);
    setResult(resStr);
    if (resStr !== '오류') setLastAns(val);
    setHistory((prev) => [{ expr: serializeSeq(root), result: resStr }, ...prev].slice(0, 50));
  };

  const loadFromHistory = (resStr) => {
    if (resStr === '오류') return;
    setRoot(strToAtoms(resStr));
    setCursor({ path: [], idx: strToAtoms(resStr).length });
    setResult(null);
  };

  // 키보드 입력
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); insertChar(e.key); }
      else if (e.key === '.' || e.key === ',') { e.preventDefault(); insertChar('.'); }
      else if (e.key === '+') { e.preventDefault(); insertOp('+'); }
      else if (e.key === '-') { e.preventDefault(); insertOp('−'); }
      else if (e.key === '*') { e.preventDefault(); insertOp('×'); }
      else if (e.key === '/') { e.preventDefault(); insertOp('÷'); }
      else if (e.key === '(') { e.preventDefault(); insertAtom({ t: 'lp' }); }
      else if (e.key === ')') { e.preventDefault(); insertAtom({ t: 'rp' }); }
      else if (e.key === '^') { e.preventDefault(); insertPow(); }
      else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); onEquals(); }
      else if (e.key === 'Backspace') { e.preventDefault(); del(); }
      else if (e.key === 'Escape') { e.preventDefault(); clearAll(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); moveRight(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); moveLeft(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveUp(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveDown(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, root, cursor, isDeg, lastAns]);

  if (!isOpen) return null;

  // ───────── 2D 렌더 ─────────
  const renderSeq = (seq, path) => {
    const here = pathKey(path) === pathKey(cursor.path);
    const nodes = [];
    for (let i = 0; i < seq.length; i++) {
      if (here && cursor.idx === i) nodes.push(<Caret key={'c' + i} />);
      nodes.push(<span key={'a' + i} className="inline-flex items-center">{renderAtom(seq[i], path, i)}</span>);
    }
    if (here && cursor.idx === seq.length) nodes.push(<Caret key="cend" />);
    if (seq.length === 0) nodes.push(<span key="ph" className="text-gray-600 px-0.5">▯</span>);
    return <span className="inline-flex items-center">{nodes}</span>;
  };

  const renderAtom = (a, path, i) => {
    if (a.t === 'd') return <span>{a.v}</span>;
    if (a.t === 'op') return <span className="mx-1 text-gray-200">{a.v}</span>;
    if (a.t === 'const') return <span>{a.v}</span>;
    if (a.t === 'ans') return <span className="text-sky-300">Ans</span>;
    if (a.t === 'lp') return <span className="mx-px text-gray-300">(</span>;
    if (a.t === 'rp') return <span className="mx-px text-gray-300">)</span>;
    if (a.t === 'frac')
      return (
        <span className="inline-flex flex-col items-center mx-0.5 text-[0.86em] leading-none">
          <span className="px-1 pb-0.5">{renderSeq(a.num, [...path, { i, f: 'num' }])}</span>
          <span className="self-stretch border-t border-gray-200" />
          <span className="px-1 pt-0.5">{renderSeq(a.den, [...path, { i, f: 'den' }])}</span>
        </span>
      );
    if (a.t === 'sqrt')
      return (
        <span className="inline-flex items-stretch mx-0.5">
          <span className="self-end leading-none text-[1.1em] -mr-0.5">√</span>
          <span className="border-t border-gray-200 px-1 pt-0.5">{renderSeq(a.rad, [...path, { i, f: 'rad' }])}</span>
        </span>
      );
    if (a.t === 'pow')
      return (
        <span className="inline-flex items-start self-start text-[0.7em] -ml-0.5 -mt-2">
          {renderSeq(a.exp, [...path, { i, f: 'exp' }])}
        </span>
      );
    if (a.t === 'func')
      return (
        <span className="inline-flex items-center mx-0.5">
          <span>{a.name === 'fact' ? '' : a.name}(</span>
          {renderSeq(a.arg, [...path, { i, f: 'arg' }])}
          <span>){a.name === 'fact' ? '!' : ''}</span>
        </span>
      );
    return null;
  };

  const btnCls = (extra) =>
    `flex items-center justify-center rounded-xl h-[54px] text-[20px] font-medium select-none transition-all active:scale-95 focus:outline-none ${extra}`;
  const navCls = (extra) =>
    `flex items-center justify-center rounded-lg h-9 select-none transition-all active:scale-90 focus:outline-none ${extra}`;
  const sciCls = (extra) =>
    `flex items-center justify-center rounded-lg h-9 text-[12px] font-medium select-none transition-all active:scale-90 focus:outline-none ${extra}`;

  const sciRows = [
    [
      { label: 'sin', on: () => insertFunc('sin') },
      { label: 'cos', on: () => insertFunc('cos') },
      { label: 'tan', on: () => insertFunc('tan') },
      { label: 'asin', on: () => insertFunc('asin') },
      { label: 'acos', on: () => insertFunc('acos') },
    ],
    [
      { label: 'atan', on: () => insertFunc('atan') },
      { label: 'log', on: () => insertFunc('log') },
      { label: 'ln', on: () => insertFunc('ln') },
      { label: '√', on: insertSqrt },
      { label: 'x²', on: insertSquare },
    ],
    [
      { label: 'xⁿ', on: insertPow },
      { label: 'x³', on: insertCube },
      { label: '1/x', on: insertRecip },
      { label: 'n!', on: () => insertFunc('fact') },
      { label: 'π', on: () => insertConst('π') },
    ],
  ];

  return (
    <div
      ref={rootRef}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: CALC_Z, width: 300, maxHeight: '94vh', touchAction: 'none' }}
      className="rounded-2xl shadow-2xl overflow-y-auto border border-gray-600/60 bg-black"
    >
      {/* 타이틀 바 */}
      <div
        className="flex items-center justify-between bg-gray-900 px-3 py-2 cursor-move border-b border-gray-700/40 select-none sticky top-0 z-10"
        onMouseDown={(e) => { onDragStart(e.clientX, e.clientY); e.preventDefault(); }}
        onTouchStart={(e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
      >
        <span className="text-gray-200 text-sm font-semibold">🧮 공학용 계산기</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsDeg((v) => !v)}
            title="각도 단위 전환 (DEG=도 / RAD=라디안)"
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
              isDeg ? 'text-sky-300 border-sky-600/50 bg-sky-900/20 hover:bg-sky-900/40'
                    : 'text-violet-300 border-violet-600/50 bg-violet-900/20 hover:bg-violet-900/40'
            }`}
          >
            {isDeg ? 'DEG' : 'RAD'}
          </button>
          <button
            onClick={() => setIsScientific((v) => !v)}
            title="함수 키패드 표시 전환"
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
              isScientific ? 'text-orange-300 border-orange-600/50 bg-orange-900/20 hover:bg-orange-900/40'
                           : 'text-gray-400 border-gray-600/50 hover:text-gray-200 hover:border-gray-500 hover:bg-gray-800/50'
            }`}
          >
            함수
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 디스플레이: 위=수식(2D), 아래=결과 */}
      <div className="bg-black px-4 pt-3 pb-2">
        <div className="text-white text-[1.45rem] leading-tight overflow-x-auto min-h-[3rem] flex items-center">
          <span className="inline-flex items-center">{renderSeq(root, [])}</span>
        </div>
        <div className="text-right text-2xl text-orange-300 font-light h-9 mt-1 overflow-x-auto whitespace-nowrap">
          {result != null ? (result === '오류' ? '오류' : `= ${fmtDisplay(result)}`) : ''}
        </div>
      </div>

      {/* 함수 키패드 */}
      {isScientific && (
        <div className="bg-gray-950 px-3 pb-2 pt-1.5 border-y border-gray-800/60 space-y-1.5">
          {sciRows.map((row, ri) => (
            <div key={ri} className="grid grid-cols-5 gap-1.5">
              {row.map((b, bi) => (
                <button key={bi} onClick={b.on} className={sciCls('bg-gray-800 hover:bg-gray-700 text-sky-200 hover:text-white')}>
                  {b.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 기본 키패드 */}
      <div className="bg-black px-3 pb-3 pt-2.5 space-y-2">
        {/* 커서 이동 + 괄호 */}
        <div className="grid grid-cols-6 gap-1.5">
          <button onClick={moveLeft} title="왼쪽" className={navCls('bg-gray-800 hover:bg-gray-700 text-gray-200')}><ArrowLeft size={16} /></button>
          <button onClick={moveRight} title="오른쪽" className={navCls('bg-gray-800 hover:bg-gray-700 text-gray-200')}><ArrowRight size={16} /></button>
          <button onClick={moveUp} title="위(분자)" className={navCls('bg-gray-800 hover:bg-gray-700 text-gray-200')}><ArrowUp size={16} /></button>
          <button onClick={moveDown} title="아래(분모)" className={navCls('bg-gray-800 hover:bg-gray-700 text-gray-200')}><ArrowDown size={16} /></button>
          <button onClick={() => insertAtom({ t: 'lp' })} className={navCls('bg-gray-800 hover:bg-gray-700 text-gray-200 text-lg')}>(</button>
          <button onClick={() => insertAtom({ t: 'rp' })} className={navCls('bg-gray-800 hover:bg-gray-700 text-gray-200 text-lg')}>)</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={clearAll} className={btnCls('bg-gray-400 hover:bg-gray-300 text-black')}>AC</button>
          <button onClick={del} title="한 글자 지우기" className={btnCls('bg-gray-400 hover:bg-gray-300 text-black')}><Delete size={20} /></button>
          <button onClick={insertFrac} title="분수 a/b" className={btnCls('bg-teal-700 hover:bg-teal-600 text-white text-[18px]')}>a/b</button>
          <button onClick={() => insertOp('÷')} className={btnCls('bg-orange-500 hover:bg-orange-400 text-white')}>÷</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => insertChar('7')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>7</button>
          <button onClick={() => insertChar('8')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>8</button>
          <button onClick={() => insertChar('9')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>9</button>
          <button onClick={() => insertOp('×')} className={btnCls('bg-orange-500 hover:bg-orange-400 text-white')}>×</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => insertChar('4')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>4</button>
          <button onClick={() => insertChar('5')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>5</button>
          <button onClick={() => insertChar('6')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>6</button>
          <button onClick={() => insertOp('−')} className={btnCls('bg-orange-500 hover:bg-orange-400 text-white')}>−</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => insertChar('1')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>1</button>
          <button onClick={() => insertChar('2')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>2</button>
          <button onClick={() => insertChar('3')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>3</button>
          <button onClick={() => insertOp('+')} className={btnCls('bg-orange-500 hover:bg-orange-400 text-white')}>+</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={insertAns} title="직전 결과값" className={btnCls(`bg-gray-600 hover:bg-gray-500 text-white text-[17px] ${lastAns == null ? 'opacity-40' : ''}`)}>Ans</button>
          <button onClick={() => insertChar('0')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>0</button>
          <button onClick={() => insertChar('.')} className={btnCls('bg-gray-700 hover:bg-gray-600 text-white')}>.</button>
          <button onClick={onEquals} className={btnCls('bg-orange-500 hover:bg-orange-400 text-white')}>=</button>
        </div>
      </div>

      {/* 계산 이력 */}
      {history.length > 0 && (
        <div className="bg-gray-900 border-t border-gray-700/50">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-gray-400 text-xs font-medium">계산 이력</span>
            <button onClick={() => setHistory([])} className="text-gray-500 hover:text-red-400 transition-colors flex items-center gap-1 text-xs">
              <Trash2 size={11} /> 전체 삭제
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto px-3 pb-2 space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex justify-between items-center gap-2 text-xs">
                <span className="text-gray-500 truncate shrink">{h.expr} =</span>
                <span
                  className="text-white font-mono shrink-0 cursor-pointer hover:text-orange-300 transition-colors"
                  onClick={() => loadFromHistory(h.result)}
                  title="클릭하면 결과값을 수식에 입력"
                >
                  {h.result === '오류' ? '오류' : fmtDisplay(h.result)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
