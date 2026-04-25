export const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

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
