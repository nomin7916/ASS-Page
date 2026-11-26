// 계좌 표 「사진으로 보유 맞추기」로 새로 넣은 종목(종목코드 빈칸)의 코드를 채우고 시세를 부른다
// (사용자 신고·요청 2026-11-26: 새 계좌를 사진으로 맞췄더니 현재가 0·수익률 -100%).
// 차례: ① 다른 계좌에 이름이 같은 종목 → 그 코드(knownCodeFor) ② 없으면 이름으로 검색(findCodeByName — 공식 이름으로 확인)
//       ③ 못 찾으면 메모에 까닭 → 표의 코드 칸이 눈에 띄게 바뀌어 사용자가 넣는다(photoCodeState).
// 부팅이 정착한 뒤(ready)·관리자 접속이 아닐 때(canWrite)만 돈다. 같은 행은 한 세션에 한 번만 찾는다.
import { useEffect, useRef } from 'react';
import { fetchStockInfo, searchKrStockCodes } from '../api';
import { findCodeByName, knownCodeFor, photoCodeTodo, fillPhotoCode, markPhotoCodeMiss } from '../holdingsPhoto';
import { getTodayKST } from './useMarketCalendar';

export function usePhotoCodeFill({ portfolios, setPortfolios, ready, canWrite, onFilled, notify }) {
  const latest = useRef(portfolios);
  latest.current = portfolios;
  const tried = useRef(new Set<string>());
  const busy = useRef(false);

  useEffect(() => {
    if (!ready || busy.current || !canWrite()) return;
    const next = () => photoCodeTodo(latest.current).filter(t => !tried.current.has(`${t.pid}|${t.id}`));
    if (!next().length) return;
    busy.current = true;
    (async () => {
      let acct = 0, found = 0, miss = 0;
      try {
        for (let todo = next(); todo.length && canWrite(); todo = next()) {
          for (const t of todo) {
            tried.current.add(`${t.pid}|${t.id}`);
            const known = knownCodeFor(t.name, latest.current);
            const r = known
              ? { found: { ...known, price: 0, changeRate: 0, from: 'acct' as const }, why: '' as const }
              : await findCodeByName(t.name, { search: searchKrStockCodes, info: fetchStockInfo });
            if (!canWrite()) break;
            const today = getTodayKST();
            const write = (fn) => setPortfolios(prev => prev.map(p => (p.id !== t.pid ? p : { ...p, portfolio: fn(p.portfolio ?? []) })));
            if (r.found) {
              const f = r.found;
              write(items => fillPhotoCode(items, t.id, f, today));
              onFilled(t.pid, t.id, f.code);
              if (known) acct++; else found++;
            } else {
              write(items => markPhotoCodeMiss(items, t.id, r.why, today));
              miss++;
            }
          }
        }
      } finally { busy.current = false; }
      const got = [acct && `다른 계좌의 같은 종목에서 ${acct}개`, found && `이름 검색으로 ${found}개`].filter(Boolean).join(' · ');
      if (got) notify(`사진으로 넣은 종목의 종목코드를 채웠습니다(${got}) — 현재가를 불러옵니다${miss ? ` · ${miss}개는 찾지 못해 코드 칸을 노란색으로 표시했습니다` : ''}`, 'success');
      else if (miss) notify(`사진으로 넣은 종목 ${miss}개의 종목코드를 찾지 못했습니다 — 표의 노란 코드 칸에 6자리 코드를 넣으면 현재가를 불러옵니다`, 'warning');
    })();
  }, [portfolios, ready]); // eslint-disable-line react-hooks/exhaustive-deps
}
