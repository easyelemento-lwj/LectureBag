import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, get, set } from 'idb-keyval';
import { archivePreviousDriveCaptures, captureIntents, uploadSource } from '../src/utils/mediaStorage';

test('explicit old-library cleanup preserves originals, current/unbound files and other accounts', async () => {
  const db = createStore('keyval-store', 'keyval'), uid = 'recovery-a';
  const photos = ['old-photo', 'current-photo', 'unbound'].map(id => ({ id, timestamp: '2026-10-01', dataUrl: id, mode: 'default' }));
  const audio = [{ id: 'old-audio', timestamp: '2026-10-01', dataUrl: 'original-audio', duration: '01:00' }];
  const intents = [
    { fileId: 'old-photo', connectionId: 'previous', name: 'photo.jpg' },
    { fileId: 'old-audio', connectionId: 'previous', name: 'lecture.m4a' },
    { fileId: 'current-photo', connectionId: 'current', name: 'keep.jpg' },
    { fileId: 'unbound', name: 'new.jpg' },
  ];
  await set(`lecture_snap_photos_${uid}`, photos, db);
  await set(`lecture_snap_recordings_${uid}`, audio, db);
  await set(`lecturebag_capture_outbox_${uid}`, intents, db);
  await set('lecturebag_capture_outbox_recovery-b', intents, db);
  assert.equal(await archivePreviousDriveCaptures(uid, 'current'), 2);
  assert.deepEqual(await get(`lecture_snap_photos_${uid}`, db), photos);
  assert.deepEqual(await get(`lecture_snap_recordings_${uid}`, db), audio);
  assert.deepEqual((await captureIntents(uid)).map(i => i.fileId), ['current-photo', 'unbound']);
  assert.equal(await uploadSource(uid, 'old-photo'), undefined);
  assert.equal(await uploadSource(uid, 'old-audio'), undefined);
  assert.ok(await uploadSource(uid, 'current-photo'));
  assert.ok(await uploadSource(uid, 'unbound'));
  assert.deepEqual(await get('lecturebag_capture_outbox_recovery-b', db), intents);
  const trash = await get<any[]>(`lecture_snap_trash_${uid}`, db);
  assert.equal(trash?.length, 2);
  assert.ok(trash?.every(e => !e.purged && !e.cloud && e.file.dataUrl));
  assert.equal(await archivePreviousDriveCaptures(uid, 'current'), 0);
});

test('cleanup cannot revive purged entries or overwrite existing trash and rejects missing identity', async () => {
  const db = createStore('keyval-store', 'keyval'), uid = 'recovery-c';
  const trash = [{ file: { id: 'purged', type: 'photo' }, purged: true },
    { file: { id: 'trashed', type: 'photo' }, deletedAt: '2026-10-01' }];
  await set(`lecture_snap_trash_${uid}`, trash, db);
  await set(`lecture_snap_photos_${uid}`, ['purged', 'trashed'].map(id => ({ id, dataUrl: 'stale-bytes' })), db);
  await set(`lecturebag_capture_outbox_${uid}`, ['purged', 'trashed', 'missing'].map(fileId => ({ fileId, connectionId: 'old' })), db);
  assert.equal(await archivePreviousDriveCaptures(uid, 'current'), 0);
  assert.deepEqual(await get(`lecture_snap_trash_${uid}`, db), trash);
  assert.deepEqual(await captureIntents(uid), []);
  assert.throws(() => archivePreviousDriveCaptures('', 'current'));
  assert.throws(() => archivePreviousDriveCaptures(uid, ''));
});
