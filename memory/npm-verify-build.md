---
name: npm-verify-build
description: node/npm 유무는 세션마다 다르다 — 반드시 which node로 먼저 확인. 없으면 python3로 소스 텍스트 가드 재현 + 변이 테스트로 대체 (2026-08-21 재정정)
metadata:
  type: feedback
---

**2026-08-21 재정정 — 환경이 세션마다 다르다.** 작업 시작 시 **반드시 `which node npm`으로 확인**할 것.
2026-08-13에는 v24.19.0이 있었으나 2026-08-21 세션에는 **없었다**(`node not found`, `node_modules` 부재,
PATH에 `/opt/homebrew/bin` 없음). 이 파일을 근거로 "돌릴 수 있다"고 전제하지 말 것.
(`memory/tools/{jsxcheck,undefcheck,scopecheck}.mjs` 3종도 저장소에 **없다** — CLAUDE.md가 게이트로
규정하지만 파일이 존재한 적이 없다.)

**node가 없을 때의 대체 게이트(2026-08-21 실증)** — 이것으로 실제 결함 2건을 잡았다:
1. **소스 텍스트 가드는 python3로 그대로 재현**한다. 알고리즘 포팅이 아니라 **같은 정규식을 같은 파일에
   돌리는 것**이라 등가다(verify 스크립트의 `stripComments`도 함께 옮길 것 — 이 저장소는 금지 사유를
   바로 그 자리 주석에 적으므로 원문으로 재면 그 인용문이 유령 사용으로 잡혀 가드가 영구 실패한다).
2. **변이 테스트로 검출력을 실증**한다. 각 변이를 넣고 가드를 돌려 실패하는지 보고 **즉시 원상 복구**.
   선언만 보는 가드는 죽은 단언이 되기 쉬우므로 이 절차가 특히 중요하다.
3. **구문 균형 검사**: 주석·문자열을 걷어낸 뒤 `()[]{}` 균형을 세고 **`git show HEAD:파일`의 원본과 대조**
   한다(원본에도 불균형이 있다 — 주석의 반개구간 표기 `(from, to]` 때문이라 절대값이 아니라 **차이**를 봐야 한다).
4. **스코프 누수 검사**: 신규 식별자가 선언된 함수 블록 밖에서 쓰이는지 확인.
   ⚠️ 오탐 3종을 인지할 것 — 모듈 스코프 import, `const [a, b] = useState()` 배열 구조분해,
   함수 파라미터 구조분해. 전부 정규식이 선언을 못 잡아 '선언 없음/누수'로 뜬다.
5. 순수 함수 단위 테스트(파트①)는 **대체 불가** — 커밋 후 node 있는 환경에서 반드시 돌릴 것.

**Why:** 이 메모가 두 번 다 **한 세션의 관찰을 항구적 사실로 적어서** 문제를 냈다. 2026-05-23에는
"없다"고 적어 실행 가능한 게이트를 두고도 우회했고, 2026-08-13에는 "있다"고 적어 없는 세션에서
그 전제로 계획을 세우게 했다. 환경은 세션마다 다르므로 **매번 확인**이 유일한 답이다.
CLAUDE.md의 「검증·리뷰 규약」은 `npm run verify:*` + `npm run build`를 **게이트**(통과 못 하면
커밋 금지)로 규정하지만, 실행할 수 없는 세션에서는 위 대체 게이트로 갈음하고 **그 사실을 사용자에게
명시**한 뒤 커밋한다(보류하면 잃는 것은 검증이 아니라 커밋되지 않은 작업물이다).

**How to apply:**
- **`npm run verify:*` 17종은 `node_modules` 없이도 바로 돈다**(node만 있으면) — 전부 의존성 0인 순수
  스크립트다(calendar·tax·dividend·history·notice·twr·fx·brl·rebal-restore·transfer·overseas·flow·
  ladder·backtest·cal-detail·card-window·period).
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
