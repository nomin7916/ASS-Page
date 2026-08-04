// ─────────────────────────────────────────────────────────────────────────────
// src/backtestFetch.ts — 백테스트 전용 종가 조회 (api.ts 재사용 얇은 래퍼)
//
// ⚠️ 이 모듈의 반환값을 **stockHistoryMap에 병합하지 말 것**. 그 맵은
//    buildCloseEvalSeries(보유 평가액 재계산)와 useAutoConfirmHistory 데이터완비 가드의
//    권위 소스라, 백테스트용 수정주가/펀드 NAV가 섞이면 보유+백테스트 중복 코드의 과거
//    평가액이 영구히 오염된다(WatchlistPopup의 로컬 맵 불변식과 동일한 이유).
//    호출부(App.tsx)는 반드시 백테스트 전용 로컬 맵(btFetched)에만 담는다.
//
// ⚠️ backtest.ts(순수 엔진)에 이 코드를 넣지 말 것 — 그쪽은 verify-backtest.mjs가 본문을
//    미러 복사해 node에서 실행하므로 fetch/DOM 의존이 들어가면 검증이 통째로 깨진다.
// ─────────────────────────────────────────────────────────────────────────────

import {
  fetchKISStockHistory,
  fetchNaverDomesticHistory,
  fetchNaverStockHistory,
  fetchUsStockHistory,
} from './api';
import { detectMarket, fetchWatchDaily } from './watchlistQuote';

const isValidSeries = (d: unknown): d is Record<string, number> =>
  !!d && typeof d === 'object' && Object.keys(d as object).length >= 2;

/**
 * 종목코드 → `{ 'YYYY-MM-DD': 종가 }`. 실패하면 null.
 *
 * 국내는 실제 종가(KIS → 네이버 trend)를 먼저 시도하고, 그래도 없으면 수정주가(fchart)로
 * 폴백한다. 백테스트는 장기 구간을 보므로 1년치만 주는 관심종목 경로(fetchWatchDaily)는
 * **마지막 폴백**으로만 쓴다.
 *
 * @param fromYear 국내 KIS 조회 시작 연도(기본 2015) — 너무 이르게 잡으면 청크가 늘어 느려진다.
 */
export async function fetchBacktestSeries(
  code: string,
  fromYear: number = 2015,
): Promise<Record<string, number> | null> {
  const c = (code || '').trim();
  if (!c) return null;
  const market = detectMarket(c);

  try {
    if (market === 'kr') {
      const kis = await fetchKISStockHistory(c, fromYear).catch(() => null);
      if (kis && isValidSeries(kis.data)) return kis.data;
      const naver = await fetchNaverDomesticHistory(c).catch(() => null);
      if (naver && isValidSeries(naver.data)) return naver.data;
      const fchart = await fetchNaverStockHistory(c, 3000).catch(() => null);
      if (fchart && isValidSeries(fchart.data)) return fchart.data;
    } else if (market === 'us') {
      const us = await fetchUsStockHistory(c).catch(() => null);
      if (us && isValidSeries(us.data)) return us.data;
    }

    // 펀드(MA:/URL) + 위 경로가 전부 실패한 경우의 공통 폴백.
    // fetchWatchDaily는 `[date, close][]`를 돌려주므로 맵으로 접는다.
    const rows = await fetchWatchDaily(market, c).catch(() => null);
    if (Array.isArray(rows) && rows.length >= 2) {
      const out: Record<string, number> = {};
      for (const [d, v] of rows) {
        if (typeof d === 'string' && typeof v === 'number' && Number.isFinite(v) && v > 0) out[d] = v;
      }
      if (isValidSeries(out)) return out;
    }
  } catch {
    return null;
  }
  return null;
}
