// @ts-nocheck
import React from 'react';
import { Lock, X } from 'lucide-react';
import { verifyPin, savePin, hashPin, savePinToDrive } from './LoginGate';

export default function PinChangeModal({
  showPinChange,
  setShowPinChange,
  pinCurrent,
  setPinCurrent,
  pinNew,
  setPinNew,
  pinConfirm,
  setPinConfirm,
  pinChangeError,
  setPinChangeError,
  pinChangeSaving,
  setPinChangeSaving,
  authUser,
  notify,
}) {
  if (!showPinChange) return null;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f172a] border border-gray-700/60 rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2 text-gray-200">
            <Lock size={14} className="text-gray-400" />
            <span className="font-semibold text-sm">비밀번호 변경</span>
          </div>
          <button
            onClick={() => setShowPinChange(false)}
            className="text-gray-600 hover:text-gray-300 transition-colors p-1 rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* 입력 영역 */}
        <div className="px-5 py-5 space-y-5">
          {/* 현재 비밀번호 */}
          <div className="space-y-2.5">
            <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">현재 비밀번호</p>
            <div className="flex gap-2.5 justify-center">
              {[0,1,2,3].map(i => (
                <input key={i} id={`pc-cur-${i}`} type="password" inputMode="numeric" maxLength={1}
                  value={pinCurrent[i] || ''}
                  onChange={e => {
                    if (!/^\d*$/.test(e.target.value)) return;
                    const n = [...pinCurrent]; n[i] = e.target.value.slice(-1); setPinCurrent(n);
                    setPinChangeError('');
                    if (e.target.value && i < 3) document.getElementById(`pc-cur-${i+1}`)?.focus();
                  }}
                  onKeyDown={e => { if (e.key==='Backspace' && !pinCurrent[i] && i>0) document.getElementById(`pc-cur-${i-1}`)?.focus(); }}
                  className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg text-white outline-none transition-colors"
                />
              ))}
            </div>
          </div>

          {/* 구분선 */}
          <div className="border-t border-gray-800" />

          {/* 새 비밀번호 */}
          <div className="space-y-2.5">
            <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">새 비밀번호</p>
            <div className="flex gap-2.5 justify-center">
              {[0,1,2,3].map(i => (
                <input key={i} id={`pc-new-${i}`} type="password" inputMode="numeric" maxLength={1}
                  value={pinNew[i] || ''}
                  onChange={e => {
                    if (!/^\d*$/.test(e.target.value)) return;
                    const n = [...pinNew]; n[i] = e.target.value.slice(-1); setPinNew(n);
                    setPinChangeError('');
                    if (e.target.value && i < 3) document.getElementById(`pc-new-${i+1}`)?.focus();
                  }}
                  onKeyDown={e => { if (e.key==='Backspace' && !pinNew[i] && i>0) document.getElementById(`pc-new-${i-1}`)?.focus(); }}
                  className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg text-white outline-none transition-colors"
                />
              ))}
            </div>
          </div>

          {/* 새 비밀번호 확인 */}
          <div className="space-y-2.5">
            <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">새 비밀번호 확인</p>
            <div className="flex gap-2.5 justify-center">
              {[0,1,2,3].map(i => (
                <input key={i} id={`pc-cfm-${i}`} type="password" inputMode="numeric" maxLength={1}
                  value={pinConfirm[i] || ''}
                  onChange={e => {
                    if (!/^\d*$/.test(e.target.value)) return;
                    const n = [...pinConfirm]; n[i] = e.target.value.slice(-1); setPinConfirm(n);
                    setPinChangeError('');
                    if (e.target.value && i < 3) document.getElementById(`pc-cfm-${i+1}`)?.focus();
                  }}
                  onKeyDown={e => { if (e.key==='Backspace' && !pinConfirm[i] && i>0) document.getElementById(`pc-cfm-${i-1}`)?.focus(); }}
                  className="w-11 h-11 text-center text-lg font-bold bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg text-white outline-none transition-colors"
                />
              ))}
            </div>
          </div>

          {pinChangeError && (
            <p className="text-red-400 text-xs text-center">{pinChangeError}</p>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 pb-5">
          <button
            disabled={pinChangeSaving}
            onClick={async () => {
              const cur = pinCurrent.join('');
              const np = pinNew.join('');
              const cp = pinConfirm.join('');
              if (cur.length < 4) { setPinChangeError('현재 비밀번호를 입력하세요.'); return; }
              if (!verifyPin(cur, authUser.email)) { setPinChangeError('현재 비밀번호가 틀렸습니다.'); setPinCurrent(['','','','']); return; }
              if (np.length < 4) { setPinChangeError('새 비밀번호를 입력하세요.'); return; }
              if (np !== cp) { setPinChangeError('새 비밀번호가 일치하지 않습니다.'); setPinConfirm(['','','','']); return; }
              setPinChangeSaving(true);
              savePin(np, authUser.email);
              await savePinToDrive(hashPin(np), authUser.token, authUser.email);
              setPinChangeSaving(false);
              setShowPinChange(false);
              notify('비밀번호가 변경되었습니다.', 'success');
            }}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            {pinChangeSaving ? (
              <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />저장 중...</>
            ) : '변경 완료'}
          </button>
        </div>
      </div>
    </div>
  );
}
