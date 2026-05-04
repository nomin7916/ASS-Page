// @ts-nocheck
import React from 'react';
import type { ConfirmState } from '../hooks/useToast';

interface Props {
  state: ConfirmState | null;
  onResolve: (result: boolean) => void;
}

export default function ConfirmDialog({ state, onResolve }: Props) {
  if (!state) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70"
      onClick={() => onResolve(false)}
    >
      <div
        className="bg-[#0f1623] border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm text-gray-200 whitespace-pre-line leading-relaxed">{state.message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onResolve(false)}
            className="px-4 py-1.5 rounded-lg text-sm text-gray-400 border border-gray-700 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => onResolve(true)}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-red-700 hover:bg-red-600 transition-colors"
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
