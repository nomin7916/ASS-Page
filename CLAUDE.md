# ASS-Page — Claude 작업 컨텍스트

## 프로젝트 개요

주식/ETF 포트폴리오 관리 웹앱. 멀티 계좌(포트폴리오 배열), 통합 대시보드, Google Drive 자동 백업, 시장 지표 표시.

- **스택**: Vite + React 18 + TypeScript + Tailwind CSS
- **데이터**: Google Drive (로그인 필수), 브라우저 내 상태
- **외부 API**: Yahoo Finance, FRED, KIS(한국투자증권), Naver 금융
- **빌드**: `npm run dev` (localhost:5173) | `npm run build` | `npm install`

## 핵심 파일 구조

```
src/
├── App.tsx              # 메인 컴포넌트 (~2,099줄 — 분리 진행 중)
├── api.ts               # 외부 API 호출
├── config.ts            # UI_CONFIG, GOOGLE_CLIENT_ID, ADMIN_EMAIL
├── constants.ts         # INT_CATEGORIES, ACCOUNT_TYPE_CONFIG, 차트 키 상수
├── design.ts            # 디자인 토큰: BG, NOTIFY_CLASS, RULED_BG_STYLE, Z, BORDER
├── utils.ts             # 순수 유틸 (generateId, cleanNum, hexToRgba, blendWithDarkBg 등)
├── chartUtils.tsx       # 차트 컴포넌트/유틸 (PieLabelOutside, CustomChartTooltip 등)
├── driveStorage.ts      # Google Drive 저장/불러오기
├── hooks/               # usePortfolioState, useDriveSync, useMarketData,
│                        # useHistoryChart, useChartInteraction, useStockData, usePinManager
└── components/
    ├── IntegratedDashboard.tsx   # 통합 대시보드 (멀티 계좌 합산 뷰)
    ├── DividendSummaryTable.tsx  # 분배금 현황 테이블 (compact/개별 모드)
    ├── DividendVerifyModal.tsx   # 분배금 검증 모달 (올해 1월~최근월 종목×월 매트릭스)
    ├── KrEtfTaxModal.tsx         # 한국 ETF 과표 계산기 (매입/매도/배당락 과표 → 세금 산출)
    ├── PortfolioTable.tsx        # 종목 테이블
    ├── KrxGoldTable.tsx          # KRX 금현물 전용 테이블
    ├── PortfolioChart.tsx        # 수익률 라인 차트
    ├── PortfolioSummaryPanel.tsx # 포트폴리오 요약 카드
    ├── PortfolioStatsPanel.tsx   # 투자원금·CAGR·수익률 통계 카드
    ├── HistoryPanel.tsx          # 수익률 히스토리 입력 패널
    ├── DepositPanel.tsx          # 입출금 내역 패널
    ├── RebalancingPanel.tsx      # 리밸런싱 계산 패널
    ├── MarketIndicators.tsx      # 시장 지표 바
    ├── Header.tsx                # 상단 헤더
    ├── AccountTabBar.tsx         # 계좌 탭 바
    ├── UserInfoBar.tsx           # 로그인 정보 바
    ├── PinChangeModal.tsx        # PIN 변경 모달
    ├── ScaleSettingModal.tsx     # 지표 배율 설정 모달
    ├── DriveBackupModal.tsx      # Drive 백업 관리 모달
    ├── UnlockPinModal.tsx        # PIN 잠금 해제 모달
    ├── PasteModal.tsx            # 붙여넣기 파싱 모달
    ├── CustomDatePicker.tsx      # 날짜 선택기
    ├── LoadingOverlay.tsx        # 앱 시작 블로킹 오버레이 (z-1100)
    ├── ConfirmDialog.tsx         # window.confirm() 대체 모달
    ├── LoginGate.tsx             # 로그인 / PIN 인증 게이트
    └── AdminPage.tsx             # 관리자 페이지
```

## 주요 아키텍처

### portfolios 배열 구조
- `portfolios: Portfolio[]` 배열로 계좌 목록 관리
- 현재 활성 계좌 상태(`portfolio`, `title`, `principal` 등)는 별도 state
- 계좌 전환: `switchToPortfolio(id)` — 현재 상태를 배열에 저장 후 새 계좌 로드
- 기본 진입 뷰: 통합 대시보드 (`showIntegratedDashboard`)

### accountType 목록
`portfolio` | `isa` | `dc-irp` | `pension` | `gold` | `dividend` | `crypto` | `overseas` | `simple`

- `gold`: KRX 금현물 — goldKr 시세 자동 동기화
- `overseas`: 해외 주식 — USD/KRW 환율 적용
- `simple`: 직접입력 — evalAmount/principal만 입력

### TEST 계좌 플래그 `isTest` — 통합 대시보드 표시만, 모든 합산에서 제외 (⚠️ 회귀 주의)

계좌별 boolean `p.isTest`. 통합 계좌 현황 표의 **계좌명 좌측 토글 버튼**(녹색 점)으로 ON/OFF
(`togglePortfolioTest` — `usePortfolioState`). ON이면 계좌명이 **이탤릭+녹색**으로 표시되고
통합 대시보드의 **모든 합산·차트·비중에서 제외**되지만 표의 행 자체는 그대로 노출된다(계좌를
열면 개별 뷰는 정상 동작 — 데이터는 보존, 해제 시 즉시 복원).

- **제외 지점(8곳, 새 통합 합산 추가 시 빠짐없이 isTest 필터 필수)**:
  `useIntegratedData` — ① `intTotals`(소계+카테고리 비중, `intCatDonutData`는 intTotals.cats 경유로 자동 제외)
  ② `computedIntHistory`의 `cashSeries`/`accountSeries`/`portfolioPrincipalData`(수익율 그래프·평가액 추이)
  ③ `intDepositEvents`(입출금 마커) ④ `intHoldingsDonutData`(종목별 비중).
  `IntegratedDashboard` — ⑤ `histDetailRows`(추이 팝업 소계, 차트값과 일치 유지) ⑥ `appTrackingStartDate`
  (역추산 경계 마커). `portfolioSummaries`는 행 표시를 위해 **제외하지 않고** `isTest`만 노출.
- **표 UI**: TEST 행의 **평가비중 셀은 `-`**(100% 합계에서 빠지므로). 계좌명 셀 좌측 토글은
  `stopPropagation`으로 계좌 전환(switchToPortfolio) 클릭과 분리.
- **persist**: `App.tsx` `portfolioStructureKey`에 `isTest` 포함(단독 토글도 Drive 저장 트리거).
  로드 정규화(`applyStateData`/`applyBackupData`)는 `...p` 스프레드라 자동 보존.
- **범위 밖(의도)**: 분배금 현황 표(통합 compact)는 isTest 미적용. `useHistoryBackfill`의 계좌별
  일별 자동기록도 미적용(TEST 계좌도 자기 history는 계속 기록 → 해제 시 데이터 온전).

### 계좌 타입별 D/S·펀드 게이팅 (⚠️ 회귀 주의 — 절대 합치지 말 것)

두 기능은 **적용 계좌가 다르므로 별개 플래그로 분리**한다. 과거 한 플래그(`isRetirement`)로
묶여 있어 다른 수정 중 반복 회귀했음. 합치거나 한쪽 조건으로 통일하지 말 것.

- **펀드 기능** (펀드 행 + "펀드 추가" 버튼): **퇴직연금(`dc-irp`) + 개인연금(`pension`)**.
  그 외 계좌(portfolio/isa/dividend/gold/overseas/crypto/simple)는 펀드 없음.
  → `App.tsx`의 `isRetirementAccount` → `PortfolioTable` prop `isRetirement`.
- **위험/안전(D/S) 자산 구분 배지 + D70/S30 통계**: **퇴직연금(`dc-irp`) 전용**. 개인연금 포함 그 외 제외.
  → `App.tsx`의 `isDcIrpAccount` → `PortfolioTable` props `showAssetClass`(배지) / `showRetirementStats`(통계).
  D/S 배지는 '구분' 셀의 카테고리(주식-a/배당주식/FUND) **옆 배지만** 의미하며, 카테고리 라벨 자체는 유지.
- `RebalancingPanel`의 D/S 표시는 내부적으로 `activePortfolioAccountType === 'dc-irp'` /
  `showRetirementStats`로 이미 dc-irp 전용 게이팅됨 (별도 `isRetirement` prop 없음).
- 플래그 정의 위치: `App.tsx` `isRetirementAccount` / `isDcIrpAccount` 두 줄. 조건 변경 시 이 두 줄만 수정.

### 예적금(savings) 항목 — 퇴직연금(dc-irp) 전용 (⚠️ 펀드/예수금과 혼동 금지)

원금보장형 예적금(예: "kb손해보험 이율보증형 3년")을 위한 **별도 항목 타입 `type:'savings'`**.
`type:'deposit'`(예수금/CASH 행)와 **완전 별개** — 절대 합치지 말 것. "펀드 추가" 아래
"예적금 추가" 버튼으로 추가하며 **`dc-irp` 전용**(펀드는 dc-irp+pension, 예적금은 dc-irp만).
→ `App.tsx` `isDcIrpAccount` → `PortfolioTable` prop `showSavings`.

- **데이터 모델**: `{ type:'savings', category:'예적금', assetClass:'S'|'D'(기본 S), name,
  annualRate(연이율 %, 원시 문자열 — 소수 입력 보존), startDate/endDate(투자기간),
  investAmount(=Σ deposits), evalAmount(저장 안 함 — 산출값), deposits:[{id,date,amount}] }`.
- **평가액 = `savingsEval(item, asOf?)`** (`utils.ts`): 각 적립(deposit) 트랜치를 그 날짜부터
  만기/asOf까지 **연이율 단리**로 누적. **일(day) 단위 계산**(`toSavingsDayNum` — 타임존 무관
  캘린더 일자) — 입금 당일은 이자 0(평가금=원금), 다음 날부터 1일치 단리. `asOf` 미전달 시 오늘.
  과거 백필은 `asOf=date`로 그날 기준 누적(미래 적립분 제외, `min(asOf,오늘)` 캡). 만기일 이후로는
  만기일에서 정지. **evalAmount를 item에 저장하지 않으므로** 모든 합산 경로가 `savingsEval`을 직접
  호출해야 함(usePortfolioData/useStockData/useIntegratedData/calcPortfolioEvalDetail/App
  auto-history·차트/RebalancingPanel). 투자원금=`savingsInvest`.
  ⚠️ **시각(datetime) 비교 금지** — 과거 `new Date(dateStr)`(UTC 자정) > `Date.now()` 비교가
  한국 오전엔 "오늘" 적립을 미래로 오판→스킵해 평가금 0이 되던 버그. 반드시 일 단위로 비교.
- **만기금액 = `savingsMaturity(item)`** (`utils.ts`): 각 적립을 **만기일(endDate)까지** 단리
  누적(오늘 상한 없음). `savingsEval(item, endDate)`는 `min(asOf,오늘)` 캡 탓에 오늘값이 나오므로
  만기 산출엔 못 씀 → 별도 함수. endDate 미설정/적립 없음 → 0. **표시**: `PortfolioTable` 평가금
  셀 하단 작은 글씨("만기 ₩…") + 적립 모달 요약(연이율·투자기간 아래). 적립 모달 입금일 기본값=오늘(`openSavingsModal`).
- **트랜치 평가금 = `savingsDepositEval(item, deposit, asOf?)`** (`utils.ts`): 단일 적립의 입금일부터
  오늘(또는 asOf)까지 단리 누적. 미입금(입금일>오늘)은 0. **불변식: 모든 적립의 savingsDepositEval
  합 = savingsEval(item)**. 적립 모달 "적립 내역" 각 행에 `입금액 (현재 평가금)` 표기(미입금 행은 "예정").
- **CRUD**: `usePortfolioState` — `handleAddSavings`, `updateSavingsField`(annualRate는 원시
  문자열 저장), `addSavingsDeposit`/`removeSavingsDeposit`(적립 모달, investAmount 재계산).
- **리밸런싱·통합뷰 노출** (펀드처럼 표시 — dc-irp): savings는 **시세·수량이 없어 매매 대상이
  아니므로 "고정 참고 행"**으로 취급한다. `usePortfolioData` `rebalanceData` 필터에 `savings` 포함
  → `curEval=savingsEval`, `expEval=curEval`(이월, 매매 0), `action/cost=0`, `isSavings:true`.
  단 **목표비중(`effectiveTargetRatio`)은 펀드처럼 편집 가능 + 목표비중 합계(100%)에 포함**(라이브
  미러 `cycleMirror` 시드 대상에도 savings 추가). `RebalancingPanel` `renderRow`는 `isSavings`면
  현재가/수량/추가/추가가능/예상주식수/실구매비용 셀을 `-`로 렌더(목표비중 셀은 편집 유지).
  카테고리 도넛(`rebalCatDonutData`)·종목별 비중은 `예적금` 카테고리로 자동 편입. `CATEGORY_DISPLAY_ORDER`
  에 `예적금`을 **FUND 다음**에 추가(통합 자산카테고리·종목별비중에서 펀드 뒤 정렬), `CATEGORY_HEX_COLORS`
  에 `예적금:#2DD4BF` 색 추가. 통합 대시보드 데이터(`useIntegratedData` 카테고리·holdings)는 이미 savingsEval 포함.
- **회귀 주의**: ① Drive 변경감지 키(`App.tsx` `portfolioStructureKey`)에 savings 고유 필드
  (annualRate/startDate/endDate/assetClass/deposits)를 포함해야 단독 수정이 저장됨(목표비중
  targetRatio/targetRatioVar는 공통 필드라 이미 포함). ② 정렬(`handleSort`)·스냅샷
  (`snapshotItemsFromPortfolio`)에서 savings 보존. ③ D/S 합산(PortfolioTable retirementStats·
  RebalancingPanel projD/S)에 savings 포함(원금보장=안전 S 기본). ⚠️ **RebalancingPanel projD/S는
  savings를 `rebalanceData`(expEval) 경유로만 합산** — 과거처럼 `savingsEval`로 별도 가산하면
  **이중 계상**. `getAssetClass`는 savings를 fund처럼 기본 S 처리(`assetClass ?? 'S'`).

### 평가액 확정 시각 — 시장별 분리 (⚠️ 회귀 주의)

일별 평가액 기록의 종가 확정 컷오프는 **시장별로 다르다** (`useMarketCalendar.ts`).

- **국내시장 계좌** `KR_CUTOFF_ACCOUNT_TYPES` = {portfolio, isa, dc-irp, pension, dividend, gold}:
  **당일 21:00 KST 확정**. `getEffectiveDateKR()` — **기록 창 09:00(개장)~21:00에만 오늘 반환**,
  그 외(21:00~익일 09:00) `null`(기록 중단). 모든 기록 경로는 null이면 skip. 미래 날짜 기록 금지.
  ⚠️ **개장 전 placeholder 금지가 핵심** — 과거 "자정부터 전일 종가 이월값을 당일 날짜에
  isFixed:false로 기록"하는 설계는 실시간 기록 보호 가드가 그 오귀속 값을 영구 보호해
  (새벽에만 접속하는 사용자의 기록이 매일 하루 밀림) 폐기했다. 당일 기록은 개장 후 라이브
  갱신 또는 21:00 이후 백필(종가)로 생성된다.
- **해외(overseas)·암호화폐(crypto)·현금성(matong/simple)**: 기존 글로벌 익일 07:30
  (`getEffectiveDate()`) 유지.
- **백필 상한**: `getBackfillBoundaryForAccount(accountType)` — KR 계좌는 21:00 이후
  `d < 내일`(당일 백필 허용, 밤에만 접속해도 당일 기록 확보), 그 외 글로벌 날짜.
  `getBackfillBoundaryKR()`은 "다음 실시간 기록 대상일"과 값이 같아 자산검증 스냅샷 날짜로도 사용
  (21:00 이후 구성 변경 스냅샷은 내일 날짜 → 당일 종가 재계산에 미반영, 의도된 동작).
- **당일 종가 보정 예외** (`getKrSettledTodayDate`, 21:00~24:00에만 오늘 반환): 장중 값(예 14시)
  으로 동결된 **당일** 실시간 기록(isFixed:false)에 한해 백필이 종가 재계산으로 1회 덮어쓴다
  (`useHistoryBackfill` `liveOverrideDate`). 사용자 확정(adjustedAmount)·과거 날짜·비KR 계좌의
  "실시간 기록은 권위값" 불변식은 그대로 유지.
- **규칙**: 기록 경로는 실행 시점에 `getEffectiveDateForAccount`/`getBackfillBoundaryForAccount`를
  직접 호출한다. `App.tsx`의 `effectiveDateKey`/`krEffectiveDateKey` state는 **재실행 트리거일 뿐**
  기록 날짜로 쓰지 말 것(타이머 드리프트 자가보정). 타이머는 07:30/09:00/21:00 3경계 재무장 루프
  (`getMsUntilNextBoundary`). 자정엔 두 날짜 모두 변하지 않아 경계 불필요.
- ⚠️ **accountType 해석 통일**: `portfolioSummaries`의 `accountType`은 시장 계좌가 전부
  `'portfolio'`로 고정(`useIntegratedData.ts` — overseas/gold/crypto 포함)이고, 레거시 계좌는
  accountType 미설정(undefined)일 수 있다 → 시장 분류 시 반드시 `portfolios` 배열에서
  `p.accountType || 'portfolio'`로 해석(`useHistoryBackfill` 효과 #1 `typeById` 참조). 동결 skip과
  타입 해석은 사전체크 루프와 setPortfolios map **양쪽에 동일하게 미러링** 필수 — 한쪽만 다르면
  ref 키 불일치로 `needsUpdate` 영구 true → 렌더/Drive 저장 무한 루프.
- **MA: 펀드 자동기록 2곳(App.tsx, useStockData.ts)은 의도된 예외** — 펀드 기준가는 익일 발표라
  21:00에 "확정된" KR 날을 다음날 아침 NAV로 보정(덮어쓰기)한다. 건드리지 말 것.

### 평가액 history 날짜 중복 방지 (⚠️ 회귀 주의 — 절대 raw append 금지)

각 계좌 `p.history`는 **날짜당 1건** 불변식을 유지한다. history에 레코드를 추가하는 모든
경로는 `findIndex(h => h.date === date)` 또는 날짜 Set 가드로 **같은 날짜 중복을 막아야** 한다.
- 실시간 자동기록은 `isFixed:false` + `evalAmount>0` → **권위 값, 절대 백필로 덮어쓰지 말 것**.
- 안전 경로(가드 있음): 자동 백필 `applyUpdates`(`useHistoryBackfill.ts` findIndex+실시간 보호),
  일별 자동기록(`App.tsx` today 교체), MA펀드/비활성/simple 기록(findIndex), `fillNonTradingGaps`(dateSet).
- **과거 버그**: 수동 백필 `fillMissing`이 `existingDates`를 `isFixed`만으로 산출해 실시간 레코드
  있는 거래일을 '누락'으로 오판 → 같은 날짜 백필 레코드를 raw append. 통합 합산 Map(last-wins)이
  뒷값(백필)을 채택해 그 날 총자산이 틀어졌음. → `existingDates = new Set(hist.map(h=>h.date))` +
  `mergeMissing`(없는 날짜만 추가)로 수정.
- **로드 시 방어**: `utils.ts` `dedupeHistoryByDate`가 `applyStateData`/`applyBackupData`/레거시
  복원에서 기존 중복을 정리(우선순위 실시간>확정>백필, 중복 없으면 동일 참조 반환).
- 검증: `npm run verify:history`.

### 현금성 계좌(마통·직접입력)는 평가액 추이·팝업에서 '스냅샷 carry-forward' 처리 (⚠️ 회귀 주의)

**마통(`matong`)·직접입력(`simple`)은 시장 시세 이력이 없는 현금성 계좌**다 — 값은 사용자가
편집할 때만 바뀐다. 평가금액=투자원금=예수금이라 **수익·수익률은 항상 0**이어야 한다(라이브 표
불변식). 일별 자동기록(`useHistoryBackfill`)이 그날의 잔액을 `p.history`에 적재하므로, 추이/팝업
에서 **시장 계좌처럼 스냅샷 carry-forward로 과거 그날의 기록값을 그대로 복원**한다. **현재값을
과거 날짜에 소급하지 않는다** — '오늘'만 현재값을 권위로 사용(최신 편집·비움 즉시 반영).
- **설계 전환 배경**: 과거엔 "현재값을 시작일 이후 평탄 반영"(스냅샷 무시)했으나, 이는 현재값을
  편집하면 **모든 과거 날짜가 소급 변경**돼 일별 분석 기록이 부정확해지는 문제가 있었다(예: BNK
  마통을 8.29M→9.29M 수정 시 6/2~6/5 팝업이 전부 9.29M로 바뀜). 일별 스냅샷이 이미 존재하므로
  이를 신뢰해 carry-forward로 복원한다.
- **유령 잔액(emptied-to-0) 회귀 방지**: 평탄 설계가 본래 막으려던 버그는 "CMA를 0으로 비워도
  과거 양수 스냅샷이 carry-forward로 **오늘**까지 박제"되던 것. 핵심 원인은 **비움(0)이 스냅샷에
  기록되지 않아** 마지막 양수값이 계속 이월된 것. → `useHistoryBackfill` 자동기록이 현금성 계좌는
  **0도 기록(오늘 값 변경 시 upsert)** 하도록 수정 → 비우면 `{오늘:0}`이 남아 carry-forward가
  0으로 이어진다. 과거 날짜는 그날의 실제값을 유지(=정확). (단 한 번도 잔액이 없던 빈 계좌는 0
  스냅샷 생략 — 노이즈 방지.)
- **구현(현재 설계)**: `computedIntHistory`·`histDetailRows` 양쪽에서 현금성 계좌를 **동일 규칙**으로
  처리. `cashSeries`(차트)는 `p.history` 스냅샷 맵(0 포함, `evalAmount>=0`)을 carry-forward하여
  `cashByDate`로 날짜별 잔액 산출 — `오늘=currentEval`(simple=`evalAmount`, matong=`wt-(cw+wl)`),
  `시작일 이전=0`. 원금도 `cashByDate` 동일 합산(평가와 동일 → 수익 0). 팝업도 `isCash`면 실시간
  날짜는 `currentEval`, 과거는 `rec`(스냅샷 carry-forward, `evalAmount>=0`); `effPrincipal=
  depositAmt=evalAmt`, 시작일 가드 `startDate>histDetailDate`면 제외. **양쪽이 같은 스냅샷 carry-
  forward를 쓰므로 팝업 소계 = 차트 그날 값**으로 항상 일치.
- **주의**: 더는 현금성 계좌를 "현재값 평탄 합산"하지 말 것. 차트·팝업·자동기록 셋이 같은 스냅샷
  규칙(0 포함 carry-forward + 오늘 현재값)으로 묶여야 일치한다.
- 시장 계좌(주식·gold·overseas 등)는 종전대로 스냅샷 carry-forward(`evalAmount>0`) + 입출금 시점
  원금 보정식 유지. 현금성과 달리 0은 미로드로 보고 기록·합산에서 제외.

### usePortfolioState 훅 (모든 포트폴리오 상태 + CRUD)
`switchToPortfolio`, `addPortfolio`, `deletePortfolio`, `addSimpleAccount`,
`updateSimpleAccountField`, `updatePortfolioStartDate`, `updatePortfolioName`,
`updatePortfolioColor`, `resetAllPortfolioColors`, `updateSettingsForType`,
`updatePortfolioMemo`, `movePortfolio`, `handleUpdate`, `handleDeleteStock`,
`handleAddStock`, `handleAddFund`,
`handleAddSavings`, `updateSavingsField`, `addSavingsDeposit`, `removeSavingsDeposit` (예적금, dc-irp 전용),
`updateDividendHistory`, `updatePortfolioDividendHistory`, `updatePortfolioActualDividend`,
`updateTaxBasePurchases`, `updateTaxBaseSales`, `updateTaxBaseExPrice`, `updateTaxBaseAvgPrice` (한국 ETF 과표 입력)

### 분배금 데이터 구조
- `portfolio.dividendHistory`: `{ [code]: { [YYYY-MM]: perShareAmount } }` — API 조회
- `portfolio.actualDividend`: `{ [code]: { [YYYY-MM]: absoluteAmount } }` — 사용자 입력(절댓값, 수량 무관)
- `portfolio.rowColor`: 계좌별 색상 (hex) — DividendSummaryTable compact 그라데이션에 사용
- **저장 키는 배당락월(YYYY-MM) 기준** 유지. dividendExDate/actualDividend/actualDividendQty/dividendTaxAmounts/actualAfterTax* 동일.
- `portfolio.taxBaseHistory`: `{ [code]: { purchases: [{id,date,shares,taxBasePrice}], sales: [{id,date,shares}], exTaxBase: {[YYYY-MM]: number}, avgTaxBase: {[YYYY-MM]: number} } }` — 한국 ETF 과표 입력. `exTaxBase`(배당락일 과표) / `avgTaxBase`(시점별 평균 과표) 모두 월별 저장. `KrEtfTaxMatrix`의 5단 셀(배당 과표·보유 주식수·평균 과표·과세 과표·예상 과세)에서 직접 입력. **평균 과표 자동 산출(매입 이벤트 기반)·분배금 표 세금 적용 로직은 추후 작업.** `calculateKrEtfDividendTax`(utils.ts) 함수는 `dividendTaxAmounts[code][ym]`을 채울 때 사용 가능하지만 현재 UI에서는 호출되지 않음.
- 모달 노출 조건: `accountType ∈ {portfolio, dividend, isa, pension, dc-irp}` (한국 ETF 보유 가능 타입). 탭 무관 항상 노출. `npm run verify:tax`로 계산 함수 단위 테스트.

### 분배금 현황 = 지급월 기준 표시
`DividendSummaryTable`의 12개월 컬럼은 **지급일(배당락+2영업일, `dividendPayDate`) 기준**으로 재배치한다.
저장 키는 배당락월 그대로 두고 `buildPaySlots(codeHistory, codeExHistory, hol)`가 종목별로
지급월 슬롯(0-11)에 소스 이벤트를 모은다. 각 `monthData[i].yearMonth`는 지배(금액 큰)
소스의 배당락월 키 → 셀 편집/세금 조회가 올바른 저장 키를 가리킨다.
- 직전연도 12월 배당락 → 올해 1월 지급분은 1월 슬롯에 편입
- 올해 12월 배당락 → 내년 1월 지급분은 올해 표에서 제외
- 한 지급월에 2건 겹치면 **합산**, 분배락/지급일·주당분배금 표기는 지배 소스 기준
  (합산 셀은 `srcCount>1` → `DivMeta`가 "외 N건" 표기로 합계임을 명시)
- **확정 우선 dedup (⚠️ 회귀 주의)**: 한 지급월 슬롯에 `exPredicted=false`(확정 배당락)
  소스가 있으면 같은 슬롯의 `exPredicted=true`(직전연도 추정) 소스는 `buildPaySlots`
  반환 직전에 제거한다. 일정 과도기(월중→월초 등)에 직전연도 예측 배당락이 실제
  배당락의 지급월로 끌려와 **실지급 + 예측이 이중 계상**(셀 합계 ≠ 수량×주당분배금)
  되던 버그 방지. 확정 데이터가 있는 달은 예측을 노이즈로 보고 버림(확정 우선).
  검증: `npm run verify:dividend` (slots 재배치·dedup 단위 테스트).
- 예측월(분배 이력 있고 배당락일만 미확정)은 직전연도 배당락일+2영업일로 추정 배치
- **분배 이력 자체가 없는 빈 미래월**(월 입금 내역 탭): 예측값을 표시하지 않고
  빈 셀(`-`)로 두되 클릭 시 사용자가 실수령액 직접 입력 가능. 저장 키는
  `buildFallbackExYms(slots)`가 산출 — 실제 소스의 배당락월 키 및 다른 빈 슬롯의
  폴백 키와 절대 겹치지 않도록 보장(겹치면 한 셀 편집·삭제가 옆 달로 전이됨).
  slots가 고정이면 결과도 결정적이라 입력 전후 같은 셀 유지. expectedRows(월
  예상 분배금)는 빈 슬롯을 `yearMonth:''`로 두어 편집 비활성 — 폴백 미적용.
- `extraDividendRows`(수동 추가 행)는 사용자가 월을 직접 지정 → 재배치 대상 아님
- 적용 범위: expectedRows / actualRows / compactExpectedRows / compactActualRows
  (빈 미래월 폴백은 actualRows / compactActualRows 에만 적용)

### DividendSummaryTable
- `compact=false` (기본): 개별 계좌 뷰, 종목 행 표시, 셀 직접 편집 가능
- `compact=true`: 통합 대시보드 뷰, 계좌별 월 합계만 표시, rowColor 그라데이션 텍스트
- App.tsx 배치: non-compact ~1933줄 / compact ~2110줄 (`showIntegratedDashboard` 조건)

---

## 다음 작업 후보 (Phase 11~)

App.tsx 잔여 대형 블록:
1. **`handleImportHistoryJSON`** (~162줄) — JSON/CSV 가져오기, `setMarketIndices` 등 상태 의존 많음
2. **`applyStateData`** (~75줄) — useDriveSync ref 패턴으로 호출 중, 이동 시 setState 30개+ 필요 (스킵 권장)
3. **CSV 핸들러 4개** (`handleDownloadCSV`, `handleLookupDownloadCSV`, `handleDepositDownloadCSV`, `handleWithdrawDownloadCSV`) — ~51줄, 유틸 함수화 가능

작업 전 반드시 App.tsx 해당 구간을 grep/read로 의존성 파악 후 진행.

---

## 디자인 토큰 (`src/design.ts`)

신규 컴포넌트에서 매직 스트링 대신 사용:

```ts
import { BG, NOTIFY_CLASS, NOTIFY_HEX, RULED_BG_STYLE, Z, BORDER } from '../design';
// BG.primary('#0b1120'), BG.card('#0f1623'), BG.overlay('rgba(0,0,0,0.85)')
// NOTIFY_CLASS.info('text-sky-300') 등
// Z: notification(999) < dialog(1000) < overlay(1100)
// BORDER.default('border-gray-700'), BORDER.subtle('border-gray-700/40')
```

기존 컴포넌트의 매직 스트링은 유지 가능, 신규 코드부터 design.ts 사용.

---

## 알림 시스템

```ts
notify(text, type?)      // 'info'|'success'|'warning'|'error' (기본 'info')
confirm(message, label?) // Promise<boolean> — ConfirmDialog 표시
resolveConfirm(result)   // ConfirmDialog 내부 호출
markAsRead() / clearNotificationLog()
```

색상: `info`=sky-300, `success`=green-400, `warning`=amber-400, `error`=red-400

- `notify()` 대상: 시스템 메시지, 성공/실패 피드백, 파괴적 작업 확인
- 분리 유지: 모달 다이얼로그, LoginGate 인라인 에러, Header Drive 상태 아이콘
- `ConfirmDialog.tsx` props: `state: ConfirmState | null`, `onResolve: (r: boolean) => void`

---

## 학습자료(notebook) — 외부 링크 + HTML 파일

상단 노트북 아이콘 드롭다운에 표시되는 학습자료. `notebookLinks: { title, url?, fileId?, createdAt }[]`
배열로 관리하며 **관리자 Drive `app_settings.json` + Apps Script 설정 시트 셀**(`notebookLinks` JSON)
에 저장·배포된다. 학습자료 ON(`notebookEnabled`) 사용자 + 관리자만 노출. 신규 등록 시
`__notebook__` 센티넬 알림 발송(학습자료 ON 사용자만 수신).

- **외부 링크형(`url`)**: 기존 방식. 드롭다운 클릭 → 새 탭(`target="_blank"`).
- **HTML 파일형(`fileId`)**: 자체완결형 HTML을 관리자가 업로드 → **관리자 Drive에 `text/html`로
  저장 + "링크 있는 사람 누구나 보기(anyone/reader)" 권한 부여** → fileId만 배열에 저장(시트 5만 자
  제약 무관). 드롭다운 클릭 → **`<iframe sandbox="allow-scripts allow-popups" srcDoc>` 격리 뷰어 모달**.
- **왜 공개 권한 + 프록시인가**: 일반 사용자는 `drive.file` scope라 관리자 Drive 파일을 직접 못 읽음.
  → 파일을 공개로 두고 **`/api/study-material?id={fileId}` Edge 함수**가 서버사이드로 읽어 `text/plain`
  (+nosniff)로 중계, 클라이언트가 응답 텍스트를 srcDoc에 주입. Drive는 HTML을 렌더 안 하므로 직접 링크 불가.
- **격리(⚠️ 회귀 주의)**: iframe sandbox에 **`allow-same-origin` 절대 미부여** — 부여 시 앱 origin의
  localStorage/Drive 토큰 접근 가능해짐. `allow-popups-to-escape-sandbox`도 미사용(팝업도 샌드박스 유지).
- **Edge 함수 보안**: ① `Sec-Fetch-Site: cross-site/same-site` 차단 + CORS 허용 헤더 미부여(같은 출처
  전용, 오픈 릴레이 방지) ② fileId 정규식 `^[a-zA-Z0-9_-]{10,128}$`(SSRF 차단) ③ 공개 다운로드
  엔드포인트(`drive.usercontent.google.com`)는 로그인/바이러스검사 인터스티셜 HTML을 200으로 줄 수
  있어 `looksLikeInterstitial`로 검증 후에만 중계(미검증 중계 시 가짜 페이지가 뷰어에 뜸).
- **`GOOGLE_API_KEY`(Vercel env, 선택)**: 설정 시 Drive API(`alt=media`)를 1순위로 사용(인터스티셜
  없음, 안정적). 미설정 시 공개 다운로드 엔드포인트만 사용(소형 공개 HTML은 정상이나 인터스티셜 위험).
  **운영 안정성 위해 설정 권장.**
- **CRUD**: `App.tsx` `handleUploadStudyMaterial`(업로드+공개권한→fileId) / `handleDeleteStudyMaterialFile`
  (링크 삭제 시 Drive 원본 정리), `driveStorage.ts` `uploadHtmlStudyMaterial`/`deleteDriveFileById`,
  `AdminPage.tsx` 업로드 UI(`handleUploadStudyMaterialFile`). 저장/로드 경로는 배열을 그대로 통과시켜
  fileId 보존(별도 정규화 없음).

---

## 브라우저 저장소 정책

### ETF 비중·PER 데이터 — 메모리 캐시만 사용

ETF 구성종목 비중(holdings)과 PER 데이터는 **JavaScript 메모리(Map)에만** 저장한다.

- sessionStorage/localStorage 사용 금지: 같은 탭에서 다른 사용자가 로그인하면 이전 사용자 데이터 노출
- Google Drive 저장 금지: ETF API 캐시는 사용자 데이터가 아님, Drive 저장 불필요
- 페이지 새로고침 시 재조회: 서버사이드 `/api/etf-holdings`, `/api/stock-per` Edge Function 경유
- 수집일 "확인: YY/MM/DD"는 `_etfHoldingsFetchAt`, `_stockPerFetchAt` Map에 인메모리 보관

### localStorage 사용 제한 — 다중 사용자 계정 오염 방지

이 앱은 **하나의 디바이스에서 여러 Google 계정이 번갈아 로그인**하는 사용 패턴이 있다.
**같은 탭에서 로그아웃→로그인 시 sessionStorage도 유지**되므로 API 캐시 데이터도 오염 위험이 있다.

**원칙:**
- `localStorage`, `sessionStorage` 모두 API 캐시에 **사용 금지**
- 예외: 사용자 무관한 공통 데이터 (공휴일 등) — `localStorage` 유지 허용
- `src/hooks/useMarketCalendar.ts` — `marketCalendarCache_v4`: 공휴일 데이터이므로 예외 허용

---

## 증시 휴장일 (KRX/NYSE)

`useMarketCalendar`는 nager.at를 직접 호출하지 않고 **`/api/market-calendar`** 단일
서버리스 엔드포인트를 호출한다 (직전연도~+5년치, localStorage `marketCalendarCache_v4` 7일 캐시).
직전연도 포함: 직전연도 12월 말 배당락(예: 12/29)의 지급일(T+2)이 직전연도 KRX
연말 휴장(12/31)을 건너뛰어 올해 1월로 넘어가므로 분배금 지급월 재배치에 필요.

- **`api/_marketCalendarData.ts`** — 큐레이션 스냅샷(2026~2031, 검증·보정 완료).
  언더스코어 = 비라우트 데이터 모듈. `CURATED_KR/US`, `KRX_ADHOC/NYSE_ADHOC`.
- **`api/market-calendar.ts`** — Edge 함수. 우선순위: 큐레이션 > 범위 밖 nager 라이브 >
  최소 폴백. 항상 적용 규칙: KR 연말 휴장(12/31), NYSE Good Friday,
  미휴장 항목 제외, ADHOC 병합. 엣지 캐시 `s-maxage=86400`.
- **보정 규칙**: KR은 제헌절(7/17) 제외(2008년부터 증시 개장), 부처님오신날 토/일
  대체공휴일 보강(2023 신설, nager 미반영). NYSE는 Columbus/Indigenous/Veterans/
  Lincoln/Truman 제외, 토요일 새해 직전 금요일 미관측.
- **유지보수**: 매년 11~12월 KRX 익년 휴장일정·NYSE 캘린더 공시 시
  `_marketCalendarData.ts`에 +1년치 추가 + 거래소 임시휴장(선거일·국가 애도일)을
  `*_ADHOC`에 반영 후 일반 커밋. 6년 버퍼라 갱신 누락돼도 즉시 장애 아님.
- **검증**: `npm run verify:calendar` — 큐레이션 ↔ nager 라이브 교차검증,
  드리프트 시 종료코드 1.

---

## 코딩 규칙

- `// @ts-nocheck` 유지 (App.tsx, 일부 훅) — props 타입 명시 불필요
- 함수 이동 시 functional update 패턴 (`setPortfolio(prev => ...)`)
- 순수 유틸 → `utils.ts` | React 상태 관련 → 훅
- 알림: 반드시 `notify(text, type)` — `window.alert/confirm` · 인라인 토스트 div 금지
- 빌드 검증: `npm run build` (에러 0개)
- 불필요한 주석·빈 줄 추가 금지

## 작업 흐름

1. 요구사항 불명확 → 먼저 질문 후 진행
2. grep/read로 영향 코드 전체 파악 (CLAUDE.md + memory 참조)
3. 기존 아키텍처 적합 여부 판단 → 재설계 시 CLAUDE.md 업데이트
4. 완전한 구현 (임시 코드, 하위 호환 shim 없이)
5. `npm run build` 에러 0 확인
6. **자동 커밋·푸시**: 검증 끝나면 별도 확인 없이 `git add` → `git commit` (한국어, `feat(영역):`/`fix(영역):` 컨벤션) → `git push` 일괄 실행. 예외(여전히 사전 확인 필요): 파괴적 작업(force push, reset --hard, 브랜치 삭제), `--no-verify`·`--no-gpg-sign` 등 훅·서명 우회, 광범위 리팩토링이나 다수 파일 일괄 변경, main 외 보호 브랜치로의 푸시.
