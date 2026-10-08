import { useEffect, useRef, useState } from 'react';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import type { CloudMediaRecord } from '../services/drive/types';
import { DriveTransferError } from '../services/drive/driveClient';
import { openPhoto, pendingPhoto, photoKey, stagePhoto, TRIAL_FOLDER, uploadPhoto } from '../services/drive/photoTrial';

export function DrivePhotoTrial({ catalog, uid, connectionId }: { catalog: CloudCatalog; uid: string; connectionId: string; key?: string }) {
  const active = useRef(new AbortController());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [files, setFiles] = useState<CloudMediaRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState('');
  const key = photoKey(uid, connectionId);
  useEffect(() => { return () => { if (preview) URL.revokeObjectURL(preview); }; }, [preview]);

  async function load(more = false) {
    const page = await catalog.list(TRIAL_FOLDER, more ? cursor || undefined : undefined, active.current.signal);
    setFiles(old => more ? [...old, ...page.files] : page.files); setCursor(page.nextCursor);
  }
  async function action(work: () => Promise<void>) {
    const signal = active.current.signal;
    setBusy(true); setMessage('');
    try { await work(); }
    catch (error) {
      if (!signal.aborted) setMessage(error instanceof DriveTransferError ? {
        needs_auth: 'Drive 권한을 다시 확인해 주세요.', quota_full: 'Google Drive 저장 공간이 부족합니다.',
        retry_wait: '전송이 중단됐습니다. 기기에 보관된 사진으로 다시 시도해 주세요.',
        not_found: 'Drive 파일을 찾을 수 없거나 접근할 수 없습니다.',
        failed: 'Drive 전송을 완료하지 못했습니다. 기기 원본은 보관됩니다.',
        session_expired: '업로드 세션이 만료됐습니다. 다시 시도해 주세요.',
      }[error.code] : error instanceof Error ? error.message : '다시 시도해 주세요.');
    }
    finally { if (!signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    void pendingPhoto(key).then(photo => { if (!controller.signal.aborted) setPending(photo?.name || ''); });
    void action(() => load());
    return () => controller.abort();
  }, []);

  async function locked(work: () => Promise<void>) {
    if (!navigator.locks) throw new Error('최신 Chrome 또는 Safari에서 시험해 주세요.');
    await navigator.locks.request(`drive-photo:${key}`, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('다른 탭에서 이 사진을 처리하고 있습니다.');
      active.current.signal.throwIfAborted(); await work();
    });
  }
  return <div className="border-t pt-4 space-y-3">
    <p className="text-sm font-bold">사진 한 장 업로드 시험</p>
    <p className="text-xs text-neutral-500">JPEG·PNG·WebP, 최대 20MB. Drive의 LectureBag / 사진 업로드 시험 폴더에 저장됩니다.</p>
    <input aria-label="시험 사진 선택" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !!pending}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void action(() => locked(async () => {
        const photo = await stagePhoto(key, file); setPending(photo.name); setMessage('기기에 보관했습니다. 업로드를 눌러 주세요.');
      })); }} />
    {pending && <div><p className="text-sm">대기 사진: {pending}</p><button disabled={busy} className="rounded-xl bg-neutral-900 text-white p-2" onClick={() => void action(() => locked(async () => {
      await uploadPhoto(key, catalog, connectionId, active.current.signal, setMessage);
      setPending(''); setMessage('Drive에 저장 완료'); await load();
    }))}>업로드 / 다시 시도</button></div>}
    <p role="status" className="text-sm">{message}</p>
    <button disabled={busy} className="rounded-xl bg-neutral-100 p-2" onClick={() => void action(() => load())}>저장 목록 새로고침</button>
    <ul>{files.map(file => <li key={file.id} className="py-2"><button disabled={busy} onClick={() => void action(async () => {
      const signal = active.current.signal;
      const blob = await openPhoto(catalog, connectionId, file, signal);
      signal.throwIfAborted(); setPreview(URL.createObjectURL(blob)); setMessage('Drive 원본 다운로드·검증 완료');
    })}>{file.name} · 원본 열기</button></li>)}</ul>
    {cursor && <button disabled={busy} onClick={() => void action(() => load(true))}>더 보기</button>}
    {preview && <div><button onClick={() => setPreview('')}>사진 닫기</button><img src={preview} alt="Drive에서 다시 내려받은 사진" className="max-h-96 max-w-full object-contain" /></div>}
  </div>;
}
