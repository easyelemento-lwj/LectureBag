import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { set, createStore } from 'idb-keyval';
import { MediaResolver, supportedMedia } from '../src/services/drive/mediaResolver';
import { DownloadCache, downloadKey } from '../src/services/drive/downloadCache';
import { CloudCatalog } from '../src/services/drive/cloudCatalog';
import { sha256 } from '../src/services/drive/photoTrial';
import { saveCapturedPhoto, captureSource } from '../src/utils/mediaStorage';
import type { CloudMediaRecord } from '../src/services/drive/types';
import type { CapturedPhoto } from '../src/types';

async function fixture(mime = 'image/png') {
  const blob = new Blob(['photo'], { type: mime });
  const record: CloudMediaRecord = { id: crypto.randomUUID(), ownerUid: 'alice', connectionId: 'connection',
    driveFileId: 'drive-id', driveParentId: 'parent', logicalFolderId: 'folder', name: 'photo.png', kind: mime.startsWith('audio/') ? 'audio' : 'photo',
    mimeType: blob.type, sizeBytes: blob.size, checksum: await sha256(blob), checksumAlgorithm: 'sha256',
    capturedAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', revision: 1 };
  let uid = 'alice', connected = true, downloads = 0, metadataReads = 0;
  let remote = { id: record.driveFileId, size: String(blob.size), mimeType: blob.type, sha256Checksum: record.checksum,
    ownedByMe: true, parents: ['parent'], appProperties: { lecturebagFileId: record.id,
      lecturebagConnectionId: record.connectionId, lecturebagOwner: 'a'.repeat(64) } };
  const catalog = { assertOwner: (owner: string) => { if (owner !== uid) throw new Error('account changed'); },
    status: async () => ({ connected, connectionId: 'connection' }),
    transferToken: async () => ({ accessToken: 'secret', ownerHash: 'a'.repeat(64), expiresIn: 3600 }) } as unknown as CloudCatalog;
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer secret');
    const url = new URL(String(input));
    if (url.searchParams.get('alt') === 'media') { downloads++; return new Response(blob); }
    metadataReads++; return Response.json(remote);
  };
  return { blob, record, catalog, fetcher, stats: () => ({ downloads, metadataReads }),
    changeUser: () => { uid = 'bob'; }, disconnect: () => { connected = false; },
    changeRemote: (change: Partial<typeof remote>) => { remote = { ...remote, ...change }; } };
}

test('second open uses a verified versioned cache while still checking remote metadata', async () => {
  const f = await fixture(), previous = globalThis.fetch; globalThis.fetch = f.fetcher;
  try {
    const resolver = new MediaResolver(f.catalog, f.record);
    assert.equal((await resolver.photo(f.record, new AbortController().signal)).source, 'download');
    assert.equal((await resolver.photo(f.record, new AbortController().signal)).source, 'cache');
    assert.deepEqual(f.stats(), { downloads: 1, metadataReads: 2 });
    f.changeRemote({ sha256Checksum: 'b'.repeat(64) });
    await assert.rejects(resolver.photo(f.record, new AbortController().signal));
    assert.equal(f.stats().downloads, 1, 'stale cached content must not be returned');
  } finally { globalThis.fetch = previous; }
});

test('audio uses bounded authenticated full download and verified cache, not a public audio URL', async () => {
  const f = await fixture('audio/mp4'), previous = globalThis.fetch; globalThis.fetch = f.fetcher;
  try {
    const resolver = new MediaResolver(f.catalog, f.record), signal = new AbortController().signal;
    const first = await resolver.media(f.record, signal);
    assert.equal(first.blob.type, 'audio/mp4'); assert.equal(first.source, 'download');
    assert.equal((await resolver.media(f.record, signal)).source, 'cache');
    assert.equal(f.stats().downloads, 1);
    assert.equal(supportedMedia({ ...f.record, sizeBytes: 100 * 1024 * 1024 + 1 }), false);
    assert.equal(supportedMedia({ ...f.record, mimeType: 'audio/unknown' }), false);
    f.changeRemote({ sha256Checksum: 'b'.repeat(64) });
    await assert.rejects(resolver.media(f.record, signal));
  } finally { globalThis.fetch = previous; }
});

test('local original with matching bytes avoids downloading and remains intact', async () => {
  const f = await fixture(), previous = globalThis.fetch; globalThis.fetch = f.fetcher;
  await saveCapturedPhoto('alice', { id: f.record.id, dataUrl: 'data:image/png;base64,cGhvdG8=' } as CapturedPhoto);
  try {
    assert.equal((await new MediaResolver(f.catalog, f.record).photo(f.record, new AbortController().signal)).source, 'local');
    assert.equal(f.stats().downloads, 0);
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(new MediaResolver(f.catalog, f.record).photo(f.record, new AbortController().signal));
    assert.ok(await captureSource('alice', f.record.id), '404 must not delete local originals');
  } finally { globalThis.fetch = previous; }
});

test('cache keys isolate accounts, connections and versions; LRU only evicts disposable cache', async () => {
  const f = await fixture();
  const cache = new DownloadCache(10);
  await cache.write(f.record, f.blob);
  for (const change of [{ ownerUid: 'bob' }, { connectionId: 'other' }, { revision: 2 }, { driveFileId: 'other' }, { checksum: 'b'.repeat(64) }]) {
    assert.equal(await cache.read({ ...f.record, ...change }), undefined);
  }
  const second = { ...f.record, id: crypto.randomUUID() }, third = { ...f.record, id: crypto.randomUUID() };
  await cache.write(second, f.blob); await cache.write(third, f.blob);
  assert.equal(await cache.read(f.record), undefined);
  assert.ok(await cache.read(second)); assert.ok(await cache.read(third));
  const next = { ...third, revision: 2 };
  await cache.write(next, f.blob);
  assert.equal(await cache.read(third), undefined); assert.ok(await cache.read(next));
});

test('corrupt cache is replaced and cache quota failure does not prevent viewing', async () => {
  const f = await fixture(), previous = globalThis.fetch; globalThis.fetch = f.fetcher;
  await set(downloadKey(f.record), { key: downloadKey(f.record), fileKey: JSON.stringify(['alice', 'connection', f.record.id]),
    blob: new Blob(['wrong']), lastAccess: 0 }, createStore('lecturebag-drive-download-cache', 'photos'));
  try {
    assert.equal((await new MediaResolver(f.catalog, f.record).photo(f.record, new AbortController().signal)).source, 'download');
    const cache = { read: async () => undefined, write: async () => { throw new Error('quota'); } } as unknown as DownloadCache;
    const result = await new MediaResolver(f.catalog, f.record, cache).photo(f.record, new AbortController().signal);
    assert.equal(result.cacheSaved, false); assert.equal(await result.blob.text(), 'photo');
  } finally { globalThis.fetch = previous; }
});

test('changed account, disconnected generation, deleted records and cancellation never reveal cache', async () => {
  const f = await fixture(), previous = globalThis.fetch; globalThis.fetch = f.fetcher;
  try {
    const resolver = new MediaResolver(f.catalog, f.record);
    await resolver.photo(f.record, new AbortController().signal);
    for (const change of [{ ownerUid: 'bob' }, { connectionId: 'other' }, { deletedAt: 'now' }, { purgedAt: 'now' }]) {
      await assert.rejects(resolver.photo({ ...f.record, ...change }, new AbortController().signal));
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(resolver.photo(f.record, controller.signal));
    f.disconnect(); await assert.rejects(resolver.photo(f.record, new AbortController().signal));
    f.changeUser(); await assert.rejects(resolver.photo(f.record, new AbortController().signal));
    assert.equal(f.stats().downloads, 1);
  } finally { globalThis.fetch = previous; }
});

test('late download after account switch or oversized/mismatched bytes is rejected', async () => {
  const f = await fixture(), previous = globalThis.fetch;
  try {
    for (const body of ['wrong', 'photo larger than catalog']) {
      globalThis.fetch = async (input, init) => new URL(String(input)).searchParams.has('alt') ? new Response(body) : f.fetcher(input, init);
      await assert.rejects(new MediaResolver(f.catalog, f.record).photo(f.record, new AbortController().signal));
    }
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).searchParams.has('alt')) { f.changeUser(); return new Response(f.blob); }
      return f.fetcher(input, init);
    };
    await assert.rejects(new MediaResolver(f.catalog, f.record).photo(f.record, new AbortController().signal));
    assert.equal(await new DownloadCache().read(f.record), undefined);
  } finally { globalThis.fetch = previous; }
});

test('a new catalog version downloads once and replaces only its old cached version', async () => {
  const f = await fixture(), previous = globalThis.fetch; globalThis.fetch = f.fetcher;
  try {
    const resolver = new MediaResolver(f.catalog, f.record);
    await resolver.photo(f.record, new AbortController().signal);
    const bytes = new Blob(['new photo'], { type: 'image/png' });
    const updated = { ...f.record, revision: 2, sizeBytes: bytes.size, checksum: await sha256(bytes) };
    f.changeRemote({ size: String(bytes.size), sha256Checksum: updated.checksum });
    let reads = 0;
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).searchParams.has('alt')) { reads++; return new Response(bytes); }
      return f.fetcher(input, init);
    };
    const result = await resolver.photo(updated, new AbortController().signal);
    assert.equal(result.source, 'download'); assert.equal(await result.blob.text(), 'new photo');
    assert.equal((await resolver.photo(updated, new AbortController().signal)).source, 'cache');
    assert.equal(reads, 1); assert.equal(await new DownloadCache().read(f.record), undefined);
  } finally { globalThis.fetch = previous; }
});

test('disconnect during a cache hit prevents the cached image from being returned', async () => {
  const f = await fixture(), previous = globalThis.fetch; globalThis.fetch = f.fetcher;
  try {
    const resolver = new MediaResolver(f.catalog, f.record);
    await resolver.photo(f.record, new AbortController().signal);
    globalThis.fetch = async (input, init) => { const response = await f.fetcher(input, init); f.disconnect(); return response; };
    await assert.rejects(resolver.photo(f.record, new AbortController().signal));
    assert.equal(f.stats().downloads, 1);
  } finally { globalThis.fetch = previous; }
});
