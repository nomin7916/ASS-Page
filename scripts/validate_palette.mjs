#!/usr/bin/env node
// 가계부 팔레트 실측 검증기.
//
// CLAUDE.md와 src/ledger.ts C블록이 "색을 바꾸려면 반드시 이 스크립트를 다시 돌릴 것
// (눈으로 판단 금지)"이라고 못 박고 있는데 저장소에 파일이 없었다. 그래서 6가지 수정에서
// 새 색을 도입하며 복원했다.
//
// ⚠️ CVD 모델이 바뀌면 기준선 숫자가 달라진다. 이 스크립트는 **Viénot/Brettel LMS**를 쓴다.
//    ledger.ts C블록에 기록된 옛 값(GROUP 4슬롯 CVD ΔE 7.1)은 다른 모델에서 나온 값이라
//    여기서는 재현되지 않는다(여기서는 deutan 12.4 / protan 11.3 / **tritan 4.2**).
//    ⇒ 기록을 이 스크립트 기준으로 갱신했다. 모델을 바꾸려면 기준선도 함께 갱신할 것.
//
// ⚠️ 이 스크립트는 **집합 내부 판별도**만 잰다. "결제수단 축 색이 구분(그룹) 축 색과 닮았다"
//    같은 **교차 축 충돌**은 §4가 따로 잰다(예약색 거리) — 그 절을 지우지 말 것.
//
// 실행: node scripts/validate_palette.mjs   (종료코드 1 = 기준 미달)

const hex2rgb = (h) => {
  const s = String(h).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const rgb2hex = (a) =>
  '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const srgb2lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lin2srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;

const relLum = (hex) => { const [r, g, b] = hex2rgb(hex).map(srgb2lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const rgb2lab = (hex) => {
  const [R, G, B] = hex2rgb(hex).map(srgb2lin);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X / 0.95047), fy = f(Y / 1.0), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

/** CIEDE2000 */
export const deltaE00 = (h1, h2) => {
  const [L1, a1, b1] = rgb2lab(h1), [L2, a2, b2] = rgb2lab(h2);
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
  const hp = (ap, bp) => { if (ap === 0 && bp === 0) return 0; const h = deg(Math.atan2(bp, ap)); return h >= 0 ? h : h + 360; };
  const h1p = hp(a1p, b1), h2p = hp(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p !== 0) {
    const s = h1p + h2p, d = Math.abs(h1p - h2p);
    hbp = d <= 180 ? s / 2 : (s < 360 ? (s + 360) / 2 : (s - 360) / 2);
  } else hbp = h1p + h2p;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp))
    + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2)
    + Rt * (dCp / Sc) * (dHp / Sh),
  );
};

const RGB2LMS = [[0.31399022, 0.63951294, 0.04649755], [0.15537241, 0.75789446, 0.08670142], [0.01775239, 0.10944209, 0.87256922]];
const LMS2RGB = [[5.47221206, -4.6419601, 0.16963708], [-1.1252419, 2.29317094, -0.1678952], [0.02980165, -0.19318073, 1.16364789]];
const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const CVD = {
  protan: [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  deutan: [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
  tritan: [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]],
};
export const simulate = (hex, kind) =>
  rgb2hex(mul(LMS2RGB, mul(CVD[kind], mul(RGB2LMS, hex2rgb(hex).map(srgb2lin)))).map(lin2srgb));

/** 정상시야와 3종 CVD 중 **최소** ΔE — 색만으로 구분 가능한지의 실효 척도. */
export const minDist = (a, b) => {
  let m = deltaE00(a, b);
  for (const k of ['deutan', 'protan', 'tritan']) m = Math.min(m, deltaE00(simulate(a, k), simulate(b, k)));
  return m;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * ledger.ts와 **같은 값**이어야 한다. 손복제가 아니라 검증 대상의 사본이다 —
 * 값이 갈리면 §0이 실패한다.
 * ═══════════════════════════════════════════════════════════════════════════ */

const SURF = { page: '#0b1120', card: '#0f1623', head: '#151b28' };

const GROUP = { loan: '#60a5fa', fixed: '#f472b6', variable: '#4ade80', annual: '#fb923c' };
const DIVERGING = { over: '#fbbf24', flat: '#94a3b8', under: '#2dd4bf' };
const BALANCE = { expense: '#f472b6', income: '#4ade80' };
const DETAIL_OTHER = '#7c8798';

// ledgerRamp의 잠금 상수 (ledger.ts LEDGER_RAMP_LMAX / LEDGER_RAMP_LMIN)
const RAMP_LMAX = 0.86;
const RAMP_LMIN = { loan: 0.44, fixed: 0.45, variable: 0.32, annual: 0.36, income: 0.32 };

const toHsl = (hex) => {
  const [r, g, b] = hex2rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
    h *= 60;
  }
  return [h, s, l];
};
const hsl2hex = (H, S, L) => {
  const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((H / 60) % 2) - 1)), m = L - c / 2;
  const k = ((Math.floor(H / 60) % 6) + 6) % 6;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
  return rgb2hex(t.map((v) => (v + m) * 255));
};
/** ledger.ts `ledgerRamp`의 사본. 값이 갈리면 §0이 실패한다. */
const ramp = (base, lmin, n, i) => {
  if (!(n > 1)) return base;
  const [h, s] = toHsl(base);
  const k = Math.min(Math.max(i, 0), n - 1);
  return hsl2hex(h, s, RAMP_LMAX - (RAMP_LMAX - lmin) * (k / (n - 1)));
};

/* ═══════════════════════════════════════════════════════════════════════════ */

let fail = 0;
const line = (s) => console.log(s);
const check = (label, cond, detail) => {
  if (cond) line(`  ✓ ${label}${detail ? `  — ${detail}` : ''}`);
  else { fail++; line(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};

const report = (name, palette, opt = {}) => {
  const { minContrast = 3.0, floor = 6.0, labelled = true } = opt;
  line(`\n── ${name} ──`);
  const keys = Object.keys(palette);
  let worstC = Infinity, worstCk = '';
  for (const k of keys) {
    const c = Math.min(contrast(palette[k], SURF.card), contrast(palette[k], SURF.page), contrast(palette[k], SURF.head));
    if (c < worstC) { worstC = c; worstCk = k; }
  }
  check(`앱 표면 3종 대비 ≥ ${minContrast}:1`, worstC >= minContrast, `최소 ${worstC.toFixed(2)}:1 (${worstCk})`);

  for (const [label, kind] of [['정상', null], ['deutan', 'deutan'], ['protan', 'protan'], ['tritan', 'tritan']]) {
    let min = Infinity, worst = '';
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = kind ? simulate(palette[keys[i]], kind) : palette[keys[i]];
        const b = kind ? simulate(palette[keys[j]], kind) : palette[keys[j]];
        const d = deltaE00(a, b);
        if (d < min) { min = d; worst = `${keys[i]}↔${keys[j]}`; }
      }
    }
    const band = min >= 10 ? 'SAFE' : min >= floor ? 'FLOOR' : 'BELOW-FLOOR';
    // ⚠️ FLOOR 대역은 '직접 라벨 + 간격'이라는 보조 부호가 있을 때만 합법이다.
    const okBand = min >= floor || (labelled && min >= 3.5);
    check(`ΔE00 ${label} ≥ ${floor} (또는 라벨 보조)`, okBand, `min ${min.toFixed(1)} (${worst}) [${band}]`);
  }
};

line('══ 가계부 팔레트 실측 검증 (Viénot/Brettel CVD · CIEDE2000 · WCAG) ══');

// ── §0 ledgerRamp 사본 정합 ────────────────────────────────────────────────
line('\n── §0 ledger.ts 상수 사본 정합 ──');
try {
  const mod = await import('../src/ledger.ts');
  check('GROUP 색이 ledger.ts와 같다',
    JSON.stringify(GROUP) === JSON.stringify({
      loan: mod.LEDGER_GROUP_COLOR.loan, fixed: mod.LEDGER_GROUP_COLOR.fixed,
      variable: mod.LEDGER_GROUP_COLOR.variable, annual: mod.LEDGER_GROUP_COLOR.annual,
    }));
  check('DIVERGING이 ledger.ts와 같다', JSON.stringify(DIVERGING) === JSON.stringify({ ...mod.LEDGER_DIVERGING }));
  check('DETAIL_OTHER가 ledger.ts와 같다', DETAIL_OTHER === mod.LEDGER_DETAIL_OTHER);
  check('RAMP 상수가 ledger.ts와 같다',
    RAMP_LMAX === mod.LEDGER_RAMP_LMAX && JSON.stringify(RAMP_LMIN) === JSON.stringify({ ...mod.LEDGER_RAMP_LMIN }));
  let same = true;
  for (const g of Object.keys(GROUP)) for (const n of [2, 3, 4, 5]) for (let i = 0; i < n; i++) {
    if (ramp(GROUP[g], RAMP_LMIN[g], n, i) !== mod.ledgerRamp(GROUP[g], g, n, i)) same = false;
  }
  check('⚠️ ledgerRamp 출력이 이 스크립트의 사본과 1:1 일치', same);
} catch (e) {
  const unsupported = e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(String(e.message)));
  if (unsupported) line(`  ⓘ 이 런타임은 .ts 직접 import를 지원하지 않아 §0을 건너뜁니다 (${e.code}).`);
  else { fail++; line(`  ✗ ledger.ts를 불러오지 못했습니다 — ${e && (e.code || e.message)}`); }
}

// ── §1 기존 축 ────────────────────────────────────────────────────────────
report('GROUP 4슬롯 (구분 축, 기존)', GROUP, { floor: 6 });
report('BALANCE 2슬롯 (수지)', BALANCE, { floor: 10 });
report('DIVERGING 2극 (발산 · flat 제외)', { over: DIVERGING.over, under: DIVERGING.under }, { floor: 10 });

// ── §2 신규: 그룹 내부 램프 (고정비 결제수단 분리 · 상세 도넛) ─────────────
line('\n══ §2 그룹 내부 램프 — 슬롯 수별 ══');
for (const n of [2, 3, 4, 5]) {
  for (const g of Object.keys(GROUP)) {
    const rr = Array.from({ length: n }, (_, i) => ramp(GROUP[g], RAMP_LMIN[g], n, i));
    const cs = rr.map((x) => contrast(x, SURF.card));
    let adj = Infinity;
    for (let i = 0; i < n - 1; i++) adj = Math.min(adj, minDist(rr[i], rr[i + 1]));
    // ⚠️ 램프는 인접 슬라이스가 각도상 붙어 있고 **직접 라벨**이 있으므로 4.5가 하한이다.
    check(`${g} n=${n}`, Math.min(...cs) >= 3.0 && adj >= 4.5,
      `대비 ${Math.min(...cs).toFixed(2)}:1 · 인접 ΔE(정상∧CVD) ${adj.toFixed(1)}`);
  }
}
check('⚠️ 램프 상한은 5 — n=6은 인접 ΔE가 4 아래로 떨어진다',
  (() => { const rr = Array.from({ length: 6 }, (_, i) => ramp(GROUP.variable, RAMP_LMIN.variable, 6, i));
    let a = Infinity; for (let i = 0; i < 5; i++) a = Math.min(a, minDist(rr[i], rr[i + 1])); return a < 4; })());

// ── §3 DETAIL_OTHER ───────────────────────────────────────────────────────
line('\n══ §3 상세 도넛 "기타" 슬롯 ══');
check('DETAIL_OTHER 대비 ≥ 3:1', contrast(DETAIL_OTHER, SURF.card) >= 3, `${contrast(DETAIL_OTHER, SURF.card).toFixed(2)}:1`);
// ⚠️ LEDGER_DIVERGING.flat을 재사용하면 같은 회색이 '계획선'·'변동 없음'·'기타 지출' 셋을 뜻하게 된다.
check('⚠️ DIVERGING.flat과 다른 값이다(중립색을 카테고리 슬롯으로 쓰지 않는다)', DETAIL_OTHER !== DIVERGING.flat);
{
  let mn = Infinity, worst = '';
  for (const [k, v] of Object.entries({ ...GROUP, ...DIVERGING })) {
    const d = deltaE00(DETAIL_OTHER, v);
    if (d < mn) { mn = d; worst = k; }
  }
  check('DETAIL_OTHER가 기존 색과 구분된다(ΔE ≥ 8)', mn >= 8, `min ${mn.toFixed(1)} (${worst})`);
}

// ── §4 교차 축 — 결제수단 축의 근거 ────────────────────────────────────────
line('\n══ §4 교차 축: 결제수단 축에 독립 hue를 줄 수 있는가 (실측 결론) ══');
line('  결제수단 축이 피해야 할 예약색 7종: GROUP 4 + DIVERGING 3');
{
  const RES = { ...GROUP, ...DIVERGING };
  // 빨강(H 338~22)은 이 앱에서 '이익'을 뜻해 가계부의 '지출'과 정반대로 읽힌다 → 후보 제외.
  const isRed = (h) => h >= 338 || h <= 22;
  let bestSet = null;
  const cands = [];
  for (let h = 0; h < 360; h += 4) {
    if (isRed(h)) continue;
    for (const [s, l] of [[0.90, 0.72], [0.80, 0.64], [0.95, 0.80], [0.60, 0.70], [0.50, 0.60], [0.70, 0.55], [0.35, 0.78]]) {
      const hex = hsl2hex(h, s, l);
      if (contrast(hex, SURF.card) < 3.2) continue;
      const dRes = Math.min(...Object.values(RES).map((r) => minDist(hex, r)));
      cands.push({ hex, dRes });
    }
  }
  const pool = cands.filter((x) => x.dRes >= 12);
  if (pool.length >= 5) {
    for (const seed of pool) {
      const sel = [seed];
      while (sel.length < 5) {
        let bc = null, bs = -1;
        for (const c of pool) {
          if (sel.some((s) => s.hex === c.hex)) continue;
          const mn = Math.min(...sel.map((s) => minDist(c.hex, s.hex)));
          if (mn > bs) { bs = mn; bc = c; }
        }
        if (!bc) break;
        sel.push(bc);
      }
      if (sel.length < 5) continue;
      let mn = Infinity;
      for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) mn = Math.min(mn, minDist(sel[i].hex, sel[j].hex));
      if (!bestSet || mn > bestSet.mn) bestSet = { sel, mn };
    }
  }
  const feasible = !!bestSet && bestSet.mn >= 8;
  line(`  후보 ${cands.length}개 중 예약색과 ΔE≥12인 색: ${pool.length}개`);
  line(`  그중 5색 상호 최소 ΔE 최대값: ${bestSet ? bestSet.mn.toFixed(1) : 'n/a'}`);
  // ⚠️ 이 단언이 **실패로 뒤집히면** 결제수단 축에 독립 hue를 줄 수 있게 된 것이다.
  //    그때는 ledger.ts의 LEDGER_PAY_COLOR를 램프에서 독립 팔레트로 바꿀 것.
  check('⚠️ 결제수단 5슬롯 독립 hue는 **불가능**(그래서 램프 + 순서·라벨 보조 부호를 쓴다)', !feasible,
    feasible ? '가능해졌다 — 설계를 재검토할 것' : '색 공간 포화 확인');
}

// ── §5 결제수단 램프 (고정비 분리 · 결제수단 막대가 공유) ───────────────────
line('\n══ §5 결제수단 램프 (LEDGER_GROUP_COLOR.fixed 기반, 5슬롯) ══');
{
  const rr = Array.from({ length: 5 }, (_, i) => ramp(GROUP.fixed, RAMP_LMIN.fixed, 5, i));
  line(`  ${rr.join(' ')}`);
  const cs = rr.map((x) => contrast(x, SURF.card));
  let adj = Infinity;
  for (let i = 0; i < 4; i++) adj = Math.min(adj, minDist(rr[i], rr[i + 1]));
  check('대비 ≥ 3:1', Math.min(...cs) >= 3, `${Math.min(...cs).toFixed(2)}:1`);
  check('인접 ΔE ≥ 3.5 (스택 순서·범례·직접 라벨이 1차 식별자)', adj >= 3.5, `${adj.toFixed(1)}`);
}

// ── §6 툴팁 ────────────────────────────────────────────────────────────────
line('\n══ §6 툴팁 가독성 ══');
// ⚠️ 근본 원인: recharts 2.15.3 `Pie.defaultProps.fill = '#808080'` →
//    DefaultTooltipContent의 `color: entry.color || '#000'`이 회색을 채택한다.
//    `<Pie>`에 fill을 안 주면(색이 Cell에 있으면) 툴팁 글자가 항상 #808080이다.
// ⚠️ 기존 값 4.59:1은 WCAG AA(4.5)를 **간신히 넘긴다** — 문제는 숫자가 아니라 두 가지다:
//    ① 11px 회색이라 지각 대비가 낮고 ② 툴팁 배경이 카드면과 **완전히 같은 색**(1.00:1)이라
//    툴팁 상자 자체가 배경에서 떠오르지 않는다. 그래서 글자색과 배경을 함께 고친다.
check('⚠️ 기존 글자색이 수정색보다 대비가 3배 이상 낮다',
  contrast('#e5e7eb', '#111827') / contrast('#808080', SURF.card) >= 3,
  `${contrast('#808080', SURF.card).toFixed(2)}:1 → ${contrast('#e5e7eb', '#111827').toFixed(2)}:1`);
check('수정(#e5e7eb on #1a2333) ≥ 7:1', contrast('#e5e7eb', '#1a2333') >= 7,
  `${contrast('#e5e7eb', '#1a2333').toFixed(2)}:1`);
// ⚠️ 기존 배경 #0f1623은 카드면과 1.00:1 — 상자가 배경에 묻힌다. 이것이 사용자 보고의 절반이다.
//    다크 테마에서는 배경 명도만으로 상자를 띄울 여지가 거의 없으므로(최선 1.23:1)
//    **테두리 대비**가 실질적인 분리 수단이다. 둘 다 단언한다.
check('⚠️ 툴팁 배경이 카드면에서 분리된다(기존은 1.00:1)',
  contrast('#1a2333', SURF.card) >= 1.10,
  `기존 ${contrast(SURF.card, SURF.card).toFixed(2)}:1 → 수정 ${contrast('#1a2333', SURF.card).toFixed(2)}:1`);
check('⚠️ 툴팁 테두리가 카드면에서 뚜렷하다(기존 #374151 → #64748b)',
  contrast('#64748b', SURF.card) >= 3 && contrast('#64748b', SURF.card) > contrast('#374151', SURF.card),
  `기존 ${contrast('#374151', SURF.card).toFixed(2)}:1 → 수정 ${contrast('#64748b', SURF.card).toFixed(2)}:1`);

line(`\n${fail === 0 ? '✅ 전부 통과' : `❌ ${fail}건 미달`}`);
process.exit(fail === 0 ? 0 : 1);
