// @ts-nocheck
// 학습자료/리포트 HTML 뷰어 — sandbox iframe으로 격리 렌더.
// ⚠️ 회귀 주의(CLAUDE.md 불변식): sandbox에 'allow-same-origin' 절대 미부여 — 부여 시 자료 HTML이
//   앱 origin에서 실행돼 localStorage/Drive 토큰 접근이 가능해진다. iframe src 대신 fetch→srcDoc 주입 유지.
// /api/study-material 프록시가 text/plain(+nosniff)으로 중계한 HTML을 srcDoc에 넣는다.
// link.fileId 자료 전용(url 자료는 App.openMaterial이 새 탭으로 처리). materialViewerlink가 truthy일 때만
// 조건부 마운트 → 같은 fileId 닫기→다시 열기 시 재마운트되어 깔끔히 재조회된다.
import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export default function StudyMaterialViewer({ link, onClose }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!link?.fileId) return;
    let cancelled = false;
    setHtml('');
    setError('');
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/study-material?id=${encodeURIComponent(link.fileId)}`);
        if (!res.ok) throw new Error(String(res.status));
        const text = await res.text();
        if (!cancelled) setHtml(text);
      } catch {
        if (!cancelled) setError('자료를 불러오지 못했습니다.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [link?.fileId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!link) return null;

  return (
    <div className="fixed inset-0 z-[1150] bg-black/80 flex flex-col" onClick={onClose}>
      <div
        className="m-auto w-[96vw] h-[92vh] max-w-[1100px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
          <span className="text-gray-200 text-sm font-semibold truncate pr-2">{link.title}</span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors flex-shrink-0 p-1.5 -m-1.5"
            title="닫기 (Esc)"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 relative bg-white">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <div className="w-4 h-4 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
                불러오는 중…
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}
          {!loading && !error && (
            <iframe
              title={link.title}
              srcDoc={html}
              sandbox="allow-scripts allow-popups"
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
