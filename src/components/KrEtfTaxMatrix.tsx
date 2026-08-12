// @ts-nocheck
import React, { useMemo, useState, useRef, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, RotateCcw, ExternalLink, Eye } from 'lucide-react';
import { generateId, cleanNum, formatCurrency, formatPercent, resolveHoldings, buildHeldNameMap } from '../utils';
import {
  getKrEtfStocks,
  getCodeTaxBase,
  safeNum,
  computeMonthlyAvgForGrid,
  computeMonthlyQtyForGrid,
  computeSellTaxRow,
  resolveAvgBuyPrice,
  isKrCode,
} from '../krEtfTaxHelpers';
const FUNETF_ORIGIN = 'https://www.funetf.co.kr';

function tickerToIsin(ticker) {
  const base = 'KR7' + ticker.toUpperCase() + '00';
  const digits = [];
  for (const c of base) {
    if (c >= '0' && c <= '9') digits.push(parseInt(c, 10));
    else if (c >= 'A' && c <= 'Z') { const v = c.charCodeAt(0) - 65 + 10; digits.push(Math.floor(v / 10), v % 10); }
  }
  digits.push(0);
  let sum = 0;
  const len = digits.length;
  for (let i = len - 1; i >= 0; i--) {
    let d = digits[i];
    if ((len - i) % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return base + String((10 - (sum % 10)) % 10);
}

const funetfEtfUrl = (code) => `${FUNETF_ORIGIN}/product/etf/view/${tickerToIsin(code)}`;

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const CURRENT_YEAR = new Date().getFullYear().toString();

const numInputCls = 'w-full bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-1 py-0.5 text-[10px] text-gray-100 outline-none tabular-nums text-right';
const exInputCls = 'w-full bg-gray-900/60 border border-gray-700 focus:border-amber-500 rounded px-1 py-0.5 text-[10px] text-amber-300 outline-none tabular-nums text-right';
const avgInputCls = 'w-full bg-gray-900/60 border border-gray-700 focus:border-sky-400 rounded px-1 py-0.5 text-[10px] text-sky-200 outline-none tabular-nums text-right';

// 평균단가(구매단가)를 어디서 가져왔는지 — 툴팁 표기용 (resolveAvgBuyPrice의 source와 1:1)
const AVG_SRC_LABEL = {
  portfolio: '포트폴리오 테이블 구매단가 (투자금액 ÷ 보유수량)',
  item: '종목의 구매단가 필드 (해외·붙여넣기 임포트)',
  events: '계산기 매수 이벤트 평균 매입단가 (포트폴리오에 수량·투자금액이 없어 폴백)',
  unreliable: '매입단가가 비어 있는 매수 행이 있어 계산기 매수 평균을 신뢰할 수 없음',
  none: '',
};
// 헤더에 상시 노출하는 짧은 출처 라벨 — 툴팁에만 두면 호버하지 않는 사용자는 화면에 없는 값으로
// 판정이 내려진 사실을 알 수 없다(특히 'item' 폴백은 포트폴리오 표의 구매단가와 다를 수 있다).
const AVG_SRC_SHORT = { portfolio: '포트폴리오 구매단가', item: '임포트 매입단가', events: '계산기 매수 평균', unreliable: '', none: '' };
// 포트폴리오 구매단가와 계산기 매수 평균이 이만큼 벌어지면 경고 — 매도를 포트폴리오 표에
// 반영할 때 보유수량만 줄이고 투자금액을 그대로 두면 구매단가가 폭등한다.
const AVG_BUY_MISMATCH_RATIO = 0.05;

const fmtTaxBase = (v) => {
  const n = safeNum(v);
  if (!n) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// 과표 이력에 실제 입력값이 있는지 (삭제된 종목의 '삭제됨' 유령 행 트리거용)
const taxBaseHasData = (rec) => !!rec && (
  (rec.events && rec.events.length > 0) ||
  (rec.purchases && rec.purchases.length > 0) ||
  (rec.sales && rec.sales.length > 0) ||
  (rec.exTaxBase && Object.keys(rec.exTaxBase).length > 0) ||
  (rec.avgTaxBase && Object.keys(rec.avgTaxBase).length > 0)
);

export default function KrEtfTaxMatrix({
  portfolio,
  updateTaxBaseEvents,
  updateTaxBasePurchases,
  updateTaxBaseSales,
  updateTaxBaseExPrice,
  updateTaxBaseAvgPrice,
  onToggleTaxMonth = () => {},
  deletePortfolioTaxData,
  confirmDialog,
  notify,
}) {
  const [expandedCode, setExpandedCode] = useState(null);

  // 가로 스크롤 시 '평균 과표 계산기'(확장 행)를 왼쪽에 고정(엑셀 틀 고정)하기 위해, 스크롤
  // 컨테이너의 가시 폭을 측정해 sticky 패널 너비로 사용한다. 콜백 ref + ResizeObserver로
  // 마운트/리사이즈 시점에 자동 갱신(초기 0이면 패널은 블록 기본폭으로 폴백).
  const [viewportW, setViewportW] = useState(0);
  const roRef = useRef(null);
  const setScrollRef = useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (node && typeof ResizeObserver !== 'undefined') {
      const update = () => setViewportW(node.clientWidth);
      update();
      roRef.current = new ResizeObserver(update);
      roRef.current.observe(node);
    }
  }, []);

  // 포트폴리오 종목 + 삭제됐지만 과표 이력이 남은 코드('삭제됨' 유령 행). 종목 삭제는 종목 행만
  // 지우고 taxBaseHistory[code]는 계좌에 그대로 남으므로, 그 입력값을 계속 표시·편집하도록 노출한다.
  const krStocks = useMemo(() => {
    const base = getKrEtfStocks(portfolio);
    const inPortfolio = new Set(base.map(s => String(s.code)));
    const nameMap = buildHeldNameMap(portfolio); // 삭제된 종목명은 보유 스냅샷에서 복원
    const orphans = Object.entries(portfolio?.taxBaseHistory || {})
      .filter(([code, rec]) => isKrCode(code) && !inPortfolio.has(String(code)) && taxBaseHasData(rec))
      .map(([code]) => ({ code, name: nameMap[code] || '', quantity: 0, type: 'stock', __orphan: true }));
    return [...base, ...orphans];
  }, [portfolio?.portfolio, portfolio?.taxBaseHistory, portfolio?.holdingSnapshots]);

  if (!portfolio) return null;

  if (krStocks.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-gray-500">
        한국 ETF 종목이 없습니다. 종목을 추가하면 과표 계산을 사용할 수 있습니다.
      </div>
    );
  }

  const monthYms = MONTHS.map((_, i) => `${CURRENT_YEAR}-${String(i + 1).padStart(2, '0')}`);

  // 월(0~11) 컬럼 숨기기 — 계좌별 hiddenTaxMonths. 표시 편의용이라 연합계·월별 합계 계산에는
  // 영향을 주지 않고(전 12개월로 계산 유지) 렌더만 숨긴다. 종목 열/연합계/평균 과표 계산기는 숨김 대상 아님.
  const hiddenTaxMonths = portfolio?.hiddenTaxMonths ?? [];
  const isMonthHidden = (i) => hiddenTaxMonths.includes(i);
  const visibleMonthCount = MONTHS.reduce((n, _, i) => n + (isMonthHidden(i) ? 0 : 1), 0);
  const monthHideStrip = (i) => (
    <div
      className="absolute top-0 left-0 right-0 h-3 cursor-pointer z-10 hover:bg-indigo-400/25 transition-colors"
      onClick={e => { e.stopPropagation(); onToggleTaxMonth(portfolio.id, i); }}
      title="클릭하여 이 월 숨기기"
    />
  );

  // 자산검증 스냅샷에서 전일 수량 조회
  const lookupPrevQty = (date, stockCode) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    const prevDate = d.toISOString().slice(0, 10);
    const { items } = resolveHoldings(portfolio, prevDate);
    const item = (items || []).find(i => i.code === stockCode);
    return item ? safeNum(item.quantity) : 0;
  };

  // 이벤트 목록에서 날짜순 정렬 + 누적 평균 과표 계산
  const buildSortedEventsWithAvg = (events) => {
    const valid = (events || [])
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')))
      .sort((a, b) => a.date.localeCompare(b.date));
    let runQty = 0, runAvg = 0;
    const withAvg = valid.map(evt => {
      const change = safeNum(evt.change);
      if (change > 0) {
        const newQty = runQty + change;
        runAvg = newQty > 0 ? (runQty * runAvg + change * safeNum(evt.taxBasePrice)) / newQty : 0;
        runQty = newQty;
      } else if (change < 0) {
        runQty = Math.max(0, runQty + change);
      }
      return { evt, runningAvg: runAvg, runningQty: runQty };
    });
    // 날짜 미입력 이벤트는 뒤에 추가
    const invalid = (events || []).filter(e => !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')));
    return [...withAvg, ...invalid.map(evt => ({ evt, runningAvg: 0, runningQty: 0 }))];
  };

  const stockRows = krStocks.map(stock => {
    const { events, purchases, sales, exTaxBase, avgTaxBase } = getCodeTaxBase(portfolio, stock.code);
    const computedAvg = computeMonthlyAvgForGrid(events, monthYms);
    const computedQtyMap = computeMonthlyQtyForGrid(events, monthYms);
    const hasQtyEvents = Object.keys(computedQtyMap).length > 0;
    const sortedEventsWithAvg = buildSortedEventsWithAvg(events);
    // 현재가 — 포트폴리오 테이블과 같은 라이브 시세(item.currentPrice). 삭제된 종목(유령 행)이나
    // 시세 미로드면 0 → 평가금액·손익은 '-'로 두고 계산하지 않는다.
    const curPrice = cleanNum(stock.currentPrice);
    // 매수 요약: 매입단가>0 인 매수 이벤트 기준 매수일·총 매수수량·총 매입금액·평균 매입단가
    const buyEvts = (events || [])
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) && safeNum(e.change) > 0 && safeNum(e.purchasePrice) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const buyQtyTotal = buyEvts.reduce((s, e) => s + safeNum(e.change), 0);
    const buyAmountTotal = buyEvts.reduce((s, e) => s + safeNum(e.change) * safeNum(e.purchasePrice), 0);
    // 매입단가가 비어 있는 매수 행은 합계에서 빠진다 — '요약 = 행별 값의 단순 합' 불변식을 지키되
    // 빠진 건수를 요약에 명시해 사용자가 누락을 알아채게 한다.
    const buyNoPriceCount = (events || [])
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) && safeNum(e.change) > 0 && !(safeNum(e.purchasePrice) > 0))
      .length;
    // 손익 = 현재가 × 총 매수수량 − 총 매입금액 (매수 이벤트 전체 기준 — 중간 매도분도 포함)
    const buyEvalTotal = curPrice > 0 ? curPrice * buyQtyTotal : 0;
    const buyProfitTotal = buyEvalTotal - buyAmountTotal;
    const buySummary = {
      count: buyEvts.length,
      firstDate: buyEvts[0]?.date || '',
      lastDate: buyEvts[buyEvts.length - 1]?.date || '',
      qtyTotal: buyQtyTotal,
      amountTotal: buyAmountTotal,
      avgPrice: buyQtyTotal > 0 ? buyAmountTotal / buyQtyTotal : 0,
      noPriceCount: buyNoPriceCount,
      hasCurPrice: curPrice > 0,
      evalTotal: buyEvalTotal,
      profitTotal: curPrice > 0 ? buyProfitTotal : 0,
      profitRate: curPrice > 0 && buyAmountTotal > 0 ? (buyProfitTotal / buyAmountTotal) * 100 : 0,
    };
    // 평균단가(구매단가) — 단가 기준 과세 판정에 쓰는 값. ⚠️ 국내 주식 행의 포트폴리오 '구매단가'는
    // item.purchasePrice가 아니라 투자금액 ÷ 보유수량이다(PortfolioTable 국내 분기). 자세한 폴백
    // 순서는 resolveAvgBuyPrice 주석 참조.
    // ⚠️ 매수 평균에서 빠진 행이 하나라도 있으면 계산기 매수 평균은 '부분 평균'이라 폴백으로
    //    쓰지 않는다(비과세 오확정 방지). 같은 이유로 괴리가 크면 헤더에 경고를 띄운다.
    //    빠지는 경우는 '매입단가 미입력'뿐 아니라 '날짜 미입력'도 있으므로 buyEvts의 여집합으로 센다
    //    (buyNoPriceCount는 날짜가 유효한 행만 세므로 날짜를 지운 매수 행을 놓친다).
    const buyExcludedCount = (events || [])
      .filter(e => safeNum(e.change) > 0)
      .filter(e => !(/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) && safeNum(e.purchasePrice) > 0))
      .length;
    const eventsAvg = buyExcludedCount === 0 ? buySummary.avgPrice : 0;
    const avgBuyBase = resolveAvgBuyPrice(stock, buySummary.avgPrice, buyExcludedCount === 0);
    // ⚠️ 교차검증 상태는 3값이다. 과거엔 'eventsAvg가 있고 5% 이상 다를 때'만 경고했는데, eventsAvg는
    //    매수 행이 불완전하면 0이 되므로 **경고가 가장 필요한 계좌에서 정확히 꺼졌다**(적대적 리뷰
    //    3렌즈 독립 확인). 비교 대상이 없는 것은 '정상'이 아니라 '교차검증 불가'로 표기해야 한다.
    const avgBuy = {
      ...avgBuyBase,
      alt: eventsAvg,
      excluded: buyExcludedCount,
      verify: avgBuyBase.source !== 'portfolio' || !(avgBuyBase.value > 0)
        ? 'na'
        : !(eventsAvg > 0)
          ? 'none'
          : Math.abs(avgBuyBase.value - eventsAvg) / eventsAvg >= AVG_BUY_MISMATCH_RATIO ? 'mismatch' : 'ok',
    };
    const currentQty = cleanNum(stock.quantity || 0);
    const monthData = monthYms.map(ym => {
      const exVal = exTaxBase[ym];
      const manualAvgVal = avgTaxBase[ym] !== undefined ? avgTaxBase[ym] : undefined;
      const computedAvgVal = computedAvg[ym];
      const avgVal = manualAvgVal !== undefined ? manualAvgVal : computedAvgVal;
      const exNum = safeNum(exVal);
      const avgNum = safeNum(avgVal);
      const taxBasePerShare = exNum - avgNum;
      const monthQty = hasQtyEvents ? (computedQtyMap[ym] ?? 0) : currentQty;
      const expected = Math.max(0, taxBasePerShare) * monthQty;
      return { ym, exVal, manualAvgVal, computedAvgVal, avgVal, exNum, avgNum, taxBasePerShare, expected, monthQty };
    });
    const annualExpected = monthData.reduce((s, d) => s + d.expected, 0);
    return { stock, events, sortedEventsWithAvg, buySummary, avgBuy, purchases, sales, currentQty, curPrice, monthData, annualExpected };
  });

  const monthlyExpected = monthYms.map((_, i) =>
    stockRows.reduce((s, r) => s + (r.monthData[i].expected || 0), 0),
  );
  const grandExpected = monthlyExpected.reduce((s, v) => s + v, 0);

  // ── 이벤트 CRUD ─────────────────────────────────────────────────────────────
  const persistEvents = (code, next) => updateTaxBaseEvents(portfolio.id, code, next);

  const addEvent = (code, events) => persistEvents(code, [
    ...events,
    { id: generateId(), date: new Date().toISOString().slice(0, 10), prevQty: 0, change: 0, taxBasePrice: 0 },
  ]);

  const updateEvent = (code, events, id, field, value) => persistEvents(code, events.map(e =>
    e.id !== id ? e : { ...e, [field]: field === 'date' ? String(value) : value },
  ));

  const deleteEvent = (code, events, id) => persistEvents(code, events.filter(e => e.id !== id));

  const handleEventDateChange = (stock, events, id, newDate) => {
    const updates = { date: newDate };
    if (/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      updates.prevQty = lookupPrevQty(newDate, stock.code);
    }
    persistEvents(stock.code, events.map(e => e.id !== id ? e : { ...e, ...updates }));
  };

  const refetchPrevQty = (stock, events, evt) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(evt.date || ''))) return;
    const prevQty = lookupPrevQty(evt.date, stock.code);
    persistEvents(stock.code, events.map(e => e.id !== evt.id ? e : { ...e, prevQty }));
  };

  return (
    <div className="overflow-x-auto" ref={setScrollRef}>
      <div className="px-3 py-2 bg-[#0f172a]/60 border-b border-gray-700/50 flex items-center gap-3 flex-wrap text-[10px]">
        <span className="text-gray-500">{CURRENT_YEAR}년 · 과세 과표 = 배당 과표 − 평균 과표 · 예상 과세 = max(0, 과세과표) × 보유주식수</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-500">연간 예상 과세 합계</span>
        <span className="text-emerald-400 font-semibold tabular-nums">{formatCurrency(grandExpected)}</span>
        {hiddenTaxMonths.length > 0 && (
          <span className="flex items-center gap-1 flex-wrap">
            <span className="text-gray-600">|</span>
            <span className="text-gray-500">숨긴 월</span>
            {[...hiddenTaxMonths].sort((a, b) => a - b).map(i => (
              <button
                key={i}
                onClick={() => onToggleTaxMonth(portfolio.id, i)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold text-gray-400 border border-gray-600 rounded bg-gray-800/80 hover:bg-gray-700 hover:text-amber-300 transition-colors"
                title={`${MONTHS[i]} 다시 표시`}
              >
                <Eye size={9} /> {MONTHS[i]}
              </button>
            ))}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-gray-600">월 상단 클릭 → 숨기기 · 종목명 클릭 → 평균 과표 계산기</span>
        </span>
      </div>
      <table className="w-full text-[11px] text-center">
        <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
          <tr>
            <th className="py-2 px-3 text-left sticky left-0 z-20 bg-[#1e293b] min-w-[170px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">종목</th>
            {MONTHS.map((m, i) => !isMonthHidden(i) && (
              <th key={m} className="py-2 px-1 min-w-[128px] font-normal relative">
                {monthHideStrip(i)}
                {m}
              </th>
            ))}
            <th className="py-2 px-2 min-w-[96px] text-yellow-500 font-bold">연합계</th>
          </tr>
        </thead>
        <tbody>
          {stockRows.map(({ stock, events, sortedEventsWithAvg, buySummary, avgBuy, purchases, sales, currentQty, curPrice, monthData, annualExpected }) => {
            const isExpanded = expandedCode === stock.code;
            return (
              <React.Fragment key={stock.code}>
                <tr className="border-b border-gray-700/40 hover:bg-gray-800/20">
                  <td className="py-2 px-3 text-left sticky left-0 z-20 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                    <div className="mb-1 flex items-center gap-1 flex-wrap">
                      <a
                        href={funetfEtfUrl(stock.code)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-2 py-0.5 rounded border border-gray-700/60 text-gray-400 hover:text-gray-200 hover:border-gray-500 hover:bg-gray-800/40 inline-flex items-center gap-1 transition"
                        title={`FunETF 상세 페이지 — ${stock.name || stock.code}`}
                      >
                        <ExternalLink size={10} /> FunETF
                      </a>
                      {stock.__orphan && (
                        <span className="text-[8px] px-1 py-0.5 rounded border border-rose-500/40 text-rose-300/80 font-bold leading-none" title="포트폴리오에서 삭제된 종목 — 입력한 과표 기록은 보존됩니다">삭제됨</span>
                      )}
                      {stock.__orphan && deletePortfolioTaxData && (
                        <button
                          onClick={async () => {
                            const ok = confirmDialog
                              ? await confirmDialog(`'${stock.name || stock.code}'의 과표 입력 기록을 영구 삭제할까요?`, '삭제')
                              : true;
                            if (ok) deletePortfolioTaxData(portfolio.id, stock.code);
                          }}
                          title="이 종목의 과표 입력 기록 영구 삭제"
                          className="ml-auto text-gray-600 hover:text-red-400 transition-colors"
                        ><Trash2 size={11} /></button>
                      )}
                    </div>
                    <button
                      onClick={() => setExpandedCode(isExpanded ? null : stock.code)}
                      className="flex items-start gap-1.5 text-left w-full hover:text-amber-300"
                    >
                      {isExpanded
                        ? <ChevronDown size={12} className="text-amber-400 mt-0.5 shrink-0" />
                        : <ChevronRight size={12} className="text-gray-500 mt-0.5 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-gray-100 font-medium truncate">{stock.name || stock.code}</div>
                        <div className="text-[9px] text-gray-500 tabular-nums">
                          {stock.code} · 보유 {currentQty.toLocaleString()}주
                          {events.length > 0 && (
                            <span className="text-sky-400/70 ml-1">· 이벤트 {events.length}건</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </td>
                  {monthData.map((d, i) => !isMonthHidden(i) && (
                    <td key={d.ym} className="py-1 px-1 align-top">
                      <div className="space-y-0.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={d.exVal ?? ''}
                          onChange={e => updateTaxBaseExPrice(portfolio.id, stock.code, d.ym, e.target.value)}
                          placeholder="배당 과표"
                          className={exInputCls}
                          title="배당락일 과표기준가 (1주당)"
                        />
                        <div className="text-[9px] text-gray-500 tabular-nums text-right px-0.5" title="해당 월 말 기준 보유 주식수">
                          보유 {d.monthQty.toLocaleString()}주
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              d.manualAvgVal !== undefined
                                ? d.manualAvgVal
                                : (d.computedAvgVal ? fmtTaxBase(d.computedAvgVal) : '')
                            }
                            onChange={e => {
                              const val = e.target.value;
                              updateTaxBaseAvgPrice(portfolio.id, stock.code, d.ym, val === '' ? null : val);
                            }}
                            placeholder={d.computedAvgVal ? '자동' : '평균 과표'}
                            className={
                              avgInputCls +
                              (d.manualAvgVal === undefined && d.computedAvgVal ? ' opacity-60' : '')
                            }
                            title={
                              d.manualAvgVal === undefined && d.computedAvgVal
                                ? '이벤트 기반 자동 계산 (수정하면 수동 저장, 빈칸으로 되돌리기)'
                                : '평균 과표 (수동 입력)'
                            }
                          />
                        </div>
                        {d.manualAvgVal === undefined && d.computedAvgVal ? (
                          <div className="text-[8px] text-sky-500/50 text-right px-0.5">자동</div>
                        ) : d.manualAvgVal !== undefined && d.computedAvgVal ? (
                          <button
                            onClick={() => updateTaxBaseAvgPrice(portfolio.id, stock.code, d.ym, null)}
                            className="text-[8px] text-sky-500/60 hover:text-sky-400 text-right px-0.5 block w-full"
                            title="이벤트 기반 자동 계산값으로 되돌리기"
                          >↺ 자동</button>
                        ) : null}
                        <div className="text-[9px] text-sky-300 tabular-nums text-right px-0.5" title="과세 과표 = 배당 과표 − 평균 과표 (1주당)">
                          과세 {fmtTaxBase(d.taxBasePerShare)}
                        </div>
                        <div className="text-[10px] text-emerald-400 tabular-nums text-right px-0.5 font-medium" title="예상 과세 = max(0, 과세 과표) × 보유 주식수">
                          예상 {formatCurrency(d.expected)}
                        </div>
                      </div>
                    </td>
                  ))}
                  <td className="py-1 px-2 text-center tabular-nums align-top">
                    <div className="text-[11px] text-emerald-400 font-semibold">{annualExpected > 0 ? formatCurrency(annualExpected) : '-'}</div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-[#0b1322] border-b border-gray-700/40">
                    <td colSpan={visibleMonthCount + 2} className="p-0 align-top">
                      <div className="sticky left-0 px-4 py-3" style={{ width: viewportW || undefined }}>
                      <div className="border border-gray-700/60 rounded-lg bg-gray-900/40">
                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800">
                          <span className="text-[11px] font-semibold text-gray-200">평균 과표 계산기</span>
                          <span className="text-[10px] text-gray-500">{events.length}건</span>
                          <button
                            onClick={() => addEvent(stock.code, events)}
                            className="text-[10px] px-2 py-0.5 rounded border border-blue-700/60 text-blue-400 hover:text-blue-300 hover:border-blue-500 inline-flex items-center gap-1"
                          >
                            <Plus size={10} /> 행 추가
                          </button>
                        </div>
                        {events.length === 0 ? (
                          <div className="text-[10px] text-gray-600 text-center py-4">
                            이벤트가 없습니다. '행 추가'로 매입/매도를 입력하세요.
                          </div>
                        ) : (
                          <>
                            {/* 가로 스크롤은 표에만 — 하단 요약 바를 이 컨테이너에 넣으면 열이 많을 때 함께 밀린다 */}
                            <div className="overflow-x-auto">
                              <table className="text-[10px] border-collapse">
                                <thead className="text-gray-500 border-b border-gray-700/50">
                                  <tr>
                                    <th className="text-left py-1 pl-2 pr-1 font-normal w-[108px]">일자</th>
                                    <th className="text-right py-1 px-1 font-normal w-[84px]">
                                      전일 수량
                                      <span className="text-gray-600 font-normal ml-0.5" title="자산검증 전일 수량 자동 조회">↺</span>
                                    </th>
                                    <th className="text-right py-1 px-1 font-normal w-[68px]" title="매수=양수 / 매도=음수">매매수량</th>
                                    <th className="text-right py-1 px-1 font-normal w-[92px] text-orange-400/70" title="매수 행 = 매입단가 / 매도 행 = 매도단가(그날의 종가)">매입/매도단가</th>
                                    <th className="text-right py-1 px-1 font-normal w-[104px]" title="매수 = 매매수량 × 매입단가 / 매도 = 매도수량 × 매도단가">매입/매도금액</th>
                                    <th className="text-right py-1 px-1 font-normal w-[120px]" title="현재가격 × 매매수량 — 그 매입 수량의 현재 평가금액. 아랫줄은 손익 · 수익률(이익 빨강 / 손실 파랑)">
                                      현재가 × 매매수량
                                      <div className="text-[8px] text-gray-600 font-normal tabular-nums">
                                        {curPrice > 0 ? `현재가 ${curPrice.toLocaleString()}원` : '현재가 없음'}
                                      </div>
                                    </th>
                                    <th className="text-right py-1 px-1 font-normal w-[88px]">과표기준가</th>
                                    <th className="text-right py-1 px-1 font-normal w-[80px]">평균 과표</th>
                                    <th className="text-right py-1 px-1 font-normal w-[100px] text-emerald-400/70" title="과표 기준 과세표준 = (매도 과표기준가 − 평균 과표) × 매도주식수, 0 이하면 비과세">과세 금액(과표)</th>
                                    <th
                                      className="text-right py-1 px-1 font-normal w-[110px] text-emerald-400/70"
                                      title={
                                        '단가 기준 과세표준 = (매도단가 − 평균단가) × 매도주식수, 0 이하면 비과세'
                                        + (avgBuy.source !== 'none' ? `\n평균단가 출처: ${AVG_SRC_LABEL[avgBuy.source]}` : '')
                                        + (avgBuy.alt > 0 ? `\n계산기 매수 평균: ${fmtTaxBase(avgBuy.alt)}원` : '')
                                        + (avgBuy.verify === 'mismatch' ? '\n⚠ 두 값이 5% 이상 다릅니다 — 포트폴리오의 보유수량·투자금액이 매도 반영과 어긋났을 수 있습니다' : '')
                                        + (avgBuy.verify === 'none' ? '\n⚠ 계산기 매수 평균이 없어(매수 행 없음 또는 매입단가·일자 미입력) 이 값을 교차검증할 수 없습니다 — 매도를 포트폴리오 표에 반영할 때 보유수량만 줄이고 투자금액을 그대로 두면 구매단가가 실제보다 커집니다' : '')
                                      }
                                    >
                                      과세 금액(단가)
                                      <div className={`text-[8px] font-normal tabular-nums ${avgBuy.verify === 'mismatch' ? 'text-amber-400/80' : 'text-gray-600'}`}>
                                        {avgBuy.value > 0
                                          ? `평균단가 ${fmtTaxBase(avgBuy.value)}원${avgBuy.verify === 'mismatch' ? ' ⚠' : ''}`
                                          : avgBuy.source === 'unreliable' ? '평균단가 불확실' : '평균단가 없음'}
                                      </div>
                                      {avgBuy.value > 0 && (
                                        <div className={`text-[8px] font-normal ${avgBuy.verify === 'none' ? 'text-amber-400/60' : 'text-gray-700'}`}>
                                          {AVG_SRC_SHORT[avgBuy.source]}{avgBuy.verify === 'none' ? ' · 교차검증 불가' : ''}
                                        </div>
                                      )}
                                    </th>
                                    <th className="text-right py-1 px-1 font-normal w-[96px] text-amber-300/70" title="실제 과세 = 과표 기준·단가 기준이 모두 0보다 클 때만 과세. 금액은 둘 중 작은 쪽(min)">실제 과세</th>
                                    <th className="py-1 px-1 w-[20px]"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortedEventsWithAvg.map(({ evt, runningAvg }) => {
                                    const changeNum = safeNum(evt.change);
                                    const isSell = changeNum < 0;
                                    const isBuy = changeNum > 0;
                                    // 매입금액 = 매매수량 × 매입단가 / 현재 평가 = 현재가 × 매매수량 (둘 다 매수 행만)
                                    const buyPrice = safeNum(evt.purchasePrice);
                                    const buyAmount = isBuy && buyPrice > 0 ? changeNum * buyPrice : 0;
                                    const buyEval = isBuy && curPrice > 0 ? changeNum * curPrice : 0;
                                    const rowProfit = buyAmount > 0 && curPrice > 0 ? buyEval - buyAmount : null;
                                    const rowProfitRate = rowProfit !== null ? (rowProfit / buyAmount) * 100 : null;
                                    // ⚠️ 매도단가는 evt.sellPrice, 매입단가는 evt.purchasePrice — 화면은 한 칸이지만
                                    //    저장 필드는 분리한다. 한 필드를 공유하면 매매수량 부호를 정정하는 순간
                                    //    (예: -630 오타를 +630으로) 저장된 값이 반대 의미로 재해석돼, 입력한 적 없는
                                    //    매입단가가 매수 요약·손익을 오염시키거나 그 반대가 된다.
                                    const sellUnit = safeNum(evt.sellPrice);
                                    const priceField = isSell ? 'sellPrice' : 'purchasePrice';
                                    const priceRaw = evt[priceField];
                                    // 매도 1건의 과세 3종(과표 기준 · 단가 기준 · 실제 과세)
                                    const sc = computeSellTaxRow({
                                      change: evt.change,
                                      taxBasePrice: evt.taxBasePrice,
                                      sellPrice: evt.sellPrice,
                                      avgTaxBase: runningAvg,
                                      avgBuyPrice: avgBuy.value,
                                    });
                                    return (
                                      <tr key={evt.id} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/10">
                                        <td className="py-1 pl-2 pr-0.5">
                                          <input
                                            type="date"
                                            value={evt.date || ''}
                                            onChange={e => handleEventDateChange(stock, events, evt.id, e.target.value)}
                                            className="bg-gray-900 border border-gray-700 focus:border-amber-500 rounded px-1 py-0.5 text-[10px] text-gray-100 outline-none w-[100px]"
                                          />
                                        </td>
                                        <td className="py-1 px-1">
                                          <div className="flex items-center gap-0.5">
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              value={evt.prevQty !== undefined && evt.prevQty !== null && evt.prevQty !== '' ? evt.prevQty : ''}
                                              onChange={e => updateEvent(stock.code, events, evt.id, 'prevQty', e.target.value)}
                                              placeholder="0"
                                              className={numInputCls + ' flex-1 min-w-0'}
                                              title="전일 보유 수량 (직접 입력 가능)"
                                            />
                                            <button
                                              onClick={() => refetchPrevQty(stock, events, evt)}
                                              className="text-gray-600 hover:text-sky-400 p-0.5 rounded shrink-0 transition"
                                              title="자산검증에서 전일 수량 재조회"
                                            ><RotateCcw size={9} /></button>
                                          </div>
                                        </td>
                                        <td className="py-1 px-1">
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={evt.change !== undefined && evt.change !== '' ? evt.change : ''}
                                            onChange={e => updateEvent(stock.code, events, evt.id, 'change', e.target.value)}
                                            placeholder="0"
                                            className={numInputCls + (isSell ? ' !text-rose-400' : isBuy ? ' !text-emerald-400' : '')}
                                            title="매수=양수, 매도=음수"
                                          />
                                        </td>
                                        <td className="py-1 px-1">
                                          {isBuy || isSell ? (
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              value={priceRaw !== undefined && priceRaw !== '' ? priceRaw : ''}
                                              onChange={e => updateEvent(stock.code, events, evt.id, priceField, e.target.value)}
                                              placeholder={isSell ? '매도단가' : '0'}
                                              className={numInputCls + (isSell ? ' !text-rose-300' : ' !text-orange-300')}
                                              title={isSell
                                                ? '매도단가 (그날의 종가) — 매도금액과 단가 기준 과세 계산에 사용'
                                                : '실제 매입단가 (차트 평균단가 기준 수익률 계산용)'}
                                            />
                                          ) : (
                                            <div className="text-[10px] text-gray-700 text-right px-1">-</div>
                                          )}
                                        </td>
                                        <td
                                          className="py-1 px-1 text-right tabular-nums text-gray-300"
                                          title={buyAmount > 0
                                            ? `${changeNum.toLocaleString()}주 × ${buyPrice.toLocaleString()}원`
                                            : sc.sellAmount !== null
                                              ? `매도 ${sc.soldQty.toLocaleString()}주 × ${sellUnit.toLocaleString()}원 (매도단가)`
                                              : undefined}
                                        >
                                          {buyAmount > 0
                                            ? formatCurrency(Math.round(buyAmount))
                                            : sc.sellAmount !== null
                                              ? <span className="text-rose-300">{formatCurrency(Math.round(sc.sellAmount))}</span>
                                              : <span className="text-gray-700">-</span>}
                                        </td>
                                        <td className="py-1 px-1 text-right tabular-nums">
                                          {isBuy && curPrice > 0 ? (
                                            <>
                                              <div className="text-gray-100" title={`${changeNum.toLocaleString()}주 × ${curPrice.toLocaleString()}원 (현재가)`}>
                                                {formatCurrency(Math.round(buyEval))}
                                              </div>
                                              {rowProfit !== null ? (
                                                <div
                                                  className={`text-[8px] font-medium ${rowProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}
                                                  title="손익 = 현재가 × 매매수량 − 매입금액"
                                                >
                                                  {(rowProfit >= 0 ? '+' : '') + formatCurrency(Math.round(rowProfit))}
                                                  {' · '}
                                                  {(rowProfitRate >= 0 ? '+' : '') + formatPercent(rowProfitRate)}
                                                </div>
                                              ) : (
                                                <div className="text-[8px] text-gray-600" title="매입단가를 입력하면 손익·수익률이 계산됩니다">매입단가 미입력</div>
                                              )}
                                            </>
                                          ) : (
                                            <span className="text-gray-700">-</span>
                                          )}
                                        </td>
                                        <td className="py-1 px-1">
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={evt.taxBasePrice !== undefined && evt.taxBasePrice !== '' ? evt.taxBasePrice : ''}
                                            onChange={e => updateEvent(stock.code, events, evt.id, 'taxBasePrice', e.target.value)}
                                            placeholder="0.00"
                                            className={numInputCls}
                                          />
                                        </td>
                                        <td className="py-1 px-1 text-right tabular-nums text-sky-300">
                                          {runningAvg > 0 ? fmtTaxBase(runningAvg) : <span className="text-gray-700">-</span>}
                                        </td>
                                        <td className="py-1 px-1 text-right tabular-nums">
                                          {sc.baseReady ? (
                                            sc.basePerShare > 0 ? (
                                              <>
                                                <div className="text-emerald-400 font-medium" title="과세금액 = (과표기준가 − 평균 과표) × 매도주식수">
                                                  {formatCurrency(sc.baseAmount)}
                                                </div>
                                                <div className="text-[8px] text-gray-500">+{fmtTaxBase(sc.basePerShare)}/주 × {sc.soldQty.toLocaleString()}</div>
                                              </>
                                            ) : (
                                              <>
                                                <div className="text-gray-400" title="과표기준가 ≤ 평균 과표 → 비과세">비과세</div>
                                                <div className="text-[8px] text-gray-600">{fmtTaxBase(sc.basePerShare)}/주</div>
                                              </>
                                            )
                                          ) : (
                                            <span className="text-gray-700">-</span>
                                          )}
                                        </td>
                                        <td className="py-1 px-1 text-right tabular-nums">
                                          {sc.priceReady ? (
                                            sc.pricePerShare > 0 ? (
                                              <>
                                                <div className="text-emerald-400 font-medium" title="과세금액 = (매도단가 − 평균단가) × 매도주식수">
                                                  {formatCurrency(sc.priceAmount)}
                                                </div>
                                                <div className="text-[8px] text-gray-500">+{fmtTaxBase(sc.pricePerShare)}/주 × {sc.soldQty.toLocaleString()}</div>
                                              </>
                                            ) : (
                                              <>
                                                <div className="text-gray-400" title="매도단가 ≤ 평균단가 → 비과세">비과세</div>
                                                <div className="text-[8px] text-gray-600">{fmtTaxBase(sc.pricePerShare)}/주</div>
                                              </>
                                            )
                                          ) : sc.isSell ? (
                                            <span
                                              className={`text-[9px] ${avgBuy.source === 'unreliable' ? 'text-amber-400/70' : 'text-gray-600'}`}
                                              title={avgBuy.value > 0
                                                ? '매입단가 칸에 매도단가(그날의 종가)를 입력하면 계산됩니다'
                                                : avgBuy.source === 'unreliable'
                                                  ? `매수 평균에서 빠진 매수 행이 ${avgBuy.excluded}건(매입단가 또는 일자 미입력) 있어 평균단가를 신뢰할 수 없습니다 — 그 행을 채우거나 포트폴리오의 보유수량·투자금액을 입력하세요`
                                                  : '평균단가(구매단가)를 구할 수 없습니다 — 포트폴리오의 보유수량·투자금액 또는 매수 이벤트의 매입단가를 입력하세요'}
                                            >{avgBuy.value > 0 ? '매도단가 미입력' : avgBuy.source === 'unreliable' ? '평균단가 불확실' : '평균단가 없음'}</span>
                                          ) : (
                                            <span className="text-gray-700">-</span>
                                          )}
                                        </td>
                                        <td className="py-1 px-1 text-right tabular-nums">
                                          {sc.taxable === true ? (
                                            <>
                                              <div className="text-amber-300 font-semibold" title="실제 과세표준 = min(과표 기준, 단가 기준) — 둘 다 0보다 클 때만 과세">
                                                {formatCurrency(sc.actualAmount)}
                                              </div>
                                              <div className="text-[8px] text-amber-500/70">과세 · min {fmtTaxBase(sc.actualPerShare)}/주</div>
                                            </>
                                          ) : sc.taxable === false ? (
                                            <>
                                              <div className="text-gray-400" title="과표 기준·단가 기준 중 하나라도 0 이하면 비과세">비과세</div>
                                              <div className="text-[8px] text-gray-600">
                                                {sc.exemptReason === 'both' ? '과표·단가 모두 ≤ 0' : sc.exemptReason === 'base' ? '과표 ≤ 0' : '단가 ≤ 0'}
                                              </div>
                                            </>
                                          ) : sc.isSell ? (
                                            <span
                                              className="text-[9px] text-gray-600"
                                              title="과표기준가·평균 과표·매도단가·평균단가가 모두 있어야 과세 여부를 확정할 수 있습니다"
                                            >판정 불가</span>
                                          ) : (
                                            <span className="text-gray-700">-</span>
                                          )}
                                        </td>
                                        <td className="py-1 px-1 text-center">
                                          <button
                                            onClick={() => deleteEvent(stock.code, events, evt.id)}
                                            className="text-gray-600 hover:text-red-400 p-0.5 rounded transition"
                                            title="삭제"
                                          ><Trash2 size={10} /></button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {buySummary.count > 0 && (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-t border-gray-700/50 bg-gray-900/40 text-[10px]">
                                <span className="text-gray-500">매수일
                                  <span className="text-gray-200 font-semibold ml-1">{buySummary.firstDate}{buySummary.lastDate !== buySummary.firstDate ? ` ~ ${buySummary.lastDate}` : ''}</span>
                                  <span className="text-gray-600 ml-1">({buySummary.count}건)</span>
                                </span>
                                <span className="text-gray-700">·</span>
                                <span className="text-gray-500">매수 합계
                                  <span className="text-emerald-300 font-semibold ml-1 tabular-nums">{buySummary.qtyTotal.toLocaleString()}주</span>
                                </span>
                                <span className="text-gray-700">·</span>
                                <span className="text-gray-500">매입금액
                                  <span className="text-gray-200 font-semibold ml-1 tabular-nums">{formatCurrency(Math.round(buySummary.amountTotal))}</span>
                                </span>
                                <span className="text-gray-700">·</span>
                                <span className="text-gray-500">매입 평균 단가
                                  <span className="text-orange-300 font-bold ml-1 tabular-nums">{buySummary.avgPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원</span>
                                </span>
                                {buySummary.hasCurPrice ? (
                                  <>
                                    <span className="text-gray-700">·</span>
                                    <span className="text-gray-500">현재 평가
                                      <span className="text-gray-200 font-semibold ml-1 tabular-nums" title={`${buySummary.qtyTotal.toLocaleString()}주 × ${curPrice.toLocaleString()}원 (현재가)`}>
                                        {formatCurrency(Math.round(buySummary.evalTotal))}
                                      </span>
                                    </span>
                                    <span className="text-gray-700">·</span>
                                    <span className="text-gray-500">손익
                                      <span
                                        className={`font-bold ml-1 tabular-nums ${buySummary.profitTotal >= 0 ? 'text-red-400' : 'text-blue-400'}`}
                                        title="손익 = 현재가 × 총 매수수량 − 총 매입금액 (매수 이벤트 전체 기준)"
                                      >
                                        {(buySummary.profitTotal >= 0 ? '+' : '') + formatCurrency(Math.round(buySummary.profitTotal))}
                                        <span className="ml-1">({(buySummary.profitRate >= 0 ? '+' : '') + formatPercent(buySummary.profitRate)})</span>
                                      </span>
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-gray-700">·</span>
                                    <span className="text-gray-600" title="포트폴리오에 현재가가 없어(삭제된 종목·시세 미로드) 평가·손익을 계산할 수 없습니다">현재가 없음 → 손익 계산 불가</span>
                                  </>
                                )}
                                {buySummary.noPriceCount > 0 && (
                                  <>
                                    <span className="text-gray-700">·</span>
                                    <span className="text-amber-400/70" title="매입단가가 비어 있는 매수 행은 매입금액·현재 평가·손익 합계에서 제외됩니다">매입단가 미입력 {buySummary.noPriceCount}건 제외</span>
                                  </>
                                )}
                              </div>
                            )}
                          </>
                        )}
                        <div className="px-3 py-1 text-[9px] text-gray-600 border-t border-gray-800/50">
                          일자 선택 시 자산검증 전일 수량 자동 조회 &nbsp;·&nbsp; 매수=양수 / 매도=음수 &nbsp;·&nbsp; 평균 과표는 이벤트 순서로 자동 계산되어 위 표에 반영됨
                          <br />
                          <span className="text-orange-400/60">매입단가</span> 는 아래 매수 요약(평균 매입단가) 산출에 사용됩니다 · 차트 '일일 수익률'(🎯)은 포트폴리오 테이블 매입금액 기준으로 증권사 수익률과 일치
                          <br />
                          <span className="text-gray-500">매입금액</span> = 매매수량 × 매입단가 &nbsp;·&nbsp; <span className="text-gray-500">현재가 × 매매수량</span> = 그 매입 수량의 현재 평가금액(포트폴리오 테이블과 같은 라이브 시세)이며 아랫줄에 손익·수익률(<span className="text-red-400/70">이익</span>/<span className="text-blue-400/70">손실</span>)을 표시 &nbsp;·&nbsp; 매도 행은 매입금액 칸에 <span className="text-rose-300/70">매도금액</span>을 표시하고 현재가 × 매매수량은 <span className="text-gray-500">-</span>
                          <br />
                          하단 요약 <span className="text-gray-500">손익</span> = 현재가 × 총 매수수량 − 총 매입금액 &nbsp;·&nbsp; 매수 이벤트 전체 기준(중간 매도분 포함)이라 위 행별 값의 단순 합과 같음 &nbsp;·&nbsp; 매도 행은 매수 요약에 포함되지 않음
                          <br />
                          <span className="text-rose-300/70">매도단가</span> = 매도 행의 매입단가 칸에 그날의 종가를 입력 → <span className="text-gray-500">매도금액</span> = 매도수량 × 매도단가
                          <br />
                          <span className="text-emerald-400/70">과세 금액(과표)</span> = (매도 과표기준가 − 평균 과표) × 매도주식수 &nbsp;·&nbsp; <span className="text-emerald-400/70">과세 금액(단가)</span> = (매도단가 − 평균단가) × 매도주식수 &nbsp;·&nbsp; 각각 0 이하면 <span className="text-gray-400">비과세</span> (세율 미적용 과세표준)
                          <br />
                          <span className="text-amber-300/70">실제 과세</span> = 위 두 값이 <b className="text-gray-400">모두</b> 0보다 클 때만 과세이며 금액은 작은 쪽(min) &nbsp;·&nbsp; 하나라도 0 이하면 <span className="text-gray-400">비과세</span> &nbsp;·&nbsp; 한쪽이 미입력이어도 나머지가 0 이하면 비과세로 확정, 둘 다 필요한 '과세'는 <span className="text-gray-500">판정 불가</span>로 표기
                          <br />
                          <span className="text-gray-500">평균단가</span>는 ① 포트폴리오 구매단가(투자금액 ÷ 보유수량) → ② 종목의 구매단가 필드(붙여넣기 임포트) → ③ 계산기 매수 평균 순으로 채택하며 <b className="text-gray-400">실제 사용된 출처를 헤더 아래에 표시</b>합니다 &nbsp;·&nbsp; ③은 매입단가·일자가 빠진 매수 행이 하나라도 있으면 부분 평균이라 쓰지 않고 <span className="text-amber-400/70">평균단가 불확실</span>로 두어 단가 기준 과세를 계산하지 않습니다(잘못된 비과세 확정 방지)
                          <br />
                          ①은 <b className="text-gray-400">현재 시점</b> 값이라 매도·추가매수를 포트폴리오 표에 반영하면 과거 매도 행의 판정도 함께 바뀝니다 &nbsp;·&nbsp; 특히 <b className="text-gray-400">보유수량만 줄이고 투자금액을 그대로 두면</b> 구매단가가 실제보다 커져 과세 건이 비과세로 뒤집힙니다 → ③과 5% 이상 벌어지면 <span className="text-amber-400/80">⚠</span>, ③이 없어 대조할 수 없으면 <span className="text-amber-400/60">교차검증 불가</span>로 헤더에 표시합니다
                        </div>
                      </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot className="bg-[#0f172a] border-t border-gray-600">
          <tr>
            <td className="py-2 px-3 text-left sticky left-0 z-20 bg-[#0f172a] text-[11px] font-bold text-gray-300 [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
              월별 예상 과세 합계
            </td>
            {monthlyExpected.map((v, i) => !isMonthHidden(i) && (
              <td key={i} className="py-1 px-1 tabular-nums">
                <div className="text-[10px] text-emerald-400 font-semibold">{v > 0 ? formatCurrency(v) : '-'}</div>
              </td>
            ))}
            <td className="py-1 px-2 tabular-nums">
              <div className="text-[11px] text-yellow-400 font-bold">{grandExpected > 0 ? formatCurrency(grandExpected) : '-'}</div>
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="px-3 py-1.5 bg-[#0f172a]/60 text-[10px] text-gray-600 border-t border-gray-700/50">
        배당 과표·평균 과표 입력 → 과세 과표(배당-평균)·예상 과세 자동 계산 · 평균 과표 "자동" = 이벤트 기반 자동 산출 (빈칸 입력 시 되돌리기)
      </div>
    </div>
  );
}
