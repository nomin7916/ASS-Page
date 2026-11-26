// @ts-nocheck
// ✨ AI API 연동 사용법(구글 Gemini + 다른 AI 안내 한 칸) — 메모 달력 머리줄 버튼과 계좌 표 「📷 사진으로 보유 맞추기」 창이 같은 내용을 띄운다
// (사용자 요청 2026-11-26: "구글 재미나이 api 사용법을 사진으로 만들어서 메모달력에 별도로").
// 그림은 public/ai-guide/*.svg(설명용 예시 그림 — 구글 화면을 베낀 것이 아니다). 읽기만 하는 안내라 저장·호출 없음.
import React from 'react';
import { X, ExternalLink, BookOpen } from 'lucide-react';

export const AI_KEY_PAGE = 'https://aistudio.google.com/apikey';

const STEPS = [
  { img: '/ai-guide/1-open.svg', text: 'aistudio.google.com/apikey 를 열고, 이 사이트에 로그인한 것과 같은 구글 계정으로 로그인합니다. 처음이면 약관에 동의합니다.' },
  { img: '/ai-guide/2-create.svg', text: '[API 키 만들기(Create API key)]를 누릅니다. 프로젝트는 기본값 그대로 두고 [키 만들기]. 카드 등록·결제는 하지 않아도 됩니다(무료 등급).' },
  { img: '/ai-guide/3-copy.svg', text: 'AIza로 시작하는 긴 글자가 키입니다. 옆의 [복사]를 누릅니다. 키는 비밀번호처럼 남에게 보여 주지 마세요.' },
  { img: '/ai-guide/4-paste.svg', text: '이 사이트 계좌 표 오른쪽 위 사진 아이콘(엑셀 아이콘 아래) → [내 Gemini API 키] 칸에 붙여넣고 [저장]. 내 구글 Drive에 보관돼 PC·휴대폰 모두 씁니다.' },
  { img: '/ai-guide/5-use.svg', text: '증권사 앱의 잔고(보유종목) 화면을 캡처해 [사진 고르기]로 올리면 보유수량·투자금액이 바로 맞춰집니다. 잘못되면 [되돌리기].' },
];

export default function AiApiGuide({ onClose, inline = false }) {
  return (
    <div className={inline ? 'flex flex-col min-h-0' : 'absolute inset-0 z-20 flex flex-col bg-[#0b1120]'}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen size={15} className="text-amber-300 shrink-0" />
          <span className="text-gray-100 font-semibold text-sm truncate">AI API 연동 사용법 — 구글 Gemini (무료)</span>
        </div>
        {onClose && (
          <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} title="사용법 닫기" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition shrink-0">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4 text-[12.5px] leading-relaxed text-gray-300">
        <div className="rounded-lg border border-sky-700/40 bg-sky-900/15 px-3 py-2 space-y-1">
          <p>계좌 표 오른쪽 위 사진 아이콘(엑셀 아이콘 아래)의 <b className="text-sky-200">사진으로 보유 맞추기</b>는 구글 Gemini AI가 잔고 사진을 읽어 보유수량·투자금액을 맞춥니다.</p>
          <p>관리자는 사이트 키로 바로 씁니다. <b className="text-amber-200">다른 사용자는 본인 구글 계정의 무료 Gemini API 키</b>를 한 번 넣어 두면 본인 무료 한도로 씁니다.</p>
          <p>위쪽 막대의 말풍선 아이콘 <b className="text-sky-200">AI 검색</b>도 같은 키를 씁니다 — 구글 검색으로 최신 자료를 찾아 답하고, 답을 소리로 들을 수 있습니다(AI 검색 창 ⚙ 설정에서 키를 넣어도 됩니다).</p>
          <a href={AI_KEY_PAGE} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 px-2.5 py-1 rounded-md bg-sky-700 hover:bg-sky-600 text-white font-bold text-[12px] transition">
            키 만들러 가기 (aistudio.google.com/apikey) <ExternalLink size={12} />
          </a>
        </div>
        {STEPS.map((s, i) => (
          <figure key={s.img} className="space-y-1.5">
            <img src={s.img} alt={`${i + 1}단계 그림`} loading="lazy" className="w-full h-auto rounded-xl border border-gray-700/60" />
            <figcaption className="text-gray-300"><b className="text-sky-300">{i + 1}.</b> {s.text}</figcaption>
          </figure>
        ))}
        <div className="rounded-lg border border-amber-600/40 bg-amber-900/10 px-3 py-2 space-y-1.5">
          <div className="text-amber-200 font-semibold">Google AI Pro 구독이 있다면 — 매달 $10 크레딧으로 쓰기</div>
          <p><b className="text-gray-200">구독과 API는 따로입니다.</b> Gemini 앱의 「사용량 한도 0%」는 앱에서 대화할 때의 한도이고, 이 사이트는 API 키로 부르므로 요금·한도를 키의 프로젝트에서 셉니다.</p>
          <p>대신 Google AI Pro에는 <b className="text-amber-200">매달 $10의 Google Cloud 크레딧</b>(Google Developer Program 혜택)이 들어 있어 Gemini API에 쓸 수 있습니다. 저절로 들어오지 않으니 한 번 받아야 합니다.</p>
          <ol className="list-decimal pl-5 space-y-0.5">
            <li>aistudio.google.com 왼쪽 메뉴 <b className="text-gray-200">결제(Billing)</b> → 선불 지갑에 <b className="text-gray-200">최소 $5 충전</b>(충전 잔액이 0원이면 크레딧이 있어도 402가 납니다).</li>
            <li>같은 결제 화면(또는 developers.google.com/profile 의 혜택)에서 <b className="text-gray-200">구독 크레딧 받기</b> → 결제 계정을 고릅니다.</li>
            <li>API 키 화면에서 그 키의 <b className="text-gray-200">프로젝트가 그 결제 계정에 연결</b>돼 있는지 봅니다(다른 프로젝트 키면 그 프로젝트를 연결하거나 새 키를 만듭니다).</li>
            <li>AI 검색에서 「다시 묻기」. 크레딧이 충전금보다 먼저 쓰입니다.</li>
          </ol>
          <p className="text-gray-400">크레딧은 구독 혜택을 처음 받은 날 기준으로 매달 들어옵니다. 넘는 금액은 충전금에서 빠지니 Google Cloud 결제에서 예산 알림($10)을 걸어 두면 안전합니다. 버튼 이름은 구글이 바꾸기도 합니다(2026-11 기준 안내).</p>
          <a href="https://aistudio.google.com/projects" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-700 hover:bg-amber-600 text-white font-bold text-[12px] transition">
            AI Studio 프로젝트·결제 열기 <ExternalLink size={12} />
          </a>
        </div>
        <div className="rounded-lg border border-violet-600/40 bg-violet-900/10 px-3 py-2 space-y-1.5">
          <div className="text-violet-200 font-semibold">Gemini 말고 다른 AI — ChatGPT · Claude · Grok · Genspark · Perplexity …</div>
          <p>AI 검색 창에서 두 가지 길로 씁니다. 둘 다 <b className="text-gray-200">각자 본인 계정</b>으로 쓰고, 다른 사용자와 섞이지 않습니다.</p>
          <ol className="list-decimal pl-5 space-y-0.5">
            <li><b className="text-violet-200">내 구독으로 묻기 (API 키 없이)</b> — 질문을 쓰고 입력 칸 아래의 AI 이름을 누르면, 그 AI 사이트가 <b className="text-gray-200">내 로그인(무료·구독 그대로)</b>으로 열리고 질문이 들어갑니다. 답을 복사해 돌아와 「답 붙여넣기」를 누르면 이 대화에 저장돼 듣기·복사·이어 묻기가 됩니다.</li>
            <li><b className="text-violet-200">다른 AI 연결 (내 계정 키)</b> — AI 검색 창 ⚙ 설정에서 회사별 키를 넣으면 사이트 안에서 바로 답을 받습니다. 카드 없이 되는 무료: OpenRouter · Groq · GitHub Models · Cerebras · Mistral. 유료(충전·구독 포인트): Claude · OpenAI · Grok · DeepSeek · Poe.</li>
          </ol>
          <p className="text-gray-400">ChatGPT Plus · Claude Pro · SuperGrok · Genspark 같은 <b className="text-gray-300">구독은 그 회사의 앱·사이트에서만</b> 쓰이고 API 키와는 따로입니다(구글과 같습니다) — 그래서 구독은 1번 길로 씁니다. 구독 로그인(비밀번호·쿠키)을 이 사이트에 넣는 방식은 약관 위반·계정 정지 위험이 있어 만들지 않았습니다.</p>
        </div>
        <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2 space-y-1.5">
          <div className="text-gray-100 font-semibold">자주 묻는 것</div>
          <p><b className="text-gray-200">무료 한도를 다 쓰면</b> — 'Gemini 무료 사용량을 다 썼습니다'가 뜹니다. 하루 한도는 미국 태평양 시간 자정(한국 시간 오후 4~5시)에 다시 채워집니다. 한도는 모델·프로젝트마다 다르고 구글이 바꾸기도 해서 숫자는 AI 스튜디오 왼쪽 메뉴의 사용량(Usage)·한도(Rate limit) 화면에서 확인합니다.</p>
          <p><b className="text-gray-200">키가 맞지 않는다고 나오면</b> — 키를 다시 복사해 앞뒤 빈칸 없이 붙여넣으세요.</p>
          <p><b className="text-gray-200">'선불 크레딧이 다 떨어졌습니다'(402)가 나오면</b> — 그 키의 프로젝트에 결제(선불 충전)가 연결돼 무료 등급이 아니게 된 것입니다. AI 스튜디오의 프로젝트·결제 화면에서 충전하거나, 결제를 연결하지 않은 새 프로젝트에서 키를 만들어 바꿔 넣으세요.</p>
          <p><b className="text-gray-200">키를 지우려면</b> — 사진으로 보유 맞추기 창의 [키 지우기]. 키 자체를 없애려면 AI 스튜디오의 API 키 화면에서 지웁니다(새어 나갔다고 생각될 때도 지우고 새로 만드세요).</p>
          <p><b className="text-gray-200">사진은 어디에 남나요</b> — 이 사이트는 사진을 저장하지 않습니다(읽을 때만 Gemini로 넘김). 다만 구글 약관상 무료 등급에서는 보낸 내용이 구글 서비스 개선에 쓰일 수 있습니다. 계좌번호·이름이 신경 쓰이면 그 부분을 잘라 낸 캡처를 올리세요.</p>
          <p><b className="text-gray-200">목록이 한 화면에 다 안 보이면</b> — 내려 가며 여러 장 찍어 한 번에 모두 고르세요(겹친 종목은 한 번만 셉니다). 맨 아래 종목이 잘린 사진만 있으면 안 보이는 종목은 0으로 하지 않고 그대로 둡니다.</p>
        </div>
        <p className="text-[11px] text-gray-500">그림은 이해를 돕는 예시입니다 — 실제 구글 화면의 글자·배치는 조금 다를 수 있습니다.</p>
      </div>
    </div>
  );
}
