import { createStore, get, del } from 'idb-keyval';
import type { CloudMediaRecord } from './types';

export const CACHE_MAX_BYTES = 128 * 1024 * 1024;
const store = createStore('lecturebag-drive-download-cache', 'photos');
export interface CachedPhoto { key: string; fileKey: string; blob: Blob; lastAccess: number }
const fileKey = (record: CloudMediaRecord) => JSON.stringify([record.ownerUid, record.connectionId, record.id]);
export const downloadKey = (record: CloudMediaRecord) => JSON.stringify([record.ownerUid, record.connectionId,
  record.id, record.driveFileId, record.contentRevision ?? record.revision, record.checksumAlgorithm, record.checksum, record.sizeBytes, record.mimeType]);

/** A dedicated, disposable cache. Never touches camera originals or the upload outbox. */
export class DownloadCache {
  constructor(private maxBytes = CACHE_MAX_BYTES) {}
  read(record: CloudMediaRecord) { return get<CachedPhoto>(downloadKey(record), store); }
  remove(record: CloudMediaRecord) { return del(downloadKey(record), store); }
  async purge(record: CloudMediaRecord) {
    if (!record.purgedAt) throw new Error('완전 삭제 확인이 필요합니다.');
    return store('readwrite', objectStore => new Promise<void>((resolve, reject) => {
      const tx = objectStore.transaction;
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
      const request = objectStore.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value.fileKey === fileKey(record)) cursor.delete();
        cursor.continue();
      };
    }));
  }
  async write(record: CloudMediaRecord, blob: Blob) {
    if (blob.size > this.maxBytes) return false;
    const entry: CachedPhoto = { key: downloadKey(record), fileKey: fileKey(record), blob, lastAccess: Date.now() };
    await store('readwrite', objectStore => new Promise<void>((resolve, reject) => {
      const tx = objectStore.transaction;
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('캐시 저장 실패'));
      const request = objectStore.getAll();
      request.onsuccess = () => {
        // Transactions serialize across tabs; distinct access order even within one millisecond.
        entry.lastAccess = Math.max(entry.lastAccess, ...request.result.map((item: CachedPhoto) =>
          Number.isFinite(item.lastAccess) ? item.lastAccess + 1 : 0));
        const keep: CachedPhoto[] = [];
        for (const cached of request.result as CachedPhoto[]) {
          if (cached.fileKey === entry.fileKey) objectStore.delete(cached.key);
          else keep.push(cached);
        }
        keep.sort((a, b) => a.lastAccess - b.lastAccess);
        let bytes = keep.reduce((n, item) => n + item.blob.size, blob.size);
        while (keep.length && (bytes > this.maxBytes || keep.length >= 256)) {
          const oldest = keep.shift()!; bytes -= oldest.blob.size; objectStore.delete(oldest.key);
        }
        objectStore.put(entry, entry.key);
      };
    }));
    return true;
  }
}
