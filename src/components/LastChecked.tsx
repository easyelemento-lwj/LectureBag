import { Clock3 } from 'lucide-react';

export function LastChecked({ checkedAt, preview = false, plain = false }: { checkedAt?: string | number | null; preview?: boolean; plain?: boolean }) {
  const date = checkedAt ? new Date(checkedAt) : null;
  const valid = date && !Number.isNaN(date.getTime()) ? date : null;
  const today = valid?.toDateString() === new Date().toDateString();
  const label = preview ? '오늘 오전 10:24' : valid
    ? `${today ? '오늘' : valid.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', ...(valid.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) })} ${valid.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}`
    : '확인 기록 없음';
  return <span className={'flex w-full max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-snug ' + (plain ? 'py-2.5' : 'rounded-xl border border-neutral-200/60 bg-white/60 px-3 py-2.5')}>
    <span className="inline-flex shrink-0 items-center gap-1.5 text-neutral-500"><Clock3 aria-hidden="true" className="h-3.5 w-3.5" />마지막 확인</span>
    <span className="ml-auto text-right font-medium tabular-nums text-neutral-700">
      {valid && !preview ? <time dateTime={valid.toISOString()} title={valid.toLocaleString('ko-KR')}>{label}</time> : label}
      {preview && <span className="ml-1 font-normal text-neutral-400">(예시)</span>}
    </span>
  </span>;
}
