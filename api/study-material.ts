// Vercel Edge Function — 학습자료(HTML) 프록시
// 관리자 Drive에 '링크 있는 사람 누구나 보기'로 업로드된 공개 HTML 파일을 서버사이드로 읽어 텍스트로 전달한다.
// 일반 사용자는 drive.file scope라 관리자 Drive 파일을 직접 못 읽으므로 이 프록시가 중계한다.
// 클라이언트는 응답 텍스트를 <iframe sandbox srcdoc>으로 격리 렌더하므로 Content-Type은 text/plain(nosniff)로 둬
// 이 엔드포인트로 직접 접근해도 우리 도메인에서 스크립트가 실행되지 않게 한다.
//
// 안정성: GOOGLE_API_KEY를 설정하면 Drive API(alt=media)를 1순위로 사용한다(권장).
// 미설정 시 공개 다운로드 엔드포인트로 폴백하지만, 이 엔드포인트는 로그인/바이러스 검사 인터스티셜
// HTML을 200으로 돌려줄 수 있어 그대로 중계하면 안 되므로 응답을 검증한 뒤에만 전달한다.

export const config = { runtime: 'edge' };

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? '';

// 공개 다운로드 엔드포인트가 파일 대신 로그인/확인 인터스티셜 HTML을 반환했는지 판별
function looksLikeInterstitial(res: Response, body: string): boolean {
  // 로그인 리다이렉트
  if (res.url && /accounts\.google\.com/i.test(res.url)) return true;
  // 바이러스 검사 경고 페이지
  if (/Google Drive\s*[-–]\s*Virus scan warning/i.test(body)) return true;
  if (/can(?:'|&#39;|’)?t scan this file/i.test(body)) return true;
  // 다운로드 확인 폼(confirm 토큰)
  if (/name="confirm"|confirm=[\w-]+/.test(body) && /<form/i.test(body)) return true;
  return false;
}

export default async function handler(request: Request): Promise<Response> {
  // 교차 출처 브라우저 호출 차단 — 같은 출처 fetch만 허용 (오픈 릴레이/CORS 남용 방지).
  // 같은 출처 GET fetch는 Sec-Fetch-Site: same-origin, 직접 내비게이션은 none, 비브라우저는 헤더 없음.
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs === 'cross-site' || sfs === 'same-site') {
    return new Response('Forbidden', { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Drive fileId 형식만 허용 (SSRF/임의 URL 차단, 길이 상한도 부여)
  if (!id || !/^[a-zA-Z0-9_-]{10,128}$/.test(id)) {
    return new Response('Invalid id', { status: 400 });
  }

  // 1순위: API 키 경유 Drive API(가장 안정적, 인터스티셜 없음) > 공개 다운로드 엔드포인트(키 불필요, 검증 필요)
  const apiUrl = GOOGLE_API_KEY
    ? `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${GOOGLE_API_KEY}`
    : null;
  const publicUrl = `https://drive.usercontent.google.com/download?id=${id}&export=download`;

  // [url, isPublicEndpoint]
  const candidates: Array<[string, boolean]> = apiUrl
    ? [[apiUrl, false], [publicUrl, true]]
    : [[publicUrl, true]];

  for (const [url, isPublic] of candidates) {
    try {
      const res = await fetch(url, {
        // @ts-ignore — Edge Runtime fetch cache option
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const body = await res.text();
      if (!body) continue;
      // 공개 엔드포인트는 로그인/확인 인터스티셜을 200으로 줄 수 있으므로 검증 후에만 중계
      if (isPublic && looksLikeInterstitial(res, body)) continue;
      return new Response(body, {
        status: 200,
        headers: {
          // srcdoc로만 사용 → 직접 접근 시 실행 방지 위해 text/plain + nosniff
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          // CORS 허용 헤더 미부여 → 교차 출처 브라우저에서 응답 본문 판독 불가(같은 출처 전용)
          'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
        },
      });
    } catch {
      // 다음 후보 시도
    }
  }

  return new Response('학습자료를 불러오지 못했습니다.', { status: 502 });
}
