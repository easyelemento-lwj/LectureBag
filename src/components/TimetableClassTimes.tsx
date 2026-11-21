import { useId, useState } from 'react';
import { Clock3, Pencil } from 'lucide-react';
import type { TimetableEntry } from '../types';
import { timetableTimeError } from '../utils/timetableTime';

const button = 'min-h-11 rounded-full bg-[#EFEFEF] px-4 text-xs font-semibold text-neutral-700 hover:bg-[#E2E2E2] active:scale-95 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700';

export function TimetableClassTimes({ entries, onSave }: { entries: TimetableEntry[]; onSave: (index: number, start: string, end: string) => void }) {
  return <div className="space-y-2" aria-label="과목별 강의 시간">
    {entries.map((entry, index) => <ClassTime key={`${index}-${entry.subject}-${entry.dayOfWeek}`} entry={entry} onSave={(start, end) => onSave(index, start, end)} />)}
  </div>;
}

function ClassTime({ entry, onSave }: { key?: string; entry: TimetableEntry; onSave: (start: string, end: string) => void }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(entry.startTime);
  const [end, setEnd] = useState(entry.endTime);
  const [error, setError] = useState<string | null>(null);
  return <div className="rounded-2xl border border-neutral-200/80 bg-white p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-600">{['일', '월', '화', '수', '목', '금', '토'][entry.dayOfWeek]}</span>
          <span className="break-words text-xs font-semibold text-neutral-900">{entry.subject}</span>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs tabular-nums text-neutral-500"><Clock3 aria-hidden="true" className="h-3.5 w-3.5" />{entry.startTime} – {entry.endTime}</p>
      </div>
      {!editing && <button type="button" className={button + ' inline-flex items-center gap-1.5'} aria-label={`${entry.subject} 시간 수정`} onClick={() => { setStart(entry.startTime); setEnd(entry.endTime); setError(null); setEditing(true); }}><Pencil aria-hidden="true" className="h-3.5 w-3.5" />시간 수정</button>}
    </div>
    {editing && <div className="mt-3 border-t border-neutral-100 pt-3">
      <div className="grid grid-cols-2 gap-3">
        {[{ label: '시작 시간', value: start, change: setStart, suffix: 'start' }, { label: '종료 시간', value: end, change: setEnd, suffix: 'end' }].map(field => <label key={field.suffix} className="min-w-0 text-[11px] font-semibold text-neutral-500" htmlFor={`${id}-${field.suffix}`}>
          {field.label}
          <input id={`${id}-${field.suffix}`} type="time" step={60} value={field.value} onChange={e => { field.change(e.target.value); setError(null); }} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className="mt-1.5 block min-h-11 w-full min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 px-2 text-base tabular-nums text-neutral-800 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200" />
        </label>)}
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-2 text-xs leading-snug text-amber-700">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={button} onClick={() => setEditing(false)}>취소</button>
        <button type="button" className={button} onClick={() => {
          const invalid = timetableTimeError(start, end);
          if (invalid) { setError(invalid); return; }
          onSave(start, end); setEditing(false);
        }}>저장</button>
      </div>
    </div>}
  </div>;
}
