// 계좌 카드 '별도 브라우저 창' 공용 계약 — 순수 함수·상수만 둔다(App/창 양쪽이 import).
//
// ⚠️ 설계 불변식(어기면 조용한 데이터 파괴가 난다 — 설계 적대적 검증에서 3렌즈 확인):
//  INV-1 writer는 앱 탭 하나. 창은 App을 마운트하지 않는다(main.tsx 분기).
//  INV-2 창은 **원자재**(계좌 객체 + 시세 이력 + 시장지표)를 받고 파생(usePortfolioData 등)은
//        앱과 **같은 코드**로 창에서 계산한다. 파생값을 push하면 두 화면이 갈린다.
//  INV-3 창의 모든 쓰기는 **by-id 커맨드**다. patchActive 계열을 프록시하면 앱 탭의 활성 계좌에
//        착지해 엉뚱한 계좌를 파괴한다.
//  INV-4 통째 교체 커맨드(원장·투자기록·과표 이벤트)는 base 지문을 함께 보내고, 앱은 불일치 시
//        거부 + 최신값 재푸시한다.
//  INV-5 창은 자기 확인창·인라인 토스트·ErrorBoundary(label)를 갖는다. notify/confirm은
//        App 트리에만 있어 프록시해도 창 사용자에겐 피드백이 0이다.
//  INV-6 메시지 화이트리스트는 **양쪽 모두 접두사 검사**다(열거형 금지 — CalendarWindow가
//        열거형 비대칭으로 응답을 조용히 폐기한 사고가 있다).
//  INV-7 창의 조작은 앱 탭 비활동 타이머를 리셋한다(경고가 이미 떴으면 '계속'까지 눌러 준다).
//  INV-8 끊김(opener 소멸·무응답) = 읽기 전용. 입력 자체를 막는다.
//  INV-9 창은 계좌 id를 열 때 박제한다 — 앱 탭이 다른 계좌로 가도 자기 계좌를 계속 편집한다.

export const CARD_MSG_PREFIX = 'card:';

// 카드 정의 — key는 App의 sectionCollapsed 키와 **같은 이름**을 쓴다(확장 버튼 배선이 1:1).
export const CARD_DEFS = [
  { key: 'summary', label: '포트폴리오 요약' },
  { key: 'stats', label: '통계·히스토리' },
  { key: 'dividend', label: '분배금 현황' },
  { key: 'rebalancing', label: '리밸런싱' },
  { key: 'donut', label: '자산비중비교' },
] as const;

export type CardKey = typeof CARD_DEFS[number]['key'];

export const CARD_LABELS: Record<string, string> = CARD_DEFS.reduce(
  (m, d) => { m[d.key] = d.label; return m; }, {} as Record<string, string>);

export const isCardKey = (k: any): boolean => CARD_DEFS.some(d => d.key === k);

// ⚠️ 별도 창을 **실제로 지원하는** 카드. 확장 버튼은 이 목록에만 렌더한다 —
//    지원하지 않는 카드의 버튼을 노출하면 빈 창이 열려 '고장난 버튼'이 된다(명시적 미노출 원칙).
//    카드를 새로 이식할 때 CardWindow.tsx의 분기와 **함께** 늘릴 것.
export const CARD_WINDOW_SUPPORTED: string[] = ['summary', 'stats', 'dividend', 'rebalancing', 'donut'];
export const isCardWindowSupported = (k: any): boolean => CARD_WINDOW_SUPPORTED.includes(k);

// 브라우저 탭/창 제목 — 사용자 요구: "COVERD 4 - 분배금 현황"
export const cardWindowTitle = (accountName: string, card: string): string => {
  const label = CARD_LABELS[card] || '카드';
  const name = String(accountName || '').trim();
  return name ? `${name} - ${label}` : label;
};

// window.open의 name — 같은 (계좌, 카드)를 다시 누르면 **새 창을 열지 않고 기존 창을 포커스**한다.
// ⚠️ pid에 공백·특수문자가 들어갈 수 있어 안전 문자만 남긴다(브라우저가 name을 토큰으로 다룬다).
export const cardWindowName = (pid: string, card: string): string =>
  `ass-card-${String(pid || '').replace(/[^A-Za-z0-9_-]/g, '')}-${card}`;

export const cardWindowUrl = (pid: string, card: string): string =>
  `/?cardWindow=1&card=${encodeURIComponent(card)}&pid=${encodeURIComponent(pid)}`;

// ⚠️ 평가액 시계열(buildCloseEvalSeries)은 **현재 보유가 아니라 그 날짜의 holdingSnapshot items**를
//    평가한다. 그래서 창에 보내는 종가 부분집합을 '현재 보유 코드'로 잡으면, 매도·이관으로 지금은
//    없는 코드의 종가가 빠져 allExact가 false가 되고 그 구간 전체가 직전값 carry-forward로 그려진다
//    → 같은 계좌의 '자산 평가액 추이'가 앱 탭과 창에서 다르게 보인다(INV-2 위반).
//    useStockData의 전체 갱신도 같은 이유로 현재+과거 합집합을 쓴다.
export const historicalCodesOf = (account: any): string[] => {
  const out = new Set<string>();
  const add = (c: any) => { const s = String(c || '').trim(); if (s) out.add(s); };
  (account?.portfolio || []).forEach((it: any) => add(it?.code));
  (account?.holdingSnapshots || []).forEach((s: any) => (s?.items || []).forEach((it: any) => add(it?.code)));
  Object.keys(account?.manualPriceOverrides || {}).forEach(k => {
    // manualPriceOverrides 키는 `${code}|${date}` 또는 code — 앞 토큰만 코드로 본다.
    add(String(k).split('|')[0]);
  });
  return Array.from(out);
};

// 종가 맵에서 필요한 코드만 투영(참조 재사용 — 복사하지 않는다).
export const pickStockHistorySubset = (map: any, codes: string[]): Record<string, any> => {
  const out: Record<string, any> = {};
  (codes || []).forEach(c => { if (map && map[c]) out[c] = map[c]; });
  return out;
};

// 카드별로 창이 실제로 읽는 앱 레벨 부가 데이터가 무엇인지 한 곳에 명시한다.
// ⚠️ 여기 없는 데이터를 창에서 읽지 말 것 — 페이로드에 없으면 undefined가 흘러 조용히 오작동한다.
export const CARD_NEEDS: Record<string, { prices?: boolean; dividend?: boolean; fetchStatus?: boolean; histPeriod?: boolean }> = {
  summary: {},
  donut: {},
  // ⚠️ stockFetchStatus는 시세 갱신 중 코드마다 loading→success로 바뀌어 전송이 폭주한다.
  //    행 내부 상태점을 실제로 그리는 카드에만 싣는다.
  rebalancing: { fetchStatus: true },
  dividend: { dividend: true },
  // histPeriod = 평가액 추이 표의 기간 단위(앱의 초기값 1회 시드용). stats 카드만 그 표를 그린다.
  stats: { prices: true, fetchStatus: true, histPeriod: true },
};

// 창→앱 커맨드 이름 — **App의 핸들러가 실제로 구현한 것과 1:1**이어야 한다.
// ⚠️ '앞으로 만들 것'을 미리 적어 두지 말 것. 목록에만 있고 구현이 없는 op은 거짓 계약이 되어,
//    창이 그것을 보내면 default-deny에 걸려 사용자에게는 '버튼이 고장난 것'으로 보인다.
//    (실제로 setStartDate·setPrincipal·addPrincipal·setAvgExchangeRate·setDepositRows·
//     refetchStockHistory·adminTargetChange 7개가 그렇게 남아 있었다 — 계좌 필드 쓰기는
//     전부 `cardWrite`의 accountFields로 흡수됐다.)
// 앱 핸들러는 이 의미를 **allow-list(default deny)**로 다룬다 — 모르는 op은 조용히 무시하지 말고
// ack에 사유를 실어 창이 인라인으로 알릴 수 있게 한다.
export const CARD_OPS = [
  // 항목·설정·계좌 필드 — cardWrite는 셋을 한 번에 쓰는 원자적 복합 커맨드다
  'updateItem', 'patchItems', 'patchSettings', 'cardWrite',
  'toggleColumn', 'toggleMarkedRow', 'resetMarkedRows',
  // 리밸런싱
  'refreshPrice', 'saveTargetSnapshot', 'updateInvestmentNotes', 'verifyPin',
  // 관리자 접속 중 목표 변경 공지 — 인앱과 같은 등급으로 알린다(세션당 1회 래치는 앱 탭 담당)
  'adminTargetChange',
  // 분배금 — 하부 by-id 라이터 20종을 fn 이름으로 라우팅한다
  'dividendCall',
] as const;

export const isCardOp = (op: any): boolean => (CARD_OPS as readonly string[]).includes(op);

// INV-4 지문 — 통째 교체 대상의 base 스냅샷. 값이 아니라 '구조'가 아니라 **내용 전체**를 담아야
// 한다(길이·개수 해시는 동일 길이 편집을 놓친다 — investmentNotesKey가 그 버그를 냈다).
// ⚠️ 절대 던지지 않는다 — 지문 계산이 죽으면 그 커맨드가 통째로 막힌다.
export const baseKeyOf = (value: any): string => {
  try { return JSON.stringify(value ?? null); } catch { return '__unserializable__'; }
};
