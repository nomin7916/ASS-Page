// 화면 사진 글자 인식(OCR) — AI 없이 · 무료 · 이 기기 안에서(사진은 기기 밖으로 나가지 않는다). 2026-11-26 사용자 요청:
//   "사진을 올리면 OCR로 텍스트 추출 → 사진의 구조 파악 → 계산·적용 · AI는 최종 검수가 필요할 때만 · OCR은 나의 학습 사이트의 것을 활용".
// 엔진 = 학습 사이트(nomin7916/pe-study) 유틸 「글자 입히기」의 PP-OCRv5(글줄 찾기 det + 한글·영어 글줄 읽기 rec)를 ONNX Runtime Web으로.
//   파일은 public/ocr/pp5/ (README 참고) — 처음 한 번 약 17MB를 받고 브라우저가 간직한다.
//   detPost·runRec·cropOf·줄 묶기는 그 유틸(src/util/ocr.html #pp-core · readCanvas)의 코드를 옮긴 것이다. 책 쪽에 쓰던 다듬기(그늘·단·옆 소제목·여러 번 읽기)는
//   증권사 화면 갈무리에 필요 없어 뺐다 — 대신 어두운 화면(다크 모드)·색 글자(빨강 매수·파랑 매도)를 위한 회색 만들기(grayForOcr)를 더했다.
// ⚠️ import 0 · 브라우저 전용(DOM·WebAssembly). 해석(표 구조 → 매매 줄)은 src/tradeOcr.ts(검증 스크립트가 직접 import).

export interface OcrLine { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }

const BASE = '/ocr/pp5';
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
export const OCR_FILES: [string, number][] = [
  [`${BASE}/ort-wasm-simd-threaded.wasm.gz`, 3.66e6],
  [`${BASE}/det.onnx.gz`, 4.53e6],
  [`${BASE}/rec.onnx.gz`, 8.28e6],
  [`${BASE}/dict.txt`, 0.05e6],
];

let ready: Promise<any> | null = null;

async function gunzip(u: Uint8Array): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') throw new Error('old');
  const r = new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip')));
  return await r.arrayBuffer();
}
const unpack = async (u: Uint8Array) => ((u[0] === 0x1f && u[1] === 0x8b) ? gunzip(u) : u.slice().buffer);
async function fetchBytes(url: string, onp?: (n: number) => void): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  if (!r.body) return new Uint8Array(await r.arrayBuffer());
  const rd = r.body.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onp && onp(n); }
  const u = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { u.set(p, o); o += p.length; }
  return u;
}

// 엔진 띄우기 — 받는 동안 onp(0~1).
export function loadOcrEngine(onp?: (f: number) => void): Promise<any> {
  if (ready) return ready;
  ready = (async () => {
    const total = OCR_FILES.reduce((a, w) => a + w[1], 0), got = OCR_FILES.map(() => 0);
    const bufs = await Promise.all(OCR_FILES.map((w, i) => fetchBytes(w[0], n => { got[i] = Math.min(n, w[1]); onp && onp(Math.min(0.99, got.reduce((a, b) => a + b, 0) / total)); })));
    const [wasm, detB, recB] = await Promise.all([unpack(bufs[0]), unpack(bufs[1]), unpack(bufs[2])]);
    const dict = new TextDecoder().decode(bufs[3]);
    const ort: any = await import(/* @vite-ignore */ `${location.origin}${BASE}/ort.wasm.bundle.min.mjs`);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmBinary = wasm;
    const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const det = await ort.InferenceSession.create(new Uint8Array(detB), opt);
    const rec = await ort.InferenceSession.create(new Uint8Array(recB), opt);
    const chars = [''].concat(dict.replace(/\r/g, '').replace(/\n$/, '').split('\n'), [' ']);
    onp && onp(1);
    return { ort, det, rec, chars };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

// ── 학습 사이트 #pp-core 에서 옮김 ──
// 글자 있는 곳 지도 → 글줄 상자(기운 네모)
function detPost(pm: Float32Array, W: number, H: number, unclip: number) {
  const N = W * H, lab = new Uint8Array(N), list = new Int32Array(N), out: any[] = [];
  const TH = 0.3;
  for (let s = 0; s < N; s++) {
    if (lab[s] || !(pm[s] > TH)) continue;
    let n = 0, head = 0;
    list[n++] = s; lab[s] = 1;
    while (head < n) {
      const j = list[head++]; const x = j % W, y = (j - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const k = yy * W + xx; if (!lab[k] && pm[k] > TH) { lab[k] = 1; list[n++] = k; }
        }
      }
    }
    if (n < 9) continue;
    let sx = 0, sy = 0, sp = 0;
    for (let i = 0; i < n; i++) { const j = list[i]; const x = j % W; sx += x; sy += (j - x) / W; sp += pm[j]; }
    const score = sp / n; if (score < 0.6) continue;
    const cx = sx / n, cy = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { const j = list[i]; const x = j % W, dx = x - cx, dy = (j - x) / W - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    sxx /= n; sxy /= n; syy /= n;
    const tr = sxx + syy, dt = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) / 4 + sxy * sxy));
    const l1 = tr / 2 + dt, l2 = Math.max(1e-6, tr / 2 - dt);
    out.push({ n, score, cx, cy, ang: 0.5 * Math.atan2(2 * sxy, sxx - syy), elong: l1 / l2, idx: list.slice(0, n) });
  }
  const longs = out.filter(o => o.elong > 30 && Math.abs(o.ang) < 0.5).map(o => o.ang).sort((a, b) => a - b);
  const pageAng = longs.length ? longs[longs.length >> 1] : 0;
  const boxes: any[] = [];
  for (const o of out) {
    const a = (o.elong > 30 && Math.abs(o.ang - pageAng) < 0.12) ? o.ang : pageAng;
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let i = 0; i < o.n; i++) {
      const j = o.idx[i]; const x = j % W, dx = x - o.cx, dy = (j - x) / W - o.cy;
      const u = c * dx + s * dy, v = -s * dx + c * dy;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const w = u1 - u0 + 1, h = v1 - v0 + 1; if (w < 3 || h < 3) continue;
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
    const cx = o.cx + c * um - s * vm, cy = o.cy + s * um + c * vm;
    const d = o.n * unclip / (2 * (w + h));
    boxes.push({ cx, cy, w: w + 2 * d, h: h + 2 * d, ang: a, score: o.score });
  }
  return { boxes, pageAng };
}

async function runDet(eng: any, gray: Uint8Array, w: number, h: number) {
  const N = w * h, x = new Float32Array(3 * N);
  for (let c = 0; c < 3; c++) { const a = 1 / (255 * STD[c]), b = -MEAN[c] / STD[c], o = c * N; for (let i = 0; i < N; i++) x[o + i] = gray[i] * a + b; }
  const out = await eng.det.run({ [eng.det.inputNames[0]]: new eng.ort.Tensor('float32', x, [1, 3, h, w]) });
  return detPost(out[eng.det.outputNames[0]].data, w, h, 1.6);
}

async function runRec(eng: any, gray: Uint8Array, w: number) {
  const N = 48 * w, x = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) { const v = gray[i] / 127.5 - 1; x[i] = v; x[N + i] = v; x[2 * N + i] = v; }
  const out = await eng.rec.run({ [eng.rec.inputNames[0]]: new eng.ort.Tensor('float32', x, [1, 3, 48, w]) });
  const t = out[eng.rec.outputNames[0]], T = t.dims[1], C = t.dims[2], d = t.data;
  let text = '', sum = 0, cnt = 0, prev = 0;
  for (let i = 0; i < T; i++) {
    const o = i * C;
    let bi = 0, bv = d[o];
    for (let k = 1; k < C; k++) { const v = d[o + k]; if (v > bv) { bv = v; bi = k; } }
    if (bi !== 0 && bi !== prev) { const ch = eng.chars[bi] || ''; text += ch; if (ch !== ' ') { sum += bv; cnt++; } }
    prev = bi;
  }
  return { text, conf: cnt ? sum / cnt : 0 };
}

// 회색 그림 — 어두운 화면(다크 모드)이면 뒤집는다. 색 글자도 또렷하게: 어두운 바탕에선 세 색 중 가장 밝은 값, 밝은 바탕에선 가장 어두운 값.
// 그다음 바탕·글자 밝기로 대비를 편다(바탕 = 하얗게).
export function grayForOcr(rgba: Uint8ClampedArray, N: number): Uint8Array {
  let lum = 0;
  for (let i = 0; i < N * 4; i += 16) lum += (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  const dark = lum / (N / 4) < 110;
  const g = new Uint8Array(N);
  for (let i = 0, j = 0; j < N; i += 4, j++) {
    const r = rgba[i], gg = rgba[i + 1], b = rgba[i + 2];
    g[j] = dark ? 255 - Math.max(r, gg, b) : Math.min(r, gg, b);
  }
  const hist = new Uint32Array(256);
  for (let j = 0; j < N; j++) hist[g[j]]++;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= N * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= N * 0.35) { hi = v; break; } }
  if (hi - lo >= 24) { const k = 255 / (hi - lo); for (let j = 0; j < N; j++) g[j] = Math.max(0, Math.min(255, Math.round((g[j] - lo) * k))); }
  return g;
}

function grayCanvas(src: any, maxSide = 2400, minSide = 900) {
  const W0 = src.width, H0 = src.height;
  let s = Math.min(1, maxSide / Math.max(W0, H0));
  if (Math.max(W0, H0) * s < minSide) s = Math.min(2.5, minSide / Math.max(W0, H0));
  const W = Math.max(1, Math.round(W0 * s)), H = Math.max(1, Math.round(H0 * s));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(src, 0, 0, W, H);
  const im = cx.getImageData(0, 0, W, H);
  const g = grayForOcr(im.data, W * H);
  for (let i = 0, j = 0; j < W * H; i += 4, j++) { im.data[i] = im.data[i + 1] = im.data[i + 2] = g[j]; im.data[i + 3] = 255; }
  cx.putImageData(im, 0, 0);
  return cv;
}
function grayOf(cv: HTMLCanvasElement): Uint8Array {
  const d = (cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D).getImageData(0, 0, cv.width, cv.height).data;
  const g = new Uint8Array(cv.width * cv.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = d[i];
  return g;
}

// 사진 하나 읽기 → 글줄(사진 좌표, 위→아래·왼→오른 순서). onp(0~1)는 읽기 진행.
export async function ocrImage(src: any, onp?: (f: number) => void): Promise<OcrLine[]> {
  const eng = await loadOcrEngine();
  const full = grayCanvas(src);
  const W = full.width, H = full.height;
  let k = Math.min(1500 / Math.max(W, H), 3, 2240 / Math.max(W, H));
  k = Math.max(k, Math.min(1, 480 / Math.max(W, H)));
  const dw = Math.max(32, Math.round(W * k / 32) * 32), dh = Math.max(32, Math.round(H * k / 32) * 32);
  const dc = document.createElement('canvas'); dc.width = dw; dc.height = dh;
  const dx = dc.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  dx.imageSmoothingQuality = 'high'; dx.fillStyle = '#fff'; dx.fillRect(0, 0, dw, dh); dx.drawImage(full, 0, 0, dw, dh);
  const det = await runDet(eng, grayOf(dc), dw, dh);
  onp && onp(0.2);
  const kx = W / dw, ky = H / dh, ks = (kx + ky) / 2;
  const boxes = det.boxes.map((b: any) => ({ cx: b.cx * kx, cy: b.cy * ky, w: b.w * ks, h: b.h * ks, ang: b.ang }))
    .filter((b: any) => b.w >= 4 && b.h >= 4 && b.w > b.h * 0.45);
  const rc = document.createElement('canvas');
  const rx = rc.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const cropOf = (b: any) => {
    const kk = 48 / b.h;
    let rw = Math.ceil(b.w * kk); rw = Math.max(16, Math.min(3200, rw));
    rc.width = rw; rc.height = 48; rx.setTransform(1, 0, 0, 1, 0, 0); rx.fillStyle = '#fff'; rx.fillRect(0, 0, rw, 48);
    rx.imageSmoothingQuality = 'high';
    rx.translate(rw / 2, 24); rx.scale(rw / b.w, kk); rx.rotate(-b.ang); rx.translate(-b.cx, -b.cy);
    rx.drawImage(full, 0, 0);
    return { g: grayOf(rc), rw };
  };
  const out: OcrLine[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const c = cropOf(b);
    const r = await runRec(eng, c.g, c.rw);
    const t = r.text.trim();
    if (t) out.push({ text: t, conf: r.conf, x0: (b.cx - b.w / 2) / W, y0: (b.cy - b.h / 2) / H, x1: (b.cx + b.w / 2) / W, y1: (b.cy + b.h / 2) / H });
    onp && onp(0.2 + 0.8 * (i + 1) / boxes.length);
    if (i % 8 === 7) await new Promise(r2 => setTimeout(r2, 0));   // 화면이 멈추지 않게 숨 돌리기
  }
  out.sort((a, b) => ((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) || a.x0 - b.x0);
  return out;
}

// 파일 → 그림 → 읽기
export async function ocrFile(file: Blob, onp?: (f: number) => void): Promise<OcrLine[]> {
  let src: any = null;
  try { src = await createImageBitmap(file); }
  catch {
    src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = URL.createObjectURL(file); });
  }
  try { return await ocrImage(src, onp); }
  finally { try { src.close && src.close(); } catch { /* 무시 */ } }
}
