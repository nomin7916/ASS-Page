// @ts-nocheck
import React, { useState, useEffect } from 'react';

const InactivityModal = ({ onContinue, onLogout }) => {
  const [seconds, setSeconds] = useState(60);

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(prev => {
        if (prev <= 1) {
          clearInterval(id);
          onLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#0f1623] border border-gray-600 rounded-xl p-8 max-w-sm w-full mx-4 text-center shadow-2xl">
        <div className="text-4xl mb-4">⏱️</div>
        <h2 className="text-white text-xl font-bold mb-2">세션 만료 안내</h2>
        <p className="text-gray-400 text-sm mb-5">
          50분간 사용이 없어 곧 자동 로그아웃됩니다.<br />
          데이터가 저장된 후 앱이 종료됩니다.
        </p>
        <div
          className={`text-6xl font-mono font-bold mb-6 tabular-nums transition-colors ${seconds <= 10 ? 'text-red-400 animate-pulse' : 'text-amber-400'}`}
        >
          {seconds}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onContinue}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg font-semibold transition"
          >
            계속 사용
          </button>
          <button
            onClick={onLogout}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-2.5 rounded-lg font-semibold transition"
          >
            지금 로그아웃
          </button>
        </div>
      </div>
    </div>
  );
};

export default InactivityModal;
