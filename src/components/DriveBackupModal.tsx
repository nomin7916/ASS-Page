// @ts-nocheck
import React from 'react';
import { History, RefreshCw, X } from 'lucide-react';
import { MAX_BACKUPS } from '../driveStorage';

export default function DriveBackupModal({
  showBackupModal,
  setShowBackupModal,
  backupListLoading,
  backupList,
  applyingBackupId,
  handleApplyBackup,
}) {
  if (!showBackupModal) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f172a] border border-gray-700/60 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2 text-gray-200">
            <History size={14} className="text-purple-400" />
            <span className="font-semibold text-sm">Drive 백업 이력</span>
          </div>
          <button onClick={() => setShowBackupModal(false)} className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          {backupListLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-500 gap-2">
              <RefreshCw size={16} className="animate-spin" />
              <span className="text-xs">백업 목록 불러오는 중...</span>
            </div>
          ) : backupList.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-xs">저장된 백업이 없습니다<br /><span className="text-gray-600">로그인 시 자동 생성 · 수동 Save 시 생성됩니다</span></div>
          ) : (
            <div className="space-y-2">
              {backupList.filter(b => b.name.includes('_manual') || b.name.startsWith('[수동]') || b.name.includes('_change')).slice(0, 12).map((backup) => {
                const m = backup.name.match(/portfolio_backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
                const displayTime = m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : backup.name;
                const isApplying = applyingBackupId === backup.id;
                const isChange = backup.name.includes('_change');
                return (
                  <div key={backup.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-800/70 border border-gray-700/40 hover:border-purple-700/40 transition">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-300 font-mono">{displayTime}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${isChange ? 'bg-orange-700/60 text-orange-200' : 'bg-blue-700/60 text-blue-200'}`}>
                        {isChange ? '변경' : '수동'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleApplyBackup(backup.id, displayTime)}
                      disabled={!!applyingBackupId}
                      className="text-[11px] px-3 py-1 rounded bg-purple-700 hover:bg-purple-600 text-white font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isApplying ? '적용중...' : '적용'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[10px] text-gray-600 text-center">수동 최대 {MAX_BACKUPS}개 · 변경 최대 {MAX_BACKUPS}개 저장</p>
        </div>
      </div>
    </div>
  );
}
