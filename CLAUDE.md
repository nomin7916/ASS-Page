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
├── App.tsx                  # 메인 컴포넌트 (현재 ~2,369줄 — 분리 진행 중)
├── api.ts                   # 외부 API 호출 함수 모음
├── config.ts                # UI_CONFIG, GOOGLE_CLIENT_ID, ADMIN_EMAIL
├── constants.ts             # INT_CATEGORIES, ACCOUNT_TYPE_CONFIG, 차트 키 상수
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
    ├── PortfolioTable.tsx       # 종목 테이블 (일반 증권)
    ├── KrxGoldTable.tsx         # KRX 금현물 전용 테이블
    ├── PortfolioChart.tsx       # 수익률 라인 차트
    ├── PortfolioSummaryPanel.tsx # 포트폴리오 요약 카드
    ├── PortfolioStatsPanel.tsx  # 투자원금·CAGR·수익률 통계 카드
    ├── HistoryPanel.tsx         # 수익률 히스토리 입력 패널
    ├── DepositPanel.tsx         # 입출금 내역 패널
    ├── RebalancingPanel.tsx     # 리밸런싱 계산 패널
    ├── MarketIndicators.tsx     # 시장 지표 바
    ├── Header.tsx               # 상단 헤더
    ├── PinChangeModal.tsx       # PIN 변경 모달
    ├── ScaleSettingModal.tsx    # 지표 배율 설정 모달
    ├── DriveBackupModal.tsx     # Drive 백업 관리 모달
    ├── UnlockPinModal.tsx       # PIN 잠금 해제 모달
    ├── PasteModal.tsx           # 붙여넣기 파싱 모달
    ├── CustomDatePicker.tsx     # 날짜 선택기
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
`handleAddStock`, `handleAddFund`

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

---

## 다음 작업 후보 (Phase 11~)

App.tsx에 아직 남아 있는 대형 블록들:

1. **`handleImportHistoryJSON`** (~162줄) — JSON/CSV 파일 가져오기. `setMarketIndices`, `setStockHistoryMap`, `showToast` 등 상태 의존이 많음
2. **`applyStateData` 함수** (~75줄) — 이미 ref 패턴으로 useDriveSync에서 호출 중; 내부 이동 시 setState 함수 30개 이상 전달 필요 (스킵 권장)
3. **CSV download 핸들러 4개** (`handleDownloadCSV`, `handleLookupDownloadCSV`, `handleDepositDownloadCSV`, `handleWithdrawDownloadCSV`) — 합계 ~51줄, 순수 파일 생성 로직으로 유틸 함수화 가능

작업 시작 전 반드시 App.tsx 해당 구간을 grep/read로 의존성 파악 후 진행.

---

## 코딩 규칙

- `// @ts-nocheck` 유지 (App.tsx, 일부 훅) — TypeScript 오류 무시
- 함수 이동 시 **functional update 패턴** 선호 (`setPortfolio(prev => ...)`)
- 새 유틸 함수(순수 함수)는 `utils.ts`에, React 상태 관련은 훅에
- 컴포넌트 분리 시 props 타입 명시 불필요 (ts-nocheck 환경)
- 빌드 검증: `npm run build` (에러 0개 확인)
- 불필요한 주석, 빈 줄 추가 금지
