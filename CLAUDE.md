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
├── watchlistQuote.ts    # 관심종목 코드→시장 판정(detectMarket)·시세/이력/최근 분배금 조회(api.ts 재사용)
├── watchlistChart.ts    # 관심종목 기간 구간·등락율·비교 차트 행·분배금 파서·보유 매입가(buildHoldings)·보유종목 줄(holdingWatchStocks) (⚠️ import 0 — verify:watchlist 직접 import)
├── rateMetrics.ts       # 금리 지표 계산: 현재값·1개월 변화·52주 위치·3년 백분위·꺾임 (⚠️ import 0)
├── rateSignals.ts       # 금리 판정: RATE_RULES(기준치 단일 소스) + 자산군 7개 evaluate* (⚠️ import 0)
├── rateAssets.ts        # 자산군별 종목 목록·MANUAL_INPUTS(주당 장부가/순자산)·배당률 계산 (⚠️ import 0)
├── rateSettings.ts      # ⑥ 설정 병합·범위 검사·상태 변경 기록(history) — rate_monitor_settings.json 모양 (⚠️ import 0)
├── rateBacktest.ts      # 과거 신호 검증: 날짜별 재판정·신호 추출(20거래일)·3/6/12개월 성과 (⚠️ import 0)
├── rateGlossary.ts      # 금리 창 용어 풀이(지표 33 · 자산군 7)
├── brazilNotes.ts       # 브라질 정치 메모 기본값(빈 배열) + readBrazilNotes 읽기 함수
├── dividendYear.ts      # 분배금 현황 연도 버튼(2026~작년, 최근 5개 + 드롭다운) (⚠️ import 0 — verify:dividend 직접 import)
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
    ├── DividendSummaryTable.tsx  # 분배금 현황 테이블 (compact/개별 모드) · 연도 보기(⚠️ 지난 연도는 읽기 전용 — 쓰기는 전부 whenEditable 경유, 보유 = 그 해 말일 스냅샷)
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
    ├── CashTransferModal.tsx    # 현금(예수금) 계좌 간 이관 모달(원금 반영 선택, z=1070)
    ├── CustomDatePicker.tsx      # 날짜 선택기
    ├── LoadingOverlay.tsx        # 앱 시작 블로킹 오버레이 (z-1100)
    ├── ConfirmDialog.tsx         # window.confirm() 대체 모달
    ├── LoginGate.tsx             # 로그인 / PIN 인증 게이트
    ├── WatchlistPopup.tsx        # 관심종목 이동 가능 비차단 팝업(그룹·종목·미니차트·최근조회·분배금 열) · 자동 '보유종목' 가상 그룹(저장 금지 — 정본 portfolios, 계좌마다 한 줄)
    ├── StockChartWindow.tsx      # 종목 비교 차트 별도 창(/?stockChartWindow=1) — 미니차트 클릭, App 미마운트·쓰기 0 · 보유 매입가 점선(opener에 읽기 전용 ping 하나)
    ├── FlowBoard.tsx             # 자금 흐름도 보드(z=990) — 시트 탭 바, 로컬 사본 + idle 승격, overlay/page 겸용
    ├── FlowCanvas.tsx            # 흐름도 SVG 캔버스(React.memo) — 드래그·리사이즈·연결
    ├── FlowInspector.tsx         # 흐름도 속성 패널(날짜·이름·계좌연결·금액·메모) — id 앵커 draft
    ├── FlowWindow.tsx            # 흐름도 별도 브라우저 창(/?flowWindow=1) — postMessage 브릿지
    ├── BacktestPage.tsx          # 리밸런싱 백테스트 페이지(z=1090, body 포털) — overlay/page 겸용
    ├── BacktestWindow.tsx        # 백테스트 별도 브라우저 창(/?backtestWindow=1) — postMessage 브릿지
    ├── RateWindow.tsx            # 금리 모니터링 별도 창(/?rateWindow=1) — ②보드 ③판정 ④차트 ⑤종목 ⑥설정, App 미마운트
    ├── RateSettingsPanel.tsx     # 금리 창 ⑥ 설정 패널(기준치·수동값·브라질 메모) — 저장은 앱 탭이 Drive에
    └── AdminPage.tsx             # 관리자 페이지
```

## 금리 모니터링 (`/?rateWindow=1`, ⚠️ 회귀 주의)

- **데이터 흐름**: 창은 App을 마운트하지 않는다. 현재값 `/api/indicators`·과거치 `/api/history`·종목 시세(watchlistQuote)를
  **창이 직접** 받아 창 메모리에만 둔다(브라우저 저장소·Drive·stockHistoryMap 금지) → `rateMetrics`(지표) → `rateSignals`(판정).
- **권한·쓰기**: 창 ↔ 앱 탭 postMessage(`rate:ping`·`rate:settingsLoad`·`rate:settingsSave`). 권한(rateEnabled·관리자)과
  저장 가능 여부의 정본은 앱 탭이다. 관리자 접속(impersonation) 중에는 저장하지 않는다. 앱 탭이 닫히면 설정 수정이 잠긴다.
- **판정 기준치**: `rateSignals.RATE_RULES` 한 곳(함수 안에 숫자 금지). 화면 ⑥에서 바꾼 값은 `rateSettings.mergeRules`로 덮고
  `evaluateRateSignals(…, rules)`가 쓴다. 과거 검증은 `evaluateOne(…, { rateOnly: true })` — 종목·수동값·메모 조건은 빼고 막지 않는다.
- **저장 파일**: 사용자 Index_Data 폴더의 `rate_monitor_settings.json`(DRIVE_FILES.RATE_SETTINGS) — `{ rules(바꾼 칸만), manual,
  brazilNotes, history(최근 200건), updatedAt }`. 앱 탭이 기본값 위에 **다시 병합·검증한 뒤** `saveDriveFile`로만 쓴다.
  ⚠️ `saveVersionedBackup` 금지(백업 상한 정리가 기존 백업을 영구 삭제한다).
- **벨 알림 금지**: 상태 변화는 `notify()`가 아니라 ③ 아래 '상태 변경 기록'(history)에 남긴다 — 알림 최소화 정책상 시세·판정 계층은
  벨에 남기지 않는다(창을 열 때마다 알림이 쌓이면 진짜 오류가 묻힌다). 저장 실패만 설정 패널 안 빨간 글씨.
- 검증: `verify:rate-metrics`·`verify:rate-signals`·`verify:rate-assets`·`verify:rate-settings`(전부 src 직접 import).

## 분배금 사이트 링크 공유 (관리자 → 분배금 사용자, ⚠️ 회귀 주의)

- 경로: 관리자 STATE `dividendLinks`(7칸, 정본) → Apps Script 설정 시트 키 `dividendLinks` → feature3 사용자 부팅 시 `getSettings`.
  Apps Script(`_downloads/AppsScript_계정관리_*.js`)의 `setSettings` 허용 목록·`getSettings` 응답에 이 키가 있어야 한다(재배포 필요).
- 병합 규칙(`utils.mergeSharedDividendLinks`, 사용자 확정 2026-10-29): 처음은 **빈 칸만** 채우고, 이후엔 관리자가 바꾼 칸만 덮는다.
  기준값 `dividendLinksSeen`은 사용자 STATE에 저장(payload·deps·구조 지문·applyStateData 네 곳). 공유값이 없으면(키 없음·빈 배열) 아무것도 안 바꾼다.
- ⚠️ 배포·병합 모두 `divLinksBootFor`(STATE를 정상 로드한 계정) 게이트를 지난다 — 빼면 로드 전 기본값(빈 7칸)이 모든 사용자 칸을 지운다.
  관리자 접속(impersonation) 중엔 배포도 병합도 하지 않는다. 벨 알림 없음 — 공유 상태는 링크 편집창 안 한 줄. 검증: `verify:div-links`.

## 상세 문서 위치 (⚠️ 자동 로드 금지 — 이 절이 생긴 이유: 2026-10-18 CLAUDE.md가 916KB까지 커져 모든 세션이 시작과 동시에 작업 기억 한계에 걸려 압축만 반복했다)

- `docs/claude/architecture-log.md` — 주요 아키텍처·Phase별 작업 이력 전부 (옛 「주요 아키텍처」 절, 763KB)
- `docs/claude/notebook-materials.md` — 학습자료(notebook) 상세 (옛 「학습자료」 절, 120KB)
- `WORK_LOG.md` — 일자별 작업 기록

**읽기 규칙 (모든 세션 공통)**
- 위 세 파일과 `src/App.tsx`·`src/components/BacktestPage.tsx`·`src/backtest.ts`·`scripts/verify-*.mjs` 등 100KB 넘는 파일은 **통째로 읽지 않는다.** `grep -n "<키워드>" <파일>`로 줄 번호를 찾고 그 주변 100~200줄만 `offset/limit`로 읽는다.
- 검색은 먼저 `-l`(파일 이름만) → 그다음 특정 파일에서 `-n | head -20`. 저장소 전체 `grep -rn`은 `--include` 없이 돌리지 않는다.
- 저장된 데이터·json·csv는 값을 출력하지 않는다. `wc -l`, `head -3`, `jq 'keys'`처럼 요약만 본다.
- 명령 출력은 `| head -30`으로 자른다. `find`·`wc`는 `node_modules`·`dist`·`.git`을 제외한다.
- 넓게 찾는 일은 하위 에이전트(Explore)에 맡기고 결론 20줄만 받는다.
- 이 파일(CLAUDE.md)에는 **규칙·구조·불변식만** 적는다. 작업 이력은 `WORK_LOG.md`나 `docs/claude/architecture-log.md`에 적는다. CLAUDE.md가 40KB를 넘으면 분리한다.

## 다음 작업 후보 (Phase 11~)

**가계부 재설계(2026-09-05 설계)** — 명세는 저장소 루트 `가계부_재설계_2026-09.md`.
⚠️ **단계 A(거래 원장)는 2026-09에 사용자 요청으로 데이터까지 통째로 되돌렸다** — 그 문서의 거래 관련
단계(A, 그리고 C의 이체·잔액 대조, E의 가져오기)는 **폐기**이고, 되살리려면 사용자 확인이 먼저다
(규약은 가계부 절 '거래 레이어 제거 · 변동비는 그 달만 · 보기 상태 영속화'). §13 화면 재설계는 **완료**(`6e4166e`).
남은 후보는 거래에 의존하지 않는 것들뿐이다 — 예산 진행률·다가오는 지출·월 마감·이월(B) ·
대출 상환표·순자산(D) · 목표·연도 정리(E) · 구분 2단·주간 보기(F). **한 세션에 한 단계**.

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
5. **게이트 검증** 통과 (아래 「커밋 전 체크리스트」 — `npm run gate` 한 줄)
6. **자동 커밋·푸시**: 체크리스트 7항목을 마치면 별도 확인 없이 `git add <파일 명시>` → `git commit` (한국어, `feat(영역):`/`fix(영역):` 컨벤션) → **`npm run ship`**(main 반영 + 원격 기준 확인 — `git push`를 직접 치지 않는다) 일괄 실행. 예외(여전히 사전 확인 필요): 파괴적 작업(force push, reset --hard, 브랜치 삭제), `--no-verify`·`--no-gpg-sign` 등 훅·서명 우회, 광범위 리팩토링이나 다수 파일 일괄 변경, main 외 보호 브랜치로의 푸시.
7. 적대적 리뷰가 필요하면 **커밋 이후** 별도 단계로 (아래)

### 커밋 전 체크리스트 (⚠️ 7항목 전부 — 하나도 건너뛰지 말 것)

**이 절이 생긴 이유**: 2026-09-05 커밋 `e81c277`이 `IntegratedDashboard.tsx`에 `holdReasonText(`
**사용부만** 넣고 `import`를 빠뜨린 채 배포돼 **프로덕션이 통째로 오류 화면**이 됐다
(`ReferenceError` → ErrorBoundary). `npm run build`·`undefcheck`·`scopecheck`·`verify:*` 22종이
**전부 초록**이었다. CLAUDE.md에 이미 같은 부류(`initTradeRest`) 경고가 있었는데도 재발했다 —
**"주의하라"는 문장은 대책이 아니다.** 기계가 판정하는 항목만 남긴다.

| # | 명령 / 판정 | 무엇을 막는가 |
|---|---|---|
| 1 | `npm run gate` — **전부 통과해야 함** | 게이트 선별 판단 자체의 오류. **총 14.5초**(build 6초 + verify 23종 + 정적 4종)라 고를 이유가 없다. vite가 없는 환경(클라우드)은 build를 `[SKIP] 실행 불가`로 **따로** 낸다 — 통과가 아니므로 보고에 그대로 적는다 |
| 2 | `git status --short` — 의도한 파일만 있는가? | 변이 테스트 잔재·백그라운드 에이전트가 작업 트리에 남긴 변경 (실측: 조사 에이전트가 리플레이용 결함을 주입한 채 돌던 순간이 있었다) |
| 3 | `git diff`를 **눈으로 읽는다** — 특히 "호출부는 늘었는데 import/선언 줄 변경이 없다" | 이번 장애. diff를 읽었다면 1초에 보였다 |
| 4 | `git add <파일 명시>` — **`git add -A` 금지** | 동시에 도는 에이전트·도구의 무관한 변경이 커밋에 섞이는 것 |
| 5 | `git diff --cached --stat` — 스테이지된 파일 수가 예상과 같은가? | 3·4의 마지막 확인. 예상보다 많으면 멈춘다 |
| 6 | **`npm run ship`** — 출력 마지막에 `✅ main 반영 확인 <해시>`가 **있어야** 완료 | 커밋이 main이 아닌 곳에 가는 것(2026-10-15 세 세션 연속). 푸시 명령의 성공 메시지가 아니라 **origin/main이 HEAD를 포함하는지**를 원격에서 다시 잰다. `git push`를 직접 치면 이 확인이 빠진다 |
| 7 | 푸시 후 **실제 화면 확인 요청** (배포 URL 새로고침) | 정적 게이트가 원리적으로 못 잡는 런타임 파손. 사용자에게 한 줄로 요청할 것 |

**⚠️ 작업 중 금지 사항 (전부 이번 사고의 직접 원인)**

- **`git checkout <파일>` / `git restore`로 되돌리지 말 것.** HEAD로 복원하므로 **커밋하지 않은
  그 파일의 수정이 통째로 사라진다**(실측: 단일 변이 확인 후 이 명령 한 줄로 수정 4건 소실 →
  재적용 과정에서 import 유실 → 프로덕션 장애). **변이 테스트는 커밋된 상태에서만 한다** —
  작업 트리가 더러우면 먼저 커밋하거나 stash. 되돌리기는 하네스처럼 **원본 문자열을 메모리에 들고
  다시 쓰는 방식**으로만.
- **스크립트로 소스를 패치할 때 파일 쓰기를 마지막 줄에 두지 말 것.** 중간 치환에서 예외가 나면
  **아무것도 기록되지 않는데** 앞부분은 적용된 것처럼 보인다(실측: 파이썬 재적용 스크립트가 2번째
  치환에서 AssertionError → import 추가분만 유실). 치환마다 쓰거나, 끝난 뒤 **반드시 grep으로 결과 확인**.
- **한글이 든 소스 패치는 Edit 도구로.** Git Bash 힙도큐먼트는 백슬래시뿐 아니라 **한글도 깨뜨린다**
  (실측 2026-09-05, 같은 날 두 번).
- **소스 텍스트 가드를 새로 쓸 때 '사용부 존재'만 단언하지 말 것.** 이번 장애의 가드(`verify:twr #30e`)가
  `holdReasonText(` 존재만 봐서 import 누락을 그대로 통과시켰다. 사용부를 단언하면 **그 심볼의
  import/선언도 함께** 단언하거나, `npm run verify:imports`가 덮는지 확인할 것.

**게이트 구성** (`scripts/gate.mjs`, `npm run gate`)
- **차단**: `verify:imports`(누락 import) · `build` · `verify:*` 전부
- **참고만**(차단 아님): `verify:calendar` — nager.at 라이브 교차검증이라 공휴일 드리프트로 상시 실패할
  수 있다. 차단하면 게이트가 영구 빨강이 되어 사람이 통째로 무시하게 된다.
- **외부 정적 도구**(`jsxcheck`·`undefcheck`·`scopecheck`)는 저장소 밖 `memory/tools/`에 있어 gate가
  자동 탐색하고 **못 찾으면 크게 알린다**. 다른 경로면 `CLAUDE_MEMORY_TOOLS=<디렉터리>`.

**⚠️ `scripts/importcheck.mjs` — 누락 import 전용 게이트 (2026-09-05 신설, 지우지 말 것)**
`src/**`에서 **로컬 모듈이 export한 이름을 호출하는데 그 파일에 import/선언이 없는** 경우를 잡는다.
이 부류는 다른 어떤 게이트도 구조적으로 못 잡는다 — `vite build`(esbuild)는 타입체크를 하지 않고
미정의 **전역 참조**는 빌드 오류가 아니며, `tsc`는 이 저장소가 대부분 `// @ts-nocheck`라 무력하다
(설치돼 있지도 않고 `npm install`은 금지).
- 만들자마자 clean 트리에서 **live 결함을 하나 더 찾았다**: `useStockData.commitStaged()`가
  `mergeStockMeta()`를 import 없이 호출하고 있었고(`21b3786`부터 배포 중), 그 호출이 `settleFinal()`
  첫 줄이라 `histPhase`가 `'refreshing'`에 고착 → 로딩 오버레이가 20초 폴백으로만 닫히고
  백필·자동확정이 세션 내내 차단되며 **스테이징된 과거 종가가 커밋되지 않았다**(`a586601`로 복구).
- ⚠️ **오탐 0을 유지할 것** — 오탐이 나오면 사람이 게이트를 통째로 무시한다. import 캡처는 반드시
  `\{([^}]*)\}`로 한다. `[\s\S]*?`는 백트래킹으로 **앞선 import까지 삼켜** 첫 이름이
  `import { formatCurrency` 형태로 잘린다(실측 오탐 47건의 원인).

### 검증·리뷰 규약 (⚠️ 상시 적용 — 매번 프롬프트로 지시받지 않아도 이대로 한다)

**게이트 = 결정적 검증 / 리뷰 = 보너스.** 둘의 역할을 절대 섞지 말 것.

- **게이트**(통과 못 하면 커밋 금지): **`npm run gate` 한 줄로 전부 돌린다**(위 「커밋 전 체크리스트」).
  ⚠️ **"변경 영역에 해당하는 것만" 고르지 말 것** — 고르는 판단 자체가 틀려서 2026-09-05 프로덕션
  장애가 났다. 전체가 **14.5초**라 선별할 이유가 없다. 개별 실행이 필요할 때의 목록:
  `npm run verify:*`(imports·calendar·tax·dividend·history·notice·twr·fx·brl·rebal-restore·rebal-extra·transfer·
  overseas·flow·ladder·backtest·cal-detail·card-window·period·chart-sel·excel·compare·ledger·palette·**boot**·deposit-ledger)
  + `scripts/importcheck.mjs`(누락 import) + `memory/tools/jsxcheck.mjs`
  (.tsx 구문) · `undefcheck.mjs`(미정의 식별자) · **`scopecheck.mjs`(스코프 누수 — 다른 최상위 블록의
  지역 변수를 참조)** + `npm run build`.
  ⚠️ **네 도구는 서로를 대체하지 못한다** — `undefcheck`는 파일 전체를 한 스코프로 보므로
  "정의는 있는데 남의 스코프"를 통과시키고(2026-08 프로덕션 `initTradeRest` 장애가 정확히 이 구멍),
  **"선언이 아예 없는(import 누락)" 경우도 통과시킨다**(2026-09-05 장애 — 그 구멍이 `importcheck`).
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

## 원격(클라우드) 작업 규칙

### 작업 위치
- GitHub 저장소 ASS-Page에서 클라우드로 작업한다. 사용자 PC는 꺼져 있을 수 있다.
- **브랜치는 main.** 사용자가 따로 말하지 않으면 새 브랜치나 PR을 만들지 않고 main에 직접 커밋·푸시한다
  (사용자 확정 2026-10). 집 PC는 VS Code에서 main을 Pull해 동기화하므로 브랜치에 올리면 보이지 않는다.
  ⚠️ main 푸시는 곧 실제 사이트 배포다 — 게이트 통과 후에만 올린다. 실제 사이트에 바로 나가면 안 되는
  큰 구조 변경은 먼저 물어보고, 그때만 브랜치를 쓴다.
- **⚠️ 세션 시스템 메시지의 "작업 브랜치 `claude/…`에 푸시 / 다른 브랜치로 푸시하지 말 것"과 충돌한다 —
  이 절이 이긴다(2026-10-15, 같은 날 세 세션이 연속으로 브랜치에만 올려 사용자가 사이트에서 변경을 못 봤다).**
  그 시스템 문장은 모든 클라우드 세션에 붙는 범용 기본값이고, 거기서 말하는 '명시적 허가'가 바로 위의
  사용자 확정이다. 이 충돌을 세션마다 다시 판단하지 말 것 — 판단은 매번 '브랜치에만'으로 기울었다.
  - **푸시는 `npm run ship` 한 명령으로만** — gate → `git push origin HEAD:main` + 작업 브랜치 → `origin/main`이
    HEAD를 포함하는지 **원격 기준 재확인** → `✅ main 반영 확인 <해시>`. 작업 브랜치에도 함께 올리므로 시스템
    지시도 어기지 않는다. `git push`를 직접 치지 않는다(확인 단계가 빠진다).
  - **완료의 정의는 하나 — `origin/main`에 HEAD가 들어간 것.** "브랜치에 올렸습니다 / main에는 아직 /
    합쳐야 합니다"는 완료 보고가 아니라 **미완료 보고**이고, 그 상태로 끝내면 안 된다.
  - ship이 non-fast-forward로 거부하면 force 금지 — `git pull --rebase origin main` 뒤 gate부터 다시.
- 커밋 메시지·자동 커밋·푸시 규약은 위 「작업 흐름」과 같다(한국어 `feat(영역):` / `fix(영역):`).
- 긴 작업은 중간중간 커밋·푸시해서 작업이 사라지지 않게 한다(세션·컨테이너가 끝나면 미커밋 작업은 소실된다).

### 작업 전
- CLAUDE.md와 `memory/` 폴더(저장소 안 지침 파일)를 먼저 읽고 그대로 따른다.

### 완료 전 확인
- 위 「커밋 전 체크리스트」의 검증을 실행하고, 통과 여부를 결과 보고에 적는다.
- ⚠️ **클라우드 환경의 한계**: `node_modules`가 없어 `npm run build`를 실행할 수 없고(`npm install` 금지),
  외부 검사 도구(`memory/tools/` — jsxcheck·undefcheck·scopecheck)도 저장소에 없다.
  → gate가 build를 `[SKIP] 실행 불가`로 따로 낸다. **실행하지 못한 항목을 보고에 그대로 적는다**
  ("build: 실행 불가(클라우드)"). 실행 못 한 것을 통과로 적지 않는다.
- **main 반영 확인**: `npm run ship` 출력의 `✅ main 반영 확인 <해시>` 줄이 있어야 완료다. 없으면 완료가 아니다.
- 실패하면 "완료"라고 하지 않고 무엇이 실패했는지 보고한다.
- 실제 화면을 확인하지 못했으면 "화면은 아직 확인 못 함"이라고 적는다.

### 반드시 먼저 물어볼 것
- 데이터·저장 기록 삭제, 계정 이전, 저장 구조 변경
- force push, 배포 설정 변경, 큰 구조 변경(위 「작업 흐름」 6의 예외 목록 포함)
- 사용자가 말한 조건이 애매하거나 서로 맞지 않을 때

### 필요한 것이 없을 때
- GitHub에 없는 파일(사용자 PC에만 있는 파일), 비밀 키, 접속 권한 등이 필요하면 무엇이 없는지 정확히 말하고
  멈춘다. 추측하거나 임시로 꾸며 넣지 않는다.

### 보고 방식
- 항상 한국어 높임말로, 휴대폰에서 읽기 쉽게 짧고 쉽게 쓴다.
- 순서: 결과 한 줄 → 화면별로 바뀐 점 → 사용자가 확인해야 할 것.
- 금액·비율은 실제 숫자와 %로 쓴다.
- 검증 결과에는 돌린 것·돌리지 못한 것(실행 불가)·실패한 것을 그대로 적는다.
- 마지막 두 줄은 고정: ship 출력에서 **복사한** `✅ main 반영 확인 <해시>` 줄 + "집 PC에서 VS Code 동기화(Pull) 필요".
  ⚠️ main에 들어가지 않았으면 이 두 줄 대신 **첫 줄에 "⚠️ main 미반영"**을 쓰고 이유를 적는다 — "Pull 필요"는
  main이 바뀌었다는 뜻이라, 브랜치에만 올리고 이 줄을 찍으면 사용자가 Pull해도 아무것도 안 온다.
