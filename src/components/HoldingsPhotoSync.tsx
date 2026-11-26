// @ts-nocheck
// 계좌 표 「📷 사진으로 보유 맞추기」(사용자 요청 2026-11-26) — 증권사 잔고 화면 사진을 올리면 이 계좌 주식 행의
// 보유수량·투자금액을 맞춘다. 사진 고르기 → 기기에서 줄이기 → /api/holdings-photo(구글 Gemini) → src/holdingsPhoto.ts
// 해석·계획 → 바로 넣기 + [되돌리기]. 사진에 없는 종목 = 0 + 메모(종목명 칸 📝, 마우스 올리면 보임).
// 키: 관리자는 사이트 키(내 키가 있으면 먼저) · 다른 사용자는 내 Gemini 키(내 Drive ai_settings.json — App의 keyApi가 읽고 쓴다).
// ⚠️ 사진은 저장하지 않는다(메모리에서 줄여 보내기만). ⚠️ 쓰기는 applyItems(앱 탭이 최신 prev 위에서 적용)로만.
import React, { useEffect, useRef, useState } from 'react';
import { X, ImagePlus, RotateCcw, Lock, ExternalLink, BookOpen, ScanText } from 'lucide-react';
import { generateId, formatNumber } from '../utils';
import { getTodayKST } from '../hooks/useMarketCalendar';
import { mergePastePhotos, PASTE_PHOTO_MAX, PASTE_PHOTO_ACCEPT, photoBudget, photoReadInit, photoReadStep } from '../taxCalcPaste';
import { syncCandidates, parseHoldingsText, planHoldingsSync, applyHoldingsPlan, undoHoldingsPlan, holdCounts, holdErrorText, looksLikeGeminiKey, maskKey } from '../holdingsPhoto';
import { shrinkPhotoToB64 } from '../photoShrink';
import AiApiGuide, { AI_KEY_PAGE } from './AiApiGuide';
import { classifyOcr, parseOcrHoldings, ocrHoldLine, ocrHoldBad, OCR_FLAG_TEXT } from '../tradeOcr';
import { loadOcrEngine, ocrFile } from '../screenOcr';

const KIND_LABEL = {
  update: { t: '바꿈', c: 'text-sky-300' },
  same: { t: '같음', c: 'text-gray-500' },
  zero: { t: '0으로', c: 'text-amber-300' },
  keep: { t: '그대로', c: 'text-gray-400' },
  add: { t: '새로 추가', c: 'text-emerald-300' },
  cut: { t: '그대로(못 읽음)', c: 'text-gray-400' },
  bad: { t: '넣지 않음', c: 'text-red-300' },
};
const KIND_ORDER = { update: 0, zero: 1, add: 2, bad: 3, keep: 4, cut: 5, same: 6 };
const qtyAmt = (v) => `${formatNumber(v.qty)}주 · ${formatNumber(Math.round(v.invest))}원`;

export default function HoldingsPhotoSync({ open, onClose, accountName = '', items = [], applyItems, isAdmin = false, viewingAs = false, keyApi = null, onOpenCalendarGuide = null }) {
  const [run, setRun] = useState({ phase: 'idle' });
  const [keyState, setKeyState] = useState({ loaded: false, key: '', canSave: false, error: '' });
  const [keyInput, setKeyInput] = useState('');
  const [keyEdit, setKeyEdit] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [pickNote, setPickNote] = useState('');
  const runId = useRef(0);
  const abortRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (!keyApi) { setKeyState({ loaded: true, key: '', canSave: false, error: '' }); return; }
    keyApi.load().then((r) => { if (alive) setKeyState({ loaded: true, key: r?.key || '', canSave: !!r?.canSave, error: r?.error || '' }); })
      .catch((e) => { if (alive) setKeyState({ loaded: true, key: '', canSave: false, error: String(e?.message || e) }); });
    return () => { alive = false; };
  }, [open, keyApi]);

  useEffect(() => () => { runId.current += 1; if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } } }, []);

  if (!open) return null;

  const close = () => {
    runId.current += 1;
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } abortRef.current = null; }
    setRun({ phase: 'idle' });
    setPickNote('');
    setShowGuide(false);
    onClose && onClose();
  };

  // 관리자 접속(impersonation) 탭은 관리자 토큰으로 부른다 → 서버가 사이트 키로 읽는다(사용자 키는 읽지 않음).
  const needKey = !isAdmin && !viewingAs && !keyState.key;
  const busy = run.phase === 'shrink' || run.phase === 'read';

  const saveKey = async (value) => {
    if (!keyApi) return;
    const k = String(value || '').trim();
    if (k && !looksLikeGeminiKey(k)) { setKeyMsg('키 모양이 아닙니다 — AI 스튜디오에서 [복사]한 글자를 그대로 붙여넣어 주세요'); return; }
    setKeyBusy(true); setKeyMsg('');
    try {
      const r = await keyApi.save(k);
      if (r?.ok) { setKeyState(s => ({ ...s, key: k })); setKeyInput(''); setKeyEdit(false); setKeyMsg(k ? '저장했습니다' : '키를 지웠습니다'); }
      else setKeyMsg(r?.error || '저장하지 못했습니다');
    } catch (e) { setKeyMsg(`저장하지 못했습니다 (${e?.message || e})`); }
    setKeyBusy(false);
  };

  const pickPhotos = (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    const { add, notImage, over } = mergePastePhotos([], list);
    setPickNote([
      notImage > 0 ? `사진이 아닌 파일 ${notImage}개는 뺐습니다` : '',
      over > 0 ? `한 번에 ${PASTE_PHOTO_MAX}장까지라 ${over}장은 뺐습니다` : '',
    ].filter(Boolean).join(' · '));
    if (add.length === 0) return;
    readAndApply(add);
  };

  // ⚠️ 답을 끝까지 받은({d:1}) 때만 넣는다 — 중간에 끊긴 글로 맞추면 뒤쪽 종목이 '사진에 없음'으로 0이 된다.
  const readAndApply = async (files) => {
    const id = ++runId.current;
    const live = () => runId.current === id;
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } }
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = ac;
    const n = files.length;
    setRun({ phase: 'shrink', n });
    let images = [];
    try {
      const budget = photoBudget(n);
      for (const f of files) {
        images.push({ mime: 'image/jpeg', data: await shrinkPhotoToB64(f, budget) });
        if (!live()) return;
      }
    } catch (err) {
      if (live()) setRun({ phase: 'error', n, code: err && err.message === 'big' ? 'big' : 'decode' });
      return;
    }
    if (!live()) return;
    setRun({ phase: 'read', n, got: 0 });
    let st = photoReadInit();
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (keyState.key) headers['X-Gemini-Key'] = keyState.key;
      const res = await fetch('/api/holdings-photo', {
        method: 'POST',
        headers,
        body: JSON.stringify({ account: accountName || '', cands: syncCandidates(itemsRef.current), images }),
        signal: ac ? ac.signal : undefined,
      });
      images = [];
      if (!res.ok) {
        let msg = '';
        try { msg = String((await res.json()).error || ''); } catch { /* 글 아님 */ }
        const code = res.status === 401 || res.status === 403 ? 'auth' : 'gemini';
        if (live()) setRun({ phase: 'error', n, code, msg: msg || `HTTP ${res.status}` });
        return;
      }
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          st = photoReadStep(st, dec.decode(value, { stream: true }));
          if (!live()) { try { reader.cancel(); } catch { /* 무시 */ } return; }
          const got = st.text.length;
          setRun(r => (r.phase === 'read' ? { ...r, got } : r));
        }
        st = photoReadStep(st, dec.decode(), true);
      } else {
        st = photoReadStep(st, await res.text(), true);
      }
    } catch (err) {
      if (!live() || (err && err.name === 'AbortError')) return;
      setRun({ phase: 'error', n, code: 'net' });
      return;
    }
    if (!live()) return;
    if (st.error || !st.done) {
      setRun({ phase: 'error', n, code: st.error || 'cut', msg: st.msg, text: st.text });
      return;
    }
    applyHoldText(st.text.trim(), n, st.model, null);
  };

  // 읽은 글(AI 답 · 프로그램 글자 인식) → 해석 → 계획 → 바로 넣기. ocr = 프로그램 읽기 정보(안 보인 종목을 0으로 하지 않음).
  const applyHoldText = (text, n, model, ocr) => {
    const parsed = parseHoldingsText(text);
    const plan = planHoldingsSync(parsed, itemsRef.current, ocr ? { keepUnseen: true } : undefined);
    let undo = null;
    if (plan.outcome === 'apply' && applyItems) {
      const today = getTodayKST();
      const ids = plan.rows.filter(r => r.kind === 'add').map(() => generateId());
      const idGen = () => { let i = 0; return () => ids[i++]; };
      undo = applyHoldingsPlan(itemsRef.current, plan, { newId: idGen(), today }).undo;
      applyItems(prev => applyHoldingsPlan(prev, plan, { newId: idGen(), today }).next);
    }
    setRun({ phase: 'done', n, text, plan, parsed, counts: holdCounts(plan), model, undo, ocr });
  };

  // 프로그램 읽기(AI 없이 · 무료 · 사진은 이 기기에서만) — src/screenOcr.ts(학습 사이트의 PP-OCRv5) → src/tradeOcr.ts 잔고 해석.
  // 자체 검사(보유수량×평균단가 ≈ 매입금액)·글자 확신이 어긋난 종목과 잘린 종목은 '그대로', 안 보인 종목도 0으로 하지 않는다.
  const readByOcr = async (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    const { add, notImage, over } = mergePastePhotos([], list);
    setPickNote([
      notImage > 0 ? `사진이 아닌 파일 ${notImage}개는 뺐습니다` : '',
      over > 0 ? `한 번에 ${PASTE_PHOTO_MAX}장까지라 ${over}장은 뺐습니다` : '',
    ].filter(Boolean).join(' · '));
    if (add.length === 0) return;
    const id = ++runId.current;
    const live = () => runId.current === id;
    const n = add.length;
    setRun({ phase: 'ocr', stage: 'load', n, f: 0 });
    try { await loadOcrEngine(f => { if (live()) setRun(r => (r.phase === 'ocr' && r.stage === 'load' ? { ...r, f } : r)); }); }
    catch (err) {
      if (live()) setRun({ phase: 'error', n, code: 'ocr', msg: err && err.message === 'old' ? '이 브라우저는 너무 오래되어 글자 인식을 할 수 없습니다 — 크롬·사파리 최신판에서 열어 주세요.' : '글자 인식 엔진을 받지 못했습니다 — 인터넷 연결을 확인하고 다시 눌러 주세요.' });
      return;
    }
    const cands = syncCandidates(itemsRef.current);
    const holds = [];
    let unknown = 0;
    for (let i = 0; i < n; i++) {
      if (!live()) return;
      setRun({ phase: 'ocr', stage: 'read', n, i: i + 1, f: 0 });
      let lines = [];
      try { lines = await ocrFile(add[i], f => { if (live()) setRun(r => (r.phase === 'ocr' && r.stage === 'read' ? { ...r, f } : r)); }); }
      catch { unknown++; continue; }
      if (classifyOcr(lines) === 'holdings') holds.push(...parseOcrHoldings(lines, cands).holds);
      else unknown++;
    }
    if (!live()) return;
    if (holds.length === 0) { setRun({ phase: 'error', n, code: 'ocr', msg: '사진에서 잔고(보유종목) 표를 찾지 못했습니다 — 종목명·보유수량·매입금액 머리줄이 보이게 찍어 주세요(또는 아래 AI로 읽기).' }); return; }
    // 겹쳐 찍은 사진의 같은 종목은 한 번만(먼저 읽은 것)
    const seen = new Set();
    const uniq = holds.filter(h => { const k = h.code || h.name; if (seen.has(k)) return false; seen.add(k); return true; });
    applyHoldText(uniq.map(ocrHoldLine).join('\n'), n, '프로그램 글자 인식(AI 없이)', { bad: uniq.filter(ocrHoldBad), unknown });
  };

  const undoApply = () => {
    const u = run.undo;
    if (!u || !applyItems) return;
    applyItems(prev => undoHoldingsPlan(prev, u));
    setRun(r => ({ ...r, phase: 'undone', undo: null }));
  };

  const rows = run.plan ? [...run.plan.rows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) : [];
  const c = run.counts || {};
  const summary = run.plan ? [
    c.update ? `바꿈 ${c.update}` : '', c.zero ? `0으로 ${c.zero}` : '', c.add ? `새로 추가 ${c.add}` : '',
    c.same ? `같음 ${c.same}` : '', c.keep ? `안 보여 그대로 ${c.keep}` : '', c.cut ? `못 읽어 그대로 ${c.cut}` : '', c.bad ? `넣지 않음 ${c.bad}` : '',
  ].filter(Boolean).join(' · ') : '';

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 px-3" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      <div className="relative w-full max-w-[640px] max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-sky-700/50 bg-[#0f1623] shadow-2xl">
        {showGuide ? (
          <AiApiGuide inline onClose={() => setShowGuide(false)} />
        ) : (<>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ImagePlus size={16} className="text-sky-300 shrink-0" />
            <span className="text-gray-100 font-semibold text-sm truncate">사진으로 보유 맞추기{accountName ? ` — ${accountName}` : ''}</span>
          </div>
          <button onClick={close} title="닫기" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-[12.5px] text-gray-300 leading-relaxed">
          <div className="space-y-1">
            <p>증권사 앱의 <b className="text-gray-100">잔고(보유종목) 화면</b>을 캡처해 올리면, 이 계좌 종목의 <b className="text-blue-200">보유수량·투자금액(매입금액)</b>을 사진대로 맞춥니다.</p>
            <p className="text-gray-400">목록이 길면 내려 가며 찍은 사진을 <b className="text-gray-200">한 번에 모두</b> 고르세요. 사진에 없는 종목은 판 것으로 보고 0으로 하고, 종목명 칸에 📝 메모(마우스를 올리면 보임)를 남깁니다.</p>
          </div>

          <div className="rounded-lg border border-sky-600/60 bg-sky-950/30 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-gray-100 font-semibold"><ScanText size={15} className="text-sky-300" />프로그램으로 읽기 <span className="font-normal text-gray-400">— AI 없이 · 무료 · 키 필요 없음</span></div>
            <p className="text-[11.5px] text-gray-400">사진은 이 기기 밖으로 나가지 않습니다(처음 한 번 글자 인식 엔진 약 17MB를 받습니다). 자체 검사(보유수량×평균단가 ≈ 매입금액)가 어긋난 종목은 바꾸지 않고, 사진에 안 보인 종목도 0으로 하지 않습니다.</p>
            <label className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold text-[13px] transition ${busy || run.phase === 'ocr' ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-sky-600 hover:bg-sky-500 text-white cursor-pointer'}`}>
              <ImagePlus size={14} />{run.phase === 'ocr' ? '읽는 중…' : '잔고 사진 고르기(프로그램)'}
              <input type="file" accept={PASTE_PHOTO_ACCEPT} multiple disabled={busy || run.phase === 'ocr'} onChange={readByOcr} className="sr-only" />
            </label>
          </div>
          <p className="text-[11.5px] text-gray-500">AI로 읽기 — 프로그램이 못 읽을 때(판 종목을 0으로 맞출 때도):</p>

          <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 text-gray-200 font-semibold"><Lock size={13} className="text-amber-300" />내 Gemini API 키</span>
              <button onClick={() => setShowGuide(true)} className="flex items-center gap-1 text-[11.5px] text-amber-200 hover:text-amber-100 underline-offset-2 hover:underline"><BookOpen size={12} />키 받는 법(그림)</button>
            </div>
            {isAdmin && <p className="text-[11.5px] text-emerald-300/90">관리자 — 키 없이 사이트 키로 읽습니다{keyState.key ? ' (내 키를 먼저 씁니다)' : ''}.</p>}
            {!keyState.loaded ? (
              <p className="text-gray-500">키를 확인하는 중…</p>
            ) : viewingAs ? (
              <p className="text-gray-500">관리자 접속 중에는 사용자의 키를 읽거나 저장하지 않습니다(사이트 키로 읽습니다).</p>
            ) : keyState.key && !keyEdit ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-emerald-300">✓ 저장됨 <span className="font-mono text-gray-300">{maskKey(keyState.key)}</span></span>
                {keyState.canSave && <button onClick={() => { setKeyEdit(true); setKeyMsg(''); }} className="px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 text-[11.5px]">바꾸기</button>}
                {keyState.canSave && <button disabled={keyBusy} onClick={() => saveKey('')} className="px-2 py-0.5 rounded border border-gray-600 text-gray-400 hover:text-red-300 hover:bg-gray-800 text-[11.5px]">키 지우기</button>}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input type="password" autoComplete="off" spellCheck={false} value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="AIza… 로 시작하는 키 붙여넣기"
                    className="flex-1 min-w-0 bg-[#0b1120] border border-gray-600 focus:border-sky-500 rounded-md px-2.5 py-1.5 text-[12.5px] text-gray-100 font-mono outline-none" />
                  <button disabled={keyBusy || !keyState.canSave || !keyInput.trim()} onClick={() => saveKey(keyInput)} className="px-3 py-1.5 rounded-md bg-sky-700 hover:bg-sky-600 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold text-[12px] shrink-0">저장</button>
                  {keyEdit && <button onClick={() => { setKeyEdit(false); setKeyInput(''); }} className="px-2 py-1.5 rounded-md border border-gray-600 text-gray-400 text-[12px] shrink-0">취소</button>}
                </div>
                <p className="text-[11px] text-gray-500">
                  <a href={AI_KEY_PAGE} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-sky-300 hover:underline">aistudio.google.com/apikey <ExternalLink size={10} /></a>
                  {' '}에서 무료로 만든 키를 넣으면 내 무료 한도로 씁니다. 키는 내 구글 Drive(Index_Data 폴더)에만 저장됩니다.
                </p>
                {!keyState.canSave && keyState.loaded && <p className="text-[11px] text-amber-300/90">{keyState.error || 'Drive에 연결된 뒤 저장할 수 있습니다'}</p>}
              </div>
            )}
            {keyMsg && <p className="text-[11.5px] text-sky-200">{keyMsg}</p>}
            {onOpenCalendarGuide && <p className="text-[11px] text-gray-500">이 사용법은 메모 달력 머리줄 <b className="text-gray-400">AI 연동</b> 버튼에서도 볼 수 있습니다.</p>}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold text-[13px] transition ${busy || needKey ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-sky-700 hover:bg-sky-600 text-white cursor-pointer'}`}
              title={needKey ? '먼저 내 Gemini API 키를 넣어 주세요' : '잔고 화면 사진을 고르면 바로 맞춥니다'}>
              <ImagePlus size={14} />{busy ? '읽는 중…' : '사진 고르기'}
              <input type="file" accept={PASTE_PHOTO_ACCEPT} multiple disabled={busy || needKey} onChange={pickPhotos} className="sr-only" />
            </label>
            <span className="text-[11px] text-gray-500">한 번에 {PASTE_PHOTO_MAX}장까지 · 사진은 저장하지 않습니다</span>
          </div>
          {pickNote && <p className="text-[11.5px] text-amber-300/90">{pickNote}</p>}

          {run.phase === 'ocr' && (
            <p className="text-sky-200 animate-pulse">{run.stage === 'load'
              ? `글자 인식 엔진을 받는 중… ${Math.round((run.f || 0) * 100)}% (처음 한 번만)`
              : `사진 ${run.i}/${run.n}장 글자를 읽는 중… ${Math.round((run.f || 0) * 100)}%`}</p>
          )}
          {run.phase === 'shrink' && <p className="text-sky-200">사진 {run.n}장을 줄이는 중…</p>}
          {run.phase === 'read' && <p className="text-sky-200 animate-pulse">AI가 사진 {run.n}장을 읽는 중…{run.got > 0 ? ` (${run.got}자 받음)` : ''}</p>}
          {run.phase === 'error' && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 space-y-1">
              <p className="text-red-200">{run.code === 'ocr' ? run.msg : holdErrorText(run.code)}</p>
              {run.msg && run.code !== 'ocr' && <p className="text-[11px] text-red-300/70 break-all">{run.msg}</p>}
              {(run.code === 'needkey' || run.code === 'badkey' || run.code === 'credit' || run.code === 'quota0') && <button onClick={() => setShowGuide(true)} className="text-[11.5px] text-amber-200 underline">키 받는 법 보기</button>}
            </div>
          )}

          {(run.phase === 'done' || run.phase === 'undone') && run.plan && (
            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-2">
              {run.plan.outcome === 'none' && <p className="text-amber-200">사진에서 보유 종목 줄을 찾지 못했습니다 — 잔고(보유종목) 화면이 보이게 다시 찍어 주세요.</p>}
              {run.plan.outcome === 'mismatch' && <p className="text-amber-200">사진 속 종목이 이 계좌({accountName || '이 계좌'}) 종목과 하나도 맞지 않아 아무것도 바꾸지 않았습니다 — 다른 계좌의 사진인지 확인해 주세요.</p>}
              {run.plan.outcome === 'same' && <p className="text-gray-300">바꿀 것이 없습니다 — 사진과 이 계좌가 이미 같습니다.</p>}
              {run.plan.outcome === 'apply' && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className={run.phase === 'undone' ? 'text-gray-400' : 'text-emerald-300 font-semibold'}>{run.phase === 'undone' ? '되돌렸습니다 — 맞추기 전으로 돌아갔습니다.' : `맞췄습니다 — ${summary}`}</p>
                  {run.phase === 'done' && run.undo && (
                    <button onClick={undoApply} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-100 text-[12px] font-bold"><RotateCcw size={12} />되돌리기</button>
                  )}
                </div>
              )}
              {run.plan.outcome !== 'apply' && summary && <p className="text-[11.5px] text-gray-500">{summary}</p>}
              {rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead><tr className="text-gray-500 border-b border-gray-700/60"><th className="text-left py-1 pr-2 font-normal">종목</th><th className="text-right py-1 px-2 font-normal">이전</th><th className="text-right py-1 px-2 font-normal">이후</th><th className="text-right py-1 pl-2 font-normal">처리</th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${r.itemId || r.name}-${i}`} className="border-b border-gray-800/60 align-top" title={r.note || undefined}>
                          <td className="py-1 pr-2 text-gray-200 max-w-[180px] truncate">{r.name || r.code}</td>
                          <td className="py-1 px-2 text-right text-gray-400 whitespace-nowrap tabular-nums">{r.kind === 'add' || r.kind === 'bad' ? '-' : qtyAmt(r.before)}</td>
                          <td className="py-1 px-2 text-right text-gray-200 whitespace-nowrap tabular-nums">{r.kind === 'bad' ? '-' : qtyAmt(r.after)}</td>
                          <td className={`py-1 pl-2 text-right whitespace-nowrap font-semibold ${KIND_LABEL[r.kind].c}`}>{KIND_LABEL[r.kind].t}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {rows.some(r => r.note && (r.kind === 'add' || r.kind === 'bad' || r.kind === 'keep' || r.kind === 'cut')) && (
                <ul className="text-[11.5px] text-gray-400 list-disc pl-4 space-y-0.5">
                  {c.add > 0 && <li>새로 추가한 종목은 <b className="text-gray-200">다른 계좌에 같은 이름의 종목이 있으면 그 코드를, 없으면 이름으로 찾아 넣고 현재가를 불러옵니다</b>(몇 초) — 찾지 못한 종목은 표의 코드 칸이 노란색이니 6자리 코드를 넣어 주세요.</li>}
                  {c.keep > 0 && (run.ocr
                    ? <li>프로그램 읽기는 <b className="text-gray-200">사진에 안 보인 종목을 0으로 하지 않습니다</b>(한 줄을 놓쳤을 수 있어서) — 판 종목이면 표에서 직접 0으로 하거나 아래 AI로 읽어 주세요.</li>
                    : <li>맨 아래 종목이 잘린 사진이라 <b className="text-gray-200">사진에 안 보인 종목은 0으로 하지 않았습니다</b> — 목록 끝까지 찍은 사진을 함께 올리면 판 종목도 0으로 맞춥니다.</li>)}
                  {c.bad > 0 && <li>숫자가 잘렸거나 읽지 못한 새 종목은 넣지 않았습니다 — 그 종목이 다 보이게 한 장 더 찍어 함께 올려 주세요.</li>}
                </ul>
              )}
              {run.parsed && run.parsed.skipped.length > 0 && (
                <details className="text-[11.5px] text-gray-500">
                  <summary className="cursor-pointer">읽지 못한 줄 {run.parsed.skipped.length}개 (그 종목은 바꾸지도 0으로 하지도 않음)</summary>
                  <ul className="mt-1 space-y-0.5">{run.parsed.skipped.map((s, i) => <li key={i} className="break-all">· {s.line} — <span className="text-amber-300/80">{s.reason}</span></li>)}</ul>
                </details>
              )}
              {run.ocr && run.ocr.bad.length > 0 && (
                <div className="text-[11.5px] text-amber-200">
                  <p className="font-semibold">확인 필요 {run.ocr.bad.length}종목 — 바꾸지 않고 그대로 두었습니다:</p>
                  <ul className="list-disc pl-4">{run.ocr.bad.map((h, i) => <li key={i}>{h.name} — {h.flags.filter(f => f !== 'noname').map(f => OCR_FLAG_TEXT[f]).join(' · ')}</li>)}</ul>
                </div>
              )}
              {run.ocr && run.ocr.unknown > 0 && <p className="text-[11.5px] text-amber-300/90">잔고 표를 찾지 못한 사진 {run.ocr.unknown}장은 건너뛰었습니다.</p>}
              {run.model && <p className="text-[10.5px] text-gray-600">읽은 AI: {run.model}</p>}
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
