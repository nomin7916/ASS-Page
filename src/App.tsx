const SHEET_NAME = 'data';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const now = new Date();
    const timestamp = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    const label = body.label || '수동 저장';
    const jsonStr = JSON.stringify(body.data);
    
    sheet.appendRow([timestamp, label, jsonStr]);
    
    return jsonResponse({ 
      success: true, 
      message: '저장 완료', 
      savedAt: timestamp,
      totalRows: sheet.getLastRow()
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 한국투자증권 API 시세 조회 ──
const KIS_CONFIG = {
  APP_KEY: 'PSlSeDjbr9JtPAmT8Vl05lvSXqZibvvNQRv4',
  APP_SECRET: '2GSn5kqJyGu3oGfyqKf6DEiWkX+fASE6aDXpCOsbxg3DkU2dhWMc/UduMWnhM01ncjvrOD8080ICEhypvrNM+MtLpCyb0n5rzPV6N19cpiKsry6wg5068ZQyvNyIXjloClcZZEZThw943Ud9gi6hyNZikNH/RlcYjeqi+bn+c7D3w1cSET0=',
  ACCTNO: '68095391',
  BASE_URL: 'https://openapi.koreainvestment.com:9443'
};

function getKisToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('kis_token');
  if (cached) return cached;

  const res = UrlFetchApp.fetch(KIS_CONFIG.BASE_URL + '/oauth2/tokenP', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: KIS_CONFIG.APP_KEY,
      appsecret: KIS_CONFIG.APP_SECRET
    })
  });
  const token = JSON.parse(res.getContentText()).access_token;
  cache.put('kis_token', token, 43000);
  return token;
}

function getStockPrice(code) {
  const token = getKisToken();
  const url = KIS_CONFIG.BASE_URL + '/uapi/domestic-stock/v1/quotations/inquire-price'
    + '?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=' + code;

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'authorization': 'Bearer ' + token,
      'appkey': KIS_CONFIG.APP_KEY,
      'appsecret': KIS_CONFIG.APP_SECRET,
      'tr_id': 'FHKST01010100'
    }
  });
  const data = JSON.parse(res.getContentText());
  const o = data.output;
  return {
    code: code,
    name: o.hts_kor_isnm,
    price: Number(o.stck_prpr),
    change: Number(o.prdy_vrss),
    changeRate: Number(o.prdy_ctrt),
    high: Number(o.stck_hgpr),
    low: Number(o.stck_lwpr),
    volume: Number(o.acml_vol)
  };
}

function getMultipleStockPrices(codes) {
  const results = {};
  for (const code of codes) {
    try {
      results[code] = getStockPrice(code);
      Utilities.sleep(100);
    } catch (e) {
      results[code] = { code: code, error: e.message };
    }
  }
  return results;
}

// ════════════════════════════════════════════════
// 시장지표 프록시 (CORS 우회용)
// ════════════════════════════════════════════════

function handleIndicators() {
  var result = {};

  // 1. KOSPI
  result.kospi = fetchNaverIndex('https://m.stock.naver.com/api/index/KOSPI/basic', '네이버');

  // 2. S&P500
  result.sp500 = fetchNaverIndex('https://m.stock.naver.com/api/index/SPI@SPX/basic', '네이버해외');

  // 3. Nasdaq100
  result.nasdaq = fetchNaverIndex('https://m.stock.naver.com/api/index/NAS@NDX/basic', '네이버해외');

  // 4. KR 10Y 채권
  result.kr10y = fetchNaverIndex('https://m.stock.naver.com/api/marketIndex/bond/KR10YT=RR', '네이버채권');

  // 5. USD/KRW 환율
  result.usdkrw = fetchNaverIndex('https://m.stock.naver.com/api/marketIndex/exchange/FX_USDKRW', '네이버환율');

  // 6. 국내 금 시세
  result.goldKr = fetchNaverIndex('https://m.stock.naver.com/api/marketIndex/metals/M04020000', '네이버금시세');

  // 7. US 10Y 채권 (Yahoo)
  result.us10y = fetchYahooQuote('^TNX', 'Yahoo(US10Y)');

  // 8. DXY 달러인덱스 (Yahoo)
  result.dxy = fetchYahooQuote('DX-Y.NYB', 'Yahoo(DXY)');

  // 9. 국제 금 (Yahoo)
  result.goldIntl = fetchYahooQuote('GC=F', 'Yahoo(Gold)');

  // 10. 미국 기준금리
  result.fedRate = fetchFedRate();

  return jsonResponse({ success: true, data: result });
}

function fetchNaverIndex(url, source) {
  try {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.getResponseCode() !== 200) {
      return { price: null, change: null, source: source + ' HTTP' + res.getResponseCode() };
    }
    var data = JSON.parse(res.getContentText());
    var price = parseFloat(String(data.closePrice || data.price || '0').replace(/,/g, ''));
    var change = data.fluctuationsRatio ? parseFloat(data.fluctuationsRatio) : null;
    if (price > 0) {
      return { price: price, change: change, source: source };
    }
    return { price: null, change: null, source: source + ' 파싱실패' };
  } catch (e) {
    return { price: null, change: null, source: source + ' 에러' };
  }
}

function fetchYahooQuote(symbol, source) {
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?range=2d&interval=1d';
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.getResponseCode() !== 200) {
      return { price: null, change: null, source: source + ' HTTP' + res.getResponseCode() };
    }
    var json = JSON.parse(res.getContentText());
    var meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;
    if (meta && meta.regularMarketPrice) {
      var price = meta.regularMarketPrice;
      var prevClose = meta.chartPreviousClose || meta.previousClose;
      var change = prevClose ? ((price / prevClose) - 1) * 100 : null;
      return { price: price, change: change, source: source };
    }
    return { price: null, change: null, source: source + ' 데이터없음' };
  } catch (e) {
    return { price: null, change: null, source: source + ' 에러' };
  }
}

function fetchFedRate() {
  // TradingEconomics HTML 파싱
  try {
    var url = 'https://tradingeconomics.com/united-states/interest-rate';
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.getResponseCode() === 200) {
      var html = res.getContentText();
      var match = html.match(/id="p"[^>]*>\s*([\d,]+\.?\d*)/);
      if (!match) match = html.match(/"last":\s*([\d,.]+)/);
      if (match) {
        var price = parseFloat(match[1].replace(/,/g, ''));
        var chgMatch = html.match(/id="pch"[^>]*>\s*([+-]?[\d,]*\.?\d+)%?/);
        var change = chgMatch ? parseFloat(chgMatch[1].replace(/,/g, '')) : null;
        if (price > 0) {
          return { price: price, change: change, source: 'TradingEconomics' };
        }
      }
    }
  } catch (e) {}
  return { price: null, change: null, source: '기준금리 수집실패' };
}

// ════════════════════════════════════════════════

function doGet(e) {
  try {
    var action = e.parameter.action;

    // 시장지표 프록시
    if (action === 'indicators') {
      return handleIndicators();
    }

    // KIS 종목 시세 조회
    if (action === 'price') {
      var codes = (e.parameter.codes || '').split(',').filter(function(c) { return c.trim(); });
      if (codes.length === 0) return jsonResponse({ success: false, error: '종목코드 필요' });
      var prices = getMultipleStockPrices(codes);
      return jsonResponse({ success: true, prices: prices });
    }

    // 기본: GSheet에서 최신 데이터 불러오기
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    var lastRow = sheet.getLastRow();
    if (lastRow < 1) {
      return jsonResponse({ success: true, data: null, message: '저장된 데이터 없음' });
    }
    var row = sheet.getRange(lastRow, 1, 1, 3).getValues()[0];
    var jsonData = JSON.parse(row[2]);
    return jsonResponse({
      success: true,
      data: jsonData,
      savedAt: row[0],
      label: row[1]
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}
