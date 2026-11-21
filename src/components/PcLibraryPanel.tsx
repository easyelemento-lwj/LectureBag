import { useEffect, useMemo, useRef, useState } from 'react';
import { usePcLibrary } from '../context/PcLibraryContext';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../utils/firebase';
import { PcLibraryStore } from '../services/drive/pcLibrary';
import { downloadKey } from '../services/drive/downloadCache';
import { supportedMedia } from '../services/drive/mediaResolver';
import type { CloudMediaRecord } from '../services/drive/types';
import { VerifiedAudioPlayer } from './VerifiedAudioPlayer';
import { DesktopControls } from './DesktopControls';

const button = 'rounded-xl bg-neutral-100 px-3 py-2 text-sm font-medium disabled:opacity-40';
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function PcLibraryPanel() {
  const sync = usePcLibrary(); const { user } = useAuth(); const lib = sync.library;
  const store = useMemo(() => new PcLibraryStore(), []);
  const [query, setQuery] = useState(''), [folder, setFolder] = useState(''), [limit, setLimit] = useState(50);
  const [error, setError] = useState(''), [opening, setOpening] = useState(false);
  const [preview, setPreview] = useState<{ file: CloudMediaRecord; url: string }>();
  const [storage, setStorage] = useState<StorageEstimate>();
  const url = useRef<string>(), request = useRef<AbortController>();
  const close = () => { request.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); url.current = undefined; setPreview(undefined); setOpening(false); };
  useEffect(() => { close(); return () => { request.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); }; }, [user?.uid, lib?.connection.connectionId, lib?.blocked]);
  useEffect(() => {
    if (preview && (!lib || lib.unavailable.includes(preview.file.id) || !lib.files.some(f => downloadKey(f) === downloadKey(preview.file)))) close();
  }, [lib, preview]);
  useEffect(() => {
    let current = true;
    void navigator.storage?.estimate?.().then(value => { if (current) setStorage(value); }).catch(() => {});
    return () => { current = false; };
  }, [sync.busy, lib?.saved, user?.uid]);
  if (!sync.available || !user) return null;
  const files = lib && !lib.blocked ? lib.files : [];
  const saved = files.filter(f => lib!.saved[f.id] === downloadKey(f) && !lib!.unavailable.includes(f.id));
  const filtered = files.filter(f => (!folder || f.driveParentId === folder) && f.name.toLowerCase().includes(query.toLowerCase()));
  const folderPath = (id: string) => {
    const names: string[] = []; const seen = new Set<string>(); let entry = lib?.folders.find(f => f.id === id);
    while (entry && !seen.has(entry.id)) { seen.add(entry.id); names.unshift(entry.name); entry = lib?.folders.find(f => f.id === entry!.parentId); }
    return names.join(' / ');
  };
  async function open(file: CloudMediaRecord) {
    close(); const controller = new AbortController(); request.current = controller; setOpening(true); setError('');
    try {
      if (auth.currentUser?.uid !== file.ownerUid) throw new Error('로그인 계정이 변경되었습니다.');
      const blob = await store.read(file); controller.signal.throwIfAborted();
      const latest = await store.state(file.ownerUid); controller.signal.throwIfAborted();
      if (auth.currentUser?.uid !== file.ownerUid || latest?.blocked || latest?.connection.connectionId !== file.connectionId ||
        latest?.unavailable.includes(file.id) || !latest?.files.some(f => downloadKey(f) === downloadKey(file))) throw new Error('연결 또는 파일 상태가 변경되었습니다.');
      if (!blob) throw new Error('PC 사본이 없거나 저장소에서 제거됐습니다. 인터넷 연결 후 다시 동기화해 주세요.');
      url.current = URL.createObjectURL(blob); setPreview({ file, url: url.current });
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (!controller.signal.aborted) setOpening(false); }
  }
  return <section aria-label="PC 원본 동기화" className="mx-auto mb-5 max-w-5xl space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
    <h2 className="font-bold">이 PC에 자동 보관</h2>
    <DesktopControls />
    <p className="text-sm">한 번 켜두면 앱이 열려 있는 동안 새 자료를 자동으로 내려받습니다. 인터넷이 다시 연결되면 놓친 자료도 확인합니다.</p>
    <p className="text-xs leading-relaxed text-neutral-500">앱에 등록된 사진(20MB 이하)·녹음(100MB 이하)을 이 PC에 미리 보관합니다. 최초 다운로드에는 시간과 디스크 공간이 필요합니다. 이후 기기 사본은 원격 다운로드 없이 바로 열립니다.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={sync.busy} onClick={() => {
        if (!lib && !window.confirm('이 PC에 지원하는 모든 사진·녹음 원본을 다운로드합니다. 같은 계정으로 로그인한 상태에서는 오프라인에도 열 수 있습니다. 공용 PC에서는 사용하지 마세요. 계속할까요?')) return;
        setError(''); sync.start();
      }}>{lib ? '지금 동기화 / 다시 시작' : '전체 자료를 이 PC에 보관'}</button>
      {(sync.busy || lib?.enabled) && <button type="button" className={button} onClick={sync.pause}>동기화 일시정지</button>}
      {lib && <button type="button" className={button} disabled={sync.busy} onClick={sync.rescan}>전체 목록 다시 맞추기</button>}
    </div>
    {lib && <p className="text-sm">PC 보관 {saved.length} / {files.length}개 · {size(saved.reduce((n, f) => n + f.sizeBytes, 0))} · {lib.enabled ? '자동 동기화 켜짐' : '동기화 중지'}
      {lib.lastScan && <span className="block text-xs text-neutral-500">마지막 목록 확인: {new Date(lib.lastScan).toLocaleString('ko-KR')}</span>}</p>}
    {sync.watching && <p role="status" className="text-sm text-green-700">자동 동기화 대기 중 · 주기적으로 새 자료를 확인합니다. 바로 필요하면 ‘지금 동기화’를 누르세요.</p>}
    {sync.busy && <p role="status" className="text-sm">{!sync.progress || sync.progress.phase === 'scanning' ? '전체 폴더·목록 확인 중…' : sync.progress.phase === 'checking' ? '새 자료·놓친 변경 확인 중…' : `PC 저장 ${sync.progress.done}/${sync.progress.total}개 · ${size(sync.progress.bytes)} / ${size(sync.progress.totalBytes)} · ${sync.progress.name || ''}`}</p>}
    {sync.progress?.phase === 'complete' && !sync.busy && <p role="status" className="text-sm">확인한 목록의 동기화 완료 · 미지원 {sync.progress.unsupported}개 · 찾을 수 없거나 변경된 파일 {sync.progress.unavailable}개</p>}
    {(sync.error || error) && <p role="alert" className="text-sm text-red-700">{error || sync.error}</p>}
    {lib?.blocked && <p role="alert">연결 변경이 확인되어 사본 접근이 잠겼습니다. Drive 연결을 확인한 뒤 다시 시작하세요. 저장된 파일은 삭제하지 않았습니다.</p>}
    {lib && <p className="text-xs text-neutral-500">{lib.persistent ? '브라우저 영구 저장 요청이 승인되었습니다.' : '브라우저 영구 저장 요청이 승인되지 않았거나 확인되지 않았습니다.'} 앱에서 원본을 자동 정리하지 않지만, 사이트 데이터 삭제·브라우저 정책에 따라 사본이 사라질 수 있습니다. 다른 기기의 권한 철회는 온라인 확인 전에는 알 수 없습니다. 오프라인 사본은 마지막 확인 버전입니다.</p>}
    {storage?.quota !== undefined && <p className="text-xs text-neutral-500">이 사이트의 브라우저 저장소: 약 {size(storage.usage || 0)} 사용 / {size(storage.quota)} 허용 (PC 전체 여유 공간과 다를 수 있음)</p>}
    {!!files.length && <>
      <div className="flex flex-wrap gap-2">
        <input aria-label="PC 보관 자료 검색" className="rounded-lg border p-2 text-sm" placeholder="파일 이름 검색" value={query} onChange={e => { setQuery(e.target.value); setLimit(50); }} />
        <select aria-label="PC 보관 폴더" className="max-w-full rounded-lg border p-2 text-sm" value={folder} onChange={e => { setFolder(e.target.value); setLimit(50); }}>
          <option value="">모든 폴더</option>{lib?.folders.map(f => <option key={f.id} value={f.id}>{folderPath(f.id)}</option>)}
        </select>
      </div>
      <ul aria-label="PC 보관 파일 목록" className="space-y-2">{filtered.slice(0, limit).map(file => {
        const available = lib!.saved[file.id] === downloadKey(file) && !lib!.unavailable.includes(file.id);
        return <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-50 p-3">
          <div className="min-w-0"><p className="break-all text-sm font-semibold">{file.name}</p><p className="text-xs text-neutral-500">{folderPath(file.driveParentId)} · {size(file.sizeBytes)} · {lib!.unavailable.includes(file.id) ? '찾을 수 없거나 원본 변경됨' : !supportedMedia(file) ? '미지원 형식/크기' : available ? '이 PC에 보관됨' : '다운로드 대기'}</p></div>
          <button type="button" className={button} disabled={!available || opening} onClick={() => void open(file)} aria-label={`${file.name} PC 사본 열기`}>PC 사본 열기</button>
        </li>;
      })}</ul>
      {filtered.length > limit && <button type="button" className={button} onClick={() => setLimit(n => n + 50)}>PC 자료 더 보기</button>}
    </>}
    {preview && <section aria-label="PC 사본 미리보기" className="space-y-2 border-t pt-3">
      <div className="flex justify-between gap-2"><h3 className="break-all font-bold">{preview.file.name}</h3><button type="button" className={button} onClick={close}>PC 사본 닫기</button></div>
      <p className="text-xs text-neutral-500">검증 후 보관한 PC 사본 · 원격 확인/다운로드 없음</p>
      {preview.file.kind === 'audio' ? <VerifiedAudioPlayer key={preview.url} url={preview.url} onError={() => setError('PC 녹음을 재생하지 못했습니다. 사본은 유지됩니다.')} />
        : <img src={preview.url} alt={preview.file.name} className="mx-auto max-h-[65vh] max-w-full object-contain" />}
    </section>}
  </section>;
}
