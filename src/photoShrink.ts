// 사진을 기기에서 JPEG로 줄인다(서버 요청 크기 안에 들게, 글자는 읽히게) — 계좌 표 「📷 사진으로 보유 맞추기」가 쓴다.
// 과표 계산기(KrEtfTaxMatrix)의 같은 이름 함수와 같은 차례(PHOTO_TRIES)·크기(photoFitSize)를 쓴다. 사진은 저장하지 않는다.
import { PHOTO_TRIES, photoFitSize } from './taxCalcPaste';

const loadPhotoImage = (file: Blob): Promise<{ img: HTMLImageElement; url: string }> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => resolve({ img, url });
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
  img.src = url;
});

const photoToJpegB64 = (img: HTMLImageElement, w: number, h: number, q: number): Promise<string> => new Promise((resolve, reject) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) { reject(new Error('decode')); return; }
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  const fromUrl = () => { try { resolve(String(c.toDataURL('image/jpeg', q)).split(',')[1] || ''); } catch { reject(new Error('decode')); } };
  if (!c.toBlob) { fromUrl(); return; }
  c.toBlob((blob) => {
    if (!blob) { fromUrl(); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || '').split(',')[1] || '');
    fr.onerror = () => reject(new Error('decode'));
    fr.readAsDataURL(blob);
  }, 'image/jpeg', q);
});

// 한 장 몫(budget, base64 글자 수) 안에 들 때까지 줄인다. 끝까지 크면 Error('big'), 못 열면 Error('decode').
export async function shrinkPhotoToB64(file: Blob, budget: number): Promise<string> {
  const { img, url } = await loadPhotoImage(file);
  try {
    for (const t of PHOTO_TRIES) {
      const { w, h } = photoFitSize(img.naturalWidth, img.naturalHeight, t.scale);
      const b64 = await photoToJpegB64(img, w, h, t.q);
      if (b64 && b64.length <= budget) return b64;
    }
    throw new Error('big');
  } finally {
    URL.revokeObjectURL(url);
  }
}
