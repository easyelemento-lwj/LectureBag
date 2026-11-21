import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, get, set } from 'idb-keyval';
import { captureIntents, recoverPhotoIntents, recoverCaptureIntents, saveCapturedPhoto, saveRecordedAudio } from '../src/utils/mediaStorage';
import { inspectPhotoRecovery, repairMissingPhotos } from '../src/services/drive/photoRecovery';
import type { CloudCatalog } from '../src/services/drive/cloudCatalog';
import { IndexedDbUploadJobStore, type UploadJob } from '../src/services/drive/uploadQueue';
import { DriveClient } from '../src/services/drive/driveClient';
import type { CapturedPhoto, RecordedAudio } from '../src/types';

const db = createStore('keyval-store', 'keyval');
function photo(): CapturedPhoto { return { id: crypto.randomUUID(), timestamp: '2026-10-31T10:00:00Z',
  dataUrl: 'data:image/jpeg;base64,YQ==', width: 1, height: 1, mode: 'PPT/판서' }; }
function fixture() {
  const identity = { ownerUid: crypto.randomUUID(), connectionId: crypto.randomUUID() };
  let valid = true, revision = 1;
  const remote = new Map<string, string>();
  const catalog = {
    assertOwner(uid: string) { if (!valid || uid !== identity.ownerUid) throw Error('account changed'); },
    status: async () => ({ connected: true, connectionId: identity.connectionId, revision }),
    captureAudit: async (_connection: string, ids: string[]) => ({ files: ids.map(fileId => ({ fileId, status: remote.get(fileId) || 'missing' })) }),
  } as unknown as CloudCatalog;
  let jobs: UploadJob[] = [];
  const existing = new Set<string>();
  const deps = { includeRecordings: true, jobs: async () => jobs, exists: async (id: string) => existing.has(id) };
  return { identity, catalog, remote, deps, existing, job: (job: Partial<UploadJob>) => { jobs.push({ ...identity, ...job } as UploadJob); },
    invalidate: () => { valid = false; }, changeConnection: () => { revision++; } };
}
const signal = () => new AbortController().signal;

test('mixed photos and recordings retain original bytes, IDs, duration and audio extension on recovery', async () => {
  const f = fixture(), p = photo();
  await saveCapturedPhoto(f.identity.ownerUid, p);
  const recordings: RecordedAudio[] = ['mp4', 'webm', 'ogg'].map(mime => ({ id: crypto.randomUUID(),
    name: '강의 녹음', timestamp: '2026-10-31T10:00:00Z', duration: '00:20', durationMs: 20000,
    integrity: { status: 'duration_checked', mediaDurationMs: 20000 }, dataUrl: `data:audio/${mime};base64,YQ==` }));
  for (const audio of recordings) await saveRecordedAudio(f.identity.ownerUid, audio);
  const before = await get(`lecture_snap_recordings_${f.identity.ownerUid}`, db);
  const report = await inspectPhotoRecovery(f.identity, f.catalog, signal(), f.deps);
  assert.equal(report.rows.filter(row => row.kind === 'photo' && row.status === 'missing').length, 1);
  assert.equal(report.rows.filter(row => row.kind === 'audio' && row.status === 'missing').length, 3);
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    assert.equal((await repairMissingPhotos(f.identity, report.rows.map(row => row.id), f.catalog, signal(), f.deps)).count, 4);
    const intents = await captureIntents(f.identity.ownerUid);
    for (const [i, extension] of ['m4a', 'webm', 'ogg'].entries()) {
      assert.ok(intents.find(intent => intent.fileId === recordings[i].id)?.name.endsWith(`.${extension}`));
    }
    assert.deepEqual(await get(`lecture_snap_recordings_${f.identity.ownerUid}`, db), before);
    assert.equal((await repairMissingPhotos(f.identity, report.rows.map(row => row.id), f.catalog, signal(), f.deps)).count, 0);
  } finally { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage; }
});

test('unverified/interrupted recordings are visible but not uploaded; changed integrity is checked transactionally', async () => {
  const f = fixture();
  const recordings: RecordedAudio[] = [undefined, { status: 'needs_review' as const }, { status: 'duration_checked' as const }].map(integrity => ({
    id: crypto.randomUUID(), timestamp: '2026-10-31T10:00:00Z', name: '녹음', duration: '00:20', integrity,
    dataUrl: 'data:audio/mp4;base64,YQ==' }));
  for (const recording of recordings) await saveRecordedAudio(f.identity.ownerUid, recording);
  const report = await inspectPhotoRecovery(f.identity, f.catalog, signal(), f.deps);
  assert.equal(report.rows.filter(row => row.status === 'audio_review').length, 2);
  assert.equal(report.sources.size, 1);
  const source = recordings[2];
  await set(`lecture_snap_recordings_${f.identity.ownerUid}`, recordings.map(r => ({ ...r, integrity: { status: 'needs_review' } })), db);
  const count = await recoverCaptureIntents(f.identity.ownerUid, f.identity.connectionId, [{ source, kind: 'audio',
    intent: { fileId: source.id, connectionId: f.identity.connectionId, name: 'lecture.m4a', capturedAt: String(source.timestamp), folderPath: ['2026년'] } }], () => {});
  assert.equal(count, 0);
  assert.deepEqual(await captureIntents(f.identity.ownerUid), []);
});

test('recording tombstones, previous connections, absent bytes and cross-kind ID collisions are excluded', async () => {
  const f = fixture(), p = photo(); await saveCapturedPhoto(f.identity.ownerUid, p);
  const recordings: RecordedAudio[] = Array.from({ length: 5 }, () => ({ id: crypto.randomUUID(), name: '녹음', duration: '00:20',
    timestamp: '2026-10-31T10:00:00Z', dataUrl: 'data:audio/mp4;base64,YQ==', integrity: { status: 'duration_checked' } }));
  recordings[4].id = p.id;
  for (const r of recordings) await saveRecordedAudio(f.identity.ownerUid, r);
  f.remote.set(recordings[0].id, 'deleted'); f.remote.set(recordings[1].id, 'previous'); f.existing.add(recordings[2].id);
  await set(`lecture_snap_recordings_${f.identity.ownerUid}`, recordings.map((r, i) => i === 3 ? { ...r, dataUrl: undefined } : r), db);
  const report = await inspectPhotoRecovery(f.identity, f.catalog, signal(), f.deps);
  assert.equal(report.sources.size, 0);
  assert.deepEqual(report.rows.map(row => row.status).sort(), ['deleted', 'previous', 'review', 'invalid', 'invalid'].sort());
});

test('12 local photos / 9 catalog files: read-only inspection finds exactly three missing intents', async () => {
  const f = fixture(), photos = Array.from({ length: 12 }, photo);
  for (const p of photos) await saveCapturedPhoto(f.identity.ownerUid, p);
  photos.slice(0, 9).forEach(p => f.remote.set(p.id, 'registered'));
  const report = await inspectPhotoRecovery(f.identity, f.catalog, signal(), f.deps);
  assert.equal(report.rows.filter(row => row.status === 'registered').length, 9);
  assert.equal(report.sources.size, 3);
  assert.deepEqual(await captureIntents(f.identity.ownerUid), []);
  assert.equal((await get<CapturedPhoto[]>(`lecture_snap_photos_${f.identity.ownerUid}`, db))!.length, 12);
});

test('recovery rechecks remote, preserves IDs/originals, and repeated repairs cannot duplicate intents', async () => {
  const f = fixture(), a = photo(), b = photo();
  await saveCapturedPhoto(f.identity.ownerUid, a); await saveCapturedPhoto(f.identity.ownerUid, b);
  const before = await get(`lecture_snap_photos_${f.identity.ownerUid}`, db);
  await inspectPhotoRecovery(f.identity, f.catalog, signal(), f.deps);
  f.remote.set(b.id, 'registered'); // another client registered it after preview
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    const result = await repairMissingPhotos(f.identity, [a.id, b.id], f.catalog, signal(), f.deps);
    assert.equal(result.count, 1);
    assert.deepEqual((await captureIntents(f.identity.ownerUid)).map(i => i.fileId), [a.id]);
    assert.equal((await repairMissingPhotos(f.identity, [a.id, b.id], f.catalog, signal(), f.deps)).count, 0);
    assert.deepEqual(await get(`lecture_snap_photos_${f.identity.ownerUid}`, db), before);
  } finally { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage; }
});

test('old connections, tombstones, cancelled jobs, orphan Drive originals and malformed photos are never repaired', async () => {
  const f = fixture(), photos = Array.from({ length: 8 }, photo);
  photos[7].dataUrl = 'invalid';
  for (const p of photos) await saveCapturedPhoto(f.identity.ownerUid, p);
  f.remote.set(photos[0].id, 'previous'); f.remote.set(photos[1].id, 'deleted');
  f.job({ fileId: photos[2].id, connectionId: 'previous', state: 'queued' });
  f.job({ fileId: photos[3].id, state: 'cancelled' });
  f.job({ fileId: photos[4].id, state: 'synced' });
  f.existing.add(photos[5].id);
  await set(`lecture_snap_trash_${f.identity.ownerUid}`, [{ file: photos[6], purged: true }], db);
  const report = await inspectPhotoRecovery(f.identity, f.catalog, signal(), f.deps);
  assert.equal(report.sources.size, 0);
  assert.deepEqual(report.rows.map(row => row.status).sort(), ['deleted', 'invalid', 'previous', 'previous', 'review', 'review', 'review'].sort());
});

test('incomplete server response, network errors, account switch, reconnect and cancellation fail closed', async () => {
  const f = fixture(), p = photo(); await saveCapturedPhoto(f.identity.ownerUid, p);
  const incomplete = { ...f.catalog, captureAudit: async () => ({ files: [] }) } as unknown as CloudCatalog;
  await assert.rejects(inspectPhotoRecovery(f.identity, incomplete, signal(), f.deps));
  await assert.rejects(inspectPhotoRecovery(f.identity, f.catalog, signal(), { ...f.deps, exists: async () => { throw Error('offline'); } }));
  await assert.rejects(inspectPhotoRecovery(f.identity, f.catalog, signal(), { ...f.deps, exists: async () => { f.changeConnection(); return false; } }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectPhotoRecovery(f.identity, f.catalog, controller.signal, f.deps));
  f.invalidate(); await assert.rejects(inspectPhotoRecovery(f.identity, f.catalog, signal(), f.deps));
  assert.deepEqual(await captureIntents(f.identity.ownerUid), []);
});

test('transaction rejects deleted/changed sources, scope changes and parallel duplicate enrollment', async () => {
  const f = fixture(), p = photo(); await saveCapturedPhoto(f.identity.ownerUid, p);
  const candidate = { photo: p, intent: { fileId: p.id, connectionId: f.identity.connectionId, name: 'p.jpg', capturedAt: String(p.timestamp), folderPath: ['2026년'] } };
  const enroll = (scope = () => {}) => recoverPhotoIntents(f.identity.ownerUid, f.identity.connectionId, [candidate], scope);
  await assert.rejects(enroll(() => { throw Error('changed account'); }));
  await set(`lecture_snap_photos_${f.identity.ownerUid}`, [{ ...p, dataUrl: 'different' }], db);
  assert.equal(await enroll(), 0);
  await set(`lecture_snap_photos_${f.identity.ownerUid}`, [p], db);
  await set(`lecture_snap_trash_${f.identity.ownerUid}`, [{ file: p, deletedAt: '2026-10-31' }], db);
  assert.equal(await enroll(), 0);
  await set(`lecture_snap_trash_${f.identity.ownerUid}`, [], db);
  assert.equal((await Promise.all([enroll(), enroll()])).reduce((sum, n) => sum + n, 0), 1);
  assert.equal((await captureIntents(f.identity.ownerUid)).length, 1);
});

test('job audit includes historical connections for this user only', async () => {
  const store = new IndexedDbUploadJobStore();
  await store.update('audit-a', () => ({ ownerUid: 'audit-user', connectionId: 'old' } as UploadJob));
  await store.update('audit-b', () => ({ ownerUid: 'audit-user', connectionId: 'new' } as UploadJob));
  await store.update('audit-c', () => ({ ownerUid: 'someone-else', connectionId: 'old' } as UploadJob));
  assert.equal((await store.listOwner('audit-user')).length, 2);
  assert.equal((await store.list({ ownerUid: 'audit-user', connectionId: 'new' })).length, 1);
});

test('Drive orphan search includes trash and previous connections; incomplete search is not absence', async () => {
  const original = globalThis.fetch;
  const client = new DriveClient(async () => 'synthetic');
  let incomplete = false;
  globalThis.fetch = async input => {
    const url = new URL(String(input)), q = url.searchParams.get('q')!;
    assert.match(q, /lecturebagFileId/); assert.match(q, /lecturebagOwner/);
    assert.ok(!q.includes('trashed = false') && !q.includes('lecturebagConnectionId'));
    return Response.json({ files: [], incompleteSearch: incomplete });
  };
  try {
    assert.equal(await client.captureExists(crypto.randomUUID(), 'a'.repeat(64)), false);
    incomplete = true;
    await assert.rejects(client.captureExists(crypto.randomUUID(), 'a'.repeat(64)));
  } finally { globalThis.fetch = original; }
});


test('when recording is disabled, photo audit and repair never enqueue old recordings', async () => {
  const f = fixture(), p = photo(); f.deps.includeRecordings = false;
  await saveCapturedPhoto(f.identity.ownerUid, p);
  const audio: RecordedAudio = { id: crypto.randomUUID(), name: 'old.m4a', duration: '00:01',
    timestamp: '2026-10-31T10:00:00Z', integrity: { status: 'duration_checked' }, dataUrl: 'data:audio/mp4;base64,YQ==' };
  await saveRecordedAudio(f.identity.ownerUid, audio);
  const report = await inspectPhotoRecovery(f.identity, f.catalog, signal(), f.deps);
  assert.deepEqual(report.rows.map(row => row.id), [p.id]);
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    assert.equal((await repairMissingPhotos(f.identity, [p.id, audio.id], f.catalog, signal(), f.deps)).count, 1);
    assert.deepEqual((await captureIntents(f.identity.ownerUid)).map(intent => intent.fileId), [p.id]);
  } finally { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage; }
});
