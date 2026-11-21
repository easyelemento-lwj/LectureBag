import type { TimetableEntry } from '../types';

// Count subjects without removing any of their individual class meetings.
export function countTimetableSubjects(entries: readonly TimetableEntry[]): number {
  return new Set(entries.map(({ subject }) => subject.normalize('NFC').replace(/\s+/g, ' ').trim()).filter(Boolean)).size;
}
