import type { TrashEntry } from '../../utils/trash';
import type { LifecycleState } from './lifecycle';

/** Drive is authoritative for registered files; legacy local trash is NEVER replayed as a remote command. */
export function projectTrash(local: TrashEntry[], state?: LifecycleState): TrashEntry[] {
  if (!state?.cursor) return local;
  const registered = new Set(state.files.map(f => f.id));
  const locals = new Map(local.map(e => [e.file.id, e]));
  const operations = new Map(state.operations.map(op => [op.fileId, op]));
  return [...local.filter(e => !registered.has(e.file.id)), ...state.files.map(file => {
    const old = locals.get(file.id);
    const pending = operations.get(file.id);
    const trashed = !!file.deletedAt || pending?.trashed === true;
    return {
      file: { ...(old && !old.purged ? old.file : {}), id: file.id, type: file.kind, name: file.name,
        timestamp: file.capturedAt, fileSize: `${(file.sizeBytes / 1024 / 1024).toFixed(2)} MB` },
      deletedAt: file.deletedAt || file.updatedAt, restored: !trashed, purged: !!file.purgedAt,
      cloud: { connectionId: file.connectionId, pending: pending ? pending.purge ? 'purge' as const : pending.trashed ? 'trash' as const : 'restore' as const : undefined,
        unavailable: file.driveUnavailable },
    };
  })];
}
