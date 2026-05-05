export const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

export const calcPeriodStart = (period: string, latest: string, earliest: string): string | null => {
  if (period === 'custom') return null;
  if (period === 'all') return earliest;
  const d = new Date(latest);
  if      (period === '1w')  d.setDate(d.getDate() - 7);
  else if (period === '1m')  d.setMonth(d.getMonth() - 1);
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

export const calcPortfolioEvalForDate = (
  items: any[],
  accountType: string,
  date: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  currentFxRate = 1
): number => {
  const isGold = accountType === 'gold';
  const isOverseas = accountType === 'overseas';
  const fxRate = isOverseas
    ? (getClosestValue(indicatorHistoryMap?.usdkrw, date) || currentFxRate || 1)
    : 1;
  let totalEval = 0;
  let hasAnyPrice = false;
  items.forEach(item => {
    if (item.type === 'deposit') {
      totalEval += cleanNum(item.depositAmount) * fxRate;
      hasAnyPrice = true;
      return;
    }
    const qty = cleanNum(item.quantity);
    if (!qty || qty <= 0) return;
    let price = 0;
    if (isGold) {
      price = getClosestValue(indicatorHistoryMap?.goldKr, date) || 0;
    } else if (item.code) {
      price = getClosestValue(stockHistoryMap?.[item.code], date) || 0;
    }
    if (price > 0) { totalEval += qty * price * fxRate; hasAnyPrice = true; }
  });
  return hasAnyPrice ? totalEval : 0;
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
  let csv = '﻿일자,금액,합계,메모\n';
  rows.forEach(h => { csv += `${h.date},${cleanNum(h.amount)},${cleanNum(h.cumulative)},${h.memo || ''}\n`; });
  return csv;
};

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
