import { CatalogError, type CloudCatalog } from './cloudCatalog';
import type { LifecycleStore, TrashOperation } from './lifecycle';
import type { DriveIdentity } from './types';

/** Remote status is presentation only: never copy it into the local outbox. */
export function sharedOperations(local: TrashOperation[], remote: TrashOperation[]): TrashOperation[] {
  const merged = new Map(remote.map(op => [op.operationId, { ...op, remote: true }]));
  for (const op of local) merged.set(op.operationId, { ...op, remote: false });
  return [...merged.values()];
}

export function readSharedOperation(value: Record<string, unknown>, connectionId: string): TrashOperation | undefined {
  if (value.connectionId !== connectionId || value.done !== false || typeof value.operationId !== 'string' ||
    typeof value.fileId !== 'string' || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
    typeof value.trashed !== 'boolean') return;
  return { operationId: value.operationId, fileId: value.fileId, revision: value.revision as number,
    trashed: value.trashed, remote: true, ...(value.purge === true ? { purge: true } : {}) };
}

/** Registration is idempotent. Lost replies retry the original operation IDs. */
export async function announceLifecycle(catalog: CloudCatalog, store: LifecycleStore, scope: DriveIdentity,
  signal: AbortSignal, updated: () => Promise<void>) {
  const guard = () => { signal.throwIfAborted(); catalog.assertOwner(scope.ownerUid); };
  guard();
  const saved = await store.read(scope);
  // Older queued permanent deletes need a fresh explicit confirmation.
  const ready = (saved?.operations || []).filter(op => (!op.purge || op.purgeConfirmed) && !op.announced && !op.cancelRequested && (op.retryAt || 0) <= Date.now());
  for (let start = 0; start < ready.length; start += 50) {
    guard();
    const result = await catalog.prepareTrash(scope.connectionId, ready.slice(start, start + 50), signal);
    guard();
    const results = new Map(result.operations.map(op => [op.operationId, op]));
    await store.change(scope, state => ({ ...state, operations: state.operations.flatMap(op => {
      const receipt = results.get(op.operationId);
      if (!receipt) return [op];
      if (receipt.done) return []; // Completed elsewhere; changes feed supplies the final file.
      if (receipt.code) {
        if (['DRIVE_FILE_CONFLICT', 'DRIVE_OPERATION_CONFLICT', 'DRIVE_FILE_NOT_REGISTERED'].includes(receipt.code)) return [];
        const error = new CatalogError(receipt.code, true).message;
        return [{ ...op, error, retryAt: Date.now() + 30_000 }];
      }
      return [{ ...op, announced: true }];
    }) }));
    await updated();
  }
}
