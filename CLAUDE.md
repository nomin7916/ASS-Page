# ASS-Page — Claude 작업 컨텍스트

## 프로젝트 개요

주식/ETF 포트폴리오 관리 웹앱. 멀티 계좌(포트폴리오 배열), 통합 대시보드, Google Drive 자동 백업, 시장 지표 표시 기능을 제공한다.

- **배포**: Vite + React 18 + TypeScript + Tailwind CSS
- **데이터 저장**: Google Drive (로그인 필수), 브라우저 내 상태
- **외부 API**: Yahoo Finance, FRED, KIS(한국투자증권), Naver 금융

## 빌드 / 개발 명령

```bash
npm install      # 의존성 설치
npm run dev      # 개발 서버 (localhost:5173)
npm run build    # 프로덕션 빌드
```

## 핵심 파일 구조

```
src/
├── App.tsx                  # 메인 컴포넌트 (현재 ~2,100줄 — 분리 진행 중)
├── api.ts                   # 외부 API 호출 함수 모음
├── config.ts                # UI_CONFIG, GOOGLE_CLIENT_ID, ADMIN_EMAIL
├── constants.ts             # INT_CATEGORIES, ACCOUNT_TYPE_CONFIG, 차트 키 상수
├── design.ts                # 앱 전역 디자인 토큰 (BG, NOTIFY_CLASS, RULED_BG_STYLE, Z, BORDER)
├── utils.ts                 # 순수 유틸 함수 (generateId, cleanNum, hexToRgba, blendWithDarkBg 등)
├── chartUtils.tsx           # 차트 전용 컴포넌트/유틸 (PieLabelOutside, CustomChartTooltip 등)
├── driveStorage.ts          # Google Drive 저장/불러오기 로직
├── hooks/
│   ├── usePortfolioState.ts # 포트폴리오 핵심 상태 + 모든 CRUD 함수
│   ├── useDriveSync.ts      # Drive 동기화 로직
│   ├── useMarketData.ts     # 시장 지표 데이터 (KOSPI, S&P500, 금, 환율 등)
│   ├── useHistoryChart.ts   # 수익률 히스토리 차트 데이터 계산
│   ├── useChartInteraction.ts # 차트 마우스 드래그/선택 인터랙션
│   └── useStockData.ts      # 종목 현재가 조회, 비교 종목 관리
└── components/
    ├── IntegratedDashboard.tsx  # 통합 대시보드 (멀티 계좌 합산 뷰)
    ├── DividendSummaryTable.tsx # 분배금 현황 테이블 (개별계좌·compact 통합)
    ├── PortfolioTable.tsx       # 종목 테이블 (일반 증권)
    ├── KrxGoldTable.tsx         # KRX 금현물 전용 테이블
    ├── PortfolioChart.tsx       # 수익률 라인 차트
    ├── PortfolioSummaryPanel.tsx # 포트폴리오 요약 카드
    ├── PortfolioStatsPanel.tsx  # 투자원금·CAGR·수익률 통계 카드
    ├── HistoryPanel.tsx         # 수익률 히스토리 입력 패널
    ├── DepositPanel.tsx         # 입출금 내역 패널
    ├── RebalancingPanel.tsx     # 리밸런싱 계산 패널 (내부에 📅 월별 예상 분배금 테이블 포함)
    ├── MarketIndicators.tsx     # 시장 지표 바
    ├── Header.tsx               # 상단 헤더
    ├── PinChangeModal.tsx       # PIN 변경 모달
    ├── ScaleSettingModal.tsx    # 지표 배율 설정 모달
    ├── DriveBackupModal.tsx     # Drive 백업 관리 모달
    ├── UnlockPinModal.tsx       # PIN 잠금 해제 모달
    ├── PasteModal.tsx           # 붙여넣기 파싱 모달
    ├── CustomDatePicker.tsx     # 날짜 선택기
    ├── LoadingOverlay.tsx       # 앱 시작 시 블로킹 오버레이 (z-1100, 배경 클릭 차단)
    ├── LoginGate.tsx            # 로그인 / PIN 인증 게이트
    └── AdminPage.tsx            # 관리자 페이지
```

## 주요 아키텍처 결정

### portfolios 배열 구조
- 계좌 목록은 `portfolios: Portfolio[]` 배열로 관리
- 현재 활성 계좌의 상태(`portfolio`, `title`, `principal` 등)는 별도 state로 유지
- 계좌 전환 시 `switchToPortfolio(id)`가 현재 상태를 배열에 저장 후 새 계좌 로드
- 통합 대시보드(`showIntegratedDashboard`)가 기본 진입 뷰

### accountType 목록
`portfolio` | `isa` | `dc-irp` | `pension` | `gold` | `dividend` | `crypto` | `overseas` | `simple`

- `gold`: KRX 금현물 — goldKr 시세 자동 동기화
- `overseas`: 해외 주식 — USD/KRW 환율 적용
- `simple`: 직접입력 계좌 — evalAmount/principal만 입력

### usePortfolioState 훅이 담당하는 것
포트폴리오 모든 상태 + CRUD 함수 전체:
`switchToPortfolio`, `addPortfolio`, `deletePortfolio`, `addSimpleAccount`,
`updateSimpleAccountField`, `updatePortfolioStartDate`, `updatePortfolioName`,
`updatePortfolioColor`, `resetAllPortfolioColors`, `updateSettingsForType`,
`updatePortfolioMemo`, `movePortfolio`, `handleUpdate`, `handleDeleteStock`,
`handleAddStock`, `handleAddFund`,
`updateDividendHistory`, `updatePortfolioDividendHistory`, `updatePortfolioActualDividend`

### 분배금 데이터 구조
- `portfolio.dividendHistory`: `{ [code]: { [YYYY-MM]: perShareAmount } }` — API 조회 결과
- `portfolio.actualDividend`: `{ [code]: { [YYYY-MM]: absoluteAmount } }` — 사용자 직접 입력(절댓값)
  - 직접 입력값은 수량 변경에 영향받지 않음 (`hasManual = yearMonth in codeActual` 로 판별)
- `portfolio.rowColor`: 계좌별 색상 (hex) — DividendSummaryTable compact 모드에서 그라데이션 텍스트에 사용

### DividendSummaryTable 컴포넌트 구조
- `compact` prop (기본 false):
  - `false`: 개별 계좌 뷰 — 종목 행 표시, 셀 직접 편집 가능
  - `true`: 통합 대시보드 뷰 — 계좌별 월 합계만 표시, rowColor 그라데이션 텍스트
- App.tsx 배치:
  - 개별 계좌용 (non-compact): App.tsx ~1933줄, DepositPanel 다음 · PortfolioChart 이전
  - 통합 대시보드용 (compact): App.tsx ~2110줄, `{showIntegratedDashboard && (...)}` 조건부 렌더링

---

## 완료된 리팩토링 이력 (Phase 1~8)

App.tsx를 기능별로 분리하는 장기 리팩토링. 신규 훅/컴포넌트 생성 또는 기존 훅 확장 방식.

| Phase | 작업 내용 |
|---|---|
| Phase 1 | Hook 4개 분리: `useDriveSync`, `useMarketData`, `usePortfolioState`, `useHistoryChart` |
| Phase 2 | 컴포넌트 4개: `IntegratedDashboard`, `HistoryPanel`, `DepositPanel`, `PortfolioChart` |
| Phase 3 | 컴포넌트 4개: `RebalancingPanel`, `PinChangeModal`, `CustomDatePicker`, `ScaleSettingModal` |
| Phase 4 | 컴포넌트 4개: `DriveBackupModal`, `UnlockPinModal`, `PasteModal`, `PortfolioSummaryPanel` |
| Phase 5 | `constants.ts` 상수 분리 + `chartUtils.tsx` 차트 유틸 분리 + `PortfolioStatsPanel` 컴포넌트 분리 |
| Phase 6 | Hook 신규: `useChartInteraction` (차트 드래그 선택 인터랙션) |
| Phase 7 | Hook 신규: `useStockData` (종목 현재가 조회, 비교 종목 관리, 자동 갱신) |
| Phase 8 | `usePortfolioState` 확장: 포트폴리오 관리 함수 14개 + `utils.ts`에 `hexToRgba`/`blendWithDarkBg` 이동 |
| Phase 9 | Hook 신규: `usePinManager` (PIN 상태 + openPinChange) + 컴포넌트 신규: `AccountTabBar` (탭 바 분리) + App.tsx dead code 삭제 (`StatusDot`, `CompStockDot`) |
| Phase 10 | 컴포넌트 신규: `UserInfoBar` (로그인 정보 바) + `refreshPrices` → `useStockData` 훅으로 이동 |

### 현재 상태 (Phase 10 완료 후)
- `App.tsx`: **약 2,099줄**
- `hooks/`: 7개 (`useStockData`에 `refreshPrices` 추가)
- `components/`: 21개 (`UserInfoBar` 추가)

### 추가 작업 (Phase 10 이후 — 2026-04-28)
- `DividendSummaryTable.tsx` 신규 컴포넌트 추가 (22번째 컴포넌트)
  - 월 입금 내역 숫자 입력 스피너 제거 (`type="number"` → `type="text" inputMode="numeric"`)
  - `compact` prop: 통합 대시보드용 계좌별 집계 뷰 추가
  - compact 모드 계좌명에 `rowColor` 기반 그라데이션 텍스트 적용
  - compact 테이블은 `showIntegratedDashboard` 조건부 렌더링으로 개별 계좌 페이지에서 미표시

### 추가 작업 (2026-05-07) — 앱 시작 개선 + 디자인 토큰
- **앱 시작 순환 루프 제거**: 기존 계좌 탭 순차 스위치(150ms × N) → `refreshPrices()` 1회 호출로 대체
- **총자산현황 항상 최신값 반영**: `fetchAllPortfoliosPrices`가 활성 계좌도 `portfolios[]`에 즉시 반영 (기존: 비활성만 반영)
- **종목 fetch 타임아웃**: 종목당 10초 초과 시 `null` 반환 → 실패 코드를 `notify`로 기록
- **`src/design.ts` 신규**: 앱 전역 디자인 토큰 (BG, NOTIFY_CLASS, NOTIFY_HEX, RULED_BG_STYLE, Z, BORDER)
  - 새 컴포넌트 작성 시 이 파일에서 import해 사용 (매직 스트링 방지)
  - `Z.overlay = 1100` (ConfirmDialog z-1000보다 위)
- **`src/components/LoadingOverlay.tsx` 신규**: 앱 시작 시 배경 클릭 차단 오버레이
  - `visible` prop이 true인 동안 `fixed inset-0 z-[1100]`으로 배경 전체 차단
  - 줄선 메모 배경에 최근 notify 3개 실시간 표시
  - 5초 후 "계속 사용하기" 버튼 표시, 20초 후 자동 해제
  - `design.ts` 토큰 사용 예시 컴포넌트

---

## 다음 작업 후보 (Phase 11~)

App.tsx에 아직 남아 있는 대형 블록들:

1. **`handleImportHistoryJSON`** (~162줄) — JSON/CSV 파일 가져오기. `setMarketIndices`, `setStockHistoryMap`, `notify` 등 상태 의존이 많음
2. **`applyStateData` 함수** (~75줄) — 이미 ref 패턴으로 useDriveSync에서 호출 중; 내부 이동 시 setState 함수 30개 이상 전달 필요 (스킵 권장)
3. **CSV download 핸들러 4개** (`handleDownloadCSV`, `handleLookupDownloadCSV`, `handleDepositDownloadCSV`, `handleWithdrawDownloadCSV`) — 합계 ~51줄, 순수 파일 생성 로직으로 유틸 함수화 가능

작업 시작 전 반드시 App.tsx 해당 구간을 grep/read로 의존성 파악 후 진행.

---

## 디자인 토큰 시스템 (`src/design.ts`)

새 컴포넌트 작성 시 매직 스트링 대신 이 파일의 상수를 import한다.

```ts
import { BG, NOTIFY_CLASS, NOTIFY_HEX, RULED_BG_STYLE, Z, BORDER } from '../design';

// 배경: BG.primary('#0b1120'), BG.card('#0f1623'), BG.overlay('rgba(0,0,0,0.85)')
// 알림 Tailwind 클래스: NOTIFY_CLASS.info('text-sky-300') 등
// 줄선 메모 배경: <div style={RULED_BG_STYLE}>
// z-index 계층: Z.notification(999) < Z.dialog(1000) < Z.overlay(1100)
// 테두리: BORDER.default('border-gray-700'), BORDER.subtle('border-gray-700/40')
```

기존 컴포넌트(NotificationBar 등)의 매직 스트링은 유지해도 무방하며, 신규 코드부터 design.ts를 사용한다.

---

## 알림 시스템 아키텍처

### 원칙 — 무엇이 알림이고 무엇이 아닌가

```
알림창(NotificationBar)으로 통합 O:
  - 시스템 메시지, 성공/실패 피드백 → notify(text, type)
  - 파괴적 작업 확인 (삭제, 백업 적용 등) → confirm(message)

알림창과 분리 유지 O:
  - 모달 다이얼로그 (DriveBackupModal, PinChangeModal 등) — 사용자 인터랙션 UI
  - LoginGate 인라인 에러 — 로그인 전 컨텍스트, NotificationBar 접근 불가
  - Header Drive 상태 아이콘 — 지속 상태 표시기
```

### useToast 훅 API

```ts
notify(text, type?)      // type: 'info' | 'success' | 'warning' | 'error' (기본 'info')
confirm(message, label?) // Promise<boolean> — ConfirmDialog 표시 후 사용자 응답 반환
resolveConfirm(result)   // ConfirmDialog 내부에서 호출
markAsRead()             // 알림 뱃지 초기화
clearNotificationLog()   // 알림 이력 전체 삭제
```

### NotificationType 색상 매핑

| type | 색상 | 용도 |
|---|---|---|
| info | sky-300 (하늘) | 진행 상태, 정보 |
| success | green-400 (초록) | 완료, 저장됨 |
| warning | amber-400 (노란) | 경고, 미연결, 취소 |
| error | red-400 (빨강) | 실패, 오류 |

### 신규 파일

- `src/components/ConfirmDialog.tsx` — `window.confirm()` 대체 커스텀 모달
  - `state: ConfirmState | null`, `onResolve: (result: boolean) => void` props
  - App.tsx에서 `<ConfirmDialog state={confirmState} onResolve={resolveConfirm} />` 렌더

---

## 작업 흐름 정의 (Claude 작업 기준)

```
1. 요구사항 분석
   └─ 무엇을 바꾸는가 명확화
   └─ 사용자 기대 동작이 불명확한 경우 → 바로 물어보고 방향 확인 후 진행

2. 코드 범위 파악
   └─ grep/read로 영향 코드 전체 확인 (CLAUDE.md + memory 참조)

3. 구조 적합성 판단
   ├─ 기존 아키텍처에 맞는가?
   │   Yes → 4번으로
   │   No  → 구조 재설계 → CLAUDE.md 업데이트 → 4번으로
   └─ 신규 파일 필요? 기존 확장?

4. 완전한 구현 (임시 코드, 하위 호환 shim 없이)

5. 검증
   └─ 빌드 에러 0, 영향 코드 경로 확인
```

---

## 코딩 규칙

- `// @ts-nocheck` 유지 (App.tsx, 일부 훅) — TypeScript 오류 무시
- 함수 이동 시 **functional update 패턴** 선호 (`setPortfolio(prev => ...)`)
- 새 유틸 함수(순수 함수)는 `utils.ts`에, React 상태 관련은 훅에
- 컴포넌트 분리 시 props 타입 명시 불필요 (ts-nocheck 환경)
- 빌드 검증: `npm run build` (에러 0개 확인)
- 불필요한 주석, 빈 줄 추가 금지
- 알림은 반드시 `notify(text, type)` 사용 — `window.alert/confirm` 및 인라인 토스트 div 금지
