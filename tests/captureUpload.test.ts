import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureIntents, captureSource, saveCapturedPhoto, saveMedia, updateTrash } from '../src/utils/mediaStorage';
import { enqueueCaptures, uploadCapture, folderKey, captureBlob } from '../src/services/drive/captureUpload';
import { UploadQueue, IndexedDbUploadJobStore } from '../src/services/drive/uploadQueue';
import { CatalogError, type CloudCatalog } from '../src/services/drive/cloudCatalog';
import { sha256 } from '../src/services/drive/photoTrial';
import type { CapturedPhoto } from '../src/types';

async function fixture(bytes = 'synthetic camera photo') {
  const identity = { ownerUid: crypto.randomUUID(), connectionId: crypto.randomUUID() };
  const photo: CapturedPhoto = { id: crypto.randomUUID(), dataUrl: `data:image/webp;base64,${btoa(bytes)}`,
    timestamp: '2026-10-08T00:00:00Z', mode: 'PPT/판서', width: 10, height: 10 };
  const intent = { fileId: photo.id, name: 'camera.webp', capturedAt: String(photo.timestamp),
    connectionId: identity.connectionId, folderPath: ['2026년', '하반기', '10월', '8일 (목)'] };
  let time = Date.now();
  const queue = new UploadQueue(new IndexedDbUploadJobStore(), identity, () => time);
  await saveCapturedPhoto(identity.ownerUid, photo, intent);
  await enqueueCaptures(identity, queue);
  return { identity, photo, intent, queue, tick: () => { time += 301_000; } };
}

test('capture source and intent are persisted together, legacy files are not enrolled', async () => {
  const { identity, photo, queue } = await fixture();
  assert.equal((await captureSource(identity.ownerUid, photo.id))?.dataUrl, photo.dataUrl);
  assert.equal((await captureIntents(identity.ownerUid))[0].fileId, photo.id);
  const old = { ...photo, id: 'legacy' };
  await saveMedia(identity.ownerUid, 'photos', [old]);
  await enqueueCaptures(identity, queue);
  assert.equal((await queue.list()).length, 1);
  await assert.rejects(saveCapturedPhoto(identity.ownerUid, photo, { fileId: photo.id, name: 'other',
    capturedAt: String(photo.timestamp), folderPath: ['wrong'] }));
  assert.equal((await captureIntents(identity.ownerUid))[0].name, 'camera.webp');
});

test('a failed source/intent transaction leaves neither record behind', async () => {
  const uid = crypto.randomUUID();
  const photo = { id: crypto.randomUUID(), dataUrl: 'data:image/webp;base64,YQ==', timestamp: new Date(), mode: '', width: 1, height: 1 };
  // Structured cloning the intent fails AFTER put(photo); the entire transaction must abort.
  const bad = { fileId: photo.id, folderPath: [() => {}] };
  await assert.rejects(saveCapturedPhoto(uid, photo, bad as never));
  assert.equal(await captureSource(uid, photo.id), undefined);
  assert.deepEqual(await captureIntents(uid), []);
});

test('UID, connection generation, and feature-OFF captures stay isolated', async () => {
  const { identity, photo } = await fixture();
  for (const other of [{ ...identity, ownerUid: 'another-user' }, { ...identity, connectionId: 'new-connection' }]) {
    const queue = new UploadQueue(new IndexedDbUploadJobStore(), other);
    await enqueueCaptures(other, queue); assert.deepEqual(await queue.list(), []);
  }
  const uid = crypto.randomUUID();
  await saveCapturedPhoto(uid, photo);
  assert.deepEqual(await captureIntents(uid), []);
  assert.ok(await captureSource(uid, photo.id));
});

async function remoteFixture(f: Awaited<ReturnType<typeof fixture>>) {
  let serial = 0, starts = 0, puts = 0, commits = 0;
  let failCommit = false, interrupt = false, corrupt = false, revoke = false;
  let offset = 0;
  const files = new Map<string, any>();
  const reserved = new Map<string, string>();
  const blob = captureBlob(f.photo.dataUrl);
  const checksum = await sha256(blob);
  let metadata: any;
  const responseFile = () => ({ ...metadata, size: String(blob.size), sha256Checksum: corrupt ? 'bad' : checksum });
  const originalFetch = globalThis.fetch;
  const catalog = {
    status: async () => ({ connected: !revoke, connectionId: f.identity.connectionId }),
    transferToken: async () => ({ accessToken: 'synthetic', ownerHash: 'owner', expiresIn: 3600 }),
    reserveId: async (_connection: string, key: string, candidate: string) => {
      if (!reserved.has(key)) reserved.set(key, candidate); return { id: reserved.get(key) };
    },
    commit: async (file: any) => {
      commits++;
      if (failCommit) { failCommit = false; throw new CatalogError('DRIVE_STORAGE_UNAVAILABLE', true); }
      assert.ok(files.has(file.driveFileId)); return file;
    },
  } as unknown as CloudCatalog;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal((init?.headers as any).Authorization, 'Bearer synthetic');
    if (url.pathname.endsWith('/generateIds')) return Response.json({ ids: [`remote-${++serial}`] });
    if (url.pathname.startsWith('/upload/')) {
      if (init?.method === 'POST') {
        starts++; metadata = JSON.parse(init.body as string);
        assert.equal((await f.queue.list())[0].driveFileId, metadata.id);
        assert.ok(await captureSource(f.identity.ownerUid, f.photo.id));
        return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic' } });
      }
      const range = (init?.headers as any)['Content-Range'];
      if (range.startsWith('bytes */')) return new Response(null, { status: 308, headers: offset ? { Range: `bytes=0-${offset - 1}` } : {} });
      puts++;
      assert.ok(range.startsWith(`bytes ${offset}-`), 'resume must use server-confirmed bytes');
      offset += (init?.body as Blob).size;
      if (interrupt) { interrupt = false; throw new TypeError('synthetic network interruption'); }
      if (offset < blob.size) return new Response(null, { status: 308, headers: { Range: `bytes=0-${offset - 1}` } });
      files.set(metadata.id, responseFile()); return Response.json(responseFile());
    }
    if (init?.method === 'POST') {
      const folder = JSON.parse(init.body as string); files.set(folder.id, folder); return Response.json({ id: folder.id });
    }
    const file = files.get(url.pathname.split('/').at(-1)!);
    return file ? Response.json(file) : new Response(null, { status: 404 });
  };
  return { catalog, stats: () => ({ starts, puts, commits }), restore: () => { globalThis.fetch = originalFetch; },
    failCommit: () => { failCommit = true; }, interrupt: () => { interrupt = true; }, corrupt: () => { corrupt = true; }, revoke: () => { revoke = true; } };
}

test('automatic capture upload verifies, registers, and always retains local photo', async () => {
  const f = await fixture(), remote = await remoteFixture(f);
  try {
    await uploadCapture(f.identity, f.queue, f.photo.id, remote.catalog, new AbortController().signal);
    assert.equal((await f.queue.list())[0].state, 'synced');
    assert.ok(await captureSource(f.identity.ownerUid, f.photo.id));
    assert.deepEqual(remote.stats(), { starts: 1, puts: 1, commits: 1 });
    assert.notEqual(await folderKey(['a', 'b']), await folderKey(['a/b']));
  } finally { remote.restore(); }
});

test('catalog failure recovers without a second upload, including after queue re-open', async () => {
  const f = await fixture(), remote = await remoteFixture(f);
  try {
    remote.failCommit();
    await assert.rejects(uploadCapture(f.identity, f.queue, f.photo.id, remote.catalog, new AbortController().signal));
    assert.equal((await f.queue.list())[0].resumeState, 'registering');
    const queue = new UploadQueue(new IndexedDbUploadJobStore(), f.identity, () => Date.now() + 301_000);
    await uploadCapture(f.identity, queue, f.photo.id, remote.catalog, new AbortController().signal);
    assert.deepEqual(remote.stats(), { starts: 1, puts: 1, commits: 2 });
    assert.equal((await queue.list())[0].state, 'synced');
    assert.ok(await captureSource(f.identity.ownerUid, f.photo.id));
  } finally { remote.restore(); }
});

test('interrupted upload probes a persisted session before resuming the next chunk', async () => {
  const f = await fixture('a'.repeat(5 * 1024 * 1024)), remote = await remoteFixture(f);
  try {
    remote.interrupt();
    await assert.rejects(uploadCapture(f.identity, f.queue, f.photo.id, remote.catalog, new AbortController().signal));
    assert.equal((await f.queue.list())[0].confirmedBytes, 0, 'lost response cannot be guessed');
    f.tick();
    await uploadCapture(f.identity, f.queue, f.photo.id, remote.catalog, new AbortController().signal);
    assert.deepEqual(remote.stats(), { starts: 1, puts: 2, commits: 1 });
    assert.equal((await f.queue.list())[0].state, 'synced');
  } finally { remote.restore(); }
});

test('deleted pending source is cancelled and never sent or recreated', async () => {
  const f = await fixture(), remote = await remoteFixture(f);
  try {
    await updateTrash(f.identity.ownerUid, entries => [...entries, { file: { id: f.photo.id, type: 'photo', name: 'photo', timestamp: String(f.photo.timestamp) }, deletedAt: new Date().toISOString() }]);
    await assert.rejects(uploadCapture(f.identity, f.queue, f.photo.id, remote.catalog, new AbortController().signal));
    assert.equal((await f.queue.list())[0].state, 'cancelled');
    assert.deepEqual(remote.stats(), { starts: 0, puts: 0, commits: 0 });
    assert.equal(await captureSource(f.identity.ownerUid, f.photo.id), undefined);
  } finally { remote.restore(); }
});

test('checksum mismatch and changed connection cannot register a photo', async () => {
  for (const cause of ['corrupt', 'revoke'] as const) {
    const f = await fixture(), remote = await remoteFixture(f);
    try {
      remote[cause]();
      await assert.rejects(uploadCapture(f.identity, f.queue, f.photo.id, remote.catalog, new AbortController().signal));
      assert.equal((await f.queue.list())[0].state, cause === 'revoke' ? 'needs_auth' : 'failed');
      assert.equal(remote.stats().commits, 0);
      assert.ok(await captureSource(f.identity.ownerUid, f.photo.id));
    } finally { remote.restore(); }
  }
});
