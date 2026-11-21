import test from 'node:test';
import assert from 'node:assert/strict';
import { timetableTimeError, updateTimetableTime } from '../src/utils/timetableTime';

test('valid same-day times including midnight are accepted', () => {
  assert.equal(timetableTimeError('00:00', '00:01'), null);
  assert.equal(timetableTimeError('09:00', '23:59'), null);
});
test('missing, malformed, equal and reversed times are rejected', () => {
  for (const [start, end] of [['', '10:00'], ['09:00', ''], ['24:00', '25:00'], ['9:00', '10:00'], ['12:60', '13:00'], ['09:00', '09:00'], ['11:00', '10:00']]) {
    assert.ok(timetableTimeError(start, end));
    assert.throws(() => updateTimetableTime([], 0, start, end));
  }
});
test('edits only selected occurrence, preserving subject/day and other entries', () => {
  const entries = [{ subject: '수학', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }, { subject: '수학', dayOfWeek: 3, startTime: '09:00', endTime: '10:00' }];
  const result = updateTimetableTime(entries, 1, '10:30', '11:45');
  assert.equal(result[0], entries[0]);
  assert.deepEqual(result[1], { ...entries[1], startTime: '10:30', endTime: '11:45' });
  assert.equal(entries[1].startTime, '09:00');
  assert.throws(() => updateTimetableTime(entries, 5, '10:00', '11:00'));
});
