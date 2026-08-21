/**
 * CameraHUD.tsx — Sidebar equivalent
 *
 * All overlay controls that float on top of the camera viewport:
 * - Top-left: Mic / back-to-camera button
 * - Top-center: Camera status badge
 * - Top-right: Aspect-ratio pill + 3-dot dropdown (flash / camera-flip)
 * - Bottom-center: Mode pill ("PPT / 판서 자동 보정 모드")
 * - Focus ring on tap
 * - Permission-denied banner
 */
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap, ZapOff, RefreshCw, Mic, Camera, MoreHorizontal, Sparkles,
} from 'lucide-react';
import { FlashMode, AspectRatio } from '../types';
import { useAccentColor } from '../context/AccentColorContext';

interface CameraHUDProps {
  // Status
  cameraStatus: 'loading' | 'live' | 'denied' | 'unavailable';
  cameraFacing: 'back' | 'front';
  flashMode: FlashMode;
  aspectRatio: AspectRatio;
  isCameraMenuOpen: boolean;

  // Focus
  focusPoint: { x: number; y: number } | null;

  // Handlers
  onStartRecording: (e?: React.MouseEvent) => void;
  onToggleAspectRatio: (e: React.MouseEvent) => void;
  onToggleFlash: (e?: React.MouseEvent) => void;
  onToggleCameraFacing: (e?: React.MouseEvent) => void;
  onToggleCameraMenu: (e: React.MouseEvent) => void;
}

export const CameraHUD: React.FC<CameraHUDProps> = ({
  cameraStatus,
  cameraFacing,
  flashMode,
  aspectRatio,
  isCameraMenuOpen,
  focusPoint,
  onStartRecording,
  onToggleAspectRatio,
  onToggleFlash,
  onToggleCameraFacing,
  onToggleCameraMenu,
}) => {
  const { accentColor } = useAccentColor();

  return (
    <>
      {/* Permission Denied Banner */}
      {cameraStatus === 'denied' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
          <div className="bg-neutral-900/90 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-4 flex flex-col items-center gap-2 text-center max-w-[220px]">
            <Camera className="w-8 h-8 text-neutral-400" />
            <p className="text-sm text-neutral-300 leading-snug">카메라 접근 권한이 필요합니다</p>
            <p className="text-[11px] text-neutral-500">브라우저 설정에서 카메라 권한을 허용해 주세요</p>
          </div>
        </div>
      )}

      {/* Top-Left: Mic / Audio Button */}
      <div className="absolute top-4 left-4 z-40 flex items-center gap-2">
        <button
          onClick={onStartRecording}
          className="bg-neutral-900/80 backdrop-blur-md border border-white/20 hover:border-white/40 text-white w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-all shadow-lg"
          title="음성 녹음 시작"
        >
          <Mic className="w-5 h-5 text-[#D30000]" />
        </button>
      </div>

      {/* Top-Center: Camera Status Indicator */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-[11px] font-medium shadow-md">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            cameraStatus === 'live'
              ? 'bg-green-400 animate-pulse'
              : cameraStatus === 'loading'
              ? 'bg-yellow-400 animate-pulse'
              : 'bg-red-500'
          }`}
        />
        <span className="text-neutral-300">
          {cameraStatus === 'live'
            ? '카메라 연결됨'
            : cameraStatus === 'loading'
            ? '카메라 연결 중...'
            : '카메라 오프라인'}
        </span>
      </div>

      {/* Top-Right: Aspect Ratio + 3-dot menu */}
      <div className="absolute top-4 right-4 z-40 flex items-center gap-2.5">
        <button
          onClick={onToggleAspectRatio}
          className="bg-neutral-900/80 backdrop-blur-md border border-white/20 hover:border-white/40 text-white text-xs font-bold px-3.5 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all shadow-lg"
          title="카메라 비율"
        >
          <span>{aspectRatio}</span>
        </button>

        <div className="relative">
          <button
            onClick={onToggleCameraMenu}
            className={`w-11 h-11 rounded-full bg-neutral-900/80 backdrop-blur-md border ${
              isCameraMenuOpen ? 'border-white bg-neutral-800' : 'border-white/20 hover:border-white/40'
            } text-white flex items-center justify-center active:scale-90 transition-all shadow-lg`}
            title="카메라 설정"
          >
            <MoreHorizontal className="w-5.5 h-5.5 text-white" />
          </button>

          <AnimatePresence>
            {isCameraMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85, y: -6 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => e.stopPropagation()}
                className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 flex flex-col items-center gap-2.5 select-none"
              >
                {/* Flash Button */}
                <button
                  onClick={onToggleFlash}
                  className="w-10.5 h-10.5 rounded-full bg-neutral-900/90 backdrop-blur-md hover:bg-neutral-800 active:scale-90 border border-white/25 flex items-center justify-center transition-all shadow-lg"
                  title={`플래시: ${flashMode.toUpperCase()}`}
                >
                  {flashMode === 'on' ? (
                    <Zap className="w-5 h-5 fill-current text-yellow-400" />
                  ) : flashMode === 'auto' ? (
                    <div className="relative flex items-center justify-center">
                      <Zap className="w-5 h-5 text-yellow-400" />
                      <span className="absolute -bottom-1 -right-1 text-[8px] font-bold text-yellow-400">A</span>
                    </div>
                  ) : (
                    <ZapOff className="w-5 h-5 text-neutral-400" />
                  )}
                </button>

                {/* Camera Flip Button */}
                <button
                  onClick={onToggleCameraFacing}
                  className="w-10.5 h-10.5 rounded-full bg-neutral-900/90 backdrop-blur-md hover:bg-neutral-800 active:scale-90 border border-white/25 flex items-center justify-center transition-all shadow-lg"
                  title={`카메라 전환: ${cameraFacing === 'front' ? '전면' : '후면'}`}
                >
                  <RefreshCw
                    className={`w-5 h-5 text-white transition-transform duration-300 ${
                      cameraFacing === 'front' ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Focus Ring on Tap */}
      <AnimatePresence>
        {focusPoint && (
          <motion.div
            initial={{ scale: 1.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            style={{
              left: focusPoint.x - 24,
              top: focusPoint.y - 24,
              borderColor: accentColor,
              boxShadow: `0 0 12px ${accentColor}80`,
            }}
            className="absolute w-12 h-12 border-2 rounded-md pointer-events-none z-30"
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-1.5 h-0.5" style={{ backgroundColor: accentColor }} />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-1.5 h-0.5" style={{ backgroundColor: accentColor }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Mode Pill */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-neutral-900/80 backdrop-blur-md px-3 py-1 rounded-full border border-white/15 text-[11px] font-medium flex items-center gap-1.5 shadow-md"
        style={{ color: accentColor }}
      >
        <Sparkles className="w-3 h-3" style={{ color: accentColor }} />
        <span>PPT / 판서 자동 보정 모드</span>
      </div>
    </>
  );
};
