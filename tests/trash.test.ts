import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { get, set } from 'idb-keyval';
import { restoreTrashEntries, purgeTrashEntries, purgeExpiredTrash, TRASH_RETENTION_MS, type TrashEntry } from '../src/utils/trash';
import { updateTrash, saveMedia, trashKey } from '../src/utils/mediaStorage';
import { accountKey, documentKey } from '../src/utils/accountStorage';

const photo: TrashEntry = { file: { id: 'photo_1', type: 'photo', name: '수업.jpg', timestamp: new Date().toISOString(), dataUrl: 'data:image/jpeg;base64,test' }, deletedAt: new Date().toISOString() };
const doc: TrashEntry = { file: { id: 'ai_doc_1', type: 'document', name: '요약.md', timestamp: photo.deletedAt }, deletedAt: photo.deletedAt, documentContent: '# 수업 요약' };

test('independent clients updating concurrently preserve both additions', async () => {
  await Promise.all([updateTrash('concurrent', prev => [...prev, photo]), updateTrash('concurrent', prev => [...prev, doc])]);
  const saved = await get<TrashEntry[]>(trashKey('concurrent'));
  assert.equal(saved?.length, 2);
  assert.equal(saved?.find(entry => entry.file.id === doc.file.id)?.documentContent, '# 수업 요약');
});

test('stale tab cannot revive permanent deletion or its source payload', async () => {
  const uid = 'stale-tab';
  await saveMedia(uid, 'photos', [photo.file]);
  await updateTrash(uid, () => [photo]);
  const stale = await get<TrashEntry[]>(trashKey(uid));
  await updateTrash(uid, prev => purgeTrashEntries(prev, [photo.file.id]));
  await updateTrash(uid, () => [doc, ...stale!]);
  await saveMedia(uid, 'photos', [photo.file]);
  const stored = await get<TrashEntry[]>(trashKey(uid));
  const deleted = stored!.find(entry => entry.file.id === photo.file.id)!;
  assert.equal(deleted.purged, true);
  assert.equal(deleted.file.dataUrl, undefined);
  assert.deepEqual(await get(`lecture_snap_photos_${uid}`), []);
  assert.equal(restoreTrashEntries(stored!, [photo.file.id]).find(entry => entry.file.id === photo.file.id)?.purged, true);
});

test('failed transaction preserves recoverable data and allows retry', async () => {
  const uid = 'failed-write';
  await updateTrash(uid, () => [photo]);
  await assert.rejects(updateTrash(uid, () => { throw new Error('simulated failure'); }));
  assert.deepEqual(await get(trashKey(uid)), [photo]);
  await updateTrash(uid, prev => restoreTrashEntries(prev, [photo.file.id]));
  assert.equal((await get<TrashEntry[]>(trashKey(uid)))![0].restored, true);
});

test('expiry begins exactly at 30 days; restored files are preserved', () => {
  const entries = [photo, { ...doc, restored: true }];
  const expires = Date.parse(photo.deletedAt) + TRASH_RETENTION_MS;
  assert.equal(purgeExpiredTrash(entries, expires - 1), entries);
  const purged = purgeExpiredTrash(entries, expires);
  assert.equal(purged[0].purged, true);
  assert.equal(purged[0].file.dataUrl, undefined);
  assert.deepEqual(purged[1], entries[1]);
});

test('startup expiry and source deletion commit together', async () => {
  const uid = 'startup';
  await set(trashKey(uid), [{ ...photo, deletedAt: new Date(Date.now() - TRASH_RETENTION_MS - 1).toISOString() }]);
  await set(`lecture_snap_photos_${uid}`, [photo.file]);
  const entries = await updateTrash(uid, prev => prev);
  assert.equal(entries[0].purged, true);
  assert.deepEqual(await get(`lecture_snap_photos_${uid}`), []);
});

test('accounts use distinct storage and cannot modify each other', async () => {
  assert.notEqual(accountKey('alice', 'ai_docs'), accountKey('bob', 'ai_docs'));
  assert.notEqual(documentKey('alice', doc.file.id), documentKey('bob', doc.file.id));
  assert.throws(() => accountKey('', 'ai_docs'));
  await updateTrash('alice', () => [photo]);
  await updateTrash('bob', prev => purgeTrashEntries(prev, [photo.file.id]));
  assert.deepEqual(await get(trashKey('alice')), [photo]);
  assert.deepEqual(await get(trashKey('bob')), []);
});

test('restore selection leaves other items in trash', () => {
  const restored = restoreTrashEntries([photo, doc], [photo.file.id]);
  assert.equal(restored[0].restored, true);
  assert.equal(restored[1].restored, undefined);
  assert.deepEqual(restored[0].file, photo.file);
});
