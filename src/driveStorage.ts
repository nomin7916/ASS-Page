// Google Drive REST API helper — Index_Data_<email> 폴더 기반 저장/불러오기

const FOLDER_NAME_LEGACY = 'Index_Data';
const getFolderName = (email: string) => `Index_Data_${email}`;
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

const BACKUP_PREFIX = 'portfolio_backup_';
export const MAX_BACKUPS = 6;

export interface DriveBackupEntry {
  id: string;
  name: string;
  createdTime: string;
}

export const DRIVE_FILES = {
  STATE:             'portfolio_state.json',
  STOCK:             'portfolio_stockdata.json',
  MARKET:            'portfolio_marketdata.json',
  PIN:               'portfolio_pin.json',
  VERSION:           'portfolio_version.json', // 폴링용 경량 버전 파일 (~50 bytes)
  DIVIDEND_TAX:      'dividend_tax_history.json',
  NOTIFICATION_LOG:  'notification_log.json',  // 알림 이력 (기기 간 공유)
  SESSION:           'portfolio_session.json',  // 세션 관리 (단일 기기 접속 강제)
};

// 동시 호출 중복 방지 — 이메일 기준 캐시 (토큰 교체 시에도 폴더 중복 생성 방지)
let _folderCache: { key: string; promise: Promise<string> } | null = null;

// Index_Data_<email> 폴더 찾기 또는 없으면 생성
// 구 형식(Index_Data) 폴더가 있으면 자동으로 새 이름으로 마이그레이션
export async function getOrCreateIndexFolder(token: string, email: string): Promise<string> {
  const key = email; // 토큰이 바뀌어도 같은 이메일이면 캐시 히트 → 중복 생성 방지
  if (_folderCache?.key === key) return _folderCache.promise;
  const promise = _doGetOrCreateIndexFolder(token, email).catch(err => {
    _folderCache = null;
    throw err;
  });
  _folderCache = { key, promise };
  return promise;
}

async function _doGetOrCreateIndexFolder(token: string, email: string): Promise<string> {
  const newName = getFolderName(email);

  // 1단계: 새 형식 폴더(Index_Data_<email>) 탐색
  const q1 = encodeURIComponent(
    `name='${newName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'me' in owners`
  );
  const res1 = await fetch(
    `${DRIVE_API}/files?q=${q1}&spaces=drive&fields=files(id,createdTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res1.ok) {
    const err = await res1.json().catch(() => ({}));
    throw new Error(`[Drive] 폴더 검색 실패 ${res1.status}: ${err?.error?.message || res1.statusText}`);
  }
  const data1 = await res1.json();
  if (data1.files?.length > 0) return data1.files[0].id;

  // 2단계: 구 형식 폴더(Index_Data) 탐색 → 데이터 있는 폴더를 새 이름으로 마이그레이션
  const q2 = encodeURIComponent(
    `name='${FOLDER_NAME_LEGACY}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'me' in owners`
  );
  const res2 = await fetch(
    `${DRIVE_API}/files?q=${q2}&spaces=drive&fields=files(id,createdTime)&orderBy=createdTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res2.ok) {
    const data2 = await res2.json();
    for (const folder of (data2.files || [])) {
      const sq = encodeURIComponent(`name='portfolio_state.json' and '${folder.id}' in parents and trashed=false`);
      const sr = await fetch(`${DRIVE_API}/files?q=${sq}&spaces=drive&fields=files(id)`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (sr.ok) {
        const sd = await sr.json();
        if (sd.files?.length > 0) {
          const renameRes = await fetch(`${DRIVE_API}/files/${folder.id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName }),
          });
          if (renameRes.ok) {
            console.warn(`[Drive] 폴더 마이그레이션 완료: ${FOLDER_NAME_LEGACY} → ${newName}`);
          } else {
            console.warn(`[Drive] 폴더 이름 변경 실패 (${renameRes.status}). 기존 폴더 계속 사용.`);
          }
          return folder.id;
        }
      }
    }
  }

  // 3단계: 새 폴더 생성
  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: newName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(`[Drive] 폴더 생성 실패 ${createRes.status}: ${err?.error?.message || createRes.statusText}`);
  }
  const created = await createRes.json();
  return created.id;
}

// 폴더에 관리자 편집 권한 부여 (adminAccessAllowed = true 시 호출)
// 기존 reader 권한이 있으면 writer로 업그레이드, 없으면 신규 부여
export async function grantAdminReadAccess(token: string, folderId: string, adminEmail: string): Promise<void> {
  try {
    const res = await fetch(
      `${DRIVE_API}/files/${folderId}/permissions?fields=permissions(id,emailAddress,role)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const existing = data.permissions?.find(
      (p: any) => p.emailAddress?.toLowerCase() === adminEmail.toLowerCase()
    );
    if (existing) {
      if (existing.role === 'writer') return;
      await fetch(`${DRIVE_API}/files/${folderId}/permissions/${existing.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'writer' }),
      });
    } else {
      await fetch(`${DRIVE_API}/files/${folderId}/permissions?sendNotificationEmail=false`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: adminEmail }),
      });
    }
  } catch {}
}

// 폴더에서 관리자 읽기 권한 제거 (adminAccessAllowed = false 시 호출)
export async function revokeAdminReadAccess(token: string, folderId: string, adminEmail: string): Promise<void> {
  try {
    const res = await fetch(
      `${DRIVE_API}/files/${folderId}/permissions?fields=permissions(id,emailAddress)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const perm = data.permissions?.find((p: any) => p.emailAddress?.toLowerCase() === adminEmail.toLowerCase());
    if (!perm) return;
    await fetch(`${DRIVE_API}/files/${folderId}/permissions/${perm.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
}

// 관리자 토큰으로 대상 사용자의 폴더 ID 찾기 — 새 형식(Index_Data_<email>) 우선, 구 형식(Index_Data) 폴백
export async function findUserIndexFolder(adminToken: string, targetEmail: string): Promise<string | null> {
  const searchByName = async (name: string) => {
    const q = encodeURIComponent(
      `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${targetEmail}' in owners`
    );
    const res = await fetch(
      `${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id)`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    if (!res.ok) {
      if (res.status === 401) throw new Error('TOKEN_EXPIRED');
      if (res.status === 403) throw new Error('PERMISSION_DENIED');
      throw new Error(`DRIVE_ERROR_${res.status}`);
    }
    const data = await res.json();
    return data.files?.[0]?.id ?? null;
  };
  return (await searchByName(getFolderName(targetEmail))) ?? (await searchByName(FOLDER_NAME_LEGACY));
}

// 폴더 안에서 파일 ID 찾기
async function findFileId(token: string, folderId: string, fileName: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${fileName}' and '${folderId}' in parents and trashed=false`
  );
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id)&orderBy=modifiedTime desc`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`[Drive] 파일 검색 실패 ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

// JSON 데이터를 Drive 파일로 저장 (기존 파일 있으면 덮어쓰기)
export async function saveDriveFile(
  token: string,
  folderId: string,
  fileName: string,
  data: unknown
): Promise<void> {
  const fileId = await findFileId(token, folderId, fileName);
  const content = JSON.stringify(data);
  const boundary = 'drive_boundary_xyz';

  const makeBody = (parents?: string[]) => {
    const meta = parents
      ? { name: fileName, mimeType: 'application/json', parents }
      : { name: fileName, mimeType: 'application/json' };
    return [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(meta),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');
  };

  if (fileId) {
    await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=multipart`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: makeBody(),
    });
  } else {
    await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: makeBody([folderId]),
    });
  }
}

// Drive 파일에서 JSON 데이터 불러오기
export async function loadDriveFile(
  token: string,
  folderId: string,
  fileName: string
): Promise<unknown | null> {
  const fileId = await findFileId(token, folderId, fileName);
  if (!fileId) return null;
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`[Drive] 파일 읽기 실패 ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  return await res.json();
}

// 폴링 전용: portfolio_version.json에서 portfolioUpdatedAt만 읽기 (파일이 ~50바이트로 매우 가볍다)
export async function loadVersionTimestamp(
  token: string,
  folderId: string
): Promise<number | null> {
  try {
    const data = await loadDriveFile(token, folderId, DRIVE_FILES.VERSION) as any;
    return data?.portfolioUpdatedAt ?? null;
  } catch {
    return null;
  }
}

// 계좌/종목 구조가 변경될 때 portfolioUpdatedAt을 version 파일에 기록
export async function saveVersionFile(
  token: string,
  folderId: string,
  portfolioUpdatedAt: number
): Promise<void> {
  await saveDriveFile(token, folderId, DRIVE_FILES.VERSION, { portfolioUpdatedAt });
}

// 타임스탬프 이름의 백업 파일 저장 후 오래된 것 정리
// type: 'manual' = 수동 저장, 'auto' = 자동 저장
export async function saveVersionedBackup(
  token: string,
  folderId: string,
  data: unknown,
  type: 'manual' | 'auto' = 'auto'
): Promise<void> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  await saveDriveFile(token, folderId, `${BACKUP_PREFIX}${ts}_${type}.json`, data);
  await cleanupOldBackups(token, folderId);
}

// 백업 목록 최신순으로 조회
export async function listBackups(
  token: string,
  folderId: string
): Promise<DriveBackupEntry[]> {
  const q = encodeURIComponent(
    `name contains '${BACKUP_PREFIX}' and '${folderId}' in parents and trashed=false`
  );
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`[Drive] 백업 목록 조회 실패 ${res.status}`);
  const data = await res.json();
  return (data.files || []) as DriveBackupEntry[];
}

// 특정 백업 파일 ID로 데이터 로드
export async function loadBackupById(
  token: string,
  fileId: string
): Promise<unknown | null> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`[Drive] 백업 읽기 실패 ${res.status}`);
  return await res.json();
}

// ── 관리자 전용 폴더 / 캐시 파일 ──
const ADMIN_FOLDER_NAME = 'Index_Data_Admin';
const ADMIN_CACHE_FILE = 'admin_user_cache.json';

export async function getOrCreateAdminFolder(token: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${ADMIN_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`[Drive] 관리자 폴더 검색 실패 ${res.status}`);
  const data = await res.json();
  if (data.files?.length > 0) return data.files[0].id;
  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ADMIN_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!createRes.ok) throw new Error(`[Drive] 관리자 폴더 생성 실패 ${createRes.status}`);
  const created = await createRes.json();
  return created.id;
}

export async function saveAdminUserCache(token: string, folderId: string, data: unknown): Promise<void> {
  await saveDriveFile(token, folderId, ADMIN_CACHE_FILE, data);
}

export async function loadAdminUserCache(token: string, folderId: string): Promise<unknown | null> {
  return loadDriveFile(token, folderId, ADMIN_CACHE_FILE);
}

async function cleanupOldBackups(token: string, folderId: string): Promise<void> {
  try {
    const backups = await listBackups(token, folderId);
    if (backups.length <= MAX_BACKUPS) return;
    await Promise.all(
      backups.slice(MAX_BACKUPS).map(b =>
        fetch(`${DRIVE_API}/files/${b.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    );
  } catch {
    // 정리 실패 무시 — 다음 저장 시 재시도
  }
}
