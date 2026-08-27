# ASS-Page 작업 로그

> 마지막 작업일: 2026-08-27  
> 브랜치: main  
> 작업 PC: 메인 PC

---

## 2026-08-27 — [포트폴리오 표] 엑셀(.xlsx) 내보내기 버튼

**대상 파일**: `src/xlsxWriter.ts`(신규) · `src/portfolioExcel.ts`(신규) ·
`src/components/PortfolioTable.tsx` · `src/App.tsx` · `scripts/verify-excel.mjs`(신규) ·
`package.json` · `CLAUDE.md`

> 각 계좌에서 포트폴리오 테이블을 엑셀파일로 다운로드 받을 수 있게 합니다.
> 제목은 (260827_퇴직연금 820) 형식으로, 다운로드 버튼은 수익률 옆 `+` 헤더 상단에 만들어 주세요.

### 1. 버튼

표 헤더 맨 오른쪽 칸(수익률 옆 `+` 열)에 `FileSpreadsheet` 아이콘을 **`+` 위**에 세로로 쌓았다.
⚠️ 기존 `<th>` **안**에 넣었다 — 새 열을 만들면 주식·펀드·예적금 행의 `<td>`, tfoot 빈 칸,
`depositColSpan`·`totalColCount` 두 식까지 전부 고쳐야 하는 '렌더 지점 23곳' 부류가 된다.
피드백은 아이콘 1.5초 플래시(성공 녹색 / 실패 빨강) — 알림 최소화 정책상 `notify()`는 쓰지 않는다.

### 2. 진짜 .xlsx를 직접 조립 (외부 의존성 0)

`package-lock.json` 부재로 Vercel 흰 화면이 났던 이력이 있어 xlsx/exceljs/jszip을 쓸 수 없다.
→ `src/xlsxWriter.ts`가 **ZIP(STORE, 압축 없음) + 최소 OOXML**을 바이트 단위로 조립한다.
CSV·SpreadsheetML로 타협하지 않은 이유: 전자는 서식·색·열 너비가 사라지고 BOM 유무로 한글이 깨지며,
후자는 Excel이 "확장자와 형식이 다르다" 경고를 띄운다.

실측 검증: 만든 바이트를 되읽어 6개 파트의 CRC-32·크기 전부 일치, .NET `ZipFile`로도 정상 개방,
`<styleSheet>`/`<worksheet>` 자식 순서 XSD 시퀀스 준수, 예약 fill(0=none·1=gray125) 유지.

### 3. 화면과 1:1

숨긴 열 반영 · 화면 렌더 순서(주식→예수금→펀드→예적금→D/S→TOTAL) · 행 색상 표시(4색) ·
퇴직연금 D/S 비율 행 · TOTAL 행. 숫자는 **숫자 셀**로 넣고 Excel 서식으로 화면과 같게 보이게 했다
(퍼센트는 분수+`%` 서식이라 셀 합산이 정상, 손익은 한국식 빨강/파랑).

⚠️ **해외계좌 단위 함정**: `totals.calcPortfolio`는 `investAmount`·`evalAmount`·`profit` 셋만 원화
환산돼 있고 나머지는 native USD다 → 투자금액은 `overseasInvestAmount(item)`을 써야 한다
(`item.investAmount`를 읽으면 ≈1,390배). USD 열 뒤에 `(₩)` 동반 열을 덧붙여 정보 손실을 없앴다.

파일명 날짜는 클릭 시점 `getTodayKST()` — 이 파일의 `todayStr`(UTC 파생)은 KST 00:00~09:00에 하루
밀린다. ⚠️ 그 필드는 예적금 입금일에 쓰이는 **별개의 선행 버그**라 이번 커밋에서 건드리지 않았다.

### 4. 검증

`npm run verify:excel` 신설(**91건** — 직접 import 순수 함수 + ZIP 되읽기 + 소스 텍스트 가드 #G1~#G29).
⚠️ 미러 없이 `src/*.ts`를 **직접 import**한다(미러는 한쪽만 고친 변경을 통과시킨다).
**변이 22종으로 검출을 실증**했다(22/22 검출, 죽은 단언 0).

게이트: `npm run build` 통과 · verify 18/19(`calendar`는 KR 공휴일 큐레이션 드리프트로 **변경 전
HEAD에서도 동일하게 실패**하는 연례 유지보수 신호) · jsxcheck/undefcheck/scopecheck 통과(신규 2파일의
scopecheck 지적 44건은 전부 다중행 구조분해·클래스 메서드·인터페이스 필드 오탐임을 직접 확인).

**영속화 지점 0곳** — 전부 매 렌더 파생값이라 `portfolioStructureKey`·`applyStateData`·
`applyBackupData`·저장 effect deps·`chartPrefs` 전 지점 무수정.

---

## 2026-08-13 — [과표계산기] 각주 접기(`?`) + 적대적 리뷰 확정 결함 5건 수정

**대상 파일**: `src/krEtfTaxHelpers.ts` · `src/components/KrEtfTaxMatrix.tsx` ·
`scripts/verify-kretf-tax.mjs` · `CLAUDE.md`

### 1. 계산 규약·각주를 `?` 토글로 접음 (사용자 요청)

> 상세 내역은 사용자가 원할 때 볼 수 있게 평소에는 숨기고, 확인이 필요할 때만 봅니다.
> 사진의 부분은 기호(?)를 클릭하면 펼쳐서 볼 수 있게 수정합니다.

각주 12줄을 `? 계산 규약 · 각주` 한 줄로 접었다(`showTaxHelp`, 기본 접힘 · 세션 로컬 · **Drive 저장
지점 0곳**). ⚠️ 접어도 **'분석용 원가법' 고지는 3중으로 남긴다** — ① 토글 줄 우측 요약
`실현손익 = 최저가 우선 매칭 · 분석용(세법상 이동평균법 아님)` ② 열 헤더 서브라인 ③ 열 헤더 툴팁.
각주가 유일한 고지가 되면 접는 순간 실현손익이 과세 근거로 오해된다.

### 2. 적대적 리뷰(3렌즈 병렬 + 지적별 독립 반증) 확정 결함 5건

| # | 심각도 | 내용 |
|---|---|---|
| 1 | **HIGH** | `undatedBuy` 가드가 매수만 봐서 **일자 없는 매도**를 놓쳤다 — 이미 팔린 최저가 로트가 풀에 남아 이후 매도 기준단가를 낮추는데도 `trusted:true`로 확정(실측 참값 +50,000 → **+450,000**, 9배). `undatedTrade`(`change !== 0`)로 넓히고 러닝 평균 순회에도 **동일 판정** 적용 |
| 2 | MEDIUM | 폴백 사슬 서술이 거짓 — 매입단가·일자 누락에서는 러닝 평균도 같은 `excludedSeen`으로 꺼져 **건너뛴다**. 각주·헤더 툴팁을 ⓐ(부족 → 러닝 평균) / ⓑ(누락 → 평균단가) 2갈래로 정정. 미러 `lofoBasisOf`에 `buyAvgTrusted` 게이트 추가 |
| 3 | MEDIUM | 각주 ①~③ 문단이 옛 서술 "실현손익은 …시점 평균을 쓰므로"를 남겨 4줄 아래와 정면 모순 → 정정 |
| 4 | LOW | `매수 이력 부족 N건` 툴팁이 "* 가 붙습니다"라고 단언하지만 실현손익이 아예 산출되지 않은 행에는 * 가 없다 → 문구 정정 |
| 5 | LOW | `LOT_QTY_EPS` 테스트가 로트 필터 임계만 밟고 `break`·`shortfall` 임계는 안 밟아 0으로 바꿔도 통과 → 3번째(더 비싼) 로트를 넣은 픽스처로 교체 |

리뷰가 **반증(refuted)** 한 5건은 반영하지 않았다(옛 주석 지적 3건은 이미 갱신돼 있었고,
'≤ 평균법' 불변식·`seq` 타이브레이커 지적은 테스트 문구만 정정).

### 3. 그 밖

- `최저가 매칭 원가 ≤ 평균법 원가` 테스트 이름이 **일반적으로 거짓인 불변식**을 주장하고 있었다
  (싼 로트가 먼저 소진되면 이후 기준단가는 평균법보다 높다 — 같은 파일의 '순차 소진' 테스트가 반례).
  실측 픽스처 한정임을 이름·주석에 명시.
- `matchedQty > LOT_QTY_EPS`가 다른 두 게이트 때문에 **도달 불가한 방어적 중복**임을 확인하고 주석화.

### 검증

`npm run verify:tax` **90 → 94건**(무일자 매도 · break 임계 · matchedQty 임계 · #G14 토글 배선).
jsxcheck·undefcheck·scopecheck 통과. **변이 12종 추가 실증**(누적 32종) — 그 과정에서 새로 넣은
가드 3건이 처음엔 죽은 단언이었음을 발견해 픽스처를 고쳤다.

---

## 2026-08-13 — [과표계산기] 매도 실현손익 기준단가 = 최저가 우선(LOFO) 매칭

**대상 파일**: `src/krEtfTaxHelpers.ts` · `src/components/KrEtfTaxMatrix.tsx` ·
`scripts/verify-kretf-tax.mjs` · `CLAUDE.md`

### 배경 (사용자 요청)

직전 작업으로 매도 행에 실현손익이 뜨지만, 기준단가가 **전체 평균단가**(8,699.20)라 8/5 매도
(630주 @8,260)가 **−₩276,694 손실**로 표시됐다. 사용자 지적:

> 7/28일 매수금액이 7778입니다. 8/5일 매도금액은 8260입니다. 전체 평균가격이 아닌 **매수 최저가격**과
> 매도일 가격을 비교하면 수익이 됩니다. … 최저점 매수가격과 매수수량으로 매도일에 대한 수익을
> 표시해주세요. **매수수량을 초과한 매도시에는 다음 최저 가격**을 기준으로 계산하면 됩니다.
> 매수는 지금처럼 유지하고 매도시 실현 손익을 수정하면 됩니다.

### 변경 내용

- **`buildLofoLotSeries`** 신설(`krEtfTaxHelpers.ts`) — 매수 이벤트를 로트 풀로 쌓고, 매도마다
  **가장 싼 로트부터** 매도수량만큼 소진해 원가·배정 내역을 낸다(lowest-cost-first-out).
  `computeSellRealized`의 **시그니처·본문은 무수정**(가중 기준단가만 넘긴다).
- 기준단가 우선순위 `lofo → running → avgBuy`. LOFO 게이트 3항 —
  `trusted && shortfallQty === 0 && basis > 0`.
- 셀 3번째 줄에 **배정된 매수분** 노출(1건이면 `MM-DD`, 여러 건이면 `N건`) + 툴팁에 매수일·수량·단가
  명세. 헤더 서브라인 `매도 = 실현손익 · 최저가 우선`, 요약 바에 `매수 이력 부족 N건` 안내.
- 각주 4줄 추가/개정 — 배정 규칙 · 소급 변경 금지 · **분석용 원가법 고지** · 폴백 3단계.

### 실측 재현 (KODEX 200커버드콜액티브)

보유 로트: 7/29 761주@7,227 · 7/28 2,113주@7,778 · 7/20 120주@8,451.67 · 7/14 10,000주@8,524 …

| 매도일 | 수량 | 매도단가 | 배정된 매수분 | 기준단가 | 실현손익 |
|---|---|---|---|---|---|
| 08-05 | 630 | 8,260 | 07-29 630주@7,227 | 7,227.00 | **+650,790** |
| 08-11 | 20 | 7,820 | 07-29 20주@7,227 | 7,227.00 | **+11,860** |
| 08-12 | 421 | 8,071 | 07-29 111주@7,227 + 07-28 310주@7,778 | 7,632.72 | **+184,514** |
| **합계** | 1,071 | — | — | — | **+847,164 (+10.71%)** |

종전(평균단가 8,699.20 기준) 합계는 **−₩558,749 (−6.00%)** — 부호가 뒤집힌다.

### 핵심 설계 결정

- **분석용 원가법이지 세법상 원가법이 아니다.** 과세 3열(`computeSellTaxRow`)은 종전대로
  `avgBuy.value`(현재 시점 평균단가)를 쓴다 → 같은 행에서 **실현손익 '이익' + 실제 과세 '비과세'가
  동시에 표시되는 것이 정상**. 열 헤더 툴팁과 각주 두 곳에 상시 고지.
- **소급 변경 금지 불변식 유지** — 로트 풀은 `compareTaxEvents` 순서로 순차 소진하므로 매도 시점
  **이후**의 매수는 배정되지 않는다. 한 번 배정된 로트는 재사용되지 않는다.
- **부족(shortfall)은 퍼뜨리지 않는다** — 배정할 매수분이 모자라면 매칭된 몫의 원가를 전체 수량에
  퍼뜨리지 않고 러닝 평균으로 폴백(`*` 표시 + 요약 안내). 부족 행이 이후 행을 오염시키지는 않는다.
- **`basisDiverged` ⚠는 LOFO 행에서 억제** — 평균단가와 벌어지는 것이 설계상 상시라 전 행에 ⚠가
  뜨면 경보가 죽는다. 대신 배정 내역을 노출해 근거를 추적 가능하게 했다.
- **러닝 평균 폴백을 남긴 이유** — 부족·부분 풀에서 `avgBuy`(현재 시점 값)로 곧장 떨어지면 직전
  작업이 막은 '부호 뒤집힘' 2종에 그대로 노출된다.

### 검증

`npm run verify:tax` **71 → 90건**(§13 로트 매칭 17건 + #G12·#G13 가드). jsxcheck·undefcheck·scopecheck 통과.
가드가 실제로 무는지 **변이 20종**으로 확인 — 그 과정에서 **죽은 단언 3건**을 발견해 고쳤다:
문구 가드가 파일 전역 정규식이라 같은 문장이 열 헤더 툴팁에도 있어 **각주에서 통째로 지워도 통과**했고
(M10·M17), `lotsDetailText` 포매터 본문을 빈 배열로 바꿔도 통과했다(M15).
→ `FOOT`/`TH_REALIZED` 구간을 잘라 단언하고, 포매터 본문(매수일·수량·단가)을 직접 단언하도록 강화.

### 영속화

**신규 지점 0곳** — 배정 내역·기준단가·부족 수량이 전부 기존 `events`에서 나오는 매 렌더 파생값.
`taxBaseKey`·`applyStateData`·`applyBackupData` 무수정.

---

## 2026-08-13 — [과표계산기] 매도 행 실현손익 표시

**대상 파일**: `src/krEtfTaxHelpers.ts` · `src/components/KrEtfTaxMatrix.tsx` ·
`scripts/verify-kretf-tax.mjs` · `CLAUDE.md` (+498 / −24)

### 배경

'평균 과표 계산기'의 **'현재가 × 매매수량' 열**은 매수 행에만 값이 있었다(평가금액 + 손익·수익률).
매도 행은 `-`로 비어 있어 **"이 매도로 얼마를 벌었나"를 화면 어디에서도 알 수 없었다.**
사용자 요청(2026-08): "매도시 얼마의 수익을 냈는지 매수시처럼 표현해 달라."

### 변경 내용

- 열 이름 **'현재 평가 / 실현손익'**. 매도 행에 3줄 렌더 —
  ① 실현손익 금액(이익 빨강/손실 파랑) ② 주당손익 · 수익률 ③ 그 행에 쓰인 기준단가.
- 하단 요약 바에 **매도 요약 줄** 추가(매도일·매도 합계·매도금액·평균 매도단가·매입원가·실현손익).
- `computeSellRealized` 신설(`krEtfTaxHelpers.ts`) — `computeSellTaxRow`(과세 3열)는 **무수정**.
- 일자 정규식 10곳을 `ISO_DATE` 모듈 상수로 통합.

### 핵심 설계 결정 — 기준단가는 '매도 시점 러닝 평균'

과세열이 쓰는 `avgBuy.value`(**현재 시점** 포트폴리오 구매단가)로 통일하지 **않았다**.
실현손익은 확정된 과거 사실이라 나중 매수로 소급 변경되면 안 되기 때문이며, 통일하면 두 경로에서
**부호가 뒤집힌다**:

| 상황 | 참값 | 현재 시점 평균 기준 |
|---|---|---|
| 100주@8,000 매수 → 50주@9,000 매도 → 100주@12,000 매수 (**데이터 정상**) | +50,000 | **−83,333** |
| 매도 반영 시 보유수량만 줄이고 투자금액 유지 → 구매단가 8,000 → 21,621 | +163,800 | **−8,417,822** |

과세 3열은 종전 규약(현재 시점 값 — 사용자 선택)을 유지하고, 두 기준의 주당 금액이 다를 수 있다는
사실을 **각주 + 셀의 '기준 N' 줄**로 상시 노출한다(5% 이상 벌어지면 셀에 ⚠).

### 지킨 규약

- **열 추가 0개** — 기존 셀 재사용이라 12열 규약·colSpan·가로 스크롤 전부 무영향.
- **영속화 신규 지점 0곳** — 전부 기존 `events`에서 나오는 매 렌더 파생값.
- **null 계약** — 기준단가·매도단가가 없으면 0원으로 단언하지 않고 사유를 문구로 표시.
- **요약은 행별 값 누적**(`Σ realized.cost/profit`) — 상수 곱은 기준단가가 행마다 다르면 부호가 뒤집힌다.
- **요약 바 게이트 OR** — 매수 행이 없는 계좌에서도 매도 요약이 뜬다.
- **이중 계상 경고** — 매수 요약 '손익'은 매도분까지 현재가로 평가한 값이라 실현손익과 겹친다.

### 검증

- `npm run verify:tax` **47 → 71건** (§11 `computeSellRealized` 미러 13건 + §12 렌더 배선 가드
  #G1~#G11). #G11은 미러와 src 본문을 **문자 단위로 대조**해 한쪽만 고친 드리프트를 잡는다.
- **변이 11종으로 전 가드의 검출을 실증** — 최초 실행에서 **죽은 단언 4건**(#G11이 파라미터
  구조분해를 본문으로 오인, #G7의 느슨한 OR 등)을 찾아 고쳤다.
- `npm run build` 에러 0 · 신규 식별자 스코프 수동 확인(esbuild는 미정의 참조를 통과시킴).

### 적대적 리뷰 후속 (커밋 21440f2)

3렌즈 병렬 리뷰 + 적대적 검증에서 **확정 결함 5건**이 나와 전부 수정했다.

1. **시점별 신뢰도** — 전역 `buyExcludedCount`로 러닝 평균 신뢰도를 재던 탓에 매도보다 **뒤에 있는**
   불완전 매수 행 1건이 그 매도의 완전한 평균을 폐기시켜 현재 시점 값으로 폴백했다
   (실측 **+50,000 → −83,333**, 부호 뒤집힘). 폴백이면 `basis === avgBuy.value`라 ⚠도 구조적으로 뜨지
   못하고, `addEvent`가 `purchasePrice` 없이 행을 만들어 **'행 추가' 후 수량만 입력한 상태**로도
   발동했다 → 그 행 **시점까지**의 `excludedSeen`으로 판정하도록 교체(일자 없는 매수 행만 전 구간 불가).
2. **같은 날짜 정렬 결정성** — `localeCompare`만으로는 비교값이 0이라 `Array.sort`의 안정 정렬이
   **배열 삽입 순서**를 채택했다. 행 재정렬 UI가 없어 결정 요인이 화면에 없는데 부호까지 갈렸다
   (같은 날 매수 100@20,000 + 매도 50@12,000 → 기준 15,000이면 −150,000, 10,000이면 +100,000)
   → `compareTaxEvents`(매수 우선) 공유 비교자. 러닝 평균 순회 3곳이 함께 쓴다.
3. **과세 3열 각주 4줄 복원** — 실현손익 각주를 끼워 넣다 과세 금액 정의·실제 과세 min 규약·
   평균단가 폴백 3단계·① 현재 시점 값 경고가 **통째로 삭제**돼 있었다.
4. **요약 바 래퍼 게이트** — 내부 매도 줄 게이트보다 좁아 매수 0건 + 매도 전부 미산출이면
   '합계 제외 N건' 진단이 **도달 불가**였다.
5. **'실현손익 미산출' → '합계 제외'** — 일자 없는 매도 행은 셀에 값이 뜨는데 요약은 미산출이라
   불렀다(제외는 사실, 미산출은 거짓).

### 가드 강화 — '존재' 단언의 한계

리뷰가 실증했듯 **'존재'만 보는 단언으로는** `resolveBasis` 두 줄 **맞바꾸기**와 매도 분기
`buyAvg = 0` **추가**가 **71/71로 통과**한다(줄이 여전히 존재하므로). 세 가지로 나눠 단언한다:

- **우선순위** → `indexOf` **순서 비교**(#G3)
- **해서는 안 되는 코드** → 분기 본문을 잘라 **부재**로(#G4의 매도 분기 `buyAvg` 재대입,
  #G3의 `excludedSeen` 갱신)
- **게이트** → **래퍼 ⊇ 내부** 포함관계로(#G6)

**변이 20종(1차 11 + 2차 9) 전부 검출.** 2차 N4(`excludedSeen` 갱신 제거)가 처음엔 통과해
#G3을 한 번 더 강화했다.

---

### 사용자 데이터 기준 결과

첨부 화면의 실데이터(매수 20,000주 평균 8,699.20 / 매도 630·20·421주 @8,260·7,820·8,071)는
**세 건 모두 손실**이다 — 합계 **−₩558,749 (−6.00%)**. 매입 평균단가보다 낮은 가격에 팔았기 때문이며,
헤더의 기존 손익 표시(−₩3,783,931, −2.17%)와도 방향이 일치한다.

---

## 2026-08-08 — [백테스트] 별도 창 → 일반 탭 전환

**대상 파일**: `src/App.tsx` (`openBacktestWindow`, +9 / −3)

### 배경

`window.open`에 `width`/`height` features를 주면 크롬이 그 창을 **'팝업'으로 취급**해
주소창·즐겨찾기 막대·**확장프로그램 아이콘**이 통째로 사라진다. 그래서 백테스트 별도 창에서는
브라우저 확장(Claude in Chrome)을 쓸 수 없었다.

### 변경 내용

- `window.open('/?backtestWindow=1', 'ass-backtest', \`width=…,height=…,left=0,top=0\`)`
  → **3번째 인자(features)만 제거** → `window.open('/?backtestWindow=1', 'ass-backtest')`.
  features가 없으면 **일반 탭**으로 열리고 `window.opener`는 그대로 유지된다.
- features 제거로 쓰이지 않게 된 `sw`/`sh`(`screen.availWidth/Height`) 지역변수 삭제.
- 재사용 탭 focus 보강 — 이름이 같은 탭이 이미 있으면 `window.open`이 그 탭을 재사용하는데
  브라우저가 항상 앞으로 가져오지는 않는다(이 탭의 `btWinRef`가 새로고침으로 비어 상단
  early-return을 못 탄 경우). `try { w.focus(); } catch {}` 추가.
- 재발 방지 주석 4줄 추가(features 금지 근거 + 이름 유지 근거).

### 지킨 규약

- **창 이름 `'ass-backtest'` 유지** — 같은 탭 재사용이 중복 열기를 막는 유일한 장치.
- **`noopener`/`noreferrer` 미추가** — opener 브릿지(`backtest:data`/`live`/`pong`)가 이 기능의
  전부다(impersonation 탭과 정반대 규칙, CLAUDE.md 명시).
- **클릭 제스처 직후 동기 `window.open`** 구조 그대로(팝업 차단 회피) + 차단 시 인앱 폴백 유지.
- `CalendarWindow`(`ass-calendar`)·`FlowWindow`(`ass-flow`)는 **손대지 않았다**.

### 확인 사항

- `/?backtestWindow=1`을 여는 지점은 `App.tsx openBacktestWindow` **한 곳뿐**이고,
  두 진입점(상단바 백테스트 아이콘 `onOpenBacktest`, `BacktestPage`의 ⧉ `onOpenWindow`)이
  모두 이 함수를 호출한다 → 통일할 다른 경로 없음.
- **AI 관련 코드는 저장소에 존재하지 않는다**(`api/ai.ts`·`src/aiClient.ts`·`aiBacktest`·`aiSchema`
  전부 없고 `ANTHROPIC`/`AI_ADMIN_CODE` 식별자도 0건). 2~4단계 미진행 결정에 따른 것이라
  "AI 기능도 탭에서 동작" 항목은 해당 없음.

### 검증

- `npm run build` **실행 불가**(`node_modules` 없음) — Vercel push가 사실상의 빌드 검증.
- verify 11종 전부 통과(`backtest` 303/303 포함). `verify:calendar`는 외부 API 의존이라 제외.
  ⚠️ verify 스크립트 중 `window.open` 형태를 단언하는 가드는 없음(grep 확인).
- `jsxcheck` src 전체 82파일 통과 · `undefcheck` 0건.
- 중괄호 1539/1539(HEAD와 동일), 괄호 2763/2763(HEAD 2760/2760 대비 양쪽 +3 → 균형 유지),
  JSX 주석 16개로 불변, `={false)` 류 오타 없음.

### 후속: 안내 문구 "창" → "탭" (같은 날 별도 커밋)

일반 탭으로 열리게 바뀌었으므로 **사용자 노출 문구 4곳**만 정리했다(문자열 변경뿐, 구조 무변경).

| 파일 | 이전 | 이후 |
|---|---|---|
| `BacktestPage.tsx` | 버튼 `새 창` / title `별도 브라우저 창에서 크게 보기` | `새 탭` / `별도 탭에서 크게 보기 (주소창·확장프로그램 사용 가능)` |
| `BacktestWindow.tsx` | `앱 창과 연결이 끊겨 읽기 전용입니다. 앱 창을 다시 열면…` | `앱 탭과 연결이 끊겨 읽기 전용입니다. 앱 탭을 다시 열면…` |
| `BacktestWindow.tsx` | `앱 창에서 데이터를 불러오는 중입니다…` | `앱 탭에서 데이터를 불러오는 중입니다…` |
| `App.tsx` | `팝업이 차단돼 별도 창을 열지 못했습니다…`(btWinBlocked) | `팝업이 차단돼 별도 탭을 열지 못했습니다…` |

- ⚠️ **메모 달력(`calWinBlocked`)·자금 흐름도(`flowWinBlocked`)의 같은 문구는 그대로 뒀다** —
  그쪽은 아직 features(width/height)를 넘겨 **실제로 팝업 창**으로 열리므로 "창"이 정확하다.
- 코드 주석의 "별도 브라우저 창"은 유지 — `window.open`이 반환하는 것은 여전히 WindowProxy이고,
  달라진 것은 렌더 형태(탭)뿐이라 아키텍처 서술로는 그대로 맞다.

---

## 2026-08-08 — [백테스트] 1단계: ② 목표 기준 자유 입력 보장

**대상 파일**: `src/components/BacktestPage.tsx` (단일 파일, +240 / −24)

### 진단 결과

원인은 **한 가지가 아니라 세 가지**였고, 지시서의 진단 체크리스트 4개 중 2개가 실제 결함이었다.

| # | 체크 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | `splitEven()` 외에 목표값을 덮어쓰는 경로 | **결함 있음(주범)** | 별도 창 postMessage 왕복의 낡은 에코 |
| 2 | `NumInput`이 blur/Enter에서만 커밋 | 사양(유지) + 부작용 1건 | 스치기만 해도 커밋돼 승격을 유발 |
| 3 | `readOnly`가 과하게 걸리는가 | 문제 없음 | 별도 창은 데이터 도착 전 3초 내외만 읽기 전용 |
| 4 | 엔진의 '가중치 전부 0이면 균등 폴백' | 무관 | `runReinvest`(분배금 재투자 배분) 전용. 목표값 경로는 `targetOf()`가 `p.targetAmount ?? 0` / `p.targetRatio ?? 0`를 그대로 읽어 균등화가 개입하지 않음 |

**(A) 화면 구조 — "느껴집니다"의 실체.** `② 목표 기준` 섹션에 실제로 조작 가능한 컨트롤이
`목표 금액 / 목표 비중 %` 토글과 **`종목 수로 균등 분배` 버튼 하나뿐**이었다. 종목별 입력칸은
멀리 떨어진 `⑥ 종목`에 있고, 그 칸에는 **라벨조차 없이** 분배주기 select 옆에 placeholder만
있었다. 두 섹션 모두 기본 접힘이라, 사용자가 `② 목표 기준`을 열면 "이 화면의 목표 설정 수단은
균등 분배뿐"으로 읽힌다.

**(B) 별도 브라우저 창의 낡은 에코 — 실제로 값이 되돌아가는 경로.**
`BacktestPage`는 편집을 로컬 사본에 모아 2.5초 idle에 승격(`promote`)하고, 승격 즉시
`dirtyRef=false`가 된다. 그런데 앱 탭은 `[backtestScenarios, btPrices, btFetching, btWinNonce]`가
바뀔 때마다 `backtest:live`를 쏘고, **시세 조회 완료도 같은 메시지를 쏜다**. 앱 탭은 백그라운드라
타이머·렌더가 스로틀되므로, 승격 **이전** 상태로 만들어진 `backtest:live`가 승격 직후에 도착하면
seed effect(`dirtyRef` 검사만 있음)가 그대로 채택해 **방금 입력한 목표값이 직전 상태(대개
'균등 분배'를 눌렀던 값)로 되돌아간다.** 종목을 막 추가한 직후(=목표값을 입력하는 바로 그 시점)에
조회가 끝나므로 발생 확률이 가장 높은 구간이 정확히 겹친다.

**(C) `NumInput` 부작용.** 값을 바꾸지 않고 포커스만 스쳐도(`onFocus`에서 draft가 채워지므로)
blur에서 `onCommit`이 불려 `patchActive`가 `updatedAt`을 갱신 → 지문 변경 → Drive 4파일 write +
불필요한 승격 → (B)의 경합 창을 늘렸다.

### 변경 내용

1. **낡은 에코 차단** — `pendingEchoRef` 대기표(`{fp, until}`) 도입.
   `promote()`가 올린 값의 `backtestFingerprint`를 기록하고, seed effect는 그 값이 되돌아오기
   전까지(또는 `ECHO_GRACE_MS` 12초가 지나기 전까지) **다른 값을 채택하지 않는다.**
   - ⚠️ 승격한 적이 없으면(대기표 null) **종전대로 즉시 채택** — Drive 로드가 LoadingOverlay
     해제(20초)보다 늦게 도착하는 경로의 안전장치를 그대로 보존(FlowBoard 선례).
   - ⚠️ 인앱 오버레이는 `onUpdateScenarios`가 `setBacktestScenarios`라 참조가 그대로 돌아와
     fast path가 대기표를 즉시 지운다 → 이 가드는 사실상 **별도 창 전용**이다.
   - 이 가드는 '채택을 건너뛸' 뿐 로컬 편집을 지우지 않으므로, 데이터 유실 위험을 **줄이기만** 한다.
2. **`NumInput` no-op 가드** — 커밋값이 현재값과 같으면 `onCommit`을 부르지 않는다
   (`RebalancingPanel` `commitAmt`의 조기 return과 같은 규약).
3. **`종목 수로 균등 분배`에 2단계 확인** — 이미 입력된 값이 하나라도 있으면 곧바로 덮어쓰지 않고
   "이미 입력한 목표값 N종목을 모두 덮어씁니다 / 되돌리기 없음" 인라인 확인 → `[덮어쓰기] [취소]`.
   ⚠️ App의 `confirm()`/`notify()`를 쓰지 않는다 — 이 컴포넌트는 App을 마운트하지 않는 **별도
   브라우저 창**에서도 렌더되므로 그쪽엔 `ConfirmDialog`도 토스트도 존재하지 않는다.
4. **⑥ 종목 목록 아래 합계 줄** —
   금액 모드 `목표 합계 ₩X / 재원(초기+추가예수금) ₩Y · 차액 ±₩Z (남는 돈은 예수금)`,
   비중 모드 `합계 X% / 100% · 차액 ±X%p`. 초과=빨강 / 미달=노랑 / 일치=회색, **경고만 하고
   실행은 막지 않는다**(현행 엔진 규칙 유지). 미입력 종목 수와, 아무것도 안 넣었을 때의
   "각 종목 칸에 직접 입력하세요" 안내도 함께 표시.
5. **소버튼 `빈 종목에 잔여 채우기`**(금액 모드 전용) — 목표가 **미입력(null)인 종목에만**
   남은 재원을 균등 배분. **이미 입력된 값은 절대 건드리지 않는다.**
   ⚠️ `0`도 입력으로 취급(`hasTargetOf`가 `typeof === 'number'`로 판정) — truthy 판정이면
   '전량 청산 목표 0'을 미입력으로 오판해 덮어쓴다.
6. **문구·라벨** — ② 도움말에 "각 종목 칸에 원하는 금액/비중을 직접 입력할 수 있습니다.
   '종목 수로 균등 분배'는 편의 버튼일 뿐입니다" 명시(+ 섹션 본문에도 상시 한 줄).
   ② 접힘 배지에 현재 합계 표시. ⑥ 종목의 목표 칸에 **`목표 금액 (직접 입력)` 라벨 신설**.

### 검증

- `npm run build` **실행 불가**(`node_modules` 없음) — Vercel push가 사실상의 빌드 검증.
- `verify:backtest` **303/303 통과**(변경 전 baseline과 동일). 나머지 10종
  (tax·dividend·history·notice·twr·fx·brl·rebal-restore·transfer·flow) 전부 통과.
  `verify:calendar`는 외부 API 의존이라 baseline에서 제외.
- `memory/tools/jsxcheck.mjs` — `src` 전체 82파일 통과. `undefcheck.mjs` — 지적 0건.
- 중괄호 균형 1807/1807, 괄호 델타는 HEAD와 동일(−2, 문자열 리터럴 기인), JSX 주석 56→60(신규 4개).
- 엔진(`src/backtest.ts`)은 **한 줄도 고치지 않았다**(지시서 요구).

### 다음 단계

2단계 — `api/ai.ts`(Anthropic 프록시) + `src/aiClient.ts` + AI 설정 모달.

---

## 이번 세션 작업 내역 (2026-05-23)

### PortfolioChart 선택 기간 패널 모바일 줄바꿈 개선

**대상 파일**: `src/components/PortfolioChart.tsx`

#### 문제
모바일(좁은 폭)에서 "나의 수익" 행의 라벨(`나의 수익`)이 공백 위치에서 강제 줄바꿈되며 "+18.28%", "(+₩16,530,708)", "(시작 → 끝)" 묶음들도 단어 단위로 어색하게 잘려 가독성이 떨어짐. 내부 `<div className="flex items-center gap-1.5">`에 `flex-wrap`이 없어 컨테이너 폭 부족 시 자식 텍스트의 공백 부분에서 깨졌기 때문.

#### 변경 내용
- 5개 내부 row 컨테이너를 `flex flex-wrap items-center gap-x-1.5 gap-y-0.5`로 변경
  (나의 수익 / 나의 총자산 / 백테스트 / 비교종목 / 시장지표·금 지표 두 곳)
- 각 텍스트 `<span>`에 `whitespace-nowrap` 추가 → 라벨·% 값·금액 묶음이 단어 단위로 깨지지 않고, 의미 단위 사이에서만 줄바꿈됨

#### 검증
- 로컬 npm/node 미설치 환경 — `npm run build` 직접 실행 불가
- JSX brace/paren 균형 수동 점검 완료 (변경 5블록 모두 정상)
- Vercel 푸시가 사실상 빌드 검증

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
