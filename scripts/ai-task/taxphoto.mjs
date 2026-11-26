#!/usr/bin/env node
// Claude 예약 작업 "[ASS-PAGE-과표 사진 읽기 · API]"가 쓰는 도구(2026-11-24). 순서는 docs/ai-task/TAX-PHOTO.md.
// 사이트의 /api/ai-job(일마다의 열쇠로 여는 길)과만 주고받는다. 열쇠는 /tmp/aitax/key(0600)에만 두고 화면에 찍지 않는다.
//   printf %s '<열쇠>' | node scripts/ai-task/taxphoto.mjs init <사이트> <번호>
//   node scripts/ai-task/taxphoto.mjs test <사이트>
//   node scripts/ai-task/taxphoto.mjs take
//   node scripts/ai-task/taxphoto.mjs check <글 파일>
//   node scripts/ai-task/taxphoto.mjs put <글 파일> [메모 파일]
//   node scripts/ai-task/taxphoto.mjs fail "<까닭>"
// Node 18+ (fetch). 다른 패키지를 쓰지 않는다. 클라우드 작업 환경은 바깥 연결이 프록시(HTTPS_PROXY)를 지나야 하는데
// Node fetch는 그것을 따르지 않는다(ENOTFOUND) → fetch가 닿지 못하면 curl(프록시·인증서 설정을 따른다)로 다시 보낸다.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SITE = 'https://14ass-page-eea5.vercel.app';
const DIR = '/tmp/aitax';
const CFG = `${DIR}/cfg.json`;
const KEYF = `${DIR}/key`;
const JOBF = `${DIR}/job.json`;
const HDRF = `${DIR}/hdr`;
const RID_RE = /^t[0-9a-z]{12,20}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

const die = (msg, code = 1) => { console.log(msg); process.exit(code); };
const cfg = () => {
  if (!existsSync(CFG) || !existsSync(KEYF)) die('먼저 init 을 하세요');
  const c = JSON.parse(readFileSync(CFG, 'utf8'));
  return { ...c, key: readFileSync(KEYF, 'utf8').trim() };
};

// → { status, text } · 닿지 못하면 { status: 0, why }
export async function http(url, { key = '', body } = {}) {
  const headers = {};
  if (key) headers['x-job-key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers, body, signal: AbortSignal.timeout(60000) });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    const why = e?.cause?.code || e?.name || 'net';
    try {
      const args = ['-sS', '--max-time', '60', '-w', '\n%{http_code}'];
      if (key) {
        mkdirSync(DIR, { recursive: true, mode: 0o700 });
        writeFileSync(HDRF, `x-job-key: ${key}\n`, { mode: 0o600 });
        args.push('-H', `@${HDRF}`);
      }
      if (body !== undefined) args.push('-X', 'POST', '-H', 'Content-Type: application/json', '--data-binary', '@-');
      args.push(url);
      const out = execFileSync('curl', args, { input: body ?? '', maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const cut = out.lastIndexOf('\n');
      const status = Number(out.slice(cut + 1)) || 0;
      return status ? { status, text: out.slice(0, cut) } : { status: 0, why: `${why} · curl 답 없음` };
    } catch (e2) {
      return { status: 0, why: `${why} · curl ${String(e2?.stderr || e2?.message || '').trim().slice(0, 120)}` };
    }
  }
}

async function call(op, body) {
  const c = cfg();
  const r = await http(`${SITE}/api/ai-job?op=${op}&rid=${encodeURIComponent(c.rid)}`, { key: c.key, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.status) die(`사이트에 닿지 못했습니다(${r.why})`, 3);
  let j = {};
  try { j = JSON.parse(r.text); } catch { j = {}; }
  return { status: r.status, j };
}

// 글 검사 — 과표 계산기 '붙여넣기'가 읽는 모양(src/taxCalcPaste.ts)보다 좁게: 한 줄에 하나, 정해진 꼴만.
// `종목 <코드>` 줄 = 그 아래 줄들의 종목. 종목을 정하지 않은 일(code '')은 매매 줄 앞에 꼭 있어야 하고 코드는 cands 안이어야 한다.
// 종목을 정한 일은 없어도 되고, 있으면 그 코드여야 한다.
export function checkText(text, job) {
  const rows = [];
  const bad = [];
  const today = String(job?.today || '9999-12-31');
  const years = [Number(job?.year), Number(job?.year) - 1];
  const fixed = String(job?.code || '').toUpperCase();
  const allow = new Set(fixed ? [fixed] : (Array.isArray(job?.cands) ? job.cands.map(c => String(c?.code || '').toUpperCase()) : []));
  const needStock = !fixed && allow.size > 0;   // 종목을 정하지 않고 후보로 맡긴 일 — 매매 줄 앞에 `종목` 줄이 꼭 있어야 한다
  let cur = fixed;
  const stocks = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^종목(\s|$)/.test(line)) {
      const sm = /^종목 ([0-9A-Z]{6})$/.exec(line);
      if (!sm) { bad.push(`종목 줄 꼴이 다름(예: 종목 0177R0): ${line}`); cur = null; continue; }
      if (allow.size && !allow.has(sm[1])) { bad.push(`이 계좌에 없는 종목(cands 밖): ${line}`); cur = null; continue; }
      cur = sm[1];
      continue;
    }
    if (cur === null) { bad.push(`위 종목 줄이 틀려 어느 종목인지 모름: ${line}`); continue; }
    if (needStock && !cur) { bad.push(`어느 종목인지 없음(앞에 「종목 <코드>」 줄): ${line}`); continue; }
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
      rows.push({ code: cur, date, side: m[4], qty: q, price: p });
      stocks.add(cur);
    } else {
      const t = num(m[7]);
      if (!(t > 0)) { bad.push(`과표: ${line}`); continue; }
      rows.push({ code: cur, date, side: '과표', taxBase: t });
      stocks.add(cur);
    }
  }
  return { rows, bad, trades: rows.filter(r => r.side !== '과표').length, taxBases: rows.filter(r => r.side === '과표').length, stocks: stocks.size };
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
    const res = await http(`${SITE}/api/ai-job?op=take&rid=t000000000000`);
    if (!res.status) die(`사이트에 닿지 못했습니다(${res.why}) — 이 작업 환경의 네트워크 허용에 14ass-page-eea5.vercel.app 을 넣어 주세요`, 3);
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
    console.log(`종목 ${c.stocks}개 · 매매 ${c.trades}줄 · 과표 ${c.taxBases}줄${c.bad.length ? ` · 문제 ${c.bad.length}줄` : ''}`);
    for (const x of c.bad) console.log(`  - ${x}`);
    if (c.bad.length || c.trades + c.taxBases === 0) die(cmd === 'put' ? '보내지 않았습니다 — 글을 고친 뒤 다시' : '고칠 곳이 있습니다', 2);
    if (cmd === 'check') return;
    const note = b && existsSync(b) ? readFileSync(b, 'utf8').trim() : '';
    const r = await call('put', { text: text.trim(), note });
    die(r.status === 200 ? '보냈습니다 — 사이트가 종목마다 과표 계산기에 넣습니다(이미 매매가 있는 날은 빼고)' : `보내지 못했습니다(HTTP ${r.status} ${r.j?.error || ''})`, r.status === 200 ? 0 : 2);
  }
  if (cmd === 'fail') {
    const r = await call('fail', { why: String(a || '').slice(0, 1500) });
    die(r.status === 200 ? '못 함으로 알렸습니다' : `알리지 못했습니다(HTTP ${r.status} ${r.j?.error || ''})`, r.status === 200 ? 0 : 2);
  }
  die('명령: init · test · take · check · put · fail');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
