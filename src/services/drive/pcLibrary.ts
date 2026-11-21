import { createStore, get } from 'idb-keyval';
import { downloadKey } from './downloadCache';
import { sha256 } from './photoTrial';
import type { CloudMediaRecord, DriveConnection } from './types';
import type { DriveFolder } from './driveClient';
import type { CloudChanges, CloudSyncCursor } from './cloudCatalog';

export interface PcFolder extends DriveFolder { parentId?: string }
export interface PcLibraryState {
  uid: string; connection: DriveConnection; enabled: boolean; blocked: boolean; generation: number;
  folders: PcFolder[]; files: CloudMediaRecord[]; unavailable: string[]; lastScan?: number;
  saved: Record<string, string>; persistent?: boolean;
  syncCursor?: CloudSyncCursor;
}
const stateKey = (uid: string) => JSON.stringify(['state', uid]);
const blobKey = (f: CloudMediaRecord) => JSON.stringify(['blob', downloadKey(f)]);
const partKey = (f: CloudMediaRecord) => JSON.stringify(['partial', downloadKey(f)]);
const chunkKey = (f: CloudMediaRecord, n: number) => JSON.stringify(['chunk', downloadKey(f), n]);
interface PartialFile { offset: number; count: number }

/** Opt-in originals, not an LRU cache. Never evicts completed source copies. */
export class PcLibraryStore {
  private db = createStore('lecturebag-pc-library', 'library');
  async purge(file: CloudMediaRecord) {
    if (!file.purgedAt) throw new Error('완전 삭제 확인이 필요합니다.');
    return this.db('readwrite', store => new Promise<void>((resolve, reject) => {
      const tx = store.transaction;
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
      const req = store.get(stateKey(file.ownerUid));
      req.onsuccess = () => {
        const state: PcLibraryState | undefined = req.result;
        if (state?.connection.connectionId === file.connectionId && (state.saved[file.id] || state.files.some(item => item.id === file.id))) {
          const saved = { ...state.saved }; delete saved[file.id];
          store.put({ ...state, saved, files: state.files.filter(item => item.id !== file.id), generation: state.generation + 1 }, stateKey(file.ownerUid));
        }
      };
      const scan = store.openKeyCursor();
      scan.onsuccess = () => {
        const cursor = scan.result;
        if (!cursor) return;
        try {
          const parts = JSON.parse(String(cursor.key));
          if (['blob', 'partial', 'chunk'].includes(parts[0])) {
            const identity = JSON.parse(parts[1]);
            if (identity[0] === file.ownerUid && identity[1] === file.connectionId && identity[2] === file.id) store.delete(cursor.key);
          }
        } catch { /* Unrelated key. */ }
        cursor.continue();
      };
    }));
  }
  state(uid: string) { return get<PcLibraryState>(stateKey(uid), this.db); }
  async change(uid: string, change: (s?: PcLibraryState) => PcLibraryState) {
    return this.db('readwrite', store => new Promise<PcLibraryState>((resolve, reject) => {
      let result: PcLibraryState, cause: unknown;
      const tx = store.transaction;
      tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(cause || tx.error || new Error('PC 보관소 저장 실패'));
      const req = store.get(stateKey(uid));
      req.onsuccess = () => { try { result = change(req.result); if (result.uid !== uid) throw new Error('계정 불일치'); store.put(result, stateKey(uid)); }
        catch (error) { cause = error; tx.abort(); } };
    }));
  }
  async configure(uid: string, connection: DriveConnection, enabled: boolean, persistent?: boolean) {
    if (!connection.connected || !connection.connectionId) throw new Error('Drive 연결이 필요합니다.');
    return this.change(uid, previous => ({
      ...(previous?.connection.connectionId === connection.connectionId ? previous : {
        uid, folders: [], files: [], unavailable: [], saved: {},
      }), connection, enabled, blocked: false, generation: (previous?.generation || 0) + 1, persistent,
    }));
  }
  async pause(uid: string, blocked = false) {
    if (!await this.state(uid)) return;
    return this.change(uid, s => ({ ...s!, enabled: false, blocked: s!.blocked || blocked, generation: s!.generation + 1 }));
  }
  private guard(s: PcLibraryState | undefined, expected: PcLibraryState) {
    if (!s || s.uid !== expected.uid || s.blocked || !s.enabled || s.generation !== expected.generation ||
      s.connection.connectionId !== expected.connection.connectionId) throw new Error('PC 동기화 작업이 변경되었습니다.');
  }
  async snapshot(expected: PcLibraryState, folders: PcFolder[], files: CloudMediaRecord[], syncCursor?: CloudSyncCursor) {
    if (files.some(f => f.ownerUid !== expected.uid || f.connectionId !== expected.connection.connectionId || f.deletedAt || f.purgedAt)) throw new Error('목록 계정 불일치');
    if (syncCursor) this.validateCursor(syncCursor);
    return this.change(expected.uid, s => { this.guard(s, expected); return { ...s!, folders, files,
      unavailable: s!.unavailable, syncCursor: syncCursor || s!.syncCursor, lastScan: Date.now() }; });
  }
  private validateCursor(value: CloudSyncCursor) {
    if (typeof value?.cursor !== 'string' || !value.cursor.length || value.cursor.length > 2048 ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new Error('잘못된 변경 커서');
  }
  async invalidateCursor(expected: PcLibraryState) {
    return this.change(expected.uid, s => { this.guard(s, expected); return { ...s!, syncCursor: undefined }; });
  }
  async applyChanges(expected: PcLibraryState, after: CloudSyncCursor, page: CloudChanges) {
    this.validateCursor(page);
    if (!Array.isArray(page.changes) || page.changes.length > 50 || typeof page.hasMore !== 'boolean' ||
      page.sequence !== after.sequence + page.changes.length || (page.hasMore && !page.changes.length)) throw new Error('잘못된 변경 목록');
    return this.change(expected.uid, s => {
      this.guard(s, expected);
      if (s!.syncCursor?.cursor !== after.cursor || s!.syncCursor.sequence !== after.sequence) throw new Error('변경 커서 충돌');
      const files = new Map(s!.files.map(f => [f.id, f])), folders = new Map(s!.folders.map(f => [f.id, f]));
      const unavailable = new Set(s!.unavailable);
      page.changes.forEach((change, index) => {
        const f = change.file;
        if (change.sequence !== after.sequence + index + 1 || !f || f.ownerUid !== expected.uid ||
          f.connectionId !== expected.connection.connectionId || typeof f.id !== 'string' || !f.id ||
          typeof f.name !== 'string' || typeof f.driveFileId !== 'string' || typeof f.driveParentId !== 'string' ||
          typeof f.logicalFolderId !== 'string' || !Number.isSafeInteger(f.revision) || f.revision < 1 ||
          !Number.isSafeInteger(f.sizeBytes) || f.sizeBytes < 1) throw new Error('변경 파일 계정 또는 버전 불일치');
        const old = files.get(f.id);
        if (old && old.revision > f.revision) return;
        if (old && old.revision === f.revision && downloadKey(old) !== downloadKey(f)) throw new Error('변경 파일 내용 충돌');
        if (f.deletedAt || f.purgedAt) files.delete(f.id); else files.set(f.id, f);
        if (f.driveUnavailable === true) unavailable.add(f.id);
        else if (f.driveUnavailable === false) unavailable.delete(f.id);
        const folder = change.folder;
        if (folder) {
          if (folder.id !== f.driveParentId || folder.logicalFolderId !== f.logicalFolderId || typeof folder.name !== 'string') throw new Error('변경 폴더 불일치');
          folders.set(folder.id, { ...folders.get(folder.id), ...folder });
        }
      });
      // Listing and acknowledgement commit together. Downloads remain discoverable
      // through missing version receipts even if the app exits immediately afterward.
      return { ...s!, files: [...files.values()], folders: [...folders.values()], unavailable: [...unavailable],
        syncCursor: { cursor: page.cursor, sequence: page.sequence }, lastScan: Date.now() };
    });
  }
  async unavailable(expected: PcLibraryState, id: string) {
    return this.change(expected.uid, s => { this.guard(s, expected); return { ...s!, unavailable: [...new Set([...s!.unavailable, id])] }; });
  }
  async read(file: CloudMediaRecord): Promise<Blob | undefined> {
    const s = await this.state(file.ownerUid);
    if (file.deletedAt || file.purgedAt || file.driveUnavailable || !s || s.blocked || s.connection.connectionId !== file.connectionId || s.unavailable.includes(file.id) ||
      s.saved[file.id] !== downloadKey(file) || !s.files.some(f => f.id === file.id && downloadKey(f) === downloadKey(file))) return;
    const blob = await get<Blob>(blobKey(file), this.db);
    if (!blob || blob.size !== file.sizeBytes) {
      // An individually missing/corrupt-sized copy must become pending again.
      await this.change(file.ownerUid, current => {
        if (!current) throw new Error('PC 보관소 없음');
        const saved = { ...current.saved };
        if (saved[file.id] === downloadKey(file)) delete saved[file.id];
        return { ...current, saved };
      });
      return;
    }
    return blob;
  }
  partial(file: CloudMediaRecord) { return get<PartialFile>(partKey(file), this.db).then(p => p || { offset: 0, count: 0 }); }
  async discardPartial(expected: PcLibraryState, file: CloudMediaRecord) {
    // Remove only unverified transfer fragments, never a completed original.
    return this.db('readwrite', store => new Promise<void>((resolve, reject) => {
      let cause: unknown; const tx = store.transaction;
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(cause || tx.error);
      const r = store.get(stateKey(expected.uid)); r.onsuccess = () => {
        try { this.guard(r.result, expected);
          if (file.ownerUid !== expected.uid || file.connectionId !== expected.connection.connectionId) throw new Error('계정 불일치');
          const p = store.get(partKey(file)); p.onsuccess = () => {
            for (let i = 0; i < (p.result?.count || 0); i++) store.delete(chunkKey(file, i));
            store.delete(partKey(file));
          };
        } catch (error) { cause = error; tx.abort(); }
      };
    }));
  }
  async append(expected: PcLibraryState, file: CloudMediaRecord, offset: number, blob: Blob) {
    // Chunk and acknowledged local offset commit atomically, fenced by user configuration.
    return this.db('readwrite', store => new Promise<void>((resolve, reject) => {
      let cause: unknown; const tx = store.transaction;
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(cause || tx.error || new Error('PC 중간 저장 실패'));
      const r = store.get(stateKey(expected.uid));
      r.onsuccess = () => {
        try { this.guard(r.result, expected); if (file.ownerUid !== expected.uid || file.connectionId !== expected.connection.connectionId) throw new Error('계정 불일치'); }
        catch (error) { cause = error; tx.abort(); return; }
        const p = store.get(partKey(file)); p.onsuccess = () => {
          const part: PartialFile = p.result || { offset: 0, count: 0 };
          if (offset !== part.offset || !blob.size || offset + blob.size > file.sizeBytes) { tx.abort(); return; }
          store.put(blob, chunkKey(file, part.count)); store.put({ offset: offset + blob.size, count: part.count + 1 }, partKey(file));
        };
      };
    }));
  }
  async assembled(file: CloudMediaRecord) {
    const part = await this.partial(file);
    if (part.offset !== file.sizeBytes) throw new Error('다운로드 미완료');
    const chunks: Blob[] = [];
    for (let i = 0; i < part.count; i++) {
      const blob = await get<Blob>(chunkKey(file, i), this.db);
      if (!blob) throw new Error('중간 조각 없음'); chunks.push(blob);
    }
    return new Blob(chunks, { type: file.mimeType });
  }
  async commit(expected: PcLibraryState, file: CloudMediaRecord, blob: Blob) {
    if (file.ownerUid !== expected.uid || file.connectionId !== expected.connection.connectionId) throw new Error('계정 불일치');
    if (blob.size !== file.sizeBytes || await sha256(blob) !== file.checksum) {
      await this.discardPartial(expected, file); throw new Error('PC 원본 검증 실패');
    }
    return this.db('readwrite', store => new Promise<void>((resolve, reject) => {
      let cause: unknown; const tx = store.transaction;
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(cause || tx.error || new Error('PC 보관소 저장 실패'));
      const r = store.get(stateKey(expected.uid)); r.onsuccess = () => {
        try {
          const s: PcLibraryState = r.result; this.guard(s, expected);
          if (!s.files.some(f => f.id === file.id && downloadKey(f) === downloadKey(file))) throw new Error('파일 버전 변경');
          store.put(blob, blobKey(file)); store.put({ ...s, unavailable: s.unavailable.filter(id => id !== file.id), saved: { ...s.saved, [file.id]: downloadKey(file) } }, stateKey(s.uid));
          const p = store.get(partKey(file)); p.onsuccess = () => {
            for (let i = 0; i < (p.result?.count || 0); i++) store.delete(chunkKey(file, i)); store.delete(partKey(file));
          };
        } catch (error) { cause = error; tx.abort(); }
      };
    }));
  }
}
