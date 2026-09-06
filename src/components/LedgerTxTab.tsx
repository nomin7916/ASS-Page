// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
// ⚠️ `../ledger` import는 **300자 이하 덩어리로** 나눈다(undefcheck 정규식 한계 — LedgerPage 규약).
import {
  LEDGER_PAY_LABEL, LEDGER_PAY_ORDER, LEDGER_GROUP_COLOR, LEDGER_DIVERGING,
} from '../ledger';
import {
  filterTx, txIndexOf, installmentCharges, isValidLedgerDate, txDisplayName,
  makeYm, MAX_LEDGER_TX, MAX_LEDGER_TX_MEMO_LEN, MAX_LEDGER_PAYER_LEN,
} from '../ledger';

/**
 * 거래 탭 — 날짜별 목록 · 필터 · 검색 · 다중 선택 · 인라인 편집 · 휴지통.
 *
 * ⚠️ 삭제는 **소프트 삭제**(`softDeleteTx`)다. 이 화면은 z-1090이라 확인창·토스트가 뜨지 않고,
 *    되돌리기 없는 삭제는 이탈 원인이다(YNAB/Actual의 tombstone과 같은 근거).
 *    영구 삭제는 휴지통에서 한 번 더 눌러야 한다.
 * ⚠️ 합계는 **이체를 빼고** 센다 — 카드대금 결제·적금 이체가 지출로 이중 계상되는 것이
 *    국내 자동연동 앱의 고질병이고, 이 앱은 그걸 구조로 막는다.
 */

const fmtWon = (v, hide) => {
  if (hide) return '***';
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return `₩${Math.round(v).toLocaleString()}`;
};
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dowOf = (d) => {
  if (!isValidLedgerDate(d)) return '';
  const t = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
  return WEEK[t.getUTCDay()] || '';
};
const inputCls = 'bg-gray-900/70 border border-gray-700 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-amber-600';

export default function LedgerTxTab({
  book,
  year,
  month,
  today = '',
  readOnly = false,
  hideAmounts = false,
  onUpdateTx,
  onDeleteTx,
  onRestoreTx,
  onPurgeTx,
  onBulkItem,
  /** 매트릭스에서 넘어올 때의 초기 필터(항목·월) — 넘기면 한 번만 반영한다. */
  initialFilter = null,
  onConsumeInitialFilter = null,
}) {
  const [scope, setScope] = useState('month');        // month | year | all
  const [fItem, setFItem] = useState('');
  const [fPay, setFPay] = useState('');
  const [fPayer, setFPayer] = useState('');
  const [q, setQ] = useState('');
  const [refundOnly, setRefundOnly] = useState(false);
  const [uncatOnly, setUncatOnly] = useState(false);
  const [trash, setTrash] = useState(false);
  const [sel, setSel] = useState([]);                 // 선택된 거래 id
  const [editId, setEditId] = useState('');
  const [bulkItem, setBulkItem] = useState('');

  const items = useMemo(() => (book && Array.isArray(book.items) ? book.items : []), [book]);
  const itemById = useMemo(() => {
    const m = new Map();
    for (const it of items) if (it) m.set(it.id, it);
    return m;
  }, [items]);
  const ix = useMemo(() => txIndexOf(book), [book]);

  // 매트릭스 셀 클릭 → 그 항목·그 달로 좁혀 온다. ⚠️ 한 번만 반영하고 소비한다
  //    (매 렌더 반영하면 사용자가 필터를 바꿔도 곧바로 되돌아간다).
  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter.itemId !== undefined) setFItem(initialFilter.itemId);
    if (initialFilter.uncategorized) setUncatOnly(true);
    setScope('month');
    setTrash(false);
    onConsumeInitialFilter?.();
  }, [initialFilter, onConsumeInitialFilter]);

  const ym = makeYm(year, month);
  const range = scope === 'month'
    ? { ym }
    : scope === 'year'
      ? { from: `${String(year).padStart(4, '0')}-01-01`, to: `${String(year).padStart(4, '0')}-12-31` }
      : {};

  const list = useMemo(() => filterTx(book && book.transactions, {
    ...range,
    itemId: fItem || undefined,
    pay: fPay || undefined,
    payer: fPayer || undefined,
    q: q || undefined,
    refundOnly,
    uncategorizedOnly: uncatOnly,
    trashOnly: trash,
  }), [book, range.ym, range.from, range.to, fItem, fPay, fPayer, q, refundOnly, uncatOnly, trash]);

  /** 날짜별 묶음 — 목록은 date desc라 그대로 순회하면 최근순 그룹이 된다. */
  const groups = useMemo(() => {
    const out = [];
    let cur = null;
    for (const tx of list) {
      if (!cur || cur.date !== tx.date) { cur = { date: tx.date, txs: [], sum: 0 }; out.push(cur); }
      cur.txs.push(tx);
      if (tx.kind === 'expense') cur.sum += (tx.refund ? -1 : 1) * tx.amount;
    }
    return out;
  }, [list]);

  const totals = useMemo(() => {
    let exp = 0, inc = 0;
    for (const tx of list) {
      const v = (tx.refund ? -1 : 1) * tx.amount;
      if (tx.kind === 'expense') exp += v;
      else if (tx.kind === 'income') inc += v;
    }
    return { exp, inc, count: list.length };
  }, [list]);

  const toggleSel = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const clearSel = () => setSel([]);

  /** ⚠️ 달력 패드와 **같은 함수**를 쓴다 — 손복제하면 같은 거래가 두 화면에서 다른 이름이 된다. */
  const nameOf = (tx) => txDisplayName(tx, itemById);
  const groupOf = (tx) => {
    const splits = Array.isArray(tx.splits) ? tx.splits : [];
    const id = splits.length > 0 ? splits[0].itemId : tx.itemId;
    return itemById.get(id)?.group || 'variable';
  };

  const instLabel = (tx) => {
    const n = tx.installmentMonths;
    if (!(n >= 2)) return '';
    const ch = installmentCharges(tx);
    const per = ch.length > 0 ? ch[0].amount : 0;
    return `할부 ${n}개월 · 월 ${fmtWon(per, hideAmounts)}`;
  };

  const nearLimit = (book && Array.isArray(book.transactions) ? book.transactions.length : 0) >= MAX_LEDGER_TX * 0.8;

  return (
    <div className="p-3">
      {nearLimit && (
        <div className="mb-2 px-2 py-1 text-[11px] rounded bg-amber-900/30 text-amber-200 border border-amber-800/50">
          거래가 {book.transactions.length.toLocaleString()}건입니다(상한 {MAX_LEDGER_TX.toLocaleString()}건) —
          지난 연도를 엑셀로 내려받아 두면 다음 단계의 '연도 정리'로 접을 수 있습니다.
        </div>
      )}

      {/* ── 필터 바 ── */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <div className="flex items-center gap-0.5">
          {[['month', `${month}월`], ['year', `${year}년`], ['all', '전체']].map(([k, label]) => (
            <button key={k}
              className={`text-[11px] px-2 py-0.5 rounded ${scope === k ? 'bg-amber-900/50 text-amber-200 border border-amber-800/60' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-800'}`}
              onClick={() => setScope(k)}>{label}</button>
          ))}
        </div>
        <select className={inputCls} value={fItem} onChange={(e) => setFItem(e.target.value)} title="항목">
          <option value="" className="bg-[#0f1623]">전체 항목</option>
          {items.map((it) => <option key={it.id} value={it.id} className="bg-[#0f1623]">{it.name || '(이름 없음)'}</option>)}
        </select>
        <select className={inputCls} value={fPay} onChange={(e) => setFPay(e.target.value)} title="결제수단">
          <option value="" className="bg-[#0f1623]">전체 결제</option>
          {LEDGER_PAY_ORDER.map((p) => <option key={p} value={p} className="bg-[#0f1623]">{LEDGER_PAY_LABEL[p]}</option>)}
        </select>
        <input className={`${inputCls} w-[80px]`} placeholder="누가" value={fPayer} onChange={(e) => setFPayer(e.target.value)} />
        <input className={`${inputCls} w-[150px]`} placeholder="🔍 메모 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
          <input type="checkbox" checked={refundOnly} onChange={(e) => setRefundOnly(e.target.checked)} />환급만
        </label>
        <label className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer"
          title="항목을 고르지 않고 넣은 거래 — 나중에 여기서 정리합니다">
          <input type="checkbox" checked={uncatOnly} onChange={(e) => setUncatOnly(e.target.checked)} />미분류만
        </label>
        <button
          className={`text-[11px] px-2 py-0.5 rounded ${trash ? 'bg-amber-900/50 text-amber-200' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-800'}`}
          onClick={() => { setTrash((t) => !t); clearSel(); }}
          title="삭제한 거래는 휴지통에 남습니다(복원 가능)"
        >🗑 휴지통{ix.trashCount > 0 ? ` ${ix.trashCount}` : ''}</button>

        <div className="flex-1" />
        <span className="text-[11px] text-gray-400">
          지출 <b className="text-gray-200">{fmtWon(totals.exp, hideAmounts)}</b>
          {totals.inc !== 0 && <> · 수입 <b style={{ color: LEDGER_DIVERGING.under }}>{fmtWon(totals.inc, hideAmounts)}</b></>}
          <span className="text-gray-600"> · {totals.count}건</span>
        </span>
      </div>

      {/* ── 선택 작업 ── */}
      {sel.length > 0 && !readOnly && (
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded bg-gray-800/60 border border-gray-700">
          <span className="text-[11px] text-gray-300">선택 {sel.length}건</span>
          {!trash ? (
            <>
              <select className={inputCls} value={bulkItem} onChange={(e) => setBulkItem(e.target.value)}>
                <option value="" className="bg-[#0f1623]">항목 일괄 변경…</option>
                <option value="__none__" className="bg-[#0f1623]">미분류로</option>
                {items.map((it) => <option key={it.id} value={it.id} className="bg-[#0f1623]">{it.name || '(이름 없음)'}</option>)}
              </select>
              <button className="text-[11px] px-2 py-0.5 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-40"
                disabled={!bulkItem}
                onClick={() => { onBulkItem?.(sel, bulkItem === '__none__' ? '' : bulkItem); setBulkItem(''); clearSel(); }}
              >적용</button>
              <button className="text-[11px] px-2 py-0.5 rounded bg-red-900/50 text-red-200 hover:bg-red-900/80"
                onClick={() => { onDeleteTx?.(sel); clearSel(); }}>삭제(휴지통)</button>
            </>
          ) : (
            <>
              <button className="text-[11px] px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-200 hover:bg-emerald-900/80"
                onClick={() => { onRestoreTx?.(sel); clearSel(); }}>복원</button>
              {/* ⚠️ 영구 삭제는 되돌릴 수 없다 — 휴지통에서 한 번 더 누르게 하는 것이 유일한 마찰이다. */}
              <button className="text-[11px] px-2 py-0.5 rounded bg-red-900/60 text-red-100 hover:bg-red-900/90"
                onClick={() => { onPurgeTx?.(sel); clearSel(); }}>영구 삭제</button>
            </>
          )}
          <button className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400" onClick={clearSel}>선택 해제</button>
        </div>
      )}

      {/* ── 목록 ── */}
      {groups.length === 0 ? (
        <div className="p-6 text-[12px] text-gray-500 text-center border border-gray-800 rounded-lg">
          {trash ? '휴지통이 비어 있습니다.' : '이 조건에 맞는 거래가 없습니다 — 아래 빠른 입력 바에서 추가하세요.'}
        </div>
      ) : (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          {groups.map((g) => (
            <div key={g.date}>
              <div className="flex items-center gap-2 px-2 py-1 bg-[#151b28] border-b border-gray-800">
                <span className="text-[11px] font-semibold text-gray-300">{g.date}</span>
                <span className="text-[10px] text-gray-500">({dowOf(g.date)})</span>
                {g.date === today && <span className="text-[9px] px-1 rounded bg-amber-900/50 text-amber-200">오늘</span>}
                <div className="flex-1" />
                <span className="text-[11px] tabular-nums text-gray-300">{fmtWon(g.sum, hideAmounts)}</span>
              </div>
              {g.txs.map((tx) => {
                const editing = editId === tx.id;
                const sign = tx.refund ? -1 : 1;
                return (
                  <div key={tx.id} className={`border-b border-gray-900/80 ${editing ? 'bg-gray-800/40' : 'hover:bg-gray-800/25'}`}>
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      {!readOnly && (
                        <input type="checkbox" checked={sel.includes(tx.id)} onChange={() => toggleSel(tx.id)} />
                      )}
                      <span className="inline-block w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: LEDGER_GROUP_COLOR[groupOf(tx)] }} />
                      <span className={`text-[11px] truncate ${tx.itemId || (tx.splits || []).length ? 'text-gray-200' : 'text-amber-300'}`} style={{ minWidth: 110 }}>
                        {nameOf(tx)}
                      </span>
                      <span className="text-[10px] text-gray-500 truncate flex-1">{tx.memo}</span>
                      {tx.payer && <span className="text-[9px] px-1 rounded bg-gray-800 text-gray-400 shrink-0">{tx.payer}</span>}
                      <span className="text-[10px] text-gray-500 shrink-0">{LEDGER_PAY_LABEL[tx.pay]}</span>
                      {tx.kind === 'transfer' && <span className="text-[9px] px-1 rounded bg-sky-900/50 text-sky-200 shrink-0">이체</span>}
                      {tx.refund && <span className="text-[9px] px-1 rounded bg-emerald-900/50 text-emerald-200 shrink-0">환급</span>}
                      {tx.installmentMonths >= 2 && (
                        <span className="text-[9px] px-1 rounded bg-gray-800 text-gray-400 shrink-0" title={instLabel(tx)}>할부 {tx.installmentMonths}</span>
                      )}
                      {tx.origin !== 'manual' && (
                        <span className="text-[9px] px-1 rounded bg-gray-800 text-gray-500 shrink-0" title={`출처: ${tx.origin}`}>{tx.origin === 'migrate' ? '이전' : tx.origin}</span>
                      )}
                      <span className={`text-[12px] tabular-nums shrink-0 ${tx.kind === 'income' ? '' : ''}`}
                        style={{ color: tx.kind === 'income' ? LEDGER_DIVERGING.under : (sign < 0 ? LEDGER_DIVERGING.under : undefined), minWidth: 86, textAlign: 'right' }}>
                        {fmtWon(sign * tx.amount, hideAmounts)}
                      </span>
                      {!readOnly && !trash && (
                        <button className="text-[10px] px-1 rounded text-gray-500 hover:text-amber-300 shrink-0"
                          onClick={() => setEditId(editing ? '' : tx.id)}>{editing ? '닫기' : '수정'}</button>
                      )}
                      {!readOnly && trash && (
                        <button className="text-[10px] px-1 rounded text-gray-500 hover:text-emerald-300 shrink-0"
                          onClick={() => onRestoreTx?.([tx.id])}>복원</button>
                      )}
                    </div>

                    {editing && !readOnly && (
                      <div className="px-2 pb-2 flex items-center gap-1.5 flex-wrap">
                        <input type="date" className={inputCls} value={tx.date}
                          onChange={(e) => onUpdateTx?.(tx.id, { date: e.target.value })} />
                        <input className={`${inputCls} w-[100px] text-right tabular-nums`} defaultValue={tx.amount}
                          onBlur={(e) => {
                            const n = Number(String(e.target.value).replace(/,/g, ''));
                            if (Number.isFinite(n) && n > 0 && n !== tx.amount) onUpdateTx?.(tx.id, { amount: n });
                          }} />
                        {/* ⚠️ 이체에는 항목을 붙일 수 없다 — 붙이면 카드대금 결제·적금 이체가
                            지출로 되살아나 `'transfer'`를 둔 이유(이중 계상 차단)가 무너진다.
                            모델이 강제로 비우므로 여기서는 사유를 보여 주고 막는다. */}
                        <select className={inputCls} value={tx.itemId || ''}
                          disabled={tx.kind === 'transfer'}
                          title={tx.kind === 'transfer' ? '이체는 항목을 갖지 않습니다 — 지출/수입으로 바꾸면 항목을 고를 수 있습니다' : ''}
                          onChange={(e) => onUpdateTx?.(tx.id, { itemId: e.target.value, splits: [] })}>
                          <option value="" className="bg-[#0f1623]">(미분류)</option>
                          {items.map((it) => <option key={it.id} value={it.id} className="bg-[#0f1623]">{it.name || '(이름 없음)'}</option>)}
                        </select>
                        <select className={inputCls} value={tx.pay} onChange={(e) => onUpdateTx?.(tx.id, { pay: e.target.value })}>
                          {LEDGER_PAY_ORDER.map((p) => <option key={p} value={p} className="bg-[#0f1623]">{LEDGER_PAY_LABEL[p]}</option>)}
                        </select>
                        {/* 지출/수입은 항목이 정한다(항목이 있으면 비활성). '이체'를 고르면 모델이
                            항목을 비운다 — 그 사실을 title로 미리 알린다. */}
                        <select className={inputCls} value={tx.kind}
                          disabled={!!tx.itemId || (Array.isArray(tx.splits) && tx.splits.length > 0)}
                          title={tx.itemId || (Array.isArray(tx.splits) && tx.splits.length > 0)
                            ? '항목이 있으면 지출/수입은 항목의 구분을 따릅니다 — 이체로 바꾸려면 먼저 항목을 (미분류)로 비우세요'
                            : '이체는 지출·수입 어디에도 들어가지 않습니다(계좌 간 이동)'}
                          onChange={(e) => onUpdateTx?.(tx.id, { kind: e.target.value })}>
                          {[['expense', '지출'], ['income', '수입'], ['transfer', '이체']].map(([k, l]) =>
                            <option key={k} value={k} className="bg-[#0f1623]">{l}</option>)}
                        </select>
                        <input className={`${inputCls} w-[180px]`} defaultValue={tx.memo} placeholder="메모"
                          maxLength={MAX_LEDGER_TX_MEMO_LEN}
                          onBlur={(e) => { if (e.target.value !== tx.memo) onUpdateTx?.(tx.id, { memo: e.target.value }); }} />
                        <input className={`${inputCls} w-[80px]`} defaultValue={tx.payer} placeholder="누가"
                          maxLength={MAX_LEDGER_PAYER_LEN}
                          onBlur={(e) => { if (e.target.value !== tx.payer) onUpdateTx?.(tx.id, { payer: e.target.value }); }} />
                        <input className={`${inputCls} w-[60px] text-center`} defaultValue={tx.installmentMonths ?? ''} placeholder="할부"
                          onBlur={(e) => {
                            const t = String(e.target.value).trim();
                            const n = t === '' ? null : Number(t);
                            onUpdateTx?.(tx.id, { installmentMonths: n });
                          }} />
                        <label className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                          <input type="checkbox" checked={!!tx.refund} onChange={(e) => onUpdateTx?.(tx.id, { refund: e.target.checked })} />환급
                        </label>
                        <button className="text-[11px] px-2 py-0.5 rounded bg-red-900/50 text-red-200 hover:bg-red-900/80"
                          onClick={() => { onDeleteTx?.([tx.id]); setEditId(''); }}>삭제</button>
                        {(tx.splits || []).length > 0 && (
                          <span className="text-[10px] text-gray-500">분할 {(tx.splits || []).length}줄 — 항목을 바꾸면 분할이 해제됩니다</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 text-[10px] text-gray-600 leading-relaxed">
        · 거래를 한 건이라도 넣은 <b>(항목, 월)</b>은 월 매트릭스에서 <b>거래 합</b>이 값이 되고 그 칸은 읽기 전용이 됩니다(같은 숫자가 두 값이 되지 않게).<br />
        · <b>이체</b>는 지출·수입 합계에 들어가지 않습니다 — 카드대금 결제·적금 이체가 지출로 두 번 잡히는 것을 막습니다.<br />
        · <b>할부</b>는 결제일에 1건으로 남고, 월 매트릭스에서는 회차로 나뉘어 계상됩니다(이번 달 할부금 = 이달 지출).<br />
        · 삭제는 <b>휴지통</b>으로 갑니다. 휴지통에서 복원하거나 영구 삭제할 수 있습니다.
      </div>
    </div>
  );
}
