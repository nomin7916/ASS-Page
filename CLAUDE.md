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
├── watchlistQuote.ts    # 관심종목 코드→시장 판정(detectMarket)·시세/이력 조회(api.ts 재사용)
├── config.ts            # UI_CONFIG, GOOGLE_CLIENT_ID, ADMIN_EMAIL
├── constants.ts         # INT_CATEGORIES, ACCOUNT_TYPE_CONFIG, 차트 키 상수
├── design.ts            # 디자인 토큰: BG, NOTIFY_CLASS, RULED_BG_STYLE, Z, BORDER
├── utils.ts             # 순수 유틸 (generateId, cleanNum, hexToRgba, blendWithDarkBg 등)
├── chartUtils.tsx       # 차트 컴포넌트/유틸 (PieLabelOutside, CustomChartTooltip 등)
├── driveStorage.ts      # Google Drive 저장/불러오기
├── flowMap.ts           # 자금 흐름도 타입 + 순수 로직 (⚠️ @ts-nocheck 금지)
├── backtest.ts          # 백테스트 엔진: 타입 + 순수 로직 (⚠️ @ts-nocheck 금지, verify-backtest 미러)
├── backtestFetch.ts     # 백테스트 전용 종가 조회 래퍼 (⚠️ stockHistoryMap 병합 금지)
├── hooks/               # usePortfolioState, useDriveSync, useMarketData,
│                        # useHistoryChart, useChartInteraction, useStockData, usePinManager,
│                        # useFlowMapData
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
    ├── StockTransferModal.tsx    # 종목 계좌 간 이관 모달(미리보기 후 적용, z=1070)
    ├── CustomDatePicker.tsx      # 날짜 선택기
    ├── LoadingOverlay.tsx        # 앱 시작 블로킹 오버레이 (z-1100)
    ├── ConfirmDialog.tsx         # window.confirm() 대체 모달
    ├── LoginGate.tsx             # 로그인 / PIN 인증 게이트
    ├── WatchlistPopup.tsx        # 관심종목 이동 가능 비차단 팝업(그룹·종목·미니차트·최근조회)
    ├── FlowBoard.tsx             # 자금 흐름도 보드(z=990) — 로컬 사본 + idle 승격, overlay/page 겸용
    ├── FlowCanvas.tsx            # 흐름도 SVG 캔버스(React.memo) — 드래그·리사이즈·연결
    ├── FlowInspector.tsx         # 흐름도 속성 패널(날짜·이름·계좌연결·금액·메모) — id 앵커 draft
    ├── FlowWindow.tsx            # 흐름도 별도 브라우저 창(/?flowWindow=1) — postMessage 브릿지
    ├── BacktestPage.tsx          # 리밸런싱 백테스트 페이지(z=1090, body 포털) — overlay/page 겸용
    ├── BacktestWindow.tsx        # 백테스트 별도 브라우저 창(/?backtestWindow=1) — postMessage 브릿지
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

계좌별 boolean `p.isTest`. 통합 계좌 현황 표의 **계좌명 셀 빈 공간 클릭**으로 ON/OFF
(`togglePortfolioTest` — `usePortfolioState`). ON이면 계좌명이 **이탤릭+녹색**으로 표시되고
통합 대시보드의 **모든 합산·차트·비중에서 제외**되지만 표의 행 자체는 그대로 노출된다(계좌를
열면 개별 뷰는 정상 동작 — 데이터는 보존, 해제 시 즉시 복원).

- **제외 지점(8곳, 새 통합 합산 추가 시 빠짐없이 isTest 필터 필수)**:
  `useIntegratedData` — ① `intTotals`(소계+카테고리 비중, `intCatDonutData`는 intTotals.cats 경유로 자동 제외)
  ② `computedIntHistory`의 `cashSeries`/`accountSeries`/`portfolioPrincipalData`(수익율 그래프·평가액 추이)
  ③ `intDepositEvents`(입출금 마커) ④ `intHoldingsDonutData`(종목별 비중).
  `IntegratedDashboard` — ⑤ `histDetailRows`(추이 팝업 소계, 차트값과 일치 유지) ⑥ `appTrackingStartDate`
  (역추산 경계 마커). `portfolioSummaries`는 행 표시를 위해 **제외하지 않고** `isTest`만 노출.
- **표 UI**: TEST 행의 **평가비중 셀은 `-`**(100% 합계에서 빠지므로). 계좌명 셀의 **빈 공간 클릭=
  TEST 토글**(td onClick), **계좌명 텍스트 클릭=계좌 열기**(span onClick+`stopPropagation`),
  simple/matong 이름 input은 `onClick stopPropagation`으로 편집 중 토글 방지. 별도 토글 버튼/아이콘 없음.
- **persist**: `App.tsx` `portfolioStructureKey`에 `isTest` 포함(단독 토글도 Drive 저장 트리거).
  로드 정규화(`applyStateData`/`applyBackupData`)는 `...p` 스프레드라 자동 보존.
- **관리자 포털**(`AdminPortal.tsx`)도 TEST 계좌 제외: 사용자 Drive `stateData.portfolios`를
  읽는 시점(`handleRefresh`)에 `.filter(p => !p.isTest)` 1회 적용 → 평가총액·투자원금·전일대비·
  일별 추이 매트릭스가 전부 그 `portfolios`에서 파생되므로 일괄 제외(소스 단일 필터).
- **범위 밖(의도)**: 분배금 현황 표(통합 compact)는 isTest 미적용. `useHistoryBackfill`의 계좌별
  일별 자동기록도 미적용(TEST 계좌도 자기 history는 계속 기록 → 해제 시 데이터 온전).

### 계좌 소프트 삭제 `deletedAt` — 과거 총자산 보존, 삭제일 이후 제외 (⚠️ 회귀 주의)

계좌 삭제는 배열에서 제거하지 않고 `p.deletedAt`(삭제일 `YYYY-MM-DD`, `getTodayKST`) 태그만 단다
(`deletePortfolio` — `usePortfolioState`, 하드삭제 아님). 과거 삭제로 통합 일별 총자산이 소급 붕괴하던
문제(computedIntHistory·histDetailRows가 라이브 `portfolios[]`에서 100% 재파생 → 배열 제거 시 그 계좌의
모든 과거 기여 소멸)를 해결. **복원**(`restorePortfolio` — deletedAt 제거) / **영구삭제**(`purgePortfolio` —
과거 기록까지 하드삭제) 제공. `IntegratedDashboard` 통합 표 하단 **접힌 "삭제된 계좌" 관리영역**에 노출
(복원·영구삭제 버튼). 탭바·라이브 표에서는 숨김.

- **핵심 불변식**: 계좌별 경계 `cutoff = min(deletedAt, today)`(더 이른 날짜, `today`=effectiveDate).
  삭제 계좌는 **`d < cutoff` 날짜에만 삭제 전과 동일하게 기여**하고, `d >= cutoff`(라이브/오늘 포함)에는
  존재하지 않는 것처럼 처리. `min`인 이유: 새벽(00:00~07:30 KST, effectiveDate가 전일) 삭제 시 라이브
  시점(today)의 평가(override=제외)와 원금·현금 carry-forward가 어긋나지 않게 today에서도 정지.
- **라이브/현재 = 완전 제외**: `intTotals`·`intHoldingsDonutData`(`useIntegratedData`, `if(s.deletedAt)`/
  `if(p.deletedAt) return`), 통합 표 렌더(`IntegratedDashboard` regular/matongAccounts `.filter(!s.deletedAt)`),
  탭바(`AccountTabBar` visiblePortfolios), 분배금 compact(`DividendSummaryTable` nonGoldPortfolios),
  관리자 포털 라이브 총액(`AdminPortal` livePortfolios=`filter(!deletedAt)` → needs/recompute/computePrincipal).
  `intCatDonutData`는 intTotals.cats 경유 자동 제외. `portfolioSummaries`는 행 판정용 `deletedAt` 태그만 노출.
- **시계열 = `d < cutoff` 보존**: `computedIntHistory`의 accountSeries·cashByDate carry-forward loop와
  effectivePrincipal reduce가 `cutoffOf(deletedAt)`로 `d >= cutoff` break/skip. `marketSeries`·`cashSeries`는
  삭제 계좌를 **유지**(시계열 소스)하되 `deletedAt` 실어 보냄. `intDepositEvents`는 `date < deletedAt` 마커만.
  팝업 `histDetailRows`(`IntegratedDashboard`): `if(p.deletedAt && (isRealtimeDate || histDetailDate >= p.deletedAt)) return`
  + 이름에 `(삭제됨)` 접미. 관리자 일별 매트릭스 `buildUserSeries`는 full portfolios에 `cutoff` 캡(+cutoff 날짜를
  ds에 추가해 주말 삭제도 경계에서 하락 materialize).
- **⚠️ WRITE 동결(삭제일 이후 신규 기록 금지, 기존 이력 불변)**: `useHistoryBackfill` 효과#1(사전체크 `s.deletedAt`
  + map `p.deletedAt` **양쪽 미러링** — 무한루프 불변식)·효과#2(`computeUpdates` 첫 줄 `if(p.deletedAt) return null`),
  `useStockData`(수집·기록 map·펀드 NAV 3경로 `|| p.deletedAt`), `useAutoConfirmHistory`(`computeConfirms`),
  `App.tsx` 스냅샷 효과(`maybeUpdate`).
- **⚠️ 활성 계좌 기록 효과(App.tsx today-effect·MA펀드 효과)는 `deletedAt` 미가드 시 동결 계좌를 오염**:
  삭제 대상이 활성이고 남은 비삭제 계좌가 현금뿐이면 과거엔 activePortfolioId가 삭제 계좌에 남아 두 활성 효과가
  이력을 계속 썼다. → ① `deletePortfolio`/`purgePortfolio` else 분기 `setActivePortfolioId(null)`(activePortfolio=null
  → totals=0 → 효과 no-op) ② 두 효과 상단 `if(activePortfolio?.deletedAt) return` ③ 로드
  (`applyStateData`/`applyBackupData`)에서 restored 활성이 `deletedAt`이면 firstLive(비삭제 비현금)로 대체/없으면 null.
- **⚠️ 이상치 가드 멤버십 일치**: `computedIntHistory` today 보정의 `prevValue`(직전 거래일 총액)는 삭제 계좌를
  포함(prevDate<cutoff)하므로, **지배적(비중>90%) 계좌 삭제를 가격 미로드 이상치로 오판**(today를 옛 총액으로
  되돌려 삭제 계좌 부활)한다. → prevDate에서 삭제 계좌 몫을 빼 intTotals(삭제 제외)와 같은 집합으로 맞춤.
- **persist**: `App.tsx` `portfolioStructureKey`에 `deletedAt` 포함(삭제/복원이 저장 트리거). state 리터럴은 배열
  전량 저장(삭제 계좌 보존), `applyStateData`/`applyBackupData` `...p` 스프레드로 자동 보존.
- **동명 신규 계좌 = Drive 충돌 없음**: 계좌는 어디서도 name이 아니라 고유 `id`(`generateId`)로만 저장·매칭.
  삭제 계좌 보존 + 동명 신규(다른 id) 공존 → 혼선 없음. 팝업 `(삭제됨)` 표기로 시각 구분.
- **범위 밖(의도)**: 분배금 compact는 삭제 계좌 제외(라이브 뷰). 삭제일 boundary의 '오늘 수익' 절벽
  (예: 07-14=₩100M → 07-15=₩70M, dod −30%)은 "과거 불변 + 삭제일부터 제외" 불변식의 필연적 결과(정상).

### 관리자 "접속" = 새 탭 impersonation (⚠️ 회귀 주의 — 같은 탭 교체 금지)

관리자 포털/관리자 페이지의 **"접속" 버튼**은 대상 사용자 대시보드를 **새 탭**에서 연다
(`handleAdminViewUser` → `window.open('/?adminView=<email>', '_blank', 'noopener')`). 과거엔
같은 탭에서 관리자를 로그아웃→사용자로 재로그인하는 방식이라 **포털로 복귀할 때마다 전 사용자
Drive를 재조회**(느림)했다. 새 탭은 포털 탭을 건드리지 않아 **포털의 in-memory 조회 캐시가 유지**
된다(복귀 시 재조회 없음). 클릭 제스처 직후 **동기** `window.open`이라야 팝업 차단을 피한다.

- **콜드부팅 진입**: `App.tsx` 모듈 스코프 `ADMIN_VIEW_EMAIL = URLSearchParams.get('adminView')`.
  파라미터가 있으면 렌더 전에 `sessionStorage.removeItem(SESSION_KEY)`(복제된 관리자 세션이
  LoginGate 자동 재인증을 발동시켜 impersonation과 충돌하는 것 방지). 렌더 분기:
  `!authUser && ADMIN_VIEW_EMAIL && !adminViewUserCtx` → `AdminViewBootstrap`.
- **`AdminViewBootstrap.tsx`**: GIS 무음 OAuth(**전체 drive 스코프**, hint=ADMIN_EMAIL) →
  **`fetchUserEmail(token) === ADMIN_EMAIL` 검증(⚠️ findUserIndexFolder보다 먼저)** → 대상 폴더
  검색 → 관리자 PIN 해시(sessionStorage→`loadPinFromDrive` 폴백) → `onReady(ctx)` →
  `setAdminViewUserCtx`. 이후는 **기존 LoginGate impersonation 경로 그대로**(PIN 화면 → 관리자
  마스터 PIN 또는 대상 PIN → `handleLoginApproved` adminViewUserCtx 분기). impersonation은
  SESSION_KEY를 쓰지 않아(`LoginGate` `handlePinSubmit` `!adminViewUserCtx` 가드) 새 탭은 세션을
  영속하지 않는다(새로고침 시 `?adminView`로 재부팅 — PIN 재잠금).
- **⚠️ ADMIN_VIEW_EMAIL 가드 불변식**: impersonation 탭의 **모든 로그아웃/reload 경로**는
  `if (ADMIN_VIEW_EMAIL) { closeAdminViewTab(); return; }`를 둬야 한다 — `reload()`가 `?adminView`를
  유지해 **세션 종료 대신 재부팅 루프**가 되기 때문. 적용처: `useDriveSync` `onForceLogout`(비활동/
  세션충돌), `UserInfoBar` `onLogout`, `LoginGate` `onCancelAdminView`. `closeAdminViewTab`은
  `window.close()` + 150ms 폴백 `location.replace(origin+'/')`(noopener 탭은 close가 막힐 수 있음).
- **보안**: 토큰은 메모리/React state에만(URL·storage 금지 — URL엔 이메일만). `?adminView`는
  공격자 조작 가능하나 `=== ADMIN_EMAIL` OAuth 신원 검증으로 게이팅(비관리자는 데이터 접근 0).
  noopener로 새 탭의 `window.opener`(포털 탭) 접근 차단. 신뢰 경계는 기존 포털과 동일.
- **회귀 주의**: 옛 핸들러가 채우던 `userAccessStatus`(AdminPage 허용/차단 배지)는 새 흐름에선
  `handleRefreshUserSessions`(세션 새로고침)가 STATE의 `adminAccessAllowed`로 채운다.

### 관리자 페이지 "포털" 버튼 = 새 탭 (⚠️ 회귀 주의 — 같은 탭 교체 금지)

관리자 페이지의 **"포털" 버튼**(`AdminPage` `onOpenPortal`)은 관리자 포털을 **새 탭**에서 연다
(`App.tsx` `onOpenPortal` → `window.open('/?adminPortal=1', '_blank')`). 관리자 페이지 탭은 상태
변경 없이 그대로 유지된다(과거엔 같은 탭에서 `setShowAdminPage(false); setShowAdminPortal(true)`로
교체). "접속" 새 탭 impersonation과 같은 사용성 — 관리자 페이지를 잃지 않고 포털을 병렬로 본다.

- **콜드부팅 진입**: `App.tsx` 모듈 스코프 `ADMIN_PORTAL_BOOT = URLSearchParams.get('adminPortal')==='1'`.
  ⚠️ **`adminView`와 달리 SESSION_KEY를 제거하지 않는다** — opener의 sessionStorage가 새 탭에
  복제되면(`noopener` 미사용이라 복제됨) `LoginGate` 무음 재인증이 그 관리자 세션으로 진행돼
  **PIN 없이** 포털로 진입한다. `handleLoginApproved`에서 관리자 + `ADMIN_PORTAL_BOOT`이면
  `adminPendingChoice`(선택 모달)를 건너뛰고 `setShowAdminPortal(true)`. 토큰은 `LoginGate`/
  `AdminPortal`이 GIS로 독립 재발급하므로 **`noopener` 미사용**(noopener는 sessionStorage 복제를
  막아 무음 재인증을 깨므로 절대 추가 금지 — impersonation과 반대).
- **sessionStorage 미복제 브라우저 폴백**: SESSION_KEY 부재 → `LoginGate` 로그인 화면 → 수동
  로그인 후 동일하게 `ADMIN_PORTAL_BOOT` 분기로 포털 진입(우아한 degradation, 결과 동일).
- **뒤로가기**: 포털 탭의 `onClose`는 `ADMIN_PORTAL_BOOT`이면 `closeAdminViewTab()`(탭 닫기 +
  150ms 폴백 `location.replace(origin+'/')`)으로 탭을 닫는다 — 관리자 페이지는 원래 탭에 그대로
  있으므로. 새로고침 시 `?adminPortal=1` 유지로 포털에 재진입(reload-loop 아님, 의도된 동작 —
  impersonation의 reload 가드와 달리 포털 탭은 reload가 곧 재진입이라 별도 가드 불필요).

### 관리자 포털 '전일대비' = 보유종목 등락률로 직전 거래일 역산 (⚠️ 회귀 주의 — 저장 history 비교 금지)

관리자 포털(`AdminPortal.tsx`)의 **전일대비·일수익(`dailyReturnRate`/`dodAbsChange`)**은 사용자
통합 대시보드의 '오늘 수익'과 **동일해야** 한다. 대시보드는 `오늘(라이브 합계) − 직전 거래일`로
계산하고, 그 **직전 거래일 값은 `useHistoryBackfill`이 종가로 재구성한 기록**(라이브 메모리)이다.

- **과거 버그**: 관리자가 사용자 **저장된 raw `p.history`**의 마지막 날짜와 비교했다. 사용자가 직전
  거래일(예: 월요일)에 앱을 안 켰거나(그날 live 기록 미생성) 백필 재구성이 아직 Drive에 저장되기
  전이면, 저장 history의 최신 기록이 그 전날(주말 이월)이라 **직전 거래일을 건너뛰고 이틀치 등락을
  합산**했다(예: 대시보드 +0.78% vs 포털 +1.19%). 총자산은 라이브 재계산이라 일치했지만 전일대비만
  어긋났다.
- **현재 방식**: `recomputePortfolioEval`이 `{live, prev}`를 **동시 반환**. `prev`는 **각 보유종목의
  전일 종가 = 현재가 ÷ (1 + 등락률/100)** 로 `calcPortfolioEvalDetail`을 한 번 더 호출해 Σ(보유 ×
  전일 종가)를 구한다. `changeRate`는 `getLivePrice`(→`fetchStockInfo`/`fetchUsStockInfo`/
  `fetchFundInfo`/`fetchMiraeFundInfo`)가 시세와 **함께** 캐시한다(`LiveQuote = {price,changeRate}`).
  추가 API 호출 0, **저장 history·백필·휴장 달력 의존 없음** → 라이브 시세 한 번으로 직전 거래일
  복원, 비활성 사용자·impersonation에도 정확.
- **세부**: 현금성(simple·matong)·예수금·savings는 일변동 0(`prev=live`). overseas는 전일 FX
  (`fetchLiveUsdKrw`의 `fluctuationsRatio`)로, gold는 `fetchLiveGoldKr`의 `FLUC_RT`(없으면 0)로 prev
  산출. 전일 종가 미확보 종목/계좌는 **`prev=live`로 폴백**(일변동 0, 노이즈 방지). 보유 매매가
  직전일~오늘 사이 없으면 대시보드와 정확히 일치(매매 발생 시 미세 차이는 대시보드 raw diff 특성).
- ⚠️ **`buildUserSeries`/`series`는 일별 비교 매트릭스(수정3) 전용으로만 남겨둠**(그쪽은 과거 저장
  종가 기준 — footnote 명시). **메인 표 전일대비를 다시 `series[prevDate]`(저장 history)로 계산하지
  말 것** — 저장 지연 불일치가 재발한다.

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

### 해외계좌 투자금액(USD) = 사용자 입력 저장값 `investAmountUsd` (⚠️ 회귀 주의 — 파생 표시로 되돌리지 말 것)

해외 주식 행의 **'투자금액'과 '보유수량'은 사용자가 직접 입력하는 칸**이며 어느 쪽도 상대에서 자동
산출하지 않는다(국내 행과 같은 계약). 과거엔 투자금액에 저장 필드가 없어 화면이 `purchasePrice ×
quantity`를 렌더하고 blur에 `purchasePrice = 입력총액/수량`만 기록했다. 그래서 ① `14505.01` 입력 →
`50.36461805…` 저장 → 되곱해 **`14505.009999999998`**(IEEE754 왕복, 편집 초안에 그대로 노출)
② **수량만 고쳐도 총액이 저절로 바뀌는** 두 증상이 났다(사용자 보고 2026-08).

- **저장 = `item.investAmountUsd`(USD, 입력 그대로) / `item.purchasePrice` = 파생 미러(= 총액 ÷ 수량)**.
  해외 원가 소비자(`usePortfolioData` :41·:128, `useIntegratedData` :711, `bookCostOf(costBasisOnly)`,
  `handleSort` getVal, 이관 `buildTransferPlan`)는 **전부 `purchasePrice × quantity`를 읽으므로 한 줄도
  고치지 않는다**. 이 미러가 설계의 유일한 정합성 근거다 — 금액·수량 **두 편집 경로 모두**에서 반드시
  동시에 갱신할 것.
- **⚠️ 저장 필드를 `investAmount`에 얹지 말 것(신규 필드인 이유 2가지 — 되돌리면 둘 다 재발)**:
  ① 해외 항목의 `investAmount`에는 **원화 잔존값**이 남아 있을 수 있다(레거시·`PasteModal` 임포트).
  거기에 사용자 입력을 얹으면 값만 보고 원화/USD를 구분할 수 없고, 수량 편집 시 미러 재산출이 그
  원화값을 `purchasePrice`로 **세탁**해 `bookCostOf(costBasisOnly)` 방어선을 정확히 우회한다
  (통합 장부 ≈1,390배 오염 → 흡수 판정·누적 TWR 영구 오염). ② `snapshotCompositionKey`는
  `investAmount`를 담고 `purchasePrice`는 담지 않는다 → `investAmount`에 쓰면 **원가 정정만 해도 새
  보유 스냅샷**이 생겨 원장 흐름이 0인 날 `bookDelta`가 점프하고, 그 하루가 흡수 판정을 뒤집어 이후
  최대 15행(`CARRY_MAX_ROWS`)의 일간 지표가 `'-'`로 잠긴다. 신규 필드는 둘을 구조적으로 회피한다
  (레거시 점유자 없음 + 구성 지문 밖). `snapshotItemsFromPortfolio`에도 **넣지 말 것**(과거 장부는
  종전대로 미러로 산출된다).
- **⚠️ 쓰기 지점은 `usePortfolioState.handleUpdate` 하나** — 반드시
  `activePortfolioAccountType === 'overseas' && p.type === 'stock'`으로 좁힌다. 이 핸들러는
  **KrxGoldTable**(금현물은 `purchasePrice`가 사용자 입력이고 `investAmountUsd`가 없어 미러가 매입단가를
  0으로 지운다)과 **펀드 적립 모달**(`quantity` → `investAmount` 연속 호출로 펀드 행에 없던
  `purchasePrice`가 박힌다)이 함께 쓰는 범용 라이터다.
- **⚠️ 미러는 `qty > 0 && Number.isFinite(invest)`일 때만 쓴다** — 0으로 나누면 `Infinity`가 그대로
  저장되고(`cleanNum`은 숫자를 통과시킨다) `JSON.stringify`가 `null`로 직렬화해 재로드 시 원가가
  **영구 소실**된다(undo 없음). 수량 0에서는 총액만 저장하고 미러는 건드리지 않는다(나중에 수량을
  넣으면 그때 생성). 그래서 옛 `if (qty <= 0) return`(입력을 통째로 버리던 가드)은 제거됐다.
- **읽기는 `utils.overseasInvestAmount(item)` 단일 소스**: 저장값이 있으면 그대로(**0도 유효한 입력**),
  없으면 레거시 폴백 `round15(purchasePrice × quantity)`. ⚠️ 폴백의 `round15`(유효숫자 15자리)를 빼지
  말 것 — 옛 UI가 만든 행은 단가가 이미 나눗셈 결과라 되곱하면 `14505.009999999998`이 나오고, 표시는
  `formatUSD`(2자리)라 가려지지만 **편집 초안(String)에 그대로 노출**돼 "고쳤는데 그대로다"가 된다.
- **⚠️ `PortfolioTable`이 받는 행은 `totals.calcPortfolio`**라 `item.investAmount`가 이미 **원화 환산값**
  으로 덮여 있다(`usePortfolioData` :47). `investAmountUsd`는 그 덮어쓰기 대상이 아니라 스프레드로
  원본이 넘어온다 → **`usePortfolioData`는 무수정**. 셀에서 `item.investAmount`를 읽으면 ≈1,390배 오염.
- **영속화**: `App.tsx portfolioStructureKey` 항목 화이트리스트에 **`investAmountUsd` 필수**(수량 0인
  행은 미러를 쓰지 않아 이 필드만 바뀐다 → 빠지면 그 편집이 조용히 유실). 로드·백업·이관은 `...item`
  스프레드라 무수정. 그 외 **영속화 신규 지점 0곳**.
- **의미 변경(의도)**: 수량만 고치면 총액이 고정되고 **구매단가가 재산출**된다(국내와 동일). 레거시 행은
  첫 편집에서 **직전 총액**(`purchasePrice × 옛수량`)으로 1회 시드된다. 부수효과로 "수량만 늘린 날"의
  `bookDelta`가 0이 되므로 **매수했으면 투자금액도 함께 입력해야** 그날 흡수 판정이 정확하다.
- **범위 밖(의도)**: 금현물(`gold`)은 매입단가가 직접 입력이라 그대로. 펀드 좌수 표시 반올림
  (`Math.round`)도 그대로. 해외 투자금액 표시는 `formatUSD`(2자리) 유지 — 소수 3자리 이상을 입력하면
  저장은 정확하되 표시는 센트 단위로 반올림된다.
- 검증: `npm run verify:overseas` (참조 구현 미러 #1~#14 + 소스 텍스트 가드 #15~#26). `utils.ts`의
  `round15`·`overseasInvestInput`·`overseasInvestAmount`와 `handleUpdate`의 해외 분기를
  **항상 1:1 동기화**할 것. 가드는 배선을 정규식으로 단언하므로 실패 시 **먼저 정규식이 낡았는지**
  확인하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

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

### 비거래일(주말/공휴일)엔 라이브 스냅샷 금지 — 비활성 시장 계좌 (⚠️ 회귀 주의)

**증권 캘린더를 따르는 계좌(KR: portfolio·isa·dc-irp·pension·dividend·gold + overseas)는 비거래일
(주말/공휴일)에 시세가 변하지 않으므로, 그날 값은 반드시 직전 거래일 종가여야 한다.** `getEffectiveDateKR`/
`getEffectiveDate`는 요일을 검사하지 않아 토/일에도 '오늘'을 반환하므로, 기록 경로가 비거래일 라이브
스냅샷을 만들지 않도록 **거래일 게이팅**이 필요하다.

- **판정 헬퍼**: `useMarketCalendar.ts` `isNonTradingDayForAccount(accountType, date, krHolidays, usHolidays)`.
  KR 계좌는 KRX 캘린더, overseas는 NYSE 캘린더. **crypto(24시간 시장)·현금성(matong/simple, 상시 편집)은
  항상 false**(=상시 기록 허용 — 절대 게이팅/치유 대상에 넣지 말 것). 공휴일 배열이 비면(캘린더 로드 전)
  주말만 판정(graceful degradation, 주말은 캘린더 불필요).
- **예방(비활성 전용)**: `useHistoryBackfill` 효과#1의 `recDateFor`, `useStockData` refreshPrices 기록
  경로(`isActive` return 뒤 = 비활성) 둘 다 recDate가 비거래일이면 `null`로 만들어 기록을 생략한다.
  ⚠️ `recDateFor`는 **사전체크 루프와 setPortfolios map 양쪽이 같은 함수를 호출**해 자동 미러링(무한루프
  방지 불변식). **활성 계좌 today-effect(`App.tsx`)는 게이팅하지 않는다** — 활성은 라이브 시세가 완전
  로드돼 주말값=금요일 종가로 정확하고, 이미 주말 cleanup(`1841-1846`)+`fillNonTradingGaps`로 관리되며,
  게이팅하면 개별 계좌 차트(`finalChartData`)의 '오늘' 점이 주말 낮에 사라진다.
- **치유(전 계좌, 값 다를 때만)**: `useHistoryBackfill` 효과#2의 백필 실시간 보호 2곳(gap-fill
  `isProtectedEntry`, `applyUpdates` `isProtected`)에 `isNonTradingDayForAccount` 예외를 두어, 비거래일의
  `isFixed:false` 라이브 스냅샷을 직전 거래일 종가 carry-forward로 **덮어쓴다**(`applyUpdates`는 값이 실제로
  다를 때만 교체 → 정상 주말 레코드는 무손). 치유 결과(`isFixed:true`)는 `historyVerifyKey` 경유로 Drive
  영속. `getKrSettledTodayDate`(당일 21:00 예외)는 과거 날짜엔 무효라 무관.
- **과거 버그**: 비활성 KR 계좌가 토요일 09:00~21:00에 부분로드/스테일 시세(`summary.currentEval`)를
  `isFixed:false`로 그날 기록 → cleanup이 없어 영구 잔존 + 백필 실시간 보호로 금요일 carry-forward를 가림
  → 통합 대시보드 추이에 주말 딥(예: -1.52%) 후 일요일 라이브 회복(+1.53% **가짜 오늘 수익**). 활성
  COVERD는 cleanup으로 면역이라 정상이었음(원인은 비활성 계좌). 재구성(차트·팝업)은 저장값을 충실히
  재현만 하므로 버그는 재구성이 아니라 **기록측**에 있었다.
- **⚠️ crypto 제외 필수**: 24시간 시장이라 주말 라이브값이 정당 → 치유하면 손익이 지워지는 회귀.
  `isNonTradingDayForAccount`가 crypto에 false를 반환하는 것이 이 안전장치.
- **범위 밖(별개)**: 차트-팝업 overseas 소계 미세차(FX 재계산 vs 저장값)는 이 딥과 독립된 상시 이슈.

### 앱 실행 시 '수량×종가로 자동확정' (`useAutoConfirmHistory`) — 자산검증 불일치 자동 보정 (⚠️ 회귀 주의)

자산검증 모달(`VerifyEvalModal`)의 **'수량*종가로 확정'을 앱 실행 시 자동 수행**한다. `useHistoryBackfill`이
실시간 기록(`isFixed:false`+`evalAmount>0`)을 권위값으로 보호해 종가로 덮어쓰지 않으므로(당일 21:00
`liveOverrideDate` 예외만), 장중 기록된 과거 라이브 값이 종가와 어긋나도 영구히 '불일치'로 남았다 →
사용자가 손수 확정해 왔다. 이 훅이 그 동작을 자동화한다.

- **대상 레코드**: `isFixed:false`(라이브) + `evalAmount>0` + **불일치**(모달과 동일 판정) +
  **모든 가격 종목이 그 날짜의 정확한 종가/NAV(또는 manual)** + 구성 확정(`!estimated`) + `autoConfirmDeclined`
  없음. 날짜는 **과거(오늘 미만), 또는 KR 계좌(`isKrCutoffAccount`)의 당일 KST 21:00 이후**(`getKrSettledTodayDate`).
  당일 확정은 KR 전용 — crypto 등 비KR은 과거만. 확정 = `{evalAmount=adjustedAmount=재계산값, isFixed:true}`
  (수동 확정과 동일). **모든 계좌**(현금성 simple/matong 제외 — 시세 이력 없음, overseas는 환율 재계산이
  권위라 항상 '일치'로 자연 제외).
- **데이터 완비 가드(⚠️ 핵심)**: 한 가격 종목이라도 그 날짜의 **정확한 데이터가 없으면 보류**. source가
  `history`여도 `getClosestValue`의 **소급 근사(carry-back)**일 수 있어(당일 종가 미로드 시 전일 종가 반환)
  신뢰 불가 → `stockHistoryMap[code][date]`/`goldKr[date]` **해당 날짜 키 존재를 직접 확인**. `manual`(수동
  입력)·deposit·savings는 허용, 그 외(`none`/`approximate`/펀드 `currentPrice`·`evalAmount` 폴백/소급 history)는
  보류. 잘못된 값(특히 21:00 직후 당일 종가 API 지연 시 전일가, 과거 펀드 NAV 미로드 시 당일 currentPrice)을
  영구 고정하는 것 방지. 모달 수동 확정은 이 가드가 없음(사용자 재량) → 자동확정이 더 보수적. 미완비 날짜는
  라이브로 남아 데이터 로드 후 다음 실행에서 확정(또는 수동 확정).
- **추정 구성 가드**: `resolveHoldings(p,date).estimated`(스냅샷 없음·미검증 pre-baseline — 보유수량
  불확실)면 보류. 모달은 '🟡 추정' 경고로 사용자 검토를 받지만 자동 잠금은 잘못된 수량을 박을 위험 →
  구성이 확정된(`estimated:false`) 날짜만 자동확정.
- **확정 취소(`unconfirm`)는 `autoConfirmDeclined:true`를 박제** → 자동확정이 그 날짜를 재확정하지 않음
  (취소 영속). 수동 확정(`confirm`)은 `autoConfirmDeclined`를 해제. 두 핸들러는 `VerifyEvalModal`에 있음.
- **setPortfolios 합성(⚠️ 회귀 주의)**: 모든 계좌(활성+비활성)를 **단일 functional `setPortfolios`**로
  처리하고 본 훅을 **`useHistoryBackfill` 뒤에 배치**. 백필은 비활성 계좌를 non-functional
  setPortfolios(배열, 활성은 그대로 반환)로 갱신하므로, 같은 커밋에서 setHistory(=patchActive functional)와
  섞이면 active 갱신이 유실될 수 있다. 단일 functional 갱신을 백필 뒤에 두면 백필 결과 위에 안전하게
  compose된다. `applyConfirms`는 `prev`에서 `isFixed`/`autoConfirmDeclined`를 **재확인(staleness 가드)** →
  백필/사용자가 먼저 처리한 레코드는 보존. 확정 후 `isFixed:true`라 다음 실행에서 제외(멱등). deps에
  `portfolios` 없음 → 자기 setState로 재실행 안 됨(백필과 동일 패턴, 무한루프 없음).
- **당일(21:00 이후) 처리**: KR 계좌 당일은 21:00 이후에만 대상(그 전엔 today-effect가 라이브 기록,
  `getEffectiveDateKR`이 21:00 후 null이라 today-effect는 정지 → 본 훅과 시간대가 분리됨). 백필
  `liveOverrideDate`(당일)도 종가로 보정하므로 본 훅이 뒤에서 합성 시 staleness 가드로 건너뛸 수 있음(값은
  양쪽 모두 종가=정확). 활성 계좌 당일이 본 훅으로 잠기면(`isFixed`+`adjustedAmount`) **today-effect가
  라이브로 되돌리지 않도록 보존 가드**를 둠(`App.tsx` today-effect 상단: `existingToday.isFixed &&
  adjustedAmount!==undefined`면 `return prev`).
- **persist(⚠️ 회귀 주의)**: 확정/거부는 record 내용만 바꿔 `historyLen`은 불변 → 과거엔 `portfolioStructureKey`가
  안 바뀌어 `portfolioUpdatedAt` 미상승 → `useDriveSync`의 STATE 저장 가드(`portfolioUpdatedAt>lastSaved`)가
  **저장을 건너뛰어** 확정/거부가 Drive에 안 남던 버그가 있었다(수동 확정도 동일). → `portfolioStructureKey`에
  **`historyVerifyKey`**(확정 레코드 `date:반올림evalAmount` + 거부 레코드 `date:D`) 추가 → 확정상태 변경이
  키를 바꿔 `portfolioUpdatedAt` 상승 → 저장됨. **라이브(`isFixed:false`) evalAmount는 키에서 제외**(시장가
  갱신이 저장을 유발하지 않도록 — `historyLen` 주석 의도 유지). `dedupeHistoryByDate`는 원본 레코드를 그대로
  반환 → `autoConfirmDeclined` 보존. 로드 정규화(`applyStateData`/`applyBackupData`)도 `...` 스프레드라 보존.

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
- 시장 계좌(주식·gold·overseas 등)의 **평가액은 저장된 `evalAmount`가 아니라 항상 '수량×종가'로
  재계산**한다 — 아래 `buildCloseEvalSeries` 섹션 참조. 입출금 시점 원금 보정식은 유지.

### 시장 계좌 평가액 추이·팝업 = 항상 '수량×종가'(`buildCloseEvalSeries`) 단일 소스 (⚠️ 회귀 주의)

**개별 계좌 차트·자산 평가액 추이 표·통합 대시보드 추이·날짜별 '계좌별 현황' 팝업·달력 스냅샷은
전부 저장된 라이브 `p.history[date].evalAmount`가 아니라 `buildCloseEvalSeries`(항상 '수량×종가'
확정 종가)를 권위값으로 써야 한다.** 저장 evalAmount는 부분 로딩·장중 스테일 시세로 오염될 수
있어(예: 4종목 중 1종목만 로드된 ₩307,890 스냅샷) 개별 계좌(재계산=₩52.8M)와 통합 대시보드가
어긋났다. `buildCloseEvalSeries`(`utils.ts`)가 그 단일 소스다.

- **`buildCloseEvalSeries(p, dates, accountType, stockHistoryMap, indicatorHistoryMap, edk, fxRate?)`**:
  날짜별로 ① 보유수량 확정(`resolveHoldings` `!estimated`)+정확 종가 완비(`allExact`)면 `calcPortfolioEvalDetail`
  재계산값(모달 '재계산 합계'와 동일) ② 주말·휴장·종가 미로드·추정 수량이면 **직전 정확값 이월**
  (carry-forward, carry-back 근사로 튀지 않게) ③ 오늘(`edk`)·첫 정확값 이전이면 **미설정** → 호출부가
  `?? 저장 evalAmount`로 폴백. 반환 `Map<date, number>`.
- **적용 지점(모두 동일 함수·동일 입력이라 값이 일치)**:
  ① 개별 계좌: `App.tsx` `activeCloseEvalByDate` → `finalChartData`(`cb ?? exactHist.evalAmount`).
  ② `HistoryPanel`(자산 평가액 추이 표).
  ③ 통합: `useIntegratedData` **`marketSeries`**(계좌별 `{id,dates,map}`) — `computedIntHistory`(추이
  차트·`intMonthlyHistory`·달력 스냅샷)와 **`intAccountSeriesById`**(팝업용)가 공유.
  ④ 팝업: `IntegratedDashboard` `histDetailRows` 시장계좌 분기가 `intAccountSeriesById[p.id]`를
  `histDetailDate` 이하 최신값으로 carry-forward. **`computedIntHistory`의 `dateToTotal` carry-forward와
  동일 `{dates,map}` 객체를 읽으므로 팝업 소계 = 차트 그날 값 = 개별 계좌 추이**(정확한 일별 추적).
- **`edk`(오늘 skip)는 계좌별로 해석**: `isKrCutoffAccount(acctType) ? krEffectiveDateKey : effectiveDateKey`
  — `App.tsx` 개별 차트와 동일해야 통합⟷개별이 모든 시간대에서 일치. `useIntegratedData`에 `krEffectiveDateKey`
  전달 필수.
- **해외계좌 예외**: `buildCloseEvalSeries` 대상 아님. `marketSeries` 해외 분기는 종전대로 USD(과거 종가)
  ×날짜별 환율 재계산(`calcPortfolioEvalDetail(...,'overseas',...,liveFx)`) 유지. 현금성(matong/simple)도
  대상 아님(위 스냅샷 carry-forward 섹션).
- **폴백 안전망**: `buildCloseEvalSeries`가 미설정(데이터 공백·추정)일 때만 저장 evalAmount로 폴백하므로
  초기 로딩·신규 상장에도 0/NaN 붕괴 없음. `allExact`·`!estimated` 게이트라 잘못된 소급 근사로 과거를
  오염시키지 않는다.
- **⚠️ '평가액 0'은 '데이터 없음'이 아니다**: 평가 대상 detail이 0건이면(종목을 전부 이관·매도해 비운
  계좌) **exact 0**으로 확정하고 이월하지 않는다. 평가 날짜도 기록일이 아니라 `utils.evalSeriesDates`
  (기록일 ∪ 구성 변경일)를 **통합·개별 차트·추이 표 3곳이 공유**한다. 근거와 배선 4개는 '종목 계좌 간
  이관' 섹션의 "원계좌를 '비우는' 이관은 평가액 0이 실제로 시계열에 박혀야 한다" 항목 참조.
- ⚠️ **회귀 주의**: 통합 추이·팝업을 다시 `h.evalAmount`(저장 라이브값) 직접 합산으로 돌리지 말 것 —
  개별 계좌와 어긋난다. 새 통합 합산/뷰 추가 시에도 `marketSeries`/`intAccountSeriesById`(또는
  `buildCloseEvalSeries`)를 소스로 쓸 것.

### 일간 지표 = 입출금 보정(Modified Dietz) — 전일대비·일간 손익 (⚠️ 회귀 주의)

**'전일대비'와 '일간 손익'은 순 외부현금흐름(netFlow)을 제거한 뒤 산출한다.** 과거엔
`(당일 평가액 / 전일 평가액) − 1` 이라 계좌에 입금하면 입금액이 통째로 수익으로 계상됐다
(₩49,118,578 입금일에 통합 **+9.10%** / 개별 계좌 **+350.69%**. 실제 시장 수익은 ₩11,312,160 = **+1.59%**).

```
IN(t)  = Σ입금(날짜별 환율, noPrincipal 제외) + Δ현금성잔액⁺ + 신규 편입 계좌 첫 평가액
OUT(t) = Σ출금(전액)                         + Δ현금성잔액⁻ + 삭제 계좌 경계 평가액
일간 손익 = V(t) − V(t−1) − (IN − OUT)      ← 입출금 규모와 완전히 무관. 표의 주인공.
일간 수익률 = (V(t) + OUT) / (V(t−1) + IN) − 1
```

- **분모 규약(⚠️ 바꾸지 말 것)**: 유입은 기초(BOD)·유출은 기말(EOD) 가중. 분모를 `V(t−1)`로만 두면
  소액 계좌에 대형 입금 시 **+50% 폭발**(고치려던 버그의 재발), 유출까지 분모에 넣으면 전액 출금일에
  분모가 0이 되어 그날 실수익이 소실된다. 이 비대칭이 두 붕괴를 동시에 피한다.
  관리자 포털(`recomputePortfolioEval`)이 구조적으로 같은 규약이라 입금일에 자동 정합된다.
- **⚠️ `effectivePrincipal`의 일별 차분을 흐름으로 쓰지 말 것(폐기된 설계)**: 그 값은 '원가 표시용'이라
  `Math.max(0,...)` 클램프·`startDate` 게이트·`noPrincipal` 미필터가 섞여 있어, 차분을 흐름으로 삼으면
  ① 출금 1건이 **몇 달 전 일간 수익률을 소급 변경**하고 ② 계좌 삭제일에 누적 미실현손익이 통째로 하루
  수익이 되어 **부호까지 뒤집힌다**(−3.01% → +4.52%). `effectivePrincipal`(`useIntegratedData`)은
  투자원금 열·차트 costAmount 전용으로 **현행 유지**하고, 흐름은 반드시 아래 3원 소스로 별도 산출한다.
- **흐름 3원 소스**(`useIntegratedData` `computedIntHistory` 내부, ③→①→①-b→②→이월 순):
  ③ **계좌 편입/이탈** — 원장에 없는 흐름. 편입일 `+평가액 전액`(원금 아님), `cutoffOf` 경계일 `−평가액 전액`.
  편입일(`firstSeenById`) 이하의 원장은 ①에서 제외해 이중계상을 막는다.
  ① **시장 계좌 입출금 원장** — 입금은 `noPrincipal`(배당·이자) 제외, **출금은 `noPrincipal`이어도 전액**
  (현금이 실제로 나감 — 이 비대칭이 정상). `firstSeenById`에 없는 계좌는 통째로 제외(V에 기여 안 함).
  ①-c **계좌 간 이관 쌍은 상쇄**(⚠️ 되돌리지 말 것) — 이관은 '원계좌 출금 M + 대상계좌 입금 M' 원장 쌍이라
  **순액은 0인데 총유입(IN)·총유출(OUT)이 각각 M만큼 부푼다**. 분모가 `V_prev + IN`, 분자가 `V + OUT`이라
  그날 %가 `(V+M)/(V_prev+M)−1`로 통째로 희석된다(실측 2026-08 통합 월간 **+2.12% → +1.90%**).
  `holdTransfer`가 `row.transfer.role`(`'in'`/`'out'`)을 `xferPend`에 모으고, ① 루프가 끝난 뒤
  **양쪽이 다 모였고 날짜가 같을 때만** 쌍을 제거한다. **순액이 0이라 `dodAbsChange`(=ΔV−순흐름)와
  보류 판정(`shouldHoldDailyMetrics`는 `fIn−fOut`만 본다)은 1원도 안 바뀌고 오직 %만 정확해진다.**
  ⚠️ 한쪽이 TEST·삭제·기록 0건이면 통합 자산이 **실제로** 드나든 것이므로 상쇄 금지(못 맞춘 쌍 = 옛 동작).
  ⚠️ 날짜가 갈리면(계좌 타입이 달라 기록 확정일이 다른 21:00 이후 이관) 상쇄 금지 — 원계좌 출금일에 M이
  통째로 가짜 손실이 된다. ⚠️ 같은 역할 2건(손상 데이터)이면 상쇄를 포기하되 **흐름을 버리지는 않는다**.
  ⚠️ **반드시 `flowAtRow`(기록 없는 날의 흐름 이월) 구성보다 앞**에서 끝낼 것.
  ⚠️ **③ 계좌 편입/이탈은 상쇄 대상이 아니다** — 그건 통합 자산의 실제 증감이라, 빼면 편입일 평가액
  전액이 가짜 수익·삭제일 평가액 전액이 가짜 손실이 된다.
  ⚠️ **개별 계좌 뷰(`externalFlowInRange`)는 무변경** — 그 계좌 기준으로는 자산이 실제로 나갔다.
  ①-b **평가 시계열이 없는 계좌**(기록 0건) — today 행이 `intTotals.totalEval`로 덮어써져 오늘 V에는
  100% 포함되므로, `portfolioSummaries.currentEval`을 today 편입 흐름으로 계상(유령 수익 방지).
  ② **현금성 계좌(마통·simple) 잔액 Δ** — 원장 편집 UI가 **구조적으로 존재하지 않으므로**(`usePortfolioState`가
  현금성 계좌의 개별 뷰 진입을 차단) `cashByDate` 차분이 유일한 소스. ΔV와 같은 값이라 r=0 유지.
- **⚠️ `Math.abs()` 금지**: `DepositPanel`은 음수 '정정 행'을 빨간 글씨로 명시 지원한다. abs를 씌우면
  마이너스 입금이 유입으로 뒤집혀 **오차가 원장 금액의 2배**가 된다(정정 쌍이 상쇄 대신 이중 계상).
  코드베이스의 다른 모든 원장 소비자(`cumDepositsUpTo`·`portfolioPrincipalData`·`intDepositEvents`·
  `depositWithSum`)가 부호 있는 합을 쓴다 — 부호별로 IN/OUT에 라우팅할 것.
- **⚠️ 일간 지표는 `utils.ts` `computeDailyMetricsSeries` **단 하나**를 통합·개별 계좌·CSV 3곳이 공유**한다.
  행별 독립 계산으로 되돌리지 말 것 — 아래 '보류+이월'이 시계열 상태를 갖기 때문에, 한 곳만 누락하면
  같은 날짜에 통합 +1.59% vs 개별 +9.10%로 두 화면이 정면 모순되고 원래 버그가 그 화면에 그대로 살아남는다.
  입력은 `[{date, evalAmount, flowIn, flowOut, ledger?, flowSuspect?}]` **날짜 오름차순**, 출력은
  `Map<date, {dodAbsChange, dodChange, ledgerFlow, held}>`. 소비자는 조회만 한다.
- **보류(hold) 판정 = 'V가 그 흐름을 담고 있다고 볼 수 있는가'**(`shouldHoldDailyMetrics`), 순서 중요:
  ① `흐름 === 0` → 판정 불필요(false) ② **`ΔV === 0` → 무조건 보류** (비거래일 carry-forward 행은 시장
  정보가 0이라 어떤 크기의 흐름도 반영될 수 없다 — 주 경로) ③ `|흐름| <= 전일V × 1%` → 소액이라 대상 아님
  ④ **부호를 보는 흡수 판정**: `흐름>0 ? 흡수량 < 흐름×0.5 : 흡수량 > 흐름×0.5` 면 보류.
  **흡수량 = `bookDelta ?? ΔV`** — 아래 '장부액 관측' 참조. ΔV는 시세에 오염된 추측이고 `bookDelta`는 관측이다.
  ⚠️ **되돌리지 말아야 할 오답 4종**: (a) `|ΔV| < |흐름|×5%` — 창이 ±0.37%뿐이라 시장이 조금만 움직여도
  보류가 풀려 `−흐름` 전액이 가짜 대손실(₩46M). (b) `|ΔV−흐름| > 전일V×5%` — 흐름이 **이미 반영된 날**에도
  '손익이 크면' 보류해(crypto +10%일) 다음 날 한 번 더 차감했고, 전일V 5% 미만 미반영 흐름은 놓쳤다.
  (c) **②를 ③ 뒤에 두는 것** — 전일V의 1% 이하 입금(월 적립식)이 주말 원장에서 통째로 새어 나간다.
  (d) **④를 `Math.abs(ΔV)`로 쓰는 것** — 흐름과 반대 방향 시장 변동을 '흡수 증거'로 오인해(입금일 하락,
  출금일 상승) 보류가 풀리고 흐름 전액이 손익이 된다(미반영 출금 + 상승 시 **+11.9%**까지 나왔다).
- **장부액 관측(`bookDelta`) — 흡수 판정의 1순위 근거 (⚠️ 제거하지 말 것)**: `bookCostOf` =
  `Σ(예수금 depositAmount + 매입원가 investAmount)`. **시세로는 변하지 않고 외부 입출금으로만 변하므로**
  "원장 흐름이 그날 평가액에 반영됐는가"를 추측이 아니라 관측으로 답한다.
  ⚠️ **주식(gold 포함) 원가는 `investAmount`가 아니라 `purchasePrice × quantity`** — 그 필드는
  `handleAddStock`이 0으로 만든 뒤 갱신되지 않는다(화면은 매번 계산). `investAmount`만 읽으면
  "입금 후 같은 날 매수"에서 bookDelta가 0이 되어 정상 입금을 '미반영'으로 오판한다.
  `investAmount`가 권위인 것은 **fund·savings뿐**. 스냅샷이 purchasePrice·quantity를 보존하므로
  과거 날짜도 산출된다(단 `snapshotCompositionKey`에 purchasePrice가 없어 **매입단가만 고친 편집은
  새 스냅샷을 만들지 않는다** — 외부 흐름이 아니므로 무해하나, 정정과 입금이 겹치면 오차 여지).
  `buildBookCostSeries(p, dates)`(날짜별 Map, `resolveHoldings().estimated`면 그 날짜 제외) +
  `bookDeltaBetween(map, prevDate, date)`(한쪽이라도 없으면 null) — 둘 다 `utils.ts`.
  **공급자 = 활성 계좌 단일 Map(`App.tsx` `activeBookByDate`)을 3소비자가 공유** — `accountTwrByDate`
  (차트 조회시작 0% 라인)·`HistoryPanel`(prop)·`handleDownloadCSV`. ⚠️ **`accountTwrByDate`를 빠뜨리지
  말 것** — TWR은 곱셈 체인이라 하루의 판정 차이가 이후 전 구간에 영구 고정되고, 같은 날짜에
  표 −2.00% vs 차트 +0.01%로 갈린다. 통합은 별도로 `useIntegratedData` `marketSeries.bookMap` →
  `computedIntHistory.bookTotal` → `intMonthlyHistory`.
  ⚠️ **미제공(null)이면 기존 ΔV 휴리스틱으로 폴백**해 동작이 100% 동일하다(하위호환 — 검증 #29d).
  통합은 한 계좌라도 그날 장부를 못 내면 그날 합계를 통째로 무효(`bookInvalid`)로 둔다 — 일부만 더한
  합계는 흐름과 비교할 수 없다. 현금성 계좌는 평가액=잔액=장부액이라 `cashByDate`를 그대로 더한다.
  - **⚠️ 해외계좌 장부 = 통합은 공급(원화 환산) / 개별은 미공급 — 절대 통일하지 말 것**:
    `buildBookCostSeries(p, dates, opts?)`의 `opts.rateOf`가 환산율이다. **통합**
    (`useIntegratedData` `marketSeries`)은 평가액도 흐름(`rateOf`)도 이미 원화 환산이므로 장부도
    원화로 환산해 **반드시 공급**한다.
    ⚠️ **되돌리지 말 것(2026-07-28 실측 버그)**: 통합에서 해외를 `bookMap = null`로 두면 `bookInvalid`가
    **해외계좌 첫 기록일 이후 모든 날짜**를 삼켜 통합 일간 지표가 **영구히 ΔV 추측 폴백**이 된다. 그러면
    ₩40,000,000 입금일(ΔV −₩11,418,780)이 '미반영'으로 오탐 보류되고 이월까지 겹쳐 **2행 연속 `'-'`**
    로 잠기는데, 같은 날 개별 계좌 추이(AI −11.90% / COVERD −7.57%)는 장부 관측으로 정상 산출돼
    **두 화면이 정면 모순**된다. 검증 #30(+ 소스 텍스트 가드 #30d).
  - **⚠️ 해외 장부 환산은 '날짜별'이 아니라 '단일 상수' 환율 — 되돌리지 말 것**: `bookTotal`은
    어디서도 레벨로 소비되지 않고 오직 전일 대비 **차분**으로만 쓰인다(`intTwrCumByDate`·
    `intMonthlyHistory`). 날짜별 환율을 쓰면
    `bookDelta = Δ장부(USD)×fx(d) + 장부(전일,USD)×Δfx` 가 되어 뒤 항, 즉 **외부 흐름이 아닌 환율
    재평가분**이 섞이고 "장부액은 시세로 변하지 않고 외부 입출금으로만 변한다"는 이 관측의 근본 전제가
    깨진다. 뒤집힘 경계는 **`|Δfx/fx| ≥ 0.005 × 총자산 / 해외장부`** — 해외 비중 8.9%면 하루 5.7%가
    필요해 안전하지만 **비중 50%면 하루 1%, 100%면 0.5%로 충분**하다(양방향 모두 발생: 미반영 흐름이
    '흡수됨'으로 오판되거나, 반영된 흐름이 보류로 잠긴다). 상수 배율이면 그 항이 정확히 0이고,
    흐름(날짜별 환율)과의 배율 차이는 기껏해야 수 %라 흡수 문턱 50%에 못 미친다. 검증 #30c.
  - **⚠️ 개별 계좌 해외 미공급의 이유는 '단위'가 아니라 '단일 Map 공유 제약'**(주석을 단위 문제로
    되돌리지 말 것): `App.tsx activeBookByDate` 하나를 세 소비자가 나눠 쓰는데 프레임이 서로 다르다 —
    `accountTwrByDate`=USD(`overseasUsdEvalAt` + 무환산 `externalFlowInRange`), `HistoryPanel`=**원화**
    (`ov.krw` + 날짜별 환율 `flowRate`), CSV=저장 evalAmount 폴백. 한 프레임으로 셋을 동시에 만족시킬 수
    없어 해외는 미공급이다. **`HistoryPanel`이 원화라고 그쪽에만 원화 장부를 주지 말 것** — 같은 Map을
    쓰는 `accountTwrByDate`(USD)와 판정이 갈려 표와 차트가 어긋나고, TWR은 곱셈 체인이라 영구 고정된다.
  - **⚠️ 해외는 `rateOf`와 `costBasisOnly`를 반드시 함께 넘긴다**: `bookCostOf`는 기본적으로
    `investAmount`를 우선하는데, **해외 항목의 `investAmount`는 어떤 UI도 쓰지 않는 잔존 필드**다
    (해외 투자금액 칸의 저장 필드는 별도 `investAmountUsd` — 전용 섹션 참조. `usePortfolioData`
    :41·:128과 통합 종목별 비중도 전부 `investAmount`를 우회). 레거시·`PasteModal` 임포트
    데이터에 **원화** `investAmount`가 남아 있으면 거기에 환율(≈1,390배)이 곱해져 장부 단위가
    3자릿수 규모로 오염되고 흡수 판정이 통째로 무너진다 → `costBasisOnly:true`로 매입가×수량(USD)만
    쓴다. `fund`·`savings`는 매입가×수량 개념이 없어 `investAmount`가 권위이므로 예외. 검증 #30b.
    ⚠️ **"이제 해외도 투자금액을 저장하니 이 옵션은 불필요"는 오답** — 새 저장 필드는
    `investAmountUsd`라 `bookCostOf`가 읽지 않고, 원화 잔존값 위험은 그대로다(`verify:overseas` #25).
  - **⚠️ 통합에서는 ACTIVE 자가치유(2행)가 꺼진다 — 의도된 맞바꿈**: `computeDailyMetricsSeries`의
    폐기 조건이 `bookDelta == null && activeRows >= 2`라, 통합이 관측 모드로 바뀌면 `CARRY_MAX_ROWS`
    (15행)만 남는다. 관측이 있으면 '미반영'이 확정 사실이라 폐기가 곧 가짜 손익이므로 이것이 목적이다
    (위 'ACTIVE 폐기는 `bookDelta == null`일 때만' 항목과 동일 근거). 다만 통합 `bookTotal`은 전 계좌
    합이라 **한 계좌의 장부 이상이 포트폴리오 전체 판정을 오염**시킬 수 있다(개별 뷰엔 없는 결합).
  - **알려진 한계 3종(전부 개별에도 있던 기존 노출, 통합은 계좌 수만큼 확률↑ — 산식을 건드리지 말 것)**:
    ① **게이트 비대칭**(비해외 계좌): `buildCloseEvalSeries`는 `allExact && !estimated`를 요구해 미충족 시
    직전값을 이월하는데 `buildBookCostSeries`는 `!estimated`만 본다(종가 불필요). 신규 매수 종목의 그날
    종가가 아직 없으면 **V는 전일 이월인데 장부만 +흐름**이 되어 흡수를 거짓 입증한다. 게이트를 통합에만
    좁히면 개별과 규칙이 갈려 이 버그의 원인(비대칭)을 되풀이하므로 **대칭 유지**를 택했다(오늘 행은
    스냅샷 장부 vs 라이브 V라 좁히면 오히려 당일 입금이 상시 보류된다). 해외 분기는 `buildCloseEvalSeries`
    를 쓰지 않고 `calcPortfolioEvalDetail`의 `hasAnyPrice` 폴백을 쓰므로 게이트 자체가 더 느슨하다.
    ② **추정 날짜는 '미제공'이 아니라 '낡은 장부 이월'로 흐른다**: `resolveHoldings().estimated`인 날짜는
    `buildBookCostSeries`가 건너뛰는데, 집계 루프의 `lastBook` 캐리 때문에 `lastBook != null`이 유지돼
    `bookInvalid`가 서지 않는다 → 그날 흐름이 있어도 bookDelta=0이라는 **관측처럼 보이는 오답**이 난다.
    ③ **계좌 편입/이탈·기록 0건 계좌**: 편입/삭제 경계 흐름은 **평가액 전액**인데 장부는 **원가**만
    움직여, 미실현이익이 원가의 100%를 넘는 계좌의 경계일에 오탐 보류가 난다. 기록 0건 계좌의
    `currentEval`(①-b)은 today 유입으로만 잡히고 장부엔 기여하지 않아 신규 계좌 추가 당일 헤더
    '오늘 수익'이 `'-'`로 잠길 수 있다.
  ⚠️ **`ΔV === 0`(비거래일) 규칙에는 `bookDelta`가 있어도 예외를 두지 말 것** — 장부가 바뀌었어도
  평가 시계열이 직전값 이월이면 그 흐름은 실제로 V에 없다.
  **고친 결함 2종(회귀 시 재발)**: (A) 계좌의 2%를 인출한 날 시장이 +1.5%면 ΔV로는 '미반영'으로 오탐돼
  `'-'`로 은폐되고, 그 이월이 **다음 날 한 번 더 차감돼 부호가 뒤집혔다**(시장 −2%인데 +₩10,000 이익 표시).
  (B) 출금 원장일과 예수금 수정일이 어긋난 구간에서 ACTIVE 폐기가 흐름을 소각해 **반영일에 출금액 전액이
  가짜 손실**로 찍혔다. `DepositPanel`은 `portfolio`를 참조하지 않으므로(참조 0건) 원장 입력만으로는
  평가액이 변하지 않는다 — 날짜가 어긋나는 것이 **구조적 정상**이다.
- **⚠️ ACTIVE 폐기는 `bookDelta == null`일 때만**: 관측이 있으면 '미반영'이 확정 사실이므로 폐기하면
  흐름 전액이 가짜 손익이 된다(위 (B)). FROZEN 상한(`CARRY_MAX_ROWS`)은 관측이 있어도 그대로 적용해
  무한 이월을 막는다.
- **⚠️ 보류된 행의 흐름은 반드시 다음 행으로 이월**: 소각하면 다음 기록일 ΔV에 입금액이 그대로 남아
  **원래 버그가 하루 밀려 재발한다**(토 '-' → 월 +9.10%).
  **첫 행은 이월 금지**(그 흐름은 ③ 계좌 편입 평가액이라 이미 V에 반영됨 → 이월 시 둘째 행이 가짜 손실).
  `flowSuspect`(오늘 라이브 이상치)는 항상 마지막 행이라 이월 대상 아님.
  주말 행은 `fillNonTradingGaps`·`useHistoryBackfill` 치유로 **항상 존재**하고 `buildCloseEvalSeries`가
  직전 정확값을 이월하므로 이 경로는 드문 예외가 아니라 상시 발생한다.
- **이월 상한 2종(⚠️ 줄이지 말 것)**: `CARRY_MAX_ROWS=15`는 KR 최장 연휴(실측 최장 6일)를 덮는 값
  (5였을 때 2026 설 연휴에서 흐름이 소각돼 입금액 전액이 가짜 수익으로 부활했다).
  `CARRY_MAX_ACTIVE_ROWS=2`는 **거래일 보류**에만 적용되는 짧은 상한 — 흐름과 시장 변동이 비슷한 크기로
  상쇄되면 '미반영'과 형태가 같아 **오탐 보류가 원리적으로 불가피**한데, 이월을 오래 들고 가면 이미 반영된
  흐름이 계속 차감돼 부호가 뒤집힌 값이 몇 주간 표시된다.
- **⚠️ 폐기는 '여전히 보류일 때'만 — 루프 진입부 무조건 폐기로 되돌리지 말 것**: 이월을 실은 채 먼저
  판정하고(1차), 그래도 `held`이면서 상한을 넘겼을 때만 폐기 후 자기 흐름으로 재산출한다(2차).
  진입부에서 무조건 폐기하면 **흐름을 흡수하는 바로 그 행**에서 이월이 버려져 입금액 전액이 하루 수익으로
  찍힌다(고치려던 +9.10% 버그 재현).
- **⚠️ ACTIVE 카운트는 `dV !== 0`이 아니라 `|ΔV| > |흐름| × 5%`**: crypto(24시간 시장)·예적금(일 단위
  단리)을 보유하면 **비거래일에도 총자산이 몇십만 원씩 움직인다**. 1원만 움직여도 ACTIVE로 세면 주말 2행
  만으로 예산이 소진돼 월요일에 이월이 폐기되고 원래 버그가 재현된다.
- **보류 행 표시 규약(4곳 통일)**: `dodAbsChange=null` + `%`도 `'-'`. `0.00%`로 단언하면 '변동 없음'과
  구분되지 않는다. 통합 추이표·`HistoryPanel`·**헤더 '오늘 수익' 카드**(⚠️ `?? 0`으로 삼키지 말 것)는 `'-'`,
  메모 달력은 줄 자체를 숨김. 헤더는 보류 시 원본 `ledgerFlow`로 "입금 ₩N 반영 대기"를 안내한다.
- **적용 지점**: `useIntegratedData` `intMonthlyHistory`(통합 단일 소스) → 통합 추이표·**헤더 '오늘 수익' 카드**
  (⚠️ 과거엔 raw `intHistory`로 **자체 계산**했다 — 되돌리면 헤더 +9.10% vs 표 +1.59%로 갈라지고 '달력 오늘 칸
  = 헤더 카드 일치' 불변식이 깨진다)·메모 달력(무수정 자동 반영, `dodAbsChange` **null 계약** 준수 필수).
  개별 계좌는 `HistoryPanel`의 `dailyMetricsByDate` memo + `utils.ts` `externalFlowInRange`(반개구간
  `(직전 기록일, 당일]` — 직전 '거래일'이 아니라 '기록일'이다). 소비처는 `HistoryPanel` 3열 셀·툴팁.
  (⚠️ CSV는 이 memo가 아니라 `computeDailyMetricsSeries`를 **직접 호출**한다 — 화면과 CSV가 같은 값을
  내려면 아래 인자를 화면과 동일하게 넘겨야 한다는 뜻이지, memo를 공유한다는 뜻이 아니다.) CSV는
  `buildHistoryCSV(history, deps, wds, rateOf, evalByDate)` — ⚠️ **평가액 소스(`activeCloseEvalByDate`)와
  날짜별 환율까지 화면과 같이 넘겨야** 보류 판정 자체가 갈리지 않는다.
  **알려진 한계**: `activeCloseEvalByDate`는 해외·현금성 계좌에서 빈 Map이라 그 계좌들의 CSV는 저장
  `evalAmount`로 폴백한다. 해외는 화면이 날짜별 환율로 재계산하므로 CSV와 평가자산·일간 손익이 어긋난다
  (기존 동작 유지 — 해소하려면 `HistoryPanel`의 해외 재계산을 `App.tsx`로 승격해야 한다).
- **⚠️ 해외 흐름 환산은 날짜별 환율(`getClosestValue(indicatorHistoryMap.usdkrw, d.date)`) 우선**, 원장의
  `d.fxRate`는 폴백. `d.fxRate`는 '행 생성 시점' 환율로 박제되므로 소급 입력 시 V(날짜별 환율 재계산)와
  어긋나 그날 환율차만큼 가짜 손익이 남는다. 통합·개별·CSV **3곳 모두** 같은 식을 써야 한다.
- **⚠️ 관리자 포털(`AdminPortal`)은 손대지 말 것** — `recomputePortfolioEval`이 같은 보유 스냅샷을 두 가격
  벡터로 평가해 흐름이 대수적으로 소거되므로 **이미 구조적으로 면역**이다. 저장 history 비교로 되돌리는 것도 금지.
- **영속화 무관**: `netFlow`/`ledgerFlow`/`flowSuspect`/일간 지표는 전부 매 렌더 파생값이다.
  `portfolioStructureKey`·`applyStateData`·`applyBackupData`·저장 effect deps **전 지점 무수정**.
  ⚠️ **일간 수익률이나 netFlow를 `p.history` 레코드에 저장 금지** — '날짜당 1건' 불변식·백필 실시간 보호 가드·
  `historyVerifyKey`·`dedupeHistoryByDate`와 전부 충돌한다.
- **누적 TWR 곡선(`Π(1+r)−1`)은 개별 계좌 + 통합 대시보드 차트에 도입 완료** — 아래 전용 섹션 참조.
  이 `dodChange`가 그 곡선의 유일한 원자재다(개별=`accountTwrByDate`, 통합=`intTwrCumByDate`가
  `computeCumulativeTwrSeries`로 소비). **범위 밖(의도)**: CAGR·XIRR은 여전히 **미적용**.
  '원금대비'(`monthlyChange`)는 누적 지표로 **현행 유지**(입금일 희석은 정의상 정상).
- 검증: `npm run verify:twr` (명세 테스트 #1~#5 + 엣지 #6~#16 + 회귀 #17~#21c + 장부액 관측 #29~#29d
  + 통합 장부 집계·해외 단위·상수환율 #30~#30c + **소스 텍스트 가드 #30d**).
  ⚠️ #1~#30c는 전부 **참조 구현 미러**라 함수 본문 회귀만 잡는다. 이번에 깨졌던 것처럼 **호출부 인자**
  (통합이 해외에 bookMap을 주는가·상수 배율인가)는 미러로 표현할 수 없어, `#30d`가 `readFileSync`로
  `useIntegratedData.ts`/`utils.ts`를 직접 읽어 그 계약을 단언한다(`verify-market-calendar.mjs` 선례).
  포맷 변경에 취약하므로 실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.
  `scripts/verify-twr.mjs`의 참조 구현은 `utils.ts`의 `externalFlowInRange`·`dailyFlowAdjustedRate`·
  `shouldHoldDailyMetrics`(bookDelta 인자 포함)·`computeDailyMetricsSeries`·**`bookCostOf`**(#30b) 본문,
  그리고 **`useIntegratedData`의 장부 합산 루프**(`lastVal`/`lastBook`/`sawAny`/`bookInvalid` — #30의
  `aggregateIntBook`)와 **항상 1:1로 동기화**할 것.
  ⚠️ #29c의 시장 등락(+1,100,000)은 `ACTIVE_DRIFT_RATIO`(흐름의 5% = 50만)를 넘겨 폐기를 실제로
  발동시키려는 값이다 — 줄이면 옛 코드에서도 통과해 회귀를 못 잡는다.

### 평가액 추이 표 기간 단위(일간/주간/월간/연간) (⚠️ 회귀 주의)

통합 대시보드 '평가액 추이'(`IntegratedDashboard`)와 개별 계좌 '자산 평가액 추이'(`HistoryPanel`)의
행을 주(월~일)·월·연 단위로 접는 토글. 대표 시점은 **그 기간의 마지막 실제 기록 행**(사용자 확정),
클릭은 대표 날짜로 기존 팝업/모달을 연다, 열 제목은 모드에 맞춰 바뀐다.

- **⚠️ 1급 계약 — 기간 값은 '일별 지표의 누적 차분'이다. 압축한 행을
  `computeDailyMetricsSeries`에 **재투입하지 말 것**.**
  `기간 손익 = cumProfit(대표일) − cumProfit(직전 대표일)` / `기간 수익률 = rebaseTwr(twr(대표일), twr(직전 대표일))`.
  그 함수의 상수(`MATERIAL_FLOW_RATIO` 1% · `ABSORBED_RATIO` 0.5 · `CARRY_MAX_ROWS` 15 ·
  `CARRY_MAX_ACTIVE_ROWS` 2)와 `bookDelta` 관측은 전부 **'하루치 흐름 vs 하루치 ΔV'** 스케일 가정
  위에 서 있는데, 기간 합산은 흐름·ΔV·장부 드리프트를 **서로 다른 속도로** 키워 그 가정을 동시에
  무너뜨린다(설계 검증 실측 4종): ① 분배금이 예수금에 쌓여 `bookDelta`가 흐름과 **반대 부호**가 되면
  흡수 판정이 실패하고, `bookDelta == null && activeRows >= 2`라 **`bookDelta`가 있으면 ACTIVE 폐기
  게이트가 봉인**돼 held가 자기강화한다(연간 표 전부 `'-'`). ② 이월이 `'-'`가 아니라 **그럴듯한 틀린
  숫자**를 만든다(실측 +₩9,000만 표시 vs 실제 +₩1억 5천만). ③ 월 적립 0.71%(일간에서는 1% 면제로
  **구조적 면역**)가 연 합계 8.6%가 되어 판정 대상으로 승격 — 일간에 원리적으로 없던 보류 경로가 생긴다.
  ④ Dietz의 BOD 가중이 기간에서 왜곡돼 같은 행의 %와 ₩이 **최대 2배** 어긋난다(손익 ₩1,000만인데 +5.00%).
  누적 차분은 흡수 판정 입력이 **항상 하루치**라 넷을 동시에 없애고, 부수 효과로 기간 %가 **수익률 차트
  라인·드래그 구간 수익률과 같은 규약**이 된다.
- **⚠️ '그 기간 전체가 보류'는 `0.00%`가 아니라 `'-'`다.** held 행은 누적을 갱신하지 않으므로 경계
  차분이 **정확히 0**이 되어 '변동 없음'과 구분되지 않는다 → `accumulateDailySeries`가 함께 내는
  **기여일 카운트**(`count` / 훅은 `okCount`) 차분이 0이면 보류로 본다. 같은 순간 헤더 '오늘 수익'
  카드는 `'-'`를 띄우므로, 이 게이트가 없으면 두 화면이 정면 모순한다(보류 표시 규약 4곳 통일).
  카운트 미제공이면 조건이 자동으로 꺼져 종전 동작(하위호환 fail-safe).
- **⚠️ `intMonthlyHistory`는 일별 그대로 둔다** — 표 말고도 3소비자가 공유한다(헤더 '오늘 수익' 카드
  `[0]` · 팝업 `realtimeDate` · 메모 달력 `metricsHistory` 날짜 키 맵). 제자리 압축하면 달력이 주/월당
  한 칸만 스냅샷을 그리고(그 블록이 ASSET 패드의 **유일한 진입점**) `realtimeDate`가 오늘이 아니게 돼
  팝업 소계가 라이브 대신 carry-forward가 된다 → "달력 칸 총자산 = 팝업 소계 = 차트 그날 값" 붕괴.
  압축은 **표 전용 파생 memo**(`histRows` / `viewRows`)에만 존재한다.
- **⚠️ 화이트리스트 fail-safe** — `compressPeriodRows`는 `week|month|year`가 **아니면 입력 배열을
  그대로(참조 동일) 반환**한다. `'day'만 항등`으로 두면 prop 누락·손상 Drive 값·payload 미전달이
  전부 **조용한 1행 붕괴**가 된다. 참조가 같으므로 일간 모드 하위호환이 논증이 아니라 **구조**로 보장된다.
  데이터 경로와 **프레젠테이션 플래그**(`isHistPeriodMode`/`isPeriodMode`)가 같은 화이트리스트를 써야
  "행은 일별인데 화면은 기간 모드"가 안 생긴다.
- **⚠️ 대표는 '실제로 존재하는 마지막 기록 행'** — 달력상 말일 같은 **합성 날짜를 만들지 말 것**.
  없는 날짜를 대표로 쓰면 `buildCloseEvalSeries`·`bookByDate`·`overseasEvalByDate` 조회가 전부 miss돼
  저장 라이브 `evalAmount`로 조용히 폴백하고 "시장 계좌 평가액은 항상 수량×종가"가 그 뷰에서만 깨진다.
  기록 0건 기간은 **행을 만들지 않는다**(그 흐름은 다음 대표일의 반개구간에 이미 포함).
- **⚠️ '오늘' 하이라이트는 인덱스 판정 + `latestRecDate`**(달력상 오늘 아님). 기간 모드는 내림차순 0번,
  일간 모드는 `intMonthlyHistory[0].date`. `getTodayKST()`로 재면 행 날짜의 출처(`getEffectiveDate()`)와
  어긋나 **KST 00:00~07:30에 어느 행도 안 칠해진다**(옛 UTC 비교는 그 구간에서 오히려 맞았다 — 메모 달력
  절의 `latestRecDate` 규약과 같은 함정). 개별은 `effectiveDateKey`가 KR 계좌에서 21~09시 **null**이라
  기간 모드에서 반드시 인덱스로 판정한다.
- **⚠️ 감사(audit) 신호는 범위 OR, 신뢰도 신호는 대표값 승계** — 묻는 질문이 다르다.
  일자 색상(`periodModifiedCount`)·'조정됨' 배지(`periodAdjustedCount`)는 *"이 기간 안에 사람 손이
  닿았나"*라 **OR 집계**(대표일만 보면 그 기간의 수동 개입이 화면에서 사라지는 **거짓 음성**).
  `flowSuspect`는 *"지금 이 값이 신뢰 가능한가"*라 **대표값 승계**(OR로 모으면 과거 이상치가 기간을 오염).
  ⚠️ '조정됨'은 `isAdjusted` **단독** 집계 — `userModifiedDates`(수량·종가 편집)까지 섞으면 조정한 적
  없는 기간에 배지가 뜬다.
- **⚠️ 전체 이력을 유지해야 하는 것**: `displayEvalByDate`·`overseasEvalByDate`·`cumulativeByDate`·
  `dailyMetricsByDate`는 **일별 그대로** 두고 대표 날짜로 **조회만** 한다. 특히 `cumulativeByDate`의
  `asc` 인자를 압축본으로 바꾸면 `computeEffectivePrincipal`의 `principalManual` 앵커와
  `resolveRecordPrincipal`의 '직전 기록 principal' 역스캔이 드롭된 날짜를 못 봐 **차트와 표의 누적
  수익률이 갈린다**.
- **⚠️ 흐름 합산은 부호 있는 합**(`Math.abs` 금지 — 음수 정정 행이 유입으로 뒤집히면 오차가 2배)이고
  **커서는 루프 밖**(안에 두면 O(기간수 × 전체행수) — 주간 3년치 회당 ~17만 회가 시세 갱신마다 돈다).
  압축 행의 `netFlowIn/Out`·`ledgerFlow`·`netFlow`를 **명시적으로 덮어쓸 것** — 안 그러면 대표일
  하루치 스칼라가 남아 나중에 붙는 진단 문구가 기간 합이 아니라 하루치를 표시한다.
  개별 계좌는 `externalFlowInRange`가 반개구간 `(from, to]`이라 **인접 대표일 쌍이 곧 기간 합**이다(합산 코드 0줄).
- **⚠️ 압축 입력에서 `date` 없는 행을 먼저 거를 것** — `compressPeriodRows`는 거르는데 커서 루프가
  `asc[ai].date`를 비교하므로 `undefined`가 섞이면 커서가 **영구 정지**해 그 이후 모든 기간의 표시가
  조용히 사라진다.
- **⚠️ 해외계좌는 '차트와 같은 기준'이 아니다** — 개별 표는 **원화 프레임**(`ov.krw` + 날짜별 환율),
  차트 `accountTwrByDate`는 **USD 프레임**(`overseasUsdEvalAt` + 무환산 흐름)이라 구조적으로 다르다.
  툴팁·도움말에서 그 단언을 **해외에서만 끈다**(KRW 계좌 테스트로는 절대 드러나지 않는다).
  통합은 `intTwrCumByDate.twr`을 차트와 **공유**하므로 단언이 참이다.
- **⚠️ 문구는 `periodNoun` 공유 포매터로만** — 모드별로 거짓이 되는 문장을 화면마다 따로 들고 있으면
  한 곳만 고쳐지고 나머지가 계속 거짓말을 한다. 분기 대상에 **셀 툴팁**(월간 값에 '일간 손익'이라 쓰고
  '(당일−전일)÷전일과 동일'이라 단언하면 둘 다 거짓 — 기간 값은 일별 배율의 **곱**)과 **도움말의
  '옆 칸'·'일자 색상'·'조정됨' 블록**을 반드시 포함할 것(그 셋은 '일간 지표'가 아니라 다른 블록에 있어
  누락되기 쉽다). ⚠️ 도움말은 **평문 렌더**(마크다운 파서 없음) — `**`를 쓰면 화면에 그대로 보인다.
- **UI 배치가 두 카드에서 다르다(같게 만들지 말 것)**: 통합은 카드 헤더(`xl:w-[490px]`라 여유),
  개별은 **thead 위 얇은 바**(카드가 `xl:w-[21%]`≈252px, 헤더 가용 220px인데 제목+?+확장이 이미 190px).
  헤더에 넣으면 제목이 한글 글자 단위로 줄바꿈되고 고정 높이 + `overflow-hidden`이라 **표 행이 사라진다**.
  헤더를 안 건드리면 `verify:card-window #G14g`(`CardExpandButton` 한 줄 문자 일치)도 구조적으로 안전하다.
  ⚠️ 바(32px)를 넣었으므로 카드 높이를 `360→392`/`520→552`로 올리고 **형제 카드**(`PortfolioStatsPanel`
  1곳·`DepositPanel` 2곳)도 **함께** 올린다 — 각 카드가 명시적 height라 `items-stretch`가 먹지 않아
  한쪽만 올리면 같은 행의 바닥이 32px 어긋난다.
- **영속화(통합)**: `chartPrefs.intHistPeriod` — App.tsx 5지점(state 리터럴·`chartPrefsUpdatedAt` deps·
  STATE 저장 deps·`applyStateData`·`applyBackupData`) 전부. ⚠️ ②와 ③은 **둘 다** 필요(②만 → 저장 미예약 /
  ③만 → `chartPrefsUpdatedAt` 미상승으로 STATE write 스킵). 로드 2경로는 `normalizeHistPeriod`를
  통과시킬 것. 수동 저장 4핸들러는 `{...saveStateRef.current}` 스프레드라 무수정.
- **영속화(개별) = 계좌별**(⚠️ 회귀 주의 — '계좌 공통'으로 되돌리지 말 것, 사용자 요청 2026-08):
  `currentChartStateRef.histPeriod` → `chartPrefs.accountChartStates[pid].histPeriod`.
  **'차트 토글은 계좌별로 독립' 절의 4지점 규약을 그대로 따른다** — ① ref 기본값 리터럴(`histPeriod: 'day'`)
  ② 동기화 effect 객체 + **deps(`acctHistPeriod`)** ③ 계좌 전환 `saved` 복원(`normalizeHistPeriod(saved.histPeriod)`
  — 필드 없는 옛 저장본은 `'day'`) ④ 처음 방문 기본값 `'day'`(사용자 확정 — 직전 계좌를 물려받지 않는다).
  ⚠️ **부팅 복원(`applyStateData`)은 계좌별 값이 앱 레벨 값을 이겨야 한다.** `accountChartStates` 블록이
  `acctHistPeriod` 복원보다 **위**에 있어서, `showTotalEval`처럼 그 블록에 넣으면 아래 앱 레벨 줄이
  덮어쓴다(순서가 반대라 같은 자리에 둘 수 없다) → `acctHistPeriod` 줄 자리에서 `_bootAcct.histPeriod`를
  먼저 보고, 없을 때만 앱 레벨 값으로 폴백한다. 계좌 전환 effect는 `prevId===null`이라 최초 로드엔 안 돈다.
  **영속화 신규 지점 0곳** — `accountChartStates`는 이미 `chartPrefs`에 실려 저장되고, 앱 레벨
  `acctHistPeriod`(=활성 계좌의 라이브 값)도 종전 5지점 그대로 남아 저장 트리거 역할을 한다.
- **⚠️ 셀 툴팁 = '왜 평가금액 두 칸으로 검산하면 안 맞는가'의 진단 (산식은 무변경 — 사용자 확정 2026-08)**:
  사용자가 표의 평가금액 두 칸으로 직접 검산한다(`774,826,963 × (1+0.019) ≠ 791,529,823`). 그런데
  평가금액 열은 **총자산 레벨**(입출금 포함)이고 손익·수익률 열은 **투자성과**(흐름 제거)라 그 항등식은
  구조적으로 성립할 수 없다. 산식을 단순 차분으로 되돌리지 말 것(입금이 통째로 수익이 되는 원래 버그) —
  대신 **툴팁(hover)** 으로 `평가금액 차이 = 손익 + 순입출금`을 분해해 보여준다.
  문구는 `utils`의 **공유 포매터 2종**(`periodGapLines` · `periodRateGapLine`)으로만 만든다(손복제 금지 —
  `periodNoun`과 같은 규약). ⚠️ 금액은 **툴팁에만** — CLAUDE.md '입출금 금액 배지는 어느 화면에도 상시
  렌더하지 않는다'(사용자 요청)를 그대로 지킨다. ⚠️ 잔차(ΔV−손익)를 원장 순흐름이라 **단언하지 않는다**
  (보류 이월·계좌 편입/이탈 경계가 섞인다) — `ledger`와 값이 일치할 때만 '순입출금'이라 부른다.
  ⚠️ **null 계약** — 보류 행·첫 기간(`profit`/`prevEval` 없음)이면 아무 줄도 만들지 않는다(0으로 단언 금지).
  ⚠️ 입출금이 없어 두 값이 사실상 같은 기간에는 해명 줄을 **만들지 않는다**(맞는 값에 해명을 붙이면
  '뭔가 어긋났다'는 잘못된 인상을 준다). ⚠️ 통합은 `hideAmounts`면 툴팁을 **아예 만들지 않는다**
  (셀은 가려 놓고 hover에 실금액을 노출하면 '금액 숨기기'가 반쪽이 된다).
  ⚠️ 기준 평가액은 **표가 실제로 그리는 값**이어야 검산이 된다 — 통합은 `periodPrevEval`(직전 대표일
  `evalAmount`), 개별은 `shownEvalOf`(평가자산 셀과 같은 소스: 해외 `ov.krw` → `displayEvalByDate` →
  저장값 폴백). 저장 `evalAmount`를 직접 읽지 말 것.
- **별도 창(stats 카드)**: `card:data`로 **1회만** 시드(`!gotDataRef.current` 게이트)하고 이후 **창 로컬**.
  ⚠️ 그 메시지는 계좌 객체가 바뀔 때마다 오는 **반복 푸시**라, `hideAmounts`처럼 매번 적용하면 창에서
  고른 기간이 (같은 창에서 메모 한 글자만 고쳐도) 앱 값으로 되돌아간다. `CARD_NEEDS.stats.histPeriod`로
  게이팅(전 카드 브로드캐스트 방지), `CARD_OPS` 무수정(쓰기가 아님). 창 세그먼트에 '저장되지 않음'을 표기한다.
- **⚠️ 측정 구간은 반개구간 `(직전 대표일, 이번 대표일]` — '기준일'을 화면에 노출한다 (사용자 문의 2026-08)**:
  일자 셀 라벨(`periodRangeLabel`)은 **버킷 범위**('8/24~8/26')인데 실제 측정은 **직전 행의 대표일
  종가**에서 시작한다(8/23). 그래서 사용자가 "라벨 첫 날부터 재는 줄 알았다 → 8/23→8/24 하루가 빠진
  것 아니냐"고 오독한다(실제로는 이미 포함돼 있다 — 실측 검산: cum(8/26)−cum(8/23)=−₩159,970 =
  일별 −945,745+611,500+174,275, 라벨 첫날 기준이면 +₩785,775로 그 하루가 통째로 증발).
  ⚠️ **산식을 라벨대로 바꾸지 말 것** — 반개구간이라야 **모든 기간 손익의 합 = 전체 누적 손익**
  (연쇄성)이 성립하고, 라벨 기준이면 경계마다 하루씩 사라져 어느 행에도 없는 유령이 된다.
  대신 `utils.periodBasisLines({prevDate,curDate,mode})` **공유 포매터**(손복제 금지)가 기준을 말한다:
  `측정 기준: 26/08/23 (일) 종가 → 26/08/26 (수) 종가` + `시작값 = 바로 아래 행의 평가액입니다`.
  - **노출 5지점**: 통합 일자 셀 title · 통합 % 셀(`periodRateGapLine`의 **선택 인자 `basis`**) ·
    통합 손익 셀(`periodGapLines`의 **선택 인자 `prevDate`/`curDate`**) · 개별 일자 셀 title ·
    개별 손익 툴팁(`gapTail`의 `pd`). th 툴팁 2개(통합)·th+도움말(개별)은 **행별 날짜 없이도 참인**
    문장("시작값 = 바로 아래 행의 평가액")을 hover하지 않는 사용자를 위해 상시 유지한다.
  - **⚠️ 두 선택 인자는 미전달이면 반환값이 종전과 한 글자도 다르지 않다**(하위호환의 축, 검증 #25·#22).
    특히 `periodRateGapLine`의 '해명이 필요 없으면 빈 문자열' 계약은 `basis` 없을 때 그대로 유지된다.
  - **⚠️ '바로 아래 행'은 구조적으로 항상 참이다** — 두 표 모두 내림차순이고 `prev`는 `packed[i-1]`(통합)
    / `viewRows[i+1]`(개별)이라 화면상 한 칸 아래다. 정렬 UI가 없으므로 뒤집히지 않는다.
  - **⚠️ 기록 0건 기간이 건너뛰어진 경우 반드시 알린다** — `compressPeriodRows`가 그 행을 만들지 않아
    라벨이 측정 범위를 축소해 보여 준다(8월 기록이 없으면 '2026-09' 행이 7/31 기준으로 두 달을 잰다).
    `periodBucketSpan`이 버킷 거리를 재어 2 이상이면 경고 줄을 붙인다.
    ⚠️ 문구에 `periodNoun(mode).unit.replace('간','')`을 쓰지 말 것(연간에서 '그 연'이라는 비문).
  - **⚠️ null 계약** — 가장 오래된 기간(직전 대표일 없음)은 **빈 배열**이다. 없는 기준을 지어내지 않는다.
  - **⚠️ 시각 노출은 폭이 안 나온다** — 통합 카드 490px에 6열이라 일자 열 여유가 ≈97px뿐이고(현재 부제
    `진행 중 · 대표 08/26`이 이미 그 폭), 개별은 `xl:w-[21%]`≈252px다. 부제에 `· 기준 08/23`을 더하면
    가로 스크롤이 생긴다 → **툴팁 전용**이 의도된 선택이다.
  - **영속화 지점 0곳** — 전부 매 렌더 파생값이다(`periodPrevDate`도 `histRows` memo 안). `chartPrefs`·
    `portfolioStructureKey`·`applyStateData`·`applyBackupData` 무수정.
- **범위 밖(의도)**: CSV(`handleDownloadCSV`는 **죽은 prop** — 두 표에 진입점이 0개다) · 기간 행
  드릴다운(일별 펼치기) · 기간 값 산식 변경(단순 차분·`손익÷직전평가액` 둘 다 검토 후 **미채택**).
- **알려진 한계**: 가장 오래된 기간 행은 비교 대상이 없어 항상 `'-'`(기간 모드에서 그 비중이 커진다).
  기간 모드에서는 **대표일의 자산검증만** 열린다(비대표일 평가액을 고치려면 '일'로 되돌려야 한다 —
  모드가 Drive에 영속되므로 다음 세션에도 유지된다). 통합 표 기간(`intHistPeriod`)은 계좌와 무관한 단일
  값이라 어느 계좌에서 바꾸든 통합 화면 하나에만 적용된다(개별 계좌 표는 2026-08부터 계좌별이다).
- 검증: `npm run verify:period` (직접 import #1~#27c + 소스 텍스트 가드 #G1~#G28h).
  ⚠️ **미러 금지 — `src/utils.ts`를 직접 import**한다(그 파일은 import 0건이라 Node가 타입만 벗겨 실행).
  가드는 **선언이 아니라 사용부**를 단언하며 **변이 51종**(압축 행 재투입 · fail-safe 되돌림 ·
  **기준일 노출 11종**(일자/%/손익 셀 호출 삭제 · `periodPrevDate` 제거 · `basis`·날짜 인자 무시 ·
  th·도움말 문장 삭제 · 건너뛴 기간 경고 삭제) ·
  오늘 판정 UTC/getTodayKST 복귀 · `cumulativeByDate` 압축본 주입 · 창 반복 적용 · `Math.abs` ·
  chartPrefs deps 누락 · 형제 카드 높이 · 전 구간 보류 0.00% 복귀 · 해외 고지 제거 · 커서 O(n²) 복귀 ·
  `date` 필터 제거 · **계좌별 4지점 각각 되돌림 · 부팅 복원 앱 레벨 복귀 · 툴팁 삭제/값 바꿔치기 ·
  hideAmounts 게이트 제거 · `shownEvalOf`→저장 evalAmount · 잔차를 '순입출금'으로 단언 · 부호 처리 제거 ·
  null 계약 0으로 변경 · 해명 줄 상시 표시 · 산식을 단순 차분으로 되돌림** 등)으로 **실제 검출을 확인**했다.
  가드를 손볼 때 같은 변이가 여전히 잡히는지 다시 확인할 것.

### 누적 지표 = 원금대비 · 조회시작 0% 모드는 '수익률'이 아님 (⚠️ 회귀 주의)

일간 지표(위 Modified Dietz)와 **역할이 다른 누적 지표**의 규약. 세 화면이 같은 날짜에 서로 다른
수익률을 보여주던 문제를 정리한 결과다.

- **지표별 역할 고정(섞지 말 것)**: 누적 원금대비 `(V−C)/C` = "시작부터 통틀어 내 돈이 불었나"
  (요약 카드·추이 표 평가자산 셀 하단·통합 추이표 '원금대비' 열·차트 일반 모드) / 일간 보정 수익률 =
  **"오늘 장에서 벌었나"**(개별 계좌 추이표 '일간 수익률·수익금' 열, 통합 추이표 '전일대비'·'일간 손익' 열).
  ⚠️ **전일대비 열에 누적값을 넣지 말 것** — 애써 만든 입출금 보정이 사라진다.
  ⚠️ **거꾸로 일간 열을 없애지도 말 것** — 사용자가 이 표에서 1순위로 보는 값이 "어제 종가를 오늘의
  시작 금액으로 놓고 오늘 종가까지 얼마 벌었나"다(2026-07 사용자 정의). 한 번 3열을 누적으로 바꿨다가
  되돌린 이력이 있다.
- **`utils.ts` `resolveRecordPrincipal(effectiveValue, record, date, sortedHistAsc, principalProp)`가
  기록 날짜 원금의 단일 소스**. 우선순위 `수동 anchor 전파값 > 그 기록의 principal > 직전 기록의
  principal > 계좌 principal 필드`. **소비자 2곳이 반드시 공유**: `App.tsx` `finalChartData`의
  `exactHist` 분기(차트 '나의 수익률'), `HistoryPanel` `cumulativeByDate`(추이 표 평가자산 셀 하단 누적 2줄).
  ⚠️ 한쪽만 자체 계산으로 되돌리면 같은 날짜에 차트와 표가 다른 누적 수익률을 표시한다
  (`computeDailyMetricsSeries` 단일 소스 규약과 같은 이유). `effectiveValue`는 호출부가 이미 구한
  `computeEffectivePrincipal(...).value`를 **값으로** 넘긴다 — 날짜 루프 안 재계산(O(n²)) 방지.
  오늘 행은 today-effect가 `principal: cleanNum(principal)`(라이브)를 기록에 쓰므로 **요약 카드 수익률과
  자동 일치**한다.
- **해외(overseas)는 USD 기준 별도 분기**: 원금도 평가도 USD라 환산하지 않는다. 원금의 단일 소스는
  `resolveRecordPrincipal`이 아니라 **`utils.ts` `overseasPrincipalAt(date, sortedDeps, sortedWds,
  principal, portfolioStartDate)`** — 날짜별 원장 누적(입금 − `principalDeducted ?? amount`, `noPrincipal`
  제외) + principal 필드 하한. **소비자 2곳 공유 필수**: `App.tsx` `finalChartData` 해외 분기,
  `HistoryPanel` `cumulativeByDate` 해외 분기(`portfolioStartDate` prop 필요).
  ⚠️ **`cleanNum(principal)`을 전 행에 평탄 적용하지 말 것** — 출금 시 principal 필드만
  `principalDeducted`만큼 줄어들어, 출금 이전 과거 행의 원금·수익금이 차트와 갈린다(2026-07 수정 전 상태).
  ⚠️ 수익금도 **USD − USD라 `formatUsd`($)로 표기**한다 — 원화 환산 금지(환율 시점이 섞여 가짜 손익이
  생긴다). 행 스코프 `fmtAmount = isOverseasAcc ? formatUsd : formatCurrency` 하나가 셀·툴팁을 통일한다.
- **수익률 차트 라인 = 항상 누적 TWR**(2026-07 통일, 아래 전용 섹션 참조). 과거의 시계 아이콘
  (`isZeroBaseMode`/`intIsZeroBaseMode`) 토글은 **제거**됐다 — 라인은 개별·통합 모두 입출금 보정 누적
  TWR로 고정. `PortfolioChart`의 `myReturnLabel = '기간 수익률'`(상수)이 **범례·정보패널·계산식 검증
  패널·버튼 title**을 통일한다. 원금대비 `(V−C)/C`는 **요약 카드·추이 표 누적 열에만** 남는다(차트 라인 아님).
  ⚠️ **`chartUtils.tsx`의 `[구간: x%]` 태그 매칭이 라인명을 본다** — 개별 `'기간 수익률'`은
  `selectionResult.myReturnPeriodRate`(두 끝점 TWR의 비), 통합 `'수익률'`은 `selectionResult.rate`
  (이제 구간 TWR)로 갈라야 라인·정보패널과 일치한다. 라벨 변경 시 양쪽을 같이 고칠 것.
- **추이 표 셀 구성 (2026-07 확정 — 되돌리지 말 것)**: 개별 계좌(`HistoryPanel`)는 3열
  `일자 / 평가자산 + 누적 수익률 · 수익금 / 일간 수익률 · 수익금`이다.
  - **2열(평가자산 셀, 3줄)**: 금액 → `±N%`(`cum.rate`, 10px) → `±₩누적수익금`(`cum.profit`, 9px).
    셀 툴팁은 `투자원금 · 평가자산` 원본값(`cumTitle`).
  - **3열(일간, 2줄)**: `%`(`dodChange`) → `±₩일간손익`(`dodAbsChange`). 셀 툴팁은 금액 + 그날 흐름 설명.
  - **사용자 정의(⚠️ 이 문장이 3열의 존재 이유)**: "어제의 평가금 총액을 오늘의 시작 금액으로 보고,
    오늘 종가와 비교해 얼마 벌었나". 현행 Modified Dietz가 **정확히 그 값**이다 — 입출금이 없는 날은
    `(당일−전일)÷전일`과 **항등**이고, 있는 날만 그 금액이 분자에서 빠지고 분모(시작 자산)에 더해진다.
    안내 문구는 반드시 이 프레이밍("시작 금액", "오늘 장에서 번 돈")으로 쓸 것 — 'Modified Dietz'·
    '입출금 보정' 같은 용어를 전면에 내면 사용자가 자기 질문과 연결하지 못한다.
  - **⚠️ 되돌리기 이력**: 한 번 3열을 누적으로 바꾸고 일간을 툴팁으로 내렸다가(커밋 7b406bf) 사용자
    재요청으로 원복했다. 그 발단이던 **07/21 −₩11,002,033 / 07/22 +₩7,385,947 거울상은 산식 결함이
    아니라 데이터 타이밍**(입금 원장 07/21 vs 평가액 반영 07/22)이다. 같은 현상이 다시 보고되면
    산식을 바꾸지 말고 **원장 날짜와 평가 스냅샷을 맞추는 쪽**을 보라. `shouldHoldDailyMetrics`가 못 잡은
    이유는 ΔV가 흐름의 78%로 50% 임계를 넘겨서다(임계를 올리면 정상 수익일이 대량 보류되니 손대지 말 것).
- **⚠️ 입출금 금액 배지는 어느 화면에도 렌더하지 않는다(사용자 요청 — 되돌리지 말 것)**: 일간 지표는
  이미 흐름이 제거된 값이라 금액을 함께 띄우면 중복 노이즈다. 제거된 3곳 — 통합 추이표 전일대비 셀,
  `HistoryPanel` 일간 수익률 셀, 헤더 '오늘 수익' 카드("입금 ₩N 제외"). 보류 안내는 **금액 없이**
  `'입금 반영 대기'`로만 표기한다(`'-'`가 왜 떴는지 알려주는 진단이라 문구 자체는 유지).
  `netFlow`·`ledgerFlow` **필드는 계속 계산·소비되므로 제거 금지** — 보류 판정과 툴팁이 쓴다.
  금액은 `HistoryPanel` **일간 수익률 셀의 툴팁(hover)** 에만 남긴다(상시 표시가 아니므로 허용).
  **예외 없음(2026-07 갱신)** — 과거 유일 예외였던 `PortfolioChart` 조회시작 0% 모드의
  `⚠ 순입금 N 포함 · 실손익 M`은 **제거**됐다. 그 문구는 그 모드의 %가 입금액을 분자에 넣어 거짓말을
  하던 시절의 **오표시 정정 고지**였는데, 라인이 누적 TWR로 바뀌어 %도 ₩(실손익)도 흐름이 제거된
  값이 되면서 전제가 사라졌다. 지금은 흐름이 있으면 금액 없이 `입출금 보정됨`만 표기한다.
- **파생값이라 영속화 무관**: `resolveRecordPrincipal`·누적 %·실손익은 전부 매 렌더 파생값이다.
  `portfolioStructureKey`·`applyStateData`·`applyBackupData`·저장 effect deps **전 지점 무수정**.
- **범위 밖(의도)**: XIRR은 **미적용**. 누적 TWR 곡선은 개별 계좌 차트에 한해 도입됐다(아래 전용 섹션).

### 수익률 차트 라인 = 누적 TWR — 개별 + 통합 (⚠️ 회귀 주의 — 평가액 비율·원금대비 라인으로 되돌리지 말 것)

개별 계좌·통합 대시보드 수익률 차트의 `%` 라인(`showReturnRate`)은 **항상 입출금 보정 누적 TWR**이다
(2026-07 통일). 과거엔 시계 아이콘(`isZeroBaseMode`/`intIsZeroBaseMode`) 토글로 라인을 전환했는데,
옛 식 모두 **구간 중 입금액이 분자에 통째로 들어가거나(평가액 비율: 12.5M→106.4M을 +747%로 표시,
실손익은 −₩5,365,205) 입금일에 분모 C가 급증해 절벽처럼 꺾여**(원금대비) 왜곡됐다 — **왜곡 없는 곡선이
하나도 없었다**. 사용자 요청으로 **토글을 제거하고 라인·드래그 선택을 전부 TWR/구간 실제값으로 통일**했다.
드래그 선택 헤드라인은 **항상 구간 실제값**(종점 누적 아님): % = 두 끝점 TWR의 비, ₩ = 구간 실손익.

- **지표별 역할 고정**: 차트 라인 = `기간 수익률`(누적 TWR, 입출금 보정) — "시장에서 얼마나 벌었나".
  원금대비 `(V−C)/C`("내 돈이 불었나")는 **차트 라인이 아니라 요약 카드·추이 표 누적 열에만** 남는다
  (`resolveRecordPrincipal`/`overseasPrincipalAt` 공유). ⚠️ 카드/추이표 누적 열을 '차트와 맞춘다'며
  TWR로 바꾸지 말 것 — 라인만 TWR, 카드/표는 원금대비 유지. finalChartData 원금대비 계산(raw pass
  `principalReturnRate`·`principalAmount`)은 **신뢰불가 날짜 null-gate + 계산식 검증 패널 투자원금**으로
  계속 쓰이므로 제거 금지.
- **계산식**: `TWR(t) = Π(1 + r(s))` where `r` = `computeDailyMetricsSeries`의 `dodChange`(Modified Dietz).
  입금일 `r`은 이미 흐름이 제거돼 있어 **입출금 규모와 무관**. 부수 효과로 지수·비교종목 라인(0% 정규화
  가격비)과 같은 축에서 처음으로 직접 비교 가능해졌다.
- **`utils.ts` 3함수**: `computeCumulativeTwrSeries(rows)`(전체 이력 누적) / `rebaseTwr(twr, base)`(구간
  재베이스) / `overseasUsdEvalAt(items, date, map)`(해외 USD 평가 — 차트 라인과 TWR이 **공유 필수**).
  `rows` 형식·정렬은 `computeDailyMetricsSeries`와 **동일**(날짜 오름차순).
- **⚠️ `held` 행은 배율 1.0**(직전값 유지) — 일간 표시 계약(`dodAbsChange=null` → `'-'`)과 **다른 것이
  정상**이다. null로 빼면 주말마다 선이 끊기고, 보류된 흐름은 `computeDailyMetricsSeries`가 다음 행으로
  이월하므로 곱은 그대로 정확하다.
- **⚠️ 전체 이력에서 한 번 누적하고 조회구간은 나눗셈으로 재베이스**(개별=`App.tsx` `accountTwrByDate`
  → `finalChartData`의 `twrByChartDate`/`baseTwr` → `rebaseTwr`; 통합=`useIntegratedData` `intTwrCumByDate`
  → `intChartData` `baseTwr=filtered[0]` → `rebaseTwr`). 구간만 잘라 체인하면 첫 행이 `held`(비교 대상
  없음)라 경계에서 흐름 이월 상태가 끊긴다. 재베이스 방식은 조회구간을 바꿔도 곡선 모양이 불변.
- **⚠️ 통합 구간 실손익 ₩ = 누적 `Σ dodAbsChange` 차분(`cumProfit`)** — 개별의 `externalFlowInRange`
  (단일 원장)를 통합에 쓰면 계좌 편입/삭제 경계·현금성·다계좌 흐름 누락으로 틀린다. 통합 rows는
  `intMonthlyHistory`와 **완전 동일 구성**(오름차순 + netFlowIn/Out·ledger·flowSuspect·bookDelta)이라
  추이표·헤더 카드와 정합. 통합은 다계좌라 bookInvalid(해외·추정) 빈도↑ — 그날 bookDelta null이면 ΔV 폴백.
- **⚠️ 평가액 소스는 차트 라인과 동일**: 시장계좌=`activeCloseEvalByDate`(수량×종가), 해외=`overseasUsdEvalAt`
  (USD — 원장도 환산 없이 USD 그대로). 기록일이 아닌 차트 날짜는 직전 기록일 TWR을 carry-forward.
- **⚠️ 곱셈 체인은 하루짜리 이상치를 영구 고정한다**(원금대비는 다음 날 자동 복구). 1차 방어는
  `buildCloseEvalSeries`의 `allExact`·`!estimated` 게이트, 2차는 `r = −100%`(평가 0 + 출금 없음 = 데이터
  누락) 행을 **배율 1로 흡수**하는 가드. **일간 |r| 상한 클램프는 미도입** — 실데이터 관찰 후 임계값 확정.
- **구간 수익률**: `selectionResult.myReturnPeriodRate` = `(1+누적종료) ÷ (1+누적시작) − 1`(base 약분).
  `useChartInteraction.calculateSelection`과 `App.tsx` `defaultSelectionResult` **양쪽에 동일 식**.
  시작점이 null이면 0%(조회시작 base)로 폴백. ⚠️ `selectionResult.rate`(평가액 비율)로 되돌리지 말 것.
- **정보패널 ₩ 값**: TWR 모드는 `평가액 변동`이 아니라 **실손익**(`endEval − startEval − 순흐름`,
  `externalFlowInRange`로 (시작일,종료일] 반개구간)을 쓴다 — %와 ₩이 같은 기준이라야 한다.
- **영속화 무관**: `accountTwrByDate`·`intTwrCumByDate`·TWR·`myReturnPeriodRate`·`cumProfit`은 전부 매
  렌더 파생값이다. `isZeroBaseMode`/`intIsZeroBaseMode` 상태·`chartPrefs` 저장·prop은 **전부 제거**됐고
  (`useHistoryChart`·`App.tsx`·`PortfolioChart`·`IntegratedDashboard`) `portfolioStructureKey`·
  `applyStateData`·`applyBackupData`·저장 effect deps 무관(옛 chartPrefs에 남은 값은 로드 시 무시).
- 검증: `npm run verify:twr` (#22~#28 — 흐름 0 항등·대형 입금 중립·전액 출금·held 배율 1.0·재베이스
  항등식·첫 행 0%·−100% 영구고정 방지). 참조 구현(`computeCumulativeTwrSeries`/`rebaseTwr`/
  `computeDailyMetricsSeries`)은 시그니처·본문 불변 → 통일이 이 함수들을 안 바꿔 검증 무영향.
- **범위 밖(의도)**: CAGR·XIRR은 **미적용**.

### 차트 드래그 구간 선택 = '비선택 구간 딤(scrim)' — 선택은 원본 그대로 (⚠️ 회귀 주의)

수익률 차트에서 드래그로 기간을 고르면 **선택 구간은 원본 밝기 그대로 두고 그 바깥을 어둡게 덮는다**
(사용자 요청 2026-08 "선택한 부분만 선명하게, 선택되지 않은 부분은 음영처리"). 종전에는 선택 구간을
흰색 8~10% `ReferenceArea`로 칠하기만 해서 어두운 차트 배경에서 **선택 범위가 사실상 보이지 않았다**.

- **⚠️ 하이라이트를 밝게 올리는 방향으로 되돌리지 말 것** — 밝기를 더 주면 선택 구간의 라인 색이
  씻겨 "선명하게 보이고 싶다"는 원래 목적과 정면으로 충돌한다. 대비를 **바깥에서** 만드는 반전이 답이다.
- **`utils.selectionDimBands(rows, left, right)` 단일 소스** — 개별 계좌 차트(`PortfolioChart`)와
  통합 대시보드 차트(`IntegratedDashboard`)가 **같은 함수 + 같은 토큰**(`design.CHART_SELECTION`)을
  공유한다. 값을 손복제하면 같은 제스처가 두 화면에서 다르게 보인다.
  반환 `{ start, end, before, after }` — `before`/`after`가 딤 밴드(끝에 닿으면 `null`).
- **⚠️ 상보성(complementarity)이 기하학적 핵심**: `ComposedChart`에 `<Bar>`가 없어 category 축이
  `scalePoint`(bandwidth 0)로 잡히므로 `ReferenceArea x1..x2`는 **두 점의 중심 사이**를 정확히 덮는다.
  그래서 `before`(첫날→시작) · 선택 창 · `after`(끝→마지막날) 셋이 플롯 영역을 **빈틈도 겹침도 없이**
  분할한다. 빈틈이 생기면 안 어두워진 띠가, 겹치면 두 번 칠해져 더 어두운 띠가 남는다.
  `<Bar>`를 추가하면 축이 `scaleBand`로 바뀌어 이 전제가 깨진다.
- **⚠️ paint 순서 = 선언 순서**(recharts `renderByOrder`). `ReferenceArea`의 `isFront` prop은
  2.15.3에서 **무시되므로**(generateCategoricalChart가 참조하지 않는다) 선언 위치가 유일한 수단이다.
  딤 3개는 반드시 **모든 `<Area>`/`<Line>` 뒤**에 선언한다 — 앞에 두면 선 뒤에 깔려 아무것도
  어두워지지 않는다. NBER 경기침체 음영이 **앞**에 선언돼 배경으로 깔리는 것과 정확히 반대 이유다.
- **⚠️ Fragment로 묶지 말고 형제로 둘 것** — 이 저장소의 다른 차트 요소가 전부 형제/배열 형태다
  (`toArray`가 Fragment를 펴 주긴 하지만 검증된 형태를 유지한다).
- **⚠️ 3개 밴드 전부 `ifOverflow="hidden"` 필수 — 기본값 `'discard'`로 되돌리지 말 것**
  (적대적 리뷰 확정 결함, 2026-08): `ScaleHelper.isInRange`가 epsilon 없이 `>=`/`<=`로 재는데,
  d3 scalePoint의 `start += (stop - start - step * (n - 1)) * align` 잔차 때문에
  **`scale(첫 날짜)`가 `range()[0]`보다 ~1e-13 작아지는 폭이 실재한다**. 그러면 첫/마지막 날짜를
  x1/x2로 쓰는 딤 밴드가 `getRect`에서 `null`이 되어 **통째로 사라지고 한쪽만 어두워진다**
  (실측: 1년치 366행에서 폭 534종 중 46종 ≈ 8.6%, 2년치 730행 8.1%. 리사이즈로 나타났다 사라지는
  간헐 증상이라 원인 추적이 어렵다). 선택이 첫 날짜에서 시작하면 **선택 창까지** 함께 사라져
  위 null 계약이 막으려던 바로 그 상태가 된다. `'hidden'`은 discard 분기를 건너뛰고 clip만 적용해
  **정상 케이스 픽셀이 완전히 동일**하다(실측 148건 전수 대조). 종전 단일 하이라이트는 x1/x2가
  내부 날짜라 거의 안 걸렸고 걸려도 무해했다 — 양 끝 앵커로 바뀌면서 상시 노출로 승격됐다.
- **⚠️ null 계약 — '딤만 깔리고 선택 창은 없는(=차트 전체가 어두운)' 상태를 구조적으로 차단**:
  경계를 `rows`에서만 고르고 하나라도 못 찾으면 `selectionDimBands`가 **null**을 돌려준다.
  `ReferenceArea`의 `ifOverflow='discard'`는 밴드마다 **따로** 판정하므로, 호출부 조건
  (`refAreaLeft && refAreaRight`)만으로는 낡은 선택 날짜에서 딤 2개만 살아남는 상태를 막지 못한다.
- **⚠️ 역방향 드래그(오른쪽→왼쪽) 정규화 필수** — 인덱스 `min`/`max`로 정렬하지 않으면 그쪽
  드래그에서 딤이 뒤집혀 **선택한 구간만 어두워진다**(의도와 정반대).
- **해제 경로 4종 — 하나라도 빠지면 차트가 어두운 채로 고착된다**(종전엔 흰색 8% 띠라 잔존해도
  티가 안 났다. 이 변경으로 잔존의 대가가 커졌으므로 넷 다 필수):
  ⚠️ **`MouseLeave`는 더 이상 해제 경로가 아니다**(2026-08) — 커서가 wrapper를 벗어나도 드래그를
  취소하지 않는다. 아래 '차트 구간 선택 = ref가 정본' 절 참조.
  ① **차트 안 단순 클릭** — `useChartInteraction`의 두 `MouseUp`. ⚠️ 통합 차트는
  `intRefAreaRight`가 `''`인 채로 `calculateIntSelection`에 넘기면 `[l,r].sort()`가 `''`를 앞으로
  보내 **차트 시작~클릭 지점**이라는 없는 구간을 돌려준다(하이라이트는 안 뜨는데 패널만 '선택 기간'으로
  바뀌는 모순). 개별 차트에는 원래부터 있던 가드를 통합에도 넣었고, 해제 시 `setIntSelectionResult(null)`도
  **함께** 호출한다.
  ② **플롯 영역 밖(축 눈금) 클릭** — 두 `MouseDown`의 `else` 분기(적대적 리뷰 확정 결함).
  ⚠️ recharts는 Y축 눈금 거터·X축 날짜 띠를 눌러도 `onMouseDown`을 **부른다**
  (`handleOuterEvent`가 `getMouseInfo` 결과를 `mouse ?? {}`로 넘긴다 — `inRange`는 플롯 rect만 본다).
  거기서 `activeLabel`이 없다고 no-op으로 두면, 그 영역은 `.chart-container-for-drag` **안**이라
  ③의 차트 밖 클릭 해제도 건너뛰어 **아무 경로도 없다**. 통합 차트 기준 축 띠가 카드의 약 1/4이고
  날짜 라벨이 전부 거기 있어 오클릭이 잦다.
  ③ **차트 밖 클릭** — `App.tsx`의 window `mousedown` + `touchstart` 리스너.
  ⚠️ 두 차트가 같은 `.chart-container-for-drag` 클래스를 쓰는데 과거엔 **개별 계좌 state만** 지웠다
  → `int*` 3종도 반드시 함께 초기화할 것(두 차트는 `showIntegratedDashboard`로 갈려 동시에
  마운트되지 않아 교차 초기화 부작용이 없다).
  ⚠️ 판정은 '카드 안인가'가 아니라 **recharts 표면(`.recharts-wrapper`) 위인가**다 — 카드 안이라도
  컨테이너 패딩(`p-2`~`p-4` / `px-2`)에 떨어진 클릭은 recharts 이벤트가 **아예 발생하지 않아**,
  컨테이너만 보면 ②로도 ③으로도 안 걸리는 링이 남는다.
  ⚠️ **`touchstart`를 함께 들을 것** — recharts는 `<Tooltip>`이 있으면 `onTouchStart`를
  `handleMouseDown`으로 위임하므로(`generateCategoricalChart` `parseEventsOfWrapper`) **손가락
  드래그로도 선택이 만들어진다**. 그런데 스크롤로 판정된 터치에는 호환 `mousedown`이 발생하지
  않아, `mousedown`만 듣던 종전 코드로는 딤이 영영 안 걷혔다.
  ④ **조회기간 변경** — `[appliedRange]` / `[intAppliedRange]` 리셋 effect 2개(둘 다 기존).
  ⚠️ **②③④는 state뿐 아니라 `resetChartSelectionRefs()`로 ref도 함께 지워야 한다** — 정본이 ref라
  한쪽만 지우면 다음 mousedown이 유령 앵커를 되살린다(상세는 아래 절).
- **영속화 지점 0곳** — 딤은 전부 매 렌더 파생값이고 선택 state는 종전부터 세션 로컬이다.
  `chartPrefs` 5지점·`portfolioStructureKey`·`applyStateData`·`applyBackupData`·저장 effect deps
  **전 지점 무수정**. `selectionResult`/`calculateSelection`/`calculateIntSelection` **산식도 무수정**
  (누적 TWR 규약 무영향 — 정상 드래그의 결과값이 1원도 바뀌지 않는다).
- **범위 밖(의도)**: 선택 구간 확대(zoom), 카드 별도 창의 수익률 차트
  (`cardWindow`에 `chart`는 원래 미지원), 차트 컨테이너의 `touch-action` 지정.
  ⚠️ 마지막 항목은 **알려진 한계**다 — 차트 위에서 시작한 세로 스크롤이 가로 성분을 가지면
  스크롤과 **동시에** 구간 선택이 만들어진다(recharts의 터치 위임 때문. 이 변경 이전부터 있던
  동작이다). `touch-action: pan-y`로 막고 싶어도 recharts가 `onTouchCancel`을 바인딩하지 않아
  `isDragging`이 true로 남을 수 있어 더 나쁘다 → 위 ③의 `touchstart` 해제로 탈출구만 열어 뒀다.
- 검증: `npm run verify:chart-sel` (`src/utils.ts` 직접 import #1~#17 + 소스 텍스트 가드 #G1~#G17).
  ⚠️ 가드는 **선언이 아니라 사용부**를 단언하며 **변이 26종**(딤/선택 창 개별 삭제 · paint 순서를
  `<Area>` 앞으로 되돌림 · 토큰 손복제 · 옛 흰색 하이라이트 부활 · Fragment 래핑 · 단순 클릭 가드 제거 ·
  차트 밖 클릭에서 통합 초기화 제거 · 없는 날짜 통과 · 역방향 정규화 제거 · 폭 0 딤 · 상보성 파괴 ·
  입력 배열 변형 · memo가 남의 차트 데이터를 읽음 · deps 누락 · **밴드별 `ifOverflow` 제거 ·
  플롯 밖 클릭 else 분기 삭제 · 표면 판정 되돌림 · `touchstart` 등록/해제 누락**)으로
  **실제 검출을 확인**했다.
  ⚠️ `#G3c`는 밴드를 **한 줄씩** 검사한다 — 개수만 세면 한 밴드에서 빼고 다른 곳에 붙여도 통과한다.
  ⚠️ 산술로 표현되지 않는 두 계약(경계 날짜 `discard` · paint 순서)은 이 스크립트 밖에서
  **react-dom/server로 실제 recharts SVG를 렌더해** 검증했다(딤 3개 path의 x/width가 빈틈·겹침 없이
  플롯 폭을 정확히 분할 · DOM 순서상 데이터 선보다 뒤 · 폭×행수 2,136조합에서 `hidden` 적용 후 소실 0건).
  회귀가 의심되면 그 방식으로 다시 재현할 것.
  ⚠️ 파트①은 예외를 **그 케이스의 실패**로 바꾸는 래퍼(`S`)를 통해 호출한다 — 직접 호출하면 던지는
  구현이 스크립트를 통째로 중단시켜 어느 계약이 깨졌는지 알 수 없고, 변이 테스트에서 '검출됨'과
  '죽은 단언'을 구분할 수 없다(실측: `i1 === -1` 가드를 지우면 `rows[-1].date`로 TypeError).
  가드를 손볼 때 같은 변이가 여전히 잡히는지 다시 확인할 것.

### 차트 구간 선택 = 'ref가 정본' + 더블클릭 시작점 고정 (⚠️ 회귀 주의)

수익률 차트(개별 계좌 `PortfolioChart` · 통합 대시보드 `IntegratedDashboard`)의 기간 선택은 두 제스처를
**같은 상태 머신 하나**로 지원한다: ① 종전의 **그냥 드래그** ② **더블클릭으로 시작점을 고정한 뒤
클릭하거나 드래그해 끝점 지정**(2026-08 신설, 사용자 확정 — 둘 다 허용).
발단은 사용자 보고 "그래프선에 마우스를 놓고 드래그해 기간을 고르려는데 **잘 안 되고, 조회기간이
길수록 심하다**". 원인은 UI가 아니라 **React 18 이벤트 우선순위 비대칭**이었다.

- **⚠️ 1급 계약 — 진행 상태의 정본은 `useChartInteraction`의 ref(`acctRef`/`intRef`)다. React state로
  되돌리지 말 것.** `mousemove`의 `setState`는 **ContinuousLane**(Scheduler UserBlocking = MessageChannel
  **매크로태스크**)로 비동기 커밋되는데 `mouseup`은 **DiscreteLane**(SyncLane, 마이크로태스크)이라 그
  자리에서 즉시 처리된다. 차트가 무거우면 mousemove가 커밋되기 **전에** mouseup이 실행되고, mouseup
  핸들러가 **직전 커밋 렌더의 클로저**를 읽는 순간 `refAreaRight`가 `''`라 '단순 클릭 = 해제' 분기를 타
  **선택이 통째로 사라진다**. 게다가 mouseup의 `setRefAreaRight('')`가 훅 업데이트 큐에 더 나중에
  들어가므로 뒤늦게 도착한 mousemove 값은 **구조적으로 살아남을 수 없다**.
  ref는 커밋과 무관하게 동기 갱신되므로 **렌더 속도와 정확성이 완전히 분리**된다.
  - **왜 조회기간이 길수록 심한가**: 이 레이스의 창(window) 크기 = 리렌더 1회 시간이고, 그 시간이
    포인트 수 N에 정비례한다. `unifiedDates`는 기록일 ∪ 지수 ∪ 전 보유·비교종목 일봉 ∪ 전 시장지표라
    3개월 ≈ 65, 1년 ≈ 265(암호화폐 이력이 있으면 365), 3년 ≈ 800, 10년 ≈ 2,650이다. 게다가 recharts는
    `isChildrenEqual`이 **구조적으로 항상 false**(인라인 화살표 prop — `tickFormatter`·`label`·
    `content={() => null}`)라 매 렌더 `updateStateOfAxisMapsOffsetAndStackGroups`를 **O(N × 시리즈수)**로
    돌린다. 개별 차트는 지표를 전부 켜면 시리즈가 최대 24개다.
  - ⚠️ **그 `isChildrenEqual`을 고쳐도 드래그 중에는 아무 효과가 없다** — 딤·선택창 `ReferenceArea`의
    props가 매 move마다 **의도적으로** 바뀌므로 드래그 중에는 항상 false다. 인라인 화살표를 상수로
    끌어올리는 대규모 리팩터링은 이 버그에 무효이므로 하지 말 것.
- **⚠️ 훅은 지연 state를 아예 받지 않는다(구조적 불변식)** — `useChartInteraction`의 시그니처에
  `refAreaLeft`/`refAreaRight`/`isDragging`이 **없다**. '읽지 않는다'를 규율로만 두면 언젠가 다시
  읽게 되므로, 참조할 방법 자체를 없앴다. `App.tsx`의 호출부도 setter만 넘긴다(가드 #G10b·#G10c).
  React state(`refAreaLeft` 등)는 이제 **딤·앵커선을 그리기 위한 거울**일 뿐이다.
- **⚠️ `MouseLeave`가 드래그를 취소하지 않는다** — recharts 플롯 상단 여백이 기본 `margin.top` =
  **5px**뿐이라, 구간을 끝까지 끌다 위로 살짝만 넘겨도 `.recharts-wrapper`를 벗어나 mouseleave가 뜬다.
  종전엔 `handleChartMouseLeave = handleChartMouseUp`이라 그 순간 선택이 통째로 사라졌다(오른쪽 끝까지
  끌어 '오늘까지' 고르려는 가장 흔한 동작에서 특히 잦다). 지금은 **hover만 끄고** 확정은 mousedown에서
  무장한 **window `mouseup`**(`armWindowUp`, 포인터 캡처 대용)이 맡는다.
  ⚠️ **드래그 고착 자가치유 2종을 세트로 둘 것** — 취소를 없앱기 때문에 버튼을 누른 채 창을
  벗어나면 `dragging`이 true로 남아 돌아왔을 때 **버튼을 안 눌렀는데도 구간이 커서를 따라온다**.
  ① `armWindowUp`이 window **`blur`**도 함께 듣고(alt-tab 즉시 확정) ② mousemove에서
  `s.dragging && ev.buttons === 0`이면 그 자리에서 확정한다(돌아왔을 때 지연 치유).
  ⚠️ ②는 **반드시 `s.dragging`과 함께** 판정할 것 — 앵커 미리보기는 원래 버튼 없이 따라오므로
  `buttons === 0`만 보면 그 기능이 통째로 죽는다(가드 #G11c).
  ⚠️ recharts의 `onMouseUp`이 먼저 실행되며 `disarmWindowUp()`으로 리스너를 떼므로 **이중 확정이 없다**
  (React 루트가 window보다 앞 노드라 순서가 보장된다). 커서가 밖에 있으면 recharts 쪽이 안 오고 window
  쪽만 확정한다.
- **상태 머신** (개별·통합 동일, `ChartSel = {anchor, left, right, dragging}`):

  | 현재 | 이벤트 | 동작 |
  |---|---|---|
  | 아무 때나 | 플롯 위 **더블클릭** | `anchor = left = 그 날짜`, `right=''` → 대기 상태(파란 점선 '시작' 표시) |
  | 앵커 없음 | mousedown(플롯) | `left = 그 날짜`, `right=''` — 종전 드래그 시작 |
  | **앵커 있음** | mousedown(플롯) | **시작점을 덮어쓰지 않는다** — 그 지점은 `right`(종료점 후보) |
  | 드래그 중 · 앵커 대기 | mousemove | `right` 갱신 + 미리보기(앵커 모드는 **버튼을 안 눌러도** 따라온다) |
  | 〃 | mouseup / window mouseup | `left && right && left !== right`면 확정(+앵커 해제), 아니면 해제 |
  | 앵커 있음 | 앵커 위에서 mouseup | 시작점 유지하고 계속 대기(취소가 아니다) |
  | 아무 때나 | 플롯 **밖** mousedown · 차트 밖 클릭 · 조회기간 변경 · **Esc** | 전부 해제(앵커·ref 포함) |

  ⚠️ **`(s.dragging || s.anchor)`에서 `s.anchor`를 빼지 말 것** — 빼면 '클릭으로 끝점 지정'이 통째로
  죽어 사용자가 고른 "둘 다 허용" 규약이 반쪽이 된다(가드 #G16b).
- **⚠️ 더블클릭의 두 번째 클릭에서 오는 mousedown/mouseup은 무시한다**(`isSecondClick(ev)` = `ev.detail >= 2`,
  **4곳**). 안 그러면 한 제스처 안에서 '앵커 확정 → 즉시 선택 확정 → 해제'가 연달아 일어나 화면이
  번쩍인다. recharts는 `onMouseDown`/`onMouseUp`을 `handleOuterEvent`로 넘기며 2번째 인자에 React
  합성 이벤트를 실어 주므로 `detail`을 읽을 수 있다. **Touch 경로는 `detail`이 없어 항상 false**(기존 동작 유지).
  ⚠️ 앵커 상태에서 다시 더블클릭하면 1번째 클릭이 먼저 구간을 확정했다가 dblclick이 새 앵커를 잡는다 —
  한 프레임 깜빡일 수 있으나 결과는 정확하다. 이를 없애려면 클릭 확정을 250ms 지연해야 해서 **미채택**.
- **⚠️ `onDoubleClick`은 `<Tooltip>`이 있어야 온다** — recharts `parseEventsOfWrapper`가 tooltipEvents로
  `onDoubleClick: handleDoubleClick`을 바인딩한다(두 차트 모두 `<RechartsTooltip content={() => null} />`을
  렌더하므로 성립). `getMouseInfo`가 **null**을 그대로 넘기므로 핸들러는 `e?.activeLabel` 가드 필수.
- **앵커 표시** — `anchorDate`/`intAnchorDate` state(그리기 전용) → 파란 점선 `ReferenceLine` + '시작' 라벨,
  그리고 선택 패널의 안내 문구. ⚠️ **딤·선택창보다 뒤에 선언**해야 위에 보이고(paint 순서 = 선언 순서),
  **`ifOverflow="hidden"` 필수** — 조회기간 첫 날짜에 앵커를 찍으면 d3 `scalePoint` 잔차로 기본값
  `'discard'`가 표시선을 통째로 버려 "더블클릭했는데 아무 표시도 없다"가 된다(딤 밴드와 같은 근거).
  색·굵기는 `design.CHART_SELECTION.anchorStroke/anchorStrokeWidth/anchorDash`를 **두 차트가 공유**한다.
- **Esc = 앵커·선택 취소**(훅 안 window `keydown`). 앵커 대기 상태의 유일한 키보드 탈출구다.
  ⚠️ **지울 게 있을 때만 동작**시킬 것 — 모달이 열려 있을 때 눌린 Esc가 부작용을 만들지 않게 한다.
- **⚠️ `selectionResult`·`calculateSelection`·`calculateIntSelection` 산식은 1바이트도 바뀌지 않았다**
  (누적 TWR 재베이스 규약 무영향). 정상 드래그의 결과값은 종전과 동일하고, 달라진 것은 '결과가 유실되지
  않는다'뿐이다.
- **부수 성능 개선 2건**: ① 활성 tick이 그대로인 mousemove는 `setHoveredPoint`를 건너뛴다
  (`hoverKeyRef`/`intHoverKeyRef` — ⚠️ 두 차트가 **같은 ref를 공유하면** 뷰 전환 직후 같은 날짜에서 첫
  갱신이 스킵되므로 분리한다). ② `useIntegratedData`의 `intChartData`가 `intFilteredDates.includes(...)`를
  filter 콜백에서 부르던 O(행수 × 날짜수)를 **Set 조회**로 바꿨다(10년치에서 실측 43.5ms → 0.1ms 규모, 가드 #G17).
- **영속화 지점 0곳** — `anchorDate`/`intAnchorDate`는 `useHistoryChart`의 세션 로컬 state이고 ref는
  메모리다. `chartPrefs` 5지점·`portfolioStructureKey`·`applyStateData`·`applyBackupData`·저장 effect deps
  **전 지점 무수정**.
- **범위 밖(의도)**: 카드 별도 창의 수익률 차트(`cardWindow`에 `chart`는 원래 미지원) · 선택 구간 확대(zoom) ·
  터치에서의 더블탭 앵커(`detail`이 없어 판별 불가) · `touch-action` 지정.
  **알려진 한계**: recharts가 `onTouchCancel`을 바인딩하지 않아, 스크롤로 취소된 터치는 `s.dragging`이
  true로 남아 다음 손가락 이동이 구간을 이어 그릴 수 있다(**이 변경 이전과 동일**한 기존 동작).
- 검증: `npm run verify:chart-sel` 파트③ `#G10~#G17`. ⚠️ 가드는 **선언이 아니라 사용부**를 단언하며
  **변이 20종**(blur 리스너 제거 · `buttons` 자가치유 제거 · 자가치유가 앵커 미리보기까지 잡음 · 훅 시그니처에 지연 state 복귀 · mouseLeave가 다시 취소 · 앵커 분기가 시작점 덮어쓰기 ·
  `onDoubleClick` 배선 제거 · 앵커 표시선 삭제/`ifOverflow` 제거/토큰 손복제/paint 순서 · 해제 3경로에서
  ref 초기화 누락 · `isSecondClick` 가드 제거 · 앵커 미리보기 제거 · window mouseup 무장 제거 ·
  ref 정본 제거 · mouseUp이 state를 읽음 · Esc 제거 · App prop 제거 · Set 필터 되돌림)으로
  **실제 검출을 확인**했다. 가드를 손볼 때 같은 변이가 여전히 잡히는지 다시 확인할 것.

### 차트 토글은 계좌별로 독립 — 화이트리스트는 `currentChartStateRef` 하나 (⚠️ 회귀 주의)

개별 계좌 화면의 토글 6종(**비교종목 · 시장지표 · 조회기간 · 수익률 · 평가자산 · 평가액 추이 기간 단위**)은
계좌마다 마지막 상태를 유지하고 **다른 계좌에 절대 새어 나가지 않는다**. 저장소는 앱 레벨
`accountChartStatesRef`(`{ [portfolioId]: {...} }` → `chartPrefs.accountChartStates`로 Drive 영속)이고,
**무엇을 계좌별로 볼지는 `App.tsx` `currentChartStateRef`의 필드 목록이 단독으로 정한다**.

- **⚠️ 새 차트 토글을 추가하면 반드시 4곳을 같이 고칠 것** — 하나라도 빠지면 그 토글만 앱 레벨로
  남아 계좌 간 누수가 난다: ① `currentChartStateRef` **기본값 리터럴** ② 최신값 동기화 effect의
  객체 + **deps** ③ 계좌 전환 effect의 `saved` **복원 분기** ④ 같은 effect의 **처음 방문 기본값 분기**.
  (①②만 하면 저장은 되는데 복원이 없어 값이 그대로 남고, ③만 하면 신규 계좌가 직전 계좌를 물려받는다.)
- **과거 버그**: `showTotalEval`(평가자산)·`showReturnRate`(수익률)가 `chartPrefs` **최상위 키에만**
  있고 이 화이트리스트에 없었다. 전환 effect가 저장도 복원도 하지 않아, A계좌에서 켠 버튼이
  B계좌에서도 켜진 채로 떴다(나머지 3종은 원래부터 계좌별이라 정상이었다).
- **⚠️ 마이그레이션 폴백은 지점마다 다르다(둘 다 의도)**: 계좌 전환 복원은 필드가 없으면
  **`?? true`**(컴포넌트 기본값) — '앱 레벨 값 그대로 두기'로 폴백하면 저장본이 한 바퀴 갱신될
  때까지 원래의 누수가 그대로 보인다. 반대로 `applyStateData`의 **부팅 시 활성 계좌 복원**은
  `!== undefined` 가드만 둔다 — 부팅 시점엔 계좌가 하나뿐이라 누수가 없고, 앱 레벨 값(직전에 쓰던
  값)이 가장 자연스럽다. ⚠️ 이 복원은 `chartPrefs.showTotalEval/showReturnRate` 복원보다 **뒤에**
  와야 계좌별 값이 이긴다.
- **앱 레벨로 남는 것(의도)**: `showMarketPanel`·`indicatorScales`·`hideAmounts`(전역 표시 설정),
  통합 대시보드 계열(`int*`). `PortfolioChart`의 `showPrincipal`(투자원금)은 **컴포넌트 로컬**이라
  계좌 간 누수가 있고 저장도 안 된다 — 기존 동작 유지(이번 범위 밖).
- **영속화 신규 지점 0곳**: `accountChartStatesRef`는 이미 `chartPrefs`에 실려 있고
  `showTotalEval`/`showReturnRate`는 이미 `chartPrefsUpdatedAt` effect deps·STATE 저장 effect deps에
  있다. 계좌 전환이 두 값을 바꾸므로 저장이 자동 트리거된다.

### usePortfolioState 훅 (모든 포트폴리오 상태 + CRUD)
`switchToPortfolio`, `addPortfolio`, `deletePortfolio`, `addSimpleAccount`,
`updateSimpleAccountField`, `updatePortfolioStartDate`, `updatePortfolioName`,
`updatePortfolioColor`, `resetAllPortfolioColors`, `updateSettingsForType`,
`updatePortfolioMemo`, `movePortfolio`, `handleUpdate`, `handleDeleteStock`(async+confirm),
`transferStockToPortfolio` (종목 계좌 간 이관 — 전용 섹션 참조),
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

### 분배율 = 해외계좌는 '종목별', 그 외는 '계좌 총원금' (⚠️ 회귀 주의 — 두 경로를 합치지 말 것)

분배율 행은 **두 구현이 공존**하고 분기는 `hasOverseas` 하나가 정한다(`DividendSummaryTable`).

| 화면 | 함수 | 분모 | 분자 | 통화 |
|---|---|---|---|---|
| **해외계좌 개별 뷰** | `renderStockRateRows` | **그 종목의 투자금** `overseasInvestAmount(item)` | **세후(net)** | **USD 1가지** |
| 국내계좌 개별 뷰 · 통합(compact) | `renderDistRateRow` | 계좌 총원금 `p.principal` 합 | 세전(gross) | 원화(+달러 2행) |

**왜 종목별인가**(사용자 요청 2026-08): 계좌 총원금에는 **분배금을 한 푼도 주지 않는 종목·예수금·
현금이 섞여 있어** 분배율이 구조적으로 희석된다. 종목 단위로 나눠야 "이 종목에 넣은 돈이 매달 몇
%를 돌려주는가"라는 실제로 쓸 수 있는 수치가 된다. **계좌 총원금 1행으로 되돌리지 말 것.**

- **표시 규약**: 라벨 열 = **종목코드**(첫 행에만 `분배율 · 종목 투자금 대비` 캡션). 월 셀 2줄 —
  위 `세후분배금 / 투자금`(9px 회색), 아래 **`월분배율`(굵게) + `(연환산)`**(연환산 = 월 분배율 × 12).
  **연간합계 셀은 이미 1년치라 연환산 괄호를 붙이지 않는다**(`stockRateCell`의 `showAnnualized=false`).
- **⚠️ 분자는 세후(net)** — 사용자 확정(실수령 기준). 그리고 **tbody 종목 행과 문자 그대로 같은 식**을
  써야 한다: 월 예상 탭 `d.amountUsd * (1 - taxRate/100)` · 연간 `row.annualUsd * (1 - taxRate/100)` /
  월 입금 탭 `d.hasManual ? d.afterTaxUsd : 0` · 연간 `row.annualAfterUsd`. 다른 식을 쓰면 같은 표의
  세후 열과 분배율이 모순된다(tfoot `monthlyUsdTaxTotals`는 `Math.round`도 `perShareTaxableBase`도
  적용하지 않아 행 단위 식과 미세하게 다르다 — 그쪽을 베끼지 말 것).
- **⚠️ 분모는 `utils.overseasInvestAmount(item)`(USD)** — `item.investAmount`를 읽으면 **원화 잔존값**
  (레거시·`PasteModal` 임포트)이 섞여 ≈1,390배 오염된다('해외계좌 투자금액' 섹션). 값은 `expectedRows`/
  `actualRows`의 **`investUsd` 필드**로 실어 보낸다(파생값 — 저장 지점 0곳). 이 표가 받는 배열은
  `allPortfoliosForDividend`라 **raw item**(환율 미적용)이므로 `totals.calcPortfolio` 함정과는 무관하다.
- **⚠️ `hasOverseas`는 반드시 인자로 받는다** — `expectedHasOverseas`는 **탭 IIFE 지역 변수**라
  컴포넌트 스코프 헬퍼가 그냥 참조하면 렌더 중 ReferenceError로 **표 전체가 ErrorBoundary 화면**이
  된다(`@ts-nocheck` + esbuild라 컴파일러도 `undefcheck`도 못 잡는다 — `initTradeRest` 장애와 동일 부류.
  `scopecheck.mjs`가 이 부류 전용 게이트다).
- **열 수 항등식**(어기면 그 행부터 표 정렬이 통째로 깨진다): `1(sticky 라벨) + Σ_{!isMonthHidden(i)}
  (hasOverseas?2:1) + (hasOverseas?2:1)`. **연간 셀을 빠뜨리는 사고가 잦다.** 월 순회는 12칸 원본 배열 +
  `!isMonthHidden(i)` — `.filter().map()` 금지(인덱스가 밀려 저장 키가 옆 달로 간다).
- **행 집합 = `rows.filter(r => r.isOverseas)` 중 `annual > 0`**. `extraActualRows`(수동 추가 행)는
  **제외**(수량·투자금액 개념이 구조적으로 없다). 유령 행(`__orphan`, 삭제된 종목)은 **포함하되**
  `investUsd = 0`이라 분모 없음 → `fmtRate`가 `'-'`를 반환한다(조용한 오적용보다 명시적 미적용).
- **⚠️ 분기 게이트는 `hasOverseas`가 아니라 `stockRates.length > 0`이다**(적대적 리뷰 확정 결함).
  `actualHasOverseas`는 `extraActualRows`까지 포함해 판정하는데 `actualStockRates`는 `actualRows`만
  보므로, `hasOverseas`로 재면 **'보유 종목 0 + 수동 추가 행만' 계좌**에서 분배율 섹션이 통째로
  사라지고 각주 설명만 남는다(수동 행에는 투자금액 개념이 없어 사용자가 값을 채워도 복구 불가).
  빈 배열이면 계좌 기준 행으로 폴백한다. 국내 계좌는 `stockRates`가 구조적으로 항상 빈 배열이라
  이 조건 하나로 종전 경로가 그대로 유지된다.
- **범위 밖(의도)**: 국내 계좌·통합 뷰는 종목별 분배율 **미적용**(아래 통화 규약 그대로). 통합은
  계좌별 행이라 종목 단위 데이터가 없고, 국내는 사용자가 해외만 요청했다.

### 분배율 행(국내·통합) = 통화별 2행(달러/원화) — 해외계좌 원금은 USD (⚠️ 회귀 주의)

`renderDistRateRow`(`DividendSummaryTable`)의 분모는 **통화를 맞춰야** 한다. **해외계좌(overseas)의
`p.principal`은 USD**(원금·평가 모두 USD 기준 — '해외계좌 투자금액' 섹션)인데, 과거엔 그 값을 원화
분배금 합계의 분모로 그대로 써서 분배율이 **환율 배수(≈1,390배)만큼 부풀었다**(원금 $28,304 · 12월
₩346,802 → **1328.79%**). 단일 `totalPrincipal`로 되돌리지 말 것.

- **분모 2종**: `principalUsd` = overseas 계좌 principal 합(USD) / `totalPrincipal` = 국내 계좌
  principal 합 + `principalUsd × usdkrw`(원화 환산). 환율 미확보(`usdkrw <= 0`)면 원화 분모를 **0**으로
  두어 `'-'`로 표시한다(부풀린 값을 단언하지 않는다).
- **표시**: `principalUsd > 0` + USD 배열이 전달되면 셀이 2행 — **달러 기준(굵게) 위 · 원화 기준
  (작게·흐리게) 아래**. 그 외에는 종전처럼 원화 1행.
- **⚠️ 두 값이 다른 것이 정상** — 원화 분배금은 사용자가 **실제 입금 시점 환율로 입력**한 값이고
  원화 환산 원금은 **현재 환율**로 환산하기 때문이다. 하나로 합치지 말 것.
- **호출 3지점 전부 USD 배열을 넘길 것**(빠뜨리면 그 화면만 조용히 1행으로 강등): compact 통합
  (`compact*MonthlyUsd`/`compact*AnnualUsd`, 탭별) · 월 예상 분배금(`monthlyUsdTotals`/`annualUsdTotal`) ·
  월 입금 내역(`actualMonthlyGrossUsd`/`actualAnnualGrossUsd` — KRW도 **gross**라 세전끼리 짝을 맞춤).
  ⚠️ 개별 뷰 2지점은 **`hasOverseas`가 false일 때만 실행**되므로(해외면 위 종목별 행이 대신 렌더된다)
  실제로 2행이 뜨는 곳은 **compact 하나뿐**이다. 그래도 USD 인자를 지우지 말 것 — 종목별 경로를
  되돌리거나 국내·해외 혼합 계좌가 생기면 그 순간 조용히 1행으로 강등된다.
- 3번째 인자 `hasOverseas`는 **colSpan 전용**(세전/세후 2열 여부)이고 2행 표시 여부와 무관하다 —
  compact는 열이 1개라 `false`를 넘기면서도 2행을 표시한다.

### DividendSummaryTable
- `compact=false` (기본): 개별 계좌 뷰, 종목 행 표시, 셀 직접 편집 가능
- `compact=true`: 통합 대시보드 뷰, 계좌별 월 합계만 표시, rowColor 그라데이션 텍스트
- 렌더 위치: non-compact = `App.tsx`(`showIntegratedDashboard` 아닐 때) / compact = `IntegratedDashboard.tsx`
  (compact는 App.tsx가 아니라 **IntegratedDashboard 내부**에서 렌더된다)

### 분배금 표 월 컬럼 숨기기 (⚠️ 회귀 주의 — 렌더 지점 23곳 전수 적용 필수)

'월 예상 분배금'·'월 입금 내역' 탭에서 **월 `<th>` 상단 12px 빈 띠 클릭 → 그 월 컬럼 전체 숨김**
(`KrEtfTaxMatrix`의 `hiddenTaxMonths`를 이식). 가로 스크롤이 긴 표에서 필요한 달만 남기는 용도.

- **불변식**: 숨김은 **렌더 전용**. `monthlyTotals`·`compactMonthlyTotals`·`actualMonthlyGrossKrw`·
  연간합계·분배율·과세합계는 전부 `Array.from({length:12})` 그대로 유지 — 숫자는 절대 변하지 않는다.
  저장 키(`monthData[i].yearMonth`)도 원본 인덱스 `i`를 그대로 쓴다. ⚠️ **`.filter().map()`으로 바꾸면
  인덱스가 밀려 옆 달에 저장된다 — 반드시 12개 원본 배열을 순회하고 반환값만 걸러낼 것.**
- **저장 위치 2원화**(탭별 독립 — expected/actual 공유 안 함):
  - 개별 계좌 → 계좌 필드 `p.hiddenDivMonthsExpected` / `p.hiddenDivMonthsActual`
    (`usePortfolioState.toggleHiddenDividendMonth(portfolioId, tab, monthIndex)`).
    영속화: `App.tsx` `portfolioStructureKey`에 두 필드 포함(⚠️ 없으면 `portfolioUpdatedAt` 미상승 →
    Drive STATE 저장 스킵). 로드는 `...p` 스프레드로 자동 보존.
  - 통합 대시보드 → 앱 레벨 `chartPrefs.intHiddenDivMonths = {expected:[],actual:[]}`
    (compact는 여러 계좌 합산 뷰라 저장할 단일 계좌가 없음 → `intSec`·`sectionCollapsedMap`이 사는 곳 재사용).
    ⚠️ **영속화 5지점 필수**: state 리터럴 `chartPrefs`, `chartPrefsUpdatedAt` effect deps,
    STATE 저장 effect deps, `applyStateData`, `applyBackupData`. 저장 가드는
    `useDriveSync` `portfolioChanged || chartPrefsChanged`라 chartPrefs 단독 변경도 저장된다
    (단 `saveVersionFile`은 `portfolioChanged`일 때만 → **타 기기 즉시 반영은 안 됨**, 기존 chartPrefs와 동일).
    로드 정규화 `normalizeIntHiddenDivMonths`(App.tsx 모듈 스코프)로 손상값 방어.
- **컴포넌트 인터페이스**: `DividendSummaryTable`은 저장 위치를 모른다 — `hiddenMonths={{expected,actual}}`(읽기) +
  `onToggleHiddenMonth(tab, monthIndex)`(쓰기) 2개 prop만 받는다. 핸들러가 없으면 스트립·칩 미렌더(graceful).
  App→IntegratedDashboard 구간 prop명은 `intHiddenDivMonths`/`onToggleIntHiddenDivMonth`(3-hop).
- **렌더 지점 23곳**(하나라도 빠지면 그 행만 열이 남아 **표 정렬이 깨진다**): `renderDistRateRow` 1 +
  compact 7(thead·tbody·tfoot 3분기·과세합계 2) + expected 6(thead·overseas 서브헤더·tbody 2분기·tfoot 2) +
  actual 9(thead·서브헤더·tbody 2(종목행/extraActualRows)·tfoot 2·과세합계·실수령·해외 과세합계).
  표현식 바디 map은 `!isMonthHidden(i) && (...)`, 블록 바디 map은 첫 줄 `if (isMonthHidden(i)) return null;`.
  ⚠️ 서브헤더(세전/세후)는 **필터만** 적용하고 스트립은 넣지 않는다(메인 헤더에만).
  ⚠️ `expectedHasOverseas`/`actualHasOverseas`는 **행 집합에서 파생**되므로 월 필터를 태우면 안 된다.
- **⚠️ 스트립 z-index는 `z-[1]`**(과표표의 `z-10` 아님): 이 표의 첫 열 sticky `<th>`가 `z-10`이고 월 `<th>`는
  sticky가 아니라, 스트립을 `z-10`으로 두면 동률+DOM 후순위라 **가로 스크롤 시 스트립이 sticky 열 위로 얹혀
  그 영역 클릭을 가로챈다**(과표표는 sticky th가 `z-20`이라 무사). 월 `<th>`에는 `relative` 필요.
- **`toggleMonth(i)` 래퍼 경유 필수**(스트립·복원 칩 양쪽): `afterTaxBlurTimer` 정리 + 편집 중이면 `commitEdit()`.
  안 그러면 셀이 언마운트된 뒤 150ms blur 타이머만 살아남아 **보이지 않는 월에 조용히 커밋**된다.
- **`hiddenTab` 정규화**: `activeTab`이 `'tax'`일 수 있으므로 저장 버킷 인자는 `'actual'|'expected'`로 정규화해
  전달한다(과표 탭은 `KrEtfTaxMatrix`가 자체 `hiddenTaxMonths`로 처리 — 절대 합치지 말 것).
- **`lastVisibleMonth`**: 열 오른쪽 경계선이 원래 `i === 11` 고정이라 12월을 숨기면 표 끝에 여분 세로선이
  남는다. `isLastCol`/`isLastMonthCol`/`i < 11` 5곳을 이 값 기준으로 비교.
- **⚠️ non-compact 툴바는 `flex-wrap` 필수**: 카드가 `overflow-hidden`이라 숨긴 월 칩이 늘면 우측
  `shrink-0` 그룹(행 추가·새로고침)이 **잘려 클릭 불가**가 된다. 칩은 그 그룹 **밖**에 둔다.
  칩은 유일한 복원 수단이므로 합계 표시 조건부 블록 안에 넣지 말 것.
- **범위 밖(의도)**: 백업 복원 sticky 규칙(`_preserveStickyPersonalData`) 미적용 — 계좌 필드는
  `portfolios[]` 내부라 top-level 평면 머지 계약과 안 맞고, `intHiddenDivMonths`는 `intSec`·`matongClosedIds`와
  같은 뷰 선호도 등급(클릭 한 번으로 복구 가능).

### 삭제된 종목의 분배금·과세 입력 보존 = '삭제됨' 유령 행 (⚠️ 회귀 주의)

포트폴리오 테이블에서 종목을 삭제(`handleDeleteStock` = `pf.portfolio` filter)해도 **계좌 단위로
코드별 보관되는 사용자 입력 분배금/과표 데이터는 지워지지 않는다** — 삭제는 종목 행만 제거한다.
분배금 표(`actualRows`/`compactActualRows`)와 과표 표(`getKrEtfStocks`)가 `pf.portfolio`만 순회하던
탓에 그 데이터가 표에서 사라져 보이던 것을, 삭제된 코드를 **'삭제됨' 유령 행**으로 계속 노출한다.

- **분배금 유령 행**: `getDividendOrphanCodes(pf)`(`DividendSummaryTable.tsx` 모듈 함수) — 금액이 실제
  입력된 맵(`actualDividend`/`actualDividendUsd`/`actualAfterTaxUsd`/`actualAfterTaxKrw`/
  `dividendTaxAmounts`)에 데이터가 남고 `pf.portfolio`에 없는 코드. `actualRows`·`compactActualRows`가
  `[...pf.portfolio, ...orphanItems]`(orphan은 `quantity:0`,`__orphan:true`)를 순회하며 가드는
  `if (!qty && !item.__orphan)`. 저장 키(exYm)는 삭제로 안 바뀌는 `dividendHistory`/`dividendExDate`에서
  산출되고 `handleRefreshAll`은 `pf.portfolio`만 갱신하므로, 유령 행 셀은 삭제 전과 **동일 월에 매핑**된다.
  '월 예상 분배금' 탭은 orphan 미포함(보유 없으면 예상 0 — 의도).
- **종목명 복원(⚠️ 코드만 표시 금지)**: 삭제 시 종목명은 코드별 데이터에 저장 안 되지만, 보유 중 찍힌
  `holdingSnapshots`(`snapshotItemsFromPortfolio`가 `name` 보존)에서 오프라인으로 복원한다 —
  `buildHeldNameMap(pf)`(`utils.ts`, 최신 스냅샷 이름 우선 + 현재 포트폴리오 이름). `actualRows` orphanItems와
  `KrEtfTaxMatrix` orphan의 `name`을 이 맵에서 채워, 유령 행이 **기존처럼 종목명+코드**로 표시된다(스냅샷에
  없으면 코드만 — graceful). `KrEtfTaxMatrix` `krStocks` deps에 `holdingSnapshots` 포함. `allPortfoliosForDividend`
  는 `...p` 스프레드라 `holdingSnapshots` 보존(이름 소스 확보).
- **과표 유령 행**: `KrEtfTaxMatrix` `krStocks`에 `taxBaseHistory`에 입력값이 남고 포트폴리오에 없는
  코드를 `{type:'stock',__orphan:true,quantity:0}`로 추가(`taxBaseHasData` 트리거). **한계**: 매입/매도
  이벤트 없이 배당 과표만 입력한 경우, 삭제된 종목의 과거 보유수량이 taxBaseHistory에 없어 `보유주식수`/
  `예상 과세`가 0으로 표시된다(입력값=배당 과표·평균 과표·과세 과표는 보존·표시). 이벤트가 있으면
  `computeMonthlyQtyForGrid`가 수량을 복원해 정상.
- **영구 삭제(× 버튼)**: 유령 행의 작은 ×/휴지통 → `confirmDialog` 후 `deletePortfolioDividendData`
  (분배금 맵 8개 strip + `dividendHistoryUpdatedAt` 갱신) / `deletePortfolioTaxData`(`taxBaseHistory[code]`
  삭제). 지문(`portfolioStructureKey`)의 `actualDividend`/`dividendHistoryUpdatedAt`/`taxBaseKey` 변경으로
  Drive STATE 저장 트리거(⚠️ `dividendTaxAmounts`/`actualDividendQty`는 지문 미포함이라
  `dividendHistoryUpdatedAt` 갱신이 저장 보장). props: App→DividendSummaryTable(`deletePortfolioDividendData`/
  `deletePortfolioTaxData`/`confirmDialog={confirm}`), DividendSummaryTable→KrEtfTaxMatrix(뒤 2개). compact
  테이블(IntegratedDashboard)은 × 미전달(`&& deletePortfolioDividendData` 가드로 안전).
- **⚠️ 이중 계상 방지(회귀 주의)**: `getDividendOrphanCodes`는 같은 코드로 만든 기존 '수동 추가 행'
  (`extraDividendRows`, 목적 동일=제거 종목 배당 기록)이 있으면 그 코드를 **제외**한다. 안 그러면 유령 행
  (`actualDividend`)과 수동 추가 행(`afterTaxKrw`)이 월/연 합계에서 **둘 다 합산**돼 2배가 되고 2줄로 뜬다.
  기존 수동 행 우선, 유령 행 억제(데이터는 계좌에 남아 수동 행 삭제 시 복원). **새 통합 합산/orphan 소스
  추가 시 이 dedup을 빠뜨리지 말 것.**

### 평균 과표 계산기 — 매도단가·매도금액 + 과세 3열 (⚠️ 회귀 주의)

과표 탭 종목명을 클릭하면 열리는 확장 행(`KrEtfTaxMatrix` '평균 과표 계산기')에서, 매도 행도
**매입단가 칸에 매도단가(그날의 종가)를 입력**하면 매도금액이 뜨고 과세가 **세 열**로 갈린다:
`과세 금액(과표)`(= 과표기준가 − 평균 과표) · `과세 금액(단가)`(= 매도단가 − 평균단가) · `실제 과세`
(둘 다 > 0일 때만 과세, 금액은 1주당 min × 매도수량). 세율 미적용 **과세표준**이다.

- **⚠️ 매도단가는 `evt.sellPrice` — `evt.purchasePrice`와 절대 합치지 말 것**: 화면은 한 칸이지만
  저장 필드는 분리한다(`priceField = isSell ? 'sellPrice' : 'purchasePrice'`). 한 필드를 공유하면
  **매매수량 부호를 정정하는 순간**(-630 오타를 +630으로) 저장값이 반대 의미로 재해석돼, 입력한 적
  없는 매입단가가 `buyEvts`(`change > 0 && purchasePrice > 0`)를 통과해 `buyAmountTotal`·
  `buySummary.avgPrice`·손익을 오염시키거나 그 반대가 된다. 분리하면 부호를 되돌릴 때 각 값이 자기
  필드에 그대로 남는다(데이터 파괴 없음). `purchasePrice`는 종전대로 **매수 전용**이다.
- **⚠️ 평균단가(구매단가)는 `item.purchasePrice`가 아니다** — 국내 주식 행의 포트폴리오 테이블
  '구매단가'는 **`investAmount ÷ quantity`**(`PortfolioTable` 국내 분기)이고, `purchasePrice` 필드는
  해외 계좌·`PasteModal` 임포트에서만 기록돼 국내 종목에서는 거의 항상 0이다. 그대로 읽으면 단가
  기준 과세가 통째로 '판정 불가'가 된다. → `krEtfTaxHelpers.resolveAvgBuyPrice(stock, fallbackAvg,
  fallbackReliable)` 4분기: `portfolio`(inv÷qty) → `item`(purchasePrice) → `events`(계산기 매수 평균)
  → `none`. 반올림하지 않는다(표시만 2자리).
- **⚠️ `events` 폴백은 '매수 평균에서 빠진 매수 행이 0건'일 때만 신뢰**(`fallbackReliable`):
  `buySummary.avgPrice`는 매입단가가 빈 매수 행을 **통째로 제외한 부분 평균**이라, 그대로 쓰면 실제와
  다른 평균단가로 **'비과세'를 확정**한다(예: 100주@10,000 입력 + 900주 미입력 → 부분 평균 10,000인데
  실제는 8,200 → 매도단가 9,000이 과세인데 비과세로 표시). 신뢰 불가면 `source:'unreliable'` +
  value 0 → 단가 기준을 **계산하지 않고** '평균단가 불확실'로 표기한다(명시적 미적용).
  ⚠️ 제외 판정은 `buySummary.noPriceCount`가 아니라 **`buyEvts`의 여집합**(`buyExcludedCount`)이다 —
  `noPriceCount`는 날짜가 유효한 행만 세므로 **날짜를 지운 매수 행**을 놓친다.
- **⚠️ 판정 규약**: `0은 비과세`(`> 0`이 과세 — 기존 열의 `sellPerShareTax > 0`과 갈리면 두 열이
  모순된다). **한쪽만 준비돼도 그 값이 0 이하면 `비과세` 확정**(이미 확정된 사실을 '-'로 감추지 않는다),
  반대로 **`과세` 확정은 양쪽이 다 준비돼야** 한다(조용한 오적용 금지). 그 외에는 `판정 불가`.
  `exemptReason`은 `base|price|both` — `baseExempt`/`priceExempt`를 **먼저 둘 다 계산**해야 `both`가
  도달 가능하다(순차 if로 바꾸면 'both'가 죽는다).
- **⚠️ 1주당 차이는 `PER_SHARE_EPS`(1e-6)로 0에 스냅**: 과표기준가는 소수 2자리가 실질 단위인데 가중
  평균 누적에 IEEE754 잔차(1e-12 규모)가 남아, 수학적으로 0인 행이 `> 0`을 통과해 **표기는 `0.00`인데
  판정은 '과세 ₩0'** 이 된다(신규 '실제 과세' 열이 그걸 노랗게 단언한다). 기존 9열도 갖고 있던 결함.
- **⚠️ 구매단가는 '현재 시점' 값이라 과거 매도 행 판정이 소급 변경된다**(사용자 선택 — 러닝 평균 아님).
  특히 매도를 포트폴리오 표에 반영할 때 **보유수량만 줄이고 투자금액을 그대로 두면** 구매단가가 폭등해
  정상 과세가 비과세로 뒤집힌다 → `avgBuy.verify` **3값**으로 교차검증한다:
  `ok`(계산기 매수 평균과 5% 이내) / `mismatch`(≥`AVG_BUY_MISMATCH_RATIO` → 앰버 `⚠`) /
  **`none`(비교 대상 자체가 없음 → '교차검증 불가')**.
  ⚠️ **`none`을 '정상'으로 뭉뚱그리지 말 것** — 과거엔 `eventsAvg > 0 && 괴리 ≥5%`만 경고했는데,
  `eventsAvg`는 매수 행이 불완전하면 0이라 **경고가 가장 필요한 계좌에서 정확히 꺼졌다**(적대적 리뷰
  3렌즈 독립 확인). `source`(`portfolio`/`item`/`events`)도 툴팁이 아니라 **헤더 서브라인에 상시 노출**
  한다 — 호버하지 않는 사용자는 화면에 없는 값(예: `investAmount=0`이라 포트폴리오 표가 `0`을 보여주는
  행에서 `item` 폴백으로 판정된 값)으로 확정이 내려진 걸 알 수 없다.
- **⚠️ 각주는 폴백 3단계를 그대로 서술할 것** — "평균단가 = 포트폴리오 구매단가"·"매입단가가 비면
  계산하지 않습니다"처럼 단정하면 `item`/`portfolio` 경로에서 **거짓**이 된다(리뷰 확정 지적 2건).
- **열 개수 10 → 12**. 이 확장 행 내부 표에는 **colSpan을 쓰는 행이 없다**(하단 요약·각주는 표 바깥
  `<div>`) → 열 추가 시 고칠 곳은 **thead 1곳 + tbody 1곳뿐**. 바깥 표의 `colSpan={visibleMonthCount + 2}`는
  무관. 하단 요약 바는 **매수 요약 줄 + 매도 요약 줄 2단**이며 각자 독립 조건으로 렌더된다
  (⚠️ 래퍼 게이트는 반드시 `buySummary.count > 0 || sellSummary.count > 0` **OR** — 매수 단독 게이트에
  매도 줄을 넣으면 매수 행이 없는 계좌·'삭제됨' 유령 행에서 매도 요약이 통째로 사라진다).
- **영속화 신규 지점 0곳**: `App.tsx portfolioStructureKey.taxBaseKey`가 `events`를 **JSON 전문**으로
  담으므로 신규 필드 `sellPrice`도 자동 포함 → 매도단가만 고쳐도 Drive STATE 저장이 트리거된다.
  `applyStateData`/`applyBackupData`는 `...p` 스프레드, `updateTaxBaseEvents`는 배열 통째 교체라 무수정.
- **범위 밖(의도)**: 매도금액 자동 종가 조회(사용자가 그날 종가를 직접 입력 — `stockHistoryMap` 프롭
  체인 신설 안 함) · 세율 적용 세액 · 선입선출(FIFO) 원가법(이동평균법만 지원).

**매도 실현손익 — '현재 평가 / 실현손익' 열 (⚠️ 회귀 주의 — 기준단가 = 최저가 우선 매칭, 과세열과 통일 금지)**

매수 행이 그 열에 **미실현** 평가손익(현재가 × 수량 − 매입금액)을 보여주는 것과 짝을 이루는
**실현**손익. 매도 행에 `매도금액 − 매입원가 = (매도단가 − 기준단가) × 매도수량`을 3줄로 렌더한다
(금액 / 주당손익·수익률 / 그 행에 쓰인 기준단가 + **배정된 매수분**). 사용자 요청 2026-08
"매도시 얼마의 수익을 냈는지 매수시처럼 표현" → 2026-08 후속 "최저점 매수가격과 매수수량으로
매도일에 대한 수익을 표시".

- **⚠️ 기준단가 = '최저가 우선(LOFO) 로트 매칭' (2026-08 사용자 확정 — 평균단가로 되돌리지 말 것)**:
  매도수량을 **그 시점까지 남아 있는 매수분 중 가장 싼 로트부터** 차례로 소진시켜 원가를 구한다.
  사용자 요청 그대로 — "최저점 매수가격과 매수수량으로 매도일에 대한 수익을 표시. 매수수량을 초과한
  매도시에는 다음 최저 가격을 기준으로." 실측(2026-08-13): 7/29 761주@7,227 · 7/28 2,113주@7,778 보유
  중 8/5 630주@8,260 매도 → 기준 7,227 → **+650,790**(평균단가 8,699.20 기준이면 −276,694로 **부호가
  뒤집힌다**). 3건 합계도 −₩558,749 → **+₩847,164**로 바뀐다.
  - **⚠️ 이것은 '분석용 원가법'이다 — 세법상 이동평균법이 아니다.** 과세 3열은 종전대로 `avgBuy.value`
    (현재 시점 포트폴리오 구매단가)를 쓰므로, 같은 행에서 **실현손익 '이익' + 실제 과세 '비과세'가
    동시에 나오는 것이 정상**이다. 이 사실을 **열 헤더 툴팁 + 각주 두 곳**에 상시 고지한다(#G7이 각주
    블록만 잘라 단언 — 전역 정규식이면 헤더 툴팁이 대신 통과시켜 각주에서 통째로 사라져도 초록이 된다).
  - **⚠️ 로트 풀은 `compareTaxEvents` 순서로 순차 소진** — 매도 **시점 이후**의 매수는 풀에 아직
    없으므로 배정되지 않는다. 그래야 실현손익이 **확정된 과거 사실**로 남는다(러닝 평균 설계가 지키던
    불변식을 그대로 계승). 한 번 배정된 로트는 소진되어 다음 매도에 다시 쓰이지 않는다.
  - **⚠️ 같은 단가 로트는 먼저 매수한 것부터**(`seq`) — 원가 합은 같지만 **배정 내역이 화면에 표시**되므로
    결정적이어야 한다.
  - **⚠️ 배정 내역을 반드시 노출할 것**(셀 3번째 줄 `기준 7,227.00 07-29` / `기준 7,632.72 2건` + 툴팁의
    매수일·수량·단가 명세, `lotsDetailText`). 기준단가 숫자 하나만 보이면 **"왜 7,227원인가"를 추적할 수
    없다** — 이 배정 내역이 기능의 근거 그 자체다(#G13이 호출 2곳 + 포매터 본문을 단언).
  - **⚠️ `basisDiverged` ⚠는 LOFO 행에서 억제**한다(`basis.source !== 'lofo'` 게이트). 평균단가와
    벌어지는 것이 **설계상 상시**라 전 행에 ⚠가 뜨면 경보가 죽는다(가드는 위험 상태에서만 발동해야
    한다). 폴백 행에서는 종전대로 5% 문턱으로 발동한다.
  - **되돌리면 재발하는 오류 2종**(폴백 경로가 여전히 방어한다): ① 100주@8,000 매수 → 50주@9,000 매도
    → 100주@12,000 매수에서 참값 +50,000이 현재 평균(10,666.67) 기준으로는 **−83,333**. ② 매도를
    포트폴리오 표에 반영할 때 **보유수량만 줄이고 투자금액을 그대로 두면** 구매단가가 폭등해
    (8,000 → 21,621) 이익 매도가 **−8,417,822 손실**로 표시된다(`avgBuy.verify` 경고의 존재 이유).
- **⚠️ 별도 순수 함수 `computeSellRealized`** (`krEtfTaxHelpers.ts`) — `computeSellTaxRow`에 필드를
  얹지 말 것(기준단가가 다른 두 계산이 한 함수에 섞이면 47건이 고정한 과세 계약이 흔들린다).
  반환 `{isSell, soldQty, basis, amount, cost, perShare, profit, rate}`, 미준비면 **전부 `null`**.
  ⚠️ `priceAmount`(0 클램프)를 재사용하지 말 것 — **손실이 통째로 ₩0**이 된다. 분자는 `snapZero`가
  적용된 부호 보존 `perShare`. ⚠️ **수익률 분모는 매입원가**(매수 행의 손익 ÷ 매입금액과 같은 규약 —
  매도금액 분모는 전액 손실에서 −∞로 발산한다). ⚠️ 소수 매도수량을 floor하지 말 것.
- **⚠️ null 계약** — 기준단가가 없거나(매수 행 매입단가 미입력) 불확실하면 **계산하지 않는다**.
  0을 곱해 "매도금액 전액이 수익"으로 단언하는 것이 최악의 오적용이다.
- **⚠️ 로트 매칭은 별도 순수 함수 `buildLofoLotSeries`**(`krEtfTaxHelpers.ts`) — `computeSellRealized`의
  시그니처는 **손대지 않았다**(가중 기준단가만 넘긴다). 반환은 **이벤트 객체 식별자 키 Map**
  `{basis, cost, lots, matchedQty, shortfallQty, trusted}` — ⚠️ 인덱스 조인으로 되돌리지 말 것
  (`buildSortedEventsWithAvg`가 날짜 없는 행을 뒤에 덧붙이는 순간 한 칸씩 밀리고, `evt.id`는 중복·누락 가능).
  `LOT_QTY_EPS`(1e-9)로 로트 소진을 판정한다 — ⚠️ 없애면 `0.1+0.2` 전량 매도의 잔여(~5.5e-17)가
  **유령 로트**로 남아 다음 매도에 옛 단가가 섞인다.
- **⚠️ 기준단가 우선순위 = `lofo` → `running` → `avgBuy`** (`resolveBasis`, #G3이 `indexOf` 순서로 단언).
  LOFO 게이트는 **3항 전부**(`trusted && shortfallQty === 0 && basis > 0`) 필요하다:
  - **`shortfallQty > 0`(매수 이력 부족)** — 배정할 매수분이 모자라면 매칭된 몫의 원가를 전체 수량에
    퍼뜨리지 **않고** 러닝 평균으로 내려보낸다(없는 매수분을 싼값으로 단언 금지). 요약 바에
    `매수 이력 부족 N건` 앰버 안내 + 셀에 `*`. ⚠️ 부족 행이 **이후 행을 오염시키지는 않는다**
    (poison 금지 — 그 뒤 정상 매수가 들어오면 LOFO를 그대로 쓴다).
  - **`trusted`** — 매입단가가 빈 매수 행은 로트를 만들지 못해 그 시점부터 풀 구성이 불완전해지므로
    `excludedSeen`으로 이후 행을 폴백시킨다.
  - **⚠️ 무일자 판정은 `undatedTrade`(`change !== 0`) — 매수만 보던 옛 가드로 되돌리지 말 것**
    (적대적 리뷰 HIGH). **일자 없는 매도**는 `valid` 필터에서 버려져 풀을 소진시키지 못하므로,
    이미 팔린 최저가 로트가 그대로 남아 이후 매도의 기준단가를 낮추는데도 `trusted:true`로 확정된다
    (실측: 100주@5,000 매수 → 무일자 100주 매도 → 100주@9,000 매수 → 100주 매도에서 참값 +50,000이
    **+450,000**, 9배 과대. 게다가 배정 내역 툴팁이 이미 팔린 로트를 근거로 적극 단언한다).
    ⚠️ `buildLofoLotSeries`와 `buildSortedEventsWithAvg`(러닝 평균) **양쪽에 같은 판정**이 있어야 한다 —
    한쪽만 고치면 LOFO는 막히는데 러닝 평균 폴백이 같은 오염값(실측 7,000 vs 참값 9,000)을 내보낸다.
- **⚠️ 폴백 도착지는 사유마다 다르다 — 한 사슬로 뭉뚱그려 서술하지 말 것**(적대적 리뷰 확정):
  **ⓐ 매수 이력 부족** → 러닝 평균(신뢰도는 살아 있다) / **ⓑ 매입단가·일자 누락** → 러닝 평균도
  **같은 `excludedSeen`으로 함께 꺼지므로 건너뛰고** `avgBuy.value`. 즉 `running` 폴백은 ⓐ에서만
  도달 가능하다. 각주·헤더 툴팁·검증 미러(`lofoBasisOf`)가 이 사실을 그대로 반영해야 한다 —
  ⚠️ 미러가 `row.buyAvgTrusted` 게이트를 빠뜨리면 **도달 불가능한 'running'을 단언**하고, 컴포넌트에서
  그 게이트를 지워도 통과하는 죽은 가드가 된다.
- **러닝 평균(2순위 폴백)은 `buildSortedEventsWithAvg`가 평균 과표와 **같은 순회**에서 낸다**(`runningBuyAvg`).
  ⚠️ LOFO 도입 뒤에도 **지우지 말 것** — 매수 이력 부족·부분 풀에서 `avgBuy`(현재 시점 값)로 곧장
  떨어지면 위 '부호 뒤집힘' 2종에 그대로 노출된다. 러닝 평균은 같은 이벤트에서 나오고 나중 매수로
  소급 변경되지 않아 폴백으로서 `avgBuy`보다 안전하다.
  ⚠️ dead code `computeRunningAvgPurchaseSnapshots`를 쓰지 말 것 — `change === 0` 행 제외 여부가 달라
  행이 한 칸씩 밀린다. 이동평균법이라 **매도는 평균단가를 바꾸지 않고 수량만 줄인다**. 매입단가가 빈
  매수 행은 평균에 넣지 않고, 그런 행이 하나라도 있으면(`buyExcludedCount > 0`) 부분 평균이므로
  `avgBuy.value`로 폴백하며 셀에 `*`를 붙인다.
  ⚠️ **신뢰도는 '그 행 시점까지'로 판정한다**(`buyAvgTrusted`) — 전역 `buyExcludedCount === 0`으로
  재면 매도보다 **뒤에 있는** 불완전 매수 행 1건이 그 매도의 완전한 러닝 평균을 폐기시켜 현재 시점
  `avgBuy`로 폴백하고, **이 기능이 막으려던 부호 뒤집힘이 그대로 재현된다**(실측 +50,000 → −83,333).
  게다가 그때는 `basis.value === avgBuy.value`라 `basisDiverged` ⚠가 **구조적으로 뜰 수 없다**.
  `addEvent`가 `purchasePrice` 없이 행을 만들므로 **'행 추가' 후 수량만 입력한 상태**로도 발동한다.
  일자 없는 매수 행만은 순서를 정할 수 없어 종전대로 **전 구간** 신뢰 불가(`undatedBuy`).
  `buyExcludedCount`는 종전대로 `resolveAvgBuyPrice`(과세열)의 전역 판정에만 쓴다.
- **⚠️ 같은 날짜 이벤트는 `compareTaxEvents`(매수 우선)로 결정적 정렬** — `localeCompare`만 쓰면
  같은 날짜의 비교값이 0이라 `Array.sort`의 안정 정렬이 **배열 삽입 순서**를 채택하는데, 사용자에게
  행 재정렬 UI가 없어 결정 요인이 화면에 없다. 실측: 같은 날 매수 100@20,000 + 매도 50@12,000에서
  기준단가 15,000(−150,000) vs 10,000(+100,000)으로 **부호까지 갈렸다**.
  ⚠️ 러닝 평균·로트 매칭을 만드는 **모든 순회가 이 비교자를 공유**해야 한다 — `buildSortedEventsWithAvg`
  (계산기 행) · `buildLofoLotSeries`(로트 풀) · `computeRunningAvgSnapshots`(월별 그리드)가 다른 순서를
  쓰면 **같은 달의 평균 과표가 두 값**이 되고, 같은 날 매수분이 그 매도에 배정될지가 갈린다.
- **⚠️ 요약 바 래퍼 게이트는 내부 매도 줄 게이트를 전부 포함해야 한다**
  (`buySummary.count > 0 || sellSummary.count > 0 || sellSummary.excluded > 0`) — 래퍼가 더 좁으면
  내부 분기가 도달 불가가 된다(매수 0건 + 매도가 전부 미산출이면 '합계 제외 N건' 진단이 통째로 사라진다).
- **⚠️ 매도 요약은 행별 값을 누적한다**(`Σ realized.cost` / `Σ realized.profit`) — 행마다 기준단가가
  다를 수 있어 **'평균단가 × 총 매도수량' 상수 곱으로 되돌리면 부호까지 뒤집힌다**. 그리고 그 형태는
  `computeSellRealized`의 게이트를 우회해 기준단가가 없을 때 매도금액 전액을 '수익'으로 단언한다.
- **⚠️ 매수 요약의 '손익'과 매도 요약의 '실현손익'을 더하지 말 것** — 매수 요약 손익은
  `현재가 × 총 매수수량 − 총 매입금액`이라 **이미 매도한 주식까지** 현재가로 평가한 값이다(매도분
  이중 계상). 각주와 요약 툴팁 **두 곳**이 이를 경고한다(한쪽만 남기면 가드 #G7이 실패한다).
- **`ISO_DATE` 모듈 상수**(`KrEtfTaxMatrix.tsx`) — 일자 정규식 10곳이 공유한다. ⚠️ 인라인 리터럴을
  복제하지 말 것: 신규 필터를 손으로 베끼다 **백슬래시가 소실돼**(빌드는 통과한다) 매도 요약이 통째로
  죽은 이력이 있다. 가드 #G9가 인라인 사용부 0건을 단언한다.
- **⚠️ 각주에 줄을 끼워 넣을 때 기존 4줄을 덮어쓰지 말 것** — 실현손익 각주를 추가하다 과세 3열 각주
  (과세 금액 정의 · 실제 과세 min 규약 · 평균단가 폴백 3단계 · ① 현재 시점 값 경고)가 **통째로 삭제된**
  이력이 있다. `#G7`이 네 문장의 존재를 각각 단언한다(CLAUDE.md의 '각주는 폴백 3단계를 그대로 서술할 것'과 같은 계약).
- **⚠️ 계산 규약·각주는 `?` 토글로 접혀 있다(기본 접힘, 사용자 요청 2026-08 "평소에는 숨기고 확인이
  필요할 때만")** — `showTaxHelp`는 **컴포넌트 세션 로컬**이라 **Drive 저장 지점 0곳**(뷰 선호도이고
  클릭 한 번으로 복구된다 — `hiddenTaxMonths`처럼 계좌 필드로 올리지 말 것).
  ⚠️ **접힌 상태에서도 '분석용 원가법'이 3중으로 보여야 한다** — ① 토글 줄 우측 요약
  (`실현손익 = 최저가 우선 매칭 · 분석용(세법상 이동평균법 아님)`) ② 열 헤더 서브라인
  (`매도 = 실현손익 · 최저가 우선`) ③ 열 헤더 title 툴팁. 각주가 유일한 고지가 되면 접는 순간
  사용자가 실현손익을 **과세 근거로 오해**한다. #G14가 셋을 각각 단언하고, 각주 본문이 실제로
  게이트 **안**에 있는지도(`indexOf` 순서) 확인한다.
- **영속화 신규 지점 0곳** — 실현손익 전 필드가 기존 `events`(change·sellPrice·purchasePrice)에서
  나오는 **매 렌더 파생값**이다. `taxBaseKey`·`applyStateData`·`applyBackupData` 무수정.
- **범위 밖(의도)**: 세율 적용 세액 · FIFO/후입선출 원가법 · 원가법 선택 토글(사용자가 LOFO 하나로
  확정) · 평균법 실현손익의 병기 · 매도 요약의 미실현분 합산(총손익 = 실현 + 미실현 카드는 만들지
  않는다 — 이중 계상 혼선).
- 검증: `npm run verify:tax` (94건 — §9 `resolveAvgBuyPrice` · §10 `computeSellTaxRow` · §11
  `computeSellRealized` · **§13 `buildLofoLotSeries`**(사용자 실측 3건 재현 + 소급 방지·순차 소진·
  부족·신뢰도·무일자 매도·부동소수 잔여) 참조 구현 미러 + **§12 렌더 배선 소스 텍스트 가드 #G1~#G14**).
  ⚠️ **`LOT_QTY_EPS` 임계 3곳 중 `matchedQty > LOT_QTY_EPS`는 도달 불가한 방어적 중복**이다(로트는
  `qty > EPS`인 것만 쓰이고 `rest > EPS`일 때만 집으므로 take는 항상 EPS를 넘는다) — 그래서 그 임계는
  `break` 임계와 **동시에** 무너뜨릴 때만 테스트가 실패한다. `break` 임계 단독 회귀는 **3번째(더 비싼)
  로트가 있는 픽스처**라야 잡힌다(로트가 소진돼 루프가 자연 종료되면 임계가 갈리지 않는다 —
  실제로 처음엔 죽은 단언이었다). 픽스처의 3번째 로트를 지우지 말 것.
  `src/krEtfTaxHelpers.ts` 본문과 `scripts/verify-kretf-tax.mjs`의 미러를 **항상 1:1 동기화**할 것
  (**#G11/#G12가 `computeSellRealized`·`buildLofoLotSeries`·`compareTaxEvents` 본문을 문자 단위로
  대조**해 한쪽만 고친 드리프트를 잡는다 — ⚠️ 파라미터 구조분해 `{ change, ... }`를 본문으로
  오인하면 어떤 드리프트도 못 잡는다).
  ⚠️ §12 가드는 **선언이 아니라 사용부**를 단언한다(셀 통째 삭제·값 바꿔치기·색 바인딩 제거를 잡아야
  한다). 나아가 **'존재'만으로는 부족한 계약 4종은 별도 방식으로 단언한다** — 우선순위는
  `indexOf` **순서 비교**(#G3), '해서는 안 되는 코드'는 분기 본문을 잘라 **부재**로(#G4의 매도 분기
  `buyAvg` 재대입, #G3의 `excludedSeen` 갱신), 게이트는 **래퍼⊇내부 포함관계**로(#G6),
  **문구는 구간을 잘라**(#G7의 `FOOT`/`TH_REALIZED`) 단언한다.
  ⚠️ **문구 가드를 파일 전역 정규식으로 되돌리지 말 것** — 같은 문장이 열 헤더 툴팁과 각주 양쪽에
  있어, 전역으로 재면 **각주에서 통째로 사라져도 초록**이 된다(변이 M10·M17로 실증한 죽은 단언).
  각주는 마우스를 올리지 않는 사용자가 이 값의 성격('분석용 원가법')을 알 수 있는 유일한 자리다.
  적대적 리뷰가 실증했듯 '존재' 단언만으로는 `resolveBasis` 두 줄 **맞바꾸기**·매도 분기 `buyAvg = 0`
  **추가**가 전부 통과한다. 변이 **총 32종**(LOFO 도입분 20종 + 리뷰 후속 12종)으로 검출을 실증했으므로,
  가드를 손볼 때 같은 변이가 여전히 잡히는지 다시 확인할 것.
  실패 시 **먼저 정규식이 낡았는지** 확인하고, 계약이 바뀐 게 아니면 정규식을 고칠 것.

### 메모 달력 (calendarMemos) — 헤더 달력 아이콘 → 날짜별 다중 메모 (⚠️ 회귀 주의)

헤더의 **달력 아이콘**(`AccountTabBar` 액션 아이콘 **우측 끝, 통합 대시보드·개별 계좌 모두
항상 노출** — `showIntegratedDashboard` 프래그먼트 밖에 배치해 어느 뷰에서든 메모 가능)으로 여는
**비차단·이동 가능 플로팅 창**(`CalendarModal.tsx`, 구글 캘린더식 월 그리드). 날짜 셀 클릭 →
사진 형식 메모 패드(핑크 X 취소 / 퍼플 체크 저장 / 날짜 / MEMO 그라데이션 / 줄선 textarea —
`RebalancingPanel`의 `noteExpandModal` 스타일 복제) → 저장 시 셀에 한 줄 표시, 한 줄 클릭 →
펼침/편집, 같은 날 **append 누적**(오래된 위 · 새 아래).

- **비차단·이동 가능 (⚠️ 회귀 주의 — FloatingCalculator/WatchlistPopup과 동일 규칙)**: 달력 창과
  메모 패드 모두 **백드롭 없는 단일 `position:fixed` div**라 아래 앱 클릭·스크롤이 통과한다(창을 열어
  둔 채 계좌 탭 전환·뷰 이동 가능). 각각 **타이틀 바만 드래그 핸들**(window mousemove/touchmove +
  뷰포트 클램프, 타이틀 바 100px는 항상 화면 안에 유지)로 **독립 이동**한다. 달력 창=`CAL_Z 1050`,
  메모 패드=`PAD_Z 1060`(dialog 1000 < 여기 < LoadingOverlay 1100). 드래그 핸들 내 버튼(이전/다음/
  오늘/닫기, 패드 X/체크)은 `onMouseDown stopPropagation`으로 드래그 시작을 막고 클릭만 처리.
  **`App.tsx` 최상위 형제로 마운트**(`FloatingCalculator`/`WatchlistPopup` 옆) → 탭/뷰 전환에도
  언마운트 안 됨(창 내부 상태·위치·열린 패드 유지, 닫기 전까지 지속). 재오픈(open false→true) 시에만
  이번 달 리셋 + 패드 닫기 + 창 중앙 재배치.
- **크기 (2026-07-29 확대 — 사용자 요청)**: `CAL_W 1200` / `CELL_H 180` / `CELL_MEMO_H 74`
  (`CalendarModal.tsx` 모듈 상수, `maxHeight 92vh`·`maxWidth calc(100vw-24px)`는 유지). **세 값은 한 세트**다 —
  칸이 칩 3줄(LIST/NOTE/STOCK 세로 스택) + 지표 3줄 + 메모 목록을 동시에 담아야 하므로 `CELL_H`를 줄이면
  칩이 메모를 밀어내고, `CAL_W`를 줄이면 칩의 계좌명이 truncate로 사라진다(칸 텍스트 가용폭 ≈ `CAL_W/7` −
  padding·border ≈ **160px**). ⚠️ 이전 규약("920/130/50에서 키우지 말 것")은 **폐기** — 그 근거였던 "칸만
  커지고 빈 공간만 넓어진다"는 칩이 가로 스크롤이던 시절 이야기이고, 1200×180은 1080p 세로에 한 달이
  그대로 들어온다(6주 달인 경우에만 창 내부 스크롤). **길게 쓰는 건 메모 패드뿐**: 달력 메모 `rows 28`,
  투자일기(`RebalancingPanel` noteExpandModal) `rows 30`. 패드는 세로가 길어 **고정 오프셋으로 배치하면
  아래가 화면 밖으로 잘린다** → ① textarea에 `maxHeight: calc(100vh - 160px)` 상한(초과분 내부 스크롤)
  ② `CalendarModal`은 `padSeq` 증가 → rAF에서 **실제 offsetHeight를 측정해 중앙 배치 + 뷰포트 클램프**
  (`centerPad` 같은 고정 오프셋 방식으로 되돌리지 말 것). `RebalancingPanel`은 상한이 있어 상단 5vh에서 시작.

- **데이터 모델**: 앱 레벨 `calendarMemos: { [YYYY-MM-DD]: { id, content, createdAt }[] }`
  (특정 포트폴리오에 종속 안 됨, `intHistory`와 동급). 하루 배열 `push`로 append → 표시 순서가
  곧 생성 순서(오래된 위/새 아래). 빈 메모는 생성 안 함, 편집 후 비면 삭제, 배열이 비면 날짜 키 제거.
- **영속화 5지점(⚠️ 신규 저장 필드 추가 시 동일 패턴 필수)**: ① `App.tsx` 저장 payload
  literal(`const state = {...}`)에 `calendarMemos` 포함 ② **`portfolioStructureKey`에 `JSON.stringify(calendarMemos)`
  지문 추가 — 없으면 `portfolioUpdatedAt` 미상승 → `useDriveSync` 저장 가드가 STATE 저장을 스킵**
  (`historyVerifyKey`/`isTest`와 동일 버그류) ③ 저장 effect deps에 `calendarMemos` ④ `applyStateData`
  (정식 Drive 로드 — 최신값 그대로 복원) ⑤ `applyBackupData`(백업 복원/파일 가져오기 — **sticky 규칙**,
  아래). localStorage 금지(사용자 데이터 → Drive STATE만, 멀티계정 오염 방지).
- **⚠️ 모든 STATE 저장 payload는 `{ ...saveStateRef.current, ... }` 스프레드로 구성** (⚠️ 회귀 주의 —
  필드 손나열 금지): `saveAllToDrive`는 STATE 파일을 통째로 덮어쓰므로(`stateCore` 전체 write) payload에
  없는 필드는 Drive에서 삭제된다. 과거 **수동 저장 버튼 `handleSave`·`handleDriveSave`가 부분 state를
  손으로 나열해 `calendarMemos`·`watchlistGroups`·`seenAdminNotifIds`를 누락** → "저장" 누르면 메모 달력이
  Drive·백업에서 유실됐다. 네 지점(`handleSave`·`handleDriveSave`·`handleDownloadStateFile`·`handleAppClose`)
  전부 `saveStateRef.current` 스프레드 필수(자동 저장 effect literal은 원본 소스라 예외 — 여기에 모든
  필드가 모임). 한국 ISP가 vercel.app 차단 → 로컬 파일 백업 의존이라 특히 중요.
- **⚠️ 복원 sticky 규칙 — `calendarMemos`·`watchlistGroups`는 과거 이력 복원에도 보존** (회귀 주의):
  메모 달력·관심종목은 포트폴리오 구성과 무관한 앱 레벨 개인 데이터라, **백업/파일 복원이 이를 되돌리지
  않는다**. `applyBackupData`(in-memory)와 `handleApplyBackup`/`handleImportStateFile`의 Drive write
  (`_preserveStickyPersonalData`, `useDriveSync.ts`)는 **현재 값이 있으면 유지**하고 **비어 있을 때만**
  백업/파일 값을 채택한다(신규 기기 이전·유실 후 복구는 가능, 기존 기록 덮어쓰기는 금지). 두 경로가 같은
  current(`saveStateRef.current` = 복원 직전 in-memory)를 참조해 결과 일치. `applyStateData`(정식 로드)는
  이 규칙에서 제외 — Drive STATE의 최신값을 항상 그대로 불러온다.
- **z-index/피드백 제약(⚠️)**: 달력 창 `CAL_Z 1050`·메모 패드 `PAD_Z 1060` 모두 `Z.dialog`(1000)·
  `ConfirmDialog`(1000)·`notify()` 토스트(z-999)보다 **위**라 창 위에서 confirm/notify는 가려진다.
  따라서 메모 삭제는 confirm 없이 즉시 삭제(셀에서 사라지는 게 피드백, `RebalancingPanel deleteNote`
  패턴). 창 내에서 confirm/notify 의존 금지.
- **UX 세부**: 백드롭이 없어졌으므로 **오클릭 닫기 없음** — 패드는 **X/Esc/저장(체크)** 로만 닫는다
  (비차단 통과 클릭이 텍스트를 지우지 않아 오히려 안전). Esc는 **패드만** 닫는다(비차단 배경 창을
  전역 Esc로 통째 닫지 않음 — 닫기는 창 X 버튼). textarea onKeyDown Esc가 `stopPropagation` 후 닫고,
  포커스가 딴 데 있을 때를 위한 전역 Esc 폴백은 `pad`를 deps에 넣어 클로저로 판별(패드 있을 때만 동작).
  날짜 키는 `${y}-${pad2(m+1)}-${pad2(d)}`로 직접 조립(TZ 안전, `new Date('YYYY-MM-DD')` UTC 파싱 금지),
  오늘 판정은 `getTodayKST()`. 주말(일 red/토 blue)·KR 공휴일(`useMarketCalendar` holidays.kr) 색상 +
  오늘 파란 배지.
- **날짜별 포트폴리오 스냅샷 표시 (display-derived, ⚠️ persist 무관)**: 각 셀은 날짜 아래 3줄 축약
  (총자산 억/만·그날 오늘수익 절대액+%·누적수익율), 메모 패드는 MEMO 헤더 아래 밴드에 풀 숫자
  (`총자산 / 수익 / 수익율 / 환율 / US10Y`)를 표시한다. **그 날짜의 실제 기록**만 표시(기록 없는
  날·미래는 스냅샷 없음). 손익 색상은 한국식(이익 red / 손실 blue).
  - **데이터 소스(전부 App.tsx에서 이미 계산됨 → props로 전달만)**: 총자산/오늘수익/누적수익율 =
    `intMonthlyHistory`(`evalAmount`/`dodAbsChange`+`dodChange`/`monthlyChange`, 날짜 키 = `date`).
    환율/US10Y = `indicatorHistoryMap.usdkrw`/`.us10y`(날짜→값), 오늘값은 라이브 `marketIndicators.usdkrw`/`.us10y`.
    비거래일 환율/US10Y는 `resolveOnOrBefore`로 직전 거래일값 carry-forward.
  - **파생값이라 저장 안 함**: `calendarMemos` 구조·영속화 5지점 **불변**(스냅샷을 메모에 박제하지
    않음 — 매 렌더 라이브 재계산). 새 저장 필드 추가 아님 → `portfolioStructureKey`도 무관.
  - **⚠️ 헤더 일치는 `latestRecDate` 기준(getTodayKST 아님)**: '오늘 칸 = 통합 헤더 카드 정확 일치'
    보장을 위해, `todayReturnRate`(=`intTotals.returnRate`) 누적 오버라이드와 라이브 환율/US10Y는
    **최신 기록일 셀**(`latestRecDate` = `intMonthlyHistory[0].date` = 헤더의 `todayRec.date` =
    `effectiveDate` 기준)에 적용한다. `getTodayKST()`(달력상 오늘, 파란 배지 전용)에 걸면 **00:00~07:30
    KST 구간**엔 `getEffectiveDate()`가 전일을 반환해 둘이 어긋나 → 오늘 칸이 비고 헤더 누적이 어느
    셀에도 안 뜨는 회귀가 난다(3개 리뷰어 독립 확인). 배지용 `isToday`와 헤더값용 `latestRecDate`는
    **분리 유지**.
  - **범위 밖(의도)**: 시세 로드 실패 시 `computedIntHistory` 이상치 가드(eval<전일 10%)가 전일값을
    carry-forward하면 셀 총자산(전일값)과 헤더(붕괴된 라이브값)가 갈릴 수 있으나, 이는 깨진 로딩
    상태로 carry-forward가 더 정확 → 미보정.

### 리밸런싱 목표비중 → 메모 달력 자동 기록 (`kind:'rebalTarget'`) (⚠️ 회귀 주의)

리밸런싱 표 **'목표(%)' 열 헤더의 날짜**(`settings.targetDate`)가 가리키는 메모 달력 칸에, 그 시점
목표 비중 스냅샷을 자동 기록한다. 사용자는 원래 이 날짜 칸에 "목표 비중을 조정한 날"을 손으로
적어 왔고(그 필드는 코드베이스 다른 어디에서도 쓰이지 않는 순수 기록용), 그 날짜의 달력에
`종목명 / 목표비중 / 현재수량 / 리밸런싱 후 수량 / 리밸런싱 후 평가금액`이 남기를 원했다.

- **저장 위치 = `calendarMemos` 배열 재사용**(신규 저장 필드 0개). 항목에 `kind:'rebalTarget'`을 달아
  일반 메모와 구분: `{ id, createdAt, updatedAt, kind, portfolioId, accountName, targetMode, investMode,
  currency, rows:[{name, code, targetRatio, curQty, expQty, expEval}], totalTargetRatio, totalExpEval, content }`.
  **영속화 5지점(state 리터럴·지문 `JSON.stringify(calendarMemos)`·저장 effect deps·`applyStateData`·
  `applyBackupData`)과 복원 sticky 규칙(`_preserveStickyPersonalData`)을 그대로 상속** → 전 지점 무수정.
  `content`(사람이 읽는 텍스트 사본)는 백업 JSON 가독성 + `firstLine(m.content)` 폴백용이라 **제거 금지**.
- **upsert 키 = `(dayKey, kind==='rebalTarget', portfolioId)`** — 같은 날 같은 계좌면 덮어쓰기(최신 1건).
  ⚠️ **교체 시 `id`·`createdAt`을 승계**해야 한다 — 칩 `key` 안정 + 열려 있던 읽기전용 패드(아래 memoId
  앵커)가 닫히지 않고 새 스냅샷으로 갱신된다. `settings`는 `updateSettingsForType`이 **같은 accountType
  계좌 전체에 동기화**하므로 `targetDate`가 계좌 간 공유된다 → 하루에 계좌별 기록이 여러 건 쌓이는 것이
  예외가 아니라 **기본 시나리오**(portfolioId로 분리).
- **⚠️ '헤더에 보이는 날짜 = 기록 날짜' 불변식 — 오늘로 폴백 금지**: `settings.targetDate`는 어디에서도
  초기화되지 않아 신규·레거시 계좌는 `undefined`다(헤더에 `날짜 지정` 표시). 그 상태에서 오늘 칸으로
  폴백하면 사용자가 지정한 적 없는 날짜에 조용히 기록된다 → `buildRebalTargetEntry`는 **커밋하지 않고
  dirty를 유지**해 날짜를 지정하는 순간 그 날짜에 기록되게 한다. 헤더는 미지정일 때 **앰버 테두리**로
  "여기에 날짜를 넣어야 기록된다"를 알린다.
- **⚠️ 날짜 유효성은 `utils.ts isValidIsoDate`(실제 달력 존재) + 연도 1900~2999**: 정규식만으로는
  `2026-13-45`가 통과하고, `CalendarModal`은 실제 날짜로만 셀을 그리므로 그 기록은 **화면에 영원히 안 보이고
  삭제도 못 하는 유령**이 된다. 적용 3곳 — `parseDisplayDate`(신규 유입 차단), `buildRebalTargetEntry`
  (기존 저장 손상값 + 네이티브 피커의 0001년 차단), `normalizeCalendarMemos`(로드 정규화).
- **목표 날짜 칩 = 세 구역**(⚠️ '단일 클릭=피커 / 더블클릭=직접 입력'으로 되돌리지 말 것):
  **왼쪽 여백 = 즉시 기록** · **가운데 날짜 = 직접 입력** · **오른쪽 여백 = 달력 피커**.
  ⚠️ **좌우 구역에 아이콘을 넣지 말 것**(사용자 요청 2026-08 — 넣었다가 되돌렸다): 칩이 커지고 날짜가
  작아 보인다. 여백은 비우고 **hover 배경**으로만 구역을 알린다(왼쪽 emerald · 오른쪽 회색 · 잠김 앰버).
  유일한 예외가 잠금 🔒(왼쪽). 날짜 span은 **`shrink-0`** 필수 — 칩이 `overflow-hidden`이라 좁은
  화면에서 날짜가 잘린다.
  - **⚠️ PIN 잠금은 `targetMode`와 무관하다**(`dateLocked = !targetEditAuthorized && !isAdmin`) —
    목표비중 셀의 `isFixedLocked`(고정 모드 전용)와 **다른 조건**이니 합치지 말 것. 날짜는
    `updateSettingsForType`으로 같은 accountType 전 계좌에 전파되고 기록은 그 날짜의 기존 기록을
    교체하는데 undo가 없어, 오클릭 한 번의 대가가 다른 셀보다 크다(사용자 요청 2026-08).
    세 구역 전부 `runDateAction`을 지나며 **fail-closed**(잠겨 있으면 실행 대신 PIN 요구), 인증은
    세션 단위 `targetEditAuthorized` 공유. ⚠️ PIN 통과 직후의 `showPicker()`는 **try/catch 필수** —
    사용자 제스처가 만료되면 던진다(그때는 잠금이 이미 풀려 재클릭으로 열린다).
  과거엔 기록을 남기는 통로가 '날짜를 다시 커밋해 dirty를 세우는' **더블클릭뿐**이었는데, 그 **첫
  클릭이 네이티브 피커를 열어** 두 번째 클릭이 피커의 날짜 칸에 떨어져 의도한 적 없는 날짜로 바뀌었다
  (사용자 보고 2026-08). 저장 경로를 왼쪽 구역으로 분리해 없앤 문제다.
  - **`App.tsx handleTargetSaveNow`**(prop `onTargetSaveNow`) — **dirty 여부와 무관하게** 기록한다.
    dirty는 '값이 실제 바뀐 편집'에서만 서므로, 목표는 그대로고 시세·수량만 움직인 **지금 상태를
    남기고 싶을 때 기존 경로로는 아무 일도 일어나지 않는다**. 대기 중인 날짜 디바운스는
    `flushRebalTargetSnapshot`으로 회수하므로 중복 발화가 없고, 날짜 유효성(`isValidIsoDate` + 연도
    1900~2999)은 `buildRebalTargetEntry`와 **같은 검사**를 미리 돌려 '헤더 날짜 = 기록 날짜' 불변식을
    지킨다(오늘 폴백 금지). ⚠️ 빌드 실패(행 0건 등)면 **dirty를 원상 복구**한다 — 명시 저장이
    실패했는데 dirty만 남으면 나중에 엉뚱한 시점에 기록된다.
  - **피드백은 칩 텍스트 1.5초 플래시**(`saved`✓기록됨 / `nochange`✓최신 / `nodate`날짜 먼저 /
    `fail`기록 불가). ⚠️ `notify()` 금지 — 알림 최소화 정책상 성공은 벨에 남기지 않는다(화면 변화가
    피드백). 타이머는 언마운트에서 정리한다(섹션 접기로 패널이 사라진다).
  - ⚠️ **칩에 `z-20`을 주지 말 것** — `hideStrip`(z-10)이 덮는 상단 4px이 열 숨기기 스트립의 몫이다
    (복원 아이콘만 z-20인 이유와 동일).
- **트리거 = dirty 게이트 + 4계열**(dirty는 App 레벨 ref — 리밸런싱 패널은 섹션 접기로 언마운트된다):
  ① **계좌 뷰 이탈** — `switchToPortfolioWithSnapshot`/`goIntegratedDashboard` 래퍼(AccountTabBar·
  IntegratedDashboard prop). ⚠️ `usePortfolioState`에 넘기는 **원본** `setShowIntegratedDashboard`는
  래핑 금지(계좌 삭제 등 내부 흐름). ② 저장 3핸들러 + ③ `handleAppClose` — payload에 **동기 주입**
  (`{...saveStateRef.current, calendarMemos: nextMemos}`; `setCalendarMemos`는 비동기라 `saveStateRef`가
  아직 옛 값). `handleSave`는 기록이 실제 생겼을 때만 `portfolioUpdatedAt`을 올려야 STATE 저장 가드를
  통과한다(historyVerifyKey 버그와 동류). ④ **목표 날짜 변경** — 800ms 디바운스(피커에서 여러 날짜를
  연속 클릭하면 클릭한 날짜마다 기록이 잔재. 이전 날짜 기록은 자동 삭제하지 않는 규약이라 필수).
  타이머에 소유 `pid`를 실어 발화 시 재검증하고, 커밋 지점은 `flushRebalTargetSnapshot`으로 회수한다.
- **⚠️ '앱 닫기'는 `handleAppClose` 하나가 아니다**: 브라우저 X·탭 닫기·새로고침·로그아웃은 전부
  `useDriveSync`의 `pagehide`로, alt-tab은 `visibilitychange(hidden)`로, 50분 비활동은
  `handleInactivityLogout`으로 흐른다. 세 곳이 `saveStateRef.current`만 저장하므로 **커밋 훅이 없으면
  기록이 영영 생성되지 않는다**(dirty ref는 메모리라 함께 소멸). → `useDriveSync({beforeExitSnapshotRef})`
  + 내부 `snapForExit()`가 그 3지점을 한 번에 덮는다(훅 미제공 시 동작 100% 동일).
  ⚠️ 종료 커밋은 **`saveStateRef.current`도 동기 갱신**한다 — 반환값 병합만으로는 부족하다(그 시점에
  이미 저장 중이면 `saveAllToDrive`가 조기 반환하며 `pendingSaveRef`에 **주입 전** 스냅샷을 담고,
  언로드라 리렌더가 없어 그대로 유실). **impersonation 탭 종료는 미커버**(`handlePageHide` admin
  early-return은 오폴더 저장 방지 안전장치라 건드리지 않음) — 관리자 탭은 탭 이동·저장 트리거에 의존.
- **⚠️ 커밋은 예외 격리 필수**: 저장·앱닫기·탭전환 **임계 경로의 첫 줄**에서 동기 호출되므로, 던지면
  `window.close()`·`switchToPortfolio`에 도달하지 못해 앱이 멈춘 것처럼 보인다. 3중 방어 —
  ① `commitRebalTargetSnapshot` 전체 try/catch(`null` 반환, ⚠️ `notify()` 금지 — 알림 최소화 정책)
  ② upsert `Array.isArray` 가드 ③ `normalizeCalendarMemos` 로드 정규화(`applyStateData`/`applyBackupData`).
- **⚠️ dirty 해제 규칙**: '내용 동일'이면 해제(무한 재시도 방지), **'날짜 미지정'이면 유지**(지정 시 기록).
  `sameRebalEntry`는 `content`뿐 아니라 **`rows` JSON + `totalExpEval`까지 비교** — content에는 평가금이
  없어 평가금만 달라진 스냅샷을 '변경 없음'으로 오판한다.
- **⚠️ `rebalCommitRef.current = buildRebalTargetEntry`는 effect가 아니라 렌더 중 대입**: blur(setState)와
  click 사이에 passive effect가 flush된다는 보장에 기대지 않기 위해서다(이 ref는 이벤트 핸들러·타이머
  에서만 읽힌다). `rebalExitCommitRef`도 동일.
- **⚠️ 값·순서는 화면 표와 1:1**: `expQty = quantity + action + extraQty`(예상 주식수 셀), `expEval =
  d.expEval`(예상평가금 셀), `targetRatio = d.effectiveTargetRatio`(목표 셀 `baseVal`). **행 순서도**
  리밸 정렬이 없을 때 화면과 같이 **카테고리 그룹 재배치**를 재현해야 패드의 '3.'과 표의 '3.'이 일치한다.
  수량 포맷은 `utils.formatNumber` **공유**(자체 포매터를 두면 펀드 좌수에서 자릿수가 갈린다).
  예적금(savings)은 수량이 없어 `curQty/expQty = null`(패드 `-`), overseas는 `currency:'USD'`로
  **원화 환산 금지**(환율 시점이 섞여 가짜 손익).
  ⚠️ 펀드의 `expEval` 0 문제(`usePortfolioData` `expEval`에 `evalAmount` 폴백 없음)는 **표 TOTAL·
  퇴직연금 D/S·도넛이 이미 공유하는 선행 버그** — 기록만 폴백시키면 "표=기록" 불변식이 깨지므로 손대지 말 것.
- **`RebalancingPanel` dirty 통지**: `reportAdminChange(opts)`가 `onAdminTargetChange`(관리자 알림,
  impersonation 중에만 non-null)와 `onTargetEdited`(달력 기록)를 함께 발화. 목표비중 `onBlur`만 분리 호출 —
  ⚠️ **변경 판정은 시세 파생 `baseVal`이 아니라 슬롯 원본 `slotVal`**로 한다(라이브 미러에선 `baseVal`이
  현재 비중이라 포커스~blur 사이 시세가 움직이면 오탐). **미러 이탈**(`override` 최초 박제)은 값이 같아도
  무조건 변경. `onAdminTargetChange`는 종전대로 **무조건** 호출(세션당 1회 규약 불변).
  **⚠️ 트리거는 '비중 조정'만이 아니다(2026-08 확장)** — 목표금액 3경로(셀 커밋·↺ 지우기·`(₩)` 미러)도
  같은 `reportAdminChange()`를 탄다. 금액이 비중을 무효화하는 상위 값이라 금액만 조정한 세션의 기록이
  비면 추적이 끊기기 때문(목표금액 섹션 참조). 유일한 예외는 **복원 경로**(INV-2).
- **`CalendarModal` 렌더**: 기록은 **사용자 메모 목록(`CELL_MEMO_H`)과 분리된 전용 세로 스택**에 emerald 칩
  `LIST {계좌명}`으로 렌더한다 — 한 목록에 섞으면 자동 기록이 사용자 메모를 밀어낸다. 개수 배지는
  **일반 메모만** 센다. 클릭 → **읽기 전용 표 패드**(`pad.kind==='rebalTarget'`): ⚠️ memo 객체를 값 복사하지
  말고 **`memoId` 앵커 + 라이브 재조회**(기존 편집 패드와 같은 계약) + 원본 소멸 시 자동 닫힘 effect
  (⚠️ `if (!open) return null`보다 **위**에 둘 것 — 훅 순서). `savePad`는 rebal이면 early-return, 저장(체크)
  버튼은 미렌더, `textarea value`는 `?? ''`. 삭제는 칩에 폭이 없어 **패드 안 '기록 삭제'** 버튼으로(창
  위에선 confirm/notify가 가려지므로 즉시 삭제).
- **⚠️ `onUpdateMemos`는 `calendarMemosRef`도 함께 갱신**: 미러 ref는 effect로 따라가 한 tick 뒤처질 수
  있고, 그 사이 커밋이 옛 값 기준으로 통째 교체하면 방금 저장한 메모가 지워진다.
- **범위 밖(의도)**: 목표 날짜를 바꿔도 **이전 날짜 기록은 자동 삭제하지 않는다**(사용자 선택 — 잘못
  남은 건 패드에서 직접 삭제). `settings.amount`/`useDepositAmount`/`mode` 변경은 dirty를 만들지 않는다
  (사용자가 확정한 트리거는 '비중 조정'). 기록 시점과 기록이 걸린 날짜가 다를 수 있어 패드에 `updatedAt`
  ('… 기록')을 함께 표시한다.

### 과거 목표비중 복원 = 달력 기록 → 현재 표 적용 (읽기 방향) (⚠️ 회귀 주의)

위 섹션의 '쓰기(스냅샷 기록)'에 대응하는 **읽기/적용** 기능. 리밸런싱 표 목표(%) 헤더의
**날짜 칩 오른쪽 📅 아이콘**(`CalendarClock`) → `RebalanceTargetRestoreModal`(미니 달력 + 기록 목록
+ 미리보기) → 날짜 선택 → `적용`. **교집합만 적용** — 현재 표에 있는 종목만 바꾸고, 기록에만 있는
종목은 무시, 표에만 있는 종목은 현재 값 유지(사용자 정의).

- **불변식 5개(전부 `npm run verify:rebal-restore` #25~#30이 소스 텍스트로 단언)**:
  **INV-1** 복원 경로는 `setCalendarMemos`/`onUpdateMemos`를 **절대 호출하지 않는다**(순수 읽기).
  **INV-2** `reportAdminChange`를 재사용하지 않는다 — `onTargetEdited`까지 발화해 dirty가 서면 INV-3이 깨진다.
  관리자 공지는 `onAdminTargetChange()`를 **직접** 호출(세션당 1건 래치라 추가 비용 0).
  **INV-3** dirty는 `handleTargetRestored`가 **헤더 날짜(`settings.targetDate`)가 비어 있지 않고,
  소스 날짜와 다르며, 그 날짜에 이 계좌 기록이 아직 없을 때만** 세운다(아래 전용 항목).
  **INV-4** `updateSettingsForType`를 **절대 호출하지 않는다**(같은 accountType 전 계좌에 전파된다).
  **INV-5** 쓰기는 `setPortfolio`(=`patchActive`, 활성 계좌 전용)로만 — **by-id 라이터를 만들지 말 것**
  (id 불일치 시 구조적 no-op이 곧 타 계좌 오적용 방어다).

- **⚠️ 기존 날짜 칩(`settings.targetDate`)을 복원 진입점으로 재사용하지 말 것 — 원본이 확정 소실된다**:
  칩 `onChange`(`RebalancingPanel.tsx`) → `reportAdminChange({date})` → `handleTargetEdited`가
  `if (!date) return`**보다 위**에서 dirty를 세우고 → 800ms 뒤 `commitRebalTargetSnapshot(그 과거 날짜)`
  → `findIndex`가 `(kind, portfolioId)`만 보고 그 기록의 `rows`를 **전면 교체**한다. `sameRebalEntry`는
  `rows` JSON·`totalExpEval`까지 비교하므로 **절대 못 거른다**(복원의 전제가 '과거≠현재'), `flushRebalTargetSnapshot`
  이 있어 800ms 회피도 불가능하다. 게다가 `updateSettingsForType`이 같은 accountType 전 계좌에 그 과거
  날짜를 전파해 **다른 계좌 기록까지 연쇄 파괴**한다. → 칩은 손대지 않고 **옆에 별도 아이콘**을 둔다.

- **⚠️ 복원은 '헤더 날짜에 기존 기록이 없을 때만' 기록한다 — 이게 이 기능의 최중요 안전장치**:
  커밋은 **소스 날짜가 아니라 헤더 날짜**(`buildRebalTargetEntry`의 `dayKey = overrideDate || settings.targetDate`)에
  쓰이고, upsert는 `(kind, portfolioId)`만 보고 그 날짜 기록을 **통째로 교체**한다. 그런데 기록은 언제나
  헤더 날짜에 만들어지므로 **'헤더 날짜에 기록이 있다'가 기본 상태**다. 여기서 dirty를 세우면 과거 기록을
  하나 불러올 때마다 **헤더 날짜의 다른 기록이 복원값 + 오늘 수량·평가금으로 덮여**, "그날 이 비중을
  목표로 삼았다"는 **거짓 이력**이 남는다(alt-tab의 `visibilitychange` → `rebalExitCommitRef`만으로도 발화).
  `calendarMemos`는 백업 복원 sticky라 **복구 불가**. → `handleTargetRestored`가 `calendarMemosRef.current[headerDate]`에
  이 계좌의 `rebalTarget`이 있으면 **dirty를 세우지 않는다**(표만 바뀌고 달력은 무변). 이력으로 남기려면
  사용자가 헤더 날짜를 **기록 없는 날**로 바꾸면 된다('헤더에 보이는 날짜 = 기록 날짜' 불변식 그대로).
  ⚠️ 모달 경고는 반드시 **이 조건**(`byDay.has(targetDate)`)에 붙여야 한다 — 과거엔 `targetDate === sel.dayKey`
  (파괴가 **일어나지 않는** 안전한 경우)에만 경고가 떠서 정반대였다.
- **⚠️ `handleTargetRestored`는 기존 dirty를 지우지 않는다**(App.tsx): 지우면 복원과 무관한 **대기 중
  편집**(blur로 dirty만 서고 아직 커밋 전)까지 소각돼 그 날짜 기록이 영영 안 생긴다(`commitRebalTargetSnapshot`
  첫 줄 `if (!dirty[pid]) return null`). 대기 중인 날짜 디바운스 타이머(`rebalDateTimerRef`)도 폐기하지 말 것.
  잔여 위험(복원 후 사용자가 **셀을 직접 고쳐** dirty가 서면 헤더 날짜 기록의 수량·평가금이 오늘 값으로
  갱신)은 **복원 기능이 없어도 존재하던 기존 동작**이며(헤더 날짜를 그대로 두고 목표를 고치면 항상 그렇다),
  모달이 앰버로 함께 고지한다.

- **⚠️ 슬롯은 스냅샷의 `targetMode`가 아니라 '현재' `settings.targetMode`**: `effectiveTargetRatio`가
  현재 모드 슬롯만 읽으므로(`usePortfolioData.ts`) 스냅샷 모드 슬롯에 쓰면 **화면이 1픽셀도 안 바뀐다**
  (=고장으로 보임). 모드를 맞추려 `updateSettingsForType`을 부르는 것은 INV-4 위반. 불일치는 **앰버 배너**로만.

- **⚠️ `overrideField = true`를 미러 상태와 무관하게 **항상** 쓴다 — 수동 blur와 의도적으로 다르다**:
  수동 blur는 `mirror==='on'`일 때만 override를 세운다. 복원에 같은 규칙을 쓰면, settings가 같은
  accountType 전 계좌 공유라 **형제 계좌에서 (%) 미러를 켰다 끄는 것만으로** 이 계좌의 override 없는
  슬롯이 `cycleMirror`의 `on→off` 분기에서 **현재 비중으로 영구히 덮어써진다**. 수동 입력값은 다시 치면
  되지만 복원값은 사용자가 의도적으로 채택한 과거 목표라 그 사고에서 보호해야 한다. 부작용은 리셋
  아이콘(`alwaysShowReset`) 상시 노출뿐이고, 그 툴팁('수동 편집됨')은 오히려 상태를 정확히 설명한다.

- **매칭 = `(code, name)` 2패스 + 1:1 유일성 강제**(`utils.ts matchRebalTargetRows`). 스냅샷 `rows[]`에
  **`id`가 없다**(`buildRebalTargetEntry`). ① 코드 `trim().toUpperCase()` 유일 일치 → ② 실패분만 이름
  `NFC + 소문자 + 공백정규화` 유일 일치(+ **`curQty === null` ⟺ 예적금** 타입 힌트로 savings↔stock 분리).
  ⚠️ **인덱스·순서 폴백 금지** — 스냅샷은 카테고리 재배치 순, 현재 표는 정렬 상태 순이라 서로 다르다
  (검증 #17이 rows를 뒤집어 단언). ⚠️ 애매하면(같은 코드·이름 2행) **임의 선택 대신 보류** —
  조용한 오적용보다 명시적 미적용이 낫다. ⚠️ 값 검증에 **`Number()`를 쓰지 말 것** — `Number(null)`/
  `Number('')`/`Number(false)`/`Number([])`가 전부 0이라 손상 행이 **목표비중 0%로 조용히 적용**된다.
  `typeof === 'number'` 선행 검사 필수(검증 #14). ⚠️ `normalizeCalendarMemos`는 `rows`를 검증하지 않으므로
  방어는 **소비 측에서만** — 로드 정규화를 강화하면 손상 판정된 기존 기록이 영구 삭제된다.

- **⚠️ 합계를 100%로 재정규화하지 말 것**: 합계<100%는 이 앱의 정상 상태다(`liveRatio` 분모
  `totals.totalEval`에 예수금 포함). 스케일링하면 패드의 `38.00%`와 표의 `39.42%`가 갈려
  **"기록 = 화면 1:1"** 불변식이 깨진다. tfoot 앰버 `diff`가 이미 차이를 표시한다.

- **⚠️ PIN 게이트**: 고정 모드는 `isFixedLocked`를 그대로 통과해야 한다(`onRequestPin` → 기존
  `RebalanceTargetPinModal`). 분기는 **fail-closed** — `if (locked) { if (onRequestPin) onRequestPin(cb); return; }`.
  `locked && onRequestPin`으로 묶으면 prop 하나만 빠져도 잠금이 통째로 열린다(검증 #32).
  PIN 모달에는 Esc 핸들러가 없으므로 복원 모달은 `pinPending`일 때 Esc·백드롭 닫기를 막는다 — 안 막으면
  뒤에서 창만 닫히고, 이어 PIN을 입력하면 **사용자가 취소했다고 믿은 복원이 그대로 적용**된다.
- **⚠️ z-index: 복원 1070 < PIN 1080, 둘 다 비차단 플로팅 창 위**: 메모 달력 1050(폭 **1200px**)·
  메모 패드 1060·관심종목/계산기 1050·투자기록 패드 1000/1010 **위**, `LoadingOverlay` 1100 아래.
  과거 560/600이었는데, 그러면 메모 달력을 열어 둔 채(비차단이라 계좌 전환에도 유지된다) 아이콘을 눌러도
  **창이 통째로 가려져 "아무 일도 안 일어난다"**. 특히 `CalendarModal` LIST 패드가 이 아이콘을 안내하므로
  그 경로가 정확히 이 조합이다. PIN < 복원이 되면 잠금이 사실상 우회된다. 검증 #30·#31이 두 값을 뽑아 비교.
- **⚠️ 미리보기 라벨은 원인 중립으로**: `matchRebalTargetRows`의 `skipped`에는 `missing`뿐 아니라
  `ambiguous`(현재 표에 **있는데도** 중복이라 보류)·`bad-value`·`bad-row`·`blank-key`가 섞인다.
  헤더를 '기록에만 있는 종목'으로 단언하면 사용자가 **미적용을 놓친다**(undo가 없어 미리보기가 유일한
  안전망이다). → `미적용 (N) · 기록에 있으나 적용하지 못한 행` + 항목별 사유 + `missing` 외에는 앰버 강조.
  반대편 `untouched`도 '기록에 없어서'가 아니라 단순 `현재 목표비중 그대로`로 쓴다(ambiguous 짝이 섞인다).

- **영속화 신규 지점 0곳**: 목표비중 4필드(`targetRatio`/`targetRatioVar`/`targetRatioOverride`/
  `targetRatioVarOverride`)가 이미 `portfolioStructureKey`(`App.tsx`)에 있어 복원 write만으로
  `portfolioUpdatedAt` 상승 → Drive STATE 저장이 자동 트리거된다(검증 #28이 4필드 잔존을 단언).
  `settings`·`calendarMemos`·state 리터럴·저장 effect deps·`applyStateData`·`applyBackupData`·
  `_preserveStickyPersonalData`·새 창 브릿지 **전 지점 무수정**. 같은 스냅샷을 두 번 적용하면 지문
  문자열이 동일해 저장이 재트리거되지 않는다(정상).

- **되돌리기(undo) 미제공(의도)**: 사용자가 '미리보기 후 적용'을 택했다. undo 상태를 두면 Drive 폴링
  (`applyStateData`)이 타 기기 편집을 받아온 뒤 눌렸을 때 그 최신값을 낡은 값으로 덮고, 패널이
  언마운트되는 조건(`!sectionCollapsed.rebalancing || !sectionCollapsed.donut`)에서 무음 소멸한다.
  미리보기가 안전망이다.

- **범위 밖(의도)**: ① 메모 달력 LIST 패드의 '적용 버튼'(안내 문구만 — 달력은 비활성·삭제 계좌 기록도
  보여주고, 별도 브라우저 창은 종목 정보를 안 받아 무반응이며, 창 위에선 PIN·확인창이 가려진다)
  ② 별도 브라우저 창에서의 복원 ③ 비활성 계좌 복원 ④ `ambiguous` 행 수동 매핑 UI ⑤ `rebalExtraQty` 초기화
  ⑥ 목표비중 열을 숨기면 진입점도 사라짐(그 상태에선 목표 편집 UI 자체가 없으므로 일관).
- **모달 내부 규약**: 보고 있는 달은 **파생값 + 덮어쓰기(`viewOv`)** — state 초기값을 상수로 두고
  effect에서 고치면 열 때마다 엉뚱한 달이 한 프레임 번쩍인다(이 컴포넌트는 `open` 토글만 되고
  언마운트되지 않아 첫 렌더가 옛 값으로 커밋된다). 날짜 폴백은 `getTodayKST()`(로컬 TZ `new Date()` 금지),
  날짜 키는 직접 조립(`new Date('YYYY-MM-DD')` UTC 파싱 금지). 열 때 패널에 포커스를 옮기고 닫을 때
  되돌린다 — 안 하면 Tab이 **백드롭 뒤에 가려진 목표비중 입력**으로 들어가 수시변경 모드(잠금 없음)에서
  보이지 않는 셀을 편집하게 된다.
- 검증: `npm run verify:rebal-restore` (참조 구현 미러 #1~#24 + 소스 텍스트 가드 #25~#32).
  ⚠️ 가드는 `RebalancingPanel.tsx`만 **주석을 남긴 원본**으로 읽는다 — 구간 경계가 `// #verify:` 주석이라
  `stripComments`가 지우면 구간을 못 찾는다. 따라서 **센티넬 구간 안에는 금지 토큰**(`onTargetEdited`·
  `reportAdminChange`·`updateSettingsForType`·`setCalendarMemos`)**을 언급하는 주석을 두지 말 것**
  (설명 주석은 시작 센티넬 위에).

### 목표금액(targetAmount) — 비중 대신 금액으로 수량 지정 (⚠️ 회귀 주의)

리밸런싱 표 **목표비중 바로 오른쪽**에 종목별 목표 평가금액 열을 둔다.
`수량 = Math.trunc((목표금액 − 현재평가금) ÷ 종목가격)` (양수 매수 / 음수 매도).
⚠️ `trunc`(0 방향 버림)이지 `floor`가 아니다 — 기존 비중 경로와 같은 규약을 쓰되, 이 열은 **매도(음수)가
상시 발생**하는 경로라 둘의 차이가 실제로 드러난다(소수 좌수 펀드는 목표 0원에도 1좌 미만 단수가 남는다).

- **⚠️ 적용 여부는 '투자선택'(`settings.mode`) 모드가 정한다 — 행별 자동 우선 아님**:
  `settings.mode = 'rebalance' | 'accumulate' | 'targetAmount'`(헤더 우측 상단 드롭다운, 3번째가 신설).
  **`'targetAmount'`일 때만** 금액이 수량을 만든다. **리밸런싱·적립식에서는 금액이 입력돼 있어도
  무시되고 목표비중이 적용된다**(사용자 확정 규약 2026-08). 과거엔 '행에 금액이 있으면 모드와 무관하게
  금액 우선'이었는데, 그러면 리밸런싱으로 돌아와도 그 행만 비중이 안 먹어 혼란스러웠다.
- **⚠️ 목표비중 슬롯이 투자선택별로 분리돼 있다 — `utils.resolveTargetSlots`가 유일한 결정 지점**:
  적립식은 `targetRatioAcc`/`targetRatioAccVar`(+ `…Override` 2개, 미러 `targetMirrorAccFixed`/
  `targetMirrorAccVar`), 리밸런싱·목표금액은 **기존 슬롯**(`targetRatio`/`targetRatioVar`…)을 쓴다.
  적립식은 '이번 적립금을 어떻게 나눌지'라 '자산 전체 목표 배분'과 의미가 달라서다.
  ⚠️ **값을 실제로 0으로 지우는 방식으로 되돌리지 말 것** — undo가 없고 달력에 기록해 둔 적 없는
  비중은 영구 소실된다. ⚠️ 슬롯을 손으로 다시 고르지 말 것(`usePortfolioData` 계산 / `RebalancingPanel`
  셀 편집·미러·복원 4곳이 같은 함수를 공유해야 화면과 계산이 안 갈린다).
  ⚠️ **미러 상태도 반드시 함께 분리** — 공유하면 리밸런싱에서 켠 라이브 미러가 적립식 슬롯까지 현재
  비중으로 추종한다.
  ⚠️ **영속화**: 신설 항목 필드 4개를 `App.tsx portfolioStructureKey`에 **전부** 넣어야 한다(하나만
  빠져도 그 슬롯 편집이 조용히 저장 안 됨). 미러 2개는 `settings` 안이라 `settings: p.settings`로 자동 포함.

- **⚠️ 읽기는 폴백, 쓰기는 현재 슬롯 하나 — `utils.readTargetRatio` (2026-08 신설, 회귀 주의)**:
  `resolveTargetSlots().readFields`가 우선순위 리스트(현재 슬롯 → 같은 투자선택의 반대 목표모드 →
  반대 투자선택 …)를 주고, `readTargetRatio(item, slots)`가 **처음 '설정됨'인 슬롯**을 채택한다.
  **쓰기는 절대 폴백하지 않는다**(항상 `slotField`) — 저장값 무수정이라 잘못돼도 되돌릴 수 있다.
  - **⚠️ 도입 사유(실제 사고)**: 2026-08-03 슬롯 분리 배포(`ed78d5e`)가 `targetRatioAcc`를 신설하면서,
    이미 적립식이던 계좌들의 기존 목표비중(`targetRatio`)이 **사용자 조작 0회로** 화면에서 0%가 됐다.
    당시 이 문서는 그것을 "배포 직후 동작(의도) — 모드를 리밸런싱으로 바꾸면 복귀"로 적어 뒀는데,
    실사용에서는 **관리자가 며칠 전 입력한 목표가 통째로 사라진 것으로 보였다**. 게다가
    `RebalancingPanel`의 마운트 effect가 레거시 `mode:'deposit-only'`를 **조용히 `'accumulate'`로**
    바꾸고 같은 accountType 전 계좌에 전파하므로, 사용자가 드롭다운을 만질 필요조차 없다.
  - **⚠️ 0%는 '미설정'이 아니라 '전량 매도' 지시다** — 리밸런싱 모드에서
    `action = trunc((overallExp×0 − curEval)/price)`. 빈 슬롯이 0%로 보이는 것은 표시 문제가 아니라
    **매매 지시가 뒤집히는 문제**다. 게다가 그 0%가 `buildRebalTargetEntry`로 달력 스냅샷에 박제되면
    (upsert 키 = dayKey·kind·portfolioId) **유일한 복구 기록까지 잃는다**(`calendarMemos`는 백업 복원 sticky).
  - **⚠️ `hasRatio`(타입 기반)로만 '미설정'을 판정한다** — `cleanNum(x) || 0`으로 재면 '미설정'과
    '사용자가 명시적으로 넣은 0%'가 같아져 **0% 목표가 폴백에 조용히 덮인다**(목표금액의
    `hasRawTargetAmount`와 같은 규약). 그래서 폴백은 값이 **아예 없는** 슬롯에서만 발동한다.
  - **⚠️ 셀 blur는 값이 그대로면 아무것도 쓰지 않는다**(`RebalancingPanel` 목표비중 셀, 목표금액
    `commitAmt`와 같은 규약). 무조건 쓰면 ① 이어받은 값이 칸을 Tab으로 지나가기만 해도 현재 슬롯에
    박제돼 폴백 링크가 끊기고 ② `portfolioStructureKey`가 바뀌어 Drive 전량 저장이 헛돈다.
    그리고 **`changed` 판정 기준(`slotVal`)은 반드시 폴백을 반영한 값**이어야 한다 — raw 슬롯으로
    되돌리면 이어받은 행이 **항상 '변경됨'**으로 오판돼, 칸을 클릭했다 나가기만 해도 dirty가 서고
    헤더 날짜의 달력 기록이 덮인다.
  - **알려진 한계(의도)**: 두 슬롯에 **서로 다른 값**이 들어 있으면 축을 바꿀 때마다 각자의 값이
    보인다(그 계좌는 실제로 나눠 쓴 계좌다). 폴백은 한쪽이 **비어 있을 때만** 개입한다.
  - **범위 밖(미적용)**: 투자선택 전환 확인창 · `cycleMirror`/`applyReset`의 시세 미확보 0% 박제 방지 ·
    달력 기록이 0% 스냅샷으로 덮이는 것 방지 · `resolveTargetSlots` 검증 미러 신설.
    ⚠️ `scripts/verify-rebal-restore.mjs`는 `resolveTargetSlots`·`readTargetRatio`를 **미러하지 않는다**
    (슬롯 분리·폴백은 현재 무검증) — 이 로직을 고칠 때 게이트가 잡아 주지 않으니 주의할 것.
- **⚠️ 자금 축은 리밸런싱과 동일**(`isLevelMode = mode==='rebalance' || mode==='targetAmount'`):
  총평가금 기준 · **예수금 전액** 사용, '사용할 예수금' 입력 미노출. 적립식만 `사용예수금 + 적립금` 축이다.
  `RebalancingPanel`의 자금 분기(헤더 패널 라벨·`headerDepositForBuy`·`headerInvestable`·
  `applyRemainingToDeposit`·요약 바 `depositLabel`)는 **전부 `isLevelMode`로 묶여 있다** —
  새 분기를 추가할 때 `=== 'rebalance'`로 손복제하면 목표금액 모드에서만 예수금이 빠져 잔액이 어긋난다.
- **⚠️ 금액 미입력 행은 '목표금액' 모드에서도 **리밸런싱과** 수량이 정확히 같다**: `effectiveTargetAmount`가
  힌트(=비중대로 매매하면 도달하는 평가금)로 폴백하고 그 식이 리밸런싱 식과 대수적 항등이기 때문이다.
  즉 **리밸런싱 → 목표금액** 전환은 금액을 안 넣으면 표가 1주도 변하지 않는다(안전한 전환).
  ⚠️ **적립식 → 목표금액**은 다르다 — 적립식은 '증분'(`allocBase×비중÷가격`), 목표금액은 '레벨'
  (`(목표−평가금)÷가격`)이라 수량이 전면 재산출된다. 이건 **적립식 → 리밸런싱 전환과 똑같은 정상 동작**
  이지 결함이 아니다. 여기서 수량이 변하는 걸 보고 `isLevelMode`/`isLevelBase` 극성을 되돌리지 말 것
  (되돌리면 목표금액 모드가 적립식 자금축을 써서 예수금이 통째로 빠진다).
- **⚠️ `usePortfolioData`의 비-금액 분기는 `=== 'rebalance'` 그대로 둘 것**: 마이그레이션 전 레거시
  값(`'deposit-only'`)이 기존처럼 적립식 식으로 떨어지게 하는 폴백 극성이다(`isAccumulate` 같은 반대
  극성으로 바꾸면 그 한 렌더 동안 수량이 달라진다).

- **저장 = 종목 필드 `item.targetAmount`**(Drive STATE 영속, `targetRatio`와 같은 등급).
  ⚠️ **`App.tsx portfolioStructureKey`의 항목 화이트리스트에 `targetAmount: item.targetAmount` 필수** —
  이 지문은 필드를 **손나열**하므로 빠뜨리면 목표금액만 고친 세션에서 `portfolioUpdatedAt`이 오르지
  않아 `useDriveSync`의 STATE 저장 가드가 저장을 통째로 스킵한다(historyVerifyKey·investmentNotesKey·
  calendarMemos와 **동일 버그 클래스** — 화면은 정상이라 며칠 뒤 조용한 세션에서만 재현된다).
  로드·정렬·계좌전환은 `...p`/`...item` 스프레드라 무수정.
- **⚠️ 커밋은 `handleUpdate`가 아니라 `setPortfolio` 직접** (`RebalancingPanel` 목표금액 셀):
  `handleUpdate`는 `cleanNum(value)`를 거쳐 **빈칸을 0으로** 만든다. 그러면 '미입력'과 '목표 0원
  (=전량 매도)'을 구분할 수 없어 둘 중 하나를 영영 표현하지 못한다. 저장값은 `''`(미입력) 또는 숫자이고,
  판정(`hasTargetAmount`)은 **저장 원시값의 타입**으로 한다(`number`면 `Number.isFinite`, `string`이면
  숫자 포함 여부). ⚠️ `String(x).trim() !== ''`만 쓰면 손상된 Drive 값(`true`·객체·`'abc'`)이 전부
  '입력됨'으로 통과하고 `cleanNum`이 그걸 0으로 만들어 **조용히 전량 매도**가 된다.
- **⚠️ 값이 그대로면 아무것도 쓰지 말 것**(`commitAmt` 조기 return): 빈 칸을 Tab으로 지나가기만 해도
  `targetAmount: ''`가 새로 박혀 지문이 바뀌고 **Drive 전량 저장이 돌며** `portfolio` 참조가 갈려 표
  전체가 재계산된다. blur마다 무조건 `setPortfolio`를 부르는 형태로 되돌리지 말 것.
- **⚠️ 힌트는 '비중대로 매매하면 도달하는 평가금액'** (`targetAmountHint`, `usePortfolioData`):
  **레벨 모드(리밸런싱·목표금액 = `isLevelBase`)** `overallExp × 비중`, **적립식** `curEval + allocBase × 비중`.
  두 모드의 기존 action 식이
  **레벨(목표 도달) vs 증분(이번 투입금 배분)** 으로 축이 다르기 때문이다. 이 정의라야 **힌트를 그대로
  입력해도 수량이 1주도 바뀌지 않는다**(양 모드 대수적 항등 — 표시값은 읽기 편하도록 반올림하므로
  정수 경계에서 1주 어긋날 수 있다). 적립식에 레벨 힌트(`overallExp × 비중`)를 쓰면 회색 값을 옮겨 적는
  순간 수량이 전혀 달라져 "금액을 넣으면 값이 튄다"가 된다. **예적금은 매매 자체가 없어 두 모드 모두
  힌트 = `curEval`**(비중을 곱하면 닿을 수 없는 금액이 Σ목표금액에 섞여 합계가 과대 표시된다).
- **⚠️ `price > 0` 가드는 분기 바깥에 유지**: 기준가 미로드 펀드(price 0)에서 Infinity/NaN이
  `cost`→`expEval`→`headerTotalBuy/Sell`→`rebalBalance`→`maxAdd`→`maxAddLink` effect의 `floor(pool/price)`를
  타고 **`rebalExtraQty`에 박히고**, 그 값은 계좌 전환에도 `accountRebalExtraQtyRef`에 보존된다.
- **⚠️ 예적금(savings)은 조기 반환 분기 그대로** — 시세·수량이 없어 매매 대상이 아니다(`action:0`,
  `expEval = curEval` 이월). 셀은 회색 참고값만 렌더하되 **반드시 `td[tabIndex=0]`** 로 둘 것:
  `utils.getRowFocusables`가 행 내 **위치 인덱스**로 ←/→ 이동을 계산하므로, 한 행만 포커서블 수가
  다르면 그 행부터 좌우 이동이 한 칸씩 어긋난다(`extraQty`의 savings 분기가 같은 이유로 `td[tabIndex=0]`).
- **⚠️ `action`은 `rebalExtraQty`를 참조하지 말 것**: `maxAddLink` 유지 effect의 pool은
  `잔액 + Σ_linked extra×price`인데, 이 pool이 **연동 행 자신의 extra에 불변**이라는 성질이 고정점
  보장(진동·무한루프 차단)의 근거다. action이 extra를 참조하는 순간 그 불변성이 깨진다.
- **열 추가 시 고칠 곳 = 4군데뿐**: `RB_COLS`(index 8, 미등록 시 열을 숨기면 **복원 칩이 없어 영구 소실**)
  + thead/tbody/tfoot **각 1셀씩**(tfoot을 빠뜨리면 TOTAL 행이 통째로 한 칸 밀린다).
  colSpan을 쓰는 곳은 이제 없다(아래 '같이 고친 표 결함' 참조 — 하단 요약·퇴직연금 바가 표 바깥으로
  나가면서 `retirementColSpan`·`absorbedCount`가 **삭제**됐다. 다시 만들지 말 것).
  `data-col="targetAmount"` + `handleTableKeyDown(e,'targetAmount')` 필수
  (안 바꾸면 ↑/↓가 목표비중 칸으로 튄다).
- **⚠️ 입력 초안(`editingTargetAmount`)에 계산값을 넣지 말 것**: 표시값은 `formatNumber`(콤마)인데
  onFocus 초안을 `String(effAmt)`(콤마 없음)로 넣으면 문자열이 달라져 React가 커밋에서 `node.value`를
  다시 쓰고, 그 대입이 **방금 건 전체선택을 풀어 캐럿을 끝으로 보낸다** → `1,000,000`에 `5`를 치면
  `10000005`가 된다. `e.target.value`(DOM 값 그대로)를 담아야 재대입이 없다(목표비중 셀과 동일 패턴).
- **⚠️ 안 쓰는 열은 '화면에서만' 자동으로 접고, 되살려도 편집은 잠근다**:
  `modeHiddenKey` = 목표금액 모드면 `targetRatio`, 그 외면 `targetAmount`. `H(k)`가
  **저장 숨김 ∪ 모드 숨김**을 반환하고, 칩 클릭은 `toggleColumnSmart`가 라우팅한다 —
  모드 숨김 열은 **저장 목록을 건드리지 않고 컴포넌트 로컬 `revealedCols`만 토글**하고,
  사용자가 직접 숨긴 열은 기존대로 `onToggleColumn`(Drive 저장)으로 간다.
  ⚠️ **모드 전환 시 `hiddenColumnsRebalancing`을 쓰지 말 것** — 사용자의 수동 숨김 설정을 덮어쓰고,
  `settings`는 같은 accountType 전 계좌 공유인데 `hiddenColumns`는 계좌별이라 두 축이 어긋난다.
  되살린 뒤에도 `ratioDisabled`/`amountDisabled`는 그대로라 **보이되 읽기 전용**이다(사용자 요구).
  ⚠️ 모드 비활성은 **PIN 잠금(`cellLocked`)과 다르다** — 풀 수 있는 잠금이 아니므로 클릭해도 PIN 모달을
  띄우지 않는다(`cellLocked && !ratioDisabled`로 게이팅). 목표비중이 비활성이면 **(%) 미러 버튼도 잠근다**.
  단 **📅 복원 아이콘은 살려 둔다** — 복원이 금액까지 되돌리므로 목표금액 모드에서도 필요하다.
- **표시 규약 = '지금 어느 열이 실제로 먹고 있는가'를 항상 보이게 한다**:
  ① **목표금액 모드**: 목표비중 열 전체가 `opacity-40` + 읽기 전용.
  ② **리밸런싱·적립식 모드**: 반대로 목표금액 열이 `opacity-40` + 읽기 전용이고 헤더·tfoot이 회색으로
  강등되며 tfoot 부제가 `비중 기준 · 미적용`이 된다.
  ③ **복원 모달의 `목표금액 우선` 배지는 `investMode` prop으로 게이팅** — 리밸런싱 모드에서는
  복원이 정상 적용되므로 배지를 띄우면 거짓말이 된다.
- **과거 목표비중 불러오기 = 비중 + 목표금액**: 스냅샷 `rows[]`에 `targetAmount`를 **명시 입력한 행만**
  기록하고(미입력 행은 비중 파생 힌트라 저장하면 사용자 지정과 구분 불가 → `null`),
  복원 시 함께 되돌린다. `matchRebalTargetRows`가 `amount`/`prevAmount`를 실어 보낸다 —
  ⚠️ 이 함수는 `verify:rebal-restore`가 **참조 구현으로 미러링**하므로 본문을 고치면
  `scripts/verify-rebal-restore.mjs`도 **같은 줄로** 고칠 것. 모달은 기록의 투자선택을 칩·경고로 표시하고,
  현재 투자선택과 다르면 "값은 현재 투자선택의 목표비중 열에 적용된다"를 앰버로 고지한다.
  `CalendarModal` LIST 패드 표도 5열 → **6열**(목표금액)로 함께 넓혔다(구버전 기록은 `-`).
  tfoot Σ목표금액은 각 행의 도달 평가금(입력값 또는 힌트) 합이다. 행 집합은 목표비중 TOTAL과 **동일**
  (예적금 포함·예수금 미포함)이나 예적금 몫만 비중이 아니라 평가금 그대로 들어간다.
- **달력 스냅샷 `investMode`는 3값**(`App.tsx buildRebalTargetEntry` ↔ `CalendarModal` 라벨 매핑).
  ⚠️ 한쪽만 고치면 '목표금액'으로 남긴 기록이 패드에 **'적립식'으로 표시**된다.
- **⚠️ 과거 목표비중 복원과의 상호작용**: 금액이 지정된 행은 비중을 복원해도 **수량이 1주도 안 바뀐다**
  (금액 우선). 이 기능은 undo가 없고 미리보기가 유일한 안전망이므로,
  `RebalanceTargetRestoreModal`이 해당 행에 앰버 **`목표금액 우선` 배지**를 띄운다. ⚠️ 이 플래그를
  `matchRebalTargetRows`(utils.ts)에 실어 보내지 말 것 — 그 함수는 `verify:rebal-restore`가 **참조 구현으로
  미러링**하므로 본문을 고치면 스크립트도 함께 고쳐야 한다. 모달은 `currentRows`(=`rebalanceData`)에서
  직접 파생한다(복원 불변식 INV-1~INV-5 무영향 — 달력 쓰기·dirty·settings에 손대지 않는다).
- **해외계좌**: `rebalanceData`의 `curEval`/`currentPrice`가 **USD(native)** 이고 `overallExp`도
  `nativeTotalEval + settings.amount`라 목표금액도 **USD**로 입력한다(헤더에 `($)` 표기, 툴팁에 원화 환산).
  ⚠️ 원화로 환산해 저장하지 말 것(환율 시점이 섞여 가짜 손익이 생긴다).
- **영속화 무관**: `hasTargetAmount`/`targetAmountHint`/`effectiveTargetAmount`는 전부 매 렌더 파생값이다
  (`rebalanceData` 내부). 저장되는 것은 `item.targetAmount` 하나뿐.
- **⚠️ 관리자 공지 + 메모 달력 기록을 **함께** 발화 (2026-08 사용자 요청 — 되돌리지 말 것)**:
  목표금액 **3경로**(셀 커밋 `commitAmt` · ↺ 지우기 · `(₩)` 미러 버튼 `cycleAmtMirror`)가 전부
  목표비중과 **같은 등급**으로 `reportAdminChange()`를 호출한다(= `onAdminTargetChange` +
  `onTargetEdited`). 목표금액은 목표비중을 무효화하는 상위 값이라 ① "관리자가 금액으로만 조정하고
  나가면 통지 0건" ② "목표금액만 조정한 세션은 헤더 날짜 칸에 기록이 한 건도 안 남아 언제 무엇을
  얼마로 바꿨는지 추적 불가" 둘 다 있어선 안 된다. 값이 실제로 바뀐 커밋만 여기 도달한다
  (`commitAmt`의 조기 return 2개가 '한 글자도 안 침'·'같은 값'을 걸러낸다 → 탭으로 지나가기만 하면
  dirty도 안 선다). 스냅샷 `rows[]`에 이미 `targetAmount`가 실리고(`buildRebalTargetEntry`)
  `sameRebalEntry`가 `rows` JSON을 비교하므로 **금액만 바뀐 변경도 기록된다**(`content`는 동일).
  ⚠️ **예외는 복원 경로 하나뿐** — `applyRestoredTargets`(센티넬 구간)는 여전히 `onTargetEdited`
  금지다(dirty가 서면 헤더 날짜의 원본 기록이 덮인다 — 복원 섹션 INV-2). 과거엔 이 규약이 목표금액
  3경로에도 걸려 있었으나, 그건 '복원'이 아니라 '사용자 편집'이라 근거가 달랐다.
- **⚠️ 셀 색 = 목표비중 열과 동일 규약 (2026-08 — "구분이 안 된다" 사용자 보고)**: 미러 추종
  `text-emerald-300/80 italic` / **사용자 지정 & 매매 필요 `text-red-400`** / 사용자 지정 & 목표 도달
  `text-green-400` / 미입력 `text-gray-400`. 과거엔 미러 추종(`emerald-300/80`)과 수동 지정
  (`emerald-300`)이 사실상 같은 색이라 **`(₩)`를 켠 뒤 자기가 고친 종목을 화면에서 식별할 수 없었다**
  (이탤릭 차이뿐). ⚠️ **판정 문턱은 `Math.max(itemPrice, 0.5)` = 1주 값** — `action = trunc((목표금액 −
  평가금) ÷ 가격)`이라 차이가 1주 값 미만이면 실제 매매가 0이다. 절대 epsilon(1원)으로 두면 시드
  직후 시세 한 틱에 전 행이 빨강이 되어 신호가 죽는다(목표비중 열의 `threshold 0.05`와 같은 역할).
- **범위 밖(의도)**: ① 펀드에서 `curEval`이 `evalAmount` 폴백인 경우(수량·기준가 미로드) `expEval`에는 폴백이 없어
  예상평가금이 목표금액과 어긋나고 보유 초과 매도가 나올 수 있다 — CLAUDE.md가 '손대지 말 것'으로 못 박은
  **선행 버그**라 산식을 고치지 않는다. ② 목표금액 열을 숨기면 저장된 값은 계속 수량을 지배하는데, 단서는
  흐려진 목표비중 셀뿐이다(두 열을 동시에 숨기면 단서가 없다).
  ③ **PIN 잠금(`cellLocked`) 미적용 — 사용자 결정(2026-08)**. 고정 모드에서 목표비중 셀이 잠겨 있어도
  목표금액 칸은 열려 있고, 금액이 비중을 무효화하므로 **잠금은 실질적으로 우회 가능**하다. 그럼에도
  열어 두는 근거: 이 PIN은 접근 통제가 아니라 오조작 방지 마찰이고(같은 로그인 PIN 해시를 다시 확인할
  뿐), **고정/수시변경 select에는 원래 PIN 게이트가 없어** 한 번의 클릭으로 목표비중 칸 자체를 여는
  기존 우회로가 이미 있다. 잠금을 붙이려면 그 select부터 막아야 한다 — 목표금액에만 붙이는 것은
  방어가 아니라 불편만 준다.

**목표금액 라이브 미러 `(₩)` — 목표금액을 현재 평가금에 연동 (⚠️ 회귀 주의)**

목표금액 헤더의 **`(₩)` 버튼**(해외계좌는 `($)`)이 목표비중의 `(%)`와 **같은 3단 사이클**로 돈다:
`off` →클릭→ `seeded`(현재 평가금을 목표금액에 복사) →클릭→ `on`(라이브 미러 — 목표금액 = 현재
평가금이라 **매매 수량이 전 행 0**) →클릭→ `off`(그 시점 평가금을 박제하고 해제). "현재 상태에서
출발해 필요한 종목만 금액을 고친다"가 이 기능의 용도다.

- **저장 2필드**: `settings.targetAmountMirror`(`'off'|'seeded'|'on'`) + 종목별 이탈 플래그
  `item.targetAmountOverride`. ⚠️ **`resolveTargetSlots`처럼 모드별로 나누지 않는다** — 금액 슬롯은
  `item.targetAmount` 하나뿐이라 고정/수시변경·적립식 분리가 없다.
  **영속화**: `settings`는 `portfolioStructureKey`에 통째로 들어가 자동, `targetAmountOverride`는
  **항목 화이트리스트에 추가 필수**(빠뜨리면 그 필드만 바뀐 세션이 조용히 저장 안 됨).
- **⚠️ `isAmountMode`를 반드시 함께 본다**(`usePortfolioData`): `isAmtLiveMirror = isAmountMode &&
  mirror==='on' && !item.targetAmountOverride`. 모드 게이트를 빼면 리밸런싱·적립식에서도
  `hasTargetAmount`가 전 행 true가 되어 **달력 스냅샷(`buildRebalTargetEntry`)이 '사용자가 지정한
  목표금액'으로 현재 평가금을 박제**하고, 그 기록을 나중에 복원하면 실제 지정값이 덮인다.
  판정은 `rebalanceData`가 실어 보내는 `isAmtLiveMirror`를 화면이 그대로 쓴다(손계산 금지 —
  표시와 수량 계산이 다른 기준을 읽는다).
- **⚠️ 시드/해제 write는 시세가 확보된 행에만**(`mirrorEvalOf` → `null`이면 금액은 건드리지 않고
  override만 정리): `qty>0`인데 현재가 0(펀드는 저장 평가금까지 0)인 행에 0을 박으면 **나중에 시세가
  들어온 순간 '목표 0원 = 전량 매도'** 가 된다. 라이브 미러(`on`) 자체는 매 렌더 재계산이라 안전하고,
  위험한 것은 **write뿐**이다. 헤더 버튼에도 `(%)`와 같은 `totals.totalEval <= 0` 가드를 둔다.
- **⚠️ 저장값은 `roundMirrorAmt`로 정리**(원화 1원 / 외화 1센트)하고, 셀 커밋 비교 기준(`prevNorm`)은
  저장 원시값이 아니라 **화면에 보이던 문자열**(`cleanNum(baseAmtText)`)이다. `formatNumber`가 소수
  3자리로 반올림하므로 시세 파생 실수를 원시값과 비교하면 **한 글자도 안 치고 탭으로 지나가기만 해도
  '변경'으로 오판**돼 라이브 미러에서 조용히 이탈한다.
- **셀 규약**: 미러 추종 행은 `text-emerald-300/80 italic`(비중 미러와 동일) + 지울 값이 없으므로
  ↺ 리셋 아이콘 숨김. 직접 입력하면 그 종목만 `targetAmountOverride: true`로 **수동 고정**, 비우면
  `false`로 되돌아 **미러 복귀**(이탈 행은 값이 없어도 ↺를 남겨 복귀 경로를 준다).
  ⚠️ **수동 고정 행은 반드시 미러와 다른 색**(빨강/초록 — 위 '셀 색' 항목). 둘 다 에메랄드로 두면
  미러를 켠 상태에서 자기가 고친 종목을 식별할 수 없다. 툴팁도 `수동 고정 — 라이브 미러에서 이탈한
  종목입니다 (↺로 평가금 연동 복귀)`로 분리한다.
  tfoot 부제는 미러 중이면 `평가금 연동 중 · 수동 N종목`(전 행이 `hasTargetAmount`라 '금액 지정
  N종목'이 의미를 잃는다).
- **⚠️ `cycleAmtMirror`도 `reportAdminChange()`를 호출한다**(2026-08 변경 — `onAdminTargetChange`만
  부르던 것에서 전환): 3전이가 전부 **금액을 실제로 write**하거나(seed·해제 박제) 수량을 만드는 축을
  바꾸므로 목표비중 `cycleMirror`와 같은 등급이다 → 관리자 공지 + 메모 달력 기록을 함께 발화.
  ⚠️ 이 예외 금지는 이제 **복원 경로(`applyRestoredTargets`) 하나뿐**이다(INV-2).
- **⚠️ PIN 게이트를 붙이지 말 것** — 위 ③(목표금액 축 잠금 미적용)와 같은 근거. 셀은 열려 있는데
  미러만 잠그면 방어가 아니라 불편만 준다. 대신 `amountDisabled`(=목표비중 기준 모드)일 때는
  회색·no-op으로 잠근다.
- **⚠️ 복원(`applyRestoredTargets`)은 금액에도 `targetAmountOverride: true`를 함께 쓴다** — 미러가
  켜져 있으면 복원값이 곧바로 현재 평가금에 덮여 **"복원했는데 화면이 1픽셀도 안 바뀐다"** 가 된다
  (비중 슬롯의 `overrideField`를 항상 true로 두는 것과 같은 근거). 센티넬 구간(`#verify:restore-apply-*`)
  안이므로 금지 토큰(`onTargetEdited`·`reportAdminChange`·`updateSettingsForType`·`setCalendarMemos`)을
  주석에도 넣지 말 것.
- **알려진 한계(의도)**: `settings`가 같은 accountType 전 계좌 공유라 **미러 상태도 공유**된다
  ((%) 미러와 동일). 첫 클릭(`seeded`)이 그 계좌의 기존 목표금액을 현재 평가금으로 덮어쓰는 것도
  (%)와 같고 undo가 없다 — 툴팁이 "클릭 1: 현재 평가금을 목표금액에 복사"로 미리 고지한다.
  형제 계좌의 항목을 쓰지는 않는다(`setPortfolio`=`patchActive`는 활성 계좌 전용).

**같이 고친 표 결함 3건 (⚠️ 회귀 주의)**

- **하단 요약(투자가능금액·매수 금액·잔액)과 퇴직연금 D/S 바를 표 바깥으로 이동**.
  요약은 원래 **'실 구매비용' 열의 `<td colSpan>` 안**에 있어서 ① 그 열을 숨기면 **요약이 통째로
  사라졌고** ② 열이 많아 가로 스크롤이 생기면 오른쪽으로 밀려 화면에서 사라졌다. 퇴직연금 바도
  colSpan 행이라 같은 문제였다. 둘 다 `overflow-x-auto` 컨테이너 **밖의 일반 `<div>`** 로 옮겨
  **열 구성·가로 스크롤과 완전히 무관**해졌다. tfoot TOTAL 행에는 각 열의 빈 `<td>`만 남는다.
  ⚠️ 다시 tfoot 안으로 되돌리지 말 것 — 두 결함이 그대로 재발한다. ⚠️ 이 이동으로 `retirementColSpan`·
  `absorbedCount`(그리고 `H('cost')`일 때 4개 빈 td를 채워 주던 보정 분기)가 전부 필요 없어져 삭제됐다.

- **표 헤더가 앱 상단바 위로 새어 나오던 문제** → 표 스크롤 래퍼(`overflow-x-auto`)에 **`isolate`**.
  원인은 sticking이 아니라 **페인트 순서**다: 앱 상단바가 `sticky top-0 z-30`(`App.tsx`)인데 이 표의
  좌측 고정 헤더도 `z-30`이라, 동률에서는 **DOM 뒤쪽인 표가 위에** 그려졌다(스크롤 중 `종목명` 헤더가
  상단바를 뚫고 보임). `isolate`가 래퍼에 스태킹 컨텍스트를 만들어 표 내부 z를 통째로 격리하면서도
  **내부 서열(고정 헤더 z-30 > 일반 헤더 z-20 > 본문 z-5)은 그대로** 유지한다.
  ⚠️ **개별 th의 z를 낮추는 방식으로 되돌리지 말 것** — 고정 헤더를 z-20으로 내리면 가로 스크롤 시
  DOM 뒤쪽의 일반 헤더(z-20)와 동률이 되어 종목명 헤더가 가려진다(세로 스크롤만 테스트하면 못 잡는다).
  ⚠️ `isolate`는 **표 래퍼에만** — 카드 div에 걸면 그 안의 요소까지 갇힌다(모달 4종은 이 래퍼 밖이라 무관).
- **'추가' 칸에 마이너스를 못 치던 문제** → 문자열 초안 `editingExtra` 도입. `parseInt('-')`가 `NaN → 0`이
  되고 controlled value가 즉시 `''`로 되돌려 **부호를 찍는 것 자체가 불가능**했다(도움말에는 "음수 입력
  가능"이라고 적혀 있었는데 실제로는 안 됐다). ⚠️ `rebalExtraQty`에 저장하는 값은 **반드시 number** —
  문자열로 두면 `(수량 + action + extraQty) * price`가 문자열 결합이 되어 예상평가금·매수/매도 합계·
  추가가능 풀이 전부 오염된다(타입체크 없는 빌드라 컴파일러가 못 잡는다).
  ⚠️ onChange는 **유니코드 마이너스류(`−`·`–`·`—`·`－`)를 ASCII `-`로 먼저 정규화**한다 — 안 하면
  붙여넣은 `−5`에서 부호만 사라져 **매도가 매수로 뒤집힌다**. 연동(`maxAddLink`) 토글 시에는 초안을
  폐기해야 연동으로 채운 값이 낡은 초안에 가려지지 않는다.

### 메모 달력 = 5종 기록 허브 (칩 버튼) (⚠️ 회귀 주의 — 파생 3종을 calendarMemos에 복사 금지)

날짜 칸에 **버튼식 칩** 4종(+사용자 메모 줄)을 띄워 "누르면 내역을 보거나 기록할 수 있게" 한다(사용자 요구).

칩은 **세로로 1줄씩**(위→아래) 쌓이고 순서·라벨이 고정이다(2026-07-29 사용자 확정) — 종류가 항상 같은
줄 위치·같은 라벨로 오므로 칸을 훑을 때 한눈에 구분된다. 패드 헤더 라벨도 같은 이름을 쓴다.

| 순서 | 칩 라벨 | 종류 | 소스 | 성격 |
|---|---|---|---|---|
| 1 | `LIST` emerald | `rebalTarget` | `calendarMemos[date]` | **스냅샷**(위 섹션). 그 시점 시세·수량을 사후 재현할 수 없어 유일하게 복사 저장 |
| 2 | `NOTE` amber | `note` | `portfolios[].investmentNotes` | **라이브 파생** — 보기·편집·새 작성 |
| 3 | `STOCK` violet | `qty` | `portfolios[].holdingSnapshots` 인접 diff | **라이브 파생** — 읽기 전용 |
| 4 | `MOVE` cyan | `transfer` | `portfolios[].depositHistory(2)`의 `transfer` 태그 | **라이브 파생** — 읽기 전용(아래 '종목 계좌 간 이관') |
| — | (라벨 없음) sky | (kind 없음) | `calendarMemos[date]` | 기존 사용자 메모 — 칩이 아니라 아래 텍스트 줄 목록 |

- **⚠️ 패드 헤더 라벨은 칩 라벨과 동일**(`CalendarModal` `pad.kind` 맵): `rebalTarget:'LIST'` ·
  `note:'NOTE'` · `qty:'STOCK'` · `transfer:'MOVE'` · `pick:'PICK'` · **`detail:'ASSET'`**(칩이 아니라
  칸의 자산 스냅샷에서 연다 — 아래 전용 섹션) · 사용자 메모 `'MEMO'`. rebalTarget이
  예전 `'TARGET'`을 쓰고 `pick`이 `'LIST'`를 점유하던 배치로 되돌리지 말 것 — 어느 칩에서 연 패드인지
  대응이 끊긴다. 이모지(📊📝🔄🔁)는 **패드 본문·pick 목록에만** 남기고 칸의 칩에서는 뺐다(텍스트 라벨과
  중복이고 폭을 ~14px 먹는다).
- **칩 4줄이 되면 칸이 빡빡하다**(지표 3줄 + 칩 4줄 + 메모 74px ≈ CELL_H 180). 칸은 `minHeight`라
  넘치면 늘어나고, 4종이 한 날에 모두 뜨는 것은 드문 경우다. 5번째 칩을 더 늘린다면 `CELL_H`를 함께 올릴 것.

- **⚠️ 파생 3종(note·qty·transfer)을 `calendarMemos`에 복사하지 말 것** — 복사하면 리밸런싱 패널 '투자 기록'
  메모장·자산검증 스냅샷·입출금 원장과 갈라져 두 화면이 다른 값을 보인다. 반드시 원본에서 매 렌더 재조회한다
  (`notesByDate`/`qtyChangesByDate`/`transfersByDate` `useMemo`, **`open`일 때만 계산** — `portfolios`는
  시세 갱신마다 새 배열).
- **⚠️ 삭제 계좌(`deletedAt`)를 파생에서 제외하지 말 것**: 달력은 라이브 뷰가 아니라 **과거 기록 뷰**이고
  같은 칸의 📊 칩은 `calendarMemos`라 삭제와 무관하게 남는다. 제외하면 한 셀 안에서 규칙이 모순되고
  계좌 하나 삭제로 과거 몇 달치 칩이 소급 증발한다. → **포함하되 칩 색만 회색으로 강등**.
  (`qty`만 `cur.date >= deletedAt` 컷오프 — 삭제일 이후 기록 동결 규약)
- **⚠️ 수량 변경 diff는 `kind:'manual'`을 반드시 인지할 것**: 스냅샷 종류는 baseline/auto 둘이 아니라
  **`manual`(자산검증 `VerifyEvalModal.withManualSnapshot`)이 더 있고 과거 임의 날짜에 삽입**된다.
  cur 배제 조건은 **① 인덱스 0 ② `cur.kind==='baseline'` ③ `cur.date <= baselineDate`의 OR**.
  ⚠️ ②만 쓰면 안 된다 — baseline 당일을 편집하면 그 kind가 `manual`로 덮여 baseline이 사라진다.
  `origin:'manual'`은 매매가 아니라 수량 정정이므로 패드에 그 사실을 명시한다.
- **칩 압축(⚠️ 되돌리지 말 것)**: 종류당 **1건이면 계좌명, 2건 이상이면 건수**(`LIST 3건`)로 접고 클릭 시
  `pick` 선택 패드를 띄운다. 셀 텍스트 가용폭이 **≈160px**(CAL_W 1200 → 7열 → padding/border/라벨 차감)
  뿐이라 계좌 수만큼 칩을 늘리면 칸 높이가 계좌 수에 비례해 터진다. `targetDate`가 같은 accountType끼리
  공유되므로 하루 다건은 예외가 아니라 기본 시나리오.
- **PICK → 상세는 '한 단계 뒤로'(2026-08 사용자 확정)**: 목록을 거쳐 연 상세 패드는 `pad.backPick`
  (= 되돌아갈 `pickKind`)을 달고 열리고, **핑크 ✕ / Esc가 그 목록으로 복귀**한다(핑크 버튼 글리프도
  `X` → `ChevronLeft`로 바뀌어 "닫힘"이 아님을 알린다). 1건 칩에서 바로 연 상세·PICK 자신·사용자
  메모는 `backPick`이 없어 **종전대로 완전 닫기**.
  ⚠️ **✕와 Esc는 반드시 같은 `dismissPad`를 공유할 것** — 갈라지면 같은 취소 제스처가 두 결과를 낸다.
  ⚠️ 되돌아갈 목록은 값 복사가 아니라 **`pickPad(dayKey, pickKind)`로 재구성**한다 — note·qty·transfer는
  라이브 파생이라 목록 스냅샷을 들고 뒤로 가면 원본이 바뀐 뒤 목록만 옛 값으로 갈라진다(패드 앵커 계약 동일).
  ⚠️ **저장(퍼플 체크)·삭제·앵커 소멸 자동 닫힘은 '완료' 동작이라 그대로 완전 닫기** — 여기 묶지 말 것
  (삭제 후 목록으로 돌아가면 항목이 0건인 빈 상자만 남는다). `note` 패드의 ①②③ 전환·drafts 규약도 무영향
  (`setPad(prev => ({...prev, …}))` 스프레드가 `backPick`을 그대로 보존).
- **⚠️ 칩 컨테이너를 `overflow-x-auto`(가로 스크롤)로 되돌리지 말 것**: 세로 스택 이전 설계였는데,
  칩이 2개만 넘어가도 나머지는 6px 스크롤바로만 닿을 수 있어 사실상 숨겨졌다(사용자가 직접 지적).
  컨테이너는 `flex flex-col gap-0.5 shrink-0`, 칩은 `w-full` + 라벨 `shrink-0` / 계좌명 `flex-1 min-w-0 truncate`.
- **⚠️ `savePad`는 allow-list(default deny)**: kind가 늘어날 때 읽기 전용 패드가 사용자 메모 저장 경로로
  새면 `memoId`를 `calendarMemos`에서 못 찾아 **조용히 닫히며 편집이 유실**된다. `note`와 `mode:'new'+
  newKind:'note'`만 통과시키고 나머지 kind는 전부 `setPad(null)`. 저장 버튼도 `(!kind || kind==='note')`에만 렌더.
- **투자기록 패드의 `val` 계약**: `val === null` = 미편집 → **라이브 본문 표시**(`padTextValue`).
  본문을 비우면 삭제(메모 패드 규약 동일).
  ⚠️ 같은 날 다건일 때 헤더 ①②③ 전환은 **탐색이지 취소가 아니다** — 떠나는 기록의 미저장 편집을
  `pad.drafts[noteId]`에 담아 두고 `saveNotePad`가 **누적 draft를 한 번에 커밋**한다. `val:null`로만
  리셋하면 "2번 흘긋 보려다 1번 편집이 경고 없이 증발"한다(창 위에선 confirm/notify가 가려져 사후
  경고도 불가). 취소 의미가 명시적인 핑크 X/Esc만 draft까지 폐기한다. `drafts`는 패드 로컬 state라
  영속화 지점 무관.
- **⚠️ 수량 변경 패드의 예수금은 계좌 통화로 표기**(`padQty.currency`): 해외계좌는 `depositAmount`
  **자체가 USD**다(`calcPortfolioEvalDetail`의 deposit 분기가 fxRate를 곱하는 대상). ₩로 하드코딩하면
  $2,000이 ₩2,000으로 보여 약 1,390배 어긋난다. 원화 환산은 금지(환율 시점이 섞인다 — 해외계좌 규약).
- **📊 패드는 같은 날·같은 계좌의 투자기록을 함께 표시**(사용자 요구: "리밸런싱 내역을 클릭하면 계좌의
  리밸런싱 내용과 투자 기록에 남긴 내역을 볼 수 있어야"). ⚠️ 거기서는 **읽기 전용** — 편집은 📝 칩에서만
  (저장 경로가 둘로 갈리지 않게).
- **⚠️ 선행 버그 3건 동시 수정(회귀 시 재발)**:
  ① `RebalancingPanel.addNewNote`가 `new Date().toISOString()`(UTC) → 한국 **00:00~09:00에 쓴 기록이
  '어제' 칸**에 꽂혔다. `getTodayKST()`로 통일(달력 `dayKey`도 KST 로컬 조립).
  ② `App.tsx investmentNotesKey`가 `id:date`만 담아 **본문만 고치면** `portfolioUpdatedAt`이 안 올라
  Drive STATE 저장이 스킵됐다 → JSON 전문 포함. ⚠️ 길이 해시 절충안 금지(동일 길이 편집을 놓친다).
  ③ `App.tsx holdingSnapshotsKey`가 `date:kind:개수`만 담아 **같은 날짜 스냅샷의 수량만 재편집**하면
  저장이 스킵됐다 → `snapshotCompositionKey(s.items)` 포함(시세는 제외라 갱신이 저장을 유발하지 않음).
- **비활성 계좌 편집**: `usePortfolioState.updateInvestmentNotesFor(portfolioId, notes)` — `patchActive`는
  활성 계좌 전용이라 달력에서 다른 계좌 기록을 고칠 수 없다. 기존 `updateInvestmentNotes`(활성)와 병존.
- **영속화 무수정**: `investmentNotes`·`holdingSnapshots`는 계좌 내부 필드라 `...p` 스프레드로 자동 보존.
  `_preserveStickyPersonalData`(calendarMemos·watchlistGroups 전용) 대상이 **아니다** — 백업 복원이
  계좌 데이터를 되돌리는 것이 맞다.
- **알려진 한계(수량 변경)**: KR 계좌 스냅샷은 21:00 이후 **내일 날짜**로 찍혀(`getBackfillBoundaryKR`)
  밤 매매가 하루 뒤 칸에 뜬다(자산검증 규약이라 변경 금지). 같은 날 여러 번 고치면 스냅샷이 덮어써져
  **그날의 순변화만** 보인다. 예적금은 수량이 없어 `investAmount`(적립 원금) 변화로 대신 본다.

### 종목 계좌 간 이관 (transfer) — 원장 3행 구성 (⚠️ 회귀 주의 — 종목만 옮기지 말 것)

포트폴리오 표 종목 행의 **이관 아이콘**(휴지통 왼쪽, `PortfolioTable` 인라인 `TransferIcon`)으로
종목 + 그 종목에 귀속된 계좌별 기록을 다른 계좌로 옮긴다. 진입점은 `StockTransferModal`
(**미리보기 후 적용** — undo 없음, z **1070**: 메모 달력 1050·패드 1060 위 / LoadingOverlay 1100 아래).

- **⚠️ 이 기능의 위험은 UI가 아니라 회계다.** 종목만 옮기면 이관일에 원계좌는 평가액 전액이 **가짜 손실**,
  대상계좌는 **가짜 이익**으로 찍히고, 수익률 라인이 누적 TWR(곱셈 체인)이라 그 하루가 **이후 전 구간에
  영구 고정**된다. 그래서 이관을 "원계좌 출금 + 대상계좌 입금"이라는 **실제 자금 이동**으로 원장에 기록한다.
- **원장 3행 (⚠️ `utils.buildTransferLedgerRows` — 조합을 바꾸지 말 것)**. M=시가, C=매입원가, G=M−C:

  | 계좌 | 원장 | amount | principalDeducted | principal 필드 |
  |---|---|---|---|---|
  | 원계좌 | 출금 | **M** | **C** | `−= C` |
  | 대상계좌 | 입금 | **M** | — | `+= C` |
  | 대상계좌 | 출금 | **0** | **G** | 변동 없음 |

  출금 행은 `principalDeducted`로 "흐름 M · 원금 C" 분리를 네이티브 지원하지만 **입금 행에는 대응 필드가
  없어** amount 하나가 둘을 동시에 결정한다 → 입금은 M으로 넣고 차액 G를 **금액 0 · principalDeducted=G**
  행으로 상쇄한다. 금액이 0이라 흐름에 전혀 기여하지 않고(`externalFlowInRange`·통합 ①의 `v>0/v<0` 어느
  분기에도 안 걸린다) `cumDepositsUpTo`만 G를 빼 원금이 M−G=C가 된다. G=0이면 행을 만들지 않는다.
  ⚠️ **보정 행을 `amount: -G`(음수 출금)로 되돌리지 말 것** — 이익 포지션에서는 유입 C+G=M으로 맞지만
  **손실 포지션(G<0)에서는 양수 출금**이 되어 유입 C·유출 |G|로 갈라진다. 순흐름은 M이라 일간 '손익'은
  맞지만 일간 '수익률' 분모가 `전일V+M`이 아니라 `전일V+C`가 되어 이익/손실 규약이 갈리고 TWR에 고정된다.
  ⚠️ `noPrincipal`을 쓰지 말 것 — 입금의 noPrincipal은 흐름 IN에서도 빠지고(배당·이자 규약), 출금의
  noPrincipal은 원금에서만 빠져 흐름엔 전액 남는다. 둘 다 이관 의미와 다르다.
- **이 구성이 지키는 것**: 원금 산출 4경로(`finalChartData` epochBase 역산 / `computeEffectivePrincipal` /
  `overseasPrincipalAt` / `useIntegratedData effectivePrincipal`)의 **과거 값 전부 불변**, 통합
  effectivePrincipal의 원계좌 +G와 대상계좌 −G가 **정확히 상쇄**, 이관일 일간 손익 = 개별 시장분만 / 통합 0.
- **⚠️ 기록일 = `getBackfillBoundaryForAccount(accountType)`** (자동 스냅샷 효과가 쓰는 그 날짜).
  `getTodayKST`·`effectiveDateKey` state 금지 — 원장/스냅샷/평가액이 같은 날 함께 움직여야 한다.
  21:00 이후 KR 이관을 오늘로 찍으면 그날 `bookDelta=0` vs 흐름 −M → 오탐 보류 → **다음 날 이월이 한 번 더
  차감돼 부호가 뒤집힌다**(CLAUDE.md '고친 결함 (A)' 재현).
- **⚠️ 이관 금액 M = 수량 × '직전 기록일 종가'**(`App.tsx buildTransferPlan` → `calcPortfolioEvalDetail`).
  화면의 실시간 평가금액이 아니다 — 장중 이관이면 그 종목은 당일 V에서 통째로 빠지므로 마지막 기여분이
  직전 기록일 종가다. 실시간가를 쓰면 그날 장중 등락분이 양쪽에 반대 부호의 가짜 손익으로 남는다.
  ⚠️ **해외계좌는 `calcPortfolioEvalDetail`이 내부에서 그 날짜 환율로 원화 환산**하므로 `r.total / r.fxRate`로
  USD를 되돌려야 한다(원장·principal·`bookCostOf`가 전부 USD — 안 하면 약 1,390배).
- **⚠️ 원가 C는 `bookCostOf`** — `buildBookCostSeries`가 관측하는 장부액과 **같은 정의**라야
  `shouldHoldDailyMetrics`의 흡수 판정(bookDelta vs 흐름)이 맞물린다. 해외·금은 `costBasisOnly: true` 필수.
- **데이터 이동/복제/유지**: 코드별 **분배금 맵 8종 + `taxBaseHistory`는 이동**(금액성 — 복제하면 통합
  분배금 표에서 이중 계상). **`manualPriceOverrides[code]`는 복제**(원계좌의 과거 스냅샷에 그 종목이 남아
  있어 과거 평가액 재계산에 계속 필요 — ⚠️ 원계좌에서 지우지 말 것). `history`·`holdingSnapshots`는
  **무수정**(자동 스냅샷 효과가 양쪽에 새 스냅샷을 만들어 과거가 자동 보존된다).
- **⚠️ 쓰기는 단일 `setPortfolios`** — `portfolios[]`가 단일 소스이고 `patchActive`/`setPortfolio`는 활성
  계좌 전용이라 대상계좌에 닿지 못한다. **id 생성은 updater 밖**(StrictMode 이중 호출 방어), updater 안에서
  `prev`의 항목 존재를 재확인해 **멱등**. 원본 항목은 반드시 `portfolios[]`의 raw item — `PortfolioTable`에
  넘어가는 `totals.calcPortfolio` 행은 investAmount/evalAmount에 **환율이 이미 곱해져** 있다.
- **⚠️ 양쪽 계좌의 `dividendHistoryUpdatedAt` 갱신 필수** — `dividendHistory`·`dividendExDate`·
  `dividendTaxAmounts`·`actualDividendQty`는 `portfolioStructureKey` 지문에 직접 없어서, 이걸 빠뜨리면
  Drive STATE 저장이 통째로 스킵된다(`deletePortfolioDividendData`와 동일 이유). 그 외 **영속화 신규 지점 0곳**
  (`depositHistory(2)`·`principal`·항목 화이트리스트·`taxBaseKey`·`manualPriceOverrides`는 이미 지문에 포함).
- **대상 계좌 게이팅(fail-closed)**: 현금성(simple/matong)·금현물·삭제 계좌 제외, **통화 불일치**
  (해외↔국내)·**시장 불일치**(crypto↔그 외) 차단, savings→dc-irp만·fund→dc-irp/pension만,
  **동일 코드 보유 계좌 차단**(⚠️ `actualDividend[code][ym]`·`taxBaseHistory[code]` 병합이 한쪽을 조용히
  지운다 — 조용한 오적용보다 명시적 미적용). 부적격 계좌는 목록에서 지우지 않고 **사유를 달아 노출**한다.
- **메모 달력 표시**: 원장의 `transfer` 태그에서 **라이브 파생**(`utils.collectTransferRows` →
  `CalendarModal transfersByDate` → **MOVE 칩**). 원계좌(→ 나감)·대상계좌(← 들어옴) **양쪽 칸**에 뜨고
  패드는 읽기 전용(종목명·수량·방향·이관금액·매입원가·평가차익). ⚠️ `calendarMemos`에 복사 금지.
  ⚠️ `role:'gain'`(원가 보정 행)은 `collectTransferRows`가 제외한다 — 같은 이관이 한 칸에 두 번 뜬다.
  별도 브라우저 창은 `calWinAccounts`가 **transfer 태그 행만 투영**(원장 전량 복제 금지)하고
  `calWinAccountsKey` 지문에 `collectTransferRows`를 포함해야 갱신된다.
- **종목 삭제 확인창**: 이관 버튼 바로 옆이라 오클릭이 쉬워 `handleDeleteStock`을 async + `confirm`으로
  바꿨다(주식·펀드·예적금이 같은 `onDelete`를 쓰므로 한 곳이면 셋 다 보호).
- **⚠️ 원계좌를 '비우는' 이관은 평가액 0이 실제로 시계열에 박혀야 한다 (2026-08 실측 버그 — 회귀 주의)**:
  이관은 대상계좌 쪽만 즉시 반영되고 **원계좌는 종목을 옮긴 날부터 평가액이 0으로 내려가야** 이중 계상이
  없다. 그런데 재구성 파이프라인이 **'평가액 0'을 '데이터 없음'으로 취급**해 직전 구성을 carry-forward로
  살려두는 바람에, 종목을 전부 옮긴 계좌가 과거 평가액을 영구히 유지했다(실측: 이관일 통합 총자산
  ₩877,810,911 = 정상 ₩765,299,368 + 이관액 ₩112,511,543. 원금은 이관이 반영돼 ₩0인데 평가액만 남아
  수익률 0.00%로 표시됐다). **오늘 행은 라이브 합계로 덮어써져 정상**이라, 그날이 '어제'가 되는 순간
  드러나는 지연 발현형이다. 막는 배선 4개 — 하나라도 되돌리면 재발한다(`verify:transfer` #30~#33):
  ① `utils.buildCloseEvalSeries` — `hasAnyPrice=false`라도 **평가 대상 detail이 0건이면 exact 0**
  (이월 금지). '가격을 못 구함'과 '평가할 포지션이 없음'은 다른 사건이다.
  ② `utils.evalSeriesDates`(신규) — 평가 날짜 = **기록일 ∪ 구성 변경일(`holdingSnapshots`)**. 비운 계좌는
  `currentEval === 0`이라 `useHistoryBackfill` 효과#1이 그날 라이브 기록을 만들지 않아, 기록일만 평가하면
  '비운 날' 자체가 시계열에서 빠진다. **통합(`marketSeries`)·개별 차트(`activeCloseEvalByDate`)·추이 표
  (`HistoryPanel displayEvalByDate`) 3곳이 같은 함수를 공유**해야 세 화면이 갈리지 않는다.
  ③ `useIntegratedData marketSeries` — `if (v > 0) map.set(...)` **금지**. 재계산이 권위값을 냈으면 0도
  넣어야 `computedIntHistory`의 `lastVal` carry-forward가 0으로 갱신된다. 같은 이유로 계좌 편입일
  (`firstSeenById`)은 `dates[0]`이 아니라 **평가액이 0을 넘는 첫 날짜**(0 날짜가 d0가 되면 편입 유입이
  0으로 잡혀 나중에 값이 생기는 날의 ΔV가 통째로 가짜 수익이 된다).
  ④ `App.tsx` 자산검증 P1 스냅샷 효과 — `items.length === 0`은 **baseline 부트스트랩에서만** 막는다
  (`items.length === 0 && snaps.length === 0`). 예수금 행조차 없이 완전히 빈 계좌가 되면 스냅샷이 아예
  안 남아 `resolveHoldings`가 영원히 직전(종목 보유) 스냅샷을 돌려준다.
  **일간 지표는 자동 정합** — 이관 원장(원계좌 출금 M / 대상계좌 입금 M)이 ΔV와 정확히 상쇄하므로 그날
  '일간 손익'은 시장 변동분만 남는다(전일대비 %의 하루 희석은 아래 '알려진 한계 ①' 그대로).
  **이미 어긋난 과거 기록은 재조회 없이 자동 교정된다**(저장 `evalAmount`가 아니라 스냅샷 재계산이
  권위값이므로). 다만 `useHistoryBackfill` gap-fill이 비운 계좌의 주말 칸에 낡은 양수를 계속 써 넣는
  것은 그대로다 — 표시는 재계산이 이기므로 무해(저장값 오염만 남음).
- **⚠️ 통합 뷰에서는 이관 쌍을 흐름에서 상쇄한다(2026-08 — 옛 '알려진 한계 ①' 해소)**: 이관일 통합
  '전일대비 %'가 `(V+M)/(V_prev+M)−1`로 희석되던 문제를 `useIntegratedData` ①-c에서 없앴다(그 절 참조).
  **개별 계좌 뷰는 무변경**(그 계좌 기준으로는 자산이 실제로 나갔다). 검증 `verify:transfer` #34~#41e.
- **알려진 한계(의도)**: ② 수익률 +100% 초과 포지션은 흡수 판정(원가 vs 시가,
  50% 문턱)에서 그날이 `'-'`로 보류될 수 있다(기존 '알려진 한계 ③'과 동일 원인) ③ 이관 원장 행을
  `DepositPanel`에서 편집하면 프로라타 재계산이 `principalDeducted`를 덮어써 정합이 깨진다(`[이관]` 메모
  태그로 식별만 제공) ④ 부분 이관·해외↔국내 이관·펀드/예적금 행의 이관 버튼은 **미지원**(핸들러는 지원하나
  진입점을 주식 행에만 둠) ⑤ 원계좌 `principal`이 매입원가보다 작으면 0으로 클램프된다(데이터 이상 상황).
- 검증: `npm run verify:transfer` (참조 구현 미러 #1~#16 + **통합 뷰 이관 쌍 상쇄 #34~#41e** +
  소스 텍스트 가드 #17~#29 + **'비운 계좌
  평가액 0' 배선 #30~#33**). `utils.ts`의 `buildTransferLedgerRows`·`collectTransferRows` 본문과
  **항상 1:1 동기화**할 것. #30~#33은 미러가 아니라 정규식으로 배선을 단언하므로, 실패 시 **먼저
  정규식이 낡았는지 확인**하고 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

### 메모 달력 자산 스냅샷 클릭 → 날짜별 '계좌별 현황'(ASSET 패드) (⚠️ 회귀 주의)

날짜 칸의 **자산 스냅샷 3줄 블록**(총자산 / 일간손익 / 누적%)을 누르면 그날의 계좌별 현황이 뜬다 —
통합 대시보드 '평가액 추이'에서 날짜를 눌렀을 때와 **같은 표**(계좌·투자원금·평가금액·비중·예수금·
수익·수익률 7열 + 소계). 사용자 요청 2026-08. 칩이 아니라 스냅샷 블록이 진입점이고, 나머지 칸 여백은
종전대로 '클릭하여 메모 추가'다(⚠️ `stopPropagation` 필수 — 없으면 메모 패드가 즉시 덮는다).

- **⚠️ 행 산출은 `utils.buildHistDetailRows` 단일 소스**. 원래 `IntegratedDashboard`의 `histDetailRows`
  useMemo 본문이었고, 대시보드는 이제 그 함수를 **직접 import해** 호출한다(prop 아님 — prop으로 두면
  전달을 빠뜨렸을 때 '배선 끊김'과 '그날 자산 없음'이 화면상 동일해지는 fail-open 표면이 생긴다).
  ⚠️ 어느 화면에서도 다시 손계산하지 말 것 — 같은 날짜에 두 화면의 소계가 갈리면
  "달력 칸 총자산 = 팝업 소계 = 추이 차트 그날 값" 불변식이 깨진 걸 아무도 알아채지 못한다.
- **⚠️ 파생값(`weight`·`totalProfit`·`totalReturnRate`)도 그 함수가 낸다** — 두 렌더러가 '순수
  포매팅'만 하게 되어 비중 분모·소계 산식을 한쪽만 바꾸는 사고가 구조적으로 불가능해진다.
  누적 3개(`totalEval`/`totalPrincipal`/`totalDeposit`)는 반드시 `rows.push`와 **같은 분기 안**에서
  올린다(사후 reduce로 바꾸면 제외된 계좌가 분모에 섞여 tfoot '100%'가 조용히 깨진다).
- **⚠️ null 계약 — `weight`·`totalReturnRate`는 산출 불가 시 null**(0.00%로 단언 금지).
  값 셀뿐 아니라 **색 판정도 같은 계약**을 따라야 한다 — `?? 0`으로 뭉뚱그리면 산출 불가(`'-'`)가
  이익(빨강)으로 색칠되고 같은 날짜의 ASSET 패드(회색)와도 갈린다(가드 #G2b, 변이로 실증).
  ⚠️ 도달 경로가 실재한다: `effPrincipal = Math.max(0, 원금 − 미래입금 + 미래출금)`이라 그 날짜
  **이후** 입금이 원금 대부분인 초기 날짜는 전 계좌가 0으로 클램프돼 `totalPrincipal === 0`인데
  `evalAmt > 0`이라 행은 남고 tfoot이 렌더된다(검증 #16이 이 픽스처를 고정한다).
- **⚠️ 표 포매터는 두 화면이 공유한다 — `utils.formatCurrency` / `utils.formatPercent`**.
  '같은 표'라고 고지해 놓고 손실 계좌가 `-₩1,234,567`(대시보드) vs `₩-1,234,567`, 수익률이
  `12.34%` vs `+12.34%`로 갈리면 안 된다. ⚠️ `CalendarModal`의 `fmtPct`(칸·밴드용, `+` 부호)를
  이 표에 쓰지 말 것 — 표기가 갈릴 뿐 아니라 **null-safe가 아니다**(`null >= 0`이 true라
  `null.toFixed`로 던진다). ⚠️ 반대로 `formatPercent`는 `cleanNum`이 null을 `0.00%`로 만들므로
  **null 가드는 `pctCell`이 진다**(달력 표의 모든 % 출력이 이 헬퍼를 지난다 — 가드 #G12).
  ⚠️ `fmtPct` 본문을 널 안전으로 바꾸지 말 것(기존 호출부 4곳의 인자는 전부 number라 이득 없이
  `'-'`가 예상치 못한 자리에 새는 실패 모드만 늘어난다). 0의 색만은 달력 규약(`pnlColor` = 회색)을
  유지한다 — 대시보드는 `>= 0`이라 빨강이지만, 이 파일의 칸·밴드가 이미 회색 규약이다.
- **⚠️ 인앱 `padDetail`도 `try/catch`로 감싼다** — 손상된 Drive 값(예: `h.date`가 문자열이 아닌 기록)이
  정렬 비교에서 던지면 예외가 `<ErrorBoundary label="메모 달력">`까지 올라가 **달력이 통째로 오류
  박스로 래치**된다(닫았다 열어도 복구 안 됨). App 쪽 두 호출부와 방어 수준을 맞춘다.
- **패드 인프라 재사용(kind `'detail'`)**: z=PAD_Z(1060, 달력 1050 위)·드래그·`padSeq` 실측 중앙배치·
  `dismissPad`(✕/Esc)·`savePad` default-deny(`if (pad.kind) { setPad(null); return; }`)·저장 버튼 자동
  숨김·page 모드를 **수정 0줄로** 상속한다. 폭만 `PAD_W_DETAIL(760)`로 파생 — 7열 통화 표가 576px에선
  줄바꿈된다(배치·클램프는 `padRef.offsetWidth` 실측이라 무수정).
- **⚠️ `padDetail` useMemo에 `open` 게이트 필수**(deps에도 `open`) — 달력을 닫아도 `pad`는 남고
  (재오픈 리셋 effect는 `open===true`에서만 돈다) `CalendarModal`은 App 최상위 형제라 항상 마운트돼
  있어, 게이트가 없으면 닫은 뒤에도 시세 갱신마다 전 계좌 시계열을 영구히 재계산한다
  (`notesByDate`·`qtyChangesByDate`·`transfersByDate`와 동일 규약).
- **⚠️ 신규 훅 3개(`padDetail` memo·구독 effect·재측정 effect)는 반드시 `// 패드는 전부 앵커` 주석
  **아래** · `if (!open) return null` **위**에 둔다**. `verify:transfer #27b`가 `const transfersByDate`
  ~ 그 주석 구간에 `setPad` 부재를 단언하는데, 그 정규식은 **`setPadSeq`도 매치**한다.
- **⚠️ 자동 닫힘 effect에 `detail` 분기를 넣지 말 것** — 앵커가 날짜뿐이라 삭제될 원본이 없고, 행
  0건은 정상 상태다. 넣으면 별도 창의 '불러오는 중' 프레임에서 곧바로 닫힌다.
- **별도 브라우저 창 = 구독형 브릿지**(그 창은 App을 마운트하지 않고 잘린 원장만 받아 스스로 계산
  불가): 창→앱 `calendar:wantDetail {date|null}` / 앱→창 `calendar:detail {date, rows, …}`.
  - ⚠️ **`CalendarWindow`의 수신 화이트리스트에 `'calendar:detail'` 추가 필수** — 앱은 `'calendar:'`
    접두사 검사인데 창은 **열거형**이라 비대칭이다. 빠뜨리면 앱이 완벽해도 응답이 조용히 폐기돼
    '영원히 로딩'이 되고 컴파일러·`undefcheck` 어느 것도 못 잡는다(이 변경의 최대 지뢰).
  - ⚠️ **`calendar:detail` 수신에서 `markGotData()`를 절대 부르지 말 것** — `writable = linked &&
    gotData`라 accounts/live 도착 전에 쓰기가 열리면 그 시점 `memos`는 `{}`이고, 저장 한 번이 앱의
    `setCalendarMemos({})`로 흘러 저장된 메모 **전량**을 지운다(`calendarMemos`는 백업 복원 sticky라
    복구 불가). 다른 분기와 '통일'하려는 리팩토링이 정확히 이걸 되돌린다.
  - ⚠️ **App 쪽 분기는 입양 게이트(`e.source !== calWinRef.current`) 뒤**에 둔다 — 입양되지 않은
    창·iframe이 임의 날짜의 계좌별 자산을 뽑아가는 통로가 되면 안 된다(ping만 그 앞이 의도된 예외).
  - ⚠️ **응답은 핸들러 안에서 즉시 전송**한다(지문 게이팅 effect로 만들면 같은 날짜 재클릭 시
    지문이 같아 재발화하지 않아 응답이 영영 안 온다). 반대로 **`calendar:live` payload에는 얹지
    말 것** — 그쪽 deps에 `marketIndicators`가 있어 패드가 닫혀 있어도 시세 틱마다 전 계좌 행이 복제된다.
  - ⚠️ **1회성 스냅샷이 아니라 구독**이다: App은 `buildHistDetail` identity가 바뀔 때마다(=표가
    달라질 수 있는 유일한 시점) 구독 중인 날짜를 **다시 밀어 준다**. 얼려 두면 같은 패드 상단의
    지표 밴드(`metricsByDate`, `calendar:live`로 갱신)와 40px 거리에서 총자산이 두 값으로 보인다.
    날짜가 곧 상관 키라 늦게 온 옛 응답은 `d.date !== detailDateRef.current`로 폐기된다(reqId 불필요).
  - ⚠️ **해제(`date:null`)도 반드시 전송**한다 — `requestDetail`이 post 전에 조기 반환하면 앱의
    `calWinDetailDateRef`가 마지막 날짜를 든 채 남아, 패드를 닫아도(창을 닫아도) 앱이 시세 갱신마다
    전 계좌 시계열을 재계산하고 아무도 읽지 않는 행을 계속 보낸다(App의 null 처리 분기가 죽은 코드가
    된다). 짝으로 App의 푸시 effect는 **생존 확인(`w.closed`)을 계산 앞**에 둔다 — 브라우저 X로
    닫힌 창은 해제 메시지를 보낼 수 없기 때문이다. 가드 #G18·#G18c.
  - ⚠️ **재구독 트리거는 `linked` 엣지 + `calendar:accounts` 수신 2원**이다. `linked` 엣지만으로는
    **앱 탭 새로고침을 잡지 못한다** — 리로드 중에도 opener가 살아 있어 post가 성공하고, 리로드가
    `LINK_TIMEOUT_MS`(13초) 안에 끝나면 `linked`가 한 번도 false로 떨어지지 않는다. 그런데 앱의
    구독 ref는 리로드로 비어 있어 밴드만 갱신되고 표는 옛 값에 영구히 언다. `calendar:accounts`는
    재입양(nonce 증가)·계좌 지문 변경 시에만 오므로 그 수신 카운터를 트리거로 쓴다(가드 #G18b).
    ⚠️ **앱의 nonce 값을 비교하지 말 것** — 앱이 새로고침되면 그 카운터도 0부터 다시 시작해 같은
    값이 재사용되므로 '변했는지'로는 판별할 수 없다. ⚠️ 메시지 핸들러 안에서 `requestDetail`을
    직접 부르지 말 것(그 effect는 deps `[]`라 선언보다 위에 있다) — 카운터를 올려 effect로 넘긴다.
    ⚠️ `linked` 엣지 경로는 opener 소멸 복구용이라 **지우지 말 것**(`status !== 'ready'` 조건도
    넣지 말 것 — 이미 ready인 표만 옛 값으로 영영 남는다).
  - ⚠️ **응답 확정 시 `padSeq`를 한 번 더 올린다** — 배치 effect는 rAF 1회만 `offsetHeight`를 재는데
    별도 창은 '불러오는 중'(≈120px) → 표(≈550px) **2단계 렌더**라 재측정이 없으면 패드 하단이 화면
    밖으로 밀리고(fixed + maxHeight라 내부 스크롤도 안 생긴다) 소계를 볼 방법이 없다.
  - 상태 4종을 구분해 표시한다: `loading`(불러오는 중) / `offline`(연결 끊김) / `timeout`(4초 무응답
    + 다시 시도) / `ready`. ⚠️ '연결 끊김'을 '데이터 없음'으로 뭉뚱그리지 말 것.
- **⚠️ `<CalendarModal>`을 App·CalendarWindow **양쪽 모두** `<ErrorBoundary label="메모 달력">`으로
  감싼다** — 한쪽만 감싸면 격리 없는 쪽에서 전체 화면이 죽는다. 특히 별도 창은 `main.tsx`의 루트
  경계가 **label 없음**이라 `isSection=false` → 창 전체가 오류 페이지로 대체된다(BacktestWindow 선례).
- **표시 정합 2종(값을 통일하려 들지 말 것 — 라벨·배너로만 분리)**:
  ① **시세 미로드 이상치 날**: `computedIntHistory`가 `intTotals.totalEval < 전일 × 10%`면 그날을
  전일값으로 되돌리므로 칸·밴드 총자산은 **직전 거래일 값**인데 팝업 소계는 라이브 합이다 →
  `rawMetric.flowSuspect`를 읽어 앰버 배너로 고지한다(숫자는 손대지 않는다).
  ② **밴드 '수익율' vs tfoot '수익률'**: 밴드는 `effectivePrincipal`(startDate 게이트·오늘 원금 폴백
  포함) 대비, tfoot은 **표에 포함된 계좌의 원금 합** 대비라 과거 날짜에서 부호까지 갈릴 수 있다 →
  tfoot `title` + 각주로 근거를 명시한다. 두 산식은 각각 추이 차트 costAmount·100% 비중 분모와
  짝이라 어느 한쪽을 바꾸면 그 화면이 통째로 어긋난다.
- **`hideAmounts` 적용(범위 확장 — 의도)**: 새 팝업뿐 아니라 **칸 스냅샷 3줄·패드 밴드**에도 적용한다.
  팝업만 마스킹하면 3cm 위 칸은 실금액이라 '금액 숨기기'가 반쪽이 되어 지금보다 나쁘다. 금액만
  가리고 `%`는 노출한다(대시보드 팝업과 동일 범위). 되돌리려면 그 지점들의 `hideAmounts ?` 삼항만
  제거하면 된다. `calendar:live` payload와 deps **양쪽에** `hideAmounts`를 넣을 것.
- **⚠️ 예수금 열 = '그날의 기록값'(자산검증 모달과 같은 소스) — 라이브로 되돌리지 말 것 (2026-08)**:
  평가금액은 진작부터 그날 값이었는데 **예수금만 `summary.depositAmount`(오늘의 라이브)**라, 과거
  어느 날짜를 눌러도 오늘 예수금이 떴다(사용자 보고). 정본은 그 날짜의 보유 스냅샷이다 —
  `snapshotItemsFromPortfolio`가 `depositAmount`를 보존하고 `snapshotCompositionKey`가 그 필드를 담아
  **예수금을 편집하면 그 날짜 스냅샷이 생기므로**(App.tsx 자산검증 P1 효과), 자산검증 모달이 화면에
  보여주는 값과 정확히 같은 값을 팝업도 쓸 수 있다.
  - **소스는 `accountSeriesById[].depositMap` 하나** — `marketSeries`(useIntegratedData)가 평가액
    `map`을 만들 때 **같은 루프·같은 계산**에서 함께 채운다. `intAccountSeriesById`가 series 객체를
    통째로 넘기므로 **두 렌더러 + 별도 창 브릿지까지 신규 배선 0곳**이다(호출부 인자 추가 없음).
  - **⚠️ 평가액과 '짝'으로 이월할 것**: `buildCloseEvalSeries(..., opts.depositOut)`가 exact 날짜엔
    `depositEvalOf(r.items)`를, 이월 날짜엔 **직전 exact 날짜의 예수금**을 넣는다. 두 시계열을
    독립으로 만들면 "주말에 예수금만 갱신 → **예수금 > 평가금액**"이 난다. 읽기도 마찬가지로
    `buildHistDetailRows`가 평가액을 고른 **같은 커서 `lastDate`** 로 조회한다(`date`로 재조회 금지).
  - **⚠️ 해외계좌는 평가액을 만든 `calcPortfolioEvalDetail` **그 호출의 `r.items`** 에서 뽑는다**
    (`depositEvalOf` — 이미 **그날 환율**로 원화 환산됨). `summary.depositAmount`는 **라이브 환율**이라
    되돌리면 예수금만 프레임이 갈린다. 환율식을 손으로 재현하는 것도 금지(폴백이 3단이라 조용히 갈린다).
  - **⚠️ 오늘 행(`isRealtimeDate`)만은 라이브가 정답** — 평가액도 `summary.currentEval`이라 같은
    프레임이고, KR 계좌는 21:00 이후 스냅샷이 **내일 날짜**로 찍혀 스냅샷을 쓰면 어제 값이 된다.
  - **⚠️ `depositAmountAt`은 `kind === 'live'`(스냅샷 0건)면 `null`** — 그때 `resolveHoldings`가 주는
    items는 과거 구성이 아니라 `p.portfolio`(오늘)라, 쓰면 고치려던 버그가 그대로 살아남는다.
  - **하위호환**: `depositMap` 미제공/그 커서에 값 없음 → 종전대로 `summary.depositAmount` 폴백.
    `opts` 미전달 시 `buildCloseEvalSeries`의 동작은 1바이트도 다르지 않다. 폴백 판정은 **`!= null`**
    (`||` 금지 — 예수금 0은 유효한 기록인데 라이브로 되돌아간다).
  - **현금성(matong·simple)은 무변경** — 예수금=평가액=원금이라 이미 그날 스냅샷 값이다.
  - **알려진 한계(의도)**: pre-baseline 날짜(`BASELINE_DEFAULT_DATE` 이전)는 `resolveHoldings`가
    baseline 스냅샷을 돌려주므로 그 구간의 예수금이 **한 값으로 고정**된다(자산검증 모달의 🟡 추정과
    같은 값·같은 한계). 그 구간은 평가액도 저장 `evalAmount` 폴백이라 '예수금 ⊆ 평가금액'이 보장되지
    않는다 — 라이브 값을 쓰던 종전보다는 엄격히 낫지만 정확하지는 않다. 캡을 씌우지 말 것(조용한 오적용).
- **영속화 지점 0곳** — `pad`는 컴포넌트 세션 로컬, 행은 매 렌더 파생값이다. `depositMap`도 `marketSeries`
  memo의 파생값이라 저장 대상이 아니다. `portfolioStructureKey`·`applyStateData`·`applyBackupData`·
  저장 effect deps·`_preserveStickyPersonalData` **전 지점 무수정**.
- **범위 밖(의도)**: ① 두 수익률 산식 통일 ② `buildHistDetailRows`에 startDate 게이트 추가(원금
  산식이 바뀌어 100% 분모가 흔들린다) ③ `futureDeposits`의 `noPrincipal` 필터(과거 수익률 소급 변경)
  ④ 이상치 날짜의 값 정합(배너로 고지만) ⑤ 상세 패드에서의 편집·삭제·확인창(z-1060 위에서는
  `ConfirmDialog`·토스트가 가려진다) ⑥ 과거 날짜의 별도 창 실시간 갱신은 구독으로 자동 처리되나
  인앱/별도 창 동시 사용은 기존 절충 그대로.
- 검증: `npm run verify:cal-detail` (63건 — 참조 구현 미러 #1~#19b + **예수금 = 그날의 기록값
  #20~#26** + **교차검증 #X1~#X3**(달력 칸
  총자산 = 팝업 소계 = 차트 그날 값) + **드리프트 가드 #D1~#D2**(실제 `src/utils.ts`를 import해
  미러와 대조 — utils.ts는 import가 하나도 없어 Node가 타입만 벗겨 실행할 수 있다) + 소스 텍스트
  가드 #G0~#G18c·**#G19~#G25**(공급측 배선 — 미러로는 표현 불가)).
  ⚠️ `#D1` 픽스처에 **`depositMap`이 실린 케이스가 반드시 있어야** 한다(`seriesD` 헬퍼) — 없으면
  그 가드가 새 분기에 눈이 멀어 커서를 `date`로 되돌려도 드리프트 0건으로 통과한다(죽은 단언).
  ⚠️ `seriesD`/새 케이스를 만들 때도 **`series()`·`mkBase()`는 고치지 말 것**(아래 #19 경고와 동일 이유).
  ⚠️ 예수금 계약은 **변이 11종**(팝업·미러 양쪽 커서를 `date`로 되돌림 · `||` 폴백 · 라이브 복귀 ·
  짝 이월 제거 · 이월 시 `depositOut` 미설정 · `depositOut` 미전달 · series에서 `depositMap` 제거 ·
  해외를 summary 프레임으로 · 저장값 폴백 짝 제거 · `closeVal = 0` 분기 삭제)으로 **실제 검출을 확인**했다.
  ⚠️ `verify:transfer #30`의 정규식은 `depositOut` 도입으로 그 줄이 블록이 되면서 갱신됐다
  (계약은 불변 — 빈 포지션은 이월이 아니라 exact 0).
  ⚠️ 가드는 전부 **선언이 아니라 사용부**를 단언하고, **변이 21종**(화이트리스트 삭제·`markGotData`
  추가·입양 게이트 순서 뒤집기·`open` 게이트 제거·`pctCell`→`fmtPct`·즉석 계산 부활·prop 삭제·
  `stopPropagation` 제거·null 계약 0으로 변경·`status !== 'ready'` 부활·마스킹 제거·열 삭제·센티넬
  구간 침범·**해제 메시지 조기 반환·재입양 재구독 무력화·생존 확인 뒤로 이동·tfoot 색 `?? 0` 복귀·
  activeHistory 분기 삭제(src/미러 양쪽)**)으로 **실제 검출을 확인**했다. 그중 tfoot 색 계약은
  처음에 **죽은 단언**이었고 변이로 발견해 #G2b를 신설했다 — 가드를 손볼 때 같은 변이가 여전히
  잡히는지 반드시 다시 확인할 것.
  ⚠️ '금지 토큰 부재' 가드는 **주석을 걷어낸 뒤**(줄 주석 + `{/* */}` 블록) 본다 — 이 저장소는 금지
  이유를 바로 그 자리 주석에 적으므로 원문으로 재면 가드가 영구히 실패한다.
  ⚠️ #19/#19b(`activeHistory` 분기)를 만들 때 **`mkBase()`를 고치지 말 것** — #1~#18이 그 픽스처의
  값(1200/500/700)을 하드코딩하고 있어 소계 기대치가 통째로 어긋난다. 덮어쓰기로 케이스를 만든다.

### 메모 달력 별도 브라우저 창 (`/?calendarWindow=1`) — postMessage 브릿지 (⚠️ 회귀 주의)

인앱 달력 창 헤더의 **⧉ 버튼**(`onOpenWindow`)으로 달력을 **별도 브라우저 창**에 띄운다(듀얼 모니터·
최대화용). 새 창에서 저장하면 앱 탭을 경유해 기존 Drive STATE 저장 경로로 흐른다.

- **⚠️ 새 창은 App을 마운트하지 않는다 — 절대 '앱 통째 부팅'으로 바꾸지 말 것**: `main.tsx`가
  `CALENDAR_WINDOW_BOOT`(URL 파라미터)를 보고 `<App/>` 대신 `<CalendarWindow/>`를 렌더한다.
  앱을 부팅하면 ① `saveAllToDrive`가 STATE 파일을 **통째로 덮어쓰므로** 두 창이 서로의 편집을
  지우고(payload 스프레드 규약으로도 못 막는다 — 그건 한 창 안의 필드 누락 대비다) ② `window.open`은
  noopener를 안 쓰면 sessionStorage가 복제돼(`?adminPortal=1`이 동작하는 원리) 새 창이 **자동 재인증
  → 두 번째 writer**가 되며 세션 충돌 감지에도 걸린다. **writer는 끝까지 앱 탭 하나**다.
- **⚠️ `window.open`에 `noopener` 금지**(impersonation 탭과 **정반대** 규칙): opener 브릿지가 이 기능의
  전부다. 클릭 제스처 직후 **동기** open이라야 팝업 차단을 피한다(차단 시 `calWinBlocked` → 인앱 창은
  그대로 두고 헤더 안내만). `screen.availWidth/Height`로 화면을 꽉 채워 연다.
- **⚠️ 렌더는 `CalendarModal` 한 컴포넌트를 공유**한다(`variant='page'`). 그리드·패드·파생 인덱스를
  새 창용으로 복제하면 두 화면이 갈라진다. page 모드는 바깥 chrome(드래그·중앙 배치·둥근 모서리·
  `maxHeight 92vh`)만 끄고 `position:fixed; inset:0`로 채운다.
- **⚠️ page 모드 칸 높이는 CSS `fr`이 아니라 JS 역산**(`viewportH` state + resize 리스너):
  `cellH = max(CELL_H, (viewportH − PAGE_CHROME_H) / 주수)`. 높이가 불확정인 컨테이너 안에서는
  `gridAutoRows: minmax(X, 1fr)`의 fr이 늘어나지 않아(그리드 fr 트랩) 칸이 CELL_H에 머문다.
  `CELL_H` 하한은 유지 — 그 아래로는 칸 내용(지표 3줄+칩 3줄+메모)이 어차피 안 들어간다.
- **브릿지 프로토콜**(전부 `e.origin === location.origin` 검사 통과분만):
  창→앱 `calendar:ping{need}` (5초) · `calendar:memos{memos}` · `calendar:notes{portfolioId,notes}` /
  앱→창 `calendar:accounts` (무거움) · `calendar:live` (가벼움) · `calendar:pong`.
  - **⚠️ 초기 전송의 유일한 트리거는 `ping.need`** — `window.open` 직후 보내면 새 창이 아직
    about:blank라 메시지가 버려진다. 새 창은 데이터를 받을 때까지 `need:true`를 실어 보낸다
    (`gotDataRef` — 핑 타이머는 마운트 시 한 번 만들어져 state를 못 보므로 **ref 미러 필수**).
  - **재입양**: 앱 탭이 새로고침되면 `calWinRef`가 비는데, 살아 있는 새 창의 핑에서 `e.source`를
    다시 입양하고 nonce를 올려 전량 재전송한다. 없으면 새 창이 영영 낡은 데이터를 든다.
  - **쓰기는 입양된 창만**(`e.source === calWinRef.current`). `ping`만 입양 전에도 받는다.
- **⚠️ 전송은 지문(fingerprint)으로 게이팅**: `portfolios`는 시세 갱신마다 새 배열이라 그대로 보내면
  보유 스냅샷 전량이 수십 초마다 복제된다. `calWinAccountsKey`에 **투자기록 본문 + `snapshotCompositionKey`**
  까지 담아야 '본문만 수정'·'같은 날짜 스냅샷 수량만 수정'이 새 창에 반영된다(`portfolioStructureKey`와
  동일 클래스의 버그). 그 지문은 **새 창이 한 번이라도 붙은 뒤(nonce>0)에만** 계산한다.
- **끊김 = 읽기 전용**: opener 소멸 또는 `LINK_TIMEOUT_MS` 무응답이면 `readOnly` — 셀 클릭(신규 메모)·
  저장 버튼·삭제 버튼을 전부 숨기고 **textarea도 `readOnly`**로 만든다. ⚠️ 저장 버튼만 숨기면 사용자가
  한참 쓴 뒤 아무 데도 저장되지 않고 사라진다(창 위에선 notify/confirm이 가려져 사후 경고도 불가).
- **낙관적 반영**: 새 창은 자기 state를 먼저 갱신하고 앱 탭에 보낸다(왕복 대기 없음). 앱 탭이 적용 후
  `calendar:live`로 되돌려 보내 수렴한다.
- **영속화 무수정**: 새 창은 저장 필드를 만들지 않는다 — 앱 탭의 `setCalendarMemos`/
  `updateInvestmentNotesFor`를 그대로 태우므로 `portfolioStructureKey`·`applyStateData`·
  `applyBackupData`·저장 effect deps 전 지점 무관.
- **알려진 한계(의도)**: 인앱 창과 새 창을 **동시에** 열어 두면 `calendarMemos` 전체 객체를 각자
  자기 기준으로 통째 교체하므로 이론상 마지막 쓰기가 이긴다. 다만 `calendar:live` 에코가 즉시 돌아와
  두 창의 base가 1틱 안에 수렴하고, ⧉로 새 창을 열면 인앱 창을 닫으므로(`setShowCalendarModal(false)`)
  실사용에서 겹치는 구간은 1초 미만이다. 편집자가 한 사람이라는 전제 위의 절충.
- **범위 밖(의도)**: 새 창은 관심종목·계산기 등 다른 플로팅 창을 띄우지 않는다. impersonation 탭에서
  연 새 창은 그 탭이 닫히면 읽기 전용이 된다(관리자 탭은 원래 세션을 영속하지 않음).

### 자금 흐름도(flowMaps) — 계좌 관계 다이어그램 (⚠️ 회귀 주의)

상단바 **흐름도 아이콘**(`UserInfoBar` — 퀵 링크 설정과 계산기 **사이**, 인라인 SVG `FlowIcon`)으로
여는 캔버스. 둥근 사각형·원 도형을 만들고 자유롭게 선으로 연결하며, 선 위에 라벨을 단다. 도형에는
날짜·이름·금액·메모를 넣고, **계좌를 연결하면 계좌명·현재 평가액이 라이브로 표시**된다.

- **기본 동작 = 별도 브라우저 창**(`/?flowWindow=1`). 아이콘 클릭 → `openFlowWindow`가 새 창을 연다.
  **팝업이 차단되면 인앱 보드로 폴백**(`setShowFlowBoard(true)` + `headerNotice` 안내)하므로 최악의
  경우가 기존 동작이다. 두 경로 모두 **같은 `FlowBoard` 컴포넌트**를 쓴다(`variant='page'|'overlay'`) —
  새 창용 캔버스를 복제하면 두 화면이 갈라진다.
- **⚠️ 새 창은 App을 마운트하지 않는다**(`main.tsx`가 `FLOW_WINDOW_BOOT`을 보고 `<FlowWindow/>`를 렌더).
  앱을 부팅하면 ① `saveAllToDrive`가 STATE를 통째로 덮어써 두 창이 서로의 편집을 지우고 ② sessionStorage
  복제로 자동 재인증돼 **두 번째 writer**가 된다. **writer는 끝까지 앱 탭 하나**.
  `window.open`에 **`noopener` 금지**(opener 브릿지가 기능의 전부 — impersonation 탭과 정반대 규칙),
  클릭 제스처 직후 **동기** open이라야 팝업 차단을 피한다.
- **브릿지**(전부 `e.origin === location.origin` 검사 통과분): 창→앱 `flow:ping{need}`(5초)·`flow:maps`
  / 앱→창 `flow:accounts`(무거움, 지문 게이팅)·`flow:live`(maps+summaries+hideAmounts)·`flow:pong`.
  **초기 전송의 유일한 트리거는 `ping.need`** — `window.open` 직후 보내면 about:blank라 버려진다.
  앱 탭 새로고침 시 살아 있는 창의 핑에서 **재입양**(nonce 증가 → 전량 재전송). 쓰기는 입양된 창만.
  끊김(opener 소멸·무응답) = **`readOnly`** — 저장 버튼만 숨기면 한참 그린 뒤 아무 데도 저장되지 않는다.
  `flow:accounts`는 계좌를 **투영**해 보낸다(id·name·accountType·deletedAt·isTest + dc-irp 예적금 항목만).

- **핵심 결정: 데이터는 `portfolios[]` 밖 앱 레벨**(`calendarMemos`·`watchlistGroups`와 동급).
  ⚠️ 계좌 객체 안(`p.flowMap`)에 넣지 말 것 — `patchActive`가 `portfolios` 참조를 바꿔
  `portfolioSummaries`·`marketSeries`·`computedIntHistory`·`rebalanceData`·`useHistoryBackfill` 효과#1
  (사전체크/map 미러링 불변식이 깨지면 **렌더/저장 무한 루프**) 등 11개 파이프라인이 매 제스처
  재실행된다. 앱 레벨이면 이 전부가 무관해진다.
- **계좌 연결 = `portfolioId` 참조 + 라이브 재조회**(복사 금지 — CalendarModal의 note/qty 파생과 동일 계약).
  자동으로 채워지는 것은 **계좌명·평가액 2개뿐**. ⚠️ **계좌 레벨 만기 필드는 코드베이스에 존재하지
  않는다**(유일한 만기는 dc-irp 전용 예적금 항목의 `item.endDate`이고 계좌당 여러 개) → 날짜·금액계획·
  메모는 전부 사용자 입력 필드이고, dc-irp 예적금 보유 계좌에만 만기 '제안' 칩을 띄운다(자동 채움 아님).
  `accountNameSnapshot`은 **바인딩 시점 1회만** 기록하는 표시 폴백(purge된 계좌용) — 갱신 금지.
- **영속화 7지점(하나라도 빠지면 조용한 유실)**: `App.tsx` ① `useState` ② 지문 `flowFingerprint(flowMaps)`
  ③ 저장 payload 리터럴 ④ 저장 effect deps ⑤ `applyStateData`(`normalizeFlowMaps`) ⑥ `applyBackupData`
  (sticky) + `useDriveSync.ts` ⑦ `_preserveStickyPersonalData`.
  ⚠️ **App 레벨 미러(`flowMapsRef`)를 두지 말 것** — 종료 커밋의 값 소스는 `FlowBoard`의 `localRef`
  (`flowFlushRef` 경유)이지 App state가 아니다. 미러를 두면 로드 경로와 동기화할 의무만 생기고 실제로는
  읽히지 않아 "stale-write를 막는다"는 잘못된 안전감만 준다(`calendarMemosRef`는 커밋이 App에서
  일어나므로 사정이 다르다). 검증 #29/#29b가 이 계약을 단언한다.
- **⚠️ sticky 판정은 `flowMapsHaveContent` 공유 함수**(`flowMap.ts`). `length > 0`으로 재지 말 것 —
  보드를 **열기만 해도** 빈 맵 1장이 생겨 백업으로 흐름도를 되살릴 길이 영구히 막힌다(`calendarMemos`는
  빈 항목이 생길 수 없어 length 기준으로도 안전했다). App.tsx와 useDriveSync가 **같은 함수**를 써야
  in-memory와 Drive write가 갈리지 않는다(판정식 손복제 금지).
- **⚠️ 지문은 `flowFingerprint`(화이트리스트 투영 + try/catch)**. raw `JSON.stringify(flowMaps)`로
  되돌리지 말 것 — 런타임 필드가 하나라도 순환이면 던지고, 그 지문 계산은 저장 effect의 첫 블록이라
  **그 세션의 Drive 저장이 통째로 멈춘다**. 길이·개수 해시 절충안도 금지(`investmentNotesKey`·
  `holdingSnapshotsKey`가 그걸로 "동일 길이 편집을 놓치는" 버그를 냈다). `updatedAt`은 지문에서 제외.
- **⚠️ 저장 폭주 방지 = 로컬 사본 + idle 승격**: 편집은 `FlowBoard`의 로컬 사본에 모으고 **2.5초 idle ·
  보드 닫기 · 종료/수동저장 커밋 · 언마운트** 시점에만 App state로 승격한다. 제스처마다 승격하면
  ① `portfolioStructureKey`가 전 계좌를 매번 재직렬화하고 ② 800ms 디바운스는 사람 손 간격(1~3초)보다
  짧아 매번 만료되어 **제스처마다 STATE+VERSION+STOCK+MARKET = HTTP 8회 + 종목 2년치 일봉 전량
  재업로드**가 나간다(도형 40개 배치 = 320 요청 + 수십 MB). 회수 경로: `App.tsx flowFlushRef` ←
  FlowBoard가 마운트 시 등록하고 **언마운트 시 null**. 미승격 편집이 없으면 커밋은 **반드시 null 반환**
  (항상 truthy면 alt-tab마다 4파일 write 강제). 언마운트 시에는 상위로 **승격**한다(그냥 사라지면 유실).
- **⚠️ 종료 커밋은 `exitCommitRef` 합성**: `useDriveSync`의 `beforeExitSnapshotRef` 슬롯이 하나뿐이라
  리밸런싱(`rebalExitCommitRef`)과 흐름도(`flowExitCommitRef`)를 App에서 합친다. 반환 키가 겹치지 않아
  순서는 무관하나 **둘 다 없으면 null**을 반환해야 한다. 수동 저장 4핸들러(`handleSave`·`handleDriveSave`·
  `handleDownloadStateFile`·`handleAppClose`)도 `flushFlowSnapshot()` **동기 주입 필수** —
  `saveStateRef` 스프레드만으로는 '방금 blur 커밋한 값'이 안 실린다(`flushRebalTargetSnapshot`와 동일 이유).
- **⚠️ z-index 990** — `ConfirmDialog`(1000)보다 **아래**여야 도형 삭제 확인창이 보드 위에 뜬다.
  1050대(메모 달력·계산기·관심종목)에 두면 그 기능들이 겪은 "창 위에선 confirm/notify가 가려진다"를
  재현하고 결국 확인 없는 즉시 삭제로 후퇴하게 된다. **알려진 한계(수용)**: 벨 알림 팝업(z-999)·
  리밸런싱 투자기록 창(z-1000/1010)·관리자 공지 모달(z-300, 보드가 가림)은 이 층 관계의 결과다.
- **⚠️ 인스펙터 draft는 'id 앵커 + 대상변경·언마운트 flush'**(`ownerRef` + `useLayoutEffect`).
  `onBlur`만 믿고 **현재 선택**(`selNode`)에 커밋하면 두 가지가 조용히 깨진다:
  ① 도형 A 이름을 타이핑하다 캔버스에서 B를 클릭하면 `pointerdown → onSelect(B)` 리렌더가 blur보다
  **먼저** 처리돼(discrete 이벤트 동기 flush) A의 입력값이 **B에 기록**된다.
  ② 배경 클릭으로 선택이 해제되면 패널이 **언마운트**되는데, 제거된 DOM에는 브라우저가 blur/focusout을
  발화하지 않아 메모 전체가 **아무 데도 저장되지 않고 사라진다**.
  → `FlowBoard`는 `patchNodeById`/`patchEdgeById`(**id 기준**)만 노출하고, 리셋 effect는 **passive가
  아니라 `useLayoutEffect`**여야 한다(passive는 Scheduler 태스크라 blur보다 뒤처진다).
  ⚠️ App의 종료 커밋(`flowFlushRef`)은 이걸 **못 덮는다** — 그건 `FlowBoard`의 `localRef`만 회수하고
  미커밋 draft는 `FlowInspector` 로컬 state에만 있다.
- **⚠️ 키 입력·활동 감지**: 보드 루트 `onKeyDownCapture`는 보드 키를 먼저 처리한 뒤 **실제로 소비한
  키(Escape·Delete·Backspace)에만** `stopPropagation` 한다. 무조건 끊으면 React 18이 root에 붙인 캡처
  리스너에서 네이티브 이벤트가 멈춰 하위의 bubble `onKeyDown`이 전부 죽고, 인스펙터의 **Enter 커밋이
  먹통**이 된다(사용자는 커밋했다고 믿은 채 다른 도형을 눌러 위 ①을 직접 유발한다).
  그리고 `App.tsx` 비활동 감지 리스너는 **document 캡처 단계 + `pointerdown` 포함**으로 등록한다 —
  버블이면 이 `stopPropagation`에 막혀 "도형 배치·장문 메모"만 하는 세션이 활동으로 집계되지 않아
  50분 뒤 로그아웃 모달이 튀어나온다.
- **⚠️ 보드는 열 때 시드하되, 아직 dirty하지 않으면 늦게 도착한 App state를 채택한다**.
  `LoadingOverlay`는 로드 완료와 무관하게 20초 뒤 자동 해제되므로, 느린 회선에서 Drive의 flowMaps가
  도착하기 전에 보드를 열면 '빈 맵 1장'으로 시드되고, 도형 하나만 그려도 2.5초 뒤 승격이 **저장돼 있던
  흐름도 전체를 빈 맵으로 대체**한다(복구 불가). 편집 중(dirty)에는 채택하지 않는다(의도된 last-writer-wins).
- **⚠️ 금액 표시는 항상 원화**. `portfolioSummaries[].currentEval`은 해외계좌도 **원화 환산값**이라
  `accountType === 'overseas'`에 `$`를 붙이면 약 **1,390배**로 오표시된다.
- **⚠️ 순수성**: 노드/엣지 생성(`generateId`)·선택 변경·ref 대입을 `setState` **업데이터 안에서** 하지
  말 것. StrictMode 개발 모드의 업데이터 이중 호출에서 서로 다른 id가 만들어지고(React는 두 번째 결과만
  채택) 첫 호출의 부수효과가 남아 선택이 어긋난다. `localRef`가 로컬 사본의 단일 소스다.
- **삭제/TEST 계좌**: 삭제 계좌는 `liveAmount = null`(⚠️ `portfolioSummaries.currentEval`은 삭제
  계좌에서도 **실수치를 그대로 반환**한다 — 제외는 소비처 `intTotals`에서만 일어나므로 여기서 명시적으로
  null 처리해야 '삭제 계좌 = 라이브 완전 제외' 불변식이 지켜진다) + `(삭제됨)` 접미. TEST 계좌는
  **금액을 그대로 표시**하고 이탤릭·반투명 강등만 한다(통합 표도 평가금액은 표시하고 평가비중만 `-`).
  `accountType`은 반드시 `portfolios`에서 읽는다(summary는 시장 계좌를 전부 `'portfolio'`로 납작하게 만듦).
  **purge된 계좌를 가리키는 노드는 자동 삭제하지 않는다** — 앰버 테두리 + '연결 끊김' 배지로만 알린다.
- **게이팅 = 승인 시트 K열 `flowEnabled`**(index 10). Apps Script 6지점(`check`·`listUsers`·
  `getFeatureLabels` E1:K1·`setUserFeature` colMap·`addUser` appendRow·`setupSheet` K1/E2:K100) +
  프론트(`LoginGate` `UserFeatures`/`EMPTY_FEATURES`/`pickFeatures`, `App.tsx` 초기값·`flowAccess`,
  `AdminPage` 라벨·featureDefs, `AccountTabBar` `canAccessFlow`).
  ⚠️ **배포 순서는 프론트 먼저 → Apps Script 나중**. 반대로 하면 `getFeatureLabels`가 7개를 반환하는데
  구 프론트의 `length === 6` 가드가 응답을 통째로 거부해 **기존 커스텀 라벨 6개가 제네릭으로 회귀**한다
  (그래서 가드를 `>= 6` + 인덱스 머지로 바꿨다 — `=== 7`로 되돌리지 말 것).
  ⚠️ `flowAccess = isAdminUser || userFeatures.flowEnabled` — `effectiveUserFeatures`(feature1/2/3만
  강제하는 별개 경로)에 얹지 말 것. 이게 없으면 관리자 본인이 영구 접근 불가다(AdminPage 토글은
  `!isAdminUser` 조건이라 관리자 행에 렌더조차 안 됨).
- **⚠️ 새 필드 나열 지점은 3곳뿐**: `LoginGate`의 `UserFeatures` / `EMPTY_FEATURES` / `pickFeatures`.
  과거엔 3개 로그인 경로(무음 재인증·impersonation·수동 로그인)가 각자 필드를 손나열해, 하나만 빠뜨려도
  그 경로에서만 기능이 사라지는 재현 불가 버그가 났다(@ts-nocheck + esbuild라 컴파일러가 못 잡는다).
- **impersonation은 읽기 전용**(`readOnly={!!adminViewingAs}`) — 목표비중과 달리 흐름도는 undo도 없고
  sticky라 백업 복원으로도 되돌릴 수 없어 무통지 편집을 허용하지 않는다.
- **⚠️ 외부 npm 의존성 0**: 캔버스는 순수 SVG + Pointer Events 자체 구현이다. `package-lock.json`이
  없어 Vercel이 매 배포마다 `npm install`을 재해석하고, 정확히 그 원인으로 프로덕션 흰 화면이 났던
  이력이 있다. lucide 아이콘도 **저장소에서 이미 쓰는 것만** 사용하고 새 아이콘은 인라인 SVG로 만든다
  (`AccountTabBar`의 `FlowIcon` — `Workflow`/`Share2`/`Network`가 이 버전에 있다는 근거가 없다).
- **소프트 상한**: 맵 5 / 노드 150 / 엣지 300(≈85KB). 백업 22본·관리자 포털 순차 로드로 복제되므로
  무한 증식만 막는다. 상한 도달 시 툴바 배너로 알린다.
- **범위 밖(의도)**: undo/redo(Drive 폴링이 타 기기 편집을 받아온 뒤 undo가 최신값을 덮는다 —
  `RebalanceTargetRestoreModal`이 같은 이유로 포기), PNG 내보내기, 자동 레이아웃,
  다중 캔버스 UI(데이터 모델은 배열이나 현재 1장 고정), 계좌 삭제 시 노드 캐스케이드 정리.
  **알려진 한계**: 인앱 보드와 새 창을 동시에 열면 이론상 마지막 쓰기가 이긴다(아이콘이 새 창을 열 때
  인앱 보드를 닫으므로 실사용에서 겹치는 구간은 짧다 — 메모 달력 창과 동일 절충).
  계좌가 0개면 저장 effect가 조기 반환해 흐름도가 저장되지 않는다(chartPrefs와 동일한 기존 한계).
- 검증: `npm run verify:flow` (미러 #1~#26 + 소스 텍스트 가드 #27~#36).
  참조 구현은 `flowMap.ts`의 `normalizeFlowMaps`·`flowMapsHaveContent`·`flowFingerprint`·`edgePath`·
  `removeNode`·`pruneOrphanEdges`·`roundNode`·`resolveFlowNodeView`·`countDanglingNodes` 본문과
  **항상 1:1 동기화**할 것. 가드(#27~#36)는 영속화 배선을 정규식으로 단언하므로, 실패 시 **먼저
  정규식이 낡았는지 확인**하고 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

### 분할매수/매도 계산기(`LadderTradeModal`) — 앵커는 '수량'이 아니라 '금액' (⚠️ 회귀 주의)

리밸런싱 표의 **현재가 셀 클릭**으로 여는 호가 사다리 계산기(z-1050, 드래그 이동). 매수(+)·매도(−)
모두 같은 컴포넌트가 `side`로 방향만 바꿔 연다(`dir = isSell ? 1 : -1`).

- **⚠️ 1급 계약 — 사다리는 금액을 고정하고 수량을 푼다. 절대 되돌리지 말 것**:
  리밸런싱이 정하는 1차값은 '이 종목을 ₩N만큼 늘린다/줄인다'(증가분·부족분)이고, 표의 수량은
  그 금액의 **파생값**이다(`usePortfolioData` `action = Math.trunc((목표금액 − 현재평가금) / price)`).
  따라서 사다리도 `targetAmount = |totalAction| × itemPrice`를 앵커로 삼고 수량을 푼다 —
  **호가를 올려 팔면 같은 금액에 더 적은 수량이, 호가를 내려 사면 같은 금액에 더 많은 수량이** 필요하다.
  - **과거 버그(매도)**: 매도만 수량을 `sellTarget = |action|`으로 고정한 채 호가를 올려 팔아
    **목표금액을 초과 매도**했다(실측: 목표 ₩7,961,800 → 매도 ₩9,227,400, **+15.9%**. 8,470원 ·
    호가 100 · 배수 4 · 940주). 금액 앵커로 바꾸면 같은 조건에서 **819주 / ₩7,961,030**(121주 절약).
  - 매수는 원래도 금액 앵커(`maxAffordableQty(fund)`)라 **의미 변경이 없다** — 아래 폭주 케이스를
    빼면 새 솔버와 결과가 1주도 다르지 않다(전 조합 대조 완료).
- **⚠️ `solveQtyForAmount`가 그 구현체이고 매수·매도가 `doRegenerate`의 **같은 한 줄**을 쓴다** —
  `isSell ? sellTarget : …` 삼항으로 되돌리지 말 것(검증 #49가 `sellTarget` 식별자 부재까지 단언).
  총액이 목표금액을 넘지 않는 **최대 수량**을 이분탐색으로 푼다. 술어
  `P(Q) = (총액 ≤ 목표 ∧ 사다리 안 잘림)`는 Q에 단조감소라 이분탐색이 성립한다(모든 행 가격 > 0이라
  총액은 Q에 단조증가, 잘림은 한 번 나면 계속 난다).
- **⚠️ 허용 오차는 `1e-6` 부동소수 여유가 아니라 '가격 격자 1칸'**(`amountTolOf` = 원화 1원 / 달러 $0.01).
  목표금액은 **원시 현재가**로 계산되는데(`|action| × price`) 사다리는 **격자에 스냅된 가격**으로만
  거래하므로(`buildLadder`의 `roundTo`), 격자가 가격을 **올려** 반올림하면 1주조차 목표를 넘겨
  `Q=0` **빈 사다리**가 된다. 실측: 펀드 기준가 1,234.56 · action −1 → 첫 호가 1,235 > 목표 1,234.56
  → 매도 계산기가 통째로 빈 채로 열렸다(소수부 ≥ 0.5인 가격 + `|action|=1` 전부 해당. 펀드 NAV는
  `api.ts`가 소수 2자리를 캡처하므로 구조적 정상값이다). 스냅 상승폭은 최대 격자의 절반이라
  격자 1칸이면 항상 덮이고, 그래서 **`baseQty >= 1`이면 `Q >= 1`이 보장된다**(검증 #74·#75).
  `action = trunc(금액/가격)`이 이미 1주분을 버리므로 이 여유는 그 안에 묻힌다 — 실측상 정수 가격·
  달러 전 조합에서 **실제 초과액은 0원**이고, 오차는 `Q=0` 경계를 구제할 때만 쓰인다(경계: 검증 #70).
- **⚠️ 빈 사다리는 반드시 이유를 밝힌다** — 잔여 줄은 `totalCost > 0`, 푸터는 `totalQty > 0`으로
  게이팅돼 있어 `Q=0`이면 화면에 `0주 / — / —`만 남아 **계산기가 고장 난 것처럼 보인다**.
  표 본문에 안내 행(`!rows.length`)을 둔다(검증 #79).
- **⚠️ 잘린 사다리(Σ수량 < Q)는 거부한다** — 매수는 호가를 내리다 가격 하한에 닿으면 `buildLadder`가
  남은 행을 버리는데, 그러면 총액이 더 늘지 않아 ① 옛 **선형탐색**이 `cost > fund`에 영영 걸리지 않아
  상한 100000까지 폭주했고(실측: 현재가 1,000 · 호가 50 · 목표 100,000원 → 100000 반환, 정답 210),
  그 탐색이 **렌더 이펙트에서 동기 실행**돼 화면이 수 초간 멈췄다 ② `targetQty`가 실제 배치 수량보다
  커져 요약의 '수량'이 거짓이 된다. 선형탐색으로 되돌리지 말 것(검증 #66).
- **⚠️ `baseQty`(= `|totalAction|`)는 비교 기준일 뿐 사다리 수량을 정하지 않는다** — 화면 푸터의
  `기준 N주 → M주`와 절약/추가 수량 표시에만 쓴다. 여기에 사다리를 고정하면 그게 곧 옛 버그다.
- **화면 규약**: 옛 `현재가 기준`/`리밸런싱 자금` 라벨은 **`목표 금액`**으로 통일(양쪽이 같은 뜻이 됐다).
  매매 금액 아래 **`잔여`**(목표 − 실제)를 노출하고 목표의 1%를 넘으면 앰버로 강조한다 —
  호가가 지나치게 넓어 사다리가 가격 하한에 먼저 닿으면 목표금액을 크게 못 채우는데(실측: 8,470원에
  호가 400 → 목표의 9%만 매수) 그걸 숨기면 안 된다. 푸터는 금액 우위(`uplift`)가 아니라 **수량 이득**
  (`qtyDiff = totalQty − baseQty`)을 보여 준다 — 금액이 고정됐으니 이득은 이제 수량으로 나타난다.
- **⚠️ 순수 함수 구간의 상수 위치**: `verify:ladder`는 이 파일의 **`function tri` ~ 컴포넌트 선언 직전**
  구간만 잘라 평가하므로 `MAX_LADDER_QTY`/`QTY_EPS`/`AMOUNT_EPS`는 반드시 그 안에 있어야 한다
  (위로 올리면 테스트가 ReferenceError로 죽는다). 같은 이유로 **그 구간 안 주석에 컴포넌트 선언
  키워드를 그대로 적지 말 것** — `sliceFns`가 거기서 구간을 끊는다(실제로 한 번 그랬다. `lastIndexOf` +
  이름 존재 검사로 명시적 실패로 바꿔 뒀다).
- **호가별 등락률 열 = '전일 종가' 기준 (⚠️ 회귀 주의 — 현재가 대비로 바꾸지 말 것)**:
  각 행의 `매수(매도)단가` 오른쪽에 그 호가가 **전일 종가** 대비 몇 %인지 표시한다(요약의 현재가격·
  평균단가 아래에도 같은 기준의 작은 줄). 목적은 "전일 대비 오늘 얼마나 더 비싸게 팔 수 있는가(매도)
  · 더 싸게 살 수 있는가(매수)"를 리밸런싱 표의 **등락률 열과 같은 축**에서 읽는 것 — 매도는 호가를
  올릴수록 현재가 등락률보다 커지고, 매수는 내릴수록 작아진다(실측: 11,260 ▲6.56% · 호가 10 →
  매도 32단계 ▲9.49% / 매수 32단계 ▲3.63%). **현재가 대비 %로 바꾸면 이 목적이 통째로 사라진다.**
  - **⚠️ 전일 종가를 가격 격자로 반올림하지 말 것**: `prevCloseFrom = 현재가 ÷ (1 + 등락률/100)`인데
    `changeRate`가 소수 2자리로 반올림돼 들어오는 경우가 많아 정수에 딱 떨어지지 않는다. 여기서
    스냅하면 **현재가 행의 등락률이 표의 등락률과 갈린다**(예: 7,215 ▲2.19% → 스냅하면 2.20%.
    실측 조합의 약 22%). 검증 #80·#81(변이 실증)·#81b.
  - **⚠️ 현재가와 같은 호가는 '왕복 계산'이 아니라 등락률 **원값**(`baseRate =
    normalizeChangeRate(changeRate)`)을 그대로 쓴다**: `p → p/(1+c/100) → 다시 %`의 왕복은 ±1e-15
    오차를 남기는데, `c`가 소수 3자리 이상이고 `.xx5` 경계면(예: 6.565) 그 오차가 `toFixed(2)`를
    갈라 **표는 ▲6.57%, 계산기는 ▲6.56%**가 된다. `api.ts`의 미국 주식 경로는 `changeRate`를
    **반올림 없이** 넘기므로 실제로 도달 가능한 경로다. 원값을 쓰면 '대수적 보장'이 아니라
    **같은 값**이라 어떤 자릿수에서도 문자열까지 일치한다. 적용 2곳 — 요약 `curRate`,
    표의 `rowRate`(`row.price === currentPrice`일 때). 검증 #99·#99b(변이 실증)·#99c.
  - **⚠️ 툴팁의 전일 종가는 단언이 아니라 근사 표기**(`prevLabel = 전일 종가 ≈ …(등락률에서 복원한
    추정값)`): 툴팁 숫자는 표시용으로 격자에 반올림되므로 그 값으로 되계산하면 옆에 찍힌 등락률이
    재현되지 않는다(원화 1,000 · ▼30.00% → '1,429' → 되계산 −30.02%. 저가 USD는 65% 조합에서 발생).
    계산은 반올림하지 않는데 문구만 스냅값을 근거로 단언하면 모순이라 `≈`로 표기한다.
    **3개 툴팁이 이 한 문자열을 공유**한다 — 손복제 금지. 검증 #100.
  - **⚠️ null 계약 — 모르는 값을 0.00%로 단언하지 않는다**: 등락률 미확보(null/undefined/빈 문자열/
    손상값)면 **열 자체를 렌더하지 않는다**(일간 지표 `dodAbsChange` 규약과 동일). 판정은 **타입까지**
    본다 — `Number('')`·`Number([])`·`Number(false)`가 전부 0이라 손상값이 '변동 없음'으로 통과한다.
    `changeRate ≤ −100`(전일 종가 복원 불가)·현재가 0 이하도 미표시. 검증 #85~#91.
  - **⚠️ 표의 열 수는 단일 파생 상수 `colCount = showRate ? 6 : 5`** — thead th·tbody td·빈 사다리
    `colSpan` **세 지점**이 갈리면 그 행부터 표 정렬이 통째로 깨진다(분배금 표 '렌더 지점 23곳'과
    동일 클래스). th·td 모두 `showRate` 게이트 안에 있어야 한다. 검증 #93·#98.
  - **⚠️ 가드는 선언이 아니라 '사용부'를 단언할 것**: 옛 가드는 `const rowRate = …` **선언만** 봐서
    ① 등락률 td 통째 삭제 ② `showRate` 래퍼만 제거 ③ `rateText(rowRate)` → `rateText(curRate)`
    바꿔치기 **세 변이가 전부 1153건 초록으로 통과**했다(적대적 리뷰가 실행으로 실증).
    #94·#98은 렌더 지점을 직접 매칭한다. `verify:backtest` #259g와 같은 규약.
  - **⚠️ 모달 폭 440 ↔ 가로 클램프 456 · 요약 높이 ↔ 세로 클램프 560은 짝**
    (`RebalancingPanel`의 `window.innerWidth - 456` / `window.innerHeight - 560`).
    폭·요약 줄 수를 바꾸면 같이 고칠 것 — 안 그러면 화면 가장자리 종목에서 모달이 잘린다. 검증 #97.
  - 값 전달은 `RebalancingPanel`의 `ladderChangeRate`(라이브 파생) 하나 — 표의 등락률 열과
    **같은 소스**라 두 화면이 갈리지 않는다. 해외계좌는 USD 가격의 등락률이라 환산이 없다.

**모달 props는 스냅샷이 아니라 '살아 있는 행' — 열 때 현재가를 재조회한다 (⚠️ 회귀 주의)**

현재가 셀을 눌러 계산기를 열면 **그 종목의 현재가를 즉시 재조회**한다(`onRefreshPrice` =
App의 `handleSingleStockRefresh`). 목표 금액이 현재가에서 파생되므로 낡은 가격으로 열면 사다리
전체가 낡는다(사용자 요청 2026-08).

- **⚠️ `ladderModal` state는 `{ itemId, pos, side }` **셋만** 담는다 — 가격·수량·목표금액·등락률·
  통화·환율을 복사해 들고 있으면 **재조회한 새 가격이 화면에 영영 닿지 않는다**. 게다가 목표 금액의
  분자인 `action`은 `usePortfolioData`가 포트폴리오 전체 목표에서 재계산하는 값이라 모달 안에서는
  되돌릴 수 없다(재조회가 돌려주는 것은 price 하나뿐) → `rebalanceData.find(d => d.id === itemId)`로
  **매 렌더 다시 읽는다**. 파생식은 `renderRow`의 그것과 **문자 그대로 같아야** 한다.
- **⚠️ `side`만은 여는 시점에 박제한다 — 라이브 파생 금지**: '추가' 칸은 같은 표에서 사용자가
  편집하고 `maxAddLink` 유지 effect가 자동으로도 채우므로, 열어 둔 채 `totalAction`이 0이 되거나
  부호가 뒤집힐 수 있다. 라이브로 파생하면 그 순간 분할**매도** 계산기가 제목·색·`dir`까지 통째로
  분할**매수** 계산기로 뒤집힌다(사용자가 연 적 없는 창). 열림 게이트(`ladderOpenable = totalAction
  !== 0`)는 `renderRow`에만 있어 **모달 렌더 경로를 막지 못한다**.
  대신 부호가 어긋나면 **명시적으로 미적용**한다 — `ladderSignOk`가 false면 목표 금액·기준 수량을
  0으로 넘기고 `emptyReason`으로 사유를 밝힌다. ⚠️ 이때 빈 사다리 기본 문구('목표 금액이 1주 값보다
  작습니다')를 재사용하면 **거짓 설명**이 된다(실제 원인은 1주 값 미만이 아니다).
- **⚠️ `key={ladderModal.itemId}` 필수** — 없으면 A종목 계산기를 연 채 B종목 현재가를 눌렀을 때
  같은 인스턴스가 재사용돼 A의 지정 단가·호가·배수가 **B의 사다리에 그대로 적용**된다(8천원대 핀이
  55,000원 종목에 박힌다).
- **부수효과는 `handleSingleStockRefresh` 그대로** — `PortfolioTable`의 '클릭하여 현재가 새로고침'과
  **같은 함수**라 종목명·현재가·등락률 갱신과 `stockHistoryMap` 스탬프가 함께 일어난다(리밸런싱 표의
  현재가 셀이 '읽기 전용'이 아니게 된 것은 의도된 변화다).

**사용자가 입력한 단가(핀)는 호가·배수·현재가가 바뀌어도 살아남는다 (⚠️ 회귀 주의)**

옛 `doRegenerate`는 `buildLadder` 결과를 그대로 `setRows` 해서 사용자가 넣은 단가를 통째로 지웠고,
그래서 호가를 한 칸만 고쳐도 "내가 입력한 매수단가가 이전 가격으로 되돌아가는" 버그가 났다(사용자 보고 2026-08).

- **저장은 `pinnedPrices`(rowId → price)** — `handleRowPriceBlur` 커밋에서만 심고 `unlockRow`에서
  지운다(⚠️ 지우지 않으면 '잠금 해제'가 다음 재생성에서 되살아나 아무 일도 하지 않은 것처럼 보인다).
  ↺ 초기화는 핀을 통째로 비운다.
- **⚠️ 핀은 재생성 effect deps에 넣지 말 것** — 단가를 하나 커밋할 때마다 사다리가 통째로 다시 만들어져
  그 순간 수량 편집이 날아가고 스크롤도 튄다. effect는 `pinnedRef.current`로만 읽고 deps는
  `[currentPrice, tickSize, targetAmount, side, mult]` **그대로** 유지한다.
- **⚠️ 수량 편집(`handleRowQtyChange`가 세우는 `locked`)은 일부러 보존하지 않는다** — 배수·호가 간격이
  수량 배분 자체를 재정의하는 값이라, 옛 수량을 들고 가면 새 배수와 정면으로 모순된다.
- **⚠️ 핀이 사다리 반대편으로 넘어가면 적용하지 않는다**(`pinFits` = `dir * (pin − price) >= 0`):
  핀은 절대 가격이라 현재가 재조회·호가 변경으로 base가 옮겨지면 반대편으로 넘어갈 수 있고, 그대로
  앵커로 삼으면 **같은 가격이 두 행에 찍힌다**(실측: 매수 base 9,700 · 호가 100 · 핀 r2=9,900 →
  9,700/9,600/9,900/9,800/9,700/9,600 — r0과 r4, r1과 r5가 같은 값 = 같은 가격에 두 개의 주문).
  이 상태는 사용자가 만든 적이 없고 **base 이동이 자동으로 만든다**.
  ⚠️ 방향 **안쪽**의 비단조(사용자가 r2를 r1보다 비싸게 지정)는 막지 않는다 — 직접 입력해 만든
  상태이고, 수동 편집이 목표금액 초과까지 허용하는 것이 이 계산기의 기존 계약이다.
  ⚠️ 적용하지 못한 핀을 `pinnedPrices`에서 **지우지는 않는다**(시세가 잠깐 튀었다 돌아오면 되살아나야
  한다 — 사라진 인덱스의 핀과 같은 규약). 대신 모달 안 **앰버 안내 띠**가 미반영 건수와 ↺ 탈출구를
  알린다(z-1050이라 `notify()`·`ConfirmDialog`가 가려지므로 피드백은 반드시 모달 내부 인라인).
  **알려진 한계(의도)**: 매수 사다리에 현재가보다 **높은** 단가를 직접 입력하면 그 세대에는 적용되지만
  다음 재생성에서 방향 게이트에 걸려 빠진다(안내 띠가 그 사실을 알린다).
- **⚠️ 핀이 0건이면 `applyPins`가 `built`를 그대로 반환한다** — `recalcAllPrices`(핀 0개)는
  `buildLadder` 출력과 대수적으로 같지만, 조기 반환이 있어야 "핀이 없으면 종전과 1원도 다르지 않다"가
  논증이 아니라 **구조로 보장**된다(하위호환의 축).
- **⚠️ `solveQtyForAmount`는 종전대로 핀을 보지 않는다** — 수동 편집이 목표금액을 넘으면 기존처럼
  '초과'로 경고한다(기존 계약 유지). 핀 키는 **행 인덱스**(`r0`,`r1`…)라, 호가·배수를 바꿔 행 수가
  달라지면 사라진 인덱스의 핀은 조용히 무시되고 다시 길어지면 되살아난다(사용자 시나리오는 r0).

**Enter로 커밋 (⚠️ 회귀 주의)**

매수단가·수량 칸은 blur뿐 아니라 **Enter**로도 반영된다(사용자 요청 2026-08 — 그전에는 마우스로 다른
곳을 클릭해야만 단가가 반영됐다).
- **⚠️ Enter는 `blur()`만 부른다** — 호가·배수 칸처럼 '커밋 후 blur'로 쓰면 이어지는 blur 핸들러가
  **stale 클로저의 초안**으로 한 번 더 커밋한다(값은 같지만 `setRows`가 두 번 돌아 재앵커가 중복된다).
  커밋 경로는 `onBlur` 하나로 유지한다.
- **⚠️ JSX 속성 위치에는 어떤 주석도 넣을 수 없다** — 근거 주석은 `<td>`의 children 위치에 `{/* */}`로 둔다.

- **영속화 지점 0곳** — 사다리는 계산기일 뿐 아무것도 저장하지 않는다(호가·배수·행 편집·지정 단가 전부
  모달 로컬 state). `portfolioStructureKey`·`applyStateData`·`applyBackupData`·저장 effect deps 전 지점 무관.
  ⚠️ 단 **현재가 재조회는 예외가 아니라 기존 경로 재사용**이다 — `handleSingleStockRefresh`가 하는
  `setPortfolio`(currentPrice·changeRate·name)와 `stockHistoryMap` 스탬프는 `PortfolioTable`의 현재가
  클릭과 완전히 동일하다.
- **범위 밖(의도)**: 실제 주문 전송, 호가단위 규정(가격대별 틱) 자동 적용, 수수료·세금, 부분 체결 추적,
  핀 적용 후 수량 재산출(목표금액 초과는 종전대로 '초과' 경고로만).
- 검증: `npm run verify:ladder` (참조 구현 미러 #1~#45 + **금액 앵커 #58~#77** + **전일 대비 등락률
  #80~#91·#99b·#99c** + **지정 단가 보존·방향 게이트 #101~#107·#115~#116** + 배선 가드
  #46~#57·#72~#73·#78~#79·**#92~#100**·**#108~#114·#117~#119**).
  ⚠️ 등락률 가드는 변이 8종(td 삭제·게이트 제거·값 바꿔치기·왕복 복귀·툴팁 단언 복귀·폭/클램프 복귀)으로,
  **현재가 재조회·핀 보존·Enter 커밋 가드는 변이 14종**(side 라이브 파생 복귀·`key` 제거·방향 게이트
  제거·재생성이 핀을 버림·Enter 제거·재조회 제거·스냅샷 복귀·`emptyReason` 제거·안내 띠 제거·부호 게이트
  제거·핀 커밋 제거·잠금 해제가 핀을 안 지움·조기 반환 제거·App 배선 제거)으로 **실제 검출을 확인**했다.
  가드를 손볼 때 같은 변이가 여전히 잡히는지 다시 확인할 것.
  ⚠️ `#115b`는 **게이트를 뺀 코드가 실제로 중복 가격을 만드는지**를 함께 단언한다 — 지우면 #115가
  동어반복이 된다.
  ⚠️ 호출 개수를 상수로 못 박지 말 것(#48은 `=== 2`에서 '선언을 뺀 **모든** 호출이 dir을 넘긴다'로
  강화됐다). 그리고 그 카운트는 반드시 `stripComments`를 거친다 — 이 저장소는 금지 근거를 바로 그
  자리 주석에 적으므로, 원문으로 세면 주석 속 함수 이름이 유령 호출로 잡혀 가드가 영구히 실패한다.
  ⚠️ prop **순서(인접성)** 를 단언하지 말 것(#92는 그 형태였다가 신규 prop 하나로 우연히 통과했다).
  ⚠️ 미러는 `LadderTradeModal.tsx` **원문에서 순수 함수 구간을 잘라** 평가하므로 별도 동기화가 필요 없다.
  단 `dir`·`side`·앵커를 컴포넌트가 실제로 넘기는지는 산술로 표현할 수 없어 **정규식 가드**가 맡는다 —
  실패 시 **먼저 정규식이 낡았는지 확인**하고, 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

### 리밸런싱 백테스트(backtestScenarios) — 분배락 전 리밸런싱 시뮬레이터 (⚠️ 회귀 주의)

상단바 **백테스트 아이콘**(`UserInfoBar` — 자금 흐름도 **바로 오른쪽**, 인라인 SVG `BacktestIcon`)으로
여는 별도 페이지. 기간·초기투자금·종목·목표(금액/비중)·리밸런싱 정책을 넣으면 앱에 저장된 일별 종가와
계좌 분배금 이력으로 월별 매매일지를 재현한다. 설계 원본은 사용자가 제공한
"커버드콜 포트폴리오 실전 리밸런싱 백테스트" PDF다.

- **일정 규칙 = PDF에서 역산**(요청서 서술과 하루 차이가 나므로 반드시 이쪽): 지급기준일 = 월중
  **15일** / 월말 **말일**(휴장이면 직전 영업일) → **분배락 = 기준일 −1영업일** → **리밸런싱 =
  분배락 −1영업일 = 기준일 −2영업일**(분배금을 받을 수 있는 마지막 매수일, T+2 결제) → **지급 =
  기준일 +2영업일**. 2026 KRX 캘린더로 돌리면 PDF의 리밸런싱일 **14개 중 12개가 정확히 일치**하고,
  어긋나는 2개(3/29·6/28)는 **PDF가 일요일을 쓴 오류**다. 오프셋 3개는 화면에서 조정 가능.
- **⚠️ 최대 발견 — 구조 변경 매매는 '리밸런싱 차익'에 계상하지 않는다**: PDF 4월 합계
  `25,859,200`이 산술적으로 안 맞아 보이지만 **회색 음영 3행(4/21 종목 재편)을 빼면 정확히 일치**한다
  (`2,068,000 + 1,286,200 + 22,505,000`). → `BtTrade.structural` 플래그로 분리해 `tradeNet`(정기)와
  `structuralNet`(재편)을 따로 집계한다. 재편 잔돈(매도 152,963,200 − 신규매수 150,000,000 =
  2,963,200)은 현금으로 편입된다. **합치지 말 것.**
- **PDF 자체 오류 3건**(엔진은 정확히 계산): ① 2월 누적 분배금이 1월분을 빠뜨려 7월까지 전파
  (최종 `36,815,305` → 정답 `42,417,182`) ② 3/29·6/28이 일요일 ③ 4/28 TIGER만 유일하게 반올림
  (다른 19건은 전부 내림) + 매도금액 500원 불일치.
- **⚠️ `rounding:'floor'`는 `Math.floor`가 아니라 `Math.trunc`(0 방향)**: 매도(음수)에 `Math.floor`를
  쓰면 `−594.66 → −595`가 되어 매도량이 1주 늘고 이후 전 구간 수량이 어긋난다. PDF 20건 중 19건이
  trunc로 정확히 재현된다.

- **⚠️ 분배 일정과 리밸런싱 일정은 완전히 독립**(`buildDividendSlots`는 `config.policy`를 절대 보지
  않는다): 리밸런싱을 월말로 몰아도 월중 분배 종목은 여전히 15일 기준으로 분배받는다. 한 함수로
  합치면 `policy:'allEom'`에서 월중 종목의 분배락이 통째로 월말로 밀린다.
- **⚠️ 월별 오버라이드는 `rebalDate`만 옮긴다** — 분배락·지급일은 시장이 정하는 값이라 사용자가
  옮기면 권리 확정 수량이 실제와 달라진다.
- **⚠️ tfoot의 평가액 합계 2열은 '같은 종목이 그 달에 2회 이상 거래되면' 비운다(`dupTraded`)**:
  `evalBefore`/`evalAfter`는 그 거래 시점의 **포지션 전체 평가액(레벨)** 이라 거래 단위로 더하면
  같은 종목이 중복 계상된다. 재편 이벤트와 정기 리밸런싱이 겹친 달에서 **실측 2.17배**
  (PDF 픽스처 4월 ₩975,044,100 vs 실제 월말 ₩450,022,400), 일부 종목만 거래된 달은 0.67배로 과소.
  첨부 PDF도 정확히 그런 달(4월)의 합계를 `-`로 비워 뒀다 — 그 규약을 따른다. **화면 tfoot과
  `downloadCsv`의 `{ym} 합계` 행이 같은 판정을 공유**해야 한다(검증 #75·#78·#80).
  ⚠️ '종목별 마지막 거래만 합산'으로 고치지 말 것 — 그 달에 거래가 없던 종목이 빠져 여전히 틀린다.
- **⚠️ 거래·분배가 없어도 `m.holdings`가 있으면 그 달을 렌더한다**: 월 블록 조기 반환은
  `!rows.length && !orphans.length && !m.holdings.length`여야 한다. `downloadCsv`는 `result.months`를
  **무조건** 돌므로, 화면에서만 스킵하면 "CSV엔 있는데 화면엔 없는 달"이 생긴다(검증 #77·#79).
- **월별 표의 '조정 후 평가액'과 '월말 보유 현황'은 성격이 다르다 — 합치지 말 것**:
  전자는 `BtTrade.evalAfter`(= 조정 후 수량 × **그 리밸런싱일** 종가)라 종목마다 날짜가 다를 수 있고,
  후자는 `BtMonth.holdings`로
  **그 달 마지막 영업일(`BtMonth.lastDate`) 종가에 전 종목을 같은 시점으로 평가**한 값이라
  `Σ evalAmount = evalEnd` · `evalEnd + cashEnd = totalEnd`가 성립한다. 시점 정합이 필요한 곳에는
  반드시 `holdings`를 쓸 것.
  ⚠️ **`holdings`는 그 달에 매매가 없던 종목도 포함**해야 한다 — 리밸런싱 표에는 그 달 거래된 종목만
  행이 생기므로, 빼면 "이번 달에 안 건드린 종목이 몇 주인지" 확인할 방법이 사라진다(검증 #69).
  ⚠️ 월말 수량은 **러닝 누적 맵(`runQty`)** 으로 구한다 — 달마다 처음부터 다시 더하면 O(월²×거래)다.
  `m.trades`를 누적한 **뒤에** 평가해야 그 달 거래가 반영된다(검증 #72).
  ⚠️ `lastDate`는 **기간 끝(`endBiz`)으로 캡**한다 — 안 하면 조회기간 밖 종가로 마지막 달을 평가한다(#73b).
- **⚠️ 표는 분배락월 / 현금은 지급월**: `BtMonth.dividends`·`divAccrued`는 **분배락 기준 월**(PDF의
  '지급 분배금' 열이 리밸런싱 행 옆에 붙는 형식, 앱 전체 `dividendHistory` 저장 키 규약과 동일),
  예수금은 `divPaid`(지급일 기준)로만 움직인다. 월말 분배는 지급일이 다음 달 초라 **한 달 어긋나는
  것이 정상**이다. 하나로 합치면 PDF 재현(1월 5,601,877)이 깨지거나 현금 흐름이 틀린다.
- **⚠️ 비중 모드 초기매수의 분모만 예외로 투입 자본**: 평소 분모(종목 평가액 합계)를 그대로 쓰면
  그 시점 평가액이 0이라 목표가 전부 0 → **아무것도 사지 않는다**(비중 모드가 통째로 죽는다).
- **⚠️ 매도/매수 분할은 실행 전에 확정**(`plans` 배열): 실행 중 다시 판정하면 방금 매도해 목표에
  맞춰진 종목이 매수 패스에 또 걸리고, 재원이 마련되기 전에 매수가 예수금 한도에 막혀 조용히
  목표 미달로 끝난다(PDF 4/21 재편이 정확히 이 형태다).
- **⚠️ `shiftBusinessDays(s, 0)`은 `onOrBefore`**(onOrAfter 아님) — 오프셋 0 설정에서 백테스트가
  미래 종가를 당겨 쓰지 않게 하는 보수적 기본값(`priceAt`의 carry-back 금지와 같은 원칙).
- **⚠️ `priceAt`은 carry-forward만**(직전 종가 이월). carry-back을 허용하면 백테스트가 미래 정보를 쓴다.

- **⚠️ 조회한 종가를 `stockHistoryMap`에 절대 병합하지 말 것**: 그 맵은 `buildCloseEvalSeries`(보유
  평가액 재계산)와 `useAutoConfirmHistory` 데이터완비 가드의 권위 소스라, 백테스트용 수정주가/펀드
  NAV가 섞이면 보유+백테스트 중복 코드의 과거 평가액이 **영구히 오염**된다(WatchlistPopup 불변식과
  동일). 조회 결과는 App의 **`btFetched` 로컬 맵**에만 담는다(`src/backtestFetch.ts` 상단 주석).
  `btPrices = {...stockHistoryMap[c], ...btFetched[c]}` — **조회분이 우선**(사용자가 ⟳로 고친 값이
  낡은 저장값에 가려지면 안 된다).
- **⚠️ 편집은 로컬 사본 + 2.5초 idle 승격**(FlowBoard와 동일): 목표금액·기간을 타이핑할 때마다
  `setBacktestScenarios`를 하면 **글자마다** `portfolioStructureKey`가 전 계좌를 재직렬화하고
  STATE+VERSION+STOCK+MARKET 4파일 write가 나간다. 회수는 `App.tsx backtestFlushRef` ←
  BacktestPage가 마운트 시 등록·**언마운트 시 null**. 미승격 편집이 없으면 커밋은 **반드시 null 반환**.
- **⚠️ 종료 커밋 합성 3원**: `exitCommitRef`가 리밸런싱·흐름도·백테스트를 합친다. 반환 키가 겹치지
  않아 순서는 무관하나 **셋 다 없으면 null**을 반환해야 alt-tab마다 4파일 write가 강제되지 않는다.
  수동 저장 4핸들러(`handleSave`·`handleDriveSave`·`handleDownloadStateFile`·`handleAppClose`)도
  `flushBacktestSnapshot()` **동기 주입 필수**.
- **영속화 7지점**: `App.tsx` ① `useState` ② 지문 `backtestFingerprint(backtestScenarios)` ③ 저장
  payload 리터럴 ④ 저장 effect deps ⑤ `applyStateData`(`normalizeBacktestScenarios`) ⑥
  `applyBackupData`(sticky) + `useDriveSync.ts` ⑦ `_preserveStickyPersonalData`.
  sticky 판정은 **`backtestScenariosHaveContent` 공유 함수**(length 금지 — 페이지를 열기만 해도 빈
  시나리오가 생겨 백업 복원 경로가 영구히 막힌다). `backtestFingerprint`는 화이트리스트 투영 +
  try/catch로 **절대 던지지 않는다**(던지면 그 세션 Drive 저장이 통째로 멈춘다).
  ⚠️ **`BtConfig`에 시세 시계열을 넣지 말 것** — STATE는 백업 22본으로 복제된다. 코드 참조만 저장.

- **⚠️ 파생 memo는 `btActive`(페이지를 연 뒤)에만 계산**: `btDividends`·`btNameByCode`·`btCatalog`는
  deps에 `portfolios`·`stockHistoryMap`이 있어 시세 갱신마다 전 계좌 스냅샷과 전 종목 일봉을 훑는다.
  백테스트를 안 쓰는 사용자가 그 비용을 치를 이유가 없다(FlowBoard를 `flowAccess` 안에 둔 것과 동일).
- **⚠️ `holidays` prop에 `marketHolidays?.kr || []`를 직접 넘기지 말 것** — 매 렌더 새 배열이라
  결과 `useMemo` 의존성이 매번 깨져 **시세 갱신마다 백테스트 전 구간이 재계산**된다(`btHolidays` memo).
- **⚠️ 주당 분배금 셀은 로컬 draft 입력**(`DivInput`): 표시값이 220ms 디바운스된 계산 결과라
  onChange로 곧장 커밋하면 controlled value가 옛 값으로 되돌아가 `"170"`을 치면 `"1"`만 남는다.
- **⚠️ lucide 아이콘은 저장소에 이미 쓰는 것만**: `package-lock.json`도 `node_modules`도 없어 새
  아이콘이 0.577.0에 실재하는지 확인할 수단이 없고, 없으면 undefined 컴포넌트 렌더로 페이지가 죽는다.
  특히 **`AlertTriangle`은 lucide 0.4x에서 `TriangleAlert`로 개명**됐다 → `AlertCircle`을 쓴다.
  상단바 아이콘은 `UserInfoBar`의 인라인 SVG `BacktestIcon`(FlowIcon과 동일 근거).

- **PDF 저장 = 브라우저 인쇄**(외부 npm 의존성 0 — `package-lock.json` 부재로 의존성 추가가
  프로덕션 흰 화면을 낸 이력). **⚠️ `createPortal(content, document.body)` 필수** — 인쇄 규칙
  `body > *:not(.bt-shell){display:none}`이 성립하려면 두 모드(새 창/오버레이) 모두에서 `.bt-shell`이
  body 직계 자식이어야 한다. visibility 토글로 우회하면 숨겨진 앱 본문이 자리를 차지해 **빈 페이지
  수십 장**이 딸려 나온다. 인쇄 CSS는 다크 테마를 **검정 글씨+흰 배경으로 뒤집고** 손익 색만
  진한 인쇄색으로 되살린다(그대로 인쇄하면 흰 종이에 밝은 회색 글씨라 판독 불가).
- **별도 브라우저 창** `/?backtestWindow=1` — `main.tsx` `BACKTEST_WINDOW_BOOT`. 흐름도 창과 **완전히
  같은 규약**(App 미마운트 · `noopener` 금지 · `ping.need`가 초기 전송의 유일한 트리거 · 재입양 ·
  끊기면 `readOnly`). 프로토콜: 창→앱 `backtest:ping{need}`·`backtest:scenarios`·`backtest:want{code,data,force}`
  / 앱→창 `backtest:data`(카탈로그·분배금·휴장일, 지문 게이팅)·`backtest:live`(시나리오·시세·조회중)·`backtest:pong`.
  시세는 **교체가 아니라 병합**(지문 게이팅 때문에 부분 전송이 정상 경로).
- **게이팅 = 승인 시트 L열 `backtestEnabled`**(index 11). Apps Script 6지점(`check`·`listUsers`·
  `getFeatureLabels` E1:L1·`setUserFeature` colMap·`addUser` appendRow·`setupSheet` L1/E2:L100) +
  프론트(`LoginGate` `UserFeatures`/`EMPTY_FEATURES`/`pickFeatures` **3곳만**, `App.tsx` 초기값·
  `backtestAccess`, `AdminPage` 라벨·featureDefs, `UserInfoBar` `canAccessBacktest`).
  ⚠️ **배포 순서는 프론트 먼저 → Apps Script 나중**(`loadFeatureSettings`의 `>= 6` 인덱스 머지가
  구버전 응답을 우아하게 처리한다). ⚠️ `backtestAccess = isAdminUser || userFeatures.backtestEnabled` —
  없으면 관리자 본인이 영구 접근 불가(AdminPage 토글은 `!isAdminUser` 조건이라 관리자 행에 미렌더).
- **impersonation은 읽기 전용**(`readOnly={!!adminViewingAs}`) — 흐름도와 같은 근거(undo 없음 + sticky).
- **소프트 상한**: 시나리오 10 / 종목 20 / 이벤트 40 / 오버라이드 120.
- **범위 밖(의도)**: 세금·거래수수료·슬리피지·해외종목(원화 단일 통화)·undo/redo.
  **알려진 한계**: 인앱 오버레이 인쇄는 앱 본문 높이만큼 빈 페이지가
  뒤에 붙을 수 있다(주 경로인 별도 창은 깨끗하다). 인앱과 새 창을 동시에 열면 마지막 쓰기가 이긴다.
- **⚠️ 월별 표는 12열이다** — 열을 더하거나 뺄 때 `thead`·정상 거래 행·**orphan 행(colSpan 4 포함)**·
  `tfoot`(colSpan 3 포함) **네 곳을 모두** 고쳐야 한다. 한 곳만 놓치면 그 행부터 표 정렬이 통째로
  어긋난다(분배금 표 '렌더 지점 23곳' 사고와 동일 클래스). CSV 헤더(13열)와 모든 `rows.push` 길이도
  같이 맞출 것 — 짧으면 엑셀에서 열이 조용히 밀린다.
- **화면 레이아웃 규약 (2026-08 사용자 요청 — 되돌리지 말 것)**:
  - **설정 섹션은 기본이 '닫힘'**(`Section`의 `defaultOpen = false`). 대신 접힌 상태에서도 무엇으로
    설정돼 있는지 보이도록 호출부가 `badge`에 **현재 값을 요약**해 넘긴다 — 안 그러면 '숨은 설정'이 되어
    사용자가 이유를 모르는 결과를 본다. ⚠️ 비교 뷰의 '비교할 시나리오 고르기'만 `defaultOpen`(그 패널의
    유일한 내용이라 닫으면 빈 화면이 된다).
  - **⚠️ `Section` 헤더는 div + 내부 토글 버튼**이다. 헤더 자체를 `<button>`으로 되돌리면 `?`(`Hint`)가
    **버튼 중첩**(잘못된 DOM)이 된다.
  - **⚠️ `Section` 루트에 `shrink-0` 필수**(2026-08 사용자 보고 "브라우저를 확대하면 항목이 겹친다"):
    설정 스크롤 영역이 `flex flex-col`이라 내용이 패널 높이를 넘으면 flex 기본값 `flex-shrink:1`이
    각 섹션을 자연 높이 아래로 눌러 버리고, 루트가 `overflow-hidden`이라 눌린 만큼 제목 줄이 잘려
    위아래와 겹쳐 보인다(확대할수록 CSS px 뷰포트가 짧아져 심해진다). 새 직계 자식을 추가할 때도
    같이 붙일 것. 검증 #154.
  - **상세 안내는 `?` 호버 팝오버(`Hint`)로만** 띄운다. ⚠️ 팝오버는 반드시 `position: fixed` +
    `getBoundingClientRect` — 설정 패널이 `overflow-y-auto`인데 CSS는 한 축만 지정해도 **다른 축이 auto로
    계산**되므로 일반 absolute 툴팁은 패널 안에서 잘려 아예 안 보인다. 스크롤·리사이즈에는 즉시 닫는다.
    ⚠️ `?` 버튼에 네이티브 `title`을 달지 말 것(브라우저 툴팁이 팝오버 위에 겹친다).
    ⚠️ **높이 상한(`pos.maxH`) + 내부 스크롤 필수** — 없으면 확대 화면(= 짧은 CSS px 뷰포트)에서 긴
    설명이 화면 밖으로 흘러 아래가 통째로 잘린다. 그 짝으로 **스크롤 캡처 리스너에 팝오버 내부
    예외**(`closest('[data-bt-pop]')`)를 둔다 — 없으면 안에서 스크롤하는 순간 닫혀 끝까지 읽을 수 없다.
    배치 스타일은 `Hint`·`SummaryCard`가 **`popStyle` 한 함수를 공유**(손복제 금지). 검증 #155.
    ⚠️ **결과 하단 각주는 예외 — 접지 않는다**. PDF만 받아 본 사람이 계산 규약을 확인할 유일한 자리다.
  - **⚠️ 팝오버 지연 닫기 4경로는 한 세트다**(`useHoverPop`, `POP_GRACE_MS` 140ms — 검증 #259g,
    아래 부속 4가지도 같은 가드가 지킨다):
    팝오버는 앵커의 **형제**라 마우스를 올리는 순간 앵커 `onMouseLeave`가 뜬다 → 옛 코드에서는
    팝오버 위로 갈 수가 없어 위의 '내부 스크롤 예외'가 **마우스 경로에서 死코드**였다(내용이 `maxH`를
    넘으면 읽을 방법이 아예 없었다). ① `open()`이 대기 타이머를 **먼저 취소**(카드 간격이 8px이라
    스쳤다 되돌아오는 왕복이 흔한데, 안 지우면 '호버 중인데 닫힌 채'로 남는다) ② 팝오버
    `onMouseEnter` → `enter`(cancel) ③ 팝오버 `onMouseLeave` → `leave`(**재예약** — 빠지면 z-1200
    패널이 영구 고착돼 아래 표의 클릭을 삼킨다) ④ scroll/resize·`onBlur`·`Hint` 클릭·언마운트는
    `closeNow`(**즉시** — 좌표가 낡은 채 140ms 남으면 안 된다).
    부속 4가지(전부 적대적 리뷰가 변이 테스트로 실증한 실결함이다):
    ⚠️ **열린 팝오버는 하나뿐**(모듈 스코프 `closeOpenPop` — `open()`이 직전 것을 즉시 닫고
    언마운트에서 등록 해제). 없으면 인접 카드로 옮기는 상시 동작에서 두 장이 140ms 겹친다.
    ⚠️ **`onBlur`는 `blur`**(= `overRef`가 서 있으면 무시) — 앵커가 `tabIndex={0}`이라 카드를 한 번
    클릭하면 포커스가 잡히고, 그 상태로 팝오버 안을 mousedown 하면 focusout이 떠서 팝오버가 즉시
    사라진다(드래그 선택·복사 불가). ⚠️ `popStyle`에 **`overscrollBehavior: 'contain'`** — 없으면
    끝까지 스크롤한 다음 틱이 조상으로 체이닝되고 그 scroll 이벤트가 읽던 팝오버를 닫는다.
    ⚠️ 가드는 **사용부**를 단언해야 한다 — 상수 선언·존재 여부만 보면 `<col>`을 퍼센트로 되돌리거나
    `off` 핸들러를 지연 close로 되돌려도 375/375가 그대로 통과하는 **죽은 단언**이 된다.
  - **⚠️ 2열 계산식 표(`formula`)의 값 셀은 `whitespace-nowrap`이라 긴 문장을 넣지 말 것**: auto 레이아웃
    이라 그 열이 고유폭을 전부 요구하고 라벨 열이 최소폭으로 압축돼 **한글이 글자 하나당 한 줄**로
    무너지고 값은 팝오버 밖으로 잘린다(2026-08 사용자 보고 — 시그널 체결 카드). 값은 `₩` 한 덩어리여야
    하고, 가변 길이 사유는 **왼쪽 라벨에 붙인다**(연간 증액 카드가 같은 조건이라 함께 고쳤다).
    사건 목록처럼 문장이 본체인 카드는 `SummaryCard`의 **`popRender(w)`** 탈출구를 쓴다 —
    `popWidth`(시그널 980)로 폭을 키우고 **측정된 실폭에서 px로 계산한 `table-fixed` colgroup**으로
    그린다(퍼센트 금지: 좁아지면 날짜 열이 61px 아래로 떨어져 `2026-\n01-\n16`이 재현된다).
    폭이 `SIG_WIDE_MIN`(720) 미만이면 **표를 포기하고 사건별 블록**으로 떨어진다(블록 흐름은 어떤
    폭에서도 안 무너진다 — 이 페이지는 좁은 폭을 정식 지원한다). 문장은 `sigLabel`·`sigRefText`·
    `sigOutcomeText` 공유 포매터 그대로, 종목명은 **평문**(팝오버 안 버튼은 Tab 이동 시 앵커 `onBlur`가
    먼저 언마운트시켜 포커스가 날아간다). ⚠️ `popRender` 카드는 `formula`를 넘기지 않으므로
    `(formula || [])` 방어가 **필수**다(무방비 `.map`은 호버 순간 화면 전체가 오류 페이지가 되는데,
    `@ts-nocheck`+텍스트 가드라 어떤 게이트도 못 잡는다). ⚠️ 목록은 24건으로 자르되 **합계는 전 건**으로
    낸다. ⚠️ 열 폭 합에서 **세로 스크롤바 자리(`POP_SCROLLBAR_RESERVE`)를 빼야** 한다 — 이 앱의
    스크롤바는 오버레이가 아니라 자리를 차지하고(`src/index.css` `::-webkit-scrollbar{width:6px}`),
    이 팝오버는 스크롤되는 것이 기본 경로라, 여유가 0이면 스크롤바가 뜨는 순간 가로로 넘쳐
    마지막 열이 잘린다(그 가로 스크롤바는 팝오버 밖에서 닿을 수도 없다). 검증 #259f.
  - **설정 패널 접기**(`settingsOpen`, 상단 바 버튼 + 패널 헤더 '숨기기'): 넓은 화면은 왼쪽으로, 좁은
    화면(세로 배치)은 위로 접히고 얇은 띠만 남는다. ⚠️ **언마운트가 아니라 `hidden` 클래스**로 감춘다 —
    언마운트하면 각 섹션의 펼침 상태와 스크롤 위치가 매번 초기화된다. 세션 로컬 state라 **Drive 저장
    지점 0곳**(chartPrefs 5지점 무수정).
  - **표 크기는 화면/인쇄가 다르다**: 화면 `TBL/TH/TD`(13px·넉넉한 행 높이) ↔ 인쇄는 print CSS의
    `.bt-tbl` 규칙이 10px/3px 6px로 되돌린다. ⚠️ 그 두 줄을 지우면 **12열 월별 표가 A4 가로에서 잘려**
    판독 불가가 된다. 표를 추가할 때 `TBL`(=`bt-tbl` 포함)을 쓰지 않으면 인쇄에서 그 표만 커진다.
  - **종목명·종목코드 클릭 = 상세 페이지 새 탭**(`stockUrl`/`StockLink` — WatchlistPopup·CompStockChips와
    같은 판정). ⚠️ ⑥ 종목의 **이름 칸은 사용자가 고치는 `<input>`이라 링크로 만들 수 없다** — 코드와
    ↗ 아이콘이 진입점이다. 결과 표(Phase 0·월별·월말 보유·기말 보유)의 종목명은 링크다.
  - **`SummaryCards`는 `summary`가 아니라 `result`를 받는다** — 기말 예수금 분해 계산식에 `initialCashAfter`가
    필요하고, 그 값은 summary에 없다. 호버 팝오버의 각 항은 **result/summary의 같은 필드를 그대로** 읽는다
    (설명에서 값을 다시 계산하면 카드 숫자와 설명이 갈린다). 투입 원금은 `finalTotal − profit`으로 역산한다
    (`summary.initialCapital`은 추가 예수금을 빼고 담아 카드 값과 어긋난다).
- **목표 기준 2종 — 비중의 분모는 '종목 평가액 합계' **하나로 고정** (⚠️ 회귀 주의 — 분모 선택 부활 금지)**:
  사용자 정의(2026-08). **목표 금액** = 종목마다 직접 적어 넣은 금액(A 1,000만 · B 2,000만)에 맞춘다.
  **목표 비중 %** = 사용자가 직접 정한 비율(A 50% · B 50%)을 **종목 평가액 합계**에 곱한다 —
  **예수금·매매차익·누적 분배금은 분모에 넣지 않는다**(현금 잔고에 따라 사용자가 정한 비율이
  흔들리면 안 되므로). '종목 수로 균등 분배' 버튼은 두 모드 모두 유지.
  - ⚠️ 옛 분모 4종 선택 드롭다운(`ratioBase`: equity/total/initial/**totalWithDiv**(하락 시 되메우기))은
    **타입·엔진·화면·지문에서 통째로 제거**됐다. 되살리지 말 것(소스 가드 #151·#152가 식별자 부재를 단언).
    저장돼 있던 레거시 값은 `makeBtConfig`가 새 객체를 만들면서 조용히 버려진다(검증 #109·#109b).
  - ⚠️ **분모 0 자기잠금 방지 = `targetBaseAt`의 현금 부트스트랩**: 보유가 하나도 없으면 분모가 0 →
    목표 0 → 매매 0 → 보유 0 으로 **스스로 잠겨 한 주도 못 산다**. 실제로 걸리는 경로가 둘 —
    ① 전 종목이 기간 중간 편입 ② ⑦ 이벤트의 전면 교체(1단계 전량 매도가 4단계 분모 산출보다 먼저).
    그래서 `eq > 0 ? eq : max(0, cash)`로 그 시점 가용 현금을 쓴다(초기 매수가 투입 자본을 쓰는 것과
    같은 원리이고 그 시점 cash와 값이 같다). ⚠️ **평가액이 있으면 현금은 절대 섞이지 않는다** —
    `eq + cash` 형태로 바꾸지 말 것(검증 #106·#108·#108d, 소스 가드 #151).
  - ⚠️ **초기 매수만은 분모가 투입 자본**(`initialCapital + extraCash`)이다 — 그 시점 평가액이 0이라
    평소 분모를 쓰면 목표가 전부 0이 되어 아무것도 사지 않는다(검증 #43).
  - ⚠️ **비중 합이 100%가 아닌 것의 뜻이 달라졌다** — 1회성 현금 버퍼가 아니라 리밸런싱 **때마다**
    그 차이만큼 사고파는 지시다(80%면 매번 20%씩 팔아 평가액이 복리로 줄고, 120%면 매번 예수금을
    헐어 더 산다). 오타가 조용히 그렇게 돌면 안 되므로 **엔진이 경고**한다(`checkRatioSum`, 1회).
    현금은 분모가 아니지만 **매수 재원은 된다** — 이 둘을 헷갈리지 말 것.
    - ⚠️ 판정은 **그 시점 살아 있는 종목**의 합이다. `config.assets` 정적 합으로 재지 말 것 —
      ① 편입 기간이 갈린 정상 구성(A 100% → B 100%)이 정적 합 200%로 **상시 오탐**하고
      ② ⑦ 이벤트가 런타임에 바꾼 비중(`p.targetRatio` 덮어쓰기)의 진짜 오타는 **영영 미탐**이다
      (검증 #107e·#107f). 호출 지점은 초기 매수 직전 + 각 리밸런싱 슬롯(편입 처리 **뒤**).
    - ⚠️ **합 0%에 `sum > 0` 게이트를 두지 말 것** — 목표 금액 → 비중 모드로 전환하면 비중 칸이
      전부 비는 흔한 상태인데, 피해가 가장 큰(아무것도 안 삼) 그 경우만 정확히 건너뛴다.
      별도 문구로 알린다(검증 #107g).
    - ⚠️ 허용 오차 `RATIO_SUM_TOL = 0.05`는 반올림 잔차용(33.33×3=99.99)이다. 더 넓히면 진짜
      오타 가드가 죽는다. 대신 **생산자 쪽**(`splitEven`)이 잔여를 마지막 종목에 흡수시켜 합을
      정확히 100%로 만든다 — 앱 자신의 버튼이 앱의 경고를 띄우면 안 된다(검증 #156).
  - ⚠️ **매월 목표 증액은 비중 모드에서 집행되지 않는다** — 목표가 '평가액 합계 × 비중'이라 늘릴
    대상이 없다(그걸 유일하게 반영하던 분모 `'initial'`이 사라졌다). `contrib` 스텝 조기 반환 +
    슬롯 준비 블록에서 경고 1회. ⚠️ 행·'누적 증액' 카드만 찍고 매수는 0인 **'실행한 척'으로
    되돌리지 말 것** — 경고를 놓친 사용자가 결과를 정반대로 읽는다(검증 #90·#91·#91b·#153).
- **예수금 = `cashTrade` / 적립 분배금 = `cashDiv` — 사용자 정의(2026-08, ⚠️ 회귀 주의)**:
  '**예수금**'은 `매매차익 + 초기 매수 잔여 + 추가 예수금`만 가리킨다. **분배금은 예수금에 합산하지
  않고** `cashDiv`에 별도로 누적한다. 둘 다 현금이라 총자산에는 함께 들어가지만(총자산 = 평가액 +
  예수금 + 적립 분배금 3항), 화면·CSV의 '예수금'이라는 **이름은 매매 몫만** 가리켜야 한다.
  ⚠️ '월말/기말 예수금'을 `cashEnd`/`finalCash`(합계)로 되돌리지 말 것 — 그 순간 분배금이 예수금에
  합산돼 사용자 정의와 정면으로 어긋난다(옛 화면이 `합계 (매매 A · 분배금 B)`로 표시했다).
- **기말 현금 원천별 분해 — 항등식 **2개** (⚠️ 검증 #110·#304b)**:
  - `finalCashTrade = 초기 매수 후 잔여(+추가 예수금) + 누적 매매차익 + 종목 재편 순현금
    + 분배금 재투자 매수 + **cumDivDrawn**`
  - `finalCashDiv = cumDivPaid − **cumDivDrawn**`
  두 식을 더하면 종전 항등식(`finalCash = initialCashAfter + cumTradeNet + cumStructuralNet +
  cumReinvestNet + cumDivPaid`)이 그대로 복원된다 — 그래서 #110·#304가 계속 성립한다.
  `cumDivDrawn`(= Σ `BtMonth.cashUsedDiv`)이 **두 식을 잇는 유일한 항**이고, 예수금 쪽에 `+`로
  들어가는 이유는 "분배금이 대신 낸 매수 대금만큼 예수금이 덜 나갔다"이다. 기말 보유 표와 CSV가
  이 분해를 **두 그룹**으로 그대로 렌더하므로 깨지면 소계가 안 맞는다.
  ⚠️ 분배금은 반드시 **`cumDivPaid`(지급 기준)** — `cumDivAccrued`(분배락 기준)에는 지급일이
  종료일 이후라 아직 현금이 되지 않은 몫이 섞여 있어 항등식이 깨진다(검증 #110b가 이를 단언).
  두 값이 다르면 화면에 `(분배락 기준 ₩N)`을 병기한다.
  ⚠️ 원천징수 세금은 **어느 그룹에도 항으로 더하지 않는다**(애초에 입금되지 않은 돈이라 더하면
  두 항등식이 동시에 깨진다 — 분배금 항을 '세후'로 라벨링만 한다, 가드 #245).
- **두 주머니 구현 (⚠️ 불변식: `cashTrade + cashDiv === cash`)**:
  매도(+)는 `cashTrade`로, 매수(−)는 `cashTrade → cashDiv` 순으로 꺼낸다(`applyCash`).
  분배금 지급은 `cashDiv`로만 들어간다(`applyDividend`).
  - ⚠️ `cash += …`를 직접 쓰지 말 것 — 두 헬퍼를 우회하면 불변식이 조용히 깨진다(검증 #105·#108c).
  - **매수 대금의 출처를 월별로 기록한다**(`drawByYm` → `BtMonth.cashUsedTrade`/`cashUsedDiv`).
    ⚠️ **누적 매매차익이 마이너스인 달**에는 "이 매수를 무엇으로 충당했는가"가 화면에 없으면
    사용자가 추적할 수 없다(실제 문의 사례: 09월 순매수 −₩743,340). 월 요약에
    `이 달 매수 대금 = 예수금(매매차익) + 누적 분배금` 줄을 띄운다.
    항등식: `Σ cashUsedDiv = max(0, −(초기잔여 + 누적매매차익 + 재편순현금))`(검증 #112),
    `cashUsedTrade + cashUsedDiv = 그 달 총 매수 대금`(매도 제외, 초기매수 포함 — 검증 #111).
  - ⚠️ 월말 잔액은 `runCash`처럼 월별 합계로 **재구성할 수 없다**(매수가 어느 주머니에서 나갔는지는
    실행 순서가 정한다) → 시뮬레이션 중 `bucketLog` 스냅샷을 남기고 월말 이하 최신값을 집는다.
- **매월 목표 증액(재투자) `BtContribution` — 유휴 예수금을 목표에 얹는다 (⚠️ 회귀 주의)**:
  `{mode:'none'|'pctOfCash'|'amount', value, split:'ratio'|'even'}` + `contribOverrides[]`(특정 월만).
  그 달 **첫 리밸런싱일**에 `contrib` 스텝으로 실행 — `KIND_ORDER`에서 **pay 뒤**(그날 받은 분배금까지
  재원)·**rebal 앞**(올린 목표로 곧바로 매수). 증액 자체는 **현금을 움직이지 않고 목표만 올린다**.
  - ⚠️ **월 귀속은 `ymOf(rebalDate)`** — 슬롯 라벨 `s.ym`을 쓰지 말 것. 오프셋·휴장 스냅으로
    rebalDate가 다른 달로 나가면(`fixedDay` 1~3, 큰 음수 오프셋) 거래 없는 달에 증액 행이 뜨고
    실제 집행 달은 0으로 표시된다. 거래·분배 적재가 전부 `ymOf(실제 날짜)`라 여기만 다르면 내부 모순.
  - ⚠️ **배분 대상은 '그 달 리밸런싱 슬롯에 실제로 든 종목'** (`contribAssetsByYm`). `p.active`만
    보면 `rebalMode:'none'`·그 달 지정 날짜 없는 종목의 목표만 오르고 **영원히 매수되지 않아**,
    예수금 한도를 갉아먹으면서 '누적 증액'이 재투자되지 않은 돈을 보고한다(실측 배분액의 50%가 사장).
  - ⚠️ **비중 모드에서는 아예 집행하지 않는다**(2026-08) — 분모가 '종목 평가액 합계'로 고정되면서
    목표를 키울 수단이 사라졌다(위 '목표 기준 2종' 항목). `contrib` 스텝 조기 반환 + 경고 1회.
  - 예수금을 넘는 증액은 미리 자른다(넘기면 곧바로 '예수금 부족'). 집행 불가 예외 규칙
    (리밸런싱 없는 달·기간 밖·중복 ym)은 조용히 버리지 말고 경고한다.
- **종목별 리밸런싱 일정 `BtAsset.rebalMode` (⚠️ 회귀 주의)**:
  `'follow'`(기본, 전역 정책) / `'mid'` / `'eom'` / `'day'`(+`rebalDay`) / `'dates'`(+`rebalDates`) /
  `'none'`. 분배가 불규칙한 종목을 전역 정책과 다르게 돌리기 위한 것.
  - ⚠️ **월별 *일괄* 오버라이드(`assetId` 없음)는 `follow` 종목에만** 적용한다 — 개별 지정 종목까지
    끌고 가면 "일괄과 별개로 종목을 다르게"라는 요구 자체가 무너진다. 그 종목을 특정 월만 옮기려면
    `BtOverride.assetId`를 채운다(그 달 일정을 통째로 대체).
  - ⚠️ **`buildSlots`의 병합 키는 '날짜' 하나** — `${date}|${group}`으로 쪼개면 같은 날 리밸런싱
    스텝이 2회 돌아 **'전 종목 매도 → 그 다음 매수' 불변식이 깨진다**(1패스 매수가 아직 오지 않은
    2패스 매도 대금을 못 써 예수금 부족으로 잘리고, 비중 모드 분모(평가액 합계)가 패스 사이에 달라져
    결과가 그룹 순서에 의존한다). 그룹이 섞인 날짜는 라벨만 `'all'`로 둔다.
  - ⚠️ 슬롯이 하나도 없는 종목은 **중간 편입 경로가 사라진다**(활성화 계기는 초기매수·슬롯·이벤트
    셋뿐) → 기간 중간 상장 종목에 `'none'`/빈 날짜를 주면 매수가 한 번도 안 일어난다. 경고 필수.
  - 분배 일정(`buildDividendSlots`)은 **여전히 `payCycle`만 따른다** — 리밸런싱을 끄거나 옮겨도
    분배락·지급일은 그대로다(검증 #98).
- **⚠️ `QTY_EPS`(1e-9) — `rounding:'exact'` 전량 매도의 부동소수 잔여 방지**: 매도 수량은
  `(0 − qty×price) ÷ price`로 구해지는데 IEEE754에서 원 수량보다 미세하게 작게 나오는 조합이 있어
  보유수량 한도 가드가 발동하지 않고 1e-13 규모 잔여가 남는다. 그 잔여는 러닝 누적 맵에 실려
  **이후 모든 달**의 월말 보유에 `0주 · ₩0 (100.0%)` 유령 행으로 나타난다. → `adjustTo`에서
  **`qty` 자체를 `-p.qty`로 스냅**한다(`p.qty`만 나중에 보정하면 `runQty`가 `t.qty`를 더하므로 갈린다).
  보유 판정 4곳(`totalEvalAt`·월말 holdings·curve·finalHoldings)도 `QTY_EPS` 기준으로 통일(검증 #76).
**분배금 처리 `divReinvest` / 배분 기준 `divReinvestSplit` — 재투자 (⚠️ 회귀 주의)**

지급받은 분배금을 어떻게 할지 정하는 설정(④ 분배금 처리). 기본 `'hold'`(예수금 보유)는 **종전 동작과
1원도 다르지 않다**(검증 #133). `'payDate'`(지급일 재매수) / `'mid'` / `'eom'`(월중·월말에 모아 매수).
배분 기준은 `'target'`(목표 비중, 목표금액 모드면 목표금액 비율) / `'source'`(분배금 준 종목 = DRIP) /
`'even'`(균등).

- **⚠️ 재원은 `cashDiv` 주머니 전액** — '지급받았지만 아직 쓰지 않은 분배금'이 재투자의 유일한
  정합적 정의다. 리밸런싱이 이미 헐어 쓴 몫은 주머니에서 빠져 있어 이중 투입이 없고, 1주 값에
  못 미치는 잔돈은 **버리지 않고 다음 회차로 이월**된다(버리면 분배금이 조용히 증발한다).
- **⚠️ 매수 대금은 반드시 `applyCash(delta, date, 'div')`** — `prefer` 인자를 빠뜨려 기본값
  (매매 주머니 우선)으로 꺼내면 `cashDiv`가 줄지 않아 **다음 회차가 같은 분배금을 또 투입**한다
  (무한 재투자로 예수금이 통째로 빨려 들어간다). 검증 #121·#122·#127b·#139.
- **⚠️ `mid`/`eom`의 날짜는 리밸런싱과 같은 식**(기준일 + `exDivOffset` + `rebalOffset` = 분배락
  직전 영업일, 검증 #118). 그날 사면 **그 달 분배 권리까지 확보**돼 '분배금이 다시 분배를 받는'
  복리가 잡힌다 — 기준일 당일(15일/말일)로 바꾸면 분배락이 이미 지나 그 달 권리를 놓친다.
  `buildReinvestSlots`는 `config.policy`를 **절대 보지 않는다**(리밸런싱과 완전 독립, 검증 #119).
- **⚠️ `KIND_ORDER`에서 reinvest는 맨 뒤**(`exdiv 0 · pay 1 · event 2 · contrib 3 · rebal 4 ·
  reinvest 5`). 리밸런싱은 '목표 수준 맞추기'이고 재투자는 '그러고도 남은 분배금 현금을 추가 투입'
  이라 나중에 와야 한다. 앞에 두면 재투자가 방금 산 수량을 같은 날 리밸런싱이 되팔아(목표 초과)
  매매만 늘고 결과는 그대로가 된다. 검증 #131.
- **⚠️ `BtTrade.reinvest`는 `structural`과 배타이고 `tradeNet`에 섞지 않는다** — `pushTrade`가
  reinvest → `m.reinvestNet` / structural → `structuralNet` / 나머지 → `tradeNet` 3분기다.
  재투자를 매매차익에 넣으면 리밸런싱을 끈 시나리오에서는 매매가 재투자뿐이라 '누적 매매차익'이
  통째로 마이너스가 되어 지표가 의미를 잃는다(구조 변경 매매와 같은 근거). 검증 #123.
- **⚠️ 기말 예수금 분해 항등식이 한 항 늘었다**(검증 #125, #125b가 항이 필요함을 실증):
  `finalCash = 초기잔여 + cumTradeNet + cumStructuralNet + **cumReinvestNet** + cumDivPaid`.
  `m.cashDelta`에도 `reinvestNet`을 더해야 `runCash`가 실제 `cash`와 갈리지 않는다(검증 #127c).
  화면 '기말 보유 현황' 표와 CSV 둘 다 이 항을 렌더한다(소스 가드 #137).
- **⚠️ 배분 가중치가 전부 0이면 균등 폴백** — `split:'source'`인데 분배금을 준 종목이 편입 기간에서
  빠지면 가중치 합이 0이 된다. 여기서 그냥 반환하면 분배금이 영원히 현금으로 남아 **사용자가 켠
  재투자가 아무 경고 없이 무시된다**. 검증 #130.
- **⚠️ `buyWithBudget`은 `rounding:'round'`여도 항상 0 방향 버림**(exact만 통과) — 예산을 넘겨 사면
  분배금이 아니라 매매 주머니를 헐게 되어 "분배금만 재투자한다"는 전제가 깨진다.
- **`divPocket`(assetId→금액, 합 = `cashDiv`)** 은 `'source'` 배분 전용이지만, `cashDiv`가 줄 때마다
  `drainPocket`으로 **비례 축소**해야 한다 — 안 그러면 이미 써 버린 분배금의 출처가 남아 다음
  재투자에서 유령 가중치가 된다.
- **재투자 매수가 곧 편입 경로**다(`p.active = true`) — 리밸런싱을 끈 시나리오에서 중간 상장 종목이
  들어오는 유일한 길이라, '슬롯 없음' 경고 문구도 그에 맞춰 갈라진다.
- **⚠️ `Pos.removed`(이벤트 `removeAssets`로 뺀 종목)와 `!active`(아직 편입 전)를 절대 혼동하지 말 것**:
  `runReinvest`의 `live` 필터와 리밸런싱 `eligible` 루프가 **둘 다** `p.removed`로 게이팅한다.
  `p.active`로 거르면 중간 상장 대기 종목까지 빠져 위의 '재투자 = 편입 경로' 설계가 죽고, 반대로
  게이팅이 없으면 **사용자가 뺀 종목을 재투자·리밸런싱이 옛 목표로 조용히 되사서 되살린다**
  (기말 보유·평가액·수익률에 계속 남는다. `split:'even'`은 목표를 아예 안 보므로 '목표를 0으로
  내려 뺀다'는 우회로마저 막힌다). 리밸런싱 쪽 되사기는 이 기능 도입 **이전부터 있던 결함**이고
  `removeAssets`의 계약('전량 매도 후 비활성화')과 정면으로 어긋나 함께 고쳤다. 검증 #141·#142·#150.
- **⚠️ 레벨 목표 모드에서는 재투자가 되팔린다 — 경고 필수**: `targetMode:'amount'`는 목표가 고정
  수준이라 다음 리밸런싱이 재투자분을 그대로 되판다.
  실효는 거의 0인데 **되판 대금은 `tradeNet`에 들어가고 재투자 매수는 `reinvestNet`으로 빠져**
  '누적 매매차익'만 비대칭으로 부푼다(실측 PDF 픽스처 +66%, 총손익은 +₩536,000뿐) → 비교 표
  순위가 뒤바뀐다. 조용히 두지 말고 경고한다(검증 #144·#144b). **비중 모드**는 재투자가
  분모를 키워 정상적으로 남는다.
- **⚠️ `drainPocket`은 비례 축소라 `'source'` 배분 결과에 **관측 가능한 영향이 없다**(비율 보존).
  그래도 `Σ divPocket === cashDiv` 불변식을 유지해야 절대값을 읽는 미래 소비자가 깨지지 않는다 —
  동작 테스트로는 이 함수를 검증할 수 없다는 뜻이니, 지우기 전에 이 주석을 먼저 읽을 것.

**예비금 주머니 — `extraCash` = 시그널 전용 재원 (⚠️ 회귀 주의 · 유일하게 기존 결과를 바꾼 변경)**

`추가 예수금(extraCash)`의 **뜻이 바뀌었다**(사용자 확정 2026-08): 첫날부터 매수에 함께 쓰는 돈 →
**매매 시그널이 발동할 때만** 쓰는 예비금. 예수금 주머니가 **3분할**된다:
`cashTrade + cashDiv + cashReserve === cash`.

- **⚠️ 이 변경만은 `extraCash > 0`인 저장 시나리오의 결과를 바꾼다**(사용자가 요청한 의미 변경).
  `extraCash === 0`이면 1원도 달라지지 않는다(검증 #377). ② 기본 설정 칸이 그 사실을 **앰버로 고지**한다
  (소스 가드 #381b) — 사용자 행동 없이 결과가 달라지는 유일한 통로라 화면 단서가 필수다.
- **⚠️ 예비금 보호는 예산이 아니라 인출 한도(`applyCash`의 `reserveCap`, 기본 0)가 담당한다**(검증 #374).
  `adjustTo`의 `limited = !allowNegativeCash || floorCap < Infinity`라 `allowNegativeCash:true`면 예산 컷이
  통째로 꺼지는데, `reserveCap`이 0이면 그래도 예비금은 **1원도 줄지 않는다**(초과분은 종전대로 `cashTrade`가
  음수로 떠안는다).
- **⚠️ 인출 순서는 매매 → 예비금 → 분배금**(검증 #379). 예비금을 분배금 뒤에 두면
  `buyFunding:'both'`(기본, `divCap=Infinity`)에서 **분배금이 먼저 소진**돼 예비금 단계가 영원히 실행되지
  않고, `drainPocket`이 `divPocket`을 비워 이후 `divReinvestSplit:'source'` 가중치까지 소실된다.
  재투자 경로(`prefer==='div'`)는 분기 자체에서 `takeReserve`를 호출하지 않아 **구조적으로** 예비금에 닿지 않는다.
- **예비금을 쓰지 못하는 경로(전부 검증 있음)**: 초기 매수 · 정기 리밸런싱(#373·#373b) ·
  **종목 재편 이벤트**(#380 — 이벤트는 `adjustTo`에 opts를 넘기지 않으므로 **기본 예산 `cash − cashReserve`**
  가 그 경로의 유일한 보호막이다, 소스 가드 #228) · 분배금 재투자.
- **목표 산정에서 제외(4곳)**: 초기 매수 분모(이미 `initialCapital`) · `targetBaseAt` 현금 부트스트랩(#151) ·
  `deployableCash`(목표 증액 상한) · `annualReview` surplus(#234).
  ⚠️ #151의 변경을 '분모 선택지 부활'로 오독하지 말 것 — 분모는 여전히 `targetBaseAt` 하나다.
- **파생 불변식 4종**(전부 세 번째 항 필요): 기말(#371) · 월말(#371b·#371c) · 매수 출처 3항(#376) ·
  시그널 화면 `fromTrade + fromReserve + used = tradeAmount`.
- **⚠️ 항등식을 렌더하는 화면·CSV 6지점을 **전부** 고쳐야 한다**(소스 가드 #381이 여섯을 각각 못 박는다) —
  ① 최종 자산 카드 ② **기말 예수금 카드 분해** ③ **기말 보유 현황 표의 예비금 그룹** ④ **총자산 행 title**
  ⑤ **CSV `기말예수금 내역`+`예비금 내역`** ⑥ 월 요약 '이 달 매수 대금'·`sigFundText`·월말 툴팁.
  ⚠️ 카드 한 장만 검사하는 가드로 되돌리지 말 것 — 적대적 리뷰가 실증했듯 ②~⑤가 옛 2주머니 항등식을
  그대로 렌더해도 초록으로 통과한다(`initialCashAfter`는 여전히 `extraCash`를 포함하므로 소계가 정확히
  `finalCashReserve`만큼 어긋나고, 총자산 툴팁은 좌변 합 ≠ 우변인 **거짓 산식**을 찍는다).
  ⚠️ 예비금 시드는 summary에 없지만 **`finalCashReserve + cumReserveDrawn === extraCash`** 로 정확히 복원한다.
  ⚠️ `poolAt`이 `tradeOnly`에서도 예비금을 포함하므로 화면 `poolLabel`에도 '+ 예비금'을 붙인다 —
  안 붙이면 '매매 예수금'이라는 이름으로 예비금이 섞인 밑변을 표시한다.
- **⚠️ '초기 매수 후 잔여(예비금 제외)'는 모듈 스코프 `initTradeRestOf(result)` 하나를 3지점이
  공유한다(가드 #382 — 요약 카드 · 기말 보유 현황 표 · CSV)**. 위 6지점을 고칠 때 이 값을 각 화면에서
  손계산으로 되돌리지 말 것. ⚠️ **컴포넌트 지역 변수로 두는 형태가 실제 프로덕션 장애를 냈다** —
  `SummaryCards`의 지역 `initTradeRest`를 `BacktestPage` 본체의 표가 참조해
  `ReferenceError: initTradeRest is not defined`로 **백테스트 페이지 전체가 ErrorBoundary 오류 화면**이
  됐다(2026-08, 커밋 eac4840 → 7fda652 배포분). `@ts-nocheck` + 타입체크 없는 esbuild 빌드라
  **컴파일러도 `npm run build`도 못 잡고**, 소스 텍스트 가드는 그 지점의 존재만 확인하지 스코프를 보지
  않으며, `undefcheck.mjs`는 파일 전체를 한 스코프로 보므로 통과시킨다 →
  이 부류 전용 게이트는 **`memory/tools/scopecheck.mjs`**(다른 최상위 블록의 지역 선언을 참조하는지 검사)다.
- **⚠️ 기말 분해 항등식(#125/#304)은 항이 늘지 않는다** — A는 `cash` 총액을 바꾸지 않고 분해만 한다.
  다만 `#304b`의 폐쇄형은 **재유도됐다**: `cashTrade` 시드가 `initialCapital`로 줄었고(−extraCash),
  예비금이 대신 낸 매수 대금만큼 `cashTrade`가 덜 나갔다(+`cumReserveDrawn`).
  `finalCashReserve = extraCash − cumReserveDrawn`.
  ⚠️ 예비금 전입/전출을 **별도 흐름으로 기록하는 구현은 채택 금지**(이 성질이 깨진다).
- **경고**: `extraCash > 0 && !dip.enabled`면 그 돈은 종료일까지 한 푼도 안 쓰이므로 반드시 알린다(#378).
- **⚠️ 검증 사각지대 이력** — 이 기능이 생기기 전 372건이 **전부 `extraCash: 0`**이라 예비금 로직이 스위트에
  원리적으로 보이지 않았다. 픽스처를 먼저 세우고 **변이 12종으로 검출을 확인**한 뒤 구현했다.
  그 과정에서 실제로 **죽은 단언 2건**(종목명이 경고 문구에 섞인 #378, 경로를 밟지 않는 픽스처 5건)을 잡았다 —
  이 파트의 픽스처를 단순화하지 말 것(목표 12M > 초기 투자금 10M, 하락은 분배금 지급 **뒤**, 이벤트 포함이
  각각 특정 변이를 잡는 장치다).

**앵커 시그널 축 — 직전 체결 종가 기준 `BtDip.anchorLevels` (⚠️ 회귀 주의)**

기존 축(전 구간 가격 고점/저점)에 **직전 체결 종가(앵커) 대비 ±N%** 축을 **병존**시킨다.
사용자 요청 "리밸런싱 이후 10%, 20% 매매 시그널 / 이전 매매시그널·이전 리밸런싱 이후 비율 초과 하락시".
기본 `[]` = 미사용 → **레거시 결과 1바이트 불변**(검증 #356).

- **⚠️ 앵커는 체결 결과에 의존해 사전 탐지가 불가능하다** — `sigTrigByDate`(고점/저점 축)와 달리
  **런타임 판정**이다. 앵커가 켜진 경우에만 `allBiz` 전 영업일에 signal 스텝을 세운다(꺼져 있으면
  `steps` 배열이 종전과 동일, 검증 #356b).
- **⚠️ 조기 탈출(`if (!trigs.length) continue`)은 `checkRatioSum`·`targetBaseAt`보다 반드시 앞**
  (소스 가드 #360b). ① 빈 스텝이 `checkRatioSum`을 부르면 경고 문구의 날짜·편입 종목 수가 달라지고
  ② **성능**: `targetBaseAt`→`totalEvalAt`이 종목마다 `priceAt`을 부르는데 그 미스 경로는
  `for (const d in series)` 선형 스캔이라 `영업일 × 종목 × |시계열|`로 폭발한다.
- **⚠️ 앵커를 옮기는 체결은 `anchorSource`가 정하고, 다음 셋은 **어느 값에서도 옮기지 않는다**:
  분배금 재투자(`t.reinvest`) · 재조정 매도(`t.signal==='realloc'`) · 종목 재편(`t.structural`)**
  (검증 #353, 소스 가드 #360). 재투자를 켜면 매달 체결이 생겨 앵커가 갈아엎어지고, 1월 대비 −17%까지
  빠져도 새 앵커 대비 −9%라 10% 단계가 **끝내 발동하지 않는다**(설계 검증 확정 결함).
  - `'lastFill'`(기본) — 리밸런싱 + 시그널 체결이 앵커를 옮긴다 → 트레일링 ±N% 그리드(검증 #350)
  - `'lastRebal'` — 리밸런싱 체결만 → 한 기준에서 10% → 20% 순차 발동(검증 #351).
    `lastFill`에서는 10%가 체결되면 앵커가 이동해 20%가 원 기준 −28%가 되어야 닿는다.
- **갱신 지점은 `pushTrade` + 초기 매수 2곳**(초기 매수는 `pushTrade`를 타지 않는다, 검증 #350/MD9).
  값이 그대로면 재무장하지 않는다.
- **⚠️ `fired` Set 필수**(검증 #354) — 체결이 0인 날(이미 목표) 앵커가 안 바뀌어 다음 날 또 발동하면
  이벤트가 매일 쌓인다. 그날 도달한 **가장 깊은 단계 1건만** 발동하고 얕은 단계는 함께 소진 처리한다.
- **⚠️ 앵커 매수에는 비율(`buyPct`)이 없다**(항상 '목표까지') — 주면 두 축이 같은 날 겹칠 때 `pctSum`이
  100%를 넘어 **화면 계산식(밑변 × 비율 = 금액)과 실제 체결이 어긋난다**.
- **`extremeOn`(기본 true)** — 고점/저점 축 on/off. 없으면 `dip.enabled`를 켜는 순간
  `normalizeDipLevels`가 기본 3단계를 복원해 고점 축이 **항상** 함께 무장돼 앵커만 쓸 방법이 없다.
  ⚠️ 게이트는 **루프 진입부**에 둔다 — `const dipLevels =`/`const sellLevels =` 두 선언줄은 소스 가드
  #233c·#257이 리터럴로 단언한다.
- **⚠️ 정규화는 `normalizeSellLevels` 계열(빈 배열 보존)**(검증 #358b) — `normalizeDipLevels`(빈 배열 →
  기본 3단계)를 재사용하면 레거시 전부에서 앵커가 저절로 켜지고 멱등(#237)이 깨진다.
- **⚠️ `dipOf`(화면)는 `BtDip`의 **모든** 필드를 채운다**(소스 가드 #361) — dip 쓰기 6곳
  (`patchActive({ dip: { ...dipOf(active), … } })`)의 **스프레드 베이스**라, 빠진 필드는 옆 토글 한 번으로
  dip에서 삭제됐다가 재로드 시 기본값으로 되살아난다(끈 적 없는 축이 다시 켜진다, undo 없음).
- **⚠️ 화면 문구는 `kind`가 아니라 `axis`로 기준을 고른다**(소스 가드 #361b) — `sigRefText`가 앵커 발동에
  '고점 ₩X'를 찍으면 존재한 적 없는 근거를 제시하는 거짓말이 된다. 앵커일에는 기준을 만든 체결일도 함께 적는다.
  `sigLabel`은 화면·CSV가 공유하므로 축 표기가 그 한 곳으로만 흐른다(#259b).
- **등록 6곳**(`normalizeDip`은 **필드별 재구축기**) + `sigOn`·`strategyTags`에 앵커 반영(#361c).
  **영속화 신규 지점 0곳**(`BtDip` 안).

**③ 실행 트리거 2축 · 정기 스위치 `BtConfig.regularOn` (⚠️ 회귀 주의)**

③ 리밸런싱 일정은 **체크박스 2축**(매매 시그널 발생 즉시 = `dip.enabled` / 정기 리밸런싱 = `regularOn`)
+ 정기 방식 드롭다운(4종)으로 구성한다. 두 축은 원래부터 **엔진에서 완전히 독립**이라 함께 켤 수 있는데,
시그널이 ⑤-b에만 있어 ③에서는 보이지 않던 것을 노출한 것이다(엔진 동작 변경 0).

- **⚠️ 체크를 끌 때 `policy`를 덮어쓰지 말 것** — `policy:'none'`으로 바꾸면 사용자가 고른 '월말 일괄'이
  조용히 사라진다(백테스트는 undo가 없고 `_preserveStickyPersonalData` 대상도 아니다). `regularOn`만
  내리고 policy는 보존한다 → 껐다 켜면 원래 방식이 그대로 돌아온다(검증 #342).
- **⚠️ 레거시 `policy:'none'`과 결과가 **완전히** 같아야 한다** — `resolveAssetRebal`이 `regularOn===false`를
  policy 검사 **앞**에서 `mode:'none'`으로 떨어뜨린다(검증 #340). 화면 `regularOnOf`도 `policy==='none'`을
  '꺼짐'으로 읽는다(안 그러면 화면이 거짓 설명을 한다).
- **⚠️ '수량 고정' 경고 게이트를 함께 고칠 것**(검증 #341, 소스 가드 #347) — `config.policy !== 'none'`만
  보면 체크박스로 끈 경우(policy는 'allEom' 그대로) **종목 수만큼 경고가 도배**되어, 같은 뜻의 두 설정이
  경고 개수가 달라진다(#116 계약 위반). → `config.policy !== 'none' && config.regularOn !== false`.
- **⚠️ 종목별 지정 종목(`rebalMode !== 'follow'`)과 전역 지정일(`rebalDates`)은 이 스위치와 무관**하다
  (검증 #343·#344). 체크 Hint에 그 사실을 명시한다 — 안 그러면 '전 종목을 멈춘다'로 읽힌다.
- **등록 6곳** + 기본값 `true`(명시적 false만 정기를 끈다, 검증 #345c). **영속화 신규 지점 0곳**.
- **⚠️ 라벨은 `policyLabelOf` 하나로** — 정기가 꺼져 있으면 방식과 무관하게 '리밸런싱 안 함'이다.
  ③ 배지·시나리오 부제·비교 CSV·메모 조건 요약 4곳이 공유한다(손복제 금지).
- **⚠️ `Hint`(=`<button>`)를 `<label>` 안에 두지 말 것** — label 활성화가 내부 체크박스를 함께 토글해
  `?` 아이콘을 누를 때마다 그 옵션이 켜졌다 꺼진다(⑤-b 선례).

**전역 지정일 리밸런싱 `BtConfig.rebalDates` (⚠️ 회귀 주의)**

특정 날짜를 찍어 그날 전 종목을 목표에 맞추는 축. **전체 정책에 '추가'되는 축**이라 둘을 함께 쓸 수
있고, 정책을 `'none'`으로 두면 지정한 날짜에만 리밸런싱한다(사용자 요구: "매월 지정일이 아니라
특정 월일을 선택해서"). 기본 `[]` = 없음 → **레거시 결과 1바이트 불변**(검증 #335).

- **⚠️ `buildSlots`에서 종목 오버라이드·`r.mode==='none'` 두 `continue`보다 **앞**에서 만든다** —
  뒤에 두면 `policy:'none'`인 달이나 종목 오버라이드가 있는 달에서 지정일이 통째로 사라지는데,
  **'정기는 끄고 지정일만'이 이 기능의 주 사용 시나리오다**(검증 #331·#332, 소스 가드 #339가
  `indexOf` 위치 관계로 단언 — 미러로는 표현할 수 없다).
- **⚠️ `rebalMode==='follow'` 종목에만 건다**(검증 #333·#339b) — 월별 **일괄** 오버라이드와 같은 규약.
  전 종목에 걸면 '이 종목은 리밸런싱 안 함'으로 둔 종목이 지정일 하나로 그 설정을 잃는다. 특정 종목만
  그 날짜에 넣으려면 그 종목의 `rebalMode:'dates'`를 쓴다.
- **⚠️ 분배 일정은 건드리지 않는다**(검증 #338) — 분배락·지급일은 시장이 정하는 값이라 `payCycle`만 따른다.
- **정규화 `normalizeRebalDates`**: 유효 날짜만 + dedupe + 정렬 + `MAX_BT_REBAL_DATES`(120) 상한.
  ⚠️ **빈 배열을 보존한다**(`normalizeSellLevels` 계열) — 기본값으로 되돌리면 레거시 시나리오에 없던
  리밸런싱이 생긴다(검증 #336b). 정렬·dedupe가 **멱등**을 만든다(#237·#336c).
- **등록 6곳**(하나라도 빠지면 조용히 소멸/미저장): `makeBtConfig` · `backtestFingerprint` ·
  `backtestSettingsFingerprint` + 미러 3곳. 지문 누락 시 '지정일만 고친 세션'이 Drive에 저장되지 않는다
  (검증 #337 — `historyVerifyKey`·`targetAmount`와 동일 버그 클래스). **영속화 신규 지점은 0곳**
  (`BtConfig` 안이라 App.tsx 7지점이 시나리오를 통째로 실어 나른다).
- **⚠️ 화면은 체크박스가 아니라 '개수 배지 + 날짜 칩 개별 삭제'** — 체크박스로 두면 끄는 유일한 표현이
  배열 비우기가 되어 입력이 통째로 소실된다(백테스트는 undo가 없고 `_preserveStickyPersonalData`
  대상도 아니다). 중복·상한은 **입력 시점에** 막는다 — 안 막으면 초과분이 저장되고 다음 로드에서
  정규화가 조용히 절삭해 그때 결과가 달라진다.
- **⚠️ `rebalDatesOf` 안전 접근자로만 읽는다**(`active.rebalDates` 직접 접근 금지) — 정규화를 우회한
  config이 한 번이라도 들어오면 렌더 중 TypeError가 루트 ErrorBoundary까지 올라가 **화면이 통째로
  오류 페이지**가 된다(`dipOf`와 같은 근거, `@ts-nocheck`라 컴파일러가 못 막는다).

**전역 '리밸런싱 안 함' `policy:'none'` (⚠️ 회귀 주의)**

초기 매수 후 수량을 그대로 두는 Buy & Hold 기준선. `resolveAssetRebal`이 `follow` 종목에
`mode:'none'`을 돌려주므로 슬롯이 하나도 생기지 않는다(검증 #114·#115).

- **⚠️ `follows: true`를 유지한다** — 슬롯을 안 만들어 그룹·월별 일괄 오버라이드 경로에 어차피
  닿지 않고, `false`로 두면 '종목이 개별 지정했다'는 뜻이 되어 `buildSlots`의 개별/일괄 구분 의미가
  흐려진다. **종목 지정 오버라이드(`assetId` 있는 `BtOverride`)는 `r.mode` 검사보다 먼저 처리되므로
  `policy:'none'`에서도 그 달 그 종목 슬롯을 만든다**(의도 — "전부 멈추되 이 달 이 종목만" 표현).
- **⚠️ 종목마다 '수량 고정' 경고를 쏟지 않는다**(검증 #116) — 사용자가 명시적으로 고른 설정이라
  종목 수만큼 경고가 도배되면 진짜 경고가 묻힌다. 종목별 `rebalMode:'none'`으로 슬롯이 없어진
  경우에는 **종전대로 경고한다**(#116b).
- **⚠️ 매월 목표 증액(`contribution`)은 그 달 첫 리밸런싱일에 붙으므로 리밸런싱이 없으면 집행되지
  않는다** — 과거엔 **예외 규칙만** 경고하고 **기본 규칙은 결과·경고 어디에도 흔적 없이 사라졌다**.
  엔진이 '리밸런싱 0회 + 증액 설정 있음'을 경고한다(검증 #143·#143b).
  ⚠️ 설정 패널 배너 조건은 `policy === 'none'`이 **아니라 `result.slots.length === 0`** 이다 —
  policy로 재면 양방향으로 거짓말을 한다(종목별 `rebalMode`를 하나만 지정해도 증액이 정상
  집행되는데 '효과 없음'이라 하고, 반대로 전 종목 `rebalMode:'none'`이면 아무 안내도 없다). 소스 가드 #148.

**'전체 백테스트 비교 종합' 뷰 (⚠️ 회귀 주의)**

시나리오 select의 **예약 id `'__compare__'`**(`COMPARE_ID`)로 진입한다. 구성 = 비교 표(시나리오 행 ×
지표 열) + 시나리오 라인을 겹친 차트(₩/% 토글) + 시나리오별 요약카드·개별 차트 블록.

- **⚠️ 요약 카드는 단일 뷰와 비교 블록이 `SummaryCards` 한 컴포넌트를 공유한다**(소스 가드 #134).
  복제하면 두 화면이 갈라진다. 지표도 `summary` 필드를 그대로 읽고 **여기서 다시 계산하지 않는다**.
- **⚠️ 포함 여부 `BtConfig.compareOn`은 시나리오 안의 필드**라 영속화 신규 지점이 **0곳**이다
  (지문·state 리터럴·`applyStateData`·sticky·브릿지 전부 무수정). 기본값은 `partial.compareOn !== false`
  — `!!partial.compareOn`으로 두면 **필드가 없는 기존 시나리오가 전부 빠져 비교가 빈 화면**이 된다.
- **⚠️ 토글은 `patchActive`가 아니라 id 기준 `toggleCompare`** — 비교 뷰에서는 `active`가 `null`이라
  `patchActive`는 아무 일도 하지 않는다(흐름도 `patchNodeById`와 같은 근거). 소스 가드 #136.
- **⚠️ `activeId === COMPARE_ID`는 '없는 시나리오' 리셋 effect에서 걸러야 한다** — 안 걸면 비교 뷰를
  열자마자 첫 시나리오로 되돌아간다. 소스 가드 #135.
- **⚠️ 비교 실행은 `compareOn` 필터 + `RUN_DEBOUNCE_MS` 디바운스(`runAll`)** 를 거치고 **비교 뷰일
  때만** 계산한다(소스 가드 #138) — 최대 10개 백테스트가 체크박스를 누를 때마다 재실행되면 체감
  반응이 눈에 띄게 나빠지고, 안 쓰는 화면의 비용을 항상 치를 이유도 없다(`btActive` 게이팅과 동일).
- **시나리오 색상은 `local` 안의 위치**로 고정한다 — 비교 체크를 껐다 켜도 색이 바뀌지 않는다.
- **⚠️ 색 스와치는 반드시 인라인 SVG(`Swatch`)** — 인쇄 CSS의 `.bt-shell * { background:
  transparent !important }`는 작성자 !important라 인라인 `style={{backgroundColor}}`를 이겨서
  span/div 스와치가 **PDF에서 통째로 사라진다**. 그러면 겹친 차트의 선(SVG `stroke`는 살아남는다)과
  시나리오 이름을 대응시킬 방법이 없어 비교 PDF가 판독 불가가 된다. SVG `fill`은 `background`·
  `color` 어느 규칙에도 걸리지 않는다. 소스 가드 #146.
- **⚠️ 첫 진입은 디바운스를 건너뛴다**(`runAll === null`이면 즉시) — 태우면 220ms 동안 '0개 선택됨'
  빈 화면이 뜨고 PDF·CSV 버튼이 비활성으로 깜빡여 사용자가 '아무것도 없다'고 오해한다. 소스 가드 #149.
- **⚠️ 월 요약의 '매매차익이 모자라 분배금에서 충당' 안내는 `cashUsedDiv > 0`으로 띄우면 안 된다** —
  재투자 매수는 **설계상 항상** 분배금 주머니에서 나가므로(`prefer:'div'`) 재투자를 켠 **모든 달**에
  거짓 설명이 붙어 진짜 부족 신호가 묻힌다. 재투자 몫(`-reinvestNet`)을 뺀 나머지가 분배금을
  헐었을 때만 띄운다. 소스 가드 #147.
- **실행 불가(`ok:false`) 시나리오도 숨기지 않고** 사유와 함께 행을 남긴다(조용히 빠지면 사용자는
  그 시나리오가 비교에 들어간 줄로 안다). 겹친 차트 기본 모드는 초기 투자금이 서로 다르면 `%`.
**평가금 고정 보조 규칙 6종 (⚠️ 전부 '기본값 = 종전 동작' — 하위호환이 이 기능의 최우선 계약)**

"종목별 목표 평가금을 고정하고(오르면 팔고 내리면 사서 복원) 분배금은 따로 적립했다가 급락 때만
푼다"는 운용을 재현하기 위한 `BtConfig` 6필드. **`dip`(시그널 리밸런싱)만 독립 트리거**이고,
`buyFunding`은 **정기 리밸런싱과 시그널이 공유**하며, 나머지 4종은 **정기 리밸런싱에만** 걸린다 —
이벤트(구조 변경)·분배금 재투자는 종전 규약 그대로다(그쪽까지 번지면 PDF 재현 #23~#42가 깨진다).
**초기 매수는 `초기 투자금` 한도만 쓴다**(아래 '초기 매수 예산' 항목 — 추가 예수금은 손대지 않는다).

| 필드 | 기본값 | 요약 |
|---|---|---|
| `band` | 0 | `\|리밸런싱 전 평가액 − 목표\| ≤ 목표 × band%` 면 그 회차 매매 생략 |
| `buyFunding` | `'both'` | **매수 재원** — `'both'`=예수금+적립 분배금 / `'tradeOnly'`=예수금만(분배금 **완전 잠금**). **정기 리밸런싱과 시그널이 공유** |
| `dip` | `{enabled:false}` | **시그널 리밸런싱** — 매수=가격 고점 대비 −N% / 매도=가격 저점 대비 +N%, **발동일 종가로 즉시 체결**. 규모는 단계의 `buyPct`/`sellPct`가 정한다 |
| `cashFloorPct` | 0 | 매수 후 총 예수금이 `활성 종목 목표금액 합계 × pct%` 아래로 못 내려간다 |
| `annualReview` | `{mode:'none'}` | `everyMonths`마다 `(예수금 − 예약금) × value%`를 목표금액에 얹는다 |
| `divTaxPct` | 0 | 지급일에 원천징수를 떼고 입금 |

- **⚠️ `applyCash`의 4번째 인자 `divCap`(기본 `Infinity`)이 하위호환의 축**이다. `tradeOnly`가 0을 넘겨
  분배금 주머니를 잠그고 급락이 그만큼만 연다. **`allowNegativeCash:true`일 때가 이 인자가 유일하게
  일하는 경로**다 — 음수 허용이면 `adjustTo`의 예산 상한(`limited`)이 통째로 꺼져 출금 시점의 `divCap`만
  남는다(변이 테스트로 실증, 검증 #170). 마찬가지로 `adjustTo(opts?)`의 `budget ?? cash` ·
  `floorCap ?? Infinity`가 기본값 하위호환의 전부다(가드 #227·#228).
- **⚠️ 시그널은 평가액이 아니라 가격 고점/저점 기준**(리밸런싱으로 수량이 계속 변해 평가액 극값은
  왜곡된다). 발동일은 사전 탐지로 확정하고 **개방액은 런타임 `cashDiv`에 달려 있어 `signal` 스텝에서**
  계산한다. 각 단계는 **극값 갱신 전까지 1회**, 새 고점이 서면 매수 단계가·새 저점이 서면 매도 단계가
  재무장한다(가드 #232). ⚠️ 두 판정은 **서로 독립**이다 — 옛 코드처럼 `if (px > peak) {…; continue;}`로
  하루를 통째로 건너뛰면 **매도 시그널이 가장 크게 오른 날(신고가일)에 발동하지 못한다**.
- **⚠️ 시그널은 '발동일 종가로 즉시 체결'한다(2026-08 전환 — 되돌리지 말 것)**. 옛 설계는 개방만 하고
  **다음 정기 리밸런싱**에서 매수했는데, `policy:'none'`(리밸런싱 안 함)에서는 그 회차가 영영 오지 않아
  **"개방 ₩0 → 사용 ₩0"만 찍히고 기능이 통째로 죽었다**(사용자 실측 보고). 그래서 `dipUnlock`/
  `dipPending`/`consumeDip`(회차를 넘겨 들고 다니던 수명 모델)과 **밴드 면제**가 전부 삭제됐다 —
  밴드는 이제 순수하게 정기 리밸런싱 전용이다(가드 #233, 미러 #250·#300~#302).
- **⚠️ ③ 리밸런싱 일정과 완전히 독립 — 둘을 동시에 켤 수 있다**(사용자 요구). `policy:'none'`이어도
  시그널은 돌고, 둘 다 켜면 같은 날 `KIND_ORDER`상 **signal → rebal** 순으로 둘 다 실행된다(시그널이
  먼저 목표를 맞추므로 이어지는 정기 회차는 자연히 no-op이 된다). 미러 #301·#302.
- **⚠️ 매수 재원은 `buyFunding` **하나**가 정한다 — 정기 리밸런싱과 시그널이 **같은 두 줄**을 쓴다**
  (사용자 확정 2026-08). `tradeOnly` → `budget = max(0, cashTrade)` · `divCap = 0`(적립 분배금 **완전
  잠금**) / `both` → `budget = cash` · `divCap = Infinity`. 시그널 스텝과 `runPlan`이 **문자 그대로 같은
  두 줄**이라야 두 경로가 갈리지 않는다(가드 #233b가 `.length === 2`로 단언).
  ⚠️ 옛 설계는 `tradeOnly`에서도 시그널이 `적립 분배금 × 단계 비율`만큼 **개방**해 썼다 — 그 메커니즘
  (`unlocked`/`unlockPct`/`divRoomTotal`)은 통째로 폐기됐다. 되돌리면 "매매 예수금만 = 누적 매매현금 +
  초기 예수금"이라는 사용자 정의가 깨진다(미러 #177b).
- **⚠️ 재조정(다른 종목의 목표 초과분 매도)은 '목표까지'(`buyPct === null`) 단계에만 돈다**
  (`dip.reallocate`, 기본 true). 비율 매수는 "가진 현금의 일부만 투입"이 규칙이라 **재원 부족이라는
  개념 자체가 없다** — `needTotal`에 비율 종목의 필요액을 넣으면 팔 이유가 없는 종목을 팔게 된다
  (미러 #313b). **전 종목이 함께 하락해 팔 초과분이 없으면** 아무것도 팔지 않고 가진 재원만큼만 산다.
  ⚠️ `config.dip.reallocate`는 반드시 **`!== false`**로 읽는다 — 화면은 정규화를 거치지 않은 로컬 사본을
  그대로 넘길 수 있어, `undefined`를 falsy로 읽으면 **저장 전후 결과가 갈린다**(중복 낙폭 사고와 같은 부류).
- **⚠️ 비중 모드 분모(`base`)는 signal 스텝당 단 한 번만 잡는다**(정기 리밸런싱이 plans를 실행 전에
  확정하는 것과 같은 규약). 매도마다 `targetBaseAt`을 다시 재면 **캐스케이드**가 난다 — 같은 날
  A·B에 매도 시그널이 뜨면 A를 판 직후 평가액 합계가 줄어 B의 목표까지 내려가고, B는 원래보다 더
  팔게 된다(그 매도가 다시 C의 목표를 내린다). 매도·재조정·매수·현금 바닥선이 **전부 같은 base**를
  써야 하루 안에서 목표가 흔들리지 않는다. 편입(`p.active = true`)은 수량을 바꾸지 않아 base와 무관하다.
  미러 #318(비중 합 80% 픽스처 — 합이 100%면 총 초과분 = 총 부족분이라 두 종목이 동시에 매도하는
  상황 자체가 안 만들어져 캐스케이드가 드러나지 않는다).
- **⚠️ 매매 규모는 단계의 **비율 칸**이 정한다 — 비우면 '목표까지'**(사용자 확정 2026-08).
  - `BtDipLevel.buyPct: number | null` → 매수액 = `min(재원 스냅샷 × buyPct%, 목표 미달액)`.
    **목표에서 자른다**("축소된 비중을 일정하게 유지하는 것이 목적" — 넘겨 사면 다음 회차가 되판다,
    미러 #175b). `null`이면 목표 미달액 전부(종전 동작) + 재조정 허용.
  - `BtSellLevel.sellPct: number | null` → 매도액 = `(평가액 − 목표) × sellPct%`. 밑변이 평가액이
    **아니라 초과분**이라야 목표 아래로 내려가지 않는다(미러 #312b·#314). `null`이면 목표까지 전량.
  - ⚠️ **`null`(목표까지)과 `0`(재원/초과분의 0% = 아무것도 안 함)은 결과가 정반대**다. 지문도
    `?? ''`로 둘을 구분해야 한다(미러 #220b). 화면 입력은 `NumInput allowEmpty`(빈칸 = null).
  - ⚠️ 레거시 `unlockPct`는 값을 그대로 승계하되 **0은 `null`로** 옮긴다 — 옛 '단계 추가' 버튼이 0을
    넣었고 옛 의미로 0은 '분배금을 안 연다'(= 목표까지 매수)였는데, 새 의미에서 0은 **한 주도 안 사는**
    단계로 뒤집힌다(미러 #215b).
  - ⚠️ **값 승계는 의도된 일회성 의미 변경이다**(사용자가 화면의 34%가 실제로 일하기를 요청했다).
    그런데 지문 투영이 옛 `10:34`와 새 `10:34`로 **문자열이 완전히 같아**, 사용자가 아무것도 안
    건드렸는데 결과 숫자만 달라지고 메모의 '설정이 바뀌었습니다' 배지는 뜨지 않는다 — 옛 해석으로
    쓴 AI 분석이 조용히 거짓이 된다(적대적 리뷰 확정). → `backtestSettingsFingerprint`에
    **`SETTINGS_FP_SCHEMA` 토큰**을 넣어 그 릴리스의 모든 메모에 배지를 띄운다(가드 #290d).
    ⚠️ 저장 지문(`backtestFingerprint`)에는 **넣지 말 것** — 양변에 똑같이 붙어 무의미하고
    `normalizeBacktestScenarios`의 멱등 판정만 흔든다. 토큰은 '같은 저장값의 뜻이 바뀐' 릴리스에서만 올린다.
- **⚠️ 재원 스냅샷(`poolAt`)은 매도 시그널 처리 뒤·재조정 앞에서 1회**, **종목별로 같은 값**이다 —
  같은 날 매도 시그널이 만든 현금은 실제로 쓸 수 있으므로 포함하고, 재조정 대금은 '목표까지' 매수를
  위한 것이라 비율 매수의 밑변을 부풀리지 않게 제외한다. 여러 종목이 같은 날 발동해도 서로의 몫을
  빼앗지 않아 화면 계산식(밑변 × 비율 = 금액)이 종목마다 성립한다(미러 #322).
  ⚠️ 밑변은 **매수 계획이 살아 있는 종목만** 채운다 — 종가가 없어 계획에서 탈락한 종목까지 채우면
  화면에 '실제로 성립한 적 없는 계산식'이 렌더된다.
  ⚠️ 같은 종목의 여러 단계가 같은 날 겹치면(갭 하락/급등) 금액이 **합**이므로 비율도 합(**`pctSum`**)을
  함께 남긴다 — 단계별 `pct`로 화면을 그리면 `₩1,000,000 × 34% = ₩670,000` 같은 **거짓 계산식**이
  찍힌다(적대적 리뷰 확정, 미러 #321 / 가드 #259b). 하나라도 `null`이 섞이면 그 종목은 그날 '목표까지'.
  ⚠️ **매도도 매수와 같은 carrier 규약으로 종목별 1회만 체결**한다 — 트리거마다 독립 실행하면 비율
  매도가 **연쇄 적용**(10% 판 뒤 남은 초과분의 20%)돼 화면 계산식과 체결이 어긋난다(미러 #312e).
  ⚠️ 화면의 계산식 줄은 **엔진이 실어 보낸 `BtSignalEvent.carrier`**로 그린다 — `planned > 0` 같은
  값으로 판정하면 비율 0%·재원 0원이라 금액이 0인 대표 행(=설명이 가장 필요한 행)이 사라진다(가드 #259b).
  ⚠️ **`밑변 × 비율 = planned`로 등호를 찍지 말 것** — `planned`는 매수면 목표 미달액, 매도면 초과분
  전량에서 **한 번 더 잘린다**. 그대로 쓰면 `₩60,000,000 × 100% = ₩6,000,000` 같은 거짓 계산식이 된다
  (적대적 리뷰 확정). `sigSizeText`의 `capped()`가 잘린 경우를 `곱 → …에서 자름 = 결과`로 갈라 준다.
  ⚠️ 매도 carrier의 **`pctSum`은 '목표 이하' 가드보다 먼저** 채운다 — 뒤에 두면 조기 반환한 행이
  `null`로 남아, 30%를 지정했는데 화면이 '목표 초과분 ₩0 전량'이라고 설명한다(미러 #312f).
  ⚠️ 미체결 사유는 **'비율 0%'와 '재원 없음'을 갈라서** 남긴다 — 뭉뚱그리면 40%를 넣은 사용자에게
  "매수 비율 0%"라고 단언하게 되고, KPI 팝오버는 이 note가 유일한 설명이다(미러 #175c).
- **⚠️ 초기 매수 예산 = `초기 투자금`뿐**(사용자 확정 2026-08). 비중 분모 `base`와 `adjustTo`의
  `budget`을 **둘 다** `config.initialCapital`로 잡고, 매수마다 `initRemain += t.cashDelta`로 줄인다.
  추가 예수금(`extraCash`)은 "매매 시그널 때 매수할 수 있는 자금"이라 첫날 써 버리면 안 된다.
  `extraCash === 0`이면 결과가 종전과 1원도 다르지 않다(미러 #323c).
  ⚠️ **분모만 고치면 안 된다** — 목표 금액 모드는 `targetOf`가 base를 아예 보지 않아 예산 캡이 없으면
  여전히 추가 예수금을 헐어 쓴다(미러 #323b). 반대로 **예산 캡만 고쳐도 안 된다** — 비중 모드에서
  분모가 부풀면 앞 종목이 과매수하고 뒤 종목이 예산에 잘려 **배분이 기운다**(미러 #323, 2종목 픽스처).
  ⚠️ 화면의 목표 합계 기준·'종목 수로 균등 분배'·'빈 칸 채우기'도 **초기 투자금만** 쓴다.
- **⚠️ 재조정(②) 발동 판정은 `cashTrade`가 아니라 '실제로 쓸 수 있는 재원'(`usableFor`)으로 한다**
  — 적대적 리뷰가 잡은 확정 결함 2건이 같은 뿌리다:
  ① `buyFunding:'both'`(기본)에서는 분배금 주머니가 이미 매수 재원인데 `cashTrade`만 보면
  **쓸 필요 없는 다른 종목을 팔아 치운다**(policy:'none'이면 그 현금은 영영 되돌려지지 않는다, 미러 #319).
  ② 현금 바닥선이 있으면 판 돈이 바닥선에 막혀 매수에 못 쓰이는데도 팔아 버려 **매도만 남는
  '나체 매도'**가 된다(미러 #320). → `usableFor(extra)`가 재원 모드·바닥선·개방 한도를 모두 반영하고,
  **"다 팔아도 쓸 수 있는 돈이 1원도 안 늘면 한 주도 팔지 않는다"**(`usableFor(totalExcess) > usableFor(0)`)가
  나체 매도의 유일한 방어선이다. ⚠️ 진입 게이트와 루프 정지 조건을 **둘 다** 같은 함수로 재야 한다
  (한쪽만 옛 `cashTrade` 비교로 되돌리면 다른 쪽이 가려 변이 테스트가 통과한다 — 실측).
- **⚠️ `BtTrade.signal`은 반드시 화면·CSV에서 렌더한다**(월별 표 날짜 셀 배지 + CSV '구분' 열).
  안 그러면 `policy:'none'`에서 각주는 "정기 리밸런싱은 일어나지 않습니다"라고 하는데 표는 설명 없는
  매매 행으로 가득 차고, 특히 **재조정 매도**는 시그널이 뜬 적 없는 **다른 종목**이 팔린 것이라
  출처가 화면 어디에도 없다(적대적 리뷰 확정, 가드 #259d).
- **⚠️ 알려진 비대칭(설계상 정상, 화면에 고지)**: 재무장 기준이 매수=고점·매도=저점이라
  **한 방향으로만 가는 장에서는 반대편 시그널이 사실상 1회성**이 된다(계속 오르면 저점이 갱신되지 않아
  매도가 처음 도달 때만 발동). 이는 "저점 대비 반등"의 정의상 필연이므로 산식을 바꾸지 말고
  ⑤-b Hint의 안내 문구를 유지할 것.
- **⚠️ 매도 시그널은 '매도 전용'이고 방어선이 둘이다**(변이 테스트로 실측): 사전 검사
  (`평가액 − 목표 ≤ 0`이면 skip)와 방향 가드(`tr.qty >= 0`이면 skip). **하나만 지우면 다른 하나가
  잡아 검증이 통과**하므로 둘 다 그대로 둘 것 — 둘 다 지우면 목표 미달 보유에서 반등 시그널이
  **매수로 뒤집혀** '매도 시그널'이 자산을 늘린다(미러 #308·#308b).
- **⚠️ 매도 대금은 매매 주머니로**(사용자 확정) — `cashDiv`를 늘리지 않는다. 시그널 매매는
  `structural`·`reinvest` 어느 쪽도 아니라 **`tradeNet`에 그대로 들어가고**, 그래서 기말 예수금 분해
  항등식(#125)에 **새 항이 생기지 않는다**(미러 #303·#304·#317). 표시용 라벨은 `BtTrade.signal`
  (`'buy'|'sell'|'realloc'`) — ⚠️ `note`에 접두어로 붙이지 말 것(화면이 `t.note === '바닥선'` 정확
  일치로 툴팁을 고른다).
- **⚠️ `sellLevels`의 기본값은 빈 배열이고 `normalizeSellLevels`는 그것을 기본 단계로 되돌리지 않는다**
  (매수 `normalizeDipLevels`와 **반대**). 매도는 "안 쓰는 것"이 정상 상태이고, 기본 단계를 밀어 넣으면
  켠 적 없는 매도가 조용히 실행돼 기존 결과가 달라진다(미러 #305·#312).
- **⚠️ 현금 바닥선은 `allowNegativeCash`보다 우선**한다(가드 #229). 매도·분배금 재투자에는 적용하지 않는다.
- **⚠️ 원천징수는 `divPaid`를 세후로 정의**했다 — `divAccrued`(권리 확정액)는 세전 그대로 두고 현금
  흐름만 세후로 바꾼다. 그래야 **기말 예수금 분해 항등식(#125)이 종전 그대로** 성립한다:
  `finalCash = initialCashAfter + cumTradeNet + cumStructuralNet + cumReinvestNet + cumDivPaid`.
  세금은 애초에 입금되지 않은 돈이라 **분해 그룹에 항을 더하면 합이 어긋난다** — 화면·CSV 모두
  분배금 항을 '(세후)'로 라벨링만 하고 세금은 참고 줄로 뺀다(가드 #245). `curve`의 분배금 현금도
  세후여야 `curve.cash === finalCash`가 유지된다(가드 #230).
- **⚠️ 연간 증액은 목표 금액 모드 전용**(비중 모드는 목표가 '평가액 합계 × 비중'이라 올릴 대상이 없다 —
  매월 증액과 같은 이유). 실제로 일하는 가드는 **스케줄링 쪽**이고 스텝 핸들러의 가드는 도달 불가한
  방어적 중복이다(contrib과 대칭). `reserve`는 **surplus 상한**으로 보호돼 `value>100%`여도 남는다.
  같은 날 겹치면 **contrib 먼저 → annual 나중**(`KIND_ORDER`).
- **KPI**: `minCash`(생존 판정 핵심) · `minCashDiv`(**첫 분배금 입금 이후**만 잰다 — 0에서 시작하므로
  전 구간으로 재면 항상 0) · `divMonthlyAvg/Stdev`(**첫 분배 달~마지막 달 연속 구간**, 이후의 진짜 0원
  달은 포함해야 '끊겼다'가 드러난다) · `bandSkipCount/Amount` · **`signalEvents`** · `shortfallMonths`.
  `BtMonth.shortfallCount`가 필요한 이유: **매수가 0으로 잘리면 거래 행 자체가 남지 않아** 표에서
  부족이 사라진다.
- **⚠️ `signalEvents`는 화면이 계산식을 재현할 수 있게 밑변까지 남긴다**(사용자 요청 2026-08:
  "`1단계 · 매수 재원 ₩A × 34% = ₩B`처럼 상세히"). 필드: `kind`(buy/sell) · `step`(1부터) · `level` ·
  **`pct`/`pctSum`**(`number | null`, null=목표까지) · **`carrier`**(대표 행인가) ·
  **`poolAt`**(매수 밑변 = 재원 스냅샷) · **`excessAt`**(매도 밑변 = 목표 초과분) ·
  **`planned`**(비율·목표 상한 적용 후 목표 매매금액) · `divPocketAt` · `cashTradeAt` ·
  `used`(분배금에서 나간 몫) · `ref`(고점 또는 저점) · `price` · `tradeQty` · `tradeAmount` ·
  `fromTrade` · `reallocAmount` · `note`. 옛 화면은 `개방 ₩0 → 사용 ₩0` 한 줄이라 **왜 0인지** 알 수
  없었다 — 미체결이면 `note`(재원 없음·목표 이상·종가 없음 등)를 그대로 보여 준다(가드 #259b).
  문장 포매터(`sigLabel`·`sigRefText`·**`sigSizeText`**·`sigFundText`·`sigOutcomeText`)는 **화면과 CSV가
  공유**한다 — 각자 만들면 같은 사건이 화면과 파일에서 다르게 설명된다.
  ⚠️ 같은 종목의 여러 단계가 같은 날 겹치면(갭 하락/급등) 이벤트는 단계별로 남기되 **체결·규모는 그
  종목의 첫 이벤트(carrier)에 합산**하고 나머지는 `note`로 그 사실을 밝힌다(행마다 나눠 실으면 같은
  체결이 두 번 표시된다). `reallocAmount`는 **날짜 단위 값**이라 그날 첫 매수 이벤트에만 싣는다.
- **화면**: 설정은 **`⑤-b 전략 옵션 — 매매 시그널 설정`**(가드 #243이 이 문자열을 그대로 단언한다) —
  ⑥ 종목을 ⑦로 밀지 말 것(엔진 경고가 '⑥ 종목에서…'를 가리킨다,
  가드 #243). 결과는 `StrategyKpis`(단일 뷰·비교 블록이 `SummaryCard`를 **공유**, 가드 #242), 비교 표에
  **기말 예수금·적립 분배금·최저 현금·월분배 표준편차**(⚠️ 실행 불가 행의 `colSpan`을 함께 고칠 것 —
  가드 #241이 thead `<th>` 수와 대조하고, 비교 CSV는 **33열**이라 가드 #247도 함께 고쳐야 한다).
  요약 카드는 **7장**(…·기말 예수금·적립 분배금)이라 `xl:grid-cols-4`다 — 7열로 늘리면 카드 폭이
  100px 아래로 떨어져 `₩381,666,374`가 줄바꿈된다. 월별 표는 **12열 유지**하고 `t.note`('바닥선'·
  '예수금 부족')는 날짜 셀 **배지**로 붙인다(비고 열이 없어 그러지 않으면 안 보인다, 가드 #246).
- **⚠️ 화면은 `dipOf`/`annualOf` 안전 접근자로만 읽는다**(`active.dip.enabled` 직접 접근 금지, 가드 #244) —
  `@ts-nocheck` 파일이라 컴파일러가 못 막는데, 정규화를 우회한 config가 한 번이라도 들어오면 렌더 중
  TypeError가 루트 ErrorBoundary까지 올라가 **화면이 통째로 오류 페이지**가 된다(`runBacktest`는
  try/catch로 감싸여 있지만 **렌더는 감싸여 있지 않다**).
- **⚠️ `<label>` 안에 `Hint`(=`<button>`)를 두지 말 것** — label 활성화 동작이 내부 체크박스를 함께
  토글해 `?` 아이콘을 누를 때마다 그 옵션이 켜졌다 꺼진다(가드 #249). Section 헤더의 '버튼 중첩 금지'와
  같은 부류다.
- **영속화 신규 지점 0곳** — 6필드가 전부 `BtConfig` **안**이라 App.tsx 7지점이 `backtestScenarios`를
  통째로 실어 나른다. 등록은 `makeBtConfig`·`normalizeBacktestScenarios`·`backtestFingerprint` 3곳뿐.
  ⚠️ **정규화 멱등이 핵심 불변식**(검증 #237): 레거시는 첫 로드에서 **한 번만** 새 배열을 돌려주고
  그 뒤로는 **같은 참조**여야 한다 — 매번 새 배열이면 ① 폴링마다 재저장 ② `BacktestPage` 시드 effect가
  로컬 사본을 갈아엎어 **2.5초 idle 승격 전의 편집이 사라진다**.
- **적대적 리뷰 확정 결함 5건 (⚠️ 되돌리면 그대로 재발 — 검증 #250~#259)**:
  ① **(폐기 — 2026-08 시그널 당일 실행 전환으로 원인 자체가 사라졌다)** 옛 설계에서 `delta === 0`
  회차는 `runPlan`의 두 필터(`delta<0`/`delta>0`) 어디에도 안 들어가 급락 개방과 밴드 면제가 다음
  회차까지 살아남았다. 지금은 개방을 회차 너머로 들고 다니지 않으므로 이 결함이 재발할 코드가 없다.
  #250은 그 자리에서 **"시그널이 정기 리밸런싱으로 새지 않는다"**(밴드가 정기 매매를 전부 막는다)를
  대신 지킨다. ⚠️ 옛 수명 모델로 되돌리면 이 결함도 함께 되살아난다.
  ② **증액 상한이 총 `cash`라 `tradeOnly`·바닥선에서 무력화**됐다 — 쓸 수 없는 돈까지 목표에 얹혀 매달
  복리로 부풀고(실측 목표 5,000만 → 3억 4천만, 평가액은 9,386만) '누적 증액'이 투입되지 않은 돈을 보고했다.
  → **`deployableCash`**(tradeOnly면 `cashTrade`, 바닥선이 있으면 그만큼 차감)로 자른다. 매월·연간 **양쪽**.
  ③ **같은 낙폭 단계를 두 번 적으면 런타임에 두 번 발동**해 개방액이 2배가 되고, 저장·재로드 뒤에는
  정규화가 dedup해 **같은 시나리오가 세션마다 다른 결과**를 냈다. → `runBacktest`가 사전탐지 전에
  `normalizeDipLevels`를 태운다. ⚠️ **이 경로는 `makeBtConfig`로 테스트하면 안 된다** — 거기서 이미
  정규화돼 죽은 단언이 된다(실제로 그랬다). 화면은 `patchActive` 스프레드로 만든 **정규화되지 않은
  로컬 사본**을 그대로 넘기므로, 테스트도 `cfg.dip = {...}`를 직접 주입해 그 경로를 재현한다.
  ④ **화면의 '아직 미지급'을 `cumDivAccrued − cumDivPaid`로 구하면 세금까지 미지급으로** 표시된다
  (`cumDivAccrued = cumDivPaid + cumDivTax + 미지급 세전분`). 반드시 `cumDivTax`를 빼고 구한다.
  ⑤ **급락 단계에 행 추가·삭제 UI가 없어** 중복 낙폭이 정규화로 지워지면 되돌릴 수단이 없었다.
  → 행 삭제 버튼 + '단계 추가' + **중복 낙폭 즉시 경고**.
- **⚠️ `reserve`는 예수금의 하한이 아니다** — 연간 증액의 **재원에서 제외**될 뿐, 기존 목표를 복원하는
  평소 매수는 그냥 예수금을 쓴다. 예수금 자체에 하한을 두려면 `cashFloorPct`를 쓸 것(그쪽이 매수를 자른다).
- **범위 밖(의도)**: 매매차익 과세 · 거래수수료 · 슬리피지 · 시그널 단계 매수/매도 각 5개 초과 · undo/redo.
  **알려진 한계**: ① 시그널 매수는 그 종목이 **편입 구간 안**(`effectiveStart~End`)이고 `removed`가
  아니어야 발동한다(그 밖은 이벤트로 기록만 남고 체결 0). ② 재조정(②)은 **목표 초과분이 있는 종목**만
  판다 — 전 종목이 목표 이하면 아무것도 팔지 않는다(설계상 의도). ③ 매도 시그널은 목표 **아래로는
  팔지 않으므로**, 목표 미달 보유 상태에서는 반등해도 아무 일도 일어나지 않는다.

**시나리오 평가 · 메모 (`review` / `notes`) — AI 분석 기록 (⚠️ 회귀 주의)**

결과 화면 **표제 바로 아래(= 헤더 상단)** 의 `ScenarioReviewCard`. `BtConfig`에 저장 필드 2종을 더한다:
`review = {rating:'good'|'watch'|'bad'|'none', verdict(한 줄 결론), updatedAt}` +
`notes: BtNote[] = {id, kind:'ai'|'user', title, body, snapshot, createdAt, updatedAt}`.
사용자가 AI에게 받은 분석을 그 시나리오에 붙여 두고 다음에 열 때 그대로 보기 위한 **기록 전용** 기능이다.

- **⚠️ 1급 계약: 결과에 1원도 영향을 주지 않는다**(검증 #261). `runBacktest`는 두 필드를 읽지 않는다 —
  읽는 순간 "메모를 고쳤더니 수익률이 달라졌다"가 되어 기록으로서의 신뢰가 사라진다.
- **⚠️ 그럼에도 지문·sticky·정규화에서는 1급 저장 데이터로 다룬다**. `makeBtConfig`는 **화이트리스트
  재구축기**라 등록을 빠뜨리면 네 경로에서 통째로 사라진다 — Drive 로드 · 백업 복원 · 별도 창 수신
  (`normalizeBacktestScenarios`) · **시나리오 복제**(`addScenario`가 `makeBtConfig`로 사본을 만든다).
  `backtestFingerprint`에는 **본문 전문**을 넣는다(길이·개수 해시 절충 금지 — `investmentNotesKey`가
  '본문만 고치면 저장 안 됨'을 냈던 그 절충이다). `review.updatedAt`·`note.createdAt/updatedAt`은 **제외**
  (커밋 시각만 바뀌어도 저장이 재트리거되는 것 방지, #55 규약). 검증 #262~#266.
- **⚠️ `backtestScenariosHaveContent`에도 넣되 '값이 실제로 있는가'로만 잰다** — 종목을 다 지우고 분석만
  남긴 시나리오가 백업 복원에서 조용히 사라지면 복구 불가다. 단 `!!s.review` 같은 **존재 판정은 금지**
  (makeBtConfig가 모든 시나리오에 기본값을 물리므로 전부 true가 되어 "빈 시나리오 1개 = 내용 없음"
  계약이 깨지고 복원 경로가 영구히 막힌다). 검증 #267·#268·#268b.
- **⚠️ 스냅샷 지문은 `backtestSettingsFingerprint`(신설, 결과에 영향 주는 필드만)로 만든다** —
  `backtestFingerprint`를 쓰면 그 지문 안에 `notes` 자신이 들어 있어 메모를 한 건 추가하는 순간 지문이
  달라지고, 그 결과 **모든 메모가 영구히 '설정이 바뀜'** 으로 표시된다(배지가 상시 켜지면 진짜 변경을
  알리는 기능이 죽는다). 이 함수는 `id·name·review·notes·compareOn·createdAt·updatedAt`을 제외한다.
  검증 #272~#274·#284·#290c.
- **⚠️ 편집은 로컬 draft + blur 커밋**(`NumInput`·`DivInput`과 같은 계약). 매 keystroke 커밋하면 `active`
  참조가 바뀌어 220ms 뒤 백테스트 전 구간이 재실행되고 결과 표 전체가 리렌더된다. draft를 두는 순간
  유실·오적용 경로가 생기므로 **FlowInspector 규약 3종을 세트로** 넣는다(빠뜨리면 조용한 데이터 사고):
  ① 쓰기는 **id 기준 `patchScenarioById`** — `patchActive`는 렌더 시점 `active?.id`를 클로저로 잡아
  타이핑 중 시나리오를 바꾸면 draft가 **다른 시나리오에 기록**된다. 빈 패치는 조기 return(값이 그대로면
  아무것도 쓰지 않는다 — 안 그러면 Drive 4파일 write가 헛돈다).
  ② flush는 **`useLayoutEffect`**(소유자 변경 + 언마운트) — passive effect는 discrete 이벤트인 blur보다
  뒤처지고, 언마운트된 DOM에는 blur가 아예 발화하지 않는다. 호출부의 `key={active.id}`가 2차 방어선.
  ③ `registerFlush`로 커밋 훅을 부모에 등록하고 **`promote()` 첫 줄**에서 부른다 — promote는 `localRef`만
  회수하므로 draft를 전혀 보지 못한다. CSV는 flush 후 **로컬 사본에서 다시 읽는다**(`flushReview`는
  setState라 그 렌더의 `active`에는 반영되지 않는다). 검증 #275~#279.
- **⚠️ 인쇄 미러 `.bt-printonly` 2줄은 짝이다**(화면 숨김 / `@media print` 표시). textarea는 내부
  스크롤이라 **보이는 만큼만** 인쇄되고 접어 둔 메모는 렌더조차 되지 않는다 → 정적 텍스트 사본이 인쇄를
  담당한다. 미러가 draft를 그대로 읽으므로 blur가 나지 않는 Ctrl+P 경로에서도 방금 친 내용이 실린다.
  ⚠️ **그 짝으로 `empty`(인쇄 제외) 판정도 draft 전체를 봐야 한다** — `hasReviewContent(cfg)`(커밋값)만
  보면, `addNote`가 만드는 메모는 title·body가 `''`이라 붙여넣고 blur 없이 Ctrl+P를 누른 순간
  `empty=true` → 카드 루트에 `bt-noprint` → 인쇄 CSS가 카드를 감추면서 **그 안의 미러까지 함께 사라진다**
  (자손의 `display:block !important`는 `display:none` 조상을 되살리지 못한다). 미러가 존재하는 유일한
  이유가 그 경로이므로 이 비대칭은 기능을 정확히 무효화한다(적대적 리뷰 확정 결함, 검증 #292).
  ⚠️ 카드 전체에 `bt-noprint`를 붙이지 말 것(평가가 PDF에서 사라진다 — 빈 카드만 붙인다).
  ⚠️ `bt-month`(page-break-inside: avoid)도 붙이지 말 것 — 긴 분석이 한 장에 욱여넣어져 뒤가 잘린다.
  ⚠️ 등급 색은 **text-\* 클래스**로만(인쇄 CSS `.bt-shell * { background: transparent !important }`가
  인라인 배경을 이겨 배지가 통째로 사라진다 — `Swatch`가 인라인 SVG인 것과 같은 근거). 검증 #280~#282.
- **⚠️ 화면은 `reviewOf`/`notesOf` 안전 접근자로만 읽는다**(`cfg.review.rating` 직접 접근 금지) —
  `@ts-nocheck` 파일이라 정규화를 우회한 config 하나가 렌더 중 TypeError를 내면 루트 ErrorBoundary까지
  올라가 **화면이 통째로 오류 페이지**가 된다(`dipOf`/`annualOf`와 같은 규약). 검증 #283.
- **⚠️ 삭제는 인라인 2단계 확인**(`delId`) — 이 화면은 z-1090이고 별도 창에는 App조차 마운트되지 않아
  `ConfirmDialog`(z-1000)도 알림 토스트도 뜨지 않는다(`splitEven`의 `evenConfirm`과 같은 근거).
  긴 분석을 오클릭으로 잃으면 복구 불가다. 검증 #285.
- **⚠️ 상한은 화면 `maxLength`와 정규화가 같은 상수를 쓴다**(`MAX_BT_NOTES` 12 / `MAX_BT_NOTE_LEN` 8000 /
  `MAX_BT_NOTE_TITLE_LEN` 80 / `MAX_BT_VERDICT_LEN` 200). 정규화에서만 자르면 붙여넣은 분석의 뒤가
  **조용히** 사라진다. STATE는 백업 22본으로 복제되고 `backtest:live`가 시세 조회마다 시나리오 전량을
  재직렬화하므로 상한 자체는 필수다. 검증 #270·#286.
- **⚠️ 별도 창(`variant='page'`)은 `pagehide`에서 승격한다** — 창에는 App의 종료 커밋 체인
  (`backtestExitCommitRef`)이 없어 최대 2.5초분 편집이 **어떤 저장 경로로도 회수되지 않는다**. 짧은
  설정값이면 무해했지만 **AI 분석을 붙여넣고 곧바로 창을 닫는 것이 이 기능의 주 사용 시나리오**다.
  `promote`는 dirty가 없으면 null을 반환하므로 부작용 0. 검증 #287.
- **영속화 신규 지점 0곳** — 두 필드가 `BtConfig` **안**이라 App.tsx 7지점이 시나리오 배열을 통째로
  실어 나르고, 별도 창 브릿지도 시나리오를 통째로 주고받는다(필드별 나열 금지 — 나열하면 새 필드가
  창에서만 조용히 사라진다). 등록은 `makeBtConfig`·`backtestFingerprint`·`backtestScenariosHaveContent`
  **3곳뿐**. 검증 #288·#290·#290b.
- **⚠️ 메모 스냅샷은 조건(`conditions`·`fp`)과 숫자(`summary`)를 **같은 config**에서 가져온다** —
  설정 칸을 고친 직후 곧바로 `[AI 분석]`을 누르면 그 클릭의 mousedown이 blur→커밋을 먼저 태워
  `active`는 이미 새 값인데 `result`는 220ms 디바운스라 **옛 실행분**이다. 섞으면 "새 조건 + 옛 숫자"가
  영구 박제되고 `fp`가 현재와 같아져 **stale 배지마저 뜨지 않는다**(배지의 존재 이유가 무력화된다).
  → 결과를 낸 그 config(`runCfg`)를 박제하면 설정이 앞서 나간 경우 지문이 자연히 어긋나 배지가 즉시
  켜진다. ⚠️ `runCfg.id === active.id` 확인 필수 — 시나리오를 막 바꾼 220ms 동안 `runCfg`는 **직전
  시나리오**를 가리킨다. 검증 #293.
- **⚠️ 카드는 `result.ok`가 false일 때도 렌더한다**(fatal 안내 **위**). 이 분기는 종목을 지운 경우만이
  아니라 **저장된 시나리오를 새 세션에서 여는 흔한 경로**로도 들어온다 — `btFetched`는 메모리 전용이라
  보유하지 않은 코드는 종목마다 ⟳를 누르기 전까지 '종가 데이터가 있는 종목이 없습니다'로 떨어진다.
  여기서 카드를 빼면 상단 바 칩은 `메모 N`을 광고하는데 눌러도 갈 곳이 없고, 저장해 둔 AI 분석에 닿는
  경로가 **0개**가 된다(단일 뷰 CSV·PDF 버튼도 `!result.ok`로 잠겨 있다). 검증 #291.
  **알려진 한계(의도)**: 그 상태에서 CSV·PDF 버튼은 여전히 잠긴다(둘 다 '결과 내보내기'라서) —
  화면에서 읽고 Ctrl+P로 인쇄하는 경로는 열려 있다.
- **표시 지점**: 단일 뷰 표제 아래 카드(편집 가능) / 비교 표 **시나리오 셀 안**(읽기 전용 — ⚠️ 열을 늘리면
  thead·실행불가 행 colSpan·비교 CSV를 전부 맞춰야 한다) / 비교 뷰 시나리오 블록(읽기 전용) /
  메인 CSV 별도 행(13열 유지, 기말예수금 분해 그룹 **밖**) / 비교 CSV **`평가`·`한 줄 결론` 2열**
  (30 → **32열**, 검증 #247의 하드코딩 열 수도 함께 바뀌었다).
- **범위 밖(의도)**: 비교 뷰에서의 편집(active가 null이라 draft 소유자 판정이 성립하지 않는다) ·
  메모 undo/redo · 메모 검색/정렬 · 메모의 계좌 간 공유.

**시그널 사이징 분리 · 재원 배분 · 목표 비중 분모 (A~F, 2026-08) (⚠️ 회귀 주의)**

시그널 매매(**전술 레이어**)와 목표 비중 유지(**정기 리밸런싱 레이어**)를 완전히 분리한 개편.
발단은 실측 결함이다 — 시그널이 발동해도 그 종목 비중이 이미 목표를 넘고 있으면 `목표까지 = ₩0`
이라 매수가 통째로 미체결되고, 목표 이하면 `목표 초과분 = ₩0`이라 매도가 미체결된다. 두 종목이
**동반 하락하면 평가액은 줄어도 비중은 그대로**라 하락이 매수 여력을 만들지 못해, 전 구간 체결이
매도뿐이고 예수금이 단조 증가하는 일방향 편향이 생겼다(사용자 실측: 체결 7건 전부 매도 · 매수
시그널 2건 전부 미체결 · 예수금 ₩14,502 → ₩110,189,130).

- **⚠️ 최우선 계약 = 레거시 결과 불변**. 모든 신규 옵션의 기본값이 종전 동작과 **1원도 다르지 않다**.
  그 근거는 `legacyBuySizing`/`legacySellSizing` 두 줄이다 — 저장된 단계에 `sizing`이 없으면
  `buyPct === null ? 'toTarget' : 'toTargetCapped'`(매도는 `sellPct === null ? 'toTarget' : 'pctOfExcess'`)
  로 떨어진다. ⚠️ **레거시 `buyPct: 34`를 `pctOfPool`로 떨어뜨리지 말 것** — 그 순간 목표 캡이 풀려
  저장된 시나리오의 결과가 통째로 달라진다.
- **A-1 사이징 모드(단계별)** — 매수 6종 `toTarget` / `toTargetCapped`(=레거시 `buyPct:number`) /
  `pctOfPool` / `fixedAmount` / `pctOfTotal` / `restoreBase`, 매도 6종 `toTarget`(=레거시 null) /
  `pctOfExcess`(=레거시 number) / `pctOfEval` / `pctOfQty` / `fixedAmount` / `excessOverBase`.
  ⚠️ **`toTargetCapped`·`pctOfExcess`를 '중복 선택지'로 보고 지우지 말 것** — 이 둘이 레거시가
  마이그레이션되는 자리이고, 화면에 '현행'으로 노출해야 사용자가 "왜 ₩0으로 미체결인가"를 이해한다.
- **A-2 목표 캡 해제 = `buyUsesTargetCap`/`sellUsesTargetCap` 두 함수가 유일한 게이트**.
  레거시 계열이 아니면 목표 비중과 무관하게 체결한다("목표 이상 — 살 것 없음"·"목표 이하 — 팔 것
  없음" 금지). ⚠️ 남는 구조적 미체결은 **보유 0(`NO_POSITION`)뿐**이다.
- **A-3 이탈 한도(±X%p)** — 매매 **후** 비중이 목표 ±X%p를 넘지 않게 주문을 축소한다.
  상한은 `목표 ± 분모 × X/100`(= 비중 X%p를 금액으로 환산). 축소되면 `CAP_DEVIATION`.
  ⚠️ 목표 캡을 푼 모드에서 **유일하게 남는 안전장치**라 지우지 말 것.
- **A-4/A-5 기준 평가액 축** — `lastFill`(직전 체결 시점 평가액) / `prevMonthEnd` / `peakEval` /
  `manual`. 종목별로 `BtAsset.baseAxis`가 덮어쓴다.
  ⚠️ `prevMonthEnd`는 **달이 바뀌는 첫 스텝에서 한 번** 스냅샷한다(`syncMonthEndBase`) — 그 시점
  `p.qty`가 직전 달 말일까지의 매매를 전부 반영한 값이다(스텝이 날짜 오름차순이므로). 나중에 다시
  계산하려면 거래를 재생해야 하므로 이 '경계에서 한 번' 방식이 유일하게 싸다.
  ⚠️ `peakEval`은 매 영업일 관측이 필요해 `needDailyEval`이 **앵커 축과 같은 분기**로 매 영업일
  signal 스텝을 만든다. 그 관측 블록은 **조기 탈출보다 앞**이다(트리거 없는 날에도 고점은 갱신돼야 한다).
  ⚠️ 폭주 방지 3종(`resetOnFill` · `maxReuse` · 종목별 누적 매수 한도 `buyCapMode/Value`)을 빼지 말 것 —
  복원 모드는 **하락이 이어지면 요구 금액이 계속 커져 재원이 고갈되는 구조**다.
- **A-6 재원 배분** — `alloc.mode: 'sequential'`(기본 = 종전 동작, 배분 코드를 통째로 우회) /
  `'weighted'`. 워터폴은 `utils`가 아니라 **`backtest.ts`의 순수 함수 `waterfallAllocate`**다
  (T11~T14가 이 한 함수의 산술이라 단위 테스트가 가능해야 한다).
  ⚠️ 실행·타이브레이크는 언제나 **⑥ 종목 등록 순서**(`regIndex`) — 그래야 순서를 뒤집어도 결과가 같다.
  ⚠️ 1주 값·최소 주문에 미달한 배분은 `ROUNDING`으로 빼고 **그 몫을 재원으로 되돌려 다시 나눈다**
  (`items.length`회 반복이면 반드시 수렴).
  ⚠️ 최소 유보 현금·현금 바닥선은 **배분 전에** 재원에서 차감한다(A-6-7).
- **B 목표 비중 분모** — `ratioBase: 'equity'`(기본) / `'equityCash'`(총자산).
  ⚠️ 분기는 **`targetBaseAt` 한 곳뿐**이다(소스 가드 #151이 `config.ratioBase === 'equityCash'` 출현
  횟수를 1로 못 박는다). 그 한 함수를 정기 리밸런싱·시그널 목표·밴드 판정·현금 바닥선 기준이 전부
  지나므로 '일관 적용'이 구조로 보장된다. 옛 4종(`total`/`initial`/`totalWithDiv`)은 되살아나지 않는다
  (`makeBtConfig`가 `'equityCash'` 외 전부를 `'equity'`로 떨어뜨린다).
- **C 충돌 규칙** — `conflict: 'signalFirst'`(기본) / `'regularFirst'` / `'skipSignal'`.
  ⚠️ **`KIND_ORDER` 리터럴은 건드리지 않는다**(소스 가드가 그 리터럴을 단언한다) — `stepOrderOf`가
  정렬 시점에만 signal↔rebal 순위를 맞바꾼다. `cooldownDays`/`excludeRegularDays`는 휩소 방지.
  ⚠️ 쿨다운으로 막힌 발동도 **`COOLDOWN` 사유로 로그에 남긴다** — 조용히 사라지면 왜 매매가 없는지 알 수 없다.
- **D `anchorOnNoFill`** — 체결 0인 발동 뒤 앵커 기준가를 유지(기본)/그날 종가로 갱신.
  `forceAnchor`는 `touchAnchor`와 달리 `anchorSource` 규칙을 보지 않는다(체결이 아니라 명시적 재설정).
- **E `minCashReserve`** — 현금 바닥선(%)과 **한 자리에서 합친다**(`cashFloorAt` = 둘 중 큰 값).
  기본 0이면 0을 반환해 `floorCap`이 Infinity로 남아 종전 코드와 동일하다.
- **F 로그·집계** — `BtSignalEvent`에 `sizing`·`basisKind`·`basisAmount`·`ordered`·`caps`·`reason`·
  `refDate`·`baseEval`·`restoreRate`·`shortfall`·`allocWeight`/`allocAmount` 추가. 사유 코드 11종.
  `summary.signalStats`(매수/매도 분리 + 사유별 집계)와 `summary.allocBlocks`(A-6-8 배분 표) 신설.
  ⚠️ 이벤트 생성은 **`makeSignalEvent` 단일 생성기**를 지난다 — 경로마다 객체 리터럴을 복제하면
  한 곳이 `undefined`로 남아 화면에 `NaN`·빈칸이 뜬다.
- **⚠️ `dip`의 중첩 객체(`alloc`·`baseline`)는 반드시 정규화해서 읽는다**(`dipAlloc`/`dipBaseline`).
  화면은 `patchActive`가 스프레드로 만든 **정규화되지 않은 로컬 사본**을 그대로 넘기므로
  `config.dip.alloc.mode`처럼 파고들면 그 순간 TypeError로 실행이 죽는다(검증 #254의 raw 주입 경로가
  정확히 그것이다). 스칼라 필드는 `|| 0` / `=== '값'` 비교라 안전하다.
  같은 이유로 화면의 `dipOf`에도 두 객체를 **반드시** 채운다(dip 쓰기의 스프레드 베이스).
- **⚠️ 지문 확장은 `fpExtras` 조건부 토큰**(`x` 키). 지문 배열에 새 칸을 그냥 끼워 넣으면 값이
  기본값이어도 저장된 모든 시나리오의 지문이 달라져 **모든 메모에 '설정이 바뀌었습니다' 배지가
  상시 켜진다**(배지 기능이 죽는다). `SETTINGS_FP_SCHEMA`를 올리는 것도 같은 결과라 부적절하다 —
  이번 변경은 '같은 저장값의 뜻이 바뀐' 경우가 **아니다**. 단계 토큰도 `dipLevelToken`/`sellLevelToken`이
  **레거시 파생값과 같으면 한 글자도 덧붙이지 않는다**. `putEnum`은 **정규화가 실제로 채택하는 값만**
  토큰으로 낸다 — 엔진이 버리는 문자열(옛 분모 값)이 지문만 흔드는 것을 막는다(검증 #109b).
- **영속화 신규 지점 0곳** — 전부 `BtConfig`/`BtDip`/`BtDipLevel`/`BtSellLevel`/`BtAsset` **안**이라
  App.tsx 7지점이 시나리오 배열을 통째로 실어 나른다. 등록은 `makeBtConfig`·`normalizeDip`(+
  `normalizeBaseline`/`normalizeAlloc`)·`makeBtAsset`·`fpExtras` **4곳뿐**.
- **범위 밖(의도)**: 매도 동시 발동의 재원 배분(재원 제약이 없어 각각 독립 처리) · undo/redo ·
  세금·수수료·슬리피지. **알려진 한계**: `skipSignal`로 건너뛴 날의 고점/저점 축 트리거는 사전 탐지에서
  이미 소진돼 되살아나지 않는다(사용자가 "그날 시그널 무시"를 고른 의미 그대로다).

- 검증: `npm run verify:backtest` (501건 — 참조 구현 미러 #1~#58·#69~#77·#81~#112·#113~#133·#141~#145·
  **#157~#226**·**#235~#240**·**#250~#256**(적대적 리뷰 회귀)·**#260~#274**(평가·메모)·
  **#300~#323c**(시그널 당일 실행·매도 시그널·재원 단일 규칙·분모 캐스케이드·적대적 리뷰 확정 결함 4건·
  **예수금/분배금 재정의**) + 소스 텍스트
  가드 #59~#68·#78~#80·#134~#140·#146~#156·**#227~#234**(#233·#233b·#233c = 시그널 계약)·
  **#241~#249**·**#257~#259c**(#259b~#259d = 계산식 표시·매도 UI·매매 라벨)·
  **#275~#290c**(평가·메모 배선)·**#291~#293**(적대적 리뷰 확정 결함 3건 회귀)·
  **#382**(초기 매수 후 잔여 공유 helper — 프로덕션 ReferenceError 회귀)·
  **#400~#444**(A~F 사이징 분리·배분·분모·충돌·로그 — T2~T14를 사용자 실측 입력 그대로 재현)).
  ⚠️ **#450·#450b는 `src/backtest.ts` 실모듈을 임시 폴더에 복사해 import한 뒤 미러와 결과를 대조하는
  드리프트 가드**다(Node 타입 스트리핑). 미러 테스트만으로는 "src에만 넣은 변경"·"미러에만 넣은 변경"이
  전부 통과하는데, 이 가드가 그 구멍을 막는다. 지원하지 않는 런타임에서는 명시적으로 건너뛴다고 출력한다.
  ⚠️ A~F 테스트는 **기능마다 '동작 케이스 + 기본값 무영향 케이스'를 쌍으로** 둔다(#403b·#409b·#410b·
  #413b·#414b·#424) — 무영향 케이스가 없으면 "레거시 결과 불변"이 무방비다.
  ⚠️ **2026-08 예수금/분배금 재정의의 핵심 단언**: 재원 잠금 #177b · 목표 상한 #175b · 매도 비율
  #312b~#312f · 재조정 게이팅 #313b · 분해 항등식 2개 #304b·#304c · 초기 매수 예산 #323~#323c ·
  지문 null≠0 #220b · 레거시 마이그레이션 #215b · 미체결 사유 분리 #175c · 지문 스키마 토큰 #290d.
  **전부 변이 테스트로 실제 검출을 확인**했다
  (M1 재원 잠금 / M2 분모 / M8 carrier / M10 목표 상한 / M13 예산 차감 — 각각 처음엔 **죽은 단언**이었고
  픽스처를 고쳐 잡히게 만들었다. 이 단언들의 픽스처를 단순화하지 말 것).
  ⚠️ **#290·#290b·#290c는 `src/backtest.ts`를 직접 읽는 드리프트 가드**다 — #260~#274는 미러만 검사하므로
  src에만 넣거나 미러에만 넣으면 통과하면서 실제 저장 누락을 놓친다(아래 rebalMode 실측 사고와 같은 함정).
  보조 규칙 6종은 기능마다 **'동작 케이스 + 기본값 무영향 케이스'를 쌍으로** 둔다 — 무영향 케이스가
  없으면 하위호환 계약이 무방비다.
  목표 기준(비중 분모 고정) 관련: 미러 #43·#90~#91b·#106~#108d·#109~#109b·#144~#144b,
  가드 #151~#153·#156 / 확대 시 겹침·팝오버 잘림: 가드 #154·#155.
  ⚠️ #109b는 **정규화 전 raw 객체**로 지문을 비교한다 — `makeBtConfig` 출력을 넣으면 필드가 이미
  사라진 뒤라 지문 투영이 되살아나도 통과하는 죽은 단언이 된다(#109의 동어반복). 실제로 그랬다.
  ⚠️ **미러 테스트는 픽스처가 그 경로를 실제로 밟을 때만 의미가 있다** — 재투자 픽스처가
  `targetAmount === initialCapital` + `policy:'none'`이라 `cashTrade`가 항상 0이었을 때는
  `applyCash(..., 'div')`에서 `'div'`를 지워도 164개가 전부 통과했다(이 기능의 핵심 가드가 통째로
  미검증). `#122c~#122e`가 **매매 주머니에 잔액이 남는 별도 픽스처**로 그 변이를 잡는다.
  새 가드를 넣을 때는 **일부러 깨뜨려 보고(변이 테스트)** 실제로 실패하는지 확인할 것.
  ⚠️ 미러(`scripts/verify-backtest.mjs`)의 **`backtestFingerprint` 투영**은 특히
  드리프트가 잘 난다 — 신규 필드를 `src/backtest.ts`에만 넣고 미러를 잊으면, 지문 테스트가 통과하는데도
  실제 저장 누락을 못 잡는다(실측 사고: `rebalMode`/`rebalDay`/`rebalDates` 3필드 누락).
  `src/backtest.ts`의 순수 함수 본문과 **항상 1:1 동기화**할 것. #23~#42가 PDF 전체를 숫자로 재현하므로
  산식을 바꾸면 여기서 잡힌다.

### 종목코드 입력 → 이름·종가(·분배금)를 **그 자리에서** 확보 (⚠️ 회귀 주의)

코드를 넣는 화면은 3곳(포트폴리오 테이블 · 비교종목 칩 · 백테스트 종목)인데, 과거엔 **테이블만**
네트워크로 실제 데이터를 받아왔다. 그래서 나머지 두 곳은 "일단 포트폴리오 테이블에 그 코드를 넣고
(분배금은 표에서 '새로고침'까지 눌러) 계좌 데이터를 만든 뒤에야" 동작했다. 세 경로 모두 코드 입력만으로
완결되게 맞췄다. **어느 경로도 조회 결과를 계좌 데이터에 쓰지 않는다.**

- **비교종목(`useStockData`)** — `handleCompStockBlur`가 **이름 + 종가 이력까지** 확보한다.
  - **⚠️ 이력 fetch 체인은 `ensureCompHistory` 하나뿐**(blur·toggle 공유). 두 경로가 각자 체인을 가지면
    실제종가/수정종가 우선순위가 갈려 한 종목 안에 두 가격기준이 섞인다(`mergeCodeHistory` 주석).
    `ensureCompHistory`는 **절대 reject하지 않고**(`catch → false`) 코드별 in-flight 프로미스를 공유한다 —
    칩의 `loading` 플래그로 중복을 막으면 어느 경로가 예외로 죽을 때 그 플래그가 true로 굳어 **버튼이
    영구히 죽는다**.
  - **⚠️ blur는 칩을 자동 활성화하지 않는다** — 어떤 칩을 그릴지는 사용자가 고른다. 확보만 해 두고
    클릭 시 즉시 그려지게 한다.
  - **⚠️ `stockFetchStatus`는 포트폴리오 테이블과 공유하는 맵**이라 **보유 종목이면 쓰지 않는다**
    (비교 이력 조회 실패가 그 종목 행에 '갱신 실패' 빨간 점을 찍으면 안 된다). 상태점은 **종가 확보
    여부만** 반영한다 — 이름만 못 구한 경우까지 빨간 점을 찍으면 선이 정상인 종목이 실패로 보인다.
  - **⚠️ `compBlurEnsuredRef`(세션 재조회 억제)와 `compNameCacheRef`(코드→이름)는 한 쌍**이다. 캐시가
    없으면 "A 입력 → B 입력 → 다시 A"에서 A가 이미 ensured라 조기 반환하고 **칩에 B의 이름이 남는다**.
    실패한 이름은 캐시에 넣지 않는다(다음 blur가 재시도해야 한다).
  - `await` 뒤 칩 갱신은 전부 `patchComp(index, expectedCode, patch)` — 인덱스만 믿으면 그 사이 칩을
    추가·삭제·재입력했을 때 **엉뚱한 칩에 결과가 꽂힌다**.
- **백테스트(`backtestFetch` + `App.handleBacktestFetch`)** — `fetchBacktestName`·`fetchBacktestDividends`
  신설. 시장 판정은 관심종목과 같은 `detectMarket`(kr/us/fund).
  - **⚠️ 세 갈래(종가·이름·분배금)를 각각 필요 여부로 판정**한다. 옛 코드는 '종가가 이미 있으면'
    통째로 조기 반환해, **저장된 종가만 있고 이름·분배금이 없는 코드는 영영 안 채워졌다**.
    무배당 종목은 성공해도 결과가 비어 '아직 없음'과 구분되지 않으므로 `btMetaTriedRef`로 **시도 자체를
    기억**한다(⟳ 강제 조회는 무시).
  - **⚠️ 병합 방향이 이름과 분배금이 반대다(둘 다 의도)**: 분배금은 **조회분 우선**(ym 단위 —
    `btPrices` 규약과 동일, ⟳로 새로 받은 값이 낡은 계좌 저장값에 가리면 안 된다), 이름은 **계좌분
    우선**(사용자가 테이블에서 손으로 고친 종목명을 API가 덮으면 안 된다).
  - **⚠️ `buildBtCatalog`에 `stockHistoryMap`만 넘기지 말 것** — 카탈로그 코드 집합이 `종가 맵 ∪ 분배금
    맵`이라, 백테스트에서 처음 입력한 코드가 **카탈로그에 아예 없어** 조회해 둔 이름이 화면에 닿지
    못한다. `btCatalogPrices`(저장분 ∪ 조회분 + 이름만 확보된 코드의 빈 자리)를 넘긴다.
  - **⚠️ 자산 이름은 `BacktestPage`의 백필 effect가 채운다** — `addAsset`은 추가 시점 카탈로그를
    스냅샷하므로 비동기 조회가 끝나면 이름이 코드인 채 굳는다. 이름은 사용자가 직접 고치는 필드라
    **아직 코드 그대로인 행만** 건드리고, 바뀐 게 없으면 `setLocal`이 같은 참조를 받아 dirty를 세우지
    않는다(저장 폭주 방지).
  - **⚠️ 별도 창 지문(`btWinDataKey`)에 `btMetaSeq` 필수** — 이름/분배금은 **코드 수가 그대로여도 내용만**
    바뀔 수 있어 개수 기반 지문만으로는 새 창이 갱신을 놓친다.
- **⚠️ 조회 결과를 되돌려 쓰지 말 것(두 경로 공통)**: 백테스트 종가는 `btFetched`, 이름은
  `btFetchedNames`, 분배금은 `btFetchedDivs` — **`stockHistoryMap`·계좌 `dividendHistory` 병합 금지**.
  전자는 보유 평가액 재계산의 권위 소스가 오염되고, 후자는 보유하지도 않은 종목이 분배금 현황 표에
  **유령 행**으로 새어 나온다. 셋 다 파생값이라 Drive 저장 지점도 **0곳**이다(다음 세션에 재조회).
- **`parseDividendApiResult`는 `utils.ts`로 승격**해 분배금 현황 표와 백테스트가 **같은 함수**를 쓴다 —
  각자 파서를 두면 같은 종목이 화면마다 다른 주당분배금으로 뜬다.
- **범위 밖(의도)**: 비교종목은 펀드(MA:/URL) 미지원(이름·이력 라우팅이 kr/us 2분기), 백테스트 분배금도
  펀드는 API가 없어 사용자가 `divOverride`로 직접 입력한다.

### 가계부(ledgerBooks) — 항목 × 월 매트릭스 + 대출 상환 계산 (⚠️ 회귀 주의)

상단바 **가계부 아이콘**(`UserInfoBar` — 백테스트 **바로 오른쪽**, 인라인 SVG `LedgerIcon`)으로 여는
별도 브라우저 창(`/?ledgerWindow=1`). 지출/수입을 **항목 × 월 매트릭스**로 기록하고(계획 열 + 1~12월
실제 열), 대출은 상환방법에 따라 월 납입액을 계산하며, 전월·전년 대비 증감과 구분별 도넛을 낸다.

- **모듈 4개**: `src/ledger.ts`(타입+순수 로직, ⚠️ `@ts-nocheck` 금지) · `LedgerPage.tsx`(overlay/page 겸용) ·
  `LedgerWindow.tsx`(창 셸) · `scripts/verify-ledger.mjs`.
  ⚠️ `ledger.ts`의 상대 import에는 **`.ts` 확장자 필수**(검증이 미러 없이 직접 import한다 — 떼면 파트①이
  통째로 죽는데 빌드는 통과해 무음이다). `enum`/`namespace` 금지(Node 타입 스트리핑 미지원).

#### 계산 규약 — 첨부 스프레드시트에서 역산해 실측 확정 (verify:ledger §2·§6이 고정)
| 항목 | 값 | 판정 |
|---|---|---|
| 신용대출 95,000,000 @4.47% | 월 353,875 | `P×r/12` **정확 일치** → 만기일시(이자만) |
| APT1/2, 만기 2063-04 | 544,059 / 333,220 | 원리금균등(n≈440) |
| 전세 159,550,000 @2.73% | 423,289 | **어떤 방식으로도 불일치** → 사용자 입력이 권위 |
| 예상 年 지출 | **62,743,196** | 월합×12 + 년단위 |
| DSR (사진 H9) | 27.6% | 연 상환액 / 연 수입 |

- **⚠️ 중간 반올림 금지.** MS365(연 127,000)를 항목별로 반올림(10,583)하면 예상 年 지출이
  62,743,**192**가 되어 사진의 …**196**과 4원 어긋난다. 무반올림 10,583.333…으로 누산해야 일치한다.
  **계산은 무반올림, 표시만 반올림**(`roundWon`).
- **⚠️ `loanSchedule`의 유한성 게이트가 이 기능의 절반이다.** 순진한 PMT는 `annualRate=0`에서 **NaN**,
  `n=0`에서 **Infinity**, `n<0`에서 **음수**(실측 P=1억·4%·n=−3 → −33,222,469)를 낸다. 셋 다
  `typeof === 'number'`라 타입으로 안 걸리고 Σ를 지나 월 지출 합계·예상 年 지출·DSR·저축여력을 전부
  오염시킨다. **`payment > 0`은 Infinity를 통과시킨다 — `Number.isFinite`만이 막는다.**
  집계(`monthTotals`·`ledgerKpi`)도 `Number.isFinite`로 걸러 한 값이 합계를 삼키지 않게 한다.
- **⚠️ `LedgerLoan.principalAsOfYm`(잔액의 기준월)이 없으면 계산을 포기한다.** '만기 − 오늘'로 잔여
  개월을 재면 잔액은 그대로인데 n만 줄어 **사용자 조작 없이 월 납입액이 매달 상승**한다(실측 APT1
  1년에 +8,757원, +1.3%). 원리금균등은 정의상 고정인데도 그렇게 된다. 잔액과 기간의 기준 시점을 묶어
  두면 납입액이 **1회 계산되고 만기까지 고정**된다(검증 #12·#12b).
- **⚠️ 원금균등은 회차마다 납입액이 다르다.** '첫 회차를 대표값'으로 쓰지 말 것 — 연 상환액을 구조적으로
  과대 계상한다. 연 합계는 `loanAnnualTotal`이 12회차를 각각 더한다(#25).
- **⚠️ `paymentOverride`(사용자 직접 입력)가 계산을 덮어쓴다.** 전세 케이스가 그 근거다 — 실제 대출에는
  중도상환·금리변동·부분거치 등 모델에 없는 조건이 흔하다. **계산은 제안, 입력이 권위.**

#### 축·합계 규약
- **`group` 단일 축**(`loan|fixed|variable|annual|income`). ⚠️ `kind:'expense'|'income'` 이중 축을
  되살리지 말 것 — 수입이 지출 합계에 섞이는 경로가 열린다(#44).
- **`planUnit`은 `group`과 직교한다**(같은 것을 두 번 말하는 게 아니다): `planUnit:'year'` = "연 단위로
  청구되지만 **매달** 부담"(연 구독 → /12) / `group:'annual'` = "1년에 **한 번** 나가는 목돈"(납부월에만 계상).
- **⚠️ 월 지출 합계 = 대출 + 고정비 + 변동비(annual 제외).** 예상 年 지출이 `×12 + 년단위`라, annual을
  월 합계에 더하면 **12배 이중 계상**된다(#42).
- **⚠️ 미입력(키 없음)과 0원(명시적 0)은 다른 뜻이다.** 실제 합계는 **입력된 것만** 더하고 `missingCount`를
  함께 낸다 — 0으로 취급하면 "지출이 줄었다"고, 계획으로 대체하면 "차이 0"이라고 거짓말한다.
  ⚠️ 커밋은 반드시 `commitActual`(빈칸=키 삭제) — **`cleanNum`은 빈칸을 0으로 만들어 이 구분을 즉시 파괴**한다.
- **⚠️ 전월·전년 비교는 입력 완료도가 다르면 숫자를 내지 않는다**(`delta`/`rate` = null). 진행 중인 달은
  항상 미입력이 많다 — 그게 기본 상태다. 지난달 12건 입력 / 이번 달 1건이면 순진한 차분이 **−87.2%**를
  내고 사용자는 '지출이 87% 줄었다'로 읽는다(일간 지표 절의 `'-'` 규약과 같은 근거, #50).
- **⚠️ `LedgerBook`에 `year` 필드를 두지 말 것** — 장부를 한 해에 묶으면 **전년 대비가 구조적으로 불가능**해진다
  (다른 장부를 봐야 하므로). 장부는 연도 무관이고 화면이 연도를 고른다(#52).
- **⚠️ 항목 유효기간(`activeFrom`/`activeTo`) 필수** — 없으면 연중에 추가한 항목이 **존재하지도 않던 달에
  영구히 '미입력'으로 계상**되고 경고가 절대 꺼지지 않는다(#33).
- **⚠️ `byPay`(현금/카드 소계)는 지출 전용** — 수입을 섞으면 '현금합계'에 급여가 들어간다(#48c).

#### 색 규약 (⚠️ 손익 색을 쓰지 말 것)
이 앱의 손익 색(**이익=빨강** / 손실=파랑, 한국 증시 관행)을 가계부에 쓰면 **정반대로 읽힌다** — 지출은
증가가 나쁜 것이다. 상태색(초과 `#fbbf24` ▲ / 절약 `#2dd4bf` ▼ / 중립 `#94a3b8`)을 쓰고 **아이콘과 라벨을
항상 동반**한다. 도넛 4슬롯(`대출 #60a5fa` / `고정비 #f472b6` / `변동비 #4ade80` / `연단위 #fb923c`)은
CVD ΔE 7.1 대역이라 **직접 라벨 + 2px 간격이 필수**(색만으로 구분이 보장되지 않는다).
⚠️ 값은 `scripts/validate_palette.js`로 실측 검증했다 — 색을 바꾸려면 **반드시 그 스크립트를 다시 돌릴 것**
(눈으로 판단 금지). 팔레트는 `ledger.ts` 모듈 상수로 공유한다(손복제 금지).

#### 메모 달력 BUDGET 칩
소스 2종을 **라이브 파생**한다(⚠️ `calendarMemos`에 복사 금지 — note·qty·transfer와 같은 계약):
(a) `book.months[ym].touchedDate` = 그 날 가계부를 정리한 기록 → 칸에 **총지출 + 전월대비** 요약
(b) `annual` 항목의 `dueMonth/dueDay` = 연단위 지출 예정일 → **항목명 + 금액**.
패드는 읽기 전용이고 하단 **[가계부 열기]** 버튼이 '확장'이다.
- ⚠️ `ledgerByDate`에 **`open` 게이트 필수** — CalendarModal은 App 최상위 형제라 달력을 닫아도 계속
  마운트돼 있어, 게이트가 없으면 닫은 뒤에도 전 장부 시계열을 영구히 재계산한다.
- ⚠️ **PICK 체인에 자기 분기 필수** — 마지막 `else`가 qty라, 없으면 오류 없이 '종목 수량 변경' 패드가 열린다.
- ⚠️ **연단위 지출은 매년 반복되고 정리 기록은 그 해에만 뜬다**(수명이 다르다 — #56·#56b).
- ⚠️ **별도 달력 창의 [가계부 열기]는 App에 위임**한다(`calendar:openLedger`). 그 창에서 `window.open`을
  직접 부르면 새 창의 opener가 **달력 창**이 되어 가계부 창이 앱 탭과 영원히 연결되지 못하고 읽기 전용으로
  굳는다. 장부는 `calendar:accounts`(지문 게이팅)가 아니라 **`calendar:live`에 싣는다** — accounts는
  `portfolios` 지문으로만 게이팅돼 장부만 바뀐 편집이 새 창에 반영되지 않는다.

#### 적대적 리뷰가 잡은 회귀 13건 (2026-08 — ⚠️ 되돌리면 그대로 재발)

3렌즈 리뷰가 독립적으로 지목한 것을 전부 node로 재현해 고쳤다. 각 항목의 가드가 괄호 안에 있고,
**변이 13종으로 검출을 실증**했다(존재만 단언하는 죽은 가드가 아님을 확인).

- **⚠️ 만기월도 납입 회차다**(`#G26`·`#9`·`#9c~#9e`). `loanTermMonths`의 endDate 경로가
  `monthsBetweenYm`만 쓰면 **만기월이 `kRaw >= n`에 걸려 '계산 불가'**가 되고, 같은 대출을
  `termMonths`로 넣었을 때와 회차 수가 1 달라진다(실측: 6개월 대출에서 월 납입액 **19.7% 차이**).
  `span + 1`이 두 경로의 회차 정의를 통일한다.
  ⚠️ **사진을 정확히 재현할 수 없는 것이 정상이다** — 두 대출이 요구하는 회차가 442.6과 437.1로
  달라 같은 만기일로는 어느 쪽도 맞출 수 없다(납입액은 최초 약정액, 대출금은 현재 잔액이라서).
  허용오차를 '정확 일치'로 조이지 말 것. 정확한 값은 `paymentOverride`가 낸다.
- **⚠️ 연 납입액 = `loanNext12Total`(향후 12개월 스케줄 합)**(`#G25`·`#G25b`·`#67`).
  `월 × 12`는 원금균등에서 과대이고, 같은 화면의 각주('첫 달 × 12가 아닙니다')를 **반증**한다.
  ⚠️ **달력 연도(1~12월)로 재지 말 것** — 기준월이 연중이면 앞쪽 달들이 '아직 시작 전'이라
  null이 되어 합계가 통째로 모자란다(사진의 신용대출은 기준월이 8월이라 5개월치만 잡힌다).
  행별 표시와 KPI가 **같은 함수**를 써야 한 화면에서 두 값이 나오지 않는다.
- **⚠️ `expectsActual`이 '실적 입력 대상'의 단일 소스**(`#G24`·`#G24b`·`#64`~`#65c`).
  `group:'annual'`은 **납부월에만** 대상이다. `isItemActive`로 재면 연단위 항목 하나가 비납부월
  11개월 내내 '미입력'으로 세어져 ① KPI 배너가 손댈 방법 없이 상시 점등 ② 그 항목의 **연간 차이
  열이 영구히 `'-'`** ③ 납부월과 그 다음 달의 전월 대비가 **매년 2개월씩 비교 불가**가 된다
  (정확히 `activeFrom`이 막으려던 실패 모드). 화면 3곳이 같은 함수를 공유해야 값이 갈리지 않는다.
- **⚠️ 비교는 개수가 아니라 미입력 항목 `missingIds` 집합**(`#G27`·`#66`~`#66f`).
  '1월은 월세만, 2월은 커피만 입력'(달마다 다른 항목부터 채우는 흔한 습관)이 둘 다 `missing=1`로
  통과해 **−93.6%** 같은 거짓 신호가 확정 표시된다 — 이 함수가 존재하는 이유가 바로 그 신호를
  막는 것이다.
- **⚠️ `ledgerKpi`의 annual 분기는 '보고 있는 달' 활성 게이트보다 **앞**에 둔다**(`#68`).
  `addItem`이 `activeFrom`을 추가 시점 달로 박으므로, 그보다 앞선 달을 보고 있으면 연 목돈이
  예상 年 지출에서 **통째로 사라진다**. 연 단위 값은 **납부월 기준**으로 활성을 판정한다.
- **⚠️ 인앱 폴백(overlay)에는 `z-[1090]`이 필수**(`#G20`). App 루트는 스태킹 컨텍스트를 만들지
  않아, z 없이 두면 상단바(`sticky top-0 z-30`)와 플로팅 창(계산기·관심종목·메모 달력 z-1050)이
  위에 그려져 **최상단 줄(닫기 버튼 포함)이 가려지고 닫을 수조차 없다**. `variant==='page'`에는
  주지 않는다(BacktestPage와 같은 층: ConfirmDialog 1000 위, LoadingOverlay 1100 아래).
- **⚠️ `today`는 브릿지로 늦게 도착한다 → 동기화 effect + ref 게이트**(`#G21`·`#G21b`).
  `useState` 초기화는 첫 렌더에서 한 번만 평가되고 이 컴포넌트는 리마운트되지 않아, 상수 초기값을
  두면 **별도 창(주 진입점)이 항상 그 상수 달로 열린다**. 그 상태에서 '+ 추가'는 엉뚱한 달을
  `activeFrom`에 박고 셀 입력은 그 달을 '정리했다'고 기록한다. 하드코딩 연도 금지.
- **⚠️ 장부 자동 생성은 `setLocal`(dirty)을 쓰지 않는다**(`#G22`) + **채택 effect는 빈 배열을
  채택하지 않는다**(`#G22b`). 둘 중 하나만 빠져도 앱 탭 새로고침 중에 뒤늦게 도착한 **저장된
  장부가 영영 채택되지 않고** 2.5초 뒤 승격이 그것을 **빈 장부 1권으로 덮어쓴다**(FlowBoard가
  명시적으로 막아 둔 경로 — 백업 복원으로도 되돌릴 수 없는 sticky 데이터다).
- **⚠️ `touchMonth`는 값이 실제로 바뀐 경우에만**(`#G23`). `NumCell`의 `onBlur`는 값이 그대로여도
  항상 커밋을 부르므로, 무조건 호출하면 칸을 **Tab으로 지나가기만 해도** 그 달을 '정리했다'고
  기록하고 메모 달력에 **사용자가 만든 적 없는 BUDGET 칩**이 뜨며 Drive 4파일 write가 나간다.
- **⚠️ impersonation 읽기 전용의 정본은 App의 `ledger:books` 핸들러**(`#G28`·`#G28b`·`#G28c`).
  인앱 폴백의 `readOnly` prop만으로는 **기본 경로인 별도 창의 쓰기를 못 막는다** — 창은 조작
  가능한 URL로 열리므로 App 측 재확인이 정본이고(fail-closed), `ledger:live`의 `readOnly`는
  창 UI를 함께 잠그는 보조 신호다.
- **⚠️ `ledgerAccess` 선언은 한 곳뿐이고 브릿지 effect보다 **위**에 있어야 한다**(`#G29`·`#G29b`).
  아래쪽 `isAdminUser`는 `authUser` null 가드(early return) 뒤라 브릿지에서 참조할 수 없어,
  관리자 판정을 옵셔널 체이닝으로 직접 한다. 인앱 prop과 `calendar:live` payload가 **같은 표현**을
  써야 게이팅이 갈리지 않는다(안 그러면 권한이 꺼진 사용자의 **별도 달력 창에만** BUDGET 칩이 남는다).
- **⚠️ `isValidLedgerDate`는 패턴이 아니라 실제 달력을 본다**(`#69`~`#70b`). 패턴만 보면
  `2026-04-31`이 통과하는데 CalendarModal이 `utils.isValidIsoDate`로 다시 걸러 **칩이 아무 안내
  없이 사라진다**. 말일 의도(`dueDay: 31`)는 버리지 말고 그 달 말일로 **클램프**한다.
#### 별도 창 브릿지 (`?ledgerWindow=1`)
흐름도·백테스트와 **같은 규약**(App 미마운트 · `noopener` **금지** · `ping.need`가 초기 전송의 유일한 트리거 ·
재입양 · 끊기면 `readOnly` · 자체 `ErrorBoundary label` · `pagehide` 승격 · 팝업 차단 시 인앱 폴백).
- **⚠️ 채널이 하나뿐이다**(`ledger:live`). 가계부는 포트폴리오 데이터가 전혀 필요 없는 자체 완결 기능이라
  무거운 원자재 채널이 없다 — 두 채널로 쪼개면 각각 `gotData`를 세우게 되어 장부가 도착하기 전에 쓰기가
  열리고 **저장된 장부 전체가 빈 배열로 덮이는** 경로가 생긴다(CalendarWindow가 실제로 겪은 함정).
- **⚠️ `today`는 앱이 만들어 보낸다** — 창에서 `new Date()`로 만들면 KST 규약이 갈린다.
- **⚠️ 늦게 도착한 상위 값 채택 effect 필수**(dirty면 채택 안 함). 없으면 `LoadingOverlay`가 20초에
  자동 해제되는 느린 회선에서 빈 배열로 시드된 뒤 항목 하나만 고쳐도 2.5초 후 승격이 **저장된 장부를
  통째로 대체**한다(FlowBoard가 명시적으로 막아 둔 경로).

#### 이전 기록(스냅샷) — 사용자 저장 + 복원 (2026-08-29, ⚠️ 회귀 주의)

가계부 헤더의 **💾 저장** / **이전 기록** 버튼. 앱 레벨 `ledgerSnapshots: LedgerSnapshot[]`
(`{id, savedAt, label, auto, books}`).

- **⚠️ 스냅샷은 `ledgerBooks` 안이 아니라 그 옆에 산다.** 장부 안에 두면 장부가 통째로 덮이는
  사고에서 **안전망까지 같이 죽는다** — 그 사고가 정확히 이 기능이 막으려는 것이다.
  `#102`가 `makeLedgerBook()`에 `snapshots` 키가 없음을 단언한다.
- **⚠️ 자동 백업(`portfolio_backup_*.json`)과 별개다.** 그쪽은 `saveAllToDrive(state, versioned)`의
  `versioned`가 있을 때만(수동 저장·앱 닫기) 만들어지고, **800ms 디바운스 자동 저장은 백업 없이
  STATE를 덮어쓴다** — 그래서 하루 종일 편집해도 복구 지점이 하나도 안 생길 수 있다
  (2026-08-29 실측: 가계부 배포 16:26 → 유실 19:22, 그날 백업 0본).
- **⚠️ 저장은 먼저 `promote()`로 로컬 편집을 회수한다** — 안 하면 방금 친 값이 2.5초 idle 승격
  전이라 `books` prop에 없고, 사용자가 "저장"을 눌렀는데 **직전 상태가 저장**된다.
- **⚠️ 복원 직전에 현재 상태를 자동 스냅샷(`auto:true`)으로 남긴다** — 복원은 파괴적이고 undo가
  없다. 이게 없으면 잘못 고른 복원 한 번으로 지금 작업분이 사라진다.
- **⚠️ 상한 초과 시 `auto`를 먼저 버린다** — 사용자가 직접 누른 저장이 자동 스냅샷 때문에
  밀려나면 안 된다. **방금 넣은 것은 어떤 경우에도 버리지 않는다**(저장이 조용히 실패하면 안 된다).
- **⚠️ 개수(10)와 바이트(512KB) 상한을 둘 다 건다** — STATE는 백업 22본으로 복제되고 저장마다
  파일 전체가 업로드되므로 개수만으로는 큰 장부에서 STATE가 배로 불어난다.
- **⚠️ 직전과 내용이 같으면 추가하지 않고 원본 참조를 반환한다**(저장 연타로 같은 내용이 상한을
  채우면 정작 필요한 과거 시점이 밀려난다 + 헛된 Drive 저장 트리거 방지).
- **영속화 7지점**(`ledgerBooks`와 동일 패턴) + **sticky**(`ledgerSnapshotsHaveContent`) —
  백업 복원이 '이전 기록'을 되돌리면 그 백업 시점 이후의 복구 지점이 통째로 사라진다
  (복구 수단이 복구로 지워지는 역설). 계좌 0개 예외에도 포함.
- **별도 창 브릿지**: 앱→창 `ledger:live`에 `snapshots` 동봉 / 창→앱 **`ledger:snapshots`**.
  ⚠️ 앱 핸들러의 impersonation 게이트를 `ledger:books`와 **똑같이** 둘 것(한쪽만 막으면
  impersonation 창이 스냅샷 이력을 고칠 수 있다). 창의 수신 화이트리스트는 **열거형**이라
  새 타입을 추가하면 양쪽에 등록해야 한다(CalendarWindow 선례).
- 확인창은 **인라인 2단계**(z-1090 + 별도 창엔 App조차 없어 `ConfirmDialog`·토스트가 안 뜬다).

#### ⚠️ 별도 창도 Drive 로드 완료 전까지 읽기 전용 (2026-08-30 — 아래 잠금의 누락된 절반)

바로 아래 인앱 잠금(2026-08-29)이 **버튼이 실제로 여는 별도 창에는 적용되지 않아** 유실 경로가
그대로 열려 있었다. 사용자 보고: "가계부를 열면 빈 가계부가 뜨고, 이전 기록을 불러와야 내용이 보인다."

- **메커니즘**: 창의 `writable = linked && gotData && !appReadOnly`에서 `gotData`는 **첫
  `ledger:live`가 오면** 선다 — 그 메시지가 Drive 로드 전이라 `books: []`를 실어 와도 마찬가지다.
  그러면 창은 **'아직 안 불러왔다'와 '저장된 게 없다'를 구분하지 못한 채 편집 가능한 빈 장부**를
  띄우고, 거기서 한 글자만 쳐도 dirty → 2.5초 승격 → App `setLedgerBooks` → Drive 저장으로
  **저장된 장부를 덮는다**(그때부터 채택 effect도 dirty라 막혀 자가치유가 안 된다).
- **⚠️ 스냅샷이 살아남는 것이 이 버그의 지문이다** — `ledgerSnapshots`는 💾 버튼으로만 쓰이므로
  빈 장부 승격이 건드리지 않는다. "장부는 비었는데 이전 기록은 있다"가 보이면 이 경로를 의심할 것.
- **수정**: `ledger:live`에 **`dataState: ledgerDataState`**를 함께 싣고
  (⚠️ effect deps에 `ledgerDataState` **필수** — 없으면 로드가 끝나도 창이 잠긴 채 남아
  고치려던 것보다 나쁘다), 창은 `writable`에 `appDataState === 'ready'`를 추가한다.
- **⚠️ fail-closed** — 창의 `appDataState` 초기값은 `'loading'`이고, 수신값은
  `'ready'|'error'` 화이트리스트 밖이면 전부 `'loading'`으로 떨어뜨린다. 열어 두면 이 필드의
  존재 이유가 사라진다. 최악이 '창이 읽기 전용으로 남음'(새로고침으로 복구)이고 반대편은
  **되돌릴 수 없는 장부 유실**이라, 비대칭이 이 방향을 강제한다.
- **⚠️ 안내 문구를 상태별로 갈라 쓸 것**(`error`를 `loading`보다 **먼저** 판정 — 실패를
  '불러오는 중'으로 감추지 않는다). 빈 화면만 보여 주면 사용자가 유실로 오해하고 새로 입력하는데,
  그 입력이 정확히 기존 장부를 덮는 경로다. 그래서 "아직 저장된 내용이 안 보여도 지우지 마세요"를 명시한다.
- **`ledgerDataState`가 `'ready'`가 되는 지점은 STATE 확정 직후 한 곳**(`App.tsx`, `loadFromDrive`
  뒤) — 인앱·창이 **같은 값**을 쓰므로 두 경로의 보호가 갈리지 않는다(가드 #G38d).
- **영속화 지점 0곳** — `dataState`는 브릿지 payload의 파생 신호다.
- 검증: `#G28c`(계약을 의도적으로 좁혀 정규식 갱신) + `#G38~#G38e`. **변이 7종으로 검출 확인**
  (옛 잠금 복귀 · `dataState` 미전송 · deps 누락 · fail-open 복귀 · 초기값 `ready` ·
  인앱 잠금 제거 · error를 loading으로 감춤).

#### ⚠️ 시드 effect가 방금 채택한 장부를 덮던 표시 버그 (2026-08-30 — 위 두 잠금이 못 잡던 절반)

사용자 보고: "앱을 실행하고 가계부를 클릭하면 이전 내용이 바로 보이지 않고 **이전 기록(스냅샷)을
불러와야** 한다." 매 실행마다 재현됐다.

- **원인 = 시드 effect가 렌더 스코프 `local`(그 렌더의 클로저)로 장부 유무를 판정한 것.**
  별도 창(**기본 진입점**)의 첫 `ledger:live`는 `books`(실장부)와 `dataState:'ready'`를
  **한 핸들러에서** 세팅하므로 React 18이 **한 커밋으로 배치**한다 → 그 렌더에서 `books`는
  실장부인데 `local`은 아직 `[]`다. effect는 **선언 순서**로 도니까 채택 effect(`:308`)가
  `localRef.current`에 실장부를 넣은 **직후** 시드 effect(`:672`)가 stale한 `local.length === 0`을
  보고 **빈 장부 1권으로 덮어썼다**. 그 다음 커밋부터는 `books` identity가 그대로라 채택 effect의
  deps `[books]`가 안 바뀌어 **실장부가 영영 화면에 닿지 못한다**.
- **⚠️ 인앱 폴백은 무사했다** — App은 `setLedgerBooks`(applyStateData 안)와
  `setLedgerDataState('ready')`(그 `await` **뒤**)가 다른 tick이라 **다른 커밋**이 된다. books가
  먼저 커밋되며 `readOnly`는 아직 true라 시드가 건너뛰어지고, ready 커밋 때는 `local`이 이미
  채워져 있다. 그래서 2026-08-29/08-30 잠금 두 건이 증상을 못 잡았다.
- **⚠️ Drive 데이터는 오염되지 않았다** — 시드는 `setLocal`이 아니라 `localRef.current` 직접
  대입이라 **dirty를 세우지 않는다** → 승격도 저장도 없다. **표시만** 깨졌었고, 그래서 스냅샷
  복원이 매번 통했다(그리고 매번 다시 필요했다).
- **수정**: 판정을 `localRef.current`로 바꾼다(`#G22c`). 덤으로 **자가 치유** — 로컬이 비었는데
  상위 `books`에 내용이 있고 dirty가 아니면 **빈 시드 대신 그것을 채택**한다(`#G22d`), deps에
  `books` 추가(`#G22e`). ⚠️ `dirtyRef` 가드를 빼지 말 것 — 사용자가 장부를 전부 지운 편집 중이면
  되살리면 안 된다.
- ⚠️ **`#G22` 가드는 `LP_RAW`를 자른 뒤 `stripComments`를 거친다** — 구간 경계가 주석이라
  `LP`(주석 제거본)로는 못 자르고, 원문 그대로 두면 부재 단언이 **설계 근거 주석**(금지 토큰
  `setLocal`·`local.length === 0`을 그대로 인용한다)에 걸린다.
- 검증: 변이 6종(음성 대조 1 포함)으로 검출 확인 — 판정을 `local`로 되돌림 · 자가 치유 삭제 ·
  dirty 가드 제거 · deps에서 `books` 제거 · 시드가 `setLocal` 사용 · 주석 인용 오탐.

#### ⚠️ 인앱 가계부는 Drive 로드 완료 전까지 읽기 전용 (2026-08-29 실측 유실)

`App.tsx` `ledgerDataState: 'loading' | 'ready' | 'error'` → `readOnly={!!adminViewingAs ||
ledgerDataState !== 'ready'}`.

- `086b582`가 '빈 장부 시드가 dirty를 세우던' 경로를 막았지만 **구멍이 남았다**: 로드 전에
  화면을 열고 **사용자가 한 글자라도 치면** dirty가 정당하게 서고, 뒤늦게 도착한 진짜 장부가
  `if (dirtyRef.current) return;`에 막혀 채택되지 않은 채 2.5초 뒤 그 한 줄짜리 장부가 Drive를
  덮는다. **실측: 항목 40여 건이 빈 항목 3건으로 대체**됐고 그날 백업이 없어 복구 불가였다.
- 별도 창은 `readOnly={!writable}`로 이미 막혀 있었고 **인앱 경로에만 이 가드가 없었다.**
- **⚠️ 로드 실패를 `'ready'`로 취급하지 말 것** — Drive엔 기록이 있는데 못 읽은 상태라, 거기서
  편집을 허용하면 다음 저장이 그 기록을 덮는다. 실패는 읽기 전용으로 잠그고 사유를 표시한다.
- **⚠️ 초기값은 `'loading'`**(기본이 잠김). `'ready'`로 두면 게이트가 무의미해진다.
- 잠금 해제 지점은 **STATE가 확정되는 바로 그 줄**(뒤의 부수 로드를 기다리지 않는다).

#### 영속화 7지점 + 게이팅
① `useState` ② `portfolioStructureKey`에 `ledgerFingerprint(ledgerBooks)` ③ 저장 payload 리터럴
④ 저장 effect deps ⑤ `applyStateData`(sticky 아님) ⑥ `applyBackupData`(sticky, **공유 함수**)
⑦ `useDriveSync._preserveStickyPersonalData` + `ledgerFlushRef`/`ledgerExitCommitRef`/`exitCommitRef` **4원 합성**/
수동 저장 4핸들러 동기 주입.
- **⚠️ 저장 effect의 `portfolios.length === 0` 조기 반환에 예외를 둔다** — 가계부는 포트폴리오와 개념적
  의존이 **0**이라 '계좌를 아직 만들지 않은 사용자'가 정상 경로다. 예외가 없으면 그 사용자의 장부는 어떤
  경로로도 저장되지 않아 새로고침마다 사라진다(`portfolios.length === 0 && !ledgerBooksHaveContent(...)`).
- **⚠️ sticky 판정은 `length` 금지, `ledgerBooksHaveContent` 공유 함수** — 화면을 **열기만 해도** 빈 장부가
  1권 생기므로 length 기준이면 백업으로 되살릴 길이 영구히 막힌다.
- **⚠️ `ledgerFingerprint`는 절대 throw하지 않는다**(화이트리스트 투영 + try/catch). 이 계산은 저장 effect의
  첫 블록이라 던지면 그 세션의 Drive 저장이 통째로 멈춘다. 길이·개수 해시 절충 금지, `updatedAt` 제외.
- **게이팅 = approved_users M열(index 12) `ledgerEnabled`** — Apps Script 6곳
  (`handleCheckApproval`·`handleListUsers`·`handleGetFeatureLabels` **3군데**(fallbacks·`E1:M1`·catch fallbacks)·
  `colMap`·`handleAddUser` 13셀·`setupSheet` **3군데**) + 프론트 8곳(`LoginGate` 3 · `App` 초기 리터럴·
  `ledgerAccess`·prop·마운트 · `AdminPage` 타입·`featureLabels[8]`·`featureDefs` · `UserInfoBar` 아이콘·prop·렌더).
  **배포 순서: 프론트 먼저 → Apps Script 나중**(`>= 6` 인덱스 머지가 구버전 응답을 우아하게 처리).
  ⚠️ `effectiveUserFeatures`에 얹지 말 것 — 관리자 본인이 영구 접근 불가가 된다.
- impersonation은 **읽기 전용**(`readOnly={!!adminViewingAs}`) — 흐름도·백테스트와 같은 근거(undo 없음 + sticky).

#### 계획 자동 반영 — "계획은 손대지 않아도 1월부터 보인다" (2026-08, ⚠️ 회귀 주의)

사용자 요구: "계획은 일일이 숫자를 안 넣어도 1월부터 반영되고, 실제가 다른 달만 직접 고친다
(지출은 한번 정해지면 거의 일정하기 때문)". 사용자 확정 규약 = **예상치로 반영 + 흐린 이탤릭 구분**
(계획으로 채운 달을 '확인했다'로 승격하지 **않는다**).

- **⚠️ 원인은 계산이 아니라 `addItem`의 생성 기본값이었다.** 옛 코드는 `activeFrom: ym`(보고 있는 달)을
  박았고 **그 필드를 고칠 UI가 0곳**이었다 → 8월에 가계부를 만들면 전 항목이 `2026-08`로 고정돼
  1~7월이 `-`가 되고 `planOf`가 null을 돌려준다. 사용자가 되돌릴 방법이 아예 없었다.
  → 기본값 **`activeFrom: ''`(제한 없음)**. ⚠️ `isItemActive`/`expectsActual`의 **의미는 무변**이다
  (연중 시작·종료 항목은 종전대로 잠긴다 — 검증 #104e).
- **⚠️ 잠긴 칸(`-`)은 클릭으로 적용기간을 넓히는 버튼이다** — 시작월이면 `activeFrom`을, 종료월이면
  `activeTo`를 그 달로 옮긴다. 이게 없으면 `activeFrom` 편집 수단이 다시 0곳이 된다(가드 #G37f).
- **⚠️ 월 칸의 계획은 `placeholder` + `placeholder:text-gray-500 placeholder:italic`** — 기본
  placeholder 색이면 '아직 없는 값'으로 읽혀 사용자가 "계획이 반영 안 됐다"고 느낀다(그게 원 보고다).
  실제 입력은 밝은 글씨, 계획은 흐린 이탤릭. `NumCell`이 `className` prop을 받는 이유(가드 #G37e).
- **⚠️ 항목 행의 연간 합계는 `Σ expectedOf`(실제 ?? 계획)** — 소계 행과 **같은 규약**이라야
  `소계 = Σ항목`이 성립한다. 계획으로 채운 달이 섞이면 같은 시각 언어(흐린 이탤릭) + `계획 N개월`.
  ⚠️ **가드는 반드시 `renderItemRow` 구간으로 좁혀 단언할 것** — 소계 행도 같은
  `{fmtWon(yearExpected, hideAmounts)}` 문자열을 갖고 있어, 파일 전역으로 재면 **항목 행을
  `yearActual`로 되돌려도 소계 행이 대신 통과시켜 죽은 단언**이 된다(변이 N2로 실증). 그리고 그게
  정확히 '소계 = Σ항목'이 깨지는 형태다. 같은 구간의 title 템플릿 때문에 `(?<!\$)` 룩비하인드도 필수.
- **⚠️ 연간 '차이' 열의 게이트는 그대로 `yearMissing === 0`** — expected로 바꾸면 언제나 0이 되어
  "차이 없음"이라는 거짓 확정이 된다(`varianceOf` null 계약과 같은 근거). `yearMissing === 0`이면
  expected === actual이라 **종전 값과 한 푼도 다르지 않다**(가드 #G37c).
- **⚠️ `yearExpected`는 `<td>` 안에서만 쓰이는 표시 전용 값** — 아래 5소비자로 절대 흘려보내지 말 것
  (`compareMonths`/`momDelta`/`yoyDelta`/`yearSeries.actual`/`annualCompare`/`ledgerEventsByDate`).
  가드 #G37d가 양방향 정규식으로 단언한다.
- **⚠️ 미입력 배너 문구 정정** — 옛 문구 `합계·증감에서 제외됩니다`는 **거짓이었다**(소계·KPI·도넛은
  예전부터 `expectedTotal`을 썼고 이제 월 칸·연간 합계도 같다). 실제로 제외되는 건 전월·전년 대비와
  달력 칩뿐이다 → `계획으로 채워 합계에 넣습니다(전월·전년 대비와 달력은 제외)`(가드 #G37g).
  옛 문구는 바로 아래 도움말과 정면으로 모순됐다.
- **범위 밖(의도)**: **엑셀 3시트는 무변경** — `#G32c`의 "빈 셀 = 미입력" 계약과 각주가 걸려 있고,
  엑셀 색 규약에는 '흐린 이탤릭'에 대응하는 표현이 없어 화면과 같은 구분을 만들 수 없다.
  기존 항목 `계획` 열로 계획은 이미 파일에 들어간다. 기존 항목의 `activeFrom` 일괄 정리(마이그레이션)도
  하지 않는다 — 저장값을 조용히 덮는 대신 잠긴 칸 클릭으로 사용자가 명시적으로 푼다.
- 검증: 값 `#104~#104e`(기간 미지정이면 1월도 활성·계획이 잡힘·예상=계획·차이는 여전히 null·
  activeFrom이 있으면 종전대로 잠김) + 배선 `#G37~#G37g`. **변이 12종으로 실제 검출을 확인**했다
  (addItem 되돌림 · 연간 합계를 actual로 · expectedOf 누적 제거 · 차이 게이트를 expected로 ·
  달력 소비자 누출 · 흐린 표시 제거 · `NumCell` className 무시 · 잠긴 칸 클릭 제거 · 배너 문구 되돌림 ·
  `isItemActive` 무력화 · `expectedOf` 폴백 제거 · `varianceOf`가 미입력을 0으로 확정).

#### 예상(expected) 집계 — "계획만 입력해도 소계가 나온다" (2026-08, ⚠️ 회귀 주의)

소계 행의 월 셀은 **`expectedOf = actualOf ?? planOf`**(ledger.ts G-2절)다. 사용자가 계획만
넣어도 소계가 나와야 한다는 요청이 이 개념의 존재 이유다.

- **⚠️ `??`이지 `||`가 아니다.** `||`면 "그 달엔 안 썼다"는 **명시적 0이 계획으로 되살아나**
  미입력/0원 구분이 이 한 줄에서 붕괴한다.
- **⚠️ `monthTotals`에 필드로 얹지 말 것 — 별도 함수 + 별도 타입이 구조적 방어선이다.**
  그 구조체는 **5소비자**가 받아 간다: `compareMonths` · `momDelta`/`yoyDelta` ·
  `yearSeries.actual` · **`annualCompare`** · `ledgerEventsByDate`. 계획으로 채운 값이 새면
  ① 두 달이 항상 채워져 `missing-mismatch`가 영영 발동하지 않고(−87.2% 거짓말이 "변동 없음"
  으로 부호만 바뀌어 재발) ② 일어나지 않은 1년치 '실적' 막대가 그려지고 ③ 전년 대비가 영구히
  '항상 비교 가능한 거짓 숫자'가 되고 ④ 기록하지 않은 날에 달력 칩이 총지출을 찍는다.
  `#G10~#G10e`가 그 5구간을 잘라 `expected` 부재를 단언한다.
  ⚠️ `annualCompare`는 설계 단계의 누출 금지 목록에서 **빠져 있었다** — "계획만 입력한 해가
  전년 대비 차트에서 통째로 사라진다"가 요청과 같은 증상이라 거기에 꽂을 유인이 가장 크다.
- **⚠️ 소계의 '계획' 열은 `planSum`이지 `fromPlan`이 아니다.** 후자는 '실적이 없는 항목의
  계획'이라 **사용자가 실적을 채워 넣을수록 0으로 수렴**한다(실측 547,000 → 17,000).
  그 칸은 예상값을 검산할 유일한 기준선이라, 요청을 만족시키려던 변경이 정확히 그 검산을 파괴한다.
- **⚠️ 월 상태는 네 가지**(`monthState`: `none`/`empty`/`partial`/`full`). `missing < active`
  2분법으로 되돌리지 말 것 — 연중에 가계부를 시작하면 시작 전 달은 활성 항목이 0건이라
  `0 < 0 === false`가 되어 화면이 **"미입력 N개월"**이라 단언하는데, 그 칸은 매트릭스에서 `-`로
  잠겨 있어 채울 방법이 없다(경고가 영원히 안 꺼진다). **연중 시작이 기본 사용 경로다.**
- **⚠️ `expectedTotal`/`expectedByPay`는 수입 제외를 함수 **안**에서 한다** — 호출부에
  위임하면 `byPay`가 급여를 '현금합계'에 넣던 회귀(#48c)가 `monthTotals` 밖으로 자리만 옮겨
  되살아난다(#48c는 `monthTotals`만 보므로 초록으로 통과한다).
  **⚠️ 그 대가로 수입 소계는 반드시 `expectedIncomeTotal`을 써야 한다**(`renderSubtotalRow`의
  `income` 플래그). 지출 전용 집계를 그대로 태우면 `activeCount === 0` → `monthState 'none'`
  → **수입 소계가 12개월 전부 `-`, 계획·합계·차이 ₩0으로 죽는다**(적대적 리뷰 3렌즈가 독립
  적으로 잡은 회귀). `#G11-2`·`#G11-3`·`#82`가 그 배선을 단언한다.
- **⚠️ `unresolved`(실제도 계획도 못 구함)를 0으로 계상하지 말 것.** 산출된 항목이 0건이면
  셀은 `0`이 아니라 **`-`**이고(`resolved = actualCount + plannedCount`), 섞여 있으면 그 값은
  총액이 아니라 **하한**이라 `?N` 표시를 단다. 차이 열의 확정 불가 게이트에도 `unresolved`를
  포함할 것. 안 그러면 `principalAsOfYm`이 빈 대출이 **'납입 ₩0 · 차이 ₩0'으로 확정 단언**
  되어 `loanSchedule`의 null 계약("계산 실패는 0이 아니다")이 소계 경로에서 깨진다.
- **⚠️ 메인 도넛의 **모든** 그룹이 항목 단위 폴백(`expectedTotal`)을 쓴다.**
  `totals.byGroup`의 그룹 단위 `actual > 0 ? actual : plan`(전부-아니면-전무)으로 되돌리면
  **미입력 항목이 통째로 탈락**하는데 고정비 조각과 상세 도넛은 항목 단위라, 같은 캡션을 단 두
  카드가 다른 총액을 보여 준다(실측 880,000 vs 1,080,000 — **월 중 부분 입력은 기본 상태**다).
  통일하면 `Σ메인 === Σ상세 === expectedGrandTotal`이 성립하고 `#83`이 그 항등식을,
  `#83c`가 '옛 규칙이면 실제로 갈라진다'를 고정한다.
  ⚠️ `#G13f`(donutRows 공유)는 **음수 클램프만** 보므로 이 회귀를 잡지 못한다 — `#G13d-2` 필요.
- **⚠️ 결제수단 축은 한 화면에서 한 규칙만.** 옛 `payRows`(= `totals.byPay`의
  `actual > 0 ? actual : plan`)는 **삭제됐다. 되살리지 말 것** — 100% 스트립(항목 단위)과 같은
  카드 안에서 같은 수단에 다른 금액을 찍는다(실측 카드 580,000 vs 300,000).
- **결제수단 소계 행**은 그 그룹에 결제수단이 **2종 이상**일 때만 만든다(대출은 전부 '이체'라
  자동으로 사라진다). ⚠️ 현금/카드만 하드코딩하면 `pay:'auto'`인 항목이 **어느 행에도 없이
  사라진다** — `LEDGER_PAY_ORDER` 전체를 훑을 것. 불변식 `Σ(결제수단 행) === 그룹 소계`.
- **⚠️ tfoot '월 지출 합계 (연단위 납부월 포함)' 라벨의 괄호를 지우지 말 것** — 헤더 KPI의
  '월 지출 합계'는 **연단위 제외**라 이름이 겹치는데, 그 둘을 맞추려는 후속 수정이
  `recurringMonthly`에 annual을 더하면 `projectedAnnual`에서 **12배 이중 계상**된다.
  ⚠️ 이 행의 연 합계를 `projectedAnnual`과 같다고 **단언하지 말 것** — 정의가 다르다(이쪽은 각
  달의 자기 값 합, 저쪽은 기준월 recurring × 12). 대출의 `principalAsOfYm` 이전 달은 납입액이
  null이라 실측 픽스처에서 **11,581,101 어긋난다**(그 항등식을 테스트로 세우면 반드시 빨간불이
  뜨고, 가장 그럴듯한 '수정'이 `loanSchedule`의 `kRaw<0` 게이트 완화 → #18·#12 붕괴다).

#### 순서 이동 / 구분(category) / 헤더 세분화 (2026-08)

- **순서 이동**: `moveItemInGroup(items, id, ±1)` — `items`는 그룹이 **섞인 평면 배열**이라
  인접 인덱스와 그냥 교환하면 다른 그룹 항목과 자리를 바꿔 **화면에서는 아무 일도 일어나지
  않는다**. 같은 group의 가장 가까운 앞/뒤와 교환할 것. 이동 불가면 **원본 참조 반환**(헛된
  저장 트리거 방지). ⚠️ **`order` 필드를 만들지 말 것** — 배열 재정렬이면 `ledgerFingerprint`가
  순서를 그대로 투영하므로 **영속화 신규 지점이 0곳**이다(필드를 만들면 정규화·`same` 비교·
  지문·`makeLedgerItem` 4곳 등록이 필요하고 하나만 빠져도 조용히 유실).
  ⚠️ ▲▼ 버튼에 `data-col`을 달지 말 것(`onGridKeyDown`의 ↑/↓ 열 이동에 끼어든다).
- **구분 프리셋 = `LedgerBook.categories: string[]`** (신규 저장 필드). 선택 목록은
  `ledgerCategories(book)` = **레지스트리 ∪ 실제 쓰이는 값**.
  ⚠️ 합집합에 넣는 항목 값은 **가공하지 않고 그대로**다 — trim해서 넣으면 Drive/백업/브릿지로
  들어온 `' 구독 '`이 옵션 `'구독'`과 일치하지 않아 `<select>`가 선택 없는 상태가 되고,
  브라우저가 첫 옵션을 표시해 그 행이 **미분류로 보인다**. 거기서 한 번만 건드리면 원래 값이
  영구히 덮인다(undo 없음, sticky 보호도 없다).
  ⚠️ 레지스트리에서 지워도 **항목의 `category`는 건드리지 않는다**(그 값은 합집합에 계속 남는다).
  ⚠️ 정규화의 `changed` 판정에 `sameStrList(categories, src.categories)`를 **반드시 넣을 것** —
  빠지면 `raw`가 반환돼 정규화가 통째로 무효가 된다. 그리고 `sameStrList`는 **`undefined`와
  `[]`를 같게 본다**(다르게 보면 레거시 장부가 로드마다 '변경됨'이 되어 Drive 폴링마다 재저장 +
  로컬 사본이 갈아엎어져 2.5초 idle 승격 전 편집이 사라진다).
  ⚠️ 등록 3곳: `normalizeLedgerBooks`(+`changed`) · `ledgerFingerprint`(`c:` 키) ·
  `makeLedgerBook`(**`[]`** — 비지 않으면 `#60`이 깨져 백업 복원이 영구히 막힌다). `ledgerBooksHaveContent`도 포함.
- **헤더 '예상 月 지출' 결제수단 세분화 = `projectedByPay`** — ⚠️ **`totals.byPay`를 쓰지 말 것.**
  `byPay`는 연단위를 **납부월에 전액** 넣는데 카드 값 `projectedMonthly`는 연단위를 **÷12** 해
  매달 넣으므로 부분합 ≠ 총액이 상시 발생한다(실측: 비납부월 473,334 부족 / 납부월 5,680,000
  초과). `projectedByPay`는 **Σ가 `projectedMonthly`와 정확히 같도록**(무반올림) 정의돼 있고
  `#79`가 납부월·비납부월 양쪽에서 그 항등식을 고정한다.
  ⚠️ 라벨에 **'계획 기준'**을 남길 것 — 분석 탭 칩은 실적 우선 + 연단위 납부월 포함이라 같은
  '카드'라는 이름으로 다른 숫자가 나온다(양쪽 다 고지한다).

#### 도넛 / 결제수단 막대 (2026-08)

- **⚠️ 툴팁 글자색은 `contentStyle`이 아니라 `itemStyle`로 고친다.** 근본 원인은 recharts
  2.15.3 `Pie.defaultProps.fill = '#808080'` → `DefaultTooltipContent`의
  `color: entry.color || '#000'`이 그 회색을 채택하는 것이다(`<Pie>`에 fill을 주지 않고 색이
  `<Cell>`에 있으면 **툴팁 글자가 항상 #808080**, 4.59:1). 배경이 카드면과 **같은 색**(1.00:1)
  이라 상자가 떠오르지 않는 것이 나머지 절반 — 다크 테마에서 배경 명도로 벌릴 폭이 좁으므로
  (최선 1.23:1) **테두리 대비**(#374151 1.76:1 → #64748b 3.81:1)가 실질적 분리 수단이다.
  6곳 손복제를 `TOOLTIP_STYLE` 상수 하나로 합쳤다 — 되돌리지 말 것.
- **⚠️ 도넛은 바깥 라벨이 아니라 '옆 목록 + 안쪽 %'**(`DonutWithList`, 메인·상세 공유).
  220px에 4슬롯이 겨우 버티던 구성인데 고정비 분리·상세 구분으로 슬롯이 8~20개가 된다 —
  라벨선 끝점이 충돌해 **CVD 대역의 유일한 보조 부호인 직접 라벨이 무력화**된다.
- **⚠️ 두 도넛은 같은 후처리(`donutRows` = `Math.max(0,·)` 후 `>0` 필터)를 지나야 한다.**
  한쪽만 클램프하면 음수 plan(정정·환급 입력으로 도달 가능)에서 두 도넛의 합이 갈리고,
  `byGroup`과 비교하는 검증은 그 경우에도 통과하는 **죽은 단언**이 된다.
- **⚠️ 고정비 결제수단 분리는 `totals.byPay`가 아니라 고정비 항목만 순회해 구한다** —
  `byPay`는 그룹 구분 없이 전 지출을 나눈 값이라 대출·연단위가 섞인다(`addItem`이 연단위를
  `pay:'cash'`로 만들므로 오염이 **기본 경로**다).
- **결제수단 색 = `ledgerPayColor` (고정비 hue 램프)** — ⚠️ **독립 팔레트로 되돌리지 말 것.**
  이 앱의 색 공간은 포화라(GROUP 4 + DIVERGING 3 + 빨강 금지) 결제수단 5슬롯에 줄 독립 hue가
  **존재하지 않는다**(`validate_palette.mjs` §4가 그 불가능성을 매번 재확인한다 — 그 단언이
  실패로 뒤집히면 색 공간이 넓어진 것이므로 그때 승격할 것). 그래서 **스택 순서 + 범례 +
  세그먼트 안 직접 라벨**이 1차 식별자이고 색은 보조다. 고정비 도넛 분리와 막대가 **같은 색을
  공유**해야 한다(한 화면에서 '현금'이 두 색이면 안 된다).
- **⚠️ 스택 막대에서 `null`은 '데이터 없음'을 표현할 수 없다** — recharts가
  `getValueByDataKey(d, key, 0)`로 **0으로 강제**한다. 항목이 없던 달은 **행 자체를 제외**하고
  (`payChartData`) 제외한 달 수를 화면에 밝힌다(0 막대는 '그 달 지출 0원'이라는 거짓 단언).
- **⚠️ 대출 기본 결제수단이 `transfer`라 "현금+카드=전체"가 성립하지 않는다** — 반드시 고지.
- **상세 도넛**은 그룹당 **최대 5조각**. 램프가 6슬롯부터 인접 ΔE 4 아래로 떨어진다.
  ⚠️ `LEDGER_DETAIL_OTHER`는 **독립 상수**다 — `LEDGER_DIVERGING.flat`을 재사용하면 같은 회색이
  '계획선'·'변동 없음'·'기타 지출' 셋을 뜻한다.
- **⚠️ '기타 1건'으로 접지 말 것 — fold 임계는 `LEDGER_DETAIL_TOP_N + 1`이다(2026-08)**:
  `head 4 + 기타 1 = 5`는 **전부 표시(5)와 조각 수가 똑같은데 이름만 잃는 순손실**이다. 실제로
  대출 5건 중 APT 2가 그렇게 사라져 사용자가 "누락됐다"고 보고했다. `TOP_N`으로 되돌리면 그 버그가
  그대로 부활하고, `TOP_N + 2`로 넓히면 6건에서 n=6이 되어 팔레트 §2가 실패를 단언한 대역에 들어간다
  (⚠️ `validate_palette.mjs`는 화면이 몇 슬롯을 렌더하는지 **모른다** — 두 게이트 사이의 빈틈이라
  `#G13g-5`가 산술로 상한을 따로 고정한다). 각주 문구도 실제 규칙과 함께 갱신할 것(`#G13g-7`).
- **⚠️ 수지 균형 카드 = 수입·지출·차액 3막대, 두 축이 **같은 규칙**(2026-08 사용자 요청)**:
  과거엔 수입만 `t.actualIncome || t.planIncome`(그룹 단위 폴백)이고 지출은 `t.actualExpense`
  (폴백 없음)라, 실적 미입력이면 **범례에는 '지출'이 있는데 막대가 하나도 안 보였다**. 그 비대칭이
  원인이므로 둘 다 항목 단위(`expectedIncomeTotal` / `expectedTotal`)로 뽑는다 — 전용 필드
  `balIncome`/`balExpense`/`balance`를 쓰고 **`plan`/`actual`/`expected`는 손대지 않는다**
  (`#G10d`가 `plan: t.planExpense, actual: t.actualExpense,`를 리터럴로 단언한다).
  ⚠️ **`#G10` 계열 '계획 폴백 누출 금지'와 충돌하지 않는다** — 금지 대상 5소비자는
  `compareMonths`/`momDelta`·`yoyDelta`/`yearSeries.actual`/`annualCompare`/`ledgerEventsByDate`이고
  이 카드는 그 목록에 없다. row가 두 계열을 별도 필드로 들고 어느 쪽을 그릴지 고르는 것은
  **표시 선택이지 누출이 아니다**.
  - ⚠️ **null 게이트는 `&&`가 아니라 `||`다.** `makeLedgerBook`이 `items: []`로 시작하므로
    '수입 항목을 아직 등록하지 않은 장부'가 기본 경로인데, `&&`면 `balance = 0 − 지출`이 되어
    지출 전액이 12개월 내내 amber '부족분'으로 그려진다(부호까지 틀린 확정 표기).
  - 잉여금 = `LEDGER_DIVERGING.under`(teal) / 부족분 = `.over`(amber) + `<ReferenceLine y={0}>`으로
    **부호를 기하로도 이중 인코딩**한다. ⚠️ 범례 한 칸으로는 두 색을 설명할 수 없어
    `legendType="none"`이고, 색-의미 매핑은 **부제의 직접 라벨**(▲ 잉여금 / ▼ 부족분)이 진다
    (차트 ② `momDelta` 선례와 같은 규약 — 색만으로 뜻을 전달하지 않는다).
  - ⚠️ 막대 이름은 **`BALANCE_BAR_NAME` 상수로 공유**한다 — 툴팁이 `n === BALANCE_BAR_NAME`으로
    이 계열을 골라 부호별로 '잉여금'/'부족분' 라벨을 갈라 쓰므로, 한쪽만 고치면 분기가 조용히 죽는다.
    null 값은 recharts `Tooltip.filterNull`(기본 true)이 payload에서 **먼저** 걸러 formatter에
    도달하지 않는다 → `null >= 0 === true` 함정은 발생하지 않는다(2.15.3 소스 확인).
  - ⚠️ **차트 ①과 같은 그리드·같은 분홍색인데 규칙이 다르다**(①=입력된 실적만, ④=실제 ?? 계획).
    두 카드 부제가 **서로를 가리켜야** 사용자가 어느 쪽을 먼저 봐도 모순으로 읽지 않는다(`#G18m`·`#G18n`).
    헤더 KPI `savingCapacity`는 '계획 기준 · 연단위 ÷12'라 또 다른 축이므로 각주로 고지한다(`#G18p`).
  - ⚠️ `expectedTotal`의 `value`는 산출 불가(unresolved) 몫을 빼고 더하므로 총액이 아니라 **하한**이다
    → 각주가 그 달 수를 밝힌다(`#G18o`). **그 값으로 막대 색을 회색 중립화하지 말 것** —
    `loanSchedule`은 **만기 경과·잔액 0**(코드 주석이 "흔한 상태"라 부르는, 상환 끝난 대출을 지우지
    않고 둔 경우)에도 null을 내므로 가장 흔한 정상 상태에서 차트가 통째로 회색이 된다(과잉 억제).
  - **영속화 지점 0곳** — 전부 매 렌더 파생값이다. `ledgerFingerprint`·`portfolioStructureKey`·
    `applyStateData`·`applyBackupData`·`ledger:live` 브릿지 **전 지점 무수정**.
- **⚠️ sticky 오프셋은 파생 상수**(`LEFT_PLAN = COL_PAY + COL_NAME`). `left-[212px]`
  하드코딩으로 되돌리지 말 것 — 212는 `62+150` 전제라 항목 셀이 넓어지면 계획열이 제자리에 남아
  **가로 스크롤 시 × 삭제 버튼을 덮는다**.
- **⚠️ `../ledger` import를 한 덩어리로 합치지 말 것** — `memory/tools/undefcheck.mjs`의 import
  정규식이 `{...}` 안을 **300자까지만** 본다(합치면 1010자). 합치면 거기서 들여온 이름이 전부
  '미해결 후보'로 잡혀 **그 게이트가 이 파일에서 영구히 무의미**해진다.

#### 엑셀(.xlsx) 내보내기 — 시트 3장 (⚠️ 회귀 주의)

헤더의 **⭳ 엑셀** 버튼(⧉ 새 창 왼쪽)으로 **보고 있는 연도**를 시트 3장짜리 통합문서로 내려받는다.
`src/ledgerExcel.ts`(빌더) + `src/xlsxWriter.ts`의 **`buildXlsxMulti`**(다중 시트 확장).

| 시트 | 열 | 내용 |
|---|---|---|
| 월 매트릭스 | 29 | 결제·항목·계획 + [실제·차이] × 12개월 + 연간[실제·차이] · 그룹 섹션/소계/총계 |
| 대출 | 12 | 사진의 표 + 잔여 회차 + **값 출처** · 연 납입액(향후 12개월) · DSR |
| 연간요약 | 7 | KPI 9종 + 월별(계획·실제·차이·전월대비·미입력) + 구분별 + 결제수단별 |

- **월은 항상 12개월 전부**(화면에서 숨긴 월도 포함) — 사용자 확정. 파일이 늘 같은 모양이라
  다른 파일과 비교하거나 남에게 보낼 때 예측 가능하다.
- **⚠️ `hideAmounts` 미적용** — portfolioExcel·evalCompareExcel과 같은 규약. 화면 토글은
  '어깨너머 보기'를 막는 것이고, 내려받은 파일을 마스킹하면 쓸모가 없다.
- **⚠️ 색은 화면과 의도적으로 다르다.** 엑셀 숫자서식은 8색(Black·Blue·Cyan·Green·Magenta·Red·
  White·Yellow)만 지원해 화면의 amber/teal을 표현할 수 없고, **내려받은 파일은 앱 밖의 독립
  문서**라 스프레드시트 관례(초과=빨강 / 절약=녹색)가 오히려 정확하다(사용자 원본 시트도 그렇다).
  ⚠️ 대신 **▲/▼ 부호를 서식에 박아** 색만으로 뜻을 전달하지 않는다(색각 이상·흑백 인쇄 안전).

##### ⚠️ 다중 시트가 처음 만든 함정 4종 (설계 검토가 잡았다 — 되돌리면 그대로 재발)
- **`tabSelected`는 통합문서에 하나뿐**(`verify:excel #47`). `buildSheetXml`이 이 값을 하드코딩하면
  3시트가 전부 선택돼 Excel이 **'그룹'으로 묶어 연다** — 제목 표시줄의 [그룹] 표기 외에 시각 단서가
  거의 없는데, 그 상태에서 한 셀을 고치거나 행을 지우면 **묶인 모든 시트의 같은 위치에 그대로
  적용**된다(29열 매트릭스가 조용히 파괴된다). Ctrl+P도 전 시트를 인쇄한다.
  → `buildSheetXml(sheet, tabSelected = true)`의 **기본값 true**가 단일 시트 하위호환의 축이다.
- **`styles.xml`은 통합문서에 하나뿐**(`#49`·`#51`·`#81`). 셀의 `s`는 그 파일의 cellXfs 인덱스라,
  시트마다 다른 `styles` 배열을 쓰면 인덱스가 충돌해 **오류 없이 조용히** 색·숫자서식이 뒤섞인다
  (그 상태로도 Excel은 정상적으로 열려서 더 위험하다). → **StyleBag 하나**를 세 시트가 공유하고,
  어기면 `buildXlsxMulti`가 **던진다**.
  ⚠️ 그 가드를 `(sh.styles || []) !== styles`로 쓰지 말 것 — `||`가 매번 새 빈 배열을 만들어
  **styles 미지정 시트 1장이 자기 자신과의 비교에 실패**하고, 메시지가 원인을 정반대로 지목한다(`#51b`).
- **`[Content_Types].xml` Override와 `workbook.xml.rels`의 rId를 시트 수만큼** 늘려야 한다
  (`#44`·`#45`·`#46`). styles의 rId는 시트 **뒤**(N+1)로 밀리고 `<sheet r:id>`와 1:1이어야 한다 —
  어긋나면 Excel이 '복구할 수 없는 내용'으로 파일을 거부한다.
- **시트명 중복은 Excel이 거부한다**(`#53`·**`#53d`**). `sanitizeSheetName`이 31자 절단·금지문자
  치환을 하므로 서로 다른 이름이 같아질 수 있다 → `uniqueSheetNames`.
  ⚠️ `#53`~`#53c`는 함수를 **직접** 부르므로 `buildXlsxMulti`가 그걸 쓰는지는 보지 못한다
  (변이 테스트로 실증: 호출을 되돌려도 셋 다 통과했다) — **`#53d`가 사용부를 단언**한다.

##### ⚠️ 값 규약 (기존 엑셀 2종 계승 + 가계부 고유)
- **null 3종을 뭉개지 말 것**: '미입력'(빈 셀) / '0원'(숫자 0) / '해당 없음'(annual 비납부월 = 회색 `-`).
  0으로 떨어뜨리면 시트가 "지출이 없었다"고 확정 단언해 화면과 다른 말을 한다(`#83b`·`#83c`).
- **⚠️ 화면의 단일 소스를 재구현하지 말 것** — 계획은 `planOf`, 차이는 `varianceOf`, 미입력 판정은
  `expectsActual`을 **그대로 쓴다**(`#85`·`#85b`·`#G32`). `loanSchedule`을 직접 부르면 `planOf`의
  `isItemActive` 게이트를 잃어, 조기 상환으로 `activeTo`가 지난 대출이 **화면엔 '-'인데 시트엔 금액**이
  찍히고 그룹 소계·지출 합계·저축여력·KPI가 전부 그만큼 부푼다. `loanSchedule`은 대출 시트 전용.
- **⚠️ 전월 대비는 `comparable`만 보면 안 된다**(`#89`~`#89c`·`#G33`). zero-base는
  `comparable: true`인데 `rate: null`이라, 그 상태로 쓰면 **0.00%('변동 없음')가 확정 표기**되고
  같은 행의 차이 열(+₩500,000)과 정면으로 모순된다. 게이트는 상태 플래그가 아니라 **값**(`rate !== null`).
- **⚠️ 퍼센트는 분수 + `%` 서식**(`#88`). 이율 3.70을 그대로 넣으면 **370%**가 된다.
- **⚠️ 대출 '값 출처'는 6분기**(`#86c`·`#87`). `loanSchedule`의 null은 원인이 **네 가지**인데
  (기준월 없음·시작 전·만기 경과·잔액 0) 전부 '계산 불가'로 뭉개면 **상환이 끝난 대출**이 데이터
  오류처럼 보여 사용자가 멀쩡한 잔액·만기·이율을 고치거나 행을 지운다 — 대출은 DSR·저축여력의
  분모라 그 편집이 요약 시트 전체를 오염시킨다.
  ⚠️ 만기 판정은 **두 갈래**다: 만기일이 잔액 기준월보다 **앞서면** `loanTermMonths`가 null이라
  `k >= n` 분기에 닿지 못한다(그게 바로 '완납 후 방치'라는 가장 흔한 상태다).
  ⚠️ `loanSchedule`의 null 계약은 **손대지 말 것** — 사유 판정은 호출부에서 따로 낸다.
- **⚠️ 파일명 날짜는 인자로 받은 KST**(`#90`·`#G31`). `new Date()`는 KST 00:00~09:00에 하루 밀린다.
- **⚠️ 타입은 `import type`으로 분리**(`#G30`). Node 타입 스트리핑은 `interface`를 지운 뒤 런타임
  import를 시도하므로, 값 import에 섞으면 `does not provide an export named`로 **검증 파트①이
  통째로 죽는다**(vite 빌드는 통과하므로 무음이다).

##### ⚠️ 버튼
- **`readOnly`로 게이팅하지 않는다**(`#G35b`·`#G36b`) — 내보내기는 **읽기 동작**이고, 앱 탭
  새로고침으로 링크가 끊긴 13초(`LINK_TIMEOUT`)가 오히려 파일로 빼내고 싶은 순간이다.
- 데이터가 아직 안 온 상태(`gotData` 전)는 장부가 비어 있다 → **버튼 비활성 + 사유 표시**(`#G35d`).
- **try/catch 필수**(`#G35c`) — 이 화면은 z-1090이고 별도 창에는 App조차 없어 토스트·ConfirmDialog가
  뜨지 않는다. 인라인 플래시가 유일한 피드백이고, 던지면 창 전체가 오류 박스로 래치돼 복구 경로가
  창 닫기뿐이 된다.

##### 검증 — ⚠️ 스크립트를 새로 만들지 말 것
`buildXlsxMulti`·`freezeCols`·`uniqueSheetNames`의 OOXML 계약은 **`verify:excel`**(소유 모듈이
`xlsxWriter.ts`다 — 그래야 가계부를 개편·삭제해도 그 테스트가 살아남는다), 시트 3장 빌더·셀 값·
null 계약·버튼 배선은 **`verify:ledger`**에 둔다. 이 저장소는 **기능 하나 = 스크립트 하나**이고
(자산검증 비교도 모델+엑셀을 `verify-compare` 한 곳에서 검증한다), **게이트 목록에 없는 스크립트는
작업 흐름에서 아무도 돌리지 않는다**.
⚠️ 이 블록이 없던 동안 `tabSelected` blocker가 `verify:excel` 91/0을 그대로 뚫었다 —
신규 writer 코드가 어떤 게이트에도 노출되지 않았기 때문이다. **변이 15종으로 검출을 실증**했다.

- **범위 밖(의도)**: 차트 삽입 · 수식(SUM) 삽입 · 여러 연도 한 파일 · 피벗테이블 · 인쇄 설정 · CSV.
- **범위 밖(의도)**: 포트폴리오 계좌 자동 연동 · 개별 거래(트랜잭션) 입력 · 영수증 첨부 · 다중 통화 ·
  카드 명세서 임포트 · undo/redo · 예산 초과 푸시 알림 · 항목 드래그 재정렬(▲▼만) ·
  구분의 계좌 간 공유 · 상세 도넛의 드릴다운.
- 검증: `npm run verify:ledger` (직접 import #0~#102 + 소스 텍스트 가드 #G1~#G17c·**#G18\***, **489건**)
  + **`npm run verify:palette`**(`scripts/validate_palette.mjs`).
  ⚠️ **`#G13g`도 죽은 단언이었다**(2026-08 실증) — `/LEDGER_DETAIL_TOP_N/.test(LP) &&
  /LEDGER_DETAIL_OTHER/.test(LP)`가 파일 전역이라 **import 문 한 줄과 각주**만으로 충족돼,
  fold 로직을 통째로 지워도 초록이었다(변이 3종 확인). 지금은 `sliceBlock`으로 `detailDonut`
  구간을 잘라 **사용부**를 단언한다(`#G13g-1`~`#G13g-7`). 파일 전역 정규식으로 되돌리지 말 것.
  ⚠️ **존재 가드도 주석에 걸린다** — `#G18i`가 처음에 `/legendType="none"/`이었는데 바로 위
  설명 주석이 그 토큰을 인용하고 있어 실제 prop을 지워도 통과했다(변이 M10). 부재 가드는
  `stripComments`를 거치고(`#G18c`), 존재 가드는 **사용부 형태**(`name={BALANCE_BAR_NAME}
  legendType="none"`)로 좁힌다.
  ⚠️ **`#G10d`는 한때 죽은 단언이었다** — `yearSeries` 구간을 `const e = expectedTotal` 앞까지
  잘라 `expected` 부재를 재는 형태였는데, 보호 대상인 row 객체 리터럴이 그 **뒤**에 있어
  `actual: t.actualExpense` → `actual: e.value` 변이(= 이 diff의 최대 위험)가 278건 전부
  초록으로 통과했다. 지금은 **사용부 존재**(`plan: t.planExpense, actual: t.actualExpense,`)로
  단언한다 — 부재 슬라이스로 되돌리지 말 것.
  ⚠️ 파트①의 중심은 **사용자 실측 스프레드시트 픽스처**다 — 기대치(544,059 / 1,654,443 / 4,755,266 /
  62,743,196 / 27.6%)를 고치지 말 것. 가드는 **선언이 아니라 사용부**를 단언한다.
  ⚠️ **팔레트 검증기는 `validate_palette.mjs`다** — CLAUDE.md가 오래 참조하던 `validate_palette.js`는
  **저장소에 존재한 적이 없어** 그 규약이 실행 불가였다(2026-08 복원). 그 스크립트는 `ledger.ts`를
  직접 import해 `ledgerRamp` 출력을 **1:1 대조**하고(§0), 결제수단 축의 독립 hue가 불가능함을
  매번 재측정한다(§4). CVD 모델은 **Viénot/Brettel**이고 옛 주석의 "CVD ΔE 7.1"은 다른 모델의
  값이라 재현되지 않는다(이 모델 기준 deutan 12.4 / protan 11.3 / **tritan 4.2**).
  ⚠️ 새 가드는 **변이 30종으로 실제 검출을 확인**했다(`??`→`||` · 수입 게이트 제거 · planSum→fromPlan ·
  monthState 2분법 · 인접 인덱스 교환 · 참조 보존 제거 · category trim · 연단위 ÷12 제거 ·
  지문 투영 삭제 · `changed` 판정 삭제 · 레거시 churn · 램프 클램프 제거 · 5구간 누출 주입 ·
  결제수단 하드코딩 · 총합계 행 삭제 · itemStyle 삭제 · 바깥 라벨 복귀 · 후처리 우회 ·
  0 막대 복귀 · byPay 복귀 · sticky 하드코딩 · ▲▼/구분 삭제 · 구분 삭제가 항목까지 지움).
  ⚠️ 도넛 fold·수지 균형 가드는 **변이 17종(음성 대조 1 포함)으로 검출을 확인**했다
  (fold 임계 `+1`→`+2` · fold 삭제 후 무조건 slice 복귀 · `n`을 head.length로 축소 · 각주 되돌림 ·
  기타 색 바인딩 제거 · 지출 막대를 옛 `actual`로 · null 게이트 `||`→`&&` · 막대 이름 상수 공유 파괴 ·
  툴팁 부호 분기 제거 · `legendType="none"` 제거 · `ReferenceLine` 제거 · 부제 색 매핑 삭제 ·
  ① 상호 참조 삭제 · 산출 불가 각주 삭제 · `transparent` 분기 제거 · `plan/actual` 줄 변조 ·
  **주석에 금지 토큰을 인용해도 오탐하지 않는지**(음성 대조)).
  ⚠️ 그중 **`changed` 판정 삭제(M11)는 처음에 죽은 단언이었다** — `#76` 픽스처에 `id`가 없어
  다른 이유로도 `changed`가 섰다. `#76c`가 **categories 외 전부 정규형인 픽스처**로 그 구멍을
  막는다. 가드를 손볼 때 같은 변이가 여전히 잡히는지 다시 확인할 것.
### 계좌 카드 '별도 브라우저 창' (`/?cardWindow=1&card=…&pid=…`) (⚠️ 회귀 주의)

계좌 화면의 카드를 각각 별도 브라우저 창에서 열고 **편집까지** 한다. 카드 헤더의 **⧉ 확장 버튼**
(`CardExpandButton`)이 진입점이고, 창 제목은 `"COVERD 4 - 분배금 현황"` 형식이다(`cardWindowTitle`).
지원 카드 5종 — `summary`(포트폴리오 요약) · `stats`(통계·히스토리) · `dividend`(분배금 현황) ·
`rebalancing`(리밸런싱 표) · `donut`(자산비중비교). **`chart`(수익률 차트)는 범위 밖**(아래 참조).

- **⚠️ 창은 App을 마운트하지 않는다**(`main.tsx` `CARD_WINDOW_BOOT`). 메모 달력·흐름도·백테스트 창과
  **같은 규약** — Drive STATE는 통째 덮어쓰기라 writer가 둘이면 서로의 편집을 지운다. writer는 끝까지
  앱 탭 하나. `window.open`에 **`noopener` 금지**(opener 브릿지가 기능의 전부), 클릭 직후 **동기** open.
- **⚠️ 기존 3창과 결정적으로 다른 점: 단일 ref가 아니라 Map 레지스트리**(`cardWinsRef`). 카드 창은
  (계좌 × 카드)마다 열리므로 단일 ref로 두면 **뒤에 핑을 보낸 창만** 데이터를 받고 앞 창은 영구히
  낡는다. 창 하나당 `<CardWinFeed>`를 하나씩 마운트해(가변 훅 호출 회피) **계좌 객체 identity**로
  전송을 게이팅한다. ⚠️ 피더 JSX는 **early return보다 위에서** 만들어 관리자 페이지·포털·배당세
  페이지 분기에도 함께 렌더한다 — 메인 대시보드 return 안에만 두면 앱 탭이 그쪽으로 이동하는
  순간 피더가 언마운트돼 창은 갱신이 멈추는데도 ping/pong은 계속 오가 '연결됨·편집 가능'으로 남는다 — `setPortfolios`의 map이 바뀌지 않은 계좌의 참조를 보존하므로 JSON 지문보다
  정확하고 공짜다. 같은 (계좌,카드) 재클릭은 `window.open`의 name 재사용으로 **기존 창을 포커스**한다.

**불변식(INV) — `src/cardWindow.ts` 상단에도 같은 목록이 있다**
- **INV-1** writer는 앱 탭 하나. 창은 App을 import조차 하지 않는다.
- **INV-2** 창은 **원자재**(계좌 객체 + 시장지표 + 종가 이력 부분집합)만 받고 파생은 **앱과 같은 코드**
  (`usePortfolioData`·`buildBookCostSeries`)로 **창에서** 계산한다. 파생값을 push하면 창 로컬 상태
  (정렬·'추가' 수량)를 반영할 수 없어 화면과 계산이 갈린다.
- **INV-3** 창의 모든 쓰기는 **by-id 커맨드**(`card:cmd`). `patchActive` 계열을 프록시하면 앱 탭의
  **활성 계좌**에 착지해 엉뚱한 계좌를 파괴한다.
- **INV-4** 통째 교체는 **기대값**을 함께 보내고 앱이 다르면 배치 전체를 거부한다 — 계좌 필드
  배치는 `expect.principal`(원금을 안 건드리는 배치에도 **항상** 싣는다: 앱 탭의
  `transferStockToPortfolio`가 이관 행을 prepend하며 원금도 바꾸므로, 이 값이 '메모만 고치는
  편집이 이관 행을 지우는 것'까지 막는 유일한 방어선이다), 투자기록은 `baseKeyOf(notes)`
  (앱 탭 **메모 달력 NOTE 패드**가 같은 배열을 동시에 편집한다).
  ⚠️ **과표 이벤트(`updateTaxBaseEvents`)는 미적용** — `dividendCall`이 20종을 fn 이름으로
  라우팅하는 범용 통로라 개별 base를 얹으려면 라우터를 깨야 하고, 그 배열을 자동으로 쓰는
  앱 경로가 없어 위험이 '앱 탭과 창에서 같은 종목을 동시에 편집'으로 한정된다(문서된 절충).
- **INV-5** 창은 자기 `ConfirmDialog`·인라인 토스트·`ErrorBoundary(label)`를 갖는다. App의 `confirm`은
  App이 렌더하는 다이얼로그가 resolve하므로 프록시가 **원리적으로 불가능**하고, `notify`는 애초에
  토스트를 그리지 않아(벨 로그만) 프록시해도 창 사용자에겐 피드백이 **0**이다.
- **INV-6** 메시지 화이트리스트는 **양쪽 모두 접두사 검사**(`card:`). 열거형 금지 — `CalendarWindow`가
  열거형 비대칭으로 응답을 조용히 폐기한 사고가 있다.
- **INV-7** 창의 조작은 앱 탭 비활동 타이머를 리셋한다. ⚠️ `resetActivity`만으로는 부족 — 경고가
  **이미 뜬 뒤**에는 체크 루프가 `lastActivityAt`을 보지 않아 60초 뒤 무조건 로그아웃한다(그 모달은
  창 뒤 앱 탭에 있어 보이지도 않는다) → `showInactivityWarning`이면 `handleInactivityContinue()`.
- **INV-8** 끊김(opener 소멸·13초 무응답)·삭제 계좌 = **읽기 전용**. 저장 버튼만 숨기면 한참 고친 뒤 사라진다.
- **INV-9** 창은 계좌 id를 **열 때 박제**한다 — 앱 탭이 다른 계좌로 가도 자기 계좌를 계속 편집한다.

**by-id 라이터 계층(`usePortfolioState`) — 이 기능의 바닥**
`patchById(pid, patch)` 신설 + `patchActive = patch => patchById(activePortfolioId, patch)` 위임
(렌더 스코프 클로저 동일 → 앱 탭 동작·타이밍 무변). 신설: `applyItemPatchesFor` ·
**`applyCardWriteFor(pid, {itemPatches, settingsFields, accountFields, expect})`**(단일 `setPortfolios`로
원자적) · `handleUpdateFor` · `updateSettingsForTypeOf`(accountType을 **pid**에서 해석) ·
`patchSettingsForTypeOf`(필드 병합) · `setPrincipalFor`/`addPrincipalFor`/`setAvgExchangeRateFor` ·
열 숨김·행 마킹 by-id 변형. 4색 사이클·열 토글은 순수 헬퍼(`cycleMarkedRow`·`toggleInList`)를 공유한다.
`useStockData`에는 **`handleSingleStockRefreshFor(pid, id, code)`** — 옛 구현은 항목 조회·시장 라우팅·
쓰기·`stampDateFor` **넷 다** 활성 계좌에 묶여 있어, 다른 계좌를 보는 창에서 누르면 **잘못된 확정일로
전역 `stockHistoryMap`을 스탬프**했다(그 맵은 `buildCloseEvalSeries`의 `allExact` 판정과 자동확정
데이터완비 가드의 권위 소스이고 Drive에 영속 → 한 번 오염되면 과거 평가액이 영구히 어긋난다).

**커맨드 프로토콜** — 창→앱 `card:ping{winId,card,pid,need}`(5초·`need`가 초기 전송의 유일한 트리거·
재입양) · `card:cmd{winId,reqId,op,args}` · `card:activity` / 앱→창 `card:pong` · `card:data`(원자재) ·
`card:ack{reqId,ok,result,reason}` · `card:teardown`.
- **⚠️ 쓰기는 입양된 창만**(`entry.win === e.source`), ping만 그 앞의 의도된 예외.
- **⚠️ `switch` 진입 **전에** `pidOk(a.pid)`를 한 번 검사**한다 — 개별 case가 빠뜨려도 타 계좌로 새지
  않는다(fail-closed). 분배금 라우팅도 `args[0] === entry.pid`를 재확인한다. 창은 URL 파라미터로
  열리므로 조작 가능하다는 전제.
- **⚠️ `CARD_OPS`는 문서가 아니라 계약** — App 핸들러와 **1:1**이어야 한다(가드 #G3g가 양방향 단언).
  목록에만 있고 구현이 없는 op은 default-deny에 걸려 '버튼이 고장난 것'으로 보인다.
- **⚠️ 응답이 필요한 op은 `reqId` 상관 + 타임아웃**(`saveTargetSnapshot`·`verifyPin`). postMessage는
  fire-and-forget이라 동기 반환값 계약을 그대로 쓰면 성공해도 실패로 표시된다.

**카드별 규약**
- **분배금**: 라이터 20종이 **이미 전부 by-id + 원시 인자**라 `dividendCall`로 그대로 프록시한다.
  ⚠️ `onToggleHiddenMonth`의 **시그니처는 `(tab, monthIndex)` 그대로** 두고 pid는 호출부가 바인딩한다 —
  넓히면 통합 대시보드 compact 경로(앱 레벨 저장, pid 없음)의 인자가 밀려 버킷이 뒤바뀐다.
- **리밸런싱**: 항목 쓰기가 `writeTargets(itemPatches, settingsFields)` 하나로 모였다. `cardWrite`가
  주어지면 그쪽으로만 보낸다(인앱은 종전 `setPortfolio`+`updateSettingsForType`).
  **⚠️ 미러 3전이((%)·(₩))와 '잔액→예수금'은 항목 patch와 settings를 반드시 한 번에 쓴다** — 쪼개면
  반쪽 적용이 남고 재클릭이 같은 전이를 또 타서 목표금액이 현재 평가금으로 **두 번** 덮인다(undo 없음).
  **⚠️ 과거 목표비중 복원은 창에서 구조적 no-op** — `setPortfolio`를 넘기지 않고 `rebalTargetSnapshots=[]`
  라 버튼도 잠긴다(CLAUDE.md '복원' INV-5: id 불일치 시 no-op이 곧 타 계좌 오적용 방어).
  PIN 검증은 앱 탭에 위임한다(창의 `sessionStorage`는 **열린 시점 사본**이라 낡는다).
- **달력 목표비중 스냅샷**: `buildRebalTargetEntryFrom`·`sameRebalTargetEntry`·`upsertRebalTargetMemo`를
  `utils.ts`로 추출해 App과 창이 공유한다. **⚠️ 창이 자기 화면 값으로 만든 엔트리를 보내고 앱은 upsert만
  한다** — 앱이 활성 계좌 스코프로 재빌드하면 그 순간 '기록 = 화면 표 1:1'이 깨지고, 앱 탭이 다른 계좌를
  보고 있으면 **그 계좌의 기존 기록을 거짓 내용으로 교체**한다(`calendarMemos`는 백업 복원 sticky라
  복구 불가). 부수 효과로 창 로컬 정렬·'추가' 수량이 기록에 그대로 반영돼 오히려 정확해진다.
- **통계·히스토리**: **⚠️ 계좌 필드 쓰기는 마이크로태스크로 모아 하나의 `cardWrite`로** 보낸다 —
  `DepositPanel`은 한 클릭에서 `setDepositHistory`와 `setPrincipal`을 따로 부르므로, 쪼개지면 원장은
  지워졌는데 원금은 그대로인 중간 상태가 Drive에 저장된다(컴포넌트 수정 0줄).
  **⚠️ 배치에는 언제나 `expect.principal`을 싣는다**(원금을 안 건드리는 배치라도) — 앱 탭의
  `transferStockToPortfolio`가 이관 행을 prepend하며 원금도 바꾸므로, 이 기대값이 **메모만 고치는 편집이
  이관 행을 지우는 것**까지 막는 유일한 방어선이다.
  **⚠️ history 편집(자산검증 확정·수량/종가)·전체 시세 새로고침·CSV는 창에서 명시적 미지원** — history는
  앱 탭이 백필·자동확정·today-effect로 **동시에** 쓰는 배열이라 창의 스냅샷을 통째로 되보내면 그 사이
  생긴 기록이 소실된다. 조용히 무시하지 않고 창 안 인라인 안내로 사유를 밝히고, 종가 재조회는
  `Promise<false>`를 돌려준다(undefined면 모달 스피너가 영구 회전).
  `activeBookByDate`는 앱과 **같은 정책**(해외·현금성 `null`)으로 창이 직접 계산한다.
  기록 확정일(KR 21:00 / 글로벌 07:30)은 **앱이 계좌 타입별로 해석해 보낸다**(창 재계산 금지).

**세션·보안**
- **⚠️ 로그아웃·세션 충돌 시 `card:teardown` 브로드캐스트 + 창은 화면 내용을 비운다**(단순 읽기 전용으로는
  이전 사용자의 금융 데이터가 남는다 — 다중 계정 오염 방지 정책). `onForceLogout`·수동 로그아웃 **둘 다**
  `ADMIN_VIEW_EMAIL` 가드보다 **앞**에서 정리해야 한다(impersonation 탭에서 연 창에는 피조사 사용자의
  데이터가 떠 있다). `authEpoch`(로그인 이메일) 불일치도 같은 처리.

**영속화 신규 지점 0곳** — 창은 저장 필드를 만들지 않는다. 모든 쓰기가 앱 탭의 기존 by-id 라이터를 타고
`portfolioStructureKey` → `portfolioUpdatedAt` → `useDriveSync` 경로로 흐른다. 예외는 **선행 결함 1건**:
`actualDividendQty`·`dividendTaxAmounts`가 지문에 없고 라이터도 `dividendHistoryUpdatedAt`을 올리지 않아
그 필드만 고친 세션이 조용히 유실됐다(분배금 전용 창의 주 사용 시나리오) → 지문에 추가했다.
'숨긴 카드 1회 펼침'도 `sectionCollapsedMap` **안의 예약 키**(`__cardWindowUnhide_v1__`)로 표현해
chartPrefs 5지점을 새로 만들지 않는다 — ⚠️ 로드마다 비우는 방식은 '숨기기 유지'를 사실상 제거하므로 금지.

**범위 밖(의도)**
- **수익률 차트**: `finalChartData`(App.tsx 219줄 memo) + 선행 memo 4개(`activeCloseEvalByDate`·
  `activeBookByDate`·`accountTwrByDate`·`filteredDates`)가 전부 활성 계좌 전용이고, 그 체인이 누적 TWR
  **곱셈 체인**이라 리팩터링 중 하루라도 값이 갈리면 이후 전 구간이 영구히 어긋난다. 조회기간
  (`chartPeriod`/`appliedRange`)도 앱 레벨 단일값이라 창별 기간을 표현할 수 없다.
- 앱 탭을 닫으면 창은 읽기 전용(구조적 — writer가 하나뿐이므로 우회 불가).
- 같은 계좌를 앱 탭과 창에서 동시에 편집하면 **필드 단위** last-write-wins(달력·흐름도 창과 같은 절충).
- `settings`는 같은 accountType 전 계좌 공유라 창의 설정 변경도 형제 계좌에 전파된다(기존 앱 동작 그대로).
- 창의 정렬·'추가' 수량은 **창 로컬**(둘 다 세션 스크래치). `rebalanceSortConfig`는 앱에서만 영속된다.

검증: `npm run verify:card-window` — 순수 함수는 `src/cardWindow.ts`를 **직접 import**해 테스트하고
(미러 금지 — src/미러 한쪽만 고친 변경이 둘 다 통과하는 구멍을 만든다), 배선은 소스 텍스트 가드다.
⚠️ 가드는 **선언이 아니라 사용부**를 단언한다. **변이 49종으로 검출을 실증**했다
(그중 14종은 적대적 검증이 실제로 잡은 결함의 회귀 가드다 — `rebalCommitRef` 등록 소실로
**인앱 메모 달력 목표비중 자동 기록이 전면 중단**된 blocker, 창의 입출금 정렬 dead 배선,
끊긴 창에서 쓰기가 새던 것, impersonation 무통지 편집 경로, 피더 언마운트, 투자기록 무가드
전량 교체, `settings` 폴백 자기모순, 계약 파일의 **NUL 바이트**(git이 바이너리로 취급해
diff·`-S` 검색이 통째로 막혔다) 등) — 그중 미러 원자성
가드는 처음에 **죽은 단언**이었다(갭 정규식이 문장 경계를 넘어 다음 호출의 인자를 집었다). 사이클 함수
본문을 잘라 '호출 횟수 = 전이 수(3)'로 세도록 고쳐 검출을 확인했다. 가드를 손볼 때 같은 변이가 여전히
잡히는지 반드시 다시 확인할 것.

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

- `notify()`는 **전용 토스트가 없다** — 호출 즉시 하는 일은 벨 '알림 이력'(`notificationLog`,
  Drive 영속) prepend + 미확인 배지(`unreadCount`) 증가 **둘뿐**. 따라서 사용자가 보는 "알림"의
  실체는 곧 벨 이력이고, "알림 최소화"는 곧 벨에 안 남기는 것이다.
- 분리 유지: 모달 다이얼로그, LoginGate 인라인 에러, Header Drive 상태 아이콘
- `ConfirmDialog.tsx` props: `state: ConfirmState | null`, `onResolve: (r: boolean) => void`

### 알림 최소화 정책 (⚠️ 회귀 주의 — 성공/진행/시세 알림 재추가 금지)

사용자 요청(2026-07): **벨 알림은 최소화**한다. 벨에 남기는 `notify()`는 **딱 세 부류만**:

1. **관리자 공지** — `[관리자 공지] …` (`App.tsx` `acknowledgeAdminNotices`만 발송, 유일 경로).
2. **중요 오류(데이터/접속에 영향)** — Drive 인증 필요/만료/실패, Drive 저장 실패, 폴더 없음, 클라이언트
   초기화 실패, 다른 기기 로그인 감지, config Client ID 미설정, Drive 로드/백업 목록/백업 적용/파일 복원
   실패, 올바른 파일 아님, Drive 미연결, 수동 저장본 최신 안내, 설정/데이터 저장·로드 실패(admin).
3. **입력 가드 / 사용자 액션 실패** — 폼 검증(그룹 이름·사용자·수량·코드·날짜 입력, 재계산 0원, 종가
   수동입력 불가/데이터 없음), 파일 임포트 파싱 실패(`useIndexImport`·`useMarketData`·`DividendTaxPage`
   CSV), 잘못된 링크 형식. **사용자가 직접 한 동작이 거부/실패한 이유**라 반드시 알아야 함.

**절대 다시 넣지 말 것(전부 제거됨)**: ① 모든 성공·완료(저장/변경/추가/생성·삭제/확정/복원/복구 완료)
② 모든 진행·정보(불러오는 중, 저장 중, 팝업 확인, 강제 재수집 시작) ③ **시세 계층 전체**
(`useStockData` — 종목 가격 갱신 완료/오류, 현재가·기준가 갱신 실패, 이력·백테스트 수집, 조회 실패).
시세 실패는 `stockFetchStatus`의 행 내부 상태점(빨간 표시)이 시각 피드백을 대신하고, 사용자 액션
완료(PC 저장·비밀번호 변경·백업 복원·자산검증 편집)는 **화면 변화 자체가 피드백**(무음 처리 — Q2 결정).
- 제거로 `useStockData`·`PinChangeModal`의 `notify` 파라미터는 미사용이 되지만 **@ts-nocheck +
  esbuild(`vite build`, 타입체크 없음)라 무해** → 향후 중요 오류 재추가 여지로 파라미터는 유지.

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

### 시장동향 리포트 = 유튜브식 '단일 URL 바로가기' (⚠️ 회귀 주의 — 자료 목록으로 되돌리지 말 것)

상단바 **📈 TrendingUp 아이콘**(teal)은 관리자가 넣은 **URL 하나**로 바로 이동한다(새 탭).
`youtubeUrl`과 **완전히 같은 등급**의 기능 — 드롭다운·자료 목록·HTML 업로드·등록 공지가 전부 없다.
2026-08 전환(그 전에는 학습자료를 병렬 복제한 다중 자료 채널이었다).

- **사용자 플래그(변경 없음)**: `userFeatures.reportEnabled` ← approved_users 시트 **J열(index 9)**.
  Apps Script `check`/`listUsers` 응답 + `setUserFeature` colMap `reportEnabled:9`,
  `getFeatureLabels` E1:J1 → AdminPage `featureLabels` 6번째(`시장리포트`)·featureDefs 토글(teal).
  `reportAccess = isAdminUser || userFeatures.reportEnabled` (관리자 본인이 영구 접근 불가가 되지 않게).
- **⚠️ 저장 키는 기존 `reportLinks`를 그대로 재사용한다(Apps Script 재배포 불필요) — 새 키를 만들지 말 것**:
  Apps Script `handleSetSettings`/`handleGetSettings`는 **키 화이트리스트**(`youtubeUrl`/`notebookLinks`/
  `reportLinks`/`youtubeUrlHistory`/`feature1Label`)라 `reportUrl` 같은 새 키를 **거부**한다. 일반 사용자는
  Apps Script `getSettings`가 정본이므로, 새 키를 쓰면 **시트 재배포 전까지 링크가 전달되지 않는다**.
  → 프론트 상태는 문자열 하나(`reportUrl`)지만 **wire 포맷은 계속 배열**이다.
- **변환 2함수(`App.tsx` 모듈 스코프)**: `reportUrlFromLinks(links)` = 배열에서 **url이 있는 첫 항목**만 승계
  (레거시 다중 링크·fileId 전용 항목은 자연 탈락) / `reportLinksFromUrl(url)` = `[{title:'시장동향 리포트', url}]`
  또는 빈 배열. ⚠️ **`reportLinksFromUrl`은 순수해야 한다(`createdAt` 등 타임스탬프 금지)** — 유튜브·학습자료
  저장 경로가 co-write로 이 값을 매번 다시 만들기 때문에, 호출마다 값이 달라지면 무의미한 저장 churn이 난다.
- **⚠️ co-write 규약 = `App.tsx` `writeAppSettings(patch)` 단일 진입점**: `DRIVE_FILES.SETTINGS`는 통째로
  덮어써지므로 `youtubeUrl`·`notebookLinks`·`reportLinks`·`noticeFlags` **네 값을 항상 함께** 실어야 한다
  (하나라도 빠지면 그 필드가 빈 값으로 지워진다). 과거엔 4핸들러가 각자 손나열했는데, 이제 헬퍼가 현재
  state로 기본값을 채우고 `patch`만 덮어쓴다 → **저장 경로를 추가할 때 `saveDriveFile`을 직접 부르지 말고
  이 헬퍼를 쓸 것**. 유일한 예외는 로드 실패 시 **마이그레이션 저장**(state가 아직 갱신 전이라 지역 변수로
  기록 — 여기서도 네 값 + `settingsSchema` 필수).
- **⚠️ 저장 실패는 반드시 화면에 띄운다(`notify` 금지 아님, 부족함)**: 관리자 페이지는 App이 `<AdminPage/>`만
  early-return하는 **전체화면**이라 알림 벨·`ConfirmDialog`가 언마운트 상태이고 `notify`는 토스트를 렌더하지
  않는다 → 저장·삭제 실패가 **'아무 일도 안 일어남'과 화면상 완전히 동일**했다(2026-08 실측 버그: 새 링크를
  넣어도 '현재:'가 안 바뀌고 [삭제]도 먹지 않음). → `writeAppSettings`는 **실패 사유 문자열**을, 4핸들러는
  `{ok, message?, warning?}`(`SettingsSaveResult`)을 반환하고 `AdminPage`가 카드 안 `SaveMsgLine`으로 띄운다.
  `nbUploadError`·`featureToggleError`와 같은 패턴이다.
- **⚠️ 401 무음 갱신 + 1회 재시도**: `writeAppSettings`는 `saveAllToDrive`와 같은 패턴으로 401이면 토큰을
  재발급해 한 번 더 시도한다. 그리고 **관리자 페이지 직접 진입 경로(`driveLoadReady=false`)는 메인 로드
  effect를 타지 않아 `initTokenClient()`가 한 번도 불리지 않았다** → `tokenClientRef`가 null이라 무음 갱신이
  통째로 no-op이었고, 액세스 토큰(1시간) 만료 후 **모든 설정 저장이 새로고침 전까지 영구 실패**했다.
  관리자 페이지 전용 로드 effect 상단에서 `initTokenClient()`를 부르는 이유가 이것이다(지우지 말 것).
- **⚠️ Apps Script 배포는 await + `success` 검사**: 시트가 **일반 사용자에게 전달되는 유일한 경로**인데
  fire-and-forget이라, 시트 기록이 실패하면 관리자 화면만 새 링크로 바뀌고 사용자는 옛 링크에 무기한 묶였다
  (양쪽 모두 무표시). `deploySettingToSheet`가 결과를 돌려 경고(`SHEET_DEPLOY_WARN`)를 띄운다. ⚠️ Apps
  Script는 **거부도 HTTP 200 + `{success:false}`** 로 답하므로 `res.ok`만 보면 실패를 놓친다. 이때 [저장]
  버튼이 값 비교(`input === reportUrl`)로 잠기면 **재시도 수단이 사라지므로**, 실패·경고 상태에서는 같은
  URL로도 다시 누를 수 있어야 한다.
- **⚠️ 정본 마커 `settingsSchema`(=`SETTINGS_SCHEMA`)**: 마커가 없으면 "링크가 전부 비어 있음"과 "파일 없음"을
  구분할 수 없어, 관리자가 **마지막 링크를 삭제한 순간** 로드가 Apps Script 시트로 폴백해 **방금 지운 옛 링크를
  되살리고 Drive에 되쓴다**(유튜브·학습자료도 함께 비어 있는 관리자에게서 재현 — 삭제가 영구히 안 먹는다).
  마커가 찍힌 파일은 값이 비어도 Drive가 정본(`isAuthoritativeSettings`), 마커 없는 레거시 파일은 종전대로
  1회 마이그레이션하며 그때 마커가 찍힌다. `driveSettingsFound`(메인)·`found`(관리자 페이지) 양쪽에 적용.
- **⚠️ 늦게 도착한 로드가 방금 저장한 값을 되돌리지 못하게**: settings 로드 effect 2곳은 비동기라, 로드 완료
  전에 저장하면 그 응답이 저장 이전 값으로 state를 덮는다(관리자 페이지 진입 직후 붙여넣고 바로 저장 시 재현).
  → `settingsWrittenRef`가 서면 두 로드 effect가 반영·마이그레이션 저장을 **모두** 건너뛴다.
- **로드 3경로**가 전부 `reportUrlFromLinks`를 통과한다: 정상 Drive 로드 · Apps Script 폴백(+ 그 안의
  마이그레이션 저장은 **단일 URL로 정규화해** 기록 — 레거시 다중 링크는 첫 URL만 승계, 의도) ·
  관리자 페이지 전용 로드. `driveSettingsFound` 판정(`reportLinks?.length > 0`)은 배열이라 그대로 동작.
- **⚠️ 삭제 버튼은 성공했을 때만 입력칸을 비운다**: 결과를 기다리지 않고 먼저 `setReportInput('')`을 하면,
  저장이 실패한 경우 '현재:' 줄은 그대로 남고 사용자가 친 URL만 사라져 **삭제도 안 되고 입력도 잃는다**
  (시드 effect는 `reportUrl`이 안 바뀌어 재실행되지 않으므로 복원도 없다). YouTube 카드도 동일 규칙.
- **공지 없음(유튜브와 동일)**: `__report__` 센티넬 발송 경로·리포트 '공지 ON/OFF' 토글·
  `reportNoticeMessage`가 **전부 제거**됐다. `notifTargetsUser`는 `__report__`를 명시적으로 `false`로 떨어뜨려
  **시트에 남은 옛 리포트 공지가 더는 발송되지 않는다**(관리자 알림 목록의 라벨만 '폐지된 채널'로 남김).
- **HTML 업로드/뷰어는 학습자료 전용으로 환원**: `handleUploadStudyMaterial`/`handleDeleteStudyMaterialFile`·
  `/api/study-material` 프록시·`StudyMaterialViewer`는 그대로지만 **리포트는 더 이상 쓰지 않는다**
  (fileId 자료 = 앱 내 sandbox 뷰어 / 리포트 = 그냥 새 탭).
- **Apps Script 무수정**: J열·`reportLinks` 키가 이미 배포돼 있어 **이번 변경에는 재배포가 필요 없다**.
  (시트 값의 형태만 다중 링크 → 단일 링크 배열로 바뀐다.)
- **범위 밖(의도)**: URL 이력(유튜브에는 있음)·리포트 HTML 업로드·다중 리포트.

### 공지 발송 제어 — 자료 채널 '공지 ON/OFF' + 목표 비중 공지 세션당 1회 (⚠️ 회귀 주의)

관리자가 **언제 공지를 보낼지** 고르는 두 장치. 서로 독립이며(플래그 공유 없음) 합치지 말 것.

- **학습자료 '공지 ON/OFF'**(`AdminPage`): '노트북 LM 슬라이드' **섹션 헤더 우측 알약 버튼**
  (`renderNoticeToggle`, sky / OFF=회색). OFF면 **등록·업로드 시 `sendNotification` 발송만 건너뛴다** —
  자료 등록·Drive 저장·Apps Script 배포·사용자 드롭다운 노출은 그대로다(조용히 올리기). 게이트는
  **발송 2지점 전부**(`handleAddNotebookLink`·`handleUploadStudyMaterialFile`)에 `noticeOn(channel)`으로
  걸린다 — 새 자료 등록 경로를 추가하면 이 게이트도 같이 달 것.
  ⚠️ **시장동향 리포트에는 공지가 없다**(단일 URL 바로가기 = 유튜브처럼 조용히 바뀜) — 토글을 되살리지 말 것.
- **저장 위치 = 관리자 Drive `app_settings.json`의 `noticeFlags: {notebook}`**
  (`App.tsx` `handleSetNoticeFlags`). Apps Script `setSettings`는 **키 화이트리스트**가 있어 새 키를
  거부하므로 배포하지 않는다(관리자 전용 설정이라 일반 사용자는 읽을 필요 없음 → **Apps Script 재배포
  불필요**). ⚠️ **co-write 규약**: `DRIVE_FILES.SETTINGS` 쓰기는 **`writeAppSettings(patch)` 한 곳으로 모였다**
  (4핸들러 전부 경유 — 위 '시장동향 리포트' 섹션 참조). 유일한 예외인 **마이그레이션 저장**만 지역 변수로
  **네 값**(youtubeUrl·notebookLinks·reportLinks·noticeFlags) + `settingsSchema`를 직접 나열한다 —
  하나라도 빠지면 그 필드가 빈 값으로 덮인다.
  마이그레이션 저장은 `setNoticeFlags` 클로저가 stale하므로 **지역 변수 `loadedNoticeFlags`**를 쓴다.
  옛 파일의 `noticeFlags.report`는 `normalizeNoticeFlags`가 조용히 버린다(무해).
- **로드 2경로**(정상 로드 · 관리자 페이지 전용 로드)가 모두 `normalizeNoticeFlags`로 읽는다.
  **미지정/손상값 = ON**(`!== false`) → 구버전 파일·일반 사용자에게 기존 동작 그대로. `driveSettingsFound`
  판정에는 **넣지 않는다**(링크가 비면 Apps Script 폴백이 그대로 돌아야 함).
- **목표 비중 공지 = 관리자 접속(impersonation) 세션당 1건**(`App.tsx`
  `notifyUserOfAdminTargetChange`). 과거엔 5초 디바운스뿐이라 **여러 종목을 하나씩 고치면 편집 간격마다
  1건씩** 계속 나갔다. `adminTargetNotifSentRef`가 **발송한 대상 이메일을 래치**해 그 세션에서는 몇
  종목·몇 번을 고쳐도 1건으로 끝난다(디바운스 5초는 유지 — 연속 편집을 한 요청으로 모음).
  **래치 해제는 세션 시작 2곳 + 발송 실패**: `handleLoginApproved` 상단, `authUser?.email` effect,
  그리고 **응답이 실패면 래치 되돌리기**. ⚠️ 다른 곳에서 풀면 '세션당 1회'가 깨지고, 반대로 해제를
  지우면 다음 접속에서 영영 공지가 안 나간다. 래치는 **발송 직전 setTimeout 안에서** 세팅한다(대상
  재확인 후 — 세션이 끝났으면 발송도 래치도 없음). 새 탭 impersonation은 콜드부팅이라 ref가 자연 초기화.
  - ⚠️ **'세션당 1회' = '성공 1건'**: 낙관적 래치만 두면 일시 장애 1회로 그 세션 공지가 영구 소실된다
    (변경 전엔 다음 편집이 재발송해 자연 복구됐다 → 회귀). `res.ok` + **본문 `success !== false`**
    (Apps Script는 거부도 200으로 답한다)를 보고 실패면 래치를 되돌려 다음 편집이 재시도하게 한다.
    되돌릴 때 **`=== finalEmail` 대상 일치 확인 필수**(늦게 온 응답이 다음 세션 래치를 지우지 않도록).
    본문 파싱 실패는 **성공으로 간주**한다(중복 발송보다 낫다).
- **⚠️ 설정 읽기 실패 세션에서는 마이그레이션 저장을 건너뛴다**(`settingsReadOk`): `loadDriveFile`은
  '파일 없음'만 `null`이고 401/5xx/네트워크 오류는 **throw**한다 → `catch{}`가 삼키면 메모리 플래그가
  기본 ON인 채로 남고, 이어지는 Apps Script 마이그레이션 저장이 파일을 통째로 교체하면서 **저장돼 있던
  '공지 OFF'를 사용자 행동 없이 ON으로 되살린다**(`noticeFlags`만 Apps Script 사본이 없어 복구 불가).
  파일이 없는 **최초 마이그레이션은 `readOk=true`**라 종전대로 저장된다. 링크·유튜브는 시트가 정본이라
  이번 회차를 걸러도 다음 로그인에서 복원된다.
- **이 공지에는 ON/OFF 토글이 없다(의도)** — 목표 비중 변경은 사용자 자산에 직접 영향이라 항상 알린다.
- **영속화 무관 지점**: `noticeFlags`는 `app_settings.json` 전용이라 `portfolioStructureKey`·
  `applyStateData`·`applyBackupData`·`saveStateRef` 스프레드와 **무관**(STATE 계열 아님). 목표 비중 래치는
  ref라 저장 대상 자체가 아니다.

### 관리자 공지 클릭 → 학습자료 열기 (⚠️ 회귀 주의 — 부분문자열·이모지 매칭 금지)

학습자료 등록 공지(`AdminNotificationModal`)와 **벨 알림이력**(`UserInfoBar`)에서 공지를
누르면 해당 자료를 연다(fileId 자료 → 앱 내 sandbox 뷰어, url 자료 → 새 탭). 알림 레코드
(`{id,targetEmail,message,type,createdAt}`)에는 자료 fileId/url 참조 필드가 없으므로(시트 스키마 고정),
**메시지에 박힌 제목으로 클라이언트에서 복원**한다(Apps Script 변경 불필요).

- **복원 규칙(`utils.ts`)**: `resolveNoticeMaterial(links, message, channel, refCreatedAt)`.
  ⚠️ **부분문자열(`includes`) 매칭 절대 금지** — `📚 ${title}가 등록되었습니다.`는 조사 '가'가 제목에
  공백 없이 붙어 '신규' 공지가 '신규가' 자료를 오매칭한다. → `parseNoticeTitle`이 **정확 템플릿 정규식**
  으로 제목 추출(`[관리자 공지] ` 접두사 허용, NFC+trim) + **정확 일치**. 동일 제목 다수면
  `refCreatedAt`(공지 발송시각) 최근접 createdAt 선택.
  ⚠️ **채널은 권위 소스로만 판정**(이모지 추정 금지): 모달=`targetEmail` 센티넬(`noticeChannelOf`),
  벨 이력=`NotificationEntry.materialChannel`(확인 시 `n.targetEmail`에서 파생해 박음). 임의 텍스트·
  수동 브로드캐스트는 템플릿 불일치 → null(클릭 불가).
- **⚠️ 채널은 `'notebook'` 하나뿐**(리포트 = 단일 URL 바로가기라 복원할 자료 목록이 없다):
  `noticeChannelOf`는 `'notebook' | null`, `parseNoticeTitle`은 `channel !== 'notebook'`이면 즉시 null.
  시트에 남은 옛 `__report__` 공지와 벨 이력의 `materialChannel:'report'` 태그는 전부 null로 떨어져
  **평문으로만 표시**된다(클릭 불가 — 의도된 graceful degradation). `verify:notice` §3이 이를 단언한다.
- **발송측과 공유(드리프트 방지)**: `notebookNoticeMessage`(utils.ts)를 `AdminPage`의 2개 발송지점이
  사용하고, `parseNoticeTitle`이 같은 템플릿을 역파싱한다. 문구 수정 시 양쪽이 같이 바뀌어야 함.
  검증: `npm run verify:notice`(조사·폐지채널·중복·NFC·접두사 케이스).
- **권한 게이트(⚠️ 필수)**: `resolveMaterial`은 **기능 게이팅된 배열**(`gatedNotebookLinks` = 관리자 또는
  `userFeatures.notebookEnabled`일 때만 채움)만 사용 — UserInfoBar에 넘기는 배열과 동일 소스.
  raw `notebookLinks`를 쓰면 권한 OFF 사용자가 옛 공지로 자료를 여는 접근 우회 발생.
- **클릭 가능 표시는 매 렌더 라이브 복원** — 자료가 늦게 로드되면 그때 활성화, 삭제됐으면 plain text로
  자연 강등(죽은 클릭/오류 토스트 반복 방지). 복원 불가 공지엔 클릭 핸들러 미부착.
- **단일 뷰어**: `StudyMaterialViewer`(App 최상위, `materialViewerLink` state, z-[1150] > LoadingOverlay
  z-1100). fetch는 Abort('cancelled') 가드 + fileId 조건부 마운트(닫기→재오픈 시 재조회). Esc 닫기.
  ⚠️ sandbox `allow-scripts allow-popups` **verbatim 유지**(allow-same-origin 절대 금지 — 학습자료 뷰어
  불변식과 동일). UserInfoBar의 옛 내장 뷰어/`openStudyMaterial`은 제거되고 `onOpenMaterial` 경유로 통합.
- **읽음 처리**: 공지에서 자료를 열면 그 공지만 `acknowledgeAdminNotices([n])`로 즉시 읽음+이력 적재
  (확인 누락 시 재알림 방지), '확인' 버튼은 나머지 일괄 처리. 동일 제목 2건이 둘 다 이력에 남도록
  `notify(...,{skipDedup:true})`로 5초 텍스트 dedup 우회(`adminNotifId`로 식별).

### 관심종목(watchlistGroups) — 헤더 ⭐ 아이콘 → 이동 가능한 비차단 팝업 (⚠️ 회귀 주의)

`AccountTabBar`의 **클라우드 상태 아이콘 우측 ⭐ Star 아이콘**(`onOpenWatchlist`, 통합·개별 뷰 항상
노출)으로 여는 관심종목 팝업(`WatchlistPopup.tsx`). 그룹별로 종목 코드를 모아 종목명·등락율·현재가·
최근 종가 미니차트를 본다. 시세 조회는 `watchlistQuote.ts`(신규)로 분리.

- **비차단·이동 가능 팝업**: `FloatingCalculator.tsx` 패턴 복제 — 단일 `position:fixed` div, **백드롭/
  오버레이 없음**(아래 앱 클릭·스크롤 통과), z **1050**(dialog 1000 < 여기 < LoadingOverlay 1100),
  타이틀 바만 드래그 핸들(window mousemove/touchmove + 뷰포트 클램프). `App.tsx` 최상위 형제로 마운트
  (`FloatingCalculator` 옆) → **뷰 전환에도 언마운트 안 됨**(닫을 때까지 유지 불변식).
- **데이터 모델**: 앱 레벨 `watchlistGroups: WatchGroup[]`(portfolio 독립, calendarMemos 동급).
  `WatchGroup = { id, name, stocks: WatchStock[], createdAt, auto? }`,
  `WatchStock = { id, code, market('kr'|'us'|'fund'), name, addedAt }`. `market`은 추가 시 `detectMarket`로
  1회 결정·저장. **시세(price/changeRate)·미니차트 시계열은 저장 안 함(메모리 전용)**, 종목명(`name`)만
  STATE 캐시(로드 직후 코드만 뜨는 깜빡임 방지). ETF/PER 캐시와 동일한 "라이브값=비영속" 정책.
- **영속화 5(+1)지점 = calendarMemos 미러**(빠짐없이 필수): `App.tsx` ① useState ② `portfolioStructureKey`
  지문 `JSON.stringify(watchlistGroups)`(⚠️ 없으면 `portfolioUpdatedAt` 미상승 → Drive 저장 스킵) ③ state
  리터럴 ④ 저장 effect deps ⑤ `applyStateData` ⑥ `applyBackupData`. PC 백업/수동 저장 4곳
  (`handleSave`·`handleDriveSave`·`handleDownloadStateFile`·`handleAppClose`)은 `{...saveStateRef.current}`
  스프레드로 자동 상속(⚠️ 손나열 금지 — calendarMemos 영속화 섹션의 STATE 저장 규칙 참조).
  **복원 sticky 규칙 동일 적용**: 백업/파일 복원은 현재 관심종목을 되돌리지 않고 보존(비어 있을 때만
  백업값 채택 — calendarMemos와 `_preserveStickyPersonalData` 공유). [[feedback_auto_commit]]
- **⚠️ 공유 `stockHistoryMap`에 절대 쓰지 말 것(핵심 불변식)**: 관심종목 시세/미니차트 이력은 **팝업
  로컬 `dailyMap`/`intradayMap`(+`quotes`/`status`)에만** 저장한다. `stockHistoryMap`은 Drive 영속 +
  `buildCloseEvalSeries`(보유종목 평가액 재계산)·`useAutoConfirmHistory` 데이터완비 가드의 권위 소스라,
  관심종목의 라이브값/fchart 수정주가를 병합하면 **보유+관심 중복 코드의 평가액이 오염되고 잘못된 값이
  영구 고정**된다(3중 리뷰 blocker).
- **미니차트 기간 토글(1일·1주·1개월·3개월·1년)**: `watchlistQuote.fetchWatchDaily`가 **~1년치 일별 종가
  [date,close][]를 코드당 1회** 받아 팝업 로컬 `dailyMap`에 저장 → 1주/1개월/3개월/1년은 `cutoffFor`
  날짜 컷오프로 **클라이언트 슬라이스(재조회 없이 즉시)**. `1일`만 `fetchWatchIntraday`(US=Yahoo 5분봉,
  KR=네이버 분봉 `api.stock.naver.com/chart/domestic/item/{code}/minute?startDateTime&endDateTime`
  → `[{localDateTime,currentPrice}]` 최근 거래일 분봉만, 펀드=없음)를 lazy 조회해 `intradayMap`에
  저장. 기간 조회는 항상 활성 그룹 종목만(전체 그룹 동시 조회 금지). 인트라데이 소스는 프록시
  (`/api/proxy` 허용 도메인)+allorigins/codetabs 폴백, 실패 시 빈 차트로 graceful degradation.
- **등락율도 기간을 따른다 — 차트·숫자·정렬·툴팁은 `viewByCode` 단일 소스 (⚠️ 회귀 주의)**:
  기간 토글은 미니차트뿐 아니라 **등락율 열**도 함께 바꾼다. 과거엔 차트만 기간을 따르고 등락율은
  시세 API의 `quotes[code].changeRate`(오늘 등락률)로 고정돼, 1개월/1년으로 바꿔도 숫자가 그대로였고
  같은 행에서 **"선은 빨강인데 숫자는 파랑"**이 났다(사용자 보고 2026-08).
  → `viewByCode`(useMemo)가 코드별 `{points, rate, from, to, live, loaded}`를 **한 번에** 만들고
  Sparkline·등락율 셀·`sortedStocks`·툴팁이 **그 한 객체만** 읽는다. **어느 소비자도 등락율을 따로
  계산하지 말 것** — 떼어내는 순간 색·숫자·정렬이 갈린다.
  - **1주~1년 = `(구간 마지막 종가 ÷ 구간 첫 종가) − 1`**, 분자·분모가 **차트가 그리는 바로 그 배열**의
    양 끝이라 Sparkline `up` 판정과 부호가 구조적으로 동일. ⚠️ 분모를 'cutoff 직전 거래일 종가'로
    바꾸지 말 것(정석 기간수익률이지만 차트 첫 점보다 하루 앞이라 경계 구간에서 색과 부호가 갈린다).
  - **1일 = `q.changeRate`(전일 종가 대비 실시간, 표준 등락률) 유지**. 차트만
    `[전일 종가, ...장중, 현재가]`로 보정한다 — 전일 종가는 **등락률과 같은 소스에서 역산**
    (`현재가 ÷ (1 + 등락률/100)`, `AdminPortal`·`LadderTradeModal` 선례)이라 시장·타임존 무관.
    ⚠️ 인트라데이가 2점 미만이면 **보정하지 않는다**(`[전일종가, 현재가]` 2점 직선이 '장중 흐름'인 척한다).
  - **Sparkline 선 색은 `rate` prop으로 칠한다**(점 비교는 rate 미제공 시 폴백) — 점 비교만 쓰면
    `rate === 0`이나 1일 탭에서 색이 숫자와 갈린다.
  - **⚠️ null 계약**: 구간 2점 미만이면 `rate = null` → `'-'`(0.00%로 단언 금지 — '변동 없음'과 구분 불가).
    `loaded = code in dailyMap`이 **'조회 중'(`'…'`)과 '데이터 부족'(`'-'`)을 가른다** → `loadDaily`는
    실패 시에도 `dailyMap[code] = null`을 심어야 한다(안 심으면 그 종목이 영영 `'…'`에 갇힌다.
    단 이미 받아 둔 데이터는 덮지 않는다 — 시장 수동보정 재조회 실패 시 기존 이력 보존).
    툴팁은 `hasDaily`까지 봐서 **조회 중 / 조회 실패 / 구간 종가 부족 3종을 뭉뚱그리지 않는다**
    (사용자가 할 일이 다르다 — 실패는 현재가 클릭으로 재조회).
  - **⚠️ `cutoffFor`는 KST 달력일에 앵커한다**: 과거엔 `new Date()`를 그대로 `toISOString()`(UTC)으로
    잘라 **KST 00:00~09:00에 컷오프가 하루 앞당겨졌다**. 차트 외관만 흔들던 시절엔 넘어갔지만
    등락율이 이 창에서 파생된 뒤로는 **같은 데이터인데 접속 시각에 따라 숫자·정렬 순서·툴팁 기준일이
    달라진다**(실측: KST 08:00과 10:00의 컷오프가 **365일 × 4기간 전부** 달랐다). 시프트도 `setUTC*`로
    해야 뷰어 로컬 타임존이 결과를 흔들지 않는다.
  - **⚠️ 현재가 셀 클릭 = 행 통째 새로고침(`refreshRow`)** — `loadQuote`만 부르던 것에서 확장.
    캐시 ref(`loadedDailyRef`/`loadedIntradayRef`)를 **먼저 비우고** 재조회한다. 등락율이 기간 시계열에서
    파생되면서 ① 일별 종가 조회만 실패한 종목(시세는 성공 → 시장 보정 버튼이 안 뜬다)의 등락율이 영영
    `'-'` ② 앱을 하루 이상 열어두면 현재가는 오늘인데 기간 등락율은 며칠 전까지만 ③ 장 전에 받은 어제
    분봉에 오늘 현재가가 붙음 — 이 셋의 **유일한 탈출구**가 됐다. `loadQuote`로 되돌리지 말 것.
  - **⚠️ 정렬 키는 `viewByCode[code].rate`** — `quotes.changeRate`로 되돌리면 보이는 숫자와 순서가 어긋난다.
  - **열 제목은 `등락율` + 아랫줄에 현재 기간**(1년 수익률을 '등락율'이라고만 쓰면 오독). 헤더·행 등락율
    셀은 **둘 다 `w-16 shrink-0`** — 헤더만 2줄이 되면 min-content가 달라져 좁은 화면에서 열이 어긋난다.
  - **기준가(`base`) = 현재가 아래 작은 줄 — 그 %의 '분모'를 화면에 노출해 사용자가 직접 검산한다**
    (사용자 요청 2026-08 "실제 등락율을 확인할 수 있어야"). 표기는 `25/08/25 · 43,050`(1주~1년, 구간 첫
    종가) / `전일 ≈ 11,249`(1일, 현재가 ÷ (1+등락률/100) 역산).
    ⚠️ **`viewByCode.base`만 읽을 것** — 화면에서 따로 계산하면 등락율과 갈린다(rate·points와 같은 단일 소스).
    ⚠️ **'정확히 N일 전 날짜의 종가'로 되돌리지 말 것** — 휴장·상장일 때문에 분모와 달라져 검산이 안 맞는다.
    실제 기준일을 그대로 노출하는 것이 그 어긋남을 알리는 방법이다.
    ⚠️ **게이트 방향성**: 기간 탭은 rate·base가 **같은 `ok` 게이트**(분모 없는 % · % 없는 분모 동시 방지).
    1일만 **단방향**(base 있으면 rate도 있음, 역은 아님) — 현재가 0 · 등락률 ≤ −100%는 역산 불가라 base만
    null이고, 거기서 `전일 ≈ 0`을 찍는 것이 더 나쁜 거짓 단언이라 null 계약이 우선한다.
    ⚠️ **기준일은 `YY/MM/DD` 전체 표기**(`fmtBaseDate`) — '1년' 탭 기준일은 작년이라 MM/DD면 올해로 오독된다.
    ⚠️ **1일 역산값은 `roundToMarket`으로 시장 표시 정밀도에 맞춘다**(국내=정수·해외/펀드=2자리) — 실수를
    그대로 넘기면 `formatNumber`(Intl 기본 소수 3자리)가 `11,248.654`를 찍는다. 공용 `fmtPrice`를 고쳐
    해결하지 말 것(현재가 등 다른 호출부 표기까지 바뀐다).
    ⚠️ **헤더·행 현재가 칸은 둘 다 `w-24 shrink-0`** — 행이 2줄이 되며 min-content가 헤더(1줄)와 달라져,
    shrink를 허용하면 좁은 화면에서 두 칸이 다른 폭으로 줄어 열이 어긋난다(등락율 `w-16 shrink-0`과 동일 근거).
    툴팁(`priceTitle`)은 `기준일 종가 → 현재가`를 밝히고 1일은 근사(≈)임을 명시한다.
  - **영속화 지점 0곳**: `viewByCode`·`rate`·`base`·`points`는 전부 매 렌더 파생값이고 `dailyMap`/`intradayMap`은
    팝업 로컬(메모리 전용)이다. `watchlistGroups` 스키마·`portfolioStructureKey`·복원 sticky 전 지점 무수정.
- **코드→시장 판정(`detectMarket`)**: 계좌 컨텍스트 없음 → 코드 포맷 사용. **6자 영숫자+숫자(005930·
  0219E0)를 `extractFundCode`의 5~7자 펀드 규칙보다 먼저 KR로 판정**(안 그러면 국내 ETF가 미래에셋 펀드로
  오분류). MA:/URL→fund, 알파벳 티커→us, 그 외 5자+→fund. 잔여 오분류는 **실패 행의 시장 수동보정
  버튼(국내/해외/펀드)**으로 보정 → 재조회. 시세는 `fetchWatchQuote`(api.ts 4개 fetcher 재사용).
- **인터랙션(PortfolioTable 복제)**: 등락율 클릭 = `window.open` 상세페이지(국내=네이버 m.stock,
  해외=야후, 펀드=미래에셋/funetf) + `recordRecent`(최근조회 기록). 현재가 클릭 = `loadQuote(s)` 단일
  재조회(teal 스피너). **notify는 z-1050 팝업에 가려지므로** 실패 피드백은 행 내부 상태점(빨간 점)으로만.
- **등락율 정렬**: 종목 **2개 이상**일 때 리스트 상단 헤더의 `등락율` 셀(빈공간 포함 셀 전체) 클릭 →
  `sortDir` 토글(원래순서→내림→오름→원래순서). **정렬 아이콘/방향표시 없음**(PortfolioTable `th` 정렬과
  동일 — 리스트 재배치가 피드백). `sortedStocks`는 뷰 전용 정렬(watchlistGroups 순서 미변경·Drive 저장
  안 함), 시세 없는 종목은 원래순서로 뒤에. 헤더 열 폭은 행과 일치.
- **순서 드래그(⚠️ 회귀 주의 — 정렬과 별개 규약)**: 행 왼쪽 그립 핸들(`GripVertical`)을 잡아 그룹 내
  종목 순서를 드래그로 조정한다. `canReorder = activeGroup && !isAutoGroup && sortDir===null &&
  activeStocks.length>=2` — **원래순서 모드에서만** 활성(정렬 중이면 보이는 순서≠저장 순서라 핸들 미노출)이고
  '최근조회' 자동 그룹은 제외. 이 게이트 덕에 **등락율 정렬은 무손실 보존**되고, `sortDir===null`일 때
  `sortedStocks===activeStocks`라 렌더 인덱스=저장 인덱스가 보장된다. Pointer Events+`setPointerCapture`
  (마우스·터치 통합, 핸들 `touch-action:none`), `computeDropIndex`는 `[data-watch-row]`(안정 높이의 내부 행
  div) rect 중점 비교로 삽입 슬롯(0..N) 산출, 드롭 표시는 **inset box-shadow**(레이아웃 무변동 → geometry
  안정, 깜빡임 없음). 커밋은 `activeGroup.stocks` 배열 재정렬(`insertAt = to>from ? to-1 : to`) 후
  `onUpdateGroups` — **no-op이면 setState 자체를 생략**. ⚠️ **순서는 `stocks` 배열 자체를 재정렬**하므로
  기존 `portfolioStructureKey` 지문(`JSON.stringify(watchlistGroups)`) 경로로 **Drive 자동 저장**된다
  (persist 지점 추가·`stockHistoryMap` 접촉 없음). **알려진 한계(의도)**: 긴 리스트에서 드래그 중 자동
  스크롤 없음(스크롤 후 재드래그 필요) — 짧은 관심목록 전제라 미도입.
- **'최근조회' 자동 그룹**: 예약 id `__recent__` + `auto:true`. 등락율 클릭 시 최근 우선·코드 dedup·20개
  상한으로 기록되며 항상 첫 칩 고정(Clock 아이콘, 이름편집/삭제 불가, 코드 입력창 대신 안내 표시).
  `watchlistGroups`에 포함돼 영속. 활성 그룹 미지정 시 첫 그룹 고정 effect로 재정렬 시 뷰 튐 방지.
- **소프트 상한**: 수동 그룹 30 / 그룹당 종목 100 / 최근조회 20. localStorage·sessionStorage 미사용
  (멀티계정 오염 방지 — 브라우저 저장소 정책).

---

### 포트폴리오 표 엑셀(.xlsx) 내보내기 — 무의존성 라이터 (⚠️ 회귀 주의)

포트폴리오 표 헤더 **맨 오른쪽 칸(수익률 옆 `+` 열)의 위쪽 아이콘**(`FileSpreadsheet`)으로 화면에
보이는 표를 그대로 엑셀 파일로 내려받는다. 파일명은 `YYMMDD_계좌명.xlsx`(예: `260827_퇴직연금 820.xlsx`).

- **⚠️ 외부 npm 의존성 0 — xlsx/exceljs/jszip을 추가하지 말 것.** `package-lock.json`이 없어 Vercel이
  매 배포마다 `npm install`을 재해석하고, 정확히 그 원인으로 프로덕션 흰 화면이 났던 이력이 있다
  (자금 흐름도 절과 동일 규약). `src/xlsxWriter.ts`가 ZIP(**STORE**, 압축 없음) + 최소 OOXML을 직접
  조립한다 — DEFLATE를 안 쓰므로 압축 라이브러리도 필요 없다.
  ⚠️ **CSV·SpreadsheetML(`.xls`)로 되돌리지 말 것** — 전자는 서식·색·열 너비가 전부 사라지고
  BOM 유무로 한글이 깨지며, 후자는 Excel이 "확장자와 형식이 다르다" 경고를 띄운다. 진짜 `.xlsx`만
  경고 없이 열린다.
- **파일 3개**: `src/xlsxWriter.ts`(범용 라이터, **import 0건**) · `src/portfolioExcel.ts`(표 → 시트
  모델) · `src/components/PortfolioTable.tsx`(버튼 + 핸들러). App은 `accountName={title}` 한 줄만 추가.
- **⚠️ 영속화 지점 0곳** — 전부 매 렌더 파생값이다. `portfolioStructureKey`·`applyStateData`·
  `applyBackupData`·저장 effect deps·`chartPrefs`·`_preserveStickyPersonalData` **전 지점 무수정**.
  두 모듈은 `localStorage`·`fetch`·`setPortfolios`를 쓰지 않는다(#G28·#G29가 단언).

**⚠️ 해외계좌 단위 함정(이 기능 최대 리스크)**
`portfolio` prop은 `totals.calcPortfolio`라 `investAmount`·`evalAmount`·`profit` **셋만** 이미 원화로
환산돼 있고(`usePortfolioData`가 fxRate를 곱한다) `currentPrice`·`purchasePrice`·`quantity`·
`depositAmount`는 **환산되지 않은 native USD**다. 따라서
① 투자금액(USD)은 반드시 `overseasInvestAmount(item)` — `item.investAmount`를 읽으면 **≈1,390배**
② 평가금액·차익의 USD는 `item.evalAmount / usdkrw`(화면 `fmtDual`과 같은 식).
해외계좌는 한 셀에 두 숫자를 넣을 수 없어 **USD 열 뒤에 `(₩)` 동반 열**을 덧붙인다(정보 손실 0).

**⚠️ Excel이 파일을 거부하는 계약들(전부 실측으로 확인)**
- `<styleSheet>` 자식 순서(numFmts→fonts→fills→borders→cellStyleXfs→cellXfs→cellStyles→dxfs→
  tableStyles)와 `<worksheet>` 자식 순서(dimension→sheetViews→sheetFormatPr→**cols**→sheetData→
  **mergeCells**)는 XSD 시퀀스라 하나만 어긋나도 "복구할 수 없는 내용"이 된다.
- **fills 인덱스 0(none)·1(gray125)은 Excel 예약**. 사용자 fill을 0/1에 넣으면 **오류 없이 조용히
  무시**되어 배경색이 통째로 사라진다 → solid fill은 2번부터.
- **존재하지 않는 스타일 인덱스는 하드 리젝트**(예약 fill 문제와 달리 조용하지 않다) → `buildSheetXml`이
  범위를 벗어난 `s`를 기본 서식으로 떨어뜨린다.
- `alignment`는 `<xf>` **자식 요소**여야 한다(속성으로 쓰면 오류 없이 정렬만 사라진다) + `apply*` 플래그는
  LibreOffice가 엄격히 본다(빠뜨리면 "Excel에선 되는데 LibreOffice에선 민무늬" 버그).
- 시트 이름은 31자 이하·비어 있지 않음·`: \ / ? * [ ]` 금지(하드 리젝트) → `sanitizeSheetName`.
- XML 1.0 불허 제어문자(U+0000–08, 0B, 0C, 0E–1F)는 **이스케이프가 아니라 제거**(`&#1;`도 불법).
- 어떤 파트에도 **BOM을 붙이지 말 것**(CSV 습관) — XML 선언이 깨진다. 한글은 그냥 UTF-8이면 된다.
- 문자열 셀은 `t="inlineStr"` — `t="s"`는 sharedStrings 인덱스라 값이 깨진다. `<t>`에는
  `xml:space="preserve"`(없으면 앞뒤 공백 소실).
- `formatCode`는 XML **속성**이라 `"₩"#,##0`의 따옴표를 `&quot;`로 이스케이프해야 한다. 통화기호를
  따옴표로 감싸지 않으면 Excel이 서식을 제멋대로 고쳐 쓴다.
- **⚠️ 병합 범위에서 덮이는 칸을 `null`로 두면 배경·테두리가 첫 칸에서 끊겨 블록이 반만 칠해진다**
  (Excel은 병합 셀 서식을 덮인 칸 각각에서 읽는다) → `spanStyled`가 같은 스타일의 빈 셀로 채운다.
  적용 5곳: 제목·기준일·예수금 라벨·D/S 비율·TOTAL 라벨.
- `URL.revokeObjectURL`을 `click()` 직후 **동기로** 부르면 일부 브라우저가 저장 전에 URL을 잃는다 →
  `setTimeout(…, 0)`. 앵커는 DOM에 붙였다 떼야 Firefox에서 동작한다.

**⚠️ 화면과 1:1을 유지하는 규약**
- **숨긴 열은 시트에서도 빠진다**(`hiddenColumns` 그대로 전달). 스크린샷 구성(구분·등락률·현재가·
  구매단가·투자비중·차익 숨김)이 그대로 재현된다.
- **행 순서는 화면 렌더 순서**(주식 → 예수금 → 펀드 → 예적금 → D/S → TOTAL). ⚠️ 저장 배열 순서
  (`handleSort`: 주식 → 펀드 → 예적금 → 예수금)와 **다르다** — 배열을 그대로 돌면 안 된다.
- **퍼센트는 분수(값/100) + `%` 서식**. 표시는 화면과 한 글자도 같으면서 Excel이 진짜 백분율로
  정렬·계산한다. ⚠️ 원시 퍼센트(3.00)에 리터럴 `"%"`를 붙이는 방식으로 되돌리지 말 것 — 셀을 더하면
  300%가 나온다. 나눗셈 잔차는 `toPrecision(12)`로 정리한다(`0.013000000000000001` 금지).
- **미입력은 0이 아니라 빈 셀**. 화면 `formatNumber`/`formatQty`/`formatFundPrice`는 `''`·null에
  **빈 문자열**을 돌려주므로(`cleanNum` 경유가 아니다) 전부 0으로 누르면 입력한 적 없는 0이 찍힌다.
- **0의 색은 행 종류마다 다르다 — 통일하지 말 것**: 본문은 `> 0 ? red : blue`(0=파랑), tfoot만
  `>= 0 ? red : blue`(0=빨강) → TOTAL 전용 서식 `pctSignedPos`/`krwSignedPos`/`usdSignedPos`.
  tfoot 비중은 화면이 문자열 `'100%'`라 소수 없는 `pctInt`를 쓴다.
- **예적금 행은 열을 용도 변경**한다(코드=연이율 / 등락률=1일 환산 / 현재가=투자기간 / 구매단가·
  보유수량=`-`). 평가금액 아래 '만기' 줄은 평가금액을 **숫자로 유지**해야 합계 검산이 되므로
  별도 **'비고' 열**로 뺀다(예적금이 있을 때만 열이 생긴다).
- **행 색상 표시(4색 사이클)도 시트 배경으로 옮긴다**(`MARK_XLSX_BG`) — 빼면 사용자가 일부러 칠해 둔
  구분이 통째로 사라진다.
- **열 라벨은 `PT_COLS` 쪽('투자비중'/'평가비중')을 쓴다** — 화면 `<th>`는 둘 다 '비중'이라
  스프레드시트에서 동명 열 두 개가 되어 구분이 불가능하다. 두 라벨 모두 앱이 이미(숨김 열 복원 칩)
  쓰는 문구다. ⚠️ `EXCEL_COLS`의 **key 집합**은 `PT_COLS`와 반드시 같아야 한다(숨김 토글이 같은 키를
  쓴다 — #G20이 단언).
- **의도된 표시 차이 2건**: 해외 음수 금액은 화면이 `$-1,234.50`(formatUSD의 문자열 결합)인데 시트는
  관례대로 `-$1,234.50`이다. 해외 예수금의 투자금액 칸은 화면이 통화기호 없는 맨 숫자인데 시트는
  열 전체가 `$` 서식이다(한 열에 두 통화 의미를 섞지 않는다).

**⚠️ 배선 규약**
- **버튼은 기존 `+`(종목 추가) th **안**에 넣는다** — 새 `<th>`를 만들면 주식·펀드·예적금 행의 `<td>`,
  tfoot 빈 `<td>`, `depositColSpan`·`totalColCount` 두 식까지 전부 고쳐야 하는 '렌더 지점 23곳' 부류가 된다.
  ⚠️ 이 표의 z-index를 올리지 말 것(sticky 종목명 th와 앱 상단바 페인트 순서 회귀).
- **파일명 날짜는 클릭 시점 `getTodayKST()`** — 이 파일의 `todayStr`은 `new Date().toISOString()`(UTC)
  파생이라 KST 00:00~09:00에 하루 밀린다. ⚠️ 그 필드는 예적금 입금일에 쓰이는 **별개의 선행 버그**이고
  src 전역에 20곳 넘게 있으므로 **여기서 함께 고치지 말 것**(영속되는 `deposits[].date`를 바꾼다).
  부수 효과로 기존 CSV 4종(UTC 날짜 파일명)과 그 시간대에 하루 차이가 나는데, 이쪽이 옳은 방향이다.
- **성공 시 `notify()` 금지**(알림 최소화 정책). 이 컴포넌트엔 `notify` prop 자체가 없다 —
  피드백은 **아이콘 1.5초 플래시**(`excelFlash`, 언마운트에서 타이머 정리)다. 카드 루트가
  `overflow-hidden`이라 absolute 팝오버는 잘리므로 `title` 속성을 쓴다.
- **lucide 아이콘은 저장소에 이미 쓰는 것만** — `FileSpreadsheet`는 `UserInfoBar`에서 이미 쓴다.
  `FileDown`/`Sheet`/`Table`은 src에 전례가 없다.
- **`SAFE_CATEGORIES`는 `PortfolioTable.tsx`와 `portfolioExcel.ts` 양쪽에 있고 문자 그대로 같아야
  한다**(D/S 배지 판정 — #G19가 단언).
- **⚠️ `portfolioExcel.ts`의 상대 import에 붙은 `.ts` 확장자를 떼지 말 것** — 검증이 **미러 없이 직접
  import**하는데, Node ESM은 확장자 없는 상대 경로를 해석하지 못해(`ERR_MODULE_NOT_FOUND`) 파트①
  54건이 통째로 죽는다. `tsconfig.app.json`에 `allowImportingTsExtensions: true`가 이미 켜져 있어
  TS·vite 어느 쪽도 문제되지 않는다. 같은 이유로 `xlsxWriter.ts`는 **import 0건**을 유지하고
  `enum`/`namespace`를 쓰지 않는다(Node 타입 스트리핑 미지원 — `erasableSyntaxOnly`도 이미 켜져 있다).

- **범위 밖(의도)**: 통합 대시보드·리밸런싱 표·분배금 표의 엑셀 내보내기, 여러 계좌 한 파일에 시트로
  묶기, 금현물 표(`KrxGoldTable`은 별도 컴포넌트라 버튼 없음), 차트 이미지 삽입, 수식(SUM) 삽입,
  별도 브라우저 창(`CardWindow`)에서의 내보내기.
- 검증: `npm run verify:excel` (직접 import #1~#54 + ZIP 되읽기 + 소스 텍스트 가드 #G1~#G29).
  ⚠️ 가드는 **선언이 아니라 사용부**를 단언하며 **변이 22종**(해외 투자금액 되돌림 · 숨김 열 필터 제거 ·
  퍼센트 원시값 · mergeCells 위치 · 예약 fill 제거 · NaN 방어 제거 · CRC 손상 · 버튼 삭제 · UTC 날짜 복귀 ·
  payload 필드 누락 · App prop 삭제 · npm 의존성 추가 · SAFE_CATEGORIES 드리프트 · 빈 셀→0 · 행 순서 ·
  `xml:space` 제거 · `.ts` 확장자 제거 · 열 삭제 · 압축방식 변경 · notify 추가 · 틀 고정 해제 ·
  행 색상 누락)으로 **실제 검출을 확인**했다. 가드를 손볼 때 같은 변이가 여전히 잡히는지 다시 확인할 것.
  ⚠️ **파트① 모듈 로드 실패를 '런타임 미지원'과 뭉뚱그려 건너뛰지 말 것** — `.ts` 확장자를 떼는 것만으로
  54건이 **조용히 사라지고도 종료코드 0**이 된다. `ERR_UNKNOWN_FILE_EXTENSION`만 skip, 나머지는 실패다.

---

### 자산검증 두 날짜 비교 → 엑셀 4블록 (⚠️ 회귀 주의)

자산 평가액 추이 표에서 날짜를 눌러 연 **자산검증 모달**(`VerifyEvalModal`) 안의 접이식 섹션
**'다른 날짜와 비교 · 엑셀'**. 모달을 연 날짜가 **기준일**(고정)이고 **비교일**만 고른다.
사용자가 손으로 만들던 시트를 그대로 재현한다 — **① 기준일 ② 비교일 ③ 증감 ④ 반사실**
(비교일 보유를 그대로 들고 있었다면 기준일에 얼마인가) 4블록 **단일 시트**.
목적(사용자 문장 2026-08): "계좌의 종목을 트레이딩하고 난 결과를 종합적으로 확인 분석".
→ **④가 이 기능의 분석적 핵심**이고, ③ TOTAL(실제)과 ④ TOTAL(반사실)의 % 두 개가 결론이다.

- **모듈 2개(둘 다 `.ts` 확장자 import 유지 — `scripts/verify-compare.mjs`가 미러 없이 직접 import)**:
  `src/evalCompare.ts`(순수 모델) · `src/evalCompareExcel.ts`(시트 빌더 + 다운로드).
  `portfolioExcel.ts`의 `StyleBag`을 **export로 승격해 공유**한다(스타일 dedupe 규칙이 갈리지 않게).
  `xlsxWriter.ts`는 **무수정**(시트 1장 고정이라 건드릴 이유가 없다).
- **영속화 지점 0곳** — 계산·엑셀·사용자 입력이 전부 매 렌더 파생값이거나 **모달 로컬 state**다
  (사용자 확정 2026-08 '이번 모달에서만'). `portfolioStructureKey`·`applyStateData`·`applyBackupData`·
  저장 effect deps·`_preserveStickyPersonalData`·별도 창 브릿지 **전 지점 무수정**, 신규 prop **0개**
  (`portfolio` 객체 하나에 분배금 맵·스냅샷이 전부 들어 있다). 그래서 **카드 별도 창(stats)에서도
  그대로 동작**한다(읽기 전용이라 `blocked(...)` 라이터를 건드리지 않는다).

**⚠️ 평가·반사실은 손산식 금지 — 같은 함수를 날짜만 바꿔 3번 부른다**
```
A = calcPortfolioEvalDetail(resolveHoldings(p, 기준일).items, …, 기준일)   // ①
B = calcPortfolioEvalDetail(resolveHoldings(p, 비교일).items, …, 비교일)   // ②
C = calcPortfolioEvalDetail(resolveHoldings(p, 비교일).items, …, 기준일)   // ④ 반사실
```
펀드 NAV 폴백·예적금 단리·예수금 환율 규약이 전부 그 함수 안에 있어서 수량×종가를 손으로 곱하면
그 규약들이 조용히 갈린다. 평가금은 **저장 `evalAmount`가 아니라 항상 재계산**이다.
예적금이 ④에서 기준일까지 이자가 더 붙는 것은 **반사실 정의상 정상**이다(그대로 들고 있었으면 붙었다).

- **⚠️ 조인 키 — 평가에 넘기기 전에 이름을 채운다(`withKeyName`)**: `calcPortfolioEvalDetail`은
  **이름이 빈 항목에 기본 이름을 대입**한다(금현물 → `'KRX 금현물'`, 예적금 → `'예적금'`). 그 detail을
  그대로 조인 키로 쓰면 원본 `stock|@`와 detail `stock|@KRX 금현물`이 어긋나 **그 행이 통째로 '보유
  없음'이 되고 값은 TOTAL에만 남는다**(행은 빈 칸인데 합계는 크다 — 게다가 `priceMissing`은 `held`
  전제라 **경고도 한 줄 안 뜬다**). 금현물 계좌는 `KrxGoldTable`에 이름·코드 입력칸이 **아예 없고**
  `handleAddSavings`도 `name:''`로 만들므로 이것이 **기본 상태**다(적대적 리뷰 실측 재현).
  ⚠️ utils의 기본값과 문자열이 같을 필요는 없다 — `item.name || 기본값`이라 **채워져 있기만 하면**
  양쪽이 같은 키를 만든다. 조인 키를 `id`로 바꾸지 말 것(스냅샷 items에는 `id`가 없다).

- **⚠️ 거래 효과 = (실제 기준일 총액 − 반사실 총액) − 순 외부현금흐름**. 순흐름을 빼지 않으면
  **입금액이 통째로 '거래 성과'로 단언**된다(예수금 행이 두 총액에 각각 그 날짜 잔액으로 들어가고
  `snapshotCompositionKey`가 `depositAmount`를 담아 입금일마다 새 스냅샷이 생기므로 **상시 경로**다 —
  CLAUDE.md 일간 지표 절이 고친 그 버그와 같은 부류). 흐름은 `externalFlowInRange(dep, dep2, 비교일,
  기준일)` 반개구간 `(비교일, 기준일]`이고 **입금은 `noPrincipal`(배당·이자) 제외, 출금은 전액**이다.
  ⚠️ 예수금 차분으로 대신하지 말 것 — 매매로 인한 정상적 현금 이동까지 지운다.
  그 사이 받은 분배금·이자와 새 자금의 운용 성과는 거래 효과에 남는다(각주로 고지).
- **⚠️ 순흐름을 빼는 것만으로는 부족하다 — '그 흐름이 실제로 반영됐는가'를 장부액으로 관측한다**
  (`flowReflected`/`bookDelta`): `DepositPanel`은 `portfolio`를 참조하지 않아 **원장 입금일과 예수금
  반영일이 어긋나는 것이 구조적 정상**이다(일간 지표 절). 그 구간에서는 ΔV가 0인데 netFlow만
  1,000만이라 `실제 − 반사실 − 순흐름`이 **−₩10,000,000이라는 가짜 손실을 확정 표기**한다(적대적 리뷰
  실측). 장부액(`bookCostOf` = 예수금 + 매입원가)은 매매로는 변하지 않고 외부 입출금으로만 변하므로,
  `bookDelta`가 흐름의 절반도 설명하지 못하면 **거래 효과를 숫자로 내지 않는다**(`tradeEffectValid=false`
  → 화면·엑셀 모두 '산출 불가' + 사유 배너). 상수는 일간 지표 절의 `MATERIAL_FLOW_RATIO`(1%)·
  `ABSORBED_RATIO`(0.5)와 **같은 값**이고, 해외·금은 `costBasisOnly: true`(원화 잔존 `investAmount` 차단),
  보유수량이 추정인 날짜는 관측이 성립하지 않아 `bookDelta = null`(→ 미반영으로 본다).
  ⚠️ `shouldHoldDailyMetrics`를 그대로 재사용하지 말 것 — 그 상수들은 **하루치 ΔV** 스케일 가정 위에
  있어 몇 주 구간에 재투입하면 무의미해진다('기간 단위' 절의 1급 계약).
- **⚠️ 종가를 못 구한 보유 행은 `0`이 아니라 `null` + `priceMissing`** — `calcPortfolioEvalDetail`은
  가격이 0이어도 detail을 push하므로(`utils.ts` 주식 분기) 그대로 쓰면 "그날 0원"을 단언하게 되고,
  ④에만 남은 매도 종목에서 그 0이 **거래 효과를 그 종목 평가액만큼 부풀린다**(전량 매도한 해외
  티커의 종가는 `useStockData`가 현재 보유 위주로 모아 실제로 비는 경로다). `priceMissing`이면
  **거래 효과를 숫자로 내지 않는다**(`tradeEffectValid=false` → 화면·엑셀 모두 '산출 불가').
  같은 이유로 `allExactCounter`(④ 전용)를 결과에 싣는다 — ①②가 둘 다 exact인데 ④만 근사인 상황이 있다.
- **⚠️ '보유 없음 = 0' / '모름 = null'을 구분한다**(`heldOr0`) — 뭉뚱그리면 **전량 매도(−전량)** 와
  **데이터 없음**이 같은 빈 칸이 되고 ③ 행 합이 TOTAL과 어긋난다. 미보유 행에도 **종가는 채운다**
  (수량 1 프로브) — "판 뒤에 주가가 어떻게 됐나"가 이 분석의 핵심이라서다. 평가금·수량은 채우지 않는다.
- **⚠️ 해외계좌는 USD 프레임으로 증감을 낸다** — `calcPortfolioEvalDetail.eval`은 **그 날짜 환율로
  원화 환산**된 값이라, 원화끼리 빼면 종목·수량이 완전히 같아도 환율만으로 `₩+10,000,000`이 찍힌다
  (CLAUDE.md '수익금은 USD − USD, 원화 환산 금지'). 모델이 `evalNative`(해외=USD)를 함께 내고
  증감·비율·거래 효과는 전부 그 프레임에서 계산한다. `(₩)` 동반 열은 **레벨 블록 ①②④에만** 두고
  **③(증감)에는 헤더를 `—`로 비운다**.
- **⚠️ 주당분배금 as-of 규칙**(`resolvePerShareAsOf`, 세전 통일):
  ① 후보 = `dividendHistory[code]` ∪ 실입금 맵 키 ② **known-at(date)** = 배당락일 ≤ date, 배당락일이
  없으면 **같은 월(MM)의 다른 연도 배당락일에서 '일(日)'을 빌려** 추정(`buildMonthExPrediction`과 같은
  규칙 — 월말 폴백만 쓰면 월중형(15일) 배당이 최대 2주 동안 **지난달 값을 '확정'이라 단언**한다),
  그것도 없으면 월말 ③ known 중 최신 회차부터 값이 나오는 첫 회차 채택(공시 주당액 > 실입금 역산)
  ④ known이 없으면 **date보다 이전 달**의 같은 월 값으로 예상(⚠️ `buildMonthPrediction`을 그대로 쓰면
  2024년 행에 2026년 공시액이 들어온다 — look-ahead) ⑤ 그래도 없으면 0(빈 셀, 사용자 입력 대기).
  - **⚠️ 국내 역산은 세액(`dividendTaxAmounts`)이 있을 때만** — `actualDividend`는 **세후**라
    세액 없이 나누면 세후를 세전이라 단언하게 된다(−15.4%). 과세이연 계좌(연금·IRP·ISA)만 예외로
    세후 = 세전. 해외 `actualDividendUsd`는 세전이라 그대로 쓴다. 수량은 `actualDividendQty`만 —
    그 날짜 보유수량으로 나누면 배당락 이후 매매가 섞인다.
  - **⚠️ 휴장일 캘린더를 쓰지 않는다**(지급일 = 배당락+2영업일 회피) — `marketHolidays`는 모달까지
    배선돼 있지 않고 **카드 별도 창(stats)은 `CARD_NEEDS`상 아예 받지 못한다** → 지급일 기준으로
    바꾸면 앱과 창의 값이 갈린다. 배당락일 기준은 캘린더가 필요 없다.
  - 아직 배당락 전인 회차는 `upcoming`으로만 노출하고 화면이 **'예상 N 적용' 칩**으로 제시한다
    (사진의 8/27 블록 165/144가 정확히 이 경로 — 한 번 누르면 ①과 ④에 함께 반영된다).
- **⚠️ 사용자 입력은 원시 문자열 draft**(예적금 `annualRate`·`editingTargetAmount` 규약) —
  onChange마다 `cleanNum`을 태우면 `0.45`의 소수점이 지워져 **45**가 된다(해외는 USD 주당액이라 소수가
  기본). 파싱은 모델이 한 번만 한다. **빈 문자열 = 자동값 유지 / `0` = '분배 없음' 명시 채택**.
  ⚠️ 저장한다면 `dividendHistory`가 아니라 신규 필드여야 한다 — 그 맵은 `mergeDividendData`가 얕은
  병합이라 **API 새로고침 한 번에 사용자 입력이 소실**되고(undo 없음) 조회값/추정값 구분도 불가능해진다.
  - **⚠️ `perShareValueOf`가 '값이 확정됐는가'의 단일 판정**(모델·엑셀 공유): `source==='manual'`이면
    **0도 확정**(= '분배 없음'), 그 외에는 `> 0`만 확정. `perShare > 0`으로만 재면 사용자가 직접 넣은
    0이 무시되고 "직접 입력하면 반영됩니다" 경고까지 뜬다(방금 입력한 사람에게).
  - **⚠️ 화면 배지는 '입력했는가'가 아니라 '모델이 채택했는가'(`info.source === 'manual'`)로 판정**한다 —
    음수·문자를 넣으면 모델은 자동값으로 되돌아가는데 배지만 '직접입력'이면 사용자는 자기 입력이
    반영된 줄 안다(시트에는 자동값이 찍힌다). 채택되지 않은 입력은 `무효 입력`으로 표시한다.
  - **⚠️ `upcoming`(다가오는 회차 힌트)은 그 날짜 기준 2개월 안으로 제한**한다(`addMonthsYm`) —
    제한이 없으면 과거 비교일 칸에 **몇 달 뒤 공시액**을 "아직 배당락 전"이라며 적용하는 버튼이 뜬다
    (as-of 4단계에서 막아 둔 look-ahead를 UI로 되살리는 셈). 칩 문구에 회차(`26-08`)를 노출한다.
- **⚠️ 비교일 후보는 `d < 기준일`로 자른다** — 모달은 추이 표의 **어느 행에서도** 열리므로 오래된 행이
  기준일인 것이 정상 경로이고, 자르지 않으면 드롭다운 최상단이 **미래 날짜**가 되어 ③의 부호가 뒤집히고
  ④가 '나중 수량 × 과거 종가'라는 존재한 적 없는 구성이 된다. 상한은 `effectiveDateKey || getTodayKST()`
  — KR 계좌는 21:00~09:00에 `effectiveDateKey`가 **null**이고 `evalSeriesDates`는 null이면 미래 컷을
  통째로 끄므로 21시 이후 찍힌 '내일' 스냅샷이 후보에 든다. 후보 0건이면 **안내만 하고 다운로드 버튼을
  그리지 않는다** — `resolveHoldings(p, '')`는 예외 대신 baseline 스냅샷을 조용히 돌려준다.
- **⚠️ 요약의 %는 '수익률'이 아니라 '평가금액 증감율(입출금 포함)'** — 총자산 레벨의 단순 비교라
  같은 두 날짜에 대해 **추이 표의 기간 수익률(TWR)과 다른 숫자**가 된다(`periodRateGapLine`이 이미
  같은 해명을 하고 있다). 순흐름이 0이 아니면 화면·엑셀이 그 사실을 배너로 고지한다.
- **⚠️ 실패 피드백은 모달 내부 인라인** — 이 모달은 `Z.dialog`(1000)이라 토스트·`ConfirmDialog`가
  구조적으로 가려지고, 성공은 알림 최소화 정책상 벨에도 남기지 않는다(아이콘·문구 1.5초 플래시 +
  언마운트 타이머 정리).
- **비교일 선택 = 달력 팝업 (사용자 요청 2026-08 — 드롭다운으로 되돌리지 말 것)**:
  옛 `<select>`는 항목이 `24/04/01 (월)`처럼 **2자리 연도**로 늘어서 있어 2년 떨어진 같은 월/일을
  실제로 잘못 골랐다(비교표가 통째로 다른 해로 계산됐다). `CustomDatePicker`를 재사용하고
  `allowedDates={compareCandidates}`로 **기록이 있는 날짜만** 고를 수 있게 한다.
  - **⚠️ 방어력의 출처를 오해하지 말 것** — 시장 계좌는 `fillNonTradingGaps`·백필 치유로 주말·
    공휴일까지 기록이 차서 **월·일 그리드의 잠금은 거의 발동하지 않는다**(실측: 매일 기록이 있는
    계좌에서 연 9/12만 잠기고 월·일은 0). 실제로 막는 것은 ① 연→월→일 **드릴다운**(연도를 명시적
    으로 클릭하게 만든다) ② 트리거·결과 요약의 **4자리 연도**(`dateLabel` — 엑셀 캡션과 같은 포매터)
    ③ **간격 경고**다. 잠금만 근거로 적지 말 것.
  - **⚠️ 경고는 '연도가 다른가'가 아니라 '간격(일)'으로 잰다** — 연도 문자열로 재면 기준일이 그 해
    첫 기록일일 때 기본 비교일이 전년 12/31이라 **사용자가 아무것도 만지지 않은 상태에서** 경고가
    뜨고, 가장 쓸모 있는 YoY 비교도 상시 경고 대상이 되어 경보가 죽는다. `compareGapDays > 366`.
    날짜 산술은 `Date.UTC`(`new Date('YYYY-MM-DD')`는 UTC 파싱이라 로컬 TZ에 따라 하루 밀린다).
  - **⚠️ 결과 요약도 4자리로** — 트리거만 고치면 잘못 고른 뒤 알아챌 유일한 화면이 종전 그대로다.
- **`CustomDatePicker` 확장 — 선택 인자 3종 + 결함 수정 5종 (사용처 6곳 공유, ⚠️ 회귀 주의)**:
  `allowedDates = null` / `zIndex = 999` / `followScroll = false` — **넘기지 않으면 종전과 동일**
  (하위호환의 축). 아래 5종은 인자와 무관하게 6곳 모두에 적용되는 **결함 수정**이다:
  - **팝업을 `document.body`로 포털** — 그러지 않으면 조상의 `overflow`·`isolate`·스태킹
    컨텍스트에 갇혀 잘리거나 페이지 콘텐츠 아래로 깔린다(표 래퍼의 `isolate`가 그 예).
    옛 네이티브 `<select>`는 브라우저 top layer라 이런 제약이 없었다.
    ⚠️ 포털이면 `ref.contains`로는 팝업 클릭이 '바깥'이라 **`popupRef`를 함께 보지 않으면 팝업을
    누르는 순간 닫힌다**. React 이벤트는 DOM이 아니라 **컴포넌트 트리**를 따라 전파되므로 아래의
    keydown 가드와 상위 모달의 `stopPropagation`은 그대로 적용된다.
  - **⚠️ 포털은 z 문제를 해결해 주지 않는다 — 호스트가 높으면 오히려 뒤집는다 (2026-08 사고)**:
    포털 **전**에는 팝업이 호스트의 **자손**이라 호스트가 만든 스태킹 컨텍스트 *안에서* 위로 떴다
    (호스트 z가 얼마든 항상 그 위). 포털 **후**에는 `document.body`의 **형제**가 되어 호스트와
    직접 z를 겨룬다 → `zIndex`가 호스트보다 낮으면 **호스트 패널이 그대로 덮어 "눌러도 아무 일도
    안 일어난다"** 가 된다. 기본값 999 < `Z.dialog`(1000)이라 **자산검증 비교일이 통째로 선택
    불가**였다(사용자 보고: "비교일 선택이 안됩니다"). → `Z.dialogPopover`(**1020**) 신설 +
    `VerifyEvalModal`이 `zIndex={Z.dialogPopover}`를 **명시적으로 넘긴다**.
    ⚠️ **`z ≥ 999`인 컨테이너 안에서 이 컴포넌트를 쓰면 `zIndex`를 반드시 그보다 크게 넘길 것.**
    ⚠️ 기본값 999를 올려 '자동으로 안전하게' 만들지 말 것 — 6곳 공유 컴포넌트의 "미전달 시 종전
    동작"(#G33) 계약이 깨진다. 계약은 **'모달 호스트가 명시한다'** 쪽이다.
    ⚠️ `dialogPopover`는 플로팅 창(계산기·관심종목·메모 달력 **1050**) **아래**가 의도다 —
    팝오버는 자기 호스트 레이어에 붙어 있어야 하고, 호스트인 모달 자체가 이미 그 창들 아래다.
    ⚠️ **"z-1050 플로팅 창에 가려지는 것을 포털이 고친다"는 옛 서술은 거짓이었다**(기본값 999는
    1050보다 낮다) — 포털의 실제 효용은 위 항목의 클리핑 탈출이다.
  - **⚠️ 포털된 팝업은 mousedown·touchstart·click **셋 다** 흡수해야 한다**: 이벤트가 React 트리를
    따라 올라가 **호스트의 닫기 핸들러가 그대로 발화**한다. 하나만 빼도 그 입력 방식에서만 조용히
    샌다 — 셋 다 실재 경로다. `VerifyEvalModal` 루트는 `onMouseDown`/`onTouchStart`로 닫으므로
    **마우스로 달력 밖을 누르면 자산검증 모달이 통째로 사라지고, 터치로는 날짜를 누르는 순간
    사라진다**. `PortfolioTable` 적립 모달 루트는 `onClick`으로 닫으므로 **달력을 닫으려다 모달째
    닫힌다**(포털 이전부터 있던 선행 결함). → 팝업 본체는 `swallow`로 셋을 삼키고, 백드롭은 셋을
    삼킨 뒤 **자기만** 닫는다. ⚠️ 백드롭을 `onClick={() => setOpen(false)}` 단독으로 되돌리지 말 것.
  - **위젯 키 입력을 `onKeyDownCapture`로 가둔다** — 열려 있는 `FloatingCalculator`의 window
    keydown이 `input|textarea|select`만 통과시켜 **`<button>`인 트리거·일자 셀은 Enter를 통째로
    빼앗긴다**(preventDefault → 버튼이 활성화되지 않고 계산기 수식만 평가된다). 옛 `<select>`는
    그 목록에 있어 보호됐다 → **전환이 만든 회귀**. `stopPropagation`은 기본 동작(Enter→click)을
    막지 않는다. ⚠️ 계산기의 가드 목록에 `button`을 추가하지 말 것(키패드 동작이 바뀐다).
  - **Escape로 닫기 + 트리거 토글 + 포커스 복원** — 옛 `<select>`는 Escape로 닫혔다. 포커스 복원은
    **키보드로 닫을 때만**(바깥 클릭까지 뺏으면 방금 누른 곳에서 포커스가 달아난다).
  - **세로 위치 보정은 실측 높이로만** — 하드코딩 높이(260)로 뒤집으면 실제로는 들어가는 자리에서도
    위로 튀어 기존 6곳의 좌표가 달라진다. `useLayoutEffect`가 `offsetHeight`를 재고, 값이 실제로
    달라질 때만 setState(무한 루프 방지).
  - **연·월 그리드의 파란 칩은 `selYear`/`selMonth`** — 종전엔 `viewYear`/`viewMonth`를 칠해 탐색만
    해도 '선택됨'으로 보이는 **거짓 표시**였다(오선택 방지가 목적인 화면에서 특히 나쁘다).
    보고 있는 값은 링으로만 표시한다.
  - **⚠️ `followScroll`은 닫지 말고 다시 붙인다** — 팝업에는 자체 스크롤 영역이 없어 그 위에서
    굴린 휠이 배경으로 체이닝되므로, 닫으면 '보면서 살짝 스크롤'하는 흔한 동작에 매번 사라진다.
    앵커가 화면 밖으로 나갔을 때만 닫는다. scroll은 버블하지 않으므로 **capture=true 필수**.
  - **⚠️ 잠금 사유는 `disabled` 버튼의 `title`이 아니라 상시 문구로** — Chromium·WebKit은 disabled
    폼 컨트롤에 마우스 이벤트를 주지 않아 툴팁이 **뜨지 않는다**(죽은 안내).
  - **⚠️ 날짜 강조(`font-bold`)는 제약이 있을 때만** — 없을 때 붙이면 기존 6곳에서 모든 날짜가
    굵어져 선택일과 구분이 흐려진다.
  - **알려진 한계(의도)**: `openPicker`의 '값이 없으면 가장 최근 허용 날짜의 달' 폴백은 현재 유일한
    `allowedDates` 호출부가 값을 항상 채워 보내 **도달하지 않는다** — 새 호출부를 붙일 때 처음
    실행되는 코드다.
- **블록별 행 집합 = ①②④ 그날 보유만 · ③ 교집합만 (사용자 확정 2026-08 — 되돌리지 말 것)**:
  과거엔 네 블록이 **같은 합집합**(`model.rows`)을 돌아, 그날 보유하지 않은 종목이 `probePrice`가
  채운 **종가 하나만** 달고 행으로 나왔다 → 자산검증 창과 행이 어긋나 대조가 불가능했다(사용자 보고).
  `emitBlock`의 `includeRow`가 유일한 판정 지점이다.
  - **⚠️ 기준은 `held`가 아니라 `present`**(모델의 신규 필드 = '그 날짜 보유 항목에 있는가').
    `held`는 '평가 detail에 들어갔는가'인데 `calcPortfolioEvalDetail`이 **수량 0 주식을 통째로
    드롭**하므로(`if (!qty || qty <= 0) return;`) false가 된다. 그 행은 자산검증 화면
    (`resolved.items` 1:1 렌더)에 '수량 0 · 평가금 ₩0'으로 **보인다** → `held`로 걸면 화면에 있는
    행이 시트 네 블록에서 전부 사라진다. `handleAddStock`이 `quantity: 0`으로 행을 만들고
    자산검증의 수량 편집이 0을 명시 허용하므로 **흔한 상태**다. 부수 효과로 `heldOr0`의
    `!held → 0` 분기가 도달 가능하게 유지된다(#G14가 죽은 단언이 되지 않는다).
  - **⚠️ `sideOf(row, 'diff')`는 `row.basis`가 아니라 `row.counter`를 돌려준다** — `includeRow`를
    `!!sideOf(row, kind)?.present` 한 줄로 통일하면 ③이 `compare.present` 기준이 되어 **신규 편입은
    사라지고 전량 매도는 남는**, 사양과 정반대가 된다(값은 `diffOf`로 계산돼 숫자가 그럴듯하게
    나오므로 조용히 통과한다). 'diff'를 반드시 앞에서 분기할 것.
  - **⚠️ ③ 집계 행 2줄(`신규 편입 (N종목)` / `전량 매도·이관 (M종목)`)은 선택이 아니라 필수**:
    ③ TOTAL은 편입·매도까지 포함한 전체 차이(`model.diffEval`·`b.investAmount − c.investAmount`·
    `model.diffRate`)인데 본문은 교집합만 그리므로, 없으면 **행 합 ≠ TOTAL**이 된다(실측: 교집합 합
    +33,762,029 vs TOTAL −90,846,821 — 부호까지 반대). 그러면 같은 TOTAL 행 안에서 분배금만
    '행이 못 받치면 비운다'(`dividendPartial` 게이트)이고 평가금액·투자금액·증감율은 '행이 못
    받쳐도 단언한다'가 되어 규약이 갈린다. 집계 행의 분배금도 **TOTAL과 같은 게이트**를 쓴다.
    서로 다른 종목의 합이라 수량·종가·구매단가·증감율·주당분배금은 채우지 않는다.
  - **⚠️ ①②④의 TOTAL은 필터와 무관하게 값이 같다** — `bump`이 `!held`면 조기 반환하고 평가금
    TOTAL은 실제 보유만 더하는 `sc.total`에서 온다(실측 확인). ③만 위 집계 행이 필요하다.
  - **⚠️ 표시 정책 고지는 `warns` 배너에 넣지 말 것** — 그 채널은 '값을 믿을 수 없다'는 신뢰도
    경고 전용(⚠ + 앰버)이라, 정상 거래에서 상시 발동하는 이 문구를 넣으면 진짜 경고가 묻힌다.
    **③ 캡션 + 각주**에만 둔다.
  - **⚠️ 각주 '빈 칸은 … 그날 보유하지 않았거나'는 거짓이 됐다**(그 행 자체가 없다) → 원인을
    '종가·주당분배금을 구하지 못했거나 입력값이 없음'으로 갱신했다. 되돌리면 사용자가 빈 칸을
    '미보유'로 읽어 진짜 원인(데이터 누락)을 놓친다.
  - **⚠️ 빈 블록**: 행 0건이면 안내 행 1줄 + **평가비중 100%를 단언하지 않는다**(그러지 않으면
    같은 빈 블록인데 ④만 `counterRate` null로 빈 칸이고 ①②만 100%가 찍히는 비대칭).
  - **모달 연동**: 기준일에만 편입한 종목의 **비교일 주당분배금 칸**은 어느 블록에도 렌더되지 않는
    **죽은 입력**이라 `psCellLive`로 비활성화하고 '미확인' 카운트에서도 뺀다(그러지 않으면 접이식
    토글의 `미확인 N`을 부풀리고 '예상 N 적용' 버튼까지 띄워 채우도록 유도한다).
    ⚠️ **'기준일' 칸은 항상 유효**하다 — ④ 반사실도 **기준일 기준** 주당분배금을 쓰므로 기준일에
    이미 매도한 종목도 그 칸이 살아 있다.
  - **알려진 한계(의도)**: ① 행 순서는 **기준일 보유 순서**라 자산검증 창의 종목 순서와 다를 수
    있다(네 블록이 같은 순서를 써야 세로로 눈이 따라간다는 기존 설계와의 맞바꿈 — 각주가 고지).
    ② 같은 코드 여러 줄·예수금 여러 행은 `joinKeyOf`로 한 줄에 합쳐지므로 화면보다 행이 적을 수
    있다(각주 고지). ③ **새로 편입한 종목의 '편입 전(비교일) 종가'는 시트 어디에도 남지 않는다**
    (전량 매도 종목의 기준일 종가는 ④가 그대로 보여 준다 — 비대칭이 의도).
    ④ 보유 중인데 그 날짜 종가를 못 구한 행은 시트가 빈 칸, 자산검증 화면은 ₩0으로 표시한다
    (기존 null 계약).
- **주당분배금 표는 접이식 — '미확인이 있을 때만' 토글을 낸다 (사용자 확정 2026-08)**: 평소에는
  손댈 일이 없어 표가 요약을 밀어냈고, `미확인` 배지가 **보유수량 미확인으로 오독**됐다(사용자 보고).
  → 기본 접힘 + `주당분배금 미확인 N ▼` 한 줄만 노출, 클릭하면 기존 표가 그대로 펼쳐진다.
  - **⚠️ 카운트와 배지는 모듈 스코프 `psBadgeOf(info, draft)` **한 함수**를 공유한다**(손복제 금지) —
    갈라지면 배지는 앰버인데 카운트가 0이라 **입력 패널이 통째로 사라진다**. 앰버 판정은
    `PS_UNRESOLVED`(`미확인`·`무효 입력`) 하나로 정의한다.
  - **⚠️ 토글 노출 조건은 `미확인 > 0 || showDiv || 입력 이력`이다 — 미확인 수만 보지 말 것**:
    마지막 미확인 칸을 채우는 순간 카운트가 0이 되어 **입력 중이던 패널이 사라지고 되돌릴 통로도
    없어진다**(칸에 `0`을 넣어 '분배 없음'을 확정하는 것이 정확히 그 경로다).
  - 펼침 상태(`showDiv`)와 입력값(`psDraft`)은 **모달 로컬** — 영속화 지점 **0곳** 유지.
  - 안내 문구에 "분배하지 않는 종목(TR·금 ETF 등)은 `0`을 넣으면 '분배 없음'으로 확정"을 명시한다
    (`perShareValueOf`가 `source==='manual'`이면 0도 확정으로 채택한다 — 유일한 해소 수단이다).
- **엑셀 규약(=`portfolioExcel`과 동일)**: 미입력·산출 불가는 **빈 셀**(0 단언 금지) / 퍼센트는
  **분수 + `%` 서식**(리터럴 `%`를 붙이면 셀을 더했을 때 300%) / 병합 칸은 같은 스타일 빈 셀로 채움 /
  본문은 `0=파랑`, TOTAL만 `0=빨강` / 파일명은 인자로 받은 KST 날짜에서 잘라낸다(`new Date()` 금지).
  ⚠️ **③ TOTAL 분배금은 한쪽이라도 `dividendPartial`이면 비운다** — 두 부분합의 차는 임의로 틀릴 수
  있어(부호까지) 행은 빈 칸인데 합계만 숫자를 단언하면 각주('빈 칸은 0이 아니다')와 정면으로 어긋난다.
  레벨 블록(①②④) TOTAL은 과소일 뿐 부호가 뒤집히지 않으므로 하한으로 남기고 배너로 고지한다.
  파일명 `{비교일YYMMDD}-{기준일YYMMDD}_{계좌명}_비교.xlsx`, 시트 1장(시트명 = 계좌명).
- **알려진 한계(의도)**: ① 기준일은 모달을 연 날짜에 고정(자유 선택 UI 없음) ② `extraDividendRows`
  (코드 없는 수동 분배금 행)는 종목 매칭 키가 없어 제외 ③ 분배금은 세전이고 세금·구간 합산(두 날짜
  사이에 실제로 받은 총액)은 미반영 ④ 거래 효과에는 그 사이 받은 분배금·이자와 새 자금의 운용 성과가
  포함된다 ⑤ ③의 증감율에는 입출금이 포함된다(배너로 고지) ⑥ 3개 이상 날짜 동시 비교·다중 시트 없음
  ⑦ 금현물·예적금에 이름을 넣지 않으면 행 이름이 `KRX 금현물`/`예적금`으로 표시된다(값은 정상)
  ⑧ 사용자 입력 주당분배금은 모달을 닫으면 사라진다(사용자 확정 '이번 모달에서만').
- 검증: `npm run verify:compare` (직접 import #1~#59 + ZIP 되읽기 + **시트 셀 값 단언 #60~#68c** + **블록별 행 필터 #75~#77e** +
  **적대적 리뷰가 실측한 결함들의 회귀 #69~#74c** + 소스 텍스트 가드 #G1~#G33m, 총 273건).
  ⚠️ 픽스처는 **사용자 실측 시트**(442,785,455 / 410,120,401 / 443,267,466 / +7.96% / +8.08% /
  거래 효과 −482,011 / 분배금 6,473,106·6,628,702)라 기대치가 하드코딩돼 있다 — **고치지 말 것**,
  새 케이스는 덮어쓰기(over)로 추가한다.
  ⚠️ **구조만 보는 단언(캡션·헤더·행 수·null 계약)은 본문 바꿔치기를 놓친다** — 적대적 리뷰 실측:
  ④ 블록을 ②로 통째로 바꿔도, 평가금액을 2배로 만들어도, ③ TOTAL을 0으로 만들어도 165건이 전부
  초록이었다. 그래서 `blocksOf`/`bodyRow`로 **실제 셀 값**(사진2 실측치)을 못 박는 #60~#68c를 뒀다.
  가드는 **선언이 아니라 사용부**를 단언하며(#G14는 `heldOr0` **사용 4지점**을 각각 본다 — 토큰
  존재만 보면 한 지점 되돌림을 놓친다) **변이 38종**
  (반사실을 비교일로 평가 · 순흐름 미차감 · 종가 미확보를 0으로 · 국내 역산 세액 무시 · look-ahead 허용 ·
  배당락일 예측 제거 · 구매단가 가중평균 제거 · 해외를 원화 프레임으로 · `tradeEffectValid` 상시 true ·
  분배금 null 계약 파괴 · 예수금 조인 키 분리 · `heldOr0` 반전 · 퍼센트 원시값 · 해외 ③ 원화 열 부활 ·
  ④ 8번 열 되돌림 · 후보 필터 제거 · 후보 상한 폴백 제거 · 입력 즉시 파싱 · 모델 재계산 · 후보 0건 처리
  제거 · `StyleBag` export 제거 · `.ts` 확장자 제거 · **④ 블록을 ②로 바꿔치기 · ③ TOTAL 0 ·
  `heldOr0` 한 지점만 되돌림 · 경고 배너 삭제 · 종가 미확보인데 거래 효과 단언 · 본문 평가금 2배 ·
  ① TOTAL 0 · TOTAL 분배금 삭제 · ④ 증감율을 비중으로 · **조인 키 이름 채우기 제거 · 흐름 흡수 판정
  무력화 · 수동 0을 모름으로 · upcoming 지평 제거 · ③ TOTAL 분배금 게이트 제거 · 모달 분배금 줄 게이트
  되돌림 · 배지를 draft 기준으로**)으로 **실제 검출을 확인**했다.
  **블록별 행 필터 변이 13종**(② 필터 해제 · 기준을 `present`→`held` · ④를 basis 기준으로 오배선 ·
  ③ 집계 행 삭제 · 빈 블록 안내 행 삭제 · `diff`를 `sideOf`로 통일해 극성 뒤집기 · ③ 캡션 고지 삭제 ·
  빈 블록 비중 100% 부활 · 집계 행 분배금 게이트 제거 · 각주 옛 문구 복귀 · 모델 `present` 제거 ·
  모달 죽은 칸 게이트 제거 · `disabled` 제거)도 **전부 검출**을 확인했다.
  **달력 전환 변이 20종**(드롭다운 복귀 · 후보 제약 제거 · 트리거/요약 2자리 연도 복귀 · 경고를
  연도 비교로 · `followScroll` 끔 · 포털 제거 · 포털 바깥클릭 판정 제거 · keydown 가드/Escape/토글
  제거 · 하드코딩 높이 복귀 · 연·월 선택표시를 view 기준으로 · 상시 안내 삭제 · `font-bold` 무조건 ·
  scroll capture 해제 · 포커스 복원 제거 · 잠긴 날짜 커밋 허용 · 하위호환 기본값 제거)도
  **20/20 검출**을 확인했다.
  **팝업 z·이벤트 흡수 변이 10종**(`zIndex` prop 제거 = 사고 재현 · `dialogPopover`를 dialog
  아래로 · 플로팅 창 위로 · picker 기본값을 dialog 위로 · 본체/백드롭의 `onTouchStart`·
  `onMouseDown`·`onClick` 흡수 개별 제거 · 백드롭 `onClick`을 옛 형태로 · 새 호출처 무단 추가 ·
  호스트 닫기 제스처 변경)도 **10/10 검출**을 확인했다(#G34~#G35c).
  ⚠️ **사각지대였던 이유를 기억할 것** — `#G33f`(포털했는가)와 `#G33`(기본값이 999인가)는 **각각
  통과**하는데 사고는 정확히 그 둘의 **관계**에서 났다. `#G34`~`#G34c`는 값이 아니라 **대소 관계**를
  잰다(`Z.dialog`가 나중에 올라가면 함께 깨져야 한다).
  ⚠️ `#G34d`(호출처 census)를 "높은 z가 있는 파일이면 zIndex 필수"로 바꾸지 말 것 — **오탐**이다.
  `IntegratedDashboard`는 `z-[1000]` 팝업과 표의 달력이 **형제**라 그 달력에는 제약이 필요 없다.
  census는 새 호스트가 생겼을 때 z를 **의식적으로 정하게** 만드는 것이 목적이다.
  ⚠️ `#G35c`는 '흡수가 필요한 이유가 실재하는가'(호스트가 그 제스처로 닫는가)를 잰다 — 호스트가
  닫기 방식을 바꾸면 위 가드들이 **죽은 단언**이 되므로 함께 알려야 한다.
  ⚠️ **백드롭 z는 팝업 z에서 파생돼야 한다**(`zIndex - 1`, `#G35d`) — 하드코딩으로 떼어 놓으면
  팝업은 호스트 위에 정상으로 보이는데 백드롭만 호스트 뒤로 떨어져 ① 바깥 클릭으로 달력만 닫기가
  죽고 ② 그 클릭을 호스트가 받아 **모달이 통째로 닫힌다**(사고가 절반만 되살아난다).
  `#G34*`는 팝업 z만 보므로 이 **결합**은 `#G35d`에서만 잡힌다.
  ⚠️ 그중 '③ 캡션 고지 삭제'는 처음에 **죽은 단언**이었다 — 같은 문장이 캡션과 각주 양쪽에 있어
  파일 전역 정규식이 각주로 통과했다. `#G30e`는 `emitBlock('diff'` ~ `emitBlock('counter'` **구간을
  잘라** 단언한다(verify:tax `#G7`과 같은 규약 — 전역 정규식으로 되돌리지 말 것).
  ⚠️ 행을 **코드로만 특정하지 말 것** — 예수금·금현물·예적금·집계 행·안내 행은 코드가 전부 빈
  문자열이라 한 블록 안에서 구분되지 않는다(`bodyRow(sheet, blk, '')`은 늘 첫 빈 코드 행만 집는다).
  `labelsOf`/`labelRow`가 종목명 셀로 특정·집합 비교한다.
  가드를 손볼 때 같은 변이가 여전히 잡히는지 다시 확인할 것.

---

### 환율 계산기 — 계산기 창 내부 '환율' 패널 (⚠️ 회귀 주의)

`FloatingCalculator` 타이틀바 **환율 토글**로 여는 통화 변환 패널. 2~3개 슬롯, **아무 칸이나 입력**
하면 그 칸이 기준(base)이 되고 나머지가 즉시 재계산된다. 데이터 계층은 `src/fxRates.ts`(신규),
소스는 **야후 단일**, **USD 피벗**(`{CUR}=X` = USD 1단위당 통화, USD는 rate=1 무조회).
검증: `npm run verify:fx` (#1~#26 — 참조 구현을 `fxRates.ts`와 **1:1 동기화**할 것).

- **⚠️ spark 배치 응답은 반드시 `result[i].symbol`로 키잉 — 인덱스 매칭 절대 금지**:
  `v7/finance/spark?symbols=...`는 **요청 순서를 보장하지 않고**(실측 5회 중 4회 불일치) 조회 실패
  심볼을 **HTTP 200 + `spark.error=null`로 조용히 드롭**한다. 인덱스로 매핑하면 KRW 칸에 JPY 환율
  (163.79)이 들어가 1,000,000원이 $685 대신 **$6,105(9배)로 오류 표시 없이** 나온다. 길이 검사
  (`result.length === wanted.length`)로 대체 금지 — 드롭은 잡아도 **재정렬은 못 잡는다**.
  `meta.symbol`도 키 금지(같은 심볼이 `KRW=X`/`USDKRW=X`로 번갈아 옴). 순수 함수
  `mapSparkQuotes(json, wanted)`로 분리해 테스트로 고정(#19~#22). 실패 판정 = **응답 Map 키 부재**
  → 그 코드만 `v8/finance/chart` 개별 폴백(심볼 1:1이라 인덱스 매칭 자체가 없음).
- **⚠️ `convertFx`/`fxChangePct`는 null 반환 계약(예외 금지)**: 로딩 중 빈 맵·부분 성공 누락은
  **정상 경로**다. 가드를 빼면 렌더 중 TypeError가 `main.tsx`의 **루트 ErrorBoundary**까지 올라가
  계산기가 아니라 **앱 화면 전체가 오류 페이지로 대체**된다(계산기는 App 최상위 형제). 2차 방어로
  `App.tsx`에서 `<ErrorBoundary label="계산기">`로 감쌌다(label = 섹션 모드 = 전체화면 대체 아님).
  변환은 **렌더 파생값**으로만 쓰고 state에 저장하지 않는다.
- **⚠️ 행별 등락률 = `(b.rate/a.rate) / (b.prevRate/a.prevRate) − 1`** — 그 행에 **표시된 금액**의
  전일 대비 변화율(금액과 부호가 항상 일치). **통화 자기 변화율(`rate/prevRate−1`)로 바꾸지 말 것**
  — base=KRW일 때 USD 행이 **항상 0.00%로 굳고** BRL 행은 −0.069%(참값 +0.938%)가 뜬다. base 행은
  정의상 0이라 **% 미표시**, `prevRate` 없으면 **`0.00%` 단언 금지·자리 생략**(`dodAbsChange` null 계약과 동일).
  (통화별 갱신시각 차이는 무해 — `{CUR}=X` 24종이 **동일 CCY 세션**을 써서 `chartPreviousClose` 기준일이 같다.)
- **⚠️ 금액 파싱은 `parseFxAmount` 단일 함수**: `parseFloat` 직접 호출 금지(blur 포맷 `1,000,000`을
  재편집하면 **1**이 된다). 통화기호 제거를 `[^\d.+-]` **전역 치환으로 하지 말 것** — `'12x34'`가
  1234로 통과한다. 기호는 **앞뒤에서만** 벗기고 가운데는 strict 정규식이 거른다. focus 시 포맷 해제
  (`plainFxAmount`), blur 시에만 포맷. 전역 paste 핸들러는 input이면 early-return하므로 **필드에
  직접 `onPaste`**를 붙여 `parsePastedNumber`를 재사용한다.
- **⚠️ base는 index가 아니라 통화 코드로 추적** — 슬롯 추가/삭제로 인덱스가 밀려도 어긋나지 않는다.
  base 승계 금액은 **표시 반올림값이 아니라 full precision**(`fxAmount`) — 칸을 오갈 때마다 값이
  깎이는 것 방지. 통화 select 변경 시 base 칸이면 **금액 유지**, 표시 중인 다른 슬롯과 겹치면 **자리 교환**.
- **⚠️ 라이브 시세는 메모리 전용**: `stockHistoryMap`/`indicatorHistoryMap`에 **절대 병합 금지**
  (평가액 재계산 권위 소스 오염 — WatchlistPopup 불변식과 동일). localStorage/sessionStorage 금지.
  해외계좌 평가의 `marketIndicators.usdkrw` 경로와도 **연결하지 않는다**. 조회 경합은 시퀀스 토큰으로
  늦은 응답을 폐기하고, 상태는 **교체가 아니라 병합**(다른 통화 캐시 보존). TTL 10분 + 수동 ⟳.
- **⚠️ `isOpen=false`는 언마운트가 아니라 렌더 스킵**(early return이 모든 훅 뒤). state·ref가 살아남으므로
  조회 트리거는 **`[isOpen, showFx, fxKey]` + TTL**로 게이팅한다.
- **⚠️ 전역 keydown 가드에 `<button>`이 없다** → 패널을 `onKeyDownCapture={e => e.stopPropagation()}`로
  감싸 내부 키 입력이 수식으로 새는 것을 막는다(가드 목록에 `button` 추가는 기존 키패드 동작을 바꾸므로 금지).
- **⚠️ 루트 `touchAction:'none'`을 드래그 핸들(타이틀 바)로 이동**: 루트는 `overflow-y-auto` 스크롤
  컨테이너라 `none`이면 패널이 늘어난 만큼을 **모바일에서 스크롤할 수 없다**. 창 위치 보정 effect deps에
  `showFx`, `fxSlots.length` 추가 필수.
- **실패 표시는 패널 내부 인라인만** — `notify()`는 토스트를 렌더하지 않고 벨 이력만 남기며, 시세 계층은
  **알림 최소화 정책상 벨에 남기지 않는다**.
- **영속화(chartPrefs 5지점)**: `fxCurrencies`(항상 3개 보존 — 3번째를 지웠다 다시 추가해도 직전 선택 복원) +
  `fxSlotCount`(2|3, 표시 개수). ① state 리터럴 ② `chartPrefsUpdatedAt` effect deps ③ STATE 저장 effect deps
  ④ `applyStateData` ⑤ `applyBackupData`. 로드 정규화 `normalizeFxCurrencies`는 **보충 → dedupe → 클램프**
  순서 필수(dedupe를 먼저 하면 보충이 만든 중복이 남는다). 환율 값·시각은 저장하지 않는다(라이브 파생값).
  **한계(기존 chartPrefs와 동일)**: 저장 effect가 `portfolios.length === 0`에서 조기 반환하므로 계좌가
  하나도 없으면 저장되지 않고, chartPrefs 단독 변경은 `saveVersionFile`을 호출하지 않아 **타 기기 즉시 반영은 안 된다**.
- **범위 밖(의도)**: 은행 고시환율/스프레드(살 때·팔 때), 환율 이력 차트, 4개 이상 통화.

### 브라질 채권 계산기 — 계산기 창 내부 '채권' 패널 (⚠️ 회귀 주의)

`FloatingCalculator` 타이틀바 **채권 토글**로 여는 브라질 국채(헤알화 표시·6개월 쿠폰·달러 경유
수령) 수익률 패널. 계산 계층은 `src/brlBond.ts`(신규, 순수 함수만), 환율은 기존 `fxRates.ts`
라이브 맵 재사용. 검증: `npm run verify:brl` (#1~#37, 참조 구현을 `brlBond.ts`와 **1:1 동기화**할 것).

- **핵심 개념(이 패널의 존재 이유)**: 표면금리는 **액면(1,000 BRL) 기준**이라 연 이자는 100 BRL로
  고정이지만, 시장금리(예 15%)에 밀려 **780 BRL에 할인 매입**하면 내 돈 기준 수익률은 100/780 =
  **12.82%(경상수익률)**다. 여기에 만기 상환차익(780→1,000)까지 넣은 것이 **YTM**.
  세 지표는 역할이 다르므로 **절대 섞지 말 것**: 표면금리(액면 기준·고정) / 경상수익률(단가 기준·
  수량 무관) / YTM(상환차익 포함·잔존만기 필요).
- **수량은 정수 좌 내림 + 잔여 표시**(액면 1,000 BRL = 1좌, 실제 매매 단위). ⚠️ **`투입 원화 +
  잔여 원화 = 투자금` 항등식**을 깨지 말 것(잔여를 버리면 원금이 새어 수익률이 부풀려진다 — 검증 #5c).
- **환율 3칸 = 매수 1 + 이자 2**(사용자 정의): 매수는 `원/헤알`(매수 시점 고정), 이자 수령은
  실제 결제 경로대로 `USD당 헤알`→`원/달러` 2단. **빈칸이면 조회시점 라이브 환율**을 쓰고, 값이
  있으면 그 값만 쓴다 — ⚠️ **무효 입력을 라이브로 조용히 대체하지 말 것**(오타를 못 알아챈다).
  라이브 소스는 `fxRates` USD 피벗(`BRL.rate`=USD당 헤알, `KRW.rate`=원/달러, 원/헤알은 `convertFx` 교차).
  매수 환율 ≠ 이자 환율이면 `원화 기준` 이자율이 경상수익률과 갈라지는 것이 **정상**(환율 효과).
- **⚠️ 환율 조회는 두 패널 '합집합' 한 번**(`needCodes`/`needKey`): 환율 패널 슬롯 + 채권용
  KRW/USD/BRL을 합쳐 조회한다. 패널별로 따로 조회하면 `fxFetchedRef.key`가 서로를 무효화해
  TTL이 깨지고 **재조회 핑퐁**이 된다. 새로고침 버튼 2개도 모두 `fxLoad(needCodes)`를 부른다.
- **⚠️ null 계약 유지**(`computeBrlBond`·`solveYtmPerPeriod`): 결측·0·음수·NaN은 예외가 아니라
  `null`(화면 '—'). throw로 바꾸면 렌더 중 TypeError가 루트 ErrorBoundary까지 올라가 **앱 화면
  전체가 오류 페이지로 대체**된다(`convertFx` 불변식과 동일. 계산기는 `<ErrorBoundary label="계산기">`
  로 2차 격리돼 있으나 1차 방어가 이 계약이다). 특히 단가 0 → 수량 Infinity, 투입금액 0 → 원화
  기준 이자율 0 나눗셈을 막는다(#28~#34).
- **⚠️ YTM 해법은 이분법**(가격이 y에 단조감소 → 발산 없음). Newton으로 바꾸지 말 것.
  `pv(0) = 쿠폰×기간 + 액면` 보다 비싼 단가는 **수익률 음수 → null**(오해 소지 있는 값 대신 안내
  문구). 잔존만기 소수는 반기 기간수 반올림. 연환산은 `반기×2`(채권등가), 실효는 `(1+반기)²−1`
  — 둘 다 표시하되 **주 표기는 연환산**.
- **⚠️ 결과 줄 클릭 삽입값은 '그 줄에 보이는 값'과 반드시 일치**: `R$ 200`을 눌렀는데 원화가
  수식에 들어가면 조용히 틀린 계산이 된다. 원화는 아랫줄(`subRaw`)을 따로 클릭 가능하게 둔다.
- **영속화 없음(의도)**: 입력값(투자금·단가·액면·표면금리·잔존만기·환율 3칸)은 **컴포넌트 메모리
  전용** — 환율 패널의 '금액'과 동일 정책. 타이핑 한 글자마다 `chartPrefsUpdatedAt`이 올라가
  Drive 저장이 폭주하는 것을 원천 차단한다. `portfolioStructureKey`·`applyStateData`·
  `applyBackupData`·저장 effect deps **전 지점 무수정**. `isOpen=false`는 언마운트가 아니라 렌더
  스킵이라 세션 중에는 입력이 유지된다.
- **⚠️ 라이브 시세는 메모리 전용**: `stockHistoryMap`/`indicatorHistoryMap`에 **병합 금지**
  (평가액 재계산 권위 소스 오염 — `fxRates.ts`·WatchlistPopup 불변식과 동일).
- **UI 제약**: 타이틀바 토글이 4개(채권·환율·DEG·함수)라 300px 폭에서 제목을 `🧮 계산기`로 줄이고
  버튼 그룹을 `shrink-0`으로 고정했다 — 토글을 더 늘리면 제목이 밀린다. 패널 높이 변경에 대비해
  위치 보정 effect deps에 **`showBond` 포함 필수**. 패널은 `onKeyDownCapture` stopPropagation으로
  내부 키 입력이 전역 수식 입력으로 새는 것을 막고, 조회 실패는 **패널 내부 인라인**으로만 알린다
  (알림 최소화 정책 — 시세 계층은 벨에 남기지 않음). 조회 전 `idle`을 실패와 구분하지 않으면
  패널을 연 첫 프레임에 "불러오지 못했습니다"가 잘못 번쩍인다.
- **범위 밖(의도)**: 경과이자(더티프라이스)·환전수수료·세금(브라질 원천세/IOF·국내 과세)·향후
  환율변동 시나리오·듀레이션/컨벡시티·중도매도 손익. 각주에 미반영을 명시한다.

## Drive 저장 위치 = `Index_Data_<email>` 폴더 단일 — 루트 저장 차단 (⚠️ 회귀 주의)

30곳이 넘는 저장 지점이 전부 `getOrCreateIndexFolder`(`driveStorage.ts`) **하나**로 모이고,
그 결과가 `driveFolderIdRef`에 박제된다(코드 어디에도 초기화가 없다). 따라서 **잘못된 folderId가
한 번 확정되면 그 탭의 모든 저장이 통째로 그리로 간다.**

- **실측 사고(2026-06-09~08-28)**: 내 드라이브 **최상위**에 `portfolio_stockdata.json` 1개 +
  백업 6개가 쓰였다(전부 `parentId`=루트). 루트 stockdata는 06-09 생성 후 **08-28까지 계속
  덮어써져** 정상 폴더와 별개의 '평행 계보'가 2.5개월간 자랐다(루트 545KB vs 폴더 828KB).
- **원인 = 2.5단계 안전망**: 전역 `portfolio_state.json` 검색 결과의 `files[0].parents[0]`을
  **검증 없이** 폴더 ID로 채택했다. 그 쿼리엔 `orderBy`도 `pageSize`도 없어 `files[0]`이 호출마다
  달라질 수 있고, parents[0]이 폴더인지·루트인지조차 보지 않았다. 1·2·3단계는 전부 폴더 검색
  결과라 **구조적으로** 루트가 될 수 없다 — 위험은 2.5단계에만 있다.
- **⚠️ 현재 가드 2겹을 제거하지 말 것**: ① 2.5단계가 후보 부모를 **전부** 훑어 `_isUsableParent`로
  '루트가 아닌 실제 폴더'만 채택(이름 일치 우선, 하나도 없으면 **던진다** = fail-closed)
  ② `saveDriveFile` 진입부 `_assertNotRootFolder` — 모든 JSON 저장이 지나는 단일 관문이라
  백업·STATE·STOCK·MARKET·관리자 캐시가 한꺼번에 보호된다. `_loadRootFolderId`는
  `_doGetOrCreateIndexFolder` 시작점에서 **세션 1회** 불러 가드를 무장한다(2.5단계 안에서만
  부르면 그 단계를 안 타는 정상 세션에서 가드가 죽는다).
- **⚠️ 조용히 넘어가지 말 것** — 가드는 반드시 `throw`. 2026-08-03 이전 무음 실패가 정확히
  '화면엔 저장됨, 실제론 유실'을 만들었다. 던져야 `saveAllToDrive`의 catch가 재시도·상태 표시를 돌린다.
- **⚠️ 잘못된 폴더로 간 파일은 스스로 돌아오지 못한다**: `files.update`(PATCH)는 본문 `parents`로
  부모를 못 바꾸고 이 저장소는 `addParents`/`removeParents`를 **한 번도 쓰지 않는다**. 그리고
  `findFileId`·`listBackups`·`cleanupOldBackups`는 첫 커밋부터 **폴더 스코프**라 폴더 밖 파일은
  앱 눈에 영영 안 보인다(= 백업이 있다고 믿는데 복원 목록엔 없다). 정리는 사용자가 Drive에서 직접.
- **⚠️ 폴더 밖 앱 파일을 폴더로 '모으지' 말 것 — 옮기기가 곧 지우기다**: `saveVersionedBackup`은
  저장 직후 무조건 `cleanupOldBackups`를 부르고, 상한(auto 6 / manual 10 / change 6) 초과분을
  `files.delete`(**휴지통 미경유 영구 삭제**)로 지운다. 폴더의 세 부류는 이미 정확히 상한에 붙어
  있으므로, 백업을 추가로 넣으면 **다음 백업 1회에 기존 백업이 밀려 영구 삭제된다**.
  동명 `portfolio_stockdata.json`을 중복 배치하는 것도 금물 — `findFileId`가 `modifiedTime desc`로
  **하나만** 집으므로 낡은 사본이 이길 수 있고, STOCK은 앱 내 백업이 0본이다.
- **⚠️ 드라이브 어디에든 `portfolio_state.json` 사본을 만들지 말 것** — 2.5단계 후보가 늘어나
  폴더 선택이 비결정적이 된다(가드가 루트는 막지만 '엉뚱한 폴더'는 이름 우선순위로만 걸러진다).
- **범위 밖(의도)**: `getOrCreateAdminFolder`는 `parents` 없이 `files.create`를 불러 **설계상**
  `Index_Data_Admin`을 루트에 만든다(관리자 전용 폴더라 무해 — 가드는 `saveDriveFile`에만 있다).
  관리자 '접속'(impersonation)이 **대상 사용자 폴더에 관리자 소유 파일**을 남기는 것도 의도된 동작이다
  (데이터는 사용자 폴더에 있고 소유자만 관리자 — 실측: 타 사용자 `Index_Data_*` 8곳에 존재).

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
- 빌드 검증: `npm run build` (에러 0개, 약 20초) — `node_modules`가 있으면 **반드시 돌린다**.
  부재한 환경에서만 아래 「검증·리뷰 규약」의 게이트로 대체
- 불필요한 주석·빈 줄 추가 금지

## 작업 흐름

1. 요구사항 불명확 → 먼저 질문 후 진행
2. grep/read로 영향 코드 전체 파악 (CLAUDE.md + memory 참조)
3. 기존 아키텍처 적합 여부 판단 → 재설계 시 CLAUDE.md 업데이트
4. 완전한 구현 (임시 코드, 하위 호환 shim 없이)
5. **게이트 검증** 통과 (아래 「검증·리뷰 규약」)
6. **자동 커밋·푸시**: 검증 끝나면 별도 확인 없이 `git add` → `git commit` (한국어, `feat(영역):`/`fix(영역):` 컨벤션) → `git push` 일괄 실행. 예외(여전히 사전 확인 필요): 파괴적 작업(force push, reset --hard, 브랜치 삭제), `--no-verify`·`--no-gpg-sign` 등 훅·서명 우회, 광범위 리팩토링이나 다수 파일 일괄 변경, main 외 보호 브랜치로의 푸시.
7. 적대적 리뷰가 필요하면 **커밋 이후** 별도 단계로 (아래)

### 검증·리뷰 규약 (⚠️ 상시 적용 — 매번 프롬프트로 지시받지 않아도 이대로 한다)

**게이트 = 결정적 검증 / 리뷰 = 보너스.** 둘의 역할을 절대 섞지 말 것.

- **게이트**(통과 못 하면 커밋 금지): 변경 영역의 `npm run verify:*`(calendar·tax·dividend·history·
  notice·twr·fx·brl·rebal-restore·transfer·overseas·flow·ladder·backtest·cal-detail·card-window·period·chart-sel·excel·compare·**ledger** **21종** 중 해당분) + `memory/tools/jsxcheck.mjs`
  (.tsx 구문) · `undefcheck.mjs`(미정의 식별자) · **`scopecheck.mjs`(스코프 누수 — 다른 최상위 블록의
  지역 변수를 참조)**. `npm run build`가 가능한 환경이면 추가로 돌린다.
  ⚠️ **세 도구는 서로를 대체하지 못한다** — `undefcheck`는 파일 전체를 한 스코프로 보므로
  "정의는 있는데 남의 스코프"를 통과시킨다(2026-08 프로덕션 `initTradeRest` 장애가 정확히 이 구멍).
  `scopecheck`는 휴리스틱이라 **오탐이 섞인다** — 대표적 오탐 2종은 ① 여러 줄 시그니처·인라인 타입의
  파라미터·필드 ② `[?]`로 표시된 이름 없는 블록. **변경한 파일의 결과만 보고 사람이 최종 판단**할 것
  (변경 파일이 0건이면 통과로 본다).
- **보너스**(없어도 커밋을 진행한다): LLM 적대적 리뷰, 탐색적 교차검토.
- ⚠️ **게이트 통과 = 즉시 커밋. 리뷰 결과를 기다리며 커밋을 보류하지 말 것.**
  백그라운드 서브에이전트는 세션에 묶여 있어 **세션이 끊기면 결과가 영영 도착하지 않는다** —
  보류하면 잃는 것은 리뷰가 아니라 커밋되지 않은 작업물이다(실제 사고: 검증 164/164 통과분이
  리뷰 대기 상태로 미커밋 방치).

**리뷰 실행 규칙** (사용자가 리뷰·검토를 요청했을 때):

- ⚠️ **시간이 아니라 범위로 제한한다** — 에이전트는 "빨리"·"5분 안에"를 지킬 수 없다.
  `이번 diff 파일만 · 다른 파일 열지 말 것 · 지적 최대 5건 · 없으면 0건(채우려고 만들지 말 것)`.
- ⚠️ **병렬 3명 이하 + 렌즈 분리.** 같은 프롬프트를 N개 돌리면 중복만 늘고 대기만 길어진다.
  ① **회귀** — CLAUDE.md의 ⚠️ 불변식을 이번 변경이 깨는가
  ② **산식** — 항등식(주머니 합·기말 예수금 분해 등)과 참조 구현 미러의 드리프트
  ③ **배선** — 영속화 지점 누락·소스 텍스트 가드 정규식이 낡았는가
- **출력 형식 고정**: `{file, line, 한 문장 요약, 재현 시나리오}`. 산문 보고서 금지.
- **부분 결과 계약**: 응답 없는 리뷰어는 이름만 적고 넘어간다. **재시도 금지.**
- 진행이 보여야 하는 큰 작업은 백그라운드 병렬 대신 **순차 실행**(관측성 우선).
- **확정 결함만 반영**하고 애매한 건 목록으로만 보고한다.

**멈춘 것처럼 보일 때**: 사용자에게는 실행 중인 에이전트를 직접 조회할 수단이 없다 —
"상태 확인"/"중단" 요청을 받으면 `TaskOutput`·`TaskStop`으로 응답한다. 세션이 바뀐 뒤라면
이전 백그라운드 결과는 이미 유실이므로 기다리지 말고 **미커밋 diff 기준으로 재개**한다.
