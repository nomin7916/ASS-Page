// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Check, Calendar as CalIcon, Trash2, ExternalLink } from 'lucide-react';
import { BG } from '../design';
import { generateId, formatNumber, cleanNum, isValidIsoDate, collectTransferRows, formatCurrency, formatPercent, EMPTY_HIST_DETAIL } from '../utils';
import { getTodayKST } from '../hooks/useMarketCalendar';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

// 비차단·이동 가능 플로팅 창 (FloatingCalculator/WatchlistPopup과 동일 규칙).
// - 단일 position:fixed div (백드롭/오버레이 없음 → 아래 앱 클릭·스크롤 통과 → 탭 전환·이동 가능)
// - z 1050(달력 창) / 1060(메모 패드): dialog 1000 < 여기 < LoadingOverlay 1100
// - 타이틀 바만 드래그 핸들, window mousemove/touchmove 리스너로 이동, 뷰포트 클램프
const CAL_Z = 1050;
const PAD_Z = 1060;
// 날짜 칸은 칩 3종을 **세로**로 쌓고(가로 스크롤 폐지) 그 아래 사용자 메모 목록을 둔다.
// 세 값은 한 세트다 — CELL_H를 줄이면 칩이 메모를 밀어내고, CAL_W를 줄이면 칩의 계좌명이
// truncate로 사라진다(칸 텍스트 가용폭 ≈ CAL_W/7 − padding·border).
const CAL_W = 1200;      // 달력 창 폭(px). 좁은 화면은 maxWidth로 클램프
const CELL_H = 180;      // 날짜 칸 최소 높이(px)
const CELL_MEMO_H = 74;  // 칸 안 사용자 메모 목록 최대 높이(px)
const PAD_W = 576;   // 메모 패드 폭(px)
// 계좌별 현황 패드만 넓게 — 7열(계좌·투자원금·평가금액·비중·예수금·수익·수익률) 표라 576px에서는
// 원화 금액(₩612,856,076 = 12자)이 줄바꿈된다. 드래그 클램프(:164)·중앙 배치(:141)는
// padRef.offsetWidth를 실측하므로 이 값만 바꿔도 자동으로 따라온다.
const PAD_W_DETAIL = 760;
// variant='page'(별도 브라우저 창) 전용 — 헤더+요일줄+패딩이 먹는 세로(px).
// ⚠️ 페이지 모드 칸 높이는 CSS `fr`이 아니라 **JS로 뷰포트에서 역산**한다: 그리드가 높이 불확정
//    컨테이너 안에 있으면 `minmax(X, 1fr)`의 fr이 늘어나지 않아(그리드 fr 트랩) 칸이 CELL_H에
//    그대로 머문다 — 창을 키운 의미가 사라진다.
const PAGE_CHROME_H = 108;
const PAGE_CELL_FIXED_H = 112;  // 페이지 모드에서 날짜줄+지표3줄+칩3줄이 쓰는 세로 — 나머지가 메모 목록
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const pad2 = (n) => String(n).padStart(2, '0');
const dayKeyOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const firstLine = (s) => {
  const t = (s || '').trim();
  const i = t.indexOf('\n');
  return i === -1 ? t : t.slice(0, i);
};
// PICK(계좌 선택 목록) 패드 형태 — 상세에서 ✕/Esc로 뒤로 갈 때도 **이 형태로 재구성**한다.
// ⚠️ 목록 스냅샷을 값으로 들고 뒤로 가지 말 것 — note·qty·transfer는 라이브 파생이라 복사본을
//    들면 원본이 바뀐 뒤 돌아왔을 때 목록만 옛 값으로 갈라진다(모든 패드의 앵커 계약과 동일 근거).
const pickPad = (dayKey, pickKind) => ({ kind: 'pick', dayKey, pickKind });

// 포트폴리오 스냅샷 표시용 포맷터 (달력 칸 = 억/만 축약, 메모장 = 풀 숫자).
const nfmt = (n) => Math.round(n).toLocaleString('en-US');
const fmtAbbrev = (n) => {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e8) return `${sign}₩${(a / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${sign}₩${nfmt(a / 1e4)}만`;
  return `${sign}₩${nfmt(a)}`;
};
const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
// 계좌별 현황 표 전용 포매터 — 통합 대시보드 팝업과 **문자 단위로 같은 표기**를 낸다
// (utils.formatCurrency/formatPercent 공유). '같은 표'라고 고지한 두 화면이 손실 계좌에서
// `-₩1,234,567` vs `₩-1,234,567`, 수익률에서 `12.34%` vs `+12.34%`로 갈리면 안 된다.
// ⚠️ 같은 파일의 `fmtPct`(칸·밴드용, `+` 부호 표기)를 이 표에 쓰지 말 것 — 표기가 갈릴 뿐 아니라
//    **null-safe가 아니다**(`null >= 0`이 true라 `null.toFixed(2)`에서 던진다).
// ⚠️ 반대로 `formatPercent`는 `cleanNum`을 거쳐 null을 `0.00%`로 만든다 — `buildHistDetailRows`의
//    `weight`·`totalReturnRate`는 **산출 불가 시 null** 계약이므로 그 가드를 여기서 지킨다
//    (`0.00%`로 단언하면 '변동 없음'과 구분되지 않는다 — dodAbsChange 규약과 동일).
const pctCell = (v) => (v == null || !Number.isFinite(v) ? '-' : formatPercent(v));
// 금액 가리기(전역 표시 설정)를 존중하는 원화 표기.
const maskMoney = (n, hidden) => (hidden ? '••••••' : formatCurrency(n));
// 목표비중 기록용 — 수량은 소수(펀드 좌수) 가능, 금액은 계좌 통화(overseas=USD) 따라 표기.
// ⚠️ 원화 환산 금지(환율 시점이 섞여 가짜 손익이 생긴다 — CLAUDE.md 해외계좌 규약).
// ⚠️ 수량은 리밸런싱 표와 **같은 포매터**를 써야 한다 — 자체 포매터를 두면 펀드 좌수처럼 소수
// 수량에서 자릿수가 갈려(4자리 vs 3자리) 사용자가 "기록이 화면과 다르다"고 오인한다.
const qfmt = (n) => formatNumber(n);
const fmtMoney = (n, currency) => currency === 'USD'
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
  : `₩${nfmt(Number(n) || 0)}`;
// 한국식 손익 색상: 이익=빨강, 손실=파랑, 0=회색.
const pnlColor = (v) => (v > 0 ? 'text-red-400' : v < 0 ? 'text-blue-400' : 'text-gray-400');

// 달력 메모 창 — 헤더의 달력 아이콘으로 진입. **4종 기록 허브**(날짜 칸의 버튼식 칩).
//   📊 rebalTarget : calendarMemos에 저장된 목표비중 스냅샷. 그 시점 시세·수량을 사후 재현할 수
//                    없어 **유일하게 복사 저장**하는 종류. 읽기 전용 + 같은 날 투자기록 동반 표시.
//   📝 note        : 리밸런싱 패널 '투자 기록'(portfolios[].investmentNotes) — **라이브 파생**.
//                    보기·편집·새 작성 모두 가능하고 패널 스트립과 즉시 동기화된다.
//   🔄 qty         : 종목 수량 변경(portfolios[].holdingSnapshots 인접 diff) — **라이브 파생**.
//   📊 assets      : 그 날짜의 계좌별 현황(통합 대시보드 추이표 팝업과 동일 표) — **라이브 파생**.
//                    칩이 아니라 **날짜 칸의 자산 스냅샷 3줄 블록**을 눌러 연다. 읽기 전용.
//   🔵 memo        : calendarMemos의 사용자 메모 { id, content, createdAt }.
// ⚠️ 파생 2종(note·qty)을 calendarMemos에 **복사 금지** — 복사하면 리밸런싱 패널 메모장·자산검증
//    스냅샷과 갈라져 두 화면이 다른 값을 보인다. 반드시 원본에서 매 렌더 재조회.
// ⚠️ 모든 패드는 값 복사가 아니라 **앵커(id) + 라이브 재조회** — upsert·삭제 후 stale 방지.
// variant='floating'(기본, 인앱 플로팅 창) | 'page'(별도 브라우저 창을 가득 채우는 모드).
//   두 모드는 **같은 컴포넌트**를 쓴다 — 그리드·패드·파생 인덱스를 복제하면 두 화면이 갈라진다.
//   page 모드는 바깥 chrome(드래그·중앙 배치·둥근 모서리)만 끄고 칸 높이를 뷰포트에서 역산한다.
// readOnly: 앱 탭과의 브릿지가 끊긴 새 창(저장할 곳이 없음) — 입력 진입점을 전부 막는다.
// 계좌별 현황(ASSET 패드) 공급 2모드 — 인앱과 별도 창은 **다른 경로로 같은 utils 함수**를 쓴다.
//   ① 인앱   : buildHistDetail(dayKey) 를 **동기 호출**(App이 utils.buildHistDetailRows를 바인딩).
//              값 복사가 없어 패드의 '앵커 + 라이브 재조회' 계약이 그대로 지켜진다.
//   ② 별도 창 : 그 창은 App을 마운트하지 않고 **잘린 원장만** 받으므로 스스로 계산할 수 없다 →
//              onRequestAccountDetail(dayKey|null)로 앱 탭에 구독을 등록/해제하고, 앱이 보내 준
//              accountDetail({date,status,rows,…})을 그대로 렌더한다.
//   둘 다 없으면 클릭 진입점 자체를 만들지 않는다(hover 강조도 없음 → 죽은 클릭 방지).
export default function CalendarModal({ open, onClose, memos = {}, onUpdateMemos, holidays = { kr: [], us: [] }, notify, confirm, metricsHistory = [], todayReturnRate = null, fxHistory = null, us10yHistory = null, liveFx = null, liveUs10y = null, portfolios = [], activePortfolioId = null, onUpdateInvestmentNotes = null, variant = 'floating', readOnly = false, headerNotice = null, onOpenWindow = null, buildHistDetail = null, accountDetail = null, onRequestAccountDetail = null, hideAmounts = false }) {
  const isPage = variant === 'page';
  const todayStr = getTodayKST();
  const tp = todayStr.split('-');
  const ty = parseInt(tp[0], 10);
  const tm = parseInt(tp[1], 10) - 1;

  const [viewYear, setViewYear] = useState(ty);
  const [viewMonth, setViewMonth] = useState(tm);
  // pad: null | { dayKey, mode: 'new'|'edit', memoId, val }
  // backPick: PICK 목록을 거쳐 열린 상세 패드에만 실린다(= 되돌아갈 목록의 pickKind).
  //           1건 칩에서 바로 연 상세·PICK 자신·사용자 메모에는 없다 → 그 경우 ✕/Esc는 완전 닫기.
  const [pad, setPad] = useState(null);

  // 플로팅 창 위치 (달력 창 / 메모 패드 각각 독립 이동)
  const [winPos, setWinPos] = useState(() => ({ x: 60, y: 40 }));
  const [padPos, setPadPos] = useState(() => ({ x: 200, y: 120 }));
  // 패드가 열릴 때마다 증가 — 실제 높이 측정 후 중앙 배치 효과의 트리거
  const [padSeq, setPadSeq] = useState(0);
  const winRef = useRef(null);
  const padRef = useRef(null);
  // 드래그 대상('win'|'pad'|null) + 커서-창 오프셋. 창 하나의 window 리스너로 둘 다 처리.
  const dragRef = useRef({ target: null, offX: 0, offY: 0 });

  // 재오픈 시 이번 달로 리셋 + 패드 닫기 (열려 있는 동안 탭 전환에는 open이 그대로라 재실행 안 됨)
  useEffect(() => {
    if (open) {
      setViewYear(ty);
      setViewMonth(tm);
      setPad(null);
    }
  }, [open]);

  // page 모드 칸 높이 역산용 뷰포트 세로 (창 크기 변경·최대화에 즉시 반응)
  const [viewportH, setViewportH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 900));
  useEffect(() => {
    if (!isPage) return;
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isPage]);

  // 열 때마다 달력 창을 화면 중앙으로 재배치 (측정 후 클램프 — FloatingCalculator와 동일 패턴)
  useEffect(() => {
    if (!open || isPage) return;   // page 모드는 뷰포트를 가득 채우므로 배치 계산 자체가 없다
    const id = requestAnimationFrame(() => {
      const w = winRef.current?.offsetWidth || CAL_W;
      const h = winRef.current?.offsetHeight || 620;
      setWinPos({
        x: Math.max(12, Math.round((window.innerWidth - w) / 2)),
        y: Math.max(12, Math.round((window.innerHeight - h) / 2)),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // 패드가 열릴 때마다 실제 높이를 측정해 화면 중앙 배치 + 뷰포트 클램프.
  // 세로를 크게 키웠으므로(rows 28) 고정 오프셋으로 배치하면 아래가 화면 밖으로 잘릴 수 있다.
  useEffect(() => {
    if (!padSeq) return;
    const id = requestAnimationFrame(() => {
      const el = padRef.current;
      if (!el) return;
      const w = el.offsetWidth || PAD_W;
      const h = el.offsetHeight || 400;
      setPadPos({
        x: clamp(Math.round((window.innerWidth - w) / 2), 0, Math.max(0, window.innerWidth - w)),
        y: clamp(Math.round((window.innerHeight - h) / 2), 0, Math.max(0, window.innerHeight - 40)),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [padSeq]);

  // 드래그 이동 (window 리스너 — 커서가 창 밖으로 나가도 추적, 뷰포트 클램프)
  useEffect(() => {
    const onMove = (e) => {
      const t = dragRef.current.target;
      if (!t) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const nx = cx - dragRef.current.offX;
      const ny = cy - dragRef.current.offY;
      if (t === 'win') {
        const w = winRef.current?.offsetWidth || CAL_W;
        setWinPos({ x: clamp(nx, 0, window.innerWidth - w), y: clamp(ny, 0, window.innerHeight - 40) });
      } else {
        const w = padRef.current?.offsetWidth || PAD_W;
        // 패드 전체를 화면 안에 유지 — 좌측 정렬된 취소/저장 버튼이 화면 밖으로 밀려나지 않도록
        // (달력 창·WatchlistPopup과 동일한 [0, innerWidth-w] 클램프). 타이틀 바(상단 40px)도 항상 노출.
        setPadPos({ x: clamp(nx, 0, Math.max(0, window.innerWidth - w)), y: clamp(ny, 0, window.innerHeight - 40) });
      }
    };
    const onEnd = () => { dragRef.current.target = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  // 핑크 ✕ / Esc 공통 — **한 단계 뒤로**(2026-08 사용자 확정). PICK 목록에서 연 상세 패드
  // (`backPick` 보유)는 그 목록으로 돌아가고, 그 외(1건 칩에서 바로 연 상세·PICK 자신·사용자 메모)는
  // 종전대로 완전히 닫는다. 목록으로 돌아갈 때도 padSeq를 올려 실제 높이 기준 중앙 재배치를 태운다
  // (목록↔상세는 세로가 크게 달라 위치를 그대로 두면 화면 밖으로 밀린다).
  // ⚠️ 저장(퍼플 체크)·삭제는 '완료' 동작이라 여기 묶지 말 것 — 그대로 완전 닫기다.
  const dismissPad = () => {
    if (pad && pad.backPick) { setPad(pickPad(pad.dayKey, pad.backPick)); setPadSeq((s) => s + 1); return; }
    setPad(null);
  };

  // Esc: 패드가 열려 있으면 패드만 닫는다 (비차단 배경 창을 전역 Esc로 통째 닫지 않음).
  // ⚠️ ✕와 반드시 같은 `dismissPad`를 공유할 것 — 갈라지면 "키는 닫히고 버튼은 목록으로"가 되어
  //    같은 취소 제스처가 두 결과를 낸다.
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape' && pad) dismissPad(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, pad]);

  // 날짜별 포트폴리오 스냅샷 (그 날짜의 실제 기록) — 통합 대시보드 intMonthlyHistory 기반.
  const metricsByDate = useMemo(() => {
    const m = {};
    (metricsHistory || []).forEach((h) => { if (h && h.date) m[h.date] = h; });
    return m;
  }, [metricsHistory]);
  // 헤더 카드가 대표하는 '오늘' 기록의 날짜 = 최신 기록일(effectiveDate 기준, getTodayKST()와
  // 00:00~07:30 KST엔 다를 수 있음). 헤더값 오버라이드(todayReturnRate)·라이브 지표는 이 셀에 적용.
  const latestRecDate = useMemo(() => {
    let latest = null;
    (metricsHistory || []).forEach((h) => { if (h && h.date && (!latest || h.date > latest)) latest = h.date; });
    return latest;
  }, [metricsHistory]);
  // 환율·US10Y 과거값 carry-forward용 정렬 키(문자열 YYYY-MM-DD = 시간순).
  const fxKeys = useMemo(() => (fxHistory ? Object.keys(fxHistory).sort() : []), [fxHistory]);
  const us10yKeys = useMemo(() => (us10yHistory ? Object.keys(us10yHistory).sort() : []), [us10yHistory]);

  // ── 📝 투자기록(리밸런싱 메모) 날짜 인덱스 — investmentNotes에서 **라이브 파생**(복사 금지) ──
  // 계좌 단위로 묶는다: 같은 계좌·같은 날 N건이면 칩 하나 안에서 순서대로 본다.
  // ⚠️ 삭제 계좌(deletedAt)도 **포함**한다 — 달력은 라이브 뷰가 아니라 과거 기록 뷰이고, 같은 칸의
  //    📊 칩은 calendarMemos라 삭제와 무관하게 남는다. 제외하면 한 셀 안에서 규칙이 모순되고
  //    계좌 하나 삭제로 과거 몇 달치 기록이 소급 증발한다(색만 회색으로 강등해 구분).
  const notesByDate = useMemo(() => {
    const out = {};
    if (!open) return out; // 닫혀 있으면 계산하지 않는다(portfolios는 시세 갱신마다 새 배열)
    (portfolios || []).forEach((p) => {
      const list = Array.isArray(p?.investmentNotes) ? p.investmentNotes : [];
      if (!p || list.length === 0) return;
      const accountName = String(p.name || '계좌').trim();
      const byDate = {};
      list.forEach((n) => {
        if (!n || !isValidIsoDate(n.date)) return; // 손상 날짜는 렌더 불가 = 유령이므로 제외
        (byDate[n.date] = byDate[n.date] || []).push(n);
      });
      Object.keys(byDate).forEach((d) => {
        (out[d] = out[d] || []).push({ portfolioId: p.id, accountName, notes: byDate[d], deleted: !!p.deletedAt });
      });
    });
    return out;
  }, [portfolios, open]);

  // ── 🔄 종목 수량 변경 — holdingSnapshots 인접 diff에서 **라이브 파생**(복사 금지) ──
  // ⚠️ 스냅샷 kind는 baseline/auto 둘이 아니라 **manual**(자산검증 모달 withManualSnapshot)이 더 있고,
  //    그건 **과거 임의 날짜**에 삽입된다 → 아래 배제 규칙이 없으면 옛 baseline 날짜에 가짜 칩이 뜬다.
  //    `kind === 'baseline'` 단독 판정 금지: baseline 당일을 편집하면 그 kind가 'manual'로 덮여
  //    baseline이 사라지므로, 인덱스 0·kind·baselineDate 세 조건을 OR로 걸어야 한다.
  const qtyChangesByDate = useMemo(() => {
    const out = {};
    if (!open) return out;
    (portfolios || []).forEach((p) => {
      if (!p || p.accountType === 'simple' || p.accountType === 'matong') return;
      const snaps = (Array.isArray(p.holdingSnapshots) ? p.holdingSnapshots : [])
        .filter((s) => s && isValidIsoDate(s.date) && Array.isArray(s.items));
      if (snaps.length < 2) return;
      const sorted = [...snaps].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const baselineDate = p.baselineDate || '';
      const accountName = String(p.name || '계좌').trim();
      const keyOf = (it) => `${it?.type || 'stock'}:${it?.code || it?.name || ''}`;
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (cur.kind === 'baseline') continue;                       // 부트스트랩은 '변경'이 아니다
        if (baselineDate && cur.date <= baselineDate) continue;      // pre-baseline 편집 방어
        if (p.deletedAt && cur.date >= p.deletedAt) continue;        // 삭제일 이후 기록 동결
        const acc = new Map();
        let cashBefore = 0;
        let cashAfter = 0;
        const add = (items, field) => (items || []).forEach((it) => {
          if (!it) return;
          if (it.type === 'deposit') {
            if (field === 'before') cashBefore += cleanNum(it.depositAmount);
            else cashAfter += cleanNum(it.depositAmount);
            return;
          }
          const k = keyOf(it);
          const e = acc.get(k) || {
            name: it.name || it.code || '', code: it.code || '', type: it.type || 'stock',
            before: 0, after: 0, unit: it.type === 'savings' ? 'krw' : 'qty',
          };
          if (it.name) e.name = it.name;
          // 예적금은 수량 개념이 없어 적립 원금(investAmount)의 변화를 대신 본다
          e[field] += it.type === 'savings' ? cleanNum(it.investAmount) : cleanNum(it.quantity);
          acc.set(k, e);
        });
        add(prev.items, 'before');
        add(cur.items, 'after');
        const rows = [...acc.values()]
          .map((r) => ({ ...r, delta: r.after - r.before }))
          .filter((r) => Math.round(r.delta * 1e6) !== 0);
        const cashDelta = cashAfter - cashBefore;
        // 수량·현금 모두 그대로면 항목을 만들지 않는다(구성 지문은 매입금액도 보므로 무변경 스냅샷이 존재)
        if (rows.length === 0 && Math.round(cashDelta) === 0) continue;
        (out[cur.date] = out[cur.date] || []).push({
          portfolioId: p.id, accountName, prevDate: prev.date, rows,
          cashBefore, cashAfter, cashDelta,
          // ⚠️ 해외계좌는 depositAmount 자체가 USD다(utils.ts calcPortfolioEvalDetail의 deposit 분기가
          // fxRate를 곱하는 대상). ₩로 하드코딩하면 $2,000이 ₩2,000으로 보여 약 1,390배 어긋난다.
          // rebalTarget 기록의 currency 규약과 동일 — 원화 환산은 금지(환율 시점이 섞인다).
          currency: p.accountType === 'overseas' ? 'USD' : 'KRW',
          // manual = 매매가 아니라 자산검증 모달에서 사용자가 수량을 정정한 날
          origin: cur.kind === 'manual' ? 'manual' : 'auto',
          afterManual: prev.kind === 'manual',
          deleted: !!p.deletedAt,
        });
      }
    });
    return out;
  }, [portfolios, open]);

  // ── 🔁 종목 계좌 간 이관 — 입출금 원장의 transfer 태그에서 **라이브 파생**(복사 금지) ──
  // ⚠️ calendarMemos에 복사하지 말 것(투자기록·수량변경 파생과 동일 계약) — 원장이 유일한 원본이라
  //    복사하면 DepositPanel에서 원장을 고쳤을 때 달력만 옛 값을 들고 있어 두 화면이 갈린다.
  // 원계좌(나감)·대상계좌(들어옴) 양쪽 칸에 각각 뜬다 — 같은 날 어느 계좌를 봐도 이관 사실이 보인다.
  // ⚠️ 삭제 계좌도 **포함**한다(과거 기록 뷰 — notesByDate·qtyChangesByDate와 동일 규칙, 색만 강등).
  const transfersByDate = useMemo(() => {
    const out = {};
    if (!open) return out;
    (portfolios || []).forEach((p) => {
      if (!p) return;
      const rows = collectTransferRows(p);
      if (rows.length === 0) return;
      const accountName = String(p.name || '계좌').trim();
      const byDate = {};
      rows.forEach((r) => {
        if (!isValidIsoDate(r.date)) return; // 손상 날짜는 렌더 불가 = 유령이므로 제외
        (byDate[r.date] = byDate[r.date] || []).push(r);
      });
      Object.keys(byDate).forEach((d) => {
        (out[d] = out[d] || []).push({
          portfolioId: p.id, accountName, rows: byDate[d],
          // 해외계좌 원장은 USD다 — ₩로 하드코딩하면 약 1,390배 어긋난다(qty 패드와 동일 규약)
          currency: p.accountType === 'overseas' ? 'USD' : 'KRW',
          deleted: !!p.deletedAt,
        });
      });
    });
    return out;
  }, [portfolios, open]);

  // 패드는 전부 앵커(id) + 라이브 재조회 계약이라 원본이 삭제되면 스스로 닫힌다.
  // (rebalTarget upsert는 id를 승계하므로 내용이 교체돼도 닫히지 않고 새 스냅샷으로 갱신된다)
  // ⚠️ 아래 `if (!open) return null`은 모든 훅 뒤에 있어야 하므로 이 effect는 반드시 그 위에 둔다.
  useEffect(() => {
    if (!pad) return;
    if (pad.kind === 'rebalTarget') {
      const list = memos[pad.dayKey];
      if (!Array.isArray(list) || !list.some((m) => m && m.id === pad.memoId)) setPad(null);
    } else if (pad.kind === 'note' && pad.noteId) {
      const g = (notesByDate[pad.dayKey] || []).find((x) => x.portfolioId === pad.portfolioId);
      if (!g || !g.notes.some((n) => n && n.id === pad.noteId)) setPad(null);
    } else if (pad.kind === 'qty') {
      const g = (qtyChangesByDate[pad.dayKey] || []).find((x) => x.portfolioId === pad.portfolioId);
      if (!g) setPad(null);
    } else if (pad.kind === 'transfer') {
      const g = (transfersByDate[pad.dayKey] || []).find((x) => x.portfolioId === pad.portfolioId);
      if (!g) setPad(null);
    }
    // ⚠️ 'detail'(계좌별 현황) 분기는 **두지 않는다** — 앵커가 날짜뿐이라 삭제될 원본이 없고,
    //    행 0건은 오류가 아니라 정상 상태다(그날 자산이 없던 날). 닫아 버리면 사용자는 왜 닫혔는지
    //    알 수 없고, 별도 창의 '불러오는 중' 프레임에서도 곧바로 닫혀 버린다.
  }, [memos, pad, notesByDate, qtyChangesByDate, transfersByDate]);

  // ── 📊 계좌별 현황(ASSET 패드) — 인앱은 동기 재조회, 별도 창은 앱이 보낸 구독 응답 ──────────
  // ⚠️ `open` 게이트 필수 — 달력을 닫아도 pad는 남는다(재오픈 리셋 effect는 open===true에서만 돈다).
  //    CalendarModal은 App 최상위 형제라 항상 마운트돼 있어, 게이트가 없으면 달력을 닫은 뒤에도
  //    시세 갱신마다 전 계좌 시계열을 영구히 재계산한다(notesByDate·qtyChangesByDate·
  //    transfersByDate가 전부 `if (!open) return`인 것과 같은 규약).
  // ⚠️ try/catch — App 쪽 두 호출부(브릿지 응답·구독 푸시)와 방어 수준을 맞춘다. 손상된 Drive 값
  //    (예: h.date가 문자열이 아닌 기록)이면 정렬 비교에서 던지는데, 여기서 새면 예외가
  //    <ErrorBoundary label="메모 달력">까지 올라가 **달력이 통째로 오류 박스로 래치**된다
  //    (닫았다 열어도 복구되지 않는다). 빈 결과로 떨어뜨려 '해당 날짜 데이터 없음'으로 안내한다.
  const padDetail = useMemo(() => {
    if (!open || !pad || pad.kind !== 'detail') return null;
    if (buildHistDetail) {
      let r = null;
      try { r = buildHistDetail(pad.dayKey); } catch { r = null; }
      return { status: 'ready', date: pad.dayKey, ...(r || EMPTY_HIST_DETAIL) };
    }
    if (accountDetail && accountDetail.date === pad.dayKey) return accountDetail;
    return { status: onRequestAccountDetail ? 'loading' : 'offline', date: pad.dayKey, rows: [] };
  }, [open, pad, buildHistDetail, accountDetail, onRequestAccountDetail]);

  // 별도 창 전용 구독 등록/해제 — 열기·날짜 변경·닫기·자동 닫힘을 이 한 지점이 전부 커버한다.
  // ⚠️ openDetail 안에서 요청하는 방식으로 되돌리지 말 것 — 닫힘 경로가 누락돼 패드가 없는데도
  //    앱이 데이터 변경마다 계속 밀어 준다(구독이 영영 해제되지 않는다).
  const detailKey = open && pad && pad.kind === 'detail' ? pad.dayKey : null;
  useEffect(() => {
    if (buildHistDetail || !onRequestAccountDetail) return;   // 인앱은 동기 계산이라 요청 불필요
    onRequestAccountDetail(detailKey);
  }, [detailKey, buildHistDetail, onRequestAccountDetail]);

  // ⚠️ 배치 effect(padSeq)는 rAF 1회만 offsetHeight를 잰다. 별도 창은 '불러오는 중'(≈120px) →
  //    표(≈550px) **2단계 렌더**라 재측정이 없으면 패드 하단이 화면 밖으로 밀리고(fixed + maxHeight라
  //    내부 스크롤도 안 생긴다) 소계를 볼 방법이 없다. 인앱은 첫 렌더부터 ready라 실질 no-op.
  useEffect(() => {
    if (pad && pad.kind === 'detail' && padDetail && padDetail.status === 'ready') setPadSeq((s) => s + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad && pad.kind, pad && pad.dayKey, padDetail && padDetail.status]);

  if (!open) return null;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const krHol = holidays?.kr || [];
  // page 모드는 남는 세로를 주(週) 수로 나눠 칸을 키운다(모니터가 클수록 칸도 커짐).
  // 결과가 CELL_H보다 작으면(작은 창) CELL_H를 지켜 창 안쪽 스크롤로 넘긴다.
  const gridRows = totalCells / 7;
  const cellH = isPage
    ? Math.max(CELL_H, Math.floor((viewportH - PAGE_CHROME_H - (headerNotice ? 30 : 0)) / gridRows))
    : CELL_H;
  const memoH = isPage ? Math.max(CELL_MEMO_H, cellH - PAGE_CELL_FIXED_H) : CELL_MEMO_H;

  // 드래그 시작 — 현재 렌더의 winPos/padPos를 읽어 오프셋 고정
  const startDrag = (target, cx, cy) => {
    const p = target === 'win' ? winPos : padPos;
    dragRef.current = { target, offX: cx - p.x, offY: cy - p.y };
  };

  const gotoPrev = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); } else setViewMonth(viewMonth - 1);
  };
  const gotoNext = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); } else setViewMonth(viewMonth + 1);
  };
  const gotoToday = () => { setViewYear(ty); setViewMonth(tm); };

  // 패드 배치는 padSeq 효과가 실제 높이를 측정해 중앙 정렬 + 클램프한다(고정 오프셋 금지 — 세로가 길어 잘림).
  const openNew = (dayKey) => { setPad({ dayKey, mode: 'new', memoId: null, val: '' }); setPadSeq((s) => s + 1); };
  const openEdit = (dayKey, memo) => { setPad({ dayKey, mode: 'edit', memoId: memo.id, val: memo.content || '' }); setPadSeq((s) => s + 1); };
  // 자동 기록 3종 — 값 복사가 아니라 앵커(id)만 들고 매 렌더 재조회한다.
  // backPick: PICK 목록을 거쳐 열렸으면 그 목록 종류(✕/Esc가 되돌아갈 곳). 1건 칩에서 바로 열면 null.
  const openRebal = (dayKey, memo, backPick = null) => { setPad({ kind: 'rebalTarget', dayKey, memoId: memo.id, backPick }); setPadSeq((s) => s + 1); };
  const openNote = (dayKey, g, backPick = null) => {
    setPad({ kind: 'note', dayKey, portfolioId: g.portfolioId, noteId: (g.notes[0] && g.notes[0].id) || null, val: null, backPick });
    setPadSeq((s) => s + 1);
  };
  const openQty = (dayKey, g, backPick = null) => { setPad({ kind: 'qty', dayKey, portfolioId: g.portfolioId, backPick }); setPadSeq((s) => s + 1); };
  const openTransfer = (dayKey, g, backPick = null) => { setPad({ kind: 'transfer', dayKey, portfolioId: g.portfolioId, backPick }); setPadSeq((s) => s + 1); };
  // 같은 종류가 2건 이상이면 칩을 개수로 접고, 클릭 시 이 선택 목록을 먼저 띄운다.
  const openPick = (dayKey, pickKind) => { setPad(pickPad(dayKey, pickKind)); setPadSeq((s) => s + 1); };
  // 📊 계좌별 현황 — 칩이 아니라 **날짜 칸의 자산 스냅샷 3줄 블록**에서 연다(backPick 없음 → ✕/Esc는
  // 완전 닫기). 구독 등록은 위 effect가 맡으므로 여기서 요청하지 않는다.
  const openDetail = (dayKey) => { setPad({ kind: 'detail', dayKey }); setPadSeq((s) => s + 1); };
  const canOpenDetail = !!(buildHistDetail || onRequestAccountDetail);
  // 계좌별 현황만 7열 표라 폭이 다르다. 나머지 패드는 종전 그대로.
  const padWidth = pad && pad.kind === 'detail' ? PAD_W_DETAIL : PAD_W;
  const closePad = dismissPad;

  // 투자기록을 쓸 수 있는 계좌(삭제·현금성 제외) — 새 기록 작성 토글의 계좌 선택지
  const writablePortfolios = (portfolios || []).filter(
    (p) => p && !p.deletedAt && p.accountType !== 'simple' && p.accountType !== 'matong'
  );

  // ── 라이브 재조회 (없으면 위 effect가 패드를 닫는다) ──
  const padRec = pad && pad.kind === 'rebalTarget'
    ? (Array.isArray(memos[pad.dayKey]) ? memos[pad.dayKey] : []).find((m) => m && m.id === pad.memoId)
    : null;
  const padNoteGroup = pad && pad.kind === 'note'
    ? (notesByDate[pad.dayKey] || []).find((g) => g.portfolioId === pad.portfolioId) || null
    : null;
  const padNote = padNoteGroup && pad.noteId
    ? padNoteGroup.notes.find((n) => n && n.id === pad.noteId) || null
    : null;
  const padQty = pad && pad.kind === 'qty'
    ? (qtyChangesByDate[pad.dayKey] || []).find((g) => g.portfolioId === pad.portfolioId) || null
    : null;
  const padTransfer = pad && pad.kind === 'transfer'
    ? (transfersByDate[pad.dayKey] || []).find((g) => g.portfolioId === pad.portfolioId) || null
    : null;
  // 텍스트 입력값: 투자기록은 `val === null`이면 아직 미편집 → 라이브 본문을 보여준다.
  const padTextValue = !pad ? ''
    : pad.kind === 'note' ? (pad.val != null ? pad.val : (padNote?.content ?? ''))
    : (pad.val ?? '');

  const notesOf = (portfolioId) => {
    const p = (portfolios || []).find((x) => x && x.id === portfolioId);
    return Array.isArray(p?.investmentNotes) ? p.investmentNotes : [];
  };

  // 같은 날 다건일 때 ①②③ 전환은 **탐색**이라 미저장 편집을 버리면 안 된다(핑크 X/Esc만 '취소' 의미).
  // 창 위에서는 confirm/notify가 가려져 사후 경고로 보완할 수도 없으므로, 떠나는 기록의 편집을
  // 패드 로컬 draft에 담아 두고 저장 시 한 번에 커밋한다. draft는 패드 state라 영속화 지점 무관.
  const saveNotePad = () => {
    if (!onUpdateInvestmentNotes || !pad) { setPad(null); return; }
    const drafts = { ...(pad.drafts || {}) };
    if (pad.noteId && pad.val != null) drafts[pad.noteId] = pad.val;
    const ids = Object.keys(drafts);
    if (ids.length === 0) { setPad(null); return; } // 한 글자도 안 고쳤으면 no-op
    let next = notesOf(pad.portfolioId);
    ids.forEach((id) => {
      const v = drafts[id] || '';
      // 편집 후 비면 삭제 (사용자 메모 패드와 동일 규약)
      next = v.trim()
        ? next.map((n) => (n && n.id === id ? { ...n, content: v } : n))
        : next.filter((n) => !n || n.id !== id);
    });
    onUpdateInvestmentNotes(pad.portfolioId, next);
    setPad(null);
  };

  const saveNewNote = () => {
    const pid = pad.newPid || activePortfolioId || (writablePortfolios[0] && writablePortfolios[0].id);
    if (!pid || !onUpdateInvestmentNotes) { setPad(null); return; }
    const val = pad.val || '';
    if (!val.trim()) { setPad(null); return; }
    // RebalancingPanel addNewNote와 같은 prepend 순서 — 스트립이 최신 기록을 먼저 보여준다
    onUpdateInvestmentNotes(pid, [{ id: generateId(), date: pad.dayKey, content: val }, ...notesOf(pid)]);
    setPad(null);
  };

  const deleteNote = (portfolioId, noteId) => {
    if (!onUpdateInvestmentNotes) return;
    onUpdateInvestmentNotes(portfolioId, notesOf(portfolioId).filter((n) => !n || n.id !== noteId));
  };

  const savePad = () => {
    if (!pad) return;
    // ⚠️ default deny — kind가 늘어날 때 읽기 전용 패드가 사용자 메모 저장 경로로 새면 편집이
    // 조용히 유실된다(memoId를 calendarMemos에서 못 찾아 그냥 닫힘). allow-list로만 통과시킨다.
    if (pad.kind === 'note') { saveNotePad(); return; }
    if (!pad.kind && pad.mode === 'new' && pad.newKind === 'note') { saveNewNote(); return; }
    if (pad.kind) { setPad(null); return; }   // rebalTarget | qty | pick | 미래 kind = 읽기 전용
    if (!onUpdateMemos) { setPad(null); return; }
    const { dayKey, mode, memoId, val } = pad;
    const next = { ...memos };
    // ⚠️ Array.isArray 가드 — 손상된 Drive 값이 비순회 truthy면 `[...x]`가 TypeError를 던진다
    const arr = Array.isArray(next[dayKey]) ? [...next[dayKey]] : [];
    if (mode === 'new') {
      if (!val.trim()) { setPad(null); return; } // 빈 메모는 생성 안 함
      arr.push({ id: generateId(), content: val, createdAt: Date.now() });
    } else {
      const idx = arr.findIndex((m) => m.id === memoId);
      if (idx === -1) { setPad(null); return; }
      if (!val.trim()) arr.splice(idx, 1); // 편집 후 비면 삭제
      else arr[idx] = { ...arr[idx], content: val };
    }
    if (arr.length) next[dayKey] = arr; else delete next[dayKey];
    onUpdateMemos(next);
    setPad(null);
  };

  // 즉시 삭제 — 셀에서 바로 사라지는 것이 피드백(RebalancingPanel deleteNote와 동일 패턴).
  const deleteMemo = (dayKey, memoId) => {
    if (!onUpdateMemos) return;
    const next = { ...memos };
    const arr = (Array.isArray(next[dayKey]) ? next[dayKey] : []).filter((m) => m && m.id !== memoId);
    if (arr.length) next[dayKey] = arr; else delete next[dayKey];
    onUpdateMemos(next);
  };

  // 자동 기록 칩 — **세로 1줄씩**(위→아래) + `라벨 + 계좌명/건수` 표기.
  //   1. LIST(목표비중) → 2. NOTE(투자기록) → 3. STOCK(수량변경) 순서 고정.
  // 종류가 항상 같은 줄 위치·같은 라벨로 오므로 칸을 훑을 때 한눈에 구분된다.
  // ⚠️ 가로 스크롤(overflow-x)로 되돌리지 말 것 — 칩이 2개만 넘어가도 나머지는 6px 스크롤바로만
  //    닿을 수 있어 사실상 숨겨졌다. targetDate가 같은 accountType끼리 공유되므로 하루 다건은
  //    예외가 아니라 기본 시나리오다(그래서 2건 이상은 건수로 접고 pick 목록으로 넘긴다).
  const CHIP_TONE = {
    rebalTarget: 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-200',
    note: 'bg-amber-500/15 hover:bg-amber-500/30 text-amber-200',
    qty: 'bg-violet-500/15 hover:bg-violet-500/30 text-violet-200',
    transfer: 'bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-200',
  };
  const CHIP_DELETED = 'bg-gray-500/15 hover:bg-gray-500/30 text-gray-400';
  const CHIP_LABEL = { rebalTarget: 'LIST', note: 'NOTE', qty: 'STOCK', transfer: 'MOVE' };
  const autoChip = (dayKey, chipKind, items, openOne) => {
    if (!items || items.length === 0) return null;
    const single = items.length === 1;
    const first = items[0];
    // 전부 삭제 계좌일 때만 회색 강등(혼재는 원래 톤 유지 — 색을 하나 더 늘리면 4종 체계가 흐려진다).
    // 혼재 여부는 title 툴팁과 pick 목록의 '(삭제됨)' 표기로 판별한다.
    const deleted = single ? !!first.deleted : items.every((it) => it.deleted);
    return (
      <button
        key={chipKind}
        onClick={(e) => { e.stopPropagation(); if (single) openOne(first); else openPick(dayKey, chipKind); }}
        title={items.map((it) => it.chipTitle || it.accountName || '계좌').join('\n')}
        className={`flex items-center gap-1 w-full rounded px-1 py-0.5 transition-colors ${deleted ? CHIP_DELETED : CHIP_TONE[chipKind]}`}
      >
        <span className="text-[10px] font-bold leading-tight tracking-wide shrink-0">{CHIP_LABEL[chipKind]}</span>
        <span className="flex-1 min-w-0 text-[10px] leading-tight text-left truncate opacity-90">
          {single ? (first.accountName || '계좌') : `${items.length}건`}
        </span>
      </button>
    );
  };

  // 해당 날짜 이전(포함) 가장 최근 지표값 (비거래일은 직전 거래일 값 이월).
  const resolveOnOrBefore = (map, keys, dateKey) => {
    if (!map) return null;
    if (map[dateKey] != null) return map[dateKey];
    let res = null;
    for (let j = 0; j < keys.length; j++) {
      if (keys[j] <= dateKey) res = map[keys[j]]; else break;
    }
    return res;
  };

  return (
    <>
      {/* 달력 창 — floating: 비차단·이동 가능 플로팅 / page: 브라우저 창을 가득 채움 */}
      <div
        ref={winRef}
        style={isPage
          ? { position: 'fixed', inset: 0, background: BG.card }
          : { position: 'fixed', left: winPos.x, top: winPos.y, zIndex: CAL_Z, width: CAL_W, maxWidth: 'calc(100vw - 24px)', maxHeight: '92vh', background: BG.card }}
        className={`flex flex-col overflow-hidden ${isPage ? '' : 'rounded-2xl shadow-2xl border border-gray-600/60'}`}
      >
        {/* 헤더 (floating에서만 드래그 핸들) */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0 select-none ${isPage ? '' : 'cursor-move'}`}
          style={isPage ? undefined : { touchAction: 'none' }}
          onMouseDown={isPage ? undefined : (e) => startDrag('win', e.clientX, e.clientY)}
          onTouchStart={isPage ? undefined : (e) => startDrag('win', e.touches[0].clientX, e.touches[0].clientY)}
        >
          <div className="flex items-center gap-2">
            <CalIcon size={16} className="text-sky-400" />
            <span className="text-gray-200 font-semibold text-sm">메모 달력</span>
          </div>
          <div className="flex items-center gap-1">
            <button onMouseDown={(e) => e.stopPropagation()} onClick={gotoPrev} title="이전 달" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition">
              <ChevronLeft size={18} />
            </button>
            <span className="text-gray-200 font-semibold text-sm w-[104px] text-center tabular-nums select-none">
              {viewYear}년 {viewMonth + 1}월
            </span>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={gotoNext} title="다음 달" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition">
              <ChevronRight size={18} />
            </button>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={gotoToday} className="ml-2 px-2.5 py-1 rounded-md text-[12px] border border-gray-700 text-gray-300 hover:bg-gray-800 transition">
              오늘
            </button>
          </div>
          <div className="flex items-center gap-1">
            {/* 별도 브라우저 창으로 확장 — 클릭 제스처 직후 동기 window.open이라야 팝업 차단을 피한다 */}
            {onOpenWindow && (
              <button onMouseDown={(e) => e.stopPropagation()} onClick={onOpenWindow} title="별도 창으로 열기" className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-sky-300 transition">
                <ExternalLink size={15} />
              </button>
            )}
            <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} title="닫기" className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition">
              <X size={16} />
            </button>
          </div>
        </div>
        {headerNotice && (
          <div className="shrink-0 px-4 py-1 border-b border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-300 text-center">
            {headerNotice}
          </div>
        )}

        {/* 본문 */}
        <div className={`p-3 overflow-y-auto ${isPage ? 'flex-1 min-h-0' : ''}`}>
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-l border-t border-gray-800/60">
            {WD.map((w, i) => (
              <div
                key={w}
                className={`text-center text-[11px] font-semibold py-1.5 border-r border-b border-gray-800/60 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`}
              >
                {w}
              </div>
            ))}
          </div>
          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 border-l border-gray-800/60">
            {Array.from({ length: totalCells }).map((_, i) => {
              const dayNum = i - firstDow + 1;
              const valid = dayNum >= 1 && dayNum <= daysInMonth;
              const dow = i % 7;
              if (!valid) {
                return <div key={i} className="border-r border-b border-gray-800/60 bg-black/20" style={{ minHeight: `${cellH}px` }} />;
              }
              const key = dayKeyOf(viewYear, viewMonth, dayNum);
              const isToday = key === todayStr;
              const isHol = krHol.includes(key);
              // 자동 기록 3종(LIST/NOTE/STOCK)은 **사용자 메모 목록과 분리**해 전용 세로 스택에 렌더한다.
              // 같은 accountType 계좌끼리 settings.targetDate를 공유하므로 하루에 계좌별 기록이
              // 여러 건 쌓이는 것이 기본 시나리오라, 한 목록에 섞으면 사용자 메모가 밀려난다.
              const dayAll = Array.isArray(memos[key]) ? memos[key] : [];
              const dayRebals = dayAll.filter((m) => m && m.kind === 'rebalTarget');
              const dayMemos = dayAll.filter((m) => m && m.kind !== 'rebalTarget');
              const dayNotes = notesByDate[key] || [];
              const dayQty = qtyChangesByDate[key] || [];
              const dayMove = transfersByDate[key] || [];
              const numColor = isHol || dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-300';
              const rawMetric = metricsByDate[key];
              const metricCum = rawMetric ? ((key === latestRecDate && todayReturnRate != null) ? todayReturnRate : rawMetric.monthlyChange) : null;
              return (
                <div
                  key={i}
                  onClick={readOnly ? undefined : () => openNew(key)}
                  title={readOnly ? undefined : '클릭하여 메모 추가'}
                  className={`border-r border-b border-gray-800/60 p-1 flex flex-col gap-0.5 transition-colors ${readOnly ? '' : 'cursor-pointer hover:bg-white/[0.03]'}`}
                  style={{ minHeight: `${cellH}px` }}
                >
                  <div className="flex items-center justify-between shrink-0 px-0.5">
                    <span
                      className={`text-[12px] font-semibold leading-none ${isToday ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center' : numColor}`}
                    >
                      {dayNum}
                    </span>
                    {dayMemos.length > 0 && <span className="text-[9px] text-gray-600 tabular-nums">{dayMemos.length}</span>}
                  </div>
                  {/* 자산 스냅샷 3줄 = 그 날짜의 계좌별 현황 진입점(사용자 요청 2026-08).
                      ⚠️ stopPropagation 필수 — 없으면 칸 루트의 openNew(메모 추가)가 함께 발화해
                         팝업이 즉시 메모 패드로 덮인다(칩·메모 줄과 같은 패턴).
                      ⚠️ readOnly로 게이팅하지 않는다 — 읽기 전용 패드는 읽기 전용에서도 열려야 한다.
                         공급자(buildHistDetail/onRequestAccountDetail)가 없을 때만 진입점을 없앤다. */}
                  {rawMetric && (
                    <div
                      onClick={canOpenDetail ? (e) => { e.stopPropagation(); openDetail(key); } : undefined}
                      title={canOpenDetail ? '클릭하여 이 날짜의 계좌별 현황 보기' : undefined}
                      className={`shrink-0 px-0.5 leading-none rounded ${canOpenDetail ? 'cursor-pointer hover:bg-sky-500/15 transition-colors' : ''}`}
                    >
                      <div className="text-[10px] font-semibold text-gray-200 tabular-nums truncate">{hideAmounts ? '••••••' : fmtAbbrev(rawMetric.evalAmount)}</div>
                      {rawMetric.dodAbsChange != null && (
                        <div className={`text-[9px] tabular-nums truncate mt-[1px] ${pnlColor(rawMetric.dodAbsChange)}`}>
                          {hideAmounts ? '••••' : fmtAbbrev(rawMetric.dodAbsChange)} {fmtPct(rawMetric.dodChange)}
                        </div>
                      )}
                      <div className={`text-[9px] tabular-nums truncate mt-[1px] ${pnlColor(metricCum)}`}>
                        누적 {fmtPct(metricCum)}
                      </div>
                    </div>
                  )}
                  {(dayRebals.length > 0 || dayNotes.length > 0 || dayQty.length > 0 || dayMove.length > 0) && (
                    <div className="flex flex-col gap-0.5 shrink-0">
                      {autoChip(key, 'rebalTarget',
                        dayRebals.map((m) => ({ accountName: m.accountName, chipTitle: m.content, _memo: m })),
                        (it) => openRebal(key, it._memo))}
                      {autoChip(key, 'note',
                        dayNotes.map((g) => ({ ...g, chipTitle: `${g.accountName}${g.deleted ? ' (삭제됨)' : ''}\n${g.notes.map((n) => firstLine(n.content) || '내용 없음').join('\n')}` })),
                        (g) => openNote(key, g))}
                      {autoChip(key, 'qty',
                        dayQty.map((g) => ({ ...g, chipTitle: `${g.accountName}${g.deleted ? ' (삭제됨)' : ''} — 수량 변경 ${g.rows.length}종목${g.origin === 'manual' ? ' (자산검증 보정)' : ''}` })),
                        (g) => openQty(key, g))}
                      {autoChip(key, 'transfer',
                        dayMove.map((g) => ({ ...g, chipTitle: `${g.accountName}${g.deleted ? ' (삭제됨)' : ''}\n${g.rows.map((r) => `${r.role === 'out' ? `→ ${r.toName}` : `← ${r.fromName}`} ${r.name || r.code || '종목'}${r.quantity > 0 ? ` ${formatNumber(r.quantity)}주` : ''}`).join('\n')}` })),
                        (g) => openTransfer(key, g))}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: `${memoH}px` }}>
                    {dayMemos.map((m) => (
                      <div
                        key={m.id}
                        onClick={(e) => { e.stopPropagation(); openEdit(key, m); }}
                        title={m.content}
                        className="group/memo flex items-center gap-1 rounded px-1 py-0.5 bg-sky-500/15 hover:bg-sky-500/25 transition-colors"
                      >
                        <span className="flex-1 text-[10px] text-sky-200 truncate leading-tight">
                          {firstLine(m.content) || <span className="text-gray-500 italic">내용 없음</span>}
                        </span>
                        {!readOnly && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteMemo(key, m.id); }}
                            title="삭제"
                            className="opacity-0 group-hover/memo:opacity-100 text-gray-500 hover:text-red-400 shrink-0 transition-opacity"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 메모 패드 (비차단·이동 가능 플로팅 — 사진 형식) */}
      {pad && (
        <div
          ref={padRef}
          className="fixed shadow-2xl overflow-hidden rounded-lg"
          style={{ left: padPos.x, top: padPos.y, zIndex: PAD_Z, width: padWidth, maxWidth: 'calc(100vw - 16px)' }}
        >
          {/* 헤더 (드래그 핸들) */}
          <div
            className="bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between cursor-move select-none"
            style={{ touchAction: 'none' }}
            onMouseDown={(e) => startDrag('pad', e.clientX, e.clientY)}
            onTouchStart={(e) => startDrag('pad', e.touches[0].clientX, e.touches[0].clientY)}
          >
            <div className="flex items-center gap-3">
              {/* 핑크 버튼 = '한 단계 뒤로'. 목록에서 연 상세면 ← 글리프로 바꿔 "닫힘"이 아니라
                  "목록 복귀"임을 알린다(같은 자리·같은 크기라 버튼이 늘지는 않는다). */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={closePad}
                className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all"
                title={pad.backPick
                  ? (pad.kind === 'note' ? '편집 취소하고 목록으로 (Esc)' : '목록으로 돌아가기 (Esc)')
                  : '취소 (Esc)'}
              >
                {pad.backPick
                  ? <ChevronLeft size={12} className="text-white" />
                  : <X size={10} className="text-white" />}
              </button>
              {/* 저장 버튼은 쓰기 가능한 패드에만 — 읽기 전용(rebalTarget·qty·pick)에는 렌더하지 않는다.
                  readOnly(브릿지 끊긴 새 창)에서는 저장할 곳이 없으므로 어떤 패드에서도 렌더하지 않는다. */}
              {!readOnly && (!pad.kind || pad.kind === 'note') && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={savePad}
                  className="w-[18px] h-[18px] rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center transition-all"
                  title="저장 (Ctrl+Enter)"
                >
                  <Check size={10} className="text-white" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <CalIcon size={13} className="text-gray-500" />
              <span className="text-[13px] text-gray-400 font-mono">{pad.dayKey}</span>
              <span className="text-[15px] font-bold tracking-[0.25em] bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-400 bg-clip-text text-transparent select-none">
                {/* 칸의 칩 라벨(LIST/NOTE/STOCK)과 동일한 이름 — 어느 칩에서 열린 패드인지 즉시 대응된다.
                    다건 선택 목록은 LIST를 목표비중에 넘겨주고 PICK으로 물러난다. */}
                {({ rebalTarget: 'LIST', note: 'NOTE', qty: 'STOCK', transfer: 'MOVE', pick: 'PICK', detail: 'ASSET' })[pad.kind] || 'MEMO'}
              </span>
            </div>
            <div className="w-10" />
          </div>
          {/* 포트폴리오 스냅샷 (그 날짜 기준) — 기록 있는 날만 표시 */}
          {(() => {
            const raw = metricsByDate[pad.dayKey];
            if (!raw) return null;
            const isT = pad.dayKey === latestRecDate;
            const cum = (isT && todayReturnRate != null) ? todayReturnRate : raw.monthlyChange;
            const fx = (isT && liveFx != null) ? liveFx : resolveOnOrBefore(fxHistory, fxKeys, pad.dayKey);
            const y10 = (isT && liveUs10y != null) ? liveUs10y : resolveOnOrBefore(us10yHistory, us10yKeys, pad.dayKey);
            return (
              <div className="bg-black px-3 py-1.5 border-b border-gray-900 text-center select-none leading-snug">
                <span className="text-[11px] font-semibold tabular-nums text-gray-300">
                  총자산: <span className="text-gray-100">{hideAmounts ? '••••••' : nfmt(raw.evalAmount)}</span>
                  {' / '}수익: {raw.dodAbsChange != null
                    ? <span className={pnlColor(raw.dodAbsChange)}>{hideAmounts ? '••••' : `${raw.dodAbsChange < 0 ? '-' : ''}₩${nfmt(Math.abs(raw.dodAbsChange))}`}({fmtPct(raw.dodChange)})</span>
                    : <span className="text-gray-500">-</span>}
                  {' / '}수익율: <span className={pnlColor(cum)}>{fmtPct(cum)}</span>
                  {' / '}환율 :<span className="text-gray-100">{fx != null ? String(Math.round(fx)) : '-'}</span>
                  {' / '}US10Y : <span className="text-gray-100">{y10 != null ? y10.toFixed(2) + '%' : '-'}</span>
                </span>
              </div>
            );
          })()}
          {/* 목표비중 기록 = 읽기 전용 표 (리밸런싱 표의 목표비중·예상 주식수·예상평가금 스냅샷) */}
          {pad.kind === 'rebalTarget' ? (padRec ? (
            <div className="bg-black px-3 py-2 overflow-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-emerald-300 text-[13px] font-bold truncate">📊 {padRec.accountName || '계좌'}</span>
                <span className="text-[10px] text-gray-500 shrink-0">
                  {padRec.targetMode === 'variable' ? '수시변경' : '고정'} · {padRec.investMode === 'rebalance' ? '리밸런싱' : padRec.investMode === 'targetAmount' ? '목표금액' : '적립식'}
                  {/* 기록 시각 — 이 기록이 걸린 날짜(목표 날짜)와 실제 기록 시점은 다를 수 있다 */}
                  {padRec.updatedAt ? ` · ${new Date(padRec.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 기록` : ''}
                </span>
              </div>
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left font-normal py-1 pr-1">종목명</th>
                    <th className="text-right font-normal py-1 px-1">목표</th>
                    <th className="text-right font-normal py-1 px-1">목표금액</th>
                    <th className="text-right font-normal py-1 px-1">현재수량</th>
                    <th className="text-right font-normal py-1 px-1">이후수량</th>
                    <th className="text-right font-normal py-1 pl-1">리밸런싱 후 평가금액</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(padRec.rows) ? padRec.rows : []).map((r, i) => (
                    <tr key={i} className="border-b border-gray-900/80">
                      <td className="text-left text-gray-200 py-1 pr-1">
                        {i + 1}. {r.name}
                        {r.code ? <span className="ml-1 text-[9px] text-gray-600 font-mono">{r.code}</span> : null}
                      </td>
                      <td className="text-right text-green-400 py-1 px-1">{Number(r.targetRatio || 0).toFixed(2)}%</td>
                      {/* 목표금액은 사용자가 명시 입력한 행만 기록된다(구버전 기록·미지정 행은 '-') */}
                      <td className="text-right text-emerald-300/80 py-1 px-1">{r.targetAmount == null ? '-' : fmtMoney(r.targetAmount, padRec.currency)}</td>
                      <td className="text-right text-gray-400 py-1 px-1">{r.curQty == null ? '-' : qfmt(r.curQty)}</td>
                      <td className="text-right text-blue-300 py-1 px-1">{r.expQty == null ? '-' : qfmt(r.expQty)}</td>
                      <td className="text-right text-yellow-500 py-1 pl-1">{fmtMoney(r.expEval, padRec.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t border-gray-700">
                    <td className="text-left text-gray-400 py-1.5 pr-1">합계</td>
                    <td className="text-right text-green-400 py-1.5 px-1">{Number(padRec.totalTargetRatio || 0).toFixed(2)}%</td>
                    <td className="py-1.5 px-1" />
                    <td className="py-1.5 px-1" />
                    <td className="py-1.5 px-1" />
                    <td className="text-right text-yellow-500 py-1.5 pl-1">{fmtMoney(padRec.totalExpEval, padRec.currency)}</td>
                  </tr>
                </tfoot>
              </table>
              {/* 같은 날·같은 계좌의 투자 기록을 함께 보여준다 — "리밸런싱 내역을 클릭하면 계좌의
                  리밸런싱 내용과 투자 기록에 남긴 내역을 볼 수 있어야 한다"(사용자 요구).
                  ⚠️ 여기서는 읽기 전용 — 편집은 📝 칩(note 패드)에서만 한다(저장 경로 충돌 방지). */}
              {(() => {
                const g = (notesByDate[pad.dayKey] || []).find((x) => x.portfolioId === padRec.portfolioId);
                if (!g || !g.notes.length) return null;
                return (
                  <div className="mt-3 pt-2 border-t border-gray-800">
                    <div className="text-[10px] text-amber-300/80 mb-1.5">📝 투자 기록</div>
                    {g.notes.map((n) => (
                      <div key={n.id} className="text-[12px] text-gray-300 whitespace-pre-wrap leading-relaxed mb-2 last:mb-0">
                        {n.content || <span className="text-gray-600 italic">내용 없음</span>}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {/* 이 기록을 현재 표에 되돌리는 경로 안내. ⚠️ 여기에 '적용' 버튼을 두지 말 것 —
                  달력은 비활성·삭제 계좌 기록도 보여주고, 별도 브라우저 창은 종목 정보를 받지 않아
                  버튼이 무반응이 되며, 창 위에서는 PIN·확인창이 가려진다. */}
              <div className="mt-2 pt-2 border-t border-gray-800 text-[10px] text-gray-600 leading-relaxed">
                이 목표비중으로 되돌리려면 해당 계좌를 연 뒤 리밸런싱 표 <b className="text-gray-500">목표</b> 열의
                <span className="text-emerald-500/70"> 📅 </span>아이콘에서 이 날짜를 선택하세요.
              </div>
              {!readOnly && (
                <div className="flex justify-end pt-2">
                  {/* 칩에 휴지통을 넣을 폭이 없어 삭제는 여기로 — 즉시 삭제(창 위에선 confirm이 가려진다) */}
                  <button
                    onClick={() => deleteMemo(pad.dayKey, pad.memoId)}
                    className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-red-400 transition-colors"
                    title="이 기록 삭제"
                  >
                    <Trash2 size={11} /> 기록 삭제
                  </button>
                </div>
              )}
            </div>
          ) : null) : pad.kind === 'qty' ? (padQty ? (
            /* 종목 수량 변경 = 읽기 전용 표 (보유 스냅샷 인접 비교) */
            <div className="bg-black px-3 py-2 overflow-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-violet-300 text-[13px] font-bold truncate">🔄 {padQty.accountName}</span>
                <span className="text-[10px] text-gray-500 shrink-0">{padQty.prevDate} → {pad.dayKey}</span>
              </div>
              {padQty.origin === 'manual' && (
                <div className="text-[10px] text-amber-300/70 mb-1.5">
                  ⚠️ 자산검증에서 수량을 정정한 날입니다 (매매 기록이 아닙니다).
                </div>
              )}
              {padQty.afterManual && (
                <div className="text-[10px] text-gray-500 mb-1.5">
                  직전 기준이 검증 보정값이라 정정분의 역방향이 섞여 있을 수 있습니다.
                </div>
              )}
              {padQty.rows.length > 0 && (
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left font-normal py-1 pr-1">종목명</th>
                      <th className="text-right font-normal py-1 px-1">이전</th>
                      <th className="text-right font-normal py-1 px-1">이후</th>
                      <th className="text-right font-normal py-1 pl-1">증감</th>
                    </tr>
                  </thead>
                  <tbody>
                    {padQty.rows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-900/80">
                        <td className="text-left text-gray-200 py-1 pr-1">
                          {r.name}
                          {r.code ? <span className="ml-1 text-[9px] text-gray-600 font-mono">{r.code}</span> : null}
                        </td>
                        <td className="text-right text-gray-400 py-1 px-1">{r.unit === 'krw' ? fmtMoney(r.before, 'KRW') : qfmt(r.before)}</td>
                        <td className="text-right text-gray-200 py-1 px-1">{r.unit === 'krw' ? fmtMoney(r.after, 'KRW') : qfmt(r.after)}</td>
                        <td className={`text-right py-1 pl-1 font-bold ${r.delta > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                          {r.delta > 0 ? '+' : ''}{r.unit === 'krw' ? fmtMoney(r.delta, 'KRW') : qfmt(r.delta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {Math.round(padQty.cashDelta) !== 0 && (
                <div className="flex items-center justify-between text-[11px] tabular-nums pt-2 mt-1 border-t border-gray-800">
                  <span className="text-gray-400">예수금</span>
                  <span className="text-gray-300">
                    {fmtMoney(padQty.cashBefore, padQty.currency)} → {fmtMoney(padQty.cashAfter, padQty.currency)}
                    <span className={`ml-2 font-bold ${padQty.cashDelta > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {padQty.cashDelta > 0 ? '+' : ''}{fmtMoney(padQty.cashDelta, padQty.currency)}
                    </span>
                  </span>
                </div>
              )}
              <div className="text-[9px] text-gray-600 pt-2 leading-relaxed">
                보유 스냅샷 비교로 자동 산출됩니다. 국내 계좌는 21:00 이후 변경이 다음 날 칸에 기록되고,
                같은 날 여러 번 고치면 그날의 순변화만 표시됩니다.
              </div>
            </div>
          ) : null) : pad.kind === 'transfer' ? (padTransfer ? (
            /* 종목 계좌 간 이관 = 읽기 전용 표 (입출금 원장의 transfer 태그에서 파생) */
            <div className="bg-black px-3 py-2 overflow-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-cyan-300 text-[13px] font-bold truncate">🔁 {padTransfer.accountName}</span>
                <span className="text-[10px] text-gray-500 shrink-0">{pad.dayKey}</span>
              </div>
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left font-normal py-1 pr-1">종목명</th>
                    <th className="text-right font-normal py-1 px-1">수량</th>
                    <th className="text-left font-normal py-1 px-1">방향</th>
                    <th className="text-right font-normal py-1 pl-1">이관금액</th>
                  </tr>
                </thead>
                <tbody>
                  {padTransfer.rows.map((r, i) => (
                    <tr key={r.rowId || i} className="border-b border-gray-900/80">
                      <td className="text-left text-gray-200 py-1 pr-1">
                        {r.name || r.code || '종목'}
                        {r.code ? <span className="ml-1 text-[9px] text-gray-600 font-mono">{r.code}</span> : null}
                      </td>
                      <td className="text-right text-gray-300 py-1 px-1">{r.quantity > 0 ? qfmt(r.quantity) : '-'}</td>
                      <td className={`text-left py-1 px-1 truncate ${r.role === 'out' ? 'text-blue-300' : 'text-red-300'}`}>
                        {r.role === 'out' ? `→ ${r.toName || '계좌'}` : `← ${r.fromName || '계좌'}`}
                      </td>
                      <td className="text-right text-gray-200 py-1 pl-1">{fmtMoney(r.market, padTransfer.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {padTransfer.rows.some((r) => Math.round(r.market - r.cost) !== 0) && (
                <div className="pt-2 mt-1 border-t border-gray-800 space-y-0.5">
                  {padTransfer.rows.map((r, i) => (
                    <div key={`c${r.rowId || i}`} className="flex items-center justify-between text-[10px] text-gray-500">
                      <span className="truncate">{r.name || r.code || '종목'} 매입원가</span>
                      <span className="shrink-0 text-gray-400">
                        {fmtMoney(r.cost, padTransfer.currency)}
                        <span className={`ml-2 ${r.market - r.cost > 0 ? 'text-red-400' : r.market - r.cost < 0 ? 'text-blue-400' : ''}`}>
                          {r.market - r.cost > 0 ? '+' : ''}{fmtMoney(r.market - r.cost, padTransfer.currency)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[9px] text-gray-600 pt-2 leading-relaxed">
                입출금 원장의 이관 기록에서 자동 산출됩니다. 원금은 매입원가만 이동하고, 이관금액은
                직전 기록일 종가 기준입니다(국내 계좌는 21:00 이후 이관이 다음 날 칸에 기록됩니다).
              </div>
            </div>
          ) : null) : pad.kind === 'detail' ? (
            /* 계좌별 현황 = 읽기 전용 표. 통합 대시보드 '평가액 추이' 팝업과 **같은 utils 함수**
               (buildHistDetailRows)가 낸 값을 순수 포매팅만 한다 — 비중·소계를 여기서 다시 계산하지 말 것.
               ⚠️ 이 분기 안에 confirm()·notify()·저장/삭제 동작을 넣지 말 것: z-1060 위에서는
                  ConfirmDialog(1000)·토스트(999)가 가려져 피드백이 보이지 않는다. */
            <div className="bg-black px-3 py-2 overflow-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sky-300 text-[13px] font-bold truncate">📊 계좌별 현황</span>
                <span className="text-[10px] text-gray-500 shrink-0">{pad.dayKey}</span>
              </div>
              {/* 시세 미로드 이상치 가드가 발동한 날은 칸·밴드의 총자산이 '직전 거래일 값'이고
                  아래 소계는 라이브 합이라 구조적으로 다르다. 조용히 두 숫자를 나란히 보여주지 않는다. */}
              {metricsByDate[pad.dayKey] && metricsByDate[pad.dayKey].flowSuspect && (
                <div className="text-[10px] text-amber-300/80 mb-1.5 leading-relaxed">
                  ⚠️ 시세를 다 불러오지 못해 위 총자산은 직전 거래일 값입니다 — 아래 소계는 현재 라이브 값이라 다를 수 있습니다.
                </div>
              )}
              {!padDetail || padDetail.status === 'loading' ? (
                <div className="py-6 text-center text-[11px] text-gray-500">앱 창에서 불러오는 중…</div>
              ) : padDetail.status === 'offline' ? (
                <div className="py-6 text-center text-[11px] text-gray-500">앱 창과 연결이 끊겨 계좌별 현황을 표시할 수 없습니다.</div>
              ) : padDetail.status === 'timeout' ? (
                <div className="py-6 text-center text-[11px] text-gray-500">
                  앱 창이 응답하지 않습니다.
                  {onRequestAccountDetail && (
                    <button onClick={() => onRequestAccountDetail(pad.dayKey)} className="ml-2 px-2 py-0.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 transition">
                      다시 시도
                    </button>
                  )}
                </div>
              ) : !padDetail.rows || padDetail.rows.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-gray-500">해당 날짜 데이터 없음</div>
              ) : (
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left font-normal py-1 pr-1">계좌</th>
                      <th className="text-right font-normal py-1 px-1">투자원금</th>
                      <th className="text-right font-normal py-1 px-1">평가금액</th>
                      <th className="text-center font-normal py-1 px-1">비중</th>
                      <th className="text-right font-normal py-1 px-1">예수금</th>
                      <th className="text-right font-normal py-1 px-1">수익</th>
                      <th className="text-right font-normal py-1 pl-1">수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {padDetail.rows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-900/80">
                        <td className="text-left text-gray-200 py-1 pr-1">
                          <span className="flex items-center gap-1.5">
                            {r.rowColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.rowColor }} />}
                            <span className="truncate">{r.name}</span>
                          </span>
                        </td>
                        <td className="text-right text-gray-400 py-1 px-1">{maskMoney(r.principal, hideAmounts)}</td>
                        <td className="text-right text-gray-100 font-bold py-1 px-1">{maskMoney(r.evalAmount, hideAmounts)}</td>
                        <td className="text-center text-gray-300 py-1 px-1">{r.weight == null ? '-' : `${r.weight.toFixed(2)}%`}</td>
                        <td className="text-right text-gray-400 py-1 px-1">{maskMoney(r.depositAmount, hideAmounts)}</td>
                        <td className={`text-right font-bold py-1 px-1 ${pnlColor(r.profit)}`}>{maskMoney(r.profit, hideAmounts)}</td>
                        <td className={`text-right font-bold py-1 pl-1 ${pnlColor(r.returnRate)}`}>{pctCell(r.returnRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t border-gray-700">
                      <td className="text-left text-gray-400 py-1.5 pr-1">소계</td>
                      <td className="text-right text-gray-300 py-1.5 px-1">{maskMoney(padDetail.totalPrincipal, hideAmounts)}</td>
                      <td className="text-right text-yellow-500 py-1.5 px-1">{maskMoney(padDetail.totalEval, hideAmounts)}</td>
                      <td className="text-center text-gray-300 py-1.5 px-1">100%</td>
                      <td className="text-right text-gray-400 py-1.5 px-1">{maskMoney(padDetail.totalDeposit, hideAmounts)}</td>
                      <td className={`text-right py-1.5 px-1 ${pnlColor(padDetail.totalProfit)}`}>{maskMoney(padDetail.totalProfit, hideAmounts)}</td>
                      {/* ⚠️ pctCell 경유 필수 — totalReturnRate는 null 계약이고 fmtPct는 null-safe가 아니다 */}
                      <td className={`text-right py-1.5 pl-1 ${pnlColor(padDetail.totalReturnRate)}`} title="이 표에 포함된 계좌의 원금 합계 기준">
                        {pctCell(padDetail.totalReturnRate)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
              <div className="text-[9px] text-gray-600 pt-2 leading-relaxed">
                통합 대시보드 &apos;평가액 추이&apos;에서 날짜를 눌렀을 때와 같은 계산입니다. 시장 계좌는 그날의
                &apos;수량 × 종가&apos;, 현금성 계좌는 그날의 잔액 스냅샷 기준이며, TEST 계좌는 제외되고 삭제된 계좌는
                삭제일 이전 날짜에만 표시됩니다. 위 밴드의 &apos;수익율&apos;은 전체 누적 원금 대비이고 이 표의 소계
                수익률은 표에 포함된 계좌의 원금 합계 기준이라 값이 다를 수 있습니다.
              </div>
            </div>
          ) : pad.kind === 'pick' ? (
            /* 같은 종류 다건 — 계좌 선택 목록 */
            <div className="bg-black px-3 py-2 overflow-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <div className="text-[11px] text-gray-500 mb-2">
                {({ rebalTarget: '📊 목표비중 기록', note: '📝 투자 기록', qty: '🔄 종목 수량 변경', transfer: '🔁 종목 이관' })[pad.pickKind]} — 계좌 선택
              </div>
              {(pad.pickKind === 'rebalTarget'
                ? (Array.isArray(memos[pad.dayKey]) ? memos[pad.dayKey] : []).filter((m) => m && m.kind === 'rebalTarget')
                : pad.pickKind === 'note' ? (notesByDate[pad.dayKey] || [])
                : pad.pickKind === 'transfer' ? (transfersByDate[pad.dayKey] || [])
                : (qtyChangesByDate[pad.dayKey] || [])
              ).map((it, i) => (
                <button
                  key={it.id || it.portfolioId || i}
                  onClick={() => {
                    // 되돌아올 목록(pickKind)을 상세 패드에 실어 보낸다 — ✕/Esc가 이 목록으로 복귀.
                    if (pad.pickKind === 'rebalTarget') openRebal(pad.dayKey, it, 'rebalTarget');
                    else if (pad.pickKind === 'note') openNote(pad.dayKey, it, 'note');
                    else if (pad.pickKind === 'transfer') openTransfer(pad.dayKey, it, 'transfer');
                    else openQty(pad.dayKey, it, 'qty');
                  }}
                  className="w-full flex items-center justify-between gap-2 text-left px-2 py-2 rounded hover:bg-gray-800/80 transition-colors border-b border-gray-900/80"
                >
                  {/* 접힌 칩에서는 삭제 계좌가 톤으로 구분되지 않으므로 여기서 명시(IntegratedDashboard 규약 동일).
                      rebalTarget 분기는 raw 메모라 it.deleted가 undefined → 기존 동작 그대로. */}
                  <span className={`text-[12px] truncate ${it.deleted ? 'text-gray-500' : 'text-gray-200'}`}>
                    {it.accountName || '계좌'}{it.deleted ? ' (삭제됨)' : ''}
                  </span>
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {pad.pickKind === 'rebalTarget' ? `${(it.rows || []).length}종목`
                      : pad.pickKind === 'note' ? `${it.notes.length}건`
                      : `${it.rows.length}종목`}
                  </span>
                </button>
              ))}
            </div>
          ) : (
          /* 줄선 메모 입력 (사용자 메모 · 투자기록 편집 · 새 기록 작성) */
          <>
          {/* 새 기록 작성 — 종류 선택(메모 / 투자기록). 셀 공간을 쓰지 않고 패드 안에서 고른다. */}
          {!pad.kind && pad.mode === 'new' && (
            <div className="bg-black px-3 py-1.5 border-b border-gray-900 flex items-center gap-1.5">
              {[{ k: 'memo', label: '메모' }, { k: 'note', label: '투자기록' }].map(({ k, label }) => {
                const on = (pad.newKind || 'memo') === k;
                const disabled = k === 'note' && (!onUpdateInvestmentNotes || writablePortfolios.length === 0);
                return (
                  <button
                    key={k}
                    disabled={disabled}
                    onClick={() => setPad((prev) => ({ ...prev, newKind: k, newPid: prev.newPid || activePortfolioId || (writablePortfolios[0] && writablePortfolios[0].id) }))}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                      disabled ? 'text-gray-700 cursor-not-allowed'
                        : on ? (k === 'note' ? 'bg-amber-500/25 text-amber-200' : 'bg-sky-500/25 text-sky-200')
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                    title={disabled ? '투자기록을 쓸 계좌가 없습니다' : undefined}
                  >
                    {label}
                  </button>
                );
              })}
              {pad.newKind === 'note' && writablePortfolios.length > 0 && (
                <select
                  value={pad.newPid || ''}
                  onChange={(e) => setPad((prev) => ({ ...prev, newPid: e.target.value }))}
                  className="ml-1 bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none focus:border-amber-500"
                >
                  {writablePortfolios.map((p) => (
                    <option key={p.id} value={p.id}>{p.name || '계좌'}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          {/* 투자기록 편집 — 계좌명 + (같은 날 다건이면) 기록 전환 + 삭제 */}
          {pad.kind === 'note' && padNoteGroup && (
            <div className="bg-black px-3 py-1.5 border-b border-gray-900 flex items-center justify-between gap-2">
              <span className="text-amber-300 text-[12px] font-bold truncate">📝 {padNoteGroup.accountName}</span>
              <div className="flex items-center gap-1 shrink-0">
                {padNoteGroup.notes.length > 1 && padNoteGroup.notes.map((n, i) => (
                  <button
                    key={n.id}
                    onClick={() => setPad((prev) => {
                      const drafts = { ...(prev.drafts || {}) };
                      if (prev.noteId && prev.val != null) drafts[prev.noteId] = prev.val; // 미저장 편집 보존
                      return { ...prev, drafts, noteId: n.id, val: drafts[n.id] != null ? drafts[n.id] : null };
                    })}
                    className={`w-5 h-5 rounded text-[10px] tabular-nums transition-colors ${
                      n.id === pad.noteId ? 'bg-amber-500/30 text-amber-200' : 'text-gray-500 hover:text-gray-300'
                    }`}
                    title={`기록 ${i + 1}`}
                  >{i + 1}</button>
                ))}
                {!readOnly && pad.noteId && (
                  <button
                    onClick={() => { deleteNote(pad.portfolioId, pad.noteId); setPad(null); }}
                    className="ml-1 text-gray-600 hover:text-red-400 transition-colors"
                    title="이 기록 삭제"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          <textarea
            className="w-full text-gray-200 text-[15px] outline-none resize-none caret-sky-400 placeholder-gray-700"
            style={{
              backgroundColor: '#000',
              backgroundImage: `repeating-linear-gradient(transparent 0px, transparent 31px, rgba(99,130,255,0.3) 31px, rgba(99,130,255,0.3) 32px)`,
              backgroundSize: '100% 32px',
              backgroundPosition: '0 8px',
              lineHeight: '32px',
              padding: '8px 10px',
              // 세로 2배(rows 28)라도 패드 전체가 화면을 넘지 않도록 상한 — 초과분은 내부 스크롤
              maxHeight: 'calc(100vh - 160px)',
            }}
            rows={28}
            autoFocus
            // ⚠️ 브릿지가 끊긴 새 창에서는 입력 자체를 막는다 — 저장 버튼만 숨기면 사용자가 한참 쓴 뒤
            //    아무 데도 저장되지 않고 사라진다(창 위에선 notify/confirm도 가려져 사후 경고 불가).
            readOnly={readOnly}
            placeholder={readOnly ? '앱 창과 연결되지 않아 읽기 전용입니다.' : (pad.kind === 'note' || pad.newKind === 'note' ? '투자 기록을 입력하세요...' : '메모를 입력하세요...')}
            value={padTextValue}
            onChange={(e) => setPad((prev) => ({ ...prev, val: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); closePad(); }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') savePad();
            }}
          />
          </>
          )}
        </div>
      )}
    </>
  );
}
