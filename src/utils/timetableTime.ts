import type { TimetableEntry } from '../types';

export function timetableTimeError(start: string, end: string): string | null {
  const format = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!format.test(start) || !format.test(end)) return '시작 시간과 종료 시간을 모두 입력해 주세요.';
  if (start >= end) return '종료 시간은 시작 시간보다 늦어야 합니다.';
  return null;
}

export function updateTimetableTime(entries: TimetableEntry[], index: number, startTime: string, endTime: string): TimetableEntry[] {
  const error = timetableTimeError(startTime, endTime);
  if (error) throw new Error(error);
  if (!entries[index]) throw new Error('수정할 과목을 찾을 수 없습니다.');
  return entries.map((entry, i) => i === index ? { ...entry, startTime, endTime } : entry);
}
