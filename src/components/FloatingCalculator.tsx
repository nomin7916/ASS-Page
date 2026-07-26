// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Trash2, Delete, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import {
  FX_CURRENCIES, FX_DEFAULT, FX_MIN_SLOTS, FX_MAX_SLOTS,
  convertFx, fxChangePct, fetchFxRates, fxDp, fxName,
  parseFxAmount, formatFxAmount, plainFxAmount, formatFxQuoteTime,
} from '../fxRates';
import {
  BRL_BOND_FACE, BRL_BOND_COUPON, BRL_BOND_YEARS, BRL_COUPONS_PER_YEAR, computeBrlBond,
} from '../brlBond';

const CALC_Z = 1050;
const FX_TTL = 10 * 60 * 1000;

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

// 숫자 런(run)별 천 단위 구분 공백 위치 — 각 원자 인덱스 앞에 공백을 둘지 여부 (정수부만)
const computeGroupSeps = (seq) => {
  const sep = new Array(seq.length).fill(false);
  let i = 0;
  while (i < seq.length) {
    if (seq[i].t !== 'd') { i++; continue; }
    let j = i;
    while (j < seq.length && seq[j].t === 'd') j++;
    let dot = -1;
    for (let k = i; k < j; k++) if (seq[k].v === '.') { dot = k; break; }
    const intLen = (dot === -1 ? j : dot) - i;          // 소수점 이전 정수 자릿수
    for (let p = 1; p < intLen; p++) if ((intLen - p) % 3 === 0) sep[i + p] = true;
    i = j;
  }
  return sep;
};

// 붙여넣기 텍스트에서 숫자 추출 (대시보드 셀의 ₩ / , / % 등 제거, 자릿수 최다 토큰 선택)
const parsePastedNumber = (text) => {
  if (!text) return null;
  // 공백/탭/줄바꿈은 숫자 구분자 — 문자 클래스에 \s를 넣으면 인접 숫자가 한 토큰으로 합쳐짐
  const matches = String(text).match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (!matches) return null;
  let best = null, bestDigits = -1;
  for (const raw of matches) {
    const cleaned = raw.replace(/,/g, '');
    if (!isFinite(parseFloat(cleaned))) continue;
    const digits = (cleaned.match(/\d/g) || []).length;
    if (digits > bestDigits) { best = cleaned; bestDigits = digits; }
  }
  return best;
};

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

export default function FloatingCalculator({
  isOpen,
  onClose,
  fxCurrencies = FX_DEFAULT,
  fxSlotCount = FX_MIN_SLOTS,
  onChangeFx = null,
}) {
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
  // ───────── 환율 패널 ─────────
  const [showFx, setShowFx] = useState(false);
  const [fxRates, setFxRates] = useState({});      // FxRateMap — 메모리 전용(브라우저 저장소·Drive 금지)
  const [fxStatus, setFxStatus] = useState('idle');// idle | loading | ok | partial | error
  const [fxBaseCode, setFxBaseCode] = useState(null);
  const [fxAmount, setFxAmount] = useState(null);  // 기준 금액(full precision) — 표시 반올림값과 별개
  const [fxEdit, setFxEdit] = useState(null);      // 편집 중 원문(콤마 없음). null이면 포맷 표시
  const fxSeqRef = useRef(0);
  const fxAbortRef = useRef(null);
  const fxFetchedRef = useRef({ key: '', at: 0 });
  // ───────── 브라질 채권 패널 ─────────
  // 입력은 컴포넌트 메모리 전용(Drive 저장 안 함) — 환율 패널의 '금액'과 동일 정책.
  // 액면·표면금리·잔존만기는 브라질 국채 표준값을 실제 초기값으로 채우고,
  // 환율 3칸은 빈칸(=조회시점 라이브 환율 사용)으로 둔다.
  const [showBond, setShowBond] = useState(false);
  const [bond, setBond] = useState({
    krw: '', price: '',
    face: String(BRL_BOND_FACE), rate: String(BRL_BOND_COUPON), years: String(BRL_BOND_YEARS),
    fxBuy: '', fxUsdBrl: '', fxUsdKrw: '',
  });
  const setBondField = (k, v) => setBond((b) => ({ ...b, [k]: v }));

  const fxSlots = (Array.isArray(fxCurrencies) && fxCurrencies.length ? fxCurrencies : FX_DEFAULT)
    .slice(0, Math.min(FX_MAX_SLOTS, Math.max(FX_MIN_SLOTS, fxSlotCount || FX_MIN_SLOTS)));
  // base는 index가 아니라 통화 코드로 추적 — 슬롯 추가/삭제로 인덱스가 밀려도 어긋나지 않는다.
  const baseCode = fxBaseCode && fxSlots.includes(fxBaseCode) ? fxBaseCode : fxSlots[0];

  // ⚠️ 두 패널이 같은 fxRates 맵을 공유하므로 조회는 '합집합' 한 번으로 묶는다.
  //    패널별로 따로 조회하면 fxFetchedRef.key 가 서로를 무효화해 TTL 이 깨지고 무한 재조회가 된다.
  const needCodes = [
    ...(showFx ? fxSlots : []),
    ...(showBond ? ['KRW', 'USD', 'BRL'] : []),
  ].filter((c, i, a) => a.indexOf(c) === i);
  const needKey = needCodes.join(',');

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
  }, [isScientific, history.length === 0, result == null, showFx, showBond, fxSlots.length]);

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

  // 여러 원자 일괄 삽입 (붙여넣기용)
  const insertAtoms = (atoms) => {
    if (!atoms.length) return;
    setResult(null);
    const seq = getSeq(root, cursor.path);
    if (seq == null) { setCursor({ path: [], idx: root.length }); return; }
    const newSeq = [...seq.slice(0, cursor.idx), ...atoms, ...seq.slice(cursor.idx)];
    setRoot(setSeq(root, cursor.path, newSeq));
    setCursor({ path: cursor.path, idx: cursor.idx + atoms.length });
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

  // 붙여넣기: 대시보드에서 복사한 숫자(₩·콤마·% 포함)를 계산기에 입력
  useEffect(() => {
    if (!isOpen) return;
    const onPaste = (e) => {
      // 다른 위젯(예: 카테고리 셀)이 이미 preventDefault로 소비한 붙여넣기는 가로채지 않음
      if (e.defaultPrevented) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      const text = e.clipboardData?.getData('text') ?? '';
      const num = parsePastedNumber(text);
      if (!num || num === '-') return;
      e.preventDefault();
      insertAtoms(strToAtoms(num));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [isOpen, root, cursor]);

  // ───────── 환율 조회 ─────────
  // 늦게 도착한 옛 응답이 최신 상태를 덮어쓰지 않도록 시퀀스 토큰으로 폐기하고,
  // 상태는 교체가 아니라 병합해 이미 받아둔 다른 통화 시세를 지우지 않는다.
  const fxLoad = useCallback(async (codes) => {
    if (!codes || codes.length === 0) return;
    const seq = ++fxSeqRef.current;
    try { fxAbortRef.current?.abort(); } catch {}
    const ac = new AbortController();
    fxAbortRef.current = ac;
    setFxStatus('loading');
    const got = await fetchFxRates(codes, ac.signal);
    if (seq !== fxSeqRef.current) return;
    const okCount = codes.filter((c) => got[c]).length;
    setFxRates((prev) => ({ ...prev, ...got }));
    if (okCount === codes.length) {
      fxFetchedRef.current = { key: codes.join(','), at: Date.now() };
      setFxStatus('ok');
    } else {
      fxFetchedRef.current = { key: '', at: 0 };
      setFxStatus(okCount > 0 ? 'partial' : 'error');
    }
  }, []);

  // ⚠️ isOpen=false는 언마운트가 아니라 렌더 스킵이다(early return이 모든 훅 뒤에 있음).
  //    state·ref가 살아남으므로 "보이게 된 시점 + TTL"을 조회 트리거로 삼는다.
  useEffect(() => {
    if (!isOpen || needKey === '') return;
    if (fxFetchedRef.current.key === needKey && Date.now() - fxFetchedRef.current.at < FX_TTL) return;
    fxLoad(needKey.split(','));
  }, [isOpen, needKey, fxLoad]);

  useEffect(() => () => { try { fxAbortRef.current?.abort(); } catch {} }, []);

  // 포커스한 칸이 기준(base)이 된다. 승계 금액은 표시 반올림값이 아니라 full precision —
  // 그래야 칸을 오갈 때마다 값이 조금씩 깎이지 않는다. 편집창에는 반올림 평문을 넣는다.
  const fxSetBase = (code) => {
    if (code === baseCode) {
      setFxEdit(fxAmount == null ? '' : plainFxAmount(fxAmount, fxDp(code)));
      return;
    }
    const v = convertFx(fxAmount, baseCode, code, fxRates);
    setFxBaseCode(code);
    setFxAmount(v);
    setFxEdit(v == null ? '' : plainFxAmount(v, fxDp(code)));
  };

  const fxOnChange = (text) => { setFxEdit(text); setFxAmount(parseFxAmount(text)); };

  // 전역 paste 핸들러는 input이면 early-return하므로 필드에 직접 붙인다(₩·콤마 제거 재사용).
  const fxOnPaste = (e) => {
    const num = parsePastedNumber(e.clipboardData?.getData('text') ?? '');
    if (!num || num === '-') return;
    e.preventDefault();
    setFxEdit(num);
    setFxAmount(parseFxAmount(num));
  };

  const fxSelectCode = (idx, code) => {
    if (!onChangeFx) return;
    const next = [...(Array.isArray(fxCurrencies) && fxCurrencies.length ? fxCurrencies : FX_DEFAULT)];
    const prevCode = next[idx];
    const dup = next.findIndex((c, j) => c === code && j !== idx && j < fxSlots.length);
    if (dup >= 0) next[dup] = prevCode;               // 표시 중인 다른 슬롯과 겹치면 자리 교환
    next[idx] = code;
    onChangeFx(next, fxSlots.length);
    if (prevCode === baseCode) setFxBaseCode(code);   // 기준 칸의 통화만 바뀐 것 — 금액은 유지
  };

  const fxAddSlot = () => {
    if (!onChangeFx || fxSlots.length >= FX_MAX_SLOTS) return;
    const next = [...(Array.isArray(fxCurrencies) && fxCurrencies.length ? fxCurrencies : FX_DEFAULT)];
    const used = new Set(fxSlots);
    if (!next[2] || used.has(next[2])) next[2] = FX_CURRENCIES.find((c) => !used.has(c.code))?.code;
    onChangeFx(next, FX_MAX_SLOTS);
  };

  // 통화 코드는 배열에 남겨둔다 → 다시 추가할 때 직전 선택이 복원된다.
  const fxRemoveSlot = () => {
    if (!onChangeFx || fxSlots.length <= FX_MIN_SLOTS) return;
    const dropped = fxSlots[fxSlots.length - 1];
    if (baseCode === dropped) {
      const nextBase = fxSlots[0];
      setFxAmount(convertFx(fxAmount, baseCode, nextBase, fxRates));
      setFxBaseCode(nextBase);
      setFxEdit(null);
    }
    onChangeFx(fxCurrencies, FX_MIN_SLOTS);
  };

  // '=' 결과 → 기준 칸. result는 null이 아니라 '오류' 문자열일 수 있어 명시적으로 거른다.
  const fxInjectSource = (result != null && result !== '오류') ? result : (lastAns != null ? fmt(lastAns) : null);
  const fxInjectValue = fxInjectSource == null ? null : parseFxAmount(fxInjectSource);
  const fxInject = () => {
    if (fxInjectValue == null) return;
    setFxAmount(fxInjectValue);
    setFxEdit(null);
  };

  // 환율 값 → 수식. strToAtoms는 문자 그대로 원자를 만들므로 콤마·지수표기는 넣지 않는다.
  const fxToFormula = (code) => {
    const v = code === baseCode ? fxAmount : convertFx(fxAmount, baseCode, code, fxRates);
    if (v == null) return;
    const s = plainFxAmount(v, fxDp(code));
    if (!/^-?\d+(\.\d+)?$/.test(s)) return;
    insertAtoms(strToAtoms(s));
  };

  const fxOther = fxSlots.find((c) => c !== baseCode && fxRates[c]);
  const fxUnit = fxOther ? convertFx(1, baseCode, fxOther, fxRates) : null;
  const fxTimes = [baseCode, fxOther].map((c) => (c ? fxRates[c]?.at : null)).filter(Boolean);
  const fxQuotedAt = fxTimes.length ? formatFxQuoteTime(Math.min(...fxTimes)) : '';

  if (!isOpen) return null;

  // ───────── 2D 렌더 ─────────
  const renderSeq = (seq, path) => {
    const here = pathKey(path) === pathKey(cursor.path);
    const seps = computeGroupSeps(seq);
    const nodes = [];
    for (let i = 0; i < seq.length; i++) {
      if (here && cursor.idx === i) nodes.push(<Caret key={'c' + i} />);
      nodes.push(
        <span key={'a' + i} className={`inline-flex items-center${seps[i] ? ' ml-[0.32em]' : ''}`}>
          {renderAtom(seq[i], path, i)}
        </span>
      );
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

  // ───────── 브라질 채권 파생값 ─────────
  // 라이브 환율(야후, USD 피벗): BRL.rate = USD당 헤알, KRW.rate = 원/달러, 원/헤알은 교차환율.
  // ⚠️ 전부 렌더 파생값 — state 에 저장하지 않는다(환율 패널의 변환값과 동일 정책).
  const liveFxBuy = convertFx(1, 'BRL', 'KRW', fxRates);
  const liveUsdBrl = fxRates.BRL?.rate ?? null;
  const liveUsdKrw = fxRates.KRW?.rate ?? null;
  // 빈칸이면 조회시점(라이브) 환율. 값이 들어있으면 그 값만 쓴다 —
  // 무효 입력을 라이브로 조용히 대체하면 사용자가 오타를 눈치채지 못한다.
  const bondFx = (text, live) => (String(text ?? '').trim() === '' ? live : parseFxAmount(text));
  const bondYears = parseFxAmount(bond.years);
  const bondCalc = computeBrlBond({
    krw: parseFxAmount(bond.krw),
    price: parseFxAmount(bond.price),
    face: parseFxAmount(bond.face),
    couponRate: parseFxAmount(bond.rate),
    years: bondYears,
    fxBuy: bondFx(bond.fxBuy, liveFxBuy),
    fxUsdBrl: bondFx(bond.fxUsdBrl, liveUsdBrl),
    fxUsdKrw: bondFx(bond.fxUsdKrw, liveUsdKrw),
  });
  const bondFxReady = liveFxBuy != null && liveUsdBrl != null && liveUsdKrw != null;
  // 조회 전(idle)·조회 중(loading)을 실패와 구분한다 — 안 그러면 패널을 연 첫 프레임에
  // "불러오지 못했습니다"가 잘못 번쩍인다(fetch 는 useEffect 라 첫 페인트 뒤에 시작).
  const bondFxPending = fxStatus === 'idle' || fxStatus === 'loading';
  const bondTimes = [fxRates.BRL?.at, fxRates.KRW?.at].filter(Boolean);
  const bondQuotedAt = bondTimes.length ? formatFxQuoteTime(Math.min(...bondTimes)) : '';

  // ───────── 브라질 채권 패널 헬퍼 ─────────
  const bondBrl = (v) => (v == null ? '—' : `R$ ${formatFxAmount(v, 2)}`);
  const bondUsd = (v) => (v == null ? '—' : `$ ${formatFxAmount(v, 2)}`);
  const bondWon = (v) => (v == null ? '—' : `₩${formatFxAmount(v, 0)}`);
  const bondPct = (v) => (v == null ? '—' : `${formatFxAmount(v, 2)}%`);

  // 결과값 → 수식. strToAtoms는 문자 그대로 원자를 만드므로 콤마·지수표기는 넣지 않는다(fxToFormula와 동일).
  const bondPush = (v, dp) => {
    if (v == null) return;
    const s = plainFxAmount(v, dp);
    if (!/^-?\d+(\.\d+)?$/.test(s)) return;
    insertAtoms(strToAtoms(s));
  };

  const bondInputs = [
    { key: 'krw', label: '투자금', unit: '원', ph: '0' },
    { key: 'price', label: '매수단가', unit: 'BRL', ph: '780', title: '액면 1좌당 매수 가격 (BRL)' },
    { key: 'face', label: '액면', unit: 'BRL', ph: String(BRL_BOND_FACE), title: '1좌 액면가 — 이자는 이 금액 기준으로 발생' },
    { key: 'rate', label: '표면금리', unit: '%', ph: String(BRL_BOND_COUPON), title: '액면 기준 연 이자율 (쿠폰)' },
    { key: 'years', label: '잔존만기', unit: '년', ph: String(BRL_BOND_YEARS), title: 'YTM·만기 손익 계산용' },
  ];
  const bondFxInputs = [
    { key: 'fxBuy', label: '원/헤알', unit: '매수', ph: liveFxBuy == null ? '—' : formatFxAmount(liveFxBuy, 2), title: '매수 시점 환율 (원 → 헤알 환산)' },
    { key: 'fxUsdBrl', label: 'USD당 헤알', unit: '이자', ph: liveUsdBrl == null ? '—' : formatFxAmount(liveUsdBrl, 4), title: '이자 수령 환율 (헤알 → 달러)' },
    { key: 'fxUsdKrw', label: '원/달러', unit: '이자', ph: liveUsdKrw == null ? '—' : formatFxAmount(liveUsdKrw, 2), title: '이자 수령 환율 (달러 → 원)' },
  ];

  const bondInput = (f) => (
    <div key={f.key} className="flex items-center gap-1">
      <span className="w-[62px] shrink-0 text-[10px] text-gray-400 truncate" title={f.title || f.label}>{f.label}</span>
      <input
        value={bond[f.key]}
        onChange={(e) => setBondField(f.key, e.target.value)}
        onPaste={(e) => {
          const n = parsePastedNumber(e.clipboardData?.getData('text') ?? '');
          if (!n || n === '-') return;
          e.preventDefault();
          setBondField(f.key, n);
        }}
        inputMode="decimal"
        placeholder={f.ph}
        title={f.title || f.label}
        className="flex-1 min-w-0 text-right rounded px-1.5 py-1 text-[12px] bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-amber-600"
      />
      <span className="w-[26px] shrink-0 text-[9px] text-gray-500">{f.unit}</span>
    </div>
  );

  // ⚠️ 클릭 삽입값(raw)은 '그 줄에 보이는 값'과 반드시 같아야 한다 —
  //    R$ 200 을 눌렀는데 원화가 수식에 들어가면 조용히 틀린 계산이 된다.
  //    원화도 넣고 싶은 줄은 subRaw 로 아랫줄을 따로 클릭 가능하게 한다.
  const bondRow = ({ label, main, sub, raw = null, dp = 2, cls = 'text-gray-100', subRaw = null, subDp = 0 }) => (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[10px] text-gray-400 shrink-0 pt-px">{label}</span>
      <div className="min-w-0 text-right">
        <div
          className={`text-[11px] tabular-nums ${cls}${raw == null ? '' : ' cursor-pointer hover:text-orange-300 transition-colors'}`}
          onClick={() => bondPush(raw, dp)}
          title={raw == null ? '' : '클릭하면 수식에 입력'}
        >
          {main}
        </div>
        {sub ? (
          <div
            className={`text-[9px] text-gray-500 tabular-nums break-words${subRaw == null ? '' : ' cursor-pointer hover:text-orange-300 transition-colors'}`}
            onClick={() => bondPush(subRaw, subDp)}
            title={subRaw == null ? '' : '클릭하면 수식에 입력'}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  );

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
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: CALC_Z, width: 300, maxHeight: '94vh' }}
      className="rounded-2xl shadow-2xl overflow-y-auto border border-gray-600/60 bg-black"
    >
      {/* 타이틀 바 — touchAction:'none'은 드래그 핸들인 여기에만 둔다(본문은 터치 스크롤 유지) */}
      <div
        className="flex items-center justify-between bg-gray-900 px-3 py-2 cursor-move border-b border-gray-700/40 select-none sticky top-0 z-10"
        style={{ touchAction: 'none' }}
        onMouseDown={(e) => { onDragStart(e.clientX, e.clientY); e.preventDefault(); }}
        onTouchStart={(e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
      >
        {/* 토글이 4개라 300px 폭에서는 제목이 밀린다 — 제목을 줄이고 truncate 로 보호 */}
        <span className="text-gray-200 text-sm font-semibold truncate min-w-0">🧮 계산기</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowBond((v) => !v)}
            title="브라질 채권 수익률 계산"
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
              showBond ? 'text-amber-300 border-amber-600/50 bg-amber-900/20 hover:bg-amber-900/40'
                       : 'text-gray-400 border-gray-600/50 hover:text-gray-200 hover:border-gray-500 hover:bg-gray-800/50'
            }`}
          >
            채권
          </button>
          <button
            onClick={() => setShowFx((v) => !v)}
            title="환율 변환 패널"
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
              showFx ? 'text-teal-300 border-teal-600/50 bg-teal-900/20 hover:bg-teal-900/40'
                     : 'text-gray-400 border-gray-600/50 hover:text-gray-200 hover:border-gray-500 hover:bg-gray-800/50'
            }`}
          >
            환율
          </button>
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

      {/* 환율 패널 — 조회 실패는 notify(벨 이력)가 아니라 패널 내부 인라인으로만 알린다
          (알림 최소화 정책: 시세 계층은 벨에 남기지 않음).
          onKeyDownCapture로 패널 내부 키 입력이 전역 keydown 핸들러(수식 입력)에 닿지 않게 막는다 —
          버튼 포커스 상태의 숫자키가 수식으로 새는 것을 방지. */}
      {showFx && (
        <div
          className="bg-gray-950 px-3 pb-2 pt-1.5 border-y border-gray-800/60 space-y-1.5"
          onKeyDownCapture={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-teal-300">💱 환율 변환</span>
            <div className="flex items-center gap-1">
              <button
                onClick={fxInject}
                disabled={fxInjectValue == null}
                title="계산 결과를 기준 칸에 넣기"
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  fxInjectValue == null
                    ? 'text-gray-600 border-gray-700/50 cursor-not-allowed'
                    : 'text-orange-300 border-orange-600/50 hover:bg-orange-900/30'
                }`}
              >
                = 결과
              </button>
              <button
                onClick={() => fxLoad(needCodes)}
                title="환율 새로고침"
                className="text-gray-400 hover:text-teal-300 p-1 rounded transition-colors"
              >
                <RefreshCw size={12} className={fxStatus === 'loading' ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {fxSlots.map((code, i) => {
            const dp = fxDp(code);
            const isBase = code === baseCode;
            const usable = !!fxRates[code];
            const val = isBase ? fxAmount : convertFx(fxAmount, baseCode, code, fxRates);
            const text = isBase && fxEdit != null
              ? fxEdit
              : (fxAmount == null ? '' : (val == null ? '—' : formatFxAmount(val, dp)));
            const pct = isBase ? null : fxChangePct(baseCode, code, fxRates);
            return (
              <div key={`${code}-${i}`} className="flex items-center gap-1">
                <select
                  value={code}
                  onChange={(e) => fxSelectCode(i, e.target.value)}
                  title={fxName(code)}
                  className="w-[60px] shrink-0 bg-gray-900 border border-gray-700 rounded text-gray-200 text-[11px] px-1 py-1 focus:outline-none focus:border-teal-500"
                >
                  {FX_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.code}</option>
                  ))}
                </select>
                <input
                  value={text}
                  onChange={(e) => fxOnChange(e.target.value)}
                  onFocus={() => fxSetBase(code)}
                  onBlur={() => setFxEdit(null)}
                  onPaste={fxOnPaste}
                  disabled={!isBase && !usable}
                  inputMode="decimal"
                  placeholder={usable ? '0' : '—'}
                  title={fxName(code)}
                  className={`flex-1 min-w-0 text-right rounded px-1.5 py-1 text-[13px] bg-gray-900 border focus:outline-none disabled:opacity-40 ${
                    isBase ? 'border-teal-600 text-white' : 'border-gray-700 text-gray-300'
                  }`}
                />
                <span
                  className={`w-[42px] shrink-0 text-right text-[9px] tabular-nums ${
                    pct == null ? 'text-gray-600' : pct > 0 ? 'text-red-400' : pct < 0 ? 'text-blue-400' : 'text-gray-400'
                  }`}
                  title={pct == null ? '' : '전일 대비 이 금액의 변화율'}
                >
                  {pct == null ? '' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}
                </span>
                <button
                  onClick={() => fxToFormula(code)}
                  title="이 값을 수식에 넣기"
                  className="shrink-0 text-gray-500 hover:text-teal-300 p-0.5 transition-colors"
                >
                  <ArrowUp size={11} />
                </button>
                {i === fxSlots.length - 1 && fxSlots.length > FX_MIN_SLOTS ? (
                  <button
                    onClick={fxRemoveSlot}
                    title="이 통화 제거"
                    className="shrink-0 text-gray-600 hover:text-red-400 p-0.5 transition-colors"
                  >
                    <X size={11} />
                  </button>
                ) : (
                  <span className="shrink-0 w-[19px]" />
                )}
              </div>
            );
          })}

          {fxSlots.length < FX_MAX_SLOTS && onChangeFx && (
            <button
              onClick={fxAddSlot}
              className="w-full text-[10px] text-gray-400 hover:text-teal-300 border border-dashed border-gray-700 hover:border-teal-700 rounded py-1 transition-colors"
            >
              + 통화 추가
            </button>
          )}

          <div className="text-[9px] leading-relaxed text-gray-500">
            {fxStatus === 'error' ? (
              <span className="text-amber-400">환율을 불러오지 못했습니다 · 새로고침을 눌러 다시 시도하세요</span>
            ) : fxStatus === 'loading' && !fxUnit ? (
              '환율 불러오는 중…'
            ) : fxUnit != null ? (
              <>
                1 {baseCode} = {formatFxAmount(fxUnit, fxUnit >= 100 ? 2 : 4)} {fxOther}
                {fxQuotedAt ? ` · ${fxQuotedAt}` : ''} · 야후 시장환율
                {fxStatus === 'partial' && <span className="text-amber-400"> · 일부 통화 조회 실패</span>}
              </>
            ) : (
              '환율 대기 중'
            )}
          </div>
        </div>
      )}

      {/* 브라질 채권 패널 — 환율 패널과 동일 규약:
          · 결측/무효 입력은 '—' (computeBrlBond 의 null 계약, 렌더 중 throw 금지)
          · 조회 실패는 벨 알림이 아니라 패널 내부 인라인으로만 알린다(알림 최소화 정책)
          · onKeyDownCapture 로 패널 내부 키 입력이 전역 keydown(수식 입력)에 닿지 않게 막는다 */}
      {showBond && (
        <div
          className="bg-gray-950 px-3 pb-2 pt-1.5 border-y border-gray-800/60 space-y-1.5"
          onKeyDownCapture={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-300">🇧🇷 브라질 채권</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { if (fxInjectValue != null) setBondField('krw', String(fxInjectValue)); }}
                disabled={fxInjectValue == null}
                title="계산 결과를 투자금(원)에 넣기"
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  fxInjectValue == null
                    ? 'text-gray-600 border-gray-700/50 cursor-not-allowed'
                    : 'text-orange-300 border-orange-600/50 hover:bg-orange-900/30'
                }`}
              >
                = 투자금
              </button>
              <button
                onClick={() => fxLoad(needCodes)}
                title="환율 새로고침"
                className="text-gray-400 hover:text-amber-300 p-1 rounded transition-colors"
              >
                <RefreshCw size={12} className={fxStatus === 'loading' ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {bondInputs.map((f) => bondInput(f))}

          <div className="pt-0.5 text-[9px] text-gray-500">환율 · 빈칸이면 조회시점 환율 적용</div>
          {bondFxInputs.map((f) => bondInput(f))}

          <div className="border-t border-gray-800 pt-1.5 space-y-1">
            {bondRow({
              label: '매수 수량', dp: 0, raw: bondCalc.qty,
              main: bondCalc.qty == null ? '—' : `${formatFxAmount(bondCalc.qty, 0)} 좌`,
              sub: `액면 ${bondBrl(bondCalc.faceTotal)} · 환산 ${bondBrl(bondCalc.investBrl)}`,
            })}
            {bondRow({
              label: '투입 금액', main: bondBrl(bondCalc.costBrl), sub: bondWon(bondCalc.costKrw),
              raw: bondCalc.costBrl, subRaw: bondCalc.costKrw,
            })}
            {bondRow({
              label: '잔여', main: bondBrl(bondCalc.leftoverBrl), sub: bondWon(bondCalc.leftoverKrw),
              raw: bondCalc.leftoverBrl, subRaw: bondCalc.leftoverKrw,
            })}
          </div>

          <div className="border-t border-gray-800 pt-1.5 space-y-1">
            {bondRow({
              label: '매입가 기준', main: bondPct(bondCalc.currentYield), raw: bondCalc.currentYield, dp: 4,
              cls: 'text-amber-300 font-semibold',
              sub: `경상수익률 · 액면이자 ${bondBrl(bondCalc.couponUnitAnnual)} ÷ 매수단가`,
            })}
            {bondRow({
              label: 'YTM (연)', main: bondPct(bondCalc.ytmAnnual), raw: bondCalc.ytmAnnual, dp: 4,
              sub: bondCalc.ytmSemiPct != null
                ? `반기 ${bondPct(bondCalc.ytmSemiPct)} · 실효 ${bondPct(bondCalc.ytmEffective)} · 상환차익 포함`
                : bondYears == null ? '잔존만기를 입력하면 산출됩니다'
                : '단가가 원리금 합보다 높습니다 (수익률 음수)',
            })}
          </div>

          <div className="border-t border-gray-800 pt-1.5 space-y-1">
            {bondRow({
              label: `${12 / BRL_COUPONS_PER_YEAR}개월 이자`, cls: 'text-emerald-300 font-semibold',
              main: bondBrl(bondCalc.couponHalfBrl), raw: bondCalc.couponHalfBrl,
              sub: `${bondUsd(bondCalc.couponHalfUsd)} → ${bondWon(bondCalc.couponHalfKrw)}`,
              subRaw: bondCalc.couponHalfKrw,
            })}
            {bondRow({
              label: '연 이자', main: bondBrl(bondCalc.couponAnnualBrl), raw: bondCalc.couponAnnualBrl,
              sub: `${bondUsd(bondCalc.couponAnnualUsd)} → ${bondWon(bondCalc.couponAnnualKrw)}`,
              subRaw: bondCalc.couponAnnualKrw,
            })}
            {bondRow({
              label: '원화 기준', main: bondPct(bondCalc.krwYield), raw: bondCalc.krwYield, dp: 4,
              sub: '연 이자(원) ÷ 투입금액(원)',
            })}
          </div>

          <div className="border-t border-gray-800 pt-1.5 space-y-1">
            {bondRow({
              label: '만기 상환차익', main: bondBrl(bondCalc.redeemGainBrl), raw: bondCalc.redeemGainBrl,
              sub: `단가 대비 ${bondCalc.redeemGainPct == null ? '—' : `${bondCalc.redeemGainPct > 0 ? '+' : ''}${bondPct(bondCalc.redeemGainPct)}`}`,
            })}
            {bondRow({
              label: '만기 총 손익', main: bondBrl(bondCalc.totalGainBrl), raw: bondCalc.totalGainBrl,
              sub: `이자 ${bondBrl(bondCalc.totalCouponBrl)} + 차익 ${bondBrl(bondCalc.redeemGainBrl)}`,
            })}
          </div>

          <div className="text-[9px] leading-relaxed text-gray-500">
            {bondFxReady ? (
              <>
                라이브 1 BRL = {formatFxAmount(liveFxBuy, 2)}원 · 1 USD = {formatFxAmount(liveUsdBrl, 4)} BRL
                {bondQuotedAt ? ` · ${bondQuotedAt}` : ''}
              </>
            ) : bondFxPending ? (
              '환율 불러오는 중…'
            ) : (
              <span className="text-amber-400">환율을 불러오지 못했습니다 · 새로고침하거나 환율을 직접 입력하세요</span>
            )}
            <br />※ 경과이자 · 환전수수료 · 세금 · 향후 환율변동 미반영
          </div>
        </div>
      )}

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
