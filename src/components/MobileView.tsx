// @ts-nocheck
// 휴대폰 화면(화면 폭 768px 미만) — 미래에셋 MY자산 구조를 참고한 시안(사용자 확정 2026-11-27).
// ⚠️ PC 화면(App 본문)은 그대로 마운트된 채 이 덮개(z=MOBILE_Z) 아래에 있다 — 저장·시세·기록 효과가 PC와 똑같이 돈다.
//    여기서는 같은 App 상태(통합 대시보드 ↔ 활성 계좌)와 같은 핸들러만 부른다. 숫자 계산 금지(src/mobileView.ts 머리말).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronDown, ChevronUp, ChevronRight, Camera, MoreHorizontal, Eye, EyeOff, Info, Check, RefreshCw, Monitor, LogOut } from 'lucide-react';
import {
  MOBILE_THEMES, MOBILE_THEME_OPTIONS, MOBILE_HTML_CLASS, MOBILE_Z, MASK,
  badgeOf, fmtWon, fmtSigned, fmtPct, fmtUsd, fmtQty, toneOf,
  mobileAccountList, mobileHoldingRows, holdingAccountNames, mobileMergedHoldings, todayOf, shortDate,
  mobileRebalRows, rebalModeLabel,
} from '../mobileView';
import { rebalCashSummary } from '../rebalPreview';
import { cleanNum } from '../utils';

const FONT = "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
// 종목명 칸은 미래에셋처럼 약 38% — 나머지 세 칸은 숫자 길이에 맞춰(평가금액 9자리까지 한 줄)
const GRID = 'clamp(116px, 37vw, 156px) minmax(0, 1.05fr) minmax(0, 1.1fr) minmax(0, 0.85fr)';
const NUM_FS = 'clamp(12px, 3.4vw, 14px)';
// 리밸런싱 표 — 종목명·코드 | 현재·예상 수량 | 매수·매도 수량 | 예상 투자금
const REBAL_GRID = 'clamp(108px, 32vw, 132px) minmax(0, 0.95fr) minmax(0, 0.8fr) minmax(0, 1.25fr)';
const RESET = { border: 0, padding: 0, margin: 0, background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', textAlign: 'inherit' };
const ICON_BTN = { ...RESET, flex: 'none', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function ContrastIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Badge({ type, size = 46, fontSize = 12.5 }) {
  const b = badgeOf(type);
  return (
    <span style={{ width: size, height: size, flex: 'none', borderRadius: Math.round(size / 4.2), background: b.bg, color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize, fontWeight: 700, lineHeight: 1.15, whiteSpace: 'pre-line', letterSpacing: '-0.4px' }}>{b.badge}</span>
  );
}

export default function MobileView({
  theme, themePref, onThemePref,
  portfolios, portfolioSummaries, intTotals, intMonthlyHistory, intHoldingsDonutData,
  showDashboard, activePortfolioId, activeTitle, activeTotals, activeAccountType,
  hideAmounts, onToggleHide, onGoHome, onOpenAccount, onPhotoSync,
  onRefresh, isLoading, onPcView, onLogout,
  rebalanceData, rebalExtraQty, rebalSettings,
}) {
  const C = MOBILE_THEMES[theme] || MOBILE_THEMES.black;
  const [sheet, setSheet] = useState('');
  const [tab, setTab] = useState('accounts');
  const [more, setMore] = useState(false);
  const [openRow, setOpenRow] = useState('');
  const [rebal, setRebal] = useState(false);
  const scrollRef = useRef(null);
  const metaOrigRef = useRef(null);

  // 문서 바탕·스크롤 잠금 — 덮개 아래 PC 화면이 따라 스크롤되지 않게(규칙 index.css html.mobile-view).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(MOBILE_HTML_CLASS);
    return () => {
      root.classList.remove(MOBILE_HTML_CLASS);
      root.style.removeProperty('--mv-bg');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta && metaOrigRef.current != null) meta.setAttribute('content', metaOrigRef.current);
    };
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--mv-bg', C.bg);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (metaOrigRef.current == null) metaOrigRef.current = meta.getAttribute('content') || '';
      meta.setAttribute('content', C.bg);
    }
  }, [C.bg]);

  // 휴대폰 뒤로 가기 = 계좌 화면 → 대시보드(사이트를 떠나지 않게). 계좌 화면에 들어갈 때 기록 한 칸을 쌓는다.
  const goHomeRef = useRef(onGoHome);
  goHomeRef.current = onGoHome;
  const detailRef = useRef(!showDashboard);
  detailRef.current = !showDashboard;
  const pushedRef = useRef(false);
  const ignorePopRef = useRef(false);
  useEffect(() => {
    const onPop = () => {
      if (ignorePopRef.current) { ignorePopRef.current = false; return; }
      if (!pushedRef.current) return;
      pushedRef.current = false;
      setSheet('');
      if (detailRef.current) goHomeRef.current?.(true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (!showDashboard && !pushedRef.current) {
      try { window.history.pushState(window.history.state, ''); pushedRef.current = true; } catch { /* 기록을 못 쌓는 창 — 뒤로 가기만 안 됨 */ }
    } else if (showDashboard && pushedRef.current) {
      pushedRef.current = false;
      ignorePopRef.current = true;
      try { window.history.back(); } catch { ignorePopRef.current = false; }
    }
  }, [showDashboard]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setOpenRow('');
  }, [showDashboard, activePortfolioId, rebal]);

  const toneColor = (n) => { const t = toneOf(n); return t === 'up' ? C.up : t === 'down' ? C.down : C.text; };
  const W = (n) => (hideAmounts ? MASK : fmtWon(n));
  const S = (n) => (hideAmounts ? MASK : fmtSigned(n));
  const Q = (n) => (hideAmounts ? '••••' : fmtQty(n));

  const totalEval = intTotals?.totalEval || 0;
  const accounts = useMemo(() => mobileAccountList(portfolios, portfolioSummaries, totalEval), [portfolios, portfolioSummaries, totalEval]);
  const openable = accounts.filter(a => a.canOpen);
  const photoAccounts = openable.filter(a => a.type !== 'gold');
  const today = todayOf(intMonthlyHistory && intMonthlyHistory[0]);
  const merged = useMemo(() => (tab === 'holdings' && showDashboard
    ? mobileMergedHoldings(intHoldingsDonutData, holdingAccountNames(portfolios, activePortfolioId, activeTitle))
    : []), [tab, showDashboard, intHoldingsDonutData, portfolios, activePortfolioId, activeTitle]);
  const detail = useMemo(() => (showDashboard ? null : mobileHoldingRows(activeTotals?.calcPortfolio, activeAccountType)), [showDashboard, activeTotals, activeAccountType]);
  const activeSummary = (portfolioSummaries || []).find(s => s.id === activePortfolioId) || null;
  const activeEval = activeSummary ? activeSummary.currentEval : (activeTotals?.totalEval || 0);
  const activePrincipal = activeSummary ? activeSummary.principal : 0;
  const activeProfit = activeEval - activePrincipal;
  const activeRate = activeSummary ? activeSummary.returnRate : 0;
  const activeBadge = badgeOf(activeAccountType);
  const showCamera = showDashboard ? photoAccounts.length > 0 : activeAccountType !== 'gold';

  // 리밸런싱 표 — PC 리밸런싱 표와 같은 값(rebalanceData·추가 수량·rebalCashSummary). 금현물은 PC처럼 없음.
  const canRebal = !showDashboard && activeAccountType !== 'gold';
  const rebalOn = rebal && canRebal;
  const rebalUsd = activeAccountType === 'overseas';
  const rebalRows = useMemo(() => (rebalOn ? mobileRebalRows(rebalanceData, rebalExtraQty, activeAccountType) : []), [rebalOn, rebalanceData, rebalExtraQty, activeAccountType]);
  const rebalSum = useMemo(() => {
    if (!rebalOn) return null;
    const dep = (activeTotals?.calcPortfolio || []).find(p => p && p.type === 'deposit');
    return rebalCashSummary({ rows: rebalanceData || [], extraQty: rebalExtraQty || {}, depositAmount: cleanNum(dep?.depositAmount || 0), settings: rebalSettings || {} });
  }, [rebalOn, rebalanceData, rebalExtraQty, rebalSettings, activeTotals]);
  const rebalTotal = rebalRows.reduce((s, r) => s + r.expEval, 0);
  const AMT = (n) => (hideAmounts ? MASK : rebalUsd ? fmtUsd(n) : `${fmtWon(n)}원`);
  const AMTN = (n) => (hideAmounts ? MASK : rebalUsd ? fmtUsd(n) : fmtWon(n));
  const moveColor = (n) => (n > 0 ? C.up : n < 0 ? C.down : C.sub);

  const goHome = () => { setSheet(''); onGoHome(true); };
  const openAccount = (id) => { setSheet(''); onOpenAccount(id); };
  const openPhoto = () => {
    if (showDashboard) { setSheet('photoAcct'); return; }
    setSheet('');
    onPhotoSync(activePortfolioId);
  };
  const pickPhotoAccount = (id) => { setSheet(''); onOpenAccount(id); onPhotoSync(id); };

  const segStyle = (on) => ({ ...RESET, height: 46, borderRadius: 12, background: on ? C.segOn : 'transparent', color: on ? C.text : C.sub, fontSize: 16, fontWeight: on ? 700 : 500, textAlign: 'center' });
  const sheetRowBtn = { ...RESET, width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', minHeight: 56, fontSize: 16, textAlign: 'left' };
  const sheetTitles = { theme: '화면 배경', menu: '메뉴', acct: '계좌 고르기', photoAcct: '잔고 사진 계좌 고르기' };

  const accountRowInner = (a) => (
    <>
      <Badge type={a.type} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 17, fontWeight: 600, ...ELLIPSIS }}>{a.name}</span>
        <span style={{ fontSize: 13.5, color: C.sub, ...ELLIPSIS }}>
          {a.isTest ? '합계 제외(TEST)' : a.weight != null ? `비중 ${a.weight.toFixed(1)}%` : a.label}
        </span>
      </span>
      <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{W(a.evalAmount)}원</span>
        {a.type === 'matong'
          ? <span style={{ fontSize: 13.5, color: C.sub }}>잔액</span>
          : <span style={{ fontSize: 13.5, color: toneColor(a.profit) }}>{S(a.profit)}원 ({fmtPct(a.rate)}%)</span>}
      </span>
    </>
  );
  const accountRowStyle = { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', minHeight: 78, boxSizing: 'border-box', width: '100%', textAlign: 'left' };

  const qtyLine = (r) => {
    const w = `${r.weight.toFixed(1)}%`;
    if (r.kind === 'savings') return `예적금 · ${w}`;
    if (r.kind === 'cash') return `현금 · ${w}`;
    if (r.kind === 'fund' && !(r.qty > 0)) return `펀드 · ${w}`;
    return `${Q(r.qty)}${r.unit} · ${w}`;
  };
  const priceText = (r, v) => (r.kind !== 'stock' || !(v > 0) ? '-' : r.usd ? fmtUsd(v) : fmtWon(v));

  return (
    <div
      className="mobile-view-root"
      style={{ position: 'fixed', inset: 0, zIndex: MOBILE_Z, display: 'flex', flexDirection: 'column', background: C.bg, color: C.text, fontFamily: FONT, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.2px', WebkitFontSmoothing: 'antialiased', colorScheme: C.scheme, fontSize: 14 }}
    >
      <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', padding: '0 4px', borderBottom: `1px solid ${showDashboard ? 'transparent' : C.line}`, background: C.bg }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
          {showDashboard ? (
            <h1 style={{ margin: '0 0 0 16px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.6px' }}>내 자산</h1>
          ) : (
            <>
              <button type="button" aria-label="대시보드로 돌아가기" onClick={goHome} style={{ ...ICON_BTN, color: C.text }}><ChevronLeft size={26} /></button>
              <button type="button" aria-haspopup="dialog" onClick={() => setSheet('acct')} style={{ ...RESET, minWidth: 0, height: 44, display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px 0 2px', color: C.text }}>
                <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.4px', ...ELLIPSIS }}>{activeTitle || '계좌'}</span>
                <ChevronDown size={20} style={{ flex: 'none' }} aria-hidden="true" />
              </button>
              {canRebal && (
                <button type="button" aria-pressed={rebalOn} onClick={() => { setSheet(''); setRebal(v => !v); }} style={{ ...RESET, flex: 'none', height: 44, display: 'flex', alignItems: 'center', padding: '0 2px' }}>
                  <span style={{ height: 30, display: 'flex', alignItems: 'center', padding: '0 11px', borderRadius: 999, border: `1px solid ${rebalOn ? C.text : C.line2}`, background: rebalOn ? C.text : 'transparent', color: rebalOn ? C.bg : C.text, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }}>리밸런싱</span>
                </button>
              )}
            </>
          )}
        </div>
        {showCamera && (
          <button type="button" aria-label="잔고 사진으로 맞추기" title="잔고 사진으로 맞추기" onClick={openPhoto} style={{ ...ICON_BTN, color: C.text }}><Camera size={23} /></button>
        )}
        <button type="button" aria-label="화면 배경 고르기" title="화면 배경 고르기" aria-haspopup="dialog" onClick={() => setSheet('theme')} style={{ ...ICON_BTN, color: C.text }}><ContrastIcon /></button>
        <button type="button" aria-label="메뉴" title="메뉴" aria-haspopup="dialog" onClick={() => setSheet('menu')} style={{ ...ICON_BTN, color: C.text }}><MoreHorizontal size={24} /></button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
        {showDashboard ? (
          <div>
            <div style={{ padding: '30px 20px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, color: C.sub }}>총자산 · 계좌 {accounts.filter(a => !a.isTest).length}개</span>
                <button type="button" aria-pressed={hideAmounts} onClick={onToggleHide} style={{ ...RESET, height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderRadius: 999, background: C.pill, color: C.sub, fontSize: 13.5 }}>
                  {hideAmounts ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
                  <span>{hideAmounts ? '보기' : '숨김'}</span>
                </button>
              </div>
              <div style={{ marginTop: 20, display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <span style={{ fontSize: 'clamp(30px, 9.6vw, 38px)', fontWeight: 700, letterSpacing: '-1.2px' }}>{W(totalEval)}</span>
                <span style={{ fontSize: 'clamp(21px, 6.6vw, 26px)', fontWeight: 700 }}>원</span>
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, fontSize: 15.5 }}>
                <Info size={18} aria-hidden="true" style={{ color: C.sub }} />
                <span style={{ color: C.sub }}>오늘의 수익{today.date ? ` (${shortDate(today.date)})` : ''}</span>
                {today.held
                  ? <span style={{ color: C.sub }}>-</span>
                  : <span style={{ color: toneColor(today.amount), fontWeight: 500 }}>{S(today.amount)}원 ({fmtPct(today.rate)}%)</span>}
              </div>
              <button type="button" aria-expanded={more} aria-label={more ? '자세히 접기' : '자세히 보기'} onClick={() => setMore(v => !v)} style={{ ...RESET, marginTop: 6, width: 56, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.sub }}>
                {more ? <ChevronUp size={26} /> : <ChevronDown size={26} />}
              </button>
            </div>

            {more && (
              <div style={{ margin: '0 20px 8px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, background: C.line, borderRadius: 14, overflow: 'hidden' }}>
                {[
                  ['총 투자원금', `${W(intTotals?.totalPrincipal || 0)}원`, C.text],
                  ['평가손익', `${S(totalEval - (intTotals?.totalPrincipal || 0))}원`, toneColor(totalEval - (intTotals?.totalPrincipal || 0))],
                  ['전체 수익률', `${fmtPct(intTotals?.returnRate || 0)}%`, toneColor(intTotals?.returnRate || 0)],
                  ['예수금 합계', `${W(intTotals?.totalDeposit || 0)}원`, C.text],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ background: C.card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 13, color: C.sub }}>{label}</span>
                    <span style={{ fontSize: 16, fontWeight: 600, color }}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ margin: '18px 20px 10px', padding: 4, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, background: C.chip, borderRadius: 16 }}>
              <button type="button" aria-pressed={tab === 'holdings'} onClick={() => setTab('holdings')} style={segStyle(tab === 'holdings')}>보유종목</button>
              <button type="button" aria-pressed={tab !== 'holdings'} onClick={() => setTab('accounts')} style={segStyle(tab !== 'holdings')}>계좌</button>
            </div>

            {tab !== 'holdings' ? (
              <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 4 }}>
                {accounts.length === 0 && <div style={{ padding: '28px 20px', textAlign: 'center', color: C.sub }}>계좌가 없습니다</div>}
                {accounts.map(a => (a.canOpen ? (
                  <button key={a.id} type="button" onClick={() => openAccount(a.id)} style={{ ...RESET, ...accountRowStyle, color: C.text }}>{accountRowInner(a)}</button>
                ) : (
                  <div key={a.id} style={{ ...accountRowStyle }}>{accountRowInner(a)}</div>
                )))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 4 }}>
                {merged.length === 0 && <div style={{ padding: '28px 20px', textAlign: 'center', color: C.sub }}>보유 종목이 없습니다</div>}
                {merged.map(h => (
                  <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 20px', minHeight: 66, boxSizing: 'border-box' }}>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ fontSize: 16, fontWeight: 600, ...ELLIPSIS }}>{h.name}</span>
                      {h.accounts && <span style={{ fontSize: 13, color: C.sub, ...ELLIPSIS }}>{h.accounts}</span>}
                    </span>
                    <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{W(h.evalAmount)}원</span>
                      <span style={{ fontSize: 13, color: toneColor(h.profit) }}>{S(h.profit)}원 ({fmtPct(h.rate)}%)</span>
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 20px', borderTop: `1px solid ${C.line}` }}>
                  <span style={{ flex: 1, fontSize: 15, color: C.sub }}>예수금 합계</span>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{W(intTotals?.totalDeposit || 0)}원</span>
                </div>
              </div>
            )}

            <div style={{ padding: '26px 20px 34px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              {isLoading && <span style={{ fontSize: 12.5, color: C.sub }}>시세를 받는 중…</span>}
              <button type="button" onClick={onPcView} style={{ ...RESET, height: 44, padding: '0 12px', color: C.sub, fontSize: 13.5, textDecoration: 'underline', textUnderlineOffset: 3 }}>PC 화면으로 보기</button>
            </div>
          </div>
        ) : rebalOn ? (
          <div>
            <div style={{ padding: '18px 20px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ flex: 'none', padding: '3px 8px', borderRadius: 6, background: activeBadge.bg, color: '#ffffff', fontSize: 12, fontWeight: 700 }}>{activeBadge.label}</span>
                <span style={{ fontSize: 13.5, color: C.sub, ...ELLIPSIS }}>리밸런싱 · {rebalModeLabel(rebalSettings?.mode)}</span>
              </div>
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', background: C.card, borderRadius: 12, padding: '12px 0' }}>
                {[
                  ['매수 금액', rebalSum?.totalBuy || 0, C.up],
                  ['매도 금액', rebalSum?.totalSell || 0, C.down],
                  ['잔액', rebalSum?.balance || 0, (rebalSum?.balance || 0) < 0 ? C.up : C.text],
                ].map(([label, v, color], i) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0, borderLeft: i ? `1px solid ${C.line}` : 'none', padding: '0 4px' }}>
                    <span style={{ fontSize: 12.5, color: C.sub }}>{label}</span>
                    <span style={{ fontSize: NUM_FS, fontWeight: 600, color, ...ELLIPSIS, maxWidth: '100%' }}>{AMT(v)}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, color: C.sub }}>
                {rebalUsd ? '해외 계좌는 달러 · ' : ''}잔액 = 예수금 + 적립금 + 매도 − 매수 (PC 표와 같은 값)
              </div>
            </div>

            <div>
              <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: REBAL_GRID, background: C.head, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, color: C.sub, fontSize: 13, textAlign: 'center' }}>
                {[['종목명', '종목코드'], ['현재 수량', '예상 수량'], ['매수·매도', '수량'], ['예상 투자금', '']].map(([a, b], i) => (
                  <div key={a} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: '8px 4px', borderRight: i === 0 ? `1px solid ${C.line}` : 'none' }}><span>{a}</span>{b && <span>{b}</span>}</div>
                ))}
              </div>

              {rebalRows.map(r => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: REBAL_GRID, borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '12px 8px 12px 16px', borderRight: `1px solid ${C.line}`, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, ...ELLIPSIS }}>{r.name}</span>
                    <span style={{ fontSize: 13, color: C.sub, ...ELLIPSIS }}>{r.code || '-'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', gap: 4, padding: '12px 8px 12px 0', fontSize: NUM_FS, minWidth: 0 }}>
                    <span style={{ color: C.sub, ...ELLIPSIS }}>{r.fixed ? '-' : `${Q(r.qty)}${r.unit}`}</span>
                    <span style={{ fontWeight: 700, ...ELLIPSIS }}>{r.fixed ? '-' : `${Q(r.expQty)}${r.unit}`}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', gap: 4, padding: '12px 8px 12px 0', fontSize: NUM_FS, color: moveColor(r.move), minWidth: 0 }}>
                    <span style={{ fontWeight: 700 }}>{r.fixed ? '-' : r.move > 0 ? '매수' : r.move < 0 ? '매도' : '유지'}</span>
                    <span style={ELLIPSIS}>{r.move ? `${r.move > 0 ? '+' : '-'}${Q(Math.abs(r.move))}${r.unit}` : '-'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '12px 12px 12px 0', fontSize: NUM_FS, minWidth: 0 }}>
                    <span style={ELLIPSIS}>{AMTN(r.expEval)}</span>
                  </div>
                </div>
              ))}

              {rebalRows.length === 0 && (
                <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 14, color: C.sub }}>리밸런싱할 종목이 없습니다</div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: REBAL_GRID, borderBottom: `1px solid ${C.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '12px 8px 12px 16px', borderRight: `1px solid ${C.line}`, fontSize: 15, fontWeight: 600 }}>합계</div>
                <div />
                <div />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '12px 12px 12px 0', fontSize: NUM_FS, fontWeight: 700 }}>
                  <span style={ELLIPSIS}>{AMTN(rebalTotal)}</span>
                </div>
              </div>
            </div>

            <div style={{ padding: '22px 20px 34px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textAlign: 'center' }}>
              <span style={{ fontSize: 12.5, color: C.sub }}>목표 비중·추가 수량 같은 자세한 설정은 PC 화면에서 합니다</span>
              <button type="button" onClick={onPcView} style={{ ...RESET, height: 44, padding: '0 12px', color: C.sub, fontSize: 13.5, textDecoration: 'underline', textUnderlineOffset: 3 }}>PC 화면으로 보기</button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ padding: '18px 20px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ flex: 'none', padding: '3px 8px', borderRadius: 6, background: activeBadge.bg, color: '#ffffff', fontSize: 12, fontWeight: 700 }}>{activeBadge.label}</span>
                <span style={{ fontSize: 13.5, color: C.sub, ...ELLIPSIS }}>투자원금 {W(activePrincipal)}원</span>
              </div>
              <div style={{ marginTop: 12, fontSize: 'clamp(25px, 7.7vw, 30px)', fontWeight: 700, letterSpacing: '-0.8px' }}>{W(activeEval)}원</div>
              <div style={{ marginTop: 6, fontSize: 15.5, fontWeight: 500, color: toneColor(activeProfit) }}>{S(activeProfit)}원 ({fmtPct(activeRate)}%)</div>
              {detail?.hasChange && (
                <div style={{ marginTop: 4, fontSize: 13.5, color: C.sub }}>오늘 <span style={{ color: toneColor(detail.today) }}>{S(detail.today)}원</span></div>
              )}
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', background: C.card, borderRadius: 12, padding: '12px 0' }}>
                {[['매입금액', detail?.holdInvest], ['종목 평가금액', detail?.holdEval], ['예수금', detail?.depositEval]].map(([label, v], i) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0, borderLeft: i ? `1px solid ${C.line}` : 'none', padding: '0 4px' }}>
                    <span style={{ fontSize: 12.5, color: C.sub }}>{label}</span>
                    <span style={{ fontSize: NUM_FS, fontWeight: 600, ...ELLIPSIS, maxWidth: '100%' }}>{W(v || 0)}</span>
                  </div>
                ))}
              </div>
              {activeAccountType === 'overseas' && <div style={{ marginTop: 8, fontSize: 12.5, color: C.sub }}>달러 종목은 지금 환율로 원화 환산 · 현재가·평균단가는 달러</div>}
            </div>

            <div>
              <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: GRID, background: C.head, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, color: C.sub, fontSize: 13, textAlign: 'center' }}>
                {[['종목명', '수량 · 비중'], ['평가손익', '수익률(%)'], ['평가금액', '매입금액'], ['현재가', '평균단가']].map(([a, b], i) => (
                  <div key={a} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 4px', borderRight: i === 0 ? `1px solid ${C.line}` : 'none' }}><span>{a}</span><span>{b}</span></div>
                ))}
              </div>

              {(detail?.rows || []).map(r => {
                const open = openRow === r.id;
                return (
                  <div key={r.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                    <button type="button" aria-expanded={open} onClick={() => setOpenRow(open ? '' : r.id)} style={{ ...RESET, width: '100%', display: 'grid', gridTemplateColumns: GRID, alignItems: 'stretch', background: open ? C.head : 'transparent', color: C.text, textAlign: 'right' }}>
                      <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '12px 8px 12px 16px', textAlign: 'left', borderRight: `1px solid ${C.line}`, minWidth: 0 }}>
                        <span style={{ fontSize: 15, fontWeight: 600, ...ELLIPSIS }}>{r.name}</span>
                        <span style={{ fontSize: 13, color: C.sub, ...ELLIPSIS }}>{qtyLine(r)}</span>
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '12px 8px 12px 0', minWidth: 0, fontSize: NUM_FS, color: toneColor(r.profit) }}>
                        <span style={ELLIPSIS}>{S(r.profit)}</span>
                        <span style={ELLIPSIS}>{fmtPct(r.rate)}</span>
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '12px 8px 12px 0', minWidth: 0, fontSize: NUM_FS }}>
                        <span style={ELLIPSIS}>{W(r.evalAmount)}</span>
                        <span style={ELLIPSIS}>{W(r.invest)}</span>
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '12px 12px 12px 0', minWidth: 0, fontSize: NUM_FS }}>
                        <span style={{ ...ELLIPSIS, color: r.changeRate != null ? toneColor(r.changeRate) : C.text }}>{priceText(r, r.price)}</span>
                        <span style={ELLIPSIS}>{priceText(r, r.avg)}</span>
                      </span>
                    </button>
                    {open && (
                      <div style={{ padding: '4px 16px 14px', background: C.head, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5 }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</span>
                        {r.code && <span style={{ color: C.sub }}>종목코드 {r.code}</span>}
                        {r.changeRate != null && (
                          <span style={{ color: C.sub }}>전일대비 <span style={{ color: toneColor(r.changeRate) }}>{fmtPct(r.changeRate)}%</span> · 오늘 손익 <span style={{ color: toneColor(r.today) }}>{S(r.today)}원</span></span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {detail && detail.rows.length === 0 && (
                <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 14, color: C.sub }}>보유 종목이 없습니다</div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: GRID, borderBottom: `1px solid ${C.line}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '12px 8px 12px 16px', borderRight: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>예수금</span>
                  <span style={{ fontSize: 13, color: C.sub }}>{activeAccountType === 'overseas' ? '원화 환산' : '원화'}</span>
                </div>
                <div />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '12px 8px 12px 0', fontSize: NUM_FS }}>{W(detail?.depositEval || 0)}</div>
                <div />
              </div>
            </div>

            <div style={{ padding: '22px 20px 34px', textAlign: 'center', fontSize: 12.5, color: C.sub }}>
              {isLoading ? '시세를 받는 중…' : '종목을 누르면 코드와 전일대비가 보입니다'}
            </div>
          </div>
        )}
      </div>

      {sheet && sheetTitles[sheet] && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
          <button type="button" aria-label="닫기" onClick={() => setSheet('')} style={{ ...RESET, position: 'absolute', inset: 0, width: '100%', height: '100%', background: C.overlay }} />
          <div role="dialog" aria-modal="true" aria-label={sheetTitles[sheet]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', overflowY: 'auto', background: C.sheet, color: C.text, borderRadius: '22px 22px 0 0', padding: '8px 0 calc(26px + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -8px 30px rgba(0,0,0,0.25)' }}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 2, background: C.line2, margin: '2px auto 14px' }} />

            {sheet === 'theme' && (
              <div>
                <h2 style={{ margin: 0, padding: '0 24px 4px', fontSize: 19, fontWeight: 700 }}>화면 배경</h2>
                <p style={{ margin: 0, padding: '0 24px 12px', fontSize: 13.5, color: C.sub }}>고르면 바로 바뀌고 이 창은 닫힙니다.</p>
                {MOBILE_THEME_OPTIONS.map(o => {
                  const sel = themePref === o.key;
                  return (
                    <button key={o.key} type="button" aria-pressed={sel} onClick={() => { onThemePref(o.key); setSheet(''); }} style={{ ...RESET, width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '11px 24px', minHeight: 66, background: sel ? C.selRow : 'transparent', textAlign: 'left' }}>
                      <span aria-hidden="true" style={{ width: 38, height: 38, flex: 'none', borderRadius: '50%', background: o.swatch, boxShadow: `inset 0 0 0 1px ${C.line2}` }} />
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: sel ? 700 : 500 }}>
                          <span>{o.label}</span>
                          {o.isDefault && <span style={{ padding: '1px 7px', borderRadius: 999, background: C.pill, color: C.sub, fontSize: 11.5, fontWeight: 600 }}>기본</span>}
                        </span>
                        <span style={{ fontSize: 13, color: C.sub }}>{o.sub}</span>
                      </span>
                      {sel && <Check size={22} strokeWidth={2.4} style={{ flex: 'none' }} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}

            {sheet === 'menu' && (
              <div>
                <h2 style={{ margin: 0, padding: '0 24px 10px', fontSize: 19, fontWeight: 700 }}>메뉴</h2>
                <button type="button" onClick={() => { setSheet(''); onRefresh(); }} style={sheetRowBtn}><RefreshCw size={22} aria-hidden="true" /><span>시세 새로고침</span></button>
                <button type="button" onClick={() => { setSheet(''); onPcView(); }} style={sheetRowBtn}><Monitor size={22} aria-hidden="true" /><span>PC 화면으로 보기</span></button>
                <button type="button" onClick={() => { setSheet(''); onLogout(); }} style={sheetRowBtn}><LogOut size={22} aria-hidden="true" /><span>로그아웃</span></button>
              </div>
            )}

            {(sheet === 'acct' || sheet === 'photoAcct') && (
              <div>
                <h2 style={{ margin: 0, padding: '0 24px 4px', fontSize: 19, fontWeight: 700 }}>{sheet === 'acct' ? '계좌 고르기' : '어느 계좌의 잔고 사진인가요?'}</h2>
                {sheet === 'photoAcct' && <p style={{ margin: 0, padding: '0 24px 10px', fontSize: 13.5, color: C.sub }}>고른 계좌의 수량·매입금액을 사진에 맞춥니다.</p>}
                {(sheet === 'acct' ? openable : photoAccounts).map(a => {
                  const sel = sheet === 'acct' && a.id === activePortfolioId;
                  return (
                    <button key={a.id} type="button" aria-pressed={sheet === 'acct' ? sel : undefined} onClick={() => (sheet === 'acct' ? openAccount(a.id) : pickPhotoAccount(a.id))} style={{ ...RESET, width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 24px', minHeight: 56, background: sel ? C.selRow : 'transparent', textAlign: 'left' }}>
                      <Badge type={a.type} size={34} fontSize={10} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: sel ? 700 : 500, ...ELLIPSIS }}>{a.name}</span>
                      {sheet === 'acct'
                        ? <span style={{ flex: 'none', fontSize: 14.5, color: C.sub }}>{W(a.evalAmount)}원</span>
                        : <ChevronRight size={18} aria-hidden="true" style={{ flex: 'none', color: C.sub }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
