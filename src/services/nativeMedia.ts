import { get } from 'idb-keyval';
import type { CapturedPhoto, RecordedAudio } from '../types';
import { compareRecordingDuration } from '../utils/recordingIntegrity';
import { photoRecoverySnapshot, saveCapturedPhoto, saveRecordedAudio } from '../utils/mediaStorage';
import { formatFileName } from '../utils/dateFolders';
import { MAX_AUDIO_BYTES } from './drive/audioFormat';
import { blobDataUrl, native, nativeBlob, type NativePhoto, type NativeSession } from './native';

/** Stable IDs + source existence make retries safe across Activity/process restarts. */
export async function importNativeMedia(uid: string, photos: NativePhoto[], recordings: NativeSession[], stillOwner: () => boolean,
  io = { read: nativeBlob, acknowledge: (options: { uid: string; id: string; kind: 'photo' | 'recording' }) => native.acknowledge(options), dataUrl: blobDataUrl }) {
  let photoIssues = 0;
  // A native original is removed only after its bytes are independently found
  // in this account's durable photo store, or an explicit purge is recorded.
  // A broken photo must not block the other photos in the same journal.
  for (const source of photos) {
    if (!stillOwner()) return;
    if (source.uid !== uid || !source.uri) throw new Error('기기 원본 계정이 일치하지 않습니다.');
    try {
      let snapshot = await photoRecoverySnapshot(uid);
      const trash = snapshot.trash.find(item => item.file.id === source.id);
      if (trash?.purged) {
        await io.acknowledge({ uid, id: source.id, kind: 'photo' });
        continue;
      }
      // Preserve native originals while the item is in trash, even if the
      // trash row contains metadata only or is waiting for restoration.
      if (trash && !trash.restored) { photoIssues++; continue; }
      const original = await io.read(source.uri);
      const blob = new Blob([original], { type: 'image/jpeg' });
      if (!blob.size) throw new Error('기기 사진 원본이 비어 있습니다.');
      const dataUrl = await io.dataUrl(blob);
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error('사진 원본을 확인하지 못했습니다.');
      if (!stillOwner()) return;
      const existing = snapshot.photos.find(item => item.id === source.id);
      if (existing && existing.dataUrl !== dataUrl) { photoIssues++; continue; }
      if (!existing) {
        if (snapshot.recordings.some(item => item.id === source.id) || trash) { photoIssues++; continue; }
        const when = new Date(source.startedAt);
        if (!Number.isFinite(when.getTime())) throw new Error('사진 촬영 시간을 확인하지 못했습니다.');
        const item: CapturedPhoto = { id: source.id, dataUrl, timestamp: when, mode: 'PPT/판서',
          width: source.width, height: source.height, folderName: formatFileName(when) };
        await saveCapturedPhoto(uid, item, source.intent);
      }
      if (!stillOwner()) return;
      snapshot = await photoRecoverySnapshot(uid);
      const latestTrash = snapshot.trash.find(item => item.file.id === source.id);
      if (latestTrash && !latestTrash.purged && !latestTrash.restored) { photoIssues++; continue; }
      if (!latestTrash?.purged && !snapshot.photos.some(item => item.id === source.id && item.dataUrl === dataUrl)) {
        photoIssues++; continue;
      }
      await io.acknowledge({ uid, id: source.id, kind: 'photo' });
    } catch { if (!stillOwner()) return; photoIssues++; }
  }
  // Existing recordings remain untouched by the photo recovery changes.
  const snapshot = await photoRecoverySnapshot(uid);
  const sources = [...snapshot.photos, ...snapshot.recordings];
  const deleted = new Set(snapshot.trash.map(t => t.file.id));
  const known = new Set([...sources.filter(f => f.dataUrl), ...snapshot.trash.map(t => t.file)].map(f => f.id));
  for (const source of recordings) {
    if (!stillOwner()) return;
    if (source.uid !== uid || !source.uri) throw new Error('기기 원본 계정이 일치하지 않습니다.');
    if (!deleted.has(source.id) && sources.some(f => f.id === source.id && !f.dataUrl)) {
      throw new Error('저장된 원본이 확인되지 않아 네이티브 원본을 유지합니다.');
    }
    if (!known.has(source.id)) {
      const original = await io.read(source.uri);
      const blob = new Blob([original], { type: 'audio/mp4' });
      if (!blob.size) throw new Error('기기 원본이 비어 있습니다. 원본을 유지합니다.');
      const dataUrl = await io.dataUrl(blob);
      if (!stillOwner()) return;
      const when = new Date(source.startedAt);
      const integrity = compareRecordingDuration(source.elapsedMs, source.mediaDurationMs, source.warning);
      const seconds = Math.floor((source.mediaDurationMs ?? source.elapsedMs) / 1000);
      const item: RecordedAudio = { id: source.id, dataUrl, timestamp: when.toISOString(), name: `${formatFileName(when)}.m4a`,
        durationMs: source.elapsedMs, integrity, size: `${(blob.size / 1024 / 1024).toFixed(1)} MB`,
        duration: `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` };
      await saveRecordedAudio(uid, item, integrity.status === 'duration_checked' && blob.size <= MAX_AUDIO_BYTES && source.context ? {
        fileId: source.id, name: item.name, capturedAt: source.startedAt,
        connectionId: source.context.connectionId, folderPath: source.context.folderPath,
      } : undefined);
      known.add(source.id);
    }
    if (!stillOwner()) return;
    await io.acknowledge({ uid, id: source.id, kind: 'recording' }).catch(() => {});
  }
  if (!stillOwner()) return;
  return {
    photoIssues,
    photos: await get<CapturedPhoto[]>(`lecture_snap_photos_${uid}`) ?? [],
    recordings: await get<RecordedAudio[]>(`lecture_snap_recordings_${uid}`) ?? [],
  };
}
