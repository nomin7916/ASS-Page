# 학습자료(notebook) 상세 (CLAUDE.md에서 분리, 2026-10-18)

> 자동으로 읽히지 않습니다. 필요한 항목만 grep -n 으로 찾아 읽으십시오.

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
- **기간 직접 선택(`CUSTOM='직접'`, 2026-10 사용자 요청)**: 기간 토글 옆 `📅 기간` 버튼 → 시작일·종료일
  `CustomDatePicker` 2개. **종료일을 비우면 '현재까지'** — 구간 마지막 점을 실시간 현재가로 대체/덧붙인다
  (`viewByCode`의 `liveTail`). 시작일이 1년보다 이전이면 `loadDaily(stock, needFrom)`이 `fetchWatchDaily(…, fromDate)`로
  더 길게 다시 받는다(`dailyFromRef`가 받은 범위, `dailySeqRef`가 늦게 온 짧은 응답의 덮어쓰기 방지).
  ⚠️ 달력은 body 포털이라 `zIndex={PICKER_Z}`(1070 > 패널 1050) 필수(`verify:compare #G34d` census에 등록).
  시작·종료일은 아래 '보기 상태 저장'으로 영속된다. 시작 종가가 없으면 현재가만으로 구간을 만들지 않는다(null 계약).
- **코드→시장 판정(`detectMarket`)**: 계좌 컨텍스트 없음 → 코드 포맷 사용. **6자 영숫자+숫자(005930·
  0219E0)를 `extractFundCode`의 5~7자 펀드 규칙보다 먼저 KR로 판정**(안 그러면 국내 ETF가 미래에셋 펀드로
  오분류). MA:/URL→fund, 알파벳 티커→us, 그 외 5자+→fund. 잔여 오분류는 **실패 행의 시장 수동보정
  버튼(국내/해외/펀드)**으로 보정 → 재조회. 시세는 `fetchWatchQuote`(api.ts 4개 fetcher 재사용).
- **인터랙션(PortfolioTable 복제)**: 등락율 클릭 = `window.open` 상세페이지(국내=네이버 m.stock,
  해외=야후, 펀드=미래에셋/funetf) + `recordRecent`(최근조회 기록). 현재가 클릭 = `loadQuote(s)` 단일
  재조회(teal 스피너). **notify는 z-1050 팝업에 가려지므로** 실패 피드백은 행 내부 상태점(빨간 점)으로만.
- **등락율 정렬**: 종목 **2개 이상**일 때 리스트 상단 헤더의 `등락율` 셀(빈공간 포함 셀 전체) 클릭 →
  `sortDir` 토글(원래순서→내림→오름→원래순서). **정렬 아이콘/방향표시 없음**(PortfolioTable `th` 정렬과
  동일 — 리스트 재배치가 피드백). `sortedStocks`는 뷰 전용 정렬(**watchlistGroups 순서는 미변경** —
  정렬 **방향**만 아래 '보기 상태 저장'으로 영속), 시세 없는 종목은 원래순서로 뒤에. 헤더 열 폭은 행과 일치.
- **보기 상태 저장 = `chartPrefs.watchlistView` (2026-10 사용자 요청 — 세션 로컬로 되돌리지 말 것)**:
  `{period, customStart, customEnd, sortDir}` — 마지막으로 고른 조회 기간(직접 선택 날짜 포함)과 등락율 정렬
  방향이 팝업을 다시 열거나 앱을 새로고침해도(별도 창 포함) 그대로 돌아온다.
  - **정규화·비교의 정본 = `watchlistGroups.ts`의 `normalizeWatchView`/`sameWatchView`**(import 0 순수 모듈 —
    `verify:watchlist`가 직접 import). 기간 화이트리스트(6종) · 달력에 있는 날짜만 · 종료일<시작일이면 비움 ·
    `'직접'`인데 시작일이 없으면 기본 기간 · 정렬은 `desc|asc|null`. **기본값 = 종전 화면 기본값**('1개월' · 정렬 없음).
  - **⚠️ 팝업은 네 값을 한 객체(`patchView`)로만 바꾼다** — 개별 setState로 되돌리면 한 클릭에서 두 값을
    바꾸는 경로(📅 기간 = 시작일 채우기 + 기간 전환)에서 제어 모드의 뒤 호출이 낡은 값 위에 덮어 시작일이
    사라진다. `viewRef`로 같은 이벤트 안의 연속 호출을 동기 합성하고, 같은 값이면 아무것도 쓰지 않는다.
  - **제어/비제어**: `onViewChange`가 함수면 제어 모드(값의 정본은 호출부), 아니면 팝업 로컬. App은 관리자
    열람(`adminViewingAs`) 중에는 `null`을 넘겨 **사용자 저장값을 바꾸지 않는다**.
  - **영속화 5지점**(chartPrefs 규약): state 리터럴 · `chartPrefsUpdatedAt` deps · STATE 저장 deps ·
    `applyStateData` · `applyBackupData`. App setter는 정규화 후 **같은 값이면 같은 참조**(헛된 Drive 저장 방지).
  - **별도 창**: 앱→창 `watchlist:live`에 `view`를 싣고, 창은 **`dataState === 'ready'`인 첫 메시지에서 한 번만**
    채택한다(매번 채택하면 자기 메아리가 방금 누른 값을 되돌리고, 로드 전 기본값을 채택하면 저장값을 영영 못 받는다).
    창→앱 `watchlist:view`는 **쓰기가 열려 있을 때만** 보내고, 앱 핸들러가 impersonation을 재확인한다.
  - **알려진 한계(기존 chartPrefs와 동일)**: 계좌가 0개면 저장 effect가 조기 반환해 저장되지 않고, chartPrefs
    단독 변경은 타 기기 즉시 반영이 안 된다(다음 로드에 반영).
- **팝업 크기 조절 = 모서리·가장자리 끌기 + `chartPrefs.watchlistSize` (2026-10 사용자 요청 — 고정 폭으로 되돌리지 말 것)**:
  인앱 팝업의 **모서리 4 + 가장자리 4 손잡이**로 폴더 창처럼 폭·높이를 바꾼다. 손잡이 더블클릭 = 기본 크기
  (유일한 되돌리기 경로). 별도 창(page)은 브라우저가 창 크기를 정하므로 **손잡이도 크기 저장도 없다**.
  - **산술의 정본 = `watchlistGroups.ts`**: `resizeWatchRect`(끄는 중 사각형 — **반대편 가장자리 제자리**,
    최소 크기·화면 끝으로 묶음) · `watchSizeAfterResize`(놓을 때 **끈 축만** 저장 — 오른쪽만 끌었는데 실측 높이까지
    박으면 내용에 맞춰 자라던 높이가 고정된다) · `normalizeWatchSize`/`sameWatchSize`(각 축 `null` = 자동,
    두 축 다 자동이면 **객체가 아니라 null** — 기본 상태가 한 모양만 갖게).
  - **⚠️ 끄는 동안은 로컬(`liveRect`)만, 저장은 놓을 때 한 번**(`endResize`) — 포인터 이동마다 저장하면 프레임마다
    chartPrefs가 바뀌어 Drive 저장이 폭주한다. 화면 갱신도 `requestAnimationFrame`으로 프레임당 1회.
    **누르기만 하고 놓은 클릭은 저장하지 않는다**(`moved` 플래그 — 클릭 한 번이 '자동 높이'를 박지 않게).
  - **⚠️ 손잡이는 패널(overflow-hidden) 밖의 래퍼에 둔다** — 테두리에 걸치게(바깥 5px · 안쪽 3px). 안쪽으로만 두면
    오른쪽 손잡이가 리스트 세로 스크롤바(6px)를 덮어 스크롤바를 못 잡는다. 그래서 인앱 팝업은
    `래퍼(fixed·위치·폭) > 패널 + 손잡이 8개` 구조이고 `if (isPage) return panel;`로 별도 창은 패널만 낸다.
  - **⚠️ CSS 상한 = 계산 여백**: 래퍼 `maxWidth: calc(100vw - 20px)` / 높이 고정 시 `maxHeight: calc(100vh - 10px)`가
    `WATCH_VIEW_MARGIN_X/Y`(20/10)와 같아야 놓는 순간 크기가 튀지 않는다(가드가 관계로 단언한다).
  - **표시 폭 = `max(minW, 저장 폭)`** — `minW`는 사이드바를 펼치면 `SIDEBAR_W + 320`, 접으면 `352`. 좁게 줄여 둔 뒤
    사이드바를 펼쳐도 리스트 고정 열이 겹치지 않는다. 높이가 자동이면 종전대로 `maxHeight: 82vh`.
    열 때 재배치는 실측 높이로 **바닥이 화면 안에 들어오게** 위치를 올린다(큰 높이를 저장했을 때 아래가 잘리지 않게).
  - **영속화 5지점**(watchlistView와 같은 세트): state 리터럴 · `chartPrefsUpdatedAt` deps · STATE 저장 deps ·
    `applyStateData` · `applyBackupData`. App setter는 정규화 + 같은 값이면 같은 참조. 관리자 열람 중에는
    `onSizeChange={null}` → 팝업 로컬로만 조절(사용자 저장값 불변). 위치는 종전대로 **세션 로컬**(열 때 가운데).
  - **알려진 한계(의도)**: 크기는 기기 구분 없이 하나다(작은 화면에서는 CSS 상한이 화면 안으로 묶는다) ·
    터치 기기에서는 손잡이가 8px라 잡기 어렵다.
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
- **종목 하이라이트 = 행 왼쪽 끝 띠 클릭 (2026-10 사용자 요청 — 되돌리지 말 것)**: 칠해 둔 종목이 기간·정렬을
  바꿀 때 리스트 어디로 가는지 한눈에 찾기 위한 기능. 띠(`w-2.5`, 행의 `pl-3` 여백 안)를 누르면 칠하고 다시 누르면
  지운다. **칠할 때마다 다른 색**이고, 칠한 행은 행 전체(조회 실패 줄 포함)가 그 색으로 옅게 칠해진다.
  리스트 위 **위치 요약 칩**(색 점 · 종목명 · 정렬 중이면 `순위/종목수` · 기간 등락율)을 누르면 그 행으로 스크롤한다.
  - **저장 = 종목 항목의 `highlight`(팔레트 key)** — `watchlistGroups` **안**이라 지문(`JSON.stringify(watchlistGroups)`)·
    백업 sticky·별도 창 브릿지를 그대로 탄다(**영속화 신규 지점 0곳**). ⚠️ 앱 레벨 새 state로 빼지 말 것(가드 #G73).
  - **정본 = `watchlistGroups.ts`의 `WATCH_HIGHLIGHT_COLORS`(8색) · `watchHighlightOf` · `nextWatchHighlight` ·
    `toggleWatchHighlight` · `clearWatchHighlights`**. 팝업에서 팔레트·색 고르기를 손복제하지 말 것(#G63·#G64).
  - **⚠️ 다음 색 = 그 그룹에서 아직 안 쓴 색(팔레트 순서), 다 쓰면 가장 적게 쓴 색** — '마지막 색의 다음'으로
    되돌리면 가운데 색을 지운 뒤 새로 칠할 때 이미 쓰는 색과 겹친다(#62). 그룹마다 따로 센다.
  - **⚠️ 빨강·파랑 계열 금지** — 옆 칸 등락율이 상승=빨강/하락=파랑이라 하이라이트가 등락으로 읽힌다(#52가 색상각으로 단언).
  - **⚠️ 해제는 필드 삭제**(`highlight: null`을 남기지 않는다) · 대상이 없거나 지울 것이 없으면 **같은 참조**(헛된 Drive 저장
    방지) · 팔레트 밖 값(손상·옛 값)은 '칠하지 않음'으로 보고 누르면 정상 색으로 덮는다.
  - **⚠️ 쓰기는 `updateGroups` 단일 통로** — 읽기 전용(관리자 열람·창 연결 끊김)에서는 띠가 표시만 되고 눌리지 않는다(#G67).
  - **⚠️ 위치 요약은 `sortedStocks`(화면 순서)에서 만든다** — 저장 순서로 만들면 칩 순서가 정렬과 어긋나 '어디에 있나'가
    거짓이 된다(#G70). 순위(`N/M`)는 등락율로 정렬 중일 때만 표시한다.
  - **⚠️ `recordRecent`가 다시 본 종목의 하이라이트를 새 항목으로 옮긴다** — 안 그러면 최근조회에서 칠한 색이 등락율을
    한 번 누를 때마다 사라진다(#G72).
  - **⚠️ 헤더·행의 왼쪽 여백은 둘 다 `pl-3`** — 한쪽만 바꾸면 열이 어긋난다(#G69). 띠는 그 여백 안에만 둔다(그립·
    등락율 칸과 겹치지 않게).
  - **범위 밖(의도)**: 색 직접 고르기(누를 때마다 다음 색 — 바꾸려면 지웠다 다시 칠한다) · 같은 종목의 그룹 간 하이라이트
    공유(그룹마다 따로) · 하이라이트 종목만 보기 필터.
- **포트폴리오 표·리밸런싱 표의 행 하이라이트도 같은 규칙 (2026-10 사용자 요청)**: 옛 4색 사이클
  (노랑→슬레이트→로즈→갈색→해제)을 폐기하고 **관심종목과 같은 팔레트·같은 '다음 색' 규칙**으로 바꿨다.
  정본은 `watchlistGroups.ts`의 `rowHighlightOf` · `nextRowHighlight` · `toggleRowHighlight`(맵 `{itemId: key}` 전용).
  저장 필드는 기존 `markedPortfolioRows`/`markedRebalRows` 그대로라 **영속화 신규 지점 0곳**(지문 `markedRowsKey` 그대로).
  ⚠️ 옛 값('yellow'|'slate'|'rose'|'brown')은 **읽을 때만** 가까운 팔레트 색으로 보여 준다(저장값을 조용히 바꾸지 않는다).
  띠: 포트폴리오 표 = 맨 왼쪽 10px 칸, 리밸런싱 표 = **행의 맨 왼쪽 칸**(정렬 모드 = 구분 칸, 묶음 모드 = 구분 칸이
  rowSpan이라 그 다음 첫 고정 칸 — 등락률→수익률→종목명 중 보이는 것, `renderRow`의 `stripHost`). 칠한 행은 행 전체를 옅게(`hex+24`), 가로 스크롤 고정 칸은
  `blendWithDarkBg`로 불투명하게 칠한다(투명하면 스크롤된 칸이 비친다). 표 위 **위치 요약 칩**(표 순서 `N/M`)과 '모두 해제'.
  엑셀 `MARK_XLSX_BG`는 팔레트에서 계산한다(옛 키 포함).
- **소프트 상한**: 수동 그룹 30 / 그룹당 종목 100 / 최근조회 20. localStorage·sessionStorage 미사용
  (멀티계정 오염 방지 — 브라우저 저장소 정책).

**그룹 = 좌측 세로 사이드바 (2026-09 사용자 요청, ⚠️ 가로 스크롤 칩 행으로 되돌리지 말 것)**

옛 구조는 그룹을 **가로 스크롤 칩 한 줄**(`overflow-x-auto whitespace-nowrap`)로 늘어놓아, 그룹이
늘수록 어떤 그룹이 있는지 한눈에 안 보이고 끝 그룹은 스크롤해야 닿았다(활성 칩에만 붙던 ✏️/🗑도 그
스크롤을 따라다녔다). 세로 목록은 30개(`MAX_GROUPS`)까지 자연스러운 세로 스크롤로 받아낸다.

- **⚠️ `PANEL_W = 640 + SIDEBAR_W`는 한 세트다.** 640은 "긴 국내 ETF명 한 줄 표시"를 위해 계산된
  값(고정 열 ≈330px + 종목명 ≈310px)이라, 폭을 안 늘리고 사이드바만 넣으면 종목명이 그만큼
  쪼그라들어 그 640px의 존재 이유가 통째로 무너진다. `SIDEBAR_W`는 그립 14 + 종목 수 배지 +
  ✏️/🗑을 넣고도 그룹명 ≈100px가 남는 값(180)이다.
- **✏️/🗑은 행 hover**(활성 칩 전용에서 전환), 종목 수 배지, 삭제 확인에 **그룹명 표시**.
- **사이드바 접기**(`sidebarOpen`)는 세션 로컬 — **Drive 저장 지점 0곳**(뷰 선호도이고 클릭 한
  번으로 복구된다). ⚠️ 접힌 상태의 **펼치기 버튼은 유일한 복귀 경로**라 반드시 렌더할 것.
  ⚠️ 접으면 어느 그룹을 보고 있는지 화면에서 사라지므로 **제목에 활성 그룹명을 병기**한다.
  ⚠️ 빈 상태의 '그룹 추가' 버튼은 `setSidebarOpen(true)`를 함께 부른다 — 이름 입력창이 사이드바
  안에 있어, 접힌 채로 두면 눌러도 아무 일도 안 일어난 것처럼 보인다.

**그룹 순서 드래그 (수동 그룹 전용 · 최근조회 자리 고정)**

- **⚠️ 이 기능의 유일한 함정: `recordRecent`가 최근조회를 **항상 배열 맨 앞**에 다시 붙인다**
  (`[{최근조회}, ...others]`). 그 위로 끌어 놓으면 등락율을 **한 번만 클릭해도** 순서가 조용히
  원복돼 사용자에겐 '드래그가 안 먹는' 것으로 보인다 → 자동 그룹은 **드래그 대상도 아니고 자리도
  고정**이다(종목 드래그의 `isAutoGroup` 게이트와 같은 근거). 대신 `recordRecent`가 `others`의
  순서는 보존하므로 수동 그룹끼리의 재정렬은 안전하다.
- **⚠️ 산술의 정본은 `src/watchlistGroups.ts`**(순수 모듈, **import 0건** — `verify:watchlist`가
  미러 없이 직접 import한다. `enum`/`namespace` 금지). `reorderManualWatchGroups`는 **자동 그룹이
  있던 인덱스를 그대로 두고 수동 그룹만 그 사이 슬롯에 다시 깐다** — 최근조회 맨 앞 고정이 산술이
  아니라 **구조**로 보장된다. `isAutoWatchGroup`·`manualWatchGroupIds`도 이 모듈이 정본이고,
  컴포넌트에서 손복제하면 그 경로만 조용히 원복된다.
- **⚠️ 좌표계 일치**: 드롭 인덱스는 `[data-watch-group]` 행 수로 재고 그 속성은 **수동 그룹에만**
  붙는다(`data-watch-group={isAuto ? undefined : ''}`). 자동 그룹에 붙이면 `manualWatchGroupIds`와
  좌표계가 1만큼 어긋나 드롭이 한 칸씩 빗나간다.
- **⚠️ 순서 변화가 없으면 같은 참조를 반환**한다. 순서는 `watchlistGroups` **배열 자체를 재정렬**해
  기존 지문(`portfolioStructureKey`의 `JSON.stringify`)이 그대로 잡으므로 **영속화 신규 지점 0곳**이고,
  새 배열을 항상 만들면 제스처마다 헛된 Drive 저장이 나간다. ⚠️ `order` 필드를 만들지 말 것
  (정규화·지문·복원 등록이 늘고 하나만 빠지면 조용히 유실 — 종목 순서 드래그와 같은 규약).
- 정렬 중(`sortDir !== null`)·읽기 전용에서는 꺼진다(보이는 순서 = 저장 순서일 때만 이동 허용).

**별도 브라우저 창 (`/?watchlistWindow=1`) — postMessage 브릿지 (⚠️ 회귀 주의)**

인앱 팝업 타이틀바의 **⧉ 버튼**(`onOpenWindow`)으로 연다. 기존 5개 창(달력·흐름도·백테스트·카드·
가계부)과 **같은 규약**(App 미마운트 · `noopener` **금지** · `ping.need`가 초기 전송의 유일한 트리거 ·
재입양 · 끊기면 `readOnly` · 자체 `ErrorBoundary label` · 팝업 차단 시 인앱 폴백 · `features` 인자 금지).

- **✅ 다른 창들보다 단순한 이유: 시세를 창이 스스로 조회한다.** `watchlistQuote.ts` → `api.ts`의
  fetcher는 공개 프록시/Edge 함수만 쓰고 인증 토큰도 Drive도 필요 없다 → 브릿지는 `watchlistGroups`
  배열 하나만 양방향으로 나르는 **단일 채널**이다. ⚠️ 채널을 둘로 쪼개지 말 것 — 각각 `gotData`를
  세우게 되어 그룹이 도착하기 전에 쓰기가 열린다(CalendarWindow 선례).
- 프로토콜: 창→앱 `watchlist:ping{need}`(3초)·`watchlist:groups{groups}` /
  앱→창 `watchlist:live{groups, readOnly, dataState}`·`watchlist:pong`.
- **⚠️ 데이터 유실 방지 = `dataState` 게이트**(가계부 2026-08-30 사고와 **같은 부류**):
  `watchlistGroups`는 백업 복원 sticky(`_preserveStickyPersonalData`)라 로드 전 빈 배열이 한 번
  덮으면 **백업으로도 되돌릴 수 없다**. 창의 `writable = linked && gotData && !appReadOnly &&
  appDataState === 'ready'`이고, 수신값은 화이트리스트 밖이면 전부 `'loading'`으로 떨어뜨린다
  (**fail-closed** — 최악이 '창이 읽기 전용으로 남음'(새로고침으로 복구)이고 반대편은 되돌릴 수 없는
  유실이라 비대칭이 이 방향을 강제한다). ⚠️ 앱 측 deps에 `ledgerDataState` 필수(없으면 로드가 끝나도
  창이 잠긴 채 남는다). ⚠️ `ledgerDataState`는 이름만 가계부일 뿐 **STATE 확정 직후 한 곳에서** 서는
  앱 전역 신호다 — 별도 신호를 새로 만들면 두 값이 갈라진다.
- **⚠️ 그룹 쓰기는 `updateGroups` 단일 통로**(`readOnly` fail-closed). 호출부가 **10곳**이고 그중
  종목명 캐시·최근조회 기록처럼 사용자가 '쓰기'로 인식하지 않는 경로가 섞여 있어, 개별 게이팅으로
  두면 하나만 빠뜨려도 그 경로만 조용히 저장을 흘려보낸다.
- **⚠️ impersonation 차단의 정본은 App 측 핸들러**(`adminViewingAsRef`) — 창은 조작 가능한 URL로
  열리므로 창의 `readOnly` prop만으로는 부족하다(fail-closed).
- **⚠️ 창의 `onUpdateGroups`는 functional updater를 받아 `groupsRef`로 **동기** 합성**한다 —
  `addStock` 직후 `loadQuote`의 이름 캐시처럼 한 tick에 연달아 두 번 부르는 경로가 있어 state만
  읽으면 뒤 호출이 앞 호출을 덮는다. ⚠️ setState 업데이터 **안에서** post하지 말 것(StrictMode
  이중 호출로 두 번 전송).
- **⚠️ 읽기 전용 빈 목록에서 '만들어 보세요'라고 하지 않는다** — "아직 안 불러왔다"와 "저장된 게
  없다"를 구분하지 못하면 사용자가 새로 만들게 되고, 그 입력이 정확히 저장된 목록을 덮는 경로다.
- 렌더는 인앱과 **같은 `WatchlistPopup`**(`variant='page'`) — 복제하면 두 화면이 갈라진다.
  ⚠️ ⧉ 버튼은 **창 자신에는 렌더하지 않고**(`onOpenWindow && !isPage`), `onMouseDown stopPropagation`이
  필수다(타이틀 바가 드래그 핸들이라 안 막으면 누르는 순간 패널 드래그가 시작된다).
- **알려진 한계(의도)**: 인앱 팝업과 새 창을 동시에 열면 마지막 쓰기가 이긴다(⧉가 인앱 팝업을 닫으므로
  실사용에서 겹치는 구간은 짧다 — 달력·흐름도 창과 같은 절충). 앱 탭을 닫으면 창은 읽기 전용(구조적).
- 검증: `npm run verify:watchlist` (직접 import `#1~#69` + 소스 텍스트 가드 `#G0~#G73` — 보기 상태 저장 `#21~#32`·`#G32~#G45`는 변이 18종 + 음성 대조 1종, 팝업 크기 조절 `#33~#50`·`#G46~#G62`는 변이 23종 + 음성 대조 1종, 종목 하이라이트 `#51~#69`·`#G63~#G73`은 변이 19종 + 음성 대조 1종으로 검출 실증).
  ⚠️ 가드는 **선언이 아니라 사용부**를 단언하며 **변이 33종 + 음성 대조 1종**(자동 그룹 자리 고정 파괴 ·
  같은 참조 반환 제거 · `insertAt` 보정 제거 · 좌표계 어긋냄 2종 · 순수 모듈에 import 추가 · 재정렬
  손계산 복귀 · `isAutoGroupOf` 손복제 · `readOnly` 게이트 3종 · prop 직접 호출 복귀 · 가로 스크롤 칩
  복귀 · `PANEL_W` 하드코딩 · stopPropagation 제거 · 부팅 분기 삭제 · `dataState` 미전송/deps 누락/
  fail-open · writable 조건 완화 · 수신 화이트리스트 누락 · impersonation 가드 제거 · `noopener` 추가 ·
  폴백 제거 · `ErrorBoundary label` 제거 · `stockHistoryMap` 병합)으로 **실제 검출을 확인**했다.
  ⚠️ **`App.tsx`만 CRLF**다 — 변이 하네스의 여러 줄 앵커는 `\n`을 그 파일의 줄바꿈으로 정규화하지
  않으면 조용히 건너뛴다(실측: 3종이 '앵커 없음'으로 빠졌다).
  ⚠️ `#G31`처럼 '금지 토큰 부재'를 재는 가드는 반드시 **주석을 걷어낸 뒤** 잰다 — 이 저장소는 금지
  이유를 바로 그 자리 주석에 적으므로 원문으로 재면 그 설명에 걸려 영구히 실패한다(실측).

**분배금·분배율 열 (현재가 오른쪽 — 기본 숨김, 2026-10 사용자 요청)**

관심종목 리스트 현재가 오른쪽에 **가장 최근 분배일의 분배금과 분배율**을 보인다. 기본은 접혀 있고
(좁은 '분배 ◂' 칸), 헤더나 행의 그 칸을 누르면 펼쳐진다. 펼친 머리글을 누르면 다시 접힌다.

- **펼침 상태 = `watchlistView.showDiv`**(chartPrefs.watchlistView 안 — **영속화 신규 지점 0곳**). 앱 탭은 Drive로,
  별도 창은 `watchlist:view`로 같은 값을 쓴다. `normalizeWatchView`가 `=== true`일 때만 펼침으로 보고
  `sameWatchView`가 그 값까지 비교한다(빠지면 '펼치기만 한 클릭'이 저장되지 않는다).
- **조회는 펼쳤을 때만**(effect 게이트 `!showDiv` — 접힌 동안 네트워크 0). 결과는 팝업 로컬 `divMap`
  (메모리 전용). ⚠️ 계좌의 `dividendHistory`에 쓰지 말 것 — 보유하지 않은 종목이 분배금 현황 표에 유령 행으로
  새어 나온다(backtestFetch와 같은 규약). 현재가 클릭(행 새로고침)·시장 보정도 분배금을 다시 받는다.
- **조회 경로 = `watchlistQuote.fetchWatchDividend`**: 국내 = 네이버 ETF 분배 이력(최근 1회 + 그 회차 분배율 —
  **네이버 표기값**) → 비면 종목 요약(`/api/stock/{code}/integration`)의 **연간** 주당배당금·배당수익률(일반 주식은
  회차 이력이 없다 — 화면에 '연'을 붙여 구분) / 해외 = 야후 `events=div`(분배율 = 분배금 ÷ **배당락 직전 거래일
  종가**, 같은 응답의 일봉) / 펀드 = 미지원. 응답 해석은 `watchlistChart.ts`의 순수 함수(`pickNaverDividend`·
  `pickNaverAnnualDividend`·`pickYahooDividend`)가 정본이다.
- **⚠️ 상태 6종을 뭉뚱그리지 않는다** — 조회 중(`…`) · 최근 1회 · 연간 · 기록 없음(`없음`) · 펀드 미지원(`-`) ·
  조회 실패(`-` + 빨간 '조회 실패'). 파서도 '기록 없음'(정상 응답의 빈 배열)과 '실패'(모양이 틀린 응답 = null)를
  구분하고, **항목은 있는데 전부 손상**이면 '기록 없음'으로 단언하지 않는다(null).
- **⚠️ 분배율은 '그 회차 1회분'이다(연환산 아님)** — 툴팁이 그 사실과 기준(네이버 표기 / 직전 종가)을 밝힌다.
  분배율 색은 teal(빨강/파랑은 옆 칸 등락율의 상승/하락으로 읽힌다).
- **⚠️ 접힌 칸도 헤더·행 양쪽에 같은 폭**(`DIV_TOGGLE_W`) — 한쪽만 있으면 현재가 열이 어긋난다. 펼친 칸(`DIV_COL_W`)도
  같다. `PANEL_W = 640 + DIV_TOGGLE_W + SIDEBAR_W`(종목명 310px 확보 — 셋은 한 세트), 펼치면 기본 폭·최소 폭에
  `DIV_COL_W`를 더한다(`divExtraW`). 저장된 폭이 있으면 그 폭을 존중한다.
- 헤더는 이제 **종목 1개부터** 그린다(분배 토글이 헤더에 있다 — 정렬은 2개 이상일 때만 의미).

**미니차트 클릭 → 종목 비교 차트 별도 창 (`/?stockChartWindow=1`, 2026-10 사용자 요청)**

리스트의 미니차트를 누르면 그 종목의 **시세 반영 수익률 비교 차트**(수익률 차트 화면의 비교종목 차트와 같은 모양)가
새 브라우저 창으로 열린다. 비교 종목 추가(최대 8)·기간(1주~5년·직접)·수익률/종가 보기·드래그 구간 수익률을 지원한다.

- **⚠️ 창은 App을 마운트하지 않고 쓰기가 0이다** — 시세·종가를 스스로 조회(공개 프록시/Edge 함수, 인증 불필요)하고
  아무것도 저장하지 않으므로 **opener 브릿지가 없다**. 비교 종목·기간은 **주소(URL)에만** `history.replaceState`로
  남긴다(새로고침해도 유지). ⚠️ localStorage·sessionStorage·Drive·`stockHistoryMap`에 닿지 말 것(#G81).
- **⚠️ 팝업 등락율과 차트 '기간 수익률'의 단일 소스 = `src/watchlistChart.ts`**(순수 모듈, **import 0건** —
  `verify:watchlist`가 직접 import). `periodCutoff`(팝업 `cutoffFor`가 위임) · `watchPeriodWindow`(구간 자르기 +
  직접 선택 '현재까지' 꼬리) · `windowRate`(마지막 ÷ 첫 종가 − 1, 2점 미만 null)를 **두 화면이 같은 함수로** 쓰고
  종가도 같은 소스(`fetchWatchDaily`)라, 같은 기간이면 팝업 등락율과 차트 끝점이 한 글자도 다르지 않다
  (실측: 441640 1개월 −0.88% · 기준가 12,248 양쪽 동일). 팝업의 옛 인라인 계산은 이 공용 함수로 **옮겨졌고**,
  `#81`이 옛 본문(legacy 미러 — src를 고칠 때 **따라 고치지 말 것**)과 400건 무작위 대조로 '팝업 숫자 불변'을 단언한다.
- 종목마다 창 하나(`stockChartWindowName` — 대소문자 무시). 이미 열린 창은 다시 열지 않고 앞으로만(그 창에서 추가한
  비교 종목 보존). `window.open(url, name)` **2인자**(features 금지 — 크롬이 팝업으로 열어 주소창이 사라진다), 차단되면
  팝업 안 앰버 줄로 알린다(z-1050이라 토스트가 가려진다). 팝업의 '1일'은 장중이라 차트 창에서 **1개월**로 연다.
- 차트: 각 종목을 **자기 구간 첫 종가**로 0%(늦게 상장한 종목도 0%에서 출발) — `buildChartRows`, 마지막 행 = `windowRate`.
  ⚠️ 선 dataKey는 시리즈 키(`s0`…) — 종목 코드를 쓰면 'BRK.B'의 점이 recharts 경로로 해석된다.
  딤 3밴드는 선보다 **뒤**·`ifOverflow="hidden"`·`CHART_SELECTION` 토큰(수익률 차트와 같은 규약), 기간을 바꾸면 선택 해제, Esc로 해제.
- **구간 선택 = 수익률 차트와 같은 두 제스처**(2026-10 사용자 요청 "시작점을 마우스로 정하면 기간 수익률"):
  ① 드래그 ② **더블클릭 = 시작점 고정**(파란 점선 '시작') → 버튼을 안 눌러도 끝점이 따라오며 미리보기('선택 중 … — 클릭하면 확정')
  → 클릭(또는 드래그)으로 끝점 확정. 시작점 위를 누르면 계속 대기, 플롯 밖 클릭·Esc·기간 변경 = 해제.
  - **⚠️ 상태 전이의 정본 = `watchlistChart.chartSelStep`**(순수 — `#96~#96m`이 직접 import로 시나리오 단언).
    컴포넌트는 ref에 그 결과를 담고 **같은 참조면 setState를 건너뛴다**(이동마다 렌더 방지). 규칙을 컴포넌트에 손복제하지 말 것.
  - **⚠️ 버튼 놓침 자가치유(buttons === 0)는 드래그 중일 때만** — 시작점 대기의 미리보기는 원래 버튼 없이 따라오므로
    `buttons`만 보면 그 기능이 통째로 죽는다(수익률 차트 `#G11c`와 같은 함정).
  - **⚠️ 더블클릭의 두 번째 클릭(detail ≥ 2)은 down·up 모두 무시**(`isSecond`, window mouseup 포함) — 안 그러면 한 제스처 안에서
    '시작점 고정 → 곧바로 확정 → 해제'가 번쩍인다. **시작점은 끝점 클릭으로 덮어쓰지 않는다**.
  - `onDoubleClick`은 `<RechartsTooltip>`이 있어야 바인딩된다(툴팁을 빼지 말 것). 시작점 선은 딤·선택창보다 **뒤**·
    `ifOverflow="hidden"`(첫 날짜에 찍으면 기본값 discard가 선을 버린다)·`CHART_SELECTION.anchor*` 토큰.
  - **사용법 안내는 호버 중에도 보인다**(정보 줄 오른쪽) — 호버 중에만 사라지면 마우스를 차트에 올린 사용자는 영영 못 본다
    (실제 사용자 보고: 드래그 선택이 있는데도 못 찾았다).
- 가격 표기는 `watchlistQuote.fmtWatchPrice`를 팝업과 공유한다.
- **범위 밖(의도)**: 장중(1일) 차트 · 분배금 재투자 반영(총수익) 곡선 · 차트 창에서 관심종목 편집 · 비교 종목 색 변경.
  **알려진 한계**: 로컬 `npm run dev`는 `/api/history`(Edge 함수)가 없어 차트 종가가 비고, 앱 전체도 `useDriveSync`의
  타입 import(`DriveBackupEntry`) 때문에 dev 모드에서 로드되지 않는다(빌드·배포는 정상 — 기존 문제).
- 검증: `verify:watchlist` 파트①-b `#80~#95`(직접 import — 옛 팝업 본문 대조 · 차트 행 · 주소 · 분배금 파서를 네이버·야후
  실측 응답 형태로) + 가드 `#G74~#G95`. **변이 25종 + 음성 대조 1종으로 검출을 실증**했다(꼬리 대체 제거 · 컷오프 변경 ·
  최근 분배를 가장 오래된 것으로 · 분배율 기준을 당일 종가로 · 차트 기준을 마지막 종가로 · 손상 응답을 '없음'으로 ·
  showDiv truthy · sameWatchView 누락 · 행 접힌 칸 폭 · 조회 게이트 · 토글 로컬화 · features 추가 · 차단 안내 ·
  컷오프 손계산 · 펼침 폭 · 헤더 2개부터 · dataKey 코드 · 자가치유/blur · 선택 해제 · label · 공용 함수 미사용 ·
  localStorage · 부팅 분기 · 펀드 분기). 시작점 고정은 `#96~#96m`·`#G87~#G87g`가 맡고 **변이 12종 + 음성 대조 1종**
  (자가치유가 미리보기까지 확정 · 시작점 덮어쓰기 · 시작점 위 클릭 해제 · 두 번째 클릭 무시 제거 · 같은 참조 제거 ·
  더블클릭 무시 · 배선 제거 · onDown second 미전달 · 시작점 선 ifOverflow · 참조 비교 생략 · 안내 호버 숨김 · 기간 변경 해제)으로 검출을 실증했다.

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
  기준일)` 반개구간 `(비교일, 기준일]`이고 **입금·출금 모두 `noPrincipal`(미반영) 행은 제외**한다
  (2026-09 규약 변경 — 일간 지표 절 '미반영 원장 행' 참조. 옛 규약은 '출금은 전액'이었다).
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

