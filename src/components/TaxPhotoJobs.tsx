// @ts-nocheck
// 분배금 현황 「과표 계산」 머리줄의 「📷 사진 맡기기」 칸 — 관리자 전용(2026-11-24 · 2026-11-25 머리줄로 옮김). 흐름은 api/_aiTax.ts 머리 주석.
// 사진을 줄여(JPEG) 이 계좌의 국내 ETF 목록(cands)과 함께 /api/ai-tax로 맡기면 서버가 Claude 예약 작업을 부르고,
// Claude가 사진에서 종목을 찾아 돌려준 글은 onApply가 종목마다 계산기에 바로 넣는다(「되돌리기」로 넣기 전으로).
// ⚠️ 칸이 닫혀 있어도(open=false) 이 부품은 떠 있다 — 끝난 일을 스스로 넣고(seen) 결과를 보이려 칸을 연다(onOpen).
// ⚠️ 알림(notify)을 쓰지 않는다 — 진행·오류는 이 칸 안의 한 줄로만(알림 최소화 정책).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera } from 'lucide-react';
import { getTodayKST } from '../hooks/useMarketCalendar';
import {
  IMG_LIMIT, POLL_MS, SHRINK_STEPS, ROUTINE_NAME, ROUTINES_URL, ROUTINE_PROMPT, SITE_ORIGIN,
  jobErrText, jobState, jobPending, canRefire, autoPull, ageText, fitScale,
} from '../taxPhotoJob';
import { PASTE_PHOTO_ACCEPT } from '../taxCalcPaste';

async function photoToJpegB64(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    for (const [max, q] of SHRINK_STEPS) {
      const s = fitScale(img.naturalWidth, img.naturalHeight, max);
      if (!s) return '';
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const b64 = c.toDataURL('image/jpeg', q).split(',')[1] || '';
      if (b64 && b64.length <= IMG_LIMIT) return b64;
    }
    return '';
  } catch {
    return '';
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function callApi(path, body) {
  try {
    const res = await fetch(path, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let j = {};
    try { j = await res.json(); } catch { j = {}; }
    return { ok: res.ok, status: res.status, j };
  } catch {
    return { ok: false, status: 0, j: { error: 'net' } };
  }
}

export default function TaxPhotoJobs({ cands, open, onOpen, onApply, onBadge }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [setup, setSetup] = useState(false);
  const [cUrl, setCUrl] = useState('');
  const [cTok, setCTok] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [results, setResults] = useState({});   // rid → { lines:[글], undo:fn|null, undone:bool } — 이 화면에서 넣은 것(세션 메모리)
  const fileRef = useRef(null);
  const pulled = useRef(new Set());

  const load = useCallback(async () => {
    const r = await callApi('/api/ai-tax?op=status');
    if (!r.ok) { setMsg(r.status === 0 ? '사이트 서버에 닿지 못했습니다' : jobErrText(r.j.error)); return; }
    setSt(r.j);
  }, []);
  useEffect(() => { load(); }, [load]);

  const jobs = st?.jobs || [];
  const pending = jobs.some(jobPending);
  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  const waiting = jobs.filter(jobPending).length;
  useEffect(() => { if (onBadge) onBadge({ waiting, connected: !!st?.connected }); }, [waiting, st?.connected]);

  // 끝난 글 → 종목마다 계산기에 넣기 → 서버에 seen(다시 넣지 않게)
  const pull = useCallback(async (j) => {
    const r = await callApi(`/api/ai-tax?op=job&rid=${encodeURIComponent(j.rid)}`);
    if (!r.ok) { setMsg(jobErrText(r.j.error)); return; }
    if (!r.j.text) { setMsg('Claude가 돌려준 글이 비어 있습니다'); return; }
    const res = onApply(r.j.text, j) || { lines: [], undo: null };
    setResults(prev => ({ ...prev, [j.rid]: { lines: res.lines || [], undo: res.undo || null, undone: false } }));
    await callApi(`/api/ai-tax?op=seen&rid=${encodeURIComponent(j.rid)}`, {});
    if (onOpen) onOpen();
    load();
  }, [onApply, onOpen, load]);

  useEffect(() => {
    const j = jobs.find(x => autoPull(x) && !pulled.current.has(x.rid));
    if (j) { pulled.current.add(j.rid); pull(j); }
  }, [st]);

  const undo = (rid) => {
    const r = results[rid];
    if (!r || !r.undo) return;
    r.undo();
    setResults(prev => ({ ...prev, [rid]: { ...prev[rid], undo: null, undone: true } }));
  };

  const send = async (fileList) => {
    const files = Array.from(fileList || []);
    if (fileRef.current) fileRef.current.value = '';
    if (files.length === 0) return;
    setMsg('');
    setBusy('send');
    const notes = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setBusy(`send:${i + 1}/${files.length}`);
        const img = await photoToJpegB64(files[i]);
        if (!img) { notes.push(`${i + 1}번째 사진을 열거나 줄이지 못했습니다(JPEG·PNG)`); continue; }
        const r = await callApi('/api/ai-tax?op=job', { code: '', cands, year: Number(getTodayKST().slice(0, 4)), img });
        if (!r.ok) {
          if (r.j.error === 'noconn') setSetup(true);
          notes.push(r.j.error === 'busy' || r.j.error === 'day'
            ? `${files.length - i}장은 맡기지 못했습니다 — ${jobErrText(r.j.error)}`
            : `${i + 1}번째 사진 — ${jobErrText(r.j.error)}`);
          if (r.j.error === 'busy' || r.j.error === 'day' || r.j.error === 'noconn') break;
          continue;
        }
        if (!r.j.fired) notes.push(`${i + 1}번째 사진은 맡겼지만 Claude를 부르지 못했습니다 — ${jobErrText(r.j.err)}`);
      }
      setMsg(notes.join(' · '));
      await load();
    } finally {
      setBusy('');
    }
  };

  const refire = async (j) => {
    setBusy(j.rid);
    const r = await callApi(`/api/ai-tax?op=fire&rid=${encodeURIComponent(j.rid)}`, {});
    setBusy('');
    if (!r.ok) setMsg(jobErrText(r.j.error));
    else if (!r.j.fired) setMsg(`Claude를 부르지 못했습니다 — ${jobErrText(r.j.err)}`);
    else setMsg('');
    load();
  };

  const drop = async (j) => {
    setBusy(j.rid);
    await callApi(`/api/ai-tax?op=del&rid=${encodeURIComponent(j.rid)}`, {});
    setBusy('');
    setResults(prev => { const n = { ...prev }; delete n[j.rid]; return n; });
    load();
  };

  const connect = async () => {
    setMsg('');
    setBusy('connect');
    const r = await callApi('/api/ai-tax?op=connect', { url: cUrl.trim(), token: cTok.trim() });
    setBusy('');
    if (!r.ok) { setMsg(jobErrText(r.j.error)); return; }
    if (!r.j.ok) { setMsg(`연결하지 못했습니다 — ${jobErrText(r.j.err)}`); return; }
    setCTok('');
    setSetup(false);
    setMsg('연결했습니다 — 시험으로 한 번 불렀습니다(claude.ai의 작업 목록에서 "연결 시험" 실행을 볼 수 있습니다)');
    load();
  };

  const disconnect = async () => {
    setBusy('connect');
    const r = await callApi('/api/ai-tax?op=disconnect', {});
    setBusy('');
    if (!r.ok) setMsg(jobErrText(r.j.error));
    load();
  };

  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(ROUTINE_PROMPT); setPromptCopied(true); } catch { setPromptCopied(false); }
  };

  if (!open) return null;

  const now = Date.now();
  const connected = !!st?.connected;
  const sending = busy.startsWith('send');

  return (
    <div className="px-3 py-2 bg-violet-950/20 border-b border-violet-800/40 space-y-1.5 text-[10px]">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept={PASTE_PHOTO_ACCEPT}
          multiple
          className="hidden"
          onChange={e => send(e.target.files)}
        />
        <button
          disabled={!!busy || !st}
          onClick={() => (connected ? fileRef.current && fileRef.current.click() : setSetup(true))}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-violet-500 text-violet-100 bg-violet-800/40 hover:bg-violet-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
          title="주문내역 사진 고르기 — 고르면 Claude가 어느 ETF인지 찾아 매매 수량·단가·과표기준가를 그 종목의 계산기에 넣습니다"
          aria-label="주문내역 사진 고르기"
        >
          <Camera size={14} />{sending ? ` 보내는 중… ${busy.slice(5)}` : ''}
        </button>
        <span className="text-gray-500">Claude가 사진에서 ETF를 찾아 매매 수량·단가·과표기준가를 그 종목 계산기에 바로 넣습니다(1~3분 · 여러 장 가능)</span>
        <button
          onClick={() => setSetup(!setup)}
          className={'ml-auto px-1.5 py-0.5 rounded border ' + (connected ? 'border-gray-700/60 text-gray-400 hover:text-gray-200' : 'border-amber-600/60 text-amber-300 hover:text-amber-200')}
        >
          ⚙ Claude 연결{connected ? ' · 됨' : ' · 안 됨'}
        </button>
      </div>

      {setup && (
        <div className="text-gray-400 space-y-1 border-t border-violet-900/40 pt-1.5">
          <div>① <a href={ROUTINES_URL} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline">claude.ai/code/routines</a> → 「새 작업」 · 이름 <span className="text-gray-200">{ROUTINE_NAME}</span> · 저장소 ASS-Page</div>
          <div className="flex items-center gap-2 flex-wrap">
            ② 지침 칸에 붙여 넣기:
            <button onClick={copyPrompt} className="px-1.5 py-0.5 rounded border border-violet-700/60 text-violet-300 hover:text-violet-200">
              {promptCopied ? '✓ 지침 복사됨' : '지침 복사'}
            </button>
            <span className="text-gray-500">환경은 {SITE_ORIGIN.replace('https://', '')} 에 닿을 수 있어야 합니다</span>
          </div>
          <div>③ 트리거에 「API」를 더하고 저장 → 편집에서 토큰 생성 → 실행 URL과 토큰을 아래에 붙여 넣기(토큰은 채팅에 적지 마세요)</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              value={cUrl}
              onChange={e => setCUrl(e.target.value)}
              placeholder="실행 URL (https://api.anthropic.com/v1/claude_code/routines/trig_…/fire)"
              className="flex-1 min-w-[260px] bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-violet-500"
            />
            <input
              value={cTok}
              onChange={e => setCTok(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder="토큰 (sk-ant-…)"
              className="w-[200px] bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-violet-500"
            />
            <button
              disabled={busy === 'connect' || !cUrl.trim() || !cTok.trim()}
              onClick={connect}
              className="px-2 py-0.5 rounded border border-violet-500 text-violet-100 bg-violet-800/40 hover:bg-violet-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'connect' ? '시험 중…' : '연결 (시험으로 한 번 부름)'}
            </button>
            {(!cUrl.trim() || !cTok.trim()) && (
              <span className="text-amber-300">{!cUrl.trim() ? '← 실행 URL 칸이 비어 있습니다' : '← 토큰 칸이 비어 있습니다'}</span>
            )}
            {connected && st?.src === 'store' && (
              <button onClick={disconnect} className="px-1.5 py-0.5 rounded border border-gray-700/60 text-gray-400 hover:text-rose-300">연결 끊기</button>
            )}
          </div>
        </div>
      )}

      {msg && <div className="text-amber-300">{msg}</div>}

      {jobs.length > 0 && (
        <div className="space-y-0.5">
          {jobs.slice(0, 8).map(j => {
            const s = jobState(j);
            const res = results[j.rid];
            return (
              <div key={j.rid} className="space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={s.cls}>{j.st === 'done' && j.ap ? '넣음' : s.label}</span>
                  <span className="text-gray-500">{ageText(now - j.at)} 맡김{j.fn > 1 ? ` · ${j.fn}번 부름` : ''}{j.code ? ` · ${j.name || j.code}` : ''}</span>
                  {j.fe && <span className="text-rose-400/80">{jobErrText(j.fe)}</span>}
                  {j.st === 'err' && j.why && <span className="text-rose-400/80">{j.why}</span>}
                  {j.st === 'done' && j.note && <span className="text-gray-400 truncate max-w-[420px]" title={j.note}>Claude 메모: {j.note}</span>}
                  {j.st === 'done' && j.hasText && !res && (
                    <button onClick={() => pull(j)} className="px-1.5 py-0 rounded border border-emerald-700/60 text-emerald-300 hover:text-emerald-200">{j.ap ? '다시 넣기' : '넣기'}</button>
                  )}
                  {res && res.undo && (
                    <button onClick={() => undo(j.rid)} className="px-1.5 py-0 rounded border border-amber-700/60 text-amber-300 hover:text-amber-200">되돌리기</button>
                  )}
                  {res && res.undone && <span className="text-gray-500">되돌렸습니다</span>}
                  {canRefire(j, now) && (
                    <button disabled={busy === j.rid} onClick={() => refire(j)} className="px-1.5 py-0 rounded border border-amber-700/60 text-amber-300 hover:text-amber-200 disabled:opacity-40">다시 부르기</button>
                  )}
                  {j.ses && <a href={j.ses} target="_blank" rel="noopener noreferrer" className="text-sky-400/80 underline">Claude 작업 보기</a>}
                  <button disabled={busy === j.rid} onClick={() => drop(j)} className="text-gray-600 hover:text-rose-300 disabled:opacity-40">지우기</button>
                </div>
                {res && res.lines.length > 0 && (
                  <div className="pl-3 text-emerald-300/90 space-y-0.5">
                    {res.lines.map((t, i) => <div key={i}>· {t}</div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
