import { createStore } from 'idb-keyval';
import type { TrashEntry } from './trash';
import { purgeExpiredTrash } from './trash';

const store = createStore('keyval-store', 'keyval');
export const trashKey = (uid: string) => `lecture_snap_trash_${uid}`;
const sourceKey = (uid: string, kind: 'photos' | 'recordings') => `lecture_snap_${kind}_${uid}`;

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

export function updateTrash(uid: string, change: (entries: TrashEntry[]) => TrashEntry[]): Promise<TrashEntry[]> {
  const keys = [trashKey(uid), sourceKey(uid, 'photos'), sourceKey(uid, 'recordings')];
  return transaction(keys, ([saved = [], photos = [], recordings = []], objectStore) => {
    const current = purgeExpiredTrash(saved);
    const proposed = change(current);
    const permanent = new Map<string, TrashEntry>(current.filter((entry: TrashEntry) => entry.purged).map((entry: TrashEntry) => [entry.file.id, entry]));
    // A stale client can never remove or replace a committed deletion marker.
    const next = [...proposed.filter(entry => !permanent.has(entry.file.id)), ...permanent.values()];
    const purged = new Set(next.filter(entry => entry.purged).map(entry => entry.file.id));
    objectStore.put(next, keys[0]);
    objectStore.put(photos.filter((file: { id: string }) => !purged.has(file.id)), keys[1]);
    objectStore.put(recordings.filter((file: { id: string }) => !purged.has(file.id)), keys[2]);
    return next;
  });
}

export function saveMedia<T extends { id: string }>(uid: string, kind: 'photos' | 'recordings', files: T[]): Promise<void> {
  const keys = [trashKey(uid), sourceKey(uid, kind)];
  return transaction(keys, ([entries = [], saved = []], objectStore) => {
    const purged = new Set(entries.filter((entry: TrashEntry) => entry.purged).map((entry: TrashEntry) => entry.file.id));
    const merged = new Map<string, T>([...saved, ...files].map(file => [file.id, file]));
    objectStore.put([...merged.values()].filter(file => !purged.has(file.id)), keys[1]);
  });
}
