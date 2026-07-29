import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import CalendarWindow from './components/CalendarWindow.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

// 메모 달력 별도 창(`/?calendarWindow=1`)은 **App을 마운트하지 않는다** — 앱을 통째로 부팅하면
// 로그인·Drive 로드·자동저장 타이머가 모두 돌아 두 번째 writer가 되고, STATE 파일을 통째로
// 덮어쓰는 저장 경로 특성상 두 창이 서로의 편집을 지운다. 이 창은 opener와 postMessage로만
// 대화하는 순수 뷰어/에디터다(상세 규약: CalendarWindow.tsx 상단).
const CALENDAR_WINDOW_BOOT =
  new URLSearchParams(window.location.search).get('calendarWindow') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {CALENDAR_WINDOW_BOOT ? <CalendarWindow /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
