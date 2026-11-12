// 공시된 분배금의 예상 수량 = 공시일(배당락 전 영업일) 장 마감 보유 수량. `verify:dividend-qty`가 직접 import한다.
// ⚠️ 이 파일에는 import를 두지 말 것(dividendYear.ts와 같은 규약) — Node가 타입만 벗겨 그대로 실행한다.
//
// 규칙(사용자 확정 2026-11-12):
//  - 월중 ETF는 15일이 지급 기준일이다 — 1영업일 전 배당락, 2영업일 전 공시. 15일이 주말·휴일이면 그 전 영업일이
//    기준일이 되고 배당락·공시도 함께 당겨진다(2026-11: 15일 일요일 → 기준일 13일 → 배당락 12일 → 공시 11일).
//  - 분배금은 배당락 전날(= 공시일) 장 마감까지 보유한 수량에 붙는다 → 공시된 분배금(배당락일·주당분배금이 둘 다
//    공시값)은 그날 보유 수량으로 계산한다. 배당락일은 네이버 공시값이라 휴일 당김이 이미 들어 있다.
//  - 공시일이 오늘이거나 그 뒤면(아직 사고팔 수 있다) 지금 수량. 예측(~) 분배금도 지금 수량.
//  - 그날 보유를 모르면(자산검증 기록 없음 = null) 지금 수량 — 모르는 값을 0주로 단언하지 않는다.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function isBusinessDay(dateStr: string, holidays: string[] = []): boolean {
  if (!ISO.test(String(dateStr || ''))) return false;
  const w = new Date(dateStr + 'T12:00:00').getDay();
  return w !== 0 && w !== 6 && !(holidays || []).includes(dateStr);
}

export function prevBusinessDay(dateStr: string, holidays: string[] = []): string {
  if (!ISO.test(String(dateStr || ''))) return '';
  const set = new Set(holidays || []);
  const d = new Date(dateStr + 'T12:00:00');
  for (let guard = 0; guard < 31; guard++) {
    d.setDate(d.getDate() - 1);
    const ds = ymd(d);
    if (d.getDay() !== 0 && d.getDay() !== 6 && !set.has(ds)) return ds;
  }
  return '';
}

// 월중 ETF 일정(15일 기준). ym = 'YYYY-MM'. 공시값 배당락일이 이 규칙과 같은지 검증하는 데 쓴다.
export function midMonthSchedule(ym: string, holidays: string[] = []): { recordDate: string; exDate: string; announceDate: string } | null {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return null;
  const d15 = `${ym}-15`;
  const recordDate = isBusinessDay(d15, holidays) ? d15 : prevBusinessDay(d15, holidays);
  const exDate = prevBusinessDay(recordDate, holidays);
  return { recordDate, exDate, announceDate: prevBusinessDay(exDate, holidays) };
}

export type DividendQty = { qty: number; source: 'record' | 'current'; qtyDate: string };

// 분배금 한 건의 계산 수량.
//  exDate     배당락일(YYYY-MM-DD)          announced  배당락일·주당분배금이 둘 다 공시값인가(예측 아님)
//  today      오늘(KST, YYYY-MM-DD)         holidays   그 시장 휴장일
//  currentQty 지금 보유 수량                holdingAt  (date) => 그날 장 마감 보유 수량 | null(모름)
export function dividendRecordQty(o: {
  exDate: string; announced: boolean; today: string; holidays?: string[];
  currentQty: number; holdingAt?: (date: string) => number | null;
}): DividendQty {
  const cur = Number(o?.currentQty) || 0;
  if (!o?.announced || !ISO.test(String(o?.exDate || ''))) return { qty: cur, source: 'current', qtyDate: '' };
  const qtyDate = prevBusinessDay(o.exDate, o.holidays || []);
  if (!qtyDate || !ISO.test(String(o?.today || '')) || !(qtyDate < o.today)) return { qty: cur, source: 'current', qtyDate };
  const h = typeof o.holdingAt === 'function' ? o.holdingAt(qtyDate) : null;
  if (h == null || !Number.isFinite(Number(h))) return { qty: cur, source: 'current', qtyDate };
  return { qty: Math.max(0, Number(h)), source: 'record', qtyDate };
}
