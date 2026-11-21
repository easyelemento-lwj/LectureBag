import test from 'node:test';
import assert from 'node:assert/strict';
import { needsInitialChoice, sameTimetable } from '../src/utils/timetableConflict';
import type { SemesterTimetable } from '../src/types';

const local = { timetables: [{ id: 'first', year: 2026, entries: [] } as unknown as SemesterTimetable], storageMode: 'timetable' as const };
test('first sync asks before replacing different existing device data', () => {
  assert.equal(needsInitialChoice(local, 0, { ...local, revision: 1 }), false);
  assert.equal(needsInitialChoice(local, 0, { ...local, revision: 1, timetables: [{ ...local.timetables[0], id: 'other' }] }), true);
  assert.equal(needsInitialChoice({ ...local, timetables: [] }, 0, { ...local, revision: 1 }), false);
  assert.equal(needsInitialChoice(local, 1, { ...local, revision: 2, timetables: [] }), false);
});
test('comparison ignores server revision and object key order, but detects real changes', () => {
  assert.equal(sameTimetable(local, { ...local, revision: 7 } as typeof local), true);
  assert.equal(sameTimetable(local, { ...local, storageMode: 'default' }), false);
});
