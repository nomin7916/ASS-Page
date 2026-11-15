// 수익률 차트 위 마우스 위치(호버) 저장소 — 성능 개선 2-2.
//
// ⚠️ App state(useState)로 되돌리지 말 것. 종전엔 마우스가 날짜 한 칸을 옮길 때마다
//    ① App 전체(표·분배금 표·사이드바…)가 다시 그려지고
//    ② 호버 안내선(ReferenceLine)이 차트의 **직접 자식**이라 자식 비교(isChildrenEqual)가 깨져
//       recharts가 축·모든 선 좌표를 처음부터 다시 계산했다(조회기간이 길수록 무겁다).
//    이제 이 저장소를 **구독하는 작은 조각**(정보 줄 · <Customized> 안의 안내선)만 다시 그린다.
//
// ⚠️ import 없는 순수 파일로 둔다 — verify:chart-sel이 Node로 직접 import해 동작을 검사한다.
//    구독은 각 조각에서 React useSyncExternalStore(store.subscribe, store.get)로 한다.

export type HoverPoint = { label: string; payload: any[] } | null;

export type HoverStore = {
  get: () => HoverPoint;
  set: (v: HoverPoint) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createHoverStore(): HoverStore {
  let cur: HoverPoint = null;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    // 같은 값이면 알리지 않는다(차트 밖에서 null을 거듭 넣는 경우 등).
    set: (v) => {
      if (v === cur) return;
      cur = v;
      subs.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}
