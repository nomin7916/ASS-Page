// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// ⚠️ 여기 있는 아이콘은 **이 저장소가 이미 쓰고 있어 lucide 0.577.0에 실재가 확인된 것**만이다.
//    package-lock.json도 node_modules도 없어 새 아이콘이 이 버전에 있는지 확인할 수단이 없고,
//    없으면 undefined 컴포넌트 렌더로 페이지가 통째로 죽는다(UserInfoBar FlowIcon 주석과 동일 근거).
//    특히 `AlertTriangle`은 lucide 0.4x에서 `TriangleAlert`로 개명됐다 → AlertCircle을 쓴다.
import {
  BarChart3, Plus, Trash2, FileText, ExternalLink, X, Download, RefreshCw,
  AlertCircle, ChevronDown, ChevronRight, HelpCircle, PanelLeft, PanelLeftClose,
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

/**
 * 목표 기준 라벨 — 설정 배지·표제·비교 표·CSV가 같은 이름을 쓴다.
 *
 * ⚠️ 비중의 분모는 **종목 평가액 합계 하나로 고정**이다(사용자 정의 2026-08) — 분모를 고르던
 *    옛 드롭다운(RATIO_BASE_LABEL 4종)은 제거됐다. 되살리지 말 것.
 */
const TARGET_MODE_LABEL = {
  amount: '목표금액',
  ratio: '목표비중',
};

/** 리밸런싱 정책 라벨 — 설정 드롭다운·표제·비교 표가 같은 이름을 쓴다. */
const POLICY_LABEL = {
  perCycle: '종목별 · 자기 분배락 전',
  allMid: '일괄 · 월중 분배락 전',
  allEom: '일괄 · 월말 분배락 전',
  fixedDay: '일괄 · 매월 지정일',
  none: '리밸런싱 안 함',
};

/** 분배금 처리 라벨. */
const DIV_REINVEST_LABEL = {
  hold: '현금 보유',
  payDate: '지급일 재매수',
  mid: '월중 매수',
  eom: '월말 매수',
};

/** 분배금 재투자 배분 기준 라벨. */
const DIV_SPLIT_LABEL = {
  target: '목표 비중대로',
  source: '분배금 준 종목',
  even: '균등',
};

/**
 * '전체 백테스트 비교 종합' 뷰를 가리키는 예약 id.
 * ⚠️ 시나리오 id는 generateId() 산출물이라 이 문자열과 절대 충돌하지 않는다.
 */
const COMPARE_ID = '__compare__';

const INPUT = 'bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none focus:border-sky-500 w-full';
const LABEL = 'text-[10px] text-gray-500 font-bold';
const BTN = 'px-2 py-1 rounded text-[11px] font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * 결과 표 셀 규격 — 사용자 요청(2026-08): 칸이 좁고 글씨가 작아 시뮬레이션 내용을 읽기 어렵다.
 * ⚠️ 키우는 것은 **화면뿐**이다 — 인쇄(A4 가로)는 아래 print CSS가 다시 9px/좁은 여백으로 되돌린다.
 *    12열짜리 월별 표가 한 장에 들어가야 하기 때문이다(그대로 인쇄하면 열이 잘려 판독 불가).
 */
const TBL = 'w-full text-[13px] bt-tbl';
const TH = 'px-3 py-2 font-bold whitespace-nowrap';
const TD = 'px-3 py-2.5';

/**
 * 호버 설명 팝오버.
 *
 * ⚠️ 반드시 `position: fixed` + getBoundingClientRect로 좌표를 잡는다 — 설정 패널이
 *    `overflow-y-auto`인데 CSS는 한 축만 지정해도 **다른 축이 auto로 계산**되므로, 일반
 *    absolute 툴팁은 패널 안에서 잘려 아예 보이지 않는다.
 * ⚠️ 스크롤·리사이즈가 나면 좌표가 낡으므로 즉시 닫는다(마우스가 요소 밖으로 나가지 않아
 *    mouseleave가 안 뜨는 경우가 있다).
 */
const POP_CLS = 'fixed z-[1200] rounded-lg border border-gray-600 bg-[#111a2b] shadow-2xl px-3 py-2 leading-relaxed bt-noprint';

/**
 * 팝오버 배치 스타일 — Hint와 SummaryCard가 **같은 함수**를 쓴다(손복제 금지).
 * maxHeight/overflowY가 빠지면 아래 useHoverPop의 상한이 화면에 반영되지 않는다.
 */
const popStyle = (pos) => ({
  left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.w,
  maxHeight: pos.maxH, overflowY: 'auto',
});

function useHoverPop(width = 320) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const open = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.max(200, Math.min(width, window.innerWidth - 16));
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom;
    const placeBelow = below >= 220 || below >= r.top;
    // ⚠️ 높이 상한이 없으면 브라우저를 확대했을 때(= CSS px 뷰포트가 짧아졌을 때) 긴 설명이
    //    화면 밖으로 흘러 아래가 통째로 잘린다. 남는 공간에 맞춰 자르고 내부 스크롤로 넘긴다.
    const maxH = Math.max(120, (placeBelow ? below : r.top) - 14);
    setPos(placeBelow
      ? { left, w, top: r.bottom + 6, maxH }
      : { left, w, bottom: window.innerHeight - r.top + 6, maxH });
  }, [width]);
  const close = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (!pos) return;
    // ⚠️ 팝오버 **내부** 스크롤로는 닫지 않는다 — 상한이 걸린 긴 설명은 안에서 스크롤해야
    //    끝까지 읽을 수 있는데, 캡처 리스너가 그것까지 잡으면 읽을 방법이 사라진다.
    const off = (e) => {
      const t = e?.target;
      if (t && t.nodeType === 1 && typeof t.closest === 'function' && t.closest('[data-bt-pop]')) return;
      setPos(null);
    };
    window.addEventListener('scroll', off, true);
    window.addEventListener('resize', off);
    return () => { window.removeEventListener('scroll', off, true); window.removeEventListener('resize', off); };
  }, [pos]);
  return { ref, pos, open, close };
}

/**
 * '?' 아이콘 — 호버(또는 키보드 포커스·클릭)에서만 상세 안내를 띄운다.
 * ⚠️ Section 헤더 안에 놓이므로 헤더 전체를 <button>으로 두면 버튼 중첩(잘못된 DOM)이 된다 —
 *    Section 헤더는 div + 내부 토글 버튼 구조여야 한다.
 */
function Hint({ children, width = 340, className = '', label = '설명 보기' }) {
  const { ref, pos, open, close } = useHoverPop(width);
  return (
    <>
      {/* ⚠️ 네이티브 title은 달지 않는다 — 1초 뒤 뜨는 브라우저 툴팁이 이 팝오버 위에 겹친다. */}
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={`shrink-0 text-gray-600 hover:text-sky-300 focus:text-sky-300 outline-none bt-noprint ${className}`}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (pos) close(); else open(); }}
      >
        <HelpCircle size={13} />
      </button>
      {pos && (
        <div role="tooltip" data-bt-pop className={`${POP_CLS} text-[12px] text-gray-300`}
          style={popStyle(pos)}>
          {children}
        </div>
      )}
    </>
  );
}

/**
 * 종목 상세 페이지 링크(새 탭).
 * ⚠️ 코드 규칙은 WatchlistPopup/CompStockChips와 같은 판정을 쓴다 — 숫자로 시작하면 국내,
 *    영문만이면 해외, MA:는 미래에셋 펀드. 판정이 안 되면 링크 없이 평문으로 둔다.
 */
const stockUrl = (code) => {
  const c = String(code || '').trim();
  if (!c) return '';
  if (/^MA:/i.test(c)) return `https://investments.miraeasset.com/magi/fund/view.do?fundGb=2&fundCd=${c.replace(/^MA:/i, '')}`;
  if (/^\d/.test(c)) return `https://m.stock.naver.com/domestic/stock/${c.toUpperCase()}/total`;
  if (/^[A-Za-z]+$/.test(c)) return `https://finance.yahoo.com/quote/${c.toUpperCase()}`;
  return '';
};
const openStock = (code) => {
  const u = stockUrl(code);
  if (u) window.open(u, '_blank', 'noopener');
};

function StockLink({ code, name, className = '', showCode = false }) {
  const url = stockUrl(code);
  const text = name || code || '-';
  if (!url) return <span className={className}>{text}{showCode && code ? <span className="ml-1 text-gray-600 font-mono text-[11px]">{code}</span> : null}</span>;
  return (
    <button type="button" onClick={() => openStock(code)}
      title={`${text} 상세 페이지 열기 (새 탭)`}
      className={`text-left hover:text-sky-300 hover:underline ${className}`}>
      {text}
      {showCode && <span className="ml-1 text-gray-600 font-mono text-[11px]">{code}</span>}
    </button>
  );
}

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

/**
 * 접이식 설정 섹션.
 *
 * ⚠️ 기본은 **닫힘**이다(사용자 요청 2026-08) — 평소에는 제목 줄만 보이고 필요한 것만 펼친다.
 *    대신 접힌 상태에서도 무엇으로 설정돼 있는지 알 수 있도록 호출부가 `badge`에 현재 값을
 *    요약해 넘긴다(안 그러면 '숨은 설정'이 된다).
 * ⚠️ 헤더는 div + 내부 토글 버튼이다 — 헤더 자체를 <button>으로 두면 `?`(Hint)가 버튼 중첩이 된다.
 * ⚠️ 루트에 **shrink-0 필수**(2026-08 사용자 보고: 브라우저를 확대하면 항목이 겹쳐 보임).
 *    설정 패널의 스크롤 영역이 `flex flex-col`이라, 내용이 패널 높이를 넘으면 flex 기본값
 *    `flex-shrink:1`이 각 섹션을 자연 높이 아래로 눌러 버린다. 루트가 `overflow-hidden`이라
 *    눌린 만큼 제목 줄이 잘려 위아래 섹션과 겹쳐 보였다(확대할수록 CSS px 높이가 줄어 심해진다).
 *    shrink-0이면 눌리지 않고 패널이 그냥 스크롤된다.
 */
function Section({ title, children, defaultOpen = false, badge = null, hint = null }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="shrink-0 border border-gray-800 rounded-lg overflow-hidden bg-gray-900/40">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800/60">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
          title={open ? '접기' : '펼치기'}
        >
          {open ? <ChevronDown size={12} className="text-gray-500 shrink-0" /> : <ChevronRight size={12} className="text-gray-500 shrink-0" />}
          <span className="text-[12px] font-bold text-gray-300">{title}</span>
          {badge !== null && <span className="ml-auto pl-2 text-[10px] text-gray-500 truncate">{badge}</span>}
        </button>
        {hint && <Hint>{hint}</Hint>}
      </div>
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

/**
 * 시나리오 색 스와치.
 * ⚠️ 반드시 **인라인 SVG**여야 한다 — 인쇄 CSS의 `.bt-shell * { background: transparent
 *    !important }`는 작성자 !important라 인라인 `style={{backgroundColor}}`를 이겨서, div/span
 *    스와치는 PDF에서 통째로 사라진다. 그러면 겹친 차트의 선(SVG stroke는 살아남는다)과
 *    시나리오 이름을 대응시킬 방법이 없어 비교 PDF가 판독 불가가 된다.
 *    SVG `fill`은 `background`·`color` 규칙 어느 쪽에도 걸리지 않는다.
 */
function Swatch({ color, shape = 'dot', className = '' }) {
  return shape === 'bar' ? (
    <svg width="12" height="3" viewBox="0 0 12 3" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect width="12" height="3" rx="1.5" fill={color} />
    </svg>
  ) : (
    <svg width="8" height="8" viewBox="0 0 8 8" className={`shrink-0 ${className}`} aria-hidden="true">
      <circle cx="4" cy="4" r="4" fill={color} />
    </svg>
  );
}

/**
 * 요약 카드 한 장 — 호버하면 '무엇과 무엇을 더한 값인가'를 계산식 + 실제 값으로 보여 준다.
 * ⚠️ 팝오버는 position:fixed라 그리드 흐름에서 빠진다(그리드 칸을 하나 더 만들지 않는다).
 */
function SummaryCard({ label, value, cls, formula, note, compact }) {
  const { ref, pos, open, close } = useHoverPop(380);
  return (
    <>
      <div
        ref={ref}
        tabIndex={0}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className="border border-gray-800 rounded-lg px-3 py-2 bg-gray-900/50 outline-none cursor-help hover:border-gray-600 focus:border-sky-700 transition-colors"
      >
        <div className="text-[11px] text-gray-500 flex items-center gap-1">
          {label}
          <HelpCircle size={10} className="text-gray-700 shrink-0 bt-noprint" />
        </div>
        <div className={`${compact ? 'text-sm' : 'text-lg'} font-bold ${cls}`}>{value}</div>
      </div>
      {pos && (
        <div role="tooltip" data-bt-pop className={POP_CLS} style={popStyle(pos)}>
          <div className="text-[12px] font-bold text-gray-200 mb-1">{label} — 계산식</div>
          <table className="w-full text-[12px]">
            <tbody>
              {formula.map(([k, v, strong], i) => (
                <tr key={i} className={strong ? 'border-t border-gray-700' : ''}>
                  <td className={`py-0.5 pr-3 align-top ${strong ? 'text-gray-200 font-bold' : 'text-gray-500'}`}>{k}</td>
                  <td className={`py-0.5 text-right whitespace-nowrap align-top ${strong ? 'text-gray-100 font-bold' : 'text-gray-300'}`}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {note && <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">{note}</p>}
        </div>
      )}
    </>
  );
}

/**
 * 요약 카드 6종.
 * ⚠️ 단일 시나리오 뷰와 비교 종합의 시나리오별 블록이 **이 한 컴포넌트를 공유**한다 —
 *    복제하면 두 화면이 갈라진다(사진1의 카드 구성이 곧 비교 화면의 카드 구성이어야 한다).
 * ⚠️ 계산식의 각 항은 result/summary의 **같은 필드**를 그대로 읽는다 — 설명에서 값을 다시
 *    계산하면 카드 숫자와 설명이 갈리는 최악의 상태가 된다.
 */
function SummaryCards({ result, compact = false }) {
  const s = result?.summary;
  if (!s) return null;
  // 투입 원금 = 초기 투자금 + 추가 예수금. summary.initialCapital은 추가 예수금을 빼고 담으므로
  // 카드 값(finalTotal·profit)과 어긋나지 않도록 두 값에서 역산한다.
  const invested = s.finalTotal - s.profit;
  const initRest = result.initialCashAfter ?? 0;
  const divPending = s.cumDivAccrued - s.cumDivPaid;
  const cards = [
    {
      label: '최종 자산', value: won(s.finalTotal), cls: pnlCls(s.profit),
      formula: [
        [`기말 평가액 (${s.endDate} 종가 × 보유수량)`, won(s.finalEval)],
        ['＋ 기말 예수금 (현금)', won(s.finalCash)],
        ['＝ 최종 자산', won(s.finalTotal), true],
      ],
      note: '마지막 영업일 종가로 전 종목을 같은 시점에 평가한 값 + 남은 현금입니다. 아래 "기말 보유 현황" 표의 총자산과 같은 값입니다.',
    },
    {
      label: '총 손익', value: wonSigned(s.profit), cls: pnlCls(s.profit),
      formula: [
        ['최종 자산', won(s.finalTotal)],
        ['− 투입 원금 (초기 투자금 + 추가 예수금)', won(invested)],
        ['＝ 총 손익', wonSigned(s.profit), true],
      ],
      note: '받은 분배금은 예수금으로 들어와 최종 자산에 이미 포함돼 있습니다(따로 더하면 이중 계상). 세금·수수료는 반영하지 않았습니다.',
    },
    {
      label: '수익률', value: pctText(s.profitRate), cls: pnlCls(s.profit),
      formula: [
        ['총 손익', wonSigned(s.profit)],
        ['÷ 투입 원금', won(invested)],
        ['＝ 수익률', pctText(s.profitRate), true],
        ['참고 · 최대 낙폭', `${s.maxDrawdown.toFixed(2)}%`],
      ],
      note: `${s.startDate} ~ ${s.endDate} (${s.months}개월) 전체 기간의 단순 수익률입니다 — 연환산(CAGR)이 아닙니다.`,
    },
    {
      label: '누적 매매차익', value: wonSigned(s.cumTradeNet), cls: pnlCls(s.cumTradeNet),
      formula: [
        ['리밸런싱 매도 − 매수 누계', wonSigned(s.cumTradeNet), true],
        ['(따로 셈) 종목 재편 순현금', wonSigned(s.cumStructuralNet)],
        ['(따로 셈) 분배금 재투자 매수', wonSigned(s.cumReinvestNet)],
      ],
      note: '정기 리밸런싱으로 판 돈에서 산 돈을 뺀 누계입니다. 종목 재편(회색 행)과 분배금 재투자(초록 행)는 성격이 달라 이 값에 넣지 않고 따로 셉니다.',
    },
    {
      label: '누적 분배금', value: won(s.cumDivAccrued), cls: 'text-emerald-400',
      formula: [
        ['분배락 기준 누계 (월별 표의 합계와 같은 기준)', won(s.cumDivAccrued), true],
        ['이 중 실제 입금 (지급일 기준)', won(s.cumDivPaid)],
        ['아직 미지급 (지급일이 종료일 이후)', won(divPending)],
      ],
      note: '예수금은 실제 지급일에만 늘어납니다. 월말 분배는 다음 달 초에 입금되므로 두 값이 다를 수 있습니다.',
    },
    {
      label: '기말 예수금', value: won(s.finalCash), cls: 'text-gray-200',
      formula: [
        ['초기 매수 후 잔여', won(initRest)],
        ['＋ 누적 매매차익', wonSigned(s.cumTradeNet)],
        ['＋ 종목 재편 순현금', wonSigned(s.cumStructuralNet)],
        ['＋ 분배금 재투자 매수', wonSigned(s.cumReinvestNet)],
        ['＋ 누적 분배금 (지급 기준)', won(s.cumDivPaid)],
        ['＝ 기말 예수금', won(s.finalCash), true],
        ['· 매매 몫 / 분배금 몫', `${won(s.finalCashTrade)} / ${won(s.finalCashDiv)}`],
      ],
      note: '다섯 항의 합이 정확히 기말 예수금이 됩니다. 매수 대금은 매매 몫을 먼저 쓰고 모자라면 분배금 몫에서 꺼냅니다.',
    },
  ];
  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 ${compact ? 'mb-2' : 'mb-3'}`}>
      {cards.map((c) => <SummaryCard key={c.label} {...c} compact={compact} />)}
    </div>
  );
}

/**
 * 시나리오별 자산 추이를 한 축에 겹쳐 그리는 비교 차트.
 *
 * ⚠️ x축은 **전 시나리오 날짜의 합집합**이다. 시나리오마다 기간이 다를 수 있어, 없는 구간을
 *    0으로 채우면 가짜 폭락이 생긴다 — 각 선은 자기 날짜에만 점을 찍고 나머지 구간은 그리지 않는다.
 * ⚠️ 초기 투자금이 다른 시나리오를 금액(₩)으로 겹쳐 보면 규모 차이만 보인다 → 'pct' 모드는
 *    각 시나리오의 **자기 시작점**을 0%로 놓고 정규화한다(호출부가 기본 모드를 정한다).
 */
function CompareChart({ series, mode = 'won' }) {
  const live = (series || []).filter((s) => s && Array.isArray(s.curve) && s.curve.length >= 2);
  if (!live.length) return null;

  const W = 900, H = 210, PAD = 6, PADB = 16;
  const dateSet = new Set();
  for (const s of live) for (const c of s.curve) dateSet.add(c.date);
  const dates = Array.from(dateSet).sort();
  if (dates.length < 2) return null;
  const idx = new Map(dates.map((d, i) => [d, i]));

  const valueOf = (s, c) =>
    mode === 'pct'
      ? (s.curve[0].total > 0 ? (c.total / s.curve[0].total - 1) * 100 : 0)
      : c.total;

  let lo = Infinity, hi = -Infinity;
  for (const s of live) for (const c of s.curve) {
    const v = valueOf(s, c);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (hi === lo) hi = lo + 1;

  const x = (i) => PAD + (i / (dates.length - 1)) * (W - PAD * 2);
  const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD - PADB);
  const fmt = (v) => (mode === 'pct' ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%` : won(v));

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[210px] block">
        {/* 0% 기준선 — 정규화 모드에서 '본전'이 어디인지 보이지 않으면 비교가 안 된다. */}
        {mode === 'pct' && lo < 0 && hi > 0 && (
          <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="#4b5563" strokeWidth="1"
            strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {live.map((s) => {
          const d = s.curve
            .map((c, i) => {
              const xi = idx.get(c.date);
              if (xi === undefined) return '';
              return `${i === 0 ? 'M' : 'L'} ${x(xi).toFixed(1)} ${y(valueOf(s, c)).toFixed(1)}`;
            })
            .filter(Boolean)
            .join(' ');
          return (
            <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth="1.6"
              vectorEffect="non-scaling-stroke" opacity="0.95" />
          );
        })}
      </svg>
      <div className="flex justify-between text-[9px] text-gray-600 mt-0.5 px-0.5">
        <span>{dates[0]}</span>
        <span>최고 {fmt(hi)} · 최저 {fmt(lo)}</span>
        <span>{dates[dates.length - 1]}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
        {live.map((s) => {
          const last = s.curve[s.curve.length - 1];
          return (
            <span key={s.id} className="flex items-center gap-1 text-[10px] whitespace-nowrap">
              <Swatch color={s.color} shape="bar" />
              <b className="text-gray-300">{s.name}</b>
              <span className="text-gray-500">{fmt(valueOf(s, last))}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 시나리오 한 줄 설명 — 비교 표 부제·시나리오별 블록 부제가 같은 문구를 쓴다. */
function scenarioSubtitle(cfg, summary) {
  const parts = [
    summary ? `${summary.startDate} ~ ${summary.endDate}` : `${cfg.startDate || '?'} ~ ${cfg.endDate || '?'}`,
    `초기 ${won(cfg.initialCapital)}${cfg.extraCash > 0 ? ` (+예수금 ${won(cfg.extraCash)})` : ''}`,
    TARGET_MODE_LABEL[cfg.targetMode] || cfg.targetMode,
    POLICY_LABEL[cfg.policy] || cfg.policy,
    `분배금 ${DIV_REINVEST_LABEL[cfg.divReinvest] || '현금 보유'}`
      + (cfg.divReinvest !== 'hold' ? ` · ${DIV_SPLIT_LABEL[cfg.divReinvestSplit] || ''}` : ''),
  ];
  return parts.join(' · ');
}

/**
 * 전체 백테스트 비교 종합.
 *
 * 구성 = ① 비교 표(시나리오 행 × 지표 열) ② 시나리오 라인을 겹쳐 그린 차트
 *        ③ 시나리오별 요약 카드 + 개별 차트 블록.
 *
 * ⚠️ 지표 정의는 단일 시나리오 뷰와 **완전히 같은 summary 필드**를 읽는다 — 여기서 다시
 *    계산하면 같은 시나리오가 두 화면에서 다른 숫자를 보이는 최악의 상태가 된다.
 * ⚠️ 실행 불가(ok=false) 시나리오도 **숨기지 않고** 사유와 함께 행을 남긴다 — 조용히 빠지면
 *    사용자는 그 시나리오가 비교에 들어간 줄로 안다.
 */
function CompareView({ runs, okRuns, series, mode, onMode, capitalsDiffer, colorOf, onOpen, total }) {
  if (!runs.length) {
    return (
      <div className="max-w-lg mx-auto mt-10 border border-gray-800 rounded-lg p-4 text-center">
        <BarChart3 size={20} className="text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-400">비교할 시나리오를 왼쪽에서 하나 이상 선택하세요.</p>
        <p className="text-[11px] text-gray-600 mt-1">저장된 시나리오 {total}개 중 0개 선택됨</p>
      </div>
    );
  }

  // 최고 성과 표시 — 수익률 기준(초기 투자금이 다르면 최종 자산 비교는 의미가 없다).
  let bestId = '';
  let bestRate = -Infinity;
  for (const { cfg, result: r } of okRuns) {
    if (r.summary.profitRate > bestRate) { bestRate = r.summary.profitRate; bestId = cfg.id; }
  }

  const COL = `${TD} text-right whitespace-nowrap`;

  return (
    <>
      <div className="mb-3">
        <h2 className="text-lg font-bold text-gray-100">📊 전체 백테스트 비교 종합</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">
          선택한 {runs.length}개 시나리오 (저장된 시나리오 {total}개)
          {capitalsDiffer && (
            <span className="text-amber-400/90"> · 초기 투자금이 서로 달라 최종 자산 대신 <b>수익률</b>로 비교하세요</span>
          )}
        </p>
      </div>

      {/* ① 비교 표 */}
      <div className="overflow-x-auto border border-gray-800 rounded-lg mb-3 bt-month">
        <table className={`${TBL} min-w-[1080px]`}>
          <thead className="bg-gray-800/70 text-gray-400">
            <tr>
              <th className={`${TH} text-left`}>시나리오</th>
              <th className={`${TH} text-right`}>최종 자산</th>
              <th className={`${TH} text-right`}>총 손익</th>
              <th className={`${TH} text-right`}>수익률</th>
              <th className={`${TH} text-right`}>누적 매매차익</th>
              <th className={`${TH} text-right`}>누적 분배금</th>
              <th className={`${TH} text-right`}>분배금 재투자</th>
              <th className={`${TH} text-right`}>기말 예수금</th>
              <th className={`${TH} text-right`}>최대 낙폭</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(({ cfg, result: r }) => {
              const s = r?.summary;
              return (
                <tr key={cfg.id} className={`border-t border-gray-800/70 ${cfg.id === bestId ? 'bg-emerald-950/25' : ''}`}>
                  <td className={`${TD} align-top`}>
                    <button
                      className="flex items-start gap-1.5 text-left hover:underline"
                      onClick={() => onOpen(cfg.id)}
                      title="이 시나리오의 상세 결과를 연다"
                    >
                      <Swatch color={colorOf(cfg.id)} className="mt-1.5" />
                      <span className="min-w-0">
                        <span className="block text-gray-200 font-bold">
                          {cfg.name}
                          {cfg.id === bestId && <span className="ml-1 text-[10px] text-emerald-400 font-normal">최고 수익률</span>}
                        </span>
                        <span className="block text-[10px] text-gray-600 leading-tight">{scenarioSubtitle(cfg, s)}</span>
                      </span>
                    </button>
                  </td>
                  {!r?.ok || !s ? (
                    <td colSpan={8} className={`${TD} text-amber-300/90 text-[11px]`}>
                      <AlertCircle size={10} className="inline -mt-0.5 mr-1" />
                      {r?.fatal || '실행할 수 없는 설정입니다.'}
                    </td>
                  ) : (
                    <>
                      <td className={`${COL} text-gray-100 font-bold`}>{won(s.finalTotal)}</td>
                      <td className={`${COL} ${pnlCls(s.profit)}`}>{wonSigned(s.profit)}</td>
                      <td className={`${COL} font-bold ${pnlCls(s.profit)}`}>{pctText(s.profitRate)}</td>
                      <td className={`${COL} ${pnlCls(s.cumTradeNet)}`}>{wonSigned(s.cumTradeNet)}</td>
                      <td className={`${COL} text-emerald-300`}>{won(s.cumDivAccrued)}</td>
                      <td className={`${COL} ${s.cumReinvestNet ? 'text-sky-300' : 'text-gray-700'}`}>
                        {s.cumReinvestNet ? won(-s.cumReinvestNet) : '-'}
                      </td>
                      <td className={`${COL} text-gray-300`}>{won(s.finalCash)}</td>
                      <td className={`${COL} text-gray-400`}>{s.maxDrawdown.toFixed(2)}%</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ② 겹친 차트 */}
      {series.length > 0 && (
        <div className="border border-gray-800 rounded-lg p-2 bg-gray-900/40 mb-4 bt-month">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[11px] font-bold text-gray-400">자산 추이 비교</span>
            <div className="flex-1" />
            <div className="flex gap-1 bt-noprint">
              {[['won', '금액 ₩'], ['pct', '수익률 %']].map(([v, l]) => (
                <button key={v} onClick={() => onMode(v)}
                  className={`${BTN} ${mode === v ? 'text-sky-200 border-sky-600 bg-sky-900/40' : 'text-gray-500 border-gray-700 hover:bg-gray-800'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <CompareChart series={series} mode={mode} />
          <p className="text-[9px] text-gray-600 mt-1">
            {mode === 'pct'
              ? '각 시나리오의 시작 시점을 0%로 놓고 정규화했습니다(기간·초기 투자금이 달라도 비교 가능).'
              : '총자산(종목 평가액 + 예수금)을 그대로 그렸습니다. 기간이 다른 시나리오는 자기 구간에만 선이 있습니다.'}
          </p>
        </div>
      )}

      {/* ③ 시나리오별 블록 — 사진1과 같은 구성(요약 카드 + 개별 차트) */}
      {okRuns.map(({ cfg, result: r }) => (
        <div key={cfg.id} className="mb-4 bt-month">
          <div className="flex items-center gap-1.5 mb-1">
            <Swatch color={colorOf(cfg.id)} />
            <h3 className="text-sm font-bold text-gray-200">{cfg.name}</h3>
            <button className="text-[11px] text-sky-400 hover:underline bt-noprint" onClick={() => onOpen(cfg.id)}>
              상세 보기
            </button>
            {r.warnings.length > 0 && (
              <span className="text-[11px] text-amber-400/90" title={r.warnings.join('\n')}>
                <AlertCircle size={11} className="inline -mt-0.5" /> 확인 {r.warnings.length}건
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-600 mb-1.5">{scenarioSubtitle(cfg, r.summary)}</p>
          <SummaryCards result={r} compact />
          <div className="border border-gray-800 rounded-lg p-2 bg-gray-900/40">
            <CurveChart curve={r.curve} />
          </div>
        </div>
      ))}

      <div className="border-t border-gray-800 pt-2 text-[12px] text-gray-600 leading-relaxed">
        <div className="flex items-start gap-1">
          <HelpCircle size={12} className="mt-0.5 shrink-0" />
          <div>
            <p>
              모든 값은 각 시나리오 상세 화면의 요약 카드와 <b>같은 계산 결과</b>입니다.
              '분배금 재투자'는 지급받은 분배금으로 다시 매수한 총액이며,
              <b> 누적 매매차익에는 포함하지 않습니다</b>(구조 변경 매매와 같은 규약).
            </p>
            <p>
              초기 투자금이나 기간이 다른 시나리오를 나란히 볼 때는 최종 자산 대신
              <b> 수익률</b>과 <b>수익률 % 차트</b>로 비교하세요.
            </p>
          </div>
        </div>
      </div>
    </>
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
  /** 비교 종합 뷰인가. 시나리오가 하나도 없으면 비교할 것도 없으므로 자동 해제된다. */
  const isCompare = activeId === COMPARE_ID && local.length > 0;
  const active = useMemo(
    () => (activeId === COMPARE_ID ? null : local.find((s) => s.id === activeId) || local[0] || null),
    [local, activeId],
  );
  useEffect(() => {
    if (!local.length) return;
    // ⚠️ COMPARE_ID는 시나리오 배열에 없는 예약값이라 여기서 걸러 내야 한다 —
    //    안 그러면 비교 뷰를 열자마자 첫 시나리오로 되돌아간다.
    if (activeId === COMPARE_ID) return;
    if (!local.some((s) => s.id === activeId)) setActiveId(local[0].id);
  }, [local, activeId]);

  /** 시나리오 색상 — **local 안의 위치**로 고정한다(비교 체크를 껐다 켜도 색이 안 바뀐다). */
  const colorOfScenario = useCallback(
    (id) => {
      const i = local.findIndex((s) => s.id === id);
      return BT_COLORS[(i < 0 ? 0 : i) % BT_COLORS.length];
    },
    [local],
  );

  const patchActive = useCallback((patch) => {
    setLocal((prev) => prev.map((s) => (s.id === (active?.id) ? { ...s, ...patch, updatedAt: Date.now() } : s)));
  }, [setLocal, active?.id]);

  /**
   * 비교 종합 포함 토글.
   * ⚠️ patchActive를 쓸 수 없다 — 비교 뷰에서는 active가 null이라 아무 일도 일어나지 않는다.
   *    반드시 **id 기준**으로 쓴다(흐름도 인스펙터의 patchNodeById와 같은 근거).
   * ⚠️ 기본값이 true(필드 부재 포함)라 토글은 `=== false` 로 판정한다.
   */
  const toggleCompare = useCallback((id) => {
    setLocal((prev) => prev.map((s) => (
      s.id === id ? { ...s, compareOn: s.compareOn === false, updatedAt: Date.now() } : s
    )));
  }, [setLocal]);

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
    // 새 시나리오는 곧바로 설정해야 하므로, 접어 둔 상태였다면 자동으로 펼친다.
    setSettingsOpen(true);
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

  // ── 비교 종합 실행 ───────────────────────────────────────────────────────
  // ⚠️ 단일 뷰와 **같은 디바운스**를 태운다 — 체크박스를 연속으로 누르면 최대 10개 백테스트가
  //    매 클릭 재실행되므로, 여기만 즉시 실행으로 두면 체감 반응이 눈에 띄게 나빠진다.
  // ⚠️ 비교 뷰가 아닐 때는 아예 계산하지 않는다(btActive 게이팅과 같은 근거 — 안 쓰는 화면의
  //    비용을 항상 치를 이유가 없다).
  const [runAll, setRunAll] = useState(null);
  useEffect(() => {
    if (!isCompare) return;
    // ⚠️ 첫 진입은 즉시 — 디바운스를 태우면 220ms 동안 "0개 선택됨" 빈 화면이 뜨고
    //    PDF·CSV 버튼이 비활성으로 깜빡인다(사용자가 '아무것도 없다'고 오해한다).
    //    이후 편집은 디바운스를 태운다. 같은 참조를 다시 넣으면 React가 bail out 하므로 루프는 없다.
    if (runAll === null) { setRunAll(local); return; }
    const t = setTimeout(() => setRunAll(local), RUN_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [isCompare, local, runAll]);

  const compareRuns = useMemo(() => {
    if (!isCompare || !runAll) return [];
    return runAll
      .filter((s) => s.compareOn !== false)
      .map((cfg) => {
        try {
          return { cfg, result: runBacktest({ config: cfg, prices, dividends, holidays }) };
        } catch (err) {
          return {
            cfg,
            result: {
              ok: false, fatal: `계산 중 오류가 발생했습니다: ${String(err?.message || err)}`,
              warnings: [], months: [], slots: [], assetMeta: [], initialTrades: [],
              curve: [], finalHoldings: [], summary: null,
            },
          };
        }
      });
  }, [isCompare, runAll, prices, dividends, holidays]);

  const compareOk = useMemo(() => compareRuns.filter((r) => r.result?.ok), [compareRuns]);
  /** 겹친 차트 기본 모드 — 초기 투자금이 시나리오마다 다르면 금액 비교가 무의미하므로 %로 시작한다. */
  const [cmpMode, setCmpMode] = useState('won');
  const capitalsDiffer = useMemo(() => {
    const set = new Set(compareOk.map((r) => Math.round(r.cfg.initialCapital + r.cfg.extraCash)));
    return set.size > 1;
  }, [compareOk]);
  useEffect(() => { if (capitalsDiffer) setCmpMode('pct'); }, [capitalsDiffer]);

  const compareSeries = useMemo(
    () => compareOk.map((r) => ({
      id: r.cfg.id, name: r.cfg.name, color: colorOfScenario(r.cfg.id), curve: r.result.curve,
    })),
    [compareOk, colorOfScenario],
  );

  // ── 설정 패널 접기 ───────────────────────────────────────────────────────
  // ⚠️ 세션 로컬 상태다(Drive 저장 지점 0곳) — 저장하려면 chartPrefs 5지점을 모두 손대야 하는데
  //    이건 '지금 화면을 넓게 볼까'라는 순간 선호도라 그 비용을 치를 값이 아니다.
  const [settingsOpen, setSettingsOpen] = useState(true);

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

  // 종목명이 **뒤늦게** 해석되면(코드만 입력한 신규 종목) 자산 이름을 채운다.
  // ⚠️ addAsset은 추가 시점의 카탈로그를 스냅샷하므로, 조회가 비동기로 끝나는 코드는 이름이
  //    코드인 채로 굳는다("포트폴리오 테이블에 먼저 넣어야 이름이 뜬다"의 마지막 조각).
  // ⚠️ 이름은 사용자가 직접 고칠 수 있는 필드라(아래 name input) **아직 코드 그대로인 행만**
  //    건드린다. 바뀐 게 없으면 setLocal이 같은 참조를 받아 dirty를 세우지 않는다(저장 폭주 방지).
  useEffect(() => {
    if (readOnly) return;
    setLocal((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!Array.isArray(s?.assets)) return s;
        let touched = false;
        const assets = s.assets.map((a) => {
          if (!a?.code || (a.name && a.name !== a.code)) return a;
          const nm = catalogByCode[a.code]?.name;
          if (!nm || nm === a.code) return a;
          touched = true;
          return { ...a, name: nm };
        });
        if (!touched) return s;
        changed = true;
        return { ...s, assets, updatedAt: Date.now() };
      });
      return changed ? next : prev;
    });
  }, [catalogByCode, readOnly, setLocal]);

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
      // ⚠️ 마지막 종목이 반올림 잔여를 흡수해 합을 정확히 100%로 맞춘다 — 안 그러면 3·6·7·9·12…
      //    종목에서 합이 99.99/100.02/100.03이 되어, 사용자가 손댄 적 없는 **앱 자신의 버튼**이
      //    엔진의 '비중 합 100% 아님' 경고를 띄운다(경고 도배로 진짜 경고가 묻힌다).
      const each = Math.round((100 / n) * 100) / 100;
      const last = Math.round((100 - each * (n - 1)) * 100) / 100;
      patchActive({ assets: active.assets.map((a, i) => ({ ...a, targetRatio: i === n - 1 ? last : each })) });
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
        rows.push([t.reinvest ? '분배금재투자' : t.structural ? '구조변경' : '리밸런싱',
          t.date, `${t.name}(${t.code})`, t.price,
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
    //    ⚠️ 분배금 재투자를 켜면 cumReinvestNet 항이 빠질 수 없다 — 없으면 소계가 어긋난다.
    for (const [label, value] of [
      ['초기 매수 후 잔여', result.initialCashAfter],
      ['누적 매매차익', result.summary.cumTradeNet],
      ['종목 재편 순현금', result.summary.cumStructuralNet],
      ['분배금 재투자 매수', result.summary.cumReinvestNet],
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

  /**
   * 비교 종합 CSV — 화면 비교 표와 **열 구성이 1:1**이어야 한다(갈리면 "화면과 CSV가 다르다").
   * 설정 요약을 함께 실어야 나중에 파일만 봐도 어떤 조건의 결과인지 알 수 있다.
   */
  const downloadCompareCsv = () => {
    if (!compareRuns.length) return;
    const rows = [[
      '시나리오', '기간', '초기 투자금', '리밸런싱', '분배금 처리', '배분 기준', '목표 기준',
      '최종 자산', '총 손익', '수익률(%)', '누적 매매차익', '누적 분배금', '분배금 재투자', '기말 예수금',
      '기말 평가액', '최대 낙폭(%)', '비고',
    ]];
    for (const { cfg, result: r } of compareRuns) {
      const s = r?.summary;
      rows.push([
        cfg.name,
        s ? `${s.startDate} ~ ${s.endDate}` : `${cfg.startDate} ~ ${cfg.endDate}`,
        Math.round(cfg.initialCapital + cfg.extraCash),
        POLICY_LABEL[cfg.policy] || cfg.policy,
        DIV_REINVEST_LABEL[cfg.divReinvest] || cfg.divReinvest,
        cfg.divReinvest === 'hold' ? '-' : (DIV_SPLIT_LABEL[cfg.divReinvestSplit] || cfg.divReinvestSplit),
        TARGET_MODE_LABEL[cfg.targetMode] || cfg.targetMode,
        s ? Math.round(s.finalTotal) : '',
        s ? Math.round(s.profit) : '',
        s ? s.profitRate.toFixed(2) : '',
        s ? Math.round(s.cumTradeNet) : '',
        s ? Math.round(s.cumDivAccrued) : '',
        s ? Math.round(-s.cumReinvestNet) : '',
        s ? Math.round(s.finalCash) : '',
        s ? Math.round(s.finalEval) : '',
        s ? s.maxDrawdown.toFixed(2) : '',
        r?.ok ? (r.warnings.length ? `확인 필요 ${r.warnings.length}건` : '') : (r?.fatal || '실행 불가'),
      ]);
    }
    const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_비교종합_${compareRuns.length}건.csv`;
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
  /* ⚠️ 화면은 크게(13px·넉넉한 행 높이), 인쇄는 종전 밀도로 되돌린다 — 12열짜리 월별 표가
        A4 가로 한 장에 들어가야 한다. 이 두 줄을 지우면 인쇄본에서 열이 잘려 판독 불가가 된다.
        값(10px / 3px 6px)은 화면을 키우기 전의 인쇄 밀도(11px / 4px 8px)에 맞춘 것이다. */
  .bt-shell .bt-tbl { font-size: 10px !important; }
  .bt-shell .bt-tbl th, .bt-shell .bt-tbl td { padding: 3px 6px !important; }
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
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/70 shrink-0 bt-noprint">
        <BarChart3 size={14} className="text-emerald-400 shrink-0" />
        <span className="text-sm font-bold text-gray-100 shrink-0">백테스트</span>

        <select
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none max-w-[240px]"
          value={isCompare ? COMPARE_ID : (active?.id || '')}
          onChange={(e) => setActiveId(e.target.value)}
        >
          {local.length === 0 && <option value="">시나리오 없음</option>}
          {local.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {local.length > 0 && <option value={COMPARE_ID}>📊 전체 백테스트 비교 종합</option>}
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

        {/* 설정 패널 접기/펴기 — 좁은 화면(세로 배치)에서는 '위로', 넓은 화면에서는 '왼쪽으로' 접힌다.
            설정을 끝낸 뒤 시뮬레이션 결과를 넓게 보기 위한 것이라 항상 상단 바에 노출한다. */}
        <button
          className={`${BTN} shrink-0 ${settingsOpen ? 'text-gray-300 border-gray-700 hover:bg-gray-800' : 'text-sky-300 border-sky-700 bg-sky-900/30'}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title={settingsOpen ? '설정을 접고 결과를 넓게 봅니다' : '설정 패널을 다시 엽니다'}
        >
          {settingsOpen
            ? <><PanelLeftClose size={11} className="inline -mt-0.5" /> 설정 숨기기</>
            : <><PanelLeft size={11} className="inline -mt-0.5" /> 설정 보기</>}
        </button>

        <div className="flex-1" />

        {/* ⚠️ 인쇄·CSV 활성 조건은 **보고 있는 뷰**를 따라야 한다 — 비교 뷰에서 단일 result를
            보면 시나리오가 다 정상인데도 버튼이 죽어 있는 상태가 나온다. */}
        <button className={`${BTN} text-emerald-300 border-emerald-800 hover:bg-emerald-900/30`} onClick={doPrint}
          disabled={isCompare ? compareOk.length === 0 : !result?.ok}>
          <FileText size={11} className="inline -mt-0.5" /> PDF로 저장 (인쇄)
        </button>
        <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800`}
          onClick={isCompare ? downloadCompareCsv : downloadCsv}
          disabled={isCompare ? compareOk.length === 0 : !result?.ok}>
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
        {/* ── 설정 패널 (접혔을 때) ──
            ⚠️ 완전히 없애지 않고 얇은 띠를 남긴다 — 상단 바 버튼만으로는 "설정이 어디 갔나"가 된다.
               세로 배치에서는 가로 띠, 가로 배치에서는 왼쪽 세로 띠가 된다. */}
        {!settingsOpen && (
          <button
            onClick={() => setSettingsOpen(true)}
            title="시뮬레이션 조건 열기"
            className="shrink-0 w-full lg:w-9 flex lg:flex-col items-center justify-center lg:justify-start gap-1 py-1 lg:py-3 border-b lg:border-b-0 lg:border-r border-gray-800 bg-gray-900/50 hover:bg-gray-800/70 text-gray-400 hover:text-sky-300 transition-colors bt-noprint"
          >
            <PanelLeft size={14} />
            <span className="text-[11px] font-bold lg:hidden">시뮬레이션 조건 열기</span>
          </button>
        )}

        {/* ── 설정 패널 ── */}
        <div className={`${settingsOpen ? 'flex' : 'hidden'} w-full lg:w-[420px] shrink-0 border-b lg:border-b-0 lg:border-r border-gray-800 flex-col min-h-0 max-h-[60vh] lg:max-h-none bt-noprint`}>
          {/* 패널 자체 헤더 — 스크롤과 무관하게 항상 '숨기기'에 닿을 수 있어야 한다. */}
          <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 border-b border-gray-800 bg-gray-900/60">
            <span className="text-[12px] font-bold text-gray-400">시뮬레이션 조건</span>
            <Hint width={320} label="설정 패널 안내">
              <p>
                각 항목은 <b className="text-gray-300">제목 줄을 누르면 펼쳐집니다</b>. 평소에는 접혀 있고,
                접힌 상태에서도 오른쪽에 현재 설정값이 요약돼 보입니다.
              </p>
              <p className="mt-1">
                설정을 마쳤으면 <b className="text-gray-300">숨기기</b>를 눌러 결과를 넓게 보세요
                (넓은 화면에서는 왼쪽으로, 좁은 화면에서는 위로 접힙니다).
              </p>
            </Hint>
            <div className="flex-1" />
            <button
              onClick={() => setSettingsOpen(false)}
              title="설정을 접고 결과를 넓게 봅니다"
              className={`${BTN} text-gray-400 border-gray-700 hover:bg-gray-800`}
            >
              <PanelLeftClose size={11} className="inline -mt-0.5" /> 숨기기
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2">
          {isCompare ? (
            <Section
              title="비교할 시나리오 고르기"
              defaultOpen
              badge={`${local.filter((s) => s.compareOn !== false).length} / ${local.length}`}
              hint={(
                <>
                  <p>
                    체크한 시나리오만 오른쪽 비교 표·차트에 들어갑니다. 선택은
                    <b className="text-gray-300"> 시나리오와 함께 저장</b>되어 다음에 열어도 그대로입니다.
                  </p>
                  <p className="mt-1">
                    설정을 바꾸려면 위 드롭다운에서 그 시나리오를 고르세요. 리밸런싱 없이 분배금만
                    쌓는 기준선을 만들려면 <b className="text-gray-300">③ 리밸런싱 일정 → 리밸런싱 안 함</b> +
                    <b className="text-gray-300"> ④ 분배금 처리 → 현금 보유</b>로 두면 됩니다.
                  </p>
                </>
              )}
            >
              {local.map((s) => {
                const on = s.compareOn !== false;
                return (
                  <button
                    key={s.id}
                    disabled={readOnly}
                    onClick={() => toggleCompare(s.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border text-left transition-colors disabled:opacity-40 ${
                      on ? 'border-gray-700 bg-gray-800/60' : 'border-gray-800 bg-gray-900/40 hover:bg-gray-800/40'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center text-[9px] font-bold ${
                      on ? 'border-transparent text-gray-900' : 'border-gray-600 text-transparent'
                    }`} style={on ? { backgroundColor: colorOfScenario(s.id) } : undefined}>✓</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[11px] font-bold truncate ${on ? 'text-gray-200' : 'text-gray-500'}`}>{s.name}</span>
                      <span className="block text-[9px] text-gray-600 truncate">
                        {POLICY_LABEL[s.policy] || s.policy} · 분배금 {DIV_REINVEST_LABEL[s.divReinvest] || '현금 보유'}
                      </span>
                    </span>
                  </button>
                );
              })}
              <div className="flex gap-1">
                <button className={`${BTN} flex-1 text-gray-300 border-gray-700 hover:bg-gray-800`} disabled={readOnly}
                  onClick={() => setLocal((prev) => prev.map((s) => (s.compareOn === false ? { ...s, compareOn: true, updatedAt: Date.now() } : s)))}>
                  전체 선택
                </button>
                <button className={`${BTN} flex-1 text-gray-300 border-gray-700 hover:bg-gray-800`} disabled={readOnly}
                  onClick={() => setLocal((prev) => prev.map((s) => (s.compareOn === false ? s : { ...s, compareOn: false, updatedAt: Date.now() })))}>
                  전체 해제
                </button>
              </div>
            </Section>
          ) : !active ? (
            <div className="shrink-0 text-center text-gray-500 text-xs py-8">
              "새 시나리오"를 눌러 백테스트를 시작하세요.
            </div>
          ) : (
            <>
              <Section
                title="① 기본 설정"
                badge={active.startDate && active.endDate ? `${active.startDate} ~ ${active.endDate}` : '기간 미지정'}
                hint={(
                  <>
                    <p>
                      백테스트를 돌릴 <b className="text-gray-300">기간</b>과 <b className="text-gray-300">투입 원금</b>을 정합니다.
                      시작일에 초기 투자금 전액으로 목표에 맞춰 매수한 뒤 시뮬레이션이 시작됩니다.
                    </p>
                    <p className="mt-1">
                      1주 단위로 딱 떨어지지 않아 <b className="text-gray-300">남는 잔돈은 자동으로 예수금</b>이 됩니다
                      (첨부 PDF의 15,000원). '추가 예수금'은 처음부터 현금으로 들고 시작할 금액입니다.
                    </p>
                  </>
                )}
              >
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
              </Section>

              <Section
                title="② 목표 기준"
                badge={active.targetMode === 'amount' ? '목표 금액' : '목표 비중 %'}
                hint={(
                  <>
                    <p>
                      리밸런싱이 <b className="text-gray-300">무엇에 맞춰 수량을 조정할지</b>를 정합니다.
                      값은 아래 <b className="text-gray-300">⑥ 종목</b>에서 종목마다 직접 적어 넣습니다.
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">목표 금액</b> — 종목마다 "이 금액이 되게" 맞춥니다
                      (예: 종목A 1,000만원 · 종목B 2,000만원).
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">목표 비중 %</b> — <b className="text-gray-300">종목 평가액 합계</b>를
                      100으로 보고 그 안에서의 배분을 정합니다(예: 종목A 50% · 종목B 50%).
                      분모에 <b className="text-gray-300">예수금·매매차익·누적 분배금은 넣지 않습니다</b> —
                      현금 잔고에 따라 사용자가 정한 비율이 흔들리면 안 되기 때문입니다.
                    </p>
                    <p className="mt-1 text-gray-500">
                      ※ 비중 합은 <b className="text-gray-400">100%로 맞추는 것이 기본</b>입니다. 100%가 아니면
                      <b className="text-gray-400"> 리밸런싱마다</b> 그 차이만큼 사고팝니다 — 작으면 매번 팔아
                      현금이 쌓이고(평가액이 계속 줄어듭니다), 크면 예수금을 헐어 더 삽니다.
                      현금은 분모는 아니지만 <b className="text-gray-400">매수 재원</b>은 됩니다.
                    </p>
                    <p className="mt-1 text-gray-500">
                      ※ 첨부 PDF와 가장 가까운 것은 <b className="text-gray-400">목표 금액</b> 모드입니다
                      (2.25억 → 4월부터 1.5억).
                    </p>
                  </>
                )}
              >
                <div className="flex gap-1">
                  {[['amount', '목표 금액'], ['ratio', '목표 비중 %']].map(([v, l]) => (
                    <button key={v} disabled={readOnly}
                      className={`${BTN} flex-1 ${active.targetMode === v ? 'text-sky-200 border-sky-600 bg-sky-900/40' : 'text-gray-400 border-gray-700 hover:bg-gray-800'}`}
                      onClick={() => patchActive({ targetMode: v })}>{l}</button>
                  ))}
                </div>
                {/* ⚠️ 분모 선택 드롭다운은 없다(2026-08 사용자 정의) — 비중의 기준은 '종목 평가액
                    합계' 하나로 고정이다. 대신 그 사실을 여기 한 줄로 always-on 표시한다. */}
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  {active.targetMode === 'amount'
                    ? '종목마다 적어 넣은 금액이 되도록 매수·매도합니다. 남는 돈은 예수금으로 남습니다.'
                    : '기준(분모)은 종목 평가액 합계입니다 — 예수금·매매차익·누적 분배금은 포함하지 않습니다.'}
                </p>
                <button className={`${BTN} text-gray-300 border-gray-700 hover:bg-gray-800 w-full`} onClick={splitEven} disabled={readOnly || !active.assets.length}
                  title={active.targetMode === 'amount'
                    ? '초기 투자금(+추가 예수금)을 종목 수로 나눠 목표 금액에 채웁니다'
                    : '100%를 종목 수로 나눠 목표 비중에 채웁니다'}>
                  종목 수로 균등 분배
                </button>
              </Section>

              <Section
                title="②-b 매월 목표 증액 (현금 재투자)"
                badge={active.contribution.mode === 'none'
                  ? '증액 없음'
                  : active.contribution.mode === 'pctOfCash'
                    ? `예수금의 ${formatNumber(active.contribution.value)}%`
                    : `매월 ${won(active.contribution.value)}`}
                hint={(
                  <>
                    <p>
                      리밸런싱 매도 차익·분배금으로 쌓인 <b className="text-gray-300">예수금</b>을 매월 다시 투자에
                      넣습니다. 그 달 <b className="text-gray-300">첫 리밸런싱 직전</b>에 종목 목표를 올리면
                      바로 이어지는 리밸런싱이 실제로 매수합니다.
                    </p>
                    <p className="mt-1">
                      증액액은 <b className="text-gray-300">보유 예수금을 넘지 않게</b> 잘립니다(넘기면 곧바로
                      '예수금 부족'이 되기 때문). 리밸런싱이 없는 달은 건너뜁니다.
                    </p>
                  </>
                )}
              >
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
                    {active.targetMode === 'ratio' && (
                      <p className="text-[10px] text-amber-400/90 leading-relaxed">
                        ⚠️ <b>목표 비중 %</b> 모드에서는 증액이 <b>집행되지 않습니다</b> — 목표가
                        '종목 평가액 합계 × 비중'이라 늘릴 대상이 없기 때문입니다. 쌓인 현금을
                        다시 넣으려면 <b>목표 금액</b> 모드를 쓰거나, <b>④ 분배금 처리</b>를 재투자로
                        두거나, 목표 비중 합을 100%보다 크게 잡으세요.
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

              <Section
                title="③ 리밸런싱 일정"
                badge={POLICY_LABEL[active.policy] || active.policy}
                hint={(
                  <>
                    <p>
                      <b className="text-gray-300">언제</b> 목표에 맞춰 수량을 조정할지 정합니다. 기본 규칙은
                      지급기준일(월중 15일 / 월말 말일, 휴장이면 직전 영업일) →
                      <b className="text-gray-300"> 분배락 = 기준일 −1영업일</b> →
                      <b className="text-gray-300"> 리밸런싱 = 분배락 −1영업일</b>(분배금을 받을 수 있는 마지막 매수일)입니다.
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">종목별</b>은 각 종목이 자기 분배 주기를 따르고,
                      <b className="text-gray-300"> 일괄</b>은 전 종목을 같은 날 함께 조정합니다.
                      <b className="text-gray-300"> 리밸런싱 안 함</b>은 초기 매수 후 수량을 그대로 두는 기준선(Buy &amp; Hold)입니다.
                    </p>
                  </>
                )}
              >
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>전체 정책</span>
                  <select className={INPUT} value={active.policy} disabled={readOnly}
                    onChange={(e) => patchActive({ policy: e.target.value })}>
                    <option value="perCycle">종목별 — 각자 자기 분배락 전</option>
                    <option value="allMid">일괄 — 전 종목을 월중 분배락 전에</option>
                    <option value="allEom">일괄 — 전 종목을 월말 분배락 전에</option>
                    <option value="fixedDay">일괄 — 매월 지정일</option>
                    <option value="none">리밸런싱 안 함 (최초 매수 후 그대로 보유)</option>
                  </select>
                </div>
                {active.policy === 'none' && (
                  <div className="text-[11px] text-gray-500 leading-relaxed border border-gray-800 rounded bg-gray-900/40 px-2 py-1.5">
                    <div className="flex items-start gap-1">
                      <span className="flex-1">초기 매수 후 <b className="text-gray-400">수량을 그대로 둡니다</b>(Buy &amp; Hold).</span>
                      <Hint label="리밸런싱 안 함 설명">
                        <p>분배금은 <b className="text-gray-300">④ 분배금 처리</b>가 정하는 대로 쌓이거나 재투자됩니다.</p>
                        <p className="mt-1">
                          ※ 종목별로 <b className="text-gray-300">다르게</b> 지정한 리밸런싱(종목 목록의 '리밸런싱' 칸)은
                          그대로 실행됩니다 — 전 종목을 멈추려면 그 칸도 모두 '전체 정책 따름'이어야 합니다.
                        </p>
                      </Hint>
                    </div>
                    {/* ⚠️ 조건을 policy==='none'으로 두면 양방향으로 거짓말을 한다 — 종목별
                        rebalMode를 하나라도 지정하면 증액이 정상 집행되는데 '효과 없음'이라 하고,
                        반대로 policy는 none이 아닌데 전 종목 rebalMode:'none'이면 아무 안내도 없다.
                        실제 조건은 '리밸런싱 슬롯이 하나도 없다'이므로 결과에서 직접 읽는다. */}
                    {active.contribution.mode !== 'none' && result?.ok && result.slots.length === 0 && (
                      <div className="mt-1 text-amber-400/90">※ 매월 목표 증액은 <b>리밸런싱이 있는 달에만</b> 집행되므로 이 설정에서는 효과가 없습니다.</div>
                    )}
                  </div>
                )}
                {active.policy === 'fixedDay' && (
                  <div className="flex items-center gap-2">
                    <span className={LABEL}>매월</span>
                    <NumInput value={active.fixedDay} className="w-16" disabled={readOnly}
                      onCommit={(v) => patchActive({ fixedDay: Math.min(31, Math.max(1, Math.round(v))) })} />
                    <span className="text-[10px] text-gray-500">일 (휴장이면 직전 영업일)</span>
                  </div>
                )}

                <Section
                  title="분배 일정 오프셋 (고급)"
                  badge={`${active.exDivOffset} · ${active.rebalOffset} · +${active.payOffset}`}
                  hint={(
                    <p>
                      기준일 = 월중 15일 / 월말 말일(휴장이면 직전 영업일). 기본값 −1·−1·+2는 첨부 PDF의
                      리밸런싱일 14개 중 12개를 정확히 재현합니다(나머지 2개는 PDF가 일요일을 쓴 오류).
                      단위는 <b className="text-gray-300">영업일</b>입니다.
                    </p>
                  )}
                >
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
                </Section>

                {/* 월별 오버라이드 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className={LABEL}>특정 월만 다른 날짜에</span>
                    <span className="text-[10px] text-gray-600">({active.overrides.length})</span>
                    <Hint label="월별 예외 설명">
                      <p>
                        ⚠️ 오버라이드는 <b className="text-gray-300">리밸런싱일만</b> 옮깁니다. 분배락·지급일은
                        시장이 정하는 값이라 그대로입니다.
                      </p>
                      <p className="mt-1">
                        <b className="text-gray-300">일괄</b> 항목은 '전역 정책 따름' 종목에만 적용되고,
                        종목별 일정을 따로 지정한 종목은 <b className="text-gray-300">○○만</b> 항목으로 옮깁니다.
                      </p>
                    </Hint>
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
                </div>
              </Section>

              <Section
                title="④ 분배금 처리"
                badge={DIV_REINVEST_LABEL[active.divReinvest]
                  + (active.divReinvest !== 'hold' ? ` · ${DIV_SPLIT_LABEL[active.divReinvestSplit] || ''}` : '')}
                hint={(
                  <>
                    <p>
                      지급받은 분배금을 <b className="text-gray-300">현금으로 둘지, 다시 매수할지</b> 정합니다.
                      현금으로 두면 리밸런싱 매수 재원으로만 쓰이고, 리밸런싱까지 끄면 현금이 그대로 쌓이는
                      기준선(Buy &amp; Hold)이 됩니다.
                    </p>
                    <p className="mt-1">
                      <b className="text-gray-300">월중·월말 매수</b>는 리밸런싱과 같은 날짜 규칙(분배락 직전 영업일)이라
                      그날 사면 <b className="text-gray-300">그 달 분배 권리까지 확보</b>되어 분배금이 다시 분배를 받습니다.
                    </p>
                    <p className="mt-1">
                      재원은 <b className="text-gray-300">아직 쓰지 않은 누적 분배금 전액</b>입니다(리밸런싱이 이미 헐어 쓴
                      몫은 자동으로 빠집니다). 1주 값에 못 미치는 잔돈은 버리지 않고 다음 회차로 이월됩니다.
                      재투자 매수 대금은 결과의 '누적 매매차익'에 <b className="text-gray-300">넣지 않고</b> 따로 셉니다.
                    </p>
                  </>
                )}
              >
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>지급받은 분배금을</span>
                  <select className={INPUT} value={active.divReinvest} disabled={readOnly}
                    onChange={(e) => patchActive({ divReinvest: e.target.value })}>
                    <option value="hold">현금으로 보유 (예수금에 쌓아 둠)</option>
                    <option value="payDate">지급일에 바로 재매수</option>
                    <option value="mid">모아서 월중에 매수 (월중 분배락 직전)</option>
                    <option value="eom">모아서 월말에 매수 (월말 분배락 직전)</option>
                  </select>
                </div>
                {active.divReinvest !== 'hold' && (
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>어느 종목을 살까 (배분 기준)</span>
                    <select className={INPUT} value={active.divReinvestSplit} disabled={readOnly}
                      onChange={(e) => patchActive({ divReinvestSplit: e.target.value })}>
                      <option value="target">
                        목표 비중대로 전 종목에 배분{active.targetMode === 'amount' ? ' (목표금액 비율)' : ''}
                      </option>
                      <option value="source">분배금을 준 그 종목을 되산다 (DRIP)</option>
                      <option value="even">그날 살 수 있는 종목에 균등</option>
                    </select>
                  </div>
                )}
                {active.divReinvest !== 'hold' && active.divReinvestSplit === 'target'
                  && active.targetMode === 'ratio'
                  && active.assets.length > 0
                  && active.assets.every((a) => !(a.targetRatio > 0)) && (
                  <p className="text-[10px] text-amber-400/90 leading-relaxed">
                    ⚠️ 목표 비중이 전부 0이라 배분 기준이 없습니다 — 이 경우에는 균등 배분으로 대체됩니다.
                  </p>
                )}
              </Section>

              <Section
                title="⑤ 수량·현금 규칙"
                badge={`${active.rounding === 'floor' ? '내림' : active.rounding === 'round' ? '반올림' : '소수 허용'}${active.allowNegativeCash ? ' · 마이너스 예수금 허용' : ''}`}
                hint={(
                  <>
                    <p>
                      매매 수량을 <b className="text-gray-300">1주 단위로 어떻게 자를지</b>와, 예수금이 모자랄 때
                      어떻게 할지를 정합니다. 첨부 PDF는 <b className="text-gray-300">내림(0 방향)</b> 규약입니다.
                    </p>
                    <p className="mt-1">
                      '마이너스 예수금 허용'을 끄면 보유 현금 한도까지만 매수하고 그 행에
                      <b className="text-gray-300"> "예수금 부족"</b>으로 표시합니다.
                    </p>
                  </>
                )}
              >
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
              </Section>

              <Section
                title="⑥ 종목"
                badge={`${active.assets.length}/${MAX_BT_ASSETS}`}
                hint={(
                  <>
                    <p>
                      종목코드를 넣으면 앱에 저장된 일별 종가·분배금 이력을 그대로 씁니다.
                      저장된 게 없으면 자동으로 조회하며, 그래도 없으면 아래
                      <b className="text-gray-300"> '종가 직접 붙여넣기'</b>로 넣을 수 있습니다.
                    </p>
                    <p className="mt-1">
                      종목명 옆 <b className="text-gray-300">종목코드</b>나 <b className="text-gray-300">↗ 아이콘</b>을 누르면
                      네이버 금융 상세 페이지가 새 탭에서 열립니다.
                    </p>
                  </>
                )}
              >
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
                        {/* ⚠️ 종목명 칸은 사용자가 고칠 수 있는 input이라 링크로 만들 수 없다 —
                            대신 코드와 ↗ 아이콘을 상세 페이지 진입점으로 둔다. */}
                        <button type="button" className="text-[11px] text-gray-500 font-mono shrink-0 hover:text-sky-300 hover:underline"
                          title={`${a.name || a.code} 상세 페이지 열기 (새 탭)`} onClick={() => openStock(a.code)}>
                          {a.code}
                        </button>
                        <button type="button" className="p-0.5 text-gray-600 hover:text-sky-300 shrink-0"
                          title={`${a.name || a.code} 상세 페이지 열기 (새 탭)`} onClick={() => openStock(a.code)}>
                          <ExternalLink size={11} />
                        </button>
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

              <Section
                title="⑦ 중도 종목 변경 / 추가"
                badge={`${active.events.length}/${MAX_BT_EVENTS}`}
                hint={(
                  <p>
                    기간 도중에 종목을 <b className="text-gray-300">갈아타거나 새로 편입</b>할 때 씁니다.
                    이 매매는 정기 리밸런싱과 성격이 달라 결과 표에 <b className="text-gray-300">회색 '재편' 행</b>으로
                    구분되고, <b className="text-gray-300">누적 매매차익에는 넣지 않습니다</b>(별도 집계).
                  </p>
                )}
              >
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
        </div>

        {/* ── 결과 ── */}
        <div id="bt-print" className="flex-1 min-w-0 overflow-y-auto p-3">
          {isCompare ? (
            <CompareView
              runs={compareRuns}
              okRuns={compareOk}
              series={compareSeries}
              mode={cmpMode}
              onMode={setCmpMode}
              capitalsDiffer={capitalsDiffer}
              colorOf={colorOfScenario}
              onOpen={setActiveId}
              total={local.length}
            />
          ) : !active ? null : !result ? (
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
                <h2 className="text-lg font-bold text-gray-100">📊 {active.name} — 리밸런싱 백테스트</h2>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  기간 {result.summary.startDate} ~ {result.summary.endDate} · 초기 투자금 {won(active.initialCapital)}
                  {active.extraCash > 0 && ` (+ 예수금 ${won(active.extraCash)})`} ·
                  {' '}{TARGET_MODE_LABEL[active.targetMode] || active.targetMode} ·
                  {' '}수량 {active.rounding === 'floor' ? '내림' : active.rounding === 'round' ? '반올림' : '소수 허용'}
                </p>
              </div>

              {/* 요약 카드 — ⚠️ 비교 종합의 시나리오별 블록과 같은 컴포넌트를 쓴다(복제 금지). */}
              <SummaryCards result={result} />

              <div className="border border-gray-800 rounded-lg p-2 bg-gray-900/40 mb-3">
                <CurveChart curve={result.curve} />
              </div>

              {/* 경고 */}
              {result.warnings.length > 0 && (
                <div className="border border-amber-800/50 bg-amber-900/15 rounded-lg p-2 mb-3">
                  <div className="flex items-center gap-1 text-[12px] font-bold text-amber-300 mb-1">
                    <AlertCircle size={12} /> 확인이 필요한 항목 ({result.warnings.length})
                  </div>
                  <ul className="text-[12px] text-amber-200/80 leading-relaxed list-disc pl-4">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {/* Phase 0 */}
              <div className="mb-4 bt-month">
                <h3 className="text-sm font-bold text-gray-300 mb-1">🏁 [Phase 0] 초기 자본 투입 — {result.initialDate}</h3>
                <div className="overflow-x-auto border border-gray-800 rounded-lg">
                  <table className={`${TBL} min-w-[680px]`}>
                    <thead className="bg-gray-800/70 text-gray-400">
                      <tr>
                        <th className={`${TH} text-left`}>종목명</th>
                        <th className={`${TH} text-right`}>당일 종가</th>
                        <th className={`${TH} text-right`}>매수 수량</th>
                        <th className={`${TH} text-right`}>매수 금액</th>
                        <th className={`${TH} text-right`}>비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.initialTrades.map((t) => (
                        <tr key={t.assetId} className="border-t border-gray-800/70">
                          <td className={`${TD} text-gray-200`}><StockLink code={t.code} name={t.name} showCode /></td>
                          <td className={`${TD} text-right text-gray-300`}>{won(t.price)}</td>
                          <td className={`${TD} text-right text-gray-200`}>{qtyText(t.qty)}주</td>
                          <td className={`${TD} text-right text-gray-200`}>{won(Math.abs(t.cashDelta))}</td>
                          <td className={`${TD} text-right text-gray-500 text-[11px]`}>목표 {won(t.target)}{t.note && ` · ${t.note}`}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                        <td className={`${TD} text-gray-300`}>합계</td>
                        <td className={`${TD} text-right text-gray-600`}>-</td>
                        <td className={`${TD} text-right text-gray-200`}>{qtyText(result.initialTrades.reduce((s, t) => s + t.qty, 0))}주</td>
                        <td className={`${TD} text-right text-gray-200`}>{won(result.initialTrades.reduce((s, t) => s + Math.abs(t.cashDelta), 0))}</td>
                        <td className={`${TD} text-right text-emerald-300`}>잔여 예수금 {won(result.initialCashAfter)}</td>
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
                    <h3 className="text-sm font-bold text-gray-300 mb-1">
                      📅 {m.ym.replace('-', '년 ')}월
                      {!hasTable && <span className="ml-1 font-normal text-gray-600 text-[11px]">— 이 달은 매매·분배가 없습니다</span>}
                    </h3>
                    {hasTable && (
                    <div className="overflow-x-auto border border-gray-800 rounded-lg">
                      <table className={`${TBL} min-w-[1320px]`}>
                        <thead className="bg-gray-800/70 text-gray-400">
                          <tr>
                            <th className={`${TH} text-left`}>리밸런싱일</th>
                            <th className={`${TH} text-left`}>대상 종목</th>
                            <th className={`${TH} text-right`}>종가</th>
                            <th className={`${TH} text-right`}>리밸런싱 전 평가액</th>
                            <th className={`${TH} text-right`}>매수/매도</th>
                            <th className={`${TH} text-right`}>매매 금액</th>
                            <th className={`${TH} text-right`}>조정 후 수량</th>
                            <th className={`${TH} text-right`}>조정 후 평가액</th>
                            <th className={`${TH} text-center`}>분배락일</th>
                            <th className={`${TH} text-center`}>지급일</th>
                            <th className={`${TH} text-right`}>주당 분배금</th>
                            <th className={`${TH} text-right`}>지급 분배금</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ trade: t, dividend: d }, i) => (
                            <tr key={`${t.assetId}-${t.date}-${i}`}
                              className={`border-t border-gray-800/70 ${t.structural ? 'bg-gray-800/40' : t.reinvest ? 'bg-emerald-950/25' : ''}`}>
                              <td className={`${TD} text-gray-300 whitespace-nowrap`}>
                                {t.date}
                                {t.structural && <span className="ml-1 text-[10px] text-amber-400">재편</span>}
                                {t.reinvest && <span className="ml-1 text-[10px] text-emerald-400" title="분배금 재투자 매수 — 누적 매매차익에는 포함하지 않습니다">재투자</span>}
                                {!t.priceExact && <span className="ml-1 text-[10px] text-amber-400" title="그 날짜 종가가 없어 직전 종가를 사용">≈</span>}
                              </td>
                              <td className={`${TD} text-gray-200 whitespace-nowrap`}><StockLink code={t.code} name={t.name} /></td>
                              <td className={`${TD} text-right text-gray-300`}>{won(t.price)}</td>
                              <td className={`${TD} text-right text-gray-300`}>{won(t.evalBefore)}</td>
                              <td className={`${TD} text-right font-bold ${t.qty < 0 ? 'text-blue-300' : 'text-red-300'}`}>
                                {qtyText(Math.abs(t.qty))}주 {t.qty < 0 ? '매도' : '매수'}
                              </td>
                              <td className={`${TD} text-right ${pnlCls(t.cashDelta)}`}>{wonSigned(t.cashDelta)}</td>
                              <td className={`${TD} text-right text-gray-200`}>{qtyText(t.qtyAfter)}주</td>
                              {/* 조정 후 평가액 = 조정 후 수량 × 그날 종가 (BtTrade.evalAfter) */}
                              <td className={`${TD} text-right text-gray-200`}>{won(t.evalAfter)}</td>
                              <td className={`${TD} text-center text-gray-500 text-[11px] whitespace-nowrap`}>{d?.exDate || '-'}</td>
                              <td className={`${TD} text-center text-gray-500 text-[11px] whitespace-nowrap`}>{d?.payDate || '-'}</td>
                              <td className={`${TD} text-right`}>
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
                              <td className={`${TD} text-right text-emerald-300`}>{d ? won(d.amount) : <span className="text-gray-700">-</span>}</td>
                            </tr>
                          ))}
                          {orphans.map((d, i) => (
                            <tr key={`orphan-${i}`} className="border-t border-gray-800/70">
                              <td className={`${TD} text-gray-600 text-[11px]`}>(리밸런싱 없음)</td>
                              <td className={`${TD} text-gray-300`}><StockLink code={d.code} name={d.name} /></td>
                              <td colSpan={4} className={`${TD} text-right text-gray-700`}>-</td>
                              <td className={`${TD} text-right text-gray-300`}>{qtyText(d.qty)}주</td>
                              <td className={`${TD} text-right text-gray-700`}>-</td>
                              <td className={`${TD} text-center text-gray-500 text-[11px]`}>{d.exDate}</td>
                              <td className={`${TD} text-center text-gray-500 text-[11px]`}>{d.payDate}</td>
                              <td className={`${TD} text-right text-gray-300`}>{formatNumber(d.perShare)}</td>
                              <td className={`${TD} text-right text-emerald-300`}>{won(d.amount)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                            <td className={`${TD} text-gray-300`}>합계</td>
                            <td className={`${TD} text-gray-600`}>-</td>
                            <td className={`${TD} text-right text-gray-600`}>-</td>
                            {/* ⚠️ 평가액 합계는 **한 종목이 그 달에 두 번 이상 거래되면 렌더하지 않는다**.
                                evalBefore/evalAfter는 거래 시점의 '포지션 전체 평가액'이라 거래 단위로 더하면
                                같은 종목이 중복 계상된다(재편+정기 리밸런싱이 겹친 달에서 실측 2.17배).
                                첨부 PDF도 정확히 그런 달(4월)의 합계를 '-'로 비워 뒀다 — 그 규약을 따른다.
                                시점 정합 총액은 아래 '월말 보유 현황 · 종목 합계'가 담당한다. */}
                            <td className={`${TD} text-right text-gray-200`} title={dupTraded ? '같은 종목이 이 달에 두 번 이상 거래되어 단순 합이 중복 계상됩니다 — 아래 월말 보유 현황을 참고하세요.' : undefined}>
                              {dupTraded ? <span className="text-gray-600 font-normal">-</span> : won(m.evalBeforeSum)}
                            </td>
                            <td className={`${TD} text-right text-gray-600`}>-</td>
                            <td className={`${TD} text-right ${pnlCls(m.tradeNet)}`}>{wonSigned(m.tradeNet)}</td>
                            <td className={`${TD} text-right text-gray-600`}>-</td>
                            <td className={`${TD} text-right text-gray-200`} title={dupTraded ? '같은 종목이 이 달에 두 번 이상 거래되어 단순 합이 중복 계상됩니다 — 아래 월말 보유 현황을 참고하세요.' : undefined}>
                              {dupTraded ? <span className="text-gray-600 font-normal">-</span> : won(rows.reduce((s, r) => s + r.trade.evalAfter, 0))}
                            </td>
                            <td colSpan={3} className={`${TD} text-right text-gray-600`}>-</td>
                            <td className={`${TD} text-right text-emerald-300`}>{won(m.divAccrued)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    )}
                    {/* 매월 목표 증액 — 리밸런싱 직전에 예수금을 목표로 옮긴 내역.
                        위 표의 매수 수량이 왜 늘었는지를 설명하는 값이라 표 바로 아래에 둔다. */}
                    {m.contribution && m.contribution.amount > 0 && (
                      <div className="mt-1 border border-sky-900/60 rounded-lg bg-sky-950/30 px-2.5 py-2">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]">
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
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                            {m.contribution.perAsset.filter((x) => x.added > 0).map((x) => (
                              <span key={x.assetId} className="text-[12px] whitespace-nowrap">
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
                      <div className="mt-1 border border-gray-800/70 rounded-lg bg-gray-900/30 px-2.5 py-2">
                        <div className="text-[12px] text-gray-500 font-bold mb-1">
                          월말 보유 현황 <span className="font-normal text-gray-600">({m.lastDate} 종가 기준)</span>
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                          {m.holdings.map((h) => (
                            <span key={h.assetId} className="text-[12px] whitespace-nowrap">
                              <StockLink code={h.code} name={h.name} className="text-gray-300 font-bold" />
                              <span className="text-gray-500"> {qtyText(h.qty)}주 · </span>
                              <b className="text-gray-200">{won(h.evalAmount)}</b>
                              <span className="text-gray-600"> ({h.weight.toFixed(1)}%)</span>
                              {!h.priceExact && <span className="text-amber-400" title="그 날짜 종가가 없어 직전 종가를 사용">≈</span>}
                            </span>
                          ))}
                          <span className="text-[12px] whitespace-nowrap">
                            <span className="text-gray-500">종목 합계 </span>
                            <b className="text-gray-100">{won(m.evalEnd)}</b>
                          </span>
                        </div>
                      </div>
                    )}
                    {/* 월 요약 줄 */}
                    <div className="mt-1.5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-1 text-[12px] px-1">
                      <span className="text-gray-500">누적 매매차익 <b className={pnlCls(m.cumTradeNet)}>{wonSigned(m.cumTradeNet)}</b></span>
                      <span className="text-gray-500">월 분배금 <b className="text-emerald-300">{won(m.divAccrued)}</b></span>
                      <span className="text-gray-500">누적 분배금 <b className="text-emerald-300">{won(m.cumDivAccrued)}</b></span>
                      <span className="text-gray-500">월 현금 증감 <b className={pnlCls(m.cashDelta)}>{wonSigned(m.cashDelta)}</b></span>
                      <span className="text-gray-500">
                        월말 예수금 <b className="text-gray-300">{won(m.cashEnd)}</b>
                        {/* 분배금 몫이 남아 있을 때만 분해를 보여 준다(합 = 예수금, 이중 계상 아님) */}
                        {m.cashDivEnd > 0.5 && (
                          <span
                            className="text-gray-600"
                            title={m.cashTradeEnd <= 0.5
                              ? `매매 주머니가 0인 이유: 초기 잔여 + 누적 매매차익(${wonSigned(m.cumTradeNet)})이 매수 대금을 못 채워 부족분을 분배금에서 꺼냈습니다.`
                              : '매매 = 초기 잔여 + 누적 매매차익 중 남은 몫 / 분배금 = 지급받은 분배금 중 아직 쓰지 않은 몫'}
                          >
                            {' '}(매매 {won(m.cashTradeEnd)} · 분배금 {won(m.cashDivEnd)})
                          </span>
                        )}
                      </span>
                      <span className="text-gray-500">월말 총자산 <b className="text-gray-200">{won(m.totalEnd)}</b></span>
                      {m.cumContribution > 0 && (
                        <span className="text-gray-500">누적 증액 <b className="text-sky-300">{won(m.cumContribution)}</b></span>
                      )}
                      {m.reinvestNet !== 0 && (
                        <span className="text-gray-500">
                          분배금 재투자 <b className="text-emerald-300">{won(-m.reinvestNet)}</b>
                          <span className="text-gray-600"> (누적 {won(-m.cumReinvestNet)})</span>
                        </span>
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
                      {/* ⚠️ 매수 대금을 무엇으로 충당했는지 — 누적 매매차익이 마이너스인 달에는
                          이 줄이 없으면 "이 돈이 어디서 나왔나"를 화면에서 추적할 수 없다.
                          ⚠️ 분배금 재투자 매수는 **설계상 항상** 분배금 주머니에서 나가므로
                             (applyCash prefer='div'), cashUsedDiv만 보고 띄우면 재투자를 켠 모든 달에
                             "매매차익이 모자라"라는 거짓 설명이 붙어 진짜 부족 신호가 묻힌다.
                             → 재투자 몫을 뺀 **나머지 매수**가 분배금을 헐었을 때만 띄운다. */}
                      {(() => {
                        const reinvBuy = -m.reinvestNet;
                        const otherFromDiv = Math.max(0, m.cashUsedDiv - reinvBuy);
                        if (otherFromDiv <= 0.5) return null;
                        const otherFromTrade = m.cashUsedTrade;
                        return (
                          <span className="text-amber-400/90 col-span-2 xl:col-span-6">
                            ※ 이 달 {reinvBuy > 0.5 ? '재투자 외 ' : ''}매수 대금{' '}
                            <b>{won(otherFromTrade + otherFromDiv)}</b> ={' '}
                            예수금(매매차익) <b>{won(otherFromTrade)}</b> + 누적 분배금 <b>{won(otherFromDiv)}</b>
                            {' '}— 매매차익이 모자라 분배금에서 충당했습니다.
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}

              {/* 최종 보유 */}
              <div className="mb-4 bt-month">
                <h3 className="text-sm font-bold text-gray-300 mb-1">🏁 기말 보유 현황 — {result.summary.endDate}</h3>
                <div className="overflow-x-auto border border-gray-800 rounded-lg">
                  <table className={`${TBL} min-w-[680px]`}>
                    <thead className="bg-gray-800/70 text-gray-400">
                      <tr>
                        <th className={`${TH} text-left`}>종목명</th>
                        <th className={`${TH} text-right`}>기말 종가</th>
                        <th className={`${TH} text-right`}>보유 수량</th>
                        <th className={`${TH} text-right`}>평가금액</th>
                        <th className={`${TH} text-right`}>비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.finalHoldings.map((h) => (
                        <tr key={h.assetId} className="border-t border-gray-800/70">
                          <td className={`${TD} text-gray-200`}><StockLink code={h.code} name={h.name} showCode /></td>
                          <td className={`${TD} text-right text-gray-300`}>{won(h.price)}{!h.priceExact && <span className="text-amber-400 ml-0.5">≈</span>}</td>
                          <td className={`${TD} text-right text-gray-200`}>{qtyText(h.qty)}주</td>
                          <td className={`${TD} text-right text-gray-200`}>{won(h.evalAmount)}</td>
                          <td className={`${TD} text-right text-gray-400`}>{h.weight.toFixed(1)}%</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 bg-gray-800/40 font-bold">
                        <td className={`${TD} text-gray-300`}>예수금</td>
                        <td colSpan={2} className={`${TD} text-right text-gray-600`}>-</td>
                        <td className={`${TD} text-right text-emerald-300`}>{won(result.summary.finalCash)}</td>
                        <td className={`${TD} text-right text-gray-600`}>-</td>
                      </tr>
                      {/* 예수금 원천별 세분화 — ⚠️ 합이 정확히 기말 예수금이 되는 항등식이다(검증 #110):
                          초기 매수 후 잔여 + 누적 매매차익 + 종목 재편 순현금 + 분배금 재투자 매수(≤0)
                          + 누적 분배금(지급 기준).
                          ⚠️ 분배금은 반드시 **지급 기준**(cumDivPaid) — 분배락 기준(cumDivAccrued)에는
                          아직 현금이 안 된 몫이 섞여 있어 소계가 예수금과 어긋난다(검증 #110b). */}
                      {[
                        { key: 'init', label: '초기 매수 후 잔여', value: result.initialCashAfter, signed: false },
                        { key: 'trade', label: '누적 매매차익', value: result.summary.cumTradeNet, signed: true },
                        { key: 'struct', label: '종목 재편 순현금', value: result.summary.cumStructuralNet, signed: true },
                        { key: 'reinv', label: '분배금 재투자 매수', value: result.summary.cumReinvestNet, signed: true },
                        { key: 'div', label: '누적 분배금', value: result.summary.cumDivPaid, signed: false },
                      ].filter((p) => Math.round(p.value) !== 0).map((p) => (
                        <tr key={p.key} className="border-t border-gray-800/40">
                          <td className={`${TD} pl-7 text-gray-500 text-[12px]`}>
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
                          <td colSpan={2} className={`${TD} text-right text-gray-700`}>-</td>
                          <td className={`${TD} text-right text-[12px] ${p.signed ? pnlCls(p.value) : 'text-gray-300'}`}>
                            {p.signed ? wonSigned(p.value) : won(p.value)}
                          </td>
                          <td className={`${TD} text-right text-gray-700`}>-</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 bg-gray-800/60 font-bold">
                        <td className={`${TD} text-gray-200`}
                          title={`총자산 = 기말 평가액 ${won(result.summary.finalEval)} + 기말 예수금 ${won(result.summary.finalCash)} = ${won(result.summary.finalTotal)}`}>
                          총자산
                        </td>
                        <td colSpan={2} className={`${TD} text-right text-gray-600`}>-</td>
                        <td className={`${TD} text-right text-gray-100`}>{won(result.summary.finalTotal)}</td>
                        <td className={`${TD} text-right ${pnlCls(result.summary.profit)}`}
                          title={`수익률 = (총자산 − 투입 원금 ${won(result.summary.finalTotal - result.summary.profit)}) ÷ 투입 원금`}>
                          {pctText(result.summary.profitRate)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 각주 — ⚠️ 이 블록은 호버 Hint로 접지 않는다. PDF만 받아 본 사람이 계산 규약을
                  확인할 수 있는 유일한 자리라 인쇄본에 반드시 글자로 남아야 한다. */}
              <div className="border-t border-gray-800 pt-2 text-[12px] text-gray-600 leading-relaxed">
                <div className="flex items-start gap-1">
                  <HelpCircle size={12} className="mt-0.5 shrink-0" />
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
                      초록 '재투자' 행(분배금 재투자 매수)도 같은 이유로 매매차익에서 빼고 따로 셉니다.
                    </p>
                    {active.divReinvest !== 'hold' && (
                      <p>
                        분배금 처리 = <b>{DIV_REINVEST_LABEL[active.divReinvest]}</b> ·
                        배분 <b>{DIV_SPLIT_LABEL[active.divReinvestSplit]}</b>.
                        {active.divReinvest !== 'payDate' && ' 재투자 매수일은 리밸런싱과 같은 날짜 규칙(분배락 직전 영업일)이라 그 달 분배 권리까지 확보됩니다.'}
                        {' '}1주 값에 못 미치는 잔돈은 다음 재투자 회차로 이월됩니다.
                      </p>
                    )}
                    {active.policy === 'none' && (
                      <p>
                        <b>리밸런싱 안 함</b> 설정이라 초기 매수 이후 목표를 맞추는 매매는 일어나지 않습니다
                        (종목별로 따로 지정한 일정은 그대로 실행됩니다).
                      </p>
                    )}
                    <p>
                      세금·거래수수료·슬리피지는 반영하지 않았습니다. 종가는 앱에 저장된
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
