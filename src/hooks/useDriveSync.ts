// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import {
  DRIVE_FILES, getOrCreateIndexFolder, saveDriveFile, loadDriveFile,
  loadVersionTimestamp, saveVersionFile, saveVersionedBackup,
  listBackups, loadBackupById, DriveBackupEntry,
} from '../driveStorage';
import { GOOGLE_CLIENT_ID } from '../config';

// loadFromDrive / handleApplyBackup 에서 state를 적용하는 콜백 타입
type ApplyStateDataFn = (stateData: any, stockData: any, marketData: any) => void;
type ApplyBackupDataFn = (stateData: any, accountChartStatesRef: React.MutableRefObject<any>) => void;

interface UseDriveSyncParams {
  authUser: { email: string; token: string } | null;
  applyStateData: ApplyStateDataFn;
  applyBackupData: ApplyBackupDataFn;
  accountChartStatesRef: React.MutableRefObject<any>;
  saveStateRef: React.MutableRefObject<any>;
  showToast: (text: string, isError?: boolean) => void;
}

export function useDriveSync({
  authUser,
  applyStateData,
  applyBackupData,
  accountChartStatesRef,
  saveStateRef,
  showToast,
}: UseDriveSyncParams) {
  // ── Drive 상태 ──
  const [driveStatus, setDriveStatus] = useState(''); // '' | 'auth_needed' | 'loading' | 'saving' | 'saved' | 'error'
  const [driveToken, setDriveToken] = useState('');
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupList, setBackupList] = useState<DriveBackupEntry[]>([]);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [applyingBackupId, setApplyingBackupId] = useState<string | null>(null);

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
      setDriveStatus('loading');
      const folderId = await ensureDriveFolder(token);

      const [stateData, stockData, marketData] = await Promise.all([
        loadDriveFile(token, folderId, DRIVE_FILES.STATE),
        loadDriveFile(token, folderId, DRIVE_FILES.STOCK),
        loadDriveFile(token, folderId, DRIVE_FILES.MARKET),
      ]);

      if (!stateData) { setDriveStatus(''); return null; }

      applyStateData(stateData, stockData, marketData);
      setDriveStatus('saved');
      return stateData.portfolios?.[0]?.portfolio || stateData.portfolio || [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Drive 불러오기 실패:', msg);
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
  // versioned: 'manual'=수동 저장, 'auto'=20분 자동저장, false=백업 이력 불필요한 저장
  const saveAllToDrive = async (state, versioned: false | 'manual' | 'auto' = false) => {
    const token = driveTokenRef.current;
    if (!token) { setDriveStatus('auth_needed'); return; }
    try {
      setDriveStatus('saving');
      const folderId = await ensureDriveFolder(token);
      const { stockHistoryMap: shm, marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm, ...stateCore } = state;
      // STATE는 portfolioUpdatedAt이 실제로 변경됐을 때만 저장
      if ((state.portfolioUpdatedAt || 0) > lastDriveSavedPortfolioUpdatedAtRef.current) {
        await saveDriveFile(token, folderId, DRIVE_FILES.STATE, stateCore);
        await saveVersionFile(token, folderId, state.portfolioUpdatedAt || 0);
        lastDriveSavedPortfolioUpdatedAtRef.current = state.portfolioUpdatedAt || 0;
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
      setDriveStatus('saved');
    } catch (err) {
      console.error('Drive 저장 실패:', err);
      setDriveStatus('error');
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
            driveTokenRef.current = t;
            setDriveToken(t);
            setDriveStatus('');
          } else {
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
    if (driveCheckInProgressRef.current) return;
    driveCheckInProgressRef.current = true;
    lastDriveCheckAtRef.current = Date.now();
    try {
      const folderId = await ensureDriveFolder(driveTokenRef.current);
      const driveTs = await loadVersionTimestamp(driveTokenRef.current, folderId);
      if (driveTs !== null && driveTs > portfolioUpdatedAtRef.current) {
        await loadFromDrive(driveTokenRef.current);
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
      showToast('config.ts에 Google Client ID를 설정해 주세요', true);
      return;
    }
    let token = driveTokenRef.current;
    if (!token) {
      if (!tokenClientRef.current) {
        showToast('Drive 클라이언트 초기화 실패. 페이지를 새로고침해 주세요.', true);
        return;
      }
      showToast('Google Drive 로그인 팝업을 확인해 주세요...');
      token = await new Promise<string | null>((resolve) => {
        pendingTokenResolveRef.current = resolve;
        tokenClientRef.current.requestAccessToken({ prompt: 'select_account' });
      });
    }
    if (!token) {
      showToast('Drive 로그인이 취소되었거나 실패했습니다.', true);
      return;
    }
    const result = await loadFromDrive(token);
    if (result === null) {
      showToast('Drive에서 데이터를 불러오지 못했습니다.', true);
    }
  };

  // ── 백업 목록 모달 열기 ──
  const handleOpenBackupModal = async () => {
    const token = driveTokenRef.current;
    if (!token) { showToast('Drive 연결 필요 — 먼저 Drive를 연결해 주세요', true); return; }
    setShowBackupModal(true);
    setBackupListLoading(true);
    try {
      const folderId = await ensureDriveFolder(token);
      const backups = await listBackups(token, folderId);
      setBackupList(backups);
    } catch {
      showToast('백업 목록을 불러오지 못했습니다.', true);
    } finally {
      setBackupListLoading(false);
    }
  };

  // ── 백업 적용 → applyBackupData 콜백으로 state 적용 ──
  const handleApplyBackup = async (fileId: string, displayTime: string) => {
    if (!window.confirm(`"${displayTime}" 시점의 백업을 현재 데이터에 적용하시겠습니까?\n(현재 계좌·종목 구성이 백업 시점으로 교체됩니다)`)) return;
    setApplyingBackupId(fileId);
    setDriveStatus('loading');
    try {
      const stateData = await loadBackupById(driveTokenRef.current, fileId) as any;
      if (!stateData) throw new Error('empty');
      applyBackupData(stateData, accountChartStatesRef);
      setDriveStatus('saved');
      setShowBackupModal(false);
      showToast(`${displayTime} 백업이 적용되었습니다.`);
    } catch {
      showToast('백업 적용에 실패했습니다.', true);
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
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
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
    // 함수
    ensureDriveFolder,
    loadFromDrive,
    saveAllToDrive,
    requestDriveToken,
    initTokenClient,
    checkAndSyncFromDrive,
    handleDriveLoadOnly,
    handleOpenBackupModal,
    handleApplyBackup,
  };
}
