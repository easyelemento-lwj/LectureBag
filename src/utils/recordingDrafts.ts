import { createStore } from 'idb-keyval';

export interface RecordingDraft {
  id: string;
  uid: string;
  owner: string;
  mime: string;
  startedAt: string;
  updatedAt: number;
  elapsedMs: number;
  count: number;
  bytes: number;
  sealed?: boolean;
  warning?: string;
}
const store = createStore('lecturebag-recording-drafts', 'drafts');
const key = (uid: string, id: string) => JSON.stringify([uid, id]);
const chunkKey = (uid: string, id: string, index: number) => JSON.stringify([uid, id, index]);
export const DRAFT_LEASE_MS = 30_000;

function transaction<T>(run: (s: IDBObjectStore, result: (value: T) => void) => void, mode: IDBTransactionMode = 'readwrite'): Promise<T> {
  return store(mode, s => new Promise<T>((resolve, reject) => {
    let value: T;
    s.transaction.oncomplete = () => resolve(value);
    s.transaction.onabort = s.transaction.onerror = () => reject(s.transaction.error ?? new Error('녹음 임시 저장 실패'));
    try { run(s, v => { value = v; }); } catch (error) { s.transaction.abort(); reject(error); }
  }));
}
function change<T>(uid: string, id: string, fn: (draft: RecordingDraft, s: IDBObjectStore) => T): Promise<T> {
  return transaction((s, done) => {
    const req = s.get(key(uid, id));
    req.onsuccess = () => {
      try {
        const draft = req.result as RecordingDraft;
        if (!draft || draft.uid !== uid) throw new Error('녹음 임시 원본 없음');
        done(fn(draft, s));
      } catch { s.transaction.abort(); }
    };
  });
}
export async function createRecordingDraft(draft: RecordingDraft) {
  await transaction<void>((s, done) => { s.add(draft, key(draft.uid, draft.id)); done(); });
}
export async function appendRecordingChunk(uid: string, id: string, owner: string, index: number, blob: Blob, elapsedMs: number) {
  await change(uid, id, (d, s) => {
    if (d.owner !== owner || d.sealed || d.count !== index || !blob.size) throw new Error('녹음 조각 순서 불일치');
    s.add(blob, chunkKey(uid, id, index));
    s.put({ ...d, count: index + 1, bytes: d.bytes + blob.size, elapsedMs, updatedAt: Date.now() }, key(uid, id));
  });
}
export async function touchRecordingDraft(uid: string, id: string, owner: string, elapsedMs: number, sealed = false, warning?: string) {
  await change(uid, id, (d, s) => {
    if (d.owner !== owner) throw new Error('다른 창에서 복구 중');
    s.put({ ...d, elapsedMs, sealed: d.sealed || sealed, warning: warning || d.warning, updatedAt: Date.now() }, key(uid, id));
  });
}
export function listRecordingDrafts(uid: string): Promise<RecordingDraft[]> {
  return transaction((s, done) => {
    const prefix = `${JSON.stringify([uid]).slice(0, -1)},`;
    const req = s.openKeyCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    const drafts: RecordingDraft[] = [];
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { done(drafts); return; }
      const parts = JSON.parse(String(c.key));
      // Chunk keys sort before their metadata key. Jump over all chunks in a
      // session without reading blobs or visiting every recorded second.
      if (parts.length === 3) { c.continue(key(uid, parts[1])); return; }
      if (parts.length === 2 && parts[0] === uid) {
        const meta = s.get(c.key);
        meta.onsuccess = () => { const d = meta.result as RecordingDraft; if (d.count > 0) drafts.push(d); };
      }
      c.continue();
    };
  }, 'readonly');
}
/** Claim and read atomically: a suspended older tab cannot append after recovery. */
export function recoverRecordingDraft(uid: string, id: string, owner: string): Promise<{ draft: RecordingDraft; blob: Blob }> {
  return transaction((s, done) => {
    const req = s.get(key(uid, id));
    req.onsuccess = () => {
      const d = req.result as RecordingDraft;
      if (!d || d.uid !== uid || !d.count || Date.now() - d.updatedAt < DRAFT_LEASE_MS) { s.transaction.abort(); return; }
      const draft = { ...d, owner, sealed: true, updatedAt: Date.now() };
      s.put(draft, key(uid, id));
      const chunks: Blob[] = new Array(d.count); let remaining = d.count;
      for (let i = 0; i < d.count; i++) {
        const chunk = s.get(chunkKey(uid, id, i));
        chunk.onsuccess = () => {
          if (!(chunk.result instanceof Blob)) { s.transaction.abort(); return; }
          chunks[i] = chunk.result;
          if (--remaining === 0) done({ draft, blob: new Blob(chunks, { type: d.mime }) });
        };
      }
    };
  });
}
/** Only called after a durable final source commit. Never expires unsaved audio. */
export async function removeCommittedDraft(uid: string, id: string, owner: string) {
  await change(uid, id, (d, s) => {
    if (d.owner !== owner) throw new Error('다른 창에서 복구 중');
    for (let i = 0; i < d.count; i++) s.delete(chunkKey(uid, id, i));
    s.delete(key(uid, id));
  });
}
