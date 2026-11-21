import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordingClock } from '../src/utils/recordingClock';
import { RecordingSession, type RecordingJournal, type RecordingResult } from '../src/utils/recordingSession';
import { createRecordingDraft, appendRecordingChunk, listRecordingDrafts, recoverRecordingDraft, touchRecordingDraft, removeCommittedDraft, DRAFT_LEASE_MS, type RecordingDraft } from '../src/utils/recordingDrafts';
import { webmTimelineMs, compareRecordingDuration } from '../src/utils/recordingIntegrity';

function draft(): RecordingDraft { return { uid: crypto.randomUUID(), id: crypto.randomUUID(), owner: crypto.randomUUID(), mime: 'audio/webm', startedAt: new Date().toISOString(), updatedAt: Date.now(), elapsedMs: 0, count: 0, bytes: 0 }; }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('draft listing skips chunk ranges and isolates escaped and prefix-sharing owners', async () => {
  const uid = `owner-"\\-${crypto.randomUUID()}`;
  const first = { ...draft(), uid, id: 'session-a' };
  const second = { ...draft(), uid, id: 'session-b' };
  const empty = { ...draft(), uid, id: 'session-c' };
  const foreign = { ...draft(), uid: `${uid}-other` };
  for (const item of [first, second, empty, foreign]) await createRecordingDraft(item);
  for (const item of [first, second, foreign]) {
    for (let index = 0; index < 24; index++) {
      await appendRecordingChunk(item.uid, item.id, item.owner, index, new Blob(['audio']), (index + 1) * 1000);
    }
  }
  const listed = await listRecordingDrafts(uid);
  assert.deepEqual(listed.map(d => d.id), [first.id, second.id]);
  assert.ok(listed.every(d => d.count === 24 && d.bytes === 120));
  assert.deepEqual((await listRecordingDrafts(foreign.uid)).map(d => d.id), [foreign.id]);
  for (const item of [first, second, empty, foreign]) await removeCommittedDraft(item.uid, item.id, item.owner);
});

test('journal chunks are ordered, durable and isolated; active recordings cannot be stolen', async () => {
  const d = draft(); await createRecordingDraft(d);
  await appendRecordingChunk(d.uid, d.id, d.owner, 0, new Blob(['first']), 1000);
  await assert.rejects(appendRecordingChunk(d.uid, d.id, d.owner, 2, new Blob(['bad']), 2000));
  await assert.rejects(appendRecordingChunk(d.uid, d.id, 'other', 1, new Blob(['bad']), 2000));
  await appendRecordingChunk(d.uid, d.id, d.owner, 1, new Blob(['last']), 2000);
  assert.deepEqual(await listRecordingDrafts('another-user'), []);
  const [stored] = await listRecordingDrafts(d.uid);
  assert.equal(stored.count, 2); assert.equal(stored.bytes, 9);
  await assert.rejects(recoverRecordingDraft(d.uid, d.id, 'another-tab'));
  await assert.rejects(recoverRecordingDraft('another-user', d.id, 'another-tab'));
  const now = Date.now; Date.now = () => now() + DRAFT_LEASE_MS + 1;
  let result;
  try { result = await recoverRecordingDraft(d.uid, d.id, 'recoverer'); }
  finally { Date.now = now; }
  assert.equal(await result.blob.text(), 'firstlast');
  await assert.rejects(appendRecordingChunk(d.uid, d.id, d.owner, 2, new Blob(['late']), 3000));
  await assert.rejects(recoverRecordingDraft(d.uid, d.id, 'second-recoverer'));
  await assert.rejects(removeCommittedDraft(d.uid, d.id, d.owner));
  await removeCommittedDraft(d.uid, d.id, 'recoverer');
  assert.deepEqual(await listRecordingDrafts(d.uid), []);
});

class FakeRecorder {
  state = 'inactive'; ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void; onerror?: () => void;
  track = Object.assign(new EventTarget(), { stop() {} });
  stream = { getTracks: () => [this.track], getAudioTracks: () => [this.track] };
  stops = 0;
  start() { assert.ok(this.onstop); assert.ok(this.onerror); this.state = 'recording'; }
  pause() { this.state = 'paused'; } resume() { this.state = 'recording'; }
  data(value: string) { this.ondataavailable?.({ data: new Blob([value]) }); }
  stop() { this.stops++; this.state = 'inactive'; }
  finish() { this.data('last'); this.onstop?.(); }
}
function fixture(storageOverrides: Partial<RecordingJournal> = {}) {
  const recorder = new FakeRecorder(), d = draft(), warnings: string[] = [], written: string[] = [];
  let now = 0, result: RecordingResult | undefined, count = 0;
  const storage: RecordingJournal = { create: async () => {}, append: async (_u, _i, _o, _n, blob) => { written.push(await blob.text()); }, touch: async () => {}, ...storageOverrides };
  const clock = new RecordingClock(() => now);
  const session = new RecordingSession(recorder as unknown as MediaRecorder, d, clock, r => { result = r; count++; }, m => warnings.push(m), storage);
  return { session, recorder, warnings, written, setTime: (n: number) => { now = n; }, result: () => result, count: () => count };
}
test('manual stop waits for final data and pending journal write, then finalizes exactly once', async () => {
  let release: () => void = () => {}; const gate = new Promise<void>(r => { release = r; });
  const f = fixture({ append: async () => { await gate; } }); await f.session.start();
  f.recorder.data('first'); f.setTime(2000); f.session.stop();
  assert.equal(f.result(), undefined); f.recorder.finish(); await tick(); assert.equal(f.result(), undefined);
  release(); await tick();
  assert.equal(await f.result()!.blob.text(), 'firstlast'); assert.equal(f.result()!.elapsedMs, 2000);
  f.recorder.onstop?.(); await tick(); assert.equal(f.count(), 1);
});
test('unexpected stop preserves all delivered bytes with a warning', async () => {
  const f = fixture(); await f.session.start(); f.recorder.data('first'); f.setTime(1000);
  f.recorder.state = 'inactive'; f.recorder.finish(); await tick();
  assert.equal(await f.result()!.blob.text(), 'firstlast'); assert.ok(f.result()!.warning);
});
test('recorder error and track mute stop once, preserve final data and exclude pause time', async () => {
  const f = fixture(); await f.session.start(); f.setTime(1000); f.session.pause(); f.setTime(9000); f.session.resume();
  f.setTime(10_000); f.recorder.track.dispatchEvent(new Event('mute')); f.recorder.onerror?.();
  assert.equal(f.recorder.stops, 1); f.recorder.finish(); await tick();
  assert.equal(f.result()!.elapsedMs, 2000); assert.ok(f.result()!.warning);
});
test('failed journal write stops capture but retains memory bytes for final local save', async () => {
  const f = fixture({ append: async () => { throw new Error('quota'); } }); await f.session.start();
  f.recorder.data('first'); await tick(); assert.equal(f.recorder.stops, 1);
  f.recorder.finish(); await tick();
  assert.equal(await f.result()!.blob.text(), 'firstlast'); assert.ok(f.result()!.warning);
});
test('cannot begin recording without a durable draft', async () => {
  const f = fixture({ create: async () => { throw new Error('quota'); } });
  await assert.rejects(f.session.start()); assert.equal(f.recorder.state, 'inactive');
});
test('cancel during draft creation cannot start the microphone recorder afterwards', async () => {
  let release: () => void = () => {}; const gate = new Promise<void>(r => { release = r; });
  const f = fixture({ create: async () => gate }); const starting = f.session.start();
  f.session.stop('cancelled'); release(); await assert.rejects(starting); assert.equal(f.recorder.state, 'inactive');
});

function webm(times: number[]) {
  const element = (id: number[], data: number[]) => [...id, 0x80 | data.length, ...data];
  return Uint8Array.from([
    ...element([0x86], [...new TextEncoder().encode('A_OPUS')]),
    ...element([0xe7], [0]),
    ...times.flatMap(t => element([0xa3], [0x81, (t >> 8) & 255, t & 255, 0x80, 0x80])),
  ]).buffer;
}
test('WebM timeline works without Duration metadata and rejects incomplete/reversed data', () => {
  assert.equal(webmTimelineMs(webm([0, 20, 40])), 60);
  assert.throws(() => webmTimelineMs(webm([0, 40, 20])));
  assert.throws(() => webmTimelineMs(webm([0, 20]).slice(0, -1)));
});
test('13:38 versus 6:27 never receives a normal completion; unknown/recovered also held', () => {
  assert.equal(compareRecordingDuration(818_000, 387_457).status, 'needs_review');
  assert.match(compareRecordingDuration(818_000, 387_457).warning!, /13:38.*6:27/);
  assert.equal(compareRecordingDuration(818_000, 818_050).status, 'duration_checked');
  assert.equal(compareRecordingDuration(818_000, undefined).status, 'needs_review');
  assert.equal(compareRecordingDuration(818_000, 818_050, 'interrupted').status, 'needs_review');
});

test('long streaming WebM unknown-size clusters are siblings, not recursive nesting', () => {
  const parts = Array.from({ length: 200 }, (_, i) => [0x1f, 0x43, 0xb6, 0x75, 0xff,
    ...new Uint8Array(webm([i * 20, i * 20 + 10]))]);
  assert.equal(webmTimelineMs(Uint8Array.from(parts.flat()).buffer), 4000);
});
