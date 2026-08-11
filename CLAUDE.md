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
    `investAmount`를 우선하는데, **해외 항목의 `investAmount`는 UI가 유지하지 않는 잔존 필드**다
    (`PortfolioTable` :674는 `purchasePrice×quantity`를 렌더하고 blur에 `purchasePrice`만 기록,
    `usePortfolioData` :41·:111과 통합 종목별 비중도 전부 `investAmount`를 우회). 레거시·임포트
    데이터에 **원화** `investAmount`가 남아 있으면 거기에 환율(≈1,390배)이 곱해져 장부 단위가
    3자릿수 규모로 오염되고 흡수 판정이 통째로 무너진다 → `costBasisOnly:true`로 매입가×수량(USD)만
    쓴다. `fund`·`savings`는 매입가×수량 개념이 없어 `investAmount`가 권위이므로 예외. 검증 #30b.
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

### 차트 토글은 계좌별로 독립 — 화이트리스트는 `currentChartStateRef` 하나 (⚠️ 회귀 주의)

개별 계좌 수익률 차트의 토글 5종(**비교종목 · 시장지표 · 조회기간 · 수익률 · 평가자산**)은
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
  `note:'NOTE'` · `qty:'STOCK'` · `transfer:'MOVE'` · `pick:'PICK'` · 사용자 메모 `'MEMO'`. rebalTarget이
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
- **알려진 한계(의도)**: ① 통합 '전일대비 %'가 이관일 하루만 희석된다(`(V+M)/(V_prev+M)−1` — 일간 손익
  금액·총자산은 정확, Modified Dietz 가중 규약의 결과) ② 수익률 +100% 초과 포지션은 흡수 판정(원가 vs 시가,
  50% 문턱)에서 그날이 `'-'`로 보류될 수 있다(기존 '알려진 한계 ③'과 동일 원인) ③ 이관 원장 행을
  `DepositPanel`에서 편집하면 프로라타 재계산이 `principalDeducted`를 덮어써 정합이 깨진다(`[이관]` 메모
  태그로 식별만 제공) ④ 부분 이관·해외↔국내 이관·펀드/예적금 행의 이관 버튼은 **미지원**(핸들러는 지원하나
  진입점을 주식 행에만 둠) ⑤ 원계좌 `principal`이 매입원가보다 작으면 0으로 클램프된다(데이터 이상 상황).
- 검증: `npm run verify:transfer` (참조 구현 미러 #1~#16 + 소스 텍스트 가드 #17~#29 + **'비운 계좌
  평가액 0' 배선 #30~#33**). `utils.ts`의 `buildTransferLedgerRows`·`collectTransferRows` 본문과
  **항상 1:1 동기화**할 것. #30~#33은 미러가 아니라 정규식으로 배선을 단언하므로, 실패 시 **먼저
  정규식이 낡았는지 확인**하고 계약 자체가 바뀐 게 아니면 정규식을 고칠 것.

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
- 빌드 검증: `npm run build` (에러 0개) — `node_modules` 부재로 실행 불가한 환경에서는
  아래 「검증·리뷰 규약」의 게이트로 대체
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
  notice·twr·fx·brl·rebal-restore·transfer·flow·backtest 12종 중 해당분) + `memory/tools/jsxcheck.mjs`
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
