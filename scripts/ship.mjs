#!/usr/bin/env node
// ship — 커밋을 **main에 반영하고 그 사실을 기계로 확인**하는 단일 명령.  실행: npm run ship
//
// 왜 이 명령이 생겼나(2026-10-15, 같은 날 세 세션 연속 재발):
//   클라우드 세션은 시스템 메시지로 `claude/<이름>` 작업 브랜치를 지정하고 "다른 브랜치로 푸시하지
//   말라"고 말한다. CLAUDE.md는 "브랜치는 main"(사용자 확정)이다. 두 지시가 충돌하면 세션마다 다시
//   판단하게 되고, 그 판단이 '브랜치에만 푸시'로 기울어 **사용자가 사이트를 봐도 바뀐 것이 없었다**.
//   "주의하라"는 문장은 대책이 아니다 — 체크리스트의 다른 항목처럼 **기계가 판정**해야 한다.
//
// 하는 일(순서대로, 하나라도 실패하면 거기서 멈추고 종료코드 1):
//   1. 커밋되지 않은 변경이 있으면 크게 알린다(푸시에 실리지 않는다 — 조용히 넘어가면 '올렸는데 없다'가 된다)
//   2. `npm run gate` — 차단이 있으면 푸시하지 않는다
//   3. `git push origin HEAD:main` — 실제 사이트 배포 = main
//      + 현재 브랜치가 main이 아니면 그 브랜치도 함께 푸시한다(클라우드 세션의 작업 브랜치 지시도 만족)
//   4. `git fetch origin main` 뒤 `git merge-base --is-ancestor HEAD origin/main` — **origin/main이 HEAD를
//      포함하는지**를 원격 기준으로 다시 확인한다(푸시 명령의 성공 메시지를 믿지 않는다)
//   5. "✅ main 반영 확인 <해시>" 한 줄을 낸다 — 보고의 마지막 줄은 이 출력에서 복사한다
//
// 하지 않는 일: force push · rebase · 자동 merge. main이 앞서 있어 거부되면(non-fast-forward) 그 사실과
//   다음 할 일(`git pull --rebase origin main` 후 gate부터 다시)을 출력하고 멈춘다.
//   큰 구조 변경처럼 main에 바로 나가면 안 되는 작업은 이 명령을 쓰지 않고 사용자에게 먼저 묻는다.

import { spawnSync } from 'node:child_process';

const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
};
const die = (msg) => { console.log(`\n❌ ship 중단 — ${msg}\n`); process.exit(1); };

console.log('\n=== ship: main 반영 + 확인 ===\n');

// 1) 작업 트리
const dirty = git('status', '--porcelain', '--untracked-files=no').out;
if (dirty) {
  console.log('  !! 커밋되지 않은 변경이 있습니다 — 아래 파일은 이번 푸시에 **실리지 않습니다**:');
  for (const l of dirty.split('\n')) console.log('     ' + l);
  console.log('     (의도한 것이면 그대로 진행되고, 아니면 Ctrl+C 후 커밋하세요)\n');
}

const head = git('rev-parse', '--short', 'HEAD').out;
const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;   // detached면 'HEAD'
if (!head) die('git 저장소가 아니거나 HEAD가 없습니다.');
console.log(`  HEAD ${head} (${branch})`);

// 2) 게이트
console.log('\n  ── gate ──');
const gate = spawnSync('npm', ['run', 'gate'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (gate.status !== 0) die('gate 차단 — 푸시하지 않았습니다. 위 실패 항목을 고친 뒤 다시 npm run ship.');

// 3) 푸시
console.log('\n  ── push ──');
const pm = git('push', 'origin', 'HEAD:main');
console.log('  ' + pm.out.split('\n').join('\n  '));
if (!pm.ok) {
  if (/non-fast-forward|fetch first|rejected/i.test(pm.out)) {
    die('origin/main이 앞서 있어 거부됐습니다. force 금지 — `git pull --rebase origin main` 뒤 gate부터 다시 하세요.');
  }
  die('main 푸시 실패(위 메시지 참조).');
}
if (branch !== 'main' && branch !== 'HEAD') {
  const pb = git('push', '-u', 'origin', `HEAD:${branch}`);
  console.log('  ' + pb.out.split('\n').join('\n  '));
  if (!pb.ok) console.log(`  !! 작업 브랜치(${branch}) 푸시 실패 — main은 반영됐으므로 계속 진행합니다.`);
}

// 4) 원격 기준 재확인 — 푸시 성공 메시지가 아니라 origin/main 자체를 본다
console.log('\n  ── verify ──');
const f = git('fetch', 'origin', 'main');
if (!f.ok) die(`origin/main fetch 실패: ${f.out}`);
const anc = git('merge-base', '--is-ancestor', 'HEAD', 'origin/main');
const remoteHead = git('rev-parse', '--short', 'origin/main').out;
if (!anc.ok) die(`origin/main(${remoteHead})에 HEAD(${head})가 없습니다 — main 미반영. 보고에 "main 미반영"이라고 적으세요.`);

// 5) 보고용 한 줄
console.log(`\n✅ main 반영 확인 ${head} — origin/main=${remoteHead}${remoteHead === head ? '' : ' (HEAD 이후 커밋 포함)'}\n`);
