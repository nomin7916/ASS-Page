---
name: api-esm-js-extension
description: api/ 폴더의 TypeScript 파일에서 상대 import는 반드시 .js 확장자 명시 (Vercel serverless ESM 빌드 요건)
metadata:
  type: project
---

`api/` 폴더의 `.ts` 파일에서 상대 import를 작성할 때 **반드시 `.js` 확장자**를 명시한다.

```ts
// ✗ 빌드 실패 (TS2835)
import { X } from './_helper';

// ✓ 정상
import { X } from './_helper.js';
```

**Why:** Vercel serverless function 빌드는 ESM strict resolution을 적용한다. 확장자 없는 상대 import는 `TS2835: Relative import paths need explicit file extensions in ECMAScript imports` 에러로 빌드 전체 실패. 2026-05-23 `api/market-calendar.ts:9`의 `_marketCalendarData` import 누락이 PortfolioChart 변경(58a0dd2) 빌드까지 동반 실패시킨 사례 있음 (commit 5817783에서 수정).

**How to apply:** 새 api 파일 작성 또는 import 수정 시 항상 `.js` 확장자 확인. 기존 패턴: `api/history.ts`, `api/stock-history.ts`, `api/us-stock-price.ts` 모두 `from './_kisToken.js'` 사용. tsconfig.api.json은 `moduleResolution: "bundler"`라 로컬 tsc는 통과하지만 Vercel은 실제로 ESM strict로 평가하므로 로컬 검증만으로 안심 불가.

[[no-local-npm]]
