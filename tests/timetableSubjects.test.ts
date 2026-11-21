import test from 'node:test';
import assert from 'node:assert/strict';
import { countTimetableSubjects } from '../src/utils/timetableSubjects';

const entriesFor = (subjects: string[]) => subjects.map((subject, dayOfWeek) => ({ subject, dayOfWeek, startTime: '09:00', endTime: '10:00' }));

test('seven meetings of five subjects count as five without changing meetings', () => {
  const entries = entriesFor(['경영통계학', '경영통계학', '파이썬 프로그래밍', '파이썬 프로그래밍', '데이터분석', '회계학', '조직행동론']);
  const before = structuredClone(entries);
  assert.equal(countTimetableSubjects(entries), 5);
  assert.deepEqual(entries, before);
});

test('normalizes surrounding/repeated whitespace and Unicode but preserves distinct names', () => {
  assert.equal(countTimetableSubjects(entriesFor([' 수학 ', '수학'.normalize('NFD'), '자료  구조', '자료\n구조', '수학 II'])), 3);
  assert.equal(countTimetableSubjects(entriesFor(['', '  '])), 0);
  assert.equal(countTimetableSubjects([]), 0);
});
