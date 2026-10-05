import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IndexedDbUploadJobStore, UploadQueue, uploadKey, type UploadSource } from '../src/services/drive/uploadQueue';

function fixture() {
  const identity = { ownerUid: crypto.randomUUID(), connectionId: crypto.randomUUID() };
  const source: UploadSource = { ...identity, fileId: crypto.randomUUID(), localFileRef: 'protected/local.m4a',
    name: '강의.m4a', mimeType: 'audio/mp4', sizeBytes: 1024, capturedAt: '2026-10-05T00:00:00Z', logicalFolderId: 'course-1' };
  const store = new IndexedDbUploadJobStore();
  let time = 100_000;
  return { identity, source, store, queue: new UploadQueue(store, identity, () => time), tick: (ms: number) => { time += ms; } };
}

test('Drive queue persists across instances and isolates UID and connection generation', async () => {
  const { queue, source, identity } = fixture();
  await queue.enqueue(source);
  const reopened = new UploadQueue(new IndexedDbUploadJobStore(), identity);
  assert.equal((await reopened.list())[0].localFileRef, source.localFileRef);
  assert.deepEqual(await new UploadQueue(new IndexedDbUploadJobStore(), { ...identity, connectionId: 'other' }).list(), []);
  assert.deepEqual(await new UploadQueue(new IndexedDbUploadJobStore(), { ...identity, ownerUid: 'other' }).list(), []);
  await assert.rejects(queue.enqueue({ ...source, ownerUid: 'other' }));
  assert.notEqual(uploadKey({ ownerUid: 'a:b', connectionId: 'c' }, 'x'), uploadKey({ ownerUid: 'a', connectionId: 'b:c' }, 'x'));
});

test('concurrent duplicate enqueue and claim create one job with one owner', async () => {
  const { queue, source } = fixture();
  await Promise.all([queue.enqueue(source), queue.enqueue(source)]);
  assert.equal((await queue.list()).length, 1);
  const claims = await Promise.allSettled([queue.claim(source.fileId), queue.claim(source.fileId)]);
  assert.equal(claims.filter(v => v.status === 'fulfilled').length, 1);
  await assert.rejects(queue.enqueue({ ...source, sizeBytes: 2048 }));
});

test('only a verified complete upload may enter registration and sync', async () => {
  const { queue, source } = fixture();
  await queue.enqueue(source);
  let job = await queue.claim(source.fileId);
  const token = job.lease!.token;
  await assert.rejects(queue.advance(source.fileId, token, job.revision, { state: 'synced' }));
  job = await queue.advance(source.fileId, token, job.revision, { state: 'uploading', driveFileId: 'google-id' });
  await assert.rejects(queue.advance(source.fileId, token, job.revision, { state: 'verifying', confirmedBytes: 500 }));
  job = await queue.advance(source.fileId, token, job.revision, { state: 'verifying', confirmedBytes: 1024 });
  job = await queue.advance(source.fileId, token, job.revision, { state: 'registering' });
  job = await queue.advance(source.fileId, token, job.revision, { state: 'synced' });
  assert.equal(job.lease, undefined);
  assert.equal((await queue.enqueue(source)).state, 'synced');
  await assert.rejects(queue.claim(source.fileId));
});

test('catalog registration failure retries registration without uploading the original again', async () => {
  const { queue, source, tick } = fixture();
  await queue.enqueue(source);
  let job = await queue.claim(source.fileId);
  let token = job.lease!.token;
  job = await queue.advance(source.fileId, token, job.revision, { state: 'uploading', driveFileId: 'google-id' });
  job = await queue.advance(source.fileId, token, job.revision, { state: 'verifying', confirmedBytes: 1024 });
  job = await queue.advance(source.fileId, token, job.revision, { state: 'registering' });
  await queue.defer(source.fileId, token, job.revision, 'retry_wait', () => 0);
  await assert.rejects(queue.claim(source.fileId));
  tick(3000);
  job = await queue.claim(source.fileId);
  token = job.lease!.token;
  await assert.rejects(queue.advance(source.fileId, token, job.revision, { state: 'uploading' }));
  job = await queue.advance(source.fileId, token, job.revision, { state: 'registering' });
  assert.equal(job.driveFileId, 'google-id');
});

test('expired leases can be recovered but stale workers cannot update the recovered job', async () => {
  const { queue, source, tick } = fixture();
  await queue.enqueue(source);
  const stale = await queue.claim(source.fileId, 1000);
  tick(1001);
  const current = await queue.claim(source.fileId);
  await assert.rejects(queue.advance(source.fileId, stale.lease!.token, stale.revision, { state: 'uploading' }));
  await queue.advance(source.fileId, current.lease!.token, current.revision, { state: 'uploading' });
});

test('cancellation survives stale enqueue and in-flight callbacks', async () => {
  const { queue, source } = fixture();
  await queue.enqueue(source);
  const job = await queue.claim(source.fileId);
  await queue.cancel(source.fileId);
  await assert.rejects(queue.advance(source.fileId, job.lease!.token, job.revision, { state: 'uploading' }));
  assert.equal((await queue.enqueue(source)).state, 'cancelled');
  await assert.rejects(queue.resume(source.fileId));
});

test('account suspension invalidates leases and keeps source references for recovery', async () => {
  const { queue, source } = fixture();
  await queue.enqueue(source);
  const old = await queue.claim(source.fileId);
  await queue.pauseAll();
  await assert.rejects(queue.advance(source.fileId, old.lease!.token, old.revision, { state: 'uploading' }));
  const paused = (await queue.list())[0];
  assert.equal(paused.state, 'paused');
  assert.equal(paused.localFileRef, source.localFileRef);
  await queue.resume(source.fileId);
  await queue.claim(source.fileId);
});

test('authorization and quota failures wait for explicit recovery', async () => {
  const { queue, source } = fixture();
  await queue.enqueue(source);
  const job = await queue.claim(source.fileId);
  await queue.defer(source.fileId, job.lease!.token, job.revision, 'needs_auth');
  await assert.rejects(queue.claim(source.fileId));
  await queue.resume(source.fileId);
  await queue.claim(source.fileId);
});
