// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import {
  DRIVE_FILES, getOrCreateIndexFolder, saveDriveFile, loadDriveFile,
  loadVersionTimestamp, saveVersionFile, saveVersionedBackup,
  listBackups, loadBackupById, DriveBackupEntry,
  grantAdminReadAccess, revokeAdminReadAccess,
  getManualLatestEntry,
} from '../driveStorage';

function _stripStateForSave(stateData: any) {
  const { stockHistoryMap: _s, marketIndices: _m, marketIndicators: _mi, indicatorHistoryMap: _ih, ...core } = stateData;
  return core;
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

      const [stateData, marketData] = await Promise.all([
        loadDriveFile(token, folderId, DRIVE_FILES.STATE),
        loadDriveFile(token, folderId, DRIVE_FILES.MARKET),
      ]);
      if (!stateData) { setSS('ready'); setDriveStatus(''); return null; }

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
    try {
      setSS('saving');
      setDriveStatus('saving');
      if (versioned === 'manual' && !isRetry) {
        isAdminEdit
          ? notify(`☁️ ${adminViewingAsRef.current} Drive에 저장 중...`, 'info')
          : notify('☁️ Drive에 저장 중...', 'info');
      }
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
      // adminAccessAllowed 변경 시 Drive 폴더 공유/해제 — 관리자 편집 중에는 건드리지 않음
      if (!isAdminEdit) {
        const currAllowed = state.adminAccessAllowed !== false;
        if (lastAdminAccessAllowedRef.current !== currAllowed) {
          lastAdminAccessAllowedRef.current = currAllowed;
          if (currAllowed) {
            grantAdminReadAccess(token, folderId, ADMIN_EMAIL).catch(() => {});
          } else {
            revokeAdminReadAccess(token, folderId, ADMIN_EMAIL).catch(() => {});
          }
        }
      }
      if (versioned) {
        saveVersionedBackup(token, folderId, stateCore, versioned).catch(() => {});
      }
      if (versioned === 'manual') {
        saveDriveFile(token, folderId, DRIVE_FILES.MANUAL_LATEST, { ...stateCore, manualSavedAt: Date.now() }).catch(() => {});
      }
      await Promise.all([
        Object.keys(shm || {}).length > 0
          ? saveDriveFile(token, folderId, DRIVE_FILES.STOCK, { stockHistoryMap: shm })
          : Promise.resolve(),
        saveDriveFile(token, folderId, DRIVE_FILES.MARKET, { marketIndices: mi, marketIndicators: mInd, indicatorHistoryMap: ihm }),
      ]);
      setSS('ready');
      setDriveStatus('saved');
      if (versioned === 'manual') {
        isAdminEdit
          ? notify(`${adminViewingAsRef.current} Drive에 저장 완료`, 'success')
          : notify('Drive 저장 완료', 'success');
      }
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
          return saveAllToDrive(state, versioned, true);
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
        notify('Drive 저장에 실패했습니다. 잠시 후 재시도합니다...', 'error');
        // Fix 3: 실패 시점의 컨텍스트 캡처 — 15초 후 사용자 전환이 일어났으면 재시도 취소
        const retryViewingAs = adminViewingAsRef.current;
        const retryFolderId = driveFolderIdRef.current;
        setTimeout(() => {
          // 전환 중이거나 대상 폴더/사용자가 바뀌었으면 재시도 취소 — 잘못된 폴더에 저장 방지
          if (adminTransitioningRef.current) return;
          if (adminViewingAsRef.current !== retryViewingAs) return;
          if (driveFolderIdRef.current !== retryFolderId) return;
          saveAllToDrive(state, versioned, true);
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
    const snap = saveStateRef.current;
    if (snap?.portfolios?.length > 0 && driveTokenRef.current && !isInitialLoad.current) {
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
