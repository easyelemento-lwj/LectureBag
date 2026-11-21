/**
 * BottomNav.tsx — BottomNav equivalent
 *
 * The floating pill-shaped toolbar at the bottom of the screen.
 * Renders one of three layouts depending on mode:
 *   1. Camera Mode     — Audio Mode | Shutter | Folder
 *   2. Audio Idle      — Camera Mode | Record | Folder
 *   3. Recording Active — Camera Mode | Pause | Stop | Folder
 */
import React from 'react';
import { Camera, Mic, Folder, Play, Pause, Square } from 'lucide-react';

interface BottomNavProps {
  isAudioMode: boolean;
  isRecording: boolean;
  isPaused: boolean;
  captureDisabled?: boolean;
  recordingTime?: string;
  recordingSaving?: boolean;

  onTakeSnapshot: () => void;
  onStartRecording: (e?: React.MouseEvent) => void;
  onTogglePauseRecording: (e?: React.MouseEvent) => void;
  onStopRecording: (e?: React.MouseEvent) => void;
  onSwitchMode: () => void;
  onOpenFolder: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  isAudioMode,
  isRecording,
  isPaused,
  captureDisabled,
  recordingTime,
  recordingSaving,
  onTakeSnapshot,
  onStartRecording,
  onTogglePauseRecording,
  onStopRecording,
  onSwitchMode,
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
        <button onClick={onSwitchMode} className={`w-14 h-14 ${btnBase}`} data-tour="camera" title="카메라 모드 전환" aria-label="카메라 모드 전환"><Camera className="w-6 h-6" /></button>

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
        <button onClick={onSwitchMode} className={`w-14 h-14 ${btnBase}`} data-tour="camera" title="카메라 모드 전환" aria-label="카메라 모드 전환"><Camera className="w-6 h-6" /></button>

        {/* Record Button */}
        <button
          disabled={recordingSaving}
          onClick={onStartRecording}
          className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 p-0"
          data-tour="record"
          title={recordingSaving ? '녹음 저장 중' : '새 녹음 시작'}
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
      {RECORDING_ENABLED && <button onClick={onSwitchMode} className={`w-14 h-14 ${btnBase} flex-col gap-0.5`} data-tour="audio" title={isRecording ? '진행 중인 녹음 보기' : '녹음 모드 전환'} aria-label={isRecording ? `녹음 ${isPaused ? '일시정지' : '중'} ${recordingTime}, 녹음 화면 열기` : '녹음 모드 전환'}>
        <Mic className={`w-6 h-6 ${isRecording && !isPaused ? 'text-red-600' : ''}`} />
        {isRecording && <span className="text-[10px] tabular-nums leading-none">{recordingTime}</span>}
      </button>}

      {/* Shutter */}
      <button
        data-tour="capture"
        disabled={captureDisabled}
        onClick={onTakeSnapshot}
        className="w-16 h-16 rounded-full bg-black text-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 border-white ring-2 ring-neutral-200/60 p-0 disabled:opacity-40"
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
import { RECORDING_ENABLED } from '../utils/featureFlags';
