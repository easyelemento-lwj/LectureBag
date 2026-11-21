import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudBrowser } from '../src/services/drive/cloudBrowser';
import { CloudCatalog } from '../src/services/drive/cloudCatalog';
import { DriveClient } from '../src/services/drive/driveClient';

const ownerHash = 'a'.repeat(64);
const remoteFolder = (id = 'folder', parent = 'root-id') => ({ id, name: '2026년',
  mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, parents: [parent],
  appProperties: { lecturebagFolderId: id, lecturebagConnectionId: 'connection', lecturebagOwner: ownerHash } });

test('Drive folder discovery is bounded, scoped to owner/connection/parent and authenticated by header', async () => {
  const client = new DriveClient(async () => 'secret', async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('pageSize'), '50');
    assert.equal(url.searchParams.get('pageToken'), 'page-2');
    for (const term of ["trashed = false", "'me' in owners", "'root-id' in parents", 'lecturebagConnectionId', 'lecturebagOwner']) {
      assert.ok(url.searchParams.get('q')?.includes(term));
    }
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer secret');
    return Response.json({ files: [remoteFolder()], nextPageToken: 'page-3' });
  });
  assert.deepEqual(await client.folders('connection', ownerHash, 'root-id', 'page-2'), {
    folders: [{ id: 'folder', name: '2026년', logicalFolderId: 'folder' }], nextPageToken: 'page-3',
  });
  await assert.rejects(client.folders('connection', ownerHash, "bad' or trashed=true"));
});

test('folder results reject foreign connections, parents, trash and incomplete results', async () => {
  for (const file of [
    { ...remoteFolder(), ownedByMe: false }, { ...remoteFolder(), trashed: true },
    { ...remoteFolder(), parents: ['other'] },
    { ...remoteFolder(), appProperties: { ...remoteFolder().appProperties, lecturebagConnectionId: 'other' } },
  ]) {
    const client = new DriveClient(async () => 'secret', async () => Response.json({ files: [file] }));
    await assert.rejects(client.folders('connection', ownerHash, 'root-id'));
  }
  await assert.rejects(new DriveClient(async () => 'secret', async () => Response.json({ incompleteSearch: true }))
    .folders('connection', ownerHash, 'root-id'));
});

test('root discovery follows empty continuation pages without scanning all files', async () => {
  const catalog = { assertOwner() {}, status: async () => ({ connected: true, connectionId: 'connection' }),
    transferToken: async () => ({ accessToken: 'secret', ownerHash, expiresIn: 3600 }) } as unknown as CloudCatalog;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.ok(url.searchParams.get('q')?.includes("value='root'"));
    if (++calls === 1) return Response.json({ files: [], nextPageToken: 'next' });
    const file = remoteFolder('root-id'); file.appProperties.lecturebagFolderId = 'root';
    return Response.json({ files: [file] });
  };
  try {
    const root = await new CloudBrowser(catalog, { ownerUid: 'alice', connectionId: 'connection' }).root(new AbortController().signal);
    assert.equal(root?.id, 'root-id'); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('catalog pages remain bound to user, connection, folder and live records', async () => {
  const valid = { id: 'file', ownerUid: 'alice', connectionId: 'connection', logicalFolderId: 'folder', driveParentId: 'parent' };
  let files = [valid]; let cursor: string | undefined;
  const catalog = { assertOwner() {}, status: async () => ({ connected: true, connectionId: 'connection' }),
    list: async (_folder: string, next?: string) => { cursor = next; return { files, nextCursor: 'next' }; } } as unknown as CloudCatalog;
  const browser = new CloudBrowser(catalog, { ownerUid: 'alice', connectionId: 'connection' });
  const folder = { id: 'parent', logicalFolderId: 'folder', name: 'day' };
  assert.equal((await browser.files(folder, 'previous', new AbortController().signal)).files.length, 1);
  assert.equal(cursor, 'previous');
  for (const change of [{ ownerUid: 'bob' }, { connectionId: 'other' }, { driveParentId: 'other' }, { deletedAt: 'now' }]) {
    files = [{ ...valid, ...change }];
    await assert.rejects(browser.files(folder, undefined, new AbortController().signal));
  }
});

test('repeated root page tokens fail boundedly instead of looping or creating a new root', async () => {
  const catalog = { assertOwner() {}, status: async () => ({ connected: true, connectionId: 'connection' }),
    transferToken: async () => ({ accessToken: 'secret', ownerHash, expiresIn: 3600 }) } as unknown as CloudCatalog;
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++; assert.notEqual(init?.method, 'POST'); return Response.json({ files: [], nextPageToken: 'same' });
  };
  try {
    await assert.rejects(new CloudBrowser(catalog, { ownerUid: 'alice', connectionId: 'connection' }).root(new AbortController().signal));
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
