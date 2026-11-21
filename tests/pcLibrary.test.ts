import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PcLibraryStore } from '../src/services/drive/pcLibrary';
import { scanPcLibrary, scanRegisteredLibrary, syncPcLibrary } from '../src/services/drive/pcSync';
import { DriveClient, DriveRangeUnavailable } from '../src/services/drive/driveClient';
import { sha256 } from '../src/services/drive/photoTrial';
import type { CloudMediaRecord } from '../src/services/drive/types';
import type { CloudCatalog } from '../src/services/drive/cloudCatalog';
import type { CloudBrowser } from '../src/services/drive/cloudBrowser';

async function fixture() {
  const store = new PcLibraryStore(), uid = crypto.randomUUID();
  const state = await store.configure(uid, { connected: true, connectionId: 'conn', revision: 1 }, true);
  const blob = new Blob(['original-photo'], { type: 'image/png' });
  const file: CloudMediaRecord = { ownerUid: uid, connectionId: 'conn', id: 'photo', driveFileId: 'remote', driveParentId: 'root', logicalFolderId: 'root',
    name: 'photo.png', kind: 'photo', mimeType: blob.type, sizeBytes: blob.size, revision: 1, capturedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checksumAlgorithm: 'sha256', checksum: await sha256(blob) };
  await store.snapshot(state, [{ id: 'root', logicalFolderId: 'root', name: 'LectureBag' }], [file]);
  return { store, state, file, blob, uid };
}
test('registered bootstrap reads pages instead of traversing 50 separate Drive folders', async () => {
  const f = await fixture(); let calls = 0;
  const records = Array.from({ length: 50 }, (_, i) => ({ ...f.file, id: `file-${i}`, driveParentId: `folder-${i}`, logicalFolderId: `logical-${i}` }));
  const catalog = { assertOwner: (uid: string) => assert.equal(uid, f.uid),
    inventory: async () => { calls++; return { files: records, nextCursor: null }; } } as unknown as CloudCatalog;
  const result = await scanRegisteredLibrary(catalog, f.state, new AbortController().signal);
  assert.equal(calls, 1); assert.equal(result.files.length, 50);
  records[0] = { ...records[0], ownerUid: 'foreign' };
  await assert.rejects(scanRegisteredLibrary(catalog, f.state, new AbortController().signal));
});

test('registered bootstrap includes empty cursor pages, rejects repeated cursors, and excludes trash', async () => {
  const f = await fixture(); let repeat = false;
  const catalog = { assertOwner() {}, inventory: async (_conn: string, cursor?: string) => cursor
    ? { files: [{ ...f.file, deletedAt: new Date().toISOString() }], nextCursor: repeat ? 'next' : null }
    : { files: [], nextCursor: 'next' } } as unknown as CloudCatalog;
  assert.equal((await scanRegisteredLibrary(catalog, f.state, new AbortController().signal)).files.length, 0);
  repeat = true; await assert.rejects(scanRegisteredLibrary(catalog, f.state, new AbortController().signal));
});
test('PC original survives store reopen/pause with no network; identities and versions stay isolated', async () => {
  const f = await fixture(); await f.store.commit(f.state, f.file, f.blob);
  await f.store.pause(f.uid);
  const reopened = new PcLibraryStore();
  assert.equal(await (await reopened.read(f.file))?.text(), 'original-photo');
  assert.equal(await reopened.read({ ...f.file, ownerUid: 'other' }), undefined);
  assert.equal(await reopened.read({ ...f.file, connectionId: 'other' }), undefined);
  assert.equal(await reopened.read({ ...f.file, revision: 2 }), undefined);
  await assert.rejects(f.store.commit(f.state, f.file, f.blob), 'paused generation fences delayed response');
  await f.store.pause(f.uid, true); assert.equal(await reopened.read(f.file), undefined);
});
test('durable chunks resume at committed offset, reject gaps, and are not readable until verification', async () => {
  const f = await fixture(); await f.store.append(f.state, f.file, 0, f.blob.slice(0, 4));
  assert.equal(await f.store.read(f.file), undefined);
  const reopened = new PcLibraryStore(); assert.equal((await reopened.partial(f.file)).offset, 4);
  await assert.rejects(reopened.append(f.state, f.file, 0, f.blob.slice(4)));
  await reopened.append(f.state, f.file, 4, f.blob.slice(4));
  const blob = await reopened.assembled(f.file); assert.equal(await blob.text(), await f.blob.text());
  await reopened.commit(f.state, f.file, blob);
  assert.equal((await reopened.partial(f.file)).offset, 0);
  assert.equal(await (await reopened.read(f.file))?.text(), await f.blob.text());
});
test('checksum mismatch cannot receive a stored receipt; stale writes cannot cross connections', async () => {
  const f = await fixture();
  await f.store.append(f.state, f.file, 0, new Blob(['bad']));
  await assert.rejects(f.store.commit(f.state, f.file, new Blob(['wrong contents'])));
  assert.equal((await f.store.partial(f.file)).offset, 0, 'corrupt fragments must not poison every retry');
  assert.equal(await f.store.read(f.file), undefined);
  await f.store.configure(f.uid, { connected: true, connectionId: 'new', revision: 2 }, true);
  await assert.rejects(f.store.append(f.state, f.file, 0, f.blob));
  await assert.rejects(f.store.snapshot(f.state, [], []));
});
test('unavailable or removed listing does not expose an old original; no automatic source deletion', async () => {
  const f = await fixture(); await f.store.commit(f.state, f.file, f.blob);
  await f.store.unavailable(f.state, f.file.id); assert.equal(await f.store.read(f.file), undefined);
  await f.store.snapshot(f.state, [], []); assert.equal(await f.store.read(f.file), undefined);
  await f.store.snapshot(f.state, [], [f.file]); assert.equal(await f.store.read(f.file), undefined, 'a rescan must not undo known access loss');
  await f.store.commit(f.state, f.file, f.blob); assert.equal(await (await f.store.read(f.file))?.text(), await f.blob.text());
});
test('range transport validates status, byte range, total and payload before acknowledging', async () => {
  let headers: Record<string, string>;
  const client = new DriveClient(async () => 'secret', async (_url, init) => {
    headers = init!.headers as Record<string, string>;
    return new Response('tail', { status: 206, headers: { 'Content-Range': 'bytes 4-7/8' } });
  });
  const r = await client.downloadRange('id', 4, 8, new AbortController().signal);
  assert.equal(await r.blob.text(), 'tail'); assert.equal(r.full, false);
  assert.equal(headers!.Range, 'bytes=4-7'); assert.equal(headers!.Authorization, 'Bearer secret');
  const bad = new DriveClient(async () => 'token', async () => new Response('tail', { status: 206 }));
  await assert.rejects(bad.downloadRange('id', 4, 8, new AbortController().signal), DriveRangeUnavailable);
  const short = new DriveClient(async () => 'token', async () => new Response('x', { status: 206, headers: { 'Content-Range': 'bytes 4-7/8' } }));
  await assert.rejects(short.downloadRange('id', 4, 8, new AbortController().signal));
  const ignored = new DriveClient(async () => 'token', async () => new Response('12345678'));
  assert.equal((await ignored.downloadRange('id', 4, 8, new AbortController().signal)).full, true);
});
test('catalog scan consumes all pages including empty pages and detects repeated cursors', async () => {
  const f = await fixture(); const calls: Array<string | undefined> = [];
  const browser = { root: async () => ({ id: 'root', logicalFolderId: 'root', name: 'root' }), folders: async () => ({ folders: [] }),
    files: async (_folder: unknown, cursor?: string) => { calls.push(cursor); return cursor ? { files: [f.file], nextCursor: null } : { files: [], nextCursor: 'next' }; } } as unknown as CloudBrowser;
  assert.equal((await scanPcLibrary(browser, new AbortController().signal)).files.length, 1); assert.deepEqual(calls, [undefined, 'next']);
  browser.files = async () => ({ files: [], nextCursor: 'repeat' });
  await assert.rejects(scanPcLibrary(browser, new AbortController().signal));
});
test('change page atomically saves listing and cursor before bytes; rejects foreign, gapped and stale pages', async () => {
  const f = await fixture(), zero = { cursor: 'zero', sequence: 0 };
  await f.store.snapshot(f.state, [], [], zero);
  const page = { cursor: 'one', sequence: 1, hasMore: false, changes: [{ sequence: 1, file: f.file }] };
  for (const invalid of [
    { ...page, changes: [{ sequence: 2, file: f.file }] },
    { ...page, changes: [{ sequence: 1, file: { ...f.file, ownerUid: 'other' } }] },
    { ...page, changes: [{ sequence: 1, file: { ...f.file, connectionId: 'other' } }] },
    { ...page, sequence: 2 },
  ]) {
    await assert.rejects(f.store.applyChanges(f.state, zero, invalid));
    assert.deepEqual((await f.store.state(f.uid))?.syncCursor, zero);
    assert.equal((await f.store.state(f.uid))?.files.length, 0);
  }
  await f.store.applyChanges(f.state, zero, page);
  const reopened = new PcLibraryStore();
  assert.equal((await reopened.state(f.uid))?.files.length, 1);
  assert.equal((await reopened.state(f.uid))?.syncCursor?.cursor, 'one');
  assert.equal(await reopened.read(f.file), undefined, 'metadata is visible but no completed byte receipt yet');
  await assert.rejects(reopened.applyChanges(f.state, zero, page), 'duplicate old response cannot overwrite newer cursor');
  await reopened.pause(f.uid, true);
  await assert.rejects(reopened.applyChanges(f.state, { cursor: 'one', sequence: 1 }, { cursor: 'two', sequence: 2, hasMore: false, changes: [{ sequence: 2, file: f.file }] }));
});

test('bootstrap takes head before scan and replays racing registrations; subsequent sync never rescans', async () => {
  const f = await fixture(); let scans = 0, headTaken = false, changesTaken = false;
  // Unsupported document keeps this test focused on metadata, with no transfer token.
  const file = { ...f.file, kind: 'document' as const, mimeType: 'text/plain' };
  const catalog = {
    assertOwner: () => {}, status: async () => ({ connected: true, connectionId: 'conn' }),
    syncHead: async () => { headTaken = true; return { cursor: 'zero', sequence: 0 }; },
    inventory: async () => { assert.ok(headTaken); scans++; return { files: [], nextCursor: null }; },
    changes: async (_conn: string, cursor: string) => {
      changesTaken = true;
      return cursor === 'zero' ? { cursor: 'one', sequence: 1, hasMore: false, changes: [{ sequence: 1, file }] }
        : { cursor: 'one', sequence: 1, hasMore: false, changes: [] };
    },
    transferToken: async () => ({ accessToken: 'secret', ownerHash: 'a'.repeat(64), expiresIn: 3600 }),
  } as unknown as CloudCatalog;
  const previous = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    return Response.json({ files: url.searchParams.get('q')!.includes("value='root'") ? [{ id: 'root', name: 'root', ownedByMe: true, mimeType: 'application/vnd.google-apps.folder', appProperties: { lecturebagFolderId: 'root', lecturebagOwner: 'a'.repeat(64), lecturebagConnectionId: 'conn' } }] : [] });
  };
  try {
    await syncPcLibrary(catalog, f.state, f.store, new AbortController().signal, () => {}, async () => {});
    assert.ok(changesTaken); assert.equal((await f.store.state(f.uid))?.files[0].id, f.file.id);
    const initialScans = scans;
    globalThis.fetch = async () => { throw new Error('incremental idle pass must not query Drive'); };
    await syncPcLibrary(catalog, f.state, f.store, new AbortController().signal, () => {}, async () => {});
    assert.equal(scans, initialScans);
  } finally { globalThis.fetch = previous; }
});

test('catch-up preserves each completed page when later request fails, then resumes from persisted cursor', async () => {
  const f = await fixture(), zero = { cursor: 'zero', sequence: 0 };
  await f.store.snapshot(f.state, [], [], zero);
  const doc = { ...f.file, kind: 'document' as const, mimeType: 'text/plain' };
  let fail = true; const cursors: string[] = [];
  const catalog = { assertOwner: () => {}, status: async () => ({ connected: true, connectionId: 'conn' }),
    changes: async (_conn: string, cursor: string) => {
      cursors.push(cursor);
      if (cursor === 'zero') return { cursor: 'one', sequence: 1, hasMore: true, changes: [{ sequence: 1, file: doc }] };
      if (fail) throw Error('network interrupted');
      return { cursor: 'two', sequence: 2, hasMore: false, changes: [{ sequence: 2, file: { ...doc, id: 'second' } }] };
    },
  } as unknown as CloudCatalog;
  await assert.rejects(syncPcLibrary(catalog, f.state, f.store, new AbortController().signal, () => {}, async () => {}));
  assert.equal((await f.store.state(f.uid))?.syncCursor?.sequence, 1);
  fail = false;
  await syncPcLibrary(catalog, f.state, new PcLibraryStore(), new AbortController().signal, () => {}, async () => {});
  assert.deepEqual(cursors, ['zero', 'one', 'one']);
  assert.equal((await f.store.state(f.uid))?.files.length, 2);
});
test('sync verifies once downloaded, skips unchanged bytes, and preserves list on failed scan', async () => {
  const f = await fixture(); let downloads = 0, failScan = false, denied = false;
  const catalog = { assertOwner: (uid: string) => assert.equal(uid, f.uid), status: async () => ({ connected: true, connectionId: 'conn' }),
    syncHead: async () => ({ cursor: 'zero', sequence: 0 }), changes: async () => ({ cursor: 'zero', sequence: 0, changes: [], hasMore: false }),
    inventory: async () => { if (failScan) throw Error('offline'); return { files: [f.file], nextCursor: null }; },
    transferToken: async () => ({ accessToken: 'secret', ownerHash: 'a'.repeat(64), expiresIn: 3600 }) } as unknown as CloudCatalog;
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer secret');
    if (url.pathname.endsWith('/files')) return Response.json({ files: url.searchParams.get('q')!.includes("value='root'") ? [{ id: 'root', name: 'root', ownedByMe: true, mimeType: 'application/vnd.google-apps.folder', appProperties: { lecturebagFolderId: 'root', lecturebagOwner: 'a'.repeat(64), lecturebagConnectionId: 'conn' } }] : [] });
    if (url.searchParams.get('alt') === 'media') { downloads++; return new Response(f.blob); }
    if (denied) return Response.json({ error: { errors: [{ reason: 'insufficientFilePermissions' }] } }, { status: 403 });
    return Response.json({ id: f.file.driveFileId, size: String(f.file.sizeBytes), mimeType: f.file.mimeType, sha256Checksum: f.file.checksum, ownedByMe: true, parents: ['root'], appProperties: { lecturebagConnectionId: 'conn', lecturebagOwner: 'a'.repeat(64), lecturebagFileId: f.file.id } });
  };
  try {
    for (let i=0;i<2;i++) await syncPcLibrary(catalog, f.state, f.store, new AbortController().signal, () => {}, async () => {});
    assert.equal(downloads, 1); assert.ok(await f.store.read(f.file));
    failScan = true;
    await assert.rejects(syncPcLibrary(catalog, f.state, f.store, new AbortController().signal, () => {}, async () => {}, { fullScan: true }));
    assert.equal((await f.store.state(f.uid))?.files.length, 1); assert.ok(await f.store.read(f.file));
    failScan = false; denied = true;
    await syncPcLibrary(catalog, f.state, f.store, new AbortController().signal, () => {}, async () => {}, { fullScan: true });
    assert.equal(await f.store.read(f.file), undefined, 'known 403 must block a previously stored copy');
    assert.equal(downloads, 1);
  } finally { globalThis.fetch = previous; }
});

test('interrupted PC transfer resumes committed ranges after store reopen and verifies complete original', async () => {
  const f = await fixture(), unit = 4 * 1024 * 1024;
  const blob = new Blob([new Uint8Array(unit + 123).fill(42)], { type: 'image/png' });
  const file = { ...f.file, sizeBytes: blob.size, checksum: await sha256(blob) };
  const ranges: string[] = []; let interrupt = true;
  const catalog = { assertOwner: (uid: string) => assert.equal(uid, f.uid), status: async () => ({ connected: true, connectionId: 'conn' }),
    syncHead: async () => ({ cursor: 'zero', sequence: 0 }), changes: async () => ({ cursor: 'zero', sequence: 0, changes: [], hasMore: false }),
    inventory: async () => ({ files: [file], nextCursor: null }),
    transferToken: async () => ({ accessToken: 'secret', ownerHash: 'a'.repeat(64), expiresIn: 3600 }) } as unknown as CloudCatalog;
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/files')) return Response.json({ files: url.searchParams.get('q')!.includes("value='root'") ? [{ id: 'root', name: 'root', ownedByMe: true, mimeType: 'application/vnd.google-apps.folder', appProperties: { lecturebagFolderId: 'root', lecturebagOwner: 'a'.repeat(64), lecturebagConnectionId: 'conn' } }] : [] });
    if (url.searchParams.get('alt') === 'media') {
      const range = (init!.headers as Record<string,string>).Range; ranges.push(range);
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
      if (Number(start) > 0 && interrupt) throw new TypeError('network interrupted');
      return new Response(blob.slice(Number(start), Number(end) + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${blob.size}` } });
    }
    return Response.json({ id: file.driveFileId, size: String(file.sizeBytes), mimeType: file.mimeType, sha256Checksum: file.checksum, ownedByMe: true, parents: ['root'], appProperties: { lecturebagConnectionId: 'conn', lecturebagOwner: 'a'.repeat(64), lecturebagFileId: file.id } });
  };
  try {
    await assert.rejects(syncPcLibrary(catalog, f.state, f.store, new AbortController().signal, () => {}, async () => {}));
    const reopened = new PcLibraryStore(); assert.equal((await reopened.partial(file)).offset, unit);
    assert.equal(await reopened.read(file), undefined);
    interrupt = false;
    await syncPcLibrary(catalog, f.state, reopened, new AbortController().signal, () => {}, async () => {});
    assert.deepEqual(ranges, [`bytes=0-${unit - 1}`, `bytes=${unit}-${blob.size - 1}`, `bytes=${unit}-${blob.size - 1}`]);
    assert.equal(await sha256((await reopened.read(file))!), file.checksum);
  } finally { globalThis.fetch = previous; }
});
