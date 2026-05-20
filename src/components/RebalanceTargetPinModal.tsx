// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import { verifyPin } from './LoginGate';

export default function RebalanceTargetPinModal({
  open,
  authUser,
  onAuthorized,
  onClose,
}) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const inputsRef = useRef([]);

  useEffect(() => {
    if (open) {
      setDigits(['', '', '', '']);
      setError('');
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const tryVerify = (arr) => {
    const pin = arr.join('');
    if (pin.length !== 4) return;
    if (verifyPin(pin, authUser?.email)) {
      onAuthorized();
    } else {
      setError('비밀번호가 틀렸습니다.');
      setDigits(['', '', '', '']);
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[600] p-4">
      <div className="bg-[#0f172a] border border-amber-500/40 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 bg-amber-950/30">
          <div className="flex items-center gap-2 text-amber-300">
            <ShieldAlert size={16} />
            <span className="font-bold text-sm">주의 — 목표 비중 변경</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded"
            title="닫기"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-gray-200 text-[13px] leading-relaxed text-center">
            이전 목표 변경을 하시겠습니까?<br />
            원하시면 사용자 비밀번호를 입력해 주세요.
          </p>
          <div className="flex gap-2.5 justify-center">
            {[0, 1, 2, 3].map(i => (
              <input
                key={i}
                ref={el => (inputsRef.current[i] = el)}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={digits[i] || ''}
                onChange={e => {
                  if (!/^\d*$/.test(e.target.value)) return;
                  const next = [...digits];
                  next[i] = e.target.value.slice(-1);
                  setDigits(next);
                  setError('');
                  if (e.target.value && i < 3) {
                    inputsRef.current[i + 1]?.focus();
                  } else if (e.target.value && i === 3) {
                    tryVerify(next);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Backspace' && !digits[i] && i > 0) {
                    inputsRef.current[i - 1]?.focus();
                  }
                  if (e.key === 'Enter') tryVerify(digits);
                  if (e.key === 'Escape') onClose();
                }}
                className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-amber-500 rounded-lg text-white outline-none transition-colors"
              />
            ))}
          </div>
          {error && (
            <p className="text-red-400 text-xs text-center">{error}</p>
          )}
          <p className="text-[10px] text-gray-500 text-center leading-relaxed">
            세션 동안 1회 인증되며, 앱을 새로 시작하면 다시 입력해야 합니다.
          </p>
        </div>
      </div>
    </div>
  );
}
