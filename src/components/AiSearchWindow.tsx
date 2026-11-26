// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AiSearchChat from './AiSearchChat';
import ErrorBoundary from './ErrorBoundary';

/**
 * AI 검색 **별도 브라우저 창** (`/?aiSearchWindow=1`, 사용자 요청 2026-11-26 "팝업 말고 별도 브라우저로 — 앱을 가려 불편").
 *
 * ⚠️ 이 창은 App을 마운트하지 않는다(관심종목 창과 같은 규약 — writer는 끝까지 앱 탭 하나).
 *    화면은 인앱 창과 **같은 AiSearchChat**(variant='page')이고, 대화 묶음·키 읽기/쓰기는 `ais:call`로 앱 탭에 부탁한다
 *    (앱 탭이 aiSearchStoreApi·geminiKeyApi·aiKeysApi 그대로 — Drive 저장·관리자 접속 중 거절도 그쪽).
 *    /api/… 호출의 로그인 토큰은 main.tsx installApiAuth('window')가 opener에게 받는다.
 * ⚠️ 수신은 opener에서 온 `ais:pong`·`ais:result` 둘뿐(그 밖은 버린다).
 * ⚠️ 보유 종목은 앱 탭이 이름·코드만(searchHoldings) 보낸다 — 창은 그 목록을 AiSearchChat의 getPortfolios 모양으로만 감싼다.
 */

const PING_MS = 3000;
const LINK_TIMEOUT_MS = 12000;
const CALL_TIMEOUT_MS = 60000;

export default function AiSearchWindow() {
  const [info, setInfo] = useState(null);   // { email, isAdmin, viewingAs } — 앱 탭이 알려 준 로그인 계정
  const [linked, setLinked] = useState(true);
  const holdsRef = useRef([]);
  const lastRef = useRef(0);
  const pend = useRef(new Map());
  const seq = useRef(0);

  const post = useCallback((msg) => {
    const op = window.opener;
    if (!op || op.closed) return false;
    try { op.postMessage(msg, window.location.origin); return true; } catch { return false; }
  }, []);

  useEffect(() => { document.title = 'AI 검색'; }, []);

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (!window.opener || e.source !== window.opener) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'ais:pong') {
        lastRef.current = Date.now();
        setLinked(true);
        if (Array.isArray(d.holdings)) holdsRef.current = d.holdings;
        const email = String(d.email || '').toLowerCase();
        if (email) {
          setInfo(prev => (prev && prev.email === email && prev.isAdmin === !!d.isAdmin && prev.viewingAs === !!d.viewingAs)
            ? prev : { email, isAdmin: !!d.isAdmin, viewingAs: !!d.viewingAs });
        }
        return;
      }
      if (d.type === 'ais:result') {
        const p = pend.current.get(d.reqId);
        if (!p) return;
        pend.current.delete(d.reqId);
        clearTimeout(p.t);
        p.resolve(d.value && typeof d.value === 'object' ? d.value : { ok: false, canSave: false, error: '앱 창의 답이 비었습니다' });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 핑 + 연결 판정 — 앱 탭이 새로고침되면 이 핑으로 다시 입양된다.
  useEffect(() => {
    const tick = () => {
      if (!post({ type: 'ais:ping' })) { setLinked(false); return; }
      if (lastRef.current && Date.now() - lastRef.current > LINK_TIMEOUT_MS) setLinked(false);
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => clearInterval(id);
  }, [post]);

  // 앱 탭에 부탁 — 실패도 AiSearchChat이 읽는 모양({ ok, canSave, error, … })으로 돌려준다(던지지 않는다).
  const call = useCallback((op, arg) => new Promise((resolve) => {
    const fail = (error) => resolve({ ok: false, data: null, key: '', keys: {}, canSave: false, error });
    const reqId = `r${Date.now().toString(36)}${(seq.current += 1)}`;
    if (!post({ type: 'ais:call', reqId, op, arg })) { fail('자산관리 앱 창이 닫혀 있습니다 — 앱 창을 연 뒤 다시 해 주세요'); return; }
    const t = setTimeout(() => { pend.current.delete(reqId); fail('자산관리 앱 창이 답하지 않습니다'); }, CALL_TIMEOUT_MS);
    pend.current.set(reqId, { resolve, t });
  }), [post]);

  const storeApi = useMemo(() => ({ load: () => call('storeLoad'), save: (data) => call('storeSave', data) }), [call]);
  const keyApi = useMemo(() => ({ load: () => call('keyLoad'), save: (k) => call('keySave', k) }), [call]);
  const aiApi = useMemo(() => ({ load: () => call('aiLoad'), save: (keys) => call('aiSave', keys) }), [call]);
  const getPortfolios = useCallback(() => [{ portfolio: holdsRef.current.map(h => ({ type: 'stock', quantity: 1, code: h.code, name: h.name })) }], []);

  const banner = !window.opener
    ? '자산관리 앱의 AI 검색 단추로 이 창을 열어 주세요 — 대화 저장·키는 앱 창이 있어야 합니다.'
    : !linked ? '자산관리 앱 창과 연결이 끊겼습니다 — 앱 창을 다시 열면 자동으로 이어집니다(그 사이 대화는 저장되지 않을 수 있습니다).' : '';

  return (
    <ErrorBoundary label="AI 검색">
      <div className="h-screen flex flex-col bg-[#0f1623] text-gray-200">
        {banner && <div className="shrink-0 px-3 py-1.5 text-[12px] text-amber-200 bg-amber-900/30 border-b border-amber-700/40">{banner}</div>}
        {info ? (
          <AiSearchChat
            key={info.email}
            open
            variant="page"
            onClose={() => { try { window.close(); } catch { /* 브라우저가 막으면 그대로 둔다 */ } }}
            keyApi={keyApi}
            storeApi={storeApi}
            aiApi={aiApi}
            isAdmin={info.isAdmin}
            viewingAs={info.viewingAs}
            getPortfolios={getPortfolios}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[13px] text-gray-400">{window.opener ? '자산관리 앱과 연결하는 중…' : '자산관리 앱에서 열어 주세요.'}</div>
        )}
      </div>
    </ErrorBoundary>
  );
}
