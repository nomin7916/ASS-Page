// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// ⚠️ `../ledger` import를 **한 덩어리로 합치지 말 것** — `memory/tools/undefcheck.mjs`의 import
//    정규식이 `{...}` 안을 300자까지만 보므로, 합치면 여기서 들여온 이름이 전부 '미해결 후보'로
//    잡혀 그 게이트가 이 파일에서 영구히 무의미해진다(LedgerPage 헤더와 같은 규약).
import {
  LEDGER_PAY_LABEL, LEDGER_PAY_ORDER, LEDGER_GROUP_LABEL, LEDGER_GROUP_COLOR,
} from '../ledger';
import {
  makeLedgerTx, suggestItems, shiftLedgerDate, isValidLedgerDate,
  MAX_LEDGER_TX_SPLITS, MAX_LEDGER_TX_MEMO_LEN, MAX_LEDGER_INSTALLMENT_MONTHS,
  MAX_LEDGER_PAYER_LEN,
} from '../ledger';

/**
 * 빠른 입력 바 — **입력 마찰 최소화가 이 컴포넌트의 전부다.**
 *
 * 조사 결론(머니매니저 "항목 누르고 금액 치면 끝")과 습관 연구(생활 앱 100일 내 중단 중앙값
 * 70%, 이탈 1원인은 daily-logging tax)가 근거다. 그래서:
 *   · 포커스 흐름은 **금액 → 항목 → Enter** 세 번으로 끝난다.
 *   · 추가 후 금액·메모만 비우고 나머지(날짜·항목·결제)는 유지한다(연속 입력).
 *   · 항목을 안 고르고 Enter를 눌러도 **미분류로 저장**한다(고르라고 막지 않는다).
 *
 * ⚠️ `readOnly`면 통째로 렌더하지 않는다 — 끊긴 창에서 한참 입력한 뒤 아무 데도 저장되지
 *    않는 것이 가장 나쁜 결과다(엑셀 버튼과는 반대 규약: 그쪽은 읽기 동작이라 항상 열려 있다).
 * ⚠️ 확인창·토스트를 쓰지 말 것 — 이 화면은 z-1090이고 별도 창에는 App조차 마운트되지 않아
 *    `ConfirmDialog`(z-1000)도 알림도 뜨지 않는다. 피드백은 **인라인**뿐이다.
 */

const inputCls = 'bg-gray-900/70 border border-gray-700 rounded px-2 py-1 text-[12px] outline-none focus:border-amber-600';

const parseMoney = (raw) => {
  const t = String(raw ?? '').trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export default function LedgerQuickEntry({
  book,
  today = '',
  readOnly = false,
  onAdd,
  /** 거래 탭으로 이동(미분류 정리 안내 등) */
  onGoTx = null,
  /** 일치하는 항목이 없을 때 그 자리에서 만든다 — 새 항목 id를 **동기로** 돌려줘야 한다. */
  onCreateItem = null,
  flash = '',
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [date, setDate] = useState(today || '');
  const [amountText, setAmountText] = useState('');
  const [itemId, setItemId] = useState('');
  const [query, setQuery] = useState('');
  const [pay, setPay] = useState('card');
  const [memo, setMemo] = useState('');
  const [payer, setPayer] = useState('');
  const [kind, setKind] = useState('expense');
  const [inst, setInst] = useState('');
  const [refund, setRefund] = useState(false);
  const [splits, setSplits] = useState([]);          // [] = 단일 항목
  const [openSug, setOpenSug] = useState(false);
  const [err, setErr] = useState('');

  const amountRef = useRef(null);
  const itemRef = useRef(null);

  // ⚠️ `today`는 브릿지로 **늦게 도착한다**(별도 창은 '' 로 시작) — 처음 유효해질 때 한 번만
  //    동기화한다(사용자가 이미 옮긴 날짜를 덮지 않게 ref 게이트).
  const syncedRef = useRef(!!today);
  useEffect(() => {
    if (syncedRef.current || !isValidLedgerDate(today)) return;
    syncedRef.current = true;
    setDate(today);
  }, [today]);

  const items = useMemo(() => (book && Array.isArray(book.items) ? book.items : []), [book]);
  const itemById = useMemo(() => {
    const m = new Map();
    for (const it of items) if (it) m.set(it.id, it);
    return m;
  }, [items]);

  const suggestions = useMemo(
    () => (book ? suggestItems(book, query, date || today, 8) : []),
    [book, query, date, today],
  );

  /** 최근 자주 쓴 항목 — 클릭 한 번으로 항목+결제수단을 채운다. */
  const recent = useMemo(() => (book ? suggestItems(book, '', date || today, 6) : []), [book, date, today]);

  const pickItem = useCallback((id) => {
    setItemId(id);
    const it = itemById.get(id);
    setQuery(it ? (it.name || '') : '');
    if (it) {
      setPay(it.pay || 'card');
      setKind(it.group === 'income' ? 'income' : 'expense');
    }
    setOpenSug(false);
  }, [itemById]);

  const resetAll = () => {
    setAmountText(''); setMemo(''); setSplits([]); setInst(''); setRefund(false);
    setItemId(''); setQuery(''); setErr('');
  };

  const splitSum = splits.reduce((a, b) => a + (parseMoney(b.amount) ?? 0), 0);

  /** 친 이름과 정확히 같은 항목이 없을 때만 '새 항목 만들기'를 제안한다. */
  const canCreate = !!onCreateItem && !readOnly && !itemId && query.trim() !== ''
    && !suggestions.some((sg) => String(sg.name || '').trim().toLowerCase() === query.trim().toLowerCase());
  const createAndSubmit = (full) => {
    const nm = query.trim();
    if (!nm) return;
    const id = onCreateItem ? onCreateItem(nm) : '';
    if (!id) { setErr('항목을 만들지 못했습니다'); return; }
    setItemId(id);
    setQuery(nm);
    setOpenSug(false);
    submit(full, id);   // ⚠️ 반드시 id를 넘긴다(위 forcedItemId 주석 참조)
  };

  /**
   * @param forcedItemId ⚠️ **필수 설계** — `setItemId(id)`는 비동기라, 새 항목을 만든 직후
   *   인자 없이 `submit()`을 부르면 stale한 `itemId === ''`를 읽어 **미분류로 저장된다**
   *   (화면에는 이름이 보여 고쳐진 것처럼 착각하게 되는, 가장 나쁜 실패 모드).
   */
  const submit = (full, forcedItemId) => {
    if (readOnly) return;
    const amount = parseMoney(amountText);
    if (amount === null || !(amount > 0)) {
      setErr('금액을 입력하세요');
      amountRef.current?.focus();
      return;
    }
    if (!isValidLedgerDate(date)) { setErr('날짜가 올바르지 않습니다'); return; }
    let splitOut = [];
    if (splits.length > 0) {
      // ⚠️ 합이 맞지 않으면 **저장하지 않는다** — 정규화가 조용히 강등해 단일 항목으로 만들면
      //    사용자가 쪼갠 의도가 소리 없이 사라진다(아래 '남은 금액 채우기' 버튼이 탈출구).
      if (Math.abs(splitSum - amount) > 1e-6) { setErr(`분할 합계가 금액과 다릅니다 (차이 ${Math.round(amount - splitSum).toLocaleString()})`); return; }
      splitOut = splits.map((s) => ({
        itemId: s.itemId || '',
        amount: parseMoney(s.amount) ?? 0,
        memo: String(s.memo || '').slice(0, MAX_LEDGER_TX_MEMO_LEN),
      }));
    }
    const instN = parseMoney(inst);
    const tx = makeLedgerTx({
      date,
      amount,
      refund,
      kind,
      itemId: splitOut.length > 0 ? '' : (forcedItemId || itemId),
      splits: splitOut,
      pay,
      memo,
      payer,
      installmentMonths: instN !== null && instN >= 2 ? Math.min(Math.trunc(instN), MAX_LEDGER_INSTALLMENT_MONTHS) : null,
      origin: 'manual',
      createdAt: Date.now(),
    });
    const res = onAdd ? onAdd(tx) : null;
    if (res && res.error === 'limit') { setErr('거래가 상한에 도달했습니다 — 설정에서 지난 연도를 정리하세요'); return; }
    if (res && res.error) { setErr('저장하지 못했습니다'); return; }
    setErr('');
    // 연속 입력 — 금액·메모·분할만 비우고 날짜·항목·결제는 그대로 둔다.
    setAmountText(''); setMemo(''); setSplits([]);
    if (full) resetAll();
    amountRef.current?.focus();
  };

  if (readOnly) return null;

  if (collapsed) {
    return (
      <div className="shrink-0 border-t border-gray-800 bg-[#0f1623] px-3 py-1 flex items-center gap-2">
        <button
          className="text-[11px] px-2 py-0.5 rounded bg-amber-900/50 text-amber-200 border border-amber-800/60"
          onClick={() => setCollapsed(false)}
        >＋ 빠른 입력 열기</button>
        {flash && <span className="text-[10px] text-amber-300">{flash}</span>}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-gray-800 bg-[#0f1623] px-3 py-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* 날짜 — ←/→ 하루 이동. 달력 입력도 그대로 쓴다. */}
        <div className="flex items-center gap-0.5">
          <button className="text-[12px] px-1 rounded hover:bg-gray-800 text-gray-400" title="하루 전"
            onClick={() => setDate((d) => shiftLedgerDate(d, -1) || d)}>◀</button>
          <input type="date" className={`${inputCls} w-[130px]`} value={date}
            onChange={(e) => setDate(e.target.value)} title="거래 날짜" />
          <button className="text-[12px] px-1 rounded hover:bg-gray-800 text-gray-400" title="하루 뒤"
            onClick={() => setDate((d) => shiftLedgerDate(d, 1) || d)}>▶</button>
          {today && date !== today && (
            <button className="text-[10px] px-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
              onClick={() => setDate(today)} title="오늘로">오늘</button>
          )}
        </div>

        <input
          ref={amountRef}
          className={`${inputCls} w-[110px] text-right tabular-nums`}
          placeholder="금액"
          inputMode="numeric"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); itemRef.current?.focus(); }
          }}
        />

        {/* 항목 자동완성 — 이름 부분일치 + 최근 60일 빈도(suggestItems 단일 소스) */}
        <div className="relative">
          <input
            ref={itemRef}
            className={`${inputCls} w-[150px]`}
            placeholder="항목 (비우면 미분류)"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setItemId(''); setOpenSug(true); }}
            onFocus={() => setOpenSug(true)}
            onBlur={() => setTimeout(() => setOpenSug(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (openSug && !itemId && suggestions.length > 0 && query.trim() !== '') {
                  pickItem(suggestions[0].itemId);
                  return;
                }
                // 일치가 없으면 이름을 버리지 않는다 — 그 자리에서 변동비 항목으로 만든다.
                if (openSug && canCreate) { createAndSubmit(e.shiftKey); return; }
                submit(e.shiftKey);
              } else if (e.key === 'Escape') { setOpenSug(false); }
            }}
          />
          {openSug && (suggestions.length > 0 || canCreate) && (
            <div className="absolute bottom-full mb-1 left-0 w-[220px] max-h-[220px] overflow-auto bg-[#151b28] border border-gray-700 rounded shadow-lg z-[5]">
              {suggestions.map((s) => (
                <button key={s.itemId}
                  className="w-full text-left px-2 py-1 text-[11px] hover:bg-gray-800 flex items-center gap-1.5"
                  onMouseDown={(e) => { e.preventDefault(); pickItem(s.itemId); }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: LEDGER_GROUP_COLOR[s.group] }} />
                  <span className="truncate text-gray-200">{s.name || '(이름 없음)'}</span>
                  <span className="ml-auto text-[9px] text-gray-500 shrink-0">{LEDGER_GROUP_LABEL[s.group]}</span>
                </button>
              ))}
              {/* ⚠️ 가짜 suggestion 객체로 만들지 말 것 — `pickItem`이 `itemById.get(가짜id)`를
                  못 찾아 입력한 이름을 지운다. 형제 버튼으로 둔다. */}
              {canCreate && (
                <button
                  className="w-full text-left px-2 py-1 text-[11px] hover:bg-gray-800 flex items-center gap-1.5 border-t border-gray-800"
                  title="변동비 항목으로 만들고 이 거래를 그 항목에 넣습니다"
                  onMouseDown={(e) => { e.preventDefault(); createAndSubmit(false); }}>
                  <span className="text-emerald-300 shrink-0">＋</span>
                  <span className="truncate text-emerald-200">새 항목 &quot;{query.trim()}&quot; 만들기</span>
                  <span className="ml-auto text-[9px] text-gray-500 shrink-0">변동비</span>
                </button>
              )}
            </div>
          )}
        </div>

        <select className={inputCls} value={pay} onChange={(e) => setPay(e.target.value)} title="결제수단">
          {LEDGER_PAY_ORDER.map((p) => <option key={p} value={p} className="bg-[#0f1623]">{LEDGER_PAY_LABEL[p]}</option>)}
        </select>

        <input className={`${inputCls} w-[150px]`} placeholder="메모" value={memo}
          maxLength={MAX_LEDGER_TX_MEMO_LEN}
          onChange={(e) => setMemo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(e.shiftKey); } }} />

        <input className={`${inputCls} w-[64px] text-center`} placeholder="할부" inputMode="numeric"
          title={`할부 개월(2~${MAX_LEDGER_INSTALLMENT_MONTHS}) — 비우면 일시불. 월 분배는 매트릭스가 회차로 나눕니다`}
          value={inst} onChange={(e) => setInst(e.target.value)} />

        <input className={`${inputCls} w-[80px]`} placeholder="누가" value={payer}
          maxLength={MAX_LEDGER_PAYER_LEN}
          title="누가 썼는지(부부 카드 명의 구분) — 비워도 됩니다"
          onChange={(e) => setPayer(e.target.value)} />

        <label className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer" title="환급·취소 — 그 달 지출에서 빼줍니다">
          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
          환급
        </label>

        {/* ⚠️ 항목을 고르면 지출/수입은 **항목이 정한다**(모델이 group에서 강제 파생한다).
            토글을 열어 두면 사용자가 두 축이 어긋난 거래를 만들 수 있고, 그러면 같은 달에
            `byYm`은 수입인데 매트릭스는 지출로 세는 상태가 된다(실측). 여기서는 비활성 + 사유 표시. */}
        <div className="flex items-center gap-1 text-[11px] text-gray-400">
          {[['expense', '지출'], ['income', '수입']].map(([k, label]) => (
            <button key={k}
              disabled={!!itemId}
              className={`px-1.5 py-0.5 rounded ${kind === k ? 'bg-amber-900/50 text-amber-200' : 'bg-gray-800 text-gray-500'} ${itemId ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={itemId ? '항목을 고르면 지출/수입은 항목의 구분을 따릅니다 — 바꾸려면 항목을 비우세요' : ''}
              onClick={() => { if (!itemId) setKind(k); }}
            >{label}</button>
          ))}
        </div>

        <button
          className="text-[12px] px-3 py-1 rounded bg-emerald-900/60 hover:bg-emerald-900/90 text-emerald-100 border border-emerald-800/60"
          onClick={() => submit(false)}
          title="추가 (Enter) · Shift+Enter는 추가 후 입력칸을 전부 비웁니다"
        >⏎ 추가</button>

        <button
          className={`text-[11px] px-2 py-0.5 rounded ${splits.length > 0 ? 'bg-sky-900/60 text-sky-200' : 'bg-gray-800 text-gray-400'}`}
          onClick={() => setSplits((s) => (s.length > 0 ? [] : [{ itemId, amount: amountText, memo: '' }, { itemId: '', amount: '', memo: '' }]))}
          title="한 결제를 여러 항목으로 나눕니다(최대 8줄) — 합계가 금액과 같아야 추가됩니다"
        >⋯ 분할</button>

        <div className="flex-1" />
        <button className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
          onClick={() => setCollapsed(true)} title="빠른 입력 바 접기">▾ 접기</button>
      </div>

      {/* 분할 — ⚠️ 합계가 맞아야 추가된다. 어긋난 채 저장하면 항목 합 ≠ 거래 합이 된다. */}
      {splits.length > 0 && (
        <div className="mt-1.5 border border-gray-800 rounded p-1.5 bg-gray-900/40">
          {splits.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1 last:mb-0">
              <span className="text-[10px] text-gray-600 w-4 text-center">{i + 1}</span>
              <select className={`${inputCls} w-[150px]`} value={s.itemId}
                onChange={(e) => setSplits((arr) => arr.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
                <option value="" className="bg-[#0f1623]">(미분류)</option>
                {items.map((it) => <option key={it.id} value={it.id} className="bg-[#0f1623]">{it.name || '(이름 없음)'}</option>)}
              </select>
              <input className={`${inputCls} w-[110px] text-right tabular-nums`} placeholder="금액" inputMode="numeric"
                value={s.amount}
                onChange={(e) => setSplits((arr) => arr.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <input className={`${inputCls} w-[160px]`} placeholder="메모" value={s.memo}
                maxLength={MAX_LEDGER_TX_MEMO_LEN}
                onChange={(e) => setSplits((arr) => arr.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)))} />
              <button className="text-[11px] px-1 text-gray-500 hover:text-red-300"
                onClick={() => setSplits((arr) => arr.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <button className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-40"
              disabled={splits.length >= MAX_LEDGER_TX_SPLITS}
              onClick={() => setSplits((arr) => [...arr, { itemId: '', amount: '', memo: '' }])}>+ 줄 추가</button>
            <button className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
              title="남은 금액을 마지막 줄에 채웁니다"
              onClick={() => {
                const amount = parseMoney(amountText) ?? 0;
                const others = splits.slice(0, -1).reduce((a, b) => a + (parseMoney(b.amount) ?? 0), 0);
                setSplits((arr) => arr.map((x, j) => (j === arr.length - 1 ? { ...x, amount: String(amount - others) } : x)));
              }}>남은 금액 채우기</button>
            <span className={`text-[10px] ${Math.abs(splitSum - (parseMoney(amountText) ?? 0)) > 1e-6 ? 'text-amber-300' : 'text-gray-500'}`}>
              분할 합계 {Math.round(splitSum).toLocaleString()} / 금액 {Math.round(parseMoney(amountText) ?? 0).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        <span className="text-[10px] text-gray-600">최근</span>
        {recent.map((s) => (
          <button key={s.itemId} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/80 text-gray-300 hover:bg-gray-700"
            onClick={() => { pickItem(s.itemId); amountRef.current?.focus(); }}>{s.name || '(이름 없음)'}</button>
        ))}
        {err && <span className="text-[10px] text-amber-300 ml-1">{err}</span>}
        {flash && <span className="text-[10px] text-emerald-300 ml-1">{flash}</span>}
        <div className="flex-1" />
        {onGoTx && (
          <button className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
            onClick={onGoTx}>거래 목록 →</button>
        )}
      </div>
    </div>
  );
}
