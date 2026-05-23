// Vercel Edge Function — 증시 휴장일(KRX/NYSE) 통합 조회
// 우선순위: 큐레이션 스냅샷(2026~2031, 검증·보정 완료) > nager.at 라이브(범위 밖 연도)
// 항상 적용되는 규칙: KRX 연말 휴장(12/31), NYSE Good Friday, 미휴장 항목 제외, ADHOC 병합.
//
// 응답: { kr: string[], us: string[], yearRange: [start,end], source: 'curated'|'mixed'|'nager'|'fallback' }
import {
  CURATED_KR, CURATED_US, KRX_ADHOC, NYSE_ADHOC,
  CURATED_YEAR_MIN, CURATED_YEAR_MAX,
} from './_marketCalendarData.js';

export const config = { runtime: 'edge' };

// NYSE 미휴장 연방공휴일 (이름 기준 제외)
const NYSE_EXCLUDED = ['Columbus Day', "Indigenous Peoples' Day", 'Veterans Day', "Lincoln's Birthday", 'Truman Day'];

// 부활절(Meeus/Jones/Butcher) → Good Friday(부활절 -2일)
function goodFriday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mon = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const gf = new Date(Date.UTC(year, mon - 1, day - 2));
  return gf.toISOString().slice(0, 10);
}

// 토/일이면 다음 평일 반환 (대체공휴일 추정용)
function nextWeekday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const uniqSort = (arr: string[]) => Array.from(new Set(arr)).sort();

async function nagerYear(year: number, cc: 'KR' | 'US'): Promise<{ date: string; name: string; localName: string }[]> {
  const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`nager ${cc} ${year} ${r.status}`);
  return r.json();
}

// 라이브 nager → KRX 휴장일 보정: 제헌절(7/17) 제외 + 부처님오신날 토/일 대체공휴일 보강
function normalizeKR(year: number, raw: { date: string; localName: string }[]): string[] {
  const out: string[] = [];
  for (const h of raw) {
    if (h.date.slice(5) === '07-17') continue; // 제헌절 — 증시 개장
    out.push(h.date);
    if (h.localName && h.localName.includes('부처님')) {
      const d = new Date(h.date + 'T12:00:00Z').getUTCDay();
      if (d === 0 || d === 6) out.push(nextWeekday(h.date));
    }
  }
  out.push(`${year}-12-31`); // KRX 연말 휴장
  return uniqSort(out);
}

// 라이브 nager → NYSE 휴장일 보정: 미휴장 항목 제외 + Good Friday 보강
function normalizeUS(year: number, raw: { date: string; name: string }[]): string[] {
  const out = raw.filter(h => !NYSE_EXCLUDED.includes(h.name)).map(h => h.date);
  const gf = goodFriday(year);
  if (!out.includes(gf)) out.push(gf);
  return uniqSort(out);
}

export default async function handler(request: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
  };

  const url = new URL(request.url);
  const nowYear = new Date().getUTCFullYear();
  const yStart = Number(url.searchParams.get('yearStart')) || nowYear;
  const yEnd = Number(url.searchParams.get('yearEnd')) || nowYear + 5;

  const kr: string[] = [];
  const us: string[] = [];
  let usedCurated = false;
  let usedLive = false;
  let liveFailed = false;

  for (let y = yStart; y <= yEnd; y++) {
    if (y >= CURATED_YEAR_MIN && y <= CURATED_YEAR_MAX) {
      // 큐레이션: 검증·보정 완료. 12/31 만 규칙으로 부여(데이터엔 미포함)
      kr.push(...CURATED_KR[y], `${y}-12-31`);
      us.push(...CURATED_US[y]);
      usedCurated = true;
    } else {
      // 범위 밖 — nager 라이브 + 런타임 보정
      try {
        const [rk, ru] = await Promise.all([nagerYear(y, 'KR'), nagerYear(y, 'US')]);
        kr.push(...normalizeKR(y, rk));
        us.push(...normalizeUS(y, ru));
        usedLive = true;
      } catch {
        liveFailed = true;
        // 최소 폴백: KR 고정공휴일 + 12/31, US 고정연방공휴일 + Good Friday
        kr.push(`${y}-01-01`, `${y}-03-01`, `${y}-05-01`, `${y}-05-05`, `${y}-06-06`, `${y}-08-15`, `${y}-10-03`, `${y}-10-09`, `${y}-12-25`, `${y}-12-31`);
        us.push(`${y}-01-01`, `${y}-07-04`, `${y}-12-25`, goodFriday(y));
      }
    }
  }

  const source = liveFailed ? 'fallback' : usedCurated && usedLive ? 'mixed' : usedCurated ? 'curated' : 'nager';

  return new Response(JSON.stringify({
    kr: uniqSort([...kr, ...KRX_ADHOC]),
    us: uniqSort([...us, ...NYSE_ADHOC]),
    yearRange: [yStart, yEnd],
    source,
  }), { headers });
}
