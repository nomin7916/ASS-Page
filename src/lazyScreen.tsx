import { lazy, useState } from 'react'

// 화면 조각을 "필요할 때 받기"로 불러오는 단일 관문 — 성능 개선 1-3(창·앱 본체) · 1-4(앱 안 큰 화면) · 1-5(늘 떠 있는 창 3개, 2026-11-15).
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

// 늘 떠 있는 창(계산기·메모 달력·자금 흐름도)을 받는 동안의 작은 표시(성능 개선 1-5). 창은 화면을 막지 않으므로
// 어둡게 덮지 않고, 클릭도 가로채지 않는다.
export function WindowLoading() {
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[1090] pointer-events-none bg-gray-800/95 border border-gray-600 text-gray-200 text-xs px-3 py-1.5 rounded shadow">창을 불러오는 중…</div>
  )
}

// 처음 열 때부터 children을 마운트하고, 그 뒤에는 닫혀도(open=false) 계속 마운트해 둔다(성능 개선 1-5).
// ⚠️ "열려 있는가"로 바꾸지 말 것 — 닫을 때마다 언마운트돼 계산기 입력·창 위치·흐름도 flushRef가 사라진다.
//    한 번도 열지 않은 창은 마운트하지 않으므로 그 창의 조각도 받지 않는다(받기는 lazyScreen).
export function KeepAfterOpen({ open, children }: { open: boolean; children: any }) {
  const [ever, setEver] = useState(open)
  if (open && !ever) setEver(true)
  return (ever || open) ? children : null
}

// preload: 화면을 열기 전에 미리 받아 둔다(App의 한가할 때 미리 받기). 같은 import라 열 때는 받은 것을 그대로 쓴다.
// 이미 받아 둔 화면은 Suspense를 거치지 않고 그 자리에서 바로 그린다(1-5) — 거치면 받은 뒤에도 대기 표시가 한 번
// 비치고, 화면의 첫 effect가 클릭과 같은 틀이 아니라 한 번 그린 뒤에 돌아(흐름도 위치 복원 등) 한 번 튄다.
// ⚠️ 어느 쪽으로 그릴지는 마운트할 때 한 번만 정한다(useState 초깃값). 중간에 바꾸면 컴포넌트 종류가 바뀌어
//    다시 마운트되고 입력 중인 내용이 사라진다.
export function lazyScreen(load: () => Promise<{ default: any }>, opts: { inApp?: boolean } = {}) {
  const inApp = !!opts.inApp
  let mod: { default: any } | null = null
  const loadKeep = () => load().then((m) => { mod = m; return m })
  const L = lazy(() => loadKeep().catch((err) => {
    console.error('[화면 조각 받기 실패]', err)
    return { default: () => <ChunkLoadFailed inApp={inApp} /> }
  }))
  const C: any = function LazyScreen(props: any) {
    const [Impl] = useState(() => (mod ? mod.default : L))
    return <Impl {...props} />
  }
  C.preload = () => loadKeep().catch(() => {})
  return C
}
