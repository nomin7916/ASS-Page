// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Lock, HelpCircle, X, Save, ChevronDown, ChevronUp, RotateCcw, Calculator, BookOpen, Plus, Maximize2, Trash2, Check, CalendarClock } from 'lucide-react';
import { UI_CONFIG } from '../config';
import { MARK_ROW_BG, MARK_STICKY_BG } from '../constants';
import { cleanNum, formatCurrency, formatNumber, formatChangeRate, handleTableKeyDown, handleReadonlyCellNav, savingsEval, generateId, isValidIsoDate, applyRebalTargetRatios, resolveTargetSlots } from '../utils';
import { PieLabelOutside } from '../chartUtils';
import { getTodayKST } from '../hooks/useMarketCalendar';
import RebalanceTargetPinModal from './RebalanceTargetPinModal';
import RebalanceTargetRestoreModal from './RebalanceTargetRestoreModal';
import LadderBuyModal from './LadderBuyModal';

const SAFE_CATEGORIES = ['채권', '현금', '예수금'];
const getItemUrl = (item) => {
  if (!item.code) return null;
  if (item.type === 'fund') return `https://www.funetf.co.kr/product/fund/view/${item.code}`;
  if (/^\d/.test(item.code)) return `https://m.stock.naver.com/domestic/stock/${item.code}/total`;
  if (/^[A-Za-z]+$/.test(item.code)) return `https://finance.yahoo.com/quote/${item.code.toUpperCase()}`;
  return null;
};
const getAssetClass = (item) => (item.type === 'fund' || item.type === 'savings')
  ? (item.assetClass ?? 'S')
  : (item.assetClass ?? (SAFE_CATEGORIES.includes(item.category) ? 'S' : 'D'));

// ── (₩) 목표금액 라이브 미러가 쓰는 '현재 평가금' ──
// ⚠️ 시세가 아직 안 들어온 보유분(qty>0인데 현재가 0 · 펀드는 저장 평가금까지 0)은 **null을 돌려
//    그 행을 건너뛴다** — 0을 목표금액으로 박아 두면 나중에 시세가 들어온 순간 '목표 0원 = 전량 매도'가
//    되어 사용자가 지시한 적 없는 전량 청산 계획이 조용히 만들어진다. 라이브 미러(on) 자체는 매 렌더
//    재계산이라 안전하고, 위험한 것은 시드/해제의 **write**뿐이라 여기서만 막으면 된다.
// ⚠️ 예적금(savings)은 시세·수량이 없어 매매 대상이 아니고 목표금액 셀도 읽기 전용이라 제외한다
//    (쓰면 화면 어디에도 안 보이는 값만 Drive에 쌓인다). 예수금(deposit) 행도 대상 아님.
// ⚠️ 해외계좌는 targetAmount도 USD라 환율을 곱하지 않는다(원화 환산 금지 — 환율 시점이 섞인다).
const mirrorEvalOf = (p) => {
  if (!p || (p.type !== 'stock' && p.type !== 'fund')) return null;
  const qty = cleanNum(p.quantity);
  const price = cleanNum(p.currentPrice);
  if (p.type === 'fund') {
    const ev = (qty > 0 && price > 0) ? price * qty : cleanNum(p.evalAmount);
    return (qty > 0 && !(ev > 0)) ? null : ev;
  }
  return (qty > 0 && !(price > 0)) ? null : price * qty;
};
// 저장값은 표시 문자열과 왕복(round-trip)이 되도록 정리한다 — 원화 1원 / 외화 1센트.
// 안 하면 formatNumber(소수 3자리 반올림) 때문에 셀을 탭으로 지나가기만 해도 '변경'으로 오판된다.
const roundMirrorAmt = (v, isOverseas) => (isOverseas ? Math.round(v * 100) / 100 : Math.round(v));

const RB_COLS = [
  { key: 'category', label: '구분' },
  { key: 'changeRate', label: '등락률' },
  { key: 'returnRate', label: '수익률' },
  { key: 'name', label: '종목명' },
  { key: 'code', label: '코드' },
  { key: 'curEval', label: '평가금' },
  { key: 'currentPrice', label: '현재가' },
  { key: 'targetRatio', label: '목표비중' },
  { key: 'targetAmount', label: '목표금액' },
  { key: 'curRatio', label: '현재비중' },
  { key: 'action', label: '수량' },
  { key: 'extraQty', label: '추가' },
  { key: 'maxAdd', label: '추가가능' },
  { key: 'expQty', label: '예상 주식수' },
  { key: 'cost', label: '실구매비용' },
  { key: 'expEval', label: '예상평가금' },
  { key: 'expRatio', label: '예상비중' },
];

export default function RebalancingPanel({
  activePortfolioAccountType,
  portfolio,
  settings,
  updateSettingsForType,
  rebalanceData,
  rebalanceSortConfig,
  handleRebalanceSort,
  rebalExtraQty,
  setRebalExtraQty,
  rebalCatDonutData,
  curCatDonutData,
  marketIndicators,
  hideAmounts,
  hoveredRebalCatSlice,
  setHoveredRebalCatSlice,
  hoveredCurCatSlice,
  setHoveredCurCatSlice,
  totals,
  handleUpdate,
  setPortfolio,
  showTable = true,
  showDonut = true,
  showRetirementStats = false,
  hiddenColumns = [],
  onToggleColumn = () => {},
  authUser = null,
  isAdmin = false,
  targetEditAuthorized = false,
  setTargetEditAuthorized = () => {},
  onAdminTargetChange = null,
  onTargetEdited = null,
  markedRebalRows = {},
  onToggleMarkedRebalRow = () => {},
  onResetAllMarkedRebalRows = () => {},
  onManualSave = null,
  driveStatus = '',
  showCalculator = false,
  onToggleCalculator = null,
  investmentNotes = [],
  onUpdateInvestmentNotes = null,
  rebalTargetSnapshots = [],
  activePortfolioId = null,
  onTargetRestored = null,
}) {
  const [editingRatio, setEditingRatio] = useState({});
  // 목표금액 입력 초안 — 목표비중(editingRatio)과 같은 패턴. onChange마다 setPortfolio를 부르면
  // 타건마다 rebalanceData·portfolioStructureKey가 재계산되고 maxAddLink 유지 effect가 재실행된다.
  const [editingTargetAmount, setEditingTargetAmount] = useState({});
  // 목표금액 셀에 **포커스가 들어온 순간의 표시값** — blur에서 '정말 사용자가 고쳤는가'를 판정한다.
  // ⚠️ (₩) 라이브 미러 중에는 표시값이 시세를 따라 움직이므로, blur 시점에 재계산된 현재 평가금과
  //    비교하면 포커스~blur 사이 시세가 한 틱만 움직여도 '변경'으로 오판돼 그 종목이 **한 글자도
  //    안 쳤는데 조용히 미러에서 이탈**한다(목표비중 셀이 slotVal 원본으로 판정하는 것과 같은 이유).
  // ⚠️ 초안(editingTargetAmount)과 비교하면 안 된다 — 입력이 초안으로 controlled라 타이핑해도
  //    blur 값과 초안이 항상 같아져 모든 편집이 무시된다.
  const amtFocusValRef = useRef({});
  // '추가' 입력 초안 — 상태값(rebalExtraQty)은 반드시 number로 유지하고 타이핑 중 문자열만 여기 담는다.
  // ⚠️ 이게 없으면 '-' 한 글자가 parseInt에서 NaN→0이 되고 controlled value가 즉시 ''로 되돌려
  //    **마이너스 부호를 입력하는 것 자체가 불가능**하다(음수 매도 수량 직접 조절 불가).
  const [editingExtra, setEditingExtra] = useState({});
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [ladderModal, setLadderModal] = useState(null);
  const [dateEditMode, setDateEditMode] = useState(false);
  const [pinModal, setPinModal] = useState(null); // { onAuthorized: () => void } | null
  const [hoveredCurDSSlice, setHoveredCurDSSlice] = useState(null);
  const [hoveredProjDSSlice, setHoveredProjDSSlice] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showCostFormula, setShowCostFormula] = useState(false);
  const [maxAddLink, setMaxAddLink] = useState({}); // 추가가능→추가 연동된 행 id 집합
  const [helpPos, setHelpPos] = useState({ x: 0, y: 0 });
  const helpDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const datePickerRef = useRef(null);

  // ── 투자 기록 노트패드 ──
  const [noteLogOpen, setNoteLogOpen] = useState(false);
  const [noteLogPos, setNoteLogPos] = useState({ x: 0, y: 0 });
  const noteLogDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const [noteExpandModal, setNoteExpandModal] = useState(null); // { id, date, val }
  const [noteExpandPos, setNoteExpandPos] = useState({ x: 0, y: 0 });
  const noteExpandDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });

  const openNoteLog = () => {
    setNoteLogPos({ x: Math.max(8, window.innerWidth / 2 - 192), y: Math.max(8, window.innerHeight / 2 - 240) });
    setNoteLogOpen(true);
  };

  const handleNoteLogDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    noteLogDrag.current = { active: true, offsetX: e.clientX - noteLogPos.x, offsetY: e.clientY - noteLogPos.y };
    const onMove = (ev) => {
      if (!noteLogDrag.current.active) return;
      setNoteLogPos({ x: ev.clientX - noteLogDrag.current.offsetX, y: ev.clientY - noteLogDrag.current.offsetY });
    };
    const onUp = () => {
      noteLogDrag.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleNoteExpandDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    noteExpandDrag.current = { active: true, offsetX: e.clientX - noteExpandPos.x, offsetY: e.clientY - noteExpandPos.y };
    const onMove = (ev) => {
      if (!noteExpandDrag.current.active) return;
      setNoteExpandPos({ x: ev.clientX - noteExpandDrag.current.offsetX, y: ev.clientY - noteExpandDrag.current.offsetY });
    };
    const onUp = () => {
      noteExpandDrag.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const openNoteExpand = (note) => {
    setNoteLogOpen(false);
    // 세로 2배(rows 30)라 중앙 오프셋(-180)으로 열면 아래가 화면 밖으로 잘린다 → 상단 근처에서 시작
    setNoteExpandPos({ x: Math.max(8, window.innerWidth / 2 - 192), y: Math.max(8, Math.round(window.innerHeight * 0.05)) });
    setNoteExpandModal({ id: note.id, date: note.date, val: note.content ?? '' });
  };

  const addNewNote = () => {
    if (!onUpdateInvestmentNotes) return;
    // ⚠️ toISOString()은 UTC라 한국 00:00~09:00에 쓴 기록이 '어제' 날짜로 찍힌다. 투자기록은
    // 메모 달력 칸(dayKey, KST 로컬 조립)에 매칭되므로 반드시 KST로 맞춰야 하루가 어긋나지 않는다.
    const today = getTodayKST();
    const newNote = { id: generateId(), date: today, content: '' };
    const updated = [newNote, ...(investmentNotes || [])];
    onUpdateInvestmentNotes(updated);
    setNoteExpandPos({ x: Math.max(8, window.innerWidth / 2 - 192), y: Math.max(8, Math.round(window.innerHeight * 0.05)) });
    setNoteExpandModal({ id: newNote.id, date: newNote.date, val: '' });
  };

  const saveNoteExpand = () => {
    if (!noteExpandModal || !onUpdateInvestmentNotes) return;
    const updated = (investmentNotes || []).map(n =>
      n.id === noteExpandModal.id ? { ...n, date: noteExpandModal.date, content: noteExpandModal.val } : n
    );
    onUpdateInvestmentNotes(updated);
    setNoteExpandModal(null);
  };

  const deleteNote = (id) => {
    if (!onUpdateInvestmentNotes) return;
    onUpdateInvestmentNotes((investmentNotes || []).filter(n => n.id !== id));
  };

  const formatNoteDate = (iso) => {
    if (!iso) return '날짜';
    const p = iso.split('-');
    return p.length === 3 ? `${p[0].slice(2)}/${p[1]}/${p[2]}` : iso;
  };

  const sortedNotes = [...(investmentNotes || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const latestNote = sortedNotes[0] ?? null;
  const openHelp = () => {
    setHelpPos({ x: Math.max(8, window.innerWidth / 2 - 220), y: Math.max(8, window.innerHeight / 2 - 280) });
    setHelpOpen(true);
  };
  const handleHelpDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    helpDrag.current = { active: true, offsetX: e.clientX - helpPos.x, offsetY: e.clientY - helpPos.y };
    const onMove = (ev) => {
      if (!helpDrag.current.active) return;
      setHelpPos({ x: ev.clientX - helpDrag.current.offsetX, y: ev.clientY - helpDrag.current.offsetY });
    };
    const onUp = () => {
      helpDrag.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const formatDisplayDate = (iso) => {
    // ⚠️ 미지정은 '날짜 지정' — 이 칸의 날짜가 곧 메모 달력 기록 날짜라, 비어 있으면 기록이
    // 생기지 않는다(오늘로 임의 폴백하지 않는 것이 '헤더 날짜 = 기록 날짜' 불변식).
    if (!iso) return '날짜 지정';
    const p = iso.split('-');
    return p.length === 3 ? `${p[0].slice(2)}/${p[1]}/${p[2]}` : iso;
  };
  // ⚠️ 실제 달력 유효성까지 검사한다 — 과거엔 범위 검사가 없어 '26/13/45'가 '2026-13-45'로 저장됐고,
  // 그 값이 메모 달력 키가 되면 렌더도 삭제도 못 하는 유령 기록이 된다(isValidIsoDate 주석 참조).
  const parseDisplayDate = (text) => {
    const p = String(text || '').replace(/[.\-]/g, '/').split('/').filter(Boolean);
    if (p.length !== 3) return null;
    if (!/^\d{1,4}$/.test(p[0]) || !/^\d{1,2}$/.test(p[1]) || !/^\d{1,2}$/.test(p[2])) return null;
    const y = p[0].length <= 2 ? `20${p[0].padStart(2, '0')}` : p[0].padStart(4, '0');
    const iso = `${y}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    return isValidIsoDate(iso) ? iso : null;
  };

  // 투자선택 3모드. '목표금액'은 수량 산출만 금액 기준이고 **자금 축은 리밸런싱과 동일**
  // (총평가금 기준 · 예수금 전액 사용). 그래서 자금 관련 분기는 전부 isLevelMode로 묶는다.
  const isAmountMode = settings.mode === 'targetAmount';
  const isLevelMode = settings.mode === 'rebalance' || isAmountMode;

  // ── 투자선택에 따른 열 자동 숨김/비활성 ──
  // 목표금액 모드면 목표비중이, 리밸런싱·적립식이면 목표금액이 '지금 안 쓰는 열'이다.
  // ⚠️ 저장된 hiddenColumns(계좌 필드)는 **건드리지 않는다** — 모드 전환이 사용자의 수동 숨김 설정을
  //    덮어쓰지 않게, 그리고 settings는 같은 accountType 전 계좌 공유인데 hiddenColumns는 계좌별이라
  //    두 축이 어긋나는 것을 막기 위함. 화면에서만 감추고, 칩으로 되살리면 '보이되 비활성'이 된다.
  const modeHiddenKey = isAmountMode ? 'targetRatio' : 'targetAmount';
  const [revealedCols, setRevealedCols] = useState({}); // 사용자가 칩으로 되살린 mode-hidden 열
  const isModeHidden = (k) => k === modeHiddenKey && !hiddenColumns.includes(k) && !revealedCols[k];
  const H = (k) => hiddenColumns.includes(k) || isModeHidden(k);
  // 칩/스트립 클릭: mode-hidden 열은 저장 목록 대신 reveal 토글로 처리(저장 상태 오염 방지).
  // ⚠️ '수동 숨김 + 모드 숨김'이 겹친 열을 단순히 onToggleColumn으로 보내면, 저장 목록에서만 빠지고
  //    모드 숨김이 그대로라 **화면은 그대로인데 저장 상태만 조용히 바뀐다**(첫 클릭 무반응).
  //    한 번의 클릭으로 반드시 보이거나 숨겨지도록 두 축을 함께 맞춘다.
  const toggleColumnSmart = (k) => {
    if (k !== modeHiddenKey) { onToggleColumn(k); return; }
    const userHidden = hiddenColumns.includes(k);
    const visible = !userHidden && !!revealedCols[k];
    if (visible) {
      setRevealedCols(prev => ({ ...prev, [k]: false }));
    } else {
      if (userHidden) onToggleColumn(k);
      setRevealedCols(prev => ({ ...prev, [k]: true }));
    }
  };
  // 지금 편집이 막혀야 하는 열(보이더라도 읽기 전용)
  const ratioDisabled = isAmountMode;
  const amountDisabled = !isAmountMode;

  // 고정 모드 + 미인증 + 비관리자 → PIN 잠금
  const isFixedLocked = settings.targetMode !== 'variable' && !targetEditAuthorized && !isAdmin;
  // 목표 관련 변경 통지 — 관리자 알림(onAdminTargetChange, impersonation 중에만 non-null)과
  // 메모 달력 자동 기록(onTargetEdited)을 함께 발화시킨다. opts.date를 주면 '목표 날짜 변경'.
  const reportAdminChange = (opts) => {
    if (onAdminTargetChange) onAdminTargetChange();
    if (onTargetEdited) onTargetEdited(opts);
  };

  // ── 과거 목표비중 복원 (메모 달력 rebalTarget 스냅샷 → 현재 표) ──
  // ⚠️ reportAdminChange를 재사용하지 말 것 — onTargetEdited까지 발화해 dirty가 서면, 헤더 날짜가
  //    복원 소스와 같을 때 그 원본 기록이 오늘 수량·평가금으로 덮어써진다. 기록 여부 판정은
  //    App의 onTargetRestored가 헤더 날짜와 비교해 결정한다(CLAUDE.md "과거 목표비중 복원").
  // #verify:restore-apply-start
  const applyRestoredTargets = (dayKey, memo, matched) => {
    if (!memo || !Array.isArray(matched) || matched.length === 0) return;
    if (activePortfolioId && memo.portfolioId && memo.portfolioId !== activePortfolioId) return;
    const { slotField, overrideField } = resolveTargetSlots(settings);
    const ratioById = Object.create(null);
    matched.forEach(m => { if (m && m.id != null) ratioById[m.id] = m.value; });
    // 기록에 남은 목표금액도 함께 되돌린다.
    // ⚠️ '금액을 아는 기록'(한 행이라도 amount가 있음)일 때만 금액 축을 건드린다 — 그때는 기록에
    //    금액이 없던 행을 ''로 비워야 그 시점 상태가 그대로 재현된다. 구버전 기록은 전 행이 null이라
    //    금액 축을 아예 손대지 않는다(옛 기록을 불러왔다고 현재 금액이 통째로 지워지면 안 된다).
    const amountById = Object.create(null);
    const hasAmounts = matched.some(m => m && m.amount != null);
    if (hasAmounts) matched.forEach(m => { if (m && m.id != null) amountById[m.id] = m.amount != null ? m.amount : ''; });
    // 편집 중이던 셀의 로컬 문자열이 남아 있으면 복원값이 화면에 안 보인다(applyReset과 동일 처리).
    setEditingRatio(prev => { const n = { ...prev }; matched.forEach(m => { delete n[m.id]; }); return n; });
    setEditingTargetAmount(prev => { const n = { ...prev }; matched.forEach(m => { delete n[m.id]; }); return n; });
    setPortfolio(prev => {
      const withRatios = applyRebalTargetRatios(prev, ratioById, { slotField, overrideField });
      if (!hasAmounts) return withRatios;
      // ⚠️ 금액도 override를 함께 세운다 — (₩) 라이브 미러가 켜져 있으면 복원값이 곧바로 현재
      //    평가금에 덮여 '복원했는데 화면이 1픽셀도 안 바뀐다'가 된다(비중 슬롯의 overrideField와 같은 근거).
      return withRatios.map(it => (it && it.id != null && Object.prototype.hasOwnProperty.call(amountById, it.id))
        ? { ...it, targetAmount: amountById[it.id], targetAmountOverride: true }
        : it);
    });
    if (onAdminTargetChange) onAdminTargetChange();
    if (onTargetRestored) onTargetRestored({ portfolioId: activePortfolioId, dayKey });
  };
  // #verify:restore-apply-end

  const CAT_W = 80;
  const CHRATE_W = 65;
  const RETURN_W = 65;
  const changeRateLeft = H('category') ? 0 : CAT_W;
  const returnRateLeft = changeRateLeft + (H('changeRate') ? 0 : CHRATE_W);
  const nameLeft = returnRateLeft + (H('returnRate') ? 0 : RETURN_W);

  const stickySpanKeys = ['category', 'changeRate', 'returnRate', 'name'];
  const stickySpanCount = stickySpanKeys.filter(k => !H(k)).length;
  // 표 하단 요약(투자가능금액·잔액)과 퇴직연금 D/S 바는 표 바깥으로 나가 colSpan을 쓰지 않는다
  // → 열 개수 상수(과거 `16 - hiddenColumns.length`)가 필요 없어졌다. 다시 만들지 말 것.

  const hideStrip = (key) => (
    <div
      className="absolute top-0 left-0 right-0 h-3 cursor-pointer z-10 hover:bg-indigo-400/25 transition-colors"
      onClick={e => { e.stopPropagation(); toggleColumnSmart(key); }}
      title="클릭하여 열 숨기기"
    />
  );

  // 목표 날짜 칩 + 📅 과거 목표비중 불러오기 — **활성 목표 열의 헤더**에 붙인다.
  // ⚠️ 이 두 컨트롤은 목표비중 열에만 두면 안 된다: 목표금액 모드에서 그 열이 접히면 th 자체가
  //    사라져 **복원 진입점과 기록 날짜 지정 수단이 통째로 없어진다**. 복원은 금액까지 되돌리고,
  //    날짜는 달력 기록 대상이라 모드와 무관하게 항상 닿을 수 있어야 한다.
  // ⚠️ datePickerRef는 하나뿐이라 두 헤더에서 동시에 렌더하면 안 된다 — 모드로 배타 렌더할 것.
  const renderTargetDateBar = () => (
    <div className="relative w-full flex items-center gap-1">
      <input
        ref={datePickerRef}
        type="date"
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
        value={settings.targetDate || ''}
        onChange={e => { updateSettingsForType({ ...settings, targetDate: e.target.value }); reportAdminChange({ date: e.target.value }); }}
        tabIndex={-1}
      />
      {dateEditMode ? (
        <input
          type="text"
          autoFocus
          className="bg-gray-800 text-gray-400 text-[9px] outline-none border border-green-500 rounded px-1 py-0.5 flex-1 min-w-0 text-center"
          defaultValue={formatDisplayDate(settings.targetDate)}
          onBlur={e => { const parsed = parseDisplayDate(e.target.value); if (parsed) { updateSettingsForType({ ...settings, targetDate: parsed }); reportAdminChange({ date: parsed }); } setDateEditMode(false); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); e.stopPropagation(); }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span
          className={`block text-[9px] border rounded px-1 py-0.5 flex-1 min-w-0 text-center cursor-pointer bg-gray-800 select-none ${
            settings.targetDate
              ? 'text-gray-400 border-gray-600 hover:border-gray-500'
              : 'text-amber-300/80 border-amber-500/50 hover:border-amber-400'
          }`}
          onClick={e => { e.stopPropagation(); datePickerRef.current?.showPicker?.(); }}
          onDoubleClick={e => { e.stopPropagation(); setDateEditMode(true); }}
          title={settings.targetDate
            ? '목표 비중 조정일 — 이 날짜의 메모 달력에 기록됩니다 (클릭: 달력 | 더블클릭: 직접 입력)'
            : '날짜를 지정해야 메모 달력에 목표 비중이 기록됩니다 (클릭: 달력 | 더블클릭: 직접 입력)'}
        >{formatDisplayDate(settings.targetDate)}</span>
      )}
      {/* 과거 목표비중 불러오기 — 기록 '쓰기'인 날짜 칩과 반대 방향(읽기/적용).
          ⚠️ 날짜 칩을 재사용하면 안 된다: 칩을 과거로 바꾸면 그 날짜에 오늘 값이
          다시 기록돼 원본이 소실되고, updateSettingsForType이 같은 계좌 종류
          전체에 그 날짜를 전파한다. 반드시 별도 컨트롤로 둘 것.
          ⚠️ relative z-20 필수 — hideStrip(z-10)이 이 영역 상단을 덮어 클릭을 가로챈다.
             래퍼 전체가 아니라 버튼에만 줘야 열 숨기기 스트립이 살아남는다. */}
      <button
        type="button"
        disabled={!rebalTargetSnapshots.length}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); if (rebalTargetSnapshots.length) setRestoreOpen(true); }}
        className={`shrink-0 relative z-20 p-0.5 rounded transition-colors ${
          rebalTargetSnapshots.length
            ? 'text-emerald-500/70 hover:text-emerald-300 hover:bg-emerald-900/20'
            : 'text-gray-700 cursor-not-allowed'
        }`}
        title={rebalTargetSnapshots.length
          ? `과거 목표비중 불러오기 — 기록 ${rebalTargetSnapshots.length}건 (달력에서 날짜를 골라 현재 표에 적용)`
          : '이 계좌에 기록된 목표비중이 없습니다'}
      ><CalendarClock size={11} /></button>
    </div>
  );

  const renderCompactPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
    if (percent < 0.07) return null;
    const RADIAN = Math.PI / 180;
    const radius = (innerRadius + outerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    const label = name.length > 3 ? name.slice(0, 3) : name;
    return (
      <text x={x} y={y} fill="black" textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight="bold" style={{ pointerEvents: 'none' }}>
        {label}
      </text>
    );
  };

  const isOverseasHeader = activePortfolioAccountType === 'overseas';
  const headerFx = marketIndicators.usdkrw || 1;
  const headerNativeTotalEval = isOverseasHeader ? totals.totalEval / headerFx : totals.totalEval;
  const headerDepositAmount = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
  const headerAmount = cleanNum(settings.amount);
  const headerUseDeposit = settings.useDepositAmount != null
    ? Math.min(Math.max(0, cleanNum(settings.useDepositAmount)), headerDepositAmount)
    : headerDepositAmount;
  const headerBaseCost = rebalanceData.reduce((s, d) => s + d.cost, 0);
  const headerExtraCost = rebalanceData.reduce((s, d) => s + (rebalExtraQty[d.id] || 0) * cleanNum(d.currentPrice), 0);
  const headerInvestable = isLevelMode ? headerAmount : (headerUseDeposit + headerAmount);
  const headerTotalBuy = rebalanceData.reduce((s, d) => {
    const q = d.action + (rebalExtraQty[d.id] || 0);
    return s + (q > 0 ? q * cleanNum(d.currentPrice) : 0);
  }, 0);
  const headerTotalSell = rebalanceData.reduce((s, d) => {
    const q = d.action + (rebalExtraQty[d.id] || 0);
    return s + (q < 0 ? -q * cleanNum(d.currentPrice) : 0);
  }, 0);
  const headerDepositForBuy = isLevelMode ? headerDepositAmount : headerUseDeposit;
  const rebalTotalAvailable = headerDepositForBuy + headerAmount + headerTotalSell;
  const rebalBalance = rebalTotalAvailable - headerTotalBuy;
  const rebalRemaining = Math.max(0, rebalBalance);

  useEffect(() => {
    if (settings.mode === 'deposit-only') {
      updateSettingsForType({ ...settings, mode: 'accumulate', amount: 0 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 추가가능(maxAdd) ↔ 추가(extraQty) 연동 토글. 연동 ON: 그 시점 용량을 floor해 추가에 채움.
  // 연동 OFF(재클릭): 추가를 0으로 초기화. 값 계산·진동 방지는 아래 유지 effect가 담당.
  const toggleMaxAddLink = (id, capacity) => {
    const wasLinked = !!maxAddLink[id];
    setMaxAddLink(prev => {
      const next = { ...prev };
      if (wasLinked) delete next[id]; else next[id] = true;
      return next;
    });
    setRebalExtraQty(prev => ({ ...prev, [id]: wasLinked ? 0 : Math.max(0, Math.floor(capacity)) }));
    // 연동으로 채운 값이 남아 있던 입력 초안에 가려지지 않도록 폐기
    setEditingExtra(prev => { if (prev[id] === undefined) return prev; const n = { ...prev }; delete n[id]; return n; });
  };

  // 연동된 행 유지: "잔액 + 그 행이 이미 쓴 금액(extra×현재가)"(자기 소비 환원)을 풀(pool)로
  // 보고 floor(pool÷현재가)를 추가에 채운다. 추가가 잔액을 차지해 차익을 만드는 관계라
  // (consumed = extra×현재가, action 부호 무관), 이 풀은 연동 행 자신의 추가 변동에 불변 →
  // floor가 고정점이라 진동하지 않고 가격/잔액/타행 변동 시에만 재계산된다. 변화 없으면 prev
  // 반환 → 리렌더 무한루프 차단. 여러 행 동시 연동은 공유 풀을 순차 배분(역시 안정).
  useEffect(() => {
    const linkedIds = rebalanceData.filter(d => maxAddLink[d.id] && d.type !== 'savings' && cleanNum(d.currentPrice) > 0).map(d => d.id);
    if (linkedIds.length === 0) return;
    const linkedSet = new Set(linkedIds);
    let pool = rebalBalance;
    rebalanceData.forEach(d => {
      if (linkedSet.has(d.id)) pool += (rebalExtraQty[d.id] || 0) * cleanNum(d.currentPrice);
    });
    const desired = {};
    rebalanceData.forEach(d => {
      if (!linkedSet.has(d.id)) return;
      const price = cleanNum(d.currentPrice);
      const qty = Math.max(0, Math.floor(pool / price));
      desired[d.id] = qty;
      pool -= qty * price;
    });
    setRebalExtraQty(prev => {
      let changed = false;
      const next = { ...prev };
      for (const id of linkedIds) if ((prev[id] || 0) !== desired[id]) { next[id] = desired[id]; changed = true; }
      return changed ? next : prev;
    });
  }, [rebalanceData, rebalBalance, maxAddLink, rebalExtraQty, setRebalExtraQty]);

  const applyRemainingToDeposit = () => {
    if (rebalRemaining <= 0) return;
    const newDeposit = isLevelMode
      ? Math.round(rebalRemaining)
      : Math.round(headerDepositAmount - headerUseDeposit + rebalRemaining);
    setPortfolio(prev => prev.map(p => p.type === 'deposit' ? { ...p, depositAmount: newDeposit } : p));
    if (!isLevelMode && settings.useDepositAmount != null) {
      updateSettingsForType({ ...settings, useDepositAmount: null });
    }
  };

  const formatRemaining = (n) => activePortfolioAccountType === 'overseas'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n))
    : formatNumber(Math.round(n));

  const makeCompactPieTooltip = (data) => ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const item = payload[0];
    const total = data.reduce((s, x) => s + x.value, 0);
    const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0.0';
    return (
      <div style={{ background: 'rgba(15,23,42,0.95)', border: '1px solid #374151', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 'bold', color: item.fill, whiteSpace: 'nowrap' }}>
        {item.name} {pct}%
      </div>
    );
  };

  return (
    <>
        {showTable && <div className="bg-[#1e293b] rounded-xl border border-gray-700 overflow-hidden shadow-lg w-full flex flex-col mb-6">
          <div className="px-5 py-3 bg-[#0f172a] border-b border-gray-700 flex flex-col xl:flex-row xl:items-start gap-4">
            <div className="flex items-center gap-1.5 shrink-0 pt-1">
              <span className="text-green-400 text-xl font-bold">리밸런싱</span>
              <button onClick={openHelp} className="text-gray-500 hover:text-sky-400 transition-colors" title="계산식 보기"><HelpCircle size={14} /></button>
            </div>
            <div className="flex-1 flex justify-end items-start gap-6">
              {(curCatDonutData.length > 0 || rebalCatDonutData.length > 0) && (
                <>
                  <div className="flex flex-col items-center">
                    <div className="text-gray-500 text-[10px] font-semibold mb-0">현재 비중</div>
                    <div style={{ height: 120, width: 120 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip content={makeCompactPieTooltip(curCatDonutData)} />
                          <Pie data={curCatDonutData} outerRadius="72%" dataKey="value" label={renderCompactPieLabel} labelLine={false} onMouseEnter={(data) => setHoveredCurCatSlice(data)} onMouseLeave={() => setHoveredCurCatSlice(null)}>
                            {curCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="text-gray-500 text-[10px] font-semibold mb-0">리밸런싱 후 비중</div>
                    <div style={{ height: 120, width: 120 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip content={makeCompactPieTooltip(rebalCatDonutData)} />
                          <Pie data={rebalCatDonutData} outerRadius="72%" dataKey="value" label={renderCompactPieLabel} labelLine={false} onMouseEnter={(data) => setHoveredRebalCatSlice(data)} onMouseLeave={() => setHoveredRebalCatSlice(null)}>
                            {rebalCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {(() => {
                    if (activePortfolioAccountType !== 'dc-irp') return null;
                    const depositEval = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
                    // 예적금은 rebalanceData에 고정 행으로 포함됨(expEval=평가금) → 아래 합산에 이미 반영. 별도 가산 금지(이중 계상).
                    const projD = rebalanceData.filter(d => getAssetClass(d) === 'D').reduce((s, d) => s + d.expEval, 0);
                    const projS = rebalanceData.filter(d => getAssetClass(d) === 'S').reduce((s, d) => s + d.expEval, 0) + depositEval;
                    const projTotal = projD + projS;
                    if (projTotal <= 0) return null;
                    const projDSData = [{ name: '위험', value: projD }, { name: '안전', value: projS }];
                    const DS_COLORS = ['#ef4444', '#10b981'];
                    return (
                      <div className="flex flex-col items-center">
                        <div className="text-gray-500 text-[10px] font-semibold mb-0">리밸런싱 후 위험/안전</div>
                        <div style={{ height: 120, width: 120 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Tooltip content={makeCompactPieTooltip(projDSData)} />
                              <Pie data={projDSData} innerRadius="35%" outerRadius="72%" dataKey="value" label={renderCompactPieLabel} labelLine={false} onMouseEnter={(data) => setHoveredProjDSSlice(data)} onMouseLeave={() => setHoveredProjDSSlice(null)}>
                                {projDSData.map((_, i) => <Cell key={i} fill={DS_COLORS[i]} />)}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
            <div className="w-full xl:w-[560px] shrink-0">
              {(() => {
                const fmtUSD = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));
                const fmtAmount = (n) => isOverseasHeader ? fmtUSD(n) : formatCurrency(n);
                const fmtPlain = (n) => isOverseasHeader
                  ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cleanNum(n))
                  : formatNumber(Math.round(cleanNum(n)));
                const leftLabel = isLevelMode ? '총평가금액' : '예수금';
                const leftVal = isLevelMode ? headerNativeTotalEval : headerDepositAmount;
                const useDepositLabel = '사용할 예수금';
                const isUseDepositExplicit = settings.useDepositAmount != null;
                const investable = isLevelMode ? (leftVal + headerAmount) : (headerUseDeposit + headerAmount);
                const totalCost = headerBaseCost + headerExtraCost;
                const displayCost = -totalCost;
                // ⚠️ '목표금액'은 수량만 금액 기준이고 자금 축은 리밸런싱과 같다(isLevelMode).
                const modeOptions = [
                  { value: 'accumulate', label: '적립식', color: '#facc15' },
                  { value: 'rebalance', label: '리밸런싱', color: '#22c55e' },
                  { value: 'targetAmount', label: '목표금액', color: '#34d399' },
                ];
                const currentOpt = modeOptions.find(o => o.value === settings.mode) || modeOptions[0];
                const investableSourceLabel = isLevelMode ? leftLabel : useDepositLabel;
                const investableSourceVal = isLevelMode ? leftVal : headerUseDeposit;
                const inputBlockWidth = 'w-[184px]';
                return (
                  <div className="bg-gray-800/80 px-4 py-3 rounded-lg border border-gray-700 shadow-inner flex flex-col gap-1.5 text-[12px] min-w-0">
                    <div className="flex items-center justify-between gap-3 pb-1.5 border-b border-gray-700/60">
                      <span className="text-gray-300 font-bold shrink-0">투자선택</span>
                      <div className="relative inline-flex items-center gap-1.5 px-2 py-0.5 bg-gray-900/60 border border-gray-600 rounded hover:border-gray-400 transition-colors cursor-pointer">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: currentOpt.color }} />
                        <span className="text-gray-200 text-[12px] font-bold">{currentOpt.label}</span>
                        <span className="text-gray-500 text-[9px] leading-none">▼</span>
                        <select
                          className="absolute inset-0 w-full h-full bg-transparent text-transparent cursor-pointer outline-none appearance-none"
                          value={settings.mode}
                          onChange={e => updateSettingsForType({ ...settings, mode: e.target.value })}
                          title="투자 선택"
                        >
                          {modeOptions.map(o => (
                            <option key={o.value} value={o.value} className="bg-gray-800 text-gray-200">{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {isLevelMode ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-400 shrink-0">{leftLabel}</span>
                        <span className="text-gray-200 font-bold text-right truncate">{fmtAmount(leftVal)}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-gray-400">{leftLabel}</span>
                          <span className="text-gray-200 font-bold">{fmtAmount(leftVal)}</span>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-gray-400 shrink-0">{useDepositLabel}</span>
                          <div className={`flex items-center gap-1 ${inputBlockWidth}`}>
                            {isOverseasHeader && <span className="text-sky-400 font-bold shrink-0">$</span>}
                            <input
                              type="text"
                              className={`bg-gray-900/60 border rounded px-2 py-0.5 text-right font-bold outline-none flex-1 min-w-0 text-[12px] ${isUseDepositExplicit ? 'text-cyan-300 border-gray-700 focus:border-cyan-500' : 'text-gray-500 border-gray-700 focus:border-cyan-500'}`}
                              value={isUseDepositExplicit
                                ? (isOverseasHeader ? settings.useDepositAmount : formatNumber(settings.useDepositAmount))
                                : ''}
                              placeholder={isOverseasHeader ? `전액 ${fmtUSD(headerDepositAmount)}` : `전액 ${formatNumber(headerDepositAmount)}`}
                              onChange={e => {
                                const raw = e.target.value;
                                if (raw === '') {
                                  updateSettingsForType({ ...settings, useDepositAmount: null });
                                } else {
                                  const v = Math.min(Math.max(0, cleanNum(raw)), headerDepositAmount);
                                  updateSettingsForType({ ...settings, useDepositAmount: v });
                                }
                              }}
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                              disabled={headerDepositAmount <= 0}
                            />
                            <button
                              type="button"
                              onClick={() => updateSettingsForType({ ...settings, useDepositAmount: headerDepositAmount })}
                              disabled={headerDepositAmount <= 0}
                              className="px-2 py-0.5 text-[10px] font-bold rounded bg-cyan-900/40 hover:bg-cyan-700/60 text-cyan-300 hover:text-cyan-100 border border-cyan-700/40 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="예수금 전액을 사용할 예수금에 채우기"
                            >
                              전액
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-400 shrink-0">적립금</span>
                      <div className={`flex items-center gap-1 ${inputBlockWidth}`}>
                        {isOverseasHeader && <span className="text-sky-400 font-bold shrink-0">$</span>}
                        <input
                          type="text"
                          className="bg-gray-900/60 border border-gray-700 rounded px-2 py-0.5 text-right text-orange-300 font-bold outline-none focus:border-orange-500 flex-1 min-w-0 text-[12px]"
                          value={isOverseasHeader ? (headerAmount > 0 ? headerAmount : '') : formatNumber(settings.amount)}
                          placeholder="0"
                          onChange={e => updateSettingsForType({ ...settings, amount: cleanNum(e.target.value) })}
                          onFocus={e => e.target.select()}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                        />
                      </div>
                    </div>
                    {isOverseasHeader && headerAmount > 0 && (
                      <div className="text-right text-[10px] text-gray-500 -mt-1">≈ {formatCurrency(headerAmount * headerFx)}</div>
                    )}
                    <div className="flex flex-col border-t border-gray-700/60 pt-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-300 font-bold shrink-0">투자가능금</span>
                        <span className="text-green-400 font-bold text-right truncate text-[13px]">
                          {headerAmount > 0
                            ? <>{fmtPlain(investableSourceVal)} + {fmtPlain(headerAmount)} = {fmtAmount(investable)}</>
                            : fmtAmount(investable)}
                        </span>
                      </div>
                      <div className="text-right text-[10px] text-gray-500 leading-tight">
                        ({headerAmount > 0
                          ? `${investableSourceLabel} + 적립금 = 투자가능금`
                          : `${investableSourceLabel} = 투자가능금`})
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-400 shrink-0">실구매비용</span>
                        <span className={`font-bold text-right truncate ${displayCost > 0 ? 'text-sky-300' : displayCost < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {fmtAmount(displayCost)}
                        </span>
                      </div>
                      <div className="text-right text-[10px] text-gray-500 leading-tight">
                        (매도총합 − 매수총합)
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-400 shrink-0">잔액</span>
                        <span className={`font-bold text-right truncate ${rebalBalance > 0 ? 'text-sky-300' : rebalBalance < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {fmtAmount(rebalBalance)}
                        </span>
                      </div>
                      <div className="text-right text-[10px] text-gray-500 leading-tight">
                        ({isLevelMode ? '예수금' : '사용예수금'} + 적립금 + 매도 − 매수 = 잔액)
                      </div>
                    </div>
                    {rebalRemaining > 0 && (
                      <button
                        type="button"
                        onClick={applyRemainingToDeposit}
                        className="flex items-center justify-between gap-3 text-[11px] text-gray-400 hover:text-green-300 transition-colors group"
                        title="잔액을 현재 예수금에 적용"
                      >
                        <span className="shrink-0">리밸런싱 잔액</span>
                        <span className="text-right truncate"><span className="text-gray-300">{formatRemaining(rebalRemaining)}</span> <span className="text-green-400 group-hover:text-green-200">→ 예수금에 적용</span></span>
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
          {onUpdateInvestmentNotes && (
            <div
              className="flex items-center gap-3 px-4 py-2 bg-[#080e1c] border-b border-gray-800/60 cursor-pointer hover:bg-[#0b1322] transition-colors group"
              onClick={openNoteLog}
              title="투자 기록 메모장 열기"
            >
              <div className="flex items-center gap-1.5 text-gray-500 group-hover:text-gray-400 transition-colors shrink-0">
                <BookOpen size={11} />
                <span className="text-[11px] font-medium tracking-wide">투자 기록</span>
              </div>
              <div className="w-px h-3 bg-gray-700 shrink-0" />
              {latestNote ? (
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-sky-500 font-mono text-[11px] shrink-0">{formatNoteDate(latestNote.date)}</span>
                  <span className="text-gray-400 text-[11px] truncate">{latestNote.content}</span>
                </div>
              ) : (
                <span className="text-gray-700 text-[11px] flex-1">기록 없음</span>
              )}
              {latestNote && (
                <button
                  onClick={e => { e.stopPropagation(); openNoteExpand(latestNote); }}
                  className="shrink-0 text-gray-600 hover:text-blue-400 transition-colors"
                  title="메모 바로 열기"
                >
                  <Maximize2 size={13} />
                </button>
              )}
            </div>
          )}
          {(RB_COLS.some(c => H(c.key)) || onManualSave || onToggleCalculator) && (
            <div className="flex items-end justify-between gap-2 px-3 pt-2 pb-0 bg-[#080e1c]">
              <div className="flex items-end gap-1 flex-wrap min-w-0">
                {RB_COLS.filter(c => H(c.key)).map(col => (
                  <button
                    key={col.key}
                    onClick={() => toggleColumnSmart(col.key)}
                    className={`px-2.5 py-1 text-[10px] font-bold border border-b-0 rounded-t-md transition-colors ${
                      isModeHidden(col.key)
                        ? 'text-gray-500 border-gray-700 bg-gray-900/70 hover:bg-gray-800 hover:text-gray-300'
                        : 'text-gray-400 border-gray-600 bg-gray-800/80 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                    title={isModeHidden(col.key)
                      ? `${col.label} — 현재 투자선택에서는 쓰이지 않아 자동으로 접힘. 클릭하면 표에 보이지만 편집은 잠깁니다`
                      : `${col.label} 열 표시`}
                  >
                    {col.label}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-1 shrink-0">
              {onToggleCalculator && (
                <button
                  type="button"
                  onClick={onToggleCalculator}
                  title={showCalculator ? '계산기 닫기' : '계산기 열기'}
                  className={`shrink-0 inline-flex items-center justify-center p-1 mb-1 bg-transparent border-0 transition-transform hover:scale-110 ${
                    showCalculator ? 'text-orange-400' : 'text-gray-500 hover:text-orange-300'
                  }`}
                >
                  <Calculator size={20} />
                </button>
              )}
              {onManualSave && (() => {
                const saveBtnColor = driveStatus === 'saving'
                  ? 'text-sky-400'
                  : driveStatus === 'saved'
                    ? 'text-green-300'
                    : driveStatus === 'error' || driveStatus === 'auth_needed'
                      ? 'text-red-400'
                      : 'text-green-400 hover:text-green-300';
                const saveTitle = driveStatus === 'saving'
                  ? 'Drive에 저장 중...'
                  : driveStatus === 'saved'
                    ? '저장 완료 — 클릭 시 다시 저장'
                    : driveStatus === 'error'
                      ? '저장 실패 — 클릭하여 재시도'
                      : driveStatus === 'auth_needed'
                        ? 'Drive 인증 필요'
                        : 'Drive에 저장 + 백업 생성';
                return (
                  <button
                    type="button"
                    onClick={onManualSave}
                    disabled={driveStatus === 'saving'}
                    className={`shrink-0 inline-flex items-center justify-center p-1 mb-1 bg-transparent border-0 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100 ${saveBtnColor}`}
                    title={saveTitle}
                  >
                    <Save size={20} className={driveStatus === 'saving' ? 'animate-pulse' : ''} />
                  </button>
                );
              })()}
              </div>
            </div>
          )}
          {/* ⚠️ isolate(isolation:isolate) 필수 — 이 표의 좌측 고정 헤더가 z-30인데 앱 상단바
              (App.tsx의 sticky top-0 z-30)와 값이 같아, 동률에서는 DOM 뒤쪽인 표가 위에 그려진다.
              그래서 스크롤 중 표 헤더가 상단바를 뚫고 올라와 보였다. isolate가 여기서 스태킹
              컨텍스트를 만들어 표 내부 z를 통째로 격리하므로 **표 내부 서열(고정 헤더 z-30 >
              일반 헤더 z-20 > 본문 z-5)은 그대로 유지**된다.
              ⚠️ 개별 th의 z를 낮추는 방식으로 되돌리지 말 것 — 고정 헤더를 z-20으로 내리면
              가로 스크롤 시 DOM 뒤쪽의 일반 헤더(z-20)와 동률이 되어 종목명 헤더가 가려진다.
              ⚠️ isolate는 이 표 래퍼에만 — 카드 div에 걸면 그 안의 요소까지 갇힌다(모달들은 이 래퍼 밖). */}
          <div className="overflow-x-auto bg-[#0f172a] isolate">
            <table className="w-full text-right text-[13px]">
              <thead className="bg-[#1e293b] text-gray-300 border-b border-gray-600 font-bold text-center">
                {(() => {
                  const sk = rebalanceSortConfig.key, sd = rebalanceSortConfig.direction;
                  const arr = (k) => <span className={`ml-0.5 text-[9px] ${sk === k ? 'text-gray-300' : 'invisible'}`}>{sk === k && sd === -1 ? '▼' : '▲'}</span>;
                  return (
                    <tr>
                      {!H('category') && (
                        <th className="p-0 min-w-[80px] text-center border-r border-gray-600 sticky top-0 left-0 z-30 bg-[#1e293b] relative whitespace-nowrap">
                          {hideStrip('category')}
                          <div className="flex items-stretch">
                            <div
                              className="w-4 shrink-0 cursor-pointer hover:bg-red-400/20 transition-colors self-stretch"
                              onClick={() => onResetAllMarkedRebalRows()}
                              title="전체 행 색상 초기화"
                            />
                            <div
                              className="flex-1 py-3 px-2 text-center cursor-pointer hover:bg-gray-700 transition-colors"
                              onClick={() => handleRebalanceSort(null)}
                              title="클릭하여 정렬 초기화"
                            >
                              구분
                            </div>
                          </div>
                        </th>
                      )}
                      {!H('changeRate') && (
                        <th className="py-3 px-2 min-w-[65px] text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-30 bg-[#1e293b] relative whitespace-nowrap" style={{ left: changeRateLeft }} onClick={() => handleRebalanceSort('changeRate')}>
                          {hideStrip('changeRate')}
                          등락률{arr('changeRate')}
                        </th>
                      )}
                      {!H('returnRate') && (
                        <th className="py-3 px-2 min-w-[65px] text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-30 bg-[#1e293b] relative whitespace-nowrap" style={{ left: returnRateLeft }} onClick={() => handleRebalanceSort('returnRate')}>
                          {hideStrip('returnRate')}
                          수익률{arr('returnRate')}
                        </th>
                      )}
                      {!H('name') && (
                        <th className="py-3 px-3 min-w-[110px] text-center text-gray-300 cursor-pointer hover:bg-gray-700 sticky top-0 z-30 bg-[#1e293b] [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] relative whitespace-nowrap" style={{ left: nameLeft }} onClick={() => handleRebalanceSort('name')}>
                          {hideStrip('name')}
                          종목명{arr('name')}
                        </th>
                      )}
                      {!H('code') && (
                        <th className={`py-3 px-3 min-w-[90px] text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap ${sk === 'code-global' ? 'text-gray-200' : 'text-gray-500'}`} title="왼쪽: 구분별 재배치  |  오른쪽: 코드순 전체 정렬" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); e.clientX < r.left + r.width / 2 ? handleRebalanceSort(null) : handleRebalanceSort('code-global'); }}>
                          {hideStrip('code')}
                          코드
                        </th>
                      )}
                      {!H('curEval') && (
                        <th className="py-3 px-3 min-w-[120px] text-gray-400 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap" onClick={() => handleRebalanceSort('curEval')}>
                          {hideStrip('curEval')}
                          평가금{arr('curEval')}
                        </th>
                      )}
                      {!H('currentPrice') && (
                        <th className="py-3 px-3 min-w-[100px] text-gray-500 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap" onClick={() => handleRebalanceSort('currentPrice')}>
                          {hideStrip('currentPrice')}
                          현재가{arr('currentPrice')}
                        </th>
                      )}
                      {!H('targetRatio') && (() => {
                        const targetMode = settings.targetMode === 'variable' ? 'variable' : 'fixed';
                        // ⚠️ 정렬 키는 화면에 보이는 값(effectiveTargetRatio)이어야 한다 — raw 'targetRatio'로
                        //    정렬하면 수시변경·적립식처럼 **다른 슬롯을 표시 중일 때 보이지 않는 값 기준**으로
                        //    줄이 섞이고, 라이브 미러 행도 어긋난다.
                        const isTargetSorted = sk === 'effectiveTargetRatio';
                        return (
                        <th className="py-2 px-3 min-w-[120px] text-green-400 font-bold text-center sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap">
                          {hideStrip('targetRatio')}
                          <div className="flex flex-col items-center gap-1">
                            {/* ⚠️ 모드로 배타 렌더 — 목표금액 모드에서는 목표금액 헤더가 이 바를 갖는다
                                (datePickerRef가 하나뿐이라 동시 렌더 금지). */}
                            {!isAmountMode && renderTargetDateBar()}
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="flex flex-col items-center leading-none select-none">
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); handleRebalanceSort('effectiveTargetRatio', 1); }}
                                  className={`text-[10px] leading-none transition-colors hover:text-green-300 ${isTargetSorted && sd === 1 ? 'text-green-400' : 'text-gray-500'}`}
                                  title="오름차순 정렬"
                                >▲</button>
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); handleRebalanceSort('effectiveTargetRatio', -1); }}
                                  className={`text-[10px] leading-none transition-colors hover:text-green-300 ${isTargetSorted && sd === -1 ? 'text-green-400' : 'text-gray-500'}`}
                                  title="내림차순 정렬"
                                >▼</button>
                              </div>
                              <div className="relative inline-flex items-center gap-1">
                                {isFixedLocked && <Lock size={10} className="text-amber-400" />}
                                <span className={`cursor-pointer font-bold ${targetMode === 'variable' ? 'text-amber-300' : 'text-green-400'} hover:opacity-80`} title="클릭: 고정/수시변경 선택">
                                  목표
                                </span>
                                <select
                                  className="absolute inset-0 w-full h-full bg-transparent text-transparent cursor-pointer outline-none appearance-none"
                                  value={targetMode}
                                  onChange={e => { updateSettingsForType({ ...settings, targetMode: e.target.value }); reportAdminChange(); }}
                                  title="고정 / 수시변경"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <option value="fixed" className="bg-gray-800 text-gray-200">고정</option>
                                  <option value="variable" className="bg-gray-800 text-gray-200">수시변경</option>
                                </select>
                              </div>
                              {(() => {
                                // ⚠️ 슬롯·미러 필드는 resolveTargetSlots 하나로만 정한다(적립식 별도 슬롯).
                                const { slotField, overrideField, mirrorField } = resolveTargetSlots(settings);
                                const mirrorState = settings[mirrorField] || 'off';
                                const cycleMirror = () => {
                                  const rebalFx = activePortfolioAccountType === 'overseas' ? (marketIndicators.usdkrw || 1) : 1;
                                  if (mirrorState === 'off') {
                                    setPortfolio(prev => prev.map(p => {
                                      if (p.type !== 'stock' && p.type !== 'fund' && p.type !== 'savings') return p;
                                      const qty = cleanNum(p.quantity);
                                      const price = cleanNum(p.currentPrice);
                                      const curEval = p.type === 'savings' ? savingsEval(p) : (p.type === 'fund' && !(qty > 0 && price > 0) ? cleanNum(p.evalAmount) : price * qty);
                                      const curRatio = totals.totalEval > 0 ? (curEval * rebalFx / totals.totalEval * 100) : 0;
                                      return { ...p, [slotField]: curRatio, [overrideField]: false };
                                    }));
                                    updateSettingsForType({ ...settings, [mirrorField]: 'seeded' });
                                  } else if (mirrorState === 'seeded') {
                                    setPortfolio(prev => prev.map(p => {
                                      if (p.type !== 'stock' && p.type !== 'fund' && p.type !== 'savings') return p;
                                      return { ...p, [overrideField]: false };
                                    }));
                                    updateSettingsForType({ ...settings, [mirrorField]: 'on' });
                                  } else {
                                    setPortfolio(prev => prev.map(p => {
                                      if (p.type !== 'stock' && p.type !== 'fund' && p.type !== 'savings') return p;
                                      if (p[overrideField]) return { ...p, [overrideField]: false };
                                      const qty = cleanNum(p.quantity);
                                      const price = cleanNum(p.currentPrice);
                                      const curEval = p.type === 'savings' ? savingsEval(p) : (p.type === 'fund' && !(qty > 0 && price > 0) ? cleanNum(p.evalAmount) : price * qty);
                                      const curRatio = totals.totalEval > 0 ? (curEval * rebalFx / totals.totalEval * 100) : 0;
                                      return { ...p, [slotField]: curRatio, [overrideField]: false };
                                    }));
                                    updateSettingsForType({ ...settings, [mirrorField]: 'off' });
                                  }
                                  reportAdminChange();
                                };
                                const btnColor = ratioDisabled
                                  ? 'text-gray-700 cursor-not-allowed'
                                  : isFixedLocked
                                  ? 'text-gray-600 hover:text-amber-400'
                                  : mirrorState === 'on'
                                    ? 'text-green-400 hover:text-green-300 drop-shadow-[0_0_4px_rgba(34,197,94,0.6)]'
                                    : mirrorState === 'seeded'
                                      ? 'text-emerald-300/70 hover:text-green-400'
                                      : 'text-gray-500 hover:text-green-400';
                                const btnTitle = ratioDisabled
                                  ? "투자선택이 '목표금액'이라 목표비중 편집이 잠겨 있습니다"
                                  : isFixedLocked
                                  ? '잠금 — 클릭하여 비밀번호 입력'
                                  : mirrorState === 'on'
                                    ? '라이브 미러 ON — 클릭하여 해제 (현재 비중 박제)'
                                    : mirrorState === 'seeded'
                                      ? '시드 완료 — 클릭하여 라이브 미러 시작'
                                      : `클릭 1: 현재 비중을 ${targetMode === 'variable' ? '수시변경' : '고정'} 목표값에 복사 | 다음 클릭: 라이브 미러`;
                                return (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      if (ratioDisabled) return;
                                      if (totals.totalEval <= 0) return;
                                      if (targetMode !== 'variable' && !targetEditAuthorized && !isAdmin) {
                                        setPinModal({ onAuthorized: cycleMirror });
                                      } else {
                                        cycleMirror();
                                      }
                                    }}
                                    className={`text-[11px] font-bold leading-none transition-colors select-none ${btnColor}`}
                                    title={btnTitle}
                                  >{isFixedLocked ? '🔒(%)' : '(%)'}</button>
                                );
                              })()}
                            </div>
                          </div>
                        </th>
                        );
                      })()}
                      {!H('targetAmount') && (
                        <th className={`py-2 px-3 min-w-[140px] text-center sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap ${isAmountMode ? 'text-emerald-300' : 'text-gray-500'}`}>
                          {hideStrip('targetAmount')}
                          <div className="flex flex-col items-center gap-1">
                            {/* 목표금액 모드에서는 이 헤더가 목표 날짜·복원 진입점을 갖는다(위 주석 참조) */}
                            {isAmountMode && renderTargetDateBar()}
                            <div className="flex items-center justify-center gap-1.5">
                              <div
                                className="cursor-pointer hover:text-emerald-200 transition-colors"
                                onClick={() => handleRebalanceSort('effectiveTargetAmount')}
                                title={isAmountMode ? '종목별 목표 평가금액 — 이 금액으로 수량을 계산합니다 (클릭: 정렬)' : "지금은 목표비중 기준 — 우측 상단 '투자선택'을 '목표금액'으로 바꾸면 적용됩니다"}
                              >
                                목표금액{isOverseasHeader && <span className="ml-0.5 text-[9px] text-gray-500 font-normal">($)</span>}{arr('effectiveTargetAmount')}
                              </div>
                              {(() => {
                                // ── (₩) 목표금액 라이브 미러 — 목표비중 (%)와 같은 3단 사이클 ──
                                //   off → 클릭: seeded (현재 평가금을 목표금액에 복사)
                                //       → 클릭: on     (라이브 미러 — 목표금액 = 현재 평가금, 매매 0)
                                //       → 클릭: off    (그 시점 평가금을 박제하고 해제)
                                // ⚠️ PIN 게이트를 붙이지 말 것 — 목표금액 축은 사용자 결정(2026-08)으로 잠금
                                //    미적용이고, 셀은 열려 있는데 미러만 잠그면 방어가 아니라 불편만 준다.
                                // ⚠️ reportAdminChange를 재사용하지 말 것 — onTargetEdited까지 발화하면 헤더
                                //    날짜의 달력 기록이 통째로 덮인다. 달력 자동기록의 확정 트리거는 '비중
                                //    조정'이라는 기존 규약을 유지하고, 관리자 공지만 직접 발화한다
                                //    (목표금액 셀 커밋과 동일 — CLAUDE.md 목표금액 섹션).
                                const amtMirrorState = settings.targetAmountMirror || 'off';
                                // 미러 상태 전이는 stock/fund 전 행을 건드리되, **금액 write는 시세가 확보된
                                // 행에만** 한다(mirrorEvalOf가 null이면 값은 그대로 두고 override만 정리).
                                const mapStockFund = (fn) => setPortfolio(prev => prev.map(p =>
                                  (p && (p.type === 'stock' || p.type === 'fund')) ? fn(p) : p));
                                const cycleAmtMirror = () => {
                                  if (amtMirrorState === 'off') {
                                    mapStockFund(p => {
                                      const ev = mirrorEvalOf(p);
                                      return ev === null
                                        ? { ...p, targetAmountOverride: false }
                                        : { ...p, targetAmount: roundMirrorAmt(ev, isOverseasHeader), targetAmountOverride: false };
                                    });
                                    updateSettingsForType({ ...settings, targetAmountMirror: 'seeded' });
                                  } else if (amtMirrorState === 'seeded') {
                                    mapStockFund(p => ({ ...p, targetAmountOverride: false }));
                                    updateSettingsForType({ ...settings, targetAmountMirror: 'on' });
                                  } else {
                                    // 해제: 미러를 따르던 행만 그 시점 평가금으로 박제하고, 수동 이탈 행은
                                    // 사용자가 직접 넣은 금액을 그대로 지킨다((%) 미러 off 분기와 동일).
                                    mapStockFund(p => {
                                      if (p.targetAmountOverride) return { ...p, targetAmountOverride: false };
                                      const ev = mirrorEvalOf(p);
                                      return ev === null ? p : { ...p, targetAmount: roundMirrorAmt(ev, isOverseasHeader) };
                                    });
                                    updateSettingsForType({ ...settings, targetAmountMirror: 'off' });
                                  }
                                  // 편집 중이던 셀의 로컬 초안이 남아 있으면 새 값이 화면에 안 보인다.
                                  setEditingTargetAmount({});
                                  if (onAdminTargetChange) onAdminTargetChange();
                                };
                                const btnColor = amountDisabled
                                  ? 'text-gray-700 cursor-not-allowed'
                                  : amtMirrorState === 'on'
                                    ? 'text-emerald-400 hover:text-emerald-300 drop-shadow-[0_0_4px_rgba(16,185,129,0.6)]'
                                    : amtMirrorState === 'seeded'
                                      ? 'text-emerald-300/70 hover:text-emerald-400'
                                      : 'text-gray-500 hover:text-emerald-400';
                                const btnTitle = amountDisabled
                                  ? "투자선택이 목표비중 기준이라 목표금액 미러가 잠겨 있습니다 — 우측 상단 '투자선택'을 '목표금액'으로 바꾸세요"
                                  : amtMirrorState === 'on'
                                    ? '라이브 미러 ON — 목표금액이 현재 평가금을 따라갑니다(매매 0). 클릭하여 해제 (현재 평가금 박제)'
                                    : amtMirrorState === 'seeded'
                                      ? '시드 완료 — 클릭하여 라이브 미러 시작(평가금 추종)'
                                      : '클릭 1: 현재 평가금을 목표금액에 복사 | 다음 클릭: 라이브 미러(평가금 추종)';
                                return (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      if (amountDisabled) return;
                                      // 시세가 하나도 안 들어온 상태에서 0을 박제하지 않도록 (%)와 같은 가드.
                                      if (totals.totalEval <= 0) return;
                                      cycleAmtMirror();
                                    }}
                                    className={`text-[11px] font-bold leading-none transition-colors select-none ${btnColor}`}
                                    title={btnTitle}
                                  >{isOverseasHeader ? '($)' : '(₩)'}</button>
                                );
                              })()}
                            </div>
                          </div>
                        </th>
                      )}
                      {!H('curRatio') && (
                        <th className="py-3 px-3 min-w-[80px] text-gray-400 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap" onClick={() => handleRebalanceSort('curEval')}>
                          {hideStrip('curRatio')}
                          현재비중{arr('curEval')}
                        </th>
                      )}
                      {!H('action') && (
                        <th className="py-3 px-3 min-w-[75px] text-blue-300 text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap" onClick={() => handleRebalanceSort('action')}>
                          {hideStrip('action')}
                          수량{arr('action')}
                        </th>
                      )}
                      {!H('extraQty') && (
                        <th className="py-3 px-3 min-w-[65px] text-orange-300 text-center sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap">
                          {hideStrip('extraQty')}
                          추가
                        </th>
                      )}
                      {!H('maxAdd') && (
                        <th className="py-3 px-3 min-w-[85px] text-cyan-400 text-center sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap">
                          {hideStrip('maxAdd')}
                          추가 가능
                        </th>
                      )}
                      {!H('expQty') && (
                        <th className="py-3 px-3 min-w-[90px] text-blue-300 text-center font-normal sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap">
                          {hideStrip('expQty')}
                          예상 주식수
                        </th>
                      )}
                      {!H('cost') && (
                        <th className="py-3 px-3 min-w-[100px] text-blue-300 text-center font-normal cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap" onClick={() => handleRebalanceSort('cost')}>
                          {hideStrip('cost')}
                          실 구매비용{arr('cost')}
                        </th>
                      )}
                      {!H('expEval') && (
                        <th className="py-3 px-3 min-w-[100px] text-yellow-500 text-center font-bold cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap" onClick={() => handleRebalanceSort('expEval')}>
                          {hideStrip('expEval')}
                          예상평가금{arr('expEval')}
                        </th>
                      )}
                      {!H('expRatio') && (
                        <th className="py-3 px-3 min-w-[85px] text-yellow-500 font-bold text-center cursor-pointer hover:bg-gray-700 sticky top-0 z-20 bg-[#1e293b] relative whitespace-nowrap" onClick={() => handleRebalanceSort('expRatio')}>
                          {hideStrip('expRatio')}
                          예상비중{arr('expRatio')}
                        </th>
                      )}
                    </tr>
                  );
                })()}
              </thead>
              <tbody>
                {(() => {
                  // 추가 가능(maxAdd) = 표시 잔액(rebalBalance) ÷ 종목가격. 헤더 '잔액'과 동일한
                  // rebalBalance를 직접 사용 — 과거 별도 재계산(effectiveRemaining)이 리밸런싱
                  // 모드에서 예수금을 누락해 잔액이 +인데도 음수로 표시되던 버그 방지.
                  const isOverseas = activePortfolioAccountType === 'overseas';
                  const usdkrw = marketIndicators.usdkrw || 1;
                  const fmtUSD = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));
                  const catOrder = [];
                  const grouped = {};
                  rebalanceData.forEach(item => {
                    const cat = item.category || '기타';
                    if (!grouped[cat]) { grouped[cat] = []; catOrder.push(cat); }
                    grouped[cat].push(item);
                  });
                  const parseHex = (hex) => {
                    const m = hex.replace('#', '').match(/.{2}/g);
                    if (!m) return null;
                    const [r, g, b] = m.map(x => parseInt(x, 16) / 255);
                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                    const l = (max + min) / 2;
                    if (max === min) return [0, 0, l * 100];
                    const d = max - min;
                    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                    let h;
                    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                    else if (max === g) h = ((b - r) / d + 2) / 6;
                    else h = ((r - g) / d + 4) / 6;
                    return [h * 360, s * 100, l * 100];
                  };
                  const genShades = (baseHex, count) => {
                    const hsl = parseHex(baseHex);
                    if (!hsl || count === 1) return Array(count).fill(baseHex);
                    const [h, s, l] = hsl;
                    return Array.from({ length: count }, (_, i) => {
                      const t = i / (count - 1);
                      const shade = Math.min(78, Math.max(28, l + 18 - t * 36));
                      return `hsl(${h.toFixed(0)},${Math.min(100, s + 5).toFixed(0)}%,${shade.toFixed(0)}%)`;
                    });
                  };
                  const itemColorMap = {};
                  catOrder.forEach(cat => {
                    const baseHex = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const shades = genShades(baseHex, grouped[cat].length);
                    grouped[cat].forEach((item, j) => { itemColorMap[`${cat}::${item.id}`] = shades[j]; });
                  });
                  let rowNum = 0;
                  const renderRow = (item, catTd) => {
                    rowNum += 1;
                    const num = rowNum;
                    const isSavings = item.type === 'savings';
                    const cat = item.category || '기타';
                    const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const itemColor = itemColorMap[`${cat}::${item.id}`] || catColor;
                    const extraQty = rebalExtraQty[item.id] || 0;
                    const totalAction = item.action + extraQty;
                    const itemPrice = cleanNum(item.currentPrice);
                    const adjustedCost = totalAction * itemPrice;
                    const displayAdjustedCost = -adjustedCost;
                    const maxAdd = itemPrice > 0 ? rebalBalance / itemPrice : 0;
                    const isLinked = !!maxAddLink[item.id];
                    // 연동 시 채울 수량 = 현재 추가가능(잔액÷현재가) + 이미 이 행이 가져간 추가(extra)
                    const linkCapacity = maxAdd + extraQty;
                    const markColor = markedRebalRows[item.id];
                    const rowMarkClass = markColor ? MARK_ROW_BG[markColor] : 'hover:bg-gray-800';
                    const stickyCellClass = markColor ? MARK_STICKY_BG[markColor] : 'bg-[#0f172a] group-hover:bg-gray-800';
                    return (
                      <tr key={item.id} className={`group border-b border-gray-700 ${rowMarkClass} transition-colors`}>
                        {catTd}
                        {!H('changeRate') && (
                          <td className={`py-3 px-2 text-center ${stickyCellClass} transition-colors focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none`} style={{ position: 'sticky', left: changeRateLeft, zIndex: 5 }} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                            <span className={`text-xs font-bold ${(item.changeRate || 0) > 0 ? 'text-red-400' : (item.changeRate || 0) < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{item.changeRate != null ? formatChangeRate(item.changeRate) : '-'}</span>
                          </td>
                        )}
                        {!H('returnRate') && (
                          <td className={`py-3 px-2 text-center ${stickyCellClass} transition-colors focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none`} style={{ position: 'sticky', left: returnRateLeft, zIndex: 5 }} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                            <span className={`text-xs font-bold ${(item.returnRate || 0) > 0 ? 'text-red-400' : (item.returnRate || 0) < 0 ? 'text-blue-400' : 'text-gray-500'}`}>{item.returnRate != null ? formatChangeRate(item.returnRate) : '-'}</span>
                          </td>
                        )}
                        {!H('name') && (
                          <td className={`py-3 px-4 text-center font-bold ${stickyCellClass} transition-colors [box-shadow:2px_0_6px_rgba(0,0,0,0.5)] focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none`} style={{ position: 'sticky', left: nameLeft, zIndex: 5, color: itemColor }} tabIndex={0} onKeyDown={handleReadonlyCellNav}>
                            {(() => { const url = getItemUrl(item); return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 hover:underline" style={{ color: itemColor }}>{num}. {item.name}</a> : <div className="line-clamp-2">{num}. {item.name}</div>; })()}
                          </td>
                        )}
                        {!H('code') && (
                          <td className="py-3 px-3 text-center text-gray-500 font-mono text-xs focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{item.code}</td>
                        )}
                        {!H('curEval') && (
                          <td className="py-3 px-3 text-gray-400 text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-center gap-0.5"><span>{fmtUSD(item.curEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.curEval * usdkrw)}</span></div> : formatCurrency(item.curEval)}</td>
                        )}
                        {!H('currentPrice') && (
                          <td
                            className={`py-3 px-3 font-mono text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none transition-colors ${totalAction > 0 ? 'text-gray-300 cursor-pointer hover:bg-blue-900/30 hover:text-blue-300' : 'text-gray-500'}`}
                            tabIndex={0}
                            onKeyDown={handleReadonlyCellNav}
                            onClick={totalAction > 0 ? (e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const x = Math.max(8, Math.min(rect.right + 8, window.innerWidth - 416));
                              const y = Math.max(8, Math.min(rect.top - 20, window.innerHeight - 540));
                              setLadderModal({
                                itemName: item.name,
                                currentPrice: itemPrice,
                                totalAction,
                                rebalFund: totalAction * itemPrice,
                                currency: isOverseas ? 'USD' : 'KRW',
                                fxRate: isOverseas ? usdkrw : 1,
                                pos: { x, y },
                              });
                            } : undefined}
                            title={totalAction > 0 ? '클릭하여 분할매수 계산기 열기' : undefined}
                          >
                            {isSavings ? <span className="text-gray-600">-</span> : isOverseas ? <div className="flex flex-col items-center gap-0.5"><span>{fmtUSD(item.currentPrice)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.currentPrice * usdkrw)}</span></div> : formatNumber(item.currentPrice)}
                          </td>
                        )}
                        {!H('targetRatio') && (() => {
                          const itemCurRatio = totals.totalEval > 0 ? (isOverseas ? item.curEval * usdkrw : item.curEval) / totals.totalEval * 100 : 0;
                          const threshold = isOverseas ? 0.005 : 0.05;
                          const isDifferent = Math.abs((item.effectiveTargetRatio || 0) - itemCurRatio) > threshold;
                          const targetMode = settings.targetMode === 'variable' ? 'variable' : 'fixed';
                          const { slotField, overrideField, mirrorField } = resolveTargetSlots(settings);
                          const mirrorState = settings[mirrorField] || 'off';
                          const isLiveMirror = mirrorState === 'on' && !item[overrideField];
                          const slotVal = cleanNum(item[slotField]) || 0;
                          const baseVal = isLiveMirror ? itemCurRatio : slotVal;
                          const displayVal = editingRatio[item.id] !== undefined
                            ? editingRatio[item.id]
                            : baseVal.toFixed(2);
                          const textColor = isLiveMirror
                            ? 'text-emerald-300/80 italic'
                            : targetMode === 'variable'
                              ? (isDifferent ? 'text-red-400' : 'text-amber-300')
                              : (isDifferent ? 'text-red-400' : 'text-green-400');
                          // 투자선택이 '목표금액'이면 이 열 전체가 비활성(값은 남고 편집만 잠김).
                          // ⚠️ ratioDisabled는 PIN 잠금(cellLocked)과 성격이 다르다 — 풀 수 있는 잠금이
                          //    아니라 모드가 정한 상태라, 클릭해도 PIN 모달을 띄우지 않는다.
                          const ratioMuted = ratioDisabled;
                          const cellLocked = targetMode !== 'variable' && !targetEditAuthorized && !isAdmin;
                          const ratioReadOnly = cellLocked || ratioDisabled;
                          const showResetIcon = !isLiveMirror && (item[overrideField] || Math.abs(baseVal - itemCurRatio) > threshold);
                          const alwaysShowReset = !!item[overrideField];
                          const applyReset = () => {
                            setPortfolio(prev => prev.map(p => p.id === item.id
                              ? { ...p, [slotField]: itemCurRatio, [overrideField]: false }
                              : p
                            ));
                            setEditingRatio(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                            reportAdminChange();
                          };
                          return (
                            <td className={`p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 relative ${cellLocked && !ratioDisabled ? 'cursor-pointer' : ''}`}
                              onClick={cellLocked && !ratioDisabled ? (e => {
                                e.preventDefault();
                                const tr = e.currentTarget.closest('tr');
                                const focusBack = () => {
                                  const ip = tr?.querySelector(`input[data-col="targetRatio"][data-item-id="${item.id}"]`);
                                  if (ip) { ip.focus(); ip.select?.(); }
                                };
                                setPinModal({ onAuthorized: () => setTimeout(focusBack, 80) });
                              }) : undefined}
                            >
                              <input type="text" data-col="targetRatio" data-item-id={item.id} className={`w-full h-full bg-transparent text-center font-bold outline-none py-3 pr-6 caret-blue-400 ${textColor} ${ratioMuted ? 'opacity-40 focus:opacity-100' : ''} ${cellLocked ? 'cursor-pointer focus:bg-amber-900/10' : 'focus:bg-blue-900/20'}`}
                                value={displayVal}
                                readOnly={ratioReadOnly}
                                onChange={e => { if (!ratioReadOnly) setEditingRatio(prev => ({ ...prev, [item.id]: e.target.value })); }}
                                onBlur={e => {
                                  if (ratioReadOnly) return;
                                  // ⚠️ 변경 판정은 시세 파생 baseVal이 아니라 슬롯 원본 slotVal로 한다 —
                                  // 라이브 미러에선 baseVal이 현재비중이라 포커스~blur 사이 시세가 움직이면
                                  // 한 글자도 안 쳤는데 '변경'으로 오판된다. 반대로 미러 이탈(override 최초
                                  // 박제)은 값이 같아도 명백한 목표 변경이므로 무조건 변경으로 친다.
                                  const mirrorDetach = mirrorState === 'on' && !item[overrideField];
                                  const changed = Math.round(cleanNum(e.target.value) * 100) !== Math.round(slotVal * 100) || mirrorDetach;
                                  handleUpdate(item.id, slotField, e.target.value);
                                  if (mirrorState === 'on') {
                                    setPortfolio(prev => prev.map(p => p.id === item.id ? { ...p, [overrideField]: true } : p));
                                  }
                                  setEditingRatio(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                  if (onAdminTargetChange) onAdminTargetChange();
                                  if (changed && onTargetEdited) onTargetEdited(); // 실제 편집일 때만 달력 기록 대상
                                }}
                                onFocus={e => {
                                  if (ratioReadOnly) {
                                    e.target.blur();
                                    return;
                                  }
                                  setEditingRatio(prev => ({ ...prev, [item.id]: e.target.value }));
                                  e.target.select();
                                }}
                                onKeyDown={e => {
                                  if (ratioReadOnly) { e.preventDefault(); return; }
                                  if (e.key === 'Enter') e.target.blur();
                                  handleTableKeyDown(e, 'targetRatio');
                                }}
                                title={ratioDisabled ? "투자선택이 '목표금액'이라 목표비중은 비활성입니다 (수량은 목표금액으로 계산)" : cellLocked ? '잠금 — 클릭하여 비밀번호 입력' : isLiveMirror ? '라이브 미러 추종 중 — 편집 시 이 종목만 수동 고정' : undefined}
                              />
                              {showResetIcon && !ratioDisabled && (
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (cellLocked) {
                                      setPinModal({ onAuthorized: applyReset });
                                    } else {
                                      applyReset();
                                    }
                                  }}
                                  className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-500 hover:text-emerald-300 hover:bg-emerald-900/20 transition-all ${alwaysShowReset ? 'opacity-80' : 'opacity-0 group-hover:opacity-60'} hover:!opacity-100`}
                                  title={alwaysShowReset ? '수동 편집됨 — 클릭하여 현재 비중으로 복원' : '현재 비중으로 복원'}
                                >
                                  <RotateCcw size={11} />
                                </button>
                              )}
                            </td>
                          );
                        })()}
                        {!H('targetAmount') && (() => {
                          // 목표금액 셀 — 값이 있으면 그 행의 수량이 비중이 아니라 금액에서 나온다.
                          // ⚠️ 예적금(savings)도 반드시 **포커서블 1개**를 내야 한다(읽기전용 td[tabIndex=0]).
                          //    utils.getRowFocusables가 행 내 '위치 인덱스'로 위/아래 이동을 계산하므로,
                          //    한 행만 포커서블 수가 다르면 그 행부터 세로 이동이 한 칸씩 어긋난다.
                          const hasAmt = !!item.hasTargetAmount;
                          // (₩) 라이브 미러 추종 행 — 저장값이 아니라 현재 평가금이 목표금액이다(매매 0).
                          // ⚠️ 판정은 usePortfolioData가 실어 보낸 값을 그대로 쓴다 — 여기서 손으로 다시
                          //    계산하면 표시와 수량 계산이 다른 기준을 읽을 수 있다.
                          const isAmtMirror = !!item.isAmtLiveMirror;
                          const amtMirrorOn = isAmountMode && (settings.targetAmountMirror || 'off') === 'on';
                          const hintAmt = cleanNum(item.targetAmountHint);
                          const effAmt = cleanNum(item.effectiveTargetAmount);
                          const hintText = isOverseas ? (hintAmt ? hintAmt.toFixed(2) : '0') : formatNumber(Math.round(hintAmt));
                          if (isSavings) {
                            return (
                              <td className="py-3 px-3 text-center text-gray-600 focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav} title="예적금은 시세·수량이 없어 매매 대상이 아닙니다 — 평가금이 그대로 이월됩니다">{hintText}</td>
                            );
                          }
                          // ⚠️ onFocus 초안에 계산값(String(effAmt))을 넣지 말 것 — 표시값은 formatNumber라
                          //    콤마 유무로 문자열이 달라지고, React가 커밋에서 node.value를 다시 쓰면서
                          //    방금 건 전체선택이 풀린다(캐럿 끝으로 이동) → 타이핑이 기존 값 뒤에 이어붙어
                          //    1,000,000에 5를 치면 10000005가 된다. DOM 값 그대로 담아야 재대입이 없다.
                          const draft = editingTargetAmount[item.id];
                          // 미러 추종 값은 시세 파생 실수라 표시 자릿수를 정리한다(원화 1원 / 외화 1센트).
                          const baseAmtText = hasAmt
                            ? (isAmtMirror
                              ? (isOverseas ? effAmt.toFixed(2) : formatNumber(Math.round(effAmt)))
                              : (isOverseas ? String(effAmt) : formatNumber(effAmt)))
                            : '';
                          const displayAmt = draft !== undefined ? draft : baseAmtText;
                          // ⚠️ 커밋은 handleUpdate가 아니라 setPortfolio로 한다 — handleUpdate는 cleanNum을
                          //    거쳐 빈칸을 0으로 바꾸므로 '미입력'과 '목표 0원(전량 매도)'을 구분할 수 없다.
                          // ⚠️ 값이 그대로면 아무것도 쓰지 말 것 — 빈 칸을 탭으로 지나가기만 해도
                          //    targetAmount:''가 새로 박혀 지문이 바뀌고 Drive 전량 저장이 도는 데다,
                          //    portfolio 참조가 갈려 표 전체가 재계산된다.
                          // ⚠️ 비교 기준은 저장 원시값(effAmt)이 아니라 **화면에 보이던 문자열**이다 —
                          //    formatNumber가 소수 3자리로 반올림하므로, 시세 파생 실수(미러 추종 값)에서
                          //    원시값과 비교하면 한 글자도 안 치고 탭으로 지나가기만 해도 '변경'으로 오판돼
                          //    라이브 미러에서 조용히 이탈한다.
                          const commitAmt = (raw) => {
                            // 1차: 포커스 시점 문자열과 그대로면 사용자가 한 글자도 안 쳤다 → 무조건 no-op.
                            const focusVal = amtFocusValRef.current[item.id];
                            delete amtFocusValRef.current[item.id];
                            if (focusVal !== undefined && String(raw ?? '') === focusVal) return;
                            const trimmed = String(raw ?? '').trim();
                            const next = /\d/.test(trimmed) ? cleanNum(trimmed) : '';
                            const prevNorm = hasAmt ? cleanNum(baseAmtText) : '';
                            if (prevNorm === next) return;
                            // 라이브 미러 중 직접 입력 = 이 종목만 수동 고정(override). 비우면 미러로 복귀.
                            setPortfolio(prev => prev.map(p => p.id === item.id
                              ? {
                                ...p,
                                targetAmount: next,
                                targetAmountOverride: next === '' ? false : (amtMirrorOn ? true : p.targetAmountOverride),
                              }
                              : p));
                            // 관리자 접속(impersonation) 중 목표 변경 통지 — 목표금액은 목표비중을 무효화하는
                            // 상위 값이라 비중 편집과 같은 등급으로 알린다(세션당 1회 래치라 추가 비용 0).
                            // ⚠️ reportAdminChange 재사용 금지 — onTargetEdited까지 발화하면 헤더 날짜의
                            //    달력 기록이 함께 덮인다(복원 섹션 INV-2와 같은 이유).
                            if (onAdminTargetChange) onAdminTargetChange();
                          };
                          return (
                            <td className="p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-emerald-500 relative">
                              <input
                                type="text"
                                inputMode="decimal"
                                data-col="targetAmount"
                                data-item-id={item.id}
                                className={`w-full h-full bg-transparent text-center font-bold outline-none py-3 pr-6 caret-emerald-400 focus:bg-emerald-900/20 placeholder:text-gray-600 placeholder:font-normal ${isAmtMirror ? 'text-emerald-300/80 italic' : hasAmt ? 'text-emerald-300' : 'text-gray-400'} ${amountDisabled ? 'opacity-40' : ''}`}
                                value={displayAmt}
                                placeholder={hintText}
                                readOnly={amountDisabled}
                                title={amountDisabled
                                  ? "투자선택이 목표비중 기준이라 이 열은 비활성입니다 — '투자선택'을 '목표금액'으로 바꾸면 이 금액이 수량을 만듭니다"
                                  : isAmtMirror
                                    ? '라이브 미러 추종 중 — 목표금액 = 현재 평가금(매매 0). 직접 입력하면 이 종목만 수동 고정'
                                    : hasAmt
                                      ? (isOverseas ? `목표 평가금액 ${formatCurrency(effAmt * usdkrw)} (원화 환산) — 이 행은 목표비중 대신 금액으로 수량을 계산합니다` : '이 행은 목표비중 대신 목표금액으로 수량을 계산합니다')
                                      : `비어 있으면 목표비중 기준 (참고: 비중대로 매매하면 ${hintText}${isOverseas ? '' : '원'})`}
                                onChange={e => {
                                  if (amountDisabled) return;
                                  const cleaned = e.target.value.replace(/[^0-9.]/g, '');
                                  const parts = cleaned.split('.');
                                  const raw = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
                                  setEditingTargetAmount(prev => ({ ...prev, [item.id]: raw }));
                                }}
                                onFocus={e => {
                                  if (amountDisabled) { e.target.blur(); return; }
                                  amtFocusValRef.current[item.id] = e.target.value;
                                  setEditingTargetAmount(prev => ({ ...prev, [item.id]: e.target.value }));
                                  e.target.select();
                                }}
                                onBlur={e => {
                                  if (amountDisabled) return;
                                  commitAmt(e.target.value);
                                  setEditingTargetAmount(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                }}
                                onKeyDown={e => {
                                  if (amountDisabled) { e.preventDefault(); return; }
                                  if (e.key === 'Enter') e.target.blur();
                                  handleTableKeyDown(e, 'targetAmount');
                                }}
                              />
                              {/* 미러 추종 중인 행에는 지울 값이 없다 → 숨긴다. 미러에서 이탈(수동 고정)한
                                  행은 값이 없어도 버튼을 남겨 라이브 미러로 되돌아갈 길을 준다. */}
                              {!isAmtMirror && (hasAmt || !!item.targetAmountOverride) && !amountDisabled && (
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={e => {
                                    e.stopPropagation();
                                    setEditingTargetAmount(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                    setPortfolio(prev => prev.map(p => p.id === item.id ? { ...p, targetAmount: '', targetAmountOverride: false } : p));
                                    if (onAdminTargetChange) onAdminTargetChange();
                                  }}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-500 hover:text-emerald-300 hover:bg-emerald-900/20 transition-all opacity-80 hover:!opacity-100"
                                  title={amtMirrorOn && item.targetAmountOverride
                                    ? '수동 고정됨 — 클릭하여 라이브 미러(현재 평가금)로 복귀'
                                    : '목표금액 지우기 — 다시 목표비중 기준으로 계산'}
                                >
                                  <RotateCcw size={11} />
                                </button>
                              )}
                            </td>
                          );
                        })()}
                        {!H('curRatio') && (
                          <td className="py-3 px-3 text-center text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{(totals.totalEval > 0 ? (isOverseas ? item.curEval * usdkrw : item.curEval) / totals.totalEval * 100 : 0).toFixed(isOverseas ? 2 : 1)}%</td>
                        )}
                        {!H('action') && (
                          <td className={`py-3 px-3 text-center font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${totalAction > 0 ? 'text-green-400' : totalAction < 0 ? 'text-red-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isSavings ? '-' : (totalAction > 0 ? '+' : '') + totalAction}</td>
                        )}
                        {!H('extraQty') && (isSavings ? (
                          <td className="py-3 px-3 text-center text-gray-600 focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>-</td>
                        ) : (
                          <td className="p-0 border-r border-gray-700/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-orange-500">
                            {/* ⚠️ 초안(editingExtra) 경유 필수 — value를 숫자 상태에 직결하면 '-' 한 글자가
                                parseInt에서 NaN→0이 되어 controlled value가 즉시 ''로 되돌아가고,
                                **마이너스 부호를 찍는 것 자체가 불가능**해진다(음수 매도 수량 직접 입력 불가).
                                ⚠️ rebalExtraQty에 저장하는 값은 반드시 number — 문자열로 두면
                                (수량 + action + extraQty) * price 가 문자열 결합이 되어 예상평가금·
                                매수/매도 합계·추가가능 풀이 전부 오염된다(타입체크 없는 빌드라 못 잡는다). */}
                            <input type="text" className={`w-full h-full bg-transparent text-center font-bold outline-none py-3 caret-orange-400 min-w-[65px] ${isLinked ? 'text-cyan-300 focus:bg-cyan-900/20' : 'text-orange-300 focus:bg-orange-900/20'}`}
                              value={editingExtra[item.id] !== undefined ? editingExtra[item.id] : (extraQty !== 0 ? String(extraQty) : '')}
                              placeholder="0"
                              title={isLinked ? '추가 가능 연동 중 — 직접 입력하면 연동 해제' : '매수는 그대로, 매도는 -를 붙여 입력 (예: -3)'}
                              onChange={e => {
                                // ⚠️ 유니코드 마이너스류를 먼저 ASCII '-'로 정규화 — 안 하면 붙여넣은
                                //    '−5'(U+2212)에서 부호만 사라져 **매도가 매수로 뒤집힌다**.
                                const src = e.target.value.replace(/[−–—－]/g, '-').trim();
                                const digits = src.replace(/[^\d]/g, '');
                                const raw = (src.startsWith('-') ? '-' : '') + digits;
                                const parsed = parseInt(raw, 10);
                                const val = Number.isFinite(parsed) ? parsed : 0;
                                setEditingExtra(prev => ({ ...prev, [item.id]: raw }));
                                if (maxAddLink[item.id]) setMaxAddLink(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                setRebalExtraQty(prev => ({ ...prev, [item.id]: val }));
                              }}
                              onFocus={e => e.target.select()}
                              onBlur={() => setEditingExtra(prev => { const n = { ...prev }; delete n[item.id]; return n; })}
                            />
                          </td>
                        ))}
                        {!H('maxAdd') && (
                          <td
                            className={`py-3 px-3 text-center font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none transition-colors ${isSavings ? '' : 'cursor-pointer'} ${isLinked ? 'bg-cyan-900/30 ring-1 ring-inset ring-cyan-500/50' : !isSavings ? 'hover:bg-cyan-900/15' : ''} ${maxAdd > 0 ? 'text-cyan-400' : maxAdd < 0 ? 'text-red-400' : 'text-gray-500'}`}
                            tabIndex={0}
                            onKeyDown={handleReadonlyCellNav}
                            onClick={isSavings ? undefined : () => toggleMaxAddLink(item.id, linkCapacity)}
                            title={isSavings ? undefined : isLinked ? '추가 가능 연동 ON — 클릭하여 해제(추가 0)' : '클릭하여 추가 수량에 연동 (가격 변동 시 자동 갱신)'}
                          >{isSavings ? '-' : maxAdd === 0 ? '0' : (maxAdd > 0 ? '+' : '') + maxAdd.toFixed(2)}</td>
                        )}
                        {!H('expQty') && (() => {
                          const expQty = cleanNum(item.quantity) + totalAction;
                          return (
                            <td className="py-3 px-3 text-center text-gray-200 font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isSavings ? '-' : formatNumber(expQty)}</td>
                          );
                        })()}
                        {!H('cost') && (
                          <td className={`py-3 px-3 font-bold text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none ${displayAdjustedCost > 0 ? 'text-sky-300' : displayAdjustedCost < 0 ? 'text-red-400' : 'text-gray-500'}`} tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isSavings ? <span className="text-gray-600">-</span> : isOverseas ? <div className="flex flex-col items-center gap-0.5"><span>{fmtUSD(displayAdjustedCost)}</span><span className="text-[11px] opacity-70">{formatCurrency(displayAdjustedCost * usdkrw)}</span></div> : formatCurrency(displayAdjustedCost)}</td>
                        )}
                        {!H('expEval') && (
                          <td className="py-3 px-3 font-bold text-yellow-500 text-center focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{isOverseas ? <div className="flex flex-col items-center gap-0.5"><span>{fmtUSD(item.expEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(item.expEval * usdkrw)}</span></div> : formatCurrency(item.expEval)}</td>
                        )}
                        {!H('expRatio') && (
                          <td className="py-3 px-3 text-center text-yellow-600 font-bold focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none" tabIndex={0} onKeyDown={handleReadonlyCellNav}>{item.expRatio.toFixed(isOverseas ? 2 : 1)}%</td>
                        )}
                      </tr>
                    );
                  };
                  if (rebalanceSortConfig.key !== null) {
                    return rebalanceData.map(item => {
                      const cat = item.category || '기타';
                      const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                      const mc = markedRebalRows[item.id];
                      const bgClass = mc ? MARK_STICKY_BG[mc] : 'bg-[#0f172a] group-hover:bg-gray-800';
                      const catTd = H('category') ? null : (
                        <td
                          className={`py-3 px-3 text-center font-bold border-r border-gray-700 align-middle ${bgClass} sticky left-0 z-[5] cursor-pointer transition-colors`}
                          onClick={() => onToggleMarkedRebalRow(item.id)}
                          title="클릭하여 매도/매수 표시 토글 (노랑→슬레이트→로즈→갈색→해제)"
                        >
                          <div style={{ color: catColor }} className="text-xs">{cat}</div>
                        </td>
                      );
                      return renderRow(item, catTd);
                    });
                  }
                  return catOrder.flatMap(cat => {
                    const items = grouped[cat];
                    const catColor = UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[cat] || '#64748B';
                    const catTotalEval = items.reduce((sum, item) => sum + item.curEval, 0);
                    const catRatio = totals.totalEval > 0 ? catTotalEval / totals.totalEval * 100 : 0;
                    return items.map((item, j) => {
                      const catTd = H('category') ? null : (j === 0
                        ? <td rowSpan={items.length} className="py-3 px-3 text-center font-bold border-r border-gray-700 align-middle bg-[#0f172a] sticky left-0 z-[5]"><div style={{ color: catColor }}>{cat}</div><div className="text-gray-400 text-[10px] font-normal mt-0.5">{isOverseas ? <>{fmtUSD(catTotalEval)}<br/><span className="text-gray-600">{formatCurrency(catTotalEval * usdkrw)}</span></> : formatCurrency(catTotalEval)}</div><div className="text-gray-400 text-[10px] font-normal">{catRatio.toFixed(1)}%</div></td>
                        : null);
                      return renderRow(item, catTd);
                    });
                  });
                })()}
              </tbody>
              <tfoot className="bg-[#1e293b] border-t-2 border-gray-500">
                <tr>
                  {stickySpanCount > 0 && (
                    <td colSpan={stickySpanCount} className="py-3 px-3 text-center uppercase tracking-widest text-gray-500 text-xs sticky left-0 z-[5] bg-[#1e293b]">TOTAL</td>
                  )}
                  {!H('code') && <td className="py-3 px-3"></td>}
                  {!H('curEval') && (() => { const totCurEval = rebalanceData.reduce((s, d) => s + d.curEval, 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className="py-3 px-3 text-gray-300 font-bold text-center">{isOv ? <div className="flex flex-col items-center gap-0.5"><span>{fmtUS(totCurEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(totCurEval * fxRate)}</span></div> : formatCurrency(totCurEval)}</td>; })()}
                  {!H('currentPrice') && <td className="py-3 px-3"></td>}
                  {!H('targetRatio') && (() => {
                    const targetSum = rebalanceData.reduce((s, d) => s + (d.effectiveTargetRatio || 0), 0);
                    const diff = 100 - targetSum;
                    const isMatch = Math.abs(diff) < 0.005;
                    return (
                      <td className="py-3 px-3 text-center font-bold text-green-400">
                        <div>{targetSum.toFixed(2)}%</div>
                        <div className={`text-[10px] font-normal mt-0.5 ${isMatch ? 'text-green-300' : 'text-amber-300'}`}>
                          {diff >= 0 ? '+' : ''}{diff.toFixed(2)}%
                        </div>
                      </td>
                    );
                  })()}
                  {!H('targetAmount') && (() => {
                    // Σ목표금액 = 입력값(있는 행) + 목표비중 파생 힌트(없는 행). 목표비중 TOTAL과 같은
                    // 집합을 더하므로 두 합계가 서로 대응한다(예적금 포함, 예수금은 양쪽 다 미포함).
                    const amtSum = rebalanceData.reduce((s, d) => s + cleanNum(d.effectiveTargetAmount), 0);
                    const setCount = rebalanceData.filter(d => d.hasTargetAmount).length;
                    // (₩) 라이브 미러 중에는 '금액 지정 N종목'이 전 행을 세어 의미가 없다 —
                    // 무엇을 따라가는 중인지와 수동 고정 행 수를 대신 보여준다.
                    const amtMirrorLive = isAmountMode && (settings.targetAmountMirror || 'off') === 'on';
                    const amtOverrideCount = amtMirrorLive
                      ? rebalanceData.filter(d => !d.isSavings && d.targetAmountOverride).length
                      : 0;
                    const isOv = activePortfolioAccountType === 'overseas';
                    const fmtAmt = (n) => isOv
                      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n))
                      : formatCurrency(n);
                    return (
                      <td className={`py-3 px-3 text-center font-bold ${isAmountMode ? 'text-emerald-300' : 'text-gray-500'}`}>
                        <div>{fmtAmt(amtSum)}</div>
                        <div className="text-[10px] font-normal mt-0.5 text-gray-500">
                          {!isAmountMode
                            ? '비중 기준 · 미적용'
                            : amtMirrorLive
                              ? `평가금 연동 중${amtOverrideCount > 0 ? ` · 수동 ${amtOverrideCount}종목` : ''}`
                              : setCount > 0 ? `금액 지정 ${setCount}종목` : '전부 비중 기준'}
                        </div>
                      </td>
                    );
                  })()}
                  {!H('curRatio') && <td className="py-3 px-3 text-center font-bold text-gray-400">100%</td>}
                  {/* 투자가능금액·매수금액·잔액 요약은 표 **바깥**(스크롤 컨테이너 밖)으로 옮겼다.
                      여기서는 각 열의 빈 칸만 채운다 — 자세한 이유는 요약 블록 위 주석 참조. */}
                  {!H('action') && <td className="py-3 px-3"></td>}
                  {!H('extraQty') && <td className="py-3 px-3"></td>}
                  {!H('maxAdd') && <td className="py-3 px-3"></td>}
                  {!H('expQty') && <td className="py-3 px-3"></td>}
                  {!H('cost') && <td className="py-3 px-3"></td>}
                  {!H('expEval') && (() => { const totExpEval = rebalanceData.reduce((s, d) => s + d.expEval, 0); const isOv = activePortfolioAccountType === 'overseas'; const fxRate = marketIndicators.usdkrw || 1; const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n)); return <td className="py-3 px-3 font-bold text-yellow-400 text-center">{isOv ? <div className="flex flex-col items-center gap-0.5"><span>{fmtUS(totExpEval)}</span><span className="text-[11px] text-gray-500">{formatCurrency(totExpEval * fxRate)}</span></div> : formatCurrency(totExpEval)}</td>; })()}
                  {!H('expRatio') && <td className="py-3 px-3 text-center font-bold text-yellow-500">100%</td>}
                </tr>
              </tfoot>
            </table>
          </div>
          {/* ⚠️ 하단 요약(투자가능금액·매수금액·잔액)과 퇴직연금 D/S 바는 표 **바깥**에 둔다 —
              가로 스크롤 컨테이너(overflow-x-auto) 밖이라 열 구성·가로 스크롤과 완전히 무관하다.
              과거엔 요약이 '실 구매비용' 열의 colSpan td 안에 있어 ① 그 열을 숨기면 요약이 통째로
              사라지고 ② 열이 많아 가로 스크롤이 생기면 오른쪽으로 밀려 화면에서 사라졌다.
              퇴직연금 바도 같은 이유(colSpan 행이라 스크롤과 함께 밀림)로 함께 뺐다.
              ⚠️ 다시 tfoot 안으로 되돌리지 말 것 — 되돌리면 두 결함이 그대로 재발한다.
              ⚠️ 열 개수에 의존하는 값(colSpan)을 여기서 다시 만들지 말 것. */}
          {(() => {
            const isOv = activePortfolioAccountType === 'overseas';
            const fmtUS = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanNum(n));
            const fmtAmt = (n) => isOv ? fmtUS(n) : formatCurrency(n);
            const depositLabel = isLevelMode ? '예수금' : '사용예수금';
            const balanceColor = rebalBalance > 0 ? 'text-sky-300' : rebalBalance < 0 ? 'text-red-400' : 'text-gray-500';
            return (
              <div className="bg-[#1e293b] border-t-2 border-gray-500 px-3 py-3 flex justify-end">
                <div className="w-full max-w-[420px] text-right">
                  <div className="flex justify-end mb-1.5">
                    <button
                      type="button"
                      onClick={() => setShowCostFormula(v => !v)}
                      className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors font-normal"
                      title={showCostFormula ? '계산식 숨기기' : '계산식 보기'}
                    >
                      계산식
                      {showCostFormula ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                  </div>
                  {showCostFormula ? (
                    <div className="flex flex-col items-end gap-1 font-normal">
                      <div className="text-[10px] text-gray-400 font-bold w-full text-right">총 구매 가능 금액</div>
                      <div className="flex items-center justify-end gap-2 w-full">
                        <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">매도</span>
                        <span className="font-bold text-sky-300 text-[12px]">{fmtAmt(headerTotalSell)}</span>
                      </div>
                      <div className="flex items-center justify-end gap-2 w-full">
                        <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">+ {depositLabel}</span>
                        <span className="font-bold text-gray-300 text-[12px]">{fmtAmt(headerDepositForBuy)}</span>
                      </div>
                      <div className="flex items-center justify-end gap-2 w-full">
                        <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">+ 적립금</span>
                        <span className="font-bold text-orange-300 text-[12px]">{fmtAmt(headerAmount)}</span>
                      </div>
                      <div className="flex items-center justify-end gap-2 w-full border-t border-gray-700/40 pt-1">
                        <span className="text-[10px] text-gray-400 leading-tight whitespace-nowrap font-bold">= 총 구매 가능 금액</span>
                        <span className="font-bold text-green-300 text-[12px]">{fmtAmt(rebalTotalAvailable)}</span>
                      </div>
                      <div className="flex items-center justify-end gap-2 w-full mt-1">
                        <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">− 매수금액</span>
                        <span className="font-bold text-red-300 text-[12px]">{fmtAmt(headerTotalBuy)}</span>
                      </div>
                      <div className="flex items-center justify-end gap-2 w-full border-t border-gray-700/60 pt-1.5 mt-0.5">
                        <span className="text-[10px] text-gray-400 leading-tight whitespace-nowrap font-bold">= 잔액</span>
                        <span className={`font-bold text-[13px] ${balanceColor}`}>{fmtAmt(rebalBalance)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-2 items-baseline">
                      <span className="text-[12px] text-gray-300 font-bold whitespace-nowrap text-right">투자가능금액 :</span>
                      <span className="text-green-300 font-bold text-[14px] text-right whitespace-nowrap">{fmtAmt(rebalTotalAvailable)}</span>
                      <span className="text-gray-500 text-[11px] w-2 text-center">−</span>

                      <span className="text-[12px] text-gray-300 font-bold whitespace-nowrap text-right">매수 금액 :</span>
                      <span className="text-red-300 font-bold text-[14px] text-right whitespace-nowrap">{fmtAmt(headerTotalBuy)}</span>
                      <span className="text-gray-500 text-[11px] w-2 text-center">=</span>

                      <span className="text-[12px] text-gray-300 font-bold whitespace-nowrap text-right">잔액</span>
                      <span className={`font-bold text-[15px] text-right whitespace-nowrap ${balanceColor}`}>{fmtAmt(rebalBalance)}</span>
                      <span className="w-2" />
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {showRetirementStats && (() => {
          const depositEval = cleanNum(portfolio.find(p => p.type === 'deposit')?.depositAmount || 0);
          // 예적금은 rebalanceData 고정 행으로 포함됨 → 별도 가산 금지(이중 계상).
          const projD = rebalanceData.filter(d => getAssetClass(d) === 'D').reduce((s, d) => s + d.expEval, 0);
          const projS = rebalanceData.filter(d => getAssetClass(d) === 'S').reduce((s, d) => s + d.expEval, 0) + depositEval;
          const projTotal = projD + projS;
          const projDRatio = projTotal > 0 ? projD / projTotal * 100 : 0;
          const projSRatio = projTotal > 0 ? projS / projTotal * 100 : 0;
          const onTarget = Math.abs(projDRatio - 70) <= 5;
          return (
            <div className="border-t border-amber-600/30 bg-amber-950/20">
              <div className="py-2.5 px-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-amber-400 font-bold text-xs tracking-wide">퇴직연금 예상 자산 비율</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-red-400 font-bold text-xs">위험 D</span>
                    <span className={`font-bold text-sm ${onTarget ? 'text-red-400' : 'text-red-300'}`}>{projDRatio.toFixed(1)}%</span>
                    <span className="text-gray-600 text-[11px]">(목표 70%)</span>
                    {!onTarget && (
                      <span className="text-orange-400 text-[11px]">
                        {projDRatio > 70 ? `+${(projDRatio - 70).toFixed(1)}%` : `${(projDRatio - 70).toFixed(1)}%`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-emerald-400 font-bold text-xs">안전 S</span>
                    <span className={`font-bold text-sm ${Math.abs(projSRatio - 30) <= 5 ? 'text-emerald-400' : 'text-emerald-300'}`}>{projSRatio.toFixed(1)}%</span>
                    <span className="text-gray-600 text-[11px]">(목표 30%)</span>
                  </div>
                  <div className="flex-1 flex items-center gap-1 min-w-[120px]">
                    <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(projDRatio, 100)}%`,
                          background: onTarget
                            ? 'linear-gradient(90deg, #ef4444 0%, #f97316 100%)'
                            : 'linear-gradient(90deg, #dc2626 0%, #ea580c 100%)',
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 shrink-0">D70/S30</span>
                  </div>
                </div>
              </div>
            </div>
          );
          })()}
        </div>}

        {/* 리밸런싱 자산 비중 도넛 차트 */}
        {showDonut && <div className="bg-[#1e293b] rounded-xl border border-gray-700 shadow-lg overflow-hidden mb-6">
          <div className="p-3 bg-[#0f172a] border-b border-gray-700">
            <span className="text-white font-bold text-sm">🍩 자산 비중 비교</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-700">
            {/* 왼쪽: 리밸런싱 후 예상 자산 비중 */}
            <div className="p-4">
              <div className="text-gray-400 text-xs text-center mb-2 font-semibold">리밸런싱 후 예상 자산 비중</div>
              {rebalCatDonutData.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs">데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                    {hoveredRebalCatSlice ? (
                      <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredRebalCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredRebalCatSlice.fill }}>{hoveredRebalCatSlice.name} {(hoveredRebalCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{activePortfolioAccountType === 'overseas' ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(hoveredRebalCatSlice.value) : formatCurrency(hoveredRebalCatSlice.value)}</span>}</>
                    ) : (
                      <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                    )}
                  </div>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={rebalCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredRebalCatSlice(data)} onMouseLeave={() => setHoveredRebalCatSlice(null)}>
                          {rebalCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="w-full text-xs mt-3">
                    <thead className="text-gray-400 border-b border-gray-700">
                      <tr className="text-center">
                        <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                        <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">예상평가금</th>
                        <th className="pb-2 px-3">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = rebalCatDonutData.reduce((s, x) => s + x.value, 0);
                        return rebalCatDonutData.map(({ name, value }, i) => (
                          <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                            <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                              <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                            </td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value)}</span><span className="text-[11px] text-gray-500">{formatCurrency(value * (marketIndicators.usdkrw || 1))}</span></div> : formatCurrency(value)}</td>
                            <td className="py-1.5 px-3 text-gray-400 text-right">{total > 0 ? ((value / total) * 100).toFixed(1) : 0}%</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const total = rebalCatDonutData.reduce((s, x) => s + x.value, 0);
                        return (
                          <tr className="border-t-2 border-gray-600 bg-gray-800/40">
                            <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700 text-gray-300">합계</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-white font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(total)}</span><span className="text-[11px] text-gray-400">{formatCurrency(total * (marketIndicators.usdkrw || 1))}</span></div> : formatCurrency(total)}</td>
                            <td className="py-1.5 px-3 text-white font-bold text-right">100%</td>
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </table>
                </>
              )}
            </div>
            {/* 오른쪽: 현재 포트폴리오 자산 비중 */}
            <div className="p-4">
              <div className="text-gray-400 text-xs text-center mb-2 font-semibold">현재 자산 비중</div>
              {curCatDonutData.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs">데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="h-6 flex items-center gap-2 px-1 overflow-hidden mb-1">
                    {hoveredCurCatSlice ? (
                      <><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hoveredCurCatSlice.fill }} /><span className="text-[11px] font-bold" style={{ color: hoveredCurCatSlice.fill }}>{hoveredCurCatSlice.name} {(hoveredCurCatSlice.percent * 100).toFixed(1)}%</span>{!hideAmounts && <span className="text-[11px] text-gray-300 shrink-0 ml-1">{activePortfolioAccountType === 'overseas' ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(hoveredCurCatSlice.value / (marketIndicators.usdkrw || 1)) : formatCurrency(hoveredCurCatSlice.value)}</span>}</>
                    ) : (
                      <span className="text-gray-600 text-[10px]">항목에 마우스를 올리면 표시</span>
                    )}
                  </div>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={curCatDonutData} innerRadius="38%" outerRadius="65%" dataKey="value" label={PieLabelOutside} onMouseEnter={(data) => setHoveredCurCatSlice(data)} onMouseLeave={() => setHoveredCurCatSlice(null)}>
                          {curCatDonutData.map(({ name }, i) => <Cell key={i} fill={UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="w-full text-xs mt-3">
                    <thead className="text-gray-400 border-b border-gray-700">
                      <tr className="text-center">
                        <th className="pb-2 px-2 border-r border-gray-700">구분</th>
                        <th className="pb-2 px-3 border-r border-gray-700 text-yellow-400">평가금액</th>
                        <th className="pb-2 px-3">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {curCatDonutData.map(({ name, value }, i) => (
                        <tr key={name} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                          <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700">
                            <span style={{ color: UI_CONFIG.COLORS.CATEGORY_HEX_COLORS[name] || UI_CONFIG.COLORS.CHART_PALETTE[i % 8] }}>{name}</span>
                          </td>
                          <td className="py-1.5 px-3 border-r border-gray-700 text-gray-300 font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value / (marketIndicators.usdkrw || 1))}</span><span className="text-[11px] text-gray-500">{formatCurrency(value)}</span></div> : formatCurrency(value)}</td>
                          <td className="py-1.5 px-3 text-gray-400 text-right">{totals.totalEval > 0 ? ((value / totals.totalEval) * 100).toFixed(1) : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const total = curCatDonutData.reduce((s, x) => s + x.value, 0);
                        return (
                          <tr className="border-t-2 border-gray-600 bg-gray-800/40">
                            <td className="py-1.5 px-2 text-center font-bold border-r border-gray-700 text-gray-300">합계</td>
                            <td className="py-1.5 px-3 border-r border-gray-700 text-white font-bold text-right">{hideAmounts ? '••••••' : activePortfolioAccountType === 'overseas' ? <div className="flex flex-col items-end gap-0.5"><span>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(total / (marketIndicators.usdkrw || 1))}</span><span className="text-[11px] text-gray-400">{formatCurrency(total)}</span></div> : formatCurrency(total)}</td>
                            <td className="py-1.5 px-3 text-white font-bold text-right">100%</td>
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>}
        {/* ⚠️ z: 복원 1070 < PIN 1080 — 고정 모드 복원은 PIN을 통과해야 하는데 복원 모달이 위에 있으면
            PIN 입력창이 가려져 잠금이 사실상 우회된다. 둘 다 비차단 플로팅 창(1050/1060)보다는 위. */}
        <RebalanceTargetRestoreModal
          open={restoreOpen}
          onClose={() => setRestoreOpen(false)}
          snapshots={rebalTargetSnapshots}
          currentRows={rebalanceData}
          investMode={settings.mode || 'rebalance'}
          targetMode={settings.targetMode === 'variable' ? 'variable' : 'fixed'}
          targetDate={settings.targetDate || ''}
          locked={isFixedLocked}
          pinPending={!!pinModal}
          onRequestPin={(cb) => setPinModal({ onAuthorized: cb })}
          onApply={applyRestoredTargets}
        />
        <RebalanceTargetPinModal
          open={!!pinModal}
          authUser={authUser}
          onAuthorized={() => {
            setTargetEditAuthorized(true);
            const cb = pinModal?.onAuthorized;
            setPinModal(null);
            if (cb) cb();
          }}
          onClose={() => setPinModal(null)}
        />
        {ladderModal && (
          <LadderBuyModal
            itemName={ladderModal.itemName}
            currentPrice={ladderModal.currentPrice}
            totalAction={ladderModal.totalAction}
            rebalFund={ladderModal.rebalFund}
            currency={ladderModal.currency}
            fxRate={ladderModal.fxRate}
            pos={ladderModal.pos}
            onClose={() => setLadderModal(null)}
          />
        )}
        {noteLogOpen && (
          <div className="fixed w-[576px] shadow-2xl overflow-hidden" style={{ left: noteLogPos.x, top: noteLogPos.y, zIndex: 1000 }}>
              <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none" onMouseDown={handleNoteLogDragStart}>
                <button onClick={() => setNoteLogOpen(false)} className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all" title="닫기"><X size={10} className="text-white" /></button>
                <span className="text-[17px] font-bold tracking-[0.18em] bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-400 bg-clip-text text-transparent select-none">투자 기록</span>
                <button onClick={addNewNote} className="text-gray-500 hover:text-emerald-400 transition-colors" title="새 메모 추가"><Plus size={19} /></button>
              </div>
              <div className="overflow-y-auto max-h-[60vh]" style={{
                backgroundColor: '#000',
                backgroundImage: 'repeating-linear-gradient(transparent 0px, transparent 35px, rgba(99,130,255,0.25) 35px, rgba(99,130,255,0.25) 36px)',
                backgroundSize: '100% 36px',
                backgroundPosition: '0 0',
                lineHeight: '36px',
              }}>
                {sortedNotes.length === 0 && (
                  <div className="px-4 py-5 text-gray-600 text-[17px] text-center select-none">
                    아직 기록이 없습니다.<br />
                    <span className="text-gray-700">오른쪽 상단 + 버튼으로 추가하세요.</span>
                  </div>
                )}
                {sortedNotes.map(note => (
                  <div
                    key={note.id}
                    className="flex items-center gap-2 px-3 border-b border-gray-900/60 hover:bg-white/5 transition-colors group"
                    style={{ minHeight: '36px' }}
                  >
                    <span className="shrink-0 text-[15px] font-mono text-sky-500 w-[76px]">{formatNoteDate(note.date)}</span>
                    <span className="flex-1 text-[17px] text-gray-300 truncate overflow-hidden whitespace-nowrap">{note.content || <span className="text-gray-700 italic">내용 없음</span>}</span>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openNoteExpand(note)} className="text-gray-500 hover:text-blue-400 transition-colors" title="전체 보기/편집"><Maximize2 size={15} /></button>
                      <button onClick={() => deleteNote(note.id)} className="text-gray-500 hover:text-red-400 transition-colors" title="삭제"><Trash2 size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        )}
        {noteExpandModal && (
          <div className="fixed w-[576px] shadow-2xl overflow-hidden" style={{ left: noteExpandPos.x, top: noteExpandPos.y, zIndex: 1010 }}>
              <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none" onMouseDown={handleNoteExpandDragStart}>
                <div className="flex items-center gap-3">
                  <button onClick={() => setNoteExpandModal(null)} className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all" title="취소 (Esc)"><X size={10} className="text-white" /></button>
                  <button onClick={saveNoteExpand} className="w-[18px] h-[18px] rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center transition-all" title="저장 (Ctrl+Enter)"><Check size={10} className="text-white" /></button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    className="bg-transparent border-0 outline-none text-[15px] text-gray-500 font-mono cursor-pointer"
                    value={noteExpandModal.date}
                    onChange={e => setNoteExpandModal(prev => ({ ...prev, date: e.target.value }))}
                  />
                  <span className="text-[17px] font-bold tracking-[0.25em] bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-400 bg-clip-text text-transparent select-none">MEMO</span>
                </div>
                <div className="w-10" />
              </div>
              <textarea
                className="w-full text-gray-200 text-[18px] font-bold outline-none resize-none caret-sky-400 placeholder-gray-700"
                style={{
                  backgroundColor: '#000',
                  backgroundImage: `repeating-linear-gradient(transparent 0px, transparent 35px, rgba(99,130,255,0.3) 35px, rgba(99,130,255,0.3) 36px)`,
                  backgroundSize: '100% 36px',
                  backgroundPosition: '0 8px',
                  lineHeight: '36px',
                  paddingLeft: '10px',
                  paddingRight: '10px',
                  paddingTop: '8px',
                  paddingBottom: '8px',
                  // 세로 2배(rows 30)라도 패드 전체가 화면을 넘지 않도록 상한 — 초과분은 내부 스크롤
                  maxHeight: 'calc(100vh - 160px)',
                }}
                rows={30}
                autoFocus
                placeholder="메모를 입력하세요..."
                value={noteExpandModal.val}
                onChange={e => setNoteExpandModal(prev => ({ ...prev, val: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Escape') setNoteExpandModal(null);
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveNoteExpand();
                }}
              />
          </div>
        )}
        {helpOpen && (
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setHelpOpen(false)}>
            <div className="absolute w-[440px] shadow-2xl overflow-hidden" style={{ left: helpPos.x, top: helpPos.y }} onClick={e => e.stopPropagation()}>
              <div className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none" onMouseDown={handleHelpDragStart}>
                <button onClick={() => setHelpOpen(false)} className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all" title="닫기"><X size={10} className="text-white" /></button>
                <span className="text-[11px] font-bold tracking-[0.18em] bg-gradient-to-r from-green-400 via-emerald-400 to-sky-400 bg-clip-text text-transparent select-none">리밸런싱 계산식 안내</span>
                <div className="w-3" />
              </div>
              <div className="overflow-y-auto max-h-[78vh]" style={{
                backgroundColor: '#000',
                backgroundImage: 'repeating-linear-gradient(transparent 0px, transparent 23px, rgba(99,130,255,0.25) 23px, rgba(99,130,255,0.25) 24px)',
                backgroundSize: '100% 24px',
                backgroundPosition: '0 8px',
                lineHeight: '24px',
                padding: '8px 12px',
              }}>
                {[
                  { icon: '💰', color: 'text-amber-300', title: '투자가능금 (기준 금액)', lines: [
                    '투자가능금 = 종목/펀드 평가금 + 예수금 + 적립금',
                    '리밸런싱의 분모. 종목 비중 계산의 기준.',
                    '모든 자금(예수금·적립금·매도·매수)은 투자가능금 안에서 정의됨.',
                  ] },
                  { icon: '🎯', color: 'text-green-300', title: '각 종목의 목표 평가금', lines: [
                    '목표 평가금 = 투자가능금 × 목표비중(%)',
                    '액션(수량) = ⌊ (목표 평가금 − 현재 평가금) ÷ 종목가격 ⌋',
                    '액션 + 이면 매수, − 이면 매도.',
                  ] },
                  { icon: '💵', color: 'text-emerald-300', title: "목표금액 (투자선택 = '목표금액'일 때 적용)", lines: [
                    "우측 상단 '투자선택'을 목표금액으로 바꿔야 금액이 수량을 만든다.",
                    '리밸런싱·적립식에서는 금액이 입력돼 있어도 무시되고 목표비중이 적용된다.',
                    '수량 = (목표금액 − 현재 평가금) ÷ 종목가격, 소수점 버림(0 방향) → + 매수 / − 매도',
                    '칸이 비면 회색 참고값(비중대로 매매했을 때 도달하는 평가금)이 그대로 기준이 된다',
                    '  → 금액을 하나도 안 넣으면 목표금액 모드의 수량 = 리밸런싱 수량(완전 동일).',
                    '금액을 지정한 행은 목표비중(%)이 흐리게 표시된다 — 값은 남아 있고 효력만 정지.',
                    '0을 넣으면 사실상 전량 매도(펀드는 1좌 미만 단수가 남을 수 있음).',
                    '지우려면 칸을 비우거나 ↺ 아이콘 클릭.',
                    '예적금은 시세·수량이 없어 참고값만 표시(매매 대상 아님).',
                    '자금 계산(투자가능금·잔액)은 리밸런싱과 동일하게 총평가금·예수금 전액 기준.',
                  ] },
                  { icon: '💸', color: 'text-sky-300', title: '실 구매비용 (행별 / TOTAL)', lines: [
                    '행별 = −(액션 × 종목가격)',
                    '매도 행: + (자금 회수)',
                    '매수 행: − (자금 지출)',
                    'TOTAL = 매도총합 − 매수총합',
                  ] },
                  { icon: '⚖', color: 'text-cyan-300', title: '잔액 (리밸런싱 자금 차익)', lines: [
                    '총 구매 가능 금액 = 매도 금액 + (사용)예수금 + 적립금',
                    '잔액 = 총 구매 가능 금액 − 매수 금액',
                    '리밸런싱 모드: 예수금 전액 포함 (수량 계산이 totals.totalEval = 종목+예수금 기준)',
                    '적립식 모드: 사용예수금만 포함 (수량 계산이 사용예수금+적립금 기준)',
                    '트런케이션 오차 및 목표비중 합≠100%에서 비롯되는 차액이 잔액에 나타남.',
                  ] },
                  { icon: '➕', color: 'text-emerald-300', title: '추가 가능 수량 (행별)', lines: [
                    '추가 가능 = 잔액 ÷ 종목가격 (소수 둘째자리)',
                    '+ 값: 그만큼 더 매수 가능 (매도 차익을 추가 매수에 활용)',
                    '− 값: 그만큼 매도 더 필요 (매수가 과다하다는 신호)',
                    '"추가" 컬럼에 음수 입력 가능 — 사용자가 직접 매도 수량 조절',
                  ] },
                  { icon: '🏦', color: 'text-amber-300', title: '예수금에 적용', lines: [
                    '잔액이 + 이면 "→ 예수금에 적용" 버튼이 나타남',
                    '클릭 시: 새 예수금 = 기존 예수금 + 잔액',
                    '자동 적용 안 함 — 사용자가 직접 적용해야 다음 리밸런싱 자금이 됨',
                  ] },
                  { icon: '📊', color: 'text-purple-300', title: '계산 예시', lines: [
                    '투자가능금 100,000 (종목 99,000 + 예수금 1,000 + 적립금 0)',
                    '목표 비중 합 98.9% → 매도 약간 더 발생 가정',
                    '매수 = 50,000, 매도 = 50,500',
                    '실구매비용 TOTAL = 50,500 − 50,000 = +500',
                    '잔액 = +500 → 표시 500',
                    '추가가능 (가격 100원 종목) = 500 ÷ 100 = 5.00',
                  ] },
                ].map(({ icon, color, title, lines }) => (
                  <div key={title} className="mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`${color} font-bold text-[11px] w-4 text-center shrink-0`}>{icon}</span>
                      <span className="text-white font-bold text-[11px]">{title}</span>
                    </div>
                    {lines.map((line, i) => (
                      <div key={i} className="flex items-start gap-1.5 pl-1">
                        <span className="text-gray-600 text-[10px] shrink-0 mt-0.5">·</span>
                        <span className="text-[10px] leading-6 text-gray-400">{line}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
    </>
  );
}
