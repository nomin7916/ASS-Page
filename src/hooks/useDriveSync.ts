// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import {
  DRIVE_FILES, getOrCreateIndexFolder, saveDriveFile, loadDriveFile,
  loadVersionTimestamp, saveVersionFile, saveVersionedBackup,
  listBackups, loadBackupById, DriveBackupEntry,
  grantAdminReadAccess, revokeAdminReadAccess,
  getManualLatestEntry,
} from '../driveStorage';
import { flowMapsHaveContent } from '../flowMap';
import { backtestScenariosHaveContent } from '../backtest';
import { ledgerBooksHaveContent, ledgerSnapshotsHaveContent } from '../ledger';

// STOCK(종목별 과거 종가 캐시) 하이드레이션 대기 상한(ms).
// ⚠️ 부팅은 STATE+MARKET+STOCK을 **함께** 적용해 첫 렌더부터 과거 평가액이 최종값이어야 한다(STOCK-first).
//    다만 STOCK은 수 MB라 느린 회선에서 무한정 기다리면 STATE 적용까지 늦어지므로 상한을 둔다 —
//    초과 시 STATE만 먼저 적용하고, 늦게 도착한 STOCK은 그때 1회 하이드레이션(Drive 베이스 + 메모리 우선 병합)한다.
export const STOCK_HYDRATE_WAIT_MS = 10000;
// Promise.race 판별용 센티널 — STOCK 로드가 상한 안에 끝나지 않았음을 뜻한다(값이 아니다).
const STOCK_TIMED_OUT = { stockTimedOut: true };

function _stripStateForSave(stateData: any) {
  const { stockHistoryMap: _s, marketIndices: _m, marketIndicators: _mi, indicatorHistoryMap: _ih, ...core } = stateData;
  return core;
}

// 복원/가져오기(handleApplyBackup·handleImportStateFile)로 Drive STATE에 쓸 때 앱 레벨 개인 데이터
// (메모 달력·관심종목)를 결정. 현재 값(current = saveStateRef.current)이 있으면 유지 → 과거 이력으로
// 복원해도 메모·관심종목이 되돌려지지 않는다. 현재 값이 비어 있을 때만 백업/파일 값 채택(신규 기기
// 이전 시 유실 방지). applyBackupData의 in-memory sticky 규칙과 동일한 current를 참조하므로 결과 일치.
function _preserveStickyPersonalData(stateCore: any, current: any) {
  const curMemos = current?.calendarMemos;
  const curWatch = current?.watchlistGroups;
  const curFlow = current?.flowMaps;
  const keepMemos = curMemos && Object.keys(curMemos).length > 0;
  const keepWatch = Array.isArray(curWatch) && curWatch.length > 0;
  // ⚠️ 흐름도는 length가 아니라 flowMapsHaveContent('내용이 있는가')로 판정한다 — 보드를 열기만 해도
  //    빈 맵 1장이 생겨 length 기준이면 백업 복원 경로가 영구히 막힌다. App.tsx applyBackupData와
  //    **같은 함수**를 공유해야 in-memory와 Drive write가 갈리지 않는다(판정식 손복제 금지).
  const keepFlow = flowMapsHaveContent(curFlow);
  // ⚠️ 백테스트 시나리오도 흐름도와 같은 이유로 '내용이 있는가'로 판정한다(length 금지) —
  //    App.tsx applyBackupData와 **같은 함수**를 공유해야 in-memory와 Drive write가 갈리지 않는다.
  const curBt = current?.backtestScenarios;
  const keepBt = backtestScenariosHaveContent(curBt);
  // ⚠️ 가계부도 같은 이유로 '내용이 있는가'로 판정한다(length 금지) — 화면을 열기만 해도 빈 장부가
  //    1권 생기므로 length 기준이면 백업 복원 경로가 영구히 막힌다. App.tsx applyBackupData와
  //    **같은 함수**를 공유해야 in-memory와 Drive write가 갈리지 않는다.
  const curLedger = current?.ledgerBooks;
  const keepLedger = ledgerBooksHaveContent(curLedger);
  // ⚠️ 가계부 스냅샷(이전 기록)도 sticky — 백업 복원이 이걸 되돌리면
  //    그 백업 시점 이후의 복구 지점이 통째로 사라진다(복구 수단이 복구로 지워지는 역설).
  const curLedgerSnaps = current?.ledgerSnapshots;
  const keepLedgerSnaps = ledgerSnapshotsHaveContent(curLedgerSnaps);
  return {
    calendarMemos: keepMemos ? curMemos : (stateCore.calendarMemos ?? curMemos),
    watchlistGroups: keepWatch ? curWatch : (stateCore.watchlistGroups ?? curWatch),
    flowMaps: keepFlow ? curFlow : (stateCore.flowMaps ?? curFlow),
    backtestScenarios: keepBt ? curBt : (stateCore.backtestScenarios ?? curBt),
    ledgerBooks: keepLedger ? curLedger : (stateCore.ledgerBooks ?? curLedger),
    ledgerSnapshots: keepLedgerSnaps ? curLedgerSnaps : (stateCore.ledgerSnapshots ?? curLedgerSnaps),
  };
}
import { GOOGLE_CLIENT_ID, ADMIN_EMAIL } from '../config';

// SyncStatus 상태 머신
// idle    → 로그인 전
// loading → Drive 데이터 로드 중 (저장 차단)
// ready   → 정상 동작 중
// saving  → Drive 저장 중 (Drive 로드 차단)
// error   → 마지막 작업 실패
type SyncStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

type ApplyStateDataFn = (stateData: any, stockData: any, marketData: any) => void;
type ApplyStockDataFn = (stockMap: Record<string, Record<string, number>>) => void;
type ApplyBackupDataFn = (stateData: any, accountChartStatesRef: React.MutableRefObject<any>) => void;

interface UseDriveSyncParams {
  authUser: { email: string; token: string } | null;
  applyStateData: ApplyStateDataFn;
  applyStockData: ApplyStockDataFn;
  applyBackupData: ApplyBackupDataFn;
  accountChartStatesRef: React.MutableRefObject<any>;
  saveStateRef: React.MutableRefObject<any>;
  adminViewingAsRef: React.MutableRefObject<string | null>;
  adminOwnDriveTokenRef: React.MutableRefObject<string>;
  notify: (text: string, type?: string) => void;
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
  // 종료 계열 저장 직전에 동기 호출 — 반환값(부분 state)을 saveStateRef 스냅샷에 병합해 저장한다.
  // 언로드 중에는 리렌더가 보장되지 않아 setState 결과가 saveStateRef에 반영되지 못하므로,
  // "저장 직전 커밋 → 그 자리에서 payload에 주입"이 유일하게 안전한 경로다. 미제공 시 동작 불변.
  beforeExitSnapshotRef?: React.MutableRefObject<(() => any) | null>;
  onForceLogout: () => void;
}

export function useDriveSync({
  authUser,
  applyStateData,
  applyStockData,
  applyBackupData,
  accountChartStatesRef,
  saveStateRef,
  adminViewingAsRef,
  adminOwnDriveTokenRef,
  notify,
  confirm,
  beforeExitSnapshotRef,
  onForceLogout,
}: UseDriveSyncParams) {
  // ── Drive 상태 ──
  const [driveStatus, setDriveStatus] = useState(''); // '' | 'auth_needed' | 'loading' | 'saving' | 'saved' | 'error'
  const [driveToken, setDriveToken] = useState('');
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupList, setBackupList] = useState<DriveBackupEntry[]>([]);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [applyingBackupId, setApplyingBackupId] = useState<string | null>(null);
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const lastActivityAtRef = useRef<number>(Date.now());
  const inactivityWarningActiveRef = useRef(false);

  // ── SyncStatus ref (렌더 없이 동기적으로 읽어야 하므로 ref 사용) ──
  const syncStatusRef = useRef<SyncStatus>('idle');
  const setSS = (s: SyncStatus) => { syncStatusRef.current = s; };

  // ── Drive refs ──
  const driveTokenRef = useRef('');
  const driveFolderIdRef = useRef('');
  const tokenClientRef = useRef(null);
  const pendingTokenResolveRef = useRef<((token: string | null) => void) | null>(null);
  const isInitialLoad = useRef(true);
  // STOCK 파일(종목별 과거 종가) 하이드레이션 완료 플래그.
  // ⚠️ 이 플래그가 false인 동안에는 STOCK 파일을 **절대 쓰지 않는다**.
  //    STOCK 저장은 in-memory 맵으로 파일 전체를 교체하므로(saveAllToDrive의 STOCK 분기),
  //    Drive 병합 전에 저장이 끼면 이번 세션에 조회된 코드만 든 부분 맵이 전체 캐시를 덮어써
  //    과거 종가가 영구 소실된다(STOCK은 앱 내 백업이 0개 — 버전 백업·수동 최신본 모두
  //    stockHistoryMap이 제거된 stateCore를 저장하므로 복구 경로가 없다).
  //    App.tsx의 isInitialLoad 해제가 loadStockFromDrive보다 먼저 풀리고,
  //    saveAllToDrive를 직접 부르는 지점이 useStockData에만 9곳이라 부팅 순서 교정만으로는 못 막는다.
  const stockHydratedRef = useRef(false);
  // STOCK 로드가 예외로 끝났는가 — 이번 세션은 종전 폴백 경로(빈 맵에서 시작, STOCK 쓰기 보류)로 강등된다.
  const stockLoadFailedRef = useRef(false);
  // 마지막으로 Drive에 올린 stockHistoryMap **객체 참조**. setStockHistoryMap은 매번 새 객체를 만들므로
  // 참조 비교가 곧 정확한 dirty 플래그다 — 같으면 이력이 안 바뀐 것이라 수 MB 업로드를 건너뛴다.
  const lastSavedStockMapRef = useRef<any>(null);
  // STATE가 화면에 적용된 뒤인가(또는 Drive에 STATE가 없음을 확인했는가) — 종료 계열 저장의 게이트.
  // ⚠️ isInitialLoad와 다르다: isInitialLoad는 부팅 전체(시세 갱신·세션 초기화까지)가 끝나야 풀리는데,
  //    오버레이는 STATE 적용 직후 내려가므로 그 사이(시세 타임아웃 최대 10초)에 사용자가 편집하고 탭을
  //    닫으면 isInitialLoad 게이트가 그 편집을 **어디에도 저장하지 않는다**. isInitialLoad의 존재 이유는
  //    "Drive를 읽기 전에 빈 상태를 덮어쓰지 않기"뿐이므로, 종료 저장(pagehide·탭 숨김·비활동 로그아웃)은
  //    이 플래그만 본다. 800ms 자동저장·chartPrefs·알림로그·폴링의 isInitialLoad 게이트는 그대로다.
  const stateAppliedRef = useRef(false);
  const driveSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portfolioUpdatedAtRef = useRef<number>(0);
  const prevPortfolioStructureRef = useRef<string>('');
  const lastDriveSavedPortfolioUpdatedAtRef = useRef<number>(0);
  const lastDriveSavedChartPrefsAtRef = useRef<number>(0);
  const driveCheckInProgressRef = useRef(false);
  const lastDriveCheckAtRef = useRef<number>(0);
  const goldKrAutoCrawledRef = useRef(false);  // 세션 당 한 번만 국내금 자동 크롤링
  const stooqAutoCrawledRef = useRef(false);   // 세션 당 한 번만 stooq 지표 자동 크롤링
  const lastAdminAccessAllowedRef = useRef<boolean | null>(null);
  // 관리자 뷰 전환 중(로드 완료 후 React 렌더 전) 저장 차단 — saveAllToDrive 가드에서 사용
  const adminTransitioningRef = useRef(false);
  // 저장 차단 시 최신 상태를 보관 — 현재 저장 완료 후 즉시 재실행
  const pendingSaveRef = useRef<any>(null);
  // 저장 실패 알림 래치 — 연속 실패 구간당 벨 알림 1건만 남긴다(성공 시 해제).
  // ⚠️ notify()의 5초 텍스트 dedup으로는 누적을 못 막는다. 저장 트리거는 사용자 조작마다
  //    800ms 디바운스로 발화하므로, Drive가 지속 실패하면 동일 오류가 벨 이력(상한 200건,
  //    Drive 영속)을 밀어내 **관리자 공지·자료 등록 이력이 영구 소실**된다(자료 공지는 벨
  //    이력을 클릭해야 열리므로 이력 소실 = 자료 접근 수단 소실). console.error는 매번 남긴다.
  const saveFailNotifiedRef = useRef(false);
  // 세션 관리 — 단일 기기 강제 로그아웃
  const sessionIdRef = useRef('');           // 이 기기의 세션 ID
  const ownFolderIdRef = useRef('');         // 관리자가 타인 페이지 볼 때도 자신의 폴더 ID 유지

  // ── Drive 폴더 ID 캐시 확보 ──
  const ensureDriveFolder = async (token: string): Promise<string> => {
    if (driveFolderIdRef.current) return driveFolderIdRef.current;
    const email = authUser?.email;
    if (!email) throw new Error('[Drive] 이메일 없음 — 로그인 상태를 확인하세요');
    const id = await getOrCreateIndexFolder(token, email);
    driveFolderIdRef.current = id;
    return id;
  };

  // ── 세션 초기화 — 로그인 직후 1회 호출, Drive에 세션 파일 기록 ──
  // 다른 기기에서 새로 로그인하면 세션 파일이 덮어써져 기존 기기가 자동 로그아웃됨
  const initSession = async () => {
    try {
      const token = driveTokenRef.current;
      const folderId = driveFolderIdRef.current;
      if (!token || !folderId) return;
      ownFolderIdRef.current = folderId;
      const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const loginAt = Date.now();
      sessionIdRef.current = sid;
      sessionStorage.setItem('appSessionId', sid);
      sessionStorage.setItem('appSessionLoginAt', String(loginAt));
      await saveDriveFile(token, folderId, DRIVE_FILES.SESSION, {
        sessionId: sid,
        loginAt,
        lastSeen: loginAt,
        device: navigator.userAgent.slice(0, 120),
      });
    } catch {}
  };

  // ── Drive에서 데이터 불러오기 → applyStateData 콜백으로 state 적용 ──
  // updateAccessLog=true: 사용자 최초 로그인 시에만 전달 — accessLog 카운트 증가 후 Drive 즉시 반영
  // isRetry=true: 401 재시도 호출 — 무한 루프 방지용
  const loadFromDrive = async (token: string, updateAccessLog = false, isRetry = false) => {
    try {
      setSS('loading');
      setDriveStatus('loading');
      const folderId = await ensureDriveFolder(token);

      // 로그인 시 항상 관리자 폴더 접근 권한 부여 — 신규 사용자(stateData 없음)도 포함
      if (!adminViewingAsRef.current) {
        grantAdminReadAccess(token, folderId, ADMIN_EMAIL).then(ok => {
          if (!ok) console.warn('[Drive] 관리자 폴더 접근 권한 미부여 — scope 또는 도메인 공유 정책 확인 필요');
        });
      }

      // ── STATE+MARKET+STOCK을 **한 번에** 로드한다(STOCK-first) ──
      // ⚠️ STOCK을 STATE 뒤에 따로 받던 옛 순서는 첫 렌더의 stockHistoryMap이 {}라 과거 평가액이
      //    저장값 폴백 → 코드별 병합마다 중간값 → 최종값으로 여러 번 바뀌었다(부팅 중 흔들림의 원인).
      //    STOCK을 함께 적용하면 첫 렌더부터 최종값이다. allSettled인 이유: STOCK 실패가 STATE 적용을
      //    막으면 안 된다(강등 경로 = 옛 동작). 대기 상한은 STOCK_HYDRATE_WAIT_MS.
      const stockLoad = loadDriveFile(token, folderId, DRIVE_FILES.STOCK);
      const [stateRes, marketRes, stockRes] = await Promise.allSettled([
        loadDriveFile(token, folderId, DRIVE_FILES.STATE),
        loadDriveFile(token, folderId, DRIVE_FILES.MARKET),
        Promise.race([stockLoad, new Promise(res => setTimeout(() => res(STOCK_TIMED_OUT), STOCK_HYDRATE_WAIT_MS))]),
      ]);
      if (stateRes.status === 'rejected') throw stateRes.reason;
      // MARKET은 종전 규약(로드 실패 = 오류 상태) 유지 — MARKET 저장에는 dirty 가드가 없어, 못 읽은 채로
      // 진행하면 첫 저장이 빈 indicatorHistoryMap으로 파일을 덮어 금현물·환율 이력이 소실된다.
      if (marketRes.status === 'rejected') throw marketRes.reason;
      const stateData = stateRes.value as any;
      const marketData = marketRes.value;

      // ── STOCK 하이드레이션은 applyStateData보다 **앞**, 같은 동기 블록(사이에 await 금지) ──
      // 두 setState가 한 렌더로 배치돼야 첫 페인트에 과거 종가가 실린다.
      if (stockRes.status === 'fulfilled' && stockRes.value !== STOCK_TIMED_OUT) {
        const driveMap = (stockRes.value as any)?.stockHistoryMap;
        const hasMap = !!driveMap && typeof driveMap === 'object';
        if (hasMap) applyStockData(driveMap);
        // 하이드레이션 완료 표시는 파일 유무와 무관 — '파일 없음'(신규 사용자)도 Drive 상태를 확인한 것이라
        // 첫 종가 캐시가 만들어질 수 있어야 한다. 방금 받은 맵은 '이미 Drive에 있는 것'이라 dirty가 아니다
        // (applyStockData가 메모리가 비어 있으면 같은 참조를 채택한다 — 참조 비교 dirty와 짝).
        stockHydratedRef.current = true;
        lastSavedStockMapRef.current = hasMap ? driveMap : null;
      } else if (stockRes.status === 'rejected') {
        stockLoadFailedRef.current = true;
        console.warn('[Drive] STOCK 로드 실패 — 이번 세션 STOCK 저장 보류(옛 폴백 경로):', stockRes.reason);
      } else {
        // 상한 초과: STATE만 먼저 적용하고 STOCK은 도착하는 즉시 1회 하이드레이션(Drive 베이스 + 메모리 우선 병합).
        stockLoad.then((d: any) => {
          const driveMap = d?.stockHistoryMap;
          if (driveMap && typeof driveMap === 'object') applyStockData(driveMap);
          stockHydratedRef.current = true;
        }).catch((err) => {
          stockLoadFailedRef.current = true;
          console.warn('[Drive] STOCK 지연 로드 실패 — 이번 세션 STOCK 저장 보류:', err);
        });
      }

      if (!stateData) {
        // Drive에 STATE가 없음을 확인 — 신규 사용자. 덮어쓸 기존 상태가 없으므로 종료 저장을 열어 둔다.
        stateAppliedRef.current = true;
        setSS('ready'); setDriveStatus(''); return null;
      }

      let stateToApply = stateData as any;
      if (updateAccessLog) {
        const now = Date.now();
        const prev = (stateData as any).accessLog;
        const updatedLog = {
          count: (prev?.count || 0) + 1,
          firstAt: prev?.firstAt || now,
          lastAt: now,
        };
        stateToApply = { ...(stateData as any), accessLog: updatedLog };
        // STATE 파일에 즉시 반영 (fire-and-forget) — 미저장 시 다음 saveAllToDrive에서 처리됨
        saveDriveFile(token, folderId, DRIVE_FILES.STATE, _stripStateForSave(stateToApply)).catch(() => {});
        lastDriveSavedPortfolioUpdatedAtRef.current = (stateData as any).portfolioUpdatedAt || 0;
      }

      applyStateData(stateToApply, null, marketData);
      stateAppliedRef.current = true;
      // 로드한 portfolioUpdatedAt/chartPrefsUpdatedAt을 ref에 동기화 — 초기 로드 시 useEffect가 새
      // 타임스탬프를 만들어 lastDriveSaved*보다 커지는 것을 방지 (의도치 않은 자동 저장 억제)
      portfolioUpdatedAtRef.current = (stateToApply as any).portfolioUpdatedAt || 0;
      lastDriveSavedChartPrefsAtRef.current = (stateToApply as any).chartPrefsUpdatedAt || 0;
      setSS('ready');
      setDriveStatus('saved');

      // 방안 A: 수동 저장본과 현재 상태 비교 — 불일치 시 경고 (fire-and-forget)
      const stateTs = (stateToApply as any).portfolioUpdatedAt || 0;
      getManualLatestEntry(token, folderId).then(entry => {
        if (!entry) return;
        const manualTs = new Date(entry.createdTime).getTime();
        if (manualTs > stateTs) {
          const mLabel = entry.name.match(/portfolio_backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
          const displayLabel = mLabel ? `${mLabel[1]}-${mLabel[2]}-${mLabel[3]} ${mLabel[4]}:${mLabel[5]}` : entry.name;
          notify(`수동 저장본(${displayLabel})이 현재 데이터보다 최신입니다 — 백업 목록에서 복원 가능`, 'warning');
        }
      }).catch(() => {});

      lastAdminAccessAllowedRef.current = stateData.adminAccessAllowed !== false;
      return stateData.portfolios?.[0]?.portfolio || stateData.portfolio || [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Drive 불러오기 실패:', msg);
      // 401: 토큰 만료 → 무음 갱신 후 1회 재시도 (팝업 없이, 무한 루프 방지)
      if (msg.includes('401') && !isRetry && tokenClientRef.current) {
        const newToken = await new Promise<string | null>((resolve) => {
          pendingTokenResolveRef.current = resolve;
          tokenClientRef.current.requestAccessToken({ prompt: '' });
        });
        if (newToken) {
          driveTokenRef.current = newToken;
          setDriveToken(newToken);
          return loadFromDrive(newToken, updateAccessLog, true);
        }
      }
      setSS('error');
      if (msg.includes('FOLDER_NOT_FOUND_FOR_KNOWN_USER')) {
        notify('Drive 데이터 폴더를 찾을 수 없습니다. Google Drive 휴지통을 확인하거나 관리자에게 문의하세요.', 'error');
        setDriveStatus('error');
      } else if (msg.includes('401')) {
        console.warn('[Drive] 토큰 갱신 실패 → 재로그인 필요');
        setDriveStatus('auth_needed');
      } else if (msg.includes('403')) {
        console.warn('[Drive] 403 Forbidden: Google Cloud Console에서 drive.file 권한 또는 테스트 사용자 설정 확인 필요');
        setDriveStatus('error');
      } else {
        setDriveStatus('error');
      }
      return null;
    }
  };

  // ── Drive에 3개 파일로 저장 ──
  // versioned: 'manual'=수동 저장, 'auto'=자동 저장, false=백업 이력 불필요한 저장
  // isRetry: true면 실패 시 재시도·토스트 없이 조용히 종료
  const saveAllToDrive = async (state, versioned: false | 'manual' | 'auto' = false, isRetry = false) => {
    // LOADING·SAVING 중에는 저장 차단 — 초기 Drive 로드 / 동시 저장 경쟁 방지
    // 차단 시 최신 상태를 pendingSaveRef에 보관 → 현재 저장 완료 후 즉시 재실행
    if (syncStatusRef.current === 'loading' || syncStatusRef.current === 'saving') {
      if (syncStatusRef.current === 'saving') pendingSaveRef.current = saveStateRef.current ?? state;
      return;
    }
    // 전환 중 — 관리자↔사용자 데이터 교체 중 저장 차단 (편집 모드 자체는 저장 허용)
    if (adminTransitioningRef.current) return;
    const token = driveTokenRef.current;
    if (!token) { setDriveStatus('auth_needed'); return; }
    const isAdminEdit = !!adminViewingAsRef.current;
    // 백업(버전 이력·수동 최신본)을 이미 한 번 냈는지 — 재시도에서 중복 생성을 막는다.
    // ⚠️ 백업은 STOCK/MARKET 저장보다 **앞**이라, MARKET만 실패해 재시도하면 같은 저장에 대해
    //    백업이 2본 쌓이고 상한(auto 6·manual 10) 때문에 오래된 백업이 밀려난다. 반대로 STATE
    //    저장 자체가 실패한 경우엔 백업에 도달하지 못했으므로 재시도에서 versioned를 살려야
    //    수동 저장이 백업 없이 끝나지 않는다 → 무조건 false가 아니라 이 플래그로 분기한다.
    let backupDone = false;
    try {
      setSS('saving');
      setDriveStatus('saving');
      const folderId = await ensureDriveFolder(token);
      const { stockHistoryMap: shm, marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm, ...stateCore } = state;
      // STATE: 포트폴리오 구조 변경 또는 차트 설정 변경 시 저장
      // version 파일은 포트폴리오 구조 변경 시에만 갱신 (다기기 sync 트리거 최소화)
      const portfolioChanged = (state.portfolioUpdatedAt || 0) > lastDriveSavedPortfolioUpdatedAtRef.current;
      const chartPrefsChanged = (state.chartPrefsUpdatedAt || 0) > lastDriveSavedChartPrefsAtRef.current;
      if (portfolioChanged || chartPrefsChanged) {
        await saveDriveFile(token, folderId, DRIVE_FILES.STATE, stateCore);
        if (portfolioChanged) {
          await saveVersionFile(token, folderId, state.portfolioUpdatedAt || 0);
          lastDriveSavedPortfolioUpdatedAtRef.current = state.portfolioUpdatedAt || 0;
        }
        lastDriveSavedChartPrefsAtRef.current = state.chartPrefsUpdatedAt || 0;
      }
      // adminAccessAllowed 변경 감지 — 항상 권한 부여 (관리자는 항상 접속 가능)
      if (!isAdminEdit) {
        const currAllowed = state.adminAccessAllowed !== false;
        if (lastAdminAccessAllowedRef.current !== currAllowed) {
          lastAdminAccessAllowedRef.current = currAllowed;
          grantAdminReadAccess(token, folderId, ADMIN_EMAIL).then(ok => {
            if (!ok) console.warn('[Drive] 관리자 폴더 접근 권한 미부여 — scope 또는 도메인 공유 정책 확인 필요');
          });
        }
      }
      if (versioned) {
        saveVersionedBackup(token, folderId, stateCore, versioned).catch(() => {});
      }
      if (versioned === 'manual') {
        saveDriveFile(token, folderId, DRIVE_FILES.MANUAL_LATEST, { ...stateCore, manualSavedAt: Date.now() }).catch(() => {});
      }
      backupDone = true;
      await Promise.all([
        // ⚠️ stockHydratedRef 가드를 제거하지 말 것 — Drive 병합 전 부분 맵이 전체 캐시를 truncate한다.
        //    가드는 반드시 여기(saveAllToDrive 본문)에 둔다. 호출부(useStockData 9곳 등)에 나눠 달면 누락된다.
        // ⚠️ 참조 비교 dirty: 하이드레이션 뒤에도 이력이 안 바뀐 저장(원금 수정·메모 등)이 수 MB STOCK을
        //    통째로 재업로드하던 것을 막는다. 가드 순서는 hydrated가 **앞**(부분 맵 truncate 방어가 1순위).
        Object.keys(shm || {}).length > 0 && stockHydratedRef.current && shm !== lastSavedStockMapRef.current
          ? saveDriveFile(token, folderId, DRIVE_FILES.STOCK, { stockHistoryMap: shm }).then(() => { lastSavedStockMapRef.current = shm; })
          : Promise.resolve(),
        saveDriveFile(token, folderId, DRIVE_FILES.MARKET, { marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm }),
      ]);
      setSS('ready');
      setDriveStatus('saved');
      saveFailNotifiedRef.current = false;   // 실패 스트릭 종료 → 다음 실패는 다시 1건 알린다
      // 저장 중 차단된 최신 상태가 있으면 즉시 재실행
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        saveAllToDrive(pending);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Drive 저장 실패:', err);
      // 401: 토큰 만료 → 무음 갱신 후 1회 재시도 (팝업 없이, 무한 루프 방지)
      if (msg.includes('401') && !isRetry && tokenClientRef.current) {
        const newToken = await new Promise<string | null>((resolve) => {
          pendingTokenResolveRef.current = resolve;
          tokenClientRef.current.requestAccessToken({ prompt: '' });
        });
        if (newToken) {
          driveTokenRef.current = newToken;
          setDriveToken(newToken);
          setSS('ready');
          // ⚠️ 캡처된 state가 아니라 **실행 시점의 최신 스냅샷**으로 재시도할 것.
          //    STOCK 저장 가드(stockHydratedRef)는 실행 시점을 보는데 payload만 옛 것이면,
          //    부팅 창에서 실패했을 때 하이드레이션 전 부분 맵이 STOCK 전체를 덮어쓴다
          //    (STOCK은 백업 0본 → 복구 불가). pendingSaveRef가 이미 같은 패턴을 쓴다.
          return saveAllToDrive(saveStateRef.current ?? state, backupDone ? false : versioned, true);
        }
        // 갱신 실패(세션 만료·권한 거부) → auth_needed 유지, 재시도 무의미
        setSS('error');
        setDriveStatus('auth_needed');
        notify('Drive 인증이 만료되었습니다. 헤더의 Drive 아이콘을 눌러 다시 연결해 주세요.', 'warning');
        return;
      }
      setSS('error');
      if (msg.includes('FOLDER_NOT_FOUND_FOR_KNOWN_USER')) {
        notify('Drive 데이터 폴더를 찾을 수 없습니다. Google Drive 휴지통을 확인하거나 관리자에게 문의하세요.', 'error');
        setDriveStatus('error');
        return;
      }
      setDriveStatus('error');
      if (!isRetry) {
        // 연속 실패 구간당 1건만 — 상세는 위 console.error가 매번 남긴다(래치 근거는 선언부 주석).
        if (!saveFailNotifiedRef.current) {
          saveFailNotifiedRef.current = true;
          notify('Drive 저장에 실패했습니다. 잠시 후 재시도합니다...', 'error');
        }
        // Fix 3: 실패 시점의 컨텍스트 캡처 — 15초 후 사용자 전환이 일어났으면 재시도 취소
        const retryViewingAs = adminViewingAsRef.current;
        const retryFolderId = driveFolderIdRef.current;
        setTimeout(() => {
          // 전환 중이거나 대상 폴더/사용자가 바뀌었으면 재시도 취소 — 잘못된 폴더에 저장 방지
          if (adminTransitioningRef.current) return;
          if (adminViewingAsRef.current !== retryViewingAs) return;
          if (driveFolderIdRef.current !== retryFolderId) return;
          // ⚠️ 캡처된 state가 아니라 실행 시점의 최신 스냅샷으로 — 근거는 위 401 재시도 주석.
          saveAllToDrive(saveStateRef.current ?? state, backupDone ? false : versioned, true);
        }, 15000);
      }
    }
  };

  // ── STOCK 파일만 백그라운드 로드 (비차단) ──
  const loadStockFromDrive = async (token: string) => {
    try {
      const folderId = await ensureDriveFolder(token);
      const stockData = await loadDriveFile(token, folderId, DRIVE_FILES.STOCK);
      if (stockData?.stockHistoryMap) {
        applyStockData(stockData.stockHistoryMap);
      }
      // ⚠️ 하이드레이션 완료 표시는 if 블록 **밖**이다 — loadDriveFile은 '파일 없음'만 null을 반환하고
      //    401/5xx/네트워크 오류는 throw하므로, 여기 도달했다는 것은 "Drive 상태를 확인했다"는 뜻이다.
      //    신규 사용자(파일 없음)도 저장이 허용돼야 첫 종가 캐시가 만들어진다.
      //    반대로 예외로 catch에 빠지면 플래그는 false로 남아 이번 세션 STOCK 쓰기가 통째로 보류된다
      //    (그 세션에 받은 종가는 다음 세션에 다시 조회되므로 손실이 아니다 — 캐시 파괴보다 안전).
      stockHydratedRef.current = true;
    } catch (err) {
      console.warn('[Drive] STOCK 백그라운드 로드 실패 — 이번 세션 STOCK 저장 보류:', err);
    }
  };

  // ── OAuth 토큰 요청 ──
  const requestDriveToken = (prompt = '') => {
    if (!tokenClientRef.current) return;
    tokenClientRef.current.requestAccessToken({ prompt });
  };

  // ── GIS 토큰 클라이언트 초기화 (authUser 변경 시 App.tsx에서 호출) ──
  const initTokenClient = () => {
    if ((window as any).google?.accounts?.oauth2) {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
        callback: (resp: any) => {
          const t: string | null = resp.error ? null : resp.access_token;
          if (t) {
            if (adminViewingAsRef.current) {
              // 관리자가 타인 계정 열람 중 토큰 갱신 — driveTokenRef(사용자용 readonly 토큰)를 덮어쓰지 않고
              // 관리자 자신의 쓰기 토큰 ref만 업데이트하여 복귀 시 유효한 토큰 사용
              adminOwnDriveTokenRef.current = t;
            } else {
              driveTokenRef.current = t;
              setDriveToken(t);
              if (syncStatusRef.current !== 'loading') setSS('ready');
              setDriveStatus('');
            }
          } else {
            setSS('error');
            setDriveStatus('auth_needed');
          }
          if (pendingTokenResolveRef.current) {
            pendingTokenResolveRef.current(t);
            pendingTokenResolveRef.current = null;
          }
        },
      });
      tokenClientRef.current = client;
    }
  };

  // ── Drive version 파일 확인 → 최신이면 전체 STATE 로드 ──
  const checkAndSyncFromDrive = async () => {
    if (!driveTokenRef.current || isInitialLoad.current) return;
    if (syncStatusRef.current === 'saving') return;
    if (adminTransitioningRef.current) return;
    if (driveCheckInProgressRef.current) return;
    driveCheckInProgressRef.current = true;
    lastDriveCheckAtRef.current = Date.now();
    try {
      // ── 세션 유효성 검증 — 자신의 폴더/토큰으로 확인 (타인 열람 중에도 동작)
      const sessionToken = adminViewingAsRef.current ? adminOwnDriveTokenRef.current : driveTokenRef.current;
      const sessionFolderId = ownFolderIdRef.current || driveFolderIdRef.current;
      if (sessionToken && sessionFolderId && sessionIdRef.current) {
        try {
          const sessionData = await loadDriveFile(sessionToken, sessionFolderId, DRIVE_FILES.SESSION) as any;
          if (sessionData?.sessionId && sessionData.sessionId !== sessionIdRef.current) {
            notify('다른 기기에서 로그인이 감지됩니다. 3초 후 자동 로그아웃됩니다.', 'warning');
            setTimeout(() => onForceLogout(), 3000);
            return;
          }
        } catch {} // 세션 파일 없음(구버전) 또는 네트워크 오류 → 무시
      }

      // ── 관리자가 타인 데이터 편집 중이면 자신의 데이터 폴링 건너뜀
      if (adminViewingAsRef.current) return;

      // ── 버전 파일로 Drive 최신 여부 확인
      const folderId = await ensureDriveFolder(driveTokenRef.current);
      const driveTs = await loadVersionTimestamp(driveTokenRef.current, folderId);
      if (driveTs !== null && driveTs > portfolioUpdatedAtRef.current) {
        if (syncStatusRef.current === 'saving') return;
        await loadFromDrive(driveTokenRef.current);
        loadStockFromDrive(driveTokenRef.current);
      }
    } catch {
      // 오프라인·토큰 만료 등 조용히 무시
    } finally {
      driveCheckInProgressRef.current = false;
    }
  };

  // ── Drive 수동 불러오기 버튼 핸들러 ──
  const handleDriveLoadOnly = async () => {
    if (GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
      notify('config.ts에 Google Client ID를 설정해 주세요', 'error');
      return;
    }
    let token = driveTokenRef.current;
    if (!token) {
      if (!tokenClientRef.current) {
        notify('Drive 클라이언트 초기화 실패. 페이지를 새로고침해 주세요.', 'error');
        return;
      }
      token = await new Promise<string | null>((resolve) => {
        pendingTokenResolveRef.current = resolve;
        tokenClientRef.current.requestAccessToken({ prompt: 'select_account' });
      });
    }
    if (!token) {
      notify('Drive 로그인이 취소되었거나 실패했습니다.', 'warning');
      return;
    }
    const result = await loadFromDrive(token);
    if (result === null) {
      notify('Drive에서 데이터를 불러오지 못했습니다.', 'error');
    }
  };

  // ── 백업 목록 모달 열기 ──
  const handleOpenBackupModal = async () => {
    const token = driveTokenRef.current;
    if (!token) { notify('Drive 연결 필요 — 먼저 Drive를 연결해 주세요', 'warning'); return; }
    setShowBackupModal(true);
    setBackupListLoading(true);
    try {
      const folderId = await ensureDriveFolder(token);
      const [backups, manualLatest] = await Promise.all([
        listBackups(token, folderId),
        getManualLatestEntry(token, folderId),
      ]);
      // 수동 저장본을 목록 맨 위에 별도 항목으로 추가 (중복 방지: 동일 id 제거)
      if (manualLatest) {
        const manualTimeKey = manualLatest.name.match(/portfolio_backup_(\d{8}_\d{4})/)?.[1];
        const filtered = backups.filter(b => {
          if (b.id === manualLatest.id) return false;
          if (manualTimeKey) {
            const bKey = b.name.match(/portfolio_backup_(\d{8}_\d{4})/)?.[1];
            if (bKey === manualTimeKey) return false;
          }
          return true;
        });
        setBackupList([manualLatest, ...filtered]);
      } else {
        setBackupList(backups);
      }
    } catch {
      notify('백업 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setBackupListLoading(false);
    }
  };

  // ── 로컬 파일(portfolio_state.json)에서 상태 복원 ──
  const handleImportStateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Drive 토큰 없으면 복원 불가 — 재로그인 유도
    if (!driveTokenRef.current) {
      notify('Drive에 연결된 상태에서만 파일 복원이 가능합니다. 잠시 후 다시 시도해 주세요.', 'error');
      return;
    }
    if (!await confirm(`"${file.name}" 파일의 데이터를 현재 계좌에 적용하시겠습니까?\n(현재 계좌·종목 구성이 파일의 내용으로 교체됩니다)`)) return;
    setSS('loading');
    setDriveStatus('loading');
    try {
      const text = await file.text();
      const stateData = JSON.parse(text);
      if (!stateData?.portfolios?.length && !stateData?.portfolio) throw new Error('invalid');
      // React 상태 적용
      lastDriveSavedPortfolioUpdatedAtRef.current = 0;
      applyBackupData(stateData, accountChartStatesRef);
      const { stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, ...stateCore } = stateData;
      const normalizedPortfolios = stateCore.portfolios?.map((p: any) => ({
        ...p,
        startDate: p.portfolioStartDate || p.startDate || '',
        portfolioStartDate: p.portfolioStartDate || p.startDate || '',
      }));
      const newUpdatedAt = Date.now();
      // Drive에 직접 저장 — 토큰이 있어야 이 라인에 도달하므로 if 조건 불필요
      const folderId = await ensureDriveFolder(driveTokenRef.current);
      await saveDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.STATE, {
        ...stateCore,
        portfolios: normalizedPortfolios ?? stateCore.portfolios,
        ..._preserveStickyPersonalData(stateCore, saveStateRef.current),
        portfolioUpdatedAt: newUpdatedAt,
      });
      await saveVersionFile(driveTokenRef.current, folderId, newUpdatedAt);
      lastDriveSavedPortfolioUpdatedAtRef.current = newUpdatedAt;
      portfolioUpdatedAtRef.current = newUpdatedAt;
      setSS('ready');
      setDriveStatus('saved');
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg === 'invalid') {
        notify('올바른 portfolio_state.json 파일이 아닙니다.', 'error');
      } else {
        notify('파일 복원 또는 Drive 저장에 실패했습니다. Drive 연결을 확인하고 다시 시도해 주세요.', 'error');
        console.error('[handleImportStateFile] 실패:', msg);
      }
      setSS('error');
      setDriveStatus('error');
    }
  };

  // ── 백업 적용 → applyBackupData 콜백으로 state 적용 ──
  const handleApplyBackup = async (fileId: string, displayTime: string) => {
    if (!await confirm(`"${displayTime}" 시점의 백업을 현재 데이터에 적용하시겠습니까?\n(현재 계좌·종목 구성이 백업 시점으로 교체됩니다)`)) return;
    setApplyingBackupId(fileId);
    setSS('loading');
    setDriveStatus('loading');
    // applyBackupData(로컬 교체)가 Drive write보다 **먼저**라, write만 실패하면 화면은 이미
    // 백업 시점으로 바뀐 뒤다. 그때 "적용에 실패했습니다"는 거짓이므로 문구를 갈라 쓴다.
    let appliedLocally = false;
    try {
      const stateData = await loadBackupById(driveTokenRef.current, fileId) as any;
      if (!stateData) throw new Error('empty');
      // 2초 디바운스 타이머의 Drive 저장 guard를 초기화 → 백업 적용 후 반드시 Drive에 저장되도록 보장
      lastDriveSavedPortfolioUpdatedAtRef.current = 0;
      applyBackupData(stateData, accountChartStatesRef);
      appliedLocally = true;
      // Drive STATE에 백업 내용 즉시 반영
      const { stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, ...stateCore } = stateData;
      // portfolioStartDate가 ''인 백업도 정규화하여 Drive STATE에 항상 올바른 값 저장
      const normalizedPortfolios = stateCore.portfolios?.map((p: any) => ({
        ...p,
        startDate: p.portfolioStartDate || p.startDate || '',
        portfolioStartDate: p.portfolioStartDate || p.startDate || '',
      }));
      const newUpdatedAt = Date.now();
      const folderId = await ensureDriveFolder(driveTokenRef.current);
      await saveDriveFile(driveTokenRef.current, folderId, DRIVE_FILES.STATE, {
        ...stateCore,
        portfolios: normalizedPortfolios ?? stateCore.portfolios,
        ..._preserveStickyPersonalData(stateCore, saveStateRef.current),
        portfolioUpdatedAt: newUpdatedAt,
      });
      await saveVersionFile(driveTokenRef.current, folderId, newUpdatedAt);
      lastDriveSavedPortfolioUpdatedAtRef.current = newUpdatedAt;
      portfolioUpdatedAtRef.current = newUpdatedAt;
      setSS('ready');
      setDriveStatus('saved');
      setShowBackupModal(false);
    } catch (err) {
      console.error('[handleApplyBackup] 실패:', err);
      notify(
        appliedLocally
          ? '백업이 화면에는 적용됐지만 Drive 저장에 실패했습니다. 새로고침하면 되돌아가니 Drive 연결을 확인하고 다시 저장해 주세요.'
          : '백업 적용에 실패했습니다.',
        'error'
      );
      setSS('error');
      setDriveStatus('error');
    } finally {
      setApplyingBackupId(null);
    }
  };

  // 종료 계열 저장용 스냅샷 — saveStateRef를 읽기 **직전에** beforeExitSnapshotRef를 동기 호출해
  // 그 반환값(부분 state)을 병합한다. 브라우저 X·새로고침·로그아웃·비활동 로그아웃이 모두 여기로
  // 수렴하므로, 언로드 직전 커밋이 필요한 기능(리밸런싱 목표비중 기록)은 이 한 곳만 타면 된다.
  // ⚠️ 훅 미제공이면 기존 동작과 100% 동일(saveStateRef.current 그대로).
  const snapForExit = () => {
    let extra = null;
    try { extra = beforeExitSnapshotRef?.current?.() ?? null; } catch { extra = null; }
    const base = saveStateRef.current;
    return extra ? { ...base, ...extra } : base;
  };

  // ── 탭 활성화 시 Drive 동기화, 숨김 시 즉시 저장 ──
  // ⚠️ 종료 계열 저장(탭 숨김·pagehide·비활동 로그아웃)의 게이트는 isInitialLoad가 아니라 stateAppliedRef다
  //    (선언부 주석 참조 — 오버레이 조기 해제가 만든 유실 창을 막는다).
  useEffect(() => {
    if (!authUser) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const snap = snapForExit();
        if (snap && snap.portfolios?.length > 0 && driveTokenRef.current && stateAppliedRef.current) {
          if (driveSaveTimerRef.current) clearTimeout(driveSaveTimerRef.current);
          saveAllToDrive(snap);
        }
        return;
      }
      checkAndSyncFromDrive();
    };
    const handlePageHide = () => {
      if (adminViewingAsRef.current || adminTransitioningRef.current) return;
      const snap = snapForExit();
      if (!snap || !snap.portfolios?.length || !driveTokenRef.current || !stateAppliedRef.current) return;
      saveAllToDrive(snap);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [authUser]);

  // ── 10분마다 Drive version 파일 polling ──
  useEffect(() => {
    if (!authUser) return;
    const POLL_INTERVAL = 10 * 60 * 1000;
    const intervalId = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastDriveCheckAtRef.current < 9 * 60 * 1000) return;
      checkAndSyncFromDrive();
    }, POLL_INTERVAL);
    return () => clearInterval(intervalId);
  }, [authUser]);

  // ── 3분마다 세션 파일 lastSeen 갱신 (하트비트) ──
  // 다른 디바이스·AdminPage에서 "접속 중" 여부 판별에 사용
  useEffect(() => {
    if (!authUser) return;
    const HEARTBEAT = 3 * 60 * 1000;
    const timer = setInterval(() => {
      const sid = sessionIdRef.current;
      const folderId = ownFolderIdRef.current;
      const token = adminViewingAsRef.current ? adminOwnDriveTokenRef.current : driveTokenRef.current;
      if (!sid || !folderId || !token) return;
      saveDriveFile(token, folderId, DRIVE_FILES.SESSION, {
        sessionId: sid,
        loginAt: parseInt(sessionStorage.getItem('appSessionLoginAt') || '0', 10),
        lastSeen: Date.now(),
        device: navigator.userAgent.slice(0, 120),
      }).catch(() => {});
    }, HEARTBEAT);
    return () => clearInterval(timer);
  }, [authUser]);

  // ── 비활동 타임아웃: 30초마다 체크, 50분 비활동 시 경고 ──
  useEffect(() => {
    if (!authUser) return;
    const TIMEOUT = 50 * 60 * 1000;
    const id = setInterval(() => {
      if (isInitialLoad.current) return;
      if (inactivityWarningActiveRef.current) return;
      if (Date.now() - lastActivityAtRef.current >= TIMEOUT) {
        inactivityWarningActiveRef.current = true;
        setShowInactivityWarning(true);
      }
    }, 30000);
    return () => {
      clearInterval(id);
      inactivityWarningActiveRef.current = false;
      setShowInactivityWarning(false);
    };
  }, [authUser]);

  const resetActivity = () => {
    lastActivityAtRef.current = Date.now();
  };

  const handleInactivityContinue = () => {
    inactivityWarningActiveRef.current = false;
    setShowInactivityWarning(false);
    lastActivityAtRef.current = Date.now();
  };

  const handleInactivityLogout = async () => {
    inactivityWarningActiveRef.current = false;
    setShowInactivityWarning(false);
    const snap = snapForExit();
    if (snap?.portfolios?.length > 0 && driveTokenRef.current && stateAppliedRef.current) {
      try { await saveAllToDrive(snap); } catch {}
    }
    onForceLogout();
    try { window.close(); } catch {}
  };

  // ── 포트폴리오 구성 변경 시 자동 백업 (메모 포함) ──
  const handleAutoBackupWithMemo = (memo: string) => {
    const token = driveTokenRef.current;
    const folderId = driveFolderIdRef.current;
    if (!token || !folderId || isInitialLoad.current) return;
    setTimeout(async () => {
      try {
        const snap = saveStateRef.current;
        if (!snap?.portfolios?.length) return;
        const { stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, ...stateCore } = snap;
        await saveVersionedBackup(token, folderId, { ...stateCore, changeNote: memo }, 'change');
      } catch {}
    }, 800);
  };

  return {
    // 상태
    driveStatus, setDriveStatus,
    driveToken, setDriveToken,
    showBackupModal, setShowBackupModal,
    backupList, setBackupList,
    backupListLoading, setBackupListLoading,
    applyingBackupId, setApplyingBackupId,
    showInactivityWarning,
    resetActivity,
    handleInactivityContinue,
    handleInactivityLogout,
    // refs (App.tsx auth effect에서 직접 조작)
    driveTokenRef,
    driveFolderIdRef,
    tokenClientRef,
    pendingTokenResolveRef,
    isInitialLoad,
    driveSaveTimerRef,
    portfolioUpdatedAtRef,
    prevPortfolioStructureRef,
    lastDriveSavedPortfolioUpdatedAtRef,
    driveCheckInProgressRef,
    lastDriveCheckAtRef,
    goldKrAutoCrawledRef,
    stooqAutoCrawledRef,
    syncStatusRef,
    adminTransitioningRef,
    ownFolderIdRef,
    stockLoadFailedRef,
    stateAppliedRef,
    // 함수
    ensureDriveFolder,
    loadFromDrive,
    loadStockFromDrive,
    saveAllToDrive,
    requestDriveToken,
    initTokenClient,
    checkAndSyncFromDrive,
    handleDriveLoadOnly,
    handleOpenBackupModal,
    handleApplyBackup,
    handleImportStateFile,
    handleAutoBackupWithMemo,
    initSession,
  };
}
