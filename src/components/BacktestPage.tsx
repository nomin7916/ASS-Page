// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// ⚠️ 여기 있는 아이콘은 **이 저장소가 이미 쓰고 있어 lucide 0.577.0에 실재가 확인된 것**만이다.
//    package-lock.json도 node_modules도 없어 새 아이콘이 이 버전에 있는지 확인할 수단이 없고,
//    없으면 undefined 컴포넌트 렌더로 페이지가 통째로 죽는다(UserInfoBar FlowIcon 주석과 동일 근거).
//    특히 `AlertTriangle`은 lucide 0.4x에서 `TriangleAlert`로 개명됐다 → AlertCircle을 쓴다.
import {
  BarChart3, Plus, Trash2, FileText, ExternalLink, X, Download, RefreshCw,
  AlertCircle, ChevronDown, ChevronRight, HelpCircle,
} from 'lucide-react';
import {
  runBacktest, makeBtConfig, makeBtAsset, joinTradeDividends, parsePastedSeries,
  seriesRange, monthsBetween,
  MAX_BT_SCENARIOS, MAX_BT_ASSETS, MAX_BT_EVENTS, MAX_BT_OVERRIDES,
  MAX_BT_CONTRIB_OVERRIDES, MAX_BT_REBAL_DATES, BT_COLORS,
} from '../backtest';
import { generateId, formatNumber, cleanNum } from '../utils';

/**
 * 리밸런싱 백테스트 페이지.
 *
 * ⚠️ 인앱 오버레이(variant='overlay')와 별도 브라우저 창(variant='page')이 **이 한 컴포넌트를
 *    공유**한다. 새 창용으로 표/설정을 복제하면 두 화면이 갈라진다(FlowBoard·CalendarModal 선례).
 *
 * ⚠️ 편집은 **로컬 사본**에 모으고 2.5초 idle·닫기·언마운트·종료커밋에만 상위로 승격한다.
 *    제스처(키 입력)마다 승격하면 App.tsx portfolioStructureKey가 전 계좌를 매번 재직렬화하고
 *    800ms 디바운스가 매번 만료되어 **글자마다 STATE+VERSION+STOCK+MARKET 4파일 write**가
 *    나간다(FlowBoard가 정확히 이 사고를 겪었다).
 *
 * ⚠️ 조회한 종가는 절대 stockHistoryMap에 병합하지 않는다 — 그 맵은 buildCloseEvalSeries(보유
 *    평가액 재계산)와 useAutoConfirmHistory 데이터완비 가드의 권위 소스라, 백테스트용 수정주가가
 *    섞이면 보유+백테스트 중복 코드의 과거 평가액이 영구히 오염된다(WatchlistPopup 불변식과 동일).
 */

const IDLE_MS = 2500;
const RUN_DEBOUNCE_MS = 220;

const won = (n) => `₩${formatNumber(Math.round(cleanNum(n)))}`;
const wonSigned = (n) => {
  const v = Math.round(cleanNum(n));
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}₩${formatNumber(Math.abs(v))}`;
};
const qtyText = (n) => (Number.isInteger(n) ? formatNumber(n) : formatNumber(Math.round(n * 10000) / 10000));
const pctText = (n) => `${cleanNum(n) >= 0 ? '+' : '−'}${Math.abs(cleanNum(n)).toFixed(2)}%`;
/** 한국식 손익 색상 — 이익 red / 손실 blue */
const pnlCls = (n) => (cleanNum(n) > 0 ? 'text-red-400' : cleanNum(n) < 0 ? 'text-blue-400' : 'text-gray-400');

/** 비중 모드 분모 라벨 — 화면 곳곳이 같은 이름을 쓰도록 한 곳에 모은다. */
const RATIO_BASE_LABEL = {
  equity: '종목 평가액 합계',
  total: '평가액 + 예수금',
  totalWithDiv: '평가액 + 예수금 + 누적분배금',
  initial: '초기 투자금 고정',
};

const INPUT = 'bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none focus:border-sky-500 w-full';
const LABEL = 'text-[10px] text-gray-500 font-bold';
const BTN = 'px-2 py-1 rounded text-[11px] font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** 콤마 표시 + 포커스 시 원문 편집. onCommit은 blur/Enter에서만 부른다. */
function NumInput({ value, onCommit, placeholder = '', disabled = false, className = '', allowEmpty = false }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : value === null || value === undefined || value === '' ? '' : formatNumber(value);
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (allowEmpty && raw === '') { onCommit(null); return; }
    onCommit(cleanNum(raw));
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      disabled={disabled}
      className={`${INPUT} text-right ${className}`}
      placeholder={placeholder}
      value={shown}
      // ⚠️ 초안에 formatNumber 결과를 넣지 말 것 — DOM 값과 문자열이 달라지면 React가 커밋에서
      //    node.value를 다시 써 캐럿이 끝으로 튄다(목표금액 셀에서 겪은 회귀와 동일).
      onFocus={(e) => setDraft(String(value ?? '').replace(/[^0-9.\-]/g, ''))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }}
    />
  );
}

/**
 * 결과표 '주당 분배금' 셀 입력.
 * ⚠️ 반드시 로컬 draft를 둘 것 — 표시값(d.perShare)은 220ms 디바운스된 **계산 결과**라,
 *    onChange로 곧장 커밋하면 그 사이 리렌더에서 controlled value가 옛 값으로 되돌아가
 *    "170"을 치면 "1"만 남는다. blur/Enter에서만 커밋한다(NumInput과 같은 계약).
 */
function DivInput({ value, unknown, disabled, title, onCommit }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : (unknown && !value ? '' : String(value ?? ''));
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    onCommit(raw === '' ? 0 : cleanNum(raw));
  };
  return (
    <input
      className={`bg-transparent border rounded px-1 py-0.5 text-[10px] text-right w-14 outline-none focus:border-sky-500 ${unknown ? 'border-amber-700/70 text-amber-300' : 'border-transparent hover:border-gray-700 text-gray-300'}`}
      value={shown}
      placeholder="0"
      disabled={disabled}
      title={title}
      onFocus={(e) => setDraft(e.target.value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }}
    />
  );
}

function Section({ title, children, defaultOpen = true, badge = null }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden bg-gray-900/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800/60 hover:bg-gray-800 transition-colors"
      >
        {open ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
        <span className="text-[11px] font-bold text-gray-300">{title}</span>
        {badge !== null && <span className="ml-auto text-[10px] text-gray-500">{badge}</span>}
      </button>
      {open && <div className="p-2.5 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

/** 자산 추이 미니 차트 — recharts 대신 인라인 SVG(새 창의 컨테이너 측정 이슈 회피 + 인쇄 안정). */
function CurveChart({ curve }) {
  if (!curve || curve.length < 2) return null;
  const W = 640, H = 120, PAD = 4;
  let lo = Infinity, hi = -Infinity;
  for (const c of curve) { if (c.total < lo) lo = c.total; if (c.total > hi) hi = c.total; }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) { hi = lo + 1; }
  const x = (i) => PAD + (i / (curve.length - 1)) * (W - PAD * 2);
  const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);
  const line = curve.map((c, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(c.total).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(curve.length - 1).toFixed(1)} ${H - PAD} L ${x(0).toFixed(1)} ${H - PAD} Z`;
  const up = curve[curve.length - 1].total >= curve[0].total;
  const stroke = up ? '#f87171' : '#60a5fa';
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[120px] block">
        <path d={area} fill={stroke} opacity="0.12" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
        <span>{curve[0].date} · {won(curve[0].total)}</span>
        <span>최고 {won(hi)} · 최저 {won(lo)}</span>
        <span>{curve[curve.length - 1].date} · {won(curve[curve.length - 1].total)}</span>
      </div>
    </div>
  );
}

export default function BacktestPage({
  open = true,
  variant = 'overlay',
  onClose,
  scenarios = [],
  onUpdateScenarios,
  flushRef,
  catalog = [],
  prices = {},
  dividends = {},
  holidays = [],
  readOnly = false,
  onFetchCode,
  fetchingCodes = [],
  onOpenWindow,
  notice = '',
}) {
  // ── 로컬 사본 + idle 승격 ────────────────────────────────────────────────
  const [local, setLocalState] = useState(scenarios);
  const localRef = useRef(scenarios);
  const dirtyRef = useRef(false);
  const idleRef = useRef(null);

  const promote = useCallback(() => {
    if (idleRef.current) { clearTimeout(idleRef.current); idleRef.current = null; }
    if (!dirtyRef.current) return null;      // ⚠️ 승격할 게 없으면 반드시 null (종료 커밋 강제 방지)
    dirtyRef.current = false;
    const next = localRef.current;
    onUpdateScenarios?.(next);
    return next;
  }, [onUpdateScenarios]);

  const setLocal = useCallback((updater) => {
    if (readOnly) return;
    const prev = localRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    localRef.current = next;
    setLocalState(next);
    dirtyRef.current = true;
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => { idleRef.current = null; promote(); }, IDLE_MS);
  }, [promote, readOnly]);

  // 상위에서 늦게 도착한 값 채택 — 편집 중(dirty)에는 채택하지 않는다(last-writer-wins).
  // ⚠️ Drive 로드가 LoadingOverlay 해제(20초)보다 늦으면 빈 배열로 시작하는데, 여기서 채택하지
  //    않으면 도형 하나 그리자마자 저장돼 있던 시나리오 전체가 빈 배열로 대체된다(FlowBoard 선례).
  useEffect(() => {
    if (dirtyRef.current) return;
    if (scenarios === localRef.current) return;
    localRef.current = scenarios;
    setLocalState(scenarios);
  }, [scenarios]);

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = promote;
    return () => { flushRef.current = null; };
  }, [flushRef, promote]);

  // 언마운트 시 승격 — 그냥 사라지면 편집이 유실된다.
  useEffect(() => () => { promote(); }, [promote]);

  // ── 활성 시나리오 ────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState('');
  const active = useMemo(
    () => local.find((s) => s.id === activeId) || local[0] || null,
    [local, activeId],
  );
  useEffect(() => {
    if (!local.length) return;
    if (!local.some((s) => s.id === activeId)) setActiveId(local[0].id);
  }, [local, activeId]);

  const patchActive = useCallback((patch) => {
    setLocal((prev) => prev.map((s) => (s.id === (active?.id) ? { ...s, ...patch, updatedAt: Date.now() } : s)));
  }, [setLocal, active?.id]);

  const addScenario = (from = null) => {
    if (local.length >= MAX_BT_SCENARIOS) return;
    const base = from
      ? makeBtConfig({ ...JSON.parse(JSON.stringify(from)), id: generateId(), name: `${from.name} 사본` })
      : makeBtConfig({
          name: `백테스트 ${local.length + 1}`,
          startDate: '', endDate: '', initialCapital: 100000000,
          assets: [], events: [], overrides: [],
        });
    // ⚠️ id 생성은 업데이터 **밖**에서 — StrictMode의 업데이터 이중 호출에서 서로 다른 id가
    //    만들어지고 React는 두 번째 결과만 채택해 선택이 어긋난다(FlowBoard 순수성 규약).
    setLocal((prev) => [...prev, base]);
    setActiveId(base.id);
  };

  const removeScenario = (id) => {
    setLocal((prev) => prev.filter((s) => s.id !== id));
  };

  // ── 실행 (디바운스) ──────────────────────────────────────────────────────
  const [runCfg, setRunCfg] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setRunCfg(active), RUN_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [active]);

  const result = useMemo(() => {
    if (!runCfg) return null;
    try {
      return runBacktest({ config: runCfg, prices, dividends, holidays });
    } catch (err) {
      // ⚠️ 예외를 위로 던지지 말 것 — 렌더 중 TypeError가 루트 ErrorBoundary까지 올라가면
      //    앱 화면 전체가 오류 페이지로 대체된다(convertFx·edgePath의 null 계약과 동일 근거).
      return { ok: false, fatal: `계산 중 오류가 발생했습니다: ${String(err?.message || err)}`, warnings: [], months: [], slots: [], assetMeta: [], initialTrades: [], curve: [], finalHoldings: [], summary: null };
    }
  }, [runCfg, prices, dividends, holidays]);

  // ── 종목 추가 ────────────────────────────────────────────────────────────
  const [newCode, setNewCode] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteCode, setPasteCode] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');

  const catalogByCode = useMemo(() => {
    const m = {};
    for (const c of catalog) m[c.code] = c;
    return m;
  }, [catalog]);

  const addAsset = (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c || !active) return;
    if (active.assets.length >= MAX_BT_ASSETS) return;
    if (active.assets.some((a) => a.code === c)) return;
    const meta = catalogByCode[c];
    const asset = makeBtAsset({
      code: c,
      name: meta?.name || c,
      payCycle: 'eom',
      targetAmount: active.targetMode === 'amount' ? null : null,
      targetRatio: null,
    }, active.assets.length);
    patchActive({ assets: [...active.assets, asset] });
    setNewCode('');
    // ⚠️ prices[c] 유무와 무관하게 **항상** 요청한다 — 이 호출이 App에 "이 코드를 쓴다"를
    //    등록하는 유일한 경로이고(btRequested), App이 저장된 종가가 있으면 네트워크를 생략한다.
    //    여기서 `!prices[c]` 로 거르면 승격 전까지 코드가 등록되지 않아 종가가 안 뜬다.
    onFetchCode?.(c);
  };

  const patchAsset = (id, patch) => {
    patchActive({ assets: active.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  };
  const removeAsset = (id) => {
    patchActive({
      assets: active.assets.filter((a) => a.id !== id),
      events: active.events.map((e) => ({
        ...e,
        addAssets: e.addAssets.filter((x) => x !== id),
        removeAssets: e.removeAssets.filter((x) => x !== id),
        targets: e.targets.filter((t) => t.assetId !== id),
      })),
      // ⚠️ 그 종목만 겨냥한 월별 오버라이드도 같이 지운다 — 남겨 두면 select 의 값
      //    `a:<삭제된 id>` 에 대응하는 option 이 없어 브라우저가 첫 항목('월중 일괄' 등)을
      //    표시하고, 사용자가 다른 칸을 건드리는 순간 조용히 그 그룹 일괄로 바뀐다.
      overrides: active.overrides.filter((o) => o.assetId !== id),
    });
  };

  /** 목표를 균등 분배 — 금액 모드는 초기자본/N, 비중 모드는 100/N */
  const splitEven = () => {
    if (!active || !active.assets.length) return;
    const n = active.assets.length;
    if (active.targetMode === 'amount') {
      const each = Math.floor((active.initialCapital + active.extraCash) / n);
      patchActive({ assets: active.assets.map((a) => ({ ...a, targetAmount: each })) });
    } else {
      const each = Math.round((100 / n) * 100) / 100;
      patchActive({ assets: active.assets.map((a) => ({ ...a, targetRatio: each })) });
    }
  };

  // ── 인쇄 ────────────────────────────────────────────────────────────────
  const doPrint = () => { try { window.print(); } catch {} };

  // ── 결과 CSV ────────────────────────────────────────────────────────────
  const downloadCsv = () => {
    if (!result?.ok || !active) return;
    // ⚠️ 열 구성은 화면 표와 1:1로 유지할 것 — 갈리면 "화면과 CSV가 다르다"가 된다.
    const rows = [[
      '구분', '리밸런싱일', '종목', '종가', '리밸런싱 전 평가액', '매수/매도 수량',
      '리밸런싱 매매금액', '조정 후 수량', '조정 후 평가액', '분배락일', '지급일', '주당 분배금', '지급 분배금',
    ]];
    for (const t of result.initialTrades) {
      rows.push(['초기매수', t.date, `${t.name}(${t.code})`, t.price, Math.round(t.evalBefore),
        t.qty, Math.round(t.cashDelta), t.qtyAfter, Math.round(t.evalAfter), '', '', '', '']);
    }
    for (const m of result.months) {
      const { rows: joined, orphans } = joinTradeDividends(m.trades, m.dividends);
      for (const { trade: t, dividend: d } of joined) {
        rows.push([t.structural ? '구조변경' : '리밸런싱', t.date, `${t.name}(${t.code})`, t.price,
          Math.round(t.evalBefore), t.qty, Math.round(t.cashDelta), t.qtyAfter, Math.round(t.evalAfter),
          d?.exDate || '', d?.payDate || '', d?.perShare ?? '', d ? Math.round(d.amount) : '']);
      }
      for (const d of orphans) {
        rows.push(['분배금만', '', `${d.name}(${d.code})`, '', '', '', '', d.qty, '', d.exDate, d.payDate, d.perShare, Math.round(d.amount)]);
      }
      // ⚠️ 화면 tfoot과 **같은 규칙** — 같은 종목이 그 달에 두 번 이상 거래되면 평가액 합은
      //    중복 계상이므로 비운다(정확한 시점 정합 총액은 바로 아래 '월말보유' 행들의 합).
      const dup = new Set<string>();
      let dupTraded = false;
      for (const t of m.trades) { if (dup.has(t.assetId)) { dupTraded = true; break; } dup.add(t.assetId); }
      rows.push([`${m.ym} 합계`, '', '', '', dupTraded ? '' : Math.round(m.evalBeforeSum), '', Math.round(m.tradeNet), '',
        dupTraded ? '' : Math.round(joined.reduce((s, r) => s + r.trade.evalAfter, 0)), '', '', '', Math.round(m.divAccrued)]);
      // 매월 목표 증액 — 화면 sky 블록과 동일 소스
      if (m.contribution && m.contribution.amount > 0) {
        const c = m.contribution;
        rows.push([`${m.ym} 목표증액`, c.date, c.mode === 'pctOfCash' ? `예수금 ${c.value}%` : '고정 금액',
          '', Math.round(c.cashBefore), '', Math.round(c.amount), '', '', '', '', '', '']);
        for (const x of c.perAsset) {
          if (!(x.added > 0)) continue;
          rows.push([`${m.ym} 증액배분`, c.date, `${x.name}(${x.code})`, '', '', '',
            Math.round(x.added), '', Math.round(x.targetAfter), '', '', '', '']);
        }
      }
      // 월말 보유 — 그 달에 거래가 없던 종목도 포함(화면 '월말 보유 현황'과 동일 소스)
      for (const h of m.holdings) {
        rows.push([`${m.ym} 월말보유`, m.lastDate, `${h.name}(${h.code})`, h.price, '', '', '',
          h.qty, Math.round(h.evalAmount), '', '', '', '']);
      }
      rows.push([`${m.ym} 누적`, '', '', '', '', '', Math.round(m.cumTradeNet), '', '', '', '', '', Math.round(m.cumDivAccrued)]);
      rows.push([`${m.ym} 현금`, '', '', '', '', '', Math.round(m.cashDelta), '', Math.round(m.evalEnd), '', '', '', Math.round(m.cashEnd)]);
    }
    // 기말 보유 + 예수금 원천별 세분화 — 화면 '기말 보유 현황' 표와 같은 소스.
    for (const h of result.finalHoldings) {
      rows.push(['기말보유', result.summary.endDate, `${h.name}(${h.code})`, h.price, '', '', '',
        h.qty, Math.round(h.evalAmount), '', '', '', '']);
    }
    // ⚠️ 합이 정확히 기말 예수금이 되는 항등식(검증 #110). 분배금은 **지급 기준**을 쓴다.
    for (const [label, value] of [
      ['초기 매수 후 잔여', result.initialCashAfter],
      ['누적 매매차익', result.summary.cumTradeNet],
      ['종목 재편 순현금', result.summary.cumStructuralNet],
      ['누적 분배금', result.summary.cumDivPaid],
    ]) {
      if (Math.round(value) === 0) continue;
      rows.push(['기말예수금 내역', '', label, '', '', '', '', '', Math.round(value), '', '', '', '']);
    }
    rows.push(['기말 합계', result.summary.endDate, '', '', '', '', '', '', Math.round(result.summary.finalEval),
      '', '', '', Math.round(result.summary.finalCash)]);
    // ⚠️ BOM은 '\ufeff' 이스케이프로 — 소스에 보이지 않는 문자를 직접 넣으면 편집·머지 중 조용히
    //    사라져 엑셀에서 한글이 깨진다(원인 추적이 매우 어렵다).
    const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_${active.name}_${active.startDate}_${active.endDate}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!open) return null;

  // ⚠️ 인쇄를 위해 **반드시 document.body 직속 포털**로 렌더한다.
  //    오버레이 모드에서는 이 화면이 App 트리 깊숙이 있어 `body > *:not(.bt-shell){display:none}`
  //    규칙이 성립하지 않고, visibility 토글로 우회하면 숨겨진 앱 본문이 자리를 그대로 차지해
  //    **빈 페이지 수십 장**이 딸려 나온다. 포털로 올리면 두 모드(새 창/오버레이)가 같은 규칙을 쓴다.
  const content = (
    <div className={`bt-shell fixed inset-0 bg-[#0b1120] flex flex-col ${variant === 'page' ? '' : 'z-[1090]'}`}>
      {/* ⚠️ 인쇄 색상 강제 — 앱이 다크 테마라 그대로 인쇄하면 흰 종이에 밝은 회색 글씨가 찍혀
              사실상 판독 불가다(브라우저 기본값이 배경색을 버리기 때문). 검정 글씨 + 흰 배경으로
              뒤집고, 손익 의미가 있는 색만 인쇄용 진한 색으로 되살린다. */}
      <style>{`
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.bt-shell) { display: none !important; }
  .bt-shell { position: static !important; display: block !important; height: auto !important;
              overflow: visible !important; background: #fff !important; }
  .bt-shell .bt-noprint { display: none !important; }
  .bt-body { display: block !important; overflow: visible !important; max-height: none !important; }
  #bt-print { overflow: visible !important; max-height: none !important; height: auto !important; padding: 0 !important; }
  .bt-shell, .bt-shell * { color: #111 !important; background: transparent !important;
                           border-color: #b0b0b0 !important; box-shadow: none !important; }
  .bt-shell [class*="text-red-"]     { color: #b91c1c !important; }
  .bt-shell [class*="text-blue-"]    { color: #1d4ed8 !important; }
  .bt-shell [class*="text-emerald-"] { color: #047857 !important; }
  .bt-shell [class*="text-amber-"]   { color: #b45309 !important; }
  .bt-shell [class*="text-gray-6"], .bt-shell [class*="text-gray-7"] { color: #555 !important; }
  .bt-shell thead th { background: #eee !important; }
  .bt-shell table { page-break-inside: auto; width: 100% !important; min-width: 0 !important; }
  .bt-shell tr { page-break-inside: avoid; page-break-after: auto; }
  .bt-shell .bt-month { page-break-inside: avoid; }
  .bt-shell .overflow-x-auto { overflow: visible !important; }
  @page { size: A4 landscape; margin: 10mm; }
}
`}</style>

      {notice && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-900/30 border-b border-amber-800/50 bt-noprint">
          {notice}
        </div>
      )}

      {/* ── 상단 바 ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/70 shrink-0 bt-noprint">
        <BarChart3 size={14} className="text-emerald-400 shrink-0" />
        <span className="text-sm font-bold text-gray-100 shrink-0">백테스트</span>

        <select
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none max-w-[220px]"
          value={active?.id || ''}
          onChange={(e) => setActiveId(e.target.value)}
        >
          {local.length === 0 && <option value="">시나리오 없음</option>}
          {local.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <button className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30`} onClick={() => addScenario(null)} disabled={readOnly || local.length >= MAX_BT_SCENARIOS}>
          <Plus size={11} className="inline -mt-0.5" /> 새 시나리오
        </button>
        <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800`} onClick={() => active && addScenario(active)} disabled={readOnly || !active || local.length >= MAX_BT_SCENARIOS}>
          복제
        </button>
        <button className={`${BTN} text-red-300 border-red-900 hover:bg-red-900/30`} onClick={() => active && removeScenario(active.id)} disabled={readOnly || !active}>
          <Trash2 size={11} className="inline -mt-0.5" /> 삭제
        </button>

        <div className="flex-1" />

        <button className={`${BTN} text-emerald-300 border-emerald-800 hover:bg-emerald-900/30`} onClick={doPrint} disabled={!result?.ok}>
          <FileText size={11} className="inline -mt-0.5" /> PDF로 저장 (인쇄)
        </button>
        <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800`} onClick={downloadCsv} disabled={!result?.ok}>
          <Download size={11} className="inline -mt-0.5" /> CSV
        </button>
        {onOpenWindow && (
          <button className={`${BTN} text-indigo-300 border-indigo-800 hover:bg-indigo-900/30`} onClick={onOpenWindow} title="별도 브라우저 창에서 크게 보기">
            <ExternalLink size={11} className="inline -mt-0.5" /> 새 창
          </button>
        )}
        {onClose && (
          <button className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800" onClick={() => { promote(); onClose(); }} title="닫기">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="bt-body flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* ── 설정 패널 ── */}
        <div className="w-full lg:w-[400px] shrink-0 border-b lg:border-b-0 lg:border-r border-gray-800 overflow-y-auto p-2.5 flex flex-col gap-2 bt-noprint max-h-[45vh] lg:max-h-none">
          {!active ? (
            <div className="text-center text-gray-500 text-xs py-8">
              "새 시나리오"를 눌러 백테스트를 시작하세요.
            </div>
          ) : (
            <>
              <Section title="① 기본 설정">
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>시나리오 이름</span>
                  <input className={INPUT} value={active.name} disabled={readOnly}
                    onChange={(e) => patchActive({ name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>시작일</span>
                    <input type="date" className={INPUT} value={active.startDate} disabled={readOnly}
                      onChange={(e) => patchActive({ startDate: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>종료일</span>
                    <input type="date" className={INPUT} value={active.endDate} disabled={readOnly}
                      onChange={(e) => patchActive({ endDate: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>초기 투자금 (원)</span>
                    <NumInput value={active.initialCapital} disabled={readOnly}
                      onCommit={(v) => patchActive({ initialCapital: Math.max(0, v) })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>추가 예수금 (선택)</span>
                    <NumInput value={active.extraCash} disabled={readOnly}
                      onCommit={(v) => patchActive({ extraCash: Math.max(0, v) })} />
                  </div>
                </div>
                <p className="text-[10px] text-gray-600 leading-relaxed">
                  초기 매수 후 남는 잔돈은 자동으로 예수금이 됩니다(첨부 PDF의 15,000원).
                </p>
              </Section>

              <Section title="② 목표 기준">
                <div className="flex gap-1">
                  {[['amount', '목표 금액'], ['ratio', '목표 비중 %']].map(([v, l]) => (
                    <button key={v} disabled={readOnly}
                      className={`${BTN} flex-1 ${active.targetMode === v ? 'text-sky-200 border-sky-600 bg-sky-900/40' : 'text-gray-400 border-gray-700 hover:bg-gray-800'}`}
                      onClick={() => patchActive({ targetMode: v })}>{l}</button>
                  ))}
                </div>
                {active.targetMode === 'ratio' && (
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>비중을 곱할 기준(분모)</span>
                    <select className={INPUT} value={active.ratioBase} disabled={readOnly}
                      onChange={(e) => patchActive({ ratioBase: e.target.value })}>
                      <option value="equity">종목 평가액 합계 (현금 제외 — 현금이 계속 쌓임)</option>
                      <option value="total">종목 평가액 + 예수금 (쌓인 현금도 재투자)</option>
                      <option value="totalWithDiv">종목 평가액 + 예수금 + 누적분배금 (하락 시 현금 투입)</option>
                      <option value="initial">초기 투자금 고정 (목표금액 불변)</option>
                    </select>
                    {active.ratioBase === 'totalWithDiv' && (
                      <p className="text-[10px] text-gray-500 leading-relaxed">
                        평상시에는 <b className="text-gray-400">종목 평가액</b> 기준으로 돌다가, 평가액이
                        <b className="text-gray-400"> 초기 투자금</b>보다 작아지면 그 부족분만큼 보유 현금을
                        넣어 초기 수준까지 되삽니다. 재원은 <b className="text-gray-400">예수금을 먼저</b> 쓰고
                        모자라면 <b className="text-gray-400">누적 분배금</b>을 씁니다.
                        <br />
                        <span className="text-gray-600">
                          ※ 분배금은 지급되는 순간 예수금에 들어오므로, 결과의 예수금 칸은 두 몫을 나눠 표시합니다
                          (따로 더하면 이중 계상).
                        </span>
                      </p>
                    )}
                    <p className="text-[10px] text-gray-600 leading-relaxed">
                      첨부 PDF와 가장 가까운 것은 <b className="text-gray-400">목표 금액</b> 모드입니다(2.25억 → 4월부터 1.5억).
                    </p>
                  </div>
                )}
                <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800 w-full`} onClick={splitEven} disabled={readOnly || !active.assets.length}>
                  종목 수로 균등 분배
                </button>
              </Section>

              <Section title="②-b 매월 목표 증액 (현금 재투자)" defaultOpen={active.contribution.mode !== 'none'}>
                <p className="text-[10px] text-gray-600 leading-relaxed">
                  리밸런싱 매도 차익·분배금으로 쌓인 <b className="text-gray-400">예수금</b>을 매월 다시 투자에
                  넣습니다. 그 달 <b className="text-gray-400">첫 리밸런싱 직전</b>에 종목 목표를 올리면
                  바로 이어지는 리밸런싱이 실제로 매수합니다.
                </p>
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>증액 방식</span>
                  {/* ⚠️ 방식을 바꾸면 값을 0으로 되돌린다 — %와 원은 단위가 달라서 값을 남기면
                      '예수금의 50%'가 '매월 50원'으로 조용히 바뀐다(자릿수 7자리 차이). */}
                  <select className={INPUT} value={active.contribution.mode} disabled={readOnly}
                    onChange={(e) => patchActive({
                      contribution: {
                        ...active.contribution,
                        mode: e.target.value,
                        value: e.target.value === active.contribution.mode ? active.contribution.value : 0,
                      },
                    })}>
                    <option value="none">증액 없음 (현금을 그대로 쌓아 둠)</option>
                    <option value="pctOfCash">보유 예수금의 % 만큼</option>
                    <option value="amount">매월 고정 금액</option>
                  </select>
                </div>
                {/* ⚠️ 값 입력·배분은 mode가 'none'이면 숨기되, **예외 규칙 목록은 항상 보여준다** —
                    엔진은 mode='none'이어도 월별 예외를 그대로 실행하므로, 숨기면 사용자가 이유를
                    모르는 증액이 결과에 나타난다(설정과 동작이 갈리는 숨은 상태). */}
                {active.contribution.mode !== 'none' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <span className={LABEL}>{active.contribution.mode === 'pctOfCash' ? '비율 (%)' : '금액 (원)'}</span>
                        <NumInput value={active.contribution.value} disabled={readOnly}
                          onCommit={(v) => patchActive({ contribution: { ...active.contribution, value: Math.max(0, v) } })} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className={LABEL}>종목별 배분</span>
                        <select className={INPUT} value={active.contribution.split} disabled={readOnly}
                          onChange={(e) => patchActive({ contribution: { ...active.contribution, split: e.target.value } })}>
                          <option value="ratio">현재 목표 비율대로</option>
                          <option value="even">활성 종목에 균등</option>
                        </select>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-600 leading-relaxed">
                      증액액은 <b className="text-gray-400">보유 예수금을 넘지 않게</b> 잘립니다(넘기면 곧바로
                      '예수금 부족'이 되기 때문). 리밸런싱이 없는 달은 건너뜁니다.
                    </p>
                    {active.targetMode === 'ratio' && active.ratioBase !== 'initial' && (
                      <p className="text-[10px] text-amber-400/90 leading-relaxed">
                        ⚠️ 비중 모드에서 분모가 '{RATIO_BASE_LABEL[active.ratioBase]}'이면
                        증액이 효과가 없습니다 — 목표가 이미 파생값이기 때문입니다. 분모를
                        <b> 초기 투자금 고정</b>으로 바꾸거나 목표 <b>금액</b> 모드를 쓰세요.
                      </p>
                    )}

                  </>
                )}

                {/* 특정 월만 다른 증액 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>특정 월만 다르게</span>
                    <span className="text-[10px] text-gray-600">({active.contribOverrides.length})</span>
                    <button className={`${BTN} ml-auto text-gray-300 border-gray-700 hover:bg-gray-800`}
                      disabled={readOnly || !active.startDate || active.contribOverrides.length >= MAX_BT_CONTRIB_OVERRIDES}
                      onClick={() => {
                        const ms = monthsBetween(active.startDate, active.endDate);
                        if (!ms.length) return;
                        patchActive({
                          contribOverrides: [...active.contribOverrides, {
                            id: generateId(), ym: ms[0],
                            mode: active.contribution.mode, value: active.contribution.value,
                          }],
                        });
                      }}>
                      <Plus size={10} className="inline -mt-0.5" /> 추가
                    </button>
                  </div>
                  {active.contribOverrides.map((o) => (
                    <div key={o.id} className="flex items-center gap-1">
                      <select className={`${INPUT} w-[88px]`} value={o.ym} disabled={readOnly}
                        onChange={(e) => patchActive({ contribOverrides: active.contribOverrides.map((x) => x.id === o.id ? { ...x, ym: e.target.value } : x) })}>
                        {monthsBetween(active.startDate, active.endDate).map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {/* 방식 전환 시 값 초기화 — 위 기본 규칙과 같은 이유(% ↔ 원 단위 혼동 방지) */}
                      <select className={`${INPUT} w-[104px]`} value={o.mode} disabled={readOnly}
                        onChange={(e) => patchActive({ contribOverrides: active.contribOverrides.map((x) => x.id === o.id ? { ...x, mode: e.target.value, value: e.target.value === x.mode ? x.value : 0 } : x) })}>
                        <option value="none">증액 없음</option>
                        <option value="pctOfCash">예수금 %</option>
                        <option value="amount">고정 금액</option>
                      </select>
                      <NumInput value={o.value} disabled={readOnly || o.mode === 'none'}
                        onCommit={(v) => patchActive({ contribOverrides: active.contribOverrides.map((x) => x.id === o.id ? { ...x, value: Math.max(0, v) } : x) })} />
                      <button className="p-1 text-gray-600 hover:text-red-400 shrink-0" disabled={readOnly}
                        onClick={() => patchActive({ contribOverrides: active.contribOverrides.filter((x) => x.id !== o.id) })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="③ 리밸런싱 일정">
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>전체 정책</span>
                  <select className={INPUT} value={active.policy} disabled={readOnly}
                    onChange={(e) => patchActive({ policy: e.target.value })}>
                    <option value="perCycle">종목별 — 각자 자기 분배락 전</option>
                    <option value="allMid">일괄 — 전 종목을 월중 분배락 전에</option>
                    <option value="allEom">일괄 — 전 종목을 월말 분배락 전에</option>
                    <option value="fixedDay">일괄 — 매월 지정일</option>
                  </select>
                </div>
                {active.policy === 'fixedDay' && (
                  <div className="flex items-center gap-2">
                    <span className={LABEL}>매월</span>
                    <NumInput value={active.fixedDay} className="w-16" disabled={readOnly}
                      onCommit={(v) => patchActive({ fixedDay: Math.min(31, Math.max(1, Math.round(v))) })} />
                    <span className="text-[10px] text-gray-500">일 (휴장이면 직전 영업일)</span>
                  </div>
                )}

                <Section title="분배 일정 오프셋 (고급)" defaultOpen={false}>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>분배락 (기준일 대비)</span>
                      <NumInput value={active.exDivOffset} disabled={readOnly}
                        onCommit={(v) => patchActive({ exDivOffset: Math.min(0, Math.max(-10, Math.round(v))) })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>리밸 (분배락 대비)</span>
                      <NumInput value={active.rebalOffset} disabled={readOnly}
                        onCommit={(v) => patchActive({ rebalOffset: Math.min(0, Math.max(-10, Math.round(v))) })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>지급 (기준일 대비)</span>
                      <NumInput value={active.payOffset} disabled={readOnly}
                        onCommit={(v) => patchActive({ payOffset: Math.min(10, Math.max(0, Math.round(v))) })} />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-600 leading-relaxed">
                    기준일 = 월중 15일 / 월말 말일(휴장이면 직전 영업일). 기본값 −1·−1·+2는 첨부 PDF의
                    리밸런싱일 14개 중 12개를 정확히 재현합니다(나머지 2개는 PDF가 일요일을 쓴 오류).
                    단위는 <b className="text-gray-400">영업일</b>입니다.
                  </p>
                </Section>

                {/* 월별 오버라이드 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>특정 월만 다른 날짜에</span>
                    <span className="text-[10px] text-gray-600">({active.overrides.length})</span>
                    <button className={`${BTN} ml-auto text-gray-300 border-gray-700 hover:bg-gray-800`}
                      disabled={readOnly || !active.startDate || active.overrides.length >= MAX_BT_OVERRIDES}
                      onClick={() => {
                        const ms = monthsBetween(active.startDate, active.endDate);
                        if (!ms.length) return;
                        patchActive({
                          overrides: [...active.overrides, {
                            id: generateId(), ym: ms[0],
                            group: active.policy === 'perCycle' ? 'eom' : 'all',
                            date: `${ms[0]}-15`, assetId: '',
                          }],
                        });
                      }}>
                      <Plus size={10} className="inline -mt-0.5" /> 추가
                    </button>
                  </div>
                  {active.overrides.map((o) => (
                    <div key={o.id} className="flex items-center gap-1">
                      <select className={`${INPUT} w-[88px]`} value={o.ym} disabled={readOnly}
                        onChange={(e) => patchActive({ overrides: active.overrides.map((x) => x.id === o.id ? { ...x, ym: e.target.value } : x) })}>
                        {monthsBetween(active.startDate, active.endDate).map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {/* 대상: 그룹 일괄 / 특정 종목 하나. 값 접두사로 두 축을 한 select에 담는다. */}
                      <select className={`${INPUT} w-[112px]`} value={o.assetId ? `a:${o.assetId}` : `g:${o.group}`} disabled={readOnly}
                        onChange={(e) => {
                          const v = e.target.value;
                          patchActive({
                            overrides: active.overrides.map((x) => x.id === o.id
                              ? (v.startsWith('a:') ? { ...x, assetId: v.slice(2) } : { ...x, assetId: '', group: v.slice(2) })
                              : x),
                          });
                        }}>
                        {active.policy === 'perCycle'
                          ? <><option value="g:mid">월중 일괄</option><option value="g:eom">월말 일괄</option></>
                          : <option value="g:all">전체 일괄</option>}
                        {active.assets.map((a) => (
                          <option key={a.id} value={`a:${a.id}`}>{(a.name || a.code)}만</option>
                        ))}
                      </select>
                      <input type="date" className={INPUT} value={o.date} disabled={readOnly}
                        onChange={(e) => patchActive({ overrides: active.overrides.map((x) => x.id === o.id ? { ...x, date: e.target.value } : x) })} />
                      <button className="p-1 text-gray-600 hover:text-red-400 shrink-0" disabled={readOnly}
                        onClick={() => patchActive({ overrides: active.overrides.filter((x) => x.id !== o.id) })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-600 leading-relaxed">
                    ⚠️ 오버라이드는 <b className="text-gray-400">리밸런싱일만</b> 옮깁니다. 분배락·지급일은
                    시장이 정하는 값이라 그대로입니다. <b className="text-gray-400">일괄</b> 항목은
                    '전역 정책 따름' 종목에만 적용되고, 종목별 일정을 따로 지정한 종목은
                    <b className="text-gray-400"> ○○만</b> 항목으로 옮깁니다.
                  </p>
                </div>
              </Section>

              <Section title="④ 수량·현금 규칙">
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>매매 수량</span>
                  <select className={INPUT} value={active.rounding} disabled={readOnly}
                    onChange={(e) => patchActive({ rounding: e.target.value })}>
                    <option value="floor">내림 (0 방향) — 첨부 PDF 규약</option>
                    <option value="round">반올림</option>
                    <option value="exact">소수 허용 (펀드 좌수)</option>
                  </select>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={active.allowNegativeCash} disabled={readOnly}
                    onChange={(e) => patchActive({ allowNegativeCash: e.target.checked })} />
                  예수금이 부족해도 매수 (마이너스 예수금 허용)
                </label>
                <p className="text-[10px] text-gray-600 leading-relaxed">
                  끄면 보유 현금 한도까지만 매수하고 그 행에 "예수금 부족"으로 표시합니다.
                </p>
              </Section>

              <Section title="⑤ 종목" badge={`${active.assets.length}/${MAX_BT_ASSETS}`}>
                <div className="flex gap-1">
                  <input className={INPUT} placeholder="종목코드 (예: 498400)" value={newCode} disabled={readOnly}
                    list="bt-catalog"
                    onChange={(e) => setNewCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addAsset(newCode); }} />
                  <datalist id="bt-catalog">
                    {catalog.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </datalist>
                  <button className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30 shrink-0`}
                    disabled={readOnly || !newCode.trim()} onClick={() => addAsset(newCode)}>추가</button>
                </div>

                {active.assets.map((a, i) => {
                  const rng = seriesRange(prices[a.code]);
                  const meta = result?.assetMeta?.find((m) => m.assetId === a.id);
                  const loading = fetchingCodes.includes(a.code);
                  return (
                    <div key={a.id} className="border border-gray-800 rounded p-1.5 flex flex-col gap-1 bg-gray-900/60">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color || BT_COLORS[i % BT_COLORS.length] }} />
                        <input className={`${INPUT} flex-1`} value={a.name} disabled={readOnly}
                          onChange={(e) => patchAsset(a.id, { name: e.target.value })} placeholder="종목명" />
                        <span className="text-[10px] text-gray-500 font-mono shrink-0">{a.code}</span>
                        <button className="p-0.5 text-gray-600 hover:text-sky-300 shrink-0" title="종가 다시 조회"
                          disabled={readOnly || loading || !onFetchCode} onClick={() => onFetchCode?.(a.code, undefined, true)}>
                          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button className="p-0.5 text-gray-600 hover:text-red-400 shrink-0" disabled={readOnly}
                          onClick={() => removeAsset(a.id)}><Trash2 size={11} /></button>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <select className={INPUT} value={a.payCycle} disabled={readOnly}
                          onChange={(e) => patchAsset(a.id, { payCycle: e.target.value })}>
                          <option value="mid">월중 분배 (15일 기준)</option>
                          <option value="eom">월말 분배 (말일 기준)</option>
                          <option value="none">분배 없음</option>
                        </select>
                        {active.targetMode === 'amount' ? (
                          <NumInput value={a.targetAmount} allowEmpty placeholder="목표금액" disabled={readOnly}
                            onCommit={(v) => patchAsset(a.id, { targetAmount: v })} />
                        ) : (
                          <NumInput value={a.targetRatio} allowEmpty placeholder="목표비중 %" disabled={readOnly}
                            onCommit={(v) => patchAsset(a.id, { targetRatio: v })} />
                        )}
                      </div>
                      {/* 종목별 리밸런싱 일정 — 분배가 불규칙한 종목을 전역 정책과 다르게 돌린다.
                          ⚠️ '전역 정책 따름'이 아닌 종목은 월별 **일괄** 오버라이드에 끌려가지 않는다. */}
                      <div className="grid grid-cols-2 gap-1">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-gray-600">리밸런싱 일정</span>
                          <select className={INPUT} value={a.rebalMode} disabled={readOnly}
                            onChange={(e) => patchAsset(a.id, { rebalMode: e.target.value })}>
                            <option value="follow">전역 정책 따름</option>
                            <option value="mid">이 종목만 · 월중 분배락 전</option>
                            <option value="eom">이 종목만 · 월말 분배락 전</option>
                            <option value="day">이 종목만 · 매월 지정일</option>
                            <option value="dates">이 종목만 · 지정 날짜에만</option>
                            <option value="none">리밸런싱 안 함</option>
                          </select>
                        </label>
                        {a.rebalMode === 'day' ? (
                          <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] text-gray-600">매월 며칠 (휴장이면 직전 영업일)</span>
                            <NumInput value={a.rebalDay} disabled={readOnly}
                              onCommit={(v) => patchAsset(a.id, { rebalDay: Math.min(31, Math.max(1, Math.round(v))) })} />
                          </label>
                        ) : a.rebalMode === 'dates' ? (
                          <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] text-gray-600">날짜 추가</span>
                            <input type="date" className={INPUT} value="" disabled={readOnly || a.rebalDates.length >= MAX_BT_REBAL_DATES}
                              onChange={(e) => {
                                const d = e.target.value;
                                // ⚠️ 상한을 여기서 막지 않으면 초과분이 저장은 되고 **다음 로드에서
                                //    조용히 절삭**돼(정규화) 그때 결과가 달라진다.
                                if (!d || a.rebalDates.includes(d) || a.rebalDates.length >= MAX_BT_REBAL_DATES) return;
                                patchAsset(a.id, { rebalDates: [...a.rebalDates, d].sort() });
                              }} />
                          </label>
                        ) : <span />}
                      </div>
                      {a.rebalMode === 'dates' && (
                        <div className="flex flex-wrap gap-1">
                          {a.rebalDates.length === 0 && (
                            <span className="text-[9px] text-amber-400/90">날짜를 하나도 지정하지 않으면 이 종목은 리밸런싱되지 않습니다.</span>
                          )}
                          {a.rebalDates.map((d) => (
                            <button key={d} disabled={readOnly}
                              title="클릭하여 제거"
                              className="px-1 py-0.5 rounded text-[9px] border border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-300"
                              onClick={() => patchAsset(a.id, { rebalDates: a.rebalDates.filter((x) => x !== d) })}>
                              {d} ✕
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-gray-600">편입일 (비우면 자동)</span>
                          <input type="date" className={INPUT} value={a.startDate} disabled={readOnly}
                            onChange={(e) => patchAsset(a.id, { startDate: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-gray-600">제외일 (선택)</span>
                          <input type="date" className={INPUT} value={a.endDate} disabled={readOnly}
                            onChange={(e) => patchAsset(a.id, { endDate: e.target.value })} />
                        </label>
                      </div>
                      {/* 데이터 범위 배지 — 조회기간 중간 상장/결측을 눈에 띄게 */}
                      <div className="flex flex-wrap items-center gap-1 text-[9px]">
                        {loading ? (
                          <span className="px-1 py-0.5 rounded bg-sky-900/40 text-sky-300 border border-sky-800">조회 중…</span>
                        ) : rng.count === 0 ? (
                          <span className="px-1 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-800">종가 데이터 없음</span>
                        ) : (
                          <>
                            <span className="px-1 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                              {rng.first} ~ {rng.last} · {rng.count}일
                            </span>
                            {meta?.lateStart && (
                              <span className="px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800">
                                {meta.effectiveStart}부터 편입
                              </span>
                            )}
                            {meta?.earlyEnd && (
                              <span className="px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800">
                                {meta.lastDate}에 기록 끊김
                              </span>
                            )}
                            {meta?.gapCount > 0 && (
                              <span className="px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800">
                                결측 {meta.gapCount}구간
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                <button className={`${BTN} text-gray-400 border-gray-700 hover:bg-gray-800 w-full`}
                  onClick={() => setPasteOpen((v) => !v)}>
                  종가 직접 붙여넣기 (앱·API에 없는 종목)
                </button>
                {pasteOpen && (
                  <div className="flex flex-col gap-1 border border-gray-800 rounded p-1.5">
                    <input className={INPUT} placeholder="종목코드" value={pasteCode} onChange={(e) => setPasteCode(e.target.value)} />
                    <textarea className={`${INPUT} h-24 font-mono text-[10px]`} placeholder={'2026-01-02, 19500\n2026-01-05, 19600\n…'}
                      value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                    <div className="flex items-center gap-1">
                      <button className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30`}
                        disabled={readOnly || !pasteCode.trim() || !pasteText.trim()}
                        onClick={() => {
                          const { data, ok: n, bad } = parsePastedSeries(pasteText);
                          if (!n) { setPasteMsg('인식된 줄이 없습니다. "날짜, 종가" 형식인지 확인해 주세요.'); return; }
                          onFetchCode?.(pasteCode.trim().toUpperCase(), data);
                          setPasteMsg(`${n}건 적용${bad ? ` (${bad}건 무시)` : ''}`);
                          addAsset(pasteCode);
                          setPasteText('');
                        }}>적용</button>
                      {pasteMsg && <span className="text-[10px] text-gray-500">{pasteMsg}</span>}
                    </div>
                  </div>
                )}
              </Section>

              <Section title="⑥ 중도 종목 변경 / 추가" badge={`${active.events.length}/${MAX_BT_EVENTS}`} defaultOpen={active.events.length > 0}>
                <button className={`${BTN} text-sky-300 border-sky-800 hover:bg-sky-900/30 w-full`}
                  disabled={readOnly || active.events.length >= MAX_BT_EVENTS}
                  onClick={() => patchActive({
                    events: [...active.events, {
                      id: generateId(), date: active.startDate || '', label: '종목 재편',
                      funding: 'reallocate', addAssets: [], removeAssets: [],
                      targets: active.assets.map((a) => ({ assetId: a.id, amount: null, ratio: null })),
                    }],
                  })}>
                  <Plus size={11} className="inline -mt-0.5" /> 이벤트 추가
                </button>
                {active.events.map((e) => (
                  <div key={e.id} className="border border-gray-800 rounded p-1.5 flex flex-col gap-1 bg-gray-900/60">
                    <div className="flex items-center gap-1">
                      <input type="date" className={`${INPUT} w-[130px]`} value={e.date} disabled={readOnly}
                        onChange={(ev) => patchActive({ events: active.events.map((x) => x.id === e.id ? { ...x, date: ev.target.value } : x) })} />
                      <input className={`${INPUT} flex-1`} value={e.label} placeholder="설명" disabled={readOnly}
                        onChange={(ev) => patchActive({ events: active.events.map((x) => x.id === e.id ? { ...x, label: ev.target.value } : x) })} />
                      <button className="p-0.5 text-gray-600 hover:text-red-400 shrink-0" disabled={readOnly}
                        onClick={() => patchActive({ events: active.events.filter((x) => x.id !== e.id) })}><Trash2 size={11} /></button>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className={LABEL}>금액 조정 방식</span>
                      <select className={INPUT} value={e.funding} disabled={readOnly}
                        onChange={(ev) => patchActive({ events: active.events.map((x) => x.id === e.id ? { ...x, funding: ev.target.value } : x) })}>
                        <option value="reallocate">전체 재편 — 기존 종목을 팔아 새 목표로 다 같이 맞춤</option>
                        <option value="cash">보유 현금으로만 — 신규 종목만 매수, 기존은 그대로</option>
                        <option value="defer">목표만 변경 — 매매는 다음 정기 리밸런싱에서</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className={LABEL}>이 날짜부터 편입할 종목</span>
                      <div className="flex flex-wrap gap-1">
                        {active.assets.map((a) => {
                          const on = e.addAssets.includes(a.id);
                          return (
                            <button key={a.id} disabled={readOnly}
                              className={`px-1.5 py-0.5 rounded text-[10px] border ${on ? 'text-emerald-200 border-emerald-700 bg-emerald-900/40' : 'text-gray-500 border-gray-700'}`}
                              onClick={() => patchActive({
                                events: active.events.map((x) => x.id === e.id ? {
                                  ...x, addAssets: on ? x.addAssets.filter((y) => y !== a.id) : [...x.addAssets, a.id],
                                } : x),
                              })}>{a.name || a.code}</button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className={LABEL}>이 날짜에 전량 매도할 종목</span>
                      <div className="flex flex-wrap gap-1">
                        {active.assets.map((a) => {
                          const on = e.removeAssets.includes(a.id);
                          return (
                            <button key={a.id} disabled={readOnly}
                              className={`px-1.5 py-0.5 rounded text-[10px] border ${on ? 'text-red-200 border-red-800 bg-red-900/40' : 'text-gray-500 border-gray-700'}`}
                              onClick={() => patchActive({
                                events: active.events.map((x) => x.id === e.id ? {
                                  ...x, removeAssets: on ? x.removeAssets.filter((y) => y !== a.id) : [...x.removeAssets, a.id],
                                } : x),
                              })}>{a.name || a.code}</button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className={LABEL}>이 날짜 이후 새 목표 ({active.targetMode === 'amount' ? '금액' : '비중 %'})</span>
                      {active.assets.map((a) => {
                        const t = e.targets.find((x) => x.assetId === a.id);
                        const val = active.targetMode === 'amount' ? (t?.amount ?? null) : (t?.ratio ?? null);
                        return (
                          <div key={a.id} className="flex items-center gap-1">
                            <span className="text-[10px] text-gray-500 flex-1 truncate">{a.name || a.code}</span>
                            <NumInput value={val} allowEmpty placeholder="변경 없음" className="w-28" disabled={readOnly}
                              onCommit={(v) => patchActive({
                                events: active.events.map((x) => x.id === e.id ? {
                                  ...x,
                                  targets: [
                                    ...x.targets.filter((y) => y.assetId !== a.id),
                                    { assetId: a.id, amount: active.targetMode === 'amount' ? v : (t?.amount ?? null), ratio: active.targetMode === 'ratio' ? v : (t?.ratio ?? null) },
                                  ],
                                } : x),
                              })} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </Section>
            </>
          )}
        </div>

        {/* ── 결과 ── */}
        <div id="bt-print" className="flex-1 min-w-0 overflow-y-auto p-3">
          {!active ? null : !result ? (
            <div className="text-center text-gray-500 text-xs py-10">계산 중…</div>
          ) : !result.ok ? (
            <div className="max-w-lg mx-auto mt-10 border border-amber-800/60 bg-amber-900/20 rounded-lg p-4 text-center">
              <AlertCircle size={20} className="text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-amber-200">{result.fatal}</p>
            </div>
          ) : (
            <>
              {/* 표제 */}
              <div className="mb-3">
                <h2 className="text-base font-bold text-gray-100">📊 {active.name} — 리밸런싱 백테스트</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  기간 {result.summary.startDate} ~ {result.summary.endDate} · 초기 투자금 {won(active.initialCapital)}
                  {active.extraCash > 0 && ` (+ 예수금 ${won(active.extraCash)})`} ·
                  {' '}{active.targetMode === 'amount' ? '목표금액' : `목표비중(${RATIO_BASE_LABEL[active.ratioBase]})`} ·
                  {' '}수량 {active.rounding === 'floor' ? '내림' : active.rounding === 'round' ? '반올림' : '소수 허용'}
                </p>
              </div>

              {/* 요약 카드 */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mb-3">
                {[
                  ['최종 자산', won(result.summary.finalTotal), pnlCls(result.summary.profit)],
                  ['총 손익', wonSigned(result.summary.profit), pnlCls(result.summary.profit)],
                  ['수익률', pctText(result.summary.profitRate), pnlCls(result.summary.profit)],
                  ['누적 매매차익', wonSigned(result.summary.cumTradeNet), pnlCls(result.summary.cumTradeNet)],
                  ['누적 분배금', won(result.summary.cumDivAccrued), 'text-emerald-400'],
                  ['기말 예수금', won(result.summary.finalCash), 'text-gray-200'],
                ].map(([label, val, cls]) => (
                  <div key={label} className="border border-gray-800 rounded-lg px-2.5 py-2 bg-gray-900/50">
                    <div className="text-[10px] text-gray-500">{label}</div>
                    <div className={`text-sm font-bold ${cls}`}>{val}</div>
                  </div>
                ))}
              </div>

              <div className="border border-gray-800 rounded-lg p-2 bg-gray-900/40 mb-3">
                <CurveChart curve={result.curve} />
              </div>

              {/* 경고 */}
              {result.warnings.length > 0 && (
                <div className="border border-amber-800/50 bg-amber-900/15 rounded-lg p-2 mb-3">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-amber-300 mb-1">
                    <AlertCircle size={11} /> 확인이 필요한 항목 ({result.warnings.length})
                  </div>
                  <ul className="text-[10px] text-amber-200/80 leading-relaxed list-disc pl-4">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {/* Phase 0 */}
              <div className="mb-4 bt-month">
                <h3 className="text-xs font-bold text-gray-300 mb-1">🏁 [Phase 0] 초기 자본 투입 — {result.initialDate}</h3>
                <div className="overflow-x-auto border border-gray-800 rounded-lg">
                  <table className="w-full text-[11px] min-w-[560px]">
                    <thead className="bg-gray-800/70 text-gray-400">
                      <tr>
                        <th className="px-2 py-1 text-left font-bold">종목명</th>
                        <th className="px-2 py-1 text-right font-bold">당일 종가</th>
                        <th className="px-2 py-1 text-right font-bold">매수 수량</th>
                        <th className="px-2 py-1 text-right font-bold">매수 금액</th>
                        <th className="px-2 py-1 text-right font-bold">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.initialTrades.map((t) => (
                        <tr key={t.assetId} className="border-t border-gray-800/70">
                          <td className="px-2 py-1 text-gray-200">{t.name} <span className="text-gray-600 font-mono text-[10px]">{t.code}</span></td>
                          <td className="px-2 py-1 text-right text-gray-300">{won(t.price)}</td>
                          <td className="px-2 py-1 text-right text-gray-200">{qtyText(t.qty)}주</td>
                          <td className="px-2 py-1 text-right text-gray-200">{won(Math.abs(t.cashDelta))}</td>
                          <td className="px-2 py-1 text-right text-gray-500 text-[10px]">목표 {won(t.target)}{t.note && ` · ${t.note}`}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                        <td className="px-2 py-1 text-gray-300">합계</td>
                        <td className="px-2 py-1 text-right text-gray-600">-</td>
                        <td className="px-2 py-1 text-right text-gray-200">{qtyText(result.initialTrades.reduce((s, t) => s + t.qty, 0))}주</td>
                        <td className="px-2 py-1 text-right text-gray-200">{won(result.initialTrades.reduce((s, t) => s + Math.abs(t.cashDelta), 0))}</td>
                        <td className="px-2 py-1 text-right text-emerald-300">잔여 예수금 {won(result.initialCashAfter)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 월별 */}
              {result.months.map((m) => {
                const { rows, orphans } = joinTradeDividends(m.trades, m.dividends);
                // ⚠️ 보유가 있으면 거래·분배가 없는 달도 렌더한다 — 이 기능의 목적이 "이번 달에
                //    손대지 않은 종목이 몇 주인지"이고, CSV는 이미 그 달을 무조건 내보내므로
                //    여기서만 스킵하면 화면과 CSV가 갈린다.
                if (!rows.length && !orphans.length && !m.holdings.length) return null;
                const hasTable = rows.length > 0 || orphans.length > 0;
                // 같은 종목이 두 번 이상 거래된 달인가(합계 셀 중복 계상 판정)
                const seenAsset = new Set<string>();
                let dupTraded = false;
                for (const t of m.trades) {
                  if (seenAsset.has(t.assetId)) { dupTraded = true; break; }
                  seenAsset.add(t.assetId);
                }
                return (
                  <div key={m.ym} className="mb-4 bt-month">
                    <h3 className="text-xs font-bold text-gray-300 mb-1">
                      📅 {m.ym.replace('-', '년 ')}월
                      {!hasTable && <span className="ml-1 font-normal text-gray-600 text-[10px]">— 이 달은 매매·분배가 없습니다</span>}
                    </h3>
                    {hasTable && (
                    <div className="overflow-x-auto border border-gray-800 rounded-lg">
                      <table className="w-full text-[11px] min-w-[1090px]">
                        <thead className="bg-gray-800/70 text-gray-400">
                          <tr>
                            <th className="px-2 py-1 text-left font-bold">리밸런싱일</th>
                            <th className="px-2 py-1 text-left font-bold">대상 종목</th>
                            <th className="px-2 py-1 text-right font-bold">종가</th>
                            <th className="px-2 py-1 text-right font-bold">리밸런싱 전 평가액</th>
                            <th className="px-2 py-1 text-right font-bold">매수/매도</th>
                            <th className="px-2 py-1 text-right font-bold">매매 금액</th>
                            <th className="px-2 py-1 text-right font-bold">조정 후 수량</th>
                            <th className="px-2 py-1 text-right font-bold">조정 후 평가액</th>
                            <th className="px-2 py-1 text-center font-bold">분배락일</th>
                            <th className="px-2 py-1 text-center font-bold">지급일</th>
                            <th className="px-2 py-1 text-right font-bold">주당 분배금</th>
                            <th className="px-2 py-1 text-right font-bold">지급 분배금</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ trade: t, dividend: d }, i) => (
                            <tr key={`${t.assetId}-${t.date}-${i}`}
                              className={`border-t border-gray-800/70 ${t.structural ? 'bg-gray-800/40' : ''}`}>
                              <td className="px-2 py-1 text-gray-300 whitespace-nowrap">
                                {t.date}
                                {t.structural && <span className="ml-1 text-[9px] text-amber-400">재편</span>}
                                {!t.priceExact && <span className="ml-1 text-[9px] text-amber-400" title="그 날짜 종가가 없어 직전 종가를 사용">≈</span>}
                              </td>
                              <td className="px-2 py-1 text-gray-200 whitespace-nowrap">{t.name}</td>
                              <td className="px-2 py-1 text-right text-gray-300">{won(t.price)}</td>
                              <td className="px-2 py-1 text-right text-gray-300">{won(t.evalBefore)}</td>
                              <td className={`px-2 py-1 text-right font-bold ${t.qty < 0 ? 'text-blue-300' : 'text-red-300'}`}>
                                {qtyText(Math.abs(t.qty))}주 {t.qty < 0 ? '매도' : '매수'}
                              </td>
                              <td className={`px-2 py-1 text-right ${pnlCls(t.cashDelta)}`}>{wonSigned(t.cashDelta)}</td>
                              <td className="px-2 py-1 text-right text-gray-200">{qtyText(t.qtyAfter)}주</td>
                              {/* 조정 후 평가액 = 조정 후 수량 × 그날 종가 (BtTrade.evalAfter) */}
                              <td className="px-2 py-1 text-right text-gray-200">{won(t.evalAfter)}</td>
                              <td className="px-2 py-1 text-center text-gray-500 text-[10px] whitespace-nowrap">{d?.exDate || '-'}</td>
                              <td className="px-2 py-1 text-center text-gray-500 text-[10px] whitespace-nowrap">{d?.payDate || '-'}</td>
                              <td className="px-2 py-1 text-right">
                                {d ? (
                                  <DivInput
                                    value={d.perShare}
                                    unknown={d.source === 'none'}
                                    disabled={readOnly}
                                    title={d.source === 'history' ? '계좌 분배금 이력' : d.source === 'manual' ? '직접 입력' : '이력 없음 — 직접 입력하세요'}
                                    onCommit={(v) => patchAsset(d.assetId, {
                                      divOverride: { ...(active.assets.find((a) => a.id === d.assetId)?.divOverride || {}), [d.ym]: v },
                                    })}
                                  />
                                ) : <span className="text-gray-700">-</span>}
                              </td>
                              <td className="px-2 py-1 text-right text-emerald-300">{d ? won(d.amount) : <span className="text-gray-700">-</span>}</td>
                            </tr>
                          ))}
                          {orphans.map((d, i) => (
                            <tr key={`orphan-${i}`} className="border-t border-gray-800/70">
                              <td className="px-2 py-1 text-gray-600 text-[10px]">(리밸런싱 없음)</td>
                              <td className="px-2 py-1 text-gray-300">{d.name}</td>
                              <td colSpan={4} className="px-2 py-1 text-right text-gray-700">-</td>
                              <td className="px-2 py-1 text-right text-gray-300">{qtyText(d.qty)}주</td>
                              <td className="px-2 py-1 text-right text-gray-700">-</td>
                              <td className="px-2 py-1 text-center text-gray-500 text-[10px]">{d.exDate}</td>
                              <td className="px-2 py-1 text-center text-gray-500 text-[10px]">{d.payDate}</td>
                              <td className="px-2 py-1 text-right text-gray-300">{formatNumber(d.perShare)}</td>
                              <td className="px-2 py-1 text-right text-emerald-300">{won(d.amount)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                            <td className="px-2 py-1 text-gray-300">합계</td>
                            <td className="px-2 py-1 text-gray-600">-</td>
                            <td className="px-2 py-1 text-right text-gray-600">-</td>
                            {/* ⚠️ 평가액 합계는 **한 종목이 그 달에 두 번 이상 거래되면 렌더하지 않는다**.
                                evalBefore/evalAfter는 거래 시점의 '포지션 전체 평가액'이라 거래 단위로 더하면
                                같은 종목이 중복 계상된다(재편+정기 리밸런싱이 겹친 달에서 실측 2.17배).
                                첨부 PDF도 정확히 그런 달(4월)의 합계를 '-'로 비워 뒀다 — 그 규약을 따른다.
                                시점 정합 총액은 아래 '월말 보유 현황 · 종목 합계'가 담당한다. */}
                            <td className="px-2 py-1 text-right text-gray-200" title={dupTraded ? '같은 종목이 이 달에 두 번 이상 거래되어 단순 합이 중복 계상됩니다 — 아래 월말 보유 현황을 참고하세요.' : undefined}>
                              {dupTraded ? <span className="text-gray-600 font-normal">-</span> : won(m.evalBeforeSum)}
                            </td>
                            <td className="px-2 py-1 text-right text-gray-600">-</td>
                            <td className={`px-2 py-1 text-right ${pnlCls(m.tradeNet)}`}>{wonSigned(m.tradeNet)}</td>
                            <td className="px-2 py-1 text-right text-gray-600">-</td>
                            <td className="px-2 py-1 text-right text-gray-200" title={dupTraded ? '같은 종목이 이 달에 두 번 이상 거래되어 단순 합이 중복 계상됩니다 — 아래 월말 보유 현황을 참고하세요.' : undefined}>
                              {dupTraded ? <span className="text-gray-600 font-normal">-</span> : won(rows.reduce((s, r) => s + r.trade.evalAfter, 0))}
                            </td>
                            <td colSpan={3} className="px-2 py-1 text-right text-gray-600">-</td>
                            <td className="px-2 py-1 text-right text-emerald-300">{won(m.divAccrued)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    )}
                    {/* 매월 목표 증액 — 리밸런싱 직전에 예수금을 목표로 옮긴 내역.
                        위 표의 매수 수량이 왜 늘었는지를 설명하는 값이라 표 바로 아래에 둔다. */}
                    {m.contribution && m.contribution.amount > 0 && (
                      <div className="mt-1 border border-sky-900/60 rounded-lg bg-sky-950/30 px-2 py-1.5">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px]">
                          <span className="text-sky-300 font-bold">
                            목표 증액 {won(m.contribution.amount)}
                            {m.contribution.overridden && <span className="ml-1 text-amber-400 font-normal">(이 달 전용 규칙)</span>}
                          </span>
                          <span className="text-gray-500">
                            {m.contribution.date} · 예수금 {won(m.contribution.cashBefore)}의{' '}
                            {m.contribution.mode === 'pctOfCash' ? `${m.contribution.value}%` : '고정 금액'}
                          </span>
                          {m.contribution.note && <span className="text-amber-400/90">{m.contribution.note}</span>}
                          {Math.round(m.contribution.requested) !== m.contribution.amount && (
                            <span className="text-gray-600">요청 {won(m.contribution.requested)}</span>
                          )}
                        </div>
                        {m.contribution.perAsset.some((x) => x.added > 0) && (
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                            {m.contribution.perAsset.filter((x) => x.added > 0).map((x) => (
                              <span key={x.assetId} className="text-[10px] whitespace-nowrap">
                                <span className="text-gray-400">{x.name}</span>
                                <span className="text-sky-300"> +{won(x.added)}</span>
                                <span className="text-gray-600"> → 목표 {won(x.targetAfter)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* 월말 보유 — ⚠️ 위 표는 '그 달 거래된 종목'만 행이 생기므로, 이 블록이 없으면
                        이번 달에 손대지 않은 종목의 수량·평가금액을 확인할 길이 없다. 모든 보유 종목을
                        같은 시점(월말 영업일)의 종가로 평가한 값이라 합계가 월말 총자산과 정합한다. */}
                    {m.holdings.length > 0 && (
                      <div className="mt-1 border border-gray-800/70 rounded-lg bg-gray-900/30 px-2 py-1.5">
                        <div className="text-[10px] text-gray-500 font-bold mb-1">
                          월말 보유 현황 <span className="font-normal text-gray-600">({m.lastDate} 종가 기준)</span>
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1">
                          {m.holdings.map((h) => (
                            <span key={h.assetId} className="text-[10px] whitespace-nowrap">
                              <b className="text-gray-300">{h.name}</b>
                              <span className="text-gray-500"> {qtyText(h.qty)}주 · </span>
                              <b className="text-gray-200">{won(h.evalAmount)}</b>
                              <span className="text-gray-600"> ({h.weight.toFixed(1)}%)</span>
                              {!h.priceExact && <span className="text-amber-400" title="그 날짜 종가가 없어 직전 종가를 사용">≈</span>}
                            </span>
                          ))}
                          <span className="text-[10px] whitespace-nowrap">
                            <span className="text-gray-500">종목 합계 </span>
                            <b className="text-gray-100">{won(m.evalEnd)}</b>
                          </span>
                        </div>
                      </div>
                    )}
                    {/* 월 요약 줄 */}
                    <div className="mt-1 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-0.5 text-[10px] px-1">
                      <span className="text-gray-500">누적 매매차익 <b className={pnlCls(m.cumTradeNet)}>{wonSigned(m.cumTradeNet)}</b></span>
                      <span className="text-gray-500">월 분배금 <b className="text-emerald-300">{won(m.divAccrued)}</b></span>
                      <span className="text-gray-500">누적 분배금 <b className="text-emerald-300">{won(m.cumDivAccrued)}</b></span>
                      <span className="text-gray-500">월 현금 증감 <b className={pnlCls(m.cashDelta)}>{wonSigned(m.cashDelta)}</b></span>
                      <span className="text-gray-500">
                        월말 예수금 <b className="text-gray-300">{won(m.cashEnd)}</b>
                        {/* 분배금 몫이 남아 있을 때만 분해를 보여 준다(합 = 예수금, 이중 계상 아님) */}
                        {m.cashDivEnd > 0.5 && (
                          <span className="text-gray-600"> (매매 {won(m.cashTradeEnd)} · 분배금 {won(m.cashDivEnd)})</span>
                        )}
                      </span>
                      <span className="text-gray-500">월말 총자산 <b className="text-gray-200">{won(m.totalEnd)}</b></span>
                      {m.cumContribution > 0 && (
                        <span className="text-gray-500">누적 증액 <b className="text-sky-300">{won(m.cumContribution)}</b></span>
                      )}
                      {m.structuralNet !== 0 && (
                        <span className="text-amber-400/80 col-span-2">
                          ※ 종목 재편 순현금 {wonSigned(m.structuralNet)} — 매매차익에는 포함하지 않습니다
                        </span>
                      )}
                      {Math.abs(m.divPaid - m.divAccrued) > 0.5 && (
                        <span className="text-gray-600 col-span-2 xl:col-span-4">
                          ※ 이 달에 실제 입금된 분배금은 {won(m.divPaid)} (월말 분배는 지급일이 다음 달 초)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 최종 보유 */}
              <div className="mb-4 bt-month">
                <h3 className="text-xs font-bold text-gray-300 mb-1">🏁 기말 보유 현황 — {result.summary.endDate}</h3>
                <div className="overflow-x-auto border border-gray-800 rounded-lg">
                  <table className="w-full text-[11px] min-w-[560px]">
                    <thead className="bg-gray-800/70 text-gray-400">
                      <tr>
                        <th className="px-2 py-1 text-left font-bold">종목명</th>
                        <th className="px-2 py-1 text-right font-bold">기말 종가</th>
                        <th className="px-2 py-1 text-right font-bold">보유 수량</th>
                        <th className="px-2 py-1 text-right font-bold">평가금액</th>
                        <th className="px-2 py-1 text-right font-bold">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.finalHoldings.map((h) => (
                        <tr key={h.assetId} className="border-t border-gray-800/70">
                          <td className="px-2 py-1 text-gray-200">{h.name} <span className="text-gray-600 font-mono text-[10px]">{h.code}</span></td>
                          <td className="px-2 py-1 text-right text-gray-300">{won(h.price)}{!h.priceExact && <span className="text-amber-400 ml-0.5">≈</span>}</td>
                          <td className="px-2 py-1 text-right text-gray-200">{qtyText(h.qty)}주</td>
                          <td className="px-2 py-1 text-right text-gray-200">{won(h.evalAmount)}</td>
                          <td className="px-2 py-1 text-right text-gray-400">{h.weight.toFixed(1)}%</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                        <td className="px-2 py-1 text-gray-300">예수금</td>
                        <td colSpan={2} className="px-2 py-1 text-right text-gray-600">-</td>
                        <td className="px-2 py-1 text-right text-emerald-300">{won(result.summary.finalCash)}</td>
                        <td className="px-2 py-1 text-right text-gray-600">-</td>
                      </tr>
                      {/* 예수금 원천별 세분화 — ⚠️ 합이 정확히 기말 예수금이 되는 항등식이다(검증 #110):
                          초기 매수 후 잔여 + 누적 매매차익 + 종목 재편 순현금 + 누적 분배금(지급 기준).
                          ⚠️ 분배금은 반드시 **지급 기준**(cumDivPaid) — 분배락 기준(cumDivAccrued)에는
                          아직 현금이 안 된 몫이 섞여 있어 소계가 예수금과 어긋난다(검증 #110b). */}
                      {[
                        { key: 'init', label: '초기 매수 후 잔여', value: result.initialCashAfter, signed: false },
                        { key: 'trade', label: '누적 매매차익', value: result.summary.cumTradeNet, signed: true },
                        { key: 'struct', label: '종목 재편 순현금', value: result.summary.cumStructuralNet, signed: true },
                        { key: 'div', label: '누적 분배금', value: result.summary.cumDivPaid, signed: false },
                      ].filter((p) => Math.round(p.value) !== 0).map((p) => (
                        <tr key={p.key} className="border-t border-gray-800/40">
                          <td className="px-2 py-1 pl-6 text-gray-500 text-[10px]">
                            └ {p.label}
                            {p.key === 'div' && Math.abs(result.summary.cumDivAccrued - result.summary.cumDivPaid) > 0.5 && (
                              <span className="text-gray-600" title="분배락 기준 누적 분배금 — 지급일이 종료일 이후인 몫은 아직 현금이 아니다">
                                {' '}(분배락 기준 {won(result.summary.cumDivAccrued)})
                              </span>
                            )}
                            {p.key === 'div' && result.summary.cumDivPaid - result.summary.finalCashDiv > 0.5 && (
                              <span className="text-gray-600">
                                {' '}· 이 중 {won(result.summary.cumDivPaid - result.summary.finalCashDiv)}는 매수에 사용
                              </span>
                            )}
                          </td>
                          <td colSpan={2} className="px-2 py-1 text-right text-gray-700">-</td>
                          <td className={`px-2 py-1 text-right text-[11px] ${p.signed ? pnlCls(p.value) : 'text-gray-300'}`}>
                            {p.signed ? wonSigned(p.value) : won(p.value)}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-700">-</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 bg-gray-800/60 font-bold">
                        <td className="px-2 py-1 text-gray-200">총자산</td>
                        <td colSpan={2} className="px-2 py-1 text-right text-gray-600">-</td>
                        <td className="px-2 py-1 text-right text-gray-100">{won(result.summary.finalTotal)}</td>
                        <td className={`px-2 py-1 text-right ${pnlCls(result.summary.profit)}`}>{pctText(result.summary.profitRate)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 각주 */}
              <div className="border-t border-gray-800 pt-2 text-[10px] text-gray-600 leading-relaxed">
                <div className="flex items-start gap-1">
                  <HelpCircle size={11} className="mt-0.5 shrink-0" />
                  <div>
                    <p>
                      지급기준일 = 월중 15일 / 월말 말일(휴장이면 직전 영업일) · <b>분배락 = 기준일 {active.exDivOffset}영업일</b> ·
                      <b> 리밸런싱 = 분배락 {active.rebalOffset}영업일</b>(분배금을 받을 수 있는 마지막 매수일) ·
                      <b> 지급 = 기준일 +{active.payOffset}영업일</b>.
                    </p>
                    <p>
                      '지급 분배금' 열과 월 합계는 <b>분배락 기준 월</b>로 묶습니다. 현금 잔고는 실제
                      <b> 지급일</b>에만 늘어나므로, 월말 분배는 다음 달 초에 예수금으로 들어옵니다.
                    </p>
                    <p>
                      회색 '재편' 행은 종목 편입·교체를 위한 구조 변경 매매라 <b>누적 매매차익에 포함하지 않습니다</b>.
                    </p>
                    <p>
                      세금·거래수수료·슬리피지·분배금 재투자 지연은 반영하지 않았습니다. 종가는 앱에 저장된
                      일별 종가를 사용하며, 그 날짜 기록이 없으면 직전 종가로 이월합니다(≈ 표시).
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // ⚠️ document.body 직속 포털 — 위 인쇄 규칙(`body > *:not(.bt-shell)`)이 성립하려면
  //    두 모드 모두에서 .bt-shell 이 body의 직계 자식이어야 한다.
  return createPortal(content, document.body);
}
