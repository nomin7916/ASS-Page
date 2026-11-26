#!/usr/bin/env node
// Claude 예약 작업 "[ASS-PAGE-과표 사진 읽기 · API]"가 AI 검색(종류=search)에서 쓰는 도구(2026-11-26). 순서는 docs/ai-task/TAX-PHOTO.md 「AI 검색」 절.
// 사이트의 /api/pc-cloud(일마다의 열쇠로 여는 길)와만 주고받는다. 열쇠는 /tmp/aiq/key(0600)에만 두고 화면에 찍지 않는다.
//   printf %s '<열쇠>' | node scripts/ai-task/aisearch.mjs init <사이트> <번호>
//   node scripts/ai-task/aisearch.mjs take
//   node scripts/ai-task/aisearch.mjs put <답 파일> [모델 이름]
//   node scripts/ai-task/aisearch.mjs fail "<까닭>"
// 바깥 연결은 taxphoto.mjs 의 http(fetch → 닿지 못하면 curl, 프록시를 따른다)를 그대로 쓴다.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { http } from './taxphoto.mjs';

export const SITE = 'https://14ass-page-eea5.vercel.app';
const DIR = '/tmp/aiq';
const CFG = `${DIR}/cfg.json`;
const KEYF = `${DIR}/key`;
export const RID_RE = /^[0-9a-f]{24}\.[A-Za-z0-9_-]{12,40}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
export const ANSWER_MAX = 30_000;

const die = (msg, code = 1) => { console.log(msg); process.exit(code); };
const cfg = () => {
  if (!existsSync(CFG) || !existsSync(KEYF)) die('먼저 init 을 하세요');
  return { ...JSON.parse(readFileSync(CFG, 'utf8')), key: readFileSync(KEYF, 'utf8').trim() };
};

async function call(op, body) {
  const c = cfg();
  const r = await http(`${SITE}/api/pc-cloud?op=${op}&rid=${encodeURIComponent(c.rid)}`, { key: c.key, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.status) die(`사이트에 닿지 못했습니다(${r.why})`, 3);
  let j = {};
  try { j = JSON.parse(r.text); } catch { j = {}; }
  return { status: r.status, j };
}

// 답 검사 — 비었거나 너무 길거나 열쇠가 섞였으면 보내지 않는다.
export function checkAnswer(text, key = '') {
  const t = String(text || '').trim();
  if (!t) return '답이 비었습니다';
  if (t.length > ANSWER_MAX) return `답이 너무 깁니다(${ANSWER_MAX.toLocaleString()}자까지)`;
  if (key && t.includes(key)) return '답에 열쇠가 들어 있습니다';
  return '';
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'init') {
    if (a !== SITE) die('사이트 주소가 다릅니다');
    if (!RID_RE.test(String(b || ''))) die('번호 모양이 아닙니다');
    const key = readFileSync(0, 'utf8').trim();
    if (!KEY_RE.test(key)) die('열쇠 모양이 아닙니다');
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    writeFileSync(KEYF, key, { mode: 0o600 });
    chmodSync(KEYF, 0o600);
    writeFileSync(CFG, JSON.stringify({ rid: b }));
    die('준비됨', 0);
  }
  if (cmd === 'take') {
    const r = await call('take');
    if (r.status !== 200) die(`받지 못했습니다(HTTP ${r.status} ${r.j?.error || ''})`, 2);
    console.log(JSON.stringify({ today: r.j.today, q: r.j.q }, null, 1));
    return;
  }
  if (cmd === 'put') {
    if (!a || !existsSync(a)) die('답 파일이 없습니다');
    const text = readFileSync(a, 'utf8');
    const bad = checkAnswer(text, cfg().key);
    if (bad) die(`보내지 않았습니다 — ${bad}`, 2);
    const r = await call('done', { a: text.trim(), m: String(b || 'Claude').slice(0, 60) });
    die(r.status === 200 ? '보냈습니다 — 사이트의 AI 검색 창에 답이 들어갑니다' : `보내지 못했습니다(HTTP ${r.status} ${r.j?.error || ''})`, r.status === 200 ? 0 : 2);
  }
  if (cmd === 'fail') {
    const r = await call('fail', { e: String(a || '').slice(0, 300) });
    die(r.status === 200 ? '못 함으로 알렸습니다' : `알리지 못했습니다(HTTP ${r.status} ${r.j?.error || ''})`, r.status === 200 ? 0 : 2);
  }
  die('명령: init · take · put · fail');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
