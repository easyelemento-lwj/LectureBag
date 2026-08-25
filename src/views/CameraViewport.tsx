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
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

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

  // ── 60fps Canvas Direct Render Pipeline ──────────────────────────────────
  // Bypasses iOS WebKit's <video> hardware letterbox clipping entirely by
  // painting the video frames directly onto an edge-to-edge HTML5 Canvas surface.
  useEffect(() => {
    if (isAudioMode) return;

    let time = 0;
    let animId: number;

    const renderLoop = () => {
      time += 0.025;
      const cvs = liveCanvasRef.current;
      const video = localVideoRef.current;

      if (cvs) {
        const rect = cvs.getBoundingClientRect();
        if (rect.width && rect.height) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const targetW = Math.round(rect.width * dpr);
          const targetH = Math.round(rect.height * dpr);

          if (cvs.width !== targetW || cvs.height !== targetH) {
            cvs.width = targetW;
            cvs.height = targetH;
          }

          const ctx = cvs.getContext('2d', { alpha: false });
          if (ctx) {
            if (cameraStatus === 'live' && video && video.readyState >= 2) {
              const vW = video.videoWidth || 1280;
              const vH = video.videoHeight || 720;
              const canvasAspect = targetW / targetH;
              const videoAspect = vW / vH;

              let sW = vW;
              let sH = vH;
              let sX = 0;
              let sY = 0;

              // Perfect Aspect Fill / Cover Math
              if (videoAspect > canvasAspect) {
                sW = vH * canvasAspect;
                sX = (vW - sW) / 2;
              } else {
                sH = vW / canvasAspect;
                sY = (vH - sH) / 2;
              }

              ctx.save();
              if (cameraFacing === 'front') {
                ctx.translate(targetW, 0);
                ctx.scale(-1, 1);
              }
              ctx.drawImage(video, sX, sY, sW, sH, 0, 0, targetW, targetH);
              ctx.restore();
            } else {
              // Camera loading / simulation animation
              drawSimulatedLectureFrame(ctx, targetW, targetH, 'PPT/판서', time);
            }
          }
        }
      }

      animId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return () => cancelAnimationFrame(animId);
  }, [cameraStatus, cameraFacing, isAudioMode, aspectRatio]);

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
      className="absolute inset-0 w-full h-full bg-black overflow-hidden flex items-center justify-center select-none"
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
              className="bg-neutral-900/80 backdrop-blur-md border border-white/20 hover:border-white/40 text-neutral-300 hover:text-white w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all shadow-lg"
              title="카메라 모드로 돌아가기"
            >
              <Camera className="w-5.5 h-5.5" />
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
        /* ── Normal Camera Viewport Mode (Always Edge-to-Edge Full Screen) ── */
        <div className="absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden bg-black">
          {/* Hidden Background Video Stream Receiver */}
          <video
            ref={(el) => {
              localVideoRef.current = el;
              setVideoRef(el);
            }}
            autoPlay
            playsInline
            muted
            style={{
              position: 'fixed',
              top: -9999,
              left: -9999,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
            }}
          />

          {/* 60fps Fullscreen Canvas Direct Render Viewfinder (100% Edge-to-Edge) */}
          <div className="absolute inset-0 w-full h-full overflow-hidden bg-black">
            <canvas
              ref={liveCanvasRef}
              className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
              }}
            />
          </div>

          {/* Dynamic Aspect Ratio Guide Frame & 3x3 Grid Overlay */}
          <motion.div
            layout
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className={`pointer-events-none transition-all duration-300 z-10 ${getAspectRatioClasses()}`}
          >
            {/* 3x3 Grid Overlay */}
            <div className="w-full h-full border border-white/20 grid grid-cols-3 grid-rows-3">
              <div className="border-r border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
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
