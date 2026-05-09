// Vercel Edge Function — 종목 PER/선행PER 서버사이드 조회
// 클라이언트에서 CORS/401로 실패하는 Yahoo Finance, Naver API를 서버에서 직접 호출
export const config = { runtime: 'edge' };

const parseNum = (v: any): number | null => {
  if (v == null || v === '' || v === '-') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
};

const toValidPer = (v: any): number | null => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : Number(v);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Referer': 'https://m.stock.naver.com/',
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function koreanPer(code: string): Promise<{ per: number | null; fper: number | null } | null> {
  let closePrice: number | null = null;

  try {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
      headers: NAVER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const d = await res.json();
      if (d?.closePrice) {
        closePrice = parseNum(String(d.closePrice).replace(/,/g, ''));
        if (d.stockEndType === 'etf') return null;
      }
    }
  } catch {}

  if (!closePrice) return null;

  try {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/finance/annual`, {
      headers: NAVER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const d = await res.json();

      // 신규 API 구조: financeInfo.trTitleList + financeInfo.rowList (W 접미사 없음)
      const fi = d?.financeInfo;
      if (fi?.trTitleList && fi?.rowList) {
        const titles = fi.trTitleList as any[];
        const rows = fi.rowList as any[];
        const epsRow = rows.find((r: any) => String(r.title).replace(/\s/g, '') === 'EPS');
        if (epsRow?.columns) {
          const actual = titles.filter((t: any) => t.isConsensus !== 'Y');
          const consensus = titles.filter((t: any) => t.isConsensus === 'Y');
          const lastActual = actual[actual.length - 1];
          const firstConsensus = consensus[0];
          const lastActualEps = lastActual
            ? parseNum(String(epsRow.columns[lastActual.key]?.value ?? '').replace(/,/g, ''))
            : null;
          const firstConsensusEps = firstConsensus
            ? parseNum(String(epsRow.columns[firstConsensus.key]?.value ?? '').replace(/,/g, ''))
            : null;
          const per = lastActualEps && lastActualEps > 0
            ? Math.round((closePrice / lastActualEps) * 100) / 100
            : null;
          const fper = firstConsensusEps && firstConsensusEps > 0
            ? Math.round((closePrice / firstConsensusEps) * 100) / 100
            : null;
          if (per !== null || fper !== null) return { per, fper };
        }
      }

      // 구버전 API 구조 fallback: chartEps.columns + chartEps.trTitleList
      const epsRow = (d?.chartEps?.columns as any[])?.find((c: any[]) => c[0] === 'EPS');
      const titlesOld = d?.chartEps?.trTitleList as any[];
      if (epsRow && titlesOld) {
        const years = titlesOld
          .map((t: any, i: number) => ({ consensus: t.isConsensus === 'Y', eps: parseNum(epsRow[i + 1]) }))
          .filter((y: any) => y.eps !== null);
        const actual = years.filter((y: any) => !y.consensus);
        const consensus = years.filter((y: any) => y.consensus);
        const lastActual = actual[actual.length - 1];
        const per = lastActual?.eps && lastActual.eps > 0
          ? Math.round((closePrice / lastActual.eps) * 100) / 100
          : null;
        const fper = consensus[0]?.eps && consensus[0].eps > 0
          ? Math.round((closePrice / consensus[0].eps) * 100) / 100
          : null;
        if (per !== null || fper !== null) return { per, fper };
      }
    }
  } catch {}

  return null;
}

async function usPer(ticker: string): Promise<{ per: number | null; fper: number | null } | null> {
  // v10 quoteSummary → trailingPE + forwardPE
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryDetail`,
      { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const d = await res.json();
      const detail = d?.quoteSummary?.result?.[0]?.summaryDetail;
      if (detail) {
        const per = toValidPer(detail.trailingPE?.raw);
        const fper = toValidPer(detail.forwardPE?.raw);
        if (per !== null || fper !== null) return { per, fper };
      }
    }
  } catch {}

  // v7 quote fallback
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`,
      { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const d = await res.json();
      const q = d?.quoteResponse?.result?.[0];
      if (q) {
        const per = toValidPer(q.trailingPE);
        const fper = toValidPer(q.forwardPE);
        if (per !== null || fper !== null) return { per, fper };
      }
    }
  } catch {}

  return null;
}

async function debugKoreanRaw(code: string): Promise<object> {
  const out: Record<string, any> = {};
  try {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
      headers: NAVER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    out.basic_status = res.status;
    if (res.ok) {
      const d = await res.json();
      out.basic_keys = Object.keys(d);
      out.basic_closePrice = d.closePrice;
      out.basic_per = d.per;
      out.basic_perValue = d.perValue;
      out.basic_PER = d.PER;
      out.basic_stockEndType = d.stockEndType;
      out.basic_sample = JSON.stringify(d).slice(0, 500);
    } else {
      out.basic_text = await res.text().catch(() => '');
    }
  } catch (e) {
    out.basic_error = String(e);
  }
  try {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/finance/annual`, {
      headers: NAVER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    out.annual_status = res.status;
    if (res.ok) {
      const d = await res.json();
      out.annual_keys = Object.keys(d);
      const fi = d?.financeInfo;
      out.fi_keys = fi ? Object.keys(fi) : null;
      // rowListW 키를 동적으로 탐색
      const rowListKey = fi ? Object.keys(fi).find(k => k.startsWith('rowList')) : null;
      out.detected_rowListKey = rowListKey;
      const rows = rowListKey ? fi[rowListKey] : null;
      if (rows?.length > 0) {
        const firstRow = rows[0];
        out.first_row_keys = Object.keys(firstRow);
        const titleKey = Object.keys(firstRow).find(k => k.startsWith('title'));
        const colKey = Object.keys(firstRow).find(k => k.startsWith('col'));
        out.detected_titleKey = titleKey;
        out.detected_colKey = colKey;
        out.annual_row_titles = rows.map((r: any) => titleKey ? r[titleKey] : null);
        const titlesKey = Object.keys(fi).find(k => k.startsWith('trTitle'));
        const titles = titlesKey ? fi[titlesKey] : null;
        out.titles_sample = titles?.slice(0, 4);
        const epsRow = rows.find((r: any) =>
          titleKey && String(r[titleKey]).replace(/\s/g, '') === 'EPS'
        );
        if (epsRow && colKey) {
          out.eps_row_title = epsRow[titleKey!];
          out.eps_columns = epsRow[colKey];
        } else {
          out.eps_row = 'NOT FOUND';
        }
      } else {
        out.annual_sample = JSON.stringify(d).slice(0, 800);
      }
    }
  } catch (e) {
    out.annual_error = String(e);
  }
  return out;
}

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get('code') ?? '').trim().toUpperCase();
  const ticker = (searchParams.get('ticker') ?? '').trim().toUpperCase();
  const debug = searchParams.get('debug') === '1';

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  if (debug && code && /^[A-Z0-9]{6}$/.test(code)) {
    const raw = await debugKoreanRaw(code);
    return new Response(JSON.stringify(raw, null, 2), { headers });
  }

  let result: { per: number | null; fper: number | null } | null = null;

  if (code && /^[A-Z0-9]{6}$/.test(code)) {
    result = await koreanPer(code);
  } else if (ticker && /^[A-Z]{1,6}$/.test(ticker)) {
    result = await usPer(ticker);
  }

  return new Response(JSON.stringify(result ?? { per: null, fper: null }), { headers });
}
