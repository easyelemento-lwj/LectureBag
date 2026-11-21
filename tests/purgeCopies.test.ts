import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadCache } from '../src/services/drive/downloadCache';
import { PcLibraryStore } from '../src/services/drive/pcLibrary';
import { sha256 } from '../src/services/drive/photoTrial';
import type { CloudMediaRecord } from '../src/services/drive/types';

test('confirmed purge removes only the selected account/file copies and fences stale PC writers', async () => {
  const blob = new Blob(['test']);
  const file: CloudMediaRecord = { ownerUid: crypto.randomUUID(), connectionId: crypto.randomUUID(), id: crypto.randomUUID(),
    driveFileId: 'drive', driveParentId: 'parent', logicalFolderId: 'day', name: 'audio.webm', mimeType: 'audio/webm',
    kind: 'audio', sizeBytes: 4, checksum: await sha256(blob), checksumAlgorithm: 'sha256', revision: 1,
    capturedAt: '2026-11-02', updatedAt: '2026-11-02' };
  const other = { ...file, ownerUid: crypto.randomUUID() };
  const cache = new DownloadCache();
  await cache.write(file, blob); await cache.write(other, blob);
  const pc = new PcLibraryStore();
  const configured = await pc.configure(file.ownerUid, { connected: true, connectionId: file.connectionId, revision: 1 }, true);
  const state = await pc.snapshot(configured, [], [file]);
  await pc.commit(state, file, blob);
  await assert.rejects(pc.purge(file), /확인/);
  const purged = { ...file, purgedAt: '2026-11-02', revision: 3, contentRevision: 1 };
  await cache.purge(purged); await pc.purge(purged);
  assert.equal(await cache.read(file), undefined);
  assert.ok(await cache.read(other));
  assert.equal((await pc.state(file.ownerUid))!.saved[file.id], undefined);
  await assert.rejects(pc.commit(state, file, blob));
  const generation = (await pc.state(file.ownerUid))!.generation;
  await pc.purge(purged);
  assert.equal((await pc.state(file.ownerUid))!.generation, generation);
});
