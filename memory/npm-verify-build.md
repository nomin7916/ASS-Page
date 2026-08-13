---
name: npm-verify-build
description: Claude 셸에서 node/npm 실행 가능 — verify:* 14종은 그대로, npm install --no-save --no-package-lock 후 npm run build까지 동작 (2026-08-13 정정)
metadata:
  type: feedback
---

**2026-08-13 정정.** 이 파일은 원래 "로컬에 npm/node가 없어 빌드·검증을 실행할 수 없다"였으나
**더는 사실이 아니다**. Claude Bash 툴에서 `node -v` → **v24.19.0**, `npm -v` → **11.17.0**.

**Why:** 옛 기록(2026-05-23) 이후 환경이 바뀌었는데 메모가 갱신되지 않아, 실행 가능한 게이트를
두고도 "수동 검토로 갈음한다"거나 알고리즘을 다른 언어로 포팅해 검증하는 우회를 반복했다.
CLAUDE.md의 「검증·리뷰 규약」은 `npm run verify:*` + `npm run build`를 **게이트**(통과 못 하면
커밋 금지)로 규정하므로, 이제 그대로 실행하면 된다.

**How to apply:**
- **`npm run verify:*` 14종은 `node_modules` 없이도 바로 돈다** — 전부 의존성 0인 순수 스크립트다
  (calendar·tax·dividend·history·notice·twr·fx·brl·rebal-restore·transfer·overseas·flow·ladder·backtest).
- **`npm run build`를 돌리려면** 먼저
  `npm install --no-save --no-package-lock --no-audit --no-fund` (실측 설치 후 빌드 39초, 에러 0).
  - ⚠️ **`--no-save --no-package-lock` 필수.** 이 저장소는 `package-lock.json` 부재가 알려진 상태라
    (CLAUDE.md 자금 흐름도 섹션) **락파일을 만들어 커밋하면 Vercel 배포 해석이 바뀐다**.
    두 플래그가 있으면 `package.json`·`package-lock.json`이 수정되지 않고, `node_modules`/`dist`는
    `.gitignore` 대상이라 커밋이 오염되지 않는다(`git status`로 확인할 것).
- **빌드가 잡는 것과 못 잡는 것**: `vite build`는 esbuild만 돌린다(`tsc` 없음) → **TS 타입 에러는
  통과**하지만 JS SyntaxError·JSX 오타(`={false)` 같은 brace/paren 혼동)는 잡는다. `// @ts-nocheck`도
  SyntaxError는 못 막는다. 반대로 **스코프 누수**(다른 최상위 블록의 지역 변수 참조)·미정의 식별자처럼
  **런타임 ReferenceError**로만 드러나는 부류는 빌드가 통과시키므로, 변경 지점의 식별자 스코프는
  여전히 눈으로 확인해야 한다(실제 프로덕션 장애 이력: `initTradeRest`).
- **`verify:calendar`는 nager.at 라이브 교차검증**이라 KR 공휴일 몇 건이 상시 `⚠ 불일치`로 뜨고
  **종료코드는 0**이다. 연례 유지보수 신호이지 게이트 실패가 아니다 — 내 변경과 무관하면 그대로 진행.
- **새 가드를 넣었으면 변이 테스트로 검출을 확인할 것.** 소스 텍스트 가드는 선언만 보면 죽은 단언이
  되기 쉽다(2026-08-13 실측: 등락률 열 가드가 "셀 통째 삭제"조차 초록으로 통과). 일부러 깨뜨려
  실패하는지 본 뒤 되돌린다. CRLF 저장소이므로 문자열 치환 전 LF 정규화 필수.
- **사용자 로컬 터미널은 별개다.** 사용자는 로컬 빌드를 하지 않는다고 밝혔으므로(2026-06-30)
  사용자에게 `npm run build` 결과를 요청하지 말고 **내가 직접 돌린 결과**를 근거로 삼는다.
  배포 후 빌드 실패 진단은 여전히 GitHub 커밋 페이지의 `× N/M` → Details → Vercel Build Logs.

[[api-esm-js-extension]]
