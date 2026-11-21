import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'idb-keyval';
import { LifecycleStore, mergeLifecycleFiles, syncLifecycle } from '../src/services/drive/lifecycle';
import { CloudCatalog, CatalogError } from '../src/services/drive/cloudCatalog';
import { projectTrash } from '../src/services/drive/trashProjection';
import { PcLibraryStore } from '../src/services/drive/pcLibrary';
import { downloadKey } from '../src/services/drive/downloadCache';
import { sha256 } from '../src/services/drive/photoTrial';
import type { CloudMediaRecord } from '../src/services/drive/types';
import { purgeExpiredTrash, TRASH_RETENTION_MS, type TrashEntry } from '../src/utils/trash';
import { saveMedia, updateTrash } from '../src/utils/mediaStorage';

function fixture() {
  const scope = { ownerUid: crypto.randomUUID(), connectionId: crypto.randomUUID() };
  const file: CloudMediaRecord = { ...scope, id: crypto.randomUUID(), driveFileId: 'google', driveParentId: 'parent',
    logicalFolderId: 'day', name: 'original.jpg', mimeType: 'image/jpeg', kind: 'photo', sizeBytes: 3,
    capturedAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T01:00:00Z', revision: 1 };
  const store = new LifecycleStore();
  return { scope, file, store };
}
async function seed(f: ReturnType<typeof fixture>) {
  await f.store.activate(f.scope);
  return f.store.change(f.scope, s => ({ ...s, files: [f.file], cursor: { cursor: 'one', sequence: 1 }, reconciledAt: Date.now() }));
}

test('permanent deletion stays visible until the server confirms and carries explicit purge intent', async () => {
  const f = fixture(); await seed(f);
  await assert.rejects(f.store.enqueue(f.scope, [f.file.id], true, true), /휴지통/);
  const deleted = { ...f.file, deletedAt: '2026-11-02', revision: 2 };
  await f.store.change(f.scope, s => ({ ...s, files: [deleted] }));
  const queued = await f.store.enqueue(f.scope, [f.file.id], true, true);
  assert.equal(queued.operations[0].purgeConfirmed, true);
  const pending = projectTrash([], queued)[0];
  assert.equal(pending.cloud?.pending, 'purge');
  assert.equal(pending.purged, false);
  const catalog = { assertOwner() {}, trash: async (body: any) => {
    assert.equal(body.purge, true); assert.equal(body.purgeConfirmed, true); assert.equal(body.trashed, true); assert.equal(body.revision, 2);
    return { ...deleted, purgedAt: '2026-11-02', revision: 3 };
  }, changes: async () => ({ cursor: 'one', sequence: 1, hasMore: false, changes: [] }) } as unknown as CloudCatalog;
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {}, true);
  assert.equal(projectTrash([], await f.store.read(f.scope))[0].purged, true);
  assert.equal((await f.store.read(f.scope))!.operations.length, 0);
});

test('legacy permanent deletion remains pending without being sent', async () => {
  const f = fixture(); await seed(f);
  const deleted = { ...f.file, deletedAt: '2026-11-02', revision: 2 };
  await f.store.change(f.scope, s => ({ ...s, files: [deleted], operations: [{ operationId: crypto.randomUUID(), fileId: deleted.id, revision: 2, trashed: true, purge: true }] }));
  let writes = 0;
  const catalog = { assertOwner() {}, trash: async () => { writes++; throw new Error('must stay paused'); },
    changes: async () => ({ cursor: 'one', sequence: 1, hasMore: false, changes: [] }) } as unknown as CloudCatalog;
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {}, true);
  assert.equal(writes, 0);
  assert.equal((await f.store.read(f.scope))!.operations.length, 1);
});

test('a user can cancel a legacy unconfirmed purge without sending a delete', async () => {
  const f = fixture(); await seed(f);
  const deleted = { ...f.file, deletedAt: '2026-11-02', revision: 2 };
  const operationId = crypto.randomUUID();
  await f.store.change(f.scope, s => ({ ...s, files: [deleted], operations: [{ operationId, fileId: deleted.id, revision: 2, trashed: true, purge: true, cancelRequested: true }] }));
  const catalog = { assertOwner() {}, trash: async () => { throw Error('must not delete'); },
    cancelTrash: async (body: any) => { assert.equal(body.operationId, operationId); assert.equal(body.purge, true); return deleted; },
    changes: async () => ({ cursor: 'one', sequence: 1, hasMore: false, changes: [] }) } as unknown as CloudCatalog;
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {}, true);
  assert.equal((await f.store.read(f.scope))!.operations.length, 0);
});

test('nine ready deletions drain in one pass before background reads, with per-file progress', async () => {
  const f = fixture(); await seed(f);
  const files = Array.from({ length: 9 }, () => ({ ...f.file, id: crypto.randomUUID() }));
  await f.store.change(f.scope, s => ({ ...s, files }));
  const pending = await f.store.enqueue(f.scope, files.map(file => file.id), true);
  const sent: string[] = [], remaining: number[] = [];
  const catalog = { assertOwner() {}, trash: async (body: any) => {
    sent.push(body.operationId);
    return { ...files.find(file => file.id === body.fileId)!, revision: 2, deletedAt: '2026-11-01' };
  }, changes: async () => {
    assert.equal(sent.length, 9, 'no background scan between the first five and remaining four');
    return { cursor: 'one', sequence: 1, hasMore: false, changes: [] };
  } } as unknown as CloudCatalog;
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {
    remaining.push((await f.store.read(f.scope))!.operations.length);
  }, true);
  assert.deepEqual(sent, pending.operations.map(op => op.operationId));
  assert.deepEqual(remaining.slice(0, 9), [8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal((await f.store.read(f.scope))!.operations.length, 0);
});

test('continuous drain respects cancellation and backoff saved while an earlier request runs', async () => {
  const f = fixture(); await seed(f);
  const files = Array.from({ length: 3 }, () => ({ ...f.file, id: crypto.randomUUID() }));
  await f.store.change(f.scope, s => ({ ...s, files }));
  await f.store.enqueue(f.scope, files.map(file => file.id), true);
  const calls: string[] = [];
  const catalog = { assertOwner() {}, trash: async (body: any) => {
    calls.push(`trash:${body.fileId}`);
    await f.store.change(f.scope, s => ({ ...s, operations: s.operations.map(op => op.fileId === files[1].id
      ? { ...op, cancelRequested: true } : op.fileId === files[2].id ? { ...op, retryAt: Date.now() + 60000 } : op) }));
    return { ...files[0], revision: 2, deletedAt: '2026-11-01' };
  }, cancelTrash: async (body: any) => { calls.push(`cancel:${body.fileId}`); return files[1]; },
  changes: async () => ({ cursor: 'one', sequence: 1, hasMore: false, changes: [] }) } as unknown as CloudCatalog;
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {}, true);
  assert.deepEqual(calls, [`trash:${files[0].id}`, `cancel:${files[1].id}`]);
  assert.equal((await f.store.read(f.scope))!.operations[0].fileId, files[2].id);
});

test('rate limit partway through a large batch stops further mutations and reads; unattempted IDs survive', async () => {
  const f = fixture(); await seed(f);
  const files = Array.from({ length: 9 }, () => ({ ...f.file, id: crypto.randomUUID() }));
  await f.store.change(f.scope, s => ({ ...s, files }));
  const pending = await f.store.enqueue(f.scope, files.map(file => file.id), true);
  let calls = 0;
  const catalog = { assertOwner() {}, trash: async (body: any) => {
    if (++calls === 6) throw new CatalogError('DRIVE_RATE_LIMITED', true, 429, Date.now() + 60000);
    return { ...files.find(file => file.id === body.fileId)!, revision: 2, deletedAt: '2026-11-01' };
  }, changes: async () => { throw Error('must not read during cooldown'); } } as unknown as CloudCatalog;
  await assert.rejects(syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {}, true), CatalogError);
  assert.equal(calls, 6);
  assert.deepEqual((await f.store.read(f.scope))!.operations.map(op => op.operationId), pending.operations.slice(5).map(op => op.operationId));
});

test('429 stops the entire lifecycle pass and preserves the pending operation ID', async () => {
  const f = fixture(); await seed(f); const s = await f.store.enqueue(f.scope, [f.file.id], true);
  let reads = 0;
  const catalog = { assertOwner() {}, trash: async () => { throw new CatalogError('DRIVE_RATE_LIMITED', true, 429, Date.now() + 60_000); },
    changes: async () => { reads++; }, reconcile: async () => { reads++; } } as unknown as CloudCatalog;
  await assert.rejects(syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {}));
  assert.equal(reads, 0);
  assert.equal((await f.store.read(f.scope))!.operations[0].operationId, s.operations[0].operationId);
});

test('another tab skips a fresh background poll, but a direct refresh can check now', async () => {
  const f = fixture(); await seed(f);
  await f.store.change(f.scope, s => ({ ...s, checkedAt: Date.now() })); let reads = 0;
  const catalog = { assertOwner() {}, changes: async () => { reads++; return { cursor: 'one', sequence: 1, hasMore: false, changes: [] }; } } as unknown as CloudCatalog;
  await syncLifecycle(catalog, new LifecycleStore(), f.scope, new AbortController().signal, async () => {});
  assert.equal(reads, 0);
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {}, true);
  assert.equal(reads, 1);
});

test('trash outbox survives reopen and binds owner, connection, revision and stable operation ID', async () => {
  const f = fixture(); await seed(f);
  const pending = await f.store.enqueue(f.scope, [f.file.id], true);
  const reopened = await new LifecycleStore().read(f.scope);
  assert.deepEqual(reopened, pending);
  assert.equal(reopened!.operations[0].revision, 1);
  assert.equal((await f.store.last(f.scope.ownerUid))?.connectionId, f.scope.connectionId);
  assert.equal(await f.store.last('another-user'), undefined);
  await assert.rejects(f.store.enqueue(f.scope, [f.file.id], false));
  await assert.rejects(f.store.enqueue({ ...f.scope, connectionId: 'another' }, [f.file.id], true));
  await assert.rejects(f.store.enqueue(f.scope, [f.file.id, 'unregistered'], true));
});

test('lost response retries the same operation; conflict never silently overwrites newer state', async () => {
  const f = fixture(); await seed(f);
  await f.store.enqueue(f.scope, [f.file.id], true);
  const ids: string[] = []; let fail = true;
  const deleted = { ...f.file, revision: 2, contentRevision: 1, deletedAt: new Date().toISOString() };
  const catalog = { assertOwner: () => {}, trash: async (body: any) => {
    ids.push(body.operationId); if (fail) throw new Error('synthetic lost response'); return deleted;
  }, changes: async () => ({ cursor: 'two', sequence: 2, hasMore: false, changes: [{ sequence: 2, file: deleted }] }) } as unknown as CloudCatalog;
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {});
  assert.equal((await f.store.read(f.scope))!.operations.length, 1);
  // Previous attempt has already consumed event 2; do not replay it as a new event.
  catalog.changes = async () => ({ cursor: 'two', sequence: 2, hasMore: false, changes: [] });
  await f.store.change(f.scope, s => ({ ...s, operations: s.operations.map(op => ({ ...op, retryAt: 0 })) }));
  fail = false;
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {});
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  assert.equal((await f.store.read(f.scope))!.operations.length, 0);
  await f.store.enqueue(f.scope, [f.file.id], false);
  catalog.trash = async () => { throw new CatalogError('DRIVE_FILE_CONFLICT', false, 409); };
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {});
  const conflict = await f.store.read(f.scope);
  assert.equal(conflict!.operations.length, 0); assert.match(conflict!.notice!, /다른 곳/);
  assert.ok(conflict!.files[0].deletedAt);
});

test('bootstrap captures head before inventory, includes trash, and replays racing restore', async () => {
  const f = fixture(); const steps: string[] = [];
  const deleted = { ...f.file, deletedAt: new Date().toISOString(), revision: 2, contentRevision: 1 };
  const restored = { ...f.file, revision: 3, contentRevision: 1 };
  const catalog = { assertOwner: () => {}, syncHead: async () => { steps.push('head'); return { cursor: 'two', sequence: 2 }; },
    inventory: async () => { steps.push('inventory'); return { files: [deleted], nextCursor: null }; },
    changes: async () => ({ cursor: 'three', sequence: 3, hasMore: false, changes: [{ sequence: 3, file: restored }] }),
    reconcile: async () => ({ files: [restored], nextCursor: null }),
  } as unknown as CloudCatalog;
  await syncLifecycle(catalog, f.store, f.scope, new AbortController().signal, async () => {});
  assert.deepEqual(steps, ['head', 'inventory']);
  assert.equal((await f.store.read(f.scope))!.files[0].revision, 3);
});

test('stale or foreign metadata cannot overwrite scoped current state', () => {
  const f = fixture(), newer = { ...f.file, revision: 3, deletedAt: '2026-10-14' };
  assert.deepEqual(mergeLifecycleFiles(f.scope, [newer], [f.file]), [newer]);
  assert.throws(() => mergeLifecycleFiles(f.scope, [], [{ ...f.file, ownerUid: 'other' }]));
  assert.throws(() => mergeLifecycleFiles(f.scope, [], [{ ...f.file, connectionId: 'old' }]));
});

test('projection distinguishes queued deletion, confirmed trash and pending restoration without replaying legacy trash', async () => {
  const f = fixture(); const state = await seed(f);
  const legacy: TrashEntry = { file: { id: f.file.id, type: 'photo', name: 'legacy.jpg', timestamp: '', dataUrl: 'local-source' }, deletedAt: '2020-01-01' };
  assert.equal(projectTrash([legacy], state)[0].restored, true); // Registered Drive state wins, not a remote delete.
  assert.equal(state.operations.length, 0);
  const queued = await f.store.enqueue(f.scope, [f.file.id], true);
  const pending = projectTrash([legacy], queued)[0];
  assert.equal(pending.restored, false); assert.equal(pending.cloud?.pending, 'trash');
  assert.equal(pending.file.dataUrl, 'local-source');
  const restoring = projectTrash([legacy], { ...state, files: [{ ...f.file, deletedAt: '2026-10-14' }],
    operations: [{ operationId: 'op', fileId: f.file.id, revision: 2, trashed: false }] })[0];
  assert.equal(restoring.restored, false); assert.equal(restoring.cloud?.pending, 'restore');
  const inaccessible = projectTrash([], { ...state, files: [{ ...f.file, driveUnavailable: true }] })[0];
  assert.equal(inaccessible.restored, true); assert.equal(inaccessible.cloud?.unavailable, true);
});

test('Drive rollout and cloud trash preserve expired local original bytes', async () => {
  const f = fixture();
  const entry: TrashEntry = { file: { id: f.file.id, type: 'photo', name: 'source', timestamp: '', dataUrl: 'source-bytes' },
    deletedAt: new Date(Date.now() - TRASH_RETENTION_MS - 1).toISOString(), cloud: { connectionId: f.scope.connectionId } };
  assert.equal(purgeExpiredTrash([entry])[0].purged, undefined);
  await saveMedia(f.scope.ownerUid, 'photos', [entry.file]);
  await updateTrash(f.scope.ownerUid, () => [{ ...entry, cloud: undefined }], true);
  assert.equal((await updateTrash(f.scope.ownerUid, s => s, true))[0].purged, undefined);
  assert.equal((await get<any[]>(`lecture_snap_photos_${f.scope.ownerUid}`))![0].dataUrl, 'source-bytes');
});

test('PC trash and restore reuse verified original receipt without a second download', async () => {
  const f = fixture(); const blob = new Blob(['abc'], { type: 'image/jpeg' });
  const file = { ...f.file, checksum: await sha256(blob), checksumAlgorithm: 'sha256' as const };
  const store = new PcLibraryStore();
  const expected = await store.configure(f.scope.ownerUid, { connected: true, revision: 1, connectionId: f.scope.connectionId }, true);
  await store.snapshot(expected, [], [file], { cursor: 'one', sequence: 1 });
  await store.commit(expected, file, blob);
  const deleted = { ...file, revision: 2, contentRevision: 1, deletedAt: '2026-10-14', driveUnavailable: false };
  await store.applyChanges(expected, { cursor: 'one', sequence: 1 }, { cursor: 'two', sequence: 2, hasMore: false, changes: [{ sequence: 2, file: deleted }] });
  assert.equal(await store.read(file), undefined);
  assert.equal(await store.read(deleted), undefined);
  const restored = { ...file, revision: 3, contentRevision: 1, driveUnavailable: false };
  await store.applyChanges(expected, { cursor: 'two', sequence: 2 }, { cursor: 'three', sequence: 3, hasMore: false, changes: [{ sequence: 3, file: restored }] });
  assert.equal(downloadKey(restored), downloadKey(file));
  assert.equal(await (await store.read(restored))!.text(), 'abc');
});

test('cancellation is durable and goes through server acknowledgement; stale generation cannot replace last active scope', async () => {
  const f = fixture(); await seed(f);
  await f.store.enqueue(f.scope, [f.file.id], true);
  await f.store.change(f.scope, s => ({ ...s, operations: s.operations.map(op => ({ ...op, cancelRequested: true })) }));
  const calls: string[] = [];
  const catalog = { assertOwner: () => {}, trash: async () => { throw new Error('must not reissue deletion'); },
    cancelTrash: async () => { calls.push('cancel'); return f.file; },
    changes: async () => ({ cursor: 'one', sequence: 1, hasMore: false, changes: [] }) } as unknown as CloudCatalog;
  await syncLifecycle(catalog, new LifecycleStore(), f.scope, new AbortController().signal, async () => {});
  assert.deepEqual(calls, ['cancel']);
  assert.equal((await f.store.read(f.scope))!.operations.length, 0);
  const nextScope = { ...f.scope, connectionId: 'new-generation' };
  await f.store.activate(nextScope); await f.store.change(nextScope, s => s);
  await f.store.change(f.scope, s => ({ ...s, notice: 'late old request' }));
  assert.equal((await f.store.last(f.scope.ownerUid))!.connectionId, 'new-generation');
});
