// @ts-nocheck
import { useState, useEffect } from 'react';

const CACHE_KEY = 'marketCalendarCache_v4';
const CACHE_DAYS = 7;

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

// 총자산 기록 유효 날짜 — 시장별 분리:
// - 글로벌(overseas/crypto/현금성): US 종가는 KST 익일 07:30 확정 (getEffectiveDate)
//   → 07:30 미만이면 전일이 유효 날짜 (전일 종가 기준 기록)
//   → 07:30 이후면 오늘이 유효 날짜 (당일 현재가 기록)
// - 국내시장 계좌(KR_CUTOFF_ACCOUNT_TYPES): 당일 21:00 확정 (getEffectiveDateKR)
export function getEffectiveDate(): string {
  const nowKST = getNowKST();
  const h = nowKST.getHours();
  const m = nowKST.getMinutes();
  if (h < 7 || (h === 7 && m < 30)) {
    const prev = new Date(nowKST);
    prev.setDate(prev.getDate() - 1);
    return formatDateKST(prev);
  }
  return formatDateKST(nowKST);
}

// 07:30 AM KST까지 남은 ms 반환 (이미 지났으면 null)
export function getMsUntilCutoff(): number | null {
  const nowKST = getNowKST();
  const h = nowKST.getHours();
  const m = nowKST.getMinutes();
  if (h > 7 || (h === 7 && m >= 30)) return null;
  const cutoff = new Date(nowKST);
  cutoff.setHours(7, 30, 0, 0);
  return cutoff.getTime() - nowKST.getTime();
}

// 국내시장 계좌(당일 21:00 KST 종가 확정): 그 외(overseas/crypto/matong/simple)는 글로벌 07:30 유지
export const KR_CUTOFF_ACCOUNT_TYPES = new Set(['portfolio', 'isa', 'dc-irp', 'pension', 'dividend', 'gold']);
export const isKrCutoffAccount = (accountType: string): boolean => KR_CUTOFF_ACCOUNT_TYPES.has(accountType);

// KR 계좌 실시간 기록 대상 날짜: 09:00(개장)~21:00 → 오늘 / 그 외 → null(기록 중단)
// - 21:00 이후: 당일 확정·동결
// - 09:00 이전: 전일 종가 이월 placeholder를 만들지 않음 — isFixed:false 실시간 기록은 권위값이라
//   백필이 영구 보호하므로, 전일 값이 당일 날짜에 박제되는 오귀속 방지(당일 기록은 개장 후 라이브
//   또는 21:00 이후 백필이 종가로 생성)
export function getEffectiveDateKR(): string | null {
  const nowKST = getNowKST();
  const h = nowKST.getHours();
  return h >= 9 && h < 21 ? formatDateKST(nowKST) : null;
}

// KR 당일 종가 정산일: 21:00~24:00이면 오늘 날짜, 그 외 null.
// 백필의 '실시간 기록 보호' 예외 대상 — 장중 값으로 동결된 당일 기록을 종가 재계산으로 1회 보정 허용.
export function getKrSettledTodayDate(): string | null {
  const nowKST = getNowKST();
  return nowKST.getHours() >= 21 ? formatDateKST(nowKST) : null;
}

// KR 계좌 백필 상한(exclusive): 21:00 미만 → 오늘(d < 오늘) / 21:00 이후 → 내일(당일 백필 허용)
// 21:00 이후 값(내일)은 "다음 실시간 기록 대상일"과도 일치한다.
export function getBackfillBoundaryKR(): string {
  const nowKST = getNowKST();
  if (nowKST.getHours() < 21) return formatDateKST(nowKST);
  const next = new Date(nowKST);
  next.setDate(next.getDate() + 1);
  return formatDateKST(next);
}

export function getEffectiveDateForAccount(accountType: string): string | null {
  return isKrCutoffAccount(accountType) ? getEffectiveDateKR() : getEffectiveDate();
}

export function getBackfillBoundaryForAccount(accountType: string): string {
  return isKrCutoffAccount(accountType) ? getBackfillBoundaryKR() : getEffectiveDate();
}

// 다음 경계(07:30 글로벌 / 09:00 KR 재개 / 21:00 KR 동결)까지 남은 ms — 항상 양수, 재무장(re-arm) 타이머용
// 자정에는 두 날짜 모두 값이 바뀌지 않으므로(글로벌은 전일 유지, KR은 null 유지) 경계 불필요.
export function getMsUntilNextBoundary(): number {
  const nowKST = getNowKST();
  const mins = nowKST.getHours() * 60 + nowKST.getMinutes();
  const target = new Date(nowKST);
  if (mins < 450) {
    target.setHours(7, 30, 0, 0);
  } else if (mins < 540) {
    target.setHours(9, 0, 0, 0);
  } else if (mins < 1260) {
    target.setHours(21, 0, 0, 0);
  } else {
    target.setDate(target.getDate() + 1);
    target.setHours(7, 30, 0, 0);
  }
  return Math.max(1000, target.getTime() - nowKST.getTime());
}

// 휴장일은 /api/market-calendar 서버리스 함수에서 통합 산출한다.
// (큐레이션 스냅샷 2026~2031 + 범위 밖 nager 라이브 + 12/31·Good Friday 규칙 보정)
// 클라이언트는 단일 호출로 직전연도~+5년치를 받는다.
// 직전연도 포함 이유: 직전연도 12월 말 배당락(예: 12/29)의 지급일(T+2)이
// 직전연도 KRX 연말 휴장(12/31)을 건너뛰어 올해 1월로 넘어가므로,
// 분배금 지급월 재배치에 직전연도 연말 휴장일이 필요하다.
async function fetchMarketCalendar(): Promise<{ kr: string[]; us: string[] }> {
  const year = getNowKST().getFullYear();
  const r = await fetch(`/api/market-calendar?yearStart=${year - 1}&yearEnd=${year + 5}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('market-calendar failed');
  const data = await r.json();
  if (!data?.kr?.length || !data?.us?.length) throw new Error('market-calendar empty');
  return { kr: data.kr, us: data.us };
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

      // /api/market-calendar 단일 호출 (현재연도~+5년치)
      try {
        const { kr, us } = await fetchMarketCalendar();
        const merged = { kr, us, fetchedAt: Date.now() };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(merged)); } catch {}
        setHolidays({ kr, us });
      } catch {
        // /api 자체 도달 불가 시 최후 폴백: 직전연도~+5년 고정 공휴일(음력 명절 제외).
        // 동일 오리진 /api 이므로 이 경로는 사실상 앱 자체 미가용 상황에서만 발생.
        const y = getNowKST().getFullYear();
        const yrs = Array.from({ length: 7 }, (_, i) => y - 1 + i);
        const fixedKR = yrs.flatMap(yr => [
          `${yr}-01-01`, `${yr}-03-01`, `${yr}-05-01`, `${yr}-05-05`,
          `${yr}-06-06`, `${yr}-08-15`, `${yr}-10-03`,
          `${yr}-10-09`, `${yr}-12-25`, `${yr}-12-31`,
        ]);
        const fixedUS = yrs.flatMap(yr => [
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
