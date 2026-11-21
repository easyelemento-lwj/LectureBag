import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, get, set } from 'idb-keyval';
import { recordingCheckDescription, recheckRecordingLength } from '../src/utils/recordingRecheck';
import { compareRecordingDuration } from '../src/utils/recordingIntegrity';
import { saveRecordedAudio, saveMedia, saveRecordingRecheck, captureIntents } from '../src/utils/mediaStorage';
import { inspectPhotoRecovery, recheckAudioRecovery } from '../src/services/drive/photoRecovery';
import type { RecordedAudio } from '../src/types';
import type { CloudCatalog } from '../src/services/drive/cloudCatalog';
const db = createStore('keyval-store', 'keyval');
const makeAudio = (): RecordedAudio => ({ id: crypto.randomUUID(), name: '녹음.m4a', duration: '00:20', durationMs: 20000,
  timestamp: '2026-10-15T01:00:00Z', dataUrl: 'data:audio/mp4;base64,YQ==' });

test('diagnostics distinguish absent check, read failure, duration mismatch, missing clock and recording warning', () => {
  assert.equal(recordingCheckDescription({}), '검사 기록 없음');
  assert.match(recordingCheckDescription({ integrity: compareRecordingDuration(20000) }), /파일 길이 검사 실패/);
  assert.match(recordingCheckDescription({ integrity: compareRecordingDuration(20000, 10000) }), /불일치/);
  assert.match(recordingCheckDescription({ integrity: compareRecordingDuration(NaN, 20000) }), /시간 기록 없음/);
  assert.match(recordingCheckDescription({ integrity: compareRecordingDuration(20000, 20000, '중단됨') }), /경고/);
  assert.equal(compareRecordingDuration(NaN, 20000).status, 'needs_review');
});

test('old display duration is never used as a fabricated comparison clock', async () => {
  const audio = { ...makeAudio(), durationMs: undefined, duration: '00:20' };
  const result = await recheckRecordingLength(audio, new Blob(), async (_, elapsed, reason) => {
    assert.ok(Number.isNaN(elapsed)); return compareRecordingDuration(elapsed, 20000, reason);
  });
  assert.equal(result.status, 'needs_review');
  assert.ok(result.issues?.includes('missing_elapsed'));
  assert.equal(result.mediaDurationMs, 20000);
});

test('duration-only failures can pass recheck; interruption and unknown old warnings cannot disappear', async () => {
  const audio = makeAudio();
  const inspect = async (_: Blob, elapsed: number, reason?: string) => compareRecordingDuration(elapsed, 20000, reason);
  const blob = new Blob();
  assert.equal((await recheckRecordingLength(audio, blob, inspect)).status, 'duration_checked');
  audio.integrity = { status: 'needs_review', warning: '파일 길이를 확인하지 못했습니다. 원본은 기기에 보존하며 자동 업로드를 보류합니다. 최근 녹음에서 확인·내보내기 해주세요.' };
  assert.equal((await recheckRecordingLength(audio, blob, inspect)).status, 'duration_checked');
  audio.integrity = compareRecordingDuration(20000, 20000, '중단된 조각 복구');
  const result = await recheckRecordingLength(audio, blob, inspect);
  assert.equal(result.status, 'needs_review'); assert.equal(result.recordingWarning, '중단된 조각 복구');
  audio.integrity = { status: 'needs_review' };
  assert.equal((await recheckRecordingLength(audio, blob, inspect)).status, 'needs_review');
});

test('recheck changes only integrity, prevents stale autosave rollback, and rejects changed/deleted sources', async () => {
  const uid = crypto.randomUUID(), audio = makeAudio();
  await saveRecordedAudio(uid, audio);
  const check = compareRecordingDuration(20000, 20000);
  await saveRecordingRecheck(uid, audio, check, () => {});
  await saveMedia(uid, 'recordings', [audio]);
  assert.deepEqual((await get<RecordedAudio[]>(`lecture_snap_recordings_${uid}`, db))![0], { ...audio, integrity: check });
  assert.deepEqual(await captureIntents(uid), []);
  await assert.rejects(saveRecordingRecheck(uid, audio, check, () => {}));
  const current = { ...audio, integrity: check };
  await assert.rejects(saveRecordingRecheck(uid, current, check, () => { throw Error('account changed'); }));
  await set(`lecture_snap_trash_${uid}`, [{ file: audio, purged: true }], db);
  await assert.rejects(saveRecordingRecheck(uid, current, check, () => {}));
});

test('saved recheck unlocks ordinary recovery without enrolling/uploads; account change prevents saving', async () => {
  const identity = { ownerUid: crypto.randomUUID(), connectionId: crypto.randomUUID() }, audio = makeAudio();
  await saveRecordedAudio(identity.ownerUid, audio);
  let valid = true;
  const catalog = {
    assertOwner() { if (!valid) throw Error('account changed'); },
    status: async () => ({ connected: true, connectionId: identity.connectionId, revision: 1 }),
    captureAudit: async (_: string, ids: string[]) => ({ files: ids.map(fileId => ({ fileId, status: 'missing' })) }),
  } as unknown as CloudCatalog;
  const signal = new AbortController().signal;
  const deps = { includeRecordings: true, jobs: async () => [], exists: async () => false };
  const first = await inspectPhotoRecovery(identity, catalog, signal, deps);
  assert.equal(first.rows[0].audioCheck?.description, '검사 기록 없음');
  const check = await recheckAudioRecovery(identity, audio.id, catalog, signal, async recording => compareRecordingDuration(recording.durationMs!, 20000));
  assert.equal(check.status, 'duration_checked');
  assert.equal((await inspectPhotoRecovery(identity, catalog, signal, deps)).rows[0].status, 'missing');
  assert.deepEqual(await captureIntents(identity.ownerUid), []);
  await assert.rejects(recheckAudioRecovery(identity, audio.id, catalog, signal, async () => {
    valid = false; return compareRecordingDuration(20000, 5000);
  }));
  assert.equal((await get<RecordedAudio[]>(`lecture_snap_recordings_${identity.ownerUid}`, db))![0].integrity?.status, 'duration_checked');
});
