import { isNativeAndroid } from '../services/native';
import { NativeCameraPreview } from '../components/NativeCameraPreview';
import { cameraFrame } from '../utils/cameraFrame';
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
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { RecordingDisc } from '../components/RecordingDisc';
import { CameraHUD } from './CameraHUD';
import { FlashMode, AspectRatio } from '../types';
import { drawSimulatedLectureFrame } from '../utils/canvasSimulation';

interface CameraViewportProps {
  // Camera
  setVideoRef: (el: HTMLVideoElement | null) => void;
  onNativeCameraStatus?: (status: 'loading' | 'live' | 'denied' | 'unavailable') => void;
  cameraStatus: 'loading' | 'live' | 'denied' | 'unavailable';
  cameraFacing: 'back' | 'front';
  flashMode: FlashMode;
  aspectRatio: AspectRatio;
  isCameraMenuOpen: boolean;

  // Audio mode
  isAudioMode: boolean;
  suspended?: boolean;
  isRecording: boolean;
  isPaused: boolean;
  recordingSeconds: number;
  formatRecordingTime: (sec: number) => string;

  // Handlers
  onToggleAspectRatio: (e: React.MouseEvent) => void;
  onToggleFlash: (e?: React.MouseEvent) => void;
  onToggleCameraFacing: (e?: React.MouseEvent) => void;
  onToggleCameraMenu: (e: React.MouseEvent) => void;
}

export const CameraViewport: React.FC<CameraViewportProps> = ({
  setVideoRef,
  cameraStatus,
  onNativeCameraStatus,
  cameraFacing,
  flashMode,
  aspectRatio,
  isCameraMenuOpen,
  isAudioMode,
  suspended = false,
  isRecording,
  isPaused,
  recordingSeconds,
  formatRecordingTime,
  onToggleAspectRatio,
  onToggleFlash,
  onToggleCameraFacing,
  onToggleCameraMenu,
}) => {
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const hasLiveFrame = useRef(false);
  const bindVideoRef = useCallback((element: HTMLVideoElement | null) => {
    localVideoRef.current = element;
    setVideoRef(element);
  }, [setVideoRef]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setViewportSize(previous => {
        const next = { width: Math.round(width), height: Math.round(height) };
        return previous.width === next.width && previous.height === next.height ? previous : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const frame = cameraFrame(viewportSize.width, viewportSize.height, aspectRatio);

  // ── Video-frame Canvas Render Pipeline ──────────────────────────────────
  // Bypasses iOS WebKit's <video> hardware letterbox clipping entirely by
  // painting the video frames directly onto an edge-to-edge HTML5 Canvas surface.
  useEffect(() => {
    if (isAudioMode || suspended || isNativeAndroid()) return;

    if (cameraStatus !== 'live') hasLiveFrame.current = false;
    let time = 0;
    let animId = 0;
    let videoFrameId = 0;
    const cvs = liveCanvasRef.current;
    const video = localVideoRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d', { alpha: false });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(frame.width * dpr);
    const targetH = Math.round(frame.height * dpr);
    if (cvs.width !== targetW || cvs.height !== targetH) {
      cvs.width = targetW; cvs.height = targetH;
    }
    const useVideoFrames = cameraStatus === 'live' && video && typeof video.requestVideoFrameCallback === 'function';

    const renderLoop = () => {
      time += 0.025;
      if (cvs) {
        if (targetW && targetH) {
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
              hasLiveFrame.current = true;
            } else if (!hasLiveFrame.current) {
              // Only show the placeholder before the first real camera frame.
              // Mobile Safari can briefly lower readyState between otherwise
              // valid frames; retaining the last frame prevents a visible flash.
              drawSimulatedLectureFrame(ctx, targetW, targetH, 'PPT/판서', time);
            }
          }
        }
      }

      if (useVideoFrames) videoFrameId = video.requestVideoFrameCallback(renderLoop);
      else animId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return () => {
      cancelAnimationFrame(animId);
      if (videoFrameId) video?.cancelVideoFrameCallback(videoFrameId);
    };
  }, [cameraStatus, cameraFacing, isAudioMode, suspended, frame.width, frame.height]);

  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isAudioMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setFocusPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setTimeout(() => setFocusPoint(null), 1200);
  };

  return (
    <div
      ref={viewportRef}
      onClick={handleViewportTap}
      className={`absolute inset-0 w-full h-full ${isNativeAndroid() ? '' : 'bg-black'} overflow-hidden flex items-center justify-center select-none`}
    >
      {isAudioMode ? (
        /* ── Audio Waveform Visualizer Mode ── */
        <div className="relative w-full h-full bg-neutral-950 flex flex-col items-center justify-between py-6 px-6 select-none overflow-hidden">
          {/* Central Visualizer */}
          <RecordingDisc paused={!isRecording || isPaused} time={formatRecordingTime(recordingSeconds)} />

        </div>
      ) : isNativeAndroid() ? (
        <div className="absolute inset-0 flex items-center justify-center">
          {!suspended && <div className="relative shrink-0" style={frame}><NativeCameraPreview facing={cameraFacing} flash={flashMode} onStatus={onNativeCameraStatus!} /></div>}
          <CameraHUD cameraStatus={cameraStatus} cameraFacing={cameraFacing} flashMode={flashMode} aspectRatio={aspectRatio}
            isCameraMenuOpen={isCameraMenuOpen} focusPoint={focusPoint} onToggleAspectRatio={onToggleAspectRatio}
            onToggleFlash={onToggleFlash} onToggleCameraFacing={onToggleCameraFacing} onToggleCameraMenu={onToggleCameraMenu} />
        </div>
      ) : (
        /* ── Normal Camera Viewport Mode ── */
        <div className="absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden bg-black">
          {/* Hidden Background Video Stream Receiver */}
          <video
            ref={bindVideoRef}
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

          {/* Camera image and grid share the selected aspect-ratio frame */}
          <div className="relative shrink-0 overflow-hidden bg-black" style={frame}>
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
          {/* Grid uses the same bounds as the actual camera image. */}
          <div className="absolute inset-0 pointer-events-none z-10">
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
          </div>
          </div>

          {/* HUD Overlays (Controls, Status & Action Buttons) */}
          <CameraHUD
            cameraStatus={cameraStatus}
            cameraFacing={cameraFacing}
            flashMode={flashMode}
            aspectRatio={aspectRatio}
            isCameraMenuOpen={isCameraMenuOpen}
            focusPoint={focusPoint}
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
