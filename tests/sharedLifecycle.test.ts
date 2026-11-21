import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { announceLifecycle, readSharedOperation, sharedOperations } from '../src/services/drive/sharedLifecycle';
import { LifecycleStore, type TrashOperation } from '../src/services/drive/lifecycle';
import type { CloudCatalog } from '../src/services/drive/cloudCatalog';

test('other-device delete/restore statuses merge without duplicate commands or local-state loss', () => {
  const op: TrashOperation = { operationId: 'op', fileId: 'photo', revision: 1, trashed: true };
  const remote = readSharedOperation({ ...op, connectionId: 'conn', done: false }, 'conn')!;
  assert.equal(sharedOperations([], [remote])[0].remote, true);
  assert.deepEqual(sharedOperations([{ ...op, cancelRequested: true }], [remote]), [{ ...op, cancelRequested: true, remote: false }]);
  assert.equal(readSharedOperation({ ...op, connectionId: 'old', done: false }, 'conn'), undefined);
  assert.equal(readSharedOperation({ ...op, connectionId: 'conn', done: true }, 'conn'), undefined);
  assert.equal(readSharedOperation({ ...op, connectionId: 'conn', done: false, revision: '1' }, 'conn'), undefined);
  const restore = readSharedOperation({ ...op, trashed: false, connectionId: 'conn', done: false }, 'conn')!;
  assert.equal(sharedOperations([], [restore])[0].trashed, false);
  assert.deepEqual(sharedOperations([], []), []);
});

test('announce all ready operations before Google writes, chunked and idempotent across retries', async () => {
  const scope = { ownerUid: crypto.randomUUID(), connectionId: crypto.randomUUID() };
  const store = new LifecycleStore();
  const operations = Array.from({ length: 53 }, (_, index) => ({ operationId: crypto.randomUUID(), fileId: crypto.randomUUID(),
    revision: 1, trashed: index % 2 === 0 }));
  await store.change(scope, s => ({ ...s, operations }));
  const batches: string[][] = [];
  let fail = true;
  const catalog = { assertOwner() {}, prepareTrash: async (_: string, batch: TrashOperation[]) => {
    batches.push(batch.map(op => op.operationId));
    if (batch.length === 3 && fail) throw new Error('lost reply');
    return { operations: batch.map(op => ({ operationId: op.operationId, done: false })) };
  } } as unknown as CloudCatalog;
  const announce = () => announceLifecycle(catalog, store, scope, new AbortController().signal, async () => {});
  await assert.rejects(announce(), /lost reply/);
  fail = false; await announce(); await announce();
  assert.deepEqual(batches.map(batch => batch.length), [50, 3, 3]);
  assert.deepEqual(batches[1], batches[2]);
  assert.equal((await store.read(scope))!.operations.filter(op => op.announced).length, 53);
});

test('completed/conflicting receipts leave the queue; busy, cancelled and backoff requests are preserved', async () => {
  const scope = { ownerUid: crypto.randomUUID(), connectionId: crypto.randomUUID() };
  const store = new LifecycleStore();
  const base = { fileId: 'file', revision: 1, trashed: true };
  await store.change(scope, s => ({ ...s, operations: [
    { ...base, operationId: 'done' }, { ...base, operationId: 'conflict' }, { ...base, operationId: 'busy' },
    { ...base, operationId: 'cancel', cancelRequested: true }, { ...base, operationId: 'later', retryAt: Date.now() + 60_000 },
  ] }));
  const catalog = { assertOwner() {}, prepareTrash: async (_: string, batch: TrashOperation[]) => {
    assert.deepEqual(batch.map(op => op.operationId), ['done', 'conflict', 'busy']);
    return { operations: [{ operationId: 'done', done: true }, { operationId: 'conflict', code: 'DRIVE_FILE_CONFLICT' },
      { operationId: 'busy', code: 'DRIVE_FILE_BUSY' }] };
  } } as unknown as CloudCatalog;
  await announceLifecycle(catalog, store, scope, new AbortController().signal, async () => {});
  const remaining = (await store.read(scope))!.operations;
  assert.deepEqual(remaining.map(op => op.operationId), ['busy', 'cancel', 'later']);
  assert.ok(remaining[0].error); assert.ok(remaining[0].retryAt! > Date.now());
});
