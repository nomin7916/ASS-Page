// @ts-nocheck
import { useMemo } from 'react';

/**
 * 흐름도 노드가 계좌를 해석할 때 쓰는 라이브 조회 Map.
 *
 * ⚠️ `open`이 false면 계산하지 않는다 — portfolios는 시세 갱신마다 새 배열이 되므로,
 *    보드를 닫아 둔 사용자가 이 비용을 치르면 안 된다(CalendarModal의 notesByDate·
 *    qtyChangesByDate와 동일 계약).
 * ⚠️ 노드별 view를 여기서 만들지 않는다 — 노드 하나만 움직여도 전 노드 view가 재생성되는
 *    것을 피하려고, 계좌 해석은 Map 조회 한 단계로 좁히고 view 생성은 소비처에 맡긴다.
 * ⚠️ accountType은 반드시 portfolios에서 읽는다. portfolioSummaries.accountType은 시장 계좌를
 *    전부 'portfolio'로 납작하게 만든다.
 */
export function useFlowMapData(open, portfolios, portfolioSummaries) {
  return useMemo(() => {
    const portfolioById = new Map();
    const summaryById = new Map();
    const accountOptions = [];
    if (!open) return { portfolioById, summaryById, accountOptions };

    for (const p of Array.isArray(portfolios) ? portfolios : []) {
      if (!p?.id) continue;
      portfolioById.set(p.id, p);
      accountOptions.push({
        id: p.id,
        name: p.name || p.title || '(이름 없음)',
        accountType: p.accountType || 'portfolio',
        deleted: !!p.deletedAt,
        isTest: !!p.isTest,
      });
    }
    for (const s of Array.isArray(portfolioSummaries) ? portfolioSummaries : []) {
      if (!s?.id) continue;
      summaryById.set(s.id, s);
    }
    // 삭제 계좌는 목록 끝으로(선택은 가능 — 과거 구조를 그리는 다이어그램이므로 배제하지 않는다)
    accountOptions.sort((a, b) => (a.deleted === b.deleted ? 0 : a.deleted ? 1 : -1));

    return { portfolioById, summaryById, accountOptions };
  }, [open, portfolios, portfolioSummaries]);
}

export default useFlowMapData;
