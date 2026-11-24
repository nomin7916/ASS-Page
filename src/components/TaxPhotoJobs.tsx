// @ts-nocheck
// 과표 계산기 '붙여넣기' 안의 「📷 사진 맡기기 (Claude)」 — 관리자 전용(2026-11-24). 흐름은 api/_aiTax.ts 머리 주석.
// 사진을 줄여(JPEG) /api/ai-tax로 맡기면 서버가 Claude 예약 작업을 부르고, 끝난 글은 onText로 '붙여넣기' 칸에 들어간다.
// ⚠️ 여기서는 저장하지 않는다 — 사용자가 미리 보기를 보고 「넣기」를 눌러야 계산기에 들어간다(작업은 데이터에 쓰지 않는다).
// ⚠️ 알림(notify)을 쓰지 않는다 — 진행·오류는 이 칸 안의 한 줄로만(알림 최소화 정책).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getTodayKST } from '../hooks/useMarketCalendar';
import {
  IMG_LIMIT, POLL_MS, SHRINK_STEPS, ROUTINE_NAME, ROUTINES_URL, ROUTINE_PROMPT, SITE_ORIGIN,
  jobErrText, jobState, jobPending, canRefire, autoPull, ageText, fitScale,
} from '../taxPhotoJob';

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

export default function TaxPhotoJobs({ code, name, canAuto, onText }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [setup, setSetup] = useState(false);
  const [cUrl, setCUrl] = useState('');
  const [cTok, setCTok] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const fileRef = useRef(null);
  const openedAt = useRef(Date.now());
  const pulled = useRef(new Set());

  const load = useCallback(async () => {
    const r = await callApi('/api/ai-tax?op=status');
    if (!r.ok) { setMsg(r.status === 0 ? '사이트 서버에 닿지 못했습니다' : jobErrText(r.j.error)); return; }
    setSt(r.j);
  }, []);
  useEffect(() => { load(); }, [load]);

  const mine = (st?.jobs || []).filter(j => j.code === code);
  const pending = mine.some(jobPending);
  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  const pull = useCallback(async (j) => {
    const r = await callApi(`/api/ai-tax?op=job&rid=${encodeURIComponent(j.rid)}`);
    if (!r.ok) { setMsg(jobErrText(r.j.error)); return; }
    if (!r.j.text) { setMsg('Claude가 돌려준 글이 비어 있습니다'); return; }
    onText(r.j.text);
    setMsg(r.j.job?.note ? `Claude 메모: ${r.j.job.note}` : '');
  }, [onText]);

  useEffect(() => {
    if (!canAuto) return;
    const j = mine.find(x => autoPull(x, openedAt.current) && !pulled.current.has(x.rid));
    if (j) { pulled.current.add(j.rid); pull(j); }
  }, [st, canAuto]);

  const send = async (file) => {
    if (!file) return;
    setMsg('');
    setBusy('send');
    try {
      const img = await photoToJpegB64(file);
      if (!img) { setMsg('사진을 열거나 줄이지 못했습니다 — JPEG·PNG 사진으로 다시 해 주세요'); return; }
      const r = await callApi('/api/ai-tax?op=job', { code, name, year: Number(getTodayKST().slice(0, 4)), img });
      if (!r.ok) {
        setMsg(jobErrText(r.j.error));
        if (r.j.error === 'noconn') setSetup(true);
        return;
      }
      if (!r.j.fired) setMsg(`사진은 맡겼지만 Claude를 부르지 못했습니다 — ${jobErrText(r.j.err)}`);
      await load();
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
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

  const now = Date.now();
  const connected = !!st?.connected;

  return (
    <div className="border border-violet-800/40 rounded px-2 py-1.5 space-y-1.5 max-w-[720px] bg-violet-950/10">
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => send(e.target.files && e.target.files[0])}
        />
        <button
          disabled={!!busy || !st}
          onClick={() => (connected ? fileRef.current && fileRef.current.click() : setSetup(true))}
          className="px-2 py-0.5 rounded border border-violet-500 text-violet-100 bg-violet-800/40 hover:bg-violet-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
          title="주문내역 사진을 Claude(관리자 구독)에게 맡깁니다 — 읽은 글이 아래 칸에 들어오면 미리 보기를 보고 「넣기」를 누르세요"
        >
          {busy === 'send' ? '사진 보내는 중…' : '📷 사진 맡기기 (Claude)'}
        </button>
        <span className="text-gray-500">관리자 전용 · Claude가 날짜·매수/매도·수량·평균단가를 읽고 과표기준가도 찾아봅니다(1~3분)</span>
        <button
          onClick={() => setSetup(!setup)}
          className={'ml-auto px-1.5 py-0.5 rounded border ' + (connected ? 'border-gray-700/60 text-gray-400 hover:text-gray-200' : 'border-amber-600/60 text-amber-300 hover:text-amber-200')}
        >
          ⚙ Claude 연결{connected ? ' · 됨' : ' · 안 됨'}
        </button>
      </div>

      {setup && (
        <div className="text-[10px] text-gray-400 space-y-1 border-t border-violet-900/40 pt-1.5">
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
              className="flex-1 min-w-[260px] bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-200 focus:outline-none focus:border-violet-500"
            />
            <input
              value={cTok}
              onChange={e => setCTok(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder="토큰 (sk-ant-…)"
              className="w-[200px] bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-200 focus:outline-none focus:border-violet-500"
            />
            <button
              disabled={busy === 'connect' || !cUrl.trim() || !cTok.trim()}
              onClick={connect}
              className="px-2 py-0.5 rounded border border-violet-500 text-violet-100 bg-violet-800/40 hover:bg-violet-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'connect' ? '시험 중…' : '연결 (시험으로 한 번 부름)'}
            </button>
            {connected && st?.src === 'store' && (
              <button onClick={disconnect} className="px-1.5 py-0.5 rounded border border-gray-700/60 text-gray-400 hover:text-rose-300">연결 끊기</button>
            )}
          </div>
        </div>
      )}

      {msg && <div className="text-[10px] text-amber-300">{msg}</div>}

      {mine.length > 0 && (
        <div className="space-y-0.5">
          {mine.slice(0, 5).map(j => {
            const s = jobState(j);
            return (
              <div key={j.rid} className="flex items-center gap-2 flex-wrap text-[10px]">
                <span className={s.cls}>{s.label}</span>
                <span className="text-gray-500">{ageText(now - j.at)} 맡김{j.fn > 1 ? ` · ${j.fn}번 부름` : ''}</span>
                {j.fe && <span className="text-rose-400/80">{jobErrText(j.fe)}</span>}
                {j.st === 'err' && j.why && <span className="text-rose-400/80">{j.why}</span>}
                {j.st === 'done' && j.note && <span className="text-gray-400 truncate max-w-[360px]" title={j.note}>메모: {j.note}</span>}
                {j.st === 'done' && j.hasText && (
                  <button onClick={() => pull(j)} className="px-1.5 py-0 rounded border border-emerald-700/60 text-emerald-300 hover:text-emerald-200">가져오기</button>
                )}
                {canRefire(j, now) && (
                  <button disabled={busy === j.rid} onClick={() => refire(j)} className="px-1.5 py-0 rounded border border-amber-700/60 text-amber-300 hover:text-amber-200 disabled:opacity-40">다시 부르기</button>
                )}
                {j.ses && <a href={j.ses} target="_blank" rel="noopener noreferrer" className="text-sky-400/80 underline">Claude 작업 보기</a>}
                <button disabled={busy === j.rid} onClick={() => drop(j)} className="text-gray-600 hover:text-rose-300 disabled:opacity-40">지우기</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
