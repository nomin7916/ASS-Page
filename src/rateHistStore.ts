// 금리 모니터링 — 지표 과거 기록의 Drive 저장 형식(10-A, 2026-10). 순수 함수만.
// ⚠️ import 0건 · React 금지 · enum 금지 — scripts/verify-rate-hist.mjs가 미러 없이 직접 import한다.
// 저장 파일(사용자 Index_Data 폴더, DRIVE_FILES.RATE_HIST_*) — 앱 탭이 saveDriveFile로만 쓴다(버전 백업 없음).
//   { v:1, keys: { 키: { first, last, d:[first부터 일수 차이…], x:[값…], source, savedAt } } }
// ⚠️ 금리차·스프레드(signed)는 0·음수가 정상값이다 — 부호로 버리지 않는다. 그 외 키는 0 이하를 손상값으로 버린다.

export const HIST_STORE_VERSION = 1;
export const HIST_FILE_MAX_BYTES = 4 * 1024 * 1024;   // 이보다 크면 그 묶음을 둘로 나눈다
export const HIST_TAIL_OVERLAP_DAYS = 5;              // 이어받기는 며칠 겹쳐 받는다(잠정값 보정)
export const HIST_CHUNK_YEARS = 10;                   // 긴 기간은 10년 단위로 나눠 요청
export const HIST_BATCH_KEYS = 4;                     // 한 번에 받는 키 수

export interface HistGroup { id: string; file: string; keys: string[] }
export const HIST_GROUPS: HistGroup[] = [
  { id: 'us', file: 'rate_hist_us.json', keys: ['fedRate', 'us3m', 'us2y', 'us10y', 'us30y', 't10y2y', 't10y3m'] },
  { id: 'credit', file: 'rate_hist_credit.json', keys: ['hyYield', 'hySpread', 'mort30', 'mbsSpread', 'move'] },
  { id: 'kr', file: 'rate_hist_kr.json', keys: ['krBase', 'kr3y', 'kr10y', 'krUs10y'] },
  { id: 'br', file: 'rate_hist_br.json', keys: ['brSelic', 'brIpca', 'brExp12', 'br10y', 'brReal', 'brlusd', 'brlkrw'] },
  { id: 'misc', file: 'rate_hist_misc.json', keys: ['usdkrw', 'dxy', 'vix'] },
];
export const HIST_KEYS = HIST_GROUPS.flatMap(g => g.keys);
// 4MB를 넘어 둘로 나눌 때의 둘째 파일 이름(첫째는 원래 이름) — 앱 탭은 이 목록 밖의 이름을 쓰지 않는다
export const splitFileName = (file: string) => file.replace(/\.json$/, '_2.json');
export const HIST_FILE_NAMES = HIST_GROUPS.flatMap(g => [g.file, splitFileName(g.file)]);
export const groupOfKey = (key: string) => HIST_GROUPS.find(g => g.keys.includes(key)) || null;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const fromDayNum = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export const shiftIso = (iso: string, d: number) => fromDayNum(dayNum(iso) + d);
const valid = (v: unknown, signed: boolean) => typeof v === 'number' && Number.isFinite(v) && (signed || v > 0);

// { 날짜: 값 } → 정렬된 유효 관측
export function seriesPairs(series: any, signed = false): Array<[string, number]> {
  if (!series || typeof series !== 'object') return [];
  const out: Array<[string, number]> = [];
  for (const d of Object.keys(series)) {
    const raw = series[d];
    const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (ISO.test(d) && valid(v, signed)) out.push([d, v as number]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export interface HistEntry { first: string; last: string; d: number[]; x: number[]; source: string; savedAt: string }
// 압축 — 첫 날짜 + 일수 차이 배열 + 값 배열. 관측이 없으면 null
export function encodeSeries(series: any, signed = false, source = '', savedAt = ''): HistEntry | null {
  const pts = seriesPairs(series, signed);
  if (!pts.length) return null;
  const base = dayNum(pts[0][0]);
  return { first: pts[0][0], last: pts[pts.length - 1][0], d: pts.map(([d]) => dayNum(d) - base), x: pts.map(([, v]) => v), source, savedAt };
}
// 해제 — 손상 항목(길이 불일치·날짜 오류)은 그 관측만 버린다
export function decodeSeries(entry: any, signed = false): Record<string, number> {
  const out: Record<string, number> = {};
  if (!entry || !ISO.test(String(entry.first || '')) || !Array.isArray(entry.d) || !Array.isArray(entry.x)) return out;
  const base = dayNum(entry.first);
  const n = Math.min(entry.d.length, entry.x.length);
  for (let i = 0; i < n; i++) {
    const off = entry.d[i], v = entry.x[i];
    if (Number.isInteger(off) && off >= 0 && valid(v, signed)) out[fromDayNum(base + off)] = v;
  }
  return out;
}
// 병합 — 같은 날짜는 새로 받은 값이 이긴다(잠정값 보정). 바뀐 게 없으면 원본 참조
export function mergeHist(prev: Record<string, number> | null | undefined, incoming: any, signed = false): Record<string, number> {
  const base = prev && typeof prev === 'object' ? prev : {};
  let next: Record<string, number> | null = null;
  for (const [d, v] of seriesPairs(incoming, signed)) {
    if (base[d] === v) continue;
    if (!next) next = { ...base };
    next[d] = v;
  }
  return next || base;
}

// 이어받기 시작일 — 저장 기록이 없으면 출처 첫 날짜(floor)부터, 있으면 마지막 날짜 − 겹침. 이미 최신이면 null
export function resumeFrom(entry: any, floor: string, today: string): string | null {
  if (!ISO.test(today)) return null;
  const last = entry && ISO.test(String(entry.last || '')) ? entry.last : null;
  if (!last) return ISO.test(floor) ? floor : shiftIso(today, -3 * 365);
  if (last >= today) return null;
  return shiftIso(last, -HIST_TAIL_OVERLAP_DAYS);
}
// 저장 기록이 출처 첫 날짜까지 다 차 있는가(앞쪽 7일 여유) — 아니면 처음부터 다시 받아야 한다
export const coversFloor = (entry: any, floor: string) => !!entry && ISO.test(String(entry.first || '')) && (!ISO.test(floor) || entry.first <= shiftIso(floor, 7));

// [from, to]를 years년 단위 구간으로 — 오래된 것부터
export function chunkRanges(from: string, to: string, years = HIST_CHUNK_YEARS): Array<[string, string]> {
  if (!ISO.test(from) || !ISO.test(to) || from > to) return [];
  const out: Array<[string, string]> = [];
  let s = from;
  while (s <= to) {
    const e0 = `${+s.slice(0, 4) + years}${s.slice(4)}`;
    const e = shiftIso(e0, -1) < to ? shiftIso(e0, -1) : to;
    out.push([s, e]);
    s = shiftIso(e, 1);
  }
  return out;
}

// 파일 본문 · 크기 · 분할
export function buildHistFile(entries: Record<string, HistEntry | null | undefined>): { v: number; keys: Record<string, HistEntry> } {
  const keys: Record<string, HistEntry> = {};
  for (const [k, e] of Object.entries(entries || {})) if (e) keys[k] = e;
  return { v: HIST_STORE_VERSION, keys };
}
// UTF-8 바이트 수(TextEncoder 없이 — 어느 런타임에서도 같은 값). 직렬화 실패는 Infinity(=분할 대상)
export function fileBytes(obj: any): number {
  let str: string;
  try { str = JSON.stringify(obj); } catch { return Infinity; }
  if (typeof str !== 'string') return 0;
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
  }
  return n;
}
// 묶음 하나를 파일로 — 4MB를 넘으면 키를 반으로 나눠 [원래 이름, _2 이름] 두 파일로 낸다
export function planGroupFiles(group: HistGroup, entries: Record<string, HistEntry | null | undefined>): Array<{ file: string; body: any; bytes: number }> {
  const pick = (ks: string[]) => buildHistFile(Object.fromEntries(ks.map(k => [k, entries[k]])));
  const whole = pick(group.keys);
  const bytes = fileBytes(whole);
  if (bytes <= HIST_FILE_MAX_BYTES || group.keys.length < 2) return [{ file: group.file, body: whole, bytes }, { file: splitFileName(group.file), body: null, bytes: 0 }];
  const half = Math.ceil(group.keys.length / 2);
  const a = pick(group.keys.slice(0, half)), b = pick(group.keys.slice(half));
  return [{ file: group.file, body: a, bytes: fileBytes(a) }, { file: splitFileName(group.file), body: b, bytes: fileBytes(b) }];
}
// 불러온 파일들(이름 → 본문) → 키 → 항목
export function readHistFiles(files: Record<string, any>): Record<string, HistEntry> {
  const out: Record<string, HistEntry> = {};
  for (const name of HIST_FILE_NAMES) {
    const f = files?.[name];
    if (!f || f.v !== HIST_STORE_VERSION || !f.keys || typeof f.keys !== 'object') continue;
    for (const [k, e] of Object.entries(f.keys)) if (HIST_KEYS.includes(k) && e && typeof e === 'object') out[k] = e as HistEntry;
  }
  return out;
}
