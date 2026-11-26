// 계좌 표 「사진으로 보유 맞추기」로 새로 넣은 종목(종목코드 빈칸)의 코드를 이름으로 찾아 채우고 시세를 부른다
// (사용자 신고 2026-11-26: 새 계좌를 사진으로 맞췄더니 현재가 0·수익률 -100%). 찾는 규칙·확인은 holdingsPhoto.findCodeByName.
// 부팅이 정착한 뒤(ready)·관리자 접속이 아닐 때(canWrite)만 돈다. 같은 행은 한 세션에 한 번만 찾는다.
import { useEffect, useRef } from 'react';
import { fetchStockInfo, searchKrStockCodes } from '../api';
import { findCodeByName, photoCodeTodo, fillPhotoCode, markPhotoCodeMiss } from '../holdingsPhoto';
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
      let done = 0, miss = 0, net = 0;
      try {
        for (let todo = next(); todo.length && canWrite(); todo = next()) {
          for (const t of todo) {
            tried.current.add(`${t.pid}|${t.id}`);
            const r = await findCodeByName(t.name, { search: searchKrStockCodes, info: fetchStockInfo });
            if (!canWrite()) break;
            const today = getTodayKST();
            const write = (fn) => setPortfolios(prev => prev.map(p => (p.id !== t.pid ? p : { ...p, portfolio: fn(p.portfolio ?? []) })));
            if (r.found) {
              const f = r.found;
              write(items => fillPhotoCode(items, t.id, f, today));
              onFilled(t.pid, t.id, f.code);
              done++;
            } else if (r.why === 'net') net++;
            else { write(items => markPhotoCodeMiss(items, t.id, r.why, today)); miss++; }
          }
        }
      } finally { busy.current = false; }
      if (done) notify(`사진으로 넣은 종목 ${done}개의 종목코드를 이름으로 찾아 현재가를 불러왔습니다${miss ? ` · ${miss}개는 찾지 못해 📝 메모에 적었습니다` : ''}`, 'success');
      else if (miss) notify(`사진으로 넣은 종목 ${miss}개는 이름으로 종목코드를 찾지 못했습니다 — 표에서 코드를 넣어 주세요`, 'warning');
      else if (net) notify('사진으로 넣은 종목의 종목코드를 찾지 못했습니다(시세 조회 연결 실패) — 새로고침하면 다시 찾습니다', 'warning');
    })();
  }, [portfolios, ready]); // eslint-disable-line react-hooks/exhaustive-deps
}
