# ASS-Page 작업 로그

> 마지막 작업일: 2026-05-21  
> 브랜치: main  
> 작업 PC: 메인 PC

---

## 현재 상태 요약

### App.tsx 규모
- 약 **2,103줄** (한국 ETF 과표 계산기 wiring 포함)

### 컴포넌트 수
- `components/`: **23개** (KrEtfTaxModal 추가)
- `hooks/`: **7개**

---

## 이번 세션 작업 내역 (2026-05-21)

### 한국 ETF 배당 과표 계산기 신규 기능

**대상 파일**: `src/utils.ts`, `src/hooks/usePortfolioState.ts`, `src/components/KrEtfTaxModal.tsx` (신규), `src/components/DividendSummaryTable.tsx`, `src/App.tsx`, `scripts/verify-kretf-tax.mjs` (신규), `package.json`, `CLAUDE.md`, `memory/use-korean-honorifics.md` (신규)

#### 요구사항
- 한국 ETF의 매입 시점 과표기준가와 배당락일 과표기준가를 입력받아 분배금 과세 금액을 산출.
- 가중평균 매입 과표 → max(0, 배당락 과표 - 가중평균) × 보유수량 × 15.4%.
- 평균법 매도 지원, 주당 과세표준은 소수 둘째자리 반올림(운용사 관행).

#### 변경 내용
1. **순수 계산 함수** (`src/utils.ts`)
   - `calculateKrEtfDividendTax(purchases, dividend, options)` 및 5종 타입(`KrEtfPurchaseEvent`, `KrEtfSaleEvent`, `KrEtfDividendEvent`, `KrEtfTaxOptions`, `KrEtfTaxResult`).
   - 평균법 매도: 매도 시 `totalCost -= shares × (totalCost/heldShares)`로 평균 단가 유지.
   - 입력 검증 throw: 빈 매입, 소수 shares, 0 과표, 잘못된 날짜 형식, 매도 > 보유, FIFO 미지원.
2. **단위 테스트 스크립트** (`scripts/verify-kretf-tax.mjs`, `npm run verify:tax`)
   - 8개 케이스: 명세 예시 일치(20,001주 → 세금 ₩13,892), 음수 과세차 클램프, 평균법 매도, ex-date 이후 매입 무시, 초과 매도 에러, 입력 검증, 부동소수점 누적 안정성, 전량 매도 케이스.
3. **데이터 모델 핸들러** (`src/hooks/usePortfolioState.ts`)
   - `portfolio.taxBaseHistory[code] = { purchases: [], sales: [], exTaxBase: {} }` 구조.
   - 신규 핸들러 3종: `updateTaxBasePurchases`, `updateTaxBaseSales`, `updateTaxBaseExPrice`.
4. **모달 컴포넌트** (`src/components/KrEtfTaxModal.tsx`)
   - 종목 선택 드롭다운 + 현재 보유수량 대비 입력 합계 불일치 경고.
   - 매입 이벤트 테이블(날짜·주식수·과표 입력), 매도 이벤트 테이블(접힘, 평균법).
   - 배당 이벤트별 카드: 배당락 과표 입력 + 실시간 계산 결과 + "세금을 표에 적용" 버튼.
   - 적용 시 `dividendTaxAmounts[code][ym]`에 저장 → 분배금 표가 자동 갱신.
5. **헤더 버튼 통합** (`src/components/DividendSummaryTable.tsx`)
   - 헤더 우측에 🧮 아이콘 버튼 추가(`+ ↻` 좌측).
   - 노출 조건: `accountType ∈ {portfolio, dividend, isa, pension, dc-irp}` (한국 ETF 보유 가능 타입). 탭 무관 항상 노출.
6. **App.tsx wiring** — `usePortfolioState`에서 3 핸들러 + `notify` 프롭 전달.
7. **CLAUDE.md** — 컴포넌트 목록, 훅 핸들러, 데이터 구조 항목 갱신.
8. **신규 메모리 `memory/use-korean-honorifics.md`** — 모든 한국어 응답은 높임말로 작성 규칙.

#### 설계 결정 (사용자 답변 기반)
- 우선순위: 새 계산 결과를 `dividendTaxAmounts`에 저장(수동값과 동급, 최우선).
- 매도 처리: v1부터 평균법만 지원 (FIFO 추후).
- 매입 입력: 모달에서 수동 입력(기존 `quantity`와 별개).
- 노출 범위: 초기 `portfolio`만 → COVERD 4 계좌(추정 `dividend` 타입)에서 미노출 신고 받아 5종으로 확장.

#### 검증
- `npm run verify:tax` — 로컬에서 사용자가 실행 필요(이 환경에 Node 미설치).
- `npm run build` — 마찬가지로 사용자 환경에서 확인 필요.
- 수동 통합 테스트: dev 서버에서 KODEX 200타겟위 사례(17,516 + 400 + 2,085주, 배당락 과표 9841.20, 주당 348원) → 세금 ₩13,892, 실수령 ₩6,946,456 일치 확인.

---

## 이전 세션 작업 내역 (2026-05-19)

### 분배금 버그 수정 — 빈 미래월 셀의 허위 금액·옆 달 전이 제거

**대상 파일**: `src/components/DividendSummaryTable.tsx`, `CLAUDE.md`

#### 문제 (버그)
- 「월 입금 내역」에서 분배 이력이 아직 없는 미래월(예: 6월·7월)에 `0`을 입력하면
  알 수 없는 수량·분배금이 표시됨 (사진1, 사진3).
- 7월 셀에 `0` 입력 시 6월 셀이 `0`으로 바뀌고, 7월 셀 삭제 시 6월이 초기화됨 (사진2, 사진4).
- 원인 ①: 빈 미래월 폴백 합성 소스가 `pred[...]`(예측값)을 끌어와 **허위 금액 표시**.
- 원인 ②: 폴백 배당락 키를 오프셋으로 *추측*(`slotExOffset`/`fallbackSource`) → 실제 소스
  키나 옆 빈 슬롯 키와 **충돌** → 한 셀 편집·삭제가 옆 달로 전이.
- 이 폴백 로직은 CLAUDE.md 스펙에 없던 미문서화 기능이었음 (지난 커밋에서 추가됨).

#### 변경 내용
1. **`buildFallbackExYms(slots)` 신규 헬퍼** — `fallbackSource` 대체.
   - 실제 소스의 모든 배당락월 키 + 다른 빈 슬롯 폴백 키를 수집해, 충돌 시 한 달씩
     이동하며 **고유 키 보장**. slots 고정 → 결과 결정적이라 입력 전후 같은 셀 유지.
2. **빈 셀 정책 확정** — 폴백 소스 `perShare: 0` → 예측값 미표시(`-`), 클릭 시
   입력은 가능. 사용자 선택("빈 셀, 입력은 가능") 반영.
3. `actualRows` / `compactActualRows` 양쪽에 동일 적용 → 개별·통합 합계 일치.
4. `slotExOffset`은 헬퍼 내부에서만 사용, `fallbackSource`는 제거.
5. **CLAUDE.md** 「분배금 현황」 절에 빈 미래월 폴백 동작·빈 셀 정책 명시.

#### 검증
- 이 환경에 Node/npm이 없어 `npm run build` 미실행 → **사용자가 직접 빌드 확인 필요**.
- 파일은 `// @ts-nocheck` 이므로 문법 오류만 빌드에 영향, 수정은 문법상 정상.

---

## 이번 세션 작업 내역 (2026-05-18)

### 분배금 버그 수정 — 예상 분배금이 없어도 실수령액 기록 가능하도록 개선

**대상 파일**: `src/components/DividendSummaryTable.tsx`

#### 문제 (버그)
- 종목의 분배금 데이터가 수집되지 않아 「월 예상 분배금」의 특정 월(주로 1월)이 비어 있었다.
- 이 경우 「월 입금 내역」에서 해당 월 셀에 실제 수령액을 입력해도 **기록되지 않고 사라졌다**.
- 원인: 예상 분배금 슬롯이 없는 월은 셀의 저장 키(`yearMonth`)가 **빈 문자열(`''`)** 로 반환됨 → 사용자가 입력한 값이 빈 키에 저장되어 다시 읽히지 않음.
- 1월 분배금은 **직전연도 12월 배당락(분배락) → 1월 지급** 구조라서, 12월 데이터 미수집 시 1월이 특히 자주 비어 있었다.

#### 변경 내용
1. **폴백(fallback) 배당락 키 도입**
   - `fallbackExYm(payIdx)`, `fallbackPredMonth(payIdx)` 헬퍼 추가.
   - 월배당 관례(지급월의 직전월이 배당락월)에 따라 **1월 지급분 → 직전연도 12월**(`${CY-1}-12`), 그 외 월은 직전월 키로 매핑.

2. **「월 입금 내역」(actualRows) — 예상값 유무와 무관하게 기록**
   - 예상 슬롯이 없는 월은 `''` 대신 폴백 키를 가진 **합성(synthetic) 소스**로 대체.
   - 사용자가 입력한 세후 금액이 안정적인 키에 저장·복원되어 새로고침 후에도 유지됨.
   - 주당 분배금 데이터가 있으면 세후 금액에서 **주식 수를 역산해 표시**.

3. **통합 대시보드(compactActualRows)** 도 폴백 키를 읽도록 수정 → 수동 입력 금액이 계좌·월 합계에 정상 반영.

4. **「월 예상 분배금」 날짜 표기 변경 (요구사항 3)**
   - `DivMeta`에서 `분배락`·`지급` 글자 삭제.
   - 날짜를 0 패딩 `MM/DD` 형식의 범위로 표시: 예) **`12/30-01/02`** (예측월은 앞에 `~`).
   - 하단 범례 문구를 새 형식에 맞게 수정.

#### 검증
- 이 환경에 Node/npm이 없어 `npm run build` 미실행 → **사용자가 직접 빌드 확인 필요**.
- 파일은 `// @ts-nocheck` 이므로 문법 오류만 빌드에 영향, 수정은 문법상 정상.

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
