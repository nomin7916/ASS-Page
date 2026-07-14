// 관심종목 전용 시세 조회 유틸.
// 포트폴리오 종목 추가와 달리 계좌 컨텍스트가 없으므로 코드 포맷으로 시장을 판정한다.
// api.ts의 4개 fetcher는 모두 { name, price, changeRate } 동일 shape 반환(Mirae만 추가 필드).
import {
  fetchStockInfo, fetchUsStockInfo, fetchFundInfo, fetchMiraeFundInfo,
  fetchNaverStockHistory, fetchUsStockHistory, fetchFundNavHistory, fetchMiraeFundNavHistory,
} from './api';

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

// 미니 차트용 최근 ~1년 일별 종가 이력. [date, close][](오름차순) | null.
// 1주/1개월/3개월/1년 토글은 이 1건을 팝업에서 기간별로 슬라이스(재조회 없이 즉시 반영).
// ⚠️ 반환값은 팝업 로컬 맵에만 저장(공유 stockHistoryMap 오염 금지 — 보유종목 평가액 불변식 보호).
export async function fetchWatchDaily(market: WatchMarket, code: string):
  Promise<[string, number][] | null> {
  const c = (code || '').trim();
  if (!c) return null;
  let data: Record<string, number> | null = null;
  try {
    if (market === 'kr') {
      const r = await fetchNaverStockHistory(c, 300); // 최근 ~300거래일(fchart) ≈ 1.2년
      data = r?.data || null;
    } else if (market === 'us') {
      const r = await fetchUsStockHistory(c.toUpperCase(), daysAgo(370));
      data = r?.data || null;
    } else {
      const start = daysAgo(400);
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

async function fetchNaverIntraday(code: string): Promise<number[] | null> {
  const url = `https://api.stock.naver.com/chart/domestic/item/${code}/today`;
  const proxies = [
    `/api/proxy?url=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${url}`,
  ];
  for (const p of proxies) {
    try {
      const res = await fetch(p, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json: any = await res.json();
      // 응답 형식이 배열/객체 어느 쪽이든 방어적으로 처리
      const arr: any[] = Array.isArray(json)
        ? json
        : (json?.chartInfoList || json?.priceInfos || json?.prices || json?.result || json?.list || []);
      if (Array.isArray(arr) && arr.length) {
        const pts = arr
          .map((it) => Number(it?.closePrice ?? it?.close ?? it?.currentPrice ?? it?.prc ?? it?.trdPrc ?? it?.price))
          .filter((v) => isFinite(v) && v > 0);
        if (pts.length >= 2) return pts;
      }
    } catch { /* next proxy */ }
  }
  return null;
}
