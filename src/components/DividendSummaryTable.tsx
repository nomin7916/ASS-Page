// @ts-nocheck
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { cleanNum, formatCurrency, dividendPayDate } from '../utils';
import { fetchDividendHistory, fetchYahooDividendHistory, fetchStockInfo, fetchUsStockInfo } from '../api';
import KrEtfTaxMatrix from './KrEtfTaxMatrix';
import ErrorBoundary from './ErrorBoundary';

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const CURRENT_YEAR = new Date().getFullYear().toString();
const formatUsd = (v) => v > 0 ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;

const isKrCode = (code) => /^[A-Z0-9]{5,6}$/i.test(String(code || ''));
const isUsCode = (code) => /^[A-Z]{1,5}$/i.test(String(code || ''));
const getCodeType = (code, pf) => {
  if (pf.accountType === 'overseas') return isUsCode(code) ? 'us' : null;
  return isKrCode(code) ? 'kr' : null;
};

function buildMonthPrediction(codeHistory) {
  const pred = {};
  for (let m = 1; m <= 12; m++) {
    const mo = String(m).padStart(2, '0');
    const entries = Object.entries(codeHistory || {})
      .filter(([key]) => key.endsWith(`-${mo}`))
      .sort(([a], [b]) => b.localeCompare(a));
    if (entries.length > 0) pred[m] = entries[0][1];
  }
  return pred;
}

// 월별 배당락일 예측: 같은 월(MM)의 가장 최근 연도 배당락일(YYYY-MM-DD) 선택
function buildMonthExPrediction(codeExHistory) {
  const pred = {};
  for (let m = 1; m <= 12; m++) {
    const mo = String(m).padStart(2, '0');
    const entries = Object.entries(codeExHistory || {})
      .filter(([key]) => key.endsWith(`-${mo}`))
      .sort(([a], [b]) => b.localeCompare(a));
    if (entries.length > 0) pred[m] = entries[0][1];
  }
  return pred;
}

// 'YYYY-MM-DD' → 'MM/DD' (없으면 '')
const fmtMD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? `${s.slice(5, 7)}/${s.slice(8, 10)}` : '';

const _CY = Number(CURRENT_YEAR);

// 종목의 배당락→지급 슬롯 오프셋(개월) 추정. 월배당 T+2 관례상 직전월 배당락→익월
// 지급이면 1, 배당락·지급이 동월(월초/월중형)이면 0. 비어있는 미래 지급월의 폴백
// 배당락 키를 실제 소스와 동일 오프셋으로 맞춰, 폴백 키가 다른 슬롯의 실제 저장 키와
// 겹쳐 두 달 셀이 같은 키를 읽고/쓰는 버그(한 셀 수정·삭제가 옆 달에 전이)를 막는다.
function slotExOffset(slots) {
  const counts = new Map();
  slots.forEach((srcs, payIdx) => {
    srcs.forEach(s => {
      const off = ((payIdx - s.exMonthIdx) % 12 + 12) % 12;
      counts.set(off, (counts.get(off) || 0) + 1);
    });
  });
  if (!counts.size) return 1; // 실제 소스가 전혀 없으면 월배당 관례(1)로 가정
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

// 비어있는 미래 지급월에 사용자가 실수령액을 직접 기록할 때 쓸 폴백 배당락 키.
// 빈 슬롯은 예측 분배금을 표시하지 않고(빈 셀) 사용자 입력만 받으므로, 폴백 키가
// (1) 실제 소스의 배당락월 키, (2) 다른 빈 슬롯의 폴백 키와 절대 겹치지 않도록
// 보장한다. 겹치면 한 셀 편집·삭제가 옆 달로 전이된다(사용자 보고 버그).
// 반환: 슬롯별 폴백 exYm 배열(실제 소스 있는 슬롯은 null). slots가 고정이면
// 결과도 결정적이라 입력 전후 같은 키를 가리켜 값이 같은 셀에 유지된다.
function buildFallbackExYms(slots) {
  const off = slotExOffset(slots);
  const used = new Set();
  slots.forEach(srcs => srcs.forEach(s => used.add(s.exYm)));
  return slots.map((srcs, payIdx) => {
    if (srcs.length) return null;
    let raw = payIdx - off;
    let exYm = '';
    for (let guard = 0; guard < 24; guard++) {
      const exMonthIdx = ((raw % 12) + 12) % 12;
      const year = raw < 0 ? _CY - 1 : raw > 11 ? _CY + 1 : _CY;
      exYm = `${year}-${String(exMonthIdx + 1).padStart(2, '0')}`;
      if (!used.has(exYm)) break;
      raw -= 1; // 충돌 시 한 달 앞으로 이동해 고유 키 확보
    }
    used.add(exYm);
    return exYm;
  });
}

// 종목 배당 주기/지급 시점 분류 배지 (코드명 옆 표시).
// - 데이터상 연 1회 → '년말', 연 2~6회 → '분기'
// - 월배당(연 7회 이상) → 대표 배당락일의 지급일(+2영업일) 일자로 월초/월중/월말
//   (배당락 월말 → 지급 월초 → '월초', 배당락 10~15일 → 지급 월중 → '월중')
function classifyCadence(hist, exH, hol) {
  const keys = Object.keys(hist || {});
  if (!keys.length) return null;
  const byYear = {};
  keys.forEach(k => {
    const [y, m] = String(k).split('-');
    if (!y || !m) return;
    (byYear[y] || (byYear[y] = new Set())).add(m);
  });
  const counts = Object.values(byYear).map(s => s.size);
  if (!counts.length) return null;
  const freq = Math.max(...counts);
  if (freq <= 1) return { label: '년말', cls: 'text-purple-300 border-purple-400/50' };
  if (freq <= 6) return { label: '분기', cls: 'text-teal-300 border-teal-400/50' };
  const payDays = Object.values(exH || {})
    .map(ex => dividendPayDate(ex, hol))
    .filter(pd => /^\d{4}-\d{2}-\d{2}$/.test(String(pd)))
    .map(pd => Number(pd.slice(8, 10)))
    .sort((a, b) => a - b);
  if (!payDays.length) return { label: '월', cls: 'text-sky-300 border-sky-400/50' };
  const med = payDays[Math.floor(payDays.length / 2)];
  if (med <= 10) return { label: '월초', cls: 'text-sky-300 border-sky-400/50' };
  if (med <= 20) return { label: '월중', cls: 'text-amber-300 border-amber-400/50' };
  return { label: '월말', cls: 'text-rose-300 border-rose-400/50' };
}

// 한 종목의 배당락 이벤트들을 '올해 지급월' 슬롯으로 재배치한다.
// 저장 키는 배당락월(exYm) 그대로 유지하고 표시 위치만 지급월 기준으로 옮긴다.
// 반환: slots[payIdx 0-11] = [{ exYm, exMonthIdx, perShare, exDateRaw, payDateRaw, exPredicted }]
// - 배당락일 미확정 예측월: 직전연도 배당락일 + 2영업일로 추정 배치
// - 올해 12월 배당락 → 내년 1월 지급분은 올해 표에서 제외
// - 직전연도 12월 배당락 → 올해 1월 지급분은 1월 슬롯에 편입
function buildPaySlots(codeHistory, codeExHistory, hol) {
  const monthPred = buildMonthPrediction(codeHistory);
  const exPred = buildMonthExPrediction(codeExHistory);
  const CY = Number(CURRENT_YEAR);
  // 캘린더 응답이 직전연도를 누락하더라도 직전연도 12월 말 배당락의 지급일(T+2)이
  // KRX 연말 휴장(12/31)을 건너뛰어 올해 1월로 넘어가도록 방어적으로 보강한다.
  const holAug = [...(hol || []), `${CY - 1}-12-31`];
  const slots = Array.from({ length: 12 }, () => []);
  const consider = (exYear, mIdx, prevDecToJan = false) => {
    const m = mIdx + 1;
    const mo = String(m).padStart(2, '0');
    const perShare = monthPred[m] || 0;
    if (!(perShare > 0)) return;
    const exYm = `${exYear}-${mo}`;
    const actualEx = codeExHistory?.[exYm];
    // 직전연도 12월: 실배당락일이 확정되지 않으면 월배당 관례상 월말 배당락
    // (→ 올해 1월 지급)으로 추정해 1월 슬롯에 편입한다. 확정 배당락일이 있으면
    // 아래 일반 로직이 12월 지급분(연내)을 올해 표에서 정상 제외한다.
    if (prevDecToJan && !actualEx) {
      const exDateRaw = `${exYear}-12-31`;
      slots[0].push({ exYm, exMonthIdx: mIdx, perShare, exDateRaw, payDateRaw: dividendPayDate(exDateRaw, holAug), exPredicted: true });
      return;
    }
    let exDateRaw, exPredicted;
    if (actualEx) { exDateRaw = actualEx; exPredicted = false; }
    else if (exPred[m]) { exDateRaw = `${exYear}-${mo}-${exPred[m].slice(8, 10)}`; exPredicted = true; }
    else return;
    const payDateRaw = dividendPayDate(exDateRaw, holAug);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payDateRaw))) return;
    if (Number(payDateRaw.slice(0, 4)) !== CY) return;
    slots[Number(payDateRaw.slice(5, 7)) - 1].push({ exYm, exMonthIdx: mIdx, perShare, exDateRaw, payDateRaw, exPredicted });
  };
  for (let i = 0; i < 12; i++) consider(CY, i);
  consider(CY - 1, 11, true); // 직전연도 12월 → 올해 1월 지급 (배당락일 미확정 시 월말 추정)
  return slots;
}

// 슬롯 내 지배(금액 큰) 소스 — 표시용 분배락/지급일·주당분배금 기준
const pickDominant = (parts) => parts.reduce((a, b) => (b._w > a._w ? b : a), parts[0]);

// 월 셀 상단: 분배락/지급일 + 수량×주당분배금 (예측월은 ~ 표기)
function DivMeta({ d, isOverseas }) {
  if (!(d.amount > 0)) return null;
  const tilde = d.exPredicted ? '~' : '';
  const per = isOverseas ? formatUsd(d.perShare) : formatCurrency(d.perShare);
  return (
    <>
      {d.exMD && (
        <span className="text-gray-500 text-[9px] leading-tight">
          {tilde}{d.exMD}{d.payMD ? `-${d.payMD}` : ''}
        </span>
      )}
      <span className={`text-[9px] leading-tight ${d.qtyBackCalc ? 'text-amber-400/70' : 'text-gray-500'}`}>
        {d.qty.toLocaleString()}주 × {per}
      </span>
    </>
  );
}

function parseDividendApiResult(result) {
  const amounts = {};
  const exDates = {};
  result.forEach(({ dividendAmount, exDividendAt }) => {
    // Naver 배당락일 형식: "YYYY.MM.DD" — 형식이 어긋난 항목은 건너뜀
    const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(exDividendAt || '').trim());
    if (!m) return;
    const ds = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const key = `${m[1]}-${m[2].padStart(2, '0')}`;
    amounts[key] = (amounts[key] || 0) + dividendAmount;
    if (!exDates[key] || ds > exDates[key]) exDates[key] = ds;
  });
  return { amounts, exDates };
}

export default function DividendSummaryTable({ portfolios, updatePortfolioDividendHistory, updatePortfolioActualDividend, updatePortfolioActualDividendUsd, updatePortfolioActualDividendQty, updatePortfolioDividendTaxRate, updatePortfolioDividendSeparateTax, updatePortfolioDividendTaxAmount, updatePortfolioActualAfterTaxUsd, updatePortfolioActualAfterTaxKrw, addPortfolioExtraRow, updatePortfolioExtraRowCode, deletePortfolioExtraRow, updatePortfolioExtraRowMonth, updateTaxBaseEvents, updateTaxBasePurchases, updateTaxBaseSales, updateTaxBaseExPrice, updateTaxBaseAvgPrice, notify, compact = false, usdkrw = 1300, dividendTaxHistory = {}, onDividendTaxHistoryUpdate, holidays = { kr: [], us: [] } }) {
  const [activeTab, setActiveTab] = useState('expected');
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const inputRef = useRef(null);
  const krwInputRef = useRef(null);
  const afterTaxBlurTimer = useRef(null);

  const nonGoldPortfolios = useMemo(() =>
    (portfolios || []).filter(p => p.accountType !== 'gold'),
    [portfolios]
  );

  // Fix: 셀 identity(code+monthIdx+field)가 바뀔 때만 focus/select 실행
  const editingCellKey = editingCell
    ? `${editingCell.portfolioId}-${editingCell.code ?? editingCell.rowId}-${editingCell.monthIdx}-${editingCell.field}`
    : null;

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCellKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all(
      nonGoldPortfolios.map(async pf => {
        const stocks = (pf.portfolio || []).filter(item => getCodeType(item.code, pf) !== null);
        if (!stocks.length) return;
        const mergeMap = {};
        const exDateMap = {};
        await Promise.all(stocks.map(async item => {
          const codeType = getCodeType(item.code, pf);
          let parsed;
          if (codeType === 'us') {
            parsed = await fetchYahooDividendHistory(String(item.code));
          } else {
            const data = await fetchDividendHistory(String(item.code));
            if (data?.result?.length) parsed = parseDividendApiResult(data.result);
          }
          if (parsed?.amounts && Object.keys(parsed.amounts).length) {
            mergeMap[item.code] = parsed.amounts;
            if (parsed.exDates && Object.keys(parsed.exDates).length) exDateMap[item.code] = parsed.exDates;
          }
        }));
        if (Object.keys(mergeMap).length) updatePortfolioDividendHistory(pf.id, mergeMap, exDateMap);
      })
    );
    setLoading(false);
  }, [nonGoldPortfolios, updatePortfolioDividendHistory]);

  // 월 예상 분배금 rows
  const expectedRows = useMemo(() => {
    const result = [];
    nonGoldPortfolios.forEach(pf => {
      const divHistory = pf.dividendHistory || {};
      const isOverseas = pf.accountType === 'overseas';
      const fxRate = isOverseas ? usdkrw : 1;
      const exHistoryAll = pf.dividendExDate || {};
      const actualDiv = pf.actualDividend || {};
      const actualDivUsd = pf.actualDividendUsd || {};
      const hol = isOverseas ? (holidays?.us || []) : (holidays?.kr || []);
      (pf.portfolio || []).forEach(item => {
        if (!getCodeType(item.code, pf)) return;
        const baseQty = cleanNum(item.quantity);
        if (!baseQty) return;
        const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
        const exHistory = exHistoryAll[item.code] || {};
        const codeActual = isOverseas ? (actualDivUsd[item.code] || {}) : (actualDiv[item.code] || {});
        // 지급월 기준 재배치 (저장 키는 배당락월 유지)
        const slots = buildPaySlots(divHistory[item.code], exHistory, hol);
        const monthData = slots.map((srcs) => {
          if (!srcs.length) {
            return {
              amount: 0, amountUsd: 0, isActual: false, qty: baseQty, perShare: 0,
              qtyBackCalc: false, exMD: '', payMD: '', exPredicted: false, yearMonth: '',
            };
          }
          let amountUsd = 0;
          const parts = srcs.map(s => {
            // 실지급액이 입력된 달은 (실지급액 ÷ 주당분배금)로 수량 역산, 그 외 현재 보유수량
            const actualAmt = codeActual[s.exYm];
            const q = (actualAmt > 0 && s.perShare > 0) ? Math.round(actualAmt / s.perShare) : baseQty;
            const aUsd = s.perShare * q;
            amountUsd += aUsd;
            return { ...s, q, _w: aUsd, backCalc: actualAmt > 0 && s.perShare > 0 };
          });
          const dom = pickDominant(parts);
          const isActual = srcs.some(s => !s.exPredicted && !!divHistory[item.code]?.[s.exYm]);
          return {
            amount: amountUsd * fxRate, amountUsd: isOverseas ? amountUsd : 0, isActual,
            qty: dom.q, perShare: dom.perShare, qtyBackCalc: dom.backCalc,
            exMD: fmtMD(dom.exDateRaw), payMD: fmtMD(dom.payDateRaw), exPredicted: dom.exPredicted,
            yearMonth: dom.exYm,
          };
        });
        result.push({
          portfolioTitle: pf.title || pf.name || '계좌',
          portfolioId: pf.id,
          code: item.code,
          name: item.name,
          qty: baseQty,
          isOverseas,
          cadence: classifyCadence(divHistory[item.code], exHistory, hol),
          hasDivData: Object.keys(pred).length > 0,
          monthData,
          annual: monthData.reduce((s, d) => s + d.amount, 0),
          annualUsd: isOverseas ? monthData.reduce((s, d) => s + d.amountUsd, 0) : 0,
        });
      });
    });
    return result;
  }, [nonGoldPortfolios, holidays, usdkrw]);

  // 월 입금 내역 rows — 예상값 기반 + 사용자 직접 입력 override
  const actualRows = useMemo(() => {
    const result = [];
    nonGoldPortfolios.forEach(pf => {
      const divHistory = pf.dividendHistory || {};
      const actualDividend = pf.actualDividend || {};
      const actualDividendUsd = pf.actualDividendUsd || {};
      const actualDividendQty = pf.actualDividendQty || {};
      const isOverseas = pf.accountType === 'overseas';
      const taxRate = pf.dividendTaxRate ?? 15.4;
      const exHistoryAll = pf.dividendExDate || {};
      const hol = isOverseas ? (holidays?.us || []) : (holidays?.kr || []);
      (pf.portfolio || []).forEach(item => {
        if (!getCodeType(item.code, pf)) return;
        const qty = cleanNum(item.quantity);
        if (!qty) return;
        const pred = divHistory[item.code] ? buildMonthPrediction(divHistory[item.code]) : {};
        const codeQtyOv = actualDividendQty[item.code] || {};
        // 지급월 기준 재배치 (저장 키는 배당락월 유지)
        const slots = buildPaySlots(divHistory[item.code], exHistoryAll[item.code] || {}, hol);
        const fbExYms = buildFallbackExYms(slots);
        const monthData = slots.map((slotSrcs, payIdx) => {
          // 예상 분배금 슬롯이 없어도 사용자가 실수령액을 직접 기록할 수 있도록
          // 충돌 없는 폴백 배당락 키를 가진 합성 소스를 사용한다. 단 예측 분배금은
          // 표시하지 않으므로(빈 셀) perShare=0 — 사용자가 입력해야만 값이 표시된다.
          const srcs = slotSrcs.length ? slotSrcs : [{
            exYm: fbExYms[payIdx],
            exMonthIdx: Number(fbExYms[payIdx].slice(5, 7)) - 1,
            perShare: 0,
            exDateRaw: '', payDateRaw: '', exPredicted: false,
          }];
          if (isOverseas) {
            const codeActualUsd = actualDividendUsd[item.code] || {};
            const codeAfterTaxUsd = (pf.actualAfterTaxUsd || {})[item.code] || {};
            const codeAfterTaxKrw = (pf.actualAfterTaxKrw || {})[item.code] || {};
            let grossUsd = 0, grossKrw = 0, afterTaxUsd = 0, afterTaxKrw = 0, effectiveTaxKrw = 0, taxKrwManual = 0, calcQty = 0;
            let hasManualGross = false, hasManualAfterTax = false;
            const parts = srcs.map(s => {
              const ek = s.exYm;
              const tkm = (pf.dividendTaxAmounts || {})[item.code]?.[ek] || 0;
              const hmg = ek in codeActualUsd;
              const sAfterUsd = codeAfterTaxUsd[ek];
              const sAfterKrw = codeAfterTaxKrw[ek];
              const hmat = sAfterUsd != null || sAfterKrw != null;
              let gUsd, gKrw, etk;
              if (hmat) {
                const atKrw = sAfterKrw != null ? sAfterKrw : Math.round((sAfterUsd || 0) * usdkrw);
                etk = tkm > 0 ? tkm : (taxRate > 0 && taxRate < 100 ? Math.round(atKrw * taxRate / (100 - taxRate)) : 0);
                gKrw = atKrw + etk;
                gUsd = gKrw / (usdkrw || 1);
              } else if (hmg) {
                gUsd = codeActualUsd[ek];
                gKrw = Math.round(gUsd * usdkrw);
                etk = tkm > 0 ? tkm : (taxRate > 0 ? Math.round(gKrw * taxRate / 100) : 0);
              } else {
                gUsd = s.perShare * qty;
                gKrw = Math.round(gUsd * usdkrw);
                etk = 0;
              }
              const autoAfterUsd = gUsd * (1 - taxRate / 100);
              const atUsd = sAfterUsd != null ? sAfterUsd : autoAfterUsd;
              const atKrw = sAfterKrw != null ? sAfterKrw : Math.round(atUsd * usdkrw);
              const cq = (s.perShare > 0 && gUsd > 0) ? Math.round(gUsd / s.perShare) : 0;
              grossUsd += gUsd; grossKrw += gKrw; afterTaxUsd += atUsd; afterTaxKrw += atKrw;
              effectiveTaxKrw += etk; taxKrwManual += tkm; calcQty += cq;
              if (hmg) hasManualGross = true;
              if (hmat) hasManualAfterTax = true;
              return { ...s, _w: gKrw };
            });
            const dom = pickDominant(parts);
            const overrideQty = codeQtyOv[dom.exYm];
            return { grossUsd, grossKrw, afterTaxUsd, afterTaxKrw, hasManualGross, hasManualAfterTax, hasManual: hasManualGross || hasManualAfterTax, taxKrwManual, effectiveTaxKrw, yearMonth: dom.exYm, perShare: dom.perShare, calcQty, qtyVal: overrideQty > 0 ? overrideQty : calcQty, qtyIsManual: overrideQty > 0 };
          } else {
            const codeActual = actualDividend[item.code] || {};
            let amount = 0, predicted = 0, calcQty = 0, taxSum = 0, hasManual = false, taxAny = false;
            const parts = srcs.map(s => {
              const ek = s.exYm;
              const cm = ek in codeActual;
              const predS = s.perShare * qty;
              const amtS = cm ? codeActual[ek] : predS;
              const taxS = (pf.dividendTaxAmounts || {})[item.code]?.[ek];
              const gS = amtS + (taxS || 0);
              const cqS = (s.perShare > 0 && gS > 0) ? Math.round(gS / s.perShare) : 0;
              amount += amtS; predicted += predS; calcQty += cqS;
              if (cm) hasManual = true;
              if (taxS != null) { taxSum += taxS; taxAny = true; }
              return { ...s, _w: amtS };
            });
            const dom = pickDominant(parts);
            const overrideQty = codeQtyOv[dom.exYm];
            return { amount, amountUsd: 0, predicted, hasManual, yearMonth: dom.exYm, taxAmount: taxAny ? taxSum : null, perShare: dom.perShare, calcQty, qtyVal: overrideQty > 0 ? overrideQty : calcQty, qtyIsManual: overrideQty > 0 };
          }
        });
        result.push({
          portfolioTitle: pf.title || pf.name || '계좌',
          portfolioId: pf.id,
          code: item.code,
          name: item.name,
          qty,
          isOverseas,
          cadence: classifyCadence(divHistory[item.code], exHistoryAll[item.code] || {}, hol),
          hasDivData: Object.keys(pred).length > 0,
          monthData,
          annual: isOverseas
            ? monthData.reduce((s, d) => s + (d.hasManual ? d.grossKrw : 0), 0)
            : monthData.reduce((s, d) => s + (d.hasManual ? d.amount : 0), 0),
          annualUsd: isOverseas ? monthData.reduce((s, d) => s + (d.hasManual ? d.grossUsd : 0), 0) : 0,
          annualAfterKrw: isOverseas ? monthData.reduce((s, d) => s + (d.hasManual ? d.afterTaxKrw : 0), 0) : 0,
          annualAfterUsd: isOverseas ? monthData.reduce((s, d) => s + (d.hasManual ? d.afterTaxUsd : 0), 0) : 0,
        });
      });
    });
    return result;
  }, [nonGoldPortfolios, holidays, usdkrw]);

  // 수동 추가 행 (포트폴리오에서 제거된 종목의 과거 배당금 기록용)
  const extraActualRows = useMemo(() => {
    const result = [];
    nonGoldPortfolios.forEach(pf => {
      const isOverseas = pf.accountType === 'overseas';
      (pf.extraDividendRows || []).forEach(row => {
        const monthData = Array.from({ length: 12 }, (_, i) => {
          const mo = String(i + 1).padStart(2, '0');
          const yearMonth = `${CURRENT_YEAR}-${mo}`;
          const entry = row.monthData?.[yearMonth] || {};
          return { yearMonth, afterTaxUsd: entry.afterTaxUsd || 0, afterTaxKrw: entry.afterTaxKrw || 0, taxKrw: entry.taxKrw || 0 };
        });
        result.push({
          portfolioId: pf.id,
          rowId: row.id,
          code: row.code || '',
          name: row.name || '',
          isOverseas,
          isExtra: true,
          monthData,
          annualAfterKrw: monthData.reduce((s, d) => s + d.afterTaxKrw, 0),
          annualTaxKrw: monthData.reduce((s, d) => s + d.taxKrw, 0),
          annualAfterUsd: isOverseas ? monthData.reduce((s, d) => s + d.afterTaxUsd, 0) : 0,
        });
      });
    });
    return result;
  }, [nonGoldPortfolios]);

  // compact 모드 — 계좌별 월 합계
  const compactExpectedRows = useMemo(() => {
    if (!compact) return [];
    return nonGoldPortfolios.map(pf => {
      const divHistory = pf.dividendHistory || {};
      const isOverseas = pf.accountType === 'overseas';
      const fxRate = isOverseas ? usdkrw : 1;
      const taxRate = pf.dividendTaxRate ?? 15.4;
      const hol = isOverseas ? (holidays?.us || []) : (holidays?.kr || []);
      const monthData = Array.from({ length: 12 }, () => ({ amount: 0, amountUsd: 0, taxKrw: 0, hasActual: false }));
      (pf.portfolio || []).forEach(item => {
        if (!getCodeType(item.code, pf)) return;
        const qty = cleanNum(item.quantity);
        if (!qty) return;
        const exH = (pf.dividendExDate || {})[item.code] || {};
        const slots = buildPaySlots(divHistory[item.code], exH, hol);
        slots.forEach((srcs, pi) => {
          srcs.forEach(s => {
            const perShareUsd = s.perShare || 0;
            if (isOverseas) monthData[pi].amountUsd += perShareUsd * qty;
            const grossKrw = perShareUsd * qty * fxRate;
            monthData[pi].amount += grossKrw;
            const taxRec = !isOverseas && dividendTaxHistory?.[item.code]?.records?.[s.exYm];
            monthData[pi].taxKrw += taxRec && qty > 0
              ? Math.round(taxRec.perShareTaxableBase * qty * taxRate / 100)
              : Math.round(grossKrw * taxRate / 100);
            if (!s.exPredicted && !!divHistory[item.code]?.[s.exYm]) monthData[pi].hasActual = true;
          });
        });
      });
      monthData.forEach(d => { if (!isOverseas) d.amountUsd = 0; });
      const annual = monthData.reduce((s, d) => s + d.amount, 0);
      const annualUsd = isOverseas ? monthData.reduce((s, d) => s + d.amountUsd, 0) : 0;
      const annualTax = monthData.reduce((s, d) => s + d.taxKrw, 0);
      return { portfolioId: pf.id, portfolioTitle: pf.title || pf.name || '계좌', rowColor: pf.rowColor || '', isOverseas, monthData, annual, annualUsd, annualTax };
    }).filter(row => row.annual > 0);
  }, [compact, nonGoldPortfolios, dividendTaxHistory, holidays, usdkrw]);

  const compactActualRows = useMemo(() => {
    if (!compact) return [];
    return nonGoldPortfolios.map(pf => {
      const divHistory = pf.dividendHistory || {};
      const actualDividend = pf.actualDividend || {};
      const actualDividendUsd = pf.actualDividendUsd || {};
      const isOverseas = pf.accountType === 'overseas';
      const taxRate = pf.dividendTaxRate ?? 15.4;
      const hol = isOverseas ? (holidays?.us || []) : (holidays?.kr || []);
      // 종목별 지급월 슬롯 1회 산출 (저장 키는 배당락월 유지)
      const stockSlots = (pf.portfolio || []).map(item => {
        if (!getCodeType(item.code, pf)) return null;
        const qty = cleanNum(item.quantity);
        if (!qty) return null;
        const exH = (pf.dividendExDate || {})[item.code] || {};
        const slots = buildPaySlots(divHistory[item.code], exH, hol);
        return { code: item.code, slots, fbExYms: buildFallbackExYms(slots) };
      }).filter(Boolean);
      const monthData = Array.from({ length: 12 }, (_, i) => {
        const mo = String(i + 1).padStart(2, '0');
        const yearMonth = `${CURRENT_YEAR}-${mo}`;
        if (isOverseas) {
          let pfAfterUsd = 0, pfAfterKrw = 0, pfHasActual = false;
          stockSlots.forEach(({ code, slots, fbExYms }) => {
            const codeActualUsd = actualDividendUsd[code] || {};
            const codeAfterTaxUsd = (pf.actualAfterTaxUsd || {})[code] || {};
            const codeAfterTaxKrw = (pf.actualAfterTaxKrw || {})[code] || {};
            (slots[i].length ? slots[i] : [{ exYm: fbExYms[i] }]).forEach(s => {
              const ek = s.exYm;
              const hasManualGross = ek in codeActualUsd;
              const storedAfterUsd = codeAfterTaxUsd[ek];
              const storedAfterKrw = codeAfterTaxKrw[ek];
              const hasManualAfterTax = storedAfterUsd != null || storedAfterKrw != null;
              if (!hasManualGross && !hasManualAfterTax) return;
              pfHasActual = true;
              let afterUsd, afterKrw;
              if (hasManualAfterTax) {
                afterUsd = storedAfterUsd != null ? storedAfterUsd : (storedAfterKrw != null && usdkrw > 0 ? storedAfterKrw / usdkrw : 0);
                afterKrw = storedAfterKrw != null ? storedAfterKrw : Math.round(afterUsd * usdkrw);
              } else {
                const grossUsd = codeActualUsd[ek];
                afterUsd = grossUsd * (1 - taxRate / 100);
                afterKrw = Math.round(afterUsd * usdkrw);
              }
              pfAfterUsd += afterUsd;
              pfAfterKrw += afterKrw;
            });
          });
          let extraAfterUsd = 0, extraAfterKrw = 0, extraHasActual = false;
          (pf.extraDividendRows || []).forEach(row => {
            const entry = row.monthData?.[yearMonth] || {};
            const atKrw = entry.afterTaxKrw || 0;
            extraAfterUsd += entry.afterTaxUsd || 0;
            extraAfterKrw += atKrw;
            if ((entry.afterTaxUsd || 0) > 0 || atKrw > 0) extraHasActual = true;
          });
          const totalAfterKrw = pfAfterKrw + extraAfterKrw;
          const hasActual = pfHasActual || extraHasActual;
          const taxKrw = (hasActual && taxRate > 0 && taxRate < 100)
            ? Math.round(totalAfterKrw * taxRate / (100 - taxRate))
            : 0;
          return { amount: totalAfterKrw, amountUsd: pfAfterUsd + extraAfterUsd, taxKrw, yearMonth, hasActual };
        } else {
          let amount = 0, taxKrw = 0, hasManual = false;
          stockSlots.forEach(({ code, slots, fbExYms }) => {
            const codeActual = actualDividend[code] || {};
            (slots[i].length ? slots[i] : [{ exYm: fbExYms[i] }]).forEach(s => {
              const ek = s.exYm;
              if (!(ek in codeActual)) return;
              amount += codeActual[ek];
              taxKrw += (pf.dividendTaxAmounts || {})[code]?.[ek] || 0;
              hasManual = true;
            });
          });
          amount += (pf.extraDividendRows || []).reduce((s, row) => {
            const entry = row.monthData?.[yearMonth] || {};
            return s + (entry.afterTaxKrw || 0);
          }, 0);
          if ((pf.extraDividendRows || []).some(row => ((row.monthData?.[yearMonth] || {}).afterTaxKrw || 0) > 0)) hasManual = true;
          taxKrw += (pf.extraDividendRows || []).reduce((s, row) => {
            const entry = row.monthData?.[yearMonth] || {};
            return s + (entry.taxKrw || 0);
          }, 0);
          return { amount, amountUsd: 0, taxKrw, yearMonth, hasManual };
        }
      });
      const annual = isOverseas
        ? monthData.reduce((s, d) => s + (d.hasActual ? d.amount : 0), 0)
        : monthData.reduce((s, d) => s + (d.hasManual ? d.amount : 0), 0);
      const annualUsd = isOverseas ? monthData.reduce((s, d) => s + (d.hasActual ? d.amountUsd : 0), 0) : 0;
      const annualTax = isOverseas
        ? monthData.reduce((s, d) => s + (d.hasActual ? (d.taxKrw || 0) : 0), 0)
        : monthData.reduce((s, d) => s + (d.hasManual ? (d.taxKrw || 0) : 0), 0);
      return { portfolioId: pf.id, portfolioTitle: pf.title || pf.name || '계좌', rowColor: pf.rowColor || '', isOverseas, monthData, annual, annualUsd, annualTax };
    }).filter(row => row.annual > 0);
  }, [compact, nonGoldPortfolios, holidays, usdkrw]);

  const commitEdit = () => {
    if (!editingCell) return;
    const { portfolioId, code, yearMonth, field, isOverseas, isExtra, rowId } = editingCell;
    if (field === 'qty') {
      const raw = String(editingCell.value || '').trim();
      const num = raw === '' ? null : (parseFloat(raw.replace(/,/g, '')) || 0);
      updatePortfolioActualDividendQty(portfolioId, code, yearMonth, num);
      setEditingCell(null);
      return;
    }
    if (isExtra) {
      if (isOverseas) {
        const usdNum = parseFloat(String(editingCell.usdValue || '').replace(/,/g, '')) || 0;
        const krwNum = parseFloat(String(editingCell.krwValue || '').replace(/,/g, '')) || 0;
        updatePortfolioExtraRowMonth(portfolioId, rowId, yearMonth, usdNum, krwNum, 0);
      } else {
        const krwNum = parseFloat(String(editingCell.value || '').replace(/,/g, '')) || 0;
        const taxNum = parseFloat(String(editingCell.taxValue || '').replace(/,/g, '')) || 0;
        updatePortfolioExtraRowMonth(portfolioId, rowId, yearMonth, 0, krwNum, taxNum);
      }
      setEditingCell(null);
      return;
    }
    if (field === 'afterTax' && isOverseas) {
      const usdRaw = String(editingCell.usdValue || '').trim();
      const krwRaw = String(editingCell.krwValue || '').trim();
      const taxRaw = String(editingCell.taxKrwValue || '').trim();
      const usdNum = usdRaw === '' ? null : (parseFloat(usdRaw.replace(/,/g, '')) || 0);
      const krwNum = krwRaw === '' ? null : (parseFloat(krwRaw.replace(/,/g, '')) || 0);
      const taxNum = taxRaw === '' ? 0 : (parseFloat(taxRaw.replace(/,/g, '')) || 0);
      updatePortfolioActualAfterTaxUsd(portfolioId, code, yearMonth, usdNum);
      updatePortfolioActualAfterTaxKrw(portfolioId, code, yearMonth, krwNum);
      updatePortfolioDividendTaxAmount(portfolioId, code, yearMonth, taxNum);
    } else if (!isOverseas) {
      const raw = String(editingCell.value).trim();
      const num = raw === '' ? null : (parseFloat(raw.replace(/,/g, '')) || 0);
      const taxRaw = String(editingCell.taxValue || '').trim();
      const taxNum = taxRaw === '' ? 0 : (parseFloat(taxRaw.replace(/,/g, '')) || 0);
      updatePortfolioActualDividend(portfolioId, code, yearMonth, num);
      updatePortfolioDividendTaxAmount(portfolioId, code, yearMonth, taxNum);
    }
    setEditingCell(null);
  };


  const handleAfterTaxCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, code: row.code, monthIdx,
      yearMonth: d.yearMonth, isOverseas: true, field: 'afterTax',
      usdValue: d.hasManualAfterTax ? String(Number(d.afterTaxUsd.toFixed(4))) : '',
      krwValue: d.hasManualAfterTax ? String(d.afterTaxKrw) : '',
      taxKrwValue: d.taxKrwManual > 0 ? String(d.taxKrwManual) : '',
    });
  };

  const handleKrwCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, code: row.code, monthIdx,
      yearMonth: d.yearMonth, isOverseas: false, field: 'krw',
      value: d.hasManual ? String(d.amount) : '',
      taxValue: d.taxAmount != null ? String(d.taxAmount) : '',
    });
  };

  const handleQtyDblClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, code: row.code, monthIdx,
      yearMonth: d.yearMonth, isOverseas: row.isOverseas, field: 'qty',
      value: d.qtyIsManual ? String(d.qtyVal) : (d.calcQty > 0 ? String(d.calcQty) : ''),
    });
  };

  const handleExtraOverseasCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, rowId: row.rowId, monthIdx,
      yearMonth: d.yearMonth, isOverseas: true, field: 'afterTax', isExtra: true,
      usdValue: d.afterTaxUsd > 0 ? String(Number(d.afterTaxUsd.toFixed(4))) : '',
      krwValue: d.afterTaxKrw > 0 ? String(d.afterTaxKrw) : '',
    });
  };

  const handleExtraKrwCellClick = (row, monthIdx) => {
    const d = row.monthData[monthIdx];
    setEditingCell({
      portfolioId: row.portfolioId, rowId: row.rowId, monthIdx,
      yearMonth: d.yearMonth, isOverseas: false, field: 'krw', isExtra: true,
      value: d.afterTaxKrw > 0 ? String(d.afterTaxKrw) : '',
      taxValue: d.taxKrw > 0 ? String(d.taxKrw) : '',
    });
  };

  const handleExtraRowCodeBlur = useCallback(async (portfolioId, rowId, code, isOverseas) => {
    if (!code || code.trim().length < 2) return;
    const info = isOverseas
      ? await fetchUsStockInfo(code.trim())
      : await fetchStockInfo(code.trim());
    if (info?.name) {
      updatePortfolioExtraRowCode(portfolioId, rowId, code.trim(), info.name);
    }
  }, [updatePortfolioExtraRowCode]);

  const handleCellKeyDown = (e) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingCell(null);
  };

  const handleAfterTaxBlur = () => {
    afterTaxBlurTimer.current = setTimeout(commitEdit, 150);
  };

  const handleAfterTaxFocus = () => {
    if (afterTaxBlurTimer.current) clearTimeout(afterTaxBlurTimer.current);
  };

  const handleTaxChange = (portfolioId, code, yearMonth, value) => {
    const num = parseFloat(String(value).replace(/,/g, '')) || 0;
    updatePortfolioDividendTaxAmount(portfolioId, code, yearMonth, num);
  };

  const getTaxRate = (portfolioId) => {
    const pf = nonGoldPortfolios.find(p => p.id === portfolioId);
    return pf?.dividendTaxRate ?? 15.4;
  };

  // 비해외 계좌 전용 세금 계산
  // hasManual=true → 입력값이 세후이므로 역산: 세후 × 세율/(100-세율)
  // hasManual=false → 입력값이 세전 예측값이므로 직접: 세전 × 세율/100
  // qty > 0 이고 dividendTaxHistory[code][yearMonth] 있으면 주당과세표준 × qty × 세율 우선 적용
  const getEffectiveTax = (amount, portfolioId, code, yearMonth, hasManual = false, qty = 0) => {
    const pf = nonGoldPortfolios.find(p => p.id === portfolioId);
    const manualKrw = pf?.dividendTaxAmounts?.[code]?.[yearMonth] || 0;
    if (manualKrw > 0) return manualKrw;
    const rate = getTaxRate(portfolioId);
    if (rate <= 0 || amount <= 0) return 0;
    // 주당 과세 표준액이 있으면 우선 적용 (수동 세금 없을 때만)
    const taxRec = dividendTaxHistory?.[code]?.records?.[yearMonth];
    if (taxRec && qty > 0) {
      return Math.round(taxRec.perShareTaxableBase * qty * rate / 100);
    }
    return hasManual
      ? Math.round(amount * rate / (100 - rate))
      : Math.round(amount * rate / 100);
  };

  // 비해외 계좌 전용 월 세금 합계 (compact 모드)
  const getPortfolioMonthTax = (pf, monthIdx) => {
    const mo = String(monthIdx + 1).padStart(2, '0');
    const yearMonth = `${CURRENT_YEAR}-${mo}`;
    const actualDividend = pf.actualDividend || {};
    return (pf.portfolio || []).reduce((sum, item) => {
      if (!getCodeType(item.code, pf)) return sum;
      const qty = cleanNum(item.quantity);
      if (!qty) return sum;
      const codeActual = actualDividend[item.code] || {};
      if (!(yearMonth in codeActual)) return sum;
      return sum + getEffectiveTax(codeActual[yearMonth], pf.id, item.code, yearMonth, true, qty);
    }, 0);
  };

  const isSeparateTax = (portfolioId) => {
    const pf = nonGoldPortfolios.find(p => p.id === portfolioId);
    return !!pf?.dividendSeparateTax;
  };

  if (!nonGoldPortfolios.length) return null;

  // ── 월 예상 분배금 탭 totals ──
  const monthlyTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.reduce((sum, row) => sum + row.monthData[i].amount, 0)
  );
  const annualTotal = monthlyTotals.reduce((s, v) => s + v, 0);
  const monthlyTaxTotals = Array.from({ length: 12 }, (_, i) => {
    return expectedRows.reduce((sum, row) => {
      const rate = getTaxRate(row.portfolioId);
      const taxRec = dividendTaxHistory?.[row.code]?.records?.[row.monthData[i].yearMonth];
      const mQty = row.monthData[i].qty;
      if (taxRec && mQty > 0) {
        return sum + Math.round(taxRec.perShareTaxableBase * mQty * rate / 100);
      }
      return sum + Math.round(row.monthData[i].amount * rate / 100);
    }, 0);
  });
  const annualTaxTotal = monthlyTaxTotals.reduce((s, v) => s + v, 0);
  const monthlyUsdTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.filter(r => r.isOverseas).reduce((sum, row) => sum + row.monthData[i].amountUsd, 0)
  );
  const annualUsdTotal = monthlyUsdTotals.reduce((s, v) => s + v, 0);
  const monthlyUsdTaxTotals = Array.from({ length: 12 }, (_, i) =>
    expectedRows.filter(r => r.isOverseas).reduce((sum, row) => {
      const rate = getTaxRate(row.portfolioId);
      return sum + row.monthData[i].amountUsd * rate / 100;
    }, 0)
  );
  const annualUsdTaxTotal = monthlyUsdTaxTotals.reduce((s, v) => s + v, 0);

  // ── 월 입금 내역 탭 totals (수동 추가 행 포함) ──
  const actualHasOverseas = actualRows.some(r => r.isOverseas) || extraActualRows.some(r => r.isOverseas);

  const actualMonthlyGrossKrw = Array.from({ length: 12 }, (_, i) =>
    actualRows.reduce((s, r) => {
      if (r.isOverseas) return s + (r.monthData[i].hasManual ? r.monthData[i].grossKrw : 0);
      const d = r.monthData[i];
      return s + (d.hasManual ? d.amount + (d.taxAmount || 0) : 0);
    }, 0) +
    extraActualRows.reduce((s, r) => s + r.monthData[i].afterTaxKrw + (r.monthData[i].taxKrw || 0), 0)
  );
  const actualMonthlyGrossUsd = Array.from({ length: 12 }, (_, i) =>
    actualRows.filter(r => r.isOverseas).reduce((s, r) => s + (r.monthData[i].hasManual ? r.monthData[i].grossUsd : 0), 0) +
    extraActualRows.filter(r => r.isOverseas).reduce((s, r) => s + r.monthData[i].afterTaxUsd, 0)
  );
  const actualMonthlyAfterKrw = Array.from({ length: 12 }, (_, i) =>
    actualRows.reduce((s, r) => {
      if (r.isOverseas) return s + (r.monthData[i].hasManual ? r.monthData[i].afterTaxKrw : 0);
      const d = r.monthData[i];
      return s + (d.hasManual ? d.amount : 0);
    }, 0) +
    extraActualRows.reduce((s, r) => s + r.monthData[i].afterTaxKrw, 0)
  );
  const actualMonthlyAfterUsd = Array.from({ length: 12 }, (_, i) =>
    actualRows.filter(r => r.isOverseas).reduce((s, r) => s + (r.monthData[i].hasManual ? r.monthData[i].afterTaxUsd : 0), 0) +
    extraActualRows.filter(r => r.isOverseas).reduce((s, r) => s + r.monthData[i].afterTaxUsd, 0)
  );
  const actualAnnualGrossKrw = actualMonthlyGrossKrw.reduce((s, v) => s + v, 0);
  const actualAnnualGrossUsd = actualMonthlyGrossUsd.reduce((s, v) => s + v, 0);
  const actualAnnualAfterKrw = actualMonthlyAfterKrw.reduce((s, v) => s + v, 0);
  const actualAnnualAfterUsd = actualMonthlyAfterUsd.reduce((s, v) => s + v, 0);
  const actualMonthlyTaxTotals = Array.from({ length: 12 }, (_, i) =>
    actualRows.filter(r => !r.isOverseas).reduce((s, r) => {
      const d = r.monthData[i];
      if (!d.hasManual) return s;
      return s + (d.taxAmount || 0);
    }, 0) +
    extraActualRows.filter(r => !r.isOverseas).reduce((s, r) => s + (r.monthData[i].taxKrw || 0), 0)
  );
  const actualAnnualTaxTotal = actualMonthlyTaxTotals.reduce((s, v) => s + v, 0);

  const actualMonthlyOverseasTaxKrw = Array.from({ length: 12 }, (_, i) =>
    actualRows.filter(r => r.isOverseas).reduce((s, r) => {
      const d = r.monthData[i];
      return s + (d.hasManual ? (d.effectiveTaxKrw || 0) : 0);
    }, 0)
  );
  const actualAnnualOverseasTaxKrw = actualMonthlyOverseasTaxKrw.reduce((s, v) => s + v, 0);

  // ── compact 모드 totals ──
  const compactAnnualTotal = (activeTab === 'expected' ? compactExpectedRows : compactActualRows)
    .filter(r => !isSeparateTax(r.portfolioId))
    .reduce((s, r) => s + r.annual, 0);
  const compactAnnualTax = compactExpectedRows
    .filter(r => !isSeparateTax(r.portfolioId))
    .reduce((sum, row) => sum + (row.annualTax || 0), 0);
  const compactMonthlyTotals = Array.from({ length: 12 }, (_, i) =>
    (activeTab === 'expected' ? compactExpectedRows : compactActualRows)
      .filter(r => !isSeparateTax(r.portfolioId))
      .reduce((sum, row) => sum + row.monthData[i].amount, 0)
  );

  if (compact) {
    const rows = activeTab === 'expected' ? compactExpectedRows : compactActualRows;
    const totalAnnual = compactAnnualTotal;
    const compactExpectedHasOverseas = compactExpectedRows.filter(r => !isSeparateTax(r.portfolioId)).some(r => r.isOverseas);
    const compactExpectedMonthlyUsd = Array.from({ length: 12 }, (_, i) =>
      compactExpectedRows.filter(r => r.isOverseas && !isSeparateTax(r.portfolioId)).reduce((s, r) => s + (r.monthData[i].amountUsd || 0), 0)
    );
    const compactExpectedAnnualUsd = compactExpectedRows.filter(r => !isSeparateTax(r.portfolioId)).reduce((s, r) => s + (r.annualUsd || 0), 0);
    const compactExpectedMonthlyDomesticKrw = Array.from({ length: 12 }, (_, i) =>
      compactExpectedRows.filter(r => !r.isOverseas && !isSeparateTax(r.portfolioId)).reduce((s, r) => s + r.monthData[i].amount, 0)
    );
    const compactExpectedDomesticAnnual = compactExpectedRows.filter(r => !r.isOverseas && !isSeparateTax(r.portfolioId)).reduce((s, r) => s + r.annual, 0);
    const compactActualHasOverseas = compactActualRows.filter(r => !isSeparateTax(r.portfolioId)).some(r => r.isOverseas);
    const compactActualAnnualUsd = compactActualRows.filter(r => !isSeparateTax(r.portfolioId)).reduce((s, r) => s + (r.annualUsd || 0), 0);
    const compactActualMonthlyUsd = Array.from({ length: 12 }, (_, i) =>
      compactActualRows.filter(r => r.isOverseas && !isSeparateTax(r.portfolioId)).reduce((s, r) => s + (r.monthData[i].amountUsd || 0), 0)
    );
    const compactActualMonthlyTaxCombined = Array.from({ length: 12 }, (_, i) =>
      compactActualRows.filter(r => !isSeparateTax(r.portfolioId)).reduce((s, r) => s + (r.monthData[i].taxKrw || 0), 0)
    );
    const compactActualAnnualTaxCombined = compactActualMonthlyTaxCombined.reduce((s, v) => s + v, 0);
    const compactActualMonthlyDomesticKrw = Array.from({ length: 12 }, (_, i) =>
      compactActualRows.filter(r => !r.isOverseas && !isSeparateTax(r.portfolioId)).reduce((s, r) => s + r.monthData[i].amount, 0)
    );
    const compactActualDomesticAnnual = compactActualRows.filter(r => !r.isOverseas && !isSeparateTax(r.portfolioId)).reduce((s, r) => s + r.annual, 0);
    return (
      <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden w-full">
        <div className="p-4 bg-[#0f172a] border-b border-gray-700 flex items-center gap-2 flex-wrap">
          <span className="text-white font-bold text-sm">💰 분배금 현황</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-700 ml-2">
            <button
              onClick={() => setActiveTab('expected')}
              className={`px-3 py-1 text-xs font-bold transition-colors ${activeTab === 'expected' ? 'bg-blue-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
            >월 예상 분배금</button>
            <button
              onClick={() => setActiveTab('actual')}
              className={`px-3 py-1 text-xs font-bold transition-colors border-l border-gray-700 ${activeTab === 'actual' ? 'bg-emerald-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
            >월 입금 내역</button>
          </div>
          {totalAnnual > 0 && (
            <div className="text-[10px] leading-[1.65]">
              {activeTab === 'expected' ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 w-14 shrink-0">연간 예상</span>
                    <span className="text-yellow-400 font-bold tabular-nums">{formatCurrency(totalAnnual)}</span>
                    {compactExpectedHasOverseas && compactExpectedAnnualUsd > 0 && <span className="text-gray-700">|</span>}
                    {compactExpectedHasOverseas && compactExpectedAnnualUsd > 0 && <span className="text-yellow-400/60 text-[9px] tabular-nums">{formatUsd(compactExpectedAnnualUsd)}</span>}
                  </div>
                  {compactAnnualTax > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 w-14 shrink-0">세후(예상)</span>
                      <span className="text-emerald-400 font-bold tabular-nums">{formatCurrency(totalAnnual - compactAnnualTax)}</span>
                    </div>
                  )}
                  {compactAnnualTax > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 w-14 shrink-0">과세</span>
                      <span className="text-orange-300/70 font-semibold tabular-nums">{formatCurrency(compactAnnualTax)}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 w-14 shrink-0">세후합계</span>
                    <span className="text-emerald-400 font-bold tabular-nums">{formatCurrency(totalAnnual)}</span>
                    {compactActualHasOverseas && compactActualAnnualUsd > 0 && <span className="text-gray-700">|</span>}
                    {compactActualHasOverseas && compactActualAnnualUsd > 0 && <span className="text-emerald-400/60 text-[9px] tabular-nums">{formatUsd(compactActualAnnualUsd)}</span>}
                  </div>
                  {compactActualAnnualTaxCombined > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 w-14 shrink-0">과세합계</span>
                      <span className="text-orange-300/70 font-semibold tabular-nums">{formatCurrency(compactActualAnnualTaxCombined)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <button
            onClick={handleRefreshAll}
            disabled={loading}
            title={loading ? '조회 중...' : '분배금 최신값 조회·저장됩니다'}
            className="ml-auto w-7 h-7 flex items-center justify-center rounded border border-gray-600/70 text-gray-400 hover:bg-gray-700/50 hover:text-gray-200 hover:border-gray-500 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        </div>
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-xs">
              {loading ? '분배금 데이터 조회 중...' : '분배금 데이터가 없습니다.'}
            </div>
          ) : (
            <table className="w-full text-[11px] text-center">
              <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                <tr>
                  <th className="py-3 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">계좌</th>
                  {MONTHS.map(m => (
                    <th key={m} className="py-2.5 px-1 min-w-[68px] text-center">{m}</th>
                  ))}
                  <th className={`py-2 px-2 min-w-[88px] font-bold text-center ${activeTab === 'expected' ? 'text-yellow-500' : 'text-emerald-500'}`}>연간합계</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const rowTaxRate = getTaxRate(row.portfolioId);
                  return (
                    <tr key={row.portfolioId} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                      <td className="py-2 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold">
                        <div className="flex items-center justify-between gap-1">
                          <div className="line-clamp-1" style={{ color: row.rowColor || '#93c5fd' }}>{row.portfolioTitle}</div>
                          {rowTaxRate > 0 && (
                            <button
                              onClick={() => updatePortfolioDividendSeparateTax(row.portfolioId, !isSeparateTax(row.portfolioId))}
                              title={isSeparateTax(row.portfolioId) ? '분리과세 ON (과세합계 제외)' : '분리과세 OFF (과세합계 포함)'}
                              className={`text-[10px] font-bold tracking-wide transition-colors shrink-0 ${isSeparateTax(row.portfolioId) ? 'text-sky-300' : 'text-gray-600 hover:text-gray-400'}`}
                            >TAX</button>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-gray-600 text-[9px]">과세율</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={rowTaxRate}
                            onChange={e => { const v = parseFloat(e.target.value); updatePortfolioDividendTaxRate(row.portfolioId, isNaN(v) ? 0 : v); }}
                            onClick={e => e.stopPropagation()}
                            className="w-8 bg-transparent text-orange-300/70 text-[9px] text-center border-b border-gray-700/40 outline-none"
                          />
                          <span className="text-gray-600 text-[9px]">%</span>
                        </div>
                      </td>
                      {row.monthData.map((d, i) => {
                        if (activeTab === 'actual' && row.isOverseas) {
                          return (
                            <td key={i} className={`py-1.5 px-1 text-center text-[10px] ${d.amountUsd > 0 ? 'text-emerald-400 bg-emerald-900/20' : 'text-gray-700'}`}>
                              <div className="flex flex-col items-center justify-center gap-0">
                                <span className="font-semibold">{d.amountUsd > 0 ? formatUsd(d.amountUsd) : '-'}</span>
                                {d.amount > 0 && <span className="text-emerald-400/40 text-[9px]">{formatCurrency(d.amount)}</span>}
                                {d.taxKrw > 0 && <span className="text-orange-300/55 text-[9px]">{formatCurrency(d.taxKrw)}</span>}
                              </div>
                            </td>
                          );
                        }
                        if (activeTab === 'expected' && row.isOverseas) {
                          const taxKrw = rowTaxRate > 0 && d.amount > 0 ? Math.round(d.amount * rowTaxRate / 100) : 0;
                          return (
                            <td key={i} className={`py-1.5 px-1 text-center text-[10px] ${
                              d.amountUsd > 0
                                ? d.hasActual ? 'text-emerald-300 font-bold bg-emerald-900/25' : 'text-blue-300/80'
                                : 'text-gray-700'
                            }`}>
                              <div className="flex flex-col items-center justify-center gap-0">
                                <span className="font-semibold">{d.amountUsd > 0 ? formatUsd(d.amountUsd) : '-'}</span>
                                {d.amount > 0 && <span className="text-blue-300/40 text-[9px]">{formatCurrency(d.amount)}</span>}
                                {taxKrw > 0 && <span className="text-orange-300/55 text-[9px]">{formatCurrency(taxKrw)}</span>}
                              </div>
                            </td>
                          );
                        }
                        const isActualTab = activeTab === 'actual';
                        const taxAmt = d.taxKrw || 0;
                        if (isActualTab && !d.hasManual) {
                          return <td key={i} className="py-1.5 px-1 text-center text-[10px] text-gray-700">-</td>;
                        }
                        const line1 = isActualTab ? d.amount + taxAmt : d.amount;
                        const line3 = isActualTab ? d.amount : Math.max(0, d.amount - taxAmt);
                        return (
                          <td key={i} className={`py-1.5 px-1 text-center text-[10px] ${
                            d.amount > 0
                              ? isActualTab
                                ? 'text-emerald-300 bg-emerald-900/20'
                                : d.hasActual ? 'text-emerald-300 font-bold bg-emerald-900/25' : 'text-blue-300/70'
                              : 'text-gray-700'
                          }`}>
                            <div className="flex flex-col items-center justify-center gap-0">
                              <span>{d.amount > 0 ? formatCurrency(line1) : '-'}</span>
                              {taxAmt > 0 && (
                                <span className="text-orange-300/55 text-[9px]">{formatCurrency(taxAmt)}</span>
                              )}
                              {taxAmt > 0 && d.amount > 0 && (
                                <span className="text-green-400/60 text-[9px]">{formatCurrency(line3)}</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      {activeTab === 'actual' && row.isOverseas ? (
                        <td className={`py-2 px-2 text-center font-bold ${row.annualUsd > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center justify-center gap-0">
                            <span>{row.annualUsd > 0 ? formatUsd(row.annualUsd) : '-'}</span>
                            {row.annual > 0 && <span className="text-emerald-400/40 text-[9px] font-normal">{formatCurrency(row.annual)}</span>}
                            {(row.annualTax || 0) > 0 && <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(row.annualTax)}</span>}
                          </div>
                        </td>
                      ) : activeTab === 'expected' && row.isOverseas ? (
                        <td className={`py-2 px-2 text-center font-bold ${row.annualUsd > 0 ? 'text-blue-400' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center justify-center gap-0">
                            <span>{row.annualUsd > 0 ? formatUsd(row.annualUsd) : '-'}</span>
                            {row.annual > 0 && <span className="text-blue-300/40 text-[9px] font-normal">{formatCurrency(row.annual)}</span>}
                            {rowTaxRate > 0 && row.annual > 0 && <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(Math.round(row.annual * rowTaxRate / 100))}</span>}
                          </div>
                        </td>
                      ) : (
                        <td className={`py-2 px-2 text-center font-bold ${row.annual > 0 ? (activeTab === 'expected' ? 'text-yellow-400' : 'text-emerald-400') : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center justify-center gap-0">
                            <span>{row.annual > 0 ? formatCurrency(row.annual) : '-'}</span>
                            {activeTab === 'expected' && (row.annualTax || 0) > 0 && (() => {
                              const annualTax = row.annualTax || 0;
                              return (<>
                                <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(annualTax)}</span>
                                <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - annualTax)}</span>
                              </>);
                            })()}
                            {activeTab === 'actual' && (row.annualTax || 0) > 0 && (<>
                              <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(row.annualTax)}</span>
                              <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - row.annualTax)}</span>
                            </>)}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                  {activeTab === 'actual' && compactActualHasOverseas ? (
                    compactActualMonthlyUsd.map((usdTotal, i) => (
                      <td key={i} className="py-2.5 px-1 text-center font-bold text-[10px]">
                        <div className="flex flex-col items-center">
                          {usdTotal > 0 ? <span className="text-emerald-300">{formatUsd(usdTotal)}</span> : null}
                          {compactActualMonthlyDomesticKrw[i] > 0 ? <span className="text-emerald-300/40 text-[9px]">{formatCurrency(compactActualMonthlyDomesticKrw[i])}</span> : (!usdTotal ? <span className="text-gray-600">-</span> : null)}
                        </div>
                      </td>
                    ))
                  ) : activeTab === 'expected' && compactExpectedHasOverseas ? (
                    compactExpectedMonthlyUsd.map((usdTotal, i) => (
                      <td key={i} className="py-2.5 px-1 text-center font-bold text-[10px]">
                        <div className="flex flex-col items-center">
                          {usdTotal > 0 ? <span className="text-yellow-300">{formatUsd(usdTotal)}</span> : null}
                          {compactExpectedMonthlyDomesticKrw[i] > 0 ? <span className="text-yellow-300/40 text-[9px]">{formatCurrency(compactExpectedMonthlyDomesticKrw[i])}</span> : (!usdTotal ? <span className="text-gray-600">-</span> : null)}
                        </div>
                      </td>
                    ))
                  ) : (
                    compactMonthlyTotals.map((total, i) => (
                      <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-green-300' : 'text-gray-600'}`}>
                        {total > 0 ? formatCurrency(total) : '-'}
                      </td>
                    ))
                  )}
                  {activeTab === 'actual' && compactActualHasOverseas ? (
                    <td className="py-2 px-2 text-center font-bold text-emerald-300">
                      <div className="flex flex-col items-center">
                        {compactActualAnnualUsd > 0 && <span>{formatUsd(compactActualAnnualUsd)}</span>}
                        {compactActualDomesticAnnual > 0 && <span className="text-emerald-300/40 text-[9px] font-normal">{formatCurrency(compactActualDomesticAnnual)}</span>}
                      </div>
                    </td>
                  ) : activeTab === 'expected' && compactExpectedHasOverseas ? (
                    <td className="py-2 px-2 text-center font-bold text-yellow-300">
                      <div className="flex flex-col items-center">
                        {compactExpectedAnnualUsd > 0 && <span>{formatUsd(compactExpectedAnnualUsd)}</span>}
                        {compactExpectedDomesticAnnual > 0 && <span className="text-yellow-300/40 text-[9px] font-normal">{formatCurrency(compactExpectedDomesticAnnual)}</span>}
                      </div>
                    </td>
                  ) : (
                    <td className={`py-2 px-2 text-center font-bold ${activeTab === 'expected' ? 'text-yellow-300' : 'text-emerald-300'}`}>
                      {totalAnnual > 0 ? formatCurrency(totalAnnual) : '-'}
                    </td>
                  )}
                </tr>
                {activeTab === 'expected' && compactAnnualTax > 0 && (() => {
                  const monthlyTaxArr = Array.from({ length: 12 }, (_, i) =>
                    compactExpectedRows
                      .filter(r => !isSeparateTax(r.portfolioId))
                      .reduce((sum, row) => sum + (row.monthData[i]?.taxKrw || 0), 0)
                  );
                  return (
                    <tr className="text-orange-300/60">
                      <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">과세합계</td>
                      {monthlyTaxArr.map((tax, i) => (
                        <td key={i} className="py-1 px-1 text-center text-[9px]">{tax > 0 ? formatCurrency(tax) : '-'}</td>
                      ))}
                      <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(compactAnnualTax)}</td>
                    </tr>
                  );
                })()}
                {activeTab === 'actual' && compactActualAnnualTaxCombined > 0 && (
                  <tr className="text-orange-300/60">
                    <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">과세합계</td>
                    {compactActualMonthlyTaxCombined.map((tax, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">{tax > 0 ? formatCurrency(tax) : '-'}</td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(compactActualAnnualTaxCombined)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden w-full">
      <div className="px-3 py-2.5 bg-[#0f172a] border-b border-gray-700 flex items-start gap-3">
        <span className="text-white font-bold text-sm shrink-0 self-center">💰 분배금 현황</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-700 shrink-0 self-center">
          <button
            onClick={() => setActiveTab('expected')}
            className={`px-3 py-1 text-xs font-bold transition-colors ${activeTab === 'expected' ? 'bg-blue-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
          >
            월 예상 분배금
          </button>
          <button
            onClick={() => setActiveTab('actual')}
            className={`px-3 py-1 text-xs font-bold transition-colors border-l border-gray-700 ${activeTab === 'actual' ? 'bg-emerald-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
          >
            월 입금 내역
          </button>
          {['portfolio', 'dividend', 'isa', 'pension', 'dc-irp'].includes(nonGoldPortfolios[0]?.accountType) && updateTaxBasePurchases && (
            <button
              onClick={() => setActiveTab('tax')}
              className={`px-3 py-1 text-xs font-bold transition-colors border-l border-gray-700 ${activeTab === 'tax' ? 'bg-amber-700/80 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700/50'}`}
            >
              과표 계산
            </button>
          )}
        </div>
        {activeTab === 'expected' && annualTotal > 0 && (
          <div className="flex items-start gap-3 self-center">
            <div className="text-[10px] leading-[1.65]">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 w-12 shrink-0">세전합계</span>
                <span className="text-blue-300 font-bold tabular-nums">{formatCurrency(annualTotal)}</span>
                {annualUsdTotal > 0 && <span className="text-gray-700">|</span>}
                {annualUsdTotal > 0 && <span className="text-blue-300/60 text-[9px] tabular-nums">{formatUsd(annualUsdTotal)}</span>}
              </div>
              {annualTaxTotal > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 w-12 shrink-0">세후(예상)</span>
                  <span className="text-emerald-400 font-bold tabular-nums">{formatCurrency(annualTotal - annualTaxTotal)}</span>
                  {annualUsdTaxTotal > 0 && <span className="text-gray-700">|</span>}
                  {annualUsdTaxTotal > 0 && <span className="text-emerald-400/60 text-[9px] tabular-nums">{formatUsd(annualUsdTotal - annualUsdTaxTotal)}</span>}
                </div>
              )}
              {annualTaxTotal > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 w-12 shrink-0">과세</span>
                  <span className="text-orange-300/70 font-semibold tabular-nums">{formatCurrency(annualTaxTotal)}</span>
                  {annualUsdTaxTotal > 0 && <span className="text-gray-700">|</span>}
                  {annualUsdTaxTotal > 0 && <span className="text-orange-300/50 text-[9px] tabular-nums">{formatUsd(annualUsdTaxTotal)}</span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-0.5 self-center">
              <span className="text-gray-500 text-[10px]">과세율</span>
              <input
                type="text"
                inputMode="decimal"
                value={getTaxRate(nonGoldPortfolios[0]?.id)}
                onChange={e => { const v = parseFloat(e.target.value); updatePortfolioDividendTaxRate(nonGoldPortfolios[0]?.id, isNaN(v) ? 0 : v); }}
                className="w-10 bg-transparent text-orange-300 text-[10px] text-center border-b border-gray-600/50 outline-none"
              />
              <span className="text-gray-500 text-[10px]">%</span>
            </div>
          </div>
        )}
        {activeTab === 'actual' && actualAnnualGrossKrw > 0 && (
          <div className="text-[10px] leading-[1.65] self-center">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500 w-12 shrink-0">세전합계</span>
              <span className="text-blue-300 font-bold tabular-nums">{formatCurrency(actualAnnualGrossKrw)}</span>
              {actualAnnualGrossUsd > 0 && <span className="text-gray-700">|</span>}
              {actualAnnualGrossUsd > 0 && <span className="text-blue-300/60 text-[9px] tabular-nums">{formatUsd(actualAnnualGrossUsd)}</span>}
            </div>
            {actualAnnualAfterKrw > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 w-12 shrink-0">세후</span>
                <span className="text-emerald-400 font-bold tabular-nums">{formatCurrency(actualAnnualAfterKrw)}</span>
                {actualAnnualAfterUsd > 0 && <span className="text-gray-700">|</span>}
                {actualAnnualAfterUsd > 0 && <span className="text-emerald-400/60 text-[9px] tabular-nums">{formatUsd(actualAnnualAfterUsd)}</span>}
              </div>
            )}
            {(actualAnnualGrossKrw - actualAnnualAfterKrw) > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 w-12 shrink-0">과세</span>
                <span className="text-orange-300/70 font-semibold tabular-nums">{formatCurrency(actualAnnualGrossKrw - actualAnnualAfterKrw)}</span>
                {actualAnnualGrossUsd > 0 && <span className="text-gray-700">|</span>}
                {actualAnnualGrossUsd > 0 && <span className="text-orange-300/50 text-[9px] tabular-nums">{formatUsd(actualAnnualGrossUsd - actualAnnualAfterUsd)}</span>}
              </div>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0 self-center">
          {activeTab === 'actual' && addPortfolioExtraRow && (
            <button
              onClick={() => addPortfolioExtraRow(nonGoldPortfolios[0]?.id)}
              title="과거 종목 배당금 행 추가"
              className="w-7 h-7 flex items-center justify-center rounded border border-emerald-700/50 text-emerald-400/80 hover:bg-emerald-900/30 hover:text-emerald-300 hover:border-emerald-600 active:scale-95 transition-all"
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13"/>
                <line x1="3" y1="8" x2="13" y2="8"/>
              </svg>
            </button>
          )}
          <button
            onClick={handleRefreshAll}
            disabled={loading}
            title={loading ? '조회 중...' : '분배금 최신값 조회·저장됩니다'}
            className="w-7 h-7 flex items-center justify-center rounded border border-gray-600/70 text-gray-400 hover:bg-gray-700/50 hover:text-gray-200 hover:border-gray-500 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 월 예상 분배금 탭 */}
      {activeTab === 'expected' && (() => {
        const expectedHasOverseas = expectedRows.some(r => r.isOverseas);
        return (
          <div className="overflow-x-auto">
            {loading && expectedRows.every(r => !r.hasDivData) ? (
              <div className="py-8 text-center text-blue-400 text-xs animate-pulse">분배금 데이터 조회 중...</div>
            ) : expectedRows.length === 0 ? (
              <div className="py-8 text-center text-gray-500 text-xs">주식·ETF 종목이 없습니다.</div>
            ) : (
              <table className="w-full text-[11px] text-center">
                <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                  <tr>
                    <th className="py-3 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">코드</th>
                    {MONTHS.map(m => (
                      <th key={m} colSpan={expectedHasOverseas ? 2 : 1} className="py-2.5 px-1 min-w-[104px]">{m}</th>
                    ))}
                    <th colSpan={expectedHasOverseas ? 2 : 1} className="py-2 px-2 min-w-[88px] text-yellow-500 font-bold">연간합계</th>
                  </tr>
                  {expectedHasOverseas && (
                    <tr className="text-[9px] border-b border-gray-700/50">
                      <th className="sticky left-0 z-10 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]"></th>
                      {MONTHS.map(m => (
                        <React.Fragment key={m}>
                          <th className="py-1 text-blue-400 font-normal min-w-[62px]">세전</th>
                          <th className="py-1 text-emerald-400 font-normal min-w-[62px]">세후</th>
                        </React.Fragment>
                      ))}
                      <th className="py-1 text-blue-400 font-normal min-w-[62px]">세전</th>
                      <th className="py-1 text-emerald-400 font-normal min-w-[62px]">세후</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {expectedRows.map((row) => {
                    const taxRate = getTaxRate(row.portfolioId);
                    return (
                      <tr key={`${row.portfolioId}-${row.code}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                        <td className="py-3 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-blue-300">
                          <div className="flex items-center gap-1">
                            <div className="line-clamp-1">{row.name || row.code}</div>
                            {row.cadence && <span className={`shrink-0 px-1 py-0.5 rounded border text-[8px] font-bold leading-none ${row.cadence.cls}`}>{row.cadence.label}</span>}
                          </div>
                          {row.name && <div className="text-gray-500 text-[9px] font-normal">({row.code})</div>}
                        </td>
                        {row.isOverseas && expectedHasOverseas ? (
                          row.monthData.map((d, i) => {
                            const afterTaxUsd = d.amountUsd * (1 - taxRate / 100);
                            const afterTaxKrw = Math.round(afterTaxUsd * usdkrw);
                            const isLastCol = i === 11;
                            return (
                              <React.Fragment key={i}>
                                <td className={`py-0.5 px-1 text-center text-[10px] border-r border-gray-700/20 ${
                                  d.amountUsd > 0
                                    ? d.isActual ? 'text-blue-300 font-bold bg-blue-900/10' : 'text-blue-300/60'
                                    : 'text-gray-700'
                                }`}>
                                  <div className="flex flex-col items-center gap-0">
                                    <DivMeta d={d} isOverseas={true} />
                                    <span>{d.amountUsd > 0 ? formatUsd(d.amountUsd) : loading && !row.hasDivData ? '...' : '-'}</span>
                                    {d.amount > 0 && <span className="text-gray-500 text-[9px]">{formatCurrency(d.amount)}</span>}
                                  </div>
                                </td>
                                <td className={`py-0.5 px-1 text-center text-[10px] ${isLastCol ? '' : 'border-r border-gray-600/40'} ${
                                  afterTaxUsd > 0
                                    ? d.isActual ? 'text-emerald-300 font-bold bg-emerald-900/10' : 'text-emerald-300/70'
                                    : 'text-gray-700'
                                }`}>
                                  <div className="flex flex-col items-center gap-0">
                                    <span>{afterTaxUsd > 0 ? formatUsd(afterTaxUsd) : '-'}</span>
                                    {afterTaxKrw > 0 && <span className="text-gray-500 text-[9px]">{formatCurrency(afterTaxKrw)}</span>}
                                  </div>
                                </td>
                              </React.Fragment>
                            );
                          })
                        ) : (
                          row.monthData.map((d, i) => (
                            <td key={i} colSpan={expectedHasOverseas ? 2 : 1} className={`py-1.5 px-1 text-center text-[10px] ${
                              d.amount > 0
                                ? d.isActual ? 'text-emerald-300 font-bold bg-emerald-900/25' : 'text-blue-300/70'
                                : 'text-gray-700'
                            }`}>
                              <div className="flex flex-col items-center gap-0">
                                <DivMeta d={d} isOverseas={false} />
                                <span>{d.amount > 0 ? formatCurrency(d.amount) : loading && !row.hasDivData ? '...' : '-'}</span>
                                {taxRate > 0 && d.amount > 0 && (() => {
                                  const taxRec = dividendTaxHistory?.[row.code]?.records?.[d.yearMonth];
                                  const taxAmt = taxRec && d.qty > 0
                                    ? Math.round(taxRec.perShareTaxableBase * d.qty * taxRate / 100)
                                    : Math.round(d.amount * taxRate / 100);
                                  return (<>
                                    <span className="text-orange-300/55 text-[9px]">{formatCurrency(taxAmt)}</span>
                                    <span className="text-green-400/60 text-[9px]">{formatCurrency(d.amount - taxAmt)}</span>
                                  </>);
                                })()}
                              </div>
                            </td>
                          ))
                        )}
                        {row.isOverseas && expectedHasOverseas ? (() => {
                          const annualAfterUsd = row.annualUsd * (1 - taxRate / 100);
                          const annualAfterKrw = Math.round(annualAfterUsd * usdkrw);
                          return (
                            <React.Fragment key="annual">
                              <td className={`py-2 px-2 text-center font-bold border-r border-gray-700/20 ${row.annualUsd > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                                <div className="flex flex-col items-center gap-0">
                                  <span>{row.annualUsd > 0 ? formatUsd(row.annualUsd) : loading && !row.hasDivData ? '...' : '-'}</span>
                                  {row.annual > 0 && <span className="text-gray-400 text-[9px] font-normal">{formatCurrency(row.annual)}</span>}
                                </div>
                              </td>
                              <td className={`py-2 px-2 text-center font-bold ${annualAfterUsd > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                                <div className="flex flex-col items-center gap-0">
                                  <span>{annualAfterUsd > 0 ? formatUsd(annualAfterUsd) : '-'}</span>
                                  {annualAfterKrw > 0 && <span className="text-gray-400 text-[9px] font-normal">{formatCurrency(annualAfterKrw)}</span>}
                                </div>
                              </td>
                            </React.Fragment>
                          );
                        })() : (
                          <td colSpan={expectedHasOverseas ? 2 : 1} className={`py-2 px-2 text-center font-bold ${row.annual > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-center gap-0">
                              <span>{row.annual > 0 ? formatCurrency(row.annual) : loading && !row.hasDivData ? '...' : '-'}</span>
                              {taxRate > 0 && row.annual > 0 && (() => {
                                const tax = row.monthData.reduce((s, d) => {
                                  const taxRec = dividendTaxHistory?.[row.code]?.records?.[d.yearMonth];
                                  return s + (taxRec && d.qty > 0
                                    ? Math.round(taxRec.perShareTaxableBase * d.qty * taxRate / 100)
                                    : Math.round(d.amount * taxRate / 100));
                                }, 0);
                                return (<>
                                  <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(tax)}</span>
                                  <span className="text-green-400/70 text-[9px] font-normal">{formatCurrency(row.annual - tax)}</span>
                                </>);
                              })()}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                  <tr>
                    <td className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                    {expectedHasOverseas ? (
                      MONTHS.map((_, i) => (
                        <React.Fragment key={i}>
                          <td className={`py-2.5 px-1 text-center font-bold text-[10px] border-r border-gray-700/20 ${monthlyUsdTotals[i] > 0 ? 'text-blue-300/70' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-center">
                              {monthlyUsdTotals[i] > 0 && <span>{formatUsd(monthlyUsdTotals[i])}</span>}
                              {monthlyTotals[i] > 0 ? formatCurrency(monthlyTotals[i]) : '-'}
                            </div>
                          </td>
                          <td className={`py-2.5 px-1 text-center font-bold text-[10px] ${i < 11 ? 'border-r border-gray-600/40' : ''} ${(monthlyUsdTotals[i] - monthlyUsdTaxTotals[i]) > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-center">
                              {monthlyUsdTotals[i] > 0 && <span>{formatUsd(monthlyUsdTotals[i] - monthlyUsdTaxTotals[i])}</span>}
                              {monthlyTotals[i] > 0 ? formatCurrency(monthlyTotals[i] - (monthlyTaxTotals[i] || 0)) : '-'}
                            </div>
                          </td>
                        </React.Fragment>
                      ))
                    ) : (
                      monthlyTotals.map((total, i) => (
                        <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-green-300' : 'text-gray-600'}`}>
                          {total > 0 ? formatCurrency(total) : '-'}
                        </td>
                      ))
                    )}
                    {expectedHasOverseas ? (
                      <>
                        <td className="py-2 px-2 text-center font-bold text-blue-300 border-r border-gray-700/20">
                          <div className="flex flex-col items-center">
                            {annualUsdTotal > 0 && <span className="text-[9px] font-normal">{formatUsd(annualUsdTotal)}</span>}
                            {annualTotal > 0 ? formatCurrency(annualTotal) : '-'}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center font-bold text-emerald-300">
                          <div className="flex flex-col items-center">
                            {annualUsdTotal > 0 && <span className="text-[9px] font-normal">{formatUsd(annualUsdTotal - annualUsdTaxTotal)}</span>}
                            {annualTotal > 0 ? formatCurrency(annualTotal - annualTaxTotal) : '-'}
                          </div>
                        </td>
                      </>
                    ) : (
                      <td className="py-2 px-2 text-center font-bold text-yellow-300">
                        <div className="flex flex-col items-center">
                          {annualUsdTotal > 0 && <span className="text-gray-400 text-[9px] font-normal">{formatUsd(annualUsdTotal)}</span>}
                          {annualTotal > 0 ? formatCurrency(annualTotal) : '-'}
                        </div>
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            )}
            {!loading && expectedRows.length > 0 && (
              <div className="px-3 py-1.5 bg-[#0f172a]/60 text-[10px] text-gray-600 border-t border-gray-700/50">
                초록 배경 = {CURRENT_YEAR}년 실제 지급 데이터 &nbsp;·&nbsp; 파란 글씨 = 직전연도 기준 예측 &nbsp;·&nbsp; 날짜 = 배당락-지급일(~ 는 직전연도 기준 추정) &nbsp;·&nbsp; <span className="text-amber-400/70">주황 수량</span> = 실지급액 역산
              </div>
            )}
          </div>
        );
      })()}

      {/* 월 입금 내역 탭 */}
      {activeTab === 'actual' && (
        <div className="overflow-x-auto">
          {actualRows.length === 0 && extraActualRows.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-xs">주식·ETF 종목이 없습니다.</div>
          ) : (
            <table className="w-full text-[11px] text-center">
              <thead className="bg-[#1e293b] text-gray-400 border-b border-gray-600">
                <tr>
                  <th className="py-3 px-3 text-left sticky left-0 z-10 bg-[#1e293b] min-w-[130px] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">코드</th>
                  {MONTHS.map(m => (
                    <th key={m} colSpan={actualHasOverseas ? 2 : 1} className="py-2.5 px-1 min-w-[96px]">{m}</th>
                  ))}
                  <th colSpan={actualHasOverseas ? 2 : 1} className="py-2 px-2 min-w-[88px] text-emerald-500 font-bold">연간합계</th>
                </tr>
                {actualHasOverseas && (
                  <tr className="text-[9px] border-b border-gray-700/50">
                    <th className="sticky left-0 z-10 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]"></th>
                    {MONTHS.map(m => (
                      <React.Fragment key={m}>
                        <th className="py-1 text-blue-400 font-normal min-w-[62px]">세전</th>
                        <th className="py-1 text-emerald-400 font-normal min-w-[62px]">세후</th>
                      </React.Fragment>
                    ))}
                    <th className="py-1 text-blue-400 font-normal min-w-[62px]">세전</th>
                    <th className="py-1 text-emerald-400 font-normal min-w-[62px]">세후</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {actualRows.map((row) => (
                  <tr key={`${row.portfolioId}-${row.code}`} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                    <td className="py-3 px-3 text-left sticky left-0 z-[5] bg-[#0f172a] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] font-bold text-blue-300">
                      <div className="flex items-center gap-1">
                        <div className="line-clamp-1">{row.name || row.code}</div>
                        {row.cadence && <span className={`shrink-0 px-1 py-0.5 rounded border text-[8px] font-bold leading-none ${row.cadence.cls}`}>{row.cadence.label}</span>}
                      </div>
                      {row.name && <div className="text-gray-500 text-[9px] font-normal">({row.code})</div>}
                    </td>
                    {row.monthData.map((d, i) => {
                      const isEditingQty = editingCell?.portfolioId === row.portfolioId
                        && editingCell?.code === row.code
                        && editingCell?.monthIdx === i
                        && !editingCell?.isExtra
                        && editingCell?.field === 'qty';
                      const isEditingCell = editingCell?.portfolioId === row.portfolioId
                        && editingCell?.code === row.code
                        && editingCell?.monthIdx === i
                        && !editingCell?.isExtra
                        && editingCell?.field !== 'qty';
                      const isEditingAfterTax = isEditingCell && editingCell?.field === 'afterTax';
                      const isLastMonthCol = i === 11;
                      const qtyNode = isEditingQty ? (
                        <input
                          ref={inputRef}
                          type="text" inputMode="numeric"
                          value={editingCell.value}
                          onChange={e => setEditingCell(prev => ({ ...prev, value: e.target.value }))}
                          onClick={e => e.stopPropagation()}
                          onBlur={handleAfterTaxBlur}
                          onFocus={handleAfterTaxFocus}
                          onKeyDown={handleCellKeyDown}
                          className="w-14 bg-transparent text-amber-300 text-center text-[10px] outline-none border-b border-amber-500/60"
                          placeholder="수량"
                        />
                      ) : ((d.hasManual || d.qtyIsManual) && d.qtyVal > 0) ? (
                        <span
                          onClick={e => e.stopPropagation()}
                          onDoubleClick={e => { e.stopPropagation(); handleQtyDblClick(row, i); }}
                          title="더블클릭하여 수량 수정"
                          className={`text-[9px] leading-tight cursor-pointer hover:underline ${d.qtyIsManual ? 'text-amber-400/80' : 'text-gray-500'}`}
                        >
                          {d.qtyVal.toLocaleString()}주{d.perShare > 0 ? ` × ${row.isOverseas ? formatUsd(d.perShare) : formatCurrency(d.perShare)}` : ''}
                        </span>
                      ) : null;

                      if (row.isOverseas) {
                        return (
                          <React.Fragment key={i}>
                            {/* 세전 열: 계산값 표시만 (읽기전용) */}
                            <td className={`py-0.5 px-1 text-center text-[10px] border-r border-gray-700/20 ${d.hasManual ? 'text-blue-300/70' : 'text-gray-700'}`}>
                              {(d.hasManual || qtyNode) ? (
                                <div className="flex flex-col items-center gap-0">
                                  {qtyNode}
                                  {d.hasManual && <span>{formatUsd(d.grossUsd)}</span>}
                                  {d.hasManual && <span className="text-gray-600 text-[9px]">{formatCurrency(d.grossKrw)}</span>}
                                </div>
                              ) : '-'}
                            </td>
                            {/* 세후 + 과세금 입력 열 */}
                            <td
                              onClick={() => !isEditingCell && handleAfterTaxCellClick(row, i)}
                              className={`py-0.5 px-1 text-center text-[10px] cursor-pointer transition-colors ${
                                isLastMonthCol ? '' : 'border-r border-gray-600/40'
                              } ${
                                isEditingAfterTax ? 'bg-emerald-900/30' :
                                d.hasManual ? 'text-emerald-300 font-bold bg-emerald-900/10 hover:bg-emerald-900/30' :
                                'text-gray-700 hover:bg-gray-700/20'
                              }`}
                            >
                              {isEditingAfterTax ? (
                                <div className="flex flex-col gap-0.5 py-0.5">
                                  <div className="flex items-center gap-0.5 justify-center">
                                    <span className="text-[8px] text-emerald-500/70">세후$</span>
                                    <input
                                      ref={inputRef}
                                      type="text" inputMode="decimal"
                                      value={editingCell.usdValue}
                                      onChange={e => setEditingCell(prev => ({ ...prev, usdValue: e.target.value }))}
                                      onBlur={handleAfterTaxBlur}
                                      onFocus={handleAfterTaxFocus}
                                      onKeyDown={handleCellKeyDown}
                                      className="w-14 bg-transparent text-emerald-300 text-right text-[10px] outline-none border-b border-emerald-500/60"
                                      placeholder="세후 $"
                                    />
                                  </div>
                                  <div className="flex items-center gap-0.5 justify-center">
                                    <span className="text-[8px] text-emerald-500/50">세후₩</span>
                                    <input
                                      ref={krwInputRef}
                                      type="text" inputMode="numeric"
                                      value={editingCell.krwValue}
                                      onChange={e => setEditingCell(prev => ({ ...prev, krwValue: e.target.value }))}
                                      onBlur={handleAfterTaxBlur}
                                      onFocus={handleAfterTaxFocus}
                                      onKeyDown={handleCellKeyDown}
                                      className="w-14 bg-transparent text-emerald-300/80 text-right text-[10px] outline-none border-b border-emerald-500/40"
                                      placeholder="세후 ₩"
                                    />
                                  </div>
                                  <div className="flex items-center gap-0.5 justify-center">
                                    <span className="text-[8px] text-orange-400/70">과세₩</span>
                                    <input
                                      type="text" inputMode="numeric"
                                      value={editingCell.taxKrwValue || ''}
                                      onChange={e => setEditingCell(prev => ({ ...prev, taxKrwValue: e.target.value }))}
                                      onBlur={handleAfterTaxBlur}
                                      onFocus={handleAfterTaxFocus}
                                      onKeyDown={handleCellKeyDown}
                                      className="w-14 bg-transparent text-orange-300 text-right text-[10px] outline-none border-b border-orange-500/40"
                                      placeholder="과세금 ₩"
                                    />
                                  </div>
                                </div>
                              ) : d.hasManual ? (
                                <div className="flex flex-col items-center gap-0">
                                  <span>{formatUsd(d.afterTaxUsd)}</span>
                                  {d.afterTaxKrw > 0 && <span className="text-emerald-300/50 text-[9px]">{formatCurrency(d.afterTaxKrw)}</span>}
                                  {(d.effectiveTaxKrw || 0) > 0 && <span className="text-orange-300/55 text-[9px]">{formatCurrency(d.effectiveTaxKrw)}</span>}
                                </div>
                              ) : '-'}
                            </td>
                          </React.Fragment>
                        );
                      } else {
                        const taxAmt = d.taxAmount != null ? d.taxAmount : 0;
                        const beforeTax = d.amount + taxAmt;
                        return (
                          <td
                            key={i}
                            colSpan={actualHasOverseas ? 2 : 1}
                            onClick={() => !isEditingCell && !isEditingQty && handleKrwCellClick(row, i)}
                            className={`py-0.5 px-0.5 text-center text-[10px] cursor-pointer transition-colors ${
                              isLastMonthCol ? '' : 'border-r border-gray-600/40'
                            } ${
                              isEditingCell ? 'bg-emerald-900/30' :
                              d.hasManual ? 'text-emerald-300 font-bold bg-emerald-900/20 hover:bg-emerald-900/40' :
                              'text-gray-700 hover:bg-gray-700/30'
                            }`}
                          >
                            {isEditingCell ? (
                              <div className="flex flex-col gap-0.5 py-0.5">
                                <div className="flex items-center gap-0.5 justify-center">
                                  <span className="text-[8px] text-emerald-500/70">세후</span>
                                  <input
                                    ref={inputRef}
                                    type="text" inputMode="numeric"
                                    value={editingCell.value}
                                    onChange={e => setEditingCell(prev => ({ ...prev, value: e.target.value }))}
                                    onBlur={handleAfterTaxBlur}
                                    onFocus={handleAfterTaxFocus}
                                    onKeyDown={handleCellKeyDown}
                                    className="w-14 bg-transparent text-emerald-300 text-right text-[10px] outline-none border-b border-emerald-500/60"
                                    placeholder="세후 ₩"
                                  />
                                </div>
                                <div className="flex items-center gap-0.5 justify-center">
                                  <span className="text-[8px] text-orange-400/70">과세</span>
                                  <input
                                    ref={krwInputRef}
                                    type="text" inputMode="numeric"
                                    value={editingCell.taxValue || ''}
                                    onChange={e => setEditingCell(prev => ({ ...prev, taxValue: e.target.value }))}
                                    onBlur={handleAfterTaxBlur}
                                    onFocus={handleAfterTaxFocus}
                                    onKeyDown={handleCellKeyDown}
                                    className="w-14 bg-transparent text-orange-300 text-right text-[10px] outline-none border-b border-orange-500/40"
                                    placeholder="과세금 ₩"
                                  />
                                </div>
                              </div>
                            ) : (d.hasManual || qtyNode) ? (
                              <div className="flex flex-col items-center gap-0">
                                {qtyNode}
                                {d.hasManual && beforeTax > 0 && <span className="text-blue-300/70 text-[9px]">{formatCurrency(beforeTax)}</span>}
                                {d.hasManual && taxAmt > 0 && <span className="text-orange-300/55 text-[9px]">{formatCurrency(taxAmt)}</span>}
                                {d.hasManual && <span>{d.amount > 0 ? formatCurrency(d.amount) : '₩0'}</span>}
                              </div>
                            ) : (
                              <span>-</span>
                            )}
                          </td>
                        );
                      }
                    })}
                    {row.isOverseas ? (
                      <React.Fragment key="annual">
                        <td className={`py-2 px-2 text-center font-bold border-r border-gray-700/20 ${row.annual > 0 ? 'text-blue-400' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center gap-0">
                            {row.annualUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(row.annualUsd)}</span>}
                            <span>{row.annual > 0 ? formatCurrency(row.annual) : '-'}</span>
                          </div>
                        </td>
                        <td className={`py-2 px-2 text-center font-bold ${row.annualAfterKrw > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center gap-0">
                            {row.annualAfterUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(row.annualAfterUsd)}</span>}
                            <span>{row.annualAfterKrw > 0 ? formatCurrency(row.annualAfterKrw) : '-'}</span>
                          </div>
                        </td>
                      </React.Fragment>
                    ) : (
                      <td colSpan={actualHasOverseas ? 2 : 1} className={`py-2 px-2 text-center font-bold ${row.annual > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                        <div className="flex flex-col items-center gap-0">
                          {(() => {
                            const annualTax = row.monthData.reduce((s, d) => s + (d.taxAmount || 0), 0);
                            const annualAfter = row.annual; // row.annual = 세후 합계
                            const annualBefore = annualAfter + annualTax;
                            if (annualBefore <= 0) return <span className="text-gray-600">-</span>;
                            return (<>
                              {annualBefore > annualAfter && <span className="text-blue-300/70 text-[9px] font-normal">{formatCurrency(annualBefore)}</span>}
                              {annualTax > 0 && <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(annualTax)}</span>}
                              <span>{formatCurrency(annualAfter)}</span>
                            </>);
                          })()}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {/* 수동 추가 행 */}
                {extraActualRows.map((row) => {
                  return (
                    <tr key={`extra-${row.portfolioId}-${row.rowId}`} className="border-b border-gray-700/40 hover:bg-gray-800/30 bg-gray-900/10">
                      <td className="py-2 px-2 text-left sticky left-0 z-[5] bg-[#0a1120] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                        <div className="flex items-start gap-1">
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={row.code}
                              onChange={e => updatePortfolioExtraRowCode(row.portfolioId, row.rowId, e.target.value)}
                              onBlur={e => handleExtraRowCodeBlur(row.portfolioId, row.rowId, e.target.value, row.isOverseas)}
                              placeholder="코드/종목명"
                              className="w-full bg-transparent text-blue-300/80 text-[10px] border-b border-gray-700/40 outline-none placeholder-gray-700"
                            />
                            {row.name && <div className="text-gray-400 text-[9px] mt-0.5 line-clamp-1">{row.name}</div>}
                          </div>
                          <button
                            onClick={() => deletePortfolioExtraRow(row.portfolioId, row.rowId)}
                            className="text-gray-600 hover:text-red-400 transition-colors text-[10px] shrink-0 mt-0.5"
                            title="행 삭제"
                          >✕</button>
                        </div>
                      </td>
                      {row.monthData.map((d, i) => {
                        const isEditingCell = editingCell?.isExtra && editingCell?.rowId === row.rowId && editingCell?.monthIdx === i;
                        const isEditingAfterTax = isEditingCell && editingCell?.field === 'afterTax';
                        const isEditingKrw = isEditingCell && editingCell?.field === 'krw';
                        const isLastMonthCol = i === 11;

                        if (row.isOverseas) {
                          return (
                            <React.Fragment key={i}>
                              <td className="py-0.5 px-1 text-center text-[10px] text-gray-700 border-r border-gray-700/20">-</td>
                              <td
                                onClick={() => !isEditingCell && handleExtraOverseasCellClick(row, i)}
                                className={`py-0.5 px-1 text-center text-[10px] cursor-pointer transition-colors ${isLastMonthCol ? '' : 'border-r border-gray-600/40'} ${
                                  isEditingAfterTax ? 'bg-emerald-900/30' :
                                  d.afterTaxUsd > 0 || d.afterTaxKrw > 0 ? 'text-emerald-300 font-bold bg-emerald-900/10 hover:bg-emerald-900/30' :
                                  'text-gray-700 hover:bg-gray-700/20'
                                }`}
                              >
                                {isEditingAfterTax ? (
                                  <div className="flex flex-col gap-0.5 py-0.5">
                                    <div className="flex items-center gap-0.5 justify-center">
                                      <span className="text-[8px] text-gray-500">$</span>
                                      <input
                                        ref={inputRef}
                                        type="text" inputMode="decimal"
                                        value={editingCell.usdValue}
                                        onChange={e => setEditingCell(prev => ({ ...prev, usdValue: e.target.value }))}
                                        onBlur={handleAfterTaxBlur}
                                        onFocus={handleAfterTaxFocus}
                                        onKeyDown={handleCellKeyDown}
                                        className="w-14 bg-transparent text-emerald-300 text-right text-[10px] outline-none border-b border-emerald-500/60"
                                        placeholder="세후 $"
                                      />
                                    </div>
                                    <div className="flex items-center gap-0.5 justify-center">
                                      <span className="text-[8px] text-gray-500">₩</span>
                                      <input
                                        ref={krwInputRef}
                                        type="text" inputMode="numeric"
                                        value={editingCell.krwValue}
                                        onChange={e => setEditingCell(prev => ({ ...prev, krwValue: e.target.value }))}
                                        onBlur={handleAfterTaxBlur}
                                        onFocus={handleAfterTaxFocus}
                                        onKeyDown={handleCellKeyDown}
                                        className="w-14 bg-transparent text-emerald-300/80 text-right text-[10px] outline-none border-b border-emerald-500/40"
                                        placeholder="세후 ₩"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center gap-0">
                                    <span>{d.afterTaxUsd > 0 ? formatUsd(d.afterTaxUsd) : '-'}</span>
                                    {d.afterTaxKrw > 0 && <span className="text-gray-500 text-[9px]">{formatCurrency(d.afterTaxKrw)}</span>}
                                  </div>
                                )}
                              </td>
                            </React.Fragment>
                          );
                        } else {
                          const grossKrw = d.afterTaxKrw + (d.taxKrw || 0);
                          return (
                            <td
                              key={i}
                              colSpan={actualHasOverseas ? 2 : 1}
                              onClick={() => !isEditingCell && handleExtraKrwCellClick(row, i)}
                              className={`py-0.5 px-0.5 text-center text-[10px] cursor-pointer transition-colors ${isLastMonthCol ? '' : 'border-r border-gray-600/40'} ${
                                isEditingKrw ? 'bg-emerald-900/30' :
                                d.afterTaxKrw > 0 ? 'text-emerald-300 font-bold bg-emerald-900/20 hover:bg-emerald-900/40' :
                                'text-gray-700 hover:bg-gray-700/30'
                              }`}
                            >
                              {isEditingKrw ? (
                                <div className="flex flex-col gap-0.5 py-0.5">
                                  <div className="flex items-center gap-0.5 justify-center">
                                    <span className="text-[8px] text-emerald-500/70">세후</span>
                                    <input
                                      ref={inputRef}
                                      type="text" inputMode="numeric"
                                      value={editingCell.value}
                                      onChange={e => setEditingCell(prev => ({ ...prev, value: e.target.value }))}
                                      onBlur={handleAfterTaxBlur}
                                      onFocus={handleAfterTaxFocus}
                                      onKeyDown={handleCellKeyDown}
                                      className="w-14 bg-transparent text-emerald-300 text-right text-[10px] outline-none border-b border-emerald-500/60"
                                      placeholder="세후 ₩"
                                    />
                                  </div>
                                  <div className="flex items-center gap-0.5 justify-center">
                                    <span className="text-[8px] text-orange-400/70">과세</span>
                                    <input
                                      type="text" inputMode="numeric"
                                      value={editingCell.taxValue || ''}
                                      onChange={e => setEditingCell(prev => ({ ...prev, taxValue: e.target.value }))}
                                      onBlur={handleAfterTaxBlur}
                                      onFocus={handleAfterTaxFocus}
                                      onKeyDown={handleCellKeyDown}
                                      className="w-14 bg-transparent text-orange-300 text-right text-[10px] outline-none border-b border-orange-500/40"
                                      placeholder="과세금 ₩"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-0">
                                  {grossKrw > d.afterTaxKrw && <span className="text-blue-300/70 text-[9px]">{formatCurrency(grossKrw)}</span>}
                                  {d.taxKrw > 0 && <span className="text-orange-300/55 text-[9px]">{formatCurrency(d.taxKrw)}</span>}
                                  <span>{d.afterTaxKrw > 0 ? formatCurrency(d.afterTaxKrw) : '-'}</span>
                                </div>
                              )}
                            </td>
                          );
                        }
                      })}
                      {row.isOverseas ? (
                        <React.Fragment key="annual">
                          <td className="py-2 px-2 text-center font-bold text-gray-600 border-r border-gray-700/20">-</td>
                          <td className={`py-2 px-2 text-center font-bold ${row.annualAfterKrw > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-center gap-0">
                              {row.annualAfterUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(row.annualAfterUsd)}</span>}
                              <span>{row.annualAfterKrw > 0 ? formatCurrency(row.annualAfterKrw) : '-'}</span>
                            </div>
                          </td>
                        </React.Fragment>
                      ) : (
                        <td colSpan={actualHasOverseas ? 2 : 1} className={`py-2 px-2 text-center font-bold ${row.annualAfterKrw > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                          {row.annualAfterKrw > 0 ? (
                            <div className="flex flex-col items-center gap-0">
                              {(row.annualAfterKrw + (row.annualTaxKrw || 0)) > row.annualAfterKrw && (
                                <span className="text-blue-300/70 text-[9px] font-normal">{formatCurrency(row.annualAfterKrw + row.annualTaxKrw)}</span>
                              )}
                              {(row.annualTaxKrw || 0) > 0 && (
                                <span className="text-orange-300/55 text-[9px] font-normal">{formatCurrency(row.annualTaxKrw)}</span>
                              )}
                              <span>{formatCurrency(row.annualAfterKrw)}</span>
                            </div>
                          ) : '-'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  <td className="py-3 px-3 text-left text-gray-300 font-bold sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">합계</td>
                  {actualHasOverseas ? (
                    MONTHS.map((_, i) => (
                      <React.Fragment key={i}>
                        <td className={`py-2.5 px-1 text-center font-bold text-[10px] border-r border-gray-700/20 ${actualMonthlyGrossKrw[i] > 0 ? 'text-blue-300/70' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center">
                            {actualMonthlyGrossUsd[i] > 0 && <span className="text-[9px]">{formatUsd(actualMonthlyGrossUsd[i])}</span>}
                            {actualMonthlyGrossKrw[i] > 0 ? formatCurrency(actualMonthlyGrossKrw[i]) : '-'}
                          </div>
                        </td>
                        <td className={`py-2.5 px-1 text-center font-bold text-[10px] ${i < 11 ? 'border-r border-gray-600/40' : ''} ${actualMonthlyAfterKrw[i] > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>
                          <div className="flex flex-col items-center">
                            {actualMonthlyAfterUsd[i] > 0 && <span className="text-[9px]">{formatUsd(actualMonthlyAfterUsd[i])}</span>}
                            {actualMonthlyAfterKrw[i] > 0 ? formatCurrency(actualMonthlyAfterKrw[i]) : '-'}
                          </div>
                        </td>
                      </React.Fragment>
                    ))
                  ) : (
                    actualMonthlyGrossKrw.map((total, i) => (
                      <td key={i} className={`py-2.5 px-1 text-center font-bold text-[10px] ${total > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>
                        {total > 0 ? formatCurrency(total) : '-'}
                      </td>
                    ))
                  )}
                  {actualHasOverseas ? (
                    <>
                      <td className="py-2 px-2 text-center font-bold text-blue-300 border-r border-gray-700/20">
                        <div className="flex flex-col items-center">
                          {actualAnnualGrossUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(actualAnnualGrossUsd)}</span>}
                          {actualAnnualGrossKrw > 0 ? formatCurrency(actualAnnualGrossKrw) : '-'}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center font-bold text-emerald-300">
                        <div className="flex flex-col items-center">
                          {actualAnnualAfterUsd > 0 && <span className="text-[9px] font-normal">{formatUsd(actualAnnualAfterUsd)}</span>}
                          {actualAnnualAfterKrw > 0 ? formatCurrency(actualAnnualAfterKrw) : '-'}
                        </div>
                      </td>
                    </>
                  ) : (
                    <td className="py-2 px-2 text-center font-bold text-emerald-300">
                      {actualAnnualGrossKrw > 0 ? formatCurrency(actualAnnualGrossKrw) : '-'}
                    </td>
                  )}
                </tr>
                {!actualHasOverseas && actualAnnualTaxTotal > 0 && (<>
                  <tr className="text-orange-300/60">
                    <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">
                      과세합계
                    </td>
                    {actualMonthlyTaxTotals.map((tax, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">
                        {tax > 0 ? formatCurrency(tax) : '-'}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(actualAnnualTaxTotal)}</td>
                  </tr>
                  <tr className="text-green-400/70">
                    <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">실 수령(세후)</td>
                    {actualMonthlyGrossKrw.map((total, i) => (
                      <td key={i} className="py-1 px-1 text-center text-[9px]">
                        {total > 0 ? formatCurrency(total - (actualMonthlyTaxTotals[i] || 0)) : '-'}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px] font-bold">
                      {formatCurrency(actualAnnualGrossKrw - actualAnnualTaxTotal)}
                    </td>
                  </tr>
                </>)}
                {actualHasOverseas && actualAnnualOverseasTaxKrw > 0 && (
                  <tr className="text-orange-300/60">
                    <td className="py-1 px-3 text-left text-[10px] sticky left-0 z-[5] bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)]">과세합계</td>
                    {actualMonthlyOverseasTaxKrw.map((tax, i) => (
                      <React.Fragment key={i}>
                        <td className="py-1 px-1 text-center text-[9px] text-gray-700">-</td>
                        <td className="py-1 px-1 text-center text-[9px]">{tax > 0 ? formatCurrency(tax) : '-'}</td>
                      </React.Fragment>
                    ))}
                    <td className="py-1 px-2 text-center text-[10px] text-gray-700">-</td>
                    <td className="py-1 px-2 text-center text-[10px]">{formatCurrency(actualAnnualOverseasTaxKrw)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
          <div className="px-3 py-1.5 bg-[#0f172a]/60 text-[10px] text-gray-600 border-t border-gray-700/50">
            셀 클릭 → 실제 입금액 직접 입력 (Enter 저장 · Esc 취소) &nbsp;·&nbsp; 초록 = 직접 입력 &nbsp;·&nbsp; 파란 = 예상값 &nbsp;·&nbsp; 수량 = (세후+과세)÷주당분배금 계산값, <span className="text-amber-400/80">더블클릭 시 직접 수정</span>
          </div>
        </div>
      )}
      {activeTab === 'tax' && ['portfolio', 'dividend', 'isa', 'pension', 'dc-irp'].includes(nonGoldPortfolios[0]?.accountType) && updateTaxBasePurchases && (
        <ErrorBoundary label="과표 계산">
          <KrEtfTaxMatrix
            portfolio={nonGoldPortfolios[0]}
            updateTaxBaseEvents={updateTaxBaseEvents}
            updateTaxBasePurchases={updateTaxBasePurchases}
            updateTaxBaseSales={updateTaxBaseSales}
            updateTaxBaseExPrice={updateTaxBaseExPrice}
            updateTaxBaseAvgPrice={updateTaxBaseAvgPrice}
            updatePortfolioDividendTaxAmount={updatePortfolioDividendTaxAmount}
            notify={notify || (() => {})}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
