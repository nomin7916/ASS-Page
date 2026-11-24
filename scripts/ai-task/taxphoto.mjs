#!/usr/bin/env node
// Claude 예약 작업 "[ASS-PAGE-과표 사진 읽기 · API]"가 쓰는 도구(2026-11-24). 순서는 docs/ai-task/TAX-PHOTO.md.
// 사이트의 /api/ai-job(일마다의 열쇠로 여는 길)과만 주고받는다. 열쇠는 /tmp/aitax/key(0600)에만 두고 화면에 찍지 않는다.
//   printf %s '<열쇠>' | node scripts/ai-task/taxphoto.mjs init <사이트> <번호>
//   node scripts/ai-task/taxphoto.mjs test <사이트>
//   node scripts/ai-task/taxphoto.mjs take
//   node scripts/ai-task/taxphoto.mjs check <글 파일>
//   node scripts/ai-task/taxphoto.mjs put <글 파일> [메모 파일]
//   node scripts/ai-task/taxphoto.mjs fail "<까닭>"
// Node 18+ (fetch). 다른 패키지를 쓰지 않는다.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SITE = 'https://14ass-page-eea5.vercel.app';
const DIR = '/tmp/aitax';
const CFG = `${DIR}/cfg.json`;
const KEYF = `${DIR}/key`;
const JOBF = `${DIR}/job.json`;
const RID_RE = /^t[0-9a-z]{12,20}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

const die = (msg, code = 1) => { console.log(msg); process.exit(code); };
const cfg = () => {
  if (!existsSync(CFG) || !existsSync(KEYF)) die('먼저 init 을 하세요');
  const c = JSON.parse(readFileSync(CFG, 'utf8'));
  return { ...c, key: readFileSync(KEYF, 'utf8').trim() };
};

async function call(op, body) {
  const c = cfg();
  const url = `${SITE}/api/ai-job?op=${op}&rid=${encodeURIComponent(c.rid)}`;
  const init = { headers: { 'x-job-key': c.key }, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) {
    init.method = 'POST';
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(url, init); } catch (e) { die(`사이트에 닿지 못했습니다(${e?.cause?.code || e?.name || 'net'})`, 3); }
  let j = {};
  try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, j };
}

// 글 검사 — 과표 계산기 '붙여넣기'가 읽는 모양(src/taxCalcPaste.ts)보다 좁게: 한 줄에 하나, 정해진 꼴만
export function checkText(text, job) {
  const rows = [];
  const bad = [];
  const today = String(job?.today || '9999-12-31');
  const years = [Number(job?.year), Number(job?.year) - 1];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2}) (?:(매수|매도) ([\d,]+)주 ([\d,]+(?:\.\d+)?)원|과표 ([\d,]+(?:\.\d+)?))$/.exec(line);
    if (!m) { bad.push(`꼴이 다름: ${line}`); continue; }
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) { bad.push(`없는 날짜: ${line}`); continue; }
    if (date > today) { bad.push(`오늘(${today})보다 뒤: ${line}`); continue; }
    if (job?.year && !years.includes(Number(m[1]))) { bad.push(`연도가 ${years.join('·')}가 아님: ${line}`); continue; }
    const num = (s) => Number(String(s).replace(/,/g, ''));
    if (m[4]) {
      const q = num(m[5]);
      const p = num(m[6]);
      if (!(Number.isInteger(q) && q > 0)) { bad.push(`수량: ${line}`); continue; }
      if (!(p > 0)) { bad.push(`단가: ${line}`); continue; }
      rows.push({ date, side: m[4], qty: q, price: p });
    } else {
      const t = num(m[7]);
      if (!(t > 0)) { bad.push(`과표: ${line}`); continue; }
      rows.push({ date, side: '과표', taxBase: t });
    }
  }
  return { rows, bad, trades: rows.filter(r => r.side !== '과표').length, taxBases: rows.filter(r => r.side === '과표').length };
}

const readJob = () => (existsSync(JOBF) ? JSON.parse(readFileSync(JOBF, 'utf8')) : null);

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
  if (cmd === 'test') {
    if (a !== SITE) die('사이트 주소가 다릅니다');
    let res;
    try { res = await fetch(`${SITE}/api/ai-job?op=take&rid=t000000000000`, { signal: AbortSignal.timeout(20000) }); } catch (e) {
      die(`사이트에 닿지 못했습니다(${e?.cause?.code || e?.name || 'net'}) — 이 작업 환경의 네트워크 허용에 14ass-page-eea5.vercel.app 을 넣어 주세요`, 3);
    }
    die(res.status === 401 ? '연결 시험 성공 — 사이트에 닿았고 열쇠 없는 요청은 막혔습니다' : `사이트가 예상과 다르게 답했습니다(HTTP ${res.status})`, res.status === 401 ? 0 : 2);
  }
  if (cmd === 'take') {
    const r = await call('take');
    if (r.status !== 200) die(`받지 못했습니다(HTTP ${r.status} ${r.j?.error || ''})`, 2);
    const { img, mime, ...rest } = r.j;
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const photo = `${DIR}/photo.${ext}`;
    writeFileSync(photo, Buffer.from(String(img || ''), 'base64'));
    writeFileSync(JOBF, JSON.stringify({ ...rest, photo }));
    console.log(JSON.stringify({ ...rest, photo }, null, 1));
    return;
  }
  if (cmd === 'check' || cmd === 'put') {
    if (!a || !existsSync(a)) die('글 파일이 없습니다');
    const text = readFileSync(a, 'utf8');
    const c = checkText(text, readJob());
    console.log(`매매 ${c.trades}줄 · 과표 ${c.taxBases}줄${c.bad.length ? ` · 문제 ${c.bad.length}줄` : ''}`);
    for (const x of c.bad) console.log(`  - ${x}`);
    if (c.bad.length || c.trades + c.taxBases === 0) die(cmd === 'put' ? '보내지 않았습니다 — 글을 고친 뒤 다시' : '고칠 곳이 있습니다', 2);
    if (cmd === 'check') return;
    const note = b && existsSync(b) ? readFileSync(b, 'utf8').trim() : '';
    const r = await call('put', { text: text.trim(), note });
    die(r.status === 200 ? '보냈습니다 — 사이트의 과표 계산기에 미리 보기로 들어갑니다' : `보내지 못했습니다(HTTP ${r.status} ${r.j?.error || ''})`, r.status === 200 ? 0 : 2);
  }
  if (cmd === 'fail') {
    const r = await call('fail', { why: String(a || '').slice(0, 1500) });
    die(r.status === 200 ? '못 함으로 알렸습니다' : `알리지 못했습니다(HTTP ${r.status} ${r.j?.error || ''})`, r.status === 200 ? 0 : 2);
  }
  die('명령: init · test · take · check · put · fail');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
