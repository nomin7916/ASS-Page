// Vercel Edge Function — 한국 ETF 일별 과표기준가 조회 (FunETF)
// 입력: code (KRX 종목코드, 예: 0190G0, 498400, 490590)
// 반환: { code, isin, fundCd, items: [{ gijunYmd, taxFp, fp, clsp }] }
export const config = { runtime: 'edge' };

const FUNETF_ORIGIN = 'https://www.funetf.co.kr';

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
};

// 메모리 캐시: ticker → { fundCd, ts }
const _fundCdCache = new Map<string, { fundCd: string; ts: number }>();
const FUND_CD_TTL = 24 * 60 * 60 * 1000; // 24시간

// ─── ISO 6166 ISIN 체크디짓 계산 (Luhn 알고리즘) ───────────────────────────
// KRX 종목코드 → ISIN 변환: KR7 + {ticker} + {checkDigit}
function calcIsinCheckDigit(base: string): string {
  const digits: number[] = [];
  for (const c of base.toUpperCase()) {
    if (c >= '0' && c <= '9') {
      digits.push(parseInt(c, 10));
    } else if (c >= 'A' && c <= 'Z') {
      const v = c.charCodeAt(0) - 65 + 10; // A=10 … Z=35
      digits.push(Math.floor(v / 10), v % 10);
    }
  }
  digits.push(0); // 체크디짓 자리 placeholder (pos 1 from right)

  let sum = 0;
  const len = digits.length;
  for (let i = len - 1; i >= 0; i--) {
    const pos = len - i; // 1-indexed from right
    let d = digits[i];
    if (pos % 2 === 0) { // 짝수 위치 → 두배
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

function tickerToIsin(ticker: string): string {
  const base = 'KR7' + ticker.toUpperCase();
  return base + calcIsinCheckDigit(base);
}

// ─── FunETF 상품 페이지 → fundCd 추출 ──────────────────────────────────────
async function fetchFundCd(isin: string): Promise<string | null> {
  try {
    const res = await fetch(`${FUNETF_ORIGIN}/product/etf/view/${isin}`, {
      headers: {
        ...BASE_HEADERS,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': FUNETF_ORIGIN + '/',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // <input type="hidden" name="fundCd" ... value="K55105EU6183">
    const m = html.match(/name="fundCd"[^>]*value="([^"]+)"/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

// ─── FunETF etfnav API → 일별 taxFp 배열 ───────────────────────────────────
async function fetchEtfNav(
  isin: string,
  fundCd: string,
  todayYmd: string,
): Promise<Array<{ gijunYmd: string; taxFp: number | null; fp: number | null; clsp: number | null }> | null> {
  const params = new URLSearchParams({
    itemId: isin,
    fundCd,
    repFundCd: fundCd,
    schNavTerm: 'A',   // 전체 이력
    schNavMode: 'T',
    gijunYmd: todayYmd,
  });
  try {
    const res = await fetch(
      `${FUNETF_ORIGIN}/api/public/product/view/etfnav?${params}`,
      {
        headers: {
          ...BASE_HEADERS,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Referer': `${FUNETF_ORIGIN}/product/etf/view/${isin}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data
      .map((d: any) => ({
        gijunYmd: String(d.gijunYmd ?? ''),
        taxFp: d.taxFp != null ? Number(d.taxFp) : null,
        fp:    d.fp    != null ? Number(d.fp)    : null,
        clsp:  d.clsp  != null ? Number(d.clsp)  : null,
      }))
      .filter(d => /^\d{8}$/.test(d.gijunYmd))
      .sort((a, b) => a.gijunYmd.localeCompare(b.gijunYmd)); // 오래된 날짜 → 최신
  } catch {
    return null;
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────
export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get('code') ?? '').trim().toUpperCase();

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  // 5~6자리 한국 ETF 코드 (숫자+알파벳 혼합)
  if (!code || !/^[A-Z0-9]{5,6}$/.test(code)) {
    return new Response(
      JSON.stringify({ error: 'code 파라미터가 올바르지 않습니다. 예: 0190G0, 498400' }),
      { status: 400, headers },
    );
  }

  const isin = tickerToIsin(code);

  // 오늘 날짜 YYYYMMDD
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayYmd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

  // fundCd 캐시 확인 → TTL 초과 또는 없으면 FunETF 페이지 조회
  const cached = _fundCdCache.get(code);
  let fundCd: string | null =
    cached && Date.now() - cached.ts < FUND_CD_TTL ? cached.fundCd : null;

  if (!fundCd) {
    fundCd = await fetchFundCd(isin);
    if (fundCd) _fundCdCache.set(code, { fundCd, ts: Date.now() });
  }

  if (!fundCd) {
    return new Response(
      JSON.stringify({ error: 'FunETF에서 종목 정보를 찾을 수 없습니다.', isin }),
      { status: 404, headers },
    );
  }

  const items = await fetchEtfNav(isin, fundCd, todayYmd);

  if (!items) {
    return new Response(
      JSON.stringify({ error: '과표기준가 데이터 조회 실패', isin, fundCd }),
      { status: 502, headers },
    );
  }

  return new Response(
    JSON.stringify({ code, isin, fundCd, count: items.length, items }),
    { headers },
  );
}
