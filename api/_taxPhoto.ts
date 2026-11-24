// 평균 과표 계산기 '사진으로 넣기'(사용자 요청 2026-11-24: "사진만 올리면 AI가 읽고 평균 단가·수량을 바로 적용") —
// /api/tax-photo가 쓰는 순수 로직. 사진은 저장하지 않고 구글 Gemini에 넘겨 글자만 받는다(서버·Drive 저장 0).
// 받은 글은 src/taxCalcPaste.ts의 parseTaxCalcPaste가 그대로 읽는 줄 형식이어야 한다(verify:tax-paste #G가 대조).
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-tax-paste.mjs가 Node 타입 스트리핑으로 직접 import한다.

export const GAPI = 'https://generativelanguage.googleapis.com/v1beta';
// 앞에서부터 쓴다 — 없는 모델(404)·잠깐 안 됨(5xx)은 다음 모델, 한도(429)·틀린 키는 다음 키.
export const GMODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'];
export const GKEYBAD = /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|API_KEY_SERVICE_BLOCKED/i;
export const PHOTO_MAX = 10;
// 요청 본문 상한(글자 수) — 클라이언트가 사진을 줄여 이 안에 맞춘다(src/taxCalcPaste.ts PHOTO_BODY_BUDGET보다 넉넉히).
export const BODY_MAX = 4_000_000;
export const IMG_MIME = /^image\/(jpeg|png|webp)$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CODE_RE = /^[0-9A-Za-z]{1,12}$/;

export function geminiKeys(env: Record<string, string | undefined>): string[] {
  const a: string[] = [];
  for (let i = 1; i <= 9; i++) {
    const k = env['GEMINI_API_KEY' + (i === 1 ? '' : i)];
    if (typeof k === 'string' && k.trim()) a.push(k.trim());
  }
  return a;
}

export interface PhotoReq { name: string; code: string; year: number; images: { mime: string; data: string }[] }

// 요청 본문 검사 — 통과하면 PhotoReq, 아니면 까닭(사용자에게 보일 글).
export function checkPhotoReq(body: any, thisYear: number): PhotoReq | { error: string } {
  if (!body || typeof body !== 'object') return { error: '요청 형식이 틀렸습니다' };
  const name = String(body.name ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
  const code = String(body.code ?? '').trim();
  if (!CODE_RE.test(code)) return { error: '종목 코드가 틀렸습니다' };
  const year = Number(body.year);
  if (!Number.isInteger(year) || Math.abs(year - thisYear) > 1) return { error: '연도가 틀렸습니다' };
  const imgs = Array.isArray(body.images) ? body.images : [];
  if (imgs.length === 0) return { error: '사진이 없습니다' };
  if (imgs.length > PHOTO_MAX) return { error: `사진은 한 번에 ${PHOTO_MAX}장까지입니다` };
  const images: { mime: string; data: string }[] = [];
  for (const im of imgs) {
    const mime = String(im?.mime ?? '');
    const data = String(im?.data ?? '');
    if (!IMG_MIME.test(mime)) return { error: '사진 형식이 틀렸습니다' };
    if (data.length < 100 || !B64.test(data)) return { error: '사진 자료가 깨졌습니다' };
    images.push({ mime, data });
  }
  return { name, code, year, images };
}

// Gemini에 줄 부탁 문장 — 결과 줄은 parseTaxCalcPaste가 읽는 형식 그대로(⚠️ 예시 줄은 verify:tax-paste #G2가 실제로 읽어 본다).
export function buildPhotoPrompt({ name, code, year }: { name: string; code: string; year: number }): string {
  const stock = [name, code ? `(${code})` : ''].filter(Boolean).join(' ');
  return [
    `첨부한 증권사 화면 사진(주문내역·체결내역 또는 기준가·과표기준가 표)을 읽어 아래 형식의 줄로만 답하세요. 설명·머리말·표·코드블록 없이 결과 줄만 씁니다.`,
    `종목: ${stock} — 이 종목의 줄만 씁니다. 다른 종목은 빼세요. 사진에 종목 이름이 안 보이면 사진의 모든 줄을 씁니다.`,
    ``,
    `[주문내역·체결내역] 한 줄에 체결 하나`,
    `YYYY-MM-DD 매수(또는 매도) 수량주 평균체결가원`,
    `- 날짜에 연도가 없으면 ${year}년으로 쓰세요(오늘보다 뒤 날짜가 되면 ${year - 1}년).`,
    `- 수량은 '체결수량', 가격은 '체결단가' 또는 '평균체결가'입니다. 주문수량·주문단가가 아닙니다.`,
    `- 체결수량이 0인 주문(미체결·취소·정정 원주문)은 빼세요.`,
    `- 같은 날 여러 번 체결됐으면 줄을 나눠 그대로 쓰세요(합치지 마세요).`,
    `- 사진이 여러 장이라 같은 체결(같은 날·시각·주문번호)이 두 장에 겹쳐 보이면 한 번만 쓰세요.`,
    `- 숫자는 사진에 보이는 그대로 씁니다. 읽기 어려운 줄은 지어내지 말고 빼세요.`,
    `- 사진에 과표기준가가 있으면 줄 끝에 '과표 숫자'를 붙이세요.`,
    ``,
    `[기준가·과표기준가 표] 한 줄에 날짜 하나`,
    `YYYY-MM-DD 과표 과표기준가`,
    ``,
    `읽을 줄이 하나도 없으면 '없음' 한 줄만 씁니다.`,
    ``,
    `예)`,
    `${year}-11-23 매수 5주 6,960원`,
    `${year}-11-24 매도 50주 7,490원`,
    `${year}-11-24 과표 1,234.56`,
  ].join('\n');
}

export function geminiBody(req: PhotoReq): string {
  const parts: any[] = req.images.map(im => ({ inline_data: { mime_type: im.mime, data: im.data } }));
  parts.push({ text: buildPhotoPrompt(req) });
  return JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
  });
}

// Gemini SSE 한 덩이(여러 줄일 수 있음)에서 답 글만 꺼낸다 — 생각(thought) 조각은 뺀다.
// 남는 끝줄(아직 다 안 온 줄)은 rest로 돌려준다.
export function sseTexts(buf: string): { texts: string[]; rest: string; block: string } {
  const lines = buf.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  const texts: string[] = [];
  let block = '';
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    let j: any;
    try { j = JSON.parse(raw); } catch { continue; }
    const c = j?.candidates?.[0];
    for (const p of c?.content?.parts || []) {
      if (p && typeof p.text === 'string' && !p.thought) texts.push(p.text);
    }
    const br = j?.promptFeedback?.blockReason || (c?.finishReason === 'SAFETY' ? 'SAFETY' : '');
    if (br) block = String(br);
  }
  return { texts, rest, block };
}
