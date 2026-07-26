// @ts-nocheck
// 환율 계산기 데이터 계층 — 야후 파이낸스 단일 소스, USD 피벗.
//
// ⚠️ 이 모듈의 결과를 stockHistoryMap / indicatorHistoryMap 에 절대 병합하지 말 것.
//    두 맵은 Drive 영속 + buildCloseEvalSeries(평가액 재계산)의 권위 소스라
//    환율 라이브값이 섞이면 평가액이 오염된다(WatchlistPopup 불변식과 동일 사유).
// ⚠️ 포트폴리오 해외계좌 평가는 기존 marketIndicators.usdkrw 경로를 그대로 쓴다 — 여기와 연결 금지.

export type FxQuote = { rate: number; prevRate: number | null; at: number | null };
// rate = USD 1단위당 해당 통화 수량 (야후 `{CUR}=X` = USD/{CUR}). USD 는 항상 1.
export type FxRateMap = Record<string, FxQuote>;

export const FX_CURRENCIES = [
  { code: 'KRW', name: '대한민국 원', dp: 0 },
  { code: 'USD', name: '미국 달러', dp: 2 },
  { code: 'JPY', name: '일본 엔', dp: 0 },
  { code: 'EUR', name: '유로', dp: 2 },
  { code: 'CNY', name: '중국 위안', dp: 2 },
  { code: 'BRL', name: '브라질 헤알', dp: 2 },
  { code: 'GBP', name: '영국 파운드', dp: 2 },
  { code: 'AUD', name: '호주 달러', dp: 2 },
  { code: 'CAD', name: '캐나다 달러', dp: 2 },
  { code: 'CHF', name: '스위스 프랑', dp: 2 },
  { code: 'HKD', name: '홍콩 달러', dp: 2 },
  { code: 'TWD', name: '대만 달러', dp: 2 },
  { code: 'SGD', name: '싱가포르 달러', dp: 2 },
  { code: 'THB', name: '태국 바트', dp: 2 },
  { code: 'VND', name: '베트남 동', dp: 0 },
  { code: 'IDR', name: '인도네시아 루피아', dp: 0 },
  { code: 'INR', name: '인도 루피', dp: 2 },
  { code: 'PHP', name: '필리핀 페소', dp: 2 },
  { code: 'MYR', name: '말레이시아 링깃', dp: 2 },
  { code: 'MXN', name: '멕시코 페소', dp: 2 },
  { code: 'RUB', name: '러시아 루블', dp: 2 },
  { code: 'TRY', name: '튀르키예 리라', dp: 2 },
  { code: 'NZD', name: '뉴질랜드 달러', dp: 2 },
  { code: 'SEK', name: '스웨덴 크로나', dp: 2 },
  { code: 'NOK', name: '노르웨이 크로네', dp: 2 },
];

export const FX_DEFAULT = ['KRW', 'USD', 'JPY'];
export const FX_MIN_SLOTS = 2;
export const FX_MAX_SLOTS = 3;

const BY_CODE = new Map(FX_CURRENCIES.map((c) => [c.code, c]));
export const isFxCode = (code) => BY_CODE.has(code);
export const fxName = (code) => BY_CODE.get(code)?.name || code;
export const fxDp = (code) => BY_CODE.get(code)?.dp ?? 2;

// ───────── 통화 조합 정규화 (Drive 로드 손상값 방어) ─────────
// ⚠️ 보충 → dedupe → 클램프 순서 필수. dedupe 를 먼저 하면 보충 단계가 만든 중복이 남는다.
export const normalizeFxCurrencies = (v) => {
  const known = (Array.isArray(v) ? v : []).filter((c) => typeof c === 'string' && isFxCode(c));
  const out = [];
  for (const c of [...known, ...FX_DEFAULT, ...FX_CURRENCIES.map((x) => x.code)]) {
    if (!out.includes(c)) out.push(c);
    if (out.length === FX_MAX_SLOTS) break;
  }
  return out;
};

export const normalizeFxSlotCount = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return FX_MIN_SLOTS;
  return Math.min(FX_MAX_SLOTS, Math.max(FX_MIN_SLOTS, n));
};

// ───────── 금액 파싱 / 표시 ─────────
// 콤마·통화기호·공백을 제거한 뒤 strict 검증. parseFloat 직접 호출 금지 —
// '1,000,0000' 을 1 로, '12x' 를 12 로 부분 파싱해 잘못된 값을 통과시킨다.
// ⚠️ 통화기호 제거를 `[^\d.+-]` 전역 치환으로 하지 말 것 — '12x34' 가 1234 로 통과한다.
//    기호는 앞뒤에서만 벗기고 가운데는 strict 정규식이 거르게 해야 무효 입력이 null 이 된다.
export const parseFxAmount = (s) => {
  const t = String(s ?? '')
    .replace(/[\s,_]/g, '')    // 천단위 구분자·공백(\s 가 NBSP 포함)
    .replace(/^[^\d.+-]+/, '') // 앞쪽 통화기호: ₩ $ R$ € £ ¥
    .replace(/[^\d.]+$/, '');  // 뒤쪽 단위 표기: 원 % 엔
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// 표시용 — 통화별 소수자리로 반올림 + 천단위 구분
export const formatFxAmount = (n, dp) => {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('ko-KR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

// 편집(focus) 진입용 — 콤마 없는 평문. 포맷된 문자열이 그대로 재편집되는 경로를 차단한다.
export const plainFxAmount = (n, dp) => {
  if (n == null || !Number.isFinite(n)) return '';
  const r = Number(n.toFixed(dp));
  return String(r);
};

// ───────── 변환 ─────────
// 누락(로딩 중·부분 실패)은 정상 상태다 → 예외가 아니라 null 을 반환한다.
// ⚠️ null 반환 계약을 없애면 렌더 중 TypeError 가 루트 ErrorBoundary 까지 올라가
//    계산기가 아니라 앱 화면 전체가 오류 페이지로 대체된다.
export const convertFx = (amount, from, to, rates) => {
  const f = rates?.[from];
  const t = rates?.[to];
  if (!f || !t) return null;
  if (!Number.isFinite(amount)) return null;
  if (!(f.rate > 0) || !(t.rate > 0)) return null;
  const v = (amount * t.rate) / f.rate;
  return Number.isFinite(v) ? v : null;
};

// 행별 등락률 = base 대비 교차환율의 전일 대비 변화율
//             = 그 행에 표시된 '금액'의 전일 대비 변화율 (금액과 부호가 항상 일치).
// ⚠️ 통화 자기 변화율(rate/prevRate−1)로 대체하지 말 것 — base 가 USD 가 아닐 때
//    뜻이 달라지고, USD 행은 항상 0.00% 로 고정된다.
export const fxChangePct = (from, to, rates) => {
  const a = rates?.[from];
  const b = rates?.[to];
  if (!a || !b) return null;
  if (!(a.rate > 0) || !(b.rate > 0)) return null;
  if (!(a.prevRate > 0) || !(b.prevRate > 0)) return null;
  const v = (b.rate / a.rate) / (b.prevRate / a.prevRate) - 1;
  return Number.isFinite(v) ? v * 100 : null;
};

// ───────── 조회 ─────────
const YAHOO = 'https://query1.finance.yahoo.com';
const FETCH_TIMEOUT = 8000;

// corsproxy.io 는 현재 403 을 반환해 제외. codetabs 는 간헐 무응답이라 마지막 순번.
const proxiesFor = (url) => [
  `/api/proxy?url=${encodeURIComponent(url)}`,
  `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

const linkSignal = (signal) => {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return signal;
};

const getJson = async (url, signal) => {
  for (const proxy of proxiesFor(url)) {
    if (signal?.aborted) return null;
    try {
      const res = await fetch(proxy, { signal: linkSignal(signal) });
      if (!res.ok) continue;
      const json = await res.json();
      if (json) return json;
    } catch {}
  }
  return null;
};

const quoteFromMeta = (m) => {
  const rate = Number(m?.regularMarketPrice);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const prev = Number(m?.chartPreviousClose);
  const at = Number(m?.regularMarketTime);
  return {
    rate,
    prevRate: Number.isFinite(prev) && prev > 0 ? prev : null,
    at: Number.isFinite(at) && at > 0 ? at : null,
  };
};

// spark 배치 응답 → { rates, missing }. 네트워크와 분리된 순수 함수(회귀 테스트 대상).
//
// ⚠️ 응답 배열은 요청 순서를 보장하지 않고(실측 5회 중 4회 불일치) 실패 심볼을
//    HTTP 200 + spark.error=null 로 조용히 드롭한다 → 반드시 최상위 result[i].symbol 로 키잉한다.
//    인덱스로 매칭하면 KRW 칸에 JPY 환율이 들어가 오류 표시 없이 9배 틀린 값이 나온다.
// ⚠️ meta.symbol 로 키잉하는 것도 금지 — 같은 심볼이 'KRW=X'/'USDKRW=X' 로 번갈아 온다.
// ⚠️ 길이 검사(result.length === wanted.length)로 대체 금지 — 드롭은 잡아도 재정렬은 못 잡는다.
export const mapSparkQuotes = (json, wanted) => {
  const bySymbol = new Map();
  for (const r of json?.spark?.result ?? []) {
    if (r && typeof r.symbol === 'string') bySymbol.set(r.symbol, r?.response?.[0]?.meta);
  }
  const rates: FxRateMap = {};
  const missing = [];
  for (const code of wanted) {
    const q = quoteFromMeta(bySymbol.get(`${code}=X`));
    if (q) rates[code] = q;
    else missing.push(code);
  }
  return { rates, missing };
};

// codes → FxRateMap. 실패한 통화는 맵에서 누락된다(부분 성공 허용) → 호출부가 '—' 표시.
export async function fetchFxRates(codes, signal) {
  const out: FxRateMap = { USD: { rate: 1, prevRate: 1, at: null } };
  const wanted = Array.from(new Set(codes || [])).filter((c) => c && c !== 'USD' && isFxCode(c));
  if (wanted.length === 0) return out;

  // 배치 1회 (spark)
  const sparkUrl = `${YAHOO}/v7/finance/spark?symbols=${wanted.map((c) => `${c}=X`).join(',')}&range=1d&interval=1d`;
  const json = await getJson(sparkUrl, signal);

  const { rates, missing } = mapSparkQuotes(json, wanted);
  Object.assign(out, rates);

  // 누락분만 개별 조회 폴백 — 심볼 1:1 이라 인덱스 매칭 자체가 없다.
  if (missing.length > 0 && !signal?.aborted) {
    const solo = await Promise.all(
      missing.map(async (code) => {
        const j = await getJson(
          `${YAHOO}/v8/finance/chart/${encodeURIComponent(`${code}=X`)}?range=1d&interval=1d`,
          signal
        );
        return [code, quoteFromMeta(j?.chart?.result?.[0]?.meta)];
      })
    );
    for (const [code, q] of solo) if (q) out[code] = q;
  }

  return out;
}

// 견적 시각 표시 (KST, MM/DD HH:mm)
export const formatFxQuoteTime = (sec) => {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
  return `${p(kst.getMonth() + 1)}/${p(kst.getDate())} ${p(kst.getHours())}:${p(kst.getMinutes())}`;
};
