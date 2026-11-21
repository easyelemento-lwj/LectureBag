import { useState } from 'react';
import { X, SlidersHorizontal, Info, Download, Trash2, RotateCw } from 'lucide-react';
import type { MediaFile } from '../types';
import { downloadFiles } from '../utils/downloadFiles';

export function ExplorerPhotoPreview({ file, onClose, onDelete }: {
  key?: string; file: MediaFile; onClose: () => void; onDelete: () => Promise<boolean>;
}) {
  const [panel, setPanel] = useState<'adjust' | 'info' | null>(null);
  const [brightness, setBrightness] = useState(100), [contrast, setContrast] = useState(100);
  const [rotation, setRotation] = useState(0), [dimensions, setDimensions] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const button = 'w-14 h-14 shrink-0 rounded-full border-2 ring-2 ring-neutral-200/60 shadow-md flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40';
  return <section role="dialog" aria-modal="true" aria-label="사진 보기" className="absolute inset-0 z-[70] bg-black text-white flex flex-col overflow-hidden">
    <header className="shrink-0 flex items-center justify-between gap-3 px-6 pb-3" style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' }}>
      <h2 className="text-xs font-bold truncate">{file.name}</h2>
      <button aria-label="사진 닫기" onClick={onClose} className="w-10 h-10 shrink-0 rounded-full bg-neutral-800 flex items-center justify-center"><X className="w-5 h-5" /></button>
    </header>
    <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-4">
      {file.dataUrl ? <img src={file.dataUrl} alt={file.name} onLoad={e => setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
        className="max-w-full max-h-full object-contain rounded-2xl" style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)`, transform: `rotate(${rotation}deg) scale(${rotation % 180 ? 0.65 : 1})` }} />
        : <p className="text-sm">사진을 준비 중입니다. 동기화 후 다시 열어주세요.</p>}
    </div>
    <div className="shrink-0 px-4 max-h-[45%] overflow-y-auto">
      {panel === 'adjust' && <div className="max-w-md mx-auto rounded-2xl bg-neutral-900 p-4 space-y-3 text-xs">
        <div className="flex justify-between"><strong>사진 조절</strong><button onClick={() => { setBrightness(100); setContrast(100); setRotation(0); }}>초기화</button></div>
        <p className="text-neutral-400">보기 화면에만 적용됩니다. 다운로드는 원본으로 저장합니다.</p>
        <label className="flex items-center gap-3">밝기 <input aria-label="사진 밝기" className="min-w-0 flex-1" type="range" min="50" max="150" value={brightness} onChange={e => setBrightness(Number(e.target.value))} />{brightness}%</label>
        <label className="flex items-center gap-3">대비 <input aria-label="사진 대비" className="min-w-0 flex-1" type="range" min="50" max="150" value={contrast} onChange={e => setContrast(Number(e.target.value))} />{contrast}%</label>
        <button onClick={() => setRotation(value => (value + 90) % 360)} className="flex items-center gap-2"><RotateCw className="w-4 h-4" />회전 {rotation}°</button>
      </div>}
      {panel === 'info' && <div className="max-w-md mx-auto rounded-2xl bg-neutral-900 p-4 space-y-2 text-xs break-words">
        <h3 className="font-bold">사진 정보</h3><p>파일명: {file.name}</p>
        <p>촬영 일시: {new Date(file.timestamp).toLocaleString('ko-KR')}</p>
        {file.fileSize && <p>파일 크기: {file.fileSize}</p>}{dimensions && <p>해상도: {dimensions}</p>}
      </div>}
      {notice && <p role="status" className="max-w-md mx-auto py-2 text-xs">{notice}</p>}
    </div>
    <footer className="shrink-0 px-4 pt-3" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}>
      <div role="toolbar" aria-label="사진 도구" className="bg-white/95 border border-neutral-200/90 shadow-2xl rounded-full h-[84px] px-5 flex items-center justify-between gap-2 max-w-[360px] md:max-w-[440px] mx-auto w-full">
        <button aria-label="사진 조절" aria-expanded={panel === 'adjust'} onClick={() => setPanel(panel === 'adjust' ? null : 'adjust')} className={`${button} ${panel === 'adjust' ? 'bg-black text-white border-black' : 'bg-neutral-100 border-neutral-200 text-[#333333]'}`}><SlidersHorizontal className="w-6 h-6" /></button>
        <button aria-label="사진 정보" aria-expanded={panel === 'info'} onClick={() => setPanel(panel === 'info' ? null : 'info')} className={`${button} ${panel === 'info' ? 'bg-black text-white border-black' : 'bg-neutral-100 border-neutral-200 text-[#333333]'}`}><Info className="w-6 h-6" /></button>
        <button aria-label="사진 다운로드" disabled={busy || !file.dataUrl} onClick={() => { setBusy(true); void downloadFiles([file]).then(setNotice).catch(e => setNotice(e.message)).finally(() => setBusy(false)); }} className={`${button} bg-neutral-100 border-neutral-200 text-[#333333]`}><Download className="w-6 h-6" /></button>
        <button aria-label="사진 휴지통으로 이동" disabled={busy} onClick={() => { setBusy(true); void onDelete().then(done => { if (done) onClose(); else setNotice('사진을 휴지통으로 옮기지 못했습니다. 다시 시도해 주세요.'); }).catch(() => setNotice('삭제 상태를 확인하지 못했습니다. 다시 시도해 주세요.')).finally(() => setBusy(false)); }} className={`${button} bg-red-50 border-red-200/80 text-red-600`}><Trash2 className="w-6 h-6" /></button>
      </div>
    </footer>
  </section>;
}
