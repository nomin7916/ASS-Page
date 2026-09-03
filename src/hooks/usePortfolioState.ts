// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { UI_CONFIG } from '../config';
import { generateId, cleanNum, formatNumber, buildTransferLedgerRows, overseasInvestAmount } from '../utils';
import { getTodayKST, getBackfillBoundaryForAccount } from './useMarketCalendar';

// 행 색상 마킹 4색 사이클(노랑→슬레이트→로즈→갈색→해제). 활성 계좌 경로와 by-id(카드 별도 창)
// 경로가 **같은 함수**를 써야 두 화면의 색 순서가 갈리지 않는다.
const MARK_ORDER = ['yellow', 'slate', 'rose', 'brown'];
const cycleMarkedRow = (cur, itemId) => {
  const next = { ...(cur ?? {}) };
  const idx = MARK_ORDER.indexOf((cur ?? {})[itemId]);
  if (idx === -1) next[itemId] = MARK_ORDER[0];
  else if (idx < MARK_ORDER.length - 1) next[itemId] = MARK_ORDER[idx + 1];
  else delete next[itemId];
  return next;
};
const toggleInList = (list, key) => {
  const cur = Array.isArray(list) ? list : [];
  return cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
};

interface UsePortfolioStateParams {
  marketIndicators: { goldKr?: number; goldKrChg?: number; [key: string]: any };
  notify: (text: string, type?: string) => void;
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
  setShowIntegratedDashboard: (v: boolean) => void;
}

export function usePortfolioState({
  marketIndicators,
  notify,
  confirm,
  setShowIntegratedDashboard,
}: UsePortfolioStateParams) {
  // ── 포트폴리오 목록 (단일 소스) ──
  const [portfolios, setPortfolios] = useState([]);
  const [activePortfolioId, setActivePortfolioId] = useState(null);
  const [intHistory, setIntHistory] = useState([]);
  const [customLinks, setCustomLinks] = useState(UI_CONFIG.DEFAULT_LINKS);
  const [overseasLinks, setOverseasLinks] = useState(UI_CONFIG.OVERSEAS_DEFAULT_LINKS);
  // 분배금 현황 헤더 사이트 링크(사용자 정의 이니셜 1자 + URL). 항상 7슬롯.
  const [dividendLinks, setDividendLinks] = useState(
    () => Array.from({ length: 7 }, () => ({ initial: '', url: '' }))
  );
  const [adminAccessAllowed, setAdminAccessAllowed] = useState(false);
  const [depositSortConfig, setDepositSortConfig] = useState({ key: null, direction: 1 });
  const [depositSortConfig2, setDepositSortConfig2] = useState({ key: null, direction: 1 });

  // ── 활성 포트폴리오 (파생) ──
  const activePortfolio = useMemo(
    () => portfolios.find(p => p.id === activePortfolioId) ?? null,
    [portfolios, activePortfolioId]
  );

  // ── 활성 계좌 타입 (파생) ──
  const activePortfolioAccountType = activePortfolio?.accountType || 'portfolio';

  // ── 개별 필드 파생값 (하위 호환) ──
  const _defaultStartDate = useMemo(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split('T')[0];
  }, []);
  const title = activePortfolio?.name ?? '주식/ETF 포트폴리오';
  const portfolio = activePortfolio?.portfolio ?? [];
  const principal = activePortfolio?.principal ?? UI_CONFIG.DEFAULTS.PRINCIPAL;
  const avgExchangeRate = activePortfolio?.avgExchangeRate ?? 0;
  const depositHistory = activePortfolio?.depositHistory ?? [];
  const depositHistory2 = activePortfolio?.depositHistory2 ?? [];
  const history = activePortfolio?.history ?? [];
  const settings = activePortfolio?.settings ?? { mode: 'rebalance', amount: 1000000 };
  const portfolioStartDate = activePortfolio?.portfolioStartDate || activePortfolio?.startDate || _defaultStartDate;
  const lookupRows = activePortfolio?.lookupRows ?? [];
  const setLookupRows = (v) => patchActive(p => ({ lookupRows: typeof v === 'function' ? v(p.lookupRows ?? []) : v }));
  const hiddenColumnsPortfolio = activePortfolio?.hiddenColumnsPortfolio ?? [];
  const hiddenColumnsRebalancing = activePortfolio?.hiddenColumnsRebalancing ?? [];
  // by-id 변형(카드 별도 창) — 활성 경로는 그 위의 위임이다. 두 경로가 같은 순수 헬퍼를 공유한다.
  const toggleHiddenColumnPortfolioFor = (pid, key) => patchById(pid, p => ({ hiddenColumnsPortfolio: toggleInList(p.hiddenColumnsPortfolio, key) }));
  const toggleHiddenColumnRebalancingFor = (pid, key) => patchById(pid, p => ({ hiddenColumnsRebalancing: toggleInList(p.hiddenColumnsRebalancing, key) }));
  const toggleHiddenColumnPortfolio = (key) => toggleHiddenColumnPortfolioFor(activePortfolioId, key);
  const toggleHiddenColumnRebalancing = (key) => toggleHiddenColumnRebalancingFor(activePortfolioId, key);
  const markedRebalRows = activePortfolio?.markedRebalRows ?? {};
  const markedPortfolioRows = activePortfolio?.markedPortfolioRows ?? {};
  const toggleMarkedRebalRowFor = (pid, itemId) => patchById(pid, p => ({ markedRebalRows: cycleMarkedRow(p.markedRebalRows, itemId) }));
  const toggleMarkedPortfolioRowFor = (pid, itemId) => patchById(pid, p => ({ markedPortfolioRows: cycleMarkedRow(p.markedPortfolioRows, itemId) }));
  const resetAllMarkedRebalRowsFor = (pid) => patchById(pid, () => ({ markedRebalRows: {} }));
  const resetAllMarkedPortfolioRowsFor = (pid) => patchById(pid, () => ({ markedPortfolioRows: {} }));
  const toggleMarkedRebalRow = (itemId) => toggleMarkedRebalRowFor(activePortfolioId, itemId);
  const toggleMarkedPortfolioRow = (itemId) => toggleMarkedPortfolioRowFor(activePortfolioId, itemId);
  const resetAllMarkedRebalRows = () => resetAllMarkedRebalRowsFor(activePortfolioId);
  const resetAllMarkedPortfolioRows = () => resetAllMarkedPortfolioRowsFor(activePortfolioId);

  // ── 지정 계좌만 갱신하는 헬퍼(by-id) ──
  // ⚠️ 카드 별도 창(`/?cardWindow=1`)은 **앱 탭의 활성 계좌가 아닌** 계좌를 편집한다. 그래서
  //    쓰기의 바닥이 by-id여야 하고, `patchActive`는 그 위의 얇은 래퍼로만 남는다.
  //    (patchActive를 그대로 프록시하면 창의 편집이 앱 탭 활성 계좌에 착지해 조용히 다른 계좌를
  //     파괴한다 — 설계 검증에서 3개 렌즈가 독립 확인한 결함.)
  //    pid가 없거나 배열에 없으면 **구조적 no-op**이다(잘못된 계좌에 쓰느니 아무 것도 안 쓴다).
  const patchById = (pid, patch) =>
    setPortfolios(prev => prev.map(p => {
      if (p.id !== pid) return p;
      const resolved = typeof patch === 'function' ? patch(p) : patch;
      return { ...p, ...resolved };
    }));

  // ── 활성 포트폴리오만 갱신하는 헬퍼 ──
  // ⚠️ 렌더 스코프의 activePortfolioId를 클로저로 잡는다(위임 전과 동일 — 타이밍 무변).
  const patchActive = (patch) => patchById(activePortfolioId, patch);

  // 항목 배열 갱신(by-id). 함수형 updater는 **앱 탭 내부 전용**이다 — 별도 창은 직렬화할 수 없으므로
  // 아래 `applyItemPatchesFor`(항목 id → 바꿀 필드)를 쓴다.
  const setPortfolioItemsFor = (pid, v) =>
    patchById(pid, p => ({ portfolio: typeof v === 'function' ? v(p.portfolio ?? []) : v }));

  // ⚠️ 별도 창의 항목 쓰기 단일 창구. `[{ id, fields }]`만 받으므로 postMessage로 그대로 실어 보낼 수
  //    있고, 적용은 앱 탭이 **최신 prev 위에서** 필드 단위로 병합한다 → 그 사이 시세 갱신
  //    (useStockData가 currentPrice/changeRate를 계속 덮는다)과 충돌하지 않는다.
  //    ⚠️ 배열을 통째로 돌려받는 방식으로 되돌리지 말 것 — 창의 스냅샷이 몇 초만 낡아도
  //    그 사이 앱 탭이 쓴 시세·history·스냅샷이 되감긴다(복구 불가).
  const applyItemPatchesFor = (pid, patches) => {
    if (!Array.isArray(patches) || !patches.length) return;
    const byId = new Map();
    patches.forEach(x => { if (x && x.id != null) byId.set(x.id, { ...(byId.get(x.id) || {}), ...(x.fields || {}) }); });
    if (!byId.size) return;
    setPortfolioItemsFor(pid, items => items.map(it => (it && byId.has(it.id)) ? { ...it, ...byId.get(it.id) } : it));
  };

  // ── 하위 호환 세터 ──
  const setTitle = (v) => patchActive({ name: v });
  const setPrincipal = (v) => patchActive(p => ({ principal: typeof v === 'function' ? v(p.principal ?? 0) : v }));
  const setAvgExchangeRate = (v) => patchActive({ avgExchangeRate: v });
  const setPortfolio = (v) => patchActive(p => ({ portfolio: typeof v === 'function' ? v(p.portfolio ?? []) : v }));
  const setHistory = (v) => patchActive(p => ({ history: typeof v === 'function' ? v(p.history ?? []) : v }));
  const setDepositHistory = (v) => patchActive(p => ({ depositHistory: typeof v === 'function' ? v(p.depositHistory ?? []) : v }));
  const setDepositHistory2 = (v) => patchActive(p => ({ depositHistory2: typeof v === 'function' ? v(p.depositHistory2 ?? []) : v }));
  const setSettings = (v) => patchActive({ settings: v });
  const setPortfolioStartDate = (v) => patchActive({ portfolioStartDate: v, startDate: v });

  // ── by-id 세터(카드 별도 창) ──
  // ⚠️ 원금은 **절대값 write와 델타 write가 둘 다 실재**한다(원금 직접 입력 / 원장 편집의 프로라타
  //    보정). 창이 자기 스냅샷으로 계산한 절대값을 보내면 그 사이 앱 탭이 만든 이관·입금이 조용히
  //    사라지므로, 창은 가능한 한 델타를 쓰고 절대값은 사용자가 직접 친 값에만 쓴다.
  const setPrincipalFor = (pid, v) => patchById(pid, { principal: cleanNum(v) });
  const addPrincipalFor = (pid, delta) => patchById(pid, p => ({ principal: Math.max(0, cleanNum(p.principal) + cleanNum(delta)) }));
  const setAvgExchangeRateFor = (pid, v) => patchById(pid, { avgExchangeRate: cleanNum(v) });

  // ── buildPortfoliosState (portfolios가 단일 소스) ──
  const buildPortfoliosState = () => portfolios;

  // ── 포트폴리오 탭 전환 ──
  const switchToPortfolio = (id) => {
    const target = portfolios.find(p => p.id === id);
    if (!target || target.accountType === 'simple' || target.accountType === 'matong') return;
    setActivePortfolioId(id);
    setShowIntegratedDashboard(false);
  };

  // ── 포트폴리오 추가 ──
  const addPortfolio = (accountType = 'portfolio') => {
    const newId = generateId();
    const today = new Date().toISOString().split('T')[0];
    const ACCOUNT_TYPE_NAMES = {
      'portfolio': '일반 증권', 'isa': 'ISA', 'dc-irp': '퇴직연금',
      'gold': 'KRX 금현물', 'pension': '연금저축', 'dividend': '배당형', 'crypto': 'CRYPTO', 'overseas': '해외계좌',
    };
    const existingTypeAccount = portfolios.find(p => p.accountType === accountType);
    const inheritedSettings = existingTypeAccount?.settings || { mode: 'rebalance', amount: 1000000 };
    const newP = {
      id: newId, name: ACCOUNT_TYPE_NAMES[accountType] || '새 계좌', startDate: today, portfolioStartDate: today,
      accountType,
      portfolio: [{ id: generateId(), type: 'deposit', depositAmount: 0 }],
      principal: 0, avgExchangeRate: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: inheritedSettings,
      // 자산검증: 신규 계좌는 가입일을 기준일로 (가입 이전 추정 구간 없음)
      baselineDate: today, holdingSnapshots: [], manualPriceOverrides: {}, preBaselineVerified: false,
    };
    setPortfolios(prev => [...prev, newP]);
    setActivePortfolioId(newId);
  };

  // 빈 계좌 생성 헬퍼(마지막 계좌 삭제·영구삭제 시 앱이 비지 않도록)
  const makeBlankPortfolio = () => {
    const today = new Date().toISOString().split('T')[0];
    return {
      id: generateId(), name: '새 계좌', startDate: today, portfolioStartDate: today,
      accountType: 'portfolio',
      portfolio: [{ id: generateId(), type: 'deposit', depositAmount: 0 }],
      principal: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: { mode: 'rebalance', amount: 1000000 },
      baselineDate: today, holdingSnapshots: [], manualPriceOverrides: {}, preBaselineVerified: false,
    };
  };

  // ── 포트폴리오 삭제 (소프트 삭제) ──
  // 계좌를 배열에서 제거하지 않고 deletedAt(삭제일, KST) 태그만 단다. 삭제일 이전(d < deletedAt)
  // 날짜의 통합 총자산·계좌별 현황 기여는 그대로 보존되고(과거 총자산 불변), 삭제일부터 라이브/오늘
  // 뷰(통합 계좌 현황·평가액 추이·탭·비중)에서 제외된다. 데이터는 보존 → 언제든 복원 가능.
  const deletePortfolio = async (id) => {
    const target = portfolios.find(p => p.id === id);
    if (!target || target.deletedAt) return;
    const nonDeletedOthers = portfolios.filter(p => p.id !== id && !p.deletedAt);
    const isLast = nonDeletedOthers.length === 0;
    const confirmMsg = isLast
      ? '마지막 남은 계좌입니다. 삭제하면 과거 기록은 보존되고 새 빈 계좌가 생성됩니다. 삭제하시겠습니까?'
      : '이 계좌를 삭제하시겠습니까?\n\n과거 총자산·계좌별 현황 기록은 그대로 보존되고, 통합 계좌 현황·평가액 추이에서는 삭제일 이후로 제외됩니다. (표 하단 "삭제된 계좌"에서 복원 가능)';
    if (!await confirm(confirmMsg)) return;
    const deletedAt = getTodayKST();
    const marked = portfolios.map(p => p.id === id ? { ...p, deletedAt } : p);
    if (isLast) {
      const blank = makeBlankPortfolio();
      setPortfolios([...marked, blank]);
      setActivePortfolioId(blank.id);
      setShowIntegratedDashboard(false);
      return;
    }
    setPortfolios(marked);
    if (activePortfolioId === id) {
      const nextActive = nonDeletedOthers.find(p => p.accountType !== 'simple' && p.accountType !== 'matong');
      if (nextActive) {
        setActivePortfolioId(nextActive.id);
      } else {
        // ⚠️ 삭제된 계좌를 활성으로 남기면 App.tsx 활성 계좌 기록 효과(오늘/MA펀드)가 동결돼야 할
        //    계좌에 이력을 쓴다 → activePortfolioId를 비워 activePortfolio=null → totals=0 → 효과 no-op.
        setActivePortfolioId(null);
        setShowIntegratedDashboard(true);
      }
    }
  };

  // ── 삭제 계좌 복원 (deletedAt 제거) ──
  const restorePortfolio = (id) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== id || !p.deletedAt) return p;
      const { deletedAt, ...rest } = p;
      return rest;
    }));
  };

  // ── 삭제 계좌 영구 삭제 (하드 삭제 — 과거 기록까지 완전 제거, 되돌리기 불가) ──
  const purgePortfolio = async (id) => {
    const target = portfolios.find(p => p.id === id);
    if (!target) return;
    if (!await confirm('이 계좌를 영구 삭제하시겠습니까?\n\n과거 총자산·계좌별 현황 기록에서도 완전히 제거되어 되돌릴 수 없습니다.')) return;
    const remaining = portfolios.filter(p => p.id !== id);
    if (remaining.length === 0) {
      const blank = makeBlankPortfolio();
      setPortfolios([blank]);
      setActivePortfolioId(blank.id);
      setShowIntegratedDashboard(false);
      return;
    }
    setPortfolios(remaining);
    if (activePortfolioId === id) {
      const nextActive = remaining.find(p => p.accountType !== 'simple' && p.accountType !== 'matong' && !p.deletedAt);
      if (nextActive) {
        setActivePortfolioId(nextActive.id);
      } else {
        setActivePortfolioId(null);
        setShowIntegratedDashboard(true);
      }
    }
  };

  // ── 직접입력 계좌 추가 ──
  const addSimpleAccount = () => {
    const newId = generateId();
    const today = new Date().toISOString().split('T')[0];
    const newP = {
      id: newId, name: '새 계좌', startDate: today, portfolioStartDate: today,
      accountType: 'simple',
      evalAmount: 0,
      portfolio: [], principal: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: { mode: 'rebalance', amount: 1000000 },
    };
    setPortfolios(prev => [...prev, newP]);
  };

  // ── 마통 계좌 추가 ──
  const addMatongAccount = () => {
    const newId = generateId();
    const today = new Date().toISOString().split('T')[0];
    const newP = {
      id: newId, name: '마통계좌', startDate: today, portfolioStartDate: today,
      accountType: 'matong',
      withdrawableTotal: 0, currentWithdrawal: 0, withdrawalLimit: 0, agreedRate: 0,
      evalAmount: 0,
      portfolio: [], principal: 0, history: [], depositHistory: [], depositHistory2: [],
      settings: { mode: 'rebalance', amount: 1000000 },
    };
    setPortfolios(prev => [...prev, newP]);
  };

  // ── 마통 계좌 필드 수정 ──
  const updateMatongAccountField = (id, field, val) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== id) return p;
      const stored = field === 'agreedRate' ? val : cleanNum(val);
      const updated = { ...p, [field]: stored };
      const wt = field === 'withdrawableTotal' ? cleanNum(val) : (cleanNum(p.withdrawableTotal) || 0);
      const cw = field === 'currentWithdrawal' ? cleanNum(val) : (cleanNum(p.currentWithdrawal) || 0);
      const wl = field === 'withdrawalLimit' ? cleanNum(val) : (cleanNum(p.withdrawalLimit) || 0);
      const newPrincipal = Math.max(0, wt - (cw + wl));
      return { ...updated, principal: newPrincipal, evalAmount: newPrincipal };
    }));
  };

  // ── 직접입력 계좌 필드 수정 ──
  const updateSimpleAccountField = (id, field, val) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (field === 'evalAmount') {
        const num = cleanNum(val);
        const prin = p.principalManual ? cleanNum(p.principal) : num;
        const today = new Date().toISOString().split('T')[0];
        const history = p.history || [];
        const idx = history.findIndex(h => h.date === today);
        const newHistory = idx >= 0
          ? history.map((h, i) => i === idx ? { ...h, evalAmount: num, principal: prin } : h)
          : [...history, { date: today, evalAmount: num, principal: prin, isFixed: false }];
        return { ...p, evalAmount: num, ...(!p.principalManual ? { principal: num } : {}), history: newHistory };
      }
      if (field === 'principal') {
        return { ...p, principal: cleanNum(val), principalManual: true };
      }
      return { ...p, [field]: cleanNum(val) };
    }));
  };

  // ── 시작일 변경 ──
  const updatePortfolioStartDate = (id, date) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, startDate: date, portfolioStartDate: date } : p));
  };

  // ── 계좌명 변경 ──
  const updatePortfolioName = (id, name) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  };

  // ── 계좌 색상 변경 ──
  const updatePortfolioColor = (id, rowColor) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, rowColor } : p));
  };

  // ── TEST 계좌 토글 ── 통합 대시보드 표시는 유지하되 합산·차트·카테고리 비중에서 제외
  const togglePortfolioTest = (id) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, isTest: !p.isTest } : p));
  };

  // ── 전체 색상 초기화 ──
  const resetAllPortfolioColors = () => {
    setPortfolios(prev => prev.map(p => ({ ...p, rowColor: '' })));
  };

  // ── 같은 accountType 계좌에 settings 동기화 ──
  // ⚠️ accountType은 **pid에서** 해석한다. 활성 계좌에서 해석하면 별도 창(비활성 계좌)의 설정 변경이
  //    엉뚱한 accountType 그룹 전체에 박힌다(설계 검증 확정 결함).
  const updateSettingsForTypeOf = (pid, newSettings) => {
    setPortfolios(prev => {
      const t = prev.find(p => p.id === pid);
      if (!t) return prev;
      return prev.map(p => p.accountType === t.accountType ? { ...p, settings: newSettings } : p);
    });
  };
  const updateSettingsForType = (newSettings) => updateSettingsForTypeOf(activePortfolioId, newSettings);

  // ⚠️ 별도 창 전용 — settings **필드 병합**. 창은 read-modify-write(`{...settings, x}`)를 보내면
  //    자기 스냅샷이 낡은 만큼 형제 계좌/앱 탭의 최신 설정을 되감는다. 필드만 보내고 병합은
  //    앱 탭이 최신 값 위에서 한다(lost update 원천 차단).
  const patchSettingsForTypeOf = (pid, fields) => {
    if (!fields || typeof fields !== 'object') return;
    setPortfolios(prev => {
      const t = prev.find(p => p.id === pid);
      if (!t) return prev;
      const next = { ...(t.settings || {}), ...fields };
      return prev.map(p => p.accountType === t.accountType ? { ...p, settings: next } : p);
    });
  };

  // ⚠️ 별도 창의 **원자적** 복합 쓰기. 미러 사이클(cycleMirror/cycleAmtMirror)·잔액→예수금 적용·
  //    원장 편집+원금 보정처럼 '항목 + settings + 계좌 필드'를 한 클릭에 함께 쓰는 경로는 반드시
  //    이 하나를 써야 한다. 두 커맨드로 쪼개면 한쪽만 적용된 반쪽 상태가 남고, 사용자가 다시 누르면
  //    같은 전이를 또 타서 목표값이 두 번 덮인다(undo 없음 — 설계 검증 확정 결함).
  const applyCardWriteFor = (pid, ops) => {
    if (!ops || typeof ops !== 'object') return;
    const itemPatches = Array.isArray(ops.itemPatches) ? ops.itemPatches : null;
    const byId = itemPatches ? new Map() : null;
    if (itemPatches) itemPatches.forEach(x => {
      if (x && x.id != null) byId.set(x.id, { ...(byId.get(x.id) || {}), ...(x.fields || {}) });
    });
    setPortfolios(prev => {
      const t = prev.find(p => p.id === pid);
      if (!t) return prev;   // 구조적 no-op — 잘못된 계좌에 쓰느니 아무 것도 안 쓴다
      const nextSettings = (ops.settingsFields && typeof ops.settingsFields === 'object')
        ? { ...(t.settings || {}), ...ops.settingsFields } : null;
      return prev.map(p => {
        let np = p;
        if (p.id === pid) {
          np = { ...np };
          if (byId && byId.size) np.portfolio = (np.portfolio || []).map(it => (it && byId.has(it.id)) ? { ...it, ...byId.get(it.id) } : it);
          if (ops.accountFields && typeof ops.accountFields === 'object') np = { ...np, ...ops.accountFields };
        }
        if (nextSettings && p.accountType === t.accountType) np = { ...np, settings: nextSettings };
        return np;
      });
    });
  };

  // ── 메모 변경 ──
  const updatePortfolioMemo = (id, memo) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, memo } : p));
  };

  // ── 계좌 순서 이동 ──
  const movePortfolio = (id, direction) => {
    setPortfolios(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  // ── 분배금 이력 저장 ──
  const mergeDividendData = (p, mergeMap, exDateMap) => {
    const existing = p.dividendHistory || {};
    const updated = { ...existing };
    Object.entries(mergeMap).forEach(([code, monthData]) => {
      updated[code] = { ...(existing[code] || {}), ...monthData };
    });
    let exUpdated = p.dividendExDate || {};
    if (exDateMap && Object.keys(exDateMap).length) {
      const existingEx = p.dividendExDate || {};
      exUpdated = { ...existingEx };
      Object.entries(exDateMap).forEach(([code, exData]) => {
        exUpdated[code] = { ...(existingEx[code] || {}), ...exData };
      });
    }
    return { ...p, dividendHistory: updated, dividendExDate: exUpdated, dividendHistoryUpdatedAt: Date.now() };
  };

  const updateDividendHistory = (mergeMap, exDateMap) => {
    setPortfolios(prev => prev.map(p =>
      p.id !== activePortfolioId ? p : mergeDividendData(p, mergeMap, exDateMap)
    ));
  };

  const updatePortfolioDividendHistory = (portfolioId, mergeMap, exDateMap) => {
    setPortfolios(prev => prev.map(p =>
      p.id !== portfolioId ? p : mergeDividendData(p, mergeMap, exDateMap)
    ));
  };

  const updatePortfolioActualDividend = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualDividend || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount === null) delete codeData[yearMonth]; else codeData[yearMonth] = amount;
      return { ...p, actualDividend: { ...existing, [code]: codeData } };
    }));
  };

  const updatePortfolioActualDividendUsd = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualDividendUsd || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount === null) delete codeData[yearMonth]; else codeData[yearMonth] = amount;
      return { ...p, actualDividendUsd: { ...existing, [code]: codeData } };
    }));
  };

  // 월 입금 내역 수동 수량(표시·기록용 override) — 세후/과세 금액 재계산 안 함
  const updatePortfolioActualDividendQty = (portfolioId, code, yearMonth, qty) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualDividendQty || {};
      const codeData = { ...(existing[code] || {}) };
      if (qty === null || !(qty > 0)) delete codeData[yearMonth]; else codeData[yearMonth] = qty;
      return { ...p, actualDividendQty: { ...existing, [code]: codeData } };
    }));
  };

  const updatePortfolioDividendTaxRate = (portfolioId, rate) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      return { ...p, dividendTaxRate: rate };
    }));
  };

  const updatePortfolioDividendSeparateTax = (portfolioId, value) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      return { ...p, dividendSeparateTax: value };
    }));
  };

  const updatePortfolioDividendTaxAmount = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.dividendTaxAmounts || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount > 0) codeData[yearMonth] = amount;
      else delete codeData[yearMonth];
      return { ...p, dividendTaxAmounts: { ...existing, [code]: codeData } };
    }));
  };

  const updatePortfolioActualAfterTaxUsd = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualAfterTaxUsd || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount === null) delete codeData[yearMonth]; else codeData[yearMonth] = amount;
      return { ...p, actualAfterTaxUsd: { ...existing, [code]: codeData } };
    }));
  };

  const updatePortfolioActualAfterTaxKrw = (portfolioId, code, yearMonth, amount) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.actualAfterTaxKrw || {};
      const codeData = { ...(existing[code] || {}) };
      if (amount === null) delete codeData[yearMonth]; else codeData[yearMonth] = amount;
      return { ...p, actualAfterTaxKrw: { ...existing, [code]: codeData } };
    }));
  };

  // ── 한국 ETF 과표기준가 이력 (분배금 과세 계산용) ──
  // 구조: portfolio.taxBaseHistory[code] = {
  //   purchases: [...], sales: [...],
  //   exTaxBase: { 'YYYY-MM': number }, avgTaxBase: { 'YYYY-MM': number },
  //   avgTaxBaseAdj: { 'YYYY-MM': { value, exDate, taxAmount, qty, kind, at } },
  // }
  // ⚠️ 이 함수는 **화이트리스트 재구축기**다 — 여기에 나열되지 않은 필드는 어느 라이터를 부르든
  //    그 순간 통째로 삭제된다. 신규 필드를 추가하면 반드시 이 목록에도 넣을 것(undo 없음).
  const _ensureTaxBase = (p, code) => {
    const existing = p.taxBaseHistory || {};
    const codeRec = existing[code] || {};
    return {
      ...existing,
      [code]: {
        events: codeRec.events || [],
        purchases: codeRec.purchases || [],
        sales: codeRec.sales || [],
        exTaxBase: codeRec.exTaxBase || {},
        avgTaxBase: codeRec.avgTaxBase || {},
        avgTaxBaseAdj: codeRec.avgTaxBaseAdj || {},
      },
    };
  };

  const updateTaxBaseEvents = (portfolioId, code, events) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      tbh[code] = { ...tbh[code], events: Array.isArray(events) ? events : [] };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  const updateTaxBasePurchases = (portfolioId, code, purchases) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      tbh[code] = { ...tbh[code], purchases: Array.isArray(purchases) ? purchases : [] };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  const updateTaxBaseSales = (portfolioId, code, sales) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      tbh[code] = { ...tbh[code], sales: Array.isArray(sales) ? sales : [] };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  const updateTaxBaseExPrice = (portfolioId, code, yearMonth, price) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      const exTaxBase = { ...(tbh[code].exTaxBase || {}) };
      if (price == null || !(price > 0)) delete exTaxBase[yearMonth];
      else exTaxBase[yearMonth] = price;
      tbh[code] = { ...tbh[code], exTaxBase };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  const updateTaxBaseAvgPrice = (portfolioId, code, yearMonth, price) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      const avgTaxBase = { ...(tbh[code].avgTaxBase || {}) };
      if (price == null || !(price > 0)) delete avgTaxBase[yearMonth];
      else avgTaxBase[yearMonth] = price;
      tbh[code] = { ...tbh[code], avgTaxBase };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  // 실제 과세금에서 역산한 평균 과표 조정 앵커 저장/해제.
  // ⚠️ avgTaxBase(수동 입력)와 **별개 슬롯**이다 — 합치면 "사용자가 직접 친 값"과 "실제 과세로
  //    역산한 값"을 구분할 수 없어 조정 출처 툴팁을 띄울 수 없고, 사용자가 수동으로 넣어 둔 값을
  //    조정이 조용히 덮는다. 앵커는 그 달 셀 하나가 아니라 **그 시점 이후 전체**의 자동 계산
  //    기준을 바꾸므로(computeRunningAvgSnapshots) 출처가 화면에 남아야 한다.
  // ⚠️ adj에는 산출 근거(exDate·taxAmount·qty·kind)를 함께 박제한다 — 나중에 배당락일이나
  //    분배금 입력이 바뀌어도 이미 확정한 앵커가 조용히 흔들리면 안 된다.
  const updateTaxBaseAvgAdj = (portfolioId, code, yearMonth, adj) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const tbh = _ensureTaxBase(p, code);
      const avgTaxBaseAdj = { ...(tbh[code].avgTaxBaseAdj || {}) };
      if (adj == null || !(adj.value > 0)) delete avgTaxBaseAdj[yearMonth];
      else avgTaxBaseAdj[yearMonth] = adj;
      tbh[code] = { ...tbh[code], avgTaxBaseAdj };
      return { ...p, taxBaseHistory: tbh };
    }));
  };

  // 과표 계산 매트릭스의 월(0~11) 컬럼 숨김 토글 — 계좌별 hiddenTaxMonths 배열에 저장.
  // 포트폴리오 테이블 열 숨기기(hiddenColumnsPortfolio)의 과표표 버전. 표시 편의용이므로
  // 연합계·월별 합계 계산에는 영향을 주지 않고 렌더만 숨긴다(KrEtfTaxMatrix 참조).
  const toggleHiddenTaxMonth = (portfolioId, monthIndex) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const cur = p.hiddenTaxMonths ?? [];
      const next = cur.includes(monthIndex) ? cur.filter(m => m !== monthIndex) : [...cur, monthIndex];
      return { ...p, hiddenTaxMonths: next };
    }));
  };

  // 분배금 표(월 예상 분배금·월 입금 내역)의 월(0~11) 컬럼 숨김 토글 — 계좌별·탭별 독립 배열.
  // hiddenTaxMonths(과표)와 같은 표시 편의용이라 월별 합계·연간합계·분배율 계산에는 영향을 주지
  // 않고(전 12개월로 계산 유지) 렌더만 숨긴다. 두 탭은 숨김 상태를 공유하지 않는다.
  const toggleHiddenDividendMonth = (portfolioId, tab, monthIndex) => {
    const field = tab === 'actual' ? 'hiddenDivMonthsActual' : 'hiddenDivMonthsExpected';
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const cur = p[field] ?? [];
      const next = cur.includes(monthIndex) ? cur.filter(m => m !== monthIndex) : [...cur, monthIndex];
      return { ...p, [field]: next };
    }));
  };

  // ── 수동 추가 배당금 행 ──
  const addPortfolioExtraRow = (portfolioId) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const existing = p.extraDividendRows || [];
      return { ...p, extraDividendRows: [...existing, { id: generateId(), code: '', monthData: {} }] };
    }));
  };

  const updatePortfolioExtraRowCode = (portfolioId, rowId, code, name = undefined) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const rows = (p.extraDividendRows || []).map(r => {
        if (r.id !== rowId) return r;
        return name !== undefined ? { ...r, code, name } : { ...r, code };
      });
      return { ...p, extraDividendRows: rows };
    }));
  };

  const deletePortfolioExtraRow = (portfolioId, rowId) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      return { ...p, extraDividendRows: (p.extraDividendRows || []).filter(r => r.id !== rowId) };
    }));
  };

  const updatePortfolioExtraRowMonth = (portfolioId, rowId, yearMonth, afterTaxUsd, afterTaxKrw, taxKrw = 0) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const rows = (p.extraDividendRows || []).map(r => {
        if (r.id !== rowId) return r;
        const monthData = { ...r.monthData };
        if (afterTaxKrw > 0 || afterTaxUsd > 0) {
          const entry = { afterTaxUsd, afterTaxKrw };
          if (taxKrw > 0) entry.taxKrw = taxKrw;
          monthData[yearMonth] = entry;
        } else delete monthData[yearMonth];
        return { ...r, monthData };
      });
      return { ...p, extraDividendRows: rows };
    }));
  };

  // 포트폴리오에서 제거된 종목의 '삭제됨' 유령 행 × 버튼 — 그 코드의 수동 분배금 입력을 영구 삭제.
  // 종목 삭제(handleDeleteStock)는 종목 행만 지우고 코드별 분배금/과세 데이터는 계좌에 그대로 남겨
  // 유령 행으로 계속 노출된다. 이 핸들러만이 그 데이터를 실제로 제거한다.
  const deletePortfolioDividendData = (portfolioId, code) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId) return p;
      const strip = (map) => {
        if (!map || !(code in map)) return map;
        const next = { ...map };
        delete next[code];
        return next;
      };
      return {
        ...p,
        actualDividend: strip(p.actualDividend),
        actualDividendUsd: strip(p.actualDividendUsd),
        actualDividendQty: strip(p.actualDividendQty),
        dividendTaxAmounts: strip(p.dividendTaxAmounts),
        actualAfterTaxUsd: strip(p.actualAfterTaxUsd),
        actualAfterTaxKrw: strip(p.actualAfterTaxKrw),
        dividendHistory: strip(p.dividendHistory),
        dividendExDate: strip(p.dividendExDate),
        // dividendTaxAmounts/actualDividendQty는 portfolioStructureKey 지문에 없으므로
        // 이 필드만 있던 코드 삭제도 Drive 저장되도록 타임스탬프를 갱신(지문 포함 필드).
        dividendHistoryUpdatedAt: Date.now(),
      };
    }));
  };

  // 과표 계산 '삭제됨' 유령 행 × 버튼 — 그 코드의 과표 이력(taxBaseHistory)을 영구 삭제.
  const deletePortfolioTaxData = (portfolioId, code) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== portfolioId || !p.taxBaseHistory || !(code in p.taxBaseHistory)) return p;
      const next = { ...p.taxBaseHistory };
      delete next[code];
      return { ...p, taxBaseHistory: next };
    }));
  };

  // ── 포트폴리오 항목 CRUD ──
  // ⚠️ 해외계좌 주식 행의 '투자금액(USD)'·'보유수량'은 사용자가 직접 입력하는 칸이라 어느 쪽도
  //    상대에서 자동 산출하지 않는다(국내 행과 같은 계약). 총액은 `investAmountUsd`에 입력 그대로
  //    저장하고, 기존 원가 소비자가 읽는 `purchasePrice`는 파생 미러로 **함께** 갱신한다.
  //    설계 근거·레거시 방어는 utils.overseasInvestAmount 주석과 CLAUDE.md 전용 섹션 참조.
  // ⚠️ 반드시 `overseas && type==='stock'`으로 좁힐 것 — 이 핸들러는 KrxGoldTable(금현물은
  //    purchasePrice가 **사용자 입력**이고 investAmountUsd가 없다 → 미러가 매입단가를 0으로 지운다)과
  //    펀드 적립 모달(quantity→investAmount 연속 호출 → 펀드 행에 없던 purchasePrice가 박힌다)이
  //    같이 쓰는 범용 라이터다.
  // ⚠️ 미러는 `qty > 0`일 때만 쓴다 — 0으로 나누면 Infinity가 그대로 저장되고(cleanNum은 숫자를
  //    통과시킨다) JSON.stringify가 null로 직렬화해 재로드 시 원가가 영구 소실된다(undo 없음).
  // ⚠️ 항목 필드 쓰기의 단일 경로. accountType은 **pid에서** 해석한다 — 활성 계좌 타입으로 해석하면
  //    별도 창(비활성 계좌)이 다른 타입의 행을 잘못된 규칙으로 쓴다(해외 미러가 국내 행에 박히거나
  //    그 반대). `verify:overseas` #15~#18이 이 함수 본문을 슬라이스해 단언하므로, 이름이나
  //    accountType 표현식(`acctType`)을 바꾸면 scripts/verify-overseas-invest.mjs의 앵커·정규식도
  //    반드시 같이 고칠 것.
  const handleUpdateFor = (pid, id, field, value) =>
    patchById(pid, pf => ({ portfolio: (pf.portfolio ?? []).map(p => {
      if (p.id !== id) return p;
      if (['category', 'name', 'code', 'assetClass'].includes(field)) return { ...p, [field]: value };
      const num = cleanNum(value);
      const acctType = pf.accountType || 'portfolio';
      if (acctType === 'overseas' && p.type === 'stock'
        && (field === 'investAmountUsd' || field === 'quantity')) {
        // 수량을 고쳐도 총액은 사용자가 정한 값 그대로 둔다(저장값이 없던 레거시 행은 편집 **직전**
        // 총액 = purchasePrice × 옛수량으로 1회 시드 — overseasInvestAmount가 그 값을 돌려준다).
        const invest = field === 'investAmountUsd' ? num : overseasInvestAmount(p);
        const qty = field === 'quantity' ? num : cleanNum(p.quantity);
        const next = { ...p, investAmountUsd: invest, quantity: qty };
        if (qty > 0 && Number.isFinite(invest)) next.purchasePrice = invest / qty;
        return next;
      }
      return { ...p, [field]: num };
    }) }));
  const handleUpdate = (id, field, value) => handleUpdateFor(activePortfolioId, id, field, value);

  // 삭제는 되돌릴 수 없고(보유 수량·매입금액 소실) 이관 버튼 바로 옆이라 오클릭이 쉽다 → 확인 필수.
  // 주식·펀드·예적금 행이 전부 이 한 핸들러(onDelete)를 쓰므로 여기 한 곳이면 셋 다 보호된다.
  const handleDeleteStock = async (id) => {
    const item = (activePortfolio?.portfolio || []).find(p => p && p.id === id);
    if (!item) return;
    const kind = item.type === 'fund' ? '펀드' : item.type === 'savings' ? '예적금' : '종목';
    const nm = String(item.name || item.code || '').trim();
    const qty = cleanNum(item.quantity);
    const detail = item.type === 'savings'
      ? (cleanNum(item.investAmount) > 0 ? ` (적립 ${formatNumber(item.investAmount)})` : '')
      : (qty > 0 ? ` ${formatNumber(qty)}${item.type === 'fund' ? '좌' : '주'}` : '');
    const head = nm ? `${nm}${detail}` : `이름 없는 ${kind}`;
    const tail = item.type === 'stock'
      ? "\n분배금·과표 입력은 '삭제됨' 행으로 남습니다."
      : '';
    if (!await confirm(`${head}\n\n이 ${kind}을(를) 삭제하시겠습니까?\n보유 수량·매입금액은 되돌릴 수 없습니다.${tail}`, '삭제')) return;
    setPortfolio(prev => prev.filter(p => p.id !== id));
  };

  // ── 종목 계좌 간 이관 ──────────────────────────────────────────────────────────
  // 종목 행 + 그 종목에 귀속된 계좌별 기록(분배금 8종·과표)을 대상계좌로 옮기고, 자금 이동을
  // 입출금 원장에 기록한다(utils.buildTransferLedgerRows — 3행 구성 근거는 그 주석 참조).
  //
  // ⚠️ 반드시 **단일 setPortfolios**로 두 계좌를 동시에 갱신한다. portfolios[]가 단일 소스이고
  //    patchActive/setPortfolio는 활성 계좌 전용이라 대상계좌에 닿지 못한다.
  // ⚠️ 원본 항목은 updater 안의 `prev`에서 읽는다 — 호출부가 PortfolioTable에 넘어간
  //    totals.calcPortfolio 행을 넘기면 investAmount/evalAmount가 이미 환율이 곱해진 값이라
  //    해외계좌에서 약 1,390배로 오염된다.
  // ⚠️ id 생성(generateId)은 updater **밖**에서 — StrictMode의 업데이터 이중 호출에서 서로 다른
  //    id가 만들어져 원장 행과 항목이 어긋난다(FlowBoard 순수성 규약과 동일).
  // ⚠️ manualPriceOverrides[code]는 원계좌에서 **지우지 않고 복제**한다 — 원계좌의 과거 스냅샷에
  //    그 종목이 그대로 남아 있어 과거 평가액 재계산에 계속 필요하다.
  // ⚠️ 양쪽 계좌의 dividendHistoryUpdatedAt을 갱신해야 Drive STATE 저장이 트리거된다 —
  //    dividendHistory/dividendExDate/dividendTaxAmounts/actualDividendQty는 portfolioStructureKey
  //    지문에 직접 들어 있지 않다(deletePortfolioDividendData와 동일 이유).
  const transferStockToPortfolio = (plan) => {
    const { sourceId, targetId, itemId } = plan || {};
    if (!sourceId || !targetId || !itemId || sourceId === targetId) return false;
    const src = portfolios.find(p => p && p.id === sourceId);
    const tgt = portfolios.find(p => p && p.id === targetId);
    if (!src || !tgt || tgt.deletedAt) return false;
    const srcItem = (src.portfolio || []).find(it => it && it.id === itemId);
    if (!srcItem || srcItem.type === 'deposit') return false;

    const code = String(srcItem.code || '').trim();
    const dateSrc = plan.dateSrc || getBackfillBoundaryForAccount(src.accountType || 'portfolio');
    const dateTgt = plan.dateTgt || getBackfillBoundaryForAccount(tgt.accountType || 'portfolio');
    const rows = buildTransferLedgerRows({
      transferId: generateId(),
      code, name: srcItem.name, quantity: srcItem.quantity, itemType: srcItem.type || 'stock',
      market: plan.market, cost: plan.cost,
      dateSrc, dateTgt,
      sourceId, sourceName: src.name, targetId, targetName: tgt.name,
      rowIds: [generateId(), generateId(), generateId()],
    });
    const cost = cleanNum(plan.cost);
    const movedItemId = generateId();
    const stamp = Date.now();
    // 코드별 맵 8종 + 과표 — 금액성 데이터라 **이동**(복제 시 통합 분배금 표에서 이중 계상).
    const CODE_MAPS = [
      'actualDividend', 'actualDividendUsd', 'actualDividendQty', 'dividendTaxAmounts',
      'actualAfterTaxUsd', 'actualAfterTaxKrw', 'dividendHistory', 'dividendExDate',
      'taxBaseHistory',
    ];

    setPortfolios(prev => {
      const s = prev.find(p => p && p.id === sourceId);
      const t = prev.find(p => p && p.id === targetId);
      if (!s || !t) return prev;
      const it = (s.portfolio || []).find(x => x && x.id === itemId);
      if (!it) return prev;   // 이미 이관/삭제됨 — 이중 실행 방지(멱등)
      const carried = {};
      if (code) {
        CODE_MAPS.forEach(k => { const m = s[k]; if (m && typeof m === 'object' && code in m) carried[k] = m[code]; });
        const mpo = s.manualPriceOverrides;
        if (mpo && typeof mpo === 'object' && code in mpo) carried.manualPriceOverrides = mpo[code];
      }
      const movedItem = { ...it, id: movedItemId };
      return prev.map(p => {
        if (p.id === sourceId) {
          const next = {
            ...p,
            portfolio: (p.portfolio || []).filter(x => x && x.id !== itemId),
            principal: Math.max(0, cleanNum(p.principal) - cost),
            depositHistory2: [rows.srcWithdrawal, ...(p.depositHistory2 || [])],
            dividendHistoryUpdatedAt: stamp,
          };
          CODE_MAPS.forEach(k => {
            const m = p[k];
            if (!m || typeof m !== 'object' || !code || !(code in m)) return;
            const copy = { ...m };
            delete copy[code];
            next[k] = copy;
          });
          return next;
        }
        if (p.id === targetId) {
          const next = {
            ...p,
            portfolio: [movedItem, ...(p.portfolio || [])],
            principal: cleanNum(p.principal) + cost,
            depositHistory: [rows.tgtDeposit, ...(p.depositHistory || [])],
            depositHistory2: rows.tgtGainRow
              ? [rows.tgtGainRow, ...(p.depositHistory2 || [])]
              : (p.depositHistory2 || []),
            dividendHistoryUpdatedAt: stamp,
          };
          CODE_MAPS.forEach(k => {
            if (!(k in carried)) return;
            next[k] = { ...(p[k] || {}), [code]: carried[k] };
          });
          if ('manualPriceOverrides' in carried) {
            next.manualPriceOverrides = { ...(p.manualPriceOverrides || {}), [code]: carried.manualPriceOverrides };
          }
          return next;
        }
        return p;
      });
    });
    return true;
  };

  const handleAddStock = () =>
    setPortfolio(prev => [
      { id: generateId(), type: 'stock', category: "주식", assetClass: 'D', code: "", name: "", currentPrice: 0, changeRate: 0, purchasePrice: 0, investAmount: 0, quantity: 0, targetRatio: 0, isManual: true },
      ...prev,
    ]);

  const handleAddFund = () =>
    setPortfolio(prev => {
      const lastFundIdx = prev.reduceRight((acc, p, i) => acc === -1 && p.type === 'fund' ? i : acc, -1);
      const depositIdx = prev.findIndex(p => p.type === 'deposit');
      const insertIdx = lastFundIdx >= 0 ? lastFundIdx + 1 : (depositIdx >= 0 ? depositIdx + 1 : prev.length);
      const newFund = { id: generateId(), type: 'fund', category: 'FUND', assetClass: 'S', code: '', name: '', currentPrice: 0, changeRate: 0, investAmount: 0, evalAmount: 0, targetRatio: 0, isManual: true };
      return [...prev.slice(0, insertIdx), newFund, ...prev.slice(insertIdx)];
    });

  // ── 예적금(savings) CRUD — 퇴직연금(dc-irp) 전용 ──
  const handleAddSavings = () =>
    setPortfolio(prev => {
      const lastSavingsIdx = prev.reduceRight((acc, p, i) => acc === -1 && p.type === 'savings' ? i : acc, -1);
      const lastFundIdx = prev.reduceRight((acc, p, i) => acc === -1 && p.type === 'fund' ? i : acc, -1);
      const depositIdx = prev.findIndex(p => p.type === 'deposit');
      const insertIdx = lastSavingsIdx >= 0 ? lastSavingsIdx + 1
        : lastFundIdx >= 0 ? lastFundIdx + 1
        : depositIdx >= 0 ? depositIdx + 1
        : prev.length;
      const newSavings = { id: generateId(), type: 'savings', category: '예적금', assetClass: 'S', name: '', annualRate: 0, startDate: '', endDate: '', investAmount: 0, evalAmount: 0, deposits: [], targetRatio: 0, isManual: true };
      return [...prev.slice(0, insertIdx), newSavings, ...prev.slice(insertIdx)];
    });

  const updateSavingsField = (id, field, value) =>
    setPortfolio(prev => prev.map(p => {
      if (p.id !== id) return p;
      // annualRate는 원시 문자열로 저장(소수점 '3.' 입력 보존) — 소비처(savingsEval/표시)에서 cleanNum.
      if (field === 'name' || field === 'startDate' || field === 'endDate' || field === 'assetClass' || field === 'annualRate')
        return { ...p, [field]: value };
      return { ...p, [field]: cleanNum(value) };
    }));

  const addSavingsDeposit = (id, date, amount) =>
    setPortfolio(prev => prev.map(p => {
      if (p.id !== id) return p;
      const amt = cleanNum(amount);
      if (amt <= 0) return p;
      const deposits = [...(p.deposits || []), { id: generateId(), date: date || '', amount: amt }];
      const investAmount = deposits.reduce((s, d) => s + cleanNum(d.amount), 0);
      return { ...p, deposits, investAmount };
    }));

  const removeSavingsDeposit = (id, depId) =>
    setPortfolio(prev => prev.map(p => {
      if (p.id !== id) return p;
      const deposits = (p.deposits || []).filter(d => d.id !== depId);
      const investAmount = deposits.reduce((s, d) => s + cleanNum(d.amount), 0);
      return { ...p, deposits, investAmount };
    }));

  // ── KRX 금현물 포트폴리오: 주식 항목이 없으면 자동 초기화 ──
  useEffect(() => {
    if (activePortfolioAccountType !== 'gold') return;
    setPortfolio(prev => {
      if (prev.some(p => p.type === 'stock')) return prev;
      return [
        { id: generateId(), type: 'stock', category: '금', code: '', name: 'KRX 금현물', currentPrice: 0, changeRate: 0, purchasePrice: 0, quantity: 0, targetRatio: 0, isManual: true },
        ...prev,
      ];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioAccountType, activePortfolioId]);

  // ── KRX 금현물 포트폴리오: goldKr 시세를 주식 항목의 currentPrice에 자동 동기화 ──
  useEffect(() => {
    if (activePortfolioAccountType !== 'gold') return;
    if (!marketIndicators.goldKr) return;
    setPortfolio(prev => prev.map(item =>
      item.type === 'stock'
        ? { ...item, currentPrice: marketIndicators.goldKr, changeRate: marketIndicators.goldKrChg ?? item.changeRate }
        : item
    ));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketIndicators.goldKr, activePortfolioAccountType]);

  const updateInvestmentNotes = (notes) => patchActive({ investmentNotes: notes });
  // 메모 달력에서 편집 — 달력은 **비활성 계좌**의 투자기록도 열어주므로 patchActive(활성 전용)로는
  // 부족하다. id 기반으로 그 계좌만 갱신한다(RebalancingPanel 경로와 같은 필드를 쓰므로 자동 동기화).
  const updateInvestmentNotesFor = (portfolioId, notes) =>
    setPortfolios(prev => prev.map(p => p.id === portfolioId ? { ...p, investmentNotes: notes } : p));

  return {
    // 파생 상태 (읽기 전용)
    title,
    activePortfolio,
    patchActivePortfolio: patchActive,
    // ── by-id 라이터(카드 별도 창 전용) ──
    // ⚠️ 창은 앱 탭의 활성 계좌가 아닌 계좌를 편집한다. patchActive 계열을 프록시하면 편집이
    //    엉뚱한 계좌에 착지하므로(무음 파괴) 창 경로는 반드시 아래를 쓴다.
    patchPortfolioById: patchById,
    applyItemPatchesFor,
    applyCardWriteFor,
    handleUpdateFor,
    updateSettingsForTypeOf,
    patchSettingsForTypeOf,
    setPrincipalFor,
    addPrincipalFor,
    setAvgExchangeRateFor,
    toggleHiddenColumnPortfolioFor,
    toggleHiddenColumnRebalancingFor,
    toggleMarkedRebalRowFor,
    toggleMarkedPortfolioRowFor,
    resetAllMarkedRebalRowsFor,
    resetAllMarkedPortfolioRowsFor,
    portfolio,
    principal,
    avgExchangeRate,
    depositHistory,
    depositHistory2,
    history,
    settings,
    portfolioStartDate,
    // 하위 호환 세터
    setTitle,
    setPrincipal,
    setAvgExchangeRate,
    setPortfolio,
    setHistory,
    setDepositHistory,
    setDepositHistory2,
    setSettings,
    setPortfolioStartDate,
    // 공유 상태 + 세터
    portfolios, setPortfolios,
    activePortfolioId, setActivePortfolioId,
    intHistory, setIntHistory,
    depositSortConfig, setDepositSortConfig,
    depositSortConfig2, setDepositSortConfig2,
    customLinks, setCustomLinks,
    overseasLinks, setOverseasLinks,
    dividendLinks, setDividendLinks,
    lookupRows, setLookupRows,
    hiddenColumnsPortfolio, hiddenColumnsRebalancing,
    toggleHiddenColumnPortfolio, toggleHiddenColumnRebalancing,
    markedRebalRows, toggleMarkedRebalRow, resetAllMarkedRebalRows,
    markedPortfolioRows, toggleMarkedPortfolioRow, resetAllMarkedPortfolioRows,
    adminAccessAllowed, setAdminAccessAllowed,
    // 파생 상태
    activePortfolioAccountType,
    // 함수
    buildPortfoliosState,
    addPortfolio,
    deletePortfolio,
    restorePortfolio,
    purgePortfolio,
    switchToPortfolio,
    addSimpleAccount,
    updateSimpleAccountField,
    addMatongAccount,
    updateMatongAccountField,
    updatePortfolioStartDate,
    updatePortfolioName,
    updatePortfolioColor,
    togglePortfolioTest,
    resetAllPortfolioColors,
    updateSettingsForType,
    updatePortfolioMemo,
    movePortfolio,
    handleUpdate,
    handleDeleteStock,
    transferStockToPortfolio,
    handleAddStock,
    handleAddFund,
    handleAddSavings,
    updateSavingsField,
    addSavingsDeposit,
    removeSavingsDeposit,
    updateDividendHistory,
    updatePortfolioDividendHistory,
    updatePortfolioActualDividend,
    updatePortfolioDividendTaxRate,
    updatePortfolioDividendSeparateTax,
    updatePortfolioDividendTaxAmount,
    updatePortfolioActualDividendUsd,
    updatePortfolioActualDividendQty,
    updatePortfolioActualAfterTaxUsd,
    updatePortfolioActualAfterTaxKrw,
    addPortfolioExtraRow,
    updatePortfolioExtraRowCode,
    deletePortfolioExtraRow,
    updatePortfolioExtraRowMonth,
    deletePortfolioDividendData,
    deletePortfolioTaxData,
    updateTaxBaseEvents,
    updateTaxBasePurchases,
    updateTaxBaseSales,
    updateTaxBaseExPrice,
    updateTaxBaseAvgPrice,
    updateTaxBaseAvgAdj,
    toggleHiddenTaxMonth,
    toggleHiddenDividendMonth,
    updateInvestmentNotes,
    updateInvestmentNotesFor,
  };
}
