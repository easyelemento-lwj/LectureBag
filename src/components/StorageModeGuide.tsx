import { CalendarDays, Check, ChevronRight, Folder } from 'lucide-react';

const modes = [
  { id: 'default', name: '디폴트 모드', title: '날짜별로 차곡차곡',
    description: '촬영·녹음한 날짜를 기준으로 사진과 음성을 자동 정리해요.',
    steps: ['연도', '상하반기', '달', '일'], note: '시간표 없이 바로 사용할 수 있어요.', icon: Folder },
  { id: 'timetable', name: '시간표 모드', title: '강의별로 한눈에',
    description: '등록한 시간표와 촬영·녹음 시간을 연결해 과목별로 정리해요.',
    steps: ['연도', '학기', '과목', '달', '일'], note: '시간표 사진을 먼저 등록해주세요.', icon: CalendarDays },
] as const;

export function StorageModeGuide({ mode }: { mode: 'default' | 'timetable' }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="파일 정리 방식 안내">
      {modes.map(item => {
        const active = mode === item.id;
        const Icon = item.icon;
        return (
          <section key={item.id} aria-label={`${item.name}${active ? ', 사용 중' : ''}`}
            className={`min-w-0 rounded-2xl border p-4 sm:p-5 transition-colors ${active ? 'border-neutral-900 bg-white shadow-xs' : 'border-neutral-200/70 bg-neutral-50/70'}`}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500 border border-neutral-200/70'}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <h5 className="text-xs font-bold text-neutral-700">{item.name}</h5>
              </div>
              {active && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-900 px-2.5 py-1 text-[10px] font-bold text-white">
                <Check className="h-3 w-3" aria-hidden="true" />사용 중
              </span>}
            </div>
            <p className="text-base font-bold tracking-tight text-neutral-900">{item.title}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{item.description}</p>
            <div className="mt-4 border-t border-neutral-200/70 pt-3.5">
              <p className="mb-2 text-[10px] font-semibold text-neutral-400">폴더가 정리되는 순서</p>
              <ol className="flex flex-wrap items-center gap-y-2" aria-label="폴더 순서">
                {item.steps.map((step, index) => (
                  <li key={step} className="flex items-center">
                    {index > 0 && <ChevronRight className="mx-1 h-3 w-3 text-neutral-300" aria-hidden="true" />}
                    <span className="rounded-lg border border-neutral-200/70 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-700">{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">{item.note}</p>
            </div>
          </section>
        );
      })}
    </div>
  );
}
