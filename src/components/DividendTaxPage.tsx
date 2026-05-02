// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Trash2, Save, Plus, FileText } from 'lucide-react';
import { parseSamsungFundCSV } from '../utils';

export default function DividendTaxPage({ onLoad, onSave, onClose, showToast, isAdmin, onUpdate }) {
  const [taxHistory, setTaxHistory] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSynced, setLastSynced] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [historyPopupCode, setHistoryPopupCode] = useState(null);
  const [editingNameCode, setEditingNameCode] = useState(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef('');
  const nameInputRef = useRef(null);
  const didLoadRef = useRef(false);

  useEffect(() => {
    onLoad()
      .then(data => {
        if (data && typeof data === 'object') {
          setTaxHistory(data);
          didLoadRef.current = true;
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

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

  const triggerUpload = (code) => {
    uploadTargetRef.current = code;
    fileInputRef.current?.click();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    const code = uploadTargetRef.current;
    if (!file || !code) return;
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
        [code]: {
          name: rawFundName || (prev[code]?.name !== code ? prev[code]?.name : '') || '',
          lastUpdated: new Date().toISOString().slice(0, 10),
          records: { ...(prev[code]?.records || {}), ...records },
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
    setTaxHistory(prev => {
      if (prev[code]) return prev;
      return { ...prev, [code]: { name: newName.trim(), lastUpdated: '', records: {} } };
    });
    setNewCode('');
    setNewName('');
    setShowAddForm(false);
  };

  const startEditName = (code) => {
    const current = taxHistory[code]?.name || '';
    const effective = current === code ? '' : current;
    setEditingNameCode(code);
    setEditingNameValue(effective);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const commitEditName = () => {
    if (!editingNameCode) return;
    const val = editingNameValue.trim();
    setTaxHistory(prev => ({
      ...prev,
      [editingNameCode]: { ...prev[editingNameCode], name: val },
    }));
    setEditingNameCode(null);
    setEditingNameValue('');
  };

  const handleDeleteStock = (code) => {
    const name = taxHistory[code]?.name || code;
    if (!window.confirm(`"${name}" 이력을 모두 삭제할까요?`)) return;
    setTaxHistory(prev => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
    if (historyPopupCode === code) setHistoryPopupCode(null);
  };

  const fmtDate8 = (d) =>
    d?.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || '-';

  const codes = Object.keys(taxHistory);
  const popupStock = historyPopupCode ? taxHistory[historyPopupCode] : null;
  const popupRecords = popupStock
    ? Object.entries(popupStock.records || {}).sort((a, b) => b[0].localeCompare(a[0]))
    : [];

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
            {/* 종목 추가 버튼 + 폼 */}
            <div className="bg-gray-800/50 rounded-lg p-4 flex flex-col gap-3 border border-gray-700/50">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddForm(v => !v)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-400 transition-colors"
                >
                  <Plus size={11} />
                  종목 추가
                </button>
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

            {/* 종목 목록 테이블 */}
            {codes.length === 0 ? (
              <div className="text-center text-gray-600 py-16 border border-gray-700/40 rounded-lg">
                종목을 추가하고 CSV를 업로드하세요.
              </div>
            ) : (
              <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700 bg-gray-800/40">
                      <th className="text-left px-4 py-2.5 font-medium">종목명</th>
                      <th className="text-left px-3 py-2.5 font-medium">종목코드</th>
                      <th className="text-center px-3 py-2.5 font-medium">저장 건수</th>
                      <th className="text-center px-3 py-2.5 font-medium">이력</th>
                      <th className="text-center px-3 py-2.5 font-medium">CSV 업로드</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map(code => {
                      const stock = taxHistory[code];
                      const count = Object.keys(stock?.records || {}).length;
                      const rawName = stock?.name && stock.name !== code ? stock.name : '';
                      const isEditingName = editingNameCode === code;
                      return (
                        <tr key={code} className="border-b border-gray-700/40 hover:bg-gray-700/20 transition-colors">
                          <td className="px-4 py-2.5">
                            {isEditingName ? (
                              <input
                                ref={nameInputRef}
                                value={editingNameValue}
                                onChange={e => setEditingNameValue(e.target.value)}
                                onBlur={commitEditName}
                                onKeyDown={e => { if (e.key === 'Enter') commitEditName(); if (e.key === 'Escape') { setEditingNameCode(null); setEditingNameValue(''); } }}
                                placeholder="종목명 입력"
                                className="bg-gray-700 border border-blue-500 rounded px-2 py-0.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none w-full max-w-[180px]"
                              />
                            ) : (
                              <button
                                onClick={() => startEditName(code)}
                                className="text-left group flex items-center gap-1.5 min-w-[80px]"
                                title="클릭하여 종목명 편집"
                              >
                                {rawName
                                  ? <span className="text-gray-200">{rawName}</span>
                                  : <span className="text-gray-600 italic">이름 없음</span>
                                }
                                <span className="text-gray-700 group-hover:text-gray-400 text-[10px] transition-colors">✎</span>
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-gray-400 font-mono">{code}</td>
                          <td className="px-3 py-2.5 text-center text-gray-300">
                            {count > 0 ? <span className="text-blue-400">{count}건</span> : <span className="text-gray-600">-</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => setHistoryPopupCode(code)}
                              disabled={count === 0}
                              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-gray-600 text-gray-400 hover:text-blue-300 hover:border-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <FileText size={10} />
                              이력
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => triggerUpload(code)}
                              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-blue-700/60 text-blue-400 hover:text-blue-300 hover:border-blue-500 transition-colors"
                            >
                              <Upload size={10} />
                              CSV
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => handleDeleteStock(code)}
                              className="text-gray-600 hover:text-red-400 transition-colors p-1"
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />

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

      {/* 이력 팝업 */}
      {historyPopupCode && popupStock && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setHistoryPopupCode(null); }}
        >
          <div className="bg-gray-900 rounded-lg border border-gray-700 w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
              <div className="flex items-center gap-2">
                {popupStock.name && popupStock.name !== historyPopupCode && (
                  <span className="text-sm font-medium text-gray-100">{popupStock.name}</span>
                )}
                <span className="text-xs text-gray-400 font-mono">{historyPopupCode}</span>
                <span className="text-xs text-gray-600">({popupRecords.length}건)</span>
              </div>
              <button
                onClick={() => setHistoryPopupCode(null)}
                className="text-gray-500 hover:text-gray-200 p-1 rounded hover:bg-gray-800 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="text-gray-500 border-b border-gray-700 bg-gray-800/60">
                    <th className="text-left px-4 py-2 font-medium">지급기준일</th>
                    <th className="text-left px-3 py-2 font-medium">실지급일</th>
                    <th className="text-right px-3 py-2 font-medium">분배율(%)</th>
                    <th className="text-right px-3 py-2 font-medium">분배금액(원)</th>
                    <th className="text-right px-3 py-2 font-medium">주당과세표준(원)</th>
                    <th className="text-right px-4 py-2 font-medium">과세비율(%)</th>
                  </tr>
                </thead>
                <tbody>
                  {popupRecords.map(([ym, rec]) => {
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
                  })}
                </tbody>
              </table>
            </div>
            {popupStock.lastUpdated && (
              <div className="px-4 py-2 border-t border-gray-700/60 shrink-0">
                <span className="text-xs text-gray-600">최종 업데이트: {popupStock.lastUpdated}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
