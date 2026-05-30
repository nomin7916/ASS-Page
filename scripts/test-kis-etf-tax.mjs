// KIS OpenAPI — ETF 과표기준가 조회 테스트
// 실행: node --env-file=.env.local scripts/test-kis-etf-tax.mjs
//   (Node 20 미만: KIS_APP_KEY=xxx KIS_APP_SECRET=yyy node scripts/test-kis-etf-tax.mjs)

const KIS_BASE       = 'https://openapi.koreainvestment.com:9443';
const KIS_APP_KEY    = process.env.KIS_APP_KEY    ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

const TARGET_DATE = '20260521';  // 조회 대상 날짜 (YYYYMMDD)
const CODES = ['498400', '0190G0'];

// ── 토큰 발급 ─────────────────────────────────────────────────────────────────
async function getToken() {
  const res  = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(json)}`);
  console.log('✅ 토큰 발급 완료\n');
  return json.access_token;
}

// ── GET 요청 헬퍼 ─────────────────────────────────────────────────────────────
async function kisGet(token, path, trId, params) {
  const url = `${KIS_BASE}${path}?${new URLSearchParams(params)}`;
  console.log(`  [${trId}] ${path}`);
  const res  = await fetch(url, {
    headers: {
      'Content-Type':  'application/json',
      'authorization': `Bearer ${token}`,
      'appkey':        KIS_APP_KEY,
      'appsecret':     KIS_APP_SECRET,
      'tr_id':         trId,
      'custtype':      'P',
    },
  });
  const json = await res.json();
  const rtCd = json.rt_cd ?? '?';
  const msg  = json.msg1  ?? '';
  console.log(`  → rt_cd=${rtCd}  msg="${msg}"`);

  // 과표기준가 관련 필드 추출 (output1 = 당일 데이터, output2 = 기간 데이터 배열)
  const out1 = json.output ?? json.output1 ?? null;
  const out2 = json.output2 ?? null;

  if (out1 && typeof out1 === 'object') {
    console.log('  ▶ output1 (당일):');
    // 전체 출력 (과표 관련 여부 파악용)
    for (const [k, v] of Object.entries(out1)) {
      if (v !== '' && v !== '0' && v !== null) console.log(`     ${k}: ${v}`);
    }
  }
  if (Array.isArray(out2) && out2.length > 0) {
    // 날짜와 일치하는 행 찾기
    const row = out2.find(r => (r.stck_bsop_date ?? r.bass_dt ?? '') === TARGET_DATE)
             ?? out2[0];
    console.log(`  ▶ output2[${TARGET_DATE} 행]:`, JSON.stringify(row));
  }
  if (!out1 && !out2) {
    console.log('  ▶ output 없음:', JSON.stringify(json).slice(0, 300));
  }
  console.log();
  return json;
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) {
    console.error('❌ KIS_APP_KEY / KIS_APP_SECRET 환경변수를 설정하세요.');
    console.error('   실행법: node --env-file=.env.local scripts/test-kis-etf-tax.mjs');
    process.exit(1);
  }

  const token = await getToken();

  for (const code of CODES) {
    console.log(`${'='.repeat(60)}`);
    console.log(`  코드: ${code}  /  날짜: ${TARGET_DATE}`);
    console.log('='.repeat(60));

    // ① 국내주식 일별 시세 — 가장 기본적인 ETF 가격 조회
    //    FID_ORG_ADJ_PRC=0: 수정주가, 1: 원주가
    await kisGet(token,
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      'FHKST03010100',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD:         code,
        FID_INPUT_DATE_1:       TARGET_DATE,
        FID_INPUT_DATE_2:       TARGET_DATE,
        FID_PERIOD_DIV_CODE:    'D',
        FID_ORG_ADJ_PRC:        '0',
      }
    );

    // ② ETF 전용 TR — FHPST02400000 (ETF 기준가 시세)
    //    과표기준가 필드가 있을 경우 여기에 포함될 가능성 높음
    await kisGet(token,
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      'FHPST02400000',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD:         code,
      }
    );

    // ③ 기간별 ETF 과표기준가 전용 TR — FHPST02410000
    await kisGet(token,
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      'FHPST02410000',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD:         code,
        FID_INPUT_DATE_1:       TARGET_DATE,
        FID_INPUT_DATE_2:       TARGET_DATE,
        FID_PERIOD_DIV_CODE:    'D',
        FID_ORG_ADJ_PRC:        '0',
      }
    );

    // ④ 시장구분 코드 'E' (ETF 전용 시장) 으로 시도
    await kisGet(token,
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      'FHKST01010100',
      {
        FID_COND_MRKT_DIV_CODE: 'E',
        FID_INPUT_ISCD:         code,
      }
    );
  }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
