// Google Drive REST API helper — Index_Data 폴더 기반 저장/불러오기

const FOLDER_NAME = 'Index_Data';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export const DRIVE_FILES = {
  STATE:  'portfolio_state.json',
  STOCK:  'portfolio_stockdata.json',
  MARKET: 'portfolio_marketdata.json',
};

// Index_Data 폴더 찾기 또는 없으면 생성
export async function getOrCreateIndexFolder(token: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`[Drive] 폴더 검색 실패 ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  if (data.files?.length > 0) return data.files[0].id;

  // 폴더 없으면 생성
  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
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

// 폴더 안에서 파일 ID 찾기
async function findFileId(token: string, folderId: string, fileName: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${fileName}' and '${folderId}' in parents and trashed=false`
  );
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id)`,
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
