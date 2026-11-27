// @ts-nocheck
import { useEffect, useState } from 'react';
import { MOBILE_QUERY, readMobileTheme, writeMobileTheme, normalizeThemePref, readPcView, writePcView, isMobileViewOn } from '../mobileView';

// 휴대폰 화면 켜짐 판단(화면 폭) + 배경 고르기 + 'PC 화면으로 보기'. 규칙은 src/mobileView.ts.
const safeLocal = () => { try { return window.localStorage; } catch { return null; } };
const safeSession = () => { try { return window.sessionStorage; } catch { return null; } };
const media = (q) => { try { return window.matchMedia ? window.matchMedia(q) : null; } catch { return null; } };
const listen = (mq, fn) => {
  if (!mq) return () => {};
  if (mq.addEventListener) { mq.addEventListener('change', fn); return () => mq.removeEventListener('change', fn); }
  if (mq.addListener) { mq.addListener(fn); return () => mq.removeListener(fn); }
  return () => {};
};

export function useMobileView() {
  const [narrow, setNarrow] = useState(() => !!media(MOBILE_QUERY)?.matches);
  const [sysDark, setSysDark] = useState(() => { const m = media('(prefers-color-scheme: dark)'); return m ? !!m.matches : true; });
  const [pcView, setPcViewState] = useState(() => readPcView(safeSession()));
  const [themePref, setThemePrefState] = useState(() => readMobileTheme(safeLocal()));

  useEffect(() => {
    const w = media(MOBILE_QUERY);
    const d = media('(prefers-color-scheme: dark)');
    const offW = listen(w, () => setNarrow(!!w.matches));
    const offD = listen(d, () => setSysDark(!!d.matches));
    return () => { offW(); offD(); };
  }, []);

  const setPcView = (on) => { writePcView(safeSession(), !!on); setPcViewState(!!on); };
  const setThemePref = (v) => { writeMobileTheme(safeLocal(), v); setThemePrefState(normalizeThemePref(v)); };

  return { narrow, sysDark, pcView, setPcView, themePref, setThemePref, active: isMobileViewOn(narrow, pcView) };
}
