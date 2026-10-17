// 관심종목 전용 시세 조회 유틸.
// 포트폴리오 종목 추가와 달리 계좌 컨텍스트가 없으므로 코드 포맷으로 시장을 판정한다.
// api.ts의 4개 fetcher는 모두 { name, price, changeRate } 동일 shape 반환(Mirae만 추가 필드).
import {
  fetchStockInfo, fetchUsStockInfo, fetchFundInfo, fetchMiraeFundInfo,
  fetchNaverStockHistory, fetchUsStockHistory, fetchFundNavHistory, fetchMiraeFundNavHistory,
} from './api';
import { pickNaverDividend, pickNaverAnnualDividend, pickYahooDividend } from './watchlistChart';
import { formatNumber, formatFundPrice } from './utils';
import { pickYahooDividendEvents } from './rateAssets';

export type WatchMarket = 'kr' | 'us' | 'fund';

// 코드 → 시장 판정.
// ⚠️ 6자 영숫자 국내 코드(예 005930, 0219E0)는 extractFundCode의 '5~7자→펀드' 규칙과 겹치므로
//    반드시 KR 판정을 펀드보다 먼저 둔다. 잔여 오분류는 UI의 수동 시장 변경으로 보정.
export function detectMarket(raw: string): WatchMarket {
  const code = (raw || '').trim();
  if (!code) return 'us';
  // 명시적 펀드: MA: 접두어 / 미래에셋·funetf URL
  if (/^MA:/i.test(code) || /miraeasset\.com/i.test(code) || /funetf\.co\.kr/i.test(code)) return 'fund';
  // 국내 주식/ETF: 6자 영숫자 + 숫자 1개 이상 (0219E0, 498410 등)
  if (/^[A-Za-z0-9]{6}$/.test(code) && /\d/.test(code)) return 'kr';
  // 순수 알파벳(점·하이픈 허용) 티커 → 미국 (AAPL, SCHD, BRK.B 등)
  if (/^[A-Za-z][A-Za-z.\-]{0,6}$/.test(code)) return 'us';
  // 그 외 5자 이상 영숫자 → 펀드 (미래에셋/funetf)
  if (/^[A-Za-z0-9]{5,}$/.test(code)) return 'fund';
  return 'us';
}

// 시장별 가격 표기 — 관심종목 팝업과 종목 차트 창이 **공유**한다(같은 종목이 두 화면에서 다르게 찍히지 않게).
export const fmtWatchPrice = (market: string, price: any): string => {
  if (market === 'us') return '$' + Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (market === 'fund') return formatFundPrice(price);
  return formatNumber(price);
};

// 코드 → { name, price, changeRate } | null. 실패(모든 프록시 실패/미확인 코드) 시 null.
export async function fetchWatchQuote(market: WatchMarket, code: string):
  Promise<{ name: string; price: number; changeRate: number } | null> {
  const c = (code || '').trim();
  if (!c) return null;
  let d: any = null;
  try {
    if (market === 'kr') {
      d = await fetchStockInfo(c);
    } else if (market === 'us') {
      d = await fetchUsStockInfo(c);
    } else {
      // fund: MA: 접두어/5~7자는 미래에셋, 8자+는 funetf (extractFundCode 규칙 미러)
      if (/^MA:/i.test(c)) d = await fetchMiraeFundInfo(c);
      else if (/^[A-Za-z0-9]{5,7}$/.test(c)) d = await fetchMiraeFundInfo(`MA:${c.toUpperCase()}`);
      else d = await fetchFundInfo(c.toUpperCase());
    }
  } catch {
    d = null;
  }
  if (!d) return null;
  return {
    name: d.name || c,
    price: Number(d.price) || 0,
    changeRate: Number(d.changeRate) || 0,
  };
}

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

// KST 기준 YYYYMMDD (뷰어 타임존 무관 — 인트라데이 조회 창 계산용)
const kstYmd = (date: Date): string =>
  date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');

// 미니 차트용 최근 ~1년 일별 종가 이력. [date, close][](오름차순) | null.
// 1주/1개월/3개월/1년 토글은 이 1건을 팝업에서 기간별로 슬라이스(재조회 없이 즉시 반영).
// ⚠️ 반환값은 팝업 로컬 맵에만 저장(공유 stockHistoryMap 오염 금지 — 보유종목 평가액 불변식 보호).
// fromDate(YYYY-MM-DD, 선택) — 관심종목 '기간 직접 선택'이 1년보다 이전 시작일을 고르면 그만큼 더 받는다.
// 미지정·1년 이내면 종전과 같은 범위(하위호환).
export async function fetchWatchDaily(market: WatchMarket, code: string, fromDate?: string):
  Promise<[string, number][] | null> {
  const c = (code || '').trim();
  if (!c) return null;
  let span = 0; // 오늘부터 fromDate까지의 달력일 + 여유
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    const ms = Date.now() - Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10));
    if (Number.isFinite(ms) && ms > 0) span = Math.ceil(ms / 86400000) + 15;
  }
  let data: Record<string, number> | null = null;
  try {
    if (market === 'kr') {
      // 최근 ~300거래일(fchart) ≈ 1.2년. 그보다 이전이면 달력일 × 0.72(거래일 비율) + 여유.
      const r = await fetchNaverStockHistory(c, Math.max(300, Math.ceil(span * 0.72) + 10));
      data = r?.data || null;
    } else if (market === 'us') {
      const r = await fetchUsStockHistory(c.toUpperCase(), daysAgo(Math.max(370, span)));
      data = r?.data || null;
    } else {
      const start = daysAgo(Math.max(400, span));
      const end = daysAgo(0);
      if (/^MA:/i.test(c)) data = await fetchMiraeFundNavHistory(c, start, end);
      else if (/^[A-Za-z0-9]{5,7}$/.test(c)) data = await fetchMiraeFundNavHistory(`MA:${c.toUpperCase()}`, start, end);
      else data = await fetchFundNavHistory(c.toUpperCase(), start, end);
    }
  } catch {
    data = null;
  }
  if (!data) return null;
  const pairs = Object.entries(data)
    .map(([d, v]) => [d, Number(v)] as [string, number])
    .filter(([, v]) => isFinite(v) && v > 0);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return pairs.length ? pairs : null;
}

// '1일' 인트라데이 종가 배열(오늘 장중, 오름차순) | null. US=Yahoo 5분봉, KR=네이버 today, 펀드=없음.
export async function fetchWatchIntraday(market: WatchMarket, code: string): Promise<number[] | null> {
  const c = (code || '').trim();
  if (!c) return null;
  if (market === 'us') return fetchYahooIntraday(c);
  if (market === 'kr') return fetchNaverIntraday(c);
  return null; // fund: NAV는 일단위라 인트라데이 없음
}

async function fetchYahooIntraday(ticker: string): Promise<number[] | null> {
  const t = ticker.toUpperCase();
  const base = t.includes('.') ? t.split('.')[0] : t;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${base}?range=1d&interval=5m`;
  const proxies = [
    `/api/proxy?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${url}`,
  ];
  for (const p of proxies) {
    try {
      const res = await fetch(p, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json: any = await res.json();
      const closes: (number | null)[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const pts = (closes || []).filter((v): v is number => v != null && isFinite(v) && v > 0);
      if (pts.length >= 2) return pts;
    } catch { /* next proxy */ }
  }
  return null;
}

// 네이버 국내 분봉: /chart/domestic/item/{code}/minute?startDateTime&endDateTime
// 응답 = [{ localDateTime:'YYYYMMDDHHmmss', currentPrice, openPrice, ... }] (국내 주식·ETF 공통, 검증됨).
// 최근 4일 창으로 조회해 가장 최근 거래일의 분봉만 사용(주말/휴장에도 직전 거래일 표시).
async function fetchNaverIntraday(code: string): Promise<number[] | null> {
  const now = Date.now();
  const start = kstYmd(new Date(now - 4 * 86400000)) + '000000';
  const end = kstYmd(new Date(now)) + '160000';
  const target = `https://api.stock.naver.com/chart/domestic/item/${code}/minute?startDateTime=${start}&endDateTime=${end}`;
  const proxies = [
    `/api/proxy?url=${encodeURIComponent(target)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
  ];
  for (const p of proxies) {
    try {
      const res = await fetch(p, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) continue;
      const json: any = await res.json();
      const arr: any[] = Array.isArray(json) ? json : (json?.result || json?.priceInfos || []);
      const rows: [string, number][] = [];
      for (const it of arr) {
        const dt = String(it?.localDateTime ?? it?.localDate ?? '');
        const v = Number(it?.currentPrice ?? it?.closePrice ?? it?.close);
        if (dt.length >= 8 && isFinite(v) && v > 0) rows.push([dt, v]);
      }
      if (rows.length < 2) continue;
      // 가장 최근 거래일(YYYYMMDD)의 분봉만 시간순으로
      const maxDay = rows.reduce((m, [dt]) => (dt.slice(0, 8) > m ? dt.slice(0, 8) : m), '');
      const pts = rows
        .filter(([dt]) => dt.slice(0, 8) === maxDay)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([, v]) => v);
      if (pts.length >= 2) return pts;
    } catch { /* next proxy */ }
  }
  return null;
}

// ── 최근 분배금(관심종목 '분배금' 열) ─────────────────────────────────────────
// 결과: { status:'ok', kind:'last'|'annual', amount, exDate, rate, rateBasis, recent[] }
//     | { status:'none' }        — 응답은 정상인데 분배 기록이 없다
//     | { status:'unsupported' } — 펀드(분배 이력 API 없음)
//     | null                     — 모든 경로가 실패(다시 조회할 수 있다)
// ⚠️ 결과는 관심종목 팝업 로컬 상태에만 둔다 — 계좌의 dividendHistory에 쓰지 말 것(보유하지 않은
//    종목이 분배금 현황 표에 유령 행으로 새어 나온다. backtestFetch와 같은 규약).
const proxyUrls = (u: string): string[] => [
  `/api/proxy?url=${encodeURIComponent(u)}`,
  `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

// 프록시를 차례로 시도해 pick 결과가 null이 아닌 첫 응답을 돌려준다(전부 실패면 null).
async function firstPicked(url: string, pick: (j: any) => any, timeoutMs = 9000): Promise<any> {
  for (const p of proxyUrls(url)) {
    try {
      const res = await fetch(p, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const picked = pick(await res.json());
      if (picked) return picked;
    } catch { /* next proxy */ }
  }
  return null;
}

export async function fetchWatchDividend(market: WatchMarket, code: string): Promise<any> {
  const c = (code || '').trim();
  if (!c) return null;
  if (market === 'fund') return { status: 'unsupported' };
  try {
    if (market === 'us') {
      const t = c.toUpperCase();
      const base = t.includes('.') ? t.split('.')[0] : t;
      return await firstPicked(`https://query1.finance.yahoo.com/v8/finance/chart/${base}?events=div&interval=1d&range=2y`, pickYahooDividend, 10000);
    }
    const k = c.toUpperCase();
    // ① ETF 분배 이력(월·분기 분배 — 최근 1회분과 그 회차 분배율)
    const etf = await firstPicked(`https://m.stock.naver.com/api/etf/${k}/dividend/history?page=1&pageSize=12&firstPageSize=12`, pickNaverDividend);
    if (etf?.status === 'ok') return etf;
    // ② 일반 주식은 ①이 빈 배열이다 — 종목 요약의 연간 주당배당금·배당수익률로 보완한다.
    const annual = await firstPicked(`https://m.stock.naver.com/api/stock/${k}/integration`, pickNaverAnnualDividend);
    if (annual?.status === 'ok') return annual;
    if (etf?.status === 'none' || annual?.status === 'none') return { status: 'none' };
    return null;
  } catch {
    return null;
  }
}

// 미국 종목 배당 이력 전체(최근 2년, 날짜 오름차순) — 금리 모니터링 ⑤가 12개월 합계·1년 전 회차 비교에 쓴다.
// fetchWatchDividend(최근 1회분)는 그대로 둔다. 결과는 호출한 창 메모리에만 둔다(저장 금지).
//   { status:'ok', events } / { status:'none' } / null(모든 경로 실패)
// range — 기본 '2y'(⑤ 표). 과거 신호 검증은 '10y'로 더 길게 받는다.
export async function fetchUsDividendEvents(code: string, range = '2y'): Promise<any> {
  const t = (code || '').trim().toUpperCase();
  if (!t) return null;
  const base = t.includes('.') ? t.split('.')[0] : t;
  try {
    return await firstPicked(`https://query1.finance.yahoo.com/v8/finance/chart/${base}?events=div&interval=1d&range=${encodeURIComponent(range)}`, pickYahooDividendEvents, 10000);
  } catch {
    return null;
  }
}
