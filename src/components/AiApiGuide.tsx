// @ts-nocheck
// ✨ AI API 연동 사용법(구글 Gemini) — 메모 달력 머리줄 버튼과 계좌 표 「📷 사진으로 보유 맞추기」 창이 같은 내용을 띄운다
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
        <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2 space-y-1.5">
          <div className="text-gray-100 font-semibold">자주 묻는 것</div>
          <p><b className="text-gray-200">무료 한도를 다 쓰면</b> — 'Gemini 무료 사용량을 다 썼습니다'가 뜹니다. 하루 한도는 미국 태평양 시간 자정(한국 시간 오후 4~5시)에 다시 채워집니다. 한도는 모델·프로젝트마다 다르고 구글이 바꾸기도 해서 숫자는 AI 스튜디오 왼쪽 메뉴의 사용량(Usage)·한도(Rate limit) 화면에서 확인합니다.</p>
          <p><b className="text-gray-200">키가 맞지 않는다고 나오면</b> — 키를 다시 복사해 앞뒤 빈칸 없이 붙여넣으세요.</p>
          <p><b className="text-gray-200">키를 지우려면</b> — 사진으로 보유 맞추기 창의 [키 지우기]. 키 자체를 없애려면 AI 스튜디오의 API 키 화면에서 지웁니다(새어 나갔다고 생각될 때도 지우고 새로 만드세요).</p>
          <p><b className="text-gray-200">사진은 어디에 남나요</b> — 이 사이트는 사진을 저장하지 않습니다(읽을 때만 Gemini로 넘김). 다만 구글 약관상 무료 등급에서는 보낸 내용이 구글 서비스 개선에 쓰일 수 있습니다. 계좌번호·이름이 신경 쓰이면 그 부분을 잘라 낸 캡처를 올리세요.</p>
          <p><b className="text-gray-200">목록이 한 화면에 다 안 보이면</b> — 내려 가며 여러 장 찍어 한 번에 모두 고르세요(겹친 종목은 한 번만 셉니다). 맨 아래 종목이 잘린 사진만 있으면 안 보이는 종목은 0으로 하지 않고 그대로 둡니다.</p>
        </div>
        <p className="text-[11px] text-gray-500">그림은 이해를 돕는 예시입니다 — 실제 구글 화면의 글자·배치는 조금 다를 수 있습니다.</p>
      </div>
    </div>
  );
}
