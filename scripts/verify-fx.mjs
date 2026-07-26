#!/usr/bin/env node
// 환율 계산기 순수 로직 검증 — src/fxRates.ts 의 참조 구현과 1:1 동기화할 것.
//
// 이 파일이 고정하는 것은 "조용히 틀린 값이 나오는" 결함들이다. 예외가 나지 않으므로
// 테스트가 없으면 회귀를 사람이 못 잡는다:
//   #1~#4  USD 피벗 변환 항등식·교차 정합
//   #5~#8  결측/비정상 환율의 null 계약 (렌더 크래시 → 앱 전체 오류 페이지 방지)
//   #9~#12 행별 등락률 = 표시 금액의 전일 대비 변화 (base 가 USD 가 아닐 때가 핵심)
//   #13~#18 금액 파싱 (콤마 포맷 재편집·통화기호·지수표기·무효 입력)
//   #19~#22 spark 배치 응답 매핑 (순서 미보장·무음 드롭)
//   #23~#26 통화 조합 정규화 (보충이 만든 중복)

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = Object.is(got, want) || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want}`); }
};
const close = (name, got, want, tol = 1e-6) => {
  const ok = typeof got === 'number' && Math.abs(got - want) <= tol;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want} (±${tol})`); }
};
const deep = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));

// ───────── 참조 구현 (src/fxRates.ts 미러) ─────────
const FX_CURRENCIES = [
  { code: 'KRW', dp: 0 }, { code: 'USD', dp: 2 }, { code: 'JPY', dp: 0 }, { code: 'EUR', dp: 2 },
  { code: 'CNY', dp: 2 }, { code: 'BRL', dp: 2 }, { code: 'GBP', dp: 2 }, { code: 'AUD', dp: 2 },
  { code: 'CAD', dp: 2 }, { code: 'CHF', dp: 2 }, { code: 'HKD', dp: 2 }, { code: 'TWD', dp: 2 },
  { code: 'SGD', dp: 2 }, { code: 'THB', dp: 2 }, { code: 'VND', dp: 0 }, { code: 'IDR', dp: 0 },
  { code: 'INR', dp: 2 }, { code: 'PHP', dp: 2 }, { code: 'MYR', dp: 2 }, { code: 'MXN', dp: 2 },
  { code: 'RUB', dp: 2 }, { code: 'TRY', dp: 2 }, { code: 'NZD', dp: 2 }, { code: 'SEK', dp: 2 },
  { code: 'NOK', dp: 2 },
];
const FX_DEFAULT = ['KRW', 'USD', 'JPY'];
const FX_MIN_SLOTS = 2, FX_MAX_SLOTS = 3;
const isFxCode = (c) => FX_CURRENCIES.some((x) => x.code === c);

const convertFx = (amount, from, to, rates) => {
  const f = rates?.[from], t = rates?.[to];
  if (!f || !t) return null;
  if (!Number.isFinite(amount)) return null;
  if (!(f.rate > 0) || !(t.rate > 0)) return null;
  const v = (amount * t.rate) / f.rate;
  return Number.isFinite(v) ? v : null;
};

const fxChangePct = (from, to, rates) => {
  const a = rates?.[from], b = rates?.[to];
  if (!a || !b) return null;
  if (!(a.rate > 0) || !(b.rate > 0)) return null;
  if (!(a.prevRate > 0) || !(b.prevRate > 0)) return null;
  const v = (b.rate / a.rate) / (b.prevRate / a.prevRate) - 1;
  return Number.isFinite(v) ? v * 100 : null;
};

const parseFxAmount = (s) => {
  const t = String(s ?? '')
    .replace(/[\s,_]/g, '')
    .replace(/^[^\d.+-]+/, '')
    .replace(/[^\d.]+$/, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const quoteFromMeta = (m) => {
  const rate = Number(m?.regularMarketPrice);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const prev = Number(m?.chartPreviousClose);
  const at = Number(m?.regularMarketTime);
  return {
    rate,
    prevRate: Number.isFinite(prev) && prev > 0 ? prev : null,
    at: Number.isFinite(at) && at > 0 ? at : null,
  };
};

const mapSparkQuotes = (json, wanted) => {
  const bySymbol = new Map();
  for (const r of json?.spark?.result ?? []) {
    if (r && typeof r.symbol === 'string') bySymbol.set(r.symbol, r?.response?.[0]?.meta);
  }
  const rates = {}, missing = [];
  for (const code of wanted) {
    const q = quoteFromMeta(bySymbol.get(`${code}=X`));
    if (q) rates[code] = q; else missing.push(code);
  }
  return { rates, missing };
};

const normalizeFxCurrencies = (v) => {
  const known = (Array.isArray(v) ? v : []).filter((c) => typeof c === 'string' && isFxCode(c));
  const out = [];
  for (const c of [...known, ...FX_DEFAULT, ...FX_CURRENCIES.map((x) => x.code)]) {
    if (!out.includes(c)) out.push(c);
    if (out.length === FX_MAX_SLOTS) break;
  }
  return out;
};

const normalizeFxSlotCount = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return FX_MIN_SLOTS;
  return Math.min(FX_MAX_SLOTS, Math.max(FX_MIN_SLOTS, n));
};

// ───────── 실측 고정값 (2026-07-27 야후, USD 1단위당 통화) ─────────
const R = {
  USD: { rate: 1, prevRate: 1, at: null },
  KRW: { rate: 1459.42, prevRate: 1474.13, at: 1785073771 },
  JPY: { rate: 163.791, prevRate: 163.762, at: 1784926798 },
  BRL: { rate: 5.087, prevRate: 5.0905, at: 1785073772 },
};

console.log('\n■ USD 피벗 변환');
close('#1 USD→KRW = 그 통화의 rate', convertFx(1, 'USD', 'KRW', R), 1459.42);
close('#2 KRW→USD 는 역수 (1,000,000원)', convertFx(1000000, 'KRW', 'USD', R), 1000000 / 1459.42, 1e-9);
// 직접 교차쌍 BRLKRW=X 실측 286.93 대비 0.02% 이내 — 피벗이 교차쌍과 정합
close('#3 KRW→BRL 이 직접 교차쌍과 일치', convertFx(286.89, 'KRW', 'BRL', R), 1, 1e-3);
close('#4 왕복 항등 (KRW→JPY→KRW)', convertFx(convertFx(50000, 'KRW', 'JPY', R), 'JPY', 'KRW', R), 50000, 1e-6);

console.log('\n■ 결측·비정상 환율의 null 계약 (렌더 크래시 방지)');
eq('#5 로딩 중 빈 맵 → null (throw 금지)', convertFx(1000, 'KRW', 'USD', {}), null);
eq('#6 부분 성공: 타깃 통화 누락 → null', convertFx(1000, 'KRW', 'BRL', { KRW: R.KRW, USD: R.USD }), null);
eq('#7 rate 0 → null (Infinity 차단)', convertFx(1000, 'KRW', 'USD', { ...R, KRW: { rate: 0, prevRate: 1, at: null } }), null);
eq('#8 금액 NaN/빈칸 → null', convertFx(NaN, 'KRW', 'USD', R), null);

console.log('\n■ 행별 등락률 = 표시 금액의 전일 대비 변화');
// ⚠️ '통화 자기 변화율'(rate/prevRate−1)로 구현하면 base=KRW 일 때 USD 행이 항상 0.00% 로 굳는다.
close('#9  base=KRW → USD 행', fxChangePct('KRW', 'USD', R), 1.00793, 1e-4);
close('#10 base=KRW → BRL 행', fxChangePct('KRW', 'BRL', R), 0.93849, 1e-4);
close('#11 base=USD → KRW 행 (일반화)', fxChangePct('USD', 'KRW', R), -0.99788, 1e-4);
eq('#12 from===to → 정확히 0', fxChangePct('KRW', 'KRW', R), 0);
eq('#12b prevRate 없으면 null (0.00% 단언 금지)',
  fxChangePct('KRW', 'USD', { KRW: { rate: 1459.42, prevRate: null, at: null }, USD: R.USD }), null);

console.log('\n■ 금액 파싱');
eq('#13 콤마 포맷 재편집 (parseFloat 이면 1 이 됨)', parseFxAmount('1,000,0000'), 10000000);
eq('#14 대시보드 복사값 ₩1,000,000', parseFxAmount('₩1,000,000'), 1000000);
eq('#15 지수표기 보존', parseFxAmount('1e+21'), 1e21);
eq('#16 무효 입력 → null (부분 파싱 금지)', parseFxAmount('12x34'), null);
eq('#17 빈칸/부호만 → null', parseFxAmount('-'), null);
eq('#18 소수점 2개 → null', parseFxAmount('1.2.3'), null);
eq('#18b 뒤쪽 단위 표기 제거', parseFxAmount('1,000 원'), 1000);
eq('#18c 퍼센트 표기 제거', parseFxAmount('3.5%'), 3.5);
eq('#18d 앞쪽 기호 + 음수', parseFxAmount('R$-5.25'), -5.25);

console.log('\n■ spark 배치 응답 매핑 (순서 미보장·무음 드롭)');
const sparkOf = (syms) => ({
  spark: {
    error: null,
    result: syms.map((s) => ({
      symbol: s,
      // ⚠️ meta.symbol 은 'KRW=X'/'USDKRW=X' 로 번갈아 오므로 키로 쓰면 안 된다 — 그 상황을 재현
      response: [{ meta: { symbol: `USD${s.replace('=X', '')}=X`, regularMarketPrice: { 'KRW=X': 1459.42, 'JPY=X': 163.791, 'BRL=X': 5.087 }[s], chartPreviousClose: { 'KRW=X': 1474.13, 'JPY=X': 163.762, 'BRL=X': 5.0905 }[s], regularMarketTime: 1785073771 } }],
    })),
  },
});
{
  // 실측 재현: 요청 KRW,JPY,BRL → 응답 JPY,BRL,KRW
  const { rates, missing } = mapSparkQuotes(sparkOf(['JPY=X', 'BRL=X', 'KRW=X']), ['KRW', 'JPY', 'BRL']);
  eq('#19 뒤섞인 응답에서도 KRW 가 KRW 환율을 받는다', rates.KRW?.rate, 1459.42);
  eq('#20 뒤섞인 응답에서도 JPY 가 JPY 환율을 받는다', rates.JPY?.rate, 163.791);
  deep('#21 누락 없음', missing, []);
}
{
  // 실측 재현: 조회 실패 심볼은 error 없이 배열에서 사라진다
  const { rates, missing } = mapSparkQuotes(sparkOf(['BRL=X', 'KRW=X']), ['KRW', 'JPY', 'BRL']);
  eq('#22 무음 드롭된 JPY 는 맵에 없다 (다른 통화로 밀리지 않음)', rates.JPY, undefined);
  deep('#22b 누락 목록으로 개별 폴백 대상 식별', missing, ['JPY']);
  eq('#22c 남은 통화는 정상', rates.BRL?.rate, 5.087);
}
eq('#22d 응답 자체가 null → 전량 누락', mapSparkQuotes(null, ['KRW']).missing.length, 1);

console.log('\n■ 통화 조합 정규화');
deep('#23 정상값 보존', normalizeFxCurrencies(['KRW', 'USD', 'BRL']), ['KRW', 'USD', 'BRL']);
// ⚠️ dedupe 를 보충보다 먼저 하면 여기서 ['KRW','KRW','USD'] 같은 중복이 남는다
deep('#24 부족분 보충 후에도 중복 없음', normalizeFxCurrencies(['JPY']), ['JPY', 'KRW', 'USD']);
deep('#25 미지원 코드·중복·비배열 방어', normalizeFxCurrencies(['XXX', 'KRW', 'KRW', null]), ['KRW', 'USD', 'JPY']);
deep('#25b null 입력 → 기본값', normalizeFxCurrencies(null), FX_DEFAULT);
deep('#25c 4개 이상 → 3개로 절단', normalizeFxCurrencies(['EUR', 'GBP', 'CHF', 'SEK']), ['EUR', 'GBP', 'CHF']);
eq('#26 슬롯 수 클램프 (하한)', normalizeFxSlotCount(1), 2);
eq('#26b 슬롯 수 클램프 (상한)', normalizeFxSlotCount(9), 3);
eq('#26c 손상값 → 하한', normalizeFxSlotCount('x'), 2);

console.log(`\n${fail === 0 ? '✅' : '❌'} verify:fx — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
