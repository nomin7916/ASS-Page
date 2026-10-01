// 관리자 '계정 이전' — 옛 계정의 Drive 데이터를 새 계정 폴더로 옮기는 순수 로직.
//
// ⚠️ 이 모듈은 **import 0건**을 유지한다 — `scripts/verify-migrate.mjs`가 미러 없이 직접 import해
//    검증한다(Node 타입 스트리핑: enum·namespace·파라미터 프로퍼티 금지).
// ⚠️ Drive I/O·GIS 토큰은 여기 없다(App.tsx `handleMigrationPreview`/`handleMigrationApply` +
//    driveStorage `updateDriveFileIfExists`). 여기는 '무엇을 옮길지·옮겨도 되는지·옮긴 뒤 STATE가
//    어떤 모양인지'만 결정한다.
//
// 설계 원칙(CLAUDE.md '관리자 계정 이전' 절):
//   · 원본은 읽기만 한다. 대상에 **이미 있는 파일만 내용을 갱신**하고 새 파일은 만들지 않는다 —
//     관리자 토큰으로 사용자 폴더에 만든 파일은 관리자 소유가 되어 사용자 앱(drive.file)이 읽지 못할 수 있다.
//   · STATE는 필수, 나머지는 '양쪽에 있을 때만'. 종가 캐시가 빠져도 앱이 재조회하므로 손실이 아니다.
//   · 덮어쓰기 전 대상 STATE를 관리자 폴더에 백업한다(undo 없음 — 유일한 복구 지점).

export type MigrationFileKey = 'STATE' | 'MARKET' | 'STOCK' | 'DIVIDEND_TAX' | 'NOTIFICATION_LOG';

export interface MigrationFileSpec {
  key: MigrationFileKey;
  name: string;      // ⚠️ driveStorage DRIVE_FILES와 문자 그대로 같아야 한다(verify #8이 대조)
  label: string;
  required: boolean; // true = 대상에 없으면 이전 자체를 막는다
}

// ⚠️ STATE가 반드시 첫 항목 — 적용 루프가 이 순서로 돌고 STATE 실패 시 나머지를 중단한다.
export const MIGRATION_FILES: MigrationFileSpec[] = [
  { key: 'STATE',            name: 'portfolio_state.json',      label: '계좌·종목·기록 전체',     required: true },
  { key: 'MARKET',           name: 'portfolio_marketdata.json', label: '환율·금 시세 이력',       required: false },
  { key: 'STOCK',            name: 'portfolio_stockdata.json',  label: '종목별 과거 종가 캐시',   required: false },
  { key: 'DIVIDEND_TAX',     name: 'dividend_tax_history.json', label: '배당 과세 페이지 데이터', required: false },
  { key: 'NOTIFICATION_LOG', name: 'notification_log.json',     label: '알림 이력',               required: false },
];

// approved_users 시트 E~M열 — AdminPage featureDefs·Apps Script colMap과 같은 9종.
export const MIGRATION_FEATURE_KEYS = [
  'feature1', 'feature2', 'feature3',
  'youtubeEnabled', 'notebookEnabled', 'reportEnabled',
  'flowEnabled', 'backtestEnabled', 'ledgerEnabled',
] as const;

export type MigrationFeatureKey = typeof MIGRATION_FEATURE_KEYS[number];

export interface FeatureDiff { feature: MigrationFeatureKey; value: boolean }

export type FileAction = 'update' | 'skip-source-missing' | 'skip-target-missing' | 'blocked';

export interface FilePlan extends MigrationFileSpec { action: FileAction }

export interface StateSummary {
  accounts: number;        // 배열 전체(삭제 계좌 포함)
  liveAccounts: number;    // deletedAt 없는 계좌
  items: number;           // 수량 또는 투자금이 있는 종목·펀드·예적금 행
  historyFrom: string;     // 가장 이른 평가 기록일 ('' = 없음)
  historyTo: string;
  historyRecords: number;  // 전 계좌 평가 기록 건수 합
  deposits: number;        // 입출금 원장 행 수 합
  calendarMemoDays: number;
  watchlistGroups: number;
  flowMaps: number;
  backtestScenarios: number;
  ledgerBooks: number;
  portfolioUpdatedAt: number; // 0 = 없음
}

export interface MigrationPreview {
  ok: boolean;             // blockers.length === 0
  blockers: string[];      // 하나라도 있으면 적용 버튼이 잠긴다
  warnings: string[];      // 적용은 되지만 사람이 알아야 할 것
  source: { email: string; folderFound: boolean; summary: StateSummary };
  target: { email: string; folderFound: boolean; hasState: boolean; hasData: boolean; online: boolean; summary: StateSummary };
  files: FilePlan[];
  features: FeatureDiff[];
}

export interface MigrationStep { label: string; status: 'ok' | 'fail' | 'skip'; detail?: string }

export interface MigrationApplyResult {
  ok: boolean;
  steps: MigrationStep[];
  backupName?: string;
  error?: string;
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000; // AdminPage formatLastSeen의 '접속 중' 판정과 같은 값

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const lower = (s: unknown): string => String(s || '').trim().toLowerCase();

export function diffFeatureFlags(src: Record<string, unknown> | null | undefined, dst: Record<string, unknown> | null | undefined): FeatureDiff[] {
  const out: FeatureDiff[] = [];
  for (const feature of MIGRATION_FEATURE_KEYS) {
    const a = !!(src && src[feature]);
    const b = !!(dst && dst[feature]);
    if (a !== b) out.push({ feature, value: a });
  }
  return out;
}

export function summarizeState(state: any): StateSummary {
  const s: StateSummary = {
    accounts: 0, liveAccounts: 0, items: 0, historyFrom: '', historyTo: '', historyRecords: 0, deposits: 0,
    calendarMemoDays: 0, watchlistGroups: 0, flowMaps: 0, backtestScenarios: 0, ledgerBooks: 0,
    portfolioUpdatedAt: 0,
  };
  if (!state || typeof state !== 'object') return s;
  const portfolios = Array.isArray(state.portfolios) ? state.portfolios : [];
  s.accounts = portfolios.length;
  for (const p of portfolios) {
    if (!p || typeof p !== 'object') continue;
    if (!p.deletedAt) s.liveAccounts++;
    const items = Array.isArray(p.portfolio) ? p.portfolio : [];
    for (const it of items) {
      if (!it || it.type === 'deposit') continue;
      if (num(it.quantity) > 0 || num(it.investAmount) > 0 || num(it.investAmountUsd) > 0) s.items++;
    }
    const hist = Array.isArray(p.history) ? p.history : [];
    for (const h of hist) {
      const d = typeof h?.date === 'string' ? h.date : '';
      if (!d) continue;
      s.historyRecords++;
      if (!s.historyFrom || d < s.historyFrom) s.historyFrom = d;
      if (!s.historyTo || d > s.historyTo) s.historyTo = d;
    }
    s.deposits += (Array.isArray(p.depositHistory) ? p.depositHistory.length : 0)
      + (Array.isArray(p.depositHistory2) ? p.depositHistory2.length : 0);
  }
  s.calendarMemoDays = state.calendarMemos && typeof state.calendarMemos === 'object' ? Object.keys(state.calendarMemos).length : 0;
  s.watchlistGroups = Array.isArray(state.watchlistGroups) ? state.watchlistGroups.length : 0;
  s.flowMaps = Array.isArray(state.flowMaps) ? state.flowMaps.length : 0;
  s.backtestScenarios = Array.isArray(state.backtestScenarios) ? state.backtestScenarios.length : 0;
  s.ledgerBooks = Array.isArray(state.ledgerBooks) ? state.ledgerBooks.length : 0;
  s.portfolioUpdatedAt = num(state.portfolioUpdatedAt);
  return s;
}

// '대상에 이미 쓰고 있던 데이터가 있는가' — 있으면 UI가 대상 이메일을 직접 입력하게 한다(2단계 확인).
// 전제 조건인 '계좌 1개 생성'(빈 더미 계좌)은 데이터로 치지 않는다.
export function targetHasData(state: any): boolean {
  const s = summarizeState(state);
  return s.liveAccounts > 1 || s.items > 0 || s.historyRecords > 1 || s.deposits > 0
    || s.calendarMemoDays > 0 || s.watchlistGroups > 0;
}

export function planFileCopies(srcHas: Partial<Record<MigrationFileKey, boolean>>, dstHas: Partial<Record<MigrationFileKey, boolean>>): FilePlan[] {
  return MIGRATION_FILES.map(f => {
    let action: FileAction;
    if (!dstHas[f.key]) action = f.required ? 'blocked' : 'skip-target-missing';
    else if (!srcHas[f.key]) action = f.required ? 'blocked' : 'skip-source-missing';
    else action = 'update';
    return { ...f, action };
  });
}

export interface BlockerInput {
  srcEmail: string;
  dstEmail: string;
  adminEmail: string;
  srcFolderFound: boolean;
  dstFolderFound: boolean;
  srcState: any;
  dstHasState: boolean;
}

export function migrationBlockers(i: BlockerInput): string[] {
  const out: string[] = [];
  if (!lower(i.srcEmail) || !lower(i.dstEmail)) out.push('원본과 대상 계정을 모두 선택하세요.');
  if (lower(i.srcEmail) && lower(i.srcEmail) === lower(i.dstEmail)) out.push('원본과 대상이 같은 계정입니다.');
  if (lower(i.dstEmail) && lower(i.dstEmail) === lower(i.adminEmail)) out.push('관리자 계정을 대상으로 지정할 수 없습니다.');
  if (!i.srcFolderFound) {
    out.push('원본 계정의 Drive 폴더를 찾지 못했습니다. 그 계정이 관리자 접근을 허용한 상태였고 Google 계정이 아직 살아 있어야 합니다.');
  } else if (!i.srcState) {
    out.push('원본 폴더에 portfolio_state.json이 없습니다.');
  } else if (!(Array.isArray(i.srcState.portfolios) && i.srcState.portfolios.length > 0)) {
    out.push('원본 STATE에 계좌가 하나도 없어 옮길 것이 없습니다.');
  }
  if (!i.dstFolderFound) {
    out.push('대상 계정이 아직 앱에 로그인한 적이 없습니다. 시트에 승인한 뒤 그 계정으로 한 번 로그인해야 Drive 폴더가 생깁니다.');
  } else if (!i.dstHasState) {
    out.push('대상 폴더에 portfolio_state.json이 없습니다. 대상 계정으로 로그인해 계좌를 하나 만들어 두면 파일이 생깁니다(관리자는 새 파일을 만들지 않습니다).');
  }
  return out;
}

export interface PreviewInput extends BlockerInput {
  dstState: any;
  srcHas: Partial<Record<MigrationFileKey, boolean>>;
  dstHas: Partial<Record<MigrationFileKey, boolean>>;
  srcUser: Record<string, unknown> | null | undefined;
  dstUser: Record<string, unknown> | null | undefined;
  dstLastSeen: number;  // SESSION lastSeen(ms), 0 = 없음
  now: number;
}

export function buildMigrationPreview(i: PreviewInput): MigrationPreview {
  const blockers = migrationBlockers(i);
  const files = planFileCopies(i.srcHas, i.dstHas);
  const hasData = targetHasData(i.dstState);
  const online = i.dstLastSeen > 0 && (i.now - i.dstLastSeen) < ONLINE_WINDOW_MS;
  const warnings: string[] = [];
  if (online) warnings.push('대상 사용자가 지금 접속 중입니다. 열린 앱의 저장이 이전 결과를 덮을 수 있으니 앱을 닫게 한 뒤 진행하세요.');
  if (hasData) warnings.push('대상 계정에 이미 데이터가 있습니다. 적용하면 전부 원본 내용으로 교체됩니다(적용 전 대상 STATE를 관리자 폴더에 백업합니다).');
  for (const f of files) {
    if (f.action === 'skip-target-missing') {
      warnings.push(`${f.label}(${f.name})은 대상에 파일이 없어 건너뜁니다.${f.key === 'STOCK' ? ' 종가 캐시는 앱이 첫 접속에서 다시 조회합니다.' : ''}`);
    } else if (f.action === 'skip-source-missing') {
      warnings.push(`${f.label}(${f.name})은 원본에 파일이 없어 건너뜁니다.`);
    }
  }
  warnings.push('PIN·백업 파일·세션은 옮기지 않습니다. 대상 계정은 자기 PIN을 그대로 씁니다.');
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    source: { email: i.srcEmail, folderFound: i.srcFolderFound, summary: summarizeState(i.srcState) },
    target: { email: i.dstEmail, folderFound: i.dstFolderFound, hasState: !!i.dstHasState, hasData, online, summary: summarizeState(i.dstState) },
    files,
    features: diffFeatureFlags(i.srcUser, i.dstUser),
  };
}

// 조회 자체가 실패했을 때(토큰·네트워크) UI가 같은 모양으로 그릴 수 있게 하는 빈 미리보기.
export function migrationErrorPreview(srcEmail: string, dstEmail: string, message: string): MigrationPreview {
  return {
    ok: false,
    blockers: [message],
    warnings: [],
    source: { email: srcEmail, folderFound: false, summary: summarizeState(null) },
    target: { email: dstEmail, folderFound: false, hasState: false, hasData: false, online: false, summary: summarizeState(null) },
    files: planFileCopies({}, {}),
    features: [],
  };
}

// 대상 STATE로 쓸 객체. 입력은 변형하지 않는다.
//  · 시세 계층(stockHistoryMap 등)은 STATE에 없어야 한다(원본이 STATE 파일이면 애초에 없지만 방어).
//  · portfolioUpdatedAt·chartPrefsUpdatedAt을 **새로** 찍는다 — 대상 앱의 저장 가드(lastSaved 비교)와
//    폴링(version 파일)이 이 값으로 '변경됨'을 판정한다.
//  · startDate 정규화는 handleImportStateFile과 같은 식.
export function prepareMigratedState(srcState: any, now: number): any {
  const { stockHistoryMap: _s, marketIndices: _m, marketIndicators: _mi, indicatorHistoryMap: _ih, manualSavedAt: _ms, ...core } = (srcState || {});
  const portfolios = Array.isArray(core.portfolios)
    ? core.portfolios.map((p: any) => ({
        ...p,
        startDate: p?.portfolioStartDate || p?.startDate || '',
        portfolioStartDate: p?.portfolioStartDate || p?.startDate || '',
      }))
    : [];
  return { ...core, portfolios, portfolioUpdatedAt: now, chartPrefsUpdatedAt: now, updatedAt: now };
}

// 관리자 폴더(Index_Data_Admin)에 남기는 '덮어쓰기 직전 대상 STATE' 백업 파일명.
export function migrationBackupName(dstEmail: string, now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const safe = lower(dstEmail).replace(/[^a-z0-9._@-]/g, '_');
  return `migration_backup_${safe}_${ts}.json`;
}
