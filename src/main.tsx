import { StrictMode, Suspense, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { installApiAuth } from './apiAuth'
import { installActivityRelay } from './sessionKeepAlive'
import { lazyScreen } from './lazyScreen'

// 앱 본체와 별도 창 8종은 각자 조각으로 받는다(성능 개선 1-3) — 창은 앱 본체 코드를 받지 않는다.
// ⚠️ 정적 import로 되돌리지 말 것: 모든 창이 앱 전체(약 2.6MB)를 다시 받는다. 앱 탭은 vite.config.ts의
//    app-chunk-preload가 index.html에서 앱 조각을 미리 받아 두므로 한 단계 늦어지지 않는다.
const App = lazyScreen(() => import('./App.tsx'))
const CalendarWindow = lazyScreen(() => import('./components/CalendarWindow.tsx'))
const FlowWindow = lazyScreen(() => import('./components/FlowWindow.tsx'))
const BacktestWindow = lazyScreen(() => import('./components/BacktestWindow.tsx'))
const CardWindow = lazyScreen(() => import('./components/CardWindow.tsx'))
const LedgerWindow = lazyScreen(() => import('./components/LedgerWindow.tsx'))
const RateWindow = lazyScreen(() => import('./components/RateWindow.tsx'))
const WatchlistWindow = lazyScreen(() => import('./components/WatchlistWindow.tsx'))
const StockChartWindow = lazyScreen(() => import('./components/StockChartWindow.tsx'))
const AiSearchWindow = lazyScreen(() => import('./components/AiSearchWindow.tsx'))

// 화면 조각이 그려지는 커밋에서(그리기 직전) index.html의 로딩용 어두운 바탕(html.booting)을 지운다.
// Suspense 안 형제라 화면과 같은 커밋에 들어간다 — 그 전에 지우면 흰 화면이 한 번 비친다.
function BootDone() {
  useLayoutEffect(() => { document.documentElement.classList.remove('booting') }, [])
  return null
}

// 메모 달력 별도 창(`/?calendarWindow=1`)은 **App을 마운트하지 않는다** — 앱을 통째로 부팅하면
// 로그인·Drive 로드·자동저장 타이머가 모두 돌아 두 번째 writer가 되고, STATE 파일을 통째로
// 덮어쓰는 저장 경로 특성상 두 창이 서로의 편집을 지운다. 이 창은 opener와 postMessage로만
// 대화하는 순수 뷰어/에디터다(상세 규약: CalendarWindow.tsx 상단).
// 자금 흐름도 별도 창(`/?flowWindow=1`)·백테스트 별도 창(`/?backtestWindow=1`)도 같은 규약 —
// App을 마운트하지 않는다.
const _params = new URLSearchParams(window.location.search)
const CALENDAR_WINDOW_BOOT = _params.get('calendarWindow') === '1'
const FLOW_WINDOW_BOOT = _params.get('flowWindow') === '1'
const BACKTEST_WINDOW_BOOT = _params.get('backtestWindow') === '1'
// 계좌 카드 별도 창(`/?cardWindow=1&card=…&pid=…`)도 같은 규약 — App을 마운트하지 않는다.
const CARD_WINDOW_BOOT = _params.get('cardWindow') === '1'
// 가계부 별도 창(`/?ledgerWindow=1`)도 같은 규약 — App을 마운트하지 않는다.
const LEDGER_WINDOW_BOOT = _params.get('ledgerWindow') === '1'
// 금리 모니터링 별도 창(`/?rateWindow=1`, 2026-10) — 같은 규약(App 미마운트).
const RATE_WINDOW_BOOT = _params.get('rateWindow') === '1'
// 관심종목 별도 창(`/?watchlistWindow=1`)도 같은 규약 — App을 마운트하지 않는다.
const WATCHLIST_WINDOW_BOOT = _params.get('watchlistWindow') === '1'
// 종목 비교 차트 창(`/?stockChartWindow=1&code=…`, 관심종목 미니차트 클릭)도 같은 규약 — App을 마운트하지 않는다.
// 이 창은 시세를 스스로 조회하고 아무것도 저장하지 않는다(브릿지 없음).
const STOCK_CHART_WINDOW_BOOT = _params.get('stockChartWindow') === '1'
// AI 검색 별도 창(`/?aiSearchWindow=1`, 2026-11-26)도 같은 규약 — App을 마운트하지 않는다(대화·키는 앱 탭에 부탁).
const AI_SEARCH_WINDOW_BOOT = _params.get('aiSearchWindow') === '1'

// 서버 경로(/api/…) 호출에 로그인 토큰을 싣는 관문 — 어떤 컴포넌트보다 먼저 설치한다(apiAuth.ts 머리말).
// 별도 창은 App이 없어 opener에게 토큰을 받는다.
const SEPARATE_WINDOW_BOOT = CALENDAR_WINDOW_BOOT || FLOW_WINDOW_BOOT || BACKTEST_WINDOW_BOOT || CARD_WINDOW_BOOT
  || LEDGER_WINDOW_BOOT || RATE_WINDOW_BOOT || WATCHLIST_WINDOW_BOOT || STOCK_CHART_WINDOW_BOOT || AI_SEARCH_WINDOW_BOOT
installApiAuth(SEPARATE_WINDOW_BOOT ? 'window' : 'app')
// 별도 창에서 하는 조작도 앱 탭의 비활동 자동 로그아웃을 미룬다(sessionKeepAlive.ts) — 없으면 창에서만 일하는 동안 앱 탭이 로그아웃된다.
if (SEPARATE_WINDOW_BOOT) installActivityRelay(window)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={null}>
      <BootDone />
      {CALENDAR_WINDOW_BOOT ? <CalendarWindow />
        : FLOW_WINDOW_BOOT ? <FlowWindow />
        : BACKTEST_WINDOW_BOOT ? <BacktestWindow />
        : CARD_WINDOW_BOOT ? <CardWindow />
        : LEDGER_WINDOW_BOOT ? <LedgerWindow />
        : RATE_WINDOW_BOOT ? <RateWindow />
        : WATCHLIST_WINDOW_BOOT ? <WatchlistWindow />
        : STOCK_CHART_WINDOW_BOOT ? <StockChartWindow />
        : AI_SEARCH_WINDOW_BOOT ? <AiSearchWindow />
        : <App />}
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)
