/**
 * BottomNav.tsx — BottomNav equivalent
 *
 * The floating pill-shaped toolbar at the bottom of the screen.
 * Renders one of three layouts depending on mode:
 *   1. Camera Mode     — Photos | Shutter | Folder
 *   2. Audio Idle      — Recordings | Record | Folder
 *   3. Recording Active — Recordings | Pause | Stop | Folder
 */
import React from 'react';
import { Image, Volume2, Folder, Play, Pause, Square } from 'lucide-react';
import { RecordedAudio, CapturedPhoto } from '../types';

interface BottomNavProps {
  isAudioMode: boolean;
  isRecording: boolean;
  isPaused: boolean;
  photos: CapturedPhoto[];
  recordings: RecordedAudio[];

  onTakeSnapshot: () => void;
  onStartRecording: (e?: React.MouseEvent) => void;
  onTogglePauseRecording: (e?: React.MouseEvent) => void;
  onStopRecording: (e?: React.MouseEvent) => void;
  onOpenRecentPhotos: () => void;
  onOpenRecentRecordings: () => void;
  onOpenFolder: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  isAudioMode,
  isRecording,
  isPaused,
  photos,
  recordings,
  onTakeSnapshot,
  onStartRecording,
  onTogglePauseRecording,
  onStopRecording,
  onOpenRecentPhotos,
  onOpenRecentRecordings,
  onOpenFolder,
}) => {
  const pillBase =
    'bg-white/95 backdrop-blur-xl border border-neutral-200/90 shadow-2xl rounded-full h-[84px] px-7 flex items-center justify-between';
  const btnBase =
    'rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-[#333333] hover:text-black active:scale-90 transition-all shadow-md';

  if (isAudioMode && isRecording) {
    /* ── Recording Active ── */
    return (
      <div className={`${pillBase} gap-6`}>
        {/* Recent Recordings */}
        <button
          onClick={onOpenRecentRecordings}
          className={`w-14 h-14 relative ${btnBase}`}
          data-tour="recordings"
          title="최근 녹음 파일"
        >
          <Volume2 className="w-6 h-6 stroke-[2]" />
          {recordings.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-black text-white text-[10px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white">
              {recordings.length}
            </span>
          )}
        </button>

        {/* Pause / Resume */}
        <button
          onClick={onTogglePauseRecording}
          className="w-14 h-14 rounded-full bg-white text-[#333333] flex items-center justify-center active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 hover:bg-neutral-100 shadow-md"
          data-tour={isPaused ? 'resume' : 'pause'}
          title={isPaused ? '녹음 재개' : '녹음 일시정지'}
        >
          {isPaused ? (
            <Play className="w-6 h-6 fill-transparent stroke-[2] ml-0.5" />
          ) : (
            <Pause className="w-6 h-6 fill-transparent stroke-[2]" />
          )}
        </button>

        {/* Stop */}
        <button
          onClick={onStopRecording}
          className="w-14 h-14 rounded-full bg-white text-[#333333] flex items-center justify-center shadow-md active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 hover:bg-neutral-100"
          data-tour="stop"
          title="녹음 완전 정지 및 저장"
        >
          <Square className="w-6 h-6 fill-transparent stroke-[2]" />
        </button>

        {/* Folder */}
        <button
          onClick={onOpenFolder}
          className={`w-14 h-14 ${btnBase}`}
          data-tour="folder"
          title="폴더 탐색기"
        >
          <Folder className="w-6 h-6 stroke-[2]" />
        </button>
      </div>
    );
  }

  if (isAudioMode && !isRecording) {
    /* ── Audio Idle ── */
    return (
      <div className={`${pillBase} gap-7 px-7`}>
        {/* Recent Recordings */}
        <button
          onClick={onOpenRecentRecordings}
          className={`w-14 h-14 relative ${btnBase}`}
          data-tour="recordings"
          title="최근 녹음 파일"
        >
          <Volume2 className="w-6 h-6 stroke-[2]" />
          {recordings.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-black text-white text-[10px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white">
              {recordings.length}
            </span>
          )}
        </button>

        {/* Record Button */}
        <button
          onClick={onStartRecording}
          className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 p-0"
          data-tour="record"
          title="새 녹음 시작"
        >
          <div className="w-11.5 h-11.5 rounded-full border-[3px] border-[#D30000] bg-white" />
        </button>

        {/* Folder */}
        <button
          onClick={onOpenFolder}
          className={`w-14 h-14 ${btnBase}`}
          data-tour="folder"
          title="폴더 탐색기"
        >
          <Folder className="w-6 h-6 stroke-[2]" />
        </button>
      </div>
    );
  }

  /* ── Camera Mode ── */
  return (
    <div className={`${pillBase} gap-7 px-7`}>
      {/* Recent Photos */}
      <button
        onClick={onOpenRecentPhotos}
        className={`w-14 h-14 relative ${btnBase}`}
        data-tour="photo"
        title="최근 찍은 사진"
      >
        <Image className="w-6 h-6 stroke-[2]" />
        {photos.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-black text-white text-[10px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white">
            {photos.length}
          </span>
        )}
      </button>

      {/* Shutter */}
      <button
        data-tour="capture"
        onClick={onTakeSnapshot}
        className="w-16 h-16 rounded-full bg-black text-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 border-white ring-2 ring-neutral-200/60 p-0"
        title="카메라 촬영"
      >
        <div className="w-13 h-13 rounded-full border border-white/40 bg-white" />
      </button>

      {/* Folder */}
      <button
        onClick={onOpenFolder}
        className={`w-14 h-14 ${btnBase}`}
        data-tour="folder"
        title="폴더 탐색기"
      >
        <Folder className="w-6 h-6 stroke-[2]" />
      </button>
    </div>
  );
};
