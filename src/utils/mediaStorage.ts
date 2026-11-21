import { createStore, get } from 'idb-keyval';
import type { TrashEntry } from './trash';
import { purgeExpiredTrash } from './trash';
import type { CapturedPhoto, RecordedAudio } from '../types';
import type { RecordingIntegrity } from './recordingIntegrity';

export interface CaptureIntent {
  fileId: string;
  name: string;
  capturedAt: string;
  folderPath: string[];
  connectionId?: string;
}
const capturesKey = (uid: string) => `lecturebag_capture_outbox_${uid}`;

const store = createStore('keyval-store', 'keyval');
export const trashKey = (uid: string) => `lecture_snap_trash_${uid}`;
const sourceKey = (uid: string, kind: 'photos' | 'recordings' | 'imports') => `lecture_snap_${kind}_${uid}`;

// Read and write in a single IndexedDB transaction, shared by every browser tab.
function transaction<T>(keys: string[], change: (values: any[], objectStore: IDBObjectStore) => T): Promise<T> {
  return store('readwrite', objectStore => new Promise<T>((resolve, reject) => {
    let result: T;
    let remaining = keys.length;
    const values: any[] = [];
    const tx = objectStore.transaction;
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('저장에 실패했습니다.'));
    keys.forEach((key, index) => {
      const request = objectStore.get(key);
      request.onsuccess = () => {
        values[index] = request.result;
        if (--remaining === 0) {
          try { result = change(values, objectStore); }
          catch (error) { tx.abort(); reject(error); }
        }
      };
    });
  }));
}

export function updateTrash(uid: string, change: (entries: TrashEntry[]) => TrashEntry[], preserveForDrive = false): Promise<TrashEntry[]> {
  const keys = [trashKey(uid), sourceKey(uid, 'photos'), sourceKey(uid, 'recordings'), sourceKey(uid, 'imports')];
  return transaction(keys, ([saved = [], photos = [], recordings = [], imports = []], objectStore) => {
    const current = preserveForDrive ? saved : purgeExpiredTrash(saved);
    const proposed = change(current);
    const permanent = new Map<string, TrashEntry>(current.filter((entry: TrashEntry) => entry.purged).map((entry: TrashEntry) => [entry.file.id, entry]));
    // A stale client can never remove or replace a committed deletion marker.
    const next = [...proposed.filter(entry => !permanent.has(entry.file.id)), ...permanent.values()];
    const purged = new Set(next.filter(entry => entry.purged).map(entry => entry.file.id));
    objectStore.put(next, keys[0]);
    objectStore.put(photos.filter((file: { id: string }) => !purged.has(file.id)), keys[1]);
    objectStore.put(recordings.filter((file: { id: string }) => !purged.has(file.id)), keys[2]);
    objectStore.put(imports.filter((file: { id: string }) => !purged.has(file.id)), keys[3]);
    return next;
  });
}

export function saveMedia<T extends { id: string }>(uid: string, kind: 'photos' | 'recordings' | 'imports', files: T[]): Promise<void> {
  const keys = [trashKey(uid), sourceKey(uid, kind)];
  return transaction(keys, ([entries = [], saved = []], objectStore) => {
    const purged = new Set(entries.filter((entry: TrashEntry) => entry.purged).map((entry: TrashEntry) => entry.file.id));
    const merged = new Map<string, T>([...saved, ...files].map(file => [file.id, file]));
    // A stale mounted tab must not undo a newly committed recording recheck.
    if (kind === 'recordings') for (const previous of saved as RecordedAudio[]) {
      const incoming = merged.get(previous.id) as (T & RecordedAudio) | undefined;
      if (incoming && incoming.dataUrl === previous.dataUrl &&
        (previous.integrity?.checkedAt || 0) > (incoming.integrity?.checkedAt || 0)) {
        merged.set(previous.id, { ...incoming, integrity: previous.integrity });
      }
    }
    objectStore.put([...merged.values()].filter(file => !purged.has(file.id)), keys[1]);
  });
}

export async function loadImportedMedia<T extends { id: string }>(uid: string): Promise<T[]> {
  const [files = [], entries = []] = await Promise.all([
    get<T[]>(sourceKey(uid, 'imports'), store), get<TrashEntry[]>(trashKey(uid), store),
  ]);
  const purged = new Set(entries.filter(entry => entry.purged).map(entry => entry.file.id));
  return files.filter(file => !purged.has(file.id));
}

/** Camera source and durable upload intent commit together, or neither commits. */
export function saveCapturedPhoto(uid: string, photo: CapturedPhoto, intent?: CaptureIntent): Promise<void> {
  if (!uid || (intent && intent.fileId !== photo.id)) throw new Error('촬영 계정과 파일이 일치하지 않습니다.');
  const keys = [trashKey(uid), sourceKey(uid, 'photos'), capturesKey(uid)];
  return transaction(keys, ([entries = [], photos = [], intents = []], objectStore) => {
    if (entries.some((entry: TrashEntry) => entry.file.id === photo.id) ||
      photos.some((saved: CapturedPhoto) => saved.id === photo.id)) throw new Error('이미 저장되거나 삭제된 사진입니다.');
    objectStore.put([photo, ...photos], keys[1]);
    if (intent) objectStore.put([...intents, intent], keys[2]);
  });
}

export async function captureIntents(uid: string): Promise<CaptureIntent[]> {
  return await get<CaptureIntent[]>(capturesKey(uid), store) ?? [];
}

/** Account-scoped read snapshot; no uploads, trash changes or source deletion. */
export function photoRecoverySnapshot(uid: string): Promise<{ photos: CapturedPhoto[]; recordings: RecordedAudio[]; intents: CaptureIntent[]; trash: TrashEntry[] }> {
  if (!uid) throw new Error('로그인이 필요합니다.');
  return transaction([sourceKey(uid, 'photos'), capturesKey(uid), trashKey(uid), sourceKey(uid, 'recordings')],
    ([photos = [], intents = [], trash = [], recordings = []]) => ({ photos, recordings, intents, trash }));
}

/** Update only check metadata, never source bytes, duration, uploads or trash. */
export function saveRecordingRecheck(uid: string, original: RecordedAudio, integrity: RecordingIntegrity,
  assertScope: () => void): Promise<void> {
  if (!uid) throw new Error('로그인이 필요합니다.');
  return transaction([sourceKey(uid, 'recordings'), trashKey(uid)], ([recordings = [], trash = []], objectStore) => {
    assertScope();
    if (trash.some((entry: TrashEntry) => entry.file.id === original.id && (!entry.restored || entry.purged))) throw new Error('삭제된 녹음은 재검사 결과를 저장하지 않습니다.');
    const current: RecordedAudio | undefined = recordings.find((item: RecordedAudio) => item.id === original.id);
    if (!current || current.dataUrl !== original.dataUrl || current.durationMs !== original.durationMs ||
      JSON.stringify(current.integrity) !== JSON.stringify(original.integrity)) throw new Error('녹음 상태가 변경되었습니다. 다시 점검해 주세요.');
    objectStore.put(recordings.map((item: RecordedAudio) => item.id === original.id ? { ...item, integrity } : item), sourceKey(uid, 'recordings'));
  });
}

/** Only enroll the exact inspected source, atomically checking concurrent capture,
 * trash and another tab's recovery. Existing intents are never changed. */
export function recoverPhotoIntents(uid: string, connectionId: string,
  candidates: Array<{ photo: CapturedPhoto; intent: CaptureIntent }>, assertScope: () => void): Promise<number> {
  return recoverCaptureIntents(uid, connectionId, candidates.map(({ photo, intent }) => ({ source: photo, kind: 'photo', intent })), assertScope);
}

export function recoverCaptureIntents(uid: string, connectionId: string,
  candidates: Array<{ source: CapturedPhoto | RecordedAudio; kind: 'photo' | 'audio'; intent: CaptureIntent }>, assertScope: () => void): Promise<number> {
  if (!uid || !connectionId) throw new Error('현재 계정과 연결을 확인해 주세요.');
  return transaction([sourceKey(uid, 'photos'), capturesKey(uid), trashKey(uid), sourceKey(uid, 'recordings')],
    ([photos = [], intents = [], trash = [], recordings = []], objectStore) => {
      assertScope();
      const next: CaptureIntent[] = [...intents];
      let count = 0;
      for (const { source: photo, kind, intent } of candidates) {
        if (intent.fileId !== photo.id || intent.connectionId !== connectionId) throw new Error('복구 대상이 변경되었습니다.');
        if (next.some(item => item.fileId === photo.id)) continue;
        if (trash.some((entry: TrashEntry) => entry.file.id === photo.id && (!entry.restored || entry.purged || entry.cloud))) continue;
        // A corrupted cross-kind ID is ambiguous, not a new upload candidate.
        if ((kind === 'photo' ? recordings : photos).some((item: { id: string }) => item.id === photo.id)) continue;
        const current: CapturedPhoto | RecordedAudio | undefined = (kind === 'photo' ? photos : recordings).find((item: { id: string }) => item.id === photo.id);
        if (!current || !current.dataUrl || current.dataUrl !== photo.dataUrl ||
          new Date(current.timestamp).getTime() !== new Date(photo.timestamp).getTime()) continue;
        if (kind === 'audio' && (current as RecordedAudio).integrity?.status !== 'duration_checked') continue;
        next.push(intent); count++;
      }
      if (count) objectStore.put(next, capturesKey(uid));
      return count;
    });
}

/** Explicit user cleanup only. Keep source bytes and move old-connection captures
 * to local trash atomically with retiring their upload intents. Never touch Drive,
 * unbound/new captures, another user, or the active connection's files. */
export function archivePreviousDriveCaptures(uid: string, currentConnectionId: string): Promise<number> {
  if (!uid || !currentConnectionId) throw new Error('현재 계정과 Drive 연결을 확인해 주세요.');
  const keys = [trashKey(uid), sourceKey(uid, 'photos'), sourceKey(uid, 'recordings'), capturesKey(uid)];
  return transaction(keys, ([entries = [], photos = [], recordings = [], intents = []], objectStore) => {
    const old: CaptureIntent[] = intents.filter((item: CaptureIntent) => item.connectionId && item.connectionId !== currentConnectionId);
    const ids = new Set(old.map(item => item.fileId));
    const next: TrashEntry[] = [...entries];
    let count = 0;
    for (const intent of old) {
      const existing = next.find(entry => entry.file.id === intent.fileId);
      if (existing && (existing.purged || !existing.restored)) continue;
      const photo: CapturedPhoto | undefined = photos.find((file: CapturedPhoto) => file.id === intent.fileId);
      const recording: RecordedAudio | undefined = recordings.find((file: RecordedAudio) => file.id === intent.fileId);
      const source = photo || recording;
      if (!source) continue;
      const entry: TrashEntry = { file: { id: intent.fileId, type: photo ? 'photo' : 'audio', name: intent.name,
        timestamp: source.timestamp, dataUrl: source.dataUrl,
        ...(photo ? { mode: photo.mode } : { duration: recording?.duration }) }, deletedAt: new Date().toISOString() };
      if (existing) next.splice(next.indexOf(existing), 1, entry); else next.push(entry);
      count++;
    }
    objectStore.put(next, keys[0]);
    objectStore.put(intents.filter((item: CaptureIntent) => !ids.has(item.fileId)), keys[3]);
    return count;
  });
}

/** Bind once: old connection generations are never silently moved to a new Drive. */
export function bindCapture(uid: string, fileId: string, connectionId: string): Promise<CaptureIntent> {
  const key = capturesKey(uid);
  return transaction([key], ([intents = []], objectStore) => {
    const intent = intents.find((item: CaptureIntent) => item.fileId === fileId);
    if (!intent || (intent.connectionId && intent.connectionId !== connectionId)) throw new Error('촬영 자료의 연결이 변경되었습니다.');
    const bound = { ...intent, connectionId };
    objectStore.put(intents.map((item: CaptureIntent) => item.fileId === fileId ? bound : item), key);
    return bound;
  });
}

export function captureSource(uid: string, fileId: string): Promise<CapturedPhoto | undefined> {
  return transaction([trashKey(uid), sourceKey(uid, 'photos')], ([entries = [], photos = []]) => {
    if (entries.some((entry: TrashEntry) => entry.file.id === fileId && (!entry.restored || entry.purged))) return undefined;
    return photos.find((photo: CapturedPhoto) => photo.id === fileId);
  });
}

/** Recording and upload intent must become durable in the same transaction. */
export function saveRecordedAudio(uid: string, recording: RecordedAudio, intent?: CaptureIntent): Promise<void> {
  if (!uid || !recording.dataUrl || (intent && intent.fileId !== recording.id)) throw new Error('녹음 원본 또는 계정이 없습니다.');
  const keys = [trashKey(uid), sourceKey(uid, 'recordings'), capturesKey(uid)];
  return transaction(keys, ([entries = [], recordings = [], intents = []], objectStore) => {
    if (entries.some((entry: TrashEntry) => entry.file.id === recording.id) ||
      recordings.some((saved: RecordedAudio) => saved.id === recording.id)) throw new Error('이미 저장되거나 삭제된 녹음입니다.');
    objectStore.put([recording, ...recordings], keys[1]);
    if (intent) objectStore.put([...intents, intent], keys[2]);
  });
}

export function uploadSource(uid: string, fileId: string): Promise<{ dataUrl: string } | undefined> {
  return transaction([trashKey(uid), sourceKey(uid, 'photos'), sourceKey(uid, 'recordings')], ([entries = [], photos = [], recordings = []]) => {
    if (entries.some((entry: TrashEntry) => entry.file.id === fileId && (!entry.restored || entry.purged))) return undefined;
    return [...photos, ...recordings].find((file: { id: string; dataUrl?: string }) => file.id === fileId && file.dataUrl);
  });
}
