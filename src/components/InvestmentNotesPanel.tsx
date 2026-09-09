// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { X, Plus, Check, Trash2, Maximize2 } from 'lucide-react';
import { generateId } from '../utils';
import { getTodayKST } from '../hooks/useMarketCalendar';

/**
 * 투자 기록(investmentNotes) — 목록 + 메모장.
 *
 * ⚠️ 목록과 메모장은 **상호 배타**다(사용자 요청 2026-09). 예전에는 목록 위에 메모장이 겹쳐 떠서
 *    목록 · 메모장 · 뒤의 자산관리 대시보드가 3중으로 겹쳐 어느 것도 읽을 수 없었다.
 *    이제 `+`(새 메모)·⤢(기존 메모 열기)를 누르면 **목록이 사라지고 메모장만** 남고,
 *    저장(✓)·취소(✕)하면 **다시 목록으로 돌아온다**. 두 화면을 동시에 띄우는 형태로 되돌리지 말 것.
 *
 * ⚠️ 인앱 팝업(variant='popup')과 별도 브라우저 창(variant='page')이 **이 한 컴포넌트를 공유**한다 —
 *    창용으로 복제하면 두 화면이 갈린다(CardWindow의 다른 카드와 같은 규약).
 *
 * ⚠️ 쓰기는 전부 `onUpdate(nextNotes)` 하나로 나간다(배열 통째 교체). 별도 창에서는 그 핸들러가
 *    base 지문을 실어 앱 탭에 보내고, 앱 탭이 불일치를 감지하면 거부한다(cardWindow INV-4).
 */

export const formatNoteDate = (iso) => {
  if (!iso) return '날짜';
  const p = String(iso).split('-');
  return p.length === 3 ? `${p[0].slice(2)}/${p[1]}/${p[2]}` : String(iso);
};

export const sortNotesDesc = (notes) =>
  [...(notes || [])].sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')));

// 줄노트 배경 — 목록·메모장이 같은 값을 써야 두 화면의 줄 간격이 어긋나지 않는다.
const RULED = (topOffset) => ({
  backgroundColor: '#000',
  backgroundImage: 'repeating-linear-gradient(transparent 0px, transparent 35px, rgba(99,130,255,0.25) 35px, rgba(99,130,255,0.25) 36px)',
  backgroundSize: '100% 36px',
  backgroundPosition: `0 ${topOffset}`,
  lineHeight: '36px',
});

// ⚠️ 인라인 SVG — 이 저장소는 package-lock.json이 없어 새 lucide 아이콘의 실재를 확인할 수단이
//    없고(0.4x에서 AlertTriangle→TriangleAlert 개명 선례), 없는 아이콘은 undefined 렌더로 죽는다.
const ExpandIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
  </svg>
);

export default function InvestmentNotesPanel({
  variant = 'popup',
  // popup 전용 — 목록/메모장 표시 여부. page에서는 항상 열려 있다.
  open = true,
  // 같은 open 상태에서 '다시 열기'를 요청할 때 증가시킨다(초기 화면을 다시 정한다).
  openSeq = 0,
  // 열자마자 이 메모의 메모장을 띄운다(투자 기록 스트립의 '메모 바로 열기').
  initialNoteId = null,
  notes = [],
  onUpdate = null,
  onClose = null,
  // 별도 브라우저 창으로 열기 — **true를 반환해야** 인앱 화면을 닫는다(팝업 차단 시 통째로 잃지 않게).
  onExpand = null,
  expandOpen = false,
  readOnly = false,
}) {
  const isPage = variant === 'page';
  // null = 목록 화면 / { id, date, val } = 메모장 화면 (상호 배타의 단일 판정 지점)
  const [edit, setEdit] = useState(null);
  const [listPos, setListPos] = useState({ x: 0, y: 0 });
  const [editPos, setEditPos] = useState({ x: 0, y: 0 });
  const listDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const editDrag = useRef({ active: false, offsetX: 0, offsetY: 0 });
  // 초기 화면 결정 effect가 최신 목록을 읽되 deps에는 넣지 않는다(열 때 1회만 판정).
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // 메모장은 세로가 길어(rows 30) 중앙에서 열면 아래가 화면 밖으로 잘린다 → 상단 근처에서 시작.
  const editStartPos = () => ({
    x: Math.max(8, (window.innerWidth || 1200) / 2 - 192),
    y: Math.max(8, Math.round((window.innerHeight || 800) * 0.05)),
  });

  useEffect(() => {
    if (isPage) return;
    if (!open) { setEdit(null); return; }
    setListPos({
      x: Math.max(8, (window.innerWidth || 1200) / 2 - 192),
      y: Math.max(8, (window.innerHeight || 800) / 2 - 240),
    });
    const n = initialNoteId ? (notesRef.current || []).find(x => x && x.id === initialNoteId) : null;
    if (n) {
      setEditPos(editStartPos());
      setEdit({ id: n.id, date: n.date, val: n.content ?? '' });
    } else {
      setEdit(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openSeq, isPage]);

  const makeDragStart = (dragRef, pos, setPos) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { active: true, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y };
    const onMove = (ev) => {
      if (!dragRef.current.active) return;
      setPos({ x: ev.clientX - dragRef.current.offsetX, y: ev.clientY - dragRef.current.offsetY });
    };
    const onUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const canWrite = !!onUpdate && !readOnly;

  const startEdit = (note) => {
    if (!isPage) setEditPos(editStartPos());
    setEdit({ id: note.id, date: note.date, val: note.content ?? '' });
  };

  const addNote = () => {
    if (!canWrite) return;
    // ⚠️ toISOString()은 UTC라 한국 00:00~09:00에 쓴 기록이 '어제' 날짜로 찍힌다. 투자기록은
    // 메모 달력 칸(dayKey, KST 로컬 조립)에 매칭되므로 반드시 KST로 맞춰야 하루가 어긋나지 않는다.
    const newNote = { id: generateId(), date: getTodayKST(), content: '' };
    onUpdate([newNote, ...(notes || [])]);
    startEdit(newNote);
  };

  const saveEdit = () => {
    if (!edit) return;
    if (canWrite) {
      // ⚠️ 못 찾으면 **새로 넣는다**(map만 쓰면 조용히 사라진다) — 별도 창에서는 '+'가 만든 새 메모가
      //    앱 탭 왕복 전이라 notes에 아직 없을 수 있고, 그 상태로 map을 돌리면 작성한 본문이 통째로
      //    버려진다(화면에는 저장된 것처럼 보인다).
      const list = notes || [];
      const found = list.some(n => n && n.id === edit.id);
      onUpdate(found
        ? list.map(n => (n && n.id === edit.id ? { ...n, date: edit.date, content: edit.val } : n))
        : [{ id: edit.id, date: edit.date, content: edit.val }, ...list]);
    }
    setEdit(null);   // 저장하면 목록으로 복귀 (상호 배타)
  };

  const deleteNote = (id) => {
    if (!canWrite) return;
    onUpdate((notes || []).filter(n => n.id !== id));
  };

  const handleExpand = () => {
    if (!onExpand) return;
    // ⚠️ 클릭 제스처 안에서 **동기**로 창을 열어야 팝업 차단을 피한다(App의 window.open).
    const opened = onExpand();
    if (opened !== true) return;   // 차단·미확인 → 인앱 화면을 그대로 둔다(계산기 ⧉와 같은 규약)
    // ⚠️ 작성 중이던 초안을 먼저 커밋한다 — 안 하면 새 창으로 넘어가지 않고 그대로 사라진다.
    if (edit) saveEdit();
    onClose?.();
  };

  if (!isPage && !open) return null;

  const sorted = sortNotesDesc(notes);

  const expandBtn = onExpand ? (
    <button
      type="button"
      onClick={handleExpand}
      className={`transition-colors ${expandOpen ? 'text-sky-300' : 'text-gray-500 hover:text-sky-300'}`}
      title={expandOpen ? '열려 있는 투자 기록 창으로 이동' : '별도 브라우저 창으로 열기'}
    >
      <ExpandIcon size={15} />
    </button>
  ) : null;

  // ── 메모장 화면 ──────────────────────────────────────────────────────────
  if (edit) {
    const pad = (
      <>
        <div
          className={`bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between select-none ${isPage ? '' : 'cursor-move'}`}
          onMouseDown={isPage ? undefined : makeDragStart(editDrag, editPos, setEditPos)}
        >
          <div className="flex items-center gap-3">
            <button onClick={() => setEdit(null)} className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all" title="목록으로 돌아가기 (Esc)"><X size={10} className="text-white" /></button>
            {canWrite && (
              <button onClick={saveEdit} className="w-[18px] h-[18px] rounded-full bg-purple-600 hover:bg-purple-400 flex items-center justify-center transition-all" title="저장 후 목록으로 (Ctrl+Enter)"><Check size={10} className="text-white" /></button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="bg-transparent border-0 outline-none text-[15px] text-gray-500 font-mono cursor-pointer"
              value={edit.date}
              readOnly={!canWrite}
              onChange={e => setEdit(prev => ({ ...prev, date: e.target.value }))}
            />
            <span className="text-[17px] font-bold tracking-[0.25em] bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-400 bg-clip-text text-transparent select-none">MEMO</span>
          </div>
          <div className="flex items-center gap-2 w-10 justify-end">{expandBtn}</div>
        </div>
        <textarea
          className={`w-full text-gray-200 text-[18px] font-bold outline-none resize-none caret-sky-400 placeholder-gray-700 ${isPage ? 'flex-1 min-h-0' : ''}`}
          style={{
            ...RULED('8px'),
            backgroundImage: 'repeating-linear-gradient(transparent 0px, transparent 35px, rgba(99,130,255,0.3) 35px, rgba(99,130,255,0.3) 36px)',
            paddingLeft: '10px',
            paddingRight: '10px',
            paddingTop: '8px',
            paddingBottom: '8px',
            // 세로 2배(rows 30)라도 패드 전체가 화면을 넘지 않도록 상한 — 초과분은 내부 스크롤
            ...(isPage ? {} : { maxHeight: 'calc(100vh - 160px)' }),
          }}
          rows={isPage ? undefined : 30}
          autoFocus
          readOnly={!canWrite}
          placeholder={canWrite ? '메모를 입력하세요...' : '읽기 전용입니다.'}
          value={edit.val}
          onChange={e => setEdit(prev => ({ ...prev, val: e.target.value }))}
          onKeyDown={e => {
            if (e.key === 'Escape') setEdit(null);
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveEdit();
          }}
        />
      </>
    );
    return isPage
      ? <div className="flex flex-col overflow-hidden shadow-2xl" style={{ height: 'calc(100vh - 130px)', minHeight: 320 }}>{pad}</div>
      : <div className="fixed w-[576px] shadow-2xl overflow-hidden" style={{ left: editPos.x, top: editPos.y, zIndex: 1010 }}>{pad}</div>;
  }

  // ── 목록 화면 ────────────────────────────────────────────────────────────
  const list = (
    <>
      <div
        className={`bg-black border-b border-gray-900 px-3 py-2 flex items-center justify-between select-none ${isPage ? '' : 'cursor-move'}`}
        onMouseDown={isPage ? undefined : makeDragStart(listDrag, listPos, setListPos)}
      >
        <div className="flex items-center gap-2 w-16">
          {!isPage && (
            <button onClick={() => onClose?.()} className="w-[18px] h-[18px] rounded-full bg-pink-600 hover:bg-pink-400 flex items-center justify-center transition-all" title="닫기"><X size={10} className="text-white" /></button>
          )}
        </div>
        <span className="text-[17px] font-bold tracking-[0.18em] bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-400 bg-clip-text text-transparent select-none">투자 기록</span>
        <div className="flex items-center gap-2 w-16 justify-end">
          {expandBtn}
          {canWrite && (
            <button onClick={addNote} className="text-gray-500 hover:text-emerald-400 transition-colors" title="새 메모 추가"><Plus size={19} /></button>
          )}
        </div>
      </div>
      <div className={isPage ? 'overflow-y-auto flex-1 min-h-0' : 'overflow-y-auto max-h-[60vh]'} style={RULED('0')}>
        {sorted.length === 0 && (
          <div className="px-4 py-5 text-gray-600 text-[17px] text-center select-none">
            아직 기록이 없습니다.<br />
            <span className="text-gray-700">{canWrite ? '오른쪽 상단 + 버튼으로 추가하세요.' : '읽기 전용입니다.'}</span>
          </div>
        )}
        {sorted.map(note => (
          <div
            key={note.id}
            className="flex items-center gap-2 px-3 border-b border-gray-900/60 hover:bg-white/5 transition-colors group"
            style={{ minHeight: '36px' }}
          >
            <span className="shrink-0 text-[15px] font-mono text-sky-500 w-[76px]">{formatNoteDate(note.date)}</span>
            <span className="flex-1 text-[17px] text-gray-300 truncate overflow-hidden whitespace-nowrap">{note.content || <span className="text-gray-700 italic">내용 없음</span>}</span>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(note)} className="text-gray-500 hover:text-blue-400 transition-colors" title="전체 보기/편집"><Maximize2 size={15} /></button>
              {canWrite && (
                <button onClick={() => deleteNote(note.id)} className="text-gray-500 hover:text-red-400 transition-colors" title="삭제"><Trash2 size={15} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  return isPage
    ? <div className="flex flex-col overflow-hidden shadow-2xl" style={{ height: 'calc(100vh - 130px)', minHeight: 320 }}>{list}</div>
    : <div className="fixed w-[576px] shadow-2xl overflow-hidden" style={{ left: listPos.x, top: listPos.y, zIndex: 1000 }}>{list}</div>;
}
