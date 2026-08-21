/**
 * CameraViewport.tsx — ContentDetail equivalent
 *
 * The main center screen area. Renders either:
 *   A) The audio waveform visualizer (when isAudioMode = true)
 *   B) The live camera feed + CameraHUD overlays (normal mode)
 *
 * This component is purely presentational — it receives all state
 * and callbacks from MainView via props.
 */
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Activity, Mic } from 'lucide-react';
import { useAccentColor } from '../context/AccentColorContext';
import { CameraHUD } from './CameraHUD';
import { FlashMode, AspectRatio } from '../types';
import { drawSimulatedLectureFrame } from '../utils/canvasSimulation';

interface CameraViewportProps {
  // Camera
  setVideoRef: (el: HTMLVideoElement | null) => void;
  cameraStatus: 'loading' | 'live' | 'denied' | 'unavailable';
  cameraFacing: 'back' | 'front';
  flashMode: FlashMode;
  aspectRatio: AspectRatio;
  isCameraMenuOpen: boolean;

  // Audio mode
  isAudioMode: boolean;
  isRecording: boolean;
  isPaused: boolean;
  recordingSeconds: number;
  formatRecordingTime: (sec: number) => string;

  // Handlers
  onStartRecording: (e?: React.MouseEvent) => void;
  onStopRecording: (e?: React.MouseEvent) => void;
  onToggleAspectRatio: (e: React.MouseEvent) => void;
  onToggleFlash: (e?: React.MouseEvent) => void;
  onToggleCameraFacing: (e?: React.MouseEvent) => void;
  onToggleCameraMenu: (e: React.MouseEvent) => void;
  onExitAudioMode: () => void;
}

export const CameraViewport: React.FC<CameraViewportProps> = ({
  setVideoRef,
  cameraStatus,
  cameraFacing,
  flashMode,
  aspectRatio,
  isCameraMenuOpen,
  isAudioMode,
  isRecording,
  isPaused,
  recordingSeconds,
  formatRecordingTime,
  onStartRecording,
  onStopRecording,
  onToggleAspectRatio,
  onToggleFlash,
  onToggleCameraFacing,
  onToggleCameraMenu,
  onExitAudioMode,
}) => {
  const { accentColor } = useAccentColor();
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Simulated lecture frame animation for desktop/computer environments
  useEffect(() => {
    if (cameraStatus === 'live' || isAudioMode) return;

    let time = 0;
    let animId: number;
    const renderSim = () => {
      time += 0.025;
      if (simCanvasRef.current) {
        const cvs = simCanvasRef.current;
        const rect = cvs.getBoundingClientRect();
        if (rect.width && rect.height) {
          if (cvs.width !== rect.width * 2 || cvs.height !== rect.height * 2) {
            cvs.width = rect.width * 2;
            cvs.height = rect.height * 2;
          }
          const ctx = cvs.getContext('2d');
          if (ctx) {
            drawSimulatedLectureFrame(ctx, cvs.width, cvs.height, 'PPT/판서', time);
          }
        }
      }
      animId = requestAnimationFrame(renderSim);
    };

    renderSim();
    return () => cancelAnimationFrame(animId);
  }, [cameraStatus, isAudioMode, aspectRatio]);

  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isRecording) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setFocusPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setTimeout(() => setFocusPoint(null), 1200);
  };

  // Determine aspect ratio class & max dimensions (Reduce longer side from '전체' full screen)
  const getAspectRatioClasses = () => {
    if (aspectRatio === '전체') {
      return 'w-full h-full max-w-none max-h-none rounded-none';
    }

    if (isLandscape) {
      // Landscape screen (Width is longer edge).
      // Keep height 100% and reduce width to match target aspect ratio.
      switch (aspectRatio) {
        case '1:1':
          return 'h-full w-auto aspect-square max-w-full rounded-none shadow-2xl my-auto';
        case '4:3':
          return 'h-full w-auto aspect-[4/3] max-w-full rounded-none shadow-2xl my-auto';
        case '16:9':
          return 'h-full w-auto aspect-[16/9] max-w-full rounded-none shadow-2xl my-auto';
        default:
          return 'w-full h-full rounded-none';
      }
    } else {
      // Portrait screen (Height is longer edge).
      // Keep width 100% and reduce height to match target aspect ratio.
      switch (aspectRatio) {
        case '1:1':
          return 'w-full h-auto aspect-square max-h-full rounded-none shadow-2xl my-auto';
        case '4:3':
          return 'w-full h-auto aspect-[3/4] max-h-full rounded-none shadow-2xl my-auto';
        case '16:9':
          return 'w-full h-auto aspect-[9/16] max-h-full rounded-none shadow-2xl my-auto';
        default:
          return 'w-full h-full rounded-none';
      }
    }
  };

  return (
    <div
      onClick={handleViewportTap}
      className="relative flex-1 bg-black overflow-hidden flex items-center justify-center select-none w-full h-full my-auto"
    >
      {isAudioMode ? (
        /* ── Audio Waveform Visualizer Mode ── */
        <div className="relative w-full h-full bg-neutral-950 flex flex-col items-center justify-between py-6 px-6 select-none overflow-hidden">
          {/* Return to Camera Button */}
          <div className="absolute top-4 left-4 z-40 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isRecording) onStopRecording(e);
                onExitAudioMode();
              }}
              className="bg-neutral-900/80 backdrop-blur-md border border-white/20 hover:border-white/40 text-neutral-300 hover:text-white w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-all shadow-lg"
              title="카메라 모드로 돌아가기"
            >
              <Camera className="w-5 h-5" />
            </button>
          </div>

          {/* Central Visualizer */}
          <div className="relative flex flex-col items-center justify-center my-auto w-full max-w-xs">
            <div className="w-16 h-16 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-300 mb-6 shadow-inner">
              <Mic
                className="w-7 h-7"
                style={{ color: isRecording ? (!isPaused ? '#D30000' : accentColor) : '#737373' }}
              />
            </div>

            {/* Waveform Bars */}
            <div className="flex items-center justify-center gap-1.5 h-14 w-full px-4">
              {[30, 65, 25, 85, 45, 95, 70, 40, 80, 55, 90, 75, 60, 80, 30, 65, 45, 85, 25, 55].map(
                (baseH, idx) => {
                  const h = !isRecording ? 10 : isPaused ? 12 : baseH;
                  return (
                    <div
                      key={idx}
                      style={{ height: `${h}%`, transition: 'height 0.15s ease-in-out' }}
                      className={`w-1 rounded-full ${
                        !isRecording
                          ? 'bg-neutral-850'
                          : isPaused
                          ? 'bg-neutral-800'
                          : idx % 3 === 0
                          ? 'bg-[#D30000]'
                          : 'bg-neutral-300'
                      }`}
                    />
                  );
                }
              )}
            </div>

            {/* Timer */}
            <div className="mt-6 font-mono text-4xl font-bold tracking-widest text-white">
              {formatRecordingTime(recordingSeconds)}
            </div>
          </div>

          {/* Status Label */}
          <div className="text-[10px] text-neutral-500 flex items-center gap-1.5 font-mono">
            <Activity className="w-3 h-3 text-neutral-400" />
            <span>
              {isRecording
                ? isPaused
                  ? '녹음 일시정지됨'
                  : '실시간 오디오 수집 중'
                : '음성 녹음 대기 중 (저장 완료)'}
            </span>
          </div>
        </div>
      ) : (
        /* ── Normal Camera Viewport Mode ── */
        <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
          {/* Dynamic Aspect Ratio Camera Container with Smooth Transition */}
          <motion.div
            layout
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className={`relative overflow-hidden bg-neutral-950 flex items-center justify-center transition-all duration-300 shadow-2xl ${getAspectRatioClasses()}`}
          >
            {/* Live Camera Feed or Black Screen Fallback */}
            {cameraStatus === 'live' ? (
              <video
                ref={setVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover pointer-events-none select-none ${
                  cameraFacing === 'front' ? 'scale-x-[-1]' : ''
                }`}
              />
            ) : (
              <div className="w-full h-full bg-black flex items-center justify-center" />
            )}

            {/* 3x3 Grid Overlay inside the Aspect Ratio Frame */}
            <div className="absolute inset-0 pointer-events-none border border-white/10 grid grid-cols-3 grid-rows-3 z-10">
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div />
            </div>
          </motion.div>

          {/* HUD Overlays (Controls, Status & Action Buttons) */}
          <CameraHUD
            cameraStatus={cameraStatus}
            cameraFacing={cameraFacing}
            flashMode={flashMode}
            aspectRatio={aspectRatio}
            isCameraMenuOpen={isCameraMenuOpen}
            focusPoint={focusPoint}
            onStartRecording={onStartRecording}
            onToggleAspectRatio={onToggleAspectRatio}
            onToggleFlash={onToggleFlash}
            onToggleCameraFacing={onToggleCameraFacing}
            onToggleCameraMenu={onToggleCameraMenu}
          />
        </div>
      )}
    </div>
  );
};
