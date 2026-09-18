import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X, Camera, Folder, Image, Mic, Pause, Play, Square, Download, Sparkles, ArrowUpDown, Plus, Search, LayoutGrid, CalendarDays, FileText, Activity, CheckCircle2, type LucideIcon } from 'lucide-react';

type Control = { id: string; label: string; icon: LucideIcon };
export type TutorialStep = { chapter: number; screen: string; target: string; title: string; description: string; controls: Control[]; selected?: number; items?: { target: string; anchor?: string; title: string; description: string }[] };
const c = (id: string, label: string, icon: LucideIcon): Control => ({ id, label, icon });
const camera = [c('photo', '최근 사진', Image), c('capture', '사진 찍기', Camera), c('folder', '파일 탐색기', Folder), c('audio', '녹음 모드', Mic)];
const audio = [c('recordings', '최근 녹음', Mic), c('record', '녹음 시작', Mic), c('folder', '파일 탐색기', Folder)];
const recording = [audio[0], c('pause', '일시정지', Pause), c('stop', '멈추고 저장', Square)];
const paused = [audio[0], c('resume', '재개', Play), recording[2]];
const explorer = [c('add', '파일 추가', Plus), c('search', '파일 검색', Search), c('apps', '앱센터', LayoutGrid), c('filters', '전체 / 사진 / 녹음', Folder), c('photos', '사진', Image), c('audios', '녹음', Mic), c('child', '2026년 › 하반기 › 9월', Folder)];
const selection = [c('file', '판서_01.jpg', CheckCircle2), c('file2', '판서_02.jpg', Image), c('file3', '강의_03.m4a', Mic), c('download', '다운로드', Download), c('ai', 'AI 정리', Sparkles), c('reorder', '순서 변경', ArrowUpDown)];
const apps = [c('timetable', '시간표 등록', CalendarDays), c('aiCenter', 'AI 센터', Sparkles)];
const timetable = [c('default', '디폴트 모드 적용', Folder), c('schedule', '시간표 모드 적용', CalendarDays), c('upload', '새로운 시간표 추가하기', Plus)];
const aiCenter = [c('document', '강의 요약.md', FileText), c('sessions', '진행 중인 AI 정리', Activity)];
const step = (chapter: number, screen: string, controls: Control[], target: string, title: string, description: string, selected?: number): TutorialStep => ({ chapter, screen, controls, target, title, description, selected });
export const tutorialSteps: TutorialStep[] = [
  {
    ...step(1, '카메라 화면', camera, 'capture', '카메라 화면을 살펴보세요', '촬영, 파일 탐색기, 최근 사진, 녹음 기능을 한곳에서 이용해요.'),
    items: [
      { target: 'capture', title: '판서를 찍어보세요', description: '촬영 버튼으로 강의 화면을 사진으로 남겨요.' },
      { target: 'folder', title: '기록은 폴더에 모여요', description: '폴더 버튼으로 저장된 사진과 녹음을 찾아요.' },
      { target: 'photo', title: '방금 찍은 사진을 확인해요', description: '최근 사진 버튼으로 촬영한 사진을 확인해요.' },
      { target: 'audio', title: '강의 음성도 남겨보세요', description: '마이크 버튼으로 녹음 화면을 열고 녹음을 시작해요.' },
    ],
  },
  {
    ...step(3, '녹음 화면', [...recording, paused[1]], 'pause', '녹음 화면을 살펴보세요', '일시정지, 재개, 저장, 최근 녹음 확인 방법을 함께 알아봐요.'),
    items: [
      { target: 'pause', title: '잠깐 쉬어갈 수 있어요', description: '일시정지 버튼으로 녹음을 잠시 멈춰요.' },
      { target: 'resume', anchor: 'pause', title: '이어서 녹음해요', description: '일시정지하면 같은 버튼이 재개 버튼으로 바뀌어요. 누르면 이어서 녹음해요.' },
      { target: 'stop', title: '멈추고 저장해요', description: '네모 버튼으로 녹음을 종료하고 저장해요.' },
      { target: 'recordings', title: '최근 녹음을 확인해요', description: '최근 녹음 버튼으로 저장한 음성을 확인하고 재생해요.' },
    ],
  },
  step(3, '녹음 화면', audio, 'folder', '이제 파일 탐색기를 살펴볼게요', '폴더 버튼으로 저장된 사진과 녹음을 관리할 수 있어요. 다음을 누르면 파일 탐색기로 이동해요.'),
  {
    ...step(5, '파일 탐색기', explorer, 'add', '파일 탐색기를 살펴보세요', '파일 추가, 검색, 앱센터 기능을 한곳에서 이용해요.'),
    items: [
      { target: 'add', title: '기존 파일도 추가해요', description: '더하기 버튼으로 기기에 있는 파일을 가져와요. 촬영일 기준으로 분류하거나 저장할 날짜를 지정할 수 있어요.' },
      { target: 'search', title: '필요한 파일을 검색해요', description: '검색 버튼을 누르고 파일 이름을 입력해 원하는 자료를 찾아보세요.' },
      { target: 'apps', title: '앱센터를 열어요', description: '앱센터 버튼에서 시간표 등록과 AI 센터로 이동할 수 있어요.' },
    ],
  },
  step(5, '파일 탐색기', explorer, 'filters', '종류별로 기록을 골라봐요', '전체에서는 사진과 녹음을 함께 보고, 사진이나 녹음 버튼을 누르면 원하는 종류의 파일만 모아볼 수 있어요.'),
  step(5, '파일 탐색기', explorer, 'child', '폴더 안으로 들어가요', '폴더를 짧게 누르면 하위 폴더가 열려요. 날짜나 과목을 따라 들어가면 개별 파일을 만날 수 있어요.'),
  step(6, '파일 탐색기 · 선택 기능', [c('hold', '9월 15일 폴더 · 길게 누르기', Folder)], 'hold', '길게 눌러 한 번에 선택해요', '폴더를 길게 누르면 선택 모드가 시작되고 폴더 안의 파일들이 함께 선택돼요.'),
  step(6, '최하위 폴더 · 선택 기능', selection, 'file', '필요한 파일만 남겨요', '폴더 안의 파일 3개가 모두 선택됐어요. 최하위 폴더에서는 파일을 눌러 개별 선택을 해제하거나 다시 선택할 수 있어요.', 3),
  {
    ...step(6, '최하위 폴더 · 선택 기능', selection, 'download', '선택한 파일을 활용해보세요', '다운로드, AI 정리, 파일 순서 변경 방법을 함께 알아봐요.', 3),
    items: [
      { target: 'download', title: '선택한 파일을 내려받아요', description: '다운로드 버튼으로 선택한 자료를 기기에 저장해요.' },
      { target: 'ai', title: '선택한 자료를 AI로 정리해요', description: 'AI 버튼으로 사진과 녹음을 정리해요. 결과와 진행 상황은 AI 센터에서 확인해요.' },
      { target: 'reorder', title: '한 파일의 위치를 바꿔요', description: '1개 선택 후 순서 변경을 누르고 카드를 끌어 옮겨요. 최하위 폴더에 파일이 2개 이상 있어야 해요.' },
      { target: 'reorder', title: '여러 파일을 묶어서 옮겨요', description: '2개 이상 선택하면 묶음으로 이동해요. 위치를 옮긴 뒤 순서 변경 버튼을 다시 누르면 적용돼요.' },
    ],
  },
  step(6, '파일 탐색기', explorer, 'apps', '이제 앱 센터를 살펴볼게요', '앱 센터 버튼에서 시간표와 AI 정리 기능을 만날 수 있어요. 다음을 누르면 앱 센터로 이동해요.'),
  step(7, '앱센터', apps, 'timetable', '시간표를 등록해요', '시간표 등록에서 자료가 저장되는 분류 방식을 설정하고 수업 시간표를 추가할 수 있어요.'),
  {
    ...step(8, '시간표 등록', timetable, 'default', '기록을 정리하는 방법을 골라보세요', '디폴트 모드와 시간표 모드의 차이를 함께 알아봐요.'),
    items: [
      { target: 'default', title: '날짜 기준으로 정리해요', description: '디폴트 모드는 시간표 없이 연도 → 상하반기 → 달 → 일 순서로 사진과 녹음을 자동 분류해요.' },
      { target: 'schedule', title: '수업에 맞춰 정리해요', description: '시간표 사진을 등록하고 시간표 모드를 적용하면 강의 시간에 맞춰 연도 → 학기 → 과목 → 달 → 일 순서로 자동 분류해요.' },
    ],
  },
  step(7, '앱센터', apps, 'aiCenter', 'AI 정리 자료를 모아봐요', 'AI 센터에서는 정리된 문서와 진행 중인 정리 작업을 확인할 수 있어요.'),
  {
    ...step(9, 'AI 센터', aiCenter, 'document', 'AI 정리 결과를 확인해보세요', '정리된 문서와 진행 중인 작업을 한곳에서 확인해요.'),
    items: [
      { target: 'document', title: '정리된 내용을 열어봐요', description: 'AI 정리가 끝난 파일을 누르면 요약 문서를 읽을 수 있어요.' },
      { target: 'sessions', title: '진행 상황도 확인해요', description: '진행 현황 버튼을 누르면 진행 중인 AI 정리 세션과 작업 상태를 볼 수 있어요.' },
    ],
  },
];

/** The modal blocks real actions while the app presents each tutorial page. */
export function AppTutorial({ index, onStepChange, onClose }: {
  index: number;
  onStepChange: (index: number) => void;
  onClose: (completed: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [geometry, setGeometry] = useState<{ left: number; top: number; width: number; height: number; viewportWidth: number; viewportHeight: number; cardHeight: number } | null>(null);
  const [highlights, setHighlights] = useState<{ left: number; top: number; width: number; height: number; label: string }[]>([]);
  const current = tutorialSteps[index];
  const Icon = current.controls.find(control => control.id === current.target)!.icon;
  const targetId = current.target === 'hold' || current.target === 'child' ? 'folder-item' : current.target === 'file' ? 'file-item' : current.target;
  const next = () => index === tutorialSteps.length - 1 ? onClose(true) : onStepChange(index + 1);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
    setGeometry(null);
    setHighlights([]);
    let frame = 0;
    let scrolled = false;
    // Follow the real controls through page/toolbar animations and orientation changes.
    const measure = () => {
      if (current.items) {
        const targets = new Map<string, number[]>();
        current.items.forEach((item, index) => {
          const anchor = item.anchor ?? item.target;
          targets.set(anchor, [...(targets.get(anchor) ?? []), index + 1]);
        });
        const rects = [...targets].flatMap(([anchor, numbers]) => {
          const element = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
          if (!element) return [];
          const rect = element.getBoundingClientRect();
          return rect.width ? [{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16, label: numbers.join('·') }] : [];
        });
        setHighlights(previous => JSON.stringify(previous) === JSON.stringify(rects) ? previous : rects);
      }
      const elements = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${targetId}"]`));
      const target = elements.reverse().find(element => element.getBoundingClientRect().width > 0);
      if (target) {
        if (!scrolled) {
          // Scroll only a page's scrollable content, never its fixed/hidden shell.
          let parent = target.parentElement;
          while (parent) {
            if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
              const bounds = parent.getBoundingClientRect();
              const targetBounds = target.getBoundingClientRect();
              if (targetBounds.top < bounds.top) parent.scrollTop -= bounds.top - targetBounds.top + 8;
              else if (targetBounds.bottom > bounds.bottom) parent.scrollTop += targetBounds.bottom - bounds.bottom + 8;
              break;
            }
            parent = parent.parentElement;
          }
          scrolled = true;
        }
        const rect = target.getBoundingClientRect();
        const nextGeometry = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, cardHeight: cardRef.current?.getBoundingClientRect().height ?? 360 };
        setGeometry(previous => previous && Object.keys(nextGeometry).every(key => Math.abs(previous[key as keyof typeof nextGeometry] - nextGeometry[key as keyof typeof nextGeometry]) < 0.5) ? previous : nextGeometry);
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [index, targetId]);
  const aboveSpace = geometry ? geometry.top - 40 : 0;
  const belowSpace = geometry ? geometry.viewportHeight - geometry.top - geometry.height - 40 : 0;
  const leftSpace = geometry ? geometry.left - 40 : 0;
  const rightSpace = geometry ? geometry.viewportWidth - geometry.left - geometry.width - 40 : 0;
  const beside = !current.items && Math.max(aboveSpace, belowSpace) < 300 && Math.max(leftSpace, rightSpace) >= 288;
  const right = rightSpace > leftSpace;
  const above = aboveSpace > belowSpace;
  const width = geometry ? Math.min(384, beside ? (right ? rightSpace : leftSpace) : geometry.viewportWidth - 32) : 384;
  const left = geometry ? (beside ? (right ? geometry.left + geometry.width + 24 : geometry.left - width - 24) : Math.max(16, Math.min(geometry.left + geometry.width / 2 - width / 2, geometry.viewportWidth - width - 16))) : 16;
  const overviewTop = current.chapter === 1 && highlights.length === 4 ? highlights[3].top + highlights[3].height + 16 : 84;
  const overviewHeight = current.chapter === 1 && highlights.length === 4 ? Math.max(120, Math.min(...highlights.slice(0, 3).map(rect => rect.top)) - 16 - overviewTop) : undefined;
  const maxHeight = current.items && overviewHeight !== undefined ? overviewHeight : geometry ? (beside ? geometry.viewportHeight - 32 : Math.max(120, above ? aboveSpace : belowSpace)) : undefined;
  const compact = Boolean(current.items) || (maxHeight !== undefined && maxHeight < 380);
  const cramped = maxHeight !== undefined && maxHeight < 220;
  const height = geometry ? Math.min(geometry.cardHeight, maxHeight!) : 360;
  const top = current.items && overviewHeight !== undefined ? overviewTop + Math.max(0, (overviewHeight - height) / 2) : geometry ? (beside ? Math.max(16, Math.min(geometry.top + geometry.height / 2 - height / 2, geometry.viewportHeight - height - 16)) : above ? Math.max(16, geometry.top - height - 24) : geometry.top + geometry.height + 24) : undefined;
  const arrowLeft = geometry ? Math.max(24, Math.min(width - 24, geometry.left + geometry.width / 2 - left)) : width / 2;
  const arrowTop = geometry ? Math.max(24, Math.min(height - 24, geometry.top + geometry.height / 2 - top!)) : 24;
  const nextChapter = tutorialSteps[index + 1]?.chapter !== current.chapter;
  return (
    <dialog ref={dialogRef} onCancel={() => onClose(false)} aria-labelledby="app-tour-title" aria-describedby="app-tour-description" className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-neutral-900 backdrop:bg-transparent">
      {current.items && highlights.length > 0 ? <svg aria-hidden="true" className="pointer-events-none fixed inset-0 h-full w-full">
        <defs><mask id="tutorial-overview-mask"><rect width="100%" height="100%" fill="white" />{highlights.map((rect, i) => <rect key={i} x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx="16" fill="black" />)}</mask></defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.66)" mask="url(#tutorial-overview-mask)" />
        {highlights.map((rect, i) => <g key={i}><rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx="16" fill="none" stroke="white" strokeWidth="2" /><rect x={rect.left - 2} y={rect.top - 2} width={rect.label.length > 1 ? 32 : 20} height="20" rx="10" fill="#171717" stroke="white" /><text x={rect.left + (rect.label.length > 1 ? 14 : 8)} y={rect.top + 8} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="11" fontWeight="600">{rect.label}</text></g>)}
      </svg> : geometry ? <div aria-hidden="true" className="pointer-events-none fixed rounded-2xl border-2 border-white/90" style={{ left: geometry.left - 8, top: geometry.top - 8, width: geometry.width + 16, height: geometry.height + 16, boxShadow: '0 0 0 9999px rgba(0,0,0,0.66)' }} /> : <div className="fixed inset-0 bg-black/65" />}
      <div className="fixed" style={geometry ? { width, left, top } : { width: 'calc(100% - 32px)', maxWidth: 384, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
        <section ref={cardRef} className={`relative flex flex-col overflow-hidden rounded-[28px] border border-white/80 bg-[#fafafa] shadow-[0_24px_80px_rgba(0,0,0,0.3)] ${cramped ? 'p-3' : compact ? 'p-4' : 'p-6'}`} style={{ maxHeight: maxHeight ?? 'calc(100dvh - 48px)' }}>
          {!cramped && <div className={`flex shrink-0 items-center justify-between gap-2 ${compact ? 'mb-2' : 'mb-5'}`}>
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-neutral-500"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-900" />처음 만나는 LectureBag</div>
            <button type="button" onClick={() => onClose(false)} aria-label="튜토리얼 닫기" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-neutral-900 text-neutral-400"><X size={18} /></button>
          </div>}
          <div ref={contentRef} className="min-h-0 overflow-y-auto">
          {!compact && <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-neutral-200 bg-white"><Icon size={22} strokeWidth={1.6} /></div>}
          <h2 ref={headingRef} tabIndex={-1} id="app-tour-title" className={`${compact ? 'text-xl' : 'text-[25px]'} font-bold leading-tight tracking-tight outline-none`}>{current.title}</h2>
          <p id="app-tour-description" className={current.items ? 'sr-only' : 'mt-3 text-sm leading-6 text-neutral-500'}>{current.description}</p>
          {current.items && <ol className="mt-3 divide-y divide-neutral-200/80 px-1 pt-1 pb-1">
            {current.items.map((item, i) => {
              const ItemIcon = current.controls.find(control => control.id === item.target)!.icon;
              return <li key={`${item.target}-${i}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white"><ItemIcon size={18} strokeWidth={1.6} /><span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-[9px] font-semibold text-white">{i + 1}</span></div>
                <div className="min-w-0 break-words"><h3 className="text-sm font-bold leading-5">{item.title}</h3><p className="mt-1 text-xs leading-5 text-neutral-500">{item.description}</p></div>
              </li>;
            })}
          </ol>}
          {[5, 6, 9].includes(current.chapter) && <p className="mt-2 text-[11px] text-neutral-400">안내용 가상 파일이에요. 실제 파일로 저장되지 않아요.</p>}
          </div>
          <div className={`flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200/80 ${cramped ? 'mt-2 pt-2' : compact ? 'mt-3 pt-3' : 'mt-6 pt-5'}`}>
            <button type="button" disabled={index === 0} onClick={() => onStepChange(index - 1)} className="flex min-h-11 items-center gap-1 text-xs text-neutral-500 disabled:opacity-30"><ArrowLeft size={14} />이전</button>
            {cramped && <button type="button" onClick={() => onClose(false)} aria-label="튜토리얼 닫기" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-300"><X size={16} /></button>}
            <button type="button" onClick={next} className="flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-700">{index === tutorialSteps.length - 1 ? '시작하기' : nextChapter && !['folder', 'apps'].includes(current.target) ? '다음 화면' : '다음'}<ArrowRight size={16} /></button>
          </div>
        </section>
        {geometry && !current.items && <div aria-hidden="true" className="pointer-events-none absolute h-4 w-4 rotate-45 bg-[#fafafa]" style={beside ? { top: arrowTop - 8, ...(right ? { left: -8 } : { right: -8 }) } : { left: arrowLeft - 8, ...(above ? { bottom: -8 } : { top: -8 }) }} />}
      </div>
    </dialog>
  );
}
