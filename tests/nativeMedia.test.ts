import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { set } from 'idb-keyval';
import { importNativeMedia } from '../src/services/nativeMedia';
import { photoRecoverySnapshot } from '../src/utils/mediaStorage';
import type { NativeSession } from '../src/services/native';
const session = (uid: string): NativeSession => ({ uid, id: crypto.randomUUID(), startedAt: new Date().toISOString(), elapsedMs: 2000,
  mediaDurationMs: 2000, state: 'finished', uri: 'file:///internal/files/recordings/audio.m4a', context: { folderPath: ['2026'], connectionId: 'connection' } });
const dataUrl = async (blob: Blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;

test('native recording survives failed acknowledgement and replays without duplicate sources or intents', async () => {
  const uid = crypto.randomUUID(), file = session(uid); let reads = 0, acknowledgements = 0;
  const io = { read: async () => { reads++; return new Blob(['recorded']); }, dataUrl,
    acknowledge: async () => { acknowledgements++; assert.equal((await photoRecoverySnapshot(uid)).recordings.length, 1); throw Error('interrupted'); } };
  await importNativeMedia(uid, [], [file], () => true, io);
  await importNativeMedia(uid, [], [file], () => true, io);
  const saved = await photoRecoverySnapshot(uid);
  assert.equal(saved.recordings.length, 1); assert.equal(saved.intents.length, 1);
  assert.equal(saved.recordings[0].integrity?.status, 'duration_checked');
  assert.match(saved.recordings[0].dataUrl!, /^data:audio\/mp4;/);
  assert.equal(reads, 1); assert.equal(acknowledgements, 2);
});
test('interrupted native recordings stay local and an owner change cannot commit or acknowledge them', async () => {
  const uid = crypto.randomUUID(), file = { ...session(uid), warning: 'interrupted' };
  let owner = true, acknowledgements = 0;
  const io = { read: async () => { owner = false; return new Blob(['audio']); }, dataUrl,
    acknowledge: async () => { acknowledgements++; } };
  await importNativeMedia(uid, [], [file], () => owner, io);
  assert.equal((await photoRecoverySnapshot(uid)).recordings.length, 0); assert.equal(acknowledgements, 0);
  await importNativeMedia(uid, [], [file], () => true, { ...io, read: async () => new Blob(['audio']) });
  const saved = await photoRecoverySnapshot(uid);
  assert.equal(saved.recordings[0].integrity?.status, 'needs_review'); assert.equal(saved.intents.length, 0);
});
test('a leftover native original never resurrects a permanently deleted file', async () => {
  const uid = crypto.randomUUID(), file = session(uid); let acknowledged = false;
  await set(`lecture_snap_trash_${uid}`, [{ purged: true, file: { id: file.id } }]);
  await importNativeMedia(uid, [], [file], () => true, { read: async () => { throw Error('must not read'); }, dataUrl,
    acknowledge: async () => { acknowledged = true; } });
  assert.equal(acknowledged, true); assert.equal((await photoRecoverySnapshot(uid)).recordings.length, 0);
});
test('metadata-only local entry cannot trigger deletion of the only native original', async () => {
  const uid = crypto.randomUUID(), file = session(uid);
  await set(`lecture_snap_recordings_${uid}`, [{ id: file.id, name: 'remote metadata only' }]);
  let acknowledgements = 0;
  await assert.rejects(importNativeMedia(uid, [], [file], () => true, {
    read: async () => new Blob(['audio']), dataUrl, acknowledge: async () => { acknowledgements++; },
  }), /원본/);
  assert.equal(acknowledgements, 0);
});
test('account change after durable commit retains native original until the owner returns', async () => {
  const uid = crypto.randomUUID(), file = session(uid); let checks = 0, acknowledgements = 0;
  await importNativeMedia(uid, [], [file], () => ++checks < 3, {
    read: async () => new Blob(['audio']), dataUrl, acknowledge: async () => { acknowledgements++; },
  });
  assert.equal((await photoRecoverySnapshot(uid)).recordings.length, 1);
  assert.equal(acknowledgements, 0);
});
test('foreign account journal is rejected before reading or acknowledging its source', async () => {
  const uid = crypto.randomUUID();
  await assert.rejects(importNativeMedia(uid, [], [session('someone-else')], () => true, {
    read: async () => { assert.fail('foreign original must not be read'); }, dataUrl,
    acknowledge: async () => { assert.fail('foreign original must not be deleted'); },
  }), /계정/);
});
