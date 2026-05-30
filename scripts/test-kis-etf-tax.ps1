# KIS OpenAPI — ETF 과표기준가 조회 테스트 (PowerShell)
# 실행법:
#   .\scripts\test-kis-etf-tax.ps1 -Key "앱키" -Secret "시크릿"
#   또는 환경변수 KIS_APP_KEY / KIS_APP_SECRET 이 설정된 경우:
#   .\scripts\test-kis-etf-tax.ps1
param(
  [string]$Key    = $env:KIS_APP_KEY,
  [string]$Secret = $env:KIS_APP_SECRET,
  [string]$Date   = "20260521"    # 조회 날짜 (YYYYMMDD)
)

if (-not $Key -or -not $Secret) {
  Write-Error "KIS_APP_KEY / KIS_APP_SECRET 이 필요합니다."
  Write-Host "실행법: .\scripts\test-kis-etf-tax.ps1 -Key '앱키' -Secret '시크릿'"
  exit 1
}

$BASE = "https://openapi.koreainvestment.com:9443"
$CODES = @("498400", "0190G0")

# ── 토큰 발급 ──────────────────────────────────────────────────────────────────
Write-Host "KIS 토큰 발급 중..."
$body = @{ grant_type = "client_credentials"; appkey = $Key; appsecret = $Secret } | ConvertTo-Json
$token = (Invoke-RestMethod -Uri "$BASE/oauth2/tokenP" -Method Post -ContentType "application/json" -Body $body).access_token
if (-not $token) { Write-Error "토큰 발급 실패"; exit 1 }
Write-Host "토큰 발급 완료`n"

function KisGet {
  param([string]$TrId, [string]$Path, [hashtable]$Params)
  $qs  = ($Params.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "&"
  $url = "$BASE$Path`?$qs"
  Write-Host "  [$TrId]"
  $headers = @{
    "authorization" = "Bearer $token"
    "appkey"        = $Key
    "appsecret"     = $Secret
    "tr_id"         = $TrId
    "custtype"      = "P"
  }
  try {
    $res = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
    Write-Host "  → rt_cd=$($res.rt_cd)  msg=$($res.msg1)"

    # output1 전체 출력
    $out1 = if ($res.output) { $res.output } elseif ($res.output1) { $res.output1 } else { $null }
    if ($out1) {
      Write-Host "  ▶ output1 (당일 데이터):"
      $out1.PSObject.Properties | Where-Object { $_.Value -notin @('', '0', $null) } |
        ForEach-Object { Write-Host "     $($_.Name): $($_.Value)" }
    }

    # output2 — 날짜 일치 행
    if ($res.output2) {
      $row = $res.output2 | Where-Object { $_.stck_bsop_date -eq $Date -or $_.bass_dt -eq $Date } | Select-Object -First 1
      if (-not $row) { $row = $res.output2[0] }
      Write-Host "  ▶ output2 [$Date 행]: $($row | ConvertTo-Json -Compress)"
    }

    if (-not $out1 -and -not $res.output2) {
      Write-Host "  ▶ 전체 응답: $($res | ConvertTo-Json -Compress -Depth 3)"
    }
  } catch {
    Write-Host "  ❌ 오류: $_"
  }
  Write-Host ""
}

foreach ($code in $CODES) {
  Write-Host ("=" * 60)
  Write-Host "  코드: $code  /  조회날짜: $Date"
  Write-Host ("=" * 60)

  # ① 국내주식 일별 시세 (ETF 포함, 가장 기본)
  KisGet -TrId "FHKST03010100" `
    -Path "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice" `
    -Params @{
      FID_COND_MRKT_DIV_CODE = "J"
      FID_INPUT_ISCD         = $code
      FID_INPUT_DATE_1       = $Date
      FID_INPUT_DATE_2       = $Date
      FID_PERIOD_DIV_CODE    = "D"
      FID_ORG_ADJ_PRC        = "0"
    }

  # ② ETF 기준가 전용 TR (과표기준가 포함 가능성)
  KisGet -TrId "FHPST02400000" `
    -Path "/uapi/domestic-stock/v1/quotations/inquire-price" `
    -Params @{
      FID_COND_MRKT_DIV_CODE = "J"
      FID_INPUT_ISCD         = $code
    }

  # ③ ETF 과표기준가 기간조회 전용 TR
  KisGet -TrId "FHPST02410000" `
    -Path "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice" `
    -Params @{
      FID_COND_MRKT_DIV_CODE = "J"
      FID_INPUT_ISCD         = $code
      FID_INPUT_DATE_1       = $Date
      FID_INPUT_DATE_2       = $Date
      FID_PERIOD_DIV_CODE    = "D"
      FID_ORG_ADJ_PRC        = "0"
    }
}
