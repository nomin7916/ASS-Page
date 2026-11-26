// @ts-nocheck
// 자산 평가액 추이 「📷 주문내역 사진으로 매매 넣기」(사용자 요청 2026-11-26) — 증권사 주문·체결내역 사진을 올리면 체결된 매매마다
// 그날의 보유수량·투자금액을 바꾸고 그 뒤 기록과 계좌 표까지 맞춘다(자산검증 「매매 반영」과 같은 함수 — src/tradePhoto.ts → backdatedTrade).
// 사진 고르기 → 기기에서 줄이기 → /api/holdings-photo(kind 'trades', 구글 Gemini) → 끝까지 받은 답({d:1})만 → 바로 넣기 + [되돌리기].
// 키: 사진으로 보유 맞추기와 같다(관리자 = 사이트 키 · 다른 사용자 = 내 Gemini 키 — App의 keyApi가 내 Drive ai_settings.json에서 읽고 쓴다).
// ⚠️ 사진은 저장하지 않는다(메모리에서 줄여 보내기만). ⚠️ 쓰기는 patchAccount(앱 탭이 최신 계좌 위에서 다시 계산)로만.
import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, RotateCcw, Lock, ExternalLink, BookOpen, Copy, ClipboardPaste, Bot, Monitor } from 'lucide-react';
import { formatNumber, formatShortDate } from '../utils';
import { getTodayKST } from '../hooks/useMarketCalendar';
import { mergePastePhotos, photoShareData, PASTE_PHOTO_MAX, PASTE_PHOTO_ACCEPT, photoBudget, photoReadInit, photoReadStep } from '../taxCalcPaste';
import { syncCandidates, holdErrorText, looksLikeGeminiKey, maskKey } from '../holdingsPhoto';
import { parseTradeText, groupTrades, runTradePhoto, tradePhotoUndo, undoTradePhoto, tradeAskPrompt, TRADE_STATUS_TEXT, PHOTO_AI_IDS } from '../tradePhoto';
import { aiHandById } from '../aiProviders';
import { pcOnline, pcSeenText, pcWaitText, pcAskErrorText, pcTooLate, pcModelLabel, pcPhotoAddendum, PC_POLL_FAST, PC_POLL_SLOW, PC_FAST_FOR, PC_PHOTO_N, PC_PHOTO_CHARS } from '../pcAsk';
import { shrinkPhotoToB64 } from '../photoShrink';
import AiApiGuide, { AI_KEY_PAGE } from './AiApiGuide';

const SHARE_NOTE = {
  sent: '보냈습니다 — AI 답의 「매매 | …」 줄을 복사해 아래 칸에 붙여 넣어 주세요.',
  bare: '사진만 보냈습니다 — 부탁 글은 복사해 두었으니 AI 앱 입력 칸에 붙여 넣어 보내 주세요.',
  nosupport: '이 기기에서는 공유 창을 열 수 없습니다 — 위 AI를 열어 사진을 올려 주세요(부탁 글은 복사해 두었습니다).',
  cancel: '보내기를 취소했습니다.',
  fail: '공유 창을 열지 못했습니다 — 위 AI를 열어 사진을 올려 주세요.',
};
const canShareFiles = (() => { try { return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'; } catch { return false; } })();
const fmtQty = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });

export default function TradePhotoSync({ open, onClose, account = null, isAdmin = false, viewingAs = false, keyApi = null, patchAccount }) {
  const [run, setRun] = useState({ phase: 'idle' });
  const [cashOn, setCashOn] = useState(false);
  const [keyState, setKeyState] = useState({ loaded: false, key: '', canSave: false, error: '' });
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [pickNote, setPickNote] = useState('');
  const [keyEdit, setKeyEdit] = useState(false);
  // 구독 AI로 읽기(API 키 없이) — 사진을 Gemini·Claude 앱에 직접 올리고 답 줄을 붙여 넣는다.
  const [showSub, setShowSub] = useState(!isAdmin);
  const [sharePhotos, setSharePhotos] = useState([]);
  const [shareNote, setShareNote] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [subNote, setSubNote] = useState('');
  // 내 PC의 Claude로 읽기(키 없이) — AI 검색 「PC 자동」과 같은 우편함(/api/pc-ask). 사진은 PC의 Claude가 직접 읽는다.
  const [pcState, setPcState] = useState({ loaded: false, linked: false, seen: 0 });
  const [pcJob, setPcJob] = useState(null);   // { id, at(ISO), atMs, n, cash, st, ta }
  const [pcBusy, setPcBusy] = useState(false);
  const [pcMsg, setPcMsg] = useState('');
  const [addNote, setAddNote] = useState('');
  const runId = useRef(0);
  const abortRef = useRef(null);
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (!keyApi || viewingAs) { setKeyState({ loaded: true, key: '', canSave: false, error: '' }); return; }
    keyApi.load().then((r) => { if (alive) setKeyState({ loaded: true, key: r?.key || '', canSave: !!r?.canSave, error: r?.error || '' }); })
      .catch((e) => { if (alive) setKeyState({ loaded: true, key: '', canSave: false, error: String(e?.message || e) }); });
    return () => { alive = false; };
  }, [open, keyApi, viewingAs]);

  useEffect(() => () => { runId.current += 1; if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } } }, []);

  // PC 연결 상태 — 관리자 접속(impersonation) 중엔 안 본다(우편함은 로그인한 본인 것).
  useEffect(() => {
    if (!open || viewingAs || !isAdmin) return;
    let alive = true;
    fetch('/api/pc-ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'status' }) })
      .then(r => r.json().catch(() => ({})).then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (alive) setPcState({ loaded: true, linked: ok && !!j.linked, seen: Number(j.seen) || 0 }); })
      .catch(() => { if (alive) setPcState({ loaded: true, linked: false, seen: 0 }); });
    return () => { alive = false; };
  }, [open, viewingAs, isAdmin]);

  // PC에 맡긴 사진 — 답이 오면 같은 넣기(applyText)로. 창을 닫아 두면 다시 열 때 이어서 기다린다.
  useEffect(() => {
    if (!open || !pcJob) return;
    let alive = true;
    let timer = null;
    const job0 = pcJob;
    const tick = async () => {
      try {
        const r = await fetch('/api/pc-ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'get', ids: [job0.id] }) });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (j.seen) setPcState(s => ({ ...s, seen: Number(j.seen) || s.seen }));
        const got = Array.isArray(j.jobs) ? j.jobs[0] : null;
        if (got && got.st === 'done') {
          setPcJob(null);
          const text = String(got.a || '');
          applyText(text, job0.n, pcModelLabel('Claude', got.m || 'Claude'), job0.cash);
          if (!/^\s*[|*>`-]*\s*매매\s*\|/m.test(text) && /사진\s*없음/.test(text)) setPcMsg('PC의 Claude가 사진을 열지 못했습니다 — 아래 「맥의 Claude 대화에 붙여 넣을 규칙」을 넣어 주세요.');
          return;
        }
        if (got && (got.st === 'fail' || got.st === 'cancel' || got.st === 'gone')) {
          setPcJob(null);
          setPcMsg(got.st === 'fail' ? `PC가 읽지 못했습니다 — ${got.e || '까닭 없음'}` : got.st === 'cancel' ? '취소했습니다' : 'PC 우편함에서 사라졌습니다(2일이 지났거나 지워짐)');
          return;
        }
        if (got) setPcJob(p => (p && p.id === got.id ? { ...p, st: got.st, ta: got.ta } : p));
        if (pcTooLate(job0.at)) { setPcJob(null); setPcMsg(pcAskErrorText('late')); return; }
      } catch { /* 다음 차례에 다시 */ }
      if (alive) timer = setTimeout(tick, Date.now() - job0.atMs < PC_FAST_FOR ? PC_POLL_FAST : PC_POLL_SLOW);
    };
    timer = setTimeout(tick, PC_POLL_FAST);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [open, pcJob && pcJob.id]);

  if (!open) return null;

  const accountName = account?.name || '';
  const accountType = account?.accountType || 'portfolio';
  const isUsd = accountType === 'overseas';
  const money = (n) => (isUsd
    ? `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${formatNumber(Math.round(Number(n) || 0))}원`);

  const close = () => {
    runId.current += 1;
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } abortRef.current = null; }
    setRun({ phase: 'idle' });
    setPickNote('');
    setShowGuide(false);
    onClose && onClose();
  };

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

  // ⚠️ 답을 끝까지 받은({d:1}) 때만 넣는다 — 끊긴 글로 넣으면 뒤쪽 매매가 빠진 채 계좌 표가 바뀐다.
  const readAndApply = async (files) => {
    const id = ++runId.current;
    const live = () => runId.current === id;
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } }
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = ac;
    const n = files.length;
    const cash = cashOn;
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
        body: JSON.stringify({ kind: 'trades', account: accountName, cands: syncCandidates(accountRef.current?.portfolio || []), images }),
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
    applyText(st.text, n, st.model, cash);
  };

  // 읽은 글(사이트 AI의 답 · 구독 AI 답 붙여넣기) → 해석 → 넣기. 두 길이 같은 함수를 지난다.
  const applyText = (text, n, model, cash) => {
    const today = getTodayKST();
    const parsed = parseTradeText(String(text || '').trim(), today);
    const groups = groupTrades(parsed.rows);
    const acct = accountRef.current;
    const out = acct ? runTradePhoto(acct, groups, { accountType: acct.accountType, cashOn: cash, today }) : null;
    let undo = null;
    if (out && out.applied > 0 && patchAccount) {
      undo = tradePhotoUndo(acct);
      patchAccount(p => runTradePhoto(p, groups, { accountType: p.accountType, cashOn: cash, today }).next);
    }
    setRun({ phase: 'done', n, parsed, out, undo, model });
  };

  const sendToPc = async (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    const { add, notImage, over } = mergePastePhotos([], list);
    const files = add.slice(0, PC_PHOTO_N);
    const cut = over + Math.max(0, add.length - PC_PHOTO_N);
    setPickNote([
      notImage > 0 ? `사진이 아닌 파일 ${notImage}개는 뺐습니다` : '',
      cut > 0 ? `PC로는 한 번에 ${PC_PHOTO_N}장까지라 ${cut}장은 뺐습니다` : '',
    ].filter(Boolean).join(' · '));
    if (files.length === 0 || pcBusy || pcJob) return;
    setPcMsg('');
    setPcBusy(true);
    try {
      const budget = Math.min(photoBudget(files.length), PC_PHOTO_CHARS);
      const imgs = [];
      for (const f of files) imgs.push({ mime: 'image/jpeg', data: await shrinkPhotoToB64(f, budget) });
      const prompt = `${subPrompt()}\n\n(사진 ${imgs.length}장이 함께 왔습니다 — 사진을 열지 못했으면 아무 줄도 지어내지 말고 '사진 없음' 한 줄만 쓰세요.)`;
      const r = await fetch('/api/pc-ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'ask', target: 'claude', prompt, imgs }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) { setPcMsg(j.code && j.code !== 'bad' ? pcAskErrorText(j.code) : (j.error || `보내지 못했습니다 (HTTP ${r.status})`)); return; }
      setPcJob({ id: j.id, at: new Date().toISOString(), atMs: Date.now(), n: imgs.length, cash: cashOn, st: 'wait' });
    } catch (err) {
      setPcMsg(err && err.message === 'big' ? '사진이 너무 커서 줄이지 못했습니다' : '사진을 보내지 못했습니다(연결을 확인해 주세요)');
    } finally { setPcBusy(false); }
  };
  const cancelPc = async () => {
    const id = pcJob && pcJob.id;
    setPcJob(null);
    setPcMsg('취소했습니다');
    if (id) { try { await fetch('/api/pc-ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'cancel', id }) }); } catch { /* 무시 */ } }
  };
  const copyAddendum = async () => {
    try { await navigator.clipboard.writeText(pcPhotoAddendum(window.location.origin)); setAddNote('copied'); }
    catch { setAddNote('manual'); }
  };

  // 휴대폰 — 고른 사진 + 부탁 글을 기기의 공유 창으로 AI 앱에 보낸다.
  // ⚠️ navigator.share 는 누른 바로 그 순간에만 열린다(아이폰 사파리) — await 보다 먼저 부른다(KrEtfTaxMatrix와 같은 규약).
  const pickForShare = (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    setSharePhotos(mergePastePhotos([], list).add);
    setShareNote('');
  };
  const shareToAi = async () => {
    const prompt = subPrompt();
    const share = photoShareData(navigator, sharePhotos, prompt);
    let sharing = null;
    if (share) { try { sharing = navigator.share(share.data); } catch (err) { sharing = Promise.reject(err); } }
    const copying = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(prompt).then(() => true, () => false)
      : Promise.resolve(false);
    if (!sharing) { await copying; setShareNote('nosupport'); return; }
    let note = share.withText ? 'sent' : 'bare';
    try { await sharing; } catch (err) { note = err && err.name === 'AbortError' ? 'cancel' : 'fail'; }
    if (await copying) setSubNote('copied');
    setShareNote(note);
  };

  const subPrompt = () => tradeAskPrompt({ cands: syncCandidates(accountRef.current?.portfolio || []), today: getTodayKST() });
  const copySubPrompt = async () => {
    try { await navigator.clipboard.writeText(subPrompt()); setSubNote('copied'); }
    catch { setSubNote('manual'); }
  };
  const pasteFromClipboard = async () => {
    try {
      const t = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : null;
      if (t == null) throw new Error('unsupported');
      setPasteText(String(t));
      setSubNote(String(t).trim() ? '' : 'empty');
    } catch { setSubNote('nopaste'); }
  };
  const applyPasted = () => {
    if (busy) return;
    runId.current += 1;
    applyText(pasteText, 0, '내 구독 AI(붙여넣기)', cashOn);
  };

  const undoApply = () => {
    const u = run.undo;
    if (!u || !patchAccount) return;
    patchAccount(p => undoTradePhoto(p, u));
    setRun(r => ({ ...r, phase: 'undone', undo: null }));
  };

  const out = run.out;
  const results = out ? out.results : [];
  const skippedN = results.filter(r => r.status !== 'ok').length;

  const subSection = (
          <div className="rounded-lg border border-violet-700/40 bg-gray-900/40">
            <button onClick={() => setShowSub(v => !v)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
              <span className="flex items-center gap-1.5 text-gray-200 font-semibold"><Bot size={14} className="text-violet-300" />내 AI로 읽기 <span className="font-normal text-gray-500">— API 키 없이 · 각자 쓰는 AI 앱(무료 가능)</span></span>
              <span className="text-gray-500 text-[11px]">{showSub ? '▲' : '▼'}</span>
            </button>
            {showSub && (
              <div className="px-3 pb-3 space-y-2 border-t border-gray-800">
                <ol className="list-decimal pl-5 space-y-1.5 pt-2 text-[12px] text-gray-300">
                  <li>
                    <button onClick={copySubPrompt} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-700/70 hover:bg-violet-600/70 text-white font-bold text-[11.5px]"><Copy size={11} />부탁 글 복사</button>
                    {' '}를 누릅니다.{subNote === 'copied' && <span className="text-emerald-300"> ✓ 복사했습니다</span>}
                  </li>
                  <li>
                    쓰시는 AI를 엽니다 → 주문내역 <b className="text-gray-100">사진을 올리고</b>, 복사한 글을 붙여 넣어 보냅니다.
                    <span className="flex flex-wrap gap-1.5 mt-1">
                      {PHOTO_AI_IDS.map(id => { const h = aiHandById(id); return h ? (
                        <a key={id} href={h.open} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800 text-[11.5px]">{h.label} <ExternalLink size={10} /></a>
                      ) : null; })}
                    </span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">모두 무료 계정으로 사진을 올릴 수 있습니다(하루 횟수 제한은 회사마다 다릅니다) · 유료 구독이 있으면 그 계정 그대로 씁니다.</span>
                    {canShareFiles && (
                      <span className="block mt-1.5">
                        <span className="text-gray-400">휴대폰: </span>
                        <label className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800 text-[11.5px] cursor-pointer">
                          <Camera size={11} />{sharePhotos.length ? `사진 ${sharePhotos.length}장 고름` : '사진 고르기'}
                          <input type="file" accept={PASTE_PHOTO_ACCEPT} multiple onChange={pickForShare} className="sr-only" />
                        </label>
                        {' '}
                        <button disabled={sharePhotos.length === 0} onClick={shareToAi} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-700/70 hover:bg-violet-600/70 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold text-[11.5px]">AI 앱으로 보내기</button>
                        {shareNote && <span className="block text-[11px] text-amber-300/90 mt-0.5">{SHARE_NOTE[shareNote] || ''}</span>}
                      </span>
                    )}
                  </li>
                  <li>AI 답의 <b className="text-gray-100">「매매 | …」 줄</b>을 복사해 아래 칸에 붙여 넣고 「넣기」를 누릅니다.</li>
                </ol>
                {subNote === 'manual' && (
                  <textarea readOnly value={subPrompt()} rows={5} onFocus={e => e.target.select()} className="w-full bg-[#0b1120] border border-gray-700 rounded-md px-2 py-1.5 text-[11px] text-gray-300 font-mono" />
                )}
                {subNote === 'manual' && <p className="text-[11px] text-amber-300/90">복사가 막혀 있습니다 — 위 글을 길게 눌러(또는 Ctrl+C) 복사해 주세요.</p>}
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4} placeholder={'매매 | 2026-11-17 | 0177R0 | 종목명 | 매수 | 30 | 7,090\n…'}
                  className="w-full bg-[#0b1120] border border-gray-600 focus:border-violet-500 rounded-md px-2 py-1.5 text-[12px] text-gray-100 font-mono outline-none" />
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={pasteFromClipboard} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-gray-600 text-gray-300 hover:bg-gray-800 text-[12px]"><ClipboardPaste size={12} />클립보드에서 붙여넣기</button>
                  <button disabled={busy || !pasteText.trim()} onClick={applyPasted} className="px-3 py-1 rounded-md bg-violet-700 hover:bg-violet-600 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold text-[12px]">넣기</button>
                  {subNote === 'empty' && <span className="text-[11px] text-amber-300/90">클립보드가 비어 있습니다</span>}
                  {subNote === 'nopaste' && <span className="text-[11px] text-amber-300/90">칸을 길게 눌러(또는 Ctrl+V) 붙여 넣어 주세요</span>}
                </div>
                <p className="text-[11px] text-gray-500">사이트는 구독 계정에 접속하지 않습니다 — 사진은 직접 쓰시는 AI 앱에만 올라가고, 여기엔 답 글만 붙여 넣습니다.</p>
              </div>
            )}
          </div>
  );

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 px-3" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      <div className="relative w-full max-w-[680px] max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-sky-700/50 bg-[#0f1623] shadow-2xl">
        {showGuide ? (
          <AiApiGuide inline onClose={() => setShowGuide(false)} />
        ) : (<>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Camera size={16} className="text-sky-300 shrink-0" />
            <span className="text-gray-100 font-semibold text-sm truncate">주문내역 사진으로 매매 넣기{accountName ? ` — ${accountName}` : ''}</span>
          </div>
          <button onClick={close} title="닫기" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-[12.5px] text-gray-300 leading-relaxed">
          <div className="space-y-1">
            <p>증권사 앱의 <b className="text-gray-100">주문내역(체결내역) 화면</b>을 캡처해 올리면, 체결된 매매마다 <b className="text-blue-200">그날의 보유수량·투자금액</b>을 바꾸고 그 뒤 날짜와 <b className="text-blue-200">계좌 표</b>까지 맞춥니다.</p>
            <p className="text-gray-400">매수 = 투자금액 + 체결수량 × 평균체결가 · 매도 = 평균단가 그대로 판 수량만큼 원가를 뺍니다. 같은 날 여러 번 체결한 것은 합칩니다. 이미 넣은 매매는 건너뜁니다.</p>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={cashOn} disabled={busy} onChange={e => setCashOn(e.target.checked)} />
            <span>
              <span className="text-gray-200">매매 대금을 예수금에도 반영 (매수 −, 매도 +)</span>
              <span className="block text-[11px] text-gray-500">예수금을 증권사 잔고로 따로 맞춰 두셨다면 체크하지 마세요.</span>
            </span>
          </label>

          {!isAdmin && subSection}

          {viewingAs ? (
            <p className="text-[11.5px] text-emerald-300/90">관리자 접속 중 — 사이트 키로 읽습니다(사용자의 키는 읽거나 저장하지 않습니다).</p>
          ) : (
            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-gray-200 font-semibold"><Lock size={13} className="text-amber-300" />내 Gemini API 키</span>
                <button onClick={() => setShowGuide(true)} className="flex items-center gap-1 text-[11.5px] text-amber-200 hover:text-amber-100 underline-offset-2 hover:underline"><BookOpen size={12} />키 받는 법(그림)</button>
              </div>
              {isAdmin ? <p className="text-[11.5px] text-emerald-300/90">관리자 — 내 키가 있으면 먼저 쓰고, 없으면 사이트 키로 읽습니다.</p>
                : <p className="text-[11.5px] text-gray-400">선택 — 구글 계정으로 무료 키를 만들어 넣으면, 위 붙여넣기 없이 사진만 고르면 바로 읽습니다.</p>}
              {!keyState.loaded ? (
                <p className="text-gray-500">키를 확인하는 중…</p>
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
                  {!keyState.canSave && <p className="text-[11px] text-amber-300/90">{keyState.error || 'Drive에 연결된 뒤 저장할 수 있습니다'}</p>}
                </div>
              )}
              {keyMsg && <p className="text-[11.5px] text-sky-200">{keyMsg}</p>}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <label className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold text-[13px] transition ${busy || needKey ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-sky-700 hover:bg-sky-600 text-white cursor-pointer'}`}
              title={needKey ? '먼저 내 Gemini API 키를 넣어 주세요' : '주문내역 사진을 고르면 바로 넣습니다'}>
              <Camera size={14} />{busy ? '읽는 중…' : '주문내역 사진 고르기'}
              <input type="file" accept={PASTE_PHOTO_ACCEPT} multiple disabled={busy || needKey} onChange={pickPhotos} className="sr-only" />
            </label>
            <span className="text-[11px] text-gray-500">한 번에 {PASTE_PHOTO_MAX}장까지 · 사진은 저장하지 않습니다</span>
          </div>
          {pickNote && <p className="text-[11.5px] text-amber-300/90">{pickNote}</p>}

          {isAdmin && !viewingAs && (
            <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/20 px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-gray-200 font-semibold"><Monitor size={14} className="text-emerald-300" />내 PC의 Claude로 읽기 <span className="font-normal text-gray-500">— 키 없이 · 구독으로 자동</span></span>
                {pcState.loaded && pcState.linked && <span className={`text-[11px] ${pcOnline(pcState.seen) ? 'text-emerald-300' : 'text-amber-300'}`}>{pcSeenText(pcState.seen)}</span>}
              </div>
              {!pcState.loaded ? (
                <p className="text-gray-500">PC 연결을 확인하는 중…</p>
              ) : !pcState.linked ? (
                <p className="text-[11.5px] text-gray-400">PC가 아직 연결되지 않았습니다 — 위쪽 말풍선(AI 검색) 창의 ⚙ 설정 「내 PC로 자동 묻기」에서 PC 연결 문구를 만들어 PC의 Claude 대화에 붙여 넣으면, 여기서 사진만 고르면 PC의 Claude(구독)가 읽어 넣습니다.</p>
              ) : pcJob ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-emerald-200 animate-pulse">{pcWaitText('Claude', pcJob, pcState.seen)}</p>
                  <button onClick={cancelPc} className="px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 text-[11.5px]">취소</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-[12.5px] transition ${pcBusy ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-emerald-700 hover:bg-emerald-600 text-white cursor-pointer'}`}
                    title="주문내역 사진을 고르면 내 PC의 Claude가 읽어 바로 넣습니다">
                    <Monitor size={13} />{pcBusy ? '보내는 중…' : '내 PC로 사진 보내기'}
                    <input type="file" accept={PASTE_PHOTO_ACCEPT} multiple disabled={pcBusy} onChange={sendToPc} className="sr-only" />
                  </label>
                  <span className="text-[11px] text-gray-500">한 번에 {PC_PHOTO_N}장까지 · 읽으면 사진은 우편함에서 바로 지웁니다</span>
                </div>
              )}
              {pcMsg && <p className="text-[11.5px] text-amber-300/90">{pcMsg}</p>}
              {pcState.linked && (
                <details className="text-[11.5px] text-gray-400">
                  <summary className="cursor-pointer">맥의 Claude가 사진을 못 읽으면 — 대화에 붙여 넣을 규칙(이 기능 전에 연결한 경우 한 번)</summary>
                  <div className="mt-1 space-y-1">
                    <p>PC의 Claude 대화(PC 연결 문구를 붙여 넣은 그 대화)에 아래 글을 한 번 붙여 넣어 보내 주세요. 열쇠는 그 대화가 이미 알고 있습니다.</p>
                    <button onClick={copyAddendum} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-800/70 hover:bg-emerald-700/70 text-white font-bold text-[11.5px]"><Copy size={11} />규칙 글 복사</button>
                    {addNote === 'copied' && <span className="text-emerald-300"> ✓ 복사했습니다</span>}
                    {addNote === 'manual' && <textarea readOnly value={pcPhotoAddendum(window.location.origin)} rows={5} onFocus={e => e.target.select()} className="w-full bg-[#0b1120] border border-gray-700 rounded-md px-2 py-1.5 text-[11px] text-gray-300 font-mono" />}
                  </div>
                </details>
              )}
            </div>
          )}

          {isAdmin && subSection}

          {run.phase === 'shrink' && <p className="text-sky-200">사진 {run.n}장을 줄이는 중…</p>}
          {run.phase === 'read' && <p className="text-sky-200 animate-pulse">AI가 사진 {run.n}장을 읽는 중…{run.got > 0 ? ` (${run.got}자 받음)` : ''}</p>}
          {run.phase === 'error' && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 space-y-1">
              <p className="text-red-200">{holdErrorText(run.code)}</p>
              {run.msg && <p className="text-[11px] text-red-300/70 break-all">{run.msg}</p>}
              {['needkey', 'nokey', 'badkey', 'credit', 'quota0', 'rate', 'rate1m'].includes(run.code) && !viewingAs && (
                <div className="flex items-center gap-3 flex-wrap pt-0.5">
                  <button onClick={() => setShowGuide(true)} className="text-[11.5px] text-amber-200 underline">무료 Gemini 키 받는 법 보기</button>
                  <button onClick={() => setShowSub(true)} className="text-[11.5px] text-sky-200 underline">키 없이 구독 AI(Gemini·Claude 앱)로 읽기</button>
                </div>
              )}
            </div>
          )}

          {(run.phase === 'done' || run.phase === 'undone') && out && (
            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-2">
              {results.length === 0 ? (
                <p className="text-amber-200">사진에서 체결된 매매를 찾지 못했습니다 — 주문내역(체결내역) 화면이 보이게 다시 찍어 주세요.</p>
              ) : out.applied > 0 ? (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className={run.phase === 'undone' ? 'text-gray-400' : 'text-emerald-300 font-semibold'}>
                    {run.phase === 'undone' ? '되돌렸습니다 — 넣기 전으로 돌아갔습니다.' : `넣었습니다 — 매매 ${out.applied}건${skippedN ? ` · 건너뜀 ${skippedN}건` : ''}`}
                  </p>
                  {run.phase === 'done' && run.undo && (
                    <button onClick={undoApply} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-100 text-[12px] font-bold"><RotateCcw size={12} />되돌리기</button>
                  )}
                </div>
              ) : (
                <p className="text-gray-300">넣을 매매가 없습니다 — 아래 까닭을 확인해 주세요.</p>
              )}
              {results.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] min-w-[440px]">
                    <thead><tr className="text-gray-500 border-b border-gray-700/60">
                      <th className="text-left py-1 pr-2 font-normal">날짜</th><th className="text-left py-1 px-2 font-normal">종목</th>
                      <th className="text-right py-1 px-2 font-normal">매매</th><th className="text-right py-1 px-2 font-normal">체결가</th>
                      <th className="text-right py-1 px-2 font-normal">그날 보유</th><th className="text-right py-1 pl-2 font-normal">처리</th>
                    </tr></thead>
                    <tbody>
                      {results.map((r, i) => (
                        <tr key={`${r.date}-${r.k}-${r.side}-${i}`} className="border-b border-gray-800/60 align-top" title={r.fills > 1 ? `체결 ${r.fills}번을 합침` : undefined}>
                          <td className="py-1 pr-2 text-gray-300 whitespace-nowrap">{r.date ? formatShortDate(r.date) : (r.rawDate || '-')}</td>
                          <td className="py-1 px-2 text-gray-200 max-w-[96px] sm:max-w-[170px] truncate">{r.itemName || r.name || r.code}</td>
                          <td className={`py-1 px-2 text-right whitespace-nowrap font-semibold ${r.side === 'buy' ? 'text-red-300' : 'text-blue-300'}`}>{r.side === 'buy' ? '매수' : '매도'} {fmtQty(r.qty)}주</td>
                          <td className="py-1 px-2 text-right text-gray-300 whitespace-nowrap tabular-nums">{r.price > 0 ? money(r.price) : '-'}</td>
                          <td className="py-1 px-2 text-right text-gray-300 whitespace-nowrap tabular-nums">{r.status === 'ok' ? `${fmtQty(r.before)} → ${fmtQty(r.after)}` : '-'}</td>
                          <td className={`py-1 pl-2 text-right whitespace-nowrap font-semibold ${r.status === 'ok' ? 'text-emerald-300' : r.status === 'dup' || r.status === 'dayedit' ? 'text-gray-500' : 'text-amber-300'}`}>{TRADE_STATUS_TEXT[r.status] || r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {out.applied > 0 && out.live.length > 0 && (
                <ul className="text-[11.5px] text-gray-300 space-y-0.5">
                  {out.live.map(l => (
                    <li key={l.k}>계좌 표 · <b className="text-gray-100">{l.name}</b>: 수량 {fmtQty(l.qtyBefore)} → <b className="text-gray-100">{fmtQty(l.qtyAfter)}</b>주 · 투자금액 {money(l.costBefore)} → <b className="text-gray-100">{money(l.costAfter)}</b></li>
                  ))}
                  {out.cash && <li>계좌 표 · 예수금: {money(out.cash.before)} → <b className="text-gray-100">{money(out.cash.after)}</b></li>}
                </ul>
              )}
              {out.moved.length > 0 && (
                <p className="text-[11.5px] text-emerald-300/90">{out.moved.join(', ')} — 계좌 표가 이미 매매를 모두 반영한 수량이라, 그 변경을 매매 날짜로 옮겼습니다(표 수량은 그대로, 투자금액만 맞춤).</p>
              )}
              {results.some(r => r.status === 'noitem' || r.status === 'notyet') && (
                <p className="text-[11.5px] text-gray-400">이 계좌에 없던 종목의 매매는 넣지 않았습니다 — 자산 평가액 추이에서 그 날짜를 눌러 「종목 추가」로 먼저 넣은 뒤 사진을 다시 올려 주세요.</p>
              )}
              {run.parsed && run.parsed.skipped.length > 0 && (
                <details className="text-[11.5px] text-gray-500">
                  <summary className="cursor-pointer">읽지 못한 줄 {run.parsed.skipped.length}개</summary>
                  <ul className="mt-1 space-y-0.5">{run.parsed.skipped.map((s, i) => <li key={i} className="break-all">· {s.line} — <span className="text-amber-300/80">{s.reason}</span></li>)}</ul>
                </details>
              )}
              {run.model && <p className="text-[10.5px] text-gray-600">읽은 AI: {run.model}</p>}
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
