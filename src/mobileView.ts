// 휴대폰 화면(화면 폭 768px 미만) — 순수 로직·색·숫자 모양 (사용자 확정 2026-11-27, 미래에셋 MY자산 구조 참고 시안).
// ⚠️ import 0 — verify:mobile-view 가 직접 import한다.
// ⚠️ 휴대폰 화면은 '모양만' 다르다: 숫자는 PC와 같은 계산값(useIntegratedData·usePortfolioData)을 받아 그리기만 한다 —
//    여기서 평가액·원금·수익을 새로 계산하지 말 것(같은 날 PC와 휴대폰 숫자가 갈린다).
// ⚠️ 배경 고르기·PC 화면 보기는 이 기기의 브라우저 저장소 한 칸에만 둔다(Drive·STATE 금지 — 화면 모양 설정이라 계좌 데이터가 아니다).

export const MOBILE_QUERY = '(max-width: 767px)';
export const MOBILE_HTML_CLASS = 'mobile-view';
export const MOBILE_THEME_KEY = 'assPage:mobileTheme:v1';
export const MOBILE_PC_KEY = 'assPage:mobilePc:v1';
// 휴대폰 화면 덮개의 z — PIN 창(500)·사진 맞추기(1000)·확인 창(1000)·로딩(1100)보다 아래, PC 화면의 고정 헤더(30)·메뉴(100)보다 위.
export const MOBILE_Z = 250;

export type MobileThemePref = 'system' | 'black' | 'beige' | 'navy';
export type MobileThemeName = 'black' | 'beige' | 'navy';
export const MOBILE_THEME_PREFS: MobileThemePref[] = ['system', 'black', 'beige', 'navy'];

export const MOBILE_THEMES: Record<MobileThemeName, Record<string, string>> = {
  black: { bg: '#0B0B0C', card: '#1A1A1D', chip: '#1C1C1F', segOn: '#000000', line: '#232327', line2: '#3A3A40', head: '#141416', text: '#F4F4F5', sub: '#A1A1AA', up: '#FF5A5F', down: '#5B8DEF', sheet: '#1C1C1F', overlay: 'rgba(0,0,0,0.62)', pill: '#2A2A2E', selRow: '#26262A', hl: '#1F2633', scheme: 'dark' },
  beige: { bg: '#F5F0E6', card: '#FFFCF5', chip: '#EAE2D3', segOn: '#FFFCF5', line: '#E3DACA', line2: '#CFC4B0', head: '#EDE6D8', text: '#1F1B16', sub: '#625A4F', up: '#C01D26', down: '#1A56C4', sheet: '#FFFCF5', overlay: 'rgba(31,27,22,0.42)', pill: '#EAE2D3', selRow: '#F1EADD', hl: '#F6E7C4', scheme: 'light' },
  navy: { bg: '#0B1120', card: '#111A2E', chip: '#16213A', segOn: '#0B1120', line: '#1E2A3E', line2: '#33415C', head: '#0F172A', text: '#E5E7EB', sub: '#94A3B8', up: '#F87171', down: '#60A5FA', sheet: '#111A2E', overlay: 'rgba(0,0,0,0.6)', pill: '#1E293B', selRow: '#16213A', hl: '#1B2A4A', scheme: 'dark' },
};

export const MOBILE_THEME_OPTIONS: { key: MobileThemePref; label: string; sub: string; swatch: string; isDefault?: boolean }[] = [
  { key: 'system', label: '시스템 연동', sub: '휴대폰이 다크 모드면 블랙, 라이트 모드면 밝은 베이지', swatch: 'linear-gradient(135deg, #0B0B0C 50%, #F5F0E6 50%)', isDefault: true },
  { key: 'black', label: '블랙', sub: '검정 바탕', swatch: '#0B0B0C' },
  { key: 'beige', label: '밝은 베이지', sub: '따뜻한 밝은 바탕', swatch: '#F5F0E6' },
  { key: 'navy', label: '남색', sub: 'PC 화면과 같은 색', swatch: '#0B1120' },
];

export function normalizeThemePref(v: unknown): MobileThemePref {
  return (MOBILE_THEME_PREFS as string[]).includes(String(v)) ? (String(v) as MobileThemePref) : 'system';
}

export function readMobileTheme(storage: any): MobileThemePref {
  try { return normalizeThemePref(storage ? storage.getItem(MOBILE_THEME_KEY) : null); } catch { return 'system'; }
}

export function writeMobileTheme(storage: any, v: unknown): void {
  try {
    if (!storage) return;
    const p = normalizeThemePref(v);
    if (p === 'system') storage.removeItem(MOBILE_THEME_KEY); else storage.setItem(MOBILE_THEME_KEY, p);
  } catch { /* 저장소를 못 쓰는 창에서는 이번 탭에서만 유지 */ }
}

export function resolveMobileTheme(pref: unknown, sysDark: boolean): MobileThemeName {
  const p = normalizeThemePref(pref);
  if (p === 'system') return sysDark ? 'black' : 'beige';
  return p;
}

// 'PC 화면으로 보기'는 이 탭(세션)에서만 — 탭을 닫았다 열면 다시 휴대폰 화면.
export function readPcView(storage: any): boolean {
  try { return !!storage && storage.getItem(MOBILE_PC_KEY) === '1'; } catch { return false; }
}

export function writePcView(storage: any, on: boolean): void {
  try {
    if (!storage) return;
    if (on) storage.setItem(MOBILE_PC_KEY, '1'); else storage.removeItem(MOBILE_PC_KEY);
  } catch { /* 이번 화면에서만 유지 */ }
}

export function isMobileViewOn(narrow: boolean, pcView: boolean): boolean {
  return !!narrow && !pcView;
}

// 계좌 종류 배지 — 색은 PC 계좌 탭(ACCOUNT_TYPE_CONFIG)과 같은 색 계열에서 흰 글자 대비 4.5:1 이상인 진한 쪽.
export const ACCOUNT_BADGES: Record<string, { badge: string; label: string; bg: string }> = {
  'dc-irp': { badge: '퇴직\n연금', label: '퇴직연금', bg: '#B45309' },
  isa: { badge: 'ISA', label: 'ISA', bg: '#047857' },
  portfolio: { badge: '일반\n증권', label: '일반증권', bg: '#1D4ED8' },
  dividend: { badge: '배당형', label: '배당형', bg: '#15803D' },
  pension: { badge: '개인\n연금', label: '개인연금', bg: '#7E22CE' },
  gold: { badge: '금현물', label: 'KRX 금현물', bg: '#A16207' },
  overseas: { badge: '해외', label: '해외계좌', bg: '#0369A1' },
  crypto: { badge: '코인', label: 'CRYPTO', bg: '#C2410C' },
  simple: { badge: '직접\n입력', label: '직접입력', bg: '#4B5563' },
  matong: { badge: '마통', label: '마이너스통장', bg: '#9F1239' },
};

export function badgeOf(type: unknown) {
  return ACCOUNT_BADGES[String(type || 'portfolio')] || ACCOUNT_BADGES.portfolio;
}

export const MASK = '••••••';
const FMT_WON = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const FMT_USD = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FMT_QTY = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 });

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function fmtWon(n: unknown): string {
  const v = Math.round(num(n));
  return FMT_WON.format(Object.is(v, -0) ? 0 : v);
}

export function fmtSigned(n: unknown): string {
  const v = Math.round(num(n));
  return (v > 0 ? '+' : v < 0 ? '-' : '') + FMT_WON.format(Math.abs(v));
}

export function fmtPct(n: unknown): string {
  const v = num(n);
  return (v > 0.004 ? '+' : v < -0.004 ? '-' : '') + Math.abs(v).toFixed(2);
}

export function fmtUsd(n: unknown): string {
  return '$' + FMT_USD.format(num(n));
}

export function fmtQty(n: unknown): string {
  return FMT_QTY.format(num(n));
}

export function toneOf(n: unknown): 'up' | 'down' | 'flat' {
  const v = num(n);
  return v > 0.0000001 ? 'up' : v < -0.0000001 ? 'down' : 'flat';
}

export type MobileAccountRow = {
  id: string; name: string; type: string; badge: string; label: string; badgeBg: string;
  evalAmount: number; principal: number; profit: number; rate: number;
  weight: number | null; isTest: boolean; canOpen: boolean;
};

// 대시보드 계좌 목록 — portfolioSummaries(useIntegratedData) 그대로. 삭제 계좌 제외, 마통은 맨 아래(PC 통합 표와 같은 차례).
// ⚠️ summary.accountType은 시장 계좌를 모두 'portfolio'로 뭉치므로 종류는 portfolios에서 읽는다.
export function mobileAccountList(portfolios: any[], summaries: any[], totalEval: number): MobileAccountRow[] {
  const typeById: Record<string, string> = {};
  (portfolios || []).forEach(p => { if (p && p.id != null) typeById[p.id] = p.accountType || 'portfolio'; });
  const live = (summaries || []).filter(s => s && !s.deletedAt);
  const ordered = [...live.filter(s => s.accountType !== 'matong'), ...live.filter(s => s.accountType === 'matong')];
  return ordered.map(s => {
    const type = s.accountType === 'simple' || s.accountType === 'matong' ? s.accountType : (typeById[s.id] || 'portfolio');
    const b = badgeOf(type);
    const evalAmount = num(s.currentEval);
    const principal = num(s.principal);
    const isTest = !!s.isTest;
    return {
      id: s.id, name: s.name || b.label, type, badge: b.badge, label: b.label, badgeBg: b.bg,
      evalAmount, principal, profit: evalAmount - principal, rate: num(s.returnRate),
      weight: !isTest && totalEval > 0 ? (evalAmount / totalEval) * 100 : null,
      isTest, canOpen: type !== 'simple' && type !== 'matong',
    };
  });
}

export type MobileHoldingRow = {
  id: string; code: string; name: string; kind: 'stock' | 'fund' | 'savings' | 'cash';
  qty: number; unit: string; weight: number; profit: number; rate: number; evalAmount: number; invest: number;
  price: number; avg: number; usd: boolean; changeRate: number | null; today: number;
};

// 계좌 잔고 표 — usePortfolioData의 totals.calcPortfolio(PC 종목 표와 같은 행) 그대로. 예수금 행은 합쳐 맨 아래 한 줄.
export function mobileHoldingRows(calcPortfolio: any[], accountType: string) {
  const usd = accountType === 'overseas';
  const unit = accountType === 'gold' ? 'g' : accountType === 'crypto' ? '개' : '주';
  let depositEval = 0, holdInvest = 0, holdEval = 0, today = 0, hasChange = false;
  const rows: MobileHoldingRow[] = [];
  (calcPortfolio || []).forEach((it: any) => {
    if (!it) return;
    if (it.type === 'deposit') { depositEval += num(it.evalAmount); return; }
    const kind: MobileHoldingRow['kind'] = it.type === 'fund' ? 'fund' : it.type === 'savings' ? 'savings' : it.isManualCash ? 'cash' : 'stock';
    const evalAmount = num(it.evalAmount);
    const invest = num(it.investAmount);
    const qty = num(it.quantity);
    if (!it.name && !it.code && !evalAmount && !invest && !qty) return;
    const chgRaw = it.changeRate;
    const chg = kind === 'stock' && chgRaw !== '' && chgRaw != null && Number.isFinite(Number(chgRaw)) ? Number(chgRaw) : null;
    const dayPl = chg != null && chg > -100 ? evalAmount * chg / (100 + chg) : 0;
    if (chg != null) hasChange = true;
    today += dayPl;
    holdInvest += invest;
    holdEval += evalAmount;
    rows.push({
      id: String(it.id ?? it.code ?? it.name), code: String(it.code || ''), name: String(it.name || it.code || (kind === 'cash' ? '현금' : '이름 없음')), kind,
      qty, unit: kind === 'fund' ? '좌' : unit, weight: num(it.evalRatio), profit: num(it.profit), rate: num(it.returnRate),
      evalAmount, invest, price: num(it.currentPrice), avg: num(it.purchasePrice), usd, changeRate: chg, today: dayPl,
    });
  });
  return { rows, depositEval, holdInvest, holdEval, today, hasChange };
}

// 보유종목 탭의 '어느 계좌에 있나' 한 줄 — useIntegratedData.intHoldingsDonutData 의 묶음 이름 규칙을 그대로 따른다.
export function holdingAccountNames(portfolios: any[], activeId: string, activeTitle: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (key: string, name: string) => {
    if (!key) return;
    if (!out[key]) out[key] = [];
    if (!out[key].includes(name)) out[key].push(name);
  };
  (portfolios || []).forEach(p => {
    if (!p || p.isTest || p.deletedAt) return;
    const acct = (p.id === activeId ? activeTitle : p.name) || '';
    if (p.accountType === 'simple' || p.accountType === 'matong') return;
    const isGold = p.accountType === 'gold';
    (p.portfolio || []).forEach((it: any) => {
      if (!it || it.type === 'deposit') return;
      if (it.type === 'fund') add(it.name || it.code || 'FUND', acct);
      else if (it.type === 'savings') add(it.name || '예적금', acct);
      else add(isGold ? 'KRX 금현물' : (it.name || it.code || ''), acct);
    });
  });
  return out;
}

export function mobileMergedHoldings(donut: any[], names: Record<string, string[]>) {
  return (donut || [])
    .filter(x => x && x.category !== '예수금' && num(x.value) > 0)
    .map(x => {
      const evalAmount = num(x.value);
      const cost = num(x.cost);
      return {
        name: String(x.name), evalAmount, profit: evalAmount - cost, rate: cost > 0 ? (evalAmount - cost) / cost * 100 : 0,
        accounts: (names[x.name] || []).join(' · '),
      };
    });
}

// 오늘의 수익 — PC 통합 헤더 '오늘 수익' 카드와 같은 행(intMonthlyHistory[0]). ⚠️ 보류(dodAbsChange == null)를 0으로 삼키지 말 것.
export function todayOf(rec: any): { held: boolean; amount: number; rate: number; date: string } {
  const held = !rec || rec.dodAbsChange == null;
  return { held, amount: held ? 0 : num(rec.dodAbsChange), rate: held ? 0 : num(rec.dodChange), date: rec?.date ? String(rec.date) : '' };
}

export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[2])}/${Number(m[3])}` : '';
}
