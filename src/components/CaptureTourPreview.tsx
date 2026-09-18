import React, { useEffect, useRef, useState } from 'react';
import { Camera, ArrowRight, X } from 'lucide-react';

/** One-step design preview; does not write onboarding completion state. */
export const CaptureTourPreview: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const button = document.querySelector<HTMLElement>('[data-tour="capture"]');
    if (!button) { onClose(); return; }
    const measure = () => {
      const rect = button.getBoundingClientRect();
      setTarget({ left: rect.left - 9, top: rect.top - 9, width: rect.width + 18, height: rect.height + 18 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    window.addEventListener('resize', measure);
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      dialog?.close();
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      aria-labelledby="capture-tour-title"
      aria-describedby="capture-tour-description"
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-neutral-900 backdrop:bg-transparent"
    >
      {target && <div aria-hidden="true" className="pointer-events-none fixed rounded-full border-2 border-white/90" style={{ ...target, boxShadow: '0 0 0 9999px rgba(0,0,0,0.66), 0 0 28px rgba(255,255,255,0.16)' }} />}
      <div className="fixed inset-x-5 mx-auto max-w-sm" style={{ bottom: target ? window.innerHeight - target.top + 24 : 150, maxHeight: 'calc(100dvh - 160px)' }}>
        <section className="relative max-h-[inherit] overflow-y-auto rounded-[28px] border border-white/80 bg-[#fafafa] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-neutral-500">
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-900" />처음 만나는 LectureBag
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="가이드 닫기" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-neutral-900"><X size={18} /></button>
          </div>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-neutral-200 bg-white"><Camera size={22} strokeWidth={1.6} /></div>
          <h2 id="capture-tour-title" className="text-[25px] font-bold leading-tight tracking-tight">판서를 찍어보세요</h2>
          <p id="capture-tour-description" className="mt-3 text-sm leading-6 text-neutral-500">아래 촬영 버튼을 누르면<br />지금 보고 있는 강의 화면을 사진으로 남겨요.</p>
          <div className="mt-6 flex items-center justify-between gap-4 border-t border-neutral-200/80 pt-5">
            <span className="text-xs text-neutral-400">첫 단계 미리보기</span>
            <button type="button" onClick={onClose} className="flex items-center gap-3 rounded-full bg-neutral-900 px-5 py-3 text-sm font-semibold text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">확인했어요<ArrowRight size={16} /></button>
          </div>
        </section>
        <div aria-hidden="true" className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 bg-[#fafafa]" />
      </div>
    </dialog>
  );
};
