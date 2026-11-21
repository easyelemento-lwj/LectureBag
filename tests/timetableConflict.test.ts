import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTimetable, needsInitialChoice, sameTimetable } from '../src/utils/timetableConflict';
import type { SemesterTimetable } from '../src/types';

const local = { timetables: [{ id: 'first', year: 2026, entries: [] } as unknown as SemesterTimetable], storageMode: 'timetable' as const };
test('first sync asks before replacing different existing device data', () => {
  assert.equal(needsInitialChoice(local, 0, { ...local, revision: 1 }), false);
  assert.equal(needsInitialChoice(local, 0, { ...local, revision: 1, timetables: [{ ...local.timetables[0], id: 'other' }] }), true);
  assert.equal(needsInitialChoice({ ...local, timetables: [] }, 0, { ...local, revision: 1 }), false);
  assert.equal(needsInitialChoice(local, 1, { ...local, revision: 2, timetables: [] }), false);
});
test('conflict description identifies timetable day, time, subject and storage mode', () => {
  const value = { ...local, timetables: [{ ...local.timetables[0], semester: '1학기', startDate: '2026-03-01', endDate: '2026-06-30', entries: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00', subject: '수학' }] } as SemesterTimetable] };
  assert.match(describeTimetable(value).join(' '), /시간표별.*월 09:00–10:00 수학/);
});
test('comparison ignores server revision and object key order, but detects real changes', () => {
  assert.equal(sameTimetable(local, { ...local, revision: 7 } as typeof local), true);
  assert.equal(sameTimetable(local, { ...local, storageMode: 'default' }), false);
});
