// 브라질 중앙은행(BCB) 자료를 **브라우저에서 직접** 받는 보충 경로(2026-10).
// 발단: 배포 서버(Vercel)에서 BCB SGS·Olinda가 응답하지 않는다(서버 IP 차단으로 보인다 — 로컬·브라우저에서는 정상).
//   두 API는 CORS를 연다(SGS: Access-Control-Allow-Origin *, Olinda: 요청 출처 그대로) → 서버가 비면 사용자 브라우저가 받는다.
// ⚠️ 해석은 서버와 같은 순수 함수(api/_indicatorSources)를 쓴다 — 두 경로가 다른 값을 내지 않게.
// ⚠️ 결과는 호출한 화면의 메모리에만 둔다(저장은 각 화면의 기존 경로가 한다).
import { parseBcbSgs, parseOlindaExpect, computeBrReal } from '../api/_indicatorSources';

const todayIso = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const toBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const OLINDA = 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoInflacao12Meses';
export const BCB_BROWSER_KEYS = ['brSelic', 'brIpca', 'brExp12', 'brReal'];

// SGS — 일별 시리즈는 한 번에 최대 10년이라 9년 단위로 나눠 받는다
export async function fetchBcbSgsBrowser(series: number, fromIso: string, toIso: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const today = todayIso();
  let s = fromIso;
  while (s <= toIso) {
    const e0 = `${+s.slice(0, 4) + 9}${s.slice(4)}`;
    const e = e0 < toIso ? e0 : toIso;
    try {
      const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados?formato=json&dataInicial=${toBr(s)}&dataFinal=${toBr(e)}`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) Object.assign(out, parseBcbSgs(await res.json(), today) || {});
    } catch { /* 다음 구간 */ }
    s = new Date(Date.parse(`${e}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  return out;
}
// Olinda 12개월 기대 IPCA 중앙값(평활 S · 전체 응답자)
export async function fetchBcbExpectBrowser(fromIso: string, toIso: string): Promise<Record<string, number>> {
  const q = (x: string) => encodeURIComponent(x);
  const f = `Indicador eq 'IPCA' and Suavizada eq 'S' and baseCalculo eq 0 and Data ge '${fromIso}' and Data le '${toIso}'`;
  try {
    const res = await fetch(`${OLINDA}?$top=20000&$filter=${q(f)}&$orderby=${q('Data asc')}&$format=json&$select=${q('Data,Mediana')}`, { signal: AbortSignal.timeout(20000) });
    return res.ok ? parseOlindaExpect(await res.json()) || {} : {};
  } catch { return {}; }
}
// 과거치 한 키 — brReal은 br10y(서버 — 네이버라 정상)를 받아 기대물가를 빼서 만든다. 실패하면 null
export async function fetchBcbHistoryBrowser(key: string, fromIso: string, toIso: string, fetchServer: (k: string, f: string, t: string) => Promise<Record<string, number> | null>): Promise<Record<string, number> | null> {
  let rec: Record<string, number> = {};
  if (key === 'brSelic') rec = await fetchBcbSgsBrowser(432, fromIso, toIso);
  else if (key === 'brIpca') rec = await fetchBcbSgsBrowser(13522, fromIso, toIso);
  else if (key === 'brExp12') rec = await fetchBcbExpectBrowser(fromIso, toIso);
  else if (key === 'brReal') {
    const r10 = await fetchServer('br10y', fromIso, toIso);
    const exp = await fetchBcbExpectBrowser(new Date(Date.parse(`${fromIso}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10), toIso);
    rec = r10 ? computeBrReal(r10, exp) : {};
  } else return null;
  return Object.keys(rec).length ? rec : null;
}

// 최대 capMs만 기다린다 — 브라질 보충이 느려도 다른 지표 갱신을 붙잡지 않는다(늦게 온 값은 다음 갱신 때 반영)
export const fillBrazilLiveCapped = (data: any, capMs = 6000): Promise<void> =>
  Promise.race([fillBrazilLive(data), new Promise<void>(r => setTimeout(r, capMs))]);

// /api/indicators 응답에서 비어 있는 브라질 값을 브라우저로 채운다(제자리 수정). 실시간 카드·금리 창 현재값용
export async function fillBrazilLive(data: any): Promise<void> {
  if (!data || typeof data !== 'object') return;
  const today = todayIso();
  const from = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const lastTwo = (rec: Record<string, number>, distinct: boolean) => {
    const ks = Object.keys(rec).sort();
    if (!ks.length) return null;
    const last = ks[ks.length - 1];
    let prev: string | undefined = ks[ks.length - 2];
    if (distinct) prev = [...ks].reverse().find(k => rec[k] !== rec[last]);
    return { price: rec[last], change: prev != null ? Math.round((rec[last] - rec[prev]) * 10000) / 10000 : 0, date: last };
  };
  const jobs: Array<Promise<void>> = [];
  if (data.brSelic?.price == null) jobs.push(fetchBcbSgsBrowser(432, new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10), today).then(r => { const v = lastTwo(r, true); if (v) data.brSelic = { ...v, source: 'BCB(브라우저)' }; }));
  if (data.brIpca?.price == null) jobs.push(fetchBcbSgsBrowser(13522, from, today).then(r => { const v = lastTwo(r, false); if (v) data.brIpca = { ...v, source: 'BCB(브라우저)' }; }));
  if (data.brExp12?.price == null) jobs.push(fetchBcbExpectBrowser(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), today).then(r => { const v = lastTwo(r, false); if (v) data.brExp12 = { ...v, source: 'BCB(브라우저)' }; }));
  await Promise.all(jobs);
  if (data.brReal?.price == null && data.br10y?.price != null && data.brExp12?.price != null) {
    data.brReal = { price: Math.round((data.br10y.price - data.brExp12.price) * 10000) / 10000, change: null, source: 'calc' };
  }
}
