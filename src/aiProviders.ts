// 「AI 검색」 채팅창 — 여러 AI 연결(사용자 요청 2026-11-26: "재미나이든, 그록이든, 젠스파크, 클로드 세상의 모든 AI를 사이트에 연동 ·
// 사용자마다 개인 계정으로 · 무료 모델 · 구독 모델도 · API가 아니어도").
// 길 둘:
//   ① 내 API 키 — AI_PROVIDERS. /api/ai-chat 이 그 회사 API로 전달한다(키 = 내 Drive ai_settings.json 의 aiKeys · 요청 헤더 X-AI-Key 로만).
//   ② 내 구독으로 묻기(API 없이) — AI_HANDS. 그 AI 사이트를 내 계정(구독 그대로)으로 열고 질문을 넣어 준다 → 답을 복사해 「답 붙여넣기」.
// ⚠️ 구독 로그인(쿠키·세션 토큰)을 이 사이트가 받아 대신 쓰는 길은 만들지 않는다(각 회사 약관 위반 · 계정 정지·탈취 위험).
// ⚠️ import 0건 · enum/namespace 금지 — scripts/verify-ai-chat.mjs 가 직접 import한다. ⚠️ 뒤보기 정규식 금지(옛 사파리).

export const GEMINI_PICK = 'gemini';
export const CLOUD_PICK = 'cloud';     // 클라우드 Claude(관리자 — 예약 작업을 API로 · 키 없이, 2026-11-26) · 쓸 수 없으면 화면이 Gemini로 본다
export const AI_KEY_MIN = 16;
const KEY_SHAPE = /^[A-Za-z0-9_\-.:=+/]{16,400}$/;
const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,119}$/;

export interface AiProvider {
  id: string;
  label: string;          // 고르는 칸에 보이는 이름
  short: string;          // 답 아래 꼬리표
  cost: 'free' | 'sub' | 'paid';
  costNote: string;
  note: string;
  keyPage: string;
  keyHint: string;
  prefix: string[];       // 키 앞머리(다르면 '다른 회사 키가 아닌지' 묻기만 한다 — 막지 않음)
  model: string;          // 목록을 받기 전의 기본 모델
  prefer: string[];       // 목록을 받았을 때 고를 차례(정규식 글)
  web: '' | 'on' | 'paid';   // 웹 검색: 없음 / 기본 켬 / 유료라 기본 끔
}

// 차례 = 화면에 보이는 차례(무료 → 구독 → 유료).
export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'openrouter', label: 'OpenRouter — 무료 모델 여러 개', short: 'OpenRouter', cost: 'free',
    costNote: '무료 모델은 카드 없이 하루 50번쯤(충전을 $10 넘게 한 적이 있으면 1,000번). Claude·GPT·Grok 같은 유료 모델도 이 키 하나로 충전해 씁니다.',
    note: '구글·깃허브 계정으로 가입 → Keys 에서 키 만들기. 이름 끝이 :free 인 모델이 무료입니다.',
    keyPage: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-… 로 시작하는 키', prefix: ['sk-or-'],
    model: 'openrouter/free', prefer: ['^openrouter/free$', ':free$'], web: 'paid',
  },
  {
    id: 'groq', label: 'Groq — 무료·아주 빠름', short: 'Groq', cost: 'free',
    costNote: '카드 없이 무료 등급(모델마다 하루 횟수 제한).',
    note: 'console.groq.com 에 구글 계정으로 가입 → API Keys. (일론 머스크의 Grok 과는 다른 회사입니다)',
    keyPage: 'https://console.groq.com/keys', keyHint: 'gsk_… 로 시작하는 키', prefix: ['gsk_'],
    model: 'llama-3.3-70b-versatile', prefer: ['llama-3\\.3-70b', 'gpt-oss-120b', 'llama'], web: '',
  },
  {
    id: 'github', label: 'GitHub Models — 깃허브 계정으로 무료', short: 'GitHub', cost: 'free',
    costNote: '깃허브 계정이면 무료(모델마다 하루 횟수 제한). GitHub Copilot 구독이 있으면 한도가 더 큽니다.',
    note: '깃허브 Settings → Developer settings → Fine-grained token 을 만들 때 권한 Models 를 Read-only 로 줍니다. GPT·Llama·Grok 등 여러 회사 모델을 씁니다.',
    keyPage: 'https://github.com/settings/personal-access-tokens', keyHint: 'github_pat_… 토큰', prefix: ['github_pat_', 'ghp_', 'gho_'],
    model: 'openai/gpt-4.1-mini', prefer: ['gpt-4\\.1-mini', 'gpt-4o-mini', 'gpt-5-mini', 'mini'], web: '',
  },
  {
    id: 'cerebras', label: 'Cerebras — 무료·빠름', short: 'Cerebras', cost: 'free',
    costNote: '카드 없이 무료 등급(하루 토큰 제한).',
    note: 'cloud.cerebras.ai 에 가입 → API Keys.',
    keyPage: 'https://cloud.cerebras.ai/', keyHint: 'csk-… 로 시작하는 키', prefix: ['csk-'],
    model: 'llama-3.3-70b', prefer: ['gpt-oss-120b', 'llama-3\\.3-70b', 'llama', 'qwen'], web: '',
  },
  {
    id: 'mistral', label: 'Mistral — 무료 등급', short: 'Mistral', cost: 'free',
    costNote: '무료(Experiment) 요금제로 시험해 볼 수 있습니다(속도 제한).',
    note: 'console.mistral.ai 에 가입 → API Keys.',
    keyPage: 'https://console.mistral.ai/api-keys', keyHint: 'Mistral API 키', prefix: [],
    model: 'mistral-small-latest', prefer: ['^mistral-small-latest$', '^mistral-medium-latest$', 'latest$'], web: '',
  },
  {
    id: 'poe', label: 'Poe — 구독 포인트로 Claude·GPT·Gemini·Grok', short: 'Poe', cost: 'sub',
    costNote: 'Poe 구독(또는 무료 계정의 하루 포인트)의 포인트로 씁니다 — 구독 하나로 여러 회사 모델.',
    note: 'poe.com 에 로그인 → poe.com/api_key 에서 키를 복사합니다.',
    keyPage: 'https://poe.com/api_key', keyHint: 'Poe API 키', prefix: [],
    model: 'GPT-5-mini', prefer: ['^gpt-5-mini$', '^claude-sonnet', '^gemini-.*flash', '^gpt-'], web: '',
  },
  {
    id: 'anthropic', label: 'Claude — Anthropic API', short: 'Claude', cost: 'paid',
    costNote: '선불 충전(최소 $5)으로 쓴 만큼 냅니다. Claude Pro·Max 구독과는 따로입니다(구독은 「내 구독으로 묻기」).',
    note: 'platform.claude.com 에서 결제(Billing) 충전 → API Keys. 웹 검색으로 최신 자료를 찾아 답합니다(검색 1,000번에 $10쯤 더 듭니다).',
    keyPage: 'https://platform.claude.com/settings/keys', keyHint: 'sk-ant-… 로 시작하는 키', prefix: ['sk-ant-'],
    model: 'claude-opus-5-5', prefer: ['^claude-opus-5-5$', '^claude-sonnet-5-5$', '^claude-haiku-5-5$', '^claude-'], web: 'on',
  },
  {
    id: 'openai', label: 'ChatGPT 모델 — OpenAI API', short: 'OpenAI', cost: 'paid',
    costNote: '선불 충전으로 쓴 만큼 냅니다. ChatGPT Plus·Pro 구독과는 따로입니다(구독은 「내 구독으로 묻기」).',
    note: 'platform.openai.com 에서 결제(Billing) 충전 → API keys.',
    keyPage: 'https://platform.openai.com/api-keys', keyHint: 'sk-… 로 시작하는 키', prefix: ['sk-'],
    model: 'gpt-5-mini', prefer: ['^gpt-5-mini$', '^gpt-5\\.\\d+-mini$', '^gpt-4o-mini$', '^gpt-5', '^gpt-4o'], web: '',
  },
  {
    id: 'xai', label: 'Grok — xAI API', short: 'Grok', cost: 'paid',
    costNote: '선불 충전으로 쓴 만큼 냅니다. X 프리미엄·SuperGrok 구독과는 따로입니다(구독은 「내 구독으로 묻기」).',
    note: 'console.x.ai 에서 충전 → API Keys.',
    keyPage: 'https://console.x.ai/', keyHint: 'xai-… 로 시작하는 키', prefix: ['xai-'],
    model: 'grok-4', prefer: ['^grok-4-fast', '^grok-4', '^grok-3-mini', '^grok'], web: '',
  },
  {
    id: 'deepseek', label: 'DeepSeek API — 저렴', short: 'DeepSeek', cost: 'paid',
    costNote: '선불 충전(아주 저렴).',
    note: 'platform.deepseek.com 에서 충전 → API keys.',
    keyPage: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-… 로 시작하는 키', prefix: ['sk-'],
    model: 'deepseek-chat', prefer: ['^deepseek-chat$', '^deepseek'], web: '',
  },
];

export const AI_PROVIDER_IDS = AI_PROVIDERS.map(p => p.id);
export function aiProviderById(id: unknown): AiProvider | null {
  return AI_PROVIDERS.find(p => p.id === id) || null;
}
export const AI_COST_LABEL: Record<string, string> = { free: '무료', sub: '구독 포인트', paid: '유료(충전)' };

// ── 키 ──
export function looksLikeAiKey(k: unknown): boolean {
  return KEY_SHAPE.test(String(k ?? '').trim());
}
// 앞머리가 그 회사 것과 다르면 알려 줄 글(막지는 않는다 — 회사가 모양을 바꾸기도 한다).
export function aiKeyWarning(id: string, k: unknown): string {
  const p = aiProviderById(id);
  const s = String(k ?? '').trim();
  if (!p || !s) return '';
  if (/^AIza/.test(s)) return '구글 Gemini 키(AIza…)로 보입니다 — Gemini 키는 위 「내 Gemini API 키」 칸에 넣습니다.';
  if (p.prefix.length && !p.prefix.some(x => s.startsWith(x))) return `보통 ${p.prefix[0]}… 로 시작합니다 — 다른 회사 키가 아닌지 확인해 주세요(저장은 됩니다).`;
  return '';
}
export function maskAiKey(k: unknown): string {
  const s = String(k ?? '').trim();
  return s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : '';
}
// ai_settings.json 의 aiKeys — 아는 회사 · 키 모양인 것만.
export function normalizeAiKeys(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of AI_PROVIDER_IDS) {
    const k = typeof raw[id] === 'string' ? raw[id].trim() : '';
    if (k && KEY_SHAPE.test(k)) out[id] = k;
  }
  return out;
}

// ── 고른 AI·모델(대화 묶음 ai_search_chats.json 의 ai — 키는 없다) ──
export interface AiPrefs { pick: string; models: Record<string, string>; web: Record<string, boolean>; ctx: boolean }
export function aiPrefsOf(raw: any): AiPrefs {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pick = r.pick === GEMINI_PICK || r.pick === CLOUD_PICK || AI_PROVIDER_IDS.includes(r.pick) ? r.pick : GEMINI_PICK;
  const models: Record<string, string> = {};
  const web: Record<string, boolean> = {};
  for (const p of AI_PROVIDERS) {
    const m = typeof r.models?.[p.id] === 'string' ? r.models[p.id].trim() : '';
    if (m && MODEL_SHAPE.test(m)) models[p.id] = m;
    if (p.web) web[p.id] = typeof r.web?.[p.id] === 'boolean' ? r.web[p.id] : p.web === 'on';
  }
  return { pick, models, web, ctx: !!r.ctx };
}

// ── 모델 목록(/api/ai-chat op=models 의 답) ──
export interface AiModel { id: string; name: string; free: boolean }
export function cleanModels(raw: any): AiModel[] {
  const out: AiModel[] = [];
  const seen = new Set<string>();
  for (const m of Array.isArray(raw) ? raw : []) {
    const id = String(m?.id ?? '').trim();
    if (!MODEL_SHAPE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(m?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80), free: !!m?.free });
    if (out.length >= 600) break;
  }
  return out;
}
export function looksLikeModelId(s: unknown): boolean {
  return MODEL_SHAPE.test(String(s ?? '').trim());
}
// 지금 모델이 목록에 있으면 그대로, 없으면 그 회사에서 권하는 차례 → 무료 → 첫 모델.
export function pickModel(id: string, list: AiModel[], current: string): string {
  if (!list.length) return current;
  if (current && list.some(m => m.id === current)) return current;
  const p = aiProviderById(id);
  for (const src of p ? p.prefer : []) {
    let re: RegExp;
    try { re = new RegExp(src, 'i'); } catch { continue; }
    const hit = list.find(m => re.test(m.id));
    if (hit) return hit.id;
  }
  return (list.find(m => m.free) || list[0]).id;
}

// ── 오류 글(다른 AI) ──
export function aiErrorText(code: string, name: string): string {
  const n = name || 'AI';
  switch (code) {
    case 'needkey': return `${n} 키가 필요합니다 — ⚙ 설정의 「다른 AI 연결」에서 키를 넣어 주세요. 키 없이 물으려면 「내 구독으로 묻기」를 쓰세요.`;
    case 'badkey': return `${n} 키가 맞지 않거나 권한이 없습니다 — ⚙ 설정에서 키를 다시 복사해 넣어 주세요.`;
    case 'credit': return `${n} 계정의 충전금(크레딧·포인트)이 모자랍니다 — 그 회사 결제 화면에서 충전하거나, 무료 모델·다른 AI를 골라 주세요.`;
    case 'rate': return `${n} 사용 한도에 걸렸습니다 — 잠시 뒤 다시 묻거나(무료 한도는 보통 하루 단위), 다른 AI를 골라 주세요.`;
    case 'nomodel': return `고른 모델을 ${n}에서 쓸 수 없습니다 — ⚙ 설정에서 「모델 불러오기」를 눌러 다시 골라 주세요.`;
    case 'busy': return `${n} 서버가 지금 바쁩니다 — 잠시 뒤 「다시 묻기」를 눌러 주세요.`;
    case 'block': return `${n}가 이 질문에는 답하지 않았습니다 — 질문을 조금 바꿔 다시 물어봐 주세요.`;
    case 'cut': return 'AI 답이 중간에 끊겼습니다 — 「다시 묻기」를 눌러 주세요.';
    case 'auth': return '로그인이 확인되지 않았습니다 — 화면을 새로고침한 뒤 다시 물어봐 주세요.';
    case 'net': return '인터넷 연결이 끊겨 질문을 보내지 못했습니다 — 다시 물어봐 주세요.';
    case 'stop': return '답 받기를 멈췄습니다.';
    default: return `${n}가 답하지 못했습니다 — 잠시 뒤 다시 묻거나 다른 AI를 골라 주세요.`;
  }
}

// ── 내 구독으로 묻기(API 없이) ──
export interface AiHand { id: string; label: string; open: string; q: string; fixed: string; sub: string }
// q = 질문을 싣는 주소 칸 이름(없으면 사이트만 연다 — 질문은 복사해 둔 것을 붙여넣는다).
// 주소 칸은 그 회사가 약속한 것이 아니라서 바뀔 수 있다 → 늘 질문을 함께 복사해 둔다.
export const AI_HANDS: AiHand[] = [
  { id: 'chatgpt', label: 'ChatGPT', open: 'https://chatgpt.com/', q: 'q', fixed: '', sub: 'ChatGPT 무료·Plus·Pro' },
  { id: 'claude', label: 'Claude', open: 'https://claude.ai/new', q: 'q', fixed: '', sub: 'Claude 무료·Pro·Max' },
  { id: 'gemini', label: 'Gemini', open: 'https://gemini.google.com/app', q: '', fixed: '', sub: 'Gemini 무료·Google AI Pro' },
  { id: 'grok', label: 'Grok', open: 'https://grok.com/', q: 'q', fixed: '', sub: 'Grok 무료·SuperGrok' },
  { id: 'perplexity', label: 'Perplexity', open: 'https://www.perplexity.ai/search', q: 'q', fixed: '', sub: 'Perplexity 무료·Pro' },
  { id: 'genspark', label: 'Genspark', open: 'https://www.genspark.ai/search', q: 'query', fixed: '', sub: 'Genspark 무료·Plus' },
  { id: 'copilot', label: 'Copilot', open: 'https://copilot.microsoft.com/', q: 'q', fixed: '', sub: 'Copilot 무료·Pro' },
  { id: 'googleai', label: '구글 AI 모드', open: 'https://www.google.com/search', q: 'q', fixed: 'udm=50', sub: '구글 계정' },
  { id: 'deepseek', label: 'DeepSeek', open: 'https://chat.deepseek.com/', q: '', fixed: '', sub: 'DeepSeek 무료' },
  { id: 'lechat', label: 'Le Chat', open: 'https://chat.mistral.ai/chat', q: 'q', fixed: '', sub: 'Mistral 무료·Pro' },
  { id: 'wrtn', label: '뤼튼', open: 'https://wrtn.ai/', q: '', fixed: '', sub: '뤼튼 무료' },
];
export const HAND_SHARE = 'share';   // 휴대폰 공유 창(설치된 AI 앱으로 보내기)
export function aiHandById(id: unknown): AiHand | null {
  return AI_HANDS.find(h => h.id === id) || null;
}
export function handName(id: unknown): string {
  if (id === HAND_SHARE) return '공유한 AI 앱';
  const h = aiHandById(id);
  return h ? h.label : '다른 AI';
}

export const HAND_URL_MAX = 6000;       // 주소에 실을 질문(인코딩 뒤 글자) — 넘으면 사이트만 열고 붙여넣기
export const HAND_HIST_TURNS = 6;
export const HAND_HIST_EACH = 1200;
export const HAND_TAIL = '(최신 자료를 찾아 기준 날짜와 함께 한국어로 정리해 주세요.)';
const flat = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‍﻿]/g, '').trim();

// 넘길 글 — (앞 대화) + (보유 종목 이름) + 질문 + 부탁 한 줄.
export function handPrompt(o: { question: string; history?: { role: string; text: string }[]; holdings?: { code: string; name: string }[]; withHistory?: boolean }): string {
  const q = flat(o.question).slice(0, 4000);
  const parts: string[] = [];
  const hist = o.withHistory ? (Array.isArray(o.history) ? o.history : []).filter(m => m && typeof m.text === 'string' && m.text.trim()).slice(-HAND_HIST_TURNS) : [];
  if (hist.length) {
    parts.push('[앞에서 나눈 대화]');
    for (const m of hist) {
      const t = flat(m.text);
      parts.push(`${m.role === 'user' ? '질문' : '답'}: ${t.length > HAND_HIST_EACH ? t.slice(0, HAND_HIST_EACH) + '…' : t}`);
    }
    parts.push('', '[이어서 묻는 질문]');
  }
  const hold = (Array.isArray(o.holdings) ? o.holdings : []).map(h => String(h?.name || h?.code || '').trim()).filter(Boolean).slice(0, 60);
  if (hold.length) parts.push(`내 보유 종목: ${hold.join(', ')}`);
  parts.push(q, '', HAND_TAIL);
  return parts.join('\n').trim();
}

// 여는 주소 — 질문을 실을 수 있으면 싣는다(prefilled). 너무 길거나 칸이 없는 사이트는 사이트만.
export function handUrl(id: string, prompt: string): { url: string; prefilled: boolean } {
  const h = aiHandById(id);
  if (!h) return { url: '', prefilled: false };
  const enc = encodeURIComponent(String(prompt ?? ''));
  const can = !!h.q && enc.length > 0 && enc.length <= HAND_URL_MAX;
  const qs = [h.fixed, can ? `${h.q}=${enc}` : ''].filter(Boolean).join('&');
  return { url: qs ? `${h.open}?${qs}` : h.open, prefilled: can };
}

// ── 답 붙여넣기 ──
export const PASTE_MAX = 20_000;
export function cleanPaste(raw: unknown): string {
  return flat(raw).replace(/\n{4,}/g, '\n\n\n').slice(0, PASTE_MAX);
}
const squash = (s: unknown) => flat(s).replace(/\s+/g, ' ');
// 붙여넣은 글이 답이 아니라 '복사해 둔 질문 그대로'인가 — 답을 복사하기 전에 누른 경우를 막는다.
export function pasteIsQuestion(paste: string, question: string, prompt = ''): boolean {
  const p = squash(paste);
  if (!p) return false;
  return p === squash(question) || (!!prompt && p === squash(prompt));
}
export function handModelLabel(id: unknown): string {
  return `${handName(id)} · 내 계정에서 붙여넣음`;
}
