import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import CalendarWindow from './components/CalendarWindow.tsx'
import FlowWindow from './components/FlowWindow.tsx'
import BacktestWindow from './components/BacktestWindow.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {CALENDAR_WINDOW_BOOT ? <CalendarWindow />
        : FLOW_WINDOW_BOOT ? <FlowWindow />
        : BACKTEST_WINDOW_BOOT ? <BacktestWindow />
        : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
