// @ts-nocheck
import { useEffect, useMemo } from 'react';
import { CARD_NEEDS, historicalCodesOf, pickStockHistorySubset } from '../cardWindow';

/**
 * 카드 별도 창 한 개당 하나씩 마운트되는 **피더**(렌더 출력 없음).
 *
 * ⚠️ 창마다 컴포넌트를 하나씩 두는 이유: 창 수가 가변인데 훅은 가변 호출이 불가능하다.
 *    컴포넌트로 쪼개면 인스턴스별 훅 수가 고정돼 Rules of Hooks 문제가 사라지고,
 *    **계좌 객체 identity**로 전송을 게이팅할 수 있다(JSON 지문보다 정확하고 공짜다 —
 *    setPortfolios의 map은 바뀌지 않은 계좌의 참조를 그대로 보존한다).
 *
 * ⚠️ 파생값을 보내지 않는다(INV-2). 창이 usePortfolioData로 직접 계산한다.
 *
 * ⚠️ 카드가 실제로 읽지 않는 데이터는 보내지 않는다(CARD_NEEDS). `stockFetchStatus`는 시세
 *    갱신 중 코드마다 loading→success로 바뀌어 전송이 폭주하므로 필요한 카드에만 싣는다.
 */
export default function CardWinFeed({
  entry, portfolios, marketIndicators, marketHolidays, dividendTaxHistory, dividendLinks,
  stockHistoryMap, indicatorHistoryMap, stockFetchStatus, hideAmounts, isAdmin, authEpoch, nonce,
  effectiveDateKey, histPeriod,
}) {
  const needs = CARD_NEEDS[entry.card] || {};

  const account = useMemo(
    () => (portfolios || []).find(p => p && p.id === entry.pid) || null,
    [portfolios, entry.pid],
  );

  // ⚠️ 종가 부분집합은 **현재 보유 ∪ 과거 보유(holdingSnapshots) ∪ 수동 종가 키**의 합집합이다.
  //    평가액 시계열은 그 날짜의 스냅샷 items를 평가하므로, 현재 보유 코드만 보내면 매도·이관한
  //    종목이 빠져 그 구간이 통째로 carry-forward로 그려진다(앱 탭과 값이 갈린다).
  const priceSubset = useMemo(() => {
    if (!needs.prices || !account) return null;
    return pickStockHistorySubset(stockHistoryMap, historicalCodesOf(account));
  }, [needs.prices, account, stockHistoryMap]);

  useEffect(() => {
    const w = entry.win;
    if (!w || w.closed) return;
    const payload = {
      type: 'card:data',
      winId: entry.id,
      authEpoch,
      account,
      marketIndicators,
      hideAmounts,
      isAdmin,
    };
    if (needs.dividend) {
      payload.marketHolidays = marketHolidays;
      payload.dividendTaxHistory = dividendTaxHistory;
      payload.dividendLinks = dividendLinks;
    }
    if (needs.prices) {
      payload.stockHistoryMap = priceSubset;
      payload.indicatorHistoryMap = indicatorHistoryMap;
      // ⚠️ 기록 확정일은 앱이 계산해 보낸다 — 계좌 타입별 경계(KR 21:00 / 글로벌 07:30)를 창에서
      //    다시 계산하면 타이머·자정 경계에서 두 화면의 '오늘' 판정이 갈린다.
      payload.effectiveDateKey = effectiveDateKey;
    }
    if (needs.fetchStatus) payload.stockFetchStatus = stockFetchStatus;
    // ⚠️ 이 값은 **초기 시드**다. card:data는 계좌 객체가 바뀔 때마다 다시 날아가는 **반복 푸시**라,
    //    창이 매번 적용하면 창에서 바꾼 기간 단위가 (창 안에서 메모 한 글자만 고쳐도) 앱 값으로
    //    되돌아간다. 창 쪽 수신부가 gotData 이전 1회만 적용한다.
    if (needs.histPeriod) payload.histPeriod = histPeriod;
    try { w.postMessage(payload, window.location.origin); } catch { /* 창이 닫히는 중이면 무시 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, account, marketIndicators, hideAmounts, isAdmin, authEpoch, nonce,
      marketHolidays, dividendTaxHistory, dividendLinks, priceSubset, indicatorHistoryMap, stockFetchStatus,
      effectiveDateKey, histPeriod]);

  return null;
}
