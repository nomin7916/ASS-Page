// 금리 모니터링 ⑥ 설정 — 기준치·수동값·브라질 정치 메모의 병합·검증(9-A, 2026-10).
// ⚠️ import 0건 · React 금지 · enum 금지 — scripts/verify-rate-settings.mjs가 미러 없이 직접 import한다.
// ⚠️ 기본값(RATE_RULES·MANUAL_INPUTS)은 인자로 받는다 — 이 모듈은 저장 파일 모양과 범위 규칙만 안다.
// 저장 파일(Drive 사용자 Index_Data 폴더, DRIVE_FILES.RATE_SETTINGS = 'rate_monitor_settings.json'):
//   { rules: { 그룹: { 칸: 값 } }(기본값과 다른 칸만), manual: { 티커: { value, asOf } }, brazilNotes: [...], updatedAt }

export interface RuleField { group: string; key: string; label: string; min: number; max: number; int?: boolean; unit: string }
export interface RuleGroup { key: string; label: string; fields: RuleField[] }

const F = (group: string, key: string, label: string, min: number, max: number, unit: string, int = false): RuleField => ({ group, key, label, min, max, unit, int });
// group '' = RATE_RULES 최상위 칸
export const RULE_GROUPS: RuleGroup[] = [
  { key: '', label: '공통(세금)', fields: [F('', 'withholdingPct', '미국 원천징수율', 0, 100, '%'), F('', 'krInterestTaxPct', '한국 이자소득세율', 0, 100, '%')] },
  { key: 'tlt', label: '미국 장기채', fields: [F('tlt', 'pctMin', '10·30년 3년 백분위 이상', 0, 100, ''), F('tlt', 'nearHighPp', '52주 최고와의 차이 이내', 0, 5, '%p')] },
  { key: 'hy', label: '하이일드', fields: [F('hy', 'positionMin', '연중 위치 이상', 0, 100, '%'), F('hy', 'crisisChange1mPp', '신용 불안 경고(스프레드 1개월 상승)', 0, 10, '%p')] },
  { key: 'mreit', label: '모기지 리츠', fields: [F('mreit', 'curvePctMax', '10년−2년 3년 백분위 이하', 0, 100, ''), F('mreit', 'mbsPctMin', 'MBS 스프레드 3년 백분위 이상', 0, 100, ''),
    F('mreit', 'pbMax', 'AGNC 주가÷장부가 이하', 0, 5, '배'), F('mreit', 'pbWarn', '유상증자 위험 경고 이상', 0, 5, '배')] },
  { key: 'reit', label: '실물 리츠', fields: [F('reit', 'pctMin', '10년 3년 백분위 이상', 0, 100, ''), F('reit', 'oYieldMin', '리얼티인컴 배당률 이상', 0, 30, '%')] },
  { key: 'bdc', label: 'BDC', fields: [F('bdc', 'fedPctMin', '기준금리 3년 백분위 이상', 0, 100, ''), F('bdc', 'hyChangeMaxPp', '스프레드 1개월 상승 미만', 0, 10, '%p'),
    F('bdc', 'hyPctMax', '스프레드 3년 백분위 미만', 0, 100, ''), F('bdc', 'mainDrawdownMax', 'MAIN 52주 최고 대비 이하', -100, 0, '%'), F('bdc', 'mainPnavMax', 'MAIN 주가÷순자산 이하', 0, 5, '배')] },
  { key: 'krBond', label: '한국 채권', fields: [F('krBond', 'pctMin', '국고채 10년 3년 백분위 이상', 0, 100, '')] },
  { key: 'brBond', label: '브라질 국채', fields: [
    F('brBond', 'pctMin', '10년 3년 백분위 이상', 0, 100, ''), F('brBond', 'realMinPp', '실질금리 이상', -20, 30, '%p'),
    F('brBond', 'exp3mMaxRisePp', '기대물가 3개월 상승 이내', -5, 5, '%p'), F('brBond', 'selicPctMin', 'Selic 3년 백분위 이상', 0, 100, ''),
    F('brBond', 'selicCalmDays', 'Selic 인상 없음 기간', 1, 365, '일', true), F('brBond', 'brlkrwPosMax', '헤알·원 연중 위치 이하', 0, 100, '%'),
    F('brBond', 'noteDays', '정치 메모 확인 기간', 1, 365, '일', true), F('brBond', 'watchScore', '매수 관심 점수 이상', 0, 6, '점', true),
    F('brBond', 'buyScore', '매수 적기 점수 이상', 0, 6, '점', true), F('brBond', 'warnExp1mPp', '경고: 기대물가 1개월 상승', 0, 10, '%p'),
    F('brBond', 'warnBrlkrw1mPct', '경고: 헤알·원 1개월 하락', -100, 0, '%')] },
];
export const RULE_FIELDS: RuleField[] = RULE_GROUPS.flatMap(g => g.fields);
export const fieldId = (f: RuleField) => (f.group ? `${f.group}.${f.key}` : f.key);

export const getRule = (rules: any, f: RuleField): any => (f.group ? rules?.[f.group]?.[f.key] : rules?.[f.key]);
function setRule(rules: any, f: RuleField, v: number) {
  if (f.group) rules[f.group] = { ...(rules[f.group] || {}), [f.key]: v };
  else rules[f.key] = v;
}

// 칸 하나 — 숫자·범위·정수 검사. 빈 칸·문자·범위 밖은 거부하고 사유를 돌려준다.
export function checkRuleValue(f: RuleField, raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const s = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
  if (s === '') return { ok: false, error: '값을 입력하세요' };
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, error: '숫자가 아닙니다' };
  if (v < f.min || v > f.max) return { ok: false, error: `${f.min}~${f.max} 사이만 가능합니다` };
  if (f.int && !Number.isInteger(v)) return { ok: false, error: '정수만 가능합니다' };
  return { ok: true, value: v };
}

// 칸 전체 검사 — { 칸id: 사유 }. 칸끼리의 관계(매수 관심 ≤ 매수 적기, 장부가 기준 ≤ 경고)도 본다.
export function validateRules(draft: Record<string, unknown>): Record<string, string> {
  const errs: Record<string, string> = {};
  const val: Record<string, number> = {};
  for (const f of RULE_FIELDS) {
    const r = checkRuleValue(f, draft?.[fieldId(f)]);
    if (r.ok) val[fieldId(f)] = r.value; else errs[fieldId(f)] = r.error;
  }
  if (val['brBond.watchScore'] != null && val['brBond.buyScore'] != null && val['brBond.watchScore'] > val['brBond.buyScore']) errs['brBond.buyScore'] = '매수 관심 점수보다 작을 수 없습니다';
  if (val['mreit.pbMax'] != null && val['mreit.pbWarn'] != null && val['mreit.pbMax'] > val['mreit.pbWarn']) errs['mreit.pbWarn'] = '주가÷장부가 기준보다 작을 수 없습니다';
  return errs;
}

// 기본값 위에 저장값을 덮는다 — 범위 안의 숫자만 채택(손상값은 기본값 그대로). 입력 기본값은 바꾸지 않는다.
export function mergeRules<T>(defaults: T, saved: any): T {
  const out: any = JSON.parse(JSON.stringify(defaults));
  for (const f of RULE_FIELDS) {
    const raw = getRule(saved, f);
    if (raw === undefined || raw === null) continue;
    const r = checkRuleValue(f, raw);
    if (r.ok && getRule(defaults, f) !== undefined) setRule(out, f, r.value);
  }
  return out;
}
// 저장할 것 = 기본값과 다른 칸만
export function diffRules(defaults: any, rules: any): Record<string, any> {
  const out: any = {};
  for (const f of RULE_FIELDS) {
    const v = getRule(rules, f);
    if (typeof v === 'number' && Number.isFinite(v) && v !== getRule(defaults, f)) setRule(out, f, v);
  }
  return out;
}
// 화면 입력칸 초안 ↔ 규칙 객체
export const rulesToDraft = (rules: any): Record<string, string> =>
  Object.fromEntries(RULE_FIELDS.map(f => [fieldId(f), getRule(rules, f) == null ? '' : String(getRule(rules, f))]));
export function draftToRules<T>(defaults: T, draft: Record<string, unknown>): T {
  const out: any = JSON.parse(JSON.stringify(defaults));
  for (const f of RULE_FIELDS) { const r = checkRuleValue(f, draft?.[fieldId(f)]); if (r.ok) setRule(out, f, r.value); }
  return out;
}

// ── 수동값(주당 장부가·순자산) ──
export interface ManualValue { value: number | null; asOf: string | null }
export interface ManualInputs { bookValue: Record<string, ManualValue>; nav: Record<string, ManualValue> }
export const MANUAL_STALE_DAYS = 120;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// 달력에 있는 날짜인가 — 2026-02-30 같은 값은 Invalid Date라 toISOString이 던지므로 먼저 시각을 확인한다
const isRealDate = (s: string) => {
  if (!ISO.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
};

// 기준일 — 'YYYY-MM-DD' 또는 분기 'YYYY-Qn'(그 분기 말일로 본다). 못 읽으면 null
export function manualAsOfDate(asOf: unknown): string | null {
  const s = String(asOf ?? '').trim();
  if (isRealDate(s)) return s;
  const q = /^(\d{4})-?Q([1-4])$/i.exec(s);
  if (q) return `${q[1]}-${['03-31', '06-30', '09-30', '12-31'][+q[2] - 1]}`;
  return null;
}
// 오래된 값 — 기준일이 오늘보다 days일 넘게 지났다(기준일이 없거나 못 읽으면 false: '오래됨'으로 단언하지 않는다)
export function manualStale(asOf: unknown, today: string, days = MANUAL_STALE_DAYS): boolean {
  const d = manualAsOfDate(asOf);
  if (!d || !isRealDate(today)) return false;
  return (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000 > days;
}
export function checkManualValue(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
  if (s === '') return { ok: true, value: null };   // 비우면 '입력 필요'
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, error: '숫자가 아닙니다' };
  if (v <= 0) return { ok: false, error: '0보다 커야 합니다' };
  return { ok: true, value: v };
}
// 기본값의 티커만 · 저장값이 유효하면 덮는다
export function mergeManual(defaults: ManualInputs, saved: any): ManualInputs {
  const out: ManualInputs = { bookValue: {}, nav: {} };
  for (const kind of ['bookValue', 'nav'] as const) {
    for (const [t, d] of Object.entries(defaults[kind] || {})) {
      const sv = saved?.[t];
      const c = checkManualValue(sv?.value);
      out[kind][t] = sv && c.ok ? { value: c.value, asOf: c.value == null ? null : (manualAsOfDate(sv.asOf) ? String(sv.asOf).trim() : null) } : { ...d };
    }
  }
  return out;
}
// 저장할 수동값 = 값이 있는 티커만 { 티커: { value, asOf } }
export function manualToSave(manual: ManualInputs): Record<string, ManualValue> {
  const out: Record<string, ManualValue> = {};
  for (const kind of ['bookValue', 'nav'] as const) for (const [t, m] of Object.entries(manual[kind] || {})) if (m && m.value != null) out[t] = { value: m.value, asOf: m.asOf };
  return out;
}

// ── 브라질 정치 메모 ──
export const NOTE_IMPACTS = ['유리', '불리', '중립'];
export interface NoteDraft { date: string; text: string; impact: string; source: string }
export function checkNote(n: any): string | null {
  if (!n || !isRealDate(String(n.date || ''))) return '날짜(YYYY-MM-DD)를 확인하세요';
  if (!String(n.text || '').trim()) return '내용을 입력하세요';
  if (!NOTE_IMPACTS.includes(n.impact)) return '영향을 고르세요';
  const src = String(n.source || '').trim();
  if (src && !/^https?:\/\//i.test(src)) return '출처는 http(s) 링크만 가능합니다';
  return null;
}
export const normalizeNotes = (list: any): NoteDraft[] =>
  (Array.isArray(list) ? list : []).filter(n => checkNote(n) === null)
    .map(n => ({ date: n.date, text: String(n.text).trim(), impact: n.impact, source: String(n.source || '').trim() }));

// ── 상태 변경 기록(9-B) — 벨 알림 대신. 창을 열 때 자산군별 지금 상태를 직전 기록과 비교해 바뀐 것만 남긴다 ──
//   상태 표기 = 'wait' | 'watch' | 'buy' (경고 중이면 뒤에 ':warn'). 같은 날 같은 자산군은 1건(그날 처음 상태 → 지금 상태).
export const HISTORY_MAX = 200;
export interface StateEvent { date: string; key: string; label: string; from: string | null; to: string; rationale: string }
const STATE_RE = /^(wait|watch|buy)(:warn)?$/;
export const stateToken = (state: string, warning: unknown) => `${state}${warning ? ':warn' : ''}`;
export function normalizeHistory(list: any): StateEvent[] {
  return (Array.isArray(list) ? list : [])
    .filter(e => e && isRealDate(String(e.date || '')) && typeof e.key === 'string' && STATE_RE.test(String(e.to || '')) && (e.from == null || STATE_RE.test(String(e.from))))
    .map(e => ({ date: e.date, key: e.key, label: String(e.label || e.key), from: e.from == null ? null : String(e.from), to: String(e.to), rationale: String(e.rationale || '') }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-HISTORY_MAX);
}
// signals: [{ key, label, state, warning, rationale }] — 바뀐 게 없으면 같은 배열을 그대로 돌려준다(changed=false)
export function appendStateChanges(history: StateEvent[], signals: any[], today: string): { history: StateEvent[]; changed: boolean } {
  if (!isRealDate(today) || !Array.isArray(signals)) return { history, changed: false };
  let next = history.slice();
  let changed = false;
  for (const sg of signals) {
    if (!sg || typeof sg.key !== 'string') continue;
    const now = stateToken(sg.state, sg.warning);
    if (!STATE_RE.test(now)) continue;
    let lastIdx = -1;
    for (let i = next.length - 1; i >= 0; i--) if (next[i].key === sg.key) { lastIdx = i; break; }
    const last = lastIdx >= 0 ? next[lastIdx] : null;
    if (last && last.to === now) continue;
    if (last && last.date === today) {                       // 같은 날 두 번째 변화 — 그날 1건으로 합친다
      if (last.from === now) next.splice(lastIdx, 1);        // 그날 처음 상태로 돌아왔다 → 그날 기록 없음
      else next[lastIdx] = { ...last, to: now, rationale: String(sg.rationale || '') };
    } else {
      next.push({ date: today, key: sg.key, label: String(sg.label || sg.key), from: last ? last.to : null, to: now, rationale: String(sg.rationale || '') });
    }
    changed = true;
  }
  if (!changed) return { history, changed: false };
  if (next.length > HISTORY_MAX) next = next.slice(-HISTORY_MAX);  // 오래된 것부터 버린다
  return { history: next, changed: true };
}

// ── 파일 ──
export interface RateSettingsFile { rules: any; manual: Record<string, ManualValue>; brazilNotes: NoteDraft[]; history: StateEvent[]; updatedAt: string }
export function buildSettingsFile(defaults: any, rules: any, manual: ManualInputs, notes: any, nowIso: string, history: any = []): RateSettingsFile {
  return { rules: diffRules(defaults, rules), manual: manualToSave(manual), brazilNotes: normalizeNotes(notes), history: normalizeHistory(history), updatedAt: nowIso };
}
// 파일이 없거나(null) 손상이면 기본값 그대로
export function applySettingsFile(file: any, defaults: any, manualDefaults: ManualInputs): { rules: any; manual: ManualInputs; notes: NoteDraft[]; history: StateEvent[] } {
  const f = file && typeof file === 'object' ? file : {};
  return { rules: mergeRules(defaults, f.rules), manual: mergeManual(manualDefaults, f.manual), notes: normalizeNotes(f.brazilNotes), history: normalizeHistory(f.history) };
}
