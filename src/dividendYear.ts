// 분배금 현황 '연도 보기'의 순수 로직. `verify:dividend`가 미러 없이 **직접 import**한다.
// ⚠️ 이 파일에는 import를 두지 말 것(watchlistChart.ts와 같은 규약) — Node가 타입만 벗겨 그대로 실행한다.
//
// 규칙(사용자 확정 2026-10-31):
//  - 제목 위에는 올해(금년도)를 적고, 제목 아래에는 지난 연도 버튼을 둔다.
//  - 지난 연도 버튼은 분배금 기록을 시작한 해(DIVIDEND_YEAR_START)부터 '작년'까지 — 2027년이 되면
//    2026년 버튼 하나, 2028년이 되면 2026·2027년 두 개.
//  - 버튼은 최근 5년치만 왼쪽→오른쪽 오름차순으로 보이고, 그보다 오래된 해는 드롭다운(최신순)으로 접는다.

export const DIVIDEND_YEAR_START = 2026;
export const DIVIDEND_YEAR_CHIPS = 5;

export function dividendPastYears(currentYear: number, startYear: number = DIVIDEND_YEAR_START): number[] {
  const out: number[] = [];
  const cy = Math.floor(Number(currentYear));
  const sy = Math.floor(Number(startYear));
  if (!Number.isFinite(cy) || !Number.isFinite(sy)) return out;
  for (let y = sy; y < cy; y++) out.push(y);
  return out;
}

export function dividendYearChoices(
  currentYear: number,
  startYear: number = DIVIDEND_YEAR_START,
  maxChips: number = DIVIDEND_YEAR_CHIPS,
): { chips: number[]; older: number[] } {
  const past = dividendPastYears(currentYear, startYear);
  const n = Math.max(0, Math.floor(maxChips));
  const cut = Math.max(0, past.length - n);
  return { chips: past.slice(cut), older: past.slice(0, cut).reverse() };
}

// 선택한 연도가 아직 볼 수 있는 지난 연도인지 — 해가 바뀌어도 선택이 남아 있으면 그 해를 그대로 보고,
// 범위 밖(올해 이후·시작 해 이전)이면 올해로 돌아간다.
export function resolveDividendViewYear(
  selected: number | null | undefined,
  currentYear: number,
  startYear: number = DIVIDEND_YEAR_START,
): number {
  const y = Number(selected);
  if (selected == null || !Number.isFinite(y)) return currentYear;
  return (y >= startYear && y < currentYear) ? y : currentYear;
}
