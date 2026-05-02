// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Trash2, Save, Plus } from 'lucide-react';
import { parseSamsungFundCSV } from '../utils';

export default function DividendTaxPage({ onLoad, onSave, onClose, showToast, isAdmin, onUpdate }) {
  const [taxHistory, setTaxHistory] = useState({});
  const [selectedCode, setSelectedCode] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSynced, setLastSynced] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const fileInputRef = useRef(null);
  const didLoadRef = useRef(false); // 로드 성공 여부 — 실패 시 빈 {} 로 App 상태를 덮어쓰지 않기 위해

  useEffect(() => {
    onLoad()
      .then(data => {
        if (data && typeof data === 'object') {
          setTaxHistory(data);
          didLoadRef.current = true;
          const codes = Object.keys(data);
          if (codes.length > 0) setSelectedCode(codes[0]);
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  // taxHistory가 바뀔 때마다 App 전역 상태에 즉시 반영 (DividendSummaryTable 실시간 연동)
  // 로드 실패(파일 없음·오류) 시에는 빈 {} 로 App 의 dividendTaxHistory 를 덮어쓰지 않는다
  useEffect(() => {
    if (!isLoading && onUpdate && (didLoadRef.current || Object.keys(taxHistory).length > 0)) {
      onUpdate(taxHistory);
    }
  }, [taxHistory, isLoading]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(taxHistory);
      setLastSynced(new Date().toLocaleString('ko-KR'));
      showToast('저장되었습니다.');
    } catch {
      showToast('저장 실패', true);
    }
    setIsSaving(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !selectedCode) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const lines = text.split('\n');
      const rawFundName = lines[0]?.replace(/,+$/, '').trim() || '';
      const records = parseSamsungFundCSV(text);
      const count = Object.keys(records).length;
      if (count === 0) {
        showToast('파싱된 데이터가 없습니다. CSV 형식을 확인하세요.', true);
        return;
      }
      setTaxHistory(prev => ({
        ...prev,
        [selectedCode]: {
          name: rawFundName || prev[selectedCode]?.name || selectedCode,
          lastUpdated: new Date().toISOString().slice(0, 10),
          records: { ...(prev[selectedCode]?.records || {}), ...records },
        },
      }));
      showToast(`${count}개월 데이터가 추가되었습니다.`);
    };
    reader.readAsText(file, 'euc-kr');
    e.target.value = '';
  };

  const handleAddStock = () => {
    const code = newCode.trim();
    if (!code) return;
    if (taxHistory[code]) {
      setSelectedCode(code);
      setShowAddForm(false);
      setNewCode('');
      setNewName('');
      return;
    }
    setTaxHistory(prev => ({
      ...prev,
      [code]: { name: newName.trim() || code, lastUpdated: '', records: {} },
    }));
    setSelectedCode(code);
    setNewCode('');
    setNewName('');
    setShowAddForm(false);
  };

  const handleDeleteStock = () => {
    if (!selectedCode) return;
    const name = taxHistory[selectedCode]?.name || selectedCode;
    if (!window.confirm(`"${name}" 이력을 모두 삭제할까요?`)) return;
    setTaxHistory(prev => {
      const next = { ...prev };
      delete next[selectedCode];
      return next;
    });
    const remaining = Object.keys(taxHistory).filter(c => c !== selectedCode);
    setSelectedCode(remaining[0] || '');
  };

  const selectedStock = taxHistory[selectedCode];
  const sortedRecords = selectedStock
    ? Object.entries(selectedStock.records || {}).sort((a, b) => b[0].localeCompare(a[0]))
    : [];
  const codes = Object.keys(taxHistory);

  const fmtDate8 = (d) =>
    d?.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || '-';

  return (
    <div className="bg-gray-900 min-h-screen text-gray-200 font-sans text-sm">
      <div className="w-full max-w-4xl mx-auto py-6 px-4 flex flex-col gap-5">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-gray-100">배당 과세 이력 관리</h1>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 p-1.5 rounded hover:bg-gray-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="text-gray-500 text-center py-16">불러오는 중...</div>
        ) : (
          <>
            {/* 종목 선택 + 조작 */}
            <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-3 border border-gray-700/50">
              <div className="flex items-center gap-2 flex-wrap">
                {codes.length > 0 ? (
                  <select
                    value={selectedCode}
                    onChange={e => setSelectedCode(e.target.value)}
                    className="bg-gray-700 border border-gray-600 text-gray-200 rounded px-3 py-1.5 text-sm"
                  >
                    {codes.map(c => {
                      const n = taxHistory[c]?.name;
                      const label = n && n !== c ? `${n} (${c})` : c;
                      return <option key={c} value={c}>{label}</option>;
                    })}
                  </select>
                ) : (
                  <span className="text-gray-600 text-xs">등록된 종목 없음</span>
                )}

                <button
                  onClick={() => setShowAddForm(v => !v)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-400 transition-colors"
                >
                  <Plus size={11} />
                  종목 추가
                </button>

                {selectedCode && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-blue-700 text-blue-400 hover:text-blue-300 hover:border-blue-500 cursor-pointer transition-colors">
                      <Upload size={12} />
                      CSV 업로드
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </label>
                    <button
                      onClick={handleDeleteStock}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-600 hover:text-red-400 hover:border-red-700 transition-colors"
                    >
                      <Trash2 size={11} />
                      종목 삭제
                    </button>
                  </>
                )}
              </div>

              {showAddForm && (
                <div className="flex items-center gap-2 flex-wrap border-t border-gray-700 pt-3">
                  <input
                    value={newCode}
                    onChange={e => setNewCode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddStock()}
                    placeholder="종목코드 (예: 069500)"
                    className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm w-44 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddStock()}
                    placeholder="종목명 (선택 — CSV에서 자동 추출)"
                    className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm w-72 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleAddStock}
                    disabled={!newCode.trim()}
                    className="text-xs px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    추가
                  </button>
                  <button
                    onClick={() => { setShowAddForm(false); setNewCode(''); setNewName(''); }}
                    className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    취소
                  </button>
                </div>
              )}
            </div>

            {/* 이력 테이블 */}
            {selectedStock ? (
              <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
                <div className="px-4 py-2.5 border-b border-gray-700 flex items-center justify-between">
                  <span className="text-xs text-gray-300">
                    {selectedStock.name && selectedStock.name !== selectedCode ? selectedStock.name : selectedCode}
                    {selectedStock.name && selectedStock.name !== selectedCode && (
                      <span className="text-gray-600 ml-1.5">({selectedCode})</span>
                    )}
                    {selectedStock.lastUpdated && (
                      <span className="text-gray-600 ml-2">최종 업데이트: {selectedStock.lastUpdated}</span>
                    )}
                  </span>
                  <span className="text-xs text-gray-600">{sortedRecords.length}개월</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-700 bg-gray-800/40">
                        <th className="text-left px-4 py-2 font-medium">지급기준일</th>
                        <th className="text-left px-3 py-2 font-medium">실지급일</th>
                        <th className="text-right px-3 py-2 font-medium">분배율(%)</th>
                        <th className="text-right px-3 py-2 font-medium">분배금액(원)</th>
                        <th className="text-right px-3 py-2 font-medium">주당과세표준(원)</th>
                        <th className="text-right px-4 py-2 font-medium">과세비율(%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRecords.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-10 text-gray-600">
                            데이터 없음 — CSV를 업로드해주세요
                          </td>
                        </tr>
                      ) : (
                        sortedRecords.map(([ym, rec]) => {
                          const ratio = rec.perShareAmount > 0
                            ? (rec.perShareTaxableBase / rec.perShareAmount * 100)
                            : 0;
                          return (
                            <tr key={ym} className="border-b border-gray-700/40 hover:bg-gray-700/20 transition-colors">
                              <td className="px-4 py-2 text-gray-200 font-mono">{ym}</td>
                              <td className="px-3 py-2 text-gray-400 font-mono">{fmtDate8(rec.paymentDate)}</td>
                              <td className="px-3 py-2 text-right text-gray-300">{rec.distributionRate.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-gray-200">{rec.perShareAmount.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-amber-400 font-medium">{rec.perShareTaxableBase.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right text-gray-400">{ratio.toFixed(1)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : codes.length === 0 ? (
              <div className="text-center text-gray-600 py-16 border border-gray-700/40 rounded-lg">
                종목을 추가하고 CSV를 업로드하세요.
              </div>
            ) : null}

            {/* 저장 푸터 */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">
                {lastSynced ? `최종 저장: ${lastSynced}` : 'Drive에 저장되지 않음'}
              </span>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Save size={12} />
                {isSaving ? '저장 중...' : 'Drive 저장'}
              </button>
            </div>

            {/* 관리자 안내 */}
            {isAdmin && (
              <div className="bg-gray-800/30 rounded-lg px-4 py-3 border border-gray-700/40">
                <p className="text-xs text-gray-500">
                  사용자 접근 권한은 구글 시트의{' '}
                  <span className="text-gray-300 font-medium">기능2</span> 열에서
                  ON/OFF로 관리합니다.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
