import { useEffect, useRef, useState } from 'react';
import { Play, Pause, MoreHorizontal, Loader2, RotateCcw, RotateCw } from 'lucide-react';
import { prepareAudioPlayback } from '../utils/prepareAudioPlayback';
import './audioPlayer.css';

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Only a verified local blob URL reaches this player; never a token-bearing Drive URL. */
export function VerifiedAudioPlayer({ url, onError, compact = false, onTranscript }: { url: string; onError: () => void; key?: string; compact?: boolean; fileName?: string; onTranscript?: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const reportError = useRef(onError); reportError.current = onError;
  const [state, setState] = useState<{ url: string; duration?: number; error?: boolean }>({ url });
  const [playing, setPlaying] = useState(false), [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(1), [menu, setMenu] = useState(false), [notice, setNotice] = useState('');
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!optionsRef.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); optionsButton.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);
  const ready = state.url === url && !!state.duration && !state.error;
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    const controller = new AbortController();
    setState({ url });
    setPlaying(false); setPosition(0); setSpeed(1); setMenu(false); setNotice(''); audio.playbackRate = 1;
    // Setup must undo cleanup too: StrictMode repeats this cycle on mount.
    void prepareAudioPlayback(audio, url, controller.signal).then(duration => {
      if (!controller.signal.aborted) setState({ url, duration });
    }).catch(() => {
      if (!controller.signal.aborted) { setState({ url, error: true }); reportError.current(); }
    });
    return () => { controller.abort(); audio.pause(); audio.removeAttribute('src'); audio.load(); };
  }, [url]);
  const duration = state.duration ?? 0;
  function skip(seconds: number) {
    const audio = ref.current;
    if (!audio || !ready) return;
    const next = Math.max(0, Math.min(duration, audio.currentTime + seconds));
    audio.currentTime = next;
    setPosition(next);
  }
  async function togglePlay() {
    const audio = ref.current;
    if (!audio || !ready) return;
    setNotice('');
    if (!audio.paused) { audio.pause(); return; }
    if (audio.ended) audio.currentTime = 0;
    try { await audio.play(); } catch { setNotice('재생 버튼을 다시 눌러 주세요.'); }
  }
  return <div className="space-y-2" data-audio-state={ready ? 'ready' : state.error ? 'error' : 'preparing'}>
    <p role="status" className={compact && ready ? 'sr-only' : 'text-sm text-neutral-500'}>{state.url === url && state.error
      ? '녹음 재생을 준비하지 못했습니다. 닫았다가 다시 열어 주세요. 원본은 유지됩니다.'
      : ready ? `전체 길이 ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')} · 재생 준비 완료`
        : '전체 길이와 이동 가능한 구간을 확인 중입니다…'}</p>
    <div aria-label="LectureBag 녹음 플레이어" className="rounded-[28px] border border-neutral-200/70 bg-[#F2F2F4] px-4 py-3 text-neutral-800 sm:px-5">
      <div className="min-w-0 py-1">
        <input type="range" aria-label="녹음 재생 위치" aria-valuetext={`${time(position)} / ${time(duration)}`} min={0} max={duration || 1} step={0.1}
          value={Math.min(position, duration)} disabled={!ready} className="lecturebag-audio-seek" style={{ background: `linear-gradient(to right, #262626 ${duration ? position / duration * 100 : 0}%, #D4D4D8 ${duration ? position / duration * 100 : 0}%)` }}
          onChange={e => { const next = Number(e.target.value); if (ready && ref.current) { ref.current.currentTime = next; setPosition(next); } }} />
        <div className="mt-1 flex justify-between text-[11px] font-medium tabular-nums text-neutral-500"><span>{time(position)}</span><span>{ready ? time(duration) : '—:—'}</span></div>
      </div>
      <div className="relative mt-2 grid grid-cols-[44px_1fr_44px] items-center">
        {onTranscript ? <button type="button" aria-label="변환된 텍스트 보기" title="텍스트 보기" onClick={onTranscript} className="h-11 w-11 rounded-full bg-neutral-200/70 text-sm font-semibold">Aa</button> : <span aria-hidden="true" />}
        <div className="flex items-center justify-center gap-3 sm:gap-5">
          <button type="button" aria-label="10초 뒤로" title="10초 뒤로" disabled={!ready} onClick={() => skip(-10)}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-neutral-200 active:scale-95 disabled:opacity-40 focus-visible:outline focus-visible:outline-2">
            <RotateCcw aria-hidden="true" className="h-8 w-8" /><span aria-hidden="true" className="absolute pt-0.5 text-[10px] font-bold">10</span>
          </button>
          <button type="button" aria-label={playing ? '일시정지' : '녹음 재생'} disabled={!ready} onClick={() => void togglePlay()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            {!ready && !state.error ? <Loader2 className="h-5 w-5 animate-spin" /> : playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
          </button>
          <button type="button" aria-label="10초 앞으로" title="10초 앞으로" disabled={!ready} onClick={() => skip(10)}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-neutral-200 active:scale-95 disabled:opacity-40 focus-visible:outline focus-visible:outline-2">
            <RotateCw aria-hidden="true" className="h-8 w-8" /><span aria-hidden="true" className="absolute pt-0.5 text-[10px] font-bold">10</span>
          </button>
        </div>
        <div ref={optionsRef}>
          <button ref={optionsButton} type="button" aria-label="재생 속도 조절" aria-expanded={menu} disabled={!ready} onClick={() => setMenu(value => !value)}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40 focus-visible:outline focus-visible:outline-2 ${menu ? 'bg-neutral-900 text-white' : 'bg-neutral-200/70 hover:bg-neutral-200'}`}><MoreHorizontal className="h-5 w-5" /></button>
          {menu && <div role="group" aria-label="재생 속도" className="absolute right-[52px] top-1/2 z-10 w-max max-w-[calc(100%-52px)] -translate-y-1/2 rounded-2xl border border-neutral-200 bg-white p-1.5 text-neutral-800 shadow-lg">
            <span aria-hidden="true" className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-r border-t border-neutral-200 bg-white" />
            <div className="relative flex flex-wrap justify-center gap-0.5">{[0.75, 1, 1.25, 1.5, 2].map(rate => <button key={rate} type="button" aria-label={`${rate}배속`} aria-pressed={speed === rate}
              onClick={() => { if (ref.current) ref.current.playbackRate = rate; setSpeed(rate); setMenu(false); optionsButton.current?.focus(); }}
              className={`min-h-11 rounded-xl px-2 text-[11px] font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 ${speed === rate ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100 text-neutral-700'}`}>{rate}×</button>)}</div>
          </div>}
        </div>
      </div>
    </div>
    {notice && <p role="status" className="text-xs text-neutral-600">{notice}</p>}
    <audio ref={ref} preload="auto" className="hidden" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onTimeUpdate={() => { if (ready && ref.current) setPosition(Math.min(ref.current.currentTime, duration)); }}
      onEnded={() => { setPlaying(false); setPosition(duration); }} onError={() => {
      if (ready) { setState({ url, error: true }); reportError.current(); }
    }} />
  </div>;
}
