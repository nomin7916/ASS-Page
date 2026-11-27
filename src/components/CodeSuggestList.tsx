// @ts-nocheck
// 이름이 비슷한 종목코드 추천 목록(사용자 요청 2026-11-27) — 사진 맞추기 「골라 주세요」와 표의 노란 코드 칸이 함께 쓴다.
// 다른 계좌의 비슷한 이름(extra) + 이름 검색(api.suggestKrStockCodes — /api/proxy만) — 이름이 비슷한 순. 고르는 것은 사용자다.
import React, { useEffect, useState } from 'react';
import { suggestKrStockCodes } from '../api';
import { mergeCodeSuggestions } from '../holdingsPhoto';

export default function CodeSuggestList({ name, extra = [], onPick, disabled = false }) {
  const [st, setSt] = useState({ loading: true, reached: true, list: [] });
  useEffect(() => {
    let alive = true;
    setSt({ loading: true, reached: true, list: [] });
    suggestKrStockCodes(name)
      .then((r) => { if (alive) setSt({ loading: false, reached: !!(r && r.reached), list: (r && r.list) || [] }); })
      .catch(() => { if (alive) setSt({ loading: false, reached: false, list: [] }); });
    return () => { alive = false; };
  }, [name]);
  const list = mergeCodeSuggestions([extra || [], st.list], 8);
  return (
    <div className="space-y-1">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map(s => (
            <button key={s.code} type="button" disabled={disabled} onClick={() => onPick && onPick(s)} title={`${s.name} (${s.code}) — 이 코드로 넣기`}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[12px] text-left transition disabled:opacity-50 ${s.exact ? 'border-emerald-500/60 bg-emerald-900/25 text-emerald-100 hover:bg-emerald-800/40' : 'border-gray-600 bg-gray-800/60 text-gray-100 hover:bg-gray-700'}`}>
              <span className="truncate max-w-[210px]">{s.name}</span>
              <span className="font-mono text-[11px] text-gray-400">{s.code}</span>
              {s.exact ? <span className="text-[10.5px] text-emerald-300">이름 같음</span> : s.from === 'acct' ? <span className="text-[10.5px] text-sky-300">다른 계좌</span> : null}
            </button>
          ))}
        </div>
      )}
      {st.loading && <p className="text-[11.5px] text-gray-500 animate-pulse">이름이 비슷한 종목을 찾는 중…</p>}
      {!st.loading && list.length === 0 && (
        <p className="text-[11.5px] text-gray-500">{st.reached ? '이름이 비슷한 종목을 찾지 못했습니다 — 종목코드를 직접 넣어 주세요.' : '연결이 안 돼 추천을 받지 못했습니다 — 종목코드를 직접 넣어 주세요.'}</p>
      )}
    </div>
  );
}
