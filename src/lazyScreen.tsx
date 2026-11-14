import { lazy } from 'react'

// 화면 조각을 "필요할 때 받기"로 불러오는 단일 관문 — 성능 개선 1-3(2026-11-15).
// ⚠️ 받기에 실패하면(배포 뒤 옛 탭이 사라진 조각을 찾음 · 연결 끊김) 오류 화면 대신 그 자리에 새로고침 안내를 띄운다.
//    자동 새로고침은 하지 않는다 — 입력 중인 내용이 날아갈 수 있다(설계서 §3-2).
function ChunkLoadFailed() {
  return (
    <div className="min-h-screen bg-[#0b1120] text-gray-200 flex flex-col items-center justify-center gap-3 p-6 text-sm text-center">
      <p>화면을 불러오지 못했습니다. 새 버전이 올라왔거나 연결이 잠시 끊겼을 수 있습니다.</p>
      <button
        onClick={() => window.location.reload()}
        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition"
      >새로고침</button>
    </div>
  )
}

export function lazyScreen(load: () => Promise<{ default: any }>) {
  return lazy(() => load().catch((err) => {
    console.error('[화면 조각 받기 실패]', err)
    return { default: ChunkLoadFailed }
  }))
}
