// @ts-nocheck
// 인트로 영상 — 로그인·PIN 뒤 계좌 로딩 중 전체 화면 재생. 로딩 표시는 가운데 팝업 대신
// 좌측 상단 진행 막대(클릭 = 영상 정지 + 대시보드)와 우측 상단 작은 글씨로 한다. 바탕은 검정 · 고정폭 글씨, 강조색은 지금 영상의 색.
// 처음 영상 = pickIntroVideo(기본 최신). 막대 아래 작은 버튼(INTRO_VIDEOS 수만큼)으로 다른 영상을 고르면 처음부터 튼다.
// Enter·Esc·영상 끝 → onClose(로딩이 남았으면 App이 기존 로딩 팝업을 띄운다), 막대 클릭 → onSkipToDashboard.
import React, { useEffect, useRef, useState } from 'react';
import { Z } from '../design';
import { INTRO_VIDEOS, INTRO_VOLUME, INTRO_START_TIMEOUT_MS, pickIntroVideo, bootProgressRatio, ratchetProgress, introStatusText, introKeyAction } from '../introVideo';

const C = {
  bg: '#060606',
  ink: '#F3F1EF',
  mute: '#8A8990',
  dim: '#5E5D63',
  panel: 'rgba(10, 9, 11, 0.72)',
  edge: 'rgba(243, 241, 239, 0.08)',
  track: 'rgba(243, 241, 239, 0.10)',
};

const KEYFRAMES = `
@keyframes introFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes introShimmer { 0% { transform: translateX(-120%) } 100% { transform: translateX(320%) } }
@keyframes introReady { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }
`;

export default function IntroVideoOverlay({ histPhase = 'loading', histProgress = { done: 0, total: 0 }, histPartial = false, onClose, onSkipToDashboard }) {
  const [video, setVideo] = useState(() => pickIntroVideo());
  const videoRef = useRef(null);
  const mountAtRef = useRef(Date.now());
  const startedRef = useRef(false);
  const closedRef = useRef(false);
  const ratioRef = useRef(0);
  const cbRef = useRef({ onClose, onSkipToDashboard });
  cbRef.current = { onClose, onSkipToDashboard };
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [hover, setHover] = useState(false);

  const finish = (kind) => {
    if (closedRef.current) return;
    closedRef.current = true;
    try { videoRef.current?.pause(); } catch {}
    const cb = kind === 'dashboard' ? cbRef.current.onSkipToDashboard : cbRef.current.onClose;
    cb?.();
  };

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // 처음 뜰 때 + 버튼으로 다른 영상을 고를 때마다 그 영상을 처음부터 튼다. 주소가 바뀌면 앞 영상의 play()는
  // 중단 오류로 끝나므로 alive로 무시한다(그걸 자동 재생 차단으로 보고 닫으면 안 된다).
  useEffect(() => {
    const v = videoRef.current;
    let alive = true;
    if (v && !closedRef.current) {
      v.volume = INTRO_VOLUME;
      v.play().catch(() => {
        if (!alive || closedRef.current) return;
        v.muted = true;
        setMuted(true);
        v.play().catch(() => { if (alive) finish('close'); });
      });
    }
    return () => { alive = false; };
  }, [video.src]);

  const chooseVideo = (next) => {
    if (closedRef.current || next.id === video.id) return;
    setVideo(next);
  };

  useEffect(() => {
    const v = videoRef.current;
    let alive = true;
    const startTimer = setTimeout(() => { if (alive && !startedRef.current) finish('close'); }, INTRO_START_TIMEOUT_MS);
    const tick = setInterval(() => setElapsed((Date.now() - mountAtRef.current) / 1000), 250);
    const onKey = (e) => {
      if (introKeyAction(e, Date.now() - mountAtRef.current) !== 'skip') return;
      e.preventDefault();
      e.stopPropagation();
      finish('close');
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      alive = false;
      clearTimeout(startTimer);
      clearInterval(tick);
      window.removeEventListener('keydown', onKey, true);
      try { v?.pause(); } catch {}
    };
  }, []);

  ratioRef.current = ratchetProgress(ratioRef.current, bootProgressRatio(histPhase, histProgress, elapsed));
  const pct = Math.round(ratioRef.current * 100);
  const ready = histPhase === 'settled';
  const status = introStatusText(histPhase, histProgress, histPartial);

  return (
    <div
      className="fixed inset-0 select-none"
      style={{ zIndex: Z.overlay, backgroundColor: C.bg, animation: 'introFadeIn .35s ease-out' }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      <video
        ref={videoRef}
        src={video.src}
        playsInline
        preload="auto"
        aria-label={video.label}
        onPlaying={() => { startedRef.current = true; }}
        onEnded={() => finish('close')}
        onError={() => finish('close')}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', backgroundColor: C.bg }}
      />

      <div className="absolute flex flex-col items-start gap-1.5" style={{ top: 16, left: 16, width: 'min(280px, calc(58vw - 16px))' }}>
        <button
          type="button"
          onClick={() => finish('dashboard')}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          title="클릭하면 영상을 멈추고 대시보드로 이동합니다"
          className="text-left font-mono"
          style={{
            width: '100%', padding: '9px 12px 10px',
            background: C.panel, border: `1px solid ${hover ? `rgba(${video.accentRgb}, 0.5)` : C.edge}`, borderRadius: 6,
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', cursor: 'pointer', transition: 'border-color .2s',
          }}
        >
          <div className="flex items-baseline justify-between gap-2" style={{ fontSize: 10, letterSpacing: '0.18em' }}>
            <span className="truncate">
              <span style={{ color: video.accent }}>{ready ? 'READY' : 'LOADING'}</span>
              <span className="hidden sm:inline"><span style={{ color: C.dim }}> / </span><span style={{ color: C.mute }}>ASSET DATA</span></span>
            </span>
            <span style={{ color: C.ink, letterSpacing: '0.06em' }}>{pct}%</span>
          </div>
          <div style={{ marginTop: 7, height: 3, borderRadius: 2, background: C.track, overflow: 'hidden' }}>
            <div
              style={{
                position: 'relative', width: `${pct}%`, height: '100%', overflow: 'hidden', borderRadius: 2,
                background: `linear-gradient(90deg, ${video.accent}, ${video.accentTo})`, boxShadow: `0 0 8px rgba(${video.accentRgb}, 0.55)`,
                transition: 'width .45s ease-out', animation: ready ? 'introReady 1.6s ease-in-out infinite' : 'none',
              }}
            >
              {!ready && (
                <div style={{ position: 'absolute', inset: 0, width: '35%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)', animation: 'introShimmer 1.4s linear infinite' }} />
              )}
            </div>
          </div>
          <div style={{ marginTop: 7, fontSize: 9.5, letterSpacing: '0.06em', lineHeight: 1.45, color: hover || ready ? C.ink : C.mute, transition: 'color .2s' }}>
            {ready ? '준비 완료 — 클릭하면 대시보드' : '클릭하면 바로 대시보드'}<span className="hidden sm:inline">{ready ? ' · Enter / Esc' : ' · Enter / Esc 건너뛰기'}</span>
          </div>
        </button>

        {INTRO_VIDEOS.length > 1 && (
          <div
            role="radiogroup"
            aria-label="인트로 영상 고르기"
            className="font-mono flex flex-col"
            style={{ padding: '5px 8px', gap: 1, background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 6, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          >
            {INTRO_VIDEOS.map(v => {
              const on = v.id === video.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => chooseVideo(v)}
                  title={on ? '지금 재생 중인 영상' : `${v.name} 영상으로 바꾸기(처음부터)`}
                  className="flex items-center text-left"
                  style={{ gap: 6, padding: '2px 0', fontSize: 10, letterSpacing: '0.06em', lineHeight: 1.4, color: on ? C.ink : C.mute, background: 'transparent', border: 'none', cursor: on ? 'default' : 'pointer' }}
                >
                  <span
                    aria-hidden="true"
                    style={{ width: 9, height: 9, flex: 'none', borderRadius: '50%', border: `1.5px solid ${v.accent}`, background: on ? v.accent : 'transparent', boxShadow: on ? `0 0 6px rgba(${v.accentRgb}, 0.6)` : 'none' }}
                  />
                  {v.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className="absolute font-mono flex flex-col items-end gap-1 text-right"
        style={{ top: 16, right: 16, maxWidth: 'calc(42vw - 32px)', padding: '6px 10px', background: C.panel, borderRadius: 6, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      >
        <div style={{ fontSize: 10, letterSpacing: '0.1em', lineHeight: 1.4, color: ready ? C.ink : C.mute }}>
          {status}<span style={{ color: C.dim }}> · {Math.floor(elapsed)}s</span>
        </div>
        <button
          type="button"
          onClick={() => setMuted(m => !m)}
          className="font-mono"
          style={{ fontSize: 9, letterSpacing: '0.18em', color: muted ? C.dim : C.mute, cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }}
          title={muted ? '소리 켜기' : '소리 끄기'}
        >
          SOUND {muted ? 'OFF' : 'ON'}
        </button>
      </div>
    </div>
  );
}
