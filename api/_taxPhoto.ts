// 평균 과표 계산기 '사진으로 넣기'(사용자 요청 2026-11-24: "사진만 올리면 AI가 읽고 평균 단가·수량을 바로 적용") —
// /api/tax-photo가 쓰는 순수 로직. 사진은 저장하지 않고 구글 Gemini에 넘겨 글자만 받는다(서버·Drive 저장 0).
// 받은 글은 src/taxCalcPaste.ts의 parseTaxCalcPaste가 그대로 읽는 줄 형식이어야 한다(verify:tax-paste #G가 대조).
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-tax-paste.mjs가 Node 타입 스트리핑으로 직접 import한다.

export const GAPI = 'https://generativelanguage.googleapis.com/v1beta';
// 앞에서부터 쓴다 — 없는 모델(404)·잠깐 안 됨(5xx)은 다음 모델, 한도(429)·틀린 키는 다음 키.
export const GMODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'];
export const GKEYBAD = /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|API_KEY_SERVICE_BLOCKED/i;
// 선불 크레딧 소진(2026-11-26 사용자 신고 — 402 "Your prepayment credits are depleted") 등 결제로 막힌 키.
// 그 키의 프로젝트 전체가 막힌 것이라 다른 모델로도 다시 쓰지 않고 다음 키로 넘어간다.
export const GKEYPAY = /prepayment credits|credits are depleted|BILLING_DISABLED|requires billing/i;

// 키가 죽었는가 — 'bad' 틀린 키 · 'credit' 선불 크레딧 소진·결제 막힘 · '' 키 탓 아님(한도·모델·요청 문제).
export function gKeyDead(status: number, body: string): '' | 'bad' | 'credit' {
  const t = String(body || '');
  if (status === 402 || ((status === 403 || status === 429) && GKEYPAY.test(t))) return 'credit';
  if ((status === 400 || status === 403) && GKEYBAD.test(t)) return 'bad';
  return '';
}

// 구글 오류 본문 → 화면에 보일 짧은 글(JSON이면 error.message만, 배열에 싸여 와도).
export function gErrBrief(body: string): string {
  const t = String(body || '');
  try {
    const j = JSON.parse(t);
    const e = (Array.isArray(j) ? j[0] : j)?.error;
    if (e && typeof e.message === 'string' && e.message.trim()) return e.message.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch { /* JSON 아님 */ }
  return t.replace(/\s+/g, ' ').trim().slice(0, 300);
}

// 429 본문 → 어떤 한도인가(구글 QuotaFailure·RetryInfo, 없으면 message 글). zero = 무료 등급 한도 0(그 모델을 못 씀).
export interface GQuota { kind: '' | 'minute' | 'day' | 'zero'; limit: number | null; model: string; retrySec: number | null }
const QRANK = { zero: 3, day: 2, minute: 1, '': 0 } as const;
export function gQuota(body: string): GQuota {
  const out: GQuota = { kind: '', limit: null, model: '', retrySec: null };
  let msg = String(body || '');
  try {
    const j = JSON.parse(msg);
    const e = (Array.isArray(j) ? j[0] : j)?.error || {};
    if (typeof e.message === 'string') msg = e.message;
    for (const d of Array.isArray(e.details) ? e.details : []) {
      const type = String(d?.['@type'] || '');
      if (/QuotaFailure$/.test(type)) {
        for (const v of Array.isArray(d.violations) ? d.violations : []) {
          const id = `${v?.quotaId || ''} ${v?.quotaMetric || ''}`;
          const val = v?.quotaValue == null || v.quotaValue === '' ? null : Number(v.quotaValue);
          const kind = val === 0 ? 'zero' : /PerDay|per_day/i.test(id) ? 'day' : /PerMinute|per_minute/i.test(id) ? 'minute' : '';
          if (QRANK[kind] > QRANK[out.kind] || (!out.model && QRANK[kind] === QRANK[out.kind])) {
            out.kind = kind;
            out.limit = Number.isFinite(val) ? val : null;
            out.model = String(v?.quotaDimensions?.model || '').slice(0, 60);
          }
        }
      } else if (/RetryInfo$/.test(type)) {
        const sec = parseFloat(String(d?.retryDelay || ''));
        if (Number.isFinite(sec)) out.retrySec = sec;
      }
    }
  } catch { /* JSON 아님 — 아래 글에서 찾는다 */ }
  if (!out.kind) {
    const lim = msg.match(/limit:\s*(\d+)/i);
    if (lim) {
      out.limit = Number(lim[1]);
      out.kind = out.limit === 0 ? 'zero' : /per_?day/i.test(msg) ? 'day' : /per_?minute/i.test(msg) ? 'minute' : '';
    }
  }
  if (!out.model) { const md = msg.match(/model:\s*([\w.-]+)/i); if (md) out.model = md[1].slice(0, 60); }
  if (out.retrySec == null) { const rt = msg.match(/retry in ([\d.]+)\s*s/i); if (rt) out.retrySec = Number(rt[1]); }
  return out;
}

export type GFail = 'credit' | 'badkey' | 'rate' | 'rate1m' | 'quota0' | 'gemini';
export interface GNote { status: number; dead: '' | 'bad' | 'credit'; q: GQuota | null; brief: string }

// 키 하나가 왜 안 됐는가(화면에 보일 짧은 한국어).
export function gKeyReason(n: GNote): string {
  if (n.dead === 'credit') return '선불 충전금 0원(402)';
  if (n.dead === 'bad') return '키가 맞지 않음';
  if (n.status === 429) {
    const q = n.q || { kind: '', limit: null, model: '', retrySec: null };
    const m = q.model ? ` · ${q.model}` : '';
    const lim = q.limit != null ? ` ${q.limit}회` : '';
    if (q.kind === 'zero') return `무료 등급에서 못 씀(한도 0${m})`;
    if (q.kind === 'day') return `하루 한도${lim} 다 씀${m}`;
    if (q.kind === 'minute') return `1분 한도${lim} 걸림${m}`;
    return '사용 한도 초과(429)';
  }
  if (n.status === 0) return '연결 실패';
  return `${n.status} ${n.brief}`.trim().slice(0, 160);
}

// 화면에 보일 키 이름 — 사용자가 넣은 키는 '내 키', 나머지는 사이트 키 1·2…
export function gKeyLabels(keys: string[], userKey = ''): string[] {
  let n = 0;
  return keys.map(k => (userKey && k === userKey ? '내 키' : `사이트 키 ${++n}`));
}

// 끝까지 못 받았을 때의 까닭과 키별 요약 — 모든 키가 죽었으면 credit(하나라도 크레딧 소진)·badkey,
// 하나라도 충전금 0원이면 credit(고칠 곳이 거기다), 아니면 한도(429) 모양으로 quota0·rate1m·rate, 그 밖은 gemini.
export function gFailOf(keys: string[], labels: string[], notes: GNote[][]): { e: GFail; msg: string } {
  const deads = keys.map((_, i) => (notes[i] || []).find(n => n.dead)?.dead || '');
  let e: GFail;
  if (keys.length > 0 && deads.every(Boolean)) e = deads.includes('credit') ? 'credit' : 'badkey';
  else if (deads.includes('credit')) e = 'credit';
  else {
    const kinds = notes.flat().filter(n => n.status === 429 && !n.dead).map(n => (n.q ? n.q.kind : ''));
    if (kinds.length === 0) e = 'gemini';
    else if (kinds.every(k => k === 'zero')) e = 'quota0';
    else if (kinds.every(k => k === 'minute')) e = 'rate1m';
    else e = 'rate';
  }
  const parts: string[] = [];
  keys.forEach((_, i) => {
    const ns = notes[i] || [];
    if (ns.length === 0) return;
    const r429 = ns.filter(n => n.status === 429).sort((a, b) => QRANK[b.q ? b.q.kind : ''] - QRANK[a.q ? a.q.kind : '']);
    const pick = ns.find(n => n.dead) || r429[0] || ns[ns.length - 1];
    parts.push(`${labels[i] || `키 ${i + 1}`}: ${gKeyReason(pick)}`);
  });
  return { e, msg: parts.join(' · ').slice(0, 400) };
}

// 모델 × 키를 차례로 불러 처음 받은 답을 돌려준다(세 경로 공용 — ai-search·holdings-photo·tax-photo).
// 죽은 키(틀림·충전금 0원)는 다른 모델로도 다시 쓰지 않는다 · 한도(429)는 다음 키 · 1분 한도이고 기다릴 시간이 짧으면 한 번만 기다렸다 같은 키로 다시 ·
// 없는 모델(404)·잠깐 안 됨(5xx)은 다음 모델 · 그 밖의 400 등은 stopOnBadRequest면 그대로 실패, 아니면 다음 모델.
export async function gFirstOk(o: {
  keys: string[]; labels: string[]; body: string; stopOnBadRequest: boolean;
  models?: string[]; wait?: (ms: number) => Promise<unknown>; maxWaitSec?: number;
}): Promise<{ ok: true; r: Response; model: string } | { ok: false; e: GFail; msg: string }> {
  const models = o.models || GMODELS;
  const wait = o.wait || ((ms: number) => new Promise(res => setTimeout(res, ms)));
  const maxWait = o.maxWaitSec ?? 25;
  const notes: GNote[][] = o.keys.map(() => []);
  const dead = new Set<number>();
  let waited = false;
  for (const model of models) {
    for (let i = 0; i < o.keys.length; i++) {
      if (dead.has(i)) continue;
      let r: Response;
      try {
        r = await fetch(`${GAPI}/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': o.keys[i] }, body: o.body,
        });
      } catch { notes[i].push({ status: 0, dead: '', q: null, brief: 'net' }); continue; }
      if (r.ok && r.body) return { ok: true, r, model };
      const t = (await r.text().catch(() => '')).slice(0, 20_000);   // 자르고 나서 읽으면 JSON이 깨진다(한도 본문은 길다)
      const why = gKeyDead(r.status, t);
      const q = r.status === 429 ? gQuota(t) : null;
      notes[i].push({ status: r.status, dead: why, q, brief: gErrBrief(t) });
      if (why) { dead.add(i); continue; }
      if (r.status === 429) {
        if (!waited && q && q.kind === 'minute' && q.retrySec != null && q.retrySec <= maxWait) {
          waited = true;
          await wait(Math.ceil(q.retrySec * 1000) + 500);
          i--;   // 같은 키·같은 모델로 한 번 더
        }
        continue;
      }
      if (r.status === 404 || r.status >= 500) break;
      if (o.stopOnBadRequest) return { ok: false, e: 'gemini', msg: `${r.status} ${gErrBrief(t)}`.trim() };
      break;
    }
    if (o.keys.length > 0 && o.keys.every((_, i) => dead.has(i))) break;
  }
  return { ok: false, ...gFailOf(o.keys, o.labels, notes) };
}
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
