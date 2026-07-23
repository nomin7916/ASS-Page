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
    ├── WatchlistPopup.tsx        # 관심종목 이동 가능 비차단 팝업(그룹·종목·미니차트·최근조회)
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
  해외계좌는 장부가 USD인데 흐름 rows는 ₩ 환산이라 단위가 어긋나 **의도적으로 미공급**.
  통합은 한 계좌라도 그날 장부를 못 내면 그날 합계를 통째로 무효(`bookInvalid`)로 둔다 — 일부만 더한
  합계는 흐름과 비교할 수 없다. 현금성 계좌는 평가액=잔액=장부액이라 `cashByDate`를 그대로 더한다.
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
- **누적 TWR 곡선(`Π(1+r)−1`)은 개별 계좌 차트에 도입 완료** — 아래 전용 섹션 참조. 이 `dodChange`가
  그 곡선의 유일한 원자재다(`computeCumulativeTwrSeries`가 소비). **범위 밖(의도)**: 통합 대시보드
  차트·CAGR은 여전히 **미적용**. '원금대비'(`monthlyChange`)는 누적 지표로 **현행 유지**(입금일 희석은 정의상 정상).
- 검증: `npm run verify:twr` (명세 테스트 #1~#5 + 엣지 #6~#16 + 회귀 #17~#21c + 장부액 관측 #29~#29d).
  `scripts/verify-twr.mjs`의 참조 구현은 `utils.ts`의 `externalFlowInRange`·`dailyFlowAdjustedRate`·
  `shouldHoldDailyMetrics`(bookDelta 인자 포함)·`computeDailyMetricsSeries` 본문과 **항상 1:1로 동기화**할 것.
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
- **조회시작 0% 모드(`isZeroBaseMode`)의 라인 = 누적 TWR** (아래 전용 섹션 참조). 두 모드 모두 진짜
  수익률이고 역할만 다르다: ON=`기간 수익률`(입출금 보정, 시작 0%) / OFF=`나의 수익률`(원금대비 누적).
  `PortfolioChart`의 컴포넌트 스코프 `myReturnLabel = isZeroBaseMode ? '기간 수익률' : '나의 수익률'`
  하나로 **범례(Area name)·정보패널·계산식 검증 패널·버튼 title**을 통일한다.
  ⚠️ **`chartUtils.tsx`의 `[구간: x%]` 태그 매칭이 이 문자열을 본다** — `'기간 수익률'`은
  `selectionResult.myReturnPeriodRate`(두 끝점 TWR의 비)로, `'나의 수익률'`은
  `principalReturnRateAtEnd`(원금대비)로 갈라야 라인·정보패널과 일치한다. 라벨 변경 시 양쪽을 같이 고칠 것.
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

### 개별 계좌 차트 '조회시작 0%' = 누적 TWR (⚠️ 회귀 주의 — 평가액 비율로 되돌리지 말 것)

개별 계좌 수익률 차트의 `%` 버튼(`showReturnRate`)이 그리는 라인은 **두 모드 모두 진짜 수익률**이다.
과거엔 시계 아이콘(`isZeroBaseMode`) ON일 때 `V(t) ÷ V(조회시작) − 1`(평가액 증감률)이라 **구간 중
입금액이 분자에 통째로 들어갔다**(실측: 12.5M→106.4M이 **+747.14%**로 표시됐으나 그중 99.2M이 입금이라
실손익은 **−₩5,365,205**). OFF(원금대비)도 입금일에 분모 C가 급증해 시장 무변동인데 수익률이 절벽처럼
꺾였다 — **왜곡 없는 곡선이 하나도 없었다.**

- **지표별 역할 고정**: ON=`기간 수익률`(누적 TWR, 조회시작 0%, 입출금 보정) — "시장에서 얼마나 벌었나" /
  OFF=`나의 수익률`(원금대비 `(V−C)/C`) — "내 돈이 불었나". OFF는 요약 카드·추이 표 누적 열과 **같은 값**
  이라야 하므로(`resolveRecordPrincipal` 공유) **절대 TWR로 바꾸지 말 것**.
- **계산식**: `TWR(t) = Π(1 + r(s))` where `r` = `computeDailyMetricsSeries`의 `dodChange`(Modified Dietz).
  입금일 `r`은 이미 흐름이 제거돼 있어 **입출금 규모와 무관**. 부수 효과로 지수·비교종목 라인(0% 정규화
  가격비)과 같은 축에서 처음으로 직접 비교 가능해졌다.
- **`utils.ts` 3함수**: `computeCumulativeTwrSeries(rows)`(전체 이력 누적) / `rebaseTwr(twr, base)`(구간
  재베이스) / `overseasUsdEvalAt(items, date, map)`(해외 USD 평가 — 차트 라인과 TWR이 **공유 필수**).
  `rows` 형식·정렬은 `computeDailyMetricsSeries`와 **동일**(날짜 오름차순).
- **⚠️ `held` 행은 배율 1.0**(직전값 유지) — 일간 표시 계약(`dodAbsChange=null` → `'-'`)과 **다른 것이
  정상**이다. null로 빼면 주말마다 선이 끊기고, 보류된 흐름은 `computeDailyMetricsSeries`가 다음 행으로
  이월하므로 곱은 그대로 정확하다.
- **⚠️ 전체 이력에서 한 번 누적하고 조회구간은 나눗셈으로 재베이스**(`App.tsx` `accountTwrByDate` →
  `finalChartData`의 `twrByChartDate`/`baseTwr` → `rebaseTwr`). 구간만 잘라 체인하면 첫 행이 `held`
  (비교 대상 없음)라 경계에서 흐름 이월 상태가 끊긴다. 재베이스 방식은 조회구간을 바꿔도 곡선 모양이 불변.
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
- **영속화 무관**: `accountTwrByDate`·TWR·`myReturnPeriodRate`는 전부 매 렌더 파생값이다.
  `chartPrefs.isZeroBaseMode`는 기존 불리언 그대로 — `portfolioStructureKey`·`applyStateData`·
  `applyBackupData`·저장 effect deps **전 지점 무수정**.
- 검증: `npm run verify:twr` (#22~#28 — 흐름 0 항등·대형 입금 중립·전액 출금·held 배율 1.0·재베이스
  항등식·첫 행 0%·−100% 영구고정 방지). 참조 구현은 `utils.ts` 본문과 **항상 1:1 동기화**.
- **범위 밖(의도)**: **통합 대시보드 차트(`intIsZeroBaseMode`)는 미적용** — 같은 왜곡이 있으나 데이터
  소스가 `useIntegratedData`(계좌 편입·삭제 경계 흐름 포함)라 별도 단계로 분리. CAGR·XIRR도 미적용.

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
- **크기 & ⚠️ 세로 잘림 방지(회귀 주의)**: **달력 그리드는 기본 크기 유지** — 날짜칸 `minHeight 130px`,
  칸 내 메모 목록 `maxHeight 50px`, 창 폭 `CAL_W 920px`/`maxHeight 92vh`(**키우지 말 것** — 칸만 커지고
  빈 공간만 넓어져 한 화면에 한 달이 안 들어온다). **길게 쓰는 건 메모 패드뿐**: 달력 메모 `rows 28`,
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

### 시장동향 리포트(reportLinks) — 학습자료와 병렬인 별도 기능 (⚠️ 회귀 주의)

학습자료(notebook)와 **완전히 동일한 구조**의 두 번째 자료 채널. 관리자가 선별한 시장 동향
리포트를 올리는 용도. notebook과 **데이터·플래그·센티넬·UI를 절대 공유하지 않고 병렬 복제**한다.

- **사용자 플래그**: `userFeatures.reportEnabled` ← approved_users 시트 **J열(index 9)**.
  Apps Script `check`/`listUsers` 응답 + `setUserFeature` colMap에 `reportEnabled:9` 추가됨.
  `getFeatureLabels`는 E1:J1(6개) 읽음 → AdminPage `featureLabels` 6번째(`시장리포트`)·
  `loadFeatureSettings` 길이 가드 `=== 6`·featureDefs 6번째 토글(teal).
- **데이터**: settings 키 `reportLinks`(`{title,url?,fileId?,createdAt}[]`) — notebook과 동일 shape.
  Drive `app_settings.json`에 `youtubeUrl`/`notebookLinks`와 **함께** 저장.
  ⚠️ **app_settings 저장 경로 3곳(`handleSetYoutubeUrl`·`handleSetNotebookLinks`·`handleSetReportLinks`)
  + Apps Script 마이그레이션 저장(1곳)은 반드시 세 배열(youtubeUrl·notebookLinks·reportLinks)을
  모두 포함**해야 함 — 한 곳이라도 누락하면 다른 채널 데이터를 빈 값으로 덮어씀(상호 유실).
- **알림 센티넬**: `__report__` (notebook의 `__notebook__` 대응). `notifTargetsUser(...,notebookEnabled,
  reportEnabled)` 4번째 인자로 게이팅. 신규 등록 시 `📈 …리포트가 등록되었습니다` 발송(시장리포트 ON만 수신).
- **HTML 업로드/뷰어는 학습자료와 공용**: `handleUploadStudyMaterial`/`handleDeleteStudyMaterialFile`·
  `/api/study-material` 프록시·UserInfoBar `openStudyMaterial`(sandbox iframe) 그대로 재사용.
  업로드 폼만 AdminPage에 별도(rp* state). 상단바는 **별도 📈 TrendingUp 드롭다운**(teal, `reportOpen`).
- **Apps Script**: `_downloads/AppsScript_계정관리_arui114501.js`가 정본. 코드 교체 후 **새 버전 배포**
  필요(미배포 시 J열·reportLinks 미반영 → 프론트는 기본 OFF/빈 배열로 안전 동작). `setupSheet`는
  비파괴(기존 E~I 커스텀 헤더 보존, 빈 J1만 `시장리포트` 세팅 + E2:J100 ON/OFF 검증·기본 OFF).

### 관리자 공지 클릭 → 학습자료/리포트 열기 (⚠️ 회귀 주의 — 부분문자열·이모지 매칭 금지)

자료(학습자료/리포트) 등록 공지(`AdminNotificationModal`)와 **벨 알림이력**(`UserInfoBar`)에서 공지를
누르면 해당 자료를 연다(fileId 자료 → 앱 내 sandbox 뷰어, url 자료 → 새 탭). 알림 레코드
(`{id,targetEmail,message,type,createdAt}`)에는 자료 fileId/url 참조 필드가 없으므로(시트 스키마 고정),
**메시지에 박힌 제목으로 클라이언트에서 복원**한다(Apps Script 변경 불필요).

- **복원 규칙(`utils.ts`)**: `resolveNoticeMaterial(links, message, channel, refCreatedAt)`.
  ⚠️ **부분문자열(`includes`) 매칭 절대 금지** — `📚 ${title}가 등록되었습니다.`는 조사 '가'가 제목에
  공백 없이 붙고('신규' vs '신규가' 오매칭), 리포트는 보일러플레이트 '리포트'가 항상 들어가 다른 자료를
  오매칭한다. → `parseNoticeTitle`이 **정확 템플릿 정규식**으로 제목 추출(`[관리자 공지] ` 접두사 허용,
  NFC+trim) + **정확 일치**. 동일 제목 다수면 `refCreatedAt`(공지 발송시각) 최근접 createdAt 선택.
  ⚠️ **채널은 권위 소스로만 판정**(이모지 추정 금지): 모달=`targetEmail` 센티넬(`noticeChannelOf`),
  벨 이력=`NotificationEntry.materialChannel`(확인 시 `n.targetEmail`에서 파생해 박음). 임의 텍스트·
  수동 브로드캐스트는 템플릿 불일치 → null(클릭 불가).
- **발송측과 공유(드리프트 방지)**: `notebookNoticeMessage`/`reportNoticeMessage`(utils.ts)를
  `AdminPage`의 4개 발송지점이 사용하고, `parseNoticeTitle`이 같은 템플릿을 역파싱한다. 문구 수정 시
  양쪽이 같이 바뀌어야 함. 검증: `npm run verify:notice`(조사·보일러플레이트·중복·NFC·접두사 케이스).
- **권한 게이트(⚠️ 필수)**: `resolveMaterial`은 **기능 게이팅된 배열**(`gatedNotebookLinks`/
  `gatedReportLinks` = 관리자 또는 `userFeatures.*Enabled`일 때만 채움)만 사용 — UserInfoBar에 넘기는
  배열과 동일 소스. raw `notebookLinks`/`reportLinks`를 쓰면 권한 OFF 사용자가 옛 공지로 자료를 여는
  접근 우회 발생.
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
- **'최근조회' 자동 그룹**: 예약 id `__recent__` + `auto:true`. 등락율 클릭 시 최근 우선·코드 dedup·20개
  상한으로 기록되며 항상 첫 칩 고정(Clock 아이콘, 이름편집/삭제 불가, 코드 입력창 대신 안내 표시).
  `watchlistGroups`에 포함돼 영속. 활성 그룹 미지정 시 첫 그룹 고정 effect로 재정렬 시 뷰 튐 방지.
- **소프트 상한**: 수동 그룹 30 / 그룹당 종목 100 / 최근조회 20. localStorage·sessionStorage 미사용
  (멀티계정 오염 방지 — 브라우저 저장소 정책).

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
