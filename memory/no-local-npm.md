---
name: no-local-npm
description: 사용자 로컬 환경에 npm/node가 PATH에 없음 — npm run build로 사전 검증 불가, Vercel 푸시가 사실상 빌드 검증
metadata:
  type: feedback
---

이 환경에서는 `npm`/`node`가 PATH에 없어 `npm run build`, `npm run verify:tax`, `npm run verify:calendar` 등 빌드/스크립트를 **직접 실행할 수 없다**. 사용자도 로컬 빌드 안 함. Vercel push가 사실상 첫 빌드 검증 단계.

**Why:** 2026-05-23 PortfolioChart 수정 후 빌드 검증을 시도했으나 `npm: command not found` 에러. 검증 없이 push → Vercel 빌드 실패(원인은 별개의 api/market-calendar TS2835였지만 무관 검증 부재로 진단 지연). 같은 세션에서 두 번이나 JSX 오타(`activeDot={false)` — `}` 대신 `)`) 발생 후 다행히 수동 검토로 즉시 수정.

**How to apply:**
- 코드 변경 후 push 직전 **정적 검증 필수**:
  - PowerShell brace balance 스크립트 (`curly=0 paren=0 sq=0` 확인)
  - `Grep` 으로 의심 오타 패턴 직접 점검 (특히 JSX `={false)`, `={true)`, `={null)` 같은 brace/paren 혼동)
  - `git diff --stat` 으로 변경 규모 확인
- 사용자에게 `npm run build` 결과 요청은 무의미 — 대신 Vercel push 후 "빌드 로그 캡처" 요청
- 큰 변경은 한 번에 푸시하지 말고 **작은 단위로 분할 commit + Vercel 검증** 권장 (실패 시 원인 격리 용이)
- 빌드 실패 시 첫 진단은 항상 **GitHub commit 페이지의 `× N/M` 클릭 → Details 링크 → Vercel Build Logs**

[[api-esm-js-extension]]
