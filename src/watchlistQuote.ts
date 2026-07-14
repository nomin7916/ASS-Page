// 관심종목 전용 시세 조회 유틸.
// 포트폴리오 종목 추가와 달리 계좌 컨텍스트가 없으므로 코드 포맷으로 시장을 판정한다.
// api.ts의 4개 fetcher는 모두 { name, price, changeRate } 동일 shape 반환(Mirae만 추가 필드).
import { fetchStockInfo, fetchUsStockInfo, fetchFundInfo, fetchMiraeFundInfo } from './api';

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
