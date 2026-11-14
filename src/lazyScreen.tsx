import { lazy, useState } from 'react'

// 화면 조각을 "필요할 때 받기"로 불러오는 단일 관문 — 성능 개선 1-3(창·앱 본체) · 1-4(앱 안 큰 화면, 2026-11-15).
// ⚠️ 받기에 실패하면(배포 뒤 옛 탭이 사라진 조각을 찾음 · 연결 끊김) 오류 화면 대신 새로고침 안내를 띄운다.
//    자동 새로고침은 하지 않는다 — 입력 중인 내용이 날아갈 수 있다(설계서 §3-2).
//    앱 안 화면(inApp)은 '닫기'도 둔다 — 앱의 나머지는 그대로 쓸 수 있어야 한다.
function ChunkLoadFailed({ inApp }: { inApp: boolean }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div className="fixed inset-0 z-[1300] bg-[#0b1120]/90 text-gray-200 flex flex-col items-center justify-center gap-3 p-6 text-sm text-center">
      <p>화면을 불러오지 못했습니다. 새 버전이 올라왔거나 연결이 잠시 끊겼을 수 있습니다.</p>
      <div className="flex gap-2">
        <button
          onClick={() => window.location.reload()}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition"
        >새로고침</button>
        {inApp && (
          <button
            onClick={() => setHidden(true)}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition"
          >닫기</button>
        )}
      </div>
    </div>
  )
}

// 앱 안 화면을 받는 동안 그 자리에 보이는 작은 표시(Suspense fallback). 앱 전체가 비지 않게 화면마다 따로 감싼다.
export function ScreenLoading() {
  return (
    <div className="fixed inset-0 z-[1090] bg-[#0b1120]/70 flex items-center justify-center text-gray-300 text-sm">화면을 불러오는 중…</div>
  )
}

// preload: 화면을 열기 전에 미리 받아 둔다(App의 한가할 때 미리 받기). 같은 import라 열 때는 받은 것을 그대로 쓴다.
export function lazyScreen(load: () => Promise<{ default: any }>, opts: { inApp?: boolean } = {}) {
  const inApp = !!opts.inApp
  const C: any = lazy(() => load().catch((err) => {
    console.error('[화면 조각 받기 실패]', err)
    return { default: () => <ChunkLoadFailed inApp={inApp} /> }
  }))
  C.preload = () => load().catch(() => {})
  return C
}
