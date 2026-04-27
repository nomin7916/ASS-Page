// @ts-nocheck
import React from 'react';
import { X } from 'lucide-react';
import { verifyPin } from './LoginGate';

export default function UnlockPinModal({
  showUnlockPinModal,
  setShowUnlockPinModal,
  unlockPinDigits,
  setUnlockPinDigits,
  unlockPinError,
  setUnlockPinError,
  authUser,
  setHideAmounts,
}) {
  if (!showUnlockPinModal) return null;

  const tryVerify = (digits) => {
    const pin = digits.join('');
    if (pin.length !== 4) return;
    if (verifyPin(pin, authUser.email)) {
      setHideAmounts(false);
      setShowUnlockPinModal(false);
    } else {
      setUnlockPinError('비밀번호가 틀렸습니다.');
      setUnlockPinDigits(['', '', '', '']);
      setTimeout(() => document.getElementById('ul-pin-0')?.focus(), 50);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[500] p-4">
      <div className="bg-[#0f172a] border border-gray-700/60 rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2 text-gray-200">
            <span className="text-[13px] font-bold text-gray-400 leading-none">₩</span>
            <span className="font-semibold text-sm">금액 보기</span>
          </div>
          <button
            onClick={() => setShowUnlockPinModal(false)}
            className="text-gray-600 hover:text-gray-300 transition-colors p-1 rounded"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium text-center">비밀번호를 입력하세요</p>
          <div className="flex gap-2.5 justify-center">
            {[0, 1, 2, 3].map(i => (
              <input
                key={i}
                id={`ul-pin-${i}`}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={unlockPinDigits[i] || ''}
                autoFocus={i === 0}
                onChange={e => {
                  if (!/^\d*$/.test(e.target.value)) return;
                  const next = [...unlockPinDigits];
                  next[i] = e.target.value.slice(-1);
                  setUnlockPinDigits(next);
                  setUnlockPinError('');
                  if (e.target.value && i < 3) {
                    document.getElementById(`ul-pin-${i + 1}`)?.focus();
                  } else if (e.target.value && i === 3) {
                    tryVerify(next);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Backspace' && !unlockPinDigits[i] && i > 0)
                    document.getElementById(`ul-pin-${i - 1}`)?.focus();
                  if (e.key === 'Enter') tryVerify(unlockPinDigits);
                }}
                className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg text-white outline-none transition-colors"
              />
            ))}
          </div>
          {unlockPinError && (
            <p className="text-red-400 text-xs text-center">{unlockPinError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
