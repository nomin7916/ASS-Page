// @ts-nocheck
import { useState, useEffect } from 'react';

const CACHE_KEY = 'marketCalendarCache_v1';
const CACHE_DAYS = 7;

// NYSE는 Columbus Day, Veterans Day 쉬지 않음
const NYSE_EXCLUDED = ['Columbus Day', 'Veterans Day'];

// 부활절 계산 (Meeus/Jones/Butcher 알고리즘)
function calcEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getGoodFriday(year: number): string {
  const easter = calcEaster(year);
  const gf = new Date(easter);
  gf.setDate(gf.getDate() - 2);
  return gf.toISOString().split('T')[0];
}

// 시스템 시간대와 무관하게 KST(UTC+9) 기준 현재 시각 반환
export function getNowKST(): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 9 * 3600000);
}

export function formatDateKST(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// KST 기준 오늘 날짜 문자열 (YYYY-MM-DD)
export function getTodayKST(): string {
  return formatDateKST(getNowKST());
}

// NYSE 유효 거래일 계산:
// 미국 NYSE 마감 16:00 EST = KST 익일 06:00 (겨울) / 05:00 (여름)
// → KST 07:00 미만이면 전일을 미국 유효 거래일로 사용
export function getEffectiveUSDate(): string {
  const nowKST = getNowKST();
  if (nowKST.getHours() < 7) {
    const prev = new Date(nowKST);
    prev.setDate(prev.getDate() - 1);
    return formatDateKST(prev);
  }
  return formatDateKST(nowKST);
}

async function fetchHolidaysForYear(year: number): Promise<{ kr: string[]; us: string[] }> {
  const [krRes, usRes] = await Promise.all([
    fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`),
    fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/US`),
  ]);
  if (!krRes.ok || !usRes.ok) throw new Error('fetch failed');
  const krData = await krRes.json();
  const usData = await usRes.json();

  const kr: string[] = krData.map((h: any) => h.date);

  // NYSE: 연방공휴일 중 거래소 미휴장 제외, Good Friday 추가
  const us: string[] = usData
    .filter((h: any) => !NYSE_EXCLUDED.includes(h.name))
    .map((h: any) => h.date);
  const gf = getGoodFriday(year);
  if (!us.includes(gf)) us.push(gf);

  return { kr, us };
}

export function useMarketCalendar() {
  const [holidays, setHolidays] = useState<{ kr: string[]; us: string[] }>({ kr: [], us: [] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      // 캐시 확인
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          const ageMs = Date.now() - (cached.fetchedAt || 0);
          if (ageMs < CACHE_DAYS * 86400000 && cached.kr?.length && cached.us?.length) {
            setHolidays({ kr: cached.kr, us: cached.us });
            setLoaded(true);
            return;
          }
        }
      } catch {}

      // API 호출: 현재 연도 + 다음 연도 (11월부터 미리 로드)
      try {
        const nowKST = getNowKST();
        const year = nowKST.getFullYear();
        const [curr, next] = await Promise.all([
          fetchHolidaysForYear(year),
          fetchHolidaysForYear(year + 1),
        ]);
        const merged = {
          kr: [...curr.kr, ...next.kr],
          us: [...curr.us, ...next.us],
          fetchedAt: Date.now(),
        };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(merged)); } catch {}
        setHolidays({ kr: merged.kr, us: merged.us });
      } catch {
        // nager.at 실패 시 연도 고정 공휴일 최소 fallback 적용
        const nowKST = getNowKST();
        const y = nowKST.getFullYear();
        const fixedKR = [y, y + 1].flatMap(yr => [
          `${yr}-01-01`, `${yr}-03-01`, `${yr}-05-05`,
          `${yr}-06-06`, `${yr}-08-15`, `${yr}-10-03`,
          `${yr}-10-09`, `${yr}-12-25`,
        ]);
        const fixedUS = [y, y + 1].flatMap(yr => [
          `${yr}-01-01`, `${yr}-07-04`, `${yr}-12-25`,
          getGoodFriday(yr),
        ]);
        setHolidays({ kr: fixedKR, us: fixedUS });
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  // KRX 개장 여부: KST 날짜 기준
  const isKRXOpen = (dateStr: string): boolean => {
    const d = new Date(dateStr + 'T12:00:00');
    if (d.getDay() === 0 || d.getDay() === 6) return false;
    return !holidays.kr.includes(dateStr);
  };

  // NYSE 개장 여부: KST 07:00 기준 미국 유효 거래일 계산
  const isNYSEOpen = (): boolean => {
    const dateStr = getEffectiveUSDate();
    const d = new Date(dateStr + 'T12:00:00');
    if (d.getDay() === 0 || d.getDay() === 6) return false;
    return !holidays.us.includes(dateStr);
  };

  // 계좌 유형별 개장 여부:
  // overseas → NYSE, 그 외 → KRX
  const isMarketOpen = (accountType: string): boolean => {
    const today = getTodayKST();
    if (accountType === 'overseas') return isNYSEOpen();
    return isKRXOpen(today);
  };

  return { isMarketOpen, isKRXOpen, isNYSEOpen, holidays, loaded };
}
