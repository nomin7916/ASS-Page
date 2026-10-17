// Vercel Edge Function — 시장 지표 서버사이드 수집
// 브라우저 CORS 없이 직접 FRED / Naver / Yahoo Finance 호출
// [최적화] timeout 9000→6000ms(느린 응답 CPU 점유 단축), SWR 60→600s(캐시 만료 후 백그라운드 갱신 확대)
export const config = { runtime: 'edge' };

import { parseFredGraphCsv, parseBokBaseRateHtml, stepLatest, extendStepChanges, parseNyFedTarget, parsePmmsCsv } from './_indicatorSources.js';
import { US_FED_RATE_CHANGES } from './_usFedRateData.js';
import { KR_BASE_RATE_CHANGES, KR_BASE_RATE_SNAPSHOT_AT } from './_krBaseRateData.js';

const FRED_KEY = process.env.FRED_API_KEY ?? '';
// 한국은행 ECOS Open API 인증키 — 없으면 한국 기준금리는 빈 값 + needKey(화면에 '인증키 필요'). 값을 지어내지 않는다.
const ECOS_KEY = process.env.ECOS_API_KEY ?? '';

async function safeJson(url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), ...init });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// FRED (미연준 공식): DGS10(US10Y), DFEDTARU(기준금리 상단)
// ① API(키 있을 때) → ② fredgraph.csv(키 불필요) 폴백. 키가 없는 배포에서 기준금리가 통째로 '-'가 되거나
//    재시도 경로(tradingeconomics 스크래핑 — 차단되기 쉽다)에만 의존하던 것을 막는다.
// diff=true(장단기 금리차 T10Y2Y·T10Y3M): change를 비율(%)이 아니라 전일 대비 차이(%p)로 낸다 — 0 근처를 오가는
//    값이라 비율은 무의미하게 폭발한다. 0·음수도 정상값이다.
// 반환에 date(최신 관측일)·prev·prevDate를 싣는다 — 주간 지표(30년 모기지)는 카드에 '○월 ○일 값'을 표시하고,
//    MBS 스프레드는 두 시리즈의 날짜를 맞춰 계산한다(2026-10).
async function fetchFred(seriesId: string, diff = false) {
  const fromLatest = (vals: number[], dates: string[] = []) => {
    const price = vals[0];
    const prev  = vals.length > 1 ? vals[1] : null;
    return {
      date:   dates[0] ?? null,
      prev:   prev != null && Number.isFinite(prev) ? prev : null,
      prevDate: dates[1] ?? null,
      price:  Number.isFinite(price) ? price : null,
      change: diff
        ? (prev != null && Number.isFinite(prev) && Number.isFinite(price) ? price - prev : null)
        : (prev && Number.isFinite(prev) ? ((price - prev) / Math.abs(prev)) * 100 : null),
      source: 'FRED',
    };
  };
  if (FRED_KEY) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=5`;
    const data = await safeJson(url);
    const rows = (data?.observations ?? []).filter((o: any) => o.value !== '.' && Number.isFinite(parseFloat(o.value)));
    if (rows.length) return fromLatest(rows.map((o: any) => parseFloat(o.value)), rows.map((o: any) => o.date));
  }
  try {
    const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${since}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const rec = parseFredGraphCsv(await res.text(), diff);
      const ds = Object.keys(rec).sort().reverse();
      if (ds.length) return fromLatest(ds.map(d => rec[d]), ds);
    }
  } catch { /* 폴백 실패 */ }
  return { price: null, change: null, source: 'FRED' };
}

// FRED 키가 없는 배포의 대체 출처(2026-10-18) — 배포 서버에서 fredgraph.csv가 응답하지 않는다.
//   기준금리 = 변경 이력 스냅샷 + 뉴욕 연준 EFFR 목표 상단 · 30년 모기지 = 프레디맥 PMMS CSV(주간). 값을 지어내지 않는다.
async function fetchUsFedRateNoKey() {
  let obs = null;
  try {
    const res = await fetch('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/10.json', { signal: AbortSignal.timeout(6000) });
    if (res.ok) obs = parseNyFedTarget(await res.json());
  } catch { obs = null; }
  const v = stepLatest(extendStepChanges(US_FED_RATE_CHANGES, obs), new Date().toISOString().slice(0, 10));
  return v ? { ...v, source: obs ? '뉴욕 연준' : 'FRED 스냅샷' } : { price: null, change: null, source: '뉴욕 연준' };
}
async function fetchPmmsLatest() {
  try {
    const res = await fetch('https://www.freddiemac.com/pmms/docs/PMMS_history.csv', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const rec = parsePmmsCsv(await res.text()) || {};
      const ds = Object.keys(rec).sort().reverse();
      if (ds.length) {
        const price = rec[ds[0]], prev = ds.length > 1 ? rec[ds[1]] : null;
        return { price, prev, date: ds[0], prevDate: ds[1] ?? null, change: prev ? ((price - prev) / prev) * 100 : null, source: '프레디맥' };
      }
    }
  } catch { /* 빈 값 */ }
  return { price: null, change: null, source: '프레디맥' };
}

// Naver m.stock front-api (국내금 M04020000 실시간 현재가 — fetchNaverBond와 동일 패턴)
async function fetchGoldKrNaverMetal(): Promise<{ price: number | null; change: number | null; source: string }> {
  const data = await safeJson(
    'https://m.stock.naver.com/front-api/marketIndex/productDetail?category=metals&reutersCode=M04020000',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer':    'https://m.stock.naver.com/',
        'Accept':     'application/json',
      },
    }
  );
  if (!data?.isSuccess) return { price: null, change: null, source: 'NaverGoldKr' };
  const result = data.result;
  const price  = parseFloat(String(result?.closePrice ?? '0').replace(/,/g, ''));
  const change = result?.fluctuationsRatio != null ? parseFloat(String(result.fluctuationsRatio)) : null;
  return price > 0 ? { price: Math.round(price), change, source: 'NaverGoldKr' } : { price: null, change: null, source: 'NaverGoldKr' };
}

// finance.naver.com 금일별시세 HTML 파싱 (국내금 fallback — 기준가 기반)
async function fetchGoldKrFinanceNaver(): Promise<{ price: number | null; change: number | null; source: string }> {
  try {
    const res = await fetch(
      'https://finance.naver.com/marketindex/goldDailyQuote.naver?page=1',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Referer':    'https://finance.naver.com/marketindex/',
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return { price: null, change: null, source: 'Naver금' };
    const html  = await res.text();
    const prices: number[] = [];
    const re = /class="num">([\d,]+\.?\d*)</g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (v > 1000) prices.push(v);
    }
    if (prices.length < 2) return { price: null, change: null, source: 'Naver금' };
    const price  = prices[0];
    const prev   = prices[1];
    const change = prev > 0 ? ((price - prev) / prev) * 100 : null;
    return { price: Math.round(price), change, source: 'Naver금' };
  } catch {
    return { price: null, change: null, source: 'Naver금' };
  }
}

// Naver Mobile API (서버사이드 직접 호출 — CORS 없음)
async function fetchNaver(path: string, source: string) {
  const data = await safeJson(`https://m.stock.naver.com${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Referer':    'https://m.stock.naver.com/',
      'Accept':     'application/json',
    },
  });
  const raw    = String(data?.closePrice ?? data?.price ?? '0').replace(/,/g, '');
  const price  = parseFloat(raw);
  const change = data?.fluctuationsRatio != null ? parseFloat(String(data.fluctuationsRatio)) : null;
  return price > 0 ? { price, change, source } : { price: null, change: null, source };
}

// Naver front-api/marketIndex/productDetail (채권 현재가 — /api/marketIndex/bond/ 경로 deprecated 대체)
async function fetchNaverBond(reutersCode: string, source: string) {
  const data = await safeJson(
    `https://m.stock.naver.com/front-api/marketIndex/productDetail?category=bond&reutersCode=${encodeURIComponent(reutersCode)}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer':    'https://m.stock.naver.com/',
        'Accept':     'application/json',
      },
    }
  );
  if (!data?.isSuccess) return { price: null, change: null, source };
  const result = data.result;
  const price  = parseFloat(String(result?.closePrice ?? '0').replace(/,/g, ''));
  const change = result?.fluctuationsRatio != null ? parseFloat(String(result.fluctuationsRatio)) : null;
  return price > 0 ? { price, change, source } : { price: null, change: null, source };
}

// 한국은행 기준금리(ECOS 722Y001 · 0101000 · 일별) — 최근 60일에서 마지막 값과 그 직전의 다른 값(%p 차이)
// 한국은행 '기준금리 추이' 공시 페이지(키 불필요) — 변경 이력 전체. 실패하면 저장된 스냅샷(_krBaseRateData)
const BOK_BASE_RATE_URL = 'https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643';
async function fetchBokBaseRateChanges(timeoutMs = 6000): Promise<{ changes: Array<[string, number]>; source: string }> {
  try {
    const res = await fetch(BOK_BASE_RATE_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const parsed = parseBokBaseRateHtml(await res.text());
      if (parsed && parsed.length) return { changes: parsed, source: 'BOK' };
    }
  } catch { /* 스냅샷으로 */ }
  return { changes: KR_BASE_RATE_CHANGES, source: `BOK 스냅샷(${KR_BASE_RATE_SNAPSHOT_AT})` };
}

// 한국은행 기준금리 — ECOS(인증키) → 한국은행 공시 페이지 → 스냅샷 순. needKey는 'ECOS 키가 없어 보충 출처를 썼다'는 표시
async function fetchEcosBaseRate() {
  const ecos = ECOS_KEY ? await fetchEcosBaseRateRaw() : { price: null, change: null, source: 'ECOS', needKey: true };
  if (ecos.price != null) return ecos;
  const { changes, source } = await fetchBokBaseRateChanges();
  const latest = stepLatest(changes, new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
  return latest ? { price: latest.price, change: latest.change, source, date: latest.date, needKey: !ECOS_KEY } : ecos;
}

async function fetchEcosBaseRateRaw() {
  const ymdOf = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const end = new Date(), start = new Date(Date.now() - 60 * 86400000);
  const data = await safeJson(`https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(ECOS_KEY)}/json/kr/1/100/722Y001/D/${ymdOf(start)}/${ymdOf(end)}/0101000`);
  const rows = Array.isArray(data?.StatisticSearch?.row) ? data.StatisticSearch.row : null;
  if (!rows || !rows.length) return { price: null, change: null, source: 'ECOS', needKey: data?.RESULT?.CODE === 'INFO-100' };
  const vals = rows.map((r: any) => ({ t: String(r.TIME), v: parseFloat(String(r.DATA_VALUE)) })).filter((x: any) => /^\d{8}$/.test(x.t) && Number.isFinite(x.v));
  if (!vals.length) return { price: null, change: null, source: 'ECOS' };
  vals.sort((a: any, b: any) => (a.t < b.t ? -1 : 1));
  const last = vals[vals.length - 1];
  const prevDiff = [...vals].reverse().find((x: any) => x.v !== last.v);
  const date = `${last.t.slice(0, 4)}-${last.t.slice(4, 6)}-${last.t.slice(6, 8)}`;
  return { price: last.v, change: prevDiff ? Math.round((last.v - prevDiff.v) * 10000) / 10000 : 0, source: 'ECOS', date };
}

// 브라질 중앙은행 SGS 최신값(키 불필요) — 오늘 이후 날짜는 버리고 마지막 값 + 직전 관측 대비 차이(%p)
//   432 = Selic 목표(일별, 다음 Copom 날짜까지 미리 채워져 온다) · 13522 = IPCA 12개월(월별, 날짜는 그 달 1일)
async function fetchBcbSgsLatest(series: number, lookbackDays: number) {
  const ddmmyyyy = (d: Date) => { const s = d.toISOString().slice(0, 10); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; };
  const today = new Date().toISOString().slice(0, 10);
  const data = await safeJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados?formato=json&dataInicial=${ddmmyyyy(new Date(Date.now() - lookbackDays * 86400000))}&dataFinal=${ddmmyyyy(new Date())}`);
  if (!Array.isArray(data)) return { price: null, change: null, source: 'BCB' };
  const pts = data.map((r: any) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(r?.data ?? ''));
    return m ? { d: `${m[3]}-${m[2]}-${m[1]}`, v: parseFloat(String(r?.valor)) } : null;
  }).filter((x: any) => x && Number.isFinite(x.v) && x.d <= today).sort((a: any, b: any) => (a.d < b.d ? -1 : 1));
  if (!pts.length) return { price: null, change: null, source: 'BCB' };
  const last = pts[pts.length - 1];
  const prev = series === 432 ? [...pts].reverse().find((x: any) => x.v !== last.v) : pts[pts.length - 2];
  return { price: last.v, change: prev ? Math.round((last.v - prev.v) * 10000) / 10000 : 0, source: 'BCB', date: last.d };
}

// BCB Olinda 12개월 후 기대 인플레이션(IPCA 중앙값, 평활 S, 전체 응답자) — 마지막 값 + 직전 관측 대비 차이(%p)
async function fetchBcbExpect12() {
  const q = (s: string) => encodeURIComponent(s);
  const data = await safeJson('https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoInflacao12Meses'
    + `?$top=5&$filter=${q("Indicador eq 'IPCA' and Suavizada eq 'S' and baseCalculo eq 0")}&$orderby=${q('Data desc')}&$format=json&$select=${q('Data,Mediana')}`);
  const rows = Array.isArray(data?.value) ? data.value.filter((r: any) => Number.isFinite(Number(r?.Mediana))) : [];
  if (!rows.length) return { price: null, change: null, source: 'BCB' };
  const last = Number(rows[0].Mediana), prev = rows[1] ? Number(rows[1].Mediana) : null;
  return { price: last, change: prev != null ? Math.round((last - prev) * 10000) / 10000 : null, source: 'BCB', date: String(rows[0].Data).slice(0, 10) };
}

// Yahoo Finance v8 chart API (서버사이드 직접 호출)
async function fetchYahoo(symbol: string) {
  const data = await safeJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
    {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }
  );
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return { price: null, change: null, source: 'Yahoo' };
  const price = meta.regularMarketPrice as number;
  const prev  = (meta.chartPreviousClose ?? meta.previousClose) as number | undefined;
  return { price, change: prev ? ((price / prev) - 1) * 100 : null, source: 'Yahoo' };
}

// Naver m.stock front-api (국제금 GCcv1 실시간 — CORS 없는 서버사이드 전용)
async function fetchNaverGoldIntl(): Promise<{ price: number | null; change: number | null; source: string }> {
  try {
    const res = await fetch(
      'https://m.stock.naver.com/front-api/realTime/marketIndex/metals',
      {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Content-Type': 'application/json',
          'Accept':       'application/json, text/plain, */*',
          'Referer':      'https://m.stock.naver.com/marketindex/metals/GCcv1',
        },
        body: JSON.stringify({ reutersCodes: ['GCcv1'] }),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return { price: null, change: null, source: 'NaverGold' };
    const data = await res.json();
    if (!data?.isSuccess) return { price: null, change: null, source: 'NaverGold' };
    const item = data?.result?.metals?.GCcv1;
    if (!item) return { price: null, change: null, source: 'NaverGold' };
    const price  = parseFloat(String(item.closePrice).replace(/,/g, ''));
    const change = item.fluctuationsRatio != null ? parseFloat(String(item.fluctuationsRatio)) : null;
    return price > 0 ? { price, change, source: 'NaverGold' } : { price: null, change: null, source: 'NaverGold' };
  } catch {
    return { price: null, change: null, source: 'NaverGold' };
  }
}

// CoinGecko (무료 공개 API — 암호화폐 fallback)
async function fetchCoinGecko(coinId: string) {
  const data = await safeJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`,
    { headers: { 'Accept': 'application/json' } }
  );
  const coin = data?.[coinId];
  return coin?.usd
    ? { price: coin.usd as number, change: (coin.usd_24h_change as number) ?? null, source: 'CoinGecko' }
    : { price: null, change: null, source: 'CoinGecko' };
}

export default async function handler(req: Request): Promise<Response> {
  // ?fresh=1 — 사용자가 직접 누른 갱신(헤더 시장지표 칩·새로고침 버튼). 엣지 캐시(s-maxage=300)를
  // 건너뛰고 항상 업스트림에서 다시 수집한다. 자동 수집(앱 시작)은 파라미터 없이 캐시 경로를 그대로 쓴다.
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';

  // 모든 지표를 병렬 수집 — 개별 실패가 전체에 영향 없음
  const [
    us10yFred, us10yYahoo, us10yNaver, fedRate,
    kr10yNaver, kr10yYahoo,
    kr3yNaver, kr3yYahoo, krBase,
    brSelic, brIpca, brExp12, br10yNaver, br10yYahoo, brlusd,
    kospi,
    sp500Yahoo, sp500Naver,
    nasdaqYahoo, nasdaqNaver,
    usdkrwYahoo, usdkrwNaver,
    goldKrMetal, goldKrHtml,
    dxy, goldIntlMain, goldIntlFallback, goldIntlNaver,
    vix,
    btcYahoo, ethYahoo,
    btcCg, ethCg,
    us2y, us30y, us3m, t10y2y, t10y3m,
    hyYield, hySpread, mort30F, move,
    us2yNaver, us30yNaver, us3mNaver, fedRateAlt, mort30Alt,
  ] = await Promise.allSettled([
    fetchFred('DGS10'),                                                // US 10Y (FRED — 영업일 종가 기준)
    fetchYahoo('^TNX'),                                                // US 10Y (Yahoo — 장중 실시간 fallback)
    fetchNaverBond('US10YT=RR', 'Naver채권US'),                        // US 10Y (Naver — 3rd fallback)
    fetchFred('DFEDTARU'),                                             // 미국 기준금리 상단 (FRED)
    fetchNaverBond('KR10YT=RR', 'Naver채권'),                         // KR 10Y (Naver primary)
    fetchYahoo('^KR10YT=RR'),                                          // KR 10Y (Yahoo fallback)
    fetchNaverBond('KR3YT=RR', 'Naver채권'),                          // 국고채 3년 (Naver primary)
    fetchYahoo('^KR3YT=RR'),                                           // 국고채 3년 (Yahoo fallback)
    fetchEcosBaseRate(),                                               // 한국은행 기준금리 (ECOS)
    fetchBcbSgsLatest(432, 60),                                        // 브라질 Selic 목표 (BCB SGS 432, 일별)
    fetchBcbSgsLatest(13522, 400),                                     // 브라질 IPCA 12개월 (BCB SGS 13522, 월별)
    fetchBcbExpect12(),                                                // 브라질 12개월 기대 인플레이션 (BCB Olinda)
    fetchNaverBond('BR10YT=RR', 'Naver채권'),                         // 브라질 10년 (Naver primary)
    fetchYahoo('^BR10YT=RR'),                                          // 브라질 10년 (Yahoo fallback — 2026-10 실측 '없는 심볼', 빈 값)
    fetchYahoo('BRL=X'),                                               // 헤알/달러 (1달러당 헤알)
    fetchNaver('/api/index/KOSPI/basic',                'Naver'),      // KOSPI
    fetchYahoo('^GSPC'),                                               // S&P500 (Yahoo primary)
    fetchNaver('/api/index/SPI@SPX/basic',              'Naver'),      // S&P500 (Naver fallback)
    fetchYahoo('^NDX'),                                                // Nasdaq100 (Yahoo primary)
    fetchNaver('/api/index/NAS@NDX/basic',              'Naver'),      // Nasdaq100 (Naver fallback)
    fetchYahoo('KRW=X'),                                               // USDKRW (Yahoo primary)
    fetchNaver('/api/marketIndex/exchange/FX_USDKRW',  'Naver환율'),  // USDKRW (Naver fallback)
    fetchGoldKrNaverMetal(),                                           // 국내금 M04020000 실시간 (primary)
    fetchGoldKrFinanceNaver(),                                         // 국내금 HTML 기준가 (fallback)
    fetchYahoo('DX-Y.NYB'),                                            // DXY
    fetchYahoo('GC=F'),                                                // 국제금 선물(Yahoo primary)
    fetchYahoo('XAUUSD=X'),                                            // 국제금 현물(Yahoo fallback)
    fetchNaverGoldIntl(),                                              // 국제금 GCcv1(Naver — 3rd fallback)
    fetchYahoo('^VIX'),                                                // VIX
    fetchYahoo('BTC-USD'),                                             // BTC (Yahoo)
    fetchYahoo('ETH-USD'),                                             // ETH (Yahoo)
    fetchCoinGecko('bitcoin'),                                         // BTC (fallback)
    fetchCoinGecko('ethereum'),                                        // ETH (fallback)
    fetchFred('DGS2'),                                                 // 미국 2년 (FRED)
    fetchFred('DGS30'),                                                // 미국 30년 (FRED)
    fetchFred('DGS3MO'),                                               // 미국 3개월 (FRED)
    fetchFred('T10Y2Y', true),                                         // 10년−2년 금리차 (%p)
    fetchFred('T10Y3M', true),                                         // 10년−3개월 금리차 (%p)
    fetchFred('BAMLH0A0HYM2EY'),                                       // 하이일드 금리 (%)
    fetchFred('BAMLH0A0HYM2', true),                                   // 하이일드 스프레드 (%p)
    fetchFred('MORTGAGE30US'),                                         // 30년 모기지 (%, 주간)
    fetchYahoo('^MOVE'),                                               // MOVE 금리 변동성 지수
    fetchNaverBond('US2YT=RR', 'Naver채권US'),                         // 미국 2년 (FRED 실패 시)
    fetchNaverBond('US30YT=RR', 'Naver채권US'),                        // 미국 30년 (FRED 실패 시)
    fetchNaverBond('US3MT=RR', 'Naver채권US'),                         // 미국 3개월 (FRED 실패 시)
    fetchUsFedRateNoKey(),                                             // 기준금리 (FRED가 비면 — 키 변수가 있어도 무효일 수 있다)
    fetchPmmsLatest(),                                                 // 30년 모기지 (FRED가 비면)
  ]);

  const ok = <T>(r: PromiseSettledResult<T>) =>
    r.status === 'fulfilled' ? r.value : null;

  // GC=F → XAUUSD=X → Naver GCcv1 순으로 fallback
  const goldIntl = ok(goldIntlMain)?.price ? ok(goldIntlMain)
    : ok(goldIntlFallback)?.price ? ok(goldIntlFallback)
    : ok(goldIntlNaver);
  // Yahoo 실패 시 CoinGecko 사용
  const btc = ok(btcYahoo)?.price ? ok(btcYahoo) : ok(btcCg);
  const eth = ok(ethYahoo)?.price ? ok(ethYahoo) : ok(ethCg);
  // Yahoo primary, Naver fallback
  const sp500  = ok(sp500Yahoo)?.price  ? ok(sp500Yahoo)  : ok(sp500Naver);
  const nasdaq = ok(nasdaqYahoo)?.price ? ok(nasdaqYahoo) : ok(nasdaqNaver);
  const usdkrw = ok(usdkrwYahoo)?.price ? ok(usdkrwYahoo) : ok(usdkrwNaver);
  // US 10Y: Naver(실시간) → Yahoo → FRED(전일 종가 fallback)
  const us10y = ok(us10yNaver)?.price ? ok(us10yNaver) : ok(us10yYahoo)?.price ? ok(us10yYahoo) : ok(us10yFred);
  // KR 10Y: Naver primary → Yahoo fallback
  const kr10y = ok(kr10yNaver)?.price ? ok(kr10yNaver) : ok(kr10yYahoo);
  const kr3y = ok(kr3yNaver)?.price ? ok(kr3yNaver) : ok(kr3yYahoo);
  // 한미 10년 금리차(%p) = 한국 10년 − 미국 10년(둘 다 위에서 고른 최신값). 음수 정상. 전일 대비는 비운다(두 소스 기준이 다르다).
  const krUs10y = kr10y?.price != null && us10y?.price != null
    ? { price: Math.round((kr10y.price - us10y.price) * 10000) / 10000, change: null, source: 'calc' }
    : { price: null, change: null, source: 'calc' };
  // 브라질 — br10y는 Naver → Yahoo, 둘 다 실패면 빈 값(다른 사이트를 긁지 않는다)
  const br10y = ok(br10yNaver)?.price ? ok(br10yNaver) : ok(br10yYahoo)?.price ? ok(br10yYahoo) : { price: null, change: null, source: 'Naver채권' };
  const bu = ok(brlusd), ex = ok(brExp12);
  // 헤알·원 = 원/달러 ÷ 헤알/달러 · 전일 대비(%) = (1 + 원/달러%) ÷ (1 + 헤알/달러%) − 1
  const brlkrw = usdkrw?.price && bu?.price
    ? { price: Math.round((usdkrw.price / bu.price) * 10000) / 10000,
        change: usdkrw.change != null && bu.change != null ? ((1 + usdkrw.change / 100) / (1 + bu.change / 100) - 1) * 100 : null, source: 'calc' }
    : { price: null, change: null, source: 'calc' };
  // 브라질 실질금리(%p) = 10년 − 12개월 기대 인플레이션(각자 최신값). 음수 정상
  const brReal = br10y?.price != null && ex?.price != null
    ? { price: Math.round((br10y.price - ex.price) * 10000) / 10000, change: null, source: 'calc' }
    : { price: null, change: null, source: 'calc' };
  // 국내금: Naver front-api(M04020000) → HTML 기준가 순으로 fallback
  const goldKr = ok(goldKrMetal)?.price ? ok(goldKrMetal) : ok(goldKrHtml)?.price ? ok(goldKrHtml) : null;

  // FRED가 비면 대체 출처 — 미국 국채는 네이버, 금리차는 네이버 10년 − 2년/3개월(전일 대비는 비운다), 기준금리·모기지는 위 대체 함수
  const pick = (a: any, b: any) => (a?.price != null ? a : b?.price != null ? b : a);
  const us2yV = pick(ok(us2y), ok(us2yNaver)), us30yV = pick(ok(us30y), ok(us30yNaver)), us3mV = pick(ok(us3m), ok(us3mNaver));
  const ten = ok(us10yNaver)?.price != null ? ok(us10yNaver) : us10y;
  const spreadAlt = (short: any) => (ten?.price != null && short?.price != null
    ? { price: Math.round((ten.price - short.price) * 10000) / 10000, change: null, source: 'calc(네이버)' } : null);
  const t10y2yV = pick(ok(t10y2y), spreadAlt(ok(us2yNaver))), t10y3mV = pick(ok(t10y3m), spreadAlt(ok(us3mNaver)));
  const fedRateV = pick(ok(fedRate), ok(fedRateAlt));
  const mort30 = { status: 'fulfilled', value: pick(ok(mort30F), ok(mort30Alt)) } as PromiseSettledResult<any>;
  const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const us10yForMbs = ok(us10yFred)?.price != null && ok(us10yFred)?.date ? ok(us10yFred)
    : (us10y?.price != null ? { price: us10y.price, prev: null, date: todayKst, prevDate: null } : null);

  // MBS 스프레드(%p) = 30년 모기지 − 미국 10년(FRED DGS10 — 히스토리 /api/history mbsSpread와 같은 소스).
  //   10년물 최신일에 그날(또는 직전) 모기지 값을 맞춘다. 전일 대비도 같은 규칙의 %p 차이.
  const mbsSpread = (() => {
    const m = ok(mort30), u = us10yForMbs;
    if (!m || !u || m.price == null || u.price == null || !m.date || !u.date) return { price: null, change: null, source: 'FRED' };
    const mortAt = (d: string | null) => (d && d >= m.date ? m.price : m.prev);
    const r4 = (v: number) => Math.round(v * 10000) / 10000;
    const cur = mortAt(u.date);
    const prv = u.prev != null ? mortAt(u.prevDate) : null;
    if (cur == null) return { price: null, change: null, source: 'FRED' };
    const price = r4(cur - u.price);
    return { price, change: prv != null && u.prev != null ? r4(price - (prv - u.prev)) : null, source: 'FRED', date: u.date };
  })();

  const body = {
    us10y,
    fedRate: fedRateV,
    us2y:    us2yV,
    us30y:   us30yV,
    us3m:    us3mV,
    t10y2y:  t10y2yV,
    t10y3m:  t10y3mV,
    hyYield: ok(hyYield),
    hySpread: ok(hySpread),
    mort30:  ok(mort30),
    mbsSpread,
    move:    ok(move),
    kr10y,
    kr3y,
    krBase:  ok(krBase),
    krUs10y,
    brSelic: ok(brSelic),
    brIpca:  ok(brIpca),
    brExp12: ex,
    br10y,
    brlusd:  bu,
    brlkrw,
    brReal,
    usdkrw,
    goldKr,
    kospi:   ok(kospi),
    sp500,
    nasdaq,
    dxy:     ok(dxy),
    goldIntl,
    vix:     ok(vix),
    btc,
    eth,
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  '*',
      // fresh=1은 no-store — 엣지가 저장하지 않아 다음 클릭도 다시 업스트림을 탄다.
      // (쿼리 문자열이 고정이라 캐시 키가 늘어나지 않는다)
      'Cache-Control':                fresh
        ? 'no-store, max-age=0'
        : 's-maxage=300, stale-while-revalidate=600',
    },
  });
}
