// @ts-nocheck
// 계좌 표 「📷 사진으로 보유 맞추기」(사용자 요청 2026-11-26) — 증권사 잔고 화면 사진을 올리면 이 계좌 주식 행의
// 보유수량·투자금액을 맞춘다. 사진 고르기 → 기기에서 줄이기 → /api/holdings-photo(구글 Gemini) → src/holdingsPhoto.ts
// 해석·계획 → 바로 넣기 + [되돌리기]. 사진에 없는 종목 = 0 + 메모(종목명 칸 📝, 마우스 올리면 보임).
// 키: 관리자는 사이트 키(내 키가 있으면 먼저) · 다른 사용자는 내 Gemini 키(내 Drive ai_settings.json — App의 keyApi가 읽고 쓴다).
// ⚠️ 사진은 저장하지 않는다(메모리에서 줄여 보내기만). ⚠️ 쓰기는 applyItems(앱 탭이 최신 prev 위에서 적용)로만.
import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, RotateCcw, Lock, ExternalLink, BookOpen, ScanText, Info } from 'lucide-react';
import { generateId, formatNumber } from '../utils';
import { getTodayKST } from '../hooks/useMarketCalendar';
import { mergePastePhotos, PASTE_PHOTO_MAX, PASTE_PHOTO_ACCEPT, photoBudget, photoReadInit, photoReadStep } from '../taxCalcPaste';
import { syncCandidates, parseHoldingsText, planHoldingsSync, applyHoldingsPlan, undoHoldingsPlan, holdCounts, holdErrorText, looksLikeGeminiKey, maskKey, planCashSync, applyCashPlan, undoCashPlan,
  namesToResolve, photoKey, knownCodeFor, findCodeByName, planUsedIds, pickTargets, applyHoldingPick, mergeHoldUndo, rankCodeSuggestions, mergeCodeSuggestions, acctCodeCands, KR_CODE_RE } from '../holdingsPhoto';
import { searchKrStockCodes, fetchStockInfo } from '../api';
import CodeSuggestList from './CodeSuggestList';
import { shrinkPhotoToB64 } from '../photoShrink';
import AiApiGuide, { AI_KEY_PAGE } from './AiApiGuide';
import { classifyOcr, parseOcrHoldings, ocrHoldLine, ocrHoldBad, OCR_FLAG_TEXT, parseOcrCash } from '../tradeOcr';
import { loadOcrEngine, ocrFile } from '../screenOcr';

const KIND_LABEL = {
  update: { t: '바꿈', c: 'text-sky-300' },
  same: { t: '같음', c: 'text-gray-500' },
  zero: { t: '0으로', c: 'text-amber-300' },
  keep: { t: '그대로', c: 'text-gray-400' },
  add: { t: '새로 추가', c: 'text-emerald-300' },
  cut: { t: '그대로(못 읽음)', c: 'text-gray-400' },
  bad: { t: '넣지 않음', c: 'text-red-300' },
  pick: { t: '골라 주세요', c: 'text-amber-200' },
};
const KIND_ORDER = { update: 0, zero: 1, add: 2, pick: 3, bad: 4, keep: 5, cut: 6, same: 7 };
// fund = 펀드 행(보유수량 없음 — 매입금액·평가금액)
const qtyAmt = (v, usd, fund = false) => (fund
  ? `매입 ${formatNumber(Math.round(v.invest || 0))}원 · 평가 ${formatNumber(Math.round(v.eval || 0))}원`
  : usd
    ? `${formatNumber(v.qty)}주 · $${Number(v.invest || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${formatNumber(v.qty)}주 · ${formatNumber(Math.round(v.invest))}원`);
const hasUndo = (u) => !!u && (Object.keys(u.restore || {}).length > 0 || (u.added || []).length > 0);

// 「골라 주세요」 한 종목 — 이 계좌의 다른 이름 종목에 넣기 · 추천 코드 · 코드 직접 입력 · 코드 없이 추가 · 넣지 않음(사용자 요청 2026-11-27)
function PickCard({ p, targets, extra, onChoose, disabled }) {
  const r = p.row;
  const [sel, setSel] = useState(() => (targets[0] && targets[0].score >= 0.5 ? targets[0].id : ''));
  const [typed, setTyped] = useState('');
  const title = r.photo || r.name;
  const amt = qtyAmt(r.after, false, !!r.fund);
  if (p.status !== 'wait') {
    return (
      <div className="flex items-center justify-between gap-2 flex-wrap rounded-md border border-gray-700/60 bg-gray-900/30 px-2.5 py-1.5 text-[12px]">
        <span className="text-gray-300 truncate max-w-[60%]">{title}</span>
        <span className={p.status === 'skip' ? 'text-gray-500' : 'text-emerald-300 font-semibold'}>{p.status === 'skip' ? '넣지 않음' : `✓ ${p.label}`}</span>
      </div>
    );
  }
  const code = typed.trim().toUpperCase();
  const codeOk = KR_CODE_RE.test(code);
  return (
    <div className="rounded-md border border-gray-700 bg-gray-900/50 px-2.5 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-gray-100 font-semibold">{title}</span>
        <span className="text-gray-300 tabular-nums text-[12px]">{amt}</span>
      </div>
      {targets.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11.5px] text-gray-400 shrink-0">이 계좌 {r.fund ? '펀드' : '종목'}에 넣기</span>
          <select value={sel} onChange={e => setSel(e.target.value)} className="flex-1 min-w-[150px] bg-[#0b1120] border border-gray-600 focus:border-sky-500 rounded px-1.5 py-1 text-[12px] text-gray-100 outline-none">
            <option value="">— 고르기 —</option>
            {targets.map(t => <option key={t.id} value={t.id}>{t.name}{t.code ? ` (${t.code})` : ''}{r.fund ? '' : ` · ${formatNumber(t.qty)}주`}</option>)}
          </select>
          <button type="button" disabled={disabled || !sel} onClick={() => { const t = targets.find(x => x.id === sel); if (t) onChoose({ to: 'item', itemId: t.id }, `이 계좌의 「${t.name}」에 넣었습니다`); }}
            className="px-2.5 py-1 rounded bg-sky-700 hover:bg-sky-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-[12px] font-bold">넣기</button>
        </div>
      )}
      {!r.fund && (
        <>
          <p className="text-[11.5px] text-gray-400">추천 종목코드 — 이름이 비슷한 순, 누르면 그 코드로 새로 넣고 현재가를 불러옵니다</p>
          <CodeSuggestList name={title} extra={extra} disabled={disabled} onPick={s => onChoose({ to: 'code', code: s.code, name: s.name, how: 'pick' }, `${s.name}(${s.code})로 넣었습니다`)} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11.5px] text-gray-400 shrink-0">종목코드 직접 입력</span>
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="예: 069500" maxLength={6} spellCheck={false} autoComplete="off"
              className="w-[92px] bg-[#0b1120] border border-gray-600 focus:border-sky-500 rounded px-1.5 py-1 text-[12px] font-mono text-gray-100 outline-none" />
            <button type="button" disabled={disabled || !codeOk} onClick={() => onChoose({ to: 'code', code, how: 'typed' }, `종목코드 ${code}로 넣었습니다`)}
              className="px-2.5 py-1 rounded bg-sky-700 hover:bg-sky-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-[12px] font-bold">넣기</button>
            {typed && !codeOk && <span className="text-[11px] text-amber-300/90">6자리 코드(예: 069500 · 0091P0)</span>}
          </div>
        </>
      )}
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        <button type="button" disabled={disabled} onClick={() => onChoose({ to: 'new' }, r.fund ? '새 펀드 행으로 넣었습니다' : '코드 없이 넣었습니다 — 표의 노란 코드 칸에서 넣어 주세요')}
          className="px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 text-[11.5px]">{r.fund ? '새 펀드 행으로 추가' : '코드 없이 추가'}</button>
        <button type="button" disabled={disabled} onClick={() => onChoose(null, '')} className="px-2 py-0.5 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:bg-gray-800 text-[11.5px]">넣지 않음</button>
      </div>
    </div>
  );
}

// usd = 해외 계좌(2026-11-26 — 키움 해외잔고 「외화」 화면 사진 → 보유수량·투자금액(USD, investAmountUsd + 매입단가 미러)). 원화 화면은 넣지 않는다(달러 원가를 알 수 없다).
// portfolios = 모든 계좌(다른 계좌의 같은·비슷한 이름에서 종목코드 찾기) · onCodeSet(id, code) = 코드로 넣은 새 행의 현재가 부르기(앱 탭)
// 화면(사용자 요청 2026-11-28 「글을 읽지 않고 감각적으로」): 큰 카메라 칸 하나(누르면 사진 고르기 · PC는 끌어 놓기·붙여넣기도) →
// 프로그램 읽기(OCR). 설명·주의·AI로 읽기(내 키)는 머리줄 ⓘ를 눌렀을 때만(more). initialFiles = 휴대폰 화면 카메라로 이미 고른 사진(열리자마자 읽기).
export default function HoldingsPhotoSync({ open, onClose, accountName = '', items = [], applyItems, isAdmin = false, viewingAs = false, keyApi = null, onOpenCalendarGuide = null, usd = false, portfolios = [], onCodeSet = null, initialFiles = null, onInitialFilesTaken = null }) {
  const [run, setRun] = useState({ phase: 'idle' });
  const [more, setMore] = useState(false);
  const [drag, setDrag] = useState(false);
  const ocrFilesRef = useRef(null);
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
  const portfoliosRef = useRef(portfolios);
  portfoliosRef.current = portfolios;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (!keyApi) { setKeyState({ loaded: true, key: '', canSave: false, error: '' }); return; }
    keyApi.load().then((r) => { if (alive) setKeyState({ loaded: true, key: r?.key || '', canSave: !!r?.canSave, error: r?.error || '' }); })
      .catch((e) => { if (alive) setKeyState({ loaded: true, key: '', canSave: false, error: String(e?.message || e) }); });
    return () => { alive = false; };
  }, [open, keyApi]);

  useEffect(() => () => { runId.current += 1; if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } } }, []);

  // 창이 열린 동안 붙여넣은(Ctrl+V·⌘V) 캡처도 바로 읽는다 — 그림이 없는 붙여넣기(키 칸의 글자)는 건드리지 않는다.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test((f && f.type) || ''));
      if (!files.length || !ocrFilesRef.current) return;
      e.preventDefault();
      ocrFilesRef.current(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open]);

  // 휴대폰 화면 카메라로 고른 사진 — 키 확인이 끝난 뒤(프로그램이 못 읽을 때 AI로 넘길지 정하려고) 한 번만 읽는다.
  useEffect(() => {
    if (!open || !keyState.loaded || !initialFiles || !initialFiles.length) return;
    const list = initialFiles;
    if (onInitialFilesTaken) onInitialFilesTaken();
    if (ocrFilesRef.current) ocrFilesRef.current(list);
  }, [open, keyState.loaded, initialFiles]);

  if (!open) return null;

  const close = () => {
    runId.current += 1;
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } abortRef.current = null; }
    setRun({ phase: 'idle' });
    setPickNote('');
    setShowGuide(false);
    setMore(false);
    setDrag(false);
    onClose && onClose();
  };

  // 관리자 접속(impersonation) 탭은 관리자 토큰으로 부른다 → 서버가 사이트 키로 읽는다(사용자 키는 읽지 않음).
  const needKey = !isAdmin && !viewingAs && !keyState.key;
  const busy = run.phase === 'shrink' || run.phase === 'read' || run.phase === 'resolve';

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
  const readAndApply = async (files, fromOcr = false) => {
    const id = ++runId.current;
    const live = () => runId.current === id;
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } }
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = ac;
    const n = files.length;
    setRun({ phase: 'shrink', n, fromOcr });
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
    setRun({ phase: 'read', n, got: 0, fromOcr });
    let st = photoReadInit();
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (keyState.key) headers['X-Gemini-Key'] = keyState.key;
      const res = await fetch('/api/holdings-photo', {
        method: 'POST',
        headers,
        body: JSON.stringify({ account: accountName || '', cands: syncCandidates(itemsRef.current), images, cur: usd ? 'usd' : '' }),
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

  // 읽은 글(AI 답 · 프로그램 글자 인식) → 해석 → (국내) 이 계좌에서 바로 못 찾은 이름의 종목코드 확인 → 계획 → 바로 넣기 + 「골라 주세요」.
  // ocr = 프로그램 읽기 정보(안 보인 종목을 0으로 하지 않음).
  // 종목코드 확인(사용자 요청 2026-11-27 「기존 종목명을 찾아서」): 다른 계좌의 같은 이름 → 이름 검색 + 공식 이름 확인(findCodeByName).
  //   확인한 코드가 이 계좌에 있으면 그 행에(표의 이름이 사진과 달라도) · 없으면 그 코드로 새 행 · 확인 못 하면 「골라 주세요」(사용자가 고름).
  //   잘린·짧은 이름으로 이은 행도 확인한다 — 코드가 다르면(「KODEX 200TR」 ↔ 「KODEX 200」) 잇지 않는다.
  const applyHoldText = async (text, n, model, ocr) => {
    const myRun = runId.current;
    const live = () => runId.current === myRun;
    const parsed = parseHoldingsText(text);
    const resolved = {};
    if (!usd) {
      const names = namesToResolve(planHoldingsSync(parsed, itemsRef.current, { keepUnseen: !!ocr, pick: true }));
      if (names.length) setRun({ phase: 'resolve', n, i: 0, m: names.length });
      for (let i = 0; i < names.length; i++) {
        const known = knownCodeFor(names[i], portfoliosRef.current);
        let f = known ? { ...known, price: 0, changeRate: 0, from: 'acct' } : null;
        if (!f) { try { f = (await findCodeByName(names[i], { search: searchKrStockCodes, info: fetchStockInfo })).found; } catch { f = null; } }
        if (!live()) return;
        if (f) resolved[photoKey(names[i])] = f;
        setRun(r => (r.phase === 'resolve' ? { ...r, i: i + 1 } : r));
      }
    }
    const plan = planHoldingsSync(parsed, itemsRef.current, usd ? { keepUnseen: !!ocr, usd } : { keepUnseen: !!ocr, resolved, pick: true });
    let undo = null;
    if (plan.outcome === 'apply' && applyItems) {
      const today = getTodayKST();
      const ids = plan.rows.filter(r => r.kind === 'add').map(() => generateId());
      const idGen = () => { let i = 0; return () => ids[i++]; };
      undo = applyHoldingsPlan(itemsRef.current, plan, { newId: idGen(), today, usd }).undo;
      applyItems(prev => applyHoldingsPlan(prev, plan, { newId: idGen(), today, usd }).next);
      if (!usd && onCodeSet) plan.rows.filter(r => r.kind === 'add').forEach((r, i) => { if (r.code) onCodeSet(ids[i], r.code); });
    }
    const cashPlan = ocr && ocr.cashPlan;
    if (cashPlan && !cashPlan.same && applyItems) applyItems(prev => applyCashPlan(prev, cashPlan));
    const picks = plan.rows.filter(r => r.kind === 'pick').map((row, key) => ({ key, row, status: 'wait', label: '', doneId: '' }));
    setRun({ phase: 'done', n, text, plan, parsed, counts: holdCounts(plan), model, undo, ocr, cashPlan, picks });
  };

  // 「골라 주세요」에서 고른 것 넣기 — choice null = 넣지 않음. 되돌리기는 맞추기와 하나로 합친다.
  const choosePick = (key, choice, label) => {
    const p = (run.picks || []).find(x => x.key === key);
    if (!p || p.status !== 'wait') return;
    if (!choice) { setRun(r => ({ ...r, picks: (r.picks || []).map(x => (x.key === key ? { ...x, status: 'skip' } : x)) })); return; }
    if (!applyItems) return;
    const today = getTodayKST();
    const nid = generateId();
    const res = applyHoldingPick(itemsRef.current, p.row, choice, { newId: () => nid, today });
    if (!res.id) return;
    applyItems(prev => applyHoldingPick(prev, p.row, choice, { newId: () => nid, today }).next);
    if (res.code && onCodeSet) onCodeSet(res.id, res.code);
    setRun(r => ({ ...r, undo: mergeHoldUndo(r.undo, res.undo), picks: (r.picks || []).map(x => (x.key === key ? { ...x, status: 'done', label, doneId: res.id } : x)) }));
  };

  // 프로그램 읽기(AI 없이 · 무료 · 사진은 이 기기에서만) — src/screenOcr.ts(학습 사이트의 PP-OCRv5) → src/tradeOcr.ts 잔고 해석.
  // 자체 검사(보유수량×평균단가 ≈ 매입금액)·글자 확신이 어긋난 종목과 잘린 종목은 '그대로', 안 보인 종목도 0으로 하지 않는다.
  const readByOcr = (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    ocrFiles(list);
  };
  const ocrFiles = async (list) => {
    if (busy || run.phase === 'ocr') return;
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
    let cash = null;
    for (let i = 0; i < n; i++) {
      if (!live()) return;
      setRun({ phase: 'ocr', stage: 'read', n, i: i + 1, f: 0 });
      let lines = [];
      try { lines = await ocrFile(add[i], f => { if (live()) setRun(r => (r.phase === 'ocr' && r.stage === 'read' ? { ...r, f } : r)); }); }
      catch { unknown++; continue; }
      if (classifyOcr(lines) === 'holdings') holds.push(...parseOcrHoldings(lines, cands).holds);
      else {
        // 해외 계좌의 예수금 화면(키움 「예수금」) — 예수금 행 달러·원화 칸
        const c = usd ? parseOcrCash(lines) : null;
        if (c && !cash) cash = c;
        else unknown++;
      }
    }
    if (!live()) return;
    // 해외 계좌 = 외화(USD) 화면만 — 원화 화면의 매입금액은 원화라 달러 원가로 쓸 수 없다(키움: 잔고 화면 「원화」 버튼을 눌러 「외화」로 바꿔 찍기)
    let krwShots = 0;
    if (usd) {
      const keep = holds.filter(h => h.cut || h.usd);
      const krwNames = holds.filter(h => !h.cut && !h.usd).map(h => h.ticker || h.code || h.name);
      krwShots = holds.length - keep.length;
      holds.length = 0;
      holds.push(...keep);
      // 숫자가 다 보이는 줄이 모두 원화 = 원화 화면(잘린 줄은 원화·외화를 가릴 수 없다) — 「다른 계좌 사진」이 아니라 원화 화면이라고 알린다(사용자 사진 2026-11-26)
      if (!keep.some(h => !h.cut) && krwShots > 0 && !cash) { setRun({ phase: 'error', n, code: 'ocr', msg: `원화 화면입니다 — 사진 속 종목(${krwNames.join('·')})은 찾았지만 넣지 않았습니다. 원화 매입금액은 환율에 따라 바뀌어 달러 원가로 쓸 수 없습니다 — 키움 해외잔고에서 「원화」 버튼을 눌러 「외화」로 바꾼 화면을 찍어 올려 주세요.` }); return; }
    }
    // 프로그램이 잔고 표를 못 찾았으면 AI(2순위)로 — 쓸 수 있을 때만(관리자 · 내 Gemini 키). 사용자 확정 2026-11-26: 사진은 OCR 1순위 · AI 2순위.
    const cashPlan = planCashSync(cash, itemsRef.current);
    if (holds.length === 0 && cashPlan) {
      if (!cashPlan.same && applyItems) applyItems(prev => applyCashPlan(prev, cashPlan));
      setRun({ phase: 'done', n, plan: null, cashPlan, model: '프로그램 글자 인식(AI 없이)', ocr: { bad: [], unknown, krwShots } });
      return;
    }
    if (holds.length === 0 && !needKey) { readAndApply(add, true); return; }
    if (holds.length === 0) { setRun({ phase: 'error', n, code: 'ocr', msg: '사진에서 잔고(보유종목) 표를 찾지 못했습니다 — 종목명·보유수량·매입금액 머리줄이 보이게 찍어 주세요(또는 아래 AI로 읽기).' }); return; }
    // 겹쳐 찍은 사진의 같은 종목은 한 번만(먼저 읽은 것)
    const seen = new Set();
    const uniq = holds.filter(h => { const k = h.code || h.name; if (seen.has(k)) return false; seen.add(k); return true; });
    applyHoldText(uniq.map(ocrHoldLine).join('\n'), n, '프로그램 글자 인식(AI 없이)', { bad: uniq.filter(ocrHoldBad), unknown, krwShots, cashPlan });
  };
  ocrFilesRef.current = ocrFiles;

  const undoApply = () => {
    const u = run.undo, cp = run.cashPlan && !run.cashPlan.same ? run.cashPlan : null;
    if ((!u && !cp) || !applyItems) return;
    if (u) applyItems(prev => undoHoldingsPlan(prev, u));
    if (cp) applyItems(prev => undoCashPlan(prev, cp));
    setRun(r => ({ ...r, phase: 'undone', undo: null }));
  };

  const rows = run.plan ? [...run.plan.rows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) : [];
  const c = run.counts || {};
  const picks = run.picks || [];
  const picksWait = picks.filter(p => p.status === 'wait').length;
  const usedNow = new Set([...planUsedIds(run.plan || null), ...picks.map(p => p.doneId).filter(Boolean)]);
  const acctCands = picks.length ? acctCodeCands(portfoliosRef.current) : [];
  const extraOf = (row) => mergeCodeSuggestions([rankCodeSuggestions(row.photo || row.name, acctCands, 'acct'), row.found ? [{ code: row.found.code, name: row.found.name, score: 1, exact: true, from: row.found.from === 'acct' ? 'acct' : 'search' }] : []]);
  const summary = run.plan ? [
    c.update ? `바꿈 ${c.update}` : '', c.zero ? `0으로 ${c.zero}` : '', c.add ? `새로 추가 ${c.add}` : '', c.pick ? `골라 주세요 ${c.pick}` : '',
    c.same ? `같음 ${c.same}` : '', c.keep ? `안 보여 그대로 ${c.keep}` : '', c.cut ? `못 읽어 그대로 ${c.cut}` : '', c.bad ? `넣지 않음 ${c.bad}` : '',
  ].filter(Boolean).join(' · ') : '';
  // 큰 카메라 칸 안의 짧은 진행 글(설명 없이)
  const reading = busy || run.phase === 'ocr';
  const pct = (f) => `${Math.round((f || 0) * 100)}%`;
  const boxText = run.phase === 'ocr' ? (run.stage === 'load' ? `준비 중… ${pct(run.f)}` : `읽는 중… ${run.n > 1 ? `${run.i}/${run.n} · ` : ''}${pct(run.f)}`)
    : run.phase === 'resolve' ? `종목 확인 중… ${run.i}/${run.m}`
      : run.phase === 'shrink' || run.phase === 'read' ? 'AI가 읽는 중…' : '';
  const dropFiles = (e) => { e.preventDefault(); setDrag(false); if (!reading) ocrFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || [])); };

  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/70 px-0 sm:px-3" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}
      onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
      {/* 휴대폰(640px 미만)은 아래에서 올라오는 판(휴대폰 화면의 카메라 단추가 연다) — PC는 종전 그대로 가운데 창 */}
      <div className="relative w-full max-w-[640px] max-h-[92vh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-sky-700/50 bg-[#0f1623] shadow-2xl">
        {showGuide ? (
          <AiApiGuide inline onClose={() => setShowGuide(false)} />
        ) : (<>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Camera size={16} className="text-sky-300 shrink-0" />
            <span className="text-gray-100 font-semibold text-sm truncate">사진으로 보유 맞추기{accountName ? ` — ${accountName}` : ''}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setMore(v => !v)} aria-expanded={more} title={more ? '설명 접기' : '설명 · 다른 방법(AI로 읽기)'} aria-label={more ? '설명 접기' : '설명 보기'}
              className={`p-1.5 rounded-full transition ${more ? 'bg-sky-900/60 text-sky-200' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}><Info size={18} /></button>
            <button onClick={close} title="닫기" aria-label="닫기" className="p-1.5 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 text-[12.5px] text-gray-300 leading-relaxed">
          <label
            className={`flex flex-col items-center justify-center gap-2 w-full min-h-[190px] sm:min-h-[210px] rounded-2xl border-2 border-dashed transition select-none ${reading ? 'border-sky-500/60 bg-sky-950/40 cursor-wait' : drag ? 'border-sky-300 bg-sky-900/50 cursor-copy' : 'border-sky-600/60 bg-sky-950/20 hover:border-sky-400 hover:bg-sky-950/40 active:bg-sky-900/40 cursor-pointer'}`}
            title="잔고 캡처를 고르거나 끌어 놓기 · 붙여넣기(Ctrl+V) — 이 기기에서 글자를 읽어 바로 맞춥니다(AI 없이)" aria-label="잔고 사진 고르기(프로그램)"
            onDragOver={(e) => { e.preventDefault(); if (!drag && !reading) setDrag(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}>
            <Camera size={46} strokeWidth={1.6} className={`text-sky-300 ${reading ? 'animate-pulse' : ''}`} />
            {reading && <span className="text-[12.5px] text-sky-200 tabular-nums">{boxText}</span>}
            <input type="file" accept={PASTE_PHOTO_ACCEPT} multiple disabled={reading} onChange={readByOcr} className="sr-only" />
          </label>
          {pickNote && <p className="text-[11.5px] text-amber-300/90">{pickNote}</p>}

          {more && (<>
          <div className="space-y-1">
            <p>증권사 앱의 <b className="text-gray-100">잔고(보유종목) 화면</b>을 캡처해 위 칸을 눌러 고르면(PC는 끌어 놓기·붙여넣기도), 이 계좌 종목의 <b className="text-blue-200">보유수량·투자금액(매입금액)</b>을 사진대로 맞춥니다. 고르는 창에는 방금 찍은 캡처가 맨 앞에 있습니다.</p>
            {usd && <p className="text-amber-200/90">해외 계좌 — 키움 해외잔고에서 「원화」 버튼을 눌러 <b>「외화」</b>로 바꾼 화면(매입금액이 달러)을 찍어 주세요. 원화 화면은 넣지 않습니다(원화 매입금액은 환율에 따라 바뀌어서). 종목은 한글 이름 아래 티커(예: GPIQ)로 맞춥니다.</p>}
            <p className="text-gray-400">목록이 길면 내려 가며 찍은 사진을 <b className="text-gray-200">한 번에 모두</b> 고르세요.</p>
          </div>

          <div className="rounded-lg border border-sky-600/60 bg-sky-950/30 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-gray-100 font-semibold"><ScanText size={15} className="text-sky-300" />프로그램으로 읽기 <span className="font-normal text-gray-400">— AI 없이 · 무료 · 키 필요 없음</span></div>
            <p className="text-[11.5px] text-gray-400">위 칸이 이 방법입니다. 사진은 이 기기 밖으로 나가지 않습니다(처음 한 번 글자 인식 엔진 약 17MB를 받습니다). 자체 검사(보유수량×평균단가 ≈ 매입금액)가 어긋난 종목은 바꾸지 않고, 사진에 안 보인 종목도 0으로 하지 않습니다.</p>
          </div>
          <p className="text-[11.5px] text-gray-500">AI로 읽기 — 프로그램이 못 읽을 때(사진에 없는 종목은 판 것으로 보고 0으로 하고, 종목명 칸에 📝 메모를 남깁니다):</p>

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
              title={needKey ? '먼저 내 Gemini API 키를 넣어 주세요' : '잔고 사진 고르기 — 고르면 AI가 읽어 바로 맞춥니다'} aria-label="잔고 사진 고르기(AI)">
              <Camera size={18} />{busy ? '읽는 중…' : ''}
              <input type="file" accept={PASTE_PHOTO_ACCEPT} multiple disabled={busy || needKey} onChange={pickPhotos} className="sr-only" />
            </label>
            <span className="text-[11px] text-gray-500">한 번에 {PASTE_PHOTO_MAX}장까지 · 사진은 저장하지 않습니다</span>
          </div>
          </>)}

          {run.phase === 'error' && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 space-y-1">
              <p className="text-red-200">{run.code === 'ocr' ? run.msg : holdErrorText(run.code)}</p>
              {run.msg && run.code !== 'ocr' && <p className="text-[11px] text-red-300/70 break-all">{run.msg}</p>}
              {(run.code === 'needkey' || run.code === 'badkey' || run.code === 'credit' || run.code === 'quota0') && <button onClick={() => setShowGuide(true)} className="text-[11.5px] text-amber-200 underline">키 받는 법 보기</button>}
              {run.code === 'ocr' && !more && <button onClick={() => setMore(true)} className="text-[11.5px] text-sky-300 underline">다른 방법(AI로 읽기)</button>}
            </div>
          )}

          {(run.phase === 'done' || run.phase === 'undone') && run.cashPlan && (
            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 flex items-center justify-between gap-2 flex-wrap text-[12px]">
              <p className={run.cashPlan.same ? 'text-gray-300' : run.phase === 'undone' ? 'text-gray-400' : 'text-emerald-300 font-semibold'}>
                {run.cashPlan.same ? '예수금은 이미 사진과 같습니다' : run.phase === 'undone' ? '예수금도 되돌렸습니다' : '예수금을 맞췄습니다'} — 달러 {'$'}{run.cashPlan.after.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · 원화 {formatNumber(Math.round(run.cashPlan.after.krw))}원
                {!run.cashPlan.same && <span className="text-gray-500 font-normal"> (이전 {'$'}{run.cashPlan.before.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {formatNumber(Math.round(run.cashPlan.before.krw))}원)</span>}
              </p>
              {!run.plan && run.phase === 'done' && !run.cashPlan.same && (
                <button onClick={undoApply} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-100 text-[12px] font-bold"><RotateCcw size={12} />되돌리기</button>
              )}
            </div>
          )}
          {(run.phase === 'done' || run.phase === 'undone') && run.plan && (
            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-2">
              {run.plan.outcome === 'none' && <p className="text-amber-200">사진에서 보유 종목 줄을 찾지 못했습니다 — 잔고(보유종목) 화면이 보이게 다시 찍어 주세요.</p>}
              {run.plan.outcome === 'mismatch' && <p className="text-amber-200">사진 속 종목이 이 계좌({accountName || '이 계좌'}) 종목과 하나도 맞지 않아 아무것도 바꾸지 않았습니다 — 다른 계좌의 사진인지 확인해 주세요.{picks.length > 0 ? ' 이 계좌가 맞다면 아래 「골라 주세요」에서 종목마다 넣을 곳을 고를 수 있습니다.' : ''}</p>}
              {run.plan.outcome === 'same' && <p className="text-gray-300">{picks.length > 0 ? '이미 같은 종목은 그대로입니다 — 아래 「골라 주세요」 종목만 남았습니다.' : '바꿀 것이 없습니다 — 사진과 이 계좌가 이미 같습니다.'}</p>}
              {run.plan.outcome !== 'apply' && hasUndo(run.undo) && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className={run.phase === 'undone' ? 'text-gray-400' : 'text-emerald-300 font-semibold'}>{run.phase === 'undone' ? '되돌렸습니다 — 고르기 전으로 돌아갔습니다.' : '고른 종목을 넣었습니다'}</p>
                  {run.phase === 'done' && <button onClick={undoApply} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-100 text-[12px] font-bold"><RotateCcw size={12} />되돌리기</button>}
                </div>
              )}
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
                          <td className="py-1 px-2 text-right text-gray-400 whitespace-nowrap tabular-nums">{r.kind === 'add' || r.kind === 'bad' || r.kind === 'pick' ? '-' : qtyAmt(r.before, usd, r.fund)}</td>
                          <td className="py-1 px-2 text-right text-gray-200 whitespace-nowrap tabular-nums">{r.kind === 'bad' ? '-' : qtyAmt(r.after, usd, r.fund)}</td>
                          <td className={`py-1 pl-2 text-right whitespace-nowrap font-semibold ${KIND_LABEL[r.kind].c}`}>{KIND_LABEL[r.kind].t}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {more && rows.some(r => r.note && (r.kind === 'add' || r.kind === 'bad' || r.kind === 'keep' || r.kind === 'cut')) && (
                <ul className="text-[11.5px] text-gray-400 list-disc pl-4 space-y-0.5">
                  {c.add > 0 && <li>새로 추가한 종목은 <b className="text-gray-200">다른 계좌의 같은 이름 종목 → 이름 검색(공식 이름 확인) 순으로 찾은 종목코드로 넣고 현재가를 불러옵니다</b>(몇 초) — 코드 칸이 노란색인 종목은 6자리 코드를 넣어 주세요.</li>}
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
              {run.ocr && run.ocr.krwShots > 0 && <p className="text-[11.5px] text-amber-300/90">원화 화면 {run.ocr.krwShots}종목은 넣지 않았습니다 — 해외 계좌는 「외화」로 바꿔 찍은 화면의 달러 매입금액으로 맞춥니다.</p>}
              {run.ocr && run.ocr.unknown > 0 && <p className="text-[11.5px] text-amber-300/90">잔고 표를 찾지 못한 사진 {run.ocr.unknown}장은 건너뛰었습니다.</p>}
              {more && run.model && <p className="text-[10.5px] text-gray-600">읽은 AI: {run.model}</p>}
            </div>
          )}
          {run.phase === 'done' && picks.length > 0 && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-950/20 px-3 py-2 space-y-2">
              <p className="text-amber-200 font-semibold">{picksWait > 0 ? `이 계좌에서 찾지 못한 종목 ${picksWait}개 — 넣을 곳을 골라 주세요` : '고르기를 마쳤습니다'}</p>
              {more && picksWait > 0 && <p className="text-[11.5px] text-gray-400">표에 다른 이름으로 있는 종목이면 「이 계좌 {picks.some(p => p.row.fund) && !picks.some(p => !p.row.fund) ? '펀드' : '종목'}에 넣기」에서 고르고, 새로 산 종목이면 추천 종목코드를 누르거나 코드를 직접 넣으세요. 고르기 전에는 넣지 않습니다.</p>}
              {picks.map(p => (
                <PickCard key={p.key} p={p} disabled={!applyItems} targets={pickTargets(p.row, items, usedNow)} extra={p.row.fund ? [] : extraOf(p.row)}
                  onChoose={(choice, label) => choosePick(p.key, choice, label)} />
              ))}
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
