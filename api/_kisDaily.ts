// KIS 국내 일별 시세(FHKST03010100 inquire-daily-itemchartprice) 구간 수집 — 페이지 넘김 포함.
// 언더스코어 = 비라우트 모듈(_kisToken.ts와 같은 규약). api/stock-history.ts·api/history.ts가 공유한다.
//
// ⚠️ 이 API는 한 번 호출에 **최대 100건**만 돌려주고, 그 100건은 요청 구간의 **최근** 100거래일이다.
//    옛 코드는 2년(≈490거래일) 구간을 한 번만 불러 구간마다 앞쪽 ~390거래일을 조용히 버렸는데도 응답에는
//    partial:false가 찍혔다. 클라이언트는 그 빈 날짜를 네이버 fchart(수정종가 — 이후 분배금·권리락을 소급
//    반영해 과거를 낮춘 가격)로 채웠고, 한 종목 안에 두 가격 기준이 섞여 차트에 인공 급등이 생겼다.
//    실측(2026-10-16): 480040 2026-05-14 실제 종가 19,245원인데 차트는 수정종가 16,509원(×0.8578).
//    KIS 2026 구간 응답은 05-20~10-16의 100건뿐이었고, 005930은 21-12-30→23-08-02·23-12-28→25-08-04가 비어 있었다.
// 해결: 받은 건수가 상한(100)이면 '가장 이른 날짜의 하루 전'을 새 구간 끝으로 다시 부른다(구간 시작까지).
//
// ⚠️ import 0건 · process.env 미사용 · enum/namespace 금지 — scripts/verify-boot.mjs가 Node 타입 스트리핑으로
//    직접 import해 가짜 fetch로 페이지 넘김을 검증한다(키는 호출부가 넘긴다).

export const KIS_DAILY_PAGE_CAP = 100;   // 실측 상한 — 이 건수를 받았으면 구간 앞쪽이 더 있다
export const KIS_DAILY_MAX_PAGES = 12;   // 2년 구간 ≈ 5페이지. 응답이 구간 끝을 무시하는 이상 상황의 무한 루프 방지

const isYmd = (s: string) => /^\d{8}$/.test(s);

// YYYYMMDD의 하루 전(UTC 달력 산술 — 실행 환경 타임존 무관).
export const prevYmd = (ymd: string): string => {
  const t = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) - 1));
  return t.toISOString().slice(0, 10).replace(/-/g, '');
};

export interface KisDailyRangeOpts {
  code: string;
  token: string;
  appKey: string;
  appSecret: string;
  dateFrom: string;          // YYYYMMDD (포함)
  dateTo: string;            // YYYYMMDD (포함)
  base?: string;
  timeoutMs?: number;        // 호출 1건 최대 대기
  deadlineAt?: number;       // epoch ms — 넘기면 다음 페이지를 부르지 않고 truncated로 반환
  maxPages?: number;
  retryDelaysMs?: number[];  // 실패 시 재시도 간격(rate limit EGW00201 회복용)
  fetchImpl?: typeof fetch;  // 검증용 주입 — 미지정이면 전역 fetch
}

export interface KisDailyRangeResult {
  data: Record<string, number>;  // YYYY-MM-DD → 실제 종가
  ok: boolean;                   // 실패한 호출 없이 끝났다(false면 구간 중간·앞쪽에 구멍이 있을 수 있다)
  truncated: boolean;            // 시한·페이지 상한 때문에 구간 시작까지 가지 못했다
  pages: number;                 // 성공한 호출 수
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchPage(o: KisDailyRangeOpts, dateFrom: string, dateTo: string): Promise<any[] | null> {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD:         o.code,
    FID_INPUT_DATE_1:       dateFrom,
    FID_INPUT_DATE_2:       dateTo,
    FID_PERIOD_DIV_CODE:    'D',
    FID_ORG_ADJ_PRC:        '1',   // 원주가(실제 종가, 수정주가 미반영)
  });
  const f = o.fetchImpl || fetch;
  try {
    const res = await f(
      `${o.base || 'https://openapi.koreainvestment.com:9443'}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${params}`,
      {
        headers: {
          'Content-Type':  'application/json',
          'authorization': `Bearer ${o.token}`,
          'appkey':        o.appKey,
          'appsecret':     o.appSecret,
          'tr_id':         'FHKST03010100',
          'custtype':      'P',
        },
        signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
      }
    );
    if (!res.ok) {
      console.error(`[kis-daily] ${o.code} ${dateFrom}-${dateTo} status=${res.status}`);
      return null;
    }
    const json: any = await res.json();
    if (json?.rt_cd && json.rt_cd !== '0') {
      console.error(`[kis-daily] ${o.code} ${dateFrom}-${dateTo} rt_cd=${json.rt_cd} msg=${json.msg1}`);
      return null;
    }
    return Array.isArray(json?.output2) ? json.output2 : [];
  } catch (e) {
    console.error(`[kis-daily] ${o.code} ${dateFrom}-${dateTo} error: ${e}`);
    return null;
  }
}

async function fetchPageWithRetry(o: KisDailyRangeOpts, dateFrom: string, dateTo: string): Promise<any[] | null> {
  const delays = o.retryDelaysMs ?? [300, 800];
  for (let attempt = 0; ; attempt++) {
    const rows = await fetchPage(o, dateFrom, dateTo);
    if (rows !== null) return rows;
    if (attempt >= delays.length) return null;
    if (o.deadlineAt && Date.now() + delays[attempt] > o.deadlineAt) return null;
    await sleep(delays[attempt]);
  }
}

/**
 * [dateFrom, dateTo] 구간의 실제 종가를 **전부** 받는다. 절대 throw하지 않는다.
 * 상한(100건)을 받았으면 가장 이른 날짜의 하루 전을 새 끝으로 다시 부른다.
 * ⚠️ 상한 판정은 '날짜가 있는 행 수'로 한다 — 종가 0(거래정지) 행을 빼고 세면 꽉 찬 페이지를
 *    마지막 페이지로 오판해 그 앞을 통째로 놓친다.
 */
export async function fetchKisDailyRange(o: KisDailyRangeOpts): Promise<KisDailyRangeResult> {
  const data: Record<string, number> = {};
  const maxPages = o.maxPages ?? KIS_DAILY_MAX_PAGES;
  let pages = 0;
  let to = o.dateTo;
  if (!isYmd(o.dateFrom) || !isYmd(to) || to < o.dateFrom) return { data, ok: true, truncated: false, pages };
  for (;;) {
    if (o.deadlineAt && Date.now() > o.deadlineAt) return { data, ok: true, truncated: true, pages };
    const rows = await fetchPageWithRetry(o, o.dateFrom, to);
    if (rows === null) return { data, ok: false, truncated: false, pages };
    pages++;
    let earliest = '';
    let dated = 0;
    for (const item of rows) {
      const d = String(item?.stck_bsop_date ?? '');
      if (!isYmd(d)) continue;
      dated++;
      if (!earliest || d < earliest) earliest = d;
      const close = parseInt(String(item?.stck_clpr ?? ''), 10);
      if (!isNaN(close) && close > 0) data[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = close;
    }
    if (dated < KIS_DAILY_PAGE_CAP) return { data, ok: true, truncated: false, pages };   // 구간 시작까지 다 받았다
    const next = prevYmd(earliest);
    if (next < o.dateFrom) return { data, ok: true, truncated: false, pages };
    // 진전이 없으면(응답이 구간 끝을 무시) 같은 요청을 반복하지 않고 멈춘다.
    if (next >= to || pages >= maxPages) return { data, ok: true, truncated: true, pages };
    to = next;
  }
}
