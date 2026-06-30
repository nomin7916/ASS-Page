// 관리자 공지 ↔ 학습자료/리포트 매칭(parseNoticeTitle / resolveNoticeMaterial) 단위 테스트.
// 실행: npm run verify:notice  (불일치 시 종료코드 1)
//
// utils.ts는 TS라 직접 import 불가 → 함수 본문을 그대로 미러(참조 구현)하고 검증.
// ⚠️ 본 파일의 미러와 src/utils.ts의 함수 본문은 항상 동기화 필요.
// 핵심 회귀 케이스: 부분 문자열 매칭이 한국어 조사 '가' 결합('신규' vs '신규가')과 리포트
// 보일러플레이트('리포트')로 다른 자료를 오매칭하던 문제 → 정확 템플릿 추출 + 정확 일치로 차단.

// ─── 참조 구현 (src/utils.ts 미러) ───
const notebookNoticeMessage = (title) => `📚 ${title}가 등록되었습니다.`;
const reportNoticeMessage = (title) => `📈 ${title} 리포트가 등록되었습니다.`;
const noticeChannelOf = (t) => (t === '__notebook__' ? 'notebook' : t === '__report__' ? 'report' : null);
const parseNoticeTitle = (message, channel) => {
  if (typeof message !== 'string' || !channel) return null;
  const body = message.replace(/^\[관리자 공지\]\s*/, '');
  const m = channel === 'notebook'
    ? body.match(/^📚 (.+)가 등록되었습니다\.$/)
    : body.match(/^📈 (.+) 리포트가 등록되었습니다\.$/);
  return m ? m[1].normalize('NFC').trim() : null;
};
const resolveNoticeMaterial = (links, message, channel, refCreatedAt) => {
  if (!Array.isArray(links) || links.length === 0) return null;
  const title = parseNoticeTitle(message, channel);
  if (!title) return null;
  const matches = links.filter(l => ((l && l.title) || '').normalize('NFC').trim() === title);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  if (typeof refCreatedAt === 'number') {
    return matches.reduce((best, l) =>
      Math.abs(((l && l.createdAt) || 0) - refCreatedAt) < Math.abs(((best && best.createdAt) || 0) - refCreatedAt) ? l : best
    );
  }
  return matches[0];
};

// ─── 테스트 ───
let failed = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { console.error(`✗ ${name}\n    expected ${e}\n    actual   ${a}`); failed++; }
  else console.log(`✓ ${name}`);
};

// 1) 발송 → 파싱 라운드트립 (정확 복원)
const rtTitles = ['시장 분석', '신규', '신규가', '6월 리포트', 'AI', 'AI 심화 2026', '리포트', '2025 결산', '결산', 'K200 ETF'];
for (const t of rtTitles) {
  eq(`roundtrip notebook "${t}"`, parseNoticeTitle(notebookNoticeMessage(t), 'notebook'), t);
  eq(`roundtrip report "${t}"`, parseNoticeTitle(reportNoticeMessage(t), 'report'), t);
}

// 2) 한국어 조사 '가' 결합 — '신규' 공지가 '신규가'를 오매칭하면 안 됨
const glue = [{ title: '신규', fileId: 'A', createdAt: 1 }, { title: '신규가', fileId: 'B', createdAt: 2 }];
eq('particle: 신규 → A', resolveNoticeMaterial(glue, notebookNoticeMessage('신규'), 'notebook', 1)?.fileId, 'A');
eq('particle: 신규가 → B', resolveNoticeMaterial(glue, notebookNoticeMessage('신규가'), 'notebook', 2)?.fileId, 'B');

// 3) 리포트 보일러플레이트('리포트') 충돌 — 삭제된 자료 공지는 '리포트' 자료를 오매칭하지 말고 null
const boiler = [{ title: '리포트', fileId: 'R', createdAt: 1 }];
eq('boilerplate: deleted X → null', resolveNoticeMaterial(boiler, reportNoticeMessage('X'), 'report', 5), null);
eq('boilerplate: 리포트 → R', resolveNoticeMaterial(boiler, reportNoticeMessage('리포트'), 'report', 1)?.fileId, 'R');

// 4) 동일 제목 다수 — 발송시각(createdAt) 근접으로 올바른 자료 선택
const dup = [{ title: '주간시황', fileId: 'OLD', createdAt: 100 }, { title: '주간시황', fileId: 'NEW', createdAt: 200 }];
eq('dup: refCreatedAt≈old → OLD', resolveNoticeMaterial(dup, reportNoticeMessage('주간시황'), 'report', 101)?.fileId, 'OLD');
eq('dup: refCreatedAt≈new → NEW', resolveNoticeMaterial(dup, reportNoticeMessage('주간시황'), 'report', 201)?.fileId, 'NEW');

// 5) 채널 격리 — 임의 텍스트/수동 브로드캐스트(센티넬 아님)는 절대 복원 안 됨
const docs = [{ title: '시장', fileId: 'M', createdAt: 1 }];
eq('non-template: arbitrary text → null', resolveNoticeMaterial(docs, '오늘 시장 급등!', 'report', 1), null);
eq('non-material targetEmail → channel null', noticeChannelOf('__all__'), null);
eq('null channel → null', resolveNoticeMaterial(docs, reportNoticeMessage('시장'), null, 1), null);

// 6) 벨 알림이력 접두사('[관리자 공지] ') 허용
const bell = [{ title: '시장 분석', fileId: 'X', createdAt: 1 }];
eq('bell prefix resolves', resolveNoticeMaterial(bell, '[관리자 공지] ' + notebookNoticeMessage('시장 분석'), 'notebook', 1)?.fileId, 'X');

// 7) 빈 배열(권한 OFF/미로드) → null
eq('empty links → null', resolveNoticeMaterial([], notebookNoticeMessage('아무거나'), 'notebook', 1), null);

// 8) NFC 정규화 — 자모 분해(NFD) 제목도 동일 취급
const nfd = '한글'.normalize('NFD');
const nfc = '한글'.normalize('NFC');
const norm = [{ title: nfd, fileId: 'N', createdAt: 1 }];
eq('NFC normalize match', resolveNoticeMaterial(norm, notebookNoticeMessage(nfc), 'notebook', 1)?.fileId, 'N');

if (failed > 0) { console.error(`\n${failed} test(s) failed.`); process.exit(1); }
console.log('\n모든 공지 매칭 테스트 통과.');
