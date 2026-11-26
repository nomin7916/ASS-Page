# 펀드 기준가 — 맥미니 크롬 예약 작업 (2026-11-26)

## 왜
- 미래에셋(investments.miraeasset.com)·funetf 가 **서버(해외·데이터센터) 요청을 막아** 펀드 기준가가 2026-10-27 에서 멈췄다
  (퇴직연금 계좌 수익률 차트가 한 달 평평 → 마지막 날 절벽).
- 앱이 시도하는 차례(src/api.ts): ① 브라우저 직접(CORS 로 대부분 실패) ② 서울(icn1) 중계 `/api/fund-proxy` ③ `/api/proxy`(싱가포르)
  ④ **우편함 `/api/fund-feed`** — 이 예약 작업이 사용자의 맥미니 크롬(집 회선 · 진짜 브라우저)으로 읽어 넣은 기준가.
- ①~③ 이 되면 우편함은 쓰이지 않는다(예약 작업도 "요청한 펀드가 없습니다"로 끝난다 — 목록은 30일 뒤 스스로 빈다).

## 흐름
1. 앱이 펀드 기준가를 못 받으면 `POST /api/fund-feed {op:'want', items:[{code, from}]}` — 코드와 필요한 시작일을 우편함 목록에 올린다
   (`src/fundFeed.ts` fundFeedWant, 코드마다 10분에 한 번).
2. 관리자가 로그인하면 앱이 `POST /api/fund-feed {op:'key'}` 로 열쇠를 받아 **관리자 Drive Index_Data 폴더의 `fund_nav_job.json`** 에 둔다
   (20일마다 새로 · 앞 열쇠 3일 더 통함 · Redis 에는 해시만 — `api/_fundFeed.ts`).
3. 예약 작업(TRIGGER-PROMPT.md)이 Drive 커넥터로 그 열쇠를 읽고, 크롬에서 미래에셋 화면을 열어 그 탭에서
   `GET /api/fund-job?op=want` → 미래에셋 기준가 목록(`/magi/fund/basePrices/list.do`)을 쪽마다 읽어 → `POST /api/fund-job?op=put`.
   (`/api/fund-job` 은 미래에셋·funetf 두 사이트에만 CORS 를 연다 — 열쇠는 그대로 필요.)
4. 앱은 다음 조회 때 ①~③ 이 또 막히면 `GET /api/fund-feed?codes=` 로 받아 다른 출처와 똑같이 `{date: nav}` 로 쓴다
   (useStockData 가 stage(replace) → 차트 · 현재가는 이력의 최신 날짜가 화면 기준가 날짜보다 새로우면 맞춘다).

## 만드는 법(사용자)
- **맥미니에 묶인** 예약 작업이어야 한다(클라우드 예약 작업에는 크롬 도구가 없다 — 2026-11-23 pe-study 에서 확인).
  Claude 데스크톱 앱(코워크)에서 맥미니(크롬에 Claude in Chrome 이 연결된 컴퓨터)를 고른 채 새 예약 작업 →
  이름 `[ASS-PAGE-펀드 기준가 · 맥미니 크롬]` · 평일 10:17 · 지시 칸에 TRIGGER-PROMPT.md 의 `-----` 사이 글 → 저장 → "지금 실행" 한 번.
- 연결할 것: 구글 드라이브 커넥터(열쇠 파일 읽기) · Claude in Chrome.
- 2026-11-26 클라우드 세션에서 직접 만들어 보려 했으나 막혔다: 코워크 환경에 create_trigger·create_session 모두 거절,
  Remote Control 폴더 목록이 비어 맥미니에 붙지도 못함. 그래서 맥미니 Claude 앱 새 채팅에 붙여 넣는 한 줄을 쓴다
  (순서는 `.claude/skills/mac-mini-remote/SKILL.md`).
- 열쇠 파일이 없으면 예약 작업이 처음 한 번만 사이트(nominfi1.vercel.app)를 맥미니 크롬에 열어 만들게 한다
  — 앱 화면을 새로 열면 다른 기기 로그인이 끊기므로 그때만.

## 고칠 때
- 우편함의 코드 모양은 `api/_fundFeed.ts` CODE_RE 와 `src/fundFeed.ts` FUND_FEED_CODE_RE 가 같아야 한다(verify:fund-feed).
- `/api/fund-job` 의 첫 줄은 `requireFundJobKey` 다(verify:api-auth JOB_GUARDS). 새 작업용 길도 같은 방식으로.
- 미래에셋 목록 화면의 표 모양이 바뀌면 TRIGGER-PROMPT.md 의 parse 와 `src/api.ts` parseMiraeBasePricesHtml 을 같이 고친다.
- 예약 작업의 지시를 바꾸면 사용자가 맥미니 쪽 예약 작업의 지시 칸에 다시 붙여야 한다(클라우드 세션에서는 고칠 수 없다).

## 확인 못 한 것(2026-11-26)
- 맥미니 크롬에서 미래에셋 화면이 실제로 열리는지(서버만 막는 것으로 본다 — 사용자의 브라우저에서는 열린다).
- 미래에셋 화면의 보안 설정(CSP)이 다른 사이트 호출을 막는지 — 막으면 지시의 둘째 길(사이트 탭에서 넣기)을 쓴다.
- 예약 작업이 실제로 돈 결과 — 첫 "지금 실행"의 답으로 본다.
