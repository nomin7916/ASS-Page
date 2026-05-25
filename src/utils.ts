export const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

export const calcPeriodStart = (period: string, latest: string, earliest: string): string | null => {
  if (period === 'custom') return null;
  if (period === 'all') return earliest;
  const d = new Date(latest);
  if      (period === '1w')  d.setDate(d.getDate() - 7);
  else if (period === '1m')  d.setMonth(d.getMonth() - 1);
  else if (period === '2m')  d.setMonth(d.getMonth() - 2);
  else if (period === '3m')  d.setMonth(d.getMonth() - 3);
  else if (period === '6m')  d.setMonth(d.getMonth() - 6);
  else if (period === '1y')  d.setFullYear(d.getFullYear() - 1);
  else if (period === '2y')  d.setFullYear(d.getFullYear() - 2);
  else if (period === '3y')  d.setFullYear(d.getFullYear() - 3);
  else if (period === '4y')  d.setFullYear(d.getFullYear() - 4);
  else if (period === '5y')  d.setFullYear(d.getFullYear() - 5);
  else if (period === '10y') d.setFullYear(d.getFullYear() - 10);
  else return null;
  const start = d.toISOString().split('T')[0];
  return start < earliest ? earliest : start;
};

export const hexToRgba = (hex: string, alpha: number): string | null => {
  if (!hex || typeof hex !== 'string' || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const blendWithDarkBg = (hex: string, alpha: number, bgHex = '#1e293b'): string => {
  if (!hex || hex.length < 7) return bgHex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const bgR = parseInt(bgHex.slice(1, 3), 16);
  const bgG = parseInt(bgHex.slice(3, 5), 16);
  const bgB = parseInt(bgHex.slice(5, 7), 16);
  return `rgb(${Math.round(bgR*(1-alpha)+r*alpha)}, ${Math.round(bgG*(1-alpha)+g*alpha)}, ${Math.round(bgB*(1-alpha)+b*alpha)})`;
};

export const isWeekend = (dateStr) => {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 0 || d.getDay() === 6;
};

// dateStr(YYYY-MM-DD)에 영업일 n일을 더한 날짜 반환. 주말 및 holidays(YYYY-MM-DD[]) 제외.
export const addBusinessDays = (dateStr: string, n: number, holidays: string[] = []): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return '';
  const set = new Set(holidays || []);
  const d = new Date(dateStr + 'T12:00:00');
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (d.getDay() === 0 || d.getDay() === 6 || set.has(ds)) continue;
    added++;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 분배금 지급(예정)일 = 배당락일 + 2영업일 (한국 ETF 기준일 T+2, 휴일 제외)
export const dividendPayDate = (exDate: string, holidays: string[] = []): string =>
  addBusinessDays(exDate, 2, holidays);

// 최근 7일 범위 내 주말 날짜를 이전 기록값으로 채워서 반환 (저장용)
export const fillWeekendGaps = (history, today) => {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return [];
  const dateSet = new Set(sorted.map(h => h.date));
  const cutoff = new Date(today + 'T12:00:00');
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const fills = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    if (curr.date < cutoffStr) continue;
    const nextDate = sorted[i + 1].date;
    const d = new Date(curr.date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    while (d.toISOString().split('T')[0] < nextDate) {
      const ds = d.toISOString().split('T')[0];
      if (!dateSet.has(ds) && isWeekend(ds)) {
        fills.push({ date: ds, evalAmount: curr.evalAmount, principal: curr.principal, isFixed: false });
        dateSet.add(ds);
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return fills;
};

// 주말 + 공휴일 날짜를 이전 거래일 값으로 채워서 반환
// 연속 두 레코드 사이 간격이 30일 초과이면 비정상 갭으로 보고 스킵
export const fillNonTradingGaps = (history, krHolidays = [], usHolidays = [], accountType = 'portfolio') => {
  const isNonTrading = (dateStr) => {
    const day = new Date(dateStr + 'T12:00:00').getDay();
    if (day === 0 || day === 6) return true;
    return accountType === 'overseas' ? usHolidays.includes(dateStr) : krHolidays.includes(dateStr);
  };
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return [];
  const dateSet = new Set(sorted.map(h => h.date));
  const fills = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const gapMs = new Date(next.date + 'T12:00:00').getTime() - new Date(curr.date + 'T12:00:00').getTime();
    if (gapMs > 30 * 86400000) continue;
    const d = new Date(curr.date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    while (d.toISOString().split('T')[0] < next.date) {
      const ds = d.toISOString().split('T')[0];
      if (!dateSet.has(ds) && isNonTrading(ds)) {
        fills.push({ date: ds, evalAmount: curr.evalAmount, principal: curr.principal, isFixed: false });
        dateSet.add(ds);
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return fills;
};

export const cleanNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
  return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
};

export const formatCurrency = (n) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(cleanNum(n));
export const formatPercent = (n) => cleanNum(n).toFixed(2) + '%';
export const formatNumber = (n) => (n === '' || n == null) ? '' : new Intl.NumberFormat('ko-KR').format(cleanNum(n));
export const formatFundPrice = (n) => (n === '' || n == null) ? '' : new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cleanNum(n));
export const formatChangeRate = (n) => {
  const s = cleanNum(n);
  return (s > 0 ? '▲' : s < 0 ? '▼' : '') + Math.abs(s).toFixed(2) + '%';
};
export const formatShortDate = (s) => {
  if (!s) return '';
  const p = s.split('-');
  if (p.length === 3) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${p[0].substring(2)}/${p[1]}/${p[2]} (${days[new Date(s).getDay()]})`;
  }
  return s;
};
export const formatVeryShortDate = (s) => {
  if (!s) return '';
  const p = s.split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}` : s;
};
export const getSeededRandom = (seedStr) => {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) hash = Math.imul(31, hash) + seedStr.charCodeAt(i) | 0;
  const x = Math.sin(hash++) * 10000;
  return x - Math.floor(x);
};
export const getClosestValue = (dataObj, targetDateStr) => {
  if (!dataObj) return null;
  let d = new Date(targetDateStr);
  for (let i = 0; i < 15; i++) {
    const ds = d.toISOString().split('T')[0];
    if (dataObj[ds] !== undefined) return dataObj[ds];
    d.setDate(d.getDate() - 1);
  }
  return null;
};

export const getIndexLatest = (histObj) => {
  if (!histObj || Object.keys(histObj).length === 0) return { val: null, chg: null };
  const dates = Object.keys(histObj).sort();
  const latest = histObj[dates[dates.length - 1]];
  const prev = dates.length >= 2 ? histObj[dates[dates.length - 2]] : null;
  const chg = (prev && prev > 0) ? ((latest / prev) - 1) * 100 : null;
  return { val: latest, chg };
};

const getRowFocusables = (el) => {
  const tr = el.closest('tr');
  if (!tr) return [];
  return Array.from(tr.querySelectorAll(
    'input:not([type="hidden"]):not([disabled]), select:not([disabled]), td[tabindex="0"]'
  ));
};

export const handleTableKeyDown = (e, colKey) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const tbody = e.target.closest('tbody');
    if (!tbody) return;
    const inputs = Array.from(tbody.querySelectorAll(`[data-col="${colKey}"]`));
    const idx = inputs.indexOf(e.target);
    const next = e.key === 'ArrowDown' ? inputs[idx + 1] : inputs[idx - 1];
    if (next) { next.focus(); next.select?.(); }
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const focusables = getRowFocusables(e.target);
    const idx = focusables.indexOf(e.target);
    const next = e.key === 'ArrowRight' ? focusables[idx + 1] : focusables[idx - 1];
    if (next) { next.focus(); next.select?.(); }
  }
};

export const handleReadonlyCellNav = (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const tr = e.target.closest('tr');
  const tbody = e.target.closest('tbody');
  if (!tr || !tbody) return;
  const focusables = getRowFocusables(e.target);
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const idx = focusables.indexOf(e.target);
    const next = e.key === 'ArrowRight' ? focusables[idx + 1] : focusables[idx - 1];
    if (next) { next.focus(); next.select?.(); }
  } else {
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const rowIdx = rows.indexOf(tr);
    const cellIdx = focusables.indexOf(e.target);
    const nextRow = e.key === 'ArrowDown' ? rows[rowIdx + 1] : rows[rowIdx - 1];
    if (nextRow) {
      const nf = Array.from(nextRow.querySelectorAll(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), td[tabindex="0"]'
      ));
      const target = nf[cellIdx] ?? nf[nf.length - 1];
      if (target) { target.focus(); target.select?.(); }
    }
  }
};

export const handleRowArrowNav = (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const focusables = getRowFocusables(e.target);
  const idx = focusables.indexOf(e.target);
  const next = e.key === 'ArrowRight' ? focusables[idx + 1] : focusables[idx - 1];
  if (next) { next.focus(); next.select?.(); }
};

// ASS-Page 자산검증: 기존 계좌(baselineDate 미보유)의 기준일 = 직전 거래일(2026-05-15 금)
// 신규 계좌는 생성 시 가입일(startDate)을 baselineDate로 설정한다.
export const BASELINE_DEFAULT_DATE = '2026-05-15';

// 종목의 수동 종가 오버라이드 키 (gold는 code가 없으므로 'GOLD' 사용)
const overrideKeyForItem = (item: any, isGold: boolean): string =>
  item?.code || (isGold ? 'GOLD' : '');

// 특정 날짜 이후 최대 forwardDays 일 안의 가장 가까운 다음 값 (주말/공휴일 이후 첫 거래일 폴백)
const getForwardValue = (dataObj: Record<string, number> | null | undefined, targetDateStr: string, forwardDays: number): number | null => {
  if (!dataObj) return null;
  let d = new Date(targetDateStr);
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < forwardDays; i++) {
    const ds = d.toISOString().split('T')[0];
    if (dataObj[ds] !== undefined) return dataObj[ds];
    d.setDate(d.getDate() + 1);
  }
  return null;
};

// 특정 날짜·종목의 단가 결정: 수동입력(manualPriceOverrides) 최우선 → 이력 → 순방향 근사 → 0
const resolvePriceForItem = (
  item: any,
  date: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  isGold: boolean,
  manualPriceOverrides?: Record<string, Record<string, number>> | null
): { price: number; source: 'manual' | 'history' | 'approximate' | 'none' } => {
  const ovKey = overrideKeyForItem(item, isGold);
  const manualRaw = ovKey ? manualPriceOverrides?.[ovKey]?.[date] : undefined;
  if (manualRaw != null && cleanNum(manualRaw) > 0) {
    return { price: cleanNum(manualRaw), source: 'manual' };
  }
  let price = 0;
  if (isGold) price = getClosestValue(indicatorHistoryMap?.goldKr, date) || 0;
  else if (item?.code) price = getClosestValue(stockHistoryMap?.[item.code], date) || 0;
  if (price > 0) return { price, source: 'history' };
  // 소급 조회 실패 시 최대 5거래일 순방향 조회 (주말·휴장일 검증 시 직후 첫 거래일가 활용)
  const dataObj = isGold ? indicatorHistoryMap?.goldKr : (item?.code ? stockHistoryMap?.[item.code] : null);
  const fwdPrice = getForwardValue(dataObj, date, 5) || 0;
  return fwdPrice > 0 ? { price: fwdPrice, source: 'approximate' } : { price: 0, source: 'none' };
};

// 특정 날짜의 종목별 평가 내역 + 합계 (검증 모달 P2가 사용)
export const calcPortfolioEvalDetail = (
  items: any[],
  accountType: string,
  date: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  currentFxRate = 1,
  manualPriceOverrides?: Record<string, Record<string, number>> | null
): { total: number; fxRate: number; items: any[]; hasAnyPrice: boolean } => {
  const isGold = accountType === 'gold';
  const isOverseas = accountType === 'overseas';
  const fxRate = isOverseas
    ? (getClosestValue(indicatorHistoryMap?.usdkrw, date) || currentFxRate || 1)
    : 1;
  let totalEval = 0;
  let hasAnyPrice = false;
  const detail: any[] = [];
  (items || []).forEach(item => {
    if (item.type === 'deposit') {
      const evl = cleanNum(item.depositAmount) * fxRate;
      totalEval += evl;
      hasAnyPrice = true;
      detail.push({ id: item.id, type: 'deposit', code: '', name: '예수금', quantity: null, price: null, source: 'deposit', eval: evl });
      return;
    }
    if (item.type === 'fund') {
      // 펀드: 수동입력 → 해당 날짜 NAV 이력 → 현재 평가액 폴백 (일일 평가액에서 누락 금지)
      const fQty = cleanNum(item.quantity);
      const { price: histPrice, source } = resolvePriceForItem(item, date, stockHistoryMap, indicatorHistoryMap, false, manualPriceOverrides);
      let evl = 0;
      let usedSource: string = source;
      if (fQty > 0 && histPrice > 0) evl = fQty * histPrice * fxRate;
      else if (fQty > 0 && cleanNum(item.currentPrice) > 0) { evl = fQty * cleanNum(item.currentPrice) * fxRate; usedSource = 'currentPrice'; }
      else { evl = cleanNum(item.evalAmount) * fxRate; usedSource = 'evalAmount'; }
      if (evl > 0) { totalEval += evl; hasAnyPrice = true; }
      detail.push({ id: item.id, type: 'fund', code: item.code || '', name: item.name || '', quantity: fQty, price: histPrice || (usedSource === 'currentPrice' ? cleanNum(item.currentPrice) : null), source: usedSource, eval: evl });
      return;
    }
    const qty = cleanNum(item.quantity);
    if (!qty || qty <= 0) return;
    const { price, source } = resolvePriceForItem(item, date, stockHistoryMap, indicatorHistoryMap, isGold, manualPriceOverrides);
    const evl = price > 0 ? qty * price * fxRate : 0;
    if (evl > 0) { totalEval += evl; hasAnyPrice = true; }
    detail.push({ id: item.id, type: 'stock', code: item.code || '', name: item.name || (isGold ? 'KRX 금현물' : ''), quantity: qty, price: price || null, source, eval: evl });
  });
  return { total: hasAnyPrice ? totalEval : 0, fxRate, items: detail, hasAnyPrice };
};

export const calcPortfolioEvalForDate = (
  items: any[],
  accountType: string,
  date: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  currentFxRate = 1,
  manualPriceOverrides?: Record<string, Record<string, number>> | null
): number =>
  calcPortfolioEvalDetail(items, accountType, date, stockHistoryMap, indicatorHistoryMap, currentFxRate, manualPriceOverrides).total;

// 포트폴리오 항목 → 스냅샷 아이템 (가격 무관, 수량·구성만 보존)
export const snapshotItemsFromPortfolio = (items: any[]): any[] =>
  (items || []).map(it => ({
    code: it.code || '',
    name: it.name || '',
    type: it.type || 'stock',
    quantity: cleanNum(it.quantity),
    investAmount: cleanNum(it.investAmount),
    depositAmount: cleanNum(it.depositAmount),
  }));

// 구성 변경 감지용 지문 (가격 제외 — 수량·예수금·종목 구성만)
export const snapshotCompositionKey = (items: any[]): string =>
  JSON.stringify(
    snapshotItemsFromPortfolio(items)
      .map(it => `${it.type}:${it.code}:${it.quantity}:${it.depositAmount}:${it.investAmount}`)
      .sort()
  );

// 계좌에 자산검증 필드 보강 (로드/생성 시 호출). 기존 계좌는 baselineDate=직전거래일.
export const ensurePortfolioVerificationFields = (p: any): any => {
  if (!p || p.accountType === 'simple' || p.accountType === 'matong') return p;
  const next = { ...p };
  if (!next.manualPriceOverrides || typeof next.manualPriceOverrides !== 'object') next.manualPriceOverrides = {};
  if (typeof next.preBaselineVerified !== 'boolean') next.preBaselineVerified = false;
  if (!Array.isArray(next.holdingSnapshots)) next.holdingSnapshots = [];
  if (!next.baselineDate) {
    const start = next.portfolioStartDate || next.startDate || '';
    next.baselineDate = (start && start > BASELINE_DEFAULT_DATE) ? start : BASELINE_DEFAULT_DATE;
  }
  return next;
};

// 특정 날짜의 보유 종목 해결: baseline 이전 → baseline 스냅샷(추정),
// baseline 이후 → date 이하 최신 스냅샷. 스냅샷 없으면 현재 포트폴리오(추정).
export const resolveHoldings = (
  p: any,
  date: string
): { items: any[]; kind: string; estimated: boolean } => {
  const snaps = (p?.holdingSnapshots || []).filter((s: any) => Array.isArray(s?.items));
  if (snaps.length === 0) {
    return { items: p?.portfolio || [], kind: 'live', estimated: true };
  }
  const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  const baselineDate = p?.baselineDate || '';
  if (baselineDate && date < baselineDate) {
    const baseline = sorted.find((s: any) => s.kind === 'baseline') || sorted[0];
    return { items: baseline?.items || [], kind: 'baseline', estimated: !p?.preBaselineVerified };
  }
  const eligible = sorted.filter((s: any) => s.date <= date);
  const chosen = eligible.length ? eligible[eligible.length - 1] : sorted[0];
  return { items: chosen?.items || [], kind: chosen?.kind || 'baseline', estimated: false };
};

export const buildIndexStatus = (data, source) => {
  const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (!data || Object.keys(data).length === 0) {
    return { status: 'fail', source: '-', latestDate: '-', latestValue: 0, count: 0, gapDays: null, updatedAt: now };
  }
  const dates = Object.keys(data).sort();
  const latestDate = dates[dates.length - 1];
  const latestValue = data[latestDate];
  const today = new Date().toISOString().split('T')[0];
  const gapDays = Math.floor((new Date(today) - new Date(latestDate)) / (1000 * 60 * 60 * 24));
  const isPartial = dates.length <= 3;
  return {
    status: isPartial ? 'partial' : 'success',
    source,
    latestDate,
    latestValue,
    count: dates.length,
    gapDays,
    updatedAt: now
  };
};

export const parseIndexCSV = (text, fileName) => {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return null;
  const header = lines[0].replace(/"/g, '').toLowerCase();
  const result = {};

  if (header.includes('price') && header.includes('change')) {
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/"/g, '').split(',');
      if (cols.length >= 2) {
        const rawDate = cols[0].trim();
        const price = parseFloat(cols[1].replace(/,/g, '').trim());
        if (!rawDate || isNaN(price) || price <= 0) continue;
        let dateStr = rawDate;
        if (rawDate.match(/[a-zA-Z]/)) {
          const d = new Date(rawDate);
          if (!isNaN(d)) dateStr = d.toISOString().split('T')[0];
        }
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) result[dateStr] = price;
      }
    }
  }
  else if (header.includes('날짜') || header.includes('종가')) {
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/"/g, '').split(',');
      if (cols.length >= 2) {
        const rawDate = cols[0].trim().replace(/\./g, '-');
        const price = parseFloat(cols[1].replace(/,/g, '').trim());
        if (!rawDate || isNaN(price) || price <= 0) continue;
        if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) result[rawDate] = price;
      }
    }
  }
  else if (header.includes('close') || header.startsWith('date')) {
    const cols0 = header.split(',');
    const closeIdx = cols0.findIndex(c => c.trim() === 'close');
    const dateIdx = cols0.findIndex(c => c.trim() === 'date');
    const ci = closeIdx >= 0 ? closeIdx : 4;
    const di = dateIdx >= 0 ? dateIdx : 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/"/g, '').split(',');
      if (cols.length > ci) {
        const dateStr = cols[di]?.trim();
        const price = parseFloat(cols[ci]?.trim());
        if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/) && !isNaN(price) && price > 0) {
          result[dateStr] = price;
        }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
};

export const detectIndexFromFileName = (fileName) => {
  const upper = fileName.toUpperCase();
  if (upper.includes('KOSPI') || upper.includes('KS11') || upper.includes('코스피')) return 'kospi';
  if (upper.includes('SP500') || upper.includes('S&P') || upper.includes('SPX') || upper.includes('GSPC')) return 'sp500';
  if (upper.includes('NASDAQ') || upper.includes('NDQ') || upper.includes('IXIC') || upper.includes('나스닥')) return 'nasdaq';
  return null;
};

export const downloadCSV = (filename, csvString) => {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
};

export const buildHistoryCSV = (history) => {
  let csv = '﻿일자,평가자산,전일대비 수익금,전일대비 수익률\n';
  const sh = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
  sh.forEach((h, i) => {
    const prev = sh[i + 1];
    const dodProfit = prev ? h.evalAmount - prev.evalAmount : 0;
    const dodRate = (prev && prev.evalAmount > 0) ? ((h.evalAmount / prev.evalAmount) - 1) * 100 : 0;
    csv += `${h.date},${h.evalAmount},${dodProfit},${dodRate.toFixed(2)}%\n`;
  });
  return csv;
};

export const buildLookupCSV = (lookupRows, history, comparisonMode, currentTotalEval) => {
  const modeText = comparisonMode === 'latestOverPast' ? '(현재/과거)-1 (%)' : '1- (과거/현재) (%)';
  let csv = `﻿일자,평가자산,${modeText}\n`;
  const validRecords = lookupRows.map(r => history.find(h => h.date === r.date)).filter(Boolean);
  let oldestEval = 0;
  if (validRecords.length > 0) oldestEval = validRecords.reduce((min, curr) => new Date(curr.date) < new Date(min.date) ? curr : min).evalAmount;
  [...lookupRows].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(row => {
    const rec = history.find(h => h.date === row.date);
    if (rec) {
      const pastEval = rec.evalAmount;
      const compareRate = comparisonMode === 'latestOverPast'
        ? (oldestEval > 0 ? ((pastEval / oldestEval) - 1) * 100 : 0)
        : (currentTotalEval > 0 ? (1 - (pastEval / currentTotalEval)) * 100 : 0);
      csv += `${row.date},${pastEval},${compareRate.toFixed(2)}%\n`;
    } else { csv += `${row.date},기록 없음,-\n`; }
  });
  return csv;
};

export const buildDepositCSV = (rows) => {
  let csv = '﻿일자,금액,합계,메모,원금제외\n';
  rows.forEach(h => { csv += `${h.date},${cleanNum(h.amount)},${cleanNum(h.cumulative)},${h.memo || ''},${h.noPrincipal ? 'Y' : ''}\n`; });
  return csv;
};

// ─────────────────────────────────────────────────────────────────────────────
// 한국 ETF 배당 과세 계산 (사용자 입력 매입 과표 → 분배락 과세표준 차분)
// 실제 운용사 관행: 주당 과세표준을 소수 둘째 자리로 반올림한 후 보유수량을 곱한다.
// ─────────────────────────────────────────────────────────────────────────────
export interface KrEtfPurchaseEvent {
  id?: string;
  date: string;            // 'YYYY-MM-DD'
  shares: number;          // 양의 정수
  taxBasePrice: number;    // 매입 시점 과표기준가, > 0 (소수점 허용)
}

export interface KrEtfSaleEvent {
  id?: string;
  date: string;            // 'YYYY-MM-DD'
  shares: number;          // 양의 정수
}

export interface KrEtfDividendEvent {
  exDate: string;             // 'YYYY-MM-DD'
  exTaxBasePrice: number;     // 배당락일 과표기준가, > 0
  perShareGrossDividend: number;  // 주당 세전 배당금, ≥ 0
}

export interface KrEtfTaxOptions {
  taxRate?: number;             // default 0.154 (배당소득세 15.4%)
  saleMethod?: 'avg';           // v1: 평균법만 지원 (FIFO 추후)
  sales?: KrEtfSaleEvent[];
  perShareDecimals?: number;    // 주당 과세표준 반올림 자릿수 (default 2)
}

export interface KrEtfTaxResult {
  weightedAvgTaxBase: number;   // 배당락일 시점 가중평균 매입 과표
  taxablePerShare: number;      // max(0, exBase - 가중평균), 소수 N자리 반올림
  totalShares: number;          // 배당락일 보유수량
  taxableAmount: number;        // taxablePerShare × totalShares (원, 반올림)
  tax: number;                  // 원천징수액 (원, 반올림)
  grossDividend: number;        // 세전 배당금 (원, 반올림)
  netDividend: number;          // 세후 배당금 (gross - tax)
}

export function calculateKrEtfDividendTax(
  purchases: KrEtfPurchaseEvent[],
  dividend: KrEtfDividendEvent,
  options: KrEtfTaxOptions = {},
): KrEtfTaxResult {
  const taxRate = options.taxRate ?? 0.154;
  const saleMethod = options.saleMethod ?? 'avg';
  const sales = options.sales ?? [];
  const perShareDecimals = options.perShareDecimals ?? 2;

  if (!Array.isArray(purchases) || purchases.length === 0) {
    throw new Error('매입 이벤트가 최소 1건 필요합니다.');
  }
  if (!dividend || !/^\d{4}-\d{2}-\d{2}$/.test(String(dividend.exDate || ''))) {
    throw new Error('배당락일이 올바른 YYYY-MM-DD 형식이 아닙니다.');
  }
  if (!(dividend.exTaxBasePrice > 0)) {
    throw new Error('배당락일 과표기준가는 0보다 커야 합니다.');
  }
  if (!(dividend.perShareGrossDividend >= 0)) {
    throw new Error('주당 세전 배당금은 0 이상이어야 합니다.');
  }
  if (saleMethod !== 'avg') {
    throw new Error(`saleMethod '${saleMethod}' 미지원 (v1: 'avg'만 지원)`);
  }

  purchases.forEach((p, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) {
      throw new Error(`매입[${i}] 날짜 형식 오류: ${p.date}`);
    }
    if (!Number.isFinite(p.shares) || p.shares <= 0 || !Number.isInteger(p.shares)) {
      throw new Error(`매입[${i}] 주식수는 양의 정수여야 합니다: ${p.shares}`);
    }
    if (!Number.isFinite(p.taxBasePrice) || p.taxBasePrice <= 0) {
      throw new Error(`매입[${i}] 과표기준가는 0보다 커야 합니다: ${p.taxBasePrice}`);
    }
  });
  sales.forEach((s, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) {
      throw new Error(`매도[${i}] 날짜 형식 오류: ${s.date}`);
    }
    if (!Number.isFinite(s.shares) || s.shares <= 0 || !Number.isInteger(s.shares)) {
      throw new Error(`매도[${i}] 주식수는 양의 정수여야 합니다: ${s.shares}`);
    }
  });

  type Evt = { date: string; kind: 'B' | 'S'; shares: number; price?: number };
  const events: Evt[] = [
    ...purchases.map<Evt>(p => ({ date: p.date, kind: 'B', shares: p.shares, price: p.taxBasePrice })),
    ...sales.map<Evt>(s => ({ date: s.date, kind: 'S', shares: s.shares })),
  ]
    .filter(e => e.date <= dividend.exDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'B' ? -1 : 1));

  let heldShares = 0;
  let totalCost = 0;
  for (const e of events) {
    if (e.kind === 'B') {
      totalCost += e.shares * (e.price as number);
      heldShares += e.shares;
    } else {
      if (e.shares > heldShares) {
        throw new Error(`매도 ${e.date}: 보유수량(${heldShares}) 초과 매도(${e.shares})`);
      }
      const costPerShare = heldShares > 0 ? totalCost / heldShares : 0;
      totalCost -= e.shares * costPerShare;
      heldShares -= e.shares;
    }
  }

  if (heldShares <= 0) {
    return {
      weightedAvgTaxBase: 0,
      taxablePerShare: 0,
      totalShares: 0,
      taxableAmount: 0,
      tax: 0,
      grossDividend: 0,
      netDividend: 0,
    };
  }

  const weightedAvgTaxBase = totalCost / heldShares;
  const rawTaxablePerShare = Math.max(0, dividend.exTaxBasePrice - weightedAvgTaxBase);
  const factor = 10 ** perShareDecimals;
  const taxablePerShare = Math.round(rawTaxablePerShare * factor) / factor;
  const totalShares = heldShares;
  const taxableAmount = Math.round(taxablePerShare * totalShares);
  const tax = Math.round(taxableAmount * taxRate);
  const grossDividend = Math.round(dividend.perShareGrossDividend * totalShares);
  const netDividend = grossDividend - tax;

  return {
    weightedAvgTaxBase,
    taxablePerShare,
    totalShares,
    taxableAmount,
    tax,
    grossDividend,
    netDividend,
  };
}

// 삼성운용 ETF 배당 과세 CSV 파싱
// 포맷: 1행=펀드명, 2행=기준일, 3행=헤더, 4행~=데이터(지급기준일,실지급일,분배율,분배금액,주당과세표준)
export const parseSamsungFundCSV = (text) => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const records = {};
  for (let i = 3; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;
    const refDate = cols[0].trim();
    if (!/^\d{8}$/.test(refDate)) continue;
    const yearMonth = `${refDate.slice(0, 4)}-${refDate.slice(4, 6)}`;
    records[yearMonth] = {
      referenceDate: refDate,
      paymentDate: cols[1].trim(),
      distributionRate: parseFloat(cols[2]) || 0,
      perShareAmount: parseInt(cols[3], 10) || 0,
      perShareTaxableBase: parseInt(cols[4], 10) || 0,
    };
  }
  return records;
};
