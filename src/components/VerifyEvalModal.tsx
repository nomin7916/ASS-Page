// @ts-nocheck
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { X, Plus, Trash2, Pencil, RotateCcw, HelpCircle, RefreshCw, FileSpreadsheet, Calendar } from 'lucide-react';
import {
  cleanNum,
  formatCurrency,
  formatPercent,
  formatShortDate,
  formatFundPrice,
  calcPortfolioEvalDetail,
  resolveHoldings,
  snapshotItemsFromPortfolio,
  computeEffectivePrincipal,
  evalSeriesDates,
} from '../utils';
import { buildEvalCompare } from '../evalCompare';
import { downloadEvalCompareXlsx, dateLabel } from '../evalCompareExcel';
import { getTodayKST } from '../hooks/useMarketCalendar';
import { BG, BORDER, Z } from '../design';
import CustomDatePicker from './CustomDatePicker';

// 종목의 수동종가 오버라이드 키 (gold는 code가 없으므로 'GOLD')
const overrideKeyFor = (item, isGold) =>
  item?.code || (isGold && item?.type !== 'deposit' ? 'GOLD' : '');

// 특정 날짜의 보유종목을 해결해 manual 스냅샷을 생성/갱신한 새 포트폴리오 객체 반환.
// baseline 이전 날짜를 편집하면 split(편집일=baseline 하향, 이전=추정) + preBaselineVerified 해제.
const withManualSnapshot = (p, date, mutate) => {
  const resolved = resolveHoldings(p, date);
  const base = snapshotItemsFromPortfolio(resolved.items);
  const nextItems = mutate(base);
  const snaps = Array.isArray(p.holdingSnapshots) ? p.holdingSnapshots.slice() : [];
  const idx = snaps.findIndex(s => s.date === date);
  if (idx >= 0) snaps[idx] = { ...snaps[idx], kind: 'manual', items: nextItems };
  else snaps.push({ date, kind: 'manual', items: nextItems });
  const next = { ...p, holdingSnapshots: snaps };
  const bDate = p.baselineDate || '';
  if (bDate && date < bDate) {
    next.baselineDate = date;
    next.preBaselineVerified = false;
  }
  return next;
};

const SOURCE_BADGE = {
  history: { label: '🟢 API', cls: 'text-green-400' },
  manual: { label: '🔴 수동입력', cls: 'text-red-400' },
  none: { label: '⚪ 데이터없음', cls: 'text-gray-500' },
  approximate: { label: '🟡 근사값', cls: 'text-amber-400' },
  deposit: { label: '예수금', cls: 'text-sky-300' },
  savings: { label: '🏦 예적금', cls: 'text-emerald-300' },
  currentPrice: { label: '⚪ 폴백', cls: 'text-gray-500' },
  evalAmount: { label: '⚪ 폴백', cls: 'text-gray-500' },
};

// 주당분배금 칸의 배지 = **모델이 그 값을 채택했는가**(입력했는가가 아니다).
// ⚠️ 음수·문자를 넣으면 모델은 자동값으로 되돌아가는데 배지만 '직접입력'이면 사용자는 자기
//    입력이 반영된 줄 안다(시트에는 자동값이 찍힌다).
// ⚠️ 접이식 토글의 '미확인 N' 카운트가 이 함수를 **공유**한다 — 손복제하면 배지는 앰버인데
//    카운트는 0이 되어 입력 패널이 통째로 사라진다.
const psBadgeOf = (info, draft) => {
  const ymLabel = info && info.ym ? info.ym.slice(2) : '';
  const typed = draft !== undefined && draft !== '';
  const badge = info && info.source === 'manual'
    ? '직접입력'
    : typed ? '무효 입력'
      : info && info.source === 'paid' ? `입금 ${ymLabel}`
        : info && info.source === 'declared' ? `확정 ${ymLabel}`
          : info && info.source === 'predicted' ? `예상 ${ymLabel}`
            : '미확인';
  return badge;
};
// 값이 확정되지 않은 배지(앰버). 토글 노출·카운트의 단일 판정 기준.
const PS_UNRESOLVED = ['미확인', '무효 입력'];

// 그 칸의 입력이 시트에 실제로 반영되는가.
// ⚠️ '기준일' 칸은 항상 유효하다 — ① 블록(기준일 보유)뿐 아니라 ④ 반사실도 **기준일 기준
//    주당분배금**을 쓰므로, 기준일에 이미 매도한 종목도 그 칸이 살아 있다.
// ⚠️ '비교일' 칸은 비교일에 보유했을 때만 쓰인다(② 블록과 ③ 교집합). 기준일에만 편입한
//    종목의 비교일 칸은 어느 블록에도 렌더되지 않는 **죽은 입력**인데, 그대로 두면 '미확인'
//    카운트를 부풀리고 '예상 N 적용' 버튼까지 띄워 사용자가 채우도록 유도한다.
const psCellLive = (row, side) => side === 'basis' || !!row?.compare?.present;

export default function VerifyEvalModal({
  record,
  portfolio,
  accountType,
  stockHistoryMap,
  indicatorHistoryMap,
  marketIndicators,
  effectiveDateKey,
  patchActivePortfolio,
  setHistory,
  notify,
  onClose,
  depositHistory,
  depositHistory2,
  history,
  refetchStockHistory,
}) {
  const date = record.date;
  const isGold = accountType === 'gold';
  const fx = marketIndicators?.usdkrw || 1;
  const mpo = portfolio?.manualPriceOverrides || {};

  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const isMobile = vp.w < 640;
  const modalWidth = isMobile ? Math.max(280, vp.w - 16) : 560;

  const [pos, setPos] = useState(() => {
    const w = window.innerWidth, h = window.innerHeight;
    const mw = w < 640 ? Math.max(280, w - 16) : 560;
    return { x: Math.max(8, (w - mw) / 2), y: Math.max(12, h / 2 - 260) };
  });
  useEffect(() => {
    setPos(p => ({
      x: isMobile ? Math.max(8, (vp.w - modalWidth) / 2) : Math.max(0, Math.min(Math.max(0, vp.w - modalWidth), p.x)),
      y: Math.max(8, Math.min(Math.max(8, vp.h - 80), p.y)),
    }));
  }, [vp.w, vp.h, modalWidth, isMobile]);
  const dragRef = useRef({ active: false, ox: 0, oy: 0 });
  const [refetchingCodes, setRefetchingCodes] = useState<Set<string>>(new Set());
  const [editQtyIdx, setEditQtyIdx] = useState(-1);
  const [editQtyRaw, setEditQtyRaw] = useState('');
  const [editPriceIdx, setEditPriceIdx] = useState(-1);
  const [editPriceRaw, setEditPriceRaw] = useState('');
  const [editPrincipal, setEditPrincipal] = useState(false);
  const [editPrincipalRaw, setEditPrincipalRaw] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    code: '', name: '', type: 'stock', quantity: '', start: date, end: '',
  });

  // ── 두 날짜 비교 · 엑셀 (읽기 전용 파생 — Drive 저장 지점 0곳) ──────────────
  const [showCompare, setShowCompare] = useState(false);
  const [compareDate, setCompareDate] = useState('');
  // ⚠️ 주당분배금 입력은 **원시 문자열**로 들고 있는다(예적금 `annualRate`와 같은 규약) —
  //    onChange마다 cleanNum을 태우면 '0.45'를 치는 도중 소수점이 지워져 45가 저장된다.
  //    파싱은 모델(`buildEvalCompare`)이 한 번만 한다.
  // ⚠️ 이 값은 **모달 로컬**이다 — Drive에 저장하지 않는다(사용자 확정 2026-08 '이번 모달에서만').
  //    저장하려면 `dividendHistory`가 아니라 신규 필드를 써야 한다(그 맵은 API 새로고침이
  //    얕은 병합으로 덮어써 사용자 입력이 소실된다).
  const [psDraft, setPsDraft] = useState({ basis: {}, compare: {} });
  // 주당분배금 입력은 평소에 볼 일이 없다 → **기본 접힘**. 미확인이 있을 때만 토글을 노출한다.
  const [showDiv, setShowDiv] = useState(false);
  const [xlsxFlash, setXlsxFlash] = useState(false);
  const [compareError, setCompareError] = useState('');
  const flashTimer = useRef(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // 비교일 후보 = 기록일 ∪ 구성 변경일 중 **기준일보다 이전**인 날짜.
  // ⚠️ 미래 날짜를 남기면 ③ '증감'의 부호가 뒤집히고 ④가 '나중 수량 × 이전 종가'라는
  //    존재한 적 없는 구성이 된다(모달은 추이 표의 어느 행에서도 열린다).
  // ⚠️ 상한에 `effectiveDateKey || getTodayKST()` — KR 계좌는 21:00~09:00에 그 값이 null이고
  //    `evalSeriesDates`는 null이면 미래 컷을 통째로 끄므로 21시 이후 찍힌 '내일' 스냅샷이
  //    후보 최상단에 뜬다.
  const compareCandidates = useMemo(() => {
    const histDates = (history || []).map(h => h?.date).filter(Boolean);
    const all = evalSeriesDates(portfolio, histDates, effectiveDateKey || getTodayKST());
    return all.filter(d => d < date).sort().reverse();
  }, [history, portfolio, effectiveDateKey, date]);

  // ⚠️ 선택된 비교일은 **파생값 + 사용자 덮어쓰기**다(state 초기값을 effect에서 고치지 말 것) —
  //    effect로 채우면 섹션을 열 때 한 프레임 동안 '만들 수 없습니다'가 번쩍이고, SSR·첫 렌더에서
  //    빈 날짜로 계산이 돌아간다(CLAUDE.md `RebalanceTargetRestoreModal`의 `viewOv`와 같은 규약).
  const compareDateEff = useMemo(
    () => (compareDate && compareCandidates.includes(compareDate)) ? compareDate : (compareCandidates[0] || ''),
    [compareDate, compareCandidates],
  );

  // 두 날짜의 간격(일). ⚠️ '연도가 다른가'로 재지 말 것 — 기준일이 그 해 첫 기록일이면
  //    기본 비교일이 전년 12/31이라 **사용자가 아무것도 만지지 않은 상태에서** 경고가 뜨고,
  //    가장 쓸모 있는 '작년 같은 달' 비교도 예외 없이 경고 대상이 된다. 실제 신호는 '연도'가
  //    아니라 '간격이 비정상적으로 큼'이다(사용자 사고는 2년, 약 881일).
  // ⚠️ UTC 산술 — `new Date('YYYY-MM-DD')`는 UTC 파싱이라 로컬 타임존에 따라 하루 밀린다.
  const compareGapDays = useMemo(() => {
    const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(compareDateEff || ''));
    const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!m1 || !m2) return 0;
    const u = (m) => Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Math.round((u(m2) - u(m1)) / 86400000);
  }, [compareDateEff, date]);
  // 1년(366일)을 넘으면 확인을 권한다 — YoY(365일)는 통과시킨다.
  const compareGapLarge = compareGapDays > 366;

  // ⚠️ 후보에 없는 날짜로는 절대 계산하지 않는다 — `resolveHoldings(p, '')`는 예외 대신
  //    baseline 스냅샷을 조용히 돌려줘 '비교일'이 엉뚱한 구성으로 둔갑한다.
  const compareModel = useMemo(() => {
    if (!showCompare || !compareDateEff || !compareCandidates.includes(compareDateEff)) return null;
    try {
      return buildEvalCompare({
        portfolio, accountType, basisDate: date, compareDate: compareDateEff,
        stockHistoryMap, indicatorHistoryMap: indicatorHistoryMap || {}, fxRate: fx,
        depositHistory, depositHistory2, perShareOverride: psDraft,
      });
    } catch (e) {
      // ⚠️ 조용히 삼키지 말 것 — 아래 화면이 '만들 수 없습니다'를 대신 알린다(모달 위에서는
      //    토스트가 가려지므로 인라인이 유일한 통로다).
      return null;
    }
  }, [showCompare, compareDateEff, compareCandidates, portfolio, accountType, date,
      stockHistoryMap, indicatorHistoryMap, fx, depositHistory, depositHistory2, psDraft]);

  // 주당분배금 입력 대상 = 두 날짜 중 한 번이라도 보유한 분배금 대상 종목.
  const divRows = useMemo(
    () => (compareModel?.rows || []).filter(r => r.dividendEligible && (r.basis?.held || r.compare?.held)),
    [compareModel],
  );

  // 미확인(= 모델이 값을 채택하지 못한) 칸 수 — 배지와 **같은 함수**로 센다(손복제 금지).
  const psUnknownCount = useMemo(() => {
    let n = 0;
    for (const r of divRows) {
      for (const side of ['basis', 'compare']) {
        if (!psCellLive(r, side)) continue; // 죽은 칸은 세지 않는다(카운트 부풀림 방지)
        const info = side === 'basis' ? r.basis?.perShare : r.compare?.perShare;
        if (PS_UNRESOLVED.includes(psBadgeOf(info, psDraft[side]?.[r.key]))) n++;
      }
    }
    return n;
  }, [divRows, psDraft]);

  // ⚠️ 토글 노출 조건에 `showDiv`·입력 이력을 함께 둔다 — 미확인 수만 보면 마지막 칸을 채우는
  //    순간 카운트가 0이 되어 **입력 중인 패널이 통째로 사라지고** 되돌릴 통로도 없어진다.
  const psHasDraft = useMemo(
    () => ['basis', 'compare'].some(s => Object.values(psDraft[s] || {}).some(v => v !== undefined && v !== '')),
    [psDraft],
  );
  const showDivToggle = divRows.length > 0 && (psUnknownCount > 0 || showDiv || psHasDraft);

  const setPs = (side, key, value) =>
    setPsDraft(p => ({ ...p, [side]: { ...p[side], [key]: value } }));

  const handleDownloadCompare = () => {
    if (!compareModel || !compareDateEff) return;
    setCompareError('');
    try {
      downloadEvalCompareXlsx({
        portfolio, accountType, basisDate: date, compareDate: compareDateEff,
        stockHistoryMap, indicatorHistoryMap: indicatorHistoryMap || {}, fxRate: fx,
        depositHistory, depositHistory2, perShareOverride: psDraft,
        accountName: portfolio?.name || portfolio?.title || '계좌',
        // 화면 요약과 **같은 모델**을 그대로 넘긴다 — 다시 계산하면 두 값이 갈릴 수 있다.
        result: compareModel,
      });
      setXlsxFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setXlsxFlash(false), 1500);
    } catch (e) {
      // ⚠️ `notify()`를 쓰지 말 것 — 이 모달은 z=1000이라 토스트가 가려지고, 알림 최소화
      //    정책상 성공은 벨에도 남기지 않는다. 실패 사유는 **모달 내부 인라인**으로만 알린다.
      setCompareError('엑셀을 만들지 못했습니다: ' + String((e && e.message) || e));
    }
  };

  const handleDragStart = (e) => {
    if (e.button !== 0 || isMobile) return;
    e.preventDefault();
    dragRef.current = { active: true, ox: e.clientX - pos.x, oy: e.clientY - pos.y };
    const onMove = (ev) => {
      if (!dragRef.current.active) return;
      const nx = ev.clientX - dragRef.current.ox;
      const ny = ev.clientY - dragRef.current.oy;
      setPos({
        x: Math.max(0, Math.min(Math.max(0, window.innerWidth - modalWidth), nx)),
        y: Math.max(0, Math.min(Math.max(0, window.innerHeight - 80), ny)),
      });
    };
    const onUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const resolved = useMemo(() => resolveHoldings(portfolio, date), [portfolio, date]);

  // 행별 표시값: 원본 보유항목 순서 = withManualSnapshot 내부 정규화 순서와 동일(인덱스 정합).
  // 종가/출처는 수량1 프로브, 평가금은 실제 수량 계산(펀드 currentPrice/evalAmount 폴백 보존).
  const rows = useMemo(() => (resolved.items || []).map((item) => {
    const realQty = cleanNum(item.quantity);
    const probe = calcPortfolioEvalDetail(
      [{ ...item, quantity: realQty || 1 }],
      accountType, date, stockHistoryMap, indicatorHistoryMap || {}, fx, mpo,
    );
    const pd = probe.items[0] || {};
    const real = calcPortfolioEvalDetail(
      [item], accountType, date, stockHistoryMap, indicatorHistoryMap || {}, fx, mpo,
    );
    const rd = real.items[0];
    return {
      item,
      isDeposit: item.type === 'deposit',
      isFund: item.type === 'fund',
      isSavings: item.type === 'savings',
      name: item.type === 'deposit' ? '예수금' : (() => {
        const code = item.code || '';
        const codeStripped = code.replace(/^MA:/i, '');
        const snapName = item.name;
        // 스냅샷 항목 이름이 비어있거나 코드와 같은 경우 현재 포트폴리오에서 최신 이름 보완
        if (!snapName || snapName === code || snapName === codeStripped) {
          const liveItem = (portfolio?.portfolio || []).find((pi: any) => pi.code === code && pi.type === item.type);
          const liveName = liveItem?.name;
          if (liveName && liveName !== code && liveName !== codeStripped) return liveName;
        }
        return snapName || (isGold ? 'KRX 금현물' : (code ? codeStripped : '—'));
      })(),
      quantity: realQty,
      price: pd.price ?? null,
      source: pd.source || 'none',
      evalAmt: rd ? rd.eval : 0,
    };
  }), [resolved, accountType, date, stockHistoryMap, indicatorHistoryMap, fx, mpo, isGold]);

  const isOverseas = accountType === 'overseas';

  const recomputedResult = useMemo(
    () => calcPortfolioEvalDetail(resolved.items, accountType, date, stockHistoryMap, indicatorHistoryMap || {}, fx, mpo),
    [resolved, accountType, date, stockHistoryMap, indicatorHistoryMap, fx, mpo],
  );
  const recomputed = recomputedResult.total;
  const histFxRate = isOverseas ? (recomputedResult.fxRate || fx) : 1;

  const stored = cleanNum(record.evalAmount);
  const diffRatio = stored > 0 ? Math.abs(recomputed - stored) / stored : (recomputed > 0 ? 1 : 0);
  // 해외계좌: 저장된 KRW는 기록 시점 라이브 환율로 박제된 캐시 → 날짜별 환율 재계산값(recomputed)이 권위.
  // 환율 변동분만으로 생기는 KRW 차이를 '불일치'로 오판하지 않도록 USD 재계산 성공 여부로 상태 판단.
  const matched = isOverseas ? recomputed > 0 : (recomputed > 0 && diffRatio < 0.001);

  const depositsOnDate = useMemo(
    () => (depositHistory || []).filter(d => d.date === date),
    [depositHistory, date],
  );
  const withdrawalsOnDate = useMemo(
    () => (depositHistory2 || []).filter(w => w.date === date),
    [depositHistory2, date],
  );

  const principalAtDate = useMemo(() => {
    const base = cleanNum(portfolio?.principal ?? 0);
    const depositsAfter = (depositHistory || [])
      .filter(d => (d.date || '') > date && !d.noPrincipal)
      .reduce((s, d) => s + cleanNum(d.amount), 0);
    const withdrawalsAfter = (depositHistory2 || [])
      .filter(w => (w.date || '') > date && !w.noPrincipal)
      .reduce((s, w) => s + (w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount)), 0);
    return Math.max(0, base - depositsAfter + withdrawalsAfter);
  }, [portfolio, depositHistory, depositHistory2, date]);

  const hasCashFlow = depositsOnDate.length > 0 || withdrawalsOnDate.length > 0;
  const effective = useMemo(
    () => computeEffectivePrincipal(date, history || [], depositHistory, depositHistory2, isOverseas),
    [date, history, depositHistory, depositHistory2, isOverseas],
  );
  const isAnchorDay = !!effective.anchor && effective.anchor.date === date;
  const isPropagated = !!effective.anchor && effective.anchor.date !== date;
  const autoPrincipal = principalAtDate > 0 ? principalAtDate : cleanNum(record.principal ?? 0);
  const principalOnDate = effective.value != null ? effective.value : autoPrincipal;

  const depositsOnDateAffecting = depositsOnDate.filter(d => !d.noPrincipal);
  const withdrawalsOnDateAffecting = withdrawalsOnDate.filter(w => !w.noPrincipal);
  const totalDepositsOnDate = depositsOnDateAffecting.reduce((s, d) => s + cleanNum(d.amount), 0);
  const totalWithdrawalsOnDate = withdrawalsOnDateAffecting.reduce(
    (s, w) => s + (w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount)), 0,
  );
  const principalBefore = principalOnDate - totalDepositsOnDate + totalWithdrawalsOnDate;
  const showFormula = (depositsOnDateAffecting.length > 0 || withdrawalsOnDateAffecting.length > 0) && !effective.anchor;
  const multiLineFormula = depositsOnDateAffecting.length + withdrawalsOnDateAffecting.length > 1;
  const fmtPrin = (n) => isOverseas ? `$${Math.round(n).toLocaleString('en-US')}` : formatCurrency(Math.round(n));

  // ⚠️ try/finally 필수 — 없으면 refetchStockHistory가 던졌을 때 스피너 해제가 건너뛰어져
  //    그 종목의 ⟳가 모달을 닫을 때까지 영구히 회전한다(해외 분기 추가로 실패 모드가 늘었다).
  // ⚠️ 펀드는 아직 전용 분기가 없으므로 market을 넘기지 않아 기존 국내 체인으로 떨어뜨린다 —
  //    존재하지 않는 분기('fund')로 값을 먼저 흘리면 @ts-nocheck라 아무도 잡아 주지 않는다.
  const handleRefetch = async (code: string, market?: 'us' | 'kr') => {
    if (!code || !refetchStockHistory || refetchingCodes.has(code)) return;
    setRefetchingCodes(prev => new Set(prev).add(code));
    let ok = false;
    try {
      ok = await refetchStockHistory(code, market);
    } finally {
      setRefetchingCodes(prev => { const n = new Set(prev); n.delete(code); return n; });
    }
    if (!ok) notify(`${code} 종가 데이터를 찾을 수 없습니다 (신규 상장 또는 API 일시 불가)`, 'warning');
  };

  const commitQty = (idx) => {
    const v = cleanNum(editQtyRaw);
    setEditQtyIdx(-1);
    if (v < 0) return;
    patchActivePortfolio(p => withManualSnapshot(p, date, items =>
      items.map((it, i) => i === idx ? { ...it, quantity: v } : it)));
  };

  const commitPrice = (idx) => {
    const row = rows[idx];
    const key = overrideKeyFor(row.item, isGold);
    setEditPriceIdx(-1);
    if (!key) { notify('이 종목은 종가를 수동입력할 수 없습니다 (코드 없음)', 'warning'); return; }
    const v = cleanNum(editPriceRaw);
    patchActivePortfolio(p => {
      const cur = p.manualPriceOverrides || {};
      const forKey = { ...(cur[key] || {}) };
      if (v > 0) forKey[date] = v;
      else delete forKey[date];
      return { ...p, manualPriceOverrides: { ...cur, [key]: forKey } };
    });
  };

  const commitPrincipal = () => {
    const v = cleanNum(editPrincipalRaw);
    setEditPrincipal(false);
    setHistory(hist => hist.map(item => {
      if (!(item.id ? item.id === record.id : item.date === date)) return item;
      if (v > 0) return { ...item, principal: v, principalManual: true };
      const next = { ...item };
      delete next.principalManual;
      return next;
    }));
  };

  // 적용 중인 anchor의 principalManual 플래그 해제 — 이 anchor에 의해 보정 중이던 모든 날짜가
  // 입출금 누적값으로 복귀. 다른 anchor가 있으면 그 anchor 기준으로 다시 전파.
  const revertCorrection = () => {
    const anchorDate = effective.anchor?.date;
    if (!anchorDate) return;
    setHistory(hist => hist.map(item => {
      if (item.date !== anchorDate) return item;
      const next = { ...item };
      delete next.principalManual;
      return next;
    }));
  };

  const removeRow = (idx) => {
    patchActivePortfolio(p => withManualSnapshot(p, date, items => items.filter((_, i) => i !== idx)));
  };

  const submitAdd = () => {
    const qty = cleanNum(addForm.quantity);
    const code = addForm.code.trim();
    const name = addForm.name.trim();
    const start = addForm.start;
    const end = addForm.end;
    if (qty <= 0) { notify('보유수량을 입력하세요', 'warning'); return; }
    if (!code && !name) { notify('종목코드 또는 종목명을 입력하세요', 'warning'); return; }
    if (!start) { notify('보유시작일을 입력하세요', 'warning'); return; }
    if (end && end < start) { notify('보유종료일은 시작일 이후여야 합니다', 'warning'); return; }
    const newItem = { code, name, type: addForm.type, quantity: qty, investAmount: 0, depositAmount: 0 };
    const sameAs = (i) => i.code === code && i.type === addForm.type && i.name === name;
    patchActivePortfolio(p => {
      let np = withManualSnapshot(p, start, items => {
        const without = items.filter(i => !sameAs(i));
        return [...without, newItem];
      });
      if (end) {
        np = withManualSnapshot(np, end, items => items.filter(i => !sameAs(i)));
      }
      return np;
    });
    setShowAdd(false);
    setAddForm({ code: '', name: '', type: 'stock', quantity: '', start: date, end: '' });
  };

  const isToday = date === effectiveDateKey;

  const confirm = () => {
    if (recomputed <= 0) { notify('재계산 합계가 0원입니다 — 종가/수량을 확인하세요', 'warning'); return; }
    const v = Math.round(recomputed);
    setHistory(hist => hist.map(item => {
      if (!(item.id ? item.id === record.id : item.date === date)) return item;
      const next = { ...item, evalAmount: v, adjustedAmount: v, isFixed: true };
      delete next.autoConfirmDeclined; // 수동 확정 시 자동확정 거부 플래그 해제
      return next;
    }));
    onClose();
  };

  const unconfirm = () => {
    setHistory(hist => hist.map(item => {
      if (!(item.id ? item.id === record.id : item.date === date)) return item;
      // autoConfirmDeclined: 앱 실행 시 자동확정(useAutoConfirmHistory)이 이 날짜를 재확정하지 못하게 박제
      const next = { ...item, isFixed: false, autoConfirmDeclined: true };
      delete next.adjustedAmount;
      return next;
    }));
    onClose();
  };

  const fmtPrice = (n) => (n == null ? '—' : Math.round(n).toLocaleString());

  return (
    <div className="fixed inset-0" style={{ zIndex: Z.dialog }} onMouseDown={onClose} onTouchStart={onClose}>
      <div
        className="fixed border rounded-xl shadow-2xl flex flex-col"
        style={{ width: modalWidth, top: pos.y, left: pos.x, backgroundColor: BG.card, borderColor: '#4b5563', maxHeight: `calc(100vh - ${pos.y + 16}px)` }}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
      >
        <div
          className={`flex items-center justify-between px-3 py-2 border-b ${BORDER.default} ${isMobile ? '' : 'cursor-move'} select-none`}
          onMouseDown={handleDragStart}
        >
          <button onClick={onClose} className="text-pink-500 hover:text-pink-300"><X size={14} /></button>
          <span className="text-xs text-gray-300 font-bold">자산 검증 · {formatShortDate(date)}</span>
          <button
            onClick={() => setShowHelp(s => !s)}
            onMouseDown={e => e.stopPropagation()}
            className={`text-gray-500 hover:text-sky-400 transition-colors ${showHelp ? 'text-sky-400' : ''}`}
            title="저장된 평가자산 vs 재계산 합계 설명"
          ><HelpCircle size={14} /></button>
        </div>

        {showHelp && (
          <div className="border-b border-gray-700/60 px-3 py-3 bg-gray-900/60 text-[10px] leading-relaxed">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-gray-500">
                  <th className="py-1 pr-2 font-normal w-[72px]" />
                  <th className="py-1 px-2 font-bold text-gray-300 border-l border-gray-700">저장된 평가자산</th>
                  <th className="py-1 px-2 font-bold text-gray-300 border-l border-gray-700">재계산 합계</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-t border-gray-700/50">
                  <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">기준</td>
                  <td className="py-1 px-2 border-l border-gray-700">앱이 마지막으로 열렸을 때 API 가격</td>
                  <td className="py-1 px-2 border-l border-gray-700">지금 이 순간 종가 이력 × 수량</td>
                </tr>
                <tr className="border-t border-gray-700/50">
                  <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">언제 갱신</td>
                  <td className="py-1 px-2 border-l border-gray-700">앱 열 때마다 자동 갱신 (미확정 상태)</td>
                  <td className="py-1 px-2 border-l border-gray-700">모달 열 때마다 항상</td>
                </tr>
                <tr className="border-t border-gray-700/50">
                  <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">사용자 개입</td>
                  <td className="py-1 px-2 border-l border-gray-700">없음 (자동)</td>
                  <td className="py-1 px-2 border-l border-gray-700">없음 (자동)</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-gray-500 leading-snug">
              <span className="text-emerald-400 font-bold">수량×종가로 확정</span> 버튼을 누르면 현재 재계산값이 확정 저장되며, 이후 앱을 열어도 자동으로 덮어쓰지 않습니다. <span className="text-gray-600">확정 취소 시 다시 자동 갱신됩니다.</span>
            </p>
          </div>
        )}
        <div className={`${isMobile ? 'p-3' : 'p-4'} space-y-3 text-[11px] leading-relaxed overflow-y-auto flex-1 min-h-0`}>

          {resolved.estimated && (
            <div className="bg-amber-900/30 border border-amber-700/50 rounded px-3 py-1.5 text-amber-300 font-bold">
              🟡 추정 (보유수량 미확정) — 이 날짜의 구성을 확정하려면 수량을 검토·편집하세요.
            </div>
          )}

          <div className="rounded border border-gray-700/60 overflow-x-auto -mx-1 sm:mx-0">
            <table className={`w-full text-right ${isMobile ? 'text-[10px] min-w-[440px]' : 'text-[11px]'} border-collapse`}>
              <thead className="bg-gray-800 text-gray-400">
                <tr>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} text-left font-normal border-r border-gray-700`}>종목</th>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} font-normal border-r border-gray-700`}>보유수량</th>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} font-normal border-r border-gray-700`}>종가</th>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} text-center font-normal border-r border-gray-700`}>출처</th>
                  <th className={`py-1.5 ${isMobile ? 'px-1.5' : 'px-2'} font-normal border-r border-gray-700`}>평가금</th>
                  <th className="py-1.5 px-1 font-normal w-[28px]" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-gray-500">보유 종목이 없습니다.</td></tr>
                )}
                {rows.map((r, idx) => {
                  const badge = SOURCE_BADGE[r.source] || SOURCE_BADGE.none;
                  const cellPad = isMobile ? 'px-1.5' : 'px-2';
                  return (
                    <tr key={idx} className="border-t border-gray-700/60 hover:bg-gray-800/40">
                      <td className={`py-1.5 ${cellPad} text-left text-gray-200`}>{r.name}</td>
                      <td className={`py-1.5 ${cellPad} text-gray-300`}>
                        {r.isDeposit || r.isSavings ? '—' : editQtyIdx === idx ? (
                          <input
                            autoFocus
                            className="w-[72px] bg-gray-900 border border-blue-500 rounded px-1 py-0.5 text-right text-gray-100 outline-none"
                            value={editQtyRaw}
                            onChange={e => setEditQtyRaw(e.target.value)}
                            onBlur={() => commitQty(idx)}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditQtyIdx(-1); }}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1 justify-end">
                            {r.quantity.toLocaleString()}
                            <button
                              className="text-gray-500 hover:text-blue-400"
                              title="보유수량 편집"
                              onClick={() => { setEditQtyIdx(idx); setEditQtyRaw(String(r.quantity)); }}
                            ><Pencil size={11} /></button>
                          </span>
                        )}
                      </td>
                      <td className={`py-1.5 ${cellPad} text-gray-300`}>
                        {r.isDeposit || r.isSavings ? '—' : editPriceIdx === idx ? (
                          <input
                            autoFocus
                            className="w-[84px] bg-gray-900 border border-blue-500 rounded px-1 py-0.5 text-right text-gray-100 outline-none"
                            value={editPriceRaw}
                            placeholder="0=해제"
                            onChange={e => setEditPriceRaw(e.target.value)}
                            onBlur={() => commitPrice(idx)}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditPriceIdx(-1); }}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1 justify-end">
                            {r.isFund ? (r.price == null ? '—' : formatFundPrice(r.price)) : fmtPrice(r.price)}
                            <button
                              className="text-gray-500 hover:text-blue-400"
                              title="종가 수동입력 (manualPriceOverrides)"
                              onClick={() => { setEditPriceIdx(idx); setEditPriceRaw(r.price != null ? String(Math.round(r.price)) : ''); }}
                            ><Pencil size={11} /></button>
                          </span>
                        )}
                      </td>
                      <td className={`py-1.5 ${cellPad} text-center font-bold whitespace-nowrap ${badge.cls}`}>
                        <span className="inline-flex items-center gap-1 justify-center">
                          {badge.label}
                          {(r.source === 'none' || r.source === 'approximate') && !r.isDeposit && r.item?.code && refetchStockHistory && (
                            <button
                              className="text-gray-500 hover:text-sky-400 disabled:opacity-40 transition-colors"
                              title={`${r.item.code} 종가 재조회 (${isOverseas && !r.isFund ? 'Yahoo → KIS 해외 → Naver' : 'KIS → Naver'})`}
                              disabled={refetchingCodes.has(r.item.code)}
                              onClick={() => handleRefetch(r.item.code, r.isFund ? undefined : (isOverseas ? 'us' : 'kr'))}
                            >
                              <RefreshCw size={11} className={refetchingCodes.has(r.item.code) ? 'animate-spin' : ''} />
                            </button>
                          )}
                        </span>
                      </td>
                      <td className={`py-1.5 ${cellPad} text-gray-200 font-bold whitespace-nowrap`}>
                        {isOverseas && histFxRate > 1
                          ? `$${(r.evalAmt / histFxRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                          : formatCurrency(r.evalAmt)}
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        {!r.isDeposit && !r.isSavings && (
                          <button className="text-gray-600 hover:text-red-400" title="이 날짜에서 종목 제거" onClick={() => removeRow(idx)}>
                            <Trash2 size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <button
              className="text-[11px] text-gray-400 hover:text-sky-400 font-bold inline-flex items-center gap-1"
              onClick={() => setShowAdd(s => !s)}
            >
              <Plus size={12} /> 종목 추가 {showAdd ? '▲' : '▼'}
            </button>
            {showAdd && (
              <div className="mt-2 bg-gray-800/40 border border-gray-700/60 rounded p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" placeholder="종목코드" value={addForm.code} onChange={e => setAddForm(f => ({ ...f, code: e.target.value }))} />
                  <input className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" placeholder="종목명" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
                  <select className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="stock">주식/ETF</option>
                    <option value="fund">펀드</option>
                  </select>
                  <input className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-right text-gray-200 outline-none" placeholder="보유수량" value={addForm.quantity} onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-0.5 text-gray-500">보유시작일
                    <input type="date" className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" value={addForm.start} onChange={e => setAddForm(f => ({ ...f, start: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-0.5 text-gray-500">보유종료일 (선택)
                    <input type="date" className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none" value={addForm.end} onChange={e => setAddForm(f => ({ ...f, end: e.target.value }))} />
                  </label>
                </div>
                <button className="w-full py-1.5 bg-sky-700/60 hover:bg-sky-600/60 text-sky-100 rounded font-bold" onClick={submitAdd}>추가</button>
              </div>
            )}
          </div>

          {/* ── 두 날짜 비교 · 엑셀 ────────────────────────────────────────────
              기준일(= 이 모달의 날짜)과 비교일을 맞대어 ① 기준일 ② 비교일 ③ 증감
              ④ 반사실(비교일 수량을 그대로 들고 있었다면)을 만든다.
              ⚠️ 전부 읽기 전용 파생값이다 — 계좌에 아무것도 쓰지 않는다(카드 별도 창에서도 동작). */}
          <div className="pt-1 border-t border-gray-700/60">
            <button
              className="text-[11px] text-gray-400 hover:text-emerald-300 font-bold inline-flex items-center gap-1"
              onClick={() => setShowCompare(s => !s)}
            >
              <FileSpreadsheet size={12} /> 다른 날짜와 비교 · 엑셀 {showCompare ? '▲' : '▼'}
            </button>
            {showCompare && (
              <div className="mt-2 bg-gray-800/40 border border-gray-700/60 rounded p-3 space-y-2">
                {compareCandidates.length === 0 ? (
                  <div className="text-[10px] text-gray-500 text-center py-1 leading-relaxed">
                    비교할 이전 기록일이 없습니다.<br />
                    {formatShortDate(date).split(' ')[0]} 이전의 기록이 있어야 비교할 수 있습니다.
                  </div>
                ) : (
                  <>
                    {/* ⚠️ 드롭다운으로 되돌리지 말 것(사용자 요청 2026-08) — 옛 `<select>`는 항목이
                        `24/04/01 (월)`처럼 **2자리 연도**로 한 줄씩 늘어서 있어, 2년 떨어진 같은
                        월/일을 실제로 잘못 골랐다(비교 결과가 통째로 다른 해로 계산됐다).
                        ⚠️ 방어력의 출처를 오해하지 말 것 — 시장 계좌는 `fillNonTradingGaps`·백필
                        치유로 주말·공휴일까지 기록이 차서 **월·일 그리드의 잠금은 거의 발동하지
                        않는다**(실측: 매일 기록이 있는 계좌에서 연 9/12만 잠기고 월·일은 0). 실제로
                        막아 주는 것은 ① 연 → 월 → 일로 **연도를 명시적으로 클릭하게 만드는 드릴다운**
                        ② 트리거·요약의 **4자리 연도** ③ 간격이 1년을 넘으면 뜨는 경고, 이 셋이다. */}
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 whitespace-nowrap">비교일</span>
                      <div className="flex-1">
                        <CustomDatePicker
                          value={compareDateEff}
                          onChange={d => setCompareDate(d)}
                          allowedDates={compareCandidates}
                          align="left"
                          followScroll
                          trigger={(
                            <button
                              type="button"
                              title="달력에서 비교일을 고릅니다 — 기록이 있는 날짜만 선택할 수 있습니다"
                              className={`w-full flex items-center justify-between gap-2 bg-gray-900 border rounded px-2 py-1 outline-none transition-colors hover:border-emerald-500 ${compareGapLarge ? 'border-amber-500/70' : 'border-gray-600'}`}
                            >
                              {/* ⚠️ 연도를 4자리로 보여 준다 — 오선택의 발단이 2자리 연도였다.
                                  엑셀 캡션과 **같은 포매터**라 두 화면의 표기가 갈리지 않는다. */}
                              <span className={`font-mono ${compareGapLarge ? 'text-amber-300' : 'text-gray-200'}`}>
                                {compareDateEff ? dateLabel(compareDateEff) : '날짜 선택'}
                              </span>
                              <Calendar size={12} className="text-gray-500 shrink-0" />
                            </button>
                          )}
                        />
                      </div>
                    </div>
                    {compareGapLarge && (
                      <div className="text-[10px] text-amber-400/90 leading-snug">
                        ⚠ 기준일보다 <b>{compareGapDays.toLocaleString()}일</b>(약 {(compareGapDays / 365).toFixed(1)}년) 이전입니다 — 의도한 날짜인지 확인하세요.
                      </div>
                    )}

                    {!compareModel && (
                      <div className="text-[10px] text-amber-400 leading-snug">
                        이 날짜 조합으로는 비교표를 만들 수 없습니다 — 다른 비교일을 골라 보세요.
                      </div>
                    )}
                    {compareModel && (
                      <div className="bg-gray-900/50 rounded px-2 py-1.5 space-y-0.5 text-[10px]">
                        <div className="flex justify-between">
                          <span className="text-gray-500">기준일 {date}</span>
                          <span className="text-gray-100 font-bold">{fmtPrin(compareModel.totals.basis.evalNative)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">비교일 {compareDateEff}</span>
                          <span className="text-gray-300">{fmtPrin(compareModel.totals.compare.evalNative)}</span>
                        </div>
                        <div className="flex justify-between">
                          {/* ⚠️ '수익률'이라 부르지 말 것 — 이 값은 총자산 레벨의 단순 비교라
                              입출금이 포함돼 있고, 같은 두 날짜에 대해 추이 표의 기간 수익률과 다르다. */}
                          <span className="text-gray-500">평가금액 증감율 <span className="text-gray-600">(입출금 포함)</span></span>
                          <span className={compareModel.diffRate == null ? 'text-gray-500' : compareModel.diffRate >= 0 ? 'text-red-400 font-bold' : 'text-blue-400 font-bold'}>
                            {compareModel.diffRate == null ? '-' : `${compareModel.diffRate >= 0 ? '+' : ''}${formatPercent(compareModel.diffRate * 100)}`}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700/50 pt-0.5">
                          <span className="text-gray-500">반사실 <span className="text-gray-600">(비교일 수량 유지)</span></span>
                          <span className="text-purple-200 font-bold">
                            {fmtPrin(compareModel.totals.counter.evalNative)}
                            {compareModel.counterRate != null && (
                              <span className="text-gray-500 font-normal"> · {compareModel.counterRate >= 0 ? '+' : ''}{formatPercent(compareModel.counterRate * 100)}</span>
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">거래 효과 <span className="text-gray-600">(입출금 제외)</span></span>
                          {compareModel.tradeEffectValid ? (
                            <span className={compareModel.tradeEffect >= 0 ? 'text-red-400 font-bold' : 'text-blue-400 font-bold'}>
                              {compareModel.tradeEffect >= 0 ? '+' : '−'}{fmtPrin(Math.abs(compareModel.tradeEffect))}
                            </span>
                          ) : (
                            <span
                              className="text-amber-400"
                              title={compareModel.flowReflected
                                ? '기준일 종가를 구하지 못한 보유 종목이 있어 총액이 과소합니다'
                                : '원장의 입출금이 아직 평가액·예수금에 반영되지 않아 그 금액이 손익으로 잘못 잡힙니다'}
                            >산출 불가</span>
                          )}
                        </div>
                        {/* ⚠️ 게이트에 반사실을 포함할 것 — 배당 종목을 전량 매도하면 기준일 분배금이 0이라
                            "팔지 않았으면 받았을 분배금"이 정확히 그때 화면에서 사라진다(엑셀에는 남아 두 화면이 갈린다). */}
                        {(compareModel.totals.basis.dividend > 0 || compareModel.totals.counter.dividend > 0) && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">분배금 차이 <span className="text-gray-600">(기준일 − 반사실)</span></span>
                            <span className={compareModel.tradeEffectDividend >= 0 ? 'text-red-300' : 'text-blue-300'}>
                              {compareModel.tradeEffectDividend >= 0 ? '+' : '−'}{fmtPrin(Math.abs(compareModel.tradeEffectDividend))}
                              {compareModel.tradeEffectDividendPartial && <span className="text-amber-400/80"> (일부 미확인)</span>}
                            </span>
                          </div>
                        )}
                        {compareModel.netFlow !== 0 && (
                          <div className="text-[9px] text-amber-400/90 leading-snug pt-0.5">
                            이 기간 순입출금 {fmtPrin(Math.abs(compareModel.netFlow))} {compareModel.netFlow > 0 ? '입금' : '출금'} — 증감율에는 포함, 거래 효과에서는 제외했습니다.
                          </div>
                        )}
                        {!compareModel.flowReflected && (
                          <div className="text-[9px] text-amber-400/90 leading-snug">
                            ⚠ 원장의 입출금이 아직 평가액·예수금에 반영되지 않은 것으로 보입니다(입금일과 반영일이 다를 수 있습니다) — 거래 효과는 산출하지 않았습니다.
                          </div>
                        )}
                        {(compareModel.estimatedBasis || compareModel.estimatedCompare) && (
                          <div className="text-[9px] text-amber-400/90 leading-snug">🟡 보유수량이 추정인 날짜가 있어 수량 증감이 실제와 다를 수 있습니다.</div>
                        )}
                        {(compareModel.totals.basis.priceMissing || compareModel.totals.compare.priceMissing || compareModel.totals.counter.priceMissing) && (
                          <div className="text-[9px] text-amber-400/90 leading-snug">⚠ 그 날짜 종가를 구하지 못한 보유 종목이 있어 합계가 과소합니다.</div>
                        )}
                      </div>
                    )}

                    {showDivToggle && (
                      <div>
                        <button
                          className="text-[10px] text-gray-500 font-bold hover:text-gray-300 inline-flex items-center gap-1"
                          onClick={() => setShowDiv(v => !v)}
                          title="주당분배금을 직접 입력합니다 — 보유수량이 아니라 '1주당 분배액'이며, 비우면 자동값입니다(저장되지 않습니다)"
                        >
                          주당분배금
                          {psUnknownCount > 0 && <span className="font-normal text-amber-500/80">미확인 {psUnknownCount}</span>}
                          <span className="font-normal text-gray-600">{showDiv ? '▲' : '▼'}</span>
                        </button>
                        {showDiv && (<>
                        <div className="text-[9px] text-gray-600 leading-snug mt-1 mb-1">
                          세전 · 비우면 자동값 · 저장되지 않습니다 — 분배하지 않는 종목(TR·금 ETF 등)은{' '}
                          <span className="text-gray-400 font-bold">0</span>을 넣으면 '분배 없음'으로 확정됩니다.
                        </div>
                        <table className="w-full text-[10px] border-collapse">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left font-normal py-0.5">종목</th>
                              <th className="font-normal py-0.5 w-[78px]">기준일</th>
                              <th className="font-normal py-0.5 w-[78px]">비교일</th>
                            </tr>
                          </thead>
                          <tbody>
                            {divRows.map(r => (
                              <tr key={r.key} className="border-t border-gray-700/40 align-top">
                                <td className="text-left text-gray-300 py-1 pr-1">
                                  <div className="truncate max-w-[170px]" title={`${r.name} (${r.code})`}>{r.name}</div>
                                  <div className="text-[9px] text-gray-600">{r.code}</div>
                                </td>
                                {['basis', 'compare'].map(side => {
                                  const info = side === 'basis' ? r.basis?.perShare : r.compare?.perShare;
                                  const draft = psDraft[side][r.key];
                                  const auto = info && info.source !== 'manual' ? info.perShare : 0;
                                  // 배지·미확인 카운트는 `psBadgeOf` 한 함수를 공유한다(모듈 스코프).
                                  const live = psCellLive(r, side);
                                  const badge = live ? psBadgeOf(info, draft) : '해당 없음';
                                  return (
                                    <td key={side} className="py-1 px-0.5">
                                      <div className="flex flex-col items-end gap-0.5">
                                        <input
                                          className={`w-[72px] bg-gray-900 border rounded px-1 py-0.5 text-right outline-none ${live ? 'border-gray-600 text-gray-100 focus:border-emerald-500' : 'border-gray-700/50 text-gray-600 cursor-not-allowed'}`}
                                          value={live ? (draft ?? '') : ''}
                                          disabled={!live}
                                          title={live ? undefined : '비교일에 보유하지 않은 종목이라 이 칸의 값은 시트에 반영되지 않습니다'}
                                          placeholder={!live ? '—' : auto > 0 ? String(Math.round(auto * 10000) / 10000) : '입력'}
                                          onChange={e => setPs(side, r.key, e.target.value)}
                                        />
                                        <span className={`text-[9px] ${badge === '미확인' || badge === '무효 입력' ? 'text-amber-500/80' : 'text-gray-600'}`}>{badge}</span>
                                        {live && info && info.upcoming && (draft === undefined || draft === '') && (
                                          <button
                                            className="text-[9px] text-emerald-400/90 hover:text-emerald-300"
                                            title={`${info.upcoming.ym} 회차(아직 배당락 전)의 예상 주당분배금을 이 칸에 적용합니다`}
                                            onClick={() => setPs(side, r.key, String(info.upcoming.perShare))}
                                          >
                                            {info.upcoming.ym.slice(2)} 예상 {info.upcoming.perShare} 적용
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </>)}
                      </div>
                    )}

                    <button
                      className="w-full py-1.5 bg-emerald-700/60 hover:bg-emerald-600/60 disabled:bg-gray-700/50 disabled:text-gray-500 text-emerald-50 rounded font-bold inline-flex items-center justify-center gap-1"
                      disabled={!compareModel}
                      onClick={handleDownloadCompare}
                      title="① 기준일 ② 비교일 ③ 증감 ④ 반사실(거래하지 않았다면) 4블록 시트로 내려받습니다"
                    >
                      <FileSpreadsheet size={12} className={xlsxFlash ? 'text-emerald-200' : ''} />
                      {xlsxFlash ? '내려받았습니다' : '엑셀 다운로드'}
                    </button>
                    {compareError && <div className="text-[10px] text-red-400 leading-snug">{compareError}</div>}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-1 border-t border-gray-700/60">
            <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
              <div className="text-gray-500 text-[10px] font-bold mb-1">검증</div>
              {isOverseas && histFxRate > 1 && (
                <div className="text-gray-400 flex justify-between">
                  <span>당일 환율</span>
                  <span className="text-sky-300 font-bold">₩{Math.round(histFxRate).toLocaleString()}</span>
                </div>
              )}
              <div className="text-gray-400 flex justify-between">
                <span>재계산 합계 ({isOverseas ? '수량 × 종가' : '수량 × 종가'})</span>
                <span className="text-gray-200 font-bold">
                  {isOverseas && histFxRate > 1
                    ? `$${(recomputed / histFxRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                    : formatCurrency(recomputed)}
                </span>
              </div>
              {isOverseas && histFxRate > 1 && recomputed > 0 && (
                <div className="text-gray-400 flex justify-between">
                  <span>재계산 합계 (수량 × 종가 × 환율, ₩)</span>
                  <span className="text-gray-500">{formatCurrency(recomputed)}</span>
                </div>
              )}
              {!isOverseas && (
                <div className="text-gray-400 flex justify-between">
                  <span>저장된 평가자산</span>
                  <span className="text-gray-300 font-bold">{formatCurrency(stored)}</span>
                </div>
              )}
              {isOverseas && stored > 0 && (
                <div className="text-gray-500 flex justify-between text-[10px]">
                  <span>저장된 스냅샷 (기록시점 환율)</span>
                  <span>{formatCurrency(stored)}</span>
                </div>
              )}
              <div className="flex justify-between pt-0.5">
                <span className="text-gray-500">상태</span>
                <span className={`font-bold ${matched ? 'text-green-400' : 'text-amber-400'}`}>
                  {recomputed <= 0 ? '⚪ 데이터없음' : matched ? '✅ 일치' : `🔺 불일치 (차이 ${formatCurrency(Math.round(recomputed - stored))})`}
                </span>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded px-3 py-2 space-y-1">
              <div className="text-gray-500 text-[10px] font-bold mb-1">자금 현황</div>
              {!hasCashFlow && (
                <div className="text-gray-600 text-[10px] text-center py-0.5">이 날 입출금 없음</div>
              )}
              {depositsOnDate.map((d, i) => (
                <div key={d.id ?? i} className="flex justify-between items-center">
                  <span className="flex items-center gap-1">
                    <span className="text-emerald-400 font-bold text-[10px]">입금</span>
                    {d.noPrincipal && <span className="text-sky-400 text-[9px]">원금제외</span>}
                    {d.memo && <span className="text-gray-500 text-[9px] truncate max-w-[80px]">{d.memo}</span>}
                  </span>
                  <span className="text-emerald-300 font-bold">
                    +{isOverseas ? `$${cleanNum(d.amount).toLocaleString()}` : formatCurrency(cleanNum(d.amount))}
                  </span>
                </div>
              ))}
              {withdrawalsOnDate.map((w, i) => {
                const deducted = w.principalDeducted != null ? cleanNum(w.principalDeducted) : null;
                return (
                  <div key={w.id ?? i} className="flex justify-between items-center">
                    <span className="flex items-center gap-1">
                      <span className="text-red-400 font-bold text-[10px]">출금</span>
                      {w.noPrincipal
                        ? <span className="text-sky-400 text-[9px]">원금무영향</span>
                        : deducted != null && deducted !== cleanNum(w.amount)
                          ? <span className="text-amber-400 text-[9px]">원금차감 {isOverseas ? `$${deducted.toLocaleString()}` : formatCurrency(deducted)}</span>
                          : <span className="text-amber-400 text-[9px]">원금차감</span>
                      }
                      {w.memo && <span className="text-gray-500 text-[9px] truncate max-w-[60px]">{w.memo}</span>}
                    </span>
                    <span className="text-red-300 font-bold">
                      -{isOverseas ? `$${cleanNum(w.amount).toLocaleString()}` : formatCurrency(cleanNum(w.amount))}
                    </span>
                  </div>
                );
              })}
              <div className="border-t border-gray-700/50 mt-1 pt-1 space-y-0.5">
                <div className="text-gray-400 flex justify-between items-center">
                  <span className="inline-flex items-center gap-1">
                    {formatShortDate(date).split(' ')[0]} 투자원금
                    {isAnchorDay && <span className="text-red-400 text-[9px] font-bold">🔴 수동</span>}
                    {isPropagated && (
                      <span className="text-amber-400 text-[9px] font-bold" title={`${effective.anchor.date}의 수동 설정값에 입출금 변동 반영`}>
                        🟡 {formatShortDate(effective.anchor.date).split(' ')[0]} 보정
                      </span>
                    )}
                    {effective.anchor && (
                      <button
                        className="text-gray-500 hover:text-amber-400 inline-flex items-center gap-0.5 text-[9px] font-bold"
                        title={`${effective.anchor.date} 수동 설정 해제 (보정 적용 중인 날짜들이 입출금 누적값으로 복귀)`}
                        onClick={revertCorrection}
                      >
                        <RotateCcw size={9} /> 되돌리기
                      </button>
                    )}
                  </span>
                  {editPrincipal ? (
                    <input
                      autoFocus
                      className="w-[140px] bg-gray-900 border border-blue-500 rounded px-1 py-0.5 text-right text-gray-100 outline-none"
                      value={editPrincipalRaw}
                      placeholder="0=해제"
                      onChange={e => setEditPrincipalRaw(e.target.value)}
                      onBlur={commitPrincipal}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditPrincipal(false); }}
                    />
                  ) : showFormula && !multiLineFormula ? (
                    <span className="inline-flex items-center gap-1 text-[10px]">
                      <span className="text-gray-400">{fmtPrin(principalBefore)}</span>
                      {totalDepositsOnDate > 0 && (
                        <span className="text-emerald-400">+{fmtPrin(totalDepositsOnDate)}</span>
                      )}
                      {totalWithdrawalsOnDate > 0 && (
                        <span className="text-red-400">−{fmtPrin(totalWithdrawalsOnDate)}</span>
                      )}
                      <span className="text-gray-500">=</span>
                      <span className="text-sky-200 font-bold">{fmtPrin(principalOnDate)}</span>
                      <button
                        className="text-gray-500 hover:text-blue-400"
                        title={`${formatShortDate(date).split(' ')[0]} 투자원금 수동 입력`}
                        onClick={() => { setEditPrincipal(true); setEditPrincipalRaw(principalOnDate > 0 ? String(Math.round(principalOnDate)) : ''); }}
                      ><Pencil size={11} /></button>
                    </span>
                  ) : !showFormula ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-sky-200 font-bold">{fmtPrin(principalOnDate)}</span>
                      <button
                        className="text-gray-500 hover:text-blue-400"
                        title={`${formatShortDate(date).split(' ')[0]} 투자원금 수동 입력 (입출금 누적값 오버라이드)`}
                        onClick={() => { setEditPrincipal(true); setEditPrincipalRaw(principalOnDate > 0 ? String(Math.round(principalOnDate)) : ''); }}
                      ><Pencil size={11} /></button>
                    </span>
                  ) : null}
                </div>
                {showFormula && multiLineFormula && !editPrincipal && (
                  <div className="pl-2 space-y-0.5 text-[10px]">
                    <div className="flex justify-between text-gray-500">
                      <span>이전</span>
                      <span>{fmtPrin(principalBefore)}</span>
                    </div>
                    {depositsOnDateAffecting.length === 1 ? (
                      <div className="flex justify-between">
                        <span className="text-emerald-400">+ 입금</span>
                        <span className="text-emerald-300">{fmtPrin(cleanNum(depositsOnDateAffecting[0].amount))}</span>
                      </div>
                    ) : depositsOnDateAffecting.length > 1 ? (
                      <div className="flex justify-between">
                        <span className="text-emerald-400">+ 입금 합계</span>
                        <span className="text-emerald-300">{fmtPrin(totalDepositsOnDate)}</span>
                      </div>
                    ) : null}
                    {withdrawalsOnDateAffecting.length === 1 ? (() => {
                      const deducted = withdrawalsOnDateAffecting[0].principalDeducted != null ? cleanNum(withdrawalsOnDateAffecting[0].principalDeducted) : cleanNum(withdrawalsOnDateAffecting[0].amount);
                      return (
                        <div className="flex justify-between">
                          <span className="text-red-400">− 출금</span>
                          <span className="text-red-300">{fmtPrin(deducted)}</span>
                        </div>
                      );
                    })() : withdrawalsOnDateAffecting.length > 1 ? (
                      <div className="flex justify-between">
                        <span className="text-red-400">− 출금 합계</span>
                        <span className="text-red-300">{fmtPrin(totalWithdrawalsOnDate)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between items-center border-t border-gray-700/40 pt-0.5">
                      <span className="text-gray-500">=</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-sky-200 font-bold text-[11px]">{fmtPrin(principalOnDate)}</span>
                        <button
                          className="text-gray-500 hover:text-blue-400"
                          title={`${formatShortDate(date).split(' ')[0]} 투자원금 수동 입력`}
                          onClick={() => { setEditPrincipal(true); setEditPrincipalRaw(principalOnDate > 0 ? String(Math.round(principalOnDate)) : ''); }}
                        ><Pencil size={11} /></button>
                      </span>
                    </div>
                  </div>
                )}
                {(isOverseas ? recomputed > 0 : stored > 0) && (
                  <div className="text-gray-400 flex justify-between">
                    <span>{isOverseas ? '평가자산 (재계산)' : '저장 평가자산'}</span>
                    <span className="text-gray-200 font-bold">
                      {isOverseas && histFxRate > 1
                        ? `$${(recomputed / histFxRate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                        : formatCurrency(stored)}
                    </span>
                  </div>
                )}
                {principalOnDate > 0 && (isOverseas ? recomputed > 0 : stored > 0) && (() => {
                  const gain = isOverseas && histFxRate > 1
                    ? recomputed / histFxRate - principalOnDate
                    : stored - principalOnDate;
                  return (
                    <div className="flex justify-between">
                      <span className="text-gray-500">평가손익</span>
                      <span className={`font-bold ${gain >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {gain >= 0 ? '+' : ''}
                        {isOverseas && histFxRate > 1
                          ? `$${Math.round(gain).toLocaleString('en-US')}`
                          : formatCurrency(Math.round(gain))}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="flex-1 py-2 bg-emerald-700/70 hover:bg-emerald-600/70 disabled:bg-gray-700/50 disabled:text-gray-500 text-emerald-50 rounded font-bold tracking-wide"
                disabled={recomputed <= 0 || isToday}
                onClick={confirm}
              >
                수량*종가로 확정
              </button>
              {record.isFixed && (
                <button
                  className="px-3 py-2 bg-gray-700/70 hover:bg-amber-800/60 text-gray-300 hover:text-amber-200 rounded font-bold tracking-wide text-[11px] whitespace-nowrap"
                  onClick={unconfirm}
                >
                  확정 취소
                </button>
              )}
            </div>
            {isToday
              ? <div className="text-[10px] text-amber-600 text-center">오늘 날짜는 종가 미확정 — 장 마감 후 자동 고정됩니다</div>
              : <div className="text-[10px] text-gray-600 text-center">확정 시에만 평가자산 기록이 갱신됩니다 — 자동 덮어쓰기 없음</div>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
