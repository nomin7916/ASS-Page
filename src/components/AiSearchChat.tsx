// @ts-nocheck
// 「AI 검색」 채팅창(사용자 요청 2026-11-26: "각 사용자가 자기 구글 Gemini API로 검색해 채팅창에 자료를 만들고 활용 · 듣기 기능").
// 질문 → /api/ai-search(Gemini + 구글 검색 연결 · 내 키는 X-Gemini-Key 헤더로만) → 답을 받는 대로 그린다(마크다운 → React 요소, innerHTML 금지).
// 대화 = 자료: 내 Drive Index_Data/ai_search_chats.json(App aiSearchStoreApi — saveDriveFile만)에 최근 50개 · 고정·이름 바꾸기·지우기·
// 복사·내려받기(.md) · 이어 묻기(요약·표·쉽게·자세히). 듣기 = 브라우저 말하기(src/hooks/useSpeech.ts, 키·비용 없음).
// ⚠️ 불러오기가 실패하면 저장하지 않는다(빈 목록으로 덮어 지난 대화를 지운다). ⚠️ 관리자 접속 중엔 읽기·저장 안 함(메모리에만).
// ⚠️ 늘 떠 있는 창 — App이 <KeepAfterOpen>으로 감싼다(닫아도 대화·받는 중인 답이 남는다).
// 여러 AI(2026-11-26 — src/aiProviders.ts): ① 채팅창 아래 「AI」 칸 = 내 키로 다른 AI(/api/ai-chat · 키는 X-AI-Key 헤더로만 · Drive ai_settings.json aiKeys)
//   ② 「내 구독으로 묻기」 = 그 AI 사이트를 내 계정으로 열고 질문을 넘긴 뒤(주소 + 복사) 「답 붙여넣기」로 이 대화에 저장(API·키 없음).
// ⚠️ 화면이 부르는 곳은 같은 출처의 /api/ai-search · /api/ai-chat 둘뿐 — AI 회사 주소를 직접 부르지 않는다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2, Pencil, Star, Settings, Lock, BookOpen, ExternalLink, Check, Download, RefreshCw, Maximize2, List, Search } from 'lucide-react';
import { generateId } from '../utils';
import { looksLikeGeminiKey, maskKey } from '../holdingsPhoto';
import {
  searchReadInit, searchReadStep, searchErrorText, requestMessages, mdBlocks, mdInline, normalizeSearchStore, chatTitleFrom,
  chatMatches, chatToMarkdown, chatFileName, searchHoldings, EXAMPLE_ASKS, HOLD_ASK, QUICK_ASKS, SPEECH_RATES,
} from '../aiSearch';
import {
  GEMINI_PICK, AI_PROVIDERS, AI_COST_LABEL, AI_HANDS, HAND_SHARE, aiProviderById, aiPrefsOf, normalizeAiKeys, looksLikeAiKey, aiKeyWarning, maskAiKey,
  cleanModels, pickModel, aiErrorText, handName, handPrompt, handUrl, cleanPaste, pasteIsQuestion, handModelLabel,
} from '../aiProviders';
import { useSpeech } from '../hooks/useSpeech';
import AiApiGuide, { AI_KEY_PAGE } from './AiApiGuide';

// 아이콘 — lucide 0.577.0에 있는지 확인할 수 없는 것은 인라인 SVG(UserInfoBar FlowIcon과 같은 이유).
const Svg = ({ size = 14, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ChatIcon = ({ size = 15 }) => <Svg size={size}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" /><circle cx="11.5" cy="11" r="3" /><path d="m13.7 13.2 2.2 2.2" /></Svg>;
const SpeakerIcon = ({ size = 13 }) => <Svg size={size}><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></Svg>;
const PauseIcon = ({ size = 13 }) => <Svg size={size}><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></Svg>;
const PlayIcon = ({ size = 13 }) => <Svg size={size}><path d="M7 4l13 8-13 8z" /></Svg>;
const StopIcon = ({ size = 13 }) => <Svg size={size}><rect x="5" y="5" width="14" height="14" rx="2" /></Svg>;
const PrevIcon = ({ size = 13 }) => <Svg size={size}><path d="M19 5 9 12l10 7z" /><path d="M5 5v14" /></Svg>;
const NextIcon = ({ size = 13 }) => <Svg size={size}><path d="m5 5 10 7-10 7z" /><path d="M19 5v14" /></Svg>;
const SendIcon = ({ size = 15 }) => <Svg size={size}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></Svg>;
const CopyIcon = ({ size = 13 }) => <Svg size={size}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>;
const MinIcon = ({ size = 15 }) => <Svg size={size}><path d="M5 12h14" /></Svg>;

const btn = 'p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition flex items-center justify-center';
const chip = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white text-[11.5px] transition';
const timeLabel = (iso) => { try { return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; } };
const hostOf = (s) => { const t = String(s?.title || ''); if (t) return t; try { return new URL(s.uri).hostname; } catch { return '출처'; } };
const isCoarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
const canShare = () => { try { return typeof navigator !== 'undefined' && typeof navigator.share === 'function'; } catch { return false; } };
const apiOf = (m) => (typeof m?.via === 'string' && m.via.startsWith('api:') ? aiProviderById(m.via.slice(4)) : null);
const vBtn = 'px-2.5 py-1 rounded-md bg-violet-700 hover:bg-violet-600 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold text-[11.5px] transition';
const handChip = 'shrink-0 px-2 py-0.5 rounded-full border border-violet-700/60 bg-violet-900/20 text-[11.5px] text-violet-100 hover:bg-violet-800/40 disabled:opacity-40 transition';

function Inl({ parts }) {
  return (<>{parts.map((p, i) => {
    if (p.t === 'text') return <React.Fragment key={i}>{p.v}</React.Fragment>;
    if (p.t === 'b') return <b key={i} className="font-semibold text-gray-50"><Inl parts={p.c} /></b>;
    if (p.t === 'i') return <i key={i}>{p.v}</i>;
    if (p.t === 'code') return <code key={i} className="px-1 rounded bg-gray-800 text-amber-200 text-[0.92em]">{p.v}</code>;
    return <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline break-all">{p.v}</a>;
  })}</>);
}
const InlineText = ({ text }) => <Inl parts={mdInline(text)} />;

function MdView({ text }) {
  const blocks = useMemo(() => mdBlocks(text), [text]);
  return (
    <div className="space-y-1.5 break-words">
      {blocks.map((b, i) => {
        if (b.t === 'h') return <div key={i} className={b.level <= 2 ? 'pt-1 text-[14px] font-bold text-gray-50' : 'pt-0.5 text-[13px] font-semibold text-gray-100'}><InlineText text={b.text} /></div>;
        if (b.t === 'p') return <p key={i}>{b.lines.map((l, k) => <React.Fragment key={k}>{k > 0 && <br />}<InlineText text={l} /></React.Fragment>)}</p>;
        if (b.t === 'list') return (
          <div key={i} className="space-y-0.5">
            {b.items.map((it, k) => (
              <div key={k} className="flex gap-1.5" style={{ paddingLeft: it.depth * 14 }}>
                <span className="shrink-0 text-sky-400">{it.n != null ? `${it.n}.` : '•'}</span>
                <span className="min-w-0"><InlineText text={it.text} /></span>
              </div>
            ))}
          </div>
        );
        if (b.t === 'table') return (
          <div key={i} className="overflow-x-auto">
            <table className="text-[12px] border-collapse">
              {b.head.length > 0 && <thead><tr>{b.head.map((c, k) => <th key={k} className="border border-gray-700 bg-gray-800/70 px-2 py-1 text-left font-semibold text-gray-100 whitespace-nowrap"><InlineText text={c} /></th>)}</tr></thead>}
              <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border border-gray-700 px-2 py-1 text-gray-200 align-top"><InlineText text={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        );
        if (b.t === 'code') return <pre key={i} className="overflow-x-auto rounded bg-gray-900 px-2 py-1.5 text-[11.5px] text-gray-200">{b.text}</pre>;
        if (b.t === 'quote') return <div key={i} className="border-l-2 border-sky-600/60 pl-2 text-gray-400">{b.lines.map((l, k) => <div key={k}><InlineText text={l} /></div>)}</div>;
        return <hr key={i} className="border-gray-700" />;
      })}
    </div>
  );
}

// 구글 검색 제안(검색 연결을 쓰면 함께 보여 주는 칩) — 스크립트·같은 출처 없이 격리, 링크는 새 창.
function SearchSuggest({ html }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0">${html}</body></html>`;
  return <iframe title="구글 검색 제안" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="block w-full h-[62px] rounded-md border-0 bg-transparent" />;
}

export default function AiSearchChat({ open, onClose, keyApi = null, storeApi = null, isAdmin = false, viewingAs = false, getPortfolios = null, aiApi = null }) {
  const [store, setStore] = useState(null);
  const [loadInfo, setLoadInfo] = useState({ loaded: false, canSave: false, error: '' });
  const [keyState, setKeyState] = useState({ loaded: false, key: '', canSave: false, error: '' });
  const [keyInput, setKeyInput] = useState('');
  const [keyEdit, setKeyEdit] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [panel, setPanel] = useState('chat');
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(null);
  const [mini, setMini] = useState(false);
  const [wide, setWide] = useState(false);
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [delAsk, setDelAsk] = useState(null);
  const [saveInfo, setSaveInfo] = useState({ at: '', error: '' });
  const [copied, setCopied] = useState('');
  const [aiState, setAiState] = useState({ loaded: false, keys: {}, canSave: false, error: '' });
  const [aiOpen, setAiOpen] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [aiEdit, setAiEdit] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState({ id: '', text: '' });
  const [models, setModels] = useState({});
  const [pasteBox, setPasteBox] = useState(null);
  const [handNote, setHandNote] = useState('');
  const speech = useSpeech();
  const storeRef = useRef(store);
  storeRef.current = store;
  const loadInfoRef = useRef(loadInfo);
  loadInfoRef.current = loadInfo;
  const keyRef = useRef(keyState.key);
  keyRef.current = keyState.key;
  const abortRef = useRef(null);
  const saveTimer = useRef(null);
  const saveChain = useRef(Promise.resolve());
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const stickBottom = useRef(true);
  const loadingRef = useRef(false);
  const aiKeysRef = useRef(aiState.keys);
  aiKeysRef.current = aiState.keys;
  const noteTimer = useRef(null);
  // 고른 AI — 없음(null) = 구글 Gemini 검색. 관리자 접속 중에는 사용자 키를 읽지 않으므로 늘 Gemini.
  const prefs = aiPrefsOf(store && store.ai);
  const pickP = viewingAs ? null : aiProviderById(prefs.pick);
  const pickKey = pickP ? (aiState.keys[pickP.id] || '') : '';
  const pickModelId = pickP ? (prefs.models[pickP.id] || pickP.model) : '';

  const doSave = () => {
    if (!storeApi || !loadInfoRef.current.canSave) return;
    saveChain.current = saveChain.current.then(async () => {
      const s = storeRef.current;
      if (!s) return;
      try {
        const r = await storeApi.save({ ...normalizeSearchStore(s), updatedAt: new Date().toISOString() });
        if (r?.ok) setSaveInfo({ at: new Date().toISOString(), error: '' });
        else setSaveInfo(p => ({ ...p, error: r?.error || '저장하지 못했습니다' }));
      } catch (e) {
        setSaveInfo(p => ({ ...p, error: `저장하지 못했습니다 (${e?.message || e})` }));
      }
    });
  };
  const scheduleSave = () => {
    if (!storeApi || !loadInfoRef.current.canSave) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; doSave(); }, 1200);
  };

  // 열 때 — 키는 매번(App이 계정별로 기억한다), 대화는 아직 못 불러왔고 이번에 만든 대화가 없을 때만.
  useEffect(() => {
    if (!open) return;
    // 키 둘(Gemini · 다른 AI)은 같은 파일이라 차례로 읽는다(App이 한 번 읽어 계정별로 기억한다).
    (async () => {
      if (keyApi) {
        try { const r = await keyApi.load(); setKeyState({ loaded: true, key: r?.key || '', canSave: !!r?.canSave, error: r?.error || '' }); }
        catch (e) { setKeyState({ loaded: true, key: '', canSave: false, error: String(e?.message || e) }); }
      } else setKeyState({ loaded: true, key: '', canSave: false, error: '' });
      if (aiApi) {
        try { const r = await aiApi.load(); setAiState({ loaded: true, keys: normalizeAiKeys(r?.keys), canSave: !!r?.canSave, error: r?.error || '' }); }
        catch (e) { setAiState({ loaded: true, keys: {}, canSave: false, error: String(e?.message || e) }); }
      } else setAiState({ loaded: true, keys: {}, canSave: false, error: '' });
    })();
    const s = storeRef.current;
    if (loadingRef.current || loadInfoRef.current.canSave || (s && s.chats.length > 0)) return;
    if (!storeApi) { setStore(normalizeSearchStore(null)); setLoadInfo({ loaded: true, canSave: false, error: '' }); return; }
    loadingRef.current = true;
    storeApi.load().then((r) => {
      setStore(normalizeSearchStore(r?.data));
      setLoadInfo({ loaded: true, canSave: !!r?.canSave, error: r?.error || '' });
    }).catch((e) => {
      setStore(cur => cur || normalizeSearchStore(null));
      setLoadInfo({ loaded: true, canSave: false, error: `지난 대화를 불러오지 못했습니다 (${e?.message || e})` });
    }).finally(() => { loadingRef.current = false; });
  }, [open]);

  // 닫히면 읽기를 멈춘다(보이지 않는 채 계속 말하지 않게). 받는 중인 답은 그대로 받는다.
  useEffect(() => { if (!open) { speech.stop(); setMini(false); } }, [open]);

  // 고른 AI의 모델 목록 — 키가 있고 아직 안 받았으면 한 번 받는다(이 창 메모리에만 둔다).
  useEffect(() => {
    if (open && pickP && pickKey && !models[pickP.id]) loadModels(pickP.id);
  }, [open, pickP ? pickP.id : '', pickKey]);

  // 사라질 때(계정 전환·새로고침 전) 미뤄 둔 저장을 바로 한다.
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } }
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; doSave(); }
  }, []);

  const chats = store ? store.chats : [];
  const active = activeId ? chats.find(c => c.id === activeId) || null : null;
  const msgs = active ? active.msgs : [];
  const lastMsg = msgs[msgs.length - 1];

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs, panel, open, mini]);

  const patchMsg = (chatId, msgId, patch) => setStore(prev => prev && ({
    ...prev,
    chats: prev.chats.map(c => (c.id !== chatId ? c : { ...c, msgs: c.msgs.map(m => (m.id !== msgId ? m : { ...m, ...patch })) })),
  }));
  const updateChat = (id, fn) => { setStore(prev => prev && ({ ...prev, chats: prev.chats.map(c => (c.id === id ? fn(c) : c)) })); scheduleSave(); };

  // 묻기 — cutAt이 있으면 그 자리(질문)부터 지우고 다시 묻는다(다시 묻기).
  const ask = async (raw, cutAt = null) => {
    const text = String(raw || '').trim().slice(0, 4000);
    const s = storeRef.current;
    if (!text || running || !s) return;
    const now = new Date().toISOString();
    const prevChat = activeId ? s.chats.find(c => c.id === activeId) : null;
    const cid = prevChat ? prevChat.id : generateId();
    const uMsg = { id: generateId(), role: 'user', text, at: now };
    const aMsg = { id: generateId(), role: 'model', text: '', at: now, pending: true, ...(pickP ? { via: `api:${pickP.id}` } : {}) };
    const base = prevChat ? (cutAt == null ? prevChat.msgs : prevChat.msgs.slice(0, cutAt)) : [];
    const sendMsgs = requestMessages([...base, uMsg]);
    setStore(prev => {
      const exists = prev.chats.some(c => c.id === cid);
      const list = exists
        ? prev.chats.map(c => (c.id !== cid ? c : { ...c, updatedAt: now, msgs: [...(cutAt == null ? c.msgs : c.msgs.slice(0, cutAt)), uMsg, aMsg] }))
        : [{ id: cid, title: chatTitleFrom(text), createdAt: now, updatedAt: now, pinned: false, msgs: [uMsg, aMsg] }, ...prev.chats];
      return { ...prev, chats: list };
    });
    setActiveId(cid);
    setDraft('');
    setPanel('chat');
    setRunning({ chatId: cid, msgId: aMsg.id });
    stickBottom.current = true;
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = ac;
    let st = searchReadInit();
    let painted = 0;
    const modelLabel = () => (pickP ? `${pickP.short} · ${st.model || pickModelId}`.slice(0, 80) : st.model);
    const failCode = pickP ? 'fail' : 'gemini';
    const paint = () => { const t = Date.now(); if (t - painted < 90) return; painted = t; patchMsg(cid, aMsg.id, { text: st.text, model: modelLabel() }); };
    const finish = (patch) => {
      patchMsg(cid, aMsg.id, { pending: false, model: modelLabel(), ...patch });
      setRunning(null);
      if (abortRef.current === ac) abortRef.current = null;
      scheduleSave();
    };
    try {
      const headers = { 'Content-Type': 'application/json' };
      const holdings = s.holdOn && getPortfolios ? searchHoldings(getPortfolios()) : [];
      let body = { messages: sendMsgs, holdings };
      if (pickP) {
        // 다른 AI — 내 키는 헤더로만, 보낼 곳(회사)은 서버의 표가 정한다.
        headers['X-AI-Key'] = pickKey;
        body = { op: 'chat', provider: pickP.id, model: pickModelId, web: !!prefs.web[pickP.id], messages: sendMsgs, holdings };
      } else if (keyRef.current && !viewingAs) headers['X-Gemini-Key'] = keyRef.current;
      const res = await fetch(pickP ? '/api/ai-chat' : '/api/ai-search', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac ? ac.signal : undefined,
      });
      if (!res.ok) {
        let msg = '';
        try { msg = String((await res.json()).error || ''); } catch { /* 글 아님 */ }
        finish({ text: '', err: res.status === 401 || res.status === 403 ? 'auth' : failCode, msg: msg || `HTTP ${res.status}` });
        return;
      }
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          st = searchReadStep(st, dec.decode(value, { stream: true }));
          paint();
        }
        st = searchReadStep(st, dec.decode(), true);
      } else {
        st = searchReadStep(st, await res.text(), true);
      }
    } catch (err) {
      const stopped = err && err.name === 'AbortError';
      finish({ text: st.text, err: stopped ? 'stop' : 'net' });
      return;
    }
    if (st.error && !st.text.trim()) finish({ text: '', err: st.error, msg: st.msg });
    else if (!st.done) finish({ text: st.text, err: st.error || 'cut', msg: st.msg });
    else if (!st.text.trim()) finish({ text: '', err: failCode, msg: '빈 답' });
    else finish({
      text: st.text, err: st.error || '', msg: st.msg,
      sources: st.ground ? st.ground.sources : [], queries: st.ground ? st.ground.queries : [], html: st.ground ? st.ground.html : '',
    });
  };
  const stopAsk = () => { if (abortRef.current) { try { abortRef.current.abort(); } catch { /* 끝남 */ } } };
  const retry = (idx) => {
    const q = msgs[idx - 1];
    if (q && q.role === 'user') ask(q.text, idx - 1);
  };

  const newChat = () => { setActiveId(null); setPanel('chat'); setDraft(''); setTimeout(() => { try { inputRef.current && inputRef.current.focus(); } catch { /* 없음 */ } }, 0); };
  const openChat = (id) => { stickBottom.current = true; setActiveId(id); setPanel('chat'); };
  const removeChat = (id) => {
    if (running && running.chatId === id) stopAsk();
    const c = chats.find(x => x.id === id);
    if (c && c.msgs.some(m => m.id === speech.speaking.id)) speech.stop();
    setStore(prev => prev && ({ ...prev, chats: prev.chats.filter(x => x.id !== id) }));
    if (activeId === id) setActiveId(null);
    setDelAsk(null);
    scheduleSave();
  };
  const setVoice = (patch) => {
    if (!store) return;
    const voice = { ...store.voice, ...patch };
    setStore(prev => prev && ({ ...prev, voice }));
    scheduleSave();
    if (speech.speaking.id != null && !speech.speaking.paused) { speech.pause(); speech.resume(voice); }
  };
  const listen = (m) => {
    if (!speech.play(m.id, m.text, store ? store.voice : {})) setCopied(`nospeech:${m.id}`);
  };

  const copyText = async (key, text) => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch { ok = false; }
    }
    setCopied(ok ? key : `fail:${key}`);
    setTimeout(() => setCopied(c => (c === key || c === `fail:${key}` ? '' : c)), 1800);
  };
  const answerCopy = (m) => [m.text, ...(m.sources && m.sources.length ? ['', '출처:', ...m.sources.map(s => `- ${hostOf(s)} ${s.uri}`)] : [])].join('\n');
  const flashNote = (t) => {
    setHandNote(t);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => { noteTimer.current = null; setHandNote(''); }, 9000);
  };

  // ── 다른 AI(내 키) — 고른 AI·모델은 대화 묶음(store.ai)에, 키는 ai_settings.json(aiApi)에 ──
  const setAi = (patch) => { setStore(prev => prev && ({ ...prev, ai: { ...aiPrefsOf(prev.ai), ...patch } })); scheduleSave(); };
  const setAiModel = (pid, model) => {
    setStore(prev => { if (!prev) return prev; const a = aiPrefsOf(prev.ai); return { ...prev, ai: { ...a, models: { ...a.models, [pid]: model } } }; });
    scheduleSave();
  };
  const setAiWeb = (pid, on) => {
    setStore(prev => { if (!prev) return prev; const a = aiPrefsOf(prev.ai); return { ...prev, ai: { ...a, web: { ...a.web, [pid]: !!on } } }; });
    scheduleSave();
  };
  // 모델 목록 받기 = 키 시험(그 키로 그 회사에 닿는지). 목록에 지금 모델이 없으면 권하는 모델로 바꾼다.
  const loadModels = async (pid, keyNow = '') => {
    const p = aiProviderById(pid);
    const key = keyNow || aiKeysRef.current[pid] || '';
    if (!p || !key || viewingAs) return;
    setModels(m => ({ ...m, [pid]: { list: (m[pid] && m[pid].list) || [], loading: true, error: '' } }));
    let list = [];
    let error = '';
    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AI-Key': key },
        body: JSON.stringify({ op: 'models', provider: pid }),
      });
      let j = null;
      try { j = await res.json(); } catch { /* 글 아님 */ }
      if (!res.ok || !j || j.error) {
        const raw = String((j && j.error) || '');
        const code = res.status === 401 || res.status === 403 ? 'auth' : (/^[a-z]{1,12}$/.test(raw) ? raw : 'fail');
        const more = String((j && j.msg) || (code === 'fail' ? raw : '') || '').slice(0, 200);
        error = `${aiErrorText(code, p.short)}${more ? ` (${more})` : ''}`;
      } else {
        list = cleanModels(j.models);
        if (!list.length) error = '이 키로 쓸 수 있는 모델을 찾지 못했습니다';
      }
    } catch { error = aiErrorText('net', p.short); }
    setModels(m => ({ ...m, [pid]: { list: list.length ? list : ((m[pid] && m[pid].list) || []), loading: false, error } }));
    if (list.length) {
      const cur = aiPrefsOf(storeRef.current && storeRef.current.ai).models[pid] || p.model;
      const next = pickModel(pid, list, cur);
      if (next && next !== cur) setAiModel(pid, next);
    }
  };
  const saveAiKey = async (pid, value) => {
    const p = aiProviderById(pid);
    if (!aiApi || !p) return;
    const k = String(value || '').trim();
    if (k && !looksLikeAiKey(k)) { setAiMsg({ id: pid, text: '키 모양이 아닙니다 — 그 회사 화면에서 [복사]한 글자를 그대로 붙여넣어 주세요' }); return; }
    setAiBusy(true); setAiMsg({ id: pid, text: '' });
    try {
      const next = { ...aiKeysRef.current };
      if (k) next[pid] = k; else delete next[pid];
      const r = await aiApi.save(next);
      if (r?.ok) {
        setAiState(s => ({ ...s, keys: normalizeAiKeys(r.keys || next) }));
        setAiInput(''); setAiEdit(false);
        setModels(m => { const n = { ...m }; delete n[pid]; return n; });
        setAiMsg({ id: pid, text: k ? '저장했습니다' : '키를 지웠습니다' });
        if (k) await loadModels(pid, k);
      } else setAiMsg({ id: pid, text: r?.error || '저장하지 못했습니다' });
    } catch (e) { setAiMsg({ id: pid, text: `저장하지 못했습니다 (${e?.message || e})` }); }
    setAiBusy(false);
  };
  const openAiSettings = (pid) => { setAiOpen(pid || ''); setAiInput(''); setAiEdit(false); setAiMsg({ id: '', text: '' }); setPanel('settings'); };

  // ── 내 구독으로 묻기(API·키 없이) — 그 AI 사이트를 내 계정으로 열고 질문을 넘긴다. 답은 「답 붙여넣기」로 가져온다. ──
  // 누른 그 순간에 복사한다(새 창이 뜨면 이 창이 초점을 잃어 복사가 막힌다) — 옛 방식(바로 됨)과 새 방식을 둘 다 건다.
  const copyNow = (text) => {
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy'); ta.remove();
    } catch { ok = false; }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(() => { /* 초점 없음 */ }); ok = true; } } catch { /* 막힘 */ }
    return ok;
  };
  const handPromptOf = (question, base) => {
    const s = storeRef.current;
    if (!s) return '';
    const holdings = s.holdOn && getPortfolios ? searchHoldings(getPortfolios()) : [];
    return handPrompt({ question, history: requestMessages(base), holdings, withHistory: aiPrefsOf(s.ai).ctx });
  };
  const askHand = (hid, raw) => {
    const text = String(raw || '').trim().slice(0, 4000);
    const s = storeRef.current;
    if (!text || running || !s) return;
    const prevChat = activeId ? s.chats.find(c => c.id === activeId) : null;
    const prompt = handPromptOf(text, prevChat ? prevChat.msgs : []);
    const add = () => {
      const now = new Date().toISOString();
      const cid = prevChat ? prevChat.id : generateId();
      const uMsg = { id: generateId(), role: 'user', text, at: now };
      const aMsg = { id: generateId(), role: 'model', text: '', at: now, err: 'hand', via: `hand:${hid}` };
      setStore(prev => {
        if (!prev) return prev;
        const exists = prev.chats.some(c => c.id === cid);
        const list = exists
          ? prev.chats.map(c => (c.id !== cid ? c : { ...c, updatedAt: now, msgs: [...c.msgs, uMsg, aMsg] }))
          : [{ id: cid, title: chatTitleFrom(text), createdAt: now, updatedAt: now, pinned: false, msgs: [uMsg, aMsg] }, ...prev.chats];
        return { ...prev, chats: list };
      });
      setActiveId(cid); setDraft(''); setPanel('chat'); setPasteBox(null);
      stickBottom.current = true;
      scheduleSave();
    };
    if (hid === HAND_SHARE) {
      let pr = null;
      try { pr = navigator.share({ text: prompt }); } catch { pr = null; }
      if (!pr || !pr.then) { flashNote('이 기기는 공유 창을 열지 못합니다 — AI 이름을 눌러 주세요'); return; }
      pr.then(() => { add(); flashNote('공유한 앱에서 답을 받으면 복사한 뒤 「답 붙여넣기」를 눌러 주세요'); })
        .catch((e) => { if (!e || e.name !== 'AbortError') flashNote('공유하지 못했습니다 — AI 이름을 눌러 주세요'); });
      return;
    }
    const link = handUrl(hid, prompt);
    if (!link.url) return;
    const copiedOk = copyNow(prompt);
    try { window.open(link.url, '_blank', 'noopener,noreferrer'); } catch { /* 팝업 막힘 — 「다시 열기」로 연다 */ }
    add();
    flashNote(`${handName(hid)} 창을 열었습니다${copiedOk ? ' · 질문을 복사해 두었습니다' : ''} — 답을 받으면 복사해 「답 붙여넣기」`);
  };
  // 붙여넣은 글을 그 자리의 답으로. 못 넣으면 까닭 글을 돌려준다.
  const acceptPaste = (chatId, msgId, hid, raw, question, prompt) => {
    const text = cleanPaste(raw);
    if (!text) return '붙여넣을 글이 없습니다 — AI 답의 [복사] 버튼을 누른 뒤 다시 눌러 주세요';
    if (pasteIsQuestion(text, question, prompt)) return '아직 질문이 복사돼 있습니다 — AI 사이트에서 답의 [복사] 버튼을 누른 뒤 다시 눌러 주세요';
    const now = new Date().toISOString();
    setStore(prev => prev && ({
      ...prev,
      chats: prev.chats.map(c => (c.id !== chatId ? c : { ...c, updatedAt: now, msgs: c.msgs.map(m => (m.id !== msgId ? m : { ...m, text, err: '', msg: '', model: handModelLabel(hid), at: now })) })),
    }));
    setPasteBox(null);
    stickBottom.current = true;
    scheduleSave();
    return '';
  };
  const pasteAnswer = async (chatId, msgId, hid, question, prompt) => {
    let t = '';
    try { t = await navigator.clipboard.readText(); } catch { t = ''; }
    if (!t || !t.trim()) { setPasteBox({ id: msgId, text: '', note: '클립보드를 읽지 못했습니다 — 아래 칸에 직접 붙여넣어 주세요(Ctrl+V · 휴대폰은 길게 눌러 붙여넣기)' }); return; }
    const why = acceptPaste(chatId, msgId, hid, t, question, prompt);
    if (why) setPasteBox({ id: msgId, text: '', note: why });
  };
  // 넘긴 것 취소 — 질문과 기다리는 자리를 함께 지우고 질문은 입력 칸에 되돌린다.
  const dropHand = (idx) => {
    if (!active) return;
    const q = msgs[idx - 1];
    const hasQ = !!q && q.role === 'user';
    const rest = [...msgs.slice(0, hasQ ? idx - 1 : idx), ...msgs.slice(idx + 1)];
    if (hasQ && !draft.trim()) setDraft(q.text);
    setPasteBox(null);
    if (rest.length === 0) { removeChat(active.id); return; }
    updateChat(active.id, c => ({ ...c, msgs: rest }));
  };
  // 답을 못 받은 질문을 입력 칸에 되돌려 「내 구독으로 묻기」로 넘기게 한다.
  const toHand = (idx) => {
    const q = msgs[idx - 1];
    if (!q || q.role !== 'user') return;
    setDraft(q.text);
    flashNote('아래 「내 구독으로 묻기」에서 쓰는 AI 이름을 눌러 주세요');
    try { inputRef.current && inputRef.current.focus(); } catch { /* 없음 */ }
  };
  const downloadChat = (c) => {
    try {
      const blob = new Blob([chatToMarkdown(c)], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = chatFileName(c);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { setCopied(`fail:dl:${c.id}`); }
  };

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

  if (!open) return null;

  const close = () => { speech.stop(); setMini(false); onClose && onClose(); };
  const needKey = pickP ? (aiState.loaded && !pickKey) : (!isAdmin && !viewingAs && keyState.loaded && !keyState.key);
  const pickModels = pickP && models[pickP.id] ? models[pickP.id].list : [];
  const errText = (m) => { const p = apiOf(m); return p ? aiErrorText(m.err, p.short) : searchErrorText(m.err); };
  const ready = !!store && loadInfo.loaded;
  const sp = speech.speaking;
  const holdCount = store && store.holdOn && getPortfolios ? searchHoldings(getPortfolios()).length : 0;

  const speakCtl = (m) => (sp.id === m.id ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-sky-700/60 bg-sky-900/30 px-1.5 py-0.5 text-sky-200 text-[11.5px]">
      <button onClick={() => speech.skip(-1)} title="앞 문장" className="p-0.5 hover:text-white"><PrevIcon /></button>
      {sp.paused
        ? <button onClick={() => speech.resume(store.voice)} title="이어 듣기" className="p-0.5 hover:text-white"><PlayIcon /></button>
        : <button onClick={speech.pause} title="멈춤" className="p-0.5 hover:text-white"><PauseIcon /></button>}
      <button onClick={() => speech.skip(1)} title="다음 문장" className="p-0.5 hover:text-white"><NextIcon /></button>
      <button onClick={speech.stop} title="그만 듣기" className="p-0.5 hover:text-white"><StopIcon /></button>
      <span className="tabular-nums">{sp.paused ? '멈춤' : '듣는 중'} {sp.idx + 1}/{sp.total}</span>
    </span>
  ) : (
    <button onClick={() => listen(m)} disabled={!speech.supported} title={speech.supported ? '이 답을 소리로 듣기' : '이 브라우저는 소리 읽기를 지원하지 않습니다'} className={speech.supported ? chip : 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-700 text-gray-600 text-[11.5px] cursor-not-allowed'}>
      <SpeakerIcon />듣기
    </button>
  ));

  if (mini) {
    return (
      <div className="fixed z-[996] right-3 bottom-3 flex items-center gap-1.5 rounded-full border border-sky-700/60 bg-[#0f1623] px-3 py-1.5 shadow-2xl text-[12px] text-gray-200">
        <span className="text-sky-300"><ChatIcon size={14} /></span>
        <button onClick={() => setMini(false)} className="font-semibold hover:text-white">AI 검색</button>
        {running && <span className="text-sky-300 animate-pulse">답 받는 중…</span>}
        {sp.id != null && (
          <span className="inline-flex items-center gap-1 text-sky-200">
            {sp.paused
              ? <button onClick={() => speech.resume(store.voice)} title="이어 듣기" className="p-0.5 hover:text-white"><PlayIcon /></button>
              : <button onClick={speech.pause} title="멈춤" className="p-0.5 hover:text-white"><PauseIcon /></button>}
            <button onClick={speech.stop} title="그만 듣기" className="p-0.5 hover:text-white"><StopIcon /></button>
            <span className="tabular-nums">{sp.idx + 1}/{sp.total}</span>
          </span>
        )}
        <button onClick={() => setMini(false)} title="펼치기" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white"><Maximize2 size={13} /></button>
        <button onClick={close} title="닫기" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white"><X size={13} /></button>
      </div>
    );
  }

  const listRows = [...chats].filter(c => chatMatches(c, filter)).sort((a, b) => (a.pinned === b.pinned ? String(b.updatedAt).localeCompare(String(a.updatedAt)) : a.pinned ? -1 : 1));

  const keyBox = (
    <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-gray-200 font-semibold"><Lock size={13} className="text-amber-300" />내 Gemini API 키</span>
        <button onClick={() => setPanel('guide')} className="flex items-center gap-1 text-[11.5px] text-amber-200 hover:text-amber-100 hover:underline"><BookOpen size={12} />키 받는 법(그림)</button>
      </div>
      {isAdmin && <p className="text-[11.5px] text-emerald-300/90">관리자 — 키 없이 사이트 키로 검색합니다{keyState.key ? ' (내 키를 먼저 씁니다)' : ''}.</p>}
      {!keyState.loaded ? (
        <p className="text-gray-500">키를 확인하는 중…</p>
      ) : viewingAs ? (
        <p className="text-gray-500">관리자 접속 중에는 사용자의 키를 읽거나 저장하지 않습니다(사이트 키로 검색합니다).</p>
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
            {' '}에서 무료로 만든 키를 넣으면 내 무료 한도로 검색합니다. 키는 내 구글 Drive(Index_Data 폴더)에만 저장되고, 사진으로 보유 맞추기와 함께 씁니다.
          </p>
          {!keyState.canSave && <p className="text-[11px] text-amber-300/90">{keyState.error || 'Drive에 연결된 뒤 저장할 수 있습니다'}</p>}
        </div>
      )}
      {keyMsg && <p className="text-[11.5px] text-sky-200">{keyMsg}</p>}
    </div>
  );

  const aiBox = (
    <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-1.5">
      <div className="text-gray-200 font-semibold flex items-center gap-1.5"><Lock size={13} className="text-violet-300" />다른 AI 연결 — 내 계정 키</div>
      <p className="text-[11.5px] text-gray-400">회사마다 <b className="text-gray-200">내 계정으로 만든 키</b>를 넣으면 채팅창 아래 <b className="text-gray-200">AI</b> 칸에서 골라 묻습니다. 키는 내 구글 Drive(Index_Data 폴더)에만 저장되고, 물을 때만 그 회사로 전달됩니다(사이트 서버에 남기지 않습니다).</p>
      {!aiState.loaded ? (
        <p className="text-gray-500">키를 확인하는 중…</p>
      ) : viewingAs ? (
        <p className="text-gray-500">관리자 접속 중에는 사용자의 키를 읽거나 저장하지 않습니다.</p>
      ) : AI_PROVIDERS.map((p) => {
        const k = aiState.keys[p.id] || '';
        const isOpen = aiOpen === p.id;
        const ml = models[p.id];
        const cur = prefs.models[p.id] || p.model;
        const inList = !!ml && ml.list.some(x => x.id === cur);
        const warn = isOpen ? aiKeyWarning(p.id, aiInput) : '';
        return (
          <div key={p.id} className={isOpen ? 'rounded-md border border-violet-600/50 bg-violet-900/10' : 'rounded-md border border-gray-800'}>
            <button onClick={() => { setAiOpen(isOpen ? '' : p.id); setAiInput(''); setAiEdit(false); setAiMsg({ id: '', text: '' }); }} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left">
              <span className="flex-1 min-w-0 truncate text-[12px] text-gray-100">{p.label}</span>
              <span className={p.cost === 'free' ? 'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] bg-emerald-900/40 text-emerald-200' : p.cost === 'sub' ? 'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] bg-violet-900/50 text-violet-200' : 'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] bg-gray-800 text-gray-300'}>{AI_COST_LABEL[p.cost]}</span>
              <span className={k ? 'shrink-0 text-[11px] text-emerald-300' : 'shrink-0 text-[11px] text-gray-500'}>{k ? '✓ 연결' : '키 없음'}</span>
            </button>
            {isOpen && (
              <div className="px-2 pb-2 space-y-1.5 text-[11.5px]">
                <p className="text-gray-400">{p.costNote}</p>
                <p className="text-gray-400">{p.note}{' '}
                  <a href={p.keyPage} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-sky-300 hover:underline">키 만들러 가기 <ExternalLink size={10} /></a>
                </p>
                {k && !aiEdit ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-emerald-300">✓ 저장됨 <span className="font-mono text-gray-300">{maskAiKey(k)}</span></span>
                    {aiState.canSave && <button onClick={() => { setAiEdit(true); setAiMsg({ id: '', text: '' }); }} className="px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 text-[11.5px]">바꾸기</button>}
                    {aiState.canSave && <button disabled={aiBusy} onClick={() => saveAiKey(p.id, '')} className="px-2 py-0.5 rounded border border-gray-600 text-gray-400 hover:text-red-300 hover:bg-gray-800 text-[11.5px]">키 지우기</button>}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <input type="password" autoComplete="off" spellCheck={false} value={aiInput} onChange={e => setAiInput(e.target.value)} placeholder={`${p.keyHint} 붙여넣기`}
                        className="flex-1 min-w-0 bg-[#0b1120] border border-gray-600 focus:border-violet-400 rounded-md px-2.5 py-1.5 text-[12.5px] text-gray-100 font-mono outline-none" />
                      <button disabled={aiBusy || !aiState.canSave || !aiInput.trim()} onClick={() => saveAiKey(p.id, aiInput)} className="px-3 py-1.5 rounded-md bg-violet-700 hover:bg-violet-600 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold text-[12px] shrink-0">저장</button>
                      {aiEdit && <button onClick={() => { setAiEdit(false); setAiInput(''); }} className="px-2 py-1.5 rounded-md border border-gray-600 text-gray-400 text-[12px] shrink-0">취소</button>}
                    </div>
                    {warn && <p className="text-amber-300/90">{warn}</p>}
                  </div>
                )}
                {k && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400 shrink-0">모델</span>
                      {ml && ml.list.length > 0 ? (
                        <select value={inList ? cur : ''} onChange={e => { if (e.target.value) setAiModel(p.id, e.target.value); }} className="flex-1 min-w-0 bg-[#0b1120] border border-gray-600 rounded-md px-2 py-1 text-[12px] text-gray-100 outline-none">
                          {!inList && <option value="">{cur} (목록에 없음)</option>}
                          {ml.list.map(x => <option key={x.id} value={x.id}>{x.free ? '무료 · ' : ''}{x.name && x.name !== x.id ? `${x.name} — ${x.id}` : x.id}</option>)}
                        </select>
                      ) : <span className="flex-1 min-w-0 truncate font-mono text-gray-300">{cur}</span>}
                      <button disabled={!!(ml && ml.loading)} onClick={() => loadModels(p.id)} className={chip}><RefreshCw size={12} />{ml && ml.loading ? '불러오는 중…' : '모델 불러오기'}</button>
                    </div>
                    {ml && !ml.loading && ml.error && <p className="text-red-300 break-all">{ml.error}</p>}
                    {ml && !ml.loading && !ml.error && ml.list.length > 0 && <p className="text-emerald-300/90">키 확인됨 — 쓸 수 있는 모델 {ml.list.length}개{ml.list.some(x => x.free) ? ` (무료 ${ml.list.filter(x => x.free).length}개)` : ''}</p>}
                    {p.web && (
                      <label className="flex items-start gap-1.5 cursor-pointer text-gray-300">
                        <input type="checkbox" checked={!!prefs.web[p.id]} onChange={() => setAiWeb(p.id, !prefs.web[p.id])} className="accent-violet-500 mt-0.5" />
                        <span>웹 검색으로 최신 자료 찾기{p.web === 'paid' ? ' — 검색 요금이 충전금에서 나갑니다(무료 모델만 쓰려면 꺼 두세요)' : ' — 검색 요금이 조금 더 듭니다'}</span>
                      </label>
                    )}
                    <button onClick={() => { setAi({ pick: p.id }); setPanel('chat'); }} className={vBtn}>{prefs.pick === p.id ? '이 AI로 묻는 중 — 채팅으로' : '이 AI로 묻기'}</button>
                  </div>
                )}
                {aiMsg.id === p.id && aiMsg.text && <p className="text-sky-200">{aiMsg.text}</p>}
              </div>
            )}
          </div>
        );
      })}
      {aiState.loaded && !viewingAs && !aiState.canSave && <p className="text-[11px] text-amber-300/90">{aiState.error || 'Drive에 연결된 뒤 저장할 수 있습니다'}</p>}
    </div>
  );
  const subBox = (
    <div className="rounded-lg border border-violet-700/40 bg-violet-900/10 px-3 py-2 space-y-1.5">
      <div className="text-violet-100 font-semibold">내 구독으로 묻기 — API 키 없이</div>
      <p className="text-[11.5px] text-gray-300">채팅창 아래 줄의 <b className="text-violet-100">ChatGPT · Claude · Gemini · Grok · Perplexity · Genspark · Copilot …</b> 을 누르면 그 사이트가 <b className="text-violet-100">내 계정(무료든 구독이든 그대로)</b>으로 열리고 질문이 넘어갑니다. 답의 [복사]를 누르고 돌아와 <b className="text-violet-100">답 붙여넣기</b>를 누르면 이 대화에 저장돼 듣기·복사·이어 묻기를 할 수 있습니다.</p>
      <label className="flex items-center gap-2 cursor-pointer text-gray-200">
        <input type="checkbox" checked={prefs.ctx} disabled={!store} onChange={() => setAi({ ctx: !prefs.ctx })} className="accent-violet-500" />
        앞에서 나눈 대화도 함께 넘기기
      </label>
      <p className="text-[11px] text-gray-400">켜면 글이 길어져 주소에 싣지 못하고 붙여넣기로만 넘어갈 수 있습니다(질문은 늘 복사해 둡니다).</p>
      <div className="text-[11.5px] text-gray-400 space-y-0.5">
        <p><b className="text-gray-200">ChatGPT Plus·Pro · Claude Pro·Max · SuperGrok · Genspark Plus · Perplexity Pro · Copilot Pro</b> → 내 구독으로 묻기(구독한 모델 그대로)</p>
        <p><b className="text-gray-200">Google AI Pro</b> → 매달 $10 크레딧으로 Gemini 키{' '}<button onClick={() => setPanel('guide')} className="text-amber-200 hover:underline">쓰는 법</button></p>
        <p><b className="text-gray-200">Poe 구독</b> → 위 「Poe」에 키를 넣으면 구독 포인트로 Claude·GPT·Gemini·Grok</p>
        <p><b className="text-gray-200">GitHub Copilot</b> → 위 「GitHub Models」 무료 한도가 더 큽니다</p>
      </div>
      <p className="text-[11px] text-gray-500">구독 로그인(아이디·비밀번호·쿠키)을 이 사이트에 넣어 대신 쓰게 하는 방식은 만들지 않았습니다 — 각 회사 약관이 막고 있어 계정이 정지되거나 로그인 정보가 새어 나갈 수 있습니다. 그래서 구독은 그 회사 사이트를 내 브라우저에서 여는 방식으로 씁니다.</p>
    </div>
  );
  // 내 구독 사이트에 넘겨 두고 답을 기다리는 자리(m.err === 'hand')
  const handBox = (m, i) => {
    const hid = String(m.via || '').slice(5);
    const q = msgs[i - 1] && msgs[i - 1].role === 'user' ? msgs[i - 1].text : '';
    const prompt = q ? handPromptOf(q, msgs.slice(0, i - 1)) : '';
    const link = hid === HAND_SHARE ? { url: '', prefilled: false } : handUrl(hid, prompt);
    const pb = pasteBox && pasteBox.id === m.id ? pasteBox : null;
    const name = handName(hid);
    return (
      <div className="rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-2 text-[12px] text-violet-100 space-y-1.5">
        <p><b>{name}</b>에 질문을 넘겼습니다 — 내 계정(구독 그대로)으로 답을 받습니다.</p>
        <ol className="list-decimal pl-4 space-y-0.5 text-violet-100/90">
          <li>{link.prefilled ? '열린 창에 질문이 들어가 있습니다. 비어 있으면 입력 칸에 붙여넣기(질문을 복사해 두었습니다) 후 보내기.' : '열린 창(앱)의 입력 칸에 붙여넣기(Ctrl+V)하고 보냅니다 — 질문을 복사해 두었습니다.'}</li>
          <li>답이 다 나오면 그 답의 <b>복사</b> 버튼을 누릅니다.</li>
          <li>여기로 돌아와 <b>답 붙여넣기</b>를 누르면 이 대화에 저장됩니다(듣기·복사·이어 묻기).</li>
        </ol>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => pasteAnswer(active.id, m.id, hid, q, prompt)} className={vBtn}>답 붙여넣기</button>
          <button onClick={() => setPasteBox(pb ? null : { id: m.id, text: '', note: '' })} className={chip}><Pencil size={12} />직접 붙여넣기</button>
          {link.url && <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => { if (prompt) copyNow(prompt); }} className={chip}><ExternalLink size={12} />{name} 다시 열기</a>}
          {hid === HAND_SHARE && canShare() && prompt && <button onClick={() => { try { navigator.share({ text: prompt }).catch(() => { /* 취소 */ }); } catch { /* 못 엶 */ } }} className={chip}>다시 공유</button>}
          {prompt && <button onClick={() => copyText(`q:${m.id}`, prompt)} className={chip}>{copied === `q:${m.id}` ? <><Check size={12} />복사됨</> : copied === `fail:q:${m.id}` ? '복사 실패' : <><CopyIcon />질문 다시 복사</>}</button>}
          <button onClick={() => dropHand(i)} className={chip}><X size={12} />취소</button>
        </div>
        {pb && (
          <div className="space-y-1">
            {pb.note && <p className="text-amber-200">{pb.note}</p>}
            <textarea rows={4} value={pb.text} onChange={e => setPasteBox({ ...pb, text: e.target.value })} placeholder="AI 답을 여기에 붙여넣으세요"
              className="w-full resize-y bg-[#0b1120] border border-gray-600 focus:border-violet-400 rounded-md px-2 py-1.5 text-[12.5px] text-gray-100 outline-none" />
            <div className="flex gap-1.5">
              <button disabled={!pb.text.trim()} onClick={() => { const why = acceptPaste(active.id, m.id, hid, pb.text, q, prompt); if (why) setPasteBox({ ...pb, note: why }); }} className={vBtn}>이 글을 답으로 넣기</button>
              <button onClick={() => setPasteBox(null)} className={chip}>닫기</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`fixed z-[996] inset-0 sm:inset-auto sm:right-4 sm:bottom-4 flex flex-col overflow-hidden bg-[#0f1623] sm:rounded-2xl sm:border border-sky-700/50 shadow-2xl sm:h-[min(84vh,800px)] ${wide ? 'sm:w-[min(880px,calc(100vw_-_2rem))]' : 'sm:w-[440px]'}`}>
      <div className="flex items-center justify-between gap-1 px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sky-300 shrink-0"><ChatIcon /></span>
          <span className="text-gray-100 font-semibold text-sm truncate">{panel === 'list' ? '저장한 자료' : panel === 'settings' || panel === 'guide' ? 'AI 검색 설정' : (active ? active.title : 'AI 검색')}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => setPanel(p => (p === 'list' ? 'chat' : 'list'))} title="저장한 자료(대화 목록)" className={panel === 'list' ? 'p-1.5 rounded bg-sky-900/40 text-sky-300 flex items-center justify-center' : btn}><List size={15} /></button>
          <button onClick={newChat} title="새 대화" className={btn}><Plus size={15} /></button>
          <button onClick={() => setPanel(p => (p === 'settings' || p === 'guide' ? 'chat' : 'settings'))} title="설정(키·듣기·보유 종목)" className={panel === 'settings' || panel === 'guide' ? 'p-1.5 rounded bg-sky-900/40 text-sky-300 flex items-center justify-center' : btn}><Settings size={15} /></button>
          <button onClick={() => setWide(w => !w)} title={wide ? '좁게 보기' : '넓게 보기'} className={`hidden sm:flex ${btn}`}><Maximize2 size={14} /></button>
          <button onClick={() => setMini(true)} title="작게(듣기는 계속)" className={btn}><MinIcon /></button>
          <button onClick={close} title="닫기" className={btn}><X size={16} /></button>
        </div>
      </div>

      {panel === 'guide' && (
        <div className="flex-1 min-h-0 flex flex-col"><AiApiGuide inline onClose={() => setPanel('settings')} /></div>
      )}

      {panel === 'settings' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-[12.5px] text-gray-300 leading-relaxed">
          <p>질문하면 구글 Gemini가 <b className="text-gray-100">구글 검색으로 최신 자료를 찾아</b> 정리해 답합니다. 답 아래 <b className="text-sky-200">출처</b>를 눌러 원문을 확인하세요. 답은 AI가 정리한 것이라 틀릴 수 있습니다.</p>
          <p className="text-[12px] text-gray-400">다른 AI도 씁니다 — <b className="text-gray-200">키가 있으면</b> 아래 「다른 AI 연결」(무료 모델 포함), <b className="text-gray-200">구독만 있으면</b> 「내 구독으로 묻기」.</p>
          {keyBox}
          {aiBox}
          {subBox}
          <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-1.5">
            <div className="text-gray-200 font-semibold flex items-center gap-1.5"><SpeakerIcon size={14} />듣기</div>
            {!speech.supported ? (
              <p className="text-amber-300/90 text-[12px]">이 브라우저는 소리 읽기를 지원하지 않습니다 — 크롬·사파리·엣지에서 열어 주세요.</p>
            ) : (<>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-400 text-[12px] w-12 shrink-0">빠르기</span>
                {SPEECH_RATES.map(r => (
                  <button key={r} onClick={() => setVoice({ rate: r })} className={store && store.voice.rate === r ? 'px-2 py-0.5 rounded-md bg-sky-700 text-white text-[11.5px] font-bold' : 'px-2 py-0.5 rounded-md border border-gray-600 text-gray-300 hover:bg-gray-800 text-[11.5px]'}>{r}배</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 text-[12px] w-12 shrink-0">목소리</span>
                {speech.voices.length > 0 ? (
                  <select value={store ? store.voice.voiceURI : ''} onChange={e => setVoice({ voiceURI: e.target.value })} className="flex-1 min-w-0 bg-[#0b1120] border border-gray-600 rounded-md px-2 py-1 text-[12px] text-gray-100 outline-none">
                    <option value="">기본 목소리</option>
                    {speech.voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
                  </select>
                ) : <span className="text-[11.5px] text-gray-500">이 기기의 기본 한국어 목소리로 읽습니다</span>}
                <button onClick={() => speech.play('test', '안녕하세요. 이 목소리로 검색 결과를 읽어 드립니다.', store ? store.voice : {})} className={chip}><SpeakerIcon />시험</button>
              </div>
              <p className="text-[11px] text-gray-500">기기에 들어 있는 목소리로 읽어 키·비용이 들지 않습니다. 휴대폰은 무음 모드를 끄고 소리를 키워 주세요.</p>
            </>)}
          </div>
          <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2 space-y-1">
            <label className="flex items-center gap-2 cursor-pointer text-gray-200 font-semibold">
              <input type="checkbox" checked={!!(store && store.holdOn)} disabled={!store} onChange={() => { setStore(prev => prev && ({ ...prev, holdOn: !prev.holdOn })); scheduleSave(); }} className="accent-sky-500" />
              내 보유 종목을 AI에 함께 알려 주기
            </label>
            <p className="text-[11.5px] text-gray-400">켜면 "내 종목 소식 찾아 줘"처럼 물을 수 있습니다. 종목 <b className="text-gray-200">이름·코드만</b> 보내고 수량·금액은 보내지 않습니다.{store && store.holdOn ? ` (지금 ${holdCount}종목)` : ''}</p>
          </div>
          <div className="rounded-lg border border-gray-700/60 bg-gray-900/30 px-3 py-2 space-y-1 text-[11.5px] text-gray-400">
            <p><b className="text-gray-200">저장</b> — 대화(자료)는 내 구글 Drive Index_Data 폴더의 ai_search_chats.json에만 저장됩니다(최근 50개, 별표로 고정한 자료는 맨 나중에 정리).</p>
            <p><b className="text-gray-200">무료 한도</b> — 내 키의 Gemini 무료 사용량 안에서 검색합니다. 다 쓰면 한국 시간 오후 4~5시쯤 다시 채워집니다.</p>
            <p><b className="text-gray-200">보낸 내용</b> — 질문은 구글로(다른 AI를 고르면 그 회사로) 보내집니다. 무료 등급에서는 그 회사의 서비스 개선에 쓰일 수 있으니 계좌번호·주민번호 같은 정보는 묻지 마세요.</p>
          </div>
        </div>
      )}

      {panel === 'list' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-3 py-2 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-1.5 bg-[#0b1120] border border-gray-700 rounded-md px-2">
              <Search size={13} className="text-gray-500 shrink-0" />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="자료 찾기(제목·내용)" className="flex-1 min-w-0 bg-transparent py-1.5 text-[12.5px] text-gray-100 outline-none" />
              {filter && <button onClick={() => setFilter('')} className="text-gray-500 hover:text-gray-200"><X size={13} /></button>}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
            {!ready && <p className="px-2 py-3 text-gray-500 text-[12.5px]">지난 대화를 불러오는 중…</p>}
            {ready && listRows.length === 0 && <p className="px-2 py-3 text-gray-500 text-[12.5px]">{filter ? '찾는 자료가 없습니다.' : '저장한 자료가 아직 없습니다 — 질문하면 대화가 자료로 남습니다.'}</p>}
            {listRows.map(c => (
              <div key={c.id} className={c.id === activeId ? 'rounded-lg border border-sky-700/60 bg-sky-900/20 px-2 py-1.5' : 'rounded-lg border border-gray-800 hover:border-gray-700 bg-gray-900/30 px-2 py-1.5'}>
                {renaming && renaming.id === c.id ? (
                  <div className="flex items-center gap-1.5">
                    <input autoFocus value={renaming.text} maxLength={60} onChange={e => setRenaming({ id: c.id, text: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { const t = renaming.text.trim(); if (t) updateChat(c.id, x => ({ ...x, title: t })); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); }}
                      className="flex-1 min-w-0 bg-[#0b1120] border border-gray-600 rounded px-2 py-1 text-[12.5px] text-gray-100 outline-none" />
                    <button onClick={() => { const t = renaming.text.trim(); if (t) updateChat(c.id, x => ({ ...x, title: t })); setRenaming(null); }} className="p-1 text-emerald-300 hover:text-emerald-200" title="이름 저장"><Check size={14} /></button>
                    <button onClick={() => setRenaming(null)} className="p-1 text-gray-400 hover:text-white" title="취소"><X size={14} /></button>
                  </div>
                ) : delAsk === c.id ? (
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-red-200 truncate">「{c.title}」을(를) 지울까요?</span>
                    <span className="flex gap-1 shrink-0">
                      <button onClick={() => removeChat(c.id)} className="px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white font-bold">지우기</button>
                      <button onClick={() => setDelAsk(null)} className="px-2 py-0.5 rounded border border-gray-600 text-gray-300">취소</button>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateChat(c.id, x => ({ ...x, pinned: !x.pinned }))} title={c.pinned ? '고정 풀기' : '고정(정리할 때 맨 나중에 지움)'} className={c.pinned ? 'p-1 text-amber-300' : 'p-1 text-gray-600 hover:text-amber-200'}><Star size={13} fill={c.pinned ? 'currentColor' : 'none'} /></button>
                    <button onClick={() => openChat(c.id)} className="flex-1 min-w-0 text-left">
                      <div className="text-[12.5px] text-gray-100 truncate">{c.title}</div>
                      <div className="text-[10.5px] text-gray-500">{timeLabel(c.updatedAt)} · 질문 {c.msgs.filter(m => m.role === 'user').length}개</div>
                    </button>
                    <button onClick={() => setRenaming({ id: c.id, text: c.title })} title="이름 바꾸기" className="p-1 text-gray-500 hover:text-gray-200"><Pencil size={13} /></button>
                    <button onClick={() => downloadChat(c)} title="내려받기(.md)" className="p-1 text-gray-500 hover:text-gray-200"><Download size={13} /></button>
                    <button onClick={() => setDelAsk(c.id)} title="지우기" className="p-1 text-gray-500 hover:text-red-300"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {panel === 'chat' && (<>
        <div ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
          className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3 text-[13px] text-gray-200 leading-relaxed">
          {!ready && <p className="text-gray-500 text-[12.5px]">지난 대화를 불러오는 중…</p>}
          {ready && msgs.length === 0 && (
            <div className="space-y-3 pt-2">
              <div className="text-center space-y-1">
                <div className="inline-flex text-sky-300"><ChatIcon size={28} /></div>
                <p className="text-gray-100 font-semibold">무엇이든 물어보세요</p>
                <p className="text-[12px] text-gray-400">구글 검색으로 최신 자료를 찾아 정리하고, 답은 <b className="text-sky-200">듣기</b>로 들을 수 있습니다.</p>
                <p className="text-[11.5px] text-gray-500">ChatGPT · Claude · Grok · Genspark 같은 다른 AI는 아래 <b className="text-gray-300">AI</b> 칸(내 키)이나 <b className="text-violet-200">내 구독으로 묻기</b>(키 없이)로 씁니다.</p>
              </div>
              {needKey && (
                <div className="rounded-lg border border-amber-600/50 bg-amber-900/15 px-3 py-2 text-[12px] text-amber-100 space-y-1">
                  {pickP
                    ? <p><b>{pickP.short}</b> 키가 아직 없습니다 — ⚙ 설정의 「다른 AI 연결」에서 넣어 주세요.</p>
                    : <p>먼저 <b>내 Gemini API 키</b>를 넣어 주세요(무료, 한 번만).</p>}
                  <p className="text-amber-100/80">키 없이 쓰려면 질문을 쓰고 아래 <b>내 구독으로 묻기</b>에서 쓰는 AI 이름을 누르세요.</p>
                  <button onClick={() => (pickP ? openAiSettings(pickP.id) : setPanel('settings'))} className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold text-[12px]">키 넣으러 가기</button>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 justify-center">
                {[...(store && store.holdOn ? [HOLD_ASK] : []), ...EXAMPLE_ASKS].map(q => (
                  <button key={q} disabled={!!running} onClick={() => (needKey ? setDraft(q) : ask(q))} className="px-2.5 py-1.5 rounded-full border border-gray-700 bg-gray-900/40 text-[12px] text-gray-300 hover:border-sky-600 hover:text-white disabled:opacity-40 transition">{q}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-sky-700/40 bg-sky-800/30 px-3 py-2 whitespace-pre-wrap break-words text-gray-100">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="rounded-2xl rounded-tl-sm border border-gray-700/50 bg-gray-900/50 px-3 py-2 space-y-2">
              {m.pending && !m.text && <p className="text-sky-200 animate-pulse">{apiOf(m) ? `${apiOf(m).short}에 묻는 중…` : '구글에서 자료를 찾는 중…'}</p>}
              {m.text && <MdView text={m.text} />}
              {m.pending && m.text && <span className="inline-block w-2 h-3.5 bg-sky-400/80 animate-pulse align-middle" />}
              {m.err === 'hand' && !m.text && handBox(m, i)}
              {m.err && m.err !== 'hand' && (
                <div className={m.err === 'stop' ? 'rounded-md border border-gray-600 bg-gray-800/40 px-2.5 py-1.5 text-[12px] text-gray-300' : 'rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[12px] text-red-200 space-y-1'}>
                  <p>{errText(m)}</p>
                  {m.msg && m.err !== 'stop' && <p className="text-[11px] text-red-300/70 break-all">{m.msg}</p>}
                  <div className="flex gap-1.5 flex-wrap">
                    {i === msgs.length - 1 && !running && <button onClick={() => retry(i)} className={chip}><RefreshCw size={12} />다시 묻기</button>}
                    {apiOf(m) ? (<>
                      {(m.err === 'needkey' || m.err === 'badkey' || m.err === 'credit') && <button onClick={() => openAiSettings(apiOf(m).id)} className={chip}><Lock size={12} />키 설정</button>}
                      {m.err === 'nomodel' && <button onClick={() => openAiSettings(apiOf(m).id)} className={chip}><Settings size={12} />모델 고르기</button>}
                    </>) : (<>
                      {(m.err === 'needkey' || m.err === 'badkey' || m.err === 'nokey' || m.err === 'credit' || m.err === 'quota0') && <button onClick={() => setPanel('settings')} className={chip}><Lock size={12} />키 설정</button>}
                      {(m.err === 'credit' || m.err === 'quota0' || m.err === 'rate') && <button onClick={() => setPanel('guide')} className={chip}><BookOpen size={12} />구독 크레딧 쓰는 법</button>}
                      {(m.err === 'credit' || m.err === 'quota0') && <a href="https://aistudio.google.com/projects" target="_blank" rel="noopener noreferrer" className={chip}><ExternalLink size={12} />AI Studio 열기</a>}
                      {(m.err === 'rate' || m.err === 'rate1m' || m.err === 'quota0') && <a href="https://ai.dev/rate-limit" target="_blank" rel="noopener noreferrer" className={chip}><ExternalLink size={12} />한도 보기</a>}
                    </>)}
                    {m.err !== 'stop' && i === msgs.length - 1 && !running && msgs[i - 1] && msgs[i - 1].role === 'user' && <button onClick={() => toHand(i)} className={chip}>내 구독 AI로 묻기</button>}
                  </div>
                </div>
              )}
              {!m.pending && m.text && (<>
                {m.sources && m.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    <span className="text-[11px] text-gray-500 py-0.5">출처</span>
                    {m.sources.map((s, k) => (
                      <a key={s.uri} href={s.uri} target="_blank" rel="noopener noreferrer" title={s.title || s.uri}
                        className="inline-flex items-center gap-1 max-w-[180px] rounded-full border border-gray-700 bg-gray-800/50 px-2 py-0.5 text-[11px] text-sky-200 hover:border-sky-600 hover:text-white">
                        <span className="text-gray-500">{k + 1}</span><span className="truncate">{hostOf(s)}</span>
                      </a>
                    ))}
                  </div>
                )}
                {m.html ? <SearchSuggest html={m.html} /> : (m.queries && m.queries.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[11px] text-gray-500 py-0.5">구글 검색어</span>
                    {m.queries.map(q => (
                      <a key={q} href={`https://www.google.com/search?q=${encodeURIComponent(q)}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] text-gray-300 hover:text-white hover:border-gray-500">{q}</a>
                    ))}
                  </div>
                ))}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  {speakCtl(m)}
                  <button onClick={() => copyText(`a:${m.id}`, answerCopy(m))} title="답 복사(출처 포함)" className={chip}>
                    {copied === `a:${m.id}` ? <><Check size={12} />복사됨</> : copied === `fail:a:${m.id}` ? '복사 실패' : <><CopyIcon />복사</>}
                  </button>
                  {copied === `nospeech:${m.id}` && <span className="text-[11px] text-amber-300/90">읽을 글이 없거나 이 브라우저가 소리 읽기를 못 합니다</span>}
                  <span className="ml-auto text-[10.5px] text-gray-600">{timeLabel(m.at)}{m.model ? ` · ${m.model}` : ''}</span>
                </div>
              </>)}
            </div>
          )))}
          {active && lastMsg && lastMsg.role === 'model' && !lastMsg.pending && !lastMsg.err && !running && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK_ASKS.map(a => <button key={a.label} onClick={() => ask(a.text)} className="px-2.5 py-1 rounded-full border border-sky-800/60 bg-sky-900/20 text-[11.5px] text-sky-200 hover:bg-sky-900/40">{a.label}</button>)}
              <button onClick={() => copyText(`c:${active.id}`, chatToMarkdown(active))} className="px-2.5 py-1 rounded-full border border-gray-700 text-[11.5px] text-gray-300 hover:text-white">{copied === `c:${active.id}` ? '대화 전체 복사됨' : '대화 전체 복사'}</button>
              <button onClick={() => downloadChat(active)} className="px-2.5 py-1 rounded-full border border-gray-700 text-[11.5px] text-gray-300 hover:text-white inline-flex items-center gap-1"><Download size={11} />내려받기</button>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-800 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[11.5px]">
            <span className="text-gray-500 shrink-0">AI</span>
            <select value={pickP ? pickP.id : GEMINI_PICK} disabled={!store || viewingAs} onChange={e => setAi({ pick: e.target.value })} title="물어볼 AI — 다른 AI는 ⚙ 설정의 「다른 AI 연결」에 내 키를 넣으면 씁니다"
              className="min-w-0 max-w-[58%] bg-[#0b1120] border border-gray-700 rounded-md px-1.5 py-1 text-[11.5px] text-gray-100 outline-none">
              <option value={GEMINI_PICK}>Gemini · 구글 검색</option>
              {AI_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.short} · {AI_COST_LABEL[p.cost]}{aiState.loaded && !aiState.keys[p.id] ? ' (키 필요)' : ''}</option>)}
            </select>
            {pickP && (pickModels.length > 0 && pickModels.some(x => x.id === pickModelId) ? (
              <select value={pickModelId} onChange={e => setAiModel(pickP.id, e.target.value)} title="모델" className="flex-1 min-w-0 bg-[#0b1120] border border-gray-700 rounded-md px-1.5 py-1 text-[11.5px] text-gray-100 outline-none">
                {pickModels.map(x => <option key={x.id} value={x.id}>{x.free ? '무료 · ' : ''}{x.id}</option>)}
              </select>
            ) : (
              <button onClick={() => openAiSettings(pickP.id)} title="모델·키 설정" className="flex-1 min-w-0 truncate text-left text-gray-400 hover:text-white font-mono">{pickKey ? pickModelId : '키 넣기 →'}</button>
            ))}
            {pickP && pickP.web && pickKey && (
              <label className="shrink-0 flex items-center gap-1 cursor-pointer text-gray-400" title="웹 검색으로 최신 자료 찾기(검색 요금이 더 듭니다)">
                <input type="checkbox" checked={!!prefs.web[pickP.id]} onChange={() => setAiWeb(pickP.id, !prefs.web[pickP.id])} className="accent-violet-500" />웹
              </label>
            )}
          </div>
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} rows={2} value={draft} maxLength={4000} disabled={!ready}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229 || isCoarse()) return;
                e.preventDefault();
                if (running) return;
                if (needKey) { if (draft.trim()) flashNote('키가 없습니다 — 아래 「내 구독으로 묻기」에서 AI 이름을 누르거나 ⚙ 설정에서 키를 넣어 주세요'); return; }
                ask(draft);
              }}
              placeholder={needKey ? '질문을 쓰고 아래 「내 구독으로 묻기」를 누르거나, ⚙ 설정에서 키를 넣어 주세요' : (active ? '이어서 물어보기…' : '검색할 내용을 물어보세요 (예: 오늘 코스피 마감)')}
              className="flex-1 min-w-0 resize-none bg-[#0b1120] border border-gray-600 focus:border-sky-500 rounded-xl px-3 py-2 text-[13px] text-gray-100 outline-none max-h-32" />
            {running ? (
              <button onClick={stopAsk} title="답 받기 멈추기" className="h-10 px-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold text-[12px] inline-flex items-center gap-1 shrink-0"><StopIcon />멈춤</button>
            ) : (
              <button onClick={() => ask(draft)} disabled={!ready || needKey || !draft.trim()} title={pickP ? `${pickP.short}에 묻기` : '검색'} className="h-10 px-3 rounded-xl bg-sky-700 hover:bg-sky-600 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold text-[12px] inline-flex items-center gap-1 shrink-0"><SendIcon />{pickP ? '묻기' : '검색'}</button>
            )}
          </div>
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5">
            <span className="shrink-0 text-[11px] text-violet-200/90" title="API 키 없이 — 그 AI 사이트를 내 계정(구독 그대로)으로 열고 질문을 넘깁니다. 답은 복사해 「답 붙여넣기」.">내 구독으로 묻기</span>
            {canShare() && isCoarse() && <button disabled={!ready || !!running || !draft.trim()} onClick={() => askHand(HAND_SHARE, draft)} title="휴대폰에 깔린 AI 앱으로 질문 보내기" className={handChip}>앱으로 공유</button>}
            {AI_HANDS.map(h => (
              <button key={h.id} disabled={!ready || !!running || !draft.trim()} onClick={() => askHand(h.id, draft)} title={draft.trim() ? `${h.label}(${h.sub})을 내 계정으로 열고 질문을 넘깁니다` : '먼저 질문을 써 주세요'} className={handChip}>{h.label}</button>
            ))}
          </div>
          {handNote && <p className="text-[11px] text-violet-200">{handNote}</p>}
          <div className="flex items-center gap-2 text-[10.5px] text-gray-500 min-h-[14px]">
            {store && store.holdOn && <span className="text-sky-300/80">보유 종목 {holdCount}개 함께 보냄</span>}
            {loadInfo.loaded && !loadInfo.canSave && <span className="text-amber-300/80 truncate">{loadInfo.error ? `${loadInfo.error} — 이번 대화는 저장되지 않습니다` : '이번 대화는 저장되지 않습니다'}</span>}
            {saveInfo.error ? <span className="text-red-300 truncate">{saveInfo.error}</span> : (saveInfo.at && <span>Drive 저장 {timeLabel(saveInfo.at)}</span>)}
            <span className="ml-auto shrink-0">{isCoarse() ? '' : 'Enter 보내기 · Shift+Enter 줄바꿈'}</span>
          </div>
        </div>
      </>)}
    </div>
  );
}
