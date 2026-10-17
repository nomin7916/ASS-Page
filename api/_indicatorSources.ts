// 시장지표 히스토리 소스 병합 헬퍼 — 순수 함수만(비라우트 모듈, 언더스코어 규약).
// ⚠️ import 0건 · process.env 미사용 · enum/namespace 금지 — scripts/verify-indicators.mjs가 직접 import한다.

// fredgraph.csv(키 불필요) — "observation_date,SERIES\nYYYY-MM-DD,값" (결측은 '.' 또는 빈 칸)
// signed=true: 장단기 금리차(T10Y2Y·T10Y3M)처럼 0·음수가 정상값인 시리즈 — 값 부호로 버리지 않는다.
export function parseFredGraphCsv(csv: string, signed = false): Record<string, number> {
  const record: Record<string, number> = {};
  for (const line of String(csv || '').split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2}),\s*([^,\s]*)/.exec(line.trim());
    if (!m) continue;
    const v = parseFloat(m[2]);
    if (m[2] !== '' && Number.isFinite(v) && (signed || v > 0)) record[m[1]] = v;
  }
  return record;
}

const keysOf = (r: Record<string, number>) => Object.keys(r || {}).sort();

// 주 소스(primary)가 덮지 못한 **앞쪽**만 보조 소스로 채운다 — 겹치는 날짜는 주 소스가 이긴다.
// (두 소스의 값 기준이 조금씩 달라도 한 날짜에 섞이지 않게 경계로 자른다)
export function fillBefore(primary: Record<string, number>, secondary: Record<string, number>): Record<string, number> {
  const first = keysOf(primary)[0];
  if (!first) return { ...(secondary || {}) };
  const out: Record<string, number> = { ...primary };
  for (const d of keysOf(secondary)) {
    if (d >= first) break;
    out[d] = secondary[d];
  }
  return out;
}

// 주 소스가 덮지 못한 **뒤쪽**(최신)만 보조 소스로 채운다.
export function fillAfter(primary: Record<string, number>, secondary: Record<string, number>): Record<string, number> {
  const ks = keysOf(primary);
  const last = ks[ks.length - 1];
  if (!last) return { ...(secondary || {}) };
  const out: Record<string, number> = { ...primary };
  for (const d of keysOf(secondary)) if (d > last) out[d] = secondary[d];
  return out;
}

// 연준 기준금리 — DFEDTAR(단일 목표, ~2008-12-15) + DFEDTARU(상단, 2008-12-16~)를 이어 붙인다.
// 상단 시계열이 있는 날짜는 상단이 이긴다(겹치는 날은 원래 없다).
export function joinFedRate(legacy: Record<string, number>, upper: Record<string, number>): Record<string, number> {
  return fillBefore(upper || {}, legacy || {});
}

// MBS 스프레드(%p) = 30년 모기지(MORTGAGE30US, 주간·목요일 발표) − 미국 10년(DGS10, 일별) — 2026-10.
// us10y 날짜마다 계산하고, 그날 모기지 값이 없으면 **직전** 모기지 값을 쓴다(같은 날짜면 그날 값끼리).
// 첫 모기지 발표 이전 날짜는 만들지 않는다. 0·음수가 나올 수 있다(SIGNED_INDICATOR_KEYS의 mbsSpread).
// 부동소수 잔차(6.81−4.1=2.7099999…)는 소수 4자리로 정리한다.
export function computeMbsSpread(mort30: Record<string, number>, us10y: Record<string, number>): Record<string, number> {
  const mk = keysOf(mort30);
  const out: Record<string, number> = {};
  let i = 0, cur: number | null = null;
  for (const d of keysOf(us10y)) {
    while (i < mk.length && mk[i] <= d) { cur = mort30[mk[i]]; i++; }
    const u = us10y[d];
    if (cur == null || !Number.isFinite(cur) || !Number.isFinite(u)) continue;
    out[d] = Math.round((cur - u) * 10000) / 10000;
  }
  return out;
}

// 한미 10년 금리차(%p) = 한국 10년 − 미국 10년(DGS10) — 2026-10 7단계.
// 한국 날짜마다 계산하고, 그날 미국 값이 없으면 **직전** 미국 값을 쓴다. 음수가 정상(SIGNED_INDICATOR_KEYS의 krUs10y).
export function computeKrUsSpread(kr10y: Record<string, number>, us10y: Record<string, number>): Record<string, number> {
  const uk = keysOf(us10y);
  const out: Record<string, number> = {};
  let i = 0, cur: number | null = null;
  for (const d of keysOf(kr10y)) {
    while (i < uk.length && uk[i] <= d) { cur = us10y[uk[i]]; i++; }
    const k = kr10y[d];
    if (cur == null || !Number.isFinite(cur) || !Number.isFinite(k)) continue;
    out[d] = Math.round((k - cur) * 10000) / 10000;
  }
  return out;
}

// 두 시계열을 첫째 것의 날짜로 맞춘다 — 그날 둘째 값이 없으면 **직전** 값을 쓴다(브라질 지표 2026-10 8-A).
function alignOnOrBefore(a: Record<string, number>, b: Record<string, number>, fn: (x: number, y: number) => number): Record<string, number> {
  const bk = keysOf(b);
  const out: Record<string, number> = {};
  let i = 0, cur: number | null = null;
  for (const d of keysOf(a)) {
    while (i < bk.length && bk[i] <= d) { cur = b[bk[i]]; i++; }
    const x = a[d];
    if (cur == null || !Number.isFinite(cur) || !Number.isFinite(x)) continue;
    const v = fn(x, cur);
    if (Number.isFinite(v)) out[d] = Math.round(v * 10000) / 10000;
  }
  return out;
}
// 헤알·원(1헤알당 원) = 원/달러(usdkrw) ÷ 헤알/달러(brlusd) — usdkrw 날짜 기준
export const computeBrlKrw = (usdkrw: Record<string, number>, brlusd: Record<string, number>) =>
  alignOnOrBefore(usdkrw, brlusd, (u, b) => (b > 0 ? u / b : NaN));
// 브라질 실질금리(%p) = 브라질 10년 − 12개월 기대 인플레이션 — 10년물 날짜 기준. 음수 정상(SIGNED의 brReal)
export const computeBrReal = (br10y: Record<string, number>, exp12: Record<string, number>) =>
  alignOnOrBefore(br10y, exp12, (r, e) => r - e);

// 브라질 중앙은행 SGS(api.bcb.gov.br/dados/serie/bcdata.sgs.{n}/dados) — [{ data:'dd/MM/yyyy', valor:'14.00' }]
//   432 = Selic 목표(일별, 1999-03-05~ · 다음 Copom 날짜까지 미리 채워져 온다 → maxIso 이후는 버린다)
//   13522 = IPCA 12개월 누적(월별, 1980-12-01~ · 날짜는 그 달 1일)
//   ⚠️ 일별 시리즈는 한 번에 최대 10년만 조회된다(그 이상은 오류 객체).
export function parseBcbSgs(json: any, maxIso = '9999-12-31'): Record<string, number> | null {
  if (!Array.isArray(json)) return null;
  const out: Record<string, number> = {};
  for (const r of json) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(r?.data ?? ''));
    const v = parseFloat(String(r?.valor ?? ''));
    if (!m || !Number.isFinite(v)) continue;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (iso <= maxIso) out[iso] = v;
  }
  return out;
}

// BCB Olinda 'Expectativas de Mercado' ExpectativasMercadoInflacao12Meses — { value:[{ Data:'2026-10-09', Mediana:4.4772 }] }
//   IPCA · Suavizada='S' · baseCalculo=0 의 중앙값(영업일마다 갱신, 2001-12-12~). 오류 응답은 null.
export function parseOlindaExpect(json: any): Record<string, number> | null {
  if (!Array.isArray(json?.value)) return null;
  const out: Record<string, number> = {};
  for (const r of json.value) {
    const d = String(r?.Data ?? '').slice(0, 10);
    const v = Number(r?.Mediana);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v)) out[d] = v;
  }
  return out;
}

// 한국은행 '기준금리 추이' 공시 페이지 HTML → [[변경일 'YYYY-MM-DD', 기준금리], …](날짜 오름차순). 표를 못 찾으면 null.
//   표 행 = <td>2026</td><td>08월 27일</td><td>3.00</td>
export function parseBokBaseRateHtml(html: string): Array<[string, number]> | null {
  const out: Array<[string, number]> = [];
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  for (const row of String(html || '').match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const c = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(strip);
    if (c.length !== 3 || !/^\d{4}$/.test(c[0])) continue;
    const m = /^(\d{2})월\s*(\d{2})일$/.exec(c[1]);
    const v = parseFloat(c[2]);
    if (m && Number.isFinite(v) && v > 0) out.push([`${c[0]}-${m[1]}-${m[2]}`, v]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out.length ? out : null;
}
// 변경 이력(계단) → 달력 날짜마다 그날 적용 금리(ECOS 일별과 같은 모양 — 주말·휴일도 값이 있다). 첫 변경 전 날짜는 만들지 않는다
export function stepToDaily(changes: Array<[string, number]>, d1Iso: string, d2Iso: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(changes) || !changes.length) return out;
  const start = d1Iso > changes[0][0] ? d1Iso : changes[0][0];
  let i = 0, cur: number | null = null;
  for (let t = Date.parse(`${start}T00:00:00Z`), end = Date.parse(`${d2Iso}T00:00:00Z`); t <= end; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    while (i < changes.length && changes[i][0] <= d) { cur = changes[i][1]; i++; }
    if (cur != null) out[d] = cur;
  }
  return out;
}
// 오늘 적용 금리와 직전 변경 폭(%p)
export function stepLatest(changes: Array<[string, number]>, todayIso: string): { price: number; change: number; date: string } | null {
  const past = (changes || []).filter(c => c[0] <= todayIso);
  if (!past.length) return null;
  const last = past[past.length - 1], prev = past[past.length - 2];
  return { price: last[1], change: prev ? Math.round((last[1] - prev[1]) * 10000) / 10000 : 0, date: last[0] };
}

// 한국은행 ECOS StatisticSearch 응답 → { 'YYYY-MM-DD': 값 }. 오류 응답(RESULT)·모양이 틀리면 null(= 조회 실패).
//   기준금리 = 통계표 722Y001(1.3.1. 한국은행 기준금리 및 여수신금리) · 항목 0101000(한국은행 기준금리) · 주기 D(일),
//   단위 연% · 일별 자료 첫날 1999-05-06(ECOS StatisticItemList로 확인, 2026-10).
export function parseEcosRows(json: any): Record<string, number> | null {
  const rows = json?.StatisticSearch?.row;
  if (!Array.isArray(rows)) return null;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const t = String(r?.TIME ?? '');
    const v = parseFloat(String(r?.DATA_VALUE ?? ''));
    if (/^\d{8}$/.test(t) && Number.isFinite(v) && v > 0) out[`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`] = v;
  }
  return out;
}

// 네이버 채권 일별 시세(front-api/marketIndex/prices) → { 'YYYY-MM-DD': 종가 }. 최근 약 3년만 제공한다(2026-10 실측).
export function parseNaverBondPrices(json: any): Record<string, number> | null {
  if (!json?.isSuccess || !Array.isArray(json?.result)) return null;
  const out: Record<string, number> = {};
  for (const it of json.result) {
    const d = String(it?.localTradedAt ?? '').slice(0, 10);
    const v = parseFloat(String(it?.closePrice ?? ''));
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v) && v > 0) out[d] = v;
  }
  return out;
}

// 응답 캐시 — 종료일이 최근 2일 이내면 '최신 꼬리를 포함한 요청'이라 짧게 캐시한다.
export function isRecentRangeEnd(d2Ymd: string, todayYmd: string): boolean {
  if (!/^\d{8}$/.test(d2Ymd || '') || !/^\d{8}$/.test(todayYmd || '')) return true;
  const toNum = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 86400000;
  return toNum(todayYmd) - toNum(d2Ymd) <= 2;
}
