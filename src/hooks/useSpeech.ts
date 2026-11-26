// @ts-nocheck
// 「AI 검색」 듣기 — 브라우저 말하기(speechSynthesis, 키·비용 없음)로 답 글을 문장 조각마다 이어 읽는다.
// 조각은 src/aiSearch.ts speechChunks(마크다운 기호·주소를 빼고 짧게 나눔 — 크롬은 긴 말하기를 15초쯤에서 끊는다).
// 멈춤 = 지금 조각을 끊고 자리를 기억 → 이어 듣기 = 그 조각부터 다시(안드로이드·크롬의 pause()는 믿을 수 없다).
// ⚠️ 처음 말하기는 누른 그 자리(클릭 처리 안)에서 바로 불러야 한다 — iOS는 그렇지 않으면 소리를 내지 않는다.
import { useEffect, useRef, useState } from 'react';
import { speechChunks } from '../aiSearch';

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null);

export function useSpeech() {
  const supported = !!synth();
  const [voices, setVoices] = useState([]);
  const [st, setSt] = useState({ id: null, idx: 0, total: 0, paused: false });
  const q = useRef({ id: null, chunks: [], idx: 0, token: 0, rate: 1, voiceURI: '' });

  useEffect(() => {
    const s = synth();
    if (!s) return undefined;
    const load = () => {
      try { setVoices(s.getVoices().filter(v => /^ko/i.test(v.lang || ''))); } catch { /* 목소리 목록 없음 */ }
    };
    load();
    try { s.addEventListener('voiceschanged', load); } catch { /* 옛 브라우저 */ }
    return () => {
      try { s.removeEventListener('voiceschanged', load); } catch { /* 옛 브라우저 */ }
      q.current.token += 1;
      try { s.cancel(); } catch { /* 이미 멈춤 */ }
    };
  }, []);

  const pickVoice = (uri) => {
    const s = synth();
    if (!s) return null;
    let list = [];
    try { list = s.getVoices().filter(v => /^ko/i.test(v.lang || '')); } catch { list = []; }
    return list.find(v => v.voiceURI === uri) || list.find(v => v.default) || list[0] || null;
  };

  const speakAt = (token) => {
    const s = synth();
    const cur = q.current;
    if (!s || token !== cur.token) return;
    if (cur.idx >= cur.chunks.length) {
      setSt({ id: null, idx: 0, total: 0, paused: false });
      cur.id = null;
      return;
    }
    const u = new window.SpeechSynthesisUtterance(cur.chunks[cur.idx]);
    u.lang = 'ko-KR';
    const v = pickVoice(cur.voiceURI);
    if (v) u.voice = v;
    u.rate = cur.rate;
    u.onend = () => { if (token !== q.current.token) return; q.current.idx += 1; speakAt(token); };
    u.onerror = (e) => {
      if (token !== q.current.token) return;
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      q.current.idx += 1;
      speakAt(token);
    };
    setSt({ id: cur.id, idx: cur.idx, total: cur.chunks.length, paused: false });
    try { s.speak(u); } catch { setSt({ id: null, idx: 0, total: 0, paused: false }); }
  };

  const play = (id, text, { rate = 1, voiceURI = '' } = {}) => {
    const s = synth();
    if (!s) return false;
    const chunks = speechChunks(text);
    if (chunks.length === 0) return false;
    q.current.token += 1;
    try { s.cancel(); } catch { /* 이미 멈춤 */ }
    q.current = { id, chunks, idx: 0, token: q.current.token, rate, voiceURI };
    speakAt(q.current.token);
    return true;
  };
  const pause = () => {
    const s = synth();
    if (!s || q.current.id == null) return;
    q.current.token += 1;
    try { s.cancel(); } catch { /* 이미 멈춤 */ }
    setSt({ id: q.current.id, idx: q.current.idx, total: q.current.chunks.length, paused: true });
  };
  const resume = (opts = null) => {
    if (q.current.id == null) return;
    if (opts) { if (opts.rate) q.current.rate = opts.rate; if (opts.voiceURI != null) q.current.voiceURI = opts.voiceURI; }
    q.current.token += 1;
    speakAt(q.current.token);
  };
  const stop = () => {
    const s = synth();
    q.current.token += 1;
    q.current.id = null;
    try { if (s) s.cancel(); } catch { /* 이미 멈춤 */ }
    setSt({ id: null, idx: 0, total: 0, paused: false });
  };
  // 앞·뒤 문장으로(듣는 중·멈춤 중 모두)
  const skip = (d) => {
    const cur = q.current;
    if (cur.id == null) return;
    cur.idx = Math.max(0, Math.min(cur.chunks.length - 1, cur.idx + d));
    cur.token += 1;
    const s = synth();
    try { if (s) s.cancel(); } catch { /* 이미 멈춤 */ }
    speakAt(cur.token);
  };

  return { supported, voices, speaking: st, play, pause, resume, stop, skip };
}
