import type { MediaFile } from '../types';

export interface TrashEntry {
  file: MediaFile;
  deletedAt: string;
  restored?: boolean;
  purged?: boolean;
  documentContent?: string;
}

export function restoreTrashEntries(entries: TrashEntry[], ids: string[]) {
  const selected = new Set(ids);
  return entries.map(entry => selected.has(entry.file.id) && !entry.purged ? { ...entry, restored: true } : entry);
}

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function trashExpiresAt(entry: TrashEntry): number {
  return new Date(entry.deletedAt).getTime() + TRASH_RETENTION_MS;
}

export function purgeTrashEntries(entries: TrashEntry[], ids: string[]): TrashEntry[] {
  const selected = new Set(ids);
  return entries.map(entry => {
    if (entry.restored || entry.purged || !selected.has(entry.file.id)) return entry;
    // Keep only a deletion marker so stale source lists cannot resurrect the file.
    return {
      file: { id: entry.file.id, type: entry.file.type, name: '', timestamp: entry.deletedAt },
      deletedAt: entry.deletedAt,
      purged: true,
    };
  });
}

export function purgeExpiredTrash(entries: TrashEntry[], now = Date.now()): TrashEntry[] {
  const expiredIds = entries.filter(entry => !entry.restored && !entry.purged && trashExpiresAt(entry) <= now)
    .map(entry => entry.file.id);
  return expiredIds.length ? purgeTrashEntries(entries, expiredIds) : entries;
}
