import { useState, type FC, type ReactNode } from 'react';

const slides = [
  {
    image: '/tutorial/01-capture.png',
    title: '강의 순간을 기록하세요',
    description: '판서를 촬영하고 강의를 녹음해 필요한 내용을 남겨보세요.',
  },
  {
    image: '/tutorial/02-timetable.png',
    title: '시간표에 맞춰 자동 정리',
    description: '시간표를 등록하고 시간표 모드를 켜면 강의 시간에 맞는 과목 폴더로 기록을 정리해요.',
  },
  {
    image: '/tutorial/03-archive.png',
    title: '필요한 기록을 다시 찾아요',
    description: '폴더에서 과목별·날짜별로 사진과 녹음을 확인하세요.',
  },
];

/** AuthGate mounts this per account, before MainView requests device access. */
export const TutorialGate: FC<{ userId: string; children: ReactNode }> = ({ userId, children }) => {
  const storageKey = `lecture_snap_tutorial_completed_v1:${userId}`;
  const [completed, setCompleted] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'true';
    } catch {
      return false;
    }
  });
  const [step, setStep] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);

  const finish = () => {
    try {
      localStorage.setItem(storageKey, 'true');
    } catch {
      // Storage restrictions must not prevent the user from entering the app.
    }
    setCompleted(true);
  };

  if (completed) return <>{children}</>;

  const slide = slides[step];
  const isLast = step === slides.length - 1;
  const focusStyle = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2';

  return (
    <main
      aria-label="LectureBag 시작 안내"
      className="fixed inset-0 overflow-y-auto bg-neutral-50 px-5 text-neutral-900"
      style={{ paddingTop: 'max(20px, env(safe-area-inset-top))', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', paddingLeft: 'max(20px, env(safe-area-inset-left))', paddingRight: 'max(20px, env(safe-area-inset-right))' }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-5">
        <header className="flex items-center justify-between gap-4">
          <span className="text-base font-bold tracking-tight">LectureBag</span>
          <button type="button" onClick={finish} className={`rounded-lg px-3 py-3 text-sm text-neutral-500 hover:bg-neutral-100 ${focusStyle}`}>
            건너뛰기
          </button>
        </header>

        <section aria-live="polite" aria-atomic="true" className="flex flex-1 flex-col items-center justify-center text-center">
          {failedImages.includes(slide.image) ? (
            <div className="flex aspect-square w-full max-w-[min(360px,42dvh)] items-center justify-center rounded-3xl border border-neutral-200 bg-white text-neutral-400" aria-hidden="true">
              <span className="text-6xl font-bold">0{step + 1}</span>
            </div>
          ) : (
            <img
              key={slide.image}
              src={slide.image}
              alt=""
              width={1024}
              height={1024}
              className="aspect-square w-full max-w-[min(360px,42dvh)] rounded-3xl object-contain"
              onError={() => setFailedImages(previous => [...previous, slide.image])}
            />
          )}
          <p className="mt-5 text-xs font-medium text-neutral-500">{step + 1} / {slides.length}</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">{slide.title}</h1>
          <p className="mt-3 min-h-12 text-sm leading-relaxed text-neutral-500">{slide.description}</p>
        </section>

        <footer className="flex gap-3 pb-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep(previous => previous - 1)} className={`rounded-xl border border-neutral-200 bg-white px-6 py-4 text-sm font-bold hover:bg-neutral-100 ${focusStyle}`}>
              이전
            </button>
          )}
          <button type="button" onClick={isLast ? finish : () => setStep(previous => previous + 1)} className={`flex-1 rounded-xl bg-neutral-900 px-6 py-4 text-sm font-bold text-white hover:bg-neutral-700 ${focusStyle}`}>
            {isLast ? '시작하기' : '다음'}
          </button>
        </footer>
      </div>
    </main>
  );
};
