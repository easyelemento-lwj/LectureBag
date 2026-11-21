import type { SemesterTimetable } from '../types';

export type TimetableValue = { timetables: SemesterTimetable[]; storageMode: 'default' | 'timetable' };
export const describeTimetable = (value: TimetableValue) => [
  `보관 방식: ${value.storageMode === 'timetable' ? '시간표별' : '기본'}`,
  ...value.timetables.map(t => {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const meetings = t.entries.map(entry => `${days[entry.dayOfWeek] || '?'} ${entry.startTime}–${entry.endTime} ${entry.subject}`).join(', ');
    return `${t.year}년 ${t.semester} · ${t.startDate}~${t.endDate} · ${meetings || '수업 없음'}`;
  }),
];

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
