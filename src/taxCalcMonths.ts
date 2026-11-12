// 평균 과표 계산기 표의 '월별 접기' 묶음. `verify:tax-months`가 직접 import한다.
// ⚠️ 이 파일에는 import를 두지 말 것 — Node가 타입만 벗겨 그대로 실행한다.
//
// 규칙(사용자 요청 2026-11-12): 입력이 끝난 지난 달 행은 지우지 않고(기록 보관) 월별로 접어 둔다.
//  - 이번 달·앞으로의 달은 펼침, 지난 달은 접힘이 기본. 머리 줄을 눌러 펼치고 접는다(세션 동안만 기억).
//  - 일자가 없는 행은 순서를 알 수 없어 맨 뒤 '일자 미입력' 묶음 — 늘 펼침(입력할 행이 숨으면 안 된다).
//  - 접어도 계산은 그대로다 — 러닝 평균·실현손익은 전 행으로 계산하고 화면에서만 숨긴다.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// krEtfTaxHelpers.safeNum과 같은 해석(쉼표 허용) — 계산기 표가 쓰는 수량 해석과 갈리면 머리 줄 합이 행과 어긋난다.
const num = (v: unknown): number => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function taxRowMonth(date: unknown): string {
  const s = String(date || '');
  return ISO.test(s) ? s.slice(0, 7) : '';
}

export type TaxMonthGroup<R> = { ym: string; past: boolean; rows: R[] };

// rows는 계산기 정렬 순서(일자 오름차순, 일자 없는 행은 맨 뒤) 그대로 받는다 — 순서를 바꾸지 않고 이웃한 같은 달끼리 묶는다.
export function groupTaxRowsByMonth<R>(rows: R[], currentYm: string, dateOf: (r: R) => unknown): TaxMonthGroup<R>[] {
  const groups: TaxMonthGroup<R>[] = [];
  for (const r of rows || []) {
    const ym = taxRowMonth(dateOf(r));
    const last = groups[groups.length - 1];
    if (last && last.ym === ym) last.rows.push(r);
    else groups.push({ ym, past: !!ym && !!currentYm && ym < currentYm, rows: [r] });
  }
  return groups;
}

// 펼침 여부 — 사용자가 누른 값(override)이 있으면 그 값, 없으면 지난 달만 접힘. 일자 미입력 묶음은 늘 펼침.
export function taxMonthOpen(group: { ym: string; past: boolean }, override?: boolean): boolean {
  if (!group?.ym) return true;
  return typeof override === 'boolean' ? override : !group.past;
}

// 머리 줄을 그릴지 — 묶음이 둘 이상이거나 지난 달이 있을 때만(이번 달 행만 있으면 머리 줄은 군더더기).
export function showTaxMonthHeads(groups: { ym: string; past: boolean }[]): boolean {
  return (groups || []).length > 1 || (groups || []).some(g => g.past);
}

export function taxMonthLabel(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return '일자 미입력';
  return `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
}

// 머리 줄 요약 — 매수·매도 수량, 그 달 마지막 행의 누적 보유·평균 과표, 그 달 실현손익 합.
export function taxMonthSummary(rows: Array<{ evt?: any; runningQty?: number; runningAvg?: number; realized?: { profit?: number | null } }>) {
  let buyQty = 0, sellQty = 0, realized = 0, realizedCount = 0;
  for (const r of rows || []) {
    const c = num(r?.evt?.change);
    if (c > 0) buyQty += c;
    else if (c < 0) sellQty += -c;
    const p = r?.realized?.profit;
    if (typeof p === 'number' && Number.isFinite(p)) { realized += p; realizedCount++; }
  }
  const last = (rows || [])[(rows || []).length - 1];
  return {
    count: (rows || []).length,
    buyQty,
    sellQty,
    endQty: Number(last?.runningQty) || 0,
    endAvg: Number(last?.runningAvg) || 0,
    realized,
    realizedCount,
  };
}
