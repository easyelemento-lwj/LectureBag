import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Folder, Image as ImageIcon, ArrowLeft, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../utils/firebase';
import { useDriveSync } from '../context/DriveSyncContext';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import { CloudBrowser, driveReadError } from '../services/drive/cloudBrowser';
import { MediaResolver, supportedMedia } from '../services/drive/mediaResolver';
import type { DriveFolder } from '../services/drive/driveClient';
import type { CloudMediaRecord, DriveConnection } from '../services/drive/types';
import { DriveConnectionPanel } from './DriveConnectionPanel';
import { VerifiedAudioPlayer } from './VerifiedAudioPlayer';
import { PcLibraryPanel } from './PcLibraryPanel';
import { usePcLibrary } from '../context/PcLibraryContext';

const button = 'rounded-xl bg-neutral-100 px-3 py-2 text-sm font-medium hover:bg-neutral-200 disabled:opacity-40';

export function DriveExplorer({ onLocal, onClose, onAppCenter }: { onLocal?: () => void; onClose?: () => void; onAppCenter?: () => void }) {
  const { user } = useAuth();
  const sync = useDriveSync();
  // Remount immediately when sign-out or a same/cross-tab connection change is observed.
  return user ? <DriveExplorerSession key={`${user.uid}:${sync.connection?.connectionId}:${sync.connection?.revision}`}
    user={user} onLocal={onLocal} onClose={onClose} onAppCenter={onAppCenter} /> : null;
}

function DriveExplorerSession({ user, onLocal, onClose, onAppCenter }: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>; onLocal?: () => void; onClose?: () => void; onAppCenter?: () => void; key?: string;
}) {
  const catalog = useMemo(() => new CloudCatalog(user, () => auth.currentUser?.uid), [user]);
  const [connection, setConnection] = useState<DriveConnection>();
  const [error, setError] = useState('');
  const [manage, setManage] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pc = usePcLibrary();
  const [remoteView, setRemoteView] = useState(false);
  const showRemote = !pc.library || remoteView || manage;
  useEffect(() => {
    if (!showRemote) return;
    const controller = new AbortController();
    setConnection(undefined); setError('');
    void catalog.status(controller.signal).then(value => {
      if (!controller.signal.aborted) setConnection(value);
    }).catch(error => { if (!controller.signal.aborted) setError(driveReadError(error)); });
    return () => controller.abort();
  }, [catalog, attempt, showRemote]);
  return <section aria-label="Google Drive 탐색기" className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[#F7F7F8] text-neutral-900">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-5 pb-3" style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' }}>
      {onLocal ? <nav aria-label="자료 저장 위치" className="flex gap-2">
        <button type="button" onClick={onLocal} className={button}>이 기기</button>
        <span aria-current="page" className="flex items-center gap-2 rounded-xl bg-neutral-900 px-3 py-2 text-sm font-bold text-white"><Cloud size={18} />Google Drive</span>
      </nav> : <h1 className="text-lg font-bold">내 자료</h1>}
      <div className="flex gap-2">
        {onAppCenter && <button type="button" title="앱 센터" data-tour="apps" className={button} onClick={onAppCenter}>앱 센터</button>}
        <button type="button" className={button} onClick={() => setManage(value => !value)}>{manage ? '자료 목록으로' : 'Drive 연결 관리'}</button>
        {onClose && <button type="button" aria-label="탐색기 닫기" className={button} onClick={onClose}><X size={18} /></button>}
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {!manage && <PcLibraryPanel />}
      {pc.library && !manage && <button type="button" className={`${button} mb-4`} onClick={() => setRemoteView(value => !value)}>{remoteView ? 'PC 보관 목록만 보기' : 'Drive 원격 목록 보기'}</button>}
      {showRemote && (manage ? <DriveConnectionPanel /> : error ? <div role="alert" className="space-y-3"><p>{error}</p>
        <button type="button" className={button} onClick={() => setAttempt(n => n + 1)}>연결 다시 확인</button></div>
        : !connection ? <p role="status">Drive 연결 확인 중…</p>
        : !connection.connected || !connection.connectionId ? <div className="space-y-3"><p>Google Drive를 연결하면 다른 기기에서 업로드한 사진을 볼 수 있습니다.</p>
          <button type="button" className={button} onClick={() => setManage(true)}>Google Drive 연결</button></div>
        : <ConnectedExplorer key={`${connection.connectionId}:${connection.revision}`} catalog={catalog}
          uid={user.uid} connection={connection} />)}
    </div>
  </section>;
}

interface FolderPage {
  folder?: DriveFolder;
  folders: DriveFolder[];
  files: CloudMediaRecord[];
  folderCursor?: string;
  fileCursor?: string;
}

function ConnectedExplorer({ catalog, uid, connection }: {
  catalog: CloudCatalog; uid: string; connection: DriveConnection; key?: string;
}) {
  const identity = useMemo(() => ({ ownerUid: uid, connectionId: connection.connectionId! }), [uid, connection.connectionId]);
  const browser = useMemo(() => new CloudBrowser(catalog, identity), [catalog, identity]);
  const resolver = useMemo(() => new MediaResolver(catalog, identity), [catalog, identity]);
  const [path, setPath] = useState<DriveFolder[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<FolderPage>({ folders: [], files: [] });
  const [busy, setBusy] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ url: string; name: string; note: string; kind: string }>();
  const active = useRef<AbortController>();
  const openingRequest = useRef<AbortController>();
  const previewUrl = useRef<string>();
  const folder = path.at(-1);
  const closePreview = () => {
    openingRequest.current?.abort(); openingRequest.current = undefined;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = undefined; setPreview(undefined); setOpening(false);
  };
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
    setBusy(true); setError(''); setPage({ folders: [], files: [] }); closePreview();
    void (async () => {
      const current = folder || await browser.root(signal);
      if (!current) return;
      const [folders, files] = await Promise.all([browser.folders(current.id, undefined, signal), browser.files(current, undefined, signal)]);
      signal.throwIfAborted();
      setPage({ folder: current, folders: folders.folders, files: files.files,
        folderCursor: folders.nextPageToken, fileCursor: files.nextCursor || undefined });
    })().catch(error => { if (!controller.signal.aborted) setError(driveReadError(error)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); openingRequest.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = undefined; };
  }, [browser, folder, attempt]);

  async function more(kind: 'folders' | 'files') {
    if (busy || !page.folder || !active.current) return;
    const controller = active.current;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
    setBusy(true); setError('');
    try {
      if (kind === 'folders') {
        const next = await browser.folders(page.folder.id, page.folderCursor, signal);
        signal.throwIfAborted();
        if (next.nextPageToken && next.nextPageToken === page.folderCursor) throw new Error('Repeated cursor');
        setPage(prev => ({ ...prev, folders: [...new Map([...prev.folders, ...next.folders].map(f => [f.id, f])).values()], folderCursor: next.nextPageToken }));
      } else {
        const next = await browser.files(page.folder, page.fileCursor, signal);
        signal.throwIfAborted();
        if (next.nextCursor && next.nextCursor === page.fileCursor) throw new Error('Repeated cursor');
        setPage(prev => ({ ...prev, files: [...new Map([...prev.files, ...next.files].map(f => [f.id, f])).values()], fileCursor: next.nextCursor || undefined }));
      }
    } catch (error) { if (!controller.signal.aborted) setError(driveReadError(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function open(file: CloudMediaRecord) {
    closePreview();
    const controller = new AbortController(); openingRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, active.current!.signal, AbortSignal.timeout(file.kind === 'audio' ? 300_000 : 60_000)]);
    setOpening(true); setError('');
    try {
      const result = await resolver.media(file, signal);
      signal.throwIfAborted();
      const url = URL.createObjectURL(result.blob); previewUrl.current = url;
      const note = result.source === 'local' ? '검증된 기기 원본 사용 · 원본 재다운로드 없음'
        : result.source === 'cache' ? '검증된 캐시 사용 · 원본 재다운로드 없음'
        : result.cacheSaved ? 'Drive 원본 다운로드·검증 완료 · 기기에 캐시됨'
        : 'Drive 원본 다운로드·검증 완료 · 캐시 저장 불가, 이번 열람만 제공';
      setPreview({ url, name: file.name, note, kind: file.kind });
    } catch (error) { if (!controller.signal.aborted && !active.current?.signal.aborted) setError(driveReadError(error)); }
    finally { if (!controller.signal.aborted) setOpening(false); }
  }
  const navigate = (next: DriveFolder[]) => {
    active.current?.abort(); closePreview(); setPage({ folders: [], files: [] }); setPath(next); setAttempt(n => n + 1);
  };
  return <div className="mx-auto max-w-5xl space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-bold">Google Drive 자료</h2><p className="break-all text-xs text-neutral-500">{connection.email}</p></div>
      <button type="button" className={`${button} flex items-center gap-2`} onClick={() => { active.current?.abort(); closePreview(); setAttempt(n => n + 1); }}>
        <RefreshCw size={16} />Drive 목록 새로고침</button>
    </div>
    <p className="text-xs leading-relaxed text-neutral-500">같은 LectureBag 계정에서 업로드 완료한 자료입니다. 폴더와 파일은 각각 50개씩 조회하며 원본은 열 때만 가져옵니다. 녹음은 최대 100MB의 전체 원본을 다운로드·검증한 뒤 재생합니다(부분 스트리밍 아님). Drive 삭제·이름 변경은 아직 제공하지 않습니다.</p>
    <nav aria-label="Drive 폴더 경로" className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm">
      {path.length > 0 && <button type="button" className={button} aria-label="Drive 상위 폴더" onClick={() => navigate(path.slice(0, -1))}><ArrowLeft size={16} /></button>}
      <button type="button" className="font-bold underline" onClick={() => navigate([])}>LectureBag</button>
      {path.map((item, index) => <span key={item.id} className="flex items-center gap-2"><span>/</span>
        <button type="button" className="break-all underline" onClick={() => navigate(path.slice(0, index + 1))}>{item.name}</button></span>)}
    </nav>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {busy && <p role="status" className="text-sm">Drive 목록 불러오는 중…</p>}
    {!busy && !error && !page.folders.length && !page.files.length && !page.folderCursor && !page.fileCursor &&
      <p className="rounded-xl bg-white p-5 text-sm">{page.folder ? '이 폴더에 등록된 자료가 없습니다.' : '등록된 LectureBag 폴더가 없습니다. 휴대폰에서 사진 업로드를 완료한 뒤 새로고침해 주세요.'}</p>}
    <ul aria-label="Drive 폴더 목록" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {page.folders.map(item => <li key={item.id}><button type="button" disabled={busy} onClick={() => navigate([...path, item])}
        className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 text-left hover:bg-neutral-50 disabled:opacity-40">
        <Folder className="shrink-0 text-amber-500" /><span className="break-all text-sm font-bold">{item.name}</span></button></li>)}
    </ul>
    {page.folderCursor && <button type="button" className={button} disabled={busy} onClick={() => void more('folders')}>폴더 더 보기</button>}
    <ul aria-label="Drive 파일 목록" className="space-y-2">
      {page.files.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3"><ImageIcon className="shrink-0 text-neutral-400" />
          <div className="min-w-0"><p className="break-all text-sm font-semibold">{file.name}</p>
            <p className="text-xs text-neutral-500">{new Date(file.capturedAt).toLocaleString('ko-KR')} · {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB · Drive에 저장 완료</p></div></div>
        <button type="button" className={button} disabled={busy || opening || !supportedMedia(file)} onClick={() => void open(file)}
          aria-label={`${file.name} 원본 열기`}>{supportedMedia(file) ? '원본 열기' : '아직 지원하지 않는 형식'}</button>
      </li>)}
    </ul>
    {page.fileCursor && <button type="button" className={button} disabled={busy} onClick={() => void more('files')}>파일 더 보기</button>}
    {opening && <p role="status">원본 확인·다운로드 중… <button className={button} onClick={closePreview}>열기 취소</button></p>}
    {preview && <section aria-label={preview.kind === 'audio' ? 'Drive 녹음 재생' : 'Drive 사진 미리보기'} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2"><h3 className="break-all text-sm font-bold">{preview.name}</h3>
        <button type="button" className={button} onClick={closePreview}>{preview.kind === 'audio' ? '녹음 닫기' : '사진 닫기'}</button></div>
      <p role="status" className="text-xs text-neutral-500">{preview.note}</p>
      {preview.kind === 'audio' ? <VerifiedAudioPlayer key={preview.url} url={preview.url}
        onError={() => setError('이 브라우저에서 녹음을 재생하지 못했습니다. 지원 코덱을 확인하거나 다른 브라우저에서 열어 주세요. 원본은 유지됩니다.')} />
        : <img src={preview.url} alt={preview.name} className="mx-auto max-h-[65vh] max-w-full rounded-xl object-contain" />}
    </section>}
    <p className="text-xs text-neutral-500">캐시는 원본과 별도로 최대 128MB 보관합니다. 권한과 원본 버전을 확인하므로 캐시를 열 때도 인터넷 연결이 필요합니다. 이 시험 목록은 새로고침으로 갱신합니다. 앱에 등록된 파일의 Drive 휴지통 이동·복원은 공통 탐색기에 반영되며, 이름·내용 변경이나 임의로 추가한 파일의 동기화는 아직 지원하지 않습니다.</p>
  </div>;
}
