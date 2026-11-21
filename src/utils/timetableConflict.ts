import type { SemesterTimetable } from '../types';

export type TimetableValue = { timetables: SemesterTimetable[]; storageMode: 'default' | 'timetable' };

/** Compare content without depending on object-key order or optional undefined fields. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const sameTimetable = (a: TimetableValue, b: TimetableValue) =>
  JSON.stringify(canonical({ timetables: a.timetables, storageMode: a.storageMode })) ===
  JSON.stringify(canonical({ timetables: b.timetables, storageMode: b.storageMode }));
export const needsInitialChoice = (local: TimetableValue, revision: number, remote: TimetableValue & { revision: number }) =>
  revision === 0 && remote.revision > 0 && local.timetables.length > 0 && !sameTimetable(local, remote);
