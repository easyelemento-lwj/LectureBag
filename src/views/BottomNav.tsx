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
    'bg-white/95 backdrop-blur-xl border border-neutral-200/90 shadow-xl rounded-full py-2 flex items-center justify-between';
  const btnBase =
    'rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-[#333333] hover:text-black active:scale-90 transition-all shadow-md';

  if (isAudioMode && isRecording) {
    /* ── Recording Active ── */
    return (
      <div className={`${pillBase} gap-5 px-5`}>
        {/* Recent Recordings */}
        <button
          onClick={onOpenRecentRecordings}
          className={`w-12 h-12 relative ${btnBase}`}
          title="최근 녹음 파일"
        >
          <Volume2 className="w-5 h-5 stroke-[2]" />
          {recordings.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-black text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
              {recordings.length}
            </span>
          )}
        </button>

        {/* Pause / Resume */}
        <button
          onClick={onTogglePauseRecording}
          className="w-12 h-12 rounded-full bg-white text-[#333333] flex items-center justify-center active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 hover:bg-neutral-100 shadow-md"
          title={isPaused ? '녹음 재개' : '녹음 일시정지'}
        >
          {isPaused ? (
            <Play className="w-5 h-5 fill-transparent stroke-[2] ml-0.5" />
          ) : (
            <Pause className="w-5 h-5 fill-transparent stroke-[2]" />
          )}
        </button>

        {/* Stop */}
        <button
          onClick={onStopRecording}
          className="w-12 h-12 rounded-full bg-white text-[#333333] flex items-center justify-center shadow-md active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 hover:bg-neutral-100"
          title="녹음 완전 정지 및 저장"
        >
          <Square className="w-5 h-5 fill-transparent stroke-[2]" />
        </button>

        {/* Folder */}
        <button
          onClick={onOpenFolder}
          className={`w-12 h-12 ${btnBase}`}
          title="폴더 탐색기"
        >
          <Folder className="w-5 h-5 stroke-[2]" />
        </button>
      </div>
    );
  }

  if (isAudioMode && !isRecording) {
    /* ── Audio Idle ── */
    return (
      <div className={`${pillBase} gap-6 px-6`}>
        {/* Recent Recordings */}
        <button
          onClick={onOpenRecentRecordings}
          className={`w-12 h-12 relative ${btnBase}`}
          title="최근 녹음 파일"
        >
          <Volume2 className="w-5 h-5 stroke-[2]" />
          {recordings.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-black text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
              {recordings.length}
            </span>
          )}
        </button>

        {/* Record Button */}
        <button
          onClick={onStartRecording}
          className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 p-0"
          title="새 녹음 시작"
        >
          <div className="w-8.5 h-8.5 rounded-full border-[2.5px] border-[#D30000] bg-white" />
        </button>

        {/* Folder */}
        <button
          onClick={onOpenFolder}
          className={`w-12 h-12 ${btnBase}`}
          title="폴더 탐색기"
        >
          <Folder className="w-5 h-5 stroke-[2]" />
        </button>
      </div>
    );
  }

  /* ── Camera Mode ── */
  return (
    <div className={`${pillBase} gap-6 px-6`}>
      {/* Recent Photos */}
      <button
        onClick={onOpenRecentPhotos}
        className={`w-13 h-13 relative ${btnBase}`}
        title="최근 찍은 사진"
      >
        <Image className="w-5.5 h-5.5 stroke-[2]" />
        {photos.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-black text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
            {photos.length}
          </span>
        )}
      </button>

      {/* Shutter */}
      <button
        onClick={onTakeSnapshot}
        className="w-13 h-13 rounded-full bg-black text-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 border-white ring-2 ring-neutral-200/60 p-0"
        title="카메라 촬영"
      >
        <div className="w-10.5 h-10.5 rounded-full border border-white/40 bg-white" />
      </button>

      {/* Folder */}
      <button
        onClick={onOpenFolder}
        className={`w-13 h-13 ${btnBase}`}
        title="폴더 탐색기"
      >
        <Folder className="w-5.5 h-5.5 stroke-[2]" />
      </button>
    </div>
  );
};
