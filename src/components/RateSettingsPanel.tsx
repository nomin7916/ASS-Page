// @ts-nocheck
import React, { useMemo, useState } from 'react';
import {
  RULE_GROUPS, fieldId, getRule, validateRules, rulesToDraft, draftToRules,
  checkManualValue, manualAsOfDate, manualStale, checkNote, NOTE_IMPACTS, MANUAL_STALE_DAYS,
} from '../rateSettings';

/**
 * 금리 모니터링 ⑥ 설정(9-A) — 판정 기준치 · 수동값(주당 장부가·순자산) · 브라질 정치 메모.
 * ⚠️ 저장은 창이 하지 않는다 — onSave가 앱 탭에 보내고 앱 탭이 Drive(rate_monitor_settings.json)에 쓴다.
 * ⚠️ 성공 알림·벨 알림 없음(알림 최소화 정책). 실패만 이 패널 안에 빨간 글씨로.
 * ⚠️ 부모가 key를 바꿔(불러오기·저장 완료) 다시 마운트하면 초안이 저장된 값으로 새로 잡힌다.
 */
export default function RateSettingsPanel({ t, defaults, rules, manual, notes, today, writable, lockReason, onSave }) {
  const [open, setOpen] = useState({ rules: false, manual: false, notes: false });
  const [draft, setDraft] = useState(() => rulesToDraft(rules));
  const [mDraft, setMDraft] = useState(() => {
    const o = {};
    for (const kind of ['bookValue', 'nav']) for (const [tk, v] of Object.entries(manual?.[kind] || {})) o[tk] = { kind, value: v?.value == null ? '' : String(v.value), asOf: v?.asOf || '' };
    return o;
  });
  const [nDraft, setNDraft] = useState(() => (notes || []).map(n => ({ ...n })));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const ruleErrs = useMemo(() => validateRules(draft), [draft]);
  const manualErrs = useMemo(() => {
    const e = {};
    for (const [tk, v] of Object.entries(mDraft)) {
      const c = checkManualValue(v.value);
      if (!c.ok) e[tk] = c.error;
      else if (c.value != null && !manualAsOfDate(v.asOf)) e[tk] = '기준일(YYYY-MM-DD 또는 2026-Q2)을 입력하세요';
    }
    return e;
  }, [mDraft]);
  const noteErrs = useMemo(() => nDraft.map(n => checkNote(n)), [nDraft]);
  const errCount = Object.keys(ruleErrs).length + Object.keys(manualErrs).length + noteErrs.filter(Boolean).length;

  const save = async () => {
    if (!writable || errCount || saving) return;
    setSaving(true); setSaveError('');
    const data = {
      rules: draftToRules(defaults, draft),
      manual: Object.fromEntries(Object.entries(mDraft).map(([tk, v]) => {
        const c = checkManualValue(v.value);
        return [tk, { value: c.ok ? c.value : null, asOf: String(v.asOf || '').trim() || null }];
      })),
      brazilNotes: nDraft,
    };
    const res = await onSave(data);
    setSaving(false);
    if (!res?.ok) setSaveError(res?.error || '저장하지 못했습니다');
  };

  const inp = `w-full rounded border ${t.border} bg-transparent px-1.5 py-0.5 text-[12px] tabular-nums disabled:opacity-60`;
  const Head = ({ k, title, sub }) => (
    <button onClick={() => setOpen(o => ({ ...o, [k]: !o[k] }))} className="w-full flex items-baseline gap-2 py-1.5 text-left">
      <span className="text-[12px] font-bold">{open[k] ? '▾' : '▸'} {title}</span>
      {sub && <span className={`text-[10px] ${t.sub}`}>{sub}</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-1">
      {!writable && <div className="text-[11px] text-amber-400">{lockReason}</div>}

      {/* 1. 판정 기준치 */}
      <div className={`rounded border ${t.border} px-2`}>
        <Head k="rules" title="판정 기준치" sub="③ 판정에 쓰는 숫자 — 범위 밖 숫자는 저장되지 않습니다" />
        {open.rules && (
          <div className="flex flex-col gap-3 pb-2">
            {RULE_GROUPS.map(g => (
              <div key={g.key || 'common'}>
                <div className={`text-[11px] font-bold mb-1 ${t.sub}`}>{g.label}</div>
                <table className="w-full text-[12px] border-collapse">
                  <tbody>
                    {g.fields.map(f => {
                      const id = fieldId(f);
                      const def = getRule(defaults, f);
                      const err = ruleErrs[id];
                      return (
                        <tr key={id} className={`border-b ${t.border}`}>
                          <td className="py-1 pr-2">{f.label}</td>
                          <td className="py-1 pr-2 w-28">
                            <input className={`${inp} ${err ? 'border-red-500' : ''}`} value={draft[id] ?? ''} disabled={!writable} inputMode="decimal"
                              onChange={e => setDraft(d => ({ ...d, [id]: e.target.value }))} />
                            {err && <div className="text-[10px] text-red-400">{err}</div>}
                          </td>
                          <td className={`py-1 pr-2 text-[11px] whitespace-nowrap ${t.sub}`}>{f.unit} · 기본 {def}</td>
                          <td className="py-1 text-right">
                            <button disabled={!writable || String(def) === draft[id]} onClick={() => setDraft(d => ({ ...d, [id]: String(def) }))}
                              className={`text-[11px] px-1.5 rounded border ${t.border} hover:text-sky-400 disabled:opacity-40`}>기본값으로</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. 수동 입력 */}
      <div className={`rounded border ${t.border} px-2`}>
        <Head k="manual" title="수동 입력" sub={`분기 보고서의 주당 값 · 기준일이 ${MANUAL_STALE_DAYS}일 지나면 '오래된 값'`} />
        {open.manual && (
          <table className="w-full text-[12px] border-collapse mb-2">
            <thead>
              <tr className={`text-[11px] ${t.sub} border-b ${t.border}`}>
                <th className="text-left font-normal py-1">티커</th><th className="text-left font-normal py-1">항목</th>
                <th className="text-left font-normal py-1">값($)</th><th className="text-left font-normal py-1">기준일</th><th />
              </tr>
            </thead>
            <tbody>
              {Object.entries(mDraft).map(([tk, v]) => {
                const err = manualErrs[tk];
                const stale = !!String(v.value).trim() && manualStale(v.asOf, today);
                return (
                  <tr key={tk} className={`border-b ${t.border}`}>
                    <td className="py-1 pr-2 font-bold">{tk}</td>
                    <td className={`py-1 pr-2 ${t.sub}`}>{v.kind === 'bookValue' ? '주당 장부가치' : '주당 순자산'}</td>
                    <td className="py-1 pr-2 w-24"><input className={`${inp} ${err ? 'border-red-500' : ''}`} value={v.value} disabled={!writable} inputMode="decimal"
                      onChange={e => setMDraft(m => ({ ...m, [tk]: { ...m[tk], value: e.target.value } }))} /></td>
                    <td className="py-1 pr-2 w-32"><input className={inp} value={v.asOf} disabled={!writable} placeholder="2026-06-30"
                      onChange={e => setMDraft(m => ({ ...m, [tk]: { ...m[tk], asOf: e.target.value } }))} /></td>
                    <td className="py-1 text-[11px]">
                      {err ? <span className="text-red-400">{err}</span>
                        : stale ? <span className="text-amber-400">오래된 값</span>
                        : !String(v.value).trim() ? <span className={t.sub}>입력 필요</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 3. 브라질 정치 메모 */}
      <div className={`rounded border ${t.border} px-2`}>
        <Head k="notes" title="브라질 정치 메모" sub="③ 브라질 국채 ⑥(최근 '불리' 없음)에 쓰입니다" />
        {open.notes && (
          <div className="flex flex-col gap-1 pb-2">
            {nDraft.length === 0 && <div className={`text-[11px] ${t.sub}`}>등록된 메모 없음</div>}
            {nDraft.map((n, i) => (
              <div key={i} className={`grid gap-1 grid-cols-[7rem_1fr_5rem_1fr_auto] items-start border-b ${t.border} pb-1`}>
                <input className={inp} value={n.date} disabled={!writable} placeholder="2026-10-01" onChange={e => setNDraft(a => a.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
                <input className={inp} value={n.text} disabled={!writable} placeholder="내용" onChange={e => setNDraft(a => a.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <select className={inp} value={n.impact} disabled={!writable} onChange={e => setNDraft(a => a.map((x, j) => (j === i ? { ...x, impact: e.target.value } : x)))}>
                  {NOTE_IMPACTS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <input className={inp} value={n.source} disabled={!writable} placeholder="https://… 출처" onChange={e => setNDraft(a => a.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))} />
                <button disabled={!writable} onClick={() => setNDraft(a => a.filter((_, j) => j !== i))} className="text-[11px] px-1.5 text-red-400 disabled:opacity-40">삭제</button>
                {noteErrs[i] && <div className="col-span-5 text-[10px] text-red-400">{noteErrs[i]}</div>}
              </div>
            ))}
            <button disabled={!writable} onClick={() => setNDraft(a => [{ date: today || '', text: '', impact: '중립', source: '' }, ...a])}
              className={`self-start text-[11px] px-2 py-0.5 rounded border ${t.border} hover:text-sky-400 disabled:opacity-40`}>+ 메모 추가</button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button disabled={!writable || errCount > 0 || saving} onClick={save}
          className="px-3 py-1 rounded border border-sky-500 text-sky-400 text-[12px] font-bold disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
        {errCount > 0 && <span className="text-[11px] text-red-400">고칠 칸 {errCount}개 — 저장되지 않습니다</span>}
        {saveError && <span className="text-[11px] text-red-400">{saveError}</span>}
      </div>
    </div>
  );
}
