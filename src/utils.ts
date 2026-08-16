export const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

// ── 관리자 공지 ↔ 학습자료 매칭 (공지 클릭 → 자료 열기) ──
// 알림 레코드(id/targetEmail/message/type/createdAt)에는 자료 fileId/url 참조 필드가 없다(시트 스키마 고정).
// 자료 제목은 등록 후 변경 불가(rename UI 없음)이고 발송 메시지에 그 제목이 박히므로, 제목을 안정 키로
// 사용해 복원한다. ⚠️ 부분 문자열 매칭 금지 — '📚 ${title}가 등록되었습니다.'는 한국어 조사 '가'가 제목에
// 공백 없이 붙어('신규' vs '신규가') includes() 매칭이 다른 자료를 오매칭한다.
// → 정확 템플릿 추출 + 정확 일치만 사용.
// 발송측(AdminPage)과 복원측(App/UserInfoBar)이 같은 빌더/파서를 공유해 문구 드리프트로 인한 무음
// 매칭 실패를 막는다. 검증: npm run verify:notice.
// ⚠️ 시장동향 리포트는 이 채널에서 제거됐다 — 유튜브식 '단일 URL 바로가기'로 바뀌어 복원할 자료 목록
// 자체가 없다. 시트에 남은 옛 '__report__' 공지와 벨 이력의 materialChannel:'report' 태그는 아래 세
// 함수에서 전부 null로 떨어져 평문으로만 표시된다(클릭 불가 — 의도된 graceful degradation).
export const notebookNoticeMessage = (title: string) => `📚 ${title}가 등록되었습니다.`;

export const noticeChannelOf = (targetEmail: string): 'notebook' | null =>
  targetEmail === '__notebook__' ? 'notebook' : null;

// 공지 메시지에서 자료 제목 추출. 정확 템플릿만 매칭(임의 텍스트·수동 브로드캐스트·폐지된 리포트 채널은 null).
// 벨 알림이력의 '[관리자 공지] ' 접두사 허용. NFC 정규화 + trim.
export const parseNoticeTitle = (message: string, channel: 'notebook' | null): string | null => {
  if (typeof message !== 'string' || channel !== 'notebook') return null;
  const body = message.replace(/^\[관리자 공지\]\s*/, '');
  const m = body.match(/^📚 (.+)가 등록되었습니다\.$/);
  return m ? m[1].normalize('NFC').trim() : null;
};

// 채널 배열(이미 기능 게이팅된 notebookLinks)에서 메시지 제목과 정확 일치하는 링크 복원.
// 동일 제목 다수 시 refCreatedAt(공지 발송시각)에 가장 근접한 createdAt 선택. 일치 없으면 null(=클릭 불가).
export const resolveNoticeMaterial = (
  links: any[],
  message: string,
  channel: 'notebook' | null,
  refCreatedAt?: number,
): any | null => {
  if (!Array.isArray(links) || links.length === 0) return null;
  const title = parseNoticeTitle(message, channel);
  if (!title) return null;
  const matches = links.filter(l => ((l && l.title) || '').normalize('NFC').trim() === title);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  if (typeof refCreatedAt === 'number') {
    return matches.reduce((best, l) =>
      Math.abs(((l && l.createdAt) || 0) - refCreatedAt) < Math.abs(((best && best.createdAt) || 0) - refCreatedAt) ? l : best
    );
  }
  return matches[0];
};

export const calcPeriodStart = (period: string, latest: string, earliest: string): string | null => {
  if (period === 'custom') return null;
  if (period === 'all') return earliest;
  const d = new Date(latest);
  if      (period === '1w')  d.setDate(d.getDate() - 7);
  else if (period === '1m')  d.setMonth(d.getMonth() - 1);
  else if (period === '2m')  d.setMonth(d.getMonth() - 2);
  else if (period === '3m')  d.setMonth(d.getMonth() - 3);
  else if (period === '6m')  d.setMonth(d.getMonth() - 6);
  else if (period === '1y')  d.setFullYear(d.getFullYear() - 1);
  else if (period === '2y')  d.setFullYear(d.getFullYear() - 2);
  else if (period === '3y')  d.setFullYear(d.getFullYear() - 3);
  else if (period === '4y')  d.setFullYear(d.getFullYear() - 4);
  else if (period === '5y')  d.setFullYear(d.getFullYear() - 5);
  else if (period === '10y') d.setFullYear(d.getFullYear() - 10);
  else return null;
  const start = d.toISOString().split('T')[0];
  return start < earliest ? earliest : start;
};

export const hexToRgba = (hex: string, alpha: number): string | null => {
  if (!hex || typeof hex !== 'string' || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const blendWithDarkBg = (hex: string, alpha: number, bgHex = '#1e293b'): string => {
  if (!hex || hex.length < 7) return bgHex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const bgR = parseInt(bgHex.slice(1, 3), 16);
  const bgG = parseInt(bgHex.slice(3, 5), 16);
  const bgB = parseInt(bgHex.slice(5, 7), 16);
  return `rgb(${Math.round(bgR*(1-alpha)+r*alpha)}, ${Math.round(bgG*(1-alpha)+g*alpha)}, ${Math.round(bgB*(1-alpha)+b*alpha)})`;
};

export const isWeekend = (dateStr) => {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 0 || d.getDay() === 6;
};

// dateStr(YYYY-MM-DD)에 영업일 n일을 더한 날짜 반환. 주말 및 holidays(YYYY-MM-DD[]) 제외.
export const addBusinessDays = (dateStr: string, n: number, holidays: string[] = []): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return '';
  const set = new Set(holidays || []);
  const d = new Date(dateStr + 'T12:00:00');
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (d.getDay() === 0 || d.getDay() === 6 || set.has(ds)) continue;
    added++;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 분배금 지급(예정)일 = 배당락일 + 2영업일 (한국 ETF 기준일 T+2, 휴일 제외)
export const dividendPayDate = (exDate: string, holidays: string[] = []): string =>
  addBusinessDays(exDate, 2, holidays);

// 최근 7일 범위 내 주말 날짜를 이전 기록값으로 채워서 반환 (저장용)
export const fillWeekendGaps = (history, today) => {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return [];
  const dateSet = new Set(sorted.map(h => h.date));
  const cutoff = new Date(today + 'T12:00:00');
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const fills = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    if (curr.date < cutoffStr) continue;
    const nextDate = sorted[i + 1].date;
    const d = new Date(curr.date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    while (d.toISOString().split('T')[0] < nextDate) {
      const ds = d.toISOString().split('T')[0];
      if (!dateSet.has(ds) && isWeekend(ds)) {
        fills.push({ date: ds, evalAmount: curr.evalAmount, principal: curr.principal, isFixed: false });
        dateSet.add(ds);
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return fills;
};

// 주말 + 공휴일 날짜를 이전 거래일 값으로 채워서 반환
// 연속 두 레코드 사이 간격이 30일 초과이면 비정상 갭으로 보고 스킵
export const fillNonTradingGaps = (history, krHolidays = [], usHolidays = [], accountType = 'portfolio') => {
  const isNonTrading = (dateStr) => {
    const day = new Date(dateStr + 'T12:00:00').getDay();
    if (day === 0 || day === 6) return true;
    return accountType === 'overseas' ? usHolidays.includes(dateStr) : krHolidays.includes(dateStr);
  };
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return [];
  const dateSet = new Set(sorted.map(h => h.date));
  const fills = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const gapMs = new Date(next.date + 'T12:00:00').getTime() - new Date(curr.date + 'T12:00:00').getTime();
    if (gapMs > 30 * 86400000) continue;
    const d = new Date(curr.date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    while (d.toISOString().split('T')[0] < next.date) {
      const ds = d.toISOString().split('T')[0];
      if (!dateSet.has(ds) && isNonTrading(ds)) {
        fills.push({ date: ds, evalAmount: curr.evalAmount, principal: curr.principal, isFixed: false });
        dateSet.add(ds);
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return fills;
};

// 같은 날짜 history 레코드 중복 제거 — 날짜당 1건만 유지(시계열은 날짜당 단일 값이 정상).
// 우선순위: 실시간 권위값(isFixed:false & evalAmount>0) > 확정값(isFixed:true & adjustedAmount 있음) > 순수 백필.
// 동순위는 나중(배열 뒤) 값을 채택. 등장 순서는 날짜 첫 등장 기준으로 보존.
// 중복이 없으면 원본 배열을 그대로 반환(불필요한 재생성 방지).
// date가 없는 레코드는 시계열에서 무의미하므로 의도적으로 폐기한다.
// 검증: npm run verify:history
export const dedupeHistoryByDate = (history) => {
  if (!Array.isArray(history) || history.length < 2) return history;
  const rank = (h) => {
    if (!h?.isFixed && cleanNum(h?.evalAmount) > 0) return 2;
    if (h?.isFixed && h?.adjustedAmount !== undefined) return 1;
    return 0;
  };
  const best = new Map();
  for (const h of history) {
    if (!h?.date) continue;
    const cur = best.get(h.date);
    if (!cur || rank(h) >= rank(cur)) best.set(h.date, h);
  }
  if (best.size === history.length) return history;
  const seen = new Set();
  const out = [];
  for (const h of history) {
    if (!h?.date || seen.has(h.date)) continue;
    seen.add(h.date);
    out.push(best.get(h.date));
  }
  return out;
};

// 분배금 현황 헤더 사이트 링크를 항상 7슬롯 { initial, url }로 정규화(로드 방어).
export const DIVIDEND_LINK_COUNT = 7;
export const normalizeDividendLinks = (raw) => {
  const src = Array.isArray(raw) ? raw : [];
  return Array.from({ length: DIVIDEND_LINK_COUNT }, (_, i) => ({
    initial: String(src[i]?.initial ?? '').slice(0, 1),
    url: String(src[i]?.url ?? ''),
  }));
};

// YYYY-MM-DD 문자열이 **실제 달력에 존재하는 날짜**인지 검사.
// ⚠️ 정규식(`^\d{4}-\d{2}-\d{2}$`)만으로는 부족하다 — 2026-13-45 같은 값이 통과해 메모 달력의
// 날짜 키로 들어가면 CalendarModal이 실제 날짜로만 셀을 그리므로(dayKeyOf) 그 기록은 화면에
// 영원히 안 보이고 삭제도 못 하는 유령이 된다. `new Date(y, m, 0).getDate()`로 그 달의 실제
// 일수를 계산(윤년 자동 처리) — `new Date('2026-02-30')` 류의 롤오버 파싱에 의존하지 않는다.
export const isValidIsoDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
};

export const cleanNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
  return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
};

// IEEE754 왕복 잔차 정리(유효숫자 15자리). 14505.01/288*288 = 14505.009999999998 → 14505.01.
// 15자리 이하로 표현되는 정상 값에는 no-op이다.
export const round15 = (n) => (Number.isFinite(n) ? Number(n.toPrecision(15)) : 0);

// ── 해외계좌 투자금액(USD) ────────────────────────────────────────────────────────
// 해외 주식 행의 '투자금액'은 **사용자가 직접 입력해 저장하는 값**이다(item.investAmountUsd, USD).
// 보유수량과 마찬가지로 상대에서 자동 산출하지 않는다(국내 행과 같은 계약).
// 과거엔 저장 필드가 없어 화면이 `purchasePrice × quantity`를 렌더하고 blur에 purchasePrice만
// 기록했다. 그래서 ① 14505.01 입력 → 50.36461805…를 저장했다 되곱해 14505.009999999998로 돌아오고
// ② 수량만 고쳐도 총액이 저절로 바뀌었다. 둘 다 "직접 입력 칸" 계약 위반이라 저장값으로 전환했다.
//
// ⚠️ 저장 필드를 `investAmount`가 아니라 **신규 `investAmountUsd`** 로 둔 것은 의도다 — 합치지 말 것:
//   ① 해외 항목의 `investAmount`에는 **원화 잔존값**이 남아 있을 수 있다(레거시·PasteModal 임포트).
//      거기에 사용자 입력을 얹으면 값만 보고 원화인지 USD인지 구분할 수 없고, 수량 편집 시 미러
//      재산출이 그 원화값을 purchasePrice로 세탁해 아래 `bookCostOf(costBasisOnly)` 방어선을 정확히
//      우회한다(통합 장부 ≈1,390배 오염 → 흡수 판정·누적 TWR 영구 오염).
//   ② `snapshotCompositionKey`는 `investAmount`를 담고 `purchasePrice`는 담지 않는다. `investAmount`에
//      쓰면 **원가 정정만 해도 새 보유 스냅샷**이 생겨 원장 흐름이 0인 날 bookDelta가 점프하고,
//      그 하루가 흡수 판정을 뒤집어 이후 최대 15행(CARRY_MAX_ROWS)의 일간 지표가 '-'로 잠긴다.
//   신규 필드는 두 함정을 구조적으로 회피한다(레거시 점유자 없음 + 구성 지문 밖).
//
// ⚠️ `purchasePrice`는 **파생 미러**(= investAmountUsd / quantity)로 함께 기록된다. 해외 원가 소비자
//    (usePortfolioData·useIntegratedData·bookCostOf costBasisOnly·handleSort·이관)는 전부
//    `purchasePrice × quantity`를 읽으므로 그쪽은 한 줄도 고치지 않는다. 이 미러가 설계의 유일한
//    정합성 근거다 — 금액·수량 **두 편집 경로 모두**에서 반드시 동시에 갱신할 것
//    (`usePortfolioState.handleUpdate`가 유일한 쓰기 지점).

// 저장된 사용자 입력(USD). 입력이 없으면 null(=레거시 행). 0도 유효한 입력이라 0과 미입력을 구분한다.
export const overseasInvestInput = (item) => {
  const v = item?.investAmountUsd;
  if (v === null || v === undefined || v === '') return null;
  const n = cleanNum(v);
  return Number.isFinite(n) ? n : null;
};

// 해외 행 투자금액(USD)의 단일 소스. 저장된 입력이 있으면 그대로, 없으면 레거시 폴백.
// ⚠️ 폴백에 round15를 씌우는 이유: 옛 UI가 만든 행은 단가가 이미 나눗셈 결과라 되곱하면
//    14505.009999999998이 나온다. 표시는 formatUSD(2자리)라 가려지지만 편집 초안(String)에는
//    그대로 노출돼 "고쳤는데 그대로다"가 된다.
export const overseasInvestAmount = (item) =>
  overseasInvestInput(item) ?? round15(cleanNum(item?.purchasePrice) * cleanNum(item?.quantity));

// 입출금 내역 누적합 — 특정 날짜까지 (포함). "anchor + delta" 모델용.
// overseas 계좌는 amount가 USD이므로 fxRate 곱하지 않고 USD 합산.
// 비overseas 계좌도 fxRate=1이므로 동일 결과.
const cumDepositsUpTo = (date, depositHistory, depositHistory2) => {
  let cum = 0;
  for (const d of depositHistory || []) {
    if ((d.date || '') > date) continue;
    if (!d.noPrincipal) cum += cleanNum(d.amount);
  }
  for (const w of depositHistory2 || []) {
    if ((w.date || '') > date) continue;
    if (!w.noPrincipal) {
      const deducted = w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount);
      cum -= deducted;
    }
  }
  return cum;
};

// 개별 계좌 일간 지표용 순 외부현금흐름 — (fromExclusive, toInclusive] 반개구간.
// 통합(useIntegratedData의 원장 집계)과 같은 규칙: 입금은 noPrincipal(배당·이자) 제외, 출금은 전액.
// ⚠️ cumDepositsUpTo(원금 산출용)와 절대 합치지 말 것 — 출금 규칙이 다르다. 원금은
//    principalDeducted·noPrincipal을 반영하지만, 현금흐름은 실제로 계좌를 빠져나간 전액이다.
// rateOf: 행 → 환율(해외계좌는 d.fxRate, 국내는 1). 미전달 시 1(원화 계좌).
export const externalFlowInRange = (depositHistory, depositHistory2, fromExclusive, toInclusive, rateOf) => {
  const rate = typeof rateOf === 'function' ? rateOf : () => 1;
  let inFlow = 0, outFlow = 0;
  const inRange = (dt) => dt && dt > (fromExclusive || '') && dt <= (toInclusive || '');
  // ⚠️ Math.abs 금지 — DepositPanel은 음수 '정정 행'을 빨간 글씨로 명시 지원한다
  //    (DepositPanel.tsx 금액 셀: cleanNum(h.amount) >= 0 ? 파랑 : 빨강).
  //    abs를 씌우면 마이너스 입금이 유입으로 뒤집혀 오차가 원장 금액의 2배가 된다.
  //    코드베이스의 다른 모든 원장 소비자(cumDepositsUpTo·portfolioPrincipalData·
  //    intDepositEvents·depositWithSum)가 부호 있는 합을 쓰므로 여기도 부호를 보존한다.
  for (const d of depositHistory || []) {
    if (!d || d.noPrincipal || !inRange(d.date || '')) continue;
    const v = cleanNum(d.amount) * rate(d);
    if (v > 0) inFlow += v; else if (v < 0) outFlow += -v;
  }
  for (const w of depositHistory2 || []) {
    if (!w || !inRange(w.date || '')) continue;
    const v = cleanNum(w.amount) * rate(w);
    if (v > 0) outFlow += v; else if (v < 0) inFlow += -v;
  }
  return { in: inFlow, out: outFlow, net: inFlow - outFlow };
};

// 일간 수익률(%) — 유입은 기초(BOD)·유출은 기말(EOD) 가중한 Modified Dietz.
// 통합 대시보드·개별 계좌·CSV가 전부 이 한 함수를 공유해야 값이 어긋나지 않는다.
//   분모를 prevEval로만 두면 소액 계좌에 대형 입금 시 수익률이 폭발하고(고치려던 버그의 재발),
//   유출까지 분모에 넣으면 전액 출금일에 분모가 0이 되어 그날 실수익이 소실된다.
export const dailyFlowAdjustedRate = (prevEval, curEval, flowIn, flowOut) => {
  const base = (prevEval || 0) + (flowIn || 0);
  if (!(base > 0)) return 0;
  const r = (((curEval || 0) + (flowOut || 0)) / base - 1) * 100;
  return Number.isFinite(r) ? r : 0;
};

// 일간 지표 보류 판정 — 원장에 기록된 흐름이 아직 평가액에 반영되지 않은 날을 잡아낸다.
// 판정 근거는 **'V가 그 흐름을 담고 있다고 볼 수 있는가'** 하나다:
//   흐름이 반영됐다면 ΔV는 최소한 흐름의 절반 규모로 움직인다.
//   반영 안 됐다면 ΔV는 시장 변동분뿐이라 흐름 대비 무시할 수준에 머문다.
//   비거래일 carry-forward 행(주말·휴장)은 ΔV가 **정확히 0**이라 항상 여기에 걸린다 — 주 경로다.
// ⚠️ 되돌리지 말아야 할 두 가지 오답:
//   (a) '|ΔV| < |흐름|×5%' — 창이 ±0.37%뿐이라 시장이 조금만 움직여도 보류가 풀려 가짜 대손실.
//   (b) '|ΔV − 흐름| > 전일V×5%' — 흐름이 이미 반영된 날에도 '손익이 크면' 보류해(crypto +10%일 등)
//       그 흐름을 다음 날 한 번 더 차감했고, 반대로 전일V의 5% 미만인 미반영 흐름은 놓쳤다.
const MATERIAL_FLOW_RATIO = 0.01;  // 이 비율 이하의 소액 흐름은 (거래일에 한해) 판정 대상 아님
const ABSORBED_RATIO = 0.5;        // 흐름 방향으로 절반 이상 움직였으면 '반영됨'으로 본다
// bookDelta(장부액 변화, 있으면 우선) — 없으면 ΔV 휴리스틱으로 폴백해 기존 동작을 그대로 유지한다.
export const shouldHoldDailyMetrics = (prevEval, curEval, netFlow, bookDelta) => {
  if (prevEval == null || curEval == null) return true;
  if (!(prevEval > 0)) return true;
  const f = netFlow || 0;
  if (f === 0) return false;
  const dV = curEval - prevEval;
  // ⚠️ 비거래일 carry-forward 행(ΔV가 정확히 0)은 시장 정보가 전혀 없어 어떤 크기의 흐름도
  //    이 행에 반영될 수 없다 → 아래 소액 하한보다 **먼저** 판정해야 한다. 하한을 먼저 두면
  //    전일V의 1% 이하 입금(월 적립식 등)이 주말 원장에서 통째로 새어 가짜 손실이 된다.
  //    ⚠️ bookDelta가 있어도 이 규칙엔 예외를 두지 말 것 — 장부가 바뀌었어도 평가액 시계열이
  //    직전값 이월이면 그 흐름은 실제로 V에 안 들어 있다.
  if (dV === 0) return true;
  if (Math.abs(f) <= prevEval * MATERIAL_FLOW_RATIO) return false;
  // ⚠️ 흡수 판정의 근거는 ΔV보다 **장부액 변화(bookDelta = Σ(예수금+매입원가)의 전일 대비 변화)** 가
  //    정확하다. 장부액은 시세로 변하지 않고 외부 입출금으로만 변하므로 '흐름이 V에 들어왔는가'를
  //    추측이 아니라 관측으로 답한다. ΔV로만 보면 (a) 정상 반영된 출금이 같은 날 시장이 오르면
  //    '미반영'으로 오판돼 '-'로 가려지고, (b) 그 이월이 다음 날 한 번 더 차감돼 부호가 뒤집힌다
  //    (실측: 2% 인출 + 시장 +1.5% → '-', 다음날 시장 −2%인데 +₩10,000 이익으로 표시).
  // ⚠️ 부호까지 본다. Math.abs로 비교하면 흐름과 반대 방향 변동을 '흡수 증거'로 오인해
  //    (입금일에 하락 등) 보류가 풀리고 흐름 전액이 손익으로 계상된다.
  const absorbed = bookDelta != null ? bookDelta : dV;
  return f > 0 ? absorbed < f * ABSORBED_RATIO : absorbed > f * ABSORBED_RATIO;
};

// 장부액(원가 기준) = Σ(예수금 + 매입원가). 시세로는 변하지 않고 **외부 입출금으로만** 변한다.
// ⚠️ 알려진 한계: 매도하면 예수금이 매입원가보다 실현손익만큼 더 늘어 bookDelta가 그만큼 움직인다.
//    흡수 문턱이 흐름의 50%라 대부분 무해하지만, 흐름 대비 실현손익이 매우 크면 오판 여지가 남는다.
// ⚠️ **주식(gold 포함) 항목의 `investAmount`는 0으로 초기화된 뒤 갱신되지 않는다**(usePortfolioState
//    handleAddStock만 세팅, 편집 시 미유지 — 화면은 KrxGoldTable처럼 매입가×수량을 그때그때 계산한다).
//    그래서 `investAmount`만 읽으면 주식 원가가 통째로 빠져, "입금 후 같은 날 매수"에서 bookDelta가
//    0이 되어 정상 반영된 입금을 '미반영'으로 오판한다. 매입가×수량을 폴백으로 반드시 둘 것.
//    (`investAmount`가 권위인 것은 fund·savings뿐 — 그쪽은 매입가×수량 개념이 없다.)
//    `snapshotItemsFromPortfolio`가 purchasePrice·quantity를 보존하므로 과거 날짜도 산출된다.
// ⚠️ `costBasisOnly`(해외계좌 전용): 주식 항목의 `investAmount`를 **무시**하고 매입가×수량만 쓴다.
//    해외 항목의 `investAmount`는 **어떤 UI도 쓰지 않는 잔존 필드**다 — 해외 투자금액 칸이 쓰는
//    저장 필드는 `investAmountUsd`(위 `overseasInvestAmount` 참조)이고, 다른 원가 소비자도 전부
//    `investAmount`를 우회한다(`usePortfolioData` :41·:128, `useIntegratedData` 종목별 비중).
//    즉 해외 항목의 `investAmount`에는 **레거시·PasteModal 임포트 데이터의 원화 값이 남아 있을 수
//    있고**, 통합 경로는 이 장부액에 환율을 곱하므로(≈1,390배) 그런 항목 하나가 단위를 오염시켜
//    흡수 판정을 통째로 무너뜨린다 → 해외는 반드시 매입원가 기준으로 좁힌다.
//    ⚠️ '이제 해외도 투자금액을 저장하니 이 옵션은 불필요'는 **오답**이다 — 새 저장 필드는
//    `investAmountUsd`라 여기서 읽지 않고, 원화 잔존값 위험은 그대로다. 절대 제거하지 말 것.
//    ⚠️ 해외 장부는 `investAmountUsd`가 아니라 **미러 `purchasePrice × quantity`** 로 계산한다(의도) —
//    스냅샷(`snapshotItemsFromPortfolio`)이 보존하는 필드가 그 둘이라 과거 날짜도 같은 식으로 산출된다.
//    fund·savings는 매입가×수량 개념이 없어 `investAmount`가 권위이므로 예외로 유지한다.
export const bookCostOf = (items, opts?) => {
  const costBasisOnly = !!(opts && opts.costBasisOnly);
  return (items || []).reduce((s, it) => {
    if (!it) return s;
    if (it.type === 'deposit') return s + cleanNum(it.depositAmount);
    const investAuthoritative = it.type === 'fund' || it.type === 'savings';
    const stored = cleanNum(it.investAmount);
    if (stored > 0 && (investAuthoritative || !costBasisOnly)) return s + stored;
    return s + cleanNum(it.purchasePrice) * cleanNum(it.quantity);
  }, 0);
};

// 계좌의 날짜별 장부액 Map. ⚠️ `resolveHoldings`가 '추정'(스냅샷 없음·미검증 pre-baseline)인 날짜는
// 구성이 불확실하므로 **넣지 않는다** — 소비자는 미제공을 만나면 기존 ΔV 휴리스틱으로 폴백한다.
// opts.rateOf(date): 장부액을 흐름·평가액과 같은 통화로 맞추는 날짜별 환산율(미전달 시 1 = 원화 계좌).
//   ⚠️ 해외계좌는 장부가 USD다. 소비자의 V와 흐름이 원화 환산이면(통합 대시보드) 반드시 **같은
//   소스의 날짜별 환율**(calcPortfolioEvalDetail와 동일: getClosestValue(usdkrw, date))을 넘겨야
//   bookDelta가 흐름과 같은 단위가 된다. 넘기지 않으면 단위가 어긋나 보류 판정이 무의미해진다.
// opts.costBasisOnly: 위 bookCostOf 참조 — 해외계좌는 반드시 true(잔존 원화 investAmount 오염 차단).
// ⚠️ 두 옵션은 **항상 함께** 쓴다: rateOf만 주면 원화 investAmount에 환율이 곱해진다.
export const buildBookCostSeries = (p, dates, opts?) => {
  const m = new Map();
  const rate = opts && typeof opts.rateOf === 'function' ? opts.rateOf : null;
  const costBasisOnly = !!(opts && opts.costBasisOnly);
  for (const d of dates || []) {
    if (!d || m.has(d)) continue;
    const r = resolveHoldings(p, d);
    if (!r || r.estimated) continue;
    const fx = rate ? (cleanNum(rate(d)) || 1) : 1;
    m.set(d, bookCostOf(r.items, { costBasisOnly }) * fx);
  }
  return m;
};

// 인접한 두 기록일의 장부액 차이. 어느 한쪽이라도 미확보면 null(=폴백).
export const bookDeltaBetween = (bookByDate, prevDate, date) => {
  if (!bookByDate || !prevDate) return null;
  const a = bookByDate.get(prevDate), b = bookByDate.get(date);
  return (a != null && b != null) ? b - a : null;
};

// 일간 지표 시계열 — 보류된 행의 미소진 흐름을 다음 행으로 이월한다.
// ⚠️ 통합(useIntegratedData)·개별 계좌(HistoryPanel)·CSV(buildHistoryCSV) 세 소비자가 반드시
//    이 한 함수를 공유할 것. 한쪽에만 이월을 두면 같은 날짜에 통합 +1.59% vs 개별 +9.10%로
//    두 화면이 정면 모순되고, 고치려던 '입금액=수익' 버그가 개별 뷰에 그대로 살아남는다.
// ⚠️ 이월을 빼지 말 것 — 보류 행에서 흐름을 소각하면 다음 기록일 ΔV에 입금액이 그대로 남아
//    같은 버그가 하루 밀려 재발한다(주말 행은 fillNonTradingGaps·백필 치유로 항상 존재하고
//    buildCloseEvalSeries가 직전 정확값을 이월하므로 흔한 경로다).
// rows: [{ date, evalAmount, flowIn, flowOut, ledger?, flowSuspect?, bookDelta? }] — 반드시 날짜 오름차순
//   bookDelta: 전일 대비 장부액(Σ 예수금+매입원가) 변화. 있으면 보류 판정이 추측 대신 관측을 쓴다(권장).
// 반환: Map<date, { dodAbsChange, dodChange, ledgerFlow, held }>
// 이월 상한 — 흡수되지 않은 흐름을 언제까지 들고 갈 것인가.
//  · FROZEN(ΔV=0, 비거래일 carry-forward): KR 최장 연휴(설·추석+주말, 실측 최장 6일)를 덮어야 한다.
//  · ACTIVE(ΔV≠0, 거래일): 오탐 보류일 가능성이 있으므로 짧게. 상한을 넘기면 이월을 **폐기**하고
//    정상 산출로 복귀한다 — 계속 보류하면 화면이 몇 주씩 '-'로 잠긴다(틀린 숫자보다는 낫지만 과하다).
const CARRY_MAX_ROWS = 15;
const CARRY_MAX_ACTIVE_ROWS = 2;
const ACTIVE_DRIFT_RATIO = 0.05; // 흐름 대비 이만큼도 안 움직인 행은 '거래일 보류'로 세지 않는다
export const computeDailyMetricsSeries = (rows) => {
  const out = new Map();
  let carryIn = 0, carryOut = 0, carryLedger = 0, carryRows = 0, activeRows = 0;
  const list = Array.isArray(rows) ? rows : [];
  let prev = null; // ⚠️ list[i-1]이 아니라 '직전 유효 행' — 무효 행을 건너뛰면 기준이 어긋난다
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (!h || !h.date) continue;
    if (!prev) {
      // 첫 행은 비교 대상이 없다. ⚠️ 이 행의 흐름을 이월하지 말 것 — 계좌 편입 평가액이라
      //    이미 V에 반영돼 있어, 이월하면 두 번째 행이 그만큼 가짜 손실로 찍힌다.
      out.set(h.date, { dodAbsChange: null, dodChange: 0, ledgerFlow: 0, held: true });
      prev = h;
      continue;
    }
    const prevV = prev.evalAmount;
    const dV = h.evalAmount - prevV;
    const ownIn = h.flowIn || 0, ownOut = h.flowOut || 0;
    const ownLedger = h.ledger != null ? h.ledger : (ownIn - ownOut);
    // 1차 — 이월을 실은 채 판정한다. 이 행이 흐름을 흡수했다면(held=false) 이월을 그대로 소비한다.
    let fIn = ownIn + carryIn, fOut = ownOut + carryOut, ledger = ownLedger + carryLedger;
    const bookDelta = h.bookDelta != null ? h.bookDelta : null;
    let held = !!h.flowSuspect || shouldHoldDailyMetrics(prevV, h.evalAmount, fIn - fOut, bookDelta);
    // 2차 — 여전히 보류인데 상한을 넘겼으면 이월을 폐기하고 자기 흐름만으로 재산출한다.
    // ⚠️ 폐기를 '루프 진입부에서 무조건'으로 되돌리지 말 것 — 흐름을 흡수하는 바로 그 행에서
    //    이월이 버려져 입금액 전액이 하루 수익으로 찍힌다(고치려던 +9.10% 버그가 그대로 재현).
    // ⚠️ ACTIVE 폐기는 **bookDelta가 없을 때(ΔV 추측)만** 적용한다. 장부 관측이 있으면 '아직
    //    반영 안 됨'이 확정 사실이므로, 폐기하면 흐름 전액이 그날 가짜 손익으로 찍힌다(출금 원장일과
    //    예수금 수정일이 며칠 어긋나는 것은 구조적으로 정상 — DepositPanel은 평가액을 건드리지 않는다).
    //    FROZEN 상한(CARRY_MAX_ROWS)은 그대로 적용돼 무한 이월은 막는다.
    if (held && (carryRows >= CARRY_MAX_ROWS || (bookDelta == null && activeRows >= CARRY_MAX_ACTIVE_ROWS))) {
      carryIn = 0; carryOut = 0; carryLedger = 0; carryRows = 0; activeRows = 0;
      fIn = ownIn; fOut = ownOut; ledger = ownLedger;
      held = !!h.flowSuspect || shouldHoldDailyMetrics(prevV, h.evalAmount, fIn - fOut, bookDelta);
    }
    const netFlow = fIn - fOut;
    out.set(h.date, {
      dodAbsChange: held ? null : dV - netFlow,
      dodChange: held ? 0 : dailyFlowAdjustedRate(prevV, h.evalAmount, fIn, fOut),
      // 배지는 실제로 보정에 쓰인 행에만 — 이월 중인 행에 찍으면 %와 어긋나 보인다
      ledgerFlow: held ? 0 : ledger,
      held,
    });
    // flowSuspect(오늘 라이브 이상치)는 항상 마지막 행이라 이월 대상이 아니다
    if (held && !h.flowSuspect && netFlow !== 0) {
      carryIn = fIn; carryOut = fOut; carryLedger = ledger;
      carryRows += 1;
      // ⚠️ `dV !== 0`으로 세지 말 것 — crypto(24시간 시장)·예적금(일 단위 단리)을 보유하면
      //    비거래일에도 총자산이 몇십만 원씩 움직여, 주말 2행만으로 ACTIVE 예산이 소진되고
      //    월요일에 이월이 폐기돼 원래 버그가 재현된다. 흐름 대비 유의미한 변동만 센다.
      if (Math.abs(dV) > Math.abs(netFlow) * ACTIVE_DRIFT_RATIO) activeRows += 1;
    } else {
      carryIn = 0; carryOut = 0; carryLedger = 0; carryRows = 0; activeRows = 0;
    }
    prev = h;
  }
  return out;
};

// 누적 TWR(Time-Weighted Return) — 일간 보정 수익률의 곱셈 체인. 개별 계좌 차트 '조회시작 0%' 모드의 라인.
// 왜 곱셈 체인인가(두 대안이 모두 입출금에 왜곡되기 때문):
//   · V(t) ÷ V(시작) − 1  → 입금액이 분자에 그대로 들어가 부풀어 오른다(실측 +747%, 실손익은 −536만).
//   · (V − C) ÷ C         → 입금일에 분모 C가 급증해 시장이 안 움직여도 수익률이 절벽처럼 꺾인다.
//   일간 r(t)는 computeDailyMetricsSeries가 이미 흐름을 제거한 값이므로, 그 곱은 입출금 규모와
//   무관한 순수 시장 성과가 된다. 부수 효과로 지수·비교종목 라인(0% 정규화 가격비)과 같은 축에서 비교 가능.
// ⚠️ held 행(주말 carry-forward·미반영 흐름)은 **배율 1.0**(직전값 유지)이다 — 일간 표시 계약
//    (dodAbsChange=null → '-')과 다른 것이 **정상**이다. null로 빼면 주말마다 선이 끊기고, 보류된
//    흐름은 computeDailyMetricsSeries가 다음 행으로 이월하므로 곱은 그대로 정확하다.
// ⚠️ 곱셈 체인은 하루짜리 이상치를 **영구 고정**한다(원금대비 방식은 다음 날 자동 복구된다).
//    그래서 입력 평가액은 반드시 buildCloseEvalSeries(allExact·!estimated 게이트)를 통과한 값이어야 한다.
// rows: computeDailyMetricsSeries와 **동일 형식·동일 정렬**(날짜 오름차순)
// 반환: Map<date, 누적 TWR %> — 첫 행은 항상 0
export const computeCumulativeTwrSeries = (rows) => {
  const metrics = computeDailyMetricsSeries(rows);
  const out = new Map();
  const list = Array.isArray(rows) ? rows : [];
  let factor = 1;
  for (const h of list) {
    if (!h || !h.date) continue;
    const m = metrics.get(h.date);
    const r = (m && !m.held) ? (m.dodChange || 0) : 0;
    const next = factor * (1 + r / 100);
    // 평가액 0 + 출금 기록 없음(= r −100%)은 실제 전손보다 '데이터 누락'일 확률이 압도적이다.
    // 곱이 0이 되면 이후 전 구간이 −100%로 영구 고정되므로 그런 행은 배율 1(보류)로 취급한다.
    if (Number.isFinite(next) && next > 0) factor = next;
    out.set(h.date, (factor - 1) * 100);
  }
  return out;
};

// 누적 TWR 재베이스 — 조회구간 시작을 0%로 맞춘다. (1+TWR(t)) ÷ (1+TWR(base)) − 1
// ⚠️ 구간만 잘라 체인하지 말 것: 첫 행이 held(비교 대상 없음)라 경계에서 흐름 이월 상태가 끊긴다.
//    전체 이력에서 한 번 누적하고 표시 시점에 나눠야 조회구간을 바꿔도 곡선 모양이 불변이다.
export const rebaseTwr = (twr, baseTwr) => {
  if (twr == null) return null;
  const b = baseTwr == null ? 0 : baseTwr;
  const denom = 1 + b / 100;
  if (!(denom > 0)) return null;
  const r = ((1 + twr / 100) / denom - 1) * 100;
  return Number.isFinite(r) ? r : null;
};

// 해외계좌 차트용 USD 평가액 — 현재 보유 × 해당일 USD 종가(환율 미적용, 예수금은 USD 그대로).
// ⚠️ App.tsx finalChartData 해외 분기와 개별 계좌 누적 TWR이 반드시 이 한 함수를 공유할 것.
//    한쪽만 자체 계산으로 되돌리면 같은 날짜에 라인과 %가 갈린다.
// 반환: USD 평가액 (가격/예수금 데이터가 하나도 없으면 null)
export const overseasUsdEvalAt = (items, date, stockHistoryMap) => {
  let usd = 0, hasData = false;
  for (const item of items || []) {
    if (!item) continue;
    if (item.type === 'deposit') { usd += cleanNum(item.depositAmount); hasData = true; }
    else if (item.code && stockHistoryMap?.[item.code]) {
      const p = getClosestValue(stockHistoryMap[item.code], date);
      if (p) { usd += p * item.quantity; hasData = true; }
    }
  }
  return hasData ? usd : null;
};

// 수동 anchor + delta: D에서 수동 설정한 원금이 다음 anchor 전까지 자동 전파.
// 전파값 = anchor.principal + (cum_deposits(date) - cum_deposits(anchor.date))
// anchor 없으면 { value: null } → 호출측이 기존 로직으로 폴백.
export const computeEffectivePrincipal = (date, history, depositHistory, depositHistory2, isOverseas) => {
  if (!Array.isArray(history) || history.length === 0) return { value: null, anchor: null };
  let anchor = null;
  for (const h of history) {
    if (!h.principalManual) continue;
    if (cleanNum(h.principal) <= 0) continue;
    if ((h.date || '') > date) continue;
    if (!anchor || (h.date || '') > (anchor.date || '')) anchor = h;
  }
  if (!anchor) return { value: null, anchor: null };
  const cumAtDate = cumDepositsUpTo(date, depositHistory, depositHistory2);
  const cumAtAnchor = cumDepositsUpTo(anchor.date, depositHistory, depositHistory2);
  return { value: cleanNum(anchor.principal) + (cumAtDate - cumAtAnchor), anchor };
};

// 기록(history record)이 있는 날짜의 투자원금.
// ⚠️ 개별 계좌 차트의 '나의 수익률'(App.tsx finalChartData)과 '자산 평가액 추이' 표의 누적(원금대비)
//    컬럼이 **반드시 이 함수를 공유**해야 한다. 한쪽만 자체 계산으로 되돌리면 같은 날짜에 두 화면이
//    서로 다른 누적 수익률을 표시한다(일간 지표의 computeDailyMetricsSeries 단일 소스 규약과 동일한 이유).
//   우선순위: 수동 anchor 전파값 > 그 기록의 principal > 직전 기록의 principal > 계좌 principal 필드
//   effectiveValue: 호출부가 이미 구한 computeEffectivePrincipal(...).value —
//   날짜 루프 안에서 재계산하지 않도록 값으로 받는다(O(n²) 중복 방지).
export const resolveRecordPrincipal = (effectiveValue, record, date, sortedHistAsc, principalProp) => {
  if (effectiveValue != null) return effectiveValue;
  const stored = cleanNum(record?.principal);
  if (stored > 0) return stored;
  const list = sortedHistAsc || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (h && h.date < date && cleanNum(h.principal) > 0) return cleanNum(h.principal);
  }
  return cleanNum(principalProp);
};

// 해외(overseas) 계좌의 날짜별 투자원금(USD). 원장(입금 − 출금)을 그 날짜까지 적산하고,
// principal 필드(USD 수동 입력)를 하한으로 둔다(depositHistory가 일부만 있을 때 과대 수익률 방지).
// ⚠️ 해외 계좌는 `resolveRecordPrincipal`(원화 계좌용)을 쓰지 않으므로 이 함수가 그 자리를 대신한다 —
//    개별 계좌 차트 '나의 수익률'(App.tsx finalChartData 해외 분기)과 '자산 평가액 추이' 표의
//    누적(HistoryPanel cumulativeByDate)이 **반드시 공유**해야 한다. 한쪽만 principal 필드를 전 행에
//    평탄 적용하면 출금이 있는 계좌에서 출금 이전 과거 행의 원금·수익금이 두 화면에서 갈린다
//    (출금 시 principal 필드만 principalDeducted만큼 줄기 때문).
// sortedDeposits/sortedWithdrawals: 날짜 오름차순(조기 break 전제).
export const overseasPrincipalAt = (date, sortedDeposits, sortedWithdrawals, principalProp, portfolioStartDate) => {
  let amount = 0;
  for (const d of sortedDeposits || []) { if (d.date > date) break; if (!d.noPrincipal) amount += cleanNum(d.amount); }
  for (const w of sortedWithdrawals || []) { if (w.date > date) break; if (!w.noPrincipal) amount -= w.principalDeducted != null ? cleanNum(w.principalDeducted) : cleanNum(w.amount); }
  const prin = cleanNum(principalProp);
  if (amount === 0 && date >= (portfolioStartDate || '') && prin > 0) amount = prin;
  if (amount > 0 && prin > amount) amount = prin;
  return amount;
};

// ── 종목 계좌 간 이관 (transfer) ─────────────────────────────────────────────────
// 이관은 "원계좌 출금 + 대상계좌 입금"이라는 **실제 자금 이동**으로 기록한다. 그래야
// Modified Dietz 일간 지표(computeDailyMetricsSeries)가 그 흐름을 정확히 상쇄해, 이관일에
// 원계좌 −평가액 / 대상계좌 +평가액이 가짜 손익으로 찍히는 것을 막는다(수익률 라인이 누적
// TWR = 곱셈 체인이라 하루짜리 오류가 이후 전 구간에 **영구 고정**된다).
//
// ⚠️ 3행 구성인 이유 — "흐름은 시가(M) · 원금은 매입원가(C)"를 신규 저장 필드 없이 동시에 만족시킨다.
//   · 출금 행은 principalDeducted로 그 분리를 네이티브 지원한다 → 원계좌는 1행이면 충분
//     (amount = M → 유출 M / principalDeducted = C → 원금 −C).
//   · 입금 행에는 대응 필드가 없어 amount 하나가 흐름과 원금을 동시에 결정한다. 그래서 입금은
//     M(유입 M)으로 넣고, 차액 G = M − C를 **금액 0 · principalDeducted = G 인 출금 행**으로 상쇄한다.
//     금액이 0이라 흐름에는 전혀 기여하지 않고(externalFlowInRange·통합 ①의 `v > 0 / v < 0` 어느
//     분기에도 안 걸린다), cumDepositsUpTo만 principalDeducted를 빼 원금이 M − G = C가 된다.
//   ⚠️ 이 보정 행을 `amount: -G`(음수 출금)로 되돌리지 말 것 — 이익 포지션에서는 유입이 C + G = M으로
//      맞지만, **손실 포지션(G < 0)에서는 양수 출금**이 되어 유입 C · 유출 |G|로 갈라진다. 순흐름은
//      여전히 M이라 일간 '손익'은 맞지만, 일간 '수익률'의 분모가 prev + M이 아니라 prev + C가 되어
//      이익/손실 포지션의 규약이 갈리고 그 차이가 누적 TWR(곱셈 체인)에 영구 고정된다.
//   이 구성으로 원금 산출 4경로(App.tsx finalChartData epochBase 역산 / computeEffectivePrincipal /
//   overseasPrincipalAt / useIntegratedData effectivePrincipal)의 **과거 값이 전부 불변**이고,
//   통합 effectivePrincipal의 원계좌 +G와 대상계좌 −G가 정확히 상쇄된다.
// ⚠️ 세 행의 (amount, principalDeducted) 조합을 바꾸지 말 것 — 하나만 흔들려도 어느 한 화면의
//    과거 원금 라인이 미실현손익만큼 소급 이동한다. 검증: `npm run verify:transfer`.
// ⚠️ noPrincipal을 쓰지 말 것 — 입금의 noPrincipal은 흐름 IN에서도 제외되고(배당·이자 규약),
//    출금의 noPrincipal은 원금에서만 빠져 흐름에는 전액 남는다. 둘 다 이관 의미와 다르다.
//
// M(시가)은 '이관 기록일 직전 기록일의 종가 × 수량'이다 — 화면의 실시간 평가금액이 아니다.
// 장중 이관이면 그 종목은 당일 V에서 통째로 빠지므로 마지막 기여분이 직전 기록일 종가이고,
// 실시간가를 쓰면 그날 장중 등락분이 양쪽 계좌에 반대 부호의 가짜 손익으로 남는다.
export const buildTransferLedgerRows = (args: any) => {
  const a = args || {};
  const M = cleanNum(a.market);
  const C = cleanNum(a.cost);
  const G = M - C;
  const qty = cleanNum(a.quantity);
  const srcName = String(a.sourceName || '').trim() || '계좌';
  const tgtName = String(a.targetName || '').trim() || '계좌';
  const meta = {
    id: a.transferId || '',
    code: String(a.code || ''),
    name: String(a.name || ''),
    quantity: qty,
    market: M,
    cost: C,
    itemType: a.itemType || 'stock',
    fromId: a.sourceId || '', fromName: srcName,
    toId: a.targetId || '', toName: tgtName,
  };
  const unit = a.itemType === 'fund' ? '좌' : a.itemType === 'savings' ? '' : '주';
  const label = `${meta.name || meta.code || '종목'}${qty > 0 && unit ? ` ${formatNumber(qty)}${unit}` : ''}`;
  const ids = Array.isArray(a.rowIds) ? a.rowIds : [];
  return {
    srcWithdrawal: {
      id: ids[0] || generateId(), date: a.dateSrc, amount: M, principalDeducted: C,
      fxRate: 1, noPrincipal: false,
      memo: `[이관→${tgtName}] ${label}`,
      transfer: { ...meta, role: 'out' },
    },
    tgtDeposit: {
      id: ids[1] || generateId(), date: a.dateTgt, amount: M,
      fxRate: 1, noPrincipal: false,
      memo: `[이관←${srcName}] ${label}`,
      transfer: { ...meta, role: 'in' },
    },
    // 평가차익이 0이면 행을 만들지 않는다(원장 노이즈 방지 — 흐름·원금 모두 이미 정확).
    // 금액 0 = 현금 이동 없음(흐름 기여 0), principalDeducted = G 만큼 원금만 되돌린다.
    tgtGainRow: Math.round(G) === 0 ? null : {
      id: ids[2] || generateId(), date: a.dateTgt, amount: 0, principalDeducted: G,
      fxRate: 1, noPrincipal: false,
      memo: `[이관←${srcName}] ${label} 평가차익 ${G > 0 ? '+' : ''}${formatNumber(Math.round(G))} — 원금 보정(금액 이동 없음)`,
      transfer: { ...meta, role: 'gain' },
    },
  };
};

// 계좌의 이관 기록 수집 — 메모 달력이 '언제·어떤 종목·몇 주가 이관됐는지'를 라이브 파생하는 소스.
// ⚠️ calendarMemos에 복사하지 말 것(투자기록·수량변경 파생과 동일 계약) — 원장이 유일한 원본이다.
//    복사하면 DepositPanel에서 원장을 고쳤을 때 달력만 옛 값을 들고 있어 두 화면이 갈린다.
// ⚠️ role 'gain'(평가차익 보정 행)은 제외한다 — 같은 이관이 한 칸에 두 번 뜬다.
export const collectTransferRows = (p: any): any[] => {
  const out: any[] = [];
  const scan = (list: any) => (Array.isArray(list) ? list : []).forEach((r: any) => {
    const t = r && r.transfer;
    if (!t || typeof t !== 'object' || t.role === 'gain') return;
    if (!r.date || typeof r.date !== 'string') return;
    out.push({ ...t, date: r.date, rowId: r.id, amount: cleanNum(r.amount) });
  });
  scan(p?.depositHistory);
  scan(p?.depositHistory2);
  return out;
};

export const formatCurrency = (n) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(cleanNum(n));
export const formatPercent = (n) => cleanNum(n).toFixed(2) + '%';
export const formatNumber = (n) => (n === '' || n == null) ? '' : new Intl.NumberFormat('ko-KR').format(cleanNum(n));
export const formatFundPrice = (n) => (n === '' || n == null) ? '' : new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cleanNum(n));
export const formatChangeRate = (n) => {
  const s = cleanNum(n);
  return (s > 0 ? '▲' : s < 0 ? '▼' : '') + Math.abs(s).toFixed(2) + '%';
};

// ── 예적금(savings) 계산 헬퍼 ──
// 예적금 항목은 입금(deposits) 트랜치별로 연이율 단리 이자를 가입일부터 만기(또는 오늘)까지 누적한다.
// deposits: [{ id, date, amount }] — 없으면 investAmount를 시작일 기준 단일 원금으로 폴백.
export const savingsInvest = (item) =>
  (Array.isArray(item?.deposits) && item.deposits.length)
    ? item.deposits.reduce((s, d) => s + cleanNum(d?.amount), 0)
    : cleanNum(item?.investAmount);

// 날짜 → 일(day) 번호. 'YYYY-MM-DD'를 타임존 무관하게 캘린더 일자로 환산(시:분 오차 제거).
// 시각 단위 비교를 쓰면 입금일을 UTC 자정으로 파싱해 한국 오전엔 '미래'로 오판→스킵되는 버그가 있었음.
const toSavingsDayNum = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
    if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};
const savingsTodayDayNum = () => { const n = new Date(); return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000); };
// 적립 트랜치 목록: deposits 우선, 없으면 investAmount를 시작일 기준 단일 원금으로 폴백.
const savingsDeposits = (item) =>
  (Array.isArray(item?.deposits) && item.deposits.length)
    ? item.deposits
    : (cleanNum(item?.investAmount) > 0 ? [{ date: item?.startDate, amount: cleanNum(item.investAmount) }] : []);

// asOf(YYYY-MM-DD): 해당 날짜 기준 누적값. 미지정 시 오늘. 일(day) 단위로 계산하므로 입금 당일은
// 이자 0(평가금=원금), 다음 날부터 1일치 단리가 붙는다. 만기일 이후로는 만기일에서 누적 정지.
// 날짜별 history 백필에서 과거 평가액을 그 날짜 기준으로 산출(라이브 합산 경로는 asOf 미전달 → 오늘).
export const savingsEval = (item, asOf) => {
  const rate = cleanNum(item?.annualRate) / 100;
  const deposits = savingsDeposits(item);
  if (!deposits.length) return 0;
  const endDay = toSavingsDayNum(item?.endDate);
  const asOfDay = asOf ? toSavingsDayNum(asOf) : null;
  let upper = asOfDay != null ? Math.min(asOfDay, savingsTodayDayNum()) : savingsTodayDayNum();
  if (endDay != null && endDay < upper) upper = endDay; // 만기 도달 시 정지
  let evl = 0;
  for (const d of deposits) {
    const amt = cleanNum(d?.amount);
    if (amt <= 0) continue;
    const depDay = toSavingsDayNum(d?.date) ?? toSavingsDayNum(item?.startDate) ?? upper;
    if (depDay > upper) continue; // 그 시점 이후 적립분은 아직 미입금
    const days = Math.max(0, upper - depDay);
    evl += amt * (1 + rate * days / 365);
  }
  return Math.round(evl);
};

// 만기금액: 각 적립을 만기일(endDate)까지 연이율 단리로 누적(오늘 상한을 두지 않음).
// endDate 미설정이거나 적립이 없으면 0. savingsEval(item, endDate)는 min(asOf,오늘)로 캡되어
// 오늘값이 나오므로 만기 산출에는 쓸 수 없어 별도 함수로 둔다.
export const savingsMaturity = (item) => {
  const rate = cleanNum(item?.annualRate) / 100;
  const deposits = savingsDeposits(item);
  if (!deposits.length) return 0;
  const endDay = toSavingsDayNum(item?.endDate);
  if (endDay == null) return 0;
  let m = 0;
  for (const d of deposits) {
    const amt = cleanNum(d?.amount);
    if (amt <= 0) continue;
    const depDay = toSavingsDayNum(d?.date) ?? toSavingsDayNum(item?.startDate) ?? endDay;
    const days = Math.max(0, endDay - depDay);
    m += amt * (1 + rate * days / 365);
  }
  return Math.round(m);
};

// 단일 적립(트랜치)의 평가금: 입금일부터 asOf(미지정=오늘)까지 연이율 단리 누적. 만기 도달 시 만기에서
// 정지. 입금일이 asOf 이후(미입금)면 0. 모든 적립의 savingsDepositEval 합 = savingsEval(item)(불변식).
export const savingsDepositEval = (item, deposit, asOf) => {
  const rate = cleanNum(item?.annualRate) / 100;
  const amt = cleanNum(deposit?.amount);
  if (amt <= 0) return 0;
  const endDay = toSavingsDayNum(item?.endDate);
  const asOfDay = asOf ? toSavingsDayNum(asOf) : null;
  let upper = asOfDay != null ? Math.min(asOfDay, savingsTodayDayNum()) : savingsTodayDayNum();
  if (endDay != null && endDay < upper) upper = endDay;
  const depDay = toSavingsDayNum(deposit?.date) ?? toSavingsDayNum(item?.startDate) ?? upper;
  if (depDay > upper) return 0; // 아직 미입금
  const days = Math.max(0, upper - depDay);
  return Math.round(amt * (1 + rate * days / 365));
};

// 등락률 칸: 연이율을 1일치로 환산한 일일 수익률(%) 표시
export const formatSavingsDailyRate = (annualRate) => {
  const r = cleanNum(annualRate);
  if (r <= 0) return '-';
  return '▲' + (r / 365).toFixed(4) + '%';
};

// 투자기간 표시: "2년 3개월, 26/03~28/03"
export const formatSavingsPeriod = (startDate, endDate) => {
  if (!startDate && !endDate) return '';
  const fmt = (s) => { const p = (s || '').split('-'); return p.length >= 2 ? `${p[0].slice(2)}/${p[1]}` : ''; };
  const range = `${fmt(startDate)}~${fmt(endDate)}`;
  if (startDate && endDate) {
    const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
    if (!isNaN(ms) && ms > 0) {
      const totalMonths = Math.round(ms / 86400000 / 30.4375);
      const y = Math.floor(totalMonths / 12);
      const m = totalMonths % 12;
      const dur = y > 0 ? (m > 0 ? `${y}년 ${m}개월` : `${y}년`) : `${m}개월`;
      return `${dur}, ${range}`;
    }
  }
  return range;
};
export const formatShortDate = (s) => {
  if (!s) return '';
  const p = s.split('-');
  if (p.length === 3) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${p[0].substring(2)}/${p[1]}/${p[2]} (${days[new Date(s).getDay()]})`;
  }
  return s;
};
export const formatVeryShortDate = (s) => {
  if (!s) return '';
  const p = s.split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}` : s;
};

// ── 역사적 경기침체 구간 (차트 음영) ──
// NBER(전미경제연구소) 공식 미국 경기침체 구간 — FRED가 회색 음영으로 표시하는 것과 동일.
// 미국발 침체는 코스피 등 세계 증시에 파급되므로 '세계적 침체 구간' 참조로 사용한다.
// 신규 침체 발표 시(NBER 공식 확정 기준) 배열에 {start, end, label}을 1건 추가.
export const RECESSION_PERIODS: { start: string; end: string; label: string }[] = [
  { start: '1990-07-01', end: '1991-03-31', label: '90년대 초 침체' },
  { start: '2001-03-01', end: '2001-11-30', label: '닷컴 버블 붕괴' },
  { start: '2007-12-01', end: '2009-06-30', label: '글로벌 금융위기' },
  { start: '2020-02-01', end: '2020-04-30', label: '코로나19 침체' },
];

// 차트 category(날짜) 축에 맞춰 각 침체구간을 실제 데이터 날짜 경계로 스냅한다.
// XAxis가 category 축이라 ReferenceArea의 x1/x2는 데이터에 존재하는 날짜여야 정확히 렌더된다.
// dates: 'YYYY-MM-DD' 문자열 배열(정렬 여부 무관 — 내부에서 정렬 후 처리).
// 조회기간과 겹치는 침체구간만, 그 경계를 조회기간 안쪽 데이터 날짜로 클램프하여 반환.
export function recessionBandsForDates(
  dates: string[]
): { x1: string; x2: string; label: string }[] {
  if (!dates || dates.length < 2) return [];
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const bands: { x1: string; x2: string; label: string }[] = [];
  for (const r of RECESSION_PERIODS) {
    if (r.end < first || r.start > last) continue; // 조회기간과 미겹침
    const lo = r.start < first ? first : r.start;
    const hi = r.end > last ? last : r.end;
    const x1 = sorted.find(d => d >= lo);          // lo 이상인 첫 데이터 날짜
    let x2: string | undefined;                     // hi 이하인 마지막 데이터 날짜
    for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i] <= hi) { x2 = sorted[i]; break; } }
    if (x1 && x2 && x1 <= x2) bands.push({ x1, x2, label: r.label });
  }
  return bands;
}
export const getSeededRandom = (seedStr) => {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) hash = Math.imul(31, hash) + seedStr.charCodeAt(i) | 0;
  const x = Math.sin(hash++) * 10000;
  return x - Math.floor(x);
};
export const getClosestValue = (dataObj, targetDateStr) => {
  if (!dataObj) return null;
  let d = new Date(targetDateStr);
  for (let i = 0; i < 15; i++) {
    const ds = d.toISOString().split('T')[0];
    if (dataObj[ds] !== undefined) return dataObj[ds];
    d.setDate(d.getDate() - 1);
  }
  return null;
};

export const getIndexLatest = (histObj) => {
  if (!histObj || Object.keys(histObj).length === 0) return { val: null, chg: null };
  const dates = Object.keys(histObj).sort();
  const latest = histObj[dates[dates.length - 1]];
  const prev = dates.length >= 2 ? histObj[dates[dates.length - 2]] : null;
  const chg = (prev && prev > 0) ? ((latest / prev) - 1) * 100 : null;
  return { val: latest, chg };
};

const getRowFocusables = (el) => {
  const tr = el.closest('tr');
  if (!tr) return [];
  return Array.from(tr.querySelectorAll(
    'input:not([type="hidden"]):not([disabled]), select:not([disabled]), td[tabindex="0"]'
  ));
};

export const handleTableKeyDown = (e, colKey) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const tbody = e.target.closest('tbody');
    if (!tbody) return;
    const inputs = Array.from(tbody.querySelectorAll(`[data-col="${colKey}"]`));
    const idx = inputs.indexOf(e.target);
    const next = e.key === 'ArrowDown' ? inputs[idx + 1] : inputs[idx - 1];
    if (next) { next.focus(); next.select?.(); }
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const focusables = getRowFocusables(e.target);
    const idx = focusables.indexOf(e.target);
    const next = e.key === 'ArrowRight' ? focusables[idx + 1] : focusables[idx - 1];
    if (next) { next.focus(); next.select?.(); }
  }
};

export const handleReadonlyCellNav = (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const tr = e.target.closest('tr');
  const tbody = e.target.closest('tbody');
  if (!tr || !tbody) return;
  const focusables = getRowFocusables(e.target);
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const idx = focusables.indexOf(e.target);
    const next = e.key === 'ArrowRight' ? focusables[idx + 1] : focusables[idx - 1];
    if (next) { next.focus(); next.select?.(); }
  } else {
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const rowIdx = rows.indexOf(tr);
    const cellIdx = focusables.indexOf(e.target);
    const nextRow = e.key === 'ArrowDown' ? rows[rowIdx + 1] : rows[rowIdx - 1];
    if (nextRow) {
      const nf = Array.from(nextRow.querySelectorAll(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), td[tabindex="0"]'
      ));
      const target = nf[cellIdx] ?? nf[nf.length - 1];
      if (target) { target.focus(); target.select?.(); }
    }
  }
};

export const handleRowArrowNav = (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const focusables = getRowFocusables(e.target);
  const idx = focusables.indexOf(e.target);
  const next = e.key === 'ArrowRight' ? focusables[idx + 1] : focusables[idx - 1];
  if (next) { next.focus(); next.select?.(); }
};

// ASS-Page 자산검증: 기존 계좌(baselineDate 미보유)의 기준일 = 직전 거래일(2026-05-15 금)
// 신규 계좌는 생성 시 가입일(startDate)을 baselineDate로 설정한다.
export const BASELINE_DEFAULT_DATE = '2026-05-15';

// 종목의 수동 종가 오버라이드 키 (gold는 code가 없으므로 'GOLD' 사용)
const overrideKeyForItem = (item: any, isGold: boolean): string =>
  item?.code || (isGold ? 'GOLD' : '');

// 특정 날짜 이후 최대 forwardDays 일 안의 가장 가까운 다음 값 (주말/공휴일 이후 첫 거래일 폴백)
const getForwardValue = (dataObj: Record<string, number> | null | undefined, targetDateStr: string, forwardDays: number): number | null => {
  if (!dataObj) return null;
  let d = new Date(targetDateStr);
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < forwardDays; i++) {
    const ds = d.toISOString().split('T')[0];
    if (dataObj[ds] !== undefined) return dataObj[ds];
    d.setDate(d.getDate() + 1);
  }
  return null;
};

// 특정 날짜·종목의 단가 결정: 수동입력(manualPriceOverrides) 최우선 → 이력 → 순방향 근사 → 0
const resolvePriceForItem = (
  item: any,
  date: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  isGold: boolean,
  manualPriceOverrides?: Record<string, Record<string, number>> | null
): { price: number; source: 'manual' | 'history' | 'approximate' | 'none' } => {
  const ovKey = overrideKeyForItem(item, isGold);
  const manualRaw = ovKey ? manualPriceOverrides?.[ovKey]?.[date] : undefined;
  if (manualRaw != null && cleanNum(manualRaw) > 0) {
    return { price: cleanNum(manualRaw), source: 'manual' };
  }
  let price = 0;
  if (isGold) price = getClosestValue(indicatorHistoryMap?.goldKr, date) || 0;
  else if (item?.code) price = getClosestValue(stockHistoryMap?.[item.code], date) || 0;
  if (price > 0) return { price, source: 'history' };
  // 소급 조회 실패 시 최대 5거래일 순방향 조회 (주말·휴장일 검증 시 직후 첫 거래일가 활용)
  const dataObj = isGold ? indicatorHistoryMap?.goldKr : (item?.code ? stockHistoryMap?.[item.code] : null);
  const fwdPrice = getForwardValue(dataObj, date, 5) || 0;
  return fwdPrice > 0 ? { price: fwdPrice, source: 'approximate' } : { price: 0, source: 'none' };
};

// 특정 날짜의 종목별 평가 내역 + 합계 (검증 모달 P2가 사용)
export const calcPortfolioEvalDetail = (
  items: any[],
  accountType: string,
  date: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  currentFxRate = 1,
  manualPriceOverrides?: Record<string, Record<string, number>> | null
): { total: number; fxRate: number; items: any[]; hasAnyPrice: boolean; allExact: boolean } => {
  const isGold = accountType === 'gold';
  const isOverseas = accountType === 'overseas';
  const fxRate = isOverseas
    ? (getClosestValue(indicatorHistoryMap?.usdkrw, date) || currentFxRate || 1)
    : 1;
  let totalEval = 0;
  let hasAnyPrice = false;
  const detail: any[] = [];
  (items || []).forEach(item => {
    if (item.type === 'deposit') {
      const evl = cleanNum(item.depositAmount) * fxRate;
      totalEval += evl;
      hasAnyPrice = true;
      detail.push({ id: item.id, type: 'deposit', code: '', name: '예수금', quantity: null, price: null, source: 'deposit', eval: evl });
      return;
    }
    if (item.type === 'fund') {
      // 펀드: 수동입력 → 해당 날짜 NAV 이력 → 현재 평가액 폴백 (일일 평가액에서 누락 금지)
      const fQty = cleanNum(item.quantity);
      const { price: histPrice, source } = resolvePriceForItem(item, date, stockHistoryMap, indicatorHistoryMap, false, manualPriceOverrides);
      let evl = 0;
      let usedSource: string = source;
      if (fQty > 0 && histPrice > 0) evl = fQty * histPrice * fxRate;
      else if (fQty > 0 && cleanNum(item.currentPrice) > 0) { evl = fQty * cleanNum(item.currentPrice) * fxRate; usedSource = 'currentPrice'; }
      else { evl = cleanNum(item.evalAmount) * fxRate; usedSource = 'evalAmount'; }
      if (evl > 0) { totalEval += evl; hasAnyPrice = true; }
      detail.push({ id: item.id, type: 'fund', code: item.code || '', name: item.name || '', quantity: fQty, price: histPrice || (usedSource === 'currentPrice' ? cleanNum(item.currentPrice) : null), source: usedSource, eval: evl });
      return;
    }
    if (item.type === 'savings') {
      // 예적금: 연이율 단리 누적 평가액 (해당 날짜 기준 — 과거 백필 시 그날까지만 누적)
      const evl = savingsEval(item, date) * fxRate;
      if (evl > 0) { totalEval += evl; hasAnyPrice = true; }
      detail.push({ id: item.id, type: 'savings', code: '', name: item.name || '예적금', quantity: null, price: null, source: 'savings', eval: evl });
      return;
    }
    const qty = cleanNum(item.quantity);
    if (!qty || qty <= 0) return;
    const { price, source } = resolvePriceForItem(item, date, stockHistoryMap, indicatorHistoryMap, isGold, manualPriceOverrides);
    const evl = price > 0 ? qty * price * fxRate : 0;
    if (evl > 0) { totalEval += evl; hasAnyPrice = true; }
    detail.push({ id: item.id, type: 'stock', code: item.code || '', name: item.name || (isGold ? 'KRX 금현물' : ''), quantity: qty, price: price || null, source, eval: evl });
  });
  // allExact: 모든 가격 종목이 '그 날짜의 정확한 종가/NAV'(또는 manual/deposit/savings)로 평가됐는지.
  // source가 'history'여도 stockHistoryMap[code][date]/goldKr[date] 키가 없으면 getClosestValue 소급
  // 근사(carry-back)이므로 exact 아님 → 종가 확정 기반 표시/기록의 게이트로 사용(useAutoConfirmHistory와 동일 판정).
  const allExact = detail.every(it => {
    if (it.source === 'deposit' || it.source === 'savings' || it.source === 'manual') return true;
    if (it.source !== 'history') return false;
    const src = isGold ? (indicatorHistoryMap?.goldKr || {}) : (it.code ? (stockHistoryMap?.[it.code] || {}) : {});
    return src[date] != null;
  });
  return { total: hasAnyPrice ? totalEval : 0, fxRate, items: detail, hasAnyPrice, allExact: hasAnyPrice && allExact };
};

// 평가액 시계열을 계산할 날짜 집합 = 기록일(history) ∪ 구성 변경일(holdingSnapshots).
// ⚠️ 구성 변경일을 빼지 말 것(회귀 주의 — 종목 이관 이중 계상): 종목을 전부 다른 계좌로 옮겨
//    비운 계좌는 currentEval이 0이라 그날 라이브 기록이 만들어지지 않는다(useHistoryBackfill
//    효과#1의 `currentEval === 0` skip). 기록일만 평가하면 '비운 날'이 시계열에서 통째로 빠져
//    직전 구성이 carry-forward로 살아남고, 대상계좌는 같은 날 그 종목을 이미 반영하므로 그날
//    총자산이 이관 금액만큼 부풀려진다.
// ⚠️ 상한(effectiveDateKey): 21:00 이후 KR 구성 변경 스냅샷은 '내일' 날짜로 찍히므로
//    (getBackfillBoundaryKR) 미래 날짜가 시계열에 들어오지 않게 자른다.
// ⚠️ 통합(useIntegratedData marketSeries)·개별 차트(App activeCloseEvalByDate)·추이 표
//    (HistoryPanel displayEvalByDate)가 **같은 함수**를 써야 세 화면의 그날 평가액이 일치한다.
export const evalSeriesDates = (p: any, histDates: string[], effectiveDateKey: string): string[] => {
  const hd = [...new Set((histDates || []).filter(Boolean))];
  if (hd.length === 0) return [];
  const first = hd.slice().sort()[0];
  const snaps = (p?.holdingSnapshots || [])
    .map((s: any) => s?.date)
    .filter((d: string) => d && d > first && (!effectiveDateKey || d < effectiveDateKey));
  return [...new Set([...hd, ...snaps])].sort();
};

// 종가 확정 기반 평가액 시계열(carry-forward). 자산 평가액 추이·차트·통합 대시보드가 공용으로 사용해
// '저장된 라이브 값'이 아니라 항상 '수량 × 종가'를 표시하기 위한 단일 소스.
//  각 날짜에 대해:
//   - 정확 종가 완비(allExact) & 보유수량 확정 → 수량 × 종가 재계산값 (검증 모달 '재계산 합계'와 동일)
//   - 주말·공휴일·종가 미로드일·추정 수량 → 직전 정확값을 이월(carry-forward) — carry-back 근사로 튀지 않게
//   - 첫 정확값 이전 or 오늘(effectiveDateKey) → map 미설정 → 호출부가 저장값/라이브값으로 폴백
// 반환: Map<date, number> (정확값 또는 이월값이 있는 날짜만). 호출부는 `map.get(date) ?? 저장값`으로 사용.
export const buildCloseEvalSeries = (
  p: any,
  dates: string[],
  accountType: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  effectiveDateKey: string,
  fxRate = 1
): Map<string, number> => {
  const map = new Map<string, number>();
  if (!p) return map;
  const mpo = p.manualPriceOverrides || {};
  const sorted = [...new Set(dates.filter(Boolean))].sort();
  let lastClose: number | null = null;
  for (const date of sorted) {
    if (date === effectiveDateKey) continue; // 오늘=라이브 → 호출부 처리(미설정)
    let closeVal: number | null = null;
    const resolved = resolveHoldings(p, date);
    if (!resolved.estimated) {
      const r = calcPortfolioEvalDetail(resolved.items, accountType, date, stockHistoryMap, indicatorHistoryMap || {}, fxRate, mpo);
      if (r.hasAnyPrice && r.allExact) closeVal = r.total;
      // ⚠️ '평가할 포지션이 하나도 없음'과 '가격을 못 구함'을 구분한다(이월 금지 — 회귀 주의).
      //    종목을 전부 다른 계좌로 이관/매도해 비운 계좌는 그날부터 평가액이 **진짜 0**인데,
      //    hasAnyPrice=false(가격 종목 0건)를 '데이터 공백'으로 보고 직전 값을 이월하면 이미
      //    옮겨간 종목이 원계좌에 영구히 남아 대상계좌와 **이중 계상**된다.
      //    detail이 비었다 = 예수금·펀드·예적금·수량>0 종목이 전부 없다 = 평가 대상 자체가 없다.
      else if (r.items.length === 0) closeVal = 0;
    }
    if (closeVal != null) { lastClose = closeVal; map.set(date, closeVal); }
    else if (lastClose != null) map.set(date, lastClose);
    // else: 미설정 → get() undefined → 호출부 저장값 폴백
  }
  return map;
};

export const calcPortfolioEvalForDate = (
  items: any[],
  accountType: string,
  date: string,
  stockHistoryMap: Record<string, Record<string, number>>,
  indicatorHistoryMap: Record<string, any>,
  currentFxRate = 1,
  manualPriceOverrides?: Record<string, Record<string, number>> | null
): number =>
  calcPortfolioEvalDetail(items, accountType, date, stockHistoryMap, indicatorHistoryMap, currentFxRate, manualPriceOverrides).total;

// 포트폴리오 항목 → 스냅샷 아이템 (수량·매입금액·구성 보존).
// purchasePrice/currentPrice/evalAmount는 시점별 수익률 차트의 매입금액·평가 폴백용
// (해외·금 계좌 매입단가, 펀드 과거 NAV 폴백). snapshotCompositionKey는 이 필드들을
// 키에 넣지 않으므로 가격 변동만으로 스냅샷이 새로 쌓이지 않는다.
export const snapshotItemsFromPortfolio = (items: any[]): any[] =>
  (items || []).map(it => ({
    code: it.code || '',
    name: it.name || '',
    type: it.type || 'stock',
    quantity: cleanNum(it.quantity),
    investAmount: cleanNum(it.investAmount),
    depositAmount: cleanNum(it.depositAmount),
    purchasePrice: cleanNum(it.purchasePrice),
    currentPrice: cleanNum(it.currentPrice),
    evalAmount: cleanNum(it.evalAmount),
    // 예적금(savings): 평가액은 연이율로 누적 산출되므로 산출 필드를 함께 보존
    ...(it.type === 'savings' ? {
      annualRate: cleanNum(it.annualRate),
      startDate: it.startDate || '',
      endDate: it.endDate || '',
      deposits: Array.isArray(it.deposits) ? it.deposits.map(d => ({ date: d?.date || '', amount: cleanNum(d?.amount) })) : [],
    } : {}),
  }));

// 삭제된 종목의 종목명 복원용 code→name 맵. 종목 삭제 시 이름은 코드별 데이터(actualDividend/
// taxBaseHistory)에 저장되지 않지만, 보유 중 찍힌 holdingSnapshots에 name이 남아있어 오프라인으로
// 복원 가능하다('삭제됨' 유령 행이 기존처럼 종목명+코드를 표시하도록). 최신 스냅샷 이름이 우선하고,
// 현재 포트폴리오 항목 이름도 포함(정상 종목·무해).
export const buildHeldNameMap = (pf: any): { [code: string]: string } => {
  const map: { [code: string]: string } = {};
  const snaps = Array.isArray(pf?.holdingSnapshots) ? pf.holdingSnapshots : [];
  [...snaps]
    .sort((a: any, b: any) => String(a?.date || '').localeCompare(String(b?.date || '')))
    .forEach((s: any) => (s?.items || []).forEach((it: any) => {
      const code = String(it?.code || '');
      const name = String(it?.name || '').trim();
      if (code && name) map[code] = name;
    }));
  (pf?.portfolio || []).forEach((it: any) => {
    const code = String(it?.code || '');
    const name = String(it?.name || '').trim();
    if (code && name) map[code] = name;
  });
  return map;
};

// 구성 변경 감지용 지문 (가격 제외 — 수량·예수금·종목 구성만)
export const snapshotCompositionKey = (items: any[]): string =>
  JSON.stringify(
    snapshotItemsFromPortfolio(items)
      .map(it => `${it.type}:${it.code}:${it.quantity}:${it.depositAmount}:${it.investAmount}`)
      .sort()
  );

// 계좌에 자산검증 필드 보강 (로드/생성 시 호출). 기존 계좌는 baselineDate=직전거래일.
export const ensurePortfolioVerificationFields = (p: any): any => {
  if (!p || p.accountType === 'simple' || p.accountType === 'matong') return p;
  const next = { ...p };
  if (!next.manualPriceOverrides || typeof next.manualPriceOverrides !== 'object') next.manualPriceOverrides = {};
  if (typeof next.preBaselineVerified !== 'boolean') next.preBaselineVerified = false;
  if (!Array.isArray(next.holdingSnapshots)) next.holdingSnapshots = [];
  if (!next.baselineDate) {
    const start = next.portfolioStartDate || next.startDate || '';
    next.baselineDate = (start && start > BASELINE_DEFAULT_DATE) ? start : BASELINE_DEFAULT_DATE;
  }
  return next;
};

// 특정 날짜의 보유 종목 해결: baseline 이전 → baseline 스냅샷(추정),
// baseline 이후 → date 이하 최신 스냅샷. 스냅샷 없으면 현재 포트폴리오(추정).
export const resolveHoldings = (
  p: any,
  date: string
): { items: any[]; kind: string; estimated: boolean } => {
  const snaps = (p?.holdingSnapshots || []).filter((s: any) => Array.isArray(s?.items));
  if (snaps.length === 0) {
    return { items: p?.portfolio || [], kind: 'live', estimated: true };
  }
  const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  const baselineDate = p?.baselineDate || '';
  if (baselineDate && date < baselineDate) {
    const baseline = sorted.find((s: any) => s.kind === 'baseline') || sorted[0];
    return { items: baseline?.items || [], kind: 'baseline', estimated: !p?.preBaselineVerified };
  }
  const eligible = sorted.filter((s: any) => s.date <= date);
  const chosen = eligible.length ? eligible[eligible.length - 1] : sorted[0];
  return { items: chosen?.items || [], kind: chosen?.kind || 'baseline', estimated: false };
};

export const buildIndexStatus = (data, source) => {
  const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (!data || Object.keys(data).length === 0) {
    return { status: 'fail', source: '-', latestDate: '-', latestValue: 0, count: 0, gapDays: null, updatedAt: now };
  }
  const dates = Object.keys(data).sort();
  const latestDate = dates[dates.length - 1];
  const latestValue = data[latestDate];
  const today = new Date().toISOString().split('T')[0];
  const gapDays = Math.floor((new Date(today) - new Date(latestDate)) / (1000 * 60 * 60 * 24));
  const isPartial = dates.length <= 3;
  return {
    status: isPartial ? 'partial' : 'success',
    source,
    latestDate,
    latestValue,
    count: dates.length,
    gapDays,
    updatedAt: now
  };
};

export const parseIndexCSV = (text, fileName) => {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return null;
  const header = lines[0].replace(/"/g, '').toLowerCase();
  const result = {};

  if (header.includes('price') && header.includes('change')) {
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/"/g, '').split(',');
      if (cols.length >= 2) {
        const rawDate = cols[0].trim();
        const price = parseFloat(cols[1].replace(/,/g, '').trim());
        if (!rawDate || isNaN(price) || price <= 0) continue;
        let dateStr = rawDate;
        if (rawDate.match(/[a-zA-Z]/)) {
          const d = new Date(rawDate);
          if (!isNaN(d)) dateStr = d.toISOString().split('T')[0];
        }
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) result[dateStr] = price;
      }
    }
  }
  else if (header.includes('날짜') || header.includes('종가')) {
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/"/g, '').split(',');
      if (cols.length >= 2) {
        const rawDate = cols[0].trim().replace(/\./g, '-');
        const price = parseFloat(cols[1].replace(/,/g, '').trim());
        if (!rawDate || isNaN(price) || price <= 0) continue;
        if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) result[rawDate] = price;
      }
    }
  }
  else if (header.includes('close') || header.startsWith('date')) {
    const cols0 = header.split(',');
    const closeIdx = cols0.findIndex(c => c.trim() === 'close');
    const dateIdx = cols0.findIndex(c => c.trim() === 'date');
    const ci = closeIdx >= 0 ? closeIdx : 4;
    const di = dateIdx >= 0 ? dateIdx : 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/"/g, '').split(',');
      if (cols.length > ci) {
        const dateStr = cols[di]?.trim();
        const price = parseFloat(cols[ci]?.trim());
        if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/) && !isNaN(price) && price > 0) {
          result[dateStr] = price;
        }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
};

export const detectIndexFromFileName = (fileName) => {
  const upper = fileName.toUpperCase();
  if (upper.includes('KOSPI') || upper.includes('KS11') || upper.includes('코스피')) return 'kospi';
  if (upper.includes('SP500') || upper.includes('S&P') || upper.includes('SPX') || upper.includes('GSPC')) return 'sp500';
  if (upper.includes('NASDAQ') || upper.includes('NDQ') || upper.includes('IXIC') || upper.includes('나스닥')) return 'nasdaq';
  return null;
};

export const downloadCSV = (filename, csvString) => {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
};

// ⚠️ 화면(HistoryPanel)과 **같은 공용 함수**(computeDailyMetricsSeries)를 써야 CSV 대조 시
//    값이 어긋나지 않는다 — 행별 독립 계산으로 되돌리면 보류 행의 흐름 이월이 깨진다.
//    evalByDate: 화면이 쓰는 평가액 재계산 Map(날짜→원화). 미전달 시 저장 evalAmount 사용.
//    bookByDate: 화면이 쓰는 장부액 Map(buildBookCostSeries). 미전달 시 보류 판정이 ΔV 폴백 →
//                화면과 '-' 판정이 갈릴 수 있으므로 가능하면 함께 넘길 것.
//    depositHistory/depositHistory2 미전달 시 흐름 0 → 기존 동작과 동일(하위호환).
export const buildHistoryCSV = (history, depositHistory, depositHistory2, rateOf, evalByDate, bookByDate) => {
  let csv = '﻿일자,평가자산,일간 손익,전일대비 수익률,순입출금\n';
  const sh = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
  const asc = [...sh].reverse();
  const evalOf = (h) => (evalByDate && evalByDate.get(h.date) != null) ? evalByDate.get(h.date) : h.evalAmount;
  const rows = asc.map((h, i) => {
    const prev = asc[i - 1];
    const flow = prev
      ? externalFlowInRange(depositHistory, depositHistory2, prev.date, h.date, rateOf)
      : { in: 0, out: 0 };
    return {
      date: h.date, evalAmount: evalOf(h), flowIn: flow.in, flowOut: flow.out,
      bookDelta: prev ? bookDeltaBetween(bookByDate, prev.date, h.date) : null,
    };
  });
  const metrics = computeDailyMetricsSeries(rows);
  sh.forEach(h => {
    const m = metrics.get(h.date) || { dodAbsChange: null, dodChange: 0, ledgerFlow: 0 };
    const v = evalOf(h);
    if (m.dodAbsChange == null) { csv += `${h.date},${v},,,${m.ledgerFlow || 0}\n`; return; }
    csv += `${h.date},${v},${m.dodAbsChange},${m.dodChange.toFixed(2)}%,${m.ledgerFlow || 0}\n`;
  });
  return csv;
};

export const buildLookupCSV = (lookupRows, history, comparisonMode, currentTotalEval) => {
  const modeText = comparisonMode === 'latestOverPast' ? '(현재/과거)-1 (%)' : '1- (과거/현재) (%)';
  let csv = `﻿일자,평가자산,${modeText}\n`;
  const validRecords = lookupRows.map(r => history.find(h => h.date === r.date)).filter(Boolean);
  let oldestEval = 0;
  if (validRecords.length > 0) oldestEval = validRecords.reduce((min, curr) => new Date(curr.date) < new Date(min.date) ? curr : min).evalAmount;
  [...lookupRows].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(row => {
    const rec = history.find(h => h.date === row.date);
    if (rec) {
      const pastEval = rec.evalAmount;
      const compareRate = comparisonMode === 'latestOverPast'
        ? (oldestEval > 0 ? ((pastEval / oldestEval) - 1) * 100 : 0)
        : (currentTotalEval > 0 ? (1 - (pastEval / currentTotalEval)) * 100 : 0);
      csv += `${row.date},${pastEval},${compareRate.toFixed(2)}%\n`;
    } else { csv += `${row.date},기록 없음,-\n`; }
  });
  return csv;
};

export const buildDepositCSV = (rows) => {
  let csv = '﻿일자,금액,합계,메모,원금제외\n';
  rows.forEach(h => { csv += `${h.date},${cleanNum(h.amount)},${cleanNum(h.cumulative)},${h.memo || ''},${h.noPrincipal ? 'Y' : ''}\n`; });
  return csv;
};

// ─────────────────────────────────────────────────────────────────────────────
// 한국 ETF 배당 과세 계산 (사용자 입력 매입 과표 → 분배락 과세표준 차분)
// 실제 운용사 관행: 주당 과세표준을 소수 둘째 자리로 반올림한 후 보유수량을 곱한다.
// ─────────────────────────────────────────────────────────────────────────────
export interface KrEtfPurchaseEvent {
  id?: string;
  date: string;            // 'YYYY-MM-DD'
  shares: number;          // 양의 정수
  taxBasePrice: number;    // 매입 시점 과표기준가, > 0 (소수점 허용)
}

export interface KrEtfSaleEvent {
  id?: string;
  date: string;            // 'YYYY-MM-DD'
  shares: number;          // 양의 정수
}

export interface KrEtfDividendEvent {
  exDate: string;             // 'YYYY-MM-DD'
  exTaxBasePrice: number;     // 배당락일 과표기준가, > 0
  perShareGrossDividend: number;  // 주당 세전 배당금, ≥ 0
}

export interface KrEtfTaxOptions {
  taxRate?: number;             // default 0.154 (배당소득세 15.4%)
  saleMethod?: 'avg';           // v1: 평균법만 지원 (FIFO 추후)
  sales?: KrEtfSaleEvent[];
  perShareDecimals?: number;    // 주당 과세표준 반올림 자릿수 (default 2)
}

export interface KrEtfTaxResult {
  weightedAvgTaxBase: number;   // 배당락일 시점 가중평균 매입 과표
  taxablePerShare: number;      // max(0, exBase - 가중평균), 소수 N자리 반올림
  totalShares: number;          // 배당락일 보유수량
  taxableAmount: number;        // taxablePerShare × totalShares (원, 반올림)
  tax: number;                  // 원천징수액 (원, 반올림)
  grossDividend: number;        // 세전 배당금 (원, 반올림)
  netDividend: number;          // 세후 배당금 (gross - tax)
}

export function calculateKrEtfDividendTax(
  purchases: KrEtfPurchaseEvent[],
  dividend: KrEtfDividendEvent,
  options: KrEtfTaxOptions = {},
): KrEtfTaxResult {
  const taxRate = options.taxRate ?? 0.154;
  const saleMethod = options.saleMethod ?? 'avg';
  const sales = options.sales ?? [];
  const perShareDecimals = options.perShareDecimals ?? 2;

  if (!Array.isArray(purchases) || purchases.length === 0) {
    throw new Error('매입 이벤트가 최소 1건 필요합니다.');
  }
  if (!dividend || !/^\d{4}-\d{2}-\d{2}$/.test(String(dividend.exDate || ''))) {
    throw new Error('배당락일이 올바른 YYYY-MM-DD 형식이 아닙니다.');
  }
  if (!(dividend.exTaxBasePrice > 0)) {
    throw new Error('배당락일 과표기준가는 0보다 커야 합니다.');
  }
  if (!(dividend.perShareGrossDividend >= 0)) {
    throw new Error('주당 세전 배당금은 0 이상이어야 합니다.');
  }
  if (saleMethod !== 'avg') {
    throw new Error(`saleMethod '${saleMethod}' 미지원 (v1: 'avg'만 지원)`);
  }

  purchases.forEach((p, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) {
      throw new Error(`매입[${i}] 날짜 형식 오류: ${p.date}`);
    }
    if (!Number.isFinite(p.shares) || p.shares <= 0 || !Number.isInteger(p.shares)) {
      throw new Error(`매입[${i}] 주식수는 양의 정수여야 합니다: ${p.shares}`);
    }
    if (!Number.isFinite(p.taxBasePrice) || p.taxBasePrice <= 0) {
      throw new Error(`매입[${i}] 과표기준가는 0보다 커야 합니다: ${p.taxBasePrice}`);
    }
  });
  sales.forEach((s, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) {
      throw new Error(`매도[${i}] 날짜 형식 오류: ${s.date}`);
    }
    if (!Number.isFinite(s.shares) || s.shares <= 0 || !Number.isInteger(s.shares)) {
      throw new Error(`매도[${i}] 주식수는 양의 정수여야 합니다: ${s.shares}`);
    }
  });

  type Evt = { date: string; kind: 'B' | 'S'; shares: number; price?: number };
  const events: Evt[] = [
    ...purchases.map<Evt>(p => ({ date: p.date, kind: 'B', shares: p.shares, price: p.taxBasePrice })),
    ...sales.map<Evt>(s => ({ date: s.date, kind: 'S', shares: s.shares })),
  ]
    .filter(e => e.date <= dividend.exDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'B' ? -1 : 1));

  let heldShares = 0;
  let totalCost = 0;
  for (const e of events) {
    if (e.kind === 'B') {
      totalCost += e.shares * (e.price as number);
      heldShares += e.shares;
    } else {
      if (e.shares > heldShares) {
        throw new Error(`매도 ${e.date}: 보유수량(${heldShares}) 초과 매도(${e.shares})`);
      }
      const costPerShare = heldShares > 0 ? totalCost / heldShares : 0;
      totalCost -= e.shares * costPerShare;
      heldShares -= e.shares;
    }
  }

  if (heldShares <= 0) {
    return {
      weightedAvgTaxBase: 0,
      taxablePerShare: 0,
      totalShares: 0,
      taxableAmount: 0,
      tax: 0,
      grossDividend: 0,
      netDividend: 0,
    };
  }

  const weightedAvgTaxBase = totalCost / heldShares;
  const rawTaxablePerShare = Math.max(0, dividend.exTaxBasePrice - weightedAvgTaxBase);
  const factor = 10 ** perShareDecimals;
  const taxablePerShare = Math.round(rawTaxablePerShare * factor) / factor;
  const totalShares = heldShares;
  const taxableAmount = Math.round(taxablePerShare * totalShares);
  const tax = Math.round(taxableAmount * taxRate);
  const grossDividend = Math.round(dividend.perShareGrossDividend * totalShares);
  const netDividend = grossDividend - tax;

  return {
    weightedAvgTaxBase,
    taxablePerShare,
    totalShares,
    taxableAmount,
    tax,
    grossDividend,
    netDividend,
  };
}

// 삼성운용 ETF 배당 과세 CSV 파싱
// 포맷: 1행=펀드명, 2행=기준일, 3행=헤더, 4행~=데이터(지급기준일,실지급일,분배율,분배금액,주당과세표준)
export const parseSamsungFundCSV = (text) => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const records = {};
  for (let i = 3; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;
    const refDate = cols[0].trim();
    if (!/^\d{8}$/.test(refDate)) continue;
    const yearMonth = `${refDate.slice(0, 4)}-${refDate.slice(4, 6)}`;
    records[yearMonth] = {
      referenceDate: refDate,
      paymentDate: cols[1].trim(),
      distributionRate: parseFloat(cols[2]) || 0,
      perShareAmount: parseInt(cols[3], 10) || 0,
      perShareTaxableBase: parseInt(cols[4], 10) || 0,
    };
  }
  return records;
};

// ─────────────────────────────────────────────────────────────────────────────
// 과거 목표비중 복원 (메모 달력 rebalTarget 기록 → 현재 리밸런싱 표에 적용)
// 상세 규약·회귀 주의는 CLAUDE.md "과거 목표비중 복원" 섹션 참조.
// ⚠️ 이 3함수는 순수 함수다 — calendarMemos를 읽기만 하고 절대 쓰지 않는다(INV-1).
// ─────────────────────────────────────────────────────────────────────────────

// 한 계좌의 rebalTarget 스냅샷 목록. (dayKey, portfolioId)당 1건 upsert라 날짜당 최대 1건.
// 반환: [{ dayKey, memo }] — 날짜 **내림차순**(최신 우선). ISO 문자열 사전순 = 시간순.
export const listRebalTargetSnapshots = (calendarMemos, portfolioId) => {
  if (!calendarMemos || typeof calendarMemos !== 'object' || Array.isArray(calendarMemos) || !portfolioId) return [];
  const out = [];
  for (const dayKey of Object.keys(calendarMemos)) {
    if (!isValidIsoDate(dayKey)) continue;
    const arr = calendarMemos[dayKey];
    if (!Array.isArray(arr)) continue;
    // ⚠️ normalizeCalendarMemos는 "항목이 객체인가"만 보고 rows를 검증하지 않는다 → 여기서 방어.
    const memo = arr.find(m => m && m.kind === 'rebalTarget' && m.portfolioId === portfolioId
      && Array.isArray(m.rows) && m.rows.length > 0);
    if (memo) out.push({ dayKey, memo });
  }
  out.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0));
  return out;
};

const rbCodeKey = (s) => String(s ?? '').trim().toUpperCase();
const rbNameKey = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

// 스냅샷 rows[] ↔ 현재 표(rebalanceData) 1:1 매칭.
// ⚠️ 스냅샷 rows에는 종목 **id가 없다**(App.tsx buildRebalTargetEntry) → (code, name) 2패스 휴리스틱.
// ⚠️ 인덱스·순서 폴백 금지 — 스냅샷은 카테고리 재배치 순, 현재 표는 정렬 상태 순이라 서로 다르다.
//    순서로 맞추면 엉뚱한 종목에 비중이 조용히 박힌다.
// ⚠️ 애매하면(같은 코드/이름이 2행) 임의 선택 대신 **보류** — 조용한 오적용보다 명시적 미적용이 낫다.
export const matchRebalTargetRows = (rows, items) => {
  const src = Array.isArray(rows) ? rows : [];
  const cur = (Array.isArray(items) ? items : []).filter(it => it && it.id != null);
  const byCode = new Map(), byName = new Map();
  const push = (map, key, v) => { if (!key) return; const a = map.get(key); if (a) a.push(v); else map.set(key, [v]); };
  cur.forEach(it => { push(byCode, rbCodeKey(it.code), it); push(byName, rbNameKey(it.name), it); });

  const used = new Set();
  const matched = [], skipped = [], pending = [];
  const freeOf = (a) => (a || []).filter(it => !used.has(it.id));
  const take = (row, it, value, by) => {
    used.add(it.id);
    matched.push({
      id: it.id, value, by,
      code: it.code || '', curName: it.name || '', snapName: row.name || '',
      prevRatio: cleanNum(it.effectiveTargetRatio), isSavings: it.type === 'savings',
      // 기록된 목표금액(숫자일 때만). 구버전 기록에는 없으므로 null이 정상 — 소비 측에서 건너뛴다.
      amount: typeof row.targetAmount === 'number' && Number.isFinite(row.targetAmount) && row.targetAmount >= 0
        ? row.targetAmount : null,
      prevAmount: it.hasTargetAmount ? cleanNum(it.effectiveTargetAmount) : null,
    });
  };

  // ① 코드 정확 일치(trim+대문자) — 후보가 유일할 때만
  for (const row of src) {
    if (!row || typeof row !== 'object') { skipped.push({ name: '', code: '', value: 0, why: 'bad-row' }); continue; }
    // ⚠️ Number()로 변환하지 말 것 — Number(null)/Number('')/Number([])가 전부 0이 되어 손상된 행이
    //    "목표비중 0%"로 조용히 적용된다. buildRebalTargetEntry는 항상 cleanNum 숫자를 쓴다.
    const value = row.targetRatio;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) {
      skipped.push({ name: row.name || '', code: row.code || '', value: 0, why: 'bad-value' });
      continue;
    }
    const ck = rbCodeKey(row.code);
    if (!ck) { pending.push({ row, value }); continue; }          // 예적금·수동 펀드·코드 미입력
    const cand = freeOf(byCode.get(ck));
    if (cand.length === 1) { take(row, cand[0], value, 'code'); continue; }
    if (cand.length > 1) {                                        // 같은 코드 2행(코드 유일성 검사 없음)
      const nk = rbNameKey(row.name);
      const narrow = nk ? cand.filter(it => rbNameKey(it.name) === nk) : [];
      if (narrow.length === 1) take(row, narrow[0], value, 'code+name');
      else skipped.push({ name: row.name || '', code: row.code || '', value, why: 'ambiguous' });
      continue;
    }
    pending.push({ row, value });                                 // 코드 표기 변경 → 이름 폴백
  }

  // ② 이름 정확 일치(NFC+소문자+공백정규화) — 유일할 때만 + 예적금 타입 힌트
  //    curQty === null ⟺ savings (buildRebalTargetEntry) — 코드 없는 행끼리 오매칭을 막는 유일한 단서.
  for (const { row, value } of pending) {
    const nk = rbNameKey(row.name);
    if (!nk) { skipped.push({ name: '', code: row.code || '', value, why: 'blank-key' }); continue; }
    const wantSavings = row.curQty === null;
    const cand = freeOf(byName.get(nk)).filter(it => (it.type === 'savings') === wantSavings);
    if (cand.length === 1) take(row, cand[0], value, 'name');
    else skipped.push({ name: row.name || '', code: row.code || '', value, why: cand.length ? 'ambiguous' : 'missing' });
  }

  const mid = new Set(matched.map(m => m.id));
  const untouched = cur.filter(it => !mid.has(it.id));
  return {
    matched, skipped, untouched,
    appliedSum: matched.reduce((s, m) => s + m.value, 0),
    untouchedSum: untouched.reduce((s, it) => s + cleanNum(it.effectiveTargetRatio), 0),
  };
};

// 투자선택(settings.mode) × 목표모드(settings.targetMode) 조합으로 목표비중 슬롯을 고른다.
// ⚠️ 적립식은 '이번 적립금을 어떻게 나눌지'라 리밸런싱·목표금액의 '자산 전체 목표 배분'과 의미가
//    다르다 → 슬롯을 분리해 두 모드가 서로의 값을 덮지 않게 한다. 값을 실제로 0으로 지우는 방식은
//    되돌릴 수 없어 폐기.
// ⚠️ 미러 상태(mirrorField)도 같이 분리해야 한다 — 공유하면 리밸런싱에서 켠 라이브 미러가 적립식
//    슬롯까지 현재 비중으로 추종시킨다.
// ⚠️ 이 함수가 유일한 슬롯 결정 지점이다. usePortfolioData(계산)·RebalancingPanel(편집·미러·복원)이
//    반드시 공유할 것 — 한쪽만 손복제하면 화면과 계산이 서로 다른 슬롯을 읽는다.
// ⚠️ readFields = '읽기 폴백' 우선순위. 현재 슬롯이 **미설정**이면 이웃 슬롯에서 이어받아 읽는다
//    (readTargetRatio). 쓰기는 **절대 폴백하지 않는다**(항상 slotField) — 저장값 무수정 규약.
//    이게 없으면 슬롯 축(투자선택·고정/수시변경)이 바뀌는 순간, 사용자가 정한 목표가 그대로 살아
//    있는데도 화면·계산이 0%가 된다. 리밸런싱 모드에서 0%는 '전량 매도' 지시라 위험하고, 그 0%가
//    달력 스냅샷(buildRebalTargetEntry)에 박제되면 유일한 복구 기록까지 잃는다.
//    ⚠️ 실제 사고: 2026-08-03 슬롯 분리 배포(ed78d5e)가 targetRatioAcc를 신설하면서, 이미 적립식이던
//    계좌들의 기존 목표비중(targetRatio)이 **사용자 조작 0회로** 화면에서 0%가 됐다.
//    우선순위 = 같은 투자선택의 반대 목표모드(고정↔수시변경 = 잠금 상태 차이일 뿐) → 반대 투자선택.
export const resolveTargetSlots = (settings) => {
  const acc = settings?.mode === 'accumulate';
  const varMode = settings?.targetMode === 'variable';
  const slotOf = (a, v) => (a ? (v ? 'targetRatioAccVar' : 'targetRatioAcc') : (v ? 'targetRatioVar' : 'targetRatio'));
  return {
    isAccumulateSlot: acc,
    slotField: slotOf(acc, varMode),
    readFields: [slotOf(acc, varMode), slotOf(acc, !varMode), slotOf(!acc, varMode), slotOf(!acc, !varMode)],
    overrideField: acc
      ? (varMode ? 'targetRatioAccVarOverride' : 'targetRatioAccOverride')
      : (varMode ? 'targetRatioVarOverride' : 'targetRatioOverride'),
    mirrorField: acc
      ? (varMode ? 'targetMirrorAccVar' : 'targetMirrorAccFixed')
      : (varMode ? 'targetMirrorVar' : 'targetMirrorFixed'),
  };
};

// 목표비중 슬롯이 '설정됨'인가. ⚠️ cleanNum(x) || 0 으로 판정하지 말 것 — 그러면 '미설정'과
// '사용자가 명시적으로 넣은 0%'가 같은 값이 되어, 0% 목표가 폴백에 조용히 덮인다.
// 목표금액의 hasRawTargetAmount(usePortfolioData)와 **같은 타입 기반 규약**이다.
export const hasRatio = (v) => (
  typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' ? /\d/.test(v) : false)
);

// 항목의 실효 목표비중을 읽는다(라이브 미러 판정은 호출부 책임). readFields를 순서대로 훑어
// 처음 '설정됨'인 슬롯을 채택하고, 하나도 없으면 0.
// ⚠️ 이 함수는 **읽기 전용**이다. 반환된 field로 되쓰지 말 것 — 쓰기는 항상 slotField다.
export const readTargetRatio = (item, slots) => {
  const fields = (slots && slots.readFields) || [];
  for (let i = 0; i < fields.length; i++) {
    const v = item ? item[fields[i]] : undefined;
    if (hasRatio(v)) return { value: cleanNum(v) || 0, field: fields[i], inherited: i > 0 };
  }
  return { value: 0, field: fields[0], inherited: false };
};

// 매칭된 종목의 목표 슬롯에 복원값을 쓴다. 변경이 없으면 **같은 참조**를 반환(불필요한 저장 트리거 방지).
// ⚠️ overrideField는 미러 상태와 무관하게 **항상 true** — 수동 blur(미러 'on'일 때만 override)와
//    의도적으로 다르다. settings는 같은 accountType 계좌 전체가 공유하므로(updateSettingsForType),
//    형제 계좌에서 미러를 켰다 끄면 override 없는 슬롯이 '현재 비중'으로 영구히 덮어써진다.
//    복원값은 사용자가 의도적으로 채택한 목표이므로 그 사고에서 반드시 보호해야 한다.
export const applyRebalTargetRatios = (items, ratioById, opts) => {
  const slotField = opts?.slotField;
  const overrideField = opts?.overrideField;
  if (!Array.isArray(items) || !ratioById || !slotField) return items;
  let changed = false;
  const next = items.map(it => {
    if (!it || it.id == null || !Object.prototype.hasOwnProperty.call(ratioById, it.id)) return it;
    changed = true;
    const patched = { ...it, [slotField]: ratioById[it.id] };
    if (overrideField) patched[overrideField] = true;
    return patched;
  });
  return changed ? next : items;
};

// 네이버 배당 이력 API 응답(`result[]`) → `{ amounts: {YYYY-MM: 주당분배금}, exDates: {YYYY-MM: YYYY-MM-DD} }`.
// ⚠️ 분배금 현황 표(DividendSummaryTable)와 백테스트 종목 조회(backtestFetch)가 **같은 함수를
//    공유**한다 — 각자 파서를 두면 같은 종목이 화면마다 다른 주당분배금으로 뜬다.
// 저장 키는 앱 전체 규약대로 **배당락월**(지급월 아님)이다.
export const parseDividendApiResult = (result) => {
  const amounts = {};
  const exDates = {};
  (Array.isArray(result) ? result : []).forEach(({ dividendAmount, exDividendAt }) => {
    // Naver 배당락일 형식: "YYYY.MM.DD" — 형식이 어긋난 항목은 건너뜀
    const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(exDividendAt || '').trim());
    if (!m) return;
    const ds = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const key = `${m[1]}-${m[2].padStart(2, '0')}`;
    amounts[key] = (amounts[key] || 0) + dividendAmount;
    if (!exDates[key] || ds > exDates[key]) exDates[key] = ds;
  });
  return { amounts, exDates };
};

// ── 날짜별 '계좌별 현황' 행 — 통합 대시보드 추이표 팝업과 메모 달력 팝업의 **단일 소스** ─────────
// 원래 IntegratedDashboard의 histDetailRows useMemo 본문이었다. 메모 달력 날짜 칸의 자산 스냅샷을
// 클릭해도 같은 표를 띄우게 되면서 순수 함수로 승격했다.
// ⚠️ 두 화면이 **각자 계산하도록 되돌리지 말 것** — 같은 날짜에 다른 소계가 나오면
//    "달력 칸의 총자산 = 팝업 소계 = 추이 차트 그날 값" 불변식이 깨진다.
// 규칙(전부 종전 그대로 — 아래 4분기의 판정 순서를 바꾸지 말 것):
//  ① isTest 계좌 제외(차트 값과 일치) / 삭제 계좌는 라이브 시점 및 `date >= deletedAt` 제외
//  ② 오늘(realtimeDate + 라이브 자산>0)은 summary.currentEval — 통합 표 합계와 일치
//  ③ 현금성(matong·simple)은 p.history 스냅샷 carry-forward(0 포함), 원금=예수금=평가(수익 0)
//  ④ 시장 계좌는 accountSeriesById(= marketSeries, '수량 × 종가')를 carry-forward
//     — 저장된 라이브 evalAmount가 아니다(buildCloseEvalSeries 단일 소스 규약).
// ⚠️ 빈 결과도 **같은 형태**여야 소비자 가드가 균일해진다(rows/weight/totalReturnRate 접근이
//    분기마다 갈리면 한쪽만 null 가드를 빠뜨린다).
export const EMPTY_HIST_DETAIL = { rows: [], totalEval: 0, totalPrincipal: 0, totalDeposit: 0, totalProfit: 0, totalReturnRate: null };
export const buildHistDetailRows = (opts) => {
  const o = opts || {};
  const date = o.date;
  const portfolios = o.portfolios;
  if (!date || !Array.isArray(portfolios)) return EMPTY_HIST_DETAIL;
  const summaries = Array.isArray(o.portfolioSummaries) ? o.portfolioSummaries : [];
  const seriesById = o.accountSeriesById || {};
  const activePortfolioId = o.activePortfolioId ?? null;
  const activeHistory = Array.isArray(o.activeHistory) ? o.activeHistory : null;
  // realtimeDate = intMonthlyHistory[0].date(오늘 = 실시간 값을 쓰는 날짜).
  // ⚠️ 라이브 자산이 0(예: 유일 계좌 삭제 → 빈 계좌 자동생성)이면 computedIntHistory가 today를
  //    추가하지 않아 그 date가 '과거' 최신점이 된다 → 이때 realtime 취급하면 그 과거점에서 삭제
  //    계좌를 잘못 제외해 차트와 어긋난다. 따라서 라이브 자산이 있을 때만 realtime(오늘)으로 판정.
  const isRealtimeDate = !!o.realtimeDate && date === o.realtimeDate && (o.liveTotalEval || 0) > 0;

  let totalEval = 0, totalPrincipal = 0, totalDeposit = 0;
  const rows = [];
  portfolios.forEach(p => {
    if (!p) return;
    if (p.isTest) return; // TEST 계좌는 추이 팝업 소계에서 제외(차트 값과 일치)
    // 삭제 계좌: 삭제일 이후(및 라이브 시점)는 제외 — 삭제일 이전 과거 날짜만 표시(차트 값과 일치)
    if (p.deletedAt && (isRealtimeDate || date >= p.deletedAt)) return;
    const summary = summaries.find(s => s.id === p.id);
    const isCash = p.accountType === 'matong' || p.accountType === 'simple';
    let evalAmt = 0;
    if (isRealtimeDate) {
      // 오늘은 실시간 평가금 사용 → 테이블 합계와 일치
      evalAmt = summary?.currentEval || 0;
    } else if (isCash) {
      // 현금성 계좌(마통·직접입력): 일별 자동 스냅샷(p.history)을 carry-forward로 복원해 그날의
      // 잔액을 그대로 표시한다(현재값을 과거 날짜에 소급하지 않음). 추이 차트(computedIntHistory)와
      // 동일 규칙(스냅샷 carry-forward, 0 포함) → 소계가 차트 그날 값과 일치.
      const startDate = summary?.startDate || p.portfolioStartDate || p.startDate || '';
      if (startDate && startDate > date) return;
      const hist = (activeHistory && p.id === activePortfolioId) ? activeHistory : (p.history || []);
      const sorted = [...hist].filter(h => h?.date && typeof h.evalAmount === 'number' && h.evalAmount >= 0).sort((a, b) => a.date.localeCompare(b.date));
      const rec = sorted.filter(h => h.date <= date).pop();
      evalAmt = rec ? rec.evalAmount : 0;
    } else {
      // 시장 계좌: 통합 추이 차트(computedIntHistory)와 '동일한' 시계열(marketSeries)을 재사용한다.
      const series = seriesById[p.id];
      if (!series || !series.dates || series.dates.length === 0) return;
      let last = 0;
      for (const d of series.dates) {
        if (d <= date) last = series.map.get(d);
        else break;
      }
      if (!(last > 0)) return;
      evalAmt = last;
    }
    if (evalAmt <= 0) return;
    totalEval += evalAmt;
    const isOverseas = p.accountType === 'overseas';
    const fxRate = isOverseas ? (p.avgExchangeRate || 1) : 1;
    const currentPrincipalKRW = (p.principal || 0) * fxRate;
    const deps = p.depositHistory || [];
    const wds = p.depositHistory2 || [];
    const futureDeposits = deps.filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0) * (isOverseas ? (d.fxRate || 1) : 1), 0);
    const futureWithdrawals = wds.filter(d => d.date > date).reduce((s, d) => s + (d.amount || 0) * (isOverseas ? (d.fxRate || 1) : 1), 0);
    // 현금성 계좌는 투자원금=평가금액=예수금 불변 → 수익·수익률 항상 0. 그 외는 입출금 시점 보정식 유지.
    const effPrincipal = isCash
      ? evalAmt
      : Math.max(0, currentPrincipalKRW - futureDeposits + futureWithdrawals);
    totalPrincipal += effPrincipal;
    const depositAmt = isCash ? effPrincipal : (summary?.depositAmount || 0);
    totalDeposit += depositAmt;
    const name = (summary?.name || p.name || p.id) + (p.deletedAt ? ' (삭제됨)' : '');
    const profit = evalAmt - effPrincipal;
    const returnRate = effPrincipal > 0 ? (profit / effPrincipal) * 100 : 0;
    rows.push({ id: p.id, name, evalAmount: evalAmt, principal: effPrincipal, profit, returnRate, depositAmount: depositAmt, rowColor: p.rowColor || '' });
  });
  // ⚠️ 비중·소계 수익·소계 수익률까지 **여기서** 낸다 — 두 렌더러(통합 대시보드 팝업 · 메모 달력
  //    팝업)가 '순수 포매팅'만 하게 되어 분모를 한쪽만 바꾸는 사고가 구조적으로 불가능해진다.
  // ⚠️ 누적 3개는 rows.push와 **같은 분기 안**에서만 올린다(사후 reduce로 바꾸면 제외된 계좌가
  //    분모에 섞여 tfoot '100%'가 조용히 깨진다).
  // ⚠️ null 계약: 산출 불가는 null이다(0.00%로 단언 금지 — dodAbsChange 규약과 동일).
  //    소비자는 반드시 `== null ? '-' : …` 가드를 통과시킬 것 — CalendarModal의 fmtPct는
  //    null-safe가 아니다(`null >= 0`이 true라 `null.toFixed`로 폭발한다. utils.formatPercent는
  //    cleanNum을 거쳐 안전하다 — 두 파일의 포매터가 다르다는 사실이 이 계약의 근거다).
  const totalProfit = totalEval - totalPrincipal;
  return {
    rows: rows.map(r => ({ ...r, weight: totalEval > 0 ? (r.evalAmount / totalEval) * 100 : null })),
    totalEval, totalPrincipal, totalDeposit,
    totalProfit,
    totalReturnRate: totalPrincipal > 0 ? (totalProfit / totalPrincipal) * 100 : null,
  };
};
