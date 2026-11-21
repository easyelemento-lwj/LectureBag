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
  const snapshot = await photoRecoverySnapshot(uid);
  const sources = [...snapshot.photos, ...snapshot.recordings];
  const deleted = new Set(snapshot.trash.map(t => t.file.id));
  const known = new Set([...sources.filter(f => f.dataUrl), ...snapshot.trash.map(t => t.file)].map(f => f.id));
  for (const source of [...photos, ...recordings]) {
    if (!stillOwner()) return;
    if (source.uid !== uid || !source.uri) throw new Error('기기 원본 계정이 일치하지 않습니다.');
    const photo = 'width' in source;
    if (!deleted.has(source.id) && sources.some(f => f.id === source.id && !f.dataUrl)) {
      throw new Error('저장된 원본이 확인되지 않아 네이티브 원본을 유지합니다.');
    }
    if (!known.has(source.id)) {
      const original = await io.read(source.uri);
      const blob = new Blob([original], { type: photo ? 'image/jpeg' : 'audio/mp4' });
      if (!blob.size) throw new Error('기기 원본이 비어 있습니다. 원본을 유지합니다.');
      const dataUrl = await io.dataUrl(blob);
      if (!stillOwner()) return;
      const when = new Date(source.startedAt);
      if (photo) {
        const item: CapturedPhoto = { id: source.id, dataUrl, timestamp: when, mode: 'PPT/판서',
          width: source.width, height: source.height, folderName: formatFileName(when) };
        await saveCapturedPhoto(uid, item, source.intent);
      } else {
        const integrity = compareRecordingDuration(source.elapsedMs, source.mediaDurationMs, source.warning);
        const seconds = Math.floor((source.mediaDurationMs ?? source.elapsedMs) / 1000);
        const item: RecordedAudio = { id: source.id, dataUrl, timestamp: when.toISOString(), name: `${formatFileName(when)}.m4a`,
          durationMs: source.elapsedMs, integrity, size: `${(blob.size / 1024 / 1024).toFixed(1)} MB`,
          duration: `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` };
        await saveRecordedAudio(uid, item, integrity.status === 'duration_checked' && blob.size <= MAX_AUDIO_BYTES && source.context ? {
          fileId: source.id, name: item.name, capturedAt: source.startedAt,
          connectionId: source.context.connectionId, folderPath: source.context.folderPath,
        } : undefined);
      }
      known.add(source.id);
    }
    // An acknowledged source is either committed, in trash, or already purged;
    // never recreate a user-deleted item from a leftover native journal.
    if (!stillOwner()) return;
    await io.acknowledge({ uid, id: source.id, kind: photo ? 'photo' : 'recording' }).catch(() => {});
  }
  if (!stillOwner()) return;
  return {
    photos: await get<CapturedPhoto[]>(`lecture_snap_photos_${uid}`) ?? [],
    recordings: await get<RecordedAudio[]>(`lecture_snap_recordings_${uid}`) ?? [],
  };
}
