import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, set } from 'idb-keyval';
import { uploadPhoto, pendingPhoto, sha256, openPhoto } from '../src/services/drive/photoTrial';
import type { CloudCatalog } from '../src/services/drive/cloudCatalog';
import type { CloudMediaRecord } from '../src/services/drive/types';

test('a new photo is uploaded directly, verified, and only then committed', async () => {
  const blob = new Blob(['new image'], { type: 'image/png' });
  const checksum = await sha256(blob);
  const key = 'new-upload';
  await set(key, { id: 'new-id', blob, name: 'new.png', capturedAt: '2026-10-08T00:00:00Z' },
    createStore('lecturebag-drive-photo-trial', 'photos'));
  let sent = false;
  const catalog = {
    transferToken: async () => ({ accessToken: 'synthetic', expiresIn: 3600, ownerHash: 'owner' }),
    reserveId: async (_connection: string, folder: string) => ({ id: folder }),
    commit: async (record: object) => { assert.ok(sent); return record; },
  } as unknown as CloudCatalog;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic');
    if (init?.method === 'PUT') {
      sent = true; assert.equal(await (init.body as Blob).text(), 'new image');
      return Response.json({ id: 'new-remote', size: String(blob.size), mimeType: blob.type, sha256Checksum: checksum });
    }
    if (url.pathname.startsWith('/upload/')) {
      assert.equal(JSON.parse(init?.body as string).id, 'new-remote');
      assert.equal((await pendingPhoto(key))?.driveId, 'new-remote');
      return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic' } });
    }
    const id = url.pathname.split('/').at(-1)!;
    if (id === 'generateIds') return Response.json({ ids: ['new-remote'] });
    if (id === 'new-remote') return new Response(null, { status: 404 });
    return Response.json({ id, mimeType: 'application/vnd.google-apps.folder', appProperties: {
      lecturebagConnectionId: 'connection', lecturebagOwner: 'owner', lecturebagFolderId: id,
    } });
  };
  try {
    await uploadPhoto(key, catalog, 'connection', new AbortController().signal, () => {});
    assert.ok(sent); assert.equal(await pendingPhoto(key), undefined);
  } finally { globalThis.fetch = original; }
});

test('registration retry preserves source and reuses an already uploaded Drive original', async () => {
  const blob = new Blob(['photo bytes'], { type: 'image/png' });
  const checksum = await sha256(blob);
  const key = 'registration-retry';
  await set(key, { id: 'photo-id', driveId: 'remote-photo', blob, name: 'photo.png', capturedAt: '2026-10-08T00:00:00Z' },
    createStore('lecturebag-drive-photo-trial', 'photos'));
  let commits = 0;
  const catalog = {
    transferToken: async () => ({ accessToken: 'synthetic', expiresIn: 3600, ownerHash: 'owner' }),
    reserveId: async (_connection: string, folder: string) => ({ id: folder }),
    commit: async (record: object) => { if (++commits === 1) throw new Error('catalog unavailable'); return record; },
  } as unknown as CloudCatalog;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.notEqual(init?.method, 'POST', 'completed files and folders must not be created again');
    const url = new URL(String(input));
    const id = url.pathname.split('/').at(-1)!;
    if (id === 'generateIds') return Response.json({ ids: ['candidate'] });
    if (id === 'remote-photo') return Response.json({ id, size: String(blob.size), mimeType: blob.type, sha256Checksum: checksum });
    return Response.json({ id, mimeType: 'application/vnd.google-apps.folder', appProperties: {
      lecturebagConnectionId: 'connection', lecturebagOwner: 'owner', lecturebagFolderId: id,
    } });
  };
  try {
    await assert.rejects(uploadPhoto(key, catalog, 'connection', new AbortController().signal, () => {}), /catalog unavailable/);
    assert.ok(await pendingPhoto(key), 'registration failure must retain the original');
    await uploadPhoto(key, catalog, 'connection', new AbortController().signal, () => {});
    assert.equal(await pendingPhoto(key), undefined);
    assert.equal(commits, 2);
  } finally { globalThis.fetch = original; }
});

test('opening a remote photo rejects altered content even when byte counts match', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('wrong');
  const catalog = { transferToken: async () => ({ accessToken: 'synthetic', expiresIn: 3600 }) } as unknown as CloudCatalog;
  const record = { connectionId: 'connection', kind: 'photo', driveFileId: 'remote', sizeBytes: 5,
    mimeType: 'image/png', checksumAlgorithm: 'sha256', checksum: await sha256(new Blob(['right'])) } as CloudMediaRecord;
  try { await assert.rejects(openPhoto(catalog, 'connection', record, new AbortController().signal), /버전과 다릅니다/); }
  finally { globalThis.fetch = original; }
});
