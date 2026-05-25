// @ts-nocheck

export const INT_CATEGORIES = ['주식', '주식-a', '금', '채권', '현금', '리츠', '배당주식', '예수금'];

export const ACCOUNT_TYPE_CONFIG: Record<string, { emoji: string; activeColor: string; activeBorder: string; inactiveColor: string; label: string; color: string }> = {
  'dc-irp':    { emoji: '🏦', activeColor: 'text-amber-400',   activeBorder: 'border-amber-500',   inactiveColor: 'text-amber-600/70',   label: '퇴직연금', color: '#f59e0b' },
  'isa':       { emoji: '🌱', activeColor: 'text-emerald-400', activeBorder: 'border-emerald-500', inactiveColor: 'text-emerald-600/70', label: 'ISA',      color: '#34d399' },
  'portfolio': { emoji: '📈', activeColor: 'text-blue-400',    activeBorder: 'border-blue-500',    inactiveColor: 'text-blue-600/70',    label: '일반증권', color: '#60a5fa' },
  'dividend':  { emoji: '💰', activeColor: 'text-green-400',   activeBorder: 'border-green-500',   inactiveColor: 'text-green-600/70',   label: '배당형',   color: '#4ade80' },
  'pension':   { emoji: '🎯', activeColor: 'text-purple-400',  activeBorder: 'border-purple-500',  inactiveColor: 'text-purple-600/70',  label: '개인연금', color: '#c084fc' },
  'gold':      { emoji: '🥇', activeColor: 'text-yellow-400',  activeBorder: 'border-yellow-500',  inactiveColor: 'text-yellow-600/70',  label: 'KRX 금현물', color: '#facc15' },
  'overseas':  { emoji: '🌐', activeColor: 'text-sky-400',     activeBorder: 'border-sky-500',     inactiveColor: 'text-sky-600/70',     label: '해외계좌', color: '#38bdf8' },
  'crypto':    { emoji: '₿',  activeColor: 'text-orange-400',  activeBorder: 'border-orange-500',  inactiveColor: 'text-orange-600/70',  label: 'CRYPTO',   color: '#fb923c' },
  'simple':    { emoji: '📋', activeColor: 'text-gray-400',    activeBorder: 'border-gray-500',    inactiveColor: 'text-gray-600/70',    label: '직접입력', color: '#9ca3af' },
};

export const CHART_NAME_TO_PERIOD_KEY = {
  '수익률':  null,
  '총자산':  null,
  'KOSPI':   'kospiPeriodRate',
  'S&P500':  'sp500PeriodRate',
  'NASDAQ':  'nasdaqPeriodRate',
  'US 10Y':  'us10yPeriodRate',
  'Gold':    'goldIntlPeriodRate',
  '국내금':   'goldKrPeriodRate',
  'USDKRW':  'usdkrwPeriodRate',
  'DXY':     'dxyPeriodRate',
  '기준금리': 'fedRatePeriodRate',
  'KR 10Y':  'kr10yPeriodRate',
  'VIX':     'vixPeriodRate',
};

export const MARK_COLOR_CYCLE = ['yellow', 'slate', 'rose', 'brown'] as const;

export const MARK_ROW_BG: Record<string, string> = {
  yellow: 'bg-[rgba(234,179,8,0.20)] hover:bg-[rgba(234,179,8,0.30)]',
  slate:  'bg-[rgba(148,163,184,0.22)] hover:bg-[rgba(148,163,184,0.32)]',
  rose:   'bg-[rgba(225,29,72,0.22)] hover:bg-[rgba(225,29,72,0.32)]',
  brown:  'bg-[rgba(180,83,9,0.28)] hover:bg-[rgba(180,83,9,0.38)]',
};

export const MARK_STICKY_BG: Record<string, string> = {
  yellow: 'bg-[#3a3015] group-hover:bg-[#4a3d1a]',
  slate:  'bg-[#2b3142] group-hover:bg-[#3a4257]',
  rose:   'bg-[#3a1a2a] group-hover:bg-[#4a223a]',
  brown:  'bg-[#3a2a18] group-hover:bg-[#4a3520]',
};

export const MARK_STRIP_BG: Record<string, string> = {
  yellow: '#eab308',
  slate:  '#94a3b8',
  rose:   '#e11d48',
  brown:  '#b45309',
};

export const CHART_NAME_TO_POINT_KEY = {
  'KOSPI':   'kospiPoint',  'S&P500': 'sp500Point', 'NASDAQ': 'nasdaqPoint',
  'US 10Y':  'us10yPoint',  'Gold': 'goldIntlPoint', '국내금': 'goldKrPoint', 'USDKRW': 'usdkrwPoint',
  'DXY':     'dxyPoint',    '기준금리': 'fedRatePoint', 'KR 10Y': 'kr10yPoint', 'VIX': 'vixPoint',
};
