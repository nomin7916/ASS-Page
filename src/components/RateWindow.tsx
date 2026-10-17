// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ErrorBoundary from './ErrorBoundary';
import { BG, BORDER } from '../design';

/**
 * 금리 모니터링 **별도 브라우저 창** (`/?rateWindow=1`) — 3단계 뼈대(2026-10).
 * 내용(카드·차트·판정)은 4단계에서 채운다. 지금은 제목과 빈 상자만 있다.
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다(LedgerWindow와 같은 규약). 로그인·권한은 opener(앱 탭)에 묻는다:
 *    창 → `rate:ping` / 앱 → `rate:pong { allowed, today }`. 권한 판정의 정본은 앱 탭(rateAccess)이다 —
 *    이 창은 조작 가능한 URL로 열리므로 창 스스로 권한을 판단하지 않는다(fail-closed: 답을 받기 전엔 닫혀 있다).
 * ⚠️ 수신 화이트리스트는 열거형이다 — 메시지 타입을 늘리면 App 핸들러와 여기 둘 다 등록할 것.
 * ⚠️ 자체 `ErrorBoundary label`이 필요하다(main.tsx 루트 경계는 label이 없어 창 전체가 오류 페이지가 된다).
 */

const PING_MS = 3000;
const LINK_TIMEOUT_MS = 12000;

// 배경 3종 — 기본 블랙. 시스템은 OS 다크/라이트 설정을 따른다. 세션 로컬(저장하지 않는다).
const THEMES = {
  black: { page: BG.primary, card: BG.card, text: 'text-gray-100', sub: 'text-gray-400', border: BORDER.default },
  white: { page: '#f8fafc', card: '#ffffff', text: 'text-gray-900', sub: 'text-gray-500', border: 'border-gray-300' },
};
const BG_OPTIONS = [
  { key: 'system', label: '시스템' },
  { key: 'black', label: '블랙' },
  { key: 'white', label: '백색' },
];

const SECTIONS = [
  { key: 'board', title: '현재 금리 보드' },
  { key: 'allocation', title: '지금 적정 자산' },
  { key: 'chart', title: '금리 차트' },
  { key: 'assets', title: '자산군별 종목' },
];

export default function RateWindow() {
  // 'pending'(앱 응답 대기) | 'allowed' | 'denied' — 응답 전엔 내용을 그리지 않는다(fail-closed)
  const [access, setAccess] = useState('pending');
  const [today, setToday] = useState('');
  const [linked, setLinked] = useState(true);
  const [bgMode, setBgMode] = useState('black');
  const [systemDark, setSystemDark] = useState(() => {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return true; }
  });
  const lastMsgRef = useRef(0);

  const post = useCallback((msg) => {
    const op = window.opener;
    if (!op || op.closed) return false;
    try { op.postMessage(msg, window.location.origin); return true; } catch { return false; }
  }, []);

  useEffect(() => { document.title = '금리 모니터링'; }, []);

  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch { return undefined; }
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  // 수신 — origin·opener 검사 필수
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (window.opener && e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object' || d.type !== 'rate:pong') return;
      lastMsgRef.current = Date.now();
      setLinked(true);
      setAccess(d.allowed === true ? 'allowed' : 'denied');
      if (typeof d.today === 'string') setToday(d.today);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    const tick = () => {
      const alive = post({ type: 'rate:ping' });
      if (!alive) { setLinked(false); return; }
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post]);

  const themeKey = bgMode === 'system' ? (systemDark ? 'black' : 'white') : bgMode;
  const t = THEMES[themeKey];

  // 권한 없음 — 한 줄만
  if (access === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-300" style={{ background: BG.primary }}>
        이 페이지를 사용할 권한이 없습니다
      </div>
    );
  }
  // 앱 탭의 응답을 기다리는 중(또는 앱 탭 없이 열림) — 권한을 확인하기 전에는 내용을 그리지 않는다
  if (access === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400" style={{ background: BG.primary }}>
        {linked ? '앱 창에서 권한을 확인하는 중입니다…' : '앱 창에서 금리 모니터링 버튼으로 열어 주세요.'}
      </div>
    );
  }

  return (
    <ErrorBoundary label="금리 모니터링">
      <div className={`min-h-screen flex flex-col ${t.text}`} style={{ background: t.page }}>
        {/* ① 상단 바 */}
        <header className={`flex flex-wrap items-center gap-3 px-4 py-3 border-b ${t.border}`}>
          <h1 className="text-[16px] font-bold">금리 모니터링</h1>
          <span className={`text-[12px] ${t.sub}`}>기준일 {today || '-'}</span>
          {!linked && <span className="text-[11px] text-amber-400">앱 창과 연결이 끊겼습니다</span>}
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="배경">
            <span className={`text-[11px] mr-1 ${t.sub}`}>배경</span>
            {BG_OPTIONS.map(o => (
              <button
                key={o.key}
                onClick={() => setBgMode(o.key)}
                className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                  bgMode === o.key ? 'border-sky-500 text-sky-400' : `${t.border} ${t.sub} hover:text-sky-400`
                }`}
              >{o.label}</button>
            ))}
          </div>
        </header>

        {/* ②~⑤ 빈 상자 — 내용은 4단계 */}
        <main className="flex-1 grid gap-3 p-4 grid-cols-1 lg:grid-cols-2 pb-16">
          {SECTIONS.map(s => (
            <section key={s.key} className={`rounded-lg border ${t.border} p-3 min-h-[180px]`} style={{ background: t.card }}>
              <h2 className="text-[13px] font-bold">{s.title}</h2>
            </section>
          ))}
        </main>

        {/* ⑥ 하단 고정 문구 */}
        <footer className={`fixed bottom-0 inset-x-0 px-4 py-2 border-t ${t.border} text-[11px] ${t.sub} text-center`} style={{ background: t.page }}>
          판정은 과거 수치로 만든 참고 신호이며 투자 권유가 아닙니다.
        </footer>
      </div>
    </ErrorBoundary>
  );
}
