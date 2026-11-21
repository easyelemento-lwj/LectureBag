import { createStore, get, set } from 'idb-keyval';
import { CloudCatalog, CatalogError, type CloudSyncCursor } from './cloudCatalog';
import type { CloudMediaRecord, DriveIdentity } from './types';
import { DRIVE_OBSERVE_INTERVAL, SYNC_INTERVAL } from './syncPolicy';

export interface TrashOperation {
  operationId: string; fileId: string; revision: number; trashed: boolean; error?: string;
  cancelRequested?: boolean; retryAt?: number; attempts?: number;
  announced?: boolean; remote?: boolean; purge?: boolean; purgeConfirmed?: boolean;
}
export interface LifecycleState extends DriveIdentity {
  files: CloudMediaRecord[]; operations: TrashOperation[]; cursor?: CloudSyncCursor;
  reconcileCursor?: string; reconciledAt?: number; checkedAt?: number; notice?: string;
}
const key = (scope: DriveIdentity) => JSON.stringify([scope.ownerUid, scope.connectionId]);
export function mergeLifecycleFiles(scope: DriveIdentity, previous: CloudMediaRecord[], next: CloudMediaRecord[]) {
  const files = new Map(previous.map(f => [f.id, f]));
  for (const file of next) {
    if (file.ownerUid !== scope.ownerUid || file.connectionId !== scope.connectionId || !file.id ||
      !Number.isSafeInteger(file.revision) || file.revision < 1) throw new Error('삭제 동기화 계정/버전 불일치');
    if (!files.has(file.id) || files.get(file.id)!.revision <= file.revision) files.set(file.id, file);
  }
  return [...files.values()];
}

/** Separate from source storage. Outbox and acknowledged catalog survive reloads. */
export class LifecycleStore {
  private db = createStore('lecturebag-drive-lifecycle', 'state');
  read(scope: DriveIdentity) { return get<LifecycleState>(key(scope), this.db); }
  activate(scope: DriveIdentity) { return set(JSON.stringify(['last', scope.ownerUid]), scope.connectionId, this.db); }
  async last(uid: string) {
    const connectionId = await get<string>(JSON.stringify(['last', uid]), this.db);
    return connectionId ? this.read({ ownerUid: uid, connectionId }) : undefined;
  }
  async change(scope: DriveIdentity, change: (s: LifecycleState) => LifecycleState) {
    return this.db('readwrite', store => new Promise<LifecycleState>((resolve, reject) => {
      let result: LifecycleState, cause: unknown;
      const tx = store.transaction;
      tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(cause || tx.error);
      const req = store.get(key(scope));
      req.onsuccess = () => {
        try {
          result = change(req.result || { ...scope, files: [], operations: [] });
          if (result.ownerUid !== scope.ownerUid || result.connectionId !== scope.connectionId) throw new Error('동기화 계정 불일치');
          store.put(result, key(scope));
        } catch (error) { cause = error; tx.abort(); }
      };
    }));
  }
  enqueue(scope: DriveIdentity, ids: string[], trashed: boolean, purge = false) {
    return this.change(scope, s => {
      if (!s.cursor) throw new Error('Drive 목록을 먼저 확인해 주세요.');
      if (ids.some(id => s.operations.some(op => op.fileId === id))) throw new Error('선택한 파일의 삭제·복원 동기화가 진행 중입니다.');
      const operations = [...new Set(ids)].map(fileId => {
        const file = s.files.find(f => f.id === fileId);
        if (!file || file.purgedAt || file.driveUnavailable) throw new Error('Drive 원본 상태를 확인한 뒤 다시 시도해 주세요.');
        if (purge && (!trashed || !file.deletedAt)) throw new Error('휴지통 이동이 완료된 파일만 완전 삭제할 수 있습니다.');
        return { operationId: crypto.randomUUID(), fileId, revision: file.revision, trashed, ...(purge ? { purge: true, purgeConfirmed: true } : {}) };
      });
      return { ...s, operations: [...s.operations, ...operations], notice: undefined };
    });
  }
}

export async function syncLifecycle(catalog: CloudCatalog, store: LifecycleStore, scope: DriveIdentity,
  signal: AbortSignal, updated: () => Promise<void>, force = false) {
  const guard = () => { signal.throwIfAborted(); catalog.assertOwner(scope.ownerUid); };
  guard();
  let local = await store.read(scope);
  // The worker lock is short lived. Persist its last successful read so another
  // tab does not repeat the same background poll immediately after it releases.
  if (!force && local?.cursor && Date.now() - (local.checkedAt || 0) < SYNC_INTERVAL &&
    !local.operations.some(op => (!op.purge || op.purgeConfirmed) && (!op.retryAt || op.retryAt <= Date.now()))) return;
  if (!local?.cursor) {
    const head = await catalog.syncHead(scope.connectionId, signal);
    let cursor: string | undefined, files: CloudMediaRecord[] = [];
    const seen = new Set<string>();
    do {
      const page = await catalog.inventory(scope.connectionId, cursor, signal); guard();
      files = mergeLifecycleFiles(scope, files, page.files);
      cursor = page.nextCursor || undefined;
      if (cursor && seen.has(cursor)) throw new Error('반복된 동기화 커서');
      if (cursor) seen.add(cursor);
      if (seen.size > 2000) throw new Error('목록 확인 한도를 초과했습니다.');
    } while (cursor);
    local = await store.change(scope, s => ({ ...s, files: mergeLifecycleFiles(scope, s.files, files), cursor: head }));
    await updated();
  }
  // Request IDs are durable. A lost response is retried with the same ID, never
  // with a freshly generated operation that could undo a newer action elsewhere.
  // Drain the ready batch before background reads/reconciliation. RequestBudget
  // still paces every request; do not impose a second 60–300s pause after five.
  // Snapshot IDs bound this pass. Re-read each operation so a cancellation or
  // backoff recorded while earlier requests were running is respected.
  const readyIds = local.operations.filter(op => (!op.purge || op.purgeConfirmed) && (!op.retryAt || op.retryAt <= Date.now())).map(op => op.operationId);
  for (const operationId of readyIds) {
    guard();
    local = await store.read(scope);
    const op = local?.operations.find(item => item.operationId === operationId);
    if (!op || (op.retryAt || 0) > Date.now()) continue;
    guard();
    try {
      const body = { connectionId: scope.connectionId, fileId: op.fileId,
        operationId: op.operationId, revision: op.revision, trashed: op.trashed, ...(op.purge ? { purge: true, purgeConfirmed: op.purgeConfirmed } : {}) };
      const file = await (op.cancelRequested ? catalog.cancelTrash(body, signal) : catalog.trash(body, signal)); guard();
      local = await store.change(scope, s => ({ ...s, files: mergeLifecycleFiles(scope, s.files, [file]),
        operations: s.operations.filter(p => p.operationId !== op.operationId) }));
    } catch (error) {
      guard();
      const conflict = error instanceof CatalogError && ['DRIVE_FILE_CONFLICT', 'DRIVE_OPERATION_CONFLICT', 'DRIVE_FILE_NOT_REGISTERED'].includes(error.code);
      const message = error instanceof Error ? error.message : '삭제·복원 상태를 다시 확인합니다.';
      local = await store.change(scope, s => ({ ...s, notice: conflict ? message : s.notice,
        operations: conflict ? s.operations.filter(p => p.operationId !== op.operationId)
          : s.operations.map(p => p.operationId === op.operationId ? { ...p, error: message, attempts: (p.attempts || 0) + 1,
            retryAt: Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(p.attempts || 0, 4)) } : p) }));
      // A rate-limit response must stop the entire pass, including reads and
      // reconciliation, rather than immediately spending more requests.
      if (error instanceof CatalogError && error.httpStatus === 429) { await updated(); throw error; }
      if (!(error instanceof CatalogError) || (error.httpStatus || 0) >= 500 || error.httpStatus === 401) break;
    }
    await updated();
  }
  for (let count = 0; count < 2000; count++) {
    const after = local!.cursor!;
    let page;
    try { page = await catalog.changes(scope.connectionId, after.cursor, 0, signal); }
    catch (error) {
      if (error instanceof CatalogError && error.code === 'DRIVE_SYNC_RESET_REQUIRED') {
        await store.change(scope, s => ({ ...s, cursor: undefined }));
      }
      throw error;
    }
    guard();
    if (page.sequence !== after.sequence + page.changes.length || (page.hasMore && !page.changes.length) ||
      page.changes.some((c, n) => c.sequence !== after.sequence + n + 1)) throw new Error('잘못된 삭제 동기화 순서');
    local = await store.change(scope, s => {
      if (s.cursor?.cursor !== after.cursor) throw new Error('동기화 커서 충돌');
      return { ...s, files: mergeLifecycleFiles(scope, s.files, page.changes.map(c => c.file)),
        cursor: { cursor: page.cursor, sequence: page.sequence } };
    });
    await updated();
    if (!page.hasMore) break;
  }
  if (Date.now() - (local!.reconciledAt || 0) >= DRIVE_OBSERVE_INTERVAL) {
    const page = await catalog.reconcile(scope.connectionId, local!.reconcileCursor, signal); guard();
    await store.change(scope, s => ({ ...s, files: mergeLifecycleFiles(scope, s.files, page.files),
      reconcileCursor: page.nextCursor || undefined, reconciledAt: Date.now(),
      notice: page.issues?.length ? new CatalogError(page.issues[0].code, false).message : s.notice }));
    await updated();
  }
  await store.change(scope, s => ({ ...s, checkedAt: Date.now() }));
}
