// @ts-nocheck
import React from 'react';
import { generateId, cleanNum } from '../utils';

export default function PasteModal({
  isPasteModalOpen,
  setIsPasteModalOpen,
  portfolio,
  setPortfolio,
}) {
  if (!isPasteModalOpen) return null;

  const handleAdd = () => {
    const text = document.getElementById('paste-input')?.value;
    if (!text) return;
    const newItems = text.trim().split('\n').map(line => {
      const cols = line.split('\t');
      if (cols.length >= 5) return {
        id: generateId(), type: 'stock', category: '주식',
        code: cols[0].trim(), name: '',
        currentPrice: cleanNum(cols[1]), purchasePrice: cleanNum(cols[2]),
        quantity: cleanNum(cols[4]), targetRatio: 0, isManual: true,
      };
      return null;
    }).filter(x => x && x.code);
    setPortfolio([...newItems, ...portfolio]);
    setIsPasteModalOpen(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[300] animate-in fade-in backdrop-blur-sm">
      <div className="bg-[#1e293b] p-8 rounded-2xl w-full max-w-2xl border border-gray-600 shadow-2xl text-left">
        <h2 className="text-2xl font-extrabold mb-2 text-white">엑셀 데이터 일괄 추가</h2>
        <div className="text-gray-400 text-xs mb-4 font-semibold leading-relaxed">
          <p className="text-blue-400 mb-1">💡 엑셀 표에서 [종목코드]부터 [보유수량]까지 5개 열을 드래그해서 붙여넣으세요.</p>
          <p className="text-gray-500">(열 순서: 종목코드, 현재가격, 구매단가, 투자금액, 보유수량)</p>
        </div>
        <textarea
          id="paste-input"
          rows={8}
          className="w-full bg-gray-900 border border-gray-600 rounded-xl p-4 text-sm text-white font-mono focus:border-blue-500 transition shadow-inner outline-none"
          placeholder={"005930\t199,400\t164,022\t4,428,600\t27"}
        />
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setIsPasteModalOpen(false)} className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition">취소</button>
          <button onClick={handleAdd} className="px-8 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl font-extrabold shadow-lg border border-green-500 transition">데이터 일괄 추가</button>
        </div>
      </div>
    </div>
  );
}
