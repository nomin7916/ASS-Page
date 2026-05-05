// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import {
  DRIVE_FILES, getOrCreateIndexFolder, saveDriveFile, loadDriveFile,
  loadVersionTimestamp, saveVersionFile, saveVersionedBackup,
  listBackups, loadBackupById, DriveBackupEntry,
  grantAdminReadAccess, revokeAdminReadAccess,
} from '../driveStorage';
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
}: UseDriveSyncParams) {
  // ── Drive 상태 ──
  const [driveStatus, setDriveStatus] = useState(''); // '' | 'auth_needed' | 'loading' | 'saving' | 'saved' | 'error'
  const [driveToken, setDriveToken] = useState('');
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupList, setBackupList] = useState<DriveBackupEntry[]>([]);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [applyingBackupId, setApplyingBackupId] = useState<string | null>(null);

  // ── SyncStatus ref (렌더 없이 동기적으로 읽어야 하므로 ref 사용) ──
  const syncStatusRef = useRef<SyncStatus>('idle');
  const setSS = (s: SyncStatus) => { syncStatusRef.current = s; };

  // ── Drive refs ──
  const driveTokenRef = useRef('');
  const driveFolderIdRef = useRef('');
  const tokenClientRef = useRef(null);
  const pendingTokenResolveRef = useRef<((token: string | null) => void) | null>(null);
  const isInitialLoad = useRef(true);
  const driveSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portfolioUpdatedAtRef = useRef<number>(0);
  const prevPortfolioStructureRef = useRef<string>('');
  const lastDriveSavedPortfolioUpdatedAtRef = useRef<number>(0);
  const driveCheckInProgressRef = useRef(false);
  const lastDriveCheckAtRef = useRef<number>(0);
  const goldKrAutoCrawledRef = useRef(false);  // 세션 당 한 번만 국내금 자동 크롤링
  const stooqAutoCrawledRef = useRef(false);   // 세션 당 한 번만 stooq 지표 자동 크롤링
  const lastAdminAccessAllowedRef = useRef<boolean | null>(null);
  // 관리자 뷰 전환 중(로드 완료 후 React 렌더 전) 저장 차단 — saveAllToDrive 가드에서 사용
  const adminTransitioningRef = useRef(false);

  // ── Drive 폴더 ID 캐시 확보 ──
  const ensureDriveFolder = async (token: string): Promise<string> => {
    if (driveFolderIdRef.current) return driveFolderIdRef.current;
    const id = await getOrCreateIndexFolder(token);
    driveFolderIdRef.current = id;
    return id;
  };

  // ── Drive에서 데이터 불러오기 → applyStateData 콜백으로 state 적용 ──
  const loadFromDrive = async (token: string) => {
    try {
      setSS('loading');
      setDriveStatus('loading');
      const folderId = await ensureDriveFolder(token);

      const [stateData, marketData] = await Promise.all([
        loadDriveFile(token, folderId, DRIVE_FILES.STATE),
        loadDriveFile(token, folderId, DRIVE_FILES.MARKET),
      ]);

      if (!stateData) { setSS('ready'); setDriveStatus(''); return null; }

      applyStateData(stateData, null, marketData);
      setSS('ready');
      setDriveStatus('saved');
      // 로그인 시 adminAccessAllowed 상태에 따라 즉시 폴더 공유 적용 (기존 사용자 포함)
      const loadedAllowed = stateData.adminAccessAllowed !== false;
      lastAdminAccessAllowedRef.current = loadedAllowed;
      if (loadedAllowed && !adminViewingAsRef.current) {
        grantAdminReadAccess(token, folderId, ADMIN_EMAIL).catch(() => {});
      }
      return stateData.portfolios?.[0]?.portfolio || stateData.portfolio || [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Drive 불러오기 실패:', msg);
      setSS('error');
      if (msg.includes('401')) {
        console.warn('[Drive] 토큰 만료 또는 Drive 권한 없음 → 재로그인 필요');
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
    if (syncStatusRef.current === 'loading' || syncStatusRef.current === 'saving') return;
    // 관리자 뷰 모드 또는 전환 중 — 타인 계정 데이터가 saveStateRef에 남아있을 수 있으므로 차단
    if (adminViewingAsRef.current || adminTransitioningRef.current) return;
    const token = driveTokenRef.current;
    if (!token) { setDriveStatus('auth_needed'); return; }
    try {
      setSS('saving');
      setDriveStatus('saving');
      if (versioned === 'manual' && !isRetry) notify('☁️ Drive에 저장 중...', 'info');
      const folderId = await ensureDriveFolder(token);
      const { stockHistoryMap: shm, marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm, ...stateCore } = state;
      // STATE는 portfolioUpdatedAt이 실제로 변경됐을 때만 저장
      if ((state.portfolioUpdatedAt || 0) > lastDriveSavedPortfolioUpdatedAtRef.current) {
        await saveDriveFile(token, folderId, DRIVE_FILES.STATE, stateCore);
        await saveVersionFile(token, folderId, state.portfolioUpdatedAt || 0);
        lastDriveSavedPortfolioUpdatedAtRef.current = state.portfolioUpdatedAt || 0;
      }
      // adminAccessAllowed 변경 시 Drive 폴더 공유/해제 — portfolioUpdatedAt과 독립적으로 실행
      const currAllowed = state.adminAccessAllowed !== false;
      if (lastAdminAccessAllowedRef.current !== currAllowed) {
        lastAdminAccessAllowedRef.current = currAllowed;
        if (currAllowed) {
          grantAdminReadAccess(token, folderId, ADMIN_EMAIL).catch(() => {});
        } else {
          revokeAdminReadAccess(token, folderId, ADMIN_EMAIL).catch(() => {});
        }
      }
      if (versioned) {
        saveVersionedBackup(token, folderId, stateCore, versioned).catch(() => {});
      }
      await Promise.all([
        Object.keys(shm || {}).length > 0
          ? saveDriveFile(token, folderId, DRIVE_FILES.STOCK, { stockHistoryMap: shm })
          : Promise.resolve(),
        saveDriveFile(token, folderId, DRIVE_FILES.MARKET, { marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm }),
      ]);
      setSS('ready');
      setDriveStatus('saved');
      if (versioned === 'manual') notify('Drive 저장 완료', 'success');
    } catch (err) {
      console.error('Drive 저장 실패:', err);
      setSS('error');
      setDriveStatus('error');
      if (!isRetry) {
        notify('Drive 저장에 실패했습니다. 잠시 후 재시도합니다...', 'error');
        // 15초 후 1회 재시도
        setTimeout(() => saveAllToDrive(state, versioned, true), 15000);
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
    } catch (err) {
      console.warn('[Drive] STOCK 백그라운드 로드 실패:', err);
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
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
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
    // SAVING 중에는 Drive 로드 차단 — 저장 중인 데이터를 덮어쓰는 경쟁 방지
    if (syncStatusRef.current === 'saving') return;
    if (driveCheckInProgressRef.current) return;
    driveCheckInProgressRef.current = true;
    lastDriveCheckAtRef.current = Date.now();
    try {
      const folderId = await ensureDriveFolder(driveTokenRef.current);
      const driveTs = await loadVersionTimestamp(driveTokenRef.current, folderId);
      if (driveTs !== null && driveTs > portfolioUpdatedAtRef.current) {
        // 로드 직전 SAVING 상태로 바뀌었을 수 있으므로 재확인
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
      notify('Google Drive 로그인 팝업을 확인해 주세요...', 'info');
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
      const backups = await listBackups(token, folderId);
      setBackupList(backups);
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
        portfolioUpdatedAt: newUpdatedAt,
      });
      await saveVersionFile(driveTokenRef.current, folderId, newUpdatedAt);
      lastDriveSavedPortfolioUpdatedAtRef.current = newUpdatedAt;
      portfolioUpdatedAtRef.current = newUpdatedAt;
      setSS('ready');
      setDriveStatus('saved');
      notify('파일에서 데이터를 복원하고 Drive에 저장했습니다.', 'success');
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
    try {
      const stateData = await loadBackupById(driveTokenRef.current, fileId) as any;
      if (!stateData) throw new Error('empty');
      // 2초 디바운스 타이머의 Drive 저장 guard를 초기화 → 백업 적용 후 반드시 Drive에 저장되도록 보장
      lastDriveSavedPortfolioUpdatedAtRef.current = 0;
      applyBackupData(stateData, accountChartStatesRef);
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
        portfolioUpdatedAt: newUpdatedAt,
      });
      await saveVersionFile(driveTokenRef.current, folderId, newUpdatedAt);
      lastDriveSavedPortfolioUpdatedAtRef.current = newUpdatedAt;
      portfolioUpdatedAtRef.current = newUpdatedAt;
      setSS('ready');
      setDriveStatus('saved');
      setShowBackupModal(false);
      notify(`${displayTime} 백업이 적용되었습니다.`, 'success');
    } catch {
      notify('백업 적용에 실패했습니다.', 'error');
      setSS('error');
      setDriveStatus('error');
    } finally {
      setApplyingBackupId(null);
    }
  };

  // ── 탭 활성화 시 Drive 동기화, 숨김 시 즉시 저장 ──
  useEffect(() => {
    if (!authUser) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const snap = saveStateRef.current;
        if (snap && snap.portfolios?.length > 0 && driveTokenRef.current && !isInitialLoad.current) {
          if (driveSaveTimerRef.current) clearTimeout(driveSaveTimerRef.current);
          saveAllToDrive(snap);
        }
        return;
      }
      checkAndSyncFromDrive();
    };
    const handlePageHide = () => {
      if (adminViewingAsRef.current || adminTransitioningRef.current) return;
      const snap = saveStateRef.current;
      if (!snap || !snap.portfolios?.length || !driveTokenRef.current || isInitialLoad.current) return;
      const folderId = driveFolderIdRef.current;
      if (!folderId) return;
      const { stockHistoryMap, marketIndices, marketIndicators, indicatorHistoryMap, ...stateCore } = snap;
      saveVersionedBackup(driveTokenRef.current, folderId, stateCore, 'auto').catch(() => {});
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

  return {
    // 상태
    driveStatus, setDriveStatus,
    driveToken, setDriveToken,
    showBackupModal, setShowBackupModal,
    backupList, setBackupList,
    backupListLoading, setBackupListLoading,
    applyingBackupId, setApplyingBackupId,
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
  };
}
