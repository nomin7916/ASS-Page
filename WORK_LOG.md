# ASS-Page 작업 로그

> 마지막 작업일: 2026-04-28  
> 브랜치: main  
> 작업 PC: 메인 PC

---

## 현재 상태 요약

### App.tsx 규모
- 약 **2,099줄** (Phase 10 완료 기준)

### 컴포넌트 수
- `components/`: **22개** (DividendSummaryTable 포함)
- `hooks/`: **7개**

---

## 이번 세션 작업 내역 (2026-04-28)

### 1. 해외 계좌 분배금 표 — 세전/세후 2열 구조 도입

**대상 파일**: `src/components/DividendSummaryTable.tsx`

#### 변경 전
- 월별 1열: USD + KRW 표시, 하단에 `$과세 / ₩과세` 수기입력 필드

#### 변경 후
- 월별 2열 (세전 | 세후) — 해외 계좌(`overseas`)가 있을 때 자동 적용
- 헤더: 월 이름(colspan=2) → 세전(파란색) / 세후(초록색) 서브헤더
- 세전↔세후 내부선: `border-r border-gray-700/20` (얇은 선)
- 월 경계선: 세후 열 오른쪽 `border-r border-gray-600/40` (굵은 선)

---

### 2. 해외 분배금 데이터 모델 전면 개편

#### 삭제된 필드/함수
| 항목 | 파일 | 이유 |
|---|---|---|
| `dividendTaxAmountsUsd` | portfolio state | 세금 별도 저장 방식 폐기 |
| `updatePortfolioDividendTaxAmountUsd()` | `usePortfolioState.ts` | 위와 동일 |
| `getManualTaxUsd()` | `DividendSummaryTable.tsx` | 삭제된 필드 의존 |
| `getManualTaxKrw()` | `DividendSummaryTable.tsx` | 사용 불필요 |
| `$과세 / ₩과세` 입력 UI | `DividendSummaryTable.tsx` | UX 개선으로 제거 |

#### 추가된 필드/함수
| 항목 | 파일 | 역할 |
|---|---|---|
| `actualAfterTaxUsd[code][YYYY-MM]` | portfolio state | 세후 USD 수기입력값 저장 |
| `actualAfterTaxKrw[code][YYYY-MM]` | portfolio state | 세후 KRW 수기입력값 저장 |
| `updatePortfolioActualAfterTaxUsd()` | `usePortfolioState.ts` | 세후 USD 저장 함수 |
| `updatePortfolioActualAfterTaxKrw()` | `usePortfolioState.ts` | 세후 KRW 저장 함수 |

#### 유지된 필드
| 항목 | 역할 |
|---|---|
| `actualDividendUsd[code][YYYY-MM]` | 세전 USD 수기입력값 (기존 유지) |
| `dividendTaxRate` | 자동계산용 세율 (기존 유지) |
| `dividendTaxAmounts[code][YYYY-MM]` | 비해외 계좌 세금 (기존 유지) |

---

### 3. 세후 계산 로직

```
세후 USD:
  1순위: actualAfterTaxUsd[code][YYYY-MM] (수기입력값)
  2순위: 세전USD × (1 - dividendTaxRate / 100) (자동계산)

세후 KRW:
  1순위: actualAfterTaxKrw[code][YYYY-MM] (수기입력값)
  2순위: 세후USD × usdkrw (자동계산)
```

- 수기입력은 **덮어쓰기 방식** (최근 입력값이 항상 최신)
- 마이그레이션 없이 기존 `dividendTaxAmountsUsd` 데이터는 버림

---

### 4. 세후 셀 편집 UX

#### 세전 셀 (파란색)
- **클릭** → 세전 USD 입력 필드 표시
- `Enter` 저장 / `Esc` 취소 / `blur` 저장

#### 세후 셀 (초록색)
- **클릭** → USD 입력 + KRW 입력 두 줄 동시 표시
- `Tab`으로 USD↔KRW 전환 시 편집 유지 (150ms debounce blur)
- `Enter` 저장 / `Esc` 취소 / 셀 외부 클릭 → 150ms 후 저장

---

### 5. 헤더 표시 변경

#### 변경 전
```
분배금 합계 $X ₩Y
과세금액 합계 $A ₩B
실 수령(세후) $C ₩D
```

#### 변경 후
```
세전 합계 $X ₩Y
세후(실 수령) $A ₩B
과세 $C ₩D
```

---

### 6. 합계(tfoot) 변경

#### 해외 계좌 있을 때 (`actualHasOverseas === true`)
- 각 월: 세전 열(파란색) + 세후 열(초록색) 2셀
- 연간합계: 세전 열 + 세후 열 2셀
- 별도 `과세합계` / `실 수령(세후)` 행 **없음** (세전/세후 비교로 대체)

#### 해외 계좌 없을 때 (`actualHasOverseas === false`)
- 기존 방식 유지: 1열/월 + `과세합계` + `실 수령(세후)` 행

---

### 7. compact 모드 (통합 대시보드) 변경

- 해외 계좌의 `compactActualRows.amount`가 이제 **세후 KRW** 기준으로 집계
- 해외 포트폴리오의 `compactActualTaxMap`은 세금 0으로 설정 (이미 세후이므로 별도 세금 행 불필요)
- 비해외 포트폴리오는 기존 세금 계산 방식 유지

---

### 8. 수정된 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `src/hooks/usePortfolioState.ts` | `updatePortfolioDividendTaxAmountUsd` 삭제, `updatePortfolioActualAfterTaxUsd` / `updatePortfolioActualAfterTaxKrw` 추가 |
| `src/components/DividendSummaryTable.tsx` | 데이터 구조 변경, 셀 렌더링 전면 개편, 헬퍼 함수 정리, 월 구분선 추가 |
| `src/App.tsx` | destructuring 및 DividendSummaryTable props 교체 (두 곳) |
| `src/components/IntegratedDashboard.tsx` | 함수 시그니처 및 DividendSummaryTable props 교체 |

---

## 다음 작업 후보 (미완료)

CLAUDE.md의 Phase 11 후보 참고:

1. **`handleImportHistoryJSON`** (~162줄) — JSON/CSV 파일 가져오기 유틸 분리
2. **CSV download 핸들러 4개** — 순수 함수로 `utils.ts`에 이동 가능
3. **`applyStateData`** — 의존성 많아 이동 스킵 권장

### 분배금 관련 추가 개선 아이디어 (이번 세션 논의)
- 세후 셀 편집 시 USD만 입력하면 KRW 자동계산 미리보기 표시 (현재는 저장 후 반영)
- 분배금 데이터 초기화(삭제) 버튼 — 현재는 0 입력 시 삭제됨

---

## 개발 환경 설정

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
# → http://localhost:5173

# 프로덕션 빌드
npm run build
```

### 주요 환경
- Vite + React 18 + TypeScript + Tailwind CSS
- Google Drive 저장소 (로그인 필수)
- `// @ts-nocheck` 유지 (App.tsx, 일부 훅)

---

## 핵심 아키텍처 메모

### 해외 분배금 데이터 흐름 (현재)

```
API 조회
  → dividendHistory[code][YYYY-MM] = 주당 분배금(USD)
  → buildMonthPrediction()으로 월별 예측값 생성

사용자 세전 입력
  → actualDividendUsd[code][YYYY-MM] = 세전 USD

자동 세후 계산
  → 세후USD = 세전USD × (1 - dividendTaxRate/100)
  → 세후KRW = 세후USD × usdkrw

사용자 세후 수기입력 (우선순위 최상)
  → actualAfterTaxUsd[code][YYYY-MM] = 세후 USD override
  → actualAfterTaxKrw[code][YYYY-MM] = 세후 KRW override
```

### accountType별 처리
- `overseas`: 세전/세후 2열 구조, USD+KRW 표시
- 나머지: 기존 단일 열, KRW만 표시 + 과세금액 입력 유지

---

*이 파일은 작업 연속성을 위해 생성됨. 코드와 함께 git 커밋 권장.*
