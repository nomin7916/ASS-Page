// @ts-nocheck
import { useEffect } from 'react';
import { calcPortfolioEvalDetail, resolveHoldings, cleanNum } from '../utils';
import { getTodayKST, getKrSettledTodayDate, isKrCutoffAccount } from './useMarketCalendar';

// 앱 실행 시 '수량×종가로 자동확정' — 자산검증 모달 수동 확정(VerifyEvalModal.confirm)의 자동화.
//
// 배경: useHistoryBackfill은 실시간 기록(isFixed:false + evalAmount>0)을 '권위값'으로 보호해
//   종가 재계산값으로 절대 덮어쓰지 않는다(단 liveOverrideDate=당일 21:00 예외). 그래서 장중에
//   기록된 과거 라이브 값은 종가와 어긋나도 영구히 남는다 → 자산검증 모달의 '불일치'. 사용자는
//   '수량*종가로 확정'을 손수 눌러 고쳐왔다. 이 훅이 그 동작을 앱 실행 시 자동으로 수행한다.
//
// 대상: 라이브(isFixed:false) + 평가액>0 + 불일치 + 모든 종목 종가/NAV 완비(history|manual) +
//   사용자 미거부(autoConfirmDeclined 없음) 레코드. 날짜는 과거(오늘 미만) 또는 당일 KST 21:00
//   이후(종가 확정). 확정 시 {evalAmount=adjustedAmount=재계산값, isFixed:true} — 수동 확정과 동일.
//   사용자는 모달에서 '확정 취소'로 되돌릴 수 있고, 취소하면 autoConfirmDeclined가 박혀 재확정되지 않는다.
//
// ⚠️ 회귀 주의:
//  - 모든 계좌(활성+비활성)를 단일 functional setPortfolios로 처리한다. setHistory(=patchActive)는
//    내부적으로 functional setPortfolios지만, useHistoryBackfill이 비활성 계좌를 non-functional
//    setPortfolios(배열)로 갱신하므로 동일 커밋에서 섞이면 충돌한다. 단일 functional 갱신 + 본 훅을
//    useHistoryBackfill '뒤'에 배치 → 백필 결과 위에 안전하게 합성(compose)된다.
//  - applyConfirms는 prev(최신 state)에서 isFixed/autoConfirmDeclined를 재확인(staleness 가드) →
//    백필이 먼저 처리한 레코드는 건드리지 않는다.
//  - 확정 후 레코드는 isFixed:true → computeConfirms가 다음 실행에서 제외 → 멱등·무한루프 없음.
//    deps에 portfolios가 없어 자기 setState로 재실행되지 않음(백필과 동일 패턴).
//  - 데이터 완비 가드: 한 종목이라도 source가 history/manual이 아니면(종가/NAV 미로드, 근사값,
//    펀드 currentPrice/evalAmount 폴백) 보류 → 잘못된 값을 영구 고정하지 않는다(과거 펀드 NAV
//    미로드 시 당일 currentPrice 폴백으로 과거를 오확정하는 것 방지).
export const useAutoConfirmHistory = ({
  stockHistoryMap,
  indicatorHistoryMap,
  marketIndicators,
  portfolios,
  setPortfolios,
  effectiveDateKey,
  krEffectiveDateKey,
}) => {
  useEffect(() => {
    if (Object.keys(stockHistoryMap).length === 0) return;
    const todayKST = getTodayKST();
    const krSettledToday = getKrSettledTodayDate(); // 당일 21:00 이후면 오늘, 그 외 null
    const fx = marketIndicators?.usdkrw || 1;

    const computeConfirms = (p) => {
      if (p.deletedAt) return null; // 삭제 계좌는 자동확정 대상 아님(이력 동결, 불필요한 churn 방지)
      const accountType = p.accountType || 'portfolio';
      // 현금성(마통·직접입력)은 시세 이력이 없어 자산검증 불일치 개념이 없음 → 제외
      if (accountType === 'simple' || accountType === 'matong') return null;
      const hist = p.history || [];
      if (hist.length === 0) return null;
      const isOverseas = accountType === 'overseas';
      const mpo = p.manualPriceOverrides || {};
      const confirms = [];
      hist.forEach((rec) => {
        const date = rec?.date;
        if (!date) return;
        if (rec.isFixed) return; // 이미 확정/백필 — 라이브 레코드만 대상
        if (rec.autoConfirmDeclined) return; // 사용자가 확정 취소 → 재확정 금지
        const stored = cleanNum(rec.evalAmount);
        if (!(stored > 0)) return; // 빈/누락 레코드는 백필이 담당
        // 날짜 게이트: 과거(오늘 미만) 또는 (오늘 & KST 21:00 이후 종가 확정).
        // 당일 확정은 KR 계좌(21:00 종가 확정 기준) 전용 — 그 외(crypto 등)는 과거만 대상.
        if (date > todayKST) return;
        if (date === todayKST && !(isKrCutoffAccount(accountType) && krSettledToday === date)) return;
        const resolved = resolveHoldings(p, date);
        // 보유 구성 추정(스냅샷 없음·미검증 pre-baseline)이면 수량이 불확실 → 자동확정 보류
        // (모달은 '🟡 추정' 경고로 사용자 검토를 받지만, 자동 잠금은 잘못된 값을 박을 위험이 있음)
        if (resolved.estimated) return;
        const detail = calcPortfolioEvalDetail(
          resolved.items, accountType, date, stockHistoryMap, indicatorHistoryMap || {}, fx, mpo,
        );
        const recomputed = detail.total;
        if (!(recomputed > 0)) return;
        // 데이터 완비 가드(⚠️ 핵심): 모든 가격 종목이 '그 날짜의 정확한' 종가/NAV(또는 수동입력)여야 확정.
        // source 'history'는 getClosestValue 소급 근사(carry-back)일 수 있어(예: 당일 종가 미로드 시
        // 전일 종가 반환) 신뢰 불가 → stockHistoryMap/goldKr에 '해당 날짜' 키 존재를 직접 확인.
        // deposit/savings는 산출값이라 항상 허용. (none/approximate/펀드 currentPrice·evalAmount 폴백/
        // 소급 history는 보류 → 잘못된 값을 영구 고정하는 것 방지.)
        const allExact = detail.items.every((it) => {
          if (it.source === 'deposit' || it.source === 'savings' || it.source === 'manual') return true;
          if (it.source !== 'history') return false;
          const src = accountType === 'gold'
            ? (indicatorHistoryMap?.goldKr || {})
            : (it.code ? (stockHistoryMap[it.code] || {}) : {});
          return src[date] != null;
        });
        if (!allExact) return;
        // 불일치 판정 — 자산검증 모달과 동일. 해외계좌는 환율 재계산이 권위라 재계산>0이면 일치로 간주.
        const diffRatio = stored > 0 ? Math.abs(recomputed - stored) / stored : 1;
        const matched = isOverseas ? recomputed > 0 : (recomputed > 0 && diffRatio < 0.001);
        if (matched) return;
        confirms.push({ date, value: Math.round(recomputed) });
      });
      return confirms.length > 0 ? confirms : null;
    };

    const byAccount = new Map();
    portfolios.forEach((p) => {
      const c = computeConfirms(p);
      if (c) byAccount.set(p.id, c);
    });
    if (byAccount.size === 0) return;

    const applyConfirms = (hist, confirms) => {
      const valueByDate = new Map(confirms.map((c) => [c.date, c.value]));
      let changed = false;
      const next = hist.map((rec) => {
        const v = valueByDate.get(rec?.date);
        if (v === undefined) return rec;
        // staleness 가드: prev 기준 재확인 — 백필/사용자 확정/거부가 끼어들었으면 보존
        if (rec.isFixed || rec.autoConfirmDeclined) return rec;
        if (!(cleanNum(rec.evalAmount) > 0)) return rec;
        changed = true;
        return { ...rec, evalAmount: v, adjustedAmount: v, isFixed: true };
      });
      return changed ? next : hist;
    };

    setPortfolios((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        const confirms = byAccount.get(p.id);
        if (!confirms) return p;
        const updated = applyConfirms(p.history || [], confirms);
        if (updated === (p.history || [])) return p;
        changed = true;
        return { ...p, history: updated };
      });
      return changed ? next : prev;
    });
  }, [stockHistoryMap, indicatorHistoryMap, effectiveDateKey, krEffectiveDateKey]);
};
