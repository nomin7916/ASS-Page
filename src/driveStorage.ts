// Google Drive REST API helper — Index_Data_<email> 폴더 기반 저장/불러오기

const FOLDER_NAME_LEGACY = 'Index_Data';
const getFolderName = (email: string) => `Index_Data_${email}`;
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

const BACKUP_PREFIX = 'portfolio_backup_';
export const MAX_BACKUPS = 6;
export const MAX_MANUAL_BACKUPS = 10;

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
  SETTINGS:          'app_settings.json',       // 전역 앱 설정 캐시 (youtubeUrl, notebookLinks)
  MANUAL_LATEST:     'portfolio_manual_latest.json', // 마지막 수동 저장본 (항상 최신 유지)
};

// 동시 호출 중복 방지 — 이메일 기준 캐시 (토큰 교체 시에도 폴더 중복 생성 방지)
let _folderCache: { key: string; promise: Promise<string> } | null = null;

// ── 내 드라이브 최상위(루트) 폴더 ID — '저장 위치가 루트로 해석되는 사고'의 유일한 방어선 ──
// ⚠️ 실측 사고(2026-06-09~08-28): 앱이 루트에 portfolio_stockdata.json 1개 + 백업 6개를 썼다.
//    30곳이 넘는 저장 지점이 전부 getOrCreateIndexFolder 하나로 모이므로, 잘못된 folderId가
//    한 번 확정되면 그 탭의 모든 저장이 통째로 그리로 간다(driveFolderIdRef에 박제되고
//    코드 어디에도 초기화가 없다). 게다가 files.update(PATCH)는 부모를 바꾸지 못해
//    (addParents/removeParents 미사용) 한 번 루트에 생긴 파일은 스스로 폴더로 돌아오지 못하고
//    이후 루트 세션마다 계속 덮어써진다 — 정상 폴더와 별개의 '평행 계보'가 자란다.
//    루트에 쓴 백업은 listBackups/cleanupOldBackups가 폴더 스코프라 앱 눈에 영영 안 보인다
//    (= 사용자는 백업이 있다고 믿는데 복원 목록에는 없다).
let _rootFolderId: string | null = null;
async function _loadRootFolderId(token: string): Promise<string | null> {
  if (_rootFolderId) return _rootFolderId;
  try {
    const res = await fetch(`${DRIVE_API}/files/root?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    _rootFolderId = data?.id ?? null;
    return _rootFolderId;
  } catch {
    return null; // 조회 실패는 저장을 막지 않는다 — 가드는 'root' 리터럴·빈 값만으로도 동작
  }
}

// 저장 직전 최종 가드 — folderId가 루트/빈 값이면 **쓰지 않고 던진다**.
// ⚠️ 조용히 넘어가지 말 것: 08-03 이전 무음 실패가 정확히 '화면엔 저장됨, 실제론 유실'을 만들었다.
//    던져야 saveAllToDrive의 catch가 재시도·상태 표시·알림을 돌린다.
function _assertNotRootFolder(folderId: string, fileName: string): void {
  if (!folderId || folderId === 'root' || (_rootFolderId && folderId === _rootFolderId)) {
    throw new Error(
      `[Drive] 저장 위치가 내 드라이브 최상위로 해석되어 저장을 중단했습니다 (${fileName}). 새로고침 후 다시 시도하세요.`
    );
  }
}

// 안전망(2.5단계) 후보 부모가 '앱 데이터 폴더로 쓸 수 있는가' 검증.
// ⚠️ 루트를 절대 통과시키지 말 것. 폴더가 아닌 것·휴지통에 있는 것도 배제한다.
async function _isUsableParent(token: string, parentId: string): Promise<{ ok: boolean; name: string }> {
  if (!parentId || parentId === 'root' || (_rootFolderId && parentId === _rootFolderId)) {
    return { ok: false, name: '' };
  }
  try {
    const res = await fetch(`${DRIVE_API}/files/${parentId}?fields=id,name,mimeType,trashed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, name: '' };
    const meta = await res.json();
    if (meta?.mimeType !== 'application/vnd.google-apps.folder' || meta?.trashed) {
      return { ok: false, name: '' };
    }
    return { ok: true, name: String(meta?.name || '') };
  } catch {
    return { ok: false, name: '' };
  }
}

// 후보 폴더 중 최적 선택: registeredAt 제공 시 가입일과 생성일 차이가 가장 작은 폴더,
// 없으면 가장 오래된 폴더 (createdTime 오름차순 정렬 전제)
function _pickBestFolder(folders: { id: string; createdTime: string }[], registeredAt?: string): string {
  if (folders.length === 1) return folders[0].id;
  if (!registeredAt) return folders[0].id; // 정렬이 createdTime asc이므로 index 0 = 가장 오래된 폴더
  const regMs = new Date(registeredAt).getTime();
  let best = folders[0];
  let bestDiff = Math.abs(new Date(folders[0].createdTime).getTime() - regMs);
  for (const f of folders.slice(1)) {
    const diff = Math.abs(new Date(f.createdTime).getTime() - regMs);
    if (diff < bestDiff) { best = f; bestDiff = diff; }
  }
  return best.id;
}

// Index_Data_<email> 폴더 찾기 또는 없으면 생성
// 구 형식(Index_Data) 폴더가 있으면 자동으로 새 이름으로 마이그레이션
// drive.metadata.readonly 스코프 추가로 files.list가 기기/세션에 관계없이 모든 폴더를 반환함
// registeredAt: 관리자가 기록한 가입일 (ISO 날짜 문자열, 예: "2026-01-15") — 중복 폴더 선택 기준
export async function getOrCreateIndexFolder(token: string, email: string, registeredAt?: string): Promise<string> {
  const key = email; // 토큰이 바뀌어도 같은 이메일이면 캐시 히트 → 중복 생성 방지
  if (_folderCache?.key === key) return _folderCache.promise;
  const promise = _doGetOrCreateIndexFolder(token, email, registeredAt).catch(err => {
    _folderCache = null;
    throw err;
  });
  _folderCache = { key, promise };
  return promise;
}

async function _doGetOrCreateIndexFolder(token: string, email: string, registeredAt?: string): Promise<string> {
  const newName = getFolderName(email);
  // 세션당 1회 — 이후 모든 saveDriveFile의 루트 가드가 이 값을 쓴다.
  // ⚠️ 2.5단계 안에서만 부르면 그 단계가 실행되지 않는 정상 세션에서 가드가 무장되지 않는다.
  await _loadRootFolderId(token);

  // 1단계: 새 형식 폴더(Index_Data_<email>) 탐색
  // createdTime 오름차순 정렬 → 중복 시 가장 오래된 폴더(원본)가 index 0
  const q1 = encodeURIComponent(
    `name='${newName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'me' in owners`
  );
  const res1 = await fetch(
    `${DRIVE_API}/files?q=${q1}&spaces=drive&fields=files(id,createdTime)&orderBy=createdTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res1.ok) {
    const err = await res1.json().catch(() => ({}));
    throw new Error(`[Drive] 폴더 검색 실패 ${res1.status}: ${err?.error?.message || res1.statusText}`);
  }
  const data1 = await res1.json();
  if (data1.files?.length > 0) return _pickBestFolder(data1.files, registeredAt);

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

  // 2.5단계: 안전망 — portfolio_state.json 전역 검색
  // 1·2단계에서 폴더를 못 찾았어도 데이터 파일이 존재하면 기존 사용자이므로 생성 차단
  const safetyRes = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(`name='portfolio_state.json' and trashed=false and 'me' in owners`)}&spaces=drive&fields=files(id,parents)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).catch(() => null);
  if (safetyRes?.ok) {
    const safetyData = await safetyRes.json().catch(() => ({ files: [] }));
    if (safetyData.files?.length > 0) {
      // ⚠️ 과거엔 `safetyData.files[0].parents?.[0]`를 **검증 없이** 폴더 ID로 썼다. 이 쿼리에는
      //    orderBy도 pageSize도 없어 files[0]이 호출마다 달라질 수 있고, parents[0]이 폴더인지·
      //    루트인지·앱 폴더인지 아무것도 보지 않았다. 그래서 루트에 portfolio_state.json이 하나만
      //    있어도 그 세션 전체가 내 드라이브 최상위에 저장됐다(2026-06~08 실측 사고).
      //    → 후보를 **전부** 훑어 '루트가 아닌 실제 폴더'만 채택하고, 이름이 Index_Data_<email>
      //      (또는 레거시 Index_Data)인 후보를 우선한다. 하나도 없으면 폴더를 새로 만들지 않고
      //      **던진다**(fail-closed) — 잘못된 곳에 쓰는 것보다 저장을 멈추는 편이 낫다.
      const candidates: string[] = [];
      for (const f of safetyData.files) {
        const pid = f?.parents?.[0];
        if (pid && !candidates.includes(pid)) candidates.push(pid);
      }
      let fallbackId = '';
      for (const pid of candidates) {
        const { ok, name } = await _isUsableParent(token, pid);
        if (!ok) continue;
        if (name === newName || name === FOLDER_NAME_LEGACY) return pid; // 이름까지 맞는 최선 후보
        if (!fallbackId) fallbackId = pid; // 폴더명을 바꿔 쓰는 사용자를 위한 차선(루트는 이미 배제됨)
      }
      if (fallbackId) {
        console.warn(`[Drive] 안전망: 이름이 다른 폴더를 채택했습니다 (기대=${newName})`);
        return fallbackId;
      }
      throw new Error('FOLDER_NOT_FOUND_FOR_KNOWN_USER');
    }
  }

  // 3단계: 새 폴더 생성 (1·2·2.5단계 모두 실패 = 진짜 신규 사용자)
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
// GET permissions가 drive.file scope 제한으로 403 반환 시에도 POST 권한 부여를 독립 시도
export async function grantAdminReadAccess(token: string, folderId: string, adminEmail: string): Promise<boolean> {
  try {
    // GET으로 기존 권한 확인 — 403(scope 제한) 시에도 POST 폴백으로 진행
    const res = await fetch(
      `${DRIVE_API}/files/${folderId}/permissions?fields=permissions(id,emailAddress,role)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const existing = data.permissions?.find(
        (p: any) => p.emailAddress?.toLowerCase() === adminEmail.toLowerCase()
      );
      if (existing) {
        if (existing.role === 'writer') return true;
        const patchRes = await fetch(`${DRIVE_API}/files/${folderId}/permissions/${existing.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'writer' }),
        });
        return patchRes.ok;
      }
    }
    // GET 실패(403 scope 제한 등) 또는 기존 권한 없는 경우 → POST로 신규 부여 시도
    const postRes = await fetch(`${DRIVE_API}/files/${folderId}/permissions?sendNotificationEmail=false`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: adminEmail }),
    });
    if (!postRes.ok) {
      const err = await postRes.json().catch(() => ({}));
      console.warn('[Drive] 관리자 권한 부여 실패:', postRes.status, err?.error?.message || '');
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[Drive] 관리자 권한 부여 예외:', e);
    return false;
  }
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
// targetEmail은 시트에서 공백이 섞여 올 수 있으므로 trim() 후 사용
export async function findUserIndexFolder(adminToken: string, targetEmail: string): Promise<string | null> {
  const email = targetEmail.trim();
  const searchByName = async (name: string) => {
    const q = encodeURIComponent(
      `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${email}' in owners`
    );
    const res = await fetch(
      `${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime+desc`,
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
  return (await searchByName(getFolderName(email))) ?? (await searchByName(FOLDER_NAME_LEGACY));
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
  // ⚠️ 모든 JSON 저장이 지나는 단일 관문 — 여기서 막으면 백업·STATE·STOCK·MARKET이 한꺼번에 보호된다.
  //    (saveVersionedBackup·saveVersionFile·관리자 캐시도 전부 이 함수를 통과한다.)
  _assertNotRootFolder(folderId, fileName);
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

  // ⚠️ 업로드 응답을 반드시 검사할 것 — 과거엔 `await fetch(...)`만 하고 res.ok를 보지 않아
  //    403(용량 초과·권한)·404(파일이 휴지통으로 감)·5xx가 전부 '성공'으로 흘렀다. 그러면
  //    saveAllToDrive의 catch에 도달하지 못해 재시도·상태 표시·알림이 통째로 죽고, 화면에는
  //    '저장됨'이 뜬 채 그 세션 데이터가 사라진다(STOCK 파일은 앱 내 백업이 0본이라 복구 경로도 없다).
  // ⚠️ 메시지에 res.status 숫자를 반드시 포함할 것 — useDriveSync의 저장 실패 처리가
  //    `msg.includes('401')`로 무음 토큰 재발급을 분기한다. 숫자를 빼면 업로드 401이 일반 오류로
  //    굳어 만료된 토큰으로 재시도만 반복하는 자기지속형 오류가 된다(검사를 넣기 전보다 나빠짐).
  // ⚠️ PATCH·POST 양쪽 모두에 걸 것 — 한쪽만 걸면 신규 파일 생성 실패가 계속 무음으로 남는다.
  //    응답 본문 전문은 로그에 남기지 말 것(토큰·경로가 섞일 수 있음 — error.message만).
  const assertUploadOk = async (res: Response, phase: string) => {
    if (res.ok) return;
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `[Drive] 파일 ${phase} 실패 ${res.status}: ${(err as any)?.error?.message || res.statusText}`
    );
  };

  if (fileId) {
    const res = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=multipart`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: makeBody(),
    });
    await assertUploadOk(res, `덮어쓰기(${fileName})`);
  } else {
    const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: makeBody([folderId]),
    });
    await assertUploadOk(res, `생성(${fileName})`);
  }
}

// HTML 학습자료를 관리자 Drive에 업로드하고 '링크 있는 사람 누구나 보기' 공개 권한을 부여한 뒤 fileId 반환.
// 일반 사용자는 drive.file scope라 관리자 파일을 직접 못 읽으므로, 공개로 두고 /api/study-material 프록시가 서버사이드로 읽어 전달한다.
export async function uploadHtmlStudyMaterial(
  token: string,
  folderId: string,
  fileName: string,
  htmlContent: string
): Promise<string> {
  const boundary = 'drive_boundary_html';
  const meta = { name: fileName, mimeType: 'text/html', parents: [folderId] };
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(meta),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlContent,
    `--${boundary}--`,
  ].join('\r\n');
  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`[Drive] 학습자료 업로드 실패 ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const fileId = data.id as string;
  if (!fileId) throw new Error('[Drive] 학습자료 업로드 응답에 fileId 없음');
  // 공개 권한(anyone with link, reader) 부여 — 프록시가 키 없이도 읽을 수 있게
  const permRes = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!permRes.ok) {
    // 권한 부여 실패 시 업로드한 파일을 정리하고 에러 — 비공개 파일은 사용자가 못 읽음
    await deleteDriveFileById(token, fileId);
    const err = await permRes.json().catch(() => ({}));
    throw new Error(`[Drive] 학습자료 공개 권한 부여 실패 ${permRes.status}: ${err?.error?.message || permRes.statusText}`);
  }
  return fileId;
}

// fileId로 Drive 파일 삭제 (학습자료 링크 삭제 시 원본 정리, 실패 무시)
export async function deleteDriveFileById(token: string, fileId: string): Promise<void> {
  try {
    await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
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
// type: 'manual' = 수동 저장, 'auto' = 자동 저장, 'change' = 포트폴리오 구성 변경 자동 저장
export async function saveVersionedBackup(
  token: string,
  folderId: string,
  data: unknown,
  type: 'manual' | 'auto' | 'change' = 'auto'
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

// 관리자 포털 뷰 설정(숨김 사용자·그룹) — 캐시(무거움)와 분리한 소형 파일
const ADMIN_PORTAL_CONFIG_FILE = 'admin_portal_config.json';

export async function saveAdminPortalConfig(token: string, folderId: string, data: unknown): Promise<void> {
  await saveDriveFile(token, folderId, ADMIN_PORTAL_CONFIG_FILE, data);
}

export async function loadAdminPortalConfig(token: string, folderId: string): Promise<unknown | null> {
  return loadDriveFile(token, folderId, ADMIN_PORTAL_CONFIG_FILE);
}

async function cleanupOldBackups(token: string, folderId: string): Promise<void> {
  try {
    const backups = await listBackups(token, folderId);
    const autoBackups = backups.filter(b => b.name.endsWith('_auto.json'));
    const manualBackups = backups.filter(b => b.name.endsWith('_manual.json'));
    const changeBackups = backups.filter(b => b.name.endsWith('_change.json'));
    const toDelete = [
      ...autoBackups.slice(MAX_BACKUPS),
      ...manualBackups.slice(MAX_MANUAL_BACKUPS),
      ...changeBackups.slice(MAX_BACKUPS),
    ];
    if (toDelete.length === 0) return;
    await Promise.all(
      toDelete.map(b =>
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

// 마지막 수동 저장본(MANUAL_LATEST) 항목 조회 — 백업 모달 상단에 표시용
export async function getManualLatestEntry(token: string, folderId: string): Promise<DriveBackupEntry | null> {
  try {
    const data = await loadDriveFile(token, folderId, DRIVE_FILES.MANUAL_LATEST) as any;
    if (!data?.manualSavedAt) return null;
    const fileId = await findFileId(token, folderId, DRIVE_FILES.MANUAL_LATEST);
    if (!fileId) return null;
    const d = new Date(data.manualSavedAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    const label = `portfolio_backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}00_manuallatest`;
    return { id: fileId, name: label, createdTime: new Date(data.manualSavedAt).toISOString() };
  } catch {
    return null;
  }
}
