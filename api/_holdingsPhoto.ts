// 계좌 표 「📷 사진으로 보유 맞추기」(사용자 요청 2026-11-26) — /api/holdings-photo 가 쓰는 순수 로직.
// 증권사 잔고(보유종목) 화면 사진을 구글 Gemini에 넘겨 종목마다 한 줄(보유수량·매입금액·평균단가)을 받는다.
// 받은 글은 src/holdingsPhoto.ts 의 parseHoldingsText 가 그대로 읽는 줄 형식이어야 한다(verify:holdings-photo 가 대조).
// 키(사용자 요청: 관리자 먼저 · 다른 사용자는 자기 구글 계정의 Gemini 무료 한도로):
//   관리자 = 내 키(있으면) → 사이트 키(Vercel GEMINI_API_KEY 2~9) · 다른 사용자 = 내 키만(없으면 needkey — 사이트 키를 쓰지 않는다).
//   내 키는 요청 헤더 X-Gemini-Key 로만 받고 기록·저장하지 않는다(서버 메모리에서 Gemini로 넘길 뿐).
// ⚠️ 사진은 저장하지 않는다. ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-holdings-photo.mjs가 직접 import한다.

export const USER_KEY_HEADER = 'x-gemini-key';
export const HOLD_PHOTO_MAX = 10;
const IMG_MIME = /^image\/(jpeg|png|webp)$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CODE_RE = /^[0-9A-Za-z]{4,12}$/;
const KEY_RE = /^[A-Za-z0-9._-]{30,200}$/;

export function userGeminiKey(headerValue: string | null | undefined): string {
  const k = String(headerValue ?? '').trim();
  return KEY_RE.test(k) ? k : '';
}

// 쓸 키 차례 — 관리자: 내 키 → 사이트 키 · 다른 사용자: 내 키만.
export function pickHoldKeys(isAdmin: boolean, userKey: string, siteKeys: string[]): string[] {
  const out: string[] = [];
  if (userKey) out.push(userKey);
  if (isAdmin) for (const k of siteKeys) if (k && !out.includes(k)) out.push(k);
  return out;
}

export interface HoldReq { account: string; cands: { code: string; name: string }[]; images: { mime: string; data: string }[] }

export function checkHoldReq(body: any): HoldReq | { error: string } {
  if (!body || typeof body !== 'object') return { error: '요청 형식이 틀렸습니다' };
  const account = String(body.account ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40);
  const cands: { code: string; name: string }[] = [];
  for (const c of (Array.isArray(body.cands) ? body.cands : []).slice(0, 80)) {
    const code = String(c?.code ?? '').trim().toUpperCase();
    const name = String(c?.name ?? '').replace(/[\r\n\t|]+/g, ' ').trim().slice(0, 60);
    if (code && !CODE_RE.test(code)) continue;
    if (!code && !name) continue;
    cands.push({ code, name });
  }
  const imgs = Array.isArray(body.images) ? body.images : [];
  if (imgs.length === 0) return { error: '사진이 없습니다' };
  if (imgs.length > HOLD_PHOTO_MAX) return { error: `사진은 한 번에 ${HOLD_PHOTO_MAX}장까지입니다` };
  const images: { mime: string; data: string }[] = [];
  for (const im of imgs) {
    const mime = String(im?.mime ?? '');
    const data = String(im?.data ?? '');
    if (!IMG_MIME.test(mime)) return { error: '사진 형식이 틀렸습니다' };
    if (data.length < 100 || !B64.test(data)) return { error: '사진 자료가 깨졌습니다' };
    images.push({ mime, data });
  }
  return { account, cands, images };
}

// Gemini에 줄 부탁 문장 — ⚠️ 예시 줄은 verify:holdings-photo 가 parseHoldingsText로 실제로 읽어 본다.
export function buildHoldPrompt({ account, cands }: { account: string; cands: { code: string; name: string }[] }): string {
  const list = cands.length > 0
    ? cands.map(c => `${c.code || '-'} ${c.name || ''}`.trim()).join('\n')
    : '(목록 없음)';
  return [
    `첨부한 증권사 앱의 잔고·보유종목 화면 사진을 읽어 보유 종목마다 아래 형식의 줄 하나로만 답하세요. 설명·머리말·표·코드블록 없이 결과 줄만 씁니다.`,
    `보유 | 코드 | 종목명 | 보유수량 | 매입금액 | 평균단가`,
    ``,
    `- 종목명은 사진에 보이는 그대로 씁니다(잘려 보이면 보이는 데까지).`,
    `- 아래 [이 계좌 종목 목록]에 같은 종목이 있으면 코드 자리에 그 코드를, 없으면 '-'를 씁니다. 사진의 이름이 잘려 있어도 앞부분이 같으면 같은 종목입니다. 코드를 지어내지 마세요.`,
    `- 보유수량은 '보유수량'(잔고수량)입니다. '주문가능' 수량이 아닙니다.`,
    `- 매입금액은 '매입금액'(매입원가)입니다. '평가금액'이 아닙니다. 사진에 없으면 '-'를 씁니다.`,
    `- 평균단가는 '평균단가'(매입단가)입니다. '현재가'가 아닙니다. 사진에 없으면 '-'를 씁니다.`,
    `- 한 종목의 숫자가 두 줄(위·아래)로 나뉘어 있으면 화면 머리줄의 위·아래 순서를 보고 맞는 칸을 고르세요.`,
    `- 숫자는 사진에 보이는 그대로(쉼표 가능) 씁니다. 읽기 어려운 숫자는 지어내지 마세요.`,
    `- 화면 아래가 잘려 보유수량·매입금액이 안 보이는 종목은 '보유 | 코드 | 종목명 | 잘림'으로 씁니다.`,
    `- 사진이 여러 장이라 같은 종목이 두 장에 겹쳐 보이면 숫자가 다 보이는 것을 한 번만 씁니다.`,
    `- 예수금·현금·합계·총평가 줄은 쓰지 않습니다.`,
    `- 보유 종목이 하나도 안 보이면 '없음' 한 줄만 씁니다.`,
    ``,
    `[이 계좌 종목 목록]${account ? ` 계좌: ${account}` : ''}`,
    list,
    ``,
    `예)`,
    `보유 | 0091P0 | TIGER 머니마켓액티브 | 9 | 935,273 | 103,919`,
    `보유 | - | SOL 미국원자력SMR | 113 | 1,474,670 | 13,050`,
    `보유 | - | ACE K휴머노이드로봇 | 잘림`,
  ].join('\n');
}

export function holdGeminiBody(req: HoldReq): string {
  const parts: any[] = req.images.map(im => ({ inline_data: { mime_type: im.mime, data: im.data } }));
  parts.push({ text: buildHoldPrompt(req) });
  return JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
  });
}
